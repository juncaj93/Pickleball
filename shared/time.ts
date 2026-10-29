// Time zone helpers built on Intl, so no date library is needed.
// Everything is stored in UTC and shown in the group's time zone with a
// 12-hour clock.

export const DEFAULT_TIMEZONE = 'America/Detroit';

// US zones offered in settings. UTC is deliberately not offered.
export const TIMEZONE_OPTIONS: { value: string; label: string }[] = [
  { value: 'America/Detroit', label: 'Eastern (Detroit)' },
  { value: 'America/New_York', label: 'Eastern (New York)' },
  { value: 'America/Chicago', label: 'Central' },
  { value: 'America/Denver', label: 'Mountain' },
  { value: 'America/Phoenix', label: 'Mountain (Arizona, no DST)' },
  { value: 'America/Los_Angeles', label: 'Pacific' },
  { value: 'America/Anchorage', label: 'Alaska' },
  { value: 'Pacific/Honolulu', label: 'Hawaii' },
];

export function isValidTimezone(tz: string): boolean {
  return TIMEZONE_OPTIONS.some((o) => o.value === tz);
}

const partsFormatters = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(tz: string): Intl.DateTimeFormat {
  let f = partsFormatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      weekday: 'short',
    });
    partsFormatters.set(tz, f);
  }
  return f;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export interface LocalParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number; // 0 = Sunday
}

export function localParts(utcMs: number, tz: string): LocalParts {
  const parts = partsFormatter(tz).formatToParts(new Date(utcMs));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '0';
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    hour: Number(get('hour')) % 24,
    minute: Number(get('minute')),
    second: Number(get('second')),
    weekday: WEEKDAYS.indexOf(get('weekday')),
  };
}

function offsetMs(utcMs: number, tz: string): number {
  const p = localParts(utcMs, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

/** Convert a wall-clock time in `tz` to a UTC timestamp (ms). DST-aware. */
export function zonedTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  tz: string,
): number {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const first = offsetMs(guess, tz);
  let result = guess - first;
  const second = offsetMs(result, tz);
  if (second !== first) result = guess - second;
  return result;
}

function fmt(tz: string, opts: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat('en-US', { timeZone: tz, hour12: true, ...opts });
}

/** "Tuesday" */
export function formatWeekday(iso: string, tz: string): string {
  return fmt(tz, { weekday: 'long' }).format(new Date(iso));
}

/** "Tue, Oct 28" */
export function formatShortDate(iso: string, tz: string): string {
  return fmt(tz, { weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(iso));
}

/** "Oct 28" */
export function formatMonthDay(iso: string, tz: string): string {
  return fmt(tz, { month: 'short', day: 'numeric' }).format(new Date(iso));
}

/** "8:00 PM" */
export function formatTime(iso: string, tz: string): string {
  return fmt(tz, { hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
}

/** "EDT" or "EST" */
export function zoneAbbreviation(iso: string, tz: string): string {
  const parts = fmt(tz, { hour: 'numeric', timeZoneName: 'short' }).formatToParts(new Date(iso));
  return parts.find((p) => p.type === 'timeZoneName')?.value ?? '';
}

/**
 * "8:00 to 10:00 PM". No EST/EDT: everyone is in Michigan, and Settings
 * says the times are Eastern.
 */
export function formatTimeRange(startIso: string, endIso: string, tz: string): string {
  const start = formatTime(startIso, tz);
  const end = formatTime(endIso, tz);
  const left = start.slice(-2) === end.slice(-2) ? start.slice(0, -3) : start;
  return `${left} to ${end}`;
}

/** "Tue, Oct 28, 8:00 AM" */
export function formatDateTime(iso: string, tz: string): string {
  return `${formatShortDate(iso, tz)}, ${formatTime(iso, tz)}`;
}

/** Value for <input type="datetime-local"> in the group's zone: "2026-10-28T08:00" */
export function toLocalInputValue(iso: string, tz: string): string {
  const p = localParts(Date.parse(iso), tz);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

/** Parse a datetime-local value as wall-clock time in the group's zone. */
export function fromLocalInputValue(value: string, tz: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
  if (!m) return null;
  const ms = zonedTimeToUtc(Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5]), tz);
  return new Date(ms).toISOString();
}

/** "2 days 4 hr", "5 hr 20 min", "12 min" for a positive duration. */
export function formatDuration(ms: number): string {
  const totalMin = Math.max(0, Math.floor(ms / 60000));
  const days = Math.floor(totalMin / 1440);
  const hours = Math.floor((totalMin % 1440) / 60);
  const mins = totalMin % 60;
  if (days > 0) return hours > 0 ? `${days} day${days === 1 ? '' : 's'} ${hours} hr` : `${days} day${days === 1 ? '' : 's'}`;
  if (hours > 0) return mins > 0 ? `${hours} hr ${mins} min` : `${hours} hr`;
  return `${mins} min`;
}

/** "in 5 hr 20 min" or "2 hr ago" */
export function formatRelative(targetIso: string, nowMs: number): string {
  const diff = Date.parse(targetIso) - nowMs;
  return diff >= 0 ? `in ${formatDuration(diff)}` : `${formatDuration(-diff)} ago`;
}

const DAY_MS = 24 * 3600_000;

/** Days since 1970 of the Monday that starts this date's week, in the group's time zone. */
export function weekStart(iso: string | number, tz: string): number {
  const p = localParts(typeof iso === 'number' ? iso : Date.parse(iso), tz);
  return Date.UTC(p.year, p.month - 1, p.day) / DAY_MS - ((p.weekday + 6) % 7);
}

/**
 * How muted a session's card looks: 0 for this week and next week (and the
 * past), then 1, 2, 3 for each later week. Done with lighter colors, never
 * by fading text.
 */
export function weekFade(iso: string, nowMs: number, tz: string): 0 | 1 | 2 | 3 {
  const weeks = (weekStart(iso, tz) - weekStart(nowMs, tz)) / 7;
  return weeks <= 1 ? 0 : (Math.min(weeks - 1, 3) as 1 | 2 | 3);
}

/** "This week", "Next week", "Last week", or "Week of Nov 9". */
export function weekLabel(iso: string, nowMs: number, tz: string): string {
  const diff = weekStart(iso, tz) - weekStart(nowMs, tz);
  if (diff === 0) return 'This week';
  if (diff === 7) return 'Next week';
  if (diff === -7) return 'Last week';
  const monday = new Date(weekStart(iso, tz) * DAY_MS);
  return `Week of ${monday.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}`;
}

/** The organizer is reminded to book a newly opened court from this hour (7:00 AM local) on the day it opens. */
export const BOOKING_PROMPT_HOUR = 7;

/**
 * When a session opens to book: 12:00 AM local on the calendar day that is
 * `leadDays` days before the game. Counted by date, not by hours, so a Tue
 * game is open all day on the Tue two weeks before, across clock changes.
 */
export function bookingOpensMs(startsAt: string, leadDays: number, tz: string, hour = 0): number {
  const p = localParts(Date.parse(startsAt), tz);
  const d = new Date(Date.UTC(p.year, p.month - 1, p.day - leadDays));
  return zonedTimeToUtc(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), hour, 0, tz);
}

export interface PlayerDay {
  /** "tonight", "tomorrow", "this Thursday", "next Tuesday", or "Thu, Nov 12". */
  word: string;
  /** What goes before a waitlist: "tonight's", "tomorrow's", "this Thursday's", "next Tuesday's", or "the Nov 12". */
  waitlistOf: string;
  /** A date (not a day word): reads "on Thu, Nov 12". */
  isDate: boolean;
}

/**
 * How a player-facing sentence names an upcoming game, by calendar days in the
 * group's zone and the same Monday to Sunday weeks as "This week" and "Next
 * week": today "tonight", the next day "tomorrow", later this week "this
 * Thursday", next week "next Tuesday", after that the date.
 */
export function playerDay(iso: string, tz: string, nowMs: number): PlayerDay {
  const g = localParts(Date.parse(iso), tz);
  const n = localParts(nowMs, tz);
  const num = (p: { year: number; month: number; day: number }) => Date.UTC(p.year, p.month - 1, p.day) / DAY_MS;
  const gap = num(g) - num(n);
  if (gap === 0) return { word: 'tonight', waitlistOf: "tonight's", isDate: false };
  if (gap === 1) return { word: 'tomorrow', waitlistOf: "tomorrow's", isDate: false };
  const weeks = gap > 1 ? (weekStart(iso, tz) - weekStart(nowMs, tz)) / 7 : NaN;
  const weekday = formatWeekday(iso, tz);
  if (weeks === 0) return { word: `this ${weekday}`, waitlistOf: `this ${weekday}'s`, isDate: false };
  if (weeks === 1) return { word: `next ${weekday}`, waitlistOf: `next ${weekday}'s`, isDate: false };
  return { word: formatShortDate(iso, tz), waitlistOf: `the ${formatMonthDay(iso, tz)}`, isDate: true };
}

/** "Want in tonight?", "Want in on Thu, Nov 12?", "Want in on next Tuesday's waitlist?", "Want in on the Nov 12 waitlist?" */
export function wantInTitle(iso: string, tz: string, nowMs: number, waitlist: boolean): string {
  const d = playerDay(iso, tz, nowMs);
  if (waitlist) return `Want in on ${d.waitlistOf} waitlist?`;
  return `Want in ${d.isDate ? 'on ' : ''}${d.word}?`;
}

/** The second line of the "Want in?" popup, by how many are in. Empty for 0 in. */
export function wantInSubline(confirmedCount: number, maxPlayers: number): string {
  if (confirmedCount <= 0) return '';
  if (confirmedCount < 4) return `Needs ${4 - confirmedCount} more to play`;
  if (confirmedCount >= maxPlayers) return `${confirmedCount} are in. You'd be on the waitlist.`;
  return `${confirmedCount} are in. You'd make it ${confirmedCount + 1}.`;
}
