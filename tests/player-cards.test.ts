import { describe, expect, it } from 'vitest';
import { creditBackNote } from '../shared/pricing';
import { formatTimeShort, ordinal, weekTier } from '../shared/time';

const fmt = (c: number) => `$${c / 100}`;
const TZ = 'America/Detroit';

describe('credit-back note', () => {
  it('uses the table for the position this person would take', () => {
    expect(creditBackNote(1400, 4, 10, fmt)).toBe('If 5 play, you get $3 back as credit.');
    expect(creditBackNote(1400, 5, 10, fmt)).toBe('If 6 play, you get $5 back as credit.');
    expect(creditBackNote(1400, 9, 10, fmt)).toBe('If 10 play, you get $9 back as credit.');
  });
  it('is hidden for 4th or earlier, and past the max', () => {
    for (const n of [0, 1, 2, 3]) expect(creditBackNote(1400, n, 10, fmt)).toBeNull();
    expect(creditBackNote(1400, 10, 10, fmt)).toBeNull();
    expect(creditBackNote(1400, 6, 6, fmt)).toBeNull();
  });
});

describe('card helpers', () => {
  it('short times use an en dash', () => {
    expect(formatTimeShort('2026-11-04T01:00:00Z', '2026-11-04T03:00:00Z', TZ)).toBe('8–10 PM');
    expect(formatTimeShort('2026-11-21T14:00:00Z', '2026-11-21T16:00:00Z', TZ)).toBe('9–11 AM');
    expect(formatTimeShort('2026-11-04T00:30:00Z', '2026-11-04T03:00:00Z', TZ)).toBe('7:30–10 PM');
    expect(formatTimeShort('2026-11-21T16:00:00Z', '2026-11-21T18:00:00Z', TZ)).toBe('11 AM–1 PM');
  });
  it('ordinals', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22].map(ordinal)).toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd']);
  });
  it('tiers: this week, next week, later', () => {
    const now = Date.parse('2026-11-02T17:00:00Z'); // Mon Nov 2
    expect(weekTier('2026-11-04T01:00:00Z', now, TZ)).toBe('this');
    expect(weekTier('2026-11-11T01:00:00Z', now, TZ)).toBe('next');
    expect(weekTier('2026-11-18T01:00:00Z', now, TZ)).toBe('later');
    expect(weekTier('2026-12-09T01:00:00Z', now, TZ)).toBe('later');
  });
});
