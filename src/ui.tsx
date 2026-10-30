import { createContext, Fragment, type ReactNode, useCallback, useContext, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { type CourtKind } from '../shared/court';
import { countText, MIN_PLAYERS } from '../shared/spots';
import type { Tone } from '../shared/status';
import { holdLive } from './busy';
import { DEMO_MESSAGE, isIOS } from './lib';
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
  return <div className="empty card">{children}</div>;
}

// ---------- Pop-up messages: one banner at the bottom ----------
//
// Every "You're in" / "Marked paid" / error message shows in ONE place: a
// rounded banner at the bottom center, above the Safari bar. It fades in,
// stays, then swipes away. A tap or swipe closes it early; a new message
// replaces the old one. It lives in the top layer, so it shows above an open
// sheet. Screen readers hear it through a live region.

/** Banner timing, in milliseconds. Change these to try other feels. */
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
}
type ToastFn = (msg: string, kind?: ToastKind, opts?: ToastOptions) => void;

const ToastContext = createContext<ToastFn>(() => {});

interface Shown {
  id: number;
  msg: string;
  kind: ToastKind;
  opts: ToastOptions;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [shown, setShown] = useState<Shown | null>(null);
  const [spoken, setSpoken] = useState<{ msg: string; kind: ToastKind } | null>(null);
  const show = useCallback<ToastFn>((msg, kind = 'ok', opts = {}) => {
    // "Demo only" (View as, Pretend it's...) is a plain note, never a red error.
    if (msg === DEMO_MESSAGE) kind = 'ok';
    setShown({ id: Date.now() + Math.random(), msg, kind, opts });
    setSpoken({ msg, kind });
  }, []);
  return (
    <ToastContext.Provider value={show}>
      {children}
      <div aria-live="polite" className="sr-only">
        {spoken?.kind === 'ok' ? spoken.msg : ''}
      </div>
      <div aria-live="assertive" className="sr-only">
        {spoken?.kind === 'error' ? spoken.msg : ''}
      </div>
      {shown && <Banner key={shown.id} shown={shown} onGone={() => setShown((cur) => (cur && cur.id === shown.id ? null : cur))} />}
    </ToastContext.Provider>
  );
}

function Banner({ shown, onGone }: { shown: Shown; onGone: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [leaving, setLeaving] = useState<'' | 'left' | 'right' | 'down'>('');
  const swipe = useRef<{ x: number; y: number } | null>(null);
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
    const stay = shown.opts.stayMs ?? (shown.kind === 'error' ? BANNER_TIMING.errorStay : BANNER_TIMING.stay);
    const t = setTimeout(() => setLeaving((v) => v || 'down'), BANNER_TIMING.fadeIn + stay);
    return () => clearTimeout(t);
  }, [shown]);
  const gone = useRef(onGone);
  gone.current = onGone;
  useEffect(() => {
    if (!leaving) return;
    const t = setTimeout(() => gone.current(), BANNER_TIMING.out);
    return () => clearTimeout(t);
  }, [leaving]);
  return (
    <div
      ref={ref}
      popover="manual"
      className={`pop toast${shown.kind === 'error' ? ' pop-error' : ''}${shown.opts.ball ? ' pop-ball' : ''}${leaving ? ` leaving-${leaving}` : ''}`}
      data-banner
      // Screen readers hear the message through the live regions; a banner with a button must stay reachable.
      aria-hidden={shown.opts.action ? undefined : true}
      style={{ '--b-in': `${BANNER_TIMING.fadeIn}ms`, '--b-out': `${BANNER_TIMING.out}ms` } as React.CSSProperties}
      onClick={() => setLeaving((v) => v || 'down')}
      onPointerDown={(e) => {
        swipe.current = { x: e.clientX, y: e.clientY };
      }}
      onPointerUp={(e) => {
        const from = swipe.current;
        swipe.current = null;
        if (!from) return;
        const dx = e.clientX - from.x;
        const dy = e.clientY - from.y;
        if (Math.abs(dx) > 24 && Math.abs(dx) >= Math.abs(dy)) setLeaving(dx < 0 ? 'left' : 'right');
        else if (dy > 18) setLeaving('down');
      }}
    >
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
      <span className="toast-msg">{shown.msg}</span>
      {shown.opts.action && (
        <button
          className="toast-action"
          onPointerDown={(e) => e.stopPropagation()}
          onPointerUp={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            shown.opts.action!.onClick();
            setLeaving((v) => v || 'down');
          }}
        >
          {shown.opts.action.label}
        </button>
      )}
    </div>
  );
}

export const useToast = () => useContext(ToastContext);

// ---------- Sheets & dialogs (native <dialog> handles focus and Escape) ----------

export function Sheet({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  // An open sheet holds live updates back until it closes.
  useEffect(() => (open ? holdLive() : undefined), [open]);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className="sheet"
      aria-labelledby={titleId}
      onClose={onClose}
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
      {open && (
        <>
          <div className="sheet-head">
            <h2 id={titleId}>{title}</h2>
            <button className="icon-btn" onClick={onClose} aria-label="Close">
              ✕
            </button>
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
        <a className={`btn small${quiet ? ' secondary' : ''}`} href={href} onClick={() => setOpened(true)}>
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
export function SpotDots({ names, me, celebrate }: { names: string[]; me?: string | null; celebrate?: boolean }) {
  const slots = Math.max(MIN_PLAYERS, names.length);
  // Only balls that appeared since the last render spin in; the first look at a card is still.
  const seen = useRef<number | null>(null);
  const before = seen.current;
  useEffect(() => {
    seen.current = names.length;
  }, [names.length]);
  return (
    <span className={`dots${celebrate ? ' dots-celebrate' : ''}`} role="img" aria-label={`${names.length} in${names.length < MIN_PLAYERS ? `, ${MIN_PLAYERS - names.length} more needed` : ''}`}>
      {Array.from({ length: slots }, (_, i) =>
        i < names.length ? <Pickleball key={i} me={names[i] === me} fresh={before !== null && i >= before} /> : <span key={i} className="dot" />,
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
}: {
  names: string[];
  me?: string | null;
  everyone: string[];
  label?: string;
  children?: ReactNode;
}) {
  // A name that appeared since the last draw (someone joined while you were looking) fades in.
  const seen = useRef<Set<string> | null>(null);
  const before = seen.current;
  useEffect(() => {
    seen.current = new Set(names);
  });
  if (names.length === 0) return null;
  const show = nameLabel([...everyone, ...names]);
  return (
    <p className={label ? 'waitlist-line' : 'names-line'} title={names.join(', ')}>
      {label && `${label}: `}
      {names.map((n, i) => (
        <Fragment key={n + i}>
          {i > 0 && ', '}
          {before && !before.has(n) ? <span className="name-new">{n === me ? <strong>{show(n)}</strong> : show(n)}</span> : n === me ? <strong>{show(n)}</strong> : show(n)}
        </Fragment>
      ))}
      {children}
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
}: {
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
  return (
    <div className="players players-line">
      <div className="players-top">
        <span className="players-count">{countText(names.length, maxPlayers)}</span>
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
