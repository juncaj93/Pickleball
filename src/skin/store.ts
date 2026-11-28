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
import { BUBBLE_MS, EARLY_ATTR, readTheme, takeFirstOnHint, takeFirstVisitHint, writeMode, writeTheme, type Memory, type SkinMode } from '../../shared/christmasSkin';

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

/**
 * Zip 102: what public/theme-2.js decided before the page drew. On a player Home address, inside the window, it leaves data-skin-early =
 * "all-on" / "all-off" / "me-on" / "me-off" (this phone's last answer) and data-skin="christmas" only when the theme is ON. The store starts
 * from it, so the first screen (the loading shimmer or the saved last screen) already draws the Christmas logo (Everyone) and, theme ON, the
 * theme, and nothing pops in when the games arrive. No pop-in on this start (phase idle). Anything else: IDLE, as before.
 */
function earlyState(): SkinState {
  try {
    if (typeof document === 'undefined') return IDLE;
    const root = document.documentElement;
    const m = /^(all|me)-(on|off)$/.exec(root.getAttribute(EARLY_ATTR) ?? '');
    const dressed = root.getAttribute('data-skin') === 'christmas';
    if (m && dressed === (m[2] === 'on')) return { mode: m[1] as 'all' | 'me', on: dressed, phase: 'idle', seq: 0, bubble: null };
    // Nothing from the early script, or markers that do not agree (never written that way): the page starts plain.
    root.removeAttribute(EARLY_ATTR);
    if (dressed) root.removeAttribute('data-skin');
  } catch {
    /* nothing to start from */
  }
  return IDLE;
}

let state: SkinState = earlyState();
/** True until the first real answer from the server: the state above came from this phone's memory, not from the server. */
let fromMemory = state !== IDLE;
let demo = false;
/** Whether this screen's answers may be written down for the next first paint (the player's own phone: not View as, the demo or Pretend). */
let remember = false;
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
  root.removeAttribute(EARLY_ATTR);
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
export function setSkinAvailable(mode: SkinMode, isDemo: boolean, meOn = false, rememberIt = false) {
  parked = null;
  remember = rememberIt && !isDemo;
  // Zip 102: written down for the next page open's first paint (only when it changed, so a refresh every 5 seconds writes nothing).
  if (remember) rememberMode(mode, meOn);
  const early = fromMemory;
  fromMemory = false;
  // The first answer after a first paint from memory. The same mode: nothing moves, except Just me following the server's saved choice (another
  // phone may have tapped it), quietly. A different mode (Off, the window over, Just me on another player): the normal path below, quietly too.
  if (early && mode === state.mode && !isDemo) {
    demo = false;
    const on = mode === 'me' ? meOn : readTheme(memory);
    if (on !== state.on) emit({ ...state, on, phase: 'idle', bubble: null });
    return;
  }
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
  if (state.mode === 'me' && remember) rememberMode('me', on);
  clearTimers();
  const still = reducedMotion();
  // "Tap to switch back" shows only the first time the theme is turned ON on a phone (Everyone only, never in View as).
  const back = on && state.mode === 'all' && !demo && !backShown && takeFirstOnHint(memory);
  if (back) backShown = true;
  emit({ ...state, on, phase: still ? 'idle' : on ? 'in' : 'out', seq: state.seq + 1, bubble: back ? 'back' : null });
  if (!still) later(on ? IN_MS : OUT_MS, () => emit({ ...state, phase: 'idle' }));
  if (back) later(BUBBLE_MS, () => state.bubble === 'back' && emit({ ...state, bubble: null }));
}

/** Zip 102: the last mode written down in this page load (null = not yet), so the same answer is never written twice. */
let written: string | null = null;
function rememberMode(mode: SkinMode, meOn: boolean) {
  const key = mode === 'me' ? `me-${meOn ? 'on' : 'off'}` : mode;
  if (key === written) return;
  written = key;
  writeMode(memory, mode, meOn);
}

/** The Home screen went away (admin, another page): nothing of the theme is left behind. */
export function resetSkin(keepEarly = true) {
  clearTimers();
  demo = false;
  remember = false;
  // Left before the server ever answered: the start from memory is kept aside, so a player Home that comes back (React's strict mode runs a
  // screen's setup twice in development) starts from it again (resumeEarly). Once an answer came, nothing is kept.
  parked = keepEarly && fromMemory ? state : null;
  fromMemory = false;
  if (state !== IDLE) emit(IDLE);
  else paint();
}

let parked: SkinState | null = null;
/** Zip 102: the player Home is on screen and the server has not answered yet: start again from this phone's memory if it was put aside. */
export function resumeEarly(isDemo = false) {
  // Never into View as or the demo (an organizer screen): the memory is this phone's own player Home only.
  if (isDemo) parked = null;
  if (!parked || state !== IDLE) return;
  const back = parked;
  parked = null;
  fromMemory = true;
  emit(back);
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
