import type { Ctx } from './context';
import type { D1Database } from './db';
import { newId } from './crypto';
import { TIME_SHIFT_HEADER, timeShiftOn } from '../shared/timeShift';

// The moved-game notice (Still in / Can't make it), "Confirmed x of y" and the Edit game note are on when:
//  - the TIME_SHIFT var (wrangler.toml) is not "off" (the kill switch), and
//  - the organizer switched it on for everyone (Settings), or this phone opened the site with ?timeshift=on
//    (it then sends the X-Time-Shift: on header: a private test switch for that phone only), or this is the
//    organizer's in-browser demo (View as), which always shows it.
// The court look (tile borders, "~7 PM") does not depend on any of this. Either way Edit game keeps recording
// which time each player agreed to, so turning it on later asks exactly the right people.
// "On for everyone" is one row in task_log (kind 'mark', task 'time_shift_on', no game): no schema change.

const ALL_TASK = 'time_shift_on';

export async function timeShiftForAll(db: D1Database, groupId: string): Promise<boolean> {
  const row = await db
    .prepare("SELECT 1 AS x FROM task_log WHERE group_id = ? AND session_id IS NULL AND task = ? AND kind = 'mark' LIMIT 1")
    .bind(groupId, ALL_TASK)
    .first()
    .catch(() => null);
  return !!row;
}

export async function setTimeShiftForAll(db: D1Database, groupId: string, on: boolean, nowIso: string): Promise<void> {
  await db.prepare("DELETE FROM task_log WHERE group_id = ? AND session_id IS NULL AND task = ? AND kind = 'mark'").bind(groupId, ALL_TASK).run();
  if (on) {
    await db.prepare("INSERT INTO task_log (id, group_id, session_id, task, kind, at) VALUES (?, ?, NULL, ?, 'mark', ?)").bind(newId(), groupId, ALL_TASK, nowIso).run();
  }
}

/** Is the notice on for this request? */
export async function timeShiftFor(ctx: Ctx, groupId: string): Promise<boolean> {
  if (!timeShiftOn(ctx.env.TIME_SHIFT)) return false;
  if (ctx.env.SANDBOX) return true;
  if ((ctx.req.headers.get(TIME_SHIFT_HEADER) ?? '').toLowerCase() === 'on') return true;
  return timeShiftForAll(ctx.db, groupId);
}
