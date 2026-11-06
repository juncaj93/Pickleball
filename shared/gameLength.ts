// Game length and price (Zip 9, Nov 2026). THE one table: game length in minutes -> court cost and the price each for 4 to 10 in.
//
// A game's length is End minus Start (no setting, nothing stored). Today two lengths exist:
//  - 120 minutes, the normal game. Its row is here so the whole picture sits in one place, but the site keeps pricing a normal
//    game from Settings > Money ("Price per player" $14, "Typical court cost" $48) with floor(4 x price / N), exactly as live.
//    The tests check that this row equals that rule at today's settings (14, 11, 9, 8, 7, 6, 5 and $48).
//  - 90 minutes, the "short game" (switch SHORT_GAMES). Its prices are a fixed whole-dollar table, not a formula.
// Any other length (1 hour, 2.5 hours, ...) has no row and is priced like a normal game, with no tag.
//
// To add a length later (Alex: 1, 2.5, 3, 3.5 or 4 hours), add ONE row below. Nothing else changes: every price path reads it
// through gamePrice(). Court cost today is $24 an hour ($36 for 1.5 hours, $48 for 2 hours).
//
// Everyone pays the 4-in price up front (the `4` entry), and whatever is above the final price comes back as credit when the
// organizer finalizes, the same way a normal game works. The organizer plays but pays the venue, never the group.

import { MIN_PLAYERS } from './spots';
import { finalPrice } from './pricing';

/** Players in, 4 to 10. More than 10 (the Max players setting allows up to 12) pays the 10 price. */
export type PriceByPlayers = Readonly<Record<4 | 5 | 6 | 7 | 8 | 9 | 10, number>>;

export interface GameLength {
  /** End minus Start, in minutes. */
  minutes: number;
  /** "1.5 hours", for the time line under the date tile. */
  words: string;
  /** "1.5 hr", for the small organizer tag. */
  short: string;
  /** What the venue charges for a court this long, in cents. */
  courtCents: number;
  /** The price each, in cents, by how many are in (or played, once finalized). */
  prices: PriceByPlayers;
}

/** The normal game (2 hours). */
export const NORMAL_MINUTES = 120;
/** The short game (1.5 hours). */
export const SHORT_MINUTES = 90;

export const GAME_LENGTHS: readonly GameLength[] = [
  // 9 and 10 in: $4 each, PROPOSED (Zip 9 report), waiting for Alex's OK. 9 x $4 = $36 and 10 x $4 = $40, so the $36 court stays
  // covered; $3 at 10 would be $30. With today's Max players (10) a short game never reaches 11 or 12.
  { minutes: SHORT_MINUTES, words: '1.5 hours', short: '1.5 hr', courtCents: 36_00, prices: { 4: 11_00, 5: 9_00, 6: 7_00, 7: 6_00, 8: 5_00, 9: 4_00, 10: 4_00 } },
  { minutes: NORMAL_MINUTES, words: '2 hours', short: '2 hr', courtCents: 48_00, prices: { 4: 14_00, 5: 11_00, 6: 9_00, 7: 8_00, 8: 7_00, 9: 6_00, 10: 5_00 } },
];

/** End minus Start in whole minutes (a bad pair gives 0). */
export function gameMinutes(startsAtIso: string, endsAtIso: string): number {
  const ms = Date.parse(endsAtIso) - Date.parse(startsAtIso);
  return Number.isFinite(ms) && ms > 0 ? Math.round(ms / 60_000) : 0;
}

/** The table row for a length, or null when there is none. */
export function lengthRow(minutes: number): GameLength | null {
  return GAME_LENGTHS.find((r) => r.minutes === minutes) ?? null;
}

/** "2 hours", "1.5 hours", "2.5 hours", "1 hour", "45 min" (the time line under the date tile; any length, row or not). */
export function lengthWords(minutes: number): string {
  const row = lengthRow(minutes);
  if (row) return row.words;
  if (minutes <= 0) return '';
  if (minutes % 30 !== 0) return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} hr ${minutes % 60} min`;
  const h = minutes / 60;
  return `${h} ${h === 1 ? 'hour' : 'hours'}`;
}

/** The price each from a table row for N in: the 4 price below 4 (nobody pays more than up front), the 10 price above 10. */
export function rowPrice(row: GameLength, n: number): number {
  const k = Math.min(10, Math.max(MIN_PLAYERS, Math.floor(n))) as keyof PriceByPlayers;
  return row.prices[k];
}

export interface PriceSettings {
  pricePerPlayerCents: number;
  typicalCourtCostCents: number;
}

/** Everything about one game's price. */
export interface GamePrice {
  minutes: number;
  /** Priced from a table row that is not the normal game (today: the 1.5 hour game). Only ever true with SHORT_GAMES on. */
  special: boolean;
  /** The table row behind it when `special`, else null. */
  row: GameLength | null;
  /** The flat price everyone pays up front ("$14 each", "$11 each"). */
  flatCents: number;
  /** The court cost when the booking has none entered. */
  courtCents: number;
}

/**
 * A game's price. With SHORT_GAMES off, or a length with no row, or the normal 2 hours: Settings > Money, exactly as before.
 * With it on and a row for the length (other than 2 hours): that row.
 */
export function gamePrice(game: { startsAt: string; endsAt: string }, settings: PriceSettings, shortGames: boolean): GamePrice {
  const minutes = gameMinutes(game.startsAt, game.endsAt);
  const row = shortGames && minutes !== NORMAL_MINUTES ? lengthRow(minutes) : null;
  if (row) return { minutes, special: true, row, flatCents: rowPrice(row, MIN_PLAYERS), courtCents: row.courtCents };
  return { minutes, special: false, row: null, flatCents: settings.pricePerPlayerCents, courtCents: settings.typicalCourtCostCents };
}

/** The final price each once N played: the row's table for a special length, else floor(4 x flat / N) (shared/pricing.ts). */
export function gameFinalPrice(p: GamePrice, n: number): number {
  if (p.row) return n < MIN_PLAYERS ? p.flatCents : Math.min(p.flatCents, rowPrice(p.row, n));
  return finalPrice(p.flatCents, n);
}

/** The credit back each for someone who paid the flat price, once N played. */
export function gameCreditBack(p: GamePrice, n: number): number {
  return Math.max(0, p.flatCents - gameFinalPrice(p, n));
}

/** A game is a short game when End minus Start is exactly 90 minutes. */
export function isShortGame(startsAtIso: string, endsAtIso: string): boolean {
  return gameMinutes(startsAtIso, endsAtIso) === SHORT_MINUTES;
}

/** The heads-up on Add game and Edit game in two parts: "1.5 hour game" / "Court $36. Players pay $11 each (4 in), less if more join." Null for a normal game or a length with no row. */
export function shortGameHeadsUpParts(minutes: number): { title: string; body: string } | null {
  if (minutes === NORMAL_MINUTES) return null;
  const row = lengthRow(minutes);
  if (!row) return null;
  const d = (c: number) => `$${Math.round(c / 100)}`;
  return { title: `${row.words.replace(/s$/, '')} game`, body: `Court ${d(row.courtCents)}. Players pay ${d(rowPrice(row, MIN_PLAYERS))} each (4 in), less if more join.` };
}

/** The same heads-up as one sentence: "1.5 hour game. Court $36. Players pay $11 each (4 in), less if more join." */
export function shortGameHeadsUp(minutes: number): string | null {
  const p = shortGameHeadsUpParts(minutes);
  return p ? `${p.title}. ${p.body}` : null;
}

/** "1.5 hr game · $11 each" (the organizer tag on the game tile and list row), or null for a normal game. */
export function shortGameTag(p: GamePrice): string | null {
  if (!p.special || !p.row) return null;
  return `${p.row.short} game · $${Math.round(p.flatCents / 100)} each`;
}

/**
 * A game's price on a screen, from what the server sent: a game view carries `shortGame` only when the server priced it from its
 * own row ("Short games" on for that screen), so the screen never decides the switch by itself and always agrees with the server.
 */
export function viewPrice(s: { startsAt: string; endsAt: string; shortGame?: { minutes: number } }, settings: PriceSettings): GamePrice {
  return gamePrice(s, settings, !!s.shortGame);
}

/** The flat price on a screen: the short game's own (from the server), else the normal price. */
export function viewFlat(s: { shortGame?: { flatCents: number } }, normalCents: number): number {
  return s.shortGame?.flatCents ?? normalCents;
}

/** "6 played · $7 each · $4 credit back each" for any game (the Finalize card), from that game's own price. */
export function gameFinalPreview(p: GamePrice, played: number, fmt: (cents: number) => string): string {
  const each = gameFinalPrice(p, played);
  const back = gameCreditBack(p, played);
  return `${played} played · ${fmt(each)} each${back > 0 ? ` · ${fmt(back)} credit back each` : ''}`;
}

/** The gray "If 6 play, you get $4 back as credit." from a game's own price (shared/pricing.ts creditBackNote, for any game). */
export function gameCreditBackNote(p: GamePrice, confirmedCount: number, maxPlayers: number, fmt: (cents: number) => string): string | null {
  const n = confirmedCount + 1;
  if (n < MIN_PLAYERS + 1 || n > maxPlayers) return null;
  const back = gameCreditBack(p, n);
  return back > 0 ? `If ${n} play, you get ${fmt(back)} back as credit.` : null;
}

/** End minus Start from two "HH:MM" time boxes (Add game, Edit game: "19:30", "21:00" -> 90), or null when either is empty or the end is not after the start. */
export function boxMinutes(start: string, end: string): number | null {
  const hhmm = (v: string) => {
    const m = /^(\d{2}):(\d{2})$/.exec(v);
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
  };
  const a = hhmm(start);
  const b = hhmm(end);
  return a === null || b === null || b <= a ? null : b - a;
}
