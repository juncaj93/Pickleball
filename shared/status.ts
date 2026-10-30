import type { GroupSettings } from './settings';
import { MIN_PLAYERS, openSpots as spotsOpen, playersNeeded } from './spots';
import { BOOKING_PROMPT_HOUR, bookingOpensMs, DEFAULT_TIMEZONE } from './time';

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
  /** The venue's court waitlist: 'waitlist', 'opened', 'not_opened', or null. */
  courtState?: 'waitlist' | 'opened' | 'not_opened' | null;
  confirmedCount: number;
  waitlistCount: number;
  unconfirmedAttendanceCount: number; // confirmed players who haven't checked in yet
}

export type StatusLabel =
  | 'court_not_opened'
  | 'court_waitlist'
  | 'canceled'
  | 'completed'
  | 'in_progress'
  | 'deadline_passed'
  | 'short_on_players'
  | 'needs_booking'
  | 'court_unavailable'
  | 'needs_players'
  | 'on_track';

export const STATUS_TEXT: Record<StatusLabel, string> = {
  court_not_opened: "Court didn't open",
  court_waitlist: 'Waiting on the court',
  canceled: 'Canceled',
  completed: 'Played',
  in_progress: 'Playing now',
  deadline_passed: 'Deadline passed',
  short_on_players: 'Short on players',
  needs_booking: 'Needs booking',
  court_unavailable: 'Court not available',
  needs_players: 'Needs players',
  on_track: 'On track',
};

export type Tone = 'ok' | 'warn' | 'danger' | 'info' | 'muted';

export const STATUS_TONE: Record<StatusLabel, Tone> = {
  court_not_opened: 'muted',
  court_waitlist: 'info',
  canceled: 'muted',
  completed: 'muted',
  in_progress: 'ok',
  deadline_passed: 'danger',
  short_on_players: 'warn',
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
  /** Needs booking and it's 7:00 AM or later on the day booking opened: counts on the Home badge. */
  bookingPromptDue: boolean;
  courtUnavailable: boolean;
  underfilled: boolean; // fewer than 4
  /** Spots left before the game is full (the max in Settings). */
  openSpots: number;
  /** How many more are needed to reach 4. */
  playersNeeded: number;
  /** At the max: anyone else waits. */
  full: boolean;
  /** The day-before check-in has started (default 24 hours before play). */
  inCheckIn: boolean;
  deadlinePassed: boolean;
  /** Needs players inside the check-in window, and the organizer hasn't chosen to keep it as is. */
  shortOnPlayers: boolean;
  checkInsDue: boolean;
}

export interface SessionState {
  label: StatusLabel;
  text: string;
  tone: Tone;
  flags: SessionFlags;
}

const HOUR = 3600_000;

/**
 * Derive a session's status from stored timestamps and counts. Called every
 * time a page loads, so nothing depends on a page having stayed open or a
 * background job having run.
 *
 * The flow: at the check-in mark (24 hours before by default) the session is
 * flagged if it needs players and check-in texts become due. Until the
 * cancellation deadline (12 hours before by default) the organizer can
 * reschedule or cancel. After that it shows "Deadline passed".
 */
export function computeSessionState(s: StatusInput, nowMs: number, settings: GroupSettings, tz = DEFAULT_TIMEZONE): SessionState {
  const start = Date.parse(s.startsAt);
  const end = Date.parse(s.endsAt);
  const canceled = s.status === 'canceled';
  const past = nowMs >= end || s.status === 'completed';
  const started = nowMs >= start;
  const live = !canceled && !started;
  const bookingWindowOpen = nowMs >= bookingOpensMs(s.startsAt, settings.bookingLeadDays, tz);
  const openSpots = spotsOpen(s.confirmedCount, settings.maxPlayers);
  const underfilled = live && s.confirmedCount < MIN_PLAYERS;
  const deadline = s.cancellationDeadlineAt ? Date.parse(s.cancellationDeadlineAt) : null;
  const inCheckIn = live && nowMs >= start - settings.checkInHours * HOUR;
  const deadlinePassed = live && deadline !== null && nowMs >= deadline;
  const shortOnPlayers = underfilled && inCheckIn && s.adminDecision !== 'keep' && s.courtState !== 'waitlist';

  const needsBooking = live && s.bookingStatus === 'needs_booking' && s.courtState !== 'waitlist' && bookingWindowOpen;
  const flags: SessionFlags = {
    canceled,
    past,
    started,
    needsBooking,
    bookingWindowOpen,
    bookingPromptDue: needsBooking && nowMs >= bookingOpensMs(s.startsAt, settings.bookingLeadDays, tz, BOOKING_PROMPT_HOUR),
    courtUnavailable: live && s.bookingStatus === 'unavailable',
    underfilled,
    openSpots: live ? openSpots : 0,
    playersNeeded: live ? playersNeeded(s.confirmedCount) : 0,
    full: live && s.confirmedCount >= settings.maxPlayers,
    inCheckIn,
    deadlinePassed,
    shortOnPlayers,
    checkInsDue: inCheckIn && s.unconfirmedAttendanceCount > 0,
  };

  let label: StatusLabel;
  if (canceled && s.courtState === 'not_opened') label = 'court_not_opened';
  else if (canceled) label = 'canceled';
  else if (past) label = 'completed';
  else if (started) label = 'in_progress';
  else if (s.courtState === 'waitlist') label = 'court_waitlist';
  else if (shortOnPlayers && deadlinePassed) label = 'deadline_passed';
  else if (shortOnPlayers) label = 'short_on_players';
  else if (flags.needsBooking) label = 'needs_booking';
  else if (flags.courtUnavailable) label = 'court_unavailable';
  else if (underfilled) label = 'needs_players';
  else label = 'on_track';

  return { label, text: STATUS_TEXT[label], tone: STATUS_TONE[label], flags };
}
