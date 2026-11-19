// Zip 61 (🎾61.americano), "Tournaments": the Americano night. Every round a new partner, everyone plays for their own points, nobody has a fixed
// team. The schedule is a pure function (shared/americanoSchedule.ts americanoNight: the players locked in, the courts, the court time); this
// file stores scores and builds what each screen sees. Zip 57's pieces are reused: the tournament_games table (with migration 0028's three
// score columns), the Time check (shared/tournamentSchedule.ts timeCheck), Pause, the courts' numbers and the 15 minute rule for results.
//
// When the rows are written: never by a screen that only reads (Zip 62's rule). Until the first save of the night (a score, or the organizer's
// Time check, Fix or Player left) every screen works the schedule out from who is locked in, so a back out or a switch before the night simply
// gives the new schedule. The first save writes every game of the night (guarded, so two saves at once write them once), and from then on the
// rows are the night: a player who is no longer locked in (backed out, taken off) or who left (Player left) has their games still to play
// skipped, and the partners and opponents in them get a plain note.
//
// Who sees what: a player gets the night only while the tournament is visible to them (server/tournament.ts visibleTo) and only if they are in it.
// Names only: their own rounds, the games being played now and the points table. No money, no levels, no other player's id or phone.
import type { Ctx } from './context';
import type { D1Database } from './db';
import { HttpError } from './http';
import { newId } from './crypto';
import * as v from './validate';
import { audit } from './repo';
import type { AdminRoundGame, AdminRoundsView, PlayerRound, PlayerRoundsView } from '../shared/tournament';
import { americanoNight, gamesDiffer, isAmericanoSlot, pairSlot, pointsTable, slotPair, winLoss } from '../shared/americanoSchedule';
import { americanoPlan, clockLabel, type GameTo, ROUND_MINUTES } from '../shared/tournamentPlan';
import { type RoundState, timeCheck, timeCheckWords } from '../shared/tournamentSchedule';
import { startMsOf } from '../shared/tournamentTickets';
import type { TicketWithName } from './tournamentMoney';
import { courtNumbersOf, type GameRow, LIVE_AFTER_MS, LIVE_BEFORE_MS, loadDay, lockedInIds } from './tournamentDay';
import { firstName, logPlayer, nightOver, organizerOn, openById, realTimes, type SignupRow, type TournamentActor, type TournamentRow } from './tournament';

/** A score is waiting for the other side's Yes this long before the organizer's card calls it late. */
export const LATE_WAIT_MIN = 5;
/** Highest score a side can enter (a game to 11 that runs on, win by 2). */
export const MAX_SCORE = 30;

/** One game of the night, stored or worked out (`stored`: a row exists). Scores are side a / side b. */
export interface AmGame {
  num: number;
  round: number;
  court: number;
  a: [string, string];
  b: [string, string];
  playTo: number;
  scoreA: number | null;
  scoreB: number | null;
  claim: 'a' | 'b' | null;
  claimBy: string | null;
  claimAt: string | null;
  disputed: boolean;
  winner: 'a' | 'b' | null;
  resultAt: string | null;
  skipped: boolean;
  /** Skipped because this player left (or is no longer locked in). */
  leftBy: string | null;
  row: GameRow | null;
}

/** The Americano rows of a tournament (a Locked doubles row, "T3", is never one). */
export const americanoRows = (games: readonly GameRow[]): GameRow[] => games.filter((g) => isAmericanoSlot(g.slot_a) && isAmericanoSlot(g.slot_b));

/** A short number for a value (a key a screen keeps, without carrying another player's id). */
export function shortHash(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

/** A short check value for a game's four players, sent with a score: a schedule that changed in between is caught ("look again"). */
export function gameKey(g: Pick<AmGame, 'a' | 'b' | 'num'>): string {
  const s = `${g.num}:${pairSlot(g.a)}:${pairSlot(g.b)}`;
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

const courtsOf = (t: TournamentRow): number => (t.courts === 1 ? 1 : 2);
/** What the organizer's screen showed for a game (its save time and its state), sent back with a tap: a change in between is caught. */
const stampOf = (g: AmGame): string => (g.row ? `${g.row.updated_at}|${g.claim ?? ''}|${g.winner ?? ''}|${g.scoreA ?? ''}-${g.scoreB ?? ''}|${g.skipped ? 1 : 0}` : `plan:${gameKey(g)}`);
const courtNo = (t: TournamentRow, court: number): number => courtNumbersOf(t)?.[court - 1] ?? court;
const decided = (g: AmGame) => g.skipped || !!g.winner || !!g.claim;
/** A score that counts for the table: one that stands, or one waiting for the other side (players are trusted, as in zip 57). */
const counts = (g: AmGame) => !g.skipped && (!!g.winner || !!g.claim) && g.scoreA !== null && g.scoreB !== null;
const sideOf = (g: AmGame, id: string): 'a' | 'b' | null => (g.a.includes(id) ? 'a' : g.b.includes(id) ? 'b' : null);

function fromRow(r: GameRow): AmGame {
  const x = r as GameRow & { score_a?: number | null; score_b?: number | null; claim_by?: string | null };
  return {
    num: r.num,
    round: r.round,
    court: r.court,
    a: slotPair(r.slot_a)!,
    b: slotPair(r.slot_b)!,
    playTo: r.play_to,
    scoreA: x.score_a ?? null,
    scoreB: x.score_b ?? null,
    claim: r.claim === 'a' || r.claim === 'b' ? r.claim : null,
    claimBy: x.claim_by ?? null,
    claimAt: r.claim_at,
    disputed: !!r.disputed_at,
    winner: r.winner === 'a' || r.winner === 'b' ? r.winner : null,
    resultAt: r.result_at,
    skipped: !!r.skipped,
    leftBy: r.skipped ? (x.claim_by ?? null) : null,
    row: r,
  };
}

/** Minutes after midnight (Eastern, the tournament's day) of a moment. */
function minuteOf(t: TournamentRow, tz: string, ms: number): number {
  const r = realTimes(t);
  return r.start + (ms - startMsOf(t.final_date!, r.start, tz)) / 60_000;
}

/** Everything the screens need, worked out once. */
export interface AmFacts {
  /** The rows are written (the night has had its first save). */
  stored: boolean;
  games: AmGame[];
  rounds: number;
  /** Everyone in the night, in name order. */
  roster: string[];
  names: Map<string, string>;
  /** Left the night (Player left, or no longer locked in once the rows are written). */
  gone: Set<string>;
  sits: Map<number, string[]>;
  plan: ReturnType<typeof americanoPlan>;
  started: boolean;
  over: boolean;
  /** The round being played (the first with a game still to play), Infinity when every game is in. */
  roundNow: number;
  anyResult: boolean;
  check: ReturnType<typeof timeCheck> | null;
  shorter: { fromRound: number; to: GameTo } | null;
  start: number;
  end: number;
  /** When each round really started (minutes after midnight): the planned time, or the end of the round before when that was later. */
  roundStart: Map<number, number>;
}

export function amFacts(t: TournamentRow, signups: readonly SignupRow[], tickets: readonly TicketWithName[], rows: readonly GameRow[], tz: string, nowMs: number): AmFacts {
  const names = new Map<string, string>();
  for (const s of signups) names.set(s.player_id, s.display_name);
  for (const k of tickets) names.set(k.player_id, k.display_name);
  const locked = lockedInIds(tickets as TicketWithName[]);
  const real = realTimes(t);
  const stored = americanoRows(rows);
  let games: AmGame[];
  if (stored.length) games = stored.map(fromRow).sort((x, y) => x.num - y.num);
  else {
    const night = americanoNight(locked, courtsOf(t), real.minutes, t.id);
    games = night.games.map((g) => ({
      num: g.num,
      round: g.round,
      court: g.court,
      a: g.a,
      b: g.b,
      playTo: g.playTo,
      scoreA: null,
      scoreB: null,
      claim: null,
      claimBy: null,
      claimAt: null,
      disputed: false,
      winner: null,
      resultAt: null,
      skipped: false,
      leftBy: null,
      row: null,
    }));
  }
  const inGames = [...new Set(games.flatMap((g) => [...g.a, ...g.b]))];
  const lockedSet = new Set(locked);
  // Left: Player left (a skipped game says who), or, once the rows are written, no longer locked in.
  const gone = new Set<string>([...games.filter((g) => g.skipped && g.leftBy).map((g) => g.leftBy!), ...(stored.length ? inGames.filter((id) => !lockedSet.has(id)) : [])]);
  // A game still to play with someone who left in it is not played (the other three sit that round).
  games = games.map((g) => {
    if (decided(g)) return g;
    const who = [...g.a, ...g.b].find((id) => gone.has(id));
    return who ? { ...g, skipped: true, leftBy: who } : g;
  });
  const byName = (x: string, y: string) => (names.get(x) ?? '').localeCompare(names.get(y) ?? '') || x.localeCompare(y);
  const roster = (stored.length ? inGames : locked).sort(byName);
  const rounds = Math.max(0, ...games.map((g) => g.round));
  const sits = new Map<number, string[]>();
  for (let r = 1; r <= rounds; r++) {
    const on = new Set(games.filter((g) => g.round === r && !g.skipped).flatMap((g) => [...g.a, ...g.b]));
    sits.set(r, roster.filter((id) => !on.has(id) && !gone.has(id)));
  }
  const plan = americanoPlan(Math.max(4, roster.length), courtsOf(t), real.minutes);
  const startMs = t.final_date ? startMsOf(t.final_date, real.start, tz) : Infinity;
  const started = nowMs >= startMs;
  const over = nightOver(t, tz, nowMs);
  const anyResult = games.some((g) => !!g.winner || !!g.claim || (g.skipped && !!g.row?.skipped));
  const open = games.filter((g) => !decided(g));
  const roundNow = open.length ? Math.min(...open.map((g) => g.round)) : Infinity;
  // The Time check, counted in rounds; the last round is never shortened.
  const states: RoundState[] = [];
  for (let r = 1; r <= rounds; r++) {
    const list = games.filter((g) => g.round === r);
    const times = list.map((g) => g.resultAt ?? g.claimAt).filter((x): x is string => !!x);
    const done = list.every(decided);
    states.push({
      round: r,
      pool: true,
      playTo: Math.max(...list.map((g) => g.playTo), 7) as GameTo,
      done,
      anyResult: list.some((g) => !!g.winner || !!g.claim),
      doneAt: done && times.length && t.final_date ? minuteOf(t, tz, Math.max(...times.map((x) => Date.parse(x)))) : undefined,
      keep: r === rounds,
    });
  }
  const check = started && !over && !t.paused_at && rounds && t.final_date ? timeCheck(states, real.start, real.start + real.minutes, minuteOf(t, tz, nowMs)) : null;
  const lowered = games.filter((g) => !decided(g) && g.playTo < plan.gameTo);
  const shorter = lowered.length ? { fromRound: Math.min(...lowered.map((g) => g.round)), to: Math.min(...lowered.map((g) => g.playTo)) as GameTo } : null;
  const roundStart = new Map<number, number>();
  let at = real.start;
  for (const s of states) {
    const prev = states.find((x) => x.round === s.round - 1);
    const begin = Math.max(at, prev?.doneAt ?? at);
    roundStart.set(s.round, begin);
    at = begin + ROUND_MINUTES[s.playTo];
  }
  return { stored: stored.length > 0, games, rounds, roster, names, gone, sits, plan, started, over, roundNow, anyResult, check, shorter, start: real.start, end: real.start + real.minutes, roundStart };
}

/** The points table rows (names in name order; ties keep that order). */
function tableOf(f: AmFacts) {
  return pointsTable(
    f.roster,
    f.games.filter(counts).map((g) => ({ a: g.a, b: g.b, scoreA: g.scoreA!, scoreB: g.scoreB! })),
    { final: f.games.every(decided) && f.games.length > 0 },
  );
}

/**
 * Zip 58: how an Americano night ended (End tournament): every game is in (a score that counts, or not played), and the points table (win
 * percentage when game counts differ, then total points). 1st place gets the champion credit and a medal, 2nd place the 2nd place credit.
 */
export function americanoOutcome(t: TournamentRow, signups: readonly SignupRow[], tickets: readonly TicketWithName[], rows: readonly GameRow[], tz: string, nowMs: number) {
  const f = amFacts(t, signups, tickets, rows, tz, nowMs);
  const table = tableOf(f);
  return { ready: f.stored && f.games.length > 0 && f.games.every(decided), table, names: f.names, gone: f.gone, rounds: f.rounds };
}

/** The pair with the player who entered the score first ("Vic says ... for Vic + Parker"). */
const claimerFirst = (p: readonly string[], by: string | null): string[] => (by && p[1] === by ? [p[1], p[0]] : [...p]);
const nameOf = (f: AmFacts, id: string) => f.names.get(id) ?? 'A player';
const pairNames = (f: AmFacts, p: readonly string[]) => p.map((id) => nameOf(f, id));
const list = (xs: string[]) => (xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

function shorterNote(f: AmFacts): string | undefined {
  if (!f.shorter) return undefined;
  return timeCheckWords(f.check?.behind ?? 0, f.shorter.fromRound, f.shorter.to, clockLabel(f.end));
}

// ---------------------------------------------------------------------------------------------------------------------
// A player's view (pictures 31 to 35)
// ---------------------------------------------------------------------------------------------------------------------

export function playerRoundsView(
  t: TournamentRow,
  signups: readonly SignupRow[],
  tickets: readonly TicketWithName[],
  rows: readonly GameRow[],
  playerId: string,
  tz: string,
  nowMs: number,
): PlayerRoundsView | null {
  const f = amFacts(t, signups, tickets, rows, tz, nowMs);
  if (!f.roster.includes(playerId) && !f.gone.has(playerId)) return null;
  const real = realTimes(t);
  const startMs = t.final_date ? startMsOf(t.final_date, real.start, tz) : Infinity;
  const today = nowMs >= startMs - LIVE_BEFORE_MS && nowMs < startMs + real.minutes * 60_000 + LIVE_AFTER_MS;
  const me = nameOf(f, playerId);
  const rounds: PlayerRound[] = [];
  let first = true;
  for (let r = 1; r <= f.rounds; r++) {
    const g = f.games.find((x) => x.round === r && sideOf(x, playerId));
    if (!g || (g.skipped && f.gone.has(playerId) && g.leftBy === playerId)) {
      if (f.gone.has(playerId) && (!g || g.leftBy === playerId)) continue;
      // A break: over once the night has moved past this round.
      const done = r < f.roundNow;
      rounds.push({ round: r, num: null, court: null, partner: null, opponents: null, state: done ? 'done' : first ? 'next' : 'later', playTo: f.plan.gameTo, alsoOff: (f.sits.get(r) ?? []).filter((id) => id !== playerId).map((id) => nameOf(f, id)) });
      if (!done) first = false;
      continue;
    }
    const side = sideOf(g, playerId)!;
    const partner = (side === 'a' ? g.a : g.b).find((id) => id !== playerId)!;
    const opp = side === 'a' ? g.b : g.a;
    const done = decided(g);
    const mine = side === 'a' ? g.scoreA : g.scoreB;
    const theirs = side === 'a' ? g.scoreB : g.scoreA;
    const scored = counts(g) && mine !== null && theirs !== null;
    const askMe = !g.winner && !!g.claim && g.claim !== side && !g.skipped && scored;
    rounds.push({
      round: r,
      num: g.num,
      key: gameKey(g),
      court: courtNo(t, g.court),
      partner: nameOf(f, partner),
      opponents: [nameOf(f, opp[0]), nameOf(f, opp[1])],
      state: done ? 'done' : first ? 'next' : 'later',
      ...(scored ? { won: mine! > theirs!, score: { mine: mine!, theirs: theirs! } } : {}),
      playTo: g.playTo,
      ...(g.claim === side && !g.winner && !g.skipped ? { claimed: true as const } : {}),
      ...(askMe
        ? { ask: { by: nameOf(f, g.claimBy ?? (g.claim === 'a' ? g.a[0] : g.b[0])), mine: mine!, theirs: theirs!, winners: pairNames(f, claimerFirst(mine! > theirs! ? (side === 'a' ? g.a : g.b) : opp, g.claimBy)).join(' + ') } }
        : {}),
      ...(g.skipped ? { skipped: true as const } : {}),
      ...(!done && f.started && r <= f.roundNow ? { onNow: true as const } : {}),
    });
    if (!done) first = false;
  }
  // The header: "Round 3 of 6": the round this player is on (their next game or break), or Done.
  const next = rounds.find((x) => x.state === 'next');
  // No round left for them (every game in, or they left): Done when the night is in, else the round the night is on.
  const nightRound = Number.isFinite(f.roundNow) ? f.roundNow : f.rounds;
  const allIn = f.games.every(decided);
  const label = next ? `Round ${next.round} of ${f.rounds}` : allIn ? 'Done' : `Round ${nightRound} of ${f.rounds}`;
  const doneCount = next ? next.round - 1 : allIn ? f.rounds : nightRound - 1;
  // Games being played now that are not theirs (every court while they sit).
  const live = f.started
    ? f.games
        .filter((g) => !decided(g) && g.round === f.roundNow && !sideOf(g, playerId))
        .map((g) => ({ round: g.round, court: courtNo(t, g.court), a: pairNames(f, g.a), b: pairNames(f, g.b) }))
    : [];
  const table = tableOf(f);
  const standings = table.map((r) => ({
    rank: r.rank,
    name: nameOf(f, r.id),
    record: winLoss(r),
    points: r.points,
    ...(r.id === playerId ? { me: true as const } : {}),
    ...(r.tied ? { tied: true as const } : {}),
    ...(f.gone.has(r.id) ? { out: true as const } : {}),
  }));
  // Someone left and this player's game with them is off: one plain note (per player who left).
  const offs = f.games.filter((g) => g.skipped && g.leftBy && g.leftBy !== playerId && sideOf(g, playerId));
  const leaver = offs[0]?.leftBy ?? null;
  const mineOff = leaver ? offs.filter((g) => g.leftBy === leaver).map((g) => g.round) : [];
  const note = shorterNote(f);
  return {
    kind: 'americano',
    me,
    rounds,
    started: f.started,
    today,
    beginsAt: clockLabel(real.start),
    courtsSet: !!courtNumbersOf(t),
    progress: { label, done: doneCount, total: Math.max(1, f.rounds) },
    live,
    standings,
    ...(note ? { timeNote: note } : {}),
    ...(t.paused_at ? { paused: true as const } : {}),
    ...(leaver
      ? {
          leftNote: {
            key: `left:${t.id}:${shortHash(leaver)}:${mineOff.join('-')}`,
            text: `${nameOf(f, leaver)} left. ${mineOff.length === 1 ? `Your Round ${mineOff[0]} game is off.` : `Your games in Rounds ${list(mineOff.map(String))} are off.`}`,
          },
        }
      : {}),
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// The organizer's view
// ---------------------------------------------------------------------------------------------------------------------

export function adminRoundsView(t: TournamentRow, signups: readonly SignupRow[], tickets: readonly TicketWithName[], rows: readonly GameRow[], tz: string, nowMs: number): AdminRoundsView {
  const f = amFacts(t, signups, tickets, rows, tz, nowMs);
  const nowMin = t.final_date ? minuteOf(t, tz, nowMs) : 0;
  const games: AdminRoundGame[] = f.games.map((g) => {
    const status: AdminRoundGame['status'] = g.skipped ? 'skipped' : g.winner ? 'done' : g.claim ? (g.disputed ? 'changed' : 'waiting') : f.started && g.round <= f.roundNow ? 'playing' : 'later';
    let late: string | undefined;
    if ((status === 'waiting' || status === 'changed') && g.claimAt) {
      const mins = Math.floor((nowMs - Date.parse(g.claimAt)) / 60_000);
      if (mins >= LATE_WAIT_MIN) late = `Waiting ${mins} min`;
    } else if (status === 'playing') {
      const over = Math.floor(nowMin - ((f.roundStart.get(g.round) ?? f.start) + ROUND_MINUTES[g.playTo as GameTo]));
      if (over >= LATE_WAIT_MIN) late = `${over} min over`;
    }
    return {
      num: g.num,
      round: g.round,
      court: g.court,
      courtNumber: courtNumbersOf(t)?.[g.court - 1] ?? null,
      a: { ids: [...g.a], names: pairNames(f, g.a) },
      b: { ids: [...g.b], names: pairNames(f, g.b) },
      playTo: g.playTo,
      scoreA: g.skipped ? null : g.scoreA,
      scoreB: g.skipped ? null : g.scoreB,
      status,
      ...(g.skipped && g.leftBy ? { by: nameOf(f, g.leftBy) } : g.claimBy ? { by: nameOf(f, g.claimBy) } : {}),
      ...(late ? { late } : {}),
      stamp: stampOf(g),
    };
  });
  const table = tableOf(f);
  const tied = table.filter((r) => r.tied).map((r) => nameOf(f, r.id));
  const sug = f.check?.suggest ?? null;
  const note = shorterNote(f);
  return {
    kind: 'americano',
    lockedIn: lockedInIds(tickets as TicketWithName[]).length,
    players: f.roster.map((id) => ({ id, name: nameOf(f, id), ...(f.gone.has(id) ? { left: true as const } : {}) })),
    courts: courtsOf(t),
    courtNumbers: courtNumbersOf(t),
    plan: { gameTo: f.plan.gameTo, rounds: f.rounds, fits: f.plan.fits, onCourt: f.plan.onCourt ?? 4 },
    games,
    sits: [...f.sits.entries()].map(([round, ids]) => ({ round, names: ids.map((id) => nameOf(f, id)) })),
    round: f.started && !f.over && Number.isFinite(f.roundNow) ? f.roundNow : null,
    started: f.started,
    over: f.over,
    paused: !!t.paused_at,
    anyResult: f.anyResult,
    timeCheck: sug ? { text: timeCheckWords(f.check!.behind, sug.fromRound, sug.to, clockLabel(f.end), sug.stillOver), fromRound: sug.fromRound, to: sug.to, key: `tc:${t.id}:${sug.fromRound}:${sug.to}` } : null,
    ...(note ? { timeNote: note } : {}),
    ...(tied.length ? { tied } : {}),
    byPercent: gamesDiffer(table),
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Writing the rows
// ---------------------------------------------------------------------------------------------------------------------

const bad = (code: string, message: string): never => {
  throw new HttpError(409, code, message);
};

/** Sign-ups, tickets and games, read fresh for a write. */
async function readNight(db: D1Database, t: TournamentRow) {
  const [s, k] = await db.batch([
    db.prepare(`SELECT s.*, p.display_name, p.is_active, NULL AS first_level FROM tournament_signups s JOIN players p ON p.id = s.player_id WHERE s.tournament_id = ?`).bind(t.id),
    db
      .prepare(
        `SELECT k.*, p.display_name, COALESCE(s.status, 'out') AS signup_status FROM tournament_tickets k JOIN players p ON p.id = k.player_id
         LEFT JOIN tournament_signups s ON s.tournament_id = k.tournament_id AND s.player_id = k.player_id WHERE k.tournament_id = ? ORDER BY k.place_at, k.rowid`,
      )
      .bind(t.id),
  ]);
  const ready = await db.prepare("SELECT 1 AS x FROM pragma_table_info('tournament_games') WHERE name = 'score_a'").first().catch(() => null);
  if (!ready) throw new HttpError(409, 'tournaments_not_ready', 'Scores are not set up on this site yet.');
  const day = await loadDay(db, t.id);
  return { signups: s.results as unknown as SignupRow[], tickets: k.results as unknown as TicketWithName[], games: day.games };
}

/**
 * The night's first save writes every game (the schedule worked out from who is locked in now). Guarded: only when no Americano row exists yet
 * (two saves at once write them once). Rows left from a Locked doubles schedule before the style switched are taken out in the same batch.
 * Returns the rows as they are now.
 */
async function ensureRows(ctx: Ctx, t: TournamentRow, n: Awaited<ReturnType<typeof readNight>>, nowIso: string): Promise<GameRow[]> {
  if (americanoRows(n.games).length) return n.games;
  if (!t.final_date) bad('tournament_changed', 'The date is not finalized.');
  const locked = lockedInIds(n.tickets);
  if (locked.length < 4) bad('few_players', 'Needs at least 4 locked in.');
  const night = americanoNight(locked, courtsOf(t), realTimes(t).minutes, t.id);
  // Guarded on "no Americano row written by anyone else" (this batch's own rows carry its own time), so two saves at once write the night once;
  // the UNIQUE (tournament_id, num) on the table refuses a second copy too, and then the rows already there are used.
  const none = "NOT EXISTS (SELECT 1 FROM tournament_games WHERE tournament_id = ? AND slot_a LIKE '%+%' AND created_at <> ?)";
  await ctx.db
    .batch([
      ctx.db.prepare(`DELETE FROM tournament_games WHERE tournament_id = ? AND slot_a NOT LIKE '%+%' AND ${none}`).bind(t.id, t.id, nowIso),
      ...night.games.map((g) =>
        ctx.db
          .prepare(
            `INSERT INTO tournament_games (id, tournament_id, num, round, court, stage, pool, slot_a, slot_b, play_to, skipped, created_at, updated_at)
             SELECT ?, ?, ?, ?, ?, 'pool', NULL, ?, ?, ?, 0, ?, ? WHERE ${none}`,
          )
          .bind(newId(), t.id, g.num, g.round, g.court, pairSlot(g.a), pairSlot(g.b), g.playTo, nowIso, nowIso, t.id, nowIso),
      ),
    ])
    .catch(() => undefined);
  const day = await loadDay(ctx.db, t.id);
  if (!americanoRows(day.games).length) bad('tournament_changed', 'This just changed. Look again.');
  return day.games;
}

/** A score from the screen: two whole numbers 0 to 30, not equal (a game has a winner). */
function readScore(raw: unknown, label: string): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0 || n > MAX_SCORE) throw new HttpError(400, 'invalid_score', `Pick a score from 0 to ${MAX_SCORE}.`);
  void label;
  return n;
}
function readPair(body: Record<string, unknown>, first: string, second: string): [number, number] {
  const x = readScore(body[first], first);
  const y = readScore(body[second], second);
  if (x === y) throw new HttpError(400, 'invalid_score', 'A game has a winner. Fix the score.');
  return [x, y];
}

/**
 * POST /api/tournament/game on an Americano night { tournamentId, num, key, action, mine?, theirs? }: a player in that game.
 *   score     Enter score (sent after the card's 5 second Undo): counts at once; the other side is asked "Is this right?"
 *   confirm   "Yes, that's right": the score stands
 *   fix       "No, fix it", then Submit score: their score replaces it (it counts), and the side that entered first is asked
 *   undo      take back our score while the other side has not said Yes
 */
export async function americanoGameAction(ctx: Ctx, who: TournamentActor, t: TournamentRow, playerId: string, body: Record<string, unknown>) {
  const action = v.oneOf(body.action, 'action', ['score', 'confirm', 'fix', 'undo'] as const);
  const num = Number(body.num);
  const tz = who.group.timezone;
  if (!t.final_date || t.status !== 'tickets') bad('tournament_changed', 'This just changed. Look again.');
  const real = realTimes(t);
  // Results open 15 minutes before the start (zip 57's rule) and stay open through the night.
  if (ctx.nowMs < startMsOf(t.final_date!, real.start, tz) - 15 * 60_000) bad('not_started', `Round 1 begins at ${clockLabel(real.start)}.`);
  const night = await readNight(ctx.db, t);
  // The game as the screen showed it: same number, same four players (else the schedule changed: look again).
  const before = amFacts(t, night.signups, night.tickets, night.games, tz, ctx.nowMs);
  const seen = before.games.find((g) => g.num === num);
  if (!seen || !sideOf(seen, playerId) || before.gone.has(playerId)) bad('not_your_game', 'That is not your game. Look again.');
  // The screen sends the game's key (its four players): a schedule that changed in between is caught.
  if (body.key !== gameKey(seen!)) bad('tournament_changed', 'The rounds just changed. Look again.');
  if (seen!.skipped) bad('tournament_changed', 'That game is off. Look again.');
  // Only the round being played (or one before it): a later round's score waits until its round comes.
  if (action === 'score' && seen!.round > before.roundNow) bad('not_yet', `Round ${seen!.round} has not started. Finish Round ${before.roundNow} first.`);
  // Yes and No, fix it answer the score the screen showed ("Is this right?"), sent back from this player's side: a score that changed since is
  // not confirmed or replaced ("look again").
  const shown = action === 'confirm' || action === 'fix' ? readPair({ mine: (body.shown as { mine?: unknown } | undefined)?.mine, theirs: (body.shown as { theirs?: unknown } | undefined)?.theirs }, 'mine', 'theirs') : null;
  // A bad score is refused before anything is written.
  const sent = action === 'score' || action === 'fix' ? readPair(body, 'mine', 'theirs') : null;
  const rows = action === 'score' ? await ensureRows(ctx, t, night, ctx.nowIso) : night.games;
  const row = americanoRows(rows).find((r) => r.num === num);
  if (!row) bad('tournament_changed', 'This just changed. Look again.');
  const g = fromRow(row!);
  if (pairSlot(g.a) !== pairSlot(seen!.a) || pairSlot(g.b) !== pairSlot(seen!.b)) bad('tournament_changed', 'The rounds just changed. Look again.');
  const side = sideOf(g, playerId)!;
  const other = side === 'a' ? 'b' : 'a';
  const stamp = row!.updated_at;
  const run = (sql: string, ...values: unknown[]) =>
    ctx.db.prepare(`UPDATE tournament_games SET ${sql}, updated_at = ? WHERE id = ? AND updated_at = ? AND skipped = 0 AND winner IS NULL AND EXISTS (SELECT 1 FROM tournaments tt WHERE tt.id = tournament_games.tournament_id AND tt.status = 'tickets')`).bind(...values, ctx.nowIso, row!.id, stamp).run();
  const asAB = (mine: number, theirs: number): [number, number] => (side === 'a' ? [mine, theirs] : [theirs, mine]);
  if (g.winner) {
    if (action === 'undo') return { ok: true, result: 'nothing' };
    // The same score again (both sides entered it): nothing to change.
    if (action === 'confirm') return { ok: true, result: 'confirm' };
    if (action === 'score' || action === 'fix') {
      const [x, y] = asAB(...sent!);
      if (x === g.scoreA && y === g.scoreB) return { ok: true, result: action };
    }
    bad('decided', `That score is in. Ask ${firstName(who.group)}.`);
  }
  let res: { meta?: { changes?: number } } | undefined;
  let words = '';
  if (action === 'score') {
    const [x, y] = asAB(...sent!);
    if (g.claim === other) {
      // The other side already entered one: the same score is their Yes; another score waits for the screen to ask.
      if (x === g.scoreA && y === g.scoreB) res = await run("winner = ?, disputed_at = NULL, result_at = ?, result_by = 'players'", x > y ? 'a' : 'b', ctx.nowIso);
      else bad('already_claimed', `${nameOf(before, g.claimBy ?? '')} entered a score. Look again.`);
    } else if (g.claim === side) {
      // Our side already entered one (a partner): the same score changes nothing; another one is refused (the screen shows what is in).
      if (x === g.scoreA && y === g.scoreB) return { ok: true, result: 'score' };
      bad('already_claimed', `${nameOf(before, g.claimBy ?? '')} entered ${Math.max(g.scoreA ?? 0, g.scoreB ?? 0)} to ${Math.min(g.scoreA ?? 0, g.scoreB ?? 0)}. Look again.`);
    } else res = await run('claim = ?, claim_by = ?, claim_at = ?, score_a = ?, score_b = ?, disputed_at = NULL', side, playerId, ctx.nowIso, x, y);
    words = `${pairNames(before, x > y ? g.a : g.b).join(' + ')} won ${Math.max(x, y)} to ${Math.min(x, y)}`;
  } else if (action === 'confirm') {
    if (g.claim !== other || g.scoreA === null || g.scoreB === null) bad('tournament_changed', 'This just changed. Look again.');
    if (asAB(...shown!).join() !== [g.scoreA, g.scoreB].join()) bad('tournament_changed', 'The score just changed. Look again.');
    res = await run("winner = ?, disputed_at = NULL, result_at = ?, result_by = 'players'", g.scoreA! > g.scoreB! ? 'a' : 'b', ctx.nowIso);
    words = `${pairNames(before, g.scoreA! > g.scoreB! ? g.a : g.b).join(' + ')} won ${Math.max(g.scoreA!, g.scoreB!)} to ${Math.min(g.scoreA!, g.scoreB!)} (confirmed)`;
  } else if (action === 'fix') {
    if (g.claim !== other) bad('tournament_changed', 'This just changed. Look again.');
    if (asAB(...shown!).join() !== [g.scoreA, g.scoreB].join()) bad('tournament_changed', 'The score just changed. Look again.');
    const [x, y] = asAB(...sent!);
    if (x === g.scoreA && y === g.scoreB) res = await run("winner = ?, disputed_at = NULL, result_at = ?, result_by = 'players'", x > y ? 'a' : 'b', ctx.nowIso);
    else res = await run('claim = ?, claim_by = ?, claim_at = ?, score_a = ?, score_b = ?, disputed_at = ?', side, playerId, ctx.nowIso, x, y, ctx.nowIso);
    words = `changed the score to ${Math.max(x, y)} to ${Math.min(x, y)} for ${pairNames(before, x > y ? g.a : g.b).join(' + ')}`;
  } else {
    if (g.claim !== side) return { ok: true, result: 'nothing' };
    res = await run('claim = NULL, claim_by = NULL, claim_at = NULL, score_a = NULL, score_b = NULL, disputed_at = NULL');
    words = 'took back their score';
  }
  if ((res?.meta?.changes ?? 0) === 0) bad('tournament_changed', 'This just changed. Look again.');
  await logPlayer(ctx, who.group, playerId, 'tournament_result', { tournament: t.name, game: num, round: g.round, result: words, by: 'player' });
  return { ok: true, result: action };
}

/**
 * POST /api/admin/tournament/:id/games on an Americano night (the organizer; zip 57's controls):
 *   score { num, a, b, seen }    set or fix a game's score (both numbers); it stands
 *   confirm { num, seen }         the score waiting for a Yes stands
 *   clear { num, seen }           take the score off (the game is to play again)
 *   apply { fromRound, to }       the Time check: games from that round on are played to 9 or 7 (never the last round)
 *   pause / resume
 *   left { playerId }             a player left: their games still to play are skipped (the others in them get a note)
 */
export async function americanoGamesAction(ctx: Ctx, body: Record<string, unknown>) {
  const group = await organizerOn(ctx);
  const t = await openById(ctx, group);
  const action = v.oneOf(body.action, 'action', ['score', 'confirm', 'clear', 'apply', 'pause', 'resume', 'left'] as const);
  const nowIso = ctx.nowIso;
  if (action === 'pause' || action === 'resume') {
    await ctx.db.prepare(`UPDATE tournaments SET paused_at = ${action === 'pause' ? '?' : 'NULL'}, updated_at = ? WHERE id = ?`).bind(...(action === 'pause' ? [nowIso] : []), nowIso, t.id).run();
    await audit(ctx.db, group.id, null, action === 'pause' ? 'tournament_paused' : 'tournament_resumed', { tournament: t.name }, nowIso);
    return { ok: true };
  }
  // Scores, Fix, the Time check and Player left are for the night (from 15 minutes before the start, like the players' scores): an earlier
  // tap would write the night's rows before the list of players is final.
  const real = realTimes(t);
  if (!t.final_date || ctx.nowMs < startMsOf(t.final_date, real.start, group.timezone) - 15 * 60_000) bad('not_started', `Round 1 begins at ${clockLabel(real.start)}.`);
  const night = await readNight(ctx.db, t);
  const before = amFacts(t, night.signups, night.tickets, night.games, group.timezone, ctx.nowMs);
  // Bad input is refused before the night's rows are written.
  if ((action === 'score' || action === 'confirm' || action === 'clear') && typeof body.seen !== 'string') throw new HttpError(400, 'invalid_seen', 'Look again.');
  const pair = action === 'score' ? readPair(body, 'a', 'b') : null;
  if (action === 'apply') {
    const from = Number(body.fromRound);
    if (!Number.isInteger(from) || from < 1 || (body.to !== 9 && body.to !== 7)) throw new HttpError(400, 'invalid_apply', 'Pick a round and 9 or 7.');
  }
  if (action === 'left' && !before.roster.includes(v.id(body.playerId, 'playerId'))) bad('tournament_changed', 'They are not in the night.');
  const rows = await ensureRows(ctx, t, night, nowIso);
  const am = americanoRows(rows).map(fromRow);

  if (action === 'apply') {
    const from = Number(body.fromRound);
    const to = Number(body.to);
    if (!Number.isInteger(from) || from < 1 || (to !== 9 && to !== 7)) throw new HttpError(400, 'invalid_apply', 'Pick a round and 9 or 7.');
    const last = Math.max(...am.map((g) => g.round));
    const res = await ctx.db
      .prepare(
        `UPDATE tournament_games SET play_to = ?, updated_at = ? WHERE tournament_id = ? AND slot_a LIKE '%+%' AND round >= ? AND round < ? AND play_to > ?
           AND winner IS NULL AND claim IS NULL AND skipped = 0`,
      )
      .bind(to, nowIso, t.id, from, last, to)
      .run();
    await audit(ctx.db, group.id, null, 'tournament_time_check', { tournament: t.name, round: from, to, games: res.meta?.changes ?? 0 }, nowIso);
    return { ok: true, games: res.meta?.changes ?? 0 };
  }

  if (action === 'left') {
    const playerId = v.id(body.playerId, 'playerId');
    if (!before.roster.includes(playerId)) bad('tournament_changed', 'They are not in the night.');
    if (before.gone.has(playerId)) return { ok: true, skipped: 0 };
    const skip = am.filter((g) => !decided(g) && sideOf(g, playerId));
    // Nothing left to play: nothing to skip (their games all count as played; the screen says so).
    if (!skip.length) return { ok: true, skipped: 0 };
    // Only games still exactly as read (no score entered in between: that one stays, it was played).
    const res = await ctx.db.batch(
      skip.map((g) =>
        ctx.db
          .prepare(
            `UPDATE tournament_games SET skipped = 1, winner = NULL, claim = NULL, claim_at = NULL, score_a = NULL, score_b = NULL, disputed_at = NULL,
               claim_by = ?, result_by = 'skipped', result_at = ?, updated_at = ? WHERE id = ? AND updated_at = ? AND winner IS NULL AND claim IS NULL AND skipped = 0`,
          )
          .bind(playerId, nowIso, nowIso, g.row!.id, g.row!.updated_at),
      ),
    );
    if (res.every((r) => (r.meta?.changes ?? 0) === 0)) bad('tournament_changed', 'This just changed. Look again.');
    await audit(ctx.db, group.id, null, 'tournament_player_left', { tournament: t.name, player: nameOf(before, playerId), skipped: skip.length, rounds: skip.map((g) => g.round).join(', ') }, nowIso);
    return { ok: true, skipped: skip.length };
  }

  const num = Number(body.num);
  const g = am.find((x) => x.num === num);
  if (!g) bad('tournament_changed', 'That game is not on the schedule.');
  // What the organizer saw (the screen sends the stamp it showed): a tap on a game that changed since does nothing.
  const seen = typeof body.seen === 'string' ? body.seen : null;
  const showed = before.games.find((x) => x.num === num);
  const stillSame = !!showed && seen === stampOf(showed);
  if (!stillSame) bad('tournament_changed', 'This just changed. Look again.');
  if (g!.skipped) bad('tournament_changed', 'That game is off (someone left).');
  const stamp = g!.row!.updated_at;
  const run = (sql: string, ...values: unknown[]) =>
    ctx.db.prepare(`UPDATE tournament_games SET ${sql}, updated_at = ? WHERE id = ? AND updated_at = ? AND skipped = 0 AND EXISTS (SELECT 1 FROM tournaments tt WHERE tt.id = tournament_games.tournament_id AND tt.status = 'tickets')`).bind(...values, nowIso, g!.row!.id, stamp).run();
  let res;
  let details: Record<string, unknown>;
  if (action === 'score') {
    const [x, y] = pair!;
    res = await run("score_a = ?, score_b = ?, winner = ?, claim = NULL, claim_by = NULL, claim_at = NULL, disputed_at = NULL, result_at = ?, result_by = 'organizer'", x, y, x > y ? 'a' : 'b', nowIso);
    details = { score: `${Math.max(x, y)} to ${Math.min(x, y)}`, winnerPlayers: pairNames(before, x > y ? g!.a : g!.b).join(' + ') };
  } else if (action === 'confirm') {
    if (!g!.claim || g!.scoreA === null || g!.scoreB === null) bad('tournament_changed', 'No score is waiting. Look again.');
    res = await run("winner = ?, disputed_at = NULL, result_at = ?, result_by = 'organizer'", g!.scoreA! > g!.scoreB! ? 'a' : 'b', nowIso);
    details = { score: `${Math.max(g!.scoreA!, g!.scoreB!)} to ${Math.min(g!.scoreA!, g!.scoreB!)}`, winnerPlayers: pairNames(before, g!.scoreA! > g!.scoreB! ? g!.a : g!.b).join(' + '), confirmed: true };
  } else {
    res = await run('score_a = NULL, score_b = NULL, winner = NULL, claim = NULL, claim_by = NULL, claim_at = NULL, disputed_at = NULL, result_at = NULL, result_by = NULL');
    details = { cleared: true };
  }
  if ((res.meta?.changes ?? 0) === 0) bad('tournament_changed', 'This just changed. Look again.');
  await audit(ctx.db, group.id, null, 'tournament_result', { tournament: t.name, game: num, round: g!.round, ...details, by: 'organizer' }, nowIso);
  return { ok: true };
}

/** Zip 61: the night has Americano rows (switching back to Locked doubles then stops: the rounds have started). */
export async function americanoStarted(db: D1Database, tournamentId: string): Promise<boolean> {
  const row = await db.prepare("SELECT 1 AS x FROM tournament_games WHERE tournament_id = ? AND slot_a LIKE '%+%' LIMIT 1").bind(tournamentId).first().catch(() => null);
  return !!row;
}
