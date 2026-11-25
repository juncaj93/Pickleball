// Zip 90 (🎾90.prize reveal): the prize card's words and cards (pictures 1 to 6), shared by the card (src/TourAwards.tsx) and its tests.
import type { CongratsView } from './tournament';

/** Which header piece a prize card lands on. */
export type PrizeKind = 'medal' | 'credit';
/** Where that piece stands on this phone: 'masked' (held back), 'arriving' (the header makes room for it, still hidden), 'landed'. */
export type PrizePhase = 'masked' | 'arriving' | 'landed';

/** The lime caps line and the one-line title. */
export function prizeWords(c: CongratsView): { kicker: string; title: string } {
  if (c.award === 'second') return { kicker: `${c.tournament} runner-up`, title: 'Congrats on 2nd place!' };
  if (c.format === 'doubles') return { kicker: `${c.tournament} champions`, title: c.partner ? `Congrats, you and ${c.partner} won!` : 'Congrats, you won!' };
  return { kicker: `${c.tournament} champion`, title: 'Congrats, you won!' };
}

/** The prize cards: the gold medal (1st place only), then the credit (only when the award has credit). */
export const prizeKinds = (c: CongratsView): PrizeKind[] => [...(c.medal ? (['medal'] as const) : []), ...(c.creditCents > 0 ? (['credit'] as const) : [])];
