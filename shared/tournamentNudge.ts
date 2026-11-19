// Zip 66 (🎾66.admincard): the organizer's "Not signed up" row on the tournament card, and the words it copies. Organizer only: no player ever
// gets this list. Before the date is picked it lists the active players who played at least one game in the last 3 months and are not on the
// list. Once the date is picked (tickets open) it lists the players on the list who did NOT pick that date and have not answered the in-or-out
// alert yet (they are asked "Can you make it?" on their own Home), until tickets close for them.
import { localParts, zonedTimeToUtc } from './time';
import { dayLong, type PlayerTournamentView } from './tournament';

/** How far back "played lately" looks: 3 calendar months. */
export const RECENT_MONTHS = 3;

/** The organizer's "Not signed up" list (AdminTournamentView.notSignedUp). */
export interface NotSignedUpView {
  /** 'recent': before the date is picked (active, played lately, not on the list). 'missed': after it (on the list, did not pick that date). */
  mode: 'recent' | 'missed';
  players: { playerId: string; name: string }[];
  /** When sign-ups close, for the copied text (ISO). Null: nothing stores it (before the date is picked); the screen uses signupCloseDefault. */
  closeAt: string | null;
}

/** The moment 3 calendar months before now (ISO, UTC), the start of "played lately". */
export function recentFrom(nowMs: number, months = RECENT_MONTHS): string {
  const d = new Date(nowMs);
  const back = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - months, 1, d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds()));
  // The same day of the month, or the month's last day when it is shorter (Nov 30 back 3 months is Aug 30; May 31 back 3 is Feb 28).
  const last = new Date(Date.UTC(back.getUTCFullYear(), back.getUTCMonth() + 1, 0)).getUTCDate();
  back.setUTCDate(Math.min(d.getUTCDate(), last));
  return back.toISOString();
}

/**
 * Before the date is picked nothing stores when sign-ups close. The copied text says the next Tuesday at 8:00 PM Eastern (a game night, when
 * the organizer usually finalizes). On a Tuesday before 8:00 PM, that evening.
 */
export function signupCloseDefault(nowMs: number, tz: string): string {
  const p = localParts(nowMs, tz);
  const weekday = new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay();
  for (let add = 0; add <= 7; add++) {
    if ((weekday + add) % 7 !== 2) continue;
    const d = new Date(Date.UTC(p.year, p.month - 1, p.day + add));
    const ms = zonedTimeToUtc(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), 20, 0, tz);
    if (ms > nowMs) return new Date(ms).toISOString();
  }
  const d = new Date(Date.UTC(p.year, p.month - 1, p.day + 7));
  return new Date(zonedTimeToUtc(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), 20, 0, tz)).toISOString();
}

/** "8 PM", "7:30 PM" (Eastern, 12-hour clock, no ":00"). */
export function shortClock(iso: string, tz: string): string {
  const p = localParts(Date.parse(iso), tz);
  const h = p.hour % 12 === 0 ? 12 : p.hour % 12;
  return `${h}${p.minute ? `:${String(p.minute).padStart(2, '0')}` : ''} ${p.hour < 12 ? 'AM' : 'PM'}`;
}

/** "Tue Nov 24" (Eastern) for a moment. */
export function shortDay(iso: string, tz: string): string {
  const p = localParts(Date.parse(iso), tz);
  return dayLong(`${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`).replace(',', '');
}

/**
 * The copied reminder: "Vic, Reese: sign-ups for The Cold Open close Tue Nov 24 at 8 PM. pickleball.juncaj.net". Never "still need you".
 * `site`: the plain site address (shared/messages.ts siteAddress).
 */
export function signupReminderText(names: readonly string[], tournament: string, closeIso: string, tz: string, site: string): string {
  return `${names.join(', ')}: sign-ups for ${tournament} close ${shortDay(closeIso, tz)} at ${shortClock(closeIso, tz)}. ${site}`;
}

/**
 * Zip 56: where this player stands with tickets, from the server's answer only.
 *   lock     a spot is open and their ticket is not paid: Lock my spot (state 3)
 *   full     every spot is taken and they are not in line: Join waitlist (state 4)
 *   in       locked in (state 5)
 *   line     on the waitlist (unpaid: Hold my spot; paid: their spot is held)
 *   (Zip 63, the trust rule: an I paid counts as locked in on the player's screens, so there is no "waiting" state for players any more)
 *   closed   ticket sales are over (the night has started) and they are not locked in
 */
export type TicketState = 'lock' | 'full' | 'in' | 'line' | 'closed';

export function ticketStateOf(t: PlayerTournamentView): TicketState | null {
  const k = t.tickets;
  if (t.status !== 'tickets' || !k || !t.me) return null;
  const mine = k.mine;
  if (mine?.place === 'spot') return 'in';
  // Zip 63 (Alex): we trust people that they paid. An I paid for the whole ticket (not a standby hold) is "locked in" at once, also after the
  // night starts (the organizer confirms or undoes it).
  if (mine && mine.place !== 'line' && mine.claimCents > 0 && mine.owedCents === 0) return 'in';
  // A waitlist player keeps their place on the card even when sales are closed (no Hold button then: it waits for a freed spot).
  if (k.closed && mine?.place !== 'line') return 'closed';
  // Alex: the spots follow the players locked in; every spot is taken only at 12, then the waitlist starts.
  const open = !k.full;
  const paid = !!mine && mine.creditCents + mine.paidCents >= k.priceCents;
  if (mine?.place === 'line') return open && !paid && mine.claimCents === 0 ? 'lock' : 'line';
  return open ? 'lock' : 'full';
}

/**
 * Zip 66: on the list, the date is picked, and they did NOT pick that date: the in-or-out alert asks "Can you make it?" until they answer (I'm
 * in adds the date and locks a spot; Can't make it drops them) or tickets close for them. Only while a spot can be locked (the "lock" state).
 * From their own sign-up only (their own dates); nobody else's data.
 */
export function missedDate(t: PlayerTournamentView): boolean {
  return t.status === 'tickets' && !!t.finalDate && !!t.me && !t.me.dates.includes(t.finalDate) && !!t.tickets && !t.tickets.closed && ticketStateOf(t) === 'lock';
}

