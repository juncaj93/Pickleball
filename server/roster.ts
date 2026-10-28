import type { RosterStatus } from '../shared/api';
import { deadlineMs } from '../shared/cards';
import type { GroupSettings } from '../shared/settings';
import { MIN_PLAYERS } from '../shared/spots';
import { newId } from './crypto';
import { type D1Database, isTriggerError } from './db';
import { HttpError } from './http';
import { type SessionRow, waitlistOf, loadRoster, confirmedOf, syncSix } from './repo';

// One court, exactly 4 or 6 players (see shared/spots.ts for the rules).
//
// Every write that hands out a spot carries its own guard in SQL, so two
// phones tapping at the same moment can't push a session past 4, or to 5.
// The database trigger (max 6 confirmed) is the backstop under all of it.

// Next position in this session's join / spot order. Timestamps can tie
// to the millisecond; these counters can't. ?1 is always the session id.
const NEXT_CLAIM_SEQ = '(SELECT COALESCE(MAX(x.claim_seq), 0) + 1 FROM session_players x WHERE x.session_id = ?1)';
const NEXT_CONFIRM_SEQ = '(SELECT COALESCE(MAX(x.confirm_seq), 0) + 1 FROM session_players x WHERE x.session_id = ?1)';
const CONFIRMED = "(SELECT COUNT(*) FROM session_players x WHERE x.session_id = ?1 AND x.status = 'confirmed')";
/** Waiting players other than ?2. */
const OTHERS_WAITING = "(SELECT COUNT(*) FROM session_players x WHERE x.session_id = ?1 AND x.status = 'waitlisted' AND x.player_id <> ?2)";

/**
 * When someone not yet in may take a spot directly:
 * - normal: under 4, or the one spot that turns 5 into 6 (if nobody is waiting)
 * - organizer: anything under 6
 */
const GUARD = {
  normal: `(${CONFIRMED} < ${MIN_PLAYERS} OR (${CONFIRMED} = 5 AND ${OTHERS_WAITING} = 0))`,
  organizer: `${CONFIRMED} < 6`,
} as const;

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
  | { result: 'confirmed'; madeSix?: boolean }
  | { result: 'standby'; position: number }
  | { result: 'already_confirmed' }
  | { result: 'waitlisted'; position: number }
  | { result: 'spot_taken' };

export interface Promotion {
  playerId: string;
  reason: 'made_six' | 'spot_opened';
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

/** Give the player a confirmed spot if the guard allows it. Returns false if it didn't. */
async function tryConfirm(db: D1Database, session: SessionRow, playerId: string, nowIso: string, guard: keyof typeof GUARD) {
  try {
    const existing = await existingRow(db, session.id, playerId);
    if (existing?.status === 'confirmed') return true;
    if (existing) {
      const res = await db
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
           WHERE id = ?4 AND status <> 'confirmed' AND ${GUARD[guard]}`,
        )
        .bind(session.id, playerId, nowIso, existing.id)
        .run();
      return res.meta.changes === 1;
    }
    const res = await db
      .prepare(
        `INSERT INTO session_players
           (id, session_id, player_id, status, claimed_at, claim_seq, confirmed_at, confirm_seq, payment_status, updated_at)
         SELECT ?4, ?1, ?2, 'confirmed', ?3, ${NEXT_CLAIM_SEQ}, ?3, ${NEXT_CONFIRM_SEQ}, 'unpaid', ?3
         WHERE ${GUARD[guard]}`,
      )
      .bind(session.id, playerId, nowIso, newId())
      .run();
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
 * Apply the automatic moves after anyone joins or leaves:
 * - fewer than 4 and someone waiting: the first waiting player moves in
 * - exactly 4 and two or more waiting: the first two move in together (6)
 * - 5: nothing moves; the organizer decides
 * Each move is one guarded statement, so it either fully happens or not at all.
 */
export async function settle(db: D1Database, session: SessionRow, nowIso: string): Promise<Promotion[]> {
  const promoted: Promotion[] = [];
  for (let i = 0; i < 8; i++) {
    const roster = await loadRoster(db, session.id);
    const confirmed = confirmedOf(roster).length;
    const waiting = waitlistOf(roster);
    let ids: string[];
    let reason: Promotion['reason'];
    let guard: string;
    if (confirmed < MIN_PLAYERS && waiting.length > 0) {
      ids = [waiting[0].id];
      reason = 'spot_opened';
      guard = `${CONFIRMED} < ${MIN_PLAYERS}`;
    } else if (confirmed === MIN_PLAYERS && waiting.length >= 2) {
      ids = [waiting[0].id, waiting[1].id];
      reason = 'made_six';
      // Both rows must still be waiting and the count still 4. SQLite checks
      // the WHERE for every row before changing any, so it's both or neither.
      guard = `${CONFIRMED} = ${MIN_PLAYERS} AND (SELECT COUNT(*) FROM session_players y WHERE y.id IN (?4, ?5) AND y.status = 'waitlisted') = 2`;
    } else {
      break;
    }
    const res = await db
      .prepare(
        `UPDATE session_players
         SET status = 'confirmed', confirmed_at = ?2,
             confirm_seq = ${NEXT_CONFIRM_SEQ} + CASE WHEN id = ?5 THEN 1 ELSE 0 END,
             attendance_confirmed_at = NULL,
             promoted_at = ?2, promotion_reason = ?3, promotion_notified_at = NULL,
             ${KEEP_PAYMENT_UNLESS_REFUNDED},
             updated_at = ?2
         WHERE id IN (?4, ?5) AND status = 'waitlisted' AND ${guard}`,
      )
      .bind(session.id, nowIso, reason, ids[0], ids[1] ?? ids[0])
      .run()
      .catch((err) => {
        if (isTriggerError(err, 'session_full')) return { meta: { changes: 0 } };
        throw err;
      });
    if (res.meta.changes === 0) break;
    const byId = new Map(waiting.map((w) => [w.id, w.player_id]));
    for (const id of ids) promoted.push({ playerId: byId.get(id)!, reason });
  }
  return promoted;
}

async function waitlistPosition(db: D1Database, sessionId: string, playerId: string): Promise<number> {
  const list = waitlistOf(await loadRoster(db, sessionId));
  return list.findIndex((r) => r.player_id === playerId) + 1;
}

/**
 * `auto`: in if a spot is open, otherwise the waitlist (player Home). Joining
 *   as the 6th person confirms both waiting players at once.
 * `claim_only`: in or nothing (substitute invitation links).
 * `organizer`: the organizer giving someone a spot; allowed up to 6.
 * Repeating the call never creates duplicates.
 */
export async function joinSession(
  db: D1Database,
  session: SessionRow,
  playerId: string,
  nowMs: number,
  mode: 'auto' | 'claim_only' | 'organizer',
): Promise<JoinResult> {
  const res = await joinInner(db, session, playerId, nowMs, mode);
  await syncSix(db, session.id, new Date(nowMs).toISOString());
  return res;
}

async function joinInner(
  db: D1Database,
  session: SessionRow,
  playerId: string,
  nowMs: number,
  mode: 'auto' | 'claim_only' | 'organizer',
): Promise<JoinResult> {
  assertOpen(session, nowMs);
  const nowIso = new Date(nowMs).toISOString();
  const existing = await existingRow(db, session.id, playerId);
  if (existing?.status === 'confirmed') return { result: 'already_confirmed' };

  // Waiting on the venue for a court: players can only go on standby, in
  // order, owing nothing. "Court opened" confirms them by the 4-or-6 rules.
  if (session.court_state === 'waitlist' && mode !== 'organizer') {
    if (mode === 'claim_only') return { result: 'spot_taken' };
    await addToWaitlist(db, session, playerId, nowIso);
    return { result: 'standby', position: await waitlistPosition(db, session.id, playerId) };
  }

  if (await tryConfirm(db, session, playerId, nowIso, mode === 'organizer' ? 'organizer' : 'normal')) {
    return { result: 'confirmed' };
  }
  if (mode !== 'auto') return { result: 'spot_taken' };

  await addToWaitlist(db, session, playerId, nowIso);
  const promoted = await settle(db, session, nowIso);
  const mine = promoted.find((p) => p.playerId === playerId);
  if (mine) return { result: 'confirmed', madeSix: mine.reason === 'made_six' };
  const row = await existingRow(db, session.id, playerId);
  if (row?.status === 'confirmed') return { result: 'already_confirmed' };
  return { result: 'waitlisted', position: await waitlistPosition(db, session.id, playerId) };
}

/** Leave the session (confirmed or waitlisted), then apply the automatic moves. */
export async function withdraw(
  db: D1Database,
  session: SessionRow,
  playerId: string,
  nowMs: number,
): Promise<{ freedSpot: boolean; changed: boolean; promoted: Promotion[] }> {
  assertOpen(session, nowMs);
  const existing = await existingRow(db, session.id, playerId);
  if (!existing || (existing.status !== 'confirmed' && existing.status !== 'waitlisted')) {
    return { freedSpot: false, changed: false, promoted: [] };
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
  if (changed && existing.status === 'confirmed') {
    // A new opening means the organizer should look again.
    await db
      .prepare('UPDATE sessions SET admin_decision = NULL, decision_at = NULL, updated_at = ? WHERE id = ? AND admin_decision IS NOT NULL')
      .bind(nowIso, session.id)
      .run();
  }
  // While waiting on a court nobody moves in; that happens on "Court opened".
  const promoted = changed && session.court_state !== 'waitlist' ? await settle(db, session, nowIso) : [];
  await syncSix(db, session.id, nowIso);
  return { freedSpot: changed && existing.status === 'confirmed', changed, promoted };
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
 * Organizer correction: put a player at the back of the waitlist. Used for
 * "back to 4" when 5 are going. Doesn't trigger automatic moves, or the
 * player would bounce straight back in.
 */
export async function moveToWaitlist(db: D1Database, session: SessionRow, playerId: string, nowMs: number): Promise<void> {
  assertOpen(session, nowMs);
  await addToWaitlist(db, session, playerId, new Date(nowMs).toISOString());
  await syncSix(db, session.id, new Date(nowMs).toISOString());
}
