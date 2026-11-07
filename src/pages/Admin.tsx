import { InstantContext, useInstant, useInstantRoot, useInstantTracker } from '../InstantTaps';
import { type ActOptions, opTap, useAction } from './admin/action';
import { type CSSProperties, Fragment, type FormEvent, type ReactElement, type ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { AdminDashboard, AdminSessionView } from '../../shared/api';
import { SuggestionCards } from './admin/SuggestionCards';
import { courtCards } from './admin/doNow';
import { formatPrice } from '../../shared/money';
import { formatDateTime, formatShortDate, formatTimeRange, fromLocalInputValue, localParts, weekLabel, weekStart } from '../../shared/time';
import { api, ApiError, demoOn, navigate, useDemoVersion, useLoad, useNow, usePretend, useRefreshOnReturn } from '../lib';
import { fadeChanges, LAST_ADMIN_HOLD_MS, markMoney, readLastAdmin, saveLastAdmin, signedInLastAdmin, signedOutLastAdmin } from '../lastAdmin';
import { asOfText } from '../lastScreen';
import { afterHolds } from '../undoHold';
import '../admin-held.css';
import { useLiveUpdates } from '../live';
import { DemoBar, PretendPicker } from './admin/Pretend';
import { ModeButton, TopBar } from '../Shell';
import { CourtReserveLink, DollarIcon, Empty, ErrorState, GearIcon, HistoryIcon, HomeIcon, Notice, PeopleIcon, ScheduleSkeleton, Sheet, Spinner, useToast } from '../ui';
import { useZip7Root } from '../zip7';
import { AcIcon, AcTitle } from '../AlertCard';
import { rememberedAdminMotion, useAdminMotion, useDetailsEase, useMotion, useSwitchStretch } from '../motion';
import { PlayerHome } from './PlayerHome';
import { COURTRESERVE_BOOKING_URL, minutesToHHMM } from '../../shared/settings';
import { type SheetKind, SessionCard, SessionSheets } from './admin/Sessions';
import { buildTodo, homeBadgeCount, lateDrops, type TodoItem } from './admin/todo';
import { FinalizeCard, PaymentClaimCard, RefundRequestCard } from './admin/HomeCards';
import { DoNowCard, useServerNow } from './admin/DoNow';
import { OwedVenmoCards } from './admin/VenmoRequest';
import { PlayersTab } from './admin/PlayersTab';
import { SettingsTab } from './admin/SettingsTab';
import { MoneyTab } from './admin/MoneyTab';
import { HomeGame, useOpenGames } from './admin/HomeV2';
import { HistoryTab } from './admin/HistoryTab';
import { ClearChoices, FindSubLink } from './admin/LateFees';
import { boxMinutes, ShortGameHeadsUp } from './admin/ShortGame';

type Tab = 'home' | 'players' | 'money' | 'history' | 'settings';

export interface AdminCtx {
  d: AdminDashboard;
  reload: () => Promise<void>;
  open: (kind: SheetKind, sessionId: string) => void;
}

export function AdminApp() {
  const pretend = usePretend();
  const demo = useDemoVersion();
  // Instant taps (INSTANT_TAPS): a poll that set off before a save never draws over it, and taps still saving are drawn in. Off: as before.
  const tracker = useInstantTracker();
  const load = useLoad(() => api<AdminDashboard>('GET', '/api/admin/dashboard'), [pretend, demo], tracker);
  const instant = useInstantRoot(load.data?.instantTaps === true, load.data, load.reload, tracker);
  useRefreshOnReturn(load.refresh);
  // Zip 12 step C, "Instant admin" (src/lastAdmin.ts): this phone's copy of its last dashboard, drawn at once with every action held and money
  // dimmed until the first fresh answer. Read once per page open; never in Pretend or the demo.
  const [saved] = useState(() => (!pretend && !demoOn() ? readLastAdmin() : null));
  const [savedShown, setSavedShown] = useState(false);
  // A copy waits at most LAST_ADMIN_HOLD_MS for the fresh answer (a stalled link, a session revoked elsewhere); then the usual loading shows.
  const [holdOver, setHoldOver] = useState(false);
  useEffect(() => {
    if (!saved) return undefined;
    const t = setTimeout(() => setHoldOver(true), LAST_ADMIN_HOLD_MS);
    return () => clearTimeout(t);
  }, [saved]);
  const holding = !load.data && !load.error && !!saved && !holdOver;
  useEffect(() => {
    if (holding) setSavedShown(true);
  }, [holding]);
  useEffect(() => {
    if (load.data) saveLastAdmin(load.data, { pretend: !!pretend, demo: demoOn() });
  }, [load.data, pretend]);
  useEffect(() => {
    if (load.error?.status === 401) signedOutLastAdmin();
  }, [load.error]);
  const shownView = instant.view ?? load.data ?? null;
  if (holding || (savedShown && shownView)) {
    // One wrapper for the whole page life once the copy was shown, so the fresh answer updates the same screen in place (nothing remounts).
    return (
      <HeldAdmin held={holding} savedAt={saved!.savedAt} tz={(shownView ?? saved!.view).group.timezone}>
        <InstantContext.Provider value={instant.store}>
          <Dashboard d={shownView ?? saved!.view} reload={load.reload} quiet={load.quiet} live={!pretend && !holding} />
        </InstantContext.Provider>
      </HeldAdmin>
    );
  }
  if (load.loading && !load.data && !load.error) {
    return (
      <>
        <TopBar eyebrow="Organizer" title="Dashboard" />
        {/* The soft placeholder cards (the same shimmer the player page uses) only when this phone already knows the organizer motion is on; otherwise the plain spinner, as before. */}
        {rememberedAdminMotion() ? <AdminLoading /> : <Spinner />}
      </>
    );
  }
  if (load.error?.status === 401)
    return (
      <Login
        onDone={async () => {
          signedInLastAdmin();
          await load.reload();
        }}
      />
    );
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
  return (
    <InstantContext.Provider value={instant.store}>
      <Dashboard d={instant.view!} reload={load.reload} quiet={load.quiet} live={!pretend} />
    </InstantContext.Provider>
  );
}

/**
 * Zip 12 step C, the organizer's saved copy while it is held: an inert wrapper (nothing can be tapped, typed or focused), money dimmed (each
 * element showing a $ amount is marked once drawn), and a small "as of 2:14 PM" under the header. When the fresh answer lands the wrapper stays
 * (so the same screen updates in place) but lets go: money brightens softly, and only the parts whose words changed fade in.
 */
function HeldAdmin({ held, savedAt, tz, children }: { held: boolean; savedAt: number; tz: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  // The pill floats just above the tab bar (it covers no card words there), out of the page's flow.
  const [bottom, setBottom] = useState<number | null>(null);
  useLayoutEffect(() => {
    const root = ref.current;
    if (!held || !root) return;
    markMoney(root);
    const bar = root.querySelector('.tabbar');
    setBottom(bar ? Math.round(window.innerHeight - bar.getBoundingClientRect().top) + 8 : 96);
  }, [held]);
  // Watching starts while the copy is held (the fresh answer is drawn in the same step that lets go), and stops 1.5 s after it lands.
  const stopWatching = useRef<(() => void) | null>(null);
  useLayoutEffect(() => {
    const root = ref.current;
    if (held && root && !stopWatching.current) stopWatching.current = fadeChanges(root, 60_000);
    if (!held && stopWatching.current) {
      const stop = stopWatching.current;
      const t = setTimeout(() => {
        stop();
        stopWatching.current = null;
      }, 1500);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [held]);
  useEffect(
    () => () => {
      stopWatching.current?.();
      stopWatching.current = null;
    },
    [],
  );
  return (
    <div ref={ref} className="admin-held" data-held-admin={held ? '' : undefined} inert={held} aria-busy={held || undefined}>
      {held && (
        <>
          <p className="sr-only" role="status">
            Your last organizer screen, {asOfText(savedAt, tz)}. Updating.
          </p>
          <span className="admin-asof" data-admin-asof aria-hidden="true" style={bottom !== null ? { bottom } : undefined}>
            {asOfText(savedAt, tz)}
          </span>
        </>
      )}
      {children}
    </div>
  );
}

/**
 * The first load, with the organizer motion on: soft placeholder cards (the same shimmer the player page uses), not drawn
 * at all if the data is here within 250 ms. The real cards then appear in place: nothing rises or slides in.
 */
function AdminLoading() {
  const [late, setLate] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setLate(true), 250);
    return () => clearTimeout(t);
  }, []);
  return (
    <main className="page stack-lg admin-page admin-loading" role="status">
      <span className="sr-only">Loading…</span>
      {late && <ScheduleSkeleton />}
    </main>
  );
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
  // Motion (the MOTION_ADMIN switch). Visual only; with it off none of this does anything. The player demo (View as)
  // looks after its own motion, so the organizer's steps back while it is showing.
  useAdminMotion(d.motion === true, !viewing);
  useZip7Root(d, !viewing);
  const motion = useMotion();
  useSwitchStretch(motion);
  useDetailsEase(motion);
  const ctx: AdminCtx = { d, reload, open: (kind, sessionId) => setSheet({ kind, sessionId }) };
  // "Admin screens, round 2" (ADMIN_R2): Light/Dark button left of View as, "Admin" under ORGANIZER, no "Updated just now".
  const r2 = d.adminR2 === true;
  // Swap to Alex (SWAP_BUTTON, Zip 13). Off: the header and the View as page exactly as before.
  const swap = d.swapButton === true;
  // View as answers from the demo copy, which has no switch rows: the pill follows what the organizer screen said when View as began.
  const swapAtView = useRef(swap);
  if (!viewing) swapAtView.current = swap;
  // Your own player page, the way a player opens it (the group's link): who it shows is this phone's own pick, as always. Nothing signs in or out.
  const goToMyPage = () => {
    // A save still held for its Undo goes first, as the organizer (its toast does not follow you to the player page).
    afterHolds(() => {
      window.scrollTo(0, 0);
      navigate(new URL(d.group.privateLink).pathname);
    });
  };
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
          // Swap to Alex: "Go to Admin" at the bottom of the View as page too (the same as the bar's Exit).
          onGoAdmin={
            swapAtView.current
              ? () => {
                  setViewing(null);
                  window.scrollTo(0, 0);
                  void reload();
                }
              : undefined
          }
        />
      </>
    );
  }

  return (
    <>
      <DemoBar tz={d.group.timezone} />
      <TopBar
        // Swap to Alex (SWAP_BUTTON, Zip 13): no ORGANIZER label; "Admin" and a small swap icon are one button to your own player page.
        eyebrow={swap ? '' : 'Organizer'}
        title={r2 || swap ? 'Admin' : d.group.name}
        onTitle={swap ? { onClick: goToMyPage, label: 'Admin. Switch to your player page' } : undefined}
        // Signed in with the read-only PIN (server/viewOnly.ts): a small label, and every save is refused by the server.
        titleExtra={d.viewOnly ? <span className="view-only-pill" data-view-only>View only</span> : undefined}
        action={
          r2 ? (
            // Round 2: View as… first, then the Light/Dark button, so the button sits right next to the calendar tile.
            <span className="r2-hdr-actions">
              <button className="topbar-btn" onClick={() => setPickViewAs(true)}>
                {swap ? 'View as' : 'View as…'}
              </button>
              <ModeButton />
            </span>
          ) : (
            <button className="topbar-btn" onClick={() => setPickViewAs(true)}>
              {swap ? 'View as' : 'View as…'}
            </button>
          )
        }
      />
      {tab !== 'settings' && !r2 && <UpdatedLine at={checkedAt} />}
      <main className={`page has-tabs stack-lg${tab === 'settings' ? '' : ' admin-page'}`}>
        {tab === 'home' && <HomeTab key={fresh} ctx={ctx} />}
        {tab === 'players' && <PlayersTab key={fresh} ctx={ctx} />}
        {tab === 'money' && <MoneyTab key={fresh} ctx={ctx} />}
        {/* The new History keeps its NEW group when you tap the History tab again (that is not leaving the tab). */}
        {tab === 'history' && <HistoryTab key={d.adminV2 === true ? 'v2' : fresh} ctx={ctx} />}
        {tab === 'settings' && <SettingsTab ctx={ctx} />}
      </main>
      <nav className="tabbar" aria-label="Organizer sections">
        <ul>
          {/* The highlight glides to the tapped tab (motion only; it sits over the cells, not in them). */}
          {motion && <li className="tab-glide" aria-hidden="true" style={{ '--i': TABS.findIndex((t) => t.id === tab) } as CSSProperties} />}
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
              .filter((p) => p.isActive && !p.adminHidden)
              .map((p) => (
                <button
                  key={p.id}
                  className="btn secondary"
                  onClick={() => {
                    setPickViewAs(false);
                    const go = () => {
                      setViewing({ id: p.id, name: p.name });
                      window.scrollTo(0, 0);
                    };
                    // Undo on admin toasts: every save still held for its Undo is sent (as the organizer) and answered first, then View
                    // as opens. Nothing held: at once, as before.
                    afterHolds(go);
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
  const nowMs = useServerNow(ctx.d.now);
  const items = buildTodo(ctx.d);
  // Order: refund requests, then "Do this now", then games to finalize, then the text cards, then the rest.
  // Money that waits on the organizer's answer: cash-out requests and unconfirmed I paid on seats that left.
  const refunds: TodoItem[] = items.filter((i) => i.kind === 'refund_request' || i.kind === 'payment_claim');
  // A game still asked "Did you guys play?" has only that card; its Finalize card comes after "Yes, we played".
  // The same moving clock as the Do this now card, so the two always agree (also past midnight with no reload).
  const asking = new Set(courtCards(ctx.d, nowMs, `${window.location.origin}/admin`).filter((c) => c.kind === 'played').map((c) => c.session.id));
  const first: TodoItem[] = items.filter((i) => i.kind === 'finalize' && !asking.has(i.session.id));
  const rest = items.filter((i) => i.kind !== 'finalize' && !refunds.includes(i));
  const key = (item: TodoItem) =>
    item.kind + ('session' in item ? item.session.id : 'request' in item ? item.request.id : 'claim' in item ? `${item.claim.sessionId}:${item.claim.playerId}` : '');
  return (
    <>
      {refunds.length > 0 && (
        <section className="stack" aria-label="Refund requests">
          {refunds.map((item) => (
            <TodoCard key={key(item)} ctx={ctx} item={item} />
          ))}
        </section>
      )}
      <DoNowCard ctx={ctx} hideBook={ctx.d.adminV2 === true || ctx.d.adminR2 === true} />
      <OwedVenmoCards ctx={ctx} />
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
  // Instant taps (INSTANT_TAPS): the shared helper (admin/action.ts). Off: exactly as before.
  const instantAct = useAction(ctx);
  const instantOn = useInstant() !== null;
  async function act(fn: () => Promise<unknown>, msg: string, opts?: ActOptions) {
    if (instantOn) return void (await instantAct.run(fn, msg, opts));
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

  // Zip 11, Alert cards: the list cards keep their rows and buttons inside the one card look (amber for money owed, gray for late drops).
  const cards = ctx.d.alertCards === true;
  if (item.kind === 'owed' || item.kind === 'tonight') {
    const label = item.kind === 'tonight' ? 'Mark paid tonight' : 'Who owes you';
    return (
      <article className={cards ? 'ac ac-amber' : `card stack${item.kind === 'tonight' ? ' tonight' : ''}`} aria-label={label} {...(cards ? { 'data-alert-card': 'amber' } : {})}>
        {cards ? (
          <div className="ac-row">
            <AcIcon name="owe" />
            <AcTitle as="h3">{label}</AcTitle>
          </div>
        ) : (
          <h3>{label}</h3>
        )}
        <ul className={cards ? 'rows ac-body' : 'rows'}>
          {item.rows.map((r) => (
            <li key={`${r.session.id}-${r.playerId}`}>
              <span className="who">
                <strong>{r.name}</strong>
                <span className="small muted">
                  {formatShortDate(r.session.startsAt, tz)} · {formatPrice(r.cents)}
                </span>
              </span>
              <button
                className={cards ? 'ac-btn ac-out' : 'btn small secondary'}
                disabled={busy}
                aria-label={`Mark ${r.name} paid for ${formatShortDate(r.session.startsAt, tz)}`}
                onClick={() =>
                  act(() => api('POST', `/api/admin/sessions/${r.session.id}/payment`, { playerId: r.playerId, paid: true, seen: r.seen, cents: r.cents }), `${r.name} marked paid`, opTap({ kind: 'paid', sessionId: r.session.id, playerId: r.playerId }, 'Mark paid'))
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
  if (item.kind === 'payment_claim') return <PaymentClaimCard ctx={ctx} c={item.claim} />;
  if (item.kind === 'finalize') return <FinalizeCard ctx={ctx} s={item.session} />;

  const s = item.session;
  const title = 'Late drop';
  // Late fees (shared/lateFees.ts rule 8): "Find a sub" and Clear replace Done while the switch is on, or while any of
  // these late drops still owes (a debt made while it was on stays until it is cleared or paid).
  const feeMode = ctx.d.lateFees === true || lateDrops(s).some((r) => r.lateFee);
  return (
    <article className={cards ? 'ac ac-gray' : 'card stack'} aria-label={`${title}: ${formatShortDate(s.startsAt, tz)}`} {...(cards ? { 'data-alert-card': 'gray' } : {})}>
      {cards ? (
        <div className="ac-row">
          <AcIcon name="info" />
          <div className="ac-text">
            <AcTitle as="h3">{title}</AcTitle>
            <div className="ac-sub">{when(s, tz)}</div>
          </div>
        </div>
      ) : (
        <div>
          <h3>{title}</h3>
          <div className="small muted">{when(s, tz)}</div>
        </div>
      )}
      <ul className={cards ? 'rows ac-body' : 'rows'}>
        {lateDrops(s).map((r) => (
          <li key={r.playerId}>
            <span className="who">
              <span>
                <span className="late-tag">Late drop</span> <strong>{r.name}</strong>
              </span>
              <span className="small muted">
                dropped {formatDateTime(r.lateDropAt!, tz)}
                {r.lateFee
                  ? r.lateFee.paid
                    ? ` · their ${formatPrice(r.paymentAmountCents ?? 0)} stays on the game unless someone takes the spot`
                    : ` · ${r.isOrganizer ? 'you owe' : 'owes'} ${formatPrice(r.lateFee.oweCents)} unless someone takes the spot`
                  : r.creditBackCents > 0
                    ? ` · ${formatPrice(r.creditBackCents)} is their credit now`
                    : ''}
              </span>
            </span>
            {feeMode && <ClearChoices ctx={ctx} s={s} r={r} />}
          </li>
        ))}
      </ul>
      {feeMode ? (
        <div className="inline-links">
          <FindSubLink ctx={ctx} s={s} />
        </div>
      ) : (
      <button
        className={cards ? 'ac-btn ac-out ac-done' : 'btn small ghost'}
        disabled={busy}
        onClick={() =>
          act(async () => {
            for (const r of lateDrops(s)) await api('POST', `/api/admin/sessions/${s.id}/late-drop-done`, { playerId: r.playerId });
          }, 'Done')
        }
      >
        Done
      </button>
      )}
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
  // The new layout (ADMIN_V2): the top 2 games open as full cards, the rest as short rows (tap to open or fold).
  const v2 = ctx.d.adminV2 === true;
  // Round 2 (ADMIN_R2) also puts the Book button on the game's own card, so it needs the same list.
  const r2 = ctx.d.adminR2 === true;
  const serverNow = useServerNow(ctx.d.now);
  const courtNeeded = v2 || r2 ? new Set(courtCards(ctx.d, serverNow, `${window.location.origin}/admin`).filter((c) => c.kind === 'book').map((c) => c.session.id)) : null;
  const [all, setAll] = useState(false);
  const [adding, setAdding] = useState(false);
  const pills = (
    <>
      <button className="btn pill add-pill" onClick={() => setAdding(true)}>
        + Add game
      </button>
      <CourtReserveLink href={COURTRESERVE_BOOKING_URL} pill>
        {r2 ? 'Book' : 'Book a court'}
      </CourtReserveLink>
    </>
  );
  // Home is upcoming only; played sessions live under History.
  // (Money page rework: a game the organizer hid from the list is not here. `hiddenFromList` only exists while that switch is on.)
  const list = ctx.d.sessions.filter((s) => Date.parse(s.endsAt) > nowMs && s.hiddenFromList !== true);
  // Round 2: only THIS WEEK's games start open and every later week starts folded (a tap flips one). With nothing left this week, the first
  // game opens so the screen is never all folded. (Without round 2: the top 2, as the new layout always did.)
  const thisWeek = new Set(list.filter((s) => weekLabel(s.startsAt, nowMs, ctx.d.group.timezone) === 'This week').map((s) => s.id));
  if (thisWeek.size === 0 && list[0]) thisWeek.add(list[0].id);
  const games = useOpenGames(r2 ? (id) => thisWeek.has(id) : undefined);
  // (New layout: a game that needs its court booked is always listed, so its alert is never lost behind "Show all".)
  const shown = all ? list : list.filter((s, i) => i < 6 || courtNeeded?.has(s.id));
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
              {/* "+ Add game" and "Book a court" (round 2: "Book") ride on the first divider line, adding no height. */}
              {i === 0 && pills}
            </div>
          )}
          {v2 || r2 ? (
            <HomeGame ctx={ctx} s={s} open={games.isOpen(s.id, i)} fx={games.justToggled === s.id} needsCourt={courtNeeded!.has(s.id)} onToggle={() => games.toggle(s.id, i)} />
          ) : (
            <SessionCard ctx={ctx} s={s} courtNeed={r2 ? courtNeeded!.has(s.id) : undefined} />
          )}
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

/**
 * A time box in 30-minute steps (6:00 AM, 6:30 AM, ... 11:30 PM), shown on the 12-hour clock. The value is the same "HH:MM"
 * the plain time box gave. A time that is not on a half hour (a usual time of 7:15 PM from Settings) is kept as its own
 * choice so opening this form never quietly changes it.
 */
function HalfHourSelect({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  const slots: string[] = [];
  for (let m = 6 * 60; m <= 23 * 60 + 30; m += 30) slots.push(`${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`);
  if (/^\d{2}:\d{2}$/.test(value) && !slots.includes(value)) slots.push(value);
  slots.sort();
  const show = (hhmm: string) => {
    const h = Number(hhmm.slice(0, 2));
    return `${h % 12 === 0 ? 12 : h % 12}:${hhmm.slice(3)} ${h < 12 ? 'AM' : 'PM'}`;
  };
  return (
    <select value={value} aria-label={label} onChange={(e) => onChange(e.target.value)} required>
      {slots.map((t) => (
        <option key={t} value={t}>
          {show(t)}
        </option>
      ))}
    </select>
  );
}

/** "+ Add game": a one-off game on any date. Same rules as every session after that. */
function AddGameForm({ ctx, onDone }: { ctx: AdminCtx; onDone: () => void }) {
  const tz = ctx.d.group.timezone;
  // Admin screens, round 3 (ADMIN_R3): start and end in 30-minute steps, and a calendar date picker only (no suggested-day chips).
  const r3 = ctx.d.adminR3 === true;
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
      {r3 ? (
        <label className="field">
          Date
          <input type="date" data-add-date value={date} onChange={(e) => setDate(e.target.value)} required />
        </label>
      ) : (
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
      )}
      <div className="time-pair">
        <label className="field">
          Start
          {r3 ? (
            <HalfHourSelect value={start} onChange={setStart} label="Start time" />
          ) : (
            <input type="time" value={start} onChange={(e) => setStart(e.target.value)} required />
          )}
        </label>
        <label className="field">
          End
          {r3 ? (
            <HalfHourSelect value={end} onChange={setEnd} label="End time" />
          ) : (
            <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} required />
          )}
        </label>
      </div>
      <ShortGameHeadsUp ctx={ctx} minutes={boxMinutes(start, end)} />
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
