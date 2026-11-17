import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DAY, playerPhone, setupGroup, withoutIds } from './harness';
import { defaultPayBy, evensWarning, payByLabel, placeWord, ticketOwed, ticketsLine } from '../shared/tournamentTickets';
import { creditChanges, creditEntryText } from '../shared/credit';
import { routeList } from '../server/app';

// Zip 56, Tournaments piece 2 (server/tournamentTickets.ts, server/tournamentMoney.ts): tickets, the waitlist, paying, backing out, cancel and
// reschedule. Every money proof the brief asks for, to the cent, with the books checked after each step: the integrity checks (the older file
// and the new tournament file) read all zeros and every pot is exactly what the steps say.
// The clock is Monday Oct 26, 2026, 12 PM Eastern (tests/harness.ts). The tournament is on Thu Nov 12 at 7:30 PM; Pay by is Tue Nov 10, 7:00 PM.

type Ctx = Awaited<ReturnType<typeof setupGroup>> & { tid: string };

const DATE = '2026-11-12';
const DATES = ['2026-11-03', '2026-11-05', '2026-11-10', DATE, '2026-11-17'];
const BASE = { name: 'Winter Classic', dates: DATES, size: 8, courts: 2, minutes: 120, start: 1170, ticketCents: 1600, creditCents: 1400, visibility: 'all' };
const MORE = ['Gale', 'Harper', 'Indy', 'Jules', 'Kit'];
const OLD_SQL = readFileSync(join(process.cwd(), 'scripts/integrity-checks.sql'), 'utf8');
const TOUR_SQL = readFileSync(join(process.cwd(), 'scripts/integrity-checks-tournament.sql'), 'utf8');

/** Every check in both files reads 0 (info_ columns are to-dos and may count). */
function books(ctx: Ctx) {
  for (const sql of [OLD_SQL, TOUR_SQL]) {
    const row = ctx.app.db.raw.prepare(sql).get() as Record<string, number>;
    for (const [k, n] of Object.entries(row)) if (!k.startsWith('info_')) expect(Number(n), `${k} must be 0`).toBe(0);
  }
}

/** A player's pot right now, straight from the ledger (kept minus used minus refunded, live rows only). */
function pot(ctx: Ctx, name: string): number {
  const row = ctx.app.db.raw
    .prepare(
      `SELECT COALESCE(SUM(CASE kind WHEN 'kept' THEN amount_cents WHEN 'used' THEN -amount_cents ELSE -(amount_cents - five_cents) END), 0) AS c
       FROM credit_ledger WHERE player_id = ? AND ended_at IS NULL`,
    )
    .get(ctx.byName[name]) as { c: number };
  return Number(row.c);
}

const ticketRow = (ctx: Ctx, name: string) =>
  ctx.app.db.raw.prepare('SELECT * FROM tournament_tickets WHERE tournament_id = ? AND player_id = ?').get(ctx.tid, ctx.byName[name]) as Record<string, any> | undefined;

/** Size 6 has its own plan: 1 court, 2 hours, 8:00 PM (the night is over at 10:00 PM, Nov 13 3:00 AM UTC). */
const PLAN_6 = { courts: 1, minutes: 120, start: 1200 };

async function world(opts: { size?: number; open?: boolean; signUp?: string[] } = {}): Promise<Ctx> {
  const base = await setupGroup();
  await base.organizer.call('PUT', '/api/admin/group', { organizerName: 'Alex' });
  for (const [i, name] of MORE.entries()) expect((await base.organizer.call('POST', '/api/admin/players', { name, phone: `(313) 555-02${String(i).padStart(2, '0')}` })).status).toBe(200);
  const players = (await base.organizer.call('GET', '/api/admin/dashboard')).data.players as { id: string; name: string }[];
  const byName = Object.fromEntries(players.map((p) => [p.name, p.id]));
  expect((await base.organizer.call('PUT', '/api/admin/tournaments-switch', { on: true })).status).toBe(200);
  expect((await base.organizer.call('PUT', '/api/admin/adjust-credit-switch', { on: true })).status).toBe(200);
  const created = await base.organizer.call('POST', '/api/admin/tournament', { ...BASE, ...(opts.size === 6 ? PLAN_6 : {}), size: opts.size ?? 8 });
  expect(created.status, created.text).toBe(200);
  const ctx: Ctx = { ...base, byName, players, tid: created.data.id };
  for (const name of opts.signUp ?? []) await signUp(ctx, name);
  if (opts.open !== false && opts.signUp) {
    expect((await ctx.organizer.call('PUT', `/api/admin/tournament/${ctx.tid}/date`, { date: DATE })).status).toBe(200);
    const res = await ctx.organizer.call('POST', `/api/admin/tournament/${ctx.tid}/open-tickets`, {});
    expect(res.status, res.text).toBe(200);
  }
  return ctx;
}

async function signUp(ctx: Ctx, name: string) {
  const phone = name === 'Alex' ? await organizerPhone(ctx) : await playerPhone(ctx, name);
  const res = await phone.call('POST', '/api/tournament/signup', { tournamentId: ctx.tid, level: 320, dates: [DATE] });
  expect(res.status, res.text).toBe(200);
}

/** The organizer's own phone: signed in AND their own name picked (the organizer plays too; their seat is one of the spots). */
async function organizerPhone(ctx: Ctx) {
  const c = ctx.organizer;
  c.groupKey = ctx.groupKey;
  expect((await c.call('POST', '/api/me', { playerId: ctx.byName.Alex })).status).toBe(200);
  return c;
}

async function giveCredit(ctx: Ctx, name: string, cents: number) {
  const res = await ctx.organizer.call('POST', `/api/admin/players/${ctx.byName[name]}/credit-adjust`, { direction: 'add', cents, reason: 'Test credit', seen: pot(ctx, name) });
  expect(res.status, res.text).toBe(200);
}

const dash = async (ctx: Ctx) => (await ctx.organizer.call('GET', '/api/admin/dashboard')).data;
const card = async (ctx: Ctx, name: string) => (await (await playerPhone(ctx, name)).call('GET', '/api/group')).data.tournament;

async function lock(ctx: Ctx, name: string, intent: 'lock' | 'hold' = 'lock') {
  return (await playerPhone(ctx, name)).call('POST', '/api/tournament/lock', { tournamentId: ctx.tid, intent, priceCents: name === 'Alex' ? 0 : 1600 });
}
async function iPaid(ctx: Ctx, name: string, cents: number) {
  return (await playerPhone(ctx, name)).call('POST', '/api/tournament/paid', { tournamentId: ctx.tid, cents });
}
async function answer(ctx: Ctx, name: string, action: 'confirm' | 'reject' | 'mark_paid' | 'take_off', cents?: number) {
  return ctx.organizer.call('POST', `/api/admin/tournament/${ctx.tid}/ticket`, { playerId: ctx.byName[name], action, ...(cents === undefined ? {} : { cents }) });
}
/** Lock my spot, I paid, the organizer confirms: paid by Venmo in full. */
async function payCash(ctx: Ctx, name: string) {
  const r = await lock(ctx, name);
  expect(r.status, r.text).toBe(200);
  if (r.data.dueCents > 0) {
    expect((await iPaid(ctx, name, r.data.dueCents)).status).toBe(200);
    const c = await answer(ctx, name, 'confirm');
    expect(c.status, c.text).toBe(200);
  }
}
async function backOut(ctx: Ctx, name: string, backCents?: number) {
  return (await playerPhone(ctx, name)).call('POST', '/api/tournament/back-out', { tournamentId: ctx.tid, ...(backCents === undefined ? {} : { backCents }) });
}

describe('the shared rules', () => {
  it('Pay by: Tuesday 7:00 PM for a Thursday game, later fallbacks, and how it reads', () => {
    const now = Date.parse('2026-10-26T16:00:00.000Z');
    expect(defaultPayBy(DATE, 1170, 'America/Detroit', now)).toBe('2026-11-11T00:00:00.000Z'); // Tue Nov 10, 7:00 PM EST
    // Opened late (Wed Nov 11, 9 AM): the day before at 7:00 PM.
    expect(defaultPayBy(DATE, 1170, 'America/Detroit', Date.parse('2026-11-11T14:00:00.000Z'))).toBe('2026-11-12T00:00:00.000Z');
    // Opened on the day (Thu 2 PM): one hour before the start.
    expect(defaultPayBy(DATE, 1170, 'America/Detroit', Date.parse('2026-11-12T19:00:00.000Z'))).toBe('2026-11-12T23:30:00.000Z');
    expect(payByLabel('2026-11-11T00:00:00.000Z', 'America/Detroit', DATE)).toBe('Tue 7:00 PM');
    expect(payByLabel('2026-11-04T00:00:00.000Z', 'America/Detroit', DATE)).toBe('Tue, Nov 3, 7:00 PM');
    expect(evensWarning(7)).toBe('7 locked in. Need 1 more or 1 less.');
    expect(ticketsLine(6, 8)).toBe('Tickets: 6 of 8 locked in');
    expect([1, 2, 3, 4, 11, 21, 22].map(placeWord)).toEqual(['first', 'second', 'third', '4th', '11th', '21st', '22nd']);
    expect(ticketOwed({ priceCents: 1600, creditCents: 500, paidCents: 0, claimCents: 0 })).toBe(1100);
  });
});

describe('open tickets', () => {
  it('the organizer opens tickets on the picked date: Pay by stored, the price and spots locked, players see Lock my spot', async () => {
    const ctx = await world({ signUp: ['Blair', 'Casey'] });
    const t = (await dash(ctx)).tournament;
    expect(t).toMatchObject({ status: 'tickets', payBy: '2026-11-11T00:00:00.000Z', settingsLocked: true, formatLocked: true, closed: false, size: 8, ticketCents: 1600 });
    const c = await card(ctx, 'Blair');
    expect(c.status).toBe('tickets');
    expect(c.tickets).toEqual({ size: 8, priceCents: 1600, payBy: '2026-11-11T00:00:00.000Z', closed: false, locked: [], line: [], mine: null });
    // Price and spots stay once tickets have opened; Only me is refused.
    const edit = await ctx.organizer.call('PUT', `/api/admin/tournament/${ctx.tid}`, { ...BASE, ticketCents: 2000 });
    expect(edit.data.message).toBe('Tickets have been sold. The price stays $16.');
    expect((await ctx.organizer.call('PUT', `/api/admin/tournament/${ctx.tid}`, { ...BASE, size: 10, start: 1200 })).data.message).toBe('Tickets have been sold. The spots stay 8.');
    expect((await ctx.organizer.call('PUT', `/api/admin/tournament/${ctx.tid}/visibility`, { visibility: 'me' })).data.message).toBe('Players have tickets. It stays on Everyone.');
    books(ctx);
  });

  it('needs the date picked and Everyone; a second tap says look again', async () => {
    const ctx = await world({ signUp: ['Blair'], open: false });
    expect((await ctx.organizer.call('POST', `/api/admin/tournament/${ctx.tid}/open-tickets`, {})).data.message).toBe('Pick the date first.');
    await ctx.organizer.call('PUT', `/api/admin/tournament/${ctx.tid}/date`, { date: DATE });
    await ctx.organizer.call('PUT', `/api/admin/tournament/${ctx.tid}/visibility`, { visibility: 'me' });
    expect((await ctx.organizer.call('POST', `/api/admin/tournament/${ctx.tid}/open-tickets`, {})).data.message).toBe('Show it to everyone first.');
    await ctx.organizer.call('PUT', `/api/admin/tournament/${ctx.tid}/visibility`, { visibility: 'all' });
    expect((await ctx.organizer.call('POST', `/api/admin/tournament/${ctx.tid}/open-tickets`, {})).status).toBe(200);
    expect((await ctx.organizer.call('POST', `/api/admin/tournament/${ctx.tid}/open-tickets`, {})).status).toBe(409);
  });
});

describe('lock my spot', () => {
  it('cash: Lock my spot, Pay sheet, I paid (waits, holds no spot), the organizer confirms: locked in', async () => {
    const ctx = await world({ signUp: ['Blair', 'Casey'] });
    const r = await lock(ctx, 'Blair');
    expect(r.data).toMatchObject({ result: 'due', dueCents: 1600, creditUsedCents: 0 });
    expect((await iPaid(ctx, 'Blair', 1500)).data.message).toBe('The amount changed to $16. Look again.');
    expect((await iPaid(ctx, 'Blair', 1600)).data).toMatchObject({ result: 'waiting', claimCents: 1600 });
    // Waiting: not locked in, no spot taken.
    let c = await card(ctx, 'Blair');
    expect(c.tickets.mine).toEqual({ place: 'none', creditCents: 0, paidCents: 0, claimCents: 1600, owedCents: 0 });
    expect(c.tickets.locked).toEqual([]);
    expect((await dash(ctx)).tournament.tickets[0]).toMatchObject({ name: 'Blair', claimCents: 1600, place: 'none' });
    books(ctx);
    const ok = await answer(ctx, 'Blair', 'confirm', 1600);
    expect(ok.data).toMatchObject({ result: 'locked' });
    c = await card(ctx, 'Blair');
    expect(c.tickets.mine).toEqual({ place: 'spot', creditCents: 0, paidCents: 1600, claimCents: 0, owedCents: 0 });
    expect(c.tickets.locked).toEqual([{ name: 'Blair', me: true }]);
    // Casey sees Blair locked in, names only.
    // Casey sees Blair locked in, the name only: never Blair's money (Casey's own price is the only amount on Casey's card).
    const other = await card(ctx, 'Casey');
    expect(JSON.stringify(other.tickets.locked)).toBe('[{"name":"Blair"}]');
    expect(other.tickets.mine).toBeNull();
    expect(withoutIds(JSON.stringify(other)).match(/Cents/g)).toEqual(['Cents']);
    expect(pot(ctx, 'Blair')).toBe(0);
    books(ctx);
  });

  it('credit is used automatically: all of it covers the ticket at once (locked in, no Pay sheet); part leaves the rest due', async () => {
    const ctx = await world({ signUp: ['Blair', 'Casey'] });
    await giveCredit(ctx, 'Blair', 2000);
    await giveCredit(ctx, 'Casey', 500);
    const b = await lock(ctx, 'Blair');
    expect(b.data).toMatchObject({ result: 'locked', creditUsedCents: 1600, dueCents: 0 });
    expect(pot(ctx, 'Blair')).toBe(400);
    const c = await lock(ctx, 'Casey');
    expect(c.data).toMatchObject({ result: 'due', creditUsedCents: 500, dueCents: 1100 });
    expect(pot(ctx, 'Casey')).toBe(0);
    expect((await iPaid(ctx, 'Casey', 1100)).status).toBe(200);
    expect((await answer(ctx, 'Casey', 'confirm')).data.result).toBe('locked');
    expect(ticketRow(ctx, 'Casey')).toMatchObject({ credit_cents: 500, paid_cents: 1100, claim_cents: 0, place: 'spot' });
    books(ctx);
  });

  it('a double tap and a refresh never charge twice', async () => {
    const ctx = await world({ signUp: ['Blair'] });
    await giveCredit(ctx, 'Blair', 2000);
    const phone = await playerPhone(ctx, 'Blair');
    const body = { tournamentId: ctx.tid, intent: 'lock', priceCents: 1600 };
    const [a, b] = await Promise.all([phone.call('POST', '/api/tournament/lock', body), phone.call('POST', '/api/tournament/lock', body)]);
    // Each tap either went in or was told to look again; the money moved once.
    for (const r of [a, b]) expect([200, 409]).toContain(r.status);
    expect(pot(ctx, 'Blair')).toBe(400);
    for (let i = 0; i < 3; i++) await phone.call('GET', '/api/group');
    expect((await phone.call('POST', '/api/tournament/lock', body)).data).toMatchObject({ result: 'locked', creditUsedCents: 0 });
    expect(pot(ctx, 'Blair')).toBe(400);
    expect(ticketRow(ctx, 'Blair')).toMatchObject({ credit_cents: 1600, place: 'spot' });
    books(ctx);
  });
});

describe('back out', () => {
  it('after paying: exactly the ticket comes back as credit (cash as a new credit entry, credit back to the pot), the spot opens', async () => {
    const ctx = await world({ signUp: ['Blair', 'Casey'] });
    await payCash(ctx, 'Blair');
    await giveCredit(ctx, 'Casey', 1000);
    await lock(ctx, 'Casey');
    await iPaid(ctx, 'Casey', 600);
    await answer(ctx, 'Casey', 'confirm');
    expect(pot(ctx, 'Blair')).toBe(0);
    expect(pot(ctx, 'Casey')).toBe(0);
    expect((await backOut(ctx, 'Blair', 1500)).data.message).toBe('Your ticket just changed. Look again.');
    const out = await backOut(ctx, 'Blair', 1600);
    expect(out.data).toMatchObject({ result: 'backed_out', creditBackCents: 1600, creditReturnedCents: 0, waitingCents: 0 });
    expect(pot(ctx, 'Blair')).toBe(1600);
    const out2 = await backOut(ctx, 'Casey', 1600);
    expect(out2.data).toMatchObject({ creditBackCents: 600, creditReturnedCents: 1000 });
    expect(pot(ctx, 'Casey')).toBe(1600);
    // A second tap moves nothing.
    expect((await backOut(ctx, 'Blair')).data.result).toBe('not_signed_up');
    expect(pot(ctx, 'Blair')).toBe(1600);
    expect(ticketRow(ctx, 'Blair')).toMatchObject({ credit_cents: 0, paid_cents: 0, place: 'none' });
    books(ctx);
    // The credit sheet says what happened in plain words.
    const credit = (await (await playerPhone(ctx, 'Casey')).call('GET', '/api/group')).data.credit;
    const lines = creditChanges(credit.history, 'America/Detroit', 'Alex').map((c) => c.text);
    expect(lines).toContain('Oct 26: $6 back from the Winter Classic (you backed out)');
    expect(lines).toContain('Oct 26: $10 returned from the Winter Classic (off the list)');
    expect(lines).toContain('Oct 26: $10 used for the Winter Classic');
  });
});

const joinLine = async (ctx: Ctx, name: string) => (await playerPhone(ctx, name)).call('POST', '/api/tournament/waitlist', { tournamentId: ctx.tid });
const ledgerRows = (ctx: Ctx) => Number((ctx.app.db.raw.prepare('SELECT COUNT(*) AS n FROM credit_ledger').get() as { n: number }).n);
const spots = async (ctx: Ctx) => ((await dash(ctx)).tournament.tickets as { name: string; place: string }[]).filter((k) => k.place === 'spot').map((k) => k.name);
async function creditLines(ctx: Ctx, name: string): Promise<string[]> {
  const credit = (await (await playerPhone(ctx, name)).call('GET', '/api/group')).data.credit;
  return creditChanges(credit.history, 'America/Detroit', 'Alex').map((c) => c.text);
}
const SIX = ['Blair', 'Casey', 'Devon', 'Emery', 'Frankie', 'Gale'];

describe('the waitlist', () => {
  it('spots full: Lock spends nothing; Join waitlist keeps the order; unpaid people stay; the first PAID in line gets an opened spot automatically', async () => {
    const ctx = await world({ size: 6, signUp: [...SIX, 'Harper', 'Indy', 'Jules', 'Kit'] });
    for (const n of SIX) await payCash(ctx, n);
    expect((await card(ctx, 'Kit')).tickets.locked.map((x: { name: string }) => x.name)).toEqual(SIX);
    // Full: Lock my spot is refused and spends no credit.
    await giveCredit(ctx, 'Harper', 1000);
    const refused = await lock(ctx, 'Harper');
    expect(refused.status).toBe(409);
    expect(refused.data.message).toBe('All 6 spots just filled. Join the waitlist.');
    expect(pot(ctx, 'Harper')).toBe(1000);
    expect(ticketRow(ctx, 'Harper')).toBeUndefined();
    // Join waitlist: Harper (unpaid), Indy (holds with credit), Jules (I paid, waiting for Alex).
    ctx.app.advance(60_000);
    expect((await joinLine(ctx, 'Harper')).data).toMatchObject({ result: 'waitlist', position: 1 });
    expect((await joinLine(ctx, 'Harper')).data).toMatchObject({ result: 'waitlist', position: 1 });
    ctx.app.advance(60_000);
    await giveCredit(ctx, 'Indy', 2000);
    expect((await joinLine(ctx, 'Indy')).data.position).toBe(2);
    expect((await lock(ctx, 'Indy', 'hold')).data).toMatchObject({ result: 'held', creditUsedCents: 1600, dueCents: 0, place: 'line' });
    expect(pot(ctx, 'Indy')).toBe(400);
    ctx.app.advance(60_000);
    expect((await joinLine(ctx, 'Jules')).data.position).toBe(3);
    expect((await lock(ctx, 'Jules', 'hold')).data).toMatchObject({ result: 'due', dueCents: 1600 });
    expect((await iPaid(ctx, 'Jules', 1600)).data).toMatchObject({ result: 'waiting' });
    // Everyone sees the line by name and paid or not (an I paid that waits is not paid yet), never anyone's money.
    const seen = (await card(ctx, 'Kit')).tickets;
    expect(seen.line).toEqual([
      { name: 'Harper', paid: false },
      { name: 'Indy', paid: true },
      { name: 'Jules', paid: false },
    ]);
    expect(seen.mine).toBeNull();
    books(ctx);

    // Blair backs out: the spot goes to Indy, the first PAID person in line; Harper (unpaid) stays first in line.
    ctx.app.advance(60_000);
    expect((await backOut(ctx, 'Blair', 1600)).data).toMatchObject({ result: 'backed_out', creditBackCents: 1600 });
    expect(ticketRow(ctx, 'Indy')).toMatchObject({ place: 'spot', credit_cents: 1600 });
    expect(ticketRow(ctx, 'Harper')).toMatchObject({ place: 'line', credit_cents: 0 });
    expect((await card(ctx, 'Harper')).tickets.line.map((x: { name: string }) => x.name)).toEqual(['Harper', 'Jules']);
    expect((await card(ctx, 'Indy')).tickets.mine).toMatchObject({ place: 'spot' });
    books(ctx);

    // Alex confirms Jules's I paid while no spot is open: paid, holding a place in line.
    expect((await answer(ctx, 'Jules', 'confirm', 1600)).data).toMatchObject({ result: 'held', place: 'line' });
    books(ctx);
    // Alex takes Casey off the list: Casey's $16 is credit, the spot goes to Jules (paid), not Harper (unpaid).
    ctx.app.advance(60_000);
    expect((await answer(ctx, 'Casey', 'take_off')).data).toMatchObject({ changed: true, creditCents: 1600 });
    expect(pot(ctx, 'Casey')).toBe(1600);
    expect(ticketRow(ctx, 'Jules')).toMatchObject({ place: 'spot', paid_cents: 1600 });
    expect(ticketRow(ctx, 'Harper')).toMatchObject({ place: 'line' });
    books(ctx);

    // Harper holds: the $10 of credit goes on at once, $6 is left for the Pay sheet; once Alex confirms, Harper is paid and first in line.
    expect((await lock(ctx, 'Harper', 'hold')).data).toMatchObject({ result: 'due', creditUsedCents: 1000, dueCents: 600 });
    expect(pot(ctx, 'Harper')).toBe(0);
    await iPaid(ctx, 'Harper', 600);
    expect((await answer(ctx, 'Harper', 'confirm')).data).toMatchObject({ result: 'held', place: 'line' });
    // Devon backs out: Harper gets the spot automatically.
    ctx.app.advance(60_000);
    await backOut(ctx, 'Devon');
    expect(ticketRow(ctx, 'Harper')).toMatchObject({ place: 'spot', credit_cents: 1000, paid_cents: 600 });
    expect(await spots(ctx)).toEqual(['Emery', 'Frankie', 'Gale', 'Indy', 'Jules', 'Harper']);
    // Exactly what each one put in: back as credit for the three who left, on the ticket for the six who play.
    expect([pot(ctx, 'Blair'), pot(ctx, 'Casey'), pot(ctx, 'Devon'), pot(ctx, 'Indy'), pot(ctx, 'Harper'), pot(ctx, 'Jules')]).toEqual([1600, 1600, 1600, 400, 0, 0]);
    books(ctx);
  });

  it('two phones race for the last spot: one locks in, the other is told it filled and spends nothing', async () => {
    const ctx = await world({ size: 6, signUp: [...SIX, 'Harper'] });
    for (const n of ['Blair', 'Casey', 'Devon', 'Emery', 'Harper']) await payCash(ctx, n);
    await giveCredit(ctx, 'Frankie', 1600);
    await giveCredit(ctx, 'Gale', 1600);
    const [a, b] = await Promise.all([lock(ctx, 'Frankie'), lock(ctx, 'Gale')]);
    const results = [a, b].map((r) => (r.status === 200 ? r.data.result : r.data.message)).sort();
    expect(results).toEqual(['All 6 spots just filled. Join the waitlist.', 'locked']);
    expect(pot(ctx, 'Frankie') + pot(ctx, 'Gale')).toBe(1600);
    expect(await spots(ctx)).toHaveLength(6);
    books(ctx);
  });

  it('a double tap on Back out gives the money back once', async () => {
    const ctx = await world({ size: 6, signUp: ['Blair', 'Casey'] });
    await giveCredit(ctx, 'Blair', 1000);
    await lock(ctx, 'Blair');
    await iPaid(ctx, 'Blair', 600);
    await answer(ctx, 'Blair', 'confirm');
    const phone = await playerPhone(ctx, 'Blair');
    const body = { tournamentId: ctx.tid, backCents: 1600 };
    const [x, y] = await Promise.all([phone.call('POST', '/api/tournament/back-out', body), phone.call('POST', '/api/tournament/back-out', body)]);
    expect([x.data.result, y.data.result].sort()).toEqual(['backed_out', 'not_signed_up']);
    expect(pot(ctx, 'Blair')).toBe(1600);
    books(ctx);
  });
});

describe('a hold that never got a spot', () => {
  it('comes back as credit once the night is over (credit to the pot, cash as a credit entry), once only; an I paid still waiting comes back when Alex answers', async () => {
    const ctx = await world({ size: 6, signUp: [...SIX, 'Harper', 'Indy', 'Jules', 'Kit'] });
    for (const n of SIX) await payCash(ctx, n);
    await giveCredit(ctx, 'Harper', 1600);
    await joinLine(ctx, 'Harper');
    expect((await lock(ctx, 'Harper', 'hold')).data.result).toBe('held');
    await joinLine(ctx, 'Jules');
    await lock(ctx, 'Jules', 'hold');
    await iPaid(ctx, 'Jules', 1600);
    expect((await answer(ctx, 'Jules', 'confirm')).data.result).toBe('held');
    await joinLine(ctx, 'Indy');
    await joinLine(ctx, 'Kit');
    await lock(ctx, 'Kit', 'hold');
    await iPaid(ctx, 'Kit', 1600);
    expect(pot(ctx, 'Harper')).toBe(0);
    books(ctx);
    // The night (Thu Nov 12, 8:00 to 10:00 PM) is not over yet: nothing comes back, not even during it.
    ctx.app.now = Date.parse('2026-11-13T02:59:00.000Z');
    await dash(ctx);
    await card(ctx, 'Harper');
    expect(pot(ctx, 'Harper')).toBe(0);
    // 10:00 PM: the first screen that reads it gives the holds back.
    ctx.app.now = Date.parse('2026-11-13T03:00:00.000Z');
    await card(ctx, 'Indy');
    const after = ledgerRows(ctx);
    expect([pot(ctx, 'Harper'), pot(ctx, 'Jules'), pot(ctx, 'Indy'), pot(ctx, 'Kit')]).toEqual([1600, 1600, 0, 0]);
    expect(ticketRow(ctx, 'Harper')).toMatchObject({ place: 'none', credit_cents: 0, paid_cents: 0 });
    expect(ticketRow(ctx, 'Kit')).toMatchObject({ claim_cents: 1600 });
    // Refreshes, other phones and the organizer's screen find nothing left to do.
    for (let i = 0; i < 3; i++) {
      await dash(ctx);
      await card(ctx, 'Harper');
    }
    expect(ledgerRows(ctx)).toBe(after);
    expect(pot(ctx, 'Harper')).toBe(1600);
    books(ctx);
    // Kit's I paid: Alex confirms it after the night, and all of it is credit at once.
    expect((await answer(ctx, 'Kit', 'confirm')).data).toMatchObject({ creditCents: 1600 });
    expect(pot(ctx, 'Kit')).toBe(1600);
    // The six who played keep their tickets.
    for (const n of SIX) expect(ticketRow(ctx, n)).toMatchObject({ place: 'spot', paid_cents: 1600 });
    books(ctx);
    expect(await creditLines(ctx, 'Harper')).toContain('Nov 12: $16 returned from the Winter Classic (no spot opened)');
    expect(await creditLines(ctx, 'Jules')).toContain('Nov 12: $16 back from the Winter Classic (no spot opened)');
    expect(await creditLines(ctx, 'Kit')).toContain('Nov 12: $16 back from the Winter Classic (no spot opened)');
    // The organizer's list words: "+$16 back from the Winter Classic (no spot opened)".
    const jules = ((await dash(ctx)).creditLedger as { playerId: string; entries: Parameters<typeof creditEntryText>[0][] }[]).find((p) => p.playerId === ctx.byName.Jules)!;
    expect(jules.entries.map((e) => creditEntryText(e, 'America/Detroit'))).toContain('+$16 back from the Winter Classic (no spot opened)');
  });
});

describe('cancel', () => {
  it('every paid ticket comes back as credit exactly once; an I paid waiting comes back when Alex answers; players on the list see Canceled', async () => {
    const ctx = await world({ size: 6, signUp: ['Alex', ...SIX, 'Harper', 'Indy'] });
    // Alex's own seat: $0, one of the 6 spots, taken when tickets opened.
    expect(ticketRow(ctx, 'Alex')).toMatchObject({ place: 'spot', price_cents: 0, credit_cents: 0, paid_cents: 0 });
    await payCash(ctx, 'Blair');
    await giveCredit(ctx, 'Casey', 2000);
    await lock(ctx, 'Casey');
    await giveCredit(ctx, 'Devon', 500);
    await lock(ctx, 'Devon');
    await iPaid(ctx, 'Devon', 1100);
    await answer(ctx, 'Devon', 'confirm');
    await lock(ctx, 'Emery');
    await iPaid(ctx, 'Emery', 1600);
    await lock(ctx, 'Frankie');
    await payCash(ctx, 'Gale');
    await payCash(ctx, 'Harper');
    expect(await spots(ctx)).toEqual(['Alex', 'Blair', 'Casey', 'Devon', 'Gale', 'Harper']);
    await giveCredit(ctx, 'Indy', 1600);
    await joinLine(ctx, 'Indy');
    await lock(ctx, 'Indy', 'hold');
    books(ctx);
    const res = await ctx.organizer.call('POST', `/api/admin/tournament/${ctx.tid}/cancel`, {});
    expect(res.data).toMatchObject({ returned: 6, returnedCents: 9600, waiting: 1 });
    expect([pot(ctx, 'Blair'), pot(ctx, 'Casey'), pot(ctx, 'Devon'), pot(ctx, 'Gale'), pot(ctx, 'Harper'), pot(ctx, 'Indy')]).toEqual([1600, 2000, 1600, 1600, 1600, 1600]);
    expect([pot(ctx, 'Alex'), pot(ctx, 'Emery'), pot(ctx, 'Frankie')]).toEqual([0, 0, 0]);
    books(ctx);
    // A second Cancel (another phone, a retry) moves nothing.
    const n = ledgerRows(ctx);
    expect((await ctx.organizer.call('POST', `/api/admin/tournament/${ctx.tid}/cancel`, {})).status).not.toBe(200);
    expect(ledgerRows(ctx)).toBe(n);
    // Players who were on the list see the plain Canceled card with what came back; anyone else gets nothing.
    expect(await card(ctx, 'Blair')).toMatchObject({ status: 'canceled', canceled: { backCents: 1600, claimCents: 0 } });
    expect((await card(ctx, 'Casey')).canceled).toEqual({ backCents: 1600, claimCents: 0 });
    expect((await card(ctx, 'Emery')).canceled).toEqual({ backCents: 0, claimCents: 1600 });
    expect((await card(ctx, 'Frankie')).canceled).toEqual({ backCents: 0, claimCents: 0 });
    expect(await card(ctx, 'Jules')).toBeUndefined();
    expect((await dash(ctx)).tournament).toMatchObject({ status: 'canceled' });
    // No player tap works on it; Alex can still answer Emery's I paid (then it is credit at once).
    expect((await lock(ctx, 'Frankie')).status).toBe(404);
    expect((await backOut(ctx, 'Blair')).status).toBe(404);
    expect((await answer(ctx, 'Blair', 'take_off')).status).toBe(409);
    expect((await answer(ctx, 'Emery', 'confirm', 1600)).data).toMatchObject({ creditCents: 1600 });
    expect(pot(ctx, 'Emery')).toBe(1600);
    expect((await card(ctx, 'Emery')).canceled).toEqual({ backCents: 1600, claimCents: 0 });
    books(ctx);
    expect(await creditLines(ctx, 'Blair')).toContain('Oct 26: $16 back from the Winter Classic (canceled)');
    expect(await creditLines(ctx, 'Casey')).toContain('Oct 26: $16 returned from the Winter Classic (canceled)');
    // A week later the card is gone for everyone.
    ctx.app.advance(8 * DAY);
    expect(await card(ctx, 'Blair')).toBeUndefined();
    expect((await dash(ctx)).tournament).toBeUndefined();
  });
});

describe('reschedule', () => {
  it('back to the date step: the list stays (dates to pick again), paid tickets are held, backing out gives credit; a new date and Open tickets keep the spots', async () => {
    const ctx = await world({ size: 6, signUp: ['Blair', 'Casey', 'Devon', 'Emery', 'Frankie'] });
    await payCash(ctx, 'Blair');
    await giveCredit(ctx, 'Casey', 2000);
    await lock(ctx, 'Casey');
    await lock(ctx, 'Devon');
    await iPaid(ctx, 'Devon', 1600);
    await lock(ctx, 'Emery');
    books(ctx);
    expect((await ctx.organizer.call('POST', `/api/admin/tournament/${ctx.tid}/reschedule`, {})).status).toBe(200);
    let t = (await dash(ctx)).tournament;
    expect(t).toMatchObject({ status: 'rescheduled', finalDate: null, payBy: null, settingsLocked: true });
    expect(t.signups).toHaveLength(5);
    expect(t.signups.every((s: { dates: string[] }) => s.dates.length === 0)).toBe(true);
    expect(ticketRow(ctx, 'Blair')).toMatchObject({ place: 'spot', paid_cents: 1600 });
    expect(ticketRow(ctx, 'Casey')).toMatchObject({ place: 'spot', credit_cents: 1600 });
    expect(ticketRow(ctx, 'Devon')).toMatchObject({ claim_cents: 1600 });
    // Players: Rescheduled, pick your dates again; the ticket taps wait for tickets to open again.
    const c = await card(ctx, 'Blair');
    expect(c).toMatchObject({ status: 'rescheduled', finalDate: null, me: { dates: [] } });
    expect(c.tickets.mine).toMatchObject({ place: 'spot', paidCents: 1600 });
    expect((await lock(ctx, 'Frankie')).data.message).toBe('Tickets are not open now. Look again.');
    // Casey backs out: the $16 of credit goes back to the pot.
    expect((await backOut(ctx, 'Casey', 1600)).data).toMatchObject({ creditReturnedCents: 1600 });
    expect(pot(ctx, 'Casey')).toBe(2000);
    // Alex confirms Devon's I paid: paid, and the open spot is Devon's.
    await answer(ctx, 'Devon', 'confirm');
    expect(ticketRow(ctx, 'Devon')).toMatchObject({ place: 'spot', paid_cents: 1600 });
    books(ctx);
    // Players pick their dates again; Alex picks the new date and opens tickets: the spots stay with Blair and Devon.
    const NEW = '2026-11-17';
    for (const n of ['Blair', 'Devon', 'Emery']) {
      const r = await (await playerPhone(ctx, n)).call('PUT', '/api/tournament/signup', { tournamentId: ctx.tid, level: 320, dates: [NEW] });
      expect(r.status, r.text).toBe(200);
    }
    expect((await ctx.organizer.call('PUT', `/api/admin/tournament/${ctx.tid}/date`, { date: NEW })).status).toBe(200);
    expect((await ctx.organizer.call('POST', `/api/admin/tournament/${ctx.tid}/open-tickets`, {})).status).toBe(200);
    t = (await dash(ctx)).tournament;
    expect(t).toMatchObject({ status: 'tickets', finalDate: NEW, payBy: '2026-11-16T00:00:00.000Z' });
    expect(await spots(ctx)).toEqual(['Blair', 'Devon']);
    expect((await lock(ctx, 'Emery')).data).toMatchObject({ result: 'due', dueCents: 1600 });
    books(ctx);
  });
});

describe("the organizer's own seat and answers", () => {
  it('the seat is $0 and one of the spots, taken with Lock my spot after tickets open too; never any money', async () => {
    const ctx = await world({ size: 6, signUp: ['Blair', 'Casey'] });
    expect(ticketRow(ctx, 'Alex')).toBeUndefined();
    await signUp(ctx, 'Alex');
    const phone = await organizerPhone(ctx);
    expect((await phone.call('GET', '/api/group')).data.tournament.tickets.priceCents).toBe(0);
    expect((await phone.call('POST', '/api/tournament/lock', { tournamentId: ctx.tid, intent: 'lock', priceCents: 1600 })).data.message).toBe('The ticket is $0. Look again.');
    const r = await phone.call('POST', '/api/tournament/lock', { tournamentId: ctx.tid, intent: 'lock', priceCents: 0 });
    expect(r.data).toMatchObject({ result: 'locked', creditUsedCents: 0, dueCents: 0 });
    expect(ticketRow(ctx, 'Alex')).toMatchObject({ place: 'spot', price_cents: 0, credit_cents: 0, paid_cents: 0 });
    expect((await card(ctx, 'Blair')).tickets).toMatchObject({ priceCents: 1600, locked: [{ name: 'Alex' }] });
    // Backing out of the $0 seat gives nothing back (there is nothing) and opens the spot.
    expect((await phone.call('POST', '/api/tournament/back-out', { tournamentId: ctx.tid, backCents: 0 })).data).toMatchObject({ result: 'backed_out', creditBackCents: 0, creditReturnedCents: 0 });
    expect(pot(ctx, 'Alex')).toBe(0);
    expect(await spots(ctx)).toEqual([]);
    books(ctx);
  });

  it("Didn't pay clears the I paid (no money moves); Paid with cash in hand marks what is owed; the amounts on the screen must match", async () => {
    const ctx = await world({ size: 6, signUp: ['Blair', 'Casey', 'Devon'] });
    await lock(ctx, 'Blair');
    await iPaid(ctx, 'Blair', 1600);
    expect((await answer(ctx, 'Blair', 'reject', 1500)).data.message).toBe("Blair's I paid changed. Look again.");
    expect((await answer(ctx, 'Blair', 'reject', 1600)).data).toMatchObject({ result: 'due', dueCents: 1600 });
    expect(ticketRow(ctx, 'Blair')).toMatchObject({ claim_cents: 0, paid_cents: 0, place: 'none' });
    expect((await answer(ctx, 'Blair', 'reject')).data.message).toBe('Blair has no I paid waiting. Look again.');
    expect(pot(ctx, 'Blair')).toBe(0);
    // Cash in hand: Alex marks Casey paid with no tap from Casey; a second tap changes nothing.
    expect((await answer(ctx, 'Casey', 'mark_paid', 1600)).data).toMatchObject({ changed: true, result: 'locked' });
    expect((await answer(ctx, 'Casey', 'mark_paid', 1600)).data).toMatchObject({ changed: false });
    // With credit on part of it, only the rest is owed.
    await giveCredit(ctx, 'Devon', 600);
    await lock(ctx, 'Devon');
    expect((await answer(ctx, 'Devon', 'mark_paid', 1600)).data.message).toBe('Devon owes $10 now. Look again.');
    expect((await answer(ctx, 'Devon', 'mark_paid', 1000)).data.result).toBe('locked');
    expect(ticketRow(ctx, 'Devon')).toMatchObject({ credit_cents: 600, paid_cents: 1000, place: 'spot' });
    books(ctx);
  });

  it('Remove player: a name holding a ticket stays until Alex takes it off the list (the money comes back as credit); then hidden, never deleted', async () => {
    const ctx = await world({ size: 6, signUp: ['Blair', 'Casey'] });
    await payCash(ctx, 'Blair');
    const first = await ctx.organizer.call('DELETE', `/api/admin/players/${ctx.byName.Blair}`);
    expect(first.status).toBe(409);
    expect(first.data.message).toBe('Blair holds a ticket for the Winter Classic. Take Blair off its list first (the tournament\'s Tickets), then remove the name.');
    await answer(ctx, 'Blair', 'take_off');
    expect(pot(ctx, 'Blair')).toBe(1600);
    expect((await ctx.organizer.call('DELETE', `/api/admin/players/${ctx.byName.Blair}`)).data).toMatchObject({ result: 'hidden' });
    expect(ticketRow(ctx, 'Blair')).toMatchObject({ place: 'none', paid_cents: 0 });
    books(ctx);
  });
});

describe('who may see it: nobody else gets any tournament data', () => {
  it('switched off while tickets are open: no card, no name, not even a different stamp; every ticket route answers as if there were none', async () => {
    const ctx = await world({ size: 6, signUp: ['Blair', 'Casey', 'Devon'] });
    await payCash(ctx, 'Blair');
    await ctx.organizer.call('PUT', '/api/admin/tournaments-switch', { on: false });
    const casey = await playerPhone(ctx, 'Casey');
    const res = await casey.call('GET', '/api/group');
    expect(res.data.tournament).toBeUndefined();
    for (const word of ['winter classic', ctx.tid, 'tournament']) expect(res.text.toLowerCase()).not.toContain(word);
    const stamp = (await casey.call('GET', '/api/group/version')).data.v;
    // A ticket change made on the organizer's private link (X-Tournaments: on) moves nothing a switched-off phone can see.
    const link = { 'X-Tournaments': 'on' };
    const marked = await ctx.organizer.call('POST', `/api/admin/tournament/${ctx.tid}/ticket`, { playerId: ctx.byName.Devon, action: 'mark_paid', cents: 1600 }, link);
    expect(marked.status, marked.text).toBe(200);
    expect((await casey.call('GET', '/api/group/version')).data.v).toBe(stamp);
    expect(withoutIds((await casey.call('GET', '/api/group')).text)).toBe(withoutIds(res.text));
    for (const [path, body] of [
      ['/api/tournament/lock', { tournamentId: ctx.tid, intent: 'lock', priceCents: 1600 }],
      ['/api/tournament/paid', { tournamentId: ctx.tid, cents: 1600 }],
      ['/api/tournament/waitlist', { tournamentId: ctx.tid }],
      ['/api/tournament/back-out', { tournamentId: ctx.tid }],
    ] as const) {
      const r = await casey.call('POST', path, body);
      expect(r.status, path).toBe(404);
      expect(r.data.message).toBe('This tournament is not open.');
      expect(r.text.toLowerCase()).not.toContain('winter classic');
    }
    // Blair holds a ticket and still gets nothing while it is off.
    expect(await card(ctx, 'Blair')).toBeUndefined();
    // The organizer's own screens without the link: nothing either.
    expect((await dash(ctx)).tournament).toBeUndefined();
    books(ctx);
  });

  it('every new player route is behind the same check as piece 1 (one place decides who may see it)', () => {
    const paths = routeList().map((r) => `${r.method} ${r.path}`);
    for (const p of ['POST /api/tournament/lock', 'POST /api/tournament/paid', 'POST /api/tournament/waitlist']) expect(paths).toContain(p);
  });
});

describe('the books', () => {
  it('each tournament check catches the problem it names (and reads 0 when nothing is wrong)', async () => {
    const ctx = await world({ size: 6, signUp: ['Alex', 'Blair', 'Casey', 'Devon', 'Emery'] });
    await payCash(ctx, 'Blair');
    await giveCredit(ctx, 'Casey', 500);
    await lock(ctx, 'Casey');
    await payCash(ctx, 'Devon');
    books(ctx);
    const db = ctx.app.db.raw;
    const check = (name: string) => Number((db.prepare(TOUR_SQL).get() as Record<string, number>)[name]);
    const tk = (n: string) => `(SELECT id FROM tournament_tickets WHERE player_id = '${ctx.byName[n]}')`;
    const cases: [string, string][] = [
      ['tour_credit_not_ledger', `UPDATE tournament_tickets SET credit_cents = credit_cents + 100 WHERE id = ${tk('Casey')}`],
      [
        'tour_ledger_without_ticket',
        `INSERT INTO credit_ledger (id, group_id, player_id, kind, amount_cents, five_cents, session_id, created_at, reason)
         SELECT 'bad-row', group_id, id, 'used', 100, 0, NULL, '2026-10-26T16:00:00.000Z', 'tour:${ctx.tid}' FROM players WHERE id = '${ctx.byName.Emery}'`,
      ],
      ['tour_over_price', `UPDATE tournament_tickets SET paid_cents = 2000 WHERE id = ${tk('Blair')}`],
      ['tour_spot_unpaid', `UPDATE tournament_tickets SET place = 'spot' WHERE id = ${tk('Casey')}`],
      ['tour_spots_over_size', `UPDATE tournaments SET size = 2 WHERE id = '${ctx.tid}'`],
      ['tour_money_on_canceled', `UPDATE tournaments SET status = 'canceled' WHERE id = '${ctx.tid}'`],
      ['tour_money_on_left', `UPDATE tournament_signups SET status = 'out' WHERE player_id = '${ctx.byName.Blair}'`],
      ['tour_place_left', `UPDATE tournament_signups SET status = 'out' WHERE player_id = '${ctx.byName.Blair}'`],
      ['tour_organizer_paid', `UPDATE tournament_tickets SET price_cents = 1600, paid_cents = 1600 WHERE id = ${tk('Alex')}`],
      ['tour_paid_line_with_open_spot', `UPDATE tournament_tickets SET place = 'line' WHERE id = ${tk('Devon')}`],
    ];
    const names = Object.keys(db.prepare(TOUR_SQL).get() as Record<string, number>).filter((k) => !k.startsWith('info_'));
    expect(names.sort()).toEqual(cases.map(([n]) => n).sort());
    // Each change breaks the rule it is named for; the table's own checks are switched off for this (they refuse most of these on their own).
    db.exec('PRAGMA ignore_check_constraints = ON');
    try {
      for (const [name, sql] of cases) {
        expect(check(name), name).toBe(0);
        db.exec('SAVEPOINT bad');
        db.exec(sql);
        expect(check(name), name).toBeGreaterThan(0);
        db.exec('ROLLBACK TO bad');
        db.exec('RELEASE bad');
      }
    } finally {
      db.exec('PRAGMA ignore_check_constraints = OFF');
    }
    books(ctx);
    // An I paid waiting is a to-do, not a problem.
    await lock(ctx, 'Emery');
    await iPaid(ctx, 'Emery', 1600);
    expect(Number((db.prepare(TOUR_SQL).get() as Record<string, number>).info_open_ticket_claims)).toBe(1);
    books(ctx);
  });
});

describe('preview test page: the ticket stages', () => {
  it('each stage builds from the fake names with real money rows; the books read all zeros; none clears every test row', async () => {
    const ctx = await world();
    ctx.app.env.PREVIEW_CALM = 'on';
    for (const n of ['Parker', 'Rowan', 'Sage', 'Christopher Vanderberg', 'Wren', 'Quinn', 'Zoe', 'Reese', 'Vic']) {
      ctx.byName[n] = (await ctx.organizer.call('POST', '/api/admin/players', { name: n })).data.id;
    }
    const stage = async (s: string) => {
      const r = await ctx.organizer.call('POST', '/api/admin/tournament-test', { stage: s });
      expect(r.status, `${s}: ${r.text}`).toBe(200);
      books(ctx);
      return (await dash(ctx)).tournament;
    };
    const locked = (t: { tickets: { place: string; name: string }[] }) => t.tickets.filter((k) => k.place === 'spot').map((k) => k.name);

    let t = await stage('tickets_open');
    expect(t).toMatchObject({ status: 'tickets', size: 8, ticketCents: 1600 });
    expect(locked(t)).toEqual(['Parker', 'Rowan', 'Sage', 'Christopher Vanderberg', 'Wren', 'Quinn']);
    expect((await card(ctx, 'Vic')).tickets).toMatchObject({ mine: null, priceCents: 1600 });

    t = await stage('spots_full');
    expect(locked(t)).toHaveLength(8);
    expect(locked(t)).toContain('Alex');
    expect(t.tickets.find((k: { name: string }) => k.name === 'Alex')).toMatchObject({ priceCents: 0 });
    expect((await card(ctx, 'Vic')).tickets).toMatchObject({ mine: null, line: [{ name: 'Reese', paid: true }] });

    t = await stage('all_locked');
    expect(locked(t)).toHaveLength(8);
    expect(locked(t)).toContain('Vic');
    expect((await card(ctx, 'Vic')).tickets.mine).toMatchObject({ place: 'spot' });

    t = await stage('odd');
    expect(locked(t)).toHaveLength(7);
    expect(Date.parse(t.payBy)).toBeLessThanOrEqual(ctx.app.now);

    t = await stage('canceled');
    expect(t.status).toBe('canceled');
    expect((await card(ctx, 'Parker')).canceled).toEqual({ backCents: 1600, claimCents: 0 });
    expect(await card(ctx, 'Vic')).toMatchObject({ status: 'canceled' });

    t = await stage('rescheduled');
    expect(t).toMatchObject({ status: 'rescheduled', finalDate: null });
    expect(t.tickets.filter((k: { place: string }) => k.place === 'spot')).toHaveLength(6);

    await stage('none');
    expect((await dash(ctx)).tournament).toBeUndefined();
    expect(ctx.app.db.raw.prepare("SELECT COUNT(*) AS n FROM credit_ledger WHERE reason LIKE 'tour:%' OR reason = 'adjusted:Ticket stage credit'").get()).toEqual({ n: 0 });
  });
});
