// Zip 54: the "Running total" card on Money > Totals. Organizer only, display only. Every figure is added up from numbers the screen already
// has (a past month's finished answer, the current month's So far card); nothing here is new money math.
import { describe, expect, it } from 'vitest';
import type { MonthlyMoney } from '../shared/api';
import { countedPastMonths, runningTotalOf, sinceLabel, soFarCard, stepMonth, type TotalsCard } from '../shared/totalsRefresh';

type Rework = NonNullable<MonthlyMoney['rework']>;

/** A month's "So far" answer from four numbers (cents). */
const month = (membership: number, court: number, players: number, games: number): Rework => ({
  courtSessions: games,
  courtCostCents: court,
  membershipCents: membership,
  owedToVenueCents: membership + court,
  collectedCents: players,
  yourCostCents: Math.max(0, membership + court - players),
  yourCostCourtCents: 0,
  yourCostMembershipCents: membership,
  // A Projected side that must never leak into the Running total.
  projected: { courtCount: 99, addedCourts: 95, courtCostCents: 999900, membershipCents: 3000, totalCents: 999999, playersPayCents: 1, yourCostCents: 999998, yourCostCourtCents: 0, yourCostMembershipCents: 3000 },
});
const cards = (...ms: Rework[]): TotalsCard[] => ms.map(soFarCard);

/** Alex's real numbers, Mon Nov 16 2026. */
const OCT = month(3000, 0, 0, 0);
const NOV_SO_FAR = month(3000, 19200, 16800, 4);

describe("Running total: Alex's real numbers", () => {
  it('Oct $30 with no games + Nov so far (membership $30, court $192, players paid $168, 4 games) = $60, $24, $84, $42 a month, $21 a game', () => {
    const t = runningTotalOf(cards(OCT, NOV_SO_FAR));
    expect(t).toEqual({ months: 2, membershipCents: 6000, courtAfterPlayersCents: 2400, handCreditCents: 0, tournaments: 0, tournamentsCents: 0, games: 4, outOfPocketCents: 8400, averagePerMonth: 42, perGame: 21 });
  });
  it('the current month is the So far card, never Projected (Projected numbers in the same answer change nothing)', () => {
    const a = runningTotalOf(cards(OCT, NOV_SO_FAR));
    const withBigProjected = { ...NOV_SO_FAR, projected: { ...NOV_SO_FAR.projected, totalCents: 1, courtCount: 1 } };
    expect(runningTotalOf(cards(OCT, withBigProjected))).toEqual(a);
    expect(a.outOfPocketCents).toBe(soFarCard(OCT).netCents + soFarCard(NOV_SO_FAR).netCents);
  });
  it('Out of pocket always equals the sum of every month card\'s own net (the Month by month numbers plus the So far card)', () => {
    const ms = [OCT, month(3000, 28800, 25200, 6), month(3000, 0, 0, 0), NOV_SO_FAR];
    const t = runningTotalOf(cards(...ms));
    expect(t.outOfPocketCents).toBe(ms.map((m) => soFarCard(m).netCents).reduce((a, b) => a + b, 0));
    expect(t.membershipCents + t.courtAfterPlayersCents).toBe(t.outOfPocketCents);
  });
});

describe('Running total: edge cases', () => {
  it('no games at all: no per game number (null), the month figures still work', () => {
    const t = runningTotalOf(cards(OCT, month(3000, 0, 0, 0)));
    expect(t.games).toBe(0);
    expect(t.perGame).toBeNull();
    expect(t.outOfPocketCents).toBe(6000);
    expect(t.averagePerMonth).toBe(30);
  });
  it('one month only: still works', () => {
    const t = runningTotalOf(cards(NOV_SO_FAR));
    expect(t).toMatchObject({ months: 1, membershipCents: 3000, outOfPocketCents: 5400, averagePerMonth: 54, perGame: 14 });
    expect(runningTotalOf(cards(NOV_SO_FAR)).perGame).toBe(14); // 5400 / 4 = 13.5, up
  });
  it('a month with membership and no games in the middle counts (it lowers nothing, it adds its $30 and one month)', () => {
    const t = runningTotalOf(cards(month(3000, 19200, 16800, 4), month(3000, 0, 0, 0), NOV_SO_FAR));
    expect(t.months).toBe(3);
    expect(t.membershipCents).toBe(9000);
    expect(t.outOfPocketCents).toBe(5400 + 3000 + 5400);
    expect(t.averagePerMonth).toBe(Math.round(13800 / 3 / 100)); // 46
    expect(t.games).toBe(8);
  });
  it('a credit month: the players paid more than the venue was owed. It lowers the total; a whole credit total is negative (no minus sign is drawn, the page says "credit")', () => {
    const credit = month(0, 9600, 12000, 2); // net -$24
    const t = runningTotalOf(cards(credit));
    expect(t.outOfPocketCents).toBe(-2400);
    expect(t.averagePerMonth).toBe(-24);
    expect(t.perGame).toBe(-12);
    // A credit month next to a normal month just nets out.
    expect(runningTotalOf(cards(credit, month(3000, 0, 0, 0))).outOfPocketCents).toBe(600);
  });
  it('rounding: whole dollars, halves away from zero, the same rule as $/court', () => {
    // $54 over 3 months = $18.00 exactly; $50 / 3 = 16.67 -> 17; $25 / 2 months = 12.50 -> 13; $25 / 6 games = 4.17 -> 4
    expect(runningTotalOf(cards(month(5000, 0, 0, 0), month(0, 0, 0, 0), month(0, 0, 0, 0))).averagePerMonth).toBe(17);
    expect(runningTotalOf(cards(month(2500, 0, 0, 0), month(0, 0, 0, 0))).averagePerMonth).toBe(13);
    expect(runningTotalOf(cards(month(2500, 0, 0, 6))).perGame).toBe(4);
    expect(Number.isInteger(runningTotalOf(cards(month(3333, 1111, 777, 7), month(3000, 0, 0, 0))).averagePerMonth!)).toBe(true);
  });
  it('no cards at all: nothing to divide (null), never NaN', () => {
    const t = runningTotalOf([]);
    expect(t.averagePerMonth).toBeNull();
    expect(t.perGame).toBeNull();
    expect(t.outOfPocketCents).toBe(0);
  });
});

describe('Running total: which months count', () => {
  const choices = (...ms: string[]) => ms.map((m) => ({ month: m }));
  it("Nov 16: the first game month is November, but October's membership counts, so October is a counted past month", () => {
    expect(countedPastMonths(choices('2026-11'), '2026-11')).toEqual(['2026-10']);
  });
  it('later: every month from October up to the one before this one, newest first', () => {
    expect(countedPastMonths(choices('2026-11', '2026-12', '2027-01', '2027-02'), '2027-02')).toEqual(['2027-01', '2026-12', '2026-11', '2026-10']);
  });
  it('a game month later than the current one (a future month with games) never counts', () => {
    expect(countedPastMonths(choices('2026-11', '2026-12'), '2026-11')).toEqual(['2026-10']);
  });
  it('before the membership started (a September current month) there is no past month', () => {
    expect(countedPastMonths(choices('2026-09'), '2026-09')).toEqual([]);
  });
  it('a game month before October still starts the list there', () => {
    expect(countedPastMonths(choices('2026-08', '2026-09', '2026-10'), '2026-10')).toEqual(['2026-09', '2026-08']);
  });
  it('stepMonth crosses a year', () => {
    expect(stepMonth('2027-01', -1)).toBe('2026-12');
    expect(stepMonth('2026-12', 1)).toBe('2027-01');
  });
});

describe('Running total: the footer words', () => {
  it('"Oct" in the same year, "Oct 2026" once the year has turned', () => {
    expect(sinceLabel('2026-10', '2026-11')).toBe('Oct');
    expect(sinceLabel('2026-10', '2027-01')).toBe('Oct 2026');
  });
});
