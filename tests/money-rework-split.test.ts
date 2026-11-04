// Money page rework with the Late-cancel fee split ON (it went live Wed Nov 4): the new Totals after a fee-kept cancel with 5 or 6 in, Edit
// charge on that game, and the 5-minute clock around a game hidden from the lists. Admin only: nothing here changes a seat, payment or credit.
import { describe, expect, it } from 'vitest';
import { MONEY_REWORK_HEADER } from '../shared/moneyRework';
import { firstSession, HOUR, MONDAY_NOON, PIN, playerPhone, sentText, setupGroup, TestApp } from './harness';

const on = { [MONEY_REWORK_HEADER]: 'on' };

async function world() {
  const w = await setupGroup(new TestApp());
  await w.organizer.call('PUT', '/api/admin/group', { organizerName: 'Alex' });
  expect((await w.organizer.call('PUT', '/api/admin/late-fees', { on: true })).status).toBe(200);
  expect((await w.organizer.call('PUT', '/api/admin/late-fee-split', { on: true })).status).toBe(200);
  return w;
}
type W = Awaited<ReturnType<typeof world>>;
const monthOf = (ms: number) => new Date(ms).toISOString().slice(0, 7);
async function dash(w: W) {
  let r = await w.organizer.call('GET', '/api/admin/dashboard', undefined, on);
  if (r.status === 401) {
    await w.organizer.call('POST', '/api/admin/login', { pin: PIN });
    r = await w.organizer.call('GET', '/api/admin/dashboard', undefined, on);
  }
  expect(r.status, r.text).toBe(200);
  return r.data;
}
const money = async (w: W, month: string) => (await w.organizer.call('GET', `/api/admin/money?month=${month}`, undefined, on)).data;
const credit = (w: W) => w.app.db.raw.prepare('SELECT * FROM credit_ledger ORDER BY id').all();
const seats = (w: W) => w.app.db.raw.prepare('SELECT * FROM session_players ORDER BY session_id, player_id').all();

/** The organizer plus these players are in a booked game; the named ones paid $14. Then it is canceled 6 hours out with the fee kept. */
async function feeKept(others: string[], paid: string[]) {
  const w = await world();
  const s0 = await firstSession(w);
  await w.organizer.call('POST', `/api/admin/sessions/${s0.id}/booked`, {});
  for (const n of others) await (await playerPhone(w, n)).call('POST', `/api/sessions/${s0.id}/join`, {});
  await w.organizer.call('POST', `/api/admin/sessions/${s0.id}/me`, { in: true });
  const sv = (await dash(w)).sessions.find((s: any) => s.id === s0.id);
  for (const n of paid) {
    const r = sv.roster.find((x: any) => x.name === n);
    const res = await w.organizer.call('POST', `/api/admin/sessions/${s0.id}/payment`, { playerId: r.playerId, paid: true, seen: r.moneySeen, cents: r.owesCents });
    expect(res.status, res.text).toBe(200);
  }
  w.app.now = Date.parse(s0.startsAt) - 6 * HOUR;
  const c = await w.organizer.call('POST', `/api/admin/sessions/${s0.id}/decision`, { decision: 'cancel', confirm: true, venueWaived: false }, on);
  expect(c.status, c.text).toBe(200);
  return { w, s0, month: monthOf(Date.parse(s0.startsAt)) };
}
const nonNegative = (t: any) => {
  for (const v of [t.courtCostCents, t.membershipCents, t.owedToVenueCents, t.collectedCents, t.yourCostCents, t.yourCostCourtCents, t.yourCostMembershipCents, t.projected.courtCostCents, t.projected.playersPayCents, t.projected.yourCostCents, t.projected.yourCostCourtCents, t.projected.yourCostMembershipCents]) expect(v).toBeGreaterThanOrEqual(0);
};

describe('Totals after a fee-kept cancel with the split on', () => {
  it('X1 six in: each owes $9, the three who paid got $5 credit; court $48 once, collected $27, your cost $51', async () => {
    const { w, s0, month } = await feeKept(['Blair', 'Casey', 'Devon', 'Emery', 'Frankie'], ['Blair', 'Casey', 'Devon']);
    const d0 = await dash(w);
    const sv = d0.sessions.find((s: any) => s.id === s0.id);
    expect(sv.feeSplit).toMatchObject({ count: 6, priceCents: 900 });
    const by = (n: string) => sv.roster.find((r: any) => r.name === n);
    expect(by('Emery').owesCents).toBe(900);
    expect(by('Frankie').owesCents).toBe(900);
    // The $5 each of Blair, Casey and Devon got back is in their credit.
    const pot = (n: string) => ((d0.creditLedger as any[]).find((l) => l.playerId === by(n).playerId)?.balanceCents ?? 0);
    expect(['Blair', 'Casey', 'Devon'].map(pot)).toEqual([500, 500, 500]);
    expect(pot('Emery')).toBe(0);
    const m = await money(w, month);
    // Court: the venue charged $48, counted once. Collected: three seats kept $9 each. Credit owed: three $5.
    expect(m.rework).toMatchObject({ courtSessions: 1, courtCostCents: 4800, membershipCents: 3000, owedToVenueCents: 7800, collectedCents: 2700, yourCostCents: 5100, yourCostCourtCents: 2100, yourCostMembershipCents: 3000 });
    expect(m.creditsOwedCents).toBe(1500);
    // A canceled game adds nothing to the projection beyond what is already counted.
    expect(m.rework.projected).toMatchObject({ addedCourts: 0, courtCount: 1, courtCostCents: 4800, playersPayCents: 2700, yourCostCents: 5100 });
    nonNegative(m.rework);
    // The same game on the old page: same court and same collected (no double count, no new number).
    expect(m.courtCostCents).toBe(4800);
    expect(m.collectedCents).toBe(2700);
  });
  it('X2 five in: each owes $11, the two who paid got $3; collected $22, your cost $56', async () => {
    const { w, s0, month } = await feeKept(['Blair', 'Casey', 'Devon', 'Emery'], ['Blair', 'Casey']);
    const sv = (await dash(w)).sessions.find((s: any) => s.id === s0.id);
    expect(sv.feeSplit).toMatchObject({ count: 5, priceCents: 1100 });
    expect(sv.roster.find((r: any) => r.name === 'Devon').owesCents).toBe(1100);
    const m = await money(w, month);
    expect(m.rework).toMatchObject({ courtSessions: 1, courtCostCents: 4800, owedToVenueCents: 7800, collectedCents: 2200, yourCostCents: 5600, yourCostCourtCents: 2600, yourCostMembershipCents: 3000 });
    expect(m.creditsOwedCents).toBe(600);
    nonNegative(m.rework);
  });
  it('X3 Edit charge to No on that game: Totals drop the court AND what players paid; credit, seats and what is owed do not move', async () => {
    const { w, s0, month } = await feeKept(['Blair', 'Casey', 'Devon', 'Emery', 'Frankie'], ['Blair', 'Casey', 'Devon']);
    await dash(w);
    const creditBefore = JSON.stringify(credit(w));
    const seatsBefore = JSON.stringify(seats(w));
    const r = await w.organizer.call('POST', `/api/admin/sessions/${s0.id}/charge`, { charged: false }, on);
    expect(r.data).toMatchObject({ changed: true, chargedCents: 0 });
    const m = await money(w, month);
    expect(m.rework).toMatchObject({ courtSessions: 0, courtCostCents: 0, collectedCents: 0, owedToVenueCents: 3000, yourCostCents: 3000 });
    nonNegative(m.rework);
    // Nothing about the players moved: each still has their $5 credit, Emery and Frankie still owe $9.
    expect(JSON.stringify(credit(w))).toBe(creditBefore);
    expect(JSON.stringify(seats(w))).toBe(seatsBefore);
    const sv = (await dash(w)).sessions.find((s: any) => s.id === s0.id);
    expect(sv.roster.find((x: any) => x.name === 'Emery').owesCents).toBe(900);
    const ledger = (await dash(w)).creditLedger as any[];
    expect(ledger.filter((l) => l.balanceCents === 500)).toHaveLength(3);
    // The old page still counts it (Edit charge only moves the new Totals' view; the old numbers read the same charge, so they drop it too).
    // Yes again, with the usual court cost: back to the numbers above.
    await w.organizer.call('POST', `/api/admin/sessions/${s0.id}/charge`, { charged: true }, on);
    expect((await money(w, month)).rework).toMatchObject({ courtSessions: 1, courtCostCents: 4800, collectedCents: 2700, yourCostCents: 5100 });
    expect(JSON.stringify(credit(w))).toBe(creditBefore);
    expect(JSON.stringify(seats(w))).toBe(seatsBefore);
  });
  it('X4 a different amount: the court counts what the venue really charged', async () => {
    const { w, s0, month } = await feeKept(['Blair', 'Casey', 'Devon', 'Emery', 'Frankie'], ['Blair', 'Casey', 'Devon']);
    await w.organizer.call('POST', `/api/admin/sessions/${s0.id}/charge`, { charged: true, cents: 3600 }, on);
    expect((await money(w, month)).rework).toMatchObject({ courtCostCents: 3600, collectedCents: 2700, yourCostCents: 3600 + 3000 - 2700, yourCostCourtCents: 900 });
  });
});

describe('the 5-minute clock and a hidden game', () => {
  const TZ_HOURS = 5 * 60_000;
  async function run(hide: boolean) {
    const app = new TestApp();
    const sent: string[] = [];
    app.env = {
      ...app.env,
      SITE_URL: 'https://pickleball.juncaj.net',
      TELEGRAM_BOT_TOKEN: '123456:FAKE-test-token-never-real',
      TELEGRAM_CHAT_ID: '9988776655',
      CRON_SECRET: 'test-cron-secret-0123456789abcdef0123456789',
      GO_LINKS: 'on',
      TELEGRAM_FETCH: (async (_u: string, init: RequestInit) => {
        sent.push(sentText(JSON.parse(String(init.body))).replace(/\/go\/[A-Za-z0-9_.-]+/, '/go/TOKEN'));
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }) as typeof fetch,
    };
    const w = await setupGroup(app);
    await w.organizer.call('PUT', '/api/admin/money-rework', { on: true });
    app.now = MONDAY_NOON;
    const d = (await w.organizer.call('GET', '/api/admin/dashboard')).data;
    // An empty, not-booked game: nothing in it, so it has no money and may be hidden.
    const g = d.sessions.filter((s: any) => Date.parse(s.startsAt) > app.now && s.confirmedCount === 0 && s.bookingStatus !== 'booked')[2];
    if (hide) expect((await w.organizer.call('POST', `/api/admin/sessions/${g.id}/hide-from-list`, { hidden: true })).status).toBe(200);
    // Every tick for the two days around it (both the 7 AM and the 7 PM alerts of that day fall inside).
    const start = Date.parse(g.startsAt);
    app.now = start - 30 * HOUR;
    const statuses = new Set<number>();
    while (app.now <= start + 4 * HOUR) {
      const r = await w.organizer.call('POST', '/api/cron/tick', {}, { 'X-Cron-Secret': app.env.CRON_SECRET as string });
      await app.settle();
      statuses.add(r.status);
      app.now += TZ_HOURS;
    }
    return { sent, statuses, errors: 0 };
  }
  it('K1 every tick answers 200, and a hidden game gets exactly the alerts it would have got anyway (no money, no oddities)', async () => {
    const shown = await run(false);
    const hidden = await run(true);
    expect([...hidden.statuses]).toEqual([200]);
    expect(hidden.sent).toEqual(shown.sent);
    for (const t of hidden.sent) expect(t).not.toMatch(/\$|venmo|owes/i);
  });
});
