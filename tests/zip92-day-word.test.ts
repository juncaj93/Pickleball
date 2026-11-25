// Zip 92 (live bug): the alert card's day was the first 3 letters of suggestDay's word, so a game next week read "Nex 8 PM needs 3 more".
import { describe, expect, it } from 'vitest';
import { shortDayWord, suggestDay } from '../shared/time';

const TZ = 'America/Detroit';
// Wed Nov 25, 2026, 3:00 PM Eastern.
const NOW = Date.parse('2026-11-25T20:00:00.000Z');
const at = (date: string) => new Date(`${date}T01:00:00.000Z`).toISOString(); // 8 PM Eastern the day before the UTC date

describe('the alert card day word', () => {
  it('tonight, tomorrow, this week, next week and 2+ weeks out: Tonight, Tomorrow, then the real short weekday', () => {
    const cases: [string, string, string][] = [
      ['2026-11-26', 'Tonight', 'tonight'], // Wed Nov 25, 8 PM
      ['2026-11-27', 'Tomorrow', 'tomorrow'], // Thu Nov 26
      ['2026-11-29', 'Sat', 'Saturday'], // this week
      ['2026-12-03', 'Wed', 'next Wednesday'], // next week (the bug: "Nex")
      ['2026-12-04', 'Thu', 'next Thursday'],
      ['2026-12-10', 'Wed', 'Wed, Dec 9'], // 2 weeks out
      ['2026-12-24', 'Wed', 'Wed, Dec 23'], // 4 weeks out
    ];
    for (const [date, short, word] of cases) {
      expect(suggestDay(at(date), TZ, NOW).word).toBe(word);
      expect(shortDayWord(at(date), TZ, NOW)).toBe(short);
    }
  });
  it('the player page builds the card title from it, never a slice of the word', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync('src/pages/PlayerHome.tsx', 'utf8');
    expect(src).toContain('shortDayWord(s.startsAt, tz');
    expect(src).not.toMatch(/day\.slice\(0, 3\)/);
    // Nowhere on the site is a day word cut to its first letters.
    for (const f of ['src/pages/PlayerHome.tsx', 'src/pages/Admin.tsx', 'shared/time.ts', 'shared/textsR2.ts', 'shared/messages.ts']) {
      expect(readFileSync(f, 'utf8'), f).not.toMatch(/(word|Word|day)\.slice\(0, 3\)/);
    }
  });
});
