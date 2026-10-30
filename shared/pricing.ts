import { MIN_PLAYERS } from './spots';

// What each player owes for a session.
//
// Before the game is finalized, everyone who is in owes the flat price (the
// "$14 each" setting). After the organizer finalizes who played, the final
// price is 4 x price divided by the number who played, rounded down to whole
// dollars, never more than the flat price. Whatever someone paid above that
// comes back as credit (server/finalize.ts). Someone who did not play owes
// nothing, and what they paid comes back in full.

/**
 * The final price per player once N played: floor(4 x price / N) to whole
 * dollars, never above the flat price. Fewer than 4 (should not happen, but
 * "Finalize anyway" allows it) means the flat price.
 */
export function finalPrice(priceCents: number, played: number): number {
  if (played < MIN_PLAYERS) return priceCents;
  const raw = Math.floor((4 * priceCents) / played);
  const wholeDollars = Math.floor(raw / 100) * 100;
  return Math.min(priceCents, wholeDollars);
}

/** The credit back per player who paid the flat price: flat price minus the final price. */
export function creditBack(priceCents: number, played: number): number {
  return Math.max(0, priceCents - finalPrice(priceCents, played));
}

/**
 * The gray note under "I'm in": "If 6 play, you get $5 back as credit."
 * `confirmedCount` is who is in now, so the person reading would be number
 * `confirmedCount + 1`. Empty (null) unless that is 5th or later, there is
 * room (not at the max), and the table gives them something back.
 */
export function creditBackNote(priceCents: number, confirmedCount: number, maxPlayers: number, fmt: (cents: number) => string): string | null {
  const n = confirmedCount + 1;
  if (n < MIN_PLAYERS + 1 || n > maxPlayers) return null;
  const back = creditBack(priceCents, n);
  return back > 0 ? `If ${n} play, you get ${fmt(back)} back as credit.` : null;
}

/**
 * The flat price a finalized game was played at, for the post-game note
 * ("If you paid $14, the extra $5 ..."). The setting can change after the
 * game, so it comes from what the players who played actually paid (the most
 * common amount). With no payments to go on, the current setting when it still
 * gives this final price, else the lowest whole-dollar price that does.
 */
export function flatAtFinalize(paidCents: number[], currentCents: number, played: number, finalCents: number): number {
  const counts = new Map<number, number>();
  for (const c of paidCents) if (c > 0) counts.set(c, (counts.get(c) ?? 0) + 1);
  if (counts.size) return [...counts].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0][0];
  if (finalPrice(currentCents, played) === finalCents) return currentCents;
  for (let c = finalCents; c <= finalCents + 100_00; c += 100) if (finalPrice(c, played) === finalCents) return c;
  return currentCents;
}

/** "6 played · $9 each · $5 credit back each" (the preview on the Finalize card). */
export function finalPreview(priceCents: number, played: number, fmt: (cents: number) => string): string {
  const p = finalPrice(priceCents, played);
  const back = creditBack(priceCents, played);
  return `${played} played · ${fmt(p)} each${back > 0 ? ` · ${fmt(back)} credit back each` : ''}`;
}

export interface Seat {
  playerId: string;
  /** Set once finalized: 1 played, 0 did not. */
  played: number | null;
}

export interface SeatPrice {
  cents: number;
}

/**
 * The price on each confirmed seat: the flat price until finalized, then the
 * final price for those who played (and nothing for those who did not).
 * Nobody owes for a canceled game.
 */
export function seatPrices(confirmed: Seat[], priceCents: number, canceled: boolean, final: { priceCents: number } | null): Map<string, SeatPrice> {
  const out = new Map<string, SeatPrice>();
  if (canceled) return out;
  for (const s of confirmed) {
    if (final) {
      if (s.played === 1) out.set(s.playerId, { cents: final.priceCents });
    } else {
      out.set(s.playerId, { cents: priceCents });
    }
  }
  return out;
}

// The organizer pays the venue the full court cost. The other players'
// payments reimburse them, so the organizer's own share is what is left.

export interface CourtSplit {
  /** What the other players owe (or paid) for this session, after any credit. */
  playersCoverCents: number;
  /** The organizer's own share: court cost minus what players cover, never below 0. */
  yourShareCents: number;
  /** Players cover the whole court or more. */
  covered: boolean;
}

export function courtSplit(courtCostCents: number, otherPlayerCents: number[]): CourtSplit {
  const cover = otherPlayerCents.reduce((sum, c) => sum + Math.max(0, c), 0);
  return { playersCoverCents: cover, yourShareCents: Math.max(0, courtCostCents - cover), covered: cover >= courtCostCents };
}
