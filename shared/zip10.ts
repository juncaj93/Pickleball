// Zip 10 (Nov 2026): one switch, CARD_CLEANUP, shipping OFF.
//  - Cards (player and organizer): no "3 of 4 in" / "5 in" count text, only the pickleball circles on one row, then a small people
//    icon and the names. Later games (beyond next week) are a smaller tinted card with the same slots. Card content is vertically
//    centered to the date tile.
//  - No waitlist and no Max players cap (Alex, Fri Nov 6): anyone can join and any number can play. Every player-facing waitlist word
//    is gone, the "Spot opened" text card and the Telegram "moved up from the waitlist" line too. The organizer's court switch
//    "Not booked | Waitlist | Booked" stays (that is the venue's court waitlist, unrelated).
//    The one limit left is the database's own: 12 in one game (a trigger from migration 0013; lifting it is a schema change, which
//    this zip does not make). A 13th tap gets a plain refusal, never a waitlist.

import { MAX_PLAYERS_LIMIT } from './spots';

/** The phone-only test switch: the page sends this header when the phone opened the site with ?cardcleanup=on. */
export const CARD_CLEANUP_HEADER = 'X-Card-Cleanup';

/** A wrangler.toml kill switch: allowed unless it says "off". Who gets it is Settings' call. */
export function zip10Allowed(flag: string | undefined | null): boolean {
  return (flag ?? 'on').trim().toLowerCase() !== 'off';
}

/** With the switch on, the most one game can hold: the database's hard limit (migration 0013's trigger), not a setting. */
export const NO_CAP_MAX = MAX_PLAYERS_LIMIT;

/** The refusal a 13th tap gets with the switch on (the database holds 12). Never the word "full" or "waitlist". */
export const DB_LIMIT_MESSAGE = `${NO_CAP_MAX} is the most one game can hold right now. Ask Alex.`;
