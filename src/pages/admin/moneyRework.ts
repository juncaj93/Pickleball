import type { AdminDashboard, AdminSessionView } from '../../../shared/api';
import { siteAddress } from '../../../shared/messages';
import { remindGameGroupText } from '../../../shared/textsR2';
import { gameHasMoney } from '../../../shared/moneyRework';
import { creditBack } from '../../../shared/pricing';
import { localParts, zonedTimeToUtc } from '../../../shared/time';
import { moneyGames, owedCentsOf, unpaidRows } from './moneyList';

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

/**
 * Done with: finalized (or, with instant taps, a Finalize tap still saving). A fully paid game moves to "Previous games" only then
 * (Alex, Thu Nov 5): tonight's game where everyone already paid stays in the main list until it is played and finalized.
 */
export function finalizedForList(s: AdminSessionView): boolean {
  return !!s.finalized || s.finalizing === true;
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
}

/**
 * Split one month's games into the three places the Games tab shows them.
 *  - The current month: today and the next 7 days are the main list, games further out are not shown, games before today are
 *    "Previous games" (unless somebody still owes for one, which stays on top so nobody is forgotten).
 *  - Any other month: every game is in the main list, except fully paid finalized ones, which go to "Previous games".
 * A fully paid game goes to "Previous games" once it is FINALIZED; until then it stays in the main list (after the games somebody owes for).
 */
export function splitGames(sessions: AdminSessionView[], month: string, nowMs: number, tz: string): GamesView {
  const all = listedGames(sessions, nowMs).filter((g) => monthOf(Date.parse(g.s.startsAt), tz) === month);
  const current = monthOf(nowMs, tz) === month;
  const p = localParts(nowMs, tz);
  const todayStart = zonedTimeToUtc(p.year, p.month, p.day, 0, 0, tz);
  const windowEnd = zonedTimeToUtc(p.year, p.month, p.day + 8, 0, 0, tz);
  const main: RwGame[] = [];
  const previous: RwGame[] = [];
  for (const g of all) {
    const start = Date.parse(g.s.startsAt);
    if (fullyPaid(g.s) && finalizedForList(g.s)) previous.push(g);
    else if (current && start >= windowEnd) continue; // beyond the 7 days: not on the Games tab (its money is in Totals)
    else if (fullyPaid(g.s)) main.push(g); // everyone paid, not finalized yet: stays in the main list
    else if (start < todayStart) (needsMoney(g.s) ? main : previous).push(g);
    else main.push(g);
  }
  const byDate = (a: RwGame, b: RwGame) => Date.parse(a.s.startsAt) - Date.parse(b.s.startsAt);
  // Unpaid or partly paid sit on top; a game with nothing to pay follows, each group in date order.
  main.sort((a, b) => Number(needsMoney(b.s)) - Number(needsMoney(a.s)) || byDate(a, b));
  previous.sort((a, b) => byDate(b, a));
  return { main, previous };
}

export interface MonthChoice {
  month: string;
  /** Games the Games tab lists for that month. */
  count: number;
}

/**
 * The months in the dropdown, newest first: EVERY month from the first one that ever had a game up to the current month (or a later month
 * that already has games), with how many games Money lists in each. `counts` is the server's count for every month; without it the
 * count comes from the games on hand.
 */
export function monthChoices(sessions: AdminSessionView[], nowMs: number, tz: string, counts?: Record<string, number>): MonthChoice[] {
  const by = new Map<string, number>();
  if (counts) for (const [m, n] of Object.entries(counts)) by.set(m, n);
  else
    for (const g of listedGames(sessions, nowMs)) {
      const m = monthOf(Date.parse(g.s.startsAt), tz);
      by.set(m, (by.get(m) ?? 0) + 1);
    }
  const current = monthOf(nowMs, tz);
  const withGames = [...by].filter(([, n]) => n > 0).map(([m]) => m).sort();
  const first = withGames[0] && withGames[0] < current ? withGames[0] : current;
  const last = withGames.length && withGames[withGames.length - 1] > current ? withGames[withGames.length - 1] : current;
  const out: MonthChoice[] = [];
  for (let m = last, guard = 0; m >= first && guard < 600; m = shiftMonthKey(m, -1), guard++) out.push({ month: m, count: by.get(m) ?? 0 });
  return out;
}

export type MonthRow = { kind: 'month'; month: string; count: number } | { kind: 'year'; year: string };

/** The dropdown's rows: the months, with a year label row wherever the year changes from the row above. */
export function monthRows(choices: MonthChoice[]): MonthRow[] {
  const rows: MonthRow[] = [];
  choices.forEach((c, i) => {
    const year = c.month.slice(0, 4);
    if (i > 0 && year !== choices[i - 1].month.slice(0, 4)) rows.push({ kind: 'year', year });
    rows.push({ kind: 'month', month: c.month, count: c.count });
  });
  return rows;
}

/** "Nov 2026": the month box (3-letter month, full year). */
export function monthBoxLabel(month: string): string {
  return monthRowLabel(month);
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

/**
 * Who "Text all" is addressed to: the people who owe on this game right now (confirmed, unpaid, with something still owed, so never the
 * waitlist, never someone who paid or whose credit covers it, never the organizer), split into the ones with a number and the ones without.
 */
export function textAllRecipients(s: AdminSessionView): { phones: string[]; missing: string[] } {
  const owing = unpaidRows(s).filter((r) => r.status === 'confirmed');
  return { phones: owing.filter((r) => !!r.phone).map((r) => r.phone as string), missing: owing.filter((r) => !r.phone).map((r) => r.name) };
}

/** "Text all" shows only when at least 2 of the people who owe have a number. */
export const canTextAll = (s: AdminSessionView): boolean => textAllRecipients(s).phones.length >= 2;

/** The note after "Text all" when someone owing has no number: "No number for Kai, texted the rest." */
export function missingNumberNote(names: string[]): string {
  const who = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0];
  return `No number for ${who}, texted the rest.`;
}

/**
 * The price each person is asked for on this game: the price on the seats of the people who owe (the most common one), so a game canceled late
 * with the fee split says $11, not $14. With nobody owing: the final price once finalized, else the usual price.
 */
export function gamePriceCents(d: Pick<AdminDashboard, 'group'>, s: AdminSessionView): number {
  const counts = new Map<number, number>();
  for (const r of unpaidRows(s)) if (r.shareCents !== null && r.shareCents > 0) counts.set(r.shareCents, (counts.get(r.shareCents) ?? 0) + 1);
  const common = [...counts].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0];
  if (common) return common[0];
  return s.finalized ? s.finalized.priceCents : d.group.settings.pricePerPlayerCents;
}

/** The "Text all" message for a game: one text for the group chat (no recipients), the site address alone on the last line. */
export function groupRemindText(d: Pick<AdminDashboard, 'group' | 'now'>, s: AdminSessionView): string {
  return remindGameGroupText(s.startsAt, d.group.timezone, Date.parse(d.now), gamePriceCents(d, s), siteAddress(d.group.playerLink));
}
