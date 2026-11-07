// Zip 12 step C, "Instant admin" (SPEED_LAST_SCREEN_ADMIN, server/speed.ts). The organizer's phone keeps a copy of its last dashboard
// answer and draws it the moment /admin opens, with every action held (nothing can be tapped) and money dimmed under a small "as of 2:14 PM",
// until the fresh answer lands; then the same screen simply updates in place.
//
// The copy holds the organizer's own dashboard, money included: it only ever sits on the organizer's own phone (this browser's storage).
// Kept ONLY after a sign-in with the real PIN: never for the read-only PIN, Pretend or the demo.
// Thrown away on: sign out, a PIN change, a "sign in again" answer (401), older than 3 hours (then the usual loading shows), the app
// updated (another build), and the switch off (the next fresh answer no longer says lastScreenAdmin). Storage failing = the site as today.

import type { AdminDashboard } from '../shared/api';
import { LAST_SCREEN_MAX_AGE_MS } from '../shared/speed';

export const LAST_ADMIN_KEY = 'pb_last_admin';

export interface SavedAdmin {
  build: string;
  savedAt: number;
  view: AdminDashboard;
}

interface Store {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}
const browserStore = (): Store | null => {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
};
const build = () => (typeof __APP_BUILD__ === 'string' ? __APP_BUILD__ : 'test');

export function clearLastAdmin(store: Store | null = browserStore()): void {
  try {
    store?.removeItem(LAST_ADMIN_KEY);
  } catch {
    /* nothing to do */
  }
}

/** Keep this dashboard answer for next time if the server said so and this is the real PIN; otherwise throw any old copy away. */
export function saveLastAdmin(d: AdminDashboard, opts: { pretend: boolean; demo: boolean }, nowMs = Date.now(), store: Store | null = browserStore()): void {
  if (!store) return;
  try {
    if (d.lastScreenAdmin !== true || d.viewOnly === true || opts.pretend || opts.demo) {
      store.removeItem(LAST_ADMIN_KEY);
      return;
    }
    const saved: SavedAdmin = { build: build(), savedAt: nowMs, view: d };
    store.setItem(LAST_ADMIN_KEY, JSON.stringify(saved));
  } catch {
    clearLastAdmin(store);
  }
}

/** The saved dashboard, if it is from this build, younger than 3 hours and readable; anything else is thrown away. */
export function readLastAdmin(nowMs = Date.now(), store: Store | null = browserStore()): SavedAdmin | null {
  if (!store) return null;
  try {
    const text = store.getItem(LAST_ADMIN_KEY);
    if (!text) return null;
    const saved = JSON.parse(text) as SavedAdmin;
    const ok =
      saved &&
      saved.build === build() &&
      typeof saved.savedAt === 'number' &&
      nowMs - saved.savedAt < LAST_SCREEN_MAX_AGE_MS &&
      saved.savedAt <= nowMs + 60_000 &&
      !!saved.view &&
      saved.view.lastScreenAdmin === true &&
      saved.view.viewOnly !== true &&
      Array.isArray(saved.view.sessions) &&
      !!saved.view.group;
    if (!ok) {
      store.removeItem(LAST_ADMIN_KEY);
      return null;
    }
    return saved;
  } catch {
    clearLastAdmin(store);
    return null;
  }
}

/** Marks every element on the held copy whose own text shows money ("$14", "-$3"), so the style sheet can dim it. */
export function markMoney(root: HTMLElement): void {
  try {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (/\$\s?\d/.test(n.nodeValue ?? '')) n.parentElement?.setAttribute('data-held-money', '');
    }
  } catch {
    /* nothing dimmed */
  }
}

/**
 * The swap: for a short while after the fresh answer lands, each element whose text changed (or that is new) fades in softly
 * (data-sw-changed, src/admin-held.css). Unchanged parts never move or blink. Returns a function that stops watching.
 */
export function fadeChanges(root: HTMLElement, forMs = 1500): () => void {
  if (typeof MutationObserver === 'undefined') return () => {};
  const mark = (el: Element | null) => {
    if (!el || !(el instanceof HTMLElement)) return;
    el.removeAttribute('data-sw-changed');
    void el.offsetWidth; // start the fade again if it was already running
    el.setAttribute('data-sw-changed', '');
    setTimeout(() => el.removeAttribute('data-sw-changed'), 400);
  };
  const obs = new MutationObserver((list) => {
    for (const m of list) {
      if (m.type === 'characterData') mark(m.target.parentElement);
      else for (const n of Array.from(m.addedNodes)) mark(n instanceof Element ? n : n.parentElement);
    }
  });
  obs.observe(root, { subtree: true, childList: true, characterData: true });
  const t = setTimeout(() => obs.disconnect(), forMs);
  return () => {
    clearTimeout(t);
    obs.disconnect();
  };
}
