// Zip 30, "Acting for others" (shared/actingForOthers.ts): this phone's random code.
// Made once on the phone from the browser's random numbers (not a fingerprint: nothing about the phone goes into it), kept in the
// browser's storage with a cookie as a backup (each one puts the other back if only one was cleared). Sent with player requests so a
// player's own tap can write it into its History line. Clearing both, a private window or another browser makes a new code: the site
// then sees "a new phone".
import { PHONE_TAG_COOKIE, validPhoneTag } from '../shared/actingForOthers';

const STORAGE_KEY = 'pb_phone_tag';
/** About 400 days, the longest a browser keeps a cookie. */
const COOKIE_SECONDS = 400 * 86_400;

let cached: string | null = null;

function storageGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function storageSet(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode: the cookie copy still works */
  }
}

function readCookie(): string | null {
  try {
    const m = document.cookie.match(new RegExp(`(?:^|;\\s*)${PHONE_TAG_COOKIE}=([^;]*)`));
    return m ? decodeURIComponent(m[1]) : null;
  } catch {
    return null;
  }
}

function writeCookie(tag: string) {
  try {
    const secure = window.location.protocol === 'https:' ? '; Secure' : '';
    document.cookie = `${PHONE_TAG_COOKIE}=${tag}; Path=/; Max-Age=${COOKIE_SECONDS}; SameSite=Lax${secure}`;
  } catch {
    /* cookies off: the stored copy still works */
  }
}

/** 22 random characters (16 random bytes, URL-safe base64). */
function newTag(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** This phone's code: the stored one, else the cookie's, else a new one; both copies are kept in step. null if the browser cannot make one. */
export function phoneTag(): string | null {
  if (cached) return cached;
  try {
    const stored = storageGet(STORAGE_KEY);
    const cookie = readCookie();
    const tag = validPhoneTag(stored) ? stored : validPhoneTag(cookie) ? cookie : newTag();
    if (stored !== tag) storageSet(STORAGE_KEY, tag);
    if (cookie !== tag) writeCookie(tag);
    cached = tag;
    return tag;
  } catch {
    return null;
  }
}
