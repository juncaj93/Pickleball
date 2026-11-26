// Zip 70 (🎾70.time): the organizer's money line, the Plan's expected players and the players' time card words. Its own file on purpose: the
// player download reads shared/tournament.ts, so these organizer and server pieces stay out of it (tests/zip48-split.test.ts's size budget).
import { courtCentsOf, MAX_SPOTS, prizeCentsOf, shortClock, styleAtClose, type TournamentFormat, WINNERS } from './tournament';
import { formatPrice } from './money';
import { boxCostCents, type StylePrizes } from './tournamentPrizes';

/** The Plan box's Expect stepper runs 6 to 16. */
export const EXPECT_MIN = 6;
export const EXPECT_MAX = MAX_SPOTS;

/**
 * The players the Plan expects: the organizer's saved number, else the site's suggestion (the real count: planCount), never fewer than the
 * players already locked in, held to 6..16.
 */
export function expectedPlayers(o: { saved: number | null; suggested: number; locked: number }): number {
  const base = o.saved ?? o.suggested;
  return Math.min(EXPECT_MAX, Math.max(EXPECT_MIN, Math.round(base), Math.round(o.locked)));
}

/** A saved Expect number as stored (task_log detail), or null for none or anything that is not a whole number from 6 to 16. */
export function savedExpect(detail: string | null | undefined): number | null {
  if (typeof detail !== 'string' || !/^\d{1,2}$/.test(detail.trim())) return null;
  const n = Number(detail.trim());
  return n >= EXPECT_MIN && n <= EXPECT_MAX ? n : null;
}

export interface MoneyLine {
  /** Zip 85: the style the prizes are priced by (shared/tournamentMoney.ts planMoney: the style the expected count really plays). */
  style?: TournamentFormat;
  /** Zip 85: what is left after that style's FULL prizes (the price check, "After full prizes: +$14"). */
  afterFullCents?: number;
  /** Zip 85: ticket sales are closed, so the style is the one really played (no odd-count switch any more). */
  closed?: boolean;
  /** Zip 85: the style saved (or the vote's leader), before any odd-count switch: what the boxes start from as the count changes. */
  baseStyle?: TournamentFormat;
  /** Courts x hours x the court rate ($24 per court per hour). */
  courtCents: number;
  /** (expected players minus the organizer, who plays free) x the ticket price. */
  ticketsCents: number;
  /** Tickets minus Courts minus the winners' credits now set. 0 or more: the organizer makes it; below 0: it costs them. */
  youCents: number;
}

/** THE money line (Alex's rule): Courts, Tickets, and what the organizer makes (or pays) if the night fills to the expected players. */
export function moneyLine(o: { expected: number; courts: number; minutes: number; ticketCents: number; prizeCents: number; adjustCents?: number }): MoneyLine {
  const courtCents = courtCentsOf({ courts: o.courts, minutes: o.minutes });
  // Zip 94 (early bird): `adjustCents` is what the tickets locked in really cost beyond the price now (shared/earlyBird.ts lockedAdjustCents;
  // some at $18, some at $20). 0 or left out: exactly as before.
  const ticketsCents = Math.max(0, Math.max(0, Math.round(o.expected) - 1) * o.ticketCents + (o.adjustCents ?? 0));
  return { courtCents, ticketsCents, youCents: ticketsCents - courtCents - o.prizeCents };
}

/** The money row's label: "You make if it fills" (0 or more) or "Your cost if it fills". */
export const moneyRowLabel = (youCents: number): string => (youCents >= 0 ? 'You make if it fills' : 'Your cost if it fills');

/**
 * Zip 70 (picture 6): the players' card when the organizer moves the time: "The Cold Open now ends at 9:30 PM (was 10 PM)." or "now starts at 8 PM
 * (was 7:30 PM)." (both: "now starts at 8 PM (was 7:30 PM) and ends at 10:30 PM (was 10 PM)."), with "Based on the number of players locked in."
 */
export function timeMoveWords(name: string, from: { start: number; minutes: number }, to: { start: number; minutes: number }): { title: string; sub: string } | null {
  const startMoved = from.start !== to.start;
  const endMoved = from.start + from.minutes !== to.start + to.minutes;
  const starts = `starts at ${shortClock(to.start)} (was ${shortClock(from.start)})`;
  const ends = `ends at ${shortClock(to.start + to.minutes)} (was ${shortClock(from.start + from.minutes)})`;
  const what = startMoved && endMoved ? `${starts} and ${ends}` : startMoved ? starts : endMoved ? ends : null;
  return what ? { title: `${name} now ${what}.`, sub: 'Based on the number of players locked in.' } : null;
}


// ---------------------------------------------------------------------------------------------------------------------
// Zip 82 (🎾82.night admin): suggested prizes and the price check (Alex's rules). ONE place for the tiers: Edit awards' suggestion, the
// Finalize box and the tournament card's money lines all read these.
// ---------------------------------------------------------------------------------------------------------------------

/** The caps, never more: 1st place a free game ($14 credit per player), 2nd place half off ($7 per player, Americano only). No early bird prize. */
export const PRIZE_FIRST_CENTS = 1400;
export const PRIZE_SECOND_CENTS = 700;

/** The tiers, best first. Amounts only go down a whole tier at a time, never to an odd amount. */
export type PrizeTier = 'full' | 'first' | 'medals';
/** Americano: full (1st $14 + 2nd $7 = $21), 1st only ($14), medals only. */
export const PRIZE_TIERS: readonly PrizeTier[] = ['full', 'first', 'medals'];
/** Zip 83 (Alex): Locked doubles has NO 2nd place, ever: 1st $14 each ($28 for the team) or medals only. */
export const DOUBLES_PRIZE_TIERS: readonly PrizeTier[] = ['first', 'medals'];
export const tiersOf = (format: TournamentFormat): readonly PrizeTier[] => (format === 'doubles' ? DOUBLES_PRIZE_TIERS : PRIZE_TIERS);

/** Players per place: Locked doubles pays each of the team's 2 players, Americano one player. */
const perPlace = (format: TournamentFormat): number => (format === 'doubles' ? WINNERS : 1);

/** What a tier gives each player: 1st and 2nd place credit per player (Locked doubles never has a 2nd place). */
export function tierAmounts(tier: PrizeTier, format: TournamentFormat = 'americano'): { firstCents: number; secondCents: number } {
  if (tier === 'medals') return { firstCents: 0, secondCents: 0 };
  if (tier === 'first' || format === 'doubles') return { firstCents: PRIZE_FIRST_CENTS, secondCents: 0 };
  return { firstCents: PRIZE_FIRST_CENTS, secondCents: PRIZE_SECOND_CENTS };
}

/** What a tier costs the organizer: Americano full $21, 1st only $14; Locked doubles 1st $28 (two players a team). */
export function tierCostCents(tier: PrizeTier, format: TournamentFormat): number {
  const a = tierAmounts(tier, format);
  return perPlace(format) * (a.firstCents + a.secondCents);
}

/** The style's best tier (what the price check counts): Americano full, Locked doubles 1st. */
export const topTier = (format: TournamentFormat): PrizeTier => tiersOf(format)[0];

/** The highest tier of the style that what is left (tickets minus courts) can pay; medals only when it cannot pay the lowest money tier. */
export function suggestedTier(leftCents: number, format: TournamentFormat): PrizeTier {
  return tiersOf(format).find((x) => tierCostCents(x, format) <= leftCents) ?? 'medals';
}

/** "Suggested: full prizes (1st $14 · 2nd $7)" / "Suggested: 1st only ($14)" / Locked doubles "Suggested: $14 each to the winners" /
 *  "Suggested: medals only". */
export function suggestionWords(tier: PrizeTier, format: TournamentFormat = 'americano'): string {
  if (tier === 'medals') return 'Suggested: medals only';
  if (format === 'doubles') return `Suggested: ${formatPrice(PRIZE_FIRST_CENTS)} each to the winners`;
  // Zip 85: Americano has one player per place, so never "each" (Locked doubles keeps "$14 each to the winners").
  if (tier === 'full') return `Suggested: full prizes (1st ${formatPrice(PRIZE_FIRST_CENTS)} · 2nd ${formatPrice(PRIZE_SECOND_CENTS)})`;
  return `Suggested: 1st only (${formatPrice(PRIZE_FIRST_CENTS)})`;
}

/** "Tickets $162 − courts $120 = $42 left." (short: "= $8 short."). */
export function leftWords(ticketsCents: number, courtCents: number): string {
  const left = ticketsCents - courtCents;
  return `Tickets ${formatPrice(ticketsCents)} − courts ${formatPrice(courtCents)} = ${formatPrice(Math.abs(left))} ${left >= 0 ? 'left' : 'short'}.`;
}

/** The price check: what is left after the style's FULL prizes (Americano $21, Locked doubles $28). Below 0: that much short. */
export const afterFullCents = (ticketsCents: number, courtCents: number, format: TournamentFormat): number => ticketsCents - courtCents - tierCostCents(topTier(format), format);

/** "After full prizes: +$21" (0 or more) or "After full prizes: $9 short" (red, no plus sign). */
export const afterFullWords = (cents: number): string => (cents >= 0 ? `After full prizes: +${formatPrice(cents)}` : `After full prizes: ${formatPrice(-cents)} short`);

/**
 * Zip 85 (🎾84 dry run): ONE prize number everywhere. The style a plan prices its prizes by: until ticket sales close, the style the expected
 * count really plays (an odd count is Americano, as Finalize's fit line and the close of tickets say); after that, the style saved.
 */
export const expectedStyle = (format: TournamentFormat, expected: number, closed: boolean): TournamentFormat => (closed ? format : styleAtClose(format, Math.round(expected)));

/**
 * Zip 85: THE money line and the price check together, for the Time box, the Plan box, Finalize, the Home card and the tournament page's Plan
 * card: the winners' credits now set and "After full prizes" both follow the expected style, so every place shows the same numbers.
 */
export function planMoney(o: {
  format: TournamentFormat;
  closed: boolean;
  expected: number;
  courts: number;
  minutes: number;
  ticketCents: number;
  championCents: number;
  secondCents: number;
  /** Zip 87: both styles' boxes (shared/tournamentPrizes.ts); the style priced pays its own box (Locked doubles may have a 2nd place again). */
  prizes?: Omit<StylePrizes, 'saved'>;
  /** Zip 94: the tickets locked in at another price than ticketCents (the price now): their real cost beyond it (moneyLine). */
  adjustCents?: number;
}): MoneyLine & { style: TournamentFormat; afterFullCents: number; closed: boolean; baseStyle: TournamentFormat } {
  const style = expectedStyle(o.format, o.expected, o.closed);
  const prizeCents = o.prizes ? boxCostCents(style, o.prizes[style]) : prizeCentsOf(style, o.championCents, o.secondCents);
  const line = moneyLine({ expected: o.expected, courts: o.courts, minutes: o.minutes, ticketCents: o.ticketCents, prizeCents, adjustCents: o.adjustCents });
  return { ...line, style, afterFullCents: afterFullCents(line.ticketsCents, line.courtCents, style), closed: o.closed, baseStyle: o.format };
}

/** Zip 87 (picture 9): "Suggested for both styles": each style's best tier the money left can pay (Alex's caps; Locked doubles 2nd place $0). */
export function suggestedBoxes(leftCents: number): Omit<StylePrizes, 'saved'> {
  const d = tierAmounts(suggestedTier(leftCents, 'doubles'), 'doubles');
  const a = tierAmounts(suggestedTier(leftCents, 'americano'), 'americano');
  return { doubles: { first: d.firstCents, second: 0 }, americano: { first: a.firstCents, second: a.secondCents } };
}
