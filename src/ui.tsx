import { createContext, type ReactNode, useCallback, useContext, useEffect, useId, useRef, useState } from 'react';
import { type CourtKind, playerSlots } from '../shared/court';
import type { Tone } from '../shared/status';
import { copyText, isIOS, storageGet, storageSet } from './lib';
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

// ---------- Toasts ----------

const ToastContext = createContext<(msg: string) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const show = useCallback((m: string) => {
    setMsg(m);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setMsg(null), 2600);
  }, []);
  return (
    <ToastContext.Provider value={show}>
      {children}
      <div aria-live="polite" className="sr-only">
        {msg}
      </div>
      {msg && (
        <div className="toast" aria-hidden="true">
          {msg}
        </div>
      )}
    </ToastContext.Provider>
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
        if (e.target === ref.current) onClose();
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
  body,
  openLabel = 'Open in Messages',
}: {
  to: string;
  phone: string | null;
  body: string;
  openLabel?: string;
}) {
  const [opened, setOpened] = useState(false);
  const toast = useToast();
  const [showFallback, setShowFallback] = useState(false);
  const href = smsHref(phone, body, isIOS);
  return (
    <div className="draft">
      <div className="spread">
        <div>
          <strong>{to}</strong>
          <div className="muted small">{phone ? formatPhone(phone) : 'No phone number saved'}</div>
        </div>
        <Chip tone="info">{opened ? 'Message ready' : 'Draft'}</Chip>
      </div>
      <p className="bubble">{body}</p>
      <p className="muted small" aria-live="polite">
        {opened ? <span className="message-ready">Message ready.</span> : null} {opened ? 'Press send in Messages when it looks right.' : ''}
      </p>
      <div className="btn-row" style={{ marginTop: 10 }}>
        <a
          className="btn small"
          href={href}
          onClick={() => {
            setOpened(true);
            // If nothing happens (desktop, no SMS app), offer the copy fallback.
            setTimeout(() => setShowFallback(true), 1500);
          }}
        >
          {openLabel}
        </a>
        <button
          className="btn small secondary"
          onClick={async () => toast((await copyText(body)) ? 'Message copied' : "Couldn't copy. Select the text instead.")}
        >
          Copy message
        </button>
        {phone && (
          <button
            className="btn small secondary"
            onClick={async () => toast((await copyText(phone)) ? 'Number copied' : "Couldn't copy the number.")}
          >
            Copy number
          </button>
        )}
      </div>
      {showFallback && (
        <p className="muted small" style={{ marginTop: 8 }}>
          Messages didn't open? Tap Copy message and paste it into any texting app.
        </p>
      )}
    </div>
  );
}

/** A small heads-up shown once per phone, the first time someone opens the site. */
export function FirstVisitNotice({ children }: { children: ReactNode }) {
  const [show, setShow] = useState(() => !storageGet('pb_seen_intro'));
  if (!show) return null;
  return (
    <div className="hint-banner" role="note">
      <p>{children}</p>
      <button
        className="icon-btn"
        aria-label="Dismiss"
        onClick={() => {
          storageSet('pb_seen_intro', '1');
          setShow(false);
        }}
      >
        ✕
      </button>
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
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  error?: string | null;
}) {
  const id = useId();
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
  <svg {...ICON}>
    <path d="M3.5 10.5 12 3.8l8.5 6.7" />
    <path d="M5.8 9v10.2h12.4V9" />
    <path d="M10 19.2v-5.4h4v5.4" />
  </svg>
);

export const PeopleIcon = () => (
  <svg {...ICON}>
    <circle cx="9" cy="8.5" r="3.2" />
    <path d="M3.2 19.2c.6-3.2 3-5 5.8-5s5.2 1.8 5.8 5" />
    <circle cx="16.8" cy="9.3" r="2.6" />
    <path d="M16.4 14.3c2.3.1 4 1.6 4.5 4.3" />
  </svg>
);

export const GearIcon = () => (
  <svg {...ICON}>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7" />
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
      {kind === 'off' && (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="m5.8 5.8 12.4 12.4" />
        </>
      )}
    </svg>
  );
}

/** "3 of 4 in" with a dot per spot, filled as people sign up, plus any waitlist. */
export function PlayersLine({ confirmed, waiting, waitingWord = 'on the waitlist' }: { confirmed: number; waiting: number; waitingWord?: string }) {
  const slots = playerSlots(confirmed);
  return (
    <div className="players-line">
      <span className="players-count">
        {confirmed} of {slots} in
      </span>
      <span className="dots" aria-hidden="true">
        {Array.from({ length: slots }, (_, i) => (
          <span key={i} className={i < confirmed ? 'dot on' : 'dot'} />
        ))}
      </span>
      {waiting > 0 && (
        <span className="players-wait">
          · {waiting} {waitingWord}
        </span>
      )}
    </div>
  );
}
