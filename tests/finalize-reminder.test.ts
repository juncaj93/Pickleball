// Zip 8, item C: the finalize reminder (Telegram alert and the "Do this now" card) is due at 10:30 PM Eastern on game night,
// on the wall clock, so it stays 10:30 PM across both daylight saving changes. A game still going at 10:30 PM gets it 5 minutes
// after it ends. The wording is unchanged. The Home "Finalize" card (needsFinalize) is not this reminder and still shows as soon
// as the game is over.
import { describe, expect, it } from 'vitest';
import { dayAt, dueAlerts, finalizeDueMs, mayAlertSoon, nextTasks, taskTimes, type TaskOptions, type TaskSession } from '../shared/tasks';
import { formatDateTime } from '../shared/time';

const TZ = 'America/Detroit';
const HOUR = 3600_000;
const OPTS: TaskOptions = { tz: TZ, bookingLeadDays: 14, defaultDeadlineHours: 12, links: { admin: 'https://x.example/admin', book: 'b', cancel: 'c' } };

function game(date: string, hour: number, minute: number, hours = 2, over: Partial<TaskSession> = {}): TaskSession {
  const [y, m, d] = date.split('-').map(Number);
  const start = dayAt(new Date(Date.UTC(y, m - 1, d, 17)).toISOString(), TZ, 0, hour, minute);
  return {
    id: `g-${date}-${hour}${minute}`,
    startsAt: new Date(start).toISOString(),
    endsAt: new Date(start + hours * HOUR).toISOString(),
    canceled: false,
    canceledAt: null,
    confirmedCount: 5,
    booked: true,
    bookedAt: null,
    cancellationDeadlineAt: new Date(start - 12 * HOUR).toISOString(),
    finalized: false,
    holiday: null,
    ...over,
  };
}
const eastern = (ms: number) => formatDateTime(new Date(ms).toISOString(), TZ);

describe('finalize reminder at 10:30 PM Eastern (Zip 8)', () => {
  it('7:00, 7:30 and 8:00 PM games all get it at 10:30 PM game night', () => {
    expect(eastern(finalizeDueMs(game('2026-11-03', 19, 0), TZ))).toBe('Tue, Nov 3, 10:30 PM');
    expect(eastern(finalizeDueMs(game('2026-11-05', 19, 30), TZ))).toBe('Thu, Nov 5, 10:30 PM');
    expect(eastern(finalizeDueMs(game('2026-11-10', 20, 0), TZ))).toBe('Tue, Nov 10, 10:30 PM');
    expect(taskTimes(game('2026-11-10', 20, 0), OPTS).finalize).toBe(finalizeDueMs(game('2026-11-10', 20, 0), TZ));
  });

  it('daylight saving: 10:30 PM EDT in summer, 10:30 PM EST in winter, and on both change days', () => {
    // Summer (EDT, UTC-4): 02:30Z the next day.
    expect(new Date(finalizeDueMs(game('2026-07-14', 19, 0), TZ)).toISOString()).toBe('2026-07-15T02:30:00.000Z');
    // Winter (EST, UTC-5): 03:30Z the next day.
    expect(new Date(finalizeDueMs(game('2026-12-01', 19, 0), TZ)).toISOString()).toBe('2026-12-02T03:30:00.000Z');
    // The fall-back day (Sun Nov 1, 2026) and the spring-forward day (Sun Mar 8, 2026 and Mar 14, 2027).
    expect(new Date(finalizeDueMs(game('2026-11-01', 19, 0), TZ)).toISOString()).toBe('2026-11-02T03:30:00.000Z');
    expect(new Date(finalizeDueMs(game('2026-03-08', 19, 0), TZ)).toISOString()).toBe('2026-03-09T02:30:00.000Z');
    expect(eastern(finalizeDueMs(game('2027-03-14', 19, 0), TZ))).toBe('Sun, Mar 14, 10:30 PM');
    // The days around each change.
    expect(eastern(finalizeDueMs(game('2026-10-29', 20, 0), TZ))).toBe('Thu, Oct 29, 10:30 PM');
    expect(eastern(finalizeDueMs(game('2026-11-03', 20, 0), TZ))).toBe('Tue, Nov 3, 10:30 PM');
    expect(eastern(finalizeDueMs(game('2026-03-10', 20, 0), TZ))).toBe('Tue, Mar 10, 10:30 PM');
  });

  it('a game still going at 10:30 PM gets it 5 minutes after it ends (never before the game is over)', () => {
    expect(eastern(finalizeDueMs(game('2026-11-12', 21, 0), TZ))).toBe('Thu, Nov 12, 11:05 PM'); // 9:00 to 11:00 PM
    expect(eastern(finalizeDueMs(game('2026-11-12', 20, 30, 2), TZ))).toBe('Thu, Nov 12, 10:35 PM'); // 8:30 to 10:30 PM
    expect(eastern(finalizeDueMs(game('2026-11-12', 22, 0, 2), TZ))).toBe('Fri, Nov 13, 12:05 AM'); // past midnight
    // A morning game: still 10:30 PM that night.
    expect(eastern(finalizeDueMs(game('2026-11-07', 10, 0), TZ))).toBe('Sat, Nov 7, 10:30 PM');
  });

  it('the alert goes once at 10:30 PM with the same words; the card shows from then until finalized', () => {
    const g = game('2026-11-03', 19, 0);
    const due = finalizeDueMs(g, TZ);
    const at = (ms: number) => nextTasks(ms, [g], new Set(), OPTS).filter((t) => t.kind === 'finalize');
    expect(at(Date.parse(g.endsAt) + 5 * 60_000)).toEqual([]); // 9:05 PM: not yet (the old time)
    expect(at(due - 60_000)).toEqual([]);
    const t = at(due);
    expect(t).toHaveLength(1);
    expect(t[0].text).toBe('Tuesday: finalize who played.');
    const sent = dueAlerts(t, due, new Set());
    expect(sent.map((a) => a.text)).toEqual(['Tuesday: finalize who played: https://x.example/admin']);
    expect(at(due + 20 * HOUR)).toHaveLength(1); // still there the next day
    expect(nextTasks(due, [{ ...g, finalized: true }], new Set(), OPTS).filter((x) => x.kind === 'finalize')).toEqual([]);
  });

  it("the 5-minute tick's quick check lets the 10:30 PM alert through, every day of 2026 and 2027", () => {
    for (let day = Date.parse('2026-01-01T17:00:00Z'); day < Date.parse('2028-01-01T00:00:00Z'); day += 24 * HOUR) {
      const date = new Date(day).toISOString().slice(0, 10);
      for (const [h, mi] of [[19, 0], [19, 30], [20, 0], [21, 0]]) {
        const g = game(date, h, mi);
        const due = finalizeDueMs(g, TZ);
        for (const now of [due, due + 5 * 60_000, due + 55 * 60_000]) expect(mayAlertSoon(g, g.confirmedCount, now, OPTS), `${date} ${h}:${mi}`).toBe(true);
      }
    }
  });
});
