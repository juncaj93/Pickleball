import type { GroupView } from '../shared/api';
import type { GroupSettings } from '../shared/settings';
import { lateFeeKind } from '../shared/lateFees';
import { NO_SEAT_CREDIT, seatCredit, type CreditRow, type SeatCredit } from '../shared/credit';
import { pricesFor, type RosterRow, type SessionRow } from './repo';

const DAY_MS = 86_400_000;

/**
 * Their own seats' part of the pot: credit used on it, cash paid toward it earlier, and money that came back from it.
 * (The organizer has none: pass no player.)
 */
export function seatOf(rosters: Map<string, RosterRow[]>, ledger: CreditRow[], playerId: string | null, sessionId: string): SeatCredit {
  if (!playerId) return NO_SEAT_CREDIT;
  const r = (rosters.get(sessionId) ?? []).find((x) => x.player_id === playerId);
  if (!r) return NO_SEAT_CREDIT;
  return seatCredit(ledger, sessionId, playerId, { paymentStatus: r.payment_status, paidAt: r.paid_at, refundedAt: r.refunded_at });
}

/**
 * What one player owes, game by game (GroupView.owed): the money the owe card at the top of the player page is built from. Moved here
 * unchanged from server/player.ts (Zip 17) so the Unpaid nudge's sign-up check reads exactly the same numbers, never a second sum.
 * Never call it for the organizer (who pays the venue, never the group).
 */
export function owedOf(
  playerId: string,
  sessions: SessionRow[],
  rosters: Map<string, RosterRow[]>,
  ledger: CreditRow[],
  settings: GroupSettings,
  nowMs: number,
  opts: { afterGame?: boolean } = {},
): GroupView['owed'] {
  const owed: GroupView['owed'] = [];
  for (const s of sessions) {
    const roster = rosters.get(s.id) ?? [];
    // An open late fee (shared/lateFees.ts) is owed like a seat that is in: a late drop, a no-show, a game canceled late.
    const own = roster.find((r) => r.player_id === playerId);
    const fee = own ? lateFeeKind(own, s) : null;
    if (s.status === 'canceled' && !fee) continue;
    const mine = own && (own.status === 'confirmed' || fee) && own.payment_status === 'unpaid' ? own : undefined;
    const price = mine ? pricesFor(s, roster, settings).get(playerId) : undefined;
    if (!price) continue;
    const seat = seatOf(rosters, ledger, playerId, s.id);
    const used = seat.usedCents + seat.cashCents;
    if (price.cents - used <= 0) continue;
    owed.push({
      sessionId: s.id,
      startsAt: s.starts_at,
      endsAt: s.ends_at,
      amountCents: price.cents - used,
      creditCents: seat.usedCents,
      finalized: !!s.finalized_at,
      reminder: nowMs >= Date.parse(s.ends_at) + DAY_MS,
      signupAt: mine!.confirmed_at ?? mine!.claimed_at,
      ...(fee ? { lateFee: fee } : {}),
      // Zip 16: paid a lower price before Finalize (that cash is held on the seat) and owes the rest now.
      ...(opts.afterGame && !fee && s.finalized_at && seat.cashCents > 0 && s.final_price_cents !== null && s.final_price_cents !== undefined
        ? { more: { finalPriceCents: s.final_price_cents, playedCount: s.final_played_count ?? null } }
        : {}),
    });
  }
  return owed;
}
