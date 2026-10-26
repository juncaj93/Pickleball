import { type FormEvent, useState } from 'react';
import type { AdminDashboard, AdminSessionView } from '../../shared/api';
import { formatCents } from '../../shared/money';
import { formatDateTime, formatRelative, formatShortDate, formatTimeRange } from '../../shared/time';
import { api, ApiError, useLoad, useNow } from '../lib';
import { TopBar } from '../Shell';
import { Chip, Empty, ErrorState, Notice, NotSentNote, Spinner } from '../ui';
import { type SheetKind, SessionCard, SessionSheets, DecisionPanel } from './admin/Sessions';
import { PaymentsTab } from './admin/PaymentsTab';
import { PlayersTab } from './admin/PlayersTab';
import { SettingsTab } from './admin/SettingsTab';

type Tab = 'todo' | 'sessions' | 'payments' | 'players' | 'settings';

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

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'todo', label: 'To do', icon: '●' },
  { id: 'sessions', label: 'Sessions', icon: '▦' },
  { id: 'payments', label: 'Payments', icon: '$' },
  { id: 'players', label: 'Players', icon: '☺' },
  { id: 'settings', label: 'Settings', icon: '⚙' },
];

function Dashboard({ d, reload }: { d: AdminDashboard; reload: () => Promise<void> }) {
  const [tab, setTab] = useState<Tab>('todo');
  const [sheet, setSheet] = useState<{ kind: SheetKind; sessionId: string } | null>(null);
  const ctx: AdminCtx = { d, reload, open: (kind, sessionId) => setSheet({ kind, sessionId }) };
  const todoCount = buildTodo(d).length;

  return (
    <>
      <TopBar eyebrow="Organizer" title={d.group.name} sub="Times shown in Eastern time" />
      <main className="page has-tabs stack-lg">
        {tab === 'todo' && <TodoTab ctx={ctx} />}
        {tab === 'sessions' && <SessionsTab ctx={ctx} />}
        {tab === 'payments' && <PaymentsTab ctx={ctx} />}
        {tab === 'players' && <PlayersTab ctx={ctx} />}
        {tab === 'settings' && <SettingsTab ctx={ctx} />}
      </main>
      <nav className="tabbar" aria-label="Organizer sections">
        <ul>
          {TABS.map((t) => (
            <li key={t.id}>
              <button aria-current={tab === t.id ? 'page' : undefined} onClick={() => { setTab(t.id); window.scrollTo(0, 0); }}>
                <span className="tab-icon" aria-hidden="true">
                  {t.icon}
                </span>
                {t.label}
                {t.id === 'todo' && todoCount > 0 && (
                  <span className="badge">
                    {todoCount}
                    <span className="sr-only"> items</span>
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

// ---------- To do ----------

type TodoKind = 'booking' | 'players' | 'deadline' | 'unpaid' | 'confirm';

interface TodoItem {
  kind: TodoKind;
  session: AdminSessionView;
}

const upcoming = (s: AdminSessionView) => !s.state.flags.canceled && !s.state.flags.started;

/** The organizer's short list, in the order the spec asks for. */
export function buildTodo(d: AdminDashboard): TodoItem[] {
  const items: TodoItem[] = [];
  const s = d.sessions;
  for (const x of s) if (x.state.flags.needsBooking || (upcoming(x) && x.state.flags.courtUnavailable && x.state.flags.bookingWindowOpen)) items.push({ kind: 'booking', session: x });
  for (const x of s)
    if (upcoming(x) && x.state.flags.underfilled && x.state.flags.bookingWindowOpen && !x.state.flags.inWarningWindow)
      items.push({ kind: 'players', session: x });
  for (const x of s)
    if ((x.state.flags.underfilled && x.state.flags.inWarningWindow) || x.state.flags.noDeadlineRecorded)
      items.push({ kind: 'deadline', session: x });
  const nowMs = Date.parse(d.now);
  for (const x of s)
    if (
      x.payableCount > 0 &&
      x.paidCount < x.payableCount &&
      nowMs >= Date.parse(x.startsAt) - d.group.settings.confirmationLeadHours * 3600_000
    )
      items.push({ kind: 'unpaid', session: x });
  for (const x of s) if (x.state.flags.confirmationsDue) items.push({ kind: 'confirm', session: x });
  return items;
}

const TODO_TITLE: Record<TodoKind, string> = {
  booking: 'Book a court',
  players: 'Needs players',
  deadline: 'Cancellation deadline',
  unpaid: 'Unpaid',
  confirm: 'Confirmation texts due',
};

function TodoTab({ ctx }: { ctx: AdminCtx }) {
  const items = buildTodo(ctx.d);
  const tz = ctx.d.group.timezone;
  const now = useNow();
  return (
    <>
      <NotSentNote />
      <p className="small muted">
        Alerts only appear when you open this page. Nothing pings your phone in the background.
      </p>
      {items.length === 0 && <Empty>Nothing needs you right now. Nice.</Empty>}
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
                {s.state.flags.courtUnavailable ? 'You marked the court as not available. Try another venue or cancel.' : 'Book it with the venue, then enter the details here.'}{' '}
                Starts {formatRelative(s.startsAt, now)}.
              </p>
              <div className="btn-row">
                <button className="btn small" onClick={() => ctx.open('booking', s.id)}>
                  Enter booking
                </button>
                <button className="btn small secondary" onClick={() => ctx.open('reminders', s.id)}>
                  Text the group
                </button>
              </div>
            </>
          )}
          {kind === 'players' && (
            <>
              <p className="small">
                {s.confirmedCount}/4 players · {s.waitlistCount} waitlisted · {s.eligibleSubstitutes.length} people you could invite
              </p>
              <button className="btn small" onClick={() => ctx.open('invite', s.id)}>
                Invite substitutes
              </button>
            </>
          )}
          {kind === 'deadline' &&
            (s.state.flags.noDeadlineRecorded && !s.state.flags.underfilled ? (
              <>
                <p className="small muted">The court is booked but there's no cancellation deadline saved.</p>
                <button className="btn small" onClick={() => ctx.open('booking', s.id)}>
                  Add deadline
                </button>
              </>
            ) : (
              <DecisionPanel ctx={ctx} s={s} />
            ))}
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
          {kind === 'confirm' && (
            <>
              <p className="small muted">
                {s.roster.filter((r) => r.status === 'confirmed' && !r.attendanceConfirmedAt).map((r) => r.name).join(', ')} haven't confirmed yet.
              </p>
              <button className="btn small" onClick={() => ctx.open('reminders', s.id)}>
                Prepare reminders
              </button>
            </>
          )}
        </article>
      ))}
    </>
  );
}

function SessionsTab({ ctx }: { ctx: AdminCtx }) {
  const nowMs = useNow();
  const [view, setView] = useState<'upcoming' | 'past'>('upcoming');
  const list = ctx.d.sessions.filter((s) => (view === 'upcoming' ? Date.parse(s.endsAt) > nowMs : Date.parse(s.endsAt) <= nowMs));
  if (view === 'past') list.reverse();
  return (
    <>
      <div className="segmented" role="group" aria-label="Which sessions">
        <button aria-pressed={view === 'upcoming'} onClick={() => setView('upcoming')}>
          Upcoming
        </button>
        <button aria-pressed={view === 'past'} onClick={() => setView('past')}>
          Past 90 days
        </button>
      </div>
      {list.length === 0 && <Empty>No sessions here.</Empty>}
      {list.map((s) => (
        <SessionCard key={s.id} ctx={ctx} s={s} />
      ))}
    </>
  );
}

export function deadlineLine(s: AdminSessionView, tz: string, nowMs: number): string {
  if (!s.cancellationDeadlineAt) return 'No deadline saved';
  const when = formatDateTime(s.cancellationDeadlineAt, tz);
  const passed = Date.parse(s.cancellationDeadlineAt) <= nowMs;
  return passed ? `${when} (passed)` : `${when} (${formatRelative(s.cancellationDeadlineAt, nowMs)})`;
}
