import type { Ctx } from './context';
import type { D1Database } from './db';
import { newId } from './crypto';
import { VENMO_REQUEST_HEADER, venmoRequestAllowed } from '../shared/venmoRequest';

// "Venmo request" (VENMO_REQUEST). On for a request when:
//  - the VENMO_REQUEST var (wrangler.toml) is not "off" (the kill switch, needs a deploy), and
//  - the organizer switched it on in Settings > Feature switches, or this phone opened /admin with ?venmorequest=on
//    (it then sends the X-Venmo-Request: on header: a private test switch for that phone only).
// Organizer screens only; it only shows links. "On for everyone" is one row in task_log (task 'venmo_request_on'): no schema change.

export const VENMO_REQUEST_TASK = 'venmo_request_on';

export async function venmoRequestForAll(db: D1Database, groupId: string): Promise<boolean> {
  const row = await db
    .prepare("SELECT 1 AS x FROM task_log WHERE group_id = ? AND session_id IS NULL AND task = ? AND kind = 'mark' LIMIT 1")
    .bind(groupId, VENMO_REQUEST_TASK)
    .first()
    .catch(() => null);
  return !!row;
}

export async function setVenmoRequestForAll(db: D1Database, groupId: string, on: boolean, nowIso: string): Promise<void> {
  await db.prepare("DELETE FROM task_log WHERE group_id = ? AND session_id IS NULL AND task = ? AND kind = 'mark'").bind(groupId, VENMO_REQUEST_TASK).run();
  if (on) {
    await db.prepare("INSERT INTO task_log (id, group_id, session_id, task, kind, at) VALUES (?, ?, NULL, ?, 'mark', ?)").bind(newId(), groupId, VENMO_REQUEST_TASK, nowIso).run();
  }
}

/** Does this request's organizer screen show "Venmo request" links? */
export async function venmoRequestFor(ctx: Ctx, groupId: string): Promise<boolean> {
  if (!venmoRequestAllowed(ctx.env.VENMO_REQUEST)) return false;
  if ((ctx.req.headers.get(VENMO_REQUEST_HEADER) ?? '').toLowerCase() === 'on') return true;
  return venmoRequestForAll(ctx.db, groupId);
}
