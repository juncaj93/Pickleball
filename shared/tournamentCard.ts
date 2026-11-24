// Zip 86 (🎾86.clean admin): the organizer's tournament card on Home, the pure parts (src/pages/admin/Tournament.tsx draws them): the 4 steps,
// the gray status line under the name, the prize words, and the Money sheet's numbers. Its own file so the unit tests read the very numbers
// the screen shows. Organizer only (the player download never imports it).
import { type AdminTournamentView, formatName } from './tournament';
import { suggestionWords, tierCostCents, topTier } from './tournamentMoney';
import { payByLabel } from './tournamentTickets';
import { shortDay, signupCloseDefault } from './tournamentNudge';
import { formatPrice } from './money';

/** The 4 steps, in order. */
export const STEPS = ['Sign up', 'Payments', 'Game night', 'Done'] as const;

/** Where the tournament is: 0 Sign up, 1 Payments (tickets open, before the night), 2 Game night, 3 Done; null when canceled. */
export function stepOf(t: Pick<AdminTournamentView, 'status' | 'closed' | 'over'>): 0 | 1 | 2 | 3 | null {
  if (t.status === 'canceled') return null;
  if (t.status === 'ended' || t.over) return 3;
  if (t.status !== 'tickets') return 0;
  return t.closed ? 2 : 1;
}

/** "Mon 7 PM" (no ":00"). */
export const clockShort = (s: string): string => s.replace(/:00(?=\s?[AP]M)/g, '');

/** The locked-in number every organizer row uses (the server's count). */
const lockedNumOf = (t: AdminTournamentView): number => t.lockedIn ?? (t.tickets ?? []).filter((k) => k.place === 'spot' && !k.out).length;

/** The gray line under the name: "Payments · pay by Mon 7 PM", "Sign up · ends Tue", "Game night", "Done", "Canceled". */
export function statusWords(t: AdminTournamentView, nowIso: string, tz: string): string {
  const step = stepOf(t);
  if (step === null) return 'Canceled';
  if (step === 3) return 'Done';
  if (step === 2) return 'Game night';
  if (step === 1) {
    if (t.payBy && Date.parse(nowIso) < Date.parse(t.payBy)) return `Payments · pay by ${clockShort(payByLabel(t.payBy, tz, t.finalDate))}`;
    return `Payments · ${lockedNumOf(t)} locked in`;
  }
  if (t.status === 'rescheduled') return 'Sign up · rescheduled';
  if (t.status === 'date_picked') return 'Sign up · date picked';
  const close = t.notSignedUp?.closeAt ?? signupCloseDefault(Date.parse(nowIso), tz);
  return `Sign up · ends ${shortDay(close, tz).split(' ')[0]}`;
}

/** "$14 each to the winners" (Locked doubles), "1st $14 · 2nd $7" (Americano, or the vote), or null when no prize is set. */
export function prizeWords(t: Pick<AdminTournamentView, 'format' | 'formatPending' | 'championCreditCents' | 'secondCreditCents'>): string | null {
  return prizeWordsFor(t.format === 'doubles' && !t.formatPending ? 'doubles' : 'americano', t.championCreditCents, t.secondCreditCents);
}

/** The prize words for the style the money line prices by (Locked doubles never counts a 2nd place: Zip 83). */
export function prizeWordsFor(style: 'doubles' | 'americano', championCents: number, secondCents: number): string | null {
  if (style === 'doubles') return championCents > 0 ? `${formatPrice(championCents)} each to the winners` : null;
  if (championCents <= 0 && secondCents <= 0) return null;
  return secondCents > 0 ? `1st ${formatPrice(championCents)} · 2nd ${formatPrice(secondCents)}` : `1st ${formatPrice(championCents)}`;
}

/** The style words on the When block ("Locked doubles", "Players vote"). */
export const styleShort = (t: Pick<AdminTournamentView, 'format' | 'formatPending'>): string => (t.formatPending ? 'Players vote' : formatName(t.format));

export interface MoneySheet {
  /** RIGHT NOW: tickets paid (players with a spot and a price, the organizer's $0 seat not one), their money, the courts, the prizes set (null:
   *  none set), and So far (paid - courts - prizes). */
  paidCount: number;
  paidCents: number;
  courtCents: number;
  prizesNowCents: number | null;
  soFarCents: number;
  /** IF ALL N PAY: N (the Plan's expected players), the tickets (N - 1: the organizer plays free), whether the organizer has a free seat. */
  expected: number;
  ticketsAllCents: number;
  freeSeat: boolean;
  /** The prizes counted: the ones set, else the style's full tier (suggested, not set yet). */
  prizeAllCents: number;
  prizeAllWords: string;
  prizeSuggested: boolean;
  /** You keep: tickets - courts - those prizes. */
  keepCents: number;
  /** The Money button's line ("+$42 if all pay"): THE money line (prizes as set), what Totals' Projected card counts for the open tournament. */
  buttonCents: number;
}

/**
 * Zip 86 (picture 7): the Money sheet, from the server's money line (shared/tournamentMoney.ts planMoney) and cost only, so it matches the Time
 * box, the Plan box, Finalize, the card and Totals to the cent. Null when the server sent no money line.
 */
export function moneySheet(t: AdminTournamentView): MoneySheet | null {
  const m = t.money;
  const c = t.cost;
  if (!m || !c) return null;
  const style = m.style ?? t.format;
  const setCents = m.ticketsCents - m.courtCents - m.youCents;
  // Review fix: the words follow the style the money line prices by, so they always name the amount counted.
  const words = prizeWordsFor(style, t.championCreditCents, t.secondCreditCents);
  const set = setCents > 0 && words !== null;
  const full = topTier(style);
  const fullCents = tierCostCents(full, style);
  const prizeAllCents = set ? setCents : fullCents;
  return {
    paidCount: c.paidNow,
    paidCents: c.paidNow * t.ticketCents,
    courtCents: m.courtCents,
    prizesNowCents: set ? setCents : null,
    soFarCents: -c.nowCents,
    expected: t.expected ?? t.size,
    ticketsAllCents: m.ticketsCents,
    freeSeat: (t.tickets ?? []).some((k) => k.organizer && !k.out),
    prizeAllCents,
    prizeAllWords: set ? words! : suggestionWords(full, style).replace(/^Suggested: /, ''),
    prizeSuggested: !set,
    keepCents: m.ticketsCents - m.courtCents - prizeAllCents,
    buttonCents: m.youCents,
  };
}
