import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { playerPhone, setupGroup, TestApp } from './harness';
import { potOf, type World } from './zip58-world';
import { moneySheet, prizeWords, statusWords, stepOf } from '../shared/tournamentCard';
import { expectedTournament } from '../shared/totalsRefresh';
import type { AdminTournamentView } from '../shared/tournament';

// Zip 86 (🎾86.clean admin): the organizer's cleaner tournament card. The Money sheet must match Totals (and the card, Time, Plan and Finalize)
// to the cent: its numbers are the server's money line and cost, nothing worked out again. The Prizes sheet saves through the same Edit save.

const DATE = '2026-12-01';
const MORE = ['Gale', 'Harper', 'Indy', 'Jules', 'Kit', 'Kai', 'Lee', 'Lane', 'Morgan', 'Jordan'];
const LIST = ['Blair', 'Casey', 'Devon', 'Emery', 'Frankie', 'Gale', 'Harper', 'Indy', 'Jules', 'Kit'];
const css = (f: string) => readFileSync(join(process.cwd(), f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/**
 * The Cold Open's pictures: 10 on the list (Blair = the organizer, a free seat), Finalize on Tue Dec 1, 7:30 to 10 PM on 2 courts, $18, prizes
 * not set; 5 pay (credit), 4 do not: 6 of 8 locked in, 4 haven't paid. The Plan saved at 10 players and 2 courts.
 */
async function coldOpen(): Promise<World> {
  const app = new TestApp();
  app.now = Date.parse('2026-11-24T17:00:00.000Z'); // Tue Nov 24, 12 PM Eastern
  const base = await setupGroup(app);
  await base.organizer.call('PUT', '/api/admin/group', { organizerName: 'Blair' });
  for (const [i, name] of MORE.entries()) expect((await base.organizer.call('POST', '/api/admin/players', { name, phone: `(313) 555-04${String(i).padStart(2, '0')}` })).status).toBe(200);
  const players = (await base.organizer.call('GET', '/api/admin/dashboard')).data.players as { id: string; name: string }[];
  const byName = Object.fromEntries(players.map((p) => [p.name, p.id]));
  for (const sw of ['tournaments-switch', 'adjust-credit-switch', 'money-rework']) expect((await base.organizer.call('PUT', `/api/admin/${sw}`, { on: true })).status).toBe(200);
  const created = await base.organizer.call('POST', '/api/admin/tournament', {
    name: 'The Cold Open',
    dates: ['2026-11-26', DATE, '2026-12-03'],
    ticketCents: 1800,
    creditCents: 0,
    secondCreditCents: 0,
    visibility: 'all',
    format: 'vote',
  });
  expect(created.status, created.text).toBe(200);
  const ctx: World = { ...base, byName, tid: created.data.id };
  for (const [i, name] of LIST.entries()) {
    const r = await (await playerPhone(ctx, name)).call('POST', '/api/tournament/signup', { tournamentId: ctx.tid, level: [360, 350, 340, 320, 320, 300, 275, 250][i % 8], dates: [DATE], formatVote: 'locked' });
    expect(r.status, r.text).toBe(200);
  }
  const fin = await ctx.organizer.call('PUT', `/api/admin/tournament/${ctx.tid}/date`, { date: DATE, start: 19 * 60 + 30, minutes: 150, courts: 2 });
  expect(fin.status, fin.text).toBe(200);
  // 5 pay with credit (Casey to Gale); Harper, Indy, Jules and Kit do not.
  for (const name of ['Casey', 'Devon', 'Emery', 'Frankie', 'Gale']) {
    const give = await ctx.organizer.call('POST', `/api/admin/players/${ctx.byName[name]}/credit-adjust`, { direction: 'add', cents: 1800, reason: 'Test credit', seen: potOf(ctx, name) });
    expect(give.status, give.text).toBe(200);
    const r = await (await playerPhone(ctx, name)).call('POST', '/api/tournament/lock', { tournamentId: ctx.tid, intent: 'lock', priceCents: 1800 });
    expect(r.status, r.text).toBe(200);
    expect(r.data.result).toBe('locked');
  }
  const plan = await ctx.organizer.call('PUT', `/api/admin/tournament/${ctx.tid}/plan`, { expected: 10, courts: 2 });
  expect(plan.status, plan.text).toBe(200);
  return ctx;
}

const tour = async (ctx: World): Promise<AdminTournamentView> => (await ctx.organizer.call('GET', '/api/admin/dashboard')).data.tournament;

describe('Zip 86: the Money sheet = the card = Totals, to the cent', () => {
  it('The Cold Open (picture 7): 5 paid $90, courts $120, so far -$30; if all 10 pay $162 - $120 - $28 suggested = +$14; the button +$42 = Totals', async () => {
    const ctx = await coldOpen();
    const t = await tour(ctx);
    expect(t.lockedIn).toBe(6);
    expect(t.spots).toBe(8);
    expect(stepOf(t)).toBe(1);
    expect(statusWords(t, new Date(ctx.app.now).toISOString(), 'America/Detroit')).toBe('Payments · pay by Mon 7 PM');
    expect(prizeWords(t)).toBeNull();
    const ms = moneySheet(t)!;
    expect(ms).toMatchObject({
      paidCount: 5,
      paidCents: 9000,
      courtCents: 12000,
      prizesNowCents: null,
      soFarCents: -3000,
      expected: 10,
      ticketsAllCents: 16200,
      freeSeat: true,
      prizeAllCents: 2800,
      prizeAllWords: '$14 each to the winners',
      prizeSuggested: true,
      keepCents: 1400,
      buttonCents: 4200,
    });
    // The keep after the suggested full tier is the card's "After full prizes" (the Time box, the Plan box and Finalize show it too).
    expect(ms.keepCents).toBe(t.money!.afterFullCents);
    // Totals' Projected card (src/pages/admin/TotalsRefresh.tsx) counts expectedTournament(the dashboard's tournament, month): the Money
    // button's +$42, the tickets and the courts, to the cent.
    const x = expectedTournament(t, '2026-12')!;
    expect(x.resultCents).toBe(ms.buttonCents);
    expect(x.detail.ticketsCents).toBe(ms.ticketsAllCents);
    expect(x.detail.courtCents).toBe(ms.courtCents);
  });

  it('Prizes set through the Prizes sheet (the Edit save): the sheet counts them, You keep = the button = Totals', async () => {
    const ctx = await coldOpen();
    const t0 = await tour(ctx);
    // Exactly what the Prizes sheet sends for Locked doubles (no 2nd place field).
    const r = await ctx.organizer.call('PUT', `/api/admin/tournament/${ctx.tid}`, { name: t0.name, dates: t0.offeredDates, ticketCents: t0.ticketCents, creditCents: 1400, visibility: t0.visibility });
    expect(r.status, r.text).toBe(200);
    const t = await tour(ctx);
    expect(t.championCreditCents).toBe(1400);
    expect(t.format).toBe('doubles');
    expect(prizeWords(t)).toBe('$14 each to the winners');
    const ms = moneySheet(t)!;
    expect(ms.prizesNowCents).toBe(2800);
    expect(ms.soFarCents).toBe(9000 - 12000 - 2800);
    expect(ms.prizeSuggested).toBe(false);
    expect(ms.keepCents).toBe(1400);
    expect(ms.buttonCents).toBe(1400);
    expect(expectedTournament(t, '2026-12')!.resultCents).toBe(1400);
    // Nothing else moved: the price, the date, the style.
    expect(t.ticketCents).toBe(1800);
    expect(t.finalDate).toBe(DATE);
  });

  it('the Change sheet sends today’s calls: a new end and the plan, each refused or saved by the same server rules', async () => {
    const ctx = await coldOpen();
    const time = await ctx.organizer.call('PUT', `/api/admin/tournament/${ctx.tid}/time`, { start: 19 * 60 + 30, minutes: 120 });
    expect(time.status, time.text).toBe(200);
    const plan = await ctx.organizer.call('PUT', `/api/admin/tournament/${ctx.tid}/plan`, { expected: 8, courts: 1 });
    expect(plan.status, plan.text).toBe(200);
    const t = await tour(ctx);
    expect(t.minutes).toBe(120);
    expect(t.courts).toBe(1);
    expect(t.expected).toBe(8);
    // The Change sheet's "Courts cost": 1 court x 2 hours x $24 = $48, the money line's courts.
    expect(moneySheet(t)!.courtCents).toBe(4800);
    // Fewer than locked in is refused by the server (the sheet's minus stops there too).
    const low = await ctx.organizer.call('PUT', `/api/admin/tournament/${ctx.tid}/plan`, { expected: 5, courts: 1 });
    expect(low.status).not.toBe(200);
  });
});

describe('Zip 86: the steps and the status line', () => {
  const base = { status: 'tickets', closed: false, over: false } as const;
  it('Sign up, Payments, Game night, Done; canceled has none', () => {
    expect(stepOf({ ...base, status: 'signup' })).toBe(0);
    expect(stepOf({ ...base, status: 'date_picked' })).toBe(0);
    expect(stepOf({ ...base, status: 'rescheduled' })).toBe(0);
    expect(stepOf(base)).toBe(1);
    expect(stepOf({ ...base, closed: true })).toBe(2);
    expect(stepOf({ ...base, closed: true, over: true })).toBe(3);
    expect(stepOf({ ...base, status: 'ended' })).toBe(3);
    expect(stepOf({ ...base, status: 'canceled' })).toBeNull();
  });
  it('prize words: doubles each to the winners, Americano 1st and 2nd, none at $0', () => {
    expect(prizeWords({ format: 'doubles', championCreditCents: 1400, secondCreditCents: 700 })).toBe('$14 each to the winners');
    expect(prizeWords({ format: 'americano', championCreditCents: 1400, secondCreditCents: 700 })).toBe('1st $14 · 2nd $7');
    expect(prizeWords({ format: 'americano', championCreditCents: 1400, secondCreditCents: 0 })).toBe('1st $14');
    expect(prizeWords({ format: 'doubles', formatPending: true, championCreditCents: 0, secondCreditCents: 0 })).toBeNull();
  });
});

describe('Zip 86: the look rules', () => {
  it('the row’s lime button is the ball token (lime means tournament); the game card’s status colors are the court switch tokens', () => {
    const row = css('src/tour-week-row.css');
    expect(/\.tw-row-lime\s*\{[^}]*background: var\(--ball\);[^}]*color: var\(--ball-ink\);/.test(row)).toBe(true);
    const card = css('src/admin-card86.css');
    expect(/\.r86-status\.r86-booked\s*\{[^}]*background: var\(--sw-booked-bg\);/.test(card)).toBe(true);
    // No green or lime outline ring on the card, no dashed outline on Not booked.
    expect(/scard86[^{]*\{[^}]*dashed/.test(card)).toBe(false);
  });
  it('the player rhythm (picture 4): cards 10 px apart, headings 10 px above their first card, More games 12 px under', () => {
    const r = css('src/player-rhythm86.css');
    expect(r).toMatch(/\.schedule\s*\{\s*gap: 10px;/);
    expect(r).toMatch(/\.schedule > \.week-break\s*\{\s*margin-top: 10px;\s*margin-bottom: 0;/);
    expect(r).toMatch(/main\.page > \.schedule \+ \.btn\.ghost\.block\s*\{\s*margin-top: -8px;/);
  });
});
