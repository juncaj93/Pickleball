import { Fragment, type FormEvent, type ReactElement, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { AdminDashboard, AdminSessionView } from '../../shared/api';
import { SuggestionCards } from './admin/SuggestionCards';
import { formatPrice } from '../../shared/money';
import { formatDateTime, formatShortDate, formatTimeRange, fromLocalInputValue, localParts, weekLabel, weekStart } from '../../shared/time';
import { api, ApiError, useDemoVersion, useLoad, useNow, usePretend, useRefreshOnReturn } from '../lib';
import { useLiveUpdates } from '../live';
import { DemoBar, PretendPicker } from './admin/Pretend';
import { TopBar } from '../Shell';
import { CourtReserveLink, DollarIcon, Empty, ErrorState, GearIcon, HistoryIcon, HomeIcon, Notice, PeopleIcon, Sheet, Spinner, useToast } from '../ui';
import { PlayerHome } from './PlayerHome';
import { COURTRESERVE_BOOKING_URL, minutesToHHMM } from '../../shared/settings';
import { type SheetKind, SessionCard, SessionSheets } from './admin/Sessions';
import { buildTodo, homeBadgeCount, lateDrops, type TodoItem } from './admin/todo';
import { FinalizeCard, RefundRequestCard } from './admin/HomeCards';
import { DoNowCard } from './admin/DoNow';
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
  return <Dashboard d={load.data!} reload={load.reload} quiet={load.quiet} live={!pretend} />;
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

function Dashboard({ d, reload, quiet, live }: { d: AdminDashboard; reload: () => Promise<void>; quiet: () => Promise<boolean>; live: boolean }) {
  const [tab, setTab] = useState<Tab>('home');
  const [sheet, setSheet] = useState<{ kind: SheetKind; sessionId: string } | null>(null);
  const [viewing, setViewing] = useState<{ id: string; name: string } | null>(null);
  const [pickViewAs, setPickViewAs] = useState(false);
  const ctx: AdminCtx = { d, reload, open: (kind, sessionId) => setSheet({ kind, sessionId }) };
  const todoCount = homeBadgeCount(d);
  // The organizer screens keep themselves fresh like the player side: one tiny "did anything change?" check every
  // few seconds, the full load only when it did, and never while a sheet or pop-up is open or something is being typed.
  // Settings is left out (it holds fields being edited); coming back to the tab refreshes it the usual way.
  const [checkedAt, setCheckedAt] = useState(() => Date.now());
  const onChecked = useCallback(() => setCheckedAt(Date.now()), []);
  useLiveUpdates({ enabled: live && !viewing && tab !== 'settings', version: d.version, reload: quiet, path: '/api/admin/version', onChecked });
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
      {tab !== 'settings' && <UpdatedLine at={checkedAt} />}
      <main className={`page has-tabs stack-lg${tab === 'settings' ? '' : ' admin-page'}`}>
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

/** "Updated just now": a tiny quiet note near the top. Hidden by the page's CSS while a sheet is open. */
function UpdatedLine({ at }: { at: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(t);
  }, []);
  const mins = Math.floor((now - at) / 60_000);
  return (
    <p className="updated-line" data-updated>
      {mins < 1 ? 'Updated just now' : `Updated ${mins} min ago`}
    </p>
  );
}

// ---------- Needs attention ----------

function HomeTab({ ctx }: { ctx: AdminCtx }) {
  const items = buildTodo(ctx.d);
  // Order: refund requests, then "Do this now", then games to finalize, then the text cards, then the rest.
  const refunds: TodoItem[] = items.filter((i) => i.kind === 'refund_request');
  const first: TodoItem[] = items.filter((i) => i.kind === 'finalize');
  const rest = items.filter((i) => !first.includes(i) && !refunds.includes(i));
  const key = (item: TodoItem) => item.kind + ('session' in item ? item.session.id : 'request' in item ? item.request.id : '');
  return (
    <>
      {refunds.length > 0 && (
        <section className="stack" aria-label="Refund requests">
          {refunds.map((item) => (
            <TodoCard key={key(item)} ctx={ctx} item={item} />
          ))}
        </section>
      )}
      <DoNowCard ctx={ctx} />
      {first.length > 0 && (
        <section className="stack" aria-label="After the game">
          {first.map((item) => (
            <TodoCard key={key(item)} ctx={ctx} item={item} />
          ))}
        </section>
      )}
      <SuggestionCards ctx={ctx} />
      {rest.length > 0 && (
        <section className="stack" aria-labelledby="todo-title">
          <h2 id="todo-title" className="section-title">
            Needs attention
          </h2>
          {rest.map((item) => (
            <TodoCard key={key(item)} ctx={ctx} item={item} />
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

  if (item.kind === 'refund_request') return <RefundRequestCard ctx={ctx} r={item.request} />;
  if (item.kind === 'finalize') return <FinalizeCard ctx={ctx} s={item.session} />;

  const s = item.session;
  const title = 'Late drop';
  return (
    <article className="card stack" aria-label={`${title}: ${formatShortDate(s.startsAt, tz)}`}>
      <div>
        <h3>{title}</h3>
        <div className="small muted">{when(s, tz)}</div>
      </div>
      <ul className="rows">
        {lateDrops(s).map((r) => (
          <li key={r.playerId}>
            <span className="who">
              <span>
                <span className="late-tag">Late drop</span> <strong>{r.name}</strong>
              </span>
              <span className="small muted">
                dropped {formatDateTime(r.lateDropAt!, tz)}
                {r.creditBackCents > 0 ? ` · ${formatPrice(r.creditBackCents)} is their credit now` : ''}
              </span>
            </span>
          </li>
        ))}
      </ul>
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
    </article>
  );
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
  // The usual game time from Settings > Schedule; editable here for this one game.
  const [start, setStart] = useState(() => minutesToHHMM(ctx.d.group.settings.defaultStartMinutes));
  const [end, setEnd] = useState(() => minutesToHHMM(ctx.d.group.settings.defaultEndMinutes));
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
