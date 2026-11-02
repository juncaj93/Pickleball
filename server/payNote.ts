import type { Ctx } from './context';
import type { D1Database } from './db';
import { newId } from './crypto';
import { PAY_NOTE_HEADER, payNoteAllowed } from '../shared/payNote';

// "No Venmo? Pay Alex directly" (PAY_NOTE). On for a request when:
//  - the PAY_NOTE var (wrangler.toml) is not "off" (the kill switch, needs a deploy), and
//  - the organizer switched it on in Settings > Feature switches (for every player), or this phone opened the site with
//    ?paynote=on (it then sends the X-Pay-Note: on header: a private test switch for that phone only).
// Display only. "On for everyone" is one row in task_log (kind 'mark', task 'pay_note_on', no game): no schema change,
// the same way "Ask for payment on every game" and "New admin layout" are stored.

const ALL_TASK = 'pay_note_on';

export async function payNoteForAll(db: D1Database, groupId: string): Promise<boolean> {
  const row = await db
    .prepare("SELECT 1 AS x FROM task_log WHERE group_id = ? AND session_id IS NULL AND task = ? AND kind = 'mark' LIMIT 1")
    .bind(groupId, ALL_TASK)
    .first()
    .catch(() => null);
  return !!row;
}

export async function setPayNoteForAll(db: D1Database, groupId: string, on: boolean, nowIso: string): Promise<void> {
  await db.prepare("DELETE FROM task_log WHERE group_id = ? AND session_id IS NULL AND task = ? AND kind = 'mark'").bind(groupId, ALL_TASK).run();
  if (on) {
    await db.prepare("INSERT INTO task_log (id, group_id, session_id, task, kind, at) VALUES (?, ?, NULL, ?, 'mark', ?)").bind(newId(), groupId, ALL_TASK, nowIso).run();
  }
}

/** Does the player screen show the "No Venmo?" note for this request? */
export async function payNoteFor(ctx: Ctx, groupId: string): Promise<boolean> {
  if (!payNoteAllowed(ctx.env.PAY_NOTE)) return false;
  if ((ctx.req.headers.get(PAY_NOTE_HEADER) ?? '').toLowerCase() === 'on') return true;
  return payNoteForAll(ctx.db, groupId);
}
