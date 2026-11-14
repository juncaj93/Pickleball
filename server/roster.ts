import type { RosterStatus } from '../shared/api';
import { deadlineMs } from '../shared/cards';
import { capOf, type GroupSettings } from '../shared/settings';
import { DB_LIMIT_MESSAGE } from '../shared/zip10';
import { auditAutoCredit, type AutoCredit, autoCreditFor, autoCreditStatements, holdShortCashStatements, moneyBackAt, seatMoneyBackStatements, splitSeatStatements } from './credit';
import { finishLateDropClear, LEAVES_SHORT, OLDEST_DEBT, OPEN_FEE, OPEN_LATE_DROP, tagOldestLateDrop } from './lateFees';
import { FEE_MIN_PLAYERS, lateFeeCutoffMs } from '../shared/lateFees';
import { newId } from './crypto';
import { type D1Database, isTriggerError } from './db';
import { HttpError } from './http';
import { audit, flatOf, type GroupRow, type SessionRow, waitlistOf, loadRoster, confirmedOf, organizerIdOf, settingsOf, waitQueue } from './repo';
import { confirmedHeads, hasGuestColumns, nextClaimSeq, trimSeatStatements } from './guestSpot';
import { headCount } from '../shared/guestSpot';

// One court, any number from 4 up to the organizer's max (see shared/spots.ts).
//
// Every write that hands out a spot carries its own guard in SQL, so two
// phones tapping at the same moment can't push a session past the max.
// The database trigger (12 confirmed, the widest max) is the backstop.

// Next position in this session's join / spot order. Timestamps can tie
// to the millisecond; these counters can't. ?1 is always the session id.
// Zip 42 "Guest spot": once migration 0021 ran (`g`), a guest in counts as a person and a waiting guest holds a place in the join
// order (server/guestSpot.ts). Before it, these are main's words exactly.
const NEXT_CLAIM_SEQ_OF = (g: boolean) => nextClaimSeq(g);
const NEXT_CONFIRM_SEQ = '(SELECT COALESCE(MAX(x.confirm_seq), 0) + 1 FROM session_players x WHERE x.session_id = ?1)';
const CONFIRMED_OF = (g: boolean) => confirmedHeads(g);

/** Someone not yet in may take a spot while fewer than the max (?5) are in. */
const GUARD_OF = (g: boolean) => `${CONFIRMED_OF(g)} < ?5`;

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
export function subClearStatements(db: D1Database, auto: AutoCredit, sessionId: string, joinerId: string, nowIso: string, g = false, guestJoin = false) {
  return [
    // Zip 42: a late-drop debt that holds the host AND their guest ("If no one takes your 2 spots") is cleared one spot at a time. When
    // the oldest debt still has its guest's share, this sub takes the GUEST's spot: the guest's share comes off the debt (guest_status
    // goes, guest_at marks this moment) and the tag below does nothing this time (one clear per game per moment). The money part of the
    // guest's $14 is handed back right after the batch (auditSubClears). The next sub clears the host's own spot the usual way.
    ...(g ? [guestHalfClear(db, sessionId, joinerId, nowIso, guestJoin)] : []),
    tagOldestLateDrop(db, sessionId, joinerId, nowIso, g, guestJoin),
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

/** Zip 42: the guest's share of the oldest open late-drop debt comes off it (see subClearStatements). */
function guestHalfClear(db: D1Database, sessionId: string, joinerId: string, nowIso: string, guestJoin = false) {
  return db
    .prepare(
      // Round 3: the oldest debt can also be a host still in who removed their guest late (OLDEST_DEBT).
      `UPDATE session_players SET guest_status = NULL, guest_at = ?3, updated_at = ?3
       WHERE id = ${OLDEST_DEBT('?1')}
         AND guest_status = 'late' AND guest_name IS NOT NULL
         AND EXISTS (SELECT 1 FROM session_players j WHERE j.session_id = ?1 AND j.player_id = ?2 AND j.status = 'confirmed' AND ${guestJoin ? "j.guest_status = 'confirmed' AND j.updated_at = ?3" : 'j.confirmed_at = ?3'})
         AND NOT EXISTS (SELECT 1 FROM session_players t WHERE t.session_id = ?1
                           AND ((t.status = 'withdrawn' AND t.late_drop_at IS NOT NULL AND t.late_drop_done_at = ?3)
                             OR (t.status IN ('withdrawn', 'confirmed') AND t.guest_at = ?3 AND t.guest_status IS NULL AND t.guest_name IS NOT NULL)))`,
    )
    .bind(sessionId, joinerId, nowIso);
}

/** Did this batch's sub clear something (a whole debt, or a guest's share of one)? `at`: where the sub statements start. */
export function subCleared(out: { meta: { changes: number } }[], at: number, g: boolean): boolean {
  return g ? out[at].meta.changes === 1 || out[at + 1].meta.changes === 1 : out[at].meta.changes === 1;
}

/** History lines for debts a sub cleared at `nowIso` (none when nothing was cleared). */
export async function auditSubClears(db: D1Database, groupId: string, sessionId: string, subPlayerId: string, nowIso: string, flatCents = 0): Promise<string[]> {
  // Zip 42: a sub took the guest's spot of a pair's debt: the seat now owes one share. What it holds above that comes back as credit
  // (a paid $28 gives $14 back; an unpaid seat simply owes $14 less). Only while that debt is still open and its money is as read.
  if (flatCents > 0 && (await hasGuestColumns(db))) {
    const { results: halves } = await db
      .prepare(
        `SELECT sp.id, sp.player_id, sp.guest_name, sp.status, p.display_name AS name, (SELECT display_name FROM players WHERE id = ?3) AS sub
         FROM session_players sp JOIN players p ON p.id = sp.player_id
         WHERE sp.session_id = ?1 AND sp.guest_at = ?2 AND sp.guest_status IS NULL AND sp.guest_name IS NOT NULL
           AND ((sp.status = 'withdrawn' AND sp.late_drop_at IS NOT NULL AND sp.late_drop_done_at IS NULL) OR sp.status = 'confirmed')`,
      )
      .bind(sessionId, nowIso, subPlayerId)
      .all<{ id: string; player_id: string; guest_name: string; name: string; sub: string | null; status: string }>();
    for (const h of halves) {
      // Round 3: a host still in (they removed the guest late) is trimmed the same way, as a confirmed seat.
      const stillIn = h.status === 'confirmed';
      const id = h.id.replace(/[^0-9A-Za-z-]/g, '');
      const at = nowIso.replace(/[^0-9A-Za-z:.-]/g, '');
      const guard = stillIn
        ? `EXISTS (SELECT 1 FROM session_players g WHERE g.id = '${id}' AND g.status = 'confirmed' AND g.guest_at = '${at}' AND g.guest_status IS NULL)`
        : `EXISTS (SELECT 1 FROM session_players g WHERE g.id = '${id}' AND g.status = 'withdrawn' AND g.guest_at = '${at}' AND g.late_drop_done_at IS NULL)`;
      const trim = await trimSeatStatements(db, { groupId, sessionId, playerId: h.player_id, priceCents: flatCents, nowIso, guard, seatStatus: stillIn ? 'confirmed' : 'withdrawn', reason: 'dropped' });
      if (trim.statements.length) await db.batch(trim.statements);
      await audit(db, groupId, sessionId, 'late_fee_cleared', { player: h.name, playerId: h.player_id, why: 'sub', sub: h.sub ?? 'A player', guest: h.guest_name, amountCents: trim.backCents }, nowIso);
      // A host still in keeps no trace of the removed guest once the debt is cleared.
      if (stillIn) await db.prepare("UPDATE session_players SET guest_name = NULL WHERE id = ? AND status = 'confirmed' AND guest_status IS NULL AND guest_at = ?").bind(h.id, nowIso).run();
    }
  }
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
  const g = await hasGuestColumns(db);
  const NEXT_CLAIM_SEQ = NEXT_CLAIM_SEQ_OF(g);
  const GUARD = GUARD_OF(g);
  try {
    const existing = await existingRow(db, session.id, playerId);
    if (existing?.status === 'confirmed') return 'already';
    // A sub clears the oldest open late-drop debt in the same batch; a debtor coming back settles only their own.
    const subs = auto && !isOpenLateDrop(existing) ? subClearStatements(db, auto, session.id, playerId, nowIso, g) : [];
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
                 played = NULL,${g ? "\n                 guest_name = CASE WHEN status = 'waitlisted' THEN guest_name ELSE NULL END,\n                 guest_status = CASE WHEN status = 'waitlisted' THEN guest_status ELSE NULL END," : ''}
                 updated_at = ?3
             WHERE id = ?4 AND status <> 'confirmed' AND ${GUARD}`,
          )
          .bind(session.id, playerId, nowIso, existing.id, maxPlayers),
        ...withCredit,
        ...subs,
      ]);
      if (subs.length) sub.cleared = subCleared(out, 1 + withCredit.length, g);
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
    if (subs.length) sub.cleared = subCleared(out, 1 + withCredit.length, g);
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
  const g = await hasGuestColumns(db);
  const NEXT_CLAIM_SEQ = NEXT_CLAIM_SEQ_OF(g);
  try {
    const existing = await existingRow(db, session.id, playerId);
    if (existing?.status === 'waitlisted') return;
    if (existing) {
      await db
        .prepare(
          `UPDATE session_players SET status = 'waitlisted', claimed_at = ?2, claim_seq = ${NEXT_CLAIM_SEQ}, confirmed_at = NULL, confirm_seq = NULL,
             attendance_confirmed_at = NULL, promoted_at = NULL, promotion_reason = NULL, promotion_notified_at = NULL,
             time_confirmed = NULL, played = NULL,${g ? ' guest_name = NULL, guest_status = NULL, guest_seq = NULL,' : ''}
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
export async function settle(db: D1Database, session: SessionRow, nowIso: string, settings: GroupSettings): Promise<Promotion[]> {
  // "Card cleanup" (Zip 10) on: no cap but the database's 12, and a move-in is a normal seat (no "spot opened" notice or text card).
  const maxPlayers = capOf(settings);
  const quiet = settings.noCap === true;
  const promoted: Promotion[] = [];
  // Zip 42: a guest in counts as a person, and a guest waiting behind its host takes its turn in line (server/guestSpot.ts).
  const g = await hasGuestColumns(db);
  const CONFIRMED = CONFIRMED_OF(g);
  // Looked up once, only when someone may move in. Moving in uses their credit like tapping I'm in.
  let auto: AutoCredit | null | undefined;
  for (let i = 0; i < 16; i++) {
    const roster = await loadRoster(db, session.id);
    const confirmed = g ? headCount(confirmedOf(roster)) : confirmedOf(roster).length;
    // A waiting guest moves in only behind a host who is in (a host still waiting goes first).
    const waiting = g ? waitQueue(roster).filter((e) => !e.guest || e.row.status === 'confirmed') : waitlistOf(roster).map((row) => ({ row, guest: false }));
    if (confirmed >= maxPlayers || waiting.length === 0) break;
    const next = waiting[0];
    const row = next.row;
    if (auto === undefined) auto = await autoCreditFor(db, session, settings);
    if (next.guest) {
      // The guest takes the spot. The host's seat now costs two shares: a seat already paid for one is held at what it paid and
      // owes the rest (the same move Finalize makes when a price goes up), never the organizer's court payment.
      const two = (auto?.priceCents ?? 0) * 2;
      let guestCleared = false;
      const res = await db
        .batch([
          db
            .prepare(
              `UPDATE session_players SET guest_status = 'confirmed', updated_at = ?2
               WHERE id = ?3 AND status = 'confirmed' AND guest_status = 'waitlisted' AND guest_name IS NOT NULL AND ${CONFIRMED} < ?4`,
            )
            .bind(session.id, nowIso, row.id, maxPlayers),
          ...(auto
            ? holdShortCashStatements(db, {
                sessionId: session.id,
                feeCents: two,
                nowIso,
                playerId: row.player_id,
                organizerId: auto.organizerId,
                seatWhere: (sp) => `${sp}.status = 'confirmed' AND ${sp}.guest_status = 'confirmed' AND ${sp}.updated_at = ?1`,
              })
            : []),
          // A guest moving in is a sub too (shared/lateFees.ts rule 3).
          ...(auto ? subClearStatements(db, auto, session.id, row.player_id, nowIso, g, true) : []),
        ])
        .then((all) => {
          // The sub statements are the last ones (subClearStatements: the guest half, the tag, three money moves, the finish).
          if (auto) guestCleared = subCleared(all, all.length - 6, g);
          return all[0];
        });
      if (res.meta.changes === 0) break;
      if (auto && guestCleared) await auditSubClears(db, auto.groupId, session.id, row.player_id, nowIso, auto.priceCents);
      await audit(db, session.group_id, session.id, 'guest_moved_in', { player: row.display_name, playerId: row.player_id, guest: row.guest_name ?? 'Guest' }, nowIso);
      continue;
    }
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
                 ${quiet ? 'promoted_at = NULL, promotion_reason = NULL' : "promoted_at = ?2, promotion_reason = 'spot_opened'"}, promotion_notified_at = NULL,
                 ${KEEP_PAYMENT_UNLESS_REFUNDED},
                 played = NULL,
                 updated_at = ?2
             WHERE id = ?3 AND status = 'waitlisted' AND ${CONFIRMED} < ?4`,
          )
          .bind(session.id, nowIso, row.id, maxPlayers),
        ...credits,
        // Moving in from the waitlist is a sub too (shared/lateFees.ts rule 3).
        ...(auto ? subClearStatements(db, auto, session.id, row.player_id, nowIso, g) : []),
      ])
      .then((all) => {
        if (auto) cleared = subCleared(all, 1 + credits.length, g);
        return all[0];
      })
      .catch((err) => {
        if (isTriggerError(err, 'session_full')) return { meta: { changes: 0 } };
        throw err;
      });
    if (res.meta.changes === 0) break;
    if (auto && cleared) await auditSubClears(db, auto.groupId, session.id, row.player_id, nowIso, auto.priceCents);
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
  /** The group's settings for this request (Max players, and the price: "Short games" rides on it). */
  settings: GroupSettings,
): Promise<JoinResult> {
  const maxPlayers = capOf(settings);
  assertOpen(session, nowMs);
  const nowIso = new Date(nowMs).toISOString();
  const existing = await existingRow(db, session.id, playerId);
  if (existing?.status === 'confirmed') return { result: 'already_confirmed' };

  // A court on Waitlist works exactly like Not booked here: a normal seat while there is room (credit goes on with it),
  // and the real waitlist only when the game is full beyond the max.
  // Their credit goes on the seat in the same step as the seat itself (never for the organizer).
  const auto = await autoCreditFor(db, session, settings);
  const sub = { cleared: false };
  const got = await tryConfirm(db, session, playerId, nowIso, maxPlayers, auto, mode !== 'organizer', sub);
  if (got) {
    if (got === 'new' && auto && sub.cleared) await auditSubClears(db, auto.groupId, session.id, playerId, nowIso, auto.priceCents);
    // A second tap or device that found the seat already taken by the first reports (and logs) nothing new.
    const credit = auto && got === 'new' ? await auditAutoCredit(db, auto.groupId, session.id, playerId, nowIso) : { cents: 0, paid: false };
    return credit.cents > 0 ? { result: 'confirmed', creditCents: credit.cents, paidWithCredit: credit.paid } : { result: 'confirmed' };
  }
  if (mode !== 'auto') return { result: 'spot_taken' };
  // "Card cleanup" (Zip 10): there is no waitlist. The only way here is the database's own limit (12 in), so say that plainly.
  if (settings.noCap === true) throw new HttpError(409, 'game_limit', DB_LIMIT_MESSAGE);

  await addToWaitlist(db, session, playerId, nowIso);
  const promoted = await settle(db, session, nowIso, settings);
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
  /** cheaperFix (Zip 39, server/cheaperFix.ts): such a drop on a seat paid ABOVE the fee (the game was made cheaper after they paid) keeps only the fee. */
  opts: { lateFees?: boolean; cheaperFix?: boolean } = {},
): Promise<{ freedSpot: boolean; changed: boolean; promoted: Promotion[]; creditBackCents: number; creditReturnedCents: number; lateFee: { paid: boolean; oweCents?: number } | null; guest?: string | null }> {
  assertOpen(session, nowMs);
  const existing = await existingRow(db, session.id, playerId);
  // Zip 42 "Guest spot": the guest leaves with the host. Read before the seat changes (the alert and History name the guest).
  const g = await hasGuestColumns(db);
  const guestRow = g
    ? await db
        .prepare('SELECT guest_name, guest_status FROM session_players WHERE session_id = ? AND player_id = ?')
        .bind(session.id, playerId)
        .first<{ guest_name: string | null; guest_status: string | null }>()
    : null;
  const guestName = guestRow?.guest_name && (guestRow.guest_status === 'confirmed' || guestRow.guest_status === 'waitlisted') ? guestRow.guest_name : null;
  const nothing = { freedSpot: false, changed: false, promoted: [], creditBackCents: 0, creditReturnedCents: 0, lateFee: null };
  if (!existing || (existing.status !== 'confirmed' && existing.status !== 'waitlisted' && existing.status !== 'withdrawn')) return nothing;
  const nowIso = new Date(nowMs).toISOString();
  const leaving = existing.status !== 'withdrawn';
  // Read first, for the answer only: the credit on the seat now, and the id the cash-back entry will get.
  const { results: onSeat } = await db
    .prepare("SELECT id, amount_cents FROM credit_ledger WHERE kind = 'used' AND COALESCE(reason, '') <> 'cash' AND session_id = ? AND player_id = ? AND ended_at IS NULL ORDER BY created_at, rowid")
    .bind(session.id, playerId)
    .all<{ id: string; amount_cents: number }>();
  const entryId = newId();
  const organizerId = await organizerIdOf(db, group);
  // Late fee (shared/lateFees.ts rule 2): only a seat that was in, never the organizer, inside the 12 hours before the
  // start. Whether the game is left short is worked out inside the same statement that takes the seat out, so two
  // drops at the same moment can't both see "still 4": the one that takes it below 4 owes.
  // The organizer counts like any player here (Alex, Nov 2), but their seat's payment is the court payment: it is never
  // turned into an owed share (?5), and nothing on it ever becomes credit.
  const isOrg = playerId === organizerId;
  const feeDrop = !!opts.lateFees && existing.status === 'confirmed' && nowMs >= lateFeeCutoffMs(session.starts_at);
  const short = LEAVES_SHORT('session_players.session_id', 'session_players.id', g);
  const owes = `(?4 = 1 AND ${short})`;
  // Zip 42 round 3 (Alex): a host and guest leaving late owe only the spots the game is short (4 minus everyone left, at most 2). The guest's
  // share stays on the debt only when the game is short by two; short by one, the host owes one share like any late drop; still 4, nothing.
  // A host still in whose guest was removed late ('late') leaves the same way: that spot is already one of the two.
  const short2 = g ? LEAVES_SHORT('session_players.session_id', 'session_players.id', true, FEE_MIN_PLAYERS - 1) : '0';
  const pairSeat = !!guestRow?.guest_name && existing?.status === 'confirmed' && (guestRow.guest_status === 'confirmed' || guestRow.guest_status === 'late');
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
                 payment_status = CASE WHEN payment_status = 'paid' THEN 'paid' WHEN ${owes} AND ?5 = 0 THEN 'unpaid' ELSE 'not_applicable' END,${
                   // Zip 42: the guest leaves too. A late drop that owes with the guest in keeps the guest's share on the debt ('late');
                   // otherwise the guest is simply gone. (Every right-hand side reads the row as it was before this statement.)
                   g
                     ? `
                 guest_status = CASE WHEN ${owes} AND ${short2} AND status = 'confirmed' AND guest_status IN ('confirmed', 'late') AND guest_name IS NOT NULL THEN 'late' ELSE NULL END,
                 guest_name = CASE WHEN ${owes} AND ${short2} AND status = 'confirmed' AND guest_status IN ('confirmed', 'late') THEN guest_name ELSE NULL END,
                 guest_at = CASE WHEN ${owes} AND ${short2} AND status = 'confirmed' AND guest_status = 'confirmed' THEN ?1 ELSE guest_at END,`
                     : ''
                 }
                 updated_at = ?1
               WHERE id = ?2 AND status = ?3`,
            )
            .bind(nowIso, existing.id, existing.status, feeDrop ? 1 : 0, isOrg ? 1 : 0),
        ]
      : []),
    ...money,
    // Zip 27 (A-02): a late drop that owes, on a seat paid at a LOWER price than the game's price now (the game was made longer after
    // they paid): the cash is held against the seat so it owes the rest of the $14, instead of reading "paid". Only this drop's debt
    // (late_drop_at is this moment); never the organizer (their payment is the court payment). Last, so the reads below are unchanged.
    ...(leaving && feeDrop && !isOrg
      ? pairSeat
        ? // Zip 42: a pair's debt is two shares when the guest's share stayed on it ("you still owe $28"), else one (round 3).
          [2, 1].flatMap((units) =>
            holdShortCashStatements(db, {
              sessionId: session.id,
              feeCents: flatOf(session, settingsOf(group)) * units,
              nowIso,
              playerId,
              organizerId,
              seatWhere: (sp) =>
                `${sp}.status = 'withdrawn' AND ${sp}.played = 0 AND ${sp}.late_drop_at = ?1 AND ${sp}.late_drop_done_at IS NULL AND ${sp}.guest_status ${units === 2 ? "= 'late'" : 'IS NULL'}`,
            }),
          )
        : holdShortCashStatements(db, {
            sessionId: session.id,
            feeCents: flatOf(session, settingsOf(group)),
            nowIso,
            playerId,
            organizerId,
            seatWhere: (sp) => `${sp}.status = 'withdrawn' AND ${sp}.played = 0 AND ${sp}.late_drop_at = ?1 AND ${sp}.late_drop_done_at IS NULL`,
          })
      : []),
    // Zip 39 ("Made cheaper after paying", server/cheaperFix.ts; switch off: nothing here): the mirror of the hold above. A seat that holds MORE
    // than the fee (the game was made cheaper after they paid) keeps exactly the fee on the game, and the rest comes back now as credit
    // ('dropped'): the cash part first, then credit used on it. Only this drop's own new debt, read as it was before this batch.
    ...(leaving && feeDrop && !isOrg && opts.cheaperFix
      ? await cheaperDropStatements(db, group, session, playerId, onSeat, nowIso, pairSeat ? 2 : 1)
      : []),
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
  // Zip 39: what the "Made cheaper after paying" trim gave back (cash that became credit, plus credit used on the seat that went back,
  // net of what stays on it), as one Activity line like any other money back. Only when the switch was on for this drop.
  if (changed && feeDrop && !isOrg && opts.cheaperFix) {
    const t = await db
      .prepare(
        `SELECT
           (SELECT COALESCE(SUM(amount_cents), 0) FROM credit_ledger WHERE session_id = ?1 AND player_id = ?2 AND kind = 'kept' AND reason = 'dropped' AND created_at = ?3 AND id <> ?4) +
           (SELECT COALESCE(SUM(amount_cents), 0) FROM credit_ledger WHERE session_id = ?1 AND player_id = ?2 AND kind = 'used' AND COALESCE(reason, '') <> 'cash' AND ended_at = ?3 AND ended_reason = 'dropped') -
           (SELECT COALESCE(SUM(amount_cents), 0) FROM credit_ledger WHERE session_id = ?1 AND player_id = ?2 AND kind = 'used' AND COALESCE(reason, '') <> 'cash' AND created_at = ?3 AND ended_at IS NULL) AS c,
           (SELECT display_name FROM players WHERE id = ?2) AS name`,
      )
      .bind(session.id, playerId, nowIso, entryId)
      .first<{ c: number; name: string | null }>();
    if (t && t.c > 0) await audit(db, group.id, session.id, 'credit_back', { player: t.name ?? 'A player', playerId, amountCents: t.c, reason: 'dropped' }, nowIso);
  }
  // Round 3: a pair that left the game short by ONE owes one share: what the seat holds above it comes back now as credit (a paid $28
  // gives $14 back), only while this drop's own one-share debt is open.
  let pairBack = 0;
  if (changed && feeDrop && !isOrg && pairSeat) {
    const seat = await db.prepare('SELECT id, guest_status, late_drop_at, late_drop_done_at, status FROM session_players WHERE id = ?').bind(existing.id).first<{ id: string; guest_status: string | null; late_drop_at: string | null; late_drop_done_at: string | null; status: string }>();
    if (seat && seat.status === 'withdrawn' && seat.guest_status === null && seat.late_drop_at === nowIso && !seat.late_drop_done_at && /^[0-9A-Za-z-]+$/.test(seat.id) && /^[0-9A-Za-z:.\-]+$/.test(nowIso)) {
      const guard = `EXISTS (SELECT 1 FROM session_players g WHERE g.id = '${seat.id}' AND g.status = 'withdrawn' AND g.played = 0 AND g.late_drop_at = '${nowIso}' AND g.late_drop_done_at IS NULL AND g.guest_status IS NULL)`;
      const trim = await trimSeatStatements(db, { groupId: group.id, sessionId: session.id, playerId, priceCents: flatOf(session, settingsOf(group)), nowIso, guard, seatStatus: 'withdrawn', reason: 'dropped' });
      if (trim.statements.length) {
        await db.batch(trim.statements);
        pairBack = trim.backCents;
        if (pairBack > 0) {
          const who = await db.prepare('SELECT display_name FROM players WHERE id = ?').bind(playerId).first<{ display_name: string }>();
          await audit(db, group.id, session.id, 'credit_back', { player: who?.display_name ?? 'A player', playerId, amountCents: pairBack, reason: 'dropped' }, nowIso);
        }
      }
    }
  }
  // Did this drop leave an open late-drop debt (its money stayed on the game)?
  const after = changed && feeDrop ? await existingRow(db, session.id, playerId) : null;
  // Zip 42: a debt that kept the guest's share is two shares.
  const units = g && after && isOpenLateDrop(after) ? ((await db.prepare("SELECT guest_status FROM session_players WHERE id = ?").bind(after.id).first<{ guest_status: string | null }>())?.guest_status === 'late' ? 2 : 1) : 1;
  const lateFee = isOpenLateDrop(after) ? (isOrg ? { paid: false } : await lateFeeLeft(db, session.id, playerId, flatOf(session, settingsOf(group)) * units, units > 1)) : null;
  if (!changed && cash === 0 && credit === 0) return nothing;
  if (changed && existing.status === 'confirmed') {
    // A new opening means the organizer should look again.
    await db
      .prepare('UPDATE sessions SET admin_decision = NULL, decision_at = NULL, updated_at = ? WHERE id = ? AND admin_decision IS NOT NULL')
      .bind(nowIso, session.id)
      .run();
  }
  // A court on Waitlist never moves anybody in or out of line by itself: a drop frees a seat for the first real waiter like any game.
  const promoted = changed ? await settle(db, session, nowIso, settingsOf(group)) : [];
  return { freedSpot: changed && existing.status === 'confirmed', changed, promoted, creditBackCents: cash + pairBack, creditReturnedCents: credit, lateFee, ...(changed && guestName ? { guest: guestName } : {}) };
}

/**
 * Zip 39: the late drop's trim (see withdraw). Nothing when the seat holds the fee or less, or carries an I paid nobody confirmed (a claim).
 * The statements only run while this drop's own debt is on the seat (late_drop_at is this moment, still open) and the payment is as read.
 */
async function cheaperDropStatements(
  db: D1Database,
  group: GroupRow,
  session: SessionRow,
  playerId: string,
  onSeat: { id: string; amount_cents: number }[],
  nowIso: string,
  /** Zip 42: 2 when the debt holds the guest's share too. */
  units = 1,
) {
  const existing = await db
    .prepare('SELECT id, player_id, payment_status, payment_amount_cents, refunded_at, self_paid_at FROM session_players WHERE session_id = ? AND player_id = ?')
    .bind(session.id, playerId)
    .first<{ id: string; player_id: string; payment_status: string; payment_amount_cents: number | null; refunded_at: string | null; self_paid_at: string | null }>();
  if (!existing) return [];
  const paid = existing.payment_status === 'paid' && !existing.refunded_at;
  if (paid && existing.self_paid_at) return [];
  const fee = flatOf(session, settingsOf(group)) * units;
  const held = (
    await db
      .prepare("SELECT COALESCE(SUM(amount_cents), 0) AS c FROM credit_ledger WHERE kind = 'used' AND reason = 'cash' AND session_id = ? AND player_id = ? AND ended_at IS NULL")
      .bind(session.id, existing.player_id)
      .first<{ c: number }>()
  )?.c ?? 0;
  const seat = {
    playerId: existing.player_id,
    paid,
    paymentCents: paid ? (existing.payment_amount_cents ?? 0) : 0,
    used: onSeat.map((u) => ({ id: u.id, cents: u.amount_cents })),
    heldCashCents: held,
  };
  if ((seat.paid ? seat.paymentCents : seat.used.reduce((s, u) => s + u.cents, 0) + held) <= fee) return [];
  if (!/^[0-9A-Za-z-]+$/.test(existing.id) || !/^[0-9A-Za-z:.\-]+$/.test(nowIso)) throw new Error('unsafe sql text');
  const guard = `EXISTS (SELECT 1 FROM session_players g WHERE g.id = '${existing.id}' AND g.status = 'withdrawn' AND g.played = 0 AND g.late_drop_at = '${nowIso}' AND g.late_drop_done_at IS NULL)`;
  return splitSeatStatements(db, { groupId: group.id, sessionId: session.id, seat, priceCents: fee, nowIso, guard, seatStatus: 'withdrawn', reason: 'dropped' }).statements;
}

/**
 * What a new late-drop debt says (Zip 27, A-02). A seat whose cash was just held because it was paid below the fee (the game was made longer
 * after the payment) owes only the rest: { paid: false, oweCents } ("You owe $3 unless someone takes your spot"). Any other seat: exactly as
 * before (seatHoldsMoney: "Your $14 stays on this game", or "You owe $14").
 */
async function lateFeeLeft(db: D1Database, sessionId: string, playerId: string, feeCents: number, sayAmount = false): Promise<{ paid: boolean; oweCents?: number }> {
  const row = await db
    .prepare(
      `SELECT (SELECT payment_status FROM session_players WHERE session_id = ?1 AND player_id = ?2) AS ps,
         (SELECT COALESCE(SUM(amount_cents), 0) FROM credit_ledger WHERE kind = 'used' AND session_id = ?1 AND player_id = ?2 AND ended_at IS NULL) AS used,
         (SELECT COUNT(*) FROM credit_ledger WHERE kind = 'used' AND reason = 'cash' AND session_id = ?1 AND player_id = ?2 AND ended_at IS NULL) AS held`,
    )
    .bind(sessionId, playerId)
    .first<{ ps: string | null; used: number; held: number }>();
  if (row?.ps === 'unpaid' && (row.held ?? 0) > 0) return { paid: false, oweCents: Math.max(0, feeCents - (row.used ?? 0)) };
  const paid = await seatHoldsMoney(db, sessionId, playerId);
  // Zip 42: a pair's debt says its own amount ("You owe $28"); every other debt exactly as before.
  if (sayAmount && row?.ps === 'unpaid') return { paid, oweCents: Math.max(0, feeCents - (row.used ?? 0)) };
  return { paid };
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
export async function auditLateFeeOwed(
  db: D1Database,
  groupId: string,
  sessionId: string,
  playerId: string,
  kind: 'late_drop' | 'no_show' | 'canceled_late',
  nowIso: string,
  actor = 'organizer',
  /** The price owed when it is not the usual $14 (a late cancel with the fee split): the History line says it. */
  priceCents: number | null = null,
) {
  const p = await db.prepare('SELECT display_name FROM players WHERE id = ?').bind(playerId).first<{ display_name: string }>();
  await audit(db, groupId, sessionId, 'late_fee_owed', { player: p?.display_name ?? 'A player', playerId, kind, ...(priceCents !== null ? { priceCents } : {}) }, nowIso, actor);
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
  const NEXT_CLAIM_SEQ = NEXT_CLAIM_SEQ_OF(false);
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
  const NEXT_CLAIM_SEQ = NEXT_CLAIM_SEQ_OF(false);
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
  const g = await hasGuestColumns(db);
  // Zip 42 round 3: a host still owing a guest's spot removed late is not a seat to move either (the move would wipe that $14).
  if (g) {
    const own = await db.prepare('SELECT guest_status FROM session_players WHERE id = ?').bind(existing.id).first<{ guest_status: string | null }>();
    if (own?.guest_status === 'late' && existing.status === 'confirmed')
      throw new HttpError(409, 'late_fee_open', "Their guest's spot is still owed (removed late). Clear it in the Players sheet first.");
  }
  const NEXT_CLAIM_SEQ = NEXT_CLAIM_SEQ_OF(g);
  try {
    await db.batch([
      db
        .prepare(
          `UPDATE session_players SET status = 'waitlisted', claimed_at = ?2, claim_seq = ${NEXT_CLAIM_SEQ}, confirmed_at = NULL, confirm_seq = NULL,
             attendance_confirmed_at = NULL, promoted_at = NULL, promotion_reason = NULL, promotion_notified_at = NULL, played = NULL,${
               // Zip 42: the guest goes to the waitlist right behind the host.
               g
                 ? `
             guest_seq = CASE WHEN guest_name IS NOT NULL AND guest_status IN ('confirmed', 'waitlisted') THEN ${NEXT_CLAIM_SEQ} + 1 ELSE guest_seq END,
             guest_status = CASE WHEN guest_name IS NOT NULL AND guest_status = 'confirmed' THEN 'waitlisted' ELSE guest_status END,`
                 : ''
             }
             payment_status = CASE WHEN payment_status = 'paid' THEN 'paid' ELSE 'not_applicable' END,
             updated_at = ?2
           WHERE id = ?3 AND status <> 'waitlisted' AND NOT ${OPEN_LATE_DROP('session_players')}${g ? " AND NOT (status = 'confirmed' AND COALESCE(guest_status, '') = 'late')" : ''}`,
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
