// The "needs people" card at the top of the player Home (the field called `suggestion` in the group answer).
//
// One rule, the same for every player (Zip 53; it used to depend on a hidden Tuesday/Thursday preference per player):
//   1. The soonest upcoming game that still needs players (fewer than 4 in).
//   2. If no game needs players, the soonest game with room for one more (4 or more in, under the limit): "Thursday has 4 in".
// A game the player already has a row in (in, waiting, dropped, or answered No) is skipped, so the card moves on to the next
// game that qualifies. Nothing here reads the player's days, whether they are a regular, or any money.
import { headCount } from '../shared/guestSpot';
import { MIN_PLAYERS } from '../shared/spots';
import type { RosterRow, SessionRow } from './repo';
import { confirmedOf } from './repo';

/** The card only looks at games this far ahead (as it always has). */
export const NEEDS_CARD_AHEAD_MS = 8 * 86_400_000;

/** The session to show on the card for `playerId`, or null when no game qualifies. `sessions` need not be in order. */
export function pickNeedsCardSession(
  sessions: SessionRow[],
  rosters: Map<string, RosterRow[]>,
  playerId: string,
  nowMs: number,
  cap: number,
  hidden: ReadonlySet<string> = new Set(),
): SessionRow | null {
  const open = sessions
    .filter((s) => {
      const start = Date.parse(s.starts_at);
      return s.status !== 'canceled' && !hidden.has(s.id) && start > nowMs && start <= nowMs + NEEDS_CARD_AHEAD_MS;
    })
    .filter((s) => !(rosters.get(s.id) ?? []).some((r) => r.player_id === playerId))
    .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at) || (a.id < b.id ? -1 : 1));
  const count = (s: SessionRow) => headCount(confirmedOf(rosters.get(s.id) ?? []));
  return open.find((s) => count(s) < MIN_PLAYERS) ?? open.find((s) => count(s) < cap) ?? null;
}
