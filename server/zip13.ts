import type { Ctx } from './context';
import { ADMIN_COOKIE } from './context';
import type { D1Database } from './db';
import { newId, sha256 } from './crypto';
import { VIEW_ONLY_COOKIE_PREFIX, VIEW_ONLY_SESSION_PREFIX } from './viewOnly';
import { ZIP13, type Zip13Switch, zip13Allowed } from '../shared/zip13';

// Zip 13 (shared/zip13.ts): PLAYERS_REDO, SWAP_BUTTON and ADMIN_UNDO. Each is on for a request when:
//  - its wrangler.toml var is not "off" (the kill switch, needs a deploy), and
//  - the organizer switched it on in Settings > Feature switches (every organizer phone), or this phone opened /admin?playersredo=on,
//    ?swapbutton=on or ?adminundo=on (it then sends the matching header: a private test switch for that phone only).
// "On for everyone" is one row in task_log (kind 'mark', no game): no schema change, the same way the other switches are stored.
// None of the three changes a price, a seat, a credit, a text or who can sign in.

/** The one switch question every feature switch asks, word for word (server/speed.ts answers it from one read when it can). */
const SWITCH_READ = "SELECT 1 AS x FROM task_log WHERE group_id = ? AND session_id IS NULL AND task = ? AND kind = 'mark' LIMIT 1";

async function forAll(db: D1Database, groupId: string, which: Zip13Switch): Promise<boolean> {
  const row = await db.prepare(SWITCH_READ).bind(groupId, ZIP13[which].task).first().catch(() => null);
  return !!row;
}

/** The Settings row alone (no phone, no request). The kill switch is not visible there. */
export const zip13ForAll = (db: D1Database, groupId: string, which: Zip13Switch) => forAll(db, groupId, which);

export async function setZip13ForAll(db: D1Database, groupId: string, which: Zip13Switch, on: boolean, nowIso: string): Promise<void> {
  const task = ZIP13[which].task;
  await db.prepare("DELETE FROM task_log WHERE group_id = ? AND session_id IS NULL AND task = ? AND kind = 'mark'").bind(groupId, task).run();
  if (on) {
    await db.prepare("INSERT INTO task_log (id, group_id, session_id, task, kind, at) VALUES (?, ?, NULL, ?, 'mark', ?)").bind(newId(), groupId, task, nowIso).run();
  }
}

/**
 * The switch for this screen, and the Settings row: one read of the row for both. `on`: the kill switch allows it and the row is on or this
 * phone has the private test link.
 */
export async function zip13Flags(ctx: Ctx, groupId: string, which: Zip13Switch): Promise<{ on: boolean; forAll: boolean }> {
  const z = ZIP13[which];
  const row = await forAll(ctx.db, groupId, which);
  const header = (ctx.req.headers.get(z.header) ?? '').toLowerCase() === 'on';
  return { on: zip13Allowed(ctx.env[z.env]) && (header || row), forAll: row };
}

/** Only the switch for this screen (no Settings row needed). */
export async function zip13For(ctx: Ctx, groupId: string, which: Zip13Switch): Promise<boolean> {
  return (await zip13Flags(ctx, groupId, which)).on;
}

/**
 * Swap to Alex (SWAP_BUTTON) on a PLAYER page: is this phone signed in as the organizer with the real PIN right now? Reads the organizer's
 * own sign-in cookie the same way every organizer screen does (an unexpired admin_sessions row for this group). A phone without that cookie
 * (every player) costs no database trip and gets false. A read-only PIN helper is not the organizer here. Never signs anyone in or out.
 */
export async function organizerSignedIn(ctx: Ctx, groupId: string): Promise<boolean> {
  const token = ctx.cookies[ADMIN_COOKIE];
  if (!token || token.startsWith(VIEW_ONLY_COOKIE_PREFIX)) return false;
  const row = await ctx.db
    .prepare('SELECT id FROM admin_sessions WHERE token_hash = ? AND group_id = ? AND expires_at > ?')
    .bind(await sha256(token), groupId, ctx.realNowIso)
    .first<{ id: string }>()
    .catch(() => null);
  return !!row && !String(row.id).startsWith(VIEW_ONLY_SESSION_PREFIX);
}

/**
 * The player page's "Go to Admin" pill (SWAP_BUTTON): only for a phone signed in as the organizer, with the switch on. A phone with no
 * organizer cookie (every player) is answered first, with no database trip at all.
 */
export async function goToAdminFor(ctx: Ctx, groupId: string): Promise<boolean> {
  const token = ctx.cookies[ADMIN_COOKIE];
  if (!token || token.startsWith(VIEW_ONLY_COOKIE_PREFIX)) return false;
  if (!(await zip13For(ctx, groupId, 'swapButton'))) return false;
  return organizerSignedIn(ctx, groupId);
}
