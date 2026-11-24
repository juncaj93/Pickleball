import type { BookingStatus } from './status';
import { formatShortDate } from './time';

/**
 * The court's status for a session card, kept apart from who's playing.
 * booked: green. needs: amber, not booked yet. later: quiet gray, not booked but the booking window
 * (14 days by default) hasn't opened. off: gray, canceled, no court, or
 * already played, with the reason.
 * Zip 86 (Alex): no court Waitlist any more, anywhere. A game saved on the old waitlist (booking 'unavailable' or court_state 'waitlist')
 * reads and acts as Not booked; no migration.
 */
export type CourtKind = 'booked' | 'needs' | 'later' | 'off';

export interface CourtInput {
  canceled: boolean;
  started: boolean;
  past: boolean;
  bookingStatus: BookingStatus;
  courtState: 'opened' | 'not_opened' | null;
  /** Inside the booking window. Left out means open. */
  bookingOpen?: boolean;
  /** When the booking window opens (start minus the booking lead days). */
  bookingOpensAt?: string;
}

export interface CourtStatus {
  kind: CourtKind;
  /** Organizer wording. */
  text: string;
  /** Player wording. */
  playerText: string;
}

/** The organizer's court status: Booked or Not booked (Zip 86: no Waitlist). */
export type CourtSwitch = 'not_booked' | 'booked';

export function courtSwitchOf(s: { bookingStatus: BookingStatus }): CourtSwitch {
  return s.bookingStatus === 'booked' ? 'booked' : 'not_booked';
}

/** Zip 86: what the screens get from a stored row: the old court waitlist values read as Not booked ('unavailable' as 'needs_booking',
 *  court_state 'waitlist' as none). */
export function shownCourt<T extends string | null>(bookingStatus: BookingStatus, courtState: T | 'waitlist'): { bookingStatus: BookingStatus; courtState: Exclude<T, 'waitlist'> | null } {
  return { bookingStatus: bookingStatus === 'unavailable' ? 'needs_booking' : bookingStatus, courtState: courtState === 'waitlist' ? null : (courtState as Exclude<T, 'waitlist'>) };
}

export function courtStatus(s: CourtInput, tz = 'America/Detroit'): CourtStatus {
  if (s.canceled && s.courtState === 'not_opened') return off("Court didn’t open");
  if (s.canceled) return off('Canceled');
  if (s.past) return off('Played');
  if (s.bookingStatus === 'booked') return { kind: 'booked', text: 'Court booked', playerText: 'Court booked' };
  if (s.started) return off('Started, no court was booked');
  if (s.bookingOpen === false && s.bookingOpensAt) {
    return { kind: 'later', text: `Booking opens ${formatShortDate(s.bookingOpensAt, tz)}`, playerText: 'Court not booked' };
  }
  return { kind: 'needs', text: 'Court not booked', playerText: 'Court not booked' };
}

function off(reason: string): CourtStatus {
  return { kind: 'off', text: reason, playerText: reason };
}
