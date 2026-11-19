import { describe, expect, it } from 'vitest';
import { playerPhone, setupGroup } from './harness';
import { defaultPayBy, salesCutoffMs } from '../shared/tournamentTickets';
import { NIGHT_START_MINUTES } from '../shared/tournament';

// Zip 59 (🎾59.polish), Tournaments polish before the switch flips. The rules with a number or a clock in them, in the server:
//   2. Pay by = the night before at 7:00 PM; after it no waitlist joins (Zip 64: a player on the list can still pay while a spot is open), until
//      3 hours before the start; no credit or charge amount changes
//   3. Hide a canceled tournament (and Restore it), and the leak rules
// The clock is Monday Oct 26, 2026, 12 PM Eastern (tests/harness.ts). The tournament is Thu Nov 12 (the night: 7:00 to 10:00 PM Eastern).

type Ctx = Awaited<ReturnType<typeof setupGroup>> & { tid: string };

const DATE = '2026-11-12';
const DATES = ['2026-11-03', '2026-11-05', '2026-11-10', DATE, '2026-11-17'];
const BASE = { name: 'Winter Classic', dates: DATES, ticketCents: 1600, creditCents: 1400, visibility: 'all' };
const PAY_BY_MS = Date.parse('2026-11-12T00:00:00.000Z'); // Wed Nov 11, 7:00 PM Eastern
const AFTER_PAY_BY = Date.parse('2026-11-12T00:30:00.000Z'); // Wed Nov 11, 7:30 PM Eastern
const CUTOFF_MS = Date.parse('2026-11-12T21:00:00.000Z'); // Thu Nov 12, 4:00 PM Eastern: 3 hours before 7:00 PM
const START_MS = Date.parse('2026-11-13T00:00:00.000Z'); // Thu Nov 12, 7:00 PM Eastern
const NOW0 = Date.parse('2026-10-26T16:00:00.000Z');

async function world(opts: { open?: boolean; signUp?: string[] } = {}): Promise<Ctx> {
  const base = await setupGroup();
  await base.organizer.call('PUT', '/api/admin/group', { organizerName: 'Alex' });
  const players = (await base.organizer.call('GET', '/api/admin/dashboard')).data.players as { id: string; name: string }[];
  const byName = Object.fromEntries(players.map((p) => [p.name, p.id]));
  expect((await base.organizer.call('PUT', '/api/admin/tournaments-switch', { on: true })).status).toBe(200);
  expect((await base.organizer.call('PUT', '/api/admin/adjust-credit-switch', { on: true })).status).toBe(200);
  const created = await base.organizer.call('POST', '/api/admin/tournament', BASE);
  expect(created.status, created.text).toBe(200);
  const ctx: Ctx = { ...base, byName, players, tid: created.data.id } as Ctx;
  for (const name of opts.signUp ?? []) {
    const res = await (await playerPhone(ctx, name)).call('POST', '/api/tournament/signup', { tournamentId: ctx.tid, level: 320, dates: [DATE] });
    expect(res.status, res.text).toBe(200);
  }
  if (opts.open !== false && opts.signUp) {
    const res = await ctx.organizer.call('PUT', `/api/admin/tournament/${ctx.tid}/date`, { date: DATE });
    expect(res.status, res.text).toBe(200);
  }
  return ctx;
}

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

async function giveCredit(ctx: Ctx, name: string, cents: number) {
  const res = await ctx.organizer.call('POST', `/api/admin/players/${ctx.byName[name]}/credit-adjust`, { direction: 'add', cents, reason: 'Test credit', seen: pot(ctx, name) });
  expect(res.status, res.text).toBe(200);
}
const lock = async (ctx: Ctx, name: string) => (await playerPhone(ctx, name)).call('POST', '/api/tournament/lock', { tournamentId: ctx.tid, intent: 'lock', priceCents: 1600 });
const join = async (ctx: Ctx, name: string) => (await playerPhone(ctx, name)).call('POST', '/api/tournament/waitlist', { tournamentId: ctx.tid });
const backOut = async (ctx: Ctx, name: string) => (await playerPhone(ctx, name)).call('POST', '/api/tournament/back-out', { tournamentId: ctx.tid });
const card = async (ctx: Ctx, name: string) => (await (await playerPhone(ctx, name)).call('GET', '/api/group')).data.tournament;
const allPots = (ctx: Ctx) => Object.fromEntries(Object.keys(ctx.byName).map((n) => [n, pot(ctx, n)]));
const ledgerCount = (ctx: Ctx) => Number((ctx.app.db.raw.prepare('SELECT COUNT(*) AS c FROM credit_ledger').get() as { c: number }).c);

describe('the shared rules', () => {
  it('Pay by is the night before at 7:00 PM; if that passed, 3 hours before the start', () => {
    // Thursday Nov 12, a month out: Wednesday Nov 11, 7:00 PM Eastern.
    expect(Date.parse(defaultPayBy(DATE, NIGHT_START_MINUTES, 'America/Detroit', NOW0))).toBe(PAY_BY_MS);
    // Opened Wednesday at 9:00 PM (the night before has passed): Thursday 4:00 PM.
    expect(Date.parse(defaultPayBy(DATE, NIGHT_START_MINUTES, 'America/Detroit', Date.parse('2026-11-12T02:00:00.000Z')))).toBe(CUTOFF_MS);
    // Opened Thursday at 5:00 PM (past the cutoff too): the cutoff itself (tickets open already closed).
    expect(Date.parse(defaultPayBy(DATE, NIGHT_START_MINUTES, 'America/Detroit', Date.parse('2026-11-12T22:00:00.000Z')))).toBe(CUTOFF_MS);
    expect(salesCutoffMs(START_MS)).toBe(CUTOFF_MS);
  });

  it('a Tuesday game closes Monday at 7:00 PM', () => {
    expect(defaultPayBy('2026-11-17', NIGHT_START_MINUTES, 'America/Detroit', NOW0)).toBe('2026-11-17T00:00:00.000Z');
  });
});

describe('tickets close the night before (Pay by)', () => {
  // Zip 64 (late paying): after Pay by a player on the list can still pay while a spot is open, until 3 hours before the REAL start (Finalize's
  // Plays, 7:30 PM here: 4:30 PM); standby does not open after Pay by. No credit or charge amount changes on a refused tap.
  const REAL_START_MS = START_MS + 30 * 60_000; // Thu 7:30 PM
  const REAL_CUTOFF_MS = CUTOFF_MS + 30 * 60_000; // Thu 4:30 PM
  it('before Pay by tickets sell as before; after it a late payer can still lock a spot, a standby join is turned away and nothing moves', async () => {
    const ctx = await world({ signUp: ['Blair', 'Casey', 'Devon'] });
    await giveCredit(ctx, 'Blair', 1600);
    await giveCredit(ctx, 'Devon', 1600);
    expect((await lock(ctx, 'Blair')).data.result).toBe('locked');
    const k = await card(ctx, 'Devon');
    expect(k.tickets.closed).toBe(false);
    expect(k.tickets.payBy).toBe(new Date(PAY_BY_MS).toISOString());
    // Wednesday 7:30 PM: Pay by has passed.
    ctx.app.now = AFTER_PAY_BY;
    const potsBefore = allPots(ctx);
    const rowsBefore = ledgerCount(ctx);
    const wl = await join(ctx, 'Casey');
    expect(wl.status).toBe(409);
    expect(allPots(ctx)).toEqual(potsBefore);
    expect(ledgerCount(ctx)).toBe(rowsBefore);
    const late = await card(ctx, 'Devon');
    expect(late.tickets.closed).toBe(false);
    expect(late.tickets.started).toBe(false);
    const res = await lock(ctx, 'Devon');
    expect(res.status, res.text).toBe(200);
    expect(res.data.result).toBe('locked');
    expect(pot(ctx, 'Devon')).toBe(0);
    // The player already locked in keeps their spot and sees it.
    expect((await card(ctx, 'Blair')).tickets.mine.place).toBe('spot');
  });

  it('after Pay by, paying late works until 3 hours before the real start; then everything closes', async () => {
    const ctx = await world({ signUp: ['Blair', 'Casey', 'Devon', 'Emery'] });
    for (const n of ['Blair', 'Casey', 'Devon', 'Emery']) await giveCredit(ctx, n, 1600);
    expect((await lock(ctx, 'Blair')).data.result).toBe('locked');
    ctx.app.now = AFTER_PAY_BY;
    expect((await lock(ctx, 'Casey')).data.result).toBe('locked');
    // A back out after Pay by gives the money back as before.
    const potBlair = pot(ctx, 'Blair');
    expect((await backOut(ctx, 'Blair')).status).toBe(200);
    expect(pot(ctx, 'Blair')).toBe(potBlair + 1600);
    expect((await lock(ctx, 'Devon')).data.result).toBe('locked');
    // 4:00 PM (3 hours before the old fixed 7:00 PM) still sells: the cutoff follows the real start, 7:30 PM, so 4:30 PM.
    ctx.app.now = CUTOFF_MS;
    expect((await card(ctx, 'Emery')).tickets.closed).toBe(false);
    ctx.app.now = REAL_CUTOFF_MS;
    const cut = await card(ctx, 'Emery');
    expect(cut.tickets.closed).toBe(true);
    expect(cut.tickets.started).toBe(false);
    const potEmery = pot(ctx, 'Emery');
    const turned = await lock(ctx, 'Emery');
    expect(turned.status).toBe(409);
    expect(turned.data.message).toBe('Tickets are closed.');
    expect(pot(ctx, 'Emery')).toBe(potEmery);
  });

  it('a back out BEFORE Pay by frees nothing special: the spot is open to everyone then', async () => {
    const ctx = await world({ signUp: ['Blair', 'Casey'] });
    await giveCredit(ctx, 'Blair', 1600);
    expect((await lock(ctx, 'Blair')).data.result).toBe('locked');
    expect((await backOut(ctx, 'Blair')).status).toBe(200);
    ctx.app.now = AFTER_PAY_BY;
    // That back out came before Pay by: after it there is no freed spot.
    expect((await card(ctx, 'Casey')).tickets.freed).toBe(0);
  });

  it('Pay by can still be changed by the organizer, but never later than 3 hours before the start', async () => {
    const ctx = await world({ signUp: ['Blair'] });
    const ok = await ctx.organizer.call('PUT', `/api/admin/tournament/${ctx.tid}/pay-by`, { payBy: new Date(REAL_CUTOFF_MS).toISOString() });
    expect(ok.status, ok.text).toBe(200);
    const late = await ctx.organizer.call('PUT', `/api/admin/tournament/${ctx.tid}/pay-by`, { payBy: new Date(REAL_CUTOFF_MS + 60_000).toISOString() });
    expect(late.status).toBe(400);
    ctx.app.now = AFTER_PAY_BY;
    expect((await card(ctx, 'Blair')).tickets.closed).toBe(false);
  });

  it('the night starting still ends everything (as before), at the real start', async () => {
    const ctx = await world({ signUp: ['Blair'] });
    ctx.app.now = START_MS + 60_000;
    expect((await card(ctx, 'Blair')).tickets.started).toBe(false);
    ctx.app.now = REAL_START_MS + 60_000;
    const k = (await card(ctx, 'Blair')).tickets;
    expect(k.closed).toBe(true);
    expect(k.started).toBe(true);
  });
});

describe('a waitlist player after Pay by', () => {
  it('stays on the list; with a spot open (Zip 64) she can lock it late, and Hold is not needed', async () => {
    const ctx = await world({ signUp: ['Blair', 'Casey'] });
    await giveCredit(ctx, 'Blair', 1600);
    await giveCredit(ctx, 'Casey', 1600);
    expect((await lock(ctx, 'Blair')).data.result).toBe('locked');
    // Casey is already in line (as if the spots had been full when she joined), nothing paid.
    ctx.app.db.raw
      .prepare("INSERT INTO tournament_tickets (id, tournament_id, player_id, place, place_at, price_cents, created_at, updated_at) VALUES ('wl1', ?, ?, 'line', '2026-10-27T00:00:00.000Z', 1600, '2026-10-27T00:00:00.000Z', '2026-10-27T00:00:00.000Z')")
      .run(ctx.tid, ctx.byName.Casey);
    ctx.app.now = AFTER_PAY_BY;
    const potBefore = pot(ctx, 'Casey');
    const open = await card(ctx, 'Casey');
    expect(open.tickets.mine.place).toBe('line'); // still on the list
    expect(open.tickets.closed).toBe(false);
    expect((await lock(ctx, 'Casey')).data.result).toBe('locked');
    expect(pot(ctx, 'Casey')).toBe(potBefore - 1600);
  });
});

describe('Hide and Restore a canceled tournament', () => {
  it('Hide takes it off Home and the lists for everyone, Restore brings it back, nothing is deleted', async () => {
    const ctx = await world({ signUp: ['Blair'] });
    // An open tournament cannot be hidden.
    const early = await ctx.organizer.call('POST', `/api/admin/tournament/${ctx.tid}/hide`, { hidden: true });
    expect(early.status).toBe(409);
    expect((await ctx.organizer.call('POST', `/api/admin/tournament/${ctx.tid}/cancel`, {})).status).toBe(200);
    let d = (await ctx.organizer.call('GET', '/api/admin/dashboard')).data;
    expect(d.tournament.status).toBe('canceled');
    expect(d.hiddenTournaments).toEqual([]);
    expect((await card(ctx, 'Blair')).status).toBe('canceled');
    // Hide.
    const hide = await ctx.organizer.call('POST', `/api/admin/tournament/${ctx.tid}/hide`, { hidden: true });
    expect(hide.status, hide.text).toBe(200);
    d = (await ctx.organizer.call('GET', '/api/admin/dashboard')).data;
    expect(d.tournament).toBeUndefined();
    expect(d.hiddenTournaments.map((h: { name: string }) => h.name)).toEqual(['Winter Classic']);
    expect(await card(ctx, 'Blair')).toBeUndefined();
    // Never deleted: the rows are all still there.
    expect(Number((ctx.app.db.raw.prepare('SELECT COUNT(*) AS c FROM tournaments').get() as { c: number }).c)).toBe(1);
    expect(Number((ctx.app.db.raw.prepare('SELECT COUNT(*) AS c FROM tournament_signups').get() as { c: number }).c)).toBe(1);
    // A second Hide changes nothing.
    expect((await ctx.organizer.call('POST', `/api/admin/tournament/${ctx.tid}/hide`, { hidden: true })).data.changed).toBe(false);
    // Restore.
    expect((await ctx.organizer.call('POST', `/api/admin/tournament/${ctx.tid}/hide`, { hidden: false })).status).toBe(200);
    d = (await ctx.organizer.call('GET', '/api/admin/dashboard')).data;
    expect(d.tournament.status).toBe('canceled');
    expect(d.hiddenTournaments).toEqual([]);
    expect((await card(ctx, 'Blair')).status).toBe('canceled');
  });

  it('only the organizer can hide; a player is refused', async () => {
    const ctx = await world({ signUp: ['Blair'] });
    expect((await ctx.organizer.call('POST', `/api/admin/tournament/${ctx.tid}/cancel`, {})).status).toBe(200);
    const res = await (await playerPhone(ctx, 'Blair')).call('POST', `/api/admin/tournament/${ctx.tid}/hide`, { hidden: true });
    expect([401, 403]).toContain(res.status);
    expect((await card(ctx, 'Blair')).status).toBe('canceled');
  });
});

describe('nobody gets tournament data who should not', () => {
  it('Only me: another player gets no tournament key at all; switch off: no tournament and no hidden list', async () => {
    const base = await setupGroup();
    await base.organizer.call('PUT', '/api/admin/group', { organizerName: 'Alex' });
    expect((await base.organizer.call('PUT', '/api/admin/tournaments-switch', { on: true })).status).toBe(200);
    const created = await base.organizer.call('POST', '/api/admin/tournament', { ...BASE, visibility: 'me' });
    expect(created.status).toBe(200);
    const ctx = { ...base, tid: created.data.id } as unknown as Ctx;
    const phone = await playerPhone(ctx, 'Blair');
    const group = (await phone.call('GET', '/api/group')).data;
    expect('tournament' in group).toBe(false);
    expect(JSON.stringify(group)).not.toContain('Winter Classic');
    // Cancel and hide it: still nothing for the player, and nothing in any player answer.
    await base.organizer.call('POST', `/api/admin/tournament/${created.data.id}/cancel`, {});
    await base.organizer.call('POST', `/api/admin/tournament/${created.data.id}/hide`, { hidden: true });
    const after = (await phone.call('GET', '/api/group')).data;
    expect('tournament' in after).toBe(false);
    expect(JSON.stringify(after)).not.toContain('Winter Classic');
    // Switch off: the organizer's dashboard has no tournament and no hidden list either.
    expect((await base.organizer.call('PUT', '/api/admin/tournaments-switch', { on: false })).status).toBe(200);
    const d = (await base.organizer.call('GET', '/api/admin/dashboard')).data;
    expect(d.tournament).toBeUndefined();
    expect(d.hiddenTournaments).toBeUndefined();
  });
});
