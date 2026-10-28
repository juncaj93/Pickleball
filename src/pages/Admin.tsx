import { Fragment, type FormEvent, type ReactElement, useLayoutEffect, useRef, useState } from 'react';
import type { AdminDashboard, AdminSessionView } from '../../shared/api';
import { nowSixMessage, promotedMessage, siteAddress } from '../../shared/messages';
import { DayBeforeTexts, SpotOpenTexts } from './admin/Texts';
import { formatPrice } from '../../shared/money';
import { formatDateTime, formatRelative, formatShortDate, formatTimeRange, fromLocalInputValue, localParts, weekLabel, weekStart } from '../../shared/time';
import { api, ApiError, useDemoVersion, useLoad, useNow, usePretend, useRefreshOnReturn } from '../lib';
import { DemoBar, PretendPicker } from './admin/Pretend';
import { TopBar } from '../Shell';
import { CourtReserveLink, DollarIcon, Empty, ErrorState, GearIcon, HistoryIcon, HomeIcon, Notice, PeopleIcon, Sheet, SmsDraft, Spinner, useToast } from '../ui';
import { PlayerHome } from './PlayerHome';
import { COURTRESERVE_BOOKING_URL } from '../../shared/settings';
import { RefundList, type SheetKind, SessionCard, SessionSheets } from './admin/Sessions';
import { buildTodo, homeBadgeCount, lateDrops, type TodoItem } from './admin/todo';
import { PlayersTab } from './admin/PlayersTab';
import { SettingsTab } from './admin/SettingsTab';
import { MoneyTab } from './admin/MoneyTab';
import { HistoryTab } from './admin/HistoryTab';

type Tab = 'home' | 'players' | 'money' | 'history' | 'settings';

export interface AdminCtx {
  d: AdminDashboard;
  reload: () => Promise<void>;
  open: (kind: SheetKind, sessionId: string) => void;
}

export function AdminApp() {
  const pretend = usePretend();
  const demo = useDemoVersion();
  const load = useLoad(() => api<AdminDashboard>('GET', '/api/admin/dashboard'), [pretend, demo]);
  useRefreshOnReturn(load.refresh);
  if (load.loading && !load.data && !load.error) {
    return (
      <>
        <TopBar eyebrow="Organizer" title="Dashboard" />
        <Spinner />
      </>
    );
  }
  if (load.error?.status === 401) return <Login onDone={load.reload} />;
  if (load.error && !load.data) {
    return (
      <>
        <TopBar eyebrow="Organizer" title="Dashboard" />
        <main className="page">
          <ErrorState error={load.error} onRetry={load.reload} />
        </main>
      </>
    );
  }
  return <Dashboard d={load.data!} reload={load.reload} />;
}

function Login({ onDone }: { onDone: () => Promise<void> }) {
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('POST', '/api/admin/login', { pin });
      await onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Sign-in failed.');
      setPin('');
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <TopBar eyebrow="Organizer" title="Sign in" />
      <main className="page">
        <form className="card stack" onSubmit={submit}>
          <label className="field">
            Organizer PIN
            <input
              type="password"
              inputMode="numeric"
              autoComplete="current-password"
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
              maxLength={12}
              autoFocus
              required
            />
          </label>
          {error && <Notice tone="danger">{error}</Notice>}
          <button className="btn" type="submit" disabled={busy || pin.length < 6}>
            {busy ? 'Checking…' : 'Sign in'}
          </button>
        </form>
      </main>
    </>
  );
}

const TABS: { id: Tab; label: string; Icon: () => ReactElement }[] = [
  { id: 'home', label: 'Home', Icon: HomeIcon },
  { id: 'players', label: 'Players', Icon: PeopleIcon },
  { id: 'money', label: 'Money', Icon: DollarIcon },
  { id: 'history', label: 'History', Icon: HistoryIcon },
  { id: 'settings', label: 'Settings', Icon: GearIcon },
];

function Dashboard({ d, reload }: { d: AdminDashboard; reload: () => Promise<void> }) {
  const [tab, setTab] = useState<Tab>('home');
  const [sheet, setSheet] = useState<{ kind: SheetKind; sessionId: string } | null>(null);
  const [viewing, setViewing] = useState<{ id: string; name: string } | null>(null);
  const [pickViewAs, setPickViewAs] = useState(false);
  const ctx: AdminCtx = { d, reload, open: (kind, sessionId) => setSheet({ kind, sessionId }) };
  const todoCount = homeBadgeCount(d);
  // Each tab keeps its own scroll spot. Tapping the tab you're on starts it
  // fresh instead: closed panels and sheets, back at the top. The data and
  // Settings (with anything typed there) are kept.
  const scrollOf = useRef<Partial<Record<Tab, number>>>({});
  const [fresh, setFresh] = useState(0);
  const restoreTo = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (restoreTo.current === null) return;
    window.scrollTo(0, restoreTo.current);
    restoreTo.current = null;
  }, [tab]);
  function pickTab(id: Tab) {
    if (id === tab) {
      setSheet(null);
      if (id !== 'settings') setFresh((n) => n + 1);
      const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      window.scrollTo({ top: 0, behavior: smooth ? 'smooth' : 'auto' });
      return;
    }
    scrollOf.current[tab] = window.scrollY;
    restoreTo.current = scrollOf.current[id] ?? 0;
    setTab(id);
  }

  if (viewing) {
    return (
      <>
        <PlayerHome
          topBar={<DemoBar tz={d.group.timezone} />}
          groupKey={null}
          viewAs={viewing}
          onViewAs={setViewing}
          onExit={() => {
            setViewing(null);
            window.scrollTo(0, 0);
            void reload();
          }}
        />
      </>
    );
  }

  return (
    <>
      <DemoBar tz={d.group.timezone} />
      <TopBar
        eyebrow="Organizer"
        title={d.group.name}
        action={
          <button className="topbar-btn" onClick={() => setPickViewAs(true)}>
            View as…
          </button>
        }
      />
      <main className="page has-tabs stack-lg">
        {tab === 'home' && <HomeTab key={fresh} ctx={ctx} />}
        {tab === 'players' && <PlayersTab key={fresh} ctx={ctx} />}
        {tab === 'money' && <MoneyTab key={fresh} ctx={ctx} />}
        {tab === 'history' && <HistoryTab key={fresh} ctx={ctx} />}
        {tab === 'settings' && <SettingsTab ctx={ctx} />}
      </main>
      <nav className="tabbar" aria-label="Organizer sections">
        <ul>
          {TABS.map(({ id, label, Icon }) => (
            <li key={id}>
              <button
                aria-current={tab === id ? 'page' : undefined}
                onClick={() => pickTab(id)}
              >
                <Icon />
                {label}
                {id === 'home' && todoCount > 0 && (
                  <span className="badge">
                    {todoCount}
                    <span className="sr-only"> need attention</span>
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      </nav>
      <SessionSheets ctx={ctx} sheet={sheet} onClose={() => setSheet(null)} />
      <Sheet open={pickViewAs} title="View as…" onClose={() => setPickViewAs(false)}>
        <div className="stack">
          <p className="small muted">Demo: taps work, nothing is saved.</p>
          <div className="name-grid">
            {d.players
              .filter((p) => p.isActive)
              .map((p) => (
                <button
                  key={p.id}
                  className="btn secondary"
                  onClick={() => {
                    setPickViewAs(false);
                    setViewing({ id: p.id, name: p.name });
                    window.scrollTo(0, 0);
                  }}
                >
                  {p.name}
                </button>
              ))}
          </div>
          <PretendPicker d={d} onPicked={() => setPickViewAs(false)} />
        </div>
      </Sheet>
    </>
  );
}

// ---------- Needs attention ----------

function HomeTab({ ctx }: { ctx: AdminCtx }) {
  const items = buildTodo(ctx.d);
  return (
    <>
      {items.length > 0 && (
        <section className="stack" aria-labelledby="todo-title">
          <h2 id="todo-title" className="section-title">
            Needs attention
          </h2>
          {items.map((item) => (
            <TodoCard key={item.kind + ('session' in item ? item.session.id : '')} ctx={ctx} item={item} />
          ))}
        </section>
      )}

      <SessionsSection ctx={ctx} />
      <HiddenSessions ctx={ctx} />
    </>
  );
}


function when(s: AdminSessionView, tz: string) {
  return `${formatShortDate(s.startsAt, tz)} · ${formatTimeRange(s.startsAt, s.endsAt, tz)}`;
}

function TodoCard({ ctx, item }: { ctx: AdminCtx; item: TodoItem }) {
  const tz = ctx.d.group.timezone;
  const settings = ctx.d.group.settings;
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  async function act(fn: () => Promise<unknown>, msg: string) {
    setBusy(true);
    try {
      await fn();
      await ctx.reload();
      toast(msg);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'That did not work. Try again.', 'error');
    } finally {
      setBusy(false);
    }
  }

  if (item.kind === 'owed' || item.kind === 'tonight') {
    const label = item.kind === 'tonight' ? 'Mark paid tonight' : 'Who owes you';
    return (
      <article className={`card stack${item.kind === 'tonight' ? ' tonight' : ''}`} aria-label={label}>
        <h3>{label}</h3>
        <ul className="rows">
          {item.rows.map((r) => (
            <li key={`${r.session.id}-${r.playerId}`}>
              <span className="who">
                <strong>{r.name}</strong>
                <span className="small muted">
                  {formatShortDate(r.session.startsAt, tz)} · {formatPrice(r.cents)}
                </span>
              </span>
              <button
                className="btn small secondary"
                disabled={busy}
                aria-label={`Mark ${r.name} paid for ${formatShortDate(r.session.startsAt, tz)}`}
                onClick={() =>
                  act(() => api('POST', `/api/admin/sessions/${r.session.id}/payment`, { playerId: r.playerId, paid: true }), `${r.name} marked paid`)
                }
              >
                Mark paid
              </button>
            </li>
          ))}
        </ul>
      </article>
    );
  }

  const s = item.session;
  const title = {
    five: '5 going, need 4 or 6',
    tell: "Tell them they're in",
    sixdrop: `Was 6, now ${s.confirmedCount}: discount and credits are off`,
    checkin: 'Check-in texts due',
    daybefore: `${formatShortDate(s.startsAt, tz)}: ${countSummary(s.confirmedCount)}`,
    lastcall: `Last call, ${formatShortDate(s.startsAt, tz)}: ${s.confirmedCount} in`,
    refund: s.state.flags.canceled ? `${formatShortDate(s.startsAt, tz)} was canceled. Refund needed:` : `${formatShortDate(s.startsAt, tz)}: a paid player left. Refund needed:`,
    latedrop: 'Late drop',
  }[item.kind];

  return (
    <article className="card stack" aria-label={`${title}: ${formatShortDate(s.startsAt, tz)}`}>
      <div>
        <h3>{title}</h3>
        <div className="small muted">{when(s, tz)}</div>
      </div>
      {item.kind === 'five' && <FivePanel ctx={ctx} s={s} />}
      {item.kind === 'refund' && <RefundList ctx={ctx} s={s} />}
      {item.kind === 'latedrop' && (
        <>
          <ul className="rows">
            {lateDrops(s).map((r) => (
              <li key={r.playerId}>
                <span className="who">
                  <span>
                    <span className="late-tag">Late drop</span> <strong>{r.name}</strong>
                  </span>
                  <span className="small muted">dropped {formatDateTime(r.lateDropAt!, tz)}</span>
                </span>
              </li>
            ))}
          </ul>
          <RefundList ctx={ctx} s={s} only={lateDrops(s).map((r) => r.playerId)} />
          <SpotOpenTexts ctx={ctx} s={s} />
          <button
            className="btn small ghost"
            disabled={busy}
            onClick={() =>
              act(async () => {
                for (const r of lateDrops(s)) await api('POST', `/api/admin/sessions/${s.id}/late-drop-done`, { playerId: r.playerId });
              }, 'Done')
            }
          >
            Done
          </button>
        </>
      )}
      {item.kind === 'tell' &&
        s.roster
          .filter((r) => r.status === 'confirmed' && r.promotedAt && !r.promotionNotifiedAt)
          .map((r, i) => (
            <div key={r.playerId} className="stack" style={{ gap: 8 }}>
              <SmsDraft
                quiet={i > 0}
                to={r.name}
                phone={r.phone}
                body={
                  r.promotionReason === 'made_six' && s.confirmedCount === 6
                    ? nowSixMessage(s, tz, siteAddress(ctx.d.group.playerLink))
                    : promotedMessage(s, tz, siteAddress(ctx.d.group.playerLink))
                }
              />
              <button
                className="btn small secondary"
                disabled={busy}
                onClick={() => act(() => api('POST', `/api/admin/sessions/${s.id}/told`, { playerId: r.playerId }), 'Done')}
              >
                I told {r.name}
              </button>
            </div>
          ))}
      {item.kind === 'sixdrop' && (
        <>
          <p className="small">
            Everyone is back to {formatPrice(settings.pricePerPlayerCents)}. Sort these out by hand:
          </p>
          <ul className="rows">
            {s.roster
              .filter((r) => !r.isOrganizer && (r.paymentStatus === 'paid' || r.promotedAt))
              .map((r) => (
                <li key={r.playerId}>
                  <span className="who">
                    <strong>{r.name}</strong>
                    <span className="small muted">
                      {r.status !== 'confirmed'
                        ? `dropped out${r.paymentStatus === 'paid' ? `, paid ${formatPrice(r.paymentAmountCents ?? 0)}` : ''}`
                        : r.paymentStatus === 'paid'
                          ? `paid ${formatPrice(r.paymentAmountCents ?? 0)}, now owes ${formatPrice(r.shareCents ?? 0)}`
                          : `now owes ${formatPrice((r.shareCents ?? 0) - r.creditCents)}`}
                    </span>
                  </span>
                </li>
              ))}
          </ul>
          <button
            className="btn small secondary"
            disabled={busy}
            onClick={() => act(() => api('POST', `/api/admin/sessions/${s.id}/six-sorted`, {}), 'Marked as sorted')}
          >
            Done, I sorted it out
          </button>
        </>
      )}
      {(item.kind === 'daybefore' || item.kind === 'lastcall') && (
        <>
          <DayBeforeTexts ctx={ctx} s={s} />
          <button
            className="btn small ghost"
            disabled={busy}
            onClick={() =>
              act(() => api('POST', `/api/admin/sessions/${s.id}/card-done`, { card: item.kind === 'daybefore' ? 'day_before' : 'last_call' }), 'Hidden')
            }
          >
            Done
          </button>
        </>
      )}
      {item.kind === 'checkin' && (
        <>
          <p className="small muted">
            Not checked in yet:{' '}
            {s.roster
              .filter((r) => r.status === 'confirmed' && !r.attendanceConfirmedAt)
              .map((r) => r.name)
              .join(', ')}
          </p>
          <button className="btn small" onClick={() => ctx.open('reminders', s.id)}>
            Prepare check-in texts
          </button>
        </>
      )}
    </article>
  );
}

/** Each person's open credit, with "Clear credit" for when the organizer paid them back by hand. */
export function CreditsCard({ ctx }: { ctx: AdminCtx }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  if (ctx.d.credits.length === 0) return null;
  return (
    <section className="card stack" aria-labelledby="credits-title">
      <h2 id="credits-title">Credits</h2>
      <ul className="rows">
        {ctx.d.credits.map((c) => (
          <li key={c.playerId}>
            <span className="who">
              <strong>{c.name}</strong>
              <span className="small muted">{formatPrice(c.balanceCents)} credit</span>
            </span>
            <button
              className="btn small secondary"
              disabled={busy}
              aria-label={`Clear ${c.name}'s credit`}
              onClick={async () => {
                setBusy(true);
                try {
                  await api('POST', `/api/admin/credits/${c.playerId}/clear`, {});
                  await ctx.reload();
                  toast(`${c.name}'s credit cleared`);
                } catch (err) {
                  toast(err instanceof ApiError ? err.message : "Couldn't clear it.", 'error');
                } finally {
                  setBusy(false);
                }
              }}
            >
              Clear credit
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** 5 confirmed: never changed automatically. The organizer picks how to get to 4 or 6. */
function FivePanel({ ctx, s }: { ctx: AdminCtx; s: AdminSessionView }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const firstWaiting = s.roster.find((r) => r.status === 'waitlisted' && r.waitlistPosition === 1);
  const confirmed = s.roster.filter((r) => r.status === 'confirmed');
  const lastIn = [...confirmed].sort((a, b) => Date.parse(b.confirmedAt ?? '') - Date.parse(a.confirmedAt ?? ''))[0];
  async function roster(playerId: string, action: 'confirm' | 'waitlist', msg: string) {
    setBusy(true);
    try {
      await api('POST', `/api/admin/sessions/${s.id}/roster`, { playerId, action });
      toast(msg);
      await ctx.reload();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'That did not work.', 'error');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="stack">
      <div className="stack" style={{ gap: 8 }}>
        {firstWaiting && (
          <button className="btn small" disabled={busy} onClick={() => roster(firstWaiting.playerId, 'confirm', `${firstWaiting.name} is in. 6 going.`)}>
            Move {firstWaiting.name} in (makes 6)
          </button>
        )}
        {lastIn && (
          <button className="btn small secondary" disabled={busy} onClick={() => roster(lastIn.playerId, 'waitlist', `${lastIn.name} moved to the waitlist. 4 going.`)}>
            Back to 4: move {lastIn.name} to the waitlist
          </button>
        )}
        <button className="btn small danger" disabled={busy} onClick={() => ctx.open('cancel', s.id)}>
          Cancel session
        </button>
      </div>
    </div>
  );
}

/** "4 in, need 2 more for 6", "3 in, need 1 more for 4", "6 in, all set" */
export function countSummary(n: number): string {
  if (n < 4) return `${n} in, need ${4 - n} more for 4`;
  if (n === 4) return '4 in, need 2 more for 6';
  if (n === 5) return '5 in, need one more or one fewer';
  return `${n} in, all set`;
}

/** Sessions before the first session date, with "Show this session". */
function HiddenSessions({ ctx }: { ctx: AdminCtx }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const tz = ctx.d.group.timezone;
  if (ctx.d.hiddenSessions.length === 0) return null;
  return (
    <section className="card stack" aria-labelledby="hidden-title">
      <h2 id="hidden-title" className="section-title" style={{ margin: 0 }}>
        Before your first session date
      </h2>
      <ul className="rows">
        {ctx.d.hiddenSessions.map((h) => (
          <li key={h.id}>
            <span className="who">
              <strong>{formatShortDate(h.startsAt, tz)}</strong>
              <span className="small muted">{formatTimeRange(h.startsAt, h.endsAt, tz)}</span>
            </span>
            <button
              className="btn small secondary"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await api('POST', `/api/admin/sessions/${h.id}/show`, { shown: true });
                  await ctx.reload();
                  toast(`${formatShortDate(h.startsAt, tz)} is showing`);
                } catch (err) {
                  toast(err instanceof ApiError ? err.message : "Couldn't show it.", 'error');
                } finally {
                  setBusy(false);
                }
              }}
            >
              Show this session
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function SessionsSection({ ctx }: { ctx: AdminCtx }) {
  const nowMs = useNow();
  const [all, setAll] = useState(false);
  const [adding, setAdding] = useState(false);
  const pills = (
    <>
      <button className="btn pill add-pill" onClick={() => setAdding(true)}>
        + Add game
      </button>
      <CourtReserveLink href={COURTRESERVE_BOOKING_URL} pill>
        Book a court
      </CourtReserveLink>
    </>
  );
  // Home is upcoming only; played sessions live under History.
  const list = ctx.d.sessions.filter((s) => Date.parse(s.endsAt) > nowMs);
  const shown = all ? list : list.slice(0, 6);
  const tz = ctx.d.group.timezone;

  return (
    <section className="stack" aria-labelledby="sessions-title">
      <h2 id="sessions-title" className="sr-only">
        Sessions
      </h2>
      {list.length === 0 && (
        <div className="week-break">
          <h3>Upcoming</h3>
          {pills}
        </div>
      )}
      {list.length === 0 && <Empty>No upcoming sessions.</Empty>}
      {shown.map((s, i) => (
        <Fragment key={s.id}>
          {(i === 0 || weekStart(s.startsAt, tz) !== weekStart(shown[i - 1].startsAt, tz)) && (
            <div className="week-break">
              <h3>{weekLabel(s.startsAt, nowMs, tz)}</h3>
              {/* "+ Add game" and "Book a court" ride on the first divider line, adding no height. */}
              {i === 0 && pills}
            </div>
          )}
          <SessionCard ctx={ctx} s={s} />
        </Fragment>
      ))}
      {list.length > shown.length && (
        <button className="btn ghost block" onClick={() => setAll(true)}>
          Show all {list.length}
        </button>
      )}
      <Sheet open={adding} title="Add a game" onClose={() => setAdding(false)}>
        {adding && <AddGameForm ctx={ctx} onDone={() => setAdding(false)} />}
      </Sheet>
    </section>
  );
}

export function deadlineLine(s: AdminSessionView, tz: string, nowMs: number): string {
  if (!s.cancellationDeadlineAt) return 'No deadline saved';
  const when = formatDateTime(s.cancellationDeadlineAt, tz);
  const passed = Date.parse(s.cancellationDeadlineAt) <= nowMs;
  return passed ? `${when} (passed)` : `${when} (${formatRelative(s.cancellationDeadlineAt, nowMs)})`;
}

const pad2 = (n: number) => String(n).padStart(2, '0');
const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** The next Sat, Sun and Wed (today counts), soonest first, as "YYYY-MM-DD" with a "Sat Nov 14" label. */
function quickDates(nowMs: number, tz: string): { iso: string; label: string }[] {
  const t = localParts(nowMs, tz);
  return [6, 0, 3].map((dow) => {
    const ahead = (dow - t.weekday + 7) % 7;
    const d = new Date(Date.UTC(t.year, t.month - 1, t.day + ahead, 12));
    const iso = `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
    const label = `${WEEKDAY_SHORT[dow]} ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}`;
    return { iso, label };
  }).sort((a, b) => a.iso.localeCompare(b.iso));
}

/** "+ Add game": a one-off game on any date. Same rules as every session after that. */
function AddGameForm({ ctx, onDone }: { ctx: AdminCtx; onDone: () => void }) {
  const tz = ctx.d.group.timezone;
  const toast = useToast();
  const chips = quickDates(Date.parse(ctx.d.now), tz);
  const [date, setDate] = useState(chips[0].iso);
  const [start, setStart] = useState('20:00');
  const [end, setEnd] = useState('22:00');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function add(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const startsAt = fromLocalInputValue(`${date}T${start}`, tz);
    const endsAt = fromLocalInputValue(`${date}T${end}`, tz);
    if (!startsAt || !endsAt) return setError('Pick a date, start time, and end time.');
    if (Date.parse(endsAt) <= Date.parse(startsAt)) return setError('The end time must be after the start time.');
    setBusy(true);
    try {
      await api('POST', '/api/admin/sessions', { startsAt, endsAt, note: note.trim() || null });
      await ctx.reload();
      toast('Game added');
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not add the game.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="stack add-game" onSubmit={add}>
      <div className="field">
        <span id="add-date-label">Date</span>
        <div className="chips" role="group" aria-labelledby="add-date-label">
          {chips.map((c) => (
            <button type="button" key={c.iso} className="chip-btn" aria-pressed={date === c.iso} onClick={() => setDate(c.iso)}>
              {c.label}
            </button>
          ))}
        </div>
        <input type="date" aria-label="Pick a date" value={date} onChange={(e) => setDate(e.target.value)} required />
      </div>
      <div className="time-pair">
        <label className="field">
          Start
          <input type="time" value={start} onChange={(e) => setStart(e.target.value)} required />
        </label>
        <label className="field">
          End
          <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} required />
        </label>
      </div>
      <label className="field">
        Note (optional)
        <input type="text" value={note} onChange={(e) => setNote(e.target.value)} maxLength={80} placeholder="Court 3, bring water" />
      </label>
      {error && <Notice tone="danger">{error}</Notice>}
      <button className="btn block big" type="submit" disabled={busy}>
        {busy ? 'Adding…' : 'Add game'}
      </button>
    </form>
  );
}
