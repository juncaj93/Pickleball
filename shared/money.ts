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

/** The amount as Venmo wants it: "14" for whole dollars, "14.50" otherwise. Nothing else. */
export function venmoAmount(cents: number): string {
  return cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2);
}

/** Spaces as %20 (never "+"), and the few marks encodeURIComponent leaves alone, like the apostrophe. */
export function venmoEncode(text: string): string {
  return encodeURIComponent(text).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/**
 * Venmo links with the amount and a note filled in, built from the
 * organizer's profile link (venmo.com/u/name, venmo.com/name, or
 * account.venmo.com/u/name):
 *   url     https://venmo.com/?txn=pay&recipients=name&amount=14&note=...
 *   appUrl  venmo://paycharge?txn=pay&recipients=name&amount=14&note=...
 * The page opens the app link on a phone and falls back to the web link.
 * If the name can't be read, the profile link is returned unchanged and the
 * page shows the amount next to the button.
 */
export function venmoPayUrl(
  profileUrl: string | null,
  cents: number,
  note: string,
): { url: string | null; appUrl: string | null; prefilled: boolean } {
  if (!profileUrl) return { url: null, appUrl: null, prefilled: false };
  let u: URL;
  try {
    u = new URL(profileUrl);
  } catch {
    return { url: null, appUrl: null, prefilled: false };
  }
  if (!/(^|\.)venmo\.com$/i.test(u.hostname)) return { url: profileUrl, appUrl: null, prefilled: false };
  const parts = u.pathname.split('/').filter(Boolean);
  const name = parts[0] === 'u' ? parts[1] : parts.length === 1 ? parts[0] : undefined;
  if (!name || !/^[A-Za-z0-9_-]{2,40}$/.test(name)) return { url: profileUrl, appUrl: null, prefilled: false };
  const query = `txn=pay&recipients=${name}&amount=${venmoAmount(cents)}&note=${venmoEncode(note)}`;
  return {
    url: `https://venmo.com/?${query}`,
    appUrl: `venmo://paycharge?${query}`,
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

/** What a pasted Venmo link or @name turned into: a handle to store (null = blank), or unreadable. */
export type VenmoHandle = { ok: true; handle: string | null } | { ok: false };

const VENMO_NAME = /^[A-Za-z0-9_-]{2,40}$/;
/** First path words on venmo.com that are pages, not people. */
const VENMO_PAGES = new Set(['u', 'code', 'account', 'pay', 'charge', 'settings', 'about', 'help', 'privacy', 'legal', 'login', 'signup']);

/**
 * Reads what the organizer typed or pasted into "Venmo link or @name":
 * `@Name`, `venmo.com/u/Name`, `https://account.venmo.com/u/Name`,
 * `venmo.com/Name`, or a link carrying `user_id=123456`. Blank means "none".
 * Returns only the username ("Name") or "id:123456", nothing else.
 */
export function parseVenmoHandle(input: unknown): VenmoHandle {
  if (input === null || input === undefined) return { ok: true, handle: null };
  if (typeof input !== 'string') return { ok: false };
  const s = input.trim();
  if (s === '') return { ok: true, handle: null };
  if (s.startsWith('@')) return VENMO_NAME.test(s.slice(1)) ? { ok: true, handle: s.slice(1) } : { ok: false };
  let u: URL;
  try {
    u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `https://${s}`);
  } catch {
    return { ok: false };
  }
  if (!/^(www\.|account\.)?venmo\.com$/i.test(u.hostname)) return { ok: false };
  const parts = u.pathname.split('/').filter(Boolean);
  let name: string | undefined;
  if (parts[0]?.toLowerCase() === 'u') name = parts[1];
  else if (parts.length === 1 && !VENMO_PAGES.has(parts[0].toLowerCase())) name = parts[0];
  if (name !== undefined) return VENMO_NAME.test(name) ? { ok: true, handle: name } : { ok: false };
  const id = u.searchParams.get('user_id');
  if (id && /^\d{3,20}$/.test(id)) return { ok: true, handle: `id:${id}` };
  return { ok: false };
}

/** A saved handle as the organizer reads it back: "@Name", or the id link. */
export function venmoHandleText(handle: string | null): string {
  if (!handle) return '';
  return handle.startsWith('id:') ? `venmo.com/code?user_id=${handle.slice(3)}` : `@${handle}`;
}

/**
 * Venmo links to pay a player back: the exact amount and a note, addressed to
 * that person when their handle is saved, otherwise left for the organizer to
 * pick the person. `appUrl` opens the Venmo app first, like the Pay button.
 */
export function venmoRefundUrl(handle: string | null, cents: number, note: string): { url: string; appUrl: string; addressed: boolean } {
  const to = handle ? `recipients=${handle.startsWith('id:') ? handle.slice(3) : handle}&` : '';
  const query = `txn=pay&${to}amount=${venmoAmount(cents)}&note=${venmoEncode(note)}`;
  return { url: `https://venmo.com/?${query}`, appUrl: `venmo://paycharge?${query}`, addressed: !!handle };
}

/** "Pickleball Thu Oct 29 refund". */
export function refundNote(startsAt: string, tz: string): string {
  return `${venmoNote(startsAt, tz)} refund`;
}
