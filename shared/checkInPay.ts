// Zip 34 (Nov 2026): CHECKIN_PAY_LINE ("Check-in pay line"), ships OFF. Words only.
//  - The night-before Check-in text (4 or more in) gets a soft pay nudge, but only while a signed-up player (not the organizer) still owes:
//        Pickleball tomorrow @ 7:30pm!
//        5 in. Still in? Pay $14 to confirm.
//        Need out? Tell me tonight.
//
//        pickleball.juncaj.net
//    When everyone signed up has paid (or the switch is off, or Texts round 2 is off) the text is exactly what it was.
//  - ONE builder (checkInBody below) picks between the four Check-in wordings. The gear menu, the Home card (src/pages/admin/textMenu.ts)
//    and the Telegram link (server/go.ts) all call it, so the words can never differ between them.
//  - "Owes" is the money card's meaning (the owesCents the server worked out: price minus credit used, minus cash paid earlier), restricted to
//    people who are signed up and in (never the waitlist, never the organizer). No money rule, price, seat or database change.
import { formatPrice } from './money';
import { checkInMessage } from './messages';
import { checkInTextR2, dayGap, dayWordR2, whenR2 } from './textsR2';
import { checkInTextLastCall } from './lastCall';

export const CHECKIN_PAY_LINE = { task: 'checkin_pay_line_on', header: 'X-Checkin-Pay', link: 'checkinpay', env: 'CHECKIN_PAY_LINE', name: 'Check-in pay line' } as const;

/** A wrangler.toml kill switch: allowed unless it says "off". Who sees it is Settings' call. */
export function checkInPayAllowed(flag: string | undefined | null): boolean {
  return (flag ?? 'on').trim().toLowerCase() !== 'off';
}

/** The parts of a roster row the pay line needs (an AdminRosterEntry has all of them). */
export interface PayRow {
  status: string;
  isOrganizer: boolean;
  paymentStatus: string;
  owesCents: number;
}

/**
 * Does somebody who is signed up and in still owe? Confirmed, not the organizer, unpaid, with something left to pay after credit. The same
 * people the money card's "who hasn't paid" list holds, minus anyone who is not in (a waitlisted player, a seat that left owing a late fee).
 */
export function signedUpOwe(roster: readonly PayRow[]): boolean {
  return roster.some((r) => !r.isOrganizer && r.status === 'confirmed' && r.paymentStatus === 'unpaid' && r.owesCents > 0);
}

interface SessionLike {
  startsAt: string;
  endsAt: string;
}

/**
 * When to tell Alex: "tonight" for a game tomorrow or tonight, "now" for a daytime game today (tonight would be wrong), "early" further out
 * (the same word the other Check-in wordings use there).
 */
function byWhen(iso: string, tz: string, nowMs: number): 'tonight' | 'now' | 'early' {
  const gap = dayGap(iso, tz, nowMs);
  if (gap > 1) return 'early';
  if (gap === 0 && dayWordR2(iso, tz, nowMs) === 'today') return 'now';
  return 'tonight';
}

/**
 * The Check-in with the pay line (4 or more in, somebody signed up still owes). `priceCents` is the standard price the site shows players for
 * that game; people with credit may owe less, but the text always names the standard price. Opens with no recipients (the group chat).
 */
export function checkInTextPayLine(s: SessionLike, tz: string, nowMs: number, signedUp: number, priceCents: number, link: string): string {
  const body = [
    `Pickleball ${whenR2(s.startsAt, tz, nowMs)}!`,
    `${signedUp} in. Still in? Pay ${formatPrice(priceCents)} to confirm.`,
    `Need out? Tell me ${byWhen(s.startsAt, tz, nowMs)}.`,
  ];
  return `${body.join('\n')}\n\n${link}`;
}

export interface CheckInChoice {
  s: SessionLike;
  tz: string;
  nowMs: number;
  /** Confirmed players in the game (4 or more for a Check-in). */
  signedUp: number;
  link: string;
  /** TEXTS_R2 is on for this screen (the line only exists on top of it, like Last call texts). */
  r2: boolean;
  /** LAST_CALL_TEXTS is on for this screen (only counts with r2). */
  lastCall: boolean;
  /** CHECKIN_PAY_LINE is on for this screen (only counts with r2). */
  payLine: boolean;
  /** Does somebody signed up (not the organizer) still owe? See signedUpOwe. */
  someoneOwes: boolean;
  /** The standard price the site shows players for this game. */
  priceCents: number;
}

/** THE Check-in text. Every place that builds it calls this, so the words can never differ between them. */
export function checkInBody(c: CheckInChoice): string {
  if (c.r2 && c.payLine && c.someoneOwes) return checkInTextPayLine(c.s, c.tz, c.nowMs, c.signedUp, c.priceCents, c.link);
  if (c.r2) return c.lastCall ? checkInTextLastCall(c.s, c.tz, c.nowMs, c.signedUp, c.link) : checkInTextR2(c.s, c.tz, c.nowMs, c.signedUp, c.link);
  return checkInMessage(c.s, c.tz, c.nowMs, c.link);
}
