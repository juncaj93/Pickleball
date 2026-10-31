import { useEffect, useRef, useState } from 'react';
import type { CreditView } from '../../shared/api';
import { creditChanges } from '../../shared/credit';
import { formatPrice, parseDollars } from '../../shared/money';
import { api, ApiError, isDemo } from '../lib';
import { Notice, Sheet, useToast } from '../ui';

/** The credit sheet lists this many of the latest changes. */
const SHOW_CHANGES = 10;

// Credit chip count-up (all timings in one place, easy to tweak).
const CHIP_COUNT_MS = 750;
const CHIP_PULSE_MS = 450;

const reducedMotion = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/**
 * The small "CREDIT $14" chip in the player's header, right before the date
 * tile and the same height. Only their own credit, only when there is some
 * (or a cash-out request is waiting). Tapping it opens the credit sheet.
 * When the credit goes up it counts up to the new amount, then pulses once.
 * `startFrom` is what the screen showed before this chip appeared (a chip
 * that was not there fades in and counts up from it).
 */
export function CreditChip({ credit, onOpen, startFrom }: { credit: CreditView; onOpen: () => void; startFrom?: number | null }) {
  const pending = !!credit.pending;
  const target = credit.balanceCents;
  const [shown, setShown] = useState(() => (startFrom != null && startFrom < target && !reducedMotion() ? startFrom : target));
  const [fresh] = useState(() => startFrom != null && startFrom < target && !reducedMotion());
  const [pulse, setPulse] = useState(false);
  const shownRef = useRef(shown);
  shownRef.current = shown;
  useEffect(() => {
    const from = shownRef.current;
    if (from === target) return;
    if (target < from || reducedMotion()) {
      setShown(target);
      return;
    }
    let raf = 0;
    let pulseTimer: ReturnType<typeof setTimeout> | undefined;
    const t0 = performance.now();
    const tick = (now: number) => {
      const k = Math.min(1, (now - t0) / CHIP_COUNT_MS);
      const eased = 1 - Math.pow(1 - k, 3);
      const v = from + (target - from) * eased;
      // Whole dollars all the way up (credit is in whole dollars), so the chip never shows cents on the way.
      setShown(from % 100 === 0 && target % 100 === 0 ? Math.round(v / 100) * 100 : Math.round(v));
      if (k < 1) raf = requestAnimationFrame(tick);
      else {
        setPulse(true);
        pulseTimer = setTimeout(() => setPulse(false), CHIP_PULSE_MS);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(pulseTimer);
      setPulse(false);
    };
  }, [target]);
  const text = formatPrice(shown);
  return (
    <button
      type="button"
      className={`credit-chip${pending ? ' pending' : ''}${pulse ? ' pulse' : ''}${fresh ? ' fresh' : ''}`}
      data-credit-chip
      aria-label={`${formatPrice(target)} credit${pending ? ', cash out requested' : ''}. Open your credit`}
      onClick={onOpen}
    >
      <span className="cc-label" aria-hidden="true">
        {pending ? 'CASH OUT' : 'CREDIT'}
      </span>
      <span className="cc-amount" aria-hidden="true">
        {/* The finished number, invisible, holds the width so counting up never moves the chip. */}
        <span className="cc-ghost">{formatPrice(target)}</span>
        <span className="cc-now">{text}</span>
      </span>
    </button>
  );
}

/**
 * The credit sheet: the balance, a short history, Request cash out (the amount
 * is reserved until the organizer answers), and one gray line. Opening Venmo
 * is the organizer's side; nothing here moves money by itself.
 */
export function CreditSheet({ open, credit, tz, organizerName = 'Alex', onClose, onChanged }: { open: boolean; credit: CreditView; tz: string; organizerName?: string; onClose: () => void; onChanged: () => Promise<void> }) {
  const toast = useToast();
  const [asking, setAsking] = useState(false);
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  // Set at once (state waits for a redraw), so a quick second tap is ignored instead of flashing an error.
  const working = useRef(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) {
      setAsking(false);
      setError(null);
    }
  }, [open]);
  // Every change to their credit in plain words, newest first, returns included ("Oct 31: $14 returned from Nov 5 (you dropped)").
  const changes = creditChanges(credit.history, tz, organizerName, SHOW_CHANGES);

  async function run(fn: () => Promise<unknown>, done: string) {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    setError(null);
    try {
      await fn();
      toast(done);
      await onChanged();
      setAsking(false);
    } catch (err) {
      if (isDemo(err)) toast(err.message);
      else setError(err instanceof ApiError ? err.message : 'That did not work. Try again.');
    } finally {
      working.current = false;
      setBusy(false);
    }
  }

  function startAsking() {
    setAmount(String(Math.floor(credit.usableCents / 100)));
    setAsking(true);
    setError(null);
  }

  function request() {
    const cents = parseDollars(amount);
    if (cents === null || cents <= 0 || cents % 100 !== 0) return setError('Enter a whole-dollar amount, like 14.');
    if (cents > credit.usableCents) return setError(`You have ${formatPrice(credit.usableCents)} credit.`);
    void run(() => api('POST', '/api/me/refund-request', { cents }), 'Cash out requested');
  }

  return (
    <Sheet open={open} title="Your credit" onClose={onClose}>
      <div className="stack credit-sheet" data-credit-sheet>
        <p className="credit-big" data-credit-balance>
          <strong>{formatPrice(credit.balanceCents)} credit</strong>
        </p>
        {credit.pending ? (
          <div className="credit-pending" data-refund-pending>
            <span>
              Cash out requested: <strong>{formatPrice(credit.pending.cents)}</strong>, pending
            </span>
            <button className="link-btn" disabled={busy} onClick={() => void run(() => api('POST', '/api/me/refund-request/cancel', {}), 'Request canceled')}>
              Cancel request
            </button>
          </div>
        ) : asking ? (
          <div className="stack refund-ask" data-refund-ask>
            <label className="field">
              Cash out amount
              <span className="money-input">
                <span aria-hidden="true">$</span>
                <input type="text" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} aria-invalid={error ? true : undefined} autoFocus />
              </span>
            </label>
            {error && <Notice tone="danger">{error}</Notice>}
            <div className="btn-row">
              <button className="btn" disabled={busy} onClick={request}>
                {busy ? 'Sending…' : `Request cash out from ${organizerName}`}
              </button>
              <button className="btn secondary" disabled={busy} onClick={() => setAsking(false)}>
                Back
              </button>
            </div>
          </div>
        ) : (
          credit.usableCents > 0 && (
            <button className="btn secondary" data-request-refund disabled={busy} onClick={startAsking}>
              Request cash out from {organizerName}
            </button>
          )
        )}
        {error && !asking && <Notice tone="danger">{error}</Notice>}
        {changes.length > 0 && (
          <ul className="credit-history" aria-label="Latest credit changes" data-credit-history>
            {changes.map((c) => (
              <li key={c.key} data-credit-change>
                {c.text}
              </li>
            ))}
          </ul>
        )}
        <p className="small muted">Your credit goes on a game by itself when you tap I'm in.</p>
      </div>
    </Sheet>
  );
}
