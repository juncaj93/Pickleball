import type { AdminDashboard, AdminRosterEntry, AdminSessionView } from '../../../shared/api';
import { localParts } from '../../../shared/time';

/** Who still owes on this game: the same players the old "Payment reminder" button was for. */
export const unpaidRows = (s: AdminSessionView) =>
  // An open late fee (shared/lateFees.ts) owes too, also on a seat that left or a game canceled late.
  s.roster.filter((r) => !r.isOrganizer && (r.status === 'confirmed' || r.paymentStatus === 'paid' || !!r.lateFee) && r.paymentStatus === 'unpaid' && r.owesCents > 0);

/** What is still owed on a game, in cents: the people in unpaidRows, added up. */
export const owedCentsOf = (s: AdminSessionView) => unpaidRows(s).reduce((sum, r) => sum + r.owesCents, 0);

export type MoneyGameKind = 'money' | 'waiting' | 'closed';

/**
 * The games on the Money list, round 2 (ADMIN_R2): ONE list in date order, no group headers. Games from now on come first, soonest first;
 * games already started follow, most recent first (the order the new Money tab already uses). Three kinds of line:
 *   money   a game with a court to pay for (the same games the old tab lists): opens to who paid and the court row.
 *   waiting a coming game with no court yet: gray, "waiting on court", nothing to open.
 *   closed  a canceled game: faded, "Closed".
 * Display only: which game shows here never changes a total, a button or a rule.
 */
export function moneyGames(sessions: AdminSessionView[], nowMs: number): { s: AdminSessionView; kind: MoneyGameKind }[] {
  const out: { s: AdminSessionView; kind: MoneyGameKind }[] = [];
  for (const s of sessions) {
    // A canceled game still holding late fees (canceled late, fee not waived, or a late drop) opens like any game with money.
    if (s.state.flags.canceled) out.push({ s, kind: s.roster.some((r) => r.lateFee) ? 'money' : 'closed' });
    else if (s.court !== null) out.push({ s, kind: 'money' });
    else if (Date.parse(s.endsAt) > nowMs) out.push({ s, kind: 'waiting' });
  }
  const upcoming = out.filter((g) => Date.parse(g.s.startsAt) > nowMs);
  const started = out.filter((g) => Date.parse(g.s.startsAt) <= nowMs).reverse();
  return [...upcoming, ...started];
}

/**
 * Zip 29: the Home money card ("Who hasn't paid", one card per game). It replaced the second card ("Mark paid tonight" / "Who owes you"), so it
 * lists every game and every player either card listed:
 *  - the old "Who hasn't paid" games: a game on or before today (also one canceled late with the fee kept), people from unpaidRows;
 *  - the old "Mark paid" games: a game that is not canceled from its check-in time on (so a COMING game too), its confirmed players who owe.
 * Every row the second card had is a row unpaidRows gives (confirmed, unpaid, owes more than $0), so per game the old "Who hasn't paid"
 * rows are the whole list. Games the organizer hid from the list are left out, as in both old cards.
 */
export function owedHomeGames(d: AdminDashboard): { s: AdminSessionView; rows: AdminRosterEntry[] }[] {
  const tz = d.group.timezone;
  const nowMs = Date.parse(d.now);
  const dayNum = (ms: number) => {
    const p = localParts(ms, tz);
    return Date.UTC(p.year, p.month - 1, p.day);
  };
  const today = dayNum(nowMs);
  const checkInMs = d.group.settings.checkInHours * 3600_000;
  return d.sessions
    .filter((s) => s.hiddenFromList !== true && (dayNum(Date.parse(s.startsAt)) <= today || (!s.state.flags.canceled && nowMs >= Date.parse(s.startsAt) - checkInMs)))
    // A game that is still ahead (a later day) lists only the players who are in it, as the old second card did: somebody who dropped late from a coming game
    // and owes the fee was on neither old card until game day, and the merged card shows no one the old cards did not.
    .map((s) => ({ s, rows: unpaidRows(s).filter((r) => dayNum(Date.parse(s.startsAt)) <= today || r.status === 'confirmed') }))
    .filter((g) => g.rows.length > 0)
    .sort((a, b) => a.s.startsAt.localeCompare(b.s.startsAt));
}
