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
import { clearLateDrop, confirmAttendance, decline, joinSession, recordLateDrop, withdraw } from './roster';
import { NO_SEAT_CREDIT, potBalance, seatCredit, type SeatCredit, usableCredit, visibleEntries } from '../shared/credit';
import { loadPendingRequests, moneyPicture } from './credit';
import { cancelRefundRequest, requestRefund, undoCreditUse, useCreditOn } from './creditActions';
import { playerSessionView } from './views';
import { applyPayment } from './admin';
import * as v from './validate';
import { afterTap, watchTap } from './alerts';
import { changeStamp } from './stamp';

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

  const owed: GroupView['owed'] = [];
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
      if (s.status === 'canceled') continue;
      const roster = rosters.get(s.id) ?? [];
      const mine = roster.find((r) => r.player_id === me.id && r.status === 'confirmed' && r.payment_status === 'unpaid');
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
      });
    }
    if (!meIsOrganizer) {
      credit.balanceCents = potBalance(ledger, me.id);
      credit.usableCents = usableCredit(credit.balanceCents, reserved.get(me.id) ?? 0);
      const pending = (await loadPendingRequests(ctx.db, group.id)).find((r) => r.player_id === me.id);
      credit.pending = pending ? { id: pending.id, cents: pending.amount_cents, at: pending.created_at } : null;
      const startsOf = new Map(
        (await ctx.db.prepare('SELECT id, starts_at FROM sessions WHERE group_id = ?').bind(group.id).all<{ id: string; starts_at: string }>()).results.map((r) => [r.id, r.starts_at]),
      );
      credit.history = visibleEntries(ledger)
        .filter((e) => e.playerId === me.id && !e.endedAt)
        .map(
          (e): CreditEntryView => ({
            id: e.id,
            kind: e.kind,
            cents: e.cents,
            sessionId: e.sessionId,
            sessionStartsAt: e.sessionId ? (startsOf.get(e.sessionId) ?? null) : null,
            at: e.createdAt,
            endedAt: null,
            endedReason: null,
            reason: e.reason ?? null,
            playedCount: e.playedCount ?? null,
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
    },
    players: players.map((p) => ({ id: p.id, name: p.display_name })),
    me: me ? { id: me.id, name: me.display_name } : null,
    viewingAs: !!viewAsName,
    now: ctx.nowIso,
    // Upcoming sessions only. Money lives in the card at the top on game day.
    sessions: sessions
      .filter((s) => Date.parse(s.ends_at) > ctx.nowMs)
      .map((s) => playerSessionView(s, rosters.get(s.id) ?? [], me?.id ?? null, ctx.nowMs, settings, tz, meIsOrganizer, { usableCents: credit.usableCents, hasCredit: credit.balanceCents > 0 || !!credit.pending, seat: mySeat(s.id) })),
    owed,
    payDue: owed.filter((o) => {
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
  return name.toLowerCase().replace(/[^a-z\s'-]/g, '').replace(/\s+/g, ' ').trim();
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
  return res;
}

export async function playerWithdraw(ctx: Ctx) {
  const who = await actingOn(ctx);
  const watch = await watchTap(ctx, who.group, who.session, who.playerId);
  const res = await withdraw(ctx.db, who.group, who.session, who.playerId, ctx.nowMs);
  const late = res.freedSpot ? await recordLateDrop(ctx.db, who.session, who.playerId, ctx.nowMs, settingsOf(who.group)) : false;
  const result = res.changed ? 'withdrawn' : 'not_in_session';
  if (res.changed) await logAction(ctx, who, 'withdraw', result, { late });
  if (res.creditBackCents > 0) {
    const p = await ctx.db.prepare('SELECT display_name FROM players WHERE id = ?').bind(who.playerId).first<{ display_name: string }>();
    await audit(ctx.db, who.group.id, who.session.id, 'credit_back', { player: p?.display_name ?? 'A player', playerId: who.playerId, amountCents: res.creditBackCents, reason: 'dropped' }, ctx.nowIso);
  }
  await afterTap(ctx, watch);
  return { result, creditBackCents: res.creditBackCents };
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
  return applyPayment(ctx, who.group, who.session, who.playerId, paid, name, name);
}

/** POST /api/sessions/:id/use-credit: "Use credit" on a game they owe for. Never automatic. */
export async function playerUseCredit(ctx: Ctx) {
  const who = await actingOn(ctx);
  const p = await ctx.db.prepare('SELECT display_name FROM players WHERE id = ?').bind(who.playerId).first<{ display_name: string }>();
  return useCreditOn(ctx, who.group, who.session, who.playerId, p?.display_name ?? 'A player');
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
