import type { RosterStatus } from '../shared/api';
import { newId } from './crypto';
import { type D1Database, isTriggerError } from './db';
import { HttpError } from './http';
import { type SessionRow, waitlistOf, loadRoster } from './repo';

// Next position in this session's join / spot order. Timestamps can tie
// to the millisecond; these counters can't.
const NEXT_CLAIM_SEQ = '(SELECT COALESCE(MAX(x.claim_seq), 0) + 1 FROM session_players x WHERE x.session_id = ?)';
const NEXT_CONFIRM_SEQ = '(SELECT COALESCE(MAX(x.confirm_seq), 0) + 1 FROM session_players x WHERE x.session_id = ?)';

export type JoinResult =
  | { result: 'confirmed' }
  | { result: 'already_confirmed' }
  | { result: 'waitlisted'; position: number }
  | { result: 'spot_taken' };

interface ExistingRow {
  id: string;
  status: RosterStatus;
}

function assertOpen(session: SessionRow, nowMs: number) {
  if (session.status === 'canceled') throw new HttpError(409, 'session_canceled', 'This session was canceled.');
  if (nowMs >= Date.parse(session.starts_at)) throw new HttpError(409, 'session_started', 'This session already started.');
}

async function existingRow(db: D1Database, sessionId: string, playerId: string) {
  return db
    .prepare('SELECT id, status FROM session_players WHERE session_id = ? AND player_id = ?')
    .bind(sessionId, playerId)
    .first<ExistingRow>();
}

/**
 * Try to give the player a confirmed spot. The database trigger rejects the
 * write if four players are already confirmed, which is what makes
 * near-simultaneous claims safe: SQLite applies writes one at a time, so
 * exactly one claim for the last spot succeeds.
 */
async function tryConfirm(db: D1Database, session: SessionRow, playerId: string, existing: ExistingRow | null, nowIso: string) {
  try {
    if (existing) {
      const res = await db
        .prepare(
          `UPDATE session_players
           SET status = 'confirmed',
               confirmed_at = ?,
               confirm_seq = ${NEXT_CONFIRM_SEQ},
               claimed_at = CASE WHEN status = 'waitlisted' THEN claimed_at ELSE ? END,
               claim_seq = CASE WHEN status = 'waitlisted' THEN claim_seq ELSE ${NEXT_CLAIM_SEQ} END,
               attendance_confirmed_at = NULL,
               payment_status = CASE WHEN payment_status = 'paid' THEN 'paid' ELSE 'unpaid' END,
               updated_at = ?
           WHERE id = ? AND status <> 'confirmed'`,
        )
        .bind(nowIso, session.id, nowIso, session.id, nowIso, existing.id)
        .run();
      return res.meta.changes === 1;
    }
    await db
      .prepare(
        `INSERT INTO session_players
           (id, session_id, player_id, status, claimed_at, claim_seq, confirmed_at, confirm_seq, payment_status, updated_at)
         VALUES (?, ?, ?, 'confirmed', ?, ${NEXT_CLAIM_SEQ}, ?, ${NEXT_CONFIRM_SEQ}, 'unpaid', ?)`,
      )
      .bind(newId(), session.id, playerId, nowIso, session.id, nowIso, session.id, nowIso)
      .run();
    return true;
  } catch (err) {
    if (isTriggerError(err, 'session_full')) return false;
    if (isTriggerError(err, 'session_canceled')) throw new HttpError(409, 'session_canceled', 'This session was canceled.');
    // A second tap racing the first can hit the unique (session, player) key.
    if (err instanceof Error && /UNIQUE/i.test(err.message)) {
      const again = await existingRow(db, session.id, playerId);
      return again?.status === 'confirmed';
    }
    throw err;
  }
}

async function waitlistPosition(db: D1Database, sessionId: string, playerId: string): Promise<number> {
  const list = waitlistOf(await loadRoster(db, sessionId));
  return list.findIndex((r) => r.player_id === playerId) + 1;
}

/**
 * `auto`: confirmed if a spot is open, otherwise the waitlist (player home).
 * `claim_only`: confirmed or nothing (substitute invitation links, organizer).
 * Repeating the call never creates duplicates.
 */
export async function joinSession(
  db: D1Database,
  session: SessionRow,
  playerId: string,
  nowMs: number,
  mode: 'auto' | 'claim_only',
): Promise<JoinResult> {
  assertOpen(session, nowMs);
  const nowIso = new Date(nowMs).toISOString();
  const existing = await existingRow(db, session.id, playerId);
  if (existing?.status === 'confirmed') return { result: 'already_confirmed' };

  if (await tryConfirm(db, session, playerId, existing, nowIso)) return { result: 'confirmed' };
  if (mode === 'claim_only') return { result: 'spot_taken' };

  if (existing?.status !== 'waitlisted') {
    try {
      if (existing) {
        await db
          .prepare(
            `UPDATE session_players SET status = 'waitlisted', claimed_at = ?, claim_seq = ${NEXT_CLAIM_SEQ}, confirmed_at = NULL, confirm_seq = NULL,
               attendance_confirmed_at = NULL,
               payment_status = CASE WHEN payment_status = 'paid' THEN 'paid' ELSE 'not_applicable' END,
               updated_at = ?
             WHERE id = ? AND status NOT IN ('confirmed', 'waitlisted')`,
          )
          .bind(nowIso, session.id, nowIso, existing.id)
          .run();
      } else {
        await db
          .prepare(
            `INSERT INTO session_players (id, session_id, player_id, status, claimed_at, claim_seq, payment_status, updated_at)
             VALUES (?, ?, ?, 'waitlisted', ?, ${NEXT_CLAIM_SEQ}, 'not_applicable', ?)`,
          )
          .bind(newId(), session.id, playerId, nowIso, session.id, nowIso)
          .run();
      }
    } catch (err) {
      if (isTriggerError(err, 'session_canceled')) throw new HttpError(409, 'session_canceled', 'This session was canceled.');
      if (!(err instanceof Error && /UNIQUE/i.test(err.message))) throw err;
    }
  }
  const row = await existingRow(db, session.id, playerId);
  if (row?.status === 'confirmed') return { result: 'already_confirmed' };
  return { result: 'waitlisted', position: await waitlistPosition(db, session.id, playerId) };
}

/** Leave the session (confirmed or waitlisted). Returns true if a confirmed spot opened up. */
export async function withdraw(db: D1Database, session: SessionRow, playerId: string, nowMs: number): Promise<{ freedSpot: boolean; changed: boolean }> {
  if (session.status === 'canceled') throw new HttpError(409, 'session_canceled', 'This session was canceled.');
  if (nowMs >= Date.parse(session.starts_at)) throw new HttpError(409, 'session_started', 'This session already started.');
  const existing = await existingRow(db, session.id, playerId);
  if (!existing || (existing.status !== 'confirmed' && existing.status !== 'waitlisted')) {
    return { freedSpot: false, changed: false };
  }
  const nowIso = new Date(nowMs).toISOString();
  const res = await db
    .prepare(
      `UPDATE session_players SET status = 'withdrawn', attendance_confirmed_at = NULL,
         payment_status = CASE WHEN payment_status = 'paid' THEN 'paid' ELSE 'not_applicable' END,
         updated_at = ?
       WHERE id = ? AND status = ?`,
    )
    .bind(nowIso, existing.id, existing.status)
    .run();
  const changed = res.meta.changes === 1;
  if (changed && existing.status === 'confirmed') {
    // A new opening means the organizer should decide again near the deadline.
    await db
      .prepare('UPDATE sessions SET admin_decision = NULL, decision_at = NULL, updated_at = ? WHERE id = ? AND admin_decision IS NOT NULL')
      .bind(nowIso, session.id)
      .run();
  }
  return { freedSpot: changed && existing.status === 'confirmed', changed };
}

/** "Confirm I'm in" for a player who already holds a confirmed spot. */
export async function confirmAttendance(db: D1Database, session: SessionRow, playerId: string, nowMs: number): Promise<void> {
  assertOpen(session, nowMs);
  const existing = await existingRow(db, session.id, playerId);
  if (existing?.status !== 'confirmed') throw new HttpError(409, 'not_confirmed', "You don't have a spot in this session.");
  const nowIso = new Date(nowMs).toISOString();
  await db
    .prepare(
      `UPDATE session_players SET attendance_confirmed_at = COALESCE(attendance_confirmed_at, ?), updated_at = ?
       WHERE id = ?`,
    )
    .bind(nowIso, nowIso, existing.id)
    .run();
}

/** Organizer correction: put a player at the back of the waitlist. */
export async function moveToWaitlist(db: D1Database, session: SessionRow, playerId: string, nowMs: number): Promise<void> {
  assertOpen(session, nowMs);
  const nowIso = new Date(nowMs).toISOString();
  const existing = await existingRow(db, session.id, playerId);
  if (existing) {
    await db
      .prepare(
        `UPDATE session_players SET status = 'waitlisted', claimed_at = ?, claim_seq = ${NEXT_CLAIM_SEQ}, confirmed_at = NULL, confirm_seq = NULL,
           attendance_confirmed_at = NULL,
           payment_status = CASE WHEN payment_status = 'paid' THEN 'paid' ELSE 'not_applicable' END,
           updated_at = ?
         WHERE id = ?`,
      )
      .bind(nowIso, session.id, nowIso, existing.id)
      .run();
  } else {
    await db
      .prepare(
        `INSERT INTO session_players (id, session_id, player_id, status, claimed_at, claim_seq, payment_status, updated_at)
         VALUES (?, ?, ?, 'waitlisted', ?, ${NEXT_CLAIM_SEQ}, 'not_applicable', ?)`,
      )
      .bind(newId(), session.id, playerId, nowIso, session.id, nowIso)
      .run();
  }
}
