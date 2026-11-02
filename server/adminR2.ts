import type { Ctx } from './context';
import type { D1Database } from './db';
import { newId } from './crypto';
import { ADMIN_R2_HEADER, adminR2Allowed } from '../shared/adminR2';

// "Admin screens, round 2" (ADMIN_R2): the organizer's new Home cards, Money, Players, History and header.
// On for a request when:
//  - the ADMIN_R2 var (wrangler.toml) is not "off" (the kill switch, needs a deploy), and
//  - the organizer switched it on in Settings > Feature switches (for every organizer phone), or this phone opened
//    /admin?adminr2=on (it then sends the X-Admin-R2: on header: a private test switch for that phone only).
// Display only. "On for everyone" is one row in task_log (kind 'mark', task 'admin_r2_on', no game): no schema change,
// the same way "New admin layout" and "Ask for payment on every game" are stored.

const ALL_TASK = 'admin_r2_on';

export async function adminR2ForAll(db: D1Database, groupId: string): Promise<boolean> {
  const row = await db
    .prepare("SELECT 1 AS x FROM task_log WHERE group_id = ? AND session_id IS NULL AND task = ? AND kind = 'mark' LIMIT 1")
    .bind(groupId, ALL_TASK)
    .first()
    .catch(() => null);
  return !!row;
}

export async function setAdminR2ForAll(db: D1Database, groupId: string, on: boolean, nowIso: string): Promise<void> {
  await db.prepare("DELETE FROM task_log WHERE group_id = ? AND session_id IS NULL AND task = ? AND kind = 'mark'").bind(groupId, ALL_TASK).run();
  if (on) {
    await db.prepare("INSERT INTO task_log (id, group_id, session_id, task, kind, at) VALUES (?, ?, NULL, ?, 'mark', ?)").bind(newId(), groupId, ALL_TASK, nowIso).run();
  }
}

/** Does the organizer screen use the round 2 layout for this request? */
export async function adminR2For(ctx: Ctx, groupId: string): Promise<boolean> {
  if (!adminR2Allowed(ctx.env.ADMIN_R2)) return false;
  if ((ctx.req.headers.get(ADMIN_R2_HEADER) ?? '').toLowerCase() === 'on') return true;
  return adminR2ForAll(ctx.db, groupId);
}

// ---------- Hide player (soft) ----------
// The organizer hides a player from the organizer's own Players list and pickers (View as, "Add someone" on a game).
// It only hides a name: the player keeps every seat, payment, credit and history, still appears on the games and the
// Money tab they are in, and can still sign up on their own screen. "Unhide" (Settings > Advanced > Hidden players)
// puts the name back. Stored as one row per hidden player in task_log (kind 'mark', no game, the task is
// "admin_hidden_player:" plus the player's id): no new column and no schema change. A backup restore empties task_log,
// which would only make hidden names show again, never lose anything.

const HIDDEN_PREFIX = 'admin_hidden_player:';

/** The ids of the players the organizer hid. */
export async function adminHiddenPlayerIds(db: D1Database, groupId: string): Promise<Set<string>> {
  try {
    const { results } = await db
      .prepare("SELECT task FROM task_log WHERE group_id = ? AND session_id IS NULL AND kind = 'mark' AND task LIKE ?")
      .bind(groupId, `${HIDDEN_PREFIX}%`)
      .all<{ task: string }>();
    return new Set(results.map((r) => r.task.slice(HIDDEN_PREFIX.length)));
  } catch {
    return new Set();
  }
}

export async function setAdminHiddenPlayer(db: D1Database, groupId: string, playerId: string, hidden: boolean, nowIso: string): Promise<void> {
  const task = `${HIDDEN_PREFIX}${playerId}`;
  await db.prepare("DELETE FROM task_log WHERE group_id = ? AND session_id IS NULL AND task = ? AND kind = 'mark'").bind(groupId, task).run();
  if (hidden) {
    await db.prepare("INSERT INTO task_log (id, group_id, session_id, task, kind, at) VALUES (?, ?, NULL, ?, 'mark', ?)").bind(newId(), groupId, task, nowIso).run();
  }
}
