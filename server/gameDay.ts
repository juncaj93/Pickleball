import type { Ctx } from './context';
import type { D1Database } from './db';
import { newId } from './crypto';
import { GAME_DAY_CARD, GAME_DAY_TEST, gameDayAllowed } from '../shared/gameDay';

// Zip 14: GAME_DAY_CARD (shared/gameDay.ts). On for a request when:
//  - its wrangler.toml var is not "off" (the kill switch, needs a deploy), and
//  - the organizer switched it on in Settings > Feature switches (every phone), or this phone opened the site with ?gameday=on
//    (it then sends X-Game-Day-Card: a private test switch for that phone only; on /admin it also shows the Court row).
// "On for everyone" is one row in task_log (kind 'mark', no game): no schema change, the same way the other switches are stored.
// Display only: no price, seat, credit or text reads it, so the private link is safe on any phone.

/** The one switch question every feature switch asks, word for word (server/speed.ts answers it from one read when it can). */
const SWITCH_READ = "SELECT 1 AS x FROM task_log WHERE group_id = ? AND session_id IS NULL AND task = ? AND kind = 'mark' LIMIT 1";

async function forAll(db: D1Database, groupId: string): Promise<boolean> {
  const row = await db.prepare(SWITCH_READ).bind(groupId, GAME_DAY_CARD.task).first().catch(() => null);
  return !!row;
}

/** The Settings row alone (no phone, no request). The kill switch is not visible there. */
export const gameDayCardForAll = (db: D1Database, groupId: string) => forAll(db, groupId);

export async function setGameDayCardForAll(db: D1Database, groupId: string, on: boolean, nowIso: string): Promise<void> {
  await db.prepare("DELETE FROM task_log WHERE group_id = ? AND session_id IS NULL AND task = ? AND kind = 'mark'").bind(groupId, GAME_DAY_CARD.task).run();
  if (on) {
    await db
      .prepare("INSERT INTO task_log (id, group_id, session_id, task, kind, at) VALUES (?, ?, NULL, ?, 'mark', ?)")
      .bind(newId(), groupId, GAME_DAY_CARD.task, nowIso)
      .run();
  }
}

/** The switch for this screen, and the Settings row: one read of the row for both. */
export async function gameDayCardFlags(ctx: Ctx, groupId: string): Promise<{ on: boolean; forAll: boolean }> {
  const row = await forAll(ctx.db, groupId);
  const header = (ctx.req.headers.get(GAME_DAY_CARD.header) ?? '').toLowerCase() === 'on';
  return { on: gameDayAllowed(ctx.env.GAME_DAY_CARD) && (header || row), forAll: row };
}

/** "Game day card" for this request: the kill switch allows it, and the Settings row is on or this phone has the private test link. */
export async function gameDayCardFor(ctx: Ctx, groupId: string): Promise<boolean> {
  if (!gameDayAllowed(ctx.env.GAME_DAY_CARD)) return false;
  if ((ctx.req.headers.get(GAME_DAY_CARD.header) ?? '').toLowerCase() === 'on') return true;
  return forAll(ctx.db, groupId);
}

/**
 * Preview only (shared/gameDay.ts GAME_DAY_TEST): this phone asked to see the next game as if it were today. Needs GAME_DAY_TEST = "on",
 * which only [env.preview.vars] has; production has no such var, so this is always false on live, whatever a phone sends. No database read.
 */
export function gameDayTestFor(ctx: Ctx): boolean {
  if ((ctx.env.GAME_DAY_TEST ?? '').trim().toLowerCase() !== 'on') return false;
  return (ctx.req.headers.get(GAME_DAY_TEST.header) ?? '').toLowerCase() === 'on';
}
