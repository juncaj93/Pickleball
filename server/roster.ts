import type { RosterStatus } from '../shared/api';
import { deadlineMs } from '../shared/cards';
import type { GroupSettings } from '../shared/settings';
import { auditAutoCredit, type AutoCredit, autoCreditFor, autoCreditStatements, creditBack, returnSeatCredit } from './credit';
import { newId } from './crypto';
import { type D1Database, isTriggerError } from './db';
import { HttpError } from './http';
import { type GroupRow, type SessionRow, waitlistOf, loadRoster, confirmedOf, organizerIdOf, settingsOf } from './repo';

// One court, any number from 4 up to the organizer's max (see shared/spots.ts).
//
// Every write that hands out a spot carries its own guard in SQL, so two
// phones tapping at the same moment can't push a session past the max.
// The database trigger (12 confirmed, the widest max) is the backstop.

// Next position in this session's join / spot order. Timestamps can tie
// to the millisecond; these counters can't. ?1 is always the session id.
const NEXT_CLAIM_SEQ = '(SELECT COALESCE(MAX(x.claim_seq), 0) + 1 FROM session_players x WHERE x.session_id = ?1)';
const NEXT_CONFIRM_SEQ = '(SELECT COALESCE(MAX(x.confirm_seq), 0) + 1 FROM session_players x WHERE x.session_id = ?1)';
const CONFIRMED = "(SELECT COUNT(*) FROM session_players x WHERE x.session_id = ?1 AND x.status = 'confirmed')";

/** Someone not yet in may take a spot while fewer than the max (?5) are in. */
const GUARD = `${CONFIRMED} < ?5`;

/**
 * Getting a spot back keeps a payment already made, unless it was refunded:
 * then the money went back, so they owe again like anyone new.
 */
const KEEP_PAYMENT_UNLESS_REFUNDED = `payment_status = CASE WHEN payment_status = 'paid' AND refunded_at IS NULL THEN 'paid' ELSE 'unpaid' END,
  paid_at = CASE WHEN refunded_at IS NULL THEN paid_at ELSE NULL END,
  payment_amount_cents = CASE WHEN refunded_at IS NULL THEN payment_amount_cents ELSE NULL END,
  self_paid_at = CASE WHEN refunded_at IS NULL THEN self_paid_at ELSE NULL END,
  refunded_at = NULL`;

export type JoinResult =
  | { result: 'confirmed'; creditCents?: number; paidWithCredit?: boolean }
  | { result: 'standby'; position: number }
  | { result: 'already_confirmed' }
  | { result: 'waitlisted'; position: number }
  | { result: 'spot_taken' };

export interface Promotion {
  playerId: string;
  reason: 'spot_opened';
  /** Credit used on the seat automatically as they moved in. */
  creditCents: number;
  paidWithCredit: boolean;
}

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
 * Give the player a confirmed spot if the guard allows it. Returns false if it
 * didn't. With `auto`, their credit goes on the new seat in the same batch.
 */
async function tryConfirm(db: D1Database, session: SessionRow, playerId: string, nowIso: string, maxPlayers: number, auto: AutoCredit | null) {
  const withCredit = auto ? autoCreditStatements(db, auto, session.id, playerId, nowIso) : [];
  try {
    const existing = await existingRow(db, session.id, playerId);
    if (existing?.status === 'confirmed') return true;
    if (existing) {
      const [res] = await db.batch([
        db
          .prepare(
            `UPDATE session_players
             SET status = 'confirmed',
                 confirmed_at = ?3,
                 confirm_seq = ${NEXT_CONFIRM_SEQ},
                 claimed_at = CASE WHEN status = 'waitlisted' THEN claimed_at ELSE ?3 END,
                 claim_seq = CASE WHEN status = 'waitlisted' THEN claim_seq ELSE ${NEXT_CLAIM_SEQ} END,
                 attendance_confirmed_at = NULL,
                 promoted_at = NULL, promotion_reason = NULL, promotion_notified_at = NULL,
                 ${KEEP_PAYMENT_UNLESS_REFUNDED},
                 updated_at = ?3
             WHERE id = ?4 AND status <> 'confirmed' AND ${GUARD}`,
          )
          .bind(session.id, playerId, nowIso, existing.id, maxPlayers),
        ...withCredit,
      ]);
      return res.meta.changes === 1;
    }
    const [res] = await db.batch([
      db
        .prepare(
          `INSERT INTO session_players
             (id, session_id, player_id, status, claimed_at, claim_seq, confirmed_at, confirm_seq, payment_status, updated_at)
           SELECT ?4, ?1, ?2, 'confirmed', ?3, ${NEXT_CLAIM_SEQ}, ?3, ${NEXT_CONFIRM_SEQ}, 'unpaid', ?3
           WHERE ${GUARD}`,
        )
        .bind(session.id, playerId, nowIso, newId(), maxPlayers),
      ...withCredit,
    ]);
    return res.meta.changes === 1;
  } catch (err) {
    if (isTriggerError(err, 'session_full')) return false;
    if (isTriggerError(err, 'session_canceled')) throw new HttpError(409, 'session_canceled', 'This session was canceled.');
    // A second tap racing the first can hit the unique (session, player) key.
    if (err instanceof Error && /UNIQUE/i.test(err.message)) {
      return (await existingRow(db, session.id, playerId))?.status === 'confirmed';
    }
    throw err;
  }
}

/** Put the player at the back of the waitlist (no-op if already waiting). */
async function addToWaitlist(db: D1Database, session: SessionRow, playerId: string, nowIso: string) {
  try {
    const existing = await existingRow(db, session.id, playerId);
    if (existing?.status === 'waitlisted') return;
    if (existing) {
      await db
        .prepare(
          `UPDATE session_players SET status = 'waitlisted', claimed_at = ?2, claim_seq = ${NEXT_CLAIM_SEQ}, confirmed_at = NULL, confirm_seq = NULL,
             attendance_confirmed_at = NULL, promoted_at = NULL, promotion_reason = NULL, promotion_notified_at = NULL,
             payment_status = CASE WHEN payment_status = 'paid' THEN 'paid' ELSE 'not_applicable' END,
             updated_at = ?2
           WHERE id = ?3 AND status <> 'waitlisted'`,
        )
        .bind(session.id, nowIso, existing.id)
        .run();
    } else {
      await db
        .prepare(
          `INSERT INTO session_players (id, session_id, player_id, status, claimed_at, claim_seq, payment_status, updated_at)
           VALUES (?3, ?1, ?4, 'waitlisted', ?2, ${NEXT_CLAIM_SEQ}, 'not_applicable', ?2)`,
        )
        .bind(session.id, nowIso, newId(), playerId)
        .run();
    }
  } catch (err) {
    if (isTriggerError(err, 'session_canceled')) throw new HttpError(409, 'session_canceled', 'This session was canceled.');
    if (!(err instanceof Error && /UNIQUE/i.test(err.message))) throw err;
  }
}

/**
 * Apply the automatic moves after anyone joins or leaves: while fewer than
 * the max are in and someone is waiting, the first waiting player moves in
 * ("Spot opened"). Each move is one guarded statement, so it either fully
 * happens or not at all.
 */
export async function settle(db: D1Database, session: SessionRow, nowIso: string, maxPlayers: number): Promise<Promotion[]> {
  const promoted: Promotion[] = [];
  // Looked up once, only when someone may move in. Moving in uses their credit like tapping I'm in.
  let auto: AutoCredit | null | undefined;
  for (let i = 0; i < 16; i++) {
    const roster = await loadRoster(db, session.id);
    const confirmed = confirmedOf(roster).length;
    const waiting = waitlistOf(roster);
    if (confirmed >= maxPlayers || waiting.length === 0) break;
    const row = waiting[0];
    if (auto === undefined) auto = await autoCreditFor(db, session);
    const res = await db
      .batch([
        db
          .prepare(
            `UPDATE session_players
             SET status = 'confirmed', confirmed_at = ?2,
                 confirm_seq = ${NEXT_CONFIRM_SEQ},
                 attendance_confirmed_at = NULL,
                 promoted_at = ?2, promotion_reason = 'spot_opened', promotion_notified_at = NULL,
                 ${KEEP_PAYMENT_UNLESS_REFUNDED},
                 updated_at = ?2
             WHERE id = ?3 AND status = 'waitlisted' AND ${CONFIRMED} < ?4`,
          )
          .bind(session.id, nowIso, row.id, maxPlayers),
        ...(auto ? autoCreditStatements(db, auto, session.id, row.player_id, nowIso) : []),
      ])
      .then(([first]) => first)
      .catch((err) => {
        if (isTriggerError(err, 'session_full')) return { meta: { changes: 0 } };
        throw err;
      });
    if (res.meta.changes === 0) break;
    const credit = auto ? await auditAutoCredit(db, auto.groupId, session.id, row.player_id, nowIso) : { cents: 0, paid: false };
    promoted.push({ playerId: row.player_id, reason: 'spot_opened', creditCents: credit.cents, paidWithCredit: credit.paid });
  }
  return promoted;
}

async function waitlistPosition(db: D1Database, sessionId: string, playerId: string): Promise<number> {
  const list = waitlistOf(await loadRoster(db, sessionId));
  return list.findIndex((r) => r.player_id === playerId) + 1;
}

/**
 * `auto`: in if a spot is open, otherwise the waitlist (player Home).
 * `claim_only`: in or nothing (substitute invitation links).
 * `organizer`: the organizer giving someone a spot; the same max applies.
 * Repeating the call never creates duplicates.
 */
export async function joinSession(
  db: D1Database,
  session: SessionRow,
  playerId: string,
  nowMs: number,
  mode: 'auto' | 'claim_only' | 'organizer',
  maxPlayers: number,
): Promise<JoinResult> {
  assertOpen(session, nowMs);
  const nowIso = new Date(nowMs).toISOString();
  const existing = await existingRow(db, session.id, playerId);
  if (existing?.status === 'confirmed') return { result: 'already_confirmed' };

  // Waiting on the venue for a court: players can only go on standby, in
  // order, owing nothing. "Court opened" confirms them up to the max.
  if (session.court_state === 'waitlist' && mode !== 'organizer') {
    if (mode === 'claim_only') return { result: 'spot_taken' };
    await addToWaitlist(db, session, playerId, nowIso);
    return { result: 'standby', position: await waitlistPosition(db, session.id, playerId) };
  }

  // Their credit goes on the seat in the same step as the seat itself (never for the organizer).
  const auto = await autoCreditFor(db, session);
  if (await tryConfirm(db, session, playerId, nowIso, maxPlayers, auto)) {
    // A second tap or device that found the seat already taken by the first gets nothing new.
    const credit = auto ? await auditAutoCredit(db, auto.groupId, session.id, playerId, nowIso) : { cents: 0, paid: false };
    return credit.cents > 0 ? { result: 'confirmed', creditCents: credit.cents, paidWithCredit: credit.paid } : { result: 'confirmed' };
  }
  if (mode !== 'auto') return { result: 'spot_taken' };

  await addToWaitlist(db, session, playerId, nowIso);
  const promoted = await settle(db, session, nowIso, maxPlayers);
  const mine = promoted.find((p) => p.playerId === playerId);
  if (mine) return mine.creditCents > 0 ? { result: 'confirmed', creditCents: mine.creditCents, paidWithCredit: mine.paidWithCredit } : { result: 'confirmed' };
  const row = await existingRow(db, session.id, playerId);
  if (row?.status === 'confirmed') return { result: 'already_confirmed' };
  return { result: 'waitlisted', position: await waitlistPosition(db, session.id, playerId) };
}

/**
 * Leave the session (confirmed or waitlisted), then apply the automatic
 * moves. Money comes back as credit right away: credit they used on this
 * game goes back to their pot, and what they paid in cash becomes a new
 * credit entry (the organizer's own court payment never does).
 */
export async function withdraw(
  db: D1Database,
  group: GroupRow,
  session: SessionRow,
  playerId: string,
  nowMs: number,
): Promise<{ freedSpot: boolean; changed: boolean; promoted: Promotion[]; creditBackCents: number }> {
  assertOpen(session, nowMs);
  const existing = await existingRow(db, session.id, playerId);
  if (!existing || (existing.status !== 'confirmed' && existing.status !== 'waitlisted')) {
    return { freedSpot: false, changed: false, promoted: [], creditBackCents: 0 };
  }
  const nowIso = new Date(nowMs).toISOString();
  const res = await db
    .prepare(
      `UPDATE session_players SET status = 'withdrawn', attendance_confirmed_at = NULL,
         promoted_at = NULL, promotion_reason = NULL, promotion_notified_at = NULL,
         payment_status = CASE WHEN payment_status = 'paid' THEN 'paid' ELSE 'not_applicable' END,
         updated_at = ?
       WHERE id = ? AND status = ?`,
    )
    .bind(nowIso, existing.id, existing.status)
    .run();
  const changed = res.meta.changes === 1;
  let creditBackCents = 0;
  if (changed) {
    await returnSeatCredit(db, session.id, playerId, nowIso, 'dropped');
    if (playerId !== (await organizerIdOf(db, group))) creditBackCents = await keepPaymentAsCredit(db, group.id, session.id, playerId, 'dropped', nowIso);
  }
  if (changed && existing.status === 'confirmed') {
    // A new opening means the organizer should look again.
    await db
      .prepare('UPDATE sessions SET admin_decision = NULL, decision_at = NULL, updated_at = ? WHERE id = ? AND admin_decision IS NOT NULL')
      .bind(nowIso, session.id)
      .run();
  }
  // While waiting on a court nobody moves in; that happens on "Court opened".
  const promoted = changed && session.court_state !== 'waitlist' ? await settle(db, session, nowIso, settingsOf(group).maxPlayers) : [];
  return { freedSpot: changed && existing.status === 'confirmed', changed, promoted, creditBackCents };
}

/**
 * What a seat still holds in cash (paid, not settled) becomes credit with the
 * given reason. Returns the cents, or 0 when there was nothing.
 */
export async function keepPaymentAsCredit(db: D1Database, groupId: string, sessionId: string, playerId: string, reason: 'dropped' | 'canceled', nowIso: string): Promise<number> {
  const row = await db
    .prepare("SELECT payment_amount_cents FROM session_players WHERE session_id = ? AND player_id = ? AND payment_status = 'paid' AND refunded_at IS NULL")
    .bind(sessionId, playerId)
    .first<{ payment_amount_cents: number | null }>();
  const cents = row?.payment_amount_cents ?? 0;
  if (cents <= 0) return 0;
  const ok = await creditBack(db, { groupId, sessionId, playerId, cents, reason, nowIso, settle: true });
  return ok ? cents : 0;
}

/**
 * A confirmed player dropping out after the cancellation deadline (the
 * booking's own, or the default hours before play) is a "late drop": the
 * organizer sees it, and it counts on the Players screen. Only drops the
 * player makes count, not organizer removals.
 */
export async function recordLateDrop(db: D1Database, session: SessionRow, playerId: string, nowMs: number, settings: GroupSettings) {
  const start = Date.parse(session.starts_at);
  const deadline = deadlineMs({ startsAt: session.starts_at, cancellationDeadlineAt: session.cancellation_deadline_at }, settings);
  if (nowMs < deadline || nowMs >= start) return false;
  const nowIso = new Date(nowMs).toISOString();
  const res = await db
    .prepare("UPDATE session_players SET late_drop_at = ?, late_drop_done_at = NULL WHERE session_id = ? AND player_id = ? AND status = 'withdrawn'")
    .bind(nowIso, session.id, playerId)
    .run();
  return res.meta.changes === 1;
}

/** Back in after a late drop: it no longer counts. */
export async function clearLateDrop(db: D1Database, sessionId: string, playerId: string) {
  await db
    .prepare("UPDATE session_players SET late_drop_at = NULL, late_drop_done_at = NULL WHERE session_id = ? AND player_id = ? AND status IN ('confirmed', 'waitlisted') AND late_drop_at IS NOT NULL")
    .bind(sessionId, playerId)
    .run();
}

/** "No" to a suggestion: remembered so it isn't suggested again. Never touches someone who is in. */
export async function decline(db: D1Database, session: SessionRow, playerId: string, nowMs: number): Promise<void> {
  assertOpen(session, nowMs);
  const nowIso = new Date(nowMs).toISOString();
  const existing = await existingRow(db, session.id, playerId);
  if (existing?.status === 'confirmed' || existing?.status === 'waitlisted' || existing?.status === 'declined') return;
  if (existing) {
    await db.prepare("UPDATE session_players SET status = 'declined', updated_at = ? WHERE id = ?").bind(nowIso, existing.id).run();
    return;
  }
  await db
    .prepare(
      `INSERT OR IGNORE INTO session_players (id, session_id, player_id, status, claimed_at, claim_seq, payment_status, updated_at)
       VALUES (?3, ?1, ?4, 'declined', ?2, ${NEXT_CLAIM_SEQ}, 'not_applicable', ?2)`,
    )
    .bind(session.id, nowIso, newId(), playerId)
    .run();
}

/**
 * The organizer paid the venue ("Court paid") or took that back ("Court due").
 * It uses the organizer's own row for the session, the same paid mark as
 * before. A game they aren't in has no row yet, so one is added as "declined"
 * (not playing) to hold the mark; it never takes a spot. Returns false when
 * nothing changed. Never touches credits.
 */
export async function setCourtPaid(db: D1Database, session: SessionRow, playerId: string, paid: boolean, amountCents: number, nowIso: string): Promise<boolean> {
  const existing = await db
    .prepare('SELECT id, status, payment_status FROM session_players WHERE session_id = ? AND player_id = ?')
    .bind(session.id, playerId)
    .first<{ id: string; status: RosterStatus; payment_status: string }>();
  if (paid) {
    if (existing?.payment_status === 'paid') return false;
    if (existing) {
      await db
        .prepare(
          `UPDATE session_players SET payment_status = 'paid', paid_at = ?, payment_amount_cents = ?, self_paid_at = NULL, refunded_at = NULL,
             payment_updated_at = ?, updated_at = ? WHERE id = ?`,
        )
        .bind(nowIso, amountCents, nowIso, nowIso, existing.id)
        .run();
      return true;
    }
    await db
      .prepare(
        `INSERT OR IGNORE INTO session_players
           (id, session_id, player_id, status, claimed_at, claim_seq, payment_status, paid_at, payment_amount_cents, payment_updated_at, updated_at)
         VALUES (?3, ?1, ?4, 'declined', ?2, ${NEXT_CLAIM_SEQ}, 'paid', ?2, ?5, ?2, ?2)`,
      )
      .bind(session.id, nowIso, newId(), playerId, amountCents)
      .run();
    return true;
  }
  if (existing?.payment_status !== 'paid') return false;
  await db
    .prepare(
      `UPDATE session_players SET payment_status = CASE WHEN status = 'confirmed' THEN 'unpaid' ELSE 'not_applicable' END,
         paid_at = NULL, payment_amount_cents = NULL, self_paid_at = NULL, payment_updated_at = ?, updated_at = ? WHERE id = ?`,
    )
    .bind(nowIso, nowIso, existing.id)
    .run();
  return true;
}

/** Check-in: "Still coming" for a player who already holds a spot. */
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

/**
 * Organizer correction: put a player at the back of the waitlist. Doesn't
 * trigger automatic moves, or the player would bounce straight back in.
 */
export async function moveToWaitlist(db: D1Database, session: SessionRow, playerId: string, nowMs: number): Promise<void> {
  assertOpen(session, nowMs);
  const nowIso = new Date(nowMs).toISOString();
  await addToWaitlist(db, session, playerId, nowIso);
  // Credit on a seat that still owed would sit on a waitlist spot that owes nothing: it goes back to them.
  // (A seat paid in full, with credit or cash, stays paid, as before.)
  await db
    .prepare("SELECT 1 FROM session_players WHERE session_id = ? AND player_id = ? AND status = 'waitlisted' AND payment_status <> 'paid'")
    .bind(session.id, playerId)
    .first()
    .then((r) => (r ? returnSeatCredit(db, session.id, playerId, nowIso, 'unmarked', { creditOnly: true }) : 0));
}
