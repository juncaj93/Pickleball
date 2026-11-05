// "Adjust credit" (ADJUST_CREDIT, Nov 2026): the organizer adds or removes credit on one player's pot by hand, with a required reason.
// It uses the credit ledger that already exists (no new table or column):
//   Add     one 'kept' entry, no game, reason "adjusted:<why>"
//   Remove  one 'used' entry, no game, reason "adjusted:<why>"
// so the pot, "Use credit", final price, refunds and cash outs all keep working off the same rows. Whole dollars only.
// Pure rules here so the server and the screens say the same words.

import type { CreditEntryView } from './api';
import { formatPrice } from './money';

/** The phone-only test switch: the page sends this header when the phone opened /admin with ?adjustcredit=on. */
export const ADJUST_CREDIT_HEADER = 'X-Adjust-Credit';

/** The ADJUST_CREDIT kill switch (a wrangler.toml var): allowed unless it says "off". Who gets it is Settings' call. */
export function adjustCreditAllowed(flag: string | undefined | null): boolean {
  return (flag ?? 'on').trim().toLowerCase() !== 'off';
}

/** What the ledger's free-text `reason` column starts with for an adjustment. */
export const ADJUST_PREFIX = 'adjusted:';

/** Biggest single adjustment, and the longest reason. */
export const ADJUST_MAX_CENTS = 50_000;
export const ADJUST_REASON_MAX = 120;
/** The amount chips on the sheet. */
export const ADJUST_CHIPS = [500, 1000, 1400] as const;

/** The ledger `reason` text for an adjustment with this (already cleaned) note. */
export function adjustReasonColumn(note: string): string {
  return `${ADJUST_PREFIX}${note}`;
}

/** If a ledger reason is an adjustment, its note (maybe empty); otherwise null. */
export function adjustNoteOf(raw: string | null | undefined): string | null {
  return typeof raw === 'string' && raw.startsWith(ADJUST_PREFIX) ? raw.slice(ADJUST_PREFIX.length) : null;
}

/** A typed reason, cleaned: one line, single spaces, trimmed, cut to the limit. */
export function cleanReason(input: unknown): string {
  return typeof input === 'string' ? input.replace(/\s+/g, ' ').trim().slice(0, ADJUST_REASON_MAX) : '';
}

export type AdjustDirection = 'add' | 'remove';

export interface AdjustInput {
  direction: AdjustDirection;
  /** The amount box as typed ("5", "$5", "14"), or already cents with `cents`. */
  cents: number | null;
  reason: string;
  /** The pot now, and what a pending refund request holds back of it. */
  potCents: number;
  reservedCents: number;
  /** The player's name, for the messages ("Can't remove more than the $14 credit Mitchel has."). */
  name: string;
}

export type AdjustPlan = { ok: true; deltaCents: number; afterCents: number } | { ok: false; error: string };

/**
 * Can this adjustment be saved, and what is the credit after it? The one rule set both the sheet and the server use.
 *  - the amount is a positive whole-dollar amount (at most $500);
 *  - the reason is filled in;
 *  - Remove never goes below $0 (and never takes credit a pending cash-out request is holding).
 */
export function planAdjust(i: AdjustInput): AdjustPlan {
  const c = i.cents;
  if (c === null || !Number.isInteger(c) || c <= 0 || c % 100 !== 0) return { ok: false, error: 'Enter a whole-dollar amount above $0, like 5.' };
  if (c > ADJUST_MAX_CENTS) return { ok: false, error: `The most you can change at once is ${formatPrice(ADJUST_MAX_CENTS)}.` };
  if (i.direction === 'remove') {
    const usable = Math.max(0, i.potCents - Math.max(0, i.reservedCents));
    if (c > usable) {
      return {
        ok: false,
        error:
          i.reservedCents > 0 && c <= i.potCents
            ? `Can't remove ${formatPrice(c)}: ${formatPrice(i.reservedCents)} of ${i.name}'s credit is held for a cash-out request.`
            : `Can't remove more than the ${formatPrice(usable)} credit ${i.name} has.`,
      };
    }
  }
  if (!cleanReason(i.reason)) return { ok: false, error: 'Say why. The player will see this.' };
  const delta = i.direction === 'add' ? c : -c;
  return { ok: true, deltaCents: delta, afterCents: i.potCents + delta };
}

/** "+$5" or "-$5". */
export const signedPrice = (deltaCents: number) => `${deltaCents < 0 ? '-' : '+'}${formatPrice(Math.abs(deltaCents))}`;

/** The player's line: "Credit adjusted by organizer: +$5". */
export function adjustedPlayerLine(deltaCents: number): string {
  return `Credit adjusted by organizer: ${signedPrice(deltaCents)}`;
}

/** Adjustments newer than this show on the player's pay card. */
export const ADJUST_NOTE_DAYS = 14;

/**
 * The newest adjustment still in force that is recent enough to mention on the player's screen: "Credit adjusted by organizer: +$5" with
 * the reason. Only the player's own history is passed in. Null when there is none (so nothing extra shows).
 */
export function latestAdjustment(history: Pick<CreditEntryView, 'kind' | 'cents' | 'reason' | 'note' | 'at' | 'endedAt'>[], nowMs: number): { deltaCents: number; note: string; at: string } | null {
  const mine = history.filter((e) => e.reason === 'adjusted' && !e.endedAt && nowMs - Date.parse(e.at) < ADJUST_NOTE_DAYS * 86_400_000);
  if (mine.length === 0) return null;
  const e = mine.reduce((a, b) => (b.at >= a.at ? b : a));
  return { deltaCents: e.kind === 'kept' ? e.cents : -e.cents, note: e.note ?? '', at: e.at };
}
