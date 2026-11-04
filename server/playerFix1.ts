import type { Ctx } from './context';
import type { D1Database } from './db';
import { newId } from './crypto';
import { PLAYER_FIX1_HEADER, playerFix1Allowed } from '../shared/playerFix1';

// "Player screen small fixes, round 1" (PLAYER_FIX1). On for a request when:
//  - the PLAYER_FIX1 var (wrangler.toml) is not "off" (the kill switch, needs a deploy), and
//  - the organizer switched it on in Settings > Feature switches (for every player), or this phone opened the site with
//    ?playerfix1=on (it then sends the X-Player-Fix1: on header: a private test switch for that phone only).
// Display only. "On for everyone" is one row in task_log (kind 'mark', task 'player_fix1_on', no game): no schema change,
// the same way "No Venmo? note" and "New admin layout" are stored.

const ALL_TASK = 'player_fix1_on';

export async function playerFix1ForAll(db: D1Database, groupId: string): Promise<boolean> {
  const row = await db
    .prepare("SELECT 1 AS x FROM task_log WHERE group_id = ? AND session_id IS NULL AND task = ? AND kind = 'mark' LIMIT 1")
    .bind(groupId, ALL_TASK)
    .first()
    .catch(() => null);
  return !!row;
}

export async function setPlayerFix1ForAll(db: D1Database, groupId: string, on: boolean, nowIso: string): Promise<void> {
  await db.prepare("DELETE FROM task_log WHERE group_id = ? AND session_id IS NULL AND task = ? AND kind = 'mark'").bind(groupId, ALL_TASK).run();
  if (on) {
    await db.prepare("INSERT INTO task_log (id, group_id, session_id, task, kind, at) VALUES (?, ?, NULL, ?, 'mark', ?)").bind(newId(), groupId, ALL_TASK, nowIso).run();
  }
}

/** Does the player screen use the PLAYER_FIX1 layout for this request? */
export async function playerFix1For(ctx: Ctx, groupId: string): Promise<boolean> {
  if (!playerFix1Allowed(ctx.env.PLAYER_FIX1)) return false;
  if ((ctx.req.headers.get(PLAYER_FIX1_HEADER) ?? '').toLowerCase() === 'on') return true;
  return playerFix1ForAll(ctx.db, groupId);
}
