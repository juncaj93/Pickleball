// The credit pot: money that came back to a player (they paid more than the
// final price, dropped out, the game was canceled, they did not play), kept as
// credit for any later game or paid back on request. One pot per player, whole
// dollars, no expiry.
//
// Pure functions over the ledger rows, so the server and the tests share them.

import type { CreditEntryView } from './api';
import { formatPrice } from './money';
import { formatShortDate } from './time';

export type CreditKind = 'kept' | 'used' | 'refunded';
/**
 * Why a 'kept' entry exists (see migrations/0013). Older entries have none.
 * 'cash' marks a matched pair (+kept, -used) that holds cash someone paid
 * toward a seat whose price then went up (a reopen and a redo with fewer
 * players): the pot is unchanged, the seat owes the rest. Never shown.
 */
export type CreditReason = 'finalized' | 'not_played' | 'dropped' | 'canceled' | 'migrated' | 'request' | 'cash';

/**
 * "Were you charged for this court?" is asked when canceling a game this many
 * hours or fewer before it starts (and not after it has started).
 */
export const CHARGE_ASK_HOURS = 12;

export interface CreditRow {
  id: string;
  playerId: string;
  kind: CreditKind;
  cents: number;
  /** Always 0 now (an older model kept a separate $5 credit); still counted so old rows read the same. */
  fiveCents: number;
  /** The game it came from (kept) or went to (used). */
  sessionId: string | null;
  createdAt: string;
  /** Undone, or went back to the player. An ended row no longer counts. */
  endedAt: string | null;
  /** Why it ended: 'dropped' or 'canceled' mean credit used on a seat went back to the player. */
  endedReason?: string | null;
  reason?: CreditReason | null;
  playedCount?: number | null;
}

// Rows arrive in the order they were made (created_at, then insertion order), and sorts keep that order for ties.
const live = (rows: CreditRow[]) => rows.filter((r) => !r.endedAt);

/** What a row adds to (+) or takes from (-) the pot. */
export function potEffect(r: Pick<CreditRow, 'kind' | 'cents' | 'fiveCents'>): number {
  if (r.kind === 'kept') return r.cents;
  if (r.kind === 'used') return -r.cents;
  return -(r.cents - r.fiveCents);
}

/** A player's pot: kept, minus used, minus paid back. Never below $0. */
export function potBalance(rows: CreditRow[], playerId: string): number {
  return Math.max(
    0,
    live(rows)
      .filter((r) => r.playerId === playerId)
      .reduce((sum, r) => sum + potEffect(r), 0),
  );
}

/**
 * What a player can spend or be refunded right now: the pot minus any refund
 * request still waiting on the organizer (that amount is reserved).
 */
export function usableCredit(potCents: number, reservedCents: number): number {
  return Math.max(0, potCents - Math.max(0, reservedCents));
}

/** Everyone's pot, players with $0 left out. */
export function potBalances(rows: CreditRow[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const id of new Set(rows.map((r) => r.playerId))) {
    const b = potBalance(rows, id);
    if (b > 0) out.set(id, b);
  }
  return out;
}

export const seatKey = (sessionId: string, playerId: string) => `${sessionId}:${playerId}`;

/** The entries a person reads: the cash pairs are bookkeeping, not history. */
export function visibleEntries<T extends Pick<CreditRow, 'reason'>>(rows: T[]): T[] {
  return rows.filter((r) => r.reason !== 'cash');
}

/** What a seat's payment looks like right now, for `seatCredit`. */
export interface SeatLike {
  paymentStatus: string;
  paidAt: string | null;
  refundedAt: string | null;
}

/** The credit pot's part of one seat. */
export interface SeatCredit {
  /** Credit from the pot used on this seat. */
  usedCents: number;
  /** Cash paid toward this seat before its price went up (counts like credit used, but is not credit). */
  cashCents: number;
  /** Money that came back from this seat as credit, and why. */
  backCents: number;
  backReason: CreditReason | null;
  /** Of `backCents`, what finalizing gave back (paid above the final price, or did not play). */
  finalizedBackCents: number;
}

export const NO_SEAT_CREDIT: SeatCredit = { usedCents: 0, cashCents: 0, backCents: 0, backReason: null, finalizedBackCents: 0 };

/**
 * One seat's live ledger rows, read the way the screens need them. Money
 * that came back counts against the payment it came from: a seat that is
 * paid again (after a drop and a return, or a cancel and a reopen) only
 * counts what came back from its current payment, which can only be the
 * part above the final price (everything else settles the seat first); a
 * settled or unpaid seat counts them all ("Your $28 is now credit").
 */
export function seatCredit(rows: CreditRow[], sessionId: string, playerId: string, seat: SeatLike): SeatCredit {
  const all = rows.filter((r) => r.sessionId === sessionId && r.playerId === playerId);
  const mine = all.filter((r) => !r.endedAt);
  const used = mine.filter((r) => r.kind === 'used' && r.reason !== 'cash').reduce((sum, r) => sum + r.cents, 0);
  const cash = mine.filter((r) => r.kind === 'used' && r.reason === 'cash').reduce((sum, r) => sum + r.cents, 0);
  const current = seat.paymentStatus === 'paid' && !seat.refundedAt;
  const backs = mine.filter((r) => r.kind === 'kept' && r.reason !== 'cash' && (!current || r.reason === 'finalized'));
  // Credit used on the seat that went back to the player (they dropped out, or the game was canceled) came back too.
  // A return no longer counts once that credit went on the seat again (a rejoin used it): after drop, rejoin and
  // drop it is the same money, so it counts once. Rows are in the order they were written, so ties in time are safe.
  const isReturn = (r: CreditRow) => r.kind === 'used' && r.reason !== 'cash' && (r.endedReason === 'dropped' || r.endedReason === 'canceled') && !!r.endedAt;
  const returned = current
    ? []
    : all.filter((r, i) => isReturn(r) && !all.some((x, j) => j > i && x.kind === 'used' && x.reason !== 'cash' && x.createdAt >= r.endedAt!));
  const backReason = backs[0]?.reason ?? (returned[0]?.endedReason as CreditReason | undefined) ?? null;
  return {
    usedCents: used,
    cashCents: cash,
    backCents: backs.reduce((sum, r) => sum + r.cents, 0) + returned.reduce((sum, r) => sum + r.cents, 0),
    backReason,
    finalizedBackCents: backs.filter((r) => r.reason === 'finalized' || r.reason === 'not_played').reduce((sum, r) => sum + r.cents, 0),
  };
}

/** Credit spent on each unpaid or paid seat, keyed `${sessionId}:${playerId}`. */
export function usedBySeat(rows: CreditRow[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of live(rows)) {
    if (r.kind !== 'used' || !r.sessionId) continue;
    const k = seatKey(r.sessionId, r.playerId);
    out.set(k, (out.get(k) ?? 0) + r.cents);
  }
  return out;
}

/** The live "kept" row for each seat. */
export function keptBySeat(rows: CreditRow[]): Map<string, CreditRow> {
  const out = new Map<string, CreditRow>();
  for (const r of live(rows)) if (r.kind === 'kept' && r.sessionId) out.set(seatKey(r.sessionId, r.playerId), r);
  return out;
}

/**
 * What is still owed from each "kept" row, oldest first: whatever was spent or
 * paid back came off the oldest credit first. This is how the pot is split
 * across months for the monthly page.
 */
export function keptRemaining(rows: CreditRow[]): Map<string, number> {
  const out = new Map<string, number>();
  const byPlayer = new Map<string, CreditRow[]>();
  for (const r of live(rows)) byPlayer.set(r.playerId, [...(byPlayer.get(r.playerId) ?? []), r]);
  for (const list of byPlayer.values()) {
    let taken = list.filter((r) => r.kind !== 'kept').reduce((sum, r) => sum - potEffect(r), 0);
    const kept = list.filter((r) => r.kind === 'kept').sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    for (const k of kept) {
      const eat = Math.min(k.cents, Math.max(0, taken));
      taken -= eat;
      out.set(k.id, k.cents - eat);
    }
  }
  return out;
}

// ---------- What a player reads about their credit ----------
// Short and exact. "left" always means credit left; "left to pay" is what they still owe.

/** The pop-up after a player taps Use credit. */
export function creditUsedMessage(usedCents: number, potBeforeCents: number, owedBeforeCents: number): string {
  const leftCredit = potBeforeCents - usedCents;
  const leftToPay = owedBeforeCents - usedCents;
  if (leftToPay > 0) return `Used ${formatPrice(usedCents)} credit. ${formatPrice(leftToPay)} left to pay.`;
  return leftCredit > 0
    ? `Used ${formatPrice(usedCents)} of your ${formatPrice(potBeforeCents)} credit. ${formatPrice(leftCredit)} left.`
    : 'Paid with credit. No credit left.';
}

/** The small gray line beside the Use credit button, before they tap it. */
export function creditHintText(useCents: number, potCents: number, oweCents: number): string {
  if (useCents >= oweCents) return useCents === potCents ? `Uses your ${formatPrice(potCents)} credit` : `Uses ${formatPrice(useCents)} of your ${formatPrice(potCents)} credit`;
  return `Uses your ${formatPrice(useCents)} credit. ${formatPrice(oweCents - useCents)} left to pay`;
}

/** The line under a game they still owe for after some credit came off it. */
export function creditOweText(oweCents: number, creditCents: number): string {
  return `${formatPrice(oweCents)} left to pay. ${formatPrice(creditCents)} credit used.`;
}

/**
 * One line of credit history, the same for the player's sheet and the
 * organizer: "+$5 Thu, Oct 29 (6 played)", "-$14 used for Tue, Nov 3",
 * "+$14 canceled Thu, Nov 5", "-$14 refunded" (a player's sheet: "-$14 cashed out").
 */
export function creditEntryText(e: Pick<CreditEntryView, 'kind' | 'cents' | 'sessionStartsAt' | 'reason' | 'playedCount'>, tz: string, forPlayer = false): string {
  const money = formatPrice(e.cents);
  const day = e.sessionStartsAt ? formatShortDate(e.sessionStartsAt, tz) : null;
  if (e.kind === 'used') return `-${money} used${day ? ` for ${day}` : ''}`;
  // The organizer's screens say refunded; the player's own sheet says cashed out.
  if (e.kind === 'refunded') return `-${money} ${forPlayer ? 'cashed out' : 'refunded'}`;
  switch (e.reason) {
    case 'finalized':
      return `+${money}${day ? ` ${day}` : ''}${e.playedCount ? ` (${e.playedCount} played)` : ''}`;
    case 'not_played':
      return `+${money}${day ? ` ${day}` : ''} (did not play)`;
    case 'dropped':
      return `+${money} dropped out${day ? ` of ${day}` : ''}`;
    case 'canceled':
      return `+${money} canceled${day ? ` ${day}` : ''}`;
    default:
      return `+${money} kept${day ? ` from ${day}` : ''}`;
  }
}

/**
 * The Finalize card's warning when someone tapped "I paid" and the organizer
 * has not confirmed it: finalizing counts it as paid (credit back included).
 * "Mitchel tapped I paid, not confirmed yet. Confirm or finalize anyway."
 */
export function unconfirmedPaidWarning(names: string[]): string | null {
  if (names.length === 0) return null;
  const who = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  return `${who} tapped I paid, not confirmed yet. Confirm or finalize anyway.`;
}

/** Why Reopen waits: a pending refund request is holding credit this game gave back. */
export const reopenRequestedReason = (names: string[]) =>
  `Can't reopen: ${names.join(' and ')} asked for this credit back. Answer the refund request on Home first.`;
