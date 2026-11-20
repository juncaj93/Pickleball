// Zip 72 (🎾72.scores): the small words of a game's score, shared by the players' tournament card (Locked doubles and Americano) and the
// organizer's night screen. Kept tiny and on its own so neither download pulls in the schedule file for it.

/** Highest score a side can enter (a game that runs on past 11, win by 2). The server refuses more (server/americanoDay.ts readPair). */
export const MAX_SCORE = 30;

/** "11–7" (en dash, the pictures' look): mine first. */
export const scorePair = (mine: number, theirs: number): string => `${mine}–${theirs}`;

/** A done game's tag in Your games / Your rounds: "Won 11–7", "Lost 7–11", or just "Won" / "Lost" for a result with no score. */
export const resultTag = (won: boolean, score?: { mine: number; theirs: number } | null): string =>
  `${won ? 'Won' : 'Lost'}${score ? ` ${scorePair(score.mine, score.theirs)}` : ''}`;

/** The point difference chip in Standings: "+4 pts", "0 pts", "−4 pts" (a real minus sign). */
export const diffLabel = (diff: number): string => (diff > 0 ? `+${diff} pts` : diff < 0 ? `−${-diff} pts` : '0 pts');

/**
 * A gentle check under the score sheet (Alex: validate a sensible winning score but never block an odd one; he can fix it). Null when the
 * score looks like a normal finish: the winner reached the game's length, won by 2, and only went past it by winning by exactly 2.
 * Equal scores are the one thing the sheet blocks (a game has a winner).
 */
export function scoreHint(a: number, b: number, playTo: number): string | null {
  const hi = Math.max(a, b);
  const lo = Math.min(a, b);
  if (hi === lo) return 'A game has a winner. Fix the score.';
  if (hi < playTo) return `Games are to ${playTo}. Fine if it ended early.`;
  if (hi - lo < 2) return 'A game is won by 2. Check the score.';
  if (hi > playTo && hi - lo !== 2) return `Past ${playTo}, a game ends 2 ahead. Check the score.`;
  return null;
}
