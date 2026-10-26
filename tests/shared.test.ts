import { describe, expect, it } from 'vitest';
import { formatCents, parseDollars, splitCost } from '../shared/money';
import { planSessions } from '../shared/schedule';
import { DEFAULT_SETTINGS, normalizeSettings } from '../shared/settings';
import { computeSessionState, type StatusInput } from '../shared/status';
import {
  formatDateTime,
  formatTimeRange,
  fromLocalInputValue,
  localParts,
  toLocalInputValue,
  zonedTimeToUtc,
} from '../shared/time';
import {
  bookingMessage,
  confirmationMessage,
  deadlineAlertMessage,
  normalizePhone,
  paymentMessage,
  replacementMessage,
  smsHref,
} from '../shared/messages';
import { DAY, HOUR, MONDAY_NOON } from './harness';

const TZ = 'America/Detroit';

describe('session generation', () => {
  it('creates only Tuesdays and Thursdays at 8–10 PM Eastern', () => {
    const sessions = planSessions(MONDAY_NOON, TZ, 6);
    expect(sessions.length).toBeGreaterThan(0);
    for (const s of sessions) {
      const start = localParts(Date.parse(s.startsAt), TZ);
      const end = localParts(Date.parse(s.endsAt), TZ);
      expect([2, 4]).toContain(start.weekday);
      expect([start.hour, start.minute]).toEqual([20, 0]);
      expect([end.hour, end.minute]).toEqual([22, 0]);
      expect(Date.parse(s.endsAt) - Date.parse(s.startsAt)).toBe(2 * HOUR);
    }
  });

  it('handles the November daylight saving change', () => {
    const sessions = planSessions(MONDAY_NOON, TZ, 2);
    // Tue Oct 27 is EDT (UTC-4), Tue Nov 3 is EST (UTC-5).
    expect(sessions[0].startsAt).toBe('2026-10-28T00:00:00.000Z');
    expect(sessions.find((s) => s.startsAt.startsWith('2026-11-04'))?.startsAt).toBe('2026-11-04T01:00:00.000Z');
    expect(formatTimeRange(sessions[0].startsAt, sessions[0].endsAt, TZ)).toBe('8:00–10:00 PM EDT');
    const nov = sessions.find((s) => s.startsAt.startsWith('2026-11-04'))!;
    expect(formatTimeRange(nov.startsAt, nov.endsAt, TZ)).toBe('8:00–10:00 PM EST');
  });

  it('handles the March daylight saving change', () => {
    // DST starts Sunday, March 14 2027.
    const sessions = planSessions(Date.parse('2027-03-08T17:00:00.000Z'), TZ, 2);
    const before = sessions.find((s) => s.startsAt.startsWith('2027-03-12'))!; // Thu Mar 11, EST
    const after = sessions.find((s) => s.startsAt.startsWith('2027-03-17'))!; // Tue Mar 16, EDT
    expect(before.startsAt).toBe('2027-03-12T01:00:00.000Z');
    expect(after.startsAt).toBe('2027-03-17T00:00:00.000Z');
  });

  it('covers the rolling horizon and is deterministic', () => {
    const six = planSessions(MONDAY_NOON, TZ, 6);
    expect(six).toHaveLength(12); // 6 weeks x Tue+Thu
    expect(planSessions(MONDAY_NOON, TZ, 6)).toEqual(six);
    expect(planSessions(MONDAY_NOON, TZ, 3)).toHaveLength(6);
    const last = Date.parse(six[six.length - 1].startsAt);
    expect(last - MONDAY_NOON).toBeLessThanOrEqual(42 * DAY + DAY);
  });

  it('skips a session that already started today', () => {
    const tuesday9pm = Date.parse('2026-10-28T01:00:00.000Z');
    const sessions = planSessions(tuesday9pm, TZ, 1);
    expect(sessions[0].startsAt).toBe('2026-10-30T00:00:00.000Z');
  });
});

describe('time display', () => {
  it('uses a 12-hour clock in Eastern time, never UTC', () => {
    const s = formatDateTime('2026-10-28T00:00:00.000Z', TZ);
    expect(s).toBe('Tue, Oct 27, 8:00 PM EDT');
    expect(s).not.toMatch(/UTC|GMT|Z$/);
  });

  it('round-trips datetime inputs in the group time zone', () => {
    const iso = fromLocalInputValue('2026-11-03T08:00', TZ)!;
    expect(iso).toBe('2026-11-03T13:00:00.000Z');
    expect(toLocalInputValue(iso, TZ)).toBe('2026-11-03T08:00');
    expect(new Date(zonedTimeToUtc(2026, 7, 4, 12, 0, TZ)).toISOString()).toBe('2026-07-04T16:00:00.000Z');
  });
});

describe('cost split', () => {
  it('splits evenly when possible', () => {
    expect(splitCost(4800)).toEqual([1200, 1200, 1200, 1200]);
  });

  it('always adds back up to the court cost', () => {
    for (const total of [0, 1, 2, 3, 4501, 4502, 4503, 9999, 12345]) {
      const shares = splitCost(total);
      expect(shares.reduce((a, b) => a + b, 0)).toBe(total);
      expect(Math.max(...shares) - Math.min(...shares)).toBeLessThanOrEqual(1);
    }
    expect(splitCost(4501)).toEqual([1126, 1125, 1125, 1125]);
    expect(splitCost(4503)).toEqual([1126, 1126, 1126, 1125]);
  });

  it('formats and parses dollars', () => {
    expect(formatCents(1125)).toBe('$11.25');
    expect(formatCents(5)).toBe('$0.05');
    expect(parseDollars('$45.5')).toBe(4550);
    expect(parseDollars('45')).toBe(4500);
    expect(parseDollars('abc')).toBeNull();
    expect(parseDollars('45.555')).toBeNull();
  });
});

describe('session status', () => {
  const start = Date.parse('2026-11-04T01:00:00.000Z');
  const base: StatusInput = {
    startsAt: new Date(start).toISOString(),
    endsAt: new Date(start + 2 * HOUR).toISOString(),
    status: 'booked',
    bookingStatus: 'booked',
    cancellationDeadlineAt: new Date(start - 12 * HOUR).toISOString(),
    adminDecision: null,
    confirmedCount: 4,
    unconfirmedAttendanceCount: 4,
  };
  const at = (input: Partial<StatusInput>, now: number) => computeSessionState({ ...base, ...input }, now, DEFAULT_SETTINGS);

  it('is on track when full and booked', () => {
    expect(at({}, start - 5 * DAY).label).toBe('on_track');
  });

  it('flags booking about 14 days ahead, not earlier', () => {
    const planned = { status: 'planned' as const, bookingStatus: 'needs_booking' as const, cancellationDeadlineAt: null };
    expect(at(planned, start - 15 * DAY).flags.needsBooking).toBe(false);
    expect(at(planned, start - 14 * DAY).flags.needsBooking).toBe(true);
    expect(at(planned, start - 14 * DAY).label).toBe('needs_booking');
  });

  it('runs the 24-hour check-in, then the 12-hour cancellation deadline', () => {
    // 3 of 4 going. Before the check-in mark it just needs players.
    expect(at({ confirmedCount: 3 }, start - 25 * HOUR).label).toBe('needs_players');
    expect(at({ confirmedCount: 3 }, start - 25 * HOUR).flags.shortOnPlayers).toBe(false);
    // From 24 hours before: flagged, check-in texts due, still before the deadline.
    const checkIn = at({ confirmedCount: 3 }, start - 24 * HOUR);
    expect(checkIn.label).toBe('short_on_players');
    expect(checkIn.flags.inCheckIn).toBe(true);
    expect(checkIn.flags.checkInsDue).toBe(true);
    expect(checkIn.flags.deadlinePassed).toBe(false);
    expect(at({ confirmedCount: 3 }, start - 12 * HOUR - 60_000).label).toBe('short_on_players');
    // From 12 hours before: deadline passed.
    const after = at({ confirmedCount: 3 }, start - 12 * HOUR);
    expect(after.label).toBe('deadline_passed');
    expect(after.flags.deadlinePassed).toBe(true);
    // A full session never gets flagged.
    expect(at({ confirmedCount: 4 }, start - 2 * HOUR).label).toBe('on_track');
  });

  it('uses each booking\'s own deadline', () => {
    const custom = new Date(start - 20 * HOUR).toISOString();
    expect(at({ confirmedCount: 2, cancellationDeadlineAt: custom }, start - 21 * HOUR).flags.deadlinePassed).toBe(false);
    expect(at({ confirmedCount: 2, cancellationDeadlineAt: custom }, start - 19 * HOUR).label).toBe('deadline_passed');
  });

  it('follows the check-in hours setting', () => {
    const settings = { ...DEFAULT_SETTINGS, checkInHours: 36 };
    const state = computeSessionState({ ...base, confirmedCount: 2 }, start - 30 * HOUR, settings);
    expect(state.label).toBe('short_on_players');
    expect(at({ confirmedCount: 2 }, start - 30 * HOUR).label).toBe('needs_players');
  });

  it('stops flagging once the organizer keeps it as is', () => {
    expect(at({ confirmedCount: 3, adminDecision: 'keep' }, start - 20 * HOUR).flags.shortOnPlayers).toBe(false);
    expect(at({ confirmedCount: 3, adminDecision: 'keep' }, start - 20 * HOUR).label).toBe('needs_players');
  });

  it('makes check-in texts due 24 hours before play', () => {
    expect(at({}, start - 25 * HOUR).flags.checkInsDue).toBe(false);
    expect(at({}, start - 24 * HOUR).flags.checkInsDue).toBe(true);
    expect(at({ unconfirmedAttendanceCount: 0 }, start - 2 * HOUR).flags.checkInsDue).toBe(false);
  });

  it('marks canceled sessions and stops other flags', () => {
    const s = at({ status: 'canceled', confirmedCount: 1 }, start - HOUR);
    expect(s.label).toBe('canceled');
    expect(s.flags.shortOnPlayers).toBe(false);
    expect(s.flags.checkInsDue).toBe(false);
  });

  it('reads older saved settings', () => {
    expect(normalizeSettings({ confirmationLeadHours: 30, warningWindowHours: 18 }).checkInHours).toBe(30);
    expect(normalizeSettings({}).checkInHours).toBe(24);
    expect(normalizeSettings({ checkInHours: 500 }).checkInHours).toBe(72);
  });
});

describe('message templates', () => {
  const s = { startsAt: '2026-10-28T00:00:00.000Z', endsAt: '2026-10-28T02:00:00.000Z' };

  it('includes date, time, and the personal link', () => {
    const m = confirmationMessage('Alex', s, TZ, 'https://club.example/t/abc');
    expect(m).toContain('Alex');
    expect(m).toContain('Tuesday, Oct 27');
    expect(m).toContain('8:00–10:00 PM EDT');
    expect(m).toContain('https://club.example/t/abc');
    expect(replacementMessage(s, TZ, 'https://x/t/1')).toContain('First to claim it gets the spot: https://x/t/1');
    expect(bookingMessage(s, TZ)).toContain("I'm checking court bookings now.");
  });

  it('includes the right player and amount in payment reminders', () => {
    const m = paymentMessage('Blair', 1125, s, TZ, 'https://venmo.com/u/organizer');
    expect(m).toBe('Hey Blair! You owe $11.25 for pickleball on Tuesday, Oct 27. Please send it here: https://venmo.com/u/organizer');
  });

  it('states the exact deadline in the organizer alert', () => {
    expect(deadlineAlertMessage(s, TZ, '2026-10-27T12:00:00.000Z')).toContain('Tue, Oct 27, 8:00 AM EDT');
  });

  it('builds sms links for iPhone and Android', () => {
    expect(normalizePhone('(313) 555-0100')).toBe('+13135550100');
    expect(smsHref('(313) 555-0100', 'Hi & bye', true)).toBe('sms:+13135550100&body=Hi%20%26%20bye');
    expect(smsHref('313-555-0100', 'Hi', false)).toBe('sms:+13135550100?body=Hi');
    expect(smsHref(null, 'Hi', true)).toBe('sms:&body=Hi');
  });
});
