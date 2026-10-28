// The organizer's monthly money page: what came in, what the courts cost,
// credits still owed, and how much is left toward the club membership.
// Admin only. Nothing here is ever sent to a player.

import type { MonthlyMoney } from '../shared/api';
import { formatPrice } from '../shared/money';
import { localParts, zonedTimeToUtc } from '../shared/time';
import { requireAdmin } from './auth';
import type { Ctx } from './context';
import { HttpError } from './http';
import { courtCostOf, issueCredits, loadCredits, loadRoster, organizerIdOf, type SessionRow, settingsOf } from './repo';

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

  await issueCredits(ctx.db, group, ctx.nowMs);
  const { results } = await ctx.db
    .prepare('SELECT * FROM sessions WHERE group_id = ? AND starts_at >= ? AND starts_at < ? ORDER BY starts_at')
    .bind(group.id, from, to)
    .all<SessionRow>();
  // The organizer pays the venue themselves: their own row and credits are never money from players.
  const organizerId = await organizerIdOf(ctx.db, group);
  const credits = (await loadCredits(ctx.db, group.id)).filter((c) => c.player_id !== organizerId);

  let collected = 0;
  let courts = 0;
  let creditsOwed = 0;
  const sessions: MonthlyMoney['sessions'] = [];
  for (const s of results) {
    const roster = await loadRoster(ctx.db, s.id);
    const confirmed = roster.filter((r) => r.status === 'confirmed').length;
    const over = ctx.nowMs >= Date.parse(s.ends_at);
    // Played: not canceled, over, and either booked or someone was in.
    const state: MonthlyMoney['sessions'][number]['state'] =
      s.status === 'canceled' ? 'canceled' : !over ? 'upcoming' : s.booking_status === 'booked' || confirmed > 0 ? 'played' : 'not_played';
    const paid = roster
      .filter((r) => r.player_id !== organizerId && r.payment_status === 'paid' && !r.refunded_at)
      .reduce((sum, r) => sum + (r.payment_amount_cents ?? 0), 0);
    const cost = courtCostOf(s, settings);
    if (state === 'played') {
      collected += paid;
      courts += cost;
      creditsOwed += credits
        .filter((c) => c.earned_session_id === s.id && !c.used_session_id && !c.cleared_at)
        .reduce((sum, c) => sum + c.amount_cents, 0);
    }
    sessions.push({
      id: s.id,
      startsAt: s.starts_at,
      endsAt: s.ends_at,
      state,
      collectedCents: state === 'played' ? paid : 0,
      courtCostCents: state === 'played' ? cost : 0,
      typicalCost: s.court_cost_cents === null,
    });
  }
  const net = collected - courts - creditsOwed;
  return {
    month: `${year}-${String(month).padStart(2, '0')}`,
    label: `${MONTHS[month - 1]} ${year}`,
    collectedCents: collected,
    courtCostCents: courts,
    creditsOwedCents: creditsOwed,
    netCents: net,
    surplusCents: Math.max(0, net),
    coveredCents: Math.max(0, -net),
    membershipCents: settings.monthlyMembershipCents,
    bottomLine: bottomLine(net, settings.monthlyMembershipCents, sessions.filter((x) => x.state === 'played').length),
    sessions,
  };
}
