// Zip 35 (Nov 2026): TAP_GUARD_FIX ("Tap guard fix"), ships OFF. Both screens (player and organizer), look and feel only: nothing saved,
// priced or sent depends on it.
//
// THE PROBLEM. While "Instant taps" is on, the page stops a click that lands within 400 ms and 24 px of the click before it, on a
// DIFFERENT button (src/InstantTaps.tsx). That protects a double tap whose second half lands on whatever slid under the finger. But it also
// drops a real, fast tap on a neighbouring button: "Hide from list" opens a sheet whose "Hide it" is 23 px away.
//
// THE FIX (switch ON). The guard drops a repeat tap on the SAME button (same element), and a tap on ANOTHER button only when the button
// tapped just before is gone or has moved (the screen changed under the finger: the card was replaced, the row slid, the page scrolled).
// A neighbour that is still where it was is a deliberate tap and goes through. Switch OFF: exactly today's rule, word for word.
//
// A wrangler.toml kill switch (allowed unless "off"), a Settings > Feature switches row (one task_log row, no schema change) and a
// private per-phone link (/admin?tapguard=on, or ?tapguard=on on a player page) that sends the header below.

export const TAP_GUARD_FIX = { task: 'tap_guard_fix_on', header: 'X-Tap-Guard-Fix', link: 'tapguard', env: 'TAP_GUARD_FIX', name: 'Tap guard fix' } as const;

/** A wrangler.toml kill switch: allowed unless it says "off". Who gets it is Settings' call. */
export function tapGuardFixAllowed(flag: string | undefined | null): boolean {
  return (flag ?? 'on').trim().toLowerCase() !== 'off';
}

/** Two clicks are "a double tap" when the second comes within this many milliseconds and pixels of the first. */
export const DOUBLE_TAP_MS = 400;
export const DOUBLE_TAP_PX = 24;
/** The button tapped before has "moved" when it sits this many pixels (or more) away from where it was at that tap. */
export const MOVED_PX = 6;

/** What the guard knows about the click it is looking at and the click before it. */
export interface TapFacts {
  /** The switch: false = today's rule, exactly. */
  fix: boolean;
  /** There was a click before this one. */
  hasPrev: boolean;
  /** Both clicks are on the same control. Switch OFF: the same element, one inside the other, or a label and its switch (today's meaning). Switch ON: exactly the same element. */
  same: boolean;
  /** One click is on a label and the other on the switch inside it: the browser sends the second one itself for the first, so it is ONE tap, never a repeat. */
  pair?: boolean;
  /** The second click came within DOUBLE_TAP_MS and DOUBLE_TAP_PX of the first. */
  close: boolean;
  /** The button tapped before is no longer on the page, or sits MOVED_PX or more from where it was. */
  prevGoneOrMoved: boolean;
  /** This click is on a text box or a menu (typing and selecting: never a "tap" to drop). */
  textField: boolean;
}

/** Should this click be stopped before the page sees it? */
export function dropThisTap(f: TapFacts): boolean {
  if (!f.hasPrev || !f.close) return false;
  if (!f.fix) return !f.same; // today's rule: only a tap on another button
  if (f.textField || f.pair) return false;
  if (f.same) return true; // the same button again, that fast
  return f.prevGoneOrMoved; // another button: only when the screen changed under the finger
}
