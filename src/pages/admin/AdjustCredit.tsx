import { useRef, useState } from 'react';
import type { AdminPlayer } from '../../../shared/api';
import { ADJUST_CHIPS, ADJUST_REASON_MAX, type AdjustDirection, planAdjust, signedPrice } from '../../../shared/adjustCredit';
import { formatPrice, parseDollars } from '../../../shared/money';
import { api } from '../../lib';
import { Sheet } from '../../ui';
import type { AdminCtx } from '../Admin';
import { useAction } from './action';
import '../../adjust-credit.css';

/** The gear sheet's "Adjust credit ›" row, between the name form and Hide player (ADJUST_CREDIT). */
export function AdjustCreditRow({ player, ctx, onOpen }: { player: AdminPlayer; ctx: AdminCtx; onOpen: () => void }) {
  const pot = ctx.d.creditLedger.find((l) => l.playerId === player.id)?.balanceCents ?? 0;
  return (
    <button type="button" className="adj-row" data-adjust-credit-row onClick={onOpen}>
      <span className="adj-row-name">Adjust credit</span>
      <span className="adj-row-hint">{pot > 0 ? `Credit ${formatPrice(pot)}` : 'No credit'}</span>
      <span className="adj-row-chev" aria-hidden="true">
        ›
      </span>
    </button>
  );
}

/**
 * The Adjust credit sheet: Add or Remove, an amount (quick chips $5 $10 $14), a required reason, and "Credit after: $14 → $19".
 * Save stays off until an amount and a reason are filled in. The same rules the server uses (shared/adjustCredit.ts planAdjust);
 * the server checks them again and refuses a save when the credit changed since this sheet was drawn.
 */
export function AdjustCreditSheet({ ctx, player, onClose }: { ctx: AdminCtx; player: AdminPlayer | null; onClose: () => void }) {
  return (
    <Sheet open={!!player} title="Adjust credit" onClose={onClose}>
      {player && <AdjustForm ctx={ctx} player={player} onClose={onClose} />}
    </Sheet>
  );
}

function AdjustForm({ ctx, player, onClose }: { ctx: AdminCtx; player: AdminPlayer; onClose: () => void }) {
  const ledger = ctx.d.creditLedger.find((l) => l.playerId === player.id);
  const pot = ledger?.balanceCents ?? 0;
  const reserved = ledger?.reservedCents ?? 0;
  const [direction, setDirection] = useState<AdjustDirection>('add');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const { busy, run } = useAction(ctx);
  // The pot as this sheet was drawn: the server only saves while the pot is still exactly this.
  const seen = useRef(pot);
  const cents = amount.trim() === '' ? null : parseDollars(amount);
  const typed = amount.trim() !== '';
  // The amount's own mistakes (a dummy reason keeps the reason out of it); the reason is only checked for the Save button.
  const amountPlan = planAdjust({ direction, cents, reason: 'x', potCents: pot, reservedCents: reserved, name: player.name });
  const plan = planAdjust({ direction, cents, reason, potCents: pot, reservedCents: reserved, name: player.name });
  const amountError = typed && !amountPlan.ok ? amountPlan.error : null;
  const chipOn = (c: number) => cents === c;
  async function save() {
    if (!plan.ok || cents === null) return;
    const done = await run(
      () => api('POST', `/api/admin/players/${player.id}/credit-adjust`, { direction, cents, reason, seen: seen.current }),
      `${player.name}: credit ${signedPrice(plan.deltaCents)}, ${formatPrice(plan.afterCents)} now`,
      { key: `adjust:${player.id}`, what: 'Adjust credit', press: true },
    );
    if (done) onClose();
  }
  return (
    <div className="stack adj-sheet" data-adjust-sheet>
      <p className="adj-sub" data-adjust-sub>
        {player.name} · Credit now {formatPrice(pot)}
      </p>
      <div className="segmented" role="group" aria-label="Add or remove">
        <button type="button" aria-pressed={direction === 'add'} data-adjust-dir="add" onClick={() => setDirection('add')}>
          Add
        </button>
        <button type="button" aria-pressed={direction === 'remove'} data-adjust-dir="remove" onClick={() => setDirection('remove')}>
          Remove
        </button>
      </div>
      <div className="adj-field">
        <span className="adj-label" id="adj-amount-label">
          AMOUNT
        </span>
        <div className="adj-amount">
          <label className={`adj-box${amountError ? ' bad' : ''}`}>
            <span aria-hidden="true">$</span>
            <input type="text" inputMode="numeric" aria-labelledby="adj-amount-label" aria-invalid={amountError ? true : undefined} data-adjust-amount value={amount} maxLength={6} onChange={(e) => setAmount(e.target.value)} />
          </label>
          {ADJUST_CHIPS.map((c) => (
            <button key={c} type="button" className={`adj-chip${chipOn(c) ? ' on' : ''}`} data-adjust-chip={c / 100} aria-pressed={chipOn(c)} onClick={() => setAmount(String(c / 100))}>
              {formatPrice(c)}
            </button>
          ))}
        </div>
        {amountError && (
          <p className="adj-error" role="alert" data-adjust-error>
            {amountError}
          </p>
        )}
      </div>
      <div className="adj-field">
        <span className="adj-label" id="adj-reason-label">
          REASON <span className="adj-req">required</span>
        </span>
        <textarea className="adj-reason" rows={2} aria-labelledby="adj-reason-label" data-adjust-reason value={reason} maxLength={ADJUST_REASON_MAX} placeholder="Say why. The player will see this." onChange={(e) => setReason(e.target.value.replace(/\n/g, " "))} />
      </div>
      {amountPlan.ok && (
        <p className="adj-after" data-adjust-after>
          <span>Credit after</span>
          <b>
            {formatPrice(pot)} → {formatPrice(amountPlan.afterCents)}
          </b>
        </p>
      )}
      <div className="adj-btns">
        <button type="button" className="btn secondary" onClick={onClose} disabled={busy}>
          Cancel
        </button>
        <button type="button" className="btn" data-adjust-save disabled={!plan.ok || busy} onClick={() => void save()}>
          {busy ? 'Saving…' : 'Save adjustment'}
        </button>
      </div>
    </div>
  );
}
