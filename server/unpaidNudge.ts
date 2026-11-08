import type { Ctx } from './context';
import type { D1Database } from './db';
import { newId } from './crypto';
import { HttpError } from './http';
import { moneyPicture } from './credit';
import { owedOf } from './owed';
import { organizerIdOf, settingsOf, type GroupRow, type SessionRow } from './repo';
import { BLOCKED_CODE, blockedMessage, nudgeAllowed, nudgeState, UNPAID_LIMIT, UNPAID_NUDGE } from '../shared/unpaidNudge';

// Zip 17: UNPAID_NUDGE (shared/unpaidNudge.ts). On for a request when:
//  - its wrangler.toml var is not "off" (the kill switch, needs a deploy), and
//  - the organizer switched it on in Settings > Feature switches (every phone), or this phone opened the site with ?nudge=on
//    (it then sends X-Unpaid-Nudge: a private test switch for that phone only).
// "On for everyone" is one row in task_log (kind 'mark', no game): no schema change, the same way the other switches are stored.
// The private link can only make sign-ups stricter for the phone that opened it, so it is safe on any phone.

/** The one switch question every feature switch asks, word for word (server/speed.ts answers it from one read when it can). */
const SWITCH_READ = "SELECT 1 AS x FROM task_log WHERE group_id = ? AND session_id IS NULL AND task = ? AND kind = 'mark' LIMIT 1";

async function forAll(db: D1Database, groupId: string): Promise<boolean> {
  const row = await db.prepare(SWITCH_READ).bind(groupId, UNPAID_NUDGE.task).first().catch(() => null);
  return !!row;
}

/** The Settings row alone (no phone, no request). The kill switch is not visible there. */
export const unpaidNudgeForAll = (db: D1Database, groupId: string) => forAll(db, groupId);

export async function setUnpaidNudgeForAll(db: D1Database, groupId: string, on: boolean, nowIso: string): Promise<void> {
  await db.prepare("DELETE FROM task_log WHERE group_id = ? AND session_id IS NULL AND task = ? AND kind = 'mark'").bind(groupId, UNPAID_NUDGE.task).run();
  if (on) {
    await db
      .prepare("INSERT INTO task_log (id, group_id, session_id, task, kind, at) VALUES (?, ?, NULL, ?, 'mark', ?)")
      .bind(newId(), groupId, UNPAID_NUDGE.task, nowIso)
      .run();
  }
}

/** "Unpaid nudge" for this request: the kill switch allows it, and the Settings row is on or this phone has the private test link. */
export async function unpaidNudgeFor(ctx: Ctx, groupId: string): Promise<boolean> {
  if (!nudgeAllowed(ctx.env.UNPAID_NUDGE)) return false;
  if ((ctx.req.headers.get(UNPAID_NUDGE.header) ?? '').toLowerCase() === 'on') return true;
  return forAll(ctx.db, groupId);
}

/**
 * Before a PLAYER's own sign-up (I'm in on any card, the Want in card, a reopened game, a claim link): refused at the limit with a
 * clear message. Off: only the switch row is read (the same one read every switch makes). Never the organizer (who pays the venue and never owes the group), never a seat they
 * already hold, and never the organizer's own "add a player" (that path does not call this). Uses the owe card's own numbers.
 */
export async function refuseOverLimit(ctx: Ctx, group: GroupRow, session: SessionRow, playerId: string): Promise<void> {
  if (!(await unpaidNudgeFor(ctx, group.id))) return;
  if (playerId === (await organizerIdOf(ctx.db, group))) return;
  const seat = await ctx.db
    .prepare('SELECT status FROM session_players WHERE session_id = ? AND player_id = ?')
    .bind(session.id, playerId)
    .first<{ status: string }>();
  if (seat?.status === 'confirmed') return;
  const { sessions, rosters, ledger } = await moneyPicture(ctx.db, group, ctx.nowMs);
  const st = nudgeState(owedOf(playerId, sessions, rosters, ledger, settingsOf(group), ctx.nowMs), ctx.nowMs, UNPAID_LIMIT);
  if (st.blocked) throw new HttpError(409, BLOCKED_CODE, blockedMessage(st.count, st.cents));
}
