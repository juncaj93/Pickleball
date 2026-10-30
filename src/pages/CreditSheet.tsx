import { useEffect, useState } from 'react';
import type { CreditView } from '../../shared/api';
import { creditEntryText } from '../../shared/credit';
import { formatPrice, parseDollars } from '../../shared/money';
import { api, ApiError, isDemo } from '../lib';
import { Notice, Sheet, useToast } from '../ui';

const SHOW_HISTORY = 8;

/**
 * The small "CREDIT $14" chip in the player's header, right before the date
 * tile and the same height. Only their own credit, only when there is some
 * (or a refund request is waiting). Tapping it opens the credit sheet.
 */
export function CreditChip({ credit, onOpen }: { credit: CreditView; onOpen: () => void }) {
  const pending = !!credit.pending;
  return (
    <button
      type="button"
      className={`credit-chip${pending ? ' pending' : ''}`}
      data-credit-chip
      aria-label={`${formatPrice(credit.balanceCents)} credit${pending ? ', refund requested' : ''}. Open your credit`}
      onClick={onOpen}
    >
      <span className="cc-label" aria-hidden="true">
        {pending ? 'REFUND' : 'CREDIT'}
      </span>
      <span className="cc-amount" aria-hidden="true">
        {formatPrice(credit.balanceCents)}
      </span>
    </button>
  );
}

/**
 * The credit sheet: the balance, a short history, Request refund (the amount
 * is reserved until the organizer answers), and one gray line. Opening Venmo
 * is the organizer's side; nothing here moves money by itself.
 */
export function CreditSheet({ open, credit, tz, onClose, onChanged }: { open: boolean; credit: CreditView; tz: string; onClose: () => void; onChanged: () => Promise<void> }) {
  const toast = useToast();
  const [asking, setAsking] = useState(false);
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  useEffect(() => {
    if (!open) {
      setAsking(false);
      setError(null);
      setMore(false);
    }
  }, [open]);
  const history = more ? credit.history : credit.history.slice(0, SHOW_HISTORY);

  async function run(fn: () => Promise<unknown>, done: string) {
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
    void run(() => api('POST', '/api/me/refund-request', { cents }), 'Refund requested');
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
              Refund requested: <strong>{formatPrice(credit.pending.cents)}</strong>, pending
            </span>
            <button className="link-btn" disabled={busy} onClick={() => void run(() => api('POST', '/api/me/refund-request/cancel', {}), 'Request canceled')}>
              Cancel request
            </button>
          </div>
        ) : asking ? (
          <div className="stack refund-ask" data-refund-ask>
            <label className="field">
              Refund amount
              <span className="money-input">
                <span aria-hidden="true">$</span>
                <input type="text" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} aria-invalid={error ? true : undefined} autoFocus />
              </span>
            </label>
            {error && <Notice tone="danger">{error}</Notice>}
            <div className="btn-row">
              <button className="btn" disabled={busy} onClick={request}>
                {busy ? 'Sending…' : 'Request refund'}
              </button>
              <button className="btn secondary" disabled={busy} onClick={() => setAsking(false)}>
                Back
              </button>
            </div>
          </div>
        ) : (
          credit.usableCents > 0 && (
            <button className="btn secondary" data-request-refund disabled={busy} onClick={startAsking}>
              Request refund
            </button>
          )
        )}
        {error && !asking && <Notice tone="danger">{error}</Notice>}
        {history.length > 0 && (
          <ul className="credit-history" aria-label="Credit history" data-credit-history>
            {history.map((e) => (
              <li key={e.id} data-credit-entry={e.kind}>
                {creditEntryText(e, tz)}
              </li>
            ))}
          </ul>
        )}
        {credit.history.length > SHOW_HISTORY && (
          <button className="link-btn" onClick={() => setMore((v) => !v)}>
            {more ? 'Fewer' : 'More'}
          </button>
        )}
        <p className="small muted">Use your credit when you pay for a game.</p>
      </div>
    </Sheet>
  );
}
