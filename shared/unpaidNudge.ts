// Zip 17 (Nov 2026): UNPAID_NUDGE, ships OFF. Friends who sign up and pay late (or never) see a running balance and, at the limit,
// cannot sign up for a new game until they pay. Alex pays the court, so this keeps the money in front of them.
//
//  - The owe card at the top of the player page keeps its place and its buttons (Pay, I paid, Use credit) with new words:
//    "You owe $14" / "For Tue, Nov 3", or "You owe $28" / "$14 each: Nov 3 and Nov 5" (one line, never wraps).
//  - 1 or 2 unpaid games: I'm in signs up as always, then a longer toast: "You're in!" / "Please pay the $28 you still owe for your
//    2 previous games." with a Pay button that opens the Pay sheet.
//  - UNPAID_LIMIT (3) or more: the I'm in button looks dimmed; a tap opens a bottom sheet ("You owe $42" / "For your last 3 games. Once
//    it's paid, you can sign up again." / Pay $42 / Not now). The SERVER refuses the sign-up itself (server/unpaidNudge.ts), on every
//    player sign-up path. Drop out, Pay, I paid, Use credit and everything else stay allowed. The organizer is never blocked, and the
//    organizer's own "add a player" still works for anyone.
//
// One count, from the site's own owed money (GroupView.owed: server/owed.ts, the same numbers the owe card shows). Nothing new is
// stored: a wrangler.toml kill switch, a Settings > Feature switches row (one task_log row) and a per-phone test link (?nudge=on).

import type { LateFeeKind } from './lateFees';
import { formatPrice } from './money';
import { formatMonthDay, formatShortDate } from './time';

export const UNPAID_NUDGE = { task: 'unpaid_nudge_on', header: 'X-Unpaid-Nudge', link: 'nudge', env: 'UNPAID_NUDGE', name: 'Unpaid nudge' } as const;

/** The limit Alex approved: this many unpaid games or more and a new sign-up waits until they pay. Change it here (one place). */
export const UNPAID_LIMIT = 3;

/** How long the "You're in! Please pay..." toast stays (the site's usual confirmation stays 3 seconds with Animations on, 1.5 without). */
export const NUDGE_TOAST_MS = 8000;

/** A wrangler.toml kill switch: allowed unless it says "off". Who gets it is Settings' call. */
export function nudgeAllowed(flag: string | undefined | null): boolean {
  return (flag ?? 'on').trim().toLowerCase() !== 'off';
}

/** One owed game, as GroupView.owed has it (only the parts the count reads). */
export interface OwedGame {
  sessionId: string;
  startsAt: string;
  endsAt: string;
  amountCents: number;
  finalized: boolean;
  lateFee?: LateFeeKind;
}

/**
 * The unpaid games: owed games that are over. "Over" is: the game ended, or it was finalized, or it carries a fee that is owed now
 * (a game canceled late, or a no-show). An upcoming game they just signed up for (and a late drop before that game is over) does not
 * count. Credit used on a seat is already taken off its amount (a game fully paid with credit is not owed at all). An "I paid" that
 * Alex has not confirmed yet counts as paid, the same as the owe card (the seat is marked paid at that tap). Oldest first.
 */
export function unpaidGames<T extends OwedGame>(owed: readonly T[], nowMs: number): T[] {
  return owed
    .filter((o) => o.amountCents > 0 && (o.finalized || Date.parse(o.endsAt) <= nowMs || o.lateFee === 'canceled_late' || o.lateFee === 'no_show'))
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
}

export interface NudgeState<T extends OwedGame = OwedGame> {
  games: T[];
  count: number;
  cents: number;
  /** At or over the limit: a new sign-up waits until they pay. */
  blocked: boolean;
}

export function nudgeState<T extends OwedGame>(owed: readonly T[], nowMs: number, limit = UNPAID_LIMIT): NudgeState<T> {
  const games = unpaidGames(owed, nowMs);
  return { games, count: games.length, cents: games.reduce((sum, o) => sum + o.amountCents, 0), blocked: games.length >= limit };
}

// ---------- The words ----------

/** The owe card's title: "You owe $28". */
export function oweTitle(cents: number): string {
  return `You owe ${formatPrice(cents)}`;
}

/** More dates than this and the line says how many games instead of listing them (it must stay on one line). */
const MAX_DATES = 4;

/**
 * The owe card's second line. One game: "For Tue, Nov 3". Several: "$14 each: Nov 3 and Nov 5" (same amounts), "Nov 3 and Nov 5" (amounts
 * differ), "$14 each: Nov 3, 5 and 10" (three or more in one month: the month only when it changes), "$14 each: 5 games since Oct 29" (more
 * than four). Always one line.
 */
export function oweLine(due: readonly { startsAt: string; amountCents: number }[], tz: string): string {
  if (due.length === 0) return '';
  const sorted = [...due].sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  if (sorted.length === 1) return `For ${formatShortDate(sorted[0].startsAt, tz)}`;
  const same = sorted.every((o) => o.amountCents === sorted[0].amountCents);
  const lead = same ? `${formatPrice(sorted[0].amountCents)} each: ` : '';
  if (sorted.length > MAX_DATES) return `${lead}${sorted.length} games since ${formatMonthDay(sorted[0].startsAt, tz)}`;
  const parts = sorted.map((o) => formatMonthDay(o.startsAt, tz));
  if (parts.length === 2) return `${lead}${parts[0]} and ${parts[1]}`;
  // Three or four: "Nov 3, 5 and 10" (the month word once per month).
  let month = '';
  const short = parts.map((p) => {
    const [m, d] = p.split(' ');
    const out = m === month ? d : p;
    month = m;
    return out;
  });
  return `${lead}${short.slice(0, -1).join(', ')} and ${short[short.length - 1]}`;
}

/** The toast after I'm in with 1 or 2 unpaid games. */
export function nudgeToast(count: number, cents: number): { title: string; sub: string } {
  return {
    title: "You're in!",
    sub: count === 1 ? `Please pay the ${formatPrice(cents)} you still owe for your previous game.` : `Please pay the ${formatPrice(cents)} you still owe for your ${count} previous games.`,
  };
}

/** The bottom sheet at the limit. */
export function blockSheet(count: number, cents: number): { title: string; line: string; pay: string } {
  return {
    title: `You owe ${formatPrice(cents)}`,
    line: `For your last ${count} games. Once it's paid, you can sign up again.`,
    pay: `Pay ${formatPrice(cents)}`,
  };
}

/** The server's refusal, word for word (a phone with an old screen shows it as the toast). */
export function blockedMessage(count: number, cents: number): string {
  return `You owe ${formatPrice(cents)} for your last ${count} games. Once it's paid, you can sign up again.`;
}

/** The refusal's code (the screen opens the sheet when it sees it). */
export const BLOCKED_CODE = 'unpaid_limit';
