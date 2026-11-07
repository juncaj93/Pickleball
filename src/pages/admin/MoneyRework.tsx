import { useInstant } from '../../InstantTaps';
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { AdminSessionView, MonthlyMoney } from '../../../shared/api';
import { formatPrice } from '../../../shared/money';
import { formatShortDate, formatTime, localParts } from '../../../shared/time';
import { api, useDemoVersion, useLoad, usePretend } from '../../lib';
import { zonedTimeToUtc } from '../../../shared/time';
import { ErrorState, Spinner } from '../../ui';
import type { AdminCtx } from '../Admin';
import { minus, monthName } from './MonthlyMoney';
import { Chevron, currentMonth, GameBody } from './MoneyV2';
import { ReworkRemind } from './MoneyReworkParts';
import { unpaidRows, owedCentsOf } from './moneyList';
import { creditPerPlayerCents, fullyPaid, monthBoxLabel, monthChoices, monthRowLabel, monthRows, type RwGame, splitGames } from './moneyRework';
import { ReworkOpsProvider, useReworkPatch } from './ReworkOps';
import '../../money-rework.css';
import { viewFlat } from '../../../shared/gameLength';

const DOW = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

/**
 * The Money page, reworked (MONEY_REWORK, admin only). Top row: a month box that drops a small list, and Games | Totals. Games shows today
 * and the next 7 days with a collapsed "Previous games" card; Totals shows what is owed to the venue and what it comes to by month's end.
 * Same money, same rules and the same buttons as the Money tabs before it; only the way it is shown changed.
 */
export function MoneyTabRework({ ctx: realCtx }: { ctx: AdminCtx }) {
  const [view, setView] = useState<'games' | 'totals'>('games');
  const [month, setMonth] = useState(() => currentMonth(realCtx));
  const instantOn = useInstant() !== null;
  // Instant taps: `ctx` below already shows any tap whose save is still running (ReworkOps.tsx). Totals read the real data and follow the save.
  return (
    // Keyed on instant taps, so the Money page's own queue follows the switch if it flips while the page is open.
    <ReworkOpsProvider key={instantOn ? 'instant' : 'plain'} ctx={realCtx}>
      {(ctx) => (
        <section className="stack money-rework" aria-label="Money">
          <div className="mrw-controls">
            <MonthBox ctx={ctx} month={month} onPick={setMonth} />
            <div className="segmented mrw-seg" role="group" aria-label="Games or Totals">
              <button type="button" aria-pressed={view === 'games'} onClick={() => setView('games')}>
                Games
              </button>
              <button type="button" aria-pressed={view === 'totals'} onClick={() => setView('totals')}>
                Totals
              </button>
            </div>
          </div>
          {view === 'games' ? <GamesRework ctx={ctx} month={month} /> : <TotalsRework ctx={realCtx} month={month} />}
        </section>
      )}
    </ReworkOpsProvider>
  );
}

// ---------- The month box ----------

/**
 * "Nov 2026": tap it and a small list drops straight under it (rounded on every corner, scrolls when long): "Nov 2026" and how many games
 * that month holds, the chosen month in green. A tap outside, Escape, or picking a month closes it. No arrows, no carets.
 */
function MonthBox({ ctx, month, onPick }: { ctx: AdminCtx; month: string; onPick: (m: string) => void }) {
  // The server's clock (the screen reloads at least every few minutes), so "today" always agrees with what the server counts.
  const nowMs = Date.parse(ctx.d.now);
  const tz = ctx.d.group.timezone;
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const rows = monthRows(monthChoices(ctx.d.sessions, nowMs, tz, ctx.d.gameMonthCounts));
  const pop = useRef<HTMLUListElement>(null);
  // A thin fade at the bottom while there is more to scroll to (the scroll bar can hide on a phone).
  const [more, setMore] = useState(false);
  const measure = () => {
    const el = pop.current;
    if (el) setMore(el.scrollTop + el.clientHeight < el.scrollHeight - 2);
  };
  // Opens with the chosen month in view.
  useLayoutEffect(() => {
    const el = pop.current;
    if (!open || !el) return;
    const on = el.querySelector<HTMLElement>('.mrw-monthrow.on');
    if (on) el.scrollTop = Math.max(0, on.offsetTop - 6);
    measure();
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!open) return;
    const down = (e: Event) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', down, true);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('pointerdown', down, true);
      document.removeEventListener('keydown', key);
    };
  }, [open]);
  return (
    <div className="mrw-monthwrap" ref={wrap}>
      <button type="button" className="mrw-month" aria-haspopup="listbox" aria-expanded={open} aria-label={`Month: ${monthName(month)}`} data-month-box onClick={() => setOpen((v) => !v)}>
        {monthBoxLabel(month)}
      </button>
      {open && (
        <ul ref={pop} className={`mrw-monthpop${more ? ' more' : ''}`} role="listbox" aria-label="Choose a month" data-month-pop onScroll={measure}>
          {rows.map((r) =>
            r.kind === 'year' ? (
              <li key={`y${r.year}`} role="presentation" className="mrw-monthyear" data-year-label>
                {r.year}
              </li>
            ) : (
              <li key={r.month} role="presentation">
                <button
                  type="button"
                  role="option"
                  aria-selected={r.month === month}
                  className={`mrw-monthrow${r.month === month ? ' on' : ''}`}
                  data-month-option={r.month}
                  onClick={() => {
                    onPick(r.month);
                    setOpen(false);
                  }}
                >
                  <span>{monthRowLabel(r.month)}</span>
                  <span className="mrw-monthcount">{r.count}</span>
                </button>
              </li>
            ),
          )}
          <li role="presentation" aria-hidden="true" className="mrw-monthfade" />
        </ul>
      )}
    </div>
  );
}

// ---------- Games ----------

const Tile = ({ iso, tz, closed }: { iso: string; tz: string; closed?: boolean }) => {
  const p = localParts(Date.parse(iso), tz);
  return (
    <span className={`r2m-tile${closed ? ' closed' : ''}`} aria-hidden="true">
      <i>{DOW[p.weekday]}</i>
      <b>{p.day}</b>
    </span>
  );
};

const Check = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="m5 12 5 5 9-10" />
  </svg>
);

/** One dot per person who pays: filled green when paid. */
function Dots({ s }: { s: AdminSessionView }) {
  const n = s.payableCount;
  if (n <= 0 || (s.state.flags.canceled && !s.roster.some((r) => r.lateFee))) return null;
  return (
    <span className="mrw-dots" aria-hidden="true" data-dots={`${s.paidCount}/${n}`}>
      {Array.from({ length: n }, (_, i) => (
        <i key={i} className={i < s.paidCount ? 'p' : undefined} />
      ))}
    </span>
  );
}

function titleOf(s: AdminSessionView): string {
  if (s.state.flags.canceled && !s.roster.some((r) => r.lateFee)) return s.cancelReason ? `Canceled - ${s.cancelReason}` : 'Canceled';
  if (s.payableCount > 0) return `${s.paidCount} of ${s.payableCount} paid`;
  return 'Nobody in yet';
}

function GamesRework({ ctx, month }: { ctx: AdminCtx; month: string }) {
  // The server's clock (the screen reloads at least every few minutes), so "today" always agrees with what the server counts.
  const nowMs = Date.parse(ctx.d.now);
  const tz = ctx.d.group.timezone;
  // The dashboard carries about the last 90 days of games. A month that ended before that is loaded on its own, so every month in the list can be opened.
  const older = zonedTimeToUtc(Number(month.slice(0, 4)), Number(month.slice(5)) + 1, 1, 0, 0, tz) < nowMs - 80 * 86_400_000;
  const pretend = usePretend();
  const demo = useDemoVersion();
  const patch = useReworkPatch();
  const loaded = useLoad(() => (older ? api<{ month: string; sessions: AdminSessionView[] }>('GET', `/api/admin/month-games?month=${month}`) : Promise.resolve(null)), [month, older, ctx.d.version, pretend, demo]);
  const own = older && loaded.data?.month === month ? loaded.data.sessions : null;
  const sessions = older ? (own ? patch(own) : []) : ctx.d.sessions;
  const { main, previous } = splitGames(sessions, month, nowMs, tz);
  // The first game in the list starts open; a tap opens or folds any card. (Overrides only, so a game never moves on its own.)
  const [over, setOver] = useState<Record<string, boolean>>({});
  // Which game starts open is decided once for this month on screen. When the last Mark paid on a card moves it to Previous games, the next
  // game must not pop open under the finger.
  const firstRef = useRef<{ month: string; id: string | undefined } | null>(null);
  if (!firstRef.current || firstRef.current.month !== month) firstRef.current = { month, id: main[0]?.s.id };
  const firstId = firstRef.current.id;
  const isOpen = (id: string) => over[id] ?? id === firstId;
  const toggle = (id: string) => setOver((cur) => ({ ...cur, [id]: !(cur[id] ?? id === firstId) }));
  const [remind, setRemind] = useState<string | null>(null);
  const all = [...main, ...previous];
  const remindSession = all.find((g) => g.s.id === remind)?.s ?? null;
  const sameDay = (s: AdminSessionView) => all.filter((g) => formatShortDate(g.s.startsAt, tz) === formatShortDate(s.startsAt, tz)).length > 1;
  if (older && !own) return loaded.error ? <ErrorState error={loaded.error} onRetry={loaded.reload} /> : <Spinner />;
  if (all.length === 0) return <p className="muted small" data-no-games>No games in {monthName(month)}.</p>;
  return (
    <>
      <div className="mrw-games">
        {main.map((g) => (
          <GameCard key={g.s.id} ctx={ctx} g={g} open={isOpen(g.s.id)} onToggle={() => toggle(g.s.id)} onRemind={() => setRemind(g.s.id)} sameDay={sameDay(g.s)} />
        ))}
        {previous.length > 0 && <FoldList ctx={ctx} id="previous" title="Previous games" games={previous} sameDay={sameDay} />}
      </div>
      <ReworkRemind ctx={ctx} s={remindSession} open={!!remindSession} onClose={() => setRemind(null)} />
    </>
  );
}

function GameCard({ ctx, g, open, onToggle, onRemind, sameDay }: { ctx: AdminCtx; g: RwGame; open: boolean; onToggle: () => void; onRemind: () => void; sameDay: boolean }) {
  const { s } = g;
  const tz = ctx.d.group.timezone;
  const date = formatShortDate(s.startsAt, tz);
  const closed = g.kind === 'closed';
  const owedRows = unpaidRows(s);
  const owed = owedCentsOf(s);
  const title = titleOf(s);
  const price = s.finalized ? s.finalized.priceCents : viewFlat(s, ctx.d.group.settings.pricePerPlayerCents);
  const credit = creditPerPlayerCents(s, ctx.d.group.settings);
  let right: ReactNode = null;
  if (closed) right = <span className="mrw-pill muted">Closed</span>;
  else if (open && owedRows.length > 0)
    right = (
      <button type="button" className="mrw-remind" data-remind onClick={onRemind}>
        Remind ({owedRows.length})
      </button>
    );
  else if (!open && owed > 0)
    right = (
      <span className="mrw-owed" data-owed={owed}>
        <span className="sr-only">Owed </span>
        {formatPrice(owed)} owed
      </span>
    );
  else if (!open && s.needsFinalize) right = <span className="mrw-pill warn">Finalize</span>;
  return (
    <article className={`card mrw-game${open ? ' open' : ''}${closed ? ' closed' : ''}`} data-session={s.id} data-open={open ? 'yes' : 'no'} data-kind={g.kind}>
      <div className="mrw-head">
        <button type="button" className="mrw-toggle" aria-expanded={open} aria-label={`${date}, ${title}`} onClick={onToggle}>
          <Tile iso={s.startsAt} tz={tz} closed={closed} />
          <span className="mrw-text">
            <span className="mrw-title">
              {sameDay ? <span className="mrw-time">{formatTime(s.startsAt, tz)} · </span> : null}
              {title}
            </span>
            <Dots s={s} />
          </span>
        </button>
        {right && <span className="mrw-right">{right}</span>}
      </div>
      {open && <GameBody ctx={ctx} s={s} rework />}
      {open && !closed && s.court && (
        <div className="mrw-foot" data-card-foot>
          <span>{formatPrice(price)}/person</span>
          <span className="mrw-foot-mid">{credit > 0 ? `Credit: ${formatPrice(credit)} per` : ''}</span>
          <span>Court {formatPrice(s.court.costCents)}</span>
        </div>
      )}
    </article>
  );
}

/** "Previous games" / "Later games": one collapsed card; its rows are plain white, each opens to the game. */
function FoldList({ ctx, id, title, games, sameDay }: { ctx: AdminCtx; id: string; title: string; games: RwGame[]; sameDay: (s: AdminSessionView) => boolean }) {
  const tz = ctx.d.group.timezone;
  const [open, setOpen] = useState(false);
  const [openRow, setOpenRow] = useState<string | null>(null);
  return (
    <section className={`card mrw-fold${open ? ' open' : ''}`} data-fold={id}>
      <button type="button" className="mrw-fold-head" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <span>{title}</span>
        <span className="mrw-fold-chev" aria-hidden="true">
          <Chevron />
        </span>
      </button>
      {open && (
        <ul className="mrw-fold-rows">
          {games.map((g) => {
            const { s } = g;
            const rowOpen = openRow === s.id;
            const closed = g.kind === 'closed';
            const paid = fullyPaid(s);
            const owed = owedCentsOf(s);
            return (
              <li key={s.id} className={`mrw-prow${rowOpen ? ' open' : ''}`} data-session={s.id} data-open={rowOpen ? 'yes' : 'no'} data-fully-paid={paid ? 'yes' : 'no'}>
                <button type="button" className="mrw-prow-head" aria-expanded={rowOpen} aria-label={`${formatShortDate(s.startsAt, tz)}, ${titleOf(s)}`} onClick={() => setOpenRow(rowOpen ? null : s.id)}>
                  <Tile iso={s.startsAt} tz={tz} closed={closed} />
                  <span className="mrw-title">
                    {sameDay(s) ? <span className="mrw-time">{formatTime(s.startsAt, tz)} · </span> : null}
                    {titleOf(s)}
                  </span>
                  {paid && (
                    <span className="mrw-prow-check" data-check>
                      <Check />
                      <span className="sr-only">Paid</span>
                    </span>
                  )}
                  {!paid && owed > 0 && <span className="mrw-owed small-owed">{formatPrice(owed)} owed</span>}
                </button>
                {rowOpen && <GameBody ctx={ctx} s={s} rework />}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

// ---------- Totals ----------

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The two cards. Real numbers only (server/money.ts): nothing here is worked out on this screen except the words. */
function TotalsRework({ ctx, month }: { ctx: AdminCtx; month: string }) {
  const pretend = usePretend();
  const demo = useDemoVersion();
  const load = useLoad(() => api<MonthlyMoney>('GET', `/api/admin/money?month=${month}`), [month, pretend, demo, ctx.d]);
  const m = load.data;
  if (load.loading && !m) return <Spinner />;
  if (load.error) return <ErrorState error={load.error} onRetry={load.reload} />;
  const t = m?.rework;
  if (!m || !t) return null;
  const p = t.projected;
  const eq = (membership: number, court: number, courts: number) => `${formatPrice(membership)} + ${formatPrice(court)} (${plural(courts, 'court', 'courts')})`;
  return (
    <div className="mrw-totals" data-totals>
      <section className="card mrw-card" data-card="so-far" aria-label="Owed to venue so far">
        <div className="mrw-card-head">
          <h3 className="mrw-card-title">Owed to venue so far</h3>
          <span className="mrw-big amber" data-owed-total data-long={t.owedToVenueCents >= 100000 ? '' : undefined}>
            {formatPrice(t.owedToVenueCents)}
          </span>
        </div>
        <dl className="mrw-cols">
          <Col label="Court costs" value={formatPrice(t.courtCostCents)} note={plural(t.courtSessions, 'court', 'courts')} data="court" />
          <Col label="Membership" value={formatPrice(t.membershipCents)} note="monthly" data="membership" />
          <Col label="Collected" value={minus(t.collectedCents)} note="from players" tone="green" data="collected" />
        </dl>
        <div className="mrw-yours" data-yours="so-far">
          <span className="mrw-yours-label">Your cost so far</span>
          <span className="mrw-dot" aria-hidden="true">
            •
          </span>
          <span className="mrw-yours-eq">{eq(t.yourCostMembershipCents, t.yourCostCourtCents, t.courtSessions)}</span>
          <b className="mrw-yours-total">{formatPrice(t.yourCostCents)}</b>
        </div>
      </section>
      <section className="card mrw-card" data-card="projected" aria-label={`Projected ${monthName(month).split(' ')[0]} total`}>
        <div className="mrw-card-head">
          <h3 className="mrw-card-title">Projected {monthName(month).split(' ')[0]} total</h3>
          {/* (Zip 13: Projected now counts every game still to come, so a busy month can reach four digits; those draw a little smaller.) */}
          <span className="mrw-big" data-projected-total data-long={p.totalCents >= 100000 ? '' : undefined}>
            {formatPrice(p.totalCents)}
          </span>
        </div>
        <dl className="mrw-cols">
          <Col label="Court costs" value={formatPrice(p.courtCostCents)} note={p.addedCourts > 0 ? `adds ${plural(p.addedCourts, 'court', 'courts')}` : 'no more courts'} data="court" />
          <Col label="Membership" value={formatPrice(p.membershipCents)} note="monthly" data="membership" />
          <Col label="Players pay" value={minus(p.playersPayCents)} note="from players" tone="green" data="players" />
        </dl>
        <div className="mrw-yours" data-yours="projected">
          <span className="mrw-yours-label">Your estimated cost</span>
          <span className="mrw-dot" aria-hidden="true">
            •
          </span>
          <span className="mrw-yours-eq">{eq(p.yourCostMembershipCents, p.yourCostCourtCents, p.courtCount)}</span>
          <b className="mrw-yours-total">{formatPrice(p.yourCostCents)}</b>
        </div>
      </section>
    </div>
  );
}

function Col({ label, value, note, tone, data }: { label: string; value: string; note: string; tone?: 'green'; data: string }) {
  return (
    <div className="mrw-col" data-col={data}>
      <dt>{label}</dt>
      <dd className={tone === 'green' ? 'green' : undefined}>{value}</dd>
      <small>{note}</small>
    </div>
  );
}
