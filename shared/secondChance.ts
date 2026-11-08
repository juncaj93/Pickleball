// Zip 15 (Nov 2026): SECOND_CHANCE, ships OFF. Same-day games that are not booked yet.
//
// A game "counts" for these features when it is TODAY (Eastern), not booked (court switch Not booked or Waitlist), not canceled, and not
// started. Three ways a same-day game starts:
//  1. A normal game, not booked: nothing on Home until people join (only the two Telegrams below).
//  2. SECOND CHANCE: a game canceled THE NIGHT BEFORE (the Eastern day before its date) with EXACTLY 3 in (2 in: nothing). Admin Home
//     gets a card in steps: 1 "Thu 7:30 PM was 1 short" + Book a court (opens CourtReserve; the tap moves the card to step 2), 2 "Court open
//     tonight?" + a time (30-minute steps) + Reopen game (the site's own Reopen of that canceled game, then its own time change), 3
//     "Reopened for 7:30 PM" + Text the group, 4 (4 in AND paid) "4 signed up and paid" + Book a court. An X hides it for the day.
//  3. SAME-DAY ADD: a game added on its own day ("+ Add game" for today): "Tonight 8:00 PM, 1 of 4 in" + Text the group.
// Telegrams (to the organizer only, through the site's one sender): 1 when 4 are in and not all paid (with a link that opens Messages to
// only the unpaid players), 2 when 4 have paid ("Book it now", with the CourtReserve link). Each at most once per game, never after the
// game is booked or canceled; if 4 paid before 4 were ever counted, only Telegram 2.
// Cutoff: a reopened or same-day game still short of 4 two hours before the start: "Still short, cancel it?" with a one-tap cancel.
// No new status, no schema change: card steps and sent Telegrams are task_log rows (one per game, the table's own unique index).

import { MIN_PLAYERS } from './spots';
import { formatTime, formatWeekdayShort, localParts, zonedTimeToUtc } from './time';
import { dayGap, dayLabelR2, dayWordR2 } from './textsR2';

export const SECOND_CHANCE = { task: 'second_chance_on', header: 'X-Second-Chance', link: 'secondchance', env: 'SECOND_CHANCE', name: 'Second Chance' } as const;

/**
 * Preview only: "pretend it's noon on game day" for one phone, so the cards can be tried on any day. Needs SECOND_CHANCE_TEST = "on",
 * which only [env.preview.vars] has (production never does, so on live this does nothing), plus the phone opened the site once with
 * ?noontest=on. Only these features read the pretend time; every other screen, price and button keeps the real clock. The same var makes
 * the two Telegrams a visible fake on the preview (shown on Home, never sent).
 */
export const SECOND_CHANCE_TEST = { header: 'X-Second-Chance-Noon', link: 'noontest', env: 'SECOND_CHANCE_TEST' } as const;

/** A wrangler.toml kill switch: allowed unless it says "off". Who gets it is Settings' call. */
export function secondChanceAllowed(flag: string | undefined | null): boolean {
  return (flag ?? 'on').trim().toLowerCase() !== 'off';
}

/** task_log names. Marks (kind 'mark') are card steps; the two Telegrams are kind 'sent' (written before sending, so each goes once). */
export const SC = {
  /** Step 1's Book a court was tapped: the card shows step 2. */
  booking: 'sc_booking',
  /** The X: no Second Chance card for this game. */
  dismissed: 'sc_dismissed',
  /** Reopened from the card; `detail` holds the original start time (for "instead of 7:30"). */
  reopened: 'sc_reopened',
  /** Canceled from the cutoff card (so a canceled same-day game never turns into a Second Chance card). */
  cut: 'sc_cut',
  /** Telegram 1: 4 in, not all paid. */
  pingIn: 'sc_ping_in',
  /** Telegram 2: 4 paid. */
  pingPaid: 'sc_ping_paid',
} as const;

/** The cutoff: this long before the start a short reopened or same-day game asks "Still short, cancel it?". */
export const CUTOFF_MS = 2 * 3600_000;
/** Step 2's time picker: 30-minute steps, from 4:00 PM to 9:30 PM (plus the game's own time, always). */
export const PICK_STEP_MIN = 30;
export const PICK_FIRST_MIN = 16 * 60;
export const PICK_LAST_MIN = 21 * 60 + 30;

const pad = (n: number) => String(n).padStart(2, '0');
/** "2026-11-12": the Eastern date of a moment. */
export function dayKey(ms: number, tz: string): string {
  const p = localParts(ms, tz);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}
const keyMinusOneDay = (key: string) => {
  const d = new Date(`${key}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
};

/** Noon (Eastern) on a date key. */
export function noonOf(key: string, tz: string): number {
  const [y, m, d] = key.split('-').map(Number);
  return zonedTimeToUtc(y, m, d, 12, 0, tz);
}

/** "7:30" or "8:00": the texts' time (the site's 12-hour clock without AM/PM). */
export function textTime(iso: string, tz: string): string {
  return formatTime(iso, tz).replace(/\s?[AP]M$/i, '');
}
/** "Thu 7:30 PM" */
export function dayTime(iso: string, tz: string): string {
  return `${formatWeekdayShort(iso, tz)} ${formatTime(iso, tz)}`;
}

/** What the rules need from one game. */
export interface ScGame {
  id: string;
  startsAt: string;
  endsAt: string;
  canceled: boolean;
  /** The court switch says Booked. */
  booked: boolean;
  canceledAt: string | null;
  /** 'organizer_fee_kept' (the venue charged): never a Second Chance. */
  canceledBy: string | null;
  createdAt: string;
  /** Made with "+ Add game" (regular Tue/Thu games are made by the site, never same-day adds). */
  extra: boolean;
  /** Everyone in, the organizer included. */
  inCount: number;
  /** Paid seats of the other players, plus the organizer's own seat when they are in (they pay the venue, never the group). */
  paidCount: number;
  /** The other players in who have not paid: who the Request buttons and Telegram 1 name. */
  unpaid: ScUnpaid[];
  marks: ReadonlySet<string>;
  /** The original start time saved with the reopen mark, when reopened from the card. */
  reopenedFrom: string | null;
}

export interface ScUnpaid {
  playerId: string;
  name: string;
  owesCents: number;
  phone: string | null;
}

export type ScCard =
  | { kind: 'chance'; step: 1 | 2; sessionId: string; startsAt: string; endsAt: string; inCount: number }
  | {
      kind: 'open';
      /** reopened: a Second Chance game after Reopen; sameday: a game added on its own day. */
      origin: 'reopened' | 'sameday';
      /** 3 (or the same-day card): fill it; 4: 4 in and paid, book it; cutoff: still short two hours before. */
      step: 3 | 4 | 'cutoff';
      sessionId: string;
      startsAt: string;
      endsAt: string;
      inCount: number;
      paidCount: number;
      unpaid: ScUnpaid[];
      /** The group text the purple button opens (Messages, no recipients). */
      groupText: string;
    };

/** Today's date for these features (the real Eastern date, or on a preview phone with ?noontest=on, the pretend one). */
export function isToday(g: Pick<ScGame, 'startsAt'>, nowMs: number, tz: string): boolean {
  return dayGap(g.startsAt, tz, nowMs) === 0;
}

/** Does this game count right now: today, not booked, not canceled, not started. */
export function counts(g: Pick<ScGame, 'startsAt' | 'canceled' | 'booked'>, nowMs: number, tz: string): boolean {
  return !g.canceled && !g.booked && nowMs < Date.parse(g.startsAt) && isToday(g, nowMs, tz);
}

/** A Second Chance candidate: canceled the night before with exactly 3 in, never booked, today and not started, not used or dismissed. */
export function isChance(g: ScGame, nowMs: number, tz: string): boolean {
  if (!g.canceled || g.booked || !g.canceledAt || g.canceledBy === 'organizer_fee_kept') return false;
  if (g.inCount !== MIN_PLAYERS - 1) return false;
  if (nowMs >= Date.parse(g.startsAt) || !isToday(g, nowMs, tz)) return false;
  if (dayKey(Date.parse(g.canceledAt), tz) !== keyMinusOneDay(dayKey(Date.parse(g.startsAt), tz))) return false;
  return !g.marks.has(SC.dismissed) && !g.marks.has(SC.reopened) && !g.marks.has(SC.cut);
}

/** A game added on its own day. `alsoToday` (preview test only): a game added on the real today counts too. */
export function isSameDay(g: ScGame, tz: string, alsoToday: string | null = null): boolean {
  if (!g.extra) return false;
  const made = dayKey(Date.parse(g.createdAt), tz);
  return made === dayKey(Date.parse(g.startsAt), tz) || (alsoToday !== null && made === alsoToday);
}

/** The Home cards, in order (earliest game first). */
export function secondChanceCards(games: readonly ScGame[], nowMs: number, tz: string, link: string, alsoToday: string | null = null): ScCard[] {
  const out: ScCard[] = [];
  for (const g of [...games].sort((a, b) => a.startsAt.localeCompare(b.startsAt))) {
    if (isChance(g, nowMs, tz)) {
      out.push({ kind: 'chance', step: g.marks.has(SC.booking) ? 2 : 1, sessionId: g.id, startsAt: g.startsAt, endsAt: g.endsAt, inCount: g.inCount });
      continue;
    }
    if (!counts(g, nowMs, tz)) continue;
    const reopened = g.marks.has(SC.reopened);
    if (!reopened && !isSameDay(g, tz, alsoToday)) continue;
    const full = g.inCount >= MIN_PLAYERS;
    const step: 3 | 4 | 'cutoff' = full && g.paidCount >= MIN_PLAYERS ? 4 : !full && nowMs >= Date.parse(g.startsAt) - CUTOFF_MS ? 'cutoff' : 3;
    out.push({
      kind: 'open',
      origin: reopened ? 'reopened' : 'sameday',
      step,
      sessionId: g.id,
      startsAt: g.startsAt,
      endsAt: g.endsAt,
      inCount: g.inCount,
      paidCount: g.paidCount,
      unpaid: g.unpaid,
      groupText: reopened ? reopenText(g.startsAt, g.reopenedFrom, tz, nowMs, link) : sameDayText(g.startsAt, tz, nowMs, link),
    });
  }
  return out;
}

/** Lines, then the site address alone after a blank line (the site's usual text shape). */
const withLink = (paras: string[], link: string) => `${paras.join('\n\n')}\n\n${link}`;

/**
 * The group text after a Second Chance reopen. TEXT 1 (same time as the original) and TEXT 2 (a new time: "at 8:00 (instead of 7:30), so I
 * reopened signups for 8:00."). "tonight" is "today" for a game before 5:00 PM.
 */
export function reopenText(startsAt: string, wasStartsAt: string | null, tz: string, nowMs: number, link: string): string {
  const when = dayWordR2(startsAt, tz, nowMs);
  const at = textTime(startsAt, tz);
  const moved = wasStartsAt !== null && wasStartsAt !== startsAt;
  const first = moved
    ? `Hey guys, we canceled to avoid fees since we were down 1. A few courts are open ${when} at ${at} (instead of ${textTime(wasStartsAt!, tz)}), so I reopened signups for ${at}.`
    : `Hey guys, we canceled to avoid fees since we were down 1. A few courts are open ${when} at ${at}, so I reopened signups.`;
  return withLink([first, `If 4 sign up and pay, I'll book a court for ${when}.`, 'Already paid for the canceled game? Tap Use Credit.'], link);
}

/** The group text for a game added on its own day. */
export function sameDayText(startsAt: string, tz: string, nowMs: number, link: string): string {
  return withLink([`Hey guys, anyone want to play ${dayWordR2(startsAt, tz, nowMs)} at ${textTime(startsAt, tz)}? I added it to the site. If 4 sign up and pay, I'll book a court.`], link);
}

/** The text Telegram 1's link opens, to ONLY the unpaid players. */
export function unpaidText(startsAt: string, inCount: number, tz: string, nowMs: number, link: string): string {
  return withLink([`Hey, we have ${inCount} in for ${dayWordR2(startsAt, tz, nowMs)} at ${textTime(startsAt, tz)}. Please pay on the site and I'll book the court.`], link);
}

/** "Tonight 7:30 PM" */
export function tonightLabel(startsAt: string, tz: string, nowMs: number): string {
  return `${dayLabelR2(startsAt, tz, nowMs)} ${formatTime(startsAt, tz)}`;
}

const names = (list: string[]) => (list.length <= 1 ? list.join('') : `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`);

/**
 * TELEGRAM 1: "Tonight 7:30 PM: 4 in, 2 of 4 paid. Text the 2 who haven't paid: <link>" (the address becomes the tappable words). Players
 * with no phone on file are left out of the text and named: "No phone saved for Joe." `textLink` null: nobody to text.
 */
export function pingInMessage(startsAt: string, inCount: number, paidCount: number, unpaid: readonly ScUnpaid[], tz: string, nowMs: number, textLink: string | null): string {
  const head = `${tonightLabel(startsAt, tz, nowMs)}: ${inCount} in, ${paidCount} of ${inCount} paid.`;
  const reach = unpaid.filter((u) => !!u.phone);
  const none = unpaid.filter((u) => !u.phone).map((u) => u.name);
  const parts = [head];
  // No names in the words that become the link (a name can never change which words are linked); the sheet it opens names them.
  if (reach.length && textLink) parts.push(`Text the ${reach.length} who ${reach.length === 1 ? "hasn't" : "haven't"} paid: ${textLink}`);
  if (none.length) parts.push(`No phone saved for ${names(none)}.`);
  return parts.join('\n');
}

/** TELEGRAM 2: "4 paid for tonight 7:30 PM. Book it now: <CourtReserve>" ("4 paid, 6 in for ..." when more are in). */
export function pingPaidMessage(startsAt: string, inCount: number, paidCount: number, tz: string, nowMs: number, bookUrl: string): string {
  const who = inCount > paidCount ? `${paidCount} paid, ${inCount} in` : `${paidCount} paid`;
  return `${who} for ${dayWordR2(startsAt, tz, nowMs)} ${formatTime(startsAt, tz)}. Book it now: ${bookUrl}`;
}

/** Which Telegram (if any) is due for a game right now. Each at most once; Telegram 1 never after Telegram 2. */
export function duePing(g: Pick<ScGame, 'startsAt' | 'canceled' | 'booked' | 'inCount' | 'paidCount'>, sent: { in: boolean; paid: boolean }, nowMs: number, tz: string): 'in' | 'paid' | null {
  if (!counts(g, nowMs, tz)) return null;
  if (g.inCount >= MIN_PLAYERS && g.paidCount >= MIN_PLAYERS) return sent.paid ? null : 'paid';
  if (g.inCount >= MIN_PLAYERS && !sent.in && !sent.paid) return 'in';
  return null;
}

/** Step 2's choices: every half hour from 4:00 PM to 9:30 PM still in the future, plus the game's own time. Minutes after midnight. */
export function pickTimes(startsAt: string, tz: string, nowMs: number): number[] {
  const own = localParts(Date.parse(startsAt), tz);
  const ownMin = own.hour * 60 + own.minute;
  const nowParts = localParts(nowMs, tz);
  const today = dayKey(nowMs, tz) === dayKey(Date.parse(startsAt), tz);
  const nowMin = today ? nowParts.hour * 60 + nowParts.minute : -1;
  const out = new Set<number>([ownMin]);
  for (let m = PICK_FIRST_MIN; m <= PICK_LAST_MIN; m += PICK_STEP_MIN) if (m > nowMin) out.add(m);
  return [...out].sort((a, b) => a - b);
}

/** "7:30 PM" for minutes after midnight. */
export function minutesLabel(min: number): string {
  const h = Math.floor(min / 60);
  return `${h % 12 === 0 ? 12 : h % 12}:${pad(min % 60)} ${h < 12 ? 'AM' : 'PM'}`;
}
