// "Late drops owe $14" (LATE_FEES, Alex's rules of Mon Nov 2, 2026). The court needs 4 people paying. Someone who
// drops late (inside the 12 hours before the start) or does not play only owes their $14 when their absence leaves
// the game SHORT of 4. If 4 or more are still playing, nobody who sat out owes anything.
//
// No new table or column: a debt lives on the person's own seat row (session_players), with columns that already
// exist. Three kinds:
//   late_drop      the seat left inside the 12 hours and the game fell below 4 (waitlist counted): status 'withdrawn',
//                  played = 0, late_drop_at set. Their money STAYS on the game (cash stays paid, credit stays spent;
//                  an unpaid seat stays 'unpaid' = owes). Only this switch's code ever writes played on a withdrawn seat.
//   no_show        marked "did not play" at Finalize with fewer than 4 played: status 'confirmed', played = 0, and
//                  late_drop_at equal to the game's finalized_at (an exact match, so an old leftover never counts).
//   canceled_late  the organizer canceled inside the 12 hours and the venue did NOT waive the fee: every seat that
//                  was in a game with canceled_by = 'organizer_fee_kept'.
// A debt is open while late_drop_done_at is empty and the seat still holds its payment (unpaid = owes, or paid and not
// handed back = paid). "Clear" (a sub took the spot, the venue waived it, or the organizer's choice) sets
// late_drop_done_at and gives the money back as credit the same way a drop or cancel does. A clear is final.
// The organizer is treated like any player for a late drop (Alex, Nov 2): their own drop inside the 12 hours that
// leaves the game short is a debt too, shown on Money and Home and cleared in one tap. Their seat's payment fields mean
// "court paid", so their debt never reads a payment: it is simply owed until a sub or Clear ends it. They never owe on a
// late cancel or as a no-show (they pay the venue).

import { finalPrice } from './pricing';

/** sessions.canceled_by for "Did the venue waive the fee?" answered No: no money moved, everyone signed up still owes. */
export const FEE_KEPT = 'organizer_fee_kept';

// ---------- "Late-cancel fee split" (LATE_FEE_SPLIT, Alex, Nov 4) ----------
// A cancel inside the 12 hours with the venue fee kept used to leave everyone signed up owing the flat $14, which
// over-collects with 5 or more in (6 in: 5 others x $14 = $70 for a $48 court). With the split on, each person signed up
// at the moment of the cancel owes the SAME price a played game would have: finalPrice(flat, N), N = everyone confirmed
// (the organizer counted when they are in, as Finalize counts them), never above the flat price. 4 or fewer: unchanged.
// Someone who already put more than that on the seat gets the difference back as credit at once.
// Stored with no schema change: sessions.final_price_cents (the split price) and final_played_count (N) on the canceled
// game. Every other reader of those two columns only reads them when finalized_at is set, and a canceled game is never
// finalized, so nothing else sees them. Late drops, no-shows, subs and the waived answer are untouched.

/** The phone-only test switch header (/admin?latefeesplit=on): only the organizer's cancel uses it. */
export const LATE_FEE_SPLIT_HEADER = 'X-Late-Fee-Split';

/** The LATE_FEE_SPLIT kill switch (a wrangler.toml var): allowed unless it says "off". Who gets it is Settings' call. */
export function lateFeeSplitAllowed(flag: string | undefined | null): boolean {
  return (flag ?? 'on').trim().toLowerCase() !== 'off';
}

/** The split price for a fee-kept cancel with `signedUp` in, or null when it changes nothing (4 or fewer, or no lower price). */
export function feeSplitPrice(flatCents: number, signedUp: number): number | null {
  if (signedUp <= FEE_MIN_PLAYERS) return null;
  const p = finalPrice(flatCents, signedUp);
  return p < flatCents ? p : null;
}

export interface SplitGame {
  status: string;
  canceled_by: string | null;
  finalized_at: string | null;
  final_price_cents?: number | null;
  final_played_count?: number | null;
}

/** The split on a game canceled late with the fee kept: { count, priceCents }, or null (not split). */
export function feeSplitOf(game: SplitGame): { count: number; priceCents: number } | null {
  if (game.status !== 'canceled' || game.canceled_by !== FEE_KEPT || game.finalized_at) return null;
  if (game.final_price_cents === null || game.final_price_cents === undefined) return null;
  return { count: game.final_played_count ?? 0, priceCents: game.final_price_cents };
}

/** What an open late fee costs: the split price for a seat in a split fee-kept cancel, the flat price for every other kind. */
export function lateFeePriceCents(kind: LateFeeKind | null, game: SplitGame, flatCents: number): number {
  if (kind === 'canceled_late') return feeSplitOf(game)?.priceCents ?? flatCents;
  return flatCents;
}

/** Fewer than this many playing means someone who sat out owes. */
export const FEE_MIN_PLAYERS = 4;

/** The cancel-by clock for late fees: start minus 12 hours (the same clock as the cards, shared/time.ts cancelByIso). */
export const LATE_FEE_HOURS = 12;

/** The phone-only test switch: the page sends this header when the phone opened the site with ?latefees=on. */
export const LATE_FEES_HEADER = 'X-Late-Fees';

/** The LATE_FEES kill switch (a wrangler.toml var): allowed unless it says "off". Who gets it is Settings' call. */
export function lateFeesAllowed(flag: string | undefined | null): boolean {
  return (flag ?? 'on').trim().toLowerCase() !== 'off';
}

export type LateFeeKind = 'late_drop' | 'no_show' | 'canceled_late';

/** Why the organizer cleared a debt (each gets a History line). */
export type LateFeeClearWhy = 'sub' | 'venue' | 'choice';

export interface FeeSeat {
  status: string;
  played: number | null;
  late_drop_at: string | null;
  late_drop_done_at: string | null;
  payment_status: string;
  refunded_at: string | null;
}

export interface FeeGame {
  status: string;
  canceled_by: string | null;
  finalized_at: string | null;
}

/**
 * The open late fee on a seat, or null. Mirrors OPEN_FEE in server/lateFees.ts exactly (tests check both agree).
 * The organizer's own seat is never a debt: pass `isOrganizer`.
 */
export function lateFeeKind(seat: FeeSeat, game: FeeGame, isOrganizer = false): LateFeeKind | null {
  if (seat.late_drop_done_at) return null;
  if (isOrganizer) return seat.status === 'withdrawn' && seat.played === 0 && seat.late_drop_at ? 'late_drop' : null;
  const holds = seat.payment_status === 'unpaid' || (seat.payment_status === 'paid' && !seat.refunded_at);
  if (!holds) return null;
  if (seat.status === 'withdrawn' && seat.played === 0 && seat.late_drop_at) return 'late_drop';
  if (seat.status === 'confirmed' && game.status === 'canceled' && game.canceled_by === FEE_KEPT) return 'canceled_late';
  if (seat.status === 'confirmed' && game.status !== 'canceled' && seat.played === 0 && !!game.finalized_at && seat.late_drop_at === game.finalized_at) return 'no_show';
  return null;
}

/** The words in brackets on the player's Pay card and the organizer's Money row. */
export function lateFeeLabel(kind: LateFeeKind): string {
  return kind === 'late_drop' ? 'late drop' : kind === 'no_show' ? 'did not play' : 'canceled late';
}

/** The organizer's Money row note. */
export function lateFeeAdminNote(kind: LateFeeKind): string {
  return kind === 'canceled_late' ? 'canceled, fee not waived' : kind === 'no_show' ? 'did not play' : 'late drop';
}

/** The three ways the organizer can clear one, in the order the sheet shows them. */
export const CLEAR_CHOICES: { why: LateFeeClearWhy; label: string }[] = [
  { why: 'sub', label: 'Sub found' },
  { why: 'venue', label: 'Venue waived' },
  { why: 'choice', label: 'My choice' },
];

export function clearWhyText(why: LateFeeClearWhy): string {
  return CLEAR_CHOICES.find((c) => c.why === why)?.label ?? 'Cleared';
}

/** True when a drop by someone who is in now would leave fewer than 4 (anyone on the waitlist moves in, so they count). */
export function dropLeavesShort(confirmedCount: number, waitlistCount: number): boolean {
  return confirmedCount - 1 + waitlistCount < FEE_MIN_PLAYERS;
}

/** The start minus 12 hours, in ms: inside it a drop is late. */
export function lateFeeCutoffMs(startsAtIso: string): number {
  return Date.parse(startsAtIso) - LATE_FEE_HOURS * 3_600_000;
}

/**
 * The drop dialog's words, past the cancel-by time with the switch on. `time` is "8:00 AM".
 * Owes: "It's past the 8:00 AM cancel-by. If no one takes your spot, you still owe $14."
 * Not short: the money comes back as credit (or nothing is owed when nothing was paid).
 */
export function lateDropDialogText(time: string, owes: boolean, feeText: string, moneyBackText: string | null): string {
  if (owes) return `It's past the ${time} cancel-by. If no one takes your spot, you still owe ${feeText}.`;
  return moneyBackText ? `It's past the ${time} cancel-by. Enough players are still in, so ${moneyBackText}.` : `It's past the ${time} cancel-by. Enough players are still in, so you owe nothing.`;
}

/** The drop banner when the drop leaves the game short. */
export function lateDropToast(feeText: string, paid: boolean): string {
  return paid ? `You're out. Your ${feeText} stays on this game unless someone takes your spot.` : `You're out. You owe ${feeText} unless someone takes your spot.`;
}

/**
 * The notice a player sees once their debt is cleared (until they dismiss it). `day` is "Tue, Nov 3".
 * Sub: "Good news: someone took your spot for Tue, Nov 3. You no longer owe $14." (paid: "... Your $14 is back as credit.")
 * The organizer (venue waived, my choice, or the game was canceled): "You no longer owe $14 for Tue, Nov 3."
 */
export function feeClearedNotice(why: 'sub' | 'cleared', day: string, feeText: string, creditText: string | null): string {
  if (why === 'sub') return `Good news: someone took your spot for ${day}. ${creditText ? `Your ${creditText} is back as credit.` : `You no longer owe ${feeText}.`}`;
  return `You no longer owe ${feeText} for ${day}.${creditText ? ` Your ${creditText} is back as credit.` : ''}`;
}
