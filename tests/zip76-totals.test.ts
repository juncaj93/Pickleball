import { describe, expect, it } from 'vitest';
import type { MonthlyMoney, MonthTournament } from '../shared/api';
import { expectedTournament, monthRowOf, monthSubText, perCourtDollars, projectedCard, runningTotalOf, soFarCard } from '../shared/totalsRefresh';
import { adminTour, awards, books, draftAndPublish, START_MS, world, type World } from './zip58-world';

// Zip 76 (🎾76.money fixes), TOURNAMENT MONEY ON TOTALS (pictures totals-pair-1 to 5):
//  - an ENDED tournament counts in its night's month: tickets in - courts - prize credit given out = its result;
//  - So far / Projected: a row "<name> tournament", made money "-$8" (lowers the cost), cost money "$10";
//  - Running total: "Tournaments <n>" in Out of pocket and Average per month; per game and $/court stay regular games only;
//  - Month by month: "6 games · 1 tournament";
//  - credit added by hand (Adjust credit) is a cost in the month it is given.

type Rework = NonNullable<MonthlyMoney['rework']>;
const tour = (id: string, name: string, resultCents: number): MonthTournament => ({
  id,
  name,
  date: '2026-12-01',
  ticketsCents: 0,
  paid: 0,
  courtCents: 0,
  courts: 2,
  minutes: 150,
  prizeCents: 0,
  resultCents,
});
/** A month's answer: membership $30, `games` games at $48 court each, `payers` paying $14 on each, plus tournaments. */
function month(games: number, payers: number, tours: MonthTournament[] = [], hand = 0): Rework {
  const court = games * 4800;
  const players = games * payers * 1400;
  return {
    courtSessions: games,
    courtCostCents: court,
    membershipCents: 3000,
    owedToVenueCents: court + 3000,
    collectedCents: players,
    yourCostCents: Math.max(0, court + 3000 - players),
    yourCostCourtCents: Math.max(0, court - players),
    yourCostMembershipCents: 3000,
    projected: {
      courtCount: games,
      addedCourts: 0,
      courtCostCents: court,
      membershipCents: 3000,
      totalCents: court + 3000,
      playersPayCents: players,
      yourCostCents: Math.max(0, court + 3000 - players),
      yourCostCourtCents: Math.max(0, court - players),
      yourCostMembershipCents: 3000,
    },
    ...(tours.length ? { tournaments: tours } : {}),
    ...(hand ? { handCreditCents: hand } : {}),
  };
}

// Picture 5's three months: Dec 6 games (3 payers) + The Cold Open +$8, Jan 2 games + New Year Smash -$10, Feb 3 games, no tournament.
const DEC = month(6, 3, [tour('t-dec', 'The Cold Open', 800)]);
const JAN = month(2, 3, [tour('t-jan', 'New Year Smash', -1000)]);
const FEB = month(3, 3);

describe('Zip 76: the month math, to the cent (pictures 1, 3, 4, 5)', () => {
  it("Alex's example: 6 games at $14 with 3 payers + a +$8 tournament = $58 for the month ($11/court, the games only)", () => {
    const c = soFarCard(DEC);
    expect(c).toMatchObject({ membershipCents: 3000, courtCents: 28800, owedCents: 31800, playersCents: 25200, regularNetCents: 6600, netCents: 5800 });
    expect(c.tournaments).toEqual([expect.objectContaining({ name: 'The Cold Open', resultCents: 800 })]);
    expect(perCourtDollars(c.regularNetCents, c.games)).toBe(11);
    // Projected shows the same once it is ended.
    expect(projectedCard(DEC).netCents).toBe(5800);
  });
  it('Jan: a tournament that cost $10: $52, $21/court; Feb with none: $48, $16/court', () => {
    const j = soFarCard(JAN);
    expect(j.netCents).toBe(5200);
    expect(perCourtDollars(j.regularNetCents, j.games)).toBe(21);
    const f = soFarCard(FEB);
    expect(f.netCents).toBe(4800);
    expect(f.tournaments).toEqual([]);
    expect(perCourtDollars(f.regularNetCents, f.games)).toBe(16);
  });
  it('Running total in Feb: Membership $90, Court costs after players $66 (11 games), Tournaments 2 $2, Out of pocket $158, $53 a month, $14 a game', () => {
    const t = runningTotalOf([DEC, JAN, FEB].map(soFarCard));
    expect(t).toEqual({
      months: 3,
      membershipCents: 9000,
      courtAfterPlayersCents: 6600,
      handCreditCents: 0,
      tournaments: 2,
      tournamentsCents: 200,
      games: 11,
      outOfPocketCents: 15800,
      averagePerMonth: 53,
      perGame: 14,
    });
  });
  it('Month by month: "6 games · 1 tournament", net with the tournament, per court without it', () => {
    expect(monthRowOf('2026-12', DEC)).toEqual({ month: '2026-12', games: 6, tournaments: 1, netCents: 5800, perCourt: 11 });
    expect(monthRowOf('2027-01', JAN)).toEqual({ month: '2027-01', games: 2, tournaments: 1, netCents: 5200, perCourt: 21 });
    expect(monthSubText(6, 1)).toBe('6 games · 1 tournament');
    expect(monthSubText(1, 0)).toBe('1 game');
    expect(monthSubText(0, 2)).toBe('2 tournaments');
    expect(monthSubText(0, 0)).toBe('No games');
  });
  it('credit added by hand is a cost in its month: the award-free version of the audit case balances', () => {
    // $14 added by hand in Dec, spent in Jan on a game where 3 others pay $14 cash: Jan's Players paid counts $56 on a $48 court.
    const dec = month(0, 0, [], 1400);
    const jan = { ...month(1, 0), collectedCents: 5600 };
    const t = runningTotalOf([soFarCard(dec), soFarCard(jan)]);
    // Alex got $42 cash for a $48 court: $6 out, plus two memberships.
    expect(t.outOfPocketCents).toBe(6000 + 600);
    expect(soFarCard(dec).netCents).toBe(3000 + 1400);
  });
  it('before End: Projected shows the open tournament expected result in its night month only; So far shows nothing', () => {
    const open = { id: 't-dec', name: 'The Cold Open', status: 'tickets', finalDate: '2026-12-01', offeredDates: ['2026-12-01'], money: { youCents: 2400, ticketsCents: 14400, courtCents: 12000 } };
    const dec = month(6, 3);
    expect(soFarCard(dec).tournaments).toEqual([]);
    const x = expectedTournament(open, '2026-12');
    expect(x).toMatchObject({ resultCents: 2400, detail: { ticketsCents: 14400, courtCents: 12000, prizeCents: 0 } });
    expect(projectedCard(dec, x).netCents).toBe(6600 - 2400);
    expect(expectedTournament(open, '2026-11')).toBeNull();
    expect(expectedTournament({ ...open, status: 'canceled' }, '2026-12')).toBeNull();
    // Once ended the server row wins: never counted twice.
    expect(projectedCard(DEC, expectedTournament({ ...open, money: { ...open.money, youCents: 9999 } }, '2026-12')).netCents).toBe(5800);
  });
});

// ---------- On the real server: a night played to the end ----------

const raw = (ctx: World) => ctx.app.db.raw;
const fix = (ctx: World, body: Record<string, unknown>) => ctx.organizer.call('POST', `/api/admin/tournament/${ctx.tid}/games`, body);

async function playAll(ctx: World) {
  for (let guard = 0; guard < 40; guard++) {
    const d = (await adminTour(ctx)).day;
    const open = d.games.filter((g: any) => !g.winner && !g.skipped && g.a && g.b);
    if (!open.length) return;
    const round = Math.min(...open.map((g: any) => g.round));
    for (const g of open.filter((x: any) => x.round === round)) {
      const r = await fix(ctx, { action: 'result', num: g.num, a: 11, b: 11 - 2 - (g.a.seat % 5) });
      expect(r.status, r.text).toBe(200);
    }
  }
  throw new Error('the night never ended');
}

describe('Zip 76: an ended tournament on Money > Totals, on the real server', () => {
  it('10 players, $16 tickets, 2 courts x 2.5 hrs, $14 x 2 prizes: tickets $160 - courts $120 - prizes $28 = +$12, only after End', async () => {
    const ctx = await world(10);
    expect((await ctx.organizer.call('PUT', '/api/admin/money-rework', { on: true })).status).toBe(200);
    const money = async (m: string) => (await ctx.organizer.call('GET', `/api/admin/money?month=${m}`)).data as MonthlyMoney;
    await draftAndPublish(ctx);
    ctx.app.now = START_MS + 60_000;
    await playAll(ctx);
    // Before End: nothing on Totals (the prizes are not final).
    expect((await money('2026-11')).rework!.tournaments).toBeUndefined();
    const end = (await adminTour(ctx)).end;
    expect((await awards(ctx, { action: 'end', seen: end.seen })).status).toBe(200);
    const nov = (await money('2026-11')).rework!;
    const tickets = (raw(ctx).prepare('SELECT COALESCE(SUM(credit_cents + paid_cents), 0) AS c FROM tournament_tickets WHERE tournament_id = ? AND price_cents > 0').get(ctx.tid) as { c: number }).c;
    const prizes = (raw(ctx).prepare('SELECT COALESCE(SUM(amount_cents), 0) AS c FROM credit_ledger WHERE reason LIKE ?').get(`tour:${ctx.tid}:%`) as { c: number }).c;
    expect(tickets).toBe(16000);
    expect(prizes).toBe(2800);
    expect(nov.tournaments).toEqual([
      { id: ctx.tid, name: 'The Cold Open', date: '2026-11-12', ticketsCents: 16000, paid: 10, courtCents: 12000, courts: 2, minutes: 150, prizeCents: 2800, resultCents: 1200 },
    ]);
    expect(soFarCard(nov).tournaments[0].detail).toEqual({ ticketsCents: 16000, ticketsSub: '10 paid', courtCents: 12000, courtsSub: '2 courts · 2.5 hrs', prizeCents: 2800 });
    // The $16 each the organizer added by hand (Oct 26) is October's cost; the tickets it paid for are November's income: they cancel out.
    const oct = (await money('2026-10')).rework!;
    expect(oct.handCreditCents).toBe(16000);
    expect(soFarCard(oct).netCents + soFarCard(nov).netCents).toBe(oct.owedToVenueCents + nov.owedToVenueCents - oct.collectedCents - nov.collectedCents + 16000 - 1200);
    // Another month: nothing. Tournaments switched off: nothing.
    expect((await money('2026-12')).rework!.tournaments).toBeUndefined();
    expect((await ctx.organizer.call('PUT', '/api/admin/tournaments-switch', { on: false })).status).toBe(200);
    expect((await money('2026-11')).rework!.tournaments).toBeUndefined();
    books(ctx);
  });
});
