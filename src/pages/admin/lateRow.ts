// Zip 49 (Alex): the Players sheet row of a seat that owes a late fee (a late drop, a no-show, a game canceled late), in plain words.
//   Line 2: "Late drop · owes $14": what the rule says the seat owes (two shares for a host and guest two short), never the amount paid.
//   Paid more than that (an I paid of $28, not confirmed yet): "Paid $28 · $14 to give back" and one button, "Give back $14", which is the
//   organizer's Mark paid: the confirm keeps $14 on the game and the rest comes back as credit.
//   Paid exactly that: the green "Paid $14" chip (and "$14 back" once a give-back happened). Owes and unpaid: Mark paid and Request, as any row.
import type { AdminRosterEntry } from '../../../shared/api';
import { formatPrice } from '../../../shared/money';

const LABEL = { late_drop: 'Late drop', no_show: 'Did not play', canceled_late: 'Canceled late' } as const;

export interface LateRowWords {
  /** "Late drop · owes $14" */
  line: string;
  /** The muted line under it, or null. */
  note: string | null;
  /** The one button: "Give back $14" (a confirm that gives money back), "Mark paid" (a confirm or a payment), or none. */
  button: { label: string; giveBack: boolean } | null;
  /** The green chip ("Paid $14"), or null. */
  chip: string | null;
  /** Request goes beside Mark paid only on a seat that owes and has nothing marked paid. */
  request: boolean;
}

export function lateRowWords(
  r: Pick<AdminRosterEntry, 'name' | 'lateFee' | 'shareCents' | 'owesCents' | 'paymentStatus' | 'paymentAmountCents' | 'selfPaid' | 'refundedAt' | 'trimBackCents'>,
  /** One share ($14): a give-back only ever moves whole shares (server/guestSpot.ts trimGuestShares). */
  flatCents: number,
): LateRowWords | null {
  if (!r.lateFee) return null;
  const owed = r.shareCents ?? r.lateFee.oweCents;
  const line = `${LABEL[r.lateFee.kind]} · owes ${formatPrice(owed)}`;
  const paid = r.paymentStatus === 'paid' && !r.refundedAt ? (r.paymentAmountCents ?? 0) : 0;
  if (paid > 0) {
    const extra = paid - owed;
    if (extra > 0 && r.selfPaid && flatCents > 0 && extra % flatCents === 0)
      return { line, note: `Paid ${formatPrice(paid)} · ${formatPrice(extra)} to give back`, button: { label: `Give back ${formatPrice(extra)}`, giveBack: true }, chip: null, request: false };
    if (extra < 0) return { line, note: `Paid ${formatPrice(paid)} · ${formatPrice(-extra)} more due`, button: r.selfPaid ? { label: 'Mark paid', giveBack: false } : null, chip: null, request: false };
    const back = r.trimBackCents ?? 0;
    return { line, note: back > 0 ? `${formatPrice(back)} back` : r.selfPaid ? `Marked paid by ${r.name.split(' ')[0]}` : null, button: null, chip: `Paid ${formatPrice(paid)}`, request: false };
  }
  if (r.owesCents > 0) {
    const covered = owed - r.owesCents;
    return { line, note: covered > 0 ? `${formatPrice(covered)} paid · ${formatPrice(r.owesCents)} left` : null, button: { label: 'Mark paid', giveBack: false }, chip: null, request: true };
  }
  return { line, note: null, button: null, chip: null, request: false };
}
