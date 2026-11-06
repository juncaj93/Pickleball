// Zip 9 (Nov 2026): two switches, both shipping OFF.
//  - SHORT_GAMES: a game that is exactly 1.5 hours (End minus Start) is a "short game": its own price table (shared/gameLength.ts),
//    a heads-up on Add game and Edit game, a small organizer tag, and the right end time on Add to calendar.
//    THIS ONE CHANGES MONEY for 1.5 hour games (the flat price, the final price, credit back, court cost). Every other game is untouched.
//  - CARD_TIME_BUTTONS: player cards show the start time and the length ("7:30 PM", "2 hours") under the date tile, and a card
//    you are in gets one small joined button (Add to calendar | Directions) at the top right of the "You're in" line.
//    Display only: nothing saved, charged or sent depends on it.

/** The phone-only test switches: the page sends these headers when the phone opened the site with ?shortgames=on or ?cardtime=on. */
export const SHORT_GAMES_HEADER = 'X-Short-Games';
export const CARD_TIME_HEADER = 'X-Card-Time';

/** A wrangler.toml kill switch: allowed unless it says "off". Who gets it is Settings' call. */
export function zip9Allowed(flag: string | undefined | null): boolean {
  return (flag ?? 'on').trim().toLowerCase() !== 'off';
}

/** The court, in ONE place (the Directions half of the joined button). */
export const COURT_ADDRESS = '40100 Six Mile Rd, Northville, MI 48168, United States';

/**
 * A plain https maps link for directions to the court. An iPhone or iPad gets the maps.apple.com link, which iOS opens in Apple
 * Maps (or the maps app set as the default). Everything else (Android, a computer) gets Google's directions link, which Android
 * opens in Google Maps (or asks which maps app) and a computer opens in the browser.
 */
export function directionsUrl(address: string = COURT_ADDRESS, ua = ''): string {
  const q = encodeURIComponent(address);
  if (/iPhone|iPad|iPod/i.test(ua)) return `https://maps.apple.com/?daddr=${q}`;
  return `https://www.google.com/maps/dir/?api=1&destination=${q}`;
}
