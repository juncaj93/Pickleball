import type { Ctx } from './context';
import type { D1Database } from './db';
import { newId } from './crypto';
import { LATE_FEE_SPLIT_HEADER, lateFeeSplitAllowed } from '../shared/lateFees';
import { lateFeesFor } from './lateFees';

// "Late-cancel fee split" (LATE_FEE_SPLIT, rules in shared/lateFees.ts). Only one tap reads it: the organizer's cancel inside
// the 12 hours answered "No" to "Did the venue waive the fee?". It needs "Late drops owe $14" (LATE_FEES) on for that tap.
// On for a request when:
//  - the LATE_FEE_SPLIT var (wrangler.toml) is not "off" (the kill switch, needs a deploy), and
//  - the organizer switched it on in Settings > Feature switches (for everyone), or this phone opened /admin?latefeesplit=on
//    (it then sends the X-Late-Fee-Split: on header: a private test switch for that phone only).
// The switch only decides how a NEW fee-kept cancel prices its seats. A game already canceled with the split keeps its split
// price (stored on the game) whatever the switch says later. "On for everyone" is one row in task_log (kind 'mark', task
// 'late_fee_split_on', no game): no schema change.

export const LATE_FEE_SPLIT_TASK = 'late_fee_split_on';

export async function lateFeeSplitForAll(db: D1Database, groupId: string): Promise<boolean> {
  const row = await db
    .prepare("SELECT 1 AS x FROM task_log WHERE group_id = ? AND session_id IS NULL AND task = ? AND kind = 'mark' LIMIT 1")
    .bind(groupId, LATE_FEE_SPLIT_TASK)
    .first()
    .catch(() => null);
  return !!row;
}

export async function setLateFeeSplitForAll(db: D1Database, groupId: string, on: boolean, nowIso: string): Promise<void> {
  await db.prepare("DELETE FROM task_log WHERE group_id = ? AND session_id IS NULL AND task = ? AND kind = 'mark'").bind(groupId, LATE_FEE_SPLIT_TASK).run();
  if (on) {
    await db.prepare("INSERT INTO task_log (id, group_id, session_id, task, kind, at) VALUES (?, ?, NULL, ?, 'mark', ?)").bind(newId(), groupId, LATE_FEE_SPLIT_TASK, nowIso).run();
  }
}

/** The split switch alone (everyone, or this phone's private link), ignoring LATE_FEES: for the Settings screen. */
export async function lateFeeSplitSwitch(ctx: Ctx, groupId: string): Promise<boolean> {
  if (!lateFeeSplitAllowed(ctx.env.LATE_FEE_SPLIT)) return false;
  if ((ctx.req.headers.get(LATE_FEE_SPLIT_HEADER) ?? '').toLowerCase() === 'on') return true;
  return lateFeeSplitForAll(ctx.db, groupId);
}

/** Does this request's fee-kept cancel split the fee? Needs LATE_FEES on for the same request. */
export async function lateFeeSplitFor(ctx: Ctx, groupId: string): Promise<boolean> {
  if (!(await lateFeesFor(ctx, groupId))) return false;
  return lateFeeSplitSwitch(ctx, groupId);
}
