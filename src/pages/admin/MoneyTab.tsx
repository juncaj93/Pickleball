import type { AdminSessionView } from '../../../shared/api';
import { formatShortDate } from '../../../shared/time';
import { useNow } from '../../lib';
import { type AdminCtx, CreditsCard } from '../Admin';
import { MonthlyMoneyPage } from './MonthlyMoney';
import { PaymentsManager, RefundList } from './Sessions';
import { refundRows } from './todo';

/**
 * Everything about money in one place: the month at the top, then each
 * session's payments (Mark paid), who to pay back, and credits.
 */
export function MoneyTab({ ctx }: { ctx: AdminCtx }) {
  const nowMs = useNow();
  const tz = ctx.d.group.timezone;
  // Every session with a court to pay for: players' payments, and the organizer's court row.
  const withMoney = ctx.d.sessions.filter((s) => !s.state.flags.canceled && s.court !== null);
  // Most recent games first: the ones people are paying for now.
  const started = withMoney.filter((s) => Date.parse(s.startsAt) <= nowMs).reverse();
  const upcoming = withMoney.filter((s) => Date.parse(s.startsAt) > nowMs);
  const payBack = ctx.d.sessions.filter((s) => refundRows(s).some((r) => !r.refundedAt));
  // Counts are other players only; the organizer is never counted.
  const label = (s: AdminSessionView) =>
    s.payableCount > 0 ? `${formatShortDate(s.startsAt, tz)} · ${s.paidCount} of ${s.payableCount} paid` : formatShortDate(s.startsAt, tz);
  const session = (s: AdminSessionView, open: boolean) => (
    <details key={s.id} className="money-sess card" open={open || undefined} data-session={s.id}>
      <summary>
        <span>{label(s)}</span>
        {s.paidCount < s.payableCount && <span className="owes-tag">{s.payableCount - s.paidCount} owe</span>}
      </summary>
      <PaymentsManager ctx={ctx} s={s} />
    </details>
  );
  return (
    <>
      <MonthlyMoneyPage ctx={ctx} />
      <section className="stack" aria-labelledby="money-sessions-title">
        <h2 id="money-sessions-title" className="section-title">
          Who paid
        </h2>
        {withMoney.length === 0 && <p className="muted small">Nobody is signed up yet.</p>}
        {started.map((s) => session(s, s.paidCount < s.payableCount || s.court?.paid === false))}
        {upcoming.map((s) => session(s, false))}
      </section>
      {payBack.length > 0 && (
        <section className="stack" aria-labelledby="payback-title">
          <h2 id="payback-title" className="section-title">
            Pay back
          </h2>
          {payBack.map((s) => (
            <div key={s.id} className="card stack">
              <strong>{formatShortDate(s.startsAt, tz)}</strong>
              <RefundList ctx={ctx} s={s} />
            </div>
          ))}
        </section>
      )}
      <CreditsCard ctx={ctx} />
    </>
  );
}
