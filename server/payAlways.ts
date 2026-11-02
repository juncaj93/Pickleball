import type { Ctx } from './context';
import type { D1Database } from './db';
import { newId } from './crypto';
import { PAY_ALWAYS_HEADER, payAlwaysAllowed } from '../shared/payAlways';

// "Ask for payment on every game": Pay shows on every game a player is in, Booked, Waitlist or Not booked.
// On for a request when:
//  - the PAY_ALWAYS var (wrangler.toml) is not "off" (the kill switch, needs a deploy), and
//  - the organizer switched it on for everyone (Settings > Money), or this phone opened the site with
//    ?payalways=on (it then sends the X-Pay-Always: on header: a private test switch for that phone only), or
//    this is the organizer's in-browser demo (View as), which always shows it.
// Display only: the server already works out what is owed, takes credit at I'm in and returns money on a drop or a
// cancel the same way on every court status. This only decides whether the player screen shows Pay before a court
// is booked. "On for everyone" is one row in task_log (kind 'mark', task 'pay_always_on', no game): no schema change.

const ALL_TASK = 'pay_always_on';

export async function payAlwaysForAll(db: D1Database, groupId: string): Promise<boolean> {
  const row = await db
    .prepare("SELECT 1 AS x FROM task_log WHERE group_id = ? AND session_id IS NULL AND task = ? AND kind = 'mark' LIMIT 1")
    .bind(groupId, ALL_TASK)
    .first()
    .catch(() => null);
  return !!row;
}

export async function setPayAlwaysForAll(db: D1Database, groupId: string, on: boolean, nowIso: string): Promise<void> {
  await db.prepare("DELETE FROM task_log WHERE group_id = ? AND session_id IS NULL AND task = ? AND kind = 'mark'").bind(groupId, ALL_TASK).run();
  if (on) {
    await db.prepare("INSERT INTO task_log (id, group_id, session_id, task, kind, at) VALUES (?, ?, NULL, ?, 'mark', ?)").bind(newId(), groupId, ALL_TASK, nowIso).run();
  }
}

/** Is Pay shown on every game for this request? */
export async function payAlwaysFor(ctx: Ctx, groupId: string): Promise<boolean> {
  if (!payAlwaysAllowed(ctx.env.PAY_ALWAYS)) return false;
  if (ctx.env.SANDBOX) return true;
  if ((ctx.req.headers.get(PAY_ALWAYS_HEADER) ?? '').toLowerCase() === 'on') return true;
  return payAlwaysForAll(ctx.db, groupId);
}
