// Zip 92 (Alex, Nov 25): THE FAIRNESS RULE, every headcount and style. Only REGULAR games count (pool / round robin games, Americano rounds);
// playoff games (semifinals, the Final, 3rd place, tie games, a best of 3's games) are extra, earned by winning, and never count.
//   1. Everyone gets the same number of regular games, give or take 1.
//   2. Everyone gets at least 3 regular games (Americano keeps its 4+ minimum, AMERICANO_MIN_GAMES).
//   3. Nobody's night ends early while others keep playing regular games: everyone plays at least once in the night's last lap of regular
//      rounds (two rounds, or as many as it takes for everyone to get on a court once: ceil(players / on court), lapOf).
// Pure, from the same schedules the night is made with (shared/tournamentSchedule.ts schedule + withBuiltIn, shared/americanoSchedule.ts
// americanoNight). Used by tests/zip92-fairness.test.ts and scripts/zip92-fairness.ts (the table); the site itself reads only the result,
// which is in the style rule (shared/tournament.ts playsAmericano: Locked doubles that fails plays Americano at Pay by).
import { americanoNight, lapOf, onCourtFor } from './americanoSchedule';
import { AMERICANO_MIN_GAMES, nightPlan, type NightPlan, type PlanStyle } from './tournamentPlan';
import { schedule, withBuiltIn } from './tournamentSchedule';

/** Locked doubles' minimum regular games (Americano: AMERICANO_MIN_GAMES). */
export const DOUBLES_MIN_GAMES = 3;

export interface Fairness {
  players: number;
  courts: number;
  minutes: number;
  style: PlanStyle;
  plan: NightPlan;
  /** Regular games per player, fewest and most. */
  min: number;
  max: number;
  /** Playoff games in the night (Locked doubles: semifinals, Final, 3rd place, a best of 3's games built in; Americano 0). */
  playoff: number;
  /** Regular rounds in the night, and the earliest round in which someone plays their last regular game. */
  rounds: number;
  earliestLast: number;
  even: boolean;
  enough: boolean;
  noEarlyEnd: boolean;
  /** The plan fits the booked time (no "too tight" night). */
  fits: boolean;
  pass: boolean;
}

/** The night's regular games for each player (or team), from the real schedule of `style` (no style rule applied: the style asked for). */
export function fairnessOf(players: number, courts: number, minutes: number, style: PlanStyle): Fairness {
  const plan = nightPlan(players, courts, minutes, style);
  const count = new Map<string, number>();
  const last = new Map<string, number>();
  let rounds = 0;
  let playoff = 0;
  const note = (who: string, round: number) => {
    count.set(who, (count.get(who) ?? 0) + 1);
    last.set(who, Math.max(last.get(who) ?? 0, round));
  };
  if (plan.style === 'americano') {
    const ids = Array.from({ length: players }, (_, i) => `p${i + 1}`);
    const night = americanoNight(ids, courts, minutes, 'fairness');
    for (const id of ids) count.set(id, 0);
    for (const g of night.games) for (const id of [...g.a, ...g.b]) note(id, g.round);
    rounds = night.rounds;
  } else {
    const teams = Math.floor(players / 2);
    const games = withBuiltIn(schedule(teams, courts), plan.builtIn);
    for (let s = 1; s <= teams; s++) count.set(`T${s}`, 0);
    for (const g of games) {
      if (g.stage !== 'pool') {
        if (g.stage !== 'tie') playoff++;
        continue;
      }
      note(g.a, g.round);
      note(g.b, g.round);
      rounds = Math.max(rounds, g.round);
    }
  }
  const values = [...count.values()];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const earliestLast = Math.min(...[...count.keys()].map((k) => last.get(k) ?? 0));
  const even = max - min <= 1;
  const enough = min >= (plan.style === 'americano' ? AMERICANO_MIN_GAMES : DOUBLES_MIN_GAMES);
  // The lap: Americano by players on court; Locked doubles by teams on court (2 a game, a game per court used).
  const lap = plan.style === 'americano' ? lapOf(players, onCourtFor(players, courts)) : lapOf(Math.floor(players / 2), 2 * (plan.doubles?.courtsUsed ?? 1));
  const noEarlyEnd = earliestLast >= rounds - lap + 1;
  return { players, courts, minutes, style: plan.style, plan, min, max, playoff, rounds, earliestLast, even, enough, noEarlyEnd, fits: plan.fits, pass: even && enough && noEarlyEnd && plan.fits };
}
