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
import { type AdminRoundGame, type AdminRoundsView, type CourtNow, type PlayerRound, type PlayerRoundsView, shortAlertOf } from '../shared/tournament';
import { claimTime, isPinText, pinOf, pinText, rollCourts } from '../shared/rollingCourts';
import { firstAnswer, saidScore } from '../shared/partnerTaps';
import { MAX_SCORE } from '../shared/scores';
import { americanoNight, bonusRound, gamesDiffer, isAmericanoSlot, pairSlot, pointsTable, slotPair, winLoss } from '../shared/americanoSchedule';
import { americanoPlan, BREAK_MINUTES, clockLabel, type GameTo, ROUND_MINUTES, WARM_UP } from '../shared/tournamentPlan';
import { type RoundState, timeCheck, timeCheckWords } from '../shared/tournamentSchedule';
import { breakStarts, breakState, measuredPace, paceForCheck, pacing, type PaceResult, type PaceRound } from '../shared/smartPacing';
import { startMsOf } from '../shared/tournamentTickets';
import type { TicketWithName } from './tournamentMoney';
import { breakView, courtNumbersOf, type GameRow, LIVE_AFTER_MS, LIVE_BEFORE_MS, loadDay, lockedInIds, skipBreakWrite } from './tournamentDay';
import { firstName, logPlayer, nightOver, nightStartMs, organizerOn, openById, realTimes, todayKey, type SignupRow, type TournamentActor, type TournamentRow } from './tournament';

/** Zip 88: the answer to a score for a game still waiting for a court (it was "Finish Round N first" before rolling courts). */
export const NOT_ON_COURT = 'That game is not on a court yet.';

/** A game still playing this many minutes past its round's time is late on the organizer's card ("8 min over"). */
export const LATE_WAIT_MIN = 5;
/** Highest score a side can enter (a game to 11 that runs on, win by 2): one number for the server and both screens (shared/scores.ts). */
export { MAX_SCORE };

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
  winner: 'a' | 'b' | null;
  resultAt: string | null;
  skipped: boolean;
  /** Skipped because this player left (or is no longer locked in). */
  leftBy: string | null;
  row: GameRow | null;
  /** Zip 88 (rolling courts): it reached a court (it is on one now, or it was). `court` is then the court it really got; else the plan's. */
  started: boolean;
  /** On a court right now (playing, no score yet). */
  live: boolean;
  /** When it went on its court (ms; -Infinity: the night opened with it). */
  startMs: number | null;
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
/** A score that counts for the table (Zip 71: the first score counts; a score saved before Zip 71 that was never answered counts too). */
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
    winner: r.winner === 'a' || r.winner === 'b' ? r.winner : null,
    resultAt: r.result_at,
    skipped: !!r.skipped,
    leftBy: r.skipped ? (x.claim_by ?? null) : null,
    row: r,
    started: false,
    live: false,
    startMs: null,
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
  /** Zip 88: each court now (the game on it, the last it finished). */
  courtsNow: CourtNow[];
  /** Zip 89: the planned rounds (the rest are bonus rounds the organizer added), the live pace and the bonus offer. */
  plannedRounds: number;
  pace: PaceResult;
  /** Zip 89: Round 1 is being played ("Warm up 5 to 10 min, then play."), and the break on now (the round after it, until when: ms). */
  warmUp: boolean;
  breakNow: { round: number; until: number } | null;
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
      winner: null,
      resultAt: null,
      skipped: false,
      leftBy: null,
      row: null,
      started: false,
      live: false,
      startMs: null,
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
  // Zip 88: ROLLING COURTS (shared/rollingCourts.ts). Which game is on which court, replayed from the moments games finished: a result's
  // result_at (kept as it was when a score is fixed or cleared, so a cleared game still counts as played on its court), a Player left's skip
  // time. A game called off by a rule with no time (no longer locked in) is simply not part of the replay.
  // Zip 89 (Alex): BREAKS when nobody sits (everyone on court every round): the round after every 2nd round waits 5 minutes from the moment the
  // round before it is fully scored (shared/smartPacing.ts breakStarts); Skip break puts it on its courts at once (saved courts).
  const doneMsOf = (list: AmGame[]) => {
    const times = list.map((g) => g.resultAt ?? claimTime(g.claimAt)).filter((x): x is string => !!x);
    return list.length && list.every(decided) && times.length ? Math.max(...times.map((x) => Date.parse(x))) : null;
  };
  const byRound = new Map<number, AmGame[]>();
  for (const g of games) byRound.set(g.round, [...(byRound.get(g.round) ?? []), g]);
  const noSit = americanoPlan(Math.max(4, (stored.length ? inGames : locked).length), courtsOf(t), real.minutes).noSit && !gone.size;
  const breaks = breakStarts(new Map([...byRound].map(([r, list]) => [r, { games: list.length, doneMs: doneMsOf(list) }])), courtsOf(t), noSit);
  const roll = rollCourts(
    games.map((g) => {
      const at = g.resultAt ?? claimTime(g.claimAt);
      const finished = decided(g) || !!g.resultAt;
      // Zip 88 (Alex): a game whose court is saved keeps it (the row's court and claim_at, saved after every write).
      const pin = g.row ? pinOf(g.row.claim_at, g.row.court) : undefined;
      return {
        num: g.num,
        round: g.round,
        rank: 0,
        players: [...g.a, ...g.b],
        // A game off with no time (a player no longer locked in): gone, unless it is saved on a court: then it leaves that court now.
        doneAt: finished ? (at ? Date.parse(at) : -1e15) : g.skipped && pin ? nowMs : null,
        ...(g.skipped && !at && !pin ? { gone: true } : {}),
        ...(pin ? { pin } : {}),
        ...(breaks.has(g.round) ? { from: breaks.get(g.round)! } : {}),
      };
    }),
    courtsOf(t),
    nowMs,
  );
  const roundBegan = new Map<number, number>();
  for (const [num, ms] of roll.startAt) {
    const r = games.find((g) => g.num === num)?.round;
    if (r !== undefined && Number.isFinite(ms)) roundBegan.set(r, Math.min(roundBegan.get(r) ?? Infinity, ms));
  }
  const brk = breakState(breaks, roundBegan, nowMs);
  const liveNow = new Set(roll.onCourt.filter((x): x is number => x !== null));
  games = games.map((g) => (roll.court.has(g.num) ? { ...g, court: roll.court.get(g.num)!, started: true, live: liveNow.has(g.num), startMs: roll.startAt.get(g.num)! } : g));
  const courtsNow: CourtNow[] = roll.onCourt.map((num, i) => ({ court: i + 1, num, last: roll.lastOn[i] }));
  const byName = (x: string, y: string) => (names.get(x) ?? '').localeCompare(names.get(y) ?? '') || x.localeCompare(y);
  const roster = (stored.length ? inGames : locked).sort(byName);
  const rounds = Math.max(0, ...games.map((g) => g.round));
  const sits = new Map<number, string[]>();
  for (let r = 1; r <= rounds; r++) {
    const on = new Set(games.filter((g) => g.round === r && !g.skipped).flatMap((g) => [...g.a, ...g.b]));
    sits.set(r, roster.filter((id) => !on.has(id) && !gone.has(id)));
  }
  const plan = americanoPlan(Math.max(4, roster.length), courtsOf(t), real.minutes);
  // Zip 88: the night starts at the planned start, or when the organizer tapped Start now (nightStartMs).
  const started = nowMs >= nightStartMs(t, tz);
  const over = nightOver(t, tz, nowMs);
  const anyResult = games.some((g) => !!g.winner || !!g.claim || (g.skipped && !!g.row?.skipped));
  const open = games.filter((g) => !decided(g));
  const roundNow = open.length ? Math.min(...open.map((g) => g.round)) : Infinity;
  // The Time check, counted in rounds; the last round is never shortened.
  const states: RoundState[] = [];
  for (let r = 1; r <= rounds; r++) {
    const list = games.filter((g) => g.round === r);
    const times = list.map((g) => g.resultAt ?? claimTime(g.claimAt)).filter((x): x is string => !!x);
    const done = list.every(decided);
    states.push({
      round: r,
      pool: true,
      playTo: Math.max(...list.map((g) => g.playTo), 7) as GameTo,
      done,
      anyResult: list.some((g) => !!g.winner || !!g.claim),
      doneAt: done && times.length && t.final_date ? minuteOf(t, tz, Math.max(...times.map((x) => Date.parse(x)))) : undefined,
      // Zip 89: the night's last round is never shortened, unless the night has bonus rounds (then every round may be: it was offered on the
      // night's pace, and a night that slows down afterwards must still finish inside the courts' time).
      keep: r === rounds && !(stored.length > 0 && rounds > Math.min(rounds, plan.rounds)),
      // Zip 89: a break before it (5 planned, or as taken).
      ...(noSit && r > 1 && (r - 1) % 2 === 0 ? { gap: brk.taken.get(r) ?? BREAK_MINUTES } : {}),
    });
  }
  // Zip 89: the planned rounds are the plan's (a stored night beyond them has bonus rounds); the night's real start (Start now included) and its
  // measured pace. With a bonus round in the night, the Time check counts the rounds still to play at that pace (shared/tournamentSchedule.ts).
  const plannedRounds = Math.min(rounds, plan.rounds);
  const startMin = t.final_date ? minuteOf(t, tz, nightStartMs(t, tz)) : real.start;
  const nowMin = t.final_date ? minuteOf(t, tz, nowMs) : real.start;
  // Zip 89: Round 1 is measured from the start + the warm-up; a round after a break from the break's end (the pace never counts either).
  const paceRounds: PaceRound[] = states.map((s) => ({
    round: s.round,
    planned: s.round <= plannedRounds,
    done: s.done,
    doneAt: s.doneAt,
    minutes: ROUND_MINUTES[s.playTo] ?? ROUND_MINUTES[11],
    ...(s.round === 1 ? { pauseBefore: WARM_UP } : s.gap ? { pauseBefore: s.gap } : {}),
  }));
  const measured = measuredPace(paceRounds, startMin);
  const bonusIn = stored.length > 0 && rounds > plannedRounds;
  const check =
    started && !over && !t.paused_at && rounds && t.final_date
      ? timeCheck(states, real.start + WARM_UP, real.start + real.minutes, nowMin, paceForCheck(bonusIn, measured.pace, measured.done, measured.latest))
      : null;
  const lowered = games.filter((g) => !decided(g) && g.playTo < plan.gameTo);
  const shorter = lowered.length ? { fromRound: Math.min(...lowered.map((g) => g.round)), to: Math.min(...lowered.map((g) => g.playTo)) as GameTo } : null;
  // Zip 89: THE OFFER (shared/smartPacing.ts): one more round, only once the rows are written (a round is in) and while 4 or more are still in.
  const pace = pacing({
    rounds: paceRounds,
    startMin,
    endMin: real.start + real.minutes,
    nowMin,
    // (A night planned too tight, games to 7 from the start, is never offered more: review.)
    kind: stored.length > 0 && plan.fits && inGames.filter((id) => !gone.has(id)).length >= 4 ? 'round' : null,
    bonusMinutes: ROUND_MINUTES[plan.gameTo],
    started,
    over,
    paused: !!t.paused_at,
    behind: !!check?.suggest || !!shorter || (check?.behind ?? 0) > 0,
    leftOpen: false,
    breaks: noSit,
    onBreak: brk.now ? Math.max(0.1, (brk.now.until - nowMs) / 60_000) : 0,
    // When the last bonus round was added (its rows' save time).
    lastBonusAt: lastAddedAt(t, tz, games.filter((g) => g.round > plannedRounds && g.row).map((g) => g.row!.created_at)),
  });
  const roundStart = new Map<number, number>();
  let at = real.start + WARM_UP;
  for (const s of states) {
    const prev = states.find((x) => x.round === s.round - 1);
    const begin = Math.max(at + (s.gap ?? 0), (prev?.doneAt ?? at) + (s.gap ?? 0));
    roundStart.set(s.round, begin);
    at = begin + ROUND_MINUTES[s.playTo];
  }
  // Zip 89: Round 1's warm-up line, and the break on now.
  const warmUp = started && !over && roundNow === 1;
  return { stored: stored.length > 0, games, rounds, roster, names, gone, sits, plan, started, over, roundNow, anyResult, check, shorter, start: real.start, end: real.start + real.minutes, roundStart, courtsNow, plannedRounds, pace, warmUp, breakNow: started && !over && !t.paused_at ? brk.now : null };
}

/** Zip 89: the latest of these save times, in minutes after midnight of the night (null: none). */
export function lastAddedAt(t: TournamentRow, tz: string, times: readonly string[]): number | null {
  const ms = times.map((x) => Date.parse(x)).filter((x) => Number.isFinite(x));
  return ms.length && t.final_date ? minuteOf(t, tz, Math.max(...ms)) : null;
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

/**
 * THE live standings rows: the points table (wins, or win % when game counts differ, then points; ties keep name order), as the organizer's own
 * phone sees them during the night and (Zip 82) the organizer's Standings sheet. The order End saves (and the reveal board shows) is this table
 * with Edit awards' 1st and 2nd on top.
 */
export function standingsOf(f: AmFacts, playerId: string | null, table = tableOf(f)): PlayerRoundsView['standings'] {
  return table.map((r) => ({
    rank: r.rank,
    name: nameOf(f, r.id),
    record: winLoss(r),
    points: r.points,
    ...(playerId && r.id === playerId ? { me: true as const } : {}),
    ...(r.tied ? { tied: true as const } : {}),
    ...(f.gone.has(r.id) ? { out: true as const } : {}),
  }));
}

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
  /**
   * Zip 77, who sees the standings: 'hidden' (every player during the night: the table is not sent at all, the reveal shows it), 'live' (the
   * organizer's own player on the organizer's own signed-in phone: he catches wrong scores there), 'final' (after Reveal standings, the night's
   * board and Standings card).
   */
  mode: 'hidden' | 'live' | 'final' = 'hidden',
): PlayerRoundsView | null {
  const f = amFacts(t, signups, tickets, rows, tz, nowMs);
  if (!f.roster.includes(playerId) && !f.gone.has(playerId)) return null;
  const real = realTimes(t);
  const startMs = t.final_date ? startMsOf(t.final_date, real.start, tz) : Infinity;
  // Zip 77 (review): `today` keeps its own window after the reveal too (Home folds the week's games only on the night); the revealed card
  // shows whatever the clock says (src/tournament/RoundsView.tsx checks the reveal first). Zip 88: from Start now's tap too, when earlier.
  const today = nowMs >= Math.min(startMs - LIVE_BEFORE_MS, nightStartMs(t, tz)) && nowMs < startMs + real.minutes * 60_000 + LIVE_AFTER_MS;
  const me = nameOf(f, playerId);
  const rounds: PlayerRound[] = [];
  let first = true;
  for (let r = 1; r <= f.rounds; r++) {
    const g = f.games.find((x) => x.round === r && sideOf(x, playerId));
    if (!g || (g.skipped && f.gone.has(playerId) && g.leftBy === playerId)) {
      if (f.gone.has(playerId) && (!g || g.leftBy === playerId)) continue;
      // A break: over once the night has moved past this round, or (Zip 88, rolling courts) once this player's next game is on a court.
      const done = r < f.roundNow || f.games.some((x) => x.round > r && sideOf(x, playerId) && (x.started || decided(x)));
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
    rounds.push({
      round: r,
      num: g.num,
      key: gameKey(g),
      // Zip 88: a game's court is known once it is on one (rolling courts can move a game to the court that frees up first).
      court: g.started ? courtNo(t, g.court) : null,
      partner: nameOf(f, partner),
      opponents: [nameOf(f, opp[0]), nameOf(f, opp[1])],
      state: done ? 'done' : first ? 'next' : 'later',
      ...(scored ? { won: mine! > theirs!, score: { mine: mine!, theirs: theirs! } } : {}),
      playTo: g.playTo,
      ...(g.skipped ? { skipped: true as const } : {}),
      // Zip 88: Enter score as soon as the game is on a court (a score cleared by the organizer can be entered again).
      ...(!done && f.started && g.started ? { onNow: true as const } : {}),
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
        .filter((g) => g.live && !sideOf(g, playerId))
        .map((g) => ({ round: g.round, court: courtNo(t, g.court), a: pairNames(f, g.a), b: pairNames(f, g.b) }))
    : [];
  // Zip 77: before the reveal a player's answer carries no table at all (names, records, points and ranks stay on the server).
  const standings = mode === 'hidden' ? [] : standingsOf(f, playerId);
  // Someone left and this player's game with them is off: one plain note (per player who left).
  const offs = f.games.filter((g) => g.skipped && g.leftBy && g.leftBy !== playerId && sideOf(g, playerId));
  const leaver = offs[0]?.leftBy ?? null;
  const mineOff = leaver ? offs.filter((g) => g.leftBy === leaver).map((g) => g.round) : [];
  // Zip 77: after the reveal nothing about the night's time is said any more.
  const note = mode === 'final' ? undefined : shorterNote(f);
  // Zip 74 (picture pair-3): the shorter games alert at the top of Home (Americano's last round is never shortened, so it is not part of it).
  const shortAlert = mode !== 'final' && today && f.started && !f.over ? shortAlertOf(t.id, f.games.map((g) => ({ round: g.round, playTo: g.playTo, pool: true, decided: decided(g) })), f.plan.gameTo) : undefined;
  return {
    kind: 'americano',
    me,
    rounds,
    started: f.started,
    today,
    beginsAt: clockLabel(real.start),
    // Zip 88: game day, the night not started (planned or Start now): "Games start soon", with its countdown in the last 30 minutes.
    ...(t.final_date && t.final_date === todayKey(nowMs, tz) && !f.started && !f.over && mode !== 'final' ? { startsSoon: { startsAt: new Date(startMs).toISOString() } } : {}),
    courtsSet: !!courtNumbersOf(t),
    progress: { label, done: doneCount, total: Math.max(1, f.rounds) },
    live,
    standings,
    ...(mode === 'hidden' ? { standingsHidden: true as const } : {}),
    // Zip 77: every game in, not revealed yet, on the night: the "Final standings coming soon" card.
    ...(mode !== 'final' && today && f.started && allIn && f.games.length > 0 ? { waiting: true as const } : {}),
    ...(mode === 'final' ? { final: true as const } : {}),
    ...(note ? { timeNote: note } : {}),
    ...(shortAlert ? { shortAlert } : {}),
    ...(t.paused_at && mode !== 'final' ? { paused: true as const } : {}),
    ...(mode !== 'final' && today && f.warmUp ? { warmUp: true as const } : {}),
    ...(mode !== 'final' && today && f.breakNow ? { breakNow: breakView(f.breakNow, nowMs) } : {}),
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
    // Zip 71/72: no score waits. A score saved before Zip 71 that was never answered is the result (done), like any first score.
    // Zip 88 (rolling courts): playing once it is on a court (a cleared score on a game already played reads as playing too: it needs one).
    const status: AdminRoundGame['status'] = g.skipped ? 'skipped' : g.winner || g.claim ? 'done' : f.started && g.started ? 'playing' : 'later';
    let late: string | undefined;
    if (status === 'playing' && g.live) {
      // Zip 89: Round 1 plays after the warm-up.
      const began = (g.startMs !== null && Number.isFinite(g.startMs) && t.final_date ? Math.max(f.start, minuteOf(t, tz, g.startMs)) : f.start) + (g.round === 1 ? WARM_UP : 0);
      const over = Math.floor(nowMin - (began + ROUND_MINUTES[g.playTo as GameTo]));
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
    // Zip 82 (picture 2): the organizer's Standings sheet during the night, the reveal board's rows as they stand (organizer only: a player's
    // answer still carries no table before the reveal).
    standings: standingsOf(f, null, table),
    courtsNow: f.courtsNow,
    sittingNow: sittingNow(f),
    ...(f.pace.offer ? { bonus: f.pace.offer } : {}),
    plannedRounds: f.plannedRounds,
    ...(f.warmUp ? { warmUp: true as const } : {}),
    ...(f.breakNow ? { breakNow: breakView(f.breakNow, nowMs) } : {}),
  };
}

/** Zip 88: who sits now (still in the night, in name order): not on a court, and not in the last game of a court that waits (its Done box). */
function sittingNow(f: AmFacts): string[] {
  const shown = new Set(f.courtsNow.map((c) => c.num ?? c.last).filter((x): x is number => x !== null));
  const on = new Set(f.games.filter((g) => g.live || shown.has(g.num)).flatMap((g) => [...g.a, ...g.b]));
  return f.roster.filter((id) => !on.has(id) && !f.gone.has(id)).map((id) => nameOf(f, id));
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

/**
 * Zip 88 (Alex): SAVE THE COURTS. Every game that is on a court now, or was, gets its court written into its own row (court, and claim_at
 * "on:<when>"), once: from then on it never moves, whatever changes later (a player taken off, a score cleared). Run after every write of the
 * night (and before one that could change who plays). Only rows not saved yet are written; updated_at is not touched, so nobody's screen is
 * told "this just changed". Reads never write: between two writes the rule works the same way from the rows.
 */
export async function saveAmericanoCourts(ctx: Ctx, t: TournamentRow, tz: string): Promise<void> {
  const night = await readNight(ctx.db, t).catch(() => null);
  if (!night || !americanoRows(night.games).length) return;
  const f = amFacts(t, night.signups, night.tickets, night.games, tz, ctx.nowMs);
  const writes = f.games.filter((g) => g.started && g.row && !isPinText(g.row.claim_at));
  if (!writes.length) return;
  await ctx.db.batch(
    writes.map((g) =>
      ctx.db
        .prepare("UPDATE tournament_games SET court = ?, claim_at = ? WHERE id = ? AND (claim_at IS NULL OR claim_at NOT LIKE 'on:%')")
        .bind(g.court, pinText(g.startMs ?? 0), g.row!.id),
    ),
  );
}

/** A score from the screen: two whole numbers 0 to 30, not equal (a game has a winner). Zip 72: Locked doubles uses the same check. */
function readScore(raw: unknown, label: string): number {
  // Zip 72 (review): a real number only; null, "", [] or true never read as 0 or 1.
  const n = typeof raw === 'number' ? raw : NaN;
  if (!Number.isInteger(n) || n < 0 || n > MAX_SCORE) throw new HttpError(400, 'invalid_score', `Pick a score from 0 to ${MAX_SCORE}.`);
  void label;
  return n;
}
export function readPair(body: Record<string, unknown>, first: string, second: string): [number, number] {
  const x = readScore(body[first], first);
  const y = readScore(body[second], second);
  if (x === y) throw new HttpError(400, 'invalid_score', 'A game has a winner. Fix the score.');
  return [x, y];
}

/**
 * POST /api/tournament/game on an Americano night { tournamentId, num, key, action: 'score', mine, theirs }: a player in that game.
 * Zip 71, NO CONFIRMING (Alex, Nov 20): the FIRST score entered by ANY of the 4 players is the result, at once (who entered it is kept in
 * claim_by; the 5 second Undo is on that phone before it is sent). Nobody says Yes or No, fix it. A second score from anyone is refused with who
 * entered it ("Vic entered 11 to 8. Ask Alex to fix it."); the same player sending the same score again (a refresh, two phones) is fine. Only the
 * organizer changes it afterward (Fix, or clear it). The old 'confirm', 'fix' and 'undo' are refused.
 */
export async function americanoGameAction(ctx: Ctx, who: TournamentActor, t: TournamentRow, playerId: string, body: Record<string, unknown>) {
  const action = v.oneOf(body.action, 'action', ['score', 'confirm', 'fix', 'undo'] as const);
  const num = Number(body.num);
  const tz = who.group.timezone;
  if (!t.final_date || t.status !== 'tickets') bad('tournament_changed', 'This just changed. Look again.');
  const real = realTimes(t);
  // Results open 15 minutes before the start (zip 57's rule) and stay open through the night.
  if (ctx.nowMs < nightStartMs(t, tz) - 15 * 60_000) bad('not_started', `Round 1 begins at ${clockLabel(real.start)}.`);
  const night = await readNight(ctx.db, t);
  // The game as the screen showed it: same number, same four players (else the schedule changed: look again).
  const before = amFacts(t, night.signups, night.tickets, night.games, tz, ctx.nowMs);
  const seen = before.games.find((g) => g.num === num);
  if (!seen || !sideOf(seen, playerId) || before.gone.has(playerId)) bad('not_your_game', 'That is not your game. Look again.');
  // The screen sends the game's key (its four players): a schedule that changed in between is caught.
  if (body.key !== gameKey(seen!)) bad('tournament_changed', 'The rounds just changed. Look again.');
  if (seen!.skipped) bad('tournament_changed', 'That game is off. Look again.');
  const org = firstName(who.group);
  // What a refused answer says: who gave the score that stands.
  const standing = (x: AmGame) =>
    x.row?.result_by === 'organizer'
      ? firstAnswer(`${org} set it to ${Math.max(x.scoreA ?? 0, x.scoreB ?? 0)} to ${Math.min(x.scoreA ?? 0, x.scoreB ?? 0)}.`, org)
      : firstAnswer(saidScore(!x.claimBy ? 'Someone' : x.claimBy === playerId ? 'You' : nameOf(before, x.claimBy), x.scoreA ?? 0, x.scoreB ?? 0), org);
  const done = (x: AmGame) => !!x.winner || !!x.claim;
  if (action !== 'score') {
    if (done(seen!)) bad('decided', standing(seen!));
    bad('no_confirm', 'Nothing to confirm. Enter the score.');
  }
  // Zip 88 (rolling courts): a game can be scored as soon as it is on a court; one still waiting for a court cannot.
  if (!seen!.started && !done(seen!)) bad('not_yet', NOT_ON_COURT);
  // A bad score is refused before anything is written.
  const sent = readPair(body, 'mine', 'theirs');
  const rows = await ensureRows(ctx, t, night, ctx.nowIso);
  // Zip 88: the courts as they are, saved before this score moves anything.
  await saveAmericanoCourts(ctx, t, tz);
  // (Saving a court never touches updated_at, so the row as read still guards the write.)
  const row = americanoRows(rows).find((r) => r.num === num);
  if (!row) bad('tournament_changed', 'This just changed. Look again.');
  const g = fromRow(row!);
  if (pairSlot(g.a) !== pairSlot(seen!.a) || pairSlot(g.b) !== pairSlot(seen!.b)) bad('tournament_changed', 'The rounds just changed. Look again.');
  const side = sideOf(g, playerId)!;
  const [x, y] = side === 'a' ? sent : [sent[1], sent[0]];
  const same = (z: AmGame) => z.claimBy === playerId && z.scoreA === x && z.scoreB === y;
  if (done(g)) {
    if (same(g)) return { ok: true, result: 'score' };
    // Someone else entering the same score: refused (it is the second answer), but nothing needs fixing.
    if (g.scoreA === x && g.scoreB === y) bad('decided', standing(g).replace(` Ask ${org} to fix it.`, ' It is in.'));
    bad('decided', standing(g));
  }
  const res = await ctx.db
    .prepare(
      `UPDATE tournament_games SET score_a = ?, score_b = ?, winner = ?, claim = NULL, claim_by = ?, disputed_at = NULL, result_at = COALESCE(result_at, ?), result_by = 'players', updated_at = ?
       WHERE id = ? AND updated_at = ? AND skipped = 0 AND winner IS NULL AND claim IS NULL
         AND EXISTS (SELECT 1 FROM tournaments tt WHERE tt.id = tournament_games.tournament_id AND tt.status = 'tickets')`,
    )
    .bind(x, y, x > y ? 'a' : 'b', playerId, ctx.nowIso, ctx.nowIso, row!.id, row!.updated_at)
    .run();
  if ((res.meta?.changes ?? 0) === 0) {
    // Two phones at once: another score landed first. The same player with the same score: it is in. Anyone else: who entered it.
    const nowRow = await ctx.db.prepare('SELECT * FROM tournament_games WHERE id = ?').bind(row!.id).first<GameRow>().catch(() => null);
    const now = nowRow ? fromRow(nowRow) : null;
    if (now && same(now) && done(now)) return { ok: true, result: 'score' };
    if (now && done(now)) bad('decided', standing(now));
    bad('tournament_changed', 'This just changed. Look again.');
  }
  const words = `${pairNames(before, x > y ? g.a : g.b).join(' + ')} won ${Math.max(x, y)} to ${Math.min(x, y)}`;
  await logPlayer(ctx, who.group, playerId, 'tournament_result', { tournament: t.name, game: num, round: g.round, result: words, by: 'player' });
  // Zip 88: the next games this score put on the courts, saved.
  await saveAmericanoCourts(ctx, t, tz);
  return { ok: true, result: 'score' };
}

/**
 * POST /api/admin/tournament/:id/games on an Americano night (the organizer; zip 57's controls):
 *   score { num, a, b, seen }    set or fix a game's score (both numbers); it stands
 *   clear { num, seen }           take the score off (the game is to play again)
 * (Zip 72: 'confirm' is gone; nothing waits for a Yes since Zip 71.)
 *   apply { fromRound, to }       the Time check: games from that round on are played to 9 or 7 (never the last round)
 *   pause / resume
 *   left { playerId }             a player left: their games still to play are skipped (the others in them get a note)
 *   skipBreak                     Zip 89: the break on now ends at once (the next round goes on its courts)
 *   bonus { key }                 Zip 89: Add a round (the offer the screen showed, by its key): one more round at the end of the night
 */
export async function americanoGamesAction(ctx: Ctx, body: Record<string, unknown>) {
  const group = await organizerOn(ctx);
  const t = await openById(ctx, group);
  const action = v.oneOf(body.action, 'action', ['score', 'clear', 'apply', 'pause', 'resume', 'left', 'bonus', 'skipBreak'] as const);
  const nowIso = ctx.nowIso;
  if (action === 'pause' || action === 'resume') {
    await ctx.db.prepare(`UPDATE tournaments SET paused_at = ${action === 'pause' ? '?' : 'NULL'}, updated_at = ? WHERE id = ?`).bind(...(action === 'pause' ? [nowIso] : []), nowIso, t.id).run();
    await audit(ctx.db, group.id, null, action === 'pause' ? 'tournament_paused' : 'tournament_resumed', { tournament: t.name }, nowIso);
    return { ok: true };
  }
  // Scores, Fix, the Time check and Player left are for the night (from 15 minutes before the start, like the players' scores): an earlier
  // tap would write the night's rows before the list of players is final.
  const real = realTimes(t);
  if (!t.final_date || ctx.nowMs < nightStartMs(t, group.timezone) - 15 * 60_000) bad('not_started', `Round 1 begins at ${clockLabel(real.start)}.`);
  const night = await readNight(ctx.db, t);
  const before = amFacts(t, night.signups, night.tickets, night.games, group.timezone, ctx.nowMs);
  // Bad input is refused before the night's rows are written.
  if ((action === 'score' || action === 'clear') && typeof body.seen !== 'string') throw new HttpError(400, 'invalid_seen', 'Look again.');
  const pair = action === 'score' ? readPair(body, 'a', 'b') : null;
  if (action === 'apply') {
    const from = Number(body.fromRound);
    if (!Number.isInteger(from) || from < 1 || (body.to !== 9 && body.to !== 7)) throw new HttpError(400, 'invalid_apply', 'Pick a round and 9 or 7.');
  }
  if (action === 'left' && !before.roster.includes(v.id(body.playerId, 'playerId'))) bad('tournament_changed', 'They are not in the night.');
  if (action === 'bonus') return addBonusRound(ctx, group, t, before, body);
  // Zip 89: Skip break: the round after the break goes on its courts now (saved courts).
  if (action === 'skipBreak') {
    if (!before.breakNow) bad('tournament_changed', 'The break is over.');
    const rows = before.games.filter((g) => g.round === before.breakNow!.round && !g.started && g.row).map((g) => g.row!);
    const n = await skipBreakWrite(ctx, rows);
    await audit(ctx.db, group.id, null, 'tournament_break_skipped', { tournament: t.name, round: before.breakNow!.round }, nowIso);
    await saveAmericanoCourts(ctx, t, group.timezone);
    return { ok: true, games: n };
  }
  const rows = await ensureRows(ctx, t, night, nowIso);
  // Zip 88: the courts as they are, saved before this tap changes anything (Player left, a cleared score never moves a started game).
  await saveAmericanoCourts(ctx, t, group.timezone);
  const am = americanoRows(rows).map(fromRow);

  if (action === 'apply') {
    const from = Number(body.fromRound);
    const to = Number(body.to);
    if (!Number.isInteger(from) || from < 1 || (to !== 9 && to !== 7)) throw new HttpError(400, 'invalid_apply', 'Pick a round and 9 or 7.');
    // The last round is never shortened, unless the night has bonus rounds (Zip 89: then every round may be).
    const last = Math.max(...am.map((g) => g.round)) + (before.rounds > before.plannedRounds ? 1 : 0);
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
            `UPDATE tournament_games SET skipped = 1, winner = NULL, claim = NULL, score_a = NULL, score_b = NULL, disputed_at = NULL,
               claim_by = ?, result_by = 'skipped', result_at = COALESCE(result_at, ?), updated_at = ? WHERE id = ? AND updated_at = ? AND winner IS NULL AND claim IS NULL AND skipped = 0`,
          )
          .bind(playerId, nowIso, nowIso, g.row!.id, g.row!.updated_at),
      ),
    );
    if (res.every((r) => (r.meta?.changes ?? 0) === 0)) bad('tournament_changed', 'This just changed. Look again.');
    await audit(ctx.db, group.id, null, 'tournament_player_left', { tournament: t.name, player: nameOf(before, playerId), skipped: skip.length, rounds: skip.map((g) => g.round).join(', ') }, nowIso);
    await saveAmericanoCourts(ctx, t, group.timezone);
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
  // Zip 88: a score for a game still waiting for a court is refused (a Fix of a game that has one is always fine).
  if (action === 'score' && !showed!.started && !showed!.winner && !showed!.claim) bad('not_yet', NOT_ON_COURT);
  const stamp = g!.row!.updated_at;
  const run = (sql: string, ...values: unknown[]) =>
    ctx.db.prepare(`UPDATE tournament_games SET ${sql}, updated_at = ? WHERE id = ? AND updated_at = ? AND skipped = 0 AND EXISTS (SELECT 1 FROM tournaments tt WHERE tt.id = tournament_games.tournament_id AND tt.status = 'tickets')`).bind(...values, nowIso, g!.row!.id, stamp).run();
  let res;
  let details: Record<string, unknown>;
  if (action === 'score') {
    const [x, y] = pair!;
    // Zip 88: a Fix keeps the moment the game first finished (result_at): rolling courts replay the night from those moments.
    res = await run("score_a = ?, score_b = ?, winner = ?, claim = NULL, claim_by = NULL, disputed_at = NULL, result_at = COALESCE(result_at, ?), result_by = 'organizer'", x, y, x > y ? 'a' : 'b', nowIso);
    details = { score: `${Math.max(x, y)} to ${Math.min(x, y)}`, winnerPlayers: pairNames(before, x > y ? g!.a : g!.b).join(' + ') };
  } else {
    // Zip 88: Clear keeps result_at: the game was played on its court (the courts stay as they were); it needs a score again.
    res = await run('score_a = NULL, score_b = NULL, winner = NULL, claim = NULL, claim_by = NULL, disputed_at = NULL, result_by = NULL');
    details = { cleared: true };
  }
  if ((res.meta?.changes ?? 0) === 0) bad('tournament_changed', 'This just changed. Look again.');
  await audit(ctx.db, group.id, null, 'tournament_result', { tournament: t.name, game: num, round: g!.round, ...details, by: 'organizer' }, nowIso);
  await saveAmericanoCourts(ctx, t, group.timezone);
  return { ok: true };
}

/**
 * Zip 89: ADD A ROUND (the organizer's tap on "Ahead of time"). Only the offer the screen showed (its key) while it still stands (the same checks,
 * now): one more round after the last one, new partners (shared/americanoSchedule.ts bonusRound), played to the plan's length. Written once:
 * the next game numbers are unique, and a round added by anyone else since the read stops this one. It is then a normal round (the bars, All
 * rounds, the phones and the standings include it); it is never taken away by itself. No money moves.
 */
async function addBonusRound(ctx: Ctx, group: { id: string; timezone: string }, t: TournamentRow, before: AmFacts, body: Record<string, unknown>) {
  const key = typeof body.key === 'string' ? body.key : '';
  if (!before.stored || !before.pace.offer || before.pace.offer.key !== key) bad('tournament_changed', 'This just changed. Look again.');
  const played = before.games.map((g) => ({ round: g.round, court: g.court, a: g.a, b: g.b, skipped: g.skipped }));
  const round = bonusRound(played, before.roster, before.gone, courtsOf(t), t.id);
  if (!round || !round.length) bad('few_players', 'Needs at least 4 players still in.');
  const last = Math.max(...before.games.map((g) => g.round));
  const first = Math.max(...before.games.map((g) => g.num)) + 1;
  const nowIso = ctx.nowIso;
  // Guarded: no round after `last` written by anyone else (this batch's own rows carry its own time); the unique game numbers refuse a copy too.
  const none = 'NOT EXISTS (SELECT 1 FROM tournament_games WHERE tournament_id = ? AND round > ? AND created_at <> ?)';
  const ok = await ctx.db
    .batch(
      round!.map((g, i) =>
        ctx.db
          .prepare(
            `INSERT INTO tournament_games (id, tournament_id, num, round, court, stage, pool, slot_a, slot_b, play_to, skipped, created_at, updated_at)
             SELECT ?, ?, ?, ?, ?, 'pool', NULL, ?, ?, ?, 0, ?, ? WHERE ${none}
               AND EXISTS (SELECT 1 FROM tournaments tt WHERE tt.id = ? AND tt.status = 'tickets')`,
          )
          .bind(newId(), t.id, first + i, last + 1, g.court, pairSlot(g.a), pairSlot(g.b), before.plan.gameTo, nowIso, nowIso, t.id, last, nowIso, t.id),
      ),
    )
    .then((r) => r.reduce((n, x) => n + (x.meta?.changes ?? 0), 0))
    .catch(() => 0);
  if (ok !== round!.length) bad('tournament_changed', 'This just changed. Look again.');
  await audit(ctx.db, group.id, null, 'tournament_bonus_round', { tournament: t.name, round: last + 1, games: round!.length, pace: Math.round(before.pace.pace ?? 0) }, nowIso);
  await saveAmericanoCourts(ctx, t, group.timezone);
  return { ok: true, round: last + 1 };
}

/** Zip 61: the night has Americano rows (switching back to Locked doubles then stops: the rounds have started). */
export async function americanoStarted(db: D1Database, tournamentId: string): Promise<boolean> {
  const row = await db.prepare("SELECT 1 AS x FROM tournament_games WHERE tournament_id = ? AND slot_a LIKE '%+%' LIMIT 1").bind(tournamentId).first().catch(() => null);
  return !!row;
}
