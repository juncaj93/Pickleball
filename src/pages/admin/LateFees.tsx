import { useState } from 'react';
import type { AdminRosterEntry, AdminSessionView } from '../../../shared/api';
import { CLEAR_CHOICES, type LateFeeClearWhy, lateFeeAdminNote } from '../../../shared/lateFees';
import { formatPrice } from '../../../shared/money';
import { smsHref } from '../../../shared/messages';
import { api, isIOS } from '../../lib';
import type { AdminCtx } from '../Admin';
import { useAction } from './Sessions';
import { sessionTexts } from './textMenu';

// "Late drops owe $14" (LATE_FEES, shared/lateFees.ts) on the organizer screens: Clear (Sub found / Venue waived /
// My choice) and Find a sub. Shown wherever a late drop or an open late fee is, in the existing styles.

/** A late-fee row's second line on Money: "late drop · owes $14", "canceled, fee not waived · paid $14". */
export function lateFeeLine(r: AdminRosterEntry): string | null {
  if (!r.lateFee) return null;
  const money = r.lateFee.paid ? `paid ${formatPrice(r.paymentAmountCents ?? 0)}${r.selfPaid ? ' · self-marked' : ''}` : `owes ${formatPrice(r.owesCents)}`;
  return `${lateFeeAdminNote(r.lateFee.kind)} · ${money}`;
}

/** "Clear": three small choices, each one tap. The money on the seat comes back to them as credit (History says why). */
export function ClearChoices({ ctx, s, r, onDone }: { ctx: AdminCtx; s: AdminSessionView; r: Pick<AdminRosterEntry, 'playerId' | 'name'>; onDone?: () => void }) {
  const { busy, run } = useAction(ctx);
  const [open, setOpen] = useState(false);
  const clear = async (why: LateFeeClearWhy) => {
    const ok = await run(() => api('POST', `/api/admin/sessions/${s.id}/late-fee`, { playerId: r.playerId, why }), `${r.name}: cleared`);
    if (ok) {
      setOpen(false);
      onDone?.();
    }
  };
  if (!open) {
    return (
      <button type="button" className="btn small secondary" disabled={busy} data-clear-fee={r.name} aria-expanded={false} onClick={() => setOpen(true)}>
        Clear
      </button>
    );
  }
  return (
    <span className="inline-links" role="group" aria-label={`Clear ${r.name}'s $14: why?`} data-clear-choices={r.name}>
      {CLEAR_CHOICES.map((c) => (
        <button key={c.why} type="button" className="btn small secondary" disabled={busy} data-clear-why={c.why} onClick={() => void clear(c.why)}>
          {c.label}
        </button>
      ))}
      <button type="button" className="btn small ghost" disabled={busy} onClick={() => setOpen(false)}>
        Not now
      </button>
    </span>
  );
}

/** "Find a sub": opens Messages with the game's prepared text for the group (the site never sends it). */
export function FindSubLink({ ctx, s }: { ctx: AdminCtx; s: AdminSessionView }) {
  const items = sessionTexts(ctx.d, s, Date.parse(ctx.d.now));
  const it = items.find((x) => x.id === 'need') ?? items.find((x) => x.id === 'share');
  if (!it) return null;
  return (
    <a className="btn small secondary" data-find-sub href={smsHref(it.phones.length ? it.phones : null, it.body, isIOS)} aria-label={`Find a sub: text the group. ${it.body}`}>
      Find a sub
    </a>
  );
}
