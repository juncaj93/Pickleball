import { useEffect, useRef, useState } from 'react';
import { formatPrice } from '../../shared/money';
import { holdLive } from '../busy';
import { api, ApiError, isDemo } from '../lib';
import { useToast } from '../ui';

/**
 * The one question after I'm in when a cash out is pending and the player's
 * other credit doesn't cover the game: "Use the $10 you asked to cash out for
 * this game?" A small sheet at the bottom, in the pop-up banner's style, never
 * part of a card. "Use it" puts that money on the game (the request shrinks or
 * goes); "No, keep cash out" just closes it: they are in and pay as usual.
 */
export function CashOutPrompt({ sessionId, cents, onClose, onChanged }: { sessionId: string; cents: number; onClose: () => void; onChanged: () => Promise<void> }) {
  const toast = useToast();
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

  return (
    <div className="cashout-prompt" role="dialog" aria-modal="false" aria-labelledby="cashout-q" data-cashout-prompt>
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
