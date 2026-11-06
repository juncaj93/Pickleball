import type { Ctx } from './context';
import type { D1Database } from './db';
import type { GroupRow } from './repo';
import { newId } from './crypto';
import { CARD_TIME_HEADER, SHORT_GAMES_HEADER, zip9Allowed } from '../shared/zip9';

// Zip 9: SHORT_GAMES and CARD_TIME_BUTTONS (shared/zip9.ts). Each is on for a request when:
//  - its wrangler.toml var is not "off" (the kill switch, needs a deploy), and
//  - the organizer switched it on in Settings > Feature switches (every phone), or this phone opened the site with ?shortgames=on /
//    ?cardtime=on (it then sends the matching header: a private test switch for that phone only).
// "On for everyone" is one row in task_log (kind 'mark', no game): no schema change, the same way the other switches are stored.
//
// SHORT_GAMES changes money for 1.5 hour games, so its answer has to reach every price path of the request. It rides on the
// group row (`short_games`, never stored) and from there on settingsOf(group).shortGames (server/repo.ts), which every price path
// already reads. Every place a request loads the group calls withShortGames (requireAdmin, requireGroupKey, texted links). The 5-minute
// clock prices nothing.

export const SHORT_GAMES_TASK = 'short_games_on';
export const CARD_TIME_TASK = 'card_time_buttons_on';

async function forAll(db: D1Database, groupId: string, task: string): Promise<boolean> {
  const row = await db
    .prepare("SELECT 1 AS x FROM task_log WHERE group_id = ? AND session_id IS NULL AND task = ? AND kind = 'mark' LIMIT 1")
    .bind(groupId, task)
    .first()
    .catch(() => null);
  return !!row;
}

async function setForAll(db: D1Database, groupId: string, task: string, on: boolean, nowIso: string): Promise<void> {
  await db.prepare("DELETE FROM task_log WHERE group_id = ? AND session_id IS NULL AND task = ? AND kind = 'mark'").bind(groupId, task).run();
  if (on) {
    await db.prepare("INSERT INTO task_log (id, group_id, session_id, task, kind, at) VALUES (?, ?, NULL, ?, 'mark', ?)").bind(newId(), groupId, task, nowIso).run();
  }
}

async function on(ctx: Ctx, groupId: string, flag: string | undefined, header: string, task: string, honorHeader = true): Promise<boolean> {
  if (!zip9Allowed(flag)) return false;
  if (honorHeader && (ctx.req.headers.get(header) ?? '').toLowerCase() === 'on') return true;
  return forAll(ctx.db, groupId, task);
}

/** The Settings row alone (no phone, no request): the 5-minute clock and database-only look-ups. The kill switch is not visible there. */
export const shortGamesForAll = (db: D1Database, groupId: string) => forAll(db, groupId, SHORT_GAMES_TASK);
export const setShortGamesForAll = (db: D1Database, groupId: string, v: boolean, nowIso: string) => setForAll(db, groupId, SHORT_GAMES_TASK, v, nowIso);
/**
 * "Short games" for this request. It changes money, so the private test link (?shortgames=on, the X-Short-Games header) only counts
 * for a phone signed in as the organizer (`organizer`: requireAdmin, which also covers View as). A player's phone, and a texted link,
 * follow only the Settings row: a player can never lower their own price by opening a link.
 */
export const shortGamesFor = (ctx: Ctx, groupId: string, organizer = false) => on(ctx, groupId, ctx.env.SHORT_GAMES, SHORT_GAMES_HEADER, SHORT_GAMES_TASK, organizer);

export const cardTimeForAll = (db: D1Database, groupId: string) => forAll(db, groupId, CARD_TIME_TASK);
export const setCardTimeForAll = (db: D1Database, groupId: string, v: boolean, nowIso: string) => setForAll(db, groupId, CARD_TIME_TASK, v, nowIso);
export const cardTimeFor = (ctx: Ctx, groupId: string) => on(ctx, groupId, ctx.env.CARD_TIME_BUTTONS, CARD_TIME_HEADER, CARD_TIME_TASK);

/**
 * Puts this request's SHORT_GAMES answer on the group row, so settingsOf(group) carries it to every price path. Only ever sets the
 * mark when it is on; off leaves the row exactly as read.
 */
export async function withShortGames<G extends GroupRow>(ctx: Ctx, group: G, organizer = false): Promise<G> {
  if (await shortGamesFor(ctx, group.id, organizer)) group.short_games = true;
  return group;
}
