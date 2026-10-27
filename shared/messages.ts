import { formatPrice } from './money';
import { formatDateTime, formatMonthDay, formatShortDate, formatTimeRange, formatWeekday } from './time';

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

/**
 * The group-chat poll: "Pickleball: Tue, Nov 3, 8:00 to 10:00 PM at
 * Northville Pickleball Club. $14 each. In or out?" Uses the per-player
 * price only, never the court cost.
 */
export function pollMessage(s: SessionLike, tz: string, venue: string, priceCents: number): string {
  return `Pickleball: ${formatShortDate(s.startsAt, tz)}, ${formatTimeRange(s.startsAt, s.endsAt, tz)} at ${venue}. ${formatPrice(priceCents)} each. In or out?`;
}

/** Poll while the organizer is on the venue's court waitlist. */
export function courtWaitlistPollMessage(s: SessionLike, tz: string, link: string): string {
  return `Pickleball ${formatShortDate(s.startsAt, tz)}, ${formatTimeRange(s.startsAt, s.endsAt, tz)}. I'm on the court waitlist. Want to be ready if it opens? Tap here: ${link}`;
}

/** The day-before group text, worded for how many are in. */
export function dayBeforeMessage(s: SessionLike, tz: string, confirmed: number, link: string): string {
  const head = `Pickleball tomorrow, ${formatShortDate(s.startsAt, tz)}, ${formatTimeRange(s.startsAt, s.endsAt, tz)}.`;
  if (confirmed === 4 || confirmed === 6) return `${head} We're set with ${confirmed} in. See you there.`;
  if (confirmed === 5) return `${head} We have 5, and we need either one more or one fewer. Sign up or drop here: ${link}`;
  const need = confirmed < 4 ? 4 - confirmed : 6 - confirmed;
  return `${head} We have ${confirmed} in and need ${need} more to fill. Sign up here: ${link}`;
}

/** The last-call group text, the day of. */
export function lastCallMessage(s: SessionLike, tz: string, confirmed: number): string {
  return `Last call for pickleball tonight, ${formatTimeRange(s.startsAt, s.endsAt, tz)}. We have ${confirmed} in. If you can't make it, tell me now.`;
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

/** Digits and a leading + only, for sms: links. */
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
export function smsHref(phone: string | null, body: string, isIOS: boolean): string {
  const to = phone ? normalizePhone(phone) : '';
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
