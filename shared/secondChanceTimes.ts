// Second Chance step 2's start times (Zip 15, Zip 35 A-11, Zip 81). Its own file since Zip 81, so the player screen's script (which reads only
// the Second Chance switch names from shared/secondChance.ts) never carries the venue hours code: only the organizer screens and the server
// import this.
import { dateKeyOf, dayRule, lengthFits, type VenueHoursConfig } from './bookingHours';
import { dayKey, PICK_FIRST_MIN, PICK_LAST_MIN, PICK_STEP_MIN } from './secondChance';
import { localParts } from './time';

/**
 * Step 2's choices: every half hour from 4:00 PM to 9:30 PM still in the future, plus the game's own time. Minutes after midnight.
 * `fit` (only while Booking hours is on, Zip 35): the game's length. Then only a start whose END is also inside the venue hours of the
 * game's date is offered (a 2 hour game: nothing after 8:00 PM Monday to Saturday, nothing after 5:00 PM on Sunday), the game's own
 * time included. Without `fit` the list is exactly what it always was.
 */
export function pickTimes(startsAt: string, tz: string, nowMs: number, fit?: { lengthMs: number; hours?: VenueHoursConfig | null }): number[] {
  const own = localParts(Date.parse(startsAt), tz);
  const ownMin = own.hour * 60 + own.minute;
  const nowParts = localParts(nowMs, tz);
  const today = dayKey(nowMs, tz) === dayKey(Date.parse(startsAt), tz);
  const nowMin = today ? nowParts.hour * 60 + nowParts.minute : -1;
  const out = new Set<number>([ownMin]);
  for (let m = PICK_FIRST_MIN; m <= PICK_LAST_MIN; m += PICK_STEP_MIN) if (m > nowMin) out.add(m);
  const all = [...out].sort((a, b) => a - b);
  if (!fit) return all;
  const lengthMin = fit.lengthMs / 60_000;
  // Zip 81: the hours of the game's own DATE (special hours too) when they are known; else the normal table, as before.
  const day = fit.hours ? dayRule(fit.hours, dateKeyOf(Date.parse(startsAt), tz)) : own.weekday;
  return all.filter((m) => lengthFits(day, m, lengthMin));
}

