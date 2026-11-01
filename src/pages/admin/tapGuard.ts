// After "Yes, we played" the cards move: that card goes, the next one slides up, and the game's
// Finalize card scrolls into view. A second tap of the same finger must never land on a button that
// just moved under it (the next game's "Yes", or "Everyone played", which moves money). Those
// buttons ignore taps while the screen settles.

let quietUntil = 0;

/** Ignore taps on guarded buttons for `ms` from now (replaces any earlier hold). */
export function settleTaps(ms: number) {
  quietUntil = Date.now() + ms;
}

/** True while the screen is still settling: a guarded button does nothing. */
export const tapsHeld = () => Date.now() < quietUntil;

/** How long the screen counts as settling after the cards moved. */
export const SETTLE_MS = 1000;
