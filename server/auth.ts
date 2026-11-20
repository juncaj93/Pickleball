import { ADMIN_COOKIE, type Ctx, PLAYER_COOKIE, setCookie } from './context';
import { withShortGames } from './zip9';
import { withCardCleanup } from './zip10';
import { newId, randomToken, sha256, timingSafeEqual, verifyPin } from './crypto';
import { HttpError } from './http';
import { type GroupRow, getGroup } from './repo';
import { asFewer } from './speed';
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
  const ip = ctx.req.headers.get('CF-Connecting-IP') ?? 'local';
  // Zip 50 review: a key can never look like Change PIN's own keys (sign-in skips those), whatever the header says.
  return ip.startsWith('pin-change:') ? `ip:${ip}` : ip;
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
       FROM login_attempts WHERE succeeded = 0 AND attempted_at > ? AND client_key NOT LIKE '${PIN_CHANGE_KEY}%'`,
    )
    .bind(clientKey(ctx), since)
    .first<{ mine: number | null; total: number }>();
  // Zip 50 (Audit C F-10, A-09): a phone that signed in with the real PIN before (it carries a valid "known organizer phone" mark)
  // skips the OVERALL cap, so a stranger sending wrong PINs cannot keep Alex's own phone from signing in. Its own cap of 5 still holds.
  const known = await isKnownOrganizerPhone(ctx, group);
  if ((counts?.mine ?? 0) > MAX_FAILS_PER_CLIENT || (!known && (counts?.total ?? 0) > MAX_FAILS_GLOBAL)) {
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
  if (ok) await markKnownOrganizerPhone(ctx, group.admin_pin_hash);
  return group;
}

/**
 * Zip 50 (Audit C F-10): the "known organizer phone" mark. A cookie set when the REAL PIN signs in (never the read-only one):
 * a random value plus a fingerprint of it made with the stored PIN hash, so nobody can make one without the PIN hash (which never
 * leaves the server or a real-PIN backup file), and every mark stops counting the moment the PIN changes. No database row and no new
 * variable. It only lets that phone past the overall wrong-PIN cap (20 in 15 minutes from everyone); it never skips the PIN itself or
 * the phone's own cap of 5.
 */
export const KNOWN_ORGANIZER_COOKIE = 'pb_known_org';
const KNOWN_ORGANIZER_DAYS = 400;

async function knownMark(pinHash: string, nonce: string): Promise<string> {
  return sha256(`known-organizer:${pinHash}:${nonce}`);
}

export async function markKnownOrganizerPhone(ctx: Ctx, pinHash: string) {
  const nonce = randomToken(18);
  setCookie(ctx, KNOWN_ORGANIZER_COOKIE, `${nonce}.${await knownMark(pinHash, nonce)}`, KNOWN_ORGANIZER_DAYS * 86_400, 'Strict');
}

export async function isKnownOrganizerPhone(ctx: Ctx, group: GroupRow): Promise<boolean> {
  const raw = ctx.cookies[KNOWN_ORGANIZER_COOKIE];
  if (!raw || raw.length > 200 || !group.admin_pin_hash) return false;
  const dot = raw.indexOf('.');
  if (dot <= 0) return false;
  return timingSafeEqual(raw.slice(dot + 1), await knownMark(group.admin_pin_hash, raw.slice(0, dot)));
}

/**
 * Zip 50 (Audit C F-5): Change PIN's own wrong-guess limit, for a phone that is already signed in. Its guesses go in the same
 * login_attempts table (no schema change) under their own key, `pin-change:` + this sign-in's stored hash, so:
 * - they NEVER count toward sign-in's limits (sign-in skips these keys above), so Change PIN can never lock anyone out of signing in
 *   or out of the organizer screens; only Change PIN itself waits;
 * - the limit is per signed-in phone: 5 wrong current PINs within 15 minutes, then Change PIN answers "wait" for 15 minutes (it does
 *   not even check the PIN while waiting, so waiting reveals nothing). Each guess is written down BEFORE the PIN is checked, so a burst
 *   of guesses at once still gets at most 5 checks. A right PIN clears the count.
 */
export const PIN_CHANGE_KEY = 'pin-change:';
export const PIN_CHANGE_MAX_FAILS = 5;
export const PIN_CHANGE_WINDOW_MS = LOCKOUT_WINDOW_MS;

/** Change PIN's current-PIN check, counted. Throws 429 while this phone must wait, 401 for a wrong PIN; returns when it is right. */
export async function checkCurrentPinCounted(ctx: Ctx, group: GroupRow, pin: unknown): Promise<void> {
  const token = ctx.cookies[ADMIN_COOKIE] ?? '';
  const key = PIN_CHANGE_KEY + (await sha256(`pin-change:${token}`));
  const attemptId = newId();
  await ctx.db.prepare('INSERT INTO login_attempts (id, client_key, succeeded, attempted_at) VALUES (?, ?, 0, ?)').bind(attemptId, key, ctx.realNowIso).run();
  const since = new Date(Date.parse(ctx.realNowIso) - PIN_CHANGE_WINDOW_MS).toISOString();
  const row = await ctx.db
    .prepare('SELECT COUNT(*) AS n FROM login_attempts WHERE client_key = ? AND succeeded = 0 AND attempted_at > ?')
    .bind(key, since)
    .first<{ n: number }>();
  if ((row?.n ?? 0) > PIN_CHANGE_MAX_FAILS) {
    // A refused try while waiting is not a guess, so it does not make the wait longer.
    await ctx.db.prepare('DELETE FROM login_attempts WHERE id = ?').bind(attemptId).run();
    throw new HttpError(429, 'locked_out', 'Too many wrong PINs. Wait 15 minutes and try again.');
  }
  const ok = typeof pin === 'string' && (await verifyPin(pin, group.admin_pin_hash));
  if (!ok) throw new HttpError(401, 'wrong_pin', 'Current PIN is not right.');
  await ctx.db.prepare('DELETE FROM login_attempts WHERE client_key = ?').bind(key).run();
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
  const check = ctx.db
    .prepare(
      `SELECT g.*, a.id AS admin_session_id FROM admin_sessions a JOIN groups g ON g.id = a.group_id
       WHERE a.token_hash = ? AND a.expires_at > ?`,
    )
    // Real time, even while pretending it's another time.
    .bind(await sha256(token), ctx.realNowIso);
  // Zip 68: while the "Fewer database trips" wrapper is on or still deciding, the switch rows every organizer screen reads next ride in this
  // same trip (server/speed.ts firstWithSwitches). With the wrapper off (or a database without it), the check alone, exactly as before.
  const fewer = asFewer(ctx.db);
  const row = await (fewer ? fewer.firstWithSwitches<GroupRow & { admin_session_id: string }>(check) : check.first<GroupRow & { admin_session_id: string }>());
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
