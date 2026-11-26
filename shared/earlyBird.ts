// Zip 94 (🎾94.early bird): pay early, pay less. ONE place for the rule; the server's taps, the player's card, the organizer's money and the
// gear sheet all read it. Its own file on purpose: shared/tournament.ts is in the player download (tests/zip48-split.test.ts's size budget).
//
// The rule (Alex):
//  - A tournament can have an EARLY PRICE (tournaments.early_cents) and an EARLY DEADLINE (tournaments.early_until, an exact moment), before
//    Pay by. The regular price is the tournament's ticket price (ticket_cents). Empty columns: no early bird, everything exactly as before.
//  - The switch "Early bird pricing" (Settings > Feature switches, EARLY_BIRD) must be on for everyone, or no tournament has an early price.
//    Off: the price is ticket_cents, exactly as before (a ticket already sold at the early price keeps it: each ticket keeps its own price).
//  - A ticket's price is set by the player's own tap (Lock in, which uses their credit at once, Hold my spot, I paid): the price that applies
//    at that moment. Once money is on the ticket (credit used, cash confirmed or an I paid waiting) its price never changes. A ticket with
//    nothing on it moves to the price that applies now at the next tap, with one grace: a ticket priced early still takes an I paid at the
//    early price for 30 minutes after the deadline (a Venmo payment already in progress when the deadline passed; Alex, Nov 26).
//  - Never more than the price shown at the tap: the server checks the amount the screen showed and answers "Look again" if it changed.
//  - The organizer still plays free ($0).
import { formatPrice } from './money';

/** The Settings row's task, the private link (organizer phones only: it shows the gear sheet's two rows) and the kill switch. */
export const EARLY_BIRD = {
  task: 'early_bird_on',
  header: 'X-Early-Bird',
  link: 'earlybird',
  env: 'EARLY_BIRD',
  name: 'Early bird pricing',
} as const;

/** The kill switch: allowed unless it says "off" (Zip 45: no new Cloudflare variable; a missing line means allowed). */
export const earlyBirdAllowed = (flag: string | undefined | null): boolean => (flag ?? 'on').trim().toLowerCase() !== 'off';

/** An early-priced ticket still takes an I paid at its early price this long after the deadline (a payment in progress). */
export const EARLY_GRACE_MS = 30 * 60_000;

/** What a tournament row holds for the rule. */
export interface EarlyRow {
  ticket_cents: number;
  early_cents?: number | null;
  early_until?: string | null;
  pay_by?: string | null;
}

/** The early bird a tournament really has: both set, the early price below the regular one, a real moment. Null: none. */
export function earlyOf(t: EarlyRow): { cents: number; untilMs: number; untilIso: string } | null {
  const cents = t.early_cents;
  const iso = t.early_until;
  if (cents === null || cents === undefined || !iso) return null;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms) || !(cents >= 0) || cents >= t.ticket_cents) return null;
  // Never past Pay by (the gear sheet refuses it; a Pay by moved earlier later on ends the early price with it).
  const pay = t.pay_by ? Date.parse(t.pay_by) : NaN;
  const until = Number.isFinite(pay) ? Math.min(ms, pay) : ms;
  return { cents, untilMs: until, untilIso: new Date(until).toISOString() };
}

/** The early bird in force for this tournament with the switch as it is (null: none; the switch off is none). */
export const earlyLive = (t: EarlyRow, on: boolean) => (on ? earlyOf(t) : null);

/** The price that applies right now for a new lock in (not the organizer's $0). */
export function priceNow(t: EarlyRow, on: boolean, nowMs: number): number {
  const e = earlyLive(t, on);
  return e && nowMs < e.untilMs ? e.cents : t.ticket_cents;
}

/** A ticket's money, as stored. */
export interface EarlyTicket {
  price_cents: number;
  credit_cents: number;
  paid_cents: number;
  claim_cents: number;
}

/** Money is on the ticket (credit used, cash confirmed, an I paid waiting or an owed mark): its price is fixed for good. */
export const ticketHasMoney = (k: EarlyTicket): boolean => k.credit_cents + k.paid_cents + k.claim_cents > 0;

/**
 * THE price of one player's ticket at this moment: the organizer $0; a ticket with money on it its own price; otherwise the price that applies
 * now, except that a ticket priced early keeps it for the 30 minute grace after the deadline.
 */
export function ticketPrice(t: EarlyRow, own: EarlyTicket | null, organizer: boolean, on: boolean, nowMs: number): number {
  if (organizer) return 0;
  if (own && own.price_cents === 0) return 0;
  if (own && ticketHasMoney(own)) return own.price_cents;
  const now = priceNow(t, on, nowMs);
  if (own && own.price_cents !== now) {
    const e = earlyLive(t, on);
    if (e && own.price_cents === e.cents && nowMs < e.untilMs + EARLY_GRACE_MS) return own.price_cents;
  }
  return now;
}

/**
 * The organizer's money with mixed prices: what the tickets locked in really cost, beyond "everyone pays the price that applies now". The money
 * line is (expected - 1) x the price now, plus this: the sum over the paying tickets locked in of (their price - the price now). With every
 * ticket at the price now it is exactly 0 (the money line exactly as before). A tournament with no early bird set is always 0.
 */
export function lockedAdjustCents(t: EarlyRow, locked: readonly { price_cents: number }[], nowPrice: number): number {
  if (t.early_cents === null || t.early_cents === undefined) return 0;
  return locked.filter((k) => k.price_cents > 0).reduce((s, k) => s + (k.price_cents - nowPrice), 0);
}

// ---------------------------------------------------------------------------------------------------------------------
// Words (the player's card, picture 1, C2)
// ---------------------------------------------------------------------------------------------------------------------

const DAY = 86_400_000;
const HOUR = 3_600_000;
const MINUTE = 60_000;

/**
 * The small line under the buttons before the deadline: "Save $2 for 2 more days" (whole days left, gray); on the last day (under 24 hours) it
 * counts hours and turns gold: "Save $2 for 9 more hours"; under an hour: "Save $2 for 40 more minutes". Null once the deadline has passed.
 */
export function saveLine(saveCents: number, untilMs: number, nowMs: number): { text: string; gold: boolean } | null {
  const left = untilMs - nowMs;
  if (left <= 0 || saveCents <= 0) return null;
  const save = `Save ${formatPrice(saveCents)}`;
  if (left >= DAY) {
    const d = Math.floor(left / DAY);
    return { text: `${save} for ${d} more ${d === 1 ? 'day' : 'days'}`, gold: false };
  }
  if (left >= HOUR) {
    const h = Math.floor(left / HOUR);
    return { text: `${save} for ${h} more ${h === 1 ? 'hour' : 'hours'}`, gold: true };
  }
  const m = Math.max(1, Math.ceil(left / MINUTE));
  return { text: `${save} for ${m} more ${m === 1 ? 'minute' : 'minutes'}`, gold: true };
}

/** The moment the line next changes (the card re-draws then, with no extra call): the next whole day, hour or minute boundary. */
export function saveLineNextMs(untilMs: number, nowMs: number): number {
  const left = untilMs - nowMs;
  if (left <= 0) return Infinity;
  const step = left >= DAY ? DAY : left >= HOUR ? HOUR : MINUTE;
  const rest = left % step;
  return nowMs + (rest === 0 ? step : rest) + 1;
}

/** "7:00 PM" to "7 PM" (the card's short clock; shared/tournamentCard.ts has the organizer's copy). */
const clockShort = (s: string): string => s.replace(/:00(?=\s?[AP]M)/g, '');

/**
 * The player's card while they can lock in (picture 1, C2), for a tournament with an early bird: before the deadline the button strikes the
 * regular price ("Lock in · ~~$20~~ $18") and the line under the buttons counts down ("Save $2 for 2 more days", gold on the last day); after
 * it, "Lock in · $20" and "Pay by Mon 7 PM". The strike only on a ticket with nothing on it yet (credit used part: the button shows what is
 * left, plain). Null: no early bird (the card exactly as before).
 */
export function earlyCardOf(
  k: { priceCents: number; payBy: string | null; early?: { regularCents: number; earlyCents: number; until: string }; mine: { creditCents: number; paidCents: number; claimCents: number } | null },
  payByWords: (iso: string) => string,
  nowMs: number,
): { strikeCents: number | null; line: { text: string; gold: boolean } | null } | null {
  const e = k.early;
  if (!e) return null;
  const empty = !k.mine || k.mine.creditCents + k.mine.paidCents + k.mine.claimCents === 0;
  if (empty && k.priceCents === e.earlyCents && e.earlyCents < e.regularCents) {
    return { strikeCents: e.regularCents, line: saveLine(e.regularCents - e.earlyCents, Date.parse(e.until), nowMs) };
  }
  return { strikeCents: null, line: k.payBy ? { text: `Pay by ${clockShort(payByWords(k.payBy))}`, gold: false } : null };
}
