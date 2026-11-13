import type { Ctx } from './context';
import type { D1Database } from './db';
import { newId } from './crypto';
import { CHRISTMAS_SKIN, christmasSkinAllowed, inChristmasWindow, parseMode, parsePretendDate, type SkinMode } from '../shared/christmasSkin';

// Zip 38: CHRISTMAS_SKIN (shared/christmasSkin.ts), a 3-way switch in Settings: Off, Just me, Everyone. Stored as rows in task_log (kind 'mark', no
// game), the way the other switches are, so there is no schema change:
//   no row                      Off
//   'christmas_skin_me'         Just me: only the organizer's own player gets anything (a flag with the theme choice, no Christmas logo)
//   'christmas_skin_on'         Everyone: every player gets the flag, but only inside the window (Friday after Thanksgiving through Dec 31, Eastern)
//   'christmas_skin_me_on'      the organizer's own theme choice in Just me (kept on the server so a Home Screen app has it too)
// The wrangler.toml var is the kill switch (allowed unless "off"; needs a deploy) and beats everything. A preview (CHRISTMAS_SKIN_PREVIEW, only in
// [env.preview.vars]) may choose the mode with X-Christmas-Mode (?xmasmode=me|all|off) and pretend a day with X-Christmas-Date (?xmasdate=2026-12-05);
// the live site has no such var, so it ignores both. Look only: nothing here touches a seat, price or text.

/** The one switch question every feature switch asks, word for word (server/speed.ts answers it from one read when it can). */
const SWITCH_READ = "SELECT 1 AS x FROM task_log WHERE group_id = ? AND session_id IS NULL AND task = ? AND kind = 'mark' LIMIT 1";

async function hasMark(db: D1Database, groupId: string, task: string): Promise<boolean> {
  const row = await db.prepare(SWITCH_READ).bind(groupId, task).first().catch(() => null);
  return !!row;
}
async function setMark(db: D1Database, groupId: string, task: string, on: boolean, nowIso: string): Promise<void> {
  await db.prepare("DELETE FROM task_log WHERE group_id = ? AND session_id IS NULL AND task = ? AND kind = 'mark'").bind(groupId, task).run();
  if (on) {
    await db.prepare("INSERT INTO task_log (id, group_id, session_id, task, kind, at) VALUES (?, ?, NULL, ?, 'mark', ?)").bind(newId(), groupId, task, nowIso).run();
  }
}

/** The Settings row alone (no phone, no request): Off, Just me or Everyone. The kill switch is not visible there. */
export async function christmasSkinMode(db: D1Database, groupId: string): Promise<SkinMode> {
  if (await hasMark(db, groupId, CHRISTMAS_SKIN.task)) return 'all';
  return (await hasMark(db, groupId, CHRISTMAS_SKIN.meTask)) ? 'me' : 'off';
}

/** Save the 3-way choice: exactly one of the two mode rows (or neither). */
export async function setChristmasSkinMode(db: D1Database, groupId: string, mode: SkinMode, nowIso: string): Promise<void> {
  await setMark(db, groupId, CHRISTMAS_SKIN.task, mode === 'all', nowIso);
  await setMark(db, groupId, CHRISTMAS_SKIN.meTask, mode === 'me', nowIso);
}

/** The organizer's own theme choice in Just me (on = the Christmas theme is showing for them). */
export const christmasSkinMeOn = (db: D1Database, groupId: string) => hasMark(db, groupId, CHRISTMAS_SKIN.meOnTask);
export const setChristmasSkinMeOn = (db: D1Database, groupId: string, on: boolean, nowIso: string) => setMark(db, groupId, CHRISTMAS_SKIN.meOnTask, on, nowIso);

/** Is this a preview that may choose the mode and pretend a date? Only [env.preview.vars] has CHRISTMAS_SKIN_PREVIEW. */
const isPreview = (ctx: Ctx) => (ctx.env.CHRISTMAS_SKIN_PREVIEW ?? '').trim().toLowerCase() === 'on';

/**
 * "Christmas skin" for this screen.
 *   all  Everyone: the Christmas logo and the theme for every player (only inside the window).
 *   me   Just me: only for the organizer's own player (never in View as): the theme choice, on any date. The logo stays the normal one.
 * The date is checked before any database read: outside the window only the organizer's own player costs a read (the Just me row); inside it the
 * Everyone row is one read, as for every other switch. The kill switch beats everything.
 */
export async function christmasSkinFor(ctx: Ctx, groupId: string, meIsOrganizer = false, viewAs = false): Promise<{ all: boolean; me: { on: boolean } | null }> {
  const none = { all: false, me: null };
  if (!christmasSkinAllowed(ctx.env.CHRISTMAS_SKIN)) return none;
  const preview = isPreview(ctx);
  const pretend = preview ? parsePretendDate(ctx.req.headers.get(CHRISTMAS_SKIN.dateHeader)) : null;
  const inWindow = inChristmasWindow(pretend ?? Date.parse(ctx.nowIso));
  const mine = meIsOrganizer && !viewAs;
  let mode: SkinMode;
  if (preview) mode = parseMode(ctx.req.headers.get(CHRISTMAS_SKIN.modeHeader)) ?? 'all';
  else if (inWindow && (await hasMark(ctx.db, groupId, CHRISTMAS_SKIN.task))) mode = 'all';
  else mode = mine && (await hasMark(ctx.db, groupId, CHRISTMAS_SKIN.meTask)) ? 'me' : 'off';
  if (mode === 'all') return inWindow ? { all: true, me: null } : none;
  if (mode === 'me' && mine) return { all: false, me: { on: await christmasSkinMeOn(ctx.db, groupId) } };
  return none;
}

/** The mode in force for this request, whatever the date: on a preview the mode header (if any), else the Settings row. (The save in Just me asks this.) */
export async function christmasSkinModeFor(ctx: Ctx, groupId: string): Promise<SkinMode> {
  if (isPreview(ctx)) return parseMode(ctx.req.headers.get(CHRISTMAS_SKIN.modeHeader)) ?? 'all';
  return christmasSkinMode(ctx.db, groupId);
}
