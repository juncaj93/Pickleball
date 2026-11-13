import type { Ctx } from './context';
import type { D1Database } from './db';
import { newId } from './crypto';
import { CHEAPER_FIX, cheaperFixAllowed } from '../shared/cheaperFix';

// Zip 39: CHEAPER_FIX ("Made cheaper after paying", shared/cheaperFix.ts), ships OFF. On for a request when:
//  - its wrangler.toml var is not "off" (the kill switch, needs a deploy), and
//  - the organizer switched it on in Settings > Feature switches (every phone), or this phone is signed in as the organizer and opened
//    /admin?cheaperfix=on (it then sends X-Cheaper-Fix: a private test switch for that phone only). It moves money, so a player's phone
//    never gets it from a link (the same rule as Short games): a player's own late drop follows the Settings row only.
// "On for everyone" is one row in task_log (kind 'mark', no game): no schema change, the same way the other switches are stored.

/** The one switch question every feature switch asks, word for word (server/speed.ts answers it from one read when it can). */
const SWITCH_READ = "SELECT 1 AS x FROM task_log WHERE group_id = ? AND session_id IS NULL AND task = ? AND kind = 'mark' LIMIT 1";

async function forAll(db: D1Database, groupId: string): Promise<boolean> {
  const row = await db.prepare(SWITCH_READ).bind(groupId, CHEAPER_FIX.task).first().catch(() => null);
  return !!row;
}

/** The Settings row alone (no phone, no request). The kill switch is not visible there. */
export const cheaperFixForAll = (db: D1Database, groupId: string) => forAll(db, groupId);

export async function setCheaperFixForAll(db: D1Database, groupId: string, on: boolean, nowIso: string): Promise<void> {
  await db.prepare("DELETE FROM task_log WHERE group_id = ? AND session_id IS NULL AND task = ? AND kind = 'mark'").bind(groupId, CHEAPER_FIX.task).run();
  if (on) {
    await db.prepare("INSERT INTO task_log (id, group_id, session_id, task, kind, at) VALUES (?, ?, NULL, ?, 'mark', ?)").bind(newId(), groupId, CHEAPER_FIX.task, nowIso).run();
  }
}

/**
 * Does this request follow the fix? `organizer`: the request is signed in as the organizer (requireAdmin), the only kind whose private
 * test link counts. Off by the kill switch: false whatever the row or the link says.
 */
export async function cheaperFixFor(ctx: Ctx, groupId: string, organizer: boolean): Promise<boolean> {
  if (!cheaperFixAllowed(ctx.env.CHEAPER_FIX)) return false;
  if (organizer && (ctx.req.headers.get(CHEAPER_FIX.header) ?? '').toLowerCase() === 'on') return true;
  return forAll(ctx.db, groupId);
}

/** The switch for this screen and the Settings row: `on` as cheaperFixFor for the organizer, `forAll` the row alone. */
export async function cheaperFixFlags(ctx: Ctx, groupId: string): Promise<{ on: boolean; forAll: boolean }> {
  const row = await forAll(ctx.db, groupId);
  const header = (ctx.req.headers.get(CHEAPER_FIX.header) ?? '').toLowerCase() === 'on';
  return { on: cheaperFixAllowed(ctx.env.CHEAPER_FIX) && (header || row), forAll: row };
}
