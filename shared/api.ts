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
  courtCostCents: number | null;
  confirmed: { name: string; attendanceConfirmed: boolean }[];
  waitlist: { name: string }[];
  openSpots: number;
  confirmationOpen: boolean;
  mine: null | {
    status: RosterStatus;
    waitlistPosition: number | null;
    attendanceConfirmed: boolean;
    shareCents: number | null;
    paymentStatus: PaymentStatus;
  };
}

export interface GroupView {
  group: { name: string; timezone: string; venmoUrl: string | null };
  players: { id: string; name: string }[];
  me: { id: string; name: string } | null;
  now: string;
  sessions: PlayerSessionView[];
  owed: { sessionId: string; startsAt: string; endsAt: string; amountCents: number }[];
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
  /** Paid amount minus current share, when they differ (cost changed or player withdrew). */
  paymentDifferenceCents: number | null;
  waitlistPosition: number | null;
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
  courtCostCents: number | null;
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
  /** Share of the cost not covered because fewer than four played. */
  uncoveredCents: number;
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
