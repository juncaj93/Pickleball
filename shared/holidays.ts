import { localParts } from './time';

// US holidays that can change venue hours, built into the site (no outside
// service). Dates are calendar dates in the group's time zone.

/** Day of the month for the nth weekday (0 = Sunday) of a month; n = -1 means the last one. */
function nthWeekday(year: number, month: number, weekday: number, n: number): number {
  if (n > 0) {
    const first = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
    return 1 + ((weekday - first + 7) % 7) + (n - 1) * 7;
  }
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const lastWeekday = new Date(Date.UTC(year, month - 1, lastDay)).getUTCDay();
  return lastDay - ((lastWeekday - weekday + 7) % 7);
}

/** Holiday name for a calendar date, or null. Month is 1-12. */
export function holidayOn(year: number, month: number, day: number): string | null {
  const md = `${month}-${day}`;
  const fixed: Record<string, string> = {
    '1-1': "New Year's Day",
    '7-4': 'July 4',
    '12-24': 'Christmas Eve',
    '12-25': 'Christmas Day',
    '12-31': "New Year's Eve",
  };
  if (fixed[md]) return fixed[md];
  if (month === 5 && day === nthWeekday(year, 5, 1, -1)) return 'Memorial Day';
  if (month === 9 && day === nthWeekday(year, 9, 1, 1)) return 'Labor Day';
  if (month === 11) {
    const thanksgiving = nthWeekday(year, 11, 4, 4);
    if (day === thanksgiving) return 'Thanksgiving';
    if (day === thanksgiving - 1) return 'Day before Thanksgiving';
    // First Tuesday after the first Monday in November.
    if (day === nthWeekday(year, 11, 1, 1) + 1) return 'Election Day';
  }
  return null;
}

/** Holiday for the local calendar date a session starts on. */
export function holidayFor(iso: string, tz: string): string | null {
  const p = localParts(Date.parse(iso), tz);
  return holidayOn(p.year, p.month, p.day);
}
