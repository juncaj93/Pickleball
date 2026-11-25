// Zip 87 (🎾87.card polish, picture 9): prizes for BOTH styles. The organizer sets a Locked doubles box (1st place team and 2nd place team, each
// player) and an Americano box (1st place, 2nd place) before the night; the night pays the box of the style actually played. No migration: the
// two boxes live in the tournament's existing award settings (tournaments.award_pick, the JSON Edit awards already keeps its picks in, as
// {"prizes": {"doubles": [first, second], "americano": [first, second]}}). The champion_credit_cents and second_credit_cents columns keep
// the planned style's box, so older code (a rollback) reads what it always read.
// Organizer and server only (the player download never imports it: players never see prize amounts).
import type { TournamentFormat } from './tournament';

/** One style's prizes, in cents per player: 1st place and 2nd place (Locked doubles: each of the team's two players). */
export interface PlacePrizes {
  first: number;
  second: number;
}

/** Both styles' prizes. `saved`: the organizer saved them (the Prizes sheet, Edit awards or Edit), so $0 means "medals only", not "not set". */
export interface StylePrizes {
  doubles: PlacePrizes;
  americano: PlacePrizes;
  saved: boolean;
}

/** The most one box may hold, per player: $200, the same cap as every tournament amount (shared/tournament.ts MAX_PRICE_CENTS). */
export const PRIZE_MAX_CENTS = 20_000;

const okCents = (x: unknown): x is number => typeof x === 'number' && Number.isInteger(x) && x >= 0 && x <= PRIZE_MAX_CENTS;
const pair = (x: unknown): PlacePrizes | null => (Array.isArray(x) && x.length === 2 && okCents(x[0]) && okCents(x[1]) ? { first: x[0], second: x[1] } : null);

/** The JSON stored in award_pick, or null when it is missing or not an object. */
function pickJson(awardPick: string | null | undefined): Record<string, unknown> | null {
  if (!awardPick) return null;
  try {
    const v = JSON.parse(awardPick);
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * Both boxes, from the tournament row. Saved boxes win; else the columns as every zip before this one read them: Locked doubles pays the
 * champion credit to each winner and never a 2nd place (Zip 83: a doubles row's saved 2nd place amount was never paid), Americano pays the
 * champion credit and the 2nd place credit.
 */
export function prizesOfRow(row: { award_pick?: string | null; champion_credit_cents: number; second_credit_cents?: number | null }): StylePrizes {
  const v = pickJson(row.award_pick);
  const p = v && v.prizes && typeof v.prizes === 'object' ? (v.prizes as Record<string, unknown>) : null;
  const d = p ? pair(p.doubles) : null;
  const a = p ? pair(p.americano) : null;
  if (d && a) return { doubles: d, americano: a, saved: true };
  const champion = row.champion_credit_cents ?? 0;
  return { doubles: { first: champion, second: 0 }, americano: { first: champion, second: row.second_credit_cents ?? 0 }, saved: false };
}

/** award_pick with the boxes written in (the picks it holds stay as they are). */
export function withPrizes(awardPick: string | null | undefined, prizes: Omit<StylePrizes, 'saved'>): string {
  const v = pickJson(awardPick) ?? {};
  return JSON.stringify({ ...v, prizes: { doubles: [prizes.doubles.first, prizes.doubles.second], americano: [prizes.americano.first, prizes.americano.second] } });
}

/** award_pick with new picks (Edit awards' winners), the saved boxes kept. */
export function withPicks(awardPick: string | null | undefined, picks: { first: string; second?: string | null }): string {
  const v = pickJson(awardPick);
  return JSON.stringify({ first: picks.first, ...(picks.second ? { second: picks.second } : {}), ...(v && v.prizes ? { prizes: v.prizes } : {}) });
}

/** Players paid per place: Locked doubles pays each of the team's two players, Americano one. */
const perPlace = (style: TournamentFormat): number => (style === 'doubles' ? 2 : 1);

/** What a box costs the organizer: (1st + 2nd) x the players per place. Locked doubles 14 / 0: $28; Americano 14 / 7: $21. */
export const boxCostCents = (style: TournamentFormat, p: PlacePrizes): number => perPlace(style) * (p.first + p.second);

/** The columns to write for a box (the planned style's): champion_credit_cents and second_credit_cents. */
export const columnsOf = (p: PlacePrizes): { championCents: number; secondCents: number } => ({ championCents: p.first, secondCents: p.second });

/** Both boxes as sent by a screen ({doubles: {first, second}, americano: {first, second}}), checked. Null when anything is off. */
export function readPrizes(x: unknown): Omit<StylePrizes, 'saved'> | null {
  if (!x || typeof x !== 'object') return null;
  const o = x as Record<string, unknown>;
  const one = (y: unknown): PlacePrizes | null => {
    if (!y || typeof y !== 'object') return null;
    const z = y as Record<string, unknown>;
    return okCents(z.first) && okCents(z.second) && z.first % 100 === 0 && z.second % 100 === 0 ? { first: z.first, second: z.second } : null;
  };
  const d = one(o.doubles);
  const a = one(o.americano);
  return d && a ? { doubles: d, americano: a } : null;
}

/** The prize words for a style's box: "$14 each to winners" / "1st $14 · 2nd $7 each" (Locked doubles), "1st $14 · 2nd $7" (Americano). */
export function boxWords(style: TournamentFormat, p: PlacePrizes, money: (c: number) => string): string {
  if (p.first <= 0 && p.second <= 0) return 'Medals only';
  if (style === 'doubles') return p.second > 0 ? `1st ${money(p.first)} · 2nd ${money(p.second)} each` : `${money(p.first)} each to winners`;
  return p.second > 0 ? `1st ${money(p.first)} · 2nd ${money(p.second)}` : `1st ${money(p.first)}`;
}
