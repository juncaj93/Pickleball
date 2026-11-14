// Zip 43 (Nov 2026): VENUE_ALERT ("Venue charge alert"), ships OFF. Organizer only, display only: on the day the venue (Northville Pickleball)
// charges Alex's card, the organizer Home shows an amber card with what the venue SHOULD have charged, from the site's own numbers, so he can
// check it against the real charge. It changes nothing for players and moves no money.
//
//  - Two days of the month live in Settings > Money (right under Monthly membership): "Membership charged on" (1 to 31, default 26, a day past the
//    end of a short month means that month's last day) and "Court costs charged on" (1 to 28 or Last day, default Last day).
//  - From 12:00 AM Eastern on a charge day the card shows, and stays until Mark paid (it also stays if the day was missed). Mark paid writes one
//    History line and removes it. No Dismiss button.
//  - No backfill: only charge days at or after the moment the switch was turned on make an alert.
//  - The math: court costs = the BOOKED, not canceled games in the billing period (the day after the previous court charge day through this one),
//    each at its own court cost (the game's own cost, else the Typical court cost, the same courtCostOf Money > Totals uses).
//  - Storage: no schema change. The two days sit in the group's settings_json (like the Zelle number); the switch and the "marked paid" months are
//    task_log rows (kind 'mark', no game), the same way every feature switch is stored.
//
// Everything below is plain date and money arithmetic on Eastern calendar dates ("2026-11-30"), so tests can use a fake clock.

import { formatPrice } from './money';
import { localParts, zonedTimeToUtc } from './time';

export const VENUE_ALERT = { task: 'venue_alert_on', header: 'X-Venue-Alert', sinceHeader: 'X-Venue-Alert-Since', link: 'venuealert', env: 'VENUE_ALERT', name: 'Venue charge alert' } as const;

/** A wrangler.toml kill switch: allowed unless it says "off". Who gets it is Settings' call. */
export function venueAlertAllowed(flag: string | undefined | null): boolean {
  return (flag ?? 'on').trim().toLowerCase() !== 'off';
}

/** Task name of the "marked paid" row for one charge in one month: `venue_paid:court:2026-11` or `venue_paid:membership:2026-11`. */
export const PAID_PREFIX = 'venue_paid:';
export type ChargeKind = 'court' | 'membership';
export const paidTask = (kind: ChargeKind, month: string) => `${PAID_PREFIX}${kind}:${month}`;

/** The day each charge lands. `courtDay` 0 means the last day of the month. */
export interface VenueDays {
  membershipDay: number;
  courtDay: number;
}
export const COURT_LAST_DAY = 0;
export const DEFAULT_VENUE_DAYS: VenueDays = { membershipDay: 26, courtDay: COURT_LAST_DAY };
export const MEMBERSHIP_DAY_MAX = 31;
export const COURT_DAY_MAX = 28;

/** Saved days, or the defaults for anything missing or out of range (the settings never hold a bad day). */
export function normalizeVenueDays(input: unknown): VenueDays {
  const src = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const whole = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) ? v : null);
  const m = whole(src.membershipDay);
  const c = whole(src.courtDay);
  return {
    membershipDay: m !== null && m >= 1 && m <= MEMBERSHIP_DAY_MAX ? m : DEFAULT_VENUE_DAYS.membershipDay,
    courtDay: c !== null && c >= COURT_LAST_DAY && c <= COURT_DAY_MAX ? c : DEFAULT_VENUE_DAYS.courtDay,
  };
}

/** The days kept inside a group's settings_json (key `venueDays`), or the defaults. */
export function venueDaysOf(settingsJson: string | null | undefined): VenueDays {
  try {
    return normalizeVenueDays((JSON.parse(settingsJson || '{}') as { venueDays?: unknown }).venueDays);
  } catch {
    return DEFAULT_VENUE_DAYS;
  }
}

export const daysInMonth = (year: number, month: number): number => new Date(Date.UTC(year, month, 0)).getUTCDate();

/** The real day of the month a charge day means in that month: a day past the end (31 in June) is the last day; 0 is the last day. */
export function dayIn(day: number, year: number, month: number): number {
  const last = daysInMonth(year, month);
  return day === COURT_LAST_DAY ? last : Math.min(day, last);
}

const pad = (n: number) => String(n).padStart(2, '0');
/** "2026-11-30". Plain Eastern calendar dates sort and compare as text. */
export const ymd = (year: number, month: number, day: number) => `${year}-${pad(month)}-${pad(day)}`;
export const monthKey = (year: number, month: number) => `${year}-${pad(month)}`;
export function parseYmd(s: string): { year: number; month: number; day: number } {
  const [y, m, d] = s.split('-').map(Number);
  return { year: y, month: m, day: d };
}
export const prevMonthOf = (year: number, month: number) => (month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 });
export const nextMonthOf = (year: number, month: number) => (month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 });

/** The calendar date `n` days after `date` ("2026-11-30" + 1 = "2026-12-01"). */
export function addDays(date: string, n: number): string {
  const { year, month, day } = parseYmd(date);
  const d = new Date(Date.UTC(year, month - 1, day + n));
  return ymd(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

/** The two charge dates of one month. */
export function chargeDatesOf(days: VenueDays, year: number, month: number): { membership: string; court: string } {
  return { membership: ymd(year, month, dayIn(days.membershipDay, year, month)), court: ymd(year, month, dayIn(days.courtDay, year, month)) };
}

/** The billing period a court charge pays for: the day after last month's court charge day through this month's (both ends included). */
export function courtPeriod(days: VenueDays, year: number, month: number): { from: string; to: string } {
  const prev = prevMonthOf(year, month);
  return { from: addDays(ymd(prev.year, prev.month, dayIn(days.courtDay, prev.year, prev.month)), 1), to: ymd(year, month, dayIn(days.courtDay, year, month)) };
}

/** The Eastern calendar date of an instant. */
export function localYmd(ms: number, tz: string): string {
  const p = localParts(ms, tz);
  return ymd(p.year, p.month, p.day);
}

/** The instant 12:00 AM Eastern starts a calendar date. */
export const startOfDayMs = (date: string, tz: string): number => {
  const { year, month, day } = parseYmd(date);
  return zonedTimeToUtc(year, month, day, 0, 0, tz);
};

/** One game as the alert reads it. `booked`: its court status is Booked (Not booked and Waitlist are not). */
export interface VenueGame {
  startsAt: string;
  booked: boolean;
  canceled: boolean;
  costCents: number;
}

/** The games a court charge pays for: Booked and not canceled, starting on a date inside the period (Eastern, ends included). */
export function periodGames(games: VenueGame[], period: { from: string; to: string }, tz: string): VenueGame[] {
  return games.filter((g) => {
    if (!g.booked || g.canceled) return false;
    const day = localYmd(Date.parse(g.startsAt), tz);
    return day >= period.from && day <= period.to;
  });
}

/** "4 games x $48 = $192", or "3 games = $138" when the games' costs differ. Whole dollars, or cents when a cost has them (the site's formatPrice). */
export function courtLine(costs: number[]): string {
  const total = costs.reduce((a, b) => a + b, 0);
  const n = costs.length;
  const noun = n === 1 ? 'game' : 'games';
  return costs.every((c) => c === costs[0]) ? `${n} ${noun} x ${formatPrice(costs[0])} = ${formatPrice(total)}` : `${n} ${noun} = ${formatPrice(total)}`;
}

/** One card on Home: one or two charges that land on the same day. */
export interface VenueAlert {
  /** Who it is for, as the Mark paid request names it: ["court:2026-11"], ["membership:2026-11"] or both. */
  keys: string[];
  /** The charge day (Eastern calendar date). */
  date: string;
  kinds: ChargeKind[];
  cents: number;
  title: string;
  line: string;
}

export interface VenueInput {
  days: VenueDays;
  membershipCents: number;
  /** Every game that could be in a period (the caller loads at least from the first period's start to today). Costs already worked out. */
  games: VenueGame[];
  nowMs: number;
  tz: string;
  /** The instant the switch was turned on (or the phone's private link was first opened). Charge days that start before it never show. */
  onAtMs: number;
  /** "court:2026-11" style keys already marked paid. */
  paid: ReadonlySet<string>;
}

const COURT_NAME = 'Northville Pickleball';

/** The first month a scan has to look at: the month the switch went on (an earlier charge day can never be at or after it). */
export function scanMonths(onAtMs: number, nowMs: number, tz: string): { year: number; month: number }[] {
  const on = localParts(onAtMs, tz);
  const now = localParts(nowMs, tz);
  const out: { year: number; month: number }[] = [];
  let cur = { year: on.year, month: on.month };
  // A bad pair (the switch "turned on" in the future) scans nothing.
  while (cur.year < now.year || (cur.year === now.year && cur.month <= now.month)) {
    out.push(cur);
    cur = nextMonthOf(cur.year, cur.month);
  }
  return out;
}

/** The earliest date any scanned period starts: the games to load begin here. */
export function earliestGameDate(days: VenueDays, onAtMs: number, nowMs: number, tz: string): string | null {
  const months = scanMonths(onAtMs, nowMs, tz);
  return months.length ? courtPeriod(days, months[0].year, months[0].month).from : null;
}

/**
 * Every card due right now, oldest charge day first. A charge is due when its day has started (12:00 AM Eastern or later), that moment is at or after
 * the switch going on, and its month is not marked paid. Court: nothing when the period has no booked games. When both charges of one month land on
 * the same day and both are due, one combined card.
 */
export function dueAlerts(input: VenueInput): VenueAlert[] {
  const { days, tz } = input;
  const todayYmd = localYmd(input.nowMs, tz);
  const due: { date: string; kind: ChargeKind; month: string; cents: number; line: string }[] = [];
  for (const { year, month } of scanMonths(input.onAtMs, input.nowMs, tz)) {
    const key = monthKey(year, month);
    const dates = chargeDatesOf(days, year, month);
    const reached = (date: string) => date <= todayYmd && startOfDayMs(date, tz) >= input.onAtMs;
    if (reached(dates.court) && !input.paid.has(`court:${key}`)) {
      const costs = periodGames(input.games, courtPeriod(days, year, month), tz).map((g) => g.costCents);
      if (costs.length > 0) due.push({ date: dates.court, kind: 'court', month: key, cents: costs.reduce((a, b) => a + b, 0), line: courtLine(costs) });
    }
    if (reached(dates.membership) && !input.paid.has(`membership:${key}`)) {
      due.push({ date: dates.membership, kind: 'membership', month: key, cents: input.membershipCents, line: `Monthly membership, ${COURT_NAME}` });
    }
  }
  due.sort((a, b) => (a.date === b.date ? (a.kind === 'court' ? -1 : 1) : a.date < b.date ? -1 : 1));
  const out: VenueAlert[] = [];
  for (let i = 0; i < due.length; i++) {
    const c = due[i];
    const m = due[i + 1];
    if (c.kind === 'court' && m && m.kind === 'membership' && m.date === c.date && m.month === c.month) {
      const total = c.cents + m.cents;
      out.push({ keys: [`court:${c.month}`, `membership:${m.month}`], date: c.date, kinds: ['court', 'membership'], cents: total, title: `${COURT_NAME} should have charged you ${formatPrice(total)}`, line: `${c.line}, plus membership ${formatPrice(m.cents)}` });
      i++;
    } else if (c.kind === 'court') {
      out.push({ keys: [`court:${c.month}`], date: c.date, kinds: ['court'], cents: c.cents, title: `${COURT_NAME} should have charged you ${formatPrice(c.cents)}`, line: c.line });
    } else {
      out.push({ keys: [`membership:${c.month}`], date: c.date, kinds: ['membership'], cents: c.cents, title: `Membership should have been charged: ${formatPrice(c.cents)}`, line: c.line });
    }
  }
  return out;
}

/** The History line for a Mark paid: "Venue charge marked paid: $192". */
export const markedPaidText = (cents: number) => `Venue charge marked paid: ${formatPrice(cents)}`;

/** "26th" / "Last day" for the two dropdowns. */
export function dayLabel(day: number): string {
  if (day === COURT_LAST_DAY) return 'Last day';
  const mod100 = day % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${day}th`;
  return `${day}${({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[day % 10] ?? 'th'}`;
}
