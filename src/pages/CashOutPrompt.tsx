import { useCallback, useEffect, useRef, useState } from 'react';
import { formatPrice } from '../../shared/money';
import { holdLive } from '../busy';
import { api, ApiError, isDemo } from '../lib';
import { useToast } from '../ui';
import { canMove } from '../motion';
import '../alert-cards.css';
import { AcIcon, AcTitle } from '../AlertCard';

/**
 * The one question after I'm in when a cash out is pending and the player's
 * other credit doesn't cover the game: "Use the $10 you asked to cash out for
 * this game?" A small sheet at the bottom, in the pop-up banner's style, never
 * part of a card. "Use it" puts that money on the game (the request shrinks or
 * goes); "No, keep cash out" just closes it: they are in and pay as usual.
 */
export function CashOutPrompt({
  sessionId,
  cents,
  onClose: closeNow,
  onChanged,
  card,
}: {
  sessionId: string;
  cents: number;
  onClose: () => void;
  onChanged: () => Promise<void>;
  /** Zip 11, Alert cards: the same question as a blue card ("Use your $10 cash out for this game?", "You asked Alex to cash out $10"). */
  card?: { requestCents: number; organizer: string };
}) {
  const toast = useToast();
  // With the motion on it slides down in 150 ms before it is gone (the question is already answered by then).
  const [leaving, setLeaving] = useState(false);
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(leaveTimer.current), []);
  const onClose = useCallback(() => {
    if (!canMove()) return closeNow();
    setLeaving(true);
    leaveTimer.current = setTimeout(closeNow, 150);
  }, [closeNow]);
  const [busy, setBusy] = useState(false);
  const working = useRef(false);
  const first = useRef<HTMLButtonElement>(null);
  // Live updates wait while the question is open, so the card under it doesn't jump.
  useEffect(() => holdLive(), []);
  useEffect(() => {
    first.current?.focus();
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);

  async function useIt() {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    try {
      const res = await api<{ paid: boolean }>('POST', `/api/sessions/${sessionId}/use-cash-out`, { cents });
      toast(res.paid ? 'Paid with credit' : `Used ${formatPrice(cents)} of your cash out`);
    } catch (err) {
      if (isDemo(err)) toast(err.message);
      else toast(err instanceof ApiError ? err.message : 'That did not work. Try again.', 'error');
    } finally {
      working.current = false;
      setBusy(false);
      onClose();
      await onChanged();
    }
  }

  if (card) {
    return (
      <div className={`cashout-prompt ac ac-blue ac-stacked${leaving ? ' m-leaving' : ''}`} role="dialog" aria-modal="false" aria-labelledby="cashout-q" data-cashout-prompt data-alert-card="blue">
        <div className="ac-row">
          <AcIcon name="credit" />
          <div className="ac-text">
            <AcTitle id="cashout-q">Use your {formatPrice(cents)} cash out for this game?</AcTitle>
            <div className="ac-sub">
              You asked {card.organizer} to cash out {formatPrice(card.requestCents)}
            </div>
          </div>
        </div>
        <div className="ac-actions">
          <button ref={first} className="ac-btn" disabled={busy} onClick={useIt} data-cashout-use>
            {busy ? 'Saving…' : 'Use it'}
          </button>
          <button className="ac-btn ac-out" disabled={busy} onClick={onClose} data-cashout-keep>
            No, keep cash out
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className={`cashout-prompt${leaving ? ' m-leaving' : ''}`} role="dialog" aria-modal="false" aria-labelledby="cashout-q" data-cashout-prompt>
      <p id="cashout-q" className="cashout-q">
        Use the {formatPrice(cents)} you asked to cash out for this game?
      </p>
      <div className="cashout-btns">
        <button ref={first} className="btn cashout-use" disabled={busy} onClick={useIt} data-cashout-use>
          {busy ? 'Saving…' : 'Use it'}
        </button>
        <button className="btn secondary cashout-keep" disabled={busy} onClick={onClose} data-cashout-keep>
          No, keep cash out
        </button>
      </div>
    </div>
  );
}
