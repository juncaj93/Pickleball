import type { Ctx } from './context';
import type { D1Database } from './db';
import { newId } from './crypto';
import { HOME_SCREEN_TIP, homeScreenTipAllowed } from '../shared/homeScreenTip';

// Zip 37: HOME_SCREEN_TIP (shared/homeScreenTip.ts). On for a request when:
//  - its wrangler.toml var is not "off" (the kill switch, needs a deploy), and
//  - the organizer switched it on in Settings > Feature switches (every phone), or this phone opened the site with ?homescreentip=on
//    (it then sends X-Home-Screen-Tip: a private test switch for that phone only), or this is a preview that has its own switch on.
// "On for everyone" is one row in task_log (kind 'mark', no game): no schema change, the same way the other switches are stored.
// Look only: the answer carries one true flag and the phone decides when to draw the card. Nothing is saved on the server.

/** The one switch question every feature switch asks, word for word (server/speed.ts answers it from one read when it can). */
const SWITCH_READ = "SELECT 1 AS x FROM task_log WHERE group_id = ? AND session_id IS NULL AND task = ? AND kind = 'mark' LIMIT 1";

async function forAll(db: D1Database, groupId: string): Promise<boolean> {
  const row = await db.prepare(SWITCH_READ).bind(groupId, HOME_SCREEN_TIP.task).first().catch(() => null);
  return !!row;
}

/** The Settings row alone (no phone, no request). The kill switch is not visible there. */
export const homeScreenTipForAll = (db: D1Database, groupId: string) => forAll(db, groupId);

export async function setHomeScreenTipForAll(db: D1Database, groupId: string, on: boolean, nowIso: string): Promise<void> {
  await db.prepare("DELETE FROM task_log WHERE group_id = ? AND session_id IS NULL AND task = ? AND kind = 'mark'").bind(groupId, HOME_SCREEN_TIP.task).run();
  if (on) {
    await db.prepare("INSERT INTO task_log (id, group_id, session_id, task, kind, at) VALUES (?, ?, NULL, ?, 'mark', ?)").bind(newId(), groupId, HOME_SCREEN_TIP.task, nowIso).run();
  }
}

/** "Home Screen tip" for this screen: the kill switch allows it, and the Settings row is on, this phone has the private test link, or this preview has its own switch on. */
export async function homeScreenTipFor(ctx: Ctx, groupId: string): Promise<boolean> {
  if (!homeScreenTipAllowed(ctx.env.HOME_SCREEN_TIP)) return false;
  if ((ctx.req.headers.get(HOME_SCREEN_TIP.header) ?? '').toLowerCase() === 'on') return true;
  // Preview only (HOME_SCREEN_TIP_PREVIEW exists only in [env.preview.vars], never [vars]; a test checks): this zip's preview shows the card
  // whatever the shared preview database says (another channel's re-seed drops the row).
  if ((ctx.env.HOME_SCREEN_TIP_PREVIEW ?? '').trim().toLowerCase() === 'on') return true;
  return forAll(ctx.db, groupId);
}
