import type { GroupView } from '../shared/api';
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
  creditPlan,
  ensureSessions,
  getPlayers,
  getSession,
  type GroupRow,
  issueCredits,
  loadCredits,
  loadRosters,
  loadSessions,
  openCredits,
  pricesFor,
  settingsOf,
  usualDaysOf,
  visibleFrom,
  waitlistOf,
} from './repo';
import { holidayFor } from '../shared/holidays';
import { newId } from './crypto';
import { recentCount, recordEvent } from './rate';
import { clearLateDrop, confirmAttendance, decline, joinSession, recordLateDrop, withdraw } from './roster';
import { playerSessionView } from './views';
import { applyPayment } from './admin';
import * as v from './validate';

const OWED_LOOKBACK_MS = 90 * 86_400_000;
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

export async function groupView(ctx: Ctx): Promise<GroupView> {
  const { group, playerId: meId, viewAsName } = await viewer(ctx);
  await ensureSessions(ctx.db, group, ctx.nowMs);
  await issueCredits(ctx.db, group, ctx.nowMs);
  const settings = settingsOf(group);
  const tz = group.timezone;
  const allPlayers = await getPlayers(ctx.db, group.id);
  const players = allPlayers.filter((p) => p.is_active);
  const since = new Date(ctx.nowMs - OWED_LOOKBACK_MS).toISOString();
  const from = visibleFrom(group);
  const sessions = await loadSessions(ctx.db, group.id, since, from);
  const rosters = await loadRosters(ctx.db, group.id, since, from);
  const credits = await loadCredits(ctx.db, group.id);
  const plan = creditPlan(sessions, rosters, credits, settings);
  const me = (viewAsName ? allPlayers : players).find((p) => p.id === meId) ?? null;

  const owed: GroupView['owed'] = [];
  let suggestion: GroupView['suggestion'] = null;
  let creditBalanceCents = 0;
  if (me) {
    for (const s of sessions) {
      if (s.status === 'canceled') continue;
      const roster = rosters.get(s.id) ?? [];
      const mine = roster.find((r) => r.player_id === me.id && r.status === 'confirmed' && r.payment_status === 'unpaid');
      const price = mine ? pricesFor(s, roster, settings).get(me.id) : undefined;
      if (!price) continue;
      const credit = plan.get(`${s.id}:${me.id}`)?.cents ?? 0;
      if (price.cents - credit <= 0) continue;
      owed.push({
        sessionId: s.id,
        startsAt: s.starts_at,
        endsAt: s.ends_at,
        amountCents: price.cents - credit,
        creditCents: credit,
        discount: price.discount,
        reminder: ctx.nowMs >= Date.parse(s.ends_at) + DAY_MS,
      });
    }
    // Credit not yet matched to a session they've signed up for.
    const planned = new Set([...plan.values()].flatMap((p) => p.ids));
    creditBalanceCents = openCredits(credits)
      .filter((c) => c.playerId === me.id && !planned.has(c.id))
      .reduce((sum, c) => sum + c.amountCents, 0);
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
          joinAs: joinOutcome(confirmedOf(roster).length, waitlistOf(roster).length),
          holiday: holidayFor(s.starts_at, tz),
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
      creditCents: settings.creditCentsWhenSix,
    },
    players: players.map((p) => ({ id: p.id, name: p.display_name })),
    me: me ? { id: me.id, name: me.display_name } : null,
    viewingAs: !!viewAsName,
    now: ctx.nowIso,
    // Upcoming sessions only. Money lives in the card at the top on game day.
    sessions: sessions
      .filter((s) => Date.parse(s.ends_at) > ctx.nowMs)
      .map((s) =>
        playerSessionView(s, rosters.get(s.id) ?? [], me?.id ?? null, ctx.nowMs, settings, tz, me ? (plan.get(`${s.id}:${me.id}`)?.cents ?? 0) : 0),
      ),
    owed,
    payDue: owed.filter((o) => {
      const p = localParts(Date.parse(o.startsAt), tz);
      return ctx.nowMs >= zonedTimeToUtc(p.year, p.month, p.day, PAY_FROM_HOUR, 0, tz);
    }),
    creditBalanceCents,
    suggestion,
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
  // Spam guard: a few new names per phone per hour.
  if ((await recentCount(ctx, 'self_add', 3600_000)) >= SELF_ADDS_PER_HOUR) {
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
    if (err instanceof Error && /UNIQUE/i.test(err.message)) {
      throw new HttpError(409, 'name_taken', `Someone already uses "${name}". Add your last initial, like "${name} S."`);
    }
    throw err;
  }
  await recordEvent(ctx, 'self_add');
  await rememberPlayer(ctx, group, id);
  await audit(ctx.db, group.id, null, 'player_self_added', { name }, ctx.nowIso, 'player');
  return { result: 'added', me: { id, name } };
}

/** "Any preferred days?" right after adding a name. Only touches the player on this phone. */
export async function setMyDays(ctx: Ctx, body: Record<string, unknown>) {
  const { group, playerId } = await viewer(ctx);
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

async function actingOn(ctx: Ctx) {
  const who = await viewer(ctx);
  if (!who.playerId) throw new HttpError(401, 'pick_name', 'Pick your name first.');
  const session = await getSession(ctx.db, who.group.id, v.id(ctx.params.id, 'session'));
  if (!session) throw new HttpError(404, 'session_not_found', 'Session not found.');
  return { ...who, playerId: who.playerId, session };
}

/**
 * Every player tap goes in the History > Activity log under the player's
 * name. When the organizer acts through "View as...", it's logged as theirs.
 */
async function logAction(ctx: Ctx, who: Awaited<ReturnType<typeof actingOn>>, action: string, result: unknown, extra: Record<string, unknown> = {}) {
  if (who.viewAsName) {
    await audit(ctx.db, who.group.id, who.session.id, `as_player_${action}`, { player: who.viewAsName, result, ...extra }, ctx.nowIso, `organizer as ${who.viewAsName}`);
    return;
  }
  const p = await ctx.db.prepare('SELECT display_name FROM players WHERE id = ?').bind(who.playerId).first<{ display_name: string }>();
  const name = p?.display_name ?? 'A player';
  await audit(ctx.db, who.group.id, who.session.id, `player_${action}`, { player: name, result, ...extra }, ctx.nowIso, name);
}

export async function playerJoin(ctx: Ctx) {
  const who = await actingOn(ctx);
  const res = await joinSession(ctx.db, who.session, who.playerId, ctx.nowMs, 'auto');
  await clearLateDrop(ctx.db, who.session.id, who.playerId);
  if (res.result !== 'already_confirmed') await logAction(ctx, who, 'join', res.result);
  return res;
}

export async function playerWithdraw(ctx: Ctx) {
  const who = await actingOn(ctx);
  const res = await withdraw(ctx.db, who.session, who.playerId, ctx.nowMs);
  const late = res.freedSpot ? await recordLateDrop(ctx.db, who.session, who.playerId, ctx.nowMs, settingsOf(who.group).checkInHours) : false;
  const result = res.changed ? 'withdrawn' : 'not_in_session';
  if (res.changed) await logAction(ctx, who, 'withdraw', result, { late });
  return { result };
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
  return applyPayment(ctx, who.group, who.session, who.playerId, paid, name, who.viewAsName ? `organizer as ${who.viewAsName}` : name);
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
