// Zip 51: the last three money edge cases from Audit C (docs/audits/AUDIT_C_2026-11.md), with exact numbers and a fake clock. Eastern time.
//  F-9  the Venue charge alert never skips or hides a charge day (month ends, February, a moved day, a switch-on day, two unpaid months,
//       Mark paid on an older month); each month's card stays until its own Mark paid; every booked game is on exactly one card.
//  F-15 a late dropper Alex puts back In keeps no late-drop mark (same as their own I'm in), and the money matches the player's own path.
//  F-16 the Drop out dialog's money is checked again on the server when the player taps it: a changed amount drops nothing and says "look
//       again"; a matching one drops at exactly what was shown, also when another drop lands in the same instant.
import { readFileSync } from 'node:fs';
import { join as pjoin } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { GroupView } from '../shared/api';
import { DROP_CHANGED, dropQuote } from '../shared/dropQuote';
import { addDays, dueAlerts, localYmd, startOfDayMs, venueDaysHistoryOf, type VenueGame, type VenueDaysSpan } from '../shared/venueAlert';
import { zonedTimeToUtc } from '../shared/time';
import { withdraw } from '../server/roster';
import { getSession, type GroupRow } from '../server/repo';
import { type Client, HOUR, PIN, setupGroup, TestApp } from './harness';

const TZ = 'America/Detroit';
const et = (y: number, m: number, d: number, h = 12, min = 0) => zonedTimeToUtc(y, m, d, h, min, TZ);
const edt = (m: number, d: number, h = 12, min = 0) => Date.UTC(2026, m - 1, d, h + 4, min);
const est = (m: number, d: number, h = 12, min = 0, y = 2026) => Date.UTC(y, m - 1, d, h + 5, min);
const keysOf = (a: { keys: string[] }[]) => a.map((x) => x.keys.join('+'));

// ---------------------------------------------------------------- F-9: the Venue charge alert ----------------------------------------------------------------

async function venueWorld() {
  const app = new TestApp();
  const w = await setupGroup(app);
  await w.organizer.call('PUT', '/api/admin/group', { organizerName: 'Alex' });
  return w;
}
type VW = Awaited<ReturnType<typeof venueWorld>>;
const raw = (w: { app: TestApp }) => (w.app.db as unknown as { raw: { prepare: (s: string) => { run: (...a: unknown[]) => unknown; get: (...a: unknown[]) => any; all: (...a: unknown[]) => any[] } } }).raw;
const dash = async (w: VW) => (await w.organizer.call('GET', '/api/admin/dashboard')).data;
const venueOn = (w: VW) => w.organizer.call('PUT', '/api/admin/venue-alert-switch', { on: true });
const mark = (w: VW, keys: string[], cents: number) => w.organizer.call('POST', '/api/admin/venue-alert/paid', { keys, cents });
const setDays = (w: VW, venueDays: Record<string, number>) => w.organizer.call('PUT', '/api/admin/group', { venueDays });
const day = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(iso));
const jump = async (w: VW, ms: number) => {
  w.app.now = ms;
  expect((await w.organizer.call('POST', '/api/admin/login', { pin: PIN })).status).toBe(200);
  await dash(w); // the site adds the next weeks' games
};
const gameDates = (w: VW) => (raw(w).prepare('SELECT starts_at FROM sessions ORDER BY starts_at').all() as { starts_at: string }[]).map((r) => day(r.starts_at));
/** Book every game on these Eastern dates straight in the database (the court switch refuses a game that is over). */
function bookRaw(w: VW, dates: string[]) {
  const rows = raw(w).prepare('SELECT id, starts_at FROM sessions').all() as { id: string; starts_at: string }[];
  let n = 0;
  for (const r of rows) {
    if (dates.includes(day(r.starts_at))) {
      raw(w).prepare("UPDATE sessions SET booking_status = 'booked' WHERE id = ?").run(r.id);
      n++;
    }
  }
  expect(n, `games on ${dates.join(', ')}`).toBe(dates.length);
}
const between = (w: VW, from: string, to: string) => gameDates(w).filter((d) => d >= from && d <= to);
const paidLines = async (w: VW) => ((await w.organizer.call('GET', '/api/admin/activity')).data.entries as any[]).filter((e) => e.action === 'venue_charge_paid');
const noMembership = (w: VW) => w.organizer.call('PUT', '/api/admin/group', { settings: { monthlyMembershipCents: 0 } });

describe('F-9 a moved court day: nothing skipped, nothing billed twice (through the real server)', () => {
  it('court 15th, Nov 15 marked paid, moved to Last day on Nov 16: a Nov 30 card for Nov 16 to 30 (keyed by its date), then Dec 31 for December', async () => {
    const w = await venueWorld();
    await setDays(w, { courtDay: 15 });
    await noMembership(w);
    await venueOn(w);
    await jump(w, est(11, 10, 9));
    const first = between(w, '2026-10-27', '2026-11-15');
    bookRaw(w, first); // Oct 27, Oct 29, Nov 3, Nov 5, Nov 10, Nov 12: 6 games
    expect(first).toHaveLength(6);
    await jump(w, est(11, 15, 9));
    const c = (await dash(w)).venueAlerts;
    expect(c).toMatchObject([{ keys: ['court:2026-11'], date: '2026-11-15', cents: 6 * 4800, line: '6 games x $48 = $288' }]);
    expect((await mark(w, c[0].keys, c[0].cents)).status).toBe(200);
    await jump(w, est(11, 16, 9));
    expect((await setDays(w, { courtDay: 0 })).status).toBe(200);
    await jump(w, est(11, 20, 9));
    const late = between(w, '2026-11-16', '2026-11-30');
    bookRaw(w, late); // Nov 17, 19, 24, 26: 4 games
    expect(late).toHaveLength(4);
    await jump(w, est(11, 29, 23, 59));
    expect((await dash(w)).venueAlerts).toEqual([]);
    await jump(w, est(11, 30, 0, 0));
    const nov30 = (await dash(w)).venueAlerts;
    expect(nov30).toMatchObject([{ keys: ['court:2026-11-30'], date: '2026-11-30', cents: 4 * 4800, line: '4 games x $48 = $192' }]);
    expect((await mark(w, nov30[0].keys, nov30[0].cents)).status).toBe(200);
    // A second tap on it writes nothing more.
    expect((await mark(w, nov30[0].keys, nov30[0].cents)).data).toMatchObject({ ok: true, already: true });
    await jump(w, est(12, 10, 9));
    const dec = between(w, '2026-12-01', '2026-12-10');
    bookRaw(w, dec); // Dec 1, 3, 8, 10
    await jump(w, est(12, 31, 9));
    const d = (await dash(w)).venueAlerts;
    expect(d).toMatchObject([{ keys: ['court:2026-12'], date: '2026-12-31', cents: 4 * 4800, line: '4 games x $48 = $192' }]);
    expect((await paidLines(w)).map((l) => l.details?.cents ?? JSON.parse(l.details_json ?? '{}').cents)).toEqual(expect.arrayContaining([28800, 19200]));
    expect(raw(w).prepare("SELECT COUNT(*) AS n FROM task_log WHERE task LIKE 'venue_paid:%'").get().n).toBe(2);
  });

  it('court 15th, Oct 15 marked paid, moved to the 20th on Nov 10: the Nov 20 card starts Oct 16 (the games of Oct 16 to 20 are on it)', async () => {
    const w = await venueWorld();
    await setDays(w, { courtDay: 15 });
    await noMembership(w);
    // The switch went on before Oct 15 here: start the clock earlier.
    w.app.now = edt(10, 1, 9);
    await venueOn(w);
    await jump(w, edt(10, 15, 9));
    // A card for Oct 15 with no games makes no card; mark the charge paid the way a card would (one row with its date).
    raw(w)
      .prepare("INSERT INTO task_log (id, group_id, session_id, task, kind, detail, at) SELECT 'v1', id, NULL, 'venue_paid:court:2026-10', 'mark', ?, ? FROM groups")
      .run(JSON.stringify({ cents: 0, date: '2026-10-15' }), new Date(edt(10, 15, 9)).toISOString());
    await jump(w, est(11, 10, 9));
    expect((await setDays(w, { courtDay: 20 })).status).toBe(200);
    const games = between(w, '2026-10-16', '2026-11-20');
    // Oct 20, 22, 27, 29, Nov 3, 5, 10, 12, 17, 19: 10 games, all on the one card (before the fix it started Oct 21: Oct 20 was on no card).
    expect(games).toEqual(['2026-10-20', '2026-10-22', '2026-10-27', '2026-10-29', '2026-11-03', '2026-11-05', '2026-11-10', '2026-11-12', '2026-11-17', '2026-11-19']);
    bookRaw(w, games);
    await jump(w, est(11, 20, 9));
    const a = (await dash(w)).venueAlerts;
    expect(a).toMatchObject([{ keys: ['court:2026-11'], date: '2026-11-20', cents: 48000, line: '10 games x $48 = $480' }]);
  });

  it('court Last day, Oct 31 paid, moved to the 15th on Nov 16 (the new day already passed): a Nov 15 card for Nov 1 to 15, then Dec 15 for Nov 16 to Dec 15', async () => {
    const w = await venueWorld();
    await noMembership(w);
    await venueOn(w); // Mon Oct 26, noon
    bookRaw(w, ['2026-10-27', '2026-10-29']);
    await jump(w, edt(10, 31, 9));
    const oct = (await dash(w)).venueAlerts;
    expect(oct).toMatchObject([{ keys: ['court:2026-10'], cents: 9600 }]);
    expect((await mark(w, oct[0].keys, oct[0].cents)).status).toBe(200);
    await jump(w, est(11, 14, 9));
    bookRaw(w, between(w, '2026-11-01', '2026-11-30')); // Nov 3, 5, 10, 12 | 17, 19, 24, 26
    await jump(w, est(11, 16, 9));
    expect((await setDays(w, { courtDay: 15 })).status).toBe(200);
    const nov = (await dash(w)).venueAlerts;
    expect(nov).toMatchObject([{ keys: ['court:2026-11'], date: '2026-11-15', cents: 4 * 4800, line: '4 games x $48 = $192' }]);
    // Nov 30 (the old day) is not a charge day any more: still the one November card on Nov 30.
    await jump(w, est(11, 30, 9));
    expect(keysOf((await dash(w)).venueAlerts)).toEqual(['court:2026-11']);
    expect((await mark(w, ['court:2026-11'], 4 * 4800)).status).toBe(200);
    await jump(w, est(12, 10, 9));
    bookRaw(w, between(w, '2026-12-01', '2026-12-15'));
    await jump(w, est(12, 15, 9));
    expect(between(w, '2026-11-16', '2026-12-15')).toEqual(['2026-11-17', '2026-11-19', '2026-11-24', '2026-11-26', '2026-12-01', '2026-12-03', '2026-12-08', '2026-12-10', '2026-12-15']);
    expect((await dash(w)).venueAlerts).toMatchObject([{ keys: ['court:2026-12'], date: '2026-12-15', cents: 43200, line: '9 games x $48 = $432' }]);
  });

  it('an unpaid card stays exactly as it was through a move: Nov 30 card ($192) unpaid, moved to the 15th on Dec 2: still Nov 30, $192; Dec 15 bills Dec 1 to 15', async () => {
    const w = await venueWorld();
    await noMembership(w);
    await venueOn(w);
    await jump(w, est(11, 14, 9));
    bookRaw(w, between(w, '2026-11-01', '2026-11-30').slice(0, 4)); // Nov 3, 5, 10, 12
    await jump(w, est(12, 2, 9));
    const before = (await dash(w)).venueAlerts;
    expect(before).toMatchObject([{ keys: ['court:2026-11'], date: '2026-11-30', cents: 19200 }]);
    expect((await setDays(w, { courtDay: 15 })).status).toBe(200);
    expect((await dash(w)).venueAlerts).toEqual(before);
    await jump(w, est(12, 10, 9));
    bookRaw(w, between(w, '2026-12-01', '2026-12-15')); // Dec 1, 3, 8, 10, 15
    await jump(w, est(12, 15, 9));
    expect((await dash(w)).venueAlerts).toMatchObject([
      { keys: ['court:2026-11'], date: '2026-11-30', cents: 19200, line: '4 games x $48 = $192' },
      { keys: ['court:2026-12'], date: '2026-12-15', cents: 24000, line: '5 games x $48 = $240' },
    ]);
    // The old days are kept in the group's settings with when they were in force (no schema change).
    const hist = venueDaysHistoryOf(raw(w).prepare('SELECT settings_json AS j FROM groups').get().j);
    expect(hist).toEqual([{ membershipDay: 26, courtDay: 0, from: 0, until: est(12, 2, 9) }]);
  });

  it('two unpaid months and Mark paid on the newer one first: the older card stays with its own amount and can still be marked', async () => {
    const w = await venueWorld();
    await noMembership(w);
    await venueOn(w);
    bookRaw(w, ['2026-10-27', '2026-10-29', '2026-11-03']);
    await jump(w, est(12, 1, 8));
    const a = (await dash(w)).venueAlerts;
    expect(a).toMatchObject([
      { keys: ['court:2026-10'], cents: 9600 },
      { keys: ['court:2026-11'], cents: 4800 },
    ]);
    expect((await mark(w, ['court:2026-11'], 4800)).status).toBe(200);
    expect((await dash(w)).venueAlerts).toMatchObject([{ keys: ['court:2026-10'], cents: 9600, line: '2 games x $48 = $96' }]);
    expect((await mark(w, ['court:2026-10'], 9600)).status).toBe(200);
    expect((await dash(w)).venueAlerts).toEqual([]);
    expect(await paidLines(w)).toHaveLength(2);
  });
});

describe('F-9 a move saved before Zip 51 (only changedAt, no old days kept): no card for games a paid charge covered (reviewer)', () => {
  it('court 15th, Nov 15 paid ($288), moved to Last day on Nov 16 the old way: Dec 1 shows only Nov 30 ($192), never an Oct 31 card', async () => {
    const w = await venueWorld();
    await setDays(w, { courtDay: 15 });
    await noMembership(w);
    await venueOn(w);
    await jump(w, est(11, 10, 9));
    bookRaw(w, between(w, '2026-10-27', '2026-11-15'));
    await jump(w, est(11, 15, 9));
    expect((await mark(w, ['court:2026-11'], 28800)).status).toBe(200);
    await jump(w, est(11, 16, 9));
    expect((await setDays(w, { courtDay: 0 })).status).toBe(200);
    // As a pre-Zip-51 save would have left it: the new days and changedAt, no history.
    const j = JSON.parse(raw(w).prepare('SELECT settings_json AS j FROM groups').get().j);
    delete j.venueDays.history;
    raw(w).prepare('UPDATE groups SET settings_json = ?').run(JSON.stringify(j));
    await jump(w, est(11, 20, 9));
    bookRaw(w, between(w, '2026-11-16', '2026-11-30'));
    await jump(w, est(12, 1, 9));
    expect((await dash(w)).venueAlerts).toMatchObject([{ keys: ['court:2026-11-30'], date: '2026-11-30', cents: 19200 }]);
    expect((await dash(w)).venueAlerts).toHaveLength(1);
  });
});

describe('F-9 the membership: one card a month, never skipped, never hidden', () => {
  it('a Nov 26 card still unpaid when the day moves to the 10th on Nov 27: it stays (Nov 26, $30) until Mark paid; no second card', async () => {
    const w = await venueWorld();
    await venueOn(w);
    await jump(w, est(11, 26, 9));
    // (October's 26th began before the switch went on at noon that day: no backfill.)
    expect((await dash(w)).venueAlerts).toMatchObject([{ keys: ['membership:2026-11'], date: '2026-11-26', cents: 3000 }]);
    await jump(w, est(11, 27, 9));
    expect((await setDays(w, { membershipDay: 10 })).status).toBe(200);
    expect((await dash(w)).venueAlerts).toMatchObject([{ keys: ['membership:2026-11'], date: '2026-11-26', cents: 3000 }]);
    expect((await mark(w, ['membership:2026-11'], 3000)).status).toBe(200);
    await jump(w, est(11, 30, 9));
    expect((await dash(w)).venueAlerts).toEqual([]);
    await jump(w, est(12, 10, 0, 0));
    expect((await dash(w)).venueAlerts).toMatchObject([{ keys: ['membership:2026-12'], date: '2026-12-10', cents: 3000 }]);
  });
  it('moved from the 26th to the 5th on Nov 10 (October paid): November still has its card, on Nov 5; December on Dec 5', async () => {
    const w = await venueWorld();
    w.app.now = edt(10, 1, 9);
    await venueOn(w);
    await jump(w, edt(10, 26, 9));
    expect((await mark(w, ['membership:2026-10'], 3000)).status).toBe(200);
    await jump(w, est(11, 10, 9));
    expect((await setDays(w, { membershipDay: 5 })).status).toBe(200);
    expect((await dash(w)).venueAlerts).toMatchObject([{ keys: ['membership:2026-11'], date: '2026-11-05', cents: 3000 }]);
    expect((await mark(w, ['membership:2026-11'], 3000)).status).toBe(200);
    await jump(w, est(11, 26, 9));
    expect((await dash(w)).venueAlerts).toEqual([]);
    await jump(w, est(12, 5, 9));
    expect(keysOf((await dash(w)).venueAlerts)).toEqual(['membership:2026-12']);
  });
  it('Nov 26 paid, moved to the 28th on Nov 27: no second November card; moved 28th to 26th after the 28th passed: November still has its one card', async () => {
    const w = await venueWorld();
    await venueOn(w);
    await jump(w, est(11, 26, 9));
    expect((await mark(w, ['membership:2026-11'], 3000)).status).toBe(200);
    await jump(w, est(11, 27, 9));
    await setDays(w, { membershipDay: 28 });
    await jump(w, est(11, 28, 9));
    expect((await dash(w)).venueAlerts).toEqual([]);
    const w2 = await venueWorld();
    await venueOn(w2);
    await jump(w2, est(11, 20, 9));
    await setDays(w2, { membershipDay: 28 });
    await jump(w2, est(11, 27, 9));
    await setDays(w2, { membershipDay: 26 });
    await jump(w2, est(11, 30, 9));
    expect((await dash(w2)).venueAlerts).toMatchObject([{ keys: ['membership:2026-11'], date: '2026-11-26', cents: 3000 }]);
  });
  it('days picked while turning the switch on are a correction, not a move: on Nov 13, membership set to the 5th on Nov 14: no November card; Dec 5 does', async () => {
    const w = await venueWorld();
    await jump(w, est(11, 13, 9));
    await venueOn(w);
    await jump(w, est(11, 14, 9));
    await setDays(w, { membershipDay: 5, courtDay: 10 });
    // Courts now on the 10th: Nov 10 was before the switch went on, so the first card is Dec 10, for Nov 11 to Dec 10.
    bookRaw(w, between(w, '2026-11-11', '2026-12-10'));
    await jump(w, est(11, 30, 9));
    expect((await dash(w)).venueAlerts).toEqual([]);
    await jump(w, est(12, 5, 9));
    expect(keysOf((await dash(w)).venueAlerts)).toEqual(['membership:2026-12']);
    await jump(w, est(12, 10, 9));
    const games = between(w, '2026-11-11', '2026-12-10');
    expect((await dash(w)).venueAlerts[1]).toMatchObject({ keys: ['court:2026-12'], cents: games.length * 4800 });
  });
});

describe('F-9 the dates: month ends, February, a switch-on day (shared/venueAlert.ts)', () => {
  const g = (y: number, m: number, d: number, cents = 4800): VenueGame => ({ startsAt: new Date(et(y, m, d, 20)).toISOString(), booked: true, canceled: false, costCents: cents });
  const base = { membershipCents: 3000, tz: TZ, paid: new Set<string>() };
  it('Last day across Nov, Dec, Feb 2027 and Feb 2028 (leap): each period starts the day after the one before; a Feb 29 game counted once', () => {
    const games = [g(2026, 11, 30), g(2026, 12, 1), g(2026, 12, 31), g(2027, 1, 1), g(2027, 2, 28), g(2027, 3, 1), g(2028, 2, 28), g(2028, 2, 29), g(2028, 3, 1)];
    const a = dueAlerts({ ...base, membershipCents: 0, days: { membershipDay: 26, courtDay: 0 }, games, onAtMs: et(2026, 11, 1), nowMs: et(2028, 3, 31, 9) });
    const by = Object.fromEntries(a.map((c) => [c.date, c.cents]));
    expect(by['2026-11-30']).toBe(4800);
    expect(by['2026-12-31']).toBe(9600); // Dec 1 and Dec 31
    expect(by['2027-01-31']).toBe(4800);
    expect(by['2027-02-28']).toBe(4800);
    expect(by['2027-03-31']).toBe(4800);
    expect(by['2028-02-29']).toBe(9600); // Feb 28 and Feb 29 2028
    expect(by['2028-03-31']).toBe(4800);
    expect(a.reduce((s, c) => s + c.cents, 0)).toBe(games.length * 4800);
  });
  it('membership on the 31st: Nov 30, Dec 31, Feb 28 2027, Feb 29 2028', () => {
    const a = dueAlerts({ ...base, days: { membershipDay: 31, courtDay: 0 }, games: [], onAtMs: et(2026, 11, 1), nowMs: et(2028, 3, 1, 9) });
    const dates = a.map((c) => c.date);
    expect(dates).toEqual(expect.arrayContaining(['2026-11-30', '2026-12-31', '2027-02-28', '2028-02-29']));
    expect(new Set(a.map((c) => c.keys[0])).size).toBe(a.length); // one a month
    expect(a).toHaveLength(16); // Nov 2026 to Feb 2028
  });
  it('a charge day that is the switch-on day: on at 12:00 AM counts; one second later does not, also with moved days on record', () => {
    const history: VenueDaysSpan[] = [{ membershipDay: 26, courtDay: 15, from: 0, until: et(2026, 11, 2, 9) }];
    const args = { ...base, membershipCents: 0, days: { membershipDay: 26, courtDay: 0 }, history, daysFrom: et(2026, 11, 2, 9), games: [g(2026, 11, 3), g(2026, 11, 24)], nowMs: et(2026, 11, 30, 9) };
    expect(dueAlerts({ ...args, onAtMs: startOfDayMs('2026-11-30', TZ) })).toMatchObject([{ date: '2026-11-30', cents: 9600 }]);
    expect(dueAlerts({ ...args, onAtMs: startOfDayMs('2026-11-30', TZ) + 1000 })).toEqual([]);
  });
  it('every booked game is on exactly one card through many moves (each card marked paid the day it shows)', () => {
    // A game every Tuesday and Thursday from Oct 1 2026 to Apr 30 2027, each with its own cost, so a game counted twice or missed shows.
    const games: VenueGame[] = [];
    let n = 0;
    for (let d = '2026-10-01'; d <= '2027-04-30'; d = addDays(d, 1)) {
      const wd = new Date(`${d}T12:00:00Z`).getUTCDay();
      if (wd === 2 || wd === 4) {
        const [y, m, dd] = d.split('-').map(Number);
        games.push(g(y, m, dd, 4000 + ++n));
      }
    }
    // Moves on these days (9 AM): to the 15th, to Last day, to the 28th, to the 1st, to the 20th, back to Last day.
    const moves: [string, number][] = [['2026-11-16', 15], ['2026-11-20', 0], ['2027-01-03', 28], ['2027-01-29', 1], ['2027-02-10', 20], ['2027-03-25', 0]];
    const onAt = et(2026, 10, 1, 9);
    let days = { membershipDay: 26, courtDay: 0 };
    let daysFrom = 0;
    const history: VenueDaysSpan[] = [];
    const paid = new Set<string>();
    const paidDates: string[] = [];
    const billed: number[] = [];
    let periodStart: string | null = null;
    for (let d = '2026-10-01'; d <= '2027-04-30'; d = addDays(d, 1)) {
      const mv = moves.find((x) => x[0] === d);
      if (mv) {
        const at = et(Number(d.slice(0, 4)), Number(d.slice(5, 7)), Number(d.slice(8)), 9);
        history.push({ ...days, from: daysFrom, until: at });
        days = { ...days, courtDay: mv[1] };
        daysFrom = at;
      }
      const nowMs = et(Number(d.slice(0, 4)), Number(d.slice(5, 7)), Number(d.slice(8)), 12);
      const cards = dueAlerts({ ...base, membershipCents: 0, days, daysFrom, history, games, onAtMs: onAt, nowMs, paid, courtPaidDates: paidDates });
      for (const c of cards) {
        for (const k of c.keys) paid.add(k);
        paidDates.push(c.date);
        if (periodStart === null) periodStart = c.date;
        billed.push(c.cents);
      }
    }
    const last = paidDates[paidDates.length - 1];
    const inRange = games.filter((x) => localYmd(Date.parse(x.startsAt), TZ) > '2026-09-30' && localYmd(Date.parse(x.startsAt), TZ) <= last);
    expect(billed.reduce((a, b) => a + b, 0)).toBe(inRange.reduce((a, b) => a + b.costCents, 0));
    // Two court charges in November (Nov 15 under the 15th, Nov 30 under Last day): the second is keyed by its date.
    expect([...paid].filter((k) => k.startsWith('court:2026-11'))).toEqual(['court:2026-11', 'court:2026-11-30']);
  });
});

// ---------------------------------------------------------------- F-15 and F-16: late drops ----------------------------------------------------------------

const EXTRA = ['Gale', 'Harper', 'Indy'];
async function lateWorld(opts: { guests?: boolean } = {}) {
  const app = new TestApp();
  const w = await setupGroup(app);
  expect((await w.organizer.call('PUT', '/api/admin/group', { organizerName: 'Alex' })).status).toBe(200);
  for (const [i, n] of EXTRA.entries()) {
    const r = await w.organizer.call('POST', '/api/admin/players', { name: n, phone: `(313) 555-04${String(i).padStart(2, '0')}` });
    expect(r.status, r.text).toBe(200);
    w.byName[n] = r.data.id;
  }
  if (opts.guests) expect((await w.organizer.call('PUT', '/api/admin/guest-spot-switch', { on: true })).status).toBe(200);
  expect((await w.organizer.call('PUT', '/api/admin/late-fees', { on: true })).status).toBe(200);
  return { ...w, phones: new Map<string, Client>() };
}
type LW = Awaited<ReturnType<typeof lateWorld>>;
async function phone(w: LW, name: string): Promise<Client> {
  let c = w.phones.get(name);
  if (!c) {
    c = w.app.client();
    c.groupKey = w.groupKey;
    expect((await c.call('POST', '/api/me', { playerId: w.byName[name] })).status).toBe(200);
    w.phones.set(name, c);
  }
  return c;
}
const ldash = async (w: LW) => {
  let r = await w.organizer.call('GET', '/api/admin/dashboard');
  if (r.status === 401) {
    await w.organizer.call('POST', '/api/admin/login', { pin: PIN });
    r = await w.organizer.call('GET', '/api/admin/dashboard');
  }
  return r.data;
};
const view = async (w: LW, name: string): Promise<GroupView> => (await (await phone(w, name)).call('GET', '/api/group')).data;
const mineOf = async (w: LW, name: string, sid: string) => (await view(w, name)).sessions.find((s) => s.id === sid)!.mine;
async function nextGame(w: LW) {
  const s = (await ldash(w)).sessions.filter((x: any) => Date.parse(x.startsAt) > w.app.now && !x.state.flags.canceled)[0];
  return { id: s.id as string, start: Date.parse(s.startsAt) };
}
const join = async (w: LW, sid: string, names: string[]) => {
  for (const n of names) expect((await (await phone(w, n)).call('POST', `/api/sessions/${sid}/join`, {})).status).toBe(200);
};
const drop = (w: LW, sid: string, name: string, body: Record<string, unknown> = {}) => phone(w, name).then((p) => p.call('POST', `/api/sessions/${sid}/withdraw`, body));
/** Drop out the way the phone does it: with the quote of what its dialog shows right now. */
const dropAsShown = async (w: LW, sid: string, name: string) => drop(w, sid, name, { quote: dropQuote(await mineOf(w, name, sid)) });
const markPaid = async (w: LW, sid: string, name: string) => expect((await w.organizer.call('POST', `/api/admin/sessions/${sid}/payment`, { playerId: w.byName[name], paid: true })).status).toBe(200);
const rosterAct = (w: LW, sid: string, name: string, action: string) => w.organizer.call('POST', `/api/admin/sessions/${sid}/roster`, { playerId: w.byName[name], action });
const lateDropsOf = async (w: LW, name: string) => (await ldash(w)).players.find((p: any) => p.name === name).lateDrops as number;
const pot = async (w: LW, name: string) => (await view(w, name)).credit.balanceCents;
const owed = async (w: LW, name: string, sid: string) => (await view(w, name)).owed.find((o) => o.sessionId === sid) ?? null;
const seatRow = (w: LW, sid: string, name: string) => raw(w).prepare('SELECT status, payment_status, payment_amount_cents, played, late_drop_at, late_drop_done_at FROM session_players WHERE session_id = ? AND player_id = ?').get(sid, w.byName[name]);
const integrity = (w: LW) => {
  const sql = readFileSync(pjoin(process.cwd(), 'scripts/integrity-checks.sql'), 'utf8').split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
  const row = raw(w).prepare(sql).get() as Record<string, number>;
  return Object.fromEntries(Object.entries(row).filter(([k, v]) => !k.startsWith('info_') && v !== 0));
};

describe('F-15 a late dropper Alex puts back In', () => {
  it('the late-drop mark goes, as with the player\'s own I\'m in (count 1, then 0); the seat reads as before', async () => {
    for (const how of ['self', 'organizer'] as const) {
      const w = await lateWorld();
      const g = await nextGame(w);
      await join(w, g.id, ['Blair', 'Casey', 'Devon', 'Emery', 'Frankie']);
      w.app.now = g.start - 4 * HOUR;
      expect((await drop(w, g.id, 'Blair')).status).toBe(200); // 4 left: a late drop that owes nothing
      expect(await lateDropsOf(w, 'Blair')).toBe(1);
      if (how === 'self') await join(w, g.id, ['Blair']);
      else expect((await rosterAct(w, g.id, 'Blair', 'confirm')).status).toBe(200);
      expect([how, await lateDropsOf(w, 'Blair')]).toEqual([how, 0]);
      expect(seatRow(w, g.id, 'Blair')).toMatchObject({ status: 'confirmed', late_drop_at: null, late_drop_done_at: null });
      expect(integrity(w)).toEqual({});
    }
  });
  it('a paid $14 late drop that owed (4 in), put back In by Alex: Paid $14, owes $0, no debt, no credit, no mark; a later drop owes again only by the rule', async () => {
    const w = await lateWorld();
    const g = await nextGame(w);
    await join(w, g.id, ['Blair', 'Casey', 'Devon', 'Emery']);
    await markPaid(w, g.id, 'Blair');
    w.app.now = g.start - 4 * HOUR;
    expect((await drop(w, g.id, 'Blair')).data).toMatchObject({ lateFee: { cents: 1400, paid: true } });
    expect((await rosterAct(w, g.id, 'Blair', 'confirm')).status).toBe(200);
    expect(seatRow(w, g.id, 'Blair')).toMatchObject({ status: 'confirmed', payment_status: 'paid', payment_amount_cents: 1400, late_drop_at: null });
    expect(await owed(w, 'Blair', g.id)).toBeNull();
    expect(await pot(w, 'Blair')).toBe(0);
    expect(await lateDropsOf(w, 'Blair')).toBe(0);
    // Gale joins (5 in), Blair drops again: still 4 left, so nothing is owed: the $14 comes back as credit.
    await join(w, g.id, ['Gale']);
    w.app.now += 60_000;
    expect((await dropAsShown(w, g.id, 'Blair')).data).toMatchObject({ result: 'withdrawn', creditBackCents: 1400 });
    expect(await pot(w, 'Blair')).toBe(1400);
    expect(integrity(w)).toEqual({});
  });
  it('host + guest, a late drop two short: Alex\'s In gives the same money as the host\'s own I\'m in (paid $28: $14 back as credit; unpaid: owes $14)', async () => {
    const out: Record<string, unknown> = {};
    for (const paid of [true, false]) {
      for (const how of ['self', 'organizer'] as const) {
        const w = await lateWorld({ guests: true });
        const g = await nextGame(w);
        await join(w, g.id, ['Blair', 'Casey', 'Devon']);
        expect((await w.organizer.call('POST', `/api/admin/sessions/${g.id}/guest`, { playerId: w.byName.Blair, name: 'Sam' })).status).toBe(200);
        if (paid) await markPaid(w, g.id, 'Blair');
        w.app.now = g.start - 4 * HOUR;
        expect((await drop(w, g.id, 'Blair')).data).toMatchObject({ lateFee: { cents: 2800, paid } });
        w.app.now += 1000;
        if (how === 'self') await join(w, g.id, ['Blair']);
        else expect((await rosterAct(w, g.id, 'Blair', 'confirm')).status).toBe(200);
        const r = seatRow(w, g.id, 'Blair');
        const o = await owed(w, 'Blair', g.id);
        out[`${paid}:${how}`] = { status: r.status, pay: r.payment_status, amt: r.payment_amount_cents, mark: r.late_drop_at, owes: o?.amountCents ?? 0, debt: o?.lateFee ?? null, pot: await pot(w, 'Blair'), late: await lateDropsOf(w, 'Blair') };
        expect(integrity(w)).toEqual({});
      }
    }
    expect(out['true:organizer']).toEqual(out['true:self']);
    expect(out['false:organizer']).toEqual(out['false:self']);
    expect(out['true:self']).toEqual({ status: 'confirmed', pay: 'paid', amt: 1400, mark: null, owes: 0, debt: null, pot: 1400, late: 0 });
    expect(out['false:self']).toEqual({ status: 'confirmed', pay: 'unpaid', amt: null, mark: null, owes: 1400, debt: null, pot: 0, late: 0 });
  });
  it('back In from Alex, then the game moves to another day and the player drops early: no "late drop" left over from the first time', async () => {
    const w = await lateWorld();
    const g = await nextGame(w);
    await join(w, g.id, ['Blair', 'Casey', 'Devon', 'Emery', 'Frankie']);
    w.app.now = g.start - 4 * HOUR;
    await drop(w, g.id, 'Blair');
    expect((await rosterAct(w, g.id, 'Blair', 'confirm')).status).toBe(200);
    const s = (await ldash(w)).sessions.find((x: any) => x.id === g.id);
    const two = 24 * HOUR; // Tuesday to Wednesday (Thursday already has its own game)
    expect((await w.organizer.call('PUT', `/api/admin/sessions/${g.id}/time`, { startsAt: new Date(Date.parse(s.startsAt) + two).toISOString(), endsAt: new Date(Date.parse(s.endsAt) + two).toISOString() })).status).toBe(200);
    expect((await dropAsShown(w, g.id, 'Blair')).data).toMatchObject({ result: 'withdrawn' });
    expect(seatRow(w, g.id, 'Blair')).toMatchObject({ status: 'withdrawn', late_drop_at: null });
    expect((await ldash(w)).sessions.find((x: any) => x.id === g.id).roster.find((r: any) => r.name === 'Blair').lateDropAt).toBeNull();
    expect(await lateDropsOf(w, 'Blair')).toBe(0);
  });
  it('an open debt still cannot be moved to the waitlist (unchanged), and Finalize after Alex\'s In charges the normal price', async () => {
    const w = await lateWorld();
    const g = await nextGame(w);
    await join(w, g.id, ['Blair', 'Casey', 'Devon', 'Emery']);
    w.app.now = g.start - 4 * HOUR;
    await drop(w, g.id, 'Blair'); // owes $14
    expect((await rosterAct(w, g.id, 'Blair', 'waitlist')).status).toBe(409);
    expect((await rosterAct(w, g.id, 'Blair', 'confirm')).status).toBe(200);
    w.app.now = g.start + 3 * HOUR;
    expect((await w.organizer.call('POST', `/api/admin/sessions/${g.id}/finalize`, { everyone: true })).status).toBe(200);
    expect(await owed(w, 'Blair', g.id)).toMatchObject({ amountCents: 1400 });
    expect((await owed(w, 'Blair', g.id))!.lateFee ?? null).toBeNull();
  });
});

describe('F-16 the Drop out dialog is checked again when the player taps it', () => {
  it('the quote reads the dialog\'s money', () => {
    const seat = { status: 'confirmed', dropCreditCents: 0, dropCashCents: 1400, dropClaimCents: 0 };
    expect(dropQuote(seat)).toBe('seat|early|spots:-|back:1400|claim:0|guest:-');
    expect(dropQuote({ ...seat, dropCashCents: 0, lateDrop: { owes: true, paid: true, feeCents: 2800, guestSpots: 2 }, guest: { status: 'confirmed' } })).toBe('seat|late:owes:2800:stays|spots:2|back:0|claim:0|guest:confirmed');
    expect(dropQuote({ ...seat, lateDrop: { owes: false, paid: false, feeCents: 1400 } })).toBe('seat|late:free:0:-|spots:-|back:1400|claim:0|guest:-');
    // In or waiting reads the same (the phone draws an old waiting seat as in on a game with no court; reviewer finding).
    expect(dropQuote({ ...seat, status: 'waitlisted' })).toBe(dropQuote(seat));
    expect(dropQuote({ ...seat, status: 'withdrawn' })).toBeNull();
    expect(dropQuote(null)).toBeNull();
  });

  it('shown "your spot opens up" a second before the cancel-by, tapped a second after: nothing dropped ("look again"), then the real $14 is shown and charged', async () => {
    const w = await lateWorld();
    const g = await nextGame(w);
    await join(w, g.id, ['Blair', 'Casey', 'Devon', 'Emery']);
    await markPaid(w, g.id, 'Blair');
    w.app.now = g.start - 12 * HOUR - 1000;
    const shown = await mineOf(w, 'Blair', g.id);
    expect(shown?.lateDrop).toBeUndefined();
    expect(shown).toMatchObject({ dropCashCents: 1400 }); // "$14 comes back as credit"
    w.app.now = g.start - 12 * HOUR + 1000;
    const r = await drop(w, g.id, 'Blair', { quote: dropQuote(shown) });
    expect(r.status).toBe(409);
    expect(r.data).toMatchObject({ error: DROP_CHANGED, message: 'This just changed. Look again.' });
    expect(seatRow(w, g.id, 'Blair')).toMatchObject({ status: 'confirmed', payment_status: 'paid' });
    expect(await pot(w, 'Blair')).toBe(0);
    // The phone reloads: the dialog now says "you still owe $14" (paid: "stays"); confirmed, that is exactly what happens.
    const now = await mineOf(w, 'Blair', g.id);
    expect(now?.lateDrop).toMatchObject({ owes: true, paid: true, feeCents: 1400 });
    const ok = await drop(w, g.id, 'Blair', { quote: dropQuote(now) });
    expect(ok.data).toMatchObject({ result: 'withdrawn', creditBackCents: 0, lateFee: { cents: 1400, paid: true } });
    expect(await pot(w, 'Blair')).toBe(0);
    expect(integrity(w)).toEqual({});
  });

  it('shown $14 owed (4 in), then Gale joins (5 in): the real amount is $0, so nothing is dropped; the fresh dialog gives the $14 back', async () => {
    const w = await lateWorld();
    const g = await nextGame(w);
    await join(w, g.id, ['Blair', 'Casey', 'Devon', 'Emery']);
    await markPaid(w, g.id, 'Blair');
    w.app.now = g.start - 4 * HOUR;
    const shown = await mineOf(w, 'Blair', g.id);
    expect(shown?.lateDrop).toMatchObject({ owes: true, feeCents: 1400 });
    await join(w, g.id, ['Gale']);
    expect((await drop(w, g.id, 'Blair', { quote: dropQuote(shown) })).status).toBe(409);
    expect(seatRow(w, g.id, 'Blair').status).toBe('confirmed');
    const ok = await dropAsShown(w, g.id, 'Blair');
    expect(ok.data).toMatchObject({ result: 'withdrawn', creditBackCents: 1400 });
    expect(ok.data.lateFee).toBeUndefined();
    expect(await pot(w, 'Blair')).toBe(1400);
  });

  it('shown $0 (5 in), then Casey drops (4 in): the real amount is $14, so nothing is dropped and nothing is owed until the player taps again', async () => {
    const w = await lateWorld();
    const g = await nextGame(w);
    await join(w, g.id, ['Blair', 'Casey', 'Devon', 'Emery', 'Frankie']);
    w.app.now = g.start - 4 * HOUR;
    const shown = await mineOf(w, 'Blair', g.id);
    expect(shown?.lateDrop).toMatchObject({ owes: false });
    expect((await dropAsShown(w, g.id, 'Casey')).status).toBe(200);
    expect((await drop(w, g.id, 'Blair', { quote: dropQuote(shown) })).status).toBe(409);
    expect(await owed(w, 'Blair', g.id)).toMatchObject({ amountCents: 1400 }); // the normal unpaid seat, not a late-drop debt
    expect((await owed(w, 'Blair', g.id))!.lateFee ?? null).toBeNull();
    expect(seatRow(w, g.id, 'Blair')).toMatchObject({ status: 'confirmed', late_drop_at: null });
    const ok = await dropAsShown(w, g.id, 'Blair');
    expect(ok.data).toMatchObject({ result: 'withdrawn', lateFee: { cents: 1400, paid: false } });
  });

  it('host + guest shown $14 (one spot short), then another drop makes it two short ($28): nothing dropped; the fresh dialog says $28', async () => {
    const w = await lateWorld({ guests: true });
    const g = await nextGame(w);
    await join(w, g.id, ['Blair', 'Casey', 'Devon', 'Emery']);
    expect((await w.organizer.call('POST', `/api/admin/sessions/${g.id}/guest`, { playerId: w.byName.Blair, name: 'Sam' })).status).toBe(200);
    w.app.now = g.start - 4 * HOUR;
    const shown = await mineOf(w, 'Blair', g.id);
    expect(shown?.lateDrop).toMatchObject({ owes: true, feeCents: 1400, guestSpots: 1 }); // 5 heads: leaving takes 2, 1 short
    expect((await dropAsShown(w, g.id, 'Emery')).status).toBe(200);
    expect((await drop(w, g.id, 'Blair', { quote: dropQuote(shown) })).status).toBe(409);
    const now = await mineOf(w, 'Blair', g.id);
    expect(now?.lateDrop).toMatchObject({ owes: true, feeCents: 2800, guestSpots: 2 });
    expect((await drop(w, g.id, 'Blair', { quote: dropQuote(now) })).data).toMatchObject({ lateFee: { cents: 2800, paid: false } });
    expect(integrity(w)).toEqual({});
  });

  it('a matching quote drops at exactly the shown money; an older page (no quote) and a seat already out answer as before', async () => {
    const w = await lateWorld();
    const g = await nextGame(w);
    await join(w, g.id, ['Blair', 'Casey', 'Devon', 'Emery', 'Frankie']);
    await markPaid(w, g.id, 'Blair');
    const r = await dropAsShown(w, g.id, 'Blair');
    expect(r.data).toMatchObject({ result: 'withdrawn', creditBackCents: 1400 });
    // The same tap again (a second phone, a retry): not in any more, so no quote check: answered as before.
    const again = await drop(w, g.id, 'Blair', { quote: 'seat|early|spots:-|back:1400|claim:0|guest:-' });
    expect(again.status).toBe(200);
    expect(again.data).toMatchObject({ result: 'not_in_session' });
    // No quote at all (a page from before this release): the drop is not checked.
    expect((await drop(w, g.id, 'Casey')).data).toMatchObject({ result: 'withdrawn' });
    // A quote that is junk or too long is ignored the same way.
    expect((await drop(w, g.id, 'Devon', { quote: 'x'.repeat(500) })).data).toMatchObject({ result: 'withdrawn' });
  });

  it('a seat the phone draws as in but the server has waiting (an unbooked game with room): Drop out works, not "look again" forever (reviewer)', async () => {
    const w = await lateWorld();
    const g = await nextGame(w);
    await join(w, g.id, ['Blair', 'Casey']);
    expect((await rosterAct(w, g.id, 'Blair', 'waitlist')).status).toBe(200);
    const raw0 = await mineOf(w, 'Blair', g.id);
    expect(raw0?.status).toBe('waitlisted');
    // src/courtDisplay.ts redraws it as in; the quote is built from what the dialog shows.
    const shown = { ...raw0!, status: 'confirmed' as const };
    const r = await drop(w, g.id, 'Blair', { quote: dropQuote(shown) });
    expect(r.status, r.text).toBe(200);
    expect(seatRow(w, g.id, 'Blair').status).toBe('withdrawn');
  });

  it('two drops in the same instant: the seat only leaves when its statement still finds what was shown (the race inside the server)', async () => {
    const w = await lateWorld();
    const g = await nextGame(w);
    await join(w, g.id, ['Blair', 'Casey', 'Devon', 'Emery']);
    w.app.now = g.start - 4 * HOUR;
    const group = raw(w).prepare('SELECT * FROM groups').get() as GroupRow;
    const session = (await getSession(w.app.db as never, group.id, g.id))!;
    // The screen said "owes nothing" but the game is at 4: leaving would leave it short. Nothing moves, `stale` says why.
    const res = await withdraw(w.app.db as never, group, session, w.byName.Blair, w.app.now, { lateFees: true, expect: { owes: false } });
    expect(res).toMatchObject({ changed: false, stale: true });
    expect(seatRow(w, g.id, 'Blair')).toMatchObject({ status: 'confirmed', late_drop_at: null });
    // As shown ("owes"): it leaves and owes.
    const ok = await withdraw(w.app.db as never, group, session, w.byName.Blair, w.app.now, { lateFees: true, expect: { owes: true } });
    expect(ok).toMatchObject({ changed: true, lateFee: { paid: false } });
    expect(ok.stale).toBeUndefined();
  });
});
