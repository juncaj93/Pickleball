// "Ask for payment on every game" (PAY_ALWAYS). Display only: no money rule, price, credit math or saved record
// depends on it. The server has always tracked what a player who is in owes on every game, whatever the court
// status; with this off, the player screen hides Pay on a game whose court is not booked (src/courtDisplay.ts).
// With it on, Pay shows on every game the player is in (a real spot), exactly as on a booked game.

/** The phone-only test switch: the page sends this header when the phone opened the site with ?payalways=on. */
export const PAY_ALWAYS_HEADER = 'X-Pay-Always';

/** The PAY_ALWAYS kill switch (a wrangler.toml var): allowed unless it says "off". Who sees it is Settings' call. */
export function payAlwaysAllowed(flag: string | undefined | null): boolean {
  return (flag ?? 'on').trim().toLowerCase() !== 'off';
}
