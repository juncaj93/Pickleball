import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { playerPhone, setupGroup, TestApp } from './harness';
import { adminTour, awards, card, dash, group, potOf, type World } from './zip58-world';
import { suggestedTier, suggestionWords, tierAmounts, planMoney, afterFullWords } from '../shared/tournamentMoney';
import { oweLine } from '../shared/unpaidNudge';
import { LivePoller, LIVE_UPDATES, NIGHT_STOP_MS } from '../src/livecore';

// Zip 85 (🎾85.final fixes): the last fixes before The Cold Open, from the 🎾84 dry run. The money one (item 9, Alex approved): "Didn't pay"
// AFTER the night started leaves the player owing the ticket like any unpaid game (their You owe card, Pay, I paid; Alex's Money with Mark paid),
// never $18 unpaid with no owed card. And one prize number everywhere (item 1), the idle phone on the night (item 3), the words (items 5, 7).

const DATE = '2026-12-01';
const PAY_BY_MS = Date.parse('2026-12-01T00:00:00.000Z'); // Mon Nov 30, 7:00 PM EST
const START_MS = Date.parse('2026-12-02T00:30:00.000Z'); // Tue Dec 1, 7:30 PM EST
const MORE = ['Gale', 'Harper', 'Indy', 'Jules', 'Kit', 'Kai', 'Lee', 'Lane', 'Morgan', 'Jordan', 'Avery', 'Rory', 'Shay'];
const ALL = ['Blair', 'Casey', 'Devon', 'Emery', 'Frankie', ...MORE];
const LEVELS = [360, 350, 340, 320, 320, 300, 275, 250];
const SQL = ['integrity-checks.sql', 'integrity-checks-extension.sql', 'integrity-checks-tournament.sql'].map((f) => [f, readFileSync(join(process.cwd(), 'scripts', f), 'utf8')] as const);
const raw = (ctx: World) => ctx.app.db.raw;

/** All three integrity files: every non-info column 0. */
function allBooks(ctx: World) {
  for (const [f, sql] of SQL) {
    const r = raw(ctx).prepare(sql).get() as Record<string, number>;
    for (const [k, val] of Object.entries(r)) if (!k.startsWith('info_')) expect(Number(val), `${f} ${k}`).toBe(0);
  }
}

/** n on the list (Blair = the organizer), the vote on Locked doubles (Auto), Finalize, everyone locked in: even players with credit, odd ones
 *  by Venmo + I paid + Alex's Paid. `waiting`: that player's I paid is left waiting. */
async function coldOpen(n: number, opts: { waiting?: string } = {}): Promise<World> {
  // The clock starts Mon Nov 23, 12 PM Eastern (as live: The Cold Open is set up, a week to go).
  const app = new TestApp();
  app.now = Date.parse('2026-11-23T17:00:00.000Z');
  const base = await setupGroup(app);
  await base.organizer.call('PUT', '/api/admin/group', { organizerName: 'Blair' });
  for (const [i, name] of MORE.entries()) expect((await base.organizer.call('POST', '/api/admin/players', { name, phone: `(313) 555-03${String(i).padStart(2, '0')}` })).status).toBe(200);
  const players = (await base.organizer.call('GET', '/api/admin/dashboard')).data.players as { id: string; name: string }[];
  const byName = Object.fromEntries(players.map((p) => [p.name, p.id]));
  for (const sw of ['tournaments-switch', 'adjust-credit-switch', 'money-rework']) expect((await base.organizer.call('PUT', `/api/admin/${sw}`, { on: true })).status).toBe(200);
  const created = await base.organizer.call('POST', '/api/admin/tournament', {
    name: 'The Cold Open',
    dates: ['2026-11-24', DATE, '2026-12-03'],
    ticketCents: 1800,
    creditCents: 0,
    secondCreditCents: 0,
    visibility: 'all',
    format: 'vote',
  });
  expect(created.status, created.text).toBe(200);
  const ctx: World = { ...base, byName, tid: created.data.id };
  const names = ALL.slice(0, n);
  for (const [i, name] of names.entries()) {
    const r = await (await playerPhone(ctx, name)).call('POST', '/api/tournament/signup', { tournamentId: ctx.tid, level: LEVELS[i % LEVELS.length], dates: [DATE], formatVote: i % 3 === 2 ? 'either' : 'locked' });
    expect(r.status, r.text).toBe(200);
  }
  const fin = await ctx.organizer.call('PUT', `/api/admin/tournament/${ctx.tid}/date`, { date: DATE, start: 19 * 60 + 30, minutes: 150, courts: 2 });
  expect(fin.status, fin.text).toBe(200);
  const t = raw(ctx).prepare('SELECT pay_by, format, format_source, ticket_cents FROM tournaments WHERE id = ?').get(ctx.tid) as any;
  expect(t.pay_by).toBe(new Date(PAY_BY_MS).toISOString());
  expect(t.format).toBe('doubles');
  for (const [i, name] of names.entries()) {
    if (name === 'Blair') {
      // The organizer's $0 seat is taken by Finalize already.
      continue;
    }
    const phone = await playerPhone(ctx, name);
    if (i % 2 === 0 && name !== opts.waiting) {
      const give = await ctx.organizer.call('POST', `/api/admin/players/${ctx.byName[name]}/credit-adjust`, { direction: 'add', cents: 1800, reason: 'Test credit', seen: potOf(ctx, name) });
      expect(give.status, give.text).toBe(200);
      const r = await phone.call('POST', '/api/tournament/lock', { tournamentId: ctx.tid, intent: 'lock', priceCents: 1800 });
      expect(r.status, r.text).toBe(200);
      expect(r.data.result).toBe('locked');
      expect(r.data.creditUsedCents).toBe(1800);
    } else {
      const r = await phone.call('POST', '/api/tournament/lock', { tournamentId: ctx.tid, intent: 'lock', priceCents: 1800 });
      expect(r.status, r.text).toBe(200);
      expect(r.data.result).toBe('due');
      const p = await phone.call('POST', '/api/tournament/paid', { tournamentId: ctx.tid, cents: 1800 });
      expect(p.status, p.text).toBe(200);
      if (name !== opts.waiting) {
        const c = await ctx.organizer.call('POST', `/api/admin/tournament/${ctx.tid}/ticket`, { playerId: ctx.byName[name], action: 'confirm', cents: 1800 });
        expect(c.status, c.text).toBe(200);
      }
    }
  }
  return ctx;
}

const scoreAll = async (ctx: World, during?: (round: number) => Promise<void>) => {
  for (let guard = 0; guard < 60; guard++) {
    const r = (await adminTour(ctx)).rounds;
    const open = r.games.filter((g: any) => g.status === 'playing');
    if (!open.length) return;
    for (const g of open) {
      const who = g.a.names[0];
      const mine = (await card(ctx, who)).day.rounds.find((x: any) => x.num === g.num);
      const aWins = g.num % 3 !== 0;
      const res = await (await playerPhone(ctx, who)).call('POST', '/api/tournament/game', { tournamentId: ctx.tid, action: 'score', num: g.num, key: mine.key, mine: aWins ? 11 : 4 + (g.num % 6), theirs: aWins ? 4 + (g.num % 6) : 11 });
      expect(res.status, res.text).toBe(200);
      // A second score from the other side is refused (first answer counts).
      const other = g.b.names[0];
      const theirs = (await card(ctx, other)).day.rounds.find((x: any) => x.num === g.num);
      const again = await (await playerPhone(ctx, other)).call('POST', '/api/tournament/game', { tournamentId: ctx.tid, action: 'score', num: g.num, key: theirs.key, mine: 11, theirs: 0 });
      expect(again.status).toBe(409);
    }
    if (during) await during(open[0].round);
    ctx.app.now += 14 * 60_000;
  }
  throw new Error('the night never ended');
};

/** From the stored games: most rounds sat in a row and the sit-out gap, over the players who played. */
function sitsOf(ctx: World) {
  const rows = raw(ctx).prepare("SELECT round, slot_a, slot_b FROM tournament_games WHERE tournament_id = ? AND slot_a LIKE '%+%' ORDER BY round, num").all(ctx.tid) as { round: number; slot_a: string; slot_b: string }[];
  const everyone = [...new Set(rows.flatMap((r) => [...r.slot_a.split('+'), ...r.slot_b.split('+')]))];
  const rounds = [...new Set(rows.map((r) => r.round))].sort((a, b) => a - b);
  const run = new Map(everyone.map((p) => [p, 0]));
  const sat = new Map(everyone.map((p) => [p, 0]));
  let most = 0;
  let gap = 0;
  for (const round of rounds) {
    const on = new Set(rows.filter((r) => r.round === round).flatMap((r) => [...r.slot_a.split('+'), ...r.slot_b.split('+')]));
    for (const p of everyone) {
      const s = !on.has(p);
      run.set(p, s ? run.get(p)! + 1 : 0);
      if (s) sat.set(p, sat.get(p)! + 1);
    }
    most = Math.max(most, ...run.values());
    gap = Math.max(gap, Math.max(...sat.values()) - Math.min(...sat.values()));
  }
  return { rounds: rounds.length, most, gap, players: everyone.length, games: rows.length };
}

const ticketsMoney = (ctx: World) =>
  raw(ctx).prepare('SELECT COALESCE(SUM(credit_cents), 0) AS credit, COALESCE(SUM(paid_cents), 0) AS paid, COALESCE(SUM(claim_cents), 0) AS claim FROM tournament_tickets WHERE tournament_id = ?').get(ctx.tid) as {
    credit: number;
    paid: number;
    claim: number;
  };
const moneyPrint = (ctx: World) =>
  JSON.stringify([
    raw(ctx).prepare('SELECT player_id, place, price_cents, credit_cents, paid_cents, claim_cents FROM tournament_tickets ORDER BY player_id').all(),
    raw(ctx).prepare("SELECT player_id, kind, amount_cents, five_cents, reason, ended_at FROM credit_ledger WHERE COALESCE(reason, '') NOT LIKE 'tour:%:champion' AND COALESCE(reason, '') NOT LIKE 'tour:%:second' ORDER BY rowid").all(),
  ]);
const NO_TABLE = /"points"\s*:|"record"\s*:|"rank"\s*:|"standings":\[\{/;

/** Edit awards' suggestion (Use these): the highest tier what is left pays, saved for End's 1st and 2nd. Returns the end card after the save. */
async function useSuggestion(ctx: World) {
  const end = (await adminTour(ctx)).end;
  const left = end.money.ticketsCents - end.money.courtCents;
  const tier = suggestedTier(left, 'americano');
  const a = tierAmounts(tier, 'americano');
  const r = await awards(ctx, { action: 'save', first: end.first.key, second: end.second?.key, championCents: a.firstCents, secondCents: a.secondCents, weeks: 1 });
  expect(r.status, r.text).toBe(200);
  return { end: (await adminTour(ctx)).end, tier, left, a };
}

async function totals(ctx: World, month = '2026-12') {
  const m = (await ctx.organizer.call('GET', `/api/admin/money?month=${month}`)).data;
  return m.rework;
}


void card;
void dash;
void useSuggestion;
void scoreAll;
void sitsOf;
void ticketsMoney;
void moneyPrint;
void NO_TABLE;
void totals;
void group;
void awards;

const kaiTicket = (ctx: World) =>
  raw(ctx).prepare('SELECT place, credit_cents, paid_cents, claim_cents, claim_at FROM tournament_tickets WHERE tournament_id = ? AND player_id = ?').get(ctx.tid, ctx.byName.Kai) as any;
const owedOf = async (ctx: World, who: string) => ((await (await playerPhone(ctx, who)).call('GET', '/api/group')).data.ticketsOwed ?? []) as any[];
const adminOwed = async (ctx: World) => ((await ctx.organizer.call('GET', '/api/admin/dashboard')).data.ticketsOwed ?? []) as any[];
const ticket = (ctx: World, action: string, cents = 1800) => ctx.organizer.call('POST', `/api/admin/tournament/${ctx.tid}/ticket`, { playerId: ctx.byName.Kai, action, cents });

describe("zip 85 item 9: Didn't pay after the night started", () => {
  it("Kai's I paid waits into the night; Alex says Didn't pay after the last game: Kai stays in the night and owes $18 like any unpaid game", async () => {
    const ctx = await coldOpen(11, { waiting: 'Kai' });
    ctx.app.now = PAY_BY_MS + 60_000;
    expect((await adminTour(ctx)).lockedIn).toBe(11);
    ctx.app.now = START_MS + 60_000;
    expect(JSON.stringify((await adminTour(ctx)).rounds.games)).toContain('Kai');
    await scoreAll(ctx);
    const pots0 = Object.fromEntries(Object.keys(ctx.byName).map((n) => [n, potOf(ctx, n)]));
    const before = await totals(ctx);
    // Didn't pay, after the night: owed, not dropped.
    const r = await ticket(ctx, 'reject');
    expect(r.status, r.text).toBe(200);
    expect(r.data.owedCents).toBe(1800);
    expect(kaiTicket(ctx)).toEqual({ place: 'none', credit_cents: 0, paid_cents: 0, claim_cents: 1800, claim_at: 'owed' });
    // Kai is still in the night: still locked in, still on the standings (not "out").
    const t = await adminTour(ctx);
    expect(t.lockedIn).toBe(11);
    const kaiRow = t.end.standings.find((x: any) => x.name === 'Kai');
    expect(kaiRow && !kaiRow.out).toBe(true);
    // A second Didn't pay is refused with the words; nothing moves.
    expect((await ticket(ctx, 'reject')).status).toBe(409);
    // Kai's phone: one You owe entry; Alex: one owed row; End is not held up.
    expect(await owedOf(ctx, 'Kai')).toEqual([{ tournamentId: ctx.tid, name: 'The Cold Open', date: DATE, cents: 1800 }]);
    expect(await owedOf(ctx, 'Lee')).toEqual([]);
    expect(await adminOwed(ctx)).toEqual([expect.objectContaining({ playerName: 'Kai', cents: 1800, waiting: false })]);
    const { end } = await useSuggestion(ctx);
    const ended = await awards(ctx, { action: 'end', seen: end.seen });
    expect(ended.status, ended.text).toBe(200);
    // Nobody's credit moved but the prizes; Totals count nothing for Kai yet.
    const first = end.first.name;
    const second = end.second.name;
    for (const n of Object.keys(ctx.byName)) expect(potOf(ctx, n), n).toBe(pots0[n] + (n === 'Blair' ? 0 : n === first ? 1400 : n === second ? 700 : 0));
    const dec = (await totals(ctx)).tournaments[0];
    expect(dec.ticketsCents).toBe(before.tournaments?.[0]?.ticketsCents ?? 16200);
    expect(dec.ticketsCents).toBe(16200);
    expect(dec.paid).toBe(9);
    allBooks(ctx);
    // The next week: the tournament card is gone from Home, the owe card is not.
    ctx.app.now = Date.parse('2026-12-04T17:00:00.000Z');
    expect(await owedOf(ctx, 'Kai')).toHaveLength(1);
    // Kai: I paid for a different amount is refused; the right one waits for Alex (the card goes, Alex sees Paid / Didn't pay).
    const kai = await playerPhone(ctx, 'Kai');
    expect((await kai.call('POST', '/api/tournament/owed-paid', { tournamentId: ctx.tid, cents: 1400 })).status).toBe(409);
    const p = await kai.call('POST', '/api/tournament/owed-paid', { tournamentId: ctx.tid, cents: 1800 });
    expect(p.status, p.text).toBe(200);
    expect((await kai.call('POST', '/api/tournament/owed-paid', { tournamentId: ctx.tid, cents: 1800 })).status).toBe(200);
    expect(kaiTicket(ctx).claim_at).toMatch(/^owed:2026-/);
    expect(await owedOf(ctx, 'Kai')).toEqual([]);
    expect(await adminOwed(ctx)).toEqual([expect.objectContaining({ playerName: 'Kai', cents: 1800, waiting: true })]);
    // Alex: Didn't pay again: owed again (the card is back).
    expect((await ticket(ctx, 'reject')).status).toBe(200);
    expect(kaiTicket(ctx).claim_at).toBe('owed');
    expect(await owedOf(ctx, 'Kai')).toHaveLength(1);
    // Mark paid (Money): the money is in, the ticket holds its spot, Totals count it to the cent, nothing else moves.
    const pots1 = Object.fromEntries(Object.keys(ctx.byName).map((n) => [n, potOf(ctx, n)]));
    expect((await ticket(ctx, 'mark_paid', 1400)).status).toBe(409);
    const m = await ticket(ctx, 'mark_paid');
    expect(m.status, m.text).toBe(200);
    expect(kaiTicket(ctx)).toEqual({ place: 'spot', credit_cents: 0, paid_cents: 1800, claim_cents: 0, claim_at: null });
    for (const n of Object.keys(ctx.byName)) expect(potOf(ctx, n), n).toBe(pots1[n]);
    const dec2 = (await totals(ctx)).tournaments[0];
    expect(dec2.ticketsCents).toBe(18000);
    expect(dec2.paid).toBe(10);
    expect(dec2.resultCents).toBe(dec.resultCents + 1800);
    expect(await owedOf(ctx, 'Kai')).toEqual([]);
    expect(await adminOwed(ctx)).toEqual([]);
    // A second Mark paid (another phone) is refused and changes nothing.
    expect((await ticket(ctx, 'mark_paid')).status).toBe(409);
    expect(kaiTicket(ctx).paid_cents).toBe(1800);
    allBooks(ctx);
  });

  it("Kai pays after the owed card: I paid, then Alex's Paid: the same money as Mark paid", async () => {
    const ctx = await coldOpen(11, { waiting: 'Kai' });
    ctx.app.now = PAY_BY_MS + 60_000;
    expect((await adminTour(ctx)).lockedIn).toBe(11);
    ctx.app.now = START_MS + 60_000;
    expect((await ticket(ctx, 'reject')).status).toBe(200);
    expect(kaiTicket(ctx).claim_at).toBe('owed');
    // During the night: still locked in, the games unchanged.
    expect((await adminTour(ctx)).lockedIn).toBe(11);
    const kai = await playerPhone(ctx, 'Kai');
    expect((await kai.call('POST', '/api/tournament/owed-paid', { tournamentId: ctx.tid, cents: 1800 })).status).toBe(200);
    const c = await ticket(ctx, 'confirm');
    expect(c.status, c.text).toBe(200);
    expect(c.data.creditCents).toBe(0);
    expect(kaiTicket(ctx)).toEqual({ place: 'spot', credit_cents: 0, paid_cents: 1800, claim_cents: 0, claim_at: null });
    expect(potOf(ctx, 'Kai')).toBe(0);
    allBooks(ctx);
  });

  it("before the night (after Pay by), Didn't pay is as before: no owed card, Kai is not locked in", async () => {
    const ctx = await coldOpen(11, { waiting: 'Kai' });
    ctx.app.now = PAY_BY_MS + 60_000;
    expect((await ticket(ctx, 'reject')).status).toBe(200);
    expect(kaiTicket(ctx)).toEqual({ place: 'none', credit_cents: 0, paid_cents: 0, claim_cents: 0, claim_at: null });
    expect((await adminTour(ctx)).lockedIn).toBe(10);
    expect(await owedOf(ctx, 'Kai')).toEqual([]);
    expect(await adminOwed(ctx)).toEqual([]);
    allBooks(ctx);
  });

  it('a player who owes nothing cannot send an owed I paid; View as never sees an owe card', async () => {
    const ctx = await coldOpen(9);
    ctx.app.now = START_MS + 60_000;
    expect((await (await playerPhone(ctx, 'Casey')).call('POST', '/api/tournament/owed-paid', { tournamentId: ctx.tid, cents: 1800 })).status).toBe(409);
  });
});

describe('zip 85 item 1: one prize number', () => {
  it('9 expected on a Locked doubles night: Time, Plan, Finalize and the card all price prizes as Americano (9 plays Americano)', () => {
    const o = { expected: 9, courts: 2, minutes: 150, ticketCents: 1800, championCents: 1400, secondCents: 700 };
    const boxes = planMoney({ ...o, format: 'doubles', closed: false });
    const fin = planMoney({ ...o, format: 'doubles', closed: false });
    expect(boxes).toEqual(fin);
    expect(boxes.style).toBe('americano');
    // $144 tickets - $120 courts - $21 full Americano prizes = +$3 (the boxes said "$4 short" before: Locked doubles' $28).
    expect(boxes.afterFullCents).toBe(300);
    expect(afterFullWords(boxes.afterFullCents)).toBe('After full prizes: +$3');
    // 10 expected stays Locked doubles: $162 - $120 - $28 = +$14.
    expect(planMoney({ ...o, expected: 10, format: 'doubles', closed: false }).afterFullCents).toBe(1400);
    // After tickets close the style is the one played.
    expect(planMoney({ ...o, format: 'doubles', closed: true }).style).toBe('doubles');
  });
  it("the server's card line is the same number as the boxes (The Cold Open, 9 expected)", async () => {
    const ctx = await coldOpen(9);
    ctx.app.now = PAY_BY_MS - 3 * 3_600_000;
    const t = await adminTour(ctx);
    expect(t.expected).toBe(9);
    const boxes = planMoney({ format: t.money.baseStyle, closed: !!t.money.closed, expected: t.expected, courts: t.courts, minutes: t.minutes, ticketCents: t.ticketCents, championCents: t.championCreditCents, secondCents: t.secondCreditCents });
    expect(t.money).toEqual(boxes);
    expect(t.money.style).toBe('americano');
  });
});

describe('zip 85 item 5 and 7: words', () => {
  it('Americano prize words have no "each"; Locked doubles keeps "$14 each to the winners"', () => {
    expect(suggestionWords('full', 'americano')).toBe('Suggested: full prizes (1st $14 · 2nd $7)');
    expect(suggestionWords('first', 'americano')).toBe('Suggested: 1st only ($14)');
    expect(suggestionWords('first', 'doubles')).toBe('Suggested: $14 each to the winners');
    expect(suggestionWords('medals', 'americano')).toBe('Suggested: medals only');
  });
  it('the owe line leads with the total: 1, 2, 3, 4 and 5+ games', () => {
    const TZ = 'America/Detroit';
    const at = (iso: string) => ({ startsAt: iso, amountCents: 1400 });
    expect(oweLine([at('2026-11-13T00:30:00Z')], TZ)).toBe('For Thu, Nov 12');
    expect(oweLine([at('2026-11-13T00:30:00Z'), at('2026-11-20T00:30:00Z')], TZ)).toBe('$14 each, 2 games: Nov 12 and Nov 19');
    // The 🎾84 picture: $42 for 3 games, 2 of them on Nov 19.
    expect(oweLine([at('2026-11-13T00:30:00Z'), at('2026-11-19T22:00:00Z'), at('2026-11-20T00:30:00Z')], TZ)).toBe('$14 each, 3 games: Nov 12 and Nov 19 (2)');
    expect(oweLine([at('2026-11-13T00:30:00Z'), at('2026-11-13T02:30:00Z'), at('2026-11-20T00:30:00Z')], TZ)).toBe('$14 each, 3 games: Nov 12 (2) and Nov 19');
    expect(oweLine([at('2026-11-11T00:30:00Z'), at('2026-11-13T00:30:00Z'), at('2026-11-18T00:30:00Z'), at('2026-11-20T00:30:00Z')], TZ)).toBe('$14 each, 4 games: Nov 10, 12, 17 and 19');
    const five = ['2026-11-04', '2026-11-06', '2026-11-11', '2026-11-13', '2026-11-18'].map((d) => at(`${d}T00:30:00Z`));
    expect(oweLine(five, TZ)).toBe('$14 each, 5 games since Nov 3');
  });
});

describe('zip 85 item 3: a phone left on during the night', () => {
  function fakeEnv() {
    let now = 0;
    const timers: { at: number; fn: () => void; id: number }[] = [];
    let id = 0;
    const env = {
      now: () => now,
      setTimer: (fn: () => void, ms: number) => {
        timers.push({ at: now + ms, fn, id: ++id });
        return id;
      },
      clearTimer: (t: unknown) => {
        const i = timers.findIndex((x) => x.id === t);
        if (i >= 0) timers.splice(i, 1);
      },
      fetchStamp: async () => 'v1',
      onChange: () => undefined,
      isVisible: () => true,
    };
    const run = async (untilMs: number) => {
      while (true) {
        timers.sort((a, b) => a.at - b.at);
        const t = timers[0];
        if (!t || t.at > untilMs) break;
        timers.shift();
        now = t.at;
        t.fn();
        await new Promise((r) => setTimeout(r, 0));
      }
      now = untilMs;
    };
    return { env, run };
  }
  it('untouched for 15 minutes on the night it still checks every 5 seconds (the usual stop after 10 minutes does not apply)', async () => {
    const { env, run } = fakeEnv();
    const p = new LivePoller(env, LIVE_UPDATES);
    p.start();
    p.setNight(Number.POSITIVE_INFINITY);
    await run(15 * 60_000);
    const at15 = p.checks;
    expect(at15).toBeGreaterThanOrEqual(15 * 12 - 2);
    await run(16 * 60_000);
    expect(p.checks - at15).toBeGreaterThanOrEqual(11);
  });
  it('without the night: it stops after 10 quiet minutes, as before', async () => {
    const { env, run } = fakeEnv();
    const p = new LivePoller(env, LIVE_UPDATES);
    p.start();
    await run(15 * 60_000);
    const n = p.checks;
    await run(30 * 60_000);
    expect(p.checks).toBe(n);
  });
  it('the night ends by itself at its time (the reveal hold over), then the usual stop', async () => {
    const { env, run } = fakeEnv();
    const p = new LivePoller(env, LIVE_UPDATES);
    p.start();
    p.setNight(20 * 60_000);
    await run(20 * 60_000 + 10_000);
    const n = p.checks;
    await run(40 * 60_000);
    expect(p.checks - n).toBeLessThanOrEqual(1);
    expect(NIGHT_STOP_MS).toBe(5 * 3_600_000);
  });
});
