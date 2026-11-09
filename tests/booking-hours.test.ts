// Zip 24: "Booking hours" (BOOKING_HOURS, ships OFF). A game outside the venue hours is blocked on the screen and on the server.
// Venue hours (Eastern, the game's own date): Mon to Sat 8:00 AM to 10:00 PM, Sunday 8:00 AM to 7:00 PM. A game never runs past midnight.
// The rule only looks at a NEW game or a CHANGED start or end; a game that already exists is never blocked or changed because of it.
import { describe, expect, it } from 'vitest';
import { activityText } from '../shared/activity';
import {
  BOOKING_HOURS,
  bookingHoursAllowed,
  checkBookingTimes,
  checkDay,
  checkUsualTime,
  clockLabel,
  fitStart,
  hoursFor,
  hoursLine,
  hoursMessage,
  hoursMessageAnyDay,
  isPickerLength,
  latestStart,
  lengthChoices,
  lengthFits,
  startSlots,
  VENUE_HOURS,
  weekdayOfDate,
} from '../shared/bookingHours';
import { BUILDING_ON, smallSwitchRows } from '../scripts/preview-world-small';
import { DEFAULT_SETTINGS } from '../shared/settings';
import { GAME_LENGTHS, gameCreditBack, gameFinalPrice, gameMinutes, gamePrice, lengthRow, NORMAL_MINUTES, PICKER_MINUTES, SHORT_MINUTES } from '../shared/gameLength';
import { toLocalInputValue, zonedTimeToUtc } from '../shared/time';
import { setupGroup, TestApp } from './harness';

const TZ = 'America/Detroit';
const at = (y: number, m: number, d: number, h: number, min = 0) => new Date(zonedTimeToUtc(y, m, d, h, min, TZ)).toISOString();
const min = (h: number, m = 0) => h * 60 + m;
const MON = 1;
const TUE = 2;
const SUN = 0;

describe('the hours table (one place)', () => {
  it('Mon to Sat 8:00 AM to 10:00 PM, Sunday 8:00 AM to 7:00 PM', () => {
    for (const d of [1, 2, 3, 4, 5, 6]) expect(hoursFor(d)).toEqual({ open: min(8), close: min(22) });
    expect(hoursFor(SUN)).toEqual({ open: min(8), close: min(19) });
    expect(Object.keys(VENUE_HOURS)).toHaveLength(7);
  });
  it('the words come from the table: "8:00 AM", "10:00 PM", "12:30 PM"', () => {
    expect(clockLabel(min(8))).toBe('8:00 AM');
    expect(clockLabel(min(22))).toBe('10:00 PM');
    expect(clockLabel(min(12, 30))).toBe('12:30 PM');
    expect(clockLabel(min(0))).toBe('12:00 AM');
  });
  it('the message wording for a date, and the one with both hours', () => {
    expect(hoursLine(TUE)).toBe('The venue is open 8:00 AM to 10:00 PM on this day.');
    expect(hoursLine(SUN)).toBe('The venue is open 8:00 AM to 7:00 PM on Sundays.');
    expect(hoursMessage(TUE)).toBe('The venue is open 8:00 AM to 10:00 PM on this day. Pick times inside those hours.');
    expect(hoursMessage(SUN)).toBe('The venue is open 8:00 AM to 7:00 PM on Sundays. Pick times inside those hours.');
    expect(hoursMessageAnyDay()).toBe('The venue is open 8:00 AM to 10:00 PM (Sundays 8:00 AM to 7:00 PM). Pick times inside those hours.');
  });
  it('weekday of a plain date, no time zone', () => {
    expect(weekdayOfDate('2026-11-08')).toBe(SUN);
    expect(weekdayOfDate('2026-11-09')).toBe(MON);
    expect(weekdayOfDate('2026-11-11')).toBe(3);
    expect(weekdayOfDate('nope')).toBeNull();
  });
});

describe('the rule, both sides of every boundary', () => {
  it('8:00 AM start is OK, 7:59 AM start is blocked', () => {
    expect(checkDay(TUE, min(8), min(10)).ok).toBe(true);
    const r = checkDay(TUE, min(7, 59), min(10));
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.why).toBe('hours');
  });
  it('Mon to Sat: a 10:00 PM end is OK, 10:01 PM is blocked', () => {
    for (const d of [1, 2, 3, 4, 5, 6]) {
      expect(checkDay(d, min(20), min(22)).ok).toBe(true);
      expect(checkDay(d, min(20), min(22, 1)).ok).toBe(false);
    }
  });
  it('Sunday: a 7:00 PM end is OK, 7:30 PM is blocked', () => {
    expect(checkDay(SUN, min(17), min(19)).ok).toBe(true);
    expect(checkDay(SUN, min(17), min(19, 30)).ok).toBe(false);
    expect(checkDay(SUN, min(17, 30), min(19, 30)).ok).toBe(false);
  });
  it('an end at or before the start is blocked with the existing words', () => {
    for (const [a, b] of [[min(20), min(20)], [min(20), min(19)], [min(21), min(8)]]) {
      const r = checkDay(TUE, a, b);
      expect(r).toEqual({ ok: false, why: 'order', message: 'The end time must be after the start time.' });
    }
  });
  it('a 9:00 PM to 11:00 PM game is blocked, and so is one that runs past midnight', () => {
    expect(checkDay(TUE, min(21), min(23)).ok).toBe(false);
    expect(checkBookingTimes(at(2026, 11, 11, 21), at(2026, 11, 11, 23), TZ).ok).toBe(false);
    const night = checkBookingTimes(at(2026, 11, 11, 23), at(2026, 11, 12, 1), TZ);
    expect(night.ok).toBe(false);
    expect(night.ok === false && night.message).toBe(hoursMessage(3)); // the start's own day (Wed)
  });
  it('real ISO times in Eastern, on the game date: Wed 8:00 AM to 10:00 PM is fine; Sunday uses Sunday hours', () => {
    expect(checkBookingTimes(at(2026, 11, 11, 8), at(2026, 11, 11, 22), TZ).ok).toBe(true);
    expect(checkBookingTimes(at(2026, 11, 15, 17), at(2026, 11, 15, 19), TZ).ok).toBe(true);
    const sun = checkBookingTimes(at(2026, 11, 15, 18), at(2026, 11, 15, 20), TZ);
    expect(sun.ok === false && sun.message).toBe(hoursMessage(SUN));
    expect(checkBookingTimes(at(2026, 11, 14, 18), at(2026, 11, 14, 20), TZ).ok).toBe(true); // the same hours on a Saturday
  });
  it('seconds count: an end of 10:00:30 PM (or Sunday 7:00:30 PM) is after closing; 10:00:00 is fine', () => {
    const t = (d: number, h: number, m: number, sec: number) => new Date(zonedTimeToUtc(2026, 11, d, h, m, TZ) + sec * 1000).toISOString();
    expect(checkBookingTimes(t(11, 20, 0, 0), t(11, 22, 0, 0), TZ).ok).toBe(true);
    expect(checkBookingTimes(t(11, 20, 0, 0), t(11, 22, 0, 30), TZ).ok).toBe(false);
    expect(checkBookingTimes(t(15, 17, 0, 0), t(15, 19, 0, 30), TZ).ok).toBe(false);
    expect(checkBookingTimes(t(11, 7, 59, 59), t(11, 10, 0, 0), TZ).ok).toBe(false);
    expect(checkBookingTimes(t(11, 8, 0, 0), t(11, 10, 0, 0), TZ).ok).toBe(true);
  });
  it('daylight saving does not move the clock the rule reads (Eastern wall time)', () => {
    // Sun Nov 1, 2026: the clocks went back at 2:00 AM; 8:00 AM to 7:00 PM wall time is still inside the hours.
    expect(checkBookingTimes(at(2026, 11, 1, 8), at(2026, 11, 1, 19), TZ).ok).toBe(true);
    expect(checkBookingTimes(at(2026, 11, 1, 8), at(2026, 11, 1, 19, 1), TZ).ok).toBe(false);
  });
  it('the usual game time (Settings > Schedule, Tue and Thu) uses a weekday\'s hours', () => {
    expect(checkUsualTime(min(19), min(21)).ok).toBe(true);
    expect(checkUsualTime(min(20), min(22)).ok).toBe(true);
    expect(checkUsualTime(min(20), min(22, 30)).ok).toBe(false);
    expect(checkUsualTime(min(7), min(9)).ok).toBe(false);
    expect(checkUsualTime(min(21), min(20)).ok).toBe(false);
  });
});

describe('what the picker offers', () => {
  it('Mon to Sat: 8:00 AM through 8:30 PM (nothing after 8:30 PM), every 30 minutes', () => {
    const s = startSlots(TUE);
    expect(s[0]).toBe(min(8));
    expect(s[s.length - 1]).toBe(min(20, 30));
    expect(s).toHaveLength(26);
    expect(s.every((m, i) => i === 0 || m - s[i - 1] === 30)).toBe(true);
    expect(s.includes(min(21))).toBe(false);
  });
  it('Sunday: 8:00 AM through 5:30 PM (nothing after 5:30 PM)', () => {
    const s = startSlots(SUN);
    expect(s[0]).toBe(min(8));
    expect(s[s.length - 1]).toBe(min(17, 30));
    expect(s.includes(min(18))).toBe(false);
  });
  it('no offered start ever leaves the shortest offered game running past close, on any day', () => {
    for (let d = 0; d < 7; d++) for (const m of startSlots(d)) expect(lengthFits(d, m, Math.min(...PICKER_MINUTES))).toBe(true);
  });
  it('a length that would pass close is not allowed; the boundary is exact', () => {
    expect(lengthFits(TUE, min(20), 120)).toBe(true); // ends exactly 10:00 PM
    expect(lengthFits(TUE, min(20, 30), 120)).toBe(false); // 10:30 PM
    expect(lengthFits(TUE, min(20, 30), 90)).toBe(true); // 10:00 PM
    expect(lengthFits(SUN, min(17), 120)).toBe(true); // 7:00 PM
    expect(lengthFits(SUN, min(17, 30), 120)).toBe(false);
    expect(lengthFits(SUN, min(17, 30), 90)).toBe(true);
    // A 2.5 hour game from 4:30 PM on Sunday ends exactly 7:00 PM (the rule is length-agnostic: any length the site adds later follows it).
    expect(lengthFits(SUN, min(16, 30), 150)).toBe(true);
    expect(lengthFits(SUN, min(17), 150)).toBe(false);
    expect(lengthFits(TUE, min(19, 30), 150)).toBe(true);
    expect(lengthFits(TUE, min(20), 180)).toBe(false);
    expect(lengthFits(TUE, min(19), 180)).toBe(true);
  });
  it('the latest start that fits a length', () => {
    expect(latestStart(TUE, 120)).toBe(min(20));
    expect(latestStart(TUE, 90)).toBe(min(20, 30));
    expect(latestStart(SUN, 120)).toBe(min(17));
    expect(latestStart(SUN, 90)).toBe(min(17, 30));
    expect(latestStart(SUN, 24 * 60)).toBeNull();
  });
});

describe('moving the date nudges the start into the new day\'s hours', () => {
  it('a start that fits stays; too late goes to the latest start; too early goes to opening', () => {
    expect(fitStart(TUE, min(19), 120)).toBe(min(19));
    expect(fitStart(SUN, min(20), 120)).toBe(min(17)); // 8:00 PM Tuesday game moved to a Sunday
    expect(fitStart(SUN, min(18), 90)).toBe(min(17, 30));
    expect(fitStart(TUE, min(6), 120)).toBe(min(8));
    expect(fitStart(TUE, min(21), 90)).toBe(min(20, 30));
    expect(fitStart(SUN, min(9), 24 * 60)).toBe(min(9)); // nothing fits: left as it is
  });
});

describe('length buttons: only lengths whose money rules are fully handled; prices come from the site\'s own code', () => {
  const settings = { pricePerPlayerCents: DEFAULT_SETTINGS.pricePerPlayerCents, typicalCourtCostCents: DEFAULT_SETTINGS.typicalCourtCostCents };
  it('1.5 hr and 2 hr only (2.5 and 3 hr have no price row yet)', () => {
    expect([...PICKER_MINUTES]).toEqual([90, 120]);
    expect(isPickerLength(90)).toBe(true);
    expect(isPickerLength(120)).toBe(true);
    expect(isPickerLength(60)).toBe(false);
    expect(isPickerLength(150)).toBe(false);
    expect(isPickerLength(180)).toBe(false);
    for (const m of PICKER_MINUTES) expect(lengthRow(m)).not.toBeNull();
    expect(GAME_LENGTHS.map((r) => r.minutes)).toEqual([90, 120]);
  });
  it('the price under each button is what gamePrice() says (with Short games on: 1.5 hr $11, 2 hr $14)', () => {
    const c = lengthChoices(TUE, min(19), settings, true);
    expect(c.map((x) => [x.label, x.price, x.fits])).toEqual([['1.5 hr', '$11 each', true], ['2 hr', '$14 each', true]]);
  });
  it('with Short games OFF a 1.5 hour game is priced like a normal one, and the button says so', () => {
    const c = lengthChoices(TUE, min(19), settings, false);
    expect(c.map((x) => x.price)).toEqual(['$14 each', '$14 each']);
  });
  it('the price follows Settings > Money (a $15 price shows $15 on 2 hr)', () => {
    const c = lengthChoices(TUE, min(19), { ...settings, pricePerPlayerCents: 15_00 }, true);
    expect(c[1].price).toBe('$15 each');
  });
  it('a length that would pass close is flagged (fits false), the rest stay on', () => {
    const c = lengthChoices(TUE, min(20, 30), settings, true);
    expect(c.map((x) => x.fits)).toEqual([true, false]);
    expect(lengthChoices(SUN, min(17, 30), settings, true).map((x) => x.fits)).toEqual([true, false]);
    expect(lengthChoices(SUN, null, settings, true).every((x) => x.fits)).toBe(true);
  });
});

describe('PRICING CHECK: each game length against the money code (this is the evidence for the report)', () => {
  const settings = { pricePerPlayerCents: 14_00, typicalCourtCostCents: 48_00 };
  const at2 = (minutes: number) => ({ startsAt: '2026-11-11T23:00:00.000Z', endsAt: new Date(Date.parse('2026-11-11T23:00:00.000Z') + minutes * 60_000).toISOString() });
  const finals = (minutes: number, shortGames = true) => {
    const p = gamePrice(at2(minutes), settings, shortGames);
    return [4, 5, 6, 7, 8, 9, 10].map((n) => gameFinalPrice(p, n) / 100);
  };
  it('length is End minus Start in minutes', () => {
    for (const m of [60, 90, 120, 150, 180]) expect(gameMinutes(at2(m).startsAt, at2(m).endsAt)).toBe(m);
  });
  it('1.5 hr: its own row. Up front $11, final table 11/9/7/6/5/4/4, credit back, court $36', () => {
    const p = gamePrice(at2(90), settings, true);
    expect(p.special).toBe(true);
    expect(p.flatCents).toBe(11_00);
    expect(p.courtCents).toBe(36_00);
    expect(finals(90)).toEqual([11, 9, 7, 6, 5, 4, 4]);
    expect(gameCreditBack(p, 6)).toBe(4_00);
  });
  it('2 hr: Settings > Money. Up front $14, floor(4 x 14 / N) = 14/11/9/8/7/6/5, credit back, court $48', () => {
    const p = gamePrice(at2(120), settings, true);
    expect(p.special).toBe(false);
    expect(p.flatCents).toBe(14_00);
    expect(p.courtCents).toBe(48_00);
    expect(finals(120)).toEqual([14, 11, 9, 8, 7, 6, 5]);
    expect(gameCreditBack(p, 8)).toBe(7_00);
  });
  it('1 hr, 2.5 hr, 3 hr: NO row. They are priced like a normal 2 hour game ($14, court $48), so they are NOT offered by the picker', () => {
    for (const m of [60, 150, 180]) {
      const p = gamePrice(at2(m), settings, true);
      expect(p.special).toBe(false);
      expect(p.row).toBeNull();
      expect(p.flatCents).toBe(14_00); // not $18 or $21
      expect(p.courtCents).toBe(48_00); // not $60 or $72
      expect(finals(m)).toEqual([14, 11, 9, 8, 7, 6, 5]);
      expect(isPickerLength(m)).toBe(false);
    }
    expect(NORMAL_MINUTES).toBe(120);
    expect(SHORT_MINUTES).toBe(90);
  });
});

describe('the switch', () => {
  it('the kill switch: allowed unless it says off', () => {
    expect(bookingHoursAllowed(undefined)).toBe(true);
    expect(bookingHoursAllowed('on')).toBe(true);
    expect(bookingHoursAllowed(' OFF ')).toBe(false);
  });
  it('the preview seed has the row ON (preview behaves like the zip being built)', () => {
    expect([...BUILDING_ON]).toContain(BOOKING_HOURS.task);
    expect(smallSwitchRows(Date.parse('2026-11-09T15:00:00Z'))).toContain(`'preview-${BOOKING_HOURS.task}'`);
  });
});

// ---- the server ----
async function world() {
  const app = new TestApp();
  const w = await setupGroup(app);
  await w.organizer.call('PUT', '/api/admin/group', { organizerName: 'Alex' });
  return w;
}
type W = Awaited<ReturnType<typeof world>>;
const dash = async (w: W, headers: Record<string, string> = {}) => (await w.organizer.call('GET', '/api/admin/dashboard', undefined, headers)).data;
const on = { [BOOKING_HOURS.header]: 'on' };
const add = (w: W, startsAt: string, endsAt: string, headers: Record<string, string> = on) => w.organizer.call('POST', '/api/admin/sessions', { startsAt, endsAt }, headers);

describe('the switch: off by default, a Settings row, a private link, a kill switch', () => {
  it('off: no Booking hours field anywhere on the dashboard, and a game at 11 PM is accepted exactly as on main', async () => {
    const w = await world();
    const d = await dash(w);
    expect(d.bookingHours).toBeUndefined();
    expect(d.bookingHoursForAll).toBeUndefined();
    expect(JSON.stringify(d)).not.toMatch(/bookingHours/);
    expect((await add(w, at(2026, 11, 11, 23), at(2026, 11, 12, 1), {})).status).toBe(200);
    expect((await add(w, at(2026, 11, 14, 6), at(2026, 11, 14, 8), {})).status).toBe(200);
  });
  it('the Settings row turns it on for every organizer phone, with an Activity line; the kill switch beats it; the private link works alone', async () => {
    const w = await world();
    expect((await w.organizer.call('PUT', '/api/admin/booking-hours-switch', { on: true })).status).toBe(200);
    let d = await dash(w);
    expect(d.bookingHours).toBe(true);
    expect(d.bookingHoursForAll).toBe(true);
    const act = (await w.organizer.call('GET', '/api/admin/activity')).data.entries.find((e: any) => e.action === 'booking_hours_on');
    expect(act).toBeDefined();
    expect(activityText(act, TZ, 'Alex')).toContain('switched "Booking hours" on');
    (w.app.env as unknown as Record<string, unknown>).BOOKING_HOURS = 'off';
    d = await dash(w);
    expect(d.bookingHours).toBeUndefined();
    expect(d.bookingHoursForAll).toBe(true);
    expect((await dash(w, on)).bookingHours).toBeUndefined();
    // the kill switch also stops the server check
    expect((await add(w, at(2026, 11, 11, 23), at(2026, 11, 12, 1), {})).status).toBe(200);
    (w.app.env as unknown as Record<string, unknown>).BOOKING_HOURS = undefined;
    expect((await w.organizer.call('PUT', '/api/admin/booking-hours-switch', { on: false })).status).toBe(200);
    d = await dash(w);
    expect(d.bookingHours).toBeUndefined();
    expect((await w.organizer.call('GET', '/api/admin/activity')).data.entries.some((e: any) => e.action === 'booking_hours_off')).toBe(true);
    d = await dash(w, on);
    expect(d.bookingHours).toBe(true);
    expect(d.bookingHoursForAll).toBeUndefined();
  });
  it('a player cannot flip it', async () => {
    const w = await world();
    const c = w.app.client();
    expect((await c.call('PUT', '/api/admin/booking-hours-switch', { on: true })).status).toBe(401);
  });
});

describe('the server refuses an out-of-hours NEW game (Add game)', () => {
  it('Mon to Sat: 8:00 AM to 10:00 PM is the widest game; 7:59 AM start and 10:01 PM end are refused with the message', async () => {
    const w = await world();
    expect((await add(w, at(2026, 11, 11, 8), at(2026, 11, 11, 10))).status).toBe(200);
    const early = await add(w, at(2026, 11, 12, 7, 59), at(2026, 11, 12, 10));
    expect(early.status).toBe(400);
    expect(early.data.message).toBe(hoursMessage(4));
    expect((await add(w, at(2026, 11, 13, 20), at(2026, 11, 13, 22))).status).toBe(200);
    const late = await add(w, at(2026, 11, 14, 20), at(2026, 11, 14, 22, 1));
    expect(late.status).toBe(400);
    expect(late.data.message).toBe('The venue is open 8:00 AM to 10:00 PM on this day. Pick times inside those hours.');
  });
  it('Sunday: a 7:00 PM end is fine, a 7:30 PM end is refused with the Sunday wording', async () => {
    const w = await world();
    expect((await add(w, at(2026, 11, 15, 17), at(2026, 11, 15, 19))).status).toBe(200);
    const r = await add(w, at(2026, 11, 22, 17, 30), at(2026, 11, 22, 19, 30));
    expect(r.status).toBe(400);
    expect(r.data.message).toBe('The venue is open 8:00 AM to 7:00 PM on Sundays. Pick times inside those hours.');
  });
  it('a 9:00 PM to 11:00 PM game and a game past midnight are refused; nothing is saved', async () => {
    const w = await world();
    const before = (await dash(w)).sessions.length;
    expect((await add(w, at(2026, 11, 11, 21), at(2026, 11, 11, 23))).status).toBe(400);
    expect((await add(w, at(2026, 11, 11, 23), at(2026, 11, 12, 1))).status).toBe(400);
    expect((await dash(w)).sessions.length).toBe(before);
  });
  it('an end before the start still says the old words, and the usual limits (6 hours, future) still apply first', async () => {
    const w = await world();
    const r = await add(w, at(2026, 11, 11, 20), at(2026, 11, 11, 19));
    expect(r.status).toBe(400);
    expect(r.data.message).toBe('The end time must be after the start time.');
    expect((await add(w, at(2026, 10, 20, 19), at(2026, 10, 20, 21))).data.message).toBe('Pick a time in the future.');
  });
  it('all four lengths that fit a good start go through (1.5 hr and 2 hr), and every length that fits is accepted', async () => {
    const w = await world();
    expect((await add(w, at(2026, 11, 11, 19), at(2026, 11, 11, 20, 30))).status).toBe(200);
    expect((await add(w, at(2026, 11, 12, 18), at(2026, 11, 12, 20))).status).toBe(200);
    expect((await add(w, at(2026, 11, 13, 16, 30), at(2026, 11, 13, 19))).status).toBe(200); // 2.5 hr that fits is not blocked by this rule
  });
});

describe('the server refuses an out-of-hours CHANGED time (Edit game), and leaves old games alone', () => {
  const putTime = (w: W, id: string, startsAt: string, endsAt: string, headers: Record<string, string> = on) => w.organizer.call('PUT', `/api/admin/sessions/${id}/time`, { startsAt, endsAt }, headers);

  it('moving a game outside the hours is refused (each boundary), inside is fine', async () => {
    const w = await world();
    const id = (await add(w, at(2026, 11, 11, 19), at(2026, 11, 11, 21), {})).data.id;
    for (const [a, b, ok] of [
      [at(2026, 11, 11, 8), at(2026, 11, 11, 10), true],
      [at(2026, 11, 11, 7, 59), at(2026, 11, 11, 10), false],
      [at(2026, 11, 11, 20), at(2026, 11, 11, 22), true],
      [at(2026, 11, 11, 20), at(2026, 11, 11, 22, 1), false],
      [at(2026, 11, 11, 21), at(2026, 11, 11, 23), false],
      [at(2026, 11, 11, 20), at(2026, 11, 11, 19), false],
    ] as [string, string, boolean][]) {
      const r = await putTime(w, id, a, b);
      expect(r.status, `${a} ${b}`).toBe(ok ? 200 : 400);
    }
    // Sunday: move to Sunday 6:00 PM to 8:00 PM refused; 5:00 PM to 7:00 PM fine.
    const r1 = await putTime(w, id, at(2026, 11, 15, 18), at(2026, 11, 15, 20));
    expect(r1.status).toBe(400);
    expect(r1.data.message).toBe(hoursMessage(SUN));
    expect((await putTime(w, id, at(2026, 11, 15, 17), at(2026, 11, 15, 19))).status).toBe(200);
  });
  it('switch off: the same moves are accepted exactly as on main', async () => {
    const w = await world();
    const id = (await add(w, at(2026, 11, 11, 19), at(2026, 11, 11, 21), {})).data.id;
    expect((await putTime(w, id, at(2026, 11, 11, 21), at(2026, 11, 11, 23), {})).status).toBe(200);
  });
  it('an existing out-of-hours game: cancel, note, court status and an unchanged time all keep working with the switch on', async () => {
    const w = await world();
    // Made before the rule (switch off): a 6:00 AM to 8:00 AM game and an 11 PM game.
    const early = (await add(w, at(2026, 11, 11, 6), at(2026, 11, 11, 8), {})).data.id;
    const late = (await add(w, at(2026, 11, 12, 22, 30), at(2026, 11, 13, 0, 30), {})).data.id;
    // Switch on for everyone.
    await w.organizer.call('PUT', '/api/admin/booking-hours-switch', { on: true });
    const d = await dash(w);
    expect(d.sessions.find((s: any) => s.id === early)).toBeDefined(); // shown without error
    expect(d.sessions.find((s: any) => s.id === late)).toBeDefined();
    expect((await w.organizer.call('PUT', `/api/admin/sessions/${early}/note`, { note: 'Early bird' })).status).toBe(200);
    expect((await w.organizer.call('POST', `/api/admin/sessions/${early}/court-status`, { status: 'booked' })).status).toBe(200);
    // Saving the same times is "no change", never a refusal.
    expect((await putTime(w, early, at(2026, 11, 11, 6), at(2026, 11, 11, 8), {})).data).toMatchObject({ ok: true, changed: false });
    expect((await w.organizer.call('POST', `/api/admin/sessions/${late}/decision`, { decision: 'cancel', confirm: true })).status).toBe(200);
    const after = (await dash(w)).sessions;
    expect(after.find((s: any) => s.id === late).state.flags.canceled).toBe(true);
    // Changing it INTO the hours is allowed; changing it to another out-of-hours time is refused.
    expect((await putTime(w, early, at(2026, 11, 11, 7), at(2026, 11, 11, 9), {})).status).toBe(400);
    expect((await putTime(w, early, at(2026, 11, 11, 9), at(2026, 11, 11, 11), {})).status).toBe(200);
  });
});

describe('Settings > Schedule (usual game time) on the server', () => {
  it('a changed usual time outside the hours is refused with the any-day message; inside is saved; off: accepted as on main', async () => {
    const w = await world();
    await w.organizer.call('PUT', '/api/admin/booking-hours-switch', { on: true });
    const bad = await w.organizer.call('PUT', '/api/admin/group', { settings: { defaultStartMinutes: min(21), defaultEndMinutes: min(23) } });
    expect(bad.status).toBe(400);
    const tooEarly = await w.organizer.call('PUT', '/api/admin/group', { settings: { defaultStartMinutes: min(7, 30), defaultEndMinutes: min(9, 30) } });
    expect(tooEarly.status).toBe(400);
    expect((await w.organizer.call('PUT', '/api/admin/group', { settings: { defaultStartMinutes: min(19), defaultEndMinutes: min(21) } })).status).toBe(200);
    expect((await dash(w)).group.settings.defaultStartMinutes).toBe(min(19));
    await w.organizer.call('PUT', '/api/admin/booking-hours-switch', { on: false });
    expect((await w.organizer.call('PUT', '/api/admin/group', { settings: { defaultStartMinutes: min(21), defaultEndMinutes: min(23) } })).status).toBe(200);
  });
  it('another Settings save never trips over an old out-of-hours usual time', async () => {
    const w = await world();
    await w.organizer.call('PUT', '/api/admin/group', { settings: { defaultStartMinutes: min(21), defaultEndMinutes: min(23) } });
    await w.organizer.call('PUT', '/api/admin/booking-hours-switch', { on: true });
    expect((await w.organizer.call('PUT', '/api/admin/group', { settings: { pricePerPlayerCents: 15_00 } })).status).toBe(200);
    expect((await w.organizer.call('PUT', '/api/admin/group', { organizerName: 'Alex' })).status).toBe(200);
    // Saving the same usual time again is not a change.
    expect((await w.organizer.call('PUT', '/api/admin/group', { settings: { defaultStartMinutes: min(21), defaultEndMinutes: min(23) } })).status).toBe(200);
  });
});

describe('Eastern wall time in the picker helpers', () => {
  it('a game shown as "8:00 PM" in the form round-trips through the real times and passes the rule', () => {
    const iso = at(2026, 11, 11, 20);
    expect(toLocalInputValue(iso, TZ).slice(11)).toBe('20:00');
    expect(checkBookingTimes(iso, at(2026, 11, 11, 22), TZ).ok).toBe(true);
  });
});
