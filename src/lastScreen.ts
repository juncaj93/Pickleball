// Zip 12, "Show last screen at once" (SPEED_LAST_SCREEN, server/speed.ts). A returning player's phone draws the last screen it saw
// at once (games, court status, balls, names), tagged "as of 2:14 PM", with every button held, then swaps in the fresh answer.
//
// What is kept on the phone (localStorage, this browser only): ONLY what that player already sees on the cards. Games that are
// still to come, their date, time and length, the court status, who is in (first names, as shown), the waitlist names a card shows,
// a game's note, and this player's own in / waiting / out. NEVER money of any kind (no price, no "$14 due", no paid state, no
// credit, no cash out), no phone numbers, no Venmo names, nobody else's payments, nothing organizer-only, and nothing for the
// admin screen. The organizer's View as, the demo and Pretend never read or write it.
//
// It is thrown away when: the server's answer no longer says lastScreen (switched off), the player changes name ("not you?") or the
// phone has no name, it is older than 24 hours, the app version changed, it belongs to another address (/ vs a /g/ link), or
// anything about it cannot be read. Every read and write is inside try/catch: if storage fails, the site works exactly as today.

import type { GroupView, PlayerSessionView } from '../shared/api';
import { LAST_SCREEN_MAX_AGE_MS } from '../shared/speed';
import { formatShortDate, formatTime, formatWeekday } from '../shared/time';

/** "as of 2:14 PM" (Eastern, 12-hour); a copy from an earlier day says the day too: "as of Fri 2:14 PM". */
export function asOfText(savedAt: number, tz: string, nowMs = Date.now()): string {
  const iso = new Date(savedAt).toISOString();
  const same = formatShortDate(iso, tz) === formatShortDate(new Date(nowMs).toISOString(), tz);
  return `as of ${same ? '' : `${formatWeekday(iso, tz).slice(0, 3)} `}${formatTime(iso, tz)}`;
}

export const LAST_SCREEN_KEY = 'pb_last_screen';

/** What sits in storage. `view` is a GroupView with every money and private field emptied (see sanitize). */
export interface SavedScreen {
  build: string;
  /** The address it belongs to: 'plain' (the site address) or the /g/ key. */
  page: string;
  meId: string;
  savedAt: number;
  view: GroupView;
}

interface Store {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}
const browserStore = (): Store | null => {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
};
const build = () => (typeof __APP_BUILD__ === 'string' ? __APP_BUILD__ : 'test');

/** A game the saved copy may show: still to come (not ended at `nowMs`), not canceled, not over. */
export function keepGame(s: PlayerSessionView, nowMs: number): boolean {
  return !s.canceled && !s.past && Date.parse(s.endsAt) > nowMs;
}

/** The card's own fields with money, phone numbers and prompts taken out. Your seat keeps only in / waiting / out. */
function sanitizeGame(s: PlayerSessionView, nowMs: number): PlayerSessionView {
  return {
    id: s.id,
    startsAt: s.startsAt,
    endsAt: s.endsAt,
    canceled: false,
    cancelReason: null,
    started: nowMs >= Date.parse(s.startsAt),
    bookingStatus: s.bookingStatus,
    venueName: s.venueName,
    confirmed: s.confirmed.map((p) => ({ name: p.name, attendanceConfirmed: p.attendanceConfirmed })),
    waitlist: s.waitlist.map((p) => ({ name: p.name })),
    openSpots: s.openSpots,
    countText: s.countText,
    full: s.full,
    joinAs: s.joinAs,
    holiday: s.holiday,
    courtState: s.courtState,
    extra: s.extra,
    note: s.note,
    bookingOpen: s.bookingOpen,
    bookingOpensAt: s.bookingOpensAt,
    past: false,
    finalized: null,
    confirmationOpen: s.confirmationOpen,
    dropCutoffAt: s.dropCutoffAt,
    mine: s.mine
      ? {
          status: s.mine.status,
          waitlistPosition: s.mine.waitlistPosition,
          attendanceConfirmed: s.mine.attendanceConfirmed,
          promotion: null,
          shareCents: null,
          paymentStatus: 'not_applicable',
          selfPaid: false,
          signupAt: s.mine.signupAt,
          oweCents: 0,
          dropCreditCents: 0,
          dropCashCents: 0,
          dropClaimCents: 0,
          ...(s.mine.standby ? { standby: true } : {}),
          creditCents: 0,
          paidEarlierCents: 0,
          paidWithCredit: false,
          useCreditCents: 0,
          lateFee: null,
          creditBackCents: 0,
        }
      : null,
    timeAsk: null,
    ...(s.venueWaitlist ? { venueWaitlist: true } : {}),
  };
}

/**
 * The copy that may be kept: a GroupView with ONLY what the cards draw. Money fields are emptied or zero (price 0, nothing owed,
 * no credit), the names list (used only by "Who are you?") is empty, and the switches that change money or taps are left out.
 */
export function sanitize(v: GroupView, nowMs: number): GroupView {
  return {
    group: { name: v.group.name, timezone: v.group.timezone, venmoUrl: null, organizerName: null, priceCents: 0, maxPlayers: v.group.maxPlayers, usualMinutes: v.group.usualMinutes },
    players: [],
    me: v.me ? { id: v.me.id, name: v.me.name } : null,
    viewingAs: false,
    // Look only (how a card is drawn). Nothing that changes money, payment or what a tap does.
    ...(v.timeShift !== undefined ? { timeShift: v.timeShift } : {}),
    ...(v.homeCollapse ? { homeCollapse: true } : {}),
    ...(v.tonightGlow ? { tonightGlow: true } : {}),
    ...(v.colorCleanup ? { colorCleanup: true } : {}),
    ...(v.playerCardsSimple ? { playerCardsSimple: true } : {}),
    ...(v.cardTimeButtons ? { cardTimeButtons: true } : {}),
    ...(v.cardCleanup ? { cardCleanup: true } : {}),
    ...(v.playerFix1 ? { playerFix1: true } : {}),
    lastScreen: true,
    now: new Date(nowMs).toISOString(),
    sessions: v.sessions.filter((s) => keepGame(s, nowMs)).map((s) => sanitizeGame(s, nowMs)),
    owed: [],
    payDue: [],
    credit: { balanceCents: 0, usableCents: 0, pending: null, history: [] },
    suggestion: null,
    version: '',
  };
}

/** Keep this answer for next time, if the server said so; otherwise throw away any old copy. Never for View as or the demo. */
export function saveLastScreen(page: string, v: GroupView, nowMs = Date.now(), store: Store | null = browserStore()): void {
  if (!store) return;
  try {
    if (v.lastScreen !== true || !v.me || v.viewingAs) {
      store.removeItem(LAST_SCREEN_KEY);
      return;
    }
    const saved: SavedScreen = { build: build(), page, meId: v.me.id, savedAt: nowMs, view: sanitize(v, nowMs) };
    store.setItem(LAST_SCREEN_KEY, JSON.stringify(saved));
  } catch {
    try {
      store.removeItem(LAST_SCREEN_KEY);
    } catch {
      /* storage not usable: nothing kept */
    }
  }
}

export function clearLastScreen(store: Store | null = browserStore()): void {
  try {
    store?.removeItem(LAST_SCREEN_KEY);
  } catch {
    /* nothing to do */
  }
}

/**
 * The saved copy for this address, ready to draw (games that have ended since are left out, the clock is now), or null. Anything
 * old, from another build or address, or unreadable is thrown away.
 */
export function readLastScreen(page: string, nowMs = Date.now(), store: Store | null = browserStore()): SavedScreen | null {
  if (!store) return null;
  try {
    const text = store.getItem(LAST_SCREEN_KEY);
    if (!text) return null;
    const saved = JSON.parse(text) as SavedScreen;
    const fresh = saved && saved.build === build() && typeof saved.savedAt === 'number' && nowMs - saved.savedAt < LAST_SCREEN_MAX_AGE_MS && saved.savedAt <= nowMs + 60_000;
    if (!fresh || !saved.view || !saved.view.me || saved.view.me.id !== saved.meId || !Array.isArray(saved.view.sessions)) {
      store.removeItem(LAST_SCREEN_KEY);
      return null;
    }
    if (saved.page !== page) return null;
    const sessions = saved.view.sessions.filter((s) => keepGame(s, nowMs)).map((s) => ({ ...s, started: nowMs >= Date.parse(s.startsAt) }));
    return { ...saved, view: { ...saved.view, now: new Date(nowMs).toISOString(), sessions } };
  } catch {
    clearLastScreen(store);
    return null;
  }
}
