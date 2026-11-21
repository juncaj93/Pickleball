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
//  - Zip 51 (Audit C F-9), charge days on a timeline: every month has at least one court and one membership charge day. A moved day keeps the
//    old days on record (`venueDays.history` in settings_json, no schema change), so a charge day that already came under the old days stays
//    (its card keeps its games and its amount until Mark paid), and the new day starts counting from the move. A month whose day moved past it
//    (moved from the 30th to the 15th on the 16th) still has one, on the new day. Court periods chain: each one starts the day after the court
//    charge day before it (paid or not), so every booked game is on exactly one card and Mark paid on one card never changes another. Two court
//    charges in one month (moved from the 15th to Last day after the 15th was paid) are two cards: the second one is keyed by its date
//    ("court:2026-11-30"); the usual one keeps the month key ("court:2026-11"), so older rows and links read as before.
//  - Storage: no schema change. The two days sit in the group's settings_json (like the Zelle number); the switch and the "marked paid" months are
//    task_log rows (kind 'mark', no game), the same way every feature switch is stored.
//
// Everything below is plain date and money arithmetic on Eastern calendar dates ("2026-11-30"), so tests can use a fake clock.

import { formatPrice } from './money';
import { localParts, zonedTimeToUtc } from './time';
import { DEFAULT_VENUE_NAME } from './settings';

export const VENUE_ALERT = { task: 'venue_alert_on', header: 'X-Venue-Alert', sinceHeader: 'X-Venue-Alert-Since', link: 'venuealert', env: 'VENUE_ALERT', name: 'Venue charge alert' } as const;

/** A wrangler.toml kill switch: allowed unless it says "off". Who gets it is Settings' call. */
export function venueAlertAllowed(flag: string | undefined | null): boolean {
  return (flag ?? 'on').trim().toLowerCase() !== 'off';
}

/** Task name of the "marked paid" row for one charge in one month: `venue_paid:court:2026-11` or `venue_paid:membership:2026-11`. */
export const PAID_PREFIX = 'venue_paid:';
export type ChargeKind = 'court' | 'membership';
export const paidTask = (kind: ChargeKind, month: string) => `${PAID_PREFIX}${kind}:${month}`;
/** A card key the Mark paid request may name: "court:2026-11", "membership:2026-11", or (Zip 51) a second court charge in a month "court:2026-11-30". */
export const VENUE_KEY_RE = /^(?:court:\d{4}-\d{2}(?:-\d{2})?|membership:\d{4}-\d{2})$/;

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

/**
 * When the charge days were last CHANGED (ms), kept next to them in settings_json (`venueDays.changedAt`); 0 = never. No backfill follows it: moving a day
 * never brings back a charge day that already passed, so only days that begin at or after the change can make a card.
 */
export function venueDaysChangedAt(settingsJson: string | null | undefined): number {
  try {
    const v = (JSON.parse(settingsJson || '{}') as { venueDays?: { changedAt?: unknown } }).venueDays?.changedAt;
    return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0;
  } catch {
    return 0;
  }
}

/**
 * Zip 51 (F-9): the days that were in force before each move, oldest first: `{ membershipDay, courtDay, from, until }` (ms; `from` 0 = since
 * always). Kept next to the days in settings_json (`venueDays.history`) by the Settings save that moved a day. Junk entries are skipped.
 */
export interface VenueDaysSpan extends VenueDays {
  from: number;
  until: number;
}
export const VENUE_HISTORY_MAX = 24;
export function venueDaysHistoryOf(settingsJson: string | null | undefined): VenueDaysSpan[] {
  try {
    const h = (JSON.parse(settingsJson || '{}') as { venueDays?: { history?: unknown } }).venueDays?.history;
    if (!Array.isArray(h)) return [];
    const out: VenueDaysSpan[] = [];
    for (const e of h) {
      if (!e || typeof e !== 'object') continue;
      const { from, until } = e as { from?: unknown; until?: unknown };
      if (typeof from !== 'number' || typeof until !== 'number' || !Number.isFinite(from) || !Number.isFinite(until) || from < 0 || until <= from) continue;
      out.push({ ...normalizeVenueDays(e), from, until });
    }
    return out.sort((a, b) => a.from - b.from).slice(-VENUE_HISTORY_MAX);
  } catch {
    return [];
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
  /** Zip 80: a tournament night (its courts all night, priced like Money > Totals: courts x hours x the court rate), not one regular game. */
  tournament?: { name: string; courts: number };
}

/** The games a court charge pays for: Booked and not canceled, starting on a date inside the period (Eastern, ends included). */
export function periodGames(games: VenueGame[], period: { from: string; to: string }, tz: string): VenueGame[] {
  return games.filter((g) => {
    if (!g.booked || g.canceled) return false;
    const day = localYmd(Date.parse(g.startsAt), tz);
    return day >= period.from && day <= period.to;
  });
}

/**
 * Zip 80: the court line for a period's games: courtLine for regular games, and a tournament night counted by its courts ("4 games x $48 + The
 * Cold Open (2 courts) = $312"; only the night: "The Cold Open (2 courts) = $120").
 */
export function courtLineOf(games: readonly VenueGame[]): string {
  const regular = games.filter((g) => !g.tournament).map((g) => g.costCents);
  const nights = games.filter((g) => g.tournament);
  if (!nights.length) return courtLine(regular);
  const total = games.reduce((a, g) => a + g.costCents, 0);
  const parts = nights.map((g) => `${g.tournament!.name} (${g.tournament!.courts} ${g.tournament!.courts === 1 ? 'court' : 'courts'})`);
  if (!regular.length) return `${parts.join(' + ')} = ${formatPrice(total)}`;
  const head = courtLine(regular).replace(/ = [^=]+$/, '');
  return `${head} + ${parts.join(' + ')} = ${formatPrice(total)}`;
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
  /**
   * The instant the switch was turned on (or the phone's private link was first opened). Charge days that start before it never show (no backfill).
   * Before Zip 51 the server passed the later of this and the days' last change; it now passes the change as `daysFrom`.
   */
  onAtMs: number;
  /** Zip 51 (F-9): when the current days took effect (`venueDays.changedAt`); 0 or missing = they always were. */
  daysFrom?: number;
  /** Zip 51 (F-9): the days in force before each move (venueDaysHistoryOf). Before the first kept days: those first days (as the site always assumed). */
  history?: readonly VenueDaysSpan[];
  /** "court:2026-11" style keys already marked paid. */
  paid: ReadonlySet<string>;
  /**
   * The charge date ("2026-10-31") of the latest court charge already marked paid, if any. A court period never starts before the day after it, so a moved
   * charge day can never bill a game that an earlier, paid court charge already covered. Same days every month: it changes nothing.
   */
  courtPaidThrough?: string | null;
  /**
   * Zip 49 (audit F-1): the charge date of EVERY court charge marked paid. A card's period only starts after a paid court charge EARLIER than its
   * own charge day, so marking a newer month paid never trims (or hides) an older unpaid card. Missing: courtPaidThrough, used the same way.
   */
  courtPaidDates?: readonly string[];
  /** Zip 78: Settings > Venue name (blank: the default club name), in the card's words. */
  venueName?: string | null;
}

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

/** The earliest date any due court period starts (venuePlan): the games to load begin here. Null: no court charge is due. */
export function earliestGameDate(plan: readonly PlannedCharge[]): string | null {
  const froms = plan.filter((c) => c.kind === 'court' && c.from).map((c) => c.from!).sort();
  return froms[0] ?? null;
}

/** One charge in the plan: its day, its month, the card key, and (court) the days its games come from. */
export interface PlannedCharge {
  kind: ChargeKind;
  date: string;
  month: string;
  key: string;
  from?: string;
}

/**
 * Zip 51 (F-9): the charge days on a timeline. For each month: the day each set of days in force at that day's 12:00 AM names (a moved day can
 * give a month two court days, the old one and the new one), plus every court charge already marked paid; a month left with none (its day moved
 * past it) gets the current days' day, so no month is ever skipped.
 */
function chargeDays(input: VenueInput, months: { year: number; month: number }[], kind: ChargeKind): Map<string, string[]> {
  const { tz } = input;
  const current: VenueDaysSpan = { ...input.days, from: input.daysFrom && input.daysFrom > 0 ? input.daysFrom : (input.history?.length ? input.history[input.history.length - 1].until : 0), until: Infinity };
  // Before the earliest kept days (a move saved before Zip 51 kept no old days) nothing is known: no day counts there, and a month left with
  // none gets the current days' day below, which bounds a period but never shows as a card (venuePlan: knownFrom).
  const spans = [...(input.history ?? []), current];
  const dayOf = (d: VenueDays, year: number, month: number) => ymd(year, month, dayIn(kind === 'court' ? d.courtDay : d.membershipDay, year, month));
  const out = new Map<string, string[]>();
  for (const { year, month } of months) {
    const key = monthKey(year, month);
    const got = new Set<string>();
    // A day counts when the days in force at its 12:00 AM name it. Before the switch went on, the days in force when it went on decide (days
    // picked while turning it on are a correction, not a move).
    for (const sp of spans) {
      const d = dayOf(sp, year, month);
      if (spanAt(spans, Math.max(startOfDayMs(d, tz), input.onAtMs)) === sp) got.add(d);
    }
    if (kind === 'court') for (const d of paidCourtDates(input)) if (d.startsWith(`${key}-`)) got.add(d);
    if (got.size === 0) got.add(dayOf(input.days, year, month));
    out.set(key, [...got].sort());
  }
  return out;
}

/** The kept days in force at an instant, or undefined before the earliest kept days. */
function spanAt(spans: readonly VenueDaysSpan[], at: number): VenueDaysSpan | undefined {
  return spans.find((sp) => at >= sp.from && at < sp.until);
}

/** Every court charge day already marked paid: the dates the rows carry; a month marked paid without one counts its current day (older callers). */
function paidCourtDates(input: VenueInput): string[] {
  const dates = new Set(input.courtPaidDates ?? (input.courtPaidThrough ? [input.courtPaidThrough] : []));
  for (const k of input.paid) {
    const m = /^court:(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(k);
    if (!m) continue;
    if (m[3]) dates.add(`${m[1]}-${m[2]}-${m[3]}`);
    else if (![...dates].some((d) => d.startsWith(`${m[1]}-${m[2]}-`))) dates.add(ymd(Number(m[1]), Number(m[2]), dayIn(input.days.courtDay, Number(m[1]), Number(m[2]))));
  }
  return [...dates].sort();
}

/**
 * The charges due right now, oldest first, without their amounts: what dueAlerts prices, and where the games to load start (`from` of the first
 * court charge). A charge is due once its day has started (12:00 AM Eastern) at or after the switch went on, and it is not marked paid.
 */
/** Zip 51 reviewer: where the kept days start (0 = always). A move saved before Zip 51 kept only `changedAt`, so time before it is unknown. */
function knownFromOf(input: Omit<VenueInput, 'games'>): number {
  const first = input.history?.length ? input.history[0].from : input.daysFrom && input.daysFrom > 0 ? input.daysFrom : 0;
  return first > 0 ? first : 0;
}

export function venuePlan(input: Omit<VenueInput, 'games'>): PlannedCharge[] {
  const { tz } = input;
  const knownFrom = knownFromOf(input);
  const todayYmd = localYmd(input.nowMs, tz);
  const shown = scanMonths(input.onAtMs, input.nowMs, tz);
  if (shown.length === 0) return [];
  // One month more at the front: the court charge before the first card bounds its period.
  const months = [prevMonthOf(shown[0].year, shown[0].month), ...shown];
  const full = { ...input, games: [] } as VenueInput;
  // A charge day shows from 12:00 AM on it, once the switch is on, and only where the days are known (before that: no backfill, as before Zip 51).
  const reached = (date: string) => date <= todayYmd && startOfDayMs(date, tz) >= input.onAtMs && startOfDayMs(date, tz) >= knownFrom;
  const out: PlannedCharge[] = [];

  const paidDates = new Set(paidCourtDates(full));
  const court = chargeDays(full, months, 'court');
  const allCourt = [...new Set([...[...court.values()].flat(), ...paidDates])].sort();
  for (const [month, dates] of court) {
    let monthKeyFree = !input.paid.has(`court:${month}`);
    for (const date of dates) {
      if (paidDates.has(date) || !reached(date)) continue;
      // The usual (first unpaid) court charge of a month keeps the month key; a second one in the same month is keyed by its date.
      const key = monthKeyFree ? `court:${month}` : `court:${date}`;
      monthKeyFree = false;
      const before = allCourt.filter((d) => d < date);
      const [y, m] = month.split('-').map(Number);
      const from = before.length ? addDays(before[before.length - 1], 1) : courtPeriod(input.days, y, m).from;
      out.push({ kind: 'court', date, month, key, from });
    }
  }
  // (A membership set to $0 charges nothing, so there is nothing to check: no card.)
  if (input.membershipCents > 0) {
    const membership = chargeDays(full, shown, 'membership');
    for (const [month, dates] of membership) {
      // One membership a month: on the month's first charge day.
      const date = dates[0];
      if (!reached(date) || input.paid.has(`membership:${month}`)) continue;
      out.push({ kind: 'membership', date, month, key: `membership:${month}` });
    }
  }
  return out.sort((a, b) => (a.date === b.date ? (a.kind === 'court' ? -1 : 1) : a.date < b.date ? -1 : 1));
}

/**
 * Every card due right now, oldest charge day first (venuePlan, priced). Court: nothing when the period has no booked games. When both charges of
 * one month land on the same day and both are due, one combined card.
 */
export function dueAlerts(input: VenueInput): VenueAlert[] {
  const { tz } = input;
  const COURT_NAME = input.venueName?.trim() || DEFAULT_VENUE_NAME;
  const due: { date: string; kind: ChargeKind; month: string; key: string; cents: number; line: string }[] = [];
  for (const c of venuePlan(input)) {
    if (c.kind === 'court') {
      const games = periodGames(input.games, { from: c.from!, to: c.date }, tz);
      const total = games.reduce((a, g) => a + g.costCents, 0);
      if (games.length > 0 && total > 0) due.push({ date: c.date, kind: 'court', month: c.month, key: c.key, cents: total, line: courtLineOf(games) });
    } else {
      due.push({ date: c.date, kind: 'membership', month: c.month, key: c.key, cents: input.membershipCents, line: `Monthly membership, ${COURT_NAME}` });
    }
  }
  const out: VenueAlert[] = [];
  for (let i = 0; i < due.length; i++) {
    const c = due[i];
    const m = due[i + 1];
    if (c.kind === 'court' && m && m.kind === 'membership' && m.date === c.date && m.month === c.month) {
      const total = c.cents + m.cents;
      out.push({ keys: [c.key, m.key], date: c.date, kinds: ['court', 'membership'], cents: total, title: `${COURT_NAME} should have charged you ${formatPrice(total)}`, line: `${c.line}, plus membership ${formatPrice(m.cents)}` });
      i++;
    } else if (c.kind === 'court') {
      out.push({ keys: [c.key], date: c.date, kinds: ['court'], cents: c.cents, title: `${COURT_NAME} should have charged you ${formatPrice(c.cents)}`, line: c.line });
    } else {
      out.push({ keys: [c.key], date: c.date, kinds: ['membership'], cents: c.cents, title: `Membership should have been charged: ${formatPrice(c.cents)}`, line: c.line });
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
