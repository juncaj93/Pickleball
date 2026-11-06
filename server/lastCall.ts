import type { Ctx } from './context';
import type { D1Database } from './db';
import { newId } from './crypto';
import { LAST_CALL_HEADER, lastCallAllowed } from '../shared/lastCall';

// "Last call texts" (LAST_CALL_TEXTS, Zip 8, shared/lastCall.ts). On for a request when:
//  - the LAST_CALL_TEXTS var (wrangler.toml) is not "off" (the kill switch, needs a deploy), and
//  - the organizer switched it on in Settings > Feature switches, or this phone opened /admin?lastcall=on (it then sends the
//    X-Last-Call: on header: a private test switch for that phone only).
// Words only: nothing saved, charged or sent depends on it. "On for everyone" is one row in task_log (kind 'mark', task
// 'last_call_texts_on', no game): no schema change, the same way the other switches are stored.

export const LAST_CALL_TASK = 'last_call_texts_on';

export async function lastCallForAll(db: D1Database, groupId: string): Promise<boolean> {
  const row = await db
    .prepare("SELECT 1 AS x FROM task_log WHERE group_id = ? AND session_id IS NULL AND task = ? AND kind = 'mark' LIMIT 1")
    .bind(groupId, LAST_CALL_TASK)
    .first()
    .catch(() => null);
  return !!row;
}

export async function setLastCallForAll(db: D1Database, groupId: string, on: boolean, nowIso: string): Promise<void> {
  await db.prepare("DELETE FROM task_log WHERE group_id = ? AND session_id IS NULL AND task = ? AND kind = 'mark'").bind(groupId, LAST_CALL_TASK).run();
  if (on) {
    await db.prepare("INSERT INTO task_log (id, group_id, session_id, task, kind, at) VALUES (?, ?, NULL, ?, 'mark', ?)").bind(newId(), groupId, LAST_CALL_TASK, nowIso).run();
  }
}

/** Does this request get the new last call words? */
export async function lastCallFor(ctx: Ctx, groupId: string): Promise<boolean> {
  if (!lastCallAllowed(ctx.env.LAST_CALL_TEXTS)) return false;
  if ((ctx.req.headers.get(LAST_CALL_HEADER) ?? '').toLowerCase() === 'on') return true;
  return lastCallForAll(ctx.db, groupId);
}
