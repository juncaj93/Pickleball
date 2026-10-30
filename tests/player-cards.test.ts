import { describe, expect, it } from 'vitest';
import { creditBackNote } from '../shared/pricing';
import { cardTime, cardTimeText, formatTimeShort, ordinal, USUAL_GAME_MINUTES, weekTier } from '../shared/time';

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
  it('card time: only the start for a usual-length game, so it always fits under the tile', () => {
    // 8 to 10 PM, 7 to 9 PM, 7:30 to 9:30 PM, 10:30 AM to 12:30 PM: all 2 hours
    expect(cardTime('2026-11-04T01:00:00Z', '2026-11-04T03:00:00Z', TZ)).toEqual({ start: '8 PM', end: null });
    expect(cardTime('2026-11-04T00:00:00Z', '2026-11-04T02:00:00Z', TZ)).toEqual({ start: '7 PM', end: null });
    expect(cardTime('2026-11-04T00:30:00Z', '2026-11-04T02:30:00Z', TZ)).toEqual({ start: '7:30 PM', end: null });
    expect(cardTime('2026-11-21T15:30:00Z', '2026-11-21T17:30:00Z', TZ)).toEqual({ start: '10:30 AM', end: null });
    expect(cardTimeText('2026-11-04T00:30:00Z', '2026-11-04T02:30:00Z', TZ)).toBe('7:30 PM');
    expect(USUAL_GAME_MINUTES).toBe(120);
  });
  it('card time: a game that is not the usual length also gives its end', () => {
    expect(cardTime('2026-11-04T00:30:00Z', '2026-11-04T03:00:00Z', TZ)).toEqual({ start: '7:30 PM', end: '10 PM' }); // 2.5 hours
    expect(cardTime('2026-11-04T01:00:00Z', '2026-11-04T02:30:00Z', TZ)).toEqual({ start: '8 PM', end: '9:30 PM' }); // 1.5 hours
    expect(cardTimeText('2026-11-04T00:30:00Z', '2026-11-04T03:00:00Z', TZ)).toBe('7:30–10 PM');
    expect(cardTimeText('2026-11-21T15:30:00Z', '2026-11-21T18:30:00Z', TZ)).toBe('10:30 AM–1:30 PM');
  });
  it('card time follows the usual length from Settings', () => {
    const a = '2026-11-04T01:00:00Z';
    const b = '2026-11-04T02:30:00Z'; // 90 minutes
    expect(cardTime(a, b, TZ, 90)).toEqual({ start: '8 PM', end: null });
    expect(cardTime(a, b, TZ, 120)).toEqual({ start: '8 PM', end: '9:30 PM' });
  });
  it('card time over the clock change (Sun Nov 1): still the wall-clock start', () => {
    // Sat Oct 31 8 PM EDT = Sun Nov 1 00:00Z, 10 PM = 02:00Z. Tue Nov 3 8 PM EST = Nov 4 01:00Z.
    expect(cardTime('2026-11-01T00:00:00Z', '2026-11-01T02:00:00Z', TZ).start).toBe('8 PM');
    expect(cardTime('2026-11-04T01:00:00Z', '2026-11-04T03:00:00Z', TZ).start).toBe('8 PM');
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
