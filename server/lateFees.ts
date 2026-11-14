import type { Ctx } from './context';
import type { D1Database, D1PreparedStatement } from './db';
import { newId } from './crypto';
import { FEE_KEPT, FEE_MIN_PLAYERS, LATE_FEES_HEADER, lateFeesAllowed } from '../shared/lateFees';

// "Late drops owe $14" (LATE_FEES): the rules are in shared/lateFees.ts. This file holds the switch and the SQL.
//
// The switch decides only whether NEW debts are made (a late drop that leaves the game short, a no-show at Finalize
// with fewer than 4 played, and the "Did the venue waive the fee?" question on a late cancel). Debts that already
// exist are always shown and always cleared by a sub, whatever the switch says (with none, those reads find nothing,
// so with the switch off and no debts everything behaves exactly as before).
//
// On for a request when the LATE_FEES var (wrangler.toml) is not "off" (the kill switch, needs a deploy) and the
// organizer switched it on in Settings > Feature switches (one task_log row 'late_fees_on', no schema change), or this
// phone opened the site with ?latefees=on (it sends X-Late-Fees: on: a private test switch for that phone only).

const ALL_TASK = 'late_fees_on';

export async function lateFeesForAll(db: D1Database, groupId: string): Promise<boolean> {
  const row = await db
    .prepare("SELECT 1 AS x FROM task_log WHERE group_id = ? AND session_id IS NULL AND task = ? AND kind = 'mark' LIMIT 1")
    .bind(groupId, ALL_TASK)
    .first()
    .catch(() => null);
  return !!row;
}

export async function setLateFeesForAll(db: D1Database, groupId: string, on: boolean, nowIso: string): Promise<void> {
  await db.prepare("DELETE FROM task_log WHERE group_id = ? AND session_id IS NULL AND task = ? AND kind = 'mark'").bind(groupId, ALL_TASK).run();
  if (on) {
    await db.prepare("INSERT INTO task_log (id, group_id, session_id, task, kind, at) VALUES (?, ?, NULL, ?, 'mark', ?)").bind(newId(), groupId, ALL_TASK, nowIso).run();
  }
}

/** Do this request's taps follow the late-fee rules? */
export async function lateFeesFor(ctx: Ctx, groupId: string): Promise<boolean> {
  if (!lateFeesAllowed(ctx.env.LATE_FEES)) return false;
  if ((ctx.req.headers.get(LATE_FEES_HEADER) ?? '').toLowerCase() === 'on') return true;
  return lateFeesForAll(ctx.db, groupId);
}

// ---------- SQL ----------
// `sp` is a session_players alias (or the table name inside an UPDATE). Every fragment reads only that row and its game.

const game = (sp: string, col: string) => `(SELECT ${col} FROM sessions WHERE id = ${sp}.session_id)`;

/** The seat still holds its payment: unpaid (owes) or paid and not handed back. */
const HOLDS = (sp: string) => `(${sp}.payment_status = 'unpaid' OR (${sp}.payment_status = 'paid' AND ${sp}.refunded_at IS NULL))`;

/** An open late-drop debt (seat left, game went below 4). */
export const OPEN_LATE_DROP = (sp: string) =>
  `(${sp}.status = 'withdrawn' AND ${sp}.played = 0 AND ${sp}.late_drop_at IS NOT NULL AND ${sp}.late_drop_done_at IS NULL)`;

/**
 * Any open late fee on the seat (same rule as lateFeeKind in shared/lateFees.ts). The organizer is never one: the
 * money-back statements already skip them, and other callers add their own check.
 */
export const OPEN_FEE = (sp: string) =>
  `(${sp}.late_drop_done_at IS NULL AND ${HOLDS(sp)} AND (
     (${sp}.status = 'withdrawn' AND ${sp}.played = 0 AND ${sp}.late_drop_at IS NOT NULL)
     OR (${sp}.status = 'confirmed' AND ${game(sp, 'status')} = 'canceled' AND COALESCE(${game(sp, 'canceled_by')}, '') = '${FEE_KEPT}')
     OR (${sp}.status = 'confirmed' AND ${game(sp, 'status')} <> 'canceled' AND ${sp}.played = 0 AND ${sp}.late_drop_at IS NOT NULL
         AND ${sp}.late_drop_at = ${game(sp, 'finalized_at')})))`;

/**
 * SQL for "this seat leaving now leaves the game short": the others still in plus everyone waiting (the first ones
 * move in at once) are fewer than 4. ?sid is the session id, `id` the seat's own row id expression.
 */
export const LEAVES_SHORT = (sessionParam: string, seatId: string, guests = false, need: number = FEE_MIN_PLAYERS) =>
  guests
    ? // Zip 42: everyone else counts, their guests too (in or waiting); this seat's own guest leaves with it. Round 3: `need` 3 asks "short by
      // two" (a host and guest leaving owe both spots), and is also "removing this seat's guest alone leaves the game below 4" (the host stays).
      `((SELECT COALESCE(SUM(1 + CASE WHEN x.guest_name IS NOT NULL AND x.guest_status IN ('confirmed', 'waitlisted') THEN 1 ELSE 0 END), 0)
         FROM session_players x WHERE x.session_id = ${sessionParam} AND x.status IN ('confirmed', 'waitlisted') AND x.id <> ${seatId}) < ${need})`
    : `((SELECT COUNT(*) FROM session_players x WHERE x.session_id = ${sessionParam} AND x.status IN ('confirmed', 'waitlisted') AND x.id <> ${seatId}) < ${FEE_MIN_PLAYERS})`;

/**
 * Round 3 (Zip 42): the oldest open late debt of the game that a sub takes first, as a row id: a seat that left late (OPEN_LATE_DROP, in the
 * order it left), or a host still in who removed their guest late (guest_status 'late', from the moment of the removal).
 */
export const OLDEST_DEBT = (sessionParam: string) =>
  `(SELECT x.id FROM session_players x WHERE x.session_id = ${sessionParam}
      AND (${OPEN_LATE_DROP('x')} OR (x.status = 'confirmed' AND x.guest_status = 'late' AND x.guest_name IS NOT NULL))
    ORDER BY CASE WHEN x.status = 'confirmed' THEN x.guest_at
                  -- A host who owed a removed guest's spot and then dropped too: the debt is as old as that spot (guest_at, set when it became owed).
                  WHEN x.guest_status = 'late' AND x.guest_at IS NOT NULL AND x.guest_at < x.late_drop_at THEN x.guest_at
                  ELSE x.late_drop_at END, x.rowid LIMIT 1)`;

/**
 * After a seat was tagged (late_drop_done_at = the tap's time) for clearing: what is left of the late-drop marks goes,
 * so it reads as an ordinary late drop with its money back. An unpaid seat that owed is simply not owed any more.
 */
export function finishLateDropClear(db: D1Database, sessionId: string, nowIso: string, playerId: string | null): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE session_players SET played = NULL,
         payment_status = CASE WHEN payment_status = 'unpaid' THEN 'not_applicable' ELSE payment_status END,
         updated_at = ?2
       WHERE session_id = ?1 AND status = 'withdrawn' AND played = 0 AND late_drop_done_at = ?2 AND (?3 IS NULL OR player_id = ?3)`,
    )
    .bind(sessionId, nowIso, playerId);
}

/**
 * A sub: someone just got a seat in this batch (confirmed at `nowIso`). The OLDEST open late-drop debt of the game is
 * tagged as cleared (one each, a clear is final). The caller then adds the money-back statements for tagged seats and
 * finishLateDropClear. Nothing happens when the joiner was themselves the debtor (their own seat came back instead).
 */
export function tagOldestLateDrop(db: D1Database, sessionId: string, joinerId: string, nowIso: string, guests = false, guestJoin = false): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE session_players SET late_drop_done_at = ?3, updated_at = ?3
       WHERE id = (SELECT x.id FROM session_players x WHERE x.session_id = ?1 AND ${OPEN_LATE_DROP('x')} ORDER BY x.late_drop_at, x.rowid LIMIT 1)
         AND EXISTS (SELECT 1 FROM session_players j WHERE j.session_id = ?1 AND j.player_id = ?2 AND j.status = 'confirmed' AND ${
           // Zip 42: a guest who just took a spot (its host's row changed at this moment) is a sub too.
           guestJoin ? "j.guest_status = 'confirmed' AND j.updated_at = ?3" : 'j.confirmed_at = ?3'
         })
         -- One clear per game per moment: a losing duplicate tap in the same millisecond (its seat already given) can
         -- never clear a second debt. Two different subs in the very same millisecond clear one; the other stays owed.
         AND NOT EXISTS (SELECT 1 FROM session_players t WHERE t.session_id = ?1 AND t.status = 'withdrawn' AND t.late_drop_at IS NOT NULL AND t.late_drop_done_at = ?3)${
           // Zip 42: a sub that just took a guest's share of a debt (same moment) clears nothing else.
           guests
             ? `
         AND NOT EXISTS (SELECT 1 FROM session_players h WHERE h.session_id = ?1 AND h.status IN ('withdrawn', 'confirmed') AND h.guest_at = ?3 AND h.guest_status IS NULL AND h.guest_name IS NOT NULL)`
             : ''
         }`,
    )
    .bind(sessionId, joinerId, nowIso);
}
