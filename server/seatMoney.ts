// What one seat put into the group, the way Money > Totals counts it ("Players paid"). One place, so Totals (server/money.ts) and the
// Players "Spent" with the "Spent matches Totals" switch on (Zip 27, A-05, server/adminR3.ts) can never disagree.
import { isPaymentClaim, seatCredit } from '../shared/credit';
import { lateFeeKind } from '../shared/lateFees';
import type { LedgerRow } from './credit';
import type { RosterRow, SessionRow } from './repo';

type SeatGame = Pick<SessionRow, 'id' | 'status' | 'canceled_by' | 'finalized_at'>;

/**
 * An unconfirmed "I paid" on a seat that left (or a canceled game, or a seat that did not play): a claim, held until the organizer
 * decides, never money the group kept. An open late fee is never a claim.
 */
export function seatIsClaim(r: RosterRow, s: SeatGame): boolean {
  return (
    !lateFeeKind(r, s) &&
    isPaymentClaim({ status: r.status, paymentStatus: r.payment_status, selfPaid: !!r.self_paid_at, refundedAt: r.refunded_at, played: s.finalized_at && r.played === 0 ? false : null }, s.status === 'canceled')
  );
}

/**
 * What the seat paid and has not been given back as credit (a settled seat gave it all back), plus cash paid earlier toward a seat whose
 * price went up (held against it). Not for a claim (see seatIsClaim).
 */
export function seatKeptCents(r: RosterRow, s: SeatGame, ledger: LedgerRow[]): number {
  const seat = seatCredit(ledger, s.id, r.player_id, { paymentStatus: r.payment_status, paidAt: r.paid_at, refundedAt: r.refunded_at });
  if (r.payment_status === 'paid' && !r.refunded_at) return Math.max(0, (r.payment_amount_cents ?? 0) - seat.backCents);
  // Cash held against a seat counts while the seat holds it; a settled seat gave it back as credit already.
  return r.refunded_at ? 0 : seat.cashCents;
}
