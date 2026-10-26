import { createContext, type ReactNode, useCallback, useContext, useEffect, useId, useRef, useState } from 'react';
import type { Tone } from '../shared/status';
import { copyText, isIOS } from './lib';
import { smsHref } from '../shared/messages';
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

type DraftState = 'ready' | 'opened' | 'sent';

/**
 * A prewritten text. Opening Messages only fills in the composer; the
 * organizer still has to press send. "Mark as sent" is the organizer's own
 * note and is kept on this screen only.
 */
export function SmsDraft({ to, phone, body }: { to: string; phone: string | null; body: string }) {
  const [state, setState] = useState<DraftState>('ready');
  const toast = useToast();
  const [showFallback, setShowFallback] = useState(false);
  const href = smsHref(phone, body, isIOS);
  const statusText: Record<DraftState, string> = {
    ready: 'Draft ready',
    opened: 'Messages opened. Not sent until you press send there.',
    sent: 'You marked this as sent',
  };
  return (
    <div className="draft">
      <div className="spread">
        <div>
          <strong>{to}</strong>
          <div className="muted small">{phone ?? 'No phone number saved'}</div>
        </div>
        <Chip tone={state === 'sent' ? 'ok' : 'info'}>{state === 'sent' ? 'Marked sent' : state === 'opened' ? 'Composer opened' : 'Draft ready'}</Chip>
      </div>
      <p className="bubble">{body}</p>
      <p className="muted small" aria-live="polite">
        {statusText[state]}
      </p>
      <div className="btn-row" style={{ marginTop: 10 }}>
        <a
          className="btn small"
          href={href}
          onClick={() => {
            setState((s) => (s === 'sent' ? s : 'opened'));
            // If nothing happens (desktop, no SMS app), offer the copy fallback.
            setTimeout(() => setShowFallback(true), 1500);
          }}
        >
          Open in Messages
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
        {state === 'opened' && (
          <button className="btn small ghost" onClick={() => setState('sent')}>
            I sent it
          </button>
        )}
      </div>
      {showFallback && state !== 'sent' && (
        <p className="muted small" style={{ marginTop: 8 }}>
          Messages didn't open? Tap Copy message and paste it into any texting app.
        </p>
      )}
    </div>
  );
}

export function NotSentNote() {
  return (
    <Notice tone="info" title="Texts are never sent automatically">
      The site writes each message. You review it and press send in your phone's Messages app.
    </Notice>
  );
}
