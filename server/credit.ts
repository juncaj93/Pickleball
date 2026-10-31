// The credit pot's database work. Every change is one guarded batch, so two
// taps at the same moment can't spend the same credit twice, and an entry is
// never deleted: undone entries just stop counting (`ended_at`).
//
// Rules live in shared/credit.ts (pure) and in the callers (admin.ts,
// creditActions.ts, finalize.ts); this file only reads and writes.

import { type CreditKind, type CreditReason, type CreditRow, usedBySeat } from '../shared/credit';
import { newId } from './crypto';
import type { D1Database, D1PreparedStatement } from './db';
import { HttpError } from './http';
import { audit, type GroupRow, loadRoster, loadRosters, loadSessions, lookbackIso, organizerIdOf, pricesFor, type SessionRow, settingsOf, visibleFrom } from './repo';

const HISTORY_MS = 90 * 86_400_000;

/**
 * Visible sessions from the last 90 days on (further back while someone still
 * owes), their rosters, the credit pot, credit spent per seat, and credit that
 * came back per seat.
 */
export async function moneyPicture(db: D1Database, group: GroupRow, nowMs: number) {
  const since = await lookbackIso(db, group.id, nowMs, HISTORY_MS);
  const from = visibleFrom(group);
  const sessions = await loadSessions(db, group.id, since, from);
  const rosters = await loadRosters(db, group.id, since, from);
  const ledger = await loadLedger(db, group.id);
  const spent = usedBySeat(ledger);
  const reserved = await loadReserved(db, group.id);
  return { sessions, rosters, ledger, spent, reserved };
}

interface RawRow {
  id: string;
  player_id: string;
  kind: CreditKind;
  amount_cents: number;
  five_cents: number;
  session_id: string | null;
  created_at: string;
  ended_at: string | null;
  ended_reason: string | null;
  reason: string | null;
  played_count: number | null;
}

export type LedgerRow = CreditRow & { endedReason: string | null };

export async function loadLedger(db: D1Database, groupId: string): Promise<LedgerRow[]> {
  const { results } = await db
    .prepare('SELECT * FROM credit_ledger WHERE group_id = ? ORDER BY created_at, rowid')
    .bind(groupId)
    .all<RawRow>();
  return results.map((r) => ({
    id: r.id,
    playerId: r.player_id,
    kind: r.kind,
    cents: r.amount_cents,
    fiveCents: r.five_cents,
    sessionId: r.session_id,
    createdAt: r.created_at,
    endedAt: r.ended_at,
    endedReason: r.ended_reason,
    reason: (r.reason as CreditReason | null) ?? null,
    playedCount: r.played_count,
  }));
}

export interface RefundRequestRow {
  id: string;
  group_id: string;
  player_id: string;
  amount_cents: number;
  status: 'pending' | 'refunded' | 'canceled' | 'declined';
  created_at: string;
  resolved_at: string | null;
  ledger_id: string | null;
}

/** Pending refund requests, oldest first. */
export async function loadPendingRequests(db: D1Database, groupId: string): Promise<RefundRequestRow[]> {
  const { results } = await db
    .prepare("SELECT * FROM refund_requests WHERE group_id = ? AND status = 'pending' ORDER BY created_at, rowid")
    .bind(groupId)
    .all<RefundRequestRow>();
  return results;
}

/** Credit reserved by a pending refund request, per player. */
export async function loadReserved(db: D1Database, groupId: string): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for (const r of await loadPendingRequests(db, groupId)) out.set(r.player_id, (out.get(r.player_id) ?? 0) + r.amount_cents);
  return out;
}

/** Whether the player has a refund request waiting on the organizer. */
export async function hasPendingRequest(db: D1Database, playerId: string): Promise<boolean> {
  return !!(await db.prepare("SELECT 1 FROM refund_requests WHERE player_id = ? AND status = 'pending' LIMIT 1").bind(playerId).first());
}

/** SQL for a player's pot right now (`player` is a bound parameter like "?3"). */
const POT = (player: string) =>
  `(SELECT COALESCE(SUM(CASE kind WHEN 'kept' THEN amount_cents WHEN 'used' THEN -amount_cents ELSE -(amount_cents - five_cents) END), 0)
    FROM credit_ledger WHERE player_id = ${player} AND ended_at IS NULL)`;
/** SQL for what a pending refund request holds back. */
const RESERVED = (player: string) => `(SELECT COALESCE(SUM(amount_cents), 0) FROM refund_requests WHERE player_id = ${player} AND status = 'pending')`;
/** SQL for what a player can spend or ask back right now: the pot minus a pending request. */
export const USABLE = (player: string) => `(${POT(player)} - ${RESERVED(player)})`;

/**
 * Credit used on a game goes back to the player: they dropped out of it, it
 * was canceled, or the organizer unmarked the payment. The payment shrinks by
 * the credit part; when nothing else was paid, the seat is simply unpaid again.
 * Returns the cents that went back.
 *
 * Cash paid earlier toward the seat (a 'cash' pair) is not credit: on a drop
 * or a cancel it becomes a plain credit entry with that reason; when the
 * organizer unmarks the payment it is simply gone (the payment never
 * happened); a player's own undo of "Use credit" leaves it alone.
 */
export async function returnSeatCredit(
  db: D1Database,
  sessionId: string,
  playerId: string,
  nowIso: string,
  reason: 'dropped' | 'canceled' | 'unmarked' | 'undone',
  /** Only credit from the pot, never a 'cash' pair (the organizer taking credit off a seat that still owes). */
  opts: { creditOnly?: boolean } = {},
): Promise<number> {
  const { results } = await db
    .prepare("SELECT id, amount_cents, reason, group_id FROM credit_ledger WHERE kind = 'used' AND session_id = ? AND player_id = ? AND ended_at IS NULL")
    .bind(sessionId, playerId)
    .all<{ id: string; amount_cents: number; reason: string | null; group_id: string }>();
  const rows = reason === 'undone' || opts.creditOnly ? results.filter((r) => r.reason !== 'cash') : results;
  if (rows.length === 0) return 0;
  const total = rows.reduce((sum, r) => sum + r.amount_cents, 0);
  const cash = rows.filter((r) => r.reason === 'cash').reduce((sum, r) => sum + r.amount_cents, 0);
  const gone = 'COALESCE(payment_amount_cents, 0) - ?1 <= 0';
  const ids = rows.map((r) => r.id);
  await db.batch([
    db
      .prepare(`UPDATE credit_ledger SET ended_at = ?1, ended_reason = ?2 WHERE id IN (${ids.map((_, i) => `?${i + 3}`).join(', ')}) AND ended_at IS NULL`)
      .bind(nowIso, reason, ...ids),
    // The matching +cash rows end too; on a drop or a cancel that cash comes back as one plain credit entry.
    ...(cash > 0
      ? [
          db
            .prepare("UPDATE credit_ledger SET ended_at = ?1, ended_reason = ?2 WHERE kind = 'kept' AND reason = 'cash' AND session_id = ?3 AND player_id = ?4 AND ended_at IS NULL")
            .bind(nowIso, reason, sessionId, playerId),
          ...(reason === 'dropped' || reason === 'canceled'
            ? [
                db
                  .prepare(
                    `INSERT INTO credit_ledger (id, group_id, player_id, kind, amount_cents, session_id, created_at, reason) VALUES (?1, ?2, ?3, 'kept', ?4, ?5, ?6, ?7)`,
                  )
                  .bind(newId(), rows[0].group_id, playerId, cash, sessionId, nowIso, reason),
              ]
            : []),
        ]
      : []),
    // Only a paid seat carries the credit inside its payment; an unpaid one just owes more again.
    db
      .prepare(
        `UPDATE session_players SET
           payment_status = CASE WHEN ${gone} THEN (CASE WHEN status = 'confirmed' THEN 'unpaid' ELSE 'not_applicable' END) ELSE payment_status END,
           paid_at = CASE WHEN ${gone} THEN NULL ELSE paid_at END,
           self_paid_at = CASE WHEN ${gone} THEN NULL ELSE self_paid_at END,
           payment_amount_cents = CASE WHEN ${gone} THEN NULL ELSE payment_amount_cents - ?1 END,
           payment_updated_at = ?2, updated_at = ?2
         WHERE session_id = ?3 AND player_id = ?4 AND payment_status = 'paid'`,
      )
      .bind(total, nowIso, sessionId, playerId),
  ]);
  return total;
}

/**
 * The price of a seat can change when the game is finalized (or reopened). A
 * seat paid with credit that is now short is put back to unpaid, keeping the
 * credit already used on it, so the player sees exactly what is left to pay.
 * An unpaid seat whose used credit now covers the price is paid.
 */
export async function repriceCreditSeats(db: D1Database, sessionId: string, nowIso: string): Promise<void> {
  const session = await db.prepare('SELECT * FROM sessions WHERE id = ?').bind(sessionId).first<SessionRow>();
  if (!session || session.status === 'canceled') return;
  const group = await db.prepare('SELECT * FROM groups WHERE id = ?').bind(session.group_id).first<GroupRow>();
  if (!group) return;
  const { results: used } = await db
    .prepare("SELECT player_id, SUM(amount_cents) AS cents FROM credit_ledger WHERE kind = 'used' AND session_id = ? AND ended_at IS NULL GROUP BY player_id")
    .bind(sessionId)
    .all<{ player_id: string; cents: number }>();
  if (used.length === 0) return;
  const roster = await loadRoster(db, sessionId);
  const prices = pricesFor(session, roster, settingsOf(group));
  for (const u of used) {
    const row = roster.find((r) => r.player_id === u.player_id);
    const price = prices.get(u.player_id)?.cents;
    if (!row || row.status !== 'confirmed' || price === undefined) continue;
    if (row.payment_status === 'paid') {
      if ((row.payment_amount_cents ?? 0) >= price) continue;
      await db
        .prepare(
          `UPDATE session_players SET payment_status = 'unpaid', paid_at = NULL, payment_amount_cents = NULL, self_paid_at = NULL,
             payment_updated_at = ?, updated_at = ? WHERE session_id = ? AND player_id = ? AND payment_status = 'paid'`,
        )
        .bind(nowIso, nowIso, sessionId, u.player_id)
        .run();
    } else if (row.payment_status === 'unpaid' && u.cents >= price) {
      await db
        .prepare(
          `UPDATE session_players SET payment_status = 'paid', paid_at = ?, payment_amount_cents = ?, self_paid_at = NULL,
             payment_updated_at = ?, updated_at = ? WHERE session_id = ? AND player_id = ? AND payment_status = 'unpaid'`,
        )
        .bind(nowIso, u.cents, nowIso, nowIso, sessionId, u.player_id)
        .run();
    }
  }
}

/** Everyone in a session whose credit should go back (the session was canceled). */
export async function returnSessionCredit(db: D1Database, sessionId: string, nowIso: string): Promise<number> {
  const { results } = await db
    .prepare("SELECT DISTINCT player_id FROM credit_ledger WHERE kind = 'used' AND session_id = ? AND ended_at IS NULL")
    .bind(sessionId)
    .all<{ player_id: string }>();
  let total = 0;
  for (const r of results) total += await returnSeatCredit(db, sessionId, r.player_id, nowIso, 'canceled');
  return total;
}

/**
 * Money from a seat comes back to the player as credit: a 'kept' entry with
 * its reason. With `settle`, the seat's payment is marked settled
 * (`refunded_at`), so it is no longer held and a later sign-up owes again;
 * that is for money coming back in full (dropped, canceled, did not play).
 * Without it, only the part above the final price comes back and the payment
 * stays as what they paid. Returns false when nothing was there to keep.
 */
export async function creditBack(
  db: D1Database,
  args: {
    groupId: string;
    sessionId: string;
    playerId: string;
    cents: number;
    reason: CreditReason;
    playedCount?: number | null;
    nowIso: string;
    settle: boolean;
    /** Only while the seat still has this status (a drop: still out, not back in from a second phone). */
    seatStatus?: 'withdrawn';
  },
): Promise<boolean> {
  const { groupId, sessionId, playerId, cents, reason, playedCount, nowIso, settle, seatStatus } = args;
  if (cents <= 0) return false;
  const entry = newId();
  const there = 'EXISTS (SELECT 1 FROM credit_ledger WHERE id = ?1 AND ended_at IS NULL)';
  // The seat must still carry a live payment. Settling guards itself (an unsettled seat has exactly one live
  // payment); a part-back entry (the part above the final price) must not already exist for it.
  const seatOk = settle
    ? `EXISTS (SELECT 1 FROM session_players WHERE session_id = ?5 AND player_id = ?3 AND payment_status = 'paid' AND refunded_at IS NULL${seatStatus ? ` AND status = '${seatStatus}'` : ''})`
    : `EXISTS (SELECT 1 FROM session_players sp WHERE sp.session_id = ?5 AND sp.player_id = ?3 AND sp.payment_status = 'paid' AND sp.refunded_at IS NULL)
       AND NOT EXISTS (SELECT 1 FROM credit_ledger l WHERE l.session_id = ?5 AND l.player_id = ?3 AND l.kind = 'kept' AND l.reason = ?7 AND l.ended_at IS NULL)`;
  const out = await db.batch([
    db
      .prepare(
        `INSERT INTO credit_ledger (id, group_id, player_id, kind, amount_cents, session_id, created_at, reason, played_count)
         SELECT ?1, ?2, ?3, 'kept', ?4, ?5, ?6, ?7, ?8
         WHERE ${seatOk}`,
      )
      .bind(entry, groupId, playerId, cents, sessionId, nowIso, reason, playedCount ?? null),
    ...(settle
      ? [
          db
            .prepare(`UPDATE session_players SET refunded_at = ?2, updated_at = ?2 WHERE session_id = ?3 AND player_id = ?4 AND refunded_at IS NULL AND ${there}`)
            .bind(entry, nowIso, sessionId, playerId),
        ]
      : []),
  ]);
  return out[0].meta.changes === 1;
}

/**
 * Take back credit that came from a seat (reopening a finalized game, or
 * unmarking a payment that had credit back). Only while that credit is still
 * all there: if some was spent or paid back, it can't be undone. Settled
 * seats become unsettled again.
 */
export async function undoCreditBack(db: D1Database, sessionId: string, playerId: string, reasons: CreditReason[], nowIso: string): Promise<{ undone: number; blocked: boolean }> {
  const { results } = await db
    .prepare(
      `SELECT id, amount_cents, reason FROM credit_ledger WHERE kind = 'kept' AND session_id = ? AND player_id = ? AND ended_at IS NULL AND reason IN (${reasons.map(() => '?').join(', ')})`,
    )
    .bind(sessionId, playerId, ...reasons)
    .all<{ id: string; amount_cents: number; reason: CreditReason }>();
  if (results.length === 0) return { undone: 0, blocked: false };
  const total = results.reduce((sum, r) => sum + r.amount_cents, 0);
  const ids = results.map((r) => r.id);
  // Numbered placeholders only: the ids take ?4 onward.
  const idList = ids.map((_, i) => `?${i + 4}`).join(', ');
  const ended = `(SELECT COUNT(*) FROM credit_ledger WHERE id IN (${idList}) AND ended_at = ?1) = ${ids.length}`;
  const out = await db.batch([
    // All or nothing: every entry ends only if the pot still holds the whole
    // amount on top of what a pending refund request is holding back.
    db
      .prepare(
        `UPDATE credit_ledger SET ended_at = ?1, ended_reason = 'undone'
         WHERE id IN (${idList}) AND ended_at IS NULL AND ${POT('?2')} - ${RESERVED('?2')} - ?3 >= 0`,
      )
      .bind(nowIso, playerId, total, ...ids),
    db
      .prepare(`UPDATE session_players SET refunded_at = NULL, updated_at = ?1 WHERE session_id = ?2 AND player_id = ?3 AND refunded_at IS NOT NULL AND ${ended}`)
      .bind(nowIso, sessionId, playerId, ...ids),
  ]);
  if (out[0].meta.changes !== results.length) return { undone: 0, blocked: true };
  return { undone: total, blocked: false };
}

/**
 * "Use credit" on a game the player owes for. The credit entry goes in only
 * while the usable pot (minus any pending refund request) still covers it and
 * the seat still owes exactly what was worked out (`alreadyUsed`), so a
 * double tap spends nothing twice. When the credit covers the whole amount
 * the seat is marked paid in the same step, with `paidCents` as its payment.
 */
export async function spendCredit(
  db: D1Database,
  args: {
    groupId: string;
    sessionId: string;
    playerId: string;
    cents: number;
    alreadyUsed: number;
    /** Set when this use pays the seat in full: the seat's payment. */
    payInFull: { paidCents: number } | null;
    nowIso: string;
  },
): Promise<boolean> {
  const { groupId, sessionId, playerId, cents, alreadyUsed, payInFull, nowIso } = args;
  const entry = newId();
  const there = 'EXISTS (SELECT 1 FROM credit_ledger WHERE id = ?1 AND ended_at IS NULL)';
  const out = await db.batch([
    db
      .prepare(
        `INSERT INTO credit_ledger (id, group_id, player_id, kind, amount_cents, session_id, created_at)
         SELECT ?1, ?2, ?3, 'used', ?4, ?5, ?6
         WHERE ${POT('?3')} - ${RESERVED('?3')} >= ?4
           AND (SELECT COALESCE(SUM(amount_cents), 0) FROM credit_ledger WHERE kind = 'used' AND session_id = ?5 AND player_id = ?3 AND ended_at IS NULL) = ?7
           AND EXISTS (SELECT 1 FROM session_players WHERE session_id = ?5 AND player_id = ?3 AND status = 'confirmed' AND payment_status = 'unpaid')
           AND (SELECT status FROM sessions WHERE id = ?5) <> 'canceled'`,
      )
      .bind(entry, groupId, playerId, cents, sessionId, nowIso, alreadyUsed),
    ...(payInFull
      ? [
          db
            .prepare(
              `UPDATE session_players SET payment_status = 'paid', paid_at = ?2, payment_amount_cents = ?5, self_paid_at = NULL,
                 payment_updated_at = ?2, updated_at = ?2
               WHERE session_id = ?3 AND player_id = ?4 AND payment_status = 'unpaid' AND ${there}`,
            )
            .bind(entry, nowIso, sessionId, playerId, payInFull.paidCents),
        ]
      : []),
  ]);
  return out[0].meta.changes === 1;
}

/**
 * Credit paid back by hand on Venmo: a 'refunded' entry for exactly `cents`.
 * For a player's request, the request is closed in the same step and the
 * amount must still be in the pot. For the organizer's own "Refund credit
 * balance", `cents` must be the whole usable balance (pot minus any pending
 * request). Opening Venmo never does this; only "Mark refunded" does.
 */
export async function refundCredit(
  db: D1Database,
  args: { groupId: string; playerId: string; cents: number; requestId: string | null; nowIso: string },
): Promise<boolean> {
  const { groupId, playerId, cents, requestId, nowIso } = args;
  const entry = newId();
  const there = 'EXISTS (SELECT 1 FROM credit_ledger WHERE id = ?1 AND ended_at IS NULL)';
  const guard = requestId
    ? `${POT('?3')} >= ?4 AND EXISTS (SELECT 1 FROM refund_requests WHERE id = ?7 AND player_id = ?3 AND status = 'pending' AND amount_cents = ?4)`
    : `${POT('?3')} - ${RESERVED('?3')} = ?4`;
  const out = await db.batch([
    db
      .prepare(
        `INSERT INTO credit_ledger (id, group_id, player_id, kind, amount_cents, five_cents, created_at, reason)
         SELECT ?1, ?2, ?3, 'refunded', ?4, 0, ?5, ?6 WHERE ${guard}`,
      )
      // Only the request path has a ?7; SQLite refuses a value with no placeholder.
      .bind(entry, groupId, playerId, cents, nowIso, requestId ? 'request' : null, ...(requestId ? [requestId] : [])),
    ...(requestId
      ? [
          db
            .prepare(`UPDATE refund_requests SET status = 'refunded', resolved_at = ?2, ledger_id = ?1 WHERE id = ?3 AND status = 'pending' AND ${there}`)
            .bind(entry, nowIso, requestId),
        ]
      : []),
  ]);
  return out[0].meta.changes === 1;
}

/**
 * Cash someone paid toward a seat whose price then went up (a reopen and a
 * redo with fewer players): the seat goes back to unpaid, and a matched pair
 * (+kept, -used, both reason 'cash') holds the cash against it, so the pot
 * is unchanged and the seat owes the rest.
 */
export async function holdCashAgainstSeat(db: D1Database, args: { groupId: string; sessionId: string; playerId: string; cents: number; nowIso: string }): Promise<boolean> {
  const { groupId, sessionId, playerId, cents, nowIso } = args;
  if (cents <= 0) return false;
  const kept = newId();
  const out = await db.batch([
    db
      .prepare(
        `UPDATE session_players SET payment_status = 'unpaid', paid_at = NULL, payment_amount_cents = NULL, self_paid_at = NULL, payment_updated_at = ?1, updated_at = ?1
         WHERE session_id = ?2 AND player_id = ?3 AND payment_status = 'paid' AND refunded_at IS NULL AND status = 'confirmed'`,
      )
      .bind(nowIso, sessionId, playerId),
    db
      .prepare(`INSERT INTO credit_ledger (id, group_id, player_id, kind, amount_cents, session_id, created_at, reason) VALUES (?1, ?2, ?3, 'kept', ?4, ?5, ?6, 'cash')`)
      .bind(kept, groupId, playerId, cents, sessionId, nowIso),
    db
      .prepare(`INSERT INTO credit_ledger (id, group_id, player_id, kind, amount_cents, session_id, created_at, reason) VALUES (?1, ?2, ?3, 'used', ?4, ?5, ?6, 'cash')`)
      .bind(newId(), groupId, playerId, cents, sessionId, nowIso),
  ]);
  return out[0].meta.changes === 1;
}

/**
 * Take back "Mark refunded": that refund entry (the last one, or the one a
 * request points at) stops counting and the balance comes back. A refund
 * that answered a request puts the request back to pending (its amount is
 * reserved again).
 */
export async function undoRefund(db: D1Database, playerId: string, nowIso: string, ledgerId: string | null = null): Promise<boolean> {
  const last = ledgerId
    ? await db.prepare("SELECT id FROM credit_ledger WHERE id = ? AND kind = 'refunded' AND player_id = ? AND ended_at IS NULL").bind(ledgerId, playerId).first<{ id: string }>()
    : await db
        .prepare("SELECT id FROM credit_ledger WHERE kind = 'refunded' AND player_id = ? AND ended_at IS NULL ORDER BY created_at DESC, rowid DESC")
        .bind(playerId)
        .first<{ id: string }>();
  if (!last) return false;
  const ended = 'EXISTS (SELECT 1 FROM credit_ledger WHERE id = ?1 AND ended_at = ?2)';
  const out = await db.batch([
    db.prepare("UPDATE credit_ledger SET ended_at = ?2, ended_reason = 'undone' WHERE id = ?1 AND ended_at IS NULL").bind(last.id, nowIso),
    db
      .prepare(
        `UPDATE refund_requests SET status = 'pending', resolved_at = NULL, ledger_id = NULL
         WHERE ledger_id = ?1 AND status = 'refunded' AND ${ended}
           AND NOT EXISTS (SELECT 1 FROM refund_requests r2 WHERE r2.player_id = refund_requests.player_id AND r2.status = 'pending')`,
      )
      .bind(last.id, nowIso),
  ]);
  return out[0].meta.changes === 1;
}

// ---------- Credit used automatically at sign-up ----------

/** What auto credit needs to know about a game: who never uses credit (the organizer) and what a seat costs. */
export interface AutoCredit {
  groupId: string;
  organizerId: string | null;
  priceCents: number;
}

/**
 * Auto credit for a game, or null when a new seat there can't take any: the
 * game is canceled or already finalized (nobody signs up then anyway).
 */
export async function autoCreditFor(db: D1Database, session: SessionRow): Promise<AutoCredit | null> {
  if (session.status === 'canceled' || session.finalized_at) return null;
  const group = await db.prepare('SELECT * FROM groups WHERE id = ?').bind(session.group_id).first<GroupRow>();
  if (!group) return null;
  return { groupId: group.id, organizerId: await organizerIdOf(db, group), priceCents: settingsOf(group).pricePerPlayerCents };
}

/**
 * The statements that use a player's credit on the seat they just got. They
 * go in the SAME batch as the statement that gives the seat, so the seat and
 * the credit happen together or not at all.
 *
 * The credit entry goes in only when, at that moment:
 * - the seat was confirmed by this very batch (confirmed at `nowIso`) and owes,
 * - no credit is on the seat yet (a double tap, a retry or a second device spends nothing twice),
 * - the game is not canceled or finalized,
 * - the player has usable credit (the pot minus a pending cash-out request).
 * It takes the smaller of the usable credit and the price, worked out in the
 * database itself, so two games tapped at once can never spend the same
 * dollars. When it covers the whole price the seat is paid in the same step.
 * The organizer never uses credit: nothing is added for them.
 */
export function autoCreditStatements(db: D1Database, auto: AutoCredit, sessionId: string, playerId: string, nowIso: string): D1PreparedStatement[] {
  if (playerId === auto.organizerId) return [];
  const entry = newId();
  const usable = `(${POT('?3')} - ${RESERVED('?3')})`;
  return [
    db
      .prepare(
        `INSERT INTO credit_ledger (id, group_id, player_id, kind, amount_cents, session_id, created_at, reason)
         SELECT ?1, ?2, ?3, 'used', MIN(?4, ${usable}), ?5, ?6, 'auto'
         WHERE ${usable} > 0
           AND EXISTS (SELECT 1 FROM session_players WHERE session_id = ?5 AND player_id = ?3 AND status = 'confirmed' AND payment_status = 'unpaid' AND confirmed_at = ?6)
           AND NOT EXISTS (SELECT 1 FROM credit_ledger WHERE kind = 'used' AND session_id = ?5 AND player_id = ?3 AND ended_at IS NULL)
           AND EXISTS (SELECT 1 FROM sessions WHERE id = ?5 AND status <> 'canceled' AND finalized_at IS NULL)`,
      )
      .bind(entry, auto.groupId, playerId, auto.priceCents, sessionId, nowIso),
    db
      .prepare(
        `UPDATE session_players SET payment_status = 'paid', paid_at = ?2, payment_amount_cents = ?5, self_paid_at = NULL,
           payment_updated_at = ?2, updated_at = ?2
         WHERE session_id = ?3 AND player_id = ?4 AND status = 'confirmed' AND payment_status = 'unpaid'
           AND (SELECT amount_cents FROM credit_ledger WHERE id = ?1 AND ended_at IS NULL) >= ?5`,
      )
      .bind(entry, nowIso, sessionId, playerId, auto.priceCents),
  ];
}

/**
 * What auto credit did on a seat at `nowIso` (0 when nothing), and whether it
 * paid the seat. Logs it in History > Activity under the player's name.
 */
export async function auditAutoCredit(db: D1Database, groupId: string, sessionId: string, playerId: string, nowIso: string): Promise<{ cents: number; paid: boolean }> {
  const row = await db
    .prepare(
      `SELECT COALESCE(SUM(l.amount_cents), 0) AS cents,
         (SELECT payment_status FROM session_players WHERE session_id = ?1 AND player_id = ?2) AS status,
         (SELECT display_name FROM players WHERE id = ?2) AS name
       FROM credit_ledger l WHERE l.kind = 'used' AND l.reason = 'auto' AND l.session_id = ?1 AND l.player_id = ?2 AND l.created_at = ?3 AND l.ended_at IS NULL`,
    )
    .bind(sessionId, playerId, nowIso)
    .first<{ cents: number; status: string | null; name: string | null }>();
  const cents = row?.cents ?? 0;
  if (cents <= 0) return { cents: 0, paid: false };
  const paid = row?.status === 'paid';
  const name = row?.name ?? 'A player';
  await audit(db, groupId, sessionId, 'credit_used', { player: name, amountCents: cents, paidInFull: paid, auto: true }, nowIso, name);
  return { cents, paid };
}

/**
 * The pending cash-out request a player could use on a seat that still owes
 * after their usable credit: "Use the $10 you asked to cash out for this
 * game?". Only when it matters: the seat is confirmed and unpaid, still owes,
 * and a request is pending. `cents` is the part of the request it would take.
 */
export async function cashOutOffer(db: D1Database, session: SessionRow, playerId: string): Promise<{ requestId: string; requestCents: number; cents: number; owedCents: number; usableCents: number } | null> {
  if (session.status === 'canceled' || session.finalized_at) return null;
  const row = await db
    .prepare(
      `SELECT r.id AS request_id, r.amount_cents AS request_cents,
         ${POT('?2')} - ${RESERVED('?2')} AS usable,
         (SELECT COALESCE(SUM(amount_cents), 0) FROM credit_ledger WHERE kind = 'used' AND session_id = ?1 AND player_id = ?2 AND ended_at IS NULL) AS used
       FROM refund_requests r
       WHERE r.player_id = ?2 AND r.status = 'pending'
         AND EXISTS (SELECT 1 FROM session_players WHERE session_id = ?1 AND player_id = ?2 AND status = 'confirmed' AND payment_status = 'unpaid')`,
    )
    .bind(session.id, playerId)
    .first<{ request_id: string; request_cents: number; usable: number; used: number }>();
  if (!row) return null;
  const group = await db.prepare('SELECT * FROM groups WHERE id = ?').bind(session.group_id).first<GroupRow>();
  if (!group || playerId === (await organizerIdOf(db, group))) return null;
  const owed = settingsOf(group).pricePerPlayerCents - row.used;
  const usable = Math.max(0, row.usable);
  // Usable credit already covers it: nothing to ask.
  if (owed <= 0 || usable >= owed) return null;
  const cents = Math.min(row.request_cents, owed - usable);
  if (cents <= 0) return null;
  return { requestId: row.request_id, requestCents: row.request_cents, cents, owedCents: owed, usableCents: usable };
}

/**
 * "Use it" on that prompt: the usable credit and `fromRequest` dollars of the
 * pending cash-out request go on the seat, and the request shrinks by that
 * much (or is withdrawn when all of it is used). One batch: the credit entry
 * goes in only while the pot, the request and the seat are exactly as worked
 * out, and the request changes only if the entry went in.
 */
export async function useCashOutOnSeat(
  db: D1Database,
  args: {
    groupId: string;
    sessionId: string;
    playerId: string;
    requestId: string;
    requestCents: number;
    usableCents: number;
    fromRequest: number;
    alreadyUsed: number;
    priceCents: number;
    nowIso: string;
  },
): Promise<boolean> {
  const { groupId, sessionId, playerId, requestId, requestCents, usableCents, fromRequest, alreadyUsed, priceCents, nowIso } = args;
  const cents = usableCents + fromRequest;
  if (fromRequest <= 0 || fromRequest > requestCents || alreadyUsed + cents > priceCents) return false;
  const entry = newId();
  const there = 'EXISTS (SELECT 1 FROM credit_ledger WHERE id = ?1 AND ended_at IS NULL)';
  const all = fromRequest === requestCents;
  const out = await db.batch([
    db
      .prepare(
        `INSERT INTO credit_ledger (id, group_id, player_id, kind, amount_cents, session_id, created_at, reason)
         SELECT ?1, ?2, ?3, 'used', ?4, ?5, ?6, 'auto'
         WHERE ${POT('?3')} - ${RESERVED('?3')} = ?7
           AND EXISTS (SELECT 1 FROM refund_requests WHERE id = ?8 AND player_id = ?3 AND status = 'pending' AND amount_cents = ?9)
           AND (SELECT COALESCE(SUM(amount_cents), 0) FROM credit_ledger WHERE kind = 'used' AND session_id = ?5 AND player_id = ?3 AND ended_at IS NULL) = ?10
           AND EXISTS (SELECT 1 FROM session_players WHERE session_id = ?5 AND player_id = ?3 AND status = 'confirmed' AND payment_status = 'unpaid')
           AND EXISTS (SELECT 1 FROM sessions WHERE id = ?5 AND status <> 'canceled' AND finalized_at IS NULL)`,
      )
      .bind(entry, groupId, playerId, cents, sessionId, nowIso, usableCents, requestId, requestCents, alreadyUsed),
    db
      .prepare(
        all
          ? `UPDATE refund_requests SET status = 'canceled', resolved_at = ?2 WHERE id = ?3 AND status = 'pending' AND ${there}`
          : `UPDATE refund_requests SET amount_cents = amount_cents - ?4 WHERE id = ?3 AND status = 'pending' AND amount_cents = ?5 AND ${there}`,
      )
      .bind(entry, nowIso, requestId, ...(all ? [] : [fromRequest, requestCents])),
    db
      .prepare(
        `UPDATE session_players SET payment_status = 'paid', paid_at = ?2, payment_amount_cents = ?5, self_paid_at = NULL,
           payment_updated_at = ?2, updated_at = ?2
         WHERE session_id = ?3 AND player_id = ?4 AND payment_status = 'unpaid' AND ${there}
           AND (SELECT COALESCE(SUM(amount_cents), 0) FROM credit_ledger WHERE kind = 'used' AND session_id = ?3 AND player_id = ?4 AND ended_at IS NULL) >= ?5`,
      )
      .bind(entry, nowIso, sessionId, playerId, priceCents),
  ]);
  return out[0].meta.changes === 1;
}

/** The pot is never negative: a guard for callers that need to refuse early with a clear message. */
export function assertCents(cents: number, what: string): void {
  if (!Number.isInteger(cents) || cents <= 0) throw new HttpError(400, 'invalid_cents', `${what} must be a whole-dollar amount above $0.`);
}
