// Zip 23: "Totals refresh" (TOTALS_REFRESH, ships OFF). Organizer only, display only.
// The page works out ONE new number (the cost per court) and the month rows; every other figure is the server's, untouched.
import { describe, expect, it } from 'vitest';
import type { MonthlyMoney } from '../shared/api';
import { activityText } from '../shared/activity';
import { MONEY_REWORK_HEADER } from '../shared/moneyRework';
import { dollarsText, monthRowOf, pastMonths, perCourtDollars, projectedCard, soFarCard, TOTALS_REFRESH, totalsRefreshAllowed } from '../shared/totalsRefresh';
import { firstSession, HOUR, playerPhone, setupGroup, TestApp } from './harness';

type Rework = NonNullable<MonthlyMoney['rework']>;
const rw = { [MONEY_REWORK_HEADER]: 'on' };

/** The mock's own November numbers (mockups/totals_mock.html), in cents. */
const MOCK: Rework = {
  courtSessions: 2,
  courtCostCents: 9600,
  membershipCents: 3000,
  owedToVenueCents: 12600,
  collectedCents: 8400,
  yourCostCents: 4200,
  yourCostCourtCents: 1200,
  yourCostMembershipCents: 3000,
  projected: { courtCount: 7, addedCourts: 5, courtCostCents: 33600, membershipCents: 3000, totalCents: 36600, playersPayCents: 29400, yourCostCents: 7200, yourCostCourtCents: 4200, yourCostMembershipCents: 3000 },
};

describe('cost per court: the one new number', () => {
  it("the mock's numbers: So far $42 over 2 games is $21, Projected $72 over 7 games is $10", () => {
    const so = soFarCard(MOCK);
    const pj = projectedCard(MOCK);
    expect(so).toEqual({ membershipCents: 3000, courtCents: 9600, games: 2, owedCents: 12600, playersCents: 8400, netCents: 4200 });
    expect(pj).toEqual({ membershipCents: 3000, courtCents: 33600, games: 7, owedCents: 36600, playersCents: 29400, netCents: 7200 });
    expect(perCourtDollars(so.netCents, so.games)).toBe(21);
    expect(perCourtDollars(pj.netCents, pj.games)).toBe(10);
  });
  it('0 games: nothing to show (null), never NaN, never $0/court; a bad number is also null', () => {
    expect(perCourtDollars(3000, 0)).toBeNull();
    expect(perCourtDollars(0, 0)).toBeNull();
    expect(perCourtDollars(3000, -1)).toBeNull();
    expect(perCourtDollars(Number.NaN, 2)).toBeNull();
    expect(perCourtDollars(3000, Number.NaN)).toBeNull();
    expect(perCourtDollars(Infinity, 2)).toBeNull();
  });
  it('1 game: the whole net cost ($36 net is $36/court, the Oct sample)', () => {
    expect(perCourtDollars(3600, 1)).toBe(36);
    expect(perCourtDollars(0, 1)).toBe(0);
  });
  it('rounds to the nearest whole dollar, halves up (never a cents figure)', () => {
    expect(perCourtDollars(7200, 7)).toBe(10); // 10.28
    expect(perCourtDollars(3000, 7)).toBe(4); // 4.29
    expect(perCourtDollars(3300, 2)).toBe(17); // 16.50 up
    expect(perCourtDollars(3250, 2)).toBe(16); // 16.25 down
    expect(perCourtDollars(3260, 2)).toBe(16); // 16.30
    expect(perCourtDollars(4999, 1)).toBe(50);
    expect(perCourtDollars(1, 3)).toBe(0); // a fraction of a cent: $0, and with games that is a real $0
    expect(Number.isInteger(perCourtDollars(12345, 7)!)).toBe(true);
  });
  it('a credit (players paid more than the venue is owed) is a negative number of dollars, rounded on its size; a credit that rounds to $0 is not -0', () => {
    expect(perCourtDollars(-1200, 2)).toBe(-6);
    expect(perCourtDollars(-50, 1)).toBe(-1); // $0.50 credit rounds up like a cost
    expect(perCourtDollars(-49, 1)).toBe(0);
    expect(Object.is(perCourtDollars(-49, 1), -0)).toBe(false);
    expect(dollarsText(-6)).toBe('$6');
    expect(dollarsText(21)).toBe('$21');
    expect(dollarsText(1234)).toBe('$1234'); // no commas, like formatPrice ("$1234")
  });
  it('a credit card: the net goes below $0 here although the server stops at $0 (so the page can say credit)', () => {
    const credit: Rework = { ...MOCK, courtSessions: 1, courtCostCents: 4800, membershipCents: 0, owedToVenueCents: 4800, collectedCents: 4900, yourCostCents: 0, yourCostCourtCents: 0, yourCostMembershipCents: 0 };
    const c = soFarCard(credit);
    expect(c.netCents).toBe(-100);
    expect(perCourtDollars(c.netCents, c.games)).toBe(-1);
  });
  it('month rows: games, net and per court from one past month; "No games" is a null per court', () => {
    expect(monthRowOf('2026-10', { ...MOCK, courtSessions: 1, courtCostCents: 4800, owedToVenueCents: 7800, collectedCents: 4200 })).toEqual({ month: '2026-10', games: 1, netCents: 3600, perCourt: 36 });
    expect(monthRowOf('2026-09', { ...MOCK, courtSessions: 0, courtCostCents: 0, membershipCents: 3000, owedToVenueCents: 3000, collectedCents: 0 })).toEqual({ month: '2026-09', games: 0, netCents: 3000, perCourt: null });
  });
  it('past months: only those before the current one, newest first as given', () => {
    const choices = [{ month: '2026-12' }, { month: '2026-11' }, { month: '2026-10' }, { month: '2026-09' }];
    expect(pastMonths(choices, '2026-11')).toEqual(['2026-10', '2026-09']);
    expect(pastMonths(choices, '2026-09')).toEqual([]);
    expect(pastMonths([{ month: '2026-11' }], '2026-11')).toEqual([]);
  });
  it('the kill switch: allowed unless it says off', () => {
    expect(totalsRefreshAllowed(undefined)).toBe(true);
    expect(totalsRefreshAllowed('on')).toBe(true);
    expect(totalsRefreshAllowed(' OFF ')).toBe(false);
  });
});

async function world() {
  const app = new TestApp();
  const w = await setupGroup(app);
  await w.organizer.call('PUT', '/api/admin/group', { organizerName: 'Alex' });
  return w;
}
type W = Awaited<ReturnType<typeof world>>;
const dash = async (w: W, headers: Record<string, string> = {}) => (await w.organizer.call('GET', '/api/admin/dashboard', undefined, headers)).data;
const money = async (w: W, month: string) => (await w.organizer.call('GET', `/api/admin/money?month=${month}`, undefined, rw)).data as MonthlyMoney;
const monthOf = (ms: number) => new Date(ms - 5 * HOUR).toISOString().slice(0, 7);

describe('the switch: off by default, a Settings row, a private link, a kill switch', () => {
  it('off: no Totals refresh field anywhere on the dashboard', async () => {
    const w = await world();
    const d = await dash(w);
    expect(d.totalsRefresh).toBeUndefined();
    expect(d.totalsRefreshForAll).toBeUndefined();
    expect(JSON.stringify(d)).not.toMatch(/totalsRefresh/);
  });
  it('the Settings row turns it on for every organizer phone, with an Activity line; the kill switch beats it; the private link works alone', async () => {
    const w = await world();
    expect((await w.organizer.call('PUT', '/api/admin/totals-refresh-switch', { on: true })).status).toBe(200);
    let d = await dash(w);
    expect(d.totalsRefresh).toBe(true);
    expect(d.totalsRefreshForAll).toBe(true);
    const act = (await w.organizer.call('GET', '/api/admin/activity')).data.entries.find((e: any) => e.action === 'totals_refresh_on');
    expect(act).toBeDefined();
    expect(activityText(act, 'America/Detroit', 'Alex')).toContain('switched "Totals refresh" on');
    (w.app.env as unknown as Record<string, unknown>).TOTALS_REFRESH = 'off';
    d = await dash(w);
    expect(d.totalsRefresh).toBeUndefined();
    expect(d.totalsRefreshForAll).toBe(true);
    expect((await dash(w, { [TOTALS_REFRESH.header]: 'on' })).totalsRefresh).toBeUndefined();
    (w.app.env as unknown as Record<string, unknown>).TOTALS_REFRESH = undefined;
    expect((await w.organizer.call('PUT', '/api/admin/totals-refresh-switch', { on: false })).status).toBe(200);
    d = await dash(w);
    expect(d.totalsRefresh).toBeUndefined();
    expect((await w.organizer.call('GET', '/api/admin/activity')).data.entries.some((e: any) => e.action === 'totals_refresh_off')).toBe(true);
    d = await dash(w, { [TOTALS_REFRESH.header]: 'on' });
    expect(d.totalsRefresh).toBe(true);
    expect(d.totalsRefreshForAll).toBeUndefined();
  });
  it('a player cannot flip it, and a player answer never carries it', async () => {
    const w = await world();
    const ph = await playerPhone(w, 'Blair');
    expect((await ph.call('PUT', '/api/admin/totals-refresh-switch', { on: true })).status).toBe(401);
    await w.organizer.call('PUT', '/api/admin/totals-refresh-switch', { on: true });
    expect(JSON.stringify((await ph.call('GET', '/api/group', undefined, { [TOTALS_REFRESH.header]: 'on' })).data)).not.toMatch(/totalsRefresh/);
  });
  it('the switch adds no money: turning it on changes nothing in the Totals answer', async () => {
    const w = await world();
    const month = monthOf(w.app.now);
    const before = await money(w, month);
    await w.organizer.call('PUT', '/api/admin/totals-refresh-switch', { on: true });
    expect(await money(w, month)).toEqual(before);
  });
});

describe('the cards agree with the server (one finalized game)', () => {
  it('So far: total = owed minus players paid = "Your cost so far"; the per-court figure is that total over the games counted', async () => {
    const w = await world();
    const s0 = await firstSession(w);
    await w.organizer.call('POST', `/api/admin/sessions/${s0.id}/booked`, {});
    for (const n of ['Blair', 'Casey', 'Devon', 'Emery']) await (await playerPhone(w, n)).call('POST', `/api/sessions/${s0.id}/join`, {});
    const sv = (await dash(w)).sessions.find((s: any) => s.id === s0.id);
    for (const n of ['Blair', 'Casey', 'Devon', 'Emery']) {
      const r = sv.roster.find((x: any) => x.name === n);
      const res = await w.organizer.call('POST', `/api/admin/sessions/${s0.id}/payment`, { playerId: r.playerId, paid: true, seen: r.moneySeen, cents: r.owesCents });
      expect(res.status, res.text).toBe(200);
    }
    w.app.now = Date.parse(s0.endsAt) + HOUR;
    expect((await w.organizer.call('POST', `/api/admin/sessions/${s0.id}/finalize`, { everyone: true })).status).toBe(200);
    const m = await money(w, monthOf(Date.parse(s0.startsAt)));
    const t = m.rework!;
    const so = soFarCard(t);
    expect(so.games).toBe(t.courtSessions);
    expect(so.games).toBe(1);
    expect(so.owedCents).toBe(so.membershipCents + so.courtCents);
    expect(so.netCents).toBe(t.yourCostCents);
    expect(perCourtDollars(so.netCents, so.games)).toBe(Math.round(t.yourCostCents / 100));
    const pj = projectedCard(t);
    expect(pj.games).toBe(t.projected.courtCount);
    expect(pj.owedCents).toBe(pj.membershipCents + pj.courtCents);
    expect(pj.netCents).toBe(t.projected.yourCostCents);
    // Every one of the page's four rows is the server's number as it is.
    expect([so.membershipCents, so.courtCents, so.owedCents, so.playersCents]).toEqual([t.membershipCents, t.courtCostCents, t.owedToVenueCents, t.collectedCents]);
  });
  it('a month with no games: membership only, no per-court figure ("No games"); a month before the membership: $0 and no per-court figure', async () => {
    const w = await world();
    const cur = monthOf(w.app.now); // 2026-10: the membership month, no game finalized yet
    const row = monthRowOf(cur, (await money(w, cur)).rework!);
    expect(row).toEqual({ month: cur, games: 0, netCents: 3000, perCourt: null });
    const early = monthRowOf('2026-03', (await money(w, '2026-03')).rework!);
    expect(early.games).toBe(0);
    expect(early.perCourt).toBeNull();
  });
  it('Projected 0 games: no per-court figure either', async () => {
    const w = await world();
    const t = (await money(w, '2026-03')).rework!;
    expect(projectedCard(t).games).toBe(0);
    expect(perCourtDollars(projectedCard(t).netCents, projectedCard(t).games)).toBeNull();
  });
});

describe('the preview', () => {
  it('the preview database has the row ON (PREVIEW SWITCHES RULE)', async () => {
    const { BUILDING_ON, smallSwitchRows } = await import('../scripts/preview-world-small');
    expect([...BUILDING_ON]).toContain(TOTALS_REFRESH.task);
    expect(smallSwitchRows(Date.parse('2026-11-09T15:00:00Z'))).toContain(`'preview-${TOTALS_REFRESH.task}'`);
  });
  it('wrangler.toml allows it on live and on previews', async () => {
    const toml = (await import('node:fs')).readFileSync('wrangler.toml', 'utf8');
    const [live, preview] = toml.split('[env.preview]');
    expect(live).toMatch(/^TOTALS_REFRESH = "on"$/m);
    expect(preview).toMatch(/^TOTALS_REFRESH = "on"$/m);
  });
});
