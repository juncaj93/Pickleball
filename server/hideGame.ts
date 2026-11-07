import type { Ctx } from './context';
import type { D1Database } from './db';
import { newId } from './crypto';
import { adminV2Allowed } from '../shared/adminV2';

// "Remove from player screen" (ADMIN_V2): the organizer hides a CANCELED game from every player screen. It only hides:
// the game, its roster, payments, credit and the audit trail are not touched, and the organizer still sees the game in
// Home, History > Sessions and Money. "Show on player screen again" undoes it.
// Stored as one row in task_log (kind 'mark', task 'hidden_from_players', the game's id), the same existing table and
// the same way the other one-tap marks are kept: no new column, no schema change. The row goes away with the game.
// A backup restore empties task_log (see STAGE_NOTES), which would only make hidden games show again, never lose money.

export const HIDDEN_TASK = 'hidden_from_players';

/** hiddenGameIds' one read, word for word (SPEED_FEWER_QUERIES sends it early, together with others: server/speed.ts). */
export function hiddenGameIdsRead(groupId: string): { sql: string; values: unknown[] } {
  return { sql: "SELECT session_id FROM task_log WHERE group_id = ? AND task = ? AND kind = 'mark' AND session_id IS NOT NULL", values: [groupId, HIDDEN_TASK] };
}

/** The games hidden from players (any group member's screen), as ids. */
export async function hiddenGameIds(db: D1Database, groupId: string): Promise<Set<string>> {
  try {
    const r = hiddenGameIdsRead(groupId);
    const { results } = await db
      .prepare(r.sql)
      .bind(...r.values)
      .all<{ session_id: string }>();
    return new Set(results.map((r) => r.session_id));
  } catch {
    return new Set();
  }
}

export async function setHiddenFromPlayers(db: D1Database, groupId: string, sessionId: string, hidden: boolean, nowIso: string): Promise<void> {
  await db.prepare("DELETE FROM task_log WHERE session_id = ? AND task = ? AND kind = 'mark'").bind(sessionId, HIDDEN_TASK).run();
  if (hidden) {
    await db.prepare("INSERT INTO task_log (id, group_id, session_id, task, kind, at) VALUES (?, ?, ?, ?, 'mark', ?)").bind(newId(), groupId, sessionId, HIDDEN_TASK, nowIso).run();
  }
}

/**
 * The games a PLAYER must not see. Only canceled games count (a game that was reopened shows again), and the ADMIN_V2
 * kill switch ("off" in wrangler.toml) puts every game back on the player screen.
 */
export async function hiddenFromPlayers(ctx: Ctx, groupId: string, sessions: { id: string; status: string }[]): Promise<Set<string>> {
  if (!adminV2Allowed(ctx.env.ADMIN_V2)) return new Set();
  const marked = await hiddenGameIds(ctx.db, groupId);
  if (marked.size === 0) return marked;
  return new Set(sessions.filter((s) => s.status === 'canceled' && marked.has(s.id)).map((s) => s.id));
}
