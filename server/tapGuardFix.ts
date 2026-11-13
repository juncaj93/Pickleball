import type { Ctx } from './context';
import type { D1Database } from './db';
import { newId } from './crypto';
import { TAP_GUARD_FIX, tapGuardFixAllowed } from '../shared/tapGuard';

// Zip 35: TAP_GUARD_FIX (shared/tapGuard.ts), "Tap guard fix". Look and feel only. On for a request when:
//  - its wrangler.toml var is not "off" (the kill switch, needs a deploy), and
//  - the organizer switched it on in Settings > Feature switches (every phone, player and organizer), or this phone opened the site
//    with ?tapguard=on (it then sends X-Tap-Guard-Fix: a private test switch for that phone only).
// "On for everyone" is one row in task_log (kind 'mark', no game): no schema change, the same way the other switches are stored.
// Nothing saved, charged or sent depends on it: it only changes which fast tap the page ignores.

/** The one switch question every feature switch asks, word for word (server/speed.ts answers it from one read when it can). */
const SWITCH_READ = "SELECT 1 AS x FROM task_log WHERE group_id = ? AND session_id IS NULL AND task = ? AND kind = 'mark' LIMIT 1";

async function forAll(db: D1Database, groupId: string): Promise<boolean> {
  const row = await db.prepare(SWITCH_READ).bind(groupId, TAP_GUARD_FIX.task).first().catch(() => null);
  return !!row;
}

export async function setTapGuardFixForAll(db: D1Database, groupId: string, on: boolean, nowIso: string): Promise<void> {
  await db.prepare("DELETE FROM task_log WHERE group_id = ? AND session_id IS NULL AND task = ? AND kind = 'mark'").bind(groupId, TAP_GUARD_FIX.task).run();
  if (on) {
    await db.prepare("INSERT INTO task_log (id, group_id, session_id, task, kind, at) VALUES (?, ?, NULL, ?, 'mark', ?)").bind(newId(), groupId, TAP_GUARD_FIX.task, nowIso).run();
  }
}

/** The switch for this request, and the Settings row: one read of the row for both. `on`: the kill switch allows it and the row is on or this phone has the private test link. */
export async function tapGuardFixFlags(ctx: Ctx, groupId: string): Promise<{ on: boolean; forAll: boolean }> {
  const row = await forAll(ctx.db, groupId);
  const header = (ctx.req.headers.get(TAP_GUARD_FIX.header) ?? '').toLowerCase() === 'on';
  return { on: tapGuardFixAllowed(ctx.env.TAP_GUARD_FIX) && (header || row), forAll: row };
}
