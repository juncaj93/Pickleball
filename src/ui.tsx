import { createContext, type CSSProperties, Fragment, type ReactNode, useCallback, useContext, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { type CourtKind } from '../shared/court';
import { countText, MIN_PLAYERS } from '../shared/spots';
import type { Tone } from '../shared/status';
import { holdLive } from './busy';
import { DEMO_MESSAGE, isIOS, VIEW_ONLY_MESSAGE } from './lib';
import { adminMotionOn, canMove, motionOn, RollText, useMotion } from './motion';
import { formatPhone, smsHref } from '../shared/messages';
import type { ApiError } from './lib';

export function Chip({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <span className={`chip tone-${tone}`}>{children}</span>;
}

export function Notice({ tone, title, children }: { tone: Tone; title?: string; children?: ReactNode }) {
  return (
    <div className={`notice tone-${tone}`} role={tone === 'danger' ? 'alert' : undefined}>
      {title && <strong>{title}</strong>}
      {children}
    </div>
  );
}

/** Soft placeholder cards while the schedule loads. Same shape and size as the real cards, so nothing jumps when they arrive. */
export function ScheduleSkeleton() {
  const card = (tier: 'this' | 'next', key: number) => (
    <div key={key} className={`sched skel-card tier-${tier}`} aria-hidden="true">
      <div className="sched-tilecol">
        <div className="skel skel-tile" />
        <div className="skel skel-time" />
      </div>
      <div className="sched-body">
        <div className="skel skel-line w60" />
        <div className="skel skel-line w40" />
        <div className="skel skel-line w80" />
      </div>
    </div>
  );
  return (
    <div className="schedule skel-schedule" role="status">
      <span className="sr-only">Loading…</span>
      <h3 className="week-break tier-this skel-head" aria-hidden="true">
        <span className="skel skel-label" />
      </h3>
      {card('this', 0)}
      {card('this', 1)}
      <h3 className="week-break tier-next skel-head" aria-hidden="true">
        <span className="skel skel-label" />
      </h3>
      {card('next', 2)}
    </div>
  );
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div role="status">
      <div className="spinner" aria-hidden="true" />
      <span className="sr-only">{label}…</span>
    </div>
  );
}

/**
 * The organizer's loading screen with the motion on: a pickleball that bounces on a small shadow until the data is
 * here. It only shows if loading takes longer than 250 ms, so a fast load never flashes it.
 */
export function LoadingBall() {
  // Not drawn at all until 250 ms have passed (a timer here, so it holds even with Reduce Motion on).
  const [late, setLate] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setLate(true), 250);
    return () => clearTimeout(t);
  }, []);
  return (
    <div className="m-loading" role="status">
      {late && (
        <>
          <span className="m-loading-ball">
            <Pickleball />
          </span>
          <span className="m-loading-shadow" aria-hidden="true" />
        </>
      )}
      <span className="sr-only">Loading…</span>
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: ApiError; onRetry?: () => void }) {
  return (
    <div className="card stack" role="alert">
      <h2>Something went wrong</h2>
      <p className="muted">{error.message}</p>
      {onRetry && (
        <button className="btn" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  const motion = useMotion();
  return (
    <div className="empty card">
      {/* A soft shadow under the ball while it bounces (only with the motion on). */}
      {motion && <span className="m-empty-shadow" aria-hidden="true" />}
      {children}
    </div>
  );
}

// ---------- Pop-up messages: one banner at the bottom ----------
//
// Every "You're in" / "Marked paid" / error message shows in ONE place: a
// rounded banner at the bottom center, above the Safari bar. It fades in,
// stays, then swipes away. A tap or swipe closes it early; a new message
// replaces the old one. It lives in the top layer, so it shows above an open
// sheet. Screen readers hear it through a live region.

/** Banner timing, in milliseconds. Change these to try other feels. */
/**
 * A double tap: the press on a banner's button came within this long of the press that made the banner (before it
 * appeared), at nearly the same spot. A deliberate tap on Undo is never that close in both.
 */
export const DOUBLE_TAP = { ms: 500, px: 24 };
// The last two presses anywhere on the page, numbered. Times are the browser's own event times.
let pressCount = 0;
const presses: { x: number; y: number; t: number; n: number }[] = [];
if (typeof window !== 'undefined') {
  window.addEventListener(
    'pointerdown',
    (e) => {
      presses.push({ x: e.clientX, y: e.clientY, t: e.timeStamp, n: ++pressCount });
      if (presses.length > 2) presses.shift();
    },
    { capture: true },
  );
}
/** Is the press going on now the very next one after the press that made a banner (`bornAt` = presses then), close in time and place? */
function isSecondTap(bornAt: number): boolean {
  if (presses.length < 2) return false;
  const [prev, now] = presses;
  return prev.n === bornAt && now.n === bornAt + 1 && now.t - prev.t < DOUBLE_TAP.ms && Math.hypot(now.x - prev.x, now.y - prev.y) < DOUBLE_TAP.px;
}
export const BANNER_TIMING = {
  /** Fade in. */
  fadeIn: 200,
  /** How long a confirmation stays after it has faded in. */
  stay: 1500,
  /** How long an error stays (longer, so it can be read). */
  errorStay: 4000,
  /** Swipe away while fading out. */
  out: 250,
};

type ToastKind = 'ok' | 'error';
/** Extras for one banner: a button on it ("Undo"), how long it stays, or the pickleball pop for "Game on!". */
export interface ToastOptions {
  action?: { label: string; onClick: () => void };
  stayMs?: number;
  ball?: boolean;
  /**
   * Undo on admin toasts (ADMIN_UNDO, Zip 13): this banner stays up for its own time even when another one comes; up to three stack, newest
   * at the bottom, so two quick taps each keep their own Undo. Left out (every other toast): one banner at a time, exactly as before.
   */
  keep?: boolean;
  /**
   * Unpaid nudge (UNPAID_NUDGE, Zip 17): a second, smaller line under the message (the message is then bold), and the nudge look (the
   * inverse of the page: a dark banner on a light page, a light one on a dark page, no badge). Left out: exactly as before.
   */
  sub?: string;
  nudge?: boolean;
}
type ToastFn = (msg: string, kind?: ToastKind, opts?: ToastOptions) => void;

const ToastContext = createContext<ToastFn>(() => {});

interface Shown {
  id: number;
  msg: string;
  kind: ToastKind;
  opts: ToastOptions;
  /** Set once it started to go (a tap, a swipe, its time): a banner drawn again in another place (into or out of a sheet) stays going. */
  going?: boolean;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  // The banners on screen, oldest first. Without `keep` there is only ever one (a new one replaces it), exactly as before.
  const [shown, setShown] = useState<Shown[]>([]);
  const [spoken, setSpoken] = useState<{ msg: string; kind: ToastKind } | null>(null);
  const show = useCallback<ToastFn>((msg, kind = 'ok', opts = {}) => {
    // "Demo only" (View as, Pretend it's...) and "View only" (the read-only PIN) are plain notes, never a red error.
    if (msg === DEMO_MESSAGE || msg === VIEW_ONLY_MESSAGE) kind = 'ok';
    const next = { id: Date.now() + Math.random(), msg, kind, opts };
    setShown((cur) => [...cur.filter((x) => x.opts.keep), next].slice(-3));
    setSpoken({ msg: opts.sub ? `${msg} ${opts.sub}` : msg, kind });
  }, []);
  // Only while a banner with a button (Undo) is up: follow which sheet is open on top, so the banner can sit inside it (see below).
  const keeping = shown.some((x) => x.opts.keep || x.opts.action);
  const [, setSheets] = useState(0);
  useEffect(() => {
    if (!keeping) return undefined;
    const again = () => setSheets((n) => n + 1);
    const mo = new MutationObserver(again);
    mo.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['open'] });
    // A sheet may have closed between the banner's first draw and this watcher starting (a confirm box that closes with the tap): look once now,
    // and on every sheet's close too.
    again();
    document.addEventListener('close', again, true);
    return () => {
      mo.disconnect();
      document.removeEventListener('close', again, true);
    };
  }, [keeping]);
  // The top sheet that is not sliding shut (a closing box takes no taps), and only where banners sit in the top layer (popover): an older
  // browser would place a fixed banner inside a moving sheet wrongly, so there it stays where it always was.
  const topSheet =
    keeping && typeof document !== 'undefined' && typeof HTMLElement !== 'undefined' && 'showPopover' in HTMLElement.prototype
      ? ([...document.querySelectorAll<HTMLDialogElement>('dialog[open]:not(.m-closing)')].pop() ?? null)
      : null;
  return (
    <ToastContext.Provider value={show}>
      {children}
      <div aria-live="polite" className="sr-only">
        {spoken?.kind === 'ok' ? spoken.msg : ''}
      </div>
      <div aria-live="assertive" className="sr-only">
        {spoken?.kind === 'error' ? spoken.msg : ''}
      </div>
      {shown.map((b, i) => {
        const banner = <Banner key={b.id} shown={b} stack={shown.length - 1 - i} onGone={() => setShown((cur) => cur.filter((x) => x.id !== b.id))} />;
        // A banner with a button (Undo) over an open sheet lives INSIDE that sheet: a modal sheet makes everything outside it untappable, so a
        // button drawn outside would look tappable and not be (Zip 13; it was so for Remove from a game's Undo too). Moves out again when the
        // sheet closes (its time keeps running). Banners without a button: exactly as before.
        return (b.opts.keep || b.opts.action) && topSheet ? createPortal(<Fragment key={`${b.id}:in`}>{banner}</Fragment>, topSheet) : banner;
      })}
    </ToastContext.Provider>
  );
}

/** With the motion on, a confirmation holds about 3 seconds (an error and an Undo keep their own time). */
const MOTION_STAY_MS = 3000;
const stayFor = (shown: Shown, motion: boolean) => shown.opts.stayMs ?? (shown.kind === 'error' ? BANNER_TIMING.errorStay : motion ? MOTION_STAY_MS : BANNER_TIMING.stay);
/** A swipe down this far (px) sends the banner away; less and it glides back. */
const SWIPE_DISMISS_PX = 36;

/** The Undo ring: drains over exactly the Undo window (`spentMs` already gone when a banner is drawn again elsewhere: it picks up there). */
function UndoRing({ ms, spentMs = 0 }: { ms: number; spentMs?: number }) {
  return (
    <svg className="m-undo-ring" viewBox="0 0 24 24" aria-hidden="true" style={{ '--ring-ms': `${ms}ms`, ...(spentMs > 0 ? { '--ring-delay': `-${spentMs}ms` } : {}) } as React.CSSProperties}>
      <circle className="m-ring-back" cx="12" cy="12" r="9.5" />
      <circle className="m-ring-front" cx="12" cy="12" r="9.5" pathLength="100" />
    </svg>
  );
}

function Banner({ shown, onGone, stack = 0 }: { shown: Shown; onGone: () => void; stack?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  // A banner with a button can be drawn again elsewhere (into or out of a sheet): one that had started to go keeps going.
  const [leaving, setLeaving] = useState<'' | 'left' | 'right' | 'down'>(shown.going ? 'down' : '');
  // How long it has been up already (0 for a new banner), so its time and its Undo ring carry on where they were.
  const spentAtDraw = useRef(shown.opts.keep || shown.opts.action ? Math.max(0, Date.now() - Math.floor(shown.id)) : 0).current;
  const swipe = useRef<{ x: number; y: number } | null>(null);
  // Decided once, when it appears: the motion look (a raised card, spring in, glides under the finger).
  const motion = useRef(motionOn()).current;
  const dragged = useRef(0);
  function drag(dy: number) {
    const el = ref.current;
    if (!el) return;
    dragged.current = Math.max(dragged.current, Math.abs(dy));
    el.classList.remove('m-snap');
    el.classList.add('m-dragging');
    el.style.transform = `translateX(-50%) translateY(${Math.max(0, dy)}px)`;
  }
  function release(dy: number) {
    const el = ref.current;
    if (!el) return;
    el.classList.remove('m-dragging');
    if (dy > SWIPE_DISMISS_PX) return setLeaving((v) => v || 'down');
    // Let go early: it glides back up and stays.
    el.classList.add('m-snap');
    el.style.transform = '';
    setTimeout(() => el.classList.remove('m-snap'), 260);
  }
  // When it appeared: a tap on its button that is the second half of a double tap on whatever was under it (Drop out
  // sits right there) is not a choice, so it is ignored.
  const bornAt = useRef(pressCount);
  const doubleTap = useRef(false);
  useLayoutEffect(() => {
    // The top layer keeps it above an open sheet; older browsers fall back to a high z-index.
    try {
      const el = ref.current;
      if (el && 'showPopover' in el) (el as HTMLElement & { showPopover: () => void }).showPopover();
    } catch {
      /* already showing */
    }
  }, []);
  useEffect(() => {
    const stay = stayFor(shown, motion);
    // A banner with a button that moved into or out of a sheet keeps its own clock (it was made at shown.id).
    const spent = shown.opts.keep || shown.opts.action ? Math.max(0, Date.now() - Math.floor(shown.id)) : 0;
    const t = setTimeout(() => setLeaving((v) => v || 'down'), Math.max(0, BANNER_TIMING.fadeIn + stay - spent));
    return () => clearTimeout(t);
  }, [shown]);
  const gone = useRef(onGone);
  gone.current = onGone;
  useEffect(() => {
    if (!leaving) return;
    shown.going = true;
    const t = setTimeout(() => gone.current(), BANNER_TIMING.out);
    return () => clearTimeout(t);
  }, [leaving]);
  return (
    <div
      ref={ref}
      popover="manual"
      className={`pop toast${shown.opts.nudge ? ' toast-nudge' : ''}${shown.kind === 'error' ? ' pop-error' : ''}${shown.opts.ball ? ' pop-ball' : ''}${motion ? ' m-toast' : ''}${leaving ? ` leaving-${leaving}` : ''}`}
      data-banner
      // Screen readers hear the message through the live regions; a banner with a button must stay reachable.
      aria-hidden={shown.opts.action ? undefined : true}
      // A stacked Undo banner (keep) sits one banner higher for each newer one under it. Alone: the usual place.
      style={{ '--b-in': `${BANNER_TIMING.fadeIn}ms`, '--b-out': `${BANNER_TIMING.out}ms`, ...(stack > 0 ? { marginBottom: `${stack * 72}px` } : {}) } as React.CSSProperties}
      data-stack={stack > 0 ? stack : undefined}
      onClick={() => {
        // A drag that ended on the banner is not a tap.
        if (motion && dragged.current > 6) return;
        setLeaving((v) => v || 'down');
      }}
      onPointerDown={(e) => {
        swipe.current = { x: e.clientX, y: e.clientY };
        dragged.current = 0;
      }}
      onPointerMove={(e) => {
        if (!motion || !swipe.current || leaving) return;
        const dy = e.clientY - swipe.current.y;
        if (dy > 4 || dragged.current > 0) {
          if (dragged.current === 0) (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
          drag(dy);
        }
      }}
      onPointerCancel={() => {
        if (!motion || !swipe.current) return;
        swipe.current = null;
        release(0);
      }}
      onPointerUp={(e) => {
        const from = swipe.current;
        swipe.current = null;
        if (!from) return;
        const dx = e.clientX - from.x;
        const dy = e.clientY - from.y;
        // With the motion on only a swipe DOWN does anything (sideways never dismisses).
        if (motion) return release(dy);
        if (Math.abs(dx) > 24 && Math.abs(dx) >= Math.abs(dy)) setLeaving(dx < 0 ? 'left' : 'right');
        else if (dy > 18) setLeaving('down');
      }}
    >
      {!shown.opts.nudge && (
      <span className="toast-icon" aria-hidden="true">
        {shown.opts.ball ? (
          <Pickleball />
        ) : shown.kind === 'error' ? (
          '!'
        ) : (
          <svg viewBox="0 0 20 20">
            <path d="M4.5 10.5l3.5 3.5 7.5-8" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </span>
      )}
      {shown.opts.sub ? (
        <span className="toast-msg toast-two">
          <b>{shown.msg}</b>
          <small>{shown.opts.sub}</small>
        </span>
      ) : (
        <span className="toast-msg">{shown.msg}</span>
      )}
      {shown.opts.action && (
        <button
          className="toast-action"
          onPointerDown={(e) => {
            e.stopPropagation();
            doubleTap.current = isSecondTap(bornAt.current);
          }}
          onPointerUp={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            if (doubleTap.current) return;
            shown.opts.action!.onClick();
            setLeaving((v) => v || 'down');
          }}
        >
          {motion && shown.opts.action.label === 'Undo' && <UndoRing ms={BANNER_TIMING.fadeIn + stayFor(shown, motion)} spentMs={spentAtDraw} />}
          {shown.opts.action.label}
        </button>
      )}
    </div>
  );
}

export const useToast = () => useContext(ToastContext);

// ---------- Sheets & dialogs (native <dialog> handles focus and Escape) ----------

/** Sheet timing with the motion on: it snaps up in 180 ms (motion.css) and closes in 150 ms. */
const SHEET_CLOSE_MS = 150;
/** Dragging the top of a sheet down this far (px) closes it. */
const SHEET_DRAG_CLOSE_PX = 80;

export function Sheet({
  open,
  title,
  onClose,
  children,
  headerAction,
  className,
  hideClose,
  titleAfter,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** An optional button in the header, between the title and the close button. */
  headerAction?: ReactNode;
  /** An extra class on the sheet (the Players redo's sheets). Left out: exactly as before. */
  className?: string;
  /** No ✕ (a sheet whose header button is its only one; a tap outside or a swipe down still closes it). Left out: exactly as before. */
  hideClose?: boolean;
  /** Something right after the title, on its line (the Players redo's small pencil). Left out: exactly as before. */
  titleAfter?: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  // With the motion on, a sheet that is closing stays drawn for the length of its slide down.
  const [closing, setClosing] = useState(false);
  const wasOpen = useRef(open);
  // Set at once (state waits for a redraw) so the effect below does not close the dialog before the slide down.
  const keep = useRef(false);
  useLayoutEffect(() => {
    const was = wasOpen.current;
    wasOpen.current = open;
    if (open) {
      keep.current = false;
      setClosing(false);
      // A sheet that was dragged down to close must come back at its normal place.
      const el = ref.current;
      if (el) {
        el.style.transform = '';
        el.classList.remove('m-dragging', 'm-snap');
      }
      return undefined;
    }
    const d = ref.current;
    if (was && d?.open && canMove()) {
      keep.current = true;
      setClosing(true);
      const t = setTimeout(() => {
        keep.current = false;
        setClosing(false);
      }, SHEET_CLOSE_MS);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [open]);
  // An open sheet holds live updates back until it closes.
  useEffect(() => (open ? holdLive() : undefined), [open]);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open && !keep.current) {
      d.close();
      d.style.transform = '';
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, closing]);
  // Drag the top of the sheet down to close it (touch or mouse); let go early and it glides back.
  const dragFrom = useRef<number | null>(null);
  const dragDy = useRef(0);
  return (
    <dialog
      ref={ref}
      className={`sheet${className ? ` ${className}` : ''}${closing && !open ? ' m-closing' : ''}`}
      aria-labelledby={titleId}
      // Only this sheet's own close: a confirm box opened inside it (Remove X?) closing must not close this sheet too (Zip 13: that sent
      // the held Remove at once, so its Undo always said "Too late").
      onClose={(e) => {
        if (e.target !== e.currentTarget) return;
        onClose();
      }}
      onClick={(e) => {
        if (e.target !== ref.current) return;
        // A tap outside closes the sheet. If it landed on the tab bar, that tab gets the tap too.
        // (Measured by position: the page behind an open sheet doesn't take taps itself.)
        const under = [...document.querySelectorAll<HTMLButtonElement>('.tabbar button')].find((b) => {
          const r = b.getBoundingClientRect();
          return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
        });
        onClose();
        if (under) setTimeout(() => under.click(), 0);
      }}
    >
      {(open || closing) && (
        <>
          <div
            className="sheet-head"
            onPointerDown={(e) => {
              if (!motionOn() || (e.target as Element).closest('button')) return;
              dragFrom.current = e.clientY;
              dragDy.current = 0;
            }}
            onPointerMove={(e) => {
              const d = ref.current;
              if (dragFrom.current === null || !d) return;
              dragDy.current = Math.max(0, e.clientY - dragFrom.current);
              if (dragDy.current > 4) {
                (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
                d.classList.remove('m-snap');
                d.classList.add('m-dragging');
                d.style.transform = `translateY(${dragDy.current}px)`;
              }
            }}
            onPointerUp={() => {
              const d = ref.current;
              const dy = dragDy.current;
              if (dragFrom.current === null || !d) return;
              dragFrom.current = null;
              dragDy.current = 0;
              d.classList.remove('m-dragging');
              if (dy > SHEET_DRAG_CLOSE_PX) return onClose();
              d.classList.add('m-snap');
              d.style.transform = '';
              setTimeout(() => d.classList.remove('m-snap'), 220);
            }}
            onPointerCancel={() => {
              const d = ref.current;
              dragFrom.current = null;
              if (!d) return;
              d.classList.remove('m-dragging');
              d.style.transform = '';
            }}
          >
            {titleAfter ? (
              <div className="sheet-title-row">
                <h2 id={titleId}>{title}</h2>
                {titleAfter}
              </div>
            ) : (
              <h2 id={titleId}>{title}</h2>
            )}
            {headerAction}
            {!hideClose && (
              <button className="icon-btn" onClick={onClose} aria-label="Close">
                ✕
              </button>
            )}
          </div>
          <div className="sheet-body">{children}</div>
        </>
      )}
    </dialog>
  );
}

/** Confirmation step for destructive actions. */
export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  danger,
  busy,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  body: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Sheet open={open} title={title} onClose={onCancel}>
      <div className="stack">
        <div>{body}</div>
        <div className="btn-row">
          <button className="btn secondary" onClick={onCancel} disabled={busy}>
            Go back
          </button>
          <button className={`btn ${danger ? 'danger' : ''}`} onClick={onConfirm} disabled={busy}>
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </Sheet>
  );
}

// ---------- Text message drafts ----------

/**
 * A prewritten text. The button only opens Messages with the text filled
 * in; the organizer still presses send there, so the site never says a
 * message was sent. After the tap it says "Message ready".
 */
export function SmsDraft({
  to,
  phone,
  phones,
  missing,
  body,
  openLabel = 'Open in Messages',
  quiet,
  onOpen,
}: {
  to: string;
  phone: string | null;
  /** Several recipients at once (a group message). */
  phones?: string[];
  /** Names with no number saved, shown in small text. */
  missing?: string[];
  body: string;
  openLabel?: string;
  /** Another draft on the same card already has the green button: use the gray one. */
  quiet?: boolean;
  /** Called when the button opens Messages (the "Do this now" card's mark). */
  onOpen?: () => void;
}) {
  const [opened, setOpened] = useState(false);
  // No numbers saved: Messages opens with just the words, to pick a group chat.
  const href = smsHref(phones && phones.length ? phones : phone, body, isIOS);
  return (
    <div className="draft">
      {/* Who, on one line; "Message ready" appears once Messages has opened. */}
      <div className="draft-head">
        <span className="draft-to">
          <strong>{to}</strong>
          <span className="muted small">
            {' · '}
            {phones ? (phones.length ? `${phones.length} number${phones.length === 1 ? '' : 's'}` : 'no numbers: pick a group chat') : phone ? formatPhone(phone) : 'pick the chat in Messages'}
          </span>
        </span>
        {opened && <Chip tone="info">Message ready</Chip>}
      </div>
      {missing && missing.length > 0 && <div className="small missing-numbers">Missing numbers: {missing.join(', ')}</div>}
      <p className="bubble">{body}</p>
      <div className="btn-row">
        <a className={`btn small${quiet ? ' secondary' : ''}`} href={href}
          onClick={() => {
            setOpened(true);
            onOpen?.();
          }}
        >
          {openLabel}
        </a>
      </div>
    </div>
  );
}

/**
 * A whole-number field that behaves like a normal text box: it can be
 * cleared and retyped, shows the number keypad, and is only checked when
 * the form is saved (see parseWhole).
 */
export function NumberField({
  label,
  hint,
  value,
  onChange,
  error,
  compact,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  error?: string | null;
  /** Label on the left, a small box on the right. */
  compact?: boolean;
}) {
  const id = useId();
  if (compact) {
    return (
      <div className="set-row-wrap">
        <label className="set-row" htmlFor={id}>
          <span className="set-label">
            {label}
            {hint && <span className="set-hint">{hint}</span>}
          </span>
          <input
            id={id}
            className="set-input"
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete="off"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            aria-invalid={error ? true : undefined}
          />
        </label>
        {error && <span className="field-error">{error}</span>}
      </div>
    );
  }
  return (
    <label className="field" htmlFor={id}>
      {label}
      {hint && <span className="hint">{hint}</span>}
      <input
        id={id}
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        autoComplete="off"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={error ? true : undefined}
      />
      {error && <span className="field-error">{error}</span>}
    </label>
  );
}

/** Read a NumberField's text on save. Returns an error message or the number. */
export function parseWhole(text: string, min: number, max: number): { value: number } | { error: string } {
  const t = text.trim();
  if (!/^\d+$/.test(t)) return { error: `Enter a whole number from ${min} to ${max}.` };
  const n = Number(t);
  if (n < min || n > max) return { error: `Enter a number from ${min} to ${max}.` };
  return { value: n };
}

// ---------- Icons (one stroke style, drawn to match) ----------

const ICON = { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.9, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true };

export const HomeIcon = () => (
  <svg {...ICON} data-icon="home">
    <path d="M3.5 10.5 12 3.8l8.5 6.7" />
    <path d="M5.8 9v10.2h12.4V9" />
    <path d="M10 19.2v-5.4h4v5.4" />
  </svg>
);

export const PeopleIcon = () => (
  <svg {...ICON} data-icon="people">
    <circle cx="9" cy="8.5" r="3.2" />
    <path d="M3.2 19.2c.6-3.2 3-5 5.8-5s5.2 1.8 5.8 5" />
    <circle cx="16.8" cy="9.3" r="2.6" />
    <path d="M16.4 14.3c2.3.1 4 1.6 4.5 4.3" />
  </svg>
);

export const PhoneIcon = () => (
  <svg {...ICON} data-icon="phone">
    <path d="M6.6 3.5h2.6l1.4 4-1.9 1.3a11 11 0 0 0 6.5 6.5l1.3-1.9 4 1.4v2.6a2 2 0 0 1-2.1 2A16.5 16.5 0 0 1 4.5 5.6a2 2 0 0 1 2.1-2.1z" />
  </svg>
);

export const DollarIcon = () => (
  <svg {...ICON} data-icon="dollar">
    <path d="M12 3v18" />
    <path d="M16.5 7.2c-.8-1.3-2.4-2-4.4-2-2.6 0-4.3 1.3-4.3 3.2 0 4.4 9 2.4 9 7 0 2-1.9 3.4-4.6 3.4-2.2 0-4-.8-4.8-2.3" />
  </svg>
);

/** A cog: eight square teeth around a hole, so it never reads as a sun. */
export const GearIcon = () => (
  <svg {...ICON} data-icon="gear">
    <path d="M9.23 5.14 L10.17 2.58 L13.83 2.58 L14.77 5.14 L14.89 5.19 L17.37 4.04 L19.96 6.63 L18.81 9.11 L18.86 9.23 L21.42 10.17 L21.42 13.83 L18.86 14.77 L18.81 14.89 L19.96 17.37 L17.37 19.96 L14.89 18.81 L14.77 18.86 L13.83 21.42 L10.17 21.42 L9.23 18.86 L9.11 18.81 L6.63 19.96 L4.04 17.37 L5.19 14.89 L5.14 14.77 L2.58 13.83 L2.58 10.17 L5.14 9.23 L5.19 9.11 L4.04 6.63 L6.63 4.04 L9.11 5.19 Z" />
    <circle cx="12" cy="12" r="3.1" />
  </svg>
);

/** A speech bubble: the card's "Text" button. */
export const MessageIcon = () => (
  <svg {...ICON} data-icon="message">
    <path d="M4.5 5.5h15a1.5 1.5 0 0 1 1.5 1.5v8.5a1.5 1.5 0 0 1-1.5 1.5H10l-4.5 3.5V17h-1A1.5 1.5 0 0 1 3 15.5V7a1.5 1.5 0 0 1 1.5-1.5z" />
  </svg>
);

/** Filter: three lines, getting shorter. The "All games / My games" switch. */
export const FilterIcon = () => (
  <svg {...ICON} data-icon="filter" className="filter-icon">
    <path d="M4 7h16M7 12h10M10 17h4" />
  </svg>
);

/** A small calendar page with a plus: "Add to calendar" on narrow cards. */
export const CalendarPlusIcon = () => (
  <svg {...ICON} data-icon="calendar-plus" className="cal-icon">
    <rect x="3.5" y="5" width="17" height="15" rx="2.5" />
    <path d="M3.5 9.5h17M8 3v4M16 3v4M12 12.5v5M9.5 15h5" />
  </svg>
);

/** History: a clock with an arrow curling back around it. */
export const HistoryIcon = () => (
  <svg {...ICON} data-icon="history">
    <path d="M3.8 12a8.2 8.2 0 1 0 2.4-5.8" />
    <path d="M3.5 4.2v3.6h3.6" />
    <path d="M12 7.6V12l3 1.9" />
  </svg>
);

/** Auto: a circle, half filled. */
export const AutoModeIcon = () => (
  <svg {...ICON} data-icon="auto">
    <circle cx="12" cy="12" r="8" />
    <path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor" stroke="none" />
  </svg>
);

export const SunIcon = () => (
  <svg {...ICON} data-icon="sun">
    <circle cx="12" cy="12" r="3.8" />
    <path d="M12 2.8v2.1M12 19.1v2.1M2.8 12h2.1M19.1 12h2.1M5.5 5.5l1.5 1.5M17 17l1.5 1.5M5.5 18.5 7 17M17 7l1.5-1.5" />
  </svg>
);

export const MoonIcon = () => (
  <svg {...ICON} data-icon="moon">
    <path d="M19.5 14.6A8 8 0 0 1 9.4 4.5a8 8 0 1 0 10.1 10.1z" />
  </svg>
);

// ---------- Court status (same words and icons for organizers and players) ----------

/** Check for booked, warning for not booked, clock for the court waitlist, slashed circle for off. */
export function CourtIcon({ kind }: { kind: CourtKind }) {
  return (
    <svg {...ICON} className="court-icon" strokeWidth={2.3}>
      {kind === 'booked' && (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="m7.8 12.3 2.8 2.8 5.6-6" />
        </>
      )}
      {kind === 'needs' && (
        <>
          <path d="M12 3.6 21 19.6H3z" />
          <path d="M12 9.6v4.4M12 16.9v.1" />
        </>
      )}
      {kind === 'waitlist' && (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7.2V12l3.2 2" />
        </>
      )}
      {kind === 'later' && (
        <>
          <rect x="3.8" y="5.2" width="16.4" height="15" rx="2.5" />
          <path d="M3.8 9.8h16.4M8.2 3.4v3.6M15.8 3.4v3.6" />
        </>
      )}
      {kind === 'off' && (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="m5.8 5.8 12.4 12.4" />
        </>
      )}
    </svg>
  );
}

/** One pickleball: a yellow-green ball with the hole pattern. Inline SVG, no image files. */
export function Pickleball({ me, fresh }: { me?: boolean; fresh?: boolean }) {
  return (
    <svg className={`ball${me ? ' me' : ''}${fresh ? ' ball-new' : ''}`} viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="10" cy="10" r="9" className="ball-skin" />
      <g className="ball-holes">
        <circle cx="10" cy="5.2" r="1.3" />
        <circle cx="5.6" cy="8" r="1.3" />
        <circle cx="14.4" cy="8" r="1.3" />
        <circle cx="7.2" cy="13.2" r="1.3" />
        <circle cx="12.8" cy="13.2" r="1.3" />
        <circle cx="10" cy="9.6" r="1.1" />
      </g>
    </svg>
  );
}

/**
 * Who's in, as pickleballs: always 4 circles (a ball for each person in,
 * an outlined circle for each spot still needed to play), then one more ball
 * for every extra person beyond 4, up to the max. Never empty circles past
 * the first 4. The count text beside it carries the number for screen readers.
 */
/**
 * The circles. `oneRow` ("Card cleanup", Zip 10): every ball stays on one row at its usual size; when there are more than the row
 * holds, they tuck slightly under each other instead of wrapping (src/zip10.css, from `--n`, the number of circles).
 */
/**
 * An empty seat: the ONE place an empty seat is drawn (game cards, organizer cards and rows, the alert cards, through SpotDots). A plain
 * outlined circle; with "Seat dots" on (src/seat-dots.css, <html data-seat-dots>) a slightly grayed dashed ring of the same size.
 */
export function EmptySeat() {
  return <span className="dot" />;
}

export function SpotDots({ names, me, celebrate, oneRow }: { names: string[]; me?: string | null; celebrate?: boolean; oneRow?: boolean }) {
  const slots = Math.max(MIN_PLAYERS, names.length);
  // Only balls that appeared since the last look spin in; the first look at a card is still.
  // The marker lasts for the whole spin, even if the card redraws (instant tap, then the server's data).
  const prevCount = useRef<number | null>(null);
  const [freshFrom, setFreshFrom] = useState<number | null>(null);
  useEffect(() => {
    const before = prevCount.current;
    prevCount.current = names.length;
    if (before === null || names.length <= before) return;
    setFreshFrom((cur) => (cur === null ? before : Math.min(cur, before)));
    const t = setTimeout(() => setFreshFrom(null), 700);
    return () => clearTimeout(t);
  }, [names.length]);
  return (
    <span
      className={`dots${celebrate ? ' dots-celebrate' : ''}${oneRow ? ' one-row' : ''}`}
      style={oneRow ? ({ '--n': slots } as CSSProperties) : undefined}
      role="img"
      aria-label={`${names.length} in${names.length < MIN_PLAYERS ? `, ${MIN_PLAYERS - names.length} more needed` : ''}`}
    >
      {Array.from({ length: slots }, (_, i) =>
        i < names.length ? <Pickleball key={i} me={names[i] === me} fresh={freshFrom !== null && i >= freshFrom} /> : <EmptySeat key={i} />,
      )}
    </span>
  );
}

const firstName = (name: string) => name.trim().split(/\s+/)[0];

/**
 * How a name reads on the cards: the first name ("Ryan"), or the whole name
 * ("Ryan S.") when someone else in the group has the same first name.
 * `everyone` is the group's names.
 */
export function nameLabel(everyone: string[]): (name: string) => string {
  const count = new Map<string, number>();
  for (const n of new Set(everyone.map((x) => x.trim()))) {
    const k = firstName(n).toLowerCase();
    count.set(k, (count.get(k) ?? 0) + 1);
  }
  return (name) => ((count.get(firstName(name).toLowerCase()) ?? 0) > 1 ? name.trim() : firstName(name));
}

/**
 * Names on their own small line, in sign-up order, every one of them (never
 * "+2"), wrapping onto a second line when they don't fit. Yours is bold.
 * With `label` it's the waitlist or standby line: "Waitlist: Emery, Frankie".
 * Nothing at all when the list is empty.
 */
export function NamesLine({
  names,
  me,
  everyone,
  label,
  children,
  icon,
}: {
  names: string[];
  me?: string | null;
  everyone: string[];
  label?: string;
  children?: ReactNode;
  /** "Card cleanup" (Zip 10): the small gray people icon before the names. */
  icon?: boolean;
}) {
  // A name that appeared since the last draw (someone joined while you were looking) fades in.
  const seen = useRef<Set<string> | null>(null);
  const [fresh, setFresh] = useState<string[]>([]);
  const key = names.join('\u0001');
  useEffect(() => {
    const was = seen.current;
    seen.current = new Set(names);
    if (!was) return;
    // With the motion on, YOUR own join is not flashed (you just tapped it); only someone else arriving is.
    const added = names.filter((n) => !was.has(n) && !(motionOn() && n === me));
    if (added.length === 0) return;
    // Organizer screens with the motion on: nothing flashes behind an open sheet or pop-up.
    if (adminMotionOn() && document.querySelector('dialog[open], .menu-pop')) return;
    setFresh((cur) => [...cur, ...added]);
    setTimeout(() => setFresh((cur) => cur.filter((n) => !added.includes(n))), adminMotionOn() ? 1000 : 700);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  if (names.length === 0) return null;
  const show = nameLabel([...everyone, ...names]);
  const list = names.map((n, i) => (
    <Fragment key={n + i}>
      {i > 0 && ', '}
      {fresh.includes(n) ? <span className="name-new">{n === me ? <strong>{show(n)}</strong> : show(n)}</span> : n === me ? <strong>{show(n)}</strong> : show(n)}
    </Fragment>
  ));
  return (
    <p className={`${label ? 'waitlist-line' : 'names-line'}${icon ? ' with-icon' : ''}`} title={names.join(', ')}>
      {label && `${label}: `}
      {icon ? (
        <>
          {/* The same people icon as the organizer's Players tab, small and gray. */}
          <span className="people-icon">
            <PeopleIcon />
          </span>
          <span className="names-text">
            {list}
            {children}
          </span>
        </>
      ) : (
        <>
          {list}
          {children}
        </>
      )}
    </p>
  );
}

/**
 * The organizer card's who's in: "3 of 4 in" or "5 in" and a ball per
 * person (with the organizer's own "You're in" / "Out" at the right), then
 * every name on a line of its own, then anyone waiting.
 */
export function PlayersLine({
  names,
  waitlist,
  waitLabel,
  everyone,
  after,
  maxPlayers,
  cleanup,
}: {
  /** "Card cleanup" (Zip 10): no count text, the circles on one row, the people icon before the names, no waitlist line. */
  cleanup?: boolean;
  /** Confirmed players, in sign-up order. */
  names: string[];
  /** The most who can be in ("10 in, full"). */
  maxPlayers: number;
  /** Waiting players, in order. */
  waitlist: string[];
  /** "Waitlist", or "Standby" while waiting on the court. */
  waitLabel: string;
  /** The group's names, to tell two people with the same first name apart. */
  everyone: string[];
  /** Something at the right end of the first line (the organizer's own I'm in). */
  after?: ReactNode;
}) {
  if (cleanup) {
    return (
      <div className="players players-line cl-players">
        <div className="players-top">
          <span className="cl-balls">
            <SpotDots names={names} oneRow />
          </span>
          {after && <span className="players-after">{after}</span>}
        </div>
        <NamesLine names={names} everyone={everyone} icon />
      </div>
    );
  }
  return (
    <div className="players players-line">
      <div className="players-top">
        <span className="players-count">
          <RollText text={countText(names.length, maxPlayers)} />
        </span>
        <SpotDots names={names} />
        {after && <span className="players-after">{after}</span>}
      </div>
      <NamesLine names={names} everyone={everyone} />
      <NamesLine names={waitlist} everyone={everyone} label={waitLabel} />
    </div>
  );
}

/**
 * A link to CourtReserve. Its own blue-teal color and a small arrow show it
 * leaves this site; it always opens in a new tab.
 */
export function CourtReserveLink({ href, children, small, pill }: { href: string; children: ReactNode; small?: boolean; pill?: boolean }) {
  return (
    <a className={`btn external${small ? ' small' : ''}${pill ? ' pill' : ''}`} href={href} target="_blank" rel="noopener noreferrer">
      {children}
      <svg {...ICON} className="ext-icon" strokeWidth={2.2}>
        <path d="M8 16 16.5 7.5M9.5 7.5h7v7" />
      </svg>
      <span className="sr-only"> (opens CourtReserve)</span>
    </a>
  );
}
