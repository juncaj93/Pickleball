// Behind-the-scenes audit (Sun Nov 1, 2026): time at the calendar's edges.
// Year change, month change, Thanksgiving week, and the Sun Nov 1 clock
// change, always shown in Eastern with AM/PM. Pure functions, no database.
import { describe, expect, it } from 'vitest';
import { alertWhen } from '../shared/alerts';
import { holidayFor } from '../shared/holidays';
import { planSessions } from '../shared/schedule';
import { cancelByShort, formatDateTime, formatTime, fromLocalInputValue, toLocalInputValue, weekLabel, weekTier } from '../shared/time';
import { taskTimes } from '../shared/tasks';

const TZ = 'America/Detroit';
const at = (iso: string) => Date.parse(iso);

describe('the calendar edges', () => {
  it('games planned over New Year: Tue Dec 29, Thu Dec 31, Tue Jan 5 2027, all at 7:00 PM Eastern', () => {
    const plan = planSessions(at('2026-12-27T17:00:00Z'), TZ, 1, 19 * 60, 21 * 60);
    expect(plan.map((p) => formatDateTime(p.startsAt, TZ))).toEqual([
      expect.stringMatching(/^Tue,? Dec 29.*7:00 PM/),
      expect.stringMatching(/^Thu,? Dec 31.*7:00 PM/),
    ]);
    const next = planSessions(at('2027-01-01T17:00:00Z'), TZ, 1, 19 * 60, 21 * 60);
    expect(next.map((p) => p.startsAt)).toEqual(['2027-01-06T00:00:00.000Z', '2027-01-08T00:00:00.000Z']);
  });

  it('week words across the year and month change', () => {
    const now = at('2026-12-30T17:00:00Z'); // Wed Dec 30
    expect(weekLabel('2027-01-01T00:00:00.000Z', now, TZ)).toBe('This week'); // Thu Dec 31, 7 PM
    expect(weekLabel('2027-01-06T00:00:00.000Z', now, TZ)).toBe('Next week'); // Tue Jan 5
    expect(weekLabel('2027-01-13T00:00:00.000Z', now, TZ)).toBe('Week of Jan 11');
    expect(weekTier('2027-01-13T00:00:00.000Z', now, TZ)).toBe('later');
    expect(weekLabel('2026-12-01T00:00:00.000Z', at('2026-11-25T17:00:00Z'), TZ)).toBe('Next week');
  });

  it('Thanksgiving week: Thu Nov 26 is named, its court opens Thu Nov 12 at 7:00 AM', () => {
    const start = '2026-11-27T00:00:00.000Z'; // Thu Nov 26, 7:00 PM EST
    expect(holidayFor(start, TZ)).toMatch(/Thanksgiving/);
    const t = taskTimes({ startsAt: start, endsAt: '2026-11-27T02:00:00.000Z', cancellationDeadlineAt: null }, { tz: TZ, defaultDeadlineHours: 12, bookingLeadDays: 14 });
    expect(formatDateTime(new Date(t.courtOpens).toISOString(), TZ)).toMatch(/Thu,? Nov 12.*7:00 AM/);
    expect(formatDateTime(new Date(t.nightLastCall).toISOString(), TZ)).toMatch(/Wed,? Nov 25.*6:00 PM/);
  });

  it('the Nov 1 clock change: a Tuesday game keeps its clock time, and alerts read EST times', () => {
    const tue = '2026-11-04T01:00:00.000Z'; // Tue Nov 3, 8:00 PM EST
    expect(formatTime(tue, TZ)).toBe('8:00 PM');
    expect(alertWhen(tue, TZ)).toBe('Tue Nov 3, 8:00 PM');
    expect(cancelByShort(tue, TZ)).toBe('Tue 8:00 AM');
    // Last week's game, before the change, was also 8:00 PM on the wall clock (EDT).
    expect(formatTime('2026-10-28T00:00:00.000Z', TZ)).toBe('8:00 PM');
    // The repeated 1 AM hour shows as 1 AM both times, never 0 or 25.
    expect(formatTime('2026-11-01T05:30:00.000Z', TZ)).toBe('1:30 AM');
    expect(formatTime('2026-11-01T06:30:00.000Z', TZ)).toBe('1:30 AM');
    // A time typed into a form on the organizer's phone round-trips through Eastern.
    expect(fromLocalInputValue('2026-11-03T20:00', TZ)).toBe(tue);
    expect(toLocalInputValue(tue, TZ)).toBe('2026-11-03T20:00');
    expect(fromLocalInputValue('2027-03-14T20:00', TZ)).toBe('2027-03-15T00:00:00.000Z'); // the spring change, EDT again
  });

  it('every time shown has AM or PM and no seconds, 24-hour or UTC', () => {
    for (let t = at('2026-10-31T00:00:00Z'); t < at('2026-11-03T00:00:00Z'); t += 15 * 60_000) {
      const iso = new Date(t).toISOString();
      for (const s of [formatTime(iso, TZ), formatDateTime(iso, TZ), alertWhen(iso, TZ)]) {
        expect(s).toMatch(/\b(1[0-2]|[1-9]):[0-5]\d (AM|PM)\b/);
        expect(s).not.toMatch(/UTC|GMT|:\d\d:\d\d|\b(1[3-9]|2[0-3]|00):/);
      }
    }
  });
});
