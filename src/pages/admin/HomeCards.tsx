import { useState } from 'react';
import type { AdminSessionView, RefundRequestView } from '../../../shared/api';
import { formatPrice, venmoRefundUrl } from '../../../shared/money';
import { finalPreview } from '../../../shared/pricing';
import { formatShortDate } from '../../../shared/time';
import { api, ApiError, openVenmo, storageGet, storageSet } from '../../lib';
import { Sheet, useToast } from '../../ui';
import type { AdminCtx } from '../Admin';
import '../../finalize.css';

const CREDIT_NOTE = 'Pickleball credit refund';

function useRun(ctx: AdminCtx) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  async function run(fn: () => Promise<unknown>, msg: string) {
    setBusy(true);
    try {
      await fn();
      await ctx.reload();
      toast(msg);
      return true;
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'That did not work. Try again.', 'error');
      return false;
    } finally {
      setBusy(false);
    }
  }
  return { busy, run };
}

/**
 * After a game ends: "Thu, Oct 29 · 6 in", the preview line, a green
 * "Everyone played", and "Change who played". Under 4 in, it offers Cancel
 * session (everyone paid gets credit) and Finalize anyway (the flat price).
 */
export function FinalizeCard({ ctx, s }: { ctx: AdminCtx; s: AdminSessionView }) {
  const tz = ctx.d.group.timezone;
  const price = ctx.d.group.settings.pricePerPlayerCents;
  const { busy, run } = useRun(ctx);
  const [changing, setChanging] = useState(false);
  const inNow = s.roster.filter((r) => r.status === 'confirmed');
  const n = inNow.length;
  const under = n < 4;
  const day = formatShortDate(s.startsAt, tz);
  const finalize = (played: string[]) =>
    run(() => api('POST', `/api/admin/sessions/${s.id}/finalize`, { played }), `${day} is final`);
  return (
    <article className="card stack finalize-card" aria-label={`Finalize ${day}`} data-finalize={s.id}>
      <div>
        <h3>
          {day} · {n} in
        </h3>
        <div className="small muted" data-finalize-preview>
          {under ? `Only ${n} in. Cancel it (everyone paid gets credit) or finalize anyway at ${formatPrice(price)} each.` : finalPreview(price, n, formatPrice)}
        </div>
      </div>
      <div className="finalize-btns">
        {under ? (
          <>
            <button className="btn danger" disabled={busy} onClick={() => ctx.open('cancel', s.id)}>
              Cancel session
            </button>
            <button className="btn secondary" disabled={busy} onClick={() => finalize(inNow.map((r) => r.playerId))}>
              Finalize anyway
            </button>
          </>
        ) : (
          <>
            <button className="btn" disabled={busy} data-everyone-played onClick={() => finalize(inNow.map((r) => r.playerId))}>
              {busy ? 'Saving…' : 'Everyone played'}
            </button>
            <button className="btn secondary" disabled={busy} data-change-played onClick={() => setChanging(true)}>
              Change who played
            </button>
          </>
        )}
      </div>
      <Sheet open={changing} title={`Who played · ${day}`} onClose={() => setChanging(false)}>
        {changing && <WhoPlayed s={s} price={price} busy={busy} onConfirm={async (ids) => (await finalize(ids)) && setChanging(false)} />}
      </Sheet>
    </article>
  );
}

/** The sheet: everyone who was in, a switch each, the preview updating live, and Confirm. */
function WhoPlayed({ s, price, busy, onConfirm }: { s: AdminSessionView; price: number; busy: boolean; onConfirm: (ids: string[]) => void }) {
  const inNow = s.roster.filter((r) => r.status === 'confirmed');
  const [played, setPlayed] = useState<Set<string>>(() => new Set(inNow.map((r) => r.playerId)));
  const n = played.size;
  return (
    <div className="stack" data-who-played>
      <p className="finalize-live" data-finalize-live>
        {n < 4 ? `${n} played · ${formatPrice(price)} each` : finalPreview(price, n, formatPrice)}
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
  const act = (action: 'refunded' | 'not_now', msg: string) => run(() => api('POST', `/api/admin/refund-requests/${r.id}`, { action }), msg);
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
