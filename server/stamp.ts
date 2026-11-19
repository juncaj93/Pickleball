import { sha256 } from './crypto';
import type { Ctx } from './context';
import type { GroupRow } from './repo';
import { timeShiftForAll } from './timeShift';
import { payAlwaysForAll } from './payAlways';
import { payNoteForAll } from './payNote';
import { playerFix1ForAll } from './playerFix1';
import { instantTapsForAll } from './instantTaps';
import { motionSetting, motionSettingRead } from './motion';
import { fewerDb } from './speed';
import { homeCollapseForAll } from './homeCollapse';
import { colorCleanupForAll, playerCardsForAll, tonightGlowForAll } from './zip7';
import { paySheetForAll } from './paySheet';
import { lateFeesForAll } from './lateFees';
import { hiddenGameIds, hiddenGameIdsRead } from './hideGame';
import { cardTimeForAll, shortGamesForAll } from './zip9';
import { longGamesOn } from './bookingHours';
import { cardCleanupForAll } from './zip10';
import { alertCardsForAll } from './zip11';
import { seatDotsForAll } from './seatDots';
import { gameDayCardForAll } from './gameDay';
import { afterGameCardForAll } from './afterGame';
import { adminTournamentStamp, adminTourReads, playerTournamentStamp, playerTourReads, type TourReads, tournamentsFlags } from './tournament';
import { playerAwardsFor } from './tournamentEnd';
import type { AdminTournamentView, PlayerTournamentView, TourAwardsView } from '../shared/tournament';
import type { D1PreparedStatement, D1Result } from './db';
import { isPretend } from './pretend';

/**
 * Zip 62: one batch with the tournament reads added at its end (only while the switch is on), or, if that fails (a database without the
 * tournament tables), the batch exactly as before and no tournament rows (the views then read the old way). `plain` is the screen's own batch.
 * The two look-only databases ("Pretend it's...", whose batches answer nothing at all, and the read-only PIN's) keep the old way too: their
 * answers are exactly what they were.
 */
async function batchWithTour<Row>(
  ctx: Ctx,
  plain: () => Promise<D1Result[]>,
  first: D1PreparedStatement[],
  tour: TourReads<Row> | null,
): Promise<{ results: D1Result[]; pre?: ReturnType<TourReads<Row>['from']> }> {
  if (tour && !isPretend(ctx.db)) {
    const all = await ctx.db.batch([...first, ...tour.reads.map((r) => ctx.db.prepare(r.sql).bind(...r.values))]).catch(() => null);
    if (all && all.length === first.length + tour.reads.length) return { results: all.slice(0, first.length), pre: tour.from(all.slice(first.length)) };
  }
  return { results: await plain() };
}

/** A new fingerprint at least this often, so clock-driven changes (tonight, game day 8:00 AM, started) show up. */
const TIME_BUCKET_MS = 10 * 60_000;
/** Games that ended longer ago than this are not on the player screen, except seats this player still owes for. */
const PAST_MS = 90 * 86_400_000;

/**
 * The "did anything change?" fingerprint for one player's screen. A short
 * opaque code: it changes when anything that player can see changes, and
 * says nothing else (it is a hash, so it holds no names, money or numbers).
 *
 * Everyone's part: the games, who is in and in what order, the names list,
 * the group settings. Only the viewer's own part: their payment state, their
 * credit entries, their cash out requests, their own record. Other players'
 * payments, credit and phone numbers are never read here.
 *
 * Read-only (no sessions are created), a handful of small queries in one
 * round trip, so it is cheap to ask every few seconds.
 */
export async function changeStamp(ctx: Ctx, group: GroupRow, playerId: string | null): Promise<string> {
  return (await changeStampAndTour(ctx, group, playerId)).stamp;
}

/**
 * changeStamp, and (Zip 62) the tournament card it built on the way (`tour`, only when it was built without an error), so GET /api/group sends
 * that card instead of reading and building it a second time. While the switch is on for this phone and a name is picked, the card's reads go
 * in the stamp's own batch: no trip of their own.
 */
export async function changeStampAndTour(
  ctx: Ctx,
  group: GroupRow,
  playerId: string | null,
): Promise<{ stamp: string; tour?: PlayerTournamentView | null; awards?: TourAwardsView | null }> {
  const me = playerId ?? '';
  const upcomingFrom = new Date(ctx.nowMs - 36 * 3_600_000).toISOString();
  const pastFrom = new Date(ctx.nowMs - PAST_MS).toISOString();
  // withTime: this player's "Still in" answers (migration 0016). Everything else still works if that column is missing.
  const reads = (withTime: boolean): { sql: string; values: unknown[] }[] => [
    {
      sql: `SELECT id, status, starts_at, ends_at, court_state, booking_status, cancel_reason, finalized_at, final_price_cents, final_played_count, is_extra, note, holiday_hours_ok_at, updated_at
         FROM sessions WHERE group_id = ? AND ends_at > ? ORDER BY starts_at`,
      values: [group.id, pastFrom],
    },
    {
      sql: `SELECT sp.session_id, sp.player_id, sp.status, sp.claim_seq, sp.confirm_seq, sp.attendance_confirmed_at, sp.promoted_at
         FROM session_players sp JOIN sessions s ON s.id = sp.session_id
         WHERE s.group_id = ? AND s.ends_at > ? ORDER BY sp.session_id, sp.player_id`,
      values: [group.id, upcomingFrom],
    },
    {
      sql: `SELECT sp.session_id, sp.status, sp.payment_status, sp.paid_at, sp.self_paid_at, sp.payment_amount_cents, sp.refunded_at, sp.played, sp.late_drop_at, sp.late_drop_done_at${withTime ? ', sp.time_confirmed' : ''}
         FROM session_players sp JOIN sessions s ON s.id = sp.session_id
         WHERE sp.player_id = ? AND s.group_id = ? AND s.ends_at > ? ORDER BY sp.session_id`,
      values: [me, group.id, pastFrom],
    },
    { sql: 'SELECT id, kind, amount_cents, ended_at FROM credit_ledger WHERE group_id = ? AND player_id = ? ORDER BY created_at, id', values: [group.id, me] },
    { sql: 'SELECT id, status, amount_cents, resolved_at FROM refund_requests WHERE group_id = ? AND player_id = ? ORDER BY created_at, id', values: [group.id, me] },
    { sql: 'SELECT id, display_name, is_active FROM players WHERE group_id = ? ORDER BY id', values: [group.id] },
    { sql: 'SELECT is_regular, is_active FROM players WHERE id = ? AND group_id = ?', values: [me, group.id] },
  ];
  const queries = (withTime: boolean) => reads(withTime).map((r) => ctx.db.prepare(r.sql).bind(...r.values));
  // Zip 62: the tournament card's reads, in this same trip (only while the switch is on for this phone and a name is picked; off: none, the
  // batch is exactly main's). The switch question is answered from the switch rows the request already read (no trip).
  const tour = playerId && (await tournamentsFlags(ctx, group.id)).on ? playerTourReads(ctx, group, playerId) : null;
  // SPEED_FEWER_QUERIES (server/speed.ts): the two switch reads further down (player motion, hidden games) ride in the same trip.
  await fewerDb(ctx)?.prefetch([
    ...reads(true).map((r) => ({ kind: 'all' as const, ...r })),
    { kind: 'first', ...motionSettingRead(group.id, 'player') },
    { kind: 'all', ...hiddenGameIdsRead(group.id) },
    ...(tour ? tour.reads.map((r) => ({ kind: 'all' as const, ...r })) : []),
  ]);
  const { results, pre } = await batchWithTour(ctx, () => ctx.db.batch(queries(true)).catch(() => ctx.db.batch(queries(false))), queries(true), tour);
  const [sessions, roster, mine, ledger, requests, players, self] = results;
  // Built once (last, where it always was): the stamp's part here, and the same card for GET /api/group.
  let tourView: PlayerTournamentView | null | undefined;
  let awardsView: TourAwardsView | null | undefined;
  const part = (r: { results: unknown[] }) => JSON.stringify(r.results);
  const raw = [
    part(sessions),
    part(roster),
    part(mine),
    part(ledger),
    part(requests),
    part(players),
    part(self),
    // Group settings the screen shows (never the PIN hash or the link key).
    JSON.stringify([group.name, group.timezone, group.venmo_url, group.organizer_name, group.settings_json, group.first_session_date]),
    me,
    Math.floor(ctx.nowMs / TIME_BUCKET_MS),
    // The organizer turning the moved-game notice on or off for everyone.
    (await timeShiftForAll(ctx.db, group.id)) ? 'ts' : '',
    // The organizer turning "Ask for payment on every game" on or off for everyone.
    (await payAlwaysForAll(ctx.db, group.id)) ? 'pa' : '',
    // The organizer turning the "No Venmo?" note on or off for everyone.
    (await payNoteForAll(ctx.db, group.id)) ? 'pn' : '',
    // The organizer turning "Player screen fixes" on or off for everyone.
    (await playerFix1ForAll(ctx.db, group.id)) ? 'pf' : '',
    // The organizer turning the Pay sheet on or off for everyone.
    (await paySheetForAll(ctx.db, group.id)) ? 'ps' : '',
    // The organizer turning "Late drops owe $14" on or off for everyone (the drop dialog's words follow it).
    (await lateFeesForAll(ctx.db, group.id)) ? 'lf' : '',
    // The organizer turning "Instant taps" on or off for everyone (the screen then knows to draw taps at once).
    (await instantTapsForAll(ctx.db, group.id)) ? 'it' : '',
    // The organizer turning "Home collapse" on or off for everyone (the Home list then lays out differently).
    (await homeCollapseForAll(ctx.db, group.id)) ? 'hc' : '',
    // Zip 7 switches: a segment only exists while a switch is on, so with all three off the stamp is exactly what it was.
    ...((await tonightGlowForAll(ctx.db, group.id)) ? ['tg'] : []),
    ...((await colorCleanupForAll(ctx.db, group.id)) ? ['cc'] : []),
    ...((await playerCardsForAll(ctx.db, group.id)) ? ['pc'] : []),
    // Zip 9 switches: the same rule, a segment only while the switch is on for everyone.
    ...((await shortGamesForAll(ctx.db, group.id)) ? ['sg'] : []),
    // Zip 24: the 2.5 and 3 hour price rows turn on with the Booking hours row (for everyone, kill switch allowing it): a segment only while on, so off the stamp is exactly what it was.
    ...((await longGamesOn(ctx, group.id)) ? ['lg'] : []),
    ...((await cardTimeForAll(ctx.db, group.id)) ? ['ct'] : []),
    // Zip 10: the same rule.
    ...((await cardCleanupForAll(ctx.db, group.id)) ? ['cl'] : []),
    // Zip 11: the same rule.
    ...((await alertCardsForAll(ctx.db, group.id)) ? ['ac'] : []),
    // Seat dots: the same rule.
    ...((await seatDotsForAll(ctx.db, group.id)) ? ['sd'] : []),
    // Zip 14, Game day card: the same rule (a court change moves the game's updated_at, which the games read above already covers).
    ...((await gameDayCardForAll(ctx.db, group.id)) ? ['gd'] : []),
    // Zip 16, After-game cards: the same rule (a new credit record already changes the ledger part above).
    ...((await afterGameCardForAll(ctx.db, group.id)) ? ['ag'] : []),
    // The organizer changing the player animations in Settings (nothing is added until the row is first used).
    (await motionSetting(ctx.db, group.id, 'player')) ?? '',
    // The organizer removing a canceled game from the player screen (or putting it back).
    [...(await hiddenGameIds(ctx.db, group.id))].sort().join(','),
    // Zip 55 "Tournaments": a segment only while this player may see a tournament (switch on, and Everyone or the organizer's own Only me
    // phone), so with the switch off, or a tournament on Only me, the stamp is exactly what it was.
    // Zip 62: switched off for this phone (or no name picked) nothing is built or read, exactly as before (the card would be null).
    ...(await (async () => {
      if (!tour) return [];
      const t = await playerTournamentStamp(ctx, group, playerId, pre);
      tourView = t.view;
      return t.part ? [t.part] : [];
    })()),
    // Zip 58: after a tournament ends, the ticker, the congratulations card and medals (a segment only while there is something to show).
    ...(await (async () => {
      if (!tour) return [];
      const a = await playerAwardsFor(ctx, group, playerId, false, pre?.awards).catch(() => undefined);
      awardsView = a;
      return a ? [`awards:${JSON.stringify(a)}`] : [];
    })()),
  ].join('|');
  return { stamp: (await sha256(raw)).slice(0, 16), ...(tourView !== undefined ? { tour: tourView } : {}), ...(awardsView !== undefined ? { awards: awardsView } : {}) };
}

/**
 * The organizer's "did anything change?" fingerprint: the same idea as the
 * player one, but for everything the organizer screens show (every game, the
 * whole roster with payments, credit, cash out requests, the names list, the
 * "Do this now" taps and the group settings). A short opaque hash, read-only,
 * one round trip of small queries, so it is cheap to ask every few seconds.
 */
export async function adminChangeStamp(ctx: Ctx, group: GroupRow): Promise<string> {
  return (await adminChangeStampAndTour(ctx, group)).stamp;
}

/**
 * Zip 68: the organizer fingerprint's reads, word for word (withMarks: the "Do this now" taps; withTime: the "Still in" answers). The dashboard
 * lists them (and the tournament reads below) in its own shared trip, so the fingerprint's batch is answered from it: no trip of its own.
 */
export function adminStampReads(group: GroupRow, nowMs: number, withMarks = true, withTime = withMarks): { sql: string; values: unknown[] }[] {
  const pastFrom = new Date(nowMs - PAST_MS).toISOString();
  return [
    {
      sql: `SELECT id, status, starts_at, ends_at, court_state, booking_status, cancel_reason, cancellation_deadline_at, admin_decision, finalized_at, final_price_cents, final_played_count,
                is_extra, note, shown_early, holiday_hours_ok_at, day_before_done_at, last_call_done_at, court_cost_cents, updated_at
         FROM sessions WHERE group_id = ? AND ends_at > ? ORDER BY starts_at`,
      values: [group.id, pastFrom],
    },
    {
      sql: `SELECT sp.session_id, sp.player_id, sp.status, sp.claim_seq, sp.confirm_seq, sp.attendance_confirmed_at, sp.promoted_at,
                sp.payment_status, sp.paid_at, sp.self_paid_at, sp.payment_amount_cents, sp.refunded_at, sp.played, sp.late_drop_at, sp.late_drop_done_at${withTime ? ', sp.time_confirmed' : ''}
         FROM session_players sp JOIN sessions s ON s.id = sp.session_id
         WHERE s.group_id = ? AND s.ends_at > ? ORDER BY sp.session_id, sp.player_id`,
      values: [group.id, pastFrom],
    },
    { sql: 'SELECT COUNT(*) AS n, MAX(created_at) AS c, COUNT(ended_at) AS e, MAX(ended_at) AS m FROM credit_ledger WHERE group_id = ?', values: [group.id] },
    { sql: 'SELECT COUNT(*) AS n, MAX(created_at) AS c, COUNT(resolved_at) AS r, MAX(resolved_at) AS m FROM refund_requests WHERE group_id = ?', values: [group.id] },
    { sql: 'SELECT id, display_name, is_active, is_regular FROM players WHERE group_id = ? ORDER BY id', values: [group.id] },
    { sql: 'SELECT MAX(created_at) AS last FROM admin_audit_log WHERE group_id = ?', values: [group.id] },
    // The "Do this now" taps. Everything else still works if that table is missing.
    ...(withMarks ? [{ sql: "SELECT session_id, task FROM task_log WHERE group_id = ? AND kind = 'mark' ORDER BY session_id, task", values: [group.id] }] : []),
  ];
}

/** Zip 68: every read of the organizer fingerprint's one trip (its own and, while the switch is on, the tournament view's), for a prefetch list. */
export async function adminStampTripReads(ctx: Ctx, group: GroupRow): Promise<{ kind: 'all'; sql: string; values: unknown[] }[]> {
  const tour = (await tournamentsFlags(ctx, group.id)).on ? adminTourReads(group, ctx.nowMs) : null;
  return [...adminStampReads(group, ctx.nowMs), ...(tour ? tour.reads : [])].map((r) => ({ kind: 'all' as const, ...r }));
}

/**
 * adminChangeStamp, and (Zip 62) the tournament view it built on the way (`tour`, only while the switch is on and built without an error), so
 * the dashboard sends that view instead of reading and building it a second time. Its reads go in the stamp's own batch: no trip of their own.
 */
export async function adminChangeStampAndTour(ctx: Ctx, group: GroupRow): Promise<{ stamp: string; tour?: AdminTournamentView | null }> {
  // Zip 62: while the switch is on for this phone, the tournament view's reads ride in this same trip (off: none, the batch is exactly main's).
  // The switch question is answered from the switch rows the sign-in check already read (no trip).
  const tour = (await tournamentsFlags(ctx, group.id)).on ? adminTourReads(group, ctx.nowMs) : null;
  // withTime: the "Still in" answers (migration 0016). Both extras are left out, one at a time, if missing.
  const queries = (withMarks: boolean, withTime = withMarks) => adminStampReads(group, ctx.nowMs, withMarks, withTime).map((r) => ctx.db.prepare(r.sql).bind(...r.values));
  const { results, pre } = await batchWithTour(
    ctx,
    () =>
      ctx.db
        .batch(queries(true, true))
        .catch(() => ctx.db.batch(queries(true, false)))
        .catch(() => ctx.db.batch(queries(false, false))),
    queries(true, true),
    tour,
  );
  const [sessions, roster, ledger, requests, players, audit] = results;
  let tourView: AdminTournamentView | null | undefined;
  const marks = results[6] ?? { results: [] };
  const part = (r: { results: unknown[] }) => JSON.stringify(r.results);
  const raw = [
    part(sessions),
    part(roster),
    part(ledger),
    part(requests),
    part(players),
    part(marks),
    part(audit),
    JSON.stringify([group.name, group.timezone, group.venmo_url, group.organizer_name, group.settings_json, group.first_session_date, group.venue_name, group.venue_address]),
    Math.floor(ctx.nowMs / TIME_BUCKET_MS),
    // Zip 55 "Tournaments": a segment only while the switch is on (off: the stamp is exactly what it was).
    ...(await (async () => {
      if (!tour) return [];
      const t = await adminTournamentStamp(ctx, group, pre);
      tourView = t.view;
      return t.part ? [t.part] : [];
    })()),
  ].join('|');
  return { stamp: (await sha256(raw)).slice(0, 16), ...(tourView !== undefined ? { tour: tourView } : {}) };
}
