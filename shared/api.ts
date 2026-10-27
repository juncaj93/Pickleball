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
  confirmationOpen: boolean;
  mine: null | {
    status: RosterStatus;
    waitlistPosition: number | null;
    attendanceConfirmed: boolean;
    /** Moved in from the waitlist: show the "Good news" line. */
    promotion: 'made_six' | 'spot_opened' | null;
    shareCents: number | null;
    paymentStatus: PaymentStatus;
    /** Coming back to them because 6 played. */
    refundCents: number | null;
  };
}

export interface GroupView {
  group: { name: string; timezone: string; venmoUrl: string | null; organizerName: string | null; priceCents: number };
  players: { id: string; name: string }[];
  me: { id: string; name: string } | null;
  /** True when the organizer is looking through this player's eyes. */
  viewingAs: boolean;
  now: string;
  sessions: PlayerSessionView[];
  /** Confirmed, unpaid sessions. `reminder` only once the session ended more than 24 hours ago. */
  owed: { sessionId: string; startsAt: string; endsAt: string; amountCents: number; reminder: boolean }[];
  /** "Want in on Tuesday?" for a usual day the player hasn't answered yet. */
  suggestion: { sessionId: string; startsAt: string; endsAt: string; joinAs: 'in' | 'waitlist' } | null;
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
  promotionReason: 'made_six' | 'spot_opened' | null;
  promotionNotifiedAt: string | null;
  refundedAt: string | null;
}

export interface RefundDue {
  playerId: string;
  name: string;
  amountCents: number;
  refunded: boolean;
  /** `six`: 6 played. `dropped`: paid, then left the session. */
  reason: 'six' | 'dropped';
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
  refunds: RefundDue[];
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
    settings: GroupSettings;
    playerLink: string;
  };
  players: AdminPlayer[];
  sessions: AdminSessionView[];
  audit: AuditEntry[];
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
