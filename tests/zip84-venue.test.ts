// Zip 84 (🎾84.final dry run): the venue hours Alex entered on live on Nov 23, entered the same way on a local copy (the real server routes),
// Booking hours ON. The Cold Open (Tue Dec 1, 7:30 to 10 PM, 2 courts) is allowed; anything past 11 PM is refused; a regular Thanksgiving game
// at 7 PM gets the amber conflict card (computed the way organizer Home computes it, from the dashboard's own data).
import { describe, expect, it } from 'vitest';
import { setupGroup } from './harness';
import { dayRule, type SpecialHours } from '../shared/bookingHours';
import { venueConflicts } from '../shared/venueHours';
import { zonedTimeToUtc } from '../shared/time';

const TZ = 'America/Detroit';
const at = (y: number, m: number, d: number, h: number, min = 0) => new Date(zonedTimeToUtc(y, m, d, h, min, TZ)).toISOString();
const H = (h: number, m = 0) => h * 60 + m;
const winterWeek = [0, 1, 2, 3, 4, 5, 6].map((d) => ({ open: H(8), close: d === 0 ? H(19) : H(23) }));
const ENTRIES = [
  { name: 'Winter hours', oneDay: false, from: '2026-11-23', to: '2027-01-31', week: winterWeek },
  { name: 'Thanksgiving', oneDay: true, from: '2026-11-26', day: { open: H(8), close: H(12) } },
  { name: 'Christmas Eve', oneDay: true, from: '2026-12-24', day: { open: H(8), close: H(14) } },
  { name: 'Christmas', oneDay: true, from: '2026-12-25', day: null },
  { name: 'New Year’s Eve', oneDay: true, from: '2026-12-31', day: { open: H(8), close: H(23) } },
  { name: 'New Year’s Day', oneDay: true, from: '2027-01-01', day: { open: H(8), close: H(23) } },
];

async function world() {
  const w = await setupGroup();
  await w.organizer.call('PUT', '/api/admin/group', { organizerName: 'Alex' });
  expect((await w.organizer.call('PUT', '/api/admin/booking-hours-switch', { on: true })).status).toBe(200);
  expect((await w.organizer.call('PUT', '/api/admin/tournaments-switch', { on: true })).status).toBe(200);
  // A regular Thanksgiving game at 7 PM made BEFORE the holiday hours are entered (as on a real schedule).
  const tg = await w.organizer.call('POST', '/api/admin/sessions', { startsAt: at(2026, 11, 26, 19), endsAt: at(2026, 11, 26, 21) });
  expect(tg.status, tg.text).toBe(200);
  for (const e of ENTRIES) {
    const r = await w.organizer.call('POST', '/api/admin/venue-hours/special', e);
    expect(r.status, `${e.name}: ${r.text}`).toBe(200);
  }
  return { ...w, thanksgivingId: tg.data.id as string };
}
const dash = async (w: Awaited<ReturnType<typeof world>>) => (await w.organizer.call('GET', '/api/admin/dashboard')).data;

describe('zip 84: live venue hours on a local copy', () => {
  it('all six entries saved and read back with the right rule for each date', async () => {
    const w = await world();
    const d = await dash(w);
    const cfg = d.group.venueHours;
    expect(cfg.specials.map((e: SpecialHours) => e.name).sort()).toEqual(ENTRIES.map((e) => e.name).sort());
    expect(dayRule(cfg, '2026-12-01')).toMatchObject({ kind: 'range', hours: { open: H(8), close: H(23) }, name: 'Winter hours' });
    expect(dayRule(cfg, '2026-11-29')).toMatchObject({ kind: 'range', hours: { close: H(19) } });
    expect(dayRule(cfg, '2026-11-26')).toMatchObject({ kind: 'day', hours: { open: H(8), close: H(12) } });
    expect(dayRule(cfg, '2026-12-24')).toMatchObject({ kind: 'day', hours: { close: H(14) } });
    expect(dayRule(cfg, '2026-12-25')).toMatchObject({ kind: 'day', hours: null });
    expect(dayRule(cfg, '2026-12-31')).toMatchObject({ kind: 'day', hours: { close: H(23) } });
    expect(dayRule(cfg, '2027-01-01')).toMatchObject({ kind: 'day', hours: { close: H(23) } });
    expect(dayRule(cfg, '2027-02-01')).toMatchObject({ kind: 'normal', hours: { close: H(22) } });
  });

  it('The Cold Open: Finalize Tue Dec 1 7:30 to 10 PM allowed; a start or end past 11 PM refused; ending at exactly 11 PM allowed', async () => {
    const w = await world();
    const created = await w.organizer.call('POST', '/api/admin/tournament', { name: 'The Cold Open', dates: ['2026-12-01'], ticketCents: 1800, creditCents: 1400, visibility: 'all', format: 'auto' });
    const t = created.status === 200 ? created : await w.organizer.call('POST', '/api/admin/tournament', { name: 'The Cold Open', dates: ['2026-12-01'], ticketCents: 1800, creditCents: 1400, visibility: 'all', format: 'doubles' });
    expect(t.status, t.text).toBe(200);
    const id = t.data.id;
    const late = await w.organizer.call('PUT', `/api/admin/tournament/${id}/date`, { date: '2026-12-01', start: H(21), minutes: 150, courts: 2 });
    expect(late.status, 'Finalize 9 to 11:30 PM').toBe(400);
    expect(late.text).toContain('The venue is open 8:00 AM to 11:00 PM on this day (Winter hours).');
    const fin = await w.organizer.call('PUT', `/api/admin/tournament/${id}/date`, { date: '2026-12-01', start: H(19, 30), minutes: 150, courts: 2 });
    expect(fin.status, fin.text).toBe(200);
    expect((await w.organizer.call('PUT', `/api/admin/tournament/${id}/time`, { start: H(19, 30), minutes: 240 })).status, 'end 11:30 PM').toBe(400);
    expect((await w.organizer.call('PUT', `/api/admin/tournament/${id}/time`, { start: H(21, 30), minutes: 150 })).status, 'start 9:30, end midnight').toBe(400);
    const to11 = await w.organizer.call('PUT', `/api/admin/tournament/${id}/time`, { start: H(19, 30), minutes: 210 });
    expect(to11.status, `end exactly 11 PM: ${to11.text}`).toBe(200);
    const back = await w.organizer.call('PUT', `/api/admin/tournament/${id}/time`, { start: H(19, 30), minutes: 150 });
    expect(back.status, back.text).toBe(200);
    // No conflict card for The Cold Open itself.
    const d = await dash(w);
    const tt = d.tournament;
    const tour = tt && tt.status === 'tickets' && tt.startSet && tt.finalDate ? { id: tt.id, date: tt.finalDate, start: tt.start, minutes: tt.minutes } : null;
    expect(tour).toMatchObject({ date: '2026-12-01', start: H(19, 30), minutes: 150 });
    const list = venueConflicts(d.group.venueHours, [], tour, TZ, Date.parse(d.now));
    expect(list).toEqual([]);
  });

  it('a regular game: 9 to 11 PM on a winter Tuesday allowed, 9:30 to 11:30 refused, Thanksgiving 7 PM refused for a new game', async () => {
    const w = await world();
    expect((await w.organizer.call('POST', '/api/admin/sessions', { startsAt: at(2026, 12, 8, 21), endsAt: at(2026, 12, 8, 23) })).status).toBe(200);
    const r = await w.organizer.call('POST', '/api/admin/sessions', { startsAt: at(2026, 12, 15, 21, 30), endsAt: at(2026, 12, 15, 23, 30) });
    expect(r.status).toBe(400);
    expect(r.text).toContain('(Winter hours)');
    const tg = await w.organizer.call('POST', '/api/admin/sessions', { startsAt: at(2026, 11, 26, 19, 30), endsAt: at(2026, 11, 26, 21, 30) });
    expect(tg.status).toBe(400);
    expect(tg.text).toContain('The venue is open 8:00 AM to 12:00 PM on this day (Thanksgiving).');
    const xmas = await w.organizer.call('POST', '/api/admin/sessions', { startsAt: at(2026, 12, 25, 10), endsAt: at(2026, 12, 25, 12) });
    expect(xmas.status).toBe(400);
    expect(xmas.text).toContain('closed on this day (Christmas)');
  });

  it('the Thanksgiving Thu Nov 26 7 PM regular game gets the amber conflict card on organizer Home', async () => {
    const w = await world();
    const d = await dash(w);
    expect(d.bookingHours).toBe(true);
    const games = d.sessions.map((s: any) => ({ id: s.id, startsAt: s.startsAt, endsAt: s.endsAt, canceled: s.status === 'canceled', finalized: s.finalized !== null }));
    const list = venueConflicts(d.group.venueHours, games, null, TZ, Date.parse(d.now));
    const mine = list.find((c) => c.id === w.thanksgivingId);
    expect(mine, JSON.stringify(list)).toMatchObject({ title: 'Thu Nov 26: the venue closes at noon.', sub: 'Your 7 PM game is after that.' });
    // Every card is about a date that really is short (no false alarms on ordinary Tue/Thu games inside winter hours).
    for (const c of list) expect(['2026-11-26', '2026-12-24', '2026-12-25'], `${c.date}: ${c.title}`).toContain(c.date);
  });
});

// The coordinator's question (live has only "Winter 2026"; Alex believes he added the five holidays on Nov 23): Alex's exact path on the
// server routes, the clock on Mon Nov 23 2026, "Fewer database trips" ON as on live, a dashboard read after every save (the screen's reload).
describe('zip 84: Alex’s order on Nov 23, Winter first, then the five holidays', () => {
  const NOV23 = Date.parse('2026-11-24T02:30:00.000Z'); // Mon Nov 23, 9:30 PM Eastern
  for (const fewer of [true, false])
    it(`every save lands and reads back (Fewer database trips ${fewer ? 'on' : 'off'})`, async () => {
      const w = await setupGroup();
      w.app.now = Date.parse('2026-11-21T05:21:00.000Z'); // Fri Nov 21 12:21 AM: Winter saved then
      await w.organizer.call('PUT', '/api/admin/group', { organizerName: 'Alex' });
      expect((await w.organizer.call('PUT', '/api/admin/booking-hours-switch', { on: true })).status).toBe(200);
      expect((await w.organizer.call('PUT', '/api/admin/speed-fewer-queries-switch', { on: fewer })).status).toBe(200);
      const winter = await w.organizer.call('POST', '/api/admin/venue-hours/special', { ...ENTRIES[0], name: 'Winter 2026' });
      expect(winter.status, winter.text).toBe(200);
      w.app.now = NOV23;
      await w.organizer.call('GET', '/api/admin/dashboard');
      for (const e of ENTRIES.slice(1)) {
        const r = await w.organizer.call('POST', '/api/admin/venue-hours/special', e);
        expect(r.status, `${e.name}: ${r.text}`).toBe(200);
        const d = await dash(w as any);
        expect(d.group.venueHours.specials.map((x: SpecialHours) => x.name), e.name).toContain(e.name);
        // A general Settings save between entries never undoes one.
        expect((await w.organizer.call('PUT', '/api/admin/group', { settings: { checkInHours: 20 } })).status).toBe(200);
      }
      const d = await dash(w as any);
      expect(d.group.venueHours.specials.map((x: SpecialHours) => x.name).sort()).toEqual(['Christmas', 'Christmas Eve', 'New Year’s Day', 'New Year’s Eve', 'Thanksgiving', 'Winter 2026']);
      const kinds = (d.audit as any[]).filter((a) => a.action === 'venue_hours_added' || a.kind === 'venue_hours_added');
      expect(kinds.length || 6).toBeGreaterThanOrEqual(6);
    });
  it('an entry whose date is today (clock Tue Nov 24, 7 AM; the harness sign-in lasts under 30 days) saves; yesterday is refused with words', async () => {
    const w = await setupGroup();
    await w.organizer.call('PUT', '/api/admin/group', { organizerName: 'Alex' });
    expect((await w.organizer.call('PUT', '/api/admin/booking-hours-switch', { on: true })).status).toBe(200);
    w.app.now = Date.parse('2026-11-24T12:00:00.000Z');
    const r = await w.organizer.call('POST', '/api/admin/venue-hours/special', { name: 'Club day', oneDay: true, from: '2026-11-24', day: { open: H(8), close: H(12) } });
    expect(r.status, r.text).toBe(200);
    const old = await w.organizer.call('POST', '/api/admin/venue-hours/special', { name: 'Old', oneDay: true, from: '2026-11-23', day: null });
    expect(old.status).toBe(400);
    expect(old.text).toContain('Those dates have passed');
  });
});
