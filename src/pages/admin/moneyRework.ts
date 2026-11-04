import type { AdminSessionView } from '../../../shared/api';
import { gameHasMoney } from '../../../shared/moneyRework';
import { creditBack } from '../../../shared/pricing';
import { localParts, zonedTimeToUtc } from '../../../shared/time';
import { moneyGames, owedCentsOf } from './moneyList';

// The reworked Money page (MONEY_REWORK): which game sits where on the Games tab, and the small facts a card shows.
// Pure functions of the data the page already has, so they are easy to test. Nothing here changes a total or a rule.

/** "2026-11" for a moment, in the group's time zone. */
export function monthOf(ms: number, tz: string): string {
  const p = localParts(ms, tz);
  return `${p.year}-${String(p.month).padStart(2, '0')}`;
}

/** "2026-11" shifted by whole months. */
export function shiftMonthKey(month: string, by: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export type RwGame = { s: AdminSessionView; kind: 'money' | 'closed' };

/**
 * The games the Games tab can show: games with money to look at (a court, or somebody in) and canceled games, never one the organizer hid
 * from the list. Games still waiting on a court with nobody in have no money to show, so they are not here.
 */
export function listedGames(sessions: AdminSessionView[], nowMs: number): RwGame[] {
  return moneyGames(
    sessions.filter((s) => s.hiddenFromList !== true),
    nowMs,
  ).filter((g): g is RwGame => g.kind !== 'waiting');
}

/** Everyone who is expected to pay has paid. A game with nobody to pay, or a canceled one, is never "fully paid". */
export function fullyPaid(s: AdminSessionView): boolean {
  return !s.state.flags.canceled && s.payableCount > 0 && s.paidCount >= s.payableCount && owedCentsOf(s) === 0;
}

/** Does the game still need the organizer's eye on money (somebody owes, or it still has to be finalized)? */
export function needsMoney(s: AdminSessionView): boolean {
  return owedCentsOf(s) > 0 || s.needsFinalize;
}

export interface GamesView {
  /** Games to look at now: today and the next 7 days, plus any older game somebody still owes for. Unpaid first, then by date. */
  main: RwGame[];
  /** Fully paid games, canceled games with nothing owed, and anything before today with nothing owed. Most recent first. */
  previous: RwGame[];
  /** Current month only: games after the 7-day window. */
  later: RwGame[];
}

/**
 * Split one month's games into the three places the Games tab shows them.
 *  - The current month: today and the next 7 days are the main list, games further out wait in "Later games", games before today are
 *    "Previous games" (unless somebody still owes for one, which stays on top so nobody is forgotten).
 *  - Any other month: every game is in the main list, except fully paid ones, which go to "Previous games".
 * A fully paid game always goes to "Previous games".
 */
export function splitGames(sessions: AdminSessionView[], month: string, nowMs: number, tz: string): GamesView {
  const all = listedGames(sessions, nowMs).filter((g) => monthOf(Date.parse(g.s.startsAt), tz) === month);
  const current = monthOf(nowMs, tz) === month;
  const p = localParts(nowMs, tz);
  const todayStart = zonedTimeToUtc(p.year, p.month, p.day, 0, 0, tz);
  const windowEnd = zonedTimeToUtc(p.year, p.month, p.day + 8, 0, 0, tz);
  const main: RwGame[] = [];
  const previous: RwGame[] = [];
  const later: RwGame[] = [];
  for (const g of all) {
    const start = Date.parse(g.s.startsAt);
    if (fullyPaid(g.s)) previous.push(g);
    else if (start < todayStart) (needsMoney(g.s) ? main : previous).push(g);
    else if (current && start >= windowEnd) later.push(g);
    else main.push(g);
  }
  const byDate = (a: RwGame, b: RwGame) => Date.parse(a.s.startsAt) - Date.parse(b.s.startsAt);
  // Unpaid or partly paid sit on top; a game with nothing to pay follows, each group in date order.
  main.sort((a, b) => Number(needsMoney(b.s)) - Number(needsMoney(a.s)) || byDate(a, b));
  previous.sort((a, b) => byDate(b, a));
  later.sort(byDate);
  return { main, previous, later };
}

export interface MonthChoice {
  month: string;
  /** Games the Games tab lists for that month. */
  count: number;
}

/**
 * The months in the dropdown, newest first: any month that has a listed game, plus the current month and the four before it (so the
 * list is never one line long), with how many games each one holds.
 */
export function monthChoices(sessions: AdminSessionView[], nowMs: number, tz: string): MonthChoice[] {
  const counts = new Map<string, number>();
  for (const g of listedGames(sessions, nowMs)) {
    const m = monthOf(Date.parse(g.s.startsAt), tz);
    counts.set(m, (counts.get(m) ?? 0) + 1);
  }
  const current = monthOf(nowMs, tz);
  for (let i = 0; i <= 4; i++) {
    const m = shiftMonthKey(current, -i);
    if (!counts.has(m)) counts.set(m, 0);
  }
  if (!counts.has(current)) counts.set(current, 0);
  return [...counts].map(([month, count]) => ({ month, count })).sort((a, b) => b.month.localeCompare(a.month));
}

/** "NOV 26": the short month and two-digit year on the month box. */
export function monthBoxLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  const name = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'][m - 1];
  return `${name} ${String(y % 100).padStart(2, '0')}`;
}

/** "Nov 2026" for a dropdown row. */
export function monthRowLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1]} ${y}`;
}

/** The credit each player gets back at the number in now ("Credit: $3 per"), in cents; 0 when nothing comes back. */
export function creditPerPlayerCents(s: AdminSessionView, flatCents: number): number {
  if (s.finalized) return 0;
  return creditBack(flatCents, s.confirmedCount);
}

/**
 * Can this game be hidden? Only when no money is involved (shared/moneyRework.ts): nobody paid, no credit from it, nobody owes, no court to pay
 * for and no venue charge (or a $0 charge after Edit charge). The server checks the same rule, so this only decides whether to show the option.
 */
export function canHide(s: AdminSessionView): boolean {
  return !gameHasMoney({
    canceled: s.state.flags.canceled,
    booked: s.bookingStatus === 'booked',
    confirmed: s.confirmedCount,
    finalized: !!s.finalized,
    chargedCents: s.state.flags.canceled ? (s.chargedCents ?? 0) : 0,
    creditEntries: s.roster.some((r) => r.creditCents > 0 || r.creditBackCents > 0) ? 1 : 0,
    seats: s.roster.map((r) => ({ paid: r.paymentStatus === 'paid', paidCents: r.paymentAmountCents ?? 0, lateFee: !!r.lateFee })),
  });
}
