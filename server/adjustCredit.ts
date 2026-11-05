import type { Ctx } from './context';
import type { D1Database } from './db';
import { newId } from './crypto';
import { ADJUST_CREDIT_HEADER, adjustCreditAllowed } from '../shared/adjustCredit';

// "Adjust credit" (ADJUST_CREDIT). On for a request when:
//  - the ADJUST_CREDIT var (wrangler.toml) is not "off" (the kill switch, needs a deploy), and
//  - the organizer switched it on in Settings > Feature switches, or this phone opened /admin with ?adjustcredit=on
//    (it then sends the X-Adjust-Credit: on header: a private test switch for that phone only).
// Organizer screens only. "On for everyone" is one row in task_log (kind 'mark', task 'adjust_credit_on', no game): no schema change.

export const ADJUST_CREDIT_TASK = 'adjust_credit_on';

export async function adjustCreditForAll(db: D1Database, groupId: string): Promise<boolean> {
  const row = await db
    .prepare("SELECT 1 AS x FROM task_log WHERE group_id = ? AND session_id IS NULL AND task = ? AND kind = 'mark' LIMIT 1")
    .bind(groupId, ADJUST_CREDIT_TASK)
    .first()
    .catch(() => null);
  return !!row;
}

export async function setAdjustCreditForAll(db: D1Database, groupId: string, on: boolean, nowIso: string): Promise<void> {
  await db.prepare("DELETE FROM task_log WHERE group_id = ? AND session_id IS NULL AND task = ? AND kind = 'mark'").bind(groupId, ADJUST_CREDIT_TASK).run();
  if (on) {
    await db.prepare("INSERT INTO task_log (id, group_id, session_id, task, kind, at) VALUES (?, ?, NULL, ?, 'mark', ?)").bind(newId(), groupId, ADJUST_CREDIT_TASK, nowIso).run();
  }
}

/** Does this request's organizer screen have "Adjust credit"? */
export async function adjustCreditFor(ctx: Ctx, groupId: string): Promise<boolean> {
  if (!adjustCreditAllowed(ctx.env.ADJUST_CREDIT)) return false;
  if ((ctx.req.headers.get(ADJUST_CREDIT_HEADER) ?? '').toLowerCase() === 'on') return true;
  return adjustCreditForAll(ctx.db, groupId);
}
