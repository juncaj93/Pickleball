import { ADMIN_COOKIE, type Ctx, PLAYER_COOKIE, setCookie } from './context';
import { withShortGames } from './zip9';
import { withCardCleanup } from './zip10';
import { newId, randomToken, sha256, timingSafeEqual, verifyPin } from './crypto';
import { HttpError } from './http';
import { type GroupRow, getGroup } from './repo';
import {
  isWrite,
  readOnlyPin,
  VIEW_ONLY_ALLOWED_WRITES,
  VIEW_ONLY_COOKIE_PREFIX,
  VIEW_ONLY_MESSAGE,
  VIEW_ONLY_SESSION_HOURS,
  VIEW_ONLY_SESSION_PREFIX,
  viewOnlySessionPrefix,
} from './viewOnly';

const ADMIN_SESSION_DAYS = 30;
const LOCKOUT_WINDOW_MS = 15 * 60_000;
const MAX_FAILS_PER_CLIENT = 5;
const MAX_FAILS_GLOBAL = 20;

function clientKey(ctx: Ctx): string {
  return ctx.req.headers.get('CF-Connecting-IP') ?? 'local';
}

/**
 * The lockout lives in the database, so restarts and separate server
 * instances all share it. Each attempt is written down as a failure *before*
 * the PIN is checked, then counted. A burst of simultaneous guesses therefore
 * sees every other guess in the burst, and at most five PIN checks per
 * device (twenty overall) can happen in any 15 minutes.
 */
export async function adminLogin(ctx: Ctx, pin: string): Promise<GroupRow> {
  const group = await getGroup(ctx.db);
  if (!group) throw new HttpError(404, 'not_set_up', 'The group has not been set up yet.');
  const attemptId = newId();
  await ctx.db
    .prepare('INSERT INTO login_attempts (id, client_key, succeeded, attempted_at) VALUES (?, ?, 0, ?)')
    .bind(attemptId, clientKey(ctx), ctx.nowIso)
    .run();
  const since = new Date(ctx.nowMs - LOCKOUT_WINDOW_MS).toISOString();
  const counts = await ctx.db
    .prepare(
      `SELECT
         SUM(CASE WHEN client_key = ? THEN 1 ELSE 0 END) AS mine,
         COUNT(*) AS total
       FROM login_attempts WHERE succeeded = 0 AND attempted_at > ?`,
    )
    .bind(clientKey(ctx), since)
    .first<{ mine: number | null; total: number }>();
  if ((counts?.mine ?? 0) > MAX_FAILS_PER_CLIENT || (counts?.total ?? 0) > MAX_FAILS_GLOBAL) {
    // A blocked try isn't a guess, so it doesn't extend the lockout.
    await ctx.db.prepare('DELETE FROM login_attempts WHERE id = ?').bind(attemptId).run();
    throw new HttpError(429, 'locked_out', 'Too many wrong PINs. Wait 15 minutes and try again.');
  }

  const ok = await verifyPin(pin, group.admin_pin_hash);
  // The read-only PIN (server/viewOnly.ts) is only tried when the real one did not match, inside the same counted attempt,
  // so it shares every limit above. No secret = never accepted.
  const roPin = ok ? null : readOnlyPin(ctx.env);
  const viewOnly = roPin !== null && timingSafeEqual(pin, roPin);
  await ctx.db
    .prepare('DELETE FROM login_attempts WHERE attempted_at < ?')
    .bind(new Date(ctx.nowMs - 86_400_000).toISOString())
    .run();
  if (!ok && !viewOnly) throw new HttpError(401, 'wrong_pin', 'That PIN is not right.');
  await ctx.db.prepare('UPDATE login_attempts SET succeeded = 1 WHERE id = ?').bind(attemptId).run();
  await startAdminSession(ctx, group.id, viewOnly);
  return group;
}

/** `viewOnly`: a read-only sign-in (its own id and cookie prefix, 12 hours). Real sign-ins are exactly as before. */
export async function startAdminSession(ctx: Ctx, groupId: string, viewOnly = false) {
  const token = viewOnly ? VIEW_ONLY_COOKIE_PREFIX + randomToken() : randomToken();
  const seconds = viewOnly ? VIEW_ONLY_SESSION_HOURS * 3600 : ADMIN_SESSION_DAYS * 86_400;
  const expires = new Date(ctx.nowMs + seconds * 1000).toISOString();
  await ctx.db
    .prepare('INSERT INTO admin_sessions (id, group_id, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)')
    .bind(viewOnly ? (await viewOnlySessionPrefix(readOnlyPin(ctx.env) ?? '')) + newId() : newId(), groupId, await sha256(token), ctx.nowIso, expires)
    .run();
  setCookie(ctx, ADMIN_COOKIE, token, seconds, 'Strict');
}

/** Every admin route calls this first. Returns the group the admin manages. */
export async function requireAdmin(ctx: Ctx): Promise<GroupRow> {
  const token = ctx.cookies[ADMIN_COOKIE];
  if (!token) throw new HttpError(401, 'admin_required', 'Organizer PIN required.');
  const row = await ctx.db
    .prepare(
      `SELECT g.*, a.id AS admin_session_id FROM admin_sessions a JOIN groups g ON g.id = a.group_id
       WHERE a.token_hash = ? AND a.expires_at > ?`,
    )
    // Real time, even while pretending it's another time.
    .bind(await sha256(token), ctx.realNowIso)
    .first<GroupRow & { admin_session_id: string }>();
  if (!row) throw new HttpError(401, 'admin_required', 'Organizer PIN required.');
  const { admin_session_id: sessionId, ...group } = row;
  // A read-only sign-in (server/viewOnly.ts): the stored row and the cookie must agree, it only lives while the secret is set,
  // and it never saves (server/app.ts refuses writes first; this is the second lock).
  const viewOnly = String(sessionId).startsWith(VIEW_ONLY_SESSION_PREFIX);
  if (viewOnly !== token.startsWith(VIEW_ONLY_COOKIE_PREFIX)) throw new HttpError(401, 'admin_required', 'Organizer PIN required.');
  if (viewOnly) {
    // Only while the secret is set, and only for a sign-in made with the PIN the secret holds now (a changed PIN signs helpers out).
    const pin = readOnlyPin(ctx.env);
    if (!pin || !String(sessionId).startsWith(await viewOnlySessionPrefix(pin))) throw new HttpError(401, 'admin_required', 'Organizer PIN required.');
    if (isWrite(ctx.req.method) && !VIEW_ONLY_ALLOWED_WRITES.has(`${ctx.req.method} ${ctx.url.pathname}`)) {
      throw new HttpError(403, 'view_only', VIEW_ONLY_MESSAGE);
    }
  }
  return withCardCleanup(ctx, await withShortGames(ctx, group as GroupRow, true));
}

export async function adminLogout(ctx: Ctx) {
  const token = ctx.cookies[ADMIN_COOKIE];
  if (token) await ctx.db.prepare('DELETE FROM admin_sessions WHERE token_hash = ?').bind(await sha256(token)).run();
}

/** Sign out every organizer device (used after a PIN change). */
export async function revokeAdminSessions(ctx: Ctx, groupId: string) {
  await ctx.db.prepare('DELETE FROM admin_sessions WHERE group_id = ?').bind(groupId).run();
}

export const ACCESS_COOKIE = 'pb_access';

/** The group word as stored: SHA-256 of the trimmed, lowercased word. */
export async function hashGroupWord(word: string): Promise<string> {
  return sha256(`group-word:${word.trim().toLowerCase()}`);
}

/**
 * What a phone that typed the right group word keeps in its cookie. It
 * changes whenever the word changes or the private link is replaced, so
 * old phones get asked again.
 */
export async function accessToken(group: GroupRow): Promise<string> {
  return sha256(`access:${group.group_key}:${group.group_word_hash ?? ''}`);
}

/**
 * No group word, the word already entered on this phone, or a phone that
 * already picked a name (they're clearly in the group) all count.
 */
export async function hasGroupAccess(ctx: Ctx, group: GroupRow): Promise<boolean> {
  if (!group.group_word_hash) return true;
  const c = ctx.cookies[ACCESS_COOKIE];
  if (c && timingSafeEqual(c, await accessToken(group))) return true;
  return (await currentPlayerId(ctx, group)) !== null;
}

/**
 * Player routes. Two ways in:
 * - the private link's key, sent as a header (never a cookie, never in an
 *   API URL); always works
 * - the plain site address, when "Anyone with the site address can use it"
 *   is on; if a group word is set, the phone must have entered it once
 */
export async function requireGroupKey(ctx: Ctx): Promise<GroupRow> {
  const key = ctx.req.headers.get('X-Group-Key') ?? '';
  if (key) {
    if (!/^[A-Za-z0-9_-]{20,64}$/.test(key)) throw new HttpError(404, 'group_not_found', 'This group link is not valid.');
    const group = await ctx.db.prepare('SELECT * FROM groups WHERE group_key = ?').bind(key).first<GroupRow>();
    if (!group) throw new HttpError(404, 'group_not_found', 'This group link is not valid.');
    return withCardCleanup(ctx, await withShortGames(ctx, group));
  }
  const group = await getGroup(ctx.db);
  if (!group || !group.open_access) throw new HttpError(404, 'group_not_found', 'Open the link your organizer sent you.');
  if (!(await hasGroupAccess(ctx, group))) throw new HttpError(403, 'group_word_required', 'Enter the group word.');
  return withCardCleanup(ctx, await withShortGames(ctx, group));
}

/** Which saved name this phone picked. Comes from an HttpOnly cookie, not from the request body. */
export async function currentPlayerId(ctx: Ctx, group: GroupRow): Promise<string | null> {
  const token = ctx.cookies[PLAYER_COOKIE];
  if (!token) return null;
  const row = await ctx.db
    .prepare(
      `SELECT d.player_id FROM player_devices d JOIN players p ON p.id = d.player_id
       WHERE d.token_hash = ? AND d.group_id = ? AND p.is_active = 1`,
    )
    .bind(await sha256(token), group.id)
    .first<{ player_id: string }>();
  return row?.player_id ?? null;
}

export async function rememberPlayer(ctx: Ctx, group: GroupRow, playerId: string) {
  const old = ctx.cookies[PLAYER_COOKIE];
  if (old) await ctx.db.prepare('DELETE FROM player_devices WHERE token_hash = ?').bind(await sha256(old)).run();
  const token = randomToken();
  await ctx.db
    .prepare('INSERT INTO player_devices (id, group_id, player_id, token_hash, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(newId(), group.id, playerId, await sha256(token), ctx.nowIso)
    .run();
  setCookie(ctx, PLAYER_COOKIE, token, 365 * 86_400, 'Lax');
}

export async function forgetPlayer(ctx: Ctx) {
  const old = ctx.cookies[PLAYER_COOKIE];
  if (old) await ctx.db.prepare('DELETE FROM player_devices WHERE token_hash = ?').bind(await sha256(old)).run();
}
