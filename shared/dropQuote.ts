// Zip 51 (Audit C F-16): the Drop out dialog can be a few seconds old. The phone sends the money it SHOWED when the player tapped Drop out
// (this "quote"), the server works the same quote out again from the data as it is now, and only drops the seat when the two agree. When
// they differ nothing happens: the answer is 409 "drop_changed", the phone reloads and opens the dialog again with the real words, and the
// player decides again. A drop is never charged at an amount the screen did not show.
//
// The quote is built from the very fields the dialog and the drop toast read (PlayerSessionView.mine), so both sides agree by construction:
//  - waiting or in (leaving the waitlist moves no money, but the words differ);
//  - inside the late window or not, whether the drop owes, the amount the words name, and whether it reads "stays" or "owe";
//  - for a host with a guest, how many spots the drop leaves short (0, 1 or 2) and whether the guest is in or waiting;
//  - what comes back as credit, and an unconfirmed I paid the drop would leave for the organizer.
// The cancel-by time and every other word are left out on purpose: they change no money.

export interface DropQuoteSeat {
  status: string;
  dropCreditCents: number;
  dropCashCents: number;
  dropClaimCents: number;
  lateDrop?: { owes: boolean; paid: boolean; feeCents: number; guestSpots?: number } | undefined;
  guest?: { status: string } | undefined;
}

/** The quote for one seat ("in|late:owes:1400:stays|spots:-|back:0|claim:0|guest:-"). Null: not in the game (nothing to drop). */
export function dropQuote(mine: DropQuoteSeat | null | undefined): string | null {
  if (!mine || (mine.status !== 'confirmed' && mine.status !== 'waitlisted')) return null;
  const l = mine.lateDrop;
  const late = l ? `late:${l.owes ? 'owes' : 'free'}:${l.owes ? l.feeCents : 0}:${l.owes ? (l.paid ? 'stays' : 'owe') : '-'}` : 'early';
  const spots = l && l.guestSpots !== undefined ? String(l.guestSpots) : '-';
  const back = mine.dropCreditCents + mine.dropCashCents;
  return [mine.status === 'waitlisted' ? 'waiting' : 'in', late, `spots:${spots}`, `back:${back}`, `claim:${mine.dropClaimCents}`, `guest:${mine.guest?.status ?? '-'}`].join('|');
}

/** The answer's code when the quote no longer matches (the phone looks for it). */
export const DROP_CHANGED = 'drop_changed';
export const DROP_CHANGED_MESSAGE = 'This just changed. Look again.';

/** A quote as the request carries it: a short plain string, or nothing (an older page sends none and is checked as before). */
export function quoteOfBody(body: Record<string, unknown> | null | undefined): string | null {
  const q = body?.quote;
  return typeof q === 'string' && q.length > 0 && q.length <= 200 ? q : null;
}
