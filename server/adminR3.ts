import type { Ctx } from './context';
import type { D1Database } from './db';
import { newId } from './crypto';
import { ADMIN_R3_HEADER, adminR3Allowed } from '../shared/adminR3';
import { seatCredit } from '../shared/credit';
import { adminR2For } from './adminR2';
import { loadLedger } from './credit';
import { loadRosters, loadSessions } from './repo';

// "Admin screens, round 3" (ADMIN_R3): the organizer's Edit game and Add game forms, the Settings clean-up and the Players page.
// On for a request when:
//  - the ADMIN_R3 var (wrangler.toml) is not "off" (the kill switch, needs a deploy), and
//  - the organizer switched it on in Settings > Feature switches (for every organizer phone), or this phone opened
//    /admin?adminr3=on (it then sends the X-Admin-R3: on header: a private test switch for that phone only), and
//  - round 2 is on for the request too (round 3 only rearranges screens that round 2 introduced).
// Display only. "On for everyone" is one row in task_log (kind 'mark', task 'admin_r3_on', no game): no schema change,
// the same way round 2 and the other switches are stored.

const ALL_TASK = 'admin_r3_on';

export async function adminR3ForAll(db: D1Database, groupId: string): Promise<boolean> {
  const row = await db
    .prepare("SELECT 1 AS x FROM task_log WHERE group_id = ? AND session_id IS NULL AND task = ? AND kind = 'mark' LIMIT 1")
    .bind(groupId, ALL_TASK)
    .first()
    .catch(() => null);
  return !!row;
}

export async function setAdminR3ForAll(db: D1Database, groupId: string, on: boolean, nowIso: string): Promise<void> {
  await db.prepare("DELETE FROM task_log WHERE group_id = ? AND session_id IS NULL AND task = ? AND kind = 'mark'").bind(groupId, ALL_TASK).run();
  if (on) {
    await db.prepare("INSERT INTO task_log (id, group_id, session_id, task, kind, at) VALUES (?, ?, NULL, ?, 'mark', ?)").bind(newId(), groupId, ALL_TASK, nowIso).run();
  }
}

/** Does the organizer screen use the round 3 layout for this request? Needs round 2 on as well. */
export async function adminR3For(ctx: Ctx, groupId: string): Promise<boolean> {
  if (!adminR3Allowed(ctx.env.ADMIN_R3)) return false;
  const wanted = (ctx.req.headers.get(ADMIN_R3_HEADER) ?? '').toLowerCase() === 'on' || (await adminR3ForAll(ctx.db, groupId));
  if (!wanted) return false;
  return adminR2For(ctx, groupId);
}

/**
 * What each player has spent on games they played, ever, in cents (the Players page "$108 spent"). Read only, from rows that
 * already exist: a finalized game that was not canceled, a confirmed seat that played, paid and not refunded, counted per seat
 * the way the Money tab counts a seat's "collected": the payment (cash plus credit used) minus whatever came back to them as
 * credit. So a game finalized at $11 after a $14 payment counts $11. Unpaid seats count nothing (that is "owes", not "spent").
 * Deliberately NOT counted, because it is not "paid for a game played": a late-drop fee, a no-show fee, and a game canceled
 * with the fee kept (Money does count those as collected). The organizer's own seat is skipped (they pay the venue).
 * Only runs while round 3 is on. Must never break the dashboard, so the caller treats any failure as "no numbers".
 */
export async function spentByPlayer(db: D1Database, groupId: string, organizerId: string | null): Promise<Map<string, number>> {
  const sessions = (await loadSessions(db, groupId, '0000')).filter((s) => s.finalized_at && s.status !== 'canceled');
  if (sessions.length === 0) return new Map();
  const rosters = await loadRosters(db, groupId, '0000');
  // The credit rows of one seat, found once (seatCredit only looks at rows of its own game and player).
  const bySeat = new Map<string, Awaited<ReturnType<typeof loadLedger>>>();
  for (const e of await loadLedger(db, groupId)) {
    if (!e.sessionId) continue;
    const key = `${e.sessionId}:${e.playerId}`;
    const list = bySeat.get(key);
    if (list) list.push(e);
    else bySeat.set(key, [e]);
  }
  const spent = new Map<string, number>();
  for (const s of sessions) {
    for (const r of rosters.get(s.id) ?? []) {
      if (r.player_id === organizerId || r.status !== 'confirmed' || r.played === 0) continue;
      if (r.payment_status !== 'paid' || r.refunded_at) continue;
      const seat = seatCredit(bySeat.get(`${s.id}:${r.player_id}`) ?? [], s.id, r.player_id, { paymentStatus: r.payment_status, paidAt: r.paid_at, refundedAt: r.refunded_at });
      const cents = Math.max(0, (r.payment_amount_cents ?? 0) - seat.backCents);
      if (cents > 0) spent.set(r.player_id, (spent.get(r.player_id) ?? 0) + cents);
    }
  }
  return spent;
}
