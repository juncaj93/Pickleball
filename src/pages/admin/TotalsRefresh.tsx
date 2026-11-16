import { useCallback, useEffect, useRef, useState } from 'react';
import type { MonthlyMoney } from '../../../shared/api';
import { formatPrice } from '../../../shared/money';
import { countedPastMonths, dollarsText, monthRowOf, perCourtDollars, projectedCard, runningTotalOf, sinceLabel, soFarCard, type TotalsCard } from '../../../shared/totalsRefresh';
import { ApiError, api, useDemoVersion, usePretend } from '../../lib';
import { ErrorState, Spinner } from '../../ui';
import type { AdminCtx } from '../Admin';
import { minus } from './MonthlyMoney';
import { monthBoxLabel, monthChoices, monthOf } from './moneyRework';
import '../../totals-refresh.css';

// "Totals refresh" (TOTALS_REFRESH, Zip 23, shared/totalsRefresh.ts): the Money > Totals screen from Alex's mock. Every figure comes from the
// server's `rework` answer (server/money.ts) exactly as the screen before it; the only new number is the cost per court (shared/totalsRefresh.ts).

type Rework = NonNullable<MonthlyMoney['rework']>;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * The two cards, then the collapsed Running total and Month by month cards. Both collapsed cards load nothing while closed; once one is open
 * they share the month answers (opening the second asks only for the months the first did not).
 */
export function TotalsRefresh({ ctx, t, month }: { ctx: AdminCtx; t: Rework; month: string }) {
  const nowMs = Date.parse(ctx.d.now);
  const tz = ctx.d.group.timezone;
  const currentMonth = monthOf(nowMs, tz);
  const past = countedPastMonths(monthChoices(ctx.d.sessions, nowMs, tz, ctx.d.gameMonthCounts), currentMonth);
  const [rtOpen, setRtOpen] = useState(false);
  const [mmOpen, setMmOpen] = useState(false);
  // The Running total always ends at the CURRENT month's So far card. When the screen is showing another month, that month's answer is asked for too.
  const rtMonths = month === currentMonth ? past : [currentMonth, ...past];
  const wanted = [...new Set([...(rtOpen ? rtMonths : []), ...(mmOpen ? past : [])])];
  const answers = useMonthAnswers(wanted, ctx.d.version);
  return (
    <div className="tr" data-totals data-totals-refresh>
      <TotalsCardView kind="sf" title="So far" paidLabel="Players paid" c={soFarCard(t)} />
      <TotalsCardView kind="pj" title="Projected" paidLabel="Players pay" c={projectedCard(t)} />
      <RunningTotal open={rtOpen} onToggle={() => setRtOpen((v) => !v)} past={past} currentMonth={currentMonth} current={month === currentMonth ? t : (answers.byMonth[currentMonth] ?? null)} answers={answers} />
      <MonthByMonth open={mmOpen} onToggle={() => setMmOpen((v) => !v)} past={past} answers={answers} />
    </div>
  );
}

// ---------- The month answers both collapsed cards use ----------

interface MonthAnswers {
  /** Every month answer loaded so far, by month ("2026-10"). null = the server answered with no numbers for that month (it is left out, never waited for). */
  byMonth: Record<string, Rework | null>;
  error: ApiError | null;
  /** Nothing has come back yet (draws the spinner); a later reload keeps what is on screen. */
  loading: boolean;
  reload: () => void;
}

/**
 * Loads each wanted month's own Totals answer (the same call Month by month always used). Nothing is asked for with no months wanted. A month
 * already loaded is not asked for again until the screen's data changes (a new version, View as, demo), when every wanted month is asked again.
 * Two loads can overlap; whichever started last is the one drawn, so older answers never land on top.
 */
function useMonthAnswers(wanted: string[], version: unknown): MonthAnswers {
  const pretend = usePretend();
  const demo = useDemoVersion();
  const stamp = `${String(pretend)}|${String(demo)}|${String(version)}`;
  const [store, setStore] = useState<{ stamp: string; byMonth: Record<string, Rework | null> }>({ stamp, byMonth: {} });
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(false);
  const latest = useRef(0);
  const key = wanted.join(',');
  const run = useCallback(
    async (force: boolean) => {
      if (wanted.length === 0) return;
      const have = !force && store.stamp === stamp ? store.byMonth : {};
      const missing = wanted.filter((m) => !(m in have));
      if (missing.length === 0) return;
      const n = ++latest.current;
      setLoading(true);
      setError(null);
      try {
        const got = await Promise.all(missing.map((m) => api<MonthlyMoney>('GET', `/api/admin/money?month=${m}`)));
        if (n !== latest.current) return;
        const byMonth = { ...have };
        missing.forEach((m, i) => {
          byMonth[m] = got[i].rework ?? null;
        });
        setStore({ stamp, byMonth });
        setError(null);
        setLoading(false);
      } catch (err) {
        if (n !== latest.current) return;
        setError(err instanceof ApiError ? err : new ApiError(0, 'error', 'Something went wrong.'));
        setLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key, stamp],
  );
  useEffect(() => {
    void run(false);
  }, [run]);
  return { byMonth: store.byMonth, error, loading, reload: () => void run(true) };
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
            <span className={`tr-yp${per < 0 ? ' credit' : ''}`} data-per-court={per}>
              {dollarsText(per)}/court{per < 0 ? ' credit' : ''}
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
function MonthByMonth({ open, onToggle, past, answers }: { open: boolean; onToggle: () => void; past: string[]; answers: MonthAnswers }) {
  return (
    <section className={`tr-mm${open ? ' open' : ''}`} data-fold="month-by-month">
      <button type="button" className="tr-mm-head" aria-expanded={open} onClick={onToggle}>
        <span className="tr-t plain">Month by month</span>
        <Chev />
      </button>
      {open && <MonthRows months={past} answers={answers} />}
    </section>
  );
}

function MonthRows({ months, answers }: { months: string[]; answers: MonthAnswers }) {
  if (months.length === 0) return <p className="tr-mm-empty" data-no-months>No earlier months yet.</p>;
  const ready = months.every((m) => m in answers.byMonth);
  if (answers.error && !ready) return <ErrorState error={answers.error} onRetry={answers.reload} />;
  if (!ready) return <Spinner />;
  const rows = months.flatMap((m) => {
    const t = answers.byMonth[m];
    return t ? [monthRowOf(m, t)] : [];
  });
  return (
    <ul className="tr-mm-rows" data-month-rows>
      {rows.map((r) => {
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
                <span className={`tr-mrow-sub${r.perCourt < 0 ? ' credit' : ''}`} data-month-per-court={r.perCourt}>
                  {dollarsText(r.perCourt)}/court{r.perCourt < 0 ? ' credit' : ''}
                </span>
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

// ---------- Running total ----------

/** "$21", or "$4 credit" in green when the players paid more than the venue was owed (never a minus sign). */
function Money({ dollars }: { dollars: number }) {
  return (
    <>
      {dollarsText(dollars)}
      {dollars < 0 && <small> credit</small>}
    </>
  );
}

/**
 * One collapsed card between Projected and Month by month: what the group has cost the organizer across every month counted (shared/totalsRefresh.ts).
 * Past months come from each month's finished answer, the current month from the So far card. Closed, it loads nothing.
 */
function RunningTotal({ open, onToggle, past, currentMonth, current, answers }: { open: boolean; onToggle: () => void; past: string[]; currentMonth: string; current: Rework | null; answers: MonthAnswers }) {
  return (
    <section className={`tr-mm rt${open ? ' open' : ''}`} data-fold="running-total">
      <button type="button" className="tr-mm-head" aria-expanded={open} onClick={onToggle}>
        <span className="tr-t plain">Running total</span>
        <Chev />
      </button>
      {open && <RunningRows past={past} currentMonth={currentMonth} current={current} answers={answers} />}
    </section>
  );
}

function RunningRows({ past, currentMonth, current, answers }: { past: string[]; currentMonth: string; current: Rework | null; answers: MonthAnswers }) {
  const ready = current !== null && past.every((m) => m in answers.byMonth);
  if (answers.error && !ready) return <ErrorState error={answers.error} onRetry={answers.reload} />;
  if (!ready) return <Spinner />;
  const counted = [...past].reverse().filter((m) => answers.byMonth[m]);
  const total = runningTotalOf([...counted.map((m) => soFarCard(answers.byMonth[m]!)), soFarCard(current)]);
  const credit = total.outOfPocketCents < 0;
  const avg = total.averagePerMonth;
  return (
    <div data-running-rows>
      <dl className="tr-rows">
        <div className="tr-ln" data-row="rt-membership">
          <dt>
            Membership <em>{plural(total.months, 'month', 'months')}</em>
          </dt>
          <dd>{formatPrice(total.membershipCents)}</dd>
        </div>
        <div className="tr-ln" data-row="rt-court">
          <dt>
            Court costs after players <em>{plural(total.games, 'game', 'games')}</em>
          </dt>
          <dd className={total.courtAfterPlayersCents < 0 ? 'gr' : undefined}>
            {formatPrice(Math.abs(total.courtAfterPlayersCents))}
            {total.courtAfterPlayersCents < 0 && <small> credit</small>}
          </dd>
        </div>
        <div className="tr-ln sum" data-row="rt-out">
          <dt>Out of pocket</dt>
          <dd className={credit ? 'gr' : 'am'} data-out-of-pocket={total.outOfPocketCents}>
            {formatPrice(Math.abs(total.outOfPocketCents))}
            {credit && <small> credit</small>}
          </dd>
        </div>
        <div className="tr-ln" data-row="rt-average">
          <dt>Average per month</dt>
          <dd className={avg !== null && avg < 0 ? 'gr' : undefined} data-average={avg ?? ''}>
            {avg !== null && <Money dollars={avg} />}
          </dd>
        </div>
      </dl>
      <div className="tr-you">
        <div className="tr-t">
          <span className="tr-dot" aria-hidden="true" />
          Since {sinceLabel(counted[0] ?? currentMonth, currentMonth)}
        </div>
        {total.perGame !== null && (
          <div className="tr-yr">
            <span className="tr-yp">per game</span>
            <span className={`tr-yn${total.perGame < 0 ? ' credit' : ''}`} data-per-game={total.perGame}>
              <Money dollars={total.perGame} />
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
