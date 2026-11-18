import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DAY, playerPhone, setupGroup, withoutIds } from './harness';
import { defaultPayBy, evensWarning, payByLabel, placeWord, ticketOwed, ticketsLine } from '../shared/tournamentTickets';
import { courtCentsOf, MAX_SPOTS, NIGHT_START_MINUTES, organizerCost, plannedSize, prizeCentsOf, smartPlan } from '../shared/tournament';
import { creditChanges, creditEntryText } from '../shared/credit';
import { routeList } from '../server/app';
import { createNodeD1 } from '../dev/nodeD1';
import { backupToSql } from '../scripts/restore-backup.mjs';

// Zip 56, Tournaments piece 2 (server/tournamentTickets.ts, server/tournamentMoney.ts): tickets, the waitlist, paying, backing out, cancel and
// reschedule, with Alex's changes after testing piece 1: picking the date opens tickets, the spots follow the players locked in (the smart plan,
// 6 to 12; the waitlist starts after 12), a level is picked once. Every money proof the brief asks for, to the cent, with the books checked
// after each step: the integrity checks (the older file and the new tournament file) read all zeros and every pot is exactly what the steps say.
// The clock is Monday Oct 26, 2026, 12 PM Eastern (tests/harness.ts). The tournament is on Thu Nov 12 (the night: 7:00 to 10:00 PM Eastern);
// picking it sets Pay by to Tue Nov 10, 7:00 PM.

type Ctx = Awaited<ReturnType<typeof setupGroup>> & { tid: string };

const DATE = '2026-11-12';
const DATES = ['2026-11-03', '2026-11-05', '2026-11-10', DATE, '2026-11-17'];
const BASE = { name: 'Winter Classic', dates: DATES, ticketCents: 1600, creditCents: 1400, visibility: 'all' };
// The harness's six (Alex, Blair, Casey, Devon, Emery, Frankie) and these: 16 players besides the organizer, enough to fill 12 spots and wait.
const MORE = ['Gale', 'Harper', 'Indy', 'Jules', 'Kit', 'Kai', 'Lee', 'Lane', 'Morgan', 'Jordan', 'Avery'];
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

/** The group, every player, the switch on, Create, the given names signed up, and (unless `open` is false) the date picked: tickets open. */
async function world(opts: { open?: boolean; signUp?: string[]; format?: 'doubles' | 'americano' } = {}): Promise<Ctx> {
  const base = await setupGroup();
  await base.organizer.call('PUT', '/api/admin/group', { organizerName: 'Alex' });
  for (const [i, name] of MORE.entries()) expect((await base.organizer.call('POST', '/api/admin/players', { name, phone: `(313) 555-02${String(i).padStart(2, '0')}` })).status).toBe(200);
  const players = (await base.organizer.call('GET', '/api/admin/dashboard')).data.players as { id: string; name: string }[];
  const byName = Object.fromEntries(players.map((p) => [p.name, p.id]));
  expect((await base.organizer.call('PUT', '/api/admin/tournaments-switch', { on: true })).status).toBe(200);
  expect((await base.organizer.call('PUT', '/api/admin/adjust-credit-switch', { on: true })).status).toBe(200);
  const created = await base.organizer.call('POST', '/api/admin/tournament', { ...BASE, ...(opts.format ? { format: opts.format, secondCreditCents: 700 } : {}) });
  expect(created.status, created.text).toBe(200);
  const ctx: Ctx = { ...base, byName, players, tid: created.data.id };
  for (const name of opts.signUp ?? []) await signUp(ctx, name);
  if (opts.open !== false && opts.signUp) {
    const res = await ctx.organizer.call('PUT', `/api/admin/tournament/${ctx.tid}/date`, { date: DATE });
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
    expect(defaultPayBy(DATE, NIGHT_START_MINUTES, 'America/Detroit', now)).toBe('2026-11-11T00:00:00.000Z'); // Tue Nov 10, 7:00 PM EST
    // Picked late (Wed Nov 11, 9 AM): the day before at 7:00 PM.
    expect(defaultPayBy(DATE, NIGHT_START_MINUTES, 'America/Detroit', Date.parse('2026-11-11T14:00:00.000Z'))).toBe('2026-11-12T00:00:00.000Z');
    // Picked on the day (Thu 2 PM): one hour before the night starts (6:00 PM).
    expect(defaultPayBy(DATE, NIGHT_START_MINUTES, 'America/Detroit', Date.parse('2026-11-12T19:00:00.000Z'))).toBe('2026-11-12T23:00:00.000Z');
    expect(payByLabel('2026-11-11T00:00:00.000Z', 'America/Detroit', DATE)).toBe('Tue 7:00 PM');
    expect(payByLabel('2026-11-04T00:00:00.000Z', 'America/Detroit', DATE)).toBe('Tue, Nov 3, 7:00 PM');
    expect(evensWarning(7)).toBe('7 locked in. Need 1 more or 1 less.');
    expect(ticketsLine(6, 8)).toBe('Tickets: 6 of 8 locked in');
    expect([1, 2, 3, 4, 11, 21, 22].map(placeWord)).toEqual(['first', 'second', 'third', '4th', '11th', '21st', '22nd']);
    expect(ticketOwed({ priceCents: 1600, creditCents: 500, paidCents: 0, claimCents: 0 })).toBe(1100);
  });

  it("Alex's smart plan: locked in rounded up to even, plus 2, 6 to 12; that size's plan; the organizer's cost", () => {
    expect([0, 1, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13].map(plannedSize)).toEqual([6, 6, 6, 6, 8, 8, 10, 10, 12, 12, 12, 12, 12]);
    expect([0, 5, 7, 9].map(smartPlan)).toEqual([
      { size: 6, courts: 1, minutes: 150, start: 1170 },
      { size: 8, courts: 2, minutes: 120, start: 1170 },
      { size: 10, courts: 2, minutes: 150, start: 1170 },
      { size: 12, courts: 2, minutes: 180, start: 1140 },
    ]);
    // $24 an hour per court (SITE_RULES: $48, $60, $72 a court).
    expect([0, 5, 7, 9].map((l) => courtCentsOf(smartPlan(l)))).toEqual([6000, 9600, 12000, 14400]);
    expect(prizeCentsOf('doubles', 1400, 700)).toBe(2800);
    expect(prizeCentsOf('americano', 1400, 700)).toBe(2100);
    // 8 players, 2 courts, 2 hours: $96 court, 7 tickets of $16 = $112 if it fills, $28 of credits: $12; with 5 paid now: $96 - $80 + $28 = $44.
    expect(organizerCost(smartPlan(6), 1600, 2800, 5)).toEqual({ courtCents: 9600, ifFillsCents: 1200, nowCents: 4400 });
    // 12 players, 2 courts, 3 hours, Americano: $144 - 11 x $16 + $21 = -$11 (tickets more than cover it).
    expect(organizerCost(smartPlan(11), 1600, 2100, 11).ifFillsCents).toBe(-1100);
    expect(MAX_SPOTS).toBe(12);
  });
});

describe('picking the date opens tickets (Alex: no Open tickets button)', () => {
  it('Pay by is set, the price and format lock, players on the list see Lock my spot with 6 spots; the organizer on the list has the $0 seat', async () => {
    const ctx = await world({ signUp: ['Alex', 'Blair', 'Casey'] });
    const t = (await dash(ctx)).tournament;
    expect(t).toMatchObject({ status: 'tickets', payBy: '2026-11-11T00:00:00.000Z', settingsLocked: true, formatLocked: true, closed: false, ticketCents: 1600 });
    // The organizer's own seat ($0) was taken in the same tap: 1 locked in, so 6 spots (the plan for 6: 1 court, 2.5 hours).
    expect(t).toMatchObject({ size: 6, courts: 1, minutes: 150 });
    expect(t.tickets).toEqual([expect.objectContaining({ name: 'Alex', place: 'spot', priceCents: 0, organizer: true })]);
    const c = await card(ctx, 'Blair');
    expect(c.status).toBe('tickets');
    expect(c.tickets).toEqual({ size: 6, full: false, priceCents: 1600, payBy: '2026-11-11T00:00:00.000Z', closed: false, locked: [{ name: 'Alex' }], line: [], mine: null });
    // The price stays once tickets are open; Only me is refused; a size or plan sent is simply ignored.
    expect((await ctx.organizer.call('PUT', `/api/admin/tournament/${ctx.tid}`, { ...BASE, ticketCents: 2000 })).data.message).toBe('Tickets have been sold. The price stays $16.');
    expect((await ctx.organizer.call('PUT', `/api/admin/tournament/${ctx.tid}`, { ...BASE, size: 10, start: 1200 })).status).toBe(200);
    expect((await ctx.organizer.call('PUT', `/api/admin/tournament/${ctx.tid}/visibility`, { visibility: 'me' })).data.message).toBe('Players have tickets. It stays on Everyone.');
    // A second pick: the date stays (Cancel or reschedule moves it). There is no Open tickets route any more.
    expect((await ctx.organizer.call('PUT', `/api/admin/tournament/${ctx.tid}/date`, { date: DATES[4] })).data.message).toBe('Tickets are open. Reschedule to change the date.');
    expect((await ctx.organizer.call('POST', `/api/admin/tournament/${ctx.tid}/open-tickets`, {})).status).toBe(404);
    // History: the date, then the tickets.
    const lines = (await ctx.organizer.call('GET', '/api/admin/activity')).data.entries.map((e: { action: string }) => e.action);
    expect(lines).toEqual(expect.arrayContaining(['tournament_date', 'tournament_tickets_opened']));
    books(ctx);
  });

  it('a date whose night has started cannot be picked; the organizer can change Pay by while tickets are open', async () => {
    const ctx = await world({ signUp: ['Blair'], open: false });
    ctx.app.now = Date.parse('2026-11-13T00:30:00.000Z'); // Thu Nov 12, 7:30 PM Eastern: the night has started
    const late = await ctx.organizer.call('PUT', `/api/admin/tournament/${ctx.tid}/date`, { date: DATE });
    expect(late.data.message).toBe('That night has started. Pick another date.');
    ctx.app.now = Date.parse('2026-10-26T16:00:00.000Z');
    expect((await ctx.organizer.call('PUT', `/api/admin/tournament/${ctx.tid}/date`, { date: DATE })).status).toBe(200);
    const moved = await ctx.organizer.call('PUT', `/api/admin/tournament/${ctx.tid}/pay-by`, { payBy: '2026-11-09T00:00:00.000Z' });
    expect(moved.status, moved.text).toBe(200);
    expect((await card(ctx, 'Blair')).tickets.payBy).toBe('2026-11-09T00:00:00.000Z');
    // Not after the night starts (7:00 PM on the day).
    expect((await ctx.organizer.call('PUT', `/api/admin/tournament/${ctx.tid}/pay-by`, { payBy: '2026-11-13T00:30:00.000Z' })).data.message).toBe('Pick a Pay by time before the tournament starts.');
  });

  it('a date picked before this change (piece 1 on live) opens tickets the first time a screen reads it, the same way', async () => {
    const ctx = await world({ signUp: ['Alex', 'Blair'], open: false });
    // Exactly what piece 1 left: status date_picked, no Pay by.
    ctx.app.db.raw.prepare("UPDATE tournaments SET status = 'date_picked', final_date = ?, date_picked_at = ? WHERE id = ?").run(DATE, '2026-10-26T15:00:00.000Z', ctx.tid);
    const c = await card(ctx, 'Blair');
    expect(c).toMatchObject({ status: 'tickets', finalDate: DATE });
    expect(c.tickets).toMatchObject({ payBy: '2026-11-11T00:00:00.000Z', locked: [{ name: 'Alex' }] });
    expect((await dash(ctx)).tournament).toMatchObject({ status: 'tickets', payBy: '2026-11-11T00:00:00.000Z' });
    books(ctx);
  });
});

describe('the smart plan on the organizer\'s screens', () => {
  it('follows the players locked in: 6, 8, 10, 12 spots; the cost if it fills and with N paid now; the start moves to 7:00 PM for 3 hours', async () => {
    const names = ['Blair', 'Casey', 'Devon', 'Emery', 'Frankie', 'Gale', 'Harper', 'Indy', 'Jules', 'Kit', 'Kai'];
    const ctx = await world({ signUp: ['Alex', ...names] });
    const plan = async () => {
      const t = (await dash(ctx)).tournament;
      return { size: t.size, courts: t.courts, minutes: t.minutes, start: t.start, cost: t.cost };
    };
    // Alex's $0 seat only: 6 spots, 1 court, 2.5 hours. Court $60; 5 tickets of $16 if it fills; $28 of credits: $60 - $80 + $28 = $8.
    expect(await plan()).toEqual({ size: 6, courts: 1, minutes: 150, start: 1170, cost: { courtCents: 6000, ifFillsCents: 800, nowCents: 8800, paidNow: 0 } });
    for (const n of names.slice(0, 5)) await payCash(ctx, n);
    // 6 locked in (Alex + 5 paid): 8 spots, 2 courts, 2 hours: $96 - $112 + $28 = $12; with 5 paid now: $96 - $80 + $28 = $44.
    expect(await plan()).toEqual({ size: 8, courts: 2, minutes: 120, start: 1170, cost: { courtCents: 9600, ifFillsCents: 1200, nowCents: 4400, paidNow: 5 } });
    expect((await card(ctx, 'Kai')).tickets).toMatchObject({ size: 8, full: false });
    expect((await card(ctx, 'Kai'))).toMatchObject({ start: 1170, minutes: 120 });
    await payCash(ctx, names[5]);
    // 7: 10 spots, 2 courts, 2.5 hours.
    expect(await plan()).toMatchObject({ size: 10, courts: 2, minutes: 150 });
    for (const n of names.slice(6, 10)) await payCash(ctx, n);
    // 11: 12 spots, 2 courts, 3 hours, starting at 7:00 PM. $144 - 11 x $16 + $28 = -$4 (the tickets cover it); 10 paid now: $144 - $160 + $28 = $12.
    expect(await plan()).toEqual({ size: 12, courts: 2, minutes: 180, start: 1140, cost: { courtCents: 14400, ifFillsCents: -400, nowCents: 1200, paidNow: 10 } });
    expect(await card(ctx, 'Kai')).toMatchObject({ start: 1140, minutes: 180 });
    // A drop moves it back down at once.
    await backOut(ctx, 'Blair');
    expect(await plan()).toMatchObject({ size: 12, minutes: 180 });
    await backOut(ctx, 'Casey');
    expect(await plan()).toMatchObject({ size: 12 });
    await backOut(ctx, 'Devon');
    expect(await plan()).toMatchObject({ size: 10, minutes: 150 });
    books(ctx);
  });

  it("Americano's credits are 1st plus 2nd place", async () => {
    const ctx = await world({ signUp: ['Alex', 'Blair'], format: 'americano' });
    // $60 court - 5 x $16 + ($14 + $7) = $1.
    expect((await dash(ctx)).tournament.cost).toMatchObject({ ifFillsCents: 100 });
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
// Twelve players: every spot (Alex: the waitlist starts after 12).
const TWELVE = ['Blair', 'Casey', 'Devon', 'Emery', 'Frankie', 'Gale', 'Harper', 'Indy', 'Jules', 'Kit', 'Kai', 'Lee'];

describe('the waitlist', () => {
  it('12 locked in: Lock spends nothing; Join waitlist keeps the order; unpaid people stay; the first PAID in line gets an opened spot automatically', async () => {
    const ctx = await world({ signUp: [...TWELVE, 'Lane', 'Morgan', 'Jordan'] });
    for (const n of TWELVE) await payCash(ctx, n);
    expect((await card(ctx, 'Kit')).tickets).toMatchObject({ size: 12, full: true });
    expect((await card(ctx, 'Kit')).tickets.locked.map((x: { name: string }) => x.name)).toEqual(TWELVE);
    // Full: Lock my spot is refused and spends no credit.
    await giveCredit(ctx, 'Lane', 1000);
    const refused = await lock(ctx, 'Lane');
    expect(refused.status).toBe(409);
    expect(refused.data.message).toBe('All 12 spots just filled. Join the waitlist.');
    expect(pot(ctx, 'Lane')).toBe(1000);
    expect(ticketRow(ctx, 'Lane')).toBeUndefined();
    // Join waitlist: Lane (unpaid), Morgan (holds with credit), Jordan (I paid, waiting for Alex).
    ctx.app.advance(60_000);
    expect((await joinLine(ctx, 'Lane')).data).toMatchObject({ result: 'waitlist', position: 1 });
    expect((await joinLine(ctx, 'Lane')).data).toMatchObject({ result: 'waitlist', position: 1 });
    ctx.app.advance(60_000);
    await giveCredit(ctx, 'Morgan', 2000);
    expect((await joinLine(ctx, 'Morgan')).data.position).toBe(2);
    expect((await lock(ctx, 'Morgan', 'hold')).data).toMatchObject({ result: 'held', creditUsedCents: 1600, dueCents: 0, place: 'line' });
    expect(pot(ctx, 'Morgan')).toBe(400);
    ctx.app.advance(60_000);
    expect((await joinLine(ctx, 'Jordan')).data.position).toBe(3);
    expect((await lock(ctx, 'Jordan', 'hold')).data).toMatchObject({ result: 'due', dueCents: 1600 });
    expect((await iPaid(ctx, 'Jordan', 1600)).data).toMatchObject({ result: 'waiting' });
    // Players see the line by name only (Alex, ship answer 5): nobody else's paid status, never anyone's money. Their own row says it is them.
    const seen = await (await playerPhone(ctx, 'Kit')).call('GET', '/api/group');
    expect(seen.data.tournament.tickets.line).toEqual([{ name: 'Lane' }, { name: 'Morgan' }, { name: 'Jordan' }]);
    expect(seen.text).not.toMatch(/"paid":/);
    expect((await card(ctx, 'Morgan')).tickets.line).toEqual([{ name: 'Lane' }, { name: 'Morgan', me: true }, { name: 'Jordan' }]);
    // The organizer's screen still has paid or not (an I paid that waits is not paid yet).
    const line = ((await dash(ctx)).tournament.tickets as { name: string; place: string; creditCents: number; paidCents: number; priceCents: number }[]).filter((k) => k.place === 'line');
    expect(line.map((k) => [k.name, k.creditCents + k.paidCents >= k.priceCents])).toEqual([['Lane', false], ['Morgan', true], ['Jordan', false]]);
    books(ctx);

    // Blair backs out: the spot goes to Morgan, the first PAID person in line; Lane (unpaid) stays first in line.
    ctx.app.advance(60_000);
    expect((await backOut(ctx, 'Blair', 1600)).data).toMatchObject({ result: 'backed_out', creditBackCents: 1600 });
    expect(ticketRow(ctx, 'Morgan')).toMatchObject({ place: 'spot', credit_cents: 1600 });
    expect(ticketRow(ctx, 'Lane')).toMatchObject({ place: 'line', credit_cents: 0 });
    expect((await card(ctx, 'Lane')).tickets.line.map((x: { name: string }) => x.name)).toEqual(['Lane', 'Jordan']);
    expect((await card(ctx, 'Morgan')).tickets.mine).toMatchObject({ place: 'spot' });
    books(ctx);

    // Alex confirms Jordan's I paid while no spot is open: paid, holding a place in line.
    expect((await answer(ctx, 'Jordan', 'confirm', 1600)).data).toMatchObject({ result: 'held', place: 'line' });
    books(ctx);
    // Alex takes Casey off the list: Casey's $16 is credit, the spot goes to Jordan (paid), not Lane (unpaid).
    ctx.app.advance(60_000);
    expect((await answer(ctx, 'Casey', 'take_off')).data).toMatchObject({ changed: true, creditCents: 1600 });
    expect(pot(ctx, 'Casey')).toBe(1600);
    expect(ticketRow(ctx, 'Jordan')).toMatchObject({ place: 'spot', paid_cents: 1600 });
    expect(ticketRow(ctx, 'Lane')).toMatchObject({ place: 'line' });
    books(ctx);

    // Lane holds: the $10 of credit goes on at once, $6 is left for the Pay sheet; once Alex confirms, Lane is paid and first in line.
    expect((await lock(ctx, 'Lane', 'hold')).data).toMatchObject({ result: 'due', creditUsedCents: 1000, dueCents: 600 });
    expect(pot(ctx, 'Lane')).toBe(0);
    await iPaid(ctx, 'Lane', 600);
    expect((await answer(ctx, 'Lane', 'confirm')).data).toMatchObject({ result: 'held', place: 'line' });
    // Devon backs out: Lane gets the spot automatically.
    ctx.app.advance(60_000);
    await backOut(ctx, 'Devon');
    expect(ticketRow(ctx, 'Lane')).toMatchObject({ place: 'spot', credit_cents: 1000, paid_cents: 600 });
    expect(await spots(ctx)).toEqual([...TWELVE.slice(3), 'Morgan', 'Jordan', 'Lane']);
    // Exactly what each one put in: back as credit for the three who left, on the ticket for the twelve who play.
    expect([pot(ctx, 'Blair'), pot(ctx, 'Casey'), pot(ctx, 'Devon'), pot(ctx, 'Morgan'), pot(ctx, 'Lane'), pot(ctx, 'Jordan')]).toEqual([1600, 1600, 1600, 400, 0, 0]);
    books(ctx);
  });

  it('two phones race for the last spot: one locks in, the other is told it filled and spends nothing', async () => {
    const ctx = await world({ signUp: [...TWELVE, 'Lane'] });
    for (const n of TWELVE.slice(0, 11)) await payCash(ctx, n);
    await giveCredit(ctx, 'Lee', 1600);
    await giveCredit(ctx, 'Lane', 1600);
    const [a, b] = await Promise.all([lock(ctx, 'Lee'), lock(ctx, 'Lane')]);
    const results = [a, b].map((r) => (r.status === 200 ? r.data.result : r.data.message)).sort();
    expect(results).toEqual(['All 12 spots just filled. Join the waitlist.', 'locked']);
    expect(pot(ctx, 'Lee') + pot(ctx, 'Lane')).toBe(1600);
    expect(await spots(ctx)).toHaveLength(12);
    books(ctx);
  });

  it('a double tap on Back out gives the money back once', async () => {
    const ctx = await world({ signUp: ['Blair', 'Casey'] });
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
    const ctx = await world({ signUp: [...TWELVE, 'Lane', 'Morgan', 'Jordan', 'Avery'] });
    for (const n of TWELVE) await payCash(ctx, n);
    await giveCredit(ctx, 'Lane', 1600);
    await joinLine(ctx, 'Lane');
    expect((await lock(ctx, 'Lane', 'hold')).data.result).toBe('held');
    await joinLine(ctx, 'Morgan');
    await lock(ctx, 'Morgan', 'hold');
    await iPaid(ctx, 'Morgan', 1600);
    expect((await answer(ctx, 'Morgan', 'confirm')).data.result).toBe('held');
    await joinLine(ctx, 'Jordan');
    await joinLine(ctx, 'Avery');
    await lock(ctx, 'Avery', 'hold');
    await iPaid(ctx, 'Avery', 1600);
    expect(pot(ctx, 'Lane')).toBe(0);
    books(ctx);
    // The night (Thu Nov 12, 7:00 to 10:00 PM) is not over yet: nothing comes back, not even during it.
    ctx.app.now = Date.parse('2026-11-13T02:59:00.000Z');
    await dash(ctx);
    await card(ctx, 'Lane');
    expect(pot(ctx, 'Lane')).toBe(0);
    // 10:00 PM: the first screen that reads it gives the holds back.
    ctx.app.now = Date.parse('2026-11-13T03:00:00.000Z');
    await card(ctx, 'Jordan');
    const after = ledgerRows(ctx);
    expect([pot(ctx, 'Lane'), pot(ctx, 'Morgan'), pot(ctx, 'Jordan'), pot(ctx, 'Avery')]).toEqual([1600, 1600, 0, 0]);
    expect(ticketRow(ctx, 'Lane')).toMatchObject({ place: 'none', credit_cents: 0, paid_cents: 0 });
    expect(ticketRow(ctx, 'Avery')).toMatchObject({ claim_cents: 1600 });
    // Refreshes, other phones and the organizer's screen find nothing left to do.
    for (let i = 0; i < 3; i++) {
      await dash(ctx);
      await card(ctx, 'Lane');
    }
    expect(ledgerRows(ctx)).toBe(after);
    expect(pot(ctx, 'Lane')).toBe(1600);
    books(ctx);
    // Avery's I paid: Alex confirms it after the night, and all of it is credit at once.
    expect((await answer(ctx, 'Avery', 'confirm')).data).toMatchObject({ creditCents: 1600 });
    expect(pot(ctx, 'Avery')).toBe(1600);
    // The twelve who played keep their tickets.
    for (const n of TWELVE) expect(ticketRow(ctx, n)).toMatchObject({ place: 'spot', paid_cents: 1600 });
    books(ctx);
    expect(await creditLines(ctx, 'Lane')).toContain('Nov 12: $16 returned from the Winter Classic (no spot opened)');
    expect(await creditLines(ctx, 'Morgan')).toContain('Nov 12: $16 back from the Winter Classic (no spot opened)');
    expect(await creditLines(ctx, 'Avery')).toContain('Nov 12: $16 back from the Winter Classic (no spot opened)');
    // The organizer's list words: "+$16 back from the Winter Classic (no spot opened)".
    const morgan = ((await dash(ctx)).creditLedger as { playerId: string; entries: Parameters<typeof creditEntryText>[0][] }[]).find((p) => p.playerId === ctx.byName.Morgan)!;
    expect(morgan.entries.map((e) => creditEntryText(e, 'America/Detroit'))).toContain('+$16 back from the Winter Classic (no spot opened)');
  });
});

describe('cancel', () => {
  it('every paid ticket comes back as credit exactly once; an I paid waiting comes back when Alex answers; players on the list see Canceled', async () => {
    const ctx = await world({ signUp: ['Alex', 'Blair', 'Casey', 'Devon', 'Emery', 'Frankie', 'Gale', 'Harper', 'Indy'] });
    // Alex's own seat: $0, one of the spots, taken when the date was picked (tickets opened).
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
    await giveCredit(ctx, 'Indy', 1600);
    await lock(ctx, 'Indy');
    expect(await spots(ctx)).toEqual(['Alex', 'Blair', 'Casey', 'Devon', 'Gale', 'Harper', 'Indy']);
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
  it('back to the date step: the list stays (dates to pick again), paid tickets are held, backing out gives credit; a new date opens tickets again and the spots stay', async () => {
    const ctx = await world({ signUp: ['Blair', 'Casey', 'Devon', 'Emery', 'Frankie'] });
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
    // Players pick their dates again; Alex picks the new date: tickets open again at once, the spots stay with Blair and Devon.
    const NEW = '2026-11-17';
    for (const n of ['Blair', 'Devon', 'Emery']) {
      const r = await (await playerPhone(ctx, n)).call('PUT', '/api/tournament/signup', { tournamentId: ctx.tid, dates: [NEW] });
      expect(r.status, r.text).toBe(200);
    }
    expect((await ctx.organizer.call('PUT', `/api/admin/tournament/${ctx.tid}/date`, { date: NEW })).status).toBe(200);
    t = (await dash(ctx)).tournament;
    expect(t).toMatchObject({ status: 'tickets', finalDate: NEW, payBy: '2026-11-16T00:00:00.000Z' });
    expect(await spots(ctx)).toEqual(['Blair', 'Devon']);
    expect((await lock(ctx, 'Emery')).data).toMatchObject({ result: 'due', dueCents: 1600 });
    books(ctx);
  });
});

describe("the organizer's own seat and answers", () => {
  it('the seat is $0 and one of the spots, taken with Lock my spot after tickets open too; never any money', async () => {
    const ctx = await world({ signUp: ['Blair', 'Casey'] });
    expect(ticketRow(ctx, 'Alex')).toBeUndefined();
    await signUp(ctx, 'Alex');
    const phone = await organizerPhone(ctx);
    expect((await phone.call('GET', '/api/group')).data.tournament.tickets.priceCents).toBe(0);
    expect((await phone.call('POST', '/api/tournament/lock', { tournamentId: ctx.tid, intent: 'lock', priceCents: 1600 })).data.message).toBe('The ticket is $0. Look again.');
    const r = await phone.call('POST', '/api/tournament/lock', { tournamentId: ctx.tid, intent: 'lock', priceCents: 0 });
    expect(r.data).toMatchObject({ result: 'locked', creditUsedCents: 0, dueCents: 0 });
    expect(ticketRow(ctx, 'Alex')).toMatchObject({ place: 'spot', price_cents: 0, credit_cents: 0, paid_cents: 0 });
    expect((await card(ctx, 'Blair')).tickets).toMatchObject({ priceCents: 1600, locked: [{ name: 'Alex' }] });
    // The organizer is known here only by the name in Settings: the Tickets list still marks the seat as theirs (review).
    expect((await dash(ctx)).tournament.tickets.find((k: { name: string }) => k.name === 'Alex')).toMatchObject({ organizer: true, priceCents: 0 });
    // Backing out of the $0 seat gives nothing back (there is nothing) and opens the spot.
    expect((await phone.call('POST', '/api/tournament/back-out', { tournamentId: ctx.tid, backCents: 0 })).data).toMatchObject({ result: 'backed_out', creditBackCents: 0, creditReturnedCents: 0 });
    expect(pot(ctx, 'Alex')).toBe(0);
    expect(await spots(ctx)).toEqual([]);
    books(ctx);
  });

  it("Didn't pay clears the I paid (no money moves); Paid with cash in hand marks what is owed; the amounts on the screen must match", async () => {
    const ctx = await world({ signUp: ['Blair', 'Casey', 'Devon'] });
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
    const ctx = await world({ signUp: ['Blair', 'Casey'] });
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
    const ctx = await world({ signUp: ['Blair', 'Casey', 'Devon'] });
    await payCash(ctx, 'Blair');
    await ctx.organizer.call('PUT', '/api/admin/tournaments-switch', { on: false });
    const casey = await playerPhone(ctx, 'Casey');
    const res = await casey.call('GET', '/api/group');
    expect(res.data.tournament).toBeUndefined();
    for (const word of ['winter classic', ctx.tid, 'tournament']) expect(res.text.toLowerCase()).not.toContain(word);
    const stamp = (await casey.call('GET', '/api/group/version')).data.v;
    // A ticket change made on the organizer's private link (X-Tournaments: on) moves nothing a switched-off phone can see; Mark paid for a
    // player is refused while players cannot see it (third review).
    const link = { 'X-Tournaments': 'on' };
    const moved = await ctx.organizer.call('PUT', `/api/admin/tournament/${ctx.tid}/pay-by`, { payBy: '2026-11-09T00:00:00.000Z' }, link);
    expect(moved.status, moved.text).toBe(200);
    expect((await ctx.organizer.call('POST', `/api/admin/tournament/${ctx.tid}/ticket`, { playerId: ctx.byName.Devon, action: 'mark_paid', cents: 1600 }, link)).status).toBe(409);
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
    const ctx = await world({ signUp: ['Alex', 'Blair', 'Casey', 'Devon', 'Emery'] });
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
      [
        'tour_spots_over_12',
        `DROP TRIGGER tournament_tickets_cap_insert; DROP TRIGGER tournament_tickets_cap_update;
         INSERT INTO tournament_tickets (id, tournament_id, player_id, place, place_at, price_cents, created_at, updated_at)
         SELECT 'x-' || id, '${ctx.tid}', id, 'spot', '2026-10-26T16:00:00.000Z', 0, '2026-10-26T16:00:00.000Z', '2026-10-26T16:00:00.000Z'
         FROM players WHERE id NOT IN (SELECT player_id FROM tournament_tickets WHERE tournament_id = '${ctx.tid}')`,
      ],
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

    // Alex: picking the date opens tickets, so "Date picked" is tickets open with nobody paid yet (6 spots).
    let t = await stage('date_picked');
    expect(t).toMatchObject({ status: 'tickets', size: 6, ticketCents: 1600 });
    expect(t.payBy).toBeTruthy();
    expect(locked(t)).toEqual([]);
    expect((await card(ctx, 'Parker')).tickets).toMatchObject({ size: 6, full: false, mine: null, locked: [] });

    t = await stage('tickets_open');
    expect(t).toMatchObject({ status: 'tickets', size: 8, ticketCents: 1600 });
    expect(locked(t)).toEqual(['Parker', 'Rowan', 'Sage', 'Christopher Vanderberg', 'Wren', 'Quinn']);
    expect((await card(ctx, 'Vic')).tickets).toMatchObject({ mine: null, priceCents: 1600 });

    // All 10 fixed names locked in (Alex's seat free): 10 of 12. The waitlist starts after 12, so no stage can show it with 10 names.
    t = await stage('all_locked');
    expect(locked(t)).toHaveLength(10);
    expect(locked(t)).toEqual(expect.arrayContaining(['Alex', 'Vic']));
    expect(t).toMatchObject({ size: 12, courts: 2, minutes: 180 });
    expect(t.tickets.find((k: { name: string }) => k.name === 'Alex')).toMatchObject({ priceCents: 0, organizer: true });
    expect((await card(ctx, 'Vic')).tickets).toMatchObject({ size: 12, full: false, mine: { place: 'spot' } });

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

/** Runs `between` (another phone's write) right before the first statement matching `sql` is prepared: the race the review described. */
function raceAt(ctx: Ctx, sql: RegExp, between: () => void) {
  const inner = ctx.app.env.DB;
  let done = false;
  ctx.app.env.DB = {
    ...inner,
    prepare(text: string) {
      if (!done && sql.test(text)) {
        done = true;
        between();
      }
      return inner.prepare(text);
    },
    batch: (st: unknown) => inner.batch(st as never),
  } as typeof inner;
  return () => {
    ctx.app.env.DB = inner;
  };
}
const NOW_ISO = '2026-10-26T16:00:00.000Z';
/** What a Lock with $16 of credit writes, done by hand (as if another phone's Lock landed at that moment). */
function lockLanded(ctx: Ctx, name: string) {
  ctx.app.db.raw
    .prepare("INSERT INTO tournament_tickets (id, tournament_id, player_id, place, place_at, price_cents, credit_cents, paid_at, created_at, updated_at) VALUES (?, ?, ?, 'spot', ?, 1600, 1600, ?, ?, ?)")
    .run(`race-${name}`, ctx.tid, ctx.byName[name], NOW_ISO, NOW_ISO, NOW_ISO, NOW_ISO);
  ctx.app.db.raw
    .prepare("INSERT INTO credit_ledger (id, group_id, player_id, kind, amount_cents, five_cents, session_id, created_at, reason) SELECT ?, group_id, id, 'used', 1600, 0, NULL, ?, ? FROM players WHERE id = ?")
    .run(`race-used-${name}`, NOW_ISO, `tour:${ctx.tid}`, ctx.byName[name]);
}

describe('review fixes (fresh reviewer, Zip 56)', () => {
  it('a Lock landing between a Back out read and its write still comes back as credit: nothing stays on someone off the list', async () => {
    const ctx = await world({ signUp: ['Blair', 'Casey'] });
    await giveCredit(ctx, 'Blair', 1600);
    const undo = raceAt(ctx, /UPDATE tournament_signups SET status = 'out'/, () => lockLanded(ctx, 'Blair'));
    const out = await backOut(ctx, 'Blair');
    undo();
    expect(out.data).toMatchObject({ result: 'backed_out', creditReturnedCents: 1600 });
    expect(pot(ctx, 'Blair')).toBe(1600);
    expect(ticketRow(ctx, 'Blair')).toMatchObject({ place: 'none', credit_cents: 0 });
    books(ctx);
  });

  it('the same for Take off: the money that landed comes back and the reply says so', async () => {
    const ctx = await world({ signUp: ['Blair', 'Casey'] });
    await giveCredit(ctx, 'Blair', 1600);
    const undo = raceAt(ctx, /UPDATE tournament_signups SET status = 'off'/, () => lockLanded(ctx, 'Blair'));
    const off = await answer(ctx, 'Blair', 'take_off');
    undo();
    expect(off.data).toMatchObject({ changed: true, creditCents: 1600 });
    expect(pot(ctx, 'Blair')).toBe(1600);
    books(ctx);
  });

  it('from the start of the night nobody is taken off or marked paid; once it is over it is not canceled or moved (no refunds for a played night)', async () => {
    const ctx = await world({ signUp: ['Blair', 'Casey'] });
    await payCash(ctx, 'Blair');
    await lock(ctx, 'Casey');
    ctx.app.now = Date.parse('2026-11-13T00:30:00.000Z'); // Thu 7:30 PM Eastern: the night has started
    expect((await answer(ctx, 'Blair', 'take_off')).data.message).toBe('The tournament has started. Nobody can be taken off now.');
    expect((await answer(ctx, 'Casey', 'mark_paid', 1600)).data.message).toBe('Tickets are closed. The tournament has started.');
    expect((await backOut(ctx, 'Blair')).data.message).toBe('The tournament has started. Ask Alex.');
    ctx.app.now = Date.parse('2026-11-13T03:00:00.000Z'); // 10:00 PM: the night is over
    expect((await ctx.organizer.call('POST', `/api/admin/tournament/${ctx.tid}/cancel`, {})).data.message).toBe('The tournament night is over. It cannot be canceled now.');
    expect((await ctx.organizer.call('POST', `/api/admin/tournament/${ctx.tid}/reschedule`, {})).data.message).toBe('The tournament night is over. It cannot be moved now.');
    expect(pot(ctx, 'Blair')).toBe(0);
    expect(ticketRow(ctx, 'Blair')).toMatchObject({ place: 'spot', paid_cents: 1600 });
    // Remove player: a played ticket is history; the name is hidden (never deleted, nothing refunded).
    expect((await ctx.organizer.call('DELETE', `/api/admin/players/${ctx.byName.Blair}`)).data).toMatchObject({ result: 'hidden' });
    expect(ticketRow(ctx, 'Blair')).toMatchObject({ place: 'spot', paid_cents: 1600 });
    books(ctx);
  });

  it('Hold my spot landing just after a Cancel places nothing', async () => {
    const ctx = await world({ signUp: [...TWELVE, 'Lane'] });
    expect((await lock(ctx, 'Lane')).data).toMatchObject({ result: 'due' });
    for (const n of TWELVE) await payCash(ctx, n);
    const undo = raceAt(ctx, /SET place = 'line', place_at = \?1/, () => ctx.app.db.raw.prepare("UPDATE tournaments SET status = 'canceled' WHERE id = ?").run(ctx.tid));
    const r = await lock(ctx, 'Lane', 'hold');
    undo();
    expect(r.status).toBe(409);
    expect(ticketRow(ctx, 'Lane')).toMatchObject({ place: 'none' });
  });

  it("credit history names the tournament only while it is on for that phone; 'canceled' only on credit a Cancel gave back", async () => {
    const ctx = await world({ signUp: ['Blair', 'Casey'] });
    await giveCredit(ctx, 'Blair', 1600);
    await lock(ctx, 'Blair');
    await giveCredit(ctx, 'Casey', 1600);
    await lock(ctx, 'Casey');
    await backOut(ctx, 'Casey');
    await ctx.organizer.call('POST', `/api/admin/tournament/${ctx.tid}/cancel`, {});
    type Entry = { reason: string; tournamentName?: string; tourCanceled?: true };
    const history = async (n: string) => ((await (await playerPhone(ctx, n)).call('GET', '/api/group')).data.credit.history as Entry[]).filter((e) => e.reason === 'tournament');
    expect((await history('Blair')).every((e) => e.tournamentName === 'Winter Classic')).toBe(true);
    expect((await history('Blair')).some((e) => e.tourCanceled)).toBe(true);
    // Casey left before the Cancel: nothing on Casey's rows says it was canceled.
    expect((await history('Casey')).some((e) => e.tourCanceled)).toBe(false);
    await ctx.organizer.call('PUT', '/api/admin/tournaments-switch', { on: false });
    const off = await (await playerPhone(ctx, 'Blair')).call('GET', '/api/group');
    expect(off.text).not.toContain('Winter Classic');
    expect((off.data.credit.history as Entry[]).filter((e) => e.reason === 'tournament').length).toBeGreaterThan(0);
  });

  it("an I paid answered after the player backed out comes back as 'you backed out' (the reason is worked out when the answer lands)", async () => {
    const ctx = await world({ signUp: ['Blair'] });
    await lock(ctx, 'Blair');
    await iPaid(ctx, 'Blair', 1600);
    expect((await backOut(ctx, 'Blair')).data).toMatchObject({ result: 'backed_out', waitingCents: 1600 });
    expect((await answer(ctx, 'Blair', 'confirm', 1600)).data).toMatchObject({ creditCents: 1600 });
    expect(pot(ctx, 'Blair')).toBe(1600);
    expect(await creditLines(ctx, 'Blair')).toContain('Oct 26: $16 back from the Winter Classic (you backed out)');
    books(ctx);
  });
});

describe('second review fixes (Zip 56)', () => {
  it("Only me: picking the date opens tickets, and the organizer's private test keeps every setting free until Everyone can see it", async () => {
    const ctx = await world({ signUp: ['Alex', 'Blair'], open: false });
    // Signed up while on Everyone, back to Only me (allowed before tickets), then the date: tickets open on Only me.
    expect((await ctx.organizer.call('PUT', `/api/admin/tournament/${ctx.tid}/visibility`, { visibility: 'me' })).status).toBe(200);
    expect((await ctx.organizer.call('PUT', `/api/admin/tournament/${ctx.tid}/date`, { date: DATE })).status).toBe(200);
    expect((await dash(ctx)).tournament).toMatchObject({ status: 'tickets', visibility: 'me', settingsLocked: false, formatLocked: false });
    // Blair cannot see it: no tournament at all, and nobody can pay for Blair while it is Only me.
    expect(await card(ctx, 'Blair')).toBeUndefined();
    const paid = await answer(ctx, 'Blair', 'mark_paid', 1600);
    expect(paid.status).toBe(409);
    expect(paid.data.message).toBe('Only you can see it. Show it to everyone first.');
    expect(ticketRow(ctx, 'Blair')).toBeUndefined();
    // Edit stays on Only me and may change the price and the format (nobody else can hold a ticket).
    const edit = await ctx.organizer.call('PUT', `/api/admin/tournament/${ctx.tid}`, { ...BASE, visibility: 'me', ticketCents: 2000, format: 'americano', secondCreditCents: 700 });
    expect(edit.status, edit.text).toBe(200);
    // Everyone: Blair sees Lock my spot at the new price; from then on the price, the format and Everyone stay.
    expect((await ctx.organizer.call('PUT', `/api/admin/tournament/${ctx.tid}/visibility`, { visibility: 'all' })).status).toBe(200);
    expect((await card(ctx, 'Blair')).tickets).toMatchObject({ priceCents: 2000, mine: null });
    expect((await dash(ctx)).tournament).toMatchObject({ visibility: 'all', settingsLocked: true, formatLocked: true });
    const AM = { ...BASE, ticketCents: 2000, format: 'americano', secondCreditCents: 700 };
    expect((await ctx.organizer.call('PUT', `/api/admin/tournament/${ctx.tid}/visibility`, { visibility: 'me' })).data.message).toBe('Players have tickets. It stays on Everyone.');
    expect((await ctx.organizer.call('PUT', `/api/admin/tournament/${ctx.tid}`, { ...AM, visibility: 'me' })).data.message).toBe('Players have tickets. It stays on Everyone.');
    expect((await ctx.organizer.call('PUT', `/api/admin/tournament/${ctx.tid}`, { ...AM, ticketCents: 1600 })).data.message).toBe('Tickets have been sold. The price stays $20.');
    expect((await ctx.organizer.call('PUT', `/api/admin/tournament/${ctx.tid}`, { ...AM, format: 'doubles' })).data.message).toBe('Tickets are open. The format cannot change now.');
    expect((await ctx.organizer.call('PUT', `/api/admin/tournament/${ctx.tid}`, AM)).status).toBe(200);
    books(ctx);
  });

  it('a piece 1 date pick that becomes tickets writes the same History line as a date pick, once', async () => {
    const ctx = await world({ signUp: ['Alex', 'Blair'], open: false });
    ctx.app.db.raw.prepare("UPDATE tournaments SET status = 'date_picked', final_date = ?, date_picked_at = ? WHERE id = ?").run(DATE, '2026-10-26T15:00:00.000Z', ctx.tid);
    const opened = async () =>
      ((await ctx.organizer.call('GET', '/api/admin/activity')).data.entries as { action: string; details: Record<string, unknown> }[]).filter((e) => e.action === 'tournament_tickets_opened');
    expect((await card(ctx, 'Blair')).status).toBe('tickets');
    expect((await dash(ctx)).tournament.status).toBe('tickets');
    expect(await card(ctx, 'Blair')).toMatchObject({ status: 'tickets' });
    const lines = await opened();
    expect(lines).toHaveLength(1);
    expect(lines[0].details).toMatchObject({ tournament: 'Winter Classic', priceCents: 1600 });
    books(ctx);
  });

  it('Only me landing between that read and the upgrade wins: nothing is written, and the player gets nothing next time', async () => {
    const ctx = await world({ signUp: ['Blair'], open: false });
    const blair = await playerPhone(ctx, 'Blair');
    ctx.app.db.raw.prepare("UPDATE tournaments SET status = 'date_picked', final_date = ?, date_picked_at = ? WHERE id = ?").run(DATE, '2026-10-26T15:00:00.000Z', ctx.tid);
    const undo = raceAt(ctx, /UPDATE tournaments SET status = 'tickets', pay_by/, () => ctx.app.db.raw.prepare("UPDATE tournaments SET visibility = 'me' WHERE id = ?").run(ctx.tid));
    const first = await blair.call('GET', '/api/group');
    undo();
    // The upgrade did not land (it is guarded on what was read), and the card part of that same answer already sees Only me: nothing.
    expect(first.data.tournament).toBeUndefined();
    expect(first.text).not.toContain('Winter Classic');
    expect(ctx.app.db.raw.prepare('SELECT status, pay_by FROM tournaments WHERE id = ?').get(ctx.tid)).toMatchObject({ status: 'date_picked', pay_by: null });
    expect(ctx.app.db.raw.prepare('SELECT COUNT(*) AS n FROM tournament_tickets WHERE tournament_id = ?').get(ctx.tid)).toMatchObject({ n: 0 });
    expect(((await ctx.organizer.call('GET', '/api/admin/activity')).data.entries as { action: string }[]).some((e) => e.action === 'tournament_tickets_opened')).toBe(false);
    expect(await card(ctx, 'Blair')).toBeUndefined();
  });

  it('two first sign-ups at once (two phones, two levels): the list keeps the level that landed first, the same as the level history', async () => {
    const ctx = await world({ open: false });
    const undo = raceAt(ctx, /INSERT INTO tournament_level_history/, () => {
      // The other phone's sign-up at 3.6 lands first.
      ctx.app.db.raw
        .prepare("INSERT INTO tournament_level_history (id, tournament_id, player_id, level, set_by, created_at) VALUES ('race-h', ?, ?, 360, 'player', ?)")
        .run(ctx.tid, ctx.byName.Blair, NOW_ISO);
      ctx.app.db.raw
        .prepare("INSERT INTO tournament_signups (id, tournament_id, player_id, status, picked_level, approved_level, dates, joined_at, created_at, updated_at) VALUES ('race-s', ?, ?, 'in', 360, NULL, ?, ?, ?, ?)")
        .run(ctx.tid, ctx.byName.Blair, JSON.stringify([DATE]), NOW_ISO, NOW_ISO, NOW_ISO);
    });
    const r = await (await playerPhone(ctx, 'Blair')).call('POST', '/api/tournament/signup', { tournamentId: ctx.tid, level: 250, dates: [DATES[0]] });
    undo();
    expect(r.status, r.text).toBe(200);
    expect(ctx.app.db.raw.prepare('SELECT picked_level FROM tournament_signups WHERE tournament_id = ? AND player_id = ?').get(ctx.tid, ctx.byName.Blair)).toMatchObject({ picked_level: 360 });
    expect(ctx.app.db.raw.prepare("SELECT COUNT(*) AS n FROM tournament_level_history WHERE tournament_id = ? AND player_id = ? AND set_by = 'player'").get(ctx.tid, ctx.byName.Blair)).toMatchObject({ n: 1 });
    const line = ((await ctx.organizer.call('GET', '/api/admin/activity')).data.entries as { action: string; details: Record<string, unknown> }[]).find((e) => e.action === 'tournament_signup');
    expect(line?.details).toMatchObject({ level: '3.6' });
  });

  it("a player's credit history never names an Only me tournament", async () => {
    const ctx = await world({ signUp: ['Blair'] });
    await giveCredit(ctx, 'Blair', 1600);
    await lock(ctx, 'Blair');
    type Entry = { reason: string; tournamentName?: string };
    const answerOfBlair = async () => (await playerPhone(ctx, 'Blair')).call('GET', '/api/group');
    expect(((await answerOfBlair()).data.credit.history as Entry[]).filter((e) => e.reason === 'tournament').every((e) => e.tournamentName === 'Winter Classic')).toBe(true);
    // No screen can do this once tickets are open on Everyone; forced here so the guard itself is tested.
    ctx.app.db.raw.prepare("UPDATE tournaments SET visibility = 'me' WHERE id = ?").run(ctx.tid);
    const hidden = await answerOfBlair();
    expect(hidden.text).not.toContain('Winter Classic');
    expect((hidden.data.credit.history as Entry[]).filter((e) => e.reason === 'tournament').length).toBeGreaterThan(0);
  });

  it("the organizer's screen says when the night has started and when it is over (no Cancel or reschedule offered then)", async () => {
    const ctx = await world({ signUp: ['Blair'] });
    expect((await dash(ctx)).tournament).toMatchObject({ closed: false, over: false });
    ctx.app.now = Date.parse('2026-11-13T00:30:00.000Z'); // Thu Nov 12, 7:30 PM Eastern: started
    expect((await dash(ctx)).tournament).toMatchObject({ closed: true, over: false });
    ctx.app.now = Date.parse('2026-11-13T03:00:00.000Z'); // 10:00 PM: over
    expect((await dash(ctx)).tournament).toMatchObject({ closed: true, over: true });
    expect((await ctx.organizer.call('POST', `/api/admin/tournament/${ctx.tid}/cancel`, {})).data.message).toBe('The tournament night is over. It cannot be canceled now.');
    // Players keep the Tickets closed card (piece 1's rule: the card stays once the picked date has passed; game day, piece 3, ends it).
    expect(await card(ctx, 'Blair')).toMatchObject({ status: 'tickets', tickets: { closed: true } });
    ctx.app.now = Date.parse('2026-11-13T17:00:00.000Z'); // Fri Nov 13, 12:00 PM Eastern
    expect(await card(ctx, 'Blair')).toMatchObject({ status: 'tickets', tickets: { closed: true } });
    expect((await dash(ctx)).tournament).toMatchObject({ status: 'tickets', over: true });
  });
});

describe('third review fixes (Zip 56)', () => {
  it('Mark paid never gives a ticket to a player who cannot see it: not while Tournaments is off for players (the organizer on the private link)', async () => {
    const ctx = await world({ signUp: ['Blair'], open: false });
    // Off for everyone; the organizer keeps working through the private link.
    expect((await ctx.organizer.call('PUT', '/api/admin/tournaments-switch', { on: false })).status).toBe(200);
    const link = { 'X-Tournaments': 'on' };
    expect((await ctx.organizer.call('PUT', `/api/admin/tournament/${ctx.tid}/date`, { date: DATE }, link)).status).toBe(200);
    const r = await ctx.organizer.call('POST', `/api/admin/tournament/${ctx.tid}/ticket`, { playerId: ctx.byName.Blair, action: 'mark_paid', cents: 1600 }, link);
    expect(r.status).toBe(409);
    expect(r.data.message).toBe('Tournaments are off for players. Turn the switch on first.');
    expect(ticketRow(ctx, 'Blair')).toBeUndefined();
    // On for everyone again: Blair can see it, and Mark paid works.
    expect((await ctx.organizer.call('PUT', '/api/admin/tournaments-switch', { on: true })).status).toBe(200);
    expect((await answer(ctx, 'Blair', 'mark_paid', 1600)).status).toBe(200);
    expect(ticketRow(ctx, 'Blair')).toMatchObject({ place: 'spot', paid_cents: 1600 });
    books(ctx);
  });

  it('the price, the format and Only me stay free until players may hold tickets (open on Everyone, or a player holds one), also after a Reschedule', async () => {
    const ctx = await world({ signUp: ['Alex', 'Blair'], open: false });
    const tour = `/api/admin/tournament/${ctx.tid}`;
    // Only me, the date (tickets open privately), Reschedule, then Everyone: nobody ever bought in, so every setting is free.
    expect((await ctx.organizer.call('PUT', `${tour}/visibility`, { visibility: 'me' })).status).toBe(200);
    expect((await ctx.organizer.call('PUT', `${tour}/date`, { date: DATE })).status).toBe(200);
    expect((await ctx.organizer.call('POST', `${tour}/reschedule`, {})).status).toBe(200);
    expect((await ctx.organizer.call('PUT', `${tour}/visibility`, { visibility: 'all' })).status).toBe(200);
    expect((await dash(ctx)).tournament).toMatchObject({ status: 'rescheduled', visibility: 'all', settingsLocked: false, formatLocked: false });
    expect((await ctx.organizer.call('PUT', tour, { ...BASE, ticketCents: 2000 })).status).toBe(200);
    expect((await ctx.organizer.call('PUT', `${tour}/visibility`, { visibility: 'me' })).status).toBe(200);
    // Back on Everyone and the date picked: tickets are open on Everyone, so the settings lock.
    expect((await ctx.organizer.call('PUT', `${tour}/visibility`, { visibility: 'all' })).status).toBe(200);
    expect((await ctx.organizer.call('PUT', `${tour}/date`, { date: DATE })).status).toBe(200);
    expect((await dash(ctx)).tournament).toMatchObject({ status: 'tickets', settingsLocked: true, formatLocked: true });
    // Blair takes a ticket at $20; after a Reschedule it stays locked (a player holds a ticket).
    await giveCredit(ctx, 'Blair', 2000);
    const locked = await (await playerPhone(ctx, 'Blair')).call('POST', '/api/tournament/lock', { tournamentId: ctx.tid, intent: 'lock', priceCents: 2000 });
    expect(locked.status, locked.text).toBe(200);
    expect((await ctx.organizer.call('POST', `${tour}/reschedule`, {})).status).toBe(200);
    expect((await dash(ctx)).tournament).toMatchObject({ status: 'rescheduled', settingsLocked: true, formatLocked: true });
    expect((await ctx.organizer.call('PUT', tour, { ...BASE, ticketCents: 1600 })).data.message).toBe('Tickets have been sold. The price stays $20.');
    expect((await ctx.organizer.call('PUT', `${tour}/visibility`, { visibility: 'me' })).data.message).toBe('Players have tickets. It stays on Everyone.');
    books(ctx);
  });

  it('the piece 1 upgrade is guarded on the price too: an Edit landing in between wins, and the History line names the price that opened tickets', async () => {
    const ctx = await world({ signUp: ['Blair'], open: false });
    const blair = await playerPhone(ctx, 'Blair');
    ctx.app.db.raw.prepare("UPDATE tournaments SET status = 'date_picked', final_date = ?, date_picked_at = ? WHERE id = ?").run(DATE, '2026-10-26T15:00:00.000Z', ctx.tid);
    const undo = raceAt(ctx, /UPDATE tournaments SET status = 'tickets', pay_by/, () => ctx.app.db.raw.prepare('UPDATE tournaments SET ticket_cents = 2000 WHERE id = ?').run(ctx.tid));
    await blair.call('GET', '/api/group');
    undo();
    // The read that raced wrote nothing; the next build of the view (the same answer) opened tickets at $20.
    const lines = ((await ctx.organizer.call('GET', '/api/admin/activity')).data.entries as { action: string; details: Record<string, unknown> }[]).filter((e) => e.action === 'tournament_tickets_opened');
    expect(lines).toHaveLength(1);
    expect(lines[0].details).toMatchObject({ priceCents: 2000 });
    expect((await card(ctx, 'Blair')).tickets).toMatchObject({ priceCents: 2000 });
    books(ctx);
  });
});

describe('ship answers (Alex, Zip 56)', () => {
  const TOUR_TABLES = ['tournaments', 'tournament_signups', 'tournament_level_history', 'tournament_tickets'];

  it('answer 4: Money > Totals has its own Tournament tickets line: money on tickets paid in full this month, to the cent; nothing else moves', async () => {
    const ctx = await world({ signUp: ['Alex', 'Blair', 'Casey', 'Devon', 'Emery'] });
    expect((await ctx.organizer.call('PUT', '/api/admin/money-rework', { on: true })).status).toBe(200);
    await payCash(ctx, 'Blair'); // $16 cash, confirmed
    await giveCredit(ctx, 'Casey', 1600);
    await lock(ctx, 'Casey'); // $16 credit
    await lock(ctx, 'Devon');
    await iPaid(ctx, 'Devon', 1600); // waiting for Alex: not counted
    await giveCredit(ctx, 'Emery', 1600);
    await lock(ctx, 'Emery');
    await backOut(ctx, 'Emery'); // back as credit: not counted
    const money = async (month: string) => (await ctx.organizer.call('GET', `/api/admin/money?month=${month}`)).data;
    const on = await money('2026-10');
    expect(on.rework.tournamentTickets).toEqual({ cents: 3200, paid: 2 });
    // Another month: no line.
    expect((await money('2026-11')).rework.tournamentTickets).toBeUndefined();
    // Not part of the venue cost: with the switch off the answer is exactly what it was, without the line.
    expect((await ctx.organizer.call('PUT', '/api/admin/tournaments-switch', { on: false })).status).toBe(200);
    const off = await money('2026-10');
    expect(off.rework.tournamentTickets).toBeUndefined();
    const { tournamentTickets: _line, ...rest } = on.rework;
    expect(off.rework).toEqual(rest);
    books(ctx);
  });

  it('answer 3: the backup file (version 3) carries the four tournament tables, and a restore brings every ticket and its money back exactly', async () => {
    const ctx = await world({ signUp: ['Alex', 'Blair', 'Casey', 'Devon'] });
    await payCash(ctx, 'Blair');
    await giveCredit(ctx, 'Casey', 1600);
    await lock(ctx, 'Casey');
    await lock(ctx, 'Devon');
    await iPaid(ctx, 'Devon', 1600);
    const file = (await ctx.organizer.call('GET', '/api/admin/backup')).data;
    expect(file.version).toBe(3);
    const rows = (db: { raw: { prepare: (q: string) => { all: () => unknown[] } } }, t: string) => db.raw.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all();
    for (const t of TOUR_TABLES) expect(file.tables[t], t).toEqual(rows(ctx.app.db, t));
    expect(file.tables.tournament_tickets.length).toBe(4); // Alex's $0 seat, Blair (cash), Casey (credit), Devon (I paid waiting)
    // The real restore SQL into a fresh database with every migration.
    const copy = createNodeD1(':memory:');
    copy.raw.exec('BEGIN');
    copy.raw.exec(backupToSql(file));
    copy.raw.exec('COMMIT');
    expect(copy.raw.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    for (const t of TOUR_TABLES) expect(rows(copy, t), t).toEqual(rows(ctx.app.db, t));
    // The books read the same on the copy (every check 0).
    for (const sql of [OLD_SQL, TOUR_SQL]) {
      const row = copy.raw.prepare(sql).get() as Record<string, number>;
      for (const [k, n] of Object.entries(row)) if (!k.startsWith('info_')) expect(Number(n), `${k} on the copy`).toBe(0);
    }
  });
});
