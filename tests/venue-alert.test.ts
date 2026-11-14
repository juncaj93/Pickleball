// Zip 43: "Venue charge alert" (VENUE_ALERT, ships OFF). The server side with a fake clock: the switch, the two days in Settings, the cards, Mark paid
// (one History line, no double entry, survives a reload), no backfill, the math against Money > Totals, and OFF equals main.
import { describe, expect, it } from 'vitest';
import type { MonthlyMoney } from '../shared/api';
import { activityText } from '../shared/activity';
import { MONEY_REWORK_HEADER } from '../shared/moneyRework';
import { VENUE_ALERT } from '../shared/venueAlert';
import { homeBadgeCount } from '../src/pages/admin/todo';
import { DAY, HOUR, playerPhone, setupGroup, TestApp } from './harness';

const TZ = 'America/Detroit';
/** Eastern wall clock in the weeks this test world lives in: Oct (EDT, UTC-4) and Nov to Dec (EST, UTC-5, the clock changed on Sun Nov 1). */
const edt = (m: number, d: number, h = 12, min = 0) => Date.UTC(2026, m - 1, d, h + 4, min);
const est = (m: number, d: number, h = 12, min = 0) => Date.UTC(2026, m - 1, d, h + 5, min);

async function world() {
  const app = new TestApp();
  const w = await setupGroup(app);
  await w.organizer.call('PUT', '/api/admin/group', { organizerName: 'Alex' });
  return w;
}
type W = Awaited<ReturnType<typeof world>>;
const dash = async (w: W, headers: Record<string, string> = {}) => (await w.organizer.call('GET', '/api/admin/dashboard', undefined, headers)).data;
const raw = (w: W) => (w.app.db as unknown as { raw: { prepare: (s: string) => { run: (...a: unknown[]) => unknown; get: (...a: unknown[]) => any; all: (...a: unknown[]) => any[] } } }).raw;
const on = (w: W) => w.organizer.call('PUT', '/api/admin/venue-alert-switch', { on: true });
const day = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(iso));
const sessionOn = (d: any, date: string) => d.sessions.find((s: any) => day(s.startsAt) === date);
const book = async (w: W, date: string) => {
  const s = sessionOn(await dash(w), date);
  expect(s, `a game on ${date}`).toBeDefined();
  const r = await w.organizer.call('POST', `/api/admin/sessions/${s.id}/booked`, {});
  expect(r.status, r.text).toBe(200);
  return s.id as string;
};
const paidLines = async (w: W) => ((await w.organizer.call('GET', '/api/admin/activity')).data.entries as any[]).filter((e) => e.action === 'venue_charge_paid');
/** Move the fake clock (an organizer sign-in lasts a week, so a long jump signs in again, like the person would). */
const jump = async (w: W, ms: number) => {
  w.app.now = ms;
  expect((await w.organizer.call('POST', '/api/admin/login', { pin: '246810' })).status).toBe(200);
};
const mark = (w: W, keys: string[], cents: number) => w.organizer.call('POST', '/api/admin/venue-alert/paid', { keys, cents });
const settingsJson = (w: W) => raw(w).prepare('SELECT settings_json AS j FROM groups').get().j as string;

describe('OFF is main: the answer carries nothing from this feature', () => {
  it('no field on the dashboard, no key in the saved settings, even after a save', async () => {
    const w = await world();
    const before = settingsJson(w);
    const d = await dash(w);
    expect(JSON.stringify(d)).not.toMatch(/venue(Alert|Days|AlertForAll)/);
    expect(d.venueAlert).toBeUndefined();
    await w.organizer.call('PUT', '/api/admin/group', { settings: { maxPlayers: 9 } });
    expect(settingsJson(w)).not.toMatch(/venueDays/);
    expect(Object.keys(JSON.parse(before))).not.toContain('venueDays');
  });
  it('with the switch off no card exists, however late the clock is, and Mark paid is refused', async () => {
    const w = await world();
    w.app.now = edt(10, 31, 12);
    const d = await dash(w);
    expect(d.venueAlerts).toBeUndefined();
    expect((await mark(w, ['membership:2026-10'], 3000)).status).toBe(409);
  });
  it('a player cannot flip it or mark anything', async () => {
    const w = await world();
    const ph = await playerPhone(w, 'Blair');
    expect((await ph.call('PUT', '/api/admin/venue-alert-switch', { on: true })).status).toBe(401);
    expect((await ph.call('POST', '/api/admin/venue-alert/paid', { keys: ['court:2026-10'], cents: 100 })).status).toBe(401);
    await on(w);
    expect(JSON.stringify((await ph.call('GET', '/api/group', undefined, { [VENUE_ALERT.header]: 'on' })).data)).not.toMatch(/venue(Alert|Days)/i);
  });
});

describe('the switch: a Settings row, a private link, a kill switch', () => {
  it('the row turns it on for every organizer phone with an Activity line; the kill switch beats it; the private link works alone', async () => {
    const w = await world();
    expect((await on(w)).status).toBe(200);
    let d = await dash(w);
    expect(d.venueAlert).toBe(true);
    expect(d.venueAlertForAll).toBe(true);
    expect(d.venueAlerts).toEqual([]);
    expect(d.venueDays).toEqual({ membershipDay: 26, courtDay: 0 });
    const act = ((await w.organizer.call('GET', '/api/admin/activity')).data.entries as any[]).find((e) => e.action === 'venue_alert_on');
    expect(activityText(act, TZ, 'Alex')).toContain('switched "Venue charge alert" on');
    (w.app.env as unknown as Record<string, unknown>).VENUE_ALERT = 'off';
    d = await dash(w);
    expect(d.venueAlert).toBeUndefined();
    expect(d.venueAlertForAll).toBe(true);
    expect((await dash(w, { [VENUE_ALERT.header]: 'on' })).venueAlert).toBeUndefined();
    (w.app.env as unknown as Record<string, unknown>).VENUE_ALERT = undefined;
    expect((await w.organizer.call('PUT', '/api/admin/venue-alert-switch', { on: false })).status).toBe(200);
    expect((await dash(w)).venueAlert).toBeUndefined();
    d = await dash(w, { [VENUE_ALERT.header]: 'on' });
    expect(d.venueAlert).toBe(true);
    expect(d.venueAlertForAll).toBeUndefined();
  });
});

describe('the two days in Settings', () => {
  it('saved inside the group settings: defaults, a change of each, junk refused, every other save keeps them', async () => {
    const w = await world();
    await on(w);
    expect((await dash(w)).venueDays).toEqual({ membershipDay: 26, courtDay: 0 });
    expect((await w.organizer.call('PUT', '/api/admin/group', { venueDays: { membershipDay: 31 } })).status).toBe(200);
    expect((await dash(w)).venueDays).toEqual({ membershipDay: 31, courtDay: 0 });
    expect((await w.organizer.call('PUT', '/api/admin/group', { venueDays: { courtDay: 15 } })).status).toBe(200);
    expect((await dash(w)).venueDays).toEqual({ membershipDay: 31, courtDay: 15 });
    for (const bad of [{ membershipDay: 32 }, { membershipDay: 0 }, { courtDay: 29 }, { courtDay: -1 }, { courtDay: 1.5 }, { courtDay: 'x' }]) {
      const r = await w.organizer.call('PUT', '/api/admin/group', { venueDays: bad });
      expect(r.status, JSON.stringify(bad)).toBe(400);
    }
    expect((await dash(w)).venueDays).toEqual({ membershipDay: 31, courtDay: 15 });
    // Any other save (a price, the Zelle number, the group name) never drops them.
    await w.organizer.call('PUT', '/api/admin/group', { settings: { pricePerPlayerCents: 1500 } });
    await w.organizer.call('PUT', '/api/admin/group', { zelleNumber: '248-555-0123' });
    await w.organizer.call('PUT', '/api/admin/group', { name: 'Renamed' });
    expect((await dash(w)).venueDays).toEqual({ membershipDay: 31, courtDay: 15 });
    expect(JSON.parse(settingsJson(w)).zelleNumber).toBe('248-555-0123');
  });
  it('the days are changed with the switch off too, and nothing is lost when it is turned on later', async () => {
    const w = await world();
    await w.organizer.call('PUT', '/api/admin/group', { venueDays: { membershipDay: 5, courtDay: 10 } });
    await on(w);
    expect((await dash(w)).venueDays).toEqual({ membershipDay: 5, courtDay: 10 });
  });
});

/** Oct 26 noon: switch on. Games on Oct 27 and 29 (booked), Nov 3 and 5 (booked). The charge days are the defaults (membership 26th, courts Last day). */
async function booked(w: W, dates: string[]) {
  const ids: string[] = [];
  for (const dte of dates) ids.push(await book(w, dte));
  return ids;
}

describe('the cards and the math', () => {
  it('courts on the last day: booked games only, at the Typical court cost, with the exact words; the membership on its own day', async () => {
    const w = await world();
    await on(w); // Mon Oct 26, 12:00 PM Eastern
    await booked(w, ['2026-10-27', '2026-10-29']);
    // A Not booked game and a Waitlist game in the same month never count.
    const sess = (await dash(w)).sessions.filter((s: any) => day(s.startsAt) === '2026-11-03');
    expect(sess).toHaveLength(1);
    w.app.now = edt(10, 30, 23, 59);
    expect((await dash(w)).venueAlerts).toEqual([]);
    w.app.now = edt(10, 31, 0, 0);
    const a = (await dash(w)).venueAlerts;
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ kinds: ['court'], cents: 9600, title: 'Northville Pickleball should have charged you $96', line: '2 games x $48 = $96', keys: ['court:2026-10'] });
    // The membership 26th of October was before the switch went on (Oct 26 12:00 PM): no backfill, not even for today.
    expect(a.some((x: any) => x.kinds.includes('membership'))).toBe(false);
    // November's membership day, the 26th.
    await jump(w, est(11, 26, 0, 0));
    const n = (await dash(w)).venueAlerts;
    expect(n.map((x: any) => x.keys.join('+'))).toEqual(['court:2026-10', 'membership:2026-11']);
    expect(n[1]).toMatchObject({ cents: 3000, title: 'Membership should have been charged: $30', line: 'Monthly membership, Northville Pickleball' });
  });
  it('Waitlist, Not booked and canceled games do not count; a canceled game that was Booked drops out', async () => {
    const w = await world();
    await on(w);
    const [a, b] = await booked(w, ['2026-10-27', '2026-10-29']);
    const waitlist = sessionOn(await dash(w), '2026-11-03').id;
    expect((await w.organizer.call('POST', `/api/admin/sessions/${waitlist}/court-status`, { status: 'waitlist' })).status).toBe(200);
    w.app.now = edt(10, 31, 8);
    expect((await dash(w)).venueAlerts[0].line).toBe('2 games x $48 = $96');
    // Cancel one of the two booked games (nobody in it): the court charge is for the other one.
    const c = await w.organizer.call('POST', `/api/admin/sessions/${b}/decision`, { decision: 'cancel', confirm: true });
    expect(c.status, c.text).toBe(200);
    const card = (await dash(w)).venueAlerts[0];
    expect(card).toMatchObject({ cents: 4800, line: '1 game x $48 = $48' });
    // Back to not booked (the court switch itself refuses a game that is over, so the row is changed directly): no booked game at all means no court card.
    raw(w).prepare("UPDATE sessions SET booking_status = 'needs_booking' WHERE id = ?").run(a);
    expect((await dash(w)).venueAlerts).toEqual([]);
  });
  it('a game on the charge day itself counts; one just after midnight Eastern the next day does not (Eastern, not UTC)', async () => {
    const w = await world();
    await on(w);
    w.app.now = edt(10, 26, 13);
    // Games on Oct 27 and 29 exist; move one to 11:30 PM on Oct 31 (03:30 UTC Nov 1) and another to 12:30 AM Nov 1 (04:30 UTC, still EDT).
    const d0 = await dash(w);
    const s1 = sessionOn(d0, '2026-10-27');
    const s2 = sessionOn(d0, '2026-10-29');
    await book(w, '2026-10-27');
    await book(w, '2026-10-29');
    raw(w).prepare('UPDATE sessions SET starts_at = ?, ends_at = ? WHERE id = ?').run('2026-11-01T03:30:00.000Z', '2026-11-01T05:30:00.000Z', s1.id);
    raw(w).prepare('UPDATE sessions SET starts_at = ?, ends_at = ? WHERE id = ?').run('2026-11-01T04:30:00.000Z', '2026-11-01T06:30:00.000Z', s2.id);
    w.app.now = edt(10, 31, 0, 0);
    expect((await dash(w)).venueAlerts[0]).toMatchObject({ cents: 4800, line: '1 game x $48 = $48' });
  });
  it('each game at its own court cost; differing costs read "N games = $X"; the Typical court cost setting fills the rest', async () => {
    const w = await world();
    await on(w);
    const [a, b] = await booked(w, ['2026-10-27', '2026-10-29']);
    raw(w).prepare('UPDATE sessions SET court_cost_cents = ? WHERE id = ?').run(3600, a);
    w.app.now = edt(10, 31, 8);
    expect((await dash(w)).venueAlerts[0]).toMatchObject({ cents: 3600 + 4800, line: '2 games = $84' });
    // Both at their own cost, the same: "x $36".
    raw(w).prepare('UPDATE sessions SET court_cost_cents = ? WHERE id = ?').run(3600, b);
    expect((await dash(w)).venueAlerts[0]).toMatchObject({ cents: 7200, line: '2 games x $36 = $72' });
    // The Typical court cost setting is what a game with no cost of its own is priced at.
    raw(w).prepare('UPDATE sessions SET court_cost_cents = NULL').run();
    await w.organizer.call('PUT', '/api/admin/group', { settings: { typicalCourtCostCents: 5000 } });
    expect((await dash(w)).venueAlerts[0]).toMatchObject({ cents: 10000, line: '2 games x $50 = $100' });
  });
});

describe('Mark paid', () => {
  async function setup() {
    const w = await world();
    await on(w);
    await booked(w, ['2026-10-27', '2026-10-29']);
    w.app.now = edt(10, 31, 8);
    return w;
  }
  it('writes ONE History line "Venue charge marked paid: $96", removes the card, and it stays gone after a reload', async () => {
    const w = await setup();
    const r = await mark(w, ['court:2026-10'], 9600);
    expect(r.status, r.text).toBe(200);
    expect(r.data).toEqual({ ok: true, already: false });
    const lines = await paidLines(w);
    expect(lines).toHaveLength(1);
    expect(activityText(lines[0], TZ, 'Alex')).toBe('Venue charge marked paid: $96');
    expect((await dash(w)).venueAlerts).toEqual([]);
    // A fresh phone, a later day: still gone.
    const fresh = w.app.client();
    expect((await fresh.call('POST', '/api/admin/login', { pin: '246810' })).status).toBe(200);
    w.app.now = edt(11, 2, 9);
    expect((await fresh.call('GET', '/api/admin/dashboard')).data.venueAlerts).toEqual([]);
  });
  it('a double tap (two requests at once, or one after the other) writes one line', async () => {
    const w = await setup();
    const [a, b] = await Promise.all([mark(w, ['court:2026-10'], 9600), mark(w, ['court:2026-10'], 9600)]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect([a.data.already, b.data.already].sort()).toEqual([false, true]);
    const again = await mark(w, ['court:2026-10'], 9600);
    expect(again.status).toBe(200);
    expect(again.data.already).toBe(true);
    expect(await paidLines(w)).toHaveLength(1);
    expect(raw(w).prepare("SELECT COUNT(*) AS n FROM task_log WHERE task LIKE 'venue_paid:%'").get().n).toBe(1);
  });
  it('the amount must match what the card showed; a charge that is not due, or junk, is refused and writes nothing', async () => {
    const w = await setup();
    expect((await mark(w, ['court:2026-10'], 9500)).status).toBe(409);
    expect((await mark(w, ['court:2026-11'], 9600)).status).toBe(409); // not due yet
    expect((await mark(w, ['membership:2026-10'], 3000)).status).toBe(409); // before the switch went on
    for (const bad of [[], ['x'], ['court:2026-10', 'court:2026-10'], ['court:2026-1'], ['court:2026-10', 'membership:2026-10', 'court:2026-11']]) {
      expect((await mark(w, bad as string[], 9600)).status, JSON.stringify(bad)).toBe(400);
    }
    expect((await w.organizer.call('POST', '/api/admin/venue-alert/paid', { keys: ['court:2026-10'] })).status).toBe(409);
    expect(await paidLines(w)).toHaveLength(0);
    expect(raw(w).prepare("SELECT COUNT(*) AS n FROM task_log WHERE task LIKE 'venue_paid:%'").get().n).toBe(0);
  });
  it('a combined card marks both at once (one line for the sum); marking one half of a pair leaves the other alone', async () => {
    const w = await world();
    await w.organizer.call('PUT', '/api/admin/group', { venueDays: { membershipDay: 31, courtDay: 0 } });
    await on(w);
    await booked(w, ['2026-10-27', '2026-10-29']);
    w.app.now = edt(10, 31, 8);
    const a = (await dash(w)).venueAlerts;
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ keys: ['court:2026-10', 'membership:2026-10'], cents: 9600 + 3000, title: 'Northville Pickleball should have charged you $126', line: '2 games x $48 = $96, plus membership $30' });
    expect((await mark(w, a[0].keys, a[0].cents)).status).toBe(200);
    const lines = await paidLines(w);
    expect(lines).toHaveLength(1);
    expect(activityText(lines[0], TZ, 'Alex')).toBe('Venue charge marked paid: $126');
    expect((await dash(w)).venueAlerts).toEqual([]);
  });
  it('months stack separately until each is marked paid', async () => {
    const w = await setup();
    await book(w, '2026-11-03');
    await jump(w, est(12, 1, 8));
    const n = (await dash(w)).venueAlerts;
    expect(n.map((x: any) => x.keys.join('+'))).toEqual(['court:2026-10', 'membership:2026-11', 'court:2026-11']);
    expect((await mark(w, ['membership:2026-11'], 3000)).status).toBe(200);
    expect((await dash(w)).venueAlerts.map((x: any) => x.keys.join('+'))).toEqual(['court:2026-10', 'court:2026-11']);
  });
  it('Mark paid moves no money and touches no game: no payment, credit or seat row changes', async () => {
    const w = await setup();
    const snap = () => JSON.stringify(['session_players', 'credit_ledger', 'refund_requests'].map((t) => raw(w).prepare(`SELECT * FROM ${t}`).all()));
    const before = snap();
    await mark(w, ['court:2026-10'], 9600);
    expect(snap()).toBe(before);
  });
});

describe('no backfill', () => {
  it('turned on late (Nov 20): October and the Nov 26 membership of an earlier month never appear; Nov 30 does', async () => {
    const w = await world();
    await booked(w, ['2026-10-27', '2026-10-29', '2026-11-03', '2026-11-05']);
    await jump(w, est(11, 20, 9));
    await on(w);
    expect((await dash(w)).venueAlerts).toEqual([]);
    await jump(w, est(11, 26, 9));
    expect((await dash(w)).venueAlerts.map((x: any) => x.keys.join('+'))).toEqual(['membership:2026-11']);
    await jump(w, est(11, 30, 9));
    const n = (await dash(w)).venueAlerts;
    expect(n.map((x: any) => x.keys.join('+'))).toEqual(['membership:2026-11', 'court:2026-11']);
    // November's period is Nov 1 to Nov 30: the two November games only, not October's.
    expect(n[1].line).toBe('2 games x $48 = $96');
  });
  it('turning it off and on again moves the start to the second turn-on (nothing in between ever comes back)', async () => {
    const w = await world();
    await booked(w, ['2026-10-27', '2026-10-29']);
    w.app.now = edt(10, 14, 9);
    await on(w);
    await jump(w, edt(11, 2, 9));
    expect((await dash(w)).venueAlerts.map((x: any) => x.keys.join('+'))).toEqual(['membership:2026-10', 'court:2026-10']);
    await w.organizer.call('PUT', '/api/admin/venue-alert-switch', { on: false });
    await on(w);
    expect((await dash(w)).venueAlerts).toEqual([]);
  });
  it('the private link has no row: it starts when that phone first opened the link (sent by the phone), never before, never later than now', async () => {
    const w = await world();
    await booked(w, ['2026-10-27', '2026-10-29']);
    w.app.now = edt(10, 31, 12);
    const since = (ms: number) => ({ [VENUE_ALERT.header]: 'on', [VENUE_ALERT.sinceHeader]: String(ms) });
    expect((await dash(w, { [VENUE_ALERT.header]: 'on' })).venueAlerts).toEqual([]); // no "since": starts now
    expect((await dash(w, since(w.app.now + DAY))).venueAlerts).toEqual([]); // a future time is not trusted
    expect((await dash(w, since(Date.parse('2026-10-01T12:00:00Z')))).venueAlerts.map((x: any) => x.keys.join('+'))).toEqual(['membership:2026-10', 'court:2026-10']);
    expect((await dash(w, since(edt(10, 30, 23, 0)))).venueAlerts.map((x: any) => x.keys.join('+'))).toEqual(['court:2026-10']);
    // Opened exactly at 12:00 AM on the charge day counts (the card starts at midnight); one minute later does not.
    expect((await dash(w, since(edt(10, 31, 0, 0)))).venueAlerts.map((x: any) => x.keys.join('+'))).toEqual(['court:2026-10']);
    expect((await dash(w, since(edt(10, 31, 0, 1)))).venueAlerts).toEqual([]);
  });
});

describe('review fixes: moved days, a repeated "on", a $0 amount', () => {
  it('moving a charge day after the switch is on never brings back a day that already passed (and never re-bills a marked month)', async () => {
    const w = await world();
    w.app.now = edt(10, 26, 13);
    await on(w);
    await booked(w, ['2026-10-27', '2026-10-29']);
    await jump(w, edt(10, 31, 8));
    expect((await mark(w, ['court:2026-10'], 9600)).status).toBe(200);
    await jump(w, est(11, 27, 9));
    expect((await dash(w)).venueAlerts.map((x: any) => x.keys.join('+'))).toEqual(['membership:2026-11']);
    // Nov 27: the membership day is moved to the 10th and the courts to the 4th. Both already passed: nothing appears for them (not the 4th's courts,
    // whose new period would re-bill October's games, and not a second membership).
    expect((await w.organizer.call('PUT', '/api/admin/group', { venueDays: { membershipDay: 10, courtDay: 4 } })).status).toBe(200);
    expect((await dash(w)).venueAlerts).toEqual([]);
    // A later save of anything else keeps that start; so does picking the same day again.
    await w.organizer.call('PUT', '/api/admin/group', { settings: { pricePerPlayerCents: 1500 } });
    await w.organizer.call('PUT', '/api/admin/group', { venueDays: { membershipDay: 10 } });
    expect((await dash(w)).venueAlerts).toEqual([]);
    // A day that is still ahead works: move courts to the 28th, and on the 28th the card is there.
    await jump(w, est(11, 27, 10));
    await w.organizer.call('PUT', '/api/admin/group', { venueDays: { membershipDay: 28, courtDay: 28 } });
    expect((await dash(w)).venueAlerts).toEqual([]);
    await jump(w, est(11, 28, 0, 1));
    const a = (await dash(w)).venueAlerts;
    expect(a).toHaveLength(1);
    // The courts period for the 28th would start Oct 29 and re-bill the Oct 29 game, which October's paid courts charge (Oct 31) already covered: it
    // starts the day after that charge (Nov 1) instead, so no court card.
    expect(a[0].kinds).toEqual(['membership']);
    expect((await w.organizer.call('GET', '/api/admin/dashboard')).data.venueDays).toEqual({ membershipDay: 28, courtDay: 28 });
  });
  it('a second "on" while it is already on changes nothing: the start does not move, a still-unpaid card stays, one Activity line', async () => {
    const w = await world();
    w.app.now = edt(10, 14, 9);
    await on(w);
    await jump(w, est(11, 27, 9));
    expect((await dash(w)).venueAlerts.map((x: any) => x.keys.join('+'))).toEqual(['membership:2026-10', 'membership:2026-11']);
    expect((await on(w)).status).toBe(200);
    expect((await dash(w)).venueAlerts.map((x: any) => x.keys.join('+'))).toEqual(['membership:2026-10', 'membership:2026-11']);
    const lines = ((await w.organizer.call('GET', '/api/admin/activity')).data.entries as any[]).filter((e) => e.action === 'venue_alert_on');
    expect(lines).toHaveLength(1);
  });
  it('a $0 membership makes no card; courts that add up to $0 make none either', async () => {
    const w = await world();
    await w.organizer.call('PUT', '/api/admin/group', { settings: { monthlyMembershipCents: 0, typicalCourtCostCents: 0 } });
    w.app.now = edt(10, 14, 9);
    await on(w);
    await booked(w, ['2026-10-27']);
    await jump(w, edt(11, 1, 8));
    expect((await dash(w)).venueAlerts).toEqual([]);
  });
});

describe('Money > Totals', () => {
  const rw = { [MONEY_REWORK_HEADER]: 'on' };
  it('a finished month: the card total equals Totals "Court costs" (same per-game cost, same whole dollars)', async () => {
    const w = await world();
    await on(w);
    const ids = await booked(w, ['2026-10-27', '2026-10-29']);
    for (const [i, id] of ids.entries()) {
      const names = ['Blair', 'Casey', 'Devon', 'Emery'];
      for (const n of names) await (await playerPhone(w, n)).call('POST', `/api/sessions/${id}/join`, {});
      const sv = (await dash(w)).sessions.find((s: any) => s.id === id);
      for (const n of names) {
        const r = sv.roster.find((x: any) => x.name === n);
        expect((await w.organizer.call('POST', `/api/admin/sessions/${id}/payment`, { playerId: r.playerId, paid: true, seen: r.moneySeen, cents: r.owesCents })).status).toBe(200);
      }
      w.app.now = Math.max(w.app.now, Date.parse(sv.endsAt) + HOUR);
      const f = await w.organizer.call('POST', `/api/admin/sessions/${id}/finalize`, { everyone: true });
      expect(f.status, `${i} ${f.text}`).toBe(200);
    }
    w.app.now = edt(10, 31, 8);
    const card = (await dash(w)).venueAlerts[0];
    const totals = (await w.organizer.call('GET', '/api/admin/money?month=2026-10', undefined, rw)).data as MonthlyMoney;
    expect(totals.rework!.courtSessions).toBe(2);
    expect(card.cents).toBe(totals.rework!.courtCostCents);
    expect(card.cents).toBe(9600);
  });
  it('known difference, written down: a Booked game not finalized yet counts on the alert (the venue charges it) but not in Totals, which waits for Finalize', async () => {
    const w = await world();
    await on(w);
    await booked(w, ['2026-10-27', '2026-10-29']);
    w.app.now = edt(10, 31, 8);
    const card = (await dash(w)).venueAlerts[0];
    const totals = (await w.organizer.call('GET', '/api/admin/money?month=2026-10', undefined, rw)).data as MonthlyMoney;
    expect(card.cents).toBe(9600);
    expect(totals.rework!.courtCostCents).toBe(0);
  });
});

describe('Home badge', () => {
  it('each Venue card counts like the other money alerts', () => {
    const base = { now: '2026-10-31T12:00:00.000Z', sessions: [], refundRequests: [], paymentClaims: [], group: { timezone: TZ, settings: { checkInHours: 24 } } } as any;
    expect(homeBadgeCount(base)).toBe(0);
    expect(homeBadgeCount({ ...base, venueAlerts: [{ keys: ['court:2026-10'] }, { keys: ['membership:2026-10'] }] })).toBe(2);
    expect(homeBadgeCount({ ...base, venueAlerts: undefined })).toBe(0);
  });
});

describe('the preview and wrangler', () => {
  it('the preview database has the row ON, back-dated to the 1st of last month so there is a card to tap', async () => {
    const { BUILDING_ON, smallSwitchRows } = await import('../scripts/preview-world-small');
    expect([...BUILDING_ON]).toContain(VENUE_ALERT.task);
    const sql = smallSwitchRows(Date.parse('2026-11-14T15:00:00Z'));
    const row = sql.split('\n').find((l) => l.includes(`'preview-${VENUE_ALERT.task}'`))!;
    expect(row).toContain("'2026-10-01T");
    expect(row.startsWith('INSERT')).toBe(true);
  });
  it('wrangler.toml adds NO variable for it (Cloudflare free plan: 64 variables per site, the preview was already at 64); a missing value means allowed', async () => {
    const toml = (await import('node:fs')).readFileSync('wrangler.toml', 'utf8');
    expect(toml.match(/^VENUE_ALERT\s*=/gm)).toBeNull();
    const { venueAlertAllowed } = await import('../shared/venueAlert');
    expect(venueAlertAllowed(undefined)).toBe(true);
    expect(venueAlertAllowed('off')).toBe(false);
    // Variables in [vars] and [env.preview.vars]: never more than main's own count (53 and 59) plus nothing from this zip.
    const count = (header: string) => {
      const start = toml.indexOf(`[${header}]`);
      const rest = toml.slice(start + header.length + 2);
      const end = rest.search(/^\[/m);
      return (end < 0 ? rest : rest.slice(0, end)).split('\n').filter((l) => /^[A-Z0-9_]+\s*=/.test(l)).length;
    };
    expect(count('vars')).toBe(53);
    expect(count('env.preview.vars')).toBe(59);
  });
});
