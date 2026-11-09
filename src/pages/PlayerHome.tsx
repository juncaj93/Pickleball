import { actingWhoChanged, InstantContext, markPressed, useInstant, useInstantRoot, useInstantTracker } from '../InstantTaps';
import { declinePatch, iPaidPatch, leaveWaitlistPatch } from '../playerPatches';
import { createContext, Fragment, type ReactNode, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { DEFAULT_ZELLE_NUMBER, SITE_NAME } from '../../shared/settings';
import type { GroupView, PlayerSessionView } from '../../shared/api';
import { formatPrice, parseVenmoHandle, venmoNote, venmoPayUrl } from '../../shared/money';
import { NO_VENMO_STAY_MS, noVenmoMessage, watchVenmoLaunch } from '../venmoFallback';
import { creditBackNote } from '../../shared/pricing';
import { formatTime, DEFAULT_TIMEZONE, playerDay, suggestDay, wantInSubline, wantInTitle, formatMonthDay, formatShortDate, cardTime, cardTimeText, formatTimeRange, formatWeekday, localParts, ordinal, weekTier, type WeekTier } from '../../shared/time';
import { creditHintText, creditUsedMessage, droppedText, joinedCreditText } from '../../shared/credit';
import { adjustedPlayerLine, latestAdjustment, signedPrice } from '../../shared/adjustCredit';
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
import { BANNER_TIMING, CalendarPlusIcon, ConfirmDialog, Empty, ErrorState, FilterIcon, NamesLine, Notice, Pickleball, ScheduleSkeleton, Sheet, SpotDots, Spinner, useToast } from '../ui';
import { useZip7Root } from '../zip7';
import { AcBalls, AlertCard } from '../AlertCard';
import { afterGameCard, oweMoreText } from '../../shared/afterGame';
import { tileDay, type TileDay } from '../../shared/zip7';
import { canMove, motionOn, rememberedMotion, rememberMotion, RollText, setMotion, useJustChanged, useLingering, useMotion, usePullToRefresh, useStatusMorph } from '../motion';
import { courtStatus } from '../../shared/court';
import { OrganizerLink } from './SiteHome';
import '../credit-player.css';
import '../player-cards.css';
import '../motion.css';
import { BLOCKED_CODE, blockSheet, NUDGE_TOAST_MS, nudgeState, nudgeToast, oweLine, oweTitle, type NudgeState } from '../../shared/unpaidNudge';
import { registerCant, TileBorders, TimeBars, tsClass, tsKind, tsTime, useCourtFlip, type TsKind } from '../timeShift';
import { gameCreditBackNote, gameMinutes, lengthWords, viewFlat, viewPrice } from '../../shared/gameLength';
import { CalendarDirections } from '../CardButtons';
import { GameDayButtons, isGameDayCard } from '../GameDay';
import { asOfText, clearLastScreen, measureLayout, readLastScreen, saveLastScreen, type SavedScreen } from '../lastScreen';
import { navigate, rememberDirectLoad, takeEarly } from '../lib';

/** The flat price of one game on this screen: a 1.5 hour game's own when the server priced it so ("Short games"), else the group's. */
function flatOfGame(g: GroupView | null | undefined, sessionId: string): number {
  if (!g) return 0;
  return viewFlat(g.sessions.find((x) => x.id === sessionId) ?? {}, g.group.priceCents);
}

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
  // Instant taps (INSTANT_TAPS): a poll that set off before a save never draws over it, and certain taps still saving are drawn in.
  const tracker = useInstantTracker();
  // "Load games at once" (SPEED_DIRECT_LOAD, src/lib.ts): on the plain address the first answer may already be on its way.
  // An early answer that is an error (no name, a group word needed, the link changed...) is never used: the page asks again, as today.
  const load = useLoad(
    () => (plain && !viewAs ? takeEarly<GroupView>('group')?.catch(() => api<GroupView>('GET', '/api/group')) : null) ?? api<GroupView>('GET', '/api/group'),
    [groupKey, viewAs?.id, pretend, demo],
    tracker,
  );
  const instant = useInstantRoot(load.data?.instantTaps === true, load.data, load.reload, tracker);
  useRefreshOnReturn(load.refresh);
  const [switching, setSwitching] = useState(false);
  const [showAll, setShowAll] = useState(false);
  // "Home collapse" (HOME_COLLAPSE): the later games' one button. Closed on every page load, never remembered.
  const [laterOpen, setLaterOpen] = useState(false);
  // Show fewer tapped on a list that a shared link opened: the link's game no longer holds it open.
  const [laterFolded, setLaterFolded] = useState(false);
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

  // ---- Zip 12 speed switches (server/speed.ts). Never in View as, the demo or Pretend. ----
  const ownPhone = !viewAs && !demoOn() && !pretend;
  const savedPage = groupKey ?? 'plain';
  // "Show last screen at once": the copy this phone kept last time (no money in it), drawn with every button held until the
  // first fresh answer lands (src/lastScreen.ts). Read once per page open.
  const [saved] = useState<SavedScreen | null>(() => (ownPhone ? readLastScreen(savedPage) : null));
  // When the answer on screen arrived (the copy's "as of" time), and the answer itself, for the save made when the page is left.
  const fresh = useRef<{ at: number; data: GroupView } | null>(null);
  useEffect(() => {
    if (!load.data || !ownPhone) return;
    fresh.current = { at: Date.now(), data: load.data };
    // Each fresh answer says whether the switches are on; the phone follows it (off: the copy and the memory are dropped).
    rememberDirectLoad(load.data.directLoad === true);
    // The sizes are read after the screen is drawn (an effect runs after the draw).
    saveLastScreen(savedPage, load.data, Date.now(), undefined, measureLayout());
  }, [load.data, ownPhone, savedPage]);
  // Leaving the page (another app, the phone locked, closed): the copy keeps the screen's sizes as they are at that moment.
  useEffect(() => {
    if (!ownPhone) return undefined;
    const keep = () => {
      if (document.visibilityState === 'hidden' && fresh.current && !switchingRef.current) saveLastScreen(savedPage, fresh.current.data, fresh.current.at, undefined, measureLayout());
    };
    document.addEventListener('visibilitychange', keep);
    window.addEventListener('pagehide', keep);
    return () => {
      document.removeEventListener('visibilitychange', keep);
      window.removeEventListener('pagehide', keep);
    };
  }, [ownPhone, savedPage]);
  // This address now answers "link not working", "group word needed" or "link only": the copy must not show again.
  useEffect(() => {
    if (load.error && (load.error.status === 403 || load.error.status === 404)) {
      clearLastScreen();
      // And never saved again from the answer still in memory (leaving the page would otherwise bring the copy back).
      fresh.current = null;
    }
  }, [load.error]);
  // "not you?": a copy kept for this name must never show for another.
  const switchingRef = useRef(false);
  switchingRef.current = switching;
  useEffect(() => {
    if (switching) clearLastScreen();
  }, [switching]);

  const g = instant.view;
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
  // Zip 7 switches (Tonight glow, Color cleanup, Simpler player cards): <html> attributes, only while their answer is yes.
  useZip7Root(g);
  // Preview only (g.preview exists only where PREVIEW_CALM is set, never on live): ?as=Harper opens the page as that fake player, the same
  // as picking the name on Who are you?. On live the server never says preview, so the link does nothing.
  const asTried = useRef(false);
  useEffect(() => {
    if (!g || g.preview !== true || viewAs || asTried.current) return;
    const want = new URLSearchParams(window.location.search).get('as')?.trim().toLowerCase();
    if (!want) return;
    asTried.current = true;
    const url = new URL(window.location.href);
    url.searchParams.delete('as');
    window.history.replaceState(window.history.state, '', url.toString());
    const p = g.players.find((x) => x.name.toLowerCase() === want) ?? g.players.find((x) => x.name.toLowerCase().split(/\s+/)[0] === want);
    if (!p || g.me?.id === p.id) return;
    void api('POST', '/api/me', { playerId: p.id })
      .then(() => load.quiet())
      .catch(() => {});
  }, [g, viewAs, load]);
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
    // The saved screen was already showing: the fresh one simply takes its place, without the first-load cascade.
    if (!canMove() || savedShownRef.current) {
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
  const savedShownRef = useRef(false);
  const swapRef = useRef<Map<string, PlayerSessionView> | null | undefined>(undefined);
  const [swapOver, setSwapOver] = useState(false);
  const hasData = !!g;
  useEffect(() => {
    if (!hasData || !savedShownRef.current) return undefined;
    const t = setTimeout(() => setSwapOver(true), 2500);
    return () => clearTimeout(t);
  }, [hasData]);
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
    const notices: { msg: string; ball?: boolean; ok?: boolean }[] = [];
    if (cash.show) notices.push({ msg: `${g.group.organizerName ?? 'The organizer'} sent your ${formatPrice(cash.show.cents)}`, ...(g.alertCards === true ? { ok: true } : {}) });
    if (plan.now.length) notices.push({ msg: `Game on! ${plan.now[0].confirmed.length} in`, ball: true });
    // Zip 11, Alert cards: "Alex sent your $10" carries an OK (it only closes the banner, which still goes by itself).
    const optsOf = (n: { ball?: boolean; ok?: boolean }) => (n.ok ? { ball: n.ball, action: { label: 'OK', onClick: () => {} } } : { ball: n.ball });
    // Not cleaned up on purpose: the memory above is already saved, so a repeat of this effect must not cancel them.
    notices.forEach((n, i) => (i === 0 ? toast(n.msg, 'ok', optsOf(n)) : setTimeout(() => toast(n.msg, 'ok', optsOf(n)), i * NOTICE_GAP_MS)));
    const first = firstPlan.current;
    firstPlan.current = false;
    if (plan.now.length && !(motionOn() && first)) {
      const ids = new Set(plan.now.map((x) => x.id));
      setCelebrating(ids);
      setTimeout(() => setCelebrating((cur) => (cur === ids ? new Set() : cur)), CELEBRATE_MS);
    }
  }, [g, switching, viewAs, toast]);
  // Zip 17, Unpaid nudge (shared/unpaidNudge.ts): null when off (every line below then does exactly what it did). Counted from the
  // screen's own owed money, the same numbers as the owe card; the server refuses a sign-up at the limit by itself too.
  const nudge = useMemo(() => (view && view.unpaidNudge && view.me ? nudgeState(view.owed, Date.parse(view.now), view.unpaidNudge.limit) : null), [view]);
  const nudgeRef = useRef(nudge);
  nudgeRef.current = nudge;
  const [nudgePay, setNudgePay] = useState(false);
  const [blockOpen, setBlockOpen] = useState(false);
  const blockFallback = useRef<string | null>(null);
  const nudgeApi = useMemo<NudgeApi | null>(
    () =>
      nudge
        ? {
            state: nudge,
            openBlock: (fallback) => {
              blockFallback.current = fallback ?? null;
              setBlockOpen(true);
            },
          }
        : null,
    [nudge],
  );
  // A refusal from the server that the screen did not see coming (an older screen): once fresh data says blocked the sheet shows; if
  // it still does not, the server's own words show as a toast instead.
  useEffect(() => {
    if (!blockOpen || nudge?.blocked) return;
    setBlockOpen(false);
    if (blockFallback.current) toast(blockFallback.current, 'error');
    blockFallback.current = null;
  }, [blockOpen, nudge, toast]);
  // "Use the $10 you asked to cash out for this game?" after I'm in, only when it matters (the server decides).
  const [cashOut, setCashOut] = useState<{ sessionId: string; cents: number; requestCents?: number } | null>(null);
  /** My own tap on I'm in / Yes: "Game on!" when it completed the 4th player, else "You're in". */
  const joinToast = useCallback(
    (sessionId: string, before: number, res: JoinResponse, noCourt = false) => {
      const offer = res.cashOutOffer && res.cashOutOffer.cents > 0 ? res.cashOutOffer : null;
      // "$11 due" is said only where the card shows it: a booked court, or "Ask for payment on every game" is on.
      const showDue = !noCourt || !!g?.payAlways;
      // Zip 17, Unpaid nudge: in, with 1 or 2 unpaid games before this one: the longer "Please pay" toast takes the banner's place.
      const owes = nudgeRef.current;
      const nudgeNow = !offer && res.result === 'confirmed' && !!owes && owes.count > 0 && !owes.blocked;
      if (res.result === 'confirmed' && before + 1 >= MIN_PLAYERS) {
        // I was there for it, so the card does not celebrate again later.
        markCelebrated(sessionId);
        if (before + 1 === MIN_PLAYERS && !offer) {
          burst(sessionId);
          if (!nudgeNow) return toast(joinedCreditText('Game on!', res.creditCents ?? 0, flatOfGame(g, sessionId), showDue), 'ok', { ball: true });
        }
      }
      // The cash-out question sits where the banner would; the card already says "You're in".
      if (offer) return setCashOut({ sessionId, cents: offer.cents, requestCents: offer.requestCents });
      if (nudgeNow) {
        const t = nudgeToast(owes!.count, owes!.cents);
        return toast(t.title, 'ok', { sub: t.sub, nudge: true, stayMs: NUDGE_TOAST_MS, action: { label: 'Pay', onClick: () => setNudgePay(true) } });
      }
      toast(joinedText(res, noCourt, flatOfGame(g, sessionId), showDue));
    },
    [toast, markCelebrated, burst, g, g?.payAlways],
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
  // "Home collapse" (HOME_COLLAPSE): THIS WEEK and NEXT WEEK as they are; every later game behind one button. A game opened from a shared
  // link that is a later game opens the fold so the link still lands on it.
  const recentAdjustment = view && g ? latestAdjustment(view.credit.history, Date.parse(g.now)) : null;
  const collapse = g?.homeCollapse === true;
  const isLater = (s: PlayerSessionView) => weekTier(s.startsAt, Date.parse(g!.now), g!.group.timezone) === 'later';
  const laterGames = collapse && g ? filtered.filter(isLater) : [];
  const laterShown = laterOpen || (!laterFolded && focusIndex >= 0 && laterGames.some((s) => s.id === focusId));
  const shownSessions = collapse
    ? filtered.filter((s) => !isLater(s) || laterShown)
    : showAll || focusIndex >= SHOW_FIRST
      ? filtered
      : filtered.slice(0, SHOW_FIRST);
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
        <TopBar eyebrow="" title="Link not working" />
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
  // The saved copy shows only until the first fresh answer (or while that first answer failed: then with its error under it).
  const showSaved = !g && !!saved && saved.view.sessions.length > 0;
  if (showSaved) savedShownRef.current = true;
  // The first fresh screen after the saved copy: each card is told how the copy drew it, so only what changed fades in (for 2.5 seconds).
  if (g && swapRef.current === undefined) swapRef.current = savedShownRef.current && saved ? new Map(saved.view.sessions.map((s) => [s.id, s])) : null;
  const swapFrom = swapOver ? null : (swapRef.current ?? null);
  const showChip = !!g && !!credit && !pickName && (credit.balanceCents > 0 || !!credit.pending);
  const chipStart = lastBalance.current;


  return (
    <InstantContext.Provider value={instant.store}>
      {/* "View as...": a small bar of its own above the player's real screen. */}
      {viewAs && g?.alertCards === true && (
        <div className="demo-bars">
          {topBar}
          {/* Zip 11, Alert cards: the same bar, drawn as a gray card with Exit on the right. */}
          <div className="viewas-banner ac-viewas" role="region" aria-label="Viewing as a player">
            <AlertCard
              as="div"
              tone="gray"
              icon="person"
              title={
                <>
                  Viewing as <strong>{viewAs.name}</strong>
                </>
              }
              action={
                <button type="button" className="ac-btn ac-out" onClick={onExit}>
                  Exit
                </button>
              }
            />
          </div>
        </div>
      )}
      {viewAs && g?.alertCards !== true && (
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
        // Zip 18: no small group-name label over the name (for everyone); the name sits centered against the logo tile.
        eyebrow=""
        // Swap to Alex (Zip 18): on the organizer's own player page (the server says so only for a phone signed in as the organizer
        // showing the organizer's own name), "Alex" + the gray swap icon is one button to Admin. Never in View as, never for a player.
        onTitle={g?.goToAdmin === true && !viewAs && !pickName ? { onClick: () => navigate('/admin'), label: `${g.me?.name ?? 'You'}. Go to Admin` } : undefined}
        title={!g ? (showSaved ? saved!.view.me!.name : SITE_NAME) : pickName ? 'Who are you?' : (g.me?.name ?? viewAs?.name ?? SITE_NAME)}
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
      <main ref={mainRef} className={`page stack-lg${cascade ? ' m-cascade' : ''}`} data-sw-main={swapFrom ? '' : undefined}>
        <NudgeContext.Provider value={nudgeApi}>
        {/* Pull to refresh: the ball that shows in the gap the list leaves (motion only). */}
        {motion && (
          <div ref={ptrBall} className="m-ptr" aria-hidden="true">
            <Pickleball />
          </div>
        )}
        {showSaved && <SavedScreenView saved={saved!} />}
        {load.loading && !g && !load.error && !showSaved && <ScheduleSkeleton />}
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
            {/* Preview only (shared/previewCalm.ts): the alert cards stay hidden unless the phone opened ?alerts=all. */}
            {g.previewCalm !== true && (
            <>
            <TimeBars
              view={view!}
              onChanged={load.reload}
              onShowAll={() => {
                // Can't make it on a game further down than the list shows: show it, then its drop question opens.
                setShowAll(true);
                setLaterOpen(true);
                setLaterFolded(false);
                setFilter('all');
              }}
            />
            <FeeNotices g={view!} />
            {view!.payDue.length > 0 && <PayCard g={view!} onChanged={load.reload} enter={live} />}
            {/* Zip 16 (AFTER_GAME_CARD): "$5 back to your credit" after Finalize, once, until closed or 7 days old. */}
            {g.afterGameCard === true && <AfterGameCard g={view!} />}
            {/* The organizer's hand adjustment to this player's credit (recent ones): always told, even with no pay card and no credit chip (credit taken to $0). */}
            {view!.payDue.length === 0 && recentAdjustment && g.alertCards === true && <AdjustedCard adj={recentAdjustment} />}
            {view!.payDue.length === 0 && recentAdjustment && g.alertCards !== true && (
              <p className="credit-adjusted" data-adjust-note data-adjust-home>
                <b>{adjustedPlayerLine(recentAdjustment.deltaCents)}</b>
                {recentAdjustment.note && <span>{recentAdjustment.note}</span>}
              </p>
            )}
            {answered && g.alertCards === true ? (
              <AlertCard
                as="section"
                tone="green"
                icon="ok"
                label="Your answer"
                title={answered.text}
                sub={`${formatShortDate(answered.startsAt, tz)} · ${cardTimeText(answered.startsAt, answered.endsAt, tz, g.group.usualMinutes)}`}
                data={{ 'data-suggest-answer': true }}
                action={
                  <button type="button" className="ac-btn ac-out" onClick={() => setAnswered(null)}>
                    Done
                  </button>
                }
              />
            ) : answered ? (
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
            </>
            )}
            {/* Preview only (calm): just the cards the zips being built change: the owe card (Unpaid nudge on, or it owes more after Finalize) and the after-game card. */}
            {g.previewCalm === true && view!.payDue.length > 0 && (nudge || (g.afterGameCard === true && view!.payDue.every((o) => !!o.more))) && <PayCard g={view!} onChanged={load.reload} enter={live} />}
            {g.previewCalm === true && g.afterGameCard === true && <AfterGameCard g={view!} />}
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
                      prev={swapFrom ? (swapFrom.get(s.id) ?? null) : undefined}
                      leaving={leaving}
                    />
                  </Fragment>
                );
              })}
            </div>
            {collapse
              ? laterGames.length > 0 && (
                  <button
                    className="btn ghost block"
                    data-later-toggle
                    aria-expanded={laterShown}
                    onClick={(e) => {
                      const btn = e.currentTarget;
                      setLaterOpen(!laterShown);
                      setLaterFolded(laterShown);
                      // Folding a long list leaves the button where the list was: bring it back into view.
                      if (laterShown) requestAnimationFrame(() => btn.scrollIntoView({ block: 'nearest' }));
                    }}
                  >
                    {laterShown ? 'Show fewer' : 'More sessions'}
                  </button>
                )
              : filtered.length > SHOW_FIRST && (
                  <button className="btn ghost block" onClick={() => setShowAll((v) => !v)}>
                    {showAll ? 'Show fewer' : `More sessions (${filtered.length - SHOW_FIRST})`}
                  </button>
                )}
            {/* The end of the page: just a thin line and a little space. */}
            <div className="page-end" aria-hidden="true" />
            {/* Zip 18: the "Go to Admin" pill that was here is gone; the title (Alex + swap icon) at the top replaces it. */}
          </>
        )}
        {/* Organizer sign-in only on "Who are you?", never under the schedule. */}
        {plain && !viewAs && pickName && <OrganizerLink />}
        </NudgeContext.Provider>
      </main>
      {cashOut && (
        <CashOutPrompt
          key={cashOut.sessionId}
          sessionId={cashOut.sessionId}
          cents={cashOut.cents}
          onClose={() => setCashOut(null)}
          onChanged={load.reload}
          {...(g?.alertCards === true ? { card: { requestCents: cashOut.requestCents ?? cashOut.cents, organizer: firstNameOf(g.group.organizerName) } } : {})}
        />
      )}
      {/* Zip 17, Unpaid nudge: the sheet at the limit, and the Pay sheet for the unpaid games (the toast's Pay and "Pay $42"). */}
      {nudge && nudge.count > 0 && view && (
        <>
          <BlockSheet
            open={blockOpen && nudge.blocked}
            state={nudge}
            onClose={() => setBlockOpen(false)}
            onPay={() => {
              setBlockOpen(false);
              setNudgePay(true);
            }}
          />
          <NudgePay key={nudge.games.map((o) => o.sessionId).join('_')} g={view} games={nudge.games} open={nudgePay} onClose={() => setNudgePay(false)} onChanged={load.reload} />
        </>
      )}
      {g && credit && <CreditSheet open={creditOpen && showChip} credit={credit} tz={tz} organizerName={g.group.organizerName ?? 'Alex'} nowIso={g.now} onClose={() => setCreditOpen(false)} onChanged={load.reload} />}
    </InstantContext.Provider>
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
    // Instant taps: a save still waiting in line belongs to the old name too; it is not sent as the new one.
    actingWhoChanged();
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

/** "Alex" from the organizer's saved name (the first word), or "the organizer". */
function firstNameOf(name: string | null | undefined): string {
  return (name ?? '').trim().split(/\s+/)[0] || 'the organizer';
}

/** Hand adjustments to this player's credit this phone closed with the X (Zip 11, Alert cards). Remembered on this phone only. */
const ADJUST_SEEN_KEY = 'pb_adjust_seen';
function readAdjustSeen(): string[] {
  try {
    const v = JSON.parse(storageGet(ADJUST_SEEN_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * Zip 11, Alert cards: "Credit adjusted: +$5" with Alex's reason under it, in blue (credit), and a small X. The X hides this one
 * adjustment on this phone (a newer one shows again); without the switch the line shows as before, with no X.
 */
function AdjustedCard({ adj }: { adj: { deltaCents: number; note: string; at: string } }) {
  const key = `${adj.at}:${adj.deltaCents}`;
  const [seen, setSeen] = useState<string[]>(readAdjustSeen);
  if (seen.includes(key)) return null;
  return (
    <AlertCard
      tone="blue"
      icon="credit"
      title={`Credit adjusted: ${signedPrice(adj.deltaCents)}`}
      sub={adj.note || undefined}
      data={{ 'data-adjust-note': true, 'data-adjust-home': true }}
      onX={() => {
        const next = [...readAdjustSeen().filter((x) => x !== key), key].slice(-50);
        try {
          storageSet(ADJUST_SEEN_KEY, JSON.stringify(next));
        } catch {
          /* it simply shows again next time */
        }
        setSeen(next);
      }}
      xLabel="Credit adjusted"
    />
  );
}

/** Credit records whose after-game card this phone closed with the X (Zip 16). Remembered on this phone only. */
const AFTER_GAME_SEEN_KEY = 'pb_after_game_seen';
function readAfterGameSeen(): string[] {
  try {
    const v = JSON.parse(storageGet(AFTER_GAME_SEEN_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * Zip 16, "After-game cards" (shared/afterGame.ts): "$5 back to your credit" / "Tue, Nov 3: final price $9 (6 played)", blue, with an X.
 * The amount is the sum of the credit records Finalize wrote (sent as they are by the server), never worked out again here. Two or more
 * games: one card. The X hides those records on this phone (a newer one shows again); 7 days after the credit it goes by itself.
 * Closing it changes no money.
 */
function AfterGameCard({ g }: { g: GroupView }) {
  const tz = g.group.timezone;
  const [seen, setSeen] = useState<string[]>(readAfterGameSeen);
  const card = afterGameCard(g.afterGame, seen, Date.parse(g.now), (iso) => formatShortDate(iso, tz), formatPrice);
  if (!card) return null;
  const close = () => {
    const next = [...readAfterGameSeen().filter((x) => !card.ids.includes(x)), ...card.ids].slice(-50);
    try {
      storageSet(AFTER_GAME_SEEN_KEY, JSON.stringify(next));
    } catch {
      /* it simply shows again next time */
    }
    setSeen(next);
  };
  const data = { 'data-after-game': true, 'data-after-game-cents': String(card.cents) };
  if (g.alertCards === true) {
    return <AlertCard as="section" tone="blue" icon="credit" label="Credit back" title={card.title} sub={card.sub} data={data} onX={close} xLabel={card.title} />;
  }
  return (
    <div className="fee-notice" {...data}>
      <Notice tone="ok">
        <span className="fee-notice-row">
          <span>
            <b>{card.title}</b> · {card.sub}
          </span>
          <button type="button" className="btn small ghost" aria-label={`Dismiss: ${card.title}`} data-dismiss onClick={close}>
            Dismiss
          </button>
        </span>
      </Notice>
    </div>
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
  // Zip 11, Alert cards: "You no longer owe $14" with "Someone took your Tue, Nov 3 spot" under it, and Dismiss (same memory).
  if (g.alertCards === true) {
    return (
      <>
        {list.map((n) => {
          const day = formatShortDate(n.startsAt, tz);
          const fee = formatPrice(n.feeCents ?? g.group.priceCents);
          const credit = n.creditCents > 0 ? formatPrice(n.creditCents) : null;
          return (
            <AlertCard
              key={n.id}
              tone="blue"
              icon="ok"
              title={credit ? `Your ${credit} is back as credit` : `You no longer owe ${fee}`}
              // The date never splits across lines, and "spot" stays with it (non-breaking spaces; the same words).
              sub={n.why === 'sub' ? `Someone took your ${day.replace(/ /g, '\u00a0')}\u00a0spot` : `For ${day.replace(/ /g, '\u00a0')}`}
              data={{ 'data-fee-notice': n.why }}
              action={
                <button type="button" className="ac-btn ac-out" onClick={() => dismiss(n.id)}>
                  Dismiss
                </button>
              }
            />
          );
        })}
      </>
    );
  }
  return (
    <>
      {list.map((n) => (
        <div key={n.id} className="fee-notice" data-fee-notice={n.why}>
          <Notice tone="ok">
            <span className="fee-notice-row">
              <span>{feeClearedNotice(n.why, formatShortDate(n.startsAt, tz), formatPrice(n.feeCents ?? g.group.priceCents), n.creditCents > 0 ? formatPrice(n.creditCents) : null)}</span>
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
function usePaid(owed: { sessionId: string; cents: number }[], onChanged: () => Promise<void>, guard = false) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const ids = owed.map((o) => o.sessionId);
  // `guard` is PLAYER_FIX1: only then can the same game have buttons in two places, so only then do they take turns.
  const blocked = useMoneyInFlight(guard ? ids : []);
  const instant = useInstant<GroupView>();
  async function set(paid: boolean) {
    if (guard && ids.some((id) => inFlight.has(id))) return;
    if (instant) {
      // Instant taps (INSTANT_TAPS): "I paid" is certain, so the card reads Paid at once and the Pay card goes; a failed save puts it
      // back. "Didn't pay?" leaves the amount to the server: the button shows it is working until the answer.
      const done = guard ? moneyStarted(ids) : () => {};
      // One tap can cover several games (the "Tonight: you owe" card): if some went through and then one failed, say so plainly.
      let went = 0;
      await instant.run({
        key: `paid:${ids.join(',')}`,
        patch: paid ? iPaidPatch(ids) : null,
        save: async () => {
          for (const o of owed) {
            await api('POST', `/api/sessions/${o.sessionId}/paid`, paid ? { paid, cents: o.cents } : { paid });
            went++;
          }
        },
        saved: paid ? 'Marked paid' : 'Marked not paid',
        what: paid ? 'I paid' : "Didn't pay",
        failText: () => (went > 0 ? `Saved for ${went} of ${owed.length} games; the rest didn't save. Tap again.` : null),
      });
      done();
      return;
    }
    const done = guard ? moneyStarted(ids) : () => {};
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
  // `busy` is this button's own "Saving…"; `blocked` only disables (the other card is saving this game).
  return { busy, blocked, set };
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

/**
 * PAY_SHEET: the small bottom sheet a Pay button opens. Title with the amount, the Venmo app link (the same link Pay always
 * had), a button that copies the organizer's Venmo handle (so nobody is left on an "invalid address" page), one gray line for
 * Apple Pay / Zelle / cash, and "I paid" (the same action as the card's own). Nothing else.
 */
function PaySheet({
  g,
  open,
  onClose,
  cents,
  pay,
  onTapPay,
  onPaid,
  busy,
  saving,
}: {
  g: GroupView;
  open: boolean;
  onClose: () => void;
  cents: number;
  pay: { url: string | null; appUrl: string | null };
  onTapPay: () => void;
  onPaid: () => void;
  /** Something about this game is being saved (the button is off). */
  busy: boolean;
  /** This button's own save (its label says so). */
  saving: boolean;
}) {
  const toast = useToast();
  const first = (g.group.organizerName ?? '').trim().split(/\s+/)[0] || 'the organizer';
  const parsed = parseVenmoHandle(g.group.venmoUrl);
  const handle = parsed.ok && parsed.handle && !parsed.handle.startsWith('id:') ? parsed.handle : null;
  const zelle = (g.group.zelleNumber ?? DEFAULT_ZELLE_NUMBER).trim();
  return (
    <Sheet open={open} title={`Pay ${first} ${formatPrice(cents)}`} onClose={onClose}>
      <div className="pay-sheet" data-pay-sheet>
        <div className="pay-pair">
          <a
            className="btn"
            href={pay.url ?? undefined}
            data-app-href={pay.appUrl ?? undefined}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Pay ${formatPrice(cents)} with the Venmo app`}
            onClick={(e) => {
              onTapPay();
              openVenmo(e, pay);
            }}
          >
            Have the Venmo app? Click here
          </a>
          {handle && (
            <button
              className="btn outline"
              data-copy-venmo
              onClick={async () => {
                onTapPay();
                const copied = await copyText(`@${handle}`);
                toast(copied ? `Copied @${handle}` : "Couldn't copy.", copied ? 'ok' : 'error');
              }}
            >
              Copy Venmo @{handle}
            </button>
          )}
        </div>
        {zelle && <p className="pay-alt">No Venmo? Apple Pay or Zelle {zelle}, or cash.</p>}
        <button className="btn paid-soft" data-sheet-paid disabled={busy} onClick={onPaid}>
          {!saving && (
            <svg className="paid-check" viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
              <path d="M4.5 10.5l3.5 3.5 7.5-8" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
          {saving ? 'Saving…' : 'I paid'}
        </button>
      </div>
    </Sheet>
  );
}

/** Zip 17, Unpaid nudge: what the game cards and the Want in card read (null: the switch is off, and they do exactly what they did). */
interface NudgeApi {
  state: NudgeState<GroupView['owed'][number]>;
  /** The "You owe $42" sheet. `fallback`: the server's words, shown as a toast if fresh data does not say blocked. */
  openBlock: (fallback?: string) => void;
}
const NudgeContext = createContext<NudgeApi | null>(null);
const useNudge = () => useContext(NudgeContext);

/**
 * I'm in. With the Unpaid nudge on and this screen already showing the balance paid (an I paid whose saves are still on their way), a
 * refusal at the limit is waited out once (1.5 seconds) before it counts. Off (`retry` false): exactly one request, as before.
 */
async function nudgeJoin(sessionId: string, retry: boolean): Promise<JoinResponse> {
  try {
    return await api<JoinResponse>('POST', `/api/sessions/${sessionId}/join`, {});
  } catch (err) {
    if (!retry || !(err instanceof ApiError) || err.code !== BLOCKED_CODE) throw err;
    await new Promise((r) => setTimeout(r, 1500));
    return api<JoinResponse>('POST', `/api/sessions/${sessionId}/join`, {});
  }
}

/** At the limit: "You owe $42" / "For your last 3 games. Once it's paid, you can sign up again." / Pay $42 / Not now (the site's own sheet). */
function BlockSheet({ open, state, onClose, onPay }: { open: boolean; state: NudgeState; onClose: () => void; onPay: () => void }) {
  const t = blockSheet(state.count, state.cents);
  return (
    <Sheet open={open} title={t.title} onClose={onClose} className="nudge-block" hideClose>
      <div className="nudge-sheet" data-nudge-sheet>
        <p className="nudge-line">{t.line}</p>
        <button type="button" className="btn big block nudge-pay" data-nudge-pay onClick={onPay}>
          {t.pay}
        </button>
        <button type="button" className="btn block nudge-later" data-nudge-later onClick={onClose}>
          Not now
        </button>
      </div>
    </Sheet>
  );
}

/**
 * The Pay sheet (the site's own, PAY_SHEET) for just the unpaid games: the toast's Pay and the block sheet's "Pay $42". The same Venmo
 * link, note and I paid as the owe card's Pay, with the amounts the owe card shows for those games. I paid marks those games paid
 * (waiting for the organizer, like every I paid), so a blocked player can sign up again at once.
 */
function NudgePay({ g, games, open, onClose, onChanged }: { g: GroupView; games: GroupView['owed']; open: boolean; onClose: () => void; onChanged: () => Promise<void> }) {
  const tz = g.group.timezone;
  const total = games.reduce((sum, o) => sum + o.amountCents, 0);
  const note = venmoNote(
    games.map((o) => o.startsAt),
    tz,
    g.me?.name,
  );
  const pay = venmoPayUrl(g.group.venmoUrl, total, note);
  const paid = usePaid(games.map((o) => ({ sessionId: o.sessionId, cents: o.amountCents })), onChanged, !!g.playerFix1);
  const payTap = usePayTapped(games.map((o) => o.sessionId).join('_'), g.playerFix1 ? games.map((o) => o.sessionId) : []);
  // The owe card's own rule: the Pay sheet only while it is on and a Venmo link is saved. Otherwise Pay brings the owe card into view
  // (its own Pay or I paid), so the Settings Apple Pay / Zelle number and a missing Venmo link are never guessed here.
  const sheetOn = !!g.paySheet && !!pay.url;
  useEffect(() => {
    if (!open || sheetOn) return;
    onClose();
    document.querySelector('[data-pay-card]')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [open, sheetOn, onClose]);
  if (!sheetOn) return null;
  return (
    <PaySheet
      g={g}
      open={open}
      onClose={onClose}
      cents={total}
      pay={pay}
      onTapPay={payTap.mark}
      busy={paid.busy || paid.blocked}
      saving={paid.busy}
      onPaid={() => {
        onClose();
        void paid.set(true);
      }}
    />
  );
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
    () => 0,
  );
  return ids.some((id) => inFlight.has(id));
}

/**
 * "Use credit": takes the player's credit off the games they owe for, only
 * when they tap. One call per game, earliest first; it stops when a call fails
 * or the credit is used up.
 */
function useCredit(onChanged: () => Promise<void>, gameIds: string[] = [], guard = false) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const blocked = useMoneyInFlight(guard ? gameIds : []);
  const instant = useInstant();
  // Set at once (state waits for a redraw), so a quick second tap is ignored instead of flashing an error.
  const working = useRef(false);
  async function use(sessionIds: string[], owedCents: number, potCents: number) {
    if (working.current || (guard && sessionIds.some((id) => inFlight.has(id)))) return;
    working.current = true;
    const done = guard ? moneyStarted(sessionIds) : () => {};
    setBusy(true);
    const release = holdLive();
    // Instant taps (INSTANT_TAPS): the server decides how much credit goes where, so the tapped button shows it is working.
    const unmark = instant ? markPressed() : () => {};
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
      unmark();
      if (used > 0) toast(creditUsedMessage(used, potBefore, owedBefore));
      else toast('No credit to use right now.');
      await onChanged();
    } catch (err) {
      if (isDemo(err)) toast(err.message);
      else toast(err instanceof ApiError ? err.message : 'That did not work. Try again.', 'error');
      await onChanged();
    } finally {
      unmark();
      working.current = false;
      setBusy(false);
      done();
      release();
    }
  }
  /** "Undo" under "Paid with credit": the credit goes back, the game is owed again. */
  async function undo(sessionId: string) {
    if (working.current || (guard && inFlight.has(sessionId))) return;
    working.current = true;
    const done = guard ? moneyStarted([sessionId]) : () => {};
    setBusy(true);
    const release = holdLive();
    const unmark = instant ? markPressed() : () => {};
    try {
      await api('POST', `/api/sessions/${sessionId}/undo-credit`, {});
      unmark();
      toast('Credit put back');
      await onChanged();
    } catch (err) {
      if (isDemo(err)) toast(err.message);
      else toast(err instanceof ApiError ? err.message : 'That did not work. Try again.', 'error');
      await onChanged();
    } finally {
      unmark();
      working.current = false;
      setBusy(false);
      done();
      release();
    }
  }
  return { busy, blocked, use, undo };
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
  const paid = usePaid(due.map((o) => ({ sessionId: o.sessionId, cents: o.amountCents })), onChanged, !!g.playerFix1);
  const credit = useCredit(onChanged, due.map((o) => o.sessionId), !!g.playerFix1);
  // PLAYER_FIX1 on: tonight's game card has its own Pay too, so a tap here also counts for each game's own card.
  const payTap = usePayTapped(due.map((o) => o.sessionId).join('_'), g.playerFix1 ? due.map((o) => o.sessionId) : []);
  const watchNoVenmo = useNoVenmoNote(g.group.organizerName, !!g.payNote);
  // PAY_SHEET: Pay opens a small sheet instead of jumping straight into the Venmo app.
  const [sheet, setSheet] = useState(false);
  const sheetOn = !!g.paySheet && !!pay.url;
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
  const busy = paid.busy || credit.busy || paid.blocked || credit.blocked;
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
  // Zip 17, Unpaid nudge: "You owe $28" / "$14 each: Nov 3 and Nov 5" (one line). Off: the words below, exactly as before.
  const nudgeWords = !!g.unpaidNudge;
  const nudgeLine = nudgeWords ? `${oweLine(due, tz)}${due.length === 1 ? why(due[0]) : ''}` : '';
  const title = nudgeWords
    ? oweTitle(total)
    : due.length > 1
      ? `You owe ${formatPrice(total)} total`
      : tonight && !due[0].lateFee
        ? `Tonight: you owe ${formatPrice(total)}`
        : `You owe ${formatPrice(total)} for ${formatShortDate(due[0].startsAt, tz)}${why(due[0])}`;
  const detail = (o: (typeof due)[number]) =>
    [o.finalized && !o.lateFee ? 'final price' : null, o.creditCents > 0 ? `after your ${formatPrice(o.creditCents)} credit` : null].filter(Boolean).join(', ');
  // (On this card the amounts are already after any credit; each game's own line says what is left.)
  // The organizer's latest hand adjustment to their credit (recent ones only), with the reason.
  const adjustNote = latestAdjustment(g.credit.history, Date.parse(g.now));
  const who = g.group.organizerName ?? 'The organizer';
  // Zip 11, Alert cards: the same card as one amber action card. The same buttons with the same rules: Pay on the right (the Pay
  // sheet or Venmo, exactly as below), and I paid / Use credit as links under the title whenever the card below would show them.
  if (g.alertCards === true) {
    const iPaidLink = (!pay.url || !showCredit || payTap.tapped) && (
      <button type="button" className="ac-link" data-i-paid disabled={busy} onClick={() => paid.set(true)}>
        {paid.busy ? 'Saving…' : 'I paid'}
      </button>
    );
    const creditLink = showCredit && (
      <button type="button" className="ac-link" data-use-credit disabled={busy} onClick={() => credit.use(dueByDate.map((o) => o.sessionId), total, g.credit.usableCents)}>
        {credit.busy ? 'Saving…' : 'Use credit'}
      </button>
    );
    const several = due.length > 1;
    const lateList = several && due.some((o) => o.lateFee || detail(o));
    // Zip 16 (AFTER_GAME_CARD): one game that owes more after Finalize reads "You owe $2 more" / "Tue, Nov 3: final price $11 (5 played)".
    const more = !several ? oweMoreText(due[0], (iso) => formatShortDate(iso, tz), formatPrice) : null;
    return (
      <AlertCard
        as="section"
        tone="amber"
        icon="owe"
        className={enter ? 'm-enter' : ''}
        label="Payment"
        titleAs="h2"
        data={{ 'data-pay-card': true }}
        title={<RollText text={more ? more.title : title} />}
        sub={
          more ? (
            more.sub
          ) : nudgeWords ? (
            <span className="nudge-owe-line" data-nudge-line>
              {nudgeLine}
            </span>
          ) : several ? (
            <>
              {due.length} games
              {lateList && (
                <span className="ac-sub-list">
                  {' · '}
                  {due.map((o) => `${formatShortDate(o.startsAt, tz)}${why(o)} ${formatPrice(o.amountCents)}`).join(', ')}
                </span>
              )}
            </>
          ) : detail(due[0]) ? (
            `${formatPrice(due[0].amountCents)}, ${detail(due[0])}`
          ) : undefined
        }
        links={
          pay.url ? (
            iPaidLink || creditLink ? (
              <>
                {iPaidLink}
                {creditLink}
              </>
            ) : undefined
          ) : creditLink || undefined
        }
        action={
          pay.url ? (
            <a
              className="ac-btn"
              href={pay.url}
              data-app-href={pay.appUrl ?? undefined}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Pay ${formatPrice(total)} with Venmo`}
              data-pay
              onClick={(e) => {
                if (sheetOn) {
                  e.preventDefault();
                  setSheet(true);
                  return;
                }
                payTap.mark();
                watchNoVenmo(pay);
                openVenmo(e, pay);
              }}
            >
              Pay
            </a>
          ) : (
            <button type="button" className="ac-btn" data-i-paid disabled={busy} onClick={() => paid.set(true)}>
              {paid.busy ? 'Saving…' : 'I paid'}
            </button>
          )
        }
      >
        {adjustNote && (
          <p className="ac-sub ac-extra" data-adjust-note>
            <b>Credit adjusted: {signedPrice(adjustNote.deltaCents)}</b>
            {adjustNote.note && <span> · {adjustNote.note}</span>}
          </p>
        )}
        {!pay.url && <p className="ac-sub ac-extra">Pay {who} however you usually do.</p>}
        {pay.url && !pay.prefilled && (
          <div className="ac-sub ac-extra ac-note-row">
            <span>
              Send {formatPrice(total)} with the note <strong>{note}</strong>
            </span>
            <button type="button" className="ac-link" onClick={async () => ((await copyText(note)) ? toast('Note copied') : toast("Couldn't copy the note.", 'error'))}>
              Copy note
            </button>
          </div>
        )}
        {sheetOn && (
          <PaySheet
            g={g}
            open={sheet}
            onClose={() => setSheet(false)}
            cents={total}
            pay={pay}
            onTapPay={payTap.mark}
            busy={busy}
            saving={paid.busy}
            onPaid={() => {
              setSheet(false);
              void paid.set(true);
            }}
          />
        )}
      </AlertCard>
    );
  }
  return (
    <section className={`card pay-card${enter ? ' m-enter' : ''}`} aria-label="Payment">
      <h2>
        <RollText text={title} />
      </h2>
      {nudgeWords ? (
        <p className="small nudge-owe-line" data-nudge-line>
          {nudgeLine}
        </p>
      ) : due.length > 1 ? (
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
      {adjustNote && (
        <p className="small pay-adjusted" data-adjust-note>
          <b>{adjustedPlayerLine(adjustNote.deltaCents)}</b>
          {adjustNote.note && <span>{adjustNote.note}</span>}
        </p>
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
              if (sheetOn) {
                e.preventDefault();
                setSheet(true);
                return;
              }
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
      {sheetOn && (
        <PaySheet
          g={g}
          open={sheet}
          onClose={() => setSheet(false)}
          cents={total}
          pay={pay}
          onTapPay={payTap.mark}
          busy={busy}
          saving={paid.busy}
          onPaid={() => {
            setSheet(false);
            void paid.set(true);
          }}
        />
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
  const instant = useInstant<GroupView>();
  const s = g.suggestion!;
  const tz = g.group.timezone;
  const [busy, setBusy] = useState(false);
  // Zip 17, Unpaid nudge (null when off): the same block as the game cards' I'm in.
  const nudge = useNudge();
  const nudgeBlocked = !!nudge?.state.blocked;
  // At the max they would wait. On the venue's court waitlist everyone goes on standby, so no count.
  // A game really full beyond the max has a real waitlist, court or no court (as its card says), so the prompt
  // warns first. With room, a game with no court booked reads like a normal one.
  // "Card cleanup" (Zip 10): no waitlist and no cap, so the popup never says waitlist or standby ("12 are in. You'd make it 13.").
  const cleanup = g.cardCleanup === true;
  const standby = !cleanup && s.courtState === 'waitlist';
  const waitlistForm = !cleanup && !standby && s.confirmedCount >= g.group.maxPlayers;
  // At the database's 12 the popup only says how many are in (an I'm in there gets the plain refusal).
  const subline = standby ? '' : cleanup && s.confirmedCount >= g.group.maxPlayers ? `${s.confirmedCount} are in.` : wantInSubline(s.confirmedCount, cleanup ? Number.POSITIVE_INFINITY : g.group.maxPlayers);

  async function answer(yes: boolean) {
    if (instant && !yes) {
      // Instant taps (INSTANT_TAPS): "No" is certain, so the question goes at once; a failed save brings it back.
      await instant.run({ key: `suggest:${s.sessionId}`, patch: declinePatch(s.sessionId), save: () => api('POST', `/api/sessions/${s.sessionId}/decline`, {}), what: 'No thanks' });
      return;
    }
    if (instant && busy) return;
    if (yes && nudge?.state.blocked) return nudge.openBlock();
    setBusy(true);
    const release = holdLive();
    // Instant taps: "Yes" leaves the seat to the server (a spot, the waitlist), so the button shows it is working until the answer.
    const unmark = instant ? markPressed() : () => {};
    try {
      if (yes) {
        // The same call, the same banner and the same refresh as tapping "I'm in" on that game.
        await sendDropsBeforeJoin(s.sessionId);
        const res = await nudgeJoin(s.sessionId, !!nudge && !nudge.state.blocked);
        joinToast(s.sessionId, s.confirmedCount, res, !!s.noCourt);
        onJoined({ sessionId: s.sessionId, text: joinedText(res, !!s.noCourt, flatOfGame(g, s.sessionId), !s.noCourt || !!g.payAlways), startsAt: s.startsAt, endsAt: s.endsAt });
        await onChanged();
      } else {
        await api('POST', `/api/sessions/${s.sessionId}/decline`, {});
        await onChanged();
      }
    } catch (err) {
      // Zip 17: refused at the limit (an older screen): the sheet once the fresh data shows it, else the server's words.
      if (yes && nudge && err instanceof ApiError && err.code === BLOCKED_CODE) {
        await onChanged();
        nudge.openBlock(err.message);
      } else if (isDemo(err)) toast(err.message);
      else toast(err instanceof ApiError ? err.message : 'That did not work. Try again.', 'error');
    } finally {
      unmark();
      setBusy(false);
      release();
    }
  }

  // Zip 11, Alert cards: "Tuesday needs 1 more" with the pickleball circles, or "Tuesday has 5 in" / "You'd make it 6", a green I'm in
  // (the same Yes) and an X (the same No). Never a cap: "You'd make it 6" says only what one more makes.
  if (g.alertCards === true) {
    const word = suggestDay(s.startsAt, tz, Date.parse(g.now)).word;
    const day = word.charAt(0).toUpperCase() + word.slice(1);
    const n = s.confirmedCount;
    const short = n < MIN_PLAYERS;
    // (A venue-waitlist game, "standby": no count, as before.)
    const title = standby ? wantInTitle(s.startsAt, tz, Date.parse(g.now), false) : short ? `${day} needs ${MIN_PLAYERS - n} more` : `${day} has ${n} in`;
    const atLimit = cleanup && n >= g.group.maxPlayers;
    const sub = standby ? undefined : short ? <AcBalls inCount={n} /> : waitlistForm ? "You'd be on the waitlist" : atLimit ? undefined : `You'd make it ${n + 1}`;
    return (
      <AlertCard
        as="section"
        tone="green"
        icon="join"
        titleId="suggest-title"
        titleAs="h2"
        label={title}
        title={title}
        sub={sub}
        data={{ 'data-suggest-card': true }}
        action={
          <button
            type="button"
            className={`ac-btn${nudgeBlocked ? ' nudge-dim' : ''}`}
            data-nudge-blocked={nudgeBlocked ? '' : undefined}
            aria-haspopup={nudgeBlocked ? 'dialog' : undefined}
            disabled={busy}
            onClick={() => answer(true)}
          >
            {waitlistForm ? 'Join waitlist' : "I'm in"}
          </button>
        }
        onX={() => !busy && void answer(false)}
        xLabel={`No thanks, ${title}`}
      />
    );
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
        <button className={`btn${nudgeBlocked ? ' nudge-dim' : ''}`} data-nudge-blocked={nudgeBlocked ? '' : undefined} disabled={busy} onClick={() => answer(true)}>
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

/** TONIGHT_GLOW on: the banner across the top of a date tile. On a tile too narrow for TOMORROW the CSS shows TOM instead (src/zip7.css). */
function DayBanner({ day }: { day: 'tonight' | 'tomorrow' }) {
  return (
    <span className={`tonight-tag day-tag ${day}`}>
      {day === 'tonight' ? (
        'TONIGHT'
      ) : (
        <>
          <span className="dt-full">TOMORROW</span>
          <span className="dt-short">TOM</span>
        </>
      )}
    </span>
  );
}

const TILE_DOW = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

/**
 * "TUE / 3 / NOV" tile for the left of a schedule row, like a paper
 * calendar: red weekday, big dark day, small gray month. `mine` adds a small
 * green check in the corner (you're in).
 */
export function DateTile({ iso, tz, mine, ts = '', day }: { iso: string; tz: string; mine?: boolean; ts?: string; day?: TileDay }) {
  const p = localParts(Date.parse(iso), tz);
  const month = formatMonthDay(iso, tz).split(' ')[0].toUpperCase();
  return (
    <div className={`tile${mine ? ' mine' : ''}${ts}${day ? ` day-${day}` : ''}`} aria-hidden="true">
      {ts && <TileBorders />}
      {/* TONIGHT_GLOW on: `day` is set on game day and the day before; otherwise (and always with the switch off) the weekday. */}
      {day ? <DayBanner day={day} /> : <span className="dow">{TILE_DOW[p.weekday]}</span>}
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
function PlayerTile({ iso, tz, mine, tonight, extra, ts = '', day, weekday }: { iso: string; tz: string; mine: boolean; tonight: boolean; extra: boolean; ts?: string; day?: TileDay; weekday?: boolean }) {
  const p = localParts(Date.parse(iso), tz);
  const month = formatMonthDay(iso, tz).split(' ')[0].toUpperCase();
  // TONIGHT_GLOW on: `day` is given (tonight, tomorrow or null) and decides the tag; off, `day` is undefined and the old blue TONIGHT strip is drawn.
  const tag =
    day !== undefined ? (
      day ? (
        <DayBanner day={day} />
      ) : (
        <span className="dow">{TILE_DOW[p.weekday]}</span>
      )
    ) : tonight ? (
      <span className="tonight-tag">TONIGHT</span>
    ) : (
      <span className="dow">{TILE_DOW[p.weekday]}</span>
    );
  return (
    <div className="tile-wrap" aria-hidden="true">
      <div className={`tile ptile${extra ? ' extra' : ''}${mine ? ' mine' : ''}${ts}${day ? ` day-${day}` : ''}`}>
        {ts && <TileBorders />}
        {tag}
        {/* Zip 14, the game day card: the weekday under the TONIGHT strip too (TONIGHT, TUE, 10, NOV), as in the approved mock. */}
        {weekday && (day === 'tonight' || (day === undefined && tonight)) && <span className="dow">{TILE_DOW[p.weekday]}</span>}
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
  const paid = usePaid([{ sessionId: s.id, cents: mine.oweCents }], onChanged, !!g.playerFix1);
  const credit = useCredit(onChanged, [s.id], !!g.playerFix1);
  const payTap = usePayTapped(s.id);
  const watchNoVenmo = useNoVenmoNote(g.group.organizerName, !!g.payNote);
  const busy = paid.busy || credit.busy || paid.blocked || credit.blocked;
  // PAY_SHEET: Pay opens a small sheet instead of jumping straight into the Venmo app.
  const [sheet, setSheet] = useState(false);
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
            <button className="link-btn quiet-link" data-undo-credit disabled={credit.busy || credit.blocked || paid.blocked} onClick={() => credit.undo(s.id)}>
              Undo
            </button>
          )}
          {mine.selfPaid && !mine.paidWithCredit && (
            <button className="link-btn quiet-link didnt-pay" disabled={paid.busy || paid.blocked || credit.blocked} onClick={() => paid.set(false)}>
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
        if (g.paySheet) {
          e.preventDefault();
          setSheet(true);
          return;
        }
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
      {g.paySheet && pay.url && (
        <PaySheet
          g={g}
          open={sheet}
          onClose={() => setSheet(false)}
          cents={mine.oweCents}
          pay={pay}
          onTapPay={payTap.mark}
          busy={busy}
          saving={paid.busy}
          onPaid={() => {
            setSheet(false);
            void paid.set(true);
          }}
        />
      )}
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
/**
 * "Card cleanup" (Zip 10): the card's content block is vertically centered to the date tile (the tile only, not the time under it).
 * The tile's height goes on the card as --cl-tile-h; the body is at least that tall and centers what it holds, so content taller than
 * the tile simply starts at the top of the tile. Follows the tile when it changes size (larger text, a rotated phone).
 */
function useTileCenter(ref: { current: HTMLElement | null }, on: boolean) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!on || !el) return undefined;
    const tile = el.querySelector<HTMLElement>('.sched-tilecol .tile-wrap');
    if (!tile) return undefined;
    // offsetHeight: the laid-out height, never a size caught in the middle of an entry animation (a transform).
    const set = () => el.style.setProperty('--cl-tile-h', `${tile.offsetHeight}px`);
    set();
    if (typeof ResizeObserver === 'undefined') return () => el.style.removeProperty('--cl-tile-h');
    const ro = new ResizeObserver(set);
    ro.observe(tile);
    return () => {
      ro.disconnect();
      el.style.removeProperty('--cl-tile-h');
    };
  }, [ref, on]);
}

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
  held,
  minHeight,
  contentTop,
  prev,
}: {
  s: PlayerSessionView;
  g: GroupView;
  tier: WeekTier;
  /** Zip 12, the saved copy of the last screen: drawn only, with no button, link or money line at all (src/lastScreen.ts). */
  held?: boolean;
  /** Zip 12, the saved copy: the height this card had on the live screen it copies (so nothing slides at the swap). */
  minHeight?: number;
  /** Zip 12, the saved copy: where this card's words started on the live screen (from the card's top), so they do not move at the swap. */
  contentTop?: number;
  /**
   * Zip 12, the first fresh screen after the saved copy: this card as the copy showed it (null: the copy did not have it). Only what
   * changed fades in (the balls and names, the status, a whole new card, and the buttons and money lines the copy never draws).
   */
  prev?: PlayerSessionView | null;
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
  const instantTaps = useInstant<GroupView>();
  // Zip 17, Unpaid nudge (null when off): at the limit I'm in looks dimmed and opens the "You owe" sheet instead of signing up.
  const nudge = useNudge();
  const nudgeBlocked = !held && !!nudge?.state.blocked;
  const [busy, setBusy] = useState(false);
  // Set at once (state waits for a redraw), so a quick second tap is ignored instead of flashing an error.
  const working = useRef(false);
  const [askOut, setAskOut] = useState(false);
  // Opened from the "time changed" notice's Can't make it: the same drop flow, in that notice's words.
  const [fromNotice, setFromNotice] = useState(false);
  const mine = s.mine;
  const inSession = mine?.status === 'confirmed';
  const waiting = mine?.status === 'waitlisted';
  // src/courtDisplay.ts draws an open venue-waitlist game as a normal one before it gets here; a game that already STARTED on a court
  // still on Waitlist keeps it, so the standby words below stay (a Zip 11 fresh review found them still reachable, so they are kept).
  const courtWait = s.courtState === 'waitlist';
  const open = !s.canceled && !s.started;
  const nowMs = Date.parse(g.now);
  const motion = useMotion();
  // Motion: the status control eases from the I'm in button into the chip (and back), and what just changed pops.
  const rowRef = useRef<HTMLElement>(null);
  useStatusMorph(rowRef);

  async function run(path: string, label: (data: any) => string, patch?: (v: GroupView) => GroupView) {
    if (working.current) return;
    if (instantTaps) {
      // Instant taps (INSTANT_TAPS): leaving the waitlist is certain (drawn at once); a drop sent now is the server's call (late
      // fees, credit), so the tapped button shows it is working. A failed save puts the screen back with a plain toast.
      working.current = true;
      setAskOut(false);
      const release = holdLive();
      await instantTaps.run({ key: `seat:${s.id}`, patch: patch ?? null, save: () => api<any>('POST', `/api/sessions/${s.id}/${path}`, {}), saved: label, what: path === 'withdraw' ? (waiting ? 'Leave the list' : 'Drop out') : undefined });
      working.current = false;
      release();
      return;
    }
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
    if (nudge?.state.blocked) return nudge.openBlock();
    const before = s.confirmed.length;
    const instant = canJoinInstantly(s);
    working.current = true;
    setBusy(true);
    const release = holdLive();
    if (instant) setOverlay(s.id, 'join');
    // Instant taps (INSTANT_TAPS): a full game, the waitlist or standby is the server's call, so the button shows it is working.
    const unmark = !instant && instantTaps ? markPressed() : () => {};
    try {
      await sendDropsBeforeJoin(s.id);
      joinToast(s.id, before, await nudgeJoin(s.id, !!nudge && !nudge.state.blocked), isNoCourt(s));
      await onChanged();
    } catch (err) {
      setOverlay(s.id, null);
      // Zip 17: the server refused at the limit (this screen was older): the sheet once the fresh data shows it, else its words.
      if (nudge && err instanceof ApiError && err.code === BLOCKED_CODE) {
        await onChanged();
        nudge.openBlock(err.message);
        return;
      }
      if (isDemo(err)) toast(err.message);
      else toast(err instanceof ApiError ? err.message : 'That did not work. Try again.', 'error');
      await onChanged();
    } finally {
      unmark();
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
  const asking = !held && !!s.timeAsk && g.timeShift !== false && inSession && open;
  useEffect(() => {
    if (!asking) return undefined;
    return registerCant(s.id, () => {
      setFromNotice(true);
      setAskOut(true);
    });
  }, [asking, s.id]);
  // Shown only the first time this player sees this promotion on this phone (src/goodNews.ts).
  const promoted = !held && inSession && !!mine.promotion && !!g.me && seeGoodNews(goodNewsKey(g.me.id, s.id, mine.signupAt), demoOn() ? demoSessionNumber() : null);
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
  // Zip 14, GAME_DAY_CARD (src/GameDay.tsx): today's game (or, on a preview with ?gamedaytest=on, the next game's date) is the game day card.
  // Off: false, and every line below draws exactly what it did.
  // Until the game ends, not only until it starts (Court stays up for late arrivals).
  const gameDay = isGameDayCard(g, s, !s.canceled && playerDay(s.startsAt, tz, nowMs).word === 'tonight');
  // Zip 7 switches. TONIGHT_GLOW: the tile wears TONIGHT or TOMORROW (Eastern calendar days). PLAYER_CARDS_SIMPLE: no court words or dot.
  const dayTag: TileDay | undefined = g.tonightGlow === true ? (gameDay ? 'tonight' : tileDay(s.startsAt, tz, nowMs, open && !s.canceled)) : undefined;
  const simple = g.playerCardsSimple === true;
  // Standby is the venue-waitlist game's word for the list; PLAYER_CARDS_SIMPLE says waitlist (or nothing) everywhere.
  const standbyWord = courtWait && !simple;
  // Zip 9, CARD_TIME_BUTTONS: the start and the length under the tile, and one joined Calendar | Directions button instead of the icon.
  const cardButtons = g.cardTimeButtons === true;
  // Zip 10, CARD_CLEANUP: no count text (only the circles, one row), the people icon before the names, the content centered to the
  // date tile, a filled I'm in, no waitlist words; a LATER game is a smaller tinted card with the same slots.
  const cleanup = g.cardCleanup === true;
  useTileCenter(rowRef, cleanup);
  // Zip 12, the saved copy: the words start where they started on the live card (the live card's buttons can make the words sit higher
  // than a card without them, which Card cleanup centers). Top-aligned, then moved down by what is missing.
  const bodyRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const body = bodyRef.current;
    const card = rowRef.current;
    if (!held || contentTop === undefined || !body || !card) return;
    const first = body.firstElementChild as HTMLElement | null;
    if (!first) return;
    body.style.justifyContent = 'flex-start';
    body.style.paddingTop = '';
    const now = first.getBoundingClientRect().top - card.getBoundingClientRect().top;
    const delta = contentTop - now;
    if (Math.abs(delta) > 0.5) body.style.paddingTop = `${parseFloat(getComputedStyle(body).paddingTop || '0') + delta}px`;
  }, [held, contentTop]);
  // Once you're signed up: at the right end of the status line (the tap area reaches past the icon).
  // The game day card has its own two buttons (Court, Directions) instead: no calendar or arrow button on game day.
  const calLink =
    !held &&
    !gameDay &&
    isIn &&
    open &&
    (cardButtons ? (
      <CalendarDirections calendarHref={`/api/sessions/${s.id}/calendar.ics`} dayLabel={formatShortDate(s.startsAt, tz)} />
    ) : (
      <a className="cal-icon-link" href={`/api/sessions/${s.id}/calendar.ics`} aria-label={`Add ${formatShortDate(s.startsAt, tz)} to calendar`}>
        <CalendarPlusIcon />
      </a>
    ));
  // PLAYER_CARDS_SIMPLE: the spots count is always there (a venue-waitlist game reads like any other game).
  const showCount = !s.canceled && (simple || s.confirmed.length > 0 || !courtWait);
  const dropLink = !held && isIn && open && (
    <button className="link-btn quiet-link drop-link" disabled={busy} aria-busy={busy} onClick={() => setAskOut(true)}>
      Drop out
    </button>
  );
  const payShows = !held && isIn && !!mine && (mine.paymentStatus === 'paid' || mine.oweCents > 0 || mine.creditCents > 0 || mine.useCreditCents > 0 || onTop);

  // The gray "If 6 play, you get $5 back as credit." for someone who would be 5th or later (not joined, room left, not on a waitlist).
  const notIn = !held && open && !(inSession || waiting);
  // The flat LATER row (switch off) puts the note in the middle column; every card (and every Card cleanup card) puts it under the button.
  const flatLater = tier === 'later' && !cleanup;
  const note = notIn && !courtWait && s.joinAs === 'in' && !s.full ? s.shortGame
        ? gameCreditBackNote(viewPrice(s, { pricePerPlayerCents: g.group.priceCents, typicalCourtCostCents: 0 }), s.confirmed.length, g.group.maxPlayers, formatPrice)
        : creditBackNote(g.group.priceCents, s.confirmed.length, g.group.maxPlayers, formatPrice)
      : null;

  // The status line: "You're in · Court booked", the court word with a dot, the waitlist spot, or Canceled (with the organizer's reason).
  const courtWord = <span>{court.playerText}</span>;
  let status: ReactNode;
  // A canceled game's reason is shown like a comment: a pill when the reason is short, a soft box when it is long (same words as before).
  const reasonShown = s.canceled && s.courtState !== 'not_opened' && !!s.cancelReason;
  if (s.canceled) status = <span className={`st-canceled${reasonShown ? ` ${noteLook(s.cancelReason!)}` : ''}`}>{s.courtState === 'not_opened' ? court.playerText : s.cancelReason ? `Canceled - ${s.cancelReason}` : 'Canceled'}</span>;
  else if (waiting)
    status = simple ? <span className="st-wait on-waitlist">On the waitlist</span> : <span className="st-wait">{courtWait ? 'Standby' : 'Waitlist'}, {ordinal(mine.waitlistPosition ?? 1)} in line</span>;
  else if (isIn && simple)
    // PLAYER_CARDS_SIMPLE: "You're in" and the calendar icon, nothing about the court.
    status = (
      <>
        <span className="st-lead">
          <strong className="st-in">You're in</strong>
        </span>
        <span className="st-tail">{calLink}</span>
      </>
    );
  else if (simple) status = null;
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
    <button
      className={`btn sched-btn${flatLater ? ' outline' : ''}${nudgeBlocked ? ' nudge-dim' : ''}`}
      data-join
      data-nudge-blocked={nudgeBlocked ? '' : undefined}
      aria-haspopup={nudgeBlocked ? 'dialog' : undefined}
      disabled={busy}
      aria-busy={busy}
      onClick={join}
    >
      {busy ? 'Saving…' : cleanup && s.joinAs === 'in' ? "I'm in" : standbyWord ? 'Join standby' : s.joinAs === 'in' || courtWait ? "I'm in" : 'Join waitlist'}
    </button>
  );
  const leaveBtn = !held && waiting && open && (
    <button className="btn sched-btn outline" disabled={busy} aria-busy={busy} onClick={() => setAskOut(true)}>
      {standbyWord ? 'Leave standby' : 'Leave waitlist'}
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
      className={`sched ${cleanup && tier === 'later' ? 'tier-next cl-later' : `tier-${tier}`}${cleanup ? ' cl' : ''}${gameDay ? ' gd' : ''}${s.canceled ? ' off' : ''}${highlight ? ' highlight' : ''}${leaving ? ' leaving' : ''}${asking ? ' ts-asking' : ''}${moneyFresh ? ' m-fresh' : ''}${justJoined ? ' m-joined' : ''}${paidFresh ? ' m-paid' : ''}`}
      aria-hidden={leaving ? true : undefined}
      data-tier={tier}
      data-held={held ? 'yes' : undefined}
      style={minHeight ? { minHeight } : undefined}
      {...swapMarks(prev, s, names)}
      data-mine={isIn ? 'in' : undefined}
      data-extra={s.extra ? 'yes' : undefined}
      data-game-day={gameDay ? (s.court ?? 'tbd') : undefined}
      aria-labelledby={`s-${s.id}`}
    >
      <div className="sched-tilecol">
        <PlayerTile iso={s.startsAt} tz={tz} mine={isIn} tonight={(tonight || gameDay) && !s.canceled} extra={false} ts={s.extra ? '' : tsClass(ts, flip)} day={dayTag} weekday={gameDay} />
        <div className="sched-when-col">
        {(() => {
          // Only the start ("7:30 PM") so it always fits under the tile. A game of another length also shows
          // where it ends, on a second short line, so nobody is misled.
          const t = cardTime(s.startsAt, s.endsAt, tz, g.group.usualMinutes);
          // CARD_TIME_BUTTONS: the start, and under it a smaller gray line with the length ("2 hours", "1.5 hours"), on every card.
          // The game day card always has both lines ("7:30 PM", "2 hours"), as in the approved mock.
          if (cardButtons || gameDay) {
            const length = lengthWords(gameMinutes(s.startsAt, s.endsAt));
            return (
              <div className={`sched-time z9-time${tsClass(ts, flip)}`} data-sched-time data-ts={ts ?? undefined}>
                <span aria-hidden="true">{tsTime(t.start, ts)}</span>
                {length && (
                  <span className="z9-length" aria-hidden="true" data-length>
                    {length}
                  </span>
                )}
              </div>
            );
          }
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
      <div className="sched-body" ref={bodyRef}>
        {status !== null && (
          <div className="sched-head">
            <div className={`sched-status court-${court.kind}${cardButtons && isIn && open ? ' z9-status' : ''}`} data-court={court.kind}>
              {status}
            </div>
          </div>
        )}
        {gameDay && <GameDayButtons court={s.court ?? null} organizerName={g.group.organizerName} dayLabel={formatShortDate(s.startsAt, tz)} held={held} />}
        <div className="sched-main">
          {showCount &&
            (cleanup ? (
              // Card cleanup: the circles alone (the same size as before; past 4 they keep coming on the same row), the count is read out.
              <div className="in-line cl-balls">
                <SpotDots names={names} me={g.me?.name} celebrate={celebrating && !gameDay} oneRow />
              </div>
            ) : (
              <div className="in-line">
                <span className="in-count">
                  <RollText text={simple ? s.countText : countLine(s)} />
                </span>
                <SpotDots names={names} me={g.me?.name} celebrate={celebrating && !gameDay} />
              </div>
            ))}
          {showCount && <NamesLine names={names} me={g.me?.name} everyone={everyone} icon={cleanup} />}
          {!s.canceled && !waiting && !simple && !cleanup && (
            <NamesLine names={s.waitlist.map((w) => w.name)} me={g.me?.name} everyone={everyone} label={courtWait ? 'Standby' : 'Waitlist'} />
          )}
          {waiting && !s.canceled && !simple && !cleanup && <p className="sched-sub">You're in if someone drops.</p>}
          {/* Only for someone who was in (or waiting on) the game: nobody else paid for it. */}
          {s.canceled && (inSession || waiting) && mine.lateFee?.kind === 'canceled_late' ? (
            <p className="sched-sub" data-late-fee>
              Canceled late. {mine.lateFee.oweCents > 0 ? `You still owe ${formatPrice(mine.lateFee.oweCents)}.` : `Your ${formatPrice(mine.lateFee.priceCents ?? viewFlat(s, g.group.priceCents))} stays on this game.`}
            </p>
          ) : (
            s.canceled && (inSession || waiting) && mine.paymentStatus !== 'not_applicable' && <p className="sched-sub">If you paid, it's now your credit.</p>
          )}

          {s.extra && <span className="sr-only">Extra game</span>}
          {s.note && (s.note.trim().length <= NOTE_PILL_MAX ? <span className="game-note note-pill">{s.note.trim()}</span> : <p className="game-note note-box">{s.note}</p>)}
          {goodNews && g.previewCalm !== true && (g.alertCards === true ? <AlertCard as="div" tone="green" className="ac-inline" title={goodNews} data={{ 'data-good-news': true }} /> : <Notice tone="ok">{goodNews}</Notice>)}
          {flatLater && noteEl}
        </div>

        {payShows && <RowPay g={g} s={s} onTop={onTop} onChanged={onChanged} drop={dropLink} />}
        {isIn && !payShows && dropLink && (
          <div className="sched-money stacked">
            <span className="inline-links">{dropLink}</span>
          </div>
        )}
        {(joinBtn || leaveBtn) && <div className="sched-money">{joinBtn}{leaveBtn}</div>}
        {!flatLater && noteEl}
      </div>

      {celebrating && motion && !gameDay && <Burst />}
      <ConfirmDialog
        open={askOut}
        title={waiting ? (standbyWord ? 'Leave standby?' : 'Leave the waitlist?') : `Out for ${suggestDay(s.startsAt, tz, nowMs).word}?`}
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
        confirmLabel={waiting ? (standbyWord ? 'Leave standby' : 'Leave waitlist') : fromNotice ? "Can't make it" : 'Drop out'}
        danger
        busy={busy}
        onConfirm={() => {
          // From the notice the banner never says "dropped out": "You're out. $14 credit returned." (same money words).
          const lead = fromNotice ? "You're out." : undefined;
          setFromNotice(false);
          if (waiting) void run('withdraw', () => "You're off the list", g.me ? leaveWaitlistPatch(s.id, g.me.name) : undefined);
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

/** Zip 12: which parts of a fresh card differ from how the saved copy drew it (data attributes; src/player-cards.css fades those in). */
function swapMarks(prev: PlayerSessionView | null | undefined, s: PlayerSessionView, names: string[]): Record<string, string> {
  if (prev === undefined) return {};
  if (prev === null) return { 'data-sw': '', 'data-sw-card': '' };
  const out: Record<string, string> = { 'data-sw': '' };
  if (prev.confirmed.map((p) => p.name).join('\u0001') !== names.join('\u0001') || prev.countText !== s.countText) out['data-sw-balls'] = '';
  if ((prev.mine?.status ?? null) !== (s.mine?.status ?? null) || prev.bookingStatus !== s.bookingStatus || prev.courtState !== s.courtState || prev.canceled !== s.canceled) out['data-sw-status'] = '';
  return out;
}

const noop = () => {};
const noopAsync = async () => {};

/**
 * Zip 12, "Show last screen at once" (src/lastScreen.ts): the saved copy, drawn with the same cards as the live screen while the
 * fresh answer is on its way. Nothing in it can be tapped (`inert`, and the cards draw no button, link or money line at all). The small
 * gray "as of 2:14 PM" sits where the All games button sits on the live screen, so it takes no room of its own. When the copy kept the
 * sizes of the screen it came from (the same page width), each card keeps its height and the room above the list (the Pay card,
 * notices) is held by a soft shimmer: nothing slides when the fresh screen takes its place.
 */
export function SavedScreenView({ saved }: { saved: SavedScreen }) {
  const v = courtDisplay(saved.view);
  // The same <html> markers the live screen sets (Card cleanup, Tonight glow, Color cleanup, Simpler cards), so the cards look the same.
  useZip7Root(saved.view);
  const tz = v.group.timezone;
  const nowMs = Date.parse(v.now);
  const mineOnly = storageGet(FILTER_KEY) === 'mine';
  const filtered = mineOnly ? v.sessions.filter(isMineGame) : v.sessions;
  const later = (s: PlayerSessionView) => weekTier(s.startsAt, nowMs, tz) === 'later';
  const shown = v.homeCollapse ? filtered.filter((s) => !later(s)) : filtered.slice(0, SHOW_FIRST);
  const layout = saved.layout && typeof window !== 'undefined' && saved.layout.width === window.innerWidth && Array.isArray(saved.layout.items) ? saved.layout : null;
  // The page puts 20 px between the room above the list and the list (main is a 20 px stack).
  const lead = layout ? layout.lead - 20 : 0;
  const asOf = asOfText(saved.savedAt, tz);
  const byId = new Map(filtered.map((s) => [s.id, s]));
  const row = (s: PlayerSessionView, tier: WeekTier, h?: number, c?: number) => (
    <ScheduleRow key={s.id} s={s} g={v} tier={tier} held minHeight={h} contentTop={c} onChanged={noopAsync} setOverlay={noop} joinToast={noop} />
  );
  const tag = (
    <span className="saved-asof" data-saved-asof>
      {asOf}
    </span>
  );
  let body: ReactNode;
  if (layout) {
    // The live list as it was, piece for piece: a game the copy may not show (ended, canceled) keeps its room as a soft shimmer.
    // As a fresh page load draws it, though: Home collapse folds the later games again, and otherwise only the first 6 cards show.
    let cardsSeen = 0;
    let inLater = false;
    const items = layout.items.filter((it) => {
      if (it.kind === 'line') inLater = it.tier === 'later';
      if (v.homeCollapse && inLater) return false;
      if (it.kind === 'card' && !v.homeCollapse && ++cardsSeen > SHOW_FIRST) return false;
      return !(it.kind === 'line' && !v.homeCollapse && cardsSeen >= SHOW_FIRST);
    });
    let tagged = false;
    let tier: WeekTier = 'this';
    body = items.map((it, i) => {
      if (it.kind === 'line') {
        tier = it.tier as WeekTier;
        const first = !tagged;
        tagged = true;
        return (
          <div key={`line-${i}`} className={`week-break tier-${it.tier}`}>
            <h3>{TIER_LABEL[it.tier as WeekTier]}</h3>
            {first && tag}
          </div>
        );
      }
      const s = byId.get(it.id);
      if (!s) return <div key={`gap-${it.id}`} className="saved-hold skel" data-saved-gap aria-hidden="true" style={{ height: it.h }} />;
      return row(s, tier, it.h, it.c);
    });
  } else {
    body = shown.map((s, i) => {
      const tier = weekTier(s.startsAt, nowMs, tz);
      const prev = i > 0 ? weekTier(shown[i - 1].startsAt, nowMs, tz) : null;
      const header = prev !== tier ? TIER_LABEL[tier] : null;
      return (
        <Fragment key={s.id}>
          {header && (
            <div className={`week-break tier-${tier}`}>
              <h3>{header}</h3>
              {i === 0 && tag}
            </div>
          )}
          {row(s, tier)}
        </Fragment>
      );
    });
  }
  return (
    <>
      <p className="sr-only" role="status">
        Your last screen, {asOf}. Updating.
      </p>
      {lead > 0 && <div className="saved-hold skel" data-saved-lead aria-hidden="true" style={{ height: lead }} />}
      <div className={`schedule saved-copy${v.playerFix1 ? ' pf1' : ''}`} data-saved-copy inert aria-busy="true">
        {body}
      </div>
    </>
  );
}
