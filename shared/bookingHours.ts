// Zip 24 (Nov 2026): BOOKING_HOURS ("Booking hours"), ships OFF. Organizer only.
//  - The venue is open 8:00 AM to 10:00 PM Monday to Saturday and 8:00 AM to 7:00 PM on Sunday (Eastern, the game's own date). A game can
//    never start before opening, end after closing, or run past midnight. A game outside those hours is BLOCKED, not just warned about.
//  - THE hours live in ONE table below (VENUE_HOURS). Every screen and the server read it through the functions here; change the table
//    and everything follows.
//  - The rule only looks at a game when it is CREATED or when its start or end time is CHANGED. A game that already exists is never
//    blocked or changed because it sits outside the hours (cancel, court status and every other edit keep working).
//  - Add game and Edit game use a tap-to-pick screen that cannot offer an out-of-hours time. Settings > Schedule keeps its boxes and shows
//    the message under them. The server checks too, so nothing can go around the screen.
//  - A wrangler.toml kill switch (allowed unless "off"), a Settings > Feature switches row (one task_log row, no schema change) and a
//    private per-phone link (/admin?bookinghours=on) that sends the header below. No database change, no new cost.

import { gamePrice, gameMinutes, PICKER_MINUTES, type PriceSettings } from './gameLength';
import { localParts } from './time';

export const BOOKING_HOURS = { task: 'booking_hours_on', header: 'X-Booking-Hours', link: 'bookinghours', env: 'BOOKING_HOURS', name: 'Booking hours' } as const;

/** A wrangler.toml kill switch: allowed unless it says "off". Who gets it is Settings' call. */
export function bookingHoursAllowed(flag: string | undefined | null): boolean {
  return (flag ?? 'on').trim().toLowerCase() !== 'off';
}

/** Opening and closing, in minutes after midnight (local time). */
export interface DayHours {
  open: number;
  close: number;
}

const OPEN_MORNING = 8 * 60;
/** THE hours table, by weekday (0 = Sunday). The only place the hours are written down. */
export const VENUE_HOURS: Readonly<Record<number, DayHours>> = {
  0: { open: OPEN_MORNING, close: 19 * 60 }, // Sunday: 8:00 AM to 7:00 PM
  1: { open: OPEN_MORNING, close: 22 * 60 },
  2: { open: OPEN_MORNING, close: 22 * 60 },
  3: { open: OPEN_MORNING, close: 22 * 60 },
  4: { open: OPEN_MORNING, close: 22 * 60 },
  5: { open: OPEN_MORNING, close: 22 * 60 },
  6: { open: OPEN_MORNING, close: 22 * 60 },
};

/** The step between start times in the picker (minutes). */
export const START_STEP_MINUTES = 30;

export function hoursFor(weekday: number): DayHours {
  return VENUE_HOURS[weekday] ?? VENUE_HOURS[1];
}

/** The weekday (0 = Sunday) of a plain calendar date "YYYY-MM-DD". No time zone is involved. */
export function weekdayOfDate(date: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return null;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay();
}

/** "8:00 AM", "10:00 PM". */
export function clockLabel(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24;
  const mm = String(minutes % 60).padStart(2, '0');
  return `${h % 12 === 0 ? 12 : h % 12}:${mm} ${h < 12 ? 'AM' : 'PM'}`;
}

const SUNDAY = 0;
const hoursWords = (h: DayHours) => `${clockLabel(h.open)} to ${clockLabel(h.close)}`;

/** The first part, for a date: "The venue is open 8:00 AM to 10:00 PM on this day." / "The venue is open 8:00 AM to 7:00 PM on Sundays." */
export function hoursLine(weekday: number): string {
  return weekday === SUNDAY ? `The venue is open ${hoursWords(hoursFor(SUNDAY))} on Sundays.` : `The venue is open ${hoursWords(hoursFor(weekday))} on this day.`;
}

/** What a refused save says for a game on a given day. */
export function hoursMessage(weekday: number): string {
  return `${hoursLine(weekday)} Pick times inside those hours.`;
}

/** The one message with both hours, for a place with no single date (Settings > Schedule). */
export function hoursMessageAnyDay(): string {
  return `The venue is open ${hoursWords(hoursFor(1))} (Sundays ${hoursWords(hoursFor(SUNDAY))}). Pick times inside those hours.`;
}

export const END_BEFORE_START_MESSAGE = 'The end time must be after the start time.';

/** Start and end as minutes after midnight on one day. `ok` false says why. */
export type HoursCheck = { ok: true } | { ok: false; why: 'order' | 'hours'; message: string };

/**
 * The rule for one day: end after start, start at or after opening, end at or before closing.
 * (Closing is always before midnight, so a game cannot run past midnight either.)
 */
export function checkDay(weekday: number, startMin: number, endMin: number): HoursCheck {
  if (endMin <= startMin) return { ok: false, why: 'order', message: END_BEFORE_START_MESSAGE };
  const h = hoursFor(weekday);
  if (startMin < h.open || endMin > h.close) return { ok: false, why: 'hours', message: hoursMessage(weekday) };
  return { ok: true };
}

/** The rule for a game's real start and end (ISO times) in the group's time zone. A game that ends on another day is out of hours. */
export function checkBookingTimes(startsAtIso: string, endsAtIso: string, tz: string): HoursCheck {
  const a = localParts(Date.parse(startsAtIso), tz);
  const b = localParts(Date.parse(endsAtIso), tz);
  if (Date.parse(endsAtIso) <= Date.parse(startsAtIso)) return { ok: false, why: 'order', message: END_BEFORE_START_MESSAGE };
  const sameDay = a.year === b.year && a.month === b.month && a.day === b.day;
  if (!sameDay) return { ok: false, why: 'hours', message: hoursMessage(a.weekday) };
  // Seconds count too (an end of 10:00:30 PM is after closing); the screens only send whole minutes.
  return checkDay(a.weekday, a.hour * 60 + a.minute + a.second / 60, b.hour * 60 + b.minute + b.second / 60);
}

/** The usual game time (Settings > Schedule) is for Tuesday and Thursday only, so it is checked against a weekday's hours (Tuesday's). */
export function checkUsualTime(startMin: number, endMin: number, weekday = 2): HoursCheck {
  return checkDay(weekday, startMin, endMin);
}

/** A length (minutes) fits a start (minutes after midnight) on a day when both ends are inside the hours. */
export function lengthFits(weekday: number, startMin: number, lengthMin: number): boolean {
  return checkDay(weekday, startMin, startMin + lengthMin).ok;
}

/**
 * The start times the picker offers for a day: every 30 minutes from opening to the last start that still leaves room for the SHORTEST
 * length it offers (so nothing after 8:30 PM Monday to Saturday, nothing after 5:30 PM on Sunday with a 1.5 hour shortest game).
 */
export function startSlots(weekday: number, shortestMinutes: number = Math.min(...PICKER_MINUTES)): number[] {
  const h = hoursFor(weekday);
  const out: number[] = [];
  for (let m = h.open; m + shortestMinutes <= h.close; m += START_STEP_MINUTES) out.push(m);
  return out;
}

/** The latest start that still fits a length on a day, or null when none does. */
export function latestStart(weekday: number, lengthMin: number): number | null {
  const h = hoursFor(weekday);
  const last = h.close - lengthMin;
  if (last < h.open) return null;
  return h.open + Math.floor((last - h.open) / START_STEP_MINUTES) * START_STEP_MINUTES;
}

/**
 * A start (minutes) moved into the day's hours for a length: too early becomes opening, too late becomes the latest start that still
 * fits. Used when the DATE changes (a Tuesday 8:00 PM start moved to a Sunday becomes 5:00 PM for a 2 hour game). Unchanged when it
 * already fits, or when no start can fit the length that day.
 */
export function fitStart(weekday: number, startMin: number, lengthMin: number): number {
  if (lengthFits(weekday, startMin, lengthMin)) return startMin;
  const latest = latestStart(weekday, lengthMin);
  if (latest === null) return startMin;
  return startMin < hoursFor(weekday).open ? hoursFor(weekday).open : latest;
}

/** One length button: its minutes, "1.5 hr", the "$14 each" under it (from the site's own price code) and whether it fits the chosen start. */
export interface LengthChoice {
  minutes: number;
  label: string;
  price: string;
  fits: boolean;
}

/** "1.5 hr", "2 hr". */
export function lengthLabel(minutes: number): string {
  return `${minutes / 60} hr`;
}

/**
 * The length buttons for a day and start (minutes). The price under each is the site's real one, read through gamePrice() with the
 * same switch the server uses: nothing is written down here. `shortGames` is the dashboard's own flag.
 */
export function lengthChoices(weekday: number, startMin: number | null, settings: PriceSettings, shortGames: boolean): LengthChoice[] {
  const t0 = Date.UTC(2026, 0, 1);
  return PICKER_MINUTES.map((minutes) => {
    const gp = gamePrice({ startsAt: new Date(t0).toISOString(), endsAt: new Date(t0 + minutes * 60_000).toISOString() }, settings, shortGames);
    return {
      minutes,
      label: lengthLabel(minutes),
      price: `$${Math.round(gp.flatCents / 100)} each`,
      fits: startMin === null ? true : lengthFits(weekday, startMin, minutes),
    };
  });
}

/** True when a game's length is one the picker offers (90 or 120 minutes). Any other length keeps its current times in Edit game. */
export function isPickerLength(minutes: number): boolean {
  return (PICKER_MINUTES as readonly number[]).includes(minutes);
}

/** A game's length in minutes from its two ISO times (0 for a bad pair). */
export const lengthOf = gameMinutes;
