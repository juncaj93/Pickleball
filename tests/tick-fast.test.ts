import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { dayAt, dueAlerts, mayAlertSoon, nextTasks, type TaskOptions, type TaskSession } from '../shared/tasks';
import { TIMEZONE_OPTIONS } from '../shared/time';
import { MARKS, OPTS, SCENARIO, sweep, ticks } from './tick-scenarios';

// The 5-minute tick got faster (Cloudflare's free plan allows 10 ms of CPU).
// These prove it says and sends exactly what it did before.

const HOUR = 3600_000;
const golden = JSON.parse(readFileSync(new URL('./fixtures/tick-golden.json', import.meta.url), 'utf8'));

describe('the tick speed-up changes nothing', () => {
  it('every card and alert, every 5 minutes Oct 14 to Nov 27, matches the old code word for word and minute for minute', { timeout: 120_000 }, () => {
    // tick-golden.json was written by the code before the speed-up. It covers
    // the Sun Nov 1 clock change, 7:00, 7:30 and 8:00 PM games, a game with no court and more.
    expect(sweep()).toEqual(golden.noMarks);
    expect(sweep(SCENARIO, MARKS)).toEqual(golden.withMarks);
  });

  it('the old alerts include the clock change and each start time', () => {
    const lines: string[] = golden.noMarks.alerts;
    expect(lines).toContain('Sat, Oct 31, 6:00 PM | s-2026-11-01-190:night | Sunday: 3 players in, need a 4th. Text the group: https://pickleball.juncaj.net/go/s-2026-11-01-190');
    expect(lines.some((l) => l.startsWith('Sun, Nov 1, 6:15 AM | s-2026-11-01-190:gameday'))).toBe(true);
    expect(lines.some((l) => l.startsWith('Mon, Nov 2, 6:00 PM | s-2026-11-03-190:night'))).toBe(true); // 7:00 PM game
    expect(lines.some((l) => l.startsWith('Wed, Nov 4, 6:30 PM | s-2026-11-05-1930:night'))).toBe(true); // 7:30 PM game
    expect(lines.some((l) => l.startsWith('Tue, Nov 10, 8:15 AM | s-2026-11-10-200:nocourt'))).toBe(true); // 8:00 PM, no court
  });

  it('the quick check passes every game whose alert is due, on the scenario', { timeout: 120_000 }, () => {
    for (const now of ticks()) {
      const all = dueAlerts(nextTasks(now, SCENARIO, MARKS, OPTS), now, new Set());
      const kept = SCENARIO.filter((s) => mayAlertSoon(s, s.confirmedCount, now, OPTS) && mayAlertSoon(s, null, now, OPTS));
      expect(dueAlerts(nextTasks(now, kept, MARKS, OPTS), now, new Set())).toEqual(all);
    }
  });

  it('the quick check never skips a due alert: random games in every zone, across all four 2026 and 2027 clock changes', { timeout: 120_000 }, () => {
    let seed = 7;
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    const pick = <T>(list: T[]) => list[Math.floor(rand() * list.length)];
    const near = ['2026-03-08', '2026-11-01', '2027-03-14', '2027-11-07', '2026-11-15', '2026-03-22', '2027-11-21', '2026-06-10'];
    let checked = 0;
    let passed = 0;
    for (let i = 0; i < 150; i++) {
      const tz = pick(TIMEZONE_OPTIONS).value;
      const o: TaskOptions = { ...OPTS, tz, bookingLeadDays: pick([14, 14, 7, 21]), defaultDeadlineHours: pick([12, 12, 6, 24]) };
      const base = Date.parse(`${pick(near)}T17:00:00Z`) + Math.floor(rand() * 30 - 15) * 24 * HOUR;
      const startMs = dayAt(new Date(base).toISOString(), tz, 0, pick([6, 7, 9, 10, 12, 17, 19, 19, 20, 21, 23]), pick([0, 0, 15, 30, 45]));
      const deadline = pick([null, null, startMs - 12 * HOUR, startMs - 24 * HOUR, startMs - 3 * HOUR, startMs - 40 * HOUR]);
      const booked = rand() < 0.6;
      const s: TaskSession = {
        id: `g${i}`,
        startsAt: new Date(startMs).toISOString(),
        endsAt: new Date(startMs + pick([1, 1.5, 2, 3]) * HOUR).toISOString(),
        canceled: rand() < 0.05,
        canceledAt: null,
        confirmedCount: Math.floor(rand() * 8),
        booked,
        bookedAt: booked && rand() < 0.3 ? new Date(startMs - rand() * 40 * HOUR).toISOString() : null,
        cancellationDeadlineAt: deadline === null ? null : new Date(deadline).toISOString(),
        finalized: rand() < 0.2,
        holiday: null,
      };
      for (let now = startMs - (o.bookingLeadDays + 2) * 24 * HOUR; now < Date.parse(s.endsAt) + 3 * HOUR; now += 5 * 60_000) {
        const due = dueAlerts(nextTasks(now, [s], new Set(), o), now, new Set());
        const quick = mayAlertSoon(s, s.confirmedCount, now, o) && mayAlertSoon(s, null, now, o);
        if (due.length) expect({ tz, now: new Date(now).toISOString(), s, quick }).toMatchObject({ quick: true });
        checked++;
        if (quick) passed++;
      }
    }
    // It must also actually skip: most ticks need no task list.
    console.log(`quick check passes ${(100 * passed / checked).toFixed(1)}% of ${checked} ticks`);
    expect(passed / checked).toBeLessThan(0.2);
  });
});
