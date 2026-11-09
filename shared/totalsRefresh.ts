// Zip 23 (Nov 2026): TOTALS_REFRESH ("Totals refresh"), ships OFF. Organizer only, display only.
//  - Money > Totals gets Alex's mock: two cards ("So far" with a yellow accent, "Projected" with a slate blue one), each a short list
//    (Membership, Court costs, Owed to venue, Players paid / Players pay) and a bottom row with the card's total and "$21/court", then one
//    collapsed "Month by month" card (one row per past month).
//  - Same numbers, same rules as the Totals screen before it: every figure comes from the server's `rework` answer (server/money.ts), the
//    big total is "Your cost so far" / "Your estimated cost", the page works out only the new "per court" figure and the month rows.
//  - The one new number: per court = that total divided by the games counted on that card (one court per game), in whole dollars.
//  - A wrangler.toml kill switch (allowed unless "off"), a Settings > Feature switches row (one task_log row, no schema change), and a
//    private per-phone link (/admin?totalsrefresh=on) that sends the header below. No database change, no new cost.

import type { MonthlyMoney } from './api';

export const TOTALS_REFRESH = { task: 'totals_refresh_on', header: 'X-Totals-Refresh', link: 'totalsrefresh', env: 'TOTALS_REFRESH', name: 'Totals refresh' } as const;

/** A wrangler.toml kill switch: allowed unless it says "off". Who gets it is Settings' call. */
export function totalsRefreshAllowed(flag: string | undefined | null): boolean {
  return (flag ?? 'on').trim().toLowerCase() !== 'off';
}

type Rework = NonNullable<MonthlyMoney['rework']>;

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
  netCents: number;
}

/**
 * The "So far" card from the server's numbers. `netCents` is owed minus players paid; it is the same figure as the server's "Your cost so
 * far" whenever that is above $0 (the server never goes below $0, this card also shows a credit).
 */
export function soFarCard(t: Rework): TotalsCard {
  return { membershipCents: t.membershipCents, courtCents: t.courtCostCents, games: t.courtSessions, owedCents: t.owedToVenueCents, playersCents: t.collectedCents, netCents: t.owedToVenueCents - t.collectedCents };
}

/** The "Projected" card. Games = every court counted so far plus the ones still to come (the server's `courtCount`). */
export function projectedCard(t: Rework): TotalsCard {
  const p = t.projected;
  return { membershipCents: p.membershipCents, courtCents: p.courtCostCents, games: p.courtCount, owedCents: p.totalCents, playersCents: p.playersPayCents, netCents: p.totalCents - p.playersPayCents };
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
  netCents: number;
  /** null with no games (the row says "No games"). */
  perCourt: number | null;
}

/** A past month's row from that month's own answer (the same `rework` numbers its Totals page shows, "So far" side). */
export function monthRowOf(month: string, t: Rework): MonthRow {
  const c = soFarCard(t);
  return { month, games: c.games, netCents: c.netCents, perCourt: perCourtDollars(c.netCents, c.games) };
}

/** The past months to list, newest first: every month in the list that is before the current one. */
export function pastMonths(choices: { month: string }[], currentMonth: string): string[] {
  return choices.map((c) => c.month).filter((m) => m < currentMonth);
}
