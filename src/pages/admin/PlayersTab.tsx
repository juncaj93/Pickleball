import { type FormEvent, useState } from 'react';
import type { AdminPlayer, AdminRosterEntry, AdminSessionView, CreditEntryView } from '../../../shared/api';
import { creditEntryText } from '../../../shared/credit';
import { formatPhone } from '../../../shared/messages';
import { formatPrice, venmoHandleText, venmoRefundUrl } from '../../../shared/money';
import { formatShortDate } from '../../../shared/time';
import { api, ApiError, openVenmo, storageGet, storageSet } from '../../lib';
import { ConfirmDialog, Notice, Sheet, useToast } from '../../ui';
import type { AdminCtx } from '../Admin';
import { balanceOf, heldCents, isPlayed } from './todo';
import '../../credit-admin.css';

const ENDED_TEXT: Record<NonNullable<CreditEntryView['endedReason']>, string> = {
  undone: 'undone',
  unmarked: 'unmarked',
  dropped: 'went back, they dropped out',
  canceled: 'went back, game canceled',
};
const CREDIT_NOTE = 'Pickleball credit refund';

const DAYS = [
  { day: 2, label: 'Tue' },
  { day: 4, label: 'Thu' },
];

export function PlayersTab({ ctx }: { ctx: AdminCtx }) {
  const [editing, setEditing] = useState<AdminPlayer | 'new' | null>(null);
  const [viewing, setViewing] = useState<string | null>(null);
  const shown = viewing ? ctx.d.players.find((p) => p.id === viewing) ?? null : null;
  return (
    <>
      <ul className="card player-list" aria-label="Players">
        {ctx.d.players.map((p) => {
          const { owedCents, creditCents } = balanceOf(ctx.d, p.id);
          // You pay the venue, so there is no player balance on your own row.
          const isMe = ctx.d.me?.id === p.id;
          const pot = ctx.d.creditLedger.find((l) => l.playerId === p.id)?.balanceCents ?? 0;
          const days = p.usualDays.length ? p.usualDays.map((d) => (d === 2 ? 'Tue' : 'Thu')).join(' ') : null;
          const second = [p.phone ? formatPhone(p.phone) : 'No phone', days, p.lateDrops > 0 ? `${p.lateDrops} late drop${p.lateDrops === 1 ? '' : 's'}` : null].filter(Boolean).join(' · ');
          return (
            <li key={p.id} className="player-row" data-player={p.name}>
              <button className="player-open" onClick={() => setViewing(p.id)} aria-label={`${p.name}: money and sessions`}>
                <span className="p-line1">
                  <strong className="p-name">{p.name}</strong>
                  <span className={`p-pill ${p.isRegular ? 'reg' : 'occ'}`}>{p.isRegular ? 'Regular' : 'Occasional'}</span>
                  {p.isNew && <span className="new-tag">New</span>}
                  {!p.isActive && <span className="p-pill hidden-pill">Hidden</span>}
                </span>
                <span className="p-line2">{second}</span>
              </button>
              <span className="p-money">
                {isMe ? null : owedCents > 0 ? (
                  <span className="p-bal owes">Owes {formatPrice(owedCents)}</span>
                ) : creditCents > 0 ? (
                  <span className="p-bal credit">Credit {formatPrice(creditCents)}</span>
                ) : (
                  <span className="p-bal zero">$0</span>
                )}
                {!isMe && heldCents(ctx.d, p.id) > 0 && <span className="p-held">{formatPrice(heldCents(ctx.d, p.id))} held</span>}
                {!isMe && owedCents > 0 && pot > 0 && <span className="p-held p-pot">{formatPrice(pot)} credit</span>}
                {!isMe && ctx.d.refundRequests.some((r) => r.playerId === p.id) && <span className="p-held p-pot">refund requested</span>}
                <span className="p-played">{p.played} played</span>
              </span>
              <button className="btn small secondary p-edit" onClick={() => setEditing(p)} aria-label={`Edit ${p.name}`}>
                Edit
              </button>
              {!isMe && <CreditActions ctx={ctx} player={p} />}
            </li>
          );
        })}
      </ul>
      <button className="btn block" onClick={() => setEditing('new')}>
        Add a person
      </button>
      <Sheet open={!!editing} title={editing === 'new' ? 'Add a person' : `Edit ${editing?.name ?? ''}`} onClose={() => setEditing(null)}>
        {editing && <PlayerForm ctx={ctx} player={editing === 'new' ? null : editing} onDone={() => setEditing(null)} />}
      </Sheet>
      <Sheet open={!!shown} title={shown?.name ?? ''} onClose={() => setViewing(null)}>
        {shown && <PlayerMoney ctx={ctx} player={shown} />}
      </Sheet>
    </>
  );
}

/** The cents whose Venmo button was tapped on this phone, so "Mark refunded" is still there after a reload. */
function readOpenedCredit(playerId: string): number | null {
  try {
    const v = Number(storageGet(`pb_credit_refund_opened_${playerId}`));
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}

/**
 * Pay a player's credit balance back: Refund credit balance opens Venmo (it never marks anything),
 * then Mark refunded records it, and Undo takes the last one back. Used on the row and in the sheet.
 */
function CreditActions({ ctx, player }: { ctx: AdminCtx; player: AdminPlayer }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [, bump] = useState(0);
  const ledger = ctx.d.creditLedger.find((l) => l.playerId === player.id);
  if (!ledger || ctx.d.me?.id === player.id) return null;
  // The usable balance: the pot minus a pending request (that one is answered from its Home card).
  const refundCents = ledger.refundCents;
  const canUndo = ledger.refundCents === 0 && ledger.reservedCents === 0 && ledger.entries.some((e) => e.kind === 'refunded' && !e.endedAt);
  if (refundCents <= 0 && !canUndo) return null;
  const pay = venmoRefundUrl(player.venmo ?? null, refundCents, CREDIT_NOTE);
  const tapped = refundCents > 0 && readOpenedCredit(player.id) === refundCents;
  async function mark(refunded: boolean) {
    setBusy(true);
    try {
      await api('POST', `/api/admin/players/${player.id}/credit-refund`, refunded ? { refunded: true, cents: refundCents } : { refunded: false });
      await ctx.reload();
      toast(refunded ? 'Credit marked refunded' : 'Credit refund undone');
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'That did not work. Try again.', 'error');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="credit-actions" data-credit-actions={player.name}>
      {refundCents > 0 && (
        <a
          className="btn small secondary"
          data-credit-refund={player.name}
          href={pay.url}
          data-app-href={pay.appUrl}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Refund ${player.name} ${formatPrice(refundCents)} credit balance with Venmo`}
          onClick={(e) => {
            openVenmo(e, pay);
            storageSet(`pb_credit_refund_opened_${player.id}`, String(refundCents));
            bump((n) => n + 1);
          }}
        >
          Refund credit balance
        </a>
      )}
      {tapped && (
        <button className="btn small secondary" data-credit-mark={player.name} disabled={busy} onClick={() => mark(true)}>
          Mark refunded
        </button>
      )}
      {canUndo && (
        <button className="btn small secondary" data-credit-undo={player.name} disabled={busy} onClick={() => mark(false)}>
          Undo
        </button>
      )}
    </div>
  );
}

/** The Credit part of a player's sheet: the balance, then the history by game, newest first. */
function CreditSection({ ctx, player }: { ctx: AdminCtx; player: AdminPlayer }) {
  const tz = ctx.d.group.timezone;
  const ledger = ctx.d.creditLedger.find((l) => l.playerId === player.id);
  if (!ledger || ledger.entries.length === 0) return null;
  const line = (e: CreditEntryView): string => creditEntryText(e, tz);
  return (
    <section className="stack credit-section" aria-label="Credit" data-credit-section>
      <h3 className="credit-title">Credit</h3>
      <p className="credit-balance" data-credit-balance>
        <strong>Balance {formatPrice(ledger.balanceCents)}</strong>
        {ledger.reservedCents > 0 && <span className="muted"> · {formatPrice(ledger.reservedCents)} refund requested</span>}
      </p>
      <CreditActions ctx={ctx} player={player} />
      <ul className="credit-history" aria-label="Credit history" data-credit-history>
        {[...ledger.entries].reverse().map((e) => (
          <li key={e.id} className={e.endedAt ? 'ended' : undefined} data-credit-entry={e.kind} data-ended={e.endedAt ? 'true' : undefined}>
            <span className="credit-line">{line(e)}</span>
            {e.endedAt && e.endedReason && <span className="credit-why"> · {ENDED_TEXT[e.endedReason]}</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** A player's page: their balance, then each session's money with Mark paid. */
function PlayerMoney({ ctx, player }: { ctx: AdminCtx; player: AdminPlayer }) {
  const tz = ctx.d.group.timezone;
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const { owedCents, creditCents } = balanceOf(ctx.d, player.id);
  const isMe = ctx.d.me?.id === player.id;
  const rows = ctx.d.sessions
    .map((s) => ({ s, r: s.roster.find((r) => r.playerId === player.id && (r.status === 'confirmed' || r.paymentStatus === 'paid')) }))
    .filter((x): x is { s: AdminSessionView; r: AdminRosterEntry } => !!x.r && !x.s.state.flags.canceled)
    .reverse();
  async function setPaid(s: AdminSessionView, paid: boolean) {
    setBusy(true);
    try {
      await api('POST', `/api/admin/sessions/${s.id}/payment`, { playerId: player.id, paid });
      await ctx.reload();
      toast(paid ? `${player.name} marked paid` : `${player.name} marked unpaid`);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'That did not work. Try again.', 'error');
    } finally {
      setBusy(false);
    }
  }
  if (isMe) {
    return (
      <div className="stack">
        <p className="p-summary">
          <span>You pay the court directly</span>
          <span className="muted"> · {player.played} played</span>
        </p>
        <p className="muted small">Your court payments are on the Money tab, under Who paid.</p>
      </div>
    );
  }
  return (
    <div className="stack">
      <p className="p-summary">
        {owedCents > 0 ? <strong>Owes {formatPrice(owedCents)}</strong> : <span>Owes nothing</span>}
        {creditCents > 0 && <span className="p-bal credit"> · Credit {formatPrice(creditCents)}</span>}
        <span className="muted"> · {player.played} played</span>
      </p>
      <CreditSection ctx={ctx} player={player} />
      {rows.length === 0 ? (
        <p className="muted">No sessions yet.</p>
      ) : (
        <ul className="rows player-money" aria-label="Sessions">
          {rows.map(({ s, r }) => {
            const withCredit = r.creditCents > 0 && r.paymentStatus === 'paid';
            const allCredit = withCredit && r.creditCents >= (r.paymentAmountCents ?? 0);
            const amount = r.paymentStatus === 'paid' ? (r.paymentAmountCents ?? 0) : r.shareCents !== null ? r.owesCents : null;
            const paidText = allCredit ? 'Paid with credit' : `Paid ${formatPrice(amount ?? 0)}`;
            const back = r.creditBackCents > 0 ? ` · ${formatPrice(r.creditBackCents)} back as credit` : '';
            return (
              <li key={s.id} data-session={s.id}>
                <span className="who">
                  <span>
                    <strong>{formatShortDate(s.startsAt, tz)}</strong>
                    {r.selfPaid && r.paymentStatus === 'paid' && <span className="self-tag">self-marked</span>}
                  </span>
                  <span className="small muted">
                    {r.paymentStatus === 'paid' ? (
                      isPlayed(s) || r.refundedAt ? (
                        `${paidText}${back}`
                      ) : (
                        <span className="held-amt">{paidText}, not finalized yet</span>
                      )
                    ) : amount !== null && amount > 0 ? (
                      `${formatPrice(amount)} unpaid`
                    ) : (
                      `Nothing owed${back}`
                    )}
                    {withCredit && !allCredit ? ` · ${formatPrice(r.creditCents)} from credit` : ''}
                    {s.finalized && r.played === false ? ' · did not play' : ''}
                  </span>
                </span>
                <span className="btn-row">
                  {r.paymentStatus === 'paid' ? (
                    <>
                      {r.selfPaid && (
                        <button className="btn small secondary" disabled={busy} onClick={() => setPaid(s, true)}>
                          Mark paid
                        </button>
                      )}
                      <button className="btn small secondary" disabled={busy} onClick={() => setPaid(s, false)}>
                        Unmark
                      </button>
                    </>
                  ) : (
                    r.status === 'confirmed' &&
                    amount !== null &&
                    amount > 0 && (
                      <button className="btn small secondary" disabled={busy} onClick={() => setPaid(s, true)}>
                        Mark paid
                      </button>
                    )
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function PlayerForm({ ctx, player, onDone }: { ctx: AdminCtx; player: AdminPlayer | null; onDone: () => void }) {
  const toast = useToast();
  const [name, setName] = useState(player?.name ?? '');
  const [phone, setPhone] = useState(player?.phone ? formatPhone(player.phone) : '');
  const [venmo, setVenmo] = useState(venmoHandleText(player?.venmo ?? null));
  const [isRegular, setRegular] = useState(player?.isRegular ?? true);
  const [days, setDays] = useState<number[]>(player?.usualDays ?? []);
  const [isActive, setActive] = useState(player?.isActive ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [askRemove, setAskRemove] = useState(false);

  async function remove() {
    if (!player) return;
    setBusy(true);
    try {
      const res = await api<{ result: 'deleted' | 'hidden' }>('DELETE', `/api/admin/players/${player.id}`);
      toast(res.result === 'deleted' ? `${player.name} removed` : `${player.name} hidden`);
      await ctx.reload();
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not remove.');
    } finally {
      setBusy(false);
      setAskRemove(false);
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const body = {
      name,
      phone: phone || null,
      isRegular,
      isActive,
      canReceiveSubstituteInvites: player?.canReceiveSubstituteInvites ?? true,
      usualDays: days,
      venmo,
    };
    try {
      if (player) await api('PUT', `/api/admin/players/${player.id}`, body);
      else await api('POST', '/api/admin/players', body);
      toast(player ? 'Saved' : 'Added');
      await ctx.reload();
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
    <form className="stack" onSubmit={submit}>
      <label className="field">
        Name
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} required />
      </label>
      <label className="field">
        Phone (optional)
        <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={25} placeholder="(248) 555-1234" />
      </label>
      <label className="field">
        Venmo link or @name (optional)
        <input
          type="text"
          value={venmo}
          onChange={(e) => setVenmo(e.target.value)}
          maxLength={120}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          placeholder="@Name or venmo.com/u/Name"
        />
        <span className="small muted">For refunds. Only you see this.</span>
      </label>
      <div className="stack" style={{ gap: 6 }}>
        <span className="small" style={{ fontWeight: 600 }}>
          Plays
        </span>
        <div className="segmented" role="group" aria-label="Regular or occasional">
          <button type="button" aria-pressed={isRegular} onClick={() => setRegular(true)}>
            Regular
          </button>
          <button type="button" aria-pressed={!isRegular} onClick={() => setRegular(false)}>
            Occasional
          </button>
        </div>
      </div>
      <div className="stack" style={{ gap: 6 }}>
        <span className="small" style={{ fontWeight: 600 }}>
          Usual days
        </span>
        <div className="segmented" role="group" aria-label="Usual days">
          {DAYS.map(({ day, label }) => (
            <button
              type="button"
              key={day}
              aria-pressed={days.includes(day)}
              onClick={() => setDays((cur) => (cur.includes(day) ? cur.filter((d) => d !== day) : [...cur, day].sort()))}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <label className="check">
        <input type="checkbox" checked={!isActive} onChange={(e) => setActive(!e.target.checked)} />
        Hide from the name list
      </label>
      {error && <Notice tone="danger">{error}</Notice>}
      <button className="btn" type="submit" disabled={busy}>
        {busy ? 'Saving…' : 'Save'}
      </button>
      {player && (
        <button type="button" className="btn danger" disabled={busy} onClick={() => setAskRemove(true)}>
          Remove from list
        </button>
      )}
    </form>
      <ConfirmDialog
        open={askRemove}
        title={`Remove ${player?.name ?? ''}?`}
        body="If they never signed up or paid, the name is deleted. If they have any history, it's hidden instead so old sessions and payments stay correct."
        confirmLabel="Remove"
        danger
        busy={busy}
        onConfirm={remove}
        onCancel={() => setAskRemove(false)}
      />
    </>
  );
}
