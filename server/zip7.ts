import type { Ctx } from './context';
import type { D1Database } from './db';
import { newId } from './crypto';
import { COLOR_CLEANUP_HEADER, PLAYER_CARDS_HEADER, TONIGHT_GLOW_HEADER, zip7Allowed } from '../shared/zip7';

// Zip 7: TONIGHT_GLOW, COLOR_CLEANUP and PLAYER_CARDS_SIMPLE. Each is on for a request when:
//  - its wrangler.toml var is not "off" (the kill switch, needs a deploy), and
//  - the organizer switched it on in Settings > Feature switches (every phone), or this phone opened the site with
//    ?tonightglow=on / ?colorcleanup=on / ?playercards=on (it then sends the matching header: a private test switch).
// Display only: the server does exactly the same work either way. "On for everyone" is one row in task_log (kind 'mark', no game).

export const TONIGHT_GLOW_TASK = 'tonight_glow_on';
export const COLOR_CLEANUP_TASK = 'color_cleanup_on';
export const PLAYER_CARDS_TASK = 'player_cards_on';

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

async function on(ctx: Ctx, groupId: string, flag: string | undefined, header: string, task: string): Promise<boolean> {
  if (!zip7Allowed(flag)) return false;
  if ((ctx.req.headers.get(header) ?? '').toLowerCase() === 'on') return true;
  return forAll(ctx.db, groupId, task);
}

export const tonightGlowForAll = (db: D1Database, groupId: string) => forAll(db, groupId, TONIGHT_GLOW_TASK);
export const setTonightGlowForAll = (db: D1Database, groupId: string, v: boolean, nowIso: string) => setForAll(db, groupId, TONIGHT_GLOW_TASK, v, nowIso);
export const tonightGlowFor = (ctx: Ctx, groupId: string) => on(ctx, groupId, ctx.env.TONIGHT_GLOW, TONIGHT_GLOW_HEADER, TONIGHT_GLOW_TASK);

export const colorCleanupForAll = (db: D1Database, groupId: string) => forAll(db, groupId, COLOR_CLEANUP_TASK);
export const setColorCleanupForAll = (db: D1Database, groupId: string, v: boolean, nowIso: string) => setForAll(db, groupId, COLOR_CLEANUP_TASK, v, nowIso);
export const colorCleanupFor = (ctx: Ctx, groupId: string) => on(ctx, groupId, ctx.env.COLOR_CLEANUP, COLOR_CLEANUP_HEADER, COLOR_CLEANUP_TASK);

export const playerCardsForAll = (db: D1Database, groupId: string) => forAll(db, groupId, PLAYER_CARDS_TASK);
export const setPlayerCardsForAll = (db: D1Database, groupId: string, v: boolean, nowIso: string) => setForAll(db, groupId, PLAYER_CARDS_TASK, v, nowIso);
export const playerCardsFor = (ctx: Ctx, groupId: string) => on(ctx, groupId, ctx.env.PLAYER_CARDS_SIMPLE, PLAYER_CARDS_HEADER, PLAYER_CARDS_TASK);
