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
  paidCount: number;
  payableCount: number;
  /** Organizer's private record of the court cost. Never sent to players. */
  courtCostCents: number | null;
  courtState: 'waitlist' | 'opened' | 'not_opened' | null;
  /** Moved from its usual time (rescheduled). */
  moved: boolean;
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
  /** Organizer only: how many times they dropped out late. */
  lateDrops: number;
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
  collectedCents: number;
  courtCostCents: number;
  creditsOwedCents: number;
  /** Collected minus court costs minus credits owed. */
  netCents: number;
  membershipCents: number;
  /** "Surplus: $14 toward the $30 membership" or "Short: $8" */
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
