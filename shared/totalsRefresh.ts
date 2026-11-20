// Zip 23 (Nov 2026): TOTALS_REFRESH ("Totals refresh"), ships OFF. Organizer only, display only.
//  - Money > Totals gets Alex's mock: two cards ("So far" with a yellow accent, "Projected" with a slate blue one), each a short list
//    (Membership, Court costs, Owed to venue, Players paid / Players pay) and a bottom row with the card's total and "$21/court", then one
//    collapsed "Month by month" card (one row per past month).
//  - Same numbers, same rules as the Totals screen before it: every figure comes from the server's `rework` answer (server/money.ts), the
//    big total is "Your cost so far" / "Your estimated cost", the page works out only the new "per court" figure and the month rows.
//  - The one new number: per court = that total divided by the games counted on that card (one court per game), in whole dollars.
//  - A wrangler.toml kill switch (allowed unless "off"), a Settings > Feature switches row (one task_log row, no schema change), and a
//    private per-phone link (/admin?totalsrefresh=on) that sends the header below. No database change, no new cost.

import type { MonthlyMoney, MonthTournament } from './api';
import { MEMBERSHIP_FROM } from './moneyRework';

export const TOTALS_REFRESH = { task: 'totals_refresh_on', header: 'X-Totals-Refresh', link: 'totalsrefresh', env: 'TOTALS_REFRESH', name: 'Totals refresh' } as const;

/** A wrangler.toml kill switch: allowed unless it says "off". Who gets it is Settings' call. */
export function totalsRefreshAllowed(flag: string | undefined | null): boolean {
  return (flag ?? 'on').trim().toLowerCase() !== 'off';
}

type Rework = NonNullable<MonthlyMoney['rework']>;

/**
 * Zip 76: one tournament row on a card. `resultCents` above 0: the organizer made money (it lowers his cost, shown "−$8" in green); below 0
 * it cost him (red "$10").
 */
export interface TotalsTournament {
  id: string;
  name: string;
  resultCents: number;
  /** Where the result came from (picture 2): Tickets, Courts, Prizes and the small words after each. */
  detail: { ticketsCents: number; ticketsSub: string; courtCents: number; courtsSub: string; prizeCents: number };
}

/** "2.5 hrs", "2 hrs", "1 hr". */
export function hoursText(minutes: number): string {
  const h = Math.round((minutes / 60) * 100) / 100;
  return `${h} ${h === 1 ? 'hr' : 'hrs'}`;
}

/** One of the two cards, in cents. `netCents` is what the organizer is out after the players' share; negative = the players paid more than the venue is owed. */
export interface TotalsCard {
  membershipCents: number;
  courtCents: number;
  /** Games counted on this card (one court per game). */
  games: number;
  /** Membership + court costs. */
  owedCents: number;
  /** What the players paid (So far) or will pay (Projected). */
  playersCents: number;
  /** Zip 76: credit added by hand this month (minus taken away), a cost. 0 when none. */
  handCreditCents: number;
  /** Zip 76: the month's tournaments (So far: ended ones; Projected: those plus the open one's expected result). */
  tournaments: TotalsTournament[];
  /** Zip 76: the regular games only (owed - players + hand credit): what per court divides, Alex's check on the $14 price. */
  regularNetCents: number;
  /** Everything: regularNetCents minus every tournament's result. */
  netCents: number;
}

const tourRows = (list: MonthTournament[] | undefined): TotalsTournament[] =>
  (list ?? []).map((t) => ({
    id: t.id,
    name: t.name,
    resultCents: t.resultCents,
    detail: {
      ticketsCents: t.ticketsCents,
      ticketsSub: `${t.paid} paid`,
      courtCents: t.courtCents,
      courtsSub: `${t.courts} ${t.courts === 1 ? 'court' : 'courts'} · ${hoursText(t.minutes)}`,
      prizeCents: t.prizeCents,
    },
  }));

function card(base: Omit<TotalsCard, 'regularNetCents' | 'netCents'>): TotalsCard {
  const regularNetCents = base.owedCents - base.playersCents + base.handCreditCents;
  return { ...base, regularNetCents, netCents: regularNetCents - base.tournaments.reduce((a, t) => a + t.resultCents, 0) };
}

/**
 * The "So far" card from the server's numbers. `regularNetCents` is owed minus players paid (plus credit added by hand); it is the same figure
 * as the server's "Your cost so far" whenever that is above $0 (the server never goes below $0, this card also shows a credit). Zip 76: the
 * month's ENDED tournaments count here (their prizes are final).
 */
export function soFarCard(t: Rework): TotalsCard {
  return card({
    membershipCents: t.membershipCents,
    courtCents: t.courtCostCents,
    games: t.courtSessions,
    owedCents: t.owedToVenueCents,
    playersCents: t.collectedCents,
    handCreditCents: t.handCreditCents ?? 0,
    tournaments: tourRows(t.tournaments),
  });
}

/**
 * The "Projected" card. Games = every court counted so far plus the ones still to come (the server's `courtCount`). Zip 76: the ended
 * tournaments, plus `expected`: an open tournament whose night is in this month, with its card's "You make if it fills" number.
 */
export function projectedCard(t: Rework, expected: TotalsTournament | null = null): TotalsCard {
  const p = t.projected;
  const ended = tourRows(t.tournaments);
  return card({
    membershipCents: p.membershipCents,
    courtCents: p.courtCostCents,
    games: p.courtCount,
    owedCents: p.totalCents,
    playersCents: p.playersPayCents,
    handCreditCents: t.handCreditCents ?? 0,
    tournaments: expected && !ended.some((x) => x.id === expected.id) ? [...ended, expected] : ended,
  });
}

/**
 * Zip 76: the open tournament's expected result for the Projected card of `month` ("2026-12"): its night (the picked date, else the first date
 * offered) must fall in that month, it is not canceled, and its card has a money line. Null otherwise.
 */
export function expectedTournament(
  tour:
    | { id: string; name: string; status: string; finalDate: string | null; offeredDates: string[]; money?: { youCents: number; ticketsCents: number; courtCents: number } }
    | null
    | undefined,
  month: string,
): TotalsTournament | null {
  if (!tour || tour.status === 'canceled' || !tour.money) return null;
  const night = tour.finalDate ?? [...tour.offeredDates].sort()[0] ?? null;
  if (!night || night.slice(0, 7) !== month) return null;
  const m = tour.money;
  return {
    id: tour.id,
    name: tour.name,
    resultCents: m.youCents,
    detail: { ticketsCents: m.ticketsCents, ticketsSub: 'if it fills', courtCents: m.courtCents, courtsSub: '', prizeCents: m.ticketsCents - m.courtCents - m.youCents },
  };
}

/**
 * Dollars per court: net cost divided by games, rounded to the nearest whole dollar (halves away from zero), the same whole-dollar rounding
 * the Settings and Short games screens use for money shown to the organizer. No games (0, or a bad number): null, so nothing is shown.
 * A credit (net below $0) comes back as a negative number of dollars, rounded the same way on its size.
 */
export function perCourtDollars(netCents: number, games: number): number | null {
  if (!Number.isFinite(netCents) || !Number.isFinite(games) || games <= 0) return null;
  const abs = Math.round(Math.abs(netCents) / games / 100);
  return netCents < 0 && abs > 0 ? -abs : abs;
}

/** "$21" or, for a credit, "$4" (the page adds the word credit and the green). Whole dollars, no commas, like the site's formatPrice ("$1234"). */
export const dollarsText = (d: number) => `$${Math.abs(d)}`;

/** One row of Month by month. */
export interface MonthRow {
  month: string;
  games: number;
  /** Zip 76: tournaments counted in the month ("6 games · 1 tournament"). */
  tournaments: number;
  netCents: number;
  /** null with no games (the row says "No games"). Regular games only. */
  perCourt: number | null;
}

/** A past month's row from that month's own answer (the same `rework` numbers its Totals page shows, "So far" side). */
export function monthRowOf(month: string, t: Rework): MonthRow {
  const c = soFarCard(t);
  return { month, games: c.games, tournaments: c.tournaments.length, netCents: c.netCents, perCourt: perCourtDollars(c.regularNetCents, c.games) };
}

/** "6 games · 1 tournament", "No games", "1 tournament". */
export function monthSubText(games: number, tournaments: number): string {
  const g = games > 0 ? `${games} ${games === 1 ? 'game' : 'games'}` : '';
  const t = tournaments > 0 ? `${tournaments} ${tournaments === 1 ? 'tournament' : 'tournaments'}` : '';
  return [g, t].filter(Boolean).join(' · ') || 'No games';
}

/** The past months to list, newest first: every month in the list that is before the current one. */
export function pastMonths(choices: { month: string }[], currentMonth: string): string[] {
  return choices.map((c) => c.month).filter((m) => m < currentMonth);
}

// ---------- Running total (Zip 54) ----------
// A third card between Projected and Month by month: what the group has cost the organizer in total across months. No new money math: every
// month is added up from the same "So far" figures the screen already has (a past month's finished answer, the current month's So far card;
// never Projected).

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-10" shifted by whole months. */
export function stepMonth(month: string, by: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** The first month the membership is charged ("2026-10"). */
export const MEMBERSHIP_FIRST_MONTH = `${MEMBERSHIP_FROM.year}-${String(MEMBERSHIP_FROM.month).padStart(2, '0')}`;

/**
 * Every month the totals cover before the current one, newest first. A month counts from the first month with any record: the first month
 * with a game (the earliest in `choices`) or the first month the membership is charged, whichever is earlier, but never later than the
 * current month. A past month with a membership and no games counts; a future month does not.
 */
export function countedPastMonths(choices: { month: string }[], currentMonth: string): string[] {
  const firstGame = choices.map((c) => c.month).sort()[0];
  let first = firstGame && firstGame < currentMonth ? firstGame : currentMonth;
  if (MEMBERSHIP_FIRST_MONTH < first) first = MEMBERSHIP_FIRST_MONTH;
  const out: string[] = [];
  for (let m = stepMonth(currentMonth, -1), guard = 0; m >= first && guard < 600; m = stepMonth(m, -1), guard++) out.push(m);
  return out;
}

/** "Oct" for the footer; with another year than now "Oct 2026", so "since Oct" never points at the wrong October. */
export function sinceLabel(firstMonth: string, currentMonth: string): string {
  const [y, m] = firstMonth.split('-').map(Number);
  const name = MONTH_NAMES[m - 1] ?? '';
  return y === Number(currentMonth.split('-')[0]) ? name : `${name} ${y}`;
}

export interface RunningTotal {
  /** Months counted, the first month through the current one. */
  months: number;
  membershipCents: number;
  /** Court costs minus what the players paid, added up (can be below 0). */
  courtAfterPlayersCents: number;
  /** Zip 76: credit added by hand, added up (a cost; below 0 when more was taken away). */
  handCreditCents: number;
  /** Zip 76: how many tournaments, and their net COST to the organizer (below 0: they made money overall). */
  tournaments: number;
  tournamentsCents: number;
  /** Games played (courts used) in those months. */
  games: number;
  /** Membership + court costs after players + credit added by hand + tournaments. Below 0 = a credit. */
  outOfPocketCents: number;
  /** Out of pocket / months, whole dollars (negative = credit). */
  averagePerMonth: number | null;
  /** Regular games only (no tournaments): (membership + court costs after players + hand credit) / games, whole dollars; null with no games. */
  perGame: number | null;
}

/** Adds the "So far" cards of every counted month (oldest to current). The average uses the same whole-dollar rounding as per court. */
export function runningTotalOf(cards: TotalsCard[]): RunningTotal {
  const sum = (f: (c: TotalsCard) => number) => cards.reduce((a, c) => a + f(c), 0);
  const membershipCents = sum((c) => c.membershipCents);
  const courtAfterPlayersCents = sum((c) => c.courtCents - c.playersCents);
  const handCreditCents = sum((c) => c.handCreditCents);
  const tournaments = sum((c) => c.tournaments.length);
  const tournamentsCents = sum((c) => c.tournaments.reduce((a, t) => a - t.resultCents, 0)) || 0;
  const games = sum((c) => c.games);
  const regular = membershipCents + courtAfterPlayersCents + handCreditCents;
  const outOfPocketCents = regular + tournamentsCents;
  return {
    months: cards.length,
    membershipCents,
    courtAfterPlayersCents,
    handCreditCents,
    tournaments,
    tournamentsCents,
    games,
    outOfPocketCents,
    averagePerMonth: perCourtDollars(outOfPocketCents, cards.length),
    perGame: perCourtDollars(regular, games),
  };
}
