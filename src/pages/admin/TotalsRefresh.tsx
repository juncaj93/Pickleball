import { useState } from 'react';
import type { MonthlyMoney } from '../../../shared/api';
import { formatPrice } from '../../../shared/money';
import { dollarsText, monthRowOf, pastMonths, perCourtDollars, projectedCard, soFarCard, type MonthRow, type TotalsCard } from '../../../shared/totalsRefresh';
import { api, useDemoVersion, useLoad, usePretend } from '../../lib';
import { ErrorState, Spinner } from '../../ui';
import type { AdminCtx } from '../Admin';
import { minus } from './MonthlyMoney';
import { monthBoxLabel, monthChoices, monthOf } from './moneyRework';
import '../../totals-refresh.css';

// "Totals refresh" (TOTALS_REFRESH, Zip 23, shared/totalsRefresh.ts): the Money > Totals screen from Alex's mock. Every figure comes from the
// server's `rework` answer (server/money.ts) exactly as the screen before it; the only new number is the cost per court (shared/totalsRefresh.ts).

type Rework = NonNullable<MonthlyMoney['rework']>;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The two cards and the collapsed Month by month card. */
export function TotalsRefresh({ ctx, t }: { ctx: AdminCtx; t: Rework }) {
  return (
    <div className="tr" data-totals data-totals-refresh>
      <TotalsCardView kind="sf" title="So far" paidLabel="Players paid" c={soFarCard(t)} />
      <TotalsCardView kind="pj" title="Projected" paidLabel="Players pay" c={projectedCard(t)} />
      <MonthByMonth ctx={ctx} />
    </div>
  );
}

/**
 * One card: Membership, Court costs, Owed to venue, Players paid / pay, then the total row. The big total is what the organizer is out after the
 * players' share. When the players paid MORE than the venue is owed it is a credit: green, with the word, never a minus sign.
 */
function TotalsCardView({ kind, title, paidLabel, c }: { kind: 'sf' | 'pj'; title: string; paidLabel: string; c: TotalsCard }) {
  const per = perCourtDollars(c.netCents, c.games);
  const credit = c.netCents < 0;
  return (
    <section className={`tr-card ${kind}`} data-card={kind === 'sf' ? 'so-far' : 'projected'} aria-label={title}>
      <dl className="tr-rows">
        <div className="tr-ln" data-row="membership">
          <dt>
            Membership <em>monthly</em>
          </dt>
          <dd>{formatPrice(c.membershipCents)}</dd>
        </div>
        <div className="tr-ln" data-row="court">
          <dt>
            Court costs <em>{plural(c.games, 'game', 'games')}</em>
          </dt>
          <dd>{formatPrice(c.courtCents)}</dd>
        </div>
        <div className="tr-ln sum" data-row="owed">
          <dt>Owed to venue</dt>
          <dd className="am" data-owed-total>
            {formatPrice(c.owedCents)}
          </dd>
        </div>
        <div className="tr-ln" data-row="players">
          <dt>{paidLabel}</dt>
          <dd className="gr">{minus(c.playersCents)}</dd>
        </div>
      </dl>
      <div className="tr-you">
        <div className="tr-t">
          <span className="tr-dot" aria-hidden="true" />
          {title}
        </div>
        <div className="tr-yr">
          {per !== null && (
            <span className={`tr-yp${credit ? ' credit' : ''}`} data-per-court={per}>
              {dollarsText(per)}/court{credit ? ' credit' : ''}
            </span>
          )}
          <span className={`tr-yn${credit ? ' credit' : ''}`} data-total={c.netCents}>
            {formatPrice(Math.abs(c.netCents))}
            {credit && <small> credit</small>}
          </span>
        </div>
      </div>
    </section>
  );
}

// ---------- Month by month ----------

const Chev = () => (
  <svg className="tr-chev" viewBox="0 0 14 9" aria-hidden="true">
    <path d="M1 1.5l6 6 6-6" />
  </svg>
);

/** One collapsed card. Opening it loads each past month's own Totals answer (nothing is loaded while it is closed). */
function MonthByMonth({ ctx }: { ctx: AdminCtx }) {
  const [open, setOpen] = useState(false);
  const nowMs = Date.parse(ctx.d.now);
  const tz = ctx.d.group.timezone;
  const months = pastMonths(monthChoices(ctx.d.sessions, nowMs, tz, ctx.d.gameMonthCounts), monthOf(nowMs, tz));
  return (
    <section className={`tr-mm${open ? ' open' : ''}`} data-fold="month-by-month">
      <button type="button" className="tr-mm-head" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <span className="tr-t plain">Month by month</span>
        <Chev />
      </button>
      {open && <MonthRows ctx={ctx} months={months} />}
    </section>
  );
}

function MonthRows({ ctx, months }: { ctx: AdminCtx; months: string[] }) {
  const pretend = usePretend();
  const demo = useDemoVersion();
  const load = useLoad(
    async () => {
      const answers = await Promise.all(months.map((m) => api<MonthlyMoney>('GET', `/api/admin/money?month=${m}`)));
      return months.map((m, i) => (answers[i].rework ? monthRowOf(m, answers[i].rework!) : null)).filter((r): r is MonthRow => r !== null);
    },
    [months.join(','), pretend, demo, ctx.d.version],
  );
  if (months.length === 0) return <p className="tr-mm-empty" data-no-months>No earlier months yet.</p>;
  if (load.error) return <ErrorState error={load.error} onRetry={load.reload} />;
  if (!load.data) return <Spinner />;
  return (
    <ul className="tr-mm-rows" data-month-rows>
      {load.data.map((r) => {
        const credit = r.netCents < 0;
        return (
          <li key={r.month} className="tr-mrow" data-month-row={r.month}>
            <span className="tr-mrow-l">
              <span className="tr-mrow-name">{monthBoxLabel(r.month)}</span>
              <span className="tr-mrow-sub">{r.games > 0 ? plural(r.games, 'game', 'games') : 'No games'}</span>
            </span>
            <span className="tr-mrow-r">
              <span className={`tr-mrow-net${credit ? ' credit' : ''}`} data-month-net={r.netCents}>
                {formatPrice(Math.abs(r.netCents))}
                {credit && <small> credit</small>}
              </span>
              {r.perCourt !== null && (
                <span className={`tr-mrow-sub${credit ? ' credit' : ''}`} data-month-per-court={r.perCourt}>
                  {dollarsText(r.perCourt)}/court{credit ? ' credit' : ''}
                </span>
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
