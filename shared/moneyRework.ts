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

// ---------- Money is never hidden ----------
// "Hide from list" is only for a game with no money in it: a test game, or a canceled game nobody paid for. Any game with money in it
// (a court to pay for, a payment, credit from it, somebody owing, a venue charge, a finalize) stays in Money and Totals no matter what.

export const HAS_MONEY_MESSAGE = 'This game has money in it, so it stays in Money.';

export interface MoneyFacts {
  canceled: boolean;
  /** The court is booked. */
  booked: boolean;
  /** People confirmed in (anyone in owes, and the court is the organizer's to pay). */
  confirmed: number;
  finalized: boolean;
  /** What the venue charged for a canceled game (after any Edit charge), in cents. */
  chargedCents: number;
  /** Credit entries that came from this game (credit used on it, or given back from it), including ones since spent. */
  creditEntries: number;
  /** One per seat: anything paid (even if it came back as credit), or an open late fee. */
  seats: { paid: boolean; paidCents: number; lateFee: boolean }[];
}

/** Does this game have any money in it? If so it cannot be hidden, and a hidden mark on it is ignored. */
export function gameHasMoney(f: MoneyFacts): boolean {
  if (f.finalized || f.chargedCents > 0 || f.creditEntries > 0) return true;
  // A game that is on, with a court booked or anyone in, has a court to pay for and people who owe.
  if (!f.canceled && (f.booked || f.confirmed > 0)) return true;
  return f.seats.some((s) => s.paid || s.paidCents > 0 || s.lateFee);
}

/** The projected Totals card assumes this many players pay the usual price (3 x $14) for EVERY court in the month, finalized or not. */
export const PROJECTED_PLAYERS_PER_COURT = 3;

/**
 * Zip 13 (Alex, Nov 7): the venue membership is paid every month from October 2026 on, games or not. From this month on, Money > Totals counts
 * the $30 in "so far" for every month up to this one and in Projected for every month, even one with no game. Earlier months: as before (only
 * a month with a game the venue is owed for, or this month).
 */
export const MEMBERSHIP_FROM = { year: 2026, month: 10 };
export const membershipMonth = (year: number, month: number) => year > MEMBERSHIP_FROM.year || (year === MEMBERSHIP_FROM.year && month >= MEMBERSHIP_FROM.month);
