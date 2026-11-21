// Zip 79 (🎾79.results skills), part 2: the level up (videos skills/02 light and 03 dark; timings from Alex's approved Zip 65 mock). Only when a
// player who played before picks a level HIGHER than their previous one, Next plays it over the dimmed, blurred Sign up sheet, then the sheet goes
// on to the dates. A centered card: the big number in the body font, heavy, counts up in 0.1 steps from the previous level (the ticks speed up,
// a small bump on each, about 1.5 s; a big jump skips steps so it never drags), then lands: a flash, two thin rings, a few light streaks, a short
// shake, the number turns gold and a solid gold LEVEL UP banner slides up at the bottom of the card. About 3 s; a tap anywhere skips it. Reduced
// motion: the final card for about 1 s. No confetti. Only the player's own pick shows (never the organizer's level). Part of the tournament
// card's own download.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { levelLabel } from '../../shared/tournament';
import { openLayer } from '../backStack';
import './levelup.css';

import { COUNT_FROM_MS, COUNT_MS, countSteps, LEVEL_UP_CALM_MS, LEVEL_UP_MS, tickTimes } from '../../shared/levelUp';

const reduced = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** The streaks' angles (degrees) and lengths (px): a few light lines out from the number when it lands. */
const STREAKS = [
  { a: -160, l: 46 },
  { a: -120, l: 34 },
  { a: -60, l: 40 },
  { a: -20, l: 50 },
  { a: 25, l: 38 },
  { a: 70, l: 30 },
  { a: 115, l: 44 },
  { a: 160, l: 34 },
];

export function LevelUp({ from, to, onDone }: { from: number; to: number; onDone: () => void }) {
  const calm = useRef(reduced()).current;
  const steps = useRef(countSteps(from, to)).current;
  const [i, setI] = useState(calm ? steps.length - 1 : 0);
  const [landed, setLanded] = useState(calm);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  const finished = useRef(false);
  const finish = () => {
    if (finished.current) return;
    finished.current = true;
    doneRef.current();
  };
  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    if (calm) {
      timers.push(setTimeout(finish, LEVEL_UP_CALM_MS));
    } else {
      tickTimes(steps.length - 1).forEach((at, k) => {
        timers.push(
          setTimeout(() => {
            setI(k + 1);
            if (k === steps.length - 2) setLanded(true);
          }, at),
        );
      });
      if (steps.length === 1) timers.push(setTimeout(() => setLanded(true), COUNT_FROM_MS + COUNT_MS));
      timers.push(setTimeout(finish, LEVEL_UP_MS));
    }
    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Back (an edge swipe, Android's back) skips it to the dates step instead of closing the Sign up sheet: its own layer on top (src/backStack.ts).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => openLayer(finish), []);
  // A key or a tap skips it (Escape, Enter or Space too).
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        finish();
      }
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Its own modal dialog, so it sits over the Sign up sheet (itself a modal dialog in the page's top layer) and dims and blurs it.
  const dialogRef = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const d = dialogRef.current;
    if (d && !d.open && typeof d.showModal === 'function') {
      try {
        d.showModal();
      } catch {
        d.setAttribute('open', '');
      }
    }
    return () => {
      if (d?.open) d.close();
    };
  }, []);
  const label = levelLabel(to);
  const bump = Math.min(4, i);
  return createPortal(
    <dialog
      ref={dialogRef}
      className={`tm-lu${calm ? ' tm-lu-calm' : ''}${landed ? ' tm-lu-landed' : ''}`}
      aria-label={`Level up: ${label}`}
      onClick={finish}
      onCancel={(e) => {
        e.preventDefault();
        finish();
      }}
      data-tm-levelup
      data-to={to}
    >
      {!calm && <span className="tm-lu-flash" aria-hidden="true" />}
      <div className="tm-lu-card">
        <div className="tm-lu-stage">
          {!calm && (
            <span className="tm-lu-fx" aria-hidden="true">
              <span className="tm-lu-ring" />
              <span className="tm-lu-ring tm-lu-ring2" />
              {STREAKS.map((s, k) => (
                <span key={k} className="tm-lu-streak" style={{ ['--a' as string]: `${s.a}deg`, ['--l' as string]: `${s.l}px` }} />
              ))}
            </span>
          )}
          <span className="tm-lu-win">
            <span key={i} className={`tm-lu-num${i > 0 && !landed ? ` tm-lu-bump tm-lu-b${bump}` : ''}`} aria-hidden="true" data-tm-levelup-num>
              {steps[i]}
            </span>
          </span>
        </div>
        <p className="tm-lu-bar" aria-hidden={!landed}>
          Level up
        </p>
      </div>
      <span className="sr-only" aria-live="polite">
        {landed ? `Level up. ${label}.` : ''}
      </span>
    </dialog>,
    document.body,
  );
}
