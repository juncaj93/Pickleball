import { Fragment, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SITE_NAME } from '../../shared/settings';
import type { GroupView, PlayerSessionView } from '../../shared/api';
import { formatPrice, venmoNote, venmoPayUrl } from '../../shared/money';
import { creditBackNote } from '../../shared/pricing';
import { DEFAULT_TIMEZONE, playerDay, wantInSubline, wantInTitle, formatMonthDay, formatShortDate, cardTime, cardTimeText, formatTimeRange, formatWeekday, localParts, ordinal, weekTier, type WeekTier } from '../../shared/time';
import { creditHintText, creditUsedMessage, droppedText, joinedCreditText } from '../../shared/credit';
import { MIN_PLAYERS } from '../../shared/spots';
import { CashOutPrompt } from './CashOutPrompt';
import { CreditChip, CreditSheet } from './CreditSheet';
import { api, ApiError, isDemo, demoOn, setGroupKey, setViewAs, storageGet, storageRemove, storageSet, useLoad, usePretend, setPretend, useRefreshOnReturn, copyText, openVenmo, useDemoVersion } from '../lib';
import { holdLive } from '../busy';
import { cashOutSeen, celebratedIds, planCashOut, planCelebration, rememberCashOuts, rememberCelebrated } from '../celebrate';
import { flushHold, holdPending, startHold, undoHold, UNDO_MS } from '../hold';
import { useLiveUpdates } from '../live';
import { courtDisplay, isNoCourt } from '../courtDisplay';
import { applyOverlay, canJoinInstantly, type Overlay } from '../optimistic';
import { ModeButton, TopBar } from '../Shell';
import { BANNER_TIMING, CalendarPlusIcon, ConfirmDialog, Empty, ErrorState, FilterIcon, NamesLine, Notice, ScheduleSkeleton, SpotDots, Spinner, useToast } from '../ui';
import { courtStatus } from '../../shared/court';
import { OrganizerLink } from './SiteHome';
import '../credit-player.css';
import '../player-cards.css';

const SHOW_FIRST = 6;

const FILTER_KEY = 'pb_games_filter';
/** A drop that was held for Undo and may not have reached the server yet (page closed first). */
const PENDING_DROP_KEY = 'pb_pending_drop';
type GameFilter = 'all' | 'mine';
/** In the game or waiting for a spot. */
const isMineGame = (s: PlayerSessionView) => !!s.mine && (s.mine.status === 'confirmed' || s.mine.status === 'waitlisted');
const NOTICE_GAP_MS = 2400;
/** Only the note of this drop is removed (a second hold may have written its own). */
function forgetPendingDrop(sessionId: string) {
  try {
    if (JSON.parse(storageGet(PENDING_DROP_KEY) ?? '{}').sessionId === sessionId) storageRemove(PENDING_DROP_KEY);
  } catch {
    storageRemove(PENDING_DROP_KEY);
  }
}
const CELEBRATE_MS = 1600;
const FADE_OUT_MS = 220;
const BANNER_FADE_MS = BANNER_TIMING.fadeIn;
const reducedMotion = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/**
 * Cards that disappear (a filter switch, a game that ends) fade out instead of
 * vanishing: the old card stays in place for a moment, marked as leaving.
 */
function useFadeOut(items: PlayerSessionView[]): { s: PlayerSessionView; leaving: boolean }[] {
  const [ghosts, setGhosts] = useState<{ s: PlayerSessionView; after: string | null; at: number }[]>([]);
  const prev = useRef<PlayerSessionView[]>(items);
  useEffect(() => {
    const was = prev.current;
    prev.current = items;
    if (reducedMotion()) return;
    const now = new Set(items.map((i) => i.id));
    const gone = was.map((s, at) => ({ s, at, after: at > 0 ? was[at - 1].id : null })).filter((x) => !now.has(x.s.id));
    if (gone.length === 0) return;
    setGhosts((g) => [...g, ...gone]);
    const ids = new Set(gone.map((x) => x.s.id));
    setTimeout(() => setGhosts((g) => g.filter((x) => !ids.has(x.s.id))), FADE_OUT_MS);
  }, [items]);
  const out = items.map((s) => ({ s, leaving: false }));
  const live = new Set(items.map((i) => i.id));
  for (const gh of [...ghosts].sort((a, b) => a.at - b.at)) {
    if (live.has(gh.s.id)) continue;
    let at = gh.after === null ? 0 : out.findIndex((r) => r.s.id === gh.after) + 1;
    if (at === 0 && gh.after !== null) at = out.length;
    out.splice(at, 0, { s: gh.s, leaving: true });
  }
  return out;
}

const TIER_LABEL: Record<WeekTier, string> = { this: 'This week', next: 'Next week', later: 'Later' };

type JoinResponse = {
  result: 'confirmed' | 'already_confirmed' | 'waitlisted' | 'standby';
  position?: number;
  /** Credit used on the seat at once (only when some was). */
  creditCents?: number;
  paidWithCredit?: boolean;
  /** A pending cash out that could cover the rest: "Use the $10 you asked to cash out for this game?" */
  cashOutOffer?: { cents: number; requestCents: number } | null;
};

const GOOD_NEWS = {
  spot_opened: "Good news, a spot opened up, so you're in.",
  court_opened: "Good news, the court opened, so you're in.",
};

/**
 * What the banner says after I'm in. With no court booked everyone who taps I'm in is simply in.
 * Credit that went on the game at once is said too: "You're in. $14 credit used." or, part cover on a
 * booked court, "You're in. $3 credit used, $11 due." (`priceCents` is the flat price.)
 */
export function joinedText(d: JoinResponse, noCourt = false, priceCents = 0): string {
  if (!noCourt && d.result === 'waitlisted') return `You're #${d.position} on the waitlist`;
  if (!noCourt && d.result === 'standby') return `You're on standby, #${d.position}`;
  return joinedCreditText("You're in", d.result === 'confirmed' ? (d.creditCents ?? 0) : 0, priceCents, !noCourt);
}

/**
 * The player's one screen. Also used by the organizer's "View as...", where
 * every request carries the chosen player and it's look-only: taps say
 * "Demo only" and nothing is saved.
 */
export function PlayerHome({
  groupKey,
  viewAs,
  onExit,
  onViewAs,
  plain,
  onLinkOnly,
  onWordNeeded,
  topBar,
}: {
  groupKey: string | null;
  /** "View as...": the organizer's "Pretending it's..." bar, kept with the View as bar at the top. */
  topBar?: ReactNode;
  viewAs?: { id: string; name: string };
  onExit?: () => void;
  /** "View as...": "not you?" picked a different player to view as. Nothing is saved. */
  onViewAs?: (p: { id: string; name: string }) => void;
  /** Opened at the plain site address (no private link). */
  plain?: boolean;
  /** The organizer switched to link-only while this page was open. */
  onLinkOnly?: () => void;
  /** A group word is now needed on this phone. */
  onWordNeeded?: () => void;
}) {
  setGroupKey(viewAs ? null : groupKey);
  setViewAs(viewAs?.id ?? null);
  // Set again on mount (before the load below runs) and cleared on the way out.
  useEffect(() => {
    setViewAs(viewAs?.id ?? null);
    return () => setViewAs(null);
  }, [viewAs?.id]);
  const pretend = usePretend();
  // Pretend time is for the organizer's screens; the plain player page always runs on real time.
  useEffect(() => {
    if (!viewAs) setPretend(null);
  }, [viewAs]);
  const demo = useDemoVersion();
  const load = useLoad(() => api<GroupView>('GET', '/api/group'), [groupKey, viewAs?.id, pretend, demo]);
  useRefreshOnReturn(load.refresh);
  const [switching, setSwitching] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [creditOpen, setCreditOpen] = useState(false);
  // The "Want in?" answer ("You're in" + Done) lives here, so the game cards below can refresh at once.
  const [answered, setAnswered] = useState<{ sessionId: string; text: string; startsAt: string; endsAt: string } | null>(null);
  // A shared link like ?s=<session id> opens with that session highlighted.
  const [focusId] = useState(() => new URLSearchParams(window.location.search).get('s'));
  const scrolled = useRef(false);
  // The credit the last screen showed, so a chip that appears later can count up from it.
  const lastBalance = useRef<number | null>(null);

  useEffect(() => {
    if (load.data && groupKey && !viewAs) storageSet('pb_group_key', groupKey);
  }, [load.data, groupKey, viewAs]);

  const g = load.data;
  const toast = useToast();

  // Taps still waiting on the server are drawn at once (I'm in, and a held Drop out).
  const [overlay, setOverlayState] = useState<Overlay>({});
  const setOverlay = useCallback((id: string, kind: 'join' | 'drop' | null) => {
    setOverlayState((o) => {
      if (kind === null) {
        if (!(id in o)) return o;
        const { [id]: _gone, ...rest } = o;
        return rest;
      }
      return { ...o, [id]: kind };
    });
  }, []);
  // Games with no court booked are drawn like normal games (src/courtDisplay.ts), after the taps still waiting on the server.
  const view = useMemo(() => (g ? courtDisplay(applyOverlay(g, overlay)) : null), [g, overlay]);

  // All games / My games, remembered on this phone (not in the organizer's "View as...").
  const [filter, setFilterState] = useState<GameFilter>(() => (!viewAs && storageGet(FILTER_KEY) === 'mine' ? 'mine' : 'all'));
  const setFilter = (f: GameFilter) => {
    setFilterState(f);
    if (!viewAs) storageSet(FILTER_KEY, f);
  };

  // The page keeps itself fresh: a tiny "did anything change?" check, the full list only when it did.
  useLiveUpdates({ enabled: !!g && !!g.me && !switching && !viewAs && !pretend, version: g?.version ?? null, reload: load.quiet });

  // One-time moments: a game I'm in reached 4, and a cash out the organizer sent.
  const celebrated = useRef<Set<string> | null>(null);
  if (!celebrated.current) celebrated.current = celebratedIds();
  const [celebrating, setCelebrating] = useState<Set<string>>(new Set());
  const markCelebrated = useCallback((id: string) => {
    celebrated.current!.add(id);
    rememberCelebrated(celebrated.current!);
  }, []);
  useEffect(() => {
    if (!g || !g.me || switching || viewAs) return;
    const plan = planCelebration(g.sessions, celebrated.current!);
    celebrated.current = plan.next;
    rememberCelebrated(plan.next, new Set(g.sessions.map((x) => x.id)));
    const cash = planCashOut(g.credit.history, cashOutSeen(), Date.parse(g.now));
    if (cash.show) rememberCashOuts(cash.next);
    const notices: { msg: string; ball?: boolean }[] = [];
    if (cash.show) notices.push({ msg: `${g.group.organizerName ?? 'The organizer'} sent your ${formatPrice(cash.show.cents)}` });
    if (plan.now.length) notices.push({ msg: `Game on! ${plan.now[0].confirmed.length} in`, ball: true });
    // Not cleaned up on purpose: the memory above is already saved, so a repeat of this effect must not cancel them.
    notices.forEach((n, i) => (i === 0 ? toast(n.msg, 'ok', { ball: n.ball }) : setTimeout(() => toast(n.msg, 'ok', { ball: n.ball }), i * NOTICE_GAP_MS)));
    if (plan.now.length) {
      const ids = new Set(plan.now.map((x) => x.id));
      setCelebrating(ids);
      setTimeout(() => setCelebrating((cur) => (cur === ids ? new Set() : cur)), CELEBRATE_MS);
    }
  }, [g, switching, viewAs, toast]);
  // "Use the $10 you asked to cash out for this game?" after I'm in, only when it matters (the server decides).
  const [cashOut, setCashOut] = useState<{ sessionId: string; cents: number } | null>(null);
  /** My own tap on I'm in / Yes: "Game on!" when it completed the 4th player, else "You're in". */
  const joinToast = useCallback(
    (sessionId: string, before: number, res: JoinResponse, noCourt = false) => {
      const offer = res.cashOutOffer && res.cashOutOffer.cents > 0 ? res.cashOutOffer : null;
      if (res.result === 'confirmed' && before + 1 >= MIN_PLAYERS) {
        // I was there for it, so the card does not celebrate again later.
        markCelebrated(sessionId);
        if (before + 1 === MIN_PLAYERS && !offer) return toast(joinedCreditText('Game on!', res.creditCents ?? 0, g?.group.priceCents ?? 0, !noCourt), 'ok', { ball: true });
      }
      // The cash-out question sits where the banner would; the card already says "You're in".
      if (offer) return setCashOut({ sessionId, cents: offer.cents });
      toast(joinedText(res, noCourt, g?.group.priceCents ?? 0));
    },
    [toast, markCelebrated, g?.group.priceCents],
  );

  // A drop that was held for Undo when the page closed: finish it.
  useEffect(() => {
    if (!g || !g.me || switching || viewAs) return;
    const raw = storageGet(PENDING_DROP_KEY);
    if (!raw) return;
    let rec: { sessionId?: string; at?: number } = {};
    try {
      rec = JSON.parse(raw);
    } catch {
      /* broken note: drop it */
    }
    if (rec.sessionId && holdPending(rec.sessionId)) return;
    const age = Date.now() - (rec.at ?? 0);
    // Younger than the hold: another tab is still holding it (its Undo must work), so leave it alone.
    if (age < UNDO_MS + 2_000) return;
    storageRemove(PENDING_DROP_KEY);
    const mineHere = g.sessions.find((x) => x.id === rec.sessionId)?.mine?.status === 'confirmed';
    if (rec.sessionId && mineHere && age < 2 * 60_000) {
      void api('POST', `/api/sessions/${rec.sessionId}/withdraw`, {}).then(() => load.quiet(), () => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [g?.me?.id]);
  // Leaving the screen sends a held drop right away.
  useEffect(() => () => flushHold(true), []);

  const balance = g && (switching || (!viewAs && !g.me)) ? null : (g?.credit.balanceCents ?? null);
  useEffect(() => {
    if (balance !== null) lastBalance.current = balance;
  }, [balance]);
  // Scroll to a shared session once the schedule shows (after picking a name).
  const focusIndex = g && focusId ? g.sessions.findIndex((s) => s.id === focusId) : -1;
  const choosing = !!g && (switching || (!viewAs && !g.me));
  const mineOnly = filter === 'mine';
  const filtered = view ? (mineOnly ? view.sessions.filter(isMineGame) : view.sessions) : [];
  const shownSessions = showAll || focusIndex >= SHOW_FIRST ? filtered : filtered.slice(0, SHOW_FIRST);
  const rows = useFadeOut(shownSessions);
  useEffect(() => {
    if (!g || choosing || focusIndex < 0 || scrolled.current) return;
    scrolled.current = true;
    requestAnimationFrame(() => document.getElementById(`row-${focusId}`)?.scrollIntoView({ block: 'center' }));
  }, [g, choosing, focusIndex, focusId]);
  useEffect(() => {
    if (!plain || !load.error) return;
    if (load.error.status === 404) onLinkOnly?.();
    if (load.error.status === 403) onWordNeeded?.();
  }, [plain, load.error, onLinkOnly, onWordNeeded]);
  if (plain && (load.error?.status === 404 || load.error?.status === 403)) return <Spinner />;
  if (load.error?.status === 404 && !viewAs) {
    return (
      <>
        <TopBar eyebrow={SITE_NAME} title="Link not working" />
        <main className="page">
          <Notice tone="danger" title="This group link isn't valid">
            It may have been replaced with a new one. Ask the organizer for the current link.
          </Notice>
        </main>
      </>
    );
  }

  const pickName = !!g && (switching || (!viewAs && !g.me));
  const tz = g?.group.timezone ?? DEFAULT_TIMEZONE;
  const showChip = !!g && !pickName && (g.credit.balanceCents > 0 || !!g.credit.pending);
  const chipStart = lastBalance.current;


  return (
    <>
      {/* "View as...": a small bar of its own above the player's real screen. */}
      {viewAs && (
        <div className="demo-bars">
          {topBar}
          <div className="viewas-banner" role="region" aria-label="Viewing as a player">
            <span>
              Viewing as <strong>{viewAs.name}</strong>
            </span>
            <button className="btn small" onClick={onExit}>
              Exit
            </button>
          </div>
        </div>
      )}
      <TopBar
        eyebrow={g?.group.name ?? SITE_NAME}
        title={!g ? SITE_NAME : pickName ? 'Who are you?' : (g.me?.name ?? viewAs?.name ?? SITE_NAME)}
        titleExtra={
          g?.me && !pickName ? (
            <button className="not-you" aria-label="Not you?" onClick={() => setSwitching(true)}>
              not you?
            </button>
          ) : undefined
        }
        tools={<ModeButton preview={!!viewAs} />}
        chip={showChip ? <CreditChip credit={g.credit} startFrom={chipStart} onOpen={() => setCreditOpen(true)} /> : undefined}
      />
      <main className="page stack-lg">
        {load.loading && !g && !load.error && <ScheduleSkeleton />}
        {load.error && load.error.status !== 404 && <ErrorState error={load.error} onRetry={load.reload} />}

        {g && pickName && (
          <NamePicker
            g={g}
            demo={
              viewAs
                ? (p) => {
                    // Only changes who the organizer is viewing as; nothing is saved anywhere.
                    setSwitching(false);
                    onViewAs?.(p);
                    window.scrollTo(0, 0);
                  }
                : undefined
            }
            onPicked={async () => {
              setSwitching(false);
              await load.reload();
            }}
            onCancel={g.me ? () => setSwitching(false) : undefined}
          />
        )}

        {g && !pickName && (
          <>
            {view!.payDue.length > 0 && <PayCard g={view!} onChanged={load.reload} />}
            {answered ? (
              <section className="card stack suggest" aria-label="Your answer">
                <h2>{answered.text}</h2>
                <p className="muted small">
                  {formatShortDate(answered.startsAt, tz)} · {cardTimeText(answered.startsAt, answered.endsAt, tz, g.group.usualMinutes)}
                </p>
                <button className="btn secondary block" onClick={() => setAnswered(null)}>
                  Done
                </button>
              </section>
            ) : (
              g.suggestion && <SuggestionCard key={g.suggestion.sessionId} g={g} onChanged={load.reload} onJoined={setAnswered} joinToast={joinToast} />
            )}
            {g.sessions.length === 0 && <Empty>No upcoming sessions yet.</Empty>}
            <div className="schedule">
              {/* Nothing to list (My games with no games): the switch still has a line of its own. */}
              {g.sessions.length > 0 && rows.length === 0 && (
                <div className="week-break tier-next filter-only">
                  <GameFilterToggle filter={filter} onChange={setFilter} />
                </div>
              )}
              {g.sessions.length > 0 && mineOnly && filtered.length === 0 && (
                <div className="card empty-mine" role="status">
                  <p>You're not in any games yet</p>
                  <button className="link-btn quiet-link" onClick={() => setFilter('all')}>
                    See all games
                  </button>
                </div>
              )}
              {rows.map(({ s, leaving }, i) => {
                const tier = weekTier(s.startsAt, Date.parse(g.now), tz);
                const prev = i > 0 ? weekTier(rows[i - 1].s.startsAt, Date.parse(g.now), tz) : null;
                // One header per tier: THIS WEEK, NEXT WEEK, LATER (every week after next shares one).
                const header = prev !== tier ? TIER_LABEL[tier] : null;
                return (
                  <Fragment key={s.id}>
                    {header && (
                      <div className={`week-break tier-${tier}`}>
                        <h3>{header}</h3>
                        {/* The switch sits at the right end of the first line, as part of it. */}
                        {i === 0 && <GameFilterToggle filter={filter} onChange={setFilter} />}
                      </div>
                    )}
                    <ScheduleRow
                      s={s}
                      g={view!}
                      tier={tier}
                      highlight={s.id === focusId}
                      onChanged={load.reload}
                      setOverlay={setOverlay}
                      joinToast={joinToast}
                      celebrating={celebrating.has(s.id)}
                      leaving={leaving}
                    />
                  </Fragment>
                );
              })}
            </div>
            {filtered.length > SHOW_FIRST && (
              <button className="btn ghost block" onClick={() => setShowAll((v) => !v)}>
                {showAll ? 'Show fewer' : `More sessions (${filtered.length - SHOW_FIRST})`}
              </button>
            )}
            {/* The end of the page: just a thin line and a little space. */}
            <div className="page-end" aria-hidden="true" />
          </>
        )}
        {/* Organizer sign-in only on "Who are you?", never under the schedule. */}
        {plain && !viewAs && pickName && <OrganizerLink />}
      </main>
      {cashOut && <CashOutPrompt key={cashOut.sessionId} sessionId={cashOut.sessionId} cents={cashOut.cents} onClose={() => setCashOut(null)} onChanged={load.reload} />}
      {g && <CreditSheet open={creditOpen && showChip} credit={g.credit} tz={tz} organizerName={g.group.organizerName ?? 'Alex'} onClose={() => setCreditOpen(false)} onChanged={load.reload} />}
    </>
  );
}

/** "All games" / "My games": a quiet switch at the right end of the first section line. */
function GameFilterToggle({ filter, onChange }: { filter: GameFilter; onChange: (f: GameFilter) => void }) {
  const mine = filter === 'mine';
  return (
    <button
      type="button"
      className="filter-toggle"
      data-filter={filter}
      aria-label={`Showing ${mine ? 'my games' : 'all games'}. Switch to ${mine ? 'all games' : 'my games'}`}
      onClick={() => onChange(mine ? 'all' : 'mine')}
    >
      <FilterIcon />
      <span aria-hidden="true">{mine ? 'My games' : 'All games'}</span>
    </button>
  );
}

function NamePicker({
  g,
  onPicked,
  onCancel,
  demo,
}: {
  g: GroupView;
  onPicked: () => void;
  onCancel?: () => void;
  /** "View as...": picking a name only switches the view. */
  demo?: (p: { id: string; name: string }) => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  async function pick(playerId: string) {
    if (demo) {
      const p = g.players.find((x) => x.id === playerId);
      if (p) demo({ id: p.id, name: p.name });
      return;
    }
    setBusy(true);
    try {
      await api('POST', '/api/me', { playerId });
      onPicked();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save your name.');
    } finally {
      setBusy(false);
    }
  }
  if (adding) return <AddMyName onPick={pick} onDone={onPicked} onBack={() => setAdding(false)} />;
  return (
    <section className="stack" aria-label="Pick your name">
      {error && <Notice tone="danger">{error}</Notice>}
      <div className="name-grid">
        {g.players.map((p) => (
          <button key={p.id} className={`btn ${g.me?.id === p.id ? '' : 'secondary'}`} disabled={busy} onClick={() => pick(p.id)}>
            {p.name}
          </button>
        ))}
      </div>
      <button className="btn ghost block" onClick={() => (demo ? toast('Demo: adding a name is off while viewing as a player.') : setAdding(true))}>
        Add my name
      </button>
      {onCancel && (
        <button className="btn ghost" onClick={onCancel}>
          Cancel
        </button>
      )}
    </section>
  );
}

type AddStep = { step: 'name' } | { step: 'is_this_you'; matches: { id: string; name: string }[] } | { step: 'days' };

/** Not on the list: type a name, check it isn't a duplicate, then pick preferred days. */
function AddMyName({ onPick, onDone, onBack }: { onPick: (id: string) => Promise<void>; onDone: () => void; onBack: () => void }) {
  const [name, setName] = useState('');
  const [state, setState] = useState<AddStep>({ step: 'name' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(confirmNew: boolean) {
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ result: 'added' | 'looks_like'; matches?: { id: string; name: string }[] }>('POST', '/api/players/self', {
        name,
        confirmNew,
      });
      setState(res.result === 'looks_like' ? { step: 'is_this_you', matches: res.matches ?? [] } : { step: 'days' });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not add your name.');
      setState({ step: 'name' });
    } finally {
      setBusy(false);
    }
  }

  async function days(d: number[]) {
    setBusy(true);
    try {
      if (d.length) await api('PUT', '/api/me/days', { days: d });
    } catch {
      /* the name is saved either way; days can be set later by the organizer */
    } finally {
      setBusy(false);
      onDone();
    }
  }

  if (state.step === 'is_this_you') {
    return (
      <section className="stack" aria-label="Is this you?">
        <h2>Is this you?</h2>
        <div className="name-grid">
          {state.matches.map((m) => (
            <button key={m.id} className="btn secondary" disabled={busy} onClick={() => onPick(m.id)}>
              {m.name}
            </button>
          ))}
        </div>
        <button className="btn block" disabled={busy} onClick={() => submit(true)}>
          No, I'm new
        </button>
      </section>
    );
  }

  if (state.step === 'days') {
    return (
      <section className="stack" aria-label="Preferred days">
        <h2>Any preferred days?</h2>
        <div className="name-grid">
          <button className="btn secondary" disabled={busy} onClick={() => days([2])}>
            Tuesday
          </button>
          <button className="btn secondary" disabled={busy} onClick={() => days([4])}>
            Thursday
          </button>
          <button className="btn secondary" disabled={busy} onClick={() => days([2, 4])}>
            Both
          </button>
          <button className="btn ghost" disabled={busy} onClick={() => days([])}>
            Skip
          </button>
        </div>
      </section>
    );
  }

  return (
    <form
      className="stack"
      aria-label="Add my name"
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim()) void submit(false);
      }}
    >
      <label className="field">
        Your name
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} autoComplete="given-name" autoFocus required />
      </label>
      {error && <Notice tone="danger">{error}</Notice>}
      <button className="btn block" type="submit" disabled={busy || !name.trim()}>
        Continue
      </button>
      <button className="btn ghost block" type="button" onClick={onBack}>
        Back
      </button>
    </form>
  );
}

/**
 * "I paid" / "Didn't pay?": the player marks their own payment, for one session or several. "I paid" sends the
 * amount the screen showed for each game, so a price that changed in the meantime is refused, not recorded.
 */
function usePaid(owed: { sessionId: string; cents: number }[], onChanged: () => Promise<void>) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  async function set(paid: boolean) {
    setBusy(true);
    const release = holdLive();
    try {
      for (const o of owed) await api('POST', `/api/sessions/${o.sessionId}/paid`, paid ? { paid, cents: o.cents } : { paid });
      toast(paid ? 'Marked paid' : 'Marked not paid');
      await onChanged();
    } catch (err) {
      if (isDemo(err)) toast(err.message);
      else toast(err instanceof ApiError ? err.message : 'That did not work. Try again.', 'error');
      await onChanged();
    } finally {
      setBusy(false);
      release();
    }
  }
  return { busy, set };
}

/**
 * Players with credit don't see "I paid" until they tap Pay (Venmo opened).
 * Remembered on this phone, per game.
 */
function usePayTapped(key: string) {
  const storeKey = `pb_pay_tapped_${key}`;
  const read = () => {
    try {
      return localStorage.getItem(storeKey) === '1';
    } catch {
      return false;
    }
  };
  const [tapped, setTapped] = useState(read);
  useEffect(() => setTapped(read()), [storeKey]);
  function mark() {
    setTapped(true);
    try {
      localStorage.setItem(storeKey, '1');
    } catch {
      /* the button simply shows for this visit */
    }
  }
  return { tapped, mark };
}

/**
 * "Use credit": takes the player's credit off the games they owe for, only
 * when they tap. One call per game, earliest first; it stops when a call fails
 * or the credit is used up.
 */
function useCredit(onChanged: () => Promise<void>) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  // Set at once (state waits for a redraw), so a quick second tap is ignored instead of flashing an error.
  const working = useRef(false);
  async function use(sessionIds: string[], owedCents: number, potCents: number) {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    const release = holdLive();
    let used = 0;
    try {
      let left = potCents;
      let potBefore = 0;
      let owedBefore = 0;
      for (const id of sessionIds) {
        if (left <= 0) break;
        const res = await api<{ ok: boolean; usedCents: number; paid: boolean; potBeforeCents: number; owedBeforeCents: number }>('POST', `/api/sessions/${id}/use-credit`, {});
        if (potBefore === 0) potBefore = res.potBeforeCents;
        owedBefore += res.owedBeforeCents;
        used += res.usedCents;
        left -= res.usedCents;
      }
      // Games the credit never reached still count as owed.
      owedBefore = Math.max(owedBefore, owedCents);
      if (used > 0) toast(creditUsedMessage(used, potBefore, owedBefore));
      else toast('No credit to use right now.');
      await onChanged();
    } catch (err) {
      if (isDemo(err)) toast(err.message);
      else toast(err instanceof ApiError ? err.message : 'That did not work. Try again.', 'error');
      await onChanged();
    } finally {
      working.current = false;
      setBusy(false);
      release();
    }
  }
  /** "Undo" under "Paid with credit": the credit goes back, the game is owed again. */
  async function undo(sessionId: string) {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    const release = holdLive();
    try {
      await api('POST', `/api/sessions/${sessionId}/undo-credit`, {});
      toast('Credit put back');
      await onChanged();
    } catch (err) {
      if (isDemo(err)) toast(err.message);
      else toast(err instanceof ApiError ? err.message : 'That did not work. Try again.', 'error');
      await onChanged();
    } finally {
      working.current = false;
      setBusy(false);
      release();
    }
  }
  return { busy, use, undo };
}

/**
 * Game day's payment card, at the very top: from 8:00 AM on game day until
 * the organizer marks it paid. Several unpaid sessions combine into one total
 * with one Venmo button. The button fills in the amount and a note like
 * "Pickleball Tue Nov 3 - Ryan" when Venmo allows it; otherwise the note shows
 * with Copy. Opening Venmo never marks anyone paid.
 */
function PayCard({ g, onChanged }: { g: GroupView; onChanged: () => Promise<void> }) {
  const toast = useToast();
  const tz = g.group.timezone;
  const due = g.payDue;
  const total = due.reduce((sum, o) => sum + o.amountCents, 0);
  const note = venmoNote(
    due.map((o) => o.startsAt),
    tz,
    g.me?.name,
  );
  const pay = venmoPayUrl(g.group.venmoUrl, total, note);
  const paid = usePaid(due.map((o) => ({ sessionId: o.sessionId, cents: o.amountCents })), onChanged);
  const credit = useCredit(onChanged);
  const payTap = usePayTapped(due.map((o) => o.sessionId).join('_'));
  // Spend the pot on the earliest game first; each game takes the smaller of what is left and what it costs.
  const dueByDate = [...due].sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  let potLeft = g.credit.usableCents;
  let covered = 0;
  for (const o of dueByDate) {
    const take = Math.max(Math.min(potLeft, o.amountCents), 0);
    covered += take;
    potLeft -= take;
  }
  const showCredit = g.credit.usableCents > 0 && covered > 0;
  // Whenever there is credit to use, "Use credit" is the filled button and Pay is its outline twin (same as on the cards).
  const creditCovers = showCredit;
  const busy = paid.busy || credit.busy;
  const creditBtn = showCredit && (
    <button
      className={`btn block ${creditCovers ? 'big' : 'secondary'}`}
      data-use-credit
      disabled={busy}
      onClick={() => credit.use(dueByDate.map((o) => o.sessionId), total, g.credit.usableCents)}
    >
      {credit.busy ? 'Saving…' : 'Use credit'}
    </button>
  );
  const todayKey = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: tz });
  const tonight = due.length === 1 && todayKey(due[0].startsAt) === todayKey(g.now);
  const title =
    due.length > 1 ? `You owe ${formatPrice(total)} total` : tonight ? `Tonight: you owe ${formatPrice(total)}` : `You owe ${formatPrice(total)} for ${formatShortDate(due[0].startsAt, tz)}`;
  const detail = (o: (typeof due)[number]) =>
    [o.finalized ? 'final price' : null, o.creditCents > 0 ? `after your ${formatPrice(o.creditCents)} credit` : null].filter(Boolean).join(', ');
  // (On this card the amounts are already after any credit; each game's own line says what is left.)
  const who = g.group.organizerName ?? 'The organizer';
  return (
    <section className="card pay-card" aria-label="Payment">
      <h2>{title}</h2>
      {due.length > 1 ? (
        <ul className="pay-list">
          {due.map((o) => (
            <li key={o.sessionId}>
              {formatShortDate(o.startsAt, tz)}: {formatPrice(o.amountCents)}
              {detail(o) && <span className="muted"> ({detail(o)})</span>}
            </li>
          ))}
        </ul>
      ) : (
        detail(due[0]) && (
          <p className="small">
            {formatPrice(due[0].amountCents)}, {detail(due[0])}
          </p>
        )
      )}
      {/* Pay, and a quiet "I paid" right with it for anyone who paid another way (Apple Cash, cash). */}
      {pay.url ? (
        <>
          {creditCovers && creditBtn}
          <a
            className={`btn block ${creditCovers ? 'secondary' : 'big'}`}
            href={pay.url}
            data-app-href={pay.appUrl ?? undefined}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Pay ${formatPrice(total)} with Venmo`}
            onClick={(e) => {
              payTap.mark();
              openVenmo(e, pay);
            }}
          >
            Pay with Venmo
          </a>
          {!creditCovers && creditBtn}
          {(!showCredit || payTap.tapped) && (
            <button className="btn block secondary" disabled={busy} onClick={() => paid.set(true)}>
              {paid.busy ? 'Saving…' : 'I paid'}
            </button>
          )}
        </>
      ) : (
        <>
          {creditCovers && creditBtn}
          <button className={`btn block ${creditCovers ? 'secondary' : 'big'}`} disabled={busy} onClick={() => paid.set(true)}>
            {paid.busy ? 'Saving…' : 'I paid'}
          </button>
          {!creditCovers && creditBtn}
        </>
      )}
      {!pay.url && <p className="small muted">Pay {who} however you usually do.</p>}
      {pay.url && !pay.prefilled && (
        <div className="venmo-note">
          <span className="small">
            Send {formatPrice(total)} with the note <strong>{note}</strong>
          </span>
          <button className="btn small secondary" onClick={async () => ((await copyText(note)) ? toast('Note copied') : toast("Couldn't copy the note.", 'error'))}>
            Copy note
          </button>
        </div>
      )}
    </section>
  );
}

/** "Want in on Tuesday?" for a usual day the player hasn't answered yet. */
function SuggestionCard({
  g,
  onChanged,
  onJoined,
  joinToast,
}: {
  g: GroupView;
  onChanged: () => Promise<void>;
  onJoined: (a: { sessionId: string; text: string; startsAt: string; endsAt: string }) => void;
  joinToast: (sessionId: string, before: number, res: JoinResponse, noCourt?: boolean) => void;
}) {
  const toast = useToast();
  const s = g.suggestion!;
  const tz = g.group.timezone;
  const [busy, setBusy] = useState(false);
  // At the max they would wait. On the venue's court waitlist everyone goes on standby, so no count.
  // With no court booked the game reads like a normal one and never says waitlist.
  const standby = s.courtState === 'waitlist';
  const waitlistForm = !standby && !s.noCourt && s.confirmedCount >= g.group.maxPlayers;
  const subline = standby || (s.noCourt && s.confirmedCount >= g.group.maxPlayers) ? '' : wantInSubline(s.confirmedCount, g.group.maxPlayers);

  async function answer(yes: boolean) {
    setBusy(true);
    const release = holdLive();
    try {
      if (yes) {
        // The same call, the same banner and the same refresh as tapping "I'm in" on that game.
        const res = await api<JoinResponse>('POST', `/api/sessions/${s.sessionId}/join`, {});
        joinToast(s.sessionId, s.confirmedCount, res, !!s.noCourt);
        onJoined({ sessionId: s.sessionId, text: joinedText(res, !!s.noCourt), startsAt: s.startsAt, endsAt: s.endsAt });
        await onChanged();
      } else {
        await api('POST', `/api/sessions/${s.sessionId}/decline`, {});
        await onChanged();
      }
    } catch (err) {
      if (isDemo(err)) toast(err.message);
      else toast(err instanceof ApiError ? err.message : 'That did not work. Try again.', 'error');
    } finally {
      setBusy(false);
      release();
    }
  }

  return (
    <section className="card stack suggest" aria-labelledby="suggest-title">
      <h2 id="suggest-title">{wantInTitle(s.startsAt, tz, Date.parse(g.now), waitlistForm)}</h2>
      {/* Line 1: date and time. Line 2: spots left, or where they would be. */}
      <div className="suggest-when">
        <span className="muted small">
          {formatShortDate(s.startsAt, tz)} · {cardTimeText(s.startsAt, s.endsAt, tz, g.group.usualMinutes)}
        </span>
      </div>
      {subline && <p className="muted small suggest-sub">{subline}</p>}
      <div className="btn-row">
        <button className="btn" disabled={busy} onClick={() => answer(true)}>
          Yes
        </button>
        <button className="btn secondary" disabled={busy} onClick={() => answer(false)}>
          No
        </button>
      </div>
    </section>
  );
}

/** The organizer's small plain holiday note ("Election Day \u00b7 check hours"). Players no longer see holidays. */
export function HolidayPill({ name, venueNote, confirmed }: { name: string; venueNote?: boolean; confirmed?: boolean }) {
  return (
    <span className="holiday">
      {name}
      {venueNote && !confirmed ? ' · check hours' : ''}
    </span>
  );
}

const TILE_DOW = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

/**
 * "TUE / 3 / NOV" tile for the left of a schedule row, like a paper
 * calendar: red weekday, big dark day, small gray month. `mine` adds a small
 * green check in the corner (you're in).
 */
export function DateTile({ iso, tz, mine }: { iso: string; tz: string; mine?: boolean }) {
  const p = localParts(Date.parse(iso), tz);
  const month = formatMonthDay(iso, tz).split(' ')[0].toUpperCase();
  return (
    <div className={`tile${mine ? ' mine' : ''}`} aria-hidden="true">
      <span className="dow">{TILE_DOW[p.weekday]}</span>
      <span className="day">{p.day}</span>
      <span className="mon">{month}</span>
      {mine && (
        <span className="tile-check">
          <svg viewBox="0 0 12 12" aria-hidden="true">
            <path d="m3.2 6.2 1.9 1.9 3.8-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      )}
    </div>
  );
}

const CHECK = (
  <svg viewBox="0 0 20 20" aria-hidden="true">
    <path d="M4.5 10.5l3.5 3.5 7.5-8" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/**
 * The player card's date tile. Normal: weekday, big day, month. Tonight: a
 * blue TONIGHT strip where the weekday would be. Extra (added by hand): an
 * ink tile (cream in dark mode). A check badge on the corner when you're in.
 */
function PlayerTile({ iso, tz, mine, tonight, extra }: { iso: string; tz: string; mine: boolean; tonight: boolean; extra: boolean }) {
  const p = localParts(Date.parse(iso), tz);
  const month = formatMonthDay(iso, tz).split(' ')[0].toUpperCase();
  return (
    <div className="tile-wrap" aria-hidden="true">
      <div className={`tile ptile${extra ? ' extra' : ''}${mine ? ' mine' : ''}`}>
        {tonight ? <span className="tonight-tag">TONIGHT</span> : <span className="dow">{TILE_DOW[p.weekday]}</span>}
        <span className="day">{p.day}</span>
        <span className="mon">{month}</span>
      </div>
      {mine && <span className="tile-check">{CHECK}</span>}
    </div>
  );
}

function countLine(s: PlayerSessionView): string {
  if (s.courtState === 'waitlist') return `${s.waitlist.length} on standby`;
  return s.countText;
}

/**
 * What this player owes on a card, in the compact look. At most two lines
 * after the names: the money line (an amber chip with its button beside it, or
 * the green "Paid" pill with the quiet links on the same line) and one line of
 * small links ("I paid", "Drop out"). `drop` is the "Drop out" link. On game
 * day after 8:00 AM the card at the top takes over the buttons and this shows
 * only the chip. In the flat LATER rows the money line is the right column.
 */
function RowPay({
  g,
  s,
  onTop,
  onChanged,
  drop,
}: {
  g: GroupView;
  s: PlayerSessionView;
  onTop: boolean;
  onChanged: () => Promise<void>;
  drop: ReactNode;
}) {
  const mine = s.mine!;
  const paid = usePaid([{ sessionId: s.id, cents: mine.oweCents }], onChanged);
  const credit = useCredit(onChanged);
  const payTap = usePayTapped(s.id);
  const busy = paid.busy || credit.busy;
  if (mine.paymentStatus === 'paid') {
    const amount = mine.shareCents;
    return (
      <div className="sched-money stacked">
        <span className="pchip chip-ok paid-tag" data-paid>{mine.paidWithCredit ? 'Paid with credit' : amount ? `Paid ${formatPrice(amount)}` : 'Paid'}</span>
        <span className="inline-links">
          {/* Credit use can be taken back; only their own "I paid" can be undone here, the organizer's stays. */}
          {mine.paidWithCredit && (
            <button className="link-btn quiet-link" data-undo-credit disabled={credit.busy} onClick={() => credit.undo(s.id)}>
              Undo
            </button>
          )}
          {mine.selfPaid && !mine.paidWithCredit && (
            <button className="link-btn quiet-link didnt-pay" disabled={paid.busy} onClick={() => paid.set(false)}>
              Didn't pay?
            </button>
          )}
          {drop}
        </span>
      </div>
    );
  }
  const left = mine.creditCents > 0;
  // Credit already on the seat (used at sign-up, or with Use credit): its own small chip, even before a court is booked.
  const creditChip = left && (
    <span className="pchip chip-credit-used" data-credit-used>
      Credit {formatPrice(mine.creditCents)} used
    </span>
  );
  if (mine.oweCents <= 0) {
    return (
      <div className="sched-money stacked">
        {creditChip}
        <span className="inline-links">{drop}</span>
      </div>
    );
  }
  // With credit to use, "Use credit" is the filled button and Pay is its outline twin (covers all or part).
  const showCredit = mine.useCreditCents > 0;
  const chip = (
    <span className="pchip chip-warn" data-owe>
      {formatPrice(mine.oweCents)} due
      {showCredit && !left && <span className="chip-credit"> · {formatPrice(g.credit.usableCents)} credit</span>}
    </span>
  );
  if (onTop) {
    return (
      <div className="sched-money stacked">
        {left ? (
          <span className="chip-pair">
            {creditChip}
            {chip}
          </span>
        ) : (
          chip
        )}
        <span className="inline-links">{drop}</span>
      </div>
    );
  }
  const pay = venmoPayUrl(g.group.venmoUrl, mine.oweCents, venmoNote(s.startsAt, g.group.timezone, g.me?.name));
  const filled = 'btn pay-btn';
  const outline = 'btn pay-btn outline';
  const creditBtn = showCredit && (
    <button className={filled} data-use-credit disabled={busy} onClick={() => credit.use([s.id], mine.oweCents, mine.useCreditCents)}>
      Use credit
    </button>
  );
  const creditHint = showCredit && !left ? <span className="credit-hint sr-only">{creditHintText(mine.useCreditCents, g.credit.usableCents, mine.oweCents)}</span> : null;
  const payLabel = `Pay ${formatPrice(mine.oweCents)}`;
  // Always pay first when credit does not cover it; "I paid" stays for anyone who paid another way.
  const payBtn = pay.url ? (
    <a
      className={showCredit ? outline : filled}
      href={pay.url}
      data-app-href={pay.appUrl ?? undefined}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`Pay ${formatPrice(mine.oweCents)} with Venmo`}
      onClick={(e) => {
        payTap.mark();
        openVenmo(e, pay);
      }}
    >
      {left ? payLabel : 'Pay'}
    </a>
  ) : (
    <button className={showCredit ? outline : filled} disabled={busy} onClick={() => paid.set(true)}>
      I paid
    </button>
  );
  const iPaid = pay.url && (!showCredit || payTap.tapped) && (
    <button className="link-btn quiet-link" disabled={busy} onClick={() => paid.set(true)}>
      I paid
    </button>
  );
  return (
    <>
      <div className="sched-money pay-line">
        {creditChip}
        {chip}
        {creditHint}
        <span className="sched-btns">
          {showCredit && creditBtn}
          {payBtn}
        </span>
      </div>
      <div className="sched-links inline-links">
        {iPaid}
        {drop}
      </div>
    </>
  );
}

/**
 * One session in the schedule. Three looks by tier: THIS WEEK (big tile,
 * green outline, soft shadow), NEXT WEEK (smaller, thin outline) and LATER
 * (a flat two-column row). The tile carries the weekday (or TONIGHT), date,
 * and a check when you're in; the short time sits under it. No green tint for
 * joined. The calendar icon sits at the right end of the status line.
 */
export function ScheduleRow({
  s,
  g,
  tier,
  onChanged,
  highlight,
  setOverlay,
  joinToast,
  celebrating,
  leaving,
}: {
  s: PlayerSessionView;
  g: GroupView;
  tier: WeekTier;
  onChanged: () => Promise<void>;
  /** Opened from a shared link to this session. */
  highlight?: boolean;
  /** Draw a tap at once (I'm in, a held Drop out) until the server answers, or take it back off. */
  setOverlay: (id: string, kind: 'join' | 'drop' | null) => void;
  joinToast: (sessionId: string, before: number, res: JoinResponse, noCourt?: boolean) => void;
  /** The pickleballs ripple once: this game just reached 4 and this device had not seen it. */
  celebrating?: boolean;
  /** Fading out of the list. */
  leaving?: boolean;
}) {
  const tz = g.group.timezone;
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  // Set at once (state waits for a redraw), so a quick second tap is ignored instead of flashing an error.
  const working = useRef(false);
  const [askOut, setAskOut] = useState(false);
  const mine = s.mine;
  const inSession = mine?.status === 'confirmed';
  const waiting = mine?.status === 'waitlisted';
  const courtWait = s.courtState === 'waitlist';
  const open = !s.canceled && !s.started;
  const nowMs = Date.parse(g.now);

  async function run(path: string, label: (data: any) => string) {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    const release = holdLive();
    try {
      toast(label(await api<any>('POST', `/api/sessions/${s.id}/${path}`, {})));
      await onChanged();
    } catch (err) {
      if (isDemo(err)) toast(err.message);
      else toast(err instanceof ApiError ? err.message : 'That did not work. Try again.', 'error');
      await onChanged();
    } finally {
      working.current = false;
      setBusy(false);
      setAskOut(false);
      release();
    }
  }

  /** Undo tapped after the drop had already been sent (page hid, or the last instant): say so, never pretend. */
  const tooLateToast = (undone: boolean) => {
    if (!undone) toast("Too late, you're already out. Tap I'm in to rejoin.", 'error');
  };

  /** I'm in: the card fills at once; if the server says no, it goes back and the banner says why. */
  async function join() {
    if (working.current) return;
    // Tapping I'm in while a drop is still waiting for Undo just takes the drop back.
    if (undoHold(s.id)) {
      toast("You're back in");
      return;
    }
    const before = s.confirmed.length;
    const instant = canJoinInstantly(s);
    working.current = true;
    setBusy(true);
    const release = holdLive();
    if (instant) setOverlay(s.id, 'join');
    try {
      joinToast(s.id, before, await api<JoinResponse>('POST', `/api/sessions/${s.id}/join`, {}), isNoCourt(s));
      await onChanged();
    } catch (err) {
      setOverlay(s.id, null);
      if (isDemo(err)) toast(err.message);
      else toast(err instanceof ApiError ? err.message : 'That did not work. Try again.', 'error');
      await onChanged();
    } finally {
      setOverlay(s.id, null);
      working.current = false;
      setBusy(false);
      release();
    }
  }

  /**
   * Drop out: the card shows it at once, but nothing is sent for 5 seconds so Undo can take it back
   * (money is involved, so a finished drop is never reversed). Closing the page sends it right away.
   */
  function dropOut() {
    setAskOut(false);
    if (working.current) return;
    // Too close to the start, or to the late-drop deadline, to wait: send it now, like before, so the 5 seconds never change how it counts.
    const soon = Date.now() + UNDO_MS + 3_000;
    const deadline = Date.parse(s.dropCutoffAt);
    if (Date.parse(s.startsAt) - Date.now() < 10_000 || (deadline > Date.now() - 1_000 && deadline < soon)) {
      void run('withdraw', (d) => droppedText(d?.creditReturnedCents ?? 0, d?.creditBackCents ?? 0, "You're out."));
      return;
    }
    const id = s.id;
    setOverlay(id, 'drop');
    storageSet(PENDING_DROP_KEY, JSON.stringify({ sessionId: id, at: Date.now() }));
    startHold(id, {
      send: async (leaving) => {
        await api('POST', `/api/sessions/${id}/withdraw`, {}, { keepalive: leaving && !demoOn() });
      },
      settled: async (err) => {
        forgetPendingDrop(id);
        if (err) {
          setOverlay(id, null);
          if (isDemo(err)) toast(err.message);
          else toast(err instanceof ApiError ? err.message : 'That did not work. Try again.', 'error');
        }
        await onChanged();
        setOverlay(id, null);
      },
      undone: () => {
        forgetPendingDrop(id);
        setOverlay(id, null);
      },
    });
    // Says what happens to their money: "You dropped out. $14 credit returned." (nothing is sent until Undo runs out).
    toast(droppedText(mine?.dropCreditCents ?? 0, mine?.dropCashCents ?? 0), 'ok', { stayMs: UNDO_MS - BANNER_FADE_MS, action: { label: 'Undo', onClick: () => tooLateToast(undoHold(id)) } });
  }

  const court = courtStatus(s, tz);
  const goodNews = inSession && mine.promotion ? (s.courtState === 'opened' && mine.promotion === 'spot_opened' ? GOOD_NEWS.court_opened : GOOD_NEWS[mine.promotion]) : null;

  const names = s.confirmed.map((p) => p.name);
  const everyone = g.players.map((p) => p.name);
  const onTop = g.payDue.some((o) => o.sessionId === s.id);
  const isIn = inSession && !s.canceled;
  const tonight = open && playerDay(s.startsAt, tz, nowMs).word === 'tonight';
  // Once you're signed up: at the right end of the status line (the tap area reaches past the icon).
  const calLink = isIn && open && (
    <a className="cal-icon-link" href={`/api/sessions/${s.id}/calendar.ics`} aria-label={`Add ${formatShortDate(s.startsAt, tz)} to calendar`}>
      <CalendarPlusIcon />
    </a>
  );
  const showCount = !s.canceled && (s.confirmed.length > 0 || !courtWait);
  const dropLink = isIn && open && (
    <button className="link-btn quiet-link drop-link" disabled={busy} aria-busy={busy} onClick={() => setAskOut(true)}>
      Drop out
    </button>
  );
  const payShows = isIn && !!mine && (mine.paymentStatus === 'paid' || mine.oweCents > 0 || mine.creditCents > 0 || onTop);

  // The gray "If 6 play, you get $5 back as credit." for someone who would be 5th or later (not joined, room left, not on a waitlist).
  const notIn = open && !(inSession || waiting);
  const note = notIn && !courtWait && s.joinAs === 'in' && !s.full ? creditBackNote(g.group.priceCents, s.confirmed.length, g.group.maxPlayers, formatPrice) : null;

  // The status line: "You're in · Court booked", the court word with a dot, the waitlist spot, or Canceled (with the organizer's reason).
  const courtWord = <span>{court.playerText}</span>;
  let status: ReactNode;
  if (s.canceled) status = <span className="st-canceled">{s.courtState === 'not_opened' ? court.playerText : s.cancelReason ? `Canceled - ${s.cancelReason}` : 'Canceled'}</span>;
  else if (waiting) status = <span className="st-wait">{courtWait ? 'Standby' : 'Waitlist'}, {ordinal(mine.waitlistPosition ?? 1)} in line</span>;
  else if (isIn)
    status = (
      <>
        <span className="st-lead">
          <strong className="st-in">You're in</strong>
          <span className="st-sep">·</span>
        </span>
        <span className="st-tail">
          <span className="court-status">{courtWord}</span>
          {calLink}
        </span>
      </>
    );
  else
    status = (
      <span className="court-status">
        <span className="court-dot" aria-hidden="true" />
        {courtWord}
      </span>
    );

  const joinBtn = notIn && (
    <button className={`btn sched-btn${tier === 'later' ? ' outline' : ''}`} disabled={busy} aria-busy={busy} onClick={join}>
      {busy ? 'Saving…' : courtWait ? 'Join standby' : s.joinAs === 'in' ? "I'm in" : 'Join waitlist'}
    </button>
  );
  const leaveBtn = waiting && open && (
    <button className="btn sched-btn outline" disabled={busy} aria-busy={busy} onClick={() => setAskOut(true)}>
      {courtWait ? 'Leave standby' : 'Leave waitlist'}
    </button>
  );
  const noteEl = note && (
    <p className="credit-note" data-credit-note>
      {note}
    </p>
  );

  return (
    <article
      id={`row-${s.id}`}
      className={`sched tier-${tier}${s.canceled ? ' off' : ''}${highlight ? ' highlight' : ''}${leaving ? ' leaving' : ''}`}
      aria-hidden={leaving ? true : undefined}
      data-tier={tier}
      data-mine={isIn ? 'in' : undefined}
      data-extra={s.extra ? 'yes' : undefined}
      aria-labelledby={`s-${s.id}`}
    >
      <div className="sched-tilecol">
        <PlayerTile iso={s.startsAt} tz={tz} mine={isIn} tonight={tonight && !s.canceled} extra={s.extra} />
        {(() => {
          // Only the start ("7:30 PM") so it always fits under the tile. A game of another length also shows
          // where it ends, on a second short line, so nobody is misled.
          const t = cardTime(s.startsAt, s.endsAt, tz, g.group.usualMinutes);
          return (
            <div className={`sched-time${t.end ? ' range' : ''}`} data-sched-time>
              <span aria-hidden="true">{t.start}</span>
              {t.end && <span aria-hidden="true">{'\u2013'}{t.end}</span>}
            </div>
          );
        })()}
      </div>
      <h2 id={`s-${s.id}`} className="sr-only">
        {formatWeekday(s.startsAt, tz)}, {formatMonthDay(s.startsAt, tz)}, {formatTimeRange(s.startsAt, s.endsAt, tz)}
        {isIn ? ". You're in" : ''}
      </h2>
      <div className="sched-body">
        <div className="sched-head">
          <div className={`sched-status court-${court.kind}`} data-court={court.kind}>
            {status}
          </div>
        </div>
        <div className="sched-main">
          {showCount && (
            <div className="in-line">
              <span className="in-count">{countLine(s)}</span>
              <SpotDots names={names} me={g.me?.name} celebrate={celebrating} />
            </div>
          )}
          {showCount && <NamesLine names={names} me={g.me?.name} everyone={everyone} />}
          {!s.canceled && !waiting && (
            <NamesLine names={s.waitlist.map((w) => w.name)} me={g.me?.name} everyone={everyone} label={courtWait ? 'Standby' : 'Waitlist'} />
          )}
          {waiting && !s.canceled && <p className="sched-sub">You're in if someone drops.</p>}
          {s.canceled && <p className="sched-sub">If you paid, it's now your credit.</p>}

          {s.extra && <span className="sr-only">Extra game</span>}
          {s.note && <p className="game-note">{s.note}</p>}
          {goodNews && <Notice tone="ok">{goodNews}</Notice>}
          {tier === 'later' && noteEl}
        </div>

        {payShows && <RowPay g={g} s={s} onTop={onTop} onChanged={onChanged} drop={dropLink} />}
        {isIn && !payShows && dropLink && (
          <div className="sched-money stacked">
            <span className="inline-links">{dropLink}</span>
          </div>
        )}
        {(joinBtn || leaveBtn) && <div className="sched-money">{joinBtn}{leaveBtn}</div>}
        {tier !== 'later' && noteEl}
      </div>

      <ConfirmDialog
        open={askOut}
        title={waiting ? (courtWait ? 'Leave standby?' : 'Leave the waitlist?') : `Out for ${playerDay(s.startsAt, tz, nowMs).word}?`}
        body={waiting ? 'You lose your place in line.' : 'Your spot opens up for someone else.'}
        confirmLabel={waiting ? (courtWait ? 'Leave standby' : 'Leave waitlist') : 'Drop out'}
        danger
        busy={busy}
        onConfirm={() => (waiting ? run('withdraw', () => "You're off the list") : dropOut())}
        onCancel={() => setAskOut(false)}
      />
    </article>
  );
}
