// The organizer's monthly money page: what came in, what the courts cost,
// credits still owed, and how much is left toward the club membership.
// Admin only. Nothing here is ever sent to a player.

import type { MonthlyMoney } from '../shared/api';
import { formatPrice } from '../shared/money';
import { localParts, zonedTimeToUtc } from '../shared/time';
import { requireAdmin } from './auth';
import type { Ctx } from './context';
import { HttpError } from './http';
import { issueCredits, loadCredits, loadRoster, type SessionRow, settingsOf } from './repo';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "Surplus: $14 toward the $30 membership" or "Short: $8". */
export function bottomLine(netCents: number, membershipCents: number): string {
  return netCents >= 0 ? `Surplus: ${formatPrice(netCents)} toward the ${formatPrice(membershipCents)} membership` : `Short: ${formatPrice(-netCents)}`;
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
  const credits = await loadCredits(ctx.db, group.id);

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
      .filter((r) => r.payment_status === 'paid' && !r.refunded_at)
      .reduce((sum, r) => sum + (r.payment_amount_cents ?? 0), 0);
    const cost = s.court_cost_cents ?? settings.typicalCourtCostCents;
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
    membershipCents: settings.monthlyMembershipCents,
    bottomLine: bottomLine(net, settings.monthlyMembershipCents),
    sessions,
  };
}
