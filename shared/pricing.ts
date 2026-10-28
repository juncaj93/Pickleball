import type { GroupSettings } from './settings';

// What each player owes for a session.
//
// Everyone confirmed pays the flat price. When exactly 6 are confirmed, the
// last two to get a spot (the ones the 6th brought in) pay the price minus
// the credit ("6-person discount"), and the first four will each earn that
// credit once the session has been played with 6. If the count drops below
// 6, everyone is back to the flat price.

export interface Seat {
  playerId: string;
  /** Order in which they got their spot. */
  seq: number;
}

export interface SeatPrice {
  cents: number;
  /** Last two of six: paying the discounted price. */
  discount: boolean;
  /** First four of six: will earn a credit if 6 play. */
  creditComing: boolean;
}

export function seatPrices(confirmed: Seat[], settings: GroupSettings, canceled: boolean): Map<string, SeatPrice> {
  const out = new Map<string, SeatPrice>();
  if (canceled) return out;
  const ordered = [...confirmed].sort((a, b) => a.seq - b.seq);
  const six = ordered.length === 6 && settings.creditCentsWhenSix > 0;
  ordered.forEach((s, i) => {
    if (six && i >= 4) {
      out.set(s.playerId, { cents: Math.max(0, settings.pricePerPlayerCents - settings.creditCentsWhenSix), discount: true, creditComing: false });
    } else {
      out.set(s.playerId, { cents: settings.pricePerPlayerCents, discount: false, creditComing: six });
    }
  });
  return out;
}

export interface OpenCredit {
  id: string;
  playerId: string;
  amountCents: number;
  /** When the session that earned it ended; it only applies to later sessions. */
  earnedAfter: string;
}

export interface Due {
  sessionId: string;
  playerId: string;
  startsAt: string;
  cents: number;
}

/**
 * Put each open credit on the player's earliest unpaid session that starts
 * after the credit was earned. A credit is used whole, never split, and a
 * session can take more than one if the amount allows.
 * Returns credit per `${sessionId}:${playerId}`.
 */
export function allocateCredits(credits: OpenCredit[], dues: Due[]): Map<string, { cents: number; ids: string[] }> {
  const out = new Map<string, { cents: number; ids: string[] }>();
  const byPlayer = new Map<string, Due[]>();
  for (const d of dues) byPlayer.set(d.playerId, [...(byPlayer.get(d.playerId) ?? []), d]);
  for (const list of byPlayer.values()) list.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const left = new Map(dues.map((d) => [`${d.sessionId}:${d.playerId}`, d.cents]));
  for (const c of [...credits].sort((a, b) => a.earnedAfter.localeCompare(b.earnedAfter) || a.id.localeCompare(b.id))) {
    for (const d of byPlayer.get(c.playerId) ?? []) {
      const key = `${d.sessionId}:${d.playerId}`;
      if (d.startsAt < c.earnedAfter || (left.get(key) ?? 0) < c.amountCents) continue;
      left.set(key, (left.get(key) ?? 0) - c.amountCents);
      const cur = out.get(key) ?? { cents: 0, ids: [] };
      out.set(key, { cents: cur.cents + c.amountCents, ids: [...cur.ids, c.id] });
      break;
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
