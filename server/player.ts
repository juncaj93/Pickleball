import type { GroupView } from '../shared/api';
import { clearCookie, type Ctx, PLAYER_COOKIE } from './context';
import { currentPlayerId, forgetPlayer, rememberPlayer, requireGroupKey } from './auth';
import { HttpError } from './http';
import { ensureSessions, getPlayers, getSession, type GroupRow, loadRosters, loadSessions, settingsOf, sharesFor } from './repo';
import { confirmAttendance, joinSession, withdraw } from './roster';
import { playerSessionView } from './views';
import * as v from './validate';

const OWED_LOOKBACK_MS = 90 * 86_400_000;

export async function groupView(ctx: Ctx): Promise<GroupView> {
  const group = await requireGroupKey(ctx);
  await ensureSessions(ctx.db, group, ctx.nowMs);
  const settings = settingsOf(group);
  const meId = await currentPlayerId(ctx, group);
  const players = (await getPlayers(ctx.db, group.id)).filter((p) => p.is_active);
  const since = new Date(ctx.nowMs - OWED_LOOKBACK_MS).toISOString();
  const sessions = await loadSessions(ctx.db, group.id, since);
  const rosters = await loadRosters(ctx.db, group.id, since);
  const me = players.find((p) => p.id === meId) ?? null;

  const owed: GroupView['owed'] = [];
  if (me) {
    for (const s of sessions) {
      if (s.status === 'canceled' || ctx.nowMs < Date.parse(s.starts_at)) continue;
      const roster = rosters.get(s.id) ?? [];
      const mine = roster.find((r) => r.player_id === me.id && r.status === 'confirmed' && r.payment_status === 'unpaid');
      const share = mine ? sharesFor(s, roster).get(me.id) : undefined;
      if (share) owed.push({ sessionId: s.id, startsAt: s.starts_at, endsAt: s.ends_at, amountCents: share });
    }
  }

  return {
    group: { name: group.name, timezone: group.timezone, venmoUrl: group.venmo_url },
    players: players.map((p) => ({ id: p.id, name: p.display_name })),
    me: me ? { id: me.id, name: me.display_name } : null,
    now: ctx.nowIso,
    sessions: sessions
      .filter((s) => Date.parse(s.ends_at) > ctx.nowMs)
      .map((s) => playerSessionView(s, rosters.get(s.id) ?? [], me?.id ?? null, ctx.nowMs, settings)),
    owed,
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

async function meAndSession(ctx: Ctx): Promise<{ group: GroupRow; playerId: string; sessionId: string }> {
  const group = await requireGroupKey(ctx);
  const playerId = await currentPlayerId(ctx, group);
  if (!playerId) throw new HttpError(401, 'pick_name', 'Pick your name first.');
  return { group, playerId, sessionId: v.id(ctx.params.id, 'session') };
}

async function sessionFor(ctx: Ctx, group: GroupRow, sessionId: string) {
  const session = await getSession(ctx.db, group.id, sessionId);
  if (!session) throw new HttpError(404, 'session_not_found', 'Session not found.');
  return session;
}

export async function playerJoin(ctx: Ctx) {
  const { group, playerId, sessionId } = await meAndSession(ctx);
  return joinSession(ctx.db, await sessionFor(ctx, group, sessionId), playerId, ctx.nowMs, 'auto');
}

export async function playerWithdraw(ctx: Ctx) {
  const { group, playerId, sessionId } = await meAndSession(ctx);
  const res = await withdraw(ctx.db, await sessionFor(ctx, group, sessionId), playerId, ctx.nowMs);
  return { result: res.changed ? 'withdrawn' : 'not_in_session' };
}

export async function playerConfirm(ctx: Ctx) {
  const { group, playerId, sessionId } = await meAndSession(ctx);
  await confirmAttendance(ctx.db, await sessionFor(ctx, group, sessionId), playerId, ctx.nowMs);
  return { result: 'confirmed_attendance' };
}
