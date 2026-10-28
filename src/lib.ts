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

/** "View as...": the signed-in organizer sees and acts as this player. */
export function setViewAs(playerId: string | null) {
  viewAsId = playerId;
}

/** What a tap says while the organizer is viewing as a player. */
export const DEMO_MESSAGE = 'Demo only. Nothing was saved.';

/** True for the "Demo only" answer, which is shown as a plain note, not an error. */
export function isDemo(err: unknown): err is ApiError {
  return err instanceof ApiError && err.code === 'demo_only';
}

// ---------- "Pretend it's..." (organizer only, look-only) ----------

const PRETEND_KEY = 'pb_pretend';
/** Pretend time switches itself off after this long. */
export const PRETEND_FOR_MS = 30 * 60_000;
const pretendListeners = new Set<() => void>();
let pretendTimer: ReturnType<typeof setTimeout> | undefined;

interface PretendState {
  atMs: number;
  /** Real time it switches off. */
  untilMs: number;
}

function readPretend(): PretendState | null {
  try {
    const raw = sessionStorage.getItem(PRETEND_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as PretendState;
    if (typeof p.atMs !== 'number' || typeof p.untilMs !== 'number' || Date.now() >= p.untilMs) {
      sessionStorage.removeItem(PRETEND_KEY);
      return null;
    }
    return p;
  } catch {
    return null;
  }
}

let pretendCache = readPretend();

function armPretendTimer() {
  clearTimeout(pretendTimer);
  if (pretendCache) pretendTimer = setTimeout(() => setPretend(null), Math.max(0, pretendCache.untilMs - Date.now()));
}
armPretendTimer();

/**
 * Pretend it's `atMs` (or stop with null). Kept in this tab only (closing
 * the tab ends it) and for 30 minutes at most. Never saved anywhere else.
 */
export function setPretend(atMs: number | null) {
  pretendCache = atMs === null ? null : { atMs, untilMs: Date.now() + PRETEND_FOR_MS };
  try {
    if (pretendCache) sessionStorage.setItem(PRETEND_KEY, JSON.stringify(pretendCache));
    else sessionStorage.removeItem(PRETEND_KEY);
  } catch {
    /* private mode: it still works until the page reloads */
  }
  armPretendTimer();
  pretendListeners.forEach((l) => l());
}

/** The pretend time, or null when it's off. */
export function pretendMs(): number | null {
  if (pretendCache && Date.now() >= pretendCache.untilMs) setPretend(null);
  return pretendCache?.atMs ?? null;
}

export function usePretend(): number | null {
  return useSyncExternalStore(
    (cb) => {
      pretendListeners.add(cb);
      return () => pretendListeners.delete(cb);
    },
    () => pretendCache?.atMs ?? null,
  );
}

/** Now, or the pretend time while it's on. */
export function appNow(): number {
  return pretendMs() ?? Date.now();
}

export async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  // "View as..." is look-only: player taps never leave the phone.
  if (viewAsId && method !== 'GET' && path.startsWith('/api/') && !path.startsWith('/api/admin/')) {
    throw new ApiError(0, 'demo_only', DEMO_MESSAGE);
  }
  // So is "Pretend it's...", for every change (signing out still works and ends it).
  const pretend = pretendMs();
  if (pretend !== null && method !== 'GET' && path !== '/api/admin/logout') {
    throw new ApiError(0, 'demo_only', DEMO_MESSAGE);
  }
  const headers: Record<string, string> = {};
  if (pretend !== null && path.startsWith('/api/')) headers['X-Pretend-Now'] = new Date(pretend).toISOString();
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (viewAsId && path.startsWith('/api/') && !path.startsWith('/api/admin/')) headers['X-View-As'] = viewAsId;
  else if (groupKey) headers['X-Group-Key'] = groupKey;
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin',
    });
  } catch {
    throw new ApiError(0, 'offline', "Couldn't reach the site. Check your connection and try again.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error ?? 'error', data.message ?? 'Something went wrong. Try again.');
  return data as T;
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
  return { data, error, loading, reload, refresh, setData };
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
  const pretend = usePretend();
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  // While pretending, the clock stands still at the pretend time.
  return pretend ?? now;
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
