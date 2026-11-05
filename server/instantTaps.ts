import type { Ctx } from './context';
import type { D1Database } from './db';
import { newId } from './crypto';
import { INSTANT_TAPS_HEADER, instantTapsAllowed } from '../shared/instantTaps';

// "Instant taps" (INSTANT_TAPS). On for a request when:
//  - the INSTANT_TAPS var (wrangler.toml) is not "off" (the kill switch, needs a deploy), and
//  - the organizer switched it on in Settings > Feature switches (for every phone, player and organizer), or this phone opened the
//    site with ?instanttaps=on (it then sends the X-Instant-Taps: on header: a private test switch for that phone only).
// Tap feedback only: the server does exactly the same work either way. "On for everyone" is one row in task_log (kind 'mark', task
// 'instant_taps_on', no game): no schema change, the same way the other switches are stored.

export const INSTANT_TAPS_TASK = 'instant_taps_on';

export async function instantTapsForAll(db: D1Database, groupId: string): Promise<boolean> {
  const row = await db
    .prepare("SELECT 1 AS x FROM task_log WHERE group_id = ? AND session_id IS NULL AND task = ? AND kind = 'mark' LIMIT 1")
    .bind(groupId, INSTANT_TAPS_TASK)
    .first()
    .catch(() => null);
  return !!row;
}

export async function setInstantTapsForAll(db: D1Database, groupId: string, on: boolean, nowIso: string): Promise<void> {
  await db.prepare("DELETE FROM task_log WHERE group_id = ? AND session_id IS NULL AND task = ? AND kind = 'mark'").bind(groupId, INSTANT_TAPS_TASK).run();
  if (on) {
    await db.prepare("INSERT INTO task_log (id, group_id, session_id, task, kind, at) VALUES (?, ?, NULL, ?, 'mark', ?)").bind(newId(), groupId, INSTANT_TAPS_TASK, nowIso).run();
  }
}

/** Do this request's screens use instant taps? */
export async function instantTapsFor(ctx: Ctx, groupId: string): Promise<boolean> {
  if (!instantTapsAllowed(ctx.env.INSTANT_TAPS)) return false;
  if ((ctx.req.headers.get(INSTANT_TAPS_HEADER) ?? '').toLowerCase() === 'on') return true;
  return instantTapsForAll(ctx.db, groupId);
}
