import type { Ctx } from './context';
import type { D1Database } from './db';
import { newId } from './crypto';
import { SEAT_DOTS_HEADER, seatDotsAllowed } from '../shared/seatDots';

// Seat dots: SEAT_DOTS (shared/seatDots.ts). On for a request when:
//  - its wrangler.toml var is not "off" (the kill switch, needs a deploy), and
//  - the organizer switched it on in Settings > Feature switches (every phone), or this phone opened the site with ?seatdots=on
//    (it then sends X-Seat-Dots: a private test switch for that phone only).
// "On for everyone" is one row in task_log (kind 'mark', no game): no schema change, the same way the other switches are stored.
// Display only: no price, seat, credit or text reads it, so the private link is safe on any phone.

export const SEAT_DOTS_TASK = 'seat_dots_on';

async function forAll(db: D1Database, groupId: string): Promise<boolean> {
  const row = await db
    .prepare("SELECT 1 AS x FROM task_log WHERE group_id = ? AND session_id IS NULL AND task = ? AND kind = 'mark' LIMIT 1")
    .bind(groupId, SEAT_DOTS_TASK)
    .first()
    .catch(() => null);
  return !!row;
}

/** The Settings row alone (no phone, no request). The kill switch is not visible there. */
export const seatDotsForAll = (db: D1Database, groupId: string) => forAll(db, groupId);

export async function setSeatDotsForAll(db: D1Database, groupId: string, on: boolean, nowIso: string): Promise<void> {
  await db.prepare("DELETE FROM task_log WHERE group_id = ? AND session_id IS NULL AND task = ? AND kind = 'mark'").bind(groupId, SEAT_DOTS_TASK).run();
  if (on) {
    await db.prepare("INSERT INTO task_log (id, group_id, session_id, task, kind, at) VALUES (?, ?, NULL, ?, 'mark', ?)").bind(newId(), groupId, SEAT_DOTS_TASK, nowIso).run();
  }
}

/** "Seat dots" for this screen: the kill switch allows it, and the Settings row is on or this phone has the private test link. */
export async function seatDotsFor(ctx: Ctx, groupId: string): Promise<boolean> {
  if (!seatDotsAllowed(ctx.env.SEAT_DOTS)) return false;
  if ((ctx.req.headers.get(SEAT_DOTS_HEADER) ?? '').toLowerCase() === 'on') return true;
  return forAll(ctx.db, groupId);
}
