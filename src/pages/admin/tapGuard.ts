// After "Yes, we played" the cards move: that card goes, the next one slides up, and the game's
// Finalize card scrolls into view. A second tap of the same finger must never land on a button that
// just moved under it (the next game's "Yes", or "Everyone played", which moves money). Those
// buttons are disabled (they look dimmed) while the screen settles.
import { useEffect, useState } from 'react';

let quietUntil = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
const subs = new Set<() => void>();
const notify = () => subs.forEach((f) => f());

/** Guarded buttons wait `ms` from now (replaces any earlier hold; 0 ends it). */
export function settleTaps(ms: number) {
  quietUntil = Date.now() + ms;
  clearTimeout(timer);
  notify();
  if (ms > 0) timer = setTimeout(notify, ms + 10);
}

/** True while the screen is still settling: a guarded button does nothing. */
export const tapsHeld = () => Date.now() < quietUntil;

/** The same, as a value that redraws the button when the hold starts and ends. */
export function useTapsHeld(): boolean {
  const [, bump] = useState(0);
  useEffect(() => {
    const f = () => bump((x) => x + 1);
    subs.add(f);
    return () => {
      subs.delete(f);
    };
  }, []);
  return tapsHeld();
}

/** How long the screen counts as settling after the cards moved. */
export const SETTLE_MS = 1000;
