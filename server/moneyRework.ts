import type { Ctx } from './context';
import type { D1Database } from './db';
import { newId } from './crypto';
import { MONEY_REWORK_HEADER, moneyReworkAllowed } from '../shared/moneyRework';

// "Money page rework" (MONEY_REWORK): the organizer's Money page, Hide from list, Edit charge, the cancel sheet default, the tidied
// Feature switches page and History. On for a request when:
//  - the MONEY_REWORK var (wrangler.toml) is not "off" (the kill switch, needs a deploy), and
//  - the organizer switched it on in Settings > Feature switches (for every organizer phone), or this phone opened
//    /admin?moneyrework=on (it then sends the X-Money-Rework: on header: a private test switch for that phone only).
// "On for everyone" is one row in task_log (kind 'mark', task 'money_rework_on', no game): no schema change, the same way the
// other switches are stored.

const ALL_TASK = 'money_rework_on';

export async function moneyReworkForAll(db: D1Database, groupId: string): Promise<boolean> {
  const row = await db
    .prepare("SELECT 1 AS x FROM task_log WHERE group_id = ? AND session_id IS NULL AND task = ? AND kind = 'mark' LIMIT 1")
    .bind(groupId, ALL_TASK)
    .first()
    .catch(() => null);
  return !!row;
}

export async function setMoneyReworkForAll(db: D1Database, groupId: string, on: boolean, nowIso: string): Promise<void> {
  await db.prepare("DELETE FROM task_log WHERE group_id = ? AND session_id IS NULL AND task = ? AND kind = 'mark'").bind(groupId, ALL_TASK).run();
  if (on) {
    await db.prepare("INSERT INTO task_log (id, group_id, session_id, task, kind, at) VALUES (?, ?, NULL, ?, 'mark', ?)").bind(newId(), groupId, ALL_TASK, nowIso).run();
  }
}

/** Does this request use the reworked Money page and its companions? */
export async function moneyReworkFor(ctx: Ctx, groupId: string): Promise<boolean> {
  if (!moneyReworkAllowed(ctx.env.MONEY_REWORK)) return false;
  if ((ctx.req.headers.get(MONEY_REWORK_HEADER) ?? '').toLowerCase() === 'on') return true;
  return moneyReworkForAll(ctx.db, groupId);
}

// ---------- Hide from list ----------
// An admin hides a game from the organizer's Home and Money lists and from Totals (a test game, a canceled game nobody owes
// for). It only hides: the game, its seats, payments, credit and the Activity log are untouched, and every player screen is
// unchanged. One task_log row per hidden game (kind 'mark', task 'admin_hidden_game', that game's id): the same existing table
// the other hide marks use, so no schema change. The row goes away with the game. A backup restore empties task_log, which
// would only make hidden games show again, never lose money.

export const HIDDEN_GAME_TASK = 'admin_hidden_game';

/** The games the organizer hid from their own lists, as ids. */
export async function adminHiddenGameIds(db: D1Database, groupId: string): Promise<Set<string>> {
  try {
    const { results } = await db
      .prepare("SELECT session_id FROM task_log WHERE group_id = ? AND task = ? AND kind = 'mark' AND session_id IS NOT NULL")
      .bind(groupId, HIDDEN_GAME_TASK)
      .all<{ session_id: string }>();
    return new Set(results.map((r) => r.session_id));
  } catch {
    return new Set();
  }
}

export async function setAdminHiddenGame(db: D1Database, groupId: string, sessionId: string, hidden: boolean, nowIso: string): Promise<void> {
  await db.prepare("DELETE FROM task_log WHERE session_id = ? AND task = ? AND kind = 'mark'").bind(sessionId, HIDDEN_GAME_TASK).run();
  if (hidden) {
    await db.prepare("INSERT INTO task_log (id, group_id, session_id, task, kind, at) VALUES (?, ?, ?, ?, 'mark', ?)").bind(newId(), groupId, sessionId, HIDDEN_GAME_TASK, nowIso).run();
  }
}
