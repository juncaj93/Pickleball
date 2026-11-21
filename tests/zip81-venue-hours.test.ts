// Zip 81 (🎾81.venue hours): date-aware venue hours. The normal week can change, special entries (a date range with hours per weekday, or one
// day open or Closed) apply to their dates, a one-day entry beats a range, an entry ends on its own after its last date. Add game, Edit game,
// Second Chance, tournament Finalize and its time moves all read the date's hours. Organizer Home shows the conflicts. No migration.
// The harness clock is Monday Oct 26, 2026, 12 PM Eastern.
import { describe, expect, it } from 'vitest';
import { setupGroup } from './harness';
import { activeSpecials, checkBookingTimes, dayRule, DEFAULT_VENUE_HOURS, hoursMessage, type SpecialHours, type VenueHoursConfig, venueHoursOf } from '../shared/bookingHours';
import { holidayCovered, readSpecial, shortClock, specialHint, specialLines, venueConflicts, weekWords } from '../shared/venueHours';
import { pickTimes } from '../shared/secondChanceTimes';
import { activityText } from '../shared/activity';
import { zonedTimeToUtc } from '../shared/time';
import { FLYER_HOURS } from '../server/tournamentTest';

const TZ = 'America/Detroit';
const at = (y: number, m: number, d: number, h: number, min = 0) => new Date(zonedTimeToUtc(y, m, d, h, min, TZ)).toISOString();
const H = (h: number, m = 0) => h * 60 + m;
const FLYERS: VenueHoursConfig = { normal: DEFAULT_VENUE_HOURS.normal, specials: FLYER_HOURS as SpecialHours[] };
const HOURS_ON = { 'X-Booking-Hours': 'on' };

describe('the rule for a date (shared/bookingHours.ts dayRule)', () => {
  it('before the winter range: the normal week (Sat Nov 21: 8 AM to 10 PM)', () => {
    expect(dayRule(FLYERS, '2026-11-21')).toMatchObject({ kind: 'normal', hours: { open: H(8), close: H(22) }, name: null });
  });
  it('the first day of the range and a plain day inside it: winter hours (Mon to Sat until 11 PM, Sunday 7 PM)', () => {
    expect(dayRule(FLYERS, '2026-11-23')).toMatchObject({ kind: 'range', hours: { open: H(8), close: H(23) }, name: 'Winter hours' });
    expect(dayRule(FLYERS, '2026-11-29')).toMatchObject({ kind: 'range', hours: { open: H(8), close: H(19) } });
  });
  it('a one-day entry beats the range: Thanksgiving 8 AM to noon, Christmas Closed, New Year’s Day 8 AM to 11 PM', () => {
    expect(dayRule(FLYERS, '2026-11-26')).toMatchObject({ kind: 'day', hours: { open: H(8), close: H(12) }, name: 'Thanksgiving' });
    expect(dayRule(FLYERS, '2026-12-25')).toMatchObject({ kind: 'day', hours: null, name: 'Christmas' });
    expect(dayRule(FLYERS, '2027-01-01')).toMatchObject({ kind: 'day', hours: { open: H(8), close: H(23) } });
  });
  it('the day the set ends still has it; the next day the normal hours are back', () => {
    expect(dayRule(FLYERS, '2027-01-31')).toMatchObject({ kind: 'range', hours: { close: H(19) } }); // a Sunday
    expect(dayRule(FLYERS, '2027-02-01')).toMatchObject({ kind: 'normal', hours: { close: H(22) } });
  });
  it('each entry leaves the list the day after its last date; after the last one the list is empty', () => {
    expect(activeSpecials(FLYERS, '2026-11-20').map((e) => e.name)).toEqual(['Winter hours', 'Thanksgiving', 'Christmas Eve', 'Christmas', 'New Year’s Eve', 'New Year’s Day']);
    expect(activeSpecials(FLYERS, '2026-11-27').map((e) => e.name)).toEqual(['Winter hours', 'Christmas Eve', 'Christmas', 'New Year’s Eve', 'New Year’s Day']);
    expect(activeSpecials(FLYERS, '2027-01-31').map((e) => e.name)).toEqual(['Winter hours']);
    expect(activeSpecials(FLYERS, '2027-02-01')).toEqual([]);
  });
  it('nothing saved: the old table; a broken entry is dropped, never guessed', () => {
    expect(venueHoursOf(null)).toEqual(DEFAULT_VENUE_HOURS);
    const bad = venueHoursOf(JSON.stringify({ venueHours: { specials: [{ id: 'x', name: 'Odd', from: '2026-02-30', to: '2026-03-01', oneDay: false, week: [] }, FLYER_HOURS[1]] } }));
    expect(bad.specials.map((e) => e.name)).toEqual(['Thanksgiving']);
  });
});

describe('the words', () => {
  it('short clock: 8 AM, noon, 11 PM, 7:30 PM, midnight', () => {
    expect([H(8), H(12), H(23), H(19, 30), H(24)].map(shortClock)).toEqual(['8 AM', 'noon', '11 PM', '7:30 PM', 'midnight']);
  });
  it('the normal line and a list row (picture 2)', () => {
    expect(weekWords(DEFAULT_VENUE_HOURS.normal)).toBe('Mon to Sat 8 AM to 10 PM · Sun 8 AM to 7 PM');
    expect(specialLines(FLYER_HOURS[0] as SpecialHours)).toEqual({ dates: 'Nov 23 to Jan 31', hours: 'Mon to Sat 8 AM to 11 PM · Sun 8 AM to 7 PM', closed: false });
    expect(specialLines(FLYER_HOURS[1] as SpecialHours)).toEqual({ dates: 'Thu Nov 26', hours: '8 AM to noon', closed: false });
    expect(specialLines(FLYER_HOURS[3] as SpecialHours)).toEqual({ dates: 'Fri Dec 25', hours: null, closed: true });
  });
  it('the Settings hint: the running (or next) range and how many single days', () => {
    expect(specialHint(FLYERS, '2026-11-24')).toBe('Winter hours to Jan 31 · 5 holidays');
    expect(specialHint(FLYERS, '2026-11-20')).toBe('Winter hours from Nov 23 · 5 holidays');
    expect(specialHint(FLYERS, '2026-12-26')).toBe('Winter hours to Jan 31 · 2 holidays');
    expect(specialHint(FLYERS, '2027-02-01')).toBe('None');
  });
  it('refusals in the same style as today, the name in brackets; a closed day says pick another date', () => {
    expect(hoursMessage(dayRule(FLYERS, '2026-11-26'))).toBe('The venue is open 8:00 AM to 12:00 PM on this day (Thanksgiving). Pick times inside those hours.');
    expect(hoursMessage(dayRule(FLYERS, '2026-12-25'))).toBe('The venue is closed on this day (Christmas). Pick another date.');
    expect(hoursMessage(dayRule(FLYERS, '2026-11-21'))).toBe('The venue is open 8:00 AM to 10:00 PM on this day. Pick times inside those hours.');
  });
});

describe('a game’s times against its date (checkBookingTimes with the hours)', () => {
  it('Thanksgiving 8 PM is refused; New Year’s Day 8 to 10 PM fits; Christmas is closed', () => {
    expect(checkBookingTimes(at(2026, 11, 26, 20), at(2026, 11, 26, 22), TZ, FLYERS)).toMatchObject({ ok: false, why: 'hours' });
    expect(checkBookingTimes(at(2027, 1, 1, 20), at(2027, 1, 1, 22), TZ, FLYERS).ok).toBe(true);
    expect(checkBookingTimes(at(2026, 12, 25, 10), at(2026, 12, 25, 12), TZ, FLYERS)).toMatchObject({ ok: false, message: 'The venue is closed on this day (Christmas). Pick another date.' });
  });
  it('winter hours let a Tuesday game run to 11 PM; the same game after the set ends is refused', () => {
    expect(checkBookingTimes(at(2026, 12, 1, 21), at(2026, 12, 1, 23), TZ, FLYERS).ok).toBe(true);
    expect(checkBookingTimes(at(2027, 2, 2, 21), at(2027, 2, 2, 23), TZ, FLYERS).ok).toBe(false);
  });
  it('without the hours: exactly the old rule', () => {
    expect(checkBookingTimes(at(2026, 12, 1, 21), at(2026, 12, 1, 23), TZ).ok).toBe(false);
    expect(checkBookingTimes(at(2026, 11, 26, 20), at(2026, 11, 26, 22), TZ).ok).toBe(true);
  });
  it('a venue open until midnight lets a game end at 12:00 AM, not later', () => {
    const late: VenueHoursConfig = { normal: DEFAULT_VENUE_HOURS.normal, specials: [{ id: 'l', name: 'Late night', from: '2026-12-05', to: '2026-12-05', oneDay: true, day: { open: H(8), close: H(24) } }] };
    expect(checkBookingTimes(at(2026, 12, 5, 22), at(2026, 12, 6, 0), TZ, late).ok).toBe(true);
    expect(checkBookingTimes(at(2026, 12, 5, 22, 30), at(2026, 12, 6, 0, 30), TZ, late).ok).toBe(false);
  });
});

describe('Second Chance start times follow the date’s hours', () => {
  it('Thanksgiving: no start fits a 2 hour game (noon close); winter Tuesday: up to 9 PM', () => {
    const noon = Date.parse(at(2026, 11, 26, 9));
    expect(pickTimes(at(2026, 11, 26, 20), TZ, noon, { lengthMs: 2 * 3_600_000, hours: FLYERS })).toEqual([]);
    const tue = pickTimes(at(2026, 12, 1, 20), TZ, Date.parse(at(2026, 12, 1, 9)), { lengthMs: 2 * 3_600_000, hours: FLYERS });
    expect(tue[tue.length - 1]).toBe(H(21));
    expect(pickTimes(at(2026, 12, 1, 20), TZ, Date.parse(at(2026, 12, 1, 9)), { lengthMs: 2 * 3_600_000 }).at(-1)).toBe(H(20));
  });
});

describe('the save checks (shared/venueHours.ts readSpecial)', () => {
  const today = '2026-10-26';
  const week = DEFAULT_VENUE_HOURS.normal;
  it('a range that overlaps another range is refused; a one-day entry inside a range is fine', () => {
    const r = readSpecial({ name: 'Holiday hours', oneDay: false, from: '2026-12-20', to: '2027-01-05', week }, FLYER_HOURS as SpecialHours[], today, 'n');
    expect(r).toEqual({ ok: false, message: 'That overlaps Winter hours (Nov 23 to Jan 31). Pick other dates.' });
    expect(readSpecial({ name: 'Tournament', oneDay: true, from: '2026-12-10', day: { open: H(8), close: H(18) } }, FLYER_HOURS as SpecialHours[], today, 'n').ok).toBe(true);
  });
  it('two one-day entries on one date, a name missing, dates passed, To before From, end before start are refused', () => {
    expect(readSpecial({ name: 'Again', oneDay: true, from: '2026-11-26', day: null }, FLYER_HOURS as SpecialHours[], today, 'n')).toMatchObject({ ok: false, message: 'Thanksgiving is already on Thu Nov 26. Edit that one instead.' });
    expect(readSpecial({ name: ' ', oneDay: true, from: '2026-12-10', day: null }, [], today, 'n')).toMatchObject({ ok: false, message: 'Type a name.' });
    expect(readSpecial({ name: 'Old', oneDay: true, from: '2026-10-01', day: null }, [], today, 'n')).toMatchObject({ ok: false });
    expect(readSpecial({ name: 'Back', oneDay: false, from: '2026-12-10', to: '2026-12-01', week }, [], today, 'n')).toMatchObject({ ok: false, message: 'The To date must be on or after the From date.' });
    expect(readSpecial({ name: 'Odd', oneDay: true, from: '2026-12-10', day: { open: H(18), close: H(9) } }, [], today, 'n')).toMatchObject({ ok: false });
  });
  it('an end of 12:00 AM means midnight', () => {
    expect(readSpecial({ name: 'Late', oneDay: true, from: '2026-12-10', day: { open: H(8), close: 0 } }, [], today, 'n')).toMatchObject({ ok: true, value: { day: { open: H(8), close: H(24) } } });
  });
});

describe('the conflicts on organizer Home (venueConflicts)', () => {
  const now = Date.parse(at(2026, 11, 20, 12));
  const game = (id: string, s: string, e: string, extra: Partial<{ canceled: boolean; finalized: boolean }> = {}) => ({ id, startsAt: s, endsAt: e, canceled: false, ...extra });
  it('Thanksgiving 8 PM: closes at noon, your game is after that (picture 5); a canceled one shows nothing', () => {
    expect(venueConflicts(FLYERS, [game('a', at(2026, 11, 26, 20), at(2026, 11, 26, 22))], null, TZ, now)).toEqual([
      { key: 'game:a', kind: 'game', id: 'a', date: '2026-11-26', title: 'Thu Nov 26: the venue closes at noon.', sub: 'Your 8 PM game is after that.' },
    ]);
    expect(venueConflicts(FLYERS, [game('a', at(2026, 11, 26, 20), at(2026, 11, 26, 22), { canceled: true })], null, TZ, now)).toEqual([]);
  });
  it('Christmas: closed; Christmas Eve 1 PM: ends after 2 PM close; a game that fits or is over shows nothing', () => {
    const list = venueConflicts(
      FLYERS,
      [game('x', at(2026, 12, 25, 20), at(2026, 12, 25, 22)), game('e', at(2026, 12, 24, 13), at(2026, 12, 24, 15)), game('ok', at(2026, 12, 1, 20), at(2026, 12, 1, 22)), game('past', at(2026, 11, 19, 20), at(2026, 11, 19, 23, 30))],
      null,
      TZ,
      now,
    );
    expect(list.map((c) => [c.id, c.title, c.sub])).toEqual([
      ['e', 'Thu Dec 24: the venue closes at 2 PM.', 'Your 1 PM game ends after that.'],
      ['x', 'Fri Dec 25: the venue is closed.', 'Your 8 PM game is that day.'],
    ]);
  });
  it('the finalized tournament: "Your tournament is after that."', () => {
    const list = venueConflicts(FLYERS, [], { id: 't', date: '2026-11-26', start: H(19, 30), minutes: 150 }, TZ, now);
    expect(list).toEqual([{ key: 'tournament:t', kind: 'tournament', id: 't', date: '2026-11-26', title: 'Thu Nov 26: the venue closes at noon.', sub: 'Your tournament is after that.' }]);
  });
  it('the holiday question is skipped only when a one-day entry covers the date', () => {
    expect(holidayCovered(FLYERS, '2026-11-26')).toBe(true);
    expect(holidayCovered(FLYERS, '2026-12-01')).toBe(false);
  });
});

describe('the server', () => {
  async function world() {
    const w = await setupGroup();
    await w.organizer.call('PUT', '/api/admin/group', { organizerName: 'Alex' });
    expect((await w.organizer.call('PUT', '/api/admin/booking-hours-switch', { on: true })).status).toBe(200);
    return w;
  }
  const add = (w: Awaited<ReturnType<typeof world>>, body: Record<string, unknown>) => w.organizer.call('POST', '/api/admin/venue-hours/special', body);

  it('add, list on the dashboard, edit, remove; every save keeps the other settings and the Activity line says what changed', async () => {
    const w = await world();
    expect((await w.organizer.call('PUT', '/api/admin/group', { zelleNumber: '248-555-0123' })).status).toBe(200);
    const a = await add(w, { name: 'Thanksgiving', oneDay: true, from: '2026-11-26', day: { open: H(8), close: H(12) } });
    expect(a.status, a.text).toBe(200);
    const b = await add(w, { name: 'Winter hours', oneDay: false, from: '2026-11-23', to: '2027-01-31', week: FLYER_HOURS[0].week });
    expect(b.status, b.text).toBe(200);
    let d = (await w.organizer.call('GET', '/api/admin/dashboard')).data;
    expect(d.group.venueHours.specials.map((e: SpecialHours) => e.name)).toEqual(['Thanksgiving', 'Winter hours']);
    expect(d.group.zelleNumber).toBe('248-555-0123');
    // A plain Settings save never touches the hours.
    expect((await w.organizer.call('PUT', '/api/admin/group', { settings: { checkInHours: 20 } })).status).toBe(200);
    d = (await w.organizer.call('GET', '/api/admin/dashboard')).data;
    expect(d.group.venueHours.specials).toHaveLength(2);
    expect((await add(w, { id: a.data.id, name: 'Thanksgiving', oneDay: true, from: '2026-11-26', day: null })).status).toBe(200);
    d = (await w.organizer.call('GET', '/api/admin/dashboard')).data;
    expect(d.group.venueHours.specials.find((e: SpecialHours) => e.id === a.data.id).day).toBeNull();
    expect((await w.organizer.call('POST', '/api/admin/venue-hours/remove', { id: a.data.id })).status).toBe(200);
    d = (await w.organizer.call('GET', '/api/admin/dashboard')).data;
    expect(d.group.venueHours.specials.map((e: SpecialHours) => e.name)).toEqual(['Winter hours']);
    const lines = d.audit.map((e: any) => activityText(e, TZ, 'Alex'));
    expect(lines).toContain('Alex added special venue hours: Thanksgiving, Thu Nov 26 · 8 AM to noon');
    expect(lines).toContain('Alex changed special venue hours: Thanksgiving, Thu Nov 26 · Closed');
    expect(lines).toContain('Alex removed special venue hours: Thanksgiving');
  });

  it('refuses an overlapping range and an unknown id; the normal week can change and the usual time follows it', async () => {
    const w = await world();
    expect((await add(w, { name: 'Winter hours', oneDay: false, from: '2026-11-23', to: '2027-01-31', week: FLYER_HOURS[0].week })).status).toBe(200);
    const clash = await add(w, { name: 'Holiday', oneDay: false, from: '2026-12-20', to: '2027-01-05', week: FLYER_HOURS[0].week });
    expect(clash.status).toBe(400);
    expect(clash.data.error?.message ?? clash.text).toContain('overlaps Winter hours');
    expect((await add(w, { id: 'nope', name: 'X', oneDay: true, from: '2026-12-10', day: null })).status).toBe(409);
    const week = [0, 1, 2, 3, 4, 5, 6].map((d) => ({ open: H(9), close: d === 0 ? H(18) : H(21) }));
    expect((await w.organizer.call('PUT', '/api/admin/venue-hours/normal', { week })).status).toBe(200);
    const usual = await w.organizer.call('PUT', '/api/admin/group', { settings: { defaultStartMinutes: H(19, 30), defaultEndMinutes: H(21, 30) } }, HOURS_ON);
    expect(usual.status).toBe(400);
    expect(usual.text).toContain('The venue is open 9:00 AM to 9:00 PM on Tuesdays and Thursdays.');
  });

  it('Add game and Edit game: Thanksgiving 8 PM is refused with the date’s message; with Booking hours off nothing is checked', async () => {
    const w = await world();
    expect((await add(w, { name: 'Thanksgiving', oneDay: true, from: '2026-11-26', day: { open: H(8), close: H(12) } })).status).toBe(200);
    const refused = await w.organizer.call('POST', '/api/admin/sessions', { startsAt: at(2026, 11, 26, 20), endsAt: at(2026, 11, 26, 22) });
    expect(refused.status).toBe(400);
    expect(refused.text).toContain('The venue is open 8:00 AM to 12:00 PM on this day (Thanksgiving). Pick times inside those hours.');
    const morning = await w.organizer.call('POST', '/api/admin/sessions', { startsAt: at(2026, 11, 26, 9), endsAt: at(2026, 11, 26, 11) });
    expect(morning.status, morning.text).toBe(200);
    const moved = await w.organizer.call('PUT', `/api/admin/sessions/${morning.data.id}/time`, { startsAt: at(2026, 11, 26, 11), endsAt: at(2026, 11, 26, 13) });
    expect(moved.status).toBe(400);
    expect((await w.organizer.call('PUT', '/api/admin/booking-hours-switch', { on: false })).status).toBe(200);
    // (8 PM is the usual game already on the schedule: 5 PM, outside the noon close.)
    expect((await w.organizer.call('POST', '/api/admin/sessions', { startsAt: at(2026, 11, 26, 17), endsAt: at(2026, 11, 26, 19) })).status).toBe(200);
    // Booking hours off: the dashboard has no hours (the answer is main's).
    expect((await w.organizer.call('GET', '/api/admin/dashboard')).data.group.venueHours).toBeUndefined();
  });

  it('tournaments: Finalize and a time move outside that date’s hours are refused the same way', async () => {
    const w = await world();
    expect((await w.organizer.call('PUT', '/api/admin/tournaments-switch', { on: true })).status).toBe(200);
    const created = await w.organizer.call('POST', '/api/admin/tournament', { name: 'The Cold Open', dates: ['2026-11-12', '2026-11-19'], ticketCents: 1600, creditCents: 1400, visibility: 'all', format: 'doubles' });
    expect(created.status, created.text).toBe(200);
    expect((await add(w, { name: 'Early close', oneDay: true, from: '2026-11-12', day: { open: H(8), close: H(21) } })).status).toBe(200);
    const fin = await w.organizer.call('PUT', `/api/admin/tournament/${created.data.id}/date`, { date: '2026-11-12', start: H(19, 30), minutes: 150 });
    expect(fin.status).toBe(400);
    expect(fin.text).toContain('The venue is open 8:00 AM to 9:00 PM on this day (Early close).');
    const ok = await w.organizer.call('PUT', `/api/admin/tournament/${created.data.id}/date`, { date: '2026-11-12', start: H(18, 30), minutes: 150 });
    expect(ok.status, ok.text).toBe(200);
    const later = await w.organizer.call('PUT', `/api/admin/tournament/${created.data.id}/time`, { start: H(19), minutes: 150 });
    expect(later.status).toBe(400);
    expect((await w.organizer.call('PUT', `/api/admin/tournament/${created.data.id}/time`, { start: H(18), minutes: 180 })).status).toBe(200);
  });
});
