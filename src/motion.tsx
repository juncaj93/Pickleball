// Motion for the player screens: the tiny JavaScript half. The look lives in motion.css.
//
// One switch, MOTION (server/motion.ts). Off = every function here does nothing and the site behaves exactly as it
// did before. On = the player screens set <html data-motion="on">, and motion.css only styles under that.
// Nothing here can hold up a tap, a save or the 5-second refresh: it only adds classes and plays short animations
// on top of what the screen already shows.

import { type RefObject, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { motionTest, storageGet, storageSet } from './lib';

// ---------- The switch ----------

const SEEN_KEY = 'pb_motion_seen';
let current = false;
const listeners = new Set<() => void>();

export const motionOn = () => current;

/** Turn the motion on or off for the screens (sets <html data-motion>). Safe to call again and again. */
export function setMotion(on: boolean) {
  if (on === current) return;
  current = on;
  if (typeof document !== 'undefined') {
    if (on) document.documentElement.setAttribute('data-motion', 'on');
    else document.documentElement.removeAttribute('data-motion');
  }
  listeners.forEach((l) => l());
}

/** What this phone last heard from the server (so the loading skeleton can already follow it), or the private test switch. */
export const rememberedMotion = () => motionTest() || storageGet(SEEN_KEY) === 'on';
export const rememberMotion = (on: boolean) => storageSet(SEEN_KEY, on ? 'on' : 'off');

/** Re-renders when the switch flips. */
export function useMotion(): boolean {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => current,
    () => false,
  );
}

export const reducedMotion = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
/** Movement allowed right now? */
export const canMove = () => current && !reducedMotion();

// ---------- Small helpers ----------

/** True for `ms` after `value` changes. Never on the first render, so nothing plays on page load. */
export function useJustChanged(value: unknown, ms = 700): boolean {
  const prev = useRef(value);
  const [on, setOn] = useState(false);
  // A layout effect: the class is there before the first paint of the change, so nothing flashes at full size first.
  useLayoutEffect(() => {
    if (Object.is(prev.current, value)) return undefined;
    prev.current = value;
    if (!current) return undefined;
    setOn(true);
    const t = setTimeout(() => setOn(false), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return on;
}

/** Keeps something on screen for `ms` after it goes away, so it can fade out. Gives the last value while leaving. */
export function useLingering<T>(value: T | null | undefined, ms = 220): { value: T | null; leaving: boolean } {
  const last = useRef<T | null>(null);
  const [leaving, setLeaving] = useState(false);
  const had = useRef(false);
  if (value != null) last.current = value;
  // A layout effect: no frame in between where the chip is gone and the fading copy is not there yet.
  useLayoutEffect(() => {
    if (value != null) {
      had.current = true;
      setLeaving(false);
      return undefined;
    }
    if (!had.current || !canMove()) {
      last.current = null;
      return undefined;
    }
    had.current = false;
    setLeaving(true);
    const t = setTimeout(() => {
      setLeaving(false);
      last.current = null;
    }, ms);
    return () => clearTimeout(t);
  }, [value == null, ms]); // eslint-disable-line react-hooks/exhaustive-deps
  return { value: value ?? (leaving ? last.current : null), leaving: value == null && leaving };
}

// ---------- Numbers that roll ----------

const ROLL_MS = 240;

/**
 * One number that rolls (scoreboard style) when it changes: up when it grows, down when it shrinks. The real value
 * is always the text in the page (the old number is drawn by CSS from data-old), so reading the screen, copying it
 * and the tests all see only the new number.
 */
function RollNum({ value }: { value: string }) {
  const prev = useRef(value);
  const [roll, setRoll] = useState<{ old: string; dir: 'up' | 'down' } | null>(null);
  useEffect(() => {
    if (prev.current === value) return undefined;
    const old = prev.current;
    prev.current = value;
    if (!canMove()) return undefined;
    const a = Number(old.replace(/,/g, ''));
    const b = Number(value.replace(/,/g, ''));
    setRoll({ old, dir: b >= a ? 'up' : 'down' });
    const t = setTimeout(() => setRoll(null), ROLL_MS + 40);
    return () => clearTimeout(t);
  }, [value]);
  if (!roll) return <>{value}</>;
  return (
    <span className="m-roll" data-roll={roll.dir} data-old={roll.old}>
      <span className="m-roll-new">{value}</span>
    </span>
  );
}

/**
 * Text where any number that changed rolls. With the motion off it is just the text, exactly as before.
 * Use it for counts and money: "3 of 4 in", "$11 due", "Credit $3 used".
 */
export function RollText({ text }: { text: string }) {
  const on = useMotion();
  if (!on) return <>{text}</>;
  const parts = text.split(/(\d[\d,]*)/);
  return (
    <>
      {parts.map((p, i) => (i % 2 === 1 ? <RollNum key={i} value={p} /> : p))}
    </>
  );
}

// ---------- The "I'm in" button becoming the status chip (and back) ----------

type Snap = { kind: 'join' | 'owe' | 'paid' | 'credit'; w: number; bg: string; color: string; at: number; pay: HTMLElement | null; payBox: { x: number; y: number; w: number; h: number } | null };

const CONTROL = '[data-join],[data-owe],[data-paid],[data-credit-used]';
const kindOf = (el: HTMLElement): Snap['kind'] => (el.hasAttribute('data-join') ? 'join' : el.hasAttribute('data-owe') ? 'owe' : el.hasAttribute('data-paid') ? 'paid' : 'credit');
/** A morph waits this long for the server's answer (the card draws I'm in at once; the amount arrives a moment later). */
const MORPH_WAIT_MS = 2500;
const MORPH_MS = 220;

/**
 * The card's one status control: the "I'm in" button, then the chip ("$11 due", "Paid $11"). When it changes kind
 * (I'm in, Paid, Drop out) the new one eases its width and colors over about 220 ms from what the old one looked like.
 * The Pay button that goes away scales away; the one that arrives scales in (CSS, motion.css). Only a change plays.
 */
export function useStatusMorph(row: RefObject<HTMLElement | null>) {
  const prev = useRef<Snap | null>(null);
  useLayoutEffect(() => {
    const root = row.current;
    if (!root || !current) {
      prev.current = null;
      return;
    }
    const el = root.querySelector<HTMLElement>(CONTROL);
    const pay = root.querySelector<HTMLElement>('.pay-btn');
    const was = prev.current;
    if (!el) {
      // Nothing to show for a moment (I'm in drawn at once, the amount not here yet): keep what it looked like.
      if (was && Date.now() - was.at > MORPH_WAIT_MS) prev.current = null;
      return;
    }
    const cs = getComputedStyle(el);
    const box = el.getBoundingClientRect();
    const rootBox = root.getBoundingClientRect();
    const now: Snap = { kind: kindOf(el), w: box.width, bg: cs.backgroundColor, color: cs.color, at: Date.now(), pay: null, payBox: null };
    if (pay) {
      const b = pay.getBoundingClientRect();
      now.pay = pay.cloneNode(true) as HTMLElement;
      now.payBox = { x: b.left - rootBox.left, y: b.top - rootBox.top, w: b.width, h: b.height };
    }
    prev.current = now;
    if (!was || was.kind === now.kind || Date.now() - was.at > MORPH_WAIT_MS || !canMove()) return;
    // The new control starts looking like the old one and eases to its own look.
    el.classList.add('m-morphing');
    const anim = el.animate(
      [
        { width: `${was.w}px`, backgroundColor: was.bg, color: was.color },
        { width: `${now.w}px`, backgroundColor: now.bg, color: now.color },
      ],
      { duration: MORPH_MS, easing: 'cubic-bezier(.22,.9,.3,1)' },
    );
    anim.onfinish = anim.oncancel = () => el.classList.remove('m-morphing');
    // The Pay button that is gone scales away where it was.
    if (was.pay && was.payBox && !pay) {
      const ghost = was.pay;
      ghost.classList.add('m-ghost');
      ghost.setAttribute('aria-hidden', 'true');
      ghost.setAttribute('tabindex', '-1');
      ghost.removeAttribute('href');
      Object.assign(ghost.style, { position: 'absolute', left: `${was.payBox.x}px`, top: `${was.payBox.y}px`, width: `${was.payBox.w}px`, height: `${was.payBox.h}px`, margin: '0', pointerEvents: 'none' });
      root.appendChild(ghost);
      const out = ghost.animate([{ transform: 'scale(1)', opacity: 1 }, { transform: 'scale(.6)', opacity: 0 }], { duration: 160, easing: 'cubic-bezier(.22,.9,.3,1)' });
      out.onfinish = out.oncancel = () => ghost.remove();
    }
  });
}

// ---------- Pull to refresh ----------

const PULL_MAX = 34;
const PULL_TRIGGER = 64;

/**
 * Pull the list down (at the very top of the page) to see a spinning pickleball; let go and it refreshes at once.
 * Touch only. It starts only when the page is scrolled to the top and the finger is moving down, never while a
 * sheet is open or when the touch began on a field, and it never touches the 5-second refresh (it just asks for one
 * more look). `ball` and `shift` are written straight onto the elements, so React redraws nothing while pulling.
 */
export function usePullToRefresh({ enabled, onRefresh, ball, shift }: { enabled: boolean; onRefresh: () => Promise<unknown> | void; ball: RefObject<HTMLElement | null>; shift: RefObject<HTMLElement | null> }) {
  const refresh = useRef(onRefresh);
  refresh.current = onRefresh;
  useEffect(() => {
    if (!enabled) return undefined;
    let startY = 0;
    let startX = 0;
    let pulling = false;
    let tracking = false;
    let dist = 0;
    const apply = (d: number, animate: boolean) => {
      const b = ball.current;
      const s = shift.current;
      const shown = Math.min(PULL_MAX, d * 0.5);
      if (s) {
        s.style.transition = animate ? 'transform 160ms cubic-bezier(.22,.9,.3,1)' : 'none';
        s.style.transform = shown > 0 ? `translateY(${shown}px)` : '';
      }
      if (b) {
        b.style.transition = animate ? 'opacity 160ms ease, transform 160ms ease' : 'none';
        const k = Math.min(1, d / PULL_TRIGGER);
        b.style.opacity = shown > 0 ? String(0.25 + 0.75 * k) : '0';
        b.style.transform = `rotate(${d * 3}deg) scale(${0.7 + 0.3 * k})`;
        b.classList.toggle('m-ptr-spin', d >= PULL_TRIGGER);
      }
      if (animate && s) {
        const done = () => {
          s.style.transition = '';
          s.style.transform = '';
        };
        setTimeout(done, 200);
      }
    };
    const blocked = (t: EventTarget | null) => document.querySelector('dialog[open]') !== null || (t instanceof Element && !!t.closest('input, textarea, select, [contenteditable], .pop'));
    const onStart = (e: TouchEvent) => {
      tracking = false;
      pulling = false;
      dist = 0;
      if (e.touches.length !== 1 || window.scrollY > 0 || blocked(e.target)) return;
      startY = e.touches[0].clientY;
      startX = e.touches[0].clientX;
      tracking = true;
      // The listener that can stop the browser's own scroll exists only for the length of a touch that could be a pull.
      window.addEventListener('touchmove', onMove, { passive: false });
    };
    const onMove = (e: TouchEvent) => {
      if (!tracking) return;
      if (e.touches.length !== 1 || window.scrollY > 0) {
        if (pulling) apply(0, true);
        tracking = pulling = false;
        return;
      }
      const dy = e.touches[0].clientY - startY;
      const dx = e.touches[0].clientX - startX;
      if (!pulling) {
        // Decide once: a clear downward pull. Anything else is the normal scroll.
        if (dy < 10 || Math.abs(dx) > dy) {
          if (dy < -4) tracking = false;
          return;
        }
        pulling = true;
      }
      if (e.cancelable) e.preventDefault(); // no rubber band on top of ours
      dist = dy;
      apply(dist, false);
    };
    const onEnd = () => {
      window.removeEventListener('touchmove', onMove);
      if (!tracking) return;
      const go = pulling && dist >= PULL_TRIGGER;
      tracking = false;
      if (pulling) apply(0, true);
      pulling = false;
      if (go) void Promise.resolve(refresh.current()).catch(() => {});
    };
    window.addEventListener('touchstart', onStart, { passive: true });
    window.addEventListener('touchend', onEnd, { passive: true });
    window.addEventListener('touchcancel', onEnd, { passive: true });
    return () => {
      window.removeEventListener('touchstart', onStart);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onEnd);
      window.removeEventListener('touchcancel', onEnd);
      apply(0, false);
    };
  }, [enabled, ball, shift]);
}
