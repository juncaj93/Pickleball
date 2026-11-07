import type { Ctx } from './context';
import type { D1Database } from './db';
import { newId } from './crypto';
import { MOTION_ADMIN_HEADER, MOTION_HEADER, motionAdminOnForAll, motionOnForAll } from '../shared/motion';

// Settings > Feature switches (Nov 2026) holds a row for each motion switch, so every switch is on one page. The wrangler.toml value
// (MOTION, MOTION_ADMIN) stays the starting point: with nobody touching the Settings row, everything behaves exactly as it did.
// A Settings flip is one row in task_log (kind 'mark', no game): no schema change, the way the other Settings switches are stored.
//   var "on"  and no row   -> on for everyone (as before)
//   var "on"  and 'off' row -> off for everyone (the Settings row turned it off), a private ?motion=on phone still sees it
//   var not "on" and 'on' row -> on for everyone
// A backup restore empties task_log, so the Settings choice is forgotten and the wrangler.toml value rules again.

export type MotionWhich = 'player' | 'admin';

const TASKS: Record<MotionWhich, { on: string; off: string }> = {
  player: { on: 'motion_on', off: 'motion_off' },
  admin: { on: 'motion_admin_on', off: 'motion_admin_off' },
};

const varOn = (ctx: Pick<Ctx, 'env'>, which: MotionWhich) => (which === 'player' ? motionOnForAll(ctx.env.MOTION) : motionAdminOnForAll(ctx.env.MOTION_ADMIN));

/** motionSetting's one read, word for word (SPEED_FEWER_QUERIES sends it early, together with others: server/speed.ts). */
export function motionSettingRead(groupId: string, which: MotionWhich): { sql: string; values: unknown[] } {
  const t = TASKS[which];
  return { sql: "SELECT task FROM task_log WHERE group_id = ? AND session_id IS NULL AND kind = 'mark' AND task IN (?, ?) ORDER BY at DESC LIMIT 1", values: [groupId, t.on, t.off] };
}

/** What Settings says for this motion switch: 'on', 'off', or null (nobody touched it: the wrangler.toml value rules). */
export async function motionSetting(db: D1Database, groupId: string, which: MotionWhich): Promise<'on' | 'off' | null> {
  const t = TASKS[which];
  const r = motionSettingRead(groupId, which);
  const row = await db
    .prepare(r.sql)
    .bind(...r.values)
    .first<{ task: string }>()
    .catch(() => null);
  return row ? (row.task === t.on ? 'on' : 'off') : null;
}

/** Is this motion switch on for everyone (the wrangler.toml value, changed by the Settings row)? */
export async function motionForAll(ctx: Pick<Ctx, 'env' | 'db'>, groupId: string, which: MotionWhich): Promise<boolean> {
  const setting = await motionSetting(ctx.db, groupId, which);
  return varOn(ctx, which) ? setting !== 'off' : setting === 'on';
}

/** The Settings row: on or off for everyone. Going back to what wrangler.toml says clears the row, so a later deploy value counts again. */
export async function setMotionForAll(ctx: Pick<Ctx, 'env' | 'db'>, groupId: string, which: MotionWhich, on: boolean, nowIso: string): Promise<void> {
  const t = TASKS[which];
  await ctx.db.prepare("DELETE FROM task_log WHERE group_id = ? AND session_id IS NULL AND kind = 'mark' AND task IN (?, ?)").bind(groupId, t.on, t.off).run();
  if (on !== varOn(ctx, which)) {
    await ctx.db.prepare("INSERT INTO task_log (id, group_id, session_id, task, kind, at) VALUES (?, ?, NULL, ?, 'mark', ?)").bind(newId(), groupId, on ? t.on : t.off, nowIso).run();
  }
}

// Is the motion on for this request? Yes when:
//  - it is on for everyone (the MOTION var in wrangler.toml, unless the Settings row turned it off, or the Settings row turned it on), or
//  - this phone opened the site once with ?motion=on (it then sends the X-Motion: on header: Alex's private test
//    switch, that phone only), or
//  - this is the organizer's in-browser demo (View as), which always shows it.
// Visual only. It changes nothing that is saved, charged or sent.
export async function motionFor(ctx: Ctx, groupId: string): Promise<boolean> {
  if (ctx.env.SANDBOX) return true;
  if ((ctx.req.headers.get(MOTION_HEADER) ?? '').toLowerCase() === 'on') return true;
  return motionForAll(ctx, groupId, 'player');
}

// Is the motion on for the ORGANIZER screens? The organizer side has its own switch (MOTION_ADMIN) so the player
// motion, which is already on for everyone, does not drag the organizer motion live with it. Yes when:
//  - it is on for everyone (the MOTION_ADMIN var, unless the Settings row turned it off, or the Settings row turned it on), or
//  - this phone opened the site once with ?motionadmin=on (it then sends X-Motion-Admin: on: Alex's private test
//    switch, that phone only).
// Visual only. It changes nothing that is saved, charged or sent.
export async function motionAdminFor(ctx: Ctx, groupId: string): Promise<boolean> {
  if ((ctx.req.headers.get(MOTION_ADMIN_HEADER) ?? '').toLowerCase() === 'on') return true;
  return motionForAll(ctx, groupId, 'admin');
}
