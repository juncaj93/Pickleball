// Zip 57 (🎾57.tourney3): THE GAME PLAN, the single source of truth for how a tournament night fits on the courts (reference/GAME_PLAN_TABLE.md
// in the zip, copied word for word into tests/zip57-plan.test.ts, which checks EVERY row of that table against these functions). One pure
// function of (players, courts, court minutes, style): rounds, the game length for pool or round robin games, the minutes used, and whether it
// fits. The Finalize screen's "Fits / Too tight" line, the check when tickets close, the schedule (shared/tournamentSchedule.ts) and the Time
// check all read it, so they always agree.
//
// Its own file on purpose: the player download reads shared/tournament.ts, so this stays out of it (only the organizer file, the player's
// tournament file and the server import it).

/**
 * One round, changeover included, by the points a game is played to (the table's RULES). Zip 89 (Alex, Nov 24: his group played 9 games to 11 in
 * 2 hours, about 13 minutes a game; rec doubles to 11 runs 18 to 25): an honest 20 minutes a round to 11 (was 23), 16 to 9 (was 19), 13 to 7
 * (was 16). A night that runs faster gets bonus rounds early (shared/smartPacing.ts), never a surprise round at the end.
 * Zip 97 (Alex, Nov 26: "real pace"; his group plays about 13 minutes a game to 11 on regular nights): REGULAR games (pool / round robin rounds,
 * Americano rounds) 17 to 11 (was 20), 14 to 9 (was 16), 11 to 7 (was 13). Playoff games keep PLAYOFF_MINUTES (20), never shortened.
 */
export const ROUND_MINUTES = { 11: 17, 9: 14, 7: 11 } as const;
/** Zip 97: one PLAYOFF game or round (semifinals, the Final, 3rd place, a best of 3's games), always to 11: still planned at 20 minutes (a playoff
 *  game is closer and the night's last; the Time check never shortens it). */
export const PLAYOFF_MINUTES = 20;
export type GameTo = keyof typeof ROUND_MINUTES;
/** Longest first: the plan uses the longest game that fits. */
export const GAME_LENGTHS: readonly GameTo[] = [11, 9, 7];
/** Minutes of court time kept free after the planned last game (awards, overrun; Zip 89: 20, was 10). */
export const END_BUFFER = 20;
/** Zip 89 (Alex): minutes at the start of every night for people arriving and warming up (Start now gets it too). Round 1 shows "Warm up 5 to
 *  10 min, then play."; the live pace never counts it. */
export const WARM_UP = 10;
/** Zip 89 (Alex): a break after every 2nd round on a night where nobody sits (every player plays every round), minutes. */
export const BREAK_MINUTES = 5;
/** Plan budget: the booked minutes less the warm-up and the end buffer (Zip 89). */
export const planBudget = (minutes: number): number => minutes - WARM_UP - END_BUFFER;
/** Breaks a night of `rounds` rounds takes when nobody sits: one after every 2nd round, never after the last. */
export const breaksFor = (rounds: number, noSit: boolean): number => (noSit ? Math.max(0, Math.floor((rounds - 1) / 2)) : 0);
/** Semifinals, the Final and the 3rd place game are always to 11. */
export const PLAYOFF_TO: GameTo = 11;
/**
 * Zip 80: minutes one tie game takes (Game A or Game B, played to 5; the wheel's games). ROUND_MINUTES's step from 9 to 7 carried down to 5 (Zip
 * 89: 13 at 7, 16 at 9, so 10 at 5; it was 13 with the old table). A tie is not in the plan made before the night (nobody knows there will be
 * one); once its games exist the Time check and the night's times count them. Zip 97: with 17 / 14 / 11, 8 minutes.
 */
export const TIE_MINUTES = ROUND_MINUTES[7] - (ROUND_MINUTES[9] - ROUND_MINUTES[7]);
/** Americano: every player gets at least this many games. */
export const AMERICANO_MIN_GAMES = 4;
/** The sizes a tournament night is planned for. */
export const MIN_PLAYERS = 6;
export const MAX_PLAYERS = 16;

export type PlanStyle = 'doubles' | 'americano';

/** How a Locked doubles night is built, by the number of teams (players / 2). */
export type DoublesShape = 'rr3' | 'rr' | 'pools';

export interface DoublesStructure {
  teams: number;
  shape: DoublesShape;
  /** Rounds of pool or round robin games (one game per court per round). */
  poolRounds: number;
  /** Rounds after it: semifinals, then the Final (and the 3rd place game on 2 courts). */
  playoffRounds: number;
  /** Courts the night really uses (3 teams play one game at a time, so a second court adds nothing). */
  courtsUsed: number;
  /** A 3rd place game is played (only with 2 courts and 4 teams or more). */
  third: boolean;
  /** Semifinals are played (6 teams or more). */
  semis: boolean;
}

/**
 * The table's LOCKED DOUBLES rules as numbers:
 *   3 teams       everyone plays the other two (3 games, one at a time), then the top 2 play the Final
 *   4 teams       round robin (3 rounds on 2 courts; 6 games one after another on 1), then Final (and 3rd place on 2 courts)
 *   5 teams       round robin (5 rounds on 2 courts, one team sits each round; 10 games on 1), then Final (and 3rd place)
 *   6, 7, 8 teams two pools (3+3, 4+3, 4+4), then semifinals, then Final (and 3rd place). On 2 courts each pool has its own court (the pool of 3
 *                 finishes first, then the pool of 4 uses both courts); on 1 court every game is played one after another.
 */
export function doublesStructure(teams: number, courts: number): DoublesStructure {
  const two = courts >= 2;
  if (teams <= 3) return { teams, shape: 'rr3', poolRounds: 3, playoffRounds: 1, courtsUsed: 1, third: false, semis: false };
  if (teams <= 5) {
    const games = (teams * (teams - 1)) / 2;
    return { teams, shape: 'rr', poolRounds: two ? (teams === 4 ? 3 : 5) : games, playoffRounds: 1, courtsUsed: two ? 2 : 1, third: two, semis: false };
  }
  const a = Math.ceil(teams / 2);
  const b = teams - a;
  const games = (a * (a - 1)) / 2 + (b * (b - 1)) / 2;
  // 2 courts: 3+3 = 3 rounds; 4+3 = 5 rounds (3 rounds side by side, then the 3 games left in the pool of 4 on both courts); 4+4 = 6 rounds.
  const poolRounds = two ? (a === b ? (a * (a - 1)) / 2 : (b * (b - 1)) / 2 + Math.ceil(((a * (a - 1)) / 2 - (b * (b - 1)) / 2) / 2)) : games;
  return { teams, shape: 'pools', poolRounds, playoffRounds: two ? 2 : 3, courtsUsed: two ? 2 : 1, third: two, semis: true };
}

export interface NightPlan {
  style: PlanStyle;
  players: number;
  courts: number;
  /** The court time booked (minutes). */
  minutes: number;
  /** It fits in the court time minus the end buffer. */
  fits: boolean;
  /** Pool or round robin games (Americano: every game) are played to this. Too tight: 7 (the table's rule), and the Time check says how far behind. */
  gameTo: GameTo;
  /** Every round of the night, playoffs included. */
  rounds: number;
  /** Rounds at `gameTo` (the rest are playoff rounds to 11). */
  shortRounds: number;
  /** Minutes from the start to the planned last game's end: the warm-up, the rounds and the breaks (Zip 89; no end buffer). */
  minutesUsed: number;
  /** Zip 89: every player plays every round (8 on 2 courts, 4 teams on 2 courts, 4 on 1 court): a break after every 2nd round. */
  noSit: boolean;
  /** Zip 89: the breaks the plan budgets (5 minutes each). */
  breaks: number;
  /**
   * Zip 89 (Alex, "build in what fits"): Locked doubles' bonuses that fit the base budget at the table's pace are part of the plan from the
   * start: semifinals for 4 or 5 teams on 2 courts (1st vs 4th, 2nd vs 3rd), then a best of 3 Final. Offers are only for nights running faster.
   */
  builtIn: { semis: boolean; bestOf3: boolean };
  /** Locked doubles only: how the night is built. */
  doubles?: DoublesStructure;
  /** Americano only: players on court each round, and the average games per player. */
  onCourt?: number;
  gamesEach?: number;
}

/** Minutes for rounds at a length plus playoff rounds to 11. */
const used = (short: number, len: GameTo, playoff: number) => short * ROUND_MINUTES[len] + playoff * PLAYOFF_MINUTES;

/** Zip 89: a Locked doubles night where every team plays every round: 4 teams on 2 courts (2 games a round, all 4 teams on court). */
export const doublesNoSit = (s: DoublesStructure): boolean => s.shape === 'rr' && s.courtsUsed === 2 && s.teams === 4;

/** LOCKED DOUBLES (even counts; an odd count is Americano). Pool or round robin games use the longest length that fits; playoffs are to 11.
 *  Zip 89 (Alex): then, at that length, the semifinals (4 or 5 teams on 2 courts) and a best of 3 Final are built in when they still fit. */
export function doublesPlan(players: number, courts: number, minutes: number): NightPlan {
  const s = doublesStructure(Math.floor(players / 2), courts);
  const budget = planBudget(minutes);
  const noSit = doublesNoSit(s);
  // Full rounds (a game on every court used) get the breaks; a best of 3 Final's games 2 and 3 are one game each (no break before them).
  const total = (len: GameTo, semis: boolean, bo3: boolean) =>
    used(s.poolRounds, len, s.playoffRounds + (semis ? 1 : 0) + (bo3 ? 2 : 0)) + breaksFor(s.poolRounds + s.playoffRounds + (semis ? 1 : 0), noSit) * BREAK_MINUTES;
  const len = GAME_LENGTHS.find((l) => total(l, false, false) <= budget);
  const gameTo = len ?? 7;
  const canSemis = s.shape === 'rr' && s.courtsUsed === 2;
  const semis = !!len && canSemis && total(gameTo, true, false) <= budget;
  // A best of 3 Final comes after the semifinals where the night can have them (as the offers go), else on its own.
  const bestOf3 = !!len && (!canSemis || semis) && total(gameTo, semis, true) <= budget;
  const extra = (semis ? 1 : 0) + (bestOf3 ? 2 : 0);
  return {
    style: 'doubles',
    players,
    courts,
    minutes,
    fits: !!len,
    gameTo,
    rounds: s.poolRounds + s.playoffRounds + extra,
    shortRounds: s.poolRounds,
    minutesUsed: WARM_UP + total(gameTo, semis, bestOf3),
    noSit,
    breaks: breaksFor(s.poolRounds + s.playoffRounds + (semis ? 1 : 0), noSit),
    builtIn: { semis, bestOf3 },
    doubles: s,
  };
}

/** AMERICANO (any count 6 to 16): 4 x the smaller of (courts, players / 4) on court; rounds = what fits; the longest length giving everyone 4 games. */
export function americanoPlan(players: number, courts: number, minutes: number): NightPlan {
  const onCourt = 4 * Math.max(1, Math.min(courts, Math.floor(players / 4)));
  const budget = planBudget(minutes);
  // Zip 89: nobody sits when everyone is on court every round (8 on 2 courts, 4 on 1): a break after every 2nd round, in the budget.
  const noSit = onCourt >= players;
  const at = (l: GameTo) => {
    let rounds = Math.max(0, Math.floor(budget / ROUND_MINUTES[l]));
    while (rounds > 0 && rounds * ROUND_MINUTES[l] + breaksFor(rounds, noSit) * BREAK_MINUTES > budget) rounds--;
    return { rounds, gamesEach: (rounds * onCourt) / players };
  };
  const len = GAME_LENGTHS.find((l) => at(l).gamesEach >= AMERICANO_MIN_GAMES);
  const gameTo = len ?? 7;
  const r = at(gameTo);
  const breaks = breaksFor(r.rounds, noSit);
  return {
    style: 'americano',
    players,
    courts,
    minutes,
    fits: !!len,
    gameTo,
    rounds: r.rounds,
    shortRounds: r.rounds,
    minutesUsed: WARM_UP + r.rounds * ROUND_MINUTES[gameTo] + breaks * BREAK_MINUTES,
    noSit,
    breaks,
    builtIn: { semis: false, bestOf3: false },
    onCourt,
    gamesEach: Math.round(r.gamesEach * 10) / 10,
  };
}

/** The style a count really plays: Locked doubles needs an even number (an odd count plays Americano, zip 64's rule). */
export const styleFor = (style: PlanStyle, players: number): PlanStyle => (style === 'doubles' && players % 2 === 0 ? 'doubles' : 'americano');

/** THE function: the plan for a night. Players are held to 6..16 (the hidden cap). */
export function nightPlan(players: number, courts: number, minutes: number, style: PlanStyle): NightPlan {
  const n = Math.min(MAX_PLAYERS, Math.max(MIN_PLAYERS, Math.round(players)));
  const c = courts >= 2 ? 2 : 1;
  return styleFor(style, n) === 'doubles' ? doublesPlan(n, c, minutes) : americanoPlan(n, c, minutes);
}

/** The table's STARTING SUGGESTION lives in shared/tournament.ts (the organizer card's plan line reads it there); the same function here. */
export { suggestedPlan } from './tournament';

/** "7:30 PM" for minutes after midnight. */
function clock(mins: number): string {
  const m = ((Math.round(mins) % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60);
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m % 60).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}
/** Rounded to the nearest 5 minutes ("done about 9:45 PM"). */
export const about = (mins: number): number => Math.round(mins / 5) * 5;
export const clockLabel = clock;

/**
 * The Finalize line (mocks 60 and 61), and the same check when tickets close. Zip 70: "Locked doubles for 12: pool games to 9, done about
 * 9:30 PM." ("games to 11" when there are no pools) in the accent color. Not: "Locked doubles for 12: too tight on 1 court. Use 2 courts or add
 * court time." in amber. On 2 courts: "... too tight on 2 courts. Move the end later."
 */
export function fitWords(p: NightPlan, start: number): { fits: boolean; text: string } {
  // Zip 70: the line names the style that will really be played (an odd count is Americano): "Americano for 9: games to 11, done about 9:50 PM."
  const who = `${p.style === 'americano' ? 'Americano' : 'Locked doubles'} for ${p.players}`;
  // Zip 74 (the 🎾73 audit): already on 2 courts, "Use 2 courts" was no help: the hint is a later end instead, in the same short style.
  if (!p.fits) return { fits: false, text: p.courts === 1 ? `${who}: too tight on 1 court. Use 2 courts or add court time.` : `${who}: too tight on 2 courts. Move the end later.` };
  const what = p.doubles?.shape === 'pools' ? 'pool games' : 'games';
  return { fits: true, text: `${who}: ${what} to ${p.gameTo}, done about ${clock(about(start + p.minutesUsed))}.` };
}
