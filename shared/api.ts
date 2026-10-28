// Shapes of the JSON the API returns. Shared by server and browser.
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
  openSpots: number;
  /** "3 going · 1 more needed", "5 going · need 4 or 6", "6 going" */
  goingText: string;
  /** What the big button does for someone not in yet. */
  joinAs: 'in' | 'waitlist';
  sixPlaying: boolean;
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
  confirmationOpen: boolean;
  mine: null | {
    status: RosterStatus;
    waitlistPosition: number | null;
    attendanceConfirmed: boolean;
    /** Moved in from the waitlist: show the "Good news" line. */
    promotion: 'made_six' | 'spot_opened' | null;
    /** Price for this session before any credit ($14, or $9 with the 6-person discount). */
    shareCents: number | null;
    paymentStatus: PaymentStatus;
    /** They tapped "I paid" themselves. */
    selfPaid: boolean;
    /** When this sign-up started. A fresh "I'm in" after "I'm out" gets a new one. */
    signupAt: string;
    /** One of the last two of six, paying the discounted price. */
    discount: boolean;
    /** One of the first four of six: earns a credit if 6 play. */
    creditComing: boolean;
    /** What they still owe for this session, after any credit (0 when paid). */
    oweCents: number;
    /** Credit coming off this session. */
    creditCents: number;
  };
}

export interface GroupView {
  group: { name: string; timezone: string; venmoUrl: string | null; organizerName: string | null; priceCents: number; creditCents: number };
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
    /** What they actually owe, after any credit. */
    amountCents: number;
    creditCents: number;
    discount: boolean;
    reminder: boolean;
    /** When this sign-up started (see `mine.signupAt`). */
    signupAt: string;
  }[];
  /**
   * What to pay now, for the card at the top of the screen: owed sessions
   * whose game day has reached 8:00 AM. Nothing before that.
   */
  payDue: GroupView['owed'];
  /** Credit waiting for a future session they haven't signed up for yet. */
  creditBalanceCents: number;
  /** "Want in on Tuesday?" for a usual day the player hasn't answered yet. */
  suggestion: { sessionId: string; startsAt: string; endsAt: string; joinAs: 'in' | 'waitlist'; holiday: string | null } | null;
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
  paymentAmountCents: number | null;
  shareCents: number | null;
  waitlistPosition: number | null;
  promotedAt: string | null;
  refundedAt: string | null;
  /** Dropped out after the day-before check-in opened. */
  lateDropAt: string | null;
  lateDropDoneAt: string | null;
  promotionReason: 'made_six' | 'spot_opened' | null;
  promotionNotifiedAt: string | null;
  /** Last two of six. */
  discount: boolean;
  /** Credit coming off this seat (planned if unpaid). */
  creditCents: number;
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
  /** What the other players owe for this session under the usual rules. */
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
  courtState: 'waitlist' | 'opened' | 'not_opened' | null;
  /** Moved from its usual time (rescheduled). */
  moved: boolean;
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
  /** Had 6 (discount shown), now fewer: the organizer should sort out payments by hand. */
  sixDropped: boolean;
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
  /** Open credit per player (earned, not yet used or cleared). */
  credits: { playerId: string; name: string; balanceCents: number }[];
  /** The organizer's own player record, once they have one (their name from Settings). */
  me: { id: string; name: string } | null;
  /** Settings > Alerts: the switches and whether Telegram is set up. Never the token or chat ID. */
  alerts: {
    enabled: boolean;
    drop36: boolean;
    belowMin: boolean;
    reachedSix: boolean;
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
  /** What the other players paid. The organizer's own payment to the venue is never in here. */
  collectedCents: number;
  /** The full court cost of every session played. */
  courtCostCents: number;
  creditsOwedCents: number;
  /** Paid by other players for games not played yet (or canceled and not refunded yet). Not in Collected until played. */
  heldCents: number;
  /** Collected minus court costs minus credits owed. */
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
    /** played: counted. canceled / upcoming / not_played: shown but not counted. */
    state: 'played' | 'canceled' | 'upcoming' | 'not_played';
    collectedCents: number;
    courtCostCents: number;
    /** No cost entered on the session, so the typical cost was used. */
    typicalCost: boolean;
  }[];
}
