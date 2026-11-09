// Zip 27 (Nov 2026, Audit A item A-05): SPENT_TOTALS ("Spent matches Totals"), ships OFF. Organizer only, display only.
//  - Players "Spent" (the Players list line and the player sheet's month and All time cards) counts exactly what Money > Totals counts as
//    "Players paid": a late-fee kept (a late drop, a no-show, a game canceled late with the fee kept) and cash held on a seat whose price
//    went up now count, the same per-seat rule as Totals (server/seatMoney.ts). Before, Spent left those out on purpose.
//  - The organizer's own Spent is Totals' "So far" total (owed to the venue minus what the players paid), and a month where the players
//    paid more than the venue was owed shows as a credit ("$8 credit"), the way the Totals refresh card says it. Before, it stopped at $0.
//  - Off: Spent is exactly as before. Moves no money, changes nothing stored.
//  - A wrangler.toml kill switch (allowed unless "off"), a Settings > Feature switches row (one task_log row, no schema change), and a
//    private per-phone link (/admin?spenttotals=on) that sends the header below.

export const SPENT_TOTALS = { task: 'spent_totals_on', header: 'X-Spent-Totals', link: 'spenttotals', env: 'SPENT_TOTALS', name: 'Spent matches Totals' } as const;

/** A wrangler.toml kill switch: allowed unless it says "off". Who gets it is Settings' call. */
export function spentTotalsAllowed(flag: string | undefined | null): boolean {
  return (flag ?? 'on').trim().toLowerCase() !== 'off';
}

/** "$108", or for the organizer's credit month with the switch on (a negative number) "$8 credit". Whole dollars, like the site's formatPrice. */
export function spentText(cents: number, format: (cents: number) => string): string {
  return cents < 0 ? `${format(-cents)} credit` : format(cents);
}
