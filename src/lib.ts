import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

let groupKey: string | null = null;
let viewAsId: string | null = null;

/** The private link's key. Sent as a header on player requests. */
export function setGroupKey(key: string | null) {
  groupKey = key;
}

/** "View as...": the signed-in organizer sees (and, in the demo copy, taps) as this player. */
export function setViewAs(playerId: string | null) {
  if (playerId === viewAsId) return;
  const was = demoOn();
  viewAsId = playerId;
  demoChanged(was);
}

/** What a tap says when the live site refuses a View-as change. */
export const DEMO_MESSAGE = 'Demo only. Nothing was saved.';

/** True for the "Demo only" answer, which is shown as a plain note, not an error. */
export function isDemo(err: unknown): err is ApiError {
  return err instanceof ApiError && err.code === 'demo_only';
}

// ---------- The organizer's demo: "View as..." and "Pretend it's..." ----------
//
// While either is on, every request goes to a throwaway copy of the data in
// this tab (src/demo), run by the same server code as the live site. Taps
// change the copy only. Reset, leaving the demo, signing out, reloading or
// closing the tab throws it away.

/** Pretend time switches itself off after this long. */
export const PRETEND_FOR_MS = 30 * 60_000;
let pretend: { atMs: number; untilMs: number } | null = null;
let pretendTimer: ReturnType<typeof setTimeout> | undefined;
let sandbox: Promise<import('./demo/sandbox').Sandbox> | null = null;
let demoVersion = 0;
const demoListeners = new Set<() => void>();

export function demoOn(): boolean {
  return viewAsId !== null || pretend !== null;
}

/** After any change: a demo that ended (or `fresh`) starts again from the live data next time. */
function demoChanged(wasOn: boolean, fresh = false) {
  const on = demoOn();
  if (!on || fresh) sandbox = null;
  if (wasOn !== on || fresh) demoVersion++;
  // Not during a render: listeners update other components.
  queueMicrotask(() => demoListeners.forEach((l) => l()));
}

/** Reset: throw away every demo change and start again from the live data. */
export function resetDemo() {
  demoChanged(demoOn(), true);
}

/**
 * Pretend it's `atMs` (or stop with null). Kept in this tab's memory only
 * and for 30 minutes at most. Ending it throws the demo changes away.
 */
export function setPretend(atMs: number | null) {
  const was = demoOn();
  const ending = atMs === null && pretend !== null;
  pretend = atMs === null ? null : { atMs, untilMs: Date.now() + PRETEND_FOR_MS };
  clearTimeout(pretendTimer);
  if (pretend) pretendTimer = setTimeout(() => setPretend(null), PRETEND_FOR_MS);
  demoChanged(was, ending);
}

/** The pretend time, or null when it's off. */
export function pretendMs(): number | null {
  if (pretend && Date.now() >= pretend.untilMs) setPretend(null);
  return pretend?.atMs ?? null;
}

function subscribeDemo(cb: () => void) {
  demoListeners.add(cb);
  return () => {
    demoListeners.delete(cb);
  };
}

export function usePretend(): number | null {
  return useSyncExternalStore(subscribeDemo, () => pretend?.atMs ?? null);
}

/** Changes whenever the demo starts, ends or is reset, so screens load again. */
export function useDemoVersion(): number {
  return useSyncExternalStore(subscribeDemo, () => demoVersion);
}

export function useDemoOn(): boolean {
  return useSyncExternalStore(subscribeDemo, demoOn);
}

/** Now, or the pretend time while it's on. */
export function appNow(): number {
  return pretendMs() ?? Date.now();
}

function demoCopy() {
  if (!sandbox) {
    const loading = import('./demo/load').then((m) => m.loadSandbox());
    loading.catch(() => {
      if (sandbox === loading) sandbox = null;
    });
    sandbox = loading;
  }
  return sandbox;
}

async function answer<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error ?? 'error', data.message ?? 'Something went wrong. Try again.');
  return data as T;
}

/** What the banner says when the phone has no signal. */
export const OFFLINE_MESSAGE = 'No signal, try again';

/** `keepalive`: let the request finish even if the page is closing (a held drop being sent on the way out). */
export async function api<T>(method: string, path: string, body?: unknown, opts: { keepalive?: boolean } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (viewAsId && path.startsWith('/api/') && !path.startsWith('/api/admin/')) headers['X-View-As'] = viewAsId;
  else if (groupKey) headers['X-Group-Key'] = groupKey;
  // Demo: the throwaway copy answers. Signing out always goes to the live site.
  if (demoOn() && path.startsWith('/api/') && path !== '/api/admin/logout') {
    let copy;
    try {
      copy = await demoCopy();
    } catch (err) {
      throw new ApiError(0, 'demo_failed', err instanceof Error ? err.message : "Couldn't start the demo.");
    }
    return answer<T>(await copy.request(method, path, body, headers, appNow()));
  }
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin',
      keepalive: opts.keepalive || undefined,
    });
  } catch {
    throw new ApiError(0, 'offline', OFFLINE_MESSAGE);
  }
  return answer<T>(res);
}

/** Load data with loading / error / retry states. */
export function useLoad<T>(loader: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);
  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setData(await loader());
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError(0, 'error', 'Something went wrong.'));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => {
    void reload();
  }, [reload]);
  /** Fetch again in the background: no spinner, and a failure keeps what's on screen. */
  const refresh = useCallback(async () => {
    try {
      setData(await loader());
      setError(null);
    } catch {
      /* offline for a moment: keep the screen as it is */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  /** Like refresh, but says whether it worked (live updates back off when it did not). */
  const quiet = useCallback(async () => {
    try {
      setData(await loader());
      setError(null);
      return true;
    } catch {
      return false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return { data, error, loading, reload, refresh, quiet, setData };
}

/** How long the page must have been out of sight before coming back refreshes it. */
const AWAY_MS = 30_000;

/**
 * Coming back to the page (switching apps, unlocking the phone) after 30
 * seconds or more quietly loads the latest, so nobody acts on old info.
 */
export function useRefreshOnReturn(refresh: () => Promise<void>) {
  useEffect(() => {
    let hiddenAt = document.visibilityState === 'hidden' ? Date.now() : 0;
    const onChange = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAt = Date.now();
      } else if (hiddenAt && Date.now() - hiddenAt >= AWAY_MS) {
        hiddenAt = 0;
        void refresh();
      }
    };
    // Safari brings a page back from its memory without reloading it.
    const onShow = (e: PageTransitionEvent) => e.persisted && void refresh();
    document.addEventListener('visibilitychange', onChange);
    window.addEventListener('pageshow', onShow);
    return () => {
      document.removeEventListener('visibilitychange', onChange);
      window.removeEventListener('pageshow', onShow);
    };
  }, [refresh]);
}

// ---------- Routing (pushState, no library) ----------

const listeners = new Set<() => void>();
window.addEventListener('popstate', () => listeners.forEach((l) => l()));

export function navigate(path: string) {
  window.history.pushState(null, '', path);
  listeners.forEach((l) => l());
  window.scrollTo(0, 0);
}

export function usePath(): string {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => window.location.pathname,
  );
}

// ---------- Device helpers ----------

export const isIOS =
  /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

/** Copy text, falling back to a hidden textarea for older browsers. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the legacy path */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

/** Only allow http(s) links into href attributes. */
export function safeHref(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : undefined;
  } catch {
    return undefined;
  }
}

export function storageGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function storageRemove(key: string) {
  try {
    localStorage.removeItem(key);
  } catch {
    /* private mode: ignore */
  }
}

export function storageSet(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode: ignore */
  }
}

/** Re-render every minute so "in 3 hr" countdowns stay current. */
export function useNow(intervalMs = 60_000): number {
  const [now, setNow] = useState(Date.now());
  const pretendAt = usePretend();
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  // While pretending, the clock stands still at the pretend time.
  return pretendAt ?? now;
}

// ---------- Light / dark mode (per phone) ----------

export type ThemeChoice = 'system' | 'light' | 'dark';

export function getTheme(): ThemeChoice {
  const t = storageGet('pb_theme');
  return t === 'light' || t === 'dark' ? t : 'system';
}

/** Show a mode without remembering it (the organizer's "View as..." preview). */
export function applyTheme(choice: ThemeChoice) {
  if (choice === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', choice);
}

export function setTheme(choice: ThemeChoice) {
  if (choice === 'system') {
    try {
      localStorage.removeItem('pb_theme');
    } catch {
      /* ignore */
    }
    document.documentElement.removeAttribute('data-theme');
  } else {
    storageSet('pb_theme', choice);
    document.documentElement.setAttribute('data-theme', choice);
  }
}

const PHONE = /iPhone|iPad|iPod|Android/i;

/**
 * Pay. This page never leaves its tab, so coming back lands right on it with
 * "I paid" ready. On a phone the Venmo app opens on top of it; on a computer
 * the Venmo website opens in a new tab (the link's target="_blank"). In the
 * organizer's demo nothing opens.
 */
export function openVenmo(e: React.MouseEvent<HTMLAnchorElement>, pay: { url: string | null; appUrl: string | null }) {
  if (demoOn()) {
    e.preventDefault();
    return;
  }
  if (!pay.appUrl || !pay.url || !PHONE.test(navigator.userAgent)) return;
  e.preventDefault();
  window.location.href = pay.appUrl;
}
