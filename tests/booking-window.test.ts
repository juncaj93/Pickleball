import { describe, expect, it } from 'vitest';
import { courtStatus } from '../shared/court';
import { DEFAULT_SETTINGS } from '../shared/settings';
import { computeSessionState, type StatusInput } from '../shared/status';
import { bookingOpensMs, formatDateTime } from '../shared/time';
import { buildTodo, homeBadgeCount } from '../src/pages/admin/todo';
import { setupGroup } from './harness';

const TZ = 'America/Detroit';
/** A wall-clock time in Eastern, written with its offset. */
const et = (s: string) => Date.parse(s);

function session(startsAt: string): StatusInput {
  const start = Date.parse(startsAt);
  return {
    startsAt,
    endsAt: new Date(start + 2 * 3600_000).toISOString(),
    status: 'planned',
    bookingStatus: 'needs_booking',
    cancellationDeadlineAt: null,
    adminDecision: null,
    confirmedCount: 4,
    waitlistCount: 0,
    unconfirmedAttendanceCount: 4,
  };
}
const flags = (startsAt: string, nowMs: number) => computeSessionState(session(startsAt), nowMs, DEFAULT_SETTINGS, TZ).flags;

// Tue Nov 10, 8:00 PM Eastern (EST, after the clock change).
const NOV10 = '2026-11-11T01:00:00.000Z';

describe('14-day booking window, counted by calendar date', () => {
  it('a game exactly 14 days out is open all day, from 12:00 AM', () => {
    expect(new Date(bookingOpensMs(NOV10, 14, TZ)).toISOString()).toBe('2026-10-27T04:00:00.000Z'); // Tue Oct 27, 12:00 AM EDT
    expect(flags(NOV10, et('2026-10-27T00:00:00-04:00')).bookingWindowOpen).toBe(true); // 12:00 AM
    expect(flags(NOV10, et('2026-10-27T08:35:00-04:00')).needsBooking).toBe(true); // this morning
    expect(flags(NOV10, et('2026-10-27T19:59:00-04:00')).bookingWindowOpen).toBe(true); // before the old 8:00 PM opening
  });

  it('15 days out is not open yet', () => {
    // Wed Nov 11 from Tue Oct 27.
    expect(flags('2026-11-12T01:00:00.000Z', et('2026-10-27T23:59:00-04:00')).bookingWindowOpen).toBe(false);
    // Thu Nov 12 from Tue Oct 27 (16 days) too.
    expect(flags('2026-11-13T01:00:00.000Z', et('2026-10-27T12:00:00-04:00')).needsBooking).toBe(false);
  });

  it('the 12:00 AM edge: 11:59 PM the night before is closed, midnight is open', () => {
    expect(flags(NOV10, et('2026-10-26T23:59:59-04:00')).bookingWindowOpen).toBe(false);
    expect(flags(NOV10, et('2026-10-27T00:00:00-04:00')).bookingWindowOpen).toBe(true);
  });

  it('handles the Sun Nov 1 clock change (Eastern moves back an hour)', () => {
    // Sun Nov 15 game opens Sun Nov 1 at 12:00 AM, still daylight time (EDT, -4).
    expect(new Date(bookingOpensMs('2026-11-16T01:00:00.000Z', 14, TZ)).toISOString()).toBe('2026-11-01T04:00:00.000Z');
    // Mon Nov 16 game opens Mon Nov 2 at 12:00 AM, standard time (EST, -5).
    expect(new Date(bookingOpensMs('2026-11-17T01:00:00.000Z', 14, TZ)).toISOString()).toBe('2026-11-02T05:00:00.000Z');
    // A game in daylight time that opens across the change still lands on midnight.
    expect(formatDateTime(new Date(bookingOpensMs('2026-11-16T01:00:00.000Z', 14, TZ)).toISOString(), TZ)).toBe('Sun, Nov 1, 12:00 AM');
    expect(formatDateTime(new Date(bookingOpensMs('2026-11-17T01:00:00.000Z', 14, TZ)).toISOString(), TZ)).toBe('Mon, Nov 2, 12:00 AM');
    // The night of the change: 11:59 PM EST Sun Nov 1 is still closed for Tue Nov 17.
    expect(flags('2026-11-18T01:00:00.000Z', et('2026-11-02T23:59:00-05:00')).bookingWindowOpen).toBe(false);
    expect(flags('2026-11-18T01:00:00.000Z', et('2026-11-03T00:00:00-05:00')).bookingWindowOpen).toBe(true);
    // Spring forward too: Wed Mar 24, 2027 opens Wed Mar 10 at 12:00 AM EDT.
    expect(formatDateTime(new Date(bookingOpensMs('2027-03-25T00:00:00.000Z', 14, TZ)).toISOString(), TZ)).toBe('Wed, Mar 10, 12:00 AM');
  });

  it('"Booking opens [date]" shows the same day the button starts working', () => {
    const opensAt = new Date(bookingOpensMs(NOV10, 14, TZ)).toISOString();
    const base = { canceled: false, started: false, past: false, bookingStatus: 'needs_booking' as const, courtState: null };
    expect(courtStatus({ ...base, bookingOpen: false, bookingOpensAt: opensAt }, TZ).text).toBe('Booking opens Tue, Oct 27');
    expect(courtStatus({ ...base, bookingOpen: true, bookingOpensAt: opensAt }, TZ)).toMatchObject({ kind: 'needs', text: 'Court not booked' });
  });

  it('the server, the amber line and "I booked it" all follow the same rule', async () => {
    const ctx = await setupGroup();
    ctx.app.now = et('2026-10-27T08:35:00-04:00'); // Tue Oct 27, 8:35 AM
    const d = (await ctx.organizer.call('GET', '/api/admin/dashboard')).data;
    const nov10 = d.sessions.find((s: any) => s.startsAt === NOV10);
    expect(nov10.bookingOpensAt).toBe('2026-10-27T04:00:00.000Z');
    expect(nov10.state.flags.bookingWindowOpen).toBe(true);
    expect(nov10.state.flags.needsBooking).toBe(true);
    // Thu Nov 12 is 16 days out: gray, with the date its window opens.
    const nov12 = d.sessions.find((s: any) => s.startsAt === '2026-11-13T01:00:00.000Z');
    expect(nov12.state.flags.bookingWindowOpen).toBe(false);
    expect(nov12.bookingOpensAt).toBe('2026-10-29T04:00:00.000Z');
    const look = courtStatus({ ...nov12, canceled: false, started: false, past: false, bookingOpen: false }, TZ);
    expect(look.text).toBe('Booking opens Thu, Oct 29');
    // "I booked it" works on Nov 10 today.
    expect((await ctx.organizer.call('POST', `/api/admin/sessions/${nov10.id}/booked`, {})).status).toBe(200);
    // Players see the same rule.
    const g = (await ctx.app.client().call('GET', '/api/group')).data;
    const p12 = g.sessions?.find((s: any) => s.id === nov12.id);
    if (p12) expect(p12.bookingOpensAt).toBe('2026-10-29T04:00:00.000Z');
  });
});

describe('booking reminder at 7:00 AM', () => {
  it('a court that opened today counts on the Home badge from 7:00 AM, not before', () => {
    // Opens Tue Oct 27, 12:00 AM; the reminder starts at 7:00 AM.
    expect(new Date(bookingOpensMs(NOV10, 14, TZ, 7)).toISOString()).toBe('2026-10-27T11:00:00.000Z');
    expect(flags(NOV10, et('2026-10-27T06:59:00-04:00')).bookingPromptDue).toBe(false);
    expect(flags(NOV10, et('2026-10-27T07:00:00-04:00')).bookingPromptDue).toBe(true);
    // Still bookable before 7:00 AM; the reminder is just quieter.
    expect(flags(NOV10, et('2026-10-27T06:59:00-04:00')).needsBooking).toBe(true);
    // Across the clock change: Mon Nov 16's reminder is Mon Nov 2, 7:00 AM EST.
    expect(formatDateTime(new Date(bookingOpensMs('2026-11-17T01:00:00.000Z', 14, TZ, 7)).toISOString(), TZ)).toBe('Mon, Nov 2, 7:00 AM');
  });

  it('the Home badge follows it', async () => {
    const ctx = await setupGroup();
    const count = async (at: number) => {
      ctx.app.now = at;
      const d = (await ctx.organizer.call('GET', '/api/admin/dashboard')).data;
      return { badge: homeBadgeCount(d) - buildTodo(d).length, open: d.sessions.filter((s: any) => s.state.flags.needsBooking).length };
    };
    const before = await count(et('2026-10-27T06:59:00-04:00'));
    const after = await count(et('2026-10-27T07:00:00-04:00'));
    expect(before.open).toBe(after.open);
    expect(after.badge).toBe(before.badge + 1); // Nov 10's court joins at 7:00 AM
  });

  it('does not move the game-day payment card (8:00 AM) or the cancellation deadline', async () => {
    const { PAY_FROM_HOUR } = await import('../shared/money');
    expect(PAY_FROM_HOUR).toBe(8);
    expect(DEFAULT_SETTINGS.defaultDeadlineHours).toBe(12);
  });
});
