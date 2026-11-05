import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import './instant-taps.css';
import { isDemo } from './lib';
import { useToast } from './ui';
import { drawPatches, failureWords, LoadTracker, SaveLine, TapQueue, type TapResult } from './instant';

// Instant taps (INSTANT_TAPS) for a whole screen: the player page and the organizer page each make one root (useInstantRoot) and put
// its store in <InstantContext.Provider>. Buttons call `useInstant()`: when it gives null, instant taps are off for this phone and the
// button does exactly what it always did. The rules (double taps, order, rollback, polls) are in src/instant.ts; this file connects
// them to React, the toast, and the "working" look of the button that was tapped.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Patch<T> = (d: T) => T;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface InstantTap<R, T = any> {
  /** One key per thing the tap changes. A second tap on the same key while it saves is ignored. */
  key: string;
  /** What the screen shows at once. Leave it out where the server decides: the tapped button shows it is working instead. */
  patch?: Patch<T> | null;
  save: () => Promise<R>;
  /** The toast when the server confirmed ("Marked paid"). A function gets the server's answer. Leave out for no toast. */
  saved?: string | null | ((value: R) => string | null | undefined);
  /** What failed, in a few words, for the error toast ("Mark paid"). The server's own reason wins when it gives one. */
  what?: string;
  /** Show no toast at all on a failure (the caller says it its own way). */
  quietFail?: boolean;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface InstantStore<T = any> {
  run<R>(tap: InstantTap<R, T>): Promise<TapResult<R>>;
  busy(key: string): boolean;
  /** The order the screen's saves go out in (the Money page shares it). */
  line: SaveLine;
  tracker: LoadTracker;
}

export const InstantContext = createContext<InstantStore | null>(null);

/** Is instant taps on for this screen? null = off (do what you always did). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function useInstant<T = any>(): InstantStore<T> | null {
  return useContext(InstantContext) as InstantStore<T> | null;
}

/** One per page: a load tracker for useLoad, so a poll that set off before a save can never draw over it. */
export function useInstantTracker(): LoadTracker {
  const tracker = useRef<LoadTracker | null>(null);
  if (!tracker.current) tracker.current = new LoadTracker();
  return tracker.current;
}

// ---------- The button that was tapped shows it is working ----------
// Where the server decides (a full game, fees, prices), nothing is drawn ahead; the button that was tapped gets a pressed look and a
// small spinner at once (the same frame as the tap), until the server answers. Found from the click itself, so every button gets it
// without each one being changed. Only ever set while instant taps is on (only the store calls it).
let lastPressed: { el: HTMLElement; at: number; x: number; y: number } | null = null;
if (typeof document !== 'undefined') {
  document.addEventListener(
    'click',
    (e) => {
      const el = e.target instanceof Element ? e.target.closest<HTMLElement>('button, a.btn, [role="button"]') : null;
      lastPressed = el ? { el, at: performance.now(), x: e.clientX, y: e.clientY } : null;
    },
    true,
  );
}

// ---------- A double tap never lands on the next button ----------
// A tap is drawn at once, so the row can change or move under the finger (Mark paid moves a paid row below the people who still owe).
// The second half of a quick double tap then lands on a DIFFERENT button: it must not count (it would pay or drop the wrong person).
// Same idea as the banner's double-tap guard (ui.tsx DOUBLE_TAP): within 400 ms and 24 px of the tap before it, on another thing.
const DOUBLE_TAP_MS = 400;
const DOUBLE_TAP_PX = 24;
let lastRun: { key: string; at: number; x: number; y: number } | null = null;
/** Is this tap (for `key`) the second half of a double tap whose first half went to another thing? Remembers it either way. */
export function secondTapOnOther(key: string): boolean {
  const p = lastPressed;
  if (!p || performance.now() - p.at > 1000) return false;
  const prev = lastRun;
  lastRun = { key, at: p.at, x: p.x, y: p.y };
  if (!prev || prev.key === key) return false;
  if (p.at - prev.at < DOUBLE_TAP_MS && Math.hypot(p.x - prev.x, p.y - prev.y) < DOUBLE_TAP_PX) {
    lastRun = prev;
    return true;
  }
  return false;
}
/** Mark the button tapped just now as working. Returns the function that takes the mark off. */
export function markPressed(): () => void {
  const p = lastPressed;
  if (!p || performance.now() - p.at > 1000 || !p.el.isConnected) return () => {};
  const el = p.el;
  el.setAttribute('data-tap-wait', '');
  el.setAttribute('aria-busy', 'true');
  return () => {
    el.removeAttribute('data-tap-wait');
    el.removeAttribute('aria-busy');
  };
}

/**
 * The root of a screen's instant taps. `data` is what the server sent, `reload` loads it again. Gives back the data with every tap still
 * waiting already drawn in, and the store for <InstantContext.Provider> (null when off: then `view` is `data` itself).
 */
export function useInstantRoot<T>(on: boolean, data: T | null, reload: () => Promise<unknown>, tracker: LoadTracker): { view: T | null; store: InstantStore<T> | null } {
  const toast = useToast();
  const [tick, setTick] = useState(0);
  const reloadRef = useRef(reload);
  reloadRef.current = reload;
  tracker.on = on;
  const line = useRef(new SaveLine()).current;
  const queue = useRef<TapQueue<Patch<T>> | null>(null);
  if (!queue.current) queue.current = new TapQueue<Patch<T>>(() => setTick((n) => n + 1), () => reloadRef.current(), tracker, line);
  const q = queue.current;
  useEffect(() => () => q.dispose(), [q]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const view = useMemo(() => (on && data !== null && q.size > 0 ? drawPatches(data, q.patches()) : data), [data, tick, on]);
  const store = useMemo<InstantStore<T>>(
    () => ({
      line,
      tracker,
      busy: (key) => q.busy(key),
      run: async <R,>(tap: InstantTap<R, T>) => {
        if (q.busy(tap.key) || secondTapOnOther(tap.key)) return { status: 'ignored' } as TapResult<R>;
        const unmark = tap.patch ? () => {} : markPressed();
        const res = await q.run<R>({ key: tap.key, patch: tap.patch ?? null, save: tap.save });
        unmark();
        if (res.status === 'ok') {
          const msg = typeof tap.saved === 'function' ? tap.saved(res.value) : tap.saved;
          if (msg) toast(msg);
        } else if (res.status === 'failed' && !tap.quietFail) {
          if (isDemo(res.error)) toast((res.error as Error).message);
          else toast(failureWords(res.error, tap.what), 'error');
        }
        return res;
      },
    }),
    [q, line, tracker, toast],
  );
  // A fresh object on each change, so buttons that read busy() redraw.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const live = useMemo(() => ({ ...store }), [store, tick]);
  return { view, store: on ? live : null };
}
