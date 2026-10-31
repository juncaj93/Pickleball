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
import { audit, type GroupRow, loadRosters, loadSessions, lookbackIso, organizerIdOf, type SessionRow, settingsOf, visibleFrom } from './repo';

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

// ---------- Money coming back from a seat ----------
//
// Every amount below is worked out INSIDE the database, from the rows as they
// are at that moment, and every statement only does something while there is
// still something to do. So the statements can run in the same batch as the
// change that causes them (a drop, a cancel, an unmark), a retry or a second
// tap finds nothing left and changes nothing, and a request that dies halfway
// can't leave money half-moved (a batch is all or nothing).

/** SQL for the live credit (from the pot) used on the seat of row `sp` of session_players. */
const SEAT_USED = (sp: string) =>
  `(SELECT COALESCE(SUM(l.amount_cents), 0) FROM credit_ledger l
    WHERE l.kind = 'used' AND l.session_id = ${sp}.session_id AND l.player_id = ${sp}.player_id AND l.ended_at IS NULL AND COALESCE(l.reason, '') <> 'cash')`;
/** SQL for the live cash held against that seat (a 'cash' pair: paid earlier, before its price went up). */
const SEAT_CASH = (sp: string) =>
  `(SELECT COALESCE(SUM(l.amount_cents), 0) FROM credit_ledger l
    WHERE l.kind = 'used' AND l.session_id = ${sp}.session_id AND l.player_id = ${sp}.player_id AND l.ended_at IS NULL AND l.reason = 'cash')`;
/** SQL for the cash in the seat's payment beyond the credit and held cash on it (0 when not paid, or settled). */
const SEAT_LEFTOVER = (sp: string) =>
  `MAX(0, (CASE WHEN ${sp}.payment_status = 'paid' AND ${sp}.refunded_at IS NULL THEN COALESCE(${sp}.payment_amount_cents, 0) ELSE 0 END) - ${SEAT_USED(sp)} - ${SEAT_CASH(sp)})`;
/** A new random id made by SQLite itself (same shape as newId()), for rows inserted from a SELECT over several seats. */
const SQL_ID = `lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-'
  || substr('89ab', (abs(random()) % 4) + 1, 1) || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6)))`;

/**
 * Everything a seat holds goes back to the player as credit: they dropped out
 * (`reason` 'dropped') or the game was canceled ('canceled'). Credit used on
 * it goes back to their pot, and the cash they paid toward it (and cash held
 * against it) becomes one new credit entry with that reason. The organizer's
 * own court payment never becomes credit.
 *
 * `when(alias)` is the SQL condition a seat must meet, written over the
 * session_players alias given ("the seat is withdrawn", "the game is
 * canceled"), so these statements can go in the same batch as the change.
 * `playerId` limits it to one seat; without it, every seat in the game.
 */
export function seatMoneyBackStatements(
  db: D1Database,
  args: {
    groupId: string;
    sessionId: string;
    playerId: string | null;
    organizerId: string | null;
    reason: 'dropped' | 'canceled';
    nowIso: string;
    when: (sp: string) => string;
    /** The id for the new credit entry when it is one seat (so the caller can read back exactly what this batch added). */
    entryId?: string;
  },
): D1PreparedStatement[] {
  const { groupId, sessionId, playerId, organizerId, reason, nowIso, when, entryId } = args;
  // ?1 now, ?2 reason, ?3 session, ?4 organizer ('' for none), ?5 player (NULL for every seat), ?6 group, ?7 entry id.
  const seat = (sp: string) => `${sp}.session_id = ?3 AND (?5 IS NULL OR ${sp}.player_id = ?5)`;
  // Never the organizer, and never a court-payment row (status 'declined' and paid: only the organizer has those).
  const notOrganizer = (sp: string) => `${sp}.player_id <> ?4 AND ${sp}.status <> 'declined'`;
  const values = [nowIso, reason, sessionId, organizerId ?? '', playerId, groupId, entryId ?? null];
  // Each statement gets values up to the highest ?N it uses (SQLite refuses extra ones).
  const bind = (sql: string) => db.prepare(sql).bind(...values.slice(0, Math.max(...[...sql.matchAll(/\?(\d+)/g)].map((m) => Number(m[1])))));
  return [
    // 1. The cash part comes back as one credit entry (read before anything below changes the seat).
    bind(
      `INSERT INTO credit_ledger (id, group_id, player_id, kind, amount_cents, session_id, created_at, reason)
         SELECT COALESCE(?7, ${SQL_ID}), ?6, sp.player_id, 'kept', ${SEAT_CASH('sp')} + ${SEAT_LEFTOVER('sp')}, sp.session_id, ?1, ?2
         FROM session_players sp
         WHERE ${seat('sp')} AND ${notOrganizer('sp')} AND ${when('sp')} AND ${SEAT_CASH('sp')} + ${SEAT_LEFTOVER('sp')} > 0`,
    ),
    // 2. The seat's payment: the cash that became credit stays recorded as what they paid, settled (it is
    //    credit now, so a rejoin owes again); a payment that was all credit is simply gone.
    bind(
      `UPDATE session_players SET
           payment_status = CASE WHEN ${SEAT_LEFTOVER('session_players')} > 0 THEN 'paid' WHEN status = 'confirmed' THEN 'unpaid' ELSE 'not_applicable' END,
           paid_at = CASE WHEN ${SEAT_LEFTOVER('session_players')} > 0 THEN paid_at ELSE NULL END,
           self_paid_at = CASE WHEN ${SEAT_LEFTOVER('session_players')} > 0 THEN self_paid_at ELSE NULL END,
           refunded_at = CASE WHEN ${SEAT_LEFTOVER('session_players')} > 0 THEN ?1 ELSE refunded_at END,
           payment_amount_cents = CASE WHEN ${SEAT_LEFTOVER('session_players')} > 0 THEN ${SEAT_LEFTOVER('session_players')} ELSE NULL END,
           payment_updated_at = ?1, updated_at = ?1
         WHERE ${seat('session_players')} AND ${notOrganizer('session_players')} AND ${when('session_players')}
           AND payment_status = 'paid' AND refunded_at IS NULL`,
    ),
    // 3. Credit used on it goes back to the pot, and held cash pairs end (their cash is in the entry above).
    bind(
      `UPDATE credit_ledger SET ended_at = ?1, ended_reason = ?2
         WHERE session_id = ?3 AND (?5 IS NULL OR player_id = ?5) AND ended_at IS NULL
           AND (kind = 'used' OR (kind = 'kept' AND reason = 'cash'))
           AND EXISTS (SELECT 1 FROM session_players sp WHERE sp.session_id = credit_ledger.session_id AND sp.player_id = credit_ledger.player_id AND ${when('sp')})`,
    ),
  ];
}

/**
 * What came back to a player from a seat at `nowIso` with `reason`: credit
 * that went back to the pot, and cash that became a credit entry.
 */
export async function moneyBackAt(db: D1Database, sessionId: string, playerId: string | null, reason: string, nowIso: string): Promise<{ playerId: string; creditCents: number; cashCents: number }[]> {
  const { results } = await db
    .prepare(
      `SELECT player_id,
         COALESCE(SUM(CASE WHEN kind = 'used' AND COALESCE(reason, '') <> 'cash' AND ended_at = ?3 AND ended_reason = ?4 THEN amount_cents END), 0) AS credit,
         COALESCE(SUM(CASE WHEN kind = 'kept' AND reason = ?4 AND created_at = ?3 THEN amount_cents END), 0) AS cash
       FROM credit_ledger WHERE session_id = ?1 AND (?2 IS NULL OR player_id = ?2) GROUP BY player_id`,
    )
    .bind(sessionId, playerId, nowIso, reason)
    .all<{ player_id: string; credit: number; cash: number }>();
  return results.filter((r) => r.credit > 0 || r.cash > 0).map((r) => ({ playerId: r.player_id, creditCents: r.credit, cashCents: r.cash }));
}

/**
 * Credit used on a game goes back to the player's pot without the seat
 * leaving: the organizer unmarked the payment ('unmarked') or the player took
 * back "Use credit" ('undone'). The payment shrinks by the credit part; when
 * nothing else was paid, the seat is simply unpaid again.
 *
 * Cash held against the seat (a 'cash' pair) is not credit: when the
 * organizer unmarks the payment it is simply gone (the payment never
 * happened); with `creditOnly` (the player's undo, or credit taken off a seat
 * that still owes) it stays.
 *
 * Statements only, worked out inside the database, so the caller can put
 * them in one batch with its own change. The credit only moves once the seat
 * is no longer paid (the first statement, or the caller's own, did that).
 */
export function returnSeatCreditStatements(
  db: D1Database,
  sessionId: string,
  playerId: string,
  nowIso: string,
  reason: 'unmarked' | 'undone',
  /** `notFinalized`: only while the game is not finalized (checked in the same statements, so a Finalize at the same moment wins cleanly). */
  opts: { creditOnly?: boolean; notFinalized?: boolean } = {},
): D1PreparedStatement[] {
  const withCash = reason === 'unmarked' && !opts.creditOnly;
  const open = opts.notFinalized ? ' AND (SELECT finalized_at FROM sessions WHERE id = ?3) IS NULL' : '';
  const taken = withCash ? `(${SEAT_USED('session_players')} + ${SEAT_CASH('session_players')})` : SEAT_USED('session_players');
  const gone = `COALESCE(payment_amount_cents, 0) - ${taken} <= 0`;
  return [
    // Only a paid seat carries the credit inside its payment; an unpaid one just owes more again.
    db
      .prepare(
        `UPDATE session_players SET
           payment_status = CASE WHEN ${gone} THEN (CASE WHEN status = 'confirmed' THEN 'unpaid' ELSE 'not_applicable' END) ELSE payment_status END,
           paid_at = CASE WHEN ${gone} THEN NULL ELSE paid_at END,
           self_paid_at = CASE WHEN ${gone} THEN NULL ELSE self_paid_at END,
           payment_amount_cents = CASE WHEN ${gone} THEN NULL ELSE payment_amount_cents - ${taken} END,
           payment_updated_at = ?1, updated_at = ?1
         WHERE session_id = ?3 AND player_id = ?4 AND payment_status = 'paid' AND refunded_at IS NULL AND ${taken} > 0${open}`,
      )
      .bind(nowIso, reason, sessionId, playerId),
    db
      .prepare(
        `UPDATE credit_ledger SET ended_at = ?1, ended_reason = ?2
         WHERE session_id = ?3 AND player_id = ?4 AND ended_at IS NULL
           AND ${withCash ? "(kind = 'used' OR (kind = 'kept' AND reason = 'cash'))" : "kind = 'used' AND COALESCE(reason, '') <> 'cash'"}
           AND NOT EXISTS (SELECT 1 FROM session_players WHERE session_id = ?3 AND player_id = ?4 AND payment_status = 'paid')${open}`,
      )
      .bind(nowIso, reason, sessionId, playerId),
  ];
}

/** The credit (not held cash) that went back to the pot from a seat at `nowIso` with `reason`. */
export async function creditReturnedAt(db: D1Database, sessionId: string, playerId: string, reason: string, nowIso: string): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COALESCE(SUM(amount_cents), 0) AS c FROM credit_ledger
       WHERE kind = 'used' AND COALESCE(reason, '') <> 'cash' AND session_id = ? AND player_id = ? AND ended_at = ? AND ended_reason = ?`,
    )
    .bind(sessionId, playerId, nowIso, reason)
    .first<{ c: number }>();
  return row?.c ?? 0;
}

/** Runs `returnSeatCreditStatements` on its own and returns the cents that went back. */
export async function returnSeatCredit(
  db: D1Database,
  sessionId: string,
  playerId: string,
  nowIso: string,
  reason: 'unmarked' | 'undone',
  opts: { creditOnly?: boolean; notFinalized?: boolean } = {},
): Promise<number> {
  const before = await creditReturnedAt(db, sessionId, playerId, reason, nowIso);
  await db.batch(returnSeatCreditStatements(db, sessionId, playerId, nowIso, reason, opts));
  return (await creditReturnedAt(db, sessionId, playerId, reason, nowIso)) - before;
}

/**
 * The price of a seat can change when the game is finalized (or reopened). A
 * seat paid with credit that is now short is put back to unpaid, keeping the
 * credit already used on it, so the player sees exactly what is left to pay.
 * An unpaid seat whose used credit now covers the price is paid.
 *
 * Statements only, worked out inside the database from the game as it is
 * when they run (the flat price `flatCents` until finalized, then the final
 * price for those who played), so they can share a batch with the change.
 */
export function repriceStatements(db: D1Database, sessionId: string, flatCents: number, nowIso: string): D1PreparedStatement[] {
  const price = `(SELECT CASE WHEN s.status = 'canceled' THEN NULL WHEN s.finalized_at IS NULL THEN ?3 WHEN session_players.played = 1 THEN s.final_price_cents ELSE NULL END
                  FROM sessions s WHERE s.id = session_players.session_id)`;
  const used = `(${SEAT_USED('session_players')} + ${SEAT_CASH('session_players')})`;
  // A paid seat that is now short goes back to unpaid; the cash in its payment (beyond the credit on it) is held
  // against it as a 'cash' pair first, the same way Finalize does, so it still counts and the seat owes only the rest.
  const short = (sp: string) =>
    `${sp}.session_id = ?2 AND ${sp}.status = 'confirmed' AND ${sp}.payment_status = 'paid' AND ${sp}.refunded_at IS NULL
     AND (${SEAT_USED(sp)} + ${SEAT_CASH(sp)}) > 0
     AND (SELECT CASE WHEN s.status = 'canceled' THEN NULL WHEN s.finalized_at IS NULL THEN ?3 WHEN ${sp}.played = 1 THEN s.final_price_cents ELSE NULL END FROM sessions s WHERE s.id = ${sp}.session_id) > COALESCE(${sp}.payment_amount_cents, 0)`;
  const cash = (sp: string) => `(COALESCE(${sp}.payment_amount_cents, 0) - ${SEAT_USED(sp)} - ${SEAT_CASH(sp)})`;
  const hold = (kind: 'kept' | 'used') =>
    db
      .prepare(
        `INSERT INTO credit_ledger (id, group_id, player_id, kind, amount_cents, session_id, created_at, reason)
         SELECT ${SQL_ID}, s.group_id, sp.player_id, '${kind}', ${cash('sp')}, sp.session_id, ?1, 'cash'
         FROM session_players sp JOIN sessions s ON s.id = sp.session_id
         WHERE ${short('sp')} AND ${cash('sp')} > 0`,
      )
      .bind(nowIso, sessionId, flatCents);
  return [
    hold('kept'),
    hold('used'),
    db
      .prepare(
        `UPDATE session_players SET payment_status = 'unpaid', paid_at = NULL, payment_amount_cents = NULL, self_paid_at = NULL, payment_updated_at = ?1, updated_at = ?1
         WHERE session_id = ?2 AND status = 'confirmed' AND payment_status = 'paid' AND ${used} > 0
           AND ${price} IS NOT NULL AND COALESCE(payment_amount_cents, 0) < ${price}`,
      )
      .bind(nowIso, sessionId, flatCents),
    db
      .prepare(
        `UPDATE session_players SET payment_status = 'paid', paid_at = ?1, payment_amount_cents = ${used}, self_paid_at = NULL, payment_updated_at = ?1, updated_at = ?1
         WHERE session_id = ?2 AND status = 'confirmed' AND payment_status = 'unpaid' AND ${used} > 0
           AND ${price} IS NOT NULL AND ${used} >= ${price}`,
      )
      .bind(nowIso, sessionId, flatCents),
  ];
}

/**
 * Money from a seat comes back to the player as credit: a 'kept' entry with
 * its reason. With `settle`, the seat's payment is marked settled
 * (`refunded_at`), so it is no longer held and a later sign-up owes again;
 * that is for money coming back in full (did not play). Without it, only the
 * part above the final price comes back and the payment stays as what they
 * paid. `guard` is extra SQL that must hold (finalize: "this batch finalized
 * the game"). Statements only, for the caller's batch.
 */
export function creditBackStatements(
  db: D1Database,
  args: { groupId: string; sessionId: string; playerId: string; cents: number; reason: CreditReason; playedCount?: number | null; nowIso: string; settle: boolean; guard?: string },
): D1PreparedStatement[] {
  const { groupId, sessionId, playerId, cents, reason, playedCount, nowIso, settle, guard } = args;
  if (cents <= 0) return [];
  const entry = newId();
  const there = 'EXISTS (SELECT 1 FROM credit_ledger WHERE id = ?1 AND ended_at IS NULL)';
  // The seat must still carry a live payment. Settling guards itself (an unsettled seat has exactly one live
  // payment); a part-back entry (the part above the final price) must not already exist for it.
  const seatOk = settle
    ? `EXISTS (SELECT 1 FROM session_players WHERE session_id = ?5 AND player_id = ?3 AND payment_status = 'paid' AND refunded_at IS NULL)`
    : `EXISTS (SELECT 1 FROM session_players sp WHERE sp.session_id = ?5 AND sp.player_id = ?3 AND sp.payment_status = 'paid' AND sp.refunded_at IS NULL)
       AND NOT EXISTS (SELECT 1 FROM credit_ledger l WHERE l.session_id = ?5 AND l.player_id = ?3 AND l.kind = 'kept' AND l.reason = ?7 AND l.ended_at IS NULL)`;
  return [
    db
      .prepare(
        `INSERT INTO credit_ledger (id, group_id, player_id, kind, amount_cents, session_id, created_at, reason, played_count)
         SELECT ?1, ?2, ?3, 'kept', ?4, ?5, ?6, ?7, ?8
         WHERE ${seatOk}${guard ? ` AND ${guard}` : ''}`,
      )
      .bind(entry, groupId, playerId, cents, sessionId, nowIso, reason, playedCount ?? null),
    ...(settle
      ? [
          db
            .prepare(`UPDATE session_players SET refunded_at = ?2, updated_at = ?2 WHERE session_id = ?3 AND player_id = ?4 AND refunded_at IS NULL AND ${there}`)
            .bind(entry, nowIso, sessionId, playerId),
        ]
      : []),
  ];
}

/**
 * Take back the credit that came back from a seat's payment because it was
 * above the final price (the organizer unmarking that payment). All or
 * nothing: only while the pot, beyond a pending cash out, still holds all of
 * it. Statements only, for the caller's batch: check afterwards with
 * `creditBackLeft` whether it was blocked.
 */
export function undoFinalizedBackStatements(db: D1Database, sessionId: string, playerId: string, nowIso: string): D1PreparedStatement[] {
  const back = `(SELECT COALESCE(SUM(amount_cents), 0) FROM credit_ledger WHERE kind = 'kept' AND session_id = ?2 AND player_id = ?3 AND ended_at IS NULL AND reason = 'finalized')`;
  return [
    db
      .prepare(
        `UPDATE credit_ledger SET ended_at = ?1, ended_reason = 'undone'
         WHERE kind = 'kept' AND session_id = ?2 AND player_id = ?3 AND ended_at IS NULL AND reason = 'finalized'
           AND ${POT('?3')} - ${RESERVED('?3')} - ${back} >= 0`,
      )
      .bind(nowIso, sessionId, playerId),
  ];
}

/** Live credit that came back from a seat for being paid above the final price. */
export async function creditBackLeft(db: D1Database, sessionId: string, playerId: string): Promise<number> {
  const row = await db
    .prepare("SELECT COALESCE(SUM(amount_cents), 0) AS c FROM credit_ledger WHERE kind = 'kept' AND session_id = ? AND player_id = ? AND ended_at IS NULL AND reason = 'finalized'")
    .bind(sessionId, playerId)
    .first<{ c: number }>();
  return row?.c ?? 0;
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
    /** The game's finalize as read (null: not finalized); a Finalize, Reopen or redo since means look again. */
    finalPriceCents: number | null;
    finalizedAt: string | null;
    nowIso: string;
  },
): Promise<boolean> {
  const { groupId, sessionId, playerId, cents, alreadyUsed, payInFull, finalPriceCents, finalizedAt, nowIso } = args;
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
           AND (SELECT status FROM sessions WHERE id = ?5) <> 'canceled'
           AND (SELECT COALESCE(finalized_at, '') || ':' || COALESCE(final_price_cents, -1) FROM sessions WHERE id = ?5) = ?8`,
      )
      .bind(entry, groupId, playerId, cents, sessionId, nowIso, alreadyUsed, `${finalizedAt ?? ''}:${finalPriceCents ?? -1}`),
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
 * is unchanged and the seat owes the rest. The pair goes in only while the
 * seat still holds exactly that payment (read before the seat changes), so
 * nothing is held twice and nothing is held that was never paid.
 * Statements only, for the caller's batch; `guard` as in creditBackStatements.
 */
export function holdCashStatements(
  db: D1Database,
  args: { groupId: string; sessionId: string; playerId: string; cents: number; paymentCents: number; nowIso: string; guard?: string },
): D1PreparedStatement[] {
  const { groupId, sessionId, playerId, cents, paymentCents, nowIso, guard } = args;
  // `cents` is the cash part of the payment (`paymentCents`); credit already on the seat stays where it is.
  const seatHolds = `EXISTS (SELECT 1 FROM session_players WHERE session_id = ?5 AND player_id = ?3 AND status = 'confirmed' AND payment_status = 'paid' AND refunded_at IS NULL AND payment_amount_cents = ?7)${guard ? ` AND ${guard}` : ''}`;
  const pair = (kind: 'kept' | 'used') =>
    db
      .prepare(`INSERT INTO credit_ledger (id, group_id, player_id, kind, amount_cents, session_id, created_at, reason) SELECT ?1, ?2, ?3, '${kind}', ?4, ?5, ?6, 'cash' WHERE ?4 > 0 AND ${seatHolds}`)
      .bind(newId(), groupId, playerId, cents, sessionId, nowIso, paymentCents);
  return [
    pair('kept'),
    pair('used'),
    db
      .prepare(
        `UPDATE session_players SET payment_status = 'unpaid', paid_at = NULL, payment_amount_cents = NULL, self_paid_at = NULL, payment_updated_at = ?1, updated_at = ?1
         WHERE session_id = ?2 AND player_id = ?3 AND status = 'confirmed' AND payment_status = 'paid' AND refunded_at IS NULL AND payment_amount_cents = ?4${guard ? ` AND ${guard}` : ''}`,
      )
      .bind(nowIso, sessionId, playerId, paymentCents),
  ];
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
         WHERE ${usable} > 0 AND ?4 > 0
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
