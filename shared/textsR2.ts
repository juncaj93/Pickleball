// "Texts and Telegram alerts, round 2" (TEXTS_R2). The new wording for every prefilled text (the site only opens Messages with
// the words ready; it never sends anything) and for the Telegram alerts, plus the switch rules.
//
// Wording rules (Alex, Nov 3): say "tomorrow", "today" or "tonight" (an evening game) when it is that day, never the weekday
// name; "yesterday" for a game that was yesterday; otherwise a date like "Tue Nov 17". Times read "8pm" and "7:30pm". Every text
// has line breaks, and the site address (pickleball.juncaj.net) sits alone on its own line after a blank line. No dashes.
//
// Nothing here changes a price, a rule or a saved record. With the switch off none of it is used: the old wording stays in
// shared/messages.ts, shared/alerts.ts and shared/tasks.ts exactly as it was.
import { formatPrice } from './money';
import { textDay } from './messages';
import { COURT_PUBLIC_BOOKING_URL, COURTS_PHONE } from './settings';
import { localParts } from './time';

/** The phone-only test switch: the organizer screen sends this header when the phone opened /admin?textsr2=on. */
export const TEXTS_R2_HEADER = 'X-Texts-R2';

/** The TEXTS_R2 kill switch (a wrangler.toml var): allowed unless it says "off". Who gets it is Settings' call. */
export function textsR2Allowed(flag: string | undefined | null): boolean {
  return (flag ?? 'on').trim().toLowerCase() !== 'off';
}

// ---------- Day and time words ----------

const dayNumber = (p: { year: number; month: number; day: number }) => Date.UTC(p.year, p.month - 1, p.day) / 86_400_000;

/** Whole calendar days from now to the game's date in the group's time zone (1 = tomorrow, -1 = yesterday). */
export function dayGap(iso: string, tz: string, nowMs: number): number {
  return dayNumber(localParts(Date.parse(iso), tz)) - dayNumber(localParts(nowMs, tz));
}

/**
 * "tonight" (an evening game, from 5:00 PM) or "today" on game day, "tomorrow", "yesterday" (or "last night" when asked, for
 * an evening game), otherwise the date like "Tue Nov 17".
 */
export function dayWordR2(iso: string, tz: string, nowMs: number, opts: { lastNight?: boolean } = {}): string {
  const gap = dayGap(iso, tz, nowMs);
  const hour = localParts(Date.parse(iso), tz).hour;
  if (gap === 0) return hour < 17 ? 'today' : 'tonight';
  if (gap === 1) return 'tomorrow';
  if (gap === -1) return opts.lastNight && hour >= 17 ? 'last night' : 'yesterday';
  return textDay(iso, tz);
}

/** The same word starting a Telegram alert: "Tomorrow", "Tonight", "Today", "Yesterday" or "Tue Nov 17". */
export function dayLabelR2(iso: string, tz: string, nowMs: number): string {
  const w = dayWordR2(iso, tz, nowMs);
  return w.charAt(0).toUpperCase() + w.slice(1);
}

/** "8pm", "7:30pm" (no minutes on the hour, no space, lowercase). */
export function shortTime(iso: string, tz: string): string {
  const p = localParts(Date.parse(iso), tz);
  const h = p.hour % 12 === 0 ? 12 : p.hour % 12;
  return `${h}${p.minute ? `:${String(p.minute).padStart(2, '0')}` : ''}${p.hour < 12 ? 'am' : 'pm'}`;
}

/** "tomorrow @ 8pm" */
export function whenR2(iso: string, tz: string, nowMs: number): string {
  return `${dayWordR2(iso, tz, nowMs)} @ ${shortTime(iso, tz)}`;
}

interface SessionLike {
  startsAt: string;
  endsAt?: string;
}

/** Lines joined with line breaks; the site address goes last, alone, after a blank line. */
function lines(body: string[], link?: string): string {
  return link ? `${body.join('\n')}\n\n${link}` : body.join('\n');
}

/** One optional line from the organizer, ending with a period, added right after a sentence. */
function withReason(text: string, reason?: string | null): string {
  const r = (reason ?? '').replace(/\s+/g, ' ').trim();
  if (!r) return text;
  return `${text} ${/[.!?]$/.test(r) ? r : `${r}.`}`;
}

// ---------- Prefilled texts (open Messages, you press send) ----------

/**
 * "tonight" for a game tomorrow (or today): back out or join before tonight's cut-off. "early" for a game further out, where
 * "tonight" would be wrong (Alex, Nov 4).
 */
function byWhen(iso: string, tz: string, nowMs: number): 'tonight' | 'early' {
  return dayGap(iso, tz, nowMs) <= 1 ? 'tonight' : 'early';
}

/** 1. CHECK-IN, 4 or more in. Opens with no recipients. */
export function checkInTextR2(s: SessionLike, tz: string, nowMs: number, signedUp: number, link: string): string {
  return lines(
    [`Pickleball ${whenR2(s.startsAt, tz, nowMs)}!`, `${signedUp} in so far. Want in? Join now.`, `Need to back out? Do it ${byWhen(s.startsAt, tz, nowMs)} to avoid cancel fees.`],
    link,
  );
}

/** 2. NEED PLAYERS, under 4 in (also FIND A SUB). Opens with no recipients. */
export function needPlayersTextR2(s: SessionLike, tz: string, nowMs: number, signedUp: number, need: number, link: string): string {
  return lines(
    [`Pickleball ${whenR2(s.startsAt, tz, nowMs)}!`, `${signedUp} in, need ${need} more.`, `Want in? Join ${byWhen(s.startsAt, tz, nowMs)}, otherwise we'll have to cancel.`],
    link,
  );
}

/** 3. SHARE THE GAME. */
export function shareTextR2(s: SessionLike, tz: string, nowMs: number, link: string): string {
  return lines([`Pickleball ${whenR2(s.startsAt, tz, nowMs)}!`, 'In or out here:'], link);
}

/** 4. FINAL PRICE: the same words, "Thu Oct 29" (no comma), or "last night" / "yesterday". */
export function finalTextR2(s: SessionLike, tz: string, nowMs: number, played: number, priceCents: number, flatCents: number, link: string): string {
  const back = flatCents - priceCents;
  const first = `Pickleball ${dayWordR2(s.startsAt, tz, nowMs, { lastNight: true })} is final: ${played} played, ${formatPrice(priceCents)} each.`;
  return lines(back > 0 ? [first, `If you paid ${formatPrice(flatCents)}, the extra ${formatPrice(back)} is now credit on your account.`] : [first], link);
}

/** 5. SPOT OPENED (one player). */
export function promotedTextR2(s: SessionLike, tz: string, nowMs: number, link: string): string {
  return lines([`A spot opened and you're in for pickleball ${whenR2(s.startsAt, tz, nowMs)}!`], link);
}

/** 6a. CANCELED, the credit version (the venue waived or credited it). Works for any game: tomorrow, today, tonight. */
export function canceledCreditTextR2(s: SessionLike, tz: string, nowMs: number, link: string, reason?: string | null): string {
  return lines([withReason(`Pickleball ${dayWordR2(s.startsAt, tz, nowMs)} is canceled.`, reason), "If you paid, it's now your credit. You can request a cash out on the site."], link);
}

/** "today's", "tomorrow's" or "the Tue Nov 17" for the fee-kept text ("today's game" is how it always read). */
function gameOf(iso: string, tz: string, nowMs: number): string {
  const gap = dayGap(iso, tz, nowMs);
  if (gap === 0) return "today's game";
  if (gap === 1) return "tomorrow's game";
  return `the ${textDay(iso, tz)} game`;
}

/** 6b. CANCELED, the fee-kept version (the venue did not waive it): the live words with line breaks and the reason. */
export function canceledFeeKeptTextR2(s: SessionLike, tz: string, nowMs: number, priceCents: number, link: string, reason?: string | null): string {
  return lines(
    [
      withReason(`Heads up: ${gameOf(s.startsAt, tz, nowMs)} is canceled, and since it's inside 12 hours the venue is charging us for the court.`, reason),
      `If you were signed up, your ${formatPrice(priceCents)} share still applies (if you already paid, you're all set).`,
      'Sorry about that! You can pay on the site:',
    ],
    link,
  );
}

/**
 * 7. MOVED: the live words with line breaks and the reason. `was` is the game's original time. Both days follow the day-word
 * rule ("Pickleball tomorrow is moved to Thu Nov 5 @ 7:30pm."); moved to a new time on the same day it reads
 * "Pickleball tonight is moved to 7:30pm."
 */
export function movedTextR2(s: SessionLike, was: string, tz: string, nowMs: number, link: string, reason?: string | null): string {
  const sameDay = textDay(was, tz) === textDay(s.startsAt, tz);
  const to = sameDay ? shortTime(s.startsAt, tz) : whenR2(s.startsAt, tz, nowMs);
  return lines([withReason(`Pickleball ${dayWordR2(was, tz, nowMs)} is moved to ${to}.`, reason)], link);
}

/** 8. PAYMENT REMINDER, one person. One game names the day; several games give just the total. */
export function paymentTextR2(name: string, totalCents: number, games: SessionLike[], tz: string, nowMs: number, link: string): string {
  const owe = formatPrice(totalCents);
  const first = games.length === 1 ? `Hey ${name}, you owe ${owe} for pickleball ${dayWordR2(games[0].startsAt, tz, nowMs)}.` : `Hey ${name}, you owe ${owe} for pickleball.`;
  return lines([first, 'Pay here:'], link);
}

/** 9. REMIND ALL UNPAID. */
export function remindAllTextR2(link: string): string {
  return lines(["Hey, looks like you haven't paid for pickleball yet.", 'Pay here:'], link);
}

/**
 * "Text all" on the Money page's Remind sheet (Money page rework): one text for the whole group chat, opened with no recipients filled in.
 * "today's", "tonight's", "tomorrow's", "yesterday's" or the date ("Tue Nov 17's"), the same day words as every other text.
 */
export function remindGameGroupText(startsAt: string, tz: string, nowMs: number, priceCents: number, link: string): string {
  return lines([`Hey everyone, quick reminder for ${dayWordR2(startsAt, tz, nowMs)}'s pickleball.`, `If you haven't paid your ${formatPrice(priceCents)} yet, please do it here:`], link);
}

/** 10. STILL IN? (a moved game; "confirmed", because an unbooked game only had an approximate time). */
export function stillInTextR2(startsAt: string, tz: string, nowMs: number, link: string): string {
  return lines([`Pickleball ${dayWordR2(startsAt, tz, nowMs)} is confirmed @ ${shortTime(startsAt, tz)}!`, 'If you can no longer make it, let us know here:'], link);
}

/** 11A. TEXT THE PLAYERS, "Court canceled": the live words, line breaks only. */
export function courtCanceledTextR2(bookingUrl: string = COURT_PUBLIC_BOOKING_URL, phone: string = COURTS_PHONE, game: string = "today's game"): string {
  return lines([
    `Hey guys, sorry, I have to back out of ${game}.`,
    "I canceled the court, so you can still book the same slot as non-members. It's only $2 more per person.",
    `Book online: ${bookingUrl}`,
    `or call the courts at ${phone}.`,
    'Sorry again, hope you can still get it in!',
  ]);
}

/** 11B. TEXT THE PLAYERS, "Court still booked (backup)": the live words, line breaks only. */
export function courtStillBookedTextR2(phone: string = COURTS_PHONE, game: string = "today's game"): string {
  return lines([
    `Hey guys, sorry, I have to back out of ${game}.`,
    'The court is still booked under my name, so you can still play.',
    'They might charge you $2 more each since the non-member rate is $16. They may be cool though and let you play under my membership pricing.',
    `Questions? Call the courts at ${phone}.`,
    'Sorry again!',
  ]);
}

// ---------- Telegram: dropped / reached 4 ----------

/**
 * How a drop or "it's on" alert names the game: "tomorrow's 8:00 PM game", "tonight's game", "today's game", or for a
 * game further away "the Thu Nov 5, 8:00 PM game". `time` is the usual "8:00 PM".
 */
export function alertGame(iso: string, tz: string, nowMs: number, time: string): string {
  const w = dayWordR2(iso, tz, nowMs);
  if (w === 'tomorrow') return `tomorrow's ${time} game`;
  if (w === 'tonight' || w === 'today') return `${w}'s game`;
  if (w === 'yesterday') return `yesterday's ${time} game`;
  return `the ${w}, ${time} game`;
}
