// Zip 37, "Home Screen tip" (HOME_SCREEN_TIP, shared/homeScreenTip.ts). Players only, iPhone and iPad Safari only, never when the site is
// already running as a Home Screen app. ONE card at the top of Home (above THIS WEEK) from the second visit, and the steps sheet "Show me
// how" opens. Look only: nothing is saved on the server; the phone remembers (localStorage, every call wrapped, so a phone that blocks
// storage never crashes: the card then shows at most once per page load, and an X or "Got it" still hides it for that load).
// The card is its own small component built on the alert cards' shape (round icon, bold title, gray line, round X) with its own tokens
// (src/home-screen-tip.css), so a skin can restyle it by changing the `--hs-*` tokens, like the other alert cards.
import { useEffect, useRef, useState } from 'react';
import { isIosSafari, LONG_AGO_MS, SECOND_VISIT_MS, TIP_DONE_KEY, TIP_FIRST_KEY, TIP_STEPS, tipVerdict, type TipStep } from '../shared/homeScreenTip';
import type { GroupView } from '../shared/api';
import { storageGet, storageRemove, storageSet } from './lib';
import { Sheet } from './ui';
import './home-screen-tip.css';

// A test link for any phone (it only touches this phone's own memory; it changes nothing for anyone else):
//   ?hstip=now   pretend the first open was over 30 minutes ago and forget "never again": the card shows on the next Home load.
//   ?hstip=reset forget the first open and "never again": the phone is brand new again.
if (typeof window !== 'undefined') {
  const want = new URLSearchParams(window.location.search).get('hstip');
  if (want === 'now') {
    storageSet(TIP_FIRST_KEY, String(Date.now() - SECOND_VISIT_MS - 60_000));
    storageRemove(TIP_DONE_KEY);
  } else if (want === 'reset') {
    storageRemove(TIP_FIRST_KEY);
    storageRemove(TIP_DONE_KEY);
  }
  // Applied once: take the word out of the address so a reload (or finishing the steps) is not undone by it.
  if (want === 'now' || want === 'reset') {
    try {
      const u = new URL(window.location.href);
      u.searchParams.delete('hstip');
      window.history.replaceState(window.history.state, '', u.pathname + u.search + u.hash);
    } catch {
      /* the address stays as it is */
    }
  }
}

function readNumber(key: string): number | null {
  const raw = storageGet(key);
  if (raw === null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/** Opened from the Home Screen already (the old iOS flag, or the standard display mode). */
function isStandalone(): boolean {
  try {
    if ((navigator as Navigator & { standalone?: boolean }).standalone === true) return true;
    return typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches;
  } catch {
    return false;
  }
}

/**
 * Whether to draw the card. Decided ONCE per page load, the moment Home is on screen with a name picked and the switch on for this phone
 * (so a quick reload, a slow load or a name change never flips it, and nothing is written while the switch is off). `blocked`: View as,
 * the demo copy or Pretend (never). Returns what the screen needs and the two ways out (the X, and finishing the steps).
 */
export function useHomeScreenTip(g: GroupView | null, blocked: boolean): { visible: boolean; finish: () => void } {
  const [state, setState] = useState<'unknown' | 'hidden' | 'shown' | 'gone'>('unknown');
  // Did this phone already have a name picked when the page opened? (A player from before this shipped: past their first visit.)
  const knewName = useRef<boolean | null>(null);
  useEffect(() => {
    if (!g) return;
    if (knewName.current === null) knewName.current = !!g.me;
    if (state !== 'unknown' || blocked || !g.me || g.homeScreenTip !== true) return;
    const nowMs = Date.now();
    const verdict = tipVerdict({
      switchOn: true,
      onHome: true,
      demo: false,
      iosSafari: isIosSafari(navigator.userAgent, navigator.platform, navigator.maxTouchPoints),
      standalone: isStandalone(),
      done: storageGet(TIP_DONE_KEY) === '1',
      firstOpenMs: readNumber(TIP_FIRST_KEY),
      knewNameOnOpen: knewName.current === true,
      nowMs,
    });
    if (verdict.record === 'first') storageSet(TIP_FIRST_KEY, String(nowMs));
    else if (verdict.record === 'past') storageSet(TIP_FIRST_KEY, String(LONG_AGO_MS));
    setState(verdict.show ? 'shown' : 'hidden');
  }, [g, blocked, state]);
  const finish = () => {
    storageSet(TIP_DONE_KEY, '1');
    setState('gone');
  };
  return { visible: state === 'shown', finish };
}

/** The card (mock 1, layout B): round icon, title, gray line, a solid "Show me how" under the text, and the round X in the corner. */
export function HomeScreenTipCard({ onShow, onX }: { onShow: () => void; onX: () => void }) {
  return (
    <section className="hs-tip" aria-label="Add to Home Screen" data-hs-tip>
      <span className="hs-tip-icon" aria-hidden="true">
        <svg viewBox="0 0 22 22">
          <rect x="3.5" y="3.5" width="15" height="15" rx="3.5" />
          <path d="M11 7.5v7M7.5 11h7" />
        </svg>
      </span>
      <div className="hs-tip-main">
        <h3 className="hs-tip-title">Rather have this as an app?</h3>
        <p className="hs-tip-sub">Add it to your Home Screen</p>
        <button type="button" className="hs-tip-pill" onClick={onShow} data-hs-show>
          Show me how
        </button>
      </div>
      <button type="button" className="hs-tip-x" aria-label="Dismiss: add to Home Screen" onClick={onX} data-hs-x>
        <span className="hs-tip-x-ring" aria-hidden="true">
          <svg viewBox="0 0 14 14">
            <path d="M2 2l10 10M12 2L2 12" />
          </svg>
        </span>
      </button>
    </section>
  );
}

/** One picture with its ring. The ring is a fixed-pixel circle (never an oval); the last step outlines the whole row. */
function StepPicture({ step, children }: { step: TipStep; children: React.ReactNode }) {
  const ring = step.ring;
  return (
    <div className="hs-pic">
      {children}
      {'rowOutline' in ring ? (
        <span className="hs-ring hs-ring-row" aria-hidden="true" data-hs-ring="row" />
      ) : (
        <span
          className="hs-ring hs-ring-dot"
          aria-hidden="true"
          data-hs-ring="dot"
          style={{ left: `${ring.leftPct}%`, top: `${ring.topPct}%`, width: ring.px, height: ring.px, margin: `${-ring.px / 2}px 0 0 ${-ring.px / 2}px` }}
        />
      )}
    </div>
  );
}

const PICTURES: Record<number, { alt: string; src?: string; w: number; h: number }> = {
  1: { alt: "Safari's bottom bar with the Share button circled", w: 1180, h: 200 },
  2: { alt: 'The share sheet with View More circled', src: '/add-to-home/view-more-row.png', w: 1094, h: 370 },
  3: { alt: 'The Add to Home Screen row highlighted', src: '/add-to-home/add-to-home-screen-row.png', w: 1160, h: 240 },
};

/** The steps sheet (mock 2): the three pictured taps and a green "Got it". Any way of closing it counts as done. */
export function HomeScreenTipSheet({ open, onDone }: { open: boolean; onDone: () => void }) {
  return (
    <Sheet open={open} title="Add to Home Screen" onClose={onDone} className="hs-sheet">
      <div className="hs-steps" data-hs-steps>
        {TIP_STEPS.map((step) => {
          const p = PICTURES[step.n];
          return (
            <div className="hs-step" key={step.n} data-hs-step={step.n}>
              <div className="hs-step-head">
                <span className="hs-step-n" aria-hidden="true">
                  {step.n}
                </span>
                <div>
                  <b className="hs-step-title">{step.title}</b>
                  {step.hint && <small className="hs-step-hint">{step.hint}</small>}
                </div>
              </div>
              <StepPicture step={step}>
                {step.n === 1 ? (
                  <>
                    <img className="hs-img hs-img-light" src="/add-to-home/safari-toolbar-light.png" alt={p.alt} width={p.w} height={p.h} loading="lazy" />
                    <img className="hs-img hs-img-dark" src="/add-to-home/safari-toolbar-dark.png" alt={p.alt} width={p.w} height={p.h} loading="lazy" />
                  </>
                ) : (
                  <img className="hs-img" src={p.src} alt={p.alt} width={p.w} height={p.h} loading="lazy" />
                )}
              </StepPicture>
            </div>
          );
        })}
        <button type="button" className="hs-gotit" onClick={onDone} data-hs-gotit>
          Got it
        </button>
      </div>
    </Sheet>
  );
}

/** The card and its sheet together, for Home. */
export function HomeScreenTip({ g, blocked }: { g: GroupView | null; blocked: boolean }) {
  const tip = useHomeScreenTip(g, blocked);
  const [open, setOpen] = useState(false);
  // The sheet is only in the page once the card has been drawn (so with the switch off the page has no trace of it, not even an empty dialog),
  // and stays after that so it can slide away.
  const shown = useRef(false);
  if (tip.visible) shown.current = true;
  return (
    <>
      {tip.visible && <HomeScreenTipCard onShow={() => setOpen(true)} onX={tip.finish} />}
      {shown.current && (
        <HomeScreenTipSheet
          open={open}
          onDone={() => {
            setOpen(false);
            tip.finish();
          }}
        />
      )}
    </>
  );
}
