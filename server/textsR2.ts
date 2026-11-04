import type { Ctx } from './context';
import type { D1Database } from './db';
import { newId } from './crypto';
import { TEXTS_R2_HEADER, textsR2Allowed } from '../shared/textsR2';

// "Texts and Telegram alerts, round 2" (TEXTS_R2). The new wording of every prefilled text, the new wording and timing of
// the Telegram alerts, and the cancel sheet answering No to "Did the venue waive the fee?" until you change it.
// On for a request when:
//  - the TEXTS_R2 var (wrangler.toml) is not "off" (the kill switch, needs a deploy), and
//  - the organizer switched it on in Settings > Feature switches (for everyone), or this phone opened /admin?textsr2=on
//    (it then sends the X-Texts-R2: on header: a private test switch for that phone only, texts and the cancel sheet only).
// The Telegram alerts and the 5-minute clock follow the switch for EVERYONE only (never one phone's private link), because
// they are not tied to a phone. No money rule, amount or saved record depends on it. "On for everyone" is one row in
// task_log (kind 'mark', task 'texts_r2_on', no game): no schema change, the same way the other switches are stored.

export const TEXTS_R2_TASK = 'texts_r2_on';

export async function textsR2ForAll(db: D1Database, groupId: string): Promise<boolean> {
  const row = await db
    .prepare("SELECT 1 AS x FROM task_log WHERE group_id = ? AND session_id IS NULL AND task = ? AND kind = 'mark' LIMIT 1")
    .bind(groupId, TEXTS_R2_TASK)
    .first()
    .catch(() => null);
  return !!row;
}

export async function setTextsR2ForAll(db: D1Database, groupId: string, on: boolean, nowIso: string): Promise<void> {
  await db.prepare("DELETE FROM task_log WHERE group_id = ? AND session_id IS NULL AND task = ? AND kind = 'mark'").bind(groupId, TEXTS_R2_TASK).run();
  if (on) {
    await db.prepare("INSERT INTO task_log (id, group_id, session_id, task, kind, at) VALUES (?, ?, NULL, ?, 'mark', ?)").bind(newId(), groupId, TEXTS_R2_TASK, nowIso).run();
  }
}

/** Do the organizer's screens on this request use the new texts and the No default? (everyone, or this phone's private link) */
export async function textsR2For(ctx: Ctx, groupId: string): Promise<boolean> {
  if (!textsR2Allowed(ctx.env.TEXTS_R2)) return false;
  if ((ctx.req.headers.get(TEXTS_R2_HEADER) ?? '').toLowerCase() === 'on') return true;
  return textsR2ForAll(ctx.db, groupId);
}

/** Do the Telegram alerts use the new wording and timing? On for everyone only; a private link never changes an alert. */
export async function textsR2ForAlerts(ctx: Pick<Ctx, 'env' | 'db'>, groupId: string): Promise<boolean> {
  if (!textsR2Allowed(ctx.env.TEXTS_R2)) return false;
  return textsR2ForAll(ctx.db, groupId);
}
