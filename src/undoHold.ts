// Undo on admin toasts (ADMIN_UNDO, Zip 13). The "wait 5 seconds before saving" part, in one place.
//
// In plain words: a tap with Undo is drawn on screen at once (the instant-tap patch), but its save is held here for 5 seconds. Undo in that
// time drops it: the save is never sent, so the database never hears of it (no record, no history line, no text or Telegram). After 5
// seconds, or as soon as the page is hidden or closed (the phone locked, the app switched), every held save is let go at once, so a tap is
// never lost. Pure TypeScript, unit tested.

import { ADMIN_UNDO_MS } from '../shared/zip13';

export interface Hold {
  /** true: send the save; false: Undo was tapped (send nothing). */
  readonly decided: Promise<boolean>;
  /** Undo. True if it was still waiting (nothing will be sent); false if it was already let go. */
  undo(): boolean;
  /** Let it go now (send the save). */
  release(): boolean;
}

const waiting = new Set<{ settle: (go: boolean) => boolean }>();

/** Hold one save for `ms` (5 seconds). */
export function startHold(ms = ADMIN_UNDO_MS): Hold {
  let resolve!: (go: boolean) => void;
  const decided = new Promise<boolean>((r) => (resolve = r));
  let done = false;
  const entry = {
    settle(go: boolean) {
      if (done) return false;
      done = true;
      clearTimeout(timer);
      waiting.delete(entry);
      resolve(go);
      return true;
    },
  };
  const timer = setTimeout(() => entry.settle(true), ms);
  waiting.add(entry);
  return { decided, undo: () => entry.settle(false), release: () => entry.settle(true) };
}

let leaving = false;
/**
 * True while held saves are being let go because the page is being hidden or closed: src/lib.ts api() then sends with keepalive (the
 * same way src/hold.ts sends a held Remove), so the request survives the page going away. Only ever true when a save was held, so with
 * the switch off nothing changes.
 */
export function leavingWithHolds(): boolean {
  return leaving;
}

/** Let every held save go now (the page is being hidden or left, or the screen is about to change who it acts as). */
export function releaseAllHolds(pageLeaving = false): void {
  if (pageLeaving && waiting.size > 0) leaving = true;
  for (const e of [...waiting]) e.settle(true);
}

/** How many saves are being held. */
export function heldCount(): number {
  return waiting.size;
}

// The taps whose save was held, until they are settled (saved, failed or undone). Lets a change of who the screen acts as (View as,
// Pretend, Sign out, your own player page) wait until every held save has really been sent as the organizer first.
const tracked = new Set<Promise<unknown>>();
/** Follow a held tap until it is settled. Returns the same promise. */
export function trackHeld<T>(p: Promise<T>): Promise<T> {
  tracked.add(p);
  const drop = () => void tracked.delete(p);
  p.then(drop, drop);
  return p;
}

/** Let every held save go now and wait until each one has answered. */
export async function flushHolds(): Promise<void> {
  releaseAllHolds();
  while (tracked.size > 0) await Promise.allSettled([...tracked]);
}

/**
 * Run `fn` once no save is held or still on its way from a hold (at once, in the same tick, when there is none: with the switch off nothing
 * changes). Used before anything that changes who the next save acts as.
 */
export function afterHolds(fn: () => void): void {
  if (waiting.size === 0 && tracked.size === 0) return fn();
  void flushHolds().then(fn, fn);
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') releaseAllHolds(true);
    else leaving = false;
  });
  window.addEventListener('pagehide', () => releaseAllHolds(true));
}
