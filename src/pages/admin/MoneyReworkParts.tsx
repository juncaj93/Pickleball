import { useRef, useState } from 'react';
import type { AdminDashboard, AdminRosterEntry, AdminSessionView } from '../../../shared/api';
import { formatPrice, parseDollars } from '../../../shared/money';
import { formatShortDate } from '../../../shared/time';
import { smsHref } from '../../../shared/messages';
import { api, ApiError, isIOS } from '../../lib';
import { ConfirmDialog, Sheet, useToast } from '../../ui';
import type { AdminCtx } from '../Admin';
import { useReworkBusy, useReworkRun } from './ReworkOps';
import { CreditBackList, useAction } from './Sessions';
import { owedCentsOf, unpaidRows } from './moneyList';
import { canTextAll, groupRemindText, missingNumberNote, textAllRecipients } from './moneyRework';
import { reminderText } from './textMenu';
import '../../money-rework.css';

// The reworked Money page's shared pieces (MONEY_REWORK): the player rows of an open game, the body of a canceled game with nobody
// owing, "Hide from list" and "Edit charge". Same actions and same rules as the Money tabs before it; only the way they are shown changed.

export type Act = { label: string; onClick: () => void; attrs?: Record<string, string> };

/**
 * One row per player, unpaid first and paid below (the caller sorts). An unpaid row has a white outlined "Mark paid"; a paid row is
 * tinted green with "Paid" and Undo; one paid with credit is tinted blue with "Credit" and Undo. Tapping a name opens the full line and any
 * other action (Clear, Undo of a credit). Every action here is the one the older Money tab offered for that row, nothing new.
 */
export function ReworkRows({
  sessionId,
  rows,
  actionsOf,
  isPaid,
  lineOf,
  busy,
}: {
  sessionId: string;
  rows: AdminRosterEntry[];
  actionsOf: (r: AdminRosterEntry) => Act[];
  isPaid: (r: AdminRosterEntry) => boolean;
  lineOf: (r: AdminRosterEntry) => { short: string; full: string };
  busy: boolean;
}) {
  const [tapped, setTapped] = useState<string | null>(null);
  // While a save for a row is still running its buttons wait, so a second tap cannot double-save.
  const rowBusy = useReworkBusy();
  return (
    <ul className="mrw-rows" aria-label="Who paid">
      {rows.map((r) => {
        const acts = actionsOf(r);
        const markPaid = acts.find((a) => a.label === 'Mark paid');
        const undo = acts.find((a) => a.label === 'Unmark');
        const extra = acts.filter((a) => a !== markPaid && a !== undo);
        const paid = isPaid(r);
        const asked = !!markPaid && paid; // "I paid" waiting for you to confirm
        const credit = paid && !r.lateFee && r.creditCents > 0 && r.creditCents >= (r.paymentAmountCents ?? 0);
        const part = !paid && r.creditCents > 0;
        const { short, full } = lineOf(r);
        const wait = busy || rowBusy({ kind: 'paid', sessionId, playerId: r.playerId });
        const sub = r.lateFee || asked || part ? short : '';
        const open = tapped === r.playerId;
        const cls = asked ? '' : credit ? ' credit' : paid ? ' paid' : '';
        // Part credit (unpaid) and "I paid" keep their second action inside the opened row so the line stays short.
        const inline = !asked && !part && paid ? undo : undefined;
        const hidden = [...(asked || part ? (undo ? [undo] : []) : []), ...extra];
        return (
          <li key={r.playerId} className={`mrw-row${cls}${open ? ' open' : ''}`} data-pay-row={r.name} data-row-id={r.playerId} data-paid={paid && !asked ? 'yes' : 'no'}>
            <div className="mrw-line">
              <button type="button" className="mrw-who" aria-expanded={open} onClick={() => setTapped((cur) => (cur === r.playerId ? null : r.playerId))}>
                <strong className="mrw-name">{r.name}</strong>
                {sub && <span className="mrw-sub">{sub}</span>}
              </button>
              {paid && !asked && (
                <span className={`mrw-state ${credit ? 'credit' : 'ok'}`} data-state={credit ? 'credit' : 'paid'}>
                  <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="m5 12 5 5 9-10" />
                  </svg>
                  {credit ? 'Credit' : 'Paid'}
                </span>
              )}
              {inline && (
                <button type="button" className="mrw-undo" disabled={wait} onClick={inline.onClick} {...inline.attrs}>
                  Undo
                </button>
              )}
              {markPaid && (
                <button type="button" className="mrw-mark" disabled={wait} onClick={markPaid.onClick} {...markPaid.attrs}>
                  Mark paid
                </button>
              )}
            </div>
            {open && (
              <div className="mrw-more">
                {full && <span className="small muted">{full}</span>}
                {hidden.length > 0 && (
                  <span className="mrw-more-acts">
                    {hidden.map((a) => (
                      <button key={a.label} type="button" className="btn small secondary" disabled={wait} onClick={a.onClick} {...a.attrs}>
                        {a.label === 'Unmark' ? 'Undo' : a.label}
                      </button>
                    ))}
                  </span>
                )}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Did the venue charge for this canceled game? Only a charge above $0 counts. */
export const venueCharged = (s: AdminSessionView) => (s.chargedCents ?? 0) > 0;

/** A canceled game where nobody owes and nobody is owed: the notice, who got credit back, Edit charge, and Hide from list. */
export function ClosedBody({ ctx, s, hideable }: { ctx: AdminCtx; s: AdminSessionView; hideable: boolean }) {
  return (
    <div className="mrw-closed stack" data-closed-body>
      <p className="mrw-closed-note">
        {s.cancelReason ? `Canceled - ${s.cancelReason}. ` : 'Canceled. '}
        {venueCharged(s) ? `The venue charged you ${formatPrice(s.chargedCents ?? 0)}.` : 'Nobody owes anything.'}
      </p>
      <CreditBackList s={s} />
      <ChargeLine ctx={ctx} s={s} />
      {hideable && <HideFromList ctx={ctx} s={s} variant="button" />}
    </div>
  );
}

/** "Venue charged: No" with an Edit charge button. Opens a small sheet: Were you charged? No | Yes (and the amount). */
export function ChargeLine({ ctx, s }: { ctx: AdminCtx; s: AdminSessionView }) {
  const [open, setOpen] = useState(false);
  const charged = venueCharged(s);
  return (
    <>
      <div className="mrw-chargeline" data-charge-line>
        <span className="small">
          Venue charged: <strong data-charge-value>{charged ? formatPrice(s.chargedCents ?? 0) : 'No'}</strong>
        </span>
        <button type="button" className="btn small secondary" data-edit-charge onClick={() => setOpen(true)}>
          Edit charge
        </button>
      </div>
      <Sheet open={open} title="Edit charge" onClose={() => setOpen(false)}>
        {open && <EditCharge ctx={ctx} s={s} onDone={() => setOpen(false)} />}
      </Sheet>
    </>
  );
}

function EditCharge({ ctx, s, onDone }: { ctx: AdminCtx; s: AdminSessionView; onDone: () => void }) {
  const { busy, run } = useAction(ctx);
  const rw = useReworkRun(ctx);
  const was = venueCharged(s);
  const typical = s.courtCostCents ?? ctx.d.group.settings.typicalCourtCostCents;
  const [charged, setCharged] = useState(was);
  const [amount, setAmount] = useState(() => String(((was ? (s.chargedCents ?? 0) : typical) / 100).toFixed(2)).replace(/\.00$/, ''));
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="stack" data-edit-charge-sheet>
      <fieldset className="charge-ask">
        <legend>Were you charged for this court?</legend>
        <div className="segmented" role="group" aria-label="Were you charged for this court?">
          <button type="button" aria-pressed={!charged} onClick={() => setCharged(false)}>
            No
          </button>
          <button type="button" aria-pressed={charged} onClick={() => setCharged(true)}>
            Yes
          </button>
        </div>
        <p className="small muted" data-charge-note>
          This only fixes Totals. What players owe or hold does not change.
        </p>
        {charged && (
          <label className="field">
            Amount charged
            <input
              type="text"
              inputMode="decimal"
              value={amount}
              onChange={(e) => {
                setAmount(e.target.value);
                setError(null);
              }}
              aria-invalid={error ? true : undefined}
            />
            {error && <span className="field-error">{error}</span>}
          </label>
        )}
</fieldset>
      <button
        type="button"
        className="btn block"
        disabled={busy}
        data-save-charge
        onClick={async () => {
          let cents: number | undefined;
          if (charged) {
            const c = parseDollars(amount);
            if (c === null || c <= 0) return setError('Enter an amount like 48 or 48.50.');
            cents = c;
          }
          const save = () => api('POST', `/api/admin/sessions/${s.id}/charge`, { charged, ...(cents !== undefined ? { cents } : {}) });
          const msg = charged ? 'Charge saved' : 'Marked as not charged';
          if (rw) {
            // Instant: the sheet closes and Totals follow now; the save runs in the background and puts it back if it fails.
            onDone();
            void rw({ kind: 'charge', sessionId: s.id, cents: charged ? (cents ?? 0) : 0 }, save, msg);
            return;
          }
          const ok = await run(save, msg);
          if (ok) onDone();
        }}
      >
        Save
      </button>
    </div>
  );
}

/**
 * The question before a game is hidden: it leaves Home, Games and Totals, nothing is deleted, and Settings > Advanced > Hidden games
 * restores it. It says so when somebody still owes for the game.
 */
export function HideConfirm({ ctx, s, open, onClose }: { ctx: AdminCtx; s: AdminSessionView; open: boolean; onClose: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const day = formatShortDate(s.startsAt, ctx.d.group.timezone);
  const owed = owedCentsOf(s);
  const rw = useReworkRun(ctx);
  async function hide() {
    const save = () => api('POST', `/api/admin/sessions/${s.id}/hide-from-list`, { hidden: true });
    const msg = `${day} is hidden. Restore it in Settings, Advanced, Hidden games.`;
    if (rw) {
      // On the Money page: gone at once, saved in the background, back (with an error) if the save fails.
      onClose();
      void rw({ kind: 'hide', sessionId: s.id }, save, msg);
      return;
    }
    setBusy(true);
    try {
      await save();
      await ctx.reload();
      onClose();
      toast(msg);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'That did not work. Try again.', 'error');
    } finally {
      setBusy(false);
    }
  }
  return (
    <ConfirmDialog
      open={open}
      title={`Hide ${day}?`}
      body={
        <p data-hide-confirm>
          It leaves your Home and Games lists and your Totals. Nothing is deleted
          {owed > 0 ? `, and ${formatPrice(owed)} is still owed on it, which stays owed` : ''}. Restore it any time in Settings, Advanced, Hidden games.
        </p>
      }
      confirmLabel="Hide it"
      busy={busy}
      onConfirm={() => void hide()}
      onCancel={onClose}
    />
  );
}

/** The "Hide from list" button on a game card (a filled-in sheet asks first). */
export function HideFromList({ ctx, s, variant }: { ctx: AdminCtx; s: AdminSessionView; variant: 'button' | 'link' }) {
  const [ask, setAsk] = useState(false);
  return (
    <>
      <button type="button" className={variant === 'button' ? 'btn small secondary mrw-hide' : 'mrw-hide-link'} data-hide-from-list onClick={() => setAsk(true)}>
        Hide from list
      </button>
      <HideConfirm ctx={ctx} s={s} open={ask} onClose={() => setAsk(false)} />
    </>
  );
}

/**
 * The Remind sheet on the Money page (Money page rework). One tight row per person who owes: name, a small "owes $14" under it, and a
 * Text button that opens Messages for that one person. With 2 or more owing people who have a number, "Text all" sits in the header and
 * opens ONE new message already addressed to all of them (the same way the one-person Text opens Messages, several numbers at once), with
 * the group reminder. The list of numbers is built when the sheet opens and again at the tap, so someone who just paid is not texted; a
 * person who owes but has no number is skipped, with a short note. The site sends nothing; you press send in Messages.
 */
export function ReworkRemind({ ctx, s, open, onClose }: { ctx: AdminCtx; s: AdminSessionView | null; open: boolean; onClose: () => void }) {
  const toast = useToast();
  // The picture of the game the sheet has now; the tap on Text all reads the server again.
  const latest = useRef(s);
  latest.current = s;
  const again = useRef(false);
  const rows = s ? unpaidRows(s) : [];
  const day = s ? formatShortDate(s.startsAt, ctx.d.group.timezone) : '';
  const allHref = (g: AdminSessionView) => smsHref(textAllRecipients(g).phones, groupRemindText(ctx.d, g), isIOS);
  return (
    <Sheet
      open={open && !!s}
      title={s ? `Remind · ${day}` : ''}
      onClose={onClose}
      headerAction={
        s && canTextAll(s) ? (
          <a
            className="mrw-textall"
            data-text-all
            href={allHref(s)}
            onClick={async (e) => {
              // The sheet is built from what the screen knew when it opened (live updates wait while a sheet is open), so at the tap the game is read
              // again from the server: someone who just paid is left out. The tap we repeat ourselves below is let through.
              if (again.current) {
                again.current = false;
                return;
              }
              e.preventDefault();
              const link = e.currentTarget;
              let g = latest.current;
              try {
                const now = await api<AdminDashboard>('GET', '/api/admin/dashboard');
                g = now.sessions.find((x) => x.id === latest.current?.id) ?? g;
              } catch {
                /* offline: the picture the sheet has is the best there is */
              }
              const to = g ? textAllRecipients(g) : { phones: [], missing: [] };
              if (!g || to.phones.length < 2) {
                // Someone just paid, so fewer than two are left: nothing is opened. Their own Text button still works.
                toast('Only one person still owes. Use their Text button.');
                void ctx.reload();
                return;
              }
              link.href = allHref(g);
              if (to.missing.length > 0) toast(missingNumberNote(to.missing));
              again.current = true;
              link.click();
              void ctx.reload();
            }}
          >
            Text all
          </a>
        ) : undefined
      }
    >
      {s &&
        (rows.length === 0 ? (
          <p className="muted">Everyone has paid.</p>
        ) : (
          <ul className="mrw-remind-list" aria-label="Players who owe">
            {rows.map((r) => (
              <li key={r.playerId} data-remind-row={r.name}>
                <span className="mrw-remind-who">
                  <strong>{r.name}</strong>
                  <span className="small muted">
                    owes {formatPrice(r.owesCents)}
                    {r.phone ? '' : ' · no number saved'}
                  </span>
                </span>
                <a className="mrw-text-one" href={smsHref(r.phone, reminderText(ctx.d, r.playerId, r.name, s), isIOS)} aria-label={`Text ${r.name}`}>
                  Text
                </a>
              </li>
            ))}
          </ul>
        ))}
    </Sheet>
  );
}
