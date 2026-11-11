// Zip 31 (Nov 2026): EXTENDED_TIME ("Extended time"), ships OFF. The group sometimes stays an extra 30 minutes or an hour and the
// venue charges the organizer the extra court time. At Finalize the organizer picks None | +30 min | +1 hr on the Who played sheet:
//
//  - the extra court cost is the venue's normal court rate for the extra time, ONE court: $12 for +30 min, $24 for +1 hr (no courts
//    multiplier: two courts at once are two separate games, each with its own extension);
//  - N = everyone who PLAYED, the organizer too if he played;
//  - every player who played EXCEPT the organizer pays ROUND UP(cost / N) to the whole dollar; the organizer covers what is left;
//  - never more than the cost in total: when rounding up would collect more (9 players, $12: $2 x 8 = $16), the share is rounded DOWN
//    instead ($1 x 8 = $8, the organizer covers $4);
//  - the game's own price (floor(4 x up-front / N)) is not touched: this is a separate charge on top;
//  - each share rides on the player's NEXT game's payment ("$17 due", "incl. $3 extension"), or "Pay now instead" from the alert.
//
// Pure rules and words only; the money moves in server/extension.ts. Stored on rows the screens already read (migration 0019).

import { formatPrice } from './money';
import { formatMonthDay, localParts } from './time';

export const EXTENDED_TIME = { task: 'extended_time_on', header: 'X-Extended-Time', link: 'extendedtime', env: 'EXTENDED_TIME', name: 'Extended time' } as const;

/** A wrangler.toml kill switch: allowed unless it says "off". Who gets it is Settings' call. */
export function extendedTimeAllowed(flag: string | undefined | null): boolean {
  return (flag ?? 'on').trim().toLowerCase() !== 'off';
}

/** The three choices on the sheet. */
export type ExtraMinutes = 0 | 30 | 60;
export const EXTRA_CHOICES: readonly ExtraMinutes[] = [0, 30, 60];

/** The venue's court rate for the extra time, one court (Alex's numbers: the 2 hour court is $48, so $12 a half hour). */
export const EXTRA_COST_CENTS: Record<ExtraMinutes, number> = { 0: 0, 30: 1200, 60: 2400 };

export function isExtraMinutes(x: unknown): x is ExtraMinutes {
  return x === 0 || x === 30 || x === 60;
}

/** "30 min" / "1 hr" (short, as on the sheet and the alert). */
export function extraWords(minutes: number): string {
  return minutes >= 60 ? '1 hr' : `${minutes} min`;
}

export interface ExtensionSplit {
  /** The extra court cost (what the venue charged). */
  costCents: number;
  /** N: everyone who played, the organizer too if he played. */
  played: number;
  /** How many pay a share (everyone who played except the organizer). */
  payers: number;
  /** Each payer's share, whole dollars. */
  shareCents: number;
  /** What the organizer covers: the cost minus what the others pay (never below $0). */
  organizerCents: number;
}

/**
 * THE RULE (Alex, Zip 31). `played` counts the organizer when he played; `organizerPlayed` says whether he did.
 * share = ceil(cost / N) dollars, unless that times the payers is more than the cost: then floor(cost / N).
 */
export function extensionSplit(minutes: number, played: number, organizerPlayed: boolean): ExtensionSplit {
  const costCents = isExtraMinutes(minutes) ? EXTRA_COST_CENTS[minutes] : 0;
  const n = Math.max(0, Math.floor(played));
  const payers = Math.max(0, n - (organizerPlayed && n > 0 ? 1 : 0));
  if (costCents <= 0 || n === 0 || payers === 0) return { costCents, played: n, payers, shareCents: 0, organizerCents: costCents };
  const dollars = costCents / 100;
  let share = Math.ceil(dollars / n);
  if (share * payers > dollars) share = Math.floor(dollars / n);
  const shareCents = share * 100;
  return { costCents, played: n, payers, shareCents, organizerCents: Math.max(0, costCents - shareCents * payers) };
}

/** The amber line on the sheet: "3 others pay $3 each" and "You cover $3". */
export function splitLine(s: ExtensionSplit): { left: string; right: string } {
  const left = s.payers === 0 ? 'Nobody else pays' : `${s.payers} ${s.payers === 1 ? 'other pays' : 'others pay'} ${formatPrice(s.shareCents)}${s.payers === 1 ? '' : ' each'}`;
  return { left, right: `You cover ${formatPrice(s.organizerCents)}` };
}

// ---------- One player's share, as stored on their seat ----------

/** The seat columns (session_players) a share is read from. */
export interface ExtSeat {
  ext_cents: number | null;
  ext_credit_cents: number;
  ext_paid_cents: number;
  ext_claim_cents: number;
}

/** What is still owed on a share right now (never below $0). */
export function extOwed(r: Partial<ExtSeat>): number {
  const share = r.ext_cents ?? 0;
  return Math.max(0, share - (r.ext_credit_cents ?? 0) - (r.ext_paid_cents ?? 0) - (r.ext_claim_cents ?? 0));
}

/** What has been put toward a share: credit (net) plus confirmed cash plus an unconfirmed I paid. */
export function extApplied(r: Partial<ExtSeat>): number {
  return (r.ext_credit_cents ?? 0) + (r.ext_paid_cents ?? 0) + (r.ext_claim_cents ?? 0);
}

// ---------- The player's alert ----------

/** "tonight's game" (same evening), "yesterday's game" (the next day), else "the Nov 10 game". */
export function gameWhenWords(gameStartIso: string, nowMs: number, tz: string): string {
  const d = dayDiff(gameStartIso, nowMs, tz);
  if (d <= 0) return "tonight's game";
  if (d === 1) return "yesterday's game";
  return `the ${formatMonthDay(gameStartIso, tz)} game`;
}

function dayDiff(gameStartIso: string, nowMs: number, tz: string): number {
  const day = (ms: number) => {
    const p = localParts(ms, tz);
    return Date.UTC(p.year, p.month - 1, p.day);
  };
  return Math.round((day(nowMs) - day(Date.parse(gameStartIso))) / 86_400_000);
}

/** The short form the alerts use (Alex, after the preview: two lines at the money card's size): "tonight's extra 30 min", "the extra 1 hr on Nov 10". */
export function extraWhenWords(gameStartIso: string, minutes: number, nowMs: number, tz: string): string {
  const d = dayDiff(gameStartIso, nowMs, tz);
  if (d <= 0) return `tonight's extra ${extraWords(minutes)}`;
  if (d === 1) return `yesterday's extra ${extraWords(minutes)}`;
  return `the extra ${extraWords(minutes)} on ${formatMonthDay(gameStartIso, tz)}`;
}

/** One share as the player's screen gets it (their own only). */
export interface ExtShareView {
  sessionId: string;
  startsAt: string;
  minutes: number;
  shareCents: number;
  /** Credit used on it (net, never below $0 here). */
  creditCents: number;
  owedCents: number;
  /** The alert was closed with the X. */
  seen: boolean;
}

export type ExtAlert =
  | { kind: 'owe'; sessionIds: string[]; cents: number; text: { before: string; amount: string; after: string } }
  | { kind: 'credit'; sessionIds: string[]; cents: number; owedCents: number; text: { before: string; amount: string; after: string } };

/**
 * The alerts at the top of the player's screen, newest rules (Alex, Zip 31):
 *  - one share owing (no credit on it): "You owe **$3** for the extra 30 min we added to yesterday's game. It'll be added to your next game."
 *  - two or more owing: ONE alert, the total: "You owe **$5** for extra time on past games. It'll be added to your next game."
 *  - credit covered it: "Your **$3** credit was used for the extra 30 min we added to yesterday's game."
 *  - credit covered part: "**$2** of your credit was used for the extra 30 min we added to yesterday's game. You owe $1 more, added to your next game."
 * A share closed with the X stays closed; a new or changed share brings its alert back (the owe alert then shows everything owed).
 */
export function extAlerts(shares: ExtShareView[], nowMs: number, tz: string): ExtAlert[] {
  const out: ExtAlert[] = [];
  const open = shares.filter((s) => !s.seen);
  for (const s of open.filter((x) => x.creditCents > 0)) {
    const what = extraWhenWords(s.startsAt, s.minutes, nowMs, tz);
    if (s.owedCents > 0) {
      out.push({ kind: 'credit', sessionIds: [s.sessionId], cents: s.creditCents, owedCents: s.owedCents, text: { before: '', amount: formatPrice(s.creditCents), after: ` of your credit was used for ${what}. You owe ${formatPrice(s.owedCents)} more, added to your next game.` } });
    } else {
      out.push({ kind: 'credit', sessionIds: [s.sessionId], cents: s.creditCents, owedCents: 0, text: { before: 'Your ', amount: formatPrice(s.creditCents), after: ` credit was used for ${what}.` } });
    }
  }
  // The owe alert: shown while any owing share (with no credit on it) is not closed, so a new extension brings it back; it then counts
  // every owing share with no credit on it (a share with credit on it says its own "You owe $1 more" in its credit alert).
  const owing = shares.filter((s) => s.owedCents > 0 && s.creditCents <= 0);
  if (owing.some((s) => !s.seen)) {
    const cents = owing.reduce((sum, s) => sum + s.owedCents, 0);
    const ids = owing.map((s) => s.sessionId);
    if (owing.length === 1) {
      const s = owing[0];
      out.push({ kind: 'owe', sessionIds: ids, cents, text: { before: 'You owe ', amount: formatPrice(cents), after: ` for ${extraWhenWords(s.startsAt, s.minutes, nowMs, tz)}. It's added to your next game.` } });
    } else {
      out.push({ kind: 'owe', sessionIds: ids, cents, text: { before: 'You owe ', amount: formatPrice(cents), after: " for extra time on past games. It's added to your next game." } });
    }
  }
  return out;
}

/** The small grey note on the next game's card: "incl. $3 extension". */
export const inclNote = (cents: number) => `incl. ${formatPrice(cents)} extension`;

/** The ledger's `reason` text for credit moved by an extension: "ext:<game id>" (no session_id, so no seat ever counts it). */
export const EXT_PREFIX = 'ext:';
export const extReasonColumn = (sessionId: string) => `${EXT_PREFIX}${sessionId}`;
/** If a ledger reason is an extension's, its game id; otherwise null. */
export function extSessionOf(raw: string | null | undefined): string | null {
  return typeof raw === 'string' && raw.startsWith(EXT_PREFIX) ? raw.slice(EXT_PREFIX.length) : null;
}
