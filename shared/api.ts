// Shapes of the JSON the API returns. Shared by server and browser.
import type { CreditReason } from './credit';
import type { GroupSettings } from './settings';
import type { AdminDecision, BookingStatus, SessionRecordStatus, SessionState } from './status';

export type RosterStatus = 'confirmed' | 'waitlisted' | 'withdrawn' | 'declined';
export type PaymentStatus = 'unpaid' | 'paid' | 'not_applicable';

export interface PlayerSessionView {
  id: string;
  startsAt: string;
  endsAt: string;
  canceled: boolean;
  started: boolean;
  bookingStatus: BookingStatus;
  venueName: string | null;
  confirmed: { name: string; attendanceConfirmed: boolean }[];
  waitlist: { name: string }[];
  /** Spots left before the game is full. */
  openSpots: number;
  /** "3 of 4 in", "5 in", "10 in, full" */
  countText: string;
  /** At the max: anyone else waits. */
  full: boolean;
  /** What the big button does for someone not in yet. */
  joinAs: 'in' | 'waitlist';
  /** US holiday on this date, e.g. "Thanksgiving". */
  holiday: string | null;
  courtState: 'waitlist' | 'opened' | 'not_opened' | null;
  /** A one-off game the organizer added, with its optional note. */
  extra: boolean;
  note: string | null;
  /** Inside the booking window (14 days by default), and when it opens. */
  bookingOpen: boolean;
  bookingOpensAt: string;
  /** Already played; only listed because this player still owes for it. */
  past: boolean;
  /** The organizer finalized who played: the final price each. */
  finalized: { playedCount: number; priceCents: number } | null;
  confirmationOpen: boolean;
  mine: null | {
    status: RosterStatus;
    waitlistPosition: number | null;
    attendanceConfirmed: boolean;
    /** Moved in from the waitlist: show the "Good news" line. */
    promotion: 'spot_opened' | null;
    /** Their price for this session ($14 until finalized, then the final price; null when nothing is owed). */
    shareCents: number | null;
    paymentStatus: PaymentStatus;
    /** They tapped "I paid" themselves. */
    selfPaid: boolean;
    /** When this sign-up started. A fresh "I'm in" after "I'm out" gets a new one. */
    signupAt: string;
    /** What they still owe for this session, after credit used on it (0 when paid). */
    oweCents: number;
    /** Credit from their pot already used on this session. */
    creditCents: number;
    /** Paid in full with credit from their pot: shows "Paid with credit". */
    paidWithCredit: boolean;
    /** What "Use credit" would take off this session now: the smaller of their usable credit and what they owe. 0 hides the button. */
    useCreditCents: number;
    /** Money from this session that came back to them as credit (they dropped out, it was canceled, they did not play, or they paid more than the final price). */
    creditBackCents: number;
  };
}

/** One line of a player's credit history. */
export interface CreditEntryView {
  id: string;
  /** kept: money came back as credit. used: spent on a game. refunded: paid back by Venmo. */
  kind: 'kept' | 'used' | 'refunded';
  cents: number;
  sessionId: string | null;
  sessionStartsAt: string | null;
  at: string;
  /** Undone, or went back to the player. It no longer counts. */
  endedAt: string | null;
  endedReason: 'undone' | 'unmarked' | 'dropped' | 'canceled' | null;
  reason: CreditReason | null;
  playedCount: number | null;
}

/** A player's own credit (never anyone else's). */
export interface CreditView {
  /** The pot. */
  balanceCents: number;
  /** The pot minus a pending refund request: what "Use credit" can spend. */
  usableCents: number;
  /** A refund request waiting on the organizer. */
  pending: { id: string; cents: number; at: string } | null;
  /** Live entries, newest first. */
  history: CreditEntryView[];
}

export interface GroupView {
  group: { name: string; timezone: string; venmoUrl: string | null; organizerName: string | null; priceCents: number; maxPlayers: number };
  players: { id: string; name: string }[];
  me: { id: string; name: string } | null;
  /** True when the organizer is looking through this player's eyes. */
  viewingAs: boolean;
  now: string;
  sessions: PlayerSessionView[];
  /** Confirmed, unpaid sessions. `reminder` only once the session ended more than 24 hours ago. */
  owed: {
    sessionId: string;
    startsAt: string;
    endsAt: string;
    /** What they actually owe, after credit used on it. */
    amountCents: number;
    creditCents: number;
    /** The session was finalized at this price (owes the remainder, not the flat price). */
    finalized: boolean;
    reminder: boolean;
    /** When this sign-up started (see `mine.signupAt`). */
    signupAt: string;
  }[];
  /**
   * What to pay now, for the card at the top of the screen: owed sessions
   * whose game day has reached 8:00 AM. Nothing before that.
   */
  payDue: GroupView['owed'];
  /** Their credit. Only their own. */
  credit: CreditView;
  /** "Want in on Tuesday?" for a usual day the player hasn't answered yet. */
  suggestion: {
    sessionId: string;
    startsAt: string;
    endsAt: string;
    joinAs: 'in' | 'waitlist';
    holiday: string | null;
    /** How many are in now. */
    confirmedCount: number;
    /** The venue's court waitlist: players go on standby. */
    courtState: 'waitlist' | 'opened' | 'not_opened' | null;
  } | null;
}

export interface AdminRosterEntry {
  playerId: string;
  name: string;
  phone: string | null;
  status: RosterStatus;
  claimedAt: string;
  confirmedAt: string | null;
  attendanceConfirmedAt: string | null;
  paymentStatus: PaymentStatus;
  /** The player marked it paid themselves; the organizer sees a "self-marked" tag. */
  selfPaid: boolean;
  paidAt: string | null;
  /** What they paid (cash plus credit used), as recorded when marked paid. */
  paymentAmountCents: number | null;
  /** Their price now: $14 until finalized, the final price if they played, null when nothing is owed. */
  shareCents: number | null;
  /** What they still owe right now (0 when paid or nothing owed). */
  owesCents: number;
  waitlistPosition: number | null;
  promotedAt: string | null;
  refundedAt: string | null;
  /** Dropped out after the day-before check-in opened. */
  lateDropAt: string | null;
  lateDropDoneAt: string | null;
  promotionReason: 'spot_opened' | null;
  promotionNotifiedAt: string | null;
  /** Credit from their pot used on this seat. */
  creditCents: number;
  /** Money from this seat that went back to them as credit, and why. */
  creditBackCents: number;
  creditBackReason: CreditReason | null;
  /** Set once the game is finalized: did they play. */
  played: boolean | null;
  /**
   * This is the organizer. They pay the venue, not the other players, so
   * there is no share or credit here, and their paid mark means "Court paid".
   */
  isOrganizer: boolean;
}

/** Organizer only: the court row on a session's Who paid list. Never sent to players. */
export interface CourtDue {
  /** The full court cost for the session (the booking's cost, else the typical cost). */
  costCents: number;
  typicalCost: boolean;
  /** What the other players owe (or paid) for this session under the usual rules. */
  playersCoverCents: number;
  /** Court cost minus what players cover, never below $0. */
  yourShareCents: number;
  /** Players cover the whole court or more. */
  covered: boolean;
  /** The organizer paid the venue. */
  paid: boolean;
  paidAt: string | null;
}

export interface EligibleSubstitute {
  playerId: string;
  name: string;
  phone: string | null;
  source: 'waitlist' | 'regular' | 'substitute';
}

export interface AdminSessionView {
  id: string;
  startsAt: string;
  endsAt: string;
  status: SessionRecordStatus;
  bookingStatus: BookingStatus;
  venueName: string | null;
  venueBookingUrl: string | null;
  reservationReference: string | null;
  cancellationDeadlineAt: string | null;
  adminDecision: AdminDecision;
  decisionAt: string | null;
  canceledAt: string | null;
  canceledBy: string | null;
  state: SessionState;
  roster: AdminRosterEntry[];
  confirmedCount: number;
  waitlistCount: number;
  /** Other players only; the organizer is never counted. */
  paidCount: number;
  payableCount: number;
  /** The organizer's court row. Null when there is no court to pay for (canceled, or nobody in and not booked). */
  court: CourtDue | null;
  /** Organizer's private record of the court cost. Never sent to players. */
  courtCostCents: number | null;
  /** A canceled game the venue still charged for (answered Yes to "Were you charged?"): that amount counts as its court cost. */
  chargedCents: number | null;
  courtState: 'waitlist' | 'opened' | 'not_opened' | null;
  /** Moved from its usual time (rescheduled). */
  moved: boolean;
  /** The usual time it was moved from, when moved. */
  plannedStartsAt: string | null;
  /** A one-off game the organizer added, with its optional note. */
  extra: boolean;
  note: string | null;
  /** When the booking window opens (14 days before play by default). */
  bookingOpensAt: string;
  shownEarly: boolean;
  holiday: string | null;
  /** Organizer confirmed the venue keeps normal hours that day. */
  holidayHoursOk: boolean;
  /** Day-before and last-call cards are inside their windows (and not marked Done). */
  cards: { dayBefore: boolean; lastCall: boolean };
  /** The organizer finalized who played. */
  finalized: { at: string; playedCount: number; priceCents: number; creditBackCents: number } | null;
  /** Over, not canceled, not finalized, and someone was in: shows the Finalize card. */
  needsFinalize: boolean;
  /** Reopen is blocked because some credit from this game was already used or refunded: who. */
  reopenBlockedBy: string[];
  eligibleSubstitutes: EligibleSubstitute[];
}

export interface AdminPlayer {
  id: string;
  name: string;
  phone: string | null;
  isRegular: boolean;
  isActive: boolean;
  canReceiveSubstituteInvites: boolean;
  sortOrder: number;
  /** 2 = Tuesday, 4 = Thursday. */
  usualDays: number[];
  /** Added their own name and the organizer hasn't reviewed them yet. */
  isNew: boolean;
  /** Organizer only: saved Venmo username (or "id:123") for refunds. Never sent to players. */
  venmo: string | null;
  /** Organizer only: how many times they dropped out late. */
  lateDrops: number;
  /** Organizer only: sessions they've played, ever. */
  played: number;
}

/** One line in History > Activity. */
export interface ActivityEntry {
  id: string;
  /** Who did it: a player's name, "organizer", or "organizer as Name". */
  actorLabel: string;
  action: string;
  details: Record<string, unknown>;
  createdAt: string;
  /** The session it was about, if any. */
  sessionStartsAt: string | null;
}

export interface ActivityPage {
  entries: ActivityEntry[];
  /** More, older entries exist (ask with ?before=<oldest createdAt>). */
  more: boolean;
}

export interface AuditEntry {
  id: string;
  sessionId: string | null;
  actorLabel: string;
  action: string;
  details: Record<string, unknown>;
  createdAt: string;
}

/** A player's refund request, for the organizer's Home card. */
export interface RefundRequestView {
  id: string;
  playerId: string;
  name: string;
  cents: number;
  createdAt: string;
  /** Organizer only: the player's saved Venmo, so the Refund button is addressed. */
  venmo: string | null;
}

export interface AdminDashboard {
  group: {
    name: string;
    timezone: string;
    venmoUrl: string | null;
    organizerName: string | null;
    venueName: string | null;
    venueAddress: string | null;
    firstSessionDate: string | null;
    settings: GroupSettings;
    /** What to send players: the plain site address when open, else the private link. */
    playerLink: string;
    /** The long private link; always works. */
    privateLink: string;
    openAccess: boolean;
    hasGroupWord: boolean;
  };
  players: AdminPlayer[];
  sessions: AdminSessionView[];
  audit: AuditEntry[];
  /** Upcoming sessions hidden by the first session date, which the organizer can show. */
  hiddenSessions: { id: string; startsAt: string; endsAt: string }[];
  /**
   * The credit pot per player who has any history: `balanceCents` is the pot, `reservedCents` is held
   * for a pending refund request, `refundCents` is what "Refund credit balance" pays back now, and every entry, oldest first.
   */
  creditLedger: { playerId: string; balanceCents: number; reservedCents: number; refundCents: number; entries: CreditEntryView[] }[];
  /** Refund requests waiting on the organizer, oldest first. */
  refundRequests: RefundRequestView[];
  /** The organizer's own player record, once they have one (their name from Settings). */
  me: { id: string; name: string } | null;
  /** Settings > Alerts: the switches and whether Telegram is set up. Never the token or chat ID. */
  alerts: {
    enabled: boolean;
    drop36: boolean;
    belowMin: boolean;
    reachedMin: boolean;
    refundRequests: boolean;
    finalizeReminder: boolean;
    connected: boolean;
    lastAt: string | null;
    lastOk: boolean | null;
    lastError: string | null;
  };
  now: string;
}

export interface ActionLinkDraft {
  playerId: string;
  name: string;
  phone: string | null;
  url: string;
}

export interface ActionTokenView {
  scope: 'attendance' | 'claim';
  playerName: string;
  timezone: string;
  session: { id: string; startsAt: string; endsAt: string; canceled: boolean; venueName: string | null; openSpots: number };
  myStatus: RosterStatus | null;
  attendanceConfirmed: boolean;
  valid: boolean;
  invalidReason: string | null;
}

/** The organizer's private monthly money page. Never sent to players. */
export interface MonthlyMoney {
  /** "2026-11" */
  month: string;
  /** "November 2026" */
  label: string;
  /** What the other players paid and the group kept, for finalized games this month. The organizer's own payment to the venue is never in here. */
  collectedCents: number;
  /** The full court cost of every session played. */
  courtCostCents: number;
  /** Credit still owed to players from this month's games (money that came back as credit and is not yet used or refunded). */
  creditsOwedCents: number;
  /** Paid by other players for games not finalized yet. Not in Collected until finalized. */
  heldCents: number;
  /** Collected minus court costs. Credit owed is money that was never collected, so it is not taken off. */
  netCents: number;
  /** Players paid more than the courts cost: the amount toward the membership. */
  surplusCents: number;
  /** Players paid less than the courts cost: what the organizer covered. */
  coveredCents: number;
  membershipCents: number;
  /** "Surplus: $14 toward the $30 membership" or "You covered $8 of the court costs" */
  bottomLine: string;
  sessions: {
    id: string;
    startsAt: string;
    endsAt: string;
    /**
     * played: finalized and counted. not_finalized: over, money still held. canceled / upcoming / not_played:
     * shown but not counted (a canceled game the venue charged for still counts its court cost).
     */
    state: 'played' | 'not_finalized' | 'canceled' | 'upcoming' | 'not_played';
    /** A canceled game the venue still charged for. */
    charged: boolean;
    collectedCents: number;
    courtCostCents: number;
    /** No cost entered on the session, so the typical cost was used. */
    typicalCost: boolean;
    /** Once finalized: how many played and the final price each. */
    playedCount: number | null;
    priceCents: number | null;
  }[];
}
