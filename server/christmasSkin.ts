import type { Ctx } from './context';
import type { D1Database } from './db';
import { newId } from './crypto';
import { CHRISTMAS_SKIN, christmasSkinAllowed, inChristmasWindow, parsePretendDate } from '../shared/christmasSkin';

// Zip 38: CHRISTMAS_SKIN (shared/christmasSkin.ts). The player screens get ONE true flag, "christmasSkin", exactly when:
//  - its wrangler.toml var is not "off" (the kill switch, needs a deploy), and
//  - the organizer switched it on in Settings > Feature switches (every phone), or this phone opened the site with ?christmasskin=on (it
//    then sends X-Christmas-Skin: a private test switch for that phone only; it also ignores the date so Alex can look before Nov 27),
//    or this is a preview that has its own switch on (CHRISTMAS_SKIN_PREVIEW, only in [env.preview.vars]), and
//  - today (Eastern) is inside the window: the Friday after Thanksgiving through Dec 31. A preview may pretend another day with
//    X-Christmas-Date (?xmasdate=2026-12-05); the live site ignores that header, because CHRISTMAS_SKIN_PREVIEW does not exist there.
// Outside all that the answer carries no flag at all, so it is exactly today's. No schema change: "on for everyone" is one row in
// task_log (kind 'mark', no game), the same way the other switches are stored. Look only: nothing here touches a seat, price or text.

/** The one switch question every feature switch asks, word for word (server/speed.ts answers it from one read when it can). */
const SWITCH_READ = "SELECT 1 AS x FROM task_log WHERE group_id = ? AND session_id IS NULL AND task = ? AND kind = 'mark' LIMIT 1";

async function forAll(db: D1Database, groupId: string): Promise<boolean> {
  const row = await db.prepare(SWITCH_READ).bind(groupId, CHRISTMAS_SKIN.task).first().catch(() => null);
  return !!row;
}

/** The Settings row alone (no phone, no request). The kill switch is not visible there. */
export const christmasSkinForAll = (db: D1Database, groupId: string) => forAll(db, groupId);

export async function setChristmasSkinForAll(db: D1Database, groupId: string, on: boolean, nowIso: string): Promise<void> {
  await db.prepare("DELETE FROM task_log WHERE group_id = ? AND session_id IS NULL AND task = ? AND kind = 'mark'").bind(groupId, CHRISTMAS_SKIN.task).run();
  if (on) {
    await db.prepare("INSERT INTO task_log (id, group_id, session_id, task, kind, at) VALUES (?, ?, NULL, ?, 'mark', ?)").bind(newId(), groupId, CHRISTMAS_SKIN.task, nowIso).run();
  }
}

/** Is this a preview that may pretend a date and has its own switch? Only [env.preview.vars] has CHRISTMAS_SKIN_PREVIEW. */
const isPreview = (ctx: Ctx) => (ctx.env.CHRISTMAS_SKIN_PREVIEW ?? '').trim().toLowerCase() === 'on';

/**
 * "Christmas skin" for this screen: the kill switch allows it, the switch is on for this phone, and today is inside the window.
 * The date is checked first, so outside the window nothing is read from the database at all (the answer and the trip count are main's).
 */
export async function christmasSkinFor(ctx: Ctx, groupId: string): Promise<boolean> {
  if (!christmasSkinAllowed(ctx.env.CHRISTMAS_SKIN)) return false;
  const priv = (ctx.req.headers.get(CHRISTMAS_SKIN.header) ?? '').toLowerCase() === 'on';
  const preview = isPreview(ctx);
  // The private test link ignores the date (this phone only), so the real-phone check can happen before Nov 27.
  if (priv) return true;
  const pretend = preview ? parsePretendDate(ctx.req.headers.get(CHRISTMAS_SKIN.dateHeader)) : null;
  const nowMs = pretend ?? Date.parse(ctx.nowIso);
  if (!inChristmasWindow(nowMs)) return false;
  if (preview) return true;
  return forAll(ctx.db, groupId);
}
