import type { AdminSessionView } from '../../../shared/api';
import { formatShortDate } from '../../../shared/time';
import { useNow } from '../../lib';
import type { AdminCtx } from '../Admin';
import { MonthlyMoneyPage } from './MonthlyMoney';
import { PaymentsManager } from './Sessions';
import { unpaidPeople } from './textMenu';
import { SmsDraft } from '../../ui';

/** A canceled game where someone's payment became credit. */
const creditBackRows = (s: AdminSessionView) => s.roster.filter((r) => !r.isOrganizer && r.creditBackCents > 0);

/**
 * Everything about money in one place: the month at the top, then each
 * session's payments (Mark paid, who played and the final price, Reopen).
 */
export function MoneyTab({ ctx }: { ctx: AdminCtx }) {
  const nowMs = useNow();
  const unpaid = unpaidPeople(ctx.d);
  const tz = ctx.d.group.timezone;
  // Every session with a court to pay for: players' payments, and the organizer's court row.
  // A canceled game stays here when payments became credit, so the organizer can see who got what back.
  const canceledWithCredit = ctx.d.sessions.filter((s) => s.state.flags.canceled && creditBackRows(s).length > 0);
  const withMoney = ctx.d.sessions.filter((s) => (!s.state.flags.canceled && s.court !== null) || canceledWithCredit.includes(s));
  // Most recent games first: the ones people are paying for now.
  const started = withMoney.filter((s) => Date.parse(s.startsAt) <= nowMs).reverse();
  const upcoming = withMoney.filter((s) => Date.parse(s.startsAt) > nowMs);
  // Counts are other players only; the organizer is never counted.
  const label = (s: AdminSessionView) =>
    s.state.flags.canceled
      ? `${formatShortDate(s.startsAt, tz)} · canceled`
      : s.finalized
        ? `${formatShortDate(s.startsAt, tz)} · ${s.finalized.playedCount} played · $${s.finalized.priceCents / 100} each`
        : s.payableCount > 0
          ? `${formatShortDate(s.startsAt, tz)} · ${s.paidCount} of ${s.payableCount} paid`
          : formatShortDate(s.startsAt, tz);
  const session = (s: AdminSessionView, open: boolean) => (
    <details key={s.id} className="money-sess card" open={open || undefined} data-session={s.id}>
      <summary>
        <span>{label(s)}</span>
        {!s.state.flags.canceled && s.needsFinalize && <span className="owes-tag">finalize</span>}
        {!s.state.flags.canceled && s.paidCount < s.payableCount && <span className="owes-tag">{s.payableCount - s.paidCount} owe</span>}
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
        {unpaid.count >= 2 && (
          <SmsDraft to="Everyone who owes" phone={null} phones={unpaid.phones} missing={unpaid.missing} openLabel="Remind all unpaid" body={unpaid.body} quiet />
        )}
        {started.map((s) => session(s, s.paidCount < s.payableCount || s.court?.paid === false || s.needsFinalize))}
        {upcoming.map((s) => session(s, false))}
      </section>
    </>
  );
}
