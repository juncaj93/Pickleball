import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { playerPhone, setupGroup, TestApp } from './harness';
import { afterFullCents, afterFullWords, suggestedTier, suggestionWords, tierCostCents, tiersOf } from '../shared/tournamentMoney';
import { fitWords, nightPlan, styleFor } from '../shared/tournamentPlan';
import { prizeCentsOf } from '../shared/tournament';
import { runningTotalOf, soFarCard } from '../shared/totalsRefresh';
import { groupName } from '../shared/scores';

// Zip 84 (🎾84.final dry run), a fresh tester's Locked doubles nights for The Cold Open, on the real server code:
//   Night 2: 10 players (Alex plays free): Draft, swap two, Publish, Edit name / Randomize, first of 4 counts, Play to 9 from Round 2 (alert,
//            pills, Final stays 11 with its alert), a three-way tie (the wheel), Final + 3rd place, End, the board with teams.
//   Night 3: 8 players: the end pulled to 9:30 PM after Finalize; one late drop below 8 (kept, no credit); the spot retaken (credit once).
//   Night 4: 12 players: Dink group and Drive group, points chips, semis, the Final.
//   The prize helper and the price check for 8, 9, 10 and 12 at $18, 2 courts, 7:30 to 10 PM.
// Money to the cent on every night (tickets, credit used, prizes, Money > Totals, Running total) and all three integrity files 0.

const DATE = '2026-12-01';
const DATES = ['2026-11-24', DATE, '2026-12-03'];
const PAY_BY_MS = Date.parse('2026-12-01T00:00:00.000Z'); // Mon Nov 30, 7:00 PM EST
const START_MS = Date.parse('2026-12-02T00:30:00.000Z'); // Tue Dec 1, 7:30 PM EST
const TICKET = 1800;
const MORE = ['Gale', 'Harper', 'Indy', 'Jules', 'Kit', 'Kai', 'Lee', 'Lane', 'Morgan', 'Jordan', 'Avery', 'Rory', 'Shay'];
const ALL = ['Blair', 'Casey', 'Devon', 'Emery', 'Frankie', ...MORE];
const LEVELS = [360, 350, 340, 320, 320, 300, 275, 250];
const SQL = ['integrity-checks.sql', 'integrity-checks-extension.sql', 'integrity-checks-tournament.sql'].map((f) => [f, readFileSync(join(process.cwd(), 'scripts', f), 'utf8')] as const);

type W = Awaited<ReturnType<typeof setupGroup>> & { tid: string; byName: Record<string, string>; org: string };
const raw = (ctx: W) => ctx.app.db.raw;

/** n players locked in at $18 with credit (the organizer, Blair, plays free), `extra` signed up but not locked in; the date finalized. */
async function world84(n: number, o: { extra?: string[]; secondCents?: number } = {}): Promise<W> {
  // The clock starts Mon Nov 23, 2026, 12 PM Eastern (the organizer's sign-in would run out over a jump from the harness's Oct 26).
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
    dates: DATES,
    ticketCents: TICKET,
    creditCents: 1400,
    secondCreditCents: o.secondCents ?? 0,
    visibility: 'all',
    format: 'doubles',
  });
  expect(created.status, created.text).toBe(200);
  const ctx: W = { ...base, byName, tid: created.data.id, org: 'Blair' };
  const names = ALL.slice(0, n);
  for (const [i, name] of [...names, ...(o.extra ?? [])].entries()) {
    const r = await (await playerPhone(ctx, name)).call('POST', '/api/tournament/signup', { tournamentId: ctx.tid, level: LEVELS[i % LEVELS.length], dates: [DATE] });
    expect(r.status, r.text).toBe(200);
  }
  const fin = await ctx.organizer.call('PUT', `/api/admin/tournament/${ctx.tid}/date`, { date: DATE, start: 19 * 60 + 30, minutes: 150, courts: 2 });
  expect(fin.status, fin.text).toBe(200);
  for (const name of names) await lockIn(ctx, name);
  return ctx;
}

async function lockIn(ctx: W, name: string) {
  const org = name === ctx.org;
  if (!org) {
    const give = await ctx.organizer.call('POST', `/api/admin/players/${ctx.byName[name]}/credit-adjust`, { direction: 'add', cents: TICKET, reason: 'Test credit', seen: potOf(ctx, name) });
    expect(give.status, give.text).toBe(200);
  }
  const r = await (await playerPhone(ctx, name)).call('POST', '/api/tournament/lock', { tournamentId: ctx.tid, intent: 'lock', priceCents: org ? 0 : TICKET });
  expect(r.status, r.text).toBe(200);
  expect(r.data.result).toBe('locked');
}

function potOf(ctx: W, name: string): number {
  return Number(
    (
      raw(ctx)
        .prepare(`SELECT COALESCE(SUM(CASE kind WHEN 'kept' THEN amount_cents WHEN 'used' THEN -amount_cents ELSE -(amount_cents - five_cents) END), 0) AS c FROM credit_ledger WHERE player_id = ? AND ended_at IS NULL`)
        .get(ctx.byName[name]) as { c: number }
    ).c,
  );
}
const pots = (ctx: W) => Object.fromEntries(Object.keys(ctx.byName).map((n) => [n, potOf(ctx, n)]));
const dash = async (ctx: W) => (await ctx.organizer.call('GET', '/api/admin/dashboard')).data;
const adminTour = async (ctx: W) => (await dash(ctx)).tournament;
const group = async (ctx: W, name: string) => (await (await playerPhone(ctx, name)).call('GET', '/api/group')).data;
const card = async (ctx: W, name: string) => (await group(ctx, name)).tournament;
const teams = (ctx: W, body: Record<string, unknown>) => ctx.organizer.call('POST', `/api/admin/tournament/${ctx.tid}/teams`, body);
const games = (ctx: W, body: Record<string, unknown>) => ctx.organizer.call('POST', `/api/admin/tournament/${ctx.tid}/games`, body);
const awards = (ctx: W, body: Record<string, unknown>) => ctx.organizer.call('POST', `/api/admin/tournament/${ctx.tid}/awards`, body);
const enter = async (ctx: W, name: string, num: number, mine: number, theirs: number) =>
  (await playerPhone(ctx, name)).call('POST', '/api/tournament/game', { tournamentId: ctx.tid, action: 'score', num, mine, theirs });
const backOut = async (ctx: W, name: string) => (await playerPhone(ctx, name)).call('POST', '/api/tournament/back-out', { tournamentId: ctx.tid });
const nameOfSeat = (d: any, seat: number, i = 0) => d.teams.find((x: any) => x.seat === seat).players[i].name as string;
const signupStatus = (ctx: W, name: string) => (raw(ctx).prepare('SELECT status FROM tournament_signups WHERE tournament_id = ? AND player_id = ?').get(ctx.tid, ctx.byName[name]) as { status: string }).status;
const ledgerCount = (ctx: W) => Number((raw(ctx).prepare('SELECT COUNT(*) AS c FROM credit_ledger').get() as { c: number }).c);
const awardRows = (ctx: W) => raw(ctx).prepare('SELECT player_id, amount_cents, reason FROM credit_ledger WHERE reason LIKE ?').all(`tour:${ctx.tid}:%`) as { player_id: string; amount_cents: number; reason: string }[];
const moneyPrint = (ctx: W) =>
  JSON.stringify([
    raw(ctx).prepare('SELECT player_id, place, price_cents, credit_cents, paid_cents, claim_cents FROM tournament_tickets ORDER BY player_id').all(),
    raw(ctx).prepare("SELECT player_id, kind, amount_cents, five_cents, reason, ended_at FROM credit_ledger WHERE COALESCE(reason, '') NOT LIKE 'tour:%' ORDER BY rowid").all(),
  ]);

/** Every column of all three integrity files reads 0 (info_ columns are counts, not problems). */
function books(ctx: W) {
  for (const [file, sql] of SQL) {
    const r = raw(ctx).prepare(sql).get() as Record<string, number>;
    for (const [k, v] of Object.entries(r)) if (!k.startsWith('info_')) expect(Number(v), `${file} ${k} must be 0`).toBe(0);
  }
}

/** Play every open game round by round by a player's first score; ties: the organizer spins (three) or picks (four or more). */
async function playOut(ctx: W, score: (a: number, b: number, g: any) => [number, number], onRound?: (round: number) => Promise<void>) {
  let lastRound = 0;
  for (let guard = 0; guard < 60; guard++) {
    const t = await adminTour(ctx);
    if (t.end) return;
    const d = t.day;
    const open = d.games.filter((g: any) => !g.winner && !g.skipped && g.a && g.b);
    if (!open.length) {
      const tie = d.ties?.[0];
      if (!tie) throw new Error('stuck: no open game, no tie, no End');
      const r = tie.mode === 'wheel' ? await games(ctx, { action: 'spin', key: tie.key }) : await games(ctx, { action: 'pick', key: tie.key, seat: tie.teams[0].seat, picks: tie.picks });
      expect(r.status, r.text).toBe(200);
      continue;
    }
    const round = Math.min(...open.map((g: any) => g.round));
    if (round !== lastRound && onRound) await onRound(round);
    lastRound = round;
    for (const g of open.filter((x: any) => x.round === round)) {
      const [x, y] = score(g.a.seat, g.b.seat, g);
      const r = await enter(ctx, nameOfSeat(d, g.a.seat), g.num, x, y);
      expect(r.status, `game ${g.num} (${g.stage}): ${r.text}`).toBe(200);
    }
    ctx.app.now += 14 * 60_000;
  }
  throw new Error('the night never ended');
}

async function endNight(ctx: W) {
  const end = (await adminTour(ctx)).end;
  expect(end, 'End tournament shows').toBeTruthy();
  const r = await awards(ctx, { action: 'end', seen: end.seen });
  expect(r.status, r.text).toBe(200);
  // A second tap (double tap, stale card) never pays twice.
  expect((await awards(ctx, { action: 'end', seen: end.seen })).status).not.toBe(200);
  return end;
}

/** Money > Totals for December and the Running total from Oct to Dec (the world's credit is added by hand in November). */
async function totals(ctx: W) {
  const m = async (month: string) => (await ctx.organizer.call('GET', `/api/admin/money?month=${month}`)).data.rework;
  const [oct, nov, dec] = [await m('2026-10'), await m('2026-11'), await m('2026-12')];
  return { dec, run: runningTotalOf([oct, nov, dec].map(soFarCard)), oct };
}

/** The award money, the tickets to the cent and the Totals row. */
async function moneyChecks(ctx: W, o: { paid: number; minutes: number; winners: string[] }) {
  const courts = Math.round((2 * o.minutes * 2400) / 60);
  const tickets = (raw(ctx).prepare('SELECT COALESCE(SUM(credit_cents + paid_cents), 0) AS c FROM tournament_tickets WHERE tournament_id = ? AND price_cents > 0').get(ctx.tid) as { c: number }).c;
  expect(tickets, 'tickets on spots').toBe(o.paid * TICKET);
  const prizes = awardRows(ctx).reduce((s, r) => s + r.amount_cents, 0);
  const expPrize = o.winners.filter((n) => n !== ctx.org).length * 1400;
  expect(prizes, 'prizes').toBe(expPrize);
  expect(awardRows(ctx).every((r) => r.reason.endsWith(':champion')), 'no 2nd place row').toBe(true);
  const { dec, run } = await totals(ctx);
  expect(dec.tournaments, 'Totals: the tournaments row').toEqual([
    { id: ctx.tid, name: 'The Cold Open', date: DATE, ticketsCents: o.paid * TICKET, paid: o.paid, courtCents: courts, courts: 2, minutes: o.minutes, prizeCents: expPrize, resultCents: o.paid * TICKET - courts - expPrize },
  ]);
  expect(run.tournaments).toBe(1);
  expect(run.tournamentsCents).toBe(-(o.paid * TICKET - courts - expPrize));
  return { tickets, courts, prizes: expPrize, result: o.paid * TICKET - courts - expPrize };
}

const LOG: string[] = [];
const log = (s: string) => {
  LOG.push(s);
  console.log(`[zip84] ${s}`);
};

describe('zip 84: the prize helper and the price check at $18, 2 courts, 7:30 to 10 PM', () => {
  it('no 2nd place for Locked doubles anywhere; Americano $21 / $14 / medals; After full prizes for 8, 9, 10, 12', () => {
    expect(tiersOf('doubles')).toEqual(['first', 'medals']);
    expect(tiersOf('americano')).toEqual(['full', 'first', 'medals']);
    expect([tierCostCents('full', 'americano'), tierCostCents('first', 'americano'), tierCostCents('medals', 'americano')]).toEqual([2100, 1400, 0]);
    expect([tierCostCents('first', 'doubles'), tierCostCents('medals', 'doubles')]).toEqual([2800, 0]);
    expect(prizeCentsOf('doubles', 1400, 700)).toBe(2800);
    expect(suggestionWords('first', 'doubles')).toBe('Suggested: $14 each to the winners');
    const want: Record<number, [string, number, string]> = {
      8: ['doubles', -2200, 'After full prizes: $22 short'],
      9: ['americano', 300, 'After full prizes: +$3'],
      10: ['doubles', 1400, 'After full prizes: +$14'],
      12: ['doubles', 5000, 'After full prizes: +$50'],
    };
    for (const n of [8, 9, 10, 12]) {
      const style = styleFor('doubles', n);
      const after = afterFullCents((n - 1) * TICKET, 12000, style);
      expect([style, after, afterFullWords(after)], `${n}`).toEqual(want[n]);
      log(`fit ${n} at 7:30 to 10: ${fitWords(nightPlan(n, 2, 150, 'doubles'), 1170).text}${n === 8 ? ` | 7:30 to 9:30: ${fitWords(nightPlan(8, 2, 120, 'doubles'), 1170).text}` : ''}`);
      log(`price check ${n}: ${style} tickets $${((n - 1) * TICKET) / 100} - courts $120 => ${afterFullWords(after)}; suggested ${suggestedTier((n - 1) * TICKET - 12000, style)}`);
    }
  });

  it('the card on the server: the money line counts the prizes of the style that will be played (9 expected plays Americano)', async () => {
    const out: string[] = [];
    for (const n of [8, 9, 10, 12]) {
      const ctx = await world84(n);
      const t = await adminTour(ctx);
      const prize = t.money.ticketsCents - t.money.courtCents - t.money.youCents;
      out.push(`${n}: format ${t.format} expected ${t.expected} courts $${t.money.courtCents / 100} tickets $${t.money.ticketsCents / 100} you ${t.money.youCents / 100} (prizes counted $${prize / 100}); after full (as the Time/Plan box: t.format) ${afterFullWords(afterFullCents(t.money.ticketsCents, t.money.courtCents, t.format))}`);
      expect(t.money.courtCents).toBe(12000);
      expect(t.money.ticketsCents).toBe((n - 1) * TICKET);
    }
    for (const s of out) log(`server card ${s}`);
  });
});

describe('zip 84 Night 2: 10 players, Locked doubles, Play to 9, a three-way tie, Final + 3rd place', () => {
  it('to the end, money to the cent', async () => {
    const ctx = await world84(10, { secondCents: 700 });
    ctx.app.now = PAY_BY_MS + 60_000;
    const t0 = await adminTour(ctx);
    expect(t0.format).toBe('doubles');
    expect(t0.payBy).toBe(new Date(PAY_BY_MS).toISOString());
    expect(t0.lockedIn).toBe(10);
    // Draft, then swap two players on different teams (tap two to swap), then Publish.
    expect((await teams(ctx, { action: 'draft' })).status).toBe(200);
    const drafted = (await adminTour(ctx)).day.teams as any[];
    expect(drafted).toHaveLength(5);
    const pa = drafted[0].players[0];
    const pb = drafted[1].players[1];
    const sw = await teams(ctx, { action: 'swap', a: pa.id ?? ctx.byName[pa.name], b: pb.id ?? ctx.byName[pb.name] });
    expect(sw.status, sw.text).toBe(200);
    const swapped = (await adminTour(ctx)).day.teams as any[];
    expect(swapped.find((x: any) => x.players.some((p: any) => p.name === pa.name)).players.map((p: any) => p.name)).toContain(drafted[1].players[0].name);
    expect(swapped.find((x: any) => x.players.some((p: any) => p.name === pb.name)).players.map((p: any) => p.name)).toContain(drafted[0].players[1].name);
    const pub = await teams(ctx, { action: 'publish' });
    expect(pub.status, pub.text).toBe(200);
    // Edit name / Randomize: a suggestion saves nothing; Save keeps the duplicate rule.
    const d0 = (await adminTour(ctx)).day;
    const me = nameOfSeat(d0, 1);
    expect((await card(ctx, me)).day.team.canRename).toBe(true);
    const ph = await playerPhone(ctx, me);
    const teamRows = () => JSON.stringify(raw(ctx).prepare('SELECT id, name FROM tournament_teams WHERE tournament_id = ? ORDER BY id').all(ctx.tid));
    const before = teamRows();
    const sug = await ph.call('POST', '/api/tournament/team-name', { tournamentId: ctx.tid, suggest: true, not: d0.teams[0].name });
    expect(sug.status, sug.text).toBe(200);
    expect(d0.teams.map((x: any) => x.name)).not.toContain(sug.data.name);
    expect(teamRows()).toBe(before);
    expect((await ph.call('POST', '/api/tournament/team-name', { tournamentId: ctx.tid, name: d0.teams[1].name })).status).toBe(409);
    expect((await ph.call('POST', '/api/tournament/team-name', { tournamentId: ctx.tid, name: 'Kitchen Sinkers' })).status).toBe(200);
    expect((await card(ctx, nameOfSeat(d0, 1, 1))).day.team.name).toBe('Kitchen Sinkers');

    ctx.app.now = START_MS + 60_000;
    const print0 = moneyPrint(ctx);
    const pot0 = pots(ctx);
    // First of 4 counts: Game 1's first score is the result; the partner agreeing, and the other team, are refused; the same player again is fine.
    const d1 = (await adminTour(ctx)).day;
    const g1 = d1.games.find((g: any) => g.round === 1 && g.a && g.b);
    const win = (a: number, b: number): [number, number] => {
      // Seat 1 beats everyone; seat 5 loses to everyone; 2 > 3 > 4 > 2 (a circle). Every game 9 to 7: 2, 3 and 4 end level on everything.
      if (a === 1 || b === 5) return [9, 7];
      if (b === 1 || a === 5) return [7, 9];
      const beats = (x: number, y: number) => (x === 2 && y === 3) || (x === 3 && y === 4) || (x === 4 && y === 2);
      return beats(a, b) ? [9, 7] : [7, 9];
    };
    const [x1, y1] = win(g1.a.seat, g1.b.seat);
    expect((await enter(ctx, nameOfSeat(d1, g1.a.seat), g1.num, x1, y1)).status).toBe(200);
    const partner = await enter(ctx, nameOfSeat(d1, g1.a.seat, 1), g1.num, x1, y1);
    expect(partner.status).toBe(409);
    expect(partner.text).toContain('It is in.');
    const other = await enter(ctx, nameOfSeat(d1, g1.b.seat), g1.num, 11, 2);
    expect(other.status).toBe(409);
    expect(other.text).toContain('Ask Blair to fix it.');
    expect((await enter(ctx, nameOfSeat(d1, g1.a.seat), g1.num, x1, y1)).status).toBe(200);

    let applied = false;
    await playOut(
      ctx,
      (a, b, g) => (g.stage === 'pool' ? win(a, b) : g.stage === 'tie' ? [5, 3] : g.stage === 'final' ? [11, 8] : [11, 5]),
      async (round) => {
        if (round === 2 && !applied) {
          applied = true;
          const ap = await games(ctx, { action: 'apply', fromRound: 2, to: 9 });
          expect(ap.status, ap.text).toBe(200);
          for (const n of ALL.slice(0, 10)) {
            const c = (await card(ctx, n)).day;
            expect(c.shortAlert, n).toEqual({ key: `short:${ctx.tid}:2:9`, title: 'Starting Round 2, all games go to 9 points.', sub: 'We’re running behind, so games are shorter.' });
            for (const g of c.games) {
              if (g.stage === 'pool' && g.round >= 2) expect(g.playTo, `${n} game ${g.num}`).toBe(9);
              if (g.stage === 'final' || g.stage === 'third') expect(g.playTo).toBe(11);
            }
          }
        }
        // When the Final is set: its 4 players get the Final alert, nobody else; it is to 11.
        const d = (await adminTour(ctx)).day;
        const fin = d.games.find((g: any) => g.stage === 'final');
        if (fin?.a && fin?.b && !fin.winner) {
          const four = new Set([...d.teams.find((x: any) => x.seat === fin.a.seat).players, ...d.teams.find((x: any) => x.seat === fin.b.seat).players].map((p: any) => p.name));
          for (const n of ALL.slice(0, 10)) {
            const c = (await card(ctx, n)).day;
            if (four.has(n)) expect(c.finalAlert?.title, n).toBe('You’re in the Final! It goes to 11 points.');
            else expect(c.finalAlert, n).toBeUndefined();
          }
          expect(fin.playTo).toBe(11);
          log(`night 2: Final alert for ${[...four].join(', ')}`);
        }
      },
    );
    expect(applied).toBe(true);
    const d = (await adminTour(ctx)).day;
    const rows = raw(ctx).prepare('SELECT stage, play_to, score_a, score_b FROM tournament_games WHERE tournament_id = ? ORDER BY num').all(ctx.tid) as any[];
    expect(rows.filter((r) => r.stage === 'final' || r.stage === 'third').every((r) => r.play_to === 11), JSON.stringify(rows)).toBe(true);
    expect(rows.filter((r) => r.stage === 'tie').every((r) => r.play_to === 5)).toBe(true);
    expect(rows.every((r) => r.score_a !== null && r.score_b !== null)).toBe(true);
    const spun = raw(ctx).prepare('SELECT COUNT(*) AS c FROM tournament_ties WHERE tournament_id = ?').get(ctx.tid) as { c: number };
    log(`night 2: games ${rows.map((r) => `${r.stage}:${r.play_to}`).join(' ')}; tie rows ${spun.c}`);
    expect(spun.c, 'the three-way level block was settled by the wheel').toBeGreaterThan(0);
    expect(moneyPrint(ctx)).toBe(print0);
    const end = await endNight(ctx);
    expect(end.second).toBeNull();
    const winners = end.first.players as string[];
    for (const [n, p] of Object.entries(pots(ctx))) expect(p, n).toBe(pot0[n] + (winners.includes(n) && n !== ctx.org ? 1400 : 0));
    expect(moneyPrint(ctx)).toBe(print0);
    // The board with teams: End's order, the Final's winners first with the only gold medal, records only.
    const res = (await card(ctx, ALL[3])).results;
    expect(res.rows).toHaveLength(5);
    expect(res.rows[0].name).toBe(end.first.name);
    expect(res.rows.filter((r: any) => r.medal)).toHaveLength(1);
    expect(JSON.stringify(res)).not.toMatch(/cents|\$/);
    expect(res.rows.map((r: any) => r.name)).toEqual(end.standings.map((r: any) => r.name));
    const m = await moneyChecks(ctx, { paid: 9, minutes: 150, winners });
    log(`night 2: tickets $${m.tickets / 100} (9 paid, Blair free) - courts $${m.courts / 100} - prizes $${m.prizes / 100} = ${m.result >= 0 ? '+' : '-'}$${Math.abs(m.result) / 100}; winners ${winners.join(' + ')}; board ${res.rows.map((r: any) => `${r.name} ${r.record}`).join(', ')}`);
    books(ctx);
  });
});

describe('zip 84 Night 3: 8 players, the end pulled to 9:30 PM, a late drop below 8 then the spot retaken', () => {
  it('kept, no credit; retaken, credit back once; money to the cent', async () => {
    const ctx = await world84(8, { extra: ['Lee', 'Lane'] });
    // After Finalize (before Pay by): the end moves to 9:30 PM. Pay by stays; players on the list get the card.
    const payBy = (await adminTour(ctx)).payBy;
    const mv = await ctx.organizer.call('PUT', `/api/admin/tournament/${ctx.tid}/time`, { start: 1170, minutes: 120 });
    expect(mv.status, mv.text).toBe(200);
    const t = await adminTour(ctx);
    expect(t).toMatchObject({ start: 1170, minutes: 120, payBy });
    expect(t.money.courtCents).toBe(9600);
    for (const n of [...ALL.slice(0, 8), 'Lee']) expect((await card(ctx, n)).timeNote?.title, n).toBe('The Cold Open now ends at 9:30 PM (was 10 PM).');
    expect((await card(ctx, 'Morgan')).timeNote).toBeUndefined();
    log(`night 3: after the move: fit ${JSON.stringify(t.fit ?? t.plan ?? null)?.slice(0, 160)}`);

    ctx.app.now = PAY_BY_MS + 60_000;
    expect((await adminTour(ctx)).format).toBe('doubles');
    expect((await card(ctx, 'Casey')).tickets.dropKeeps).toBe(true);
    const rows0 = ledgerCount(ctx);
    const r = await backOut(ctx, 'Casey');
    expect(r.status, r.text).toBe(200);
    expect(r.data).toMatchObject({ result: 'backed_out', keptCents: TICKET, creditBackCents: 0 });
    expect(potOf(ctx, 'Casey')).toBe(0);
    expect(ledgerCount(ctx)).toBe(rows0);
    expect(signupStatus(ctx, 'Casey')).toBe('kept');
    expect((await backOut(ctx, 'Casey')).data.result).toBe('not_signed_up');
    for (let i = 0; i < 3; i++) await adminTour(ctx);
    expect(potOf(ctx, 'Casey')).toBe(0);
    // 7 locked in after Pay by: the first read switches the night to Americano (Zip 64's rule), and it never switches back by itself.
    const odd = await adminTour(ctx);
    log(`night 3: at 7 locked in: format ${odd.format}; db ${(raw(ctx).prepare('SELECT format, format_source FROM tournaments WHERE id = ?').get(ctx.tid) as any).format}`);
    books(ctx);
    // Lee takes the spot: 8 again, Casey's $18 comes back once; double taps and refreshes never pay twice.
    await lockIn(ctx, 'Lee');
    expect(potOf(ctx, 'Casey')).toBe(TICKET);
    expect(signupStatus(ctx, 'Casey')).toBe('out');
    const rows1 = ledgerCount(ctx);
    await (await playerPhone(ctx, 'Lee')).call('POST', '/api/tournament/lock', { tournamentId: ctx.tid, intent: 'lock', priceCents: TICKET });
    for (let i = 0; i < 3; i++) {
      await adminTour(ctx);
      await card(ctx, 'Casey');
    }
    expect(ledgerCount(ctx)).toBe(rows1);
    expect(potOf(ctx, 'Casey')).toBe(TICKET);
    expect(potOf(ctx, 'Lee')).toBe(0);
    expect((await group(ctx, 'Casey')).credit.balanceCents).toBe(TICKET);
    books(ctx);

    // 8 again: the organizer's card asks "Switch back to Locked doubles?"; Alex taps Switch.
    const even = await adminTour(ctx);
    log(`night 3: at 8 again: format ${even.format}, switchBack ${JSON.stringify(even.switchBack)}`);
    expect(even.switchBack, 'Switch back to Locked doubles? card').toBeTruthy();
    const back = await ctx.organizer.call('POST', `/api/admin/tournament/${ctx.tid}/switch-back`, {});
    expect(back.status, back.text).toBe(200);
    expect((await adminTour(ctx)).format).toBe('doubles');
    expect(potOf(ctx, 'Casey')).toBe(TICKET);
    // The night: Draft, Publish, play (by players' first scores), End.
    const dr = await teams(ctx, { action: 'draft' });
    expect(dr.status, dr.text).toBe(200);
    expect((await teams(ctx, { action: 'publish' })).status).toBe(200);
    ctx.app.now = START_MS + 60_000;
    const print0 = moneyPrint(ctx);
    const pot0 = pots(ctx);
    await playOut(ctx, (a, b, g) => (g.stage === 'pool' ? (a < b ? [11, 4 + a] : [4 + b, 11]) : [11, 9]));
    const end = await endNight(ctx);
    const winners = end.first.players as string[];
    for (const [n, p] of Object.entries(pots(ctx))) expect(p, n).toBe(pot0[n] + (winners.includes(n) && n !== ctx.org ? 1400 : 0));
    expect(moneyPrint(ctx)).toBe(print0);
    // 7 paid spots (Blair free; Lee took Casey's), 2 courts x 2 hours.
    const m = await moneyChecks(ctx, { paid: 7, minutes: 120, winners });
    log(`night 3: Casey kept $18 then back once ($${potOf(ctx, 'Casey') / 100} now); tickets $${m.tickets / 100} - courts $${m.courts / 100} - prizes $${m.prizes / 100} = ${m.result >= 0 ? '+' : '-'}$${Math.abs(m.result) / 100}; winners ${winners.join(' + ')}`);
    books(ctx);
  });
});

describe('zip 84 Night 4: 12 players, the Dink group and the Drive group, semis, the Final', () => {
  it('groups, points chips, semis, Final, End; $7 saved for 2nd pays nobody; money to the cent', async () => {
    const ctx = await world84(12, { secondCents: 700 });
    ctx.app.now = PAY_BY_MS + 60_000;
    expect((await adminTour(ctx)).format).toBe('doubles');
    expect((await teams(ctx, { action: 'draft' })).status).toBe(200);
    expect((await teams(ctx, { action: 'publish' })).status).toBe(200);
    ctx.app.now = START_MS + 60_000;
    const print0 = moneyPrint(ctx);
    const pot0 = pots(ctx);
    const c0 = (await card(ctx, 'Casey')).day;
    expect(c0.standings.map((s: any) => s.pool)).toEqual(['A', 'B']);
    expect([groupName('A'), groupName('B')]).toEqual(['Dink group', 'Drive group']);
    // Before any score: "Court N" / "Sits" (no chip).
    expect(c0.standings.flatMap((s: any) => s.rows).every((r: any) => r.diff === undefined && /^(Court \d+|Sits)$/.test(r.where ?? ''))).toBe(true);
    let chips = false;
    await playOut(
      ctx,
      (a, b, g) => (g.stage === 'pool' ? (a < b ? [11, 3 + (b % 5)] : [3 + (a % 5), 11]) : [11, 7]),
      async () => {
        const c = (await card(ctx, 'Casey')).day;
        if (c.standings.flatMap((s: any) => s.rows).some((r: any) => typeof r.diff === 'number')) {
          chips = true;
          expect(c.standings.flatMap((s: any) => s.rows).every((r: any) => typeof r.diff === 'number' && r.where === undefined)).toBe(true);
        }
      },
    );
    expect(chips, 'points chips once a score is in').toBe(true);
    const rows = raw(ctx).prepare('SELECT stage, COUNT(*) AS c FROM tournament_games WHERE tournament_id = ? GROUP BY stage ORDER BY stage').all(ctx.tid) as any[];
    expect(Object.fromEntries(rows.map((r) => [r.stage, r.c]))).toMatchObject({ pool: 6, semi: 2, final: 1, third: 1 });
    const end = await endNight(ctx);
    expect(end.second).toBeNull();
    expect(end.secondCents).toBe(0);
    const winners = end.first.players as string[];
    for (const [n, p] of Object.entries(pots(ctx))) expect(p, n).toBe(pot0[n] + (winners.includes(n) && n !== ctx.org ? 1400 : 0));
    expect(moneyPrint(ctx)).toBe(print0);
    const res = (await card(ctx, 'Casey')).results;
    expect(res.rows).toHaveLength(6);
    expect(res.rows.filter((r: any) => r.medal)).toHaveLength(1);
    const m = await moneyChecks(ctx, { paid: 11, minutes: 150, winners });
    log(`night 4: games ${rows.map((r) => `${r.stage} ${r.c}`).join(', ')}; tickets $${m.tickets / 100} - courts $${m.courts / 100} - prizes $${m.prizes / 100} = ${m.result >= 0 ? '+' : '-'}$${Math.abs(m.result) / 100}; board ${res.rows.map((r: any) => `${r.name} ${r.record}`).join(', ')}`);
    books(ctx);
  });
});
