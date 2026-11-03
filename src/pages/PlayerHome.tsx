import { Fragment, type ReactNode, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { SITE_NAME } from '../../shared/settings';
import type { GroupView, PlayerSessionView } from '../../shared/api';
import { formatPrice, venmoNote, venmoPayUrl } from '../../shared/money';
import { NO_VENMO_STAY_MS, noVenmoMessage, watchVenmoLaunch } from '../venmoFallback';
import { creditBackNote } from '../../shared/pricing';
import { formatTime, DEFAULT_TIMEZONE, playerDay, suggestDay, wantInSubline, wantInTitle, formatMonthDay, formatShortDate, cardTime, cardTimeText, formatTimeRange, formatWeekday, localParts, ordinal, weekTier, type WeekTier } from '../../shared/time';
import { creditHintText, creditUsedMessage, droppedText, joinedCreditText } from '../../shared/credit';
import { feeClearedNotice, lateDropDialogText, lateDropToast, lateFeeLabel } from '../../shared/lateFees';
import { MIN_PLAYERS } from '../../shared/spots';
import { CashOutPrompt } from './CashOutPrompt';
import { CreditChip, CreditSheet } from './CreditSheet';
import { api, ApiError, isDemo, demoOn, setGroupKey, setViewAs, storageGet, storageSet, useLoad, usePretend, setPretend, useRefreshOnReturn, copyText, openVenmo, venmoHandsOffToApp, useDemoVersion, demoSessionNumber, viewingAs } from '../lib';
import { holdLive } from '../busy';
import { cashOutSeen, celebratedIds, planCashOut, planCelebration, rememberCashOuts, rememberCelebrated } from '../celebrate';
import { flushHold, holdPending, noteStillApplies, pendingDropAction, type PendingDropNote, settleHolds, startHold, undoHold, UNDO_MS } from '../hold';
import { useLiveUpdates } from '../live';
import { addNote, forgetGame, readNotes, removeNote, sameNote } from '../dropNotes';
import { goodNewsKey, seeGoodNews } from '../goodNews';
import { courtDisplay, isNoCourt } from '../courtDisplay';
import { applyOverlay, canJoinInstantly, type Overlay } from '../optimistic';
import { ModeButton, TopBar } from '../Shell';
import { BANNER_TIMING, CalendarPlusIcon, ConfirmDialog, Empty, ErrorState, FilterIcon, NamesLine, Notice, Pickleball, ScheduleSkeleton, SpotDots, Spinner, useToast } from '../ui';
import { canMove, motionOn, rememberedMotion, rememberMotion, RollText, setMotion, useJustChanged, useLingering, useMotion, usePullToRefresh, useStatusMorph } from '../motion';
import { courtStatus } from '../../shared/court';
import { OrganizerLink } from './SiteHome';
import '../credit-player.css';
import '../player-cards.css';
import '../motion.css';
import { registerCant, TileBorders, TimeBars, tsClass, tsKind, tsTime, useCourtFlip, type TsKind } from '../timeShift';

const SHOW_FIRST = 6;

const FILTER_KEY = 'pb_games_filter';
type GameFilter = 'all' | 'mine';
/** In the game or waiting for a spot. */
const isMineGame = (s: PlayerSessionView) => !!s.mine && (s.mine.status === 'confirmed' || s.mine.status === 'waitlisted');
const NOTICE_GAP_MS = 2400;
/**
 * Finish the left-over drop notes that are due. Per note: younger than the hold, another tab may still be holding it
 * (its Undo must work), so wait; older than 2 minutes, too late to be sure, so forget. Otherwise it is sent, but only
 * for the same name and the same seat as the server has it now (never for another name on this phone, or a seat
 * taken again since); a note that changed during a wait is left for the next look. `ok` says whether to go on (the
 * page is still open and not in a demo); `done` hears every game whose note was settled. Answers when to look again.
 */
/** A call that hangs (a stale connection on flaky mobile data) counts as no signal after this, so it never blocks later checks. */
const NOTE_CALL_LIMIT_MS = 12_000;
function limited<T>(p: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new ApiError(0, 'offline', 'No signal')), NOTE_CALL_LIMIT_MS);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}
async function finishNotes(ok: () => boolean, done: (sessionId: string) => void = () => {}): Promise<number | null> {
  let again: number | null = null;
  const soon = (ms: number) => {
    again = again === null ? ms : Math.min(again, ms);
  };
  let fresh: GroupView | null | undefined;
  for (const note of readNotes()) {
    if (!ok()) return null;
    const due = pendingDropAction(note, Date.now(), () => true, holdPending);
    if (due.do === 'wait') soon(due.ms);
    if (due.do === 'forget') {
      removeNote(note);
      if (note.sessionId) done(note.sessionId);
    }
    if (due.do !== 'send') continue;
    // Whether they are still in comes from the server as it is now (the screen's copy hides a seat whose drop it is drawing).
    if (fresh === undefined) fresh = await limited(api<GroupView>('GET', '/api/group')).catch(() => null);
    if (!ok()) return null;
    if (!fresh) {
      soon(15_000); // no signal: keep the note and look again
      continue;
    }
    if (!readNotes().some((x) => sameNote(x, note))) continue; // changed during the wait
    if (!noteStillApplies(note, fresh)) {
      removeNote(note);
      done(due.sessionId);
      continue;
    }
    try {
      // If this times out but lands anyway, the next look finds them out and simply forgets the note.
      await limited(api('POST', `/api/sessions/${due.sessionId}/withdraw`, {}));
      removeNote(note);
      done(due.sessionId);
    } catch (err) {
      // Refused (game started, already out...): nothing left to send. No signal: the note stays for later.
      if (err instanceof ApiError && err.code !== 'offline') {
        removeNote(note);
        done(due.sessionId);
      } else soon(15_000);
    }
    fresh = undefined; // the server changed: ask again for the next note
  }
  return again;
}

/**
 * Before I'm in on a game: a drop held on this phone (or left over from a page that closed before sending it)
 * goes to the server FIRST, and the join waits for it. The credit that drop gives back is then there for the
 * new seat (it goes on at I'm in), instead of the new seat owing money while that credit sits unused.
 */
async function sendDropsBeforeJoin(joiningId: string) {
  await settleHolds();
  // View as (a demo copy) never reads, sends or clears the phone's real drop notes: they belong to the live site.
  if (demoOn()) return;
  // I'm in on the very game a note is about: they want in, so that old drop must never be sent after this.
  forgetGame(joiningId);
  await finishNotes(() => !demoOn());
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
export function joinedText(d: JoinResponse, noCourt = false, priceCents = 0, showDue = !noCourt): string {
  // A really full game has a real waitlist, court or no court: say so.
  if (d.result === 'waitlisted') return `You're #${d.position} on the waitlist`;
  if (!noCourt && d.result === 'standby') return `You're on standby, #${d.position}`;
  // `showDue`: the card shows "$ due" for this game (a booked court, or "Ask for payment on every game" is on).
  return joinedCreditText("You're in", d.result === 'confirmed' ? (d.creditCents ?? 0) : 0, priceCents, showDue);
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

  // ---- Motion (the MOTION switch). Visual only; with it off none of this does anything. ----
  // <html data-motion> follows the server's answer; until the first answer, what this phone heard last time
  // (so the loading skeleton already behaves). Cleared when this screen goes away (the organizer's screens never animate).
  useLayoutEffect(() => {
    setMotion(g ? g.motion === true : rememberedMotion());
  }, [g, g?.motion]);
  useEffect(() => {
    if (g) rememberMotion(g.motion === true);
  }, [g, g?.motion]);
  useLayoutEffect(() => () => setMotion(false), []);
  const motion = useMotion();
  // The first-load cascade plays once per page open (not on refreshes, filter taps or name switches). `live` turns on
  // when it is over: anything that appears from then on is a real change.
  const firstData = useRef(true);
  const [cascade, setCascade] = useState(false);
  const [live, setLive] = useState(false);
  const cascadeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useLayoutEffect(() => {
    if (!g || !firstData.current) return;
    firstData.current = false;
    if (!canMove()) {
      setLive(true);
      return;
    }
    setCascade(true);
    // Not cancelled by the next refresh: the cascade ends on its own, once.
    cascadeTimer.current = setTimeout(() => {
      setCascade(false);
      setLive(true);
    }, 900);
  }, [g]);
  useEffect(() => () => clearTimeout(cascadeTimer.current), []);
  const ptrBall = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLElement>(null);

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
  // Game on burst (motion): never on page load, so the first look at the page never bursts.
  const firstPlan = useRef(true);
  /** The 8 little balls pop out of this game's card once. */
  const burst = useCallback((id: string) => {
    if (!canMove()) return;
    const ids = new Set([id]);
    setCelebrating(ids);
    setTimeout(() => setCelebrating((cur) => (cur === ids ? new Set() : cur)), CELEBRATE_MS);
  }, []);
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
    const first = firstPlan.current;
    firstPlan.current = false;
    if (plan.now.length && !(motionOn() && first)) {
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
      // "$11 due" is said only where the card shows it: a booked court, or "Ask for payment on every game" is on.
      const showDue = !noCourt || !!g?.payAlways;
      if (res.result === 'confirmed' && before + 1 >= MIN_PLAYERS) {
        // I was there for it, so the card does not celebrate again later.
        markCelebrated(sessionId);
        if (before + 1 === MIN_PLAYERS && !offer) {
          burst(sessionId);
          return toast(joinedCreditText('Game on!', res.creditCents ?? 0, g?.group.priceCents ?? 0, showDue), 'ok', { ball: true });
        }
      }
      // The cash-out question sits where the banner would; the card already says "You're in".
      if (offer) return setCashOut({ sessionId, cents: offer.cents });
      toast(joinedText(res, noCourt, g?.group.priceCents ?? 0, showDue));
    },
    [toast, markCelebrated, burst, g?.group.priceCents, g?.payAlways],
  );

  // A drop that was held for Undo when the page closed (or lost signal): finish it. A note younger than the hold
  // may belong to another tab still holding it, so this page looks again once it is old enough, instead of
  // leaving it for a later visit (where it could have run out).
  useEffect(() => {
    if (!g || !g.me || switching || viewAs || demoOn()) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // One look at a time, and none after this page (or this name) is gone or a demo started.
    let alive = true;
    let running = false;
    let rerun = false;
    const ok = () => alive && !demoOn();
    const look = async () => {
      if (!ok()) return;
      if (running) {
        rerun = true;
        return;
      }
      running = true;
      clearTimeout(timer);
      try {
        const settled: string[] = [];
        const next = await finishNotes(ok, (id) => settled.push(id));
        if (!ok()) return;
        // The screen stops drawing those drops (and their credit); the real data shows.
        for (const id of settled) setOverlay(id, null);
        if (settled.length) await load.quiet();
        if (next !== null && ok()) timer = setTimeout(() => void look(), next);
      } finally {
        running = false;
        if (rerun && ok()) {
          rerun = false;
          void look();
        }
      }
    };
    void look();
    // Back to the page (after a send that failed while it was hidden): finish the drop then.
    const onVisible = () => {
      if (document.visibilityState === 'visible') void look();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      alive = false;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [g?.me?.id]);
  // Leaving the screen sends a held drop right away.
  useEffect(() => () => flushHold(true), []);

  // The header chip and the credit sheet read the screen's data, so a held drop's credit shows with its banner.
  const credit = view?.credit ?? g?.credit;
  const balance = g && (switching || (!viewAs && !g.me)) ? null : (credit?.balanceCents ?? null);
  useEffect(() => {
    if (balance !== null) lastBalance.current = balance;
  }, [balance]);
  // Scroll to a shared session once the schedule shows (after picking a name).
  const focusIndex = g && focusId ? g.sessions.findIndex((s) => s.id === focusId) : -1;
  const choosing = !!g && (switching || (!viewAs && !g.me));
  // The CREDIT chip pops in when it first appears and fades out at $0 (motion).
  const chipOn = !!g && !!credit && !choosing && (credit.balanceCents > 0 || !!credit.pending);
  const chipEnter = useJustChanged(chipOn, 600) && chipOn && live;
  const chipShown = useLingering(chipOn ? credit : null, 220);
  usePullToRefresh({ enabled: motion && canMove() && !!g && !choosing, onRefresh: load.quiet, ball: ptrBall, shift: mainRef });
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
  const showChip = !!g && !!credit && !pickName && (credit.balanceCents > 0 || !!credit.pending);
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
        chip={
          showChip ? (
            <CreditChip credit={credit!} startFrom={chipStart} enter={chipEnter} onOpen={() => setCreditOpen(true)} />
          ) : chipShown.value ? (
            <CreditChip credit={chipShown.value} leave={chipShown.leaving} onOpen={() => {}} />
          ) : undefined
        }
      />
      <main ref={mainRef} className={`page stack-lg${cascade ? ' m-cascade' : ''}`}>
        {/* Pull to refresh: the ball that shows in the gap the list leaves (motion only). */}
        {motion && (
          <div ref={ptrBall} className="m-ptr" aria-hidden="true">
            <Pickleball />
          </div>
        )}
        {load.loading && !g && !load.error && <ScheduleSkeleton />}
        {load.error && load.error.status !== 404 && (!g || !!viewAs) && <ErrorState error={load.error} onRetry={load.reload} />}

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
              // Stay on the name list until the new name's own data has arrived: for a moment the page still holds the
              // old name's credit and buttons, and a tap there would act as the new name.
              if (!(await load.quiet())) throw new Error('games did not load');
              setSwitching(false);
            }}
            onCancel={g.me ? () => setSwitching(false) : undefined}
          />
        )}

        {g && !pickName && (
          <>
            <TimeBars
              view={view!}
              onChanged={load.reload}
              onShowAll={() => {
                // Can't make it on a game further down than the list shows: show it, then its drop question opens.
                setShowAll(true);
                setFilter('all');
              }}
            />
            <FeeNotices g={view!} />
            {view!.payDue.length > 0 && <PayCard g={view!} onChanged={load.reload} enter={live} />}
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
              // The court-display view: a game with no court reads like a normal one here too (suggestion.noCourt is set there).
              view!.suggestion && <SuggestionCard key={view!.suggestion.sessionId} g={view!} onChanged={load.reload} onJoined={setAnswered} joinToast={joinToast} />
            )}
            {g.sessions.length === 0 && <Empty>No upcoming sessions yet.</Empty>}
            <div className={`schedule${g.playerFix1 ? ' pf1' : ''}`}>
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
      {g && credit && <CreditSheet open={creditOpen && showChip} credit={credit} tz={tz} organizerName={g.group.organizerName ?? 'Alex'} onClose={() => setCreditOpen(false)} onChanged={load.reload} />}
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

const NOT_LOADED = 'Your name is saved, but your games did not load. Reload this page.';

function NamePicker({
  g,
  onPicked,
  onCancel,
  demo,
}: {
  g: GroupView;
  onPicked: () => void | Promise<void>;
  onCancel?: () => void;
  /** "View as...": picking a name only switches the view. */
  demo?: (p: { id: string; name: string }) => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  // True after a pick whose games did not load: the old screen must not come back (Cancel reloads instead).
  const [stale, setStale] = useState(false);
  async function pick(playerId: string) {
    if (busy) return;
    setBusy(true);
    // A drop still waiting for Undo belongs to the name that tapped it: send it before the phone switches names.
    await settleHolds();
    setBusy(false);
    if (demo) {
      const p = g.players.find((x) => x.id === playerId);
      if (p) demo({ id: p.id, name: p.name });
      return;
    }
    setBusy(true);
    try {
      await api('POST', '/api/me', { playerId });
      try {
        await onPicked();
      } catch {
        // The name is saved on this phone, but the games did not load: stay here so nobody acts on the old screen.
        // (Cancel now reloads the page: going back to the old screen would show another name's games.)
        setAdding(false);
        setStale(true);
        setError(NOT_LOADED);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save your name.');
    } finally {
      setBusy(false);
    }
  }
  if (adding) return <AddMyName onPick={pick} onDone={() =>
        void Promise.resolve(onPicked()).catch(() => {
          setAdding(false);
          setStale(true);
          setError(NOT_LOADED);
        })
      } onBack={() => setAdding(false)} />;
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
        <button className="btn ghost" disabled={busy} onClick={() => (stale ? window.location.reload() : onCancel())}>
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
      // Adding a name switches this phone to it: a drop still waiting for Undo goes first, as the name that tapped it.
      await settleHolds();
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

/** The ids of cleared-debt notices this phone dismissed (shared/lateFees.ts feeClearedNotice). */
const FEE_SEEN_KEY = 'pb_fee_notices_seen';
function readFeeSeen(): string[] {
  try {
    const v = JSON.parse(storageGet(FEE_SEEN_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * "Good news: someone took your spot for Tue, Nov 3. You no longer owe $14." One notice per cleared late fee of THIS
 * player, in the usual banner look, shown each time the site opens until they tap Dismiss (remembered on this phone).
 */
function FeeNotices({ g }: { g: GroupView }) {
  const [seen, setSeen] = useState<string[]>(readFeeSeen);
  const tz = g.group.timezone;
  const list = (g.feeNotices ?? []).filter((n) => !seen.includes(n.id));
  if (list.length === 0) return null;
  const dismiss = (id: string) => {
    const next = [...readFeeSeen().filter((x) => x !== id), id].slice(-50);
    try {
      storageSet(FEE_SEEN_KEY, JSON.stringify(next));
    } catch {
      /* it simply shows again next time */
    }
    setSeen(next);
  };
  return (
    <>
      {list.map((n) => (
        <div key={n.id} className="fee-notice" data-fee-notice={n.why}>
          <Notice tone="ok">
            <span className="fee-notice-row">
              <span>{feeClearedNotice(n.why, formatShortDate(n.startsAt, tz), formatPrice(g.group.priceCents), n.creditCents > 0 ? formatPrice(n.creditCents) : null)}</span>
              <button type="button" className="btn small ghost" onClick={() => dismiss(n.id)}>
                Dismiss
              </button>
            </span>
          </Notice>
        </div>
      ))}
    </>
  );
}

/**
 * "I paid" / "Didn't pay?": the player marks their own payment, for one session or several. "I paid" sends the
 * amount the screen showed for each game, so a price that changed in the meantime is refused, not recorded.
 */
function usePaid(owed: { sessionId: string; cents: number }[], onChanged: () => Promise<void>) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const ids = owed.map((o) => o.sessionId);
  const elsewhere = useMoneyInFlight(ids);
  async function set(paid: boolean) {
    // The same game can have buttons in two places (the card at the top and the game card): one tap at a time.
    if (inFlight.size && ids.some((id) => inFlight.has(id))) return;
    const done = moneyStarted(ids);
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
      done();
      release();
    }
  }
  return { busy: busy || elsewhere, set };
}

/**
 * Players with credit don't see "I paid" until they tap Pay (Venmo opened).
 * Remembered on this phone, per game.
 */
/**
 * After Pay is tapped on a phone, wait about 2 seconds: if the Venmo app did not take over the screen, say so with a
 * small note ("No Venmo? Pay Alex directly"). The Pay button and its link are not touched. See src/venmoFallback.ts.
 */
function useNoVenmoNote(organizerName: string | null, enabled: boolean) {
  const toast = useToast();
  const stop = useRef<(() => void) | null>(null);
  useEffect(() => () => stop.current?.(), []);
  return (pay: { url: string | null; appUrl: string | null }) => {
    // Off (Settings > Feature switches): Pay behaves exactly as it always did.
    if (!enabled || !venmoHandsOffToApp(pay)) return;
    stop.current?.();
    stop.current = watchVenmoLaunch(() => toast(noVenmoMessage(organizerName), 'ok', { stayMs: NO_VENMO_STAY_MS }));
  };
}

function usePayTapped(key: string, alsoKeys: string[] = []) {
  const storeKey = `pb_pay_tapped_${key}`;
  const read = () => {
    try {
      return localStorage.getItem(storeKey) === '1' || tappedThisVisit.has(storeKey);
    } catch {
      return tappedThisVisit.has(storeKey);
    }
  };
  const [tapped, setTapped] = useState(read);
  useEffect(() => setTapped(read()), [storeKey]);
  // Two Pay buttons for the same game (the card at the top and the game card) stay in step: a tap on one is seen by the other.
  useEffect(() => {
    const onTap = () => setTapped(read());
    window.addEventListener(PAY_TAPPED_EVENT, onTap);
    return () => window.removeEventListener(PAY_TAPPED_EVENT, onTap);
  }, [storeKey]);
  function mark() {
    for (const k of [storeKey, ...alsoKeys.map((id) => `pb_pay_tapped_${id}`)]) {
      tappedThisVisit.add(k);
      try {
        localStorage.setItem(k, '1');
      } catch {
        /* the button simply shows for this visit */
      }
    }
    setTapped(true);
    window.dispatchEvent(new Event(PAY_TAPPED_EVENT));
  }
  return { tapped, mark };
}

const PAY_TAPPED_EVENT = 'pb-pay-tapped';
/** Taps made in this visit, for a phone that will not keep localStorage. */
const tappedThisVisit = new Set<string>();

/**
 * Games whose money tap (I paid, Didn't pay?, Use credit, Undo) is being saved right now. The same game can have its
 * buttons in two places (the card at the top and the game card, PLAYER_FIX1), so the other place waits instead of
 * sending a second request. Only games with buttons in two places are ever affected.
 */
const inFlight = new Map<string, number>();
const inFlightWatchers = new Set<() => void>();
let inFlightVersion = 0;
function moneyStarted(ids: string[]): () => void {
  const touch = () => {
    inFlightVersion++;
    inFlightWatchers.forEach((w) => w());
  };
  for (const id of ids) inFlight.set(id, (inFlight.get(id) ?? 0) + 1);
  touch();
  return () => {
    for (const id of ids) {
      const n = (inFlight.get(id) ?? 1) - 1;
      if (n <= 0) inFlight.delete(id);
      else inFlight.set(id, n);
    }
    touch();
  };
}
function useMoneyInFlight(ids: string[]): boolean {
  useSyncExternalStore(
    (cb) => {
      inFlightWatchers.add(cb);
      return () => void inFlightWatchers.delete(cb);
    },
    () => inFlightVersion,
  );
  return ids.some((id) => inFlight.has(id));
}

/**
 * "Use credit": takes the player's credit off the games they owe for, only
 * when they tap. One call per game, earliest first; it stops when a call fails
 * or the credit is used up.
 */
function useCredit(onChanged: () => Promise<void>, gameIds: string[] = []) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const elsewhere = useMoneyInFlight(gameIds);
  // Set at once (state waits for a redraw), so a quick second tap is ignored instead of flashing an error.
  const working = useRef(false);
  async function use(sessionIds: string[], owedCents: number, potCents: number) {
    if (working.current || sessionIds.some((id) => inFlight.has(id))) return;
    working.current = true;
    const done = moneyStarted(sessionIds);
    setBusy(true);
    const release = holdLive();
    let used = 0;
    try {
      // A drop still waiting for Undo goes first, so the credit it gives back is there to use.
      await settleHolds();
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
      done();
      release();
    }
  }
  /** "Undo" under "Paid with credit": the credit goes back, the game is owed again. */
  async function undo(sessionId: string) {
    if (working.current || inFlight.has(sessionId)) return;
    working.current = true;
    const done = moneyStarted([sessionId]);
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
      done();
      release();
    }
  }
  return { busy: busy || elsewhere, use, undo };
}

/**
 * Game day's payment card, at the very top: from 8:00 AM on game day until
 * the organizer marks it paid. Several unpaid sessions combine into one total
 * with one Venmo button. The button fills in the amount and a note like
 * "Pickleball Tue Nov 3 - Ryan" when Venmo allows it; otherwise the note shows
 * with Copy. Opening Venmo never marks anyone paid.
 */
function PayCard({ g, onChanged, enter: enterNow }: { g: GroupView; onChanged: () => Promise<void>; enter?: boolean }) {
  // Only a card that appears after the page has settled enters; a later refresh never replays it.
  const enter = useRef(enterNow).current;
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
  const credit = useCredit(onChanged, due.map((o) => o.sessionId));
  // PLAYER_FIX1 on: tonight's game card has its own Pay too, so a tap here also counts for each game's own card.
  const payTap = usePayTapped(due.map((o) => o.sessionId).join('_'), g.playerFix1 ? due.map((o) => o.sessionId) : []);
  const watchNoVenmo = useNoVenmoNote(g.group.organizerName, !!g.payNote);
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
  // A late fee says why: "You owe $14 for Tue, Nov 3 (late drop)" (shared/lateFees.ts rule 7).
  const why = (o: (typeof due)[number]) => (o.lateFee ? ` (${lateFeeLabel(o.lateFee)})` : '');
  const title =
    due.length > 1
      ? `You owe ${formatPrice(total)} total`
      : tonight && !due[0].lateFee
        ? `Tonight: you owe ${formatPrice(total)}`
        : `You owe ${formatPrice(total)} for ${formatShortDate(due[0].startsAt, tz)}${why(due[0])}`;
  const detail = (o: (typeof due)[number]) =>
    [o.finalized && !o.lateFee ? 'final price' : null, o.creditCents > 0 ? `after your ${formatPrice(o.creditCents)} credit` : null].filter(Boolean).join(', ');
  // (On this card the amounts are already after any credit; each game's own line says what is left.)
  const who = g.group.organizerName ?? 'The organizer';
  return (
    <section className={`card pay-card${enter ? ' m-enter' : ''}`} aria-label="Payment">
      <h2>
        <RollText text={title} />
      </h2>
      {due.length > 1 ? (
        <ul className="pay-list">
          {due.map((o) => (
            <li key={o.sessionId}>
              {formatShortDate(o.startsAt, tz)}
              {why(o)}: <RollText text={formatPrice(o.amountCents)} />
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
              watchNoVenmo(pay);
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
  // A game really full beyond the max has a real waitlist, court or no court (as its card says), so the prompt
  // warns first. With room, a game with no court booked reads like a normal one.
  const standby = s.courtState === 'waitlist';
  const waitlistForm = !standby && s.confirmedCount >= g.group.maxPlayers;
  const subline = standby ? '' : wantInSubline(s.confirmedCount, g.group.maxPlayers);

  async function answer(yes: boolean) {
    setBusy(true);
    const release = holdLive();
    try {
      if (yes) {
        // The same call, the same banner and the same refresh as tapping "I'm in" on that game.
        await sendDropsBeforeJoin(s.sessionId);
        const res = await api<JoinResponse>('POST', `/api/sessions/${s.sessionId}/join`, {});
        joinToast(s.sessionId, s.confirmedCount, res, !!s.noCourt);
        onJoined({ sessionId: s.sessionId, text: joinedText(res, !!s.noCourt, g.group.priceCents, !s.noCourt || !!g.payAlways), startsAt: s.startsAt, endsAt: s.endsAt });
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
export function DateTile({ iso, tz, mine, ts = '' }: { iso: string; tz: string; mine?: boolean; ts?: string }) {
  const p = localParts(Date.parse(iso), tz);
  const month = formatMonthDay(iso, tz).split(' ')[0].toUpperCase();
  return (
    <div className={`tile${mine ? ' mine' : ''}${ts}`} aria-hidden="true">
      {ts && <TileBorders />}
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
function PlayerTile({ iso, tz, mine, tonight, extra, ts = '' }: { iso: string; tz: string; mine: boolean; tonight: boolean; extra: boolean; ts?: string }) {
  const p = localParts(Date.parse(iso), tz);
  const month = formatMonthDay(iso, tz).split(' ')[0].toUpperCase();
  return (
    <div className="tile-wrap" aria-hidden="true">
      <div className={`tile ptile${extra ? ' extra' : ''}${mine ? ' mine' : ''}${ts}`}>
        {ts && <TileBorders />}
        {tonight ? <span className="tonight-tag">TONIGHT</span> : <span className="dow">{TILE_DOW[p.weekday]}</span>}
        <span className="day">{p.day}</span>
        <span className="mon">{month}</span>
      </div>
      {mine && <span className="tile-check">{CHECK}</span>}
    </div>
  );
}

/** A comment of this many characters or fewer is a pill; a longer one is a soft box. */
const NOTE_PILL_MAX = 18;
const noteLook = (text: string) => (text.trim().length <= NOTE_PILL_MAX ? 'note-pill' : 'note-box');

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
 * only the chip, unless PLAYER_FIX1 is on: then tonight's card has the same Pay and
 * "I paid" as every later card, and the top card keeps its own. In the flat LATER
 * rows the money line is the right column.
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
  const credit = useCredit(onChanged, [s.id]);
  const payTap = usePayTapped(s.id);
  const watchNoVenmo = useNoVenmoNote(g.group.organizerName, !!g.payNote);
  const busy = paid.busy || credit.busy;
  // PLAYER_FIX1 off: the card at the top takes over the buttons on game day, as always.
  const chipOnly = onTop && !g.playerFix1;
  if (mine.paymentStatus === 'paid') {
    const amount = mine.shareCents;
    return (
      <div className="sched-money stacked">
        <span className="pchip chip-ok paid-tag" data-paid>
          <RollText text={mine.paidWithCredit ? 'Paid with credit' : amount ? `Paid ${formatPrice(amount)}` : 'Paid'} />
        </span>
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
      <RollText text={`Credit ${formatPrice(mine.creditCents)} used`} />
    </span>
  );
  if (mine.oweCents <= 0) {
    // Nothing due on the card (paid by other means, or no court booked yet with "Ask for payment on every game" off):
    // no Pay, but credit they can use is always offered ("Use $14 credit").
    const useNow = mine.useCreditCents > 0 && (
      <button className="btn pay-btn" data-use-credit disabled={busy} onClick={() => credit.use([s.id], mine.useCreditCents, mine.useCreditCents)}>
        <RollText text={`Use ${formatPrice(mine.useCreditCents)} credit`} />
      </button>
    );
    return (
      <div className="sched-money stacked">
        {creditChip}
        {useNow}
        <span className="inline-links">{drop}</span>
      </div>
    );
  }
  // With credit to use, "Use credit" is the filled button and Pay is its outline twin (covers all or part).
  const showCredit = mine.useCreditCents > 0;
  const chip = (
    <span className="pchip chip-warn" data-owe>
      <RollText text={`${formatPrice(mine.oweCents)} due`} />
      {showCredit && !left && (
        <span className="chip-credit">
          {' · '}
          <RollText text={`${formatPrice(g.credit.usableCents)} credit`} />
        </span>
      )}
    </span>
  );
  if (chipOnly) {
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
        watchNoVenmo(pay);
        openVenmo(e, pay);
      }}
    >
      {left ? <RollText text={payLabel} /> : 'Pay'}
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

/** "Game on": 8 small pickleballs pop out of the card once (about 400 ms). Decoration only; it never takes a tap. */
function Burst() {
  return (
    <span className="m-burst" aria-hidden="true">
      {Array.from({ length: 8 }, (_, k) => {
        const a = (k / 8) * Math.PI * 2 + 0.2;
        return (
          <span key={k} style={{ display: 'contents', ['--k' as string]: k, ['--dx' as string]: `${Math.round(Math.cos(a) * 74)}px`, ['--dy' as string]: `${Math.round(Math.sin(a) * 46)}px` }}>
            <Pickleball />
          </span>
        );
      })}
    </span>
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
  // Opened from the "time changed" notice's Can't make it: the same drop flow, in that notice's words.
  const [fromNotice, setFromNotice] = useState(false);
  const mine = s.mine;
  const inSession = mine?.status === 'confirmed';
  const waiting = mine?.status === 'waitlisted';
  const courtWait = s.courtState === 'waitlist';
  const open = !s.canceled && !s.started;
  const nowMs = Date.parse(g.now);
  const motion = useMotion();
  // Motion: the status control eases from the I'm in button into the chip (and back), and what just changed pops.
  const rowRef = useRef<HTMLElement>(null);
  useStatusMorph(rowRef);

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
      await sendDropsBeforeJoin(s.id);
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
  function dropOut(lead?: string) {
    setAskOut(false);
    if (working.current) return;
    // Too close to the start, or to the late-drop deadline, to wait: send it now, like before, so the 5 seconds never change how it counts.
    const soon = Date.now() + UNDO_MS + 3_000;
    const deadline = Date.parse(s.dropCutoffAt);
    if (Date.parse(s.startsAt) - Date.now() < 10_000 || (deadline > Date.now() - 1_000 && deadline < soon)) {
      void run('withdraw', (d) =>
        d?.lateFee ? lateDropToast(formatPrice(d.lateFee.cents), d.lateFee.paid) : droppedText(d?.creditReturnedCents ?? 0, d?.creditBackCents ?? 0, "You're out."),
      );
      return;
    }
    const id = s.id;
    setOverlay(id, 'drop');
    // Tapped in the organizer's View as (a demo copy): nothing about it is written to, or cleared from, the phone's
    // real drop note, and if the demo has ended or moved to another player by the time it is sent (Exit within the
    // 5 seconds), there is nothing to send: it must never reach the live site as a real drop.
    const inDemo = demoOn();
    const viewedAt = viewingAs();
    const myNote: PendingDropNote = { sessionId: id, at: Date.now(), playerId: g.me?.id, signupAt: mine?.signupAt };
    const forget = () => {
      if (!inDemo) removeNote(myNote);
    };
    if (!inDemo) addNote(myNote);
    // Sent because the page was going away (closed, hidden, switched app): a failure then is most likely no
    // signal while leaving, so the note stays and the drop is finished on return or the next open.
    let leavingSend = false;
    startHold(id, {
      send: async (leaving) => {
        leavingSend = leaving;
        if (inDemo && (!demoOn() || viewingAs() !== viewedAt)) return;
        // keepalive on every real drop: a second Drop out sends this one at once, and the page may close right after.
        await api('POST', `/api/sessions/${id}/withdraw`, {}, { keepalive: !inDemo });
      },
      settled: async (err) => {
        if (err && leavingSend && err instanceof ApiError && err.code === 'offline') return;
        forget();
        if (err) {
          setOverlay(id, null);
          if (isDemo(err)) toast(err.message);
          else toast(err instanceof ApiError ? err.message : 'That did not work. Try again.', 'error');
        }
        await onChanged();
        setOverlay(id, null);
      },
      undone: () => {
        forget();
        setOverlay(id, null);
      },
    });
    // Says what happens to their money: "You dropped out. $14 credit returned." (nothing is sent until Undo runs out).
    // Late fees on and the game would go short: "You're out. You owe $14 unless someone takes your spot." (shared/lateFees.ts).
    const lateOwes = mine?.lateDrop?.owes ? mine.lateDrop : null;
    toast(lateOwes ? lateDropToast(formatPrice(lateOwes.feeCents), lateOwes.paid) : droppedText(mine?.dropCreditCents ?? 0, mine?.dropCashCents ?? 0, lead, mine?.dropClaimCents ?? 0, g.group.organizerName), 'ok', { stayMs: UNDO_MS - BANNER_FADE_MS, action: { label: 'Undo', onClick: () => tooLateToast(undoHold(id)) } });
  }

  const court = courtStatus(s, tz);
  // The court on the tile's border and the time under it (always on; only the moved-game notice has a switch).
  const ts: TsKind | null = tsKind(court.kind, !!s.venueWaitlist);
  const flip = useCourtFlip(s.id, ts);
  const asking = !!s.timeAsk && g.timeShift !== false && inSession && open;
  useEffect(() => {
    if (!asking) return undefined;
    return registerCant(s.id, () => {
      setFromNotice(true);
      setAskOut(true);
    });
  }, [asking, s.id]);
  // Shown only the first time this player sees this promotion on this phone (src/goodNews.ts).
  const promoted = inSession && !!mine.promotion && !!g.me && seeGoodNews(goodNewsKey(g.me.id, s.id, mine.signupAt), demoOn() ? demoSessionNumber() : null);
  const goodNews = promoted ? (s.courtState === 'opened' && mine.promotion === 'spot_opened' ? GOOD_NEWS.court_opened : GOOD_NEWS[mine.promotion!]) : null;

  const names = s.confirmed.map((p) => p.name);
  const everyone = g.players.map((p) => p.name);
  const onTop = g.payDue.some((o) => o.sessionId === s.id);
  const isIn = inSession && !s.canceled;
  // Both only after a real change (never on the first draw of the page): you just got in / the money line changed.
  const justJoined = useJustChanged(isIn, 700);
  // Coarse on purpose (yes or no, not the amounts), so a changed amount alone never re-pops the buttons.
  const moneyKey = `${isIn ? 1 : 0}|${(mine?.oweCents ?? 0) > 0 ? 1 : 0}|${(mine?.creditCents ?? 0) > 0 ? 1 : 0}`;
  const moneyFresh = useJustChanged(moneyKey, 700);
  const paidFresh = useJustChanged(mine?.paymentStatus === 'paid', 700);
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
  const payShows = isIn && !!mine && (mine.paymentStatus === 'paid' || mine.oweCents > 0 || mine.creditCents > 0 || mine.useCreditCents > 0 || onTop);

  // The gray "If 6 play, you get $5 back as credit." for someone who would be 5th or later (not joined, room left, not on a waitlist).
  const notIn = open && !(inSession || waiting);
  const note = notIn && !courtWait && s.joinAs === 'in' && !s.full ? creditBackNote(g.group.priceCents, s.confirmed.length, g.group.maxPlayers, formatPrice) : null;

  // The status line: "You're in · Court booked", the court word with a dot, the waitlist spot, or Canceled (with the organizer's reason).
  const courtWord = <span>{court.playerText}</span>;
  let status: ReactNode;
  // A canceled game's reason is shown like a comment: a pill when the reason is short, a soft box when it is long (same words as before).
  const reasonShown = s.canceled && s.courtState !== 'not_opened' && !!s.cancelReason;
  if (s.canceled) status = <span className={`st-canceled${reasonShown ? ` ${noteLook(s.cancelReason!)}` : ''}`}>{s.courtState === 'not_opened' ? court.playerText : s.cancelReason ? `Canceled - ${s.cancelReason}` : 'Canceled'}</span>;
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
    <button className={`btn sched-btn${tier === 'later' ? ' outline' : ''}`} data-join disabled={busy} aria-busy={busy} onClick={join}>
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
      ref={rowRef}
      id={`row-${s.id}`}
      className={`sched tier-${tier}${s.canceled ? ' off' : ''}${highlight ? ' highlight' : ''}${leaving ? ' leaving' : ''}${asking ? ' ts-asking' : ''}${moneyFresh ? ' m-fresh' : ''}${justJoined ? ' m-joined' : ''}${paidFresh ? ' m-paid' : ''}`}
      aria-hidden={leaving ? true : undefined}
      data-tier={tier}
      data-mine={isIn ? 'in' : undefined}
      data-extra={s.extra ? 'yes' : undefined}
      aria-labelledby={`s-${s.id}`}
    >
      <div className="sched-tilecol">
        <PlayerTile iso={s.startsAt} tz={tz} mine={isIn} tonight={tonight && !s.canceled} extra={false} ts={s.extra ? '' : tsClass(ts, flip)} />
        <div className="sched-when-col">
        {(() => {
          // Only the start ("7:30 PM") so it always fits under the tile. A game of another length also shows
          // where it ends, on a second short line, so nobody is misled.
          const t = cardTime(s.startsAt, s.endsAt, tz, g.group.usualMinutes);
          return (
            <div className={`sched-time${t.end ? ' range' : ''}${tsClass(ts, flip)}`} data-sched-time data-ts={ts ?? undefined}>
              <span aria-hidden="true">{tsTime(t.start, ts)}</span>
              {t.end && <span aria-hidden="true">{'\u2013'}{t.end}</span>}
            </div>
          );
        })()}
        {/* A one-off game: the usual date tile, and a small EXTRA tag under the time. */}
        {s.extra && (
          <span className="extra-flag" aria-hidden="true">
            EXTRA
          </span>
        )}
        </div>
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
              <span className="in-count">
                <RollText text={countLine(s)} />
              </span>
              <SpotDots names={names} me={g.me?.name} celebrate={celebrating} />
            </div>
          )}
          {showCount && <NamesLine names={names} me={g.me?.name} everyone={everyone} />}
          {!s.canceled && !waiting && (
            <NamesLine names={s.waitlist.map((w) => w.name)} me={g.me?.name} everyone={everyone} label={courtWait ? 'Standby' : 'Waitlist'} />
          )}
          {waiting && !s.canceled && <p className="sched-sub">You're in if someone drops.</p>}
          {/* Only for someone who was in (or waiting on) the game: nobody else paid for it. */}
          {s.canceled && (inSession || waiting) && mine.lateFee?.kind === 'canceled_late' ? (
            <p className="sched-sub" data-late-fee>
              Canceled late. {mine.lateFee.oweCents > 0 ? `You still owe ${formatPrice(mine.lateFee.oweCents)}.` : `Your ${formatPrice(g.group.priceCents)} stays on this game.`}
            </p>
          ) : (
            s.canceled && (inSession || waiting) && mine.paymentStatus !== 'not_applicable' && <p className="sched-sub">If you paid, it's now your credit.</p>
          )}

          {s.extra && <span className="sr-only">Extra game</span>}
          {s.note && (s.note.trim().length <= NOTE_PILL_MAX ? <span className="game-note note-pill">{s.note.trim()}</span> : <p className="game-note note-box">{s.note}</p>)}
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

      {celebrating && motion && <Burst />}
      <ConfirmDialog
        open={askOut}
        title={waiting ? (courtWait ? 'Leave standby?' : 'Leave the waitlist?') : `Out for ${suggestDay(s.startsAt, tz, nowMs).word}?`}
        body={
          waiting
            ? 'You lose your place in line.'
            : mine?.lateDrop
              ? // Past the cancel-by with late fees on: what this drop costs (shared/lateFees.ts rule 9).
                lateDropDialogText(
                  formatTime(mine.lateDrop.cancelByAt, tz),
                  mine.lateDrop.owes,
                  formatPrice(mine.lateDrop.feeCents),
                  mine.dropCreditCents + mine.dropCashCents > 0 ? `your ${formatPrice(mine.dropCreditCents + mine.dropCashCents)} comes back as credit` : null,
                )
              : 'Your spot opens up for someone else.'
        }
        confirmLabel={waiting ? (courtWait ? 'Leave standby' : 'Leave waitlist') : fromNotice ? "Can't make it" : 'Drop out'}
        danger
        busy={busy}
        onConfirm={() => {
          // From the notice the banner never says "dropped out": "You're out. $14 credit returned." (same money words).
          const lead = fromNotice ? "You're out." : undefined;
          setFromNotice(false);
          if (waiting) void run('withdraw', () => "You're off the list");
          else dropOut(lead);
        }}
        onCancel={() => {
          setFromNotice(false);
          setAskOut(false);
        }}
      />
    </article>
  );
}
