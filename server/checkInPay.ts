import type { Ctx } from './context';
import type { D1Database } from './db';
import { newId } from './crypto';
import { CHECKIN_PAY_LINE, checkInPayAllowed, signedUpOwe } from '../shared/checkInPay';
import { seatCredit } from '../shared/credit';
import { loadLedger } from './credit';
import { adminSessionView } from './views';
import { getPlayers, loadRoster, organizerIdOf, settingsOf, type GroupRow, type SessionRow } from './repo';
import { timeShiftFor } from './timeShift';

// Zip 34: CHECKIN_PAY_LINE (shared/checkInPay.ts), "Check-in pay line". Words only. On for a request when:
//  - its wrangler.toml var is not "off" (the kill switch, needs a deploy), and
//  - the organizer switched it on in Settings > Feature switches (every organizer phone and the texted Telegram link), or this phone
//    opened /admin?checkinpay=on (it then sends X-Checkin-Pay: a private test switch for that phone only).
// "On for everyone" is one row in task_log (kind 'mark', no game): no schema change, the same way the other switches are stored.
// Nothing saved, charged or sent depends on it: it only changes the words of one prefilled text.

/** The one switch question every feature switch asks, word for word (server/speed.ts answers it from one read when it can). */
const SWITCH_READ = "SELECT 1 AS x FROM task_log WHERE group_id = ? AND session_id IS NULL AND task = ? AND kind = 'mark' LIMIT 1";

async function forAll(db: D1Database, groupId: string): Promise<boolean> {
  const row = await db.prepare(SWITCH_READ).bind(groupId, CHECKIN_PAY_LINE.task).first().catch(() => null);
  return !!row;
}

export async function setCheckInPayForAll(db: D1Database, groupId: string, on: boolean, nowIso: string): Promise<void> {
  await db.prepare("DELETE FROM task_log WHERE group_id = ? AND session_id IS NULL AND task = ? AND kind = 'mark'").bind(groupId, CHECKIN_PAY_LINE.task).run();
  if (on) {
    await db.prepare("INSERT INTO task_log (id, group_id, session_id, task, kind, at) VALUES (?, ?, NULL, ?, 'mark', ?)").bind(newId(), groupId, CHECKIN_PAY_LINE.task, nowIso).run();
  }
}

/** The switch for this request, and the Settings row: one read of the row for both. `on`: the kill switch allows it and the row is on or this phone has the private test link. */
export async function checkInPayFlags(ctx: Ctx, groupId: string): Promise<{ on: boolean; forAll: boolean }> {
  const row = await forAll(ctx.db, groupId);
  const header = (ctx.req.headers.get(CHECKIN_PAY_LINE.header) ?? '').toLowerCase() === 'on';
  return { on: checkInPayAllowed(ctx.env.CHECKIN_PAY_LINE) && (header || row), forAll: row };
}

/**
 * For the texted Telegram link (server/go.ts), which has no organizer screen to read: does somebody signed up for this game (not the organizer)
 * still owe? It builds the game the way the organizer's Money card does (adminSessionView: price, credit used on the seat, cash paid earlier),
 * then asks the same question as the Home card's text (shared/checkInPay.ts signedUpOwe). Read only.
 */
export async function signedUpOweOnGame(ctx: Ctx, group: GroupRow, session: SessionRow): Promise<boolean> {
  const ledger = await loadLedger(ctx.db, group.id);
  const view = adminSessionView(
    session,
    await loadRoster(ctx.db, session.id),
    await getPlayers(ctx.db, group.id),
    ctx.nowMs,
    settingsOf(group),
    group.timezone,
    await organizerIdOf(ctx.db, group),
    (r) => seatCredit(ledger, session.id, r.player_id, { paymentStatus: r.payment_status, paidAt: r.paid_at, refundedAt: r.refunded_at }),
    null,
    { spent: [], requested: [] },
    await timeShiftFor(ctx, group.id),
  );
  return signedUpOwe(view.roster);
}
