// Zip 88 (🎾88.rolling courts): ROLLING COURTS. A court never waits for the other court when enough free players are waiting: when a court frees
// up (its game has a score, or the game is off because someone left), the next game still to play whose four players are all free (none of them
// on the other court right now) starts there at once, even when it belongs to the next round. The earliest such game in the schedule's order wins.
// The games, partners and sits never change: only the order they reach the courts.
//
// Nothing new is stored. Which game is on which court, and since when, is worked out the same way every time from what the game rows already
// hold: the schedule's order and the moment each game finished (result_at, kept as it was when a score is fixed or cleared). The finishes are
// replayed in the order they happened, and after each one the free courts are filled by the rule above. So two scores at the same moment, a
// refresh or another phone always see the same courts, and nothing is written by a screen that only reads.
//
// Two more rules keep the night fair and the phones simple:
//   - a player's (Locked doubles: a team's) games are played in their own schedule order: a game starts only when it is the next game of each of
//     its players, so "Up next" on a phone is always the game it will play next, and nobody plays a later game before an earlier one;
//   - a semifinal starts only when every pool game is in and its two teams are known; the Final and 3rd place also wait for every semifinal;
//     a tie's Game A or B starts as soon as the wheel has made it; the Final and 3rd place start side by side.
// A court with nothing it may start waits, as before.

export interface RollGame {
  num: number;
  /** The schedule's round (the bars and the pills say it). */
  round: number;
  /** Stage order: 0 pool games, 1 a tie's Game A / B, 2 semifinals, 3 the Final and 3rd place. */
  rank: number;
  /** Who plays (player ids, or team seats as text). Empty while not known (a playoff before its teams): it cannot start then. */
  players: readonly string[];
  /** When it finished (its result came in, or it was called off): ms. Null: still to play. */
  doneAt: number | null;
  /** Not part of the night at all (no time to place it: a game called off by a rule, not by a tap). */
  gone?: boolean;
  /** It exists only from this moment (a tie game made when the wheel spun): ms. */
  from?: number;
  /**
   * Zip 88 (Alex): its court is SAVED (it went on this court at `at`, ms; 0 for the games the night opened with). A saved game stays on that court
   * whatever changes later (a player taken off, a score cleared): the rule only places games that are not saved yet, around the saved ones.
   */
  pin?: { court: number; at: number };
}

export interface RollResult {
  /** Game number -> the court (1, 2) it was or is played on. Only games that started. */
  court: Map<number, number>;
  /** Game number -> when it went on its court (ms; -Infinity for the games the night opens with). */
  startAt: Map<number, number>;
  /** Court (index 0 = Court 1) -> the game on it now, or null. */
  onCourt: (number | null)[];
  /** Court -> the last game that finished on it (shown as Done while the court waits), or null. */
  lastOn: (number | null)[];
  /** Court -> when it last finished a game (ms), for the time a court has waited. */
  freeSince: (number | null)[];
}

/**
 * THE RULE, replayed. `games` in the schedule's play order (round, then court; Locked doubles: its play order). `courts`: 1 or 2.
 * A game that finished without ever reaching a court (called off while waiting) just leaves the list.
 */
export function rollCourts(games: readonly RollGame[], courts: number): RollResult {
  const n = Math.max(1, Math.min(2, courts));
  const list = games.filter((g) => !g.gone);
  const index = new Map(list.map((g, i) => [g.num, i]));
  const done = new Set<number>();
  const started = new Set<number>();
  const court = new Map<number, number>();
  const startAt = new Map<number, number>();
  const onCourt: (number | null)[] = Array.from({ length: n }, () => null);
  const lastOn: (number | null)[] = Array.from({ length: n }, () => null);
  const freeSince: (number | null)[] = Array.from({ length: n }, () => null);
  // Each player's games in order, to know whether a game is the player's next one.
  const byPlayer = new Map<string, number[]>();
  list.forEach((g, i) => {
    for (const p of g.players) byPlayer.set(p, [...(byPlayer.get(p) ?? []), i]);
  });
  const busy = () => new Set(onCourt.flatMap((num) => (num === null ? [] : [...list[index.get(num)!].players])));
  const isNext = (p: string, i: number) => (byPlayer.get(p) ?? []).every((j) => j >= i || done.has(list[j].num) || started.has(list[j].num));
  // A tie's games start as soon as they exist (the wheel spins only once its group is done). A semifinal, the Final or 3rd place waits for
  // every pool game; its teams decide the rest (a place still tied has no players yet, so that game waits for the tie by itself). Review fix:
  // waiting for the tie games too could take a semifinal whose teams were known OFF its court when the wheel spun later.
  const stageReady = (g: RollGame) => g.rank <= 1 || list.every((x) => (x.rank !== 0 && (g.rank < 3 || x.rank !== 2)) || done.has(x.num));
  const fill = (t: number) => {
    for (let c = 0; c < n; c++) {
      if (onCourt[c] !== null) continue;
      const on = busy();
      const i = list.findIndex(
        (g, k) =>
          !g.pin &&
          !done.has(g.num) &&
          !started.has(g.num) &&
          (g.from ?? -Infinity) <= t &&
          g.players.length > 0 &&
          g.players.every((p) => !on.has(p) && isNext(p, k)) &&
          stageReady(g),
      );
      if (i < 0) continue;
      const g = list[i];
      onCourt[c] = g.num;
      started.add(g.num);
      court.set(g.num, c + 1);
      startAt.set(g.num, t);
    }
  };
  // A saved game goes on its saved court at its saved moment. A game the rule had put there (not saved) steps back off and waits again; a saved
  // game that already finished only keeps its court (it occupies nothing now).
  const placePins = (t: number) => {
    for (const g of list) {
      if (!g.pin || g.pin.at !== t || started.has(g.num)) continue;
      const c = Math.max(0, Math.min(n - 1, g.pin.court - 1));
      started.add(g.num);
      court.set(g.num, c + 1);
      startAt.set(g.num, t);
      if (done.has(g.num)) continue;
      const there = onCourt[c];
      if (there !== null) {
        const other = list[index.get(there)!];
        if (other.pin) continue;
        started.delete(there);
        court.delete(there);
        startAt.delete(there);
      }
      onCourt[c] = g.num;
    }
  };
  // The moments something happens: each finish, each tie game appearing, each saved start.
  const moments = [
    ...new Set([
      ...list.filter((g) => g.doneAt !== null).map((g) => g.doneAt!),
      ...list.filter((g) => g.from !== undefined).map((g) => g.from!),
      ...list.filter((g) => g.pin).map((g) => g.pin!.at),
    ]),
  ].sort((a, b) => a - b);
  fill(-Infinity);
  for (const t of moments) {
    for (const g of list) {
      if (g.doneAt !== t || done.has(g.num)) continue;
      done.add(g.num);
      const c = onCourt.indexOf(g.num);
      if (c >= 0) {
        onCourt[c] = null;
        lastOn[c] = g.num;
        freeSince[c] = t;
      }
    }
    placePins(t);
    fill(t);
  }
  return { court, startAt, onCourt, lastOn, freeSince };
}

/**
 * The same rule asked the other way, for the audit: could a free court have started a game right now? (A game still to play, not on a court, its
 * players all free and each at their next game, its stage ready.) Used by the night simulations to prove no court sits idle when it need not.
 */
export function startable(games: readonly RollGame[], r: RollResult): number[] {
  const list = games.filter((g) => !g.gone);
  const on = new Set(r.onCourt.flatMap((num) => (num === null ? [] : [...(list.find((g) => g.num === num)?.players ?? [])])));
  const doneOrOn = (g: RollGame) => g.doneAt !== null || r.court.has(g.num);
  return list
    .filter((g, k) => {
      if (doneOrOn(g) || !g.players.length) return false;
      if (g.players.some((p) => on.has(p))) return false;
      if (list.some((x, j) => j < k && !doneOrOn(x) && x.players.some((p) => g.players.includes(p)))) return false;
      return g.rank <= 1 || list.every((x) => (x.rank !== 0 && (g.rank < 3 || x.rank !== 2)) || x.doneAt !== null);
    })
    .map((g) => g.num);
}

/**
 * Zip 88 (Alex): how a game's saved court is kept, with no migration: the game row's own `court` column holds the court, and its `claim_at`
 * (unused for games since Zip 71: nothing waits for a Yes) holds "on:" and the moment it went on (the epoch for the games the night opened
 * with). Anything else in claim_at (an old claim's time) is not a saved court.
 */
export const PIN_PREFIX = 'on:';
export const isPinText = (v: string | null | undefined): boolean => typeof v === 'string' && v.startsWith(PIN_PREFIX);
export function pinOf(claimAt: string | null | undefined, court: number): { court: number; at: number } | undefined {
  if (!isPinText(claimAt)) return undefined;
  const at = Date.parse(claimAt!.slice(PIN_PREFIX.length));
  return Number.isFinite(at) ? { court, at } : undefined;
}
export const pinText = (at: number): string => PIN_PREFIX + new Date(Number.isFinite(at) && at > 0 ? at : 0).toISOString();
/** A claim_at that is a real time (an old claim), or null (a saved court is not a time a game finished). */
export const claimTime = (v: string | null | undefined): string | null => (v && !isPinText(v) ? v : null);
