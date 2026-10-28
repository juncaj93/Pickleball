import type { AdminSessionView } from '../../../shared/api';
import { formatShortDate } from '../../../shared/time';
import { useNow } from '../../lib';
import { type AdminCtx, CreditsCard } from '../Admin';
import { MonthlyMoneyPage } from './MonthlyMoney';
import { PaymentsManager } from './Sessions';
import { refundRows } from './todo';

/**
 * Everything about money in one place: the month at the top, then each
 * session's payments (Mark paid, and Refund on a canceled game or a player who left), and credits.
 */
export function MoneyTab({ ctx }: { ctx: AdminCtx }) {
  const nowMs = useNow();
  const tz = ctx.d.group.timezone;
  // Every session with a court to pay for: players' payments, and the organizer's court row.
  // A canceled game stays here while it has money to give back (or was given back), so Refund sits on its row.
  const canceledWithRefunds = ctx.d.sessions.filter((s) => s.state.flags.canceled && refundRows(s).length > 0);
  const withMoney = ctx.d.sessions.filter((s) => (!s.state.flags.canceled && s.court !== null) || canceledWithRefunds.includes(s));
  // Most recent games first: the ones people are paying for now.
  const started = withMoney.filter((s) => Date.parse(s.startsAt) <= nowMs).reverse();
  const upcoming = withMoney.filter((s) => Date.parse(s.startsAt) > nowMs);
  // Counts are other players only; the organizer is never counted.
  const label = (s: AdminSessionView) =>
    s.state.flags.canceled
      ? `${formatShortDate(s.startsAt, tz)} · canceled`
      : s.payableCount > 0 ? `${formatShortDate(s.startsAt, tz)} · ${s.paidCount} of ${s.payableCount} paid` : formatShortDate(s.startsAt, tz);
  const session = (s: AdminSessionView, open: boolean) => (
    <details key={s.id} className="money-sess card" open={open || undefined} data-session={s.id}>
      <summary>
        <span>{label(s)}</span>
        {s.state.flags.canceled
          ? refundRows(s).some((r) => !r.refundedAt) && <span className="owes-tag">pay back</span>
          : s.paidCount < s.payableCount && <span className="owes-tag">{s.payableCount - s.paidCount} owe</span>}
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
        {started.map((s) => session(s, s.paidCount < s.payableCount || s.court?.paid === false || refundRows(s).some((r) => !r.refundedAt)))}
        {upcoming.map((s) => session(s, s.state.flags.canceled && refundRows(s).some((r) => !r.refundedAt)))}
      </section>
      <CreditsCard ctx={ctx} />
    </>
  );
}
