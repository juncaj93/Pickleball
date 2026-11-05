import type { Ctx } from './context';
import type { D1Database } from './db';
import { newId } from './crypto';
import { HOME_COLLAPSE_HEADER, homeCollapseAllowed } from '../shared/homeCollapse';

// "Home collapse" (HOME_COLLAPSE). On for a request when:
//  - the HOME_COLLAPSE var (wrangler.toml) is not "off" (the kill switch, needs a deploy), and
//  - the organizer switched it on in Settings > Feature switches (for every player phone), or this phone opened the
//    site with ?homecollapse=on (it then sends the X-Home-Collapse: on header: a private test switch for that phone only).
// Display only: the server does exactly the same work either way. "On for everyone" is one row in task_log (kind 'mark', task
// 'home_collapse_on', no game): no schema change, the same way the other switches are stored.

export const HOME_COLLAPSE_TASK = 'home_collapse_on';

export async function homeCollapseForAll(db: D1Database, groupId: string): Promise<boolean> {
  const row = await db
    .prepare("SELECT 1 AS x FROM task_log WHERE group_id = ? AND session_id IS NULL AND task = ? AND kind = 'mark' LIMIT 1")
    .bind(groupId, HOME_COLLAPSE_TASK)
    .first()
    .catch(() => null);
  return !!row;
}

export async function setHomeCollapseForAll(db: D1Database, groupId: string, on: boolean, nowIso: string): Promise<void> {
  await db.prepare("DELETE FROM task_log WHERE group_id = ? AND session_id IS NULL AND task = ? AND kind = 'mark'").bind(groupId, HOME_COLLAPSE_TASK).run();
  if (on) {
    await db.prepare("INSERT INTO task_log (id, group_id, session_id, task, kind, at) VALUES (?, ?, NULL, ?, 'mark', ?)").bind(newId(), groupId, HOME_COLLAPSE_TASK, nowIso).run();
  }
}

/** Does this request's player Home collapse the later games? */
export async function homeCollapseFor(ctx: Ctx, groupId: string): Promise<boolean> {
  if (!homeCollapseAllowed(ctx.env.HOME_COLLAPSE)) return false;
  if ((ctx.req.headers.get(HOME_COLLAPSE_HEADER) ?? '').toLowerCase() === 'on') return true;
  return homeCollapseForAll(ctx.db, groupId);
}
