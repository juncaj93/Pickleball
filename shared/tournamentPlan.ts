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
 */
export const ROUND_MINUTES = { 11: 20, 9: 16, 7: 13 } as const;
export type GameTo = keyof typeof ROUND_MINUTES;
/** Longest first: the plan uses the longest game that fits. */
export const GAME_LENGTHS: readonly GameTo[] = [11, 9, 7];
/** Minutes of court time kept free after the planned last game (awards, overrun; Zip 89: 20, was 10). */
export const END_BUFFER = 20;
/** Semifinals, the Final and the 3rd place game are always to 11. */
export const PLAYOFF_TO: GameTo = 11;
/**
 * Zip 80: minutes one tie game takes (Game A or Game B, played to 5; the wheel's games). ROUND_MINUTES's step from 9 to 7 carried down to 5 (Zip
 * 89: 13 at 7, 16 at 9, so 10 at 5; it was 13 with the old table). A tie is not in the plan made before the night (nobody knows there will be
 * one); once its games exist the Time check and the night's times count them.
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
  /** Minutes the rounds take (no buffer). */
  minutesUsed: number;
  /** Locked doubles only: how the night is built. */
  doubles?: DoublesStructure;
  /** Americano only: players on court each round, and the average games per player. */
  onCourt?: number;
  gamesEach?: number;
}

/** Minutes for rounds at a length plus playoff rounds to 11. */
const used = (short: number, len: GameTo, playoff: number) => short * ROUND_MINUTES[len] + playoff * ROUND_MINUTES[PLAYOFF_TO];

/** LOCKED DOUBLES (even counts; an odd count is Americano). Pool or round robin games use the longest length that fits; playoffs are to 11. */
export function doublesPlan(players: number, courts: number, minutes: number): NightPlan {
  const s = doublesStructure(Math.floor(players / 2), courts);
  const budget = minutes - END_BUFFER;
  const len = GAME_LENGTHS.find((l) => used(s.poolRounds, l, s.playoffRounds) <= budget);
  const gameTo = len ?? 7;
  return {
    style: 'doubles',
    players,
    courts,
    minutes,
    fits: !!len,
    gameTo,
    rounds: s.poolRounds + s.playoffRounds,
    shortRounds: s.poolRounds,
    minutesUsed: used(s.poolRounds, gameTo, s.playoffRounds),
    doubles: s,
  };
}

/** AMERICANO (any count 6 to 16): 4 x the smaller of (courts, players / 4) on court; rounds = what fits; the longest length giving everyone 4 games. */
export function americanoPlan(players: number, courts: number, minutes: number): NightPlan {
  const onCourt = 4 * Math.max(1, Math.min(courts, Math.floor(players / 4)));
  const budget = minutes - END_BUFFER;
  const at = (l: GameTo) => {
    const rounds = Math.max(0, Math.floor(budget / ROUND_MINUTES[l]));
    return { rounds, gamesEach: (rounds * onCourt) / players };
  };
  const len = GAME_LENGTHS.find((l) => at(l).gamesEach >= AMERICANO_MIN_GAMES);
  const gameTo = len ?? 7;
  const r = at(gameTo);
  return {
    style: 'americano',
    players,
    courts,
    minutes,
    fits: !!len,
    gameTo,
    rounds: r.rounds,
    shortRounds: r.rounds,
    minutesUsed: r.rounds * ROUND_MINUTES[gameTo],
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
