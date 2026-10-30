// One court, any number from 4 up to the organizer's "Max players per game"
// (default 10). Fewer than 4 means the game does not happen. Everyone who
// taps I'm in while fewer than the max are in is simply in; beyond the max
// they wait, and the first waiting player moves in when someone drops.

export const MIN_PLAYERS = 4;
export const DEFAULT_MAX_PLAYERS = 10;
/** The widest max the organizer can pick (the database cap matches). */
export const MAX_PLAYERS_LIMIT = 12;

/** What tapping "I'm in" does for someone who isn't in the session yet. */
export function joinOutcome(confirmed: number, maxPlayers: number): 'in' | 'waitlist' {
  return confirmed < maxPlayers ? 'in' : 'waitlist';
}

/** Spots someone could still take before the game is full. */
export function openSpots(confirmed: number, maxPlayers: number): number {
  return Math.max(0, maxPlayers - confirmed);
}

/** How many more are needed to reach 4. */
export function playersNeeded(confirmed: number): number {
  return Math.max(0, MIN_PLAYERS - confirmed);
}

/** "3 going · 1 more needed", "5 going", "10 going · full" */
export function goingText(confirmed: number, maxPlayers: number): string {
  if (confirmed < MIN_PLAYERS) return `${confirmed} going · ${MIN_PLAYERS - confirmed} more needed`;
  if (confirmed >= maxPlayers) return `${confirmed} going · full`;
  return `${confirmed} going`;
}

/** The count on a session card: "3 of 4 in", "5 in", "10 in, full". */
export function countText(confirmed: number, maxPlayers: number): string {
  if (confirmed < MIN_PLAYERS) return `${confirmed} of ${MIN_PLAYERS} in`;
  if (confirmed >= maxPlayers) return `${confirmed} in, full`;
  return `${confirmed} in`;
}
