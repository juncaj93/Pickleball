import { type FormEvent, type ReactElement, useState } from 'react';
import type { AdminDashboard, AdminSessionView } from '../../shared/api';
import { formatCents } from '../../shared/money';
import { formatDateTime, formatRelative, formatShortDate, formatTimeRange } from '../../shared/time';
import { api, ApiError, useLoad, useNow } from '../lib';
import { TopBar } from '../Shell';
import { Chip, Empty, ErrorState, FirstVisitNotice, GearIcon, HomeIcon, Notice, PeopleIcon, Spinner } from '../ui';
import { type SheetKind, SessionCard, SessionSheets, ShortPanel } from './admin/Sessions';
import { PlayersTab } from './admin/PlayersTab';
import { SettingsTab } from './admin/SettingsTab';

type Tab = 'home' | 'players' | 'settings';

export interface AdminCtx {
  d: AdminDashboard;
  reload: () => Promise<void>;
  open: (kind: SheetKind, sessionId: string) => void;
}

export function AdminApp() {
  const load = useLoad(() => api<AdminDashboard>('GET', '/api/admin/dashboard'));
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
  { id: 'settings', label: 'Settings', Icon: GearIcon },
];

function Dashboard({ d, reload }: { d: AdminDashboard; reload: () => Promise<void> }) {
  const [tab, setTab] = useState<Tab>('home');
  const [sheet, setSheet] = useState<{ kind: SheetKind; sessionId: string } | null>(null);
  const ctx: AdminCtx = { d, reload, open: (kind, sessionId) => setSheet({ kind, sessionId }) };
  const todoCount = buildTodo(d).length;

  return (
    <>
      <TopBar eyebrow="Organizer" title={d.group.name} />
      <main className="page has-tabs stack-lg">
        {tab === 'home' && <HomeTab ctx={ctx} />}
        {tab === 'players' && <PlayersTab ctx={ctx} />}
        {tab === 'settings' && <SettingsTab ctx={ctx} />}
      </main>
      <nav className="tabbar" aria-label="Organizer sections">
        <ul>
          {TABS.map(({ id, label, Icon }) => (
            <li key={id}>
              <button
                aria-current={tab === id ? 'page' : undefined}
                onClick={() => {
                  setTab(id);
                  window.scrollTo(0, 0);
                }}
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
    </>
  );
}

// ---------- Needs attention ----------

type TodoKind = 'booking' | 'short' | 'checkin' | 'unpaid';

interface TodoItem {
  kind: TodoKind;
  session: AdminSessionView;
}

const upcoming = (s: AdminSessionView) => !s.state.flags.canceled && !s.state.flags.started;

/** The organizer's short list: what needs a tap right now. */
export function buildTodo(d: AdminDashboard): TodoItem[] {
  const items: TodoItem[] = [];
  const s = d.sessions;
  const nowMs = Date.parse(d.now);
  for (const x of s)
    if (x.state.flags.needsBooking || (upcoming(x) && x.state.flags.courtUnavailable && x.state.flags.bookingWindowOpen))
      items.push({ kind: 'booking', session: x });
  for (const x of s) if (x.state.flags.shortOnPlayers) items.push({ kind: 'short', session: x });
  for (const x of s) if (x.state.flags.checkInsDue) items.push({ kind: 'checkin', session: x });
  for (const x of s)
    if (
      x.payableCount > 0 &&
      x.paidCount < x.payableCount &&
      nowMs >= Date.parse(x.startsAt) - d.group.settings.checkInHours * 3600_000
    )
      items.push({ kind: 'unpaid', session: x });
  return items;
}

const TODO_TITLE: Record<TodoKind, string> = {
  booking: 'Book a court',
  short: 'Short on players',
  checkin: 'Check-in texts due',
  unpaid: 'Unpaid',
};

function HomeTab({ ctx }: { ctx: AdminCtx }) {
  const items = buildTodo(ctx.d);
  const tz = ctx.d.group.timezone;
  const now = useNow();
  return (
    <>
      <FirstVisitNotice>
        This site never sends texts or alerts by itself. It writes the texts and you send them from Messages. Alerts show up here
        when you open this page.
      </FirstVisitNotice>

      <section className="stack" aria-labelledby="todo-title">
        <h2 id="todo-title" className="section-title">
          Needs attention
        </h2>
        {items.length === 0 && <Empty>Nothing needs you right now.</Empty>}
        {items.map(({ kind, session: s }) => (
          <article key={`${kind}-${s.id}`} className="card stack" aria-label={`${TODO_TITLE[kind]}: ${formatShortDate(s.startsAt, tz)}`}>
            <div className="spread">
              <div>
                <div className="section-title" style={{ margin: 0 }}>
                  {TODO_TITLE[kind]}
                </div>
                <h3>
                  {formatShortDate(s.startsAt, tz)} · {formatTimeRange(s.startsAt, s.endsAt, tz)}
                </h3>
              </div>
              <Chip tone={s.state.tone}>{s.state.text}</Chip>
            </div>
            {kind === 'booking' && (
              <>
                <p className="muted small">
                  {s.state.flags.courtUnavailable ? 'You marked the court as not available.' : 'Book it, then enter the details here.'} Starts{' '}
                  {formatRelative(s.startsAt, now)}.
                </p>
                <button className="btn small" onClick={() => ctx.open('booking', s.id)}>
                  Enter booking
                </button>
              </>
            )}
            {kind === 'short' && <ShortPanel ctx={ctx} s={s} />}
            {kind === 'checkin' && (
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
            {kind === 'unpaid' && (
              <>
                <ul className="list small">
                  {s.roster
                    .filter((r) => r.status === 'confirmed' && r.paymentStatus === 'unpaid')
                    .map((r) => (
                      <li key={r.playerId} className="spread" style={{ padding: '6px 0' }}>
                        <span>{r.name}</span>
                        <span className="amount">{r.shareCents !== null ? formatCents(r.shareCents) : '—'}</span>
                      </li>
                    ))}
                </ul>
                <button className="btn small" onClick={() => ctx.open('payments', s.id)}>
                  Payments
                </button>
              </>
            )}
          </article>
        ))}
      </section>

      <SessionsSection ctx={ctx} />
      <PaymentsSection ctx={ctx} />
    </>
  );
}

function SessionsSection({ ctx }: { ctx: AdminCtx }) {
  const nowMs = useNow();
  const [view, setView] = useState<'upcoming' | 'past'>('upcoming');
  const list = ctx.d.sessions.filter((s) => (view === 'upcoming' ? Date.parse(s.endsAt) > nowMs : Date.parse(s.endsAt) <= nowMs));
  if (view === 'past') list.reverse();
  return (
    <section className="stack" aria-labelledby="sessions-title">
      <div className="spread" style={{ alignItems: 'center' }}>
        <h2 id="sessions-title" className="section-title">
          Sessions
        </h2>
      </div>
      <div className="segmented" role="group" aria-label="Which sessions">
        <button aria-pressed={view === 'upcoming'} onClick={() => setView('upcoming')}>
          Upcoming
        </button>
        <button aria-pressed={view === 'past'} onClick={() => setView('past')}>
          Past
        </button>
      </div>
      {list.length === 0 && <Empty>No sessions here.</Empty>}
      {list.map((s) => (
        <SessionCard key={s.id} ctx={ctx} s={s} />
      ))}
    </section>
  );
}

function PaymentsSection({ ctx }: { ctx: AdminCtx }) {
  const owedByPlayer = new Map<string, { name: string; cents: number; count: number }>();
  for (const s of ctx.d.sessions) {
    if (s.state.flags.canceled || s.courtCostCents === null) continue;
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
  return (
    <section className="card stack" aria-labelledby="unpaid-title">
      <div className="spread">
        <h2 id="unpaid-title">Who owes you</h2>
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
    </section>
  );
}

export function deadlineLine(s: AdminSessionView, tz: string, nowMs: number): string {
  if (!s.cancellationDeadlineAt) return 'No deadline saved';
  const when = formatDateTime(s.cancellationDeadlineAt, tz);
  const passed = Date.parse(s.cancellationDeadlineAt) <= nowMs;
  return passed ? `${when} (passed)` : `${when} (${formatRelative(s.cancellationDeadlineAt, nowMs)})`;
}
