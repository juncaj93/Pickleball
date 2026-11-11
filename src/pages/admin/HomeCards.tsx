import { useState } from 'react';
import type { AdminDashboard, AdminSessionView, RefundRequestView } from '../../../shared/api';
import { formatPrice, venmoRefundUrl } from '../../../shared/money';
import { paymentClaimText, unconfirmedPaidWarning } from '../../../shared/credit';
import { formatShortDate } from '../../../shared/time';
import { api, openVenmo, storageGet, storageSet } from '../../lib';
import { Sheet } from '../../ui';
import type { AdminCtx } from '../Admin';
import { tapsHeld, useTapsHeld } from './tapGuard';
import { useAction } from './action';
import '../../finalize.css';
import { AcIcon, AcTitle, AlertCard } from '../../AlertCard';
import { splitFirst } from '../../../shared/zip11';
import { type GamePrice, gameFinalPreview, viewPrice } from '../../../shared/gameLength';
import type { ExtraMinutes } from '../../../shared/extension';
import { WhoPlayedTiles } from './ExtendedTime';

const CREDIT_NOTE = 'Pickleball credit refund';

// The same helper as every other organizer tap (it used to be a copy of it).
const useRun = useAction;

/**
 * After a game ends: "Thu, Oct 29 · 6 in", the preview line, a green
 * "Everyone played", and "Change who played". Under 4 in, it offers Cancel
 * session (everyone paid gets credit) and Finalize anyway (the flat price).
 */
export function FinalizeCard({ ctx, s }: { ctx: AdminCtx; s: AdminSessionView }) {
  const tz = ctx.d.group.timezone;
  // This game's own price: the normal one, or a 1.5 hour game's row when the server priced it so (shared/gameLength.ts).
  const gp = viewPrice(s, ctx.d.group.settings);
  const price = gp.flatCents;
  const { busy: saving, run } = useRun(ctx);
  const undo = ctx.d.adminUndo === true;
  // Dimmed for a moment right after "Yes, we played" brings this card in under the finger.
  const held = useTapsHeld();
  const busy = saving || held;
  const [changing, setChanging] = useState(false);
  const inNow = s.roster.filter((r) => r.status === 'confirmed');
  const n = inNow.length;
  const under = n < 4;
  const unconfirmed = unconfirmedPaidWarning(selfPaidNames(s));
  const day = formatShortDate(s.startsAt, tz);
  // Right after "Yes, we played" this card scrolls in under the finger: taps wait until the screen settles.
  // Zip 31 "Extended time": only while on for this phone. Off: the old label and the old sheet, and finalize sends exactly what it sent.
  const ext = ctx.d.extendedTime === true;
  const changeLabel = ext ? 'Edit players / time' : 'Change who played';
  const finalize = (played: string[], extraMinutes?: ExtraMinutes) =>
    tapsHeld()
      ? Promise.resolve(false)
      : run(() => api('POST', `/api/admin/sessions/${s.id}/finalize`, extraMinutes === undefined ? { played } : { played, extraMinutes }), `${day} is final`, {
          // Instant taps (INSTANT_TAPS): the price and the credit are the server's, so the button shows it is working; only where Money
          // files the game moves at once (finalized games that are fully paid go to Previous games). A failed save moves it back.
          key: `finalize:${s.id}`,
          // Undo on admin toasts (ADMIN_UNDO): the card goes at once and the save waits 5 seconds (dropped on Undo, then the card is back).
          patch: undo
            ? (d) => ({ ...d, sessions: d.sessions.map((x) => (x.id === s.id ? { ...x, finalizing: true, needsFinalize: false } : x)) })
            : (d) => ({ ...d, sessions: d.sessions.map((x) => (x.id === s.id ? { ...x, finalizing: true } : x)) }),
          press: !undo,
          what: 'Finalize',
          ...(undo ? { undo: true } : {}),
        });
  // Zip 11, Alert cards: a green (after the game) card. The same title, the same preview line, the same buttons under it.
  if (ctx.d.alertCards === true) {
    return (
      <article className="ac ac-green ac-stacked finalize-card-ac" aria-label={`Finalize ${day}`} data-finalize={s.id} data-alert-card="green" tabIndex={-1}>
        <div className="ac-row">
          <AcIcon name="ok" />
          <div className="ac-text">
            <AcTitle as="h3">
              {day} · {n} in
            </AcTitle>
            <div className="ac-sub" data-finalize-preview>
              {under ? `Only ${n} in. Cancel it (everyone paid gets credit) or finalize anyway at ${formatPrice(price)} each.` : gameFinalPreview(gp, n, formatPrice)}
            </div>
            {unconfirmed && (
              <div className="ac-sub ac-sub-amber" role="note" data-unconfirmed-paid>
                {unconfirmed}
              </div>
            )}
          </div>
        </div>
        <div className="ac-actions">
          {under ? (
            <>
              <button className="ac-btn ac-out" data-ac-tone="red" disabled={busy} onClick={() => !tapsHeld() && ctx.open('cancel', s.id)}>
                Cancel session
              </button>
              <button className="ac-btn ac-out" disabled={busy} onClick={() => finalize(inNow.map((r) => r.playerId))}>
                Finalize anyway
              </button>
            </>
          ) : (
            <>
              <button className="ac-btn" disabled={busy} data-everyone-played onClick={() => finalize(inNow.map((r) => r.playerId))}>
                {saving ? 'Saving…' : 'Everyone played'}
              </button>
              <button className="ac-btn ac-out" disabled={busy} data-change-played onClick={() => !tapsHeld() && setChanging(true)}>
                {changeLabel}
              </button>
            </>
          )}
        </div>
        <Sheet open={changing} title={`Who played · ${day}`} onClose={() => setChanging(false)}>
          {changing &&
            (ext ? (
              <WhoPlayedTiles s={s} gp={gp} busy={busy} unconfirmedNames={selfPaidNames(s)} onConfirm={async (ids, extra) => (await finalize(ids, extra)) && setChanging(false)} />
            ) : (
              <WhoPlayed s={s} gp={gp} busy={busy} onConfirm={async (ids) => (await finalize(ids)) && setChanging(false)} />
            ))}
        </Sheet>
      </article>
    );
  }
  return (
    <article className="card stack finalize-card" aria-label={`Finalize ${day}`} data-finalize={s.id} tabIndex={-1}>
      <div>
        <h3>
          {day} · {n} in
        </h3>
        <div className="small muted" data-finalize-preview>
          {under ? `Only ${n} in. Cancel it (everyone paid gets credit) or finalize anyway at ${formatPrice(price)} each.` : gameFinalPreview(gp, n, formatPrice)}
        </div>
      </div>
      {unconfirmed && <UnconfirmedWarning text={unconfirmed} />}
      <div className="finalize-btns">
        {under ? (
          <>
            <button className="btn danger" disabled={busy} onClick={() => !tapsHeld() && ctx.open('cancel', s.id)}>
              Cancel session
            </button>
            <button className="btn secondary" disabled={busy} onClick={() => finalize(inNow.map((r) => r.playerId))}>
              Finalize anyway
            </button>
          </>
        ) : (
          <>
            <button className="btn" disabled={busy} data-everyone-played onClick={() => finalize(inNow.map((r) => r.playerId))}>
              {saving ? 'Saving…' : 'Everyone played'}
            </button>
            <button className="btn secondary" disabled={busy} data-change-played onClick={() => !tapsHeld() && setChanging(true)}>
              {changeLabel}
            </button>
          </>
        )}
      </div>
      <Sheet open={changing} title={`Who played · ${day}`} onClose={() => setChanging(false)}>
        {changing &&
            (ext ? (
              <WhoPlayedTiles s={s} gp={gp} busy={busy} unconfirmedNames={selfPaidNames(s)} onConfirm={async (ids, extra) => (await finalize(ids, extra)) && setChanging(false)} />
            ) : (
              <WhoPlayed s={s} gp={gp} busy={busy} onConfirm={async (ids) => (await finalize(ids)) && setChanging(false)} />
            ))}
      </Sheet>
    </article>
  );
}

/** Players (not the organizer) who tapped "I paid" that the organizer has not confirmed. */
function selfPaidNames(s: AdminSessionView): string[] {
  return s.roster.filter((r) => r.status === 'confirmed' && !r.isOrganizer && r.paymentStatus === 'paid' && r.selfPaid).map((r) => r.name);
}

function UnconfirmedWarning({ text }: { text: string }) {
  return (
    <p className="finalize-warn" role="note" data-unconfirmed-paid>
      {text}
    </p>
  );
}

/** The sheet: everyone who was in, a switch each, the preview updating live, and Confirm. */
function WhoPlayed({ s, gp, busy, onConfirm }: { s: AdminSessionView; gp: GamePrice; busy: boolean; onConfirm: (ids: string[]) => void }) {
  const price = gp.flatCents;
  const inNow = s.roster.filter((r) => r.status === 'confirmed');
  const [played, setPlayed] = useState<Set<string>>(() => new Set(inNow.map((r) => r.playerId)));
  const n = played.size;
  const unconfirmed = unconfirmedPaidWarning(selfPaidNames(s));
  return (
    <div className="stack" data-who-played>
      <p className="finalize-live" data-finalize-live>
        {n < 4 ? `${n} played · ${formatPrice(price)} each` : gameFinalPreview(gp, n, formatPrice)}
      </p>
      <ul className="list who-played">
        {inNow.map((r) => (
          <li key={r.playerId}>
            <label className="set-row played-row">
              <span className="set-label">
                <span className="set-name">
                  {r.name}
                  {r.isOrganizer ? ' (you)' : ''}
                </span>
                <span className="set-hint">{played.has(r.playerId) ? 'played' : 'did not play'}</span>
              </span>
              <input
                type="checkbox"
                role="switch"
                className="switch"
                checked={played.has(r.playerId)}
                aria-label={`${r.name} played`}
                onChange={(e) =>
                  setPlayed((cur) => {
                    const next = new Set(cur);
                    if (e.target.checked) next.add(r.playerId);
                    else next.delete(r.playerId);
                    return next;
                  })
                }
              />
            </label>
          </li>
        ))}
      </ul>
      {unconfirmed && <UnconfirmedWarning text={unconfirmed} />}
      <button className="btn block" disabled={busy} data-confirm-played onClick={() => onConfirm([...played])}>
        {busy ? 'Saving…' : 'Confirm'}
      </button>
    </div>
  );
}

/** The cents whose Refund button was tapped on this phone, so "Mark refunded" is still there after a reload. */
function readOpened(id: string): boolean {
  try {
    return storageGet(`pb_refund_request_opened_${id}`) === '1';
  } catch {
    return false;
  }
}

/**
 * "Mitchel requested a refund of $14": Refund opens Venmo (the exact amount,
 * the note, addressed if their Venmo is saved; it never marks anything), then
 * "Mark refunded" takes it off their credit and closes the request. "Not now"
 * gives the amount back to their usable credit and closes the card.
 */
export function RefundRequestCard({ ctx, r }: { ctx: AdminCtx; r: RefundRequestView }) {
  const { busy, run } = useRun(ctx);
  const [, bump] = useState(0);
  const pay = venmoRefundUrl(r.venmo, r.cents, CREDIT_NOTE);
  const tapped = readOpened(r.id);
  // The amount on the card goes along: if the player put part of it toward a game since, the server says look again.
  // Instant taps: the card leaves at once (the answer is certain); a failed save brings it back.
  const act = (action: 'refunded' | 'not_now', msg: string) =>
    run(() => api('POST', `/api/admin/refund-requests/${r.id}`, action === 'refunded' ? { action, cents: r.cents } : { action }), msg, {
      key: `refund:${r.id}`,
      patch: (d) => ({ ...d, refundRequests: d.refundRequests.filter((x) => x.id !== r.id) }),
      what: action === 'refunded' ? 'Mark refunded' : 'Not now',
      ...(ctx.d.adminUndo === true ? { undo: true } : {}),
    });
  // Zip 11, Alert cards: a blue (credit) card, the same three buttons under the text (Venmo, then Mark refunded once it was tapped, Not now).
  if (ctx.d.alertCards === true) {
    return (
      <AlertCard
        tone="blue"
        icon="credit"
        label={`${r.name} requested a refund`}
        titleAs="h3"
        data={{ 'data-refund-request': r.name }}
        title={`${r.name} requested a refund of ${formatPrice(r.cents)}`}
        sub={pay.addressed ? 'Cash out request' : `Cash out request · No Venmo saved for ${r.name}: pick them in Venmo.`}
        actions={
          <>
            <a
              className="ac-btn"
              href={pay.url}
              data-app-href={pay.appUrl}
              data-refund-venmo
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Refund ${r.name} ${formatPrice(r.cents)} with Venmo`}
              onClick={(e) => {
                openVenmo(e, pay);
                storageSet(`pb_refund_request_opened_${r.id}`, '1');
                bump((x) => x + 1);
              }}
            >
              Venmo
            </a>
            {tapped && (
              <button className="ac-btn ac-out" disabled={busy} data-mark-refunded onClick={() => act('refunded', `${r.name} refunded`)}>
                Mark refunded
              </button>
            )}
            <button className="ac-btn ac-out" disabled={busy} data-not-now onClick={() => act('not_now', 'Put off for now')}>
              Not now
            </button>
          </>
        }
      />
    );
  }
  return (
    <article className="card stack refund-request" aria-label={`${r.name} requested a refund`} data-refund-request={r.name}>
      <h3>
        {r.name} requested a refund of {formatPrice(r.cents)}
      </h3>
      <div className="finalize-btns">
        <a
          className="btn"
          href={pay.url}
          data-app-href={pay.appUrl}
          data-refund-venmo
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Refund ${r.name} ${formatPrice(r.cents)} with Venmo`}
          onClick={(e) => {
            openVenmo(e, pay);
            storageSet(`pb_refund_request_opened_${r.id}`, '1');
            bump((x) => x + 1);
          }}
        >
          Refund
        </a>
        {tapped && (
          <button className="btn secondary" disabled={busy} data-mark-refunded onClick={() => act('refunded', `${r.name} refunded`)}>
            Mark refunded
          </button>
        )}
        <button className="link-btn not-now" disabled={busy} data-not-now onClick={() => act('not_now', 'Put off for now')}>
          Not now
        </button>
      </div>
      {!pay.addressed && <p className="small muted">No Venmo saved for {r.name}: pick them in Venmo.</p>}
    </article>
  );
}

/**
 * "Ryan tapped I paid ($14), not confirmed. Dropped out of Tue, Nov 3.": an I paid the organizer never
 * confirmed, on a seat that left the game or a canceled game. Nothing on that seat moved. "Paid" makes it
 * their credit (with any credit still on the seat); "Didn't pay" clears it (credit on the seat goes back).
 */
export function PaymentClaimCard({ ctx, c }: { ctx: AdminCtx; c: AdminDashboard['paymentClaims'][number] }) {
  const { busy, run } = useRun(ctx);
  const answer = (paid: boolean, msg: string) =>
    run(() => api('POST', `/api/admin/sessions/${c.sessionId}/claim`, { playerId: c.playerId, paid }), msg, {
      key: `claim:${c.sessionId}:${c.playerId}`,
      patch: (d) => ({ ...d, paymentClaims: (d.paymentClaims ?? []).filter((x) => !(x.sessionId === c.sessionId && x.playerId === c.playerId)) }),
      what: paid ? 'Paid' : "Didn't pay",
      ...(ctx.d.adminUndo === true ? { undo: true } : {}),
    });
  // Zip 11, Alert cards: an amber (owes) card: the same words as a title and the rest, Paid and Didn't pay under it.
  if (ctx.d.alertCards === true) {
    const { title, rest } = splitFirst(paymentClaimText(c.name, c.cents, c.why, c.startsAt, ctx.d.group.timezone));
    return (
      <AlertCard
        tone="amber"
        icon="owe"
        label={`${c.name} payment not confirmed`}
        titleAs="h3"
        data={{ 'data-payment-claim': c.name }}
        title={title}
        sub={rest || undefined}
        actions={
          <>
            <button className="ac-btn" disabled={busy} data-claim-paid onClick={() => answer(true, `${c.name}'s ${formatPrice(c.cents)} is credit now`)}>
              Paid
            </button>
            <button className="ac-btn ac-out" disabled={busy} data-claim-not-paid onClick={() => answer(false, 'Cleared')}>
              Didn't pay
            </button>
          </>
        }
      />
    );
  }
  return (
    <article className="card stack payment-claim" aria-label={`${c.name} payment not confirmed`} data-payment-claim={c.name}>
      <h3>{paymentClaimText(c.name, c.cents, c.why, c.startsAt, ctx.d.group.timezone)}</h3>
      <div className="finalize-btns">
        <button className="btn secondary" disabled={busy} data-claim-paid onClick={() => answer(true, `${c.name}'s ${formatPrice(c.cents)} is credit now`)}>
          Paid
        </button>
        <button className="link-btn not-now" disabled={busy} data-claim-not-paid onClick={() => answer(false, 'Cleared')}>
          Didn't pay
        </button>
      </div>
    </article>
  );
}
