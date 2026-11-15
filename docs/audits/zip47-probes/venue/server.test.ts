// Zip 47 audit probes (read-only audit): the Venue charge alert through the real server (tests/harness.ts), fake clock, Eastern.
import { describe, expect, it } from 'vitest';
import { VENUE_ALERT } from '../../../shared/venueAlert';
import { PIN, playerPhone, setupGroup, TestApp } from '../../harness';

const TZ = 'America/Detroit';
const RO_PIN = '58302917';
const edt = (m: number, d: number, h = 12, min = 0) => Date.UTC(2026, m - 1, d, h + 4, min);
const est = (m: number, d: number, h = 12, min = 0, y = 2026) => Date.UTC(y, m - 1, d, h + 5, min);

async function world() {
  const app = new TestApp();
  const w = await setupGroup(app);
  await w.organizer.call('PUT', '/api/admin/group', { organizerName: 'Alex' });
  return w;
}
type W = Awaited<ReturnType<typeof world>>;
const raw = (w: W) => (w.app.db as unknown as { raw: { prepare: (s: string) => { run: (...a: unknown[]) => unknown; get: (...a: unknown[]) => any; all: (...a: unknown[]) => any[] } } }).raw;
const dash = async (w: W, headers: Record<string, string> = {}) => (await w.organizer.call('GET', '/api/admin/dashboard', undefined, headers)).data;
const on = (w: W) => w.organizer.call('PUT', '/api/admin/venue-alert-switch', { on: true });
const off = (w: W) => w.organizer.call('PUT', '/api/admin/venue-alert-switch', { on: false });
const mark = (w: W, keys: string[], cents: number) => w.organizer.call('POST', '/api/admin/venue-alert/paid', { keys, cents });
const day = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(iso));
const keysOf = (a: any[]) => a.map((x: any) => x.keys.join('+'));
const paidLines = async (w: W) => ((await w.organizer.call('GET', '/api/admin/activity')).data.entries as any[]).filter((e) => e.action === 'venue_charge_paid');
const paidRows = (w: W) => raw(w).prepare("SELECT COUNT(*) AS n FROM task_log WHERE task LIKE 'venue_paid:%'").get().n as number;
const jump = async (w: W, ms: number) => {
  w.app.now = ms;
  expect((await w.organizer.call('POST', '/api/admin/login', { pin: PIN })).status).toBe(200);
  await dash(w); // lets the site add the next weeks' games
};
/** Book every game on these Eastern dates straight in the database (the court switch refuses a game that is over). */
function bookRaw(w: W, dates: string[]) {
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
const gameDates = (w: W) => (raw(w).prepare('SELECT starts_at FROM sessions ORDER BY starts_at').all() as { starts_at: string }[]).map((r) => day(r.starts_at));

describe('P-S01 who can call the routes', () => {
  it('read-only PIN: every venue write is refused 403 and nothing changes; it can still SEE the cards', async () => {
    const w = await world();
    w.app.env.ORGANIZER_READONLY_PIN = RO_PIN;
    await on(w);
    bookRaw(w, ['2026-10-27', '2026-10-29']);
    w.app.now = edt(10, 31, 8);
    const ro = w.app.client();
    expect((await ro.call('POST', '/api/admin/login', { pin: RO_PIN })).status).toBe(200);
    const before = JSON.stringify([raw(w).prepare('SELECT * FROM task_log ORDER BY id').all(), raw(w).prepare('SELECT settings_json FROM groups').all()]);
    expect((await ro.call('PUT', '/api/admin/venue-alert-switch', { on: false })).status).toBe(403);
    expect((await ro.call('POST', '/api/admin/venue-alert/paid', { keys: ['court:2026-10'], cents: 9600 })).status).toBe(403);
    expect((await ro.call('PUT', '/api/admin/group', { venueDays: { courtDay: 5 } })).status).toBe(403);
    expect((await ro.call('POST', '/api/admin/venue-alert/paid', { keys: ['court:2026-10'], cents: 9600 }, { [VENUE_ALERT.header]: 'on' })).status).toBe(403);
    const after = JSON.stringify([raw(w).prepare('SELECT * FROM task_log ORDER BY id').all(), raw(w).prepare('SELECT settings_json FROM groups').all()]);
    expect(after).toBe(before);
    const d = (await ro.call('GET', '/api/admin/dashboard')).data;
    expect(keysOf(d.venueAlerts)).toEqual(['court:2026-10']);
  });
  it('a player phone and a phone with no sign-in: 401 on the switch, Mark paid and the days save', async () => {
    const w = await world();
    const ph = await playerPhone(w, 'Blair');
    const anon = w.app.client();
    for (const c of [ph, anon]) {
      expect((await c.call('PUT', '/api/admin/venue-alert-switch', { on: true })).status).toBe(401);
      expect((await c.call('POST', '/api/admin/venue-alert/paid', { keys: ['court:2026-10'], cents: 100 }, { [VENUE_ALERT.header]: 'on' })).status).toBe(401);
      expect((await c.call('PUT', '/api/admin/group', { venueDays: { courtDay: 5 } })).status).toBe(401);
    }
    expect(raw(w).prepare("SELECT COUNT(*) AS n FROM task_log WHERE task LIKE 'venue%'").get().n).toBe(0);
  });
});

describe('P-S02 DST: a charge day on Sun Nov 1 2026 (fall back), midnight Eastern = 04:00 UTC', () => {
  it('courts on the 1st: nothing at 11:59 PM Oct 31 EDT, card at 12:00 AM Nov 1 with the Oct 2 - Nov 1 games', async () => {
    const w = await world();
    await w.organizer.call('PUT', '/api/admin/group', { venueDays: { courtDay: 1, membershipDay: 1 } });
    await on(w); // Oct 26 noon
    bookRaw(w, ['2026-10-27', '2026-10-29']);
    w.app.now = Date.parse('2026-11-01T03:59:00.000Z');
    expect((await dash(w)).venueAlerts).toEqual([]);
    w.app.now = Date.parse('2026-11-01T04:00:00.000Z');
    const a = (await dash(w)).venueAlerts;
    expect(keysOf(a)).toEqual(['court:2026-11+membership:2026-11']);
    expect(a[0]).toMatchObject({ cents: 9600 + 3000, line: '2 games x $48 = $96, plus membership $30' });
  });
});

describe('P-S03 Mark paid twice', () => {
  it('a combined card: two at once (Promise.all), then a third: one History line, exactly two rows', async () => {
    const w = await world();
    await w.organizer.call('PUT', '/api/admin/group', { venueDays: { membershipDay: 31, courtDay: 0 } });
    await on(w);
    bookRaw(w, ['2026-10-27', '2026-10-29']);
    w.app.now = edt(10, 31, 8);
    const card = (await dash(w)).venueAlerts[0];
    expect(card.keys).toEqual(['court:2026-10', 'membership:2026-10']);
    const rs = await Promise.all([mark(w, card.keys, card.cents), mark(w, [...card.keys].reverse(), card.cents), mark(w, card.keys, card.cents)]);
    expect(rs.map((r) => r.status)).toEqual([200, 200, 200]);
    expect(rs.filter((r) => r.data.already === false)).toHaveLength(1);
    expect((await mark(w, card.keys, card.cents)).data.already).toBe(true);
    expect(await paidLines(w)).toHaveLength(1);
    expect(paidRows(w)).toBe(2);
  });
  it('switch off: Mark paid refused 409 and writes nothing', async () => {
    const w = await world();
    await on(w);
    bookRaw(w, ['2026-10-27']);
    w.app.now = edt(10, 31, 8);
    await off(w);
    expect((await mark(w, ['court:2026-10'], 4800)).status).toBe(409);
    expect(paidRows(w)).toBe(0);
  });
});

describe('P-S04 FINDING: marking a LATER court month paid makes an OLDER unpaid court card vanish, and it can then never be marked', () => {
  it('Oct and Nov court cards; Mark paid on November first -> October gone; Mark paid on October -> 409', async () => {
    const w = await world();
    await w.organizer.call('PUT', '/api/admin/group', { settings: { monthlyMembershipCents: 0 } });
    await on(w); // Mon Oct 26 noon
    bookRaw(w, ['2026-10-27', '2026-10-29', '2026-11-03']);
    await jump(w, est(12, 1, 8));
    const a = (await dash(w)).venueAlerts;
    expect(keysOf(a)).toEqual(['court:2026-10', 'court:2026-11']);
    const nov = a.find((x: any) => x.keys[0] === 'court:2026-11');
    expect(nov.cents).toBe(4800);
    expect((await mark(w, nov.keys, nov.cents)).status).toBe(200);
    // Rule: "A card stays until Mark paid". Actual: October's $96 card is gone without being marked.
    const left = (await dash(w)).venueAlerts;
    expect(keysOf(left)).toEqual([]);
    // And the organizer who still has the October card on screen cannot mark it: "That charge just changed. Look again."
    const r = await mark(w, ['court:2026-10'], 9600);
    expect(r.status).toBe(409);
    expect(r.data.error ?? r.text).toMatch(/changed/);
    expect(await paidLines(w)).toHaveLength(1);
  });
});

describe('P-S05 Mark paid for a month, then move the court day', () => {
  it('court 15th: Nov 15 marked paid; on Nov 16 moved to Last day -> no Nov 30 card; Dec 31 card bills Dec only (games Nov 16-30 are on no card)', async () => {
    const w = await world();
    await w.organizer.call('PUT', '/api/admin/group', { venueDays: { courtDay: 15 }, settings: { monthlyMembershipCents: 0 } });
    await on(w);
    await jump(w, est(11, 10, 9));
    const dates = gameDates(w);
    const nov = dates.filter((d) => d >= '2026-10-27' && d <= '2026-11-15');
    bookRaw(w, nov);
    await jump(w, est(11, 15, 9));
    const c = (await dash(w)).venueAlerts;
    expect(keysOf(c)).toEqual(['court:2026-11']);
    expect((await mark(w, c[0].keys, c[0].cents)).status).toBe(200);
    await jump(w, est(11, 16, 9));
    expect((await w.organizer.call('PUT', '/api/admin/group', { venueDays: { courtDay: 0 } })).status).toBe(200);
    await jump(w, est(11, 20, 9));
    const late = gameDates(w).filter((d) => d >= '2026-11-16' && d <= '2026-11-30');
    expect(late.length).toBeGreaterThan(0);
    bookRaw(w, late);
    await jump(w, est(11, 30, 9));
    expect((await dash(w)).venueAlerts).toEqual([]); // court:2026-11 already paid
    await jump(w, est(12, 10, 9));
    const decGames = gameDates(w).filter((d) => d >= '2026-12-01' && d <= '2026-12-10');
    bookRaw(w, decGames);
    await jump(w, est(12, 31, 9));
    const d = (await dash(w)).venueAlerts;
    expect(keysOf(d)).toEqual(['court:2026-12']);
    expect(d[0].cents).toBe(decGames.length * 4800); // Nov 16-30 games never appear on any card
  });
  it('membership: Nov 26 paid, moved to the 28th on Nov 27 -> no second membership card in November', async () => {
    const w = await world();
    await on(w);
    await jump(w, est(11, 26, 9));
    const a = (await dash(w)).venueAlerts;
    const m = a.find((x: any) => x.keys[0] === 'membership:2026-11');
    expect((await mark(w, m.keys, m.cents)).status).toBe(200);
    await jump(w, est(11, 27, 9));
    await w.organizer.call('PUT', '/api/admin/group', { venueDays: { membershipDay: 28 } });
    await jump(w, est(11, 28, 9));
    expect(keysOf((await dash(w)).venueAlerts).filter((k) => k.includes('membership'))).toEqual([]);
  });
  it('move forward then back before the day: Nov 20 -> 28th, Nov 21 -> 26th: the Nov 26 card shows (both moves before the day)', async () => {
    const w = await world();
    await on(w);
    await jump(w, est(11, 20, 9));
    await w.organizer.call('PUT', '/api/admin/group', { venueDays: { membershipDay: 28 } });
    await jump(w, est(11, 21, 9));
    await w.organizer.call('PUT', '/api/admin/group', { venueDays: { membershipDay: 26 } });
    await jump(w, est(11, 26, 0, 0));
    expect(keysOf((await dash(w)).venueAlerts)).toEqual(['membership:2026-11']);
  });
  it('move back after the day passed (Nov 27: 28th -> 26th): November membership never shows (known: a day moved to a day already past)', async () => {
    const w = await world();
    await on(w);
    await jump(w, est(11, 20, 9));
    await w.organizer.call('PUT', '/api/admin/group', { venueDays: { membershipDay: 28 } });
    await jump(w, est(11, 27, 9));
    await w.organizer.call('PUT', '/api/admin/group', { venueDays: { membershipDay: 26 } });
    await jump(w, est(11, 30, 9));
    expect(keysOf((await dash(w)).venueAlerts).filter((k) => k.includes('membership'))).toEqual([]);
  });
});

describe('P-S06 switch off then on', () => {
  it('paid rows survive; no duplicate cards; no backfill of the gap; a second "on" changes nothing', async () => {
    const w = await world();
    await on(w);
    bookRaw(w, ['2026-10-27', '2026-10-29']);
    w.app.now = edt(10, 31, 8);
    expect((await mark(w, ['court:2026-10'], 9600)).status).toBe(200);
    await off(w);
    await jump(w, est(11, 27, 9)); // Nov 26 membership passed while off
    await on(w);
    await on(w);
    expect((await dash(w)).venueAlerts).toEqual([]);
    expect(paidRows(w)).toBe(1);
    expect(raw(w).prepare("SELECT COUNT(*) AS n FROM task_log WHERE task = 'venue_alert_on'").get().n).toBe(1);
    bookRaw(w, gameDates(w).filter((d) => d >= '2026-11-01' && d <= '2026-11-05'));
    await jump(w, est(11, 30, 9));
    const a = (await dash(w)).venueAlerts;
    expect(keysOf(a)).toEqual(['court:2026-11']);
  });
  it('the private link alone (row off): cards from the "since" time; Mark paid there is remembered when the row goes on later', async () => {
    const w = await world();
    bookRaw(w, ['2026-10-27', '2026-10-29']);
    w.app.now = edt(10, 31, 8);
    const link = { [VENUE_ALERT.header]: 'on', [VENUE_ALERT.sinceHeader]: String(edt(10, 26, 12)) };
    const a = (await dash(w, link)).venueAlerts;
    expect(keysOf(a)).toEqual(['court:2026-10']);
    expect((await w.organizer.call('POST', '/api/admin/venue-alert/paid', { keys: a[0].keys, cents: a[0].cents }, link)).status).toBe(200);
    // Row turned on Oct 1 by hand (back-dated) to see that the paid month is not shown again.
    raw(w).prepare("INSERT INTO task_log (id, group_id, session_id, task, kind, at) SELECT 'x1', id, NULL, 'venue_alert_on', 'mark', '2026-10-01T12:00:00.000Z' FROM groups").run();
    expect(keysOf((await dash(w)).venueAlerts)).toEqual(['membership:2026-10']);
  });
});
