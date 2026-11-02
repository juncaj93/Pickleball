import { type ReactNode, useState } from 'react';
import type { AdminSessionView } from '../../../shared/api';
import { formatPrice } from '../../../shared/money';
import { formatShortDate, formatTime, localParts } from '../../../shared/time';
import { useNow } from '../../lib';
import { Chip, Sheet } from '../../ui';
import { RollText } from '../../motion';
import type { AdminCtx } from '../Admin';
import { shiftMonth } from './MonthlyMoney';
import { Chevron, currentMonth, GameBody, RemindList, shortMonth, Totals } from './MoneyV2';
import { moneyGames, owedCentsOf, unpaidRows } from './moneyList';
import '../../credit-admin.css';
import '../../admin-r2.css';

/**
 * Money, round 2 (ADMIN_R2): the slim control bar (month stepper, Who paid | Totals), then one tight list by date. Same money, same
 * totals and the same buttons as the other Money tabs; only the way it is shown changed.
 */
export function MoneyTabR2({ ctx }: { ctx: AdminCtx }) {
  const [view, setView] = useState<'who' | 'totals'>('who');
  const [month, setMonth] = useState(() => currentMonth(ctx));
  return (
    <section className="stack money-v2 money-r2" aria-label="Money">
      <div className="mv2-controls r2m-controls">
        <div className="month-picker" role="group" aria-label="Month">
          <button className="btn small secondary" aria-label="Previous month" onClick={() => setMonth((x) => shiftMonth(x, -1))}>
            ‹
          </button>
          <label className="sr-only" htmlFor="mv2-month">
            Month
          </label>
          <div className="month-field">
            <span className="month-label" aria-hidden="true" data-month-label>
              {shortMonth(month)}
            </span>
            <input
              id="mv2-month"
              type="month"
              value={month}
              onChange={(e) => e.target.value && setMonth(e.target.value)}
              onClick={(e) => {
                try {
                  e.currentTarget.showPicker?.();
                } catch {
                  /* some browsers only open it on their own */
                }
              }}
            />
          </div>
          <button className="btn small secondary" aria-label="Next month" onClick={() => setMonth((x) => shiftMonth(x, 1))}>
            ›
          </button>
        </div>
        <div className="segmented compact" role="group" aria-label="Who paid or Totals">
          <button aria-pressed={view === 'who'} onClick={() => setView('who')}>
            Who paid
          </button>
          <button aria-pressed={view === 'totals'} onClick={() => setView('totals')}>
            Totals
          </button>
        </div>
      </div>
      {view === 'who' ? <WhoPaidR2 ctx={ctx} /> : <Totals ctx={ctx} month={month} />}
    </section>
  );
}

function WhoPaidR2({ ctx }: { ctx: AdminCtx }) {
  const nowMs = useNow();
  const tz = ctx.d.group.timezone;
  const ordered = moneyGames(ctx.d.sessions, nowMs);
  // The next game with money to show starts open; any number can be open at once.
  const [open, setOpen] = useState<Set<string>>(() => {
    const first = ordered.find((g) => g.kind === 'money');
    return new Set(first ? [first.s.id] : []);
  });
  const [remind, setRemind] = useState<string | null>(null);
  const toggle = (id: string) =>
    setOpen((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const remindSession = ordered.find((g) => g.s.id === remind)?.s ?? null;
  if (ordered.length === 0) return <p className="muted small">Nobody is signed up yet.</p>;
  const dayCount = new Map<string, number>();
  for (const g of ordered) dayCount.set(formatShortDate(g.s.startsAt, tz), (dayCount.get(formatShortDate(g.s.startsAt, tz)) ?? 0) + 1);
  return (
    <>
      <div className="mv2-games r2m-games">
        {ordered.map((g) =>
          g.kind === 'waiting' ? (
            <WaitingR2 key={g.s.id} ctx={ctx} s={g.s} />
          ) : (
            <GameR2 key={g.s.id} ctx={ctx} s={g.s} open={open.has(g.s.id)} onToggle={() => toggle(g.s.id)} onRemind={() => setRemind(g.s.id)} sameDay={(dayCount.get(formatShortDate(g.s.startsAt, tz)) ?? 0) > 1} />
          ),
        )}
      </div>
      <Sheet open={!!remindSession} title={remindSession ? `Remind · ${formatShortDate(remindSession.startsAt, tz)}` : ''} onClose={() => setRemind(null)}>
        {remindSession && <RemindList ctx={ctx} s={remindSession} />}
      </Sheet>
    </>
  );
}

const DOW = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

/** The small date tile: red weekday over the day number. Dashed when the game is waiting on a court, pale when it is closed. */
function MoneyTile({ iso, tz, look }: { iso: string; tz: string; look?: 'waiting' | 'closed' }) {
  const p = localParts(Date.parse(iso), tz);
  return (
    <span className={`r2m-tile${look ? ` ${look}` : ''}`} aria-hidden="true">
      <i>{DOW[p.weekday]}</i>
      <b>{p.day}</b>
    </span>
  );
}

/** "1 of 3 paid" bars: one segment per person. Paid is blue until the game is finalized, then green; unpaid is amber. */
function Bars({ s }: { s: AdminSessionView }) {
  const n = s.payableCount;
  if (n <= 0 || s.state.flags.canceled) return null;
  return (
    <span className={`r2m-bars${s.finalized ? ' final' : ''}`} aria-hidden="true" data-bars={`${s.paidCount}/${n}`}>
      {Array.from({ length: n }, (_, i) => (
        <i key={i} className={i < s.paidCount ? 'p' : undefined} />
      ))}
    </span>
  );
}

/** The one-line summary of a game. */
function summary(s: AdminSessionView): string {
  if (s.state.flags.canceled) return s.cancelReason ? `Canceled - ${s.cancelReason}` : 'Canceled';
  if (s.finalized) return `${s.finalized.playedCount} played · $${s.finalized.priceCents / 100} each`;
  if (s.payableCount > 0) return `${s.paidCount} of ${s.payableCount} paid`;
  return 'Nobody in yet';
}

function GameR2({ ctx, s, open, onToggle, onRemind, sameDay }: { ctx: AdminCtx; s: AdminSessionView; open: boolean; onToggle: () => void; onRemind: () => void; sameDay: boolean }) {
  const tz = ctx.d.group.timezone;
  const date = formatShortDate(s.startsAt, tz);
  const canceled = s.state.flags.canceled;
  const sub = summary(s);
  const owedRows = unpaidRows(s);
  const owedCents = owedCentsOf(s);
  let status: ReactNode = null;
  if (canceled && owedCents === 0) status = <span className="r2m-closed">Closed</span>;
  else if (s.needsFinalize) status = <Chip tone="warn">Finalize</Chip>;
  else if (owedCents > 0)
    status = (
      <span className="r2m-owed" data-owed={owedCents}>
        <span className="sr-only">Owed </span>
        <RollText text={formatPrice(owedCents)} />
      </span>
    );
  else if (s.court?.paid === false) status = <Chip tone="muted">Court due</Chip>;
  else if (s.payableCount > 0) status = <span className="r2m-allpaid">All paid</span>;
  const showRemind = open && owedRows.length > 0;
  return (
    <article className={`card mv2-game r2m-game${open ? ' open' : ''}${canceled ? ' closed' : ''}`} data-session={s.id} data-open={open ? 'yes' : 'no'}>
      <div className="r2m-head">
        <button type="button" className="r2m-toggle" aria-expanded={open} aria-label={`${date}, ${sub}`} onClick={onToggle}>
          <MoneyTile iso={s.startsAt} tz={tz} look={canceled ? 'closed' : undefined} />
          <span className="r2m-text">
            <span className="r2m-sub">
              {sameDay ? `${formatTime(s.startsAt, tz)} · ` : ''}
              <RollText text={sub} />
            </span>
            <Bars s={s} />
          </span>
        </button>
        {showRemind ? (
          <button type="button" className="btn small secondary r2m-remind" data-remind onClick={onRemind}>
            Remind {owedRows.length}
          </button>
        ) : (
          <span className="r2m-status">{status}</span>
        )}
        <button type="button" className="r2m-chev" aria-hidden="true" tabIndex={-1} onClick={onToggle}>
          <Chevron />
        </button>
      </div>
      {open && <GameBody ctx={ctx} s={s} r2 />}
    </article>
  );
}

/** A coming game with no court yet: gray, nothing to open. The holiday or label comes first when there is one. */
function WaitingR2({ ctx, s }: { ctx: AdminCtx; s: AdminSessionView }) {
  const tz = ctx.d.group.timezone;
  const name = s.holiday ?? s.note ?? null;
  return (
    <div className="card mv2-game r2m-game later" data-session={s.id} data-waiting>
      <div className="r2m-head">
        <div className="r2m-toggle static">
          <MoneyTile iso={s.startsAt} tz={tz} look="waiting" />
          <span className="r2m-text">
            <span className="r2m-sub">{name ?? 'Waiting on court'}</span>
            {name && <span className="r2m-sub2">waiting on court</span>}
          </span>
        </div>
      </div>
    </div>
  );
}
