// Games and a 5-minute clock sweep shared by the tick speed tests: the Sun
// Nov 1 clock change, 7:00, 7:30 and 8:00 PM games, a morning game, games
// with no court, a custom deadline, a late booking, a holiday, a finished
// game to finalize, and a canceled one. Times are Eastern.
import { createHash } from 'node:crypto';
import { COURTRESERVE_BOOKING_URL, COURTRESERVE_CANCEL_URL } from '../shared/settings';
import { dayAt, dueAlerts, nextTasks, type TaskOptions, type TaskSession } from '../shared/tasks';
import { formatDateTime } from '../shared/time';

export const TZ = 'America/Detroit';
const HOUR = 3600_000;
export const OPTS: TaskOptions = {
  tz: TZ,
  bookingLeadDays: 14,
  defaultDeadlineHours: 12,
  links: { admin: 'https://pickleball.juncaj.net/admin', book: COURTRESERVE_BOOKING_URL, cancel: COURTRESERVE_CANCEL_URL, go: (id) => `https://pickleball.juncaj.net/go/${id}` },
};

/** A two-hour game on a date like "2026-11-03" at a local clock time. */
export function game(date: string, hour: number, minute: number, over: Partial<TaskSession> = {}, tz = TZ, deadlineHours = 12): TaskSession {
  const [y, m, d] = date.split('-').map(Number);
  const start = dayAt(new Date(Date.UTC(y, m - 1, d, 17)).toISOString(), tz, 0, hour, minute);
  return {
    id: `s-${date}-${hour}${minute}`,
    startsAt: new Date(start).toISOString(),
    endsAt: new Date(start + 2 * HOUR).toISOString(),
    canceled: false,
    canceledAt: null,
    confirmedCount: 3,
    booked: true,
    bookedAt: null,
    cancellationDeadlineAt: new Date(start - deadlineHours * HOUR).toISOString(),
    finalized: false,
    holiday: null,
    ...over,
  };
}

export const SCENARIO: TaskSession[] = [
  game('2026-10-29', 20, 0, { confirmedCount: 6 }), // finished, to finalize
  game('2026-11-01', 19, 0), // Sun, the clock change day, 3 in
  game('2026-11-03', 19, 0), // 7:00 PM, 3 in
  game('2026-11-05', 19, 30, { confirmedCount: 5 }), // 7:30 PM, 5 in
  game('2026-11-07', 10, 0), // morning game
  game('2026-11-09', 20, 0, { bookedAt: '2026-11-09T02:00:00.000Z' }), // booked after the last call
  game('2026-11-10', 20, 0, { booked: false, confirmedCount: 5 }), // 8:00 PM, no court, 5 in
  game('2026-11-12', 20, 0, { confirmedCount: 2 }, TZ, 24), // custom deadline
  game('2026-11-17', 20, 0, { booked: false, confirmedCount: 0 }), // no court, opens Nov 3
  game('2026-11-19', 19, 0, { canceled: true, canceledAt: '2026-11-01T12:00:00.000Z' }),
  game('2026-11-26', 19, 0, { booked: false, holiday: 'Thanksgiving', confirmedCount: 4 }),
];

export const MARKS = new Set(['s-2026-11-05-1930:night_text', 's-2026-11-12-200:court_canceled']);

/** Every 5 minutes from Wed Oct 14 to Fri Nov 27 (Eastern midnight). */
export function* ticks(from = Date.parse('2026-10-14T04:00:00Z'), to = Date.parse('2026-11-27T05:00:00Z')) {
  for (let t = from; t < to; t += 5 * 60_000) yield t;
}

/** Every alert the sweep sends, with its Eastern send time, and a fingerprint of every card list. */
export function sweep(sessions = SCENARIO, marks: ReadonlySet<string> = new Set()) {
  const seen = new Set<string>();
  const alerts: string[] = [];
  const cards = createHash('sha256');
  for (const now of ticks()) {
    const tasks = nextTasks(now, sessions, marks, OPTS);
    cards.update(JSON.stringify(tasks));
    for (const a of dueAlerts(tasks, now, new Set())) {
      const line = `${formatDateTime(new Date(a.dueMs).toISOString(), TZ)} | ${a.key} | ${a.text.replace(/\n/g, ' ↵ ')}`;
      if (!seen.has(line)) alerts.push(line);
      seen.add(line);
    }
  }
  return { alerts, cards: cards.digest('hex') };
}
