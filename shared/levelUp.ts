// Zip 79 (🎾79.results skills): the level up's numbers (src/tournament/LevelUp.tsx draws it). Pure, so the tests check them.
import { levelLabel, levelShort } from './tournament';

/** The count starts this long after the card comes in. */
export const COUNT_FROM_MS = 400;
/** The count runs this long (the last tick lands at COUNT_FROM_MS + COUNT_MS: the mock's T = 1.8 s). */
export const COUNT_MS = 1400;
/** The whole thing, from the tap on Next. */
export const LEVEL_UP_MS = 3000;
/** Reduced motion: the final card stays this long. */
export const LEVEL_UP_CALM_MS = 1000;
/** At most this many ticks before the last (a big jump skips steps). */
const MOST_TICKS = 6;

/**
 * The numbers the count shows, from the previous level to the new one in 0.1 steps ("3.0", "3.1", ... "3.4"; the last one is the new level's
 * own label, so 3.6+ ends on "3.6+"). A jump of more than MOST_TICKS steps keeps the first, the last and evenly spread steps between.
 */
export function countSteps(from: number, to: number): string[] {
  const a = Math.round(Number(levelShort(from)) * 10);
  const b = Math.round(Number(levelShort(to)) * 10);
  const all: number[] = [];
  for (let x = a; x <= b; x++) all.push(x);
  if (all.length < 2) return [levelLabel(to)];
  let keep = all;
  if (all.length > MOST_TICKS + 1) {
    keep = Array.from({ length: MOST_TICKS + 1 }, (_, i) => all[Math.round((i * (all.length - 1)) / MOST_TICKS)]);
  }
  return keep.map((x, i) => (i === keep.length - 1 ? levelLabel(to) : (x / 10).toFixed(1)));
}

/** When each tick lands (ms after the overlay starts): the gaps shrink, so the ticks speed up; the last lands at COUNT_FROM_MS + COUNT_MS. */
export function tickTimes(n: number): number[] {
  if (n <= 0) return [];
  const w = Array.from({ length: n }, (_, i) => n - i + 1);
  const sum = w.reduce((s, x) => s + x, 0);
  let at = COUNT_FROM_MS;
  return w.map((x) => (at += (COUNT_MS * x) / sum));
}

