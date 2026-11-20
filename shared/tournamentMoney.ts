// Zip 70 (🎾70.time): the organizer's money line, the Plan's expected players and the players' time card words. Its own file on purpose: the
// player download reads shared/tournament.ts, so these organizer and server pieces stay out of it (tests/zip48-split.test.ts's size budget).
import { courtCentsOf, MAX_SPOTS, shortClock } from './tournament';

/** The Plan box's Expect stepper runs 6 to 16. */
export const EXPECT_MIN = 6;
export const EXPECT_MAX = MAX_SPOTS;

/**
 * The players the Plan expects: the organizer's saved number, else the site's suggestion (the real count: planCount), never fewer than the
 * players already locked in, held to 6..16.
 */
export function expectedPlayers(o: { saved: number | null; suggested: number; locked: number }): number {
  const base = o.saved ?? o.suggested;
  return Math.min(EXPECT_MAX, Math.max(EXPECT_MIN, Math.round(base), Math.round(o.locked)));
}

/** A saved Expect number as stored (task_log detail), or null for none or anything that is not a whole number from 6 to 16. */
export function savedExpect(detail: string | null | undefined): number | null {
  if (typeof detail !== 'string' || !/^\d{1,2}$/.test(detail.trim())) return null;
  const n = Number(detail.trim());
  return n >= EXPECT_MIN && n <= EXPECT_MAX ? n : null;
}

export interface MoneyLine {
  /** Courts x hours x the court rate ($24 per court per hour). */
  courtCents: number;
  /** (expected players minus the organizer, who plays free) x the ticket price. */
  ticketsCents: number;
  /** Tickets minus Courts minus the winners' credits now set. 0 or more: the organizer makes it; below 0: it costs them. */
  youCents: number;
}

/** THE money line (Alex's rule): Courts, Tickets, and what the organizer makes (or pays) if the night fills to the expected players. */
export function moneyLine(o: { expected: number; courts: number; minutes: number; ticketCents: number; prizeCents: number }): MoneyLine {
  const courtCents = courtCentsOf({ courts: o.courts, minutes: o.minutes });
  const ticketsCents = Math.max(0, Math.round(o.expected) - 1) * o.ticketCents;
  return { courtCents, ticketsCents, youCents: ticketsCents - courtCents - o.prizeCents };
}

/** The money row's label: "You make if it fills" (0 or more) or "Your cost if it fills". */
export const moneyRowLabel = (youCents: number): string => (youCents >= 0 ? 'You make if it fills' : 'Your cost if it fills');

/**
 * Zip 70 (picture 6): the players' card when the organizer moves the time: "The Cold Open now ends at 9:30 PM (was 10 PM)." or "now starts at 8 PM
 * (was 7:30 PM)." (both: "now starts at 8 PM (was 7:30 PM) and ends at 10:30 PM (was 10 PM)."), with "Based on the number of players locked in."
 */
export function timeMoveWords(name: string, from: { start: number; minutes: number }, to: { start: number; minutes: number }): { title: string; sub: string } | null {
  const startMoved = from.start !== to.start;
  const endMoved = from.start + from.minutes !== to.start + to.minutes;
  const starts = `starts at ${shortClock(to.start)} (was ${shortClock(from.start)})`;
  const ends = `ends at ${shortClock(to.start + to.minutes)} (was ${shortClock(from.start + from.minutes)})`;
  const what = startMoved && endMoved ? `${starts} and ${ends}` : startMoved ? starts : endMoved ? ends : null;
  return what ? { title: `${name} now ${what}.`, sub: 'Based on the number of players locked in.' } : null;
}

