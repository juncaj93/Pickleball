import { createContext, type ReactNode, useCallback, useContext, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { type CourtKind, playerSlots } from '../shared/court';
import type { Tone } from '../shared/status';
import { isIOS } from './lib';
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

// ---------- Confirmation bubbles ----------
//
// A small speech bubble next to the button that was tapped, with a tiny
// pointer toward it. Shown in the top layer (above any open sheet), it never
// moves the page and stays on screen near the edges. Screen readers hear it
// through a live region. Confirmations last about 2 seconds, errors 4.

type ToastKind = 'ok' | 'error';
type ToastFn = (msg: string, kind?: ToastKind) => void;

const ToastContext = createContext<ToastFn>(() => {});

/** The element the person last tapped or pressed Enter on, so the bubble can point at it. */
let lastTarget: { el: Element; rect: DOMRect; at: number } | null = null;
if (typeof document !== 'undefined') {
  const remember = (el: EventTarget | null) => {
    const hit = el instanceof Element ? el.closest('button, a, [role="button"], label, summary') : null;
    if (hit) lastTarget = { el: hit, rect: hit.getBoundingClientRect(), at: Date.now() };
  };
  document.addEventListener('pointerdown', (e) => remember(e.target), true);
  document.addEventListener('click', (e) => remember(e.target), true);
  document.addEventListener('keydown', (e) => (e.key === 'Enter' || e.key === ' ') && remember(document.activeElement), true);
}

interface Shown {
  id: number;
  msg: string;
  kind: ToastKind;
  /** Viewport box of the tapped button, or null to sit above the bottom bar. */
  anchor: { top: number; bottom: number; left: number; right: number } | null;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [shown, setShown] = useState<Shown | null>(null);
  const [spoken, setSpoken] = useState<{ msg: string; kind: ToastKind } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const show = useCallback<ToastFn>((msg, kind = 'ok') => {
    let anchor: Shown['anchor'] = null;
    if (lastTarget && Date.now() - lastTarget.at < 15_000) {
      const live = lastTarget.el.isConnected ? lastTarget.el.getBoundingClientRect() : null;
      // A button that's gone (a sheet closed) or scrolled away gets the fallback spot.
      const r = live && live.width > 0 ? live : null;
      if (r && r.bottom > 0 && r.top < window.innerHeight) anchor = { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
    }
    setShown({ id: Date.now(), msg, kind, anchor });
    setSpoken({ msg, kind });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setShown(null), kind === 'error' ? 4000 : 2000);
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
      {shown && <Bubble key={shown.id} shown={shown} />}
    </ToastContext.Provider>
  );
}

function Bubble({ shown }: { shown: Shown }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // The top layer keeps it above an open sheet; older browsers fall back to a high z-index.
    try {
      if ('showPopover' in el) (el as HTMLElement & { showPopover: () => void }).showPopover();
    } catch {
      /* already showing */
    }
    const vw = document.documentElement.clientWidth;
    const vh = window.innerHeight;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const gap = 10;
    const margin = 8;
    const a = shown.anchor;
    let top: number;
    let center: number;
    let below = false;
    if (a) {
      center = (a.left + a.right) / 2;
      below = a.top - h - gap < margin + 4;
      top = below ? a.bottom + gap : a.top - h - gap;
      top = Math.min(Math.max(top, margin), vh - h - margin);
    } else {
      center = vw / 2;
      top = vh - h - 96; // above the bottom bar
    }
    const left = Math.min(Math.max(center - w / 2, margin), vw - w - margin);
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
    el.style.setProperty('--arrow-x', `${Math.min(Math.max(center - left, 14), w - 14)}px`);
    el.dataset.side = a ? (below ? 'below' : 'above') : 'none';
    el.style.visibility = 'visible';
  }, [shown]);
  return (
    <div
      ref={ref}
      popover="manual"
      className={`pop toast${shown.kind === 'error' ? ' pop-error' : ''}`}
      aria-hidden="true"
      style={{ visibility: 'hidden' }}
    >
      {shown.msg}
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
}: {
  to: string;
  phone: string | null;
  /** Several recipients at once (a group message). */
  phones?: string[];
  /** Names with no number saved, shown in small text. */
  missing?: string[];
  body: string;
  openLabel?: string;
}) {
  const [opened, setOpened] = useState(false);
  // No numbers saved: Messages opens with just the words, to pick a group chat.
  const href = smsHref(phones && phones.length ? phones : phone, body, isIOS);
  return (
    <div className="draft">
      <div className="spread">
        <div>
          <strong>{to}</strong>
          <div className="muted small">
            {phones ? (phones.length ? `${phones.length} number${phones.length === 1 ? '' : 's'}` : 'No numbers saved: pick a group chat') : phone ? formatPhone(phone) : 'Pick who to send it to in Messages'}
          </div>
          {missing && missing.length > 0 && <div className="small missing-numbers">Missing numbers: {missing.join(', ')}</div>}
        </div>
        <Chip tone="info">{opened ? 'Message ready' : 'Draft'}</Chip>
      </div>
      <p className="bubble">{body}</p>
      <p className="muted small" aria-live="polite">
        {opened ? <span className="message-ready">Message ready.</span> : null} {opened ? 'Press send in Messages when it looks right.' : ''}
      </p>
      <div className="btn-row" style={{ marginTop: 10 }}>
        <a className="btn small" href={href} onClick={() => setOpened(true)}>
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

/**
 * One mark per spot: 4, or 6 once more than 4 are in. Names fill in sign-up
 * order as small pills; open spots are small empty circles.
 */
export function SpotPills({ names, me }: { names: string[]; me?: string | null }) {
  const slots = playerSlots(names.length);
  return (
    <ul className="in-pills spots" aria-label="Who's in">
      {Array.from({ length: slots }, (_, i) =>
        i < names.length ? (
          <li key={i} className={names[i] === me ? 'me' : undefined} title={names[i]}>
            {names[i]}
          </li>
        ) : (
          <li key={i} className="open">
            <span className="sr-only">Open spot</span>
          </li>
        ),
      )}
    </ul>
  );
}

/** "3 of 4 in" plus any waitlist and a short note, then a pill per spot with names. */
export function PlayersLine({
  names,
  waiting,
  waitingWord = 'on the waitlist',
  extra,
}: {
  /** Confirmed players, in sign-up order. */
  names: string[];
  waiting: number;
  waitingWord?: string;
  /** A short note at the end, like "2/4 paid". */
  extra?: string | null;
}) {
  return (
    <div className="players players-line">
      <span className="players-count">
        {names.length} of {playerSlots(names.length)} in
      </span>
      <SpotPills names={names} />
      {waiting > 0 && (
        <span className="players-wait">
          · {waiting} {waitingWord}
        </span>
      )}
      {extra && <span className="players-wait">· {extra}</span>}
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
