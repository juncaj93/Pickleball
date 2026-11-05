// Zip 7 (Nov 2026): three display-only switches, each shipping OFF.
//  - TONIGHT_GLOW: the date tile on player cards and admin Home says TONIGHT (solid green band, the date badge glows) or TOMORROW (soft green band).
//  - COLOR_CLEANUP: one color system (green in/paid, amber owes, blue links and credit, purple texting only, gray neutral, red cancel/errors).
//  - PLAYER_CARDS_SIMPLE: player cards drop the court status words and dot; the calendar icon sits only next to "You're in".
// Nothing saved, charged or sent depends on any of them.

import { playerDay } from './time';

/** The phone-only test switches: the page sends these headers when the phone opened the site with ?tonightglow=on, ?colorcleanup=on or ?playercards=on. */
export const TONIGHT_GLOW_HEADER = 'X-Tonight-Glow';
export const COLOR_CLEANUP_HEADER = 'X-Color-Cleanup';
export const PLAYER_CARDS_HEADER = 'X-Player-Cards';

/** A wrangler.toml kill switch: allowed unless it says "off". Who gets it is Settings' call. */
export function zip7Allowed(flag: string | undefined | null): boolean {
  return (flag ?? 'on').trim().toLowerCase() !== 'off';
}

export type TileDay = 'tonight' | 'tomorrow' | null;

/**
 * Which tag a date tile wears: "tonight" when the game is on today's calendar date, "tomorrow" on the next date, else none.
 * Dates are read in the group's time zone (Eastern), so 11:59 PM and 12:01 AM land on the right side and the daylight saving
 * change days do not skew it. A canceled or already started game wears none (the caller passes `open`).
 */
export function tileDay(startsAtIso: string, tz: string, nowMs: number, open: boolean): TileDay {
  if (!open) return null;
  const word = playerDay(startsAtIso, tz, nowMs).word;
  return word === 'tonight' ? 'tonight' : word === 'tomorrow' ? 'tomorrow' : null;
}
