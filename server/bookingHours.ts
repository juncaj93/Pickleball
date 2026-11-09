import type { Ctx } from './context';
import type { D1Database } from './db';
import { newId } from './crypto';
import { HttpError } from './http';
import { BOOKING_HOURS, bookingHoursAllowed, checkBookingTimes, checkUsualTime } from '../shared/bookingHours';

// Zip 24: BOOKING_HOURS (shared/bookingHours.ts). On for a request when:
//  - its wrangler.toml var is not "off" (the kill switch, needs a deploy), and
//  - the organizer switched it on in Settings > Feature switches (every organizer phone), or this phone opened /admin?bookinghours=on
//    (it then sends X-Booking-Hours: a private test switch for that phone only).
// "On for everyone" is one row in task_log (kind 'mark', no game): no schema change, the same way the other switches are stored.
// No price, seat, credit or text reads it. It only refuses a save, so the private link is safe on any phone.

/** The one switch question every feature switch asks, word for word (server/speed.ts answers it from one read when it can). */
const SWITCH_READ = "SELECT 1 AS x FROM task_log WHERE group_id = ? AND session_id IS NULL AND task = ? AND kind = 'mark' LIMIT 1";

async function forAll(db: D1Database, groupId: string): Promise<boolean> {
  const row = await db.prepare(SWITCH_READ).bind(groupId, BOOKING_HOURS.task).first().catch(() => null);
  return !!row;
}

/** The Settings row alone (no phone, no request). The kill switch is not visible there. */
export const bookingHoursForAll = (db: D1Database, groupId: string) => forAll(db, groupId);

export async function setBookingHoursForAll(db: D1Database, groupId: string, on: boolean, nowIso: string): Promise<void> {
  await db.prepare("DELETE FROM task_log WHERE group_id = ? AND session_id IS NULL AND task = ? AND kind = 'mark'").bind(groupId, BOOKING_HOURS.task).run();
  if (on) {
    await db.prepare("INSERT INTO task_log (id, group_id, session_id, task, kind, at) VALUES (?, ?, NULL, ?, 'mark', ?)").bind(newId(), groupId, BOOKING_HOURS.task, nowIso).run();
  }
}

/** The switch for this request, and the Settings row: one read of the row for both. `on`: the kill switch allows it and the row is on or this phone has the private test link. */
export async function bookingHoursFlags(ctx: Ctx, groupId: string): Promise<{ on: boolean; forAll: boolean }> {
  const row = await forAll(ctx.db, groupId);
  const header = (ctx.req.headers.get(BOOKING_HOURS.header) ?? '').toLowerCase() === 'on';
  return { on: bookingHoursAllowed(ctx.env.BOOKING_HOURS) && (header || row), forAll: row };
}

/** Refuses (400 invalid_time) a game's NEW start and end when they are outside the venue hours. Only called when a game is created or its times change. */
export async function enforceBookingHours(ctx: Ctx, groupId: string, tz: string, startsAt: string, endsAt: string): Promise<void> {
  if (!(await bookingHoursFlags(ctx, groupId)).on) return;
  const r = checkBookingTimes(startsAt, endsAt, tz);
  if (!r.ok) throw new HttpError(400, 'invalid_time', r.message);
}

/** The same for the usual game time (Settings > Schedule), minutes after midnight. Only called when that time is changed. */
export async function enforceUsualTime(ctx: Ctx, groupId: string, startMin: number, endMin: number): Promise<void> {
  if (!(await bookingHoursFlags(ctx, groupId)).on) return;
  const r = checkUsualTime(startMin, endMin);
  if (!r.ok) throw new HttpError(400, 'invalid_time', r.message);
}
