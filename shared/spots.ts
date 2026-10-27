// One court, exactly 4 or exactly 6 players, never 5.
//
// The first 4 to sign up are in. The 5th waits as #1 on the waitlist. When a
// 6th joins, both waiting players are confirmed at once. If a confirmed
// player leaves a group of 4, the first waiting player moves in. If someone
// leaves a group of 6, nothing moves automatically: the organizer sees a
// "5 going" warning and decides.

export const MIN_PLAYERS = 4;
export const MAX_PLAYERS = 6;

/** What tapping "I'm in" does for someone who isn't in the session yet. */
export function joinOutcome(confirmed: number, waitlisted: number): 'in' | 'waitlist' {
  if (confirmed < MIN_PLAYERS) return 'in';
  if (confirmed === MIN_PLAYERS && waitlisted === 1) return 'in'; // they make 6
  if (confirmed === 5 && waitlisted === 0) return 'in'; // they make 6
  return 'waitlist';
}

/** Spots someone could still take: up to 4, or the one that turns 5 into 6. */
export function openSpots(confirmed: number, waitlisted: number): number {
  if (confirmed < MIN_PLAYERS) return MIN_PLAYERS - confirmed;
  if (confirmed === 5 && waitlisted === 0) return 1;
  return 0;
}

/** "3 going · 1 more needed", "5 going · need 4 or 6", "6 going" */
export function goingText(confirmed: number, waitlisted: number): string {
  if (confirmed < MIN_PLAYERS) return `${confirmed} going · ${MIN_PLAYERS - confirmed} more needed`;
  if (confirmed === MIN_PLAYERS) return waitlisted === 1 ? '4 going · 1 more makes 6' : '4 going';
  if (confirmed === 5) return '5 going · need 4 or 6';
  return `${confirmed} going`;
}
