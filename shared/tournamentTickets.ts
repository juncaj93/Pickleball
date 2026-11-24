// Zip 56 "Tournaments", piece 2 (server/tournamentTickets.ts): the pure rules of tickets, shared by the server and the two tournament screens
// (the player's card in src/tournament/, the organizer's in src/pages/admin/Tournament.tsx). Its own file on purpose: the player download
// (src/lib.ts reads shared/tournament.ts for the switch) stays exactly what it was, and only the tournament screens fetch this.
//
// The rules (the brief, Zip 56):
//  - Spots follow the players locked in (6 to 16; the hidden cap is 16 since Zip 63). The ticket is the tournament's flat price ($16 to start),
//    the same for every size.
//  - Lock my spot uses the player's credit at once (the site's rule at I'm in); the rest is paid on the site's own Pay sheet (Venmo, I paid).
//    Only CONFIRMED money counts as paid (credit, or cash the organizer confirmed): an I paid waits for the organizer and holds no spot.
//  - A spot belongs to a ticket paid in full. When every spot is taken, players join the waitlist; a waitlist player may pay to hold.
//    When a spot opens, the first PAID person in line (in the order they joined it) gets it automatically. Unpaid people stay in line.
//  - Backing out (or being taken off, or a Cancel) gives everything on the ticket back as credit: credit used goes back to the pot, cash
//    becomes a new credit entry. An I paid that is still waiting stays as it is until the organizer answers (then it becomes credit too).
//  - A hold that never got a spot comes back as credit once the tournament night is over (its date at the start time plus the plan).
//  - The organizer pays the venue, never the group: their own seat is a ticket at $0, one of the spots.
import { formatShortDate, formatTime, formatWeekdayShort, localParts, zonedTimeToUtc } from './time';
import { dayParts } from './tournament';

export type TicketPlace = 'spot' | 'line' | 'none';

export interface TicketMoney {
  priceCents: number;
  creditCents: number;
  paidCents: number;
  claimCents: number;
}

/**
 * Zip 85 (🎾84 dry run, Alex approved): "Didn't pay" AFTER the tournament night has started, on a ticket that counted as locked in by its I paid.
 * They played, so they still owe it like any unpaid game: the I paid's amount stays on the ticket as the debt (claim_cents), marked with this
 * value in claim_at (a time otherwise). They stay in the night (nothing about the games changes); their own You owe card shows it with Pay and
 * I paid; the organizer's Money shows it with Mark paid. An I paid on it sets claim_at to 'owed:<the tap time>' (an I paid waiting, as always);
 * Paid or Mark paid moves it into paid_cents and the ticket takes its spot; Didn't pay again puts the mark back. No table or column change.
 */
export const OWED_MARK = 'owed';
/** Zip 85: an I paid sent on an owed ticket keeps where it came from: claim_at 'owed:<the tap time>' (Paid then gives the spot it played in). */
export const fromOwedClaim = (claimAt: string | null | undefined): boolean => typeof claimAt === 'string' && claimAt.startsWith(OWED_MARK);
export const isOwedClaim = (k: { claimCents?: number; claim_cents?: number; claimAt?: string | null; claim_at?: string | null }): boolean =>
  (k.claimCents ?? k.claim_cents ?? 0) > 0 && (k.claimAt ?? k.claim_at) === OWED_MARK;

/** Still to pay: the price minus credit on it, confirmed cash and an I paid that waits. Never below $0. */
export const ticketOwed = (k: TicketMoney): number => Math.max(0, k.priceCents - k.creditCents - k.paidCents - k.claimCents);

/** Paid in full with money that counts (credit and confirmed cash). An I paid that waits does not count yet. */
export const ticketPaid = (k: Pick<TicketMoney, 'priceCents' | 'creditCents' | 'paidCents'>): boolean => k.creditCents + k.paidCents >= k.priceCents;

/** What comes back as credit if they back out now (credit on it and confirmed cash; an I paid that waits comes later). */
export const ticketBack = (k: Pick<TicketMoney, 'creditCents' | 'paidCents'>): number => k.creditCents + k.paidCents;

/** The ledger's reason for credit used on a ticket of this tournament (session_id stays empty, as with extra time's 'ext:<game>'). */
export const tourReason = (tournamentId: string): string => `tour:${tournamentId}`;

/** Why money came back from a ticket as credit: backed out, taken off by the organizer, the tournament canceled, a hold never used. */
export type TourBackWhy = 'back' | 'off' | 'cancel' | 'unused';
export const TOUR_BACK_WHYS: readonly TourBackWhy[] = ['back', 'off', 'cancel', 'unused'];
/** The ledger's reason for cash that came back as credit: 'tour:<tournament id>:<why>'. */
export const tourBackReason = (tournamentId: string, why: TourBackWhy): string => `tour:${tournamentId}:${why}`;

/** Zip 58: an award's credit (End tournament): the champion credit, or Americano's 2nd place credit. Reason 'tour:<tournament id>:<award>'. */
export type TourAward = 'champion' | 'second';

/** A ledger reason read back: the tournament and, for money that came back (or an award, Zip 58), why. Null for anything that is not a ticket's. */
export function tourOfReason(reason: string | null | undefined): { tournamentId: string; why: TourBackWhy | TourAward | null } | null {
  const m = /^tour:([0-9a-f-]{36})(?::(back|off|cancel|unused|champion|second))?$/.exec(reason ?? '');
  return m ? { tournamentId: m[1], why: (m[2] as TourBackWhy | TourAward | undefined) ?? null } : null;
}

/** The moment the tournament night starts (its date at the plan's start, Eastern), in ms. */
export function startMsOf(finalDate: string, startMinutes: number, tz: string): number {
  const p = dayParts(finalDate);
  return zonedTimeToUtc(p.year, p.month, p.day, Math.floor(startMinutes / 60), startMinutes % 60, tz);
}

/** The moment the tournament night is over (the start plus the plan's minutes), in ms. */
export const endMsOf = (finalDate: string, startMinutes: number, minutes: number, tz: string): number => startMsOf(finalDate, startMinutes, tz) + minutes * 60_000;

/** The usual Pay by (Zip 59): the night before the tournament at 7:00 PM Eastern (Wednesday 7:00 PM for a Thursday game). */
export const PAY_BY_DAYS_BEFORE = 1;
export const PAY_BY_HOUR = 19;

/** Zip 59: a spot freed by a back out can still be claimed until this long before the start (3 hours). After that, nothing. */
export const FREED_CUTOFF_MS = 3 * 3_600_000;

/** The last moment anyone can take or claim a ticket: 3 hours before the start of the night, in ms. */
export const salesCutoffMs = (startMs: number): number => startMs - FREED_CUTOFF_MS;

/**
 * The default Pay by for a date: the night before at 7:00 PM Eastern. If that has already passed (tickets opened late), the last moment
 * anything can still be claimed, 3 hours before the start (which may itself have passed: then tickets open already closed). As an ISO time.
 */
export function defaultPayBy(finalDate: string, startMinutes: number, tz: string, nowMs: number): string {
  const p = dayParts(finalDate);
  const at = (daysBefore: number) => {
    const d = new Date(Date.UTC(p.year, p.month - 1, p.day - daysBefore));
    return zonedTimeToUtc(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), PAY_BY_HOUR, 0, tz);
  };
  const start = startMsOf(finalDate, startMinutes, tz);
  const cutoff = salesCutoffMs(start);
  const pick = [at(PAY_BY_DAYS_BEFORE), cutoff].find((ms) => ms > nowMs && ms <= cutoff) ?? cutoff;
  return new Date(pick).toISOString();
}

/**
 * "Tue 7:00 PM" (the pictures): Pay by is in the tournament's own week, so the weekday is enough next to the date on the ticket. A Pay by the
 * organizer set more than six days before the tournament gets its date too ("Tue, Dec 8, 7:00 PM"), so it is never read as the wrong Tuesday.
 * `finalDate`: the tournament's day ('YYYY-MM-DD'); without it the weekday alone.
 */
export function payByLabel(iso: string, tz: string, finalDate?: string | null): string {
  const ms = Date.parse(iso);
  if (finalDate) {
    const p = dayParts(finalDate);
    const day = Date.UTC(p.year, p.month - 1, p.day);
    const local = localParts(ms, tz);
    const by = Date.UTC(local.year, local.month - 1, local.day);
    if (day - by > 6 * 86_400_000) return `${formatShortDate(iso, tz)}, ${formatTime(iso, tz)}`;
  }
  return `${formatWeekdayShort(iso, tz)} ${formatTime(iso, tz)}`;
}

/** Zip 63: "11/30", the bottom line of the ticket card ("Pay by 11/30"): the Pay by day as month/day, Eastern. */
export function payByShort(iso: string, tz: string): string {
  const p = localParts(Date.parse(iso), tz);
  return `${p.month}/${p.day}`;
}

/** The organizer's plain warning when the number locked in is odd at the Pay by time (no one is ever taken off by the site). */
export const evensWarning = (locked: number): string => `${locked} locked in. Need 1 more or 1 less.`;

/** The organizer's Home card: "Tickets: 6 of 8 locked in". */
export const ticketsLine = (locked: number, size: number): string => `Tickets: ${locked} of ${size} locked in`;

/** "first", "second", "third", then "4th", "21st" (for "You're first on the waitlist"). */
export function placeWord(n: number): string {
  if (n === 1) return 'first';
  if (n === 2) return 'second';
  if (n === 3) return 'third';
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  return `${n}${({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th'}`;
}

/** The Pay by choices the organizer picks from: every day from today to the tournament day (Eastern), as 'YYYY-MM-DD'. */
export function payByDays(finalDate: string, tz: string, nowMs: number): string[] {
  const t = localParts(nowMs, tz);
  const out: string[] = [];
  const from = Date.UTC(t.year, t.month - 1, t.day);
  const end = dayParts(finalDate);
  const to = Date.UTC(end.year, end.month - 1, end.day);
  for (let ms = from; ms <= to && out.length < 120; ms += 86_400_000) {
    const d = new Date(ms);
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`);
  }
  return out;
}

/** A Pay by moment from a day ('YYYY-MM-DD') and minutes after midnight, Eastern, as an ISO time. */
export function payByAt(day: string, minutes: number, tz: string): string {
  const p = dayParts(day);
  return new Date(zonedTimeToUtc(p.year, p.month, p.day, Math.floor(minutes / 60), minutes % 60, tz)).toISOString();
}

/** A Pay by moment back to its day and minutes after midnight (Eastern), for the organizer's two pickers. */
export function payByParts(iso: string, tz: string): { day: string; minutes: number } {
  const p = localParts(Date.parse(iso), tz);
  return { day: `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`, minutes: p.hour * 60 + p.minute };
}

/**
 * Zip 63: the pay countdown on a player's Home (mocks 08 to 13): the site's alert card, for a player on the list who can still lock a spot and
 * has not paid. Nothing until 3 days before Pay by (counted in Eastern calendar days); then "3 days left to pay", "2 days left to pay" and
 * "Payment due tomorrow" (amber), and on the day "Payment due today", "Due in 5 hours" (under 6 hours left) and "Due in 42 minutes" (the last
 * hour), red. After Pay by (only while a spot can still be paid for, the existing late rule): red "Your payment is late". Null: no card now.
 * A pure function of the moment, so the card counts down on its own while the page is open.
 */
export interface PayCountdown {
  tone: 'amber' | 'red';
  icon: 'owe' | 'clock' | 'stop';
  title: string;
  sub: string;
  late: boolean;
}

/** Zip 63: "Due in 5 hours" from this much time left. */
export const DUE_IN_HOURS_FROM_MS = 6 * 3_600_000;

export function payCountdown(payByIso: string, nowMs: number, tz: string, tournamentName: string): PayCountdown | null {
  const by = Date.parse(payByIso);
  if (!Number.isFinite(by)) return null;
  const left = by - nowMs;
  if (left <= 0) return { tone: 'red', icon: 'stop', title: 'Your payment is late', sub: `Pay now to stay in ${tournamentName}`, late: true };
  const t = localParts(nowMs, tz);
  const b = localParts(by, tz);
  const days = Math.round((Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(t.year, t.month - 1, t.day)) / 86_400_000);
  if (days > 3) return null;
  const time = formatTime(payByIso, tz);
  if (days >= 2) return { tone: 'amber', icon: 'owe', title: `${days} days left to pay`, sub: `Pay by ${formatWeekdayShort(payByIso, tz)} ${time}`, late: false };
  if (days === 1) return { tone: 'amber', icon: 'owe', title: 'Payment due tomorrow', sub: `Pay by ${time}`, late: false };
  const sub = `Pay by ${time} ${b.hour >= 17 ? 'tonight' : 'today'}`;
  if (left >= DUE_IN_HOURS_FROM_MS) return { tone: 'red', icon: 'clock', title: 'Payment due today', sub, late: false };
  if (left >= 3_600_000) {
    // Zip 72 (dry run): the nearest hour, so 4 hours 59 minutes left says "Due in 5 hours" (it used to round down to 4).
    const h = Math.round(left / 3_600_000);
    return { tone: 'red', icon: 'clock', title: `Due in ${h} ${h === 1 ? 'hour' : 'hours'}`, sub, late: false };
  }
  const m = Math.max(1, Math.floor(left / 60_000));
  return { tone: 'red', icon: 'clock', title: `Due in ${m} ${m === 1 ? 'minute' : 'minutes'}`, sub, late: false };
}

/**
 * Zip 63: the organizer's "Remind all unpaid" text for a tournament (mock 14), ending with the plain site address like every text the site
 * prepares: "Hey, please pay for The Cold Open tonight so the courts are locked in for tomorrow. pickleball.juncaj.net". The words follow the
 * clock (Eastern): Pay by today is "tonight" (5:00 PM or later) or "today"; tomorrow "by tomorrow night" or "by tomorrow"; later "by Monday".
 * The tournament day: "tonight", "tomorrow", its weekday within 6 days ("Tuesday"), else its date ("Tue, Dec 1").
 */
export function tournamentRemindText(name: string, payByIso: string, finalDate: string, nowMs: number, tz: string, link: string): string {
  const t = localParts(nowMs, tz);
  const today = Date.UTC(t.year, t.month - 1, t.day);
  const b = localParts(Date.parse(payByIso), tz);
  const byDays = Math.round((Date.UTC(b.year, b.month - 1, b.day) - today) / 86_400_000);
  const evening = b.hour >= 17;
  const weekdayLong = (iso: string) => new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'long' }).format(new Date(iso));
  const when = byDays <= 0 ? (evening ? 'tonight' : 'today') : byDays === 1 ? (evening ? 'by tomorrow night' : 'by tomorrow') : `by ${weekdayLong(payByIso)}`;
  const d = dayParts(finalDate);
  const dayDiff = Math.round((Date.UTC(d.year, d.month - 1, d.day) - today) / 86_400_000);
  const noonIso = new Date(zonedTimeToUtc(d.year, d.month, d.day, 12, 0, tz)).toISOString();
  const day = dayDiff <= 0 ? 'tonight' : dayDiff === 1 ? 'tomorrow' : dayDiff <= 6 ? weekdayLong(noonIso) : formatShortDate(noonIso, tz);
  const forDay = day === 'tonight' ? 'tonight' : `for ${day}`;
  return `Hey, please pay for ${name} ${when} so the courts are locked in ${forDay}. ${link}`;
}
