// "Instant taps" (INSTANT_TAPS, Nov 2026): when someone taps a button, the screen changes in that same instant and the server saves in
// the background. A small toast says it saved. If the save fails, the screen goes back exactly as it was and a toast says what failed.
// Where the server decides the outcome (a full game, late-drop rules, prices, fees, court booking), the button shows a pressed state and
// a small spinner at once and the outcome appears when the server answers. Tap feedback only: no money rule, amount, seat, credit or
// saved record depends on it. With it off, every screen looks and works exactly as it did before.

/** The phone-only test switch: the page sends this header when the phone opened the site (or /admin) with ?instanttaps=on. */
export const INSTANT_TAPS_HEADER = 'X-Instant-Taps';

/** The INSTANT_TAPS kill switch (a wrangler.toml var): allowed unless it says "off". Who gets it is Settings' call. */
export function instantTapsAllowed(flag: string | undefined | null): boolean {
  return (flag ?? 'on').trim().toLowerCase() !== 'off';
}
