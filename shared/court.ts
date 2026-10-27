import type { BookingStatus } from './status';

/**
 * The court's status for a session card, kept apart from who's playing.
 * booked: green. needs: amber, not booked yet. waitlist: blue, on the venue's
 * court waitlist. off: gray, canceled, no court, or already played, with the reason.
 */
export type CourtKind = 'booked' | 'needs' | 'waitlist' | 'off';

export interface CourtInput {
  canceled: boolean;
  started: boolean;
  past: boolean;
  bookingStatus: BookingStatus;
  courtState: 'waitlist' | 'opened' | 'not_opened' | null;
}

export interface CourtStatus {
  kind: CourtKind;
  /** Organizer wording. */
  text: string;
  /** Player wording. */
  playerText: string;
}

export function courtStatus(s: CourtInput): CourtStatus {
  if (s.canceled && s.courtState === 'not_opened') return off("Court didn't open");
  if (s.canceled) return off('Canceled');
  if (s.past) return off('Played');
  if (s.bookingStatus === 'booked') return { kind: 'booked', text: 'Court booked', playerText: 'Court booked' };
  if (s.started) return off('Started, no court was booked');
  if (s.courtState === 'waitlist') return { kind: 'waitlist', text: 'On the court waitlist', playerText: 'Waiting on the court' };
  if (s.bookingStatus === 'unavailable') return off('No court available');
  return { kind: 'needs', text: 'Court not booked', playerText: 'Court not booked yet' };
}

function off(reason: string): CourtStatus {
  return { kind: 'off', text: reason, playerText: reason };
}

/** "0 of 4 in": counts toward 4, or toward 6 once more than 4 are in. */
export function playerSlots(confirmed: number): number {
  return confirmed > 4 ? 6 : 4;
}
