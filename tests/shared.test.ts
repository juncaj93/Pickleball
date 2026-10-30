import { describe, expect, it } from 'vitest';
import { sessionCalendar } from '../shared/calendar';
import { formatCents, formatPrice, parseDollars, venmoPayUrl } from '../shared/money';
import { countText, DEFAULT_MAX_PLAYERS, goingText, joinOutcome, MAX_PLAYERS_LIMIT, MIN_PLAYERS, openSpots, playersNeeded } from '../shared/spots';
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
    expect(formatTimeRange(sessions[0].startsAt, sessions[0].endsAt, TZ)).toBe('8:00 to 10:00 PM');
    const nov = sessions.find((s) => s.startsAt.startsWith('2026-11-04'))!;
    expect(formatTimeRange(nov.startsAt, nov.endsAt, TZ)).toBe('8:00 to 10:00 PM');
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
    expect(s).toBe('Tue, Oct 27, 8:00 PM');
    expect(s).not.toMatch(/UTC|GMT|Z$/);
  });

  it('round-trips datetime inputs in the group time zone', () => {
    const iso = fromLocalInputValue('2026-11-03T08:00', TZ)!;
    expect(iso).toBe('2026-11-03T13:00:00.000Z');
    expect(toLocalInputValue(iso, TZ)).toBe('2026-11-03T08:00');
    expect(new Date(zonedTimeToUtc(2026, 7, 4, 12, 0, TZ)).toISOString()).toBe('2026-07-04T16:00:00.000Z');
  });
});

describe('spots: any number from 4 up to the max', () => {
  it('lets everyone in until the max (10 by default), then waitlists; the 5th and 6th are simply in', () => {
    expect([MIN_PLAYERS, DEFAULT_MAX_PLAYERS, MAX_PLAYERS_LIMIT]).toEqual([4, 10, 12]);
    expect([0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((c) => joinOutcome(c, 10))).toEqual(Array(10).fill('in'));
    expect(joinOutcome(10, 10)).toBe('waitlist'); // the 11th person
    expect(joinOutcome(11, 10)).toBe('waitlist');
    // The max is a setting.
    expect(joinOutcome(3, 4)).toBe('in');
    expect(joinOutcome(4, 4)).toBe('waitlist');
    expect(joinOutcome(5, 6)).toBe('in');
    expect(joinOutcome(6, 6)).toBe('waitlist');
    expect(joinOutcome(11, 12)).toBe('in');
  });

  it('describes the count in plain words', () => {
    expect(countText(0, 10)).toBe('0 of 4 in');
    expect(countText(3, 10)).toBe('3 of 4 in');
    expect(countText(4, 10)).toBe('4 in');
    expect(countText(5, 10)).toBe('5 in');
    expect(countText(9, 10)).toBe('9 in');
    expect(countText(10, 10)).toBe('10 in, full');
    expect(countText(6, 6)).toBe('6 in, full');
    expect(goingText(3, 10)).toBe('3 going · 1 more needed');
    expect(goingText(4, 10)).toBe('4 going');
    expect(goingText(5, 10)).toBe('5 going');
    expect(goingText(10, 10)).toBe('10 going · full');
    expect(openSpots(2, 10)).toBe(8);
    expect(openSpots(4, 10)).toBe(6);
    expect(openSpots(10, 10)).toBe(0);
    expect(openSpots(11, 10)).toBe(0);
    expect(openSpots(4, 4)).toBe(0);
    expect([0, 1, 3, 4, 7].map(playersNeeded)).toEqual([4, 3, 1, 0, 0]);
  });
});

describe('money', () => {
  it('formats and parses dollars', () => {
    expect(formatCents(1125)).toBe('$11.25');
    expect(formatCents(5)).toBe('$0.05');
    expect(formatPrice(1400)).toBe('$14');
    expect(formatPrice(1450)).toBe('$14.50');
    expect(parseDollars('$45.5')).toBe(4550);
    expect(parseDollars('45')).toBe(4500);
    expect(parseDollars('abc')).toBeNull();
    expect(parseDollars('45.555')).toBeNull();
  });

  it('fills the amount into Venmo when it can read the username', () => {
    const pay = venmoPayUrl('https://venmo.com/u/Alex-Smith', 1400, 'Pickleball Tue Oct 27');
    expect(pay).toEqual({
      url: 'https://venmo.com/?txn=pay&recipients=Alex-Smith&amount=14&note=Pickleball%20Tue%20Oct%2027',
      appUrl: 'venmo://paycharge?txn=pay&recipients=Alex-Smith&amount=14&note=Pickleball%20Tue%20Oct%2027',
      prefilled: true,
    });
    expect(venmoPayUrl('https://account.venmo.com/u/alex', 1400, 'x').prefilled).toBe(true);
    expect(venmoPayUrl('https://venmo.com/alex', 1400, 'x').url).toContain('recipients=alex&amount=14&');
    // Anything else: open the saved link and let the page show the amount.
    expect(venmoPayUrl('https://example.com/pay', 1400, 'x')).toEqual({ url: 'https://example.com/pay', appUrl: null, prefilled: false });
    expect(venmoPayUrl(null, 1400, 'x').url).toBeNull();
  });
});

describe('calendar file', () => {
  it('makes an 8:00–10:00 PM Eastern event called Pickleball at the club', () => {
    const ics = sessionCalendar({
      id: 'abc',
      startsAt: '2026-10-28T00:00:00.000Z', // Tue Oct 27, 8:00 PM EDT
      endsAt: '2026-10-28T02:00:00.000Z',
      location: 'Northville Pickleball Club, 123 Main St, Northville, MI',
      nowIso: '2026-10-26T16:00:00.000Z',
    });
    expect(ics).toContain('BEGIN:VCALENDAR\r\n');
    expect(ics).toContain('SUMMARY:Pickleball\r\n');
    // Written in Eastern wall-clock time with the zone's rules, never in UTC.
    expect(ics).toContain('DTSTART;TZID=America/Detroit:20261027T200000\r\n');
    expect(ics).toContain('DTEND;TZID=America/Detroit:20261027T220000\r\n');
    expect(ics).not.toMatch(/DT(START|END)[^\r]*Z\r\n/);
    expect(ics).toContain('BEGIN:VTIMEZONE\r\nTZID:America/Detroit\r\n');
    expect(ics).toContain('RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU\r\nTZOFFSETFROM:-0500\r\nTZOFFSETTO:-0400\r\nTZNAME:EDT');
    expect(ics).toContain('RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU\r\nTZOFFSETFROM:-0400\r\nTZOFFSETTO:-0500\r\nTZNAME:EST');
    // The time zone block comes before the event, as Calendar expects.
    expect(ics.indexOf('END:VTIMEZONE')).toBeLessThan(ics.indexOf('BEGIN:VEVENT'));
    expect(ics).toContain('LOCATION:Northville Pickleball Club\\, 123 Main St\\, Northville\\, MI');
    expect(ics).toContain('UID:abc@pickleball-club');
    expect(ics.trimEnd().endsWith('END:VCALENDAR')).toBe(true);
  });

  it('stays 8:00 to 10:00 PM after the November time change (standard time)', () => {
    const ics = sessionCalendar({
      id: 'def',
      startsAt: '2026-11-04T01:00:00.000Z', // Tue Nov 3, 8:00 PM EST
      endsAt: '2026-11-04T03:00:00.000Z',
      location: 'Northville Pickleball Club',
      nowIso: '2026-10-26T16:00:00.000Z',
      timezone: 'America/Detroit',
    });
    expect(ics).toContain('DTSTART;TZID=America/Detroit:20261103T200000\r\n');
    expect(ics).toContain('DTEND;TZID=America/Detroit:20261103T220000\r\n');
    expect(ics).toContain('SUMMARY:Pickleball\r\n');
  });

  it('the zone rules put both dates on the right side of the change', () => {
    // 2026: daylight time ends Sun Nov 1 at 2:00 AM. Oct 27 is EDT (-4), Nov 3 is EST (-5).
    const rule = (y: number, month: number, nth: number) => {
      const first = new Date(Date.UTC(y, month - 1, 1)).getUTCDay();
      return 1 + ((7 - first) % 7) + (nth - 1) * 7;
    };
    expect(rule(2026, 11, 1)).toBe(1);
    expect(rule(2026, 3, 2)).toBe(8);
    expect(rule(2027, 11, 1)).toBe(7);
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
    waitlistCount: 0,
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

  it('5 going is on track like any count from 4 to the max; the flags carry open spots, players needed and full', () => {
    const five = at({ confirmedCount: 5 }, start - 5 * DAY);
    expect(five.label).toBe('on_track');
    expect(five.text).toBe('On track');
    expect(five.flags).toMatchObject({ underfilled: false, openSpots: 5, playersNeeded: 0, full: false });
    expect(five.flags).not.toHaveProperty('fiveGoing');
    expect(at({ confirmedCount: 6 }, start - 5 * DAY).label).toBe('on_track');
    expect(at({ confirmedCount: 10 }, start - 5 * DAY)).toMatchObject({ label: 'on_track', flags: { openSpots: 0, full: true } });
    expect(at({ confirmedCount: 3 }, start - 5 * DAY).flags).toMatchObject({ underfilled: true, openSpots: 7, playersNeeded: 1, full: false });
    // The max is a setting; a canceled or started game has no open spots.
    expect(computeSessionState({ ...base, confirmedCount: 6 }, start - 5 * DAY, { ...DEFAULT_SETTINGS, maxPlayers: 6 }).flags).toMatchObject({ openSpots: 0, full: true });
    expect(at({ confirmedCount: 5, status: 'canceled' }, start - 5 * DAY).flags).toMatchObject({ openSpots: 0, playersNeeded: 0, full: false });
    expect(at({ confirmedCount: 5 }, start + HOUR).flags).toMatchObject({ openSpots: 0, full: false });
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
    expect(m).toContain('8:00 to 10:00 PM');
    expect(m).toContain('https://club.example/t/abc');
    expect(replacementMessage(s, TZ, 'https://x/t/1')).toContain('First to claim it gets the spot: https://x/t/1');
    expect(bookingMessage(s, TZ)).toContain("I'm checking court bookings now.");
  });

  it('includes the right player and amount in payment reminders', () => {
    expect(paymentMessage('Blair', 1125, [s], TZ, 'pickleball.juncaj.net')).toBe('Hey Blair, you owe $11.25 for pickleball Tue Oct 27. Pay here: pickleball.juncaj.net');
  });

  it('states the exact deadline in the organizer alert', () => {
    expect(deadlineAlertMessage(s, TZ, '2026-10-27T12:00:00.000Z')).toContain('Tue, Oct 27, 8:00 AM');
  });

  it('builds sms links for iPhone and Android', () => {
    expect(normalizePhone('(313) 555-0100')).toBe('+13135550100');
    expect(smsHref('(313) 555-0100', 'Hi & bye', true)).toBe('sms:+13135550100&body=Hi%20%26%20bye');
    expect(smsHref('313-555-0100', 'Hi', false)).toBe('sms:+13135550100?body=Hi');
    expect(smsHref(null, 'Hi', true)).toBe('sms:&body=Hi');
  });
});
