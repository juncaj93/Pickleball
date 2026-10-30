import { formatPrice } from './money';
import { formatDateTime, localParts, formatMonthDay, formatShortDate, formatTime, formatTimeRange, formatWeekday } from './time';

// Short, prewritten texts. The site only drafts them; the organizer sends
// each one from their own phone.

interface SessionLike {
  startsAt: string;
  endsAt: string;
}

function when(s: SessionLike, tz: string) {
  return {
    day: formatWeekday(s.startsAt, tz),
    date: formatMonthDay(s.startsAt, tz),
    time: formatTimeRange(s.startsAt, s.endsAt, tz),
  };
}

export function confirmationMessage(name: string, s: SessionLike, tz: string, link: string): string {
  const w = when(s, tz);
  return `Hey ${name}! Are you still in for pickleball ${w.day}, ${w.date}, ${w.time}? Confirm or drop out here: ${link}`;
}

/** "Tue Nov 3": the short date the texts use. */
export function textDay(iso: string, tz: string): string {
  return formatShortDate(iso, tz).replace(',', '');
}

/** "pickleball.juncaj.net": the plain site address, for texts. */
export function siteAddress(link: string): string {
  return link.replace(/^https?:\/\//, '').replace(/[/?].*$/, '');
}

/**
 * The poll: "Pickleball Tue Nov 3, 8:00 to 10:00 PM. $14 each. In or out?
 * pickleball.juncaj.net" Uses the per-player price only, never the court cost.
 */
export function pollMessage(s: SessionLike, tz: string, priceCents: number, site: string): string {
  return `Pickleball ${textDay(s.startsAt, tz)}, ${formatTimeRange(s.startsAt, s.endsAt, tz)}. ${formatPrice(priceCents)} each. In or out? ${siteAddress(site)}`;
}

/** Poll while the organizer is on the venue's court waitlist. */
export function courtWaitlistPollMessage(s: SessionLike, tz: string, site: string): string {
  return `Pickleball ${textDay(s.startsAt, tz)}, ${formatTimeRange(s.startsAt, s.endsAt, tz)}. I'm on the court waitlist. Want in if it opens? ${siteAddress(site)}`;
}

/** The day-before group text, worded for how many are in. */
/** A link straight to one session on the player screen: the player link plus ?s=<session id>. */
export function sessionLink(playerLink: string, sessionId: string): string {
  const base = playerLink.replace(/\/$/, '');
  return `${base}${base.includes('?') ? '&' : base.match(/\/g\/[^/]+$/) ? '?' : '/?'}s=${sessionId}`;
}

export function replacementMessage(s: SessionLike, tz: string, link: string): string {
  const w = when(s, tz);
  return `A pickleball spot just opened for ${w.day}, ${w.date}, ${w.time}. First to claim it gets the spot: ${link}`;
}

export function bookingMessage(s: SessionLike, tz: string): string {
  const w = when(s, tz);
  return `Pickleball is planned for ${w.day}, ${w.date}, ${w.time}. I'm checking court bookings now.`;
}

export function deadlineAlertMessage(s: SessionLike, tz: string, deadlineIso: string): string {
  const w = when(s, tz);
  return `Reminder: ${w.day}, ${w.date} pickleball is not full. The court cancellation deadline is ${formatDateTime(deadlineIso, tz)}. Decide whether to keep trying to fill the spot or cancel the venue booking.`;
}

// ---------- The Text menu and payment reminders ----------
// {link} is always the plain site address (pickleball.juncaj.net). Every game
// time reads like "Tue Nov 3, 8:00 PM". The site only opens Messages with these
// words; it never sends anything.

/** "Tue Nov 3, 8:00 PM" */
export function textWhen(iso: string, tz: string): string {
  return `${textDay(iso, tz)}, ${formatTime(iso, tz)}`;
}

/**
 * How a text names the day of a game, by calendar days in the group's time
 * zone (never 24-hour math, so midnight and the November clock change are
 * safe): "tonight" or "today" for a game on this calendar day, "tomorrow" for
 * the next one, otherwise the date, like "Tue Nov 3". A game before 5:00 PM
 * is "today"; a game from 5:00 PM on is "tonight".
 */
export function dayWord(iso: string, tz: string, nowMs: number): string {
  const g = localParts(Date.parse(iso), tz);
  const n = localParts(nowMs, tz);
  const dayNum = (p: { year: number; month: number; day: number }) => Date.UTC(p.year, p.month - 1, p.day) / 86_400_000;
  const gap = dayNum(g) - dayNum(n);
  if (gap === 0) return g.hour < 17 ? 'today' : 'tonight';
  if (gap === 1) return 'tomorrow';
  return textDay(iso, tz);
}

/** "tomorrow, 8:00 PM", "tonight, 8:00 PM" or "Tue Nov 3, 8:00 PM". */
export function textWhenAt(iso: string, tz: string, nowMs: number): string {
  return `${dayWord(iso, tz, nowMs)}, ${formatTime(iso, tz)}`;
}

/** Share the game: for any upcoming game, to a group chat. */
export function shareMessage(s: SessionLike, tz: string, nowMs: number, link: string): string {
  return `Pickleball ${textWhenAt(s.startsAt, tz, nowMs)}. In or out here: ${link}`;
}

/** Fewer than 4 in. */
export function needPlayersMessage(s: SessionLike, tz: string, nowMs: number, need: number, link: string): string {
  return `Need ${need} more for pickleball ${textWhenAt(s.startsAt, tz, nowMs)}. In? ${link}`;
}


/** 4 or more signed up: everyone who is signed up can update here if they can't make it. */
export function checkInMessage(s: SessionLike, tz: string, nowMs: number, link: string): string {
  return `Pickleball ${textWhenAt(s.startsAt, tz, nowMs)}. Can't make it? Update here: ${link}`;
}


/** A waitlisted player moved into the 4 after a drop. */
export function promotedMessage(s: SessionLike, tz: string, nowMs: number, link: string): string {
  return `A spot opened and you're in for pickleball ${textWhenAt(s.startsAt, tz, nowMs)}. ${link}`;
}

/** One optional line from the organizer, ending with a period. */
function withReason(text: string, reason?: string | null): string {
  const r = (reason ?? '').replace(/\s+/g, ' ').trim();
  if (!r) return text;
  return `${text} ${/[.!?]$/.test(r) ? r : `${r}.`}`;
}

/**
 * "Pickleball Tue Nov 3 is canceled. If you paid, it's now your credit. You
 * can request a cash out on the site. pickleball.juncaj.net", with an optional
 * reason right after the first sentence.
 */
export function canceledMessage(s: SessionLike, tz: string, nowMs: number, link: string, reason?: string | null): string {
  return `${withReason(`Pickleball ${dayWord(s.startsAt, tz, nowMs)} is canceled.`, reason)} If you paid, it's now your credit. You can request a cash out on the site. ${link}`;
}

/**
 * After finalizing: "Pickleball Thu, Oct 29 is final: 6 played, $9 each. If
 * you paid $14, the extra $5 is now credit on your account. {link}". With no
 * credit back (4 played): "Pickleball Thu, Oct 29 is final: 4 played, $14 each. {link}".
 */
export function finalMessage(s: SessionLike, tz: string, played: number, priceCents: number, flatCents: number, link: string): string {
  const back = flatCents - priceCents;
  const extra = back > 0 ? ` If you paid ${formatPrice(flatCents)}, the extra ${formatPrice(back)} is now credit on your account.` : '';
  return `Pickleball ${formatShortDate(s.startsAt, tz)} is final: ${played} played, ${formatPrice(priceCents)} each.${extra} ${link}`;
}

/** "Pickleball Tue Nov 3 is moved to Thu Nov 5, 8:00 PM. pickleball.juncaj.net". `was` is the game's original time. */
export function movedMessage(s: SessionLike, was: string, tz: string, nowMs: number, link: string, reason?: string | null): string {
  return `${withReason(`Pickleball ${textDay(was, tz)} is moved to ${textWhenAt(s.startsAt, tz, nowMs)}.`, reason)} ${link}`;
}

/** One game: names it. Several games: just the total. */
export function paymentMessage(name: string, totalCents: number, games: SessionLike[], tz: string, link: string): string {
  const owe = formatPrice(totalCents);
  return games.length === 1
    ? `Hey ${name}, you owe ${owe} for pickleball ${textDay(games[0].startsAt, tz)}. Pay here: ${link}`
    : `Hey ${name}, you owe ${owe} for pickleball. Pay here: ${link}`;
}

/** One group text to everyone who has not paid. */
export function remindAllMessage(link: string): string {
  return `Hey, looks like you haven't paid for pickleball yet. Pay here: ${link}`;
}

export function normalizePhone(phone: string): string {
  const trimmed = phone.trim();
  const digits = trimmed.replace(/\D/g, '');
  if (!digits) return '';
  if (trimmed.startsWith('+')) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return digits;
}

/**
 * Build an sms: link. iPhones expect `&body=`, most Android phones expect
 * `?body=`. Opening the link only fills in the composer; nothing is sent.
 */
export function smsHref(phone: string | string[] | null, body: string, isIOS: boolean): string {
  const list = (Array.isArray(phone) ? phone : phone ? [phone] : []).map(normalizePhone).filter(Boolean);
  // Several people at once: iPhone opens a group message with "open?addresses=".
  if (list.length > 1) {
    return isIOS ? `sms://open?addresses=${list.join(',')}&body=${encodeURIComponent(body)}` : `sms:${list.join(',')}?body=${encodeURIComponent(body)}`;
  }
  const to = list[0] ?? '';
  const sep = isIOS ? '&' : '?';
  return `sms:${to}${sep}body=${encodeURIComponent(body)}`;
}

/** "(248) 555-1234" for US numbers; anything else is shown as typed. */
export function formatPhone(phone: string | null | undefined): string {
  if (!phone) return '';
  const digits = phone.replace(/\D/g, '');
  const ten = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  if (ten.length !== 10 || (phone.trim().startsWith('+') && !phone.trim().startsWith('+1'))) return phone.trim();
  return `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}`;
}
