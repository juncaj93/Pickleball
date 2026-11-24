// Zip 77 (🎾77.reveal): the Americano standings reveal. One timeline, worked out from the number of players only, so the server (when the
// ticker, the congratulations card and the medals may show) and every phone (what the board shows at each moment) agree to the frame.
//
// The clock: T is seconds after T0, and T0 is the organizer's tap (tournaments.ended_at, written by Reveal standings) plus REVEAL_LEAD_MS, so
// phones on the 2 second check all start together. Every phone draws the board from T alone (a pure function), on the SERVER's clock (each phone
// corrects for its own clock's offset), so a phone that opens mid-reveal lands on the same frame.
//
//   0 to 5 s      the 5, 4, 3, 2, 1 countdown (a lime ring drains each second)
//   5 s           the empty slots fade in (one per player, numbered)
//   6 s           last place slides in; then up the table: the last 3 places 1.5 s apart, then 1.6 s apart up to 5th, 4th 1.8 s after 5th,
//                 3rd 2.2 s after 4th, 2nd 2.6 s after 3rd (a 0.7 s drumroll first), 1st 4.2 s after 2nd (a 2 s drumroll first).
//                 Places below 7th go 1.5 s apart (1.0 s apart with more than 10 players).
//   1st + 2.8 s   the small round X fades in. For 9 players the whole thing runs about 28 s from the tap.

/** T0 is the tap plus this. */
export const REVEAL_LEAD_MS = 3000;
/** The countdown runs 5, 4, 3, 2, 1 from T0. */
export const REVEAL_COUNT_S = 5;
/** The empty slots fade in. */
export const REVEAL_SLOTS_S = 5;
/** Last place lands. */
export const REVEAL_FIRST_S = 6;
/** How long the top two fly before they land (1st from well above, 2nd from a little above). */
export const REVEAL_FLY_S: Readonly<Record<1 | 2, number>> = { 1: 0.34, 2: 0.22 };
/** The drumroll before 2nd and 1st (the empty slot pulses). */
export const REVEAL_DRUM_S: Readonly<Record<1 | 2, number>> = { 1: 2, 2: 0.7 };
/** The X fades in this long after 1st starts its flight. */
export const REVEAL_X_AFTER_S = 2.8;
/** The X's fade; the board is done once it is in. */
export const REVEAL_X_FADE_S = 0.35;

/** Seconds between the place below `p` and place `p` (n players). */
export function revealGap(p: number, n: number): number {
  if (p === 1) return 4.2;
  if (p === 2) return 2.6;
  if (p === 3) return 2.2;
  if (p === 4) return 1.8;
  if (p >= 8) return n > 10 ? 1 : 1.5;
  // 5th to 7th: 1.6 s, except when they are among the last 3 places of a small night (1.5 s).
  return n <= 10 && p >= n - 2 ? 1.5 : 1.6;
}

export interface RevealPlan {
  players: number;
  /** When each place's row starts to come in (seconds after T0), by place (1 = first). */
  at: number[];
  /** When the drumroll starts for 2nd and 1st (null when that place does not exist). */
  drum: { 1: number | null; 2: number | null };
  /** The X fades in. */
  x: number;
  /** The board is complete (the X is in): from here the board is drawn in its final state. */
  end: number;
}

/** The timeline for `n` players (1 or more). */
export function revealPlan(n: number): RevealPlan {
  const players = Math.max(1, Math.floor(n));
  const at: number[] = new Array(players + 1).fill(0);
  at[players] = REVEAL_FIRST_S;
  for (let p = players - 1; p >= 1; p--) at[p] = at[p + 1] + revealGap(p, players);
  const x = at[1] + REVEAL_X_AFTER_S;
  return {
    players,
    at,
    drum: { 1: players >= 2 ? at[1] - REVEAL_DRUM_S[1] : null, 2: players >= 3 ? at[2] - REVEAL_DRUM_S[2] : null },
    x,
    end: x + REVEAL_X_FADE_S,
  };
}

/** Milliseconds from the tap until the board is complete. */
export const revealDoneMs = (players: number): number => REVEAL_LEAD_MS + Math.ceil(revealPlan(players).end * 1000);

/** The most players a night has (the cap of 16). */
const MOST_PLAYERS = 16;
/**
 * From the tap, how long the server keeps back everything that would tell the winner before the board does: the ticker, the congratulations
 * card, the medals, and the award credit in the player's credit chip and history (about 36 s: the longest board, 16 players, so it is one
 * moment for every screen and every read). The money itself is granted at the tap, as before; only what the screens show waits.
 */
export const REVEAL_HOLD_MS = revealDoneMs(MOST_PLAYERS);
/** A reveal tapped at `tapIso` still keeps the winner back. */
export const revealHolding = (tapIso: string | null | undefined, nowMs: number): boolean => !!tapIso && nowMs < Date.parse(tapIso) + REVEAL_HOLD_MS;

/** Where a reveal is at a given moment (server clock): before T0, playing (T seconds in), or done. */
export function revealPhase(tapMs: number, players: number, nowMs: number): { phase: 'before' | 'playing' | 'done'; t: number } {
  const t = (nowMs - tapMs - REVEAL_LEAD_MS) / 1000;
  if (t < 0) return { phase: 'before', t };
  return { phase: t >= revealPlan(players).end ? 'done' : 'playing', t };
}

/** Zip 88: the players' "Games start soon" countdown starts this long before the start. */
export const COUNTDOWN_MS = 30 * 60_000;

/** Zip 88: "24:10" (minutes and seconds; the countdown starts at 30:00). */
export function countdownText(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
