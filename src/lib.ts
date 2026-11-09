import { DIRECT_LOAD_HEADER, LAST_SCREEN_ADMIN_HEADER, LAST_SCREEN_HEADER, SPEED_QUERIES_HEADER } from '../shared/speed';
import { ZIP13 } from '../shared/zip13';
import { GAME_DAY_CARD, GAME_DAY_TEST } from '../shared/gameDay';
import { UNPAID_NUDGE } from '../shared/unpaidNudge';
import { AFTER_GAME_CARD } from '../shared/afterGame';
import { TOTALS_REFRESH } from '../shared/totalsRefresh';
import { BOOKING_HOURS } from '../shared/bookingHours';
import { SECOND_CHANCE, SECOND_CHANCE_TEST } from '../shared/secondChance';
import { PREVIEW_CALM } from '../shared/previewCalm';
import { leavingWithHolds } from './undoHold';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';

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
/** Who the organizer is viewing as right now (null when not in View as). */
export const viewingAs = () => viewAsId;

export function setViewAs(playerId: string | null) {
  if (playerId === viewAsId) return;
  const was = demoOn();
  viewAsId = playerId;
  demoChanged(was);
}

/** What a tap says when the live site refuses a View-as change. */
export const DEMO_MESSAGE = 'Demo only. Nothing was saved.';

/** What a tap says when the organizer signed in with the read-only PIN (server/viewOnly.ts) and the server refused the save. */
export const VIEW_ONLY_MESSAGE = 'View only. Nothing was saved.';

/** True for the "Demo only" answer (and the read-only PIN's "View only" answer), which is shown as a plain note, not an error. */
export function isDemo(err: unknown): err is ApiError {
  return err instanceof ApiError && (err.code === 'demo_only' || err.code === 'view_only');
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
/** The demo session number right now (it changes when a demo starts, ends or is reset). */
export const demoSessionNumber = () => demoVersion;

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
  // The moved-game notice's private test switch for this phone (?timeshift=on, see server/timeShift.ts).
  if (timeShiftTest()) headers['X-Time-Shift'] = 'on';
  // The motion's private test switch for this phone (?motion=on, see server/motion.ts).
  if (motionTest()) headers['X-Motion'] = 'on';
  // The organizer screens' own private motion switch (?motionadmin=on, see server/motion.ts).
  if (motionAdminTest()) headers['X-Motion-Admin'] = 'on';
  // "Ask for payment on every game", private test switch for this phone (?payalways=on, see server/payAlways.ts).
  if (payAlwaysTest()) headers['X-Pay-Always'] = 'on';
  // "No Venmo? Pay Alex directly" note, private test switch for this phone (?paynote=on, see server/payNote.ts).
  if (payNoteTest()) headers['X-Pay-Note'] = 'on';
  // "Player screen small fixes, round 1", private test switch for this phone (?playerfix1=on, see server/playerFix1.ts).
  if (playerFix1Test()) headers['X-Player-Fix1'] = 'on';
  // "Texts and alerts, round 2", private test switch for this phone (/admin?textsr2=on, see server/textsR2.ts).
  if (textsR2Test()) headers['X-Texts-R2'] = 'on';
  // "Late-cancel fee split", private test switch for this phone (/admin?latefeesplit=on, see server/lateFeeSplit.ts).
  if (lateFeeSplitTest()) headers['X-Late-Fee-Split'] = 'on';
  // "Pay sheet", private test switch for this phone (?paysheet=on, see server/paySheet.ts).
  if (paySheetTest()) headers['X-Pay-Sheet'] = 'on';
  // "New admin layout", private test switch for this phone (/admin?adminv2=on, see server/adminV2.ts).
  if (adminV2Test()) headers['X-Admin-V2'] = 'on';
  // "Admin screens, round 2", private test switch for this phone (/admin?adminr2=on, see server/adminR2.ts).
  if (adminR2Test()) headers['X-Admin-R2'] = 'on';
  // "Admin screens, round 3", private test switch for this phone (/admin?adminr3=on, see server/adminR3.ts).
  if (adminR3Test()) headers['X-Admin-R3'] = 'on';
  // "Money page rework", private test switch for this phone (/admin?moneyrework=on, see server/moneyRework.ts).
  if (moneyReworkTest()) headers['X-Money-Rework'] = 'on';
  // "Instant taps", private test switch for this phone (?instanttaps=on or /admin?instanttaps=on, see server/instantTaps.ts).
  if (instantTapsTest()) headers['X-Instant-Taps'] = 'on';
  // "Adjust credit" and "Venmo request", private test switches for this phone (/admin?adjustcredit=on, /admin?venmorequest=on).
  if (adjustCreditTest()) headers['X-Adjust-Credit'] = 'on';
  if (venmoRequestTest()) headers['X-Venmo-Request'] = 'on';
  // "Home collapse", private test switch for this phone (/?homecollapse=on, see server/homeCollapse.ts).
  if (homeCollapseTest()) headers['X-Home-Collapse'] = 'on';
  // Zip 7 private test switches for this phone (?tonightglow=on, ?colorcleanup=on, ?playercards=on, see server/zip7.ts).
  if (zip7Test('tonightglow')) headers['X-Tonight-Glow'] = 'on';
  if (zip7Test('colorcleanup')) headers['X-Color-Cleanup'] = 'on';
  if (zip7Test('playercards')) headers['X-Player-Cards'] = 'on';
  // "Last call texts", private test switch for this phone (/admin?lastcall=on, see server/lastCall.ts).
  if (lastCallTest()) headers['X-Last-Call'] = 'on';
  // Zip 9 private test switches for this phone (?shortgames=on, ?cardtime=on; also on /admin, see server/zip9.ts).
  if (zip9Test('shortgames')) headers['X-Short-Games'] = 'on';
  if (zip9Test('cardtime')) headers['X-Card-Time'] = 'on';
  // Zip 10 private test switch for this phone (?cardcleanup=on; also on /admin, see server/zip10.ts).
  if (zip10Test()) headers['X-Card-Cleanup'] = 'on';
  // Zip 11 private test switch for this phone (?alertcards=on; also on /admin, see server/zip11.ts).
  if (zip11Test()) headers['X-Alert-Cards'] = 'on';
  // Zip 12 private test switches for this phone (?fewerqueries=on, ?directload=on, ?lastscreen=on; see server/speed.ts).
  if (speedTest('fewerqueries')) headers[SPEED_QUERIES_HEADER] = 'on';
  if (speedTest('directload')) headers[DIRECT_LOAD_HEADER] = 'on';
  if (speedTest('lastscreen')) headers[LAST_SCREEN_HEADER] = 'on';
  if (speedTest('lastscreenadmin')) headers[LAST_SCREEN_ADMIN_HEADER] = 'on';
  // Seat dots private test switch for this phone (?seatdots=on; also on /admin, see server/seatDots.ts).
  if (seatDotsTest()) headers['X-Seat-Dots'] = 'on';
  // Zip 14 "Game day card" private test switch for this phone (?gameday=on; also on /admin), and the preview-only "next game as today"
  // (?gamedaytest=on; the server ignores it unless GAME_DAY_TEST is set, which only previews have). See server/gameDay.ts.
  if (gameDayTest(GAME_DAY_CARD.link)) headers[GAME_DAY_CARD.header] = 'on';
  if (gameDayTest(GAME_DAY_TEST.link)) headers[GAME_DAY_TEST.header] = 'on';
  // Zip 16 "After-game cards" private test switch for this phone (?aftergame=on, =off ends it). See server/afterGame.ts.
  if (gameDayTest(AFTER_GAME_CARD.link)) headers[AFTER_GAME_CARD.header] = 'on';
  // Zip 23 "Totals refresh" private test switch for this phone (/admin?totalsrefresh=on, =off ends it). See server/totalsRefresh.ts.
  if (gameDayTest(TOTALS_REFRESH.link)) headers[TOTALS_REFRESH.header] = 'on';
  // Zip 24 "Booking hours" private test switch for this phone (/admin?bookinghours=on, =off ends it). See server/bookingHours.ts.
  if (gameDayTest(BOOKING_HOURS.link)) headers[BOOKING_HOURS.header] = 'on';
  // Zip 15 "Second Chance" private test switch for this phone (/admin?secondchance=on: the Home cards, never a Telegram), and the
  // preview-only "pretend it's noon on game day" (?noontest=on; the server ignores it unless SECOND_CHANCE_TEST is set, only on previews).
  if (gameDayTest(SECOND_CHANCE.link)) headers[SECOND_CHANCE.header] = 'on';
  if (gameDayTest(SECOND_CHANCE_TEST.link)) headers[SECOND_CHANCE_TEST.header] = 'on';
  // Zip 17 "Unpaid nudge" private test switch for this phone (?nudge=on; ?nudge=off ends it). See server/unpaidNudge.ts.
  if (gameDayTest(UNPAID_NUDGE.link)) headers[UNPAID_NUDGE.header] = 'on';
  // Preview only (shared/previewCalm.ts): ?alerts=all shows every alert on this phone (?alerts=calm goes back to this zip's cards only).
  if (storageGet('pb_alerts') === 'all') headers[PREVIEW_CALM.header] = 'all';
  // Zip 13 private test switches for this phone (/admin?playersredo=on, ?swapbutton=on, ?adminundo=on; see server/zip13.ts).
  for (const z of Object.values(ZIP13)) if (zip13Test(z.link)) headers[z.header] = 'on';
  // "Late drops owe $14", private test switch for this phone (?latefees=on or /admin?latefees=on, see server/lateFees.ts).
  if (lateFeesTest()) headers['X-Late-Fees'] = 'on';
  // Zip 18 round 2 (Alex): View as shows exactly what the player sees, so this phone's own private test links (?nudge=on, ?seatdots=on and
  // the rest above) are left off a View as request: the copy answers with the live switches alone. The preview-only ?alerts= view stays
  // (it only exists on previews, never on live). Pretend's organizer screens and this phone's own pages keep them, as before.
  const asPlayer = viewAsId !== null && path.startsWith('/api/') && !path.startsWith('/api/admin/');
  // (Also kept: the two preview-only test clocks, ?gamedaytest= and ?noontest=: the server ignores them unless the site is a preview.)
  const keep = new Set(['Content-Type', PREVIEW_CALM.header, GAME_DAY_TEST.header, SECOND_CHANCE_TEST.header]);
  if (asPlayer) for (const k of Object.keys(headers)) if (!keep.has(k)) delete headers[k];
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
      // (Undo on admin toasts: held saves let go as the page hides go out with keepalive too, src/undoHold.ts.)
      keepalive: opts.keepalive || leavingWithHolds() || undefined,
    });
  } catch {
    throw new ApiError(0, 'offline', OFFLINE_MESSAGE);
  }
  return answer<T>(res);
}

/** Load data with loading / error / retry states. */
/**
 * `tracker` (instant taps, src/instant.ts): with it switched on, an answer that set off before a newer one was drawn is thrown away,
 * so a slow poll can never draw old data over a tap that just saved. Without it (or switched off) every answer is drawn, as always.
 */
export function useLoad<T>(loader: () => Promise<T>, deps: unknown[] = [], tracker?: { begin(): number; accept(n: number): boolean }) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);
  const trackerRef = useRef(tracker);
  trackerRef.current = tracker;
  /** Load, and draw the answer unless a newer one is already on screen. */
  const fetchDraw = async () => {
    const n = trackerRef.current?.begin() ?? 0;
    const value = await loader();
    if (!trackerRef.current || trackerRef.current.accept(n)) setData(value);
  };
  const reload = useCallback(async () => {
    setLoading(true);
    try {
      await fetchDraw();
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
      await fetchDraw();
      setError(null);
    } catch {
      /* offline for a moment: keep the screen as it is */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  /** Like refresh, but says whether it worked (live updates back off when it did not). */
  const quiet = useCallback(async () => {
    try {
      await fetchDraw();
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
  if (!venmoHandsOffToApp(pay)) return;
  e.preventDefault();
  window.location.href = pay.appUrl!;
}

/** Will a tap on Pay hand the phone over to the Venmo app (a venmo:// address)? Then a phone without the app sees "invalid address". */
export function venmoHandsOffToApp(pay: { url: string | null; appUrl: string | null }): boolean {
  return !demoOn() && !!pay.appUrl && !!pay.url && PHONE.test(navigator.userAgent);
}

/**
 * The moved-game notice on this phone only, before it is on for everyone: open the site once with ?timeshift=on
 * (?timeshift=off turns it back off). Remembered in this browser; nothing else changes.
 */
const TIME_SHIFT_KEY = 'pb_time_shift';
export function timeShiftTest(): boolean {
  return storageGet(TIME_SHIFT_KEY) === 'on';
}
if (typeof window !== 'undefined') {
  const want = new URLSearchParams(window.location.search).get('timeshift');
  if (want === 'on') storageSet(TIME_SHIFT_KEY, 'on');
  else if (want === 'off') storageRemove(TIME_SHIFT_KEY);
}

/**
 * "Ask for payment on every game" on this phone only, before it is on for everyone: open the site once with
 * ?payalways=on (?payalways=off turns it back off). Remembered in this browser; nothing else changes.
 */
const PAY_ALWAYS_KEY = 'pb_pay_always';
export function payAlwaysTest(): boolean {
  return storageGet(PAY_ALWAYS_KEY) === 'on';
}
if (typeof window !== 'undefined') {
  const want = new URLSearchParams(window.location.search).get('payalways');
  if (want === 'on') storageSet(PAY_ALWAYS_KEY, 'on');
  else if (want === 'off') storageRemove(PAY_ALWAYS_KEY);
}

/**
 * The "No Venmo? Pay Alex directly" note on this phone only, before it is on for everyone: open the site once with
 * ?paynote=on (?paynote=off turns it back off). Remembered in this browser; nothing else changes.
 */
const PAY_NOTE_KEY = 'pb_pay_note';
export function payNoteTest(): boolean {
  return storageGet(PAY_NOTE_KEY) === 'on';
}
if (typeof window !== 'undefined') {
  const want = new URLSearchParams(window.location.search).get('paynote');
  if (want === 'on') storageSet(PAY_NOTE_KEY, 'on');
  else if (want === 'off') storageRemove(PAY_NOTE_KEY);
}

/**
 * "Player screen small fixes, round 1" on this phone only, before it is on for everyone: open the site once with
 * ?playerfix1=on (?playerfix1=off turns it back off). Remembered in this browser; nothing else changes.
 */
const PLAYER_FIX1_KEY = 'pb_player_fix1';
export function playerFix1Test(): boolean {
  return storageGet(PLAYER_FIX1_KEY) === 'on';
}
if (typeof window !== 'undefined') {
  const want = new URLSearchParams(window.location.search).get('playerfix1');
  if (want === 'on') storageSet(PLAYER_FIX1_KEY, 'on');
  else if (want === 'off') storageRemove(PLAYER_FIX1_KEY);
}

/**
 * "Texts and alerts, round 2" on this phone only, before it is on for everyone: open /admin?textsr2=on once
 * (?textsr2=off turns it back off). Remembered in this browser; nothing else changes. It changes the texts this phone opens and
 * the cancel sheet's default. The Telegram alerts follow the switch for everyone only.
 */
const TEXTS_R2_KEY = 'pb_texts_r2';
export function textsR2Test(): boolean {
  return storageGet(TEXTS_R2_KEY) === 'on';
}
if (typeof window !== 'undefined') {
  const want = new URLSearchParams(window.location.search).get('textsr2');
  if (want === 'on') storageSet(TEXTS_R2_KEY, 'on');
  else if (want === 'off') storageRemove(TEXTS_R2_KEY);
}

/**
 * "Late-cancel fee split" on this phone only, before it is on for everyone: open /admin?latefeesplit=on once
 * (?latefeesplit=off turns it back off). Remembered in this browser. It CHANGES MONEY for this phone's taps: a cancel inside
 * 12 hours answered "No" to the venue question, with 5 or more in, prices every seat like a played game. Needs late fees on.
 */
const LATE_FEE_SPLIT_KEY = 'pb_late_fee_split';
export function lateFeeSplitTest(): boolean {
  return storageGet(LATE_FEE_SPLIT_KEY) === 'on';
}
if (typeof window !== 'undefined') {
  const want = new URLSearchParams(window.location.search).get('latefeesplit');
  if (want === 'on') storageSet(LATE_FEE_SPLIT_KEY, 'on');
  else if (want === 'off') storageRemove(LATE_FEE_SPLIT_KEY);
}

/**
 * The Pay sheet on this phone only, before it is on for everyone: open the site once with ?paysheet=on
 * (?paysheet=off turns it back off). Remembered in this browser; nothing else changes.
 */
const PAY_SHEET_KEY = 'pb_pay_sheet';
export function paySheetTest(): boolean {
  return storageGet(PAY_SHEET_KEY) === 'on';
}
if (typeof window !== 'undefined') {
  const want = new URLSearchParams(window.location.search).get('paysheet');
  if (want === 'on') storageSet(PAY_SHEET_KEY, 'on');
  else if (want === 'off') storageRemove(PAY_SHEET_KEY);
}

/**
 * The new organizer layout (History, Money, Home v2) on this phone only, before it is on for everyone: open /admin once
 * with ?adminv2=on (?adminv2=off turns it back off). Remembered in this browser; nothing else changes.
 */
const ADMIN_V2_KEY = 'pb_admin_v2';
export function adminV2Test(): boolean {
  return storageGet(ADMIN_V2_KEY) === 'on';
}
if (typeof window !== 'undefined') {
  const want = new URLSearchParams(window.location.search).get('adminv2');
  if (want === 'on') storageSet(ADMIN_V2_KEY, 'on');
  else if (want === 'off') storageRemove(ADMIN_V2_KEY);
}

/**
 * "Admin screens, round 2" (Home cards, Money, Players, History, header) on this phone only, before it is on for everyone:
 * open /admin once with ?adminr2=on (?adminr2=off turns it back off). Remembered in this browser; nothing else changes.
 */
/**
 * "Late drops owe $14" on this phone only, before it is on for everyone: open the site (or /admin) once with ?latefees=on
 * (?latefees=off turns it back off). Remembered in this browser. It CHANGES MONEY for this phone's own taps: a late drop
 * that leaves a game short owes, and the organizer's Finalize and late cancel follow the new rules.
 */
const LATE_FEES_KEY = 'pb_late_fees';
export function lateFeesTest(): boolean {
  return storageGet(LATE_FEES_KEY) === 'on';
}
if (typeof window !== 'undefined') {
  const want = new URLSearchParams(window.location.search).get('latefees');
  if (want === 'on') storageSet(LATE_FEES_KEY, 'on');
  else if (want === 'off') storageRemove(LATE_FEES_KEY);
}

const ADMIN_R2_KEY = 'pb_admin_r2';
export function adminR2Test(): boolean {
  return storageGet(ADMIN_R2_KEY) === 'on';
}
if (typeof window !== 'undefined') {
  const want = new URLSearchParams(window.location.search).get('adminr2');
  if (want === 'on') storageSet(ADMIN_R2_KEY, 'on');
  else if (want === 'off') storageRemove(ADMIN_R2_KEY);
}

const ADMIN_R3_KEY = 'pb_admin_r3';
/** "Admin screens, round 3" on this phone only: open /admin once with ?adminr3=on (?adminr3=off ends it). Remembered in this browser. */
export function adminR3Test(): boolean {
  return storageGet(ADMIN_R3_KEY) === 'on';
}
if (typeof window !== 'undefined') {
  const want = new URLSearchParams(window.location.search).get('adminr3');
  if (want === 'on') storageSet(ADMIN_R3_KEY, 'on');
  else if (want === 'off') storageRemove(ADMIN_R3_KEY);
}

/**
 * "Money page rework" (the new Money page, Hide from list, Edit charge, the cancel sheet default, the tidier Feature switches and History)
 * on this phone only, before it is on for everyone: open /admin once with ?moneyrework=on (?moneyrework=off turns it back off).
 * Remembered in this browser; nothing else changes.
 */
const MONEY_REWORK_KEY = 'pb_money_rework';
export function moneyReworkTest(): boolean {
  return storageGet(MONEY_REWORK_KEY) === 'on';
}
if (typeof window !== 'undefined') {
  const want = new URLSearchParams(window.location.search).get('moneyrework');
  if (want === 'on') storageSet(MONEY_REWORK_KEY, 'on');
  else if (want === 'off') storageRemove(MONEY_REWORK_KEY);
}

/**
 * "Instant taps" on this phone only, before it is on for everyone: open the site (or /admin) once with ?instanttaps=on
 * (?instanttaps=off turns it back off). Remembered in this browser; the server saves exactly the same things either way.
 */
const INSTANT_TAPS_KEY = 'pb_instant_taps';
export function instantTapsTest(): boolean {
  return storageGet(INSTANT_TAPS_KEY) === 'on';
}
if (typeof window !== 'undefined') {
  const want = new URLSearchParams(window.location.search).get('instanttaps');
  if (want === 'on') storageSet(INSTANT_TAPS_KEY, 'on');
  else if (want === 'off') storageRemove(INSTANT_TAPS_KEY);
}

/**
 * "Adjust credit" on this phone only, before it is on for everyone: open /admin once with ?adjustcredit=on
 * (?adjustcredit=off turns it back off). Remembered in this browser; organizer screens only.
 */
const ADJUST_CREDIT_KEY = 'pb_adjust_credit';
export function adjustCreditTest(): boolean {
  return storageGet(ADJUST_CREDIT_KEY) === 'on';
}
if (typeof window !== 'undefined') {
  const want = new URLSearchParams(window.location.search).get('adjustcredit');
  if (want === 'on') storageSet(ADJUST_CREDIT_KEY, 'on');
  else if (want === 'off') storageRemove(ADJUST_CREDIT_KEY);
}

/**
 * "Home collapse" on this phone only, before it is on for everyone: open the site once with ?homecollapse=on
 * (?homecollapse=off turns it back off). Remembered in this browser; the player Home layout only.
 */
const HOME_COLLAPSE_KEY = 'pb_home_collapse';
export function homeCollapseTest(): boolean {
  return storageGet(HOME_COLLAPSE_KEY) === 'on';
}
if (typeof window !== 'undefined') {
  const want = new URLSearchParams(window.location.search).get('homecollapse');
  if (want === 'on') storageSet(HOME_COLLAPSE_KEY, 'on');
  else if (want === 'off') storageRemove(HOME_COLLAPSE_KEY);
}

/**
 * "Last call texts" on this phone only, before it is on for everyone: open /admin?lastcall=on once (?lastcall=off turns it back
 * off). Remembered in this browser; the words of the Check-in and Need players texts only.
 */
const LAST_CALL_KEY = 'pb_last_call';
export function lastCallTest(): boolean {
  return storageGet(LAST_CALL_KEY) === 'on';
}
if (typeof window !== 'undefined') {
  const want = new URLSearchParams(window.location.search).get('lastcall');
  if (want === 'on') storageSet(LAST_CALL_KEY, 'on');
  else if (want === 'off') storageRemove(LAST_CALL_KEY);
}

/**
 * Zip 9 switches on this phone only, before they are on for everyone: open the site once with ?shortgames=on or ?cardtime=on
 * (the same word with =off turns it back off; works on /admin too). Remembered in this browser. "Short games" really changes the
 * price of 1.5 hour games for that phone's taps, and the server honors it only for the organizer's sign-in (server/zip9.ts): test it on
 * the fake-data preview, or on live only with test players on an extra game.
 */
export function zip9Test(name: 'shortgames' | 'cardtime'): boolean {
  return storageGet(`pb_${name}`) === 'on';
}
if (typeof window !== 'undefined') {
  for (const name of ['shortgames', 'cardtime']) {
    const want = new URLSearchParams(window.location.search).get(name);
    if (want === 'on') storageSet(`pb_${name}`, 'on');
    else if (want === 'off') storageRemove(`pb_${name}`);
  }
}

/**
 * Zip 13 (shared/zip13.ts) on this phone only, before it is on for everyone: open /admin once with ?playersredo=on, ?swapbutton=on or
 * ?adminundo=on (=off turns it back off). Remembered in this browser. Organizer screens only (and the organizer's own player page).
 */
export function zip13Test(link: string): boolean {
  return storageGet(`pb_${link}`) === 'on';
}
if (typeof window !== 'undefined') {
  for (const z of Object.values(ZIP13)) {
    const want = new URLSearchParams(window.location.search).get(z.link);
    if (want === 'on') storageSet(`pb_${z.link}`, 'on');
    else if (want === 'off') storageRemove(`pb_${z.link}`);
  }
}

/**
 * Zip 14 on this phone only: ?gameday=on (the Game day card before it is on for everyone; works on /admin too, where it also shows the
 * Court row) and ?gamedaytest=on (preview only: the next game's date shown as today). The same word with =off ends it. Remembered here.
 */
export function gameDayTest(link: string): boolean {
  return storageGet(`pb_${link}`) === 'on';
}
if (typeof window !== 'undefined') {
  // Zip 15 too: ?secondchance=on and the preview-only ?noontest=on (the same word with =off ends it).
  // Zip 16 too: ?aftergame=on.
  for (const link of [GAME_DAY_CARD.link, GAME_DAY_TEST.link, SECOND_CHANCE.link, SECOND_CHANCE_TEST.link, AFTER_GAME_CARD.link, UNPAID_NUDGE.link, TOTALS_REFRESH.link, BOOKING_HOURS.link]) {
    const want = new URLSearchParams(window.location.search).get(link);
    if (want === 'on') storageSet(`pb_${link}`, 'on');
    else if (want === 'off') storageRemove(`pb_${link}`);
  }
}

if (typeof window !== 'undefined') {
  const want = new URLSearchParams(window.location.search).get(PREVIEW_CALM.link);
  if (want === 'all') storageSet('pb_alerts', 'all');
  else if (want === 'calm') storageRemove('pb_alerts');
}

/** "Seat dots" on this phone only (?seatdots=on, =off to stop; works on /admin too). Remembered in this browser. Look only. */
export function seatDotsTest(): boolean {
  return storageGet('pb_seatdots') === 'on';
}
if (typeof window !== 'undefined') {
  const want = new URLSearchParams(window.location.search).get('seatdots');
  if (want === 'on') storageSet('pb_seatdots', 'on');
  else if (want === 'off') storageRemove('pb_seatdots');
}

/**
 * "Alert cards" (Zip 11) on this phone only, before it is on for everyone: open the site once with ?alertcards=on (=off turns it back
 * off; works on /admin too). Remembered in this browser. Look only, safe on any phone.
 */
export function zip11Test(): boolean {
  return storageGet('pb_alertcards') === 'on';
}
if (typeof window !== 'undefined') {
  const want = new URLSearchParams(window.location.search).get('alertcards');
  if (want === 'on') storageSet('pb_alertcards', 'on');
  else if (want === 'off') storageRemove('pb_alertcards');
}

/**
 * "Card cleanup" (Zip 10) on this phone only, before it is on for everyone: open the site once with ?cardcleanup=on (=off turns it back
 * off; works on /admin too). Remembered in this browser. It also lifts the Max players cap and the waitlist for that phone's taps (up
 * to 12, the database's limit), so test it on the fake-data preview, or on live only with test players on an extra game.
 */
export function zip10Test(): boolean {
  return storageGet('pb_cardcleanup') === 'on';
}
if (typeof window !== 'undefined') {
  const want = new URLSearchParams(window.location.search).get('cardcleanup');
  if (want === 'on') storageSet('pb_cardcleanup', 'on');
  else if (want === 'off') storageRemove('pb_cardcleanup');
}

/**
 * Zip 7 switches on this phone only, before they are on for everyone: open the site once with ?tonightglow=on, ?colorcleanup=on or
 * ?playercards=on (the same word with =off turns it back off). Remembered in this browser; look and feel only.
 */
export function zip7Test(name: 'tonightglow' | 'colorcleanup' | 'playercards'): boolean {
  return storageGet(`pb_${name}`) === 'on';
}
if (typeof window !== 'undefined') {
  for (const name of ['tonightglow', 'colorcleanup', 'playercards']) {
    const want = new URLSearchParams(window.location.search).get(name);
    if (want === 'on') storageSet(`pb_${name}`, 'on');
    else if (want === 'off') storageRemove(`pb_${name}`);
  }
}

/**
 * "Venmo request" on this phone only, before it is on for everyone: open /admin once with ?venmorequest=on
 * (?venmorequest=off turns it back off). Remembered in this browser; organizer screens only.
 */
const VENMO_REQUEST_KEY = 'pb_venmo_request';
export function venmoRequestTest(): boolean {
  return storageGet(VENMO_REQUEST_KEY) === 'on';
}
if (typeof window !== 'undefined') {
  const want = new URLSearchParams(window.location.search).get('venmorequest');
  if (want === 'on') storageSet(VENMO_REQUEST_KEY, 'on');
  else if (want === 'off') storageRemove(VENMO_REQUEST_KEY);
}

/**
 * The motion (animations) on this phone only, before it is on for everyone: open the site once with ?motion=on
 * (?motion=off turns it back off). Remembered in this browser; nothing else changes.
 */
const MOTION_TEST_KEY = 'pb_motion_test';
export function motionTest(): boolean {
  return storageGet(MOTION_TEST_KEY) === 'on';
}
if (typeof window !== 'undefined') {
  const want = new URLSearchParams(window.location.search).get('motion');
  if (want === 'on') storageSet(MOTION_TEST_KEY, 'on');
  else if (want === 'off') storageRemove(MOTION_TEST_KEY);
}

/**
 * The organizer screens' motion on this phone only, before it is on for everyone: open the site once with
 * ?motionadmin=on (?motionadmin=off turns it back off). Remembered in this browser; nothing else changes.
 */
const MOTION_ADMIN_KEY = 'pb_motion_admin_test';
export function motionAdminTest(): boolean {
  return storageGet(MOTION_ADMIN_KEY) === 'on';
}
if (typeof window !== 'undefined') {
  const want = new URLSearchParams(window.location.search).get('motionadmin');
  if (want === 'on') storageSet(MOTION_ADMIN_KEY, 'on');
  else if (want === 'off') storageRemove(MOTION_ADMIN_KEY);
}

/**
 * Zip 12 speed switches on this phone only, before they are on for everyone: open the site once with ?fewerqueries=on,
 * ?directload=on or ?lastscreen=on (the same word with =off turns it back off). Remembered in this browser. None of them changes
 * money or what a tap does; Show last screen at once draws this phone's saved copy (no money in it) with every button held.
 */
export function speedTest(name: 'fewerqueries' | 'directload' | 'lastscreen' | 'lastscreenadmin'): boolean {
  return storageGet(`pb_${name}`) === 'on';
}
if (typeof window !== 'undefined') {
  for (const name of ['fewerqueries', 'directload', 'lastscreen', 'lastscreenadmin']) {
    const want = new URLSearchParams(window.location.search).get(name);
    if (want === 'on') storageSet(`pb_${name}`, 'on');
    else if (want === 'off') storageRemove(`pb_${name}`);
  }
}

/**
 * "Load games at once" (SPEED_DIRECT_LOAD). The plain site address normally asks "is this site set up?" (/api/status) and only then
 * for the games (/api/group). With the switch on, the last games answer said so (`directLoad`) and this phone remembers it: the next
 * time the page opens, both questions go out together, the moment the code starts. The set-up answer still decides what the page
 * shows (not set up, link only, the group word, or the games); the early games answer is only used if the games are what it shows.
 * Off (the answer no longer says so): forgotten at once, and the page asks one after the other again.
 */
const DIRECT_LOAD_KEY = 'pb_direct_load';
export function directLoadOn(): boolean {
  return speedTest('directload') || storageGet(DIRECT_LOAD_KEY) === 'on';
}
export function rememberDirectLoad(on: boolean) {
  if (on) storageSet(DIRECT_LOAD_KEY, 'on');
  else storageRemove(DIRECT_LOAD_KEY);
}
const early: { status?: Promise<unknown>; group?: Promise<unknown> } = {};
/** Called once by src/main.tsx before the first draw: starts both questions for the plain address when the switch is on. */
export function startEarlyLoads(path: string) {
  if (!/^\/?$/.test(path) || !directLoadOn() || demoOn()) return;
  early.status = api('GET', '/api/status');
  early.group = api('GET', '/api/group');
  // Never an "unhandled" error: whoever takes it handles it, and an answer nobody takes is simply dropped.
  early.status.catch(() => {});
  early.group.catch(() => {});
}
/** The early answer for this question, once (a reload or a retry asks again). */
export function takeEarly<T>(name: 'status' | 'group'): Promise<T> | null {
  const p = early[name] as Promise<T> | undefined;
  delete early[name];
  return p ?? null;
}
