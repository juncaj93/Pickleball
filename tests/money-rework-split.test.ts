// Money page rework with the Late-cancel fee split ON (it went live Wed Nov 4): the new Totals after a fee-kept cancel with 5 or 6 in, Edit
// charge on that game, and the 5-minute clock around a game hidden from the lists. Admin only: nothing here changes a seat, payment or credit.
import { COURT, comingUnbooked, PLAYERS, YOURS } from './projectedZip13';
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
    // (+ x: the month's other games still to come, not booked; Zip 13 counts them in Projected as if played.)
    const x = await comingUnbooked(w.organizer, month, [s0.id]);
    expect(m.rework.projected).toMatchObject({ addedCourts: x, courtCount: 1 + x, courtCostCents: 4800 + x * COURT, playersPayCents: 4200 + x * PLAYERS, yourCostCents: 3600 + x * YOURS, yourCostCourtCents: 600 + x * YOURS });
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
  const FIVE = 5 * 60_000;
  /** The ticks around the moment an empty, not-booked game's court booking opens (7:00 AM and the 7:30 AM reminder): hidden or not, optionally un-hidden again or joined by a player first. */
  async function run(opts: { hide?: boolean; unhide?: boolean; join?: boolean }) {
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
    // The game whose court booking opens soon (7:00 AM, 14 days before it): its "book a court" and reminder alerts are what a hidden game must not send.
    const g = d.sessions.find((s: any) => s.confirmedCount === 0 && s.bookingStatus !== 'booked' && Date.parse(s.bookingOpensAt) + 7 * HOUR > app.now && Date.parse(s.bookingOpensAt) < app.now + 48 * HOUR);
    const hide = (hidden: boolean) => w.organizer.call('POST', `/api/admin/sessions/${g.id}/hide-from-list`, { hidden });
    if (opts.hide) expect((await hide(true)).status).toBe(200);
    if (opts.unhide) expect((await hide(false)).status).toBe(200);
    if (opts.join) expect((await (await playerPhone(w, 'Blair')).call('POST', `/api/sessions/${g.id}/join`, {})).status).toBe(200);
    await app.settle();
    sent.length = 0;
    // bookingOpensAt is midnight of that day; the alert says 7:00 AM.
    const opens = Date.parse(g.bookingOpensAt) + 7 * HOUR;
    app.now = opens - 2 * HOUR;
    const statuses = new Set<number>();
    while (app.now <= opens + 4 * HOUR) {
      const r = await w.organizer.call('POST', '/api/cron/tick', {}, { 'X-Cron-Secret': app.env.CRON_SECRET as string });
      await app.settle();
      statuses.add(r.status);
      app.now += FIVE;
    }
    return { sent, statuses };
  }
  it('K1 not hidden: the game sends its usual alerts; hidden: it sends none, and every tick still answers 200', async () => {
    const shown = await run({});
    const hidden = await run({ hide: true });
    expect(shown.sent.length).toBeGreaterThan(0);
    expect([...hidden.statuses]).toEqual([200]);
    expect(hidden.sent).toEqual([]);
    for (const t of shown.sent) expect(t).not.toMatch(/\$|venmo|owes/i);
  });
  it('K2 un-hiding makes the alerts normal again, exactly as if it had never been hidden', async () => {
    const shown = await run({});
    const back = await run({ hide: true, unhide: true });
    expect(back.sent).toEqual(shown.sent);
  });
  it('K3 a hidden game that gains money (a player joins) sends alerts like any game', async () => {
    const plain = await run({ join: true });
    const gained = await run({ hide: true, join: true });
    expect(plain.sent.length).toBeGreaterThan(0);
    expect(gained.sent).toEqual(plain.sent);
  });
});
