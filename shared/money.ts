import { SPOTS_PER_SESSION } from './settings';

/**
 * Split a court cost into four shares that add up exactly to the total.
 *
 * Rounding rule: everyone pays floor(total / 4) cents, and the leftover
 * 1–3 cents go one each to the players who confirmed earliest. Example:
 * $45.01 -> 11.26, 11.25, 11.25, 11.25.
 */
export function splitCost(totalCents: number, ways = SPOTS_PER_SESSION): number[] {
  if (!Number.isInteger(totalCents) || totalCents < 0) throw new Error('invalid_amount');
  const base = Math.floor(totalCents / ways);
  const remainder = totalCents - base * ways;
  return Array.from({ length: ways }, (_, i) => base + (i < remainder ? 1 : 0));
}

export function formatCents(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}$${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/** Parse "45", "45.5", "$45.50" into cents. Returns null for anything else. */
export function parseDollars(input: string): number | null {
  const m = /^\s*\$?\s*(\d{1,5})(?:\.(\d{1,2}))?\s*$/.exec(input);
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
}
