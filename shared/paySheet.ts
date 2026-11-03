// "Pay sheet" (PAY_SHEET). Tapping a Pay button (the "Tonight: you owe" card at the top, or a game card) opens a small bottom
// sheet instead of jumping straight into the Venmo app: "Pay Alex $14", "Have the Venmo app? Click here" (the same Venmo link),
// "Copy Venmo @handle", a gray line for Apple Pay / Zelle / cash, and "I paid". It replaces the "No Venmo? note" while it is on.
// Display only: the amount, the link, "I paid" and every money rule are untouched. Off: Pay behaves exactly as before.

/** The phone-only test switch: the page sends this header when the phone opened the site with ?paysheet=on. */
export const PAY_SHEET_HEADER = 'X-Pay-Sheet';

/** The PAY_SHEET kill switch (a wrangler.toml var): allowed unless it says "off". Who sees it is Settings' call. */
export function paySheetAllowed(flag: string | undefined | null): boolean {
  return (flag ?? 'on').trim().toLowerCase() !== 'off';
}
