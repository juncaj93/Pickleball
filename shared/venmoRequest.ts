// "Venmo request" (VENMO_REQUEST, Nov 2026): a blue "Venmo request ↗" link per person who still owes, shown only when that player has a
// Venmo username saved. It opens Venmo with that person, the amount THAT person owes and the note "Pickleball Tue Nov 3".
// One request per person, never a group request (Venmo turns several people into a split and does not find the accounts).
// Link format, tested by Alex on his phone: https://venmo.com/USER?txn=charge&amount=14&note=Pickleball%20Tue%20Nov%203
// The site only opens the link; the organizer still taps Mark paid himself. No API, no cost.

import { venmoAmount, venmoEncode, venmoNote } from './money';

/** The phone-only test switch: the page sends this header when the phone opened /admin with ?venmorequest=on. */
export const VENMO_REQUEST_HEADER = 'X-Venmo-Request';

/** The VENMO_REQUEST kill switch (a wrangler.toml var): allowed unless it says "off". Who gets it is Settings' call. */
export function venmoRequestAllowed(flag: string | undefined | null): boolean {
  return (flag ?? 'on').trim().toLowerCase() !== 'off';
}

const USERNAME = /^[A-Za-z0-9_-]{2,40}$/;

/** The saved Venmo handle as a plain username, or null (nothing saved, or only an id link, which this link format cannot use). */
export function venmoUsername(handle: string | null | undefined): string | null {
  if (!handle || handle.startsWith('id:')) return null;
  return USERNAME.test(handle) ? handle : null;
}

/**
 * The request link for one person: `https://venmo.com/USER?txn=charge&amount=14&note=Pickleball%20Tue%20Nov%203`.
 * Spaces are %20 (never "+"). Null when there is no username or nothing is owed.
 */
export function venmoRequestUrl(handle: string | null | undefined, owesCents: number, startsAt: string, tz: string): string | null {
  const user = venmoUsername(handle);
  if (!user || !Number.isInteger(owesCents) || owesCents <= 0) return null;
  return `https://venmo.com/${user}?txn=charge&amount=${venmoAmount(owesCents)}&note=${venmoEncode(venmoNote(startsAt, tz))}`;
}
