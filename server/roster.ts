import type { RosterStatus } from '../shared/api';
import { deadlineMs } from '../shared/cards';
import type { GroupSettings } from '../shared/settings';
import { auditAutoCredit, type AutoCredit, autoCreditFor, autoCreditStatements, moneyBackAt, seatMoneyBackStatements } from './credit';
import { finishLateDropClear, LEAVES_SHORT, OPEN_FEE, OPEN_LATE_DROP, tagOldestLateDrop } from './lateFees';
import { lateFeeCutoffMs } from '../shared/lateFees';
import { newId } from './crypto';
import { type D1Database, isTriggerError } from './db';
import { HttpError } from './http';
import { audit, type GroupRow, type SessionRow, waitlistOf, loadRoster, confirmedOf, organizerIdOf, settingsOf } from './repo';

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
 * then the money went back, so they owe again like anyone new. (An
 * unconfirmed "I paid" on a seat that left is a claim the drop did not touch,
 * so it comes back exactly as it was.)
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
  played: number | null;
  late_drop_at: string | null;
  late_drop_done_at: string | null;
}

/** The seat is an open late-drop debt (shared/lateFees.ts): coming back in settles their own, it is not a sub. */
const isOpenLateDrop = (r: ExistingRow | null | undefined) => !!r && r.status === 'withdrawn' && r.played === 0 && !!r.late_drop_at && !r.late_drop_done_at;

function assertOpen(session: SessionRow, nowMs: number) {
  if (session.status === 'canceled') throw new HttpError(409, 'session_canceled', 'This session was canceled.');
  if (nowMs >= Date.parse(session.starts_at)) throw new HttpError(409, 'session_started', 'This session already started.');
}

async function existingRow(db: D1Database, sessionId: string, playerId: string) {
  return db
    .prepare('SELECT id, status, played, late_drop_at, late_drop_done_at FROM session_players WHERE session_id = ? AND player_id = ?')
    .bind(sessionId, playerId)
    .first<ExistingRow>();
}

/**
 * A sub (shared/lateFees.ts rule 3): whoever gets a seat in this batch (confirmed at `nowIso`) clears the OLDEST open
 * late-drop debt of the game, one each. The debt's seat is tagged first, then its money comes back as credit exactly
 * like a drop (cash becomes credit, credit used goes back), then the late-drop marks go. Every statement only touches
 * the seat this batch tagged, so a retry, a second tap or a request cut off halfway can't clear twice or half.
 * With no open debts (always, while LATE_FEES was never on) these statements change nothing.
 */
function subClearStatements(db: D1Database, auto: AutoCredit, sessionId: string, joinerId: string, nowIso: string) {
  return [
    tagOldestLateDrop(db, sessionId, joinerId, nowIso),
    ...seatMoneyBackStatements(db, {
      groupId: auto.groupId,
      sessionId,
      playerId: null,
      organizerId: auto.organizerId,
      reason: 'dropped',
      nowIso,
      when: (sp) => `${sp}.status = 'withdrawn' AND ${sp}.played = 0 AND ${sp}.late_drop_done_at = ?1`,
    }),
    finishLateDropClear(db, sessionId, nowIso, null),
  ];
}

/** History lines for debts a sub cleared at `nowIso` (none when nothing was cleared). */
export async function auditSubClears(db: D1Database, groupId: string, sessionId: string, subPlayerId: string, nowIso: string): Promise<string[]> {
  const { results } = await db
    .prepare(
      `SELECT sp.player_id, p.display_name AS name, (SELECT display_name FROM players WHERE id = ?3) AS sub
       FROM session_players sp JOIN players p ON p.id = sp.player_id
       WHERE sp.session_id = ?1 AND sp.status = 'withdrawn' AND sp.late_drop_at IS NOT NULL AND sp.late_drop_done_at = ?2 AND sp.played IS NULL
         -- Another request in the same millisecond may have cleared (and logged) one too: each line is written once.
         AND NOT EXISTS (SELECT 1 FROM admin_audit_log a WHERE a.session_id = ?1 AND a.action = 'late_fee_cleared' AND a.created_at = ?2
                           AND json_extract(a.details_json, '$.playerId') = sp.player_id)`,
    )
    .bind(sessionId, nowIso, subPlayerId)
    .all<{ player_id: string; name: string; sub: string | null }>();
  for (const r of results) {
    const back = (await moneyBackAt(db, sessionId, r.player_id, 'dropped', nowIso))[0];
    await audit(db, groupId, sessionId, 'late_fee_cleared', { player: r.name, playerId: r.player_id, why: 'sub', sub: r.sub ?? 'A player', amountCents: (back?.cashCents ?? 0) + (back?.creditCents ?? 0) }, nowIso);
    if (back && back.cashCents > 0) await audit(db, groupId, sessionId, 'credit_back', { player: r.name, playerId: r.player_id, amountCents: back.cashCents, reason: 'dropped' }, nowIso);
  }
  return results.map((r) => r.player_id);
}

/**
 * Give the player a confirmed spot if the guard allows it: 'new' when this
 * call gave it, 'already' when they had it (or a second tap racing this one
 * gave it), false when it didn't. With `auto`, their credit goes on the new
 * seat in the same batch.
 */
async function tryConfirm(
  db: D1Database,
  session: SessionRow,
  playerId: string,
  nowIso: string,
  maxPlayers: number,
  auto: AutoCredit | null,
  /** The player's own I'm in (or claim link): they agree to the current start time. The organizer's In keeps their answer as it was. */
  ownTap = true,
  /** Set when this batch cleared a late-drop debt as a sub (so the History line is written once, by this request only). */
  sub: { cleared: boolean } = { cleared: false },
) {
  const withCredit = auto ? autoCreditStatements(db, auto, session.id, playerId, nowIso) : [];
  try {
    const existing = await existingRow(db, session.id, playerId);
    if (existing?.status === 'confirmed') return 'already';
    // A sub clears the oldest open late-drop debt in the same batch; a debtor coming back settles only their own.
    const subs = auto && !isOpenLateDrop(existing) ? subClearStatements(db, auto, session.id, playerId, nowIso) : [];
    if (existing) {
      const out = await db.batch([
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
                 ${ownTap ? 'time_confirmed = NULL,' : ''}
                 ${KEEP_PAYMENT_UNLESS_REFUNDED},
                 played = NULL,
                 updated_at = ?3
             WHERE id = ?4 AND status <> 'confirmed' AND ${GUARD}`,
          )
          .bind(session.id, playerId, nowIso, existing.id, maxPlayers),
        ...withCredit,
        ...subs,
      ]);
      if (subs.length) sub.cleared = out[1 + withCredit.length].meta.changes === 1;
      return out[0].meta.changes === 1 ? 'new' : false;
    }
    const out = await db.batch([
      db
        .prepare(
          `INSERT INTO session_players
             (id, session_id, player_id, status, claimed_at, claim_seq, confirmed_at, confirm_seq, payment_status, updated_at)
           SELECT ?4, ?1, ?2, 'confirmed', ?3, ${NEXT_CLAIM_SEQ}, ?3, ${NEXT_CONFIRM_SEQ}, 'unpaid', ?3
           WHERE ${GUARD}`,
        )
        .bind(session.id, playerId, nowIso, newId(), maxPlayers),
      ...withCredit,
      ...subs,
    ]);
    if (subs.length) sub.cleared = out[1 + withCredit.length].meta.changes === 1;
    return out[0].meta.changes === 1 ? 'new' : false;
  } catch (err) {
    if (isTriggerError(err, 'session_full')) return false;
    if (isTriggerError(err, 'session_canceled')) throw new HttpError(409, 'session_canceled', 'This session was canceled.');
    // A second tap racing the first can hit the unique (session, player) key.
    if (err instanceof Error && /UNIQUE/i.test(err.message)) {
      return (await existingRow(db, session.id, playerId))?.status === 'confirmed' ? 'already' : false;
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
             time_confirmed = NULL, played = NULL,
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
    const credits = auto ? autoCreditStatements(db, auto, session.id, row.player_id, nowIso) : [];
    let cleared = false;
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
                 played = NULL,
                 updated_at = ?2
             WHERE id = ?3 AND status = 'waitlisted' AND ${CONFIRMED} < ?4`,
          )
          .bind(session.id, nowIso, row.id, maxPlayers),
        ...credits,
        // Moving in from the waitlist is a sub too (shared/lateFees.ts rule 3).
        ...(auto ? subClearStatements(db, auto, session.id, row.player_id, nowIso) : []),
      ])
      .then((all) => {
        if (auto) cleared = all[1 + credits.length].meta.changes === 1;
        return all[0];
      })
      .catch((err) => {
        if (isTriggerError(err, 'session_full')) return { meta: { changes: 0 } };
        throw err;
      });
    if (res.meta.changes === 0) break;
    if (auto && cleared) await auditSubClears(db, auto.groupId, session.id, row.player_id, nowIso);
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

  // A court on Waitlist works exactly like Not booked here: a normal seat while there is room (credit goes on with it),
  // and the real waitlist only when the game is full beyond the max.
  // Their credit goes on the seat in the same step as the seat itself (never for the organizer).
  const auto = await autoCreditFor(db, session);
  const sub = { cleared: false };
  const got = await tryConfirm(db, session, playerId, nowIso, maxPlayers, auto, mode !== 'organizer', sub);
  if (got) {
    if (got === 'new' && auto && sub.cleared) await auditSubClears(db, auto.groupId, session.id, playerId, nowIso);
    // A second tap or device that found the seat already taken by the first reports (and logs) nothing new.
    const credit = auto && got === 'new' ? await auditAutoCredit(db, auto.groupId, session.id, playerId, nowIso) : { cents: 0, paid: false };
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
 *
 * The seat leaving and the money coming back are ONE batch, so a request cut
 * off halfway can't leave a player out with their money still on the game.
 * Tapping again on a seat that is already out finishes any money still on it
 * (older drops did this in steps) and changes nothing else.
 */
export async function withdraw(
  db: D1Database,
  group: GroupRow,
  session: SessionRow,
  playerId: string,
  nowMs: number,
  /** LATE_FEES on for this tap (server/lateFees.ts): a player's own drop inside the 12 hours that leaves the game short owes. */
  opts: { lateFees?: boolean } = {},
): Promise<{ freedSpot: boolean; changed: boolean; promoted: Promotion[]; creditBackCents: number; creditReturnedCents: number; lateFee: { paid: boolean } | null }> {
  assertOpen(session, nowMs);
  const existing = await existingRow(db, session.id, playerId);
  const nothing = { freedSpot: false, changed: false, promoted: [], creditBackCents: 0, creditReturnedCents: 0, lateFee: null };
  if (!existing || (existing.status !== 'confirmed' && existing.status !== 'waitlisted' && existing.status !== 'withdrawn')) return nothing;
  const nowIso = new Date(nowMs).toISOString();
  const leaving = existing.status !== 'withdrawn';
  // Read first, for the answer only: the credit on the seat now, and the id the cash-back entry will get.
  const { results: onSeat } = await db
    .prepare("SELECT id, amount_cents FROM credit_ledger WHERE kind = 'used' AND COALESCE(reason, '') <> 'cash' AND session_id = ? AND player_id = ? AND ended_at IS NULL")
    .bind(session.id, playerId)
    .all<{ id: string; amount_cents: number }>();
  const entryId = newId();
  const organizerId = await organizerIdOf(db, group);
  // Late fee (shared/lateFees.ts rule 2): only a seat that was in, never the organizer, inside the 12 hours before the
  // start. Whether the game is left short is worked out inside the same statement that takes the seat out, so two
  // drops at the same moment can't both see "still 4": the one that takes it below 4 owes.
  const feeDrop = !!opts.lateFees && existing.status === 'confirmed' && playerId !== organizerId && nowMs >= lateFeeCutoffMs(session.starts_at);
  const short = LEAVES_SHORT('session_players.session_id', 'session_players.id');
  const owes = `(?4 = 1 AND ${short})`;
  const money = seatMoneyBackStatements(db, {
    entryId,
    groupId: group.id,
    sessionId: session.id,
    playerId,
    organizerId,
    reason: 'dropped',
    nowIso,
    when: (sp) => `${sp}.status = 'withdrawn'`,
  });
  const out = await db.batch([
    ...(leaving
      ? [
          db
            .prepare(
              `UPDATE session_players SET status = 'withdrawn', attendance_confirmed_at = NULL,
                 promoted_at = NULL, promotion_reason = NULL, promotion_notified_at = NULL,
                 played = CASE WHEN ${owes} THEN 0 ELSE played END,
                 late_drop_at = CASE WHEN ${owes} THEN ?1 ELSE late_drop_at END,
                 late_drop_done_at = CASE WHEN ${owes} THEN NULL ELSE late_drop_done_at END,
                 payment_status = CASE WHEN payment_status = 'paid' THEN 'paid' WHEN ${owes} THEN 'unpaid' ELSE 'not_applicable' END,
                 updated_at = ?1
               WHERE id = ?2 AND status = ?3`,
            )
            .bind(nowIso, existing.id, existing.status, feeDrop ? 1 : 0),
        ]
      : []),
    ...money,
  ]);
  const changed = leaving && out[0].meta.changes === 1;
  const [kept, , ended] = out.slice(leaving ? 1 : 0);
  // What THIS batch moved (a second tap at the same moment moved nothing): the cash that became credit, and the credit that went back.
  const cash = kept.meta.changes === 1 ? ((await db.prepare('SELECT amount_cents AS c FROM credit_ledger WHERE id = ?').bind(entryId).first<{ c: number }>())?.c ?? 0) : 0;
  let credit = 0;
  if (ended.meta.changes > 0) {
    const { results: now } = await db
      .prepare("SELECT id FROM credit_ledger WHERE session_id = ? AND player_id = ? AND ended_at = ? AND ended_reason = 'dropped'")
      .bind(session.id, playerId, nowIso)
      .all<{ id: string }>();
    const endedNow = new Set(now.map((r) => r.id));
    credit = onSeat.filter((r) => endedNow.has(r.id)).reduce((sum, r) => sum + r.amount_cents, 0);
  }
  // Did this drop leave an open late-drop debt (its money stayed on the game)?
  const after = changed && feeDrop ? await existingRow(db, session.id, playerId) : null;
  const lateFee = isOpenLateDrop(after) ? { paid: await seatHoldsMoney(db, session.id, playerId) } : null;
  if (!changed && cash === 0 && credit === 0) return nothing;
  if (changed && existing.status === 'confirmed') {
    // A new opening means the organizer should look again.
    await db
      .prepare('UPDATE sessions SET admin_decision = NULL, decision_at = NULL, updated_at = ? WHERE id = ? AND admin_decision IS NOT NULL')
      .bind(nowIso, session.id)
      .run();
  }
  // A court on Waitlist never moves anybody in or out of line by itself: a drop frees a seat for the first real waiter like any game.
  const promoted = changed ? await settle(db, session, nowIso, settingsOf(group).maxPlayers) : [];
  return { freedSpot: changed && existing.status === 'confirmed', changed, promoted, creditBackCents: cash, creditReturnedCents: credit, lateFee };
}

/** The seat still carries money (a payment, or credit used on it): "Your $14 stays on this game". */
async function seatHoldsMoney(db: D1Database, sessionId: string, playerId: string): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT (SELECT payment_status FROM session_players WHERE session_id = ?1 AND player_id = ?2) AS ps,
         (SELECT COALESCE(SUM(amount_cents), 0) FROM credit_ledger WHERE kind = 'used' AND session_id = ?1 AND player_id = ?2 AND ended_at IS NULL) AS used`,
    )
    .bind(sessionId, playerId)
    .first<{ ps: string | null; used: number }>();
  return row?.ps === 'paid' || (row?.used ?? 0) > 0;
}

/** History line when a drop or a Finalize leaves someone owing their $14 (shared/lateFees.ts). */
export async function auditLateFeeOwed(db: D1Database, groupId: string, sessionId: string, playerId: string, kind: 'late_drop' | 'no_show' | 'canceled_late', nowIso: string, actor = 'organizer') {
  const p = await db.prepare('SELECT display_name FROM players WHERE id = ?').bind(playerId).first<{ display_name: string }>();
  await audit(db, groupId, sessionId, 'late_fee_owed', { player: p?.display_name ?? 'A player', playerId, kind }, nowIso, actor);
}

/**
 * A confirmed player dropping out after the cancellation deadline (the
 * booking's own, or the default hours before play) is a "late drop": the
 * organizer sees it, and it counts on the Players screen. Only drops the
 * player makes count, not organizer removals.
 */
export async function recordLateDrop(db: D1Database, session: SessionRow, playerId: string, nowMs: number, settings: GroupSettings, lateFees = false) {
  const start = Date.parse(session.starts_at);
  // With LATE_FEES on, one clock everywhere: start minus 12 hours (shared/lateFees.ts rule 1). Off: as before.
  const deadline = lateFees ? lateFeeCutoffMs(session.starts_at) : deadlineMs({ startsAt: session.starts_at, cancellationDeadlineAt: session.cancellation_deadline_at }, settings);
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
    // A seat that still holds money (an unanswered I paid claim) stays as it is: "No" changes nothing about money.
    await db
      // Nor does it end an open late fee (shared/lateFees.ts): that is cleared by a sub or the organizer, never by "No".
      .prepare(`UPDATE session_players SET status = 'declined', updated_at = ? WHERE id = ? AND NOT (payment_status = 'paid' AND refunded_at IS NULL) AND NOT ${OPEN_FEE('session_players')}`)
      .bind(nowIso, existing.id)
      .run();
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
 * Credit on a seat that still owed would sit on a waitlist spot that owes
 * nothing: it goes back to them in the same batch. (A seat paid in full,
 * with credit or cash, stays paid, as before.)
 */
export async function moveToWaitlist(db: D1Database, session: SessionRow, playerId: string, nowMs: number): Promise<void> {
  assertOpen(session, nowMs);
  const nowIso = new Date(nowMs).toISOString();
  const existing = await existingRow(db, session.id, playerId);
  if (!existing) return addToWaitlist(db, session, playerId, nowIso);
  if (existing.status === 'waitlisted') return;
  // An open late-drop debt (shared/lateFees.ts) is not a seat to move: it would wipe the debt or strand its money.
  if (isOpenLateDrop(existing)) throw new HttpError(409, 'late_fee_open', 'They dropped late and still owe their $14. Clear it on the Money tab first.');
  try {
    await db.batch([
      db
        .prepare(
          `UPDATE session_players SET status = 'waitlisted', claimed_at = ?2, claim_seq = ${NEXT_CLAIM_SEQ}, confirmed_at = NULL, confirm_seq = NULL,
             attendance_confirmed_at = NULL, promoted_at = NULL, promotion_reason = NULL, promotion_notified_at = NULL, played = NULL,
             payment_status = CASE WHEN payment_status = 'paid' THEN 'paid' ELSE 'not_applicable' END,
             updated_at = ?2
           WHERE id = ?3 AND status <> 'waitlisted' AND NOT ${OPEN_LATE_DROP('session_players')}`,
        )
        .bind(session.id, nowIso, existing.id),
      // Only while the seat is on the waitlist and not paid; a repeat finds nothing live and does nothing.
      db
        .prepare(
          `UPDATE credit_ledger SET ended_at = ?1, ended_reason = 'unmarked'
           WHERE kind = 'used' AND COALESCE(reason, '') <> 'cash' AND session_id = ?2 AND player_id = ?3 AND ended_at IS NULL
             AND EXISTS (SELECT 1 FROM session_players WHERE session_id = ?2 AND player_id = ?3 AND status = 'waitlisted' AND payment_status <> 'paid')`,
        )
        .bind(nowIso, session.id, playerId),
    ]);
  } catch (err) {
    if (isTriggerError(err, 'session_canceled')) throw new HttpError(409, 'session_canceled', 'This session was canceled.');
    throw err;
  }
}
