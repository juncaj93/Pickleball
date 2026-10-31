import type { BookingStatus } from './status';
import { formatShortDate } from './time';

/**
 * The court's status for a session card, kept apart from who's playing.
 * booked: green. needs: amber, not booked yet. waitlist: blue, on the venue's
 * court waitlist. later: quiet gray, not booked but the booking window
 * (14 days by default) hasn't opened. off: gray, canceled, no court, or
 * already played, with the reason.
 */
export type CourtKind = 'booked' | 'needs' | 'waitlist' | 'later' | 'off';

export interface CourtInput {
  canceled: boolean;
  started: boolean;
  past: boolean;
  bookingStatus: BookingStatus;
  courtState: 'waitlist' | 'opened' | 'not_opened' | null;
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

export function courtStatus(s: CourtInput, tz = 'America/Detroit'): CourtStatus {
  if (s.canceled && s.courtState === 'not_opened') return off("Court didn't open");
  if (s.canceled) return off('Canceled');
  if (s.past) return off('Played');
  if (s.bookingStatus === 'booked') return { kind: 'booked', text: 'Court booked', playerText: 'Court booked' };
  if (s.started) return off('Started, no court was booked');
  if (s.courtState === 'waitlist') return { kind: 'waitlist', text: 'Court waitlist', playerText: 'Court not booked' };
  if (s.bookingStatus === 'unavailable') return off('No court available');
  if (s.bookingOpen === false && s.bookingOpensAt) {
    return { kind: 'later', text: `Booking opens ${formatShortDate(s.bookingOpensAt, tz)}`, playerText: 'Court not booked' };
  }
  return { kind: 'needs', text: 'Court not booked', playerText: 'Court not booked' };
}

function off(reason: string): CourtStatus {
  return { kind: 'off', text: reason, playerText: reason };
}
