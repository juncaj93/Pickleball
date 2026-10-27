import { type FormEvent, type ReactElement, useState } from 'react';
import type { AdminDashboard, AdminSessionView, RefundDue } from '../../shared/api';
import { promotionMessage } from '../../shared/messages';
import { formatPrice } from '../../shared/money';
import { formatDateTime, formatRelative, formatShortDate, formatTimeRange } from '../../shared/time';
import { api, ApiError, useLoad, useNow } from '../lib';
import { TopBar } from '../Shell';
import { Chip, Empty, ErrorState, FirstVisitNotice, GearIcon, HomeIcon, Notice, PeopleIcon, Sheet, SmsDraft, Spinner, useToast } from '../ui';
import { PlayerHome } from './PlayerHome';
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
  const [viewing, setViewing] = useState<{ id: string; name: string } | null>(null);
  const [pickViewAs, setPickViewAs] = useState(false);
  const ctx: AdminCtx = { d, reload, open: (kind, sessionId) => setSheet({ kind, sessionId }) };
  const todoCount = buildTodo(d).length;

  if (viewing) {
    return (
      <PlayerHome
        groupKey={null}
        viewAs={viewing}
        onExit={() => {
          setViewing(null);
          window.scrollTo(0, 0);
          void reload();
        }}
      />
    );
  }

  return (
    <>
      <TopBar eyebrow="Organizer" title={d.group.name} />
      <main className="page has-tabs stack-lg">
        {tab === 'home' && <HomeTab ctx={ctx} onViewAs={() => setPickViewAs(true)} />}
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
      <Sheet open={pickViewAs} title="View as…" onClose={() => setPickViewAs(false)}>
        <div className="stack">
          <p className="small muted">See exactly what they see. Anything you tap really happens for them, and the site logs that you did it.</p>
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
        </div>
      </Sheet>
    </>
  );
}

// ---------- Needs attention ----------

type TodoItem =
  | { kind: 'courts'; sessions: AdminSessionView[] }
  | { kind: 'five' | 'short' | 'tell' | 'refunds' | 'checkin'; session: AdminSessionView }
  | { kind: 'owed'; rows: OwedRow[] };

interface OwedRow {
  session: AdminSessionView;
  playerId: string;
  name: string;
  cents: number;
}

const upcoming = (s: AdminSessionView) => !s.state.flags.canceled && !s.state.flags.started;

/** The organizer's short list: what needs a tap right now, most urgent first. */
export function buildTodo(d: AdminDashboard): TodoItem[] {
  const items: TodoItem[] = [];
  const nowMs = Date.parse(d.now);
  const s = d.sessions;
  const courts = s.filter(
    (x) => x.state.flags.needsBooking || (upcoming(x) && x.state.flags.courtUnavailable && x.state.flags.bookingWindowOpen),
  );
  for (const x of s) if (x.state.flags.fiveGoing) items.push({ kind: 'five', session: x });
  for (const x of s) if (x.state.flags.shortOnPlayers) items.push({ kind: 'short', session: x });
  for (const x of s)
    if (upcoming(x) && x.roster.some((r) => r.status === 'confirmed' && r.promotedAt && !r.promotionNotifiedAt))
      items.push({ kind: 'tell', session: x });
  for (const x of s) if (x.state.flags.checkInsDue) items.push({ kind: 'checkin', session: x });
  if (courts.length) items.push({ kind: 'courts', sessions: courts });
  for (const x of s) if (x.refunds.some((r) => !r.refunded)) items.push({ kind: 'refunds', session: x });
  // Who owes you: from the day-before check-in on, and after play.
  const owed: OwedRow[] = [];
  for (const x of s) {
    if (x.state.flags.canceled || nowMs < Date.parse(x.startsAt) - d.group.settings.checkInHours * 3600_000) continue;
    for (const r of x.roster) {
      if (r.status === 'confirmed' && r.paymentStatus === 'unpaid' && r.shareCents !== null) {
        owed.push({ session: x, playerId: r.playerId, name: r.name, cents: r.shareCents });
      }
    }
  }
  if (owed.length) items.push({ kind: 'owed', rows: owed });
  return items;
}

function HomeTab({ ctx, onViewAs }: { ctx: AdminCtx; onViewAs: () => void }) {
  const items = buildTodo(ctx.d);
  return (
    <>
      <FirstVisitNotice>
        This site never sends texts or alerts by itself. It writes the texts and you send them from Messages. Alerts show up here
        when you open this page.
      </FirstVisitNotice>

      <section className="stack" aria-labelledby="todo-title">
        <div className="spread" style={{ alignItems: 'center' }}>
          <h2 id="todo-title" className="section-title">
            Needs attention
          </h2>
          <button className="btn small ghost" onClick={onViewAs}>
            View as…
          </button>
        </div>
        {items.length === 0 && <Empty>Nothing needs you right now.</Empty>}
        {items.map((item) => (
          <TodoCard key={item.kind + ('session' in item ? item.session.id : '')} ctx={ctx} item={item} />
        ))}
      </section>

      <SessionsSection ctx={ctx} />
    </>
  );
}

const COURTRESERVE_URL = 'https://app.courtreserve.com/Online/PublicBookings/13765/Landing';

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
      toast(err instanceof ApiError ? err.message : 'That did not work. Try again.');
    } finally {
      setBusy(false);
    }
  }

  if (item.kind === 'courts') {
    return (
      <article className="card stack" aria-label="Courts to book">
        <h3>Courts to book</h3>
        <a className="btn block" href={COURTRESERVE_URL} target="_blank" rel="noopener noreferrer">
          Book on CourtReserve
        </a>
        <p className="small muted">After you book, come back and tap Enter details.</p>
        <ul className="rows">
          {item.sessions.map((s) => (
            <li key={s.id}>
              <span className="who">
                <strong>{formatShortDate(s.startsAt, tz)}</strong>
                <span className="small muted">
                  {s.state.flags.courtUnavailable ? 'Marked not available' : formatTimeRange(s.startsAt, s.endsAt, tz)}
                </span>
              </span>
              <button className="btn small secondary" onClick={() => ctx.open('booking', s.id)}>
                Enter details
              </button>
            </li>
          ))}
        </ul>
      </article>
    );
  }

  if (item.kind === 'owed') {
    return (
      <article className="card stack" aria-label="Who owes you">
        <h3>Who owes you</h3>
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
                className="btn small"
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
    short: 'Short on players',
    tell: "Tell them they're in",
    refunds:
      s.confirmedCount === 6 && s.refunds.some((r) => r.reason === 'six')
        ? `6 going. Everyone paid ${formatPrice(settings.pricePerPlayerCents)}. Refund ${formatPrice(settings.refundCentsWhenSix)} each`
        : 'Refunds to send',
    checkin: 'Check-in texts due',
  }[item.kind];

  return (
    <article className="card stack" aria-label={`${title}: ${formatShortDate(s.startsAt, tz)}`}>
      <div className="spread">
        <div>
          <h3>{title}</h3>
          <div className="small muted">{when(s, tz)}</div>
        </div>
        {item.kind !== 'refunds' && <Chip tone={s.state.tone}>{s.state.text}</Chip>}
      </div>
      {item.kind === 'five' && <FivePanel ctx={ctx} s={s} />}
      {item.kind === 'short' && <ShortPanel ctx={ctx} s={s} />}
      {item.kind === 'tell' &&
        s.roster
          .filter((r) => r.status === 'confirmed' && r.promotedAt && !r.promotionNotifiedAt)
          .map((r) => (
            <div key={r.playerId} className="stack" style={{ gap: 8 }}>
              <SmsDraft to={r.name} phone={r.phone} body={promotionMessage(r.name, s, tz, r.promotionReason ?? 'spot_opened')} />
              <button
                className="btn small secondary"
                disabled={busy}
                onClick={() => act(() => api('POST', `/api/admin/sessions/${s.id}/told`, { playerId: r.playerId }), 'Done')}
              >
                I told {r.name}
              </button>
            </div>
          ))}
      {item.kind === 'refunds' && (
        <ul className="rows">
          {s.refunds.map((r) => (
            <RefundRow key={r.playerId} ctx={ctx} sessionId={s.id} r={r} />
          ))}
        </ul>
      )}
      {item.kind === 'refunds' && <p className="small muted">Tick each person after you send their refund.</p>}
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

/** One "Refunded" tick. It flips right away and saves in the background. */
function RefundRow({ ctx, sessionId, r }: { ctx: AdminCtx; sessionId: string; r: RefundDue }) {
  const toast = useToast();
  const [checked, setChecked] = useState(r.refunded);
  return (
    <li>
      <label className="check" style={{ flex: 1 }}>
        <input
          type="checkbox"
          checked={checked}
          onChange={async (e) => {
            const next = e.target.checked;
            setChecked(next);
            try {
              await api('POST', `/api/admin/sessions/${sessionId}/refund`, { playerId: r.playerId, refunded: next });
              toast(next ? `${r.name} refunded` : `${r.name} not refunded`);
              await ctx.reload();
            } catch (err) {
              setChecked(!next);
              toast(err instanceof ApiError ? err.message : "Couldn't save. Try again.");
            }
          }}
        />
        <span>
          {r.name}
          {r.reason === 'dropped' && <span className="small muted"> · paid, then dropped out</span>}
        </span>
      </label>
      <span className="amount">{formatPrice(r.amountCents)}</span>
    </li>
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
      toast(err instanceof ApiError ? err.message : 'That did not work.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="stack">
      <p className="small">Someone dropped out of 6. Nothing changes until you choose:</p>
      <div className="stack" style={{ gap: 8 }}>
        {firstWaiting && (
          <button className="btn small" disabled={busy} onClick={() => roster(firstWaiting.playerId, 'confirm', `${firstWaiting.name} is in. 6 going.`)}>
            Move {firstWaiting.name} in (makes 6)
          </button>
        )}
        <button className="btn small secondary" disabled={busy} onClick={() => ctx.open('invite', s.id)}>
          Invite someone to make 6
        </button>
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

function SessionsSection({ ctx }: { ctx: AdminCtx }) {
  const nowMs = useNow();
  const [view, setView] = useState<'upcoming' | 'past'>('upcoming');
  const [all, setAll] = useState(false);
  const list = ctx.d.sessions.filter((s) => (view === 'upcoming' ? Date.parse(s.endsAt) > nowMs : Date.parse(s.endsAt) <= nowMs));
  if (view === 'past') list.reverse();
  const shown = all ? list : list.slice(0, 4);
  return (
    <section className="stack" aria-labelledby="sessions-title">
      <h2 id="sessions-title" className="section-title">
        Sessions
      </h2>
      <div className="segmented" role="group" aria-label="Which sessions">
        <button aria-pressed={view === 'upcoming'} onClick={() => setView('upcoming')}>
          Upcoming
        </button>
        <button aria-pressed={view === 'past'} onClick={() => setView('past')}>
          Past
        </button>
      </div>
      {list.length === 0 && <Empty>No sessions here.</Empty>}
      {shown.map((s) => (
        <SessionCard key={s.id} ctx={ctx} s={s} />
      ))}
      {list.length > shown.length && (
        <button className="btn ghost block" onClick={() => setAll(true)}>
          Show all {list.length}
        </button>
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
