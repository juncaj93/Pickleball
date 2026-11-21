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
//
// Zip 81 (🎾81.venue hours): the hours are DATE-AWARE. The normal weekly table can be changed (Settings > Schedule > Special venue hours >
// Change normal hours) and special hours can be added for dates: a date RANGE with one start and end per weekday (Winter hours), or ONE DAY
// open with hours or Closed (Thanksgiving, Christmas). A one-day entry beats a range on its date. Each entry ends on its own after its last
// date. All of it lives in the group's settings_json (`venueHours`, no table, no migration) and comes to every check through `dayRule()`.
// Every function below that took a weekday also takes a DayRule (the hours of one real date); a plain weekday means the NORMAL table.

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

// ---------- Zip 81: date-aware hours ----------

/** The latest closing: midnight (a game still cannot run past it). */
export const MIDNIGHT = 24 * 60;
/** At most this many special entries are kept (the list is short by nature; old ones leave on their own). */
export const SPECIALS_MAX = 40;
export const SPECIAL_NAME_MAX = 40;
/** A date range is at most a year and a day long. */
export const RANGE_MAX_DAYS = 366;

/** One special entry. A range has `week` (7 days, index 0 = Sunday); one day has `day` (its hours, or null = Closed). */
export interface SpecialHours {
  id: string;
  name: string;
  /** "YYYY-MM-DD", Eastern calendar dates. One day: from = to. */
  from: string;
  to: string;
  oneDay: boolean;
  week?: DayHours[];
  day?: DayHours | null;
}

/** Everything the site knows about the venue's hours: the normal week (index 0 = Sunday) and the special entries. */
export interface VenueHoursConfig {
  normal: DayHours[];
  specials: SpecialHours[];
}

/** The hours of ONE real date: open hours or closed (null), and why (normal week, a range, or a one-day entry, with its name). */
export interface DayRule {
  weekday: number;
  hours: DayHours | null;
  kind: 'normal' | 'range' | 'day';
  name: string | null;
}

export const DEFAULT_WEEK: readonly DayHours[] = [0, 1, 2, 3, 4, 5, 6].map((d) => ({ ...hoursFor(d) }));
export const DEFAULT_VENUE_HOURS: VenueHoursConfig = { normal: DEFAULT_WEEK.map((h) => ({ ...h })), specials: [] };

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
/** A real calendar date "YYYY-MM-DD" (Feb 30 is not one). */
export function isDateKey(x: unknown): x is string {
  if (typeof x !== 'string') return false;
  const m = DATE_RE.exec(x);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}

/** Days from `a` to `b` (both "YYYY-MM-DD"). */
export function daysBetween(a: string, b: string): number {
  const ms = (k: string) => {
    const m = DATE_RE.exec(k)!;
    return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  };
  return Math.round((ms(b) - ms(a)) / 86_400_000);
}

/** Open and close, whole minutes, open before close, close at most midnight. Anything else is not hours. */
export function cleanHours(x: unknown): DayHours | null {
  if (!x || typeof x !== 'object') return null;
  const { open, close } = x as { open?: unknown; close?: unknown };
  if (typeof open !== 'number' || typeof close !== 'number' || !Number.isInteger(open) || !Number.isInteger(close)) return null;
  if (open < 0 || close > MIDNIGHT || close <= open) return null;
  return { open, close };
}

function cleanWeek(x: unknown): DayHours[] | null {
  if (!Array.isArray(x) || x.length !== 7) return null;
  const out = x.map(cleanHours);
  return out.every((h): h is DayHours => h !== null) ? out : null;
}

/** One stored entry, checked; a broken one is dropped (never guessed). */
function cleanSpecial(x: unknown): SpecialHours | null {
  if (!x || typeof x !== 'object') return null;
  const r = x as Record<string, unknown>;
  if (typeof r.id !== 'string' || !r.id || typeof r.name !== 'string' || !r.name.trim()) return null;
  if (!isDateKey(r.from) || !isDateKey(r.to) || r.to < r.from) return null;
  if (r.oneDay === true) {
    if (r.from !== r.to) return null;
    const day = r.day === null ? null : cleanHours(r.day);
    if (r.day !== null && day === null) return null;
    return { id: r.id, name: r.name.trim(), from: r.from, to: r.to, oneDay: true, day };
  }
  const week = cleanWeek(r.week);
  if (!week) return null;
  return { id: r.id, name: r.name.trim(), from: r.from, to: r.to, oneDay: false, week };
}

/** The venue hours from the group's settings_json (or the parsed object). Nothing saved: the normal table, no specials. */
export function venueHoursOf(settings: string | null | undefined | Record<string, unknown>): VenueHoursConfig {
  let raw: unknown;
  try {
    raw = typeof settings === 'string' ? (JSON.parse(settings || '{}') as { venueHours?: unknown }).venueHours : settings && typeof settings === 'object' ? settings.venueHours : undefined;
  } catch {
    raw = undefined;
  }
  if (!raw || typeof raw !== 'object') return { normal: DEFAULT_WEEK.map((h) => ({ ...h })), specials: [] };
  const r = raw as { normal?: unknown; specials?: unknown };
  const normal = cleanWeek(r.normal) ?? DEFAULT_WEEK.map((h) => ({ ...h }));
  const specials = Array.isArray(r.specials) ? r.specials.map(cleanSpecial).filter((e): e is SpecialHours => e !== null) : [];
  return { normal, specials };
}

/** True when the normal week is the built-in one (then the old words are kept word for word). */
export function isDefaultWeek(week: readonly DayHours[]): boolean {
  return week.every((h, i) => h.open === DEFAULT_WEEK[i].open && h.close === DEFAULT_WEEK[i].close);
}

/** The special entries still to come or running on `today` ("YYYY-MM-DD"), soonest first. An entry leaves the day after its last date. */
export function activeSpecials(config: VenueHoursConfig | null | undefined, today: string): SpecialHours[] {
  return (config?.specials ?? []).filter((e) => e.to >= today).sort((a, b) => (a.from === b.from ? (a.oneDay === b.oneDay ? a.name.localeCompare(b.name) : a.oneDay ? 1 : -1) : a.from < b.from ? -1 : 1));
}

/**
 * THE rule for one date: a one-day entry on it, else a range that covers it, else the normal week. (Ranges never overlap: the save refuses
 * that. If old data ever had two, the one that starts latest wins, so the answer is always the same.)
 */
export function dayRule(config: VenueHoursConfig | null | undefined, date: string): DayRule {
  const weekday = weekdayOfDate(date) ?? 1;
  const specials = config?.specials ?? [];
  const one = specials.find((e) => e.oneDay && e.from === date);
  if (one) return { weekday, hours: one.day ?? null, kind: 'day', name: one.name };
  const ranges = specials.filter((e) => !e.oneDay && e.from <= date && date <= e.to).sort((a, b) => (a.from < b.from ? 1 : -1));
  if (ranges.length > 0 && ranges[0].week) return { weekday, hours: { ...ranges[0].week[weekday] }, kind: 'range', name: ranges[0].name };
  const normal = config?.normal ?? DEFAULT_WEEK;
  return { weekday, hours: { ...(normal[weekday] ?? DEFAULT_WEEK[weekday]) }, kind: 'normal', name: null };
}

/** A weekday (the normal built-in table) or the rule of a real date. */
export type DayLike = number | DayRule;
const ruleOf = (d: DayLike): DayRule => (typeof d === 'number' ? { weekday: d, hours: { ...hoursFor(d) }, kind: 'normal', name: null } : d);

/** The plain date "YYYY-MM-DD" a moment falls on in a time zone. */
export function dateKeyOf(ms: number, tz: string): string {
  const p = localParts(ms, tz);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
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

/**
 * The first part, for a date: "The venue is open 8:00 AM to 10:00 PM on this day." / "The venue is open 8:00 AM to 7:00 PM on Sundays."
 * Zip 81, special hours: "The venue is open 8:00 AM to 12:00 PM on this day (Thanksgiving)." / "The venue is closed on this day (Christmas)."
 */
export function hoursLine(day: DayLike): string {
  const r = ruleOf(day);
  const tag = r.name ? ` (${r.name})` : '';
  if (!r.hours) return `The venue is closed on this day${tag}.`;
  if (r.kind === 'normal' && r.weekday === SUNDAY) return `The venue is open ${hoursWords(r.hours)} on Sundays.`;
  return `The venue is open ${hoursWords(r.hours)} on this day${tag}.`;
}

/** What a refused save says for a game on a given day (a closed day: "Pick another date."). */
export function hoursMessage(day: DayLike): string {
  return `${hoursLine(day)} ${ruleOf(day).hours ? 'Pick times inside those hours.' : 'Pick another date.'}`;
}

/** The one message with both hours, for a place with no single date (Settings > Schedule). Zip 81: a changed normal week names Tue and Thu. */
export function hoursMessageAnyDay(normal?: readonly DayHours[]): string {
  if (!normal || isDefaultWeek(normal)) return `The venue is open ${hoursWords(hoursFor(1))} (Sundays ${hoursWords(hoursFor(SUNDAY))}). Pick times inside those hours.`;
  const tue = normal[2];
  const thu = normal[4];
  const same = tue.open === thu.open && tue.close === thu.close;
  return same
    ? `The venue is open ${hoursWords(tue)} on Tuesdays and Thursdays. Pick times inside those hours.`
    : `The venue is open ${hoursWords(tue)} on Tuesdays and ${hoursWords(thu)} on Thursdays. Pick times inside those hours.`;
}

export const END_BEFORE_START_MESSAGE = 'The end time must be after the start time.';

/** Start and end as minutes after midnight on one day. `ok` false says why. */
export type HoursCheck = { ok: true } | { ok: false; why: 'order' | 'hours'; message: string };

/**
 * The rule for one day: end after start, start at or after opening, end at or before closing.
 * (Closing is always before midnight, so a game cannot run past midnight either.)
 */
export function checkDay(day: DayLike, startMin: number, endMin: number): HoursCheck {
  if (endMin <= startMin) return { ok: false, why: 'order', message: END_BEFORE_START_MESSAGE };
  const h = ruleOf(day).hours;
  if (!h || startMin < h.open || endMin > h.close) return { ok: false, why: 'hours', message: hoursMessage(day) };
  return { ok: true };
}

/**
 * The rule for a game's real start and end (ISO times) in the group's time zone. A game that ends on another day is out of hours.
 * Zip 81: `config` (the group's venue hours) makes it date-aware; left out, the built-in normal table (exactly the old rule).
 */
export function checkBookingTimes(startsAtIso: string, endsAtIso: string, tz: string, config?: VenueHoursConfig | null): HoursCheck {
  const a = localParts(Date.parse(startsAtIso), tz);
  const b = localParts(Date.parse(endsAtIso), tz);
  if (Date.parse(endsAtIso) <= Date.parse(startsAtIso)) return { ok: false, why: 'order', message: END_BEFORE_START_MESSAGE };
  const day: DayLike = config ? dayRule(config, dateKeyOf(Date.parse(startsAtIso), tz)) : a.weekday;
  const sameDay = a.year === b.year && a.month === b.month && a.day === b.day;
  // A venue open until midnight: a game ending exactly at 12:00 AM is still that night's game.
  const nextMidnight = !sameDay && b.hour === 0 && b.minute === 0 && b.second === 0 && Date.parse(endsAtIso) - Date.parse(startsAtIso) <= MIDNIGHT * 60_000 && (a.hour * 60 + a.minute) > 0;
  if (!sameDay && !nextMidnight) return { ok: false, why: 'hours', message: hoursMessage(day) };
  // Seconds count too (an end of 10:00:30 PM is after closing); the screens only send whole minutes.
  return checkDay(day, a.hour * 60 + a.minute + a.second / 60, nextMidnight ? MIDNIGHT : b.hour * 60 + b.minute + b.second / 60);
}

/**
 * The usual game time (Settings > Schedule) is for Tuesday and Thursday only, so it is checked against a weekday's hours (Tuesday's).
 * Zip 81: with `normal` (the group's normal week), against both Tuesday's and Thursday's; the message names them.
 */
export function checkUsualTime(startMin: number, endMin: number, weekday = 2, normal?: readonly DayHours[]): HoursCheck {
  if (!normal) return checkDay(weekday, startMin, endMin);
  if (endMin <= startMin) return { ok: false, why: 'order', message: END_BEFORE_START_MESSAGE };
  for (const wd of [2, 4]) {
    const h = normal[wd];
    if (startMin < h.open || endMin > h.close) return { ok: false, why: 'hours', message: hoursMessageAnyDay(normal) };
  }
  return { ok: true };
}

/** A length (minutes) fits a start (minutes after midnight) on a day when both ends are inside the hours. */
export function lengthFits(day: DayLike, startMin: number, lengthMin: number): boolean {
  return checkDay(day, startMin, startMin + lengthMin).ok;
}

/**
 * The start times the picker offers for a day: every 30 minutes from opening to the last start that still leaves room for the SHORTEST
 * length it offers (so nothing after 8:30 PM Monday to Saturday, nothing after 5:30 PM on Sunday with a 1.5 hour shortest game).
 */
export function startSlots(day: DayLike, shortestMinutes: number = Math.min(...PICKER_MINUTES)): number[] {
  const h = ruleOf(day).hours;
  const out: number[] = [];
  if (!h) return out;
  for (let m = h.open; m + shortestMinutes <= h.close; m += START_STEP_MINUTES) out.push(m);
  return out;
}

/** The latest start that still fits a length on a day, or null when none does. */
export function latestStart(day: DayLike, lengthMin: number): number | null {
  const h = ruleOf(day).hours;
  if (!h) return null;
  const last = h.close - lengthMin;
  if (last < h.open) return null;
  return h.open + Math.floor((last - h.open) / START_STEP_MINUTES) * START_STEP_MINUTES;
}

/**
 * A start (minutes) moved into the day's hours for a length: too early becomes opening, too late becomes the latest start that still
 * fits. Used when the DATE changes (a Tuesday 8:00 PM start moved to a Sunday becomes 5:00 PM for a 2 hour game). Unchanged when it
 * already fits, or when no start can fit the length that day.
 */
export function fitStart(day: DayLike, startMin: number, lengthMin: number): number {
  if (lengthFits(day, startMin, lengthMin)) return startMin;
  const latest = latestStart(day, lengthMin);
  const h = ruleOf(day).hours;
  if (latest === null || !h) return startMin;
  return startMin < h.open ? h.open : latest;
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
 * same switches the server uses: nothing is written down here. `shortGames` and `longGames` are the dashboard's own flags.
 */
export function lengthChoices(day: DayLike, startMin: number | null, settings: PriceSettings, shortGames: boolean, longGames = false): LengthChoice[] {
  const t0 = Date.UTC(2026, 0, 1);
  return PICKER_MINUTES.map((minutes) => {
    const gp = gamePrice({ startsAt: new Date(t0).toISOString(), endsAt: new Date(t0 + minutes * 60_000).toISOString() }, settings, shortGames, longGames);
    return {
      minutes,
      label: lengthLabel(minutes),
      price: `$${Math.round(gp.flatCents / 100)} each`,
      fits: startMin === null ? true : lengthFits(day, startMin, minutes),
    };
  });
}

/** True when a game's length is one the picker offers (90 or 120 minutes). Any other length keeps its current times in Edit game. */
export function isPickerLength(minutes: number): boolean {
  return (PICKER_MINUTES as readonly number[]).includes(minutes);
}

/** A game's length in minutes from its two ISO times (0 for a bad pair). */
export const lengthOf = gameMinutes;
