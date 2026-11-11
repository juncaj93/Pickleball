import type { Ctx } from './context';
import type { D1Database } from './db';
import { newId } from './crypto';
import { PLAYERS_SHEET_REDO, playersSheetRedoAllowed } from '../shared/playersSheetRedo';

// Zip 32: PLAYERS_SHEET_REDO (shared/playersSheetRedo.ts). On for a request when:
//  - its wrangler.toml var is not "off" (the kill switch, needs a deploy), and
//  - the organizer switched it on in Settings > Feature switches (every organizer phone), or this phone opened /admin?playerssheet=on
//    (it then sends X-Players-Sheet: a private test switch for that phone only).
// "On for everyone" is one row in task_log (kind 'mark', no game): no schema change, the same way the other switches are stored.
// Display only: no price, seat, credit or text reads it, so the private link is safe on any phone.

/** The one switch question every feature switch asks, word for word (server/speed.ts answers it from one read when it can). */
const SWITCH_READ = "SELECT 1 AS x FROM task_log WHERE group_id = ? AND session_id IS NULL AND task = ? AND kind = 'mark' LIMIT 1";

async function forAll(db: D1Database, groupId: string): Promise<boolean> {
  const row = await db.prepare(SWITCH_READ).bind(groupId, PLAYERS_SHEET_REDO.task).first().catch(() => null);
  return !!row;
}

export async function setPlayersSheetRedoForAll(db: D1Database, groupId: string, on: boolean, nowIso: string): Promise<void> {
  await db.prepare("DELETE FROM task_log WHERE group_id = ? AND session_id IS NULL AND task = ? AND kind = 'mark'").bind(groupId, PLAYERS_SHEET_REDO.task).run();
  if (on) {
    await db.prepare("INSERT INTO task_log (id, group_id, session_id, task, kind, at) VALUES (?, ?, NULL, ?, 'mark', ?)").bind(newId(), groupId, PLAYERS_SHEET_REDO.task, nowIso).run();
  }
}

/** The switch for this screen, and the Settings row: one read of the row for both. `on`: the kill switch allows it and the row is on or this phone has the private test link. */
export async function playersSheetRedoFlags(ctx: Ctx, groupId: string): Promise<{ on: boolean; forAll: boolean }> {
  const row = await forAll(ctx.db, groupId);
  const header = (ctx.req.headers.get(PLAYERS_SHEET_REDO.header) ?? '').toLowerCase() === 'on';
  return { on: playersSheetRedoAllowed(ctx.env.PLAYERS_SHEET_REDO) && (header || row), forAll: row };
}
