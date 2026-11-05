import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import './instant-taps.css';
import { demoOn, isDemo, viewingAs } from './lib';
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
  /** Show the tapped button working even though a patch is drawn too (the patch only moves something elsewhere). */
  press?: boolean;
  /** The words for a failure, when the caller knows better (part of a multi-game save went through). Return null for the usual words. */
  failText?: (err: unknown) => string | null;
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

// ---------- A double tap never lands on the next button ----------
// A tap is drawn at once, so the screen can change under the finger (I paid takes the Pay card away and the next card slides up; a paid
// Money row moves). The second half of a quick double tap then lands on a DIFFERENT button: it must not count (it could join a game,
// pay or drop the wrong person). While instant taps is on, a click within 400 ms and 24 px of the click before it, on another button,
// is stopped before the page sees it. Keyboard clicks (no pointer position) are never stopped. The same idea as ui.tsx DOUBLE_TAP.
const DOUBLE_TAP_MS = 400;
const DOUBLE_TAP_PX = 24;
let guards = 0;
let lastClick: { el: Element; at: number; x: number; y: number } | null = null;
if (typeof document !== 'undefined') {
  document.addEventListener(
    'click',
    (e) => {
      if (guards === 0 || e.detail === 0) return;
      const el = e.target instanceof Element ? e.target.closest('button, a, [role="button"], input, label') : null;
      if (!el) return;
      const prev = lastClick;
      const now = performance.now();
      // A label and the switch inside it are one control (the browser clicks the switch for the label).
      const same = prev && (prev.el === el || prev.el.contains(el) || el.contains(prev.el) || (prev.el instanceof HTMLLabelElement && prev.el.control === el));
      if (prev && !same && now - prev.at < DOUBLE_TAP_MS && Math.hypot(e.clientX - prev.x, e.clientY - prev.y) < DOUBLE_TAP_PX) {
        e.preventDefault();
        e.stopImmediatePropagation();
        return;
      }
      lastClick = { el, at: now, x: e.clientX, y: e.clientY };
    },
    true,
  );
}
/** Turn the page-wide double-tap guard on while a screen with instant taps on is showing. */
function useDoubleTapGuard(on: boolean) {
  useEffect(() => {
    if (!on) return undefined;
    guards++;
    return () => {
      guards--;
    };
  }, [on]);
}

// ---------- The button that was tapped shows it is working ----------
// Where the server decides (a full game, fees, prices), nothing is drawn ahead; the button that was tapped gets a pressed look and a
// small spinner at once (the same frame as the tap), until the server answers. Found from the click itself, so every button gets it
// without each one being changed. Only ever set while instant taps is on (only the store calls it).
let lastPressed: { el: HTMLElement; at: number } | null = null;
if (typeof document !== 'undefined') {
  document.addEventListener(
    'click',
    (e) => {
      const el = e.target instanceof Element ? e.target.closest<HTMLElement>('button, a.btn, [role="button"]') : null;
      lastPressed = el ? { el, at: performance.now() } : null;
    },
    true,
  );
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

/** What the next save would act as (View as, the demo copy): a save that waited in line is not sent if this changed meanwhile. */
let whoChanges = 0;
/** The phone is switching names ("Not you?"): a save still waiting in line was tapped as the old name, so it is not sent. */
export function actingWhoChanged() {
  whoChanges++;
}
const actingAs = () => `${demoOn() ? 'demo' : 'live'}|${viewingAs() ?? ''}|${whoChanges}`;

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
  // Watch the loads while mounted (attached again after React StrictMode's practice unmount).
  useEffect(() => {
    q.attach();
    return () => q.dispose();
  }, [q]);
  useDoubleTapGuard(on);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const view = useMemo(() => (on && data !== null && q.size > 0 ? drawPatches(data, q.patches()) : data), [data, tick, on]);
  const store = useMemo<InstantStore<T>>(
    () => ({
      line,
      tracker,
      busy: (key) => q.busy(key),
      run: async <R,>(tap: InstantTap<R, T>) => {
        if (q.busy(tap.key)) return { status: 'ignored' } as TapResult<R>;
        const unmark = tap.patch && !tap.press ? () => {} : markPressed();
        // Who this tap acts as, now. If the save waits in line and the screen changes meanwhile (View as ended, another name), it is not sent.
        const as = actingAs();
        const save = () => (actingAs() === as ? tap.save() : Promise.reject(Object.assign(new Error('Nothing was sent: the screen changed before it could save.'), { status: 409 })));
        const res = await q.run<R>({ key: tap.key, patch: tap.patch ?? null, save });
        unmark();
        if (res.status === 'ok') {
          const msg = typeof tap.saved === 'function' ? tap.saved(res.value) : tap.saved;
          if (msg) toast(msg);
        } else if (res.status === 'failed' && !tap.quietFail) {
          if (isDemo(res.error)) toast((res.error as Error).message);
          else toast(tap.failText?.(res.error) ?? failureWords(res.error, tap.what), 'error');
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
