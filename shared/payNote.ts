// "No Venmo? Pay Alex directly" (PAY_NOTE). A small note on the player screen, shown a couple of seconds after Pay is
// tapped when the Venmo app did not open (src/venmoFallback.ts). Display only: the Pay button, its link, the amount and
// every money rule are untouched. Off: the Pay button behaves exactly as before.

/** The phone-only test switch: the page sends this header when the phone opened the site with ?paynote=on. */
export const PAY_NOTE_HEADER = 'X-Pay-Note';

/** The PAY_NOTE kill switch (a wrangler.toml var): allowed unless it says "off". Who sees it is Settings' call. */
export function payNoteAllowed(flag: string | undefined | null): boolean {
  return (flag ?? 'on').trim().toLowerCase() !== 'off';
}
