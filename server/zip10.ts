import type { Ctx } from './context';
import type { D1Database } from './db';
import type { GroupRow } from './repo';
import { newId } from './crypto';
import { CARD_CLEANUP_HEADER, zip10Allowed } from '../shared/zip10';

// Zip 10: CARD_CLEANUP (shared/zip10.ts). On for a request when:
//  - its wrangler.toml var is not "off" (the kill switch, needs a deploy), and
//  - the organizer switched it on in Settings > Feature switches (every phone), or this phone opened the site with ?cardcleanup=on
//    (it then sends X-Card-Cleanup: a private test switch for that phone's LOOK only; seats follow the Settings row alone).
// "On for everyone" is one row in task_log (kind 'mark', no game): no schema change, the same way the other switches are stored.
//
// It removes the Max players cap and the waitlist, so its answer has to reach every join path of the request. It rides on the group
// row (`card_cleanup`, never stored) and from there on settingsOf(group).noCap (server/repo.ts), which every join path already reads
// for maxPlayers. Every place a request loads the group calls withCardCleanup (requireAdmin, requireGroupKey, texted links). The
// 5-minute clock joins nobody; its Telegram words read cardCleanupForAll.

export const CARD_CLEANUP_TASK = 'card_cleanup_on';

async function forAll(db: D1Database, groupId: string): Promise<boolean> {
  const row = await db
    .prepare("SELECT 1 AS x FROM task_log WHERE group_id = ? AND session_id IS NULL AND task = ? AND kind = 'mark' LIMIT 1")
    .bind(groupId, CARD_CLEANUP_TASK)
    .first()
    .catch(() => null);
  return !!row;
}

/** The Settings row alone (no phone, no request): the 5-minute clock and database-only look-ups. The kill switch is not visible there. */
export const cardCleanupForAll = (db: D1Database, groupId: string) => forAll(db, groupId);

export async function setCardCleanupForAll(db: D1Database, groupId: string, on: boolean, nowIso: string): Promise<void> {
  await db.prepare("DELETE FROM task_log WHERE group_id = ? AND session_id IS NULL AND task = ? AND kind = 'mark'").bind(groupId, CARD_CLEANUP_TASK).run();
  if (on) {
    await db.prepare("INSERT INTO task_log (id, group_id, session_id, task, kind, at) VALUES (?, ?, NULL, ?, 'mark', ?)").bind(newId(), groupId, CARD_CLEANUP_TASK, nowIso).run();
  }
}

/**
 * "Card cleanup" for seats (no cap, no waitlist) on this request: the kill switch allows it and the Settings row is on. Nothing else: the
 * private test link never changes who gets a seat, not even on the organizer's phone (a fresh review, Nov 6: the organizer previewing the
 * look on live would otherwise move waiters in past Max players with no notice). Test the seats part on the fake-data preview.
 */
export async function cardCleanupFor(ctx: Ctx, groupId: string): Promise<boolean> {
  if (!zip10Allowed(ctx.env.CARD_CLEANUP)) return false;
  return forAll(ctx.db, groupId);
}

/** The new card look for this screen: the rules above, or any phone with the private test link (look only, nothing about seats). */
export async function cardCleanupLook(ctx: Ctx, groupId: string): Promise<boolean> {
  if (!zip10Allowed(ctx.env.CARD_CLEANUP)) return false;
  if ((ctx.req.headers.get(CARD_CLEANUP_HEADER) ?? '').toLowerCase() === 'on') return true;
  return forAll(ctx.db, groupId);
}

/**
 * Puts this request's CARD_CLEANUP answer on the group row, so settingsOf(group) carries it (no cap, no waitlist) to every join path.
 * Only ever sets the mark when it is on; off leaves the row exactly as read.
 */
export async function withCardCleanup<G extends GroupRow>(ctx: Ctx, group: G): Promise<G> {
  if (await cardCleanupFor(ctx, group.id)) group.card_cleanup = true;
  return group;
}
