// Zip 37 (Nov 2026): GAME_DAY_TEXT ("Game day text"), ships OFF. Words, links and one Telegram to the organizer.
//  - About an hour before a booked game with 4 or more in, the organizer gets one Telegram with a private "Text the players" link.
//  - The link opens a page on the site (/gt/<token>) that asks the server for the players' numbers and the words, then opens Messages
//    addressed ONLY to the players signed up for that game (confirmed, not the organizer, not waitlisted, not dropped out) who have a
//    number saved. Nothing sends until the organizer taps send. The site itself never sends a text.
//  - Phone numbers are never in the Telegram message or in the link: the link holds a signed token for ONE game, good until that game ends.
//  - The words (real line breaks), from the approved mock:
//        Pickleball tonight @ 8pm! (Court 12)
//
//        Northville Pickleball Club
//        Directions:
//        https://maps.apple.com/?daddr=...
//
//        Still owe $14? Pay here: pickleball.juncaj.net
//    "(Court 12)" only when a court number is set; the last line only while somebody signed up still owes.
// One builder (gameDayTextBody) makes the words, one (smsGroupHref) makes the Messages link, so the page and the tests ask the same code.
import { formatPrice } from './money';
import { normalizePhone } from './messages';
import { dayWordR2, shortTime } from './textsR2';
import { COURT_ADDRESS } from './zip9';

export const GAME_DAY_TEXT = { task: 'game_day_text_on', env: 'GAME_DAY_TEXT', name: 'Game day text' } as const;

/** The Telegram's claim row in task_log (kind 'sent' / 'failed'), once per game, like the other clock alerts. */
export const GAME_TEXT_TASK = 'game_text';

/** A wrangler.toml kill switch: allowed unless it says "off". Who gets it is Settings' call. */
export function gameDayTextAllowed(flag: string | undefined | null): boolean {
  return (flag ?? 'on').trim().toLowerCase() !== 'off';
}

const MIN_MS = 60_000;
/** The reminder is due this long before the start ("about an hour before the game")... */
export const REMINDER_LEAD_MS = 60 * MIN_MS;
/** ...and a tick that missed it still sends it until this long before the start (never right at the start, never after). */
export const REMINDER_LATEST_MS = 15 * MIN_MS;

/** Is the reminder due now? Inside the window from 60 down to 15 minutes before the start. */
export function reminderDue(startsAtMs: number, nowMs: number): boolean {
  const left = startsAtMs - nowMs;
  return left <= REMINDER_LEAD_MS && left >= REMINDER_LATEST_MS;
}

/** The direct Apple Maps link for the court (no redirect, no /map page): the same address the Directions button on the game day card uses. */
export function mapsDirectLink(address: string = COURT_ADDRESS): string {
  return `https://maps.apple.com/?daddr=${encodeURIComponent(address).replace(/%20/g, '+').replace(/%2C/g, ',')}`;
}

export interface GameDayTextInput {
  startsAt: string;
  tz: string;
  nowMs: number;
  /** The game's court number (1 to 16), or null: no "(Court N)". */
  court: number | null;
  /** The venue's name (Settings > Venue name, else the default club name). */
  clubName: string;
  /** The court's address (the one the Directions button uses). */
  address?: string;
  /** What each player owes for this game as the money card shows it, when somebody signed up still owes; null: nobody does (no pay line). */
  oweCents: number | null;
  /** The plain site address, like "pickleball.juncaj.net". */
  siteName: string;
}

/** The text, with real line breaks. */
export function gameDayTextBody(i: GameDayTextInput): string {
  const court = i.court !== null && Number.isInteger(i.court) ? ` (Court ${i.court})` : '';
  const lines = [
    `Pickleball ${dayWordR2(i.startsAt, i.tz, i.nowMs)} @ ${shortTime(i.startsAt, i.tz)}!${court}`,
    '',
    i.clubName,
    'Directions:',
    mapsDirectLink(i.address),
  ];
  if (i.oweCents !== null && i.oweCents > 0) lines.push('', `Still owe ${formatPrice(i.oweCents)}? Pay here: ${i.siteName}`);
  return lines.join('\n');
}

/** The numbers Messages should open with: normalized (+1 and ten digits), no blanks, no repeats, in order. */
export function recipientNumbers(phones: readonly (string | null | undefined)[]): string[] {
  const out: string[] = [];
  for (const p of phones) {
    const n = p ? normalizePhone(p) : '';
    // Only a real number goes to Messages: a plus and 10 to 15 digits. A short or odd entry ("555-1234", a trailing extension) is skipped,
    // never texted as a wrong number.
    if (/^\+\d{10,15}$/.test(n) && !out.includes(n)) out.push(n);
  }
  return out;
}

/** encodeURIComponent, plus the five marks it leaves alone, so every reserved or odd character in the words is spelled %XX. */
export function encodeBody(body: string): string {
  return encodeURIComponent(body).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/**
 * The Messages link for a group text: `sms:+1N1,+1N2&body=...` on an iPhone or iPad (comma between numbers, & before body, the way the
 * site's one-person link already writes it), `sms:+1N1,+1N2?body=...` elsewhere. Opening it only fills in the composer.
 */
export function smsGroupHref(numbers: readonly string[], body: string, ios: boolean): string {
  return `sms:${numbers.join(',')}${ios ? '&' : '?'}body=${encodeBody(body)}`;
}
