import { type GroupSettings, SPOTS_PER_SESSION } from './settings';

export type SessionRecordStatus = 'planned' | 'booked' | 'canceled' | 'completed';
export type BookingStatus = 'needs_booking' | 'booked' | 'unavailable';
export type AdminDecision = 'try_fill' | 'keep' | null;

export interface StatusInput {
  startsAt: string;
  endsAt: string;
  status: SessionRecordStatus;
  bookingStatus: BookingStatus;
  cancellationDeadlineAt: string | null;
  adminDecision: AdminDecision;
  confirmedCount: number;
  unconfirmedAttendanceCount: number; // confirmed players who haven't tapped "Confirm I'm in"
}

export type StatusLabel =
  | 'canceled'
  | 'completed'
  | 'in_progress'
  | 'decision_needed'
  | 'deadline_passed'
  | 'deadline_approaching'
  | 'needs_booking'
  | 'court_unavailable'
  | 'needs_players'
  | 'on_track';

export const STATUS_TEXT: Record<StatusLabel, string> = {
  canceled: 'Canceled',
  completed: 'Played',
  in_progress: 'Playing now',
  decision_needed: 'Decision needed',
  deadline_passed: 'Deadline passed',
  deadline_approaching: 'Deadline approaching',
  needs_booking: 'Needs booking',
  court_unavailable: 'Court not available',
  needs_players: 'Needs players',
  on_track: 'On track',
};

export type Tone = 'ok' | 'warn' | 'danger' | 'info' | 'muted';

export const STATUS_TONE: Record<StatusLabel, Tone> = {
  canceled: 'muted',
  completed: 'muted',
  in_progress: 'ok',
  decision_needed: 'danger',
  deadline_passed: 'danger',
  deadline_approaching: 'warn',
  needs_booking: 'warn',
  court_unavailable: 'danger',
  needs_players: 'info',
  on_track: 'ok',
};

export interface SessionFlags {
  canceled: boolean;
  past: boolean;
  started: boolean;
  needsBooking: boolean; // not booked and inside the booking lead window
  bookingWindowOpen: boolean;
  courtUnavailable: boolean;
  underfilled: boolean;
  openSpots: number;
  noDeadlineRecorded: boolean;
  inWarningWindow: boolean;
  deadlinePassed: boolean;
  decisionNeeded: boolean;
  confirmationsDue: boolean;
}

export interface SessionState {
  label: StatusLabel;
  text: string;
  tone: Tone;
  flags: SessionFlags;
}

const HOUR = 3600_000;
const DAY = 24 * HOUR;

/**
 * Derive a session's status from stored timestamps and counts. Called every
 * time a page loads, so nothing depends on a page having stayed open or a
 * background job having run.
 */
export function computeSessionState(s: StatusInput, nowMs: number, settings: GroupSettings): SessionState {
  const start = Date.parse(s.startsAt);
  const end = Date.parse(s.endsAt);
  const canceled = s.status === 'canceled';
  const past = nowMs >= end || s.status === 'completed';
  const started = nowMs >= start;
  const live = !canceled && !started;
  const bookingWindowOpen = nowMs >= start - settings.bookingLeadDays * DAY;
  const booked = s.bookingStatus === 'booked';
  const openSpots = Math.max(0, SPOTS_PER_SESSION - s.confirmedCount);
  const underfilled = live && openSpots > 0;
  const deadline = s.cancellationDeadlineAt ? Date.parse(s.cancellationDeadlineAt) : null;
  const inWarningWindow = live && booked && deadline !== null && nowMs >= deadline - settings.warningWindowHours * HOUR;
  const deadlinePassed = live && booked && deadline !== null && nowMs >= deadline;

  const flags: SessionFlags = {
    canceled,
    past,
    started,
    needsBooking: live && s.bookingStatus === 'needs_booking' && bookingWindowOpen,
    bookingWindowOpen,
    courtUnavailable: live && s.bookingStatus === 'unavailable',
    underfilled,
    openSpots: live ? openSpots : 0,
    noDeadlineRecorded: live && booked && deadline === null,
    inWarningWindow,
    deadlinePassed,
    decisionNeeded: underfilled && inWarningWindow && s.adminDecision === null,
    confirmationsDue:
      live && nowMs >= start - settings.confirmationLeadHours * HOUR && s.unconfirmedAttendanceCount > 0,
  };

  let label: StatusLabel;
  if (canceled) label = 'canceled';
  else if (past) label = 'completed';
  else if (started) label = 'in_progress';
  else if (flags.decisionNeeded) label = 'decision_needed';
  else if (underfilled && deadlinePassed) label = 'deadline_passed';
  else if (underfilled && inWarningWindow) label = 'deadline_approaching';
  else if (flags.needsBooking) label = 'needs_booking';
  else if (flags.courtUnavailable) label = 'court_unavailable';
  else if (underfilled) label = 'needs_players';
  else label = 'on_track';

  return { label, text: STATUS_TEXT[label], tone: STATUS_TONE[label], flags };
}
