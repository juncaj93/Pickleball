// Zip 89 (🎾89.smart pacing): THE LIVE PACE and THE BONUS OFFER, pure (the server's two night views call it; tests/zip89-pacing.test.ts and the
// whole-night simulations, tests/zip89-pacing-sim.test.ts, check it). Alex, Nov 24: plan honestly (shared/tournamentPlan.ts: 20 minutes a round
// to 11, 20 minutes kept free at the end); when the night clearly runs fast, offer ONE bonus round EARLY (never a surprise round at the end);
// leftover time is free play.
//
//   THE PACE   the average length of the rounds fully scored so far, counted from the real start (Start now included) to when the last of them
//              got its last score, as minutes for a round to 11: a round played to 9 or 7 counts against its own table time (16 or 13), so a
//              night of shorter games is measured fairly. Never under PACE_FLOOR (14 minutes a round to 11), so one lucky round never
//              over-promises.
//   THE OFFER  after a round is fully scored, ONE bonus is offered when ALL of this holds:
//                a. everything still to play (whole rounds; a round in progress counts as at most half done) plus the bonus, at the pace,
//                   ends at least BONUS_SPARE (20) minutes before the booked end;
//                b. at least 2 PLANNED pool / round robin rounds are still to play (a bonus round is never counted as planned, so an offer
//                   never comes near the end);
//                c. the night is on (started, not over), not paused, not behind (the Time check wins over bonuses: no offer while it asks
//                   for shorter games or shorter games are in force), and nobody is mid "Player left".
//              The organizer decides: nothing is ever added by itself. One offer at a time, at most one bonus per scored round (after a
//              bonus is added, the next offer waits for another round to be fully scored); it goes away when (b) closes and can come back
//              after a later round while the pace still allows.
import { END_BUFFER, PLAYOFF_TO, ROUND_MINUTES } from './tournamentPlan';

/** The slowest a round to 11 is ever assumed to be, whatever the measured pace (minutes). */
export const PACE_FLOOR = 14;
/** Minutes of court time that must still be free after the night with the bonus in it (the base plan keeps the same). */
export const BONUS_SPARE = END_BUFFER;
/** Planned pool / round robin rounds that must still be left to play for an offer. */
export const BONUS_MIN_LEFT = 2;
/** The table's minutes for a round to 11: the pace is told in these. */
const FULL = ROUND_MINUTES[PLAYOFF_TO];

/** One round of the night as the pace sees it. */
export interface PaceRound {
  round: number;
  /** A planned pool / round robin round (an Americano round of the plan; never a bonus round, never a playoff). */
  planned: boolean;
  done: boolean;
  /** Minutes after midnight (the night's day) of its last result, once done. */
  doneAt?: number;
  /** Its table minutes at the length it is played to (shared/tournamentPlan.ts ROUND_MINUTES; 20 when not given). */
  minutes?: number;
}

/** What the bonus is ('round' Americano; 'semis' Locked doubles 4 and 5 teams; 'bestOf3' the Final). How many rounds it adds to the night. */
export type BonusKind = 'round' | 'semis' | 'bestOf3';
export const BONUS_ROUNDS: Record<BonusKind, number> = { round: 1, semis: 1, bestOf3: 2 };

export interface PaceInput {
  rounds: readonly PaceRound[];
  /** The real start (Start now's tap when earlier) and the booked end, minutes after midnight. */
  startMin: number;
  endMin: number;
  nowMin: number;
  /** The bonus the night would get next (null: none left for this night). */
  kind: BonusKind | null;
  /** The table minutes the bonus adds (an Americano round at the plan's length; semifinals a round to 11; best of 3 two games to 11). */
  bonusMinutes?: number;
  started: boolean;
  over: boolean;
  paused: boolean;
  /** The Time check asks for shorter games, or shorter games are in force, or the night is behind its plan. */
  behind: boolean;
  /** A "Player left" is not finished. */
  leftOpen: boolean;
  /** When the last bonus was added (minutes after midnight), if any: ONE offer per round, so none until a round is fully scored after it. */
  lastBonusAt?: number | null;
}

export interface PaceResult {
  /** Rounds fully scored from Round 1 on (rounds after a round still open do not count yet). */
  done: number;
  /** The measured pace (minutes for a round to 11, floor included), or null before the first round is in. */
  pace: number | null;
  /** When everything still to play plus the bonus would end (minutes after midnight), or null. */
  finishWithBonus: number | null;
  /** Planned pool rounds still to play. */
  plannedLeft: number;
  /** The offer, or null. `key` names this exact moment (a tap on an offer that has changed since is refused). */
  offer: { kind: BonusKind; key: string } | null;
}

const tableOf = (r: PaceRound) => r.minutes ?? FULL;

/** THE PACE alone: rounds fully scored from Round 1 on, when the last of them got its last result, and the pace (null before Round 1 is in). */
export function measuredPace(rounds: readonly PaceRound[], startMin: number): { done: number; lastAt: number; pace: number | null } {
  const list = [...rounds].sort((a, b) => a.round - b.round);
  let done = 0;
  let lastAt = -Infinity;
  let table = 0;
  for (const r of list) {
    if (!r.done || r.doneAt === undefined) break;
    done++;
    table += tableOf(r);
    lastAt = Math.max(lastAt, r.doneAt);
  }
  if (done === 0 || !Number.isFinite(lastAt) || table <= 0) return { done, lastAt, pace: null };
  return { done, lastAt, pace: Math.max(PACE_FLOOR, ((lastAt - startMin) / table) * FULL) };
}

/** THE PACE and THE OFFER. */
export function pacing(p: PaceInput): PaceResult {
  const list = [...p.rounds].sort((a, b) => a.round - b.round);
  const { done, lastAt, pace } = measuredPace(list, p.startMin);
  const plannedLeft = list.filter((r) => r.planned && !r.done).length;
  if (pace === null) return { done, pace: null, finishWithBonus: null, plannedLeft, offer: null };
  const scale = pace / FULL;
  const left = list.filter((r) => !r.done).reduce((m, r) => m + tableOf(r), 0);
  const extra = p.kind ? (p.bonusMinutes ?? BONUS_ROUNDS[p.kind] * FULL) : 0;
  // The round being played counts as at most half done: the clock starts at the last full round's end, or half a round ago if later.
  const from = Math.max(lastAt, p.nowMin - pace / 2);
  const finishWithBonus = from + (left + extra) * scale;
  const fresh = p.lastBonusAt === undefined || p.lastBonusAt === null || p.lastBonusAt < lastAt;
  const open = !!p.kind && fresh && p.started && !p.over && !p.paused && !p.behind && !p.leftOpen;
  const ok = open && plannedLeft >= BONUS_MIN_LEFT && finishWithBonus <= p.endMin - BONUS_SPARE;
  return { done, pace, finishWithBonus, plannedLeft, offer: ok ? { kind: p.kind!, key: `${p.kind}:${done}:${list.length}` } : null };
}

/**
 * Zip 89: the pace the Time check counts the rounds still to play at (shared/tournamentSchedule.ts timeCheck), or undefined for the table as
 * before. Two cases: a night with a bonus round in it (it was judged by its pace when the bonus was added), and a night running SLOWER than the
 * table (its real pace warns earlier, so the courts are not run past the booked end). A fast night with no bonus is checked exactly as before.
 */
export function paceForCheck(bonusIn: boolean, pace: number | null): number | undefined {
  if (pace === null) return undefined;
  return bonusIn || pace > FULL ? pace : undefined;
}
