import type { Ctx } from './context';
import type { D1Database } from './db';
import { newId } from './crypto';
import { ADMIN_V2_HEADER, adminV2Allowed } from '../shared/adminV2';

// "New admin layout" (ADMIN_V2): the organizer's new History, Money and Home screens.
// On for a request when:
//  - the ADMIN_V2 var (wrangler.toml) is not "off" (the kill switch, needs a deploy), and
//  - the organizer switched it on in Settings > Feature switches (for every organizer phone), or this phone opened
//    /admin?adminv2=on (it then sends the X-Admin-V2: on header: a private test switch for that phone only).
// Display only. "On for everyone" is one row in task_log (kind 'mark', task 'admin_v2_on', no game): no schema change,
// the same way "Ask for payment on every game" is stored.

const ALL_TASK = 'admin_v2_on';

export async function adminV2ForAll(db: D1Database, groupId: string): Promise<boolean> {
  const row = await db
    .prepare("SELECT 1 AS x FROM task_log WHERE group_id = ? AND session_id IS NULL AND task = ? AND kind = 'mark' LIMIT 1")
    .bind(groupId, ALL_TASK)
    .first()
    .catch(() => null);
  return !!row;
}

export async function setAdminV2ForAll(db: D1Database, groupId: string, on: boolean, nowIso: string): Promise<void> {
  await db.prepare("DELETE FROM task_log WHERE group_id = ? AND session_id IS NULL AND task = ? AND kind = 'mark'").bind(groupId, ALL_TASK).run();
  if (on) {
    await db.prepare("INSERT INTO task_log (id, group_id, session_id, task, kind, at) VALUES (?, ?, NULL, ?, 'mark', ?)").bind(newId(), groupId, ALL_TASK, nowIso).run();
  }
}

/** Does the organizer screen use the new layout for this request? */
export async function adminV2For(ctx: Ctx, groupId: string): Promise<boolean> {
  if (!adminV2Allowed(ctx.env.ADMIN_V2)) return false;
  if ((ctx.req.headers.get(ADMIN_V2_HEADER) ?? '').toLowerCase() === 'on') return true;
  return adminV2ForAll(ctx.db, groupId);
}
