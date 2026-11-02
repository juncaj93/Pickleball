import type { CreditEntryView, GroupView } from '../shared/api';
import { sessionCalendar } from '../shared/calendar';
import { DEFAULT_VENUE_NAME } from '../shared/settings';
import { joinOutcome } from '../shared/spots';
import { localParts, zonedTimeToUtc } from '../shared/time';
import { PAY_FROM_HOUR } from '../shared/money';
import { clearCookie, type Ctx, PLAYER_COOKIE } from './context';
import { currentPlayerId, forgetPlayer, rememberPlayer, requireAdmin, requireGroupKey } from './auth';
import { HttpError } from './http';
import {
  audit,
  confirmedOf,
  ensureSessions,
  getPlayers,
  getSession,
  type GroupRow,
  organizerIdOf,
  pricesFor,
  settingsOf,
  usualDaysOf,
} from './repo';
import { holidayFor } from '../shared/holidays';
import { newId } from './crypto';
import { claimSlot, releaseSlot } from './rate';
import { auditLateFeeOwed, clearLateDrop, confirmAttendance, decline, joinSession, recordLateDrop, withdraw } from './roster';
import { lateFeesFor } from './lateFees';
import { lateFeeKind } from '../shared/lateFees';

/**
 * "Good news: someone took your spot for Tue, Nov 3. You no longer owe $14." The cleared late fees of THIS player only
 * (their own History lines, matched by their id), from the last 60 days. The phone remembers which ones were dismissed.
 */
async function feeNoticesFor(ctx: Ctx, groupId: string, playerId: string): Promise<NonNullable<GroupView['feeNotices']>> {
  const since = new Date(ctx.nowMs - 60 * DAY_MS).toISOString();
  const { results } = await ctx.db
    .prepare(
      `SELECT a.id, a.details_json, s.starts_at FROM admin_audit_log a JOIN sessions s ON s.id = a.session_id
       WHERE a.group_id = ? AND a.action = 'late_fee_cleared' AND a.created_at >= ? ORDER BY a.created_at, a.rowid`,
    )
    .bind(groupId, since)
    .all<{ id: string; details_json: string; starts_at: string }>();
  const out: NonNullable<GroupView['feeNotices']> = [];
  for (const r of results) {
    try {
      const d = JSON.parse(r.details_json) as { playerId?: string; why?: string; amountCents?: number };
      if (d.playerId !== playerId) continue;
      out.push({ id: r.id, startsAt: r.starts_at, why: d.why === 'sub' ? 'sub' : 'cleared', creditCents: typeof d.amountCents === 'number' && d.amountCents > 0 ? d.amountCents : 0 });
    } catch {
      /* an unreadable line shows nothing */
    }
  }
  return out;
}

/**
 * This player's late fees that were cleared, keyed "session|time": 'sub' when someone took their spot, 'cleared' when
 * the organizer cleared it (or the game was canceled). Read from their own History lines only.
 */
async function lateFeeClearsFor(ctx: Ctx, groupId: string, playerId: string): Promise<Map<string, 'sub' | 'cleared'>> {
  const { results } = await ctx.db
    .prepare("SELECT session_id, details_json, created_at FROM admin_audit_log WHERE group_id = ? AND action = 'late_fee_cleared' AND session_id IS NOT NULL")
    .bind(groupId)
    .all<{ session_id: string; details_json: string; created_at: string }>();
  const out = new Map<string, 'sub' | 'cleared'>();
  for (const r of results) {
    try {
      const d = JSON.parse(r.details_json) as { playerId?: string; why?: string };
      if (d.playerId === playerId) out.set(`${r.session_id}|${r.created_at}`, d.why === 'sub' ? 'sub' : 'cleared');
    } catch {
      /* an unreadable line tags nothing */
    }
  }
  return out;
}
import { NO_SEAT_CREDIT, potBalance, seatCredit, type SeatCredit, usableCredit, visibleEntries } from '../shared/credit';
import { cashOutOffer, loadPendingRequests, moneyPicture } from './credit';
import { agreedValue, isWaitingOnTime } from '../shared/timeShift';
import { timeShiftFor } from './timeShift';
import { motionFor } from './motion';
import { payAlwaysFor } from './payAlways';
import { payNoteFor } from './payNote';
import { cancelRefundRequest, requestRefund, undoCreditUse, useCashOutOn, useCreditOn } from './creditActions';
import { playerSessionView } from './views';
import { applyPayment } from './admin';
import * as v from './validate';
import { afterTap, watchTap } from './alerts';
import { changeStamp } from './stamp';
import { hiddenFromPlayers } from './hideGame';

const SELF_ADDS_PER_HOUR = 3;
const DAY_MS = 86_400_000;
/** Suggestions only look at sessions this far ahead. */
const SUGGEST_AHEAD_MS = 8 * DAY_MS;

interface Viewer {
  group: GroupRow;
  playerId: string | null;
  /** Set when the organizer is acting as this player ("View as..."). */
  viewAsName: string | null;
}

/**
 * Who is looking. Normally the player link's key plus the name this phone
 * picked. With an X-View-As header, the signed-in organizer acts as that
 * player instead; without the organizer's sign-in the header is refused.
 */
export async function viewer(ctx: Ctx): Promise<Viewer> {
  const viewAs = ctx.req.headers.get('X-View-As');
  if (viewAs) {
    const group = await requireAdmin(ctx);
    const id = v.id(viewAs, 'viewAs');
    const p = await ctx.db
      .prepare('SELECT id, display_name FROM players WHERE id = ? AND group_id = ?')
      .bind(id, group.id)
      .first<{ id: string; display_name: string }>();
    if (!p) throw new HttpError(404, 'player_not_found', 'Player not found.');
    return { group, playerId: p.id, viewAsName: p.display_name };
  }
  const group = await requireGroupKey(ctx);
  return { group, playerId: await currentPlayerId(ctx, group), viewAsName: null };
}

/** GET /api/group/version: the tiny "did anything change?" answer the open page asks every few seconds. */
export async function groupVersion(ctx: Ctx): Promise<Response> {
  const { group, playerId } = await viewer(ctx);
  return new Response(JSON.stringify({ v: await changeStamp(ctx, group, playerId) }), {
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

export async function groupView(ctx: Ctx): Promise<GroupView> {
  const { group, playerId: meId, viewAsName } = await viewer(ctx);
  // Taken before the data is read, so a change in between shows up as a newer stamp on the next check.
  const version = await changeStamp(ctx, group, meId);
  await ensureSessions(ctx.db, group, ctx.nowMs);
  const settings = settingsOf(group);
  const tz = group.timezone;
  const allPlayers = await getPlayers(ctx.db, group.id);
  const players = allPlayers.filter((p) => p.is_active);
  const { sessions, rosters, ledger, reserved } = await moneyPicture(ctx.db, group, ctx.nowMs);
  const me = (viewAsName ? allPlayers : players).find((p) => p.id === meId) ?? null;
  // The organizer pays the venue, so they never owe, pay or earn credit as a player.
  const meIsOrganizer = !!me && me.id === (await organizerIdOf(ctx.db, group));
  const timeShift = await timeShiftFor(ctx, group.id);
  const lateFees = await lateFeesFor(ctx, group.id);
  // Canceled games the organizer removed from the player screen (ADMIN_V2). Nothing else about them changes.
  const hiddenIds = await hiddenFromPlayers(ctx, group.id, sessions);

  const owed: GroupView['owed'] = [];
  const feeNotices: NonNullable<GroupView['feeNotices']> = [];
  let suggestion: GroupView['suggestion'] = null;
  const credit: GroupView['credit'] = { balanceCents: 0, usableCents: 0, pending: null, history: [] };
  // Their own seats' part of the pot: credit used on it, cash paid toward it earlier, and money that came back from it.
  const mySeat = (sessionId: string): SeatCredit => {
    if (!me || meIsOrganizer) return NO_SEAT_CREDIT;
    const r = (rosters.get(sessionId) ?? []).find((x) => x.player_id === me.id);
    if (!r) return NO_SEAT_CREDIT;
    return seatCredit(ledger, sessionId, me.id, { paymentStatus: r.payment_status, paidAt: r.paid_at, refundedAt: r.refunded_at });
  };
  if (me) {
    for (const s of meIsOrganizer ? [] : sessions) {
      const roster = rosters.get(s.id) ?? [];
      // An open late fee (shared/lateFees.ts) is owed like a seat that is in: a late drop, a no-show, a game canceled late.
      const own = roster.find((r) => r.player_id === me.id);
      const fee = own ? lateFeeKind(own, s) : null;
      if (s.status === 'canceled' && !fee) continue;
      const mine = own && (own.status === 'confirmed' || fee) && own.payment_status === 'unpaid' ? own : undefined;
      const price = mine ? pricesFor(s, roster, settings).get(me.id) : undefined;
      if (!price) continue;
      const seat = mySeat(s.id);
      const used = seat.usedCents + seat.cashCents;
      if (price.cents - used <= 0) continue;
      owed.push({
        sessionId: s.id,
        startsAt: s.starts_at,
        endsAt: s.ends_at,
        amountCents: price.cents - used,
        creditCents: seat.usedCents,
        finalized: !!s.finalized_at,
        reminder: ctx.nowMs >= Date.parse(s.ends_at) + DAY_MS,
        signupAt: mine!.confirmed_at ?? mine!.claimed_at,
        ...(fee ? { lateFee: fee } : {}),
      });
    }
    if (!meIsOrganizer) {
      credit.balanceCents = potBalance(ledger, me.id);
      credit.usableCents = usableCredit(credit.balanceCents, reserved.get(me.id) ?? 0);
      const pending = (await loadPendingRequests(ctx.db, group.id)).find((r) => r.player_id === me.id);
      credit.pending = pending ? { id: pending.id, cents: pending.amount_cents, at: pending.created_at } : null;
      // Money that came back because a late fee was cleared: "someone took your spot" (a sub) or cleared by the organizer.
      const feeClears = await lateFeeClearsFor(ctx, group.id, me.id);
      feeNotices.push(...(await feeNoticesFor(ctx, group.id, me.id)));
      const startsOf = new Map(
        (await ctx.db.prepare('SELECT id, starts_at FROM sessions WHERE group_id = ?').bind(group.id).all<{ id: string; starts_at: string }>()).results.map((r) => [r.id, r.starts_at]),
      );
      // Their own entries only, including ones that ended (credit used on a game that went back to them), so the
      // credit sheet can say what happened to their money in plain words.
      credit.history = visibleEntries(ledger)
        .filter((e) => e.playerId === me.id)
        .map(
          (e): CreditEntryView => ({
            id: e.id,
            kind: e.kind,
            cents: e.cents,
            sessionId: e.sessionId,
            sessionStartsAt: e.sessionId ? (startsOf.get(e.sessionId) ?? null) : null,
            at: e.createdAt,
            endedAt: e.endedAt,
            endedReason: (e.endedReason as CreditEntryView['endedReason']) ?? null,
            reason: e.reason ?? null,
            playedCount: e.playedCount ?? null,
            lateFee: e.sessionId ? (feeClears.get(`${e.sessionId}|${e.kind === 'used' ? e.endedAt : e.createdAt}`) ?? null) : null,
          }),
        )
        .reverse();
    }
    // Regulars get a nudge for the next usual day they haven't answered.
    const days = usualDaysOf(me);
    if (me.is_regular && days.length > 0) {
      for (const s of sessions) {
        const start = Date.parse(s.starts_at);
        if (s.status === 'canceled' || start <= ctx.nowMs || start > ctx.nowMs + SUGGEST_AHEAD_MS) continue;
        if (!days.includes(localParts(start, group.timezone).weekday)) continue;
        const roster = rosters.get(s.id) ?? [];
        if (roster.some((r) => r.player_id === me.id)) continue;
        suggestion = {
          sessionId: s.id,
          startsAt: s.starts_at,
          endsAt: s.ends_at,
          joinAs: joinOutcome(confirmedOf(roster).length, settings.maxPlayers),
          holiday: holidayFor(s.starts_at, tz),
          confirmedCount: confirmedOf(roster).length,
          courtState: s.court_state,
        };
        break;
      }
    }
  }

  return {
    group: {
      name: group.name,
      timezone: group.timezone,
      venmoUrl: group.venmo_url,
      organizerName: group.organizer_name,
      priceCents: settings.pricePerPlayerCents,
      maxPlayers: settings.maxPlayers,
      // The usual game length (Settings > Schedule): a card shows only the start time unless a game runs a different length.
      usualMinutes: settings.defaultEndMinutes - settings.defaultStartMinutes,
    },
    players: players.map((p) => ({ id: p.id, name: p.display_name })),
    me: me ? { id: me.id, name: me.display_name } : null,
    viewingAs: !!viewAsName,
    timeShift,
    motion: motionFor(ctx),
    payAlways: await payAlwaysFor(ctx, group.id),
    payNote: await payNoteFor(ctx, group.id),
    now: ctx.nowIso,
    // Upcoming sessions only. Money lives in the card at the top on game day.
    lateFees,
    feeNotices,
    sessions: sessions
      .filter((s) => Date.parse(s.ends_at) > ctx.nowMs && !hiddenIds.has(s.id))
      .map((s) => playerSessionView(s, rosters.get(s.id) ?? [], me?.id ?? null, ctx.nowMs, settings, tz, meIsOrganizer, { usableCents: credit.usableCents, hasCredit: credit.balanceCents > 0 || !!credit.pending, seat: mySeat(s.id) }, timeShift, lateFees)),
    owed,
    payDue: owed.filter((o) => {
      // A late fee shows on the top card at once (it is owed now, whatever the hour).
      if (o.lateFee) return true;
      const p = localParts(Date.parse(o.startsAt), tz);
      return ctx.nowMs >= zonedTimeToUtc(p.year, p.month, p.day, PAY_FROM_HOUR, 0, tz);
    }),
    credit,
    suggestion,
    version,
  };
}

export async function pickName(ctx: Ctx, body: Record<string, unknown>) {
  const group = await requireGroupKey(ctx);
  const playerId = v.id(body.playerId, 'playerId');
  const player = await ctx.db
    .prepare('SELECT id, display_name FROM players WHERE id = ? AND group_id = ? AND is_active = 1')
    .bind(playerId, group.id)
    .first<{ id: string; display_name: string }>();
  if (!player) throw new HttpError(404, 'player_not_found', 'That name is not on the list.');
  await rememberPlayer(ctx, group, player.id);
  return { me: { id: player.id, name: player.display_name } };
}

/** Lowercase letters and single spaces, for comparing names. */
function nameKey(name: string): string {
  // "José" and "Jose" compare the same (Latin accents folded, not dropped). Only the Latin accent marks go: in other
  // scripts (Hindi vowel signs...) the marks are part of the letters, so "राम" and "रमा" stay different.
  return name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').normalize('NFC').toLowerCase().replace(/[^\p{L}\p{M}\s'-]/gu, '').replace(/\s+/g, ' ').trim();
}

/** Typos between two names: letters added, dropped, changed, or two swapped ("Rayn" vs "Ryan") each count as one. */
function editDistance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

/** "Ryan" vs "Ryan", "ryan s", "Rayn": probably the same person. */
export function looksLike(typed: string, existing: string): boolean {
  const a = nameKey(typed);
  const b = nameKey(existing);
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.split(' ')[0] === b.split(' ')[0]) return true;
  return Math.min(a.length, b.length) >= 4 && editDistance(a, b) <= 1;
}

/**
 * "Add my name" on Who are you?. If the name looks like someone already on
 * the list, the player is asked "Is this you?" first (confirmNew skips that
 * once they say no). The new name gets a "New" tag for the organizer.
 */
export async function addSelf(ctx: Ctx, body: Record<string, unknown>) {
  const group = await requireGroupKey(ctx);
  const name = v.playerName(body.name);
  const all = await getPlayers(ctx.db, group.id);
  const matches = all.filter((p) => p.is_active && looksLike(name, p.display_name));
  if (body.confirmNew !== true && matches.length > 0) {
    return { result: 'looks_like', matches: matches.map((p) => ({ id: p.id, name: p.display_name })) };
  }
  if (all.some((p) => nameKey(p.display_name) === nameKey(name))) {
    throw new HttpError(409, 'name_taken', `Someone already uses "${name}". Add your last initial, like "${name} S."`);
  }
  if (all.length >= 30) throw new HttpError(409, 'too_many_players', 'The list is full. Ask the organizer to add you.');
  // Spam guard: a few new names per phone per hour, even when many arrive at once.
  const slot = await claimSlot(ctx, 'self_add', 3600_000, SELF_ADDS_PER_HOUR);
  if (!slot) {
    throw new HttpError(429, 'too_many_names', "You've added a few names already. Try again in an hour, or ask the organizer to add you.");
  }
  const id = newId();
  try {
    await ctx.db
      .prepare(
        `INSERT INTO players (id, group_id, display_name, is_regular, is_active, sort_order, created_at, self_added_at, is_new)
         VALUES (?, ?, ?, 0, 1, ?, ?, ?, 1)`,
      )
      .bind(id, group.id, name, all.length, ctx.nowIso, ctx.nowIso)
      .run();
  } catch (err) {
    await releaseSlot(ctx, slot);
    if (err instanceof Error && /UNIQUE/i.test(err.message)) {
      throw new HttpError(409, 'name_taken', `Someone already uses "${name}". Add your last initial, like "${name} S."`);
    }
    throw err;
  }
  await rememberPlayer(ctx, group, id);
  await audit(ctx.db, group.id, null, 'player_self_added', { name }, ctx.nowIso, 'player');
  return { result: 'added', me: { id, name } };
}

/** "Any preferred days?" right after adding a name. Only touches the player on this phone. */
export async function setMyDays(ctx: Ctx, body: Record<string, unknown>) {
  const who = await viewer(ctx);
  refuseDemo(ctx, who);
  const { group, playerId } = who;
  if (!playerId) throw new HttpError(401, 'pick_name', 'Pick your name first.');
  const days = v.usualDays(body.days) ?? '';
  await ctx.db
    .prepare(
      `UPDATE players SET usual_days = ?,
         is_regular = CASE WHEN is_new = 1 THEN (CASE WHEN ? <> '' THEN 1 ELSE 0 END) ELSE is_regular END
       WHERE id = ? AND group_id = ?`,
    )
    .bind(days, days, playerId, group.id)
    .run();
  return { ok: true, usualDays: days };
}

export async function forgetName(ctx: Ctx) {
  await forgetPlayer(ctx);
  clearCookie(ctx, PLAYER_COOKIE);
  return { me: null };
}

/**
 * "View as..." never changes the real data: the live server refuses its
 * taps. The organizer's demo runs them on a throwaway copy in the browser.
 */
function refuseDemo(ctx: Ctx, who: Viewer) {
  if (who.viewAsName && !ctx.env.SANDBOX) throw new HttpError(403, 'demo_only', 'Demo only. Nothing was saved.');
}

async function actingOn(ctx: Ctx) {
  const who = await viewer(ctx);
  refuseDemo(ctx, who);
  if (!who.playerId) throw new HttpError(401, 'pick_name', 'Pick your name first.');
  const session = await getSession(ctx.db, who.group.id, v.id(ctx.params.id, 'session'));
  if (!session) throw new HttpError(404, 'session_not_found', 'Session not found.');
  return { ...who, playerId: who.playerId, session };
}

/** Every player tap goes in the History > Activity log under the player's name. */
async function logAction(ctx: Ctx, who: Awaited<ReturnType<typeof actingOn>>, action: string, result: unknown, extra: Record<string, unknown> = {}) {
  const p = await ctx.db.prepare('SELECT display_name FROM players WHERE id = ?').bind(who.playerId).first<{ display_name: string }>();
  const name = p?.display_name ?? 'A player';
  await audit(ctx.db, who.group.id, who.session.id, `player_${action}`, { player: name, result, ...extra }, ctx.nowIso, name);
}

export async function playerJoin(ctx: Ctx) {
  const who = await actingOn(ctx);
  const watch = await watchTap(ctx, who.group, who.session, who.playerId);
  const res = await joinSession(ctx.db, who.session, who.playerId, ctx.nowMs, 'auto', settingsOf(who.group).maxPlayers);
  await clearLateDrop(ctx.db, who.session.id, who.playerId);
  if (res.result !== 'already_confirmed') await logAction(ctx, who, 'join', res.result);
  await afterTap(ctx, watch);
  // Their credit was used on the seat already; a pending cash out that could cover the rest is offered next.
  const offer = res.result === 'confirmed' ? await cashOutOffer(ctx.db, who.session, who.playerId) : null;
  return offer ? { ...res, cashOutOffer: { cents: offer.cents, requestCents: offer.requestCents } } : res;
}

export async function playerWithdraw(ctx: Ctx) {
  const who = await actingOn(ctx);
  const watch = await watchTap(ctx, who.group, who.session, who.playerId);
  const lateFees = await lateFeesFor(ctx, who.group.id);
  const res = await withdraw(ctx.db, who.group, who.session, who.playerId, ctx.nowMs, { lateFees });
  const late = res.freedSpot ? await recordLateDrop(ctx.db, who.session, who.playerId, ctx.nowMs, settingsOf(who.group), lateFees) : false;
  const result = res.changed ? 'withdrawn' : 'not_in_session';
  if (res.changed) await logAction(ctx, who, 'withdraw', result, { late, ...(res.lateFee ? { owes: true } : {}) });
  if (res.lateFee) await auditLateFeeOwed(ctx.db, who.group.id, who.session.id, who.playerId, 'late_drop', ctx.nowIso);
  if (res.creditBackCents > 0) {
    const p = await ctx.db.prepare('SELECT display_name FROM players WHERE id = ?').bind(who.playerId).first<{ display_name: string }>();
    await audit(ctx.db, who.group.id, who.session.id, 'credit_back', { player: p?.display_name ?? 'A player', playerId: who.playerId, amountCents: res.creditBackCents, reason: 'dropped' }, ctx.nowIso);
  }
  await afterTap(ctx, watch);
  // creditBackCents: cash paid that became credit; creditReturnedCents: credit used on the game that went back.
  // lateFee: the drop left the game short, so their $14 stays on it (or is owed) unless someone takes the spot.
  return { result, creditBackCents: res.creditBackCents, creditReturnedCents: res.creditReturnedCents, ...(res.lateFee ? { lateFee: { cents: settingsOf(who.group).pricePerPlayerCents, paid: res.lateFee.paid } } : {}) };
}

/**
 * POST /api/sessions/:id/paid { paid }: "I paid" (or "Didn't pay?") from the
 * player. Opening Venmo never does this by itself. The organizer sees a
 * "self-marked" tag until they confirm it, and can always change it.
 */
export async function playerPaid(ctx: Ctx, body: Record<string, unknown>) {
  const who = await actingOn(ctx);
  const paid = v.bool(body.paid, 'paid');
  const p = await ctx.db.prepare('SELECT display_name FROM players WHERE id = ?').bind(who.playerId).first<{ display_name: string }>();
  const name = p?.display_name ?? 'A player';
  return applyPayment(ctx, who.group, who.session, who.playerId, paid, name, name, body.cents === undefined ? null : v.cents(body.cents, 'cents'));
}

/** POST /api/sessions/:id/use-credit: "Use credit" on a game they already owe for (credit that arrived after they signed up). */
export async function playerUseCredit(ctx: Ctx) {
  const who = await actingOn(ctx);
  const p = await ctx.db.prepare('SELECT display_name FROM players WHERE id = ?').bind(who.playerId).first<{ display_name: string }>();
  return useCreditOn(ctx, who.group, who.session, who.playerId, p?.display_name ?? 'A player');
}

/** POST /api/sessions/:id/use-cash-out { cents }: "Use it" on the cash-out prompt after I'm in. */
export async function playerUseCashOut(ctx: Ctx, body: Record<string, unknown>) {
  const who = await actingOn(ctx);
  const p = await ctx.db.prepare('SELECT display_name FROM players WHERE id = ?').bind(who.playerId).first<{ display_name: string }>();
  return useCashOutOn(ctx, who.group, who.session, who.playerId, p?.display_name ?? 'A player', body);
}

/** POST /api/sessions/:id/undo-credit: takes back "Use credit" on a game paid with credit. */
export async function playerUndoCredit(ctx: Ctx) {
  const who = await actingOn(ctx);
  const p = await ctx.db.prepare('SELECT display_name FROM players WHERE id = ?').bind(who.playerId).first<{ display_name: string }>();
  return undoCreditUse(ctx, who.group, who.session, who.playerId, p?.display_name ?? 'A player');
}

/** POST /api/me/refund-request { cents }: ask for some or all of their credit back. */
export async function playerRequestRefund(ctx: Ctx, body: Record<string, unknown>) {
  const who = await viewer(ctx);
  refuseDemo(ctx, who);
  if (!who.playerId) throw new HttpError(401, 'pick_name', 'Pick your name first.');
  const p = await ctx.db.prepare('SELECT display_name FROM players WHERE id = ?').bind(who.playerId).first<{ display_name: string }>();
  return requestRefund(ctx, who.group, who.playerId, p?.display_name ?? 'A player', body);
}

/** POST /api/me/refund-request/cancel: take the request back. */
export async function playerCancelRefundRequest(ctx: Ctx) {
  const who = await viewer(ctx);
  refuseDemo(ctx, who);
  if (!who.playerId) throw new HttpError(401, 'pick_name', 'Pick your name first.');
  const p = await ctx.db.prepare('SELECT display_name FROM players WHERE id = ?').bind(who.playerId).first<{ display_name: string }>();
  return cancelRefundRequest(ctx, who.group, who.playerId, p?.display_name ?? 'A player');
}

/**
 * POST /api/sessions/:id/still-in { startsAt }: "Still in" on the "time changed" notice. Records that this player
 * agreed to the game's current start time (shared/timeShift.ts). Changes no money and no seat. `startsAt` is the
 * time the notice showed: if the organizer moved the game again in between, nothing is saved and the screen looks again.
 */
export async function playerStillIn(ctx: Ctx, body: Record<string, unknown>) {
  const who = await actingOn(ctx);
  const shown = v.isoTime(body.startsAt, 'startsAt');
  if (!(await timeShiftFor(ctx, who.group.id))) throw new HttpError(404, 'not_found', 'Not found.');
  if (who.session.status === 'canceled') throw new HttpError(409, 'session_canceled', 'This game was canceled.');
  if (ctx.nowMs >= Date.parse(who.session.starts_at)) throw new HttpError(409, 'session_started', 'This game already started.');
  if (!shown || Date.parse(shown) !== Date.parse(who.session.starts_at)) throw new HttpError(409, 'time_changed', 'The time changed again. Look at the new time.');
  const seat = await ctx.db
    .prepare("SELECT time_confirmed FROM session_players WHERE session_id = ? AND player_id = ? AND status = 'confirmed'")
    .bind(who.session.id, who.playerId)
    .first<{ time_confirmed: string | null }>();
  if (!seat) throw new HttpError(409, 'not_in_session', "You're not in this game.");
  // Only if nothing changed the answer in between (a second tap or another phone): then this one has nothing to add.
  const res = await ctx.db
    .prepare("UPDATE session_players SET time_confirmed = ? WHERE session_id = ? AND player_id = ? AND status = 'confirmed' AND time_confirmed IS ?")
    .bind(agreedValue(who.session.starts_at, ctx.nowIso, seat.time_confirmed), who.session.id, who.playerId, seat.time_confirmed)
    .run();
  if (!res.meta.changes) {
    const now = await ctx.db.prepare("SELECT time_confirmed FROM session_players WHERE session_id = ? AND player_id = ? AND status = 'confirmed'").bind(who.session.id, who.playerId).first<{ time_confirmed: string | null }>();
    if (!now) throw new HttpError(409, 'not_in_session', "You're not in this game.");
    if (isWaitingOnTime(now.time_confirmed, who.session.starts_at)) throw new HttpError(409, 'try_again', 'That did not work. Try again.');
    return { result: 'confirmed_time' };
  }
  await logAction(ctx, who, 'still_in', 'confirmed_time', { startsAt: who.session.starts_at });
  return { result: 'confirmed_time' };
}

export async function playerConfirm(ctx: Ctx) {
  const who = await actingOn(ctx);
  await confirmAttendance(ctx.db, who.session, who.playerId, ctx.nowMs);
  await logAction(ctx, who, 'check_in', 'confirmed_attendance');
  return { result: 'confirmed_attendance' };
}

export async function playerDecline(ctx: Ctx) {
  const who = await actingOn(ctx);
  await decline(ctx.db, who.session, who.playerId, ctx.nowMs);
  await logAction(ctx, who, 'decline', 'declined');
  return { result: 'declined' };
}

/**
 * Calendar file for one session. Needs no sign-in: it holds only the time
 * and place, and session ids are random.
 */
export async function sessionCalendarFile(ctx: Ctx): Promise<Response> {
  const id = v.id(ctx.params.id, 'session');
  const session = await ctx.db.prepare('SELECT * FROM sessions WHERE id = ?').bind(id).first<{
    id: string;
    group_id: string;
    starts_at: string;
    ends_at: string;
    venue_name: string | null;
  }>();
  if (!session) throw new HttpError(404, 'session_not_found', 'Session not found.');
  const group = await ctx.db.prepare('SELECT timezone, venue_name, venue_address FROM groups WHERE id = ?').bind(session.group_id).first<{
    timezone: string;
    venue_name: string | null;
    venue_address: string | null;
  }>();
  const name = group?.venue_name || DEFAULT_VENUE_NAME;
  const location = group?.venue_address ? `${name}, ${group.venue_address}` : name;
  const body = sessionCalendar({
    id: session.id,
    startsAt: session.starts_at,
    endsAt: session.ends_at,
    location,
    nowIso: ctx.nowIso,
    timezone: group?.timezone,
    url: `${ctx.url.origin}/?s=${session.id}`,
  });
  const p = localParts(Date.parse(session.starts_at), group?.timezone ?? 'America/Detroit');
  const date = `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
  return new Response(body, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `inline; filename="pickleball-${date}.ics"`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
