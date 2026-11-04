// "Money page rework" (MONEY_REWORK, Nov 2026): the organizer's Money page (Games and Totals), "Hide from list" with Settings >
// Advanced > Hidden games, Edit charge on a canceled game, the cancel sheet's "Were you charged?" default, the tidied Feature
// switches page and the quieter History page. Admin only: no player sees any change, no seat, payment or credit is touched.
// With it off, every one of these screens looks and works exactly as it did before.

/** The phone-only test switch: the page sends this header when the phone opened /admin?moneyrework=on. */
export const MONEY_REWORK_HEADER = 'X-Money-Rework';

/** The MONEY_REWORK kill switch (a wrangler.toml var): allowed unless it says "off". Who sees it is Settings' call. */
export function moneyReworkAllowed(flag: string | undefined | null): boolean {
  return (flag ?? 'on').trim().toLowerCase() !== 'off';
}
