import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { playerPhone, setupGroup } from './harness';
import { EARLY_GRACE_MS, lockedAdjustCents, priceNow, saveLine, saveLineNextMs, ticketPrice } from '../shared/earlyBird';
import { moneyLine } from '../shared/tournamentMoney';
import { adminTour, awards, books as nightBooks, draftAndPublish, playPools, potOf, setWinner, START_MS, world as nightWorld } from './zip58-world';

// Zip 94 (🎾94.early bird): pay early, pay less. The money to the cent with mixed prices: lock in early, lock in late, credit covering part,
// the 30 minute grace, drop out and refund, the late drop that keeps the money, standby taking a freed spot, Mark paid, End and the prize
// credit, with both integrity files at 0 after every step. And the proof that a tournament with no early price (The Cold Open) is untouched
// with the switch on. The clock starts Monday Oct 26, 2026, 12 PM Eastern (tests/harness.ts). The tournament is Thu Nov 12; Pay by is Wed
// Nov 11, 7:00 PM. The ticket is $16 here (the other tests' price); the early price $14, until Fri Oct 30, 7:00 PM EDT.

const DATE = '2026-11-12';
const DATES = ['2026-11-05', DATE, '2026-11-19'];
const BASE = { name: 'Winter Classic', dates: DATES, ticketCents: 1600, creditCents: 1400, visibility: 'all' };
const MORE = ['Gale', 'Harper', 'Indy', 'Jules', 'Kit', 'Kai', 'Lee', 'Lane', 'Morgan', 'Jordan', 'Avery', 'Rory', 'Shay', 'Toni', 'Uma'];
const NAMES = ['Blair', 'Casey', 'Devon', 'Emery', 'Frankie', ...MORE];
const UNTIL = '2026-10-30T23:00:00.000Z'; // Fri Oct 30, 7:00 PM EDT
const UNTIL_MS = Date.parse(UNTIL);
const PAY_BY_MS = Date.parse('2026-11-12T00:00:00.000Z');
const OLD_SQL = readFileSync(join(process.cwd(), 'scripts/integrity-checks.sql'), 'utf8');
const TOUR_SQL = readFileSync(join(process.cwd(), 'scripts/integrity-checks-tournament.sql'), 'utf8');

type Ctx = Awaited<ReturnType<typeof setupGroup>> & { tid: string; byName: Record<string, string> };

async function world(opts: { signUp?: string[]; early?: boolean; switchOn?: boolean } = {}): Promise<Ctx> {
  const base = await setupGroup();
  await base.organizer.call('PUT', '/api/admin/group', { organizerName: 'Alex' });
  for (const [i, name] of MORE.entries()) expect((await base.organizer.call('POST', '/api/admin/players', { name, phone: `(313) 555-04${String(i).padStart(2, '0')}` })).status).toBe(200);
  const players = (await base.organizer.call('GET', '/api/admin/dashboard')).data.players as { id: string; name: string }[];
  const byName = Object.fromEntries(players.map((p) => [p.name, p.id]));
  expect((await base.organizer.call('PUT', '/api/admin/tournaments-switch', { on: true })).status).toBe(200);
  expect((await base.organizer.call('PUT', '/api/admin/adjust-credit-switch', { on: true })).status).toBe(200);
  if (opts.switchOn !== false) expect((await base.organizer.call('PUT', '/api/admin/early-bird-switch', { on: true })).status).toBe(200);
  const created = await base.organizer.call('POST', '/api/admin/tournament', BASE);
  expect(created.status, created.text).toBe(200);
  const ctx: Ctx = { ...base, byName, tid: created.data.id };
  for (const name of opts.signUp ?? NAMES.slice(0, 12)) {
    const r = await (await playerPhone(ctx, name)).call('POST', '/api/tournament/signup', { tournamentId: ctx.tid, level: 320, dates: [DATE] });
    expect(r.status, r.text).toBe(200);
  }
  const res = await ctx.organizer.call('PUT', `/api/admin/tournament/${ctx.tid}/date`, { date: DATE });
  expect(res.status, res.text).toBe(200);
  if (opts.early !== false) {
    const e = await setEarly(ctx, 1400, UNTIL);
    expect(e.status, e.text).toBe(200);
  }
  return ctx;
}

const setEarly = (ctx: Ctx, earlyCents: number | null, until: string | null) => ctx.organizer.call('PUT', `/api/admin/tournament/${ctx.tid}/early`, { earlyCents, until });
const pot = (ctx: Ctx, name: string): number =>
  Number(
    (
      ctx.app.db.raw
        .prepare(
          `SELECT COALESCE(SUM(CASE kind WHEN 'kept' THEN amount_cents WHEN 'used' THEN -amount_cents ELSE -(amount_cents - five_cents) END), 0) AS c
           FROM credit_ledger WHERE player_id = ? AND ended_at IS NULL`,
        )
        .get(ctx.byName[name]) as { c: number }
    ).c,
  );
const give = async (ctx: Ctx, name: string, cents: number) => {
  const r = await ctx.organizer.call('POST', `/api/admin/players/${ctx.byName[name]}/credit-adjust`, { direction: 'add', cents, reason: 'Test credit', seen: pot(ctx, name) });
  expect(r.status, r.text).toBe(200);
};
const lock = async (ctx: Ctx, name: string, priceCents: number, intent: 'lock' | 'hold' = 'lock') => (await playerPhone(ctx, name)).call('POST', '/api/tournament/lock', { tournamentId: ctx.tid, intent, priceCents });
const iPaid = async (ctx: Ctx, name: string, cents: number) => (await playerPhone(ctx, name)).call('POST', '/api/tournament/paid', { tournamentId: ctx.tid, cents });
const answer = (ctx: Ctx, name: string, action: string, cents?: number) => ctx.organizer.call('POST', `/api/admin/tournament/${ctx.tid}/ticket`, { playerId: ctx.byName[name], action, ...(cents === undefined ? {} : { cents }) });
const backOut = async (ctx: Ctx, name: string) => (await playerPhone(ctx, name)).call('POST', '/api/tournament/back-out', { tournamentId: ctx.tid });
const card = async (ctx: Ctx, name: string) => (await (await playerPhone(ctx, name)).call('GET', '/api/group')).data.tournament;
const dash = async (ctx: Ctx) => (await ctx.organizer.call('GET', '/api/admin/dashboard')).data.tournament;
const ticket = (ctx: Ctx, name: string) =>
  ctx.app.db.raw.prepare('SELECT place, price_cents, credit_cents, paid_cents, claim_cents FROM tournament_tickets WHERE tournament_id = ? AND player_id = ?').get(ctx.tid, ctx.byName[name]) as Record<string, number | string>;
function books(ctx: Ctx) {
  for (const sql of [OLD_SQL, TOUR_SQL]) {
    const r = ctx.app.db.raw.prepare(sql).get() as Record<string, number>;
    for (const [k, n] of Object.entries(r)) if (!k.startsWith('info_')) expect(Number(n), `${k} must be 0`).toBe(0);
  }
}
/** Credit for exactly the price, then Lock in: locked in at once. */
async function lockIn(ctx: Ctx, names: string[], cents: number) {
  for (const n of names) {
    await give(ctx, n, cents);
    const r = await lock(ctx, n, cents);
    expect(r.status, r.text).toBe(200);
    expect(r.data.result).toBe('locked');
  }
}

describe('the shared rule (shared/earlyBird.ts)', () => {
  const t = { ticket_cents: 2000, early_cents: 1800, early_until: '2026-11-28T00:00:00.000Z', pay_by: '2026-12-01T00:00:00.000Z' };
  const until = Date.parse(t.early_until);
  it('the price now: early before the deadline, the ticket price at and after it; the switch off or nothing set: the ticket price', () => {
    expect(priceNow(t, true, until - 1)).toBe(1800);
    expect(priceNow(t, true, until)).toBe(2000);
    expect(priceNow(t, false, until - 1)).toBe(2000);
    expect(priceNow({ ticket_cents: 2000 }, true, 0)).toBe(2000);
    // An early price that is not lower is no early bird; a deadline after Pay by ends at Pay by.
    expect(priceNow({ ...t, early_cents: 2000 }, true, until - 1)).toBe(2000);
    expect(priceNow({ ...t, pay_by: '2026-11-27T00:00:00.000Z' }, true, until - 2 * 3_600_000)).toBe(2000);
  });
  it("a ticket's price: money on it keeps its own; an empty one follows the price now, with the 30 minute grace for an early one", () => {
    const empty = { price_cents: 1800, credit_cents: 0, paid_cents: 0, claim_cents: 0 };
    expect(ticketPrice(t, empty, false, true, until + EARLY_GRACE_MS - 1)).toBe(1800);
    expect(ticketPrice(t, empty, false, true, until + EARLY_GRACE_MS)).toBe(2000);
    expect(ticketPrice(t, { ...empty, credit_cents: 100 }, false, true, until + 30 * 86_400_000)).toBe(1800);
    expect(ticketPrice(t, { ...empty, price_cents: 2000 }, false, true, until - 1)).toBe(1800);
    expect(ticketPrice(t, null, true, true, until - 1)).toBe(0);
    expect(ticketPrice(t, { ...empty, price_cents: 0 }, false, true, until - 1)).toBe(0);
  });
  it('the words: whole days, then gold hours on the last day, then minutes', () => {
    const at = (ms: number) => saveLine(200, until, until - ms);
    expect(at(2 * 86_400_000 + 5 * 3_600_000)).toEqual({ text: 'Save $2 for 2 more days', gold: false });
    expect(at(86_400_000)).toEqual({ text: 'Save $2 for 1 more day', gold: false });
    expect(at(86_400_000 - 1)).toEqual({ text: 'Save $2 for 23 more hours', gold: true });
    expect(at(9 * 3_600_000 + 40 * 60_000)).toEqual({ text: 'Save $2 for 9 more hours', gold: true });
    expect(at(3_600_000)).toEqual({ text: 'Save $2 for 1 more hour', gold: true });
    expect(at(40 * 60_000)).toEqual({ text: 'Save $2 for 40 more minutes', gold: true });
    expect(at(1000)).toEqual({ text: 'Save $2 for 1 more minute', gold: true });
    expect(at(0)).toBeNull();
    expect(saveLine(300, until, until - 2 * 86_400_000)?.text).toBe('Save $3 for 2 more days');
    // The card re-draws when the words change, with no extra call.
    expect(saveLineNextMs(until, until - (2 * 86_400_000 + 5 * 3_600_000))).toBe(until - 2 * 86_400_000 + 1);
  });
  it('the money line: tickets locked in at their real price, everyone else at the price now; with no early bird exactly as before', () => {
    const locked = [{ price_cents: 1800 }, { price_cents: 1800 }, { price_cents: 2000 }, { price_cents: 0 }];
    expect(lockedAdjustCents(t, locked, 2000)).toBe(-400);
    expect(lockedAdjustCents(t, locked, 1800)).toBe(200);
    expect(lockedAdjustCents({ ticket_cents: 2000 }, locked, 2000)).toBe(0);
    const line = (adjustCents?: number) => moneyLine({ expected: 10, courts: 2, minutes: 150, ticketCents: 2000, prizeCents: 2800, adjustCents });
    expect(line().ticketsCents).toBe(18000);
    expect(line(0)).toEqual(line());
    expect(line(-400).ticketsCents).toBe(17600);
  });
});

describe('Alex sets it up (the gear sheet rows)', () => {
  it('lower than the ticket price, the end still to come and before Pay by, whole dollars; cleared with both empty', async () => {
    const ctx = await world({ early: false });
    expect((await setEarly(ctx, 1600, UNTIL)).status).toBe(400);
    expect((await setEarly(ctx, 1450, UNTIL)).status).toBe(400);
    expect((await setEarly(ctx, 0, UNTIL)).status).toBe(400);
    expect((await setEarly(ctx, 1400, '2026-10-26T15:00:00.000Z')).status).toBe(400);
    expect((await setEarly(ctx, 1400, new Date(PAY_BY_MS).toISOString())).data.message).toMatch(/before Pay by/);
    expect((await setEarly(ctx, 1400, null)).status).toBe(400);
    expect((await setEarly(ctx, 1400, UNTIL)).status).toBe(200);
    const t = await dash(ctx);
    expect(t.early).toMatchObject({ cents: 1400, until: UNTIL, locked: false, on: true });
    expect(t.priceNowCents).toBe(1400);
    expect((await setEarly(ctx, null, null)).status).toBe(200);
    expect((await dash(ctx)).priceNowCents).toBeUndefined();
    // Pay by can never move to or before the early deadline.
    expect((await setEarly(ctx, 1400, UNTIL)).status).toBe(200);
    expect((await ctx.organizer.call('PUT', `/api/admin/tournament/${ctx.tid}/pay-by`, { payBy: UNTIL })).status).toBe(409);
    const hist = (await ctx.organizer.call('GET', '/api/admin/activity')).data.entries as { action: string }[];
    expect(hist.filter((h) => h.action === 'tournament_early_set')).toHaveLength(2);
  });
  it('cannot be added or changed once anyone has locked in (an empty ticket or the organizer’s own $0 seat does not count)', async () => {
    const ctx = await world({ early: false });
    // Blair taps Lock in with no credit: a ticket with nothing on it. Still free to set.
    expect((await lock(ctx, 'Blair', 1600)).data.result).toBe('due');
    expect((await setEarly(ctx, 1400, UNTIL)).status).toBe(200);
    await lockIn(ctx, ['Casey'], 1400);
    const r = await setEarly(ctx, 1300, UNTIL);
    expect(r.status).toBe(409);
    expect(r.data.message).toBe('Players have locked in. The early price stays as it is.');
    expect((await setEarly(ctx, null, null)).status).toBe(409);
    expect((await dash(ctx)).early.locked).toBe(true);
  });
  it('the rows show only with the switch on, or on this phone with ?earlybird=on (X-Early-Bird); prices follow the Settings row alone', async () => {
    const ctx = await world({ switchOn: false });
    expect((await dash(ctx)).early).toBeUndefined();
    const t = (await ctx.organizer.call('GET', '/api/admin/dashboard', undefined, { 'X-Early-Bird': 'on' })).data.tournament;
    expect(t.early).toMatchObject({ cents: 1400, on: false });
    expect(t.priceNowCents).toBeUndefined();
    // A player's phone with the header still pays the ticket price (money is the same for everyone).
    const c = (await (await playerPhone(ctx, 'Blair')).call('GET', '/api/group', undefined, { 'X-Early-Bird': 'on' })).data.tournament;
    expect(c.tickets.priceCents).toBe(1600);
    expect(c.tickets.early).toBeUndefined();
  });
});

describe('the money to the cent (Alex: $18 early, $20 after; here $14 and $16)', () => {
  it('lock in early pays $14, lock in late pays $16; anyone at $14 keeps $14; the cards say so', async () => {
    const ctx = await world();
    const before = await card(ctx, 'Blair');
    expect(before.tickets.priceCents).toBe(1400);
    expect(before.tickets.early).toEqual({ regularCents: 1600, earlyCents: 1400, until: UNTIL });
    // A stale screen (the $16 price) is refused; the shown $14 locks in.
    expect((await lock(ctx, 'Blair', 1600)).status).toBe(409);
    await lockIn(ctx, ['Blair', 'Casey'], 1400);
    expect(ticket(ctx, 'Blair')).toMatchObject({ place: 'spot', price_cents: 1400, credit_cents: 1400 });
    expect(pot(ctx, 'Blair')).toBe(0);
    books(ctx);
    ctx.app.now = UNTIL_MS + 60_000;
    const late = await card(ctx, 'Devon');
    expect(late.tickets.priceCents).toBe(1600);
    expect((await lock(ctx, 'Devon', 1400)).status).toBe(409);
    await lockIn(ctx, ['Devon'], 1600);
    expect(ticket(ctx, 'Devon')).toMatchObject({ place: 'spot', price_cents: 1600, credit_cents: 1600 });
    expect(ticket(ctx, 'Blair')).toMatchObject({ price_cents: 1400 });
    expect((await card(ctx, 'Blair')).tickets.mine).toMatchObject({ place: 'spot', owedCents: 0 });
    books(ctx);
  });

  it('credit covering part: the rest is owed at the price of the tap ($14), even after the deadline; Alex confirming late keeps it', async () => {
    const ctx = await world();
    await give(ctx, 'Emery', 500);
    const r = await lock(ctx, 'Emery', 1400);
    expect(r.data).toMatchObject({ result: 'due', creditUsedCents: 500, dueCents: 900 });
    ctx.app.now = UNTIL_MS + 5 * 86_400_000;
    expect((await card(ctx, 'Emery')).tickets).toMatchObject({ priceCents: 1400, mine: { owedCents: 900 } });
    expect((await iPaid(ctx, 'Emery', 900)).status).toBe(200);
    expect((await answer(ctx, 'Emery', 'confirm')).status).toBe(200);
    expect(ticket(ctx, 'Emery')).toMatchObject({ place: 'spot', price_cents: 1400, credit_cents: 500, paid_cents: 900 });
    books(ctx);
  });

  it('an I paid in progress at the deadline: $14 within 30 minutes; after that an empty ticket costs $16 (the screen is told to look again)', async () => {
    const ctx = await world();
    expect((await lock(ctx, 'Frankie', 1400)).data).toMatchObject({ result: 'due', dueCents: 1400 });
    expect((await lock(ctx, 'Gale', 1400)).data).toMatchObject({ result: 'due', dueCents: 1400 });
    ctx.app.now = UNTIL_MS + 10 * 60_000;
    expect((await iPaid(ctx, 'Frankie', 1400)).status).toBe(200);
    expect(ticket(ctx, 'Frankie')).toMatchObject({ price_cents: 1400, claim_cents: 1400 });
    expect((await answer(ctx, 'Frankie', 'confirm')).status).toBe(200);
    expect(ticket(ctx, 'Frankie')).toMatchObject({ place: 'spot', price_cents: 1400, paid_cents: 1400 });
    ctx.app.now = UNTIL_MS + 2 * 3_600_000;
    expect((await card(ctx, 'Gale')).tickets).toMatchObject({ priceCents: 1600, mine: { owedCents: 1600 } });
    const stale = await iPaid(ctx, 'Gale', 1400);
    expect(stale.status).toBe(409);
    expect(stale.data.message).toBe('The amount changed to $16. Look again.');
    expect(ticket(ctx, 'Gale')).toMatchObject({ price_cents: 1400, claim_cents: 0 });
    expect((await iPaid(ctx, 'Gale', 1600)).status).toBe(200);
    expect(ticket(ctx, 'Gale')).toMatchObject({ price_cents: 1600, claim_cents: 1600 });
    expect((await answer(ctx, 'Gale', 'confirm')).status).toBe(200);
    expect(ticket(ctx, 'Gale')).toMatchObject({ place: 'spot', price_cents: 1600, paid_cents: 1600 });
    books(ctx);
  });

  it("Mark paid: the price that applies when Alex marks it (his mark never earns $14 after the deadline)", async () => {
    const ctx = await world();
    expect((await answer(ctx, 'Harper', 'mark_paid', 1400)).status).toBe(200);
    expect(ticket(ctx, 'Harper')).toMatchObject({ place: 'spot', price_cents: 1400, paid_cents: 1400 });
    expect((await lock(ctx, 'Indy', 1400)).data.result).toBe('due');
    ctx.app.now = UNTIL_MS + 3_600_000;
    const t = await dash(ctx);
    expect(t.tickets.find((k: any) => k.name === 'Indy').priceCents).toBe(1600);
    expect((await answer(ctx, 'Indy', 'mark_paid', 1400)).status).toBe(409);
    expect((await answer(ctx, 'Indy', 'mark_paid', 1600)).status).toBe(200);
    expect((await answer(ctx, 'Jules', 'mark_paid', 1600)).status).toBe(200);
    expect([ticket(ctx, 'Indy'), ticket(ctx, 'Jules')]).toEqual([
      { place: 'spot', price_cents: 1600, credit_cents: 0, paid_cents: 1600, claim_cents: 0 },
      { place: 'spot', price_cents: 1600, credit_cents: 0, paid_cents: 1600, claim_cents: 0 },
    ]);
    books(ctx);
  });

  it('drop out and refund: each gets back exactly what they paid ($14 or $16)', async () => {
    const ctx = await world();
    await lockIn(ctx, ['Blair', 'Casey'], 1400);
    ctx.app.now = UNTIL_MS + 3_600_000;
    await lockIn(ctx, ['Devon'], 1600);
    // Blair paid $14 with credit; Casey's $14 was cash.
    expect((await backOut(ctx, 'Blair')).status).toBe(200);
    expect(pot(ctx, 'Blair')).toBe(1400);
    expect((await backOut(ctx, 'Devon')).status).toBe(200);
    expect(pot(ctx, 'Devon')).toBe(1600);
    // Signing up again after the deadline is a new lock in: $16 (their $14 credit plus $2).
    const again = await (await playerPhone(ctx, 'Blair')).call('POST', '/api/tournament/signup', { tournamentId: ctx.tid, level: 320, dates: [DATE] });
    expect(again.status, again.text).toBe(200);
    // Blair's old ticket held $14 of credit, now back in the pot: an empty ticket again, so the next tap is the price now ($16).
    expect((await card(ctx, 'Blair')).tickets.priceCents).toBe(1600);
    expect(ticket(ctx, 'Blair')).toMatchObject({ credit_cents: 0, paid_cents: 0, claim_cents: 0 });
    const r = await lock(ctx, 'Blair', 1600);
    expect(r.status, r.text).toBe(200);
    expect(r.data).toMatchObject({ result: 'due', creditUsedCents: 1400, dueCents: 200 });
    expect(ticket(ctx, 'Blair')).toMatchObject({ price_cents: 1600, credit_cents: 1400 });
    books(ctx);
  });

  it('standby: a $16 hold takes the spot a $14 ticket gave up; the dropper gets $14 back, the money line follows', async () => {
    const ctx = await world({ signUp: NAMES });
    const early = NAMES.slice(0, 10);
    await lockIn(ctx, early, 1400);
    ctx.app.now = UNTIL_MS + 3_600_000;
    await lockIn(ctx, NAMES.slice(10, 16), 1600);
    // 16 locked in: full. Uma joins standby and pays to hold at $16.
    expect((await (await playerPhone(ctx, 'Uma')).call('POST', '/api/tournament/waitlist', { tournamentId: ctx.tid })).status).toBe(200);
    await give(ctx, 'Uma', 1600);
    expect((await lock(ctx, 'Uma', 1600, 'hold')).data.result).toBe('held');
    expect(ticket(ctx, 'Uma')).toMatchObject({ place: 'line', price_cents: 1600, credit_cents: 1600 });
    expect((await backOut(ctx, 'Blair')).status).toBe(200);
    expect(pot(ctx, 'Blair')).toBe(1400);
    expect(ticket(ctx, 'Uma')).toMatchObject({ place: 'spot', price_cents: 1600 });
    // The money line: 9 at $14 and 7 at $16 locked in = $238 (the organizer is not on the list here: expected 16, minus 1 for them).
    const t = await dash(ctx);
    expect(t.lockedIn).toBe(16);
    expect(t.cost.paidNowCents).toBe(9 * 1400 + 7 * 1600);
    expect(t.money.ticketsCents).toBe(15 * 1600 - 9 * 200);
    books(ctx);
  });

  it('the late drop that keeps the money: a $14 ticket keeps $14 and gets $14 back when the spot is taken', async () => {
    const ctx = await world();
    await lockIn(ctx, NAMES.slice(0, 4), 1400);
    ctx.app.now = UNTIL_MS + 3_600_000;
    await lockIn(ctx, NAMES.slice(4, 8), 1600);
    ctx.app.now = PAY_BY_MS + 30 * 60_000;
    const r = await backOut(ctx, 'Blair');
    expect(r.data).toMatchObject({ keptCents: 1400 });
    expect(pot(ctx, 'Blair')).toBe(0);
    books(ctx);
    await lockIn(ctx, ['Lee'], 1600);
    expect(pot(ctx, 'Blair')).toBe(1400);
    books(ctx);
  });

  it('the money and Prizes "$X left" before the deadline, after it and with a mix', async () => {
    const ctx = await world();
    const exp = (await dash(ctx)).expected;
    expect((await dash(ctx)).money.ticketsCents).toBe((exp - 1) * 1400);
    await lockIn(ctx, ['Blair', 'Casey', 'Devon'], 1400);
    expect((await dash(ctx)).money.ticketsCents).toBe((exp - 1) * 1400);
    ctx.app.now = UNTIL_MS + 3_600_000;
    const after = await dash(ctx);
    expect(after.priceNowCents).toBeUndefined();
    expect(after.money.ticketsCents).toBe((after.expected - 1) * 1600 - 3 * 200);
    expect(after.cost.paidNowCents).toBe(3 * 1400);
    expect(after.cost.nowCents).toBe(after.money.courtCents - 3 * 1400 + (after.money.ticketsCents - after.money.courtCents - after.money.youCents));
  });
});

describe('The Cold Open: no early price, untouched with the switch on', () => {
  async function coldWorld(on: boolean) {
    const ctx = await world({ early: false, switchOn: on });
    await lockIn(ctx, ['Blair', 'Casey'], 1600);
    expect((await lock(ctx, 'Devon', 1600)).data.result).toBe('due');
    return ctx;
  }
  const strip = (x: unknown) => JSON.parse(JSON.stringify(x).replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '<id>'));
  it('the organizer card, the money, every player card and every tap are the same, switch off or on', async () => {
    const off = await coldWorld(false);
    const on = await coldWorld(true);
    // The only new thing on the organizer's side is the gear sheet's Early price row, fixed (tickets sold, none set).
    const { early: gear, ...onRest } = strip(await dash(on));
    expect(gear).toEqual({ cents: null, until: null, locked: true, on: true });
    expect(onRest).toEqual(strip(await dash(off)));
    for (const n of ['Blair', 'Devon', 'Emery']) expect(strip(await card(on, n))).toEqual(strip(await card(off, n)));
    const tOn = await dash(on);
    expect(tOn.early).toMatchObject({ cents: null, until: null, locked: true, on: true });
    for (const ctx of [off, on]) {
      expect((await lock(ctx, 'Emery', 1600)).status).toBe(200);
      expect((await iPaid(ctx, 'Devon', 1600)).status).toBe(200);
      expect(ticket(ctx, 'Devon')).toMatchObject({ price_cents: 1600, claim_cents: 1600 });
      books(ctx);
    }
    // And it can never get an early price now (tickets are sold).
    expect((await setEarly(on, 1400, UNTIL)).status).toBe(409);
  });
});

describe('End and the prize credit with mixed prices', () => {
  it("the night's money counts each ticket's real price; End pays the prize once; both integrity files 0", async () => {
    const ctx = await nightWorld(8, { early: { cents: 1400, lateFrom: 5 } });
    const prices = (ctx.app.db.raw.prepare('SELECT price_cents FROM tournament_tickets WHERE tournament_id = ? AND price_cents > 0 ORDER BY price_cents').all(ctx.tid) as { price_cents: number }[]).map((r) => r.price_cents);
    expect(prices).toEqual([1400, 1400, 1400, 1400, 1400, 1600, 1600, 1600]);
    await draftAndPublish(ctx);
    ctx.app.now = START_MS + 90 * 60_000;
    await playPools(ctx, (a, b) => (a < b ? 0 : 1));
    const d = (await adminTour(ctx)).day;
    await setWinner(ctx, d.games.find((g: any) => g.stage === 'third').num, 3);
    await setWinner(ctx, d.games.find((g: any) => g.stage === 'final').num, 1);
    const end = (await adminTour(ctx)).end;
    expect(end.money.ticketsCents).toBe(5 * 1400 + 3 * 1600);
    const winners = end.first.players as string[];
    const pots = winners.map((n) => potOf(ctx, n));
    expect((await awards(ctx, { action: 'end', seen: end.seen })).status).toBe(200);
    expect(winners.map((n) => potOf(ctx, n))).toEqual(pots.map((p) => p + 1400));
    nightBooks(ctx);
  });
});
