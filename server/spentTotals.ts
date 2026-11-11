import type { Ctx } from './context';
import type { D1Database } from './db';
import { newId } from './crypto';
import { SPENT_TOTALS, spentTotalsAllowed } from '../shared/spentTotals';

// Zip 27: SPENT_TOTALS (shared/spentTotals.ts, Audit A item A-05). On for a request when:
//  - its wrangler.toml var is not "off" (the kill switch, needs a deploy), and
//  - the organizer switched it on in Settings > Feature switches (every organizer phone), or this phone opened /admin?spenttotals=on
//    (it then sends X-Spent-Totals: a private test switch for that phone only).
// "On for everyone" is one row in task_log (kind 'mark', no game): no schema change, the same way the other switches are stored.
// Display only: no price, seat, credit or text reads it, so the private link is safe on any phone.

/** The one switch question every feature switch asks, word for word (server/speed.ts answers it from one read when it can). */
const SWITCH_READ = "SELECT 1 AS x FROM task_log WHERE group_id = ? AND session_id IS NULL AND task = ? AND kind = 'mark' LIMIT 1";

async function forAll(db: D1Database, groupId: string): Promise<boolean> {
  const row = await db.prepare(SWITCH_READ).bind(groupId, SPENT_TOTALS.task).first().catch(() => null);
  return !!row;
}

/** The Settings row alone (no phone, no request). The kill switch is not visible there. */
export const spentTotalsForAll = (db: D1Database, groupId: string) => forAll(db, groupId);

export async function setSpentTotalsForAll(db: D1Database, groupId: string, on: boolean, nowIso: string): Promise<void> {
  await db.prepare("DELETE FROM task_log WHERE group_id = ? AND session_id IS NULL AND task = ? AND kind = 'mark'").bind(groupId, SPENT_TOTALS.task).run();
  if (on) {
    await db.prepare("INSERT INTO task_log (id, group_id, session_id, task, kind, at) VALUES (?, ?, NULL, ?, 'mark', ?)").bind(newId(), groupId, SPENT_TOTALS.task, nowIso).run();
  }
}

/** The switch for this screen, and the Settings row: one read of the row for both. `on`: the kill switch allows it and the row is on or this phone has the private test link. */
export async function spentTotalsFlags(ctx: Ctx, groupId: string): Promise<{ on: boolean; forAll: boolean }> {
  const row = await forAll(ctx.db, groupId);
  const header = (ctx.req.headers.get(SPENT_TOTALS.header) ?? '').toLowerCase() === 'on';
  return { on: spentTotalsAllowed(ctx.env.SPENT_TOTALS) && (header || row), forAll: row };
}
