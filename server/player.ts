import type { GroupView } from '../shared/api';
import { sessionCalendar } from '../shared/calendar';
import { DEFAULT_VENUE_NAME } from '../shared/settings';
import { joinOutcome } from '../shared/spots';
import { localParts } from '../shared/time';
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
  loadRosters,
  loadSessions,
  settingsOf,
  sharesFor,
  usualDaysOf,
  waitlistOf,
} from './repo';
import { confirmAttendance, decline, joinSession, withdraw } from './roster';
import { playerSessionView } from './views';
import * as v from './validate';

const OWED_LOOKBACK_MS = 90 * 86_400_000;
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
async function viewer(ctx: Ctx): Promise<Viewer> {
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
  const settings = settingsOf(group);
  const allPlayers = await getPlayers(ctx.db, group.id);
  const players = allPlayers.filter((p) => p.is_active);
  const since = new Date(ctx.nowMs - OWED_LOOKBACK_MS).toISOString();
  const sessions = await loadSessions(ctx.db, group.id, since);
  const rosters = await loadRosters(ctx.db, group.id, since);
  const me = (viewAsName ? allPlayers : players).find((p) => p.id === meId) ?? null;

  const owed: GroupView['owed'] = [];
  let suggestion: GroupView['suggestion'] = null;
  if (me) {
    for (const s of sessions) {
      if (s.status === 'canceled') continue;
      const roster = rosters.get(s.id) ?? [];
      const mine = roster.find((r) => r.player_id === me.id && r.status === 'confirmed' && r.payment_status === 'unpaid');
      const share = mine ? sharesFor(s, roster, settings).get(me.id) : undefined;
      if (share) {
        owed.push({
          sessionId: s.id,
          startsAt: s.starts_at,
          endsAt: s.ends_at,
          amountCents: share,
          reminder: ctx.nowMs >= Date.parse(s.ends_at) + DAY_MS,
        });
      }
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
          joinAs: joinOutcome(confirmedOf(roster).length, waitlistOf(roster).length),
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
    },
    players: players.map((p) => ({ id: p.id, name: p.display_name })),
    me: me ? { id: me.id, name: me.display_name } : null,
    viewingAs: !!viewAsName,
    now: ctx.nowIso,
    sessions: sessions
      .filter((s) => Date.parse(s.ends_at) > ctx.nowMs)
      .map((s) => playerSessionView(s, rosters.get(s.id) ?? [], me?.id ?? null, ctx.nowMs, settings)),
    owed,
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

/** When the organizer acts through "View as...", the change is real and logged as theirs. */
async function logIfViewingAs(ctx: Ctx, who: Awaited<ReturnType<typeof actingOn>>, action: string, result: unknown) {
  if (!who.viewAsName) return;
  await audit(ctx.db, who.group.id, who.session.id, `as_player_${action}`, { player: who.viewAsName, result }, ctx.nowIso, `organizer as ${who.viewAsName}`);
}

export async function playerJoin(ctx: Ctx) {
  const who = await actingOn(ctx);
  const res = await joinSession(ctx.db, who.session, who.playerId, ctx.nowMs, 'auto');
  await logIfViewingAs(ctx, who, 'join', res.result);
  return res;
}

export async function playerWithdraw(ctx: Ctx) {
  const who = await actingOn(ctx);
  const res = await withdraw(ctx.db, who.session, who.playerId, ctx.nowMs);
  const result = res.changed ? 'withdrawn' : 'not_in_session';
  await logIfViewingAs(ctx, who, 'withdraw', result);
  return { result };
}

export async function playerConfirm(ctx: Ctx) {
  const who = await actingOn(ctx);
  await confirmAttendance(ctx.db, who.session, who.playerId, ctx.nowMs);
  await logIfViewingAs(ctx, who, 'check_in', 'confirmed_attendance');
  return { result: 'confirmed_attendance' };
}

export async function playerDecline(ctx: Ctx) {
  const who = await actingOn(ctx);
  await decline(ctx.db, who.session, who.playerId, ctx.nowMs);
  await logIfViewingAs(ctx, who, 'decline', 'declined');
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
  const body = sessionCalendar({ id: session.id, startsAt: session.starts_at, endsAt: session.ends_at, location, nowIso: ctx.nowIso });
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
