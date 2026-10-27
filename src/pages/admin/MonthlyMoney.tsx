import { useState } from 'react';
import type { MonthlyMoney } from '../../../shared/api';
import { formatPrice } from '../../../shared/money';
import { formatShortDate, localParts } from '../../../shared/time';
import { api, useLoad } from '../../lib';
import { ErrorState, Spinner } from '../../ui';
import type { AdminCtx } from '../Admin';

const STATE_TEXT = { played: '', canceled: 'Canceled, not counted', upcoming: 'Not played yet', not_played: 'Not played, not counted' };

function shift(month: string, by: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Organizer-only month view, opened from Settings. Players never get any of this. */
export function MonthlyMoneyPage({ ctx, onBack }: { ctx: AdminCtx; onBack?: () => void }) {
  const tz = ctx.d.group.timezone;
  const [month, setMonth] = useState(() => {
    const p = localParts(Date.parse(ctx.d.now), tz);
    return `${p.year}-${String(p.month).padStart(2, '0')}`;
  });
  const load = useLoad(() => api<MonthlyMoney>('GET', `/api/admin/money?month=${month}`), [month]);
  const m = load.data;
  return (
    <section className="stack" aria-labelledby="mm-title">
      <div className="spread" style={{ alignItems: 'center' }}>
        <h2 id="mm-title" className="section-title">
          Monthly money
        </h2>
        {onBack && (
          <button className="btn small ghost" onClick={onBack}>
            Back to Settings
          </button>
        )}
      </div>
      <div className="month-picker">
        <button className="btn small secondary" aria-label="Previous month" onClick={() => setMonth((x) => shift(x, -1))}>
          ‹
        </button>
        <label className="sr-only" htmlFor="mm-month">
          Month
        </label>
        <input id="mm-month" type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} />
        <button className="btn small secondary" aria-label="Next month" onClick={() => setMonth((x) => shift(x, 1))}>
          ›
        </button>
      </div>
      {load.loading && !m && <Spinner />}
      {load.error && <ErrorState error={load.error} onRetry={load.reload} />}
      {m && (
        <>
          <div className={`card money-sum ${m.netCents >= 0 ? 'surplus' : 'short'}`}>
            <p className="bottom-line">{m.bottomLine}</p>
            <dl className="kv">
              <dt>Collected</dt>
              <dd>{formatPrice(m.collectedCents)}</dd>
              <dt>Court costs</dt>
              <dd>−{formatPrice(m.courtCostCents)}</dd>
              <dt>Credits owed</dt>
              <dd>−{formatPrice(m.creditsOwedCents)}</dd>
              <dt>Left</dt>
              <dd>
                <strong>{m.netCents < 0 ? `−${formatPrice(-m.netCents)}` : formatPrice(m.netCents)}</strong>
              </dd>
              <dt>Membership</dt>
              <dd>{formatPrice(m.membershipCents)}</dd>
            </dl>
          </div>
          {m.sessions.length === 0 ? (
            <p className="muted small">No sessions in {m.label}.</p>
          ) : (
            <details className="money-sess card">
              <summary>
                <span>Sessions in {m.label}</span>
                <span className="set-note">{m.sessions.filter((x) => x.state === 'played').length} played</span>
              </summary>
            <ul className="rows" aria-label={`Sessions in ${m.label}`}>
              {m.sessions.map((s) => (
                <li key={s.id}>
                  <span className="who">
                    <strong>{formatShortDate(s.startsAt, tz)}</strong>
                    <span className="small muted">
                      {s.state === 'played'
                        ? `${formatPrice(s.collectedCents)} in · court ${formatPrice(s.courtCostCents)}${s.typicalCost ? ' (typical)' : ''}`
                        : STATE_TEXT[s.state]}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
            </details>
          )}
        </>
      )}
    </section>
  );
}
