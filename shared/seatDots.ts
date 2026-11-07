// Seat dots (SEAT_DOTS, Nov 2026, ships OFF): every EMPTY seat circle on the site (game cards, organizer cards, the Want in alert, anywhere
// SpotDots draws seats) becomes a slightly grayed dashed ring. Filled balls stay exactly as they are. Look only.
// It works with ALERT_CARDS on or off: every empty seat is the one `.dot` that SpotDots (src/ui.tsx) draws, and src/seat-dots.css restyles it
// under <html data-seat-dots>, so the alerts and the game cards can never drift apart.

/** The phone-only test switch: the page sends this header when the phone opened the site with ?seatdots=on. */
export const SEAT_DOTS_HEADER = 'X-Seat-Dots';

/** A wrangler.toml kill switch: allowed unless it says "off". Who gets it is Settings' call. */
export function seatDotsAllowed(flag: string | undefined | null): boolean {
  return (flag ?? 'on').trim().toLowerCase() !== 'off';
}
