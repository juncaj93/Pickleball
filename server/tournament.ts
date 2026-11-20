import type { Ctx } from './context';
import type { D1Database } from './db';
import { HttpError } from './http';
import { newId } from './crypto';
import { requireAdmin } from './auth';
import * as v from './validate';
import { organizerSignedIn } from './zip13';
import { ADMIN_COOKIE } from './context';
import { VIEW_ONLY_COOKIE_PREFIX } from './viewOnly';
import { audit, type GroupRow, organizerIdOf, organizerIdRead, playersRead, type ReadSpec } from './repo';
import { localParts } from '../shared/time';
import { formatPrice } from '../shared/money';
import {
  type AdminTicketView,
  type PlayerTicketsView,
  type TicketPlaceView,
  DEFAULT_FORMAT,
  DEFAULT_FORMAT_CHOICE,
  decideFormat,
  FORMAT_CHOICES,
  type FormatChoice,
  type FormatSource,
  formatAlertWords,
  isFormatVote,
  isVoteSource,
  sourceOf,
  tallyVotes,
  type FinalizeView,
  formatName,
  isOddSource,
  oddSwitchWords,
  styleAtClose,
  styleBannerWords,
  planFit,
  type TournamentFormat,
  type VoteCounts,
  voteCountsLine,
  winnerWords,
  type AdminTournamentView,
  cleanDays,
  dayKey,
  dayLong,
  isLevel,
  levelShort,
  MAX_DATES,
  MAX_PRICE_CENTS,
  MAX_SPOTS,
  NAME_MAX,
  NIGHT_END_MINUTES,
  NIGHT_START_MINUTES,
  suggestedPlan,
  prizeCentsOf,
  smartPlan,
  planCount,
  planRange,
  STORED_PLAN,
  type PlayerTournamentView,
  TOURNAMENTS,
  tournamentsAllowed,
  type TournamentStatus,
  type Visibility,
} from '../shared/tournament';
import { EXPECT_MAX, EXPECT_MIN, expectedPlayers, moneyLine, savedExpect, timeMoveWords } from '../shared/tournamentMoney';
import { defaultPayBy, payByLabel, salesCutoffMs, startMsOf, ticketOwed } from '../shared/tournamentTickets';
import { notifyTournament } from './alerts';
import { type NotSignedUpView, recentFrom } from '../shared/tournamentNudge';
import { adminDayView, courtNumbersOf, type DayRows, gamesSqlFor, LIVE_BEFORE_MS, loadDay, playerDayView, teamsSqlFor, tiesFromJson } from './tournamentDay';
import { adminRoundsView, americanoStarted, playerRoundsView } from './americanoDay';
import { fitWords, nightPlan } from '../shared/tournamentPlan';
import { adminEndView, type AwardsPre, awardsFrom, awardsReads } from './tournamentEnd';
import { fillSpotsStatements, KEPT, keptOff, LATE_DROP_FLOOR, releaseKeptStatements, loadTickets, offListBack, organizerSeatStatement, sqlText, ticketBackStatements, ticketOf, ticketsSqlFor, type TicketWithName, tournamentCanceled } from './tournamentMoney';

// Zip 55: TOURNAMENTS (shared/tournament.ts), piece 1. On for a request when:
//  - its wrangler.toml var is not "off" (the kill switch, needs a deploy), and
//  - the organizer switched it on in Settings > Feature switches (one task_log row, kind 'mark', no game), or this phone opened the site with
//    ?tournaments=on (it then sends X-Tournaments: a private test switch for that phone only).
// No Cloudflare variable (Zip 45's rule): the preview turns the row on in its seed, and the preview-only Tournament test page turns it on too.
// Off: nothing here is read beyond that one switch question (answered by the shared switch read when "Fewer database trips" is on), and no
// answer carries anything new: every screen is exactly main's.
//
// Who sees a tournament (each tournament's own "Who can see it"):
//   Everyone   every player with a name picked;
//   Only me    ONLY the organizer's own player, on a phone signed in as the organizer (the real PIN), or the organizer's View as of their own
//              player. Anyone else (a player, a phone that merely picked the organizer's name, a read-only PIN helper on the player page) gets
//              nothing: the answer has no `tournament` key at all, and every player route answers "not open". (A read-only helper sees it where
//              they already see every organizer screen: the dashboard, and View as of the organizer's own player.)
// The organizer screens always see it while the switch is on.
//
// No money moves in piece 1: the ticket price and the champion credit are stored, nothing is charged, paid or credited.

/** The one switch question every feature switch asks, word for word (server/speed.ts answers it from one read when it can). */
const SWITCH_READ = "SELECT 1 AS x FROM task_log WHERE group_id = ? AND session_id IS NULL AND task = ? AND kind = 'mark' LIMIT 1";

/** The Settings row alone (no phone, no request). The kill switch is not visible there. */
export async function tournamentsForAll(db: D1Database, groupId: string): Promise<boolean> {
  const row = await db.prepare(SWITCH_READ).bind(groupId, TOURNAMENTS.task).first().catch(() => null);
  return !!row;
}

export async function setTournamentsForAll(db: D1Database, groupId: string, on: boolean, nowIso: string): Promise<void> {
  // One batch: the row is exactly on or off afterwards (two quick saves can never leave two rows).
  await db.batch([
    db.prepare("DELETE FROM task_log WHERE group_id = ? AND session_id IS NULL AND task = ? AND kind = 'mark'").bind(groupId, TOURNAMENTS.task),
    ...(on ? [db.prepare("INSERT INTO task_log (id, group_id, session_id, task, kind, at) VALUES (?, ?, NULL, ?, 'mark', ?)").bind(newId(), groupId, TOURNAMENTS.task, nowIso)] : []),
  ]);
}

/** The switch for this request, and the Settings row: one read of the row for both. */
export async function tournamentsFlags(ctx: Ctx, groupId: string): Promise<{ on: boolean; forAll: boolean }> {
  const forAll = await tournamentsForAll(ctx.db, groupId);
  const header = (ctx.req.headers.get(TOURNAMENTS.header) ?? '').trim().toLowerCase() === 'on';
  return { on: tournamentsAllowed(ctx.env.TOURNAMENTS) && (forAll || header), forAll };
}

// ---------------------------------------------------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------------------------------------------------

export interface TournamentRow {
  id: string;
  group_id: string;
  name: string;
  size: number;
  courts: number;
  minutes: number;
  start_minutes: number;
  ticket_cents: number;
  champion_credit_cents: number;
  offered_dates: string;
  final_date: string | null;
  status: string;
  visibility: string;
  created_at: string;
  updated_at: string;
  date_picked_at: string | null;
  shown_at: string | null;
  canceled_at: string | null;
  format: string;
  second_credit_cents: number;
  /** Zip 56 (migration 0024): when ticket money is due; NULL until tickets first open. Missing on a database before 0024. */
  pay_by?: string | null;
  /** Zip 60 (migration 0025): how the format was set ('vote', 'tie', 'admin', or NULL for the organizer's own choice). Missing before 0025. */
  format_source?: string | null;
  /** Zip 57 (migration 0027): teams published, the venue's court numbers (JSON), game day paused. Missing before 0027. */
  teams_at?: string | null;
  court_numbers?: string | null;
  paused_at?: string | null;
  /** Zip 70: the Plan's saved Expect number (task_log detail, read in the same statement as the row), when the screen's read carried it. */
  expect_saved?: string | null;
  /** Zip 70: the last time move players are told about (task_log detail, JSON), when the screen's read carried it. */
  time_moved?: string | null;
}

export interface SignupRow {
  id: string;
  tournament_id: string;
  player_id: string;
  status: string;
  picked_level: number;
  approved_level: number | null;
  dates: string;
  joined_at: string;
  created_at: string;
  updated_at: string;
  backed_out_at: string | null;
  /** Zip 60 (migration 0025): this player's format vote ('locked', 'americano', 'either'; NULL counts as either). Never sent to another player. */
  format_vote?: string | null;
  display_name: string;
  is_active: number;
  /** The level the player picked first for this tournament (the level history), or null for none: it stays theirs (Alex). */
  first_level: number | null;
}

/** SQL over a sign-up alias: the level this player picked first for this tournament (their own picks in the level history, oldest first). */
const FIRST_LEVEL_SQL = (s: string) =>
  `(SELECT h.level FROM tournament_level_history h WHERE h.tournament_id = ${s}.tournament_id AND h.player_id = ${s}.player_id AND h.set_by = 'player' ORDER BY h.created_at, h.rowid LIMIT 1)`;

/**
 * Zip 58 (Alex's admin speed rule): the ties' answers as one JSON column ON the tournament row a screen already reads (`alias`: that row's
 * table name), so a screen's batch has no extra statement. Only a tournament with published teams can have a tie, and with no tie answer stored
 * anywhere (the usual case) nothing is looked up at all; '[]' when there are none.
 */
const tiesJsonSql = (alias: string): string =>
  `(SELECT json_group_array(json_array(x.id, x.tie_key, x.kind, x.bye_seat, x.picks, x.game_a, x.game_b, x.spun_at, x.created_at)) FROM tournament_ties x WHERE x.tournament_id = ${alias}.id) AS ties_json`;

/**
 * Zip 70: two small per-tournament facts kept as one task_log row each (kind 'mark', no game), exactly how a hidden tournament is kept: no new
 * table or column. 'tournament_expect:<id>' holds the Plan's saved Expect number in `detail`; 'tournament_time:<id>' holds the last time move
 * players are told about (JSON: from start and minutes, to start and minutes). Read as a column of the tournament row's own statement (the
 * task_log_once index), so no screen makes an extra trip.
 */
export const EXPECT_TASK = 'tournament_expect:';
export const TIME_TASK = 'tournament_time:';
const markDetailSql = (prefix: string, idRef: string) =>
  `(SELECT h.detail FROM task_log h WHERE h.session_id IS NULL AND h.task = '${prefix}' || ${idRef} AND h.kind IN ('mark', 'sent') AND h.kind = 'mark' LIMIT 1)`;

/** The stages a tournament is open in: piece 1's two, then piece 2's (Zip 56) tickets and rescheduled. Later pieces add theirs here. */
const OPEN = "('signup', 'date_picked', 'tickets', 'rescheduled')";

/**
 * Zip 56: a canceled tournament keeps a plain Canceled card (organizer Home, and the players who were on the list) for this many days, never
 * past its picked date, and only when it got that far (a date picked or tickets open); piece 1's early cancel still just hides it.
 */
export const CANCELED_DAYS = 7;
const canceledFrom = (nowMs: number) => new Date(nowMs - CANCELED_DAYS * 86_400_000).toISOString();
/** SQL: a canceled tournament that still shows its Canceled card (?2: the cutoff). `t`: the table's alias, or '' for none. */
const shownCanceled = (t = '') =>
  `(${t}status = 'canceled' AND ${t}canceled_at >= ?2 AND (${t}final_date IS NOT NULL OR ${t}pay_by IS NOT NULL) AND ${notHiddenSql(t ? `${t}id` : 'tournaments.id')})`;

/**
 * Zip 59: Hide on a canceled tournament's card. One task_log row per hidden tournament (task 'tournament_hidden:<id>', kind 'mark', no game):
 * no new table or column, exactly how a hidden game is kept. A hidden tournament is out of Home and every list for everyone; nothing about it is
 * ever deleted (its tickets, credit and History stay), and Settings > Advanced > Hidden tournaments > Restore brings it back.
 */
export const hiddenTask = (tournamentId: string): string => `tournament_hidden:${tournamentId}`;
// Zip 62: a hide mark never has a game (hideTournament writes session_id NULL), and with the kind list written the way the task_log_once index
// is (its own WHERE is kind IN ('mark', 'sent')), SQLite looks the one mark up in that index instead of reading every task_log row for each
// tournament (on live about 220 rows per read, on every 5-second check). Same answer, no new index.
const notHiddenSql = (idRef: string) =>
  `NOT EXISTS (SELECT 1 FROM task_log h WHERE h.session_id IS NULL AND h.task = 'tournament_hidden:' || ${idRef} AND h.kind IN ('mark', 'sent') AND h.kind = 'mark')`;

/** The group's open tournament, or null. Null too while the tables do not exist yet. (Create's "one at a time" and every organizer save.) */
export async function activeTournament(db: D1Database, groupId: string): Promise<TournamentRow | null> {
  return db
    .prepare(`SELECT * FROM tournaments WHERE group_id = ? AND status IN ${OPEN} ORDER BY created_at DESC LIMIT 1`)
    .bind(groupId)
    .first<TournamentRow>()
    .catch(() => null);
}

/** Its picked date has passed (Eastern): a canceled one stops showing then. */
const datePassed = (t: TournamentRow, today: string) => !!t.final_date && t.final_date < today;

/**
 * What the organizer's screens show (Zip 56): the open tournament, else one canceled in the last CANCELED_DAYS days (its plain Canceled card),
 * in ONE read.
 */
export async function shownTournament(db: D1Database, group: GroupRow, nowMs: number): Promise<TournamentRow | null> {
  const row = await db
    .prepare(SHOWN_SQL)
    .bind(group.id, canceledFrom(nowMs))
    .first<ShownRow>()
    .catch(() => null);
  return shownFrom(row, group, nowMs);
}

// A canceled one with an I paid still waiting stays until the organizer answers it (only confirmed money becomes credit), whatever its age.
const WAITING = 'EXISTS (SELECT 1 FROM tournament_tickets k WHERE k.tournament_id = tournaments.id AND k.claim_cents > 0)';
/** The organizer's pick (?1 the group, ?2 the canceled cutoff): the open tournament, else one canceled lately, else one with an I paid waiting. */
const SHOWN_WHERE = `group_id = ?1 AND (status IN ${OPEN} OR ${shownCanceled()} OR (status = 'canceled' AND ${WAITING}))
       ORDER BY CASE WHEN status = 'canceled' THEN 1 ELSE 0 END, created_at DESC, id LIMIT 1`;
const SHOWN_SQL = `SELECT *, (status = 'canceled' AND ${WAITING}) AS claims_waiting, ${tiesJsonSql('tournaments')}, ${markDetailSql(EXPECT_TASK, 'tournaments.id')} AS expect_saved FROM tournaments
       WHERE ${SHOWN_WHERE}`;
type ShownRow = TournamentRow & { claims_waiting: number; ties_json?: string };

/** shownTournament's rule on the row its read picked: a canceled one stops showing once its date has passed (unless an I paid waits). */
function shownFrom(row: ShownRow | null, group: GroupRow, nowMs: number): TournamentRow | null {
  if (!row) return null;
  const { claims_waiting: claims, ties_json: _ties, ...t } = row;
  void _ties;
  if (t.status === 'canceled' && !claims && datePassed(t, todayKey(nowMs, group.timezone))) return null;
  return t;
}

/** Zip 56: a canceled tournament still has an I paid waiting for the organizer's answer (Create waits for it: nowhere else would show it). */
async function canceledClaimWaiting(db: D1Database, groupId: string): Promise<boolean> {
  const row = await db
    .prepare("SELECT 1 AS x FROM tournament_tickets k JOIN tournaments t ON t.id = k.tournament_id WHERE t.group_id = ? AND t.status = 'canceled' AND k.claim_cents > 0 LIMIT 1")
    .bind(groupId)
    .first()
    .catch(() => null);
  return !!row;
}

/**
 * The same read for a player's phone, in the SAME single trip: on an Only me tournament it also brings the two facts that decide whether this
 * player is the organizer's own (the organizer's saved player still exists; this player's name). So Only me costs any player exactly the trips
 * of "none open" (nothing to time), whether the organizer's player is saved by id or matched by name. Zip 56: a recently canceled one too
 * (open ones first), with whether this player was on its list (only they see the Canceled card), still in the same one trip.
 */
async function activeTournamentForPlayer(db: D1Database, group: GroupRow, playerId: string, nowMs: number): Promise<ActiveRow | null> {
  return db
    .prepare(ACTIVE_FOR_PLAYER_SQL)
    .bind(group.id, canceledFrom(nowMs), group.organizer_player_id ?? '', playerId)
    .first<ActiveRow>()
    .catch(() => null);
}

type ActiveRow = TournamentRow & { org_saved: string | null; viewer_name: string | null; my_signup: string | null; ties_json?: string };
/** A player's pick (?1 the group, ?2 the canceled cutoff): the open tournament, else one canceled lately. */
const ACTIVE_WHERE = `t.group_id = ?1 AND (t.status IN ${OPEN} OR ${shownCanceled('t.')})
       ORDER BY CASE WHEN t.status = 'canceled' THEN 1 ELSE 0 END, t.created_at DESC, t.id LIMIT 1`;
const ACTIVE_FOR_PLAYER_SQL = `SELECT t.*, ${tiesJsonSql('t')}, ${markDetailSql(TIME_TASK, 't.id')} AS time_moved,
         CASE WHEN t.visibility = 'all' THEN NULL ELSE (SELECT id FROM players WHERE id = ?3 AND group_id = t.group_id) END AS org_saved,
         CASE WHEN t.visibility = 'all' THEN NULL ELSE (SELECT display_name FROM players WHERE id = ?4 AND group_id = t.group_id) END AS viewer_name,
         CASE WHEN t.status = 'canceled' THEN (SELECT status FROM tournament_signups WHERE tournament_id = t.id AND player_id = ?4) ELSE NULL END AS my_signup
       FROM tournaments t WHERE ${ACTIVE_WHERE}`;

/** A tournament's sign-ups (names, and each player's first level). `idSql`: a `?`, or Zip 62's subquery that picks the tournament in the same trip. */
const signupsSqlFor = (idSql: string) => `SELECT s.*, p.display_name, p.is_active, ${FIRST_LEVEL_SQL('s')} AS first_level FROM tournament_signups s JOIN players p ON p.id = s.player_id
       WHERE s.tournament_id = ${idSql} ORDER BY s.joined_at, s.rowid`;

async function signupRows(db: D1Database, tournamentId: string): Promise<SignupRow[]> {
  const { results } = await db.prepare(signupsSqlFor('?')).bind(tournamentId).all<SignupRow>();
  return results;
}

// ---------------------------------------------------------------------------------------------------------------------
// Zip 62 (🎾62.speed): a screen's tournament reads in the SAME trip as the screen's own "did anything change?" reads
// ---------------------------------------------------------------------------------------------------------------------
// Before Zip 62 every screen with the switch on read the tournament one step at a time (its row, then its sign-ups, then its tickets, then the
// organizer's player), each a trip to the database in a row, and the full answers did all of it twice (once for the stamp, once for the answer).
// Now the stamp's one batch carries these reads too: the row and, through a subquery that picks the SAME tournament (the same WHERE and ORDER
// BY, ending on the id, in the same batch, so the same rows), its sign-ups and tickets, the organizer's player, and for a player's card the
// freed-spot count (after Pay by) and what a cancel gave back (a canceled card). The views are then built from those rows with no trip of their
// own, and the full answer uses the view its stamp built. Still read on their own, as before: a piece 1 date pick opening tickets and a hold
// coming back after the night (each writes), and Only me on the organizer's own phone (its sign-in check).

/** What the one batched read brought for a screen's tournament. */
export interface TourPre<Row> {
  row: Row | null;
  signups: SignupRow[];
  tickets: TicketWithName[];
  /** The organizer's player as organizerIdOf finds it, when the batch could tell (missing: ask organizerIdOf). */
  org?: { id: string | null };
  /** A player's card: freedSpots for the picked tournament (0 while it has no Pay by). */
  freed?: number;
  /** A player's card: canceledMoneyOf for the picked tournament (null while it is not canceled). */
  canceledMoney?: { backCents: number; claimCents: number } | null;
  /** Zip 66, the organizer's card: the active players who played a game in the last 3 months (recentPlayersRead). */
  recent?: { id: string; display_name: string }[];
  /** Zip 57: the teams and games of the picked tournament (empty before any draft). Zip 58: and the ties' answers. */
  day?: DayRows;
  /** Zip 58: a player's screen: the winners banners up now, their winners, and every medal (server/tournamentEnd.ts). */
  awards?: AwardsPre;
}

/** The reads (for the screen's batch) and how to read their answers back. Only while the switch is on for the request. */
export interface TourReads<Row> {
  reads: ReadSpec[];
  from: (results: { results?: unknown[] }[]) => TourPre<Row>;
}

/** organizerIdOf's reads for the batch: the saved player if there is one (else the name in Settings, over every player in getPlayers' order). */
function orgReads(group: GroupRow): { read: ReadSpec; from: (rows: unknown[]) => { id: string | null } | undefined } {
  if (group.organizer_player_id) {
    // A saved player that is gone falls back to the name: organizerIdOf then reads, as before (rare).
    return { read: organizerIdRead(group), from: (rows) => (rows[0] ? { id: (rows[0] as { id: string }).id } : undefined) };
  }
  return {
    read: playersRead(group.id),
    from: (rows) => {
      const name = (group.organizer_name ?? '').trim().toLowerCase();
      if (!name) return { id: null };
      return { id: (rows as { id: string; display_name: string }[]).find((x) => x.display_name.trim().toLowerCase() === name)?.id ?? null };
    },
  };
}

/** Only me: a phone without the organizer's own sign-in cookie can never see it (organizerSignedIn), so its batch reads none of its rows. */
function mayBeOrganizerPhone(ctx: Ctx): boolean {
  const token = ctx.cookies[ADMIN_COOKIE];
  return !!token && !token.startsWith(VIEW_ONLY_COOKIE_PREFIX);
}

/** A player's screen (GET /api/group and its 5-second check): the same row activeTournamentForPlayer reads, its sign-ups and tickets. */
export function playerTourReads(ctx: Ctx, group: GroupRow, playerId: string): TourReads<ActiveRow> {
  const cutoff = canceledFrom(ctx.nowMs);
  // The same pick as the row read; then nothing at all for an Only me tournament on a phone that cannot be the organizer's (?3 = 0).
  const pick = `(SELECT p.id FROM (SELECT t.id, t.visibility FROM tournaments t WHERE ${ACTIVE_WHERE}) p WHERE ?3 = 1 OR p.visibility = 'all')`;
  const values = [group.id, cutoff, mayBeOrganizerPhone(ctx) ? 1 : 0];
  const org = orgReads(group);
  const reads: ReadSpec[] = [
    { sql: ACTIVE_FOR_PLAYER_SQL, values: [group.id, cutoff, group.organizer_player_id ?? '', playerId] },
    { sql: signupsSqlFor(pick), values },
    { sql: ticketsSqlFor(pick), values },
    org.read,
    // freedSpots' two counts (only once the tournament has a Pay by).
    {
      sql: `SELECT
         (SELECT COUNT(*) FROM admin_audit_log WHERE group_id = ?1 AND action IN ('tournament_back_out', 'tournament_taken_off') AND created_at >= f.pay_by
            AND json_extract(details_json, '$.tournamentId') = f.id AND json_extract(details_json, '$.freedSpot') = 1) AS gone,
         (SELECT COUNT(*) FROM tournament_tickets WHERE tournament_id = f.id AND place = 'spot' AND place_at >= f.pay_by) AS taken
       FROM (SELECT t.id, t.pay_by FROM tournaments t WHERE t.id = ${pick} AND t.pay_by IS NOT NULL) f`,
      values,
    },
    // canceledMoneyOf's sums for this player (only on a canceled tournament).
    {
      sql: `SELECT
         (SELECT COALESCE(SUM(amount_cents), 0) FROM credit_ledger WHERE player_id = ?4 AND kind = 'kept' AND reason = 'tour:' || c.id || ':cancel') +
         (SELECT COALESCE(SUM(amount_cents), 0) FROM credit_ledger WHERE player_id = ?4 AND kind = 'used' AND reason = 'tour:' || c.id AND ended_reason = 'canceled') AS back,
         (SELECT COALESCE(SUM(claim_cents), 0) FROM tournament_tickets WHERE tournament_id = c.id AND player_id = ?4) AS claim
       FROM (SELECT t.id FROM tournaments t WHERE t.id = ${pick} AND t.status = 'canceled') c`,
      values: [...values, playerId],
    },
    // Zip 57: the teams and games (published teams only reach a player; the view decides). Zip 58: the ties' answers.
    { sql: teamsSqlFor(pick), values },
    { sql: gamesSqlFor(pick), values },
    // Zip 58: after a tournament ends, the ticker, the congratulations card and medals (three small reads, in this same trip).
    ...awardsReads(group.id, ctx.nowMs),
  ];
  return {
    reads,
    from: (res) => {
      const rows = (i: number) => (res[i]?.results ?? []) as never[];
      const freed = rows(4)[0] as { gone: number; taken: number } | undefined;
      const money = rows(5)[0] as { back: number; claim: number } | undefined;
      return {
        row: (rows(0)[0] as ActiveRow | undefined) ?? null,
        signups: rows(1),
        tickets: rows(2),
        org: org.from(rows(3)),
        freed: freed ? Math.max(0, Number(freed.gone ?? 0) - Number(freed.taken ?? 0)) : 0,
        canceledMoney: money ? { backCents: money.back ?? 0, claimCents: money.claim ?? 0 } : null,
        day: { teams: rows(6), games: rows(7), ties: tiesFromJson((rows(0)[0] as { ties_json?: string } | undefined)?.ties_json) },
        awards: awardsFrom(res.slice(8, 11)),
      };
    },
  };
}

/**
 * Zip 66: the active players who played at least one game in the last 3 months (the same "played" rule as the Players tab: in, not canceled,
 * over, and not marked "did not play"), in the Players tab's order. Only while the tournament is still at its sign-up step does the card use it.
 */
export const recentPlayersRead = (groupId: string, nowMs: number): ReadSpec => ({
  // Review: only while a tournament sits at its sign-up step (else SQLite stops at the first line and reads nothing more), and the last 3
  // months' seats are read once (the games in range, then their seats), not once per player.
  sql: `SELECT p.id, p.display_name FROM players p
        WHERE p.group_id = ?1 AND p.is_active = 1
          AND EXISTS (SELECT 1 FROM tournaments t WHERE t.group_id = ?1 AND t.status IN ('signup', 'rescheduled'))
          AND p.id IN (
            SELECT sp.player_id FROM sessions s JOIN session_players sp ON sp.session_id = s.id
            WHERE s.group_id = ?1 AND s.status <> 'canceled' AND s.ends_at <= ?2 AND s.ends_at >= ?3
              AND sp.status = 'confirmed' AND (sp.played IS NULL OR sp.played = 1))
        ORDER BY p.sort_order, p.display_name`,
  values: [groupId, new Date(nowMs).toISOString(), recentFrom(nowMs)],
});

/** The organizer's screens (the dashboard and its 5-second check): the same row shownTournament reads, its sign-ups and tickets. */
export function adminTourReads(group: GroupRow, nowMs: number): TourReads<ShownRow> {
  const values = [group.id, canceledFrom(nowMs)];
  const pick = `(SELECT id FROM tournaments WHERE ${SHOWN_WHERE})`;
  const org = orgReads(group);
  return {
    // Zip 66: the players who played lately ride in the same trip (one more small read in the batch, no trip of its own). Zip 57: the teams and games.
    reads: [
      { sql: SHOWN_SQL, values },
      { sql: signupsSqlFor(pick), values },
      { sql: ticketsSqlFor(pick), values },
      org.read,
      recentPlayersRead(group.id, nowMs),
      { sql: teamsSqlFor(pick), values },
      { sql: gamesSqlFor(pick), values },
    ],
    from: (res) => {
      const rows = (i: number) => (res[i]?.results ?? []) as never[];
      return { row: (rows(0)[0] as ShownRow | undefined) ?? null, signups: rows(1), tickets: rows(2), org: org.from(rows(3)), recent: rows(4), day: { teams: rows(5), games: rows(6), ties: tiesFromJson((rows(0)[0] as { ties_json?: string } | undefined)?.ties_json) } };
    },
  };
}

/**
 * Zip 62: two rare moments make a read write (a piece 1 date pick opening tickets, and a hold coming back after the night; both guarded on the
 * rows as read). A view whose build tried one is not handed on to the full answer: that answer builds its own from fresh reads, exactly as
 * before Zip 62 (so a change that landed in between, which made the guarded write change nothing, is what the answer shows).
 */
export interface Upkeep {
  tried: boolean;
}

/** organizerIdOf, asked at most once per view: the saved player the batch read, else the usual read (a group with no saved organizer). */
function orgLookup(ctx: Ctx, group: GroupRow, pre?: TourPre<unknown>): () => Promise<string | null> {
  let p: Promise<string | null> | null = pre?.org ? Promise.resolve(pre.org.id) : null;
  return () => (p ??= organizerIdOf(ctx.db, group));
}

/** A stored list of days, read safely (anything odd reads as no days). */
export function storedDays(json: string | null | undefined): string[] {
  try {
    return cleanDays(JSON.parse(json ?? '[]')) ?? [];
  } catch {
    return [];
  }
}

/** The stored format, read safely (anything odd reads as Doubles). */
const formatOf = (t: TournamentRow): TournamentFormat => (t.format === 'americano' ? 'americano' : 'doubles');

const STATUSES: readonly TournamentStatus[] = ['signup', 'date_picked', 'tickets', 'rescheduled', 'canceled'];
export const statusOf = (t: TournamentRow): TournamentStatus => (STATUSES.find((s) => s === t.status) ?? 'signup');

/** The date is set (picked, or tickets open on it): sign-up and Edit offer only that one date. */
const dateFixed = (t: TournamentRow) => (statusOf(t) === 'date_picked' || statusOf(t) === 'tickets') && !!t.final_date;

/** Zip 56: tickets have been open at some point (Pay by is set): the price, size, format and Who can see it stay as they are. */
export const ticketsEverOpened = (t: TournamentRow): boolean => !!t.pay_by;

/**
 * Zip 56 (reviews): players may hold tickets, so the price, the format and Everyone stay: tickets are open on Everyone right now, or a player
 * other than the organizer has a ticket row (Lock my spot, Join waitlist or Mark paid made it; it stays after a back out). On Only me, after a
 * Reschedule nobody bought into, or before tickets, every setting stays free. `playerTicket`: such a row exists (playerTicketExists, or the
 * tickets already loaded).
 */
export const playersHoldTickets = (t: TournamentRow, playerTicket: boolean): boolean => (statusOf(t) === 'tickets' && t.visibility === 'all') || playerTicket;

/** SQL (inside an UPDATE of tournaments): the same rule, read when the write lands, so a Lock that lands in between counts. */
const playersHoldTicketsSql = (orgId: string | null) =>
  `((status = 'tickets' AND visibility = 'all') OR EXISTS (SELECT 1 FROM tournament_tickets k WHERE k.tournament_id = tournaments.id AND k.player_id <> ${sqlText(orgId ?? '')}))`;

/** A player other than the organizer has a ticket row on this tournament (one small read). */
async function playerTicketExists(db: D1Database, tournamentId: string, orgId: string | null): Promise<boolean> {
  const row = await db
    .prepare('SELECT 1 AS x FROM tournament_tickets WHERE tournament_id = ? AND player_id <> ? LIMIT 1')
    .bind(tournamentId, orgId ?? '')
    .first()
    .catch(() => null);
  return !!row;
}

/**
 * Zip 60: the vote is open: the players' vote decides this tournament's format and the date is not locked. The card then says "Tournament style
 * TBD" and sign-up asks "Format you'd like". After a Reschedule that players hold tickets on, the format stays (they bought that format): not open.
 * `tickets`: the tickets already loaded (else one small read, and only in the Reschedule case).
 */
export async function votePending(
  ctx: Ctx,
  group: GroupRow,
  t: TournamentRow,
  tickets?: readonly { player_id: string }[],
  orgOf: () => Promise<string | null> = () => organizerIdOf(ctx.db, group),
): Promise<boolean> {
  if (!isVoteSource(t.format_source) || t.final_date) return false;
  if (!ticketsEverOpened(t)) return true;
  const org = await orgOf();
  const other = tickets ? tickets.some((k) => k.player_id !== org) : await playerTicketExists(ctx.db, t.id, org);
  return !playersHoldTickets(t, other);
}

/**
 * Zip 60: the format of the most recent EARLIER tournament that was not canceled (the tie rule), or null when there is none (the first one ever).
 * A tournament whose vote was never decided (no date, no tickets) has no format yet and does not count.
 */
export async function previousFormat(db: D1Database, t: TournamentRow): Promise<TournamentFormat | null> {
  const row = await db
    .prepare(
      `SELECT format FROM tournaments WHERE group_id = ? AND id <> ? AND status <> 'canceled' AND created_at < ?
         AND (COALESCE(format_source, '') NOT IN ('vote', 'tie') OR final_date IS NOT NULL OR pay_by IS NOT NULL)
       ORDER BY created_at DESC, rowid DESC LIMIT 1`,
    )
    .bind(t.group_id, t.id, t.created_at)
    .first<{ format: string }>()
    .catch(() => null);
  return row ? (row.format === 'americano' ? 'americano' : 'doubles') : null;
}

/**
 * The dates a player can pick now: every offered date from today on while sign-up is open (also after a Reschedule); only the picked one once
 * it is picked (and while tickets are open on it). A day that has passed is never a choice (so the list can be empty: every offered date, or
 * the picked one, has passed). `today`: the Eastern calendar day ('YYYY-MM-DD'). A canceled tournament offers none.
 */
export function openDatesOf(t: TournamentRow, today: string): string[] {
  if (statusOf(t) === 'canceled') return [];
  const days = dateFixed(t) ? [t.final_date as string] : storedDays(t.offered_dates);
  return days.filter((d) => d >= today);
}

/**
 * Zip 56: the tournament night (ms), or null without a date: 7:00 PM (the earliest a plan starts) to 10:00 PM (the venue closes) on the picked
 * date, Eastern. The plan itself moves with the players (shared/tournament.ts smartPlan), so the site's rules use the whole window: ticket taps
 * stop at its start, and a hold that never got a spot comes back after its end.
 */
export function nightOf(t: TournamentRow, tz: string): { start: number; end: number } | null {
  if (!t.final_date) return null;
  // Zip 64: the night starts at the tournament's real start (Finalize's "Plays" box, stored in start_minutes; a date picked before Zip 64 kept
  // the 7:00 PM default there, so its night is exactly what it was) and ends at its end, never before 10:00 PM (unused holds come back after).
  const r = realTimes(t);
  return { start: startMsOf(t.final_date, r.start, tz), end: Math.max(startMsOf(t.final_date, r.start + r.minutes, tz), startMsOf(t.final_date, NIGHT_END_MINUTES, tz)) };
}

/**
 * Zip 64: the tournament's real start and length, minutes after midnight Eastern and minutes, once the organizer finalized the date ("Plays 7:30 PM
 * to 10:00 PM" on the Finalize screen, stored in the existing start_minutes and minutes columns; no new column). Before a date is picked the
 * screens show the plan's estimate instead (startSetOf is false then).
 */
export function realTimes(t: Pick<TournamentRow, 'start_minutes' | 'minutes'>): { start: number; minutes: number } {
  const start = Number.isInteger(t.start_minutes) && t.start_minutes >= 0 && t.start_minutes < 1440 ? t.start_minutes : NIGHT_START_MINUTES;
  const minutes = Number.isInteger(t.minutes) && t.minutes >= 60 && t.minutes <= 360 ? t.minutes : NIGHT_END_MINUTES - NIGHT_START_MINUTES;
  return { start, minutes };
}
/** Zip 64: the date is finalized, so start_minutes and minutes are the real times (the stub drops its "~"). */
export const startSetOf = (t: TournamentRow): boolean => !!t.final_date && (statusOf(t) === 'tickets' || statusOf(t) === 'date_picked' || statusOf(t) === 'canceled');
/** Zip 64: what the Finalize screen's "Plays" boxes start on: 7:30 PM to 10:00 PM. */
export const FINALIZE_TIMES = { start: 19 * 60 + 30, minutes: 150 } as const;

/** The players locked in (a spot, still on the list): what the smart plan follows. */
export const lockedCount = (tickets: readonly { place: string; signup_status: string }[]): number =>
  tickets.filter((k) => k.place === 'spot' && k.signup_status === 'in').length;

/**
 * Zip 64: the players locked in as everyone sees them (Zip 63's trust rule): every spot, and every I paid for a whole ticket (not a standby hold)
 * still waiting for the organizer. The style follows this count, so the gold balls and the style always agree.
 */
export const lockedInCount = (tickets: readonly TicketWithName[]): number =>
  tickets.filter(
    (k) =>
      k.signup_status === 'in' &&
      (k.place === 'spot' || (k.place !== 'line' && k.claim_cents > 0 && ticketOwed({ priceCents: k.price_cents, creditCents: k.credit_cents, paidCents: k.paid_cents, claimCents: k.claim_cents }) === 0)),
  ).length;

/** Zip 64: lockedInCount as SQL (read when a write lands, so a back out in between is seen). `id`: SQL for the tournament id. */
export const lockedInSql = (id: string) =>
  `(SELECT COUNT(*) FROM tournament_tickets k JOIN tournament_signups s ON s.tournament_id = k.tournament_id AND s.player_id = k.player_id AND s.status = 'in'
     WHERE k.tournament_id = ${id} AND (k.place = 'spot' OR (k.place <> 'line' AND k.claim_cents > 0 AND k.credit_cents + k.paid_cents + k.claim_cents >= k.price_cents)))`;

/** Zip 64: tickets have closed for the style (Pay by has passed): the style is decided from who is locked in. */
export const styleDecided = (t: TournamentRow, nowMs: number): boolean => statusOf(t) === 'tickets' && !!t.pay_by && nowMs >= Date.parse(t.pay_by);

/**
 * Zip 64: the style rule at work. Once Pay by has passed and until the night starts, an ODD number locked in on Locked doubles switches the
 * tournament to Americano, once (the write is guarded on the row as read, so two screens reading at the same moment switch it once and send one
 * alert). It never switches back by itself: the organizer's card asks. Run by the first screen that reads the tournament (no clock job), like
 * the unused holds after the night. A look-only database (the read-only PIN, "Pretend it's...") writes nothing; the views still show
 * Americano for an odd count (styleAtClose), so every screen agrees either way.
 */
async function settleStyle(ctx: Ctx, group: GroupRow, t: TournamentRow, tickets: readonly TicketWithName[], upkeep?: Upkeep): Promise<TournamentRow> {
  if (!styleDecided(t, ctx.nowMs) || salesClosed(t, group.timezone, ctx.nowMs)) return t;
  const n = lockedInCount(tickets);
  if (n % 2 === 0 || formatOf(t) !== 'doubles') return t;
  if (upkeep) upkeep.tried = true;
  const source = `odd:${ctx.nowIso}`;
  try {
    const res = await ctx.db
.prepare(
        `UPDATE tournaments SET format = 'americano', format_source = ?, updated_at = ? WHERE id = ? AND status = 'tickets' AND format = 'doubles' AND format_source IS ? AND pay_by = ?
           AND ${lockedInSql('tournaments.id')} % 2 = 1`,
      )
      .bind(source, ctx.nowIso, t.id, t.format_source ?? null, t.pay_by)
      .run();
    if ((res.meta?.changes ?? 0) !== 1) return t;
  } catch {
    return t;
  }
  await audit(ctx.db, group.id, null, 'tournament_format', { tournament: t.name, format: 'americano', how: 'odd', lockedIn: n }, ctx.nowIso).catch(() => undefined);
  await notifyTournament(ctx, group, `${oddSwitchWords(t.name)} ${n} are locked in.`);
  return { ...t, format: 'americano', format_source: source, updated_at: ctx.nowIso };
}

/**
 * Zip 59: where ticket sales stand for NEW activity.
 *   open   before Pay by (the night before at 7:00 PM): tickets and the waitlist take anyone
 *   after  Pay by has passed: no new tickets and no waitlist joins; only a spot freed by a back out can still be claimed (below)
 *   cut    3 hours before the start: nothing more, a freed spot included
 */
export type TicketPhase = 'open' | 'after' | 'cut';
export function ticketPhase(t: TournamentRow, tz: string, nowMs: number, startMinutes: number = realTimes(t).start): TicketPhase {
  if (!t.final_date) return 'open';
  // The cutoff follows the REAL start of the games (the plan: 7:30 PM start means 4:30 PM), not a fixed 7:00 PM.
  if (nowMs >= salesCutoffMs(startMsOf(t.final_date, startMinutes, tz))) return 'cut';
  if (t.pay_by && nowMs >= Date.parse(t.pay_by)) return 'after';
  return 'open';
}

/** Zip 59: the same "a freed spot is still unclaimed" test as freedSpots, as SQL (inside the write that claims it, so two taps cannot both win). */
export const freedSpotSql = (groupId: string, t: TournamentRow): string =>
  `((SELECT COUNT(*) FROM admin_audit_log WHERE group_id = ${sqlText(groupId)} AND action IN ('tournament_back_out', 'tournament_taken_off') AND created_at >= ${sqlText(t.pay_by ?? '')}
      AND json_extract(details_json, '$.tournamentId') = ${sqlText(t.id)} AND json_extract(details_json, '$.freedSpot') = 1)
    - (SELECT COUNT(*) FROM tournament_tickets WHERE tournament_id = ${sqlText(t.id)} AND place = 'spot' AND place_at >= ${sqlText(t.pay_by ?? '')})) > 0`;

/**
 * Zip 59: spots freed since Pay by and not claimed yet. A spot held since before Pay by that is given up after it (a back out, or taken off) counts
 * one (the History line says so: `freedSpot`); a spot taken after Pay by uses one up (the first paid person in line gets it by itself, or a new
 * buyer claims it). Never below 0. No column: read from the History lines and the tickets. Only worth asking after Pay by.
 */
export async function freedSpots(db: D1Database, groupId: string, t: TournamentRow): Promise<number> {
  if (!t.pay_by) return 0;
  const row = await db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM admin_audit_log WHERE group_id = ?1 AND action IN ('tournament_back_out', 'tournament_taken_off') AND created_at >= ?2
            AND json_extract(details_json, '$.tournamentId') = ?3 AND json_extract(details_json, '$.freedSpot') = 1) AS gone,
         (SELECT COUNT(*) FROM tournament_tickets WHERE tournament_id = ?3 AND place = 'spot' AND place_at >= ?2) AS taken`,
    )
    .bind(groupId, t.pay_by, t.id)
    .first<{ gone: number; taken: number }>()
    .catch(() => null);
  return Math.max(0, Number(row?.gone ?? 0) - Number(row?.taken ?? 0));
}

/** Zip 59: this ticket held a spot since before Pay by (so giving it up after Pay by frees a spot that can be claimed again). */
export const heldSpotSincePayBy = (t: TournamentRow, k: { place: string; place_at: string | null } | null): boolean =>
  !!k && k.place === 'spot' && !!t.pay_by && !!k.place_at && k.place_at < t.pay_by;

/** Ticket sales are closed: the tournament night has started. */
export const salesClosed = (t: TournamentRow, tz: string, nowMs: number) => {
  const n = nightOf(t, tz);
  return !!n && nowMs >= n.start;
};

/** The tournament night is over (10:00 PM on the date): it has been played, so nothing gives its tickets back any more. */
export const nightOver = (t: TournamentRow, tz: string, nowMs: number) => {
  const n = nightOf(t, tz);
  return !!n && nowMs >= n.end;
};

/** Eastern calendar day of a moment, 'YYYY-MM-DD'. */
export function todayKey(nowMs: number, tz = 'America/Detroit'): string {
  const p = localParts(nowMs, tz);
  return dayKey(p.year, p.month, p.day);
}

// ---------------------------------------------------------------------------------------------------------------------
// Who sees it
// ---------------------------------------------------------------------------------------------------------------------

/**
 * The open tournament this player may see, or null (switch off, none open, or Only me and this is not the organizer's own signed-in phone).
 * `viewAs`: the organizer's View as (the request already passed the organizer's sign-in).
 */
async function visibleTo(
  ctx: Ctx,
  group: GroupRow,
  playerId: string,
  viewAs: boolean,
  pre?: TourPre<ActiveRow>,
  orgOf: () => Promise<string | null> = () => organizerIdOf(ctx.db, group),
): Promise<{ t: TournamentRow; onlyMe: boolean } | null> {
  // Zip 62: a screen's batch reads the rows only after this same switch question said on (playerTourReads), so it is not asked twice.
  if (!pre && !(await tournamentsFlags(ctx, group.id)).on) return null;
  // Zip 62: the row the screen's batch already read, else the one read of before.
  const row = pre ? pre.row : await activeTournamentForPlayer(ctx.db, group, playerId, ctx.nowMs);
  if (!row) return null;
  const { org_saved: orgSaved, viewer_name: viewerName, my_signup: mySignupStatus, ties_json: _ties, ...t } = row;
  void _ties;
  // Zip 56: a canceled tournament's plain card is only for the players who were on its list, and only until its date has passed.
  if (statusOf(t) === 'canceled' && (mySignupStatus !== 'in' || datePassed(t, todayKey(ctx.nowMs, group.timezone)))) return null;
  // Every offered date has passed with none picked: hidden from every player (Alex, Zip 55 feedback), the same as none open. The organizer's
  // Home card says "Dates have passed. Add dates."; Edit settings with new dates shows it again.
  if (statusOf(t) === 'signup' && openDatesOf(t, todayKey(ctx.nowMs, group.timezone)).length === 0) return null;
  if (t.visibility === 'all') return { t, onlyMe: false };
  // Only me: the organizer's own player, on the organizer's own signed-in phone (or the organizer's View as of their own player). Any other
  // player is answered from the one read above (organizerIdOf's own rule: the saved player if it still exists, else the name in Settings), so
  // the Only me path costs exactly the trips of "no tournament open". Only a phone that passes this is checked further.
  const orgName = (group.organizer_name ?? '').trim().toLowerCase();
  const maybeOrganizer = orgSaved ? playerId === orgSaved : !!orgName && (viewerName ?? '').trim().toLowerCase() === orgName;
  if (!maybeOrganizer) return null;
  // The sign-in check next: a phone with no organizer cookie (every player, also one that picked the organizer's name) is refused with no trip.
  if (!viewAs && !(await organizerSignedIn(ctx, group.id))) return null;
  // Only the organizer's own signed-in phone (or View as) gets here: two players with the organizer's name, only the first is theirs.
  if (!orgSaved && playerId !== (await orgOf())) return null;
  return { t, onlyMe: true };
}

/** The picked date as the screens show it: once picked, while tickets are open on it, and on a canceled tournament's card. */
const shownDate = (t: TournamentRow): string | null => (statusOf(t) === 'date_picked' || statusOf(t) === 'tickets' || statusOf(t) === 'canceled' ? t.final_date : null);

/**
 * Zip 60: the alert at the top of Home once the date is locked, for every tournament: "The Cold Open is scheduled for Thu Dec 17." and
 * "Most players voted Americano." (only when a real vote majority decided it; a tie, the organizer's own choice or change, or a format picked when
 * creating it: just "Format: Locked doubles", no vote claim). `key` is new for every date pick (a re-pick or a reschedule shows a fresh
 * alert) and carries the player, so a dismissed alert stays dismissed for that player only. No vote counts, ever.
 */
function formatAlertFor(t: TournamentRow, group: GroupRow, playerId: string, nowMs: number, styleTbd = false): { key: string; title: string; sub: string } | null {
  // Every tournament gets it when its date is locked (Alex, pass 2); only a real vote majority says "Most players voted". A format chosen when
  // creating it (no source), changed by hand, or decided by the tie rule shows the date and the format only.
  const source: FormatSource = sourceOf(t.format_source) ?? 'admin';
  if (!t.final_date || (statusOf(t) !== 'tickets' && statusOf(t) !== 'date_picked')) return null;
  if (t.final_date < todayKey(nowMs, group.timezone)) return null;
  const words = formatAlertWords(t.name, t.final_date, formatOf(t), source);
  // Zip 64: the style is not final until tickets close: the alert says the vote's result only when it was a real majority, else "TBD".
  // (A real majority's "Most players voted Americano." stays: it is a fact about the vote, not the final style.)
  if (styleTbd && source !== 'vote') words.sub = 'Tournament style TBD';
  return { key: `fmt:${t.id}:${t.date_picked_at ?? t.final_date}:${playerId}`, ...words };
}

/**
 * Zip 56 (Alex, after testing piece 1): picking the date opens tickets. A tournament whose date was picked before that rule (piece 1, by the
 * organizer's own test on live) opens them the first time a screen reads it, exactly as a date pick does now: Pay by the night before at 7:00 PM,
 * the organizer's $0 seat. Only before its night starts. A read with the read-only PIN writes nothing, so it waits for the next real reader.
 */
async function upgradeDatePicked(ctx: Ctx, group: GroupRow, t: TournamentRow, upkeep?: Upkeep): Promise<TournamentRow> {
  if (t.status !== 'date_picked' || !t.final_date) return t;
  const night = nightOf(t, group.timezone);
  if (!night || ctx.nowMs >= night.start) return t;
  if (upkeep) upkeep.tried = true;
  try {
    const org = await organizerIdOf(ctx.db, group);
    const payBy = defaultPayBy(t.final_date, NIGHT_START_MINUTES, group.timezone, ctx.nowMs);
    // Only while the tournament is exactly as this screen read it (the stage, the date, who can see it, the price): the answer is then this row with tickets
    // open, so nobody is shown anything a change in between (Only me, Cancel) took away. Anything else: this screen shows what it read.
    const [res] = await ctx.db.batch([
      ctx.db
        .prepare("UPDATE tournaments SET status = 'tickets', pay_by = ?, updated_at = ? WHERE id = ? AND status = 'date_picked' AND final_date = ? AND visibility = ? AND ticket_cents = ?")
        .bind(payBy, ctx.nowIso, t.id, t.final_date, t.visibility, t.ticket_cents),
      ...(org ? [organizerSeatStatement(ctx.db, t.id, org, ctx.nowIso)] : []),
      ...fillSpotsStatements(ctx.db, group.id, t.id, ctx.nowIso),
    ]);
    if ((res.meta?.changes ?? 0) !== 1) return t;
    // The same History line a date pick writes now.
    await audit(ctx.db, group.id, null, 'tournament_tickets_opened', { tournament: t.name, date: dayLong(t.final_date), priceCents: t.ticket_cents, payBy: payByLabel(payBy, group.timezone, t.final_date) }, ctx.nowIso);
    return { ...t, status: 'tickets', pay_by: payBy, updated_at: ctx.nowIso };
  } catch {
    return t;
  }
}

/** Zip 62: hiddenTournamentsView's one read, so the dashboard can send it in its shared trip (SPEED_FEWER_QUERIES prefetch). */
export const hiddenTournamentsRead = (group: Pick<GroupRow, 'id'>): ReadSpec => ({
  sql: `SELECT id, name, final_date, canceled_at FROM tournaments WHERE group_id = ? AND status = 'canceled' AND NOT ${notHiddenSql('tournaments.id')} ORDER BY canceled_at DESC, created_at DESC LIMIT 50`,
  values: [group.id],
});

/** Zip 59: the canceled tournaments the organizer hid, newest first, for Settings > Advanced > Hidden tournaments (each with Restore). */
export async function hiddenTournamentsView(db: D1Database, group: GroupRow): Promise<{ id: string; name: string; finalDate: string | null; canceledAt: string | null }[]> {
  const read = hiddenTournamentsRead(group);
  const { results } = await db
    .prepare(read.sql)
    .bind(...read.values)
    .all<{ id: string; name: string; final_date: string | null; canceled_at: string | null }>()
    .catch(() => ({ results: [] as { id: string; name: string; final_date: string | null; canceled_at: string | null }[] }));
  return results.map((r) => ({ id: r.id, name: r.name, finalDate: r.final_date, canceledAt: r.canceled_at }));
}

/**
 * POST /api/admin/tournament/:id/hide { hidden }: Hide (or Restore) a CANCELED tournament. It only hides: nothing is deleted or refunded here.
 * A canceled tournament with an I paid still waiting is not hidden (that answer is on its card).
 */
export async function hideTournament(ctx: Ctx, body: Record<string, unknown>) {
  const group: GroupRow = await organizerOn(ctx);
  const id = v.id(ctx.params.id, 'tournament');
  const hidden = v.bool(body.hidden, 'hidden');
  const t = await ctx.db.prepare("SELECT * FROM tournaments WHERE id = ? AND group_id = ?").bind(id, group.id).first<TournamentRow>().catch(() => null);
  if (!t || t.status !== 'canceled') throw new HttpError(409, 'tournament_changed', 'Only a canceled tournament can be hidden. Look again.');
  const was = !!(await ctx.db.prepare("SELECT 1 AS x FROM task_log WHERE kind = 'mark' AND task = ?").bind(hiddenTask(id)).first());
  if (was === hidden) return { ok: true, changed: false, hidden };
  if (hidden) {
    if (await canceledClaimWaiting(ctx.db, group.id)) {
      const waiting = await ctx.db.prepare('SELECT 1 AS x FROM tournament_tickets WHERE tournament_id = ? AND claim_cents > 0 LIMIT 1').bind(id).first();
      if (waiting) throw new HttpError(409, 'claim_waiting', 'An I paid is still waiting. Answer it first.');
    }
    await ctx.db.prepare("INSERT INTO task_log (id, group_id, session_id, task, kind, at) VALUES (?, ?, NULL, ?, 'mark', ?)").bind(newId(), group.id, hiddenTask(id), ctx.nowIso).run();
  } else {
    await ctx.db.prepare("DELETE FROM task_log WHERE kind = 'mark' AND task = ?").bind(hiddenTask(id)).run();
  }
  await audit(ctx.db, group.id, null, hidden ? 'tournament_hidden' : 'tournament_restored', { tournament: t.name }, ctx.nowIso);
  return { ok: true, changed: true, hidden };
}

/** GET /api/group `tournament`: this player's card, or null (then the answer has no `tournament` key at all). */
export async function playerTournamentFor(
  ctx: Ctx,
  group: GroupRow,
  playerId: string | null,
  viewAs: boolean,
  /** Zip 62: the rows the screen's batch read (playerTourReads); left out, the view reads them itself as before. */
  pre?: TourPre<ActiveRow>,
  /** Zip 62: set when building the view tried one of the two writes a read can make (see Upkeep). */
  upkeep?: Upkeep,
): Promise<PlayerTournamentView | null> {
  if (!playerId) return null;
  const orgOf = orgLookup(ctx, group, pre);
  const seen = await visibleTo(ctx, group, playerId, viewAs, pre, orgOf);
  if (!seen) return null;
  const { onlyMe } = seen;
  const t = await upgradeDatePicked(ctx, group, seen.t, upkeep);
  // A piece 1 date pick that just opened tickets wrote the organizer's seat and the spots: its tickets are read again (as before, after it).
  const readTickets = pre && t === seen.t ? pre.tickets : null;
  const all = pre ? pre.signups : await signupRows(ctx.db, t.id);
  const rows = all.filter((r) => r.status === 'in' && r.is_active === 1);
  const mine = rows.find((r) => r.player_id === playerId) ?? null;
  // Off the list after signing up before: their first level stays theirs (Alex), so Sign up skips the level step.
  const before = mine ? null : (all.find((r) => r.player_id === playerId) ?? null);
  // Zip 56: the tickets (once they have opened), and the smart plan they decide: the start time and the hours players see.
  const tickets =
    ticketsEverOpened(t) && statusOf(t) !== 'canceled' ? await returnUnusedHolds(ctx, group, t, readTickets ?? (await loadTickets(ctx.db, t.id)), upkeep) : [];
  // Zip 64: the style rule (an odd number locked in after Pay by plays Americano).
  const t2 = await settleStyle(ctx, group, t, tickets, upkeep);
  const plan = smartPlan(lockedCount(tickets));
  // Zip 60: the vote is open (the card says "Tournament style TBD"), or the date was locked (the alert). Their own vote only, never anyone else's.
  const tbd = statusOf(t) !== 'canceled' && (await votePending(ctx, group, t, tickets, orgOf));
  // Zip 64: the date is finalized but tickets have not closed: the style is still "TBD" on the card. After: the style in play, and its banner.
  const decided = styleDecided(t2, ctx.nowMs);
  // Once the night starts the style is frozen as stored (no switch after the start; review).
  const live = decided && !salesClosed(t2, group.timezone, ctx.nowMs);
  const styleTbd = !tbd && !decided && (statusOf(t) === 'tickets' || statusOf(t) === 'date_picked') && !!t.final_date;
  const banner = decided ? styleBannerWords(t2.format_source) : null;
  const real = startSetOf(t) ? realTimes(t) : null;
  const alert = formatAlertFor(t2, group, playerId, ctx.nowMs, styleTbd);
  // Zip 70 (picture 6): the organizer moved the time after Finalize: everyone on the list gets one card per change until they dismiss it.
  const moved = mine && real && statusOf(t) === 'tickets' && !nightOver(t, group.timezone, ctx.nowMs) ? readTimeMove(t.time_moved) : null;
  const movedWords = moved && moved.to.start === real!.start && moved.to.minutes === real!.minutes ? timeMoveWords(t.name, moved.from, moved.to) : null;
  const base: PlayerTournamentView = {
    id: t.id,
    name: t.name,
    format: live ? styleAtClose(formatOf(t2), lockedInCount(tickets)) : formatOf(t2),
    status: statusOf(t),
    start: real ? real.start : plan.start,
    minutes: real ? real.minutes : plan.minutes,
    ...(real ? { startSet: true as const } : {}),
    ...(styleTbd ? { styleTbd: true as const } : {}),
    ...(banner ? { styleNote: { key: `style:${t.id}:${t2.format_source}:${playerId}`, text: banner } } : {}),
    ...(movedWords ? { timeNote: { key: `time:${t.id}:${real!.start}-${real!.minutes}:${playerId}`, ...movedWords } } : {}),
    openDates: openDatesOf(t, todayKey(ctx.nowMs, group.timezone)),
    finalDate: shownDate(t),
    names: rows.map((r) => r.display_name),
    // Zip 63: the card's balls once a date is picked: how many on the list can make it (a count, never who).
    // Zip 63 round 2: the names, so See who's in lists exactly the people the balls are (Alex); still never anyone's dates or money.
    ...(shownDate(t) ? { going: rows.filter((r) => storedDays(r.dates).includes(shownDate(t)!)).map((r) => ({ name: r.display_name, ...(r.player_id === playerId ? { me: true as const } : {}) })) } : {}),
    // Their own pick only (never the organizer's level for them).
    me: mine ? { level: mine.picked_level, dates: storedDays(mine.dates), ...(tbd ? { formatVote: isFormatVote(mine.format_vote) ? mine.format_vote : ('either' as const) } : {}) } : null,
    ...(tbd ? { formatTbd: true as const } : {}),
    ...(alert ? { formatAlert: alert } : {}),
    ...(before ? { lockedLevel: before.first_level ?? before.picked_level } : {}),
    ...(onlyMe ? { onlyMe: true as const } : {}),
  };
  // Zip 56: the plain Canceled card, with what came back to this player (Zip 62: from the screen's batch when it read this very row).
  if (statusOf(t) === 'canceled') return { ...base, canceled: (readTickets && pre?.canceledMoney) || (await canceledMoneyOf(ctx.db, t.id, playerId)) };
  // Piece 1's stage (tickets never opened) sends what it did.
  if (!ticketsEverOpened(t)) return base;
  // Zip 57: the teams and game day, once the organizer published the teams, while the style is Locked doubles (an Americano night has no teams).
  const dayView =
    statusOf(t2) === 'tickets' && t2.teams_at && t2.final_date && base.format === 'doubles'
      ? playerDayView(t2, all, readTickets && pre?.day ? pre.day : await loadDay(ctx.db, t.id), playerId, group.timezone, ctx.nowMs)
      : // Zip 61: the Americano night, once tickets close on Americano, for a player in it (their rounds, the games now, the points table).
        statusOf(t2) === 'tickets' && t2.final_date && base.format === 'americano' && decided
        ? playerRoundsView(t2, all, tickets, (readTickets && pre?.day ? pre.day : await loadDay(ctx.db, t.id)).games, playerId, group.timezone, ctx.nowMs)
        : null;
  return { ...base, tickets: await playerTicketsView(ctx, t, tickets, playerId, group, orgOf, readTickets ? pre?.freed : undefined), ...(dayView ? { day: dayView } : {}) };
}

/** Zip 56: the ticket part of one player's card: names only for everyone else, their own money only. */
async function playerTicketsView(
  ctx: Ctx,
  t: TournamentRow,
  tickets: TicketWithName[],
  playerId: string,
  group: GroupRow,
  orgOf: () => Promise<string | null>,
  /** Zip 62: freedSpots as the screen's batch read it for this very row (left out: read here, as before). */
  freedRead?: number,
): Promise<PlayerTicketsView> {
  const listed = tickets.filter((k) => k.signup_status === 'in');
  const me = (k: TicketWithName) => (k.player_id === playerId ? { me: true as const } : {});
  const money = (k: TicketWithName) => ({ priceCents: k.price_cents, creditCents: k.credit_cents, paidCents: k.paid_cents, claimCents: k.claim_cents });
  const own = tickets.find((k) => k.player_id === playerId) ?? null;
  const locked = lockedCount(tickets);
  const phase = statusOf(t) === 'tickets' ? ticketPhase(t, group.timezone, ctx.nowMs) : 'open';
  const freed = phase === 'after' ? (freedRead ?? (await freedSpots(ctx.db, group.id, t))) : 0;
  // Someone who already holds something (a spot, a paid place in line, an I paid waiting) keeps seeing it. Everyone else: closed once the night
  // started or 3 hours before the real start. Zip 64 (late paying and late joining): after Pay by a player on the list can still lock a spot
  // while one is open (the cap of 16); only with every spot taken are tickets closed for them then.
  const holding = !!own && (own.place === 'spot' || own.claim_cents > 0 || (own.place === 'line' && own.credit_cents + own.paid_cents >= own.price_cents));
  const closed = statusOf(t) === 'tickets' && (salesClosed(t, group.timezone, ctx.nowMs) || (!holding && (phase === 'cut' || (phase === 'after' && lockedInCount(tickets) >= MAX_SPOTS))));
  // Zip 70: Drop out closes 3 hours before the start; the late drop rule (the same test the back out runs in its statement, lateDropKeepsSql).
  const dropClosed = statusOf(t) === 'tickets' && dropClosedAt(t, group.timezone, ctx.nowMs);
  const ownSpot = !!own && own.signup_status === 'in' && own.place === 'spot' && own.credit_cents + own.paid_cents > 0;
  const dropKeeps = !dropClosed && statusOf(t) === 'tickets' && t.courts === 2 && !!t.pay_by && ctx.nowMs >= Date.parse(t.pay_by) && ownSpot && locked <= LATE_DROP_FLOOR;
  return {
    // The spots players see: the planned size (Alex's smart plan); every spot is taken only at the cap (16, Zip 63).
    size: smartPlan(locked).size,
    full: locked >= MAX_SPOTS,
    // The organizer pays the venue, never the group: their own seat is $0 (the organizer found as the site always finds them, saved or by name).
    priceCents: own ? own.price_cents : playerId === (await orgOf()) ? 0 : t.ticket_cents,
    payBy: statusOf(t) === 'tickets' ? (t.pay_by ?? null) : null,
    // Zip 59: closed for a player who is not locked in: the night has started, 3 hours before the start, or Pay by has passed with no freed spot
    // (a player already on the waitlist, or with an I paid waiting, can still finish what they started).
    ...(closed ? { closed: true as const } : { closed: false as const }),
    started: statusOf(t) === 'tickets' && salesClosed(t, group.timezone, ctx.nowMs),
    ...(dropClosed ? { dropClosed: true as const } : {}),
    ...(dropKeeps ? { dropKeeps: true as const } : {}),
    freed,
    // Zip 63 (Alex, the trust rule): what players see as locked in is every spot AND every I paid for a spot that waits for the organizer, in the
    // order they paid (a spot by when it was taken, an I paid by when it was tapped). Players never see "waiting"; the organizer confirms or
    // undoes it as before. Display only: the spots, the cap, the plan and every money row are counted exactly as before.
    locked: listed
      .filter((k) => k.place === 'spot' || (k.place !== 'line' && k.claim_cents > 0 && ticketOwed(money(k)) === 0))
      .map((k) => ({ k, at: (k.place === 'spot' ? k.place_at : k.claim_at) ?? k.updated_at }))
      .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0)) // stable: a tie keeps the tickets' own order (as before)
      .map(({ k }) => ({ name: k.display_name, ...me(k) })),
    // Alex (ship answer 5): names only. Paid or Not paid is for the organizer's screen; a player's own ticket is in `mine`.
    line: listed.filter((k) => k.place === 'line').map((k) => ({ name: k.display_name, ...me(k) })),
    mine: own
      ? { place: placeOf(own), creditCents: own.credit_cents, paidCents: own.paid_cents, claimCents: own.claim_cents, owedCents: ticketOwed(money(own)) }
      : null,
  };
}

const placeOf = (k: { place: string }): TicketPlaceView => (k.place === 'spot' || k.place === 'line' ? k.place : 'none');

/**
 * Zip 56: what a cancel gave back to this player (the plain Canceled card): the cash that became credit and the credit that went back to the
 * pot, both written by the cancel, and an I paid still waiting for the organizer. One small read, only on a canceled tournament's card.
 */
async function canceledMoneyOf(db: D1Database, tournamentId: string, playerId: string): Promise<{ backCents: number; claimCents: number }> {
  const row = await db
    .prepare(
      `SELECT
         (SELECT COALESCE(SUM(amount_cents), 0) FROM credit_ledger WHERE player_id = ?1 AND kind = 'kept' AND reason = ?2) +
         (SELECT COALESCE(SUM(amount_cents), 0) FROM credit_ledger WHERE player_id = ?1 AND kind = 'used' AND reason = ?3 AND ended_reason = 'canceled') AS back,
         (SELECT COALESCE(SUM(claim_cents), 0) FROM tournament_tickets WHERE tournament_id = ?4 AND player_id = ?1) AS claim`,
    )
    .bind(playerId, `tour:${tournamentId}:cancel`, `tour:${tournamentId}`, tournamentId)
    .first<{ back: number; claim: number }>()
    .catch(() => null);
  return { backCents: row?.back ?? 0, claimCents: row?.claim ?? 0 };
}

/**
 * Zip 56: a hold that never got a spot comes back as credit once the tournament night is over (10:00 PM on its date, nightOf):
 * every ticket in line or not placed, with credit or confirmed cash on it and no I paid waiting, by the site's own credit rules (credit used goes
 * back to the pot, cash becomes a credit entry). Done by the first screen that reads the tournament after that moment (a player's, the
 * organizer's, or a 5-second check), in one all-or-nothing batch that a second reader finds nothing left to do in. A read with the read-only
 * PIN writes nothing (server/viewOnly.ts), so it waits for the next real reader. Returns the tickets as they are now.
 */
async function returnUnusedHolds(ctx: Ctx, group: GroupRow, t: TournamentRow, tickets: TicketWithName[], upkeep?: Upkeep): Promise<TicketWithName[]> {
  if (statusOf(t) !== 'tickets') return tickets;
  const night = nightOf(t, group.timezone);
  if (!night || ctx.nowMs < night.end) return tickets;
  // Zip 57 (Alex): a standby player who took over on a team during the night played for their hold: it never comes back as credit.
  const onTeam = new Set(t.teams_at ? (await loadDay(ctx.db, t.id)).teams.flatMap((x) => [x.player_a, x.player_b]).filter((x): x is string => !!x) : []);
  // Zip 70: a kept late drop's money stays with the night (it paid for the second court); it never comes back as an unused hold.
  const due = tickets.filter((k) => k.place !== 'spot' && k.claim_cents === 0 && (k.credit_cents > 0 || k.paid_cents > 0) && !onTeam.has(k.player_id) && k.signup_status !== KEPT);
  if (due.length === 0) return tickets;
  if (upkeep) upkeep.tried = true;
  const endIso = new Date(night.end).toISOString();
  const played = t.teams_at
    ? (x: string) => ` AND NOT EXISTS (SELECT 1 FROM tournament_teams tm WHERE tm.tournament_id = ${x}.tournament_id AND (tm.player_a = ${x}.player_id OR tm.player_b = ${x}.player_id))`
    : () => '';
  const when = (x: string) =>
    `(${x}.place <> 'spot' AND NOT ${keptOff(x)} AND EXISTS (SELECT 1 FROM tournaments tt WHERE tt.id = ${x}.tournament_id AND tt.status = 'tickets') AND ${sqlText(ctx.nowIso)} >= ${sqlText(endIso)}${played(x)})`;
  try {
    const res = await ctx.db.batch(ticketBackStatements(ctx.db, { groupId: group.id, tournamentId: t.id, playerId: null, why: 'unused', endedReason: 'canceled', nowIso: ctx.nowIso, when }));
    if ((res[2]?.meta?.changes ?? 0) > 0) {
      await audit(ctx.db, group.id, null, 'tournament_holds_returned', { tournament: t.name, count: due.length, amountCents: due.reduce((s, k) => s + k.credit_cents + k.paid_cents, 0) }, ctx.nowIso);
    }
  } catch {
    return tickets;
  }
  return loadTickets(ctx.db, t.id);
}

/** The organizer's view of the open tournament (dashboard `tournament`), else of one canceled lately (its Canceled card), or null. */
export async function adminTournamentFor(
  ctx: Ctx,
  group: GroupRow,
  /** Zip 62: the rows the stamp's batch read (adminTourReads); left out, the view reads them itself as before. */
  pre?: TourPre<ShownRow>,
  /** Zip 62: set when building the view tried one of the two writes a read can make (see Upkeep). */
  upkeep?: Upkeep,
): Promise<AdminTournamentView | null> {
  const shown = pre ? shownFrom(pre.row, group, ctx.nowMs) : await shownTournament(ctx.db, group, ctx.nowMs);
  if (!shown) return null;
  const orgOf = orgLookup(ctx, group, pre);
  const t = await upgradeDatePicked(ctx, group, shown, upkeep);
  // A piece 1 date pick that just opened tickets wrote the organizer's seat and the spots: its tickets are read again (as before, after it).
  const readTickets = pre && t === shown ? pre.tickets : null;
  const rows = (pre ? pre.signups : await signupRows(ctx.db, t.id)).filter((r) => r.is_active === 1);
  const tickets = ticketsEverOpened(t) ? await returnUnusedHolds(ctx, group, t, readTickets ?? (await loadTickets(ctx.db, t.id)), upkeep) : [];
  const tz = group.timezone;
  // Zip 64: the style rule, and the real times once the date is finalized.
  const ts = await settleStyle(ctx, group, t, tickets, upkeep);
  const decided = styleDecided(ts, ctx.nowMs);
  const nIn = lockedInCount(tickets);
  const real = startSetOf(t) ? realTimes(t) : null;
  const oddNow = decided && isOddSource(ts.format_source);
  // The organizer, as the site always finds them (saved, or by the name in Settings): their seat is the $0 one.
  const orgId = tickets.length ? await orgOf() : group.organizer_player_id;
  // Alex's smart plan: the planned size, the courts and the hours; the organizer's cost follows. Zip 64 part 8: sized from the players signed
  // up before tickets open (nobody has paid yet), then from the larger of those who can make the picked date and those locked in.
  const locked = tickets.filter((k) => k.place === 'spot' && k.signup_status === 'in');
  const listed = rows.filter((r) => r.status === 'in');
  const count = planCount({
    signedUp: listed.length,
    going: t.final_date ? listed.filter((r) => storedDays(r.dates).includes(t.final_date!)).length : listed.length,
    locked: locked.length,
    ticketsOpen: statusOf(t) === 'tickets',
  });
  const plan = smartPlan(count);
  const paidNow = locked.filter((k) => k.player_id !== orgId && k.price_cents > 0).length;
  const prize = prizeCentsOf(formatOf(ts), t.champion_credit_cents, t.second_credit_cents ?? 0);
  // Zip 70: the Plan's expected players: the organizer's saved Expect number, else the site's suggestion (the real count above), never fewer
  // than the players locked in, 6 to 16. Before the date is finalized the courts and hours are the table's suggestion for that many (the saved
  // courts once the organizer saved a plan).
  const savedN = savedExpect(shown.expect_saved);
  const suggested = Math.min(EXPECT_MAX, Math.max(EXPECT_MIN, count));
  const expected = expectedPlayers({ saved: savedN, suggested, locked: nIn });
  const sug = suggestedPlan(expected);
  // Zip 57: once the date is finalized the plan line, the cost and the venue card use the courts the organizer chose there (and the real hours).
  const courts = real || savedN !== null ? (t.courts === 1 ? 1 : 2) : sug.courts;
  const planMinutes = real ? real.minutes : sug.minutes;
  // Zip 70: THE money line (shared/tournament.ts moneyLine) for the expected players: the card, the Time and Plan boxes and the Plan card.
  const money = moneyLine({ expected, courts, minutes: planMinutes, ticketCents: t.ticket_cents, prizeCents: prize });
  // Zip 70: Time and Plan can change until the night starts: the teams are published, or the night window opens (30 minutes before the start).
  const changeOpen =
    statusOf(t) !== 'canceled' && !nightOver(t, tz, ctx.nowMs) && !t.teams_at && !(real && t.final_date && ctx.nowMs >= startMsOf(t.final_date, real.start, tz) - LIVE_BEFORE_MS);
  const shownFormat: TournamentFormat = decided && !salesClosed(t, tz, ctx.nowMs) ? styleAtClose(formatOf(ts), nIn) : formatOf(ts);
  // Zip 57: the check when tickets close, with the players really locked in (amber): under 6, too tight, or a court no longer needed.
  let closeCheck: AdminTournamentView['closeCheck'] = null;
  if (decided && real && statusOf(t) === 'tickets' && !nightOver(t, tz, ctx.nowMs)) {
    const fit = nightPlan(nIn, courts, real.minutes, shownFormat);
    const nums = courtNumbersOf(t);
    if (nIn < 6) closeCheck = { kind: 'few', text: `Only ${nIn} locked in. Cancel or reschedule?` };
    else if (!fit.fits) closeCheck = { kind: 'tight', text: fitWords(fit, real.start).text };
    else if (courts === 2 && nIn <= 7) closeCheck = { kind: 'extra_court', text: `${nIn} locked in: 1 court is enough. Call the venue to cancel court ${nums?.[1] ?? 2}.` };
  }
  const dayRows = statusOf(t) === 'tickets' && t.final_date ? (readTickets && pre?.day ? pre.day : await loadDay(ctx.db, t.id)) : null;
  const pending = statusOf(t) !== 'canceled' && (await votePending(ctx, group, t, tickets, orgOf));
  const voters = rows.filter((r) => r.status === 'in' && (!t.final_date || storedDays(r.dates).includes(t.final_date)));
  const votesSent = !!sourceOf(ts.format_source);
  // Zip 66: the "Not signed up" row (organizer only).
  const notSignedUp = await notSignedUpOf(ctx, group, t, listed, tickets, orgOf, pre);
  return {
    id: t.id,
    name: t.name,
    format: shownFormat,
    // Zip 64: the style can change until the tournament starts (Finalize or Edit); only the night starting (or a cancel) locks it.
    formatLocked: statusOf(t) === 'canceled' || salesClosed(t, tz, ctx.nowMs),
    startSet: !!real,
    styleDecided: decided,
    lockedIn: nIn,
    oddSwitch: oddNow && nIn % 2 === 1 ? { key: `odd:${t.id}:${ts.format_source}` } : null,
    switchBack: oddNow && nIn % 2 === 0 && !salesClosed(t, tz, ctx.nowMs) ? { key: `back:${t.id}:${ts.format_source}:${nIn}` } : null,
    // Zip 60: the vote, with the counts (organizer only): while the date is not locked every player on the list, then the players who can make the picked date.
    ...(pending ? { formatPending: true } : {}),
    ...(votesSent ? { formatSource: sourceOf(ts.format_source), votes: tallyVotes(voters.map((r) => r.format_vote)) } : {}),
    ...(notSignedUp ? { notSignedUp } : {}),
    settingsLocked: playersHoldTickets(t, tickets.some((k) => k.player_id !== orgId)),
    payBy:
      statusOf(t) === 'tickets' ? (t.pay_by ?? null) : statusOf(t) === 'date_picked' && t.final_date ? defaultPayBy(t.final_date, NIGHT_START_MINUTES, tz, ctx.nowMs) : null,
    closed: salesClosed(t, tz, ctx.nowMs),
    over: nightOver(t, tz, ctx.nowMs),
    tickets: tickets.map(
      (k): AdminTicketView => ({
        playerId: k.player_id,
        name: k.display_name,
        place: placeOf(k),
        placeAt: k.place_at,
        priceCents: k.price_cents,
        creditCents: k.credit_cents,
        paidCents: k.paid_cents,
        claimCents: k.claim_cents,
        claimAt: k.claim_at,
        out: k.signup_status !== 'in',
        organizer: !!orgId && k.player_id === orgId,
      }),
    ),
    canceledAt: t.canceled_at,
    status: statusOf(t),
    visibility: t.visibility === 'all' ? 'all' : 'me',
    size: plan.size,
    // Zip 70: the spots players see ("6 of 8"), the Plan's expected players and how they were set, and the money line for them.
    spots: smartPlan(locked.length).size,
    expected,
    suggested,
    expectSaved: savedN !== null,
    money,
    timeOpen: !!real && statusOf(t) === 'tickets' && changeOpen,
    planOpen: changeOpen,
    courts,
    minutes: planMinutes,
    start: real ? real.start : sug.start,
    // Zip 64: once the date is finalized the court bill follows the real hours ("Plays"); Zip 57: on the courts chosen there. Zip 70 (dry run
    // fix 5): "if it fills" is the money line for the Plan's expected players, not the plan size.
    cost: { courtCents: money.courtCents, ifFillsCents: -money.youCents, nowCents: money.courtCents - paidNow * t.ticket_cents + prize, paidNow },
    ...(real ? { chosenCourts: courts } : {}),
    closeCheck,
    ...(dayRows ? { day: adminDayView(ts, shownFormat, rows, tickets, dayRows, tz, ctx.nowMs) } : {}),
    // Zip 61: the Americano night (once tickets close on Americano): the rounds, the scores, the Time check, Player left.
    ...(dayRows && decided && shownFormat === 'americano' ? { rounds: adminRoundsView(ts, rows, tickets, dayRows.games, tz, ctx.nowMs) } : {}),
    // Zip 58: End tournament, once the Final (or the last round) is in.
    ...(() => {
      const end = dayRows && decided ? adminEndView(ts, shownFormat, rows, tickets, dayRows, tz, ctx.nowMs, orgId ?? null) : null;
      return end ? { end } : {};
    })(),
    ticketCents: t.ticket_cents,
    championCreditCents: t.champion_credit_cents,
    secondCreditCents: t.second_credit_cents ?? 0,
    offeredDates: storedDays(t.offered_dates),
    finalDate: shownDate(t),
    createdAt: t.created_at,
    signups: rows
      .filter((r) => r.status === 'in')
      .map((r) => ({
        playerId: r.player_id,
        name: r.display_name,
        pickedLevel: r.picked_level,
        level: r.approved_level ?? r.picked_level,
        reviewed: r.approved_level !== null,
        dates: storedDays(r.dates),
        at: r.joined_at,
        // Zip 66: each player's vote, with the counts (the card's Votes row lists the names). A missing vote counts as Either.
        ...(votesSent ? { vote: isFormatVote(r.format_vote) ? r.format_vote : ('either' as const) } : {}),
      })),
    backedOut: rows
      .filter((r) => r.status !== 'in')
      .sort((a, b) => (b.backed_out_at ?? '').localeCompare(a.backed_out_at ?? ''))
      .map((r) => ({ playerId: r.player_id, name: r.display_name })),
  };
}

/**
 * Zip 66: the organizer's "Not signed up" row. Sign-up step (sign-up open, or rescheduled): the active players who played a game in the last 3
 * months and are not on the list (never the organizer). Tickets open: the players on the list who did NOT pick the date and have not answered
 * the in-or-out alert (no spot, nothing paid in full, no I paid), while they can still lock a spot (before the last 3 hours, a spot open, the
 * night not started); `closeAt` is Pay by, or the 3-hour cutoff once Pay by has passed. Otherwise none (the row hides).
 */
async function notSignedUpOf(
  ctx: Ctx,
  group: GroupRow,
  t: TournamentRow,
  listed: readonly SignupRow[],
  tickets: readonly TicketWithName[],
  orgOf: () => Promise<string | null>,
  pre?: TourPre<ShownRow>,
): Promise<NotSignedUpView | null> {
  const st = statusOf(t);
  const on = new Set(listed.map((r) => r.player_id));
  if (st === 'signup' || st === 'rescheduled') {
    const read = recentPlayersRead(group.id, ctx.nowMs);
    const recent =
      pre?.recent ??
      (
        await ctx.db
          .prepare(read.sql)
          .bind(...read.values)
          .all<{ id: string; display_name: string }>()
      ).results;
    const org = await orgOf();
    return { mode: 'recent', players: recent.filter((p) => p.id !== org && !on.has(p.id)).map((p) => ({ playerId: p.id, name: p.display_name })), closeAt: null };
  }
  // The same fullness the player's card uses (spots taken: lockedCount), so the row and the player's alert agree.
  if (st !== 'tickets' || !t.final_date || salesClosed(t, group.timezone, ctx.nowMs) || lockedCount(tickets) >= MAX_SPOTS) return null;
  const phase = ticketPhase(t, group.timezone, ctx.nowMs);
  if (phase === 'cut') return null;
  const byId = new Map(tickets.map((k) => [k.player_id, k]));
  const org = await orgOf();
  // Answered, by the player's own card rules (shared/tournamentNudge.ts ticketStateOf): a spot, paid in full, a standby place with money or an I
  // paid on it, or an I paid for the whole ticket. A partial I paid still owes, so the alert still asks them (and so does this row).
  const answered = (k: TicketWithName | undefined) => {
    if (!k) return false;
    const money = { priceCents: k.price_cents, creditCents: k.credit_cents, paidCents: k.paid_cents, claimCents: k.claim_cents };
    if (k.place === 'spot' || k.credit_cents + k.paid_cents >= k.price_cents) return true;
    if (k.place === 'line') return k.claim_cents > 0;
    return k.claim_cents > 0 && ticketOwed(money) === 0;
  };
  const players = listed
    .filter((r) => r.player_id !== org && !storedDays(r.dates).includes(t.final_date!) && !answered(byId.get(r.player_id)))
    .map((r) => ({ playerId: r.player_id, name: r.display_name }));
  const closeAt = phase === 'open' && t.pay_by ? t.pay_by : new Date(salesCutoffMs(startMsOf(t.final_date, realTimes(t).start, group.timezone))).toISOString();
  return { mode: 'missed', players, closeAt };
}

/**
 * The "did anything change?" part for a player's screen: only while the tournament is visible to them (so an Only me tournament changes
 * nothing a player's phone can see, not even its fingerprint). Null: nothing to add (the stamp is then exactly main's).
 */
export async function playerTournamentStamp(
  ctx: Ctx,
  group: GroupRow,
  playerId: string | null,
  pre?: TourPre<ActiveRow>,
): Promise<{ part: string | null; view?: PlayerTournamentView | null }> {
  // Absent while there is nothing this player may see (switch off, none open, Only me for someone else): the stamp is then main's.
  // Zip 62: the view comes back too (only when it was built without an error and without trying a write), so GET /api/group sends it
  // instead of building it again.
  try {
    const upkeep: Upkeep = { tried: false };
    const view = await playerTournamentFor(ctx, group, playerId, false, pre, upkeep);
    return { part: view ? `tour:${JSON.stringify(view)}` : null, ...(upkeep.tried ? {} : { view }) };
  } catch {
    return { part: null };
  }
}

/** The organizer's "did anything change?" part, only while the switch is on (null: the stamp is exactly main's). */
export async function adminTournamentStamp(ctx: Ctx, group: GroupRow, pre?: TourPre<ShownRow>): Promise<{ part: string | null; view?: AdminTournamentView | null }> {
  // (The stamp's batch reads `pre` only after this same switch question said on, so it is not asked twice.)
  if (!pre && !(await tournamentsFlags(ctx, group.id)).on) return { part: null };
  // Zip 62: the view comes back too (only when it was built without an error and without trying a write), so the dashboard sends it instead
  // of building it again.
  try {
    const upkeep: Upkeep = { tried: false };
    const view = await adminTournamentFor(ctx, group, pre, upkeep);
    return { part: `tour:${view ? JSON.stringify(view) : 'none'}`, ...(upkeep.tried ? {} : { view }) };
  } catch {
    return { part: 'tour:none' };
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// The organizer's taps
// ---------------------------------------------------------------------------------------------------------------------

/** Organizer routes: the organizer's sign-in, and the switch on for this phone (off: refused, nothing read or written). */
export async function organizerOn(ctx: Ctx): Promise<GroupRow> {
  const group = await requireAdmin(ctx);
  if (!(await tournamentsFlags(ctx, group.id)).on) throw new HttpError(403, 'tournaments_off', 'Tournaments are switched off.');
  return group;
}

export async function openById(ctx: Ctx, group: GroupRow): Promise<TournamentRow> {
  const id = v.id(ctx.params.id, 'tournament');
  const t = await activeTournament(ctx.db, group.id);
  if (!t || t.id !== id) throw new HttpError(409, 'tournament_changed', 'This just changed. Look again.');
  return t;
}

/** Only an open tournament is ever changed: a save racing a Cancel changes nothing and says "look again". */
export const OPEN_GUARD = `AND status IN ${OPEN}`;
/** Zip 56: the date step (pick a date, take it back) is open before tickets open, and again after a Reschedule. */
const DATE_GUARD = "AND status IN ('signup', 'date_picked', 'rescheduled')";
export const changedOrLookAgain = (res: { meta?: { changes?: number } }) => {
  if ((res.meta?.changes ?? 0) === 0) throw new HttpError(409, 'tournament_changed', 'This just changed. Look again.');
};

const bad = (code: string, message: string): never => {
  throw new HttpError(400, code, message);
};

function wholeCents(v: unknown, field: string, label: string): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > MAX_PRICE_CENTS) bad(`invalid_${field}`, `${label} must be between $0 and $${MAX_PRICE_CENTS / 100}.`);
  return v as number;
}

/** A Pay by time from the organizer: an exact moment from now on, no later than 3 hours before the start of the tournament night. */
export function readPayByTime(raw: unknown, nowMs: number, startMs: number): string {
  const iso = v.isoTime(raw, 'payBy');
  if (!iso) throw new HttpError(400, 'invalid_pay_by', 'Pick a Pay by time.');
  const ms = Date.parse(iso);
  if (ms <= nowMs) throw new HttpError(400, 'invalid_pay_by', 'Pick a Pay by time that has not passed.');
  if (ms > salesCutoffMs(startMs)) throw new HttpError(400, 'invalid_pay_by', 'Pick a Pay by time at least 3 hours before the tournament starts.');
  return iso;
}

interface Settings {
  name: string;
  dates: string[];
  ticketCents: number;
  creditCents: number;
  secondCreditCents: number;
  /** Zip 60: a format, or "Let players vote". Left out by an older screen: Create starts on the vote; Edit keeps what the tournament has. */
  format: FormatChoice;
  visibility: Visibility;
}

/**
 * The Create (and Edit) screen's fields, checked. `keep`: dates already offered, which may stay even once they are in the past. Alex (after
 * testing piece 1): no players expected and no court plan any more; the smart plan follows the players locked in (shared/tournament.ts), and a
 * size or plan sent by an older screen is ignored.
 */
function readSettings(body: Record<string, unknown>, group: GroupRow, nowMs: number, keep: readonly string[] = []): Settings {
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) bad('invalid_name', 'Type a name.');
  if (Array.from(name).length > NAME_MAX) bad('invalid_name', `Keep the name to ${NAME_MAX} letters.`);
  v.text(name, 'name', { max: NAME_MAX * 2 }); // control and hidden characters refused
  const dates = cleanDays(body.dates);
  if (!dates || dates.length === 0) bad('invalid_dates', 'Pick at least one date.');
  if (dates!.length > MAX_DATES) bad('invalid_dates', `Pick at most ${MAX_DATES} dates.`);
  const today = todayKey(nowMs, group.timezone);
  if (dates!.some((d) => d < today && !keep.includes(d))) bad('invalid_dates', 'Pick dates from today on.');
  return {
    name,
    dates: dates!,
    ticketCents: wholeCents(body.ticketCents, 'ticket', 'The ticket price'),
    creditCents: wholeCents(body.creditCents, 'credit', 'The credit'),
    // Americano's 2nd place credit (left out, e.g. by Doubles: $0, nothing to pay).
    secondCreditCents: body.secondCreditCents === undefined ? 0 : wholeCents(body.secondCreditCents, 'second_credit', 'The 2nd place credit'),
    format: body.format === undefined ? DEFAULT_FORMAT_CHOICE : v.oneOf(body.format, 'format', FORMAT_CHOICES),
    visibility: v.oneOf(body.visibility, 'visibility', ['me', 'all'] as const),
  };
}

const tablesMissing = (err: unknown) => err instanceof Error && /no such table/i.test(err.message);
const notReady = () => new HttpError(409, 'tournaments_not_ready', 'Tournaments are not set up on this site yet.');

/** POST /api/admin/tournament: Create tournament ("Open sign-up"). One open tournament at a time. */
export async function createTournament(ctx: Ctx, body: Record<string, unknown>) {
  const group = await organizerOn(ctx);
  const s = readSettings(body, group, ctx.nowMs);
  if (await activeTournament(ctx.db, group.id)) throw new HttpError(409, 'tournament_open', 'A tournament is already open.');
  if (await canceledClaimWaiting(ctx.db, group.id)) throw new HttpError(409, 'claim_waiting', 'Answer the I paid waiting on the canceled tournament first.');
  const id = newId();
  try {
    await ctx.db
      .prepare(
        `INSERT INTO tournaments (id, group_id, name, size, courts, minutes, start_minutes, ticket_cents, champion_credit_cents, offered_dates, final_date,
           status, visibility, created_at, updated_at, shown_at, format, second_credit_cents, format_source)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'signup', ?, ?, ?, ?, ?, ?, ?)`,
      )
      // The size and plan columns are NOT NULL; no screen asks for them now: they hold harmless defaults (the 12-spot cap and the whole night).
      .bind(id, group.id, s.name, STORED_PLAN.size, STORED_PLAN.courts, STORED_PLAN.minutes, STORED_PLAN.start, s.ticketCents, s.creditCents, JSON.stringify(s.dates), s.visibility, ctx.nowIso, ctx.nowIso, s.visibility === 'all' ? ctx.nowIso : null, s.format === 'vote' ? DEFAULT_FORMAT : s.format, s.secondCreditCents, s.format === 'vote' ? 'vote' : null)
      .run();
  } catch (err) {
    if (tablesMissing(err)) throw notReady();
    // The one-open index: another Create landed first.
    if (err instanceof Error && /unique/i.test(err.message)) throw new HttpError(409, 'tournament_open', 'A tournament is already open.');
    throw err;
  }
  await audit(ctx.db, group.id, null, 'tournament_created', { tournament: s.name, visibility: s.visibility, format: s.format }, ctx.nowIso);
  return { ok: true, id };
}

/**
 * PUT /api/admin/tournament/:id: Edit the tournament's settings. A date taken off the offer comes off every player's picks too; the picked
 * date cannot be taken off (pick another one first).
 */
export async function updateTournament(ctx: Ctx, body: Record<string, unknown>) {
  const group = await organizerOn(ctx);
  const t = await openById(ctx, group);
  const offered = storedDays(t.offered_dates);
  const s = readSettings(body, group, ctx.nowMs, offered);
  // A save that leaves the format or the 2nd place credit out keeps what the tournament has (only Create starts them at their defaults).
  if (body.secondCreditCents === undefined) s.secondCreditCents = t.second_credit_cents ?? 0;
  // Once players may hold tickets (tickets open on Everyone, Zip 56), also after a Reschedule: the format, the price and Everyone stay (players
  // have paid that price, and a player who holds a ticket must always see it). On Only me nobody else can hold one: every setting stays free.
  const org = await organizerIdOf(ctx.db, group);
  const held = playersHoldTickets(t, await playerTicketExists(ctx.db, t.id, org));
  // Zip 60: the format choice (a format, or "Let players vote"). The vote can be switched on only while no date is locked; a format picked by hand
  // after the vote was open is the organizer's ('admin'): its date alert then says only the format.
  const wasSource = t.format_source ?? null;
  let nextFormat = formatOf(t);
  let nextSource: string | null = wasSource;
  if (body.format !== undefined) {
    if (s.format === 'vote') {
      if (!isVoteSource(wasSource)) {
        if (t.final_date) {
          // Zip 64: "Auto" after the date is finalized: the vote's winner for that date again (the vote itself closed with the date).
          const tally = await voteTally(ctx, t, t.final_date);
          const d = decideFormat(tally.counts, await previousFormat(ctx.db, t));
          nextFormat = d.format;
          nextSource = d.rule === 'majority' ? 'vote' : 'tie';
        } else nextSource = 'vote';
      }
    } else if (isVoteSource(wasSource)) {
      // A hand pick while the vote is still open, or a different format. Saving the format as it already stands (the form after a Reschedule that
      // players hold tickets on, or after the vote decided it) changes nothing and keeps the vote as the source.
      if (s.format !== nextFormat || (!t.final_date && !held)) {
        nextFormat = s.format;
        nextSource = 'admin';
      }
    } else if (s.format !== nextFormat) {
      nextFormat = s.format;
    }
  }
  // Zip 64 (Alex): the style can change at any time before the tournament starts, tickets or not. Once tickets have closed, Locked doubles needs
  // an even number locked in; switching back to it from an odd switch says so to players ("back to Locked doubles").
  if (nextFormat !== formatOf(t) || nextSource !== wasSource) {
    if (salesClosed(t, group.timezone, ctx.nowMs)) throw new HttpError(409, 'format_locked', 'The tournament has started. The style stays.');
    if (styleDecided(t, ctx.nowMs) && nextFormat !== formatOf(t)) {
      const n = lockedInCount(await loadTickets(ctx.db, t.id));
      if (nextFormat === 'doubles' && n % 2 === 1) throw new HttpError(409, 'odd_count', `Locked doubles needs an even number. ${n} are locked in.`);
      nextSource = nextFormat === 'doubles' && isOddSource(wasSource) ? `back:${ctx.nowIso}` : 'admin';
    }
  }
  if (held) {
    if (s.ticketCents !== t.ticket_cents) throw new HttpError(409, 'ticket_locked', `Tickets have been sold. The price stays ${formatPrice(t.ticket_cents)}.`);
    if (s.visibility !== 'all') throw new HttpError(409, 'visibility_locked', 'Players have tickets. It stays on Everyone.');
  }
  if (t.final_date && dateFixed(t) && !s.dates.includes(t.final_date)) {
    throw new HttpError(409, 'final_date_kept', 'That date is the one you picked. Pick another date first.');
  }
  // For History only: how many players on the list (shown on the level list) lose a date they had picked. The trim itself runs on the rows as
  // they are when the save lands (below), so a player's own edit that lands in between is never overwritten.
  const offer = JSON.stringify(s.dates);
  const trimmed = (await signupRows(ctx.db, t.id)).filter((r) => r.status === 'in' && r.is_active === 1 && storedDays(r.dates).some((d) => !s.dates.includes(d))).length;
  const [res] = await ctx.db.batch([
    // Also guarded on the picked date still being in the new offer: a date pick that lands between the read above and this save is never left
    // outside the offered dates ("look again" instead).
    ctx.db
      .prepare(
        `UPDATE tournaments SET name = ?, ticket_cents = ?, champion_credit_cents = ?, offered_dates = ?,
           visibility = ?, shown_at = CASE WHEN ? = 'all' THEN COALESCE(shown_at, ?) ELSE shown_at END, updated_at = ?, format = ?, second_credit_cents = ?, format_source = ?
         WHERE id = ? AND group_id = ? ${OPEN_GUARD} AND (final_date IS NULL OR final_date IN (SELECT value FROM json_each(?)))
           AND format_source IS ?
           AND (NOT ${playersHoldTicketsSql(org)} OR (ticket_cents = ? AND ? = 'all'))`,
      )
      .bind(s.name, s.ticketCents, s.creditCents, offer, s.visibility, s.visibility, ctx.nowIso, ctx.nowIso, nextFormat, s.secondCreditCents, nextSource, t.id, group.id, offer, wasSource, s.ticketCents, s.visibility),
    // Every player's dates lose only the days taken off the offer, read from the row as it is now, and only when the save above landed (the
    // tournament holds exactly the new offer and is still open).
    ctx.db
      .prepare(
        `UPDATE tournament_signups SET
           dates = (SELECT json_group_array(value) FROM (SELECT j.value AS value FROM json_each(tournament_signups.dates) j WHERE j.value IN (SELECT value FROM json_each(?1)) ORDER BY j.value)),
           updated_at = ?2
         WHERE tournament_id = ?3
           AND EXISTS (SELECT 1 FROM json_each(tournament_signups.dates) j WHERE j.value NOT IN (SELECT value FROM json_each(?1)))
           AND EXISTS (SELECT 1 FROM tournaments WHERE id = ?3 AND offered_dates = ?1 ${OPEN_GUARD})`,
      )
      .bind(offer, ctx.nowIso, t.id),
  ]);
  changedOrLookAgain(res);
  await audit(ctx.db, group.id, null, 'tournament_edited', { tournament: s.name, ...(trimmed ? { trimmed } : {}) }, ctx.nowIso);
  if (nextFormat !== formatOf(t) || nextSource !== wasSource) {
    await audit(ctx.db, group.id, null, 'tournament_format', { tournament: s.name, format: nextFormat, how: nextSource === 'vote' ? (t.final_date ? 'vote' : 'vote_open') : nextSource === 'tie' ? 'tie' : 'admin' }, ctx.nowIso);
  }
  if (s.visibility !== (t.visibility === 'all' ? 'all' : 'me')) await audit(ctx.db, group.id, null, s.visibility === 'all' ? 'tournament_shown' : 'tournament_hidden', { tournament: s.name }, ctx.nowIso);
  return { ok: true };
}

/** PUT /api/admin/tournament/:id/visibility { visibility }: Only me or Everyone (also the player page's "Show to everyone"). */
export async function setTournamentVisibility(ctx: Ctx, body: Record<string, unknown>) {
  const group = await organizerOn(ctx);
  const t = await openById(ctx, group);
  const visibility = v.oneOf(body.visibility, 'visibility', ['me', 'all'] as const);
  // Zip 56: once tickets have been open on Everyone, players may hold tickets: it stays on Everyone (a player must always see a ticket they hold).
  // Tickets open on Only me (the date picked on the organizer's private test): Everyone is one tap, and Only me stays free until then.
  const org = await organizerIdOf(ctx.db, group);
  if (visibility === 'me' && playersHoldTickets(t, await playerTicketExists(ctx.db, t.id, org))) throw new HttpError(409, 'visibility_locked', 'Players have tickets. It stays on Everyone.');
  changedOrLookAgain(
    await ctx.db
      .prepare(`UPDATE tournaments SET visibility = ?, shown_at = CASE WHEN ? = 'all' THEN COALESCE(shown_at, ?) ELSE shown_at END, updated_at = ? WHERE id = ? ${OPEN_GUARD} AND (? = 'all' OR NOT ${playersHoldTicketsSql(org)})`)
      .bind(visibility, visibility, ctx.nowIso, ctx.nowIso, t.id, visibility)
      .run(),
  );
  if (visibility !== (t.visibility === 'all' ? 'all' : 'me')) await audit(ctx.db, group.id, null, visibility === 'all' ? 'tournament_shown' : 'tournament_hidden', { tournament: t.name }, ctx.nowIso);
  return { ok: true, visibility };
}

/**
 * Zip 64: POST /api/admin/tournament/:id/switch-back: "Switch back to Locked doubles?" > Switch. Only after an odd switch (the vote's winner or
 * the organizer's pick was Locked doubles), with an even number locked in, before the night starts. Guarded on the style as read: a second tap
 * changes nothing. Players see "Tournament style is back to Locked doubles."
 */
export async function switchBackStyle(ctx: Ctx) {
  const group = await organizerOn(ctx);
  const t = await openById(ctx, group);
  if (!isOddSource(t.format_source) || formatOf(t) !== 'americano') return { ok: true, changed: false };
  if (salesClosed(t, group.timezone, ctx.nowMs)) throw new HttpError(409, 'format_locked', 'The tournament has started. The style stays.');
  // Zip 61: a score is in for the Americano night (results open 15 minutes before the start): the rounds have started, the style stays.
  if (await americanoStarted(ctx.db, t.id)) throw new HttpError(409, 'format_locked', 'The rounds have started. The style stays Americano.');
  const n = lockedInCount(await loadTickets(ctx.db, t.id));
  if (n % 2 === 1) throw new HttpError(409, 'odd_count', `Locked doubles needs an even number. ${n} are locked in.`);
  changedOrLookAgain(
    await ctx.db
      .prepare(`UPDATE tournaments SET format = 'doubles', format_source = ?, updated_at = ? WHERE id = ? AND format = 'americano' AND format_source = ? ${OPEN_GUARD} AND ${lockedInSql('tournaments.id')} % 2 = 0`)
      .bind(`back:${ctx.nowIso}`, ctx.nowIso, t.id, t.format_source)
      .run(),
  );
  await audit(ctx.db, group.id, null, 'tournament_format', { tournament: t.name, format: 'doubles', how: 'back', lockedIn: n }, ctx.nowIso);
  return { ok: true, changed: true };
}

// ---------------------------------------------------------------------------------------------------------------------
// Zip 70 (🎾70.time): move the start or the end after Finalize, and the Plan (expected players and courts)
// ---------------------------------------------------------------------------------------------------------------------

/** Zip 70: a stored time move ('tournament_time:<id>' detail): where the times were before the first move players were told about, and now. */
export interface TimeMove {
  from: { start: number; minutes: number };
  to: { start: number; minutes: number };
}
export function readTimeMove(detail: string | null | undefined): TimeMove | null {
  if (typeof detail !== 'string') return null;
  try {
    const j = JSON.parse(detail) as { fs?: unknown; fm?: unknown; ts?: unknown; tm?: unknown };
    const ok = (x: unknown): x is number => typeof x === 'number' && Number.isInteger(x) && x >= 0 && x <= 1440;
    if (!ok(j.fs) || !ok(j.fm) || !ok(j.ts) || !ok(j.tm)) return null;
    return { from: { start: j.fs, minutes: j.fm }, to: { start: j.ts, minutes: j.tm } };
  } catch {
    return null;
  }
}

/** Zip 70: the start, the end, or both can move until the teams are published or the night window opens (30 minutes before the start). */
function changeClosed(t: TournamentRow, tz: string, nowMs: number): string | null {
  if (t.teams_at) return 'The teams are published. The time and the plan stay.';
  if (nightOver(t, tz, nowMs)) return 'The tournament night is over.';
  if (t.final_date && startSetOf(t) && nowMs >= startMsOf(t.final_date, realTimes(t).start, tz) - LIVE_BEFORE_MS) return 'The night has started. The time and the plan stay.';
  return null;
}
/** SQL: no game of the night has been written (Locked doubles publishes them; Americano writes them at the night's first save). */
const NO_GAMES_SQL = 'NOT EXISTS (SELECT 1 FROM tournament_games g WHERE g.tournament_id = tournaments.id) AND teams_at IS NULL';

/**
 * PUT /api/admin/tournament/:id/time { start, minutes }: the Time box on the organizer's card (pictures 1 and 2). After Finalize the start and the end
 * can move until the night starts. Everything that reads the real times follows by itself (the plan and fit line, the Time check, the 3 hour
 * cutoff, the night on Home, the court cost, the venue card); Pay by does not move. Players on the list get one dismissible card per change
 * ("The Cold Open now ends at 9:30 PM (was 10 PM)."), kept as one task_log row: "was" is the time before the first move they were told about.
 */
export async function moveTournamentTime(ctx: Ctx, body: Record<string, unknown>) {
  const group = await organizerOn(ctx);
  const t = await openById(ctx, group);
  const tz = group.timezone;
  if (statusOf(t) !== 'tickets' || !t.final_date || !startSetOf(t)) throw new HttpError(409, 'not_finalized', 'Finalize the date first.');
  const was = realTimes(t);
  const ok = (x: unknown, lo: number, hi: number): x is number => typeof x === 'number' && Number.isInteger(x) && x >= lo && x <= hi && x % 5 === 0;
  if (!ok(body.start, 6 * 60, 23 * 60) || !ok(body.minutes, 60, 360) || (body.start as number) + (body.minutes as number) > 24 * 60) {
    bad('invalid_plays', 'Pick a start and an end on the same night, 1 to 6 hours apart.');
  }
  const next = { start: body.start as number, minutes: body.minutes as number };
  if (next.start === was.start && next.minutes === was.minutes) return { ok: true, changed: false, ...next };
  const closed = changeClosed(t, tz, ctx.nowMs);
  if (closed) throw new HttpError(409, 'time_locked', closed);
  const newStart = startMsOf(t.final_date, next.start, tz);
  if (ctx.nowMs >= newStart - LIVE_BEFORE_MS) bad('too_soon', 'That start is too soon. Pick a later one.');
  // Zip 70 (review): a move that would close tickets and Drop out at once (its 3 hour cutoff already passed) is refused while they are still open.
  if (ctx.nowMs >= salesCutoffMs(newStart) && ctx.nowMs < salesCutoffMs(startMsOf(t.final_date, was.start, tz))) {
    bad('too_soon', 'That start would close tickets and Drop out right now. Pick a later one.');
  }
  // Pay by never moves by itself: a start that would close tickets (3 hours before it) before Pay by asks for Pay by first.
  if (t.pay_by && Date.parse(t.pay_by) > ctx.nowMs && Date.parse(t.pay_by) > salesCutoffMs(newStart)) {
    throw new HttpError(409, 'pay_by_late', `Pay by is ${payByLabel(t.pay_by, tz, t.final_date)}, less than 3 hours before that start. Move Pay by first.`);
  }
  // "was" stays the time players were first told (the record's own "from"), so a second move still says the time they knew.
  const prior = readTimeMove(
    (await ctx.db
      .prepare("SELECT detail FROM task_log WHERE session_id IS NULL AND task = ? AND kind IN ('mark', 'sent') AND kind = 'mark' LIMIT 1")
      .bind(TIME_TASK + t.id)
      .first<{ detail: string | null }>()
      .catch(() => null))?.detail,
  );
  const from = prior ? prior.from : was;
  const same = from.start === next.start && from.minutes === next.minutes;
  const landed = `EXISTS (SELECT 1 FROM tournaments WHERE id = ? AND start_minutes = ${next.start} AND minutes = ${next.minutes} AND updated_at = ?)`;
  const res = await ctx.db.batch([
    ctx.db
      .prepare(
        `UPDATE tournaments SET start_minutes = ?, minutes = ?, updated_at = ? WHERE id = ? AND status = 'tickets' AND final_date = ? AND start_minutes = ? AND minutes = ?
           AND ${NO_GAMES_SQL}`,
      )
      .bind(next.start, next.minutes, ctx.nowIso, t.id, t.final_date, was.start, was.minutes),
    ctx.db.prepare(`DELETE FROM task_log WHERE group_id = ? AND session_id IS NULL AND task = ? AND kind = 'mark' AND ${landed}`).bind(group.id, TIME_TASK + t.id, t.id, ctx.nowIso),
    // Back to the time players were told first: no card (nothing changed for them).
    ...(same
      ? []
      : [
          ctx.db
            .prepare(`INSERT INTO task_log (id, group_id, session_id, task, kind, detail, at) SELECT ?, ?, NULL, ?, 'mark', ?, ? WHERE ${landed}`)
            .bind(newId(), group.id, TIME_TASK + t.id, JSON.stringify({ fs: from.start, fm: from.minutes, ts: next.start, tm: next.minutes }), ctx.nowIso, t.id, ctx.nowIso),
        ]),
  ]);
  changedOrLookAgain(res[0]);
  await audit(ctx.db, group.id, null, 'tournament_time', { tournament: t.name, from: planRange(was.start, was.minutes), to: planRange(next.start, next.minutes) }, ctx.nowIso);
  return { ok: true, changed: true, ...next };
}

/**
 * PUT /api/admin/tournament/:id/plan { expected, courts }: the Plan box (picture 7). Expect (6 to 16, never fewer than the players locked in) is
 * kept as one task_log row; the courts are the night's real courts (the tournament's existing courts field). The site keeps suggesting the number
 * on its own until a number is saved. Until the night starts (the same moment as the Time box).
 */
export async function saveTournamentPlan(ctx: Ctx, body: Record<string, unknown>) {
  const group = await organizerOn(ctx);
  const t = await openById(ctx, group);
  const n = body.expected;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < EXPECT_MIN || n > EXPECT_MAX) bad('invalid_expected', `Pick ${EXPECT_MIN} to ${EXPECT_MAX} players.`);
  if (body.courts !== 1 && body.courts !== 2) bad('invalid_courts', 'Pick 1 or 2 courts.');
  const courts = body.courts as 1 | 2;
  const closed = changeClosed(t, group.timezone, ctx.nowMs);
  if (closed) throw new HttpError(409, 'plan_locked', closed);
  const locked = ticketsEverOpened(t) ? lockedInCount(await loadTickets(ctx.db, t.id)) : 0;
  if ((n as number) < locked) throw new HttpError(409, 'expect_below_locked', `${locked} are locked in. Expect at least ${locked}.`);
  // The same numbers saved again (a double tap): nothing to write.
  const had = savedExpect(
    (await ctx.db
      .prepare("SELECT detail FROM task_log WHERE session_id IS NULL AND task = ? AND kind IN ('mark', 'sent') AND kind = 'mark' LIMIT 1")
      .bind(EXPECT_TASK + t.id)
      .first<{ detail: string | null }>()
      .catch(() => null))?.detail,
  );
  if (had === n && t.courts === courts) return { ok: true, expected: n, courts, changed: false };
  const landed = `EXISTS (SELECT 1 FROM tournaments WHERE id = ? AND courts = ${courts} AND updated_at = ?)`;
  const res = await ctx.db.batch([
    ctx.db.prepare(`UPDATE tournaments SET courts = ?, updated_at = ? WHERE id = ? ${OPEN_GUARD} AND ${NO_GAMES_SQL}`).bind(courts, ctx.nowIso, t.id),
    ctx.db.prepare(`DELETE FROM task_log WHERE group_id = ? AND session_id IS NULL AND task = ? AND kind = 'mark' AND ${landed}`).bind(group.id, EXPECT_TASK + t.id, t.id, ctx.nowIso),
    ctx.db
      .prepare(`INSERT INTO task_log (id, group_id, session_id, task, kind, detail, at) SELECT ?, ?, NULL, ?, 'mark', ?, ? WHERE ${landed}`)
      .bind(newId(), group.id, EXPECT_TASK + t.id, String(n), ctx.nowIso, t.id, ctx.nowIso),
    // Zip 70 (review): 1 court now: there is no second court to lose, so kept late drops get their credit back.
    ...(statusOf(t) === 'tickets' ? releaseKeptStatements(ctx.db, group.id, t.id, ctx.nowIso) : []),
  ]);
  changedOrLookAgain(res[0]);
  await audit(ctx.db, group.id, null, 'tournament_plan', { tournament: t.name, expected: n, courts }, ctx.nowIso);
  return { ok: true, expected: n, courts };
}

/** PUT /api/admin/tournament/:id/level { playerId, level }: the organizer's level for one player (kept in the level history too). */
export async function setTournamentLevel(ctx: Ctx, body: Record<string, unknown>) {
  const group = await organizerOn(ctx);
  const t = await openById(ctx, group);
  const playerId = v.id(body.playerId, 'playerId');
  if (!isLevel(body.level)) bad('invalid_level', 'Pick a level.');
  const level = body.level as number;
  const row = await ctx.db
    .prepare("SELECT s.id, p.display_name FROM tournament_signups s JOIN players p ON p.id = s.player_id WHERE s.tournament_id = ? AND s.player_id = ? AND s.status = 'in'")
    .bind(t.id, playerId)
    .first<{ id: string; display_name: string }>();
  if (!row) throw new HttpError(409, 'not_signed_up', 'They are not on the list any more.');
  const [res] = await ctx.db.batch([
    ctx.db.prepare(`UPDATE tournaments SET updated_at = ? WHERE id = ? ${OPEN_GUARD}`).bind(ctx.nowIso, t.id),
    ctx.db
      .prepare(`UPDATE tournament_signups SET approved_level = ?, updated_at = ? WHERE id = ? AND EXISTS (SELECT 1 FROM tournaments WHERE id = ? ${OPEN_GUARD})`)
      .bind(level, ctx.nowIso, row.id, t.id),
    ctx.db
      .prepare(
        `INSERT INTO tournament_level_history (id, tournament_id, player_id, level, set_by, created_at)
         SELECT ?, ?, ?, ?, 'organizer', ? WHERE EXISTS (SELECT 1 FROM tournaments WHERE id = ? ${OPEN_GUARD})`,
      )
      .bind(newId(), t.id, playerId, level, ctx.nowIso, t.id),
  ]);
  changedOrLookAgain(res);
  await audit(ctx.db, group.id, null, 'tournament_level', { tournament: t.name, player: row.display_name, playerId, level: levelShort(level) }, ctx.nowIso);
  return { ok: true, level };
}

/** PUT /api/admin/tournament/:id/date { date }: pick the date (an offered one), or null to go back to picking. */
export async function setTournamentDate(ctx: Ctx, body: Record<string, unknown>) {
  const group = await organizerOn(ctx);
  const t = await openById(ctx, group);
  return lockDate(ctx, group, t, body);
}

/** Zip 60: the votes of the players on the list who picked `date` (names in sign-up order), and the newest sign-up write they were counted from. */
async function voteTally(ctx: Ctx, t: TournamentRow, date: string): Promise<{ names: string[]; counts: VoteCounts; stamp: string }> {
  const all = await signupRows(ctx.db, t.id);
  const voters = all.filter((r) => r.status === 'in' && r.is_active === 1 && storedDays(r.dates).includes(date));
  return { names: voters.map((r) => r.display_name), counts: tallyVotes(voters.map((r) => r.format_vote)), stamp: all.reduce((m, r) => (r.updated_at > m ? r.updated_at : m), '') };
}

/**
 * GET /api/admin/tournament/:id/finalize?date=YYYY-MM-DD: the Finalize screen's facts for ONE date, before anything is locked: who can make it,
 * what the plan fits, the votes of those same players and who wins (and why), the usual Pay by and the ticket price. Organizer only; reads only.
 */
export async function finalizeView(ctx: Ctx): Promise<FinalizeView> {
  const group = await organizerOn(ctx);
  const t = await openById(ctx, group);
  const date = ctx.url.searchParams.get('date');
  if (statusOf(t) === 'tickets') throw new HttpError(409, 'tickets_open', 'Tickets are open. Reschedule to change the date.');
  if (!date || !storedDays(t.offered_dates).includes(date)) bad('invalid_date', 'Pick one of the dates you offered.');
  if (date! < todayKey(ctx.nowMs, group.timezone)) bad('invalid_date', 'That date has passed. Pick another one.');
  const plays = finalizeTimesOf(t);
  if (ctx.nowMs >= startMsOf(date!, plays.start, group.timezone)) bad('invalid_date', 'That night has started. Pick another date.');
  const org = await organizerIdOf(ctx.db, group);
  const held = playersHoldTickets(t, await playerTicketExists(ctx.db, t.id, org));
  const tally = await voteTally(ctx, t, date!);
  // Zip 64 part 8: the same count as the organizer's card will use once this date is picked (who can make it, or more locked in already).
  const fit = planFit(Math.max(tally.names.length, ticketsEverOpened(t) ? lockedCount(await loadTickets(ctx.db, t.id)) : 0));
  let votes: VoteCounts | null = null;
  let winner: FinalizeView['winner'] = null;
  if (isVoteSource(t.format_source) && !held) {
    votes = tally.counts;
    const previous = await previousFormat(ctx.db, t);
    const d = decideFormat(tally.counts, previous);
    winner = { format: d.format, rule: d.rule, previous: d.rule === 'tie' ? previous : null, words: winnerWords(tally.counts, d, previous) };
  }
  return {
    date: date!,
    players: tally.names,
    fits: fit.fits,
    over: fit.over,
    // Zip 57: the Courts row starts on the tournament's courts field (2 until the organizer picks 1 on Finalize).
    courts: t.courts === 1 ? 1 : 2,
    votes,
    winner,
    format: formatOf(t),
    locked: held,
    ticketCents: t.ticket_cents,
    payBy: defaultPayBy(date!, plays.start, group.timezone, ctx.nowMs),
    start: plays.start,
    minutes: plays.minutes,
  };
}

/**
 * Zip 64: what "Plays" starts on: 7:30 PM to 10:00 PM, or after a Reschedule the times the organizer finalized before (a tournament created
 * before Zip 64 still holds Create's placeholder 7:00 PM for 3 hours there, which is not a real choice, so it starts on 7:30 PM too).
 */
function finalizeTimesOf(t: TournamentRow): { start: number; minutes: number } {
  const placeholder = t.start_minutes === STORED_PLAN.start && t.minutes === STORED_PLAN.minutes;
  return placeholder ? { ...FINALIZE_TIMES } : realTimes(t);
}

/** Zip 64: the Finalize screen's "Plays" (start and length): whole 5 minutes, 1 to 6 hours, ending by midnight. Left out: finalizeTimesOf. */
function readPlays(body: Record<string, unknown>, t: TournamentRow): { start: number; minutes: number } {
  if (body.start === undefined && body.minutes === undefined) return finalizeTimesOf(t);
  const start = body.start;
  const minutes = body.minutes;
  const ok = (x: unknown, lo: number, hi: number): x is number => typeof x === 'number' && Number.isInteger(x) && x >= lo && x <= hi && x % 5 === 0;
  if (!ok(start, 6 * 60, 23 * 60) || !ok(minutes, 60, 360) || start + minutes > 24 * 60) bad('invalid_plays', 'Pick a start and an end on the same night, 1 to 6 hours apart.');
  return { start: start as number, minutes: minutes as number };
}

/**
 * The date step itself (also what the preview's Tournament test page runs, so its stages are made by the real statements). Zip 60: when the
 * players' vote decides the format, picking the date counts the votes and saves the winner in the SAME statement that locks the date: only
 * the votes of players who are on the list and picked THIS date count, Either counts for neither side, the majority of Locked doubles and
 * Americano wins, a tie (or nobody picking a side) goes by the tie rule (shared/tournament.ts decideFormat). Picking again, or after a
 * Reschedule, counts again. Once players hold tickets the format stays (they bought it).
 */
export async function lockDate(ctx: Ctx, group: GroupRow, t: TournamentRow, body: Record<string, unknown>) {
  // Zip 56: once tickets are open the date stays; Cancel or reschedule changes it (Reschedule goes back to this step).
  if (statusOf(t) === 'tickets') throw new HttpError(409, 'tickets_open', 'Tickets are open. Reschedule to change the date.');
  if (body.date === null) {
    // Back to picking. A tournament that has had tickets goes back to Rescheduled (players keep seeing "Pick your dates again").
    changedOrLookAgain(
      await ctx.db
        .prepare(`UPDATE tournaments SET status = CASE WHEN pay_by IS NOT NULL THEN 'rescheduled' ELSE 'signup' END, final_date = NULL, date_picked_at = NULL, updated_at = ? WHERE id = ? ${DATE_GUARD}`)
        .bind(ctx.nowIso, t.id)
        .run(),
    );
    if (t.final_date) await audit(ctx.db, group.id, null, 'tournament_date', { tournament: t.name, date: null }, ctx.nowIso);
    return { ok: true, date: null };
  }
  const date = body.date;
  if (typeof date !== 'string' || !storedDays(t.offered_dates).includes(date)) bad('invalid_date', 'Pick one of the dates you offered.');
  if ((date as string) < todayKey(ctx.nowMs, group.timezone)) bad('invalid_date', 'That date has passed. Pick another one.');
  // Zip 64: the real start and end ("Plays" on the Finalize screen), saved in the existing start_minutes and minutes columns.
  const plays = readPlays(body, t);
  if (ctx.nowMs >= startMsOf(date as string, plays.start, group.timezone)) bad('invalid_date', 'That night has started. Pick another date.');
  // Zip 57: the Courts row (1 or 2), saved in the tournament's existing courts field. Left out: kept as it is.
  if (body.courts !== undefined && body.courts !== 1 && body.courts !== 2) bad('invalid_courts', 'Pick 1 or 2 courts.');
  const courts = body.courts === 1 ? 1 : body.courts === 2 ? 2 : t.courts === 1 ? 1 : 2;
  // Zip 56 (Alex): picking the date opens tickets, for everyone on the list, in the same tap: Pay by starts at the night before at 7:00 PM (the
  // organizer can change it), the organizer's own $0 seat is taken when they are on the list. No other trigger.
  const night = startMsOf(date as string, plays.start, group.timezone);
  const org = await organizerIdOf(ctx.db, group);
  const held = playersHoldTickets(t, await playerTicketExists(ctx.db, t.id, org));
  // Zip 60 (the Finalize screen): everything the organizer may set while locking, all optional (a plain pick sends none of them and gets today's
  // defaults): Pay by, the ticket price, and the format (a format, or "Let players vote" = take the vote's winner).
  const payBy = body.payBy === undefined ? defaultPayBy(date as string, plays.start, group.timezone, ctx.nowMs) : readPayByTime(body.payBy, ctx.nowMs, night);
  const ticketCents = body.ticketCents === undefined ? t.ticket_cents : wholeCents(body.ticketCents, 'ticket', 'The ticket price');
  if (ticketCents !== t.ticket_cents && held) throw new HttpError(409, 'ticket_locked', `Tickets have been sold. The price stays ${formatPrice(t.ticket_cents)}.`);
  const choice = body.format === undefined ? undefined : v.oneOf(body.format, 'format', FORMAT_CHOICES);
  // The vote, when the players decide the format and no player holds a ticket yet.
  let decided: { format: TournamentFormat; source: FormatSource; counts: VoteCounts; stamp: string } | null = null;
  if (isVoteSource(t.format_source) && !held) {
    const tally = await voteTally(ctx, t, date as string);
    const d = decideFormat(tally.counts, await previousFormat(ctx.db, t));
    // `stamp`: the newest sign-up write the count was made from; the lock lands only if no sign-up changed since ("look again" otherwise).
    decided = { format: d.format, source: d.rule === 'majority' ? 'vote' : 'tie', counts: tally.counts, stamp: tally.stamp };
    // The sheet showed this winner: if the votes changed while it was open and the winner moved, say so and lock nothing.
    const seen = body.seenWinner;
    if (seen !== undefined && seen !== d.format) {
      throw new HttpError(409, 'votes_changed', `The votes changed. ${formatName(d.format)} wins now (${voteCountsLine(tally.counts)}). Look again, then tap Finalize.`);
    }
  }
  // The result written with the lock: the vote's winner, unless the organizer picked the other format by hand (then the format is the organizer's:
  // 'admin', and the alert never claims a vote). Picking the winner itself, or "Let players vote", changes nothing.
  let setFormat: TournamentFormat | null = decided?.format ?? null;
  let setSource: string | null = decided?.source ?? null;
  if (choice === 'doubles' || choice === 'americano') {
    const cur = decided ? decided.format : formatOf(t);
    if (choice !== cur) {
      // Zip 64: the style may change until the tournament starts (players who hold tickets after a Reschedule too).
      setFormat = choice;
      setSource = 'admin';
    }
  }
  const res = await ctx.db.batch([
    ctx.db
      .prepare(
        `UPDATE tournaments SET status = 'tickets', final_date = ?, date_picked_at = ?, pay_by = ?, updated_at = ?,
           format = COALESCE(?, format), format_source = COALESCE(?, format_source), ticket_cents = ?, start_minutes = ${plays.start}, minutes = ${plays.minutes}, courts = ${courts}
         WHERE id = ? ${DATE_GUARD} AND EXISTS (SELECT 1 FROM json_each(tournaments.offered_dates) WHERE value = ?) AND format_source IS ? AND ticket_cents = ?
           AND (? IS NULL OR (SELECT COALESCE(MAX(updated_at), '') FROM tournament_signups WHERE tournament_id = tournaments.id) = ?)`,
      )
      .bind(date, ctx.nowIso, payBy, ctx.nowIso, setFormat, setSource, ticketCents, t.id, date, t.format_source ?? null, t.ticket_cents, decided?.stamp ?? null, decided?.stamp ?? null),
    ...(org ? [organizerSeatStatement(ctx.db, t.id, org, ctx.nowIso)] : []),
    ...fillSpotsStatements(ctx.db, group.id, t.id, ctx.nowIso),
  ]);
  changedOrLookAgain(res[0]);
  await audit(ctx.db, group.id, null, 'tournament_date', { tournament: t.name, date: dayLong(date as string), day: date }, ctx.nowIso);
  if (decided || setSource === 'admin') {
    await audit(ctx.db, group.id, null, 'tournament_format', { tournament: t.name, format: setFormat, how: setSource === 'admin' ? 'admin' : decided!.source, ...(decided ? decided.counts : {}) }, ctx.nowIso);
  }
  await audit(
    ctx.db,
    group.id,
    null,
    'tournament_tickets_opened',
    { tournament: t.name, date: dayLong(date as string), priceCents: ticketCents, payBy: payByLabel(payBy, group.timezone, date as string), plays: planRange(plays.start, plays.minutes), courts },
    ctx.nowIso,
  );
  return { ok: true, date, payBy, format: setFormat ?? formatOf(t), source: setSource ?? t.format_source ?? null, start: plays.start, minutes: plays.minutes, courts };
}

/**
 * POST /api/admin/tournament/:id/cancel: the tournament is over before it started. The list is kept. Zip 56: every paid ticket comes back as
 * credit in the SAME all-or-nothing batch (credit used goes back to the pot, confirmed cash becomes a credit entry), once and only once: a second
 * tap finds it canceled and changes nothing. An I paid still waiting stays as it is until the organizer answers it (then it becomes credit).
 */
export async function cancelTournament(ctx: Ctx) {
  const group = await organizerOn(ctx);
  const t = await openById(ctx, group);
  // Once the night is over it has been played: Cancel would give every ticket back (review, Zip 56). Piece 3's End tournament closes it.
  if (nightOver(t, group.timezone, ctx.nowMs)) throw new HttpError(409, 'tournament_played', 'The tournament night is over. It cannot be canceled now.');
  const before = ticketsEverOpened(t) ? await loadTickets(ctx.db, t.id) : [];
  const [res] = await ctx.db.batch([
    ctx.db.prepare(`UPDATE tournaments SET status = 'canceled', canceled_at = ?, updated_at = ? WHERE id = ? ${OPEN_GUARD}`).bind(ctx.nowIso, ctx.nowIso, t.id),
    ...ticketBackStatements(ctx.db, { groupId: group.id, tournamentId: t.id, playerId: null, why: 'cancel', endedReason: 'canceled', nowIso: ctx.nowIso, when: tournamentCanceled }),
  ]);
  changedOrLookAgain(res);
  const back = before.filter((k) => k.claim_cents === 0 && k.credit_cents + k.paid_cents > 0);
  const returnedCents = back.reduce((s, k) => s + k.credit_cents + k.paid_cents, 0);
  const waiting = before.filter((k) => k.claim_cents > 0).length;
  await audit(
    ctx.db,
    group.id,
    null,
    'tournament_canceled',
    { tournament: t.name, ...(back.length ? { returned: back.length, amountCents: returnedCents } : {}), ...(waiting ? { waiting } : {}) },
    ctx.nowIso,
  );
  return { ok: true, returned: back.length, returnedCents, waiting };
}

// ---------------------------------------------------------------------------------------------------------------------
// The player's taps (sign up, edit, back out). Only on a tournament this player may see; never in View as on the live site (the demo copy only).
// ---------------------------------------------------------------------------------------------------------------------

export interface TournamentActor {
  group: GroupRow;
  playerId: string | null;
  viewAsName: string | null;
}

export async function playerTarget(ctx: Ctx, who: TournamentActor, body: Record<string, unknown>): Promise<{ t: TournamentRow; playerId: string }> {
  if (who.viewAsName && !ctx.env.SANDBOX) throw new HttpError(403, 'demo_only', 'Demo only. Nothing was saved.');
  if (!who.playerId) throw new HttpError(401, 'pick_name', 'Pick your name first.');
  const seen = await visibleTo(ctx, who.group, who.playerId, !!who.viewAsName);
  // The same answer for "none", "switched off", "Only me" and (Zip 56) a canceled one: nothing leaks through an error either.
  if (!seen || statusOf(seen.t) === 'canceled') throw new HttpError(404, 'tournament_not_open', 'This tournament is not open.');
  if (typeof body.tournamentId === 'string' && body.tournamentId !== seen.t.id) throw new HttpError(409, 'tournament_changed', 'This just changed. Look again.');
  return { t: seen.t, playerId: who.playerId };
}

/**
 * A player's save lands only while the tournament is still as this request read it (the same stage, offered dates and picked date), so a
 * sign-up racing the organizer's date pick, Edit settings or Cancel never keeps a date that is gone ("look again" instead). Five values.
 */
const UNCHANGED = 'EXISTS (SELECT 1 FROM tournaments WHERE id = ? AND status = ? AND offered_dates = ? AND final_date IS ?)';
const unchangedValues = (t: TournamentRow) => [t.id, t.status, t.offered_dates, t.final_date ?? null];

/**
 * Zip 60: the vote this save stores. Only while the vote is open (`pending`) a sent vote counts (a bad value is refused); a sign-up that sends none
 * keeps the one it had (NULL counts as Either). Once the date is locked a sent vote is ignored: the format is decided.
 */
function readVote(body: Record<string, unknown>, pending: boolean, had: string | null | undefined): string | null {
  if (!pending || body.formatVote === undefined) return had ?? null;
  if (!isFormatVote(body.formatVote)) bad('invalid_format_vote', 'Pick Locked doubles, Americano or Either.');
  return body.formatVote as string;
}
/** A missing vote and Either are the same vote. */
const sameVote = (a: string | null | undefined, b: string | null | undefined) => (a ?? 'either') === (b ?? 'either');

function readDates(body: Record<string, unknown>, open: readonly string[]): string[] {
  const dates = cleanDays(body.dates);
  if (!dates || dates.length === 0) bad('invalid_dates', 'Pick at least one date.');
  if (dates!.some((d) => !open.includes(d))) throw new HttpError(409, 'tournament_changed', 'This just changed. Look again.');
  return dates!;
}

/**
 * A player's own tap in History, under their own name. No phone code (Zip 30 "Acting for others" keeps to the game taps it was built for;
 * a tournament sign-up never shows on its Home card).
 */
export async function logPlayer(ctx: Ctx, group: GroupRow, playerId: string, action: string, details: Record<string, unknown>) {
  const p = await ctx.db.prepare('SELECT display_name FROM players WHERE id = ?').bind(playerId).first<{ display_name: string }>();
  const name = p?.display_name ?? 'A player';
  await audit(ctx.db, group.id, null, action, { player: name, playerId, ...details }, ctx.nowIso, name);
}

export async function mySignup(db: D1Database, tournamentId: string, playerId: string) {
  return db
    .prepare('SELECT id, status, picked_level, dates, format_vote FROM tournament_signups WHERE tournament_id = ? AND player_id = ?')
    .bind(tournamentId, playerId)
    .first<{ id: string; status: string; picked_level: number; dates: string; format_vote: string | null }>();
}

/**
 * POST /api/tournament/signup { tournamentId, level, dates }: on the list (again, after a back out: at the end of it). Alex (after testing
 * piece 1): a player picks their level ONCE. Someone who signs up again (after Drop out or Back out) keeps the level they picked first (the
 * level history), whatever this tap sends, and the organizer's level for them stays; only the organizer changes a level (the pencil).
 */
export async function playerTournamentSignup(ctx: Ctx, who: TournamentActor, body: Record<string, unknown>) {
  const { t, playerId } = await playerTarget(ctx, who, body);
  const first = await ctx.db
    .prepare("SELECT level FROM tournament_level_history WHERE tournament_id = ? AND player_id = ? AND set_by = 'player' ORDER BY created_at, rowid LIMIT 1")
    .bind(t.id, playerId)
    .first<{ level: number }>();
  if (!first && !isLevel(body.level)) bad('invalid_level', 'Pick your level.');
  const level = first ? first.level : (body.level as number);
  const dates = readDates(body, openDatesOf(t, todayKey(ctx.nowMs, who.group.timezone)));
  const before = await mySignup(ctx.db, t.id, playerId);
  const vote = readVote(body, await votePending(ctx, who.group, t), before?.format_vote);
  // Zip 70 (review): a kept late drop can come back only while tickets are open (back onto their own paid spot); after the 3 hour cutoff the
  // money stays kept (a sign-up then would leave paid money with no place, which the night's end would hand back).
  if (before?.status === KEPT && statusOf(t) === 'tickets' && dropClosedAt(t, who.group.timezone, ctx.nowMs)) throw new HttpError(409, 'tickets_closed', 'Tickets are closed.');
  // A second tap of Sign up (or another phone) with exactly the same answers: nothing to save, nothing to write in History.
  if (before && before.status === 'in' && JSON.stringify(storedDays(before.dates)) === JSON.stringify(dates) && sameVote(before.format_vote, vote)) return { ok: true, result: 'signed_up' };
  const [, listRow] = await ctx.db.batch([
    // The level history gets the pick only the first time (first in the batch, so the list row below reads it).
    ctx.db
      .prepare(
        `INSERT INTO tournament_level_history (id, tournament_id, player_id, level, set_by, created_at) SELECT ?, ?, ?, ?, 'player', ? WHERE ${UNCHANGED}
           AND NOT EXISTS (SELECT 1 FROM tournament_level_history WHERE tournament_id = ? AND player_id = ? AND set_by = 'player')`,
      )
      .bind(newId(), t.id, playerId, level, ctx.nowIso, ...unchangedValues(t), t.id, playerId),
    // The list row's level is the FIRST one in the level history, read when the batch lands: two first sign-ups from two phones at once both end
    // on the one that landed first. The organizer's level for them stays as it is.
    ctx.db
      .prepare(
        `INSERT INTO tournament_signups (id, tournament_id, player_id, status, picked_level, approved_level, dates, joined_at, created_at, updated_at, backed_out_at, format_vote)
         SELECT ?1, ?2, ?3, 'in',
           COALESCE((SELECT level FROM tournament_level_history WHERE tournament_id = ?2 AND player_id = ?3 AND set_by = 'player' ORDER BY created_at, rowid LIMIT 1), ?4),
           NULL, ?5, ?6, ?6, ?6, NULL, ?11 WHERE EXISTS (SELECT 1 FROM tournaments WHERE id = ?7 AND status = ?8 AND offered_dates = ?9 AND final_date IS ?10)
         ON CONFLICT (tournament_id, player_id) DO UPDATE SET
           joined_at = CASE WHEN tournament_signups.status = 'in' THEN tournament_signups.joined_at ELSE excluded.joined_at END,
           status = 'in', picked_level = excluded.picked_level, dates = excluded.dates, updated_at = excluded.updated_at, backed_out_at = NULL,
           format_vote = excluded.format_vote`,
      )
      .bind(newId(), t.id, playerId, level, JSON.stringify(dates), ctx.nowIso, ...unchangedValues(t), vote),
    // Zip 56: the organizer signing up while tickets are open takes their own $0 seat at once (a spot if one is open, else first paid in line).
    ...(statusOf(t) === 'tickets' && playerId === (await organizerIdOf(ctx.db, who.group))
      ? [organizerSeatStatement(ctx.db, t.id, playerId, ctx.nowIso), ...fillSpotsStatements(ctx.db, who.group.id, t.id, ctx.nowIso)]
      : []),
    // Zip 70 (review): a kept late drop who signs up again takes their own paid ticket back: into line (the list row above made them 'in' in this
    // same batch), then the line fills an open spot. So the kept money is theirs again only by playing, never by dropping a second time.
    ...(before?.status === KEPT && statusOf(t) === 'tickets'
      ? [
          ctx.db
            .prepare(
              `UPDATE tournament_tickets SET place = 'line', place_at = ?1, updated_at = ?1
               WHERE tournament_id = ?2 AND player_id = ?3 AND place = 'none' AND credit_cents + paid_cents >= price_cents
                 AND EXISTS (SELECT 1 FROM tournament_signups s WHERE s.tournament_id = ?2 AND s.player_id = ?3 AND s.status = 'in' AND s.updated_at = ?1)`,
            )
            .bind(ctx.nowIso, t.id, playerId),
          ...fillSpotsStatements(ctx.db, who.group.id, t.id, ctx.nowIso),
        ]
      : []),
  ]);
  changedOrLookAgain(listRow);
  if (!before || before.status !== 'in') {
    // The level as it landed (a first pick from another phone that landed just before this one wins).
    const stored = first ? null : await mySignup(ctx.db, t.id, playerId);
    await logPlayer(ctx, who.group, playerId, 'tournament_signup', { tournament: t.name, level: levelShort(stored?.picked_level ?? level) });
  } else await logPlayer(ctx, who.group, playerId, 'tournament_signup_edited', { tournament: t.name });
  return { ok: true, result: 'signed_up' };
}

/**
 * PUT /api/tournament/signup { tournamentId, dates }: Edit sign-up. Alex (after testing piece 1): DATES only. The level was picked once at
 * sign-up; only the organizer changes it (a `level` sent by an older screen is ignored).
 */
export async function playerTournamentEdit(ctx: Ctx, who: TournamentActor, body: Record<string, unknown>) {
  const { t, playerId } = await playerTarget(ctx, who, body);
  const before = await mySignup(ctx.db, t.id, playerId);
  if (!before || before.status !== 'in') throw new HttpError(409, 'not_signed_up', 'You are not on the list. Sign up first.');
  const dates = body.dates === undefined ? storedDays(before.dates) : readDates(body, openDatesOf(t, todayKey(ctx.nowMs, who.group.timezone)));
  // Zip 60: the format vote can change until the date is locked (the same save as the dates).
  const vote = readVote(body, await votePending(ctx, who.group, t), before.format_vote);
  if (JSON.stringify(dates) === JSON.stringify(storedDays(before.dates)) && sameVote(before.format_vote, vote)) return { ok: true, result: 'saved' };
  const res = await ctx.db
    .prepare(`UPDATE tournament_signups SET dates = ?, format_vote = ?, updated_at = ? WHERE id = ? AND status = 'in' AND ${UNCHANGED}`)
    .bind(JSON.stringify(dates), vote, ctx.nowIso, before.id, ...unchangedValues(t))
    .run();
  changedOrLookAgain(res);
  await logPlayer(ctx, who.group, playerId, 'tournament_signup_edited', { tournament: t.name });
  return { ok: true, result: 'saved' };
}

/**
 * POST /api/tournament/back-out { tournamentId, backCents? }: off the list (the row stays, so their level stays with this tournament).
 * Zip 56: their ticket comes back as credit in the SAME all-or-nothing batch (credit used goes back to the pot, confirmed cash becomes a credit
 * entry), the spot opens, and the first PAID person in line takes it. An I paid still waiting stays until the organizer answers it (then it
 * becomes credit). `backCents`: what the Back out? sheet said comes back; if the ticket changed since, nothing moves ("look again"). A second
 * tap finds them off the list and moves nothing. From the start of the tournament night a ticket that holds a spot or money stays (ask Alex).
 */
export async function playerTournamentBackOut(ctx: Ctx, who: TournamentActor, body: Record<string, unknown>) {
  const { t, playerId } = await playerTarget(ctx, who, body);
  const before = await mySignup(ctx.db, t.id, playerId);
  if (!before || before.status !== 'in') return { ok: true, result: 'not_signed_up' };
  const k = ticketsEverOpened(t) ? await ticketOf(ctx.db, t.id, playerId) : null;
  const holds = !!k && (k.place === 'spot' || k.credit_cents + k.paid_cents + k.claim_cents > 0);
  if (holds && salesClosed(t, who.group.timezone, ctx.nowMs)) throw new HttpError(409, 'tickets_closed', `The tournament has started. Ask ${firstName(who.group)}.`);
  // Zip 70 (Alex): Drop out closes 3 hours before the start (the moment tickets close). After that players text the organizer, who uses Player left.
  if (statusOf(t) === 'tickets' && dropClosedAt(t, who.group.timezone, ctx.nowMs)) {
    throw new HttpError(409, 'drop_closed', `Drop out has closed. Text ${firstName(who.group)}.`);
  }
  if (body.backCents !== undefined) {
    const shown = v.cents(body.backCents, 'backCents') ?? 0;
    if (shown !== (k ? k.credit_cents + k.paid_cents + k.claim_cents : 0)) throw new HttpError(409, 'amount_changed', 'Your ticket just changed. Look again.');
  }
  // The money-back statements always run (they do nothing without a ticket): a Lock that lands between the read above and this batch still has
  // its money come back (review, Zip 56). Never after a Cancel: that already gave every ticket back.
  // Zip 70 (review): what the Drop out sheet said about the money (`keeps`); when sent, the drop lands only if the rule still says the same.
  const shownKeeps = typeof body.keeps === 'boolean' ? body.keeps : null;
  // Zip 70 (Alex, the late drop rule): after Pay by, a drop that takes the number locked in below 8 on a 2 court night gives no credit back
  // (the sign-up becomes 'kept': off the list, the money stays on the ticket) until the spots are back to 8. Worked out IN the statement from the
  // rows as they are when it lands (lateDropKeepsSql), so two taps or a join landing at the same moment can never both win.
  const res = await ctx.db.batch([
    ctx.db
      .prepare(
        `UPDATE tournament_signups SET status = CASE WHEN ${lateDropKeepsSql(t.id, playerId, ctx.nowIso)} THEN '${KEPT}' ELSE 'out' END, backed_out_at = ?, updated_at = ?
         WHERE id = ? AND status = 'in' AND EXISTS (SELECT 1 FROM tournaments WHERE id = ? AND status <> 'canceled')${shownKeeps === null ? '' : ` AND (CASE WHEN ${lateDropKeepsSql(t.id, playerId, ctx.nowIso)} THEN 1 ELSE 0 END) = ${shownKeeps ? 1 : 0}`}`,
      )
      .bind(ctx.nowIso, ctx.nowIso, before.id, t.id),
    ...(ticketsEverOpened(t)
      ? [
          ...ticketBackStatements(ctx.db, { groupId: who.group.id, tournamentId: t.id, playerId, why: 'back', endedReason: 'dropped', nowIso: ctx.nowIso, when: offListBack }),
          // A kept ticket keeps its money but gives up its spot (or place in line), so the spot is open for someone else.
          ctx.db
            .prepare(`UPDATE tournament_tickets SET place = 'none', place_at = NULL, updated_at = ?1 WHERE tournament_id = ?2 AND player_id = ?3 AND place <> 'none' AND ${keptOff('tournament_tickets')}`)
            .bind(ctx.nowIso, t.id, playerId),
          ...fillSpotsStatements(ctx.db, who.group.id, t.id, ctx.nowIso),
        ]
      : []),
  ]);
  if ((res[0].meta?.changes ?? 0) === 0) {
    // Zip 70 (review): the sheet said one thing about the money and the rule now says the other (someone else dropped, Pay by passed): nothing
    // moved; the player looks again.
    const still = shownKeeps !== null ? await ctx.db.prepare("SELECT 1 AS x FROM tournament_signups s JOIN tournaments tt ON tt.id = s.tournament_id WHERE s.id = ? AND s.status = 'in' AND tt.status <> 'canceled'").bind(before.id).first() : null;
    if (still) throw new HttpError(409, 'drop_changed', 'This just changed. Look again.');
    return { ok: true, result: 'not_signed_up' };
  }
  // Kept, and not released by a paid standby taking the spot in this same batch: no credit back now.
  const keptNow = ticketsEverOpened(t) ? await keptCents(ctx.db, t.id, playerId) : 0;
  // What this very batch moved (the ledger rows it wrote at this moment), and what waits for the organizer's answer to an I paid.
  const moved = ticketsEverOpened(t) ? await movedBack(ctx.db, t.id, playerId, 'back', 'dropped', ctx.nowIso) : { cash: 0, credit: 0, waiting: 0 };
  const { waiting, cash, credit } = moved;
  await logPlayer(ctx, who.group, playerId, 'tournament_back_out', {
    tournament: t.name,
    tournamentId: t.id,
    ...(heldSpotSincePayBy(t, k) ? { freedSpot: true } : {}),
    ...(cash + credit > 0 ? { amountCents: cash + credit } : {}),
    ...(waiting && !keptNow ? { waitingCents: waiting } : {}),
    ...(keptNow ? { keptCents: keptNow } : {}),
  });
  // creditBackCents: cash that became credit; creditReturnedCents: credit that went back; waitingCents: held until the organizer answers an I paid.
  // Zip 70: keptCents: kept by the late drop rule (comes back as credit if the spots are back to 8).
  if (keptNow) return { ok: true, result: 'backed_out', creditBackCents: 0, creditReturnedCents: 0, waitingCents: 0, keptCents: keptNow };
  return { ok: true, result: 'backed_out', creditBackCents: cash, creditReturnedCents: credit, waitingCents: waiting };
}

/**
 * Zip 70 (review): the keep test and the release test count the same thing: paid spots held by players on the list (an I paid still waiting
 * for the organizer is not money yet, on either side). The dropper must hold a paid spot.
 */
const spotsOnListSql = (t: string) =>
  `(SELECT COUNT(*) FROM tournament_tickets k JOIN tournament_signups s ON s.tournament_id = k.tournament_id AND s.player_id = k.player_id AND s.status = 'in'
     WHERE k.tournament_id = ${t} AND k.place = 'spot')`;

/** Zip 70: Drop out has closed: 3 hours before the real start (the moment tickets close), or the night has started. */
export function dropClosedAt(t: TournamentRow, tz: string, nowMs: number): boolean {
  if (!t.final_date) return false;
  return nowMs >= salesCutoffMs(startMsOf(t.final_date, realTimes(t).start, tz));
}

/**
 * Zip 70: SQL, true when THIS drop keeps the dropper's money (the late drop rule): the tournament has tickets open on 2 courts and Pay by has
 * passed; the dropper is locked in (a spot, or an I paid for the whole ticket waiting) and has money on the ticket; and the number locked in,
 * the dropper included, is 8 or fewer (so the drop takes it below 8). Read inside the statement that takes them off the list.
 */
export function lateDropKeepsSql(tournamentId: string, playerId: string, nowIso: string): string {
  const t = sqlText(tournamentId);
  return `(EXISTS (SELECT 1 FROM tournaments tt WHERE tt.id = ${t} AND tt.status = 'tickets' AND tt.courts = 2 AND tt.pay_by IS NOT NULL AND tt.pay_by <= ${sqlText(nowIso)})
    AND EXISTS (SELECT 1 FROM tournament_tickets kk WHERE kk.tournament_id = ${t} AND kk.player_id = ${sqlText(playerId)}
      AND kk.place = 'spot' AND kk.credit_cents + kk.paid_cents > 0)
    AND ${spotsOnListSql(t)} <= ${LATE_DROP_FLOOR})`;
}

/** Zip 70: the money a kept late drop holds now (0 when they are not kept, or it already came back). */
async function keptCents(db: D1Database, tournamentId: string, playerId: string): Promise<number> {
  const row = await db
    .prepare(
      `SELECT k.credit_cents + k.paid_cents + k.claim_cents AS c FROM tournament_tickets k JOIN tournament_signups s ON s.tournament_id = k.tournament_id AND s.player_id = k.player_id
       WHERE k.tournament_id = ? AND k.player_id = ? AND s.status = '${KEPT}'`,
    )
    .bind(tournamentId, playerId)
    .first<{ c: number }>();
  return Number(row?.c ?? 0);
}

/**
 * Zip 56: what a money-back batch moved for one player, read from the rows it wrote at that moment (`nowIso`): cash that became a credit entry,
 * credit that went back to the pot, and the money still on a ticket whose I paid waits for the organizer.
 */
export async function movedBack(db: D1Database, tournamentId: string, playerId: string, why: 'back' | 'off', endedReason: 'dropped', nowIso: string) {
  const row = await db
    .prepare(
      `SELECT
         (SELECT COALESCE(SUM(amount_cents), 0) FROM credit_ledger WHERE player_id = ?1 AND kind = 'kept' AND reason = ?2 AND created_at = ?4) AS cash,
         (SELECT COALESCE(SUM(amount_cents), 0) FROM credit_ledger WHERE player_id = ?1 AND kind = 'used' AND reason = ?3 AND ended_at = ?4 AND ended_reason = ?5) AS credit,
         (SELECT COALESCE(SUM(credit_cents + paid_cents + claim_cents), 0) FROM tournament_tickets WHERE tournament_id = ?6 AND player_id = ?1 AND claim_cents > 0) AS waiting`,
    )
    .bind(playerId, `tour:${tournamentId}:${why}`, `tour:${tournamentId}`, nowIso, endedReason, tournamentId)
    .first<{ cash: number; credit: number; waiting: number }>();
  return { cash: Number(row?.cash ?? 0), credit: Number(row?.credit ?? 0), waiting: Number(row?.waiting ?? 0) };
}

/** The organizer's first name for the players' words ("Ask Alex"), or "the organizer". */
export function firstName(group: GroupRow): string {
  return (group.organizer_name ?? '').trim().split(/\s+/)[0] || 'the organizer';
}

// ---------------------------------------------------------------------------------------------------------------------
// View as (server/zip18.ts): the organizer's in-browser copy gets the tournament rows too, only while the switch is on (off: nothing new).
// ---------------------------------------------------------------------------------------------------------------------

export interface TournamentTables {
  tournaments: Record<string, unknown>[];
  tournament_signups: Record<string, unknown>[];
  tournament_level_history: Record<string, unknown>[];
  /** Zip 56: the tickets (missing from an older server's answer). */
  tournament_tickets?: Record<string, unknown>[];
  /** Zip 57: the teams and games (missing from an older server's answer, or a database before 0027). */
  tournament_teams?: Record<string, unknown>[];
  tournament_games?: Record<string, unknown>[];
}

export async function tournamentTablesFor(db: D1Database, groupId: string): Promise<TournamentTables | null> {
  // Zip 56: the tickets too (a database before 0024 has none: the three tables alone, as before).
  const tickets = await db
    .prepare('SELECT k.* FROM tournament_tickets k JOIN tournaments t ON t.id = k.tournament_id WHERE t.group_id = ? ORDER BY k.created_at, k.id')
    .bind(groupId)
    .all<Record<string, unknown>>()
    .then((r) => r.results)
    .catch(() => null);
  // Zip 57: the teams and games (a database before 0027 has neither: left out, as before).
  const day = await db
    .batch([
      db.prepare('SELECT x.* FROM tournament_teams x JOIN tournaments t ON t.id = x.tournament_id WHERE t.group_id = ? ORDER BY x.created_at, x.id').bind(groupId),
      db.prepare('SELECT g.* FROM tournament_games g JOIN tournaments t ON t.id = g.tournament_id WHERE t.group_id = ? ORDER BY g.tournament_id, g.num').bind(groupId),
    ])
    .then(([x, g]) => ({ teams: x.results as Record<string, unknown>[], games: g.results as Record<string, unknown>[] }))
    .catch(() => null);
  try {
    const [a, b, c] = await db.batch([
      db.prepare('SELECT * FROM tournaments WHERE group_id = ? ORDER BY created_at, id').bind(groupId),
      db.prepare('SELECT s.* FROM tournament_signups s JOIN tournaments t ON t.id = s.tournament_id WHERE t.group_id = ? ORDER BY s.created_at, s.id').bind(groupId),
      db.prepare('SELECT h.* FROM tournament_level_history h JOIN tournaments t ON t.id = h.tournament_id WHERE t.group_id = ? ORDER BY h.created_at, h.id').bind(groupId),
    ]);
    return {
      tournaments: a.results as Record<string, unknown>[],
      tournament_signups: b.results as Record<string, unknown>[],
      tournament_level_history: c.results as Record<string, unknown>[],
      ...(tickets ? { tournament_tickets: tickets } : {}),
      ...(day ? { tournament_teams: day.teams, tournament_games: day.games } : {}),
    };
  } catch {
    return null;
  }
}
