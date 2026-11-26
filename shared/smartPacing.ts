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
//                   ends at least BONUS_SPARE (20) minutes before the booked end; rounds the Time check can never shorten (playoffs) and
//                   the bonus itself count at the table's time at least (review: a night that slows down after a bonus can still finish);
//                b. at least 2 PLANNED pool / round robin rounds are still to play (a bonus round is never counted as planned, so an offer
//                   never comes near the end); a Locked doubles best of 3 Final (two playoff games the Time check can never shorten) needs 3;
//                c. the night is on (started, not over), not paused, not behind (the Time check wins over bonuses: no offer while it asks
//                   for shorter games or shorter games are in force), and nobody is mid "Player left".
//              The organizer decides: nothing is ever added by itself. One offer at a time, at most one bonus per scored round (after a
//              bonus is added, the next offer waits for another round to be fully scored); it goes away when (b) closes and can come back
//              after a later round while the pace still allows.
import { BREAK_MINUTES, END_BUFFER, PLAYOFF_MINUTES, ROUND_MINUTES } from './tournamentPlan';

/** The slowest a round to 11 is ever assumed to be, whatever the measured pace (minutes). */
export const PACE_FLOOR = 14;
/** Minutes of court time that must still be free after the night with the bonus in it (the base plan keeps the same). */
export const BONUS_SPARE = END_BUFFER;
/** Planned pool / round robin rounds that must still be left to play for an offer (Americano; Locked doubles' semifinals and best of 3 need
 *  more, below). Zip 97 (Alex): Locked doubles' ONE MORE ROUND ROBIN ROUND needs none: it can come after any fully scored pool round until the
 *  playoffs start (PaceInput.minLeft 0; the server offers it only while no playoff game has started). */
export const BONUS_MIN_LEFT = 2;
/** The table's minutes for a REGULAR round to 11: the pace is told in these (Zip 97: 17; playoff rounds are 20 at the table, PLAYOFF_MINUTES). */
const FULL = ROUND_MINUTES[11];

/** One round of the night as the pace sees it. */
export interface PaceRound {
  round: number;
  /** A planned pool / round robin round (an Americano round of the plan; never a bonus round, never a playoff). */
  planned: boolean;
  done: boolean;
  /** Minutes after midnight (the night's day) of its last result, once done. */
  doneAt?: number;
  /** Its table minutes at the length it is played to (shared/tournamentPlan.ts ROUND_MINUTES, a playoff PLAYOFF_MINUTES; a regular round to 11
   *  when not given). */
  minutes?: number;
  /** The Time check can never shorten it (a playoff round): the offer counts it at the table's time at least, never faster. */
  fixed?: boolean;
  /** Zip 89: minutes before it that were not play (Round 1: the warm-up; after a break: the break as taken). The pace never counts them. */
  pauseBefore?: number;
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
  /** The bonus adds playoff games, which the Time check never shortens (Locked doubles): it needs more planned rounds left. */
  fixedBonus?: boolean;
  /** Zip 97: planned pool rounds that must still be left for this offer, in place of the usual rule (Locked doubles' one more round: 0). */
  minLeft?: number;
  /** Zip 89: a night where nobody sits has a 5 minute break after every 2nd round (the estimate counts the ones still to come). */
  breaks?: boolean;
  /** Zip 89: a break is on now (no offer during a break), and the minutes of it still to run. */
  onBreak?: number;
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
export function measuredPace(rounds: readonly PaceRound[], startMin: number): { done: number; lastAt: number; pace: number | null; latest: number | null } {
  const list = [...rounds].sort((a, b) => a.round - b.round);
  let done = 0;
  let lastAt = -Infinity;
  let table = 0;
  // The latest full round alone (minutes for a round to 11), so the Time check sees a night slowing down at once (review: the average lags).
  let latest: number | null = null;
  let paused = 0;
  for (const r of list) {
    if (!r.done || r.doneAt === undefined) break;
    done++;
    table += tableOf(r);
    paused += r.pauseBefore ?? 0;
    const from = (Number.isFinite(lastAt) ? lastAt : startMin) + (r.pauseBefore ?? 0);
    latest = (Math.max(0, r.doneAt - from) / tableOf(r)) * FULL;
    lastAt = Math.max(lastAt, r.doneAt);
  }
  if (done === 0 || !Number.isFinite(lastAt) || table <= 0) return { done, lastAt, pace: null, latest: null };
  // Zip 89: the warm-up and the breaks are not play: the pace is the play time only.
  return { done, lastAt, pace: Math.max(PACE_FLOOR, (Math.max(0, lastAt - startMin - paused) / table) * FULL), latest };
}

/**
 * Zip 92 (🎾91's dry run): THE PACE AS THE TIME CHECK READS IT, live. As measuredPace, and the round being played counts as finished NOW once it
 * has run longer than its table time (from the end of the round before it, after its warm-up or break): so on a slow night the estimate rises
 * minute by minute while a round runs long, and nothing jumps when that round's last score comes in (it then reads the same). A round still
 * inside its table time changes nothing. The bonus offer keeps measuredPace (only rounds really scored).
 */
export function livePace(rounds: readonly PaceRound[], startMin: number, nowMin: number): ReturnType<typeof measuredPace> {
  const list = [...rounds].sort((a, b) => a.round - b.round);
  const m = measuredPace(list, startMin);
  const cur = list.find((r) => !r.done || r.doneAt === undefined);
  if (!cur) return m;
  const from = (m.done ? m.lastAt : startMin) + (cur.pauseBefore ?? 0);
  if (nowMin - from <= tableOf(cur)) return m;
  return measuredPace(
    list.map((r) => (r === cur ? { ...r, done: true, doneAt: nowMin } : r)),
    startMin,
  );
}

/** THE PACE and THE OFFER. */
export function pacing(p: PaceInput): PaceResult {
  const list = [...p.rounds].sort((a, b) => a.round - b.round);
  const { done, lastAt, pace } = measuredPace(list, p.startMin);
  const plannedLeft = list.filter((r) => r.planned && !r.done).length;
  if (pace === null) return { done, pace: null, finishWithBonus: null, plannedLeft, offer: null };
  const scale = pace / FULL;
  // Review: only rounds the Time check can still shorten get the fast pace's credit. A round it can never shorten (a playoff) and the bonus
  // itself (playoff games; or the night's new last round, which is never shortened) count at the table's time at least: if the night slows
  // down after a bonus, the shortenable pool rounds left are what brings it back inside the end.
  const firm = Math.max(1, scale);
  const left = list.filter((r) => !r.done).reduce((m, r) => m + tableOf(r) * (r.fixed ? firm : scale), 0);
  const extra = p.kind ? (p.bonusMinutes ?? BONUS_ROUNDS[p.kind] * (p.kind === 'round' ? FULL : PLAYOFF_MINUTES)) * firm : 0;
  // The round being played counts as at most half done: the clock starts at the last full round's end, or half a round ago if later.
  const from = Math.max(lastAt, p.nowMin - pace / 2);
  // Zip 89: breaks still to come (after every 2nd round, never after the last, the bonus counted), and the one on now.
  const total = list.length + (p.kind ? BONUS_ROUNDS[p.kind] : 0);
  let breaksLeft = 0;
  if (p.breaks) for (let r = done + 1; r < total; r++) if (r % 2 === 0) breaksLeft++;
  const finishWithBonus = from + left + extra + breaksLeft * BREAK_MINUTES + (p.onBreak ?? 0);
  const fresh = p.lastBonusAt === undefined || p.lastBonusAt === null || p.lastBonusAt < lastAt;
  const open = !!p.kind && fresh && !p.onBreak && p.started && !p.over && !p.paused && !p.behind && !p.leftOpen;
  // A bonus that adds games the Time check can never shorten (Locked doubles' playoff games) needs that many more planned pool rounds still to
  // play, so a night that slows down afterwards still has pool games to shorten (review): semifinals 2, a best of 3 Final 3.
  const need = p.minLeft ?? Math.max(BONUS_MIN_LEFT, p.fixedBonus ? BONUS_ROUNDS[p.kind!] + 1 : 0);
  const ok = open && plannedLeft >= need && finishWithBonus <= p.endMin - BONUS_SPARE;
  return { done, pace, finishWithBonus, plannedLeft, offer: ok ? { kind: p.kind!, key: `${p.kind}:${done}:${list.length}` } : null };
}

/**
 * Zip 89: the pace the Time check counts the rounds still to play at (shared/tournamentSchedule.ts timeCheck), or undefined for the table as
 * before. Two cases: a night with a bonus round in it (it was judged by its pace when the bonus was added), and a night running SLOWER than the
 * table (its real pace warns earlier, so the courts are not run past the booked end). A fast night with no bonus is checked exactly as before.
 * Zip 92 (🎾91's dry run): a slow night EASES into its pace: after Round 1 a third of the way from the table to the measured pace, after Round 2
 * two thirds, from Round 3 all of it (EASE_ROUNDS). It used to jump from the table to the whole pace once 2 rounds were in ("9 minutes behind",
 * then a minute later "25 minutes behind"). One slow round still never sets the whole night's time by itself.
 */
export function paceForCheck(bonusIn: boolean, pace: number | null, done = 2, latest: number | null = null): number | undefined {
  if (pace === null) return undefined;
  // With a bonus in the night: the slower of the night's average and its latest full round (review: a night that starts fast and then slows
  // down must be caught at once, not when the average catches up), never under the floor.
  if (bonusIn) return Math.max(pace, latest ?? 0, PACE_FLOOR);
  if (pace <= FULL || done < 1) return undefined;
  return FULL + (pace - FULL) * Math.min(1, done / EASE_ROUNDS);
}
/** Zip 92: rounds fully in before a slow night is counted at its whole measured pace (before that, part of the way, one step a round). */
export const EASE_ROUNDS = 3;

/**
 * Zip 89 (Alex): BREAKS when nobody sits (every player plays every round): 5 minutes after every 2nd round, never after the last. A round is a
 * full round when it has a game on every court. `rounds`: each round's game count and when its last game got its result (ms, or null). Returns,
 * for each round that follows a break, the moment it may start (the round before it fully scored + 5 minutes). Skip break puts that round's games
 * on their courts at once (saved courts), so nothing else is stored.
 */
export function breakStarts(rounds: ReadonlyMap<number, { games: number; doneMs: number | null }>, courts: number, noSit: boolean): Map<number, number> {
  const out = new Map<number, number>();
  if (!noSit) return out;
  const last = Math.max(0, ...rounds.keys());
  for (const [r, x] of rounds) {
    if (r % 2 !== 0 || r >= last || x.doneMs === null) continue;
    const next = rounds.get(r + 1);
    if (x.games !== courts || !next || next.games !== courts) continue;
    out.set(r + 1, x.doneMs + BREAK_MINUTES * 60_000);
  }
  return out;
}

/** Zip 89: the break on now (the round after it has not started and its moment is still to come), and each round's break as taken (minutes). */
export function breakState(
  starts: ReadonlyMap<number, number>,
  roundStartMs: ReadonlyMap<number, number>,
  nowMs: number,
): { now: { round: number; until: number } | null; taken: Map<number, number> } {
  let now: { round: number; until: number } | null = null;
  const taken = new Map<number, number>();
  for (const [round, until] of starts) {
    const began = roundStartMs.get(round);
    const doneMs = until - BREAK_MINUTES * 60_000;
    if (began === undefined) {
      if (until > nowMs) now = { round, until };
      taken.set(round, Math.max(0, Math.min(BREAK_MINUTES, (Math.max(nowMs, until) - doneMs) / 60_000)));
    } else taken.set(round, Math.max(0, Math.min(BREAK_MINUTES, (began - doneMs) / 60_000)));
  }
  return { now, taken };
}
