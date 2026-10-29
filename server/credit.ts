// The credit pot's database work. Every change is one guarded batch, so two
// taps at the same moment can't spend the same credit twice, and an entry is
// never deleted: undone entries just stop counting (`ended_at`).
//
// Rules live in shared/credit.ts (pure) and in the callers (admin.ts,
// creditActions.ts); this file only reads and writes.

import { type CreditKind, type CreditRow, usedBySeat } from '../shared/credit';
import { newId } from './crypto';
import type { D1Database } from './db';
import { HttpError } from './http';
import {
  creditPlan,
  type GroupRow,
  issueCredits,
  loadCredits,
  loadRoster,
  loadRosters,
  loadSessions,
  lookbackIso,
  pricesFor,
  type SessionRow,
  settingsOf,
  visibleFrom,
} from './repo';

const HISTORY_MS = 90 * 86_400_000;

/**
 * Visible sessions from the last 90 days on (further back while someone still
 * owes), their rosters, every $5 credit, the credit pot, and where open
 * credit will land on unpaid seats.
 */
export async function moneyPicture(db: D1Database, group: GroupRow, nowMs: number) {
  // Credits from sessions that just ended exist before anything is paid or cleared.
  await issueCredits(db, group, nowMs);
  const since = await lookbackIso(db, group.id, nowMs, HISTORY_MS);
  const from = visibleFrom(group);
  const sessions = await loadSessions(db, group.id, since, from);
  const rosters = await loadRosters(db, group.id, since, from);
  const credits = await loadCredits(db, group.id);
  const ledger = await loadLedger(db, group.id);
  const spent = usedBySeat(ledger);
  return { sessions, rosters, credits, ledger, spent, plan: creditPlan(sessions, rosters, credits, settingsOf(group), spent) };
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
  five_credit_ids: string | null;
}

export type LedgerRow = CreditRow & { endedReason: string | null; fiveCreditIds: string[] };

function ids(json: string | null): string[] {
  try {
    const v = JSON.parse(json ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

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
    fiveCreditIds: ids(r.five_credit_ids),
  }));
}

/** SQL for a player's pot right now (`player` is a bound parameter like "?3"). */
const POT = (player: string) =>
  `(SELECT COALESCE(SUM(CASE kind WHEN 'kept' THEN amount_cents WHEN 'used' THEN -amount_cents ELSE -(amount_cents - five_cents) END), 0)
    FROM credit_ledger WHERE player_id = ${player} AND ended_at IS NULL)`;

/**
 * Credit used on a game goes back to the player: they dropped out of it, it
 * was canceled, or the organizer unmarked the payment. The payment shrinks by
 * the credit part; when nothing else was paid, the seat is simply unpaid again.
 * Returns the cents that went back.
 */
export async function returnSeatCredit(
  db: D1Database,
  sessionId: string,
  playerId: string,
  nowIso: string,
  reason: 'dropped' | 'canceled' | 'unmarked',
): Promise<number> {
  const { results } = await db
    .prepare("SELECT amount_cents FROM credit_ledger WHERE kind = 'used' AND session_id = ? AND player_id = ? AND ended_at IS NULL")
    .bind(sessionId, playerId)
    .all<{ amount_cents: number }>();
  if (results.length === 0) return 0;
  const total = results.reduce((sum, r) => sum + r.amount_cents, 0);
  const gone = 'COALESCE(payment_amount_cents, 0) - ?1 <= 0';
  await db.batch([
    db
      .prepare(
        "UPDATE credit_ledger SET ended_at = ?, ended_reason = ? WHERE kind = 'used' AND session_id = ? AND player_id = ? AND ended_at IS NULL",
      )
      .bind(nowIso, reason, sessionId, playerId),
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
 * The price of a game can change after someone paid it with credit (6 playing
 * is $9 for the last two; if one leaves, everyone is back to $14). A seat paid
 * with credit that is now short is put back to unpaid, keeping the credit
 * already used on it, so the player sees exactly what is left to pay. If the
 * price drops back to what the credit already covers, it is paid again.
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
      const five = await db
        .prepare('SELECT COALESCE(SUM(amount_cents), 0) AS cents FROM credits WHERE used_session_id = ? AND player_id = ?')
        .bind(sessionId, u.player_id)
        .first<{ cents: number }>();
      if ((row.payment_amount_cents ?? 0) >= price - (five?.cents ?? 0)) continue;
      await db.batch([
        db
          .prepare(
            `UPDATE session_players SET payment_status = 'unpaid', paid_at = NULL, payment_amount_cents = NULL, self_paid_at = NULL,
               payment_updated_at = ?, updated_at = ? WHERE session_id = ? AND player_id = ? AND payment_status = 'paid'`,
          )
          .bind(nowIso, nowIso, sessionId, u.player_id),
        // The older $5 credit used on it is planned again from scratch.
        db.prepare('UPDATE credits SET used_session_id = NULL, used_at = NULL WHERE used_session_id = ? AND player_id = ?').bind(sessionId, u.player_id),
      ]);
    } else if (row.payment_status === 'unpaid' && u.cents === price) {
      await db
        .prepare(
          `UPDATE session_players SET payment_status = 'paid', paid_at = ?, payment_amount_cents = ?, self_paid_at = NULL,
             payment_updated_at = ?, updated_at = ? WHERE session_id = ? AND player_id = ? AND payment_status = 'unpaid'`,
        )
        .bind(nowIso, price, nowIso, nowIso, sessionId, u.player_id)
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
 * "Keep as credit": the payment for a canceled game (or one the player left)
 * becomes credit instead of being paid back. The row is settled like a refund
 * (`refunded_at`), so Held drops and a later sign-up owes again. Any older $5
 * credit used on that payment goes back to the player, like a refund.
 */
export async function keepAsCredit(
  db: D1Database,
  groupId: string,
  sessionId: string,
  playerId: string,
  nowIso: string,
): Promise<{ cents: number; fiveCreditIds: string[] }> {
  const row = (await loadRoster(db, sessionId)).find((r) => r.player_id === playerId);
  if (!row || row.payment_status !== 'paid') throw new HttpError(409, 'not_paid', 'Only someone who paid can have credit kept.');
  if (row.refunded_at) throw new HttpError(409, 'already_settled', 'That payment was already paid back or kept as credit.');
  const cents = row.payment_amount_cents ?? 0;
  if (cents <= 0) throw new HttpError(409, 'nothing_to_keep', 'There is no money to keep for that game.');
  const { results } = await db
    .prepare('SELECT id FROM credits WHERE used_session_id = ? AND player_id = ?')
    .bind(sessionId, playerId)
    .all<{ id: string }>();
  const fiveCreditIds = results.map((c) => c.id);
  const entry = newId();
  const there = 'EXISTS (SELECT 1 FROM credit_ledger WHERE id = ?1 AND ended_at IS NULL)';
  const out = await db.batch([
    db
      .prepare(
        `INSERT INTO credit_ledger (id, group_id, player_id, kind, amount_cents, session_id, created_at, five_credit_ids)
         SELECT ?1, ?2, ?3, 'kept', ?4, ?5, ?6, ?7
         WHERE EXISTS (SELECT 1 FROM session_players WHERE session_id = ?5 AND player_id = ?3 AND payment_status = 'paid' AND refunded_at IS NULL)`,
      )
      .bind(entry, groupId, playerId, cents, sessionId, nowIso, JSON.stringify(fiveCreditIds)),
    db
      .prepare(`UPDATE session_players SET refunded_at = ?2, updated_at = ?2 WHERE session_id = ?3 AND player_id = ?4 AND refunded_at IS NULL AND ${there}`)
      .bind(entry, nowIso, sessionId, playerId),
    db
      .prepare(`UPDATE credits SET used_session_id = NULL, used_at = NULL WHERE used_session_id = ?2 AND player_id = ?3 AND ${there}`)
      .bind(entry, sessionId, playerId),
  ]);
  if (out[0].meta.changes !== 1) throw new HttpError(409, 'already_settled', 'That payment was already paid back or kept as credit.');
  return { cents, fiveCreditIds };
}

/**
 * Take back "Keep as credit". Only while that credit is still all there: if
 * some of it was already spent or paid back, it can't be undone.
 */
export async function undoKeep(db: D1Database, sessionId: string, playerId: string, nowIso: string): Promise<boolean> {
  const kept = await db
    .prepare("SELECT id, amount_cents, five_credit_ids FROM credit_ledger WHERE kind = 'kept' AND session_id = ? AND player_id = ? AND ended_at IS NULL ORDER BY created_at DESC, rowid DESC")
    .bind(sessionId, playerId)
    .first<{ id: string; amount_cents: number; five_credit_ids: string | null }>();
  if (!kept) return false;
  const restore = ids(kept.five_credit_ids);
  const ended = 'EXISTS (SELECT 1 FROM credit_ledger WHERE id = ?2 AND ended_at = ?1)';
  const out = await db.batch([
    db
      .prepare(
        `UPDATE credit_ledger SET ended_at = ?1, ended_reason = 'undone'
         WHERE id = ?2 AND ended_at IS NULL AND ${POT('?3')} - ?4 >= 0`,
      )
      .bind(nowIso, kept.id, playerId, kept.amount_cents),
    db
      .prepare(`UPDATE session_players SET refunded_at = NULL, updated_at = ?1 WHERE session_id = ?3 AND player_id = ?4 AND ${ended}`)
      .bind(nowIso, kept.id, sessionId, playerId),
    ...restore.map((id) =>
      db
        .prepare(
          `UPDATE credits SET used_session_id = ?3, used_at = ?1
           WHERE id = ?5 AND player_id = ?4 AND used_session_id IS NULL AND cleared_at IS NULL AND ${ended}`,
        )
        .bind(nowIso, kept.id, sessionId, playerId, id),
    ),
  ]);
  if (out[0].meta.changes !== 1) throw new HttpError(409, 'credit_spent', 'Some of that credit was already used or paid back, so it can not be undone.');
  return true;
}

/**
 * "Use credit" on a game the player owes for. The credit entry goes in only
 * while the pot still covers it and the seat still owes exactly what was
 * worked out (`alreadyUsed`), so a double tap spends nothing twice. When the
 * credit covers the whole amount the seat is marked paid in the same step,
 * with `paidCents` as its payment (everything above the older $5 credit,
 * which counts as collected for that game).
 */
export async function spendCredit(
  db: D1Database,
  args: {
    groupId: string;
    sessionId: string;
    playerId: string;
    cents: number;
    alreadyUsed: number;
    /** Set when this use pays the seat in full: the seat's payment, and the $5 credits it uses up. */
    payInFull: { paidCents: number; fiveCreditIds: string[] } | null;
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
         WHERE ${POT('?3')} >= ?4
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
          ...payInFull.fiveCreditIds.map((id) =>
            db
              .prepare(
                `UPDATE credits SET used_session_id = ?3, used_at = ?2
                 WHERE id = ?4 AND used_session_id IS NULL AND cleared_at IS NULL AND ${there}`,
              )
              .bind(entry, nowIso, sessionId, id),
          ),
        ]
      : []),
  ]);
  return out[0].meta.changes === 1;
}

/**
 * "Refund credit balance" marked done: the pot (and any older $5 credits that
 * were part of the balance shown) is paid back, so it drops to $0. One entry
 * holds both, so one undo restores both.
 */
export async function refundPot(
  db: D1Database,
  args: { groupId: string; playerId: string; potCents: number; fiveCents: number; fiveCreditIds: string[]; nowIso: string },
): Promise<boolean> {
  const { groupId, playerId, potCents, fiveCents, fiveCreditIds, nowIso } = args;
  const entry = newId();
  const there = 'EXISTS (SELECT 1 FROM credit_ledger WHERE id = ?1 AND ended_at IS NULL)';
  const out = await db.batch([
    db
      .prepare(
        `INSERT INTO credit_ledger (id, group_id, player_id, kind, amount_cents, five_cents, created_at, five_credit_ids)
         SELECT ?1, ?2, ?3, 'refunded', ?4, ?5, ?6, ?7
         WHERE ${POT('?3')} = ?8`,
      )
      .bind(entry, groupId, playerId, potCents + fiveCents, fiveCents, nowIso, JSON.stringify(fiveCreditIds), potCents),
    ...fiveCreditIds.map((id) =>
      db
        .prepare(`UPDATE credits SET cleared_at = ?2 WHERE id = ?3 AND player_id = ?4 AND used_session_id IS NULL AND cleared_at IS NULL AND ${there}`)
        .bind(entry, nowIso, id, playerId),
    ),
  ]);
  return out[0].meta.changes === 1;
}

/** Take back "Mark refunded" on the pot. The balance comes back, and so do the $5 credits cleared with it. */
export async function undoRefundPot(db: D1Database, playerId: string, nowIso: string): Promise<boolean> {
  const last = await db
    .prepare("SELECT id, five_credit_ids FROM credit_ledger WHERE kind = 'refunded' AND player_id = ? AND ended_at IS NULL ORDER BY created_at DESC, rowid DESC")
    .bind(playerId)
    .first<{ id: string; five_credit_ids: string | null }>();
  if (!last) return false;
  const ended = 'EXISTS (SELECT 1 FROM credit_ledger WHERE id = ?1 AND ended_at = ?2)';
  const out = await db.batch([
    db.prepare("UPDATE credit_ledger SET ended_at = ?2, ended_reason = 'undone' WHERE id = ?1 AND ended_at IS NULL").bind(last.id, nowIso),
    ...ids(last.five_credit_ids).map((id) =>
      db
        .prepare(`UPDATE credits SET cleared_at = NULL WHERE id = ?3 AND player_id = ?4 AND used_session_id IS NULL AND ${ended}`)
        .bind(last.id, nowIso, id, playerId),
    ),
  ]);
  return out[0].meta.changes === 1;
}
