// The X on the notice cards at the top of Home. A dismissed card stays hidden on this phone only
// (browser storage, nothing on the server) until something new happens: each card names its
// situation (a token like the player who moved in, or the number of players), and a different
// one shows the card again. Cards that need a decision or a money action never get an X.
import type { SuggestionKind } from './suggestions';

/** Card key to the situation it was dismissed in. */
export type Dismissed = Record<string, string>;

const STORAGE_KEY = 'pb_card_dismissed';

export function readDismissed(get: (k: string) => string | null): Dismissed {
  try {
    const v = JSON.parse(get(STORAGE_KEY) ?? '{}');
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
    return Object.fromEntries(Object.entries(v).filter(([, t]) => typeof t === 'string')) as Dismissed;
  } catch {
    return {};
  }
}

export function writeDismissed(d: Dismissed, set: (k: string, v: string) => void) {
  try {
    set(STORAGE_KEY, JSON.stringify(d));
  } catch {
    /* storage can be off (private mode): the card then stays hidden for this visit only */
  }
}

/** Forget dismissals for cards that are gone or whose situation changed, so a new event shows the card again. */
export function pruneDismissed(cards: { key: string; token: string }[], d: Dismissed): Dismissed {
  const keep: Dismissed = {};
  for (const c of cards) if (d[c.key] === c.token) keep[c.key] = c.token;
  return keep;
}

/**
 * Text suggestion cards that get an X: texts worth sending, nothing that costs money to ignore. A
 * payment reminder has no X (an unpaid seat is money); it goes when the seat is paid.
 */
export const DISMISSIBLE: ReadonlySet<SuggestionKind> = new Set(['promoted', 'need', 'checkin', 'final']);
