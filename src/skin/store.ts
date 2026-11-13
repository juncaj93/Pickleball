// Zip 38, Christmas skin: the one place that knows whether the theme is available and on. Plain module state read through
// useSyncExternalStore, so a toast or a seat marker deep in the tree can ask without a provider. The state is only ever set while the
// PLAYER Home screen is mounted (src/skin/useSkinRoot.ts clears it on the way out), so the admin screens never see "on".
//
//   mode    'all'  Everyone: inside the window the Christmas logo shows, theme on or off, with the two bubbles; this phone remembers its choice.
//           'me'   Just me (the organizer's own player only): the NORMAL logo is the tap, no bubbles, the choice is kept on the server.
//           'off'  nothing.
//   on      the theme choice (starts off). Only counts while mode is not 'off'.
//   phase   'in' for a moment after a tap turns it ON (pop-in), 'out' after a tap turns it OFF (the balls spin back), else idle.
//           Never anything but idle with "reduce motion" on a phone.
//   bubble  which speech bubble under the logo is showing right now (Everyone only).
import { useSyncExternalStore } from 'react';
import { BUBBLE_MS, readTheme, takeFirstOnHint, takeFirstVisitHint, writeTheme, type Memory, type SkinMode } from '../../shared/christmasSkin';

export type SkinPhase = 'idle' | 'in' | 'out';
export type SkinBubble = null | 'first' | 'back';
export interface SkinState {
  mode: SkinMode;
  on: boolean;
  phase: SkinPhase;
  /** Counts up with every tap on the logo (a new tap restarts the motion even if the phase name repeats). */
  seq: number;
  bubble: SkinBubble;
}

const IDLE: SkinState = { mode: 'off', on: false, phase: 'idle', seq: 0, bubble: null };
let state: SkinState = IDLE;
let demo = false;
/** The first-visit bubble was already shown in this page load (a phone that blocks storage cannot remember it, so this keeps it to once). */
let hintShown = false;
let backShown = false;
/** Just me: saves the organizer's theme choice on the server (set by src/skin/useSkinRoot.ts). */
let mePersist: ((on: boolean) => void) | null = null;
let timers: ReturnType<typeof setTimeout>[] = [];
const listeners = new Set<() => void>();

/** How long the html marker for the pop-in and the spin-back stays (it only drives the logo pop and the snow cap; each ornament times its own motion). */
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
  if (state.mode !== 'off' && state.on) root.setAttribute('data-skin', 'christmas');
  else root.removeAttribute('data-skin');
  if (state.mode !== 'off' && state.phase !== 'idle') root.setAttribute('data-skin-anim', state.phase);
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

/** Just me: how the theme choice is saved on the server. */
export function setMePersist(fn: ((on: boolean) => void) | null) {
  mePersist = fn;
}

/**
 * The server's answer for this screen. Called on every refresh; it only does something when the mode changes.
 * `isDemo` = the organizer's "View as" copy: no bubble, nothing remembered, the theme starts off. `meOn` = Just me: the saved theme choice.
 */
export function setSkinAvailable(mode: SkinMode, isDemo: boolean, meOn = false) {
  if (mode === state.mode && isDemo === demo) return;
  demo = isDemo;
  clearTimers();
  if (mode === 'off') {
    emit(IDLE);
    return;
  }
  if (mode === 'me') {
    emit({ mode, on: meOn, phase: 'idle', seq: state.seq, bubble: null });
    return;
  }
  const on = isDemo ? false : readTheme(memory);
  const hint = !isDemo && !on && !hintShown && takeFirstVisitHint(memory);
  if (hint) hintShown = true;
  emit({ mode, on, phase: 'idle', seq: state.seq, bubble: hint ? 'first' : null });
  if (hint) {
    later(BUBBLE_MS, () => state.bubble === 'first' && emit({ ...state, bubble: null }));
    closeOnTap();
  }
}

/** Tap on the logo. */
export function toggleSkin() {
  if (state.mode === 'off') return;
  const on = !state.on;
  if (state.mode === 'all' && !demo) writeTheme(memory, on);
  if (state.mode === 'me') mePersist?.(on);
  clearTimers();
  const still = reducedMotion();
  // "Tap to switch back" shows only the first time the theme is turned ON on a phone (Everyone only, never in View as).
  const back = on && state.mode === 'all' && !demo && !backShown && takeFirstOnHint(memory);
  if (back) backShown = true;
  emit({ ...state, on, phase: still ? 'idle' : on ? 'in' : 'out', seq: state.seq + 1, bubble: back ? 'back' : null });
  if (!still) later(on ? IN_MS : OUT_MS, () => emit({ ...state, phase: 'idle' }));
  if (back) later(BUBBLE_MS, () => state.bubble === 'back' && emit({ ...state, bubble: null }));
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
export const useSkinOn = (): boolean => useSyncExternalStore(subscribe, () => state.mode !== 'off' && state.on, () => false);
export const skinOnNow = () => state.mode !== 'off' && state.on;
/** The whole state right now (for tests). */
export const skinStateNow = (): SkinState => state;
