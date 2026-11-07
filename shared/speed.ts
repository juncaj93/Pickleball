// Zip 12 (Nov 2026): speed fixes from the Zip 9c speed check. Three switches, each shipping OFF:
//  - SPEED_FEWER_QUERIES: the server asks the database fewer times per screen (every feature switch in one read, the same read never
//    twice in one request). Nothing anyone sees changes: the answers are byte for byte the same (tests/speed-queries.test.ts).
//  - SPEED_DIRECT_LOAD: the plain site address asks for the group's games at the same time as the "is this site set up?" check,
//    instead of one after the other. The checks and what they decide are unchanged.
//  - SPEED_LAST_SCREEN: a returning player sees the last screen this phone saw at once (games, court, balls, names, tagged
//    "as of 2:14 PM"), with every button held until the fresh answer lands. Never money, phone numbers or anything organizer-only.
// Not switched (they cannot be): built files keep for a year (public/_headers), and a smaller logo.png.

/** The phone-only test switches: the page sends these headers when the phone opened the site with ?fewerqueries=on, ?directload=on, ?lastscreen=on. */
export const SPEED_QUERIES_HEADER = 'X-Speed-Queries';
export const DIRECT_LOAD_HEADER = 'X-Direct-Load';
export const LAST_SCREEN_HEADER = 'X-Last-Screen';
/** Zip 12 step C, "Instant admin" (SPEED_LAST_SCREEN_ADMIN): the organizer phone's private test link /admin?lastscreenadmin=on sends this. */
export const LAST_SCREEN_ADMIN_HEADER = 'X-Last-Screen-Admin';

/** A wrangler.toml kill switch: allowed unless it says "off". Who gets it is Settings' call. */
export function speedAllowed(flag: string | undefined | null): boolean {
  return (flag ?? 'on').trim().toLowerCase() !== 'off';
}

/**
 * The saved copy of the last screen is shown only while it is younger than this (Alex, Sat Nov 7: older than a few hours, show the normal
 * loading shimmer instead). Older copies are thrown away.
 */
export const LAST_SCREEN_MAX_AGE_MS = 3 * 3_600_000;
