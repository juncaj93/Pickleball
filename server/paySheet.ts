import type { Ctx } from './context';
import type { D1Database } from './db';
import { newId } from './crypto';
import { PAY_SHEET_HEADER, paySheetAllowed } from '../shared/paySheet';

// "Pay sheet" (PAY_SHEET). On for a request when:
//  - the PAY_SHEET var (wrangler.toml) is not "off" (the kill switch, needs a deploy), and
//  - the organizer switched it on in Settings > Feature switches (for every player), or this phone opened the site with
//    ?paysheet=on (it then sends the X-Pay-Sheet: on header: a private test switch for that phone only).
// Display only. "On for everyone" is one row in task_log (kind 'mark', task 'pay_sheet_on', no game): no schema change,
// the same way "No Venmo? note" and "Player screen fixes" are stored.

const ALL_TASK = 'pay_sheet_on';

export async function paySheetForAll(db: D1Database, groupId: string): Promise<boolean> {
  const row = await db
    .prepare("SELECT 1 AS x FROM task_log WHERE group_id = ? AND session_id IS NULL AND task = ? AND kind = 'mark' LIMIT 1")
    .bind(groupId, ALL_TASK)
    .first()
    .catch(() => null);
  return !!row;
}

export async function setPaySheetForAll(db: D1Database, groupId: string, on: boolean, nowIso: string): Promise<void> {
  await db.prepare("DELETE FROM task_log WHERE group_id = ? AND session_id IS NULL AND task = ? AND kind = 'mark'").bind(groupId, ALL_TASK).run();
  if (on) {
    await db.prepare("INSERT INTO task_log (id, group_id, session_id, task, kind, at) VALUES (?, ?, NULL, ?, 'mark', ?)").bind(newId(), groupId, ALL_TASK, nowIso).run();
  }
}

/** Does the player screen open the Pay sheet for this request? */
export async function paySheetFor(ctx: Ctx, groupId: string): Promise<boolean> {
  if (!paySheetAllowed(ctx.env.PAY_SHEET)) return false;
  if ((ctx.req.headers.get(PAY_SHEET_HEADER) ?? '').toLowerCase() === 'on') return true;
  return paySheetForAll(ctx.db, groupId);
}
