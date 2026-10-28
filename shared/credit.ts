// The credit pot: money a player paid for a game that was canceled (or that
// they dropped out of), kept as credit for any later game. One pot per player.
// The older $5 credits (shared/pricing.ts) are a separate list and keep their
// own rules; the pot only adds to what a player has.
//
// Pure functions over the ledger rows, so the server and the tests share them.

export type CreditKind = 'kept' | 'used' | 'refunded';

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
  /** For a refund: how much of `cents` came from the older $5 credits, not this pot. */
  fiveCents: number;
  /** The game it came from (kept) or went to (used). */
  sessionId: string | null;
  createdAt: string;
  /** Undone, or went back to the player. An ended row no longer counts. */
  endedAt: string | null;
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
