import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { playerPhone, setupGroup, TestApp } from './harness';
import { adminTour, awards, card, dash, group, potOf, type World } from './zip58-world';
import { REVEAL_HOLD_MS } from '../shared/reveal';
import { DEFAULT_BANNER_WEEKS } from '../shared/tournament';
import { suggestedTier, tierAmounts } from '../shared/tournamentMoney';
import { runningTotalOf, soFarCard } from '../shared/totalsRefresh';
import { hasChampions } from '../shared/champions';

// Zip 84 (🎾84.final dry run), a fresh tester's dry run of The Cold Open on the REAL server code, as live has it: Tue Dec 1, 7:30 to 10 PM,
// 2 courts, $18, Pay by Mon Nov 30 7:00 PM, style Auto (the players' vote, Finalize "Auto"), champion and 2nd credit $0 until Alex sets them
// (Edit awards' suggestion), the organizer (Blair here) on the list with his $0 seat. Night 1: 9 players. Night 5: 11 players with one whole
// ticket I paid still waiting at Pay by.

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

describe('zip 84 night 1: 9 players, Auto (vote Locked doubles), Pay by switches to Americano, the reveal', () => {
  it('the whole night, money to the cent', async () => {
    const ctx = await coldOpen(9);
    const log: string[] = [];
    // Before Pay by: style TBD for players, 9 locked in, still doubles in the row.
    ctx.app.now = PAY_BY_MS - 60_000;
    const pre = await adminTour(ctx);
    expect(pre.lockedIn).toBe(9);
    expect(raw(ctx).prepare('SELECT format FROM tournaments WHERE id = ?').get(ctx.tid)).toEqual({ format: 'doubles' });
    const cBefore = await card(ctx, 'Casey');
    log.push(`before Pay by: card styleTbd=${cBefore.styleTbd} format=${cBefore.format}`);
    // Pay by passes: the first read switches to Americano (odd count), once.
    ctx.app.now = PAY_BY_MS + 60_000;
    const casey = await card(ctx, 'Casey');
    const row = raw(ctx).prepare('SELECT format, format_source FROM tournaments WHERE id = ?').get(ctx.tid) as any;
    expect(row.format).toBe('americano');
    expect(row.format_source).toMatch(/^odd:/);
    const t1 = await adminTour(ctx);
    expect(t1.format).toBe('americano');
    expect(t1.oddSwitch).toBeTruthy();
    log.push(`after Pay by: banner "${casey.styleNote?.text}" admin oddSwitch=${!!t1.oddSwitch} lockedIn=${t1.lockedIn}`);
    // A second read does not switch again.
    await adminTour(ctx);
    expect((raw(ctx).prepare('SELECT format_source FROM tournaments WHERE id = ?').get(ctx.tid) as any).format_source).toBe(row.format_source);

    // Money before the night: 8 paying x $18 = $144 on tickets (4 by credit $72, 4 by Venmo confirmed $72), the organizer $0.
    const m0 = ticketsMoney(ctx);
    expect(m0).toEqual({ credit: 4 * 1800, paid: 4 * 1800, claim: 0 });
    const before = moneyPrint(ctx);
    const pots0 = Object.fromEntries(Object.keys(ctx.byName).map((n) => [n, potOf(ctx, n)]));

    // The night: hidden standings every round, on the player JSON and the wall / wins.
    ctx.app.now = START_MS + 60_000;
    let leaks = 0;
    await scoreAll(ctx, async () => {
      for (const who of ['Casey', 'Devon', 'Gale']) {
        const g = await group(ctx, who);
        const t = g.tournament;
        if (t.day.standings.length || !t.day.standingsHidden || NO_TABLE.test(JSON.stringify(g))) leaks++;
      }
      const sh = await playerPhone(ctx, 'Gale');
      if ((await sh.call('GET', '/api/tournament/champions')).data.tournaments.length) leaks++;
    });
    expect(leaks, 'standings leaked to a player during the night').toBe(0);
    const s = sitsOf(ctx);
    log.push(`sit-outs: ${s.players} players, ${s.rounds} rounds, ${s.games} games, most in a row ${s.most}, gap ${s.gap}`);
    expect(s.players).toBe(9);
    expect(s.most).toBeLessThanOrEqual(2);
    expect(s.gap).toBeLessThanOrEqual(1);
    expect(moneyPrint(ctx)).toBe(before);

    // All games in: the waiting card (Final standings coming soon) for players, the Reveal button for Alex.
    const waitCard = await card(ctx, 'Casey');
    expect(waitCard.day.waiting).toBe(true);
    expect(NO_TABLE.test(JSON.stringify(waitCard))).toBe(false);
    const t2 = await adminTour(ctx);
    expect(t2.end).toBeTruthy();
    // The End card's standings = Alex's live Standings sheet.
    expect(t2.rounds.standings.map((r: any) => r.name)).toEqual(t2.end.standings.map((r: any) => r.name));
    expect(t2.end.standings).toHaveLength(9);
    // Prizes: $0 saved (as live) -> the suggestion: tickets $144 - courts $120 = $24 left -> full ($21).
    expect(t2.end.money).toEqual({ ticketsCents: 14400, courtCents: 12000 });
    const { end, tier, left } = await useSuggestion(ctx);
    expect(left).toBe(2400);
    expect(tier).toBe('full');
    expect(end.championCents ?? 1400).toBe(1400);
    const first = end.first.name as string;
    const second = end.second.name as string;
    log.push(`End card: 1st ${first}, 2nd ${second}, left $${left / 100}, tier ${tier}`);

    // Reveal standings, twice (a double tap): credit once.
    const tap = ctx.app.now;
    expect((await awards(ctx, { action: 'end', seen: end.seen })).status).toBe(200);
    const again = await awards(ctx, { action: 'end', seen: end.seen });
    expect(again.status).not.toBe(200);
    expect(again.status).not.toBe(500);
    const orgWins = first === 'Blair' || second === 'Blair';
    for (const [name, p] of Object.entries(Object.fromEntries(Object.keys(ctx.byName).map((n) => [n, potOf(ctx, n)]))))
      expect(p, name).toBe(pots0[name] + (name === 'Blair' ? 0 : name === first ? 1400 : name === second ? 700 : 0));
    expect(moneyPrint(ctx)).toBe(before);

    // Mid-reveal: the board is on the phones (the reveal's clock), but nothing tells the winner at the top; the wall and wins wait.
    const gale = await playerPhone(ctx, 'Gale');
    for (const at of [tap + 1_000, tap + 15_000, tap + REVEAL_HOLD_MS - 1]) {
      ctx.app.now = at;
      const g = await group(ctx, 'Gale');
      expect(g.tournament.reveal, 'the reveal clock').toBeTruthy();
      expect(g.tourAwards?.ticker).toBeUndefined();
      expect(g.tourAwards?.congrats).toBeUndefined();
      expect(hasChampions(g.tourAwards?.medals)).toBe(false);
      expect((await gale.call('GET', '/api/tournament/champions')).data.tournaments).toEqual([]);
      expect((await gale.call('GET', `/api/tournament/wins?name=${encodeURIComponent(first)}`)).data.wins).toEqual([]);
      const winnerG = await group(ctx, first);
      expect(winnerG.tourAwards?.congrats, 'no congratulations during the hold').toBeUndefined();
      if (first !== 'Blair') expect(winnerG.credit.balanceCents, 'the chip waits during the hold').toBe(pots0[first]);
      expect(JSON.stringify(winnerG.credit.history)).not.toMatch(/champion/);
    }
    // Someone not in the night (Shay) gets nothing during the hold.
    ctx.app.now = tap + 10_000;
    expect((await group(ctx, 'Shay')).tournament).toBeUndefined();

    // After the hold: the board = the End card = the Standings sheet; the wall shows the winner.
    ctx.app.now = tap + REVEAL_HOLD_MS;
    if (first !== 'Blair') expect((await group(ctx, first)).credit.balanceCents).toBe(pots0[first] + 1400);
    const after = await card(ctx, 'Casey');
    expect(after.day.standings.map((r: any) => r.name)).toEqual(end.standings.map((r: any) => r.name));
    expect(after.results.rows.map((r: any) => r.name)).toEqual(end.standings.map((r: any) => r.name));
    expect(after.results.night).toBe(true);
    expect((await gale.call('GET', '/api/tournament/champions')).data.tournaments).toEqual([{ name: 'The Cold Open', date: DATE, format: 'americano', winners: [first] }]);
    expect((await gale.call('GET', `/api/tournament/wins?name=${encodeURIComponent(first)}`)).data.wins).toHaveLength(1);
    const ga = await group(ctx, 'Gale');
    expect(ga.tourAwards.ticker).toBeTruthy();
    expect(ga.tourAwards.medals[first]).toBe(1);
    expect(Object.values(ga.tourAwards.medals).reduce((a: number, b: any) => a + b, 0)).toBe(1);
    expect((await group(ctx, 'Shay')).tournament.results.rows).toHaveLength(9);

    // The results row: the next day (Wed Dec 2) at 11:59 PM still there; Thu Dec 3 12:00 AM gone. The ticker: 1 week.
    ctx.app.now = Date.parse('2026-12-03T04:59:00.000Z');
    const nextDay = await card(ctx, 'Casey');
    expect(nextDay.results.night).toBe(false);
    expect(nextDay.day).toBeUndefined();
    ctx.app.now = Date.parse('2026-12-03T05:00:30.000Z');
    const gone = await group(ctx, 'Casey');
    expect(gone.tournament).toBeUndefined();
    expect(gone.tourAwards.ticker).toBeTruthy();
    const until = raw(ctx).prepare('SELECT banner_until, ended_at FROM tournaments WHERE id = ?').get(ctx.tid) as any;
    expect(DEFAULT_BANNER_WEEKS).toBe(1);
    expect(Date.parse(until.banner_until) - Date.parse(until.ended_at)).toBe(7 * 86_400_000);
    ctx.app.now = Date.parse(until.banner_until) + 60_000;
    expect((await group(ctx, 'Casey')).tourAwards?.ticker).toBeUndefined();
    log.push(`ticker until ${until.banner_until} (ended ${until.ended_at})`);

    // Totals for December: tickets $144 - courts $120 - prizes (what was paid out: $21, or $14/$7 less when the organizer placed) = result.
    const prizePaid = (orgWins ? 0 : 0) + (first === 'Blair' ? 0 : 1400) + (second === 'Blair' ? 0 : 700);
    const dec = await totals(ctx);
    expect(dec.tournaments).toEqual([expect.objectContaining({ name: 'The Cold Open', ticketsCents: 14400, paid: 8, courtCents: 12000, courts: 2, minutes: 150, prizeCents: prizePaid, resultCents: 14400 - 12000 - prizePaid })]);
    const card12 = soFarCard(dec);
    const running = runningTotalOf([soFarCard(await totals(ctx, '2026-10')), soFarCard(await totals(ctx, '2026-11')), card12]);
    expect(running.tournaments).toBe(1);
    expect(running.tournamentsCents).toBe(-(14400 - 12000 - prizePaid));
    // Hand credit given in October ($72) is October's cost; it bought December's tickets: they cancel.
    log.push(`Totals Dec: tickets $144 courts $120 prizes $${prizePaid / 100} result $${(14400 - 12000 - prizePaid) / 100}; running tournaments ${running.tournamentsCents}c, hand credit ${running.handCreditCents}c, out of pocket ${running.outOfPocketCents}c`);
    allBooks(ctx);
    console.log('NIGHT 1\n  ' + log.join('\n  '));
  });
});

describe('zip 84 night 5: 11 players, one whole ticket I paid still waiting at Pay by', () => {
  it('at Pay by: 11 locked in (the waiting I paid counts), the switch to Americano; Alex Paid before the night: a spot, the night, money', async () => {
    const ctx = await coldOpen(11, { waiting: 'Kai' });
    const log: string[] = [];
    ctx.app.now = PAY_BY_MS + 60_000;
    const t = await adminTour(ctx);
    expect(t.lockedIn).toBe(11);
    expect(t.format).toBe('americano');
    const kai = raw(ctx).prepare('SELECT place, credit_cents, paid_cents, claim_cents FROM tournament_tickets WHERE tournament_id = ? AND player_id = ?').get(ctx.tid, ctx.byName.Kai) as any;
    log.push(`Kai at Pay by: ${JSON.stringify(kai)}; spots ${raw(ctx).prepare("SELECT COUNT(*) AS c FROM tournament_tickets WHERE tournament_id = ? AND place = 'spot'").get(ctx.tid)?.c}`);
    expect(kai).toEqual({ place: 'none', credit_cents: 0, paid_cents: 0, claim_cents: 1800 });
    const kc = await card(ctx, 'Kai');
    log.push(`Kai's card: ${JSON.stringify(kc.ticket ?? kc.my ?? {}).slice(0, 200)}`);
    // Alex: Paid.
    const c = await ctx.organizer.call('POST', `/api/admin/tournament/${ctx.tid}/ticket`, { playerId: ctx.byName.Kai, action: 'confirm', cents: 1800 });
    expect(c.status, c.text).toBe(200);
    expect(c.data.result).toBe('locked');
    expect((await adminTour(ctx)).lockedIn).toBe(11);
    expect(ticketsMoney(ctx)).toEqual({ credit: 4 * 1800, paid: 6 * 1800, claim: 0 });
    const before = moneyPrint(ctx);
    const pots0 = Object.fromEntries(Object.keys(ctx.byName).map((n) => [n, potOf(ctx, n)]));
    ctx.app.now = START_MS + 60_000;
    await scoreAll(ctx);
    const s = sitsOf(ctx);
    log.push(`sit-outs: ${s.players} players, ${s.rounds} rounds, most in a row ${s.most}, gap ${s.gap}`);
    expect(s.players).toBe(11);
    expect(s.most).toBeLessThanOrEqual(2);
    expect(s.gap).toBeLessThanOrEqual(1);
    expect(moneyPrint(ctx)).toBe(before);
    const t2 = await adminTour(ctx);
    expect(t2.end.money).toEqual({ ticketsCents: 18000, courtCents: 12000 });
    const { end, tier, left } = await useSuggestion(ctx);
    expect(left).toBe(6000);
    expect(tier).toBe('full');
    expect((await awards(ctx, { action: 'end', seen: end.seen })).status).toBe(200);
    const first = end.first.name;
    const second = end.second.name;
    for (const n of Object.keys(ctx.byName)) expect(potOf(ctx, n), n).toBe(pots0[n] + (n === 'Blair' ? 0 : n === first ? 1400 : n === second ? 700 : 0));
    const prizePaid = (first === 'Blair' ? 0 : 1400) + (second === 'Blair' ? 0 : 700);
    const dec = await totals(ctx);
    expect(dec.tournaments).toEqual([expect.objectContaining({ ticketsCents: 18000, paid: 10, courtCents: 12000, prizeCents: prizePaid, resultCents: 6000 - prizePaid })]);
    log.push(`Totals Dec: tickets $180 courts $120 prizes $${prizePaid / 100} result $${(6000 - prizePaid) / 100}; 1st ${first} 2nd ${second}`);
    allBooks(ctx);
    console.log('NIGHT 5a\n  ' + log.join('\n  '));
  });

  it("Alex says Didn't pay after Pay by (before the night): 10 locked in, the style, Kai's ticket, the money", async () => {
    const ctx = await coldOpen(11, { waiting: 'Kai' });
    const log: string[] = [];
    ctx.app.now = PAY_BY_MS + 60_000;
    expect((await adminTour(ctx)).format).toBe('americano');
    const r = await ctx.organizer.call('POST', `/api/admin/tournament/${ctx.tid}/ticket`, { playerId: ctx.byName.Kai, action: 'reject', cents: 1800 });
    expect(r.status, r.text).toBe(200);
    const t = await adminTour(ctx);
    log.push(`after Didn't pay: lockedIn ${t.lockedIn}, format ${t.format}, switchBack ${!!t.switchBack}, oddSwitch ${!!t.oddSwitch}`);
    expect(t.lockedIn).toBe(10);
    const kai = raw(ctx).prepare('SELECT place, credit_cents, paid_cents, claim_cents FROM tournament_tickets WHERE tournament_id = ? AND player_id = ?').get(ctx.tid, ctx.byName.Kai) as any;
    log.push(`Kai: ${JSON.stringify(kai)}; Kai's card ticket ${JSON.stringify((await card(ctx, 'Kai')).ticket ?? null).slice(0, 160)}`);
    // Kai tries to pay again after Pay by (10 < 16 open): allowed?
    const again = await (await playerPhone(ctx, 'Kai')).call('POST', '/api/tournament/paid', { tournamentId: ctx.tid, cents: 1800 });
    log.push(`Kai I paid again after Pay by: ${again.status} ${again.data?.result ?? again.data?.message ?? ''}`);
    const t3 = await adminTour(ctx);
    log.push(`then lockedIn ${t3.lockedIn}, format ${t3.format}`);
    allBooks(ctx);
    console.log('NIGHT 5b\n  ' + log.join('\n  '));
  });

  it('the I paid is never answered: the night plays with Kai; Alex answers after End (Paid / Didn\'t pay): money', async () => {
    for (const answer of ['confirm', 'reject'] as const) {
      const ctx = await coldOpen(11, { waiting: 'Kai' });
      const log: string[] = [];
      ctx.app.now = PAY_BY_MS + 60_000;
      expect((await adminTour(ctx)).lockedIn).toBe(11);
      ctx.app.now = START_MS + 60_000;
      const d = (await adminTour(ctx)).rounds;
      const inNight = JSON.stringify(d.games).includes('Kai');
      log.push(`Kai in the night's games: ${inNight}`);
      await scoreAll(ctx);
      const s = sitsOf(ctx);
      log.push(`players ${s.players}, most sits ${s.most}, gap ${s.gap}`);
      const t2 = await adminTour(ctx);
      log.push(`End money (claim waiting): ${JSON.stringify(t2.end.money)}`);
      const { end } = await useSuggestion(ctx);
      const ended = await awards(ctx, { action: 'end', seen: end.seen });
      log.push(`End with the I paid waiting: ${ended.status} ${ended.text.slice(0, 200)}`);
      if (ended.status !== 200) {
        console.log(`NIGHT 5c (${answer})\n  ` + log.join('\n  '));
        // Answer first, then End.
        const a0 = await ctx.organizer.call('POST', `/api/admin/tournament/${ctx.tid}/ticket`, { playerId: ctx.byName.Kai, action: answer, cents: 1800 });
        const k0 = raw(ctx).prepare('SELECT place, credit_cents, paid_cents, claim_cents FROM tournament_tickets WHERE tournament_id = ? AND player_id = ?').get(ctx.tid, ctx.byName.Kai) as any;
        log.push(`${answer} during the night (before End): ${a0.status} creditCents=${a0.data?.creditCents} result=${a0.data?.result} Kai ticket ${JSON.stringify(k0)} pot ${potOf(ctx, 'Kai')}`);
        const e2 = (await adminTour(ctx)).end;
        log.push(`End money now: ${JSON.stringify(e2.money)}; 1st ${e2.first.name} (${e2.championCents}) 2nd ${e2.second?.name} (${e2.secondCents}); Kai rank ${e2.standings.findIndex((r: any) => r.name === 'Kai') + 1}`);
        const ended2 = await awards(ctx, { action: 'end', seen: e2.seen });
        log.push(`End: ${ended2.status} ${ended2.text.slice(0, 120)}`);
        const decX = await totals(ctx);
        log.push(`Totals: ${JSON.stringify(decX.tournaments?.map((x: any) => [x.ticketsCents, x.paid, x.prizeCents, x.resultCents]))}`);
        allBooks(ctx);
        console.log(`NIGHT 5c (${answer}) cont\n  ` + log.join('\n  '));
        continue;
      }
      const kaiPot0 = potOf(ctx, 'Kai');
      const decBefore = await totals(ctx);
      log.push(`Totals before the answer: ${JSON.stringify(decBefore.tournaments?.[0] ? { t: decBefore.tournaments[0].ticketsCents, paid: decBefore.tournaments[0].paid, r: decBefore.tournaments[0].resultCents } : null)}`);
      // The organizer's Home: the I paid card still there after End?
      const dsh = await dash(ctx);
      log.push(`claims on Home after End: ${JSON.stringify((dsh.tournament?.claims ?? dsh.tournamentClaims ?? []).length ?? '?')}`);
      const a = await ctx.organizer.call('POST', `/api/admin/tournament/${ctx.tid}/ticket`, { playerId: ctx.byName.Kai, action: answer, cents: 1800 });
      const kai = raw(ctx).prepare('SELECT place, credit_cents, paid_cents, claim_cents FROM tournament_tickets WHERE tournament_id = ? AND player_id = ?').get(ctx.tid, ctx.byName.Kai) as any;
      const decAfter = await totals(ctx);
      log.push(
        `${answer} after End: ${a.status} creditCents=${a.data?.creditCents} Kai ticket ${JSON.stringify(kai)} pot ${kaiPot0}->${potOf(ctx, 'Kai')}; Totals tickets ${decAfter.tournaments[0].ticketsCents} paid ${decAfter.tournaments[0].paid} result ${decAfter.tournaments[0].resultCents}`,
      );
      allBooks(ctx);
      console.log(`NIGHT 5c (${answer})\n  ` + log.join('\n  '));
    }
  });
});
