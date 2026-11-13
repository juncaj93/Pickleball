// Zip 38, Christmas skin: the one place that knows whether the theme is available and on. Plain module state read through
// useSyncExternalStore, so a toast or a seat marker deep in the tree can ask without a provider. The state is only ever set while the
// PLAYER Home screen is mounted (src/skin/useSkinRoot.ts clears it on the way out), so the admin screens never see "on".
//
//   inWindow  the server said "christmasSkin": switch on for this phone AND today inside the window (shared/christmasSkin.ts). The
//             Christmas logo shows whenever this is true, theme on or off.
//   on        this phone's theme choice (starts off; remembered). Only counts while inWindow.
//   phase     'in' for a moment after a tap turns it ON (pop-in motion), 'out' after a tap turns it OFF (the balls spin back), else idle.
//             Never anything but idle with "reduce motion" on a phone.
//   bubble    which speech bubble under the logo is showing right now.
import { useSyncExternalStore } from 'react';
import { BUBBLE_MS, readTheme, takeFirstVisitHint, writeTheme, type Memory } from '../../shared/christmasSkin';

export type SkinPhase = 'idle' | 'in' | 'out';
export type SkinBubble = null | 'first' | 'back';
export interface SkinState {
  inWindow: boolean;
  on: boolean;
  phase: SkinPhase;
  /** Counts up with every tap on the logo (a new tap restarts the motion even if the phase name repeats). */
  seq: number;
  bubble: SkinBubble;
}

const IDLE: SkinState = { inWindow: false, on: false, phase: 'idle', seq: 0, bubble: null };
let state: SkinState = IDLE;
let demo = false;
let timers: ReturnType<typeof setTimeout>[] = [];
const listeners = new Set<() => void>();

/** The motion lengths (ms): how long the html marker for the pop-in and the spin-back stays. Longer than the longest piece of the motion. */
export const IN_MS = 1700;
export const OUT_MS = 700;

/** This phone's memory (every call wrapped: a phone that blocks storage never crashes, it just forgets). */
const memory: Memory = {
  get: (k) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k, v) => {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* private mode or blocked: forget */
    }
  },
};

export function reducedMotion(): boolean {
  try {
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

function paint() {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (state.inWindow && state.on) root.setAttribute('data-skin', 'christmas');
  else root.removeAttribute('data-skin');
  if (state.inWindow && state.phase !== 'idle') root.setAttribute('data-skin-anim', state.phase);
  else root.removeAttribute('data-skin-anim');
}

function emit(next: SkinState) {
  state = next;
  paint();
  listeners.forEach((l) => l());
}

function later(ms: number, fn: () => void) {
  timers.push(setTimeout(fn, ms));
}
function clearTimers() {
  timers.forEach(clearTimeout);
  timers = [];
}

/** Any tap anywhere closes the first-visit bubble. */
function closeOnTap() {
  if (typeof document === 'undefined') return;
  const close = () => {
    document.removeEventListener('pointerdown', close, true);
    if (state.bubble === 'first') emit({ ...state, bubble: null });
  };
  document.addEventListener('pointerdown', close, true);
}

/**
 * The server's answer for this screen. Called on every refresh; it only does something when the answer changes.
 * `isDemo` = the organizer's "View as" copy: no first-visit bubble, nothing remembered, the theme starts off.
 */
export function setSkinAvailable(available: boolean, isDemo: boolean) {
  if (available === state.inWindow && isDemo === demo) return;
  demo = isDemo;
  clearTimers();
  if (!available) {
    emit(IDLE);
    return;
  }
  const on = isDemo ? false : readTheme(memory);
  const hint = !isDemo && !on && takeFirstVisitHint(memory);
  emit({ inWindow: true, on, phase: 'idle', seq: state.seq, bubble: hint ? 'first' : null });
  if (hint) {
    later(BUBBLE_MS, () => state.bubble === 'first' && emit({ ...state, bubble: null }));
    closeOnTap();
  }
}

/** Tap on the logo. */
export function toggleSkin() {
  if (!state.inWindow) return;
  const on = !state.on;
  if (!demo) writeTheme(memory, on);
  clearTimers();
  const still = reducedMotion();
  emit({ ...state, on, phase: still ? 'idle' : on ? 'in' : 'out', seq: state.seq + 1, bubble: on ? 'back' : null });
  if (!still) later(on ? IN_MS : OUT_MS, () => emit({ ...state, phase: 'idle' }));
  if (on) later(BUBBLE_MS, () => state.bubble === 'back' && emit({ ...state, bubble: null }));
}

/** The Home screen went away (admin, another page): nothing of the theme is left behind. */
export function resetSkin() {
  clearTimers();
  demo = false;
  if (state !== IDLE) emit(IDLE);
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

export const useSkin = (): SkinState => useSyncExternalStore(subscribe, () => state, () => IDLE);
/** The theme is showing right now (available AND on). */
export const useSkinOn = (): boolean => useSyncExternalStore(subscribe, () => state.inWindow && state.on, () => false);
export const skinOnNow = () => state.inWindow && state.on;
