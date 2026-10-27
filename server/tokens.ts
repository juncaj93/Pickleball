import type { ActionTokenView } from '../shared/api';
import { openSpots } from '../shared/spots';
import type { Ctx } from './context';
import { newId, randomToken, sha256 } from './crypto';
import type { D1Database } from './db';
import { HttpError } from './http';
import { audit, confirmedOf, type GroupRow, loadRoster, type SessionRow, settingsOf, waitlistOf } from './repo';
import { clearLateDrop, confirmAttendance, joinSession, recordLateDrop, withdraw } from './roster';
import * as v from './validate';

export type TokenScope = 'attendance' | 'claim';

interface TokenRow {
  id: string;
  session_id: string;
  player_id: string;
  action_scope: TokenScope;
  expires_at: string;
  used_at: string | null;
}

/** Make a new link token. Only its SHA-256 hash is stored; the raw token goes into the text message. */
export async function issueToken(db: D1Database, session: SessionRow, playerId: string, scope: TokenScope, nowIso: string): Promise<string> {
  const token = randomToken();
  await db
    .prepare(
      `INSERT INTO session_action_tokens (id, session_id, player_id, token_hash, action_scope, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(newId(), session.id, playerId, await sha256(token), scope, session.starts_at, nowIso)
    .run();
  return token;
}

interface Resolved {
  token: TokenRow;
  session: SessionRow;
  group: GroupRow;
  playerName: string;
  playerActive: boolean;
}

async function resolve(ctx: Ctx, raw: unknown): Promise<Resolved> {
  if (typeof raw !== 'string' || !/^[A-Za-z0-9_-]{30,64}$/.test(raw)) {
    throw new HttpError(404, 'link_not_found', 'This link is not valid.');
  }
  const token = await ctx.db
    .prepare('SELECT * FROM session_action_tokens WHERE token_hash = ?')
    .bind(await sha256(raw))
    .first<TokenRow>();
  if (!token) throw new HttpError(404, 'link_not_found', 'This link is not valid.');
  const session = await ctx.db.prepare('SELECT * FROM sessions WHERE id = ?').bind(token.session_id).first<SessionRow>();
  const player = await ctx.db
    .prepare('SELECT display_name, is_active FROM players WHERE id = ?')
    .bind(token.player_id)
    .first<{ display_name: string; is_active: number }>();
  if (!session || !player) throw new HttpError(404, 'link_not_found', 'This link is not valid.');
  const group = await ctx.db.prepare('SELECT * FROM groups WHERE id = ?').bind(session.group_id).first<GroupRow>();
  if (!group) throw new HttpError(404, 'link_not_found', 'This link is not valid.');
  return { token, session, group, playerName: player.display_name, playerActive: !!player.is_active };
}

function invalidReason(r: Resolved, nowMs: number): string | null {
  if (!r.playerActive) return 'This link is no longer active.';
  if (r.session.status === 'canceled') return 'This session was canceled.';
  if (r.token.used_at) return 'This link was already used.';
  if (nowMs >= Date.parse(r.token.expires_at) || nowMs >= Date.parse(r.session.starts_at)) return 'This link has expired.';
  return null;
}

async function view(ctx: Ctx, r: Resolved): Promise<ActionTokenView> {
  const roster = await loadRoster(ctx.db, r.session.id);
  const mine = roster.find((x) => x.player_id === r.token.player_id) ?? null;
  const reason = invalidReason(r, ctx.nowMs);
  return {
    scope: r.token.action_scope,
    playerName: r.playerName,
    timezone: r.group.timezone,
    session: {
      id: r.session.id,
      startsAt: r.session.starts_at,
      endsAt: r.session.ends_at,
      canceled: r.session.status === 'canceled',
      venueName: r.session.venue_name,
      openSpots: openSpots(confirmedOf(roster).length, waitlistOf(roster).filter((w) => w.player_id !== r.token.player_id).length),
    },
    myStatus: mine?.status ?? null,
    attendanceConfirmed: !!mine?.attendance_confirmed_at,
    valid: reason === null,
    invalidReason: reason,
  };
}

export async function lookupToken(ctx: Ctx, body: Record<string, unknown>) {
  return view(ctx, await resolve(ctx, body.token));
}

const SCOPE_ACTIONS: Record<TokenScope, readonly string[]> = {
  attendance: ['confirm', 'withdraw'],
  claim: ['claim'],
};

/**
 * Act on a link. The player is whoever the token was issued to; nothing in
 * the request can point it at someone else.
 */
/** A tap on a texted link goes in the Activity log under the player's name. */
async function logLinkAction(ctx: Ctx, r: Resolved, action: string, result: string, extra: Record<string, unknown> = {}) {
  await audit(ctx.db, r.group.id, r.session.id, `player_${action}`, { player: r.playerName, result, via: 'link', ...extra }, ctx.nowIso, r.playerName);
}

export async function actOnToken(ctx: Ctx, body: Record<string, unknown>) {
  const r = await resolve(ctx, body.token);
  const action = v.oneOf(body.action, 'action', ['confirm', 'withdraw', 'claim'] as const);
  if (!SCOPE_ACTIONS[r.token.action_scope].includes(action)) {
    throw new HttpError(403, 'wrong_scope', "This link can't do that.");
  }
  const reason = invalidReason(r, ctx.nowMs);
  if (reason) throw new HttpError(410, 'link_invalid', reason);

  let outcome: string;
  if (action === 'confirm') {
    await confirmAttendance(ctx.db, r.session, r.token.player_id, ctx.nowMs);
    outcome = 'confirmed_attendance';
    await logLinkAction(ctx, r, 'check_in', outcome);
  } else if (action === 'withdraw') {
    // Burn the link first so a double tap can't withdraw twice.
    const burned = await ctx.db
      .prepare('UPDATE session_action_tokens SET used_at = ? WHERE id = ? AND used_at IS NULL')
      .bind(ctx.nowIso, r.token.id)
      .run();
    if (burned.meta.changes !== 1) throw new HttpError(410, 'link_invalid', 'This link was already used.');
    const res = await withdraw(ctx.db, r.session, r.token.player_id, ctx.nowMs);
    const late = res.freedSpot ? await recordLateDrop(ctx.db, r.session, r.token.player_id, ctx.nowMs, settingsOf(r.group).checkInHours) : false;
    outcome = 'withdrawn';
    if (res.changed) await logLinkAction(ctx, r, 'withdraw', outcome, { late });
  } else {
    const res = await joinSession(ctx.db, r.session, r.token.player_id, ctx.nowMs, 'claim_only');
    await clearLateDrop(ctx.db, r.session.id, r.token.player_id);
    if (res.result === 'spot_taken') {
      return { outcome: 'spot_taken', view: await view(ctx, r) };
    }
    await ctx.db
      .prepare('UPDATE session_action_tokens SET used_at = ? WHERE id = ? AND used_at IS NULL')
      .bind(ctx.nowIso, r.token.id)
      .run();
    outcome = res.result === 'already_confirmed' ? 'already_confirmed' : 'claimed';
    if (outcome === 'claimed') await logLinkAction(ctx, r, 'claim', outcome);
  }
  const fresh = await resolve(ctx, body.token);
  return { outcome, view: await view(ctx, fresh) };
}

export async function invalidateSessionTokens(db: D1Database, sessionId: string, nowIso: string) {
  await db
    .prepare('UPDATE session_action_tokens SET used_at = ? WHERE session_id = ? AND used_at IS NULL')
    .bind(nowIso, sessionId)
    .run();
}
