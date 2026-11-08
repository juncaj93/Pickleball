// Zip 16 (Nov 2026): AFTER_GAME_CARD, ships OFF.
//  - When the organizer finalizes a game and a player's final price is below what they paid, that player sees ONE blue card the next
//    time they open the site: "$5 back to your credit" / "Tue, Nov 3: final price $9 (6 played)". Two or more games at once: one card,
//    "$8 back to your credit" / "2 games: Tue, Nov 3 and Thu, Nov 5". An X closes it (remembered on that phone). It goes by itself
//    7 days after the credit was given. Closing it never changes any money.
//  - The amount is the real credit record Finalize wrote (credit_ledger, kind 'kept', reason 'finalized'), to the cent, never a second
//    sum: the server hands the rows over as they are (server/afterGame.ts) and the card adds them up. A Reopen ends those rows, so the card
//    goes away with them; a redo writes new rows, so the new amount shows.
//  - No card when the final price equals what they paid (Finalize writes no row then), and no "Thanks for playing" card.
//  - A paid player who now owes more (they paid a lower price earlier: a Reopen and a redo with fewer players, a flat price that went up,
//    or a game made longer with Short games on; server/finalize.ts holds their cash and the rest is owed): the amber owe card that is
//    already there reads "You owe $2 more" / "Tue, Nov 3: final price $11 (5 played)", with the same Pay, I paid and Use credit.
// Display only: no price, seat, credit or text reads it. A wrangler.toml kill switch (allowed unless "off"), a Settings > Feature switches
// row (one task_log row, no schema change), and a private per-phone link (?aftergame=on) that sends the header below.

import type { AfterGameCredit } from './api';

export const AFTER_GAME_CARD = { task: 'after_game_card_on', header: 'X-After-Game-Card', link: 'aftergame', env: 'AFTER_GAME_CARD', name: 'After-game cards' } as const;

/** The card goes by itself this many days after the credit was given. */
export const AFTER_GAME_DAYS = 7;
const DAY_MS = 86_400_000;

/** A wrangler.toml kill switch: allowed unless it says "off". Who gets it is Settings' call. */
export function afterGameAllowed(flag: string | undefined | null): boolean {
  return (flag ?? 'on').trim().toLowerCase() !== 'off';
}

/** Still young enough to show: given less than 7 days ago. */
export function afterGameFresh(atIso: string, nowMs: number): boolean {
  const at = Date.parse(atIso);
  return Number.isFinite(at) && nowMs - at < AFTER_GAME_DAYS * DAY_MS;
}

/** The phone's memory key for one credit record. */
export const afterGameKey = (c: Pick<AfterGameCredit, 'id'>) => c.id;

/** "Tue, Nov 3", "Tue, Nov 3 and Thu, Nov 5", "Tue, Nov 3, Thu, Nov 5 and Tue, Nov 10". */
export function joinDays(days: string[]): string {
  if (days.length <= 1) return days[0] ?? '';
  return `${days.slice(0, -1).join(', ')} and ${days[days.length - 1]}`;
}

export interface AfterGameCardText {
  /** The credit records this card stands for (the X remembers all of them). */
  ids: string[];
  /** The sum of those records, to the cent. */
  cents: number;
  title: string;
  sub: string;
}

/**
 * The one card for this player, or null: the credit records not closed on this phone and younger than 7 days. One game: its date, final
 * price and how many played. Two or more games: how many and their dates, oldest first. `day` formats a game's date ("Tue, Nov 3"),
 * `price` an amount ("$5").
 */
export function afterGameCard(
  credits: AfterGameCredit[] | undefined,
  closed: readonly string[],
  nowMs: number,
  day: (iso: string) => string,
  price: (cents: number) => string,
): AfterGameCardText | null {
  const open = (credits ?? []).filter((c) => c.cents > 0 && !closed.includes(afterGameKey(c)) && afterGameFresh(c.at, nowMs));
  if (open.length === 0) return null;
  const cents = open.reduce((sum, c) => sum + c.cents, 0);
  const games = [...new Map(open.map((c) => [c.sessionId, c])).values()].sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  const title = `${price(cents)} back to your credit`;
  let sub: string;
  if (games.length === 1) {
    const g = games[0];
    const final = g.finalPriceCents !== null ? `final price ${price(g.finalPriceCents)}` : 'final price';
    sub = `${day(g.startsAt)}: ${final}${g.playedCount ? ` (${g.playedCount} played)` : ''}`;
  } else {
    sub = `${games.length} games: ${joinDays(games.map((g) => day(g.startsAt)))}`;
  }
  return { ids: open.map(afterGameKey), cents, title, sub };
}

/** "You owe $2 more" and "Tue, Nov 3: final price $11 (5 played)" for the owe card, when the one game on it owes more after Finalize. */
export function oweMoreText(
  o: { amountCents: number; startsAt: string; more?: { finalPriceCents: number; playedCount: number | null } },
  day: (iso: string) => string,
  price: (cents: number) => string,
): { title: string; sub: string } | null {
  if (!o.more) return null;
  return {
    title: `You owe ${price(o.amountCents)} more`,
    sub: `${day(o.startsAt)}: final price ${price(o.more.finalPriceCents)}${o.more.playedCount ? ` (${o.more.playedCount} played)` : ''}`,
  };
}
