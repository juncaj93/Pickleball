// Zip 81 (🎾81.venue hours): special venue hours. The rules themselves (which hours a date has) are in shared/bookingHours.ts (`dayRule`);
// this file has what the screens say about them, the checks a save runs, and the conflicts organizer Home shows.
//  - Settings > Schedule > Special venue hours: the row's hint, the list's lines ("Thu Nov 26 · 8 AM to noon", Closed), the normal line.
//  - A save (server/venueHours.ts) runs `readSpecial` / `readWeek`: names, dates, hours, no two ranges on one date, no two one-day entries
//    on one date. A one-day entry may sit inside a range: it beats the range on its date.
//  - `venueConflicts`: every game still to come (not canceled) and the finalized tournament whose time is outside its date's hours. Worked
//    out on the organizer's phone from what Home already has (no server call, no database trip). Nothing changes on its own.
import { activeSpecials, dateKeyOf, type DayHours, dayRule, daysBetween, type DayRule, isDateKey, MIDNIGHT, RANGE_MAX_DAYS, SPECIAL_NAME_MAX, SPECIALS_MAX, type SpecialHours, type VenueHoursConfig, weekdayOfDate } from './bookingHours';
import { localParts } from './time';

const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "8 AM", "8:30 AM", "noon", "midnight", "11 PM" (minutes after midnight). */
export function shortClock(m: number): string {
  if (m === 12 * 60) return 'noon';
  if (m === 0 || m === MIDNIGHT) return 'midnight';
  const h = Math.floor(m / 60) % 24;
  const mm = m % 60;
  return `${h % 12 === 0 ? 12 : h % 12}${mm ? `:${String(mm).padStart(2, '0')}` : ''} ${h < 12 ? 'AM' : 'PM'}`;
}

/** "8 AM to noon". */
export const hoursShort = (h: DayHours) => `${shortClock(h.open)} to ${shortClock(h.close)}`;

/** "Nov 26" for "2026-11-26". */
export function monthDay(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  return m ? `${MON[Number(m[2]) - 1]} ${Number(m[3])}` : date;
}
/** "Thu Nov 26". */
export function dayDate(date: string): string {
  const wd = weekdayOfDate(date);
  return wd === null ? date : `${WD[wd]} ${monthDay(date)}`;
}

const sameHours = (a: DayHours, b: DayHours) => a.open === b.open && a.close === b.close;

/** A week in a few words, Monday first: "Mon to Sat 8 AM to 10 PM · Sun 8 AM to 7 PM"; all alike: "Every day 8 AM to 10 PM". */
export function weekWords(week: readonly DayHours[]): string {
  const order = [1, 2, 3, 4, 5, 6, 0];
  if (order.every((d) => sameHours(week[d], week[1]))) return `Every day ${hoursShort(week[1])}`;
  const runs: { from: number; to: number; h: DayHours; n: number }[] = [];
  for (const d of order) {
    const last = runs[runs.length - 1];
    if (last && sameHours(last.h, week[d])) {
      last.to = d;
      last.n += 1;
    } else runs.push({ from: d, to: d, h: week[d], n: 1 });
  }
  return runs.map((r) => `${r.n === 1 ? WD[r.from] : r.n === 2 ? `${WD[r.from]}, ${WD[r.to]}` : `${WD[r.from]} to ${WD[r.to]}`} ${hoursShort(r.h)}`).join(' · ');
}

/** The gray line on top of the sheet. */
export const normalLine = (config: VenueHoursConfig) => `Normal: ${weekWords(config.normal)}`;

/** One list row's gray lines: a range shows its dates on one line and its hours on the next; one day: "Thu Nov 26 · 8 AM to noon" (Closed in red). */
export function specialLines(e: SpecialHours): { dates: string; hours: string | null; closed: boolean } {
  if (e.oneDay) return { dates: dayDate(e.from), hours: e.day ? hoursShort(e.day) : null, closed: !e.day };
  return { dates: `${monthDay(e.from)} to ${monthDay(e.to)}`, hours: e.week ? weekWords(e.week) : null, closed: false };
}

/** The Settings row's hint: the range running now (or the next one) and how many single days are still to come. "None" when empty. */
export function specialHint(config: VenueHoursConfig | null | undefined, today: string): string {
  const live = activeSpecials(config, today);
  const range = live.find((e) => !e.oneDay);
  const singles = live.filter((e) => e.oneDay).length;
  const parts: string[] = [];
  if (range) parts.push(range.from <= today ? `${range.name} to ${monthDay(range.to)}` : `${range.name} from ${monthDay(range.from)}`);
  if (singles > 0) parts.push(`${singles} ${singles === 1 ? 'holiday' : 'holidays'}`);
  return parts.length ? parts.join(' · ') : 'None';
}

// ---------- Saves ----------

export type ReadResult<T> = { ok: true; value: T } | { ok: false; message: string };

/** One weekday row of hours from a screen: open before close, close at most midnight. */
function readDay(x: unknown, label: string): ReadResult<DayHours> {
  const r = (x && typeof x === 'object' ? x : {}) as { open?: unknown; close?: unknown };
  const whole = (v: unknown) => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= MIDNIGHT;
  if (!whole(r.open) || !whole(r.close)) return { ok: false, message: `Pick a start and an end for ${label}.` };
  const open = r.open as number;
  // An end of 12:00 AM means midnight.
  const close = (r.close as number) === 0 ? MIDNIGHT : (r.close as number);
  if (open >= MIDNIGHT || close <= open) return { ok: false, message: `${label}: the end must be after the start.` };
  return { ok: true, value: { open, close } };
}

// Control characters and the invisible ones (zero width, direction marks, line and paragraph separators).
const HIDDEN = new RegExp('[\\u0000-\\u001f\\u007f\\u200b-\\u200f\\u2028-\\u202e\\u2060-\\u206f\\ufeff]');

const LONG_WD = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Seven rows (index 0 = Sunday). */
export function readWeek(x: unknown): ReadResult<DayHours[]> {
  if (!Array.isArray(x) || x.length !== 7) return { ok: false, message: 'Pick hours for every day.' };
  const out: DayHours[] = [];
  for (let d = 0; d < 7; d++) {
    const r = readDay(x[d], LONG_WD[d]);
    if (!r.ok) return r;
    out.push(r.value);
  }
  return { ok: true, value: out };
}

/** What a screen sends for one entry (an id when it edits one). */
export interface SpecialInput {
  id?: string;
  name: string;
  oneDay: boolean;
  from: string;
  to?: string;
  week?: DayHours[];
  /** One day: its hours, or null for Closed. */
  day?: DayHours | null;
}

/**
 * One entry from a screen, checked against the others still in the list (`others`, without the one being edited). `today` is Eastern today:
 * an entry must not be over already. Ranges never overlap; two one-day entries never share a date.
 */
export function readSpecial(body: unknown, others: readonly SpecialHours[], today: string, id: string): ReadResult<SpecialHours> {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const name = typeof b.name === 'string' ? b.name.trim().replace(/\s+/g, ' ') : '';
  if (!name) return { ok: false, message: 'Type a name.' };
  if (Array.from(name).length > SPECIAL_NAME_MAX) return { ok: false, message: `Keep the name to ${SPECIAL_NAME_MAX} letters.` };
  // eslint-disable-next-line no-control-regex
  if (HIDDEN.test(name)) return { ok: false, message: 'Type a name without hidden characters.' };
  const oneDay = b.oneDay === true;
  if (!isDateKey(b.from)) return { ok: false, message: oneDay ? 'Pick a date.' : 'Pick a From date.' };
  const from = b.from;
  const to = oneDay ? from : b.to;
  if (!isDateKey(to)) return { ok: false, message: 'Pick a To date.' };
  if (to < from) return { ok: false, message: 'The To date must be on or after the From date.' };
  if (to < today) return { ok: false, message: 'Those dates have passed. Pick dates from today on.' };
  if (daysBetween(from, to) > RANGE_MAX_DAYS) return { ok: false, message: 'Keep it to a year or less.' };
  const live = others.filter((e) => e.to >= today);
  if (live.length >= SPECIALS_MAX) return { ok: false, message: `That’s ${SPECIALS_MAX} already. Remove one first.` };
  if (oneDay) {
    let day: DayHours | null = null;
    if (b.day !== null) {
      const r = readDay(b.day, 'that day');
      if (!r.ok) return r;
      day = r.value;
    }
    const twin = live.find((e) => e.oneDay && e.from === from);
    if (twin) return { ok: false, message: `${twin.name} is already on ${dayDate(from)}. Edit that one instead.` };
    return { ok: true, value: { id, name, from, to: from, oneDay: true, day } };
  }
  const week = readWeek(b.week);
  if (!week.ok) return week;
  const clash = live.find((e) => !e.oneDay && e.from <= to && from <= e.to);
  if (clash) return { ok: false, message: `That overlaps ${clash.name} (${monthDay(clash.from)} to ${monthDay(clash.to)}). Pick other dates.` };
  return { ok: true, value: { id, name, from, to, oneDay: false, week: week.value } };
}

// ---------- Conflicts (organizer Home) ----------

export interface ConflictGame {
  id: string;
  startsAt: string;
  endsAt: string;
  canceled: boolean;
  finalized?: boolean;
}
export interface ConflictTournament {
  id: string;
  /** "YYYY-MM-DD" */
  date: string;
  start: number;
  minutes: number;
}
export interface VenueConflict {
  key: string;
  kind: 'game' | 'tournament';
  id: string;
  date: string;
  title: string;
  sub: string;
}

/** Why a time is out: the day is closed, it starts before opening, or it runs past closing. Null when it fits. */
function outWhy(rule: DayRule, startMin: number, endMin: number): 'closed' | 'early' | 'late' | null {
  const h = rule.hours;
  if (!h) return 'closed';
  if (startMin < h.open) return 'early';
  if (endMin > h.close) return 'late';
  return null;
}

function conflictWords(rule: DayRule, date: string, why: 'closed' | 'early' | 'late', startMin: number, what: (time: string) => string): { title: string; sub: string } {
  const d = dayDate(date);
  const subject = what(shortClock(startMin));
  if (why === 'closed') return { title: `${d}: the venue is closed.`, sub: `${subject} is that day.` };
  if (why === 'early') return { title: `${d}: the venue opens at ${shortClock(rule.hours!.open)}.`, sub: `${subject} is before that.` };
  const close = rule.hours!.close;
  return { title: `${d}: the venue closes at ${shortClock(close)}.`, sub: startMin >= close ? `${subject} is after that.` : `${subject} ends after that.` };
}

/**
 * Every game still to come (not canceled, not finalized, not over) and the finalized tournament whose time does not fit its date's hours,
 * soonest first. A game that runs past midnight counts as running past closing.
 */
export function venueConflicts(config: VenueHoursConfig | null | undefined, games: readonly ConflictGame[], tournament: ConflictTournament | null, tz: string, nowMs: number): VenueConflict[] {
  const out: (VenueConflict & { at: number })[] = [];
  for (const g of games) {
    if (g.canceled || g.finalized) continue;
    const s = Date.parse(g.startsAt);
    const e = Date.parse(g.endsAt);
    if (!(e > nowMs) || !(e > s)) continue;
    const date = dateKeyOf(s, tz);
    const rule = dayRule(config, date);
    const a = localParts(s, tz);
    const startMin = a.hour * 60 + a.minute;
    const endMin = startMin + Math.round((e - s) / 60_000);
    const why = outWhy(rule, startMin, endMin);
    if (!why) continue;
    out.push({ key: `game:${g.id}`, kind: 'game', id: g.id, date, at: s, ...conflictWords(rule, date, why, startMin, (t) => `Your ${t} game`) });
  }
  if (tournament && tournament.date >= dateKeyOf(nowMs, tz)) {
    const rule = dayRule(config, tournament.date);
    const why = outWhy(rule, tournament.start, tournament.start + tournament.minutes);
    if (why) {
      const at = Date.parse(`${tournament.date}T12:00:00Z`);
      out.push({ key: `tournament:${tournament.id}`, kind: 'tournament', id: tournament.id, date: tournament.date, at, ...conflictWords(rule, tournament.date, why, tournament.start, () => 'Your tournament') });
    }
  }
  return out.sort((x, y) => x.at - y.at).map(({ at: _at, ...c }) => c);
}

/** True when a one-day entry covers this date: the holiday "hours confirmed?" question is not asked then (its hours are already set). */
export function holidayCovered(config: VenueHoursConfig | null | undefined, date: string): boolean {
  return (config?.specials ?? []).some((e) => e.oneDay && e.from === date);
}
