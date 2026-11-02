import type { AdminSessionView } from '../../../shared/api';

/** Who still owes on this game: the same players the old "Payment reminder" button was for. */
export const unpaidRows = (s: AdminSessionView) => s.roster.filter((r) => !r.isOrganizer && (r.status === 'confirmed' || r.paymentStatus === 'paid') && r.paymentStatus === 'unpaid' && r.owesCents > 0);

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
    if (s.state.flags.canceled) out.push({ s, kind: 'closed' });
    else if (s.court !== null) out.push({ s, kind: 'money' });
    else if (Date.parse(s.endsAt) > nowMs) out.push({ s, kind: 'waiting' });
  }
  const upcoming = out.filter((g) => Date.parse(g.s.startsAt) > nowMs);
  const started = out.filter((g) => Date.parse(g.s.startsAt) <= nowMs).reverse();
  return [...upcoming, ...started];
}
