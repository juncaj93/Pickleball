import { formatCents } from '../../../shared/money';
import { formatShortDate } from '../../../shared/time';
import { Chip, Empty } from '../../ui';
import type { AdminCtx } from '../Admin';

export function PaymentsTab({ ctx }: { ctx: AdminCtx }) {
  const tz = ctx.d.group.timezone;
  const sessions = ctx.d.sessions.filter((s) => s.courtCostCents !== null && (s.payableCount > 0 || s.roster.some((r) => r.paymentStatus === 'paid')));

  const owedByPlayer = new Map<string, { name: string; cents: number; count: number }>();
  for (const s of sessions) {
    if (s.state.flags.canceled) continue;
    for (const r of s.roster) {
      if (r.status !== 'confirmed' || r.paymentStatus !== 'unpaid' || r.shareCents === null) continue;
      const cur = owedByPlayer.get(r.playerId) ?? { name: r.name, cents: 0, count: 0 };
      cur.cents += r.shareCents;
      cur.count += 1;
      owedByPlayer.set(r.playerId, cur);
    }
  }
  const owed = [...owedByPlayer.values()].sort((a, b) => b.cents - a.cents);
  const total = owed.reduce((a, o) => a + o.cents, 0);
  const flagged = sessions.filter((s) => s.roster.some((r) => r.paymentDifferenceCents !== null));

  return (
    <>
      <section className="card stack" aria-labelledby="unpaid-title">
        <div className="spread">
          <h2 id="unpaid-title">Unpaid</h2>
          <div className="big-amount">{formatCents(total)}</div>
        </div>
        {owed.length === 0 ? (
          <p className="muted">Everyone's paid up.</p>
        ) : (
          <ul className="list">
            {owed.map((o) => (
              <li key={o.name} className="spread">
                <span>
                  {o.name} <span className="muted small">· {o.count} session{o.count === 1 ? '' : 's'}</span>
                </span>
                <span className="amount">{formatCents(o.cents)}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="small muted">Includes upcoming sessions with a cost entered. Totals cover the last 90 days.</p>
      </section>

      {flagged.length > 0 && (
        <section className="card stack">
          <h2>Needs a look</h2>
          <p className="small muted">The cost or lineup changed after someone paid.</p>
          {flagged.map((s) => (
            <button key={s.id} className="btn small secondary" onClick={() => ctx.open('payments', s.id)}>
              {formatShortDate(s.startsAt, tz)}
            </button>
          ))}
        </section>
      )}

      <h2 className="section-title">By session</h2>
      {sessions.length === 0 && <Empty>No sessions with a court cost yet.</Empty>}
      {[...sessions].reverse().map((s) => (
        <button
          key={s.id}
          className="card tight spread"
          style={{ textAlign: 'left', font: 'inherit', color: 'inherit', cursor: 'pointer', width: '100%' }}
          onClick={() => ctx.open('payments', s.id)}
        >
          <span>
            <strong>{formatShortDate(s.startsAt, tz)}</strong>
            <span className="muted small"> · {formatCents(s.courtCostCents ?? 0)}</span>
          </span>
          {s.state.flags.canceled ? (
            <Chip tone="muted">Canceled</Chip>
          ) : (
            <Chip tone={s.paidCount === s.payableCount ? 'ok' : 'warn'}>
              {s.paidCount}/{s.payableCount} paid
            </Chip>
          )}
        </button>
      ))}
    </>
  );
}
