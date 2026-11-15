// Zip 48 (speed split): the organizer screens live in their own file (the "admin chunk"), so a player's first visit downloads only the
// player code. This module (in the player download) fetches the organizer file when /admin opens, or quietly in the background on the
// organizer's own phone, and recovers when the fetch fails.
//
// Why it can fail, and what happens:
// - A phone kept an old page open across a deploy: the old page asks for an organizer file name that no longer exists (the new deploy has
//   new names; a missing built file is a real 404, see public/assets/404.html). The network works, so the page reloads ONCE and gets the
//   new page and its new file names.
// - No signal: the reload would show the phone's own "cannot open the page" screen, so instead a friendly "Try again" screen shows, and it
//   tries again by itself when the phone says it is back online.

import { afterLoadFailed, refetchFailedStyles, RELOAD_KEY, siteAnswers } from './adminRecover';

export { isAdminPath } from './adminRecover';
export { isOrganizerPhone, markOrganizerPhone } from './organizerPhone';

type AdminModule = typeof import('./pages/AdminEntry');

let loaded: AdminModule | null = null;
let pending: Promise<AdminModule> | null = null;

/** The organizer module if it is already here (drawn at once, no loading step), else null. */
export const loadedAdmin = (): AdminModule | null => loaded;

/**
 * Brings in the organizer module (and its style file). Calls share one fetch; a failed fetch is forgotten so the next call tries again.
 * A style file that failed earlier is fetched again before this answers (Vite's own loader never retries a style file it saw fail).
 */
export function loadAdmin(): Promise<AdminModule> {
  if (loaded) return Promise.resolve(loaded);
  if (!pending) {
    pending = import('./pages/AdminEntry')
      .then(async (m) => {
        await refetchFailedStyles();
        loaded = m;
        return m;
      })
      .catch((err: unknown) => {
        pending = null;
        throw err;
      });
  }
  return pending;
}

function readReloadAt(): number | null {
  try {
    const v = Number(sessionStorage.getItem(RELOAD_KEY));
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}

/** Tries once more. Answers 'loaded', or 'reloading' (the page is being reloaded), or 'offline' / 'failed' for the Try again screen. */
export async function loadOrRecover(userAsked: boolean): Promise<'loaded' | 'reloading' | 'offline' | 'failed'> {
  try {
    await loadAdmin();
    return 'loaded';
  } catch {
    const online = await siteAnswers();
    const next = afterLoadFailed({ online, userAsked, lastReloadAt: readReloadAt(), nowMs: Date.now() });
    if (next === 'reload') {
      try {
        sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
      } catch {
        /* storage off: the reload still happens (a tap is needed for any further one only if storage works) */
      }
      window.location.reload();
      return 'reloading';
    }
    return online ? 'failed' : 'offline';
  }
}

let preloadAsked = false;
/**
 * The organizer's own phone, on a player screen: fetch the organizer file quietly a few seconds after the screen is drawn, so a tap on
 * "Go to Admin" (or the next open of /admin) draws at once. Never on a player's phone, never on Data Saver, never twice, never a reload.
 */
export function preloadAdminSoon(delayMs = 3000): void {
  if (preloadAsked || loaded) return;
  preloadAsked = true;
  const conn = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  if (conn?.saveData) return;
  setTimeout(() => {
    loadAdmin().catch(() => {
      preloadAsked = false; // a later screen may try again; nothing shows
    });
  }, delayMs);
}
