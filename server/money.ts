// The organizer's monthly money page: what came in, what the courts cost,
// credit still owed, and how much is left toward the club membership.
// Admin only. Nothing here is ever sent to a player.
//
// A game's money is Held until the organizer finalizes it. Then Collected is
// what the group kept: what each other player paid minus what came back to
// them as credit (so with everyone paid, the final price times the players
// who played). Credit owed is money that was never collected, so it is
// shown but not taken off Left.

import type { MonthlyMoney } from '../shared/api';
import { formatPrice } from '../shared/money';
import { localParts, zonedTimeToUtc } from '../shared/time';
import { requireAdmin } from './auth';
import type { Ctx } from './context';
import { HttpError } from './http';
import { keptRemaining, seatCredit } from '../shared/credit';
import { loadLedger } from './credit';
import { courtCostOf, loadCancelCharges, loadRoster, organizerIdOf, type SessionRow, settingsOf } from './repo';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/**
 * "Surplus: $14 toward the $30 membership" only when the players paid more
 * than the courts cost. When they paid less, the organizer covered the rest:
 * "You covered $8 of the court costs". Never a surplus from the organizer.
 */
export function bottomLine(netCents: number, membershipCents: number, sessionsPlayed = 1): string {
  if (sessionsPlayed === 0) return 'Nothing played yet';
  if (netCents > 0) return `Surplus: ${formatPrice(netCents)} toward the ${formatPrice(membershipCents)} membership`;
  if (netCents < 0) return `You covered ${formatPrice(-netCents)} of the court costs`;
  return 'Players covered the court costs';
}

export async function monthlyMoney(ctx: Ctx): Promise<MonthlyMoney> {
  const group = await requireAdmin(ctx);
  const tz = group.timezone;
  const settings = settingsOf(group);
  const asked = ctx.url.searchParams.get('month');
  let year: number;
  let month: number;
  if (asked) {
    const m = /^(\d{4})-(\d{2})$/.exec(asked);
    if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) throw new HttpError(400, 'invalid_month', 'Pick a month.');
    year = Number(m[1]);
    month = Number(m[2]);
  } else {
    const p = localParts(ctx.nowMs, tz);
    year = p.year;
    month = p.month;
  }
  const from = new Date(zonedTimeToUtc(year, month, 1, 0, 0, tz)).toISOString();
  const to = new Date(zonedTimeToUtc(month === 12 ? year + 1 : year, month === 12 ? 1 : month + 1, 1, 0, 0, tz)).toISOString();

  const { results } = await ctx.db
    .prepare('SELECT * FROM sessions WHERE group_id = ? AND starts_at >= ? AND starts_at < ? ORDER BY starts_at')
    .bind(group.id, from, to)
    .all<SessionRow>();
  // The organizer pays the venue themselves: their own row is never money from players.
  const organizerId = await organizerIdOf(ctx.db, group);
  // Credit that came back from games, split by the month of the game it came from (the oldest credit is spent
  // first). The cash pairs (reason 'cash') net to nothing in the pot and are left out.
  const ledger = (await loadLedger(ctx.db, group.id)).filter((e) => e.playerId !== organizerId);
  const keptLeft = keptRemaining(ledger.filter((e) => e.reason !== 'cash'));
  const owedBySession = new Map<string, number>();
  for (const e of ledger) {
    if (e.kind !== 'kept' || !e.sessionId || e.endedAt || e.reason === 'cash') continue;
    owedBySession.set(e.sessionId, (owedBySession.get(e.sessionId) ?? 0) + (keptLeft.get(e.id) ?? 0));
  }
  // Canceled games the venue still charged for count their court cost.
  const charges = await loadCancelCharges(ctx.db, group.id);

  let collected = 0;
  let courts = 0;
  let creditsOwed = 0;
  let held = 0;
  const sessions: MonthlyMoney['sessions'] = [];
  for (const s of results) {
    const roster = await loadRoster(ctx.db, s.id);
    const confirmed = roster.filter((r) => r.status === 'confirmed').length;
    const over = ctx.nowMs >= Date.parse(s.ends_at);
    const state: MonthlyMoney['sessions'][number]['state'] =
      s.status === 'canceled' ? 'canceled' : !over ? 'upcoming' : s.finalized_at ? 'played' : s.booking_status === 'booked' || confirmed > 0 ? 'not_finalized' : 'not_played';
    // What other players paid and have not been given back as credit (settled seats gave it all back), plus cash
    // paid earlier toward a seat whose price went up.
    const kept = roster
      .filter((r) => r.player_id !== organizerId)
      .reduce((sum, r) => {
        const seat = seatCredit(ledger, s.id, r.player_id, { paymentStatus: r.payment_status, paidAt: r.paid_at, refundedAt: r.refunded_at });
        if (r.payment_status === 'paid' && !r.refunded_at) return sum + Math.max(0, (r.payment_amount_cents ?? 0) - seat.backCents);
        return sum + seat.cashCents;
      }, 0);
    const cost = courtCostOf(s, settings);
    const charged = state === 'canceled' ? (charges.get(s.id) ?? 0) : 0;
    creditsOwed += owedBySession.get(s.id) ?? 0;
    // Money in for a game that isn't finalized is held, not collected.
    if (state !== 'played' && state !== 'canceled') held += kept;
    // Credit put on a seat that still owes the rest is the organizer's money already, so it is held (finalized
    // or not) until the seat is paid; then the whole payment is counted above.
    if (state !== 'canceled')
      held += roster
        .filter((r) => r.player_id !== organizerId && r.status === 'confirmed' && r.payment_status === 'unpaid')
        .reduce((sum, r) => sum + seatCredit(ledger, s.id, r.player_id, { paymentStatus: r.payment_status, paidAt: r.paid_at, refundedAt: r.refunded_at }).usedCents, 0);
    courts += charged;
    if (state === 'played') {
      collected += kept;
      courts += cost;
    }
    sessions.push({
      id: s.id,
      startsAt: s.starts_at,
      endsAt: s.ends_at,
      state,
      charged: charged > 0,
      collectedCents: state === 'played' ? kept : 0,
      courtCostCents: state === 'played' ? cost : charged,
      typicalCost: s.court_cost_cents === null,
      playedCount: s.finalized_at ? (s.final_played_count ?? 0) : null,
      priceCents: s.finalized_at ? (s.final_price_cents ?? settings.pricePerPlayerCents) : null,
    });
  }
  const net = collected - courts;
  return {
    month: `${year}-${String(month).padStart(2, '0')}`,
    label: `${MONTHS[month - 1]} ${year}`,
    collectedCents: collected,
    courtCostCents: courts,
    creditsOwedCents: creditsOwed,
    heldCents: held,
    netCents: net,
    surplusCents: Math.max(0, net),
    coveredCents: Math.max(0, -net),
    membershipCents: settings.monthlyMembershipCents,
    bottomLine: bottomLine(net, settings.monthlyMembershipCents, sessions.filter((x) => x.state === 'played').length),
    sessions,
  };
}
