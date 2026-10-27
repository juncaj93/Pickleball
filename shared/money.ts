export function formatCents(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}$${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/** Parse "45", "45.5", "$45.50" into cents. Returns null for anything else. */
export function parseDollars(input: string): number | null {
  const m = /^\s*\$?\s*(\d{1,5})(?:\.(\d{1,2}))?\s*$/.exec(input);
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
}

/** "$14" for whole dollars, "$14.50" otherwise. */
export function formatPrice(cents: number): string {
  return cents % 100 === 0 ? `$${cents / 100}` : formatCents(cents);
}

/**
 * A Venmo link with the amount and a note filled in, built from the
 * organizer's profile link (venmo.com/u/name, venmo.com/name, or
 * account.venmo.com/u/name). If the name can't be read, the profile link is
 * returned unchanged and the page shows the amount next to the button.
 */
export function venmoPayUrl(profileUrl: string | null, cents: number, note: string): { url: string | null; prefilled: boolean } {
  if (!profileUrl) return { url: null, prefilled: false };
  let u: URL;
  try {
    u = new URL(profileUrl);
  } catch {
    return { url: null, prefilled: false };
  }
  if (!/(^|\.)venmo\.com$/i.test(u.hostname)) return { url: profileUrl, prefilled: false };
  const parts = u.pathname.split('/').filter(Boolean);
  const name = parts[0] === 'u' ? parts[1] : parts.length === 1 ? parts[0] : undefined;
  if (!name || !/^[A-Za-z0-9_-]{2,40}$/.test(name)) return { url: profileUrl, prefilled: false };
  const amount = (cents / 100).toFixed(2);
  return {
    url: `https://venmo.com/${name}?txn=pay&amount=${amount}&note=${encodeURIComponent(note)}`,
    prefilled: true,
  };
}

/**
 * The Venmo note: "Pickleball Tue Nov 3 - Ryan", or for several sessions
 * "Pickleball Tue Nov 3, Thu Nov 5 - Ryan". Dates in the group's time zone.
 */
export function venmoNote(startsAt: string | string[], tz: string, name?: string | null): string {
  const dates = (Array.isArray(startsAt) ? startsAt : [startsAt]).map((iso) =>
    new Date(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: tz }).replace(/,/g, ''),
  );
  const text = `Pickleball ${dates.join(', ')}`;
  return name ? `${text} - ${name}` : text;
}

/** Payment is asked for from 8:00 AM on game day, in the group's time zone. */
export const PAY_FROM_HOUR = 8;
