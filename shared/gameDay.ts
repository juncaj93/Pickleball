// Zip 14 (Nov 2026): GAME_DAY_CARD, ships OFF.
//  - Court number per game (migration 0017, sessions.court, 1 to 16 or empty). The organizer sets it on the court map in Add game and
//    Edit game ("Court" row, "Not set" until picked). Only the organizer can set it; the server refuses everyone else.
//  - The player's game day card (the day of the game, the Tonight state): a 66 px TONIGHT tile, "You're in", two equal buttons "Court 3"
//    (opens the court map with that court lit) and "Directions" (Apple Maps on an iPhone, Google Maps elsewhere, the one address in
//    shared/zip9.ts), the balls, the names, then the money row exactly as before. No court yet: "Court TBD" and a short pop-up.
// Display only: no price, seat, credit or text reads it. The Court row and the map on the organizer screens follow the same switch, so with
// it off every screen (players' and the organizer's) is exactly what it was.
// A wrangler.toml kill switch (allowed unless "off"), a Settings > Feature switches row (one task_log row, no schema change), and a
// private per-phone link (?gameday=on, works on /admin too) that sends the header below.

export const GAME_DAY_CARD = { task: 'game_day_card_on', header: 'X-Game-Day-Card', link: 'gameday', env: 'GAME_DAY_CARD', name: 'Game day card' } as const;

/**
 * Preview only: "show me the game day card today" for a phone, so it can be tried on a day with no game. Needs the wrangler.toml var
 * GAME_DAY_TEST = "on", which exists ONLY in [env.preview.vars] (production never has it, so on live this does nothing at all), plus
 * the phone opened the site once with ?gamedaytest=on (it then sends the header below). The phone then draws the NEXT game's date as
 * if it were today: the TONIGHT tile and the game day card. Nothing is saved; the server's own clock is untouched.
 */
export const GAME_DAY_TEST = { header: 'X-Game-Day-Test', link: 'gamedaytest', env: 'GAME_DAY_TEST' } as const;

/** A wrangler.toml kill switch: allowed unless it says "off". Who gets it is Settings' call. */
export function gameDayAllowed(flag: string | undefined | null): boolean {
  return (flag ?? 'on').trim().toLowerCase() !== 'off';
}

/** The venue's courts, numbered 1 to 16. */
export const COURT_MIN = 1;
export const COURT_MAX = 16;

/** A court number the database takes (1 to 16, whole), else null. */
export function courtOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= COURT_MIN && value <= COURT_MAX ? value : null;
}

/**
 * The court map as the venue lays it out, back row first (the entrance is under the front row): two courts, a walkway, two courts.
 * The same picture for the player's map and the organizer's picker.
 */
export const COURT_ROWS: readonly (readonly [number, number, number, number])[] = [
  [13, 14, 15, 16],
  [9, 10, 11, 12],
  [5, 6, 7, 8],
  [1, 2, 3, 4],
];

/** How long the "Alex will add it soon." pop-up stays under Court TBD before it fades by itself. */
export const TBD_POP_MS = 3000;

/** The pop-up's words, with the organizer's first name ("Alex will add it soon."). */
export function tbdText(organizerName: string | null | undefined): string {
  const first = (organizerName ?? '').trim().split(/\s+/)[0];
  return `${first || 'The organizer'} will add it soon.`;
}
