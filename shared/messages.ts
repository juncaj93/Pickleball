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

export function paymentMessage(name: string, amountCents: number, s: SessionLike, tz: string, venmoUrl: string | null): string {
  const w = when(s, tz);
  const pay = venmoUrl ? `Please send it here: ${venmoUrl}` : 'Please send it when you can.';
  return `Hey ${name}! You owe ${formatPrice(amountCents)} for pickleball on ${w.day}, ${w.date}. ${pay}`;
}

export function promotionMessage(
  name: string,
  s: SessionLike,
  tz: string,
  reason: 'made_six' | 'spot_opened' | 'court_opened',
  oweCents?: number,
): string {
  const w = when(s, tz);
  const why = reason === 'made_six' ? 'We now have 6, an even number' : reason === 'court_opened' ? 'The court opened up' : 'A spot opened up';
  const owe = oweCents === undefined ? '' : ` You owe ${formatPrice(oweCents)}${reason === 'made_six' ? ' (6-person discount)' : ''}.`;
  return `Good news, ${name}! ${why}, so you're in for pickleball ${w.day}, ${w.date}, ${w.time}.${owe}`;
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

/** "Share the game", worded for where the court stands. */
export function shareGameMessage(s: SessionLike, tz: string, court: 'booked' | 'waitlist' | 'open', link: string): string {
  const day = formatShortDate(s.startsAt, tz);
  const at = formatTime(s.startsAt, tz);
  if (court === 'booked') return `We booked a court for ${day} at ${at}. Tap here to reserve your spot: ${link}`;
  if (court === 'waitlist') return `I'm on the court waitlist for ${day} at ${at}. Tap here to join the standby list: ${link}`;
  return `Thinking of playing ${day} at ${at}. Tap here to say if you're in: ${link}`;
}

/** The day-before text to the players who are in: a heads-up and how to back out. */
export function dayBeforePlayersMessage(s: SessionLike, tz: string, site: string): string {
  return `Pickleball tomorrow, ${textDay(s.startsAt, tz)}, ${formatTimeRange(s.startsAt, s.endsAt, tz)}. You're in! If you need to back out, text me ASAP. ${siteAddress(site)}`;
}

/** The day-before group text when we're short of 4 or 6 ("need more players"). */
export function dayBeforeMessage(s: SessionLike, tz: string, confirmed: number, site: string): string {
  const head = `Pickleball tomorrow, ${textDay(s.startsAt, tz)}, ${formatTimeRange(s.startsAt, s.endsAt, tz)}.`;
  if (confirmed === 4 || confirmed === 6) return `${head} We're set with ${confirmed}. See you there.`;
  if (confirmed === 5) return `${head} We have 5 and need 1 more or 1 fewer. ${siteAddress(site)}`;
  const need = confirmed < 4 ? 4 - confirmed : 6 - confirmed;
  return `${head} We have ${confirmed} in and need ${need} more. Sign up: ${siteAddress(site)}`;
}

/** The last-call text to the players who are in, the day of. */
export function lastCallMessage(s: SessionLike, tz: string, confirmed: number): string {
  // "tonight" for the usual 8:00 PM game; "today" for one before 5:00 PM.
  const when = localParts(Date.parse(s.startsAt), tz).hour < 17 ? 'today' : 'tonight';
  return `Last call: pickleball ${when}, ${formatTimeRange(s.startsAt, s.endsAt, tz)}. We have ${confirmed} in. If you can't make it, text me ASAP.`;
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

/** "A spot opened for pickleball Tue Nov 3, 8:00 to 10:00 PM. First to grab it gets it: pickleball.juncaj.net" */
export function spotOpenMessage(s: SessionLike, tz: string, site: string): string {
  return `A spot opened for pickleball ${textDay(s.startsAt, tz)}, ${formatTimeRange(s.startsAt, s.endsAt, tz)}. First to grab it gets it: ${siteAddress(site)}`;
}

/** One optional line from the organizer, ending with a period. */
function withReason(text: string, reason?: string | null): string {
  const r = (reason ?? '').replace(/\s+/g, ' ').trim();
  if (!r) return text;
  return `${text} ${/[.!?]$/.test(r) ? r : `${r}.`}`;
}

/** "Pickleball Tue, Nov 3 is canceled." plus an optional reason. */
export function canceledMessage(s: SessionLike, tz: string, reason?: string | null): string {
  return withReason(`Pickleball ${formatShortDate(s.startsAt, tz)} is canceled.`, reason);
}

/** "Pickleball moved to Thu, Nov 5, 8:00 to 10:00 PM." plus an optional reason. */
export function movedMessage(s: SessionLike, tz: string, reason?: string | null): string {
  return withReason(`Pickleball moved to ${formatShortDate(s.startsAt, tz)}, ${formatTimeRange(s.startsAt, s.endsAt, tz)}.`, reason);
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
