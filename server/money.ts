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
import { seatIsClaim, seatKeptCents } from './seatMoney';
import { loadLedger } from './credit';
import { courtCostOf, flatOf, type GroupRow, loadCancelCharges, loadRoster, organizerIdOf, priceLockCol, rosterRead, type SessionRow, settingsOf } from './repo';
import { fewerDb } from './speed';
import { FEE_KEPT, feeSplitOf, lateFeeKind } from '../shared/lateFees';
import { membershipMonth, PROJECTED_PLAYERS_PER_COURT } from '../shared/moneyRework';
import { adminHiddenGameIds, moneyReworkFor, sessionHasMoney } from './moneyRework';

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
  return monthMoneyOf(ctx, group, year, month);
}

/**
 * One month's Money numbers (the Money tab, `GET /api/admin/money`). Also used by the Players redo (Zip 13) for the organizer's own
 * "Spent", so the two can never disagree: `forceRework` gives the reworked Totals ("Your cost so far") even when the Money page rework
 * is off for this phone. Read only.
 */
export async function monthMoneyOf(ctx: Ctx, group: GroupRow, year: number, month: number, forceRework = false): Promise<MonthlyMoney> {
  const tz = group.timezone;
  const settings = settingsOf(group);
  const from = new Date(zonedTimeToUtc(year, month, 1, 0, 0, tz)).toISOString();
  const to = new Date(zonedTimeToUtc(month === 12 ? year + 1 : year, month === 12 ? 1 : month + 1, 1, 0, 0, tz)).toISOString();

  const { results: allResults } = await ctx.db
    .prepare(`SELECT *, ${priceLockCol('sessions')} FROM sessions WHERE group_id = ? AND starts_at >= ? AND starts_at < ? ORDER BY starts_at`)
    .bind(group.id, from, to)
    .all<SessionRow>();
  // "Money page rework": a game the organizer hid from their lists is out of Totals too (nothing about it is deleted).
  const rework = forceRework || (await moneyReworkFor(ctx, group.id));
  const listHidden = rework ? await adminHiddenGameIds(ctx.db, group.id) : new Set<string>();
  const results = allResults;
  // The organizer pays the venue themselves: their own row is never money from players.
  const organizerId = await organizerIdOf(ctx.db, group);
  // Credit that came back from games, split by the month of the game it came from (the oldest credit is spent
  // first). The cash pairs (reason 'cash') net to nothing in the pot and are left out.
  const ledger = (await loadLedger(ctx.db, group.id)).filter((e) => e.playerId !== organizerId);
  // A hand adjustment (Adjust credit) belongs to no game, so no month's credit: it is left out of this split in both directions.
  const keptLeft = keptRemaining(ledger.filter((e) => e.reason !== 'cash' && e.reason !== 'adjusted'));
  const owedBySession = new Map<string, number>();
  for (const e of ledger) {
    // Zip 31: credit handed back from a share of extra time counts in the month of the game it came from (it names it in extSessionId).
    const from = e.sessionId ?? e.extSessionId ?? null;
    if (e.kind !== 'kept' || !from || e.endedAt || e.reason === 'cash') continue;
    owedBySession.set(from, (owedBySession.get(from) ?? 0) + (keptLeft.get(e.id) ?? 0));
  }
  // Canceled games the venue still charged for count their court cost.
  const charges = await loadCancelCharges(ctx.db, group.id);

  let collected = 0;
  let courts = 0;
  let creditsOwed = 0;
  let held = 0;
  // Games canceled late with the fee split (LATE_FEE_SPLIT): the venue charged and the players paid a played-game price, so
  // the bottom line counts them like a played game ("You covered $3"), not "Nothing played yet". Only split games, so with
  // the switch off the page reads exactly as before.
  let splitGames = 0;
  // The reworked Totals (MONEY_REWORK) keep their own sums so the numbers above stay exactly as they were:
  //  so far = a game only once it is FINALIZED (its court and the fees players paid are added at that moment; a game not finalized yet adds
  //  nothing), or a canceled one the venue charged (a cancel is its own settling); projected adds the games still to come (every one not canceled,
  //  booked or not, since Zip 13; or played and not finalized yet) and assumes 3 players pay the usual price for EVERY court, finalized or not.
  let rwCourts = 0;
  let rwCollected = 0;
  let rwSessions = 0;
  let projCourts = 0;
  let projAdded = 0;
  // What "3 players pay the usual price" adds up to, court by court (a 1.5 hour game's usual price is its own with "Short games" on).
  let projPlayersCents = 0;
  const sessions: MonthlyMoney['sessions'] = [];
  const creditSessionIds = new Set(ledger.map((e) => e.sessionId).filter((x): x is string => !!x));
  // SPEED_FEWER_QUERIES (server/speed.ts): every game's roster in one trip instead of one each (nothing when it is off).
  await fewerDb(ctx)?.prefetch(results.map((s) => ({ kind: 'all' as const, ...rosterRead(s.id) })));
  for (const s of results) {
    const roster = await loadRoster(ctx.db, s.id);
    // A game hidden from the lists is out of Totals too, but only if it has no money in it (money is never hidden).
    if (rework && listHidden.has(s.id) && !sessionHasMoney(s, roster, creditSessionIds, charges)) continue;
    const confirmed = roster.filter((r) => r.status === 'confirmed').length;
    const over = ctx.nowMs >= Date.parse(s.ends_at);
    const state: MonthlyMoney['sessions'][number]['state'] =
      s.status === 'canceled' ? 'canceled' : !over ? 'upcoming' : s.finalized_at ? 'played' : s.booking_status === 'booked' || confirmed > 0 ? 'not_finalized' : 'not_played';
    // What other players paid and have not been given back as credit (settled seats gave it all back), plus cash
    // paid earlier toward a seat whose price went up.
    // An unconfirmed "I paid" on a seat that left (or a canceled game) is a claim: held until the organizer decides.
    // A game canceled late with the fee kept ("Did the venue waive the fee?" No): the venue charged, and what the players
    // paid toward it stays with the group, so it counts like a game that was played.
    const feeKept = s.status === 'canceled' && s.canceled_by === FEE_KEPT;
    if (feeKept && feeSplitOf(s)) splitGames++;
    // (server/seatMoney.ts: the same two rules the Players "Spent" uses with "Spent matches Totals" on, Zip 27.)
    const claim = (r: (typeof roster)[number]) => seatIsClaim(r, s);
    const claims = roster.filter((r) => r.player_id !== organizerId && claim(r)).reduce((sum, r) => sum + (r.payment_amount_cents ?? 0), 0);
    const kept = roster.filter((r) => r.player_id !== organizerId && !claim(r)).reduce((sum, r) => sum + seatKeptCents(r, s, ledger), 0);
    held += claims;
    const cost = courtCostOf(s, settings);
    const charged = state === 'canceled' ? (charges.get(s.id) ?? 0) : 0;
    creditsOwed += owedBySession.get(s.id) ?? 0;
    // Money in for a game that isn't finalized is held, not collected.
    if (state !== 'played' && state !== 'canceled') held += kept;
    // Credit put on a seat that still owes the rest is the organizer's money already, so it is held (finalized
    // or not) until the seat is paid; then the whole payment is counted above.
    if (state !== 'canceled' || feeKept)
      held += roster
        .filter((r) => r.player_id !== organizerId && (r.status === 'confirmed' || lateFeeKind(r, s)) && r.payment_status === 'unpaid')
        .reduce((sum, r) => sum + seatCredit(ledger, s.id, r.player_id, { paymentStatus: r.payment_status, paidAt: r.paid_at, refundedAt: r.refunded_at }).usedCents, 0);
    // Zip 31 "Extended time": the venue's charge for the extra time (written at Finalize) counts in the court costs of a played game,
    // and what the players put toward their shares counts as collected once it is real money (credit used, or cash the organizer
    // confirmed); an I paid not confirmed yet is held. A game with no extra time adds $0 to every line.
    const extCost = state === 'played' ? (s.extra_cost_cents ?? 0) : 0;
    const extIn = state === 'played' ? roster.filter((r) => r.player_id !== organizerId).reduce((sum, r) => sum + (r.ext_credit_cents ?? 0) + (r.ext_paid_cents ?? 0), 0) : 0;
    held += roster.filter((r) => r.player_id !== organizerId).reduce((sum, r) => sum + (r.ext_claim_cents ?? 0), 0);
    courts += charged;
    if (state === 'played' || feeKept) collected += kept;
    if (state === 'played') courts += cost;
    courts += extCost;
    collected += extIn;
    if (rework) {
      if (state === 'played' || (state === 'canceled' && charged > 0)) {
        rwSessions++;
        projPlayersCents += PROJECTED_PLAYERS_PER_COURT * flatOf(s, settings);
        rwCourts += (state === 'played' ? cost : charged) + extCost;
        rwCollected += kept + extIn;
      } else if (state === 'not_finalized' || state === 'upcoming') {
        // Zip 13: every game still to come counts in Projected as if it will be played, whatever its court status (Booked, Not booked
        // or Waitlist), until or unless it is canceled (a canceled game's state is 'canceled', so it never gets here). Display only.
        projAdded++;
        projPlayersCents += PROJECTED_PLAYERS_PER_COURT * flatOf(s, settings);
        projCourts += cost;
      }
    }
    sessions.push({
      id: s.id,
      startsAt: s.starts_at,
      endsAt: s.ends_at,
      state,
      charged: charged > 0,
      collectedCents: (state === 'played' || feeKept ? kept : 0) + extIn,
      courtCostCents: (state === 'played' ? cost : charged) + extCost,
      // Zip 31: the extra time in those two numbers (only when there was some, so a game without it reads exactly as before).
      ...(extCost > 0 ? { extraMinutes: s.extra_minutes ?? 0, extraCostCents: extCost, extraCollectedCents: extIn } : {}),
      typicalCost: s.court_cost_cents === null,
      playedCount: s.finalized_at ? (s.final_played_count ?? 0) : null,
      priceCents: s.finalized_at ? (s.final_price_cents ?? flatOf(s, settings)) : null,
    });
  }
  const net = collected - courts;
  const reworkTotals = rework
    ? (() => {
        const p = localParts(ctx.nowMs, tz);
        const isCurrent = p.year === year && p.month === month;
        // Membership is a monthly fee: "so far" has it for the current month, or any month with a game the venue is already owed for; the
        // projected card also has it for a month whose only games are still coming.
        // Zip 13: from October 2026 every month pays the membership, games or not ("so far" for this month and earlier, Projected for every one).
        const paysAnyway = membershipMonth(year, month);
        const notAhead = year < p.year || (year === p.year && month <= p.month);
        const soFarMembership = isCurrent || rwSessions > 0 || (paysAnyway && notAhead) ? settings.monthlyMembershipCents : 0;
        const projMembership = isCurrent || rwSessions + projAdded > 0 || paysAnyway ? settings.monthlyMembershipCents : 0;
        const split = (courtsCents: number, playersCents: number, membership: number) => {
          const yourCost = Math.max(0, courtsCents + membership - playersCents);
          const courtPart = Math.max(0, courtsCents - playersCents);
          return { yourCostCents: yourCost, yourCostCourtCents: courtPart, yourCostMembershipCents: yourCost - courtPart };
        };
        return {
          courtSessions: rwSessions,
          courtCostCents: rwCourts,
          membershipCents: soFarMembership,
          owedToVenueCents: rwCourts + soFarMembership,
          collectedCents: rwCollected,
          ...split(rwCourts, rwCollected, soFarMembership),
          projected: {
            courtCount: rwSessions + projAdded,
            addedCourts: projAdded,
            courtCostCents: rwCourts + projCourts,
            membershipCents: projMembership,
            totalCents: rwCourts + projCourts + projMembership,
            // 3 players pay the usual price for every court in the month, finalized or not: each court costs the organizer $48 - 3 x $14 = $6.
            playersPayCents: projPlayersCents,
            ...split(rwCourts + projCourts, projPlayersCents, projMembership),
          },
        };
      })()
    : undefined;
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
    bottomLine: bottomLine(net, settings.monthlyMembershipCents, sessions.filter((x) => x.state === 'played').length + splitGames),
    sessions,
    ...(reworkTotals ? { rework: reworkTotals } : {}),
  };
}
