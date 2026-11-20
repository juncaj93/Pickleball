// Zip 57 (🎾57.tourney3), "Tournaments" piece 3: Locked doubles teams, the schedule and game day (migration 0027: tournament_teams,
// tournament_games, and tournaments.teams_at / court_numbers / paused_at). The rules are pure functions in shared/tournamentSchedule.ts and
// shared/tournamentPlan.ts; this file stores teams and results and builds what each screen sees.
//
//   The organizer: Draft teams (from the players locked in, once tickets close and only for Locked doubles with an even count), Swap, a team's
//   name, Redo the draw, Publish teams (the games are made then), the courts' numbers, a result for any game (Fix), the Time check's Apply,
//   Pause, Player left (swap in, or the team sits out), and Fix teams when a back out after publishing leaves the teams out of step.
//   A player: Enter score (Zip 72: every Locked doubles game has a score; sent after the card's 5 second Undo). The first score from any of
//   the 4 players is the result (Zip 71, no confirming); only the organizer changes it afterward.
//
// Who sees what: everything rides on the tournament view, which a player gets only while the tournament is visible to them (Only me, the switch
// and Who can see it, server/tournament.ts visibleTo). A player gets names only: their own games, the games being played now, the standings and the
// night's times. No money, no levels, no other player's phone. No money moves anywhere in this file.
import type { Ctx } from './context';
import type { D1Database } from './db';
import { HttpError } from './http';
import { newId } from './crypto';
import * as v from './validate';
import { audit } from './repo';
import { releaseKeptStatements } from './tournamentMoney';
import {
  type AdminDayGame,
  type AdminDayTeam,
  type AdminDayView,
  type AdminTieView,
  type PlayerDayGame,
  type PlayerDayView,
  type PlayerTieView,
  type PlayoffRow,
  type TournamentFormat,
  MAX_SPOTS,
  shortAlertOf,
} from '../shared/tournament';
import { firstAnswer, saidTeamScore, saidWon } from '../shared/partnerTaps';
import { about, clockLabel, type GameTo, nightPlan, PLAYOFF_TO, ROUND_MINUTES } from '../shared/tournamentPlan';
import {
  draftNote,
  draftTeams,
  type DraftPlayer,
  type GameResult,
  groupName,
  groupsOf,
  type Pair,
  type PlannedGame,
  poolsOf,
  poolSizes,
  recordLabel,
  resolveGames,
  schedule,
  slotWords,
  standings,
  TEAM_NAME_MAX,
  suggestTeamName,
  TEAM_NAMES,
  timeCheck,
  timeCheckWords,
  type RoundState,
  groupTable,
  type GroupKey,
  type TieBlock,
  tieBlocks,
  tieGames,
  type TieRecord,
  TIE_TO,
} from '../shared/tournamentSchedule';
import { startMsOf, ticketOwed } from '../shared/tournamentTickets';
import type { TicketWithName } from './tournamentMoney';
import { americanoGameAction, americanoGamesAction, readPair } from './americanoDay';
import {
  firstName,
  logPlayer,
  nightOver,
  openById,
  organizerOn,
  playerTarget,
  realTimes,
  salesClosed,
  type SignupRow,
  statusOf,
  styleDecided,
  type TournamentActor,
  type TournamentRow,
} from './tournament';

export interface TeamRow {
  id: string;
  tournament_id: string;
  seat: number;
  name: string;
  player_a: string | null;
  player_b: string | null;
  pool: string | null;
  out_at: string | null;
  changed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface GameRow {
  id: string;
  tournament_id: string;
  num: number;
  round: number;
  court: number;
  stage: string;
  pool: string | null;
  slot_a: string;
  slot_b: string;
  play_to: number;
  claim: string | null;
  claim_at: string | null;
  /** Zip 61 (Americano) and Zip 71 (Locked doubles): the player who answered for the side in `claim`. */
  claim_by?: string | null;
  disputed_at: string | null;
  winner: string | null;
  result_at: string | null;
  result_by: string | null;
  skipped: number;
  /** Zip 72 (columns from 0028): the points each side scored. Null on a result from before Zip 72 (who won only). */
  score_a?: number | null;
  score_b?: number | null;
  /** The seats in the game when it got its result (frozen), or null. */
  seat_a?: number | null;
  seat_b?: number | null;
  created_at: string;
  updated_at: string;
}

/** SQL: no other team of the tournament has this name, any case (values: the tournament id, the name, this team's id). */
const NAME_FREE = 'NOT EXISTS (SELECT 1 FROM tournament_teams o WHERE o.tournament_id = ? AND lower(o.name) = lower(?) AND o.id <> ?)';

/** A team name typed by the organizer or a player: trimmed, at most 24 letters, no hidden characters. */
function readTeamName(raw: unknown): string {
  const name = typeof raw === 'string' ? raw.trim().replace(/\s+/g, ' ') : '';
  if (!name) throw new HttpError(400, 'invalid_name', 'Type a team name.');
  if (Array.from(name).length > TEAM_NAME_MAX) throw new HttpError(400, 'invalid_name', `Keep it to ${TEAM_NAME_MAX} letters.`);
  v.text(name, 'name', { max: TEAM_NAME_MAX * 2 });
  return name;
}

/** The live view on Home starts this long before the start, and ends this long after the night's end (until piece 4's End tournament). */
export const LIVE_BEFORE_MS = 30 * 60_000;
export const LIVE_AFTER_MS = 6 * 3_600_000;

/** Zip 58 (migration 0029): a tie's stored answer (the wheel's bye and the playoff games it made, or the organizer's picks). */
export interface TieRow {
  id: string;
  tournament_id: string;
  tie_key: string;
  kind: string;
  bye_seat: number | null;
  picks: string | null;
  game_a: number | null;
  game_b: number | null;
  spun_by: string | null;
  spun_at: string | null;
  created_at: string;
  updated_at: string;
}

/** The rows of one night: the teams, the games and (Zip 58) the ties' answers. */
export interface DayRows {
  teams: TeamRow[];
  games: GameRow[];
  ties?: TieRow[];
}

/** The two reads, for a screen's batch (Zip 62: no trip of their own). `idSql`: a `?` or the screen's pick subquery. */
export const teamsSqlFor = (idSql: string) => `SELECT * FROM tournament_teams WHERE tournament_id = ${idSql} ORDER BY seat`;
export const gamesSqlFor = (idSql: string) => `SELECT * FROM tournament_games WHERE tournament_id = ${idSql} ORDER BY num`;
/** Zip 58: the ties' answers on their own (a write's fresh read: loadDay). */
export const tiesSqlFor = (idSql: string) => `SELECT * FROM tournament_ties WHERE tournament_id = ${idSql} ORDER BY created_at, id`;
/** The ties' answers read back from that column (in the order they were made); anything odd reads as none. */
export function tiesFromJson(json: unknown): TieRow[] {
  try {
    const v = typeof json === 'string' ? JSON.parse(json) : [];
    if (!Array.isArray(v)) return [];
    return v
      .filter((x): x is unknown[] => Array.isArray(x) && x.length >= 9)
      .map((x) => ({
        id: String(x[0]),
        tournament_id: '',
        tie_key: String(x[1]),
        kind: String(x[2]),
        bye_seat: typeof x[3] === 'number' ? x[3] : null,
        picks: typeof x[4] === 'string' ? x[4] : null,
        game_a: typeof x[5] === 'number' ? x[5] : null,
        game_b: typeof x[6] === 'number' ? x[6] : null,
        spun_by: null,
        spun_at: typeof x[7] === 'string' ? x[7] : null,
        created_at: String(x[8]),
        updated_at: String(x[8]),
      }))
      .sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.id < b.id ? -1 : 1));
  } catch {
    return [];
  }
}

/** Teams and games of one tournament (a database before 0027 has none: empty), and the ties' answers (none before 0029). */
export async function loadDay(db: D1Database, tournamentId: string): Promise<DayRows> {
  let day: DayRows;
  try {
    const [a, b] = await db.batch([db.prepare(teamsSqlFor('?')).bind(tournamentId), db.prepare(gamesSqlFor('?')).bind(tournamentId)]);
    day = { teams: a.results as unknown as TeamRow[], games: b.results as unknown as GameRow[] };
  } catch {
    return { teams: [], games: [], ties: [] };
  }
  const ties = await db
    .prepare(tiesSqlFor('?'))
    .bind(tournamentId)
    .all<TieRow>()
    .then((r) => r.results)
    .catch(() => [] as TieRow[]);
  return { ...day, ties };
}

/** A stored tie row as the pure rules read it. */
export function tieRecordOf(r: TieRow): TieRecord {
  let picks: number[] = [];
  try {
    const v = JSON.parse(r.picks ?? '[]');
    if (Array.isArray(v)) picks = v.filter((x) => Number.isInteger(x));
  } catch {
    picks = [];
  }
  return { key: r.tie_key, kind: r.kind === 'pick' ? 'pick' : 'wheel', bye: r.bye_seat ?? null, picks, gameA: r.game_a ?? null, gameB: r.game_b ?? null };
}

/** Play order: by round, and in a round the tie games first (they decide who plays the rest), then by number. */
const STAGE_ORDER: Record<string, number> = { pool: 0, tie: 1, semi: 2, final: 3, third: 3 };
const byPlay = (x: GameRow, y: GameRow) => x.round - y.round || (STAGE_ORDER[x.stage] ?? 2) - (STAGE_ORDER[y.stage] ?? 2) || x.num - y.num;

// ---------------------------------------------------------------------------------------------------------------------
// What the rows mean
// ---------------------------------------------------------------------------------------------------------------------

/** Zip 72: the score as the standings read it (both numbers, or none: a result from before Zip 72 is who won only). */
const scoresOf = (g: GameRow): { scoreA: number; scoreB: number } | null =>
  typeof g.score_a === 'number' && typeof g.score_b === 'number' ? { scoreA: g.score_a, scoreB: g.score_b } : null;

/**
 * The result that counts for the standings: the winner (and Zip 72's score) when one stands. A We won saved before Zip 71 that was never
 * answered counts as the result (nothing waits now); one the other team said no to before Zip 71 is the organizer's to settle.
 */
export function resultOf(g: GameRow): GameResult {
  if (g.skipped) return { num: g.num, winner: null, skipped: true };
  if (g.winner === 'a' || g.winner === 'b') return { num: g.num, winner: g.winner, ...scoresOf(g) };
  if ((g.claim === 'a' || g.claim === 'b') && !g.disputed_at) return { num: g.num, winner: g.claim, ...scoresOf(g) };
  return { num: g.num, winner: null };
}
const decided = (g: GameRow) => !!g.skipped || !!resultOf(g).winner;
const asPlanned = (g: GameRow): PlannedGame => ({
  num: g.num,
  round: g.round,
  court: g.court,
  stage: g.stage as PlannedGame['stage'],
  pool: g.pool === 'A' || g.pool === 'B' ? g.pool : null,
  a: g.slot_a,
  b: g.slot_b,
});

/** Locked in as everyone sees it (Zip 63's trust rule): a spot, or a whole-ticket I paid waiting for the organizer. Still on the list. */
export function lockedInIds(tickets: readonly TicketWithName[]): string[] {
  return tickets
    .filter(
      (k) =>
        k.signup_status === 'in' &&
        (k.place === 'spot' ||
          (k.place !== 'line' && k.claim_cents > 0 && ticketOwed({ priceCents: k.price_cents, creditCents: k.credit_cents, paidCents: k.paid_cents, claimCents: k.claim_cents }) === 0)),
    )
    .map((k) => k.player_id);
}

/** The court numbers the organizer set ([9, 10]), or null. */
export function courtNumbersOf(t: Pick<TournamentRow, 'court_numbers'>): number[] | null {
  try {
    const v = JSON.parse(t.court_numbers ?? 'null');
    return Array.isArray(v) && v.length > 0 && v.every((n) => Number.isInteger(n) && n >= 1 && n <= 99) ? v : null;
  } catch {
    return null;
  }
}
const courtsOf = (t: TournamentRow): number => (t.courts === 1 ? 1 : 2);

/** "Court 9": the venue's number for court 1 or 2 of the night, or the plain 1 and 2 until they are set. */
const courtNo = (t: TournamentRow, court: number): number => courtNumbersOf(t)?.[court - 1] ?? court;

/** Minutes after midnight (Eastern, the tournament's day) of a moment. */
function minuteOf(t: TournamentRow, tz: string, ms: number): number {
  const r = realTimes(t);
  return r.start + (ms - startMsOf(t.final_date!, r.start, tz)) / 60_000;
}

/** Everything the screens need, worked out once from the rows. */
interface DayFacts {
  teams: TeamRow[];
  /** The night's games in play order (Zip 58: with only the tie games of ties that still stand). */
  games: GameRow[];
  /** Zip 58: the ties that matter (settled or not), and their stored answers. */
  blocks: TieBlock[];
  records: TieRecord[];
  /** Zip 58: tie game number -> 'Game A' / 'Game B'. */
  tieLabel: Map<number, string>;
  /** Zip 58: when each tie's wheel was spun (by key). */
  spunAt: Map<string, string>;
  bySeat: Map<number, TeamRow>;
  /** Teams that left at any point of the night (they never play again). */
  gone: Set<number>;
  results: Map<number, GameResult>;
  resolved: Map<number, { a: number | null; b: number | null; tied: boolean }>;
  out: Set<number>;
  plan: ReturnType<typeof nightPlan>;
  anyResult: boolean;
  started: boolean;
  over: boolean;
  check: ReturnType<typeof timeCheck> | null;
  /** Shorter games in force for rounds not played yet: from which round, to what. */
  shorter: { fromRound: number; to: GameTo } | null;
  start: number;
  end: number;
}

function facts(t: TournamentRow, teams: TeamRow[], all: GameRow[], tz: string, nowMs: number, tieRows: readonly TieRow[] = []): DayFacts {
  const bySeat = new Map(teams.map((x) => [x.seat, x]));
  // Teams that left: all of them never play again (`gone`); the ones that left during pool play (a pool game of theirs skipped) also drop below
  // every team still playing (`out`). A team that left after its pool was done keeps its place, and a playoff it cannot play is a walkover.
  const gone = new Set(teams.filter((x) => x.out_at).map((x) => x.seat));
  const out = new Set([...gone].filter((seat) => all.some((g) => g.stage === 'pool' && g.skipped && (g.slot_a === `T${seat}` || g.slot_b === `T${seat}`))));
  // Zip 58: the ties' answers. A tie game belongs to an answer; it is part of the night only while that tie still stands (a pool result fixed
  // after the wheel spun can end the tie, or make another one: its games are then set aside, kept, and come back if the tie does).
  const records = tieRows.map(tieRecordOf);
  // (Admin speed rule: with no tie game stored, nothing to set aside: the first pass is skipped.)
  const standing = all.some((g) => g.stage === 'tie') ? tieBlocks(teams.length, all.map(asPlanned), new Map(all.map((g) => [g.num, resultOf(g)])), out, records, gone) : [];
  const liveTieGames = new Set(standing.flatMap((b) => (b.record ? [b.record.gameA, b.record.gameB] : [])).filter((n): n is number => n !== null));
  const stored = all.filter((g) => g.stage !== 'tie' || liveTieGames.has(g.num)).sort(byPlay);
  const tieLabel = new Map<number, string>();
  for (const b of standing) {
    if (b.record?.gameA != null) tieLabel.set(b.record.gameA, 'Game A');
    if (b.record?.gameB != null) tieLabel.set(b.record.gameB, 'Game B');
  }
  // A game that got a result keeps the teams it had then (a later change to an earlier game never moves it to other teams).
  const frozen = new Map(stored.filter((g) => g.seat_a != null || g.seat_b != null).map((g) => [g.num, { a: g.seat_a ?? null, b: g.seat_b ?? null }]));
  const resolve = (list: GameRow[]) =>
    new Map(resolveGames(teams.length, list.map(asPlanned), new Map(list.map((g) => [g.num, resultOf(g)])), out, frozen, gone, records).map((r) => [r.num, r]));
  // A playoff game one side of which can never be filled is not played (counted as skipped): the team there goes on (a walkover).
  const first = resolve(stored);
  const games = stored.map((g) => (first.get(g.num)?.never && !g.winner && !g.skipped ? { ...g, skipped: 1, claim: null, result_by: 'skipped' } : g));
  const results = new Map(games.map((g) => [g.num, resultOf(g)]));
  const resolved = resolve(games);
  const blocks = tieBlocks(teams.length, games.map(asPlanned), results, out, records, gone);
  const real = realTimes(t);
  const plan = nightPlan(teams.length * 2, courtsOf(t), real.minutes, 'doubles');
  const startMs = t.final_date ? startMsOf(t.final_date, real.start, tz) : Infinity;
  const started = nowMs >= startMs;
  const over = nightOver(t, tz, nowMs);
  const anyResult = stored.some((g) => !!g.winner || !!g.claim || !!g.skipped);
  // The Time check, from the rounds as they are.
  const rounds = new Map<number, GameRow[]>();
  for (const g of games) rounds.set(g.round, [...(rounds.get(g.round) ?? []), g]);
  const states: RoundState[] = [...rounds.entries()].map(([round, list]) => {
    const times = list.map((g) => g.result_at ?? g.claim_at).filter((x): x is string => !!x);
    return {
      round,
      pool: list.every((g) => g.stage === 'pool'),
      playTo: Math.max(...list.map((g) => g.play_to)) as GameTo,
      done: list.every(decided),
      anyResult: list.some((g) => !!g.winner || !!g.claim || (!!g.skipped && g.result_by !== null)),
      doneAt: list.every(decided) && times.length ? minuteOf(t, tz, Math.max(...times.map((x) => Date.parse(x)))) : undefined,
    };
  });
  const check = started && !over && !t.paused_at && games.length && t.final_date ? timeCheck(states, real.start, real.start + real.minutes, minuteOf(t, tz, nowMs)) : null;
  const lowered = games.filter((g) => g.stage === 'pool' && !decided(g) && g.play_to < plan.gameTo);
  const shorter = lowered.length ? { fromRound: Math.min(...lowered.map((g) => g.round)), to: Math.min(...lowered.map((g) => g.play_to)) as GameTo } : null;
  const spunAt = new Map(tieRows.filter((r) => r.spun_at).map((r) => [r.tie_key, r.spun_at!]));
  return { teams, games, blocks, records, tieLabel, spunAt, bySeat, gone, results, resolved, out, plan, anyResult, started, over, check, shorter, start: real.start, end: real.start + real.minutes };
}

/** "1st of the Dink group", "2nd", "Winner of game 9". */
function slotName(slot: string): string {
  const k = slot[0];
  const n = Number(slot.slice(1));
  const nth = n === 1 ? '1st' : n === 2 ? '2nd' : n === 3 ? '3rd' : `${n}th`;
  if (k === 'A' || k === 'B') return `${nth} of the ${groupName(k)}`;
  if (k === 'P') return nth;
  if (k === 'W') return `Winner of game ${n}`;
  if (k === 'L') return `Loser of game ${n}`;
  return slot;
}

/** Zip 58: a team as every screen names it (its name and its two players). */
function sideFor(f: DayFacts, names: ReadonlyMap<string, string>, seat: number): { name: string; players: string[] } {
  const x = f.bySeat.get(seat);
  return { name: x?.name ?? `Team ${seat}`, players: x ? [x.player_a, x.player_b].filter((id): id is string => !!id).map((id) => names.get(id) ?? 'A player') : [] };
}

/**
 * Zip 58: the Playoff card (picture 21) for a tie the wheel has spun: Game A, Game B, then every playoff game the tie feeds, each side named by
 * its team or by what decides it ("Winner of B", "Losers of A and B").
 */
function playoffRows(t: TournamentRow, f: DayFacts, names: ReadonlyMap<string, string>, b: TieBlock): PlayoffRow[] {
  const rec = b.record;
  if (!rec || rec.bye === null || rec.gameA === null) return [];
  const side = (seat: number) => sideFor(f, names, seat);
  const tieGamesHere = [rec.gameA, rec.gameB].map((n) => (n === null ? undefined : f.games.find((g) => g.num === n))).filter((g): g is GameRow => !!g);
  const open = tieGamesHere.find((g) => !decided(g));
  const rows: PlayoffRow[] = [];
  for (const g of tieGamesHere) {
    const r = f.resolved.get(g.num);
    const isA = g.num === rec.gameA;
    const a = r?.a ? side(r.a).name : isA ? 'A team' : 'Winner of A';
    const bb = r?.b ? side(r.b).name : side(rec.bye).name;
    rows.push({ label: isA ? 'Game A' : 'Game B', court: courtNo(t, g.court), title: `${a} vs ${bb}`, sub: `To ${g.play_to}. Loser is out.`, state: decided(g) ? 'done' : g === open ? 'next' : 'later' });
  }
  const places = b.seats.map((_, i) => b.from + i);
  const words = (pos: number) => (b.shape === 'a' ? [side(rec.bye!).name, 'Winner of A', 'Loser of A'] : ['Winner of B', 'Loser of B', 'Loser of A'])[pos];
  const fromTie = (slot: string) => (slot[0] === b.group && places.includes(Number(slot.slice(1))) ? Number(slot.slice(1)) - b.from : null);
  const finalRound = f.games.find((g) => g.stage === 'final')?.round ?? null;
  for (const g of f.games) {
    if (g.stage === 'pool' || g.stage === 'tie') continue;
    const pa = fromTie(g.slot_a);
    const pb = fromTie(g.slot_b);
    if (pa === null && pb === null) continue;
    const r = f.resolved.get(g.num);
    const na = r?.a ? side(r.a).name : pa !== null ? words(pa) : slotName(g.slot_a);
    const nb = r?.b ? side(r.b).name : pb !== null ? words(pb) : slotName(g.slot_b);
    const losers = [na, nb].sort().join('|') === 'Loser of A|Loser of B';
    const title = losers ? 'Losers of A and B' : pa !== null ? `${na} vs ${nb}` : `${nb} vs ${na}`;
    const sub = g.stage === 'third' && finalRound === g.round ? 'Same time as the final' : `To ${g.play_to}`;
    rows.push({ label: stageLabel(g.stage), court: courtNo(t, g.court), title, sub, state: decided(g) ? 'done' : 'later' });
  }
  return rows;
}

/** The players' and the organizer's Time check words while shorter games are in force (and how far behind it is now). */
function shorterNote(f: DayFacts): string | undefined {
  if (!f.shorter) return undefined;
  return timeCheckWords(f.check?.behind ?? 0, f.shorter.fromRound, f.shorter.to, clockLabel(f.end));
}

// ---------------------------------------------------------------------------------------------------------------------
// The organizer's view
// ---------------------------------------------------------------------------------------------------------------------

export function adminDayView(
  t: TournamentRow,
  format: TournamentFormat,
  signups: readonly SignupRow[],
  tickets: readonly TicketWithName[],
  rows: DayRows,
  tz: string,
  nowMs: number,
): AdminDayView {
  const locked = lockedInIds(tickets as TicketWithName[]);
  const names = new Map<string, string>();
  for (const s of signups) names.set(s.player_id, s.display_name);
  for (const k of tickets) names.set(k.player_id, k.display_name);
  const levels = new Map(signups.map((s) => [s.player_id, s.approved_level ?? s.picked_level]));
  const f = facts(t, rows.teams, rows.games, tz, nowMs, rows.ties ?? []);
  const phase: AdminDayView['phase'] = rows.teams.length === 0 ? 'none' : t.teams_at ? 'published' : 'draft';
  const why =
    format !== 'doubles'
      ? 'Americano night: no teams.'
      : statusOf(t) !== 'tickets' || !t.final_date
        ? 'Teams come after the date is finalized.'
        : !styleDecided(t, nowMs)
          ? 'Draft teams opens when tickets close (Pay by).'
          : f.over
            ? 'The night is over.'
            : locked.length < 6
              ? `Needs at least 6 locked in. ${locked.length} are.`
              : // Zip 74: never more than 16 (the cap); an older row past it gets a plain answer, never a crash.
                locked.length > MAX_SPOTS
                ? `${locked.length} are locked in. Take ${locked.length - MAX_SPOTS} off first (16 at most).`
              : locked.length % 2 === 1
                ? `Needs an even number locked in. ${locked.length} are.`
                : f.anyResult
                  ? 'Games have started.'
                  : undefined;
  const onTeam = new Set(rows.teams.flatMap((x) => [x.player_a, x.player_b]).filter((x): x is string => !!x));
  const lockedSet = new Set(locked);
  const teams: AdminDayTeam[] = rows.teams.map((x) => {
    const ps = [x.player_a, x.player_b].map((id) => ({
      id,
      name: id ? (names.get(id) ?? 'A player') : 'Empty',
      level: id ? (levels.get(id) ?? 300) : 0,
      ...(id && !lockedSet.has(id) ? { gone: true as const } : {}),
    }));
    return { id: x.id, seat: x.seat, name: x.name, players: ps, total: ps[0].level + ps[1].level, pool: x.pool === 'A' || x.pool === 'B' ? x.pool : null, out: !!x.out_at };
  });
  const games: AdminDayGame[] = f.games.map((g) => {
    const r = f.resolved.get(g.num);
    const side = (seat: number | null | undefined) => {
      const x = seat ? f.bySeat.get(seat) : undefined;
      return seat ? { seat, name: x?.name ?? `Team ${seat}`, players: x ? [x.player_a, x.player_b].filter((id): id is string => !!id).map((id) => names.get(id) ?? 'A player') : [] } : null;
    };
    return {
      num: g.num,
      round: g.round,
      court: g.court,
      courtNumber: courtNumbersOf(t)?.[g.court - 1] ?? null,
      stage: g.stage as AdminDayGame['stage'],
      pool: g.pool === 'A' || g.pool === 'B' ? g.pool : null,
      a: side(r?.a),
      b: side(r?.b),
      ...(r?.a ? {} : { waitA: r?.tied ? 'Tied' : slotName(g.slot_a) }),
      ...(r?.b ? {} : { waitB: r?.tied ? 'Tied' : slotName(g.slot_b) }),
      playTo: g.play_to,
      // Zip 71/72: no answer waits. The result is the winner (an unanswered We won from before Zip 71 counts as one), with its score.
      winner: f.results.get(g.num)?.winner ?? null,
      scoreA: typeof g.score_a === 'number' && !g.skipped ? g.score_a : null,
      scoreB: typeof g.score_b === 'number' && !g.skipped ? g.score_b : null,
      skipped: !!g.skipped,
      resultBy: g.result_by,
      ...(g.claim_by && g.result_by === 'players' ? { by: names.get(g.claim_by) ?? 'A player' } : {}),
      ...(f.tieLabel.get(g.num) ? { tieLabel: f.tieLabel.get(g.num) } : {}),
    };
  });
  // Zip 58: the ties still being settled (the wheel not spun, its games still being played, or the organizer's picks).
  const ties: AdminTieView[] = f.blocks
    .filter((b) => !b.order)
    .map((b) => {
      const side = (seat: number) => sideFor(f, names, seat);
      const picks = b.record?.kind === 'pick' ? b.record.picks.filter((x) => b.seats.includes(x)) : [];
      return {
        key: b.key,
        mode: b.mode,
        target: b.target,
        pool: b.pool,
        teams: b.seats.map((seat) => ({ seat, ...side(seat) })),
        spinner: b.spinner ? side(b.spinner) : null,
        ...(b.record?.bye != null ? { bye: { seat: b.record.bye, index: b.seats.indexOf(b.record.bye), ...side(b.record.bye) } } : {}),
        ...(f.spunAt.get(b.key) ? { spunAt: f.spunAt.get(b.key) } : {}),
        needPicks: b.needPicks,
        picked: picks.map((x) => side(x).name),
        picks,
      };
    });
  // After publishing, before any result: the teams no longer match the players locked in (a back out, a late join).
  const gone = teams.flatMap((x) => x.players.filter((p) => p.gone && p.id).map((p) => p.name));
  const spare = locked.filter((id) => !onTeam.has(id)).map((id) => names.get(id) ?? 'A player');
  const fix =
    phase === 'published' && !f.anyResult && !f.over && format === 'doubles' && (gone.length || spare.length)
      ? {
          gone,
          spare,
          text: [gone.length ? `${list(gone)} ${gone.length === 1 ? 'is' : 'are'} not locked in now.` : '', spare.length ? `${list(spare)} ${spare.length === 1 ? 'is' : 'are'} on no team.` : '']
            .filter(Boolean)
            .join(' '),
        }
      : null;
  // Swap in candidates for Player left: locked in but on no team, then paid standby.
  const spares = [
    ...locked.filter((id) => !onTeam.has(id)).map((id) => ({ id, name: names.get(id) ?? 'A player', standby: false })),
    ...tickets
      .filter((k) => k.signup_status === 'in' && k.place === 'line' && k.credit_cents + k.paid_cents >= k.price_cents && !onTeam.has(k.player_id))
      .map((k) => ({ id: k.player_id, name: k.display_name, standby: true })),
  ];
  const sug = f.check?.suggest ?? null;
  return {
    phase,
    canDraft: !why && phase !== 'published',
    ...(why ? { why } : {}),
    lockedIn: locked.length,
    teams,
    courtNumbers: courtNumbersOf(t),
    courts: courtsOf(t),
    games,
    plan: rows.teams.length ? { gameTo: f.plan.gameTo, rounds: f.plan.rounds, fits: f.plan.fits, minutesUsed: f.plan.minutesUsed } : null,
    round: f.check?.current ?? null,
    anyResult: f.anyResult,
    started: f.started,
    over: f.over,
    paused: !!t.paused_at,
    timeCheck: sug
      ? { text: timeCheckWords(f.check!.behind, sug.fromRound, sug.to, clockLabel(f.end), sug.stillOver), fromRound: sug.fromRound, to: sug.to, key: `tc:${t.id}:${sug.fromRound}:${sug.to}` }
      : null,
    ...(shorterNote(f) ? { timeNote: shorterNote(f) } : {}),
    fix,
    spares,
    ...(ties.length ? { ties } : {}),
  };
}

const list = (names: string[]) => (names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`);

// ---------------------------------------------------------------------------------------------------------------------
// A player's view
// ---------------------------------------------------------------------------------------------------------------------

/** "Game 1", "Semifinal", "Final", "3rd place". */
const stageLabel = (stage: string) => (stage === 'semi' ? 'Semifinal' : stage === 'final' ? 'Final' : stage === 'third' ? '3rd place' : 'Game');

export function playerDayView(
  t: TournamentRow,
  signups: readonly SignupRow[],
  rows: DayRows,
  playerId: string,
  tz: string,
  nowMs: number,
): PlayerDayView {
  const names = new Map(signups.map((s) => [s.player_id, s.display_name]));
  const f = facts(t, rows.teams, rows.games, tz, nowMs, rows.ties ?? []);
  const playersOf = (x: TeamRow) => [x.player_a, x.player_b].filter((id): id is string => !!id).map((id) => names.get(id) ?? 'A player');
  const mine = rows.teams.find((x) => x.player_a === playerId || x.player_b === playerId) ?? null;
  const seat = mine?.seat ?? null;
  const pools = !!poolSizes(rows.teams.length);
  const real = realTimes(t);
  // The live window (Alex's PM): from 30 minutes before the start until the tournament is over (piece 4's End tournament; until then, 6 hours
  // after the night's end, so the morning after Home is back to normal).
  const startMs = t.final_date ? startMsOf(t.final_date, real.start, tz) : Infinity;
  const today = nowMs >= startMs - LIVE_BEFORE_MS && nowMs < startMs + real.minutes * 60_000 + LIVE_AFTER_MS;
  // My games: the ones I am in (decided or not), then the playoff game I may still reach.
  const games: PlayerDayGame[] = [];
  let poolNo = 0;
  const sideOf = (g: GameRow): 'a' | 'b' | null => {
    const r = f.resolved.get(g.num);
    return r?.a === seat ? 'a' : r?.b === seat ? 'b' : null;
  };
  let firstOpen = true;
  // The round being played: the first with a game still to play.
  const roundNow = Math.min(f.check?.current ?? Infinity, ...f.games.filter((g) => !decided(g)).map((g) => g.round));
  for (const g of f.games) {
    if (seat === null) break;
    const side = sideOf(g);
    if (!side) continue;
    const r = f.resolved.get(g.num)!;
    const other = side === 'a' ? r.b : r.a;
    const res = f.results.get(g.num)!;
    const done = !!res.skipped || !!res.winner;
    const opp = other ? f.bySeat.get(other) : null;
    const entry: PlayerDayGame = {
      num: g.num,
      label: g.stage === 'pool' ? `Game ${++poolNo}` : g.stage === 'tie' ? (f.tieLabel.get(g.num) ?? 'Playoff') : stageLabel(g.stage),
      stage: g.stage as PlayerDayGame['stage'],
      round: g.round,
      court: courtNo(t, g.court),
      opponent: opp ? { name: opp.name, players: playersOf(opp) } : null,
      ...(opp ? {} : { pending: r.tied ? 'Decided by the tie' : 'Not decided yet' }),
      state: done ? 'done' : firstOpen ? 'next' : 'later',
      ...(done && res.winner ? { won: res.winner === side } : {}),
      // Zip 72: the score from their side (mine first): "Won 11–7", "Lost 7–11".
      ...(done && res.winner && typeof res.scoreA === 'number' && typeof res.scoreB === 'number'
        ? { score: side === 'a' ? { mine: res.scoreA, theirs: res.scoreB } : { mine: res.scoreB, theirs: res.scoreA } }
        : {}),
      playTo: g.play_to,
      ...(g.skipped ? { skipped: true as const } : {}),
      // Zip 58: a tie game is played as soon as both its teams are known (a pool can be done while the other still plays).
      // Zip 71: an old disputed game (from before no confirming) is the organizer's to settle: no buttons on it.
      ...(!done && opp && f.started && !g.disputed_at && (g.round <= roundNow || g.stage === 'tie') ? { onNow: true as const } : {}),
    };
    if (!done) firstOpen = false;
    games.push(entry);
  }
  // The playoff they may still reach, while it is not decided (mock 16: "Final · If you finish in the top 2 · Against the other finalist").
  if (seat !== null && !f.out.has(seat)) {
    const myPool = mine?.pool === 'A' || mine?.pool === 'B' ? (mine.pool as 'A' | 'B') : null;
    const playoff = f.games.filter((g) => g.stage !== 'pool');
    const inSemi = playoff.some((g) => g.stage === 'semi' && sideOf(g));
    const semisOpen = playoff.filter((g) => g.stage === 'semi').some((g) => !f.resolved.get(g.num)?.a || !f.resolved.get(g.num)?.b);
    const fin = playoff.find((g) => g.stage === 'final');
    const finOpen = !!fin && (!f.resolved.get(fin.num)?.a || !f.resolved.get(fin.num)?.b);
    const add = (stage: 'semi' | 'final', pending: string, g?: GameRow) =>
      games.push({ num: g?.num ?? 0, label: stageLabel(stage), stage, round: g?.round ?? 0, court: null, opponent: null, pending, state: firstOpen ? 'next' : 'later', playTo: PLAYOFF_TO });
    const poolSeats = groupsOf(rows.teams.length).find((x) => x.seats.includes(seat))?.seats ?? [];
    const stillIn = () => {
      // Out of reach once the group is done and they finished below the places that go on.
      const st = standings(f.games.map(asPlanned), f.results, poolSeats, f.out);
      const done = f.games.filter((g) => g.stage === 'pool' && poolSeats.includes(Number(g.slot_a.slice(1)))).every(decided);
      return !done || (st.find((x) => x.seat === seat)?.rank ?? 99) <= 2 || st.some((x) => x.tied && x.seat === seat);
    };
    if (pools) {
      if (semisOpen && !inSemi && stillIn()) {
        add('semi', slotWords('semi', myPool), playoff.find((g) => g.stage === 'semi'));
        add('final', 'If you win your semifinal', fin);
      } else if (inSemi && finOpen) add('final', 'If you win your semifinal', fin);
    } else if (fin && finOpen && stillIn()) add('final', slotWords('final', null), fin);
  }
  // The header: "Game 2 of 3" (or "Pool play · Round 1 of 3" with pools), "Semifinal", "Final", "Done".
  const poolGames = games.filter((g) => g.stage === 'pool');
  const poolDone = poolGames.filter((g) => g.state === 'done').length;
  const poolRounds = Math.max(0, ...f.games.filter((g) => g.stage === 'pool').map((g) => g.round));
  const next = games.find((g) => g.state === 'next');
  let label: string;
  let done = poolDone;
  let total = Math.max(1, poolGames.length);
  if (pools && Number.isFinite(roundNow) && roundNow <= poolRounds) {
    label = `Group play · Round ${roundNow} of ${poolRounds}`;
    done = roundNow - 1;
    total = poolRounds;
  } else if (next && next.stage === 'pool') label = `${next.label} of ${poolGames.length}`;
  else if (next) label = next.label;
  else label = seat === null ? 'Teams' : 'Done';
  // Games being played now that are not theirs.
  const live = f.games
    .filter((g) => f.started && !decided(g) && Number.isFinite(roundNow) && g.round === roundNow && !sideOf(g))
    .map((g) => {
      const r = f.resolved.get(g.num)!;
      const team = (seat: number) => ({ name: f.bySeat.get(seat)!.name, players: playersOf(f.bySeat.get(seat)!) });
      // Zip 70 (dry run fix 6): a playoff game is named for what it is ("Final", "3rd place", "Semifinal", "Game A"), a pool game by its round.
      const label = g.stage === 'pool' ? `Round ${g.round}` : g.stage === 'tie' ? (f.tieLabel.get(g.num) ?? 'Playoff') : stageLabel(g.stage);
      return r.a && r.b ? { round: g.round, label, court: courtNo(t, g.court), a: team(r.a), b: team(r.b) } : null;
    })
    .filter((x): x is NonNullable<typeof x> => !!x);
  // Zip 58: a tie for a playoff place still being settled (this player's group first), and who is already through while it is.
  const pendingTies = f.blocks.filter((b) => !b.order);
  const myGroup: GroupKey | null = mine ? (mine.pool === 'A' || mine.pool === 'B' ? mine.pool : 'P') : null;
  const blk = pendingTies.find((b) => b.group === myGroup) ?? pendingTies[0] ?? null;
  const through = new Map<number, 'final' | 'semi'>();
  if (blk) {
    for (const g of f.games) {
      if (g.stage !== 'final' && g.stage !== 'semi') continue;
      const r = f.resolved.get(g.num);
      for (const x of [r?.a, r?.b]) if (x && !through.has(x)) through.set(x, g.stage);
    }
  }
  const side = (x: number) => sideFor(f, names, x);
  let tie: PlayerTieView | undefined;
  let playoff: PlayoffRow[] | undefined;
  if (blk) {
    const spun = blk.mode === 'wheel' && blk.record?.bye != null;
    tie = {
      key: blk.key,
      state: blk.mode === 'pick' ? 'pick' : spun ? 'playoff' : 'spin',
      target: blk.target,
      teams: blk.seats.map(side),
      spinner: blk.spinner ? side(blk.spinner) : null,
      ...(blk.spinner !== null && seat === blk.spinner && !spun && mine && !mine.out_at ? { canSpin: true as const } : {}),
      ...(spun ? { bye: { ...side(blk.record!.bye!), index: blk.seats.indexOf(blk.record!.bye!) } } : {}),
      ...(spun && f.spunAt.get(blk.key) ? { spunAt: f.spunAt.get(blk.key) } : {}),
    };
    if (spun) playoff = playoffRows(t, f, names, blk);
  }
  // Zip 58 (picture 22): the other game being played beside this player's Final (the 3rd place game, both teams known).
  const nextMine = games.find((g) => g.state === 'next');
  const third = f.games.find((g) => g.stage === 'third' && !decided(g));
  const thirdR = third ? f.resolved.get(third.num) : undefined;
  const alsoNow = nextMine?.stage === 'final' && nextMine.opponent && third && thirdR?.a && thirdR?.b ? { label: '3rd place', court: courtNo(t, third.court), a: side(thirdR.a), b: side(thirdR.b) } : undefined;
  // Standings: THE TIE RULE (shared/tournamentSchedule.ts standings); with pools, where each team plays the round now (or round 1 before the
  // night). Zip 72: once any pool game has a score, each row has its point difference chip ("+4 pts"), which takes the place of "where".
  const showRound = Number.isFinite(roundNow) ? roundNow : 1;
  const planned = f.games.map(asPlanned);
  const scored = f.games.some((g) => g.stage === 'pool' && !g.skipped && !!scoresOf(g) && !!f.results.get(g.num)?.winner);
  const standingsOut = groupsOf(rows.teams.length).map((grp) => ({
    pool: grp.pool,
    rows: groupTable(rows.teams.length, planned, f.results, f.out, f.records, (grp.pool ?? 'P') as GroupKey, f.gone).rows.map((r) => {
      const x = f.bySeat.get(r.seat)!;
      const here = f.games.find((g) => g.round === showRound && g.stage === 'pool' && (g.slot_a === `T${r.seat}` || g.slot_b === `T${r.seat}`));
      return {
        rank: r.rank,
        name: x.name,
        players: playersOf(x),
        record: recordLabel(r),
        ...(scored ? { diff: r.diff } : {}),
        ...(r.seat === seat ? { me: true as const } : {}),
        ...(r.tied ? { tied: true as const } : {}),
        ...(x.out_at ? { out: true as const } : {}),
        ...(pools && showRound <= poolRounds && !scored ? { where: here ? `Court ${courtNo(t, here.court)}` : 'Sits' } : {}),
        ...(through.get(r.seat) ? { through: through.get(r.seat) } : {}),
      };
    }),
  }));
  // The night's times (pools): pool play, the semifinals, the Final and 3rd place, from the real start and each round's length now.
  const night: { label: string; time: string }[] = [];
  if (pools) {
    const byRound = new Map<number, GameRow[]>();
    for (const g of f.games) byRound.set(g.round, [...(byRound.get(g.round) ?? []), g]);
    let at = real.start;
    let semiAt: number | null = null;
    let finalAt: number | null = null;
    for (const [round, list] of [...byRound.entries()].sort((a, b) => a[0] - b[0])) {
      if (list.some((g) => g.stage === 'semi') && semiAt === null) semiAt = at;
      if (list.some((g) => g.stage === 'final') && finalAt === null) finalAt = at;
      at += list.every((g) => g.stage === 'pool') ? ROUND_MINUTES[Math.max(...list.map((g) => g.play_to)) as GameTo] : ROUND_MINUTES[PLAYOFF_TO];
      void round;
    }
    night.push({ label: `Group play · ${poolRounds} rounds`, time: clockLabel(real.start) });
    if (semiAt !== null) night.push({ label: 'Semifinals', time: clockLabel(about(semiAt)) });
    if (finalAt !== null) night.push({ label: f.games.some((g) => g.stage === 'third') ? 'Final and 3rd place' : 'Final', time: clockLabel(about(finalAt)) });
  }
  const note = shorterNote(f);
  // Zip 74 (pictures pair-3 and pair-5): the night's two alerts at the top of a player's Home, the night only.
  const shortAlert = today && f.started && !f.over ? shortAlertOf(t.id, f.games.map((g) => ({ round: g.round, playTo: g.play_to, pool: g.stage === 'pool', decided: decided(g) })), f.plan.gameTo) : undefined;
  const finGame = f.games.find((g) => g.stage === 'final');
  const finR = finGame ? f.resolved.get(finGame.num) : undefined;
  const finalAlert =
    today && !f.over && seat !== null && mine && !mine.out_at && finGame && finR?.a && finR?.b && (finR.a === seat || finR.b === seat) && !decided(finGame)
      ? { key: `final:${t.id}:${finGame.num}:${finR.a}-${finR.b}`, title: `You’re in the Final! It goes to ${PLAYOFF_TO} points.`, sub: `Head to Court ${courtNo(t, finGame.court)}.` }
      : undefined;
  // Zip 58: while a tie is settled the bar says so (picture 20: "Tied for the final"; picture 21: "Playoff").
  if (tie && today) {
    label = tie.state === 'playoff' ? 'Playoff' : tie.target === 'semi' ? 'Tied for the semifinals' : tie.target === 'third' ? 'Tied for 3rd place' : 'Tied for the final';
  }
  return {
    // Either partner can rename their team until Game 1 starts (then the pencil and the dice disappear).
    team: mine ? { name: mine.name, players: playersOf(mine), seat: mine.seat, ...(!f.started && !mine.out_at ? { canRename: true as const } : {}) } : null,
    teams: rows.teams.map((x) => ({ name: x.name, players: playersOf(x), ...(x.seat === seat ? { me: true as const } : {}), ...(x.out_at ? { out: true as const } : {}) })),
    pools,
    games,
    started: f.started,
    today,
    beginsAt: clockLabel(real.start),
    courtsSet: !!courtNumbersOf(t),
    progress: { label, done, total },
    live,
    standings: standingsOut,
    night,
    ...(note ? { timeNote: note } : {}),
    ...(shortAlert ? { shortAlert } : {}),
    ...(finalAlert ? { finalAlert } : {}),
    ...(t.paused_at ? { paused: true as const } : {}),
    ...(tie ? { tie } : {}),
    ...(playoff && playoff.length ? { playoff } : {}),
    ...(alsoNow ? { alsoNow } : {}),
    ...(mine && mine.changed_at && t.teams_at
      ? {
          partnerNote: {
            key: `partner:${mine.id}:${mine.changed_at}:${playerId}`,
            text: `Your new partner is ${playersOf(mine).find((n) => n !== names.get(playerId)) ?? 'on your card'}.`,
          },
        }
      : {}),
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// The organizer's taps
// ---------------------------------------------------------------------------------------------------------------------

/** The tournament, its sign-ups, tickets, teams and games, read fresh for a write. */
async function readAll(ctx: Ctx, t: TournamentRow) {
  const db = ctx.db;
  const [s, k] = await db.batch([
    db.prepare(`SELECT s.*, p.display_name, p.is_active, NULL AS first_level FROM tournament_signups s JOIN players p ON p.id = s.player_id WHERE s.tournament_id = ? ORDER BY s.joined_at, s.rowid`).bind(t.id),
    db
      .prepare(
        `SELECT k.*, p.display_name, COALESCE(s.status, 'out') AS signup_status FROM tournament_tickets k JOIN players p ON p.id = k.player_id
         LEFT JOIN tournament_signups s ON s.tournament_id = k.tournament_id AND s.player_id = k.player_id WHERE k.tournament_id = ? ORDER BY k.place_at, k.rowid`,
      )
      .bind(t.id),
  ]);
  // A database before 0027 has no teams table: say so plainly (the organizer screens then offer nothing that writes).
  const ready = await db.prepare("SELECT 1 AS x FROM sqlite_master WHERE type = 'table' AND name = 'tournament_games'").first().catch(() => null);
  if (!ready) throw new HttpError(409, 'tournaments_not_ready', 'Teams are not set up on this site yet.');
  const day = await loadDay(db, t.id);
  return { signups: s.results as unknown as SignupRow[], tickets: k.results as unknown as TicketWithName[], ...day };
}

/** The style as the screens show it (an odd count after Pay by plays Americano). */
function shownFormat(t: TournamentRow, tickets: readonly TicketWithName[], nowMs: number, tz: string): TournamentFormat {
  const f: TournamentFormat = t.format === 'americano' ? 'americano' : 'doubles';
  if (styleDecided(t, nowMs) && !salesClosed(t, tz, nowMs) && lockedInIds(tickets as TicketWithName[]).length % 2 === 1) return 'americano';
  return f;
}

const bad = (code: string, message: string): never => {
  throw new HttpError(409, code, message);
};

/** Rows to write for a set of teams (seat order) and their games. Guarded by `when` (SQL that must hold when the batch lands). */
export function writeTeamsAndGames(
  db: D1Database,
  t: TournamentRow,
  teams: { id: string; name: string; a: string | null; b: string | null; pool: string | null; changed: boolean; out: string | null; keepChanged?: string | null }[],
  games: PlannedGame[] | null,
  playTo: GameTo,
  nowIso: string,
  when: string,
  whenValues: unknown[],
) {
  const out = [
    db.prepare(`DELETE FROM tournament_games WHERE tournament_id = ? AND ${when}`).bind(t.id, ...whenValues),
    db.prepare(`DELETE FROM tournament_teams WHERE tournament_id = ? AND ${when}`).bind(t.id, ...whenValues),
    ...teams.map((x, i) =>
      db
        .prepare(
          `INSERT INTO tournament_teams (id, tournament_id, seat, name, player_a, player_b, pool, out_at, changed_at, created_at, updated_at)
           SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE ${when}`,
        )
        .bind(x.id, t.id, i + 1, x.name, x.a, x.b, x.pool, x.out, x.changed ? nowIso : (x.keepChanged ?? null), nowIso, nowIso, ...whenValues),
    ),
    ...(games ?? []).map((g) =>
      db
        .prepare(
          `INSERT INTO tournament_games (id, tournament_id, num, round, court, stage, pool, slot_a, slot_b, play_to, skipped, created_at, updated_at)
           SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ? WHERE ${when}`,
        )
        .bind(newId(), t.id, g.num, g.round, g.court, g.stage, g.pool, g.a, g.b, g.stage === 'pool' ? playTo : PLAYOFF_TO, nowIso, nowIso, ...whenValues),
    ),
  ];
  return out;
}

/** The games of a set of teams (seats 1..n): the schedule and the plan's game length for this night's courts and hours. */
export function gamesFor(t: TournamentRow, teamCount: number): { games: PlannedGame[]; playTo: GameTo } {
  const plan = nightPlan(teamCount * 2, courtsOf(t), realTimes(t).minutes, 'doubles');
  return { games: schedule(teamCount, courtsOf(t)), playTo: plan.gameTo };
}

/** Teams in pool order with their pools (6 teams and more): Pool A first. */
function withPools<T extends { total: number }>(teams: T[]): (T & { pool: 'A' | 'B' | null })[] {
  if (!poolSizes(teams.length)) return teams.map((x) => ({ ...x, pool: null }));
  const pools = poolsOf(teams.map((x) => x.total));
  const tagged = teams.map((x, i) => ({ ...x, pool: pools[i] }));
  return [...tagged.filter((x) => x.pool === 'A'), ...tagged.filter((x) => x.pool === 'B')];
}

/**
 * POST /api/admin/tournament/:id/teams { action, ... }: the organizer's team taps.
 *   draft                  Draft teams (or draw again: `redo`)
 *   swap { a, b }          swap two players between teams (before any result)
 *   rename { teamId, name }
 *   publish                players see their team; the games are made
 *   unpublish              back to the draft (before any result)
 *   fix                    after a back out or a late join, before any result: pair the left-over players by closest level and publish again
 *   courts { numbers }     the venue's court numbers ([9, 10])
 */
export async function teamsAction(ctx: Ctx, body: Record<string, unknown>) {
  const group = await organizerOn(ctx);
  const t = await openById(ctx, group);
  const action = v.oneOf(body.action, 'action', ['draft', 'redo', 'swap', 'rename', 'publish', 'unpublish', 'fix', 'courts', 'count'] as const);
  const all = await readAll(ctx, t);
  const tz = group.timezone;
  const view = adminDayView(t, shownFormat(t, all.tickets, ctx.nowMs, tz), all.signups, all.tickets, all, tz, ctx.nowMs);
  const nowIso = ctx.nowIso;
  const levelOf = new Map(all.signups.map((s) => [s.player_id, s.approved_level ?? s.picked_level]));
  const nameOf = new Map(all.signups.map((s) => [s.player_id, s.display_name]));
  const notPublished = '(SELECT teams_at FROM tournaments WHERE id = ?) IS NULL';
  const noResult = 'NOT EXISTS (SELECT 1 FROM tournament_games WHERE tournament_id = ? AND (winner IS NOT NULL OR claim IS NOT NULL OR skipped = 1))';

  // How many courts (Finalize's Courts row, changed from the plan check card): only before the teams are published (the games follow it).
  if (action === 'count') {
    const n = body.courts === 1 ? 1 : body.courts === 2 ? 2 : bad('invalid_courts', 'Pick 1 or 2 courts.');
    if (t.teams_at) bad('tournament_changed', 'The teams are published. Edit teams first.');
    if (!t.final_date) bad('tournament_changed', 'Finalize the date first.');
    const [res] = await ctx.db.batch([
      ctx.db
        .prepare(`UPDATE tournaments SET courts = ?, court_numbers = CASE WHEN json_array_length(COALESCE(court_numbers, '[]')) = ? THEN court_numbers ELSE NULL END, updated_at = ? WHERE id = ? AND teams_at IS NULL`)
        .bind(n, n, nowIso, t.id),
      // Zip 70: down to 1 court, no second court is lost: kept late drops get their credit back in this same step.
      ...releaseKeptStatements(ctx.db, group.id, t.id, nowIso),
    ]);
    if ((res.meta?.changes ?? 0) === 0) bad('tournament_changed', 'This just changed. Look again.');
    await audit(ctx.db, group.id, null, 'tournament_courts', { tournament: t.name, count: n }, nowIso);
    return { ok: true };
  }

  if (action === 'courts') {
    const raw = body.numbers;
    const nums = Array.isArray(raw) ? raw : [];
    if (nums.length !== courtsOf(t) || !nums.every((n) => Number.isInteger(n) && n >= 1 && n <= 16) || new Set(nums).size !== nums.length) {
      throw new HttpError(400, 'invalid_courts', `Pick ${courtsOf(t) === 1 ? 'the court' : 'two different courts'}.`);
    }
    await ctx.db.prepare('UPDATE tournaments SET court_numbers = ?, updated_at = ? WHERE id = ?').bind(JSON.stringify(nums), nowIso, t.id).run();
    await audit(ctx.db, group.id, null, 'tournament_courts', { tournament: t.name, courts: nums.join(' and ') }, nowIso);
    return { ok: true };
  }

  if (action === 'draft' || action === 'redo') {
    if (!view.canDraft) bad('cannot_draft', view.why ?? 'Teams are published. Use Edit teams first.');
    const players: DraftPlayer[] = lockedInIds(all.tickets).map((id) => ({ id, name: nameOf.get(id) ?? 'A player', level: levelOf.get(id) ?? 300 }));
    const current: Pair[] | undefined =
      action === 'redo' && all.teams.length
        ? all.teams
            .filter((x) => x.player_a && x.player_b)
            .map((x) => [players.find((p) => p.id === x.player_a), players.find((p) => p.id === x.player_b)] as Pair)
            .filter((p) => p[0] && p[1])
        : undefined;
    const pairs = draftTeams(players, Math.random, current);
    const teams = pairs.map((p, i) => ({ id: newId(), name: all.teams[i]?.name ?? TEAM_NAMES[i] ?? `Team ${i + 1}`, a: p[0].id, b: p[1].id, pool: null, changed: false, out: null }));
    await ctx.db.batch(writeTeamsAndGames(ctx.db, t, teams, null, 11, nowIso, notPublished, [t.id]));
    await audit(ctx.db, group.id, null, 'tournament_teams_drafted', { tournament: t.name, teams: teams.length, redo: action === 'redo' }, nowIso);
    return { ok: true, note: draftNote(pairs) };
  }

  if (action === 'rename') {
    const teamId = v.id(body.teamId, 'teamId');
    const name = readTeamName(body.name);
    if (all.teams.some((x) => x.id !== teamId && x.name.toLowerCase() === name.toLowerCase())) throw new HttpError(400, 'invalid_name', 'Another team has that name.');
    // The organizer can rename any team at any time (also after Game 1). No two teams of a tournament share a name, checked when it lands.
    const res = await ctx.db.prepare(`UPDATE tournament_teams SET name = ?, updated_at = ? WHERE id = ? AND tournament_id = ? AND ${NAME_FREE}`).bind(name, nowIso, teamId, t.id, t.id, name, teamId).run();
    if ((res.meta?.changes ?? 0) === 0) bad('tournament_changed', 'Another team has that name, or this just changed. Look again.');
    const row = all.teams.find((x) => x.id === teamId);
    await audit(ctx.db, group.id, null, 'tournament_team_named', { tournament: t.name, team: name, ...(row ? { players: [row.player_a, row.player_b].map((id) => (id ? (nameOf.get(id) ?? 'A player') : '')).filter(Boolean).join(' + ') } : {}) }, nowIso);
    return { ok: true };
  }

  if (action === 'swap') {
    if (view.anyResult) bad('games_started', 'Games have started. Use Player left.');
    const a = v.id(body.a, 'a');
    const b = v.id(body.b, 'b');
    const ta = all.teams.find((x) => x.player_a === a || x.player_b === a);
    const tb = all.teams.find((x) => x.player_a === b || x.player_b === b);
    if (!ta || !tb || ta.id === tb.id) bad('tournament_changed', 'Pick two players on different teams.');
    const put = (x: TeamRow, from: string, to: string) => (x.player_a === from ? { a: to, b: x.player_b } : { a: x.player_a, b: to });
    const na = put(ta!, a, b);
    const nb = put(tb!, b, a);
    const published = !!t.teams_at;
    const res = await ctx.db.batch([
      ctx.db
        .prepare(`UPDATE tournament_teams SET player_a = ?, player_b = ?, updated_at = ?, changed_at = ? WHERE id = ? AND updated_at = ? AND ${noResult}`)
        .bind(na.a, na.b, nowIso, published ? nowIso : null, ta!.id, ta!.updated_at, t.id),
      ctx.db
        .prepare(`UPDATE tournament_teams SET player_a = ?, player_b = ?, updated_at = ?, changed_at = ? WHERE id = ? AND updated_at = ? AND ${noResult}`)
        .bind(nb.a, nb.b, nowIso, published ? nowIso : null, tb!.id, tb!.updated_at, t.id),
    ]);
    if ((res[0].meta?.changes ?? 0) === 0 || (res[1].meta?.changes ?? 0) === 0) bad('tournament_changed', 'This just changed. Look again.');
    await audit(ctx.db, group.id, null, 'tournament_teams_swapped', { tournament: t.name, players: `${nameOf.get(a) ?? 'A player'} and ${nameOf.get(b) ?? 'a player'}` }, nowIso);
    return { ok: true };
  }

  if (action === 'publish') {
    if (view.phase !== 'draft') bad('tournament_changed', 'Draft the teams first.');
    if (!view.canDraft) bad('cannot_draft', view.why ?? 'Teams cannot be published now.');
    const lockedSet = new Set(lockedInIds(all.tickets));
    const members = all.teams.flatMap((x) => [x.player_a, x.player_b]);
    if (members.some((id) => !id || !lockedSet.has(id)) || members.length !== lockedSet.size) bad('roster_changed', 'Who is locked in changed. Redo the draw.');
    const ordered = withPools(all.teams.map((x) => ({ ...x, total: (levelOf.get(x.player_a!) ?? 0) + (levelOf.get(x.player_b!) ?? 0) })));
    const { games, playTo } = gamesFor(t, ordered.length);
    const res = await ctx.db.batch([
      ctx.db.prepare('UPDATE tournaments SET teams_at = ?, updated_at = ? WHERE id = ? AND teams_at IS NULL').bind(nowIso, nowIso, t.id),
      ...writeTeamsAndGames(
        ctx.db,
        t,
        ordered.map((x) => ({ id: x.id, name: x.name, a: x.player_a, b: x.player_b, pool: x.pool, changed: false, out: null })),
        games,
        playTo,
        nowIso,
        '(SELECT teams_at FROM tournaments WHERE id = ?) = ?',
        [t.id, nowIso],
      ),
    ]);
    if ((res[0].meta?.changes ?? 0) === 0) bad('tournament_changed', 'This just changed. Look again.');
    await audit(ctx.db, group.id, null, 'tournament_teams_published', { tournament: t.name, teams: ordered.length, games: games.length }, nowIso);
    return { ok: true };
  }

  if (action === 'unpublish') {
    if (view.phase !== 'published') return { ok: true, changed: false };
    if (view.anyResult) bad('games_started', 'Games have started. The teams stay.');
    const res = await ctx.db.batch([
      ctx.db.prepare(`UPDATE tournaments SET teams_at = NULL, updated_at = ? WHERE id = ? AND teams_at IS NOT NULL AND ${noResult}`).bind(nowIso, t.id, t.id),
      ctx.db.prepare(`DELETE FROM tournament_games WHERE tournament_id = ? AND (SELECT teams_at FROM tournaments WHERE id = ?) IS NULL`).bind(t.id, t.id),
    ]);
    if ((res[0].meta?.changes ?? 0) === 0) bad('tournament_changed', 'This just changed. Look again.');
    await audit(ctx.db, group.id, null, 'tournament_teams_unpublished', { tournament: t.name }, nowIso);
    return { ok: true };
  }

  // fix: pair the left-over players (partners whose teammate is gone, and players on no team) by closest level, then publish again.
  if (!view.fix) return { ok: true, changed: false };
  const lockedSet = new Set(lockedInIds(all.tickets));
  const keep = all.teams.filter((x) => x.player_a && x.player_b && lockedSet.has(x.player_a) && lockedSet.has(x.player_b));
  const kept = new Set(keep.flatMap((x) => [x.player_a!, x.player_b!]));
  const loose = [...lockedSet].filter((id) => !kept.has(id)).sort((x, y) => (levelOf.get(y) ?? 0) - (levelOf.get(x) ?? 0));
  if (loose.length % 2 === 1) bad('odd_count', `Locked doubles needs an even number. ${lockedSet.size} are locked in.`);
  if (keep.length + loose.length / 2 < 3) bad('cannot_draft', 'Needs at least 6 locked in.');
  // Names: kept teams keep theirs; a reused team keeps its own; a new team gets a name nobody has.
  const reused = all.teams.filter((x) => !keep.includes(x) && [x.player_a, x.player_b].some((id) => id && loose.includes(id)));
  const used = new Set([...keep, ...reused].map((x) => x.name.toLowerCase()));
  const freeNames = TEAM_NAMES.filter((n) => !used.has(n.toLowerCase()));
  // Closest level: neighbors in level order.
  const taken = new Set<string>();
  const fresh = Array.from({ length: loose.length / 2 }, (_, i) => {
    const old = all.teams.find((x) => x.player_a === loose[i * 2] || x.player_b === loose[i * 2] || x.player_a === loose[i * 2 + 1] || x.player_b === loose[i * 2 + 1]);
    const own = old && !keep.includes(old) && !taken.has(old.id) ? old : null;
    if (own) taken.add(own.id);
    return { id: own ? own.id : newId(), name: own ? own.name : (freeNames.shift() ?? `Team ${keep.length + i + 1}`), player_a: loose[i * 2], player_b: loose[i * 2 + 1], changed: true, changed_at: null as string | null };
  });
  const ordered = withPools([...keep.map((x) => ({ ...x, changed: false })), ...fresh].map((x) => ({ ...x, total: (levelOf.get(x.player_a!) ?? 0) + (levelOf.get(x.player_b!) ?? 0) })));
  // A kept team keeps its earlier partner note (changed_at).
  const { games, playTo } = gamesFor(t, ordered.length);
  await ctx.db.batch(
    writeTeamsAndGames(
      ctx.db,
      t,
      ordered.map((x) => ({ id: x.id, name: x.name, a: x.player_a, b: x.player_b, pool: x.pool, changed: x.changed, out: null, keepChanged: x.changed_at ?? null })),
      games,
      playTo,
      nowIso,
      noResult,
      [t.id],
    ),
  );
  await audit(ctx.db, group.id, null, 'tournament_teams_fixed', { tournament: t.name, paired: fresh.map((x) => `${nameOf.get(x.player_a) ?? 'A player'} and ${nameOf.get(x.player_b) ?? 'a player'}`).join('; ') }, nowIso);
  return { ok: true, paired: fresh.length };
}

/**
 * POST /api/admin/tournament/:id/games { action, ... }: the organizer on game night (mocks 48 to 50).
 *   result { num, a, b, seen }                  Zip 72: set or fix any game's score (picture pair-5: two numbers); it is the result
 *   result { num, winner: null, seen }          clear it (the game is to play again)
 *   apply { fromRound, to }                      the Time check: pool games from that round on are played to 9 or 7
 *   pause / resume
 *   left { playerId, swapIn? }                   a player left: swap in another player, or (no swapIn) the team sits out its later games
 */
export async function gamesAction(ctx: Ctx, body: Record<string, unknown>) {
  const group = await organizerOn(ctx);
  const t = await openById(ctx, group);
  // Zip 61: an Americano night has its own controls (scores, not who won), server/americanoDay.ts.
  if (t.format === 'americano') return americanoGamesAction(ctx, body);
  if (!t.teams_at) bad('tournament_changed', 'The teams are not published.');
  const action = v.oneOf(body.action, 'action', ['result', 'apply', 'pause', 'resume', 'left', 'spin', 'pick'] as const);
  const nowIso = ctx.nowIso;
  const day = await loadDay(ctx.db, t.id);

  // Zip 58: the organizer spins the wheel (always allowed: the team that spins may not be looking), or picks for four or more tied.
  if (action === 'spin') return spinTie(ctx, group, t, day, v.text(body.key, 'key', { max: 80 }), 'organizer');
  if (action === 'pick') return pickTie(ctx, group, t, day, body);

  if (action === 'pause' || action === 'resume') {
    await ctx.db.prepare(`UPDATE tournaments SET paused_at = ${action === 'pause' ? '?' : 'NULL'}, updated_at = ? WHERE id = ?`).bind(...(action === 'pause' ? [nowIso] : []), nowIso, t.id).run();
    await audit(ctx.db, group.id, null, action === 'pause' ? 'tournament_paused' : 'tournament_resumed', { tournament: t.name }, nowIso);
    return { ok: true };
  }

  if (action === 'apply') {
    const from = Number(body.fromRound);
    const to = Number(body.to);
    if (!Number.isInteger(from) || from < 1 || (to !== 9 && to !== 7)) throw new HttpError(400, 'invalid_apply', 'Pick a round and 9 or 7.');
    const res = await ctx.db
      .prepare(
        `UPDATE tournament_games SET play_to = ?, updated_at = ? WHERE tournament_id = ? AND stage = 'pool' AND round >= ? AND play_to > ? AND winner IS NULL AND claim IS NULL AND skipped = 0`,
      )
      .bind(to, nowIso, t.id, from, to)
      .run();
    await audit(ctx.db, group.id, null, 'tournament_time_check', { tournament: t.name, round: from, to, games: res.meta?.changes ?? 0 }, nowIso);
    return { ok: true, games: res.meta?.changes ?? 0 };
  }

  if (action === 'result') {
    const num = Number(body.num);
    const g = day.games.find((x) => x.num === num);
    if (!g) bad('tournament_changed', 'That game is not on the schedule.');
    // Zip 72: a result is a score (two numbers, not equal); `winner: null` clears it. A winner without a score is refused (every game has one).
    const clear = body.winner === null && body.a === undefined && body.b === undefined;
    const pair = clear ? null : readPair(body, 'a', 'b');
    const winner = pair ? (pair[0] > pair[1] ? 'a' : 'b') : null;
    const f = facts(t, day.teams, day.games, group.timezone, ctx.nowMs, day.ties ?? []);
    const r = f.resolved.get(num);
    if (winner && (!r?.a || !r?.b)) bad('not_ready', 'Both teams of that game are not known yet.');
    // What the organizer saw (the screen sends the result it showed: who won and the score): a tap on a game that changed since does nothing.
    const seen = body.seen && typeof body.seen === 'object' ? (body.seen as { winner?: unknown; scoreA?: unknown; scoreB?: unknown }) : null;
    const sideOk = (x: unknown) => x === null || x === 'a' || x === 'b';
    const numOk = (x: unknown) => x === null || x === undefined || (Number.isInteger(x) && (x as number) >= 0);
    if (seen && (!sideOk(seen.winner ?? null) || !numOk(seen.scoreA) || !numOk(seen.scoreB))) throw new HttpError(400, 'invalid_seen', 'Look again.');
    const res = await ctx.db
      .prepare(
        `UPDATE tournament_games SET winner = ?, score_a = ?, score_b = ?, claim = NULL, claim_by = NULL, claim_at = NULL, disputed_at = NULL, skipped = 0, result_at = ?, result_by = ?,
           seat_a = ?, seat_b = ?, updated_at = ?
         WHERE id = ? AND updated_at = ? ${seen ? "AND (CASE WHEN skipped = 1 THEN NULL WHEN winner IS NOT NULL THEN winner WHEN disputed_at IS NULL THEN claim END) IS ? AND score_a IS ? AND score_b IS ?" : ''}
           AND EXISTS (SELECT 1 FROM tournaments tt WHERE tt.id = tournament_games.tournament_id AND tt.status = 'tickets')`,
      )
      .bind(
        winner,
        pair ? pair[0] : null,
        pair ? pair[1] : null,
        winner ? nowIso : null,
        winner ? 'organizer' : null,
        winner ? r!.a : null,
        winner ? r!.b : null,
        nowIso,
        g!.id,
        g!.updated_at,
        ...(seen ? [seen.winner ?? null, seen.scoreA ?? null, seen.scoreB ?? null] : []),
      )
      .run();
    if ((res.meta?.changes ?? 0) === 0) bad('tournament_changed', 'This just changed. Look again.');
    const nameOf = (seat: number | null | undefined) => (seat ? (f.bySeat.get(seat)?.name ?? 'A team') : 'A team');
    const winSeat = winner ? (winner === 'a' ? r?.a : r?.b) : null;
    const winTeam = winSeat ? f.bySeat.get(winSeat) : undefined;
    const pnames = new Map<string, string>(((await ctx.db.prepare('SELECT id, display_name FROM players WHERE group_id = ?').bind(group.id).all<{ id: string; display_name: string }>()).results ?? []).map((p) => [p.id, p.display_name]));
    await audit(
      ctx.db,
      group.id,
      null,
      'tournament_result',
      {
        tournament: t.name,
        game: num,
        winner: winner ? nameOf(winSeat) : null,
        ...(pair ? { score: `${Math.max(...pair)} to ${Math.min(...pair)}` } : {}),
        ...(winTeam ? { winnerPlayers: [winTeam.player_a, winTeam.player_b].map((id) => (id ? (pnames.get(id) ?? 'A player') : '')).filter(Boolean).join(' + ') } : {}),
        by: 'organizer',
      },
      nowIso,
    );
    return { ok: true };
  }

  // left: a player left during the night.
  const playerId = v.id(body.playerId, 'playerId');
  const team = day.teams.find((x) => x.player_a === playerId || x.player_b === playerId);
  if (!team) bad('tournament_changed', 'They are on no team.');
  const names = new Map<string, string>(
    ((await ctx.db.prepare('SELECT id, display_name FROM players WHERE group_id = ?').bind(group.id).all<{ id: string; display_name: string }>()).results ?? []).map((p) => [p.id, p.display_name]),
  );
  if (body.swapIn !== undefined && body.swapIn !== null) {
    const swapIn = v.id(body.swapIn, 'swapIn');
    const all = await readAll(ctx, t);
    const view = adminDayView(t, 'doubles', all.signups, all.tickets, day, group.timezone, ctx.nowMs);
    if (!view.spares.some((s) => s.id === swapIn)) bad('tournament_changed', 'They cannot swap in. Look again.');
    const [a, b] = team!.player_a === playerId ? [swapIn, team!.player_b] : [team!.player_a, swapIn];
    const standby = view.spares.find((x) => x.id === swapIn)?.standby === true;
    const res = await ctx.db
      .prepare(
        'UPDATE tournament_teams SET player_a = ?, player_b = ?, changed_at = ?, updated_at = ? WHERE id = ? AND updated_at = ? AND NOT EXISTS (SELECT 1 FROM tournament_teams o WHERE o.tournament_id = ? AND (o.player_a = ? OR o.player_b = ?))',
      )
      .bind(a, b, nowIso, nowIso, team!.id, team!.updated_at, t.id, swapIn, swapIn)
      .run();
    if ((res.meta?.changes ?? 0) === 0) bad('tournament_changed', 'This just changed. Look again.');
    // Alex: a paid standby player who takes over plays for their hold, so it becomes their spot (it no longer comes back as credit at the end of the
    // night). No money moves: the hold is already paid in full (a spot needs that, the ticket's own check), only its place changes. At the 16-spot
    // cap the hold stays on standby (the cap trigger would refuse it).
    let spot = false;
    if (standby) {
      const up = await ctx.db
        .prepare(
          `UPDATE tournament_tickets SET place = 'spot', place_at = ?, updated_at = ? WHERE tournament_id = ? AND player_id = ? AND place = 'line'
             AND credit_cents + paid_cents >= price_cents AND (SELECT COUNT(*) FROM tournament_tickets WHERE tournament_id = ? AND place = 'spot') < ${MAX_SPOTS}`,
        )
        .bind(nowIso, nowIso, t.id, swapIn, t.id)
        .run()
        .catch(() => ({ meta: { changes: 0 } }));
      spot = (up.meta?.changes ?? 0) === 1;
    }
    await audit(
      ctx.db,
      group.id,
      null,
      'tournament_player_left',
      { tournament: t.name, player: names.get(playerId) ?? 'A player', swapIn: names.get(swapIn) ?? 'a player', team: team!.name, ...(standby ? { holdToSpot: spot } : {}) },
      nowIso,
    );
    return { ok: true, holdToSpot: spot };
  }
  // The team sits out: its games still to play are skipped (they count for nobody), its played games stay.
  const f = facts(t, day.teams, day.games, group.timezone, ctx.nowMs, day.ties ?? []);
  const skip = day.games.filter((g) => !decided(g) && (f.resolved.get(g.num)?.a === team!.seat || f.resolved.get(g.num)?.b === team!.seat || g.slot_a === `T${team!.seat}` || g.slot_b === `T${team!.seat}`));
  await ctx.db.batch([
    ctx.db.prepare('UPDATE tournament_teams SET out_at = ?, updated_at = ? WHERE id = ? AND out_at IS NULL').bind(nowIso, nowIso, team!.id),
    ...skip.map((g) =>
      ctx.db
        .prepare(
          `UPDATE tournament_games SET skipped = 1, winner = NULL, claim = NULL, disputed_at = NULL, score_a = NULL, score_b = NULL, result_by = 'skipped', result_at = ?, seat_a = ?, seat_b = ?, updated_at = ? WHERE id = ? AND winner IS NULL`,
        )
        .bind(nowIso, f.resolved.get(g.num)?.a ?? null, f.resolved.get(g.num)?.b ?? null, nowIso, g.id),
    ),
  ]);
  await audit(ctx.db, group.id, null, 'tournament_player_left', { tournament: t.name, player: names.get(playerId) ?? 'A player', team: team!.name, skipped: skip.length }, nowIso);
  return { ok: true, skipped: skip.length };
}

// ---------------------------------------------------------------------------------------------------------------------
// Zip 58: how a Locked doubles night ended (End tournament)
// ---------------------------------------------------------------------------------------------------------------------

export interface DoublesOutcome {
  /** The Final has a result that counts (or was a walkover): the organizer can end the tournament. */
  ready: boolean;
  champion: number | null;
  runnerUp: number | null;
  /** The 3rd place game's winner (or, with no such game, the next place), and 4th. */
  third: number | null;
  fourth: number | null;
  /** Every team in finishing order (teams that left during pool play last). */
  order: number[];
  /** Each team's record over every game of the night (pool, tie, playoff). */
  record: Map<number, { wins: number; losses: number }>;
  /** Teams that left during pool play (no finish). */
  out: Set<number>;
  teams: TeamRow[];
}

export function doublesOutcome(t: TournamentRow, rows: DayRows, tz: string, nowMs: number): DoublesOutcome {
  const f = facts(t, rows.teams, rows.games, tz, nowMs, rows.ties ?? []);
  const fin = f.games.find((g) => g.stage === 'final');
  const fr = fin ? f.resolved.get(fin.num) : undefined;
  const fres = fin ? f.results.get(fin.num) : undefined;
  let champion: number | null = null;
  let runnerUp: number | null = null;
  if (fin && fres?.winner && fr?.a && fr?.b) {
    champion = fres.winner === 'a' ? fr.a : fr.b;
    runnerUp = champion === fr.a ? fr.b : fr.a;
  } else if (fin && fres?.skipped && fr) {
    // A walkover: the one team still there wins it.
    const still = [fr.a, fr.b].filter((x): x is number => x !== null && !rows.teams.find((tm) => tm.seat === x)?.out_at);
    if (still.length === 1) champion = still[0];
  }
  const third = f.games.find((g) => g.stage === 'third');
  const tr = third ? f.resolved.get(third.num) : undefined;
  const tres = third ? f.results.get(third.num) : undefined;
  let p3: number | null = null;
  let p4: number | null = null;
  if (third && tres?.winner && tr?.a && tr?.b) {
    p3 = tres.winner === 'a' ? tr.a : tr.b;
    p4 = p3 === tr.a ? tr.b : tr.a;
  }
  const record = new Map<number, { wins: number; losses: number }>(rows.teams.map((x) => [x.seat, { wins: 0, losses: 0 }]));
  for (const g of f.games) {
    const r = f.resolved.get(g.num);
    const res = f.results.get(g.num);
    if (!r?.a || !r?.b || !res?.winner) continue;
    const win = res.winner === 'a' ? r.a : r.b;
    const lose = win === r.a ? r.b : r.a;
    record.get(win)!.wins++;
    record.get(lose)!.losses++;
  }
  // The rest in table order: with pools, 3rd of each pool, then 4th, ... (Zip 72: better record first, then point difference, then points
  // scored, the tie rule's steps that work across pools); a semifinal loser with no 3rd place game is 3rd.
  const placed = [champion, runnerUp, p3, p4].filter((x): x is number => x !== null);
  const semiLosers = f.games
    .filter((g) => g.stage === 'semi')
    .map((g) => {
      const r = f.resolved.get(g.num);
      const res = f.results.get(g.num);
      return r?.a && r?.b && res?.winner ? (res.winner === 'a' ? r.b : r.a) : null;
    })
    .filter((x): x is number => x !== null && !placed.includes(x));
  const tables = groupsOf(rows.teams.length).map((grp) => groupTable(rows.teams.length, f.games.map(asPlanned), f.results, f.out, f.records, (grp.pool ?? 'P') as GroupKey, f.gone).rows);
  const rest: number[] = [];
  for (let rank = 1; rank <= Math.max(0, ...tables.map((x) => x.length)); rank++) {
    const atRank = tables
      .map((x) => x[rank - 1])
      .filter((x) => !!x)
      .sort((a, b) => b.wins - a.wins || a.losses - b.losses || b.diff - a.diff || b.pointsFor - a.pointsFor || a.seat - b.seat);
    for (const r of atRank) if (!placed.includes(r.seat) && !semiLosers.includes(r.seat) && !f.out.has(r.seat) && !rest.includes(r.seat)) rest.push(r.seat);
  }
  const order = [...placed, ...semiLosers, ...rest, ...[...f.out].filter((x) => !placed.includes(x))];
  return {
    ready: champion !== null,
    champion,
    runnerUp,
    third: p3 ?? semiLosers[0] ?? null,
    fourth: p4 ?? semiLosers[1] ?? null,
    order,
    record,
    out: f.out,
    teams: rows.teams,
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Zip 58: the wheel and the organizer's picks
// ---------------------------------------------------------------------------------------------------------------------

/** A fair whole number from 0 to n - 1 (the wheel's answer is the server's, never the phone's). */
function fairPick(n: number): number {
  const buf = new Uint32Array(1);
  const limit = Math.floor(0x1_0000_0000 / n) * n;
  for (;;) {
    crypto.getRandomValues(buf);
    if (buf[0] < limit) return buf[0] % n;
  }
}

/**
 * Spin the wheel for a three-way tie (`key`): the server picks the bye team, stores it, and makes the playoff games (Game A, and Game B when the
 * tie needs it) in the first playoff round on the first free court. Once only: a second spin (a double tap, two phones, a refresh) changes nothing
 * and answers with the stored result.
 */
export async function spinTie(ctx: Ctx, group: { id: string; timezone: string }, t: TournamentRow, day: DayRows, key: string, by: 'organizer' | 'team', playerId?: string) {
  const groupId = group.id;
  const f = facts(t, day.teams, day.games, group.timezone, ctx.nowMs, day.ties ?? []);
  const b = f.blocks.find((x) => x.key === key && x.mode === 'wheel' && !x.order);
  const settledBefore = f.blocks.find((x) => x.key === key && x.record?.bye != null);
  if (settledBefore?.record?.bye != null) return { ok: true, bye: settledBefore.record.bye, index: settledBefore.seats.indexOf(settledBefore.record.bye), already: true };
  if (!b) bad('tournament_changed', 'This just changed. Look again.');
  if (by === 'team' && (b!.spinner === null || !f.teams.some((x) => x.seat === b!.spinner && (x.player_a === playerId || x.player_b === playerId)))) bad('not_spinner', 'Another team spins the wheel.');
  const bye = b!.seats[fairPick(b!.seats.length)];
  const firstNum = Math.max(0, ...day.games.map((g) => g.num)) + 1;
  const playoffRounds = f.games.filter((g) => g.stage !== 'pool' && g.stage !== 'tie').map((g) => g.round);
  const round = playoffRounds.length ? Math.min(...playoffRounds) : Math.max(1, ...f.games.map((g) => g.round));
  // The first free court: one with no game being played on it now (a pool still playing, another tie's game).
  const busy = new Set(f.games.filter((g) => !decided(g) && (g.stage === 'pool' || g.stage === 'tie') && f.resolved.get(g.num)?.a && f.resolved.get(g.num)?.b).map((g) => g.court));
  const court = [1, 2].slice(0, courtsOf(t)).find((c) => !busy.has(c)) ?? 1;
  const planned = tieGames(b!, bye, firstNum, round, court);
  const id = newId();
  const nowIso = ctx.nowIso;
  // Two ties spun at the same moment can pick the same game number: the second batch is refused whole ("look again"), nothing half written.
  await ctx.db.batch([
    ctx.db
      .prepare(
        `INSERT INTO tournament_ties (id, tournament_id, tie_key, kind, bye_seat, picks, game_a, game_b, spun_by, spun_at, created_at, updated_at)
         SELECT ?, ?, ?, 'wheel', ?, NULL, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM tournaments WHERE id = ? AND status = 'tickets')
         ON CONFLICT (tournament_id, tie_key) DO NOTHING`,
      )
      .bind(id, t.id, key, bye, planned[0].num, planned[1]?.num ?? null, by, nowIso, nowIso, nowIso, t.id),
    ...planned.map((g) =>
      ctx.db
        .prepare(
          `INSERT INTO tournament_games (id, tournament_id, num, round, court, stage, pool, slot_a, slot_b, play_to, skipped, created_at, updated_at)
           SELECT ?, ?, ?, ?, ?, 'tie', ?, ?, ?, ?, 0, ?, ? WHERE EXISTS (SELECT 1 FROM tournament_ties WHERE id = ?)`,
        )
        .bind(newId(), t.id, g.num, g.round, g.court, g.pool, g.a, g.b, TIE_TO, nowIso, nowIso, id),
    ),
  ]).catch(() => bad('tournament_changed', 'This just changed. Look again.'));
  const row = await ctx.db.prepare('SELECT bye_seat, id FROM tournament_ties WHERE tournament_id = ? AND tie_key = ?').bind(t.id, key).first<{ bye_seat: number | null; id: string }>();
  if (!row || row.bye_seat === null) bad('tournament_changed', 'This just changed. Look again.');
  if (row!.id !== id) return { ok: true, bye: row!.bye_seat, index: b!.seats.indexOf(row!.bye_seat!), already: true };
  const team = (seat: number) => f.bySeat.get(seat)?.name ?? `Team ${seat}`;
  await audit(ctx.db, groupId, null, 'tournament_wheel', { tournament: t.name, tied: b!.seats.map(team).join(', '), bye: team(bye), by, games: planned.length }, nowIso);
  return { ok: true, bye, index: b!.seats.indexOf(bye), already: false };
}

/** Four or more tied (or two that never played each other): the organizer taps the team for the next place, one tap per place. */
async function pickTie(ctx: Ctx, group: { id: string; timezone: string }, t: TournamentRow, day: DayRows, body: Record<string, unknown>) {
  const groupId = group.id;
  const key = v.text(body.key, 'key', { max: 80 });
  const seat = Number(body.seat);
  const f = facts(t, day.teams, day.games, group.timezone, ctx.nowMs, day.ties ?? []);
  const b = f.blocks.find((x) => x.key === key && x.mode === 'pick');
  if (!b || b.needPicks === 0 || !b.seats.includes(seat)) bad('tournament_changed', 'This just changed. Look again.');
  const had = b!.record?.picks.filter((x) => b!.seats.includes(x)) ?? [];
  const seen = Array.isArray(body.picks) ? (body.picks as unknown[]).map(Number) : had;
  if (JSON.stringify(seen) !== JSON.stringify(had) || had.includes(seat)) bad('tournament_changed', 'This just changed. Look again.');
  const before = b!.record ? JSON.stringify(b!.record.picks) : null;
  const next = JSON.stringify([...had, seat]);
  const nowIso = ctx.nowIso;
  const res = await ctx.db
    .prepare(
      `INSERT INTO tournament_ties (id, tournament_id, tie_key, kind, bye_seat, picks, game_a, game_b, spun_by, spun_at, created_at, updated_at)
       SELECT ?, ?, ?, 'pick', NULL, ?, NULL, NULL, 'organizer', NULL, ?, ? WHERE EXISTS (SELECT 1 FROM tournaments WHERE id = ? AND status = 'tickets')
       ON CONFLICT (tournament_id, tie_key) DO UPDATE SET picks = excluded.picks, updated_at = excluded.updated_at WHERE tournament_ties.picks IS ?`,
    )
    .bind(newId(), t.id, key, next, nowIso, nowIso, t.id, before)
    .run();
  if ((res.meta?.changes ?? 0) === 0) bad('tournament_changed', 'This just changed. Look again.');
  await audit(ctx.db, groupId, null, 'tournament_tie_pick', { tournament: t.name, team: f.bySeat.get(seat)?.name ?? `Team ${seat}`, place: b!.from + had.length }, nowIso);
  return { ok: true };
}

/** POST /api/tournament/spin { tournamentId, key }: a player of the team that spins taps "spin the wheel". */
export async function playerSpin(ctx: Ctx, who: TournamentActor, body: Record<string, unknown>) {
  const { t, playerId } = await playerTarget(ctx, who, body);
  if (!t.teams_at || t.format === 'americano') bad('tournament_changed', 'This just changed. Look again.');
  const day = await loadDay(ctx.db, t.id);
  const r = await spinTie(ctx, who.group, t, day, v.text(body.key, 'key', { max: 80 }), 'team', playerId);
  if (!r.already) await logPlayer(ctx, who.group, playerId, 'tournament_wheel_spun', { tournament: t.name });
  return r;
}

// ---------------------------------------------------------------------------------------------------------------------
// A player's taps
// ---------------------------------------------------------------------------------------------------------------------

/**
 * POST /api/tournament/game { tournamentId, num, action: 'score', mine, theirs }: on game night, a player in that game (either team).
 * Zip 72: every Locked doubles game has a score (picture pair-2: "Final score", the two team names, Submit score; sent after the card's 5
 * second Undo). The winner is the side with more points.
 * Zip 71, NO CONFIRMING (Alex, Nov 20): the FIRST score from ANY of the 4 players is the result, at once (who entered it is kept in claim_by).
 * Nobody confirms it. A second score from anyone is refused with who entered it ("Vic entered 11 to 7. Ask Alex to fix it."); the same player
 * sending the same score again (a refresh, two phones) is fine. Only the organizer changes a result afterward (Fix, or clear it).
 * The old 'won', 'lost', 'confirm', 'dispute' and 'undo' are refused: a result needs a score, there is nothing to confirm, and the Undo is the
 * 5 seconds on the phone.
 */
export async function playerGameAction(ctx: Ctx, who: TournamentActor, body: Record<string, unknown>) {
  const { t, playerId } = await playerTarget(ctx, who, body);
  // Zip 61: on an Americano night a player enters a score (server/americanoDay.ts), once tickets have closed on Americano.
  if (t.format === 'americano' && styleDecided(t, ctx.nowMs)) return americanoGameAction(ctx, who, t, playerId, body);
  if (!t.teams_at) bad('tournament_changed', 'This just changed. Look again.');
  const action = v.oneOf(body.action, 'action', ['score', 'won', 'lost', 'confirm', 'dispute', 'undo'] as const);
  const num = Number(body.num);
  const day = await loadDay(ctx.db, t.id);
  const tz = who.group.timezone;
  const f = facts(t, day.teams, day.games, tz, ctx.nowMs, day.ties ?? []);
  const g = day.games.find((x) => x.num === num);
  const team = day.teams.find((x) => (x.player_a === playerId || x.player_b === playerId) && !x.out_at);
  const r = g ? f.resolved.get(g.num) : null;
  const side = team && r ? (r.a === team.seat ? 'a' : r.b === team.seat ? 'b' : null) : null;
  if (!g || !side || !r?.a || !r?.b) bad('not_your_game', 'That is not your game. Look again.');
  // Results open 15 minutes before the start (a team warming up early) and stay open through the night.
  const real = realTimes(t);
  if (ctx.nowMs < startMsOf(t.final_date!, real.start, tz) - 15 * 60_000) bad('not_started', `Games begin at ${clockLabel(real.start)}.`);
  if (t.format === 'americano') bad('tournament_changed', 'The style is Americano now. Look again.');
  const org = firstName(who.group);
  const nameOfSide = (x: string | null) => (x === 'a' || x === 'b' ? (f.bySeat.get(x === 'a' ? r!.a! : r!.b!)?.name ?? 'A team') : 'A team');
  // What a refused answer says: who gave the result that stands (with its score; a result from before Zip 72 says who won).
  const standing = async (game: GameRow) => {
    if (game.skipped) return `That game is off. Ask ${org}.`;
    const w = game.winner ?? game.claim;
    const sc = scoresOf(game);
    const by = !game.claim_by ? null : game.claim_by === playerId ? 'You' : ((await ctx.db.prepare('SELECT display_name FROM players WHERE id = ?').bind(game.claim_by).first<{ display_name: string }>())?.display_name ?? 'A player');
    if (game.result_by === 'organizer') return firstAnswer(sc ? saidTeamScore(org, 'set', nameOfSide(w), sc.scoreA, sc.scoreB) : `${org} set ${nameOfSide(w)} as the winner.`, org);
    if (sc) return firstAnswer(saidTeamScore(by ?? 'Someone', 'entered', nameOfSide(w), sc.scoreA, sc.scoreB), org);
    return firstAnswer(by ? saidWon(by, nameOfSide(w)) : `${nameOfSide(w)} won.`, org);
  };
  const decidedNow = (x: GameRow) => !!x.winner || !!x.skipped || !!x.claim;
  if (action !== 'score') {
    if (decidedNow(g!)) bad('decided', await standing(g!));
    bad('no_confirm', action === 'undo' ? 'Nothing to take back.' : action === 'won' || action === 'lost' ? 'Enter the score. Pull down to refresh.' : 'Nothing to confirm. Enter the score.');
  }
  // A bad score is refused before anything is written ("mine" is this player's team).
  const sent = readPair(body, 'mine', 'theirs');
  const [x, y] = side === 'a' ? sent : [sent[1], sent[0]];
  const answer: 'a' | 'b' = x > y ? 'a' : 'b';
  const same = (z: GameRow) => z.claim_by === playerId && z.score_a === x && z.score_b === y;
  // A result stands: the same player's same score is fine, anything else is refused.
  if (decidedNow(g!)) {
    if (same(g!) && !g!.skipped) return { ok: true, result: 'score' };
    // Someone else's score that says the same thing: refused (it is the second answer), but nothing needs fixing.
    if (!g!.skipped && g!.score_a === x && g!.score_b === y) bad('decided', (await standing(g!)).replace(` Ask ${org} to fix it.`, ' It is in.'));
    bad('decided', await standing(g!));
  }
  // Every result keeps the two teams it was given for (seat_a, seat_b), so a later change to an earlier game never moves it to other teams.
  const res = await ctx.db
    .prepare(
      `UPDATE tournament_games SET winner = ?, score_a = ?, score_b = ?, claim = NULL, claim_by = ?, claim_at = NULL, disputed_at = NULL, result_at = ?, result_by = 'players', seat_a = ?, seat_b = ?, updated_at = ?
       WHERE id = ? AND updated_at = ? AND skipped = 0 AND winner IS NULL AND claim IS NULL
         AND EXISTS (SELECT 1 FROM tournaments tt WHERE tt.id = tournament_games.tournament_id AND tt.status = 'tickets')`,
    )
    .bind(answer, x, y, playerId, ctx.nowIso, r!.a, r!.b, ctx.nowIso, g!.id, g!.updated_at)
    .run();
  if ((res.meta?.changes ?? 0) === 0) {
    // Two phones at once: another score landed first. The same player with the same score: it is in. Anyone else: who entered it.
    const now = await ctx.db.prepare('SELECT * FROM tournament_games WHERE id = ?').bind(g!.id).first<GameRow>().catch(() => null);
    if (now && same(now) && now.winner === answer) return { ok: true, result: 'score' };
    if (now && decidedNow(now)) bad('decided', await standing(now));
    bad('tournament_changed', 'This just changed. Look again.');
  }
  await logPlayer(ctx, who.group, playerId, 'tournament_result', { tournament: t.name, game: num, result: `${nameOfSide(answer)} won ${Math.max(x, y)} to ${Math.min(x, y)}`, by: 'player' });
  return { ok: true, result: 'score' };
}

/**
 * POST /api/tournament/team-name { tournamentId, name? }: either partner names their team (the pencil), or rolls the dice (no `name`: a new
 * suggestion nobody else in the tournament has). Zip 74: { suggest: true, not? } answers a suggestion and saves nothing (the sheet's Randomize). Until Game 1 starts; the last save wins and the partner sees it at once. No two teams share a name.
 */
export async function playerTeamName(ctx: Ctx, who: TournamentActor, body: Record<string, unknown>) {
  const { t, playerId } = await playerTarget(ctx, who, body);
  if (!t.teams_at || !t.final_date) bad('tournament_changed', 'This just changed. Look again.');
  const { teams } = await loadDay(ctx.db, t.id);
  const team = teams.find((x) => (x.player_a === playerId || x.player_b === playerId) && !x.out_at);
  if (!team) bad('not_your_team', 'You are on no team. Look again.');
  const real = realTimes(t);
  if (ctx.nowMs >= startMsOf(t.final_date!, real.start, who.group.timezone)) bad('started', 'Game 1 has started. The name stays.');
  // Zip 74 (picture pair-2): "Need help? Randomize a name" only fills the sheet's box (`suggest`: a name nobody else has, never the one in the
  // box); nothing is saved until Save. A typed name is checked for a clash when it is saved, as before.
  if (body.suggest === true) {
    const not = typeof body.not === 'string' ? body.not.trim() : team!.name;
    return { ok: true, name: suggestTeamName(teams.filter((x) => x.id !== team!.id).map((x) => x.name), Math.random, not), suggested: true };
  }
  const name = body.name === undefined || body.name === null ? suggestTeamName(teams.filter((x) => x.id !== team!.id).map((x) => x.name), Math.random, team!.name) : readTeamName(body.name);
  if (name === team!.name) return { ok: true, name };
  const res = await ctx.db.prepare(`UPDATE tournament_teams SET name = ?, updated_at = ? WHERE id = ? AND ${NAME_FREE}`).bind(name, ctx.nowIso, team!.id, t.id, name, team!.id).run();
  if ((res.meta?.changes ?? 0) === 0) bad('name_taken', 'Another team has that name. Try another.');
  await logPlayer(ctx, who.group, playerId, 'tournament_team_named', { tournament: t.name, team: name, was: team!.name });
  return { ok: true, name };
}
