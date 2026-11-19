// Zip 57 (🎾57.tourney3): the Locked doubles night as pure functions, shared by the server, the organizer's file and the player's tournament file
// (never the player download). Everything here is a function of its inputs only, so tests/zip57-schedule.test.ts checks every size 6 to 16.
//   draftTeams     auto-pair the locked-in players by level so team totals are close (strongest with weakest), with "Redo the draw"
//   poolsOf        which teams go in Pool A and Pool B (6 teams and more), balanced by team total
//   schedule       the games: round, court (1 or 2), stage, pool and who plays (a team, a place in a pool, the winner of a game)
//   standings      wins, then head to head; a tie that is still a tie says "Tied" (piece 4 breaks it)
//   resolveGames   who is in each playoff game once the pool games are done
//   timeCheck      is the night running late, and from which round shorter games finish it on time
// The structure (how many rounds, which courts) is shared/tournamentPlan.ts's doublesStructure, the game plan table.
import { doublesStructure, END_BUFFER, type GameTo, PLAYOFF_TO, ROUND_MINUTES } from './tournamentPlan';

// ---------------------------------------------------------------------------------------------------------------------
// Teams
// ---------------------------------------------------------------------------------------------------------------------

/** Fun pickleball names a published team gets (and the dice suggests); never a player's name. No two teams of a tournament share one. */
export const TEAM_NAMES = [
  'Net Ninjas',
  'Dill With It',
  'Kitchen Crew',
  'Third Shot Gang',
  'Dink Dynasty',
  'Lob Stars',
  'Paddle Battle',
  'Erne Squad',
  'Drop Shot Crew',
  'The Dinkers',
  'Spin Doctors',
  'Pickle Pack',
  'Baseline Bandits',
  'Smash Bros',
  'Kitchen Sinkers',
  'Dink Tanks',
  'Volley Llamas',
  'Big Dills',
  'The Lobsters',
  'Court Jesters',
  'Pickled Pros',
  'Rally Cats',
  'Zero Zero Two',
  'Soft Hands',
] as const;
export const TEAM_NAME_MAX = 24;

/** A suggested name nobody else in the tournament has (`used`, any case), at random; never the same as `not` when another exists. */
export function suggestTeamName(used: readonly string[], rnd: () => number = Math.random, not?: string): string {
  const taken = new Set(used.map((n) => n.trim().toLowerCase()));
  const free = TEAM_NAMES.filter((n) => !taken.has(n.toLowerCase()) && n !== not);
  if (free.length) return free[Math.floor(rnd() * free.length)];
  let i = used.length + 1;
  while (taken.has(`team ${i}`)) i++;
  return `Team ${i}`;
}

export interface DraftPlayer {
  id: string;
  name: string;
  /** Hundredths: 360 = 3.6. */
  level: number;
}
export type Pair = [DraftPlayer, DraftPlayer];

/** A team's level total in hundredths (6.1 = 610). */
export const pairTotal = (p: readonly [{ level: number }, { level: number }]): number => p[0].level + p[1].level;
/** Highest total minus lowest total: the smaller, the closer the teams. */
export const spreadOf = (pairs: readonly (readonly [{ level: number }, { level: number }])[]): number => {
  const t = pairs.map(pairTotal);
  return t.length ? Math.max(...t) - Math.min(...t) : 0;
};
/** "6.1", "6.25" (the draft's "= 6.1"). */
export const totalLabel = (hundredths: number): string => String(Math.round(hundredths) / 100);

/** A small seeded random number source (mulberry32), so a draw can be repeated in tests. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled<T>(list: readonly T[], rnd: () => number): T[] {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Strongest with weakest: sorted by level (equal levels in a random order), the 1st with the last, the 2nd with the one before it, and so on. */
function snake(players: readonly DraftPlayer[], rnd: () => number): Pair[] {
  const sorted = shuffled(players, rnd).sort((x, y) => y.level - x.level);
  const out: Pair[] = [];
  for (let i = 0; i < Math.floor(sorted.length / 2); i++) out.push([sorted[i], sorted[sorted.length - 1 - i]]);
  return out;
}

const pairKey = (pairs: readonly Pair[]) =>
  pairs
    .map((p) => [p[0].id, p[1].id].sort().join('+'))
    .sort()
    .join('|');

/**
 * Draft teams (mock 15): pairs the players so team totals are close. The first draw is strongest with weakest. "Redo the draw" (`avoid`: the
 * pairs shown now) picks another pairing whose spread is at most 0.2 worse than the best one found, at random, when there is one. Each pair is
 * strongest first. Teams are in order of their strongest player. An odd player out is left out (Locked doubles needs an even count).
 */
export function draftTeams(players: readonly DraftPlayer[], rnd: () => number = Math.random, avoid?: readonly Pair[]): Pair[] {
  const first = snake(players, rnd);
  const order = (pairs: Pair[]): Pair[] =>
    pairs.map((p) => (p[0].level >= p[1].level ? p : ([p[1], p[0]] as Pair))).sort((x, y) => y[0].level - x[0].level || pairTotal(y) - pairTotal(x));
  if (!avoid) return order(first);
  // Candidates: the snake with other tie orders, and the snake with partners swapped between two teams (each a small step from the best).
  const best = spreadOf(first);
  const seen = new Map<string, Pair[]>();
  const keep = (pairs: Pair[]) => {
    if (spreadOf(pairs) <= best + 20) seen.set(pairKey(pairs), pairs);
  };
  for (let i = 0; i < 120; i++) {
    const base = snake(players, rnd);
    keep(base);
    if (base.length >= 2) {
      const x = Math.floor(rnd() * base.length);
      let y = Math.floor(rnd() * (base.length - 1));
      if (y >= x) y++;
      const sx = Math.floor(rnd() * 2);
      const sy = Math.floor(rnd() * 2);
      const next = base.map((p) => [...p] as Pair);
      [next[x][sx], next[y][sy]] = [next[y][sy], next[x][sx]];
      keep(next);
    }
  }
  const now = pairKey(avoid as Pair[]);
  const other = [...seen.entries()].filter(([k]) => k !== now).map(([, v]) => v);
  return order(other.length ? other[Math.floor(rnd() * other.length)] : first);
}

/** The draft's one line under the teams: who got whom, in plain words. */
export function draftNote(pairs: readonly Pair[]): string {
  if (pairs.length < 2) return '';
  return 'Strongest paired with weakest, so the team totals are close. Swap anyone you like.';
}

// ---------------------------------------------------------------------------------------------------------------------
// Pools and the schedule
// ---------------------------------------------------------------------------------------------------------------------

export type PoolName = 'A' | 'B';
export type GameStage = 'pool' | 'semi' | 'final' | 'third';

/**
 * Who plays in a game: 'T3' the team in seat 3; 'P1' 1st place of the round robin (3 to 5 teams); 'A1' / 'B2' a place in Pool A or B;
 * 'W12' / 'L12' the winner or loser of game 12.
 */
export type Slot = string;

export interface PlannedGame {
  /** Game number for the night, in order (round, then court). */
  num: number;
  round: number;
  /** 1 or 2: which of the booked courts. */
  court: number;
  stage: GameStage;
  pool: PoolName | null;
  a: Slot;
  b: Slot;
}

/** Pool sizes for a team count (6 teams and more): Pool A gets the extra team (4 and 3 for 7). */
export function poolSizes(teams: number): [number, number] | null {
  if (teams < 6) return null;
  const a = Math.ceil(teams / 2);
  return [a, teams - a];
}

/**
 * Which pool each team goes in, balanced by level total: teams from the strongest total down go A, B, B, A, A, B, B, A (a pool that is full takes
 * no more). `totals` in seat order (seat 1 first). Returns the pool for each seat.
 */
export function poolsOf(totals: readonly number[]): PoolName[] {
  const sizes = poolSizes(totals.length);
  if (!sizes) return totals.map(() => 'A');
  const order = totals.map((t, i) => ({ t, i })).sort((x, y) => y.t - x.t || x.i - y.i);
  const pattern: PoolName[] = ['A', 'B', 'B', 'A'];
  const out: PoolName[] = new Array(totals.length);
  const count = { A: 0, B: 0 };
  order.forEach(({ i }, k) => {
    let p = pattern[k % 4];
    if (count[p] >= (p === 'A' ? sizes[0] : sizes[1])) p = p === 'A' ? 'B' : 'A';
    out[i] = p;
    count[p]++;
  });
  return out;
}

type Duel = [number, number];

/** One game at a time, in an order with no team playing two in a row where the size allows it (3 teams cannot: someone always does). */
const SEQUENCE: Record<number, Duel[]> = {
  2: [[1, 2]],
  3: [
    [1, 2],
    [1, 3],
    [2, 3],
  ],
  // The pool of 4 on its own court. With a pool of 3 beside it (7 teams on 2 courts) its last 3 games share 2 rounds, so games 4 and 5 are
  // two different pairs of teams (they are played side by side).
  4: [
    [1, 2],
    [3, 4],
    [1, 3],
    [2, 4],
    [1, 4],
    [2, 3],
  ],
  5: [
    [1, 2],
    [3, 4],
    [5, 1],
    [2, 3],
    [4, 5],
    [1, 3],
    [2, 4],
    [3, 5],
    [4, 1],
    [5, 2],
  ],
};

/** Every round on 2 courts, 4 or 5 teams together (5: one team sits each round, never twice; the circle method). */
function roundRobinRounds(k: number): Duel[][] {
  if (k === 4)
    return [
      [
        [1, 2],
        [3, 4],
      ],
      [
        [1, 3],
        [2, 4],
      ],
      [
        [1, 4],
        [2, 3],
      ],
    ];
  // 5 teams: a 6th "sits" seat (0) and the circle method; a team drawn against seat 0 sits that round.
  const s = [0, 1, 2, 3, 4, 5];
  const out: Duel[][] = [];
  for (let r = 0; r < 5; r++) {
    const round: Duel[] = [];
    for (let i = 0; i < 3; i++) {
      const x = s[i];
      const y = s[5 - i];
      if (x !== 0 && y !== 0) round.push(x < y ? [x, y] : [y, x]);
    }
    out.push(round);
    s.splice(1, 0, s.pop()!);
  }
  return out;
}

/** The 7-team order for Pool A (4 teams) so its games 4 and 5 can share a round: 1-2, 3-4, 1-3, then 1-4 with 2-3, then 2-4. */
const POOL4_BESIDE_3: Duel[] = [
  [1, 2],
  [3, 4],
  [1, 3],
  [1, 4],
  [2, 3],
  [2, 4],
];

/**
 * THE SCHEDULE: a pure function of the team count and the courts (1 or 2), following the game plan table:
 *   3 teams       3 games one at a time, then the Final (top 2)
 *   4 or 5 teams  round robin (2 courts: rounds side by side; 1 court: one after another), then the Final, and on 2 courts the 3rd place game
 *   6 to 8 teams  two pools (seats 1..a are Pool A, the rest Pool B), each on its own court; then semifinals (pool winner vs the other pool's
 *                 runner-up), then the Final and the 3rd place game. On 1 court the pools take turns and there is no 3rd place game.
 * Teams are seats 1..teams.
 */
export function schedule(teams: number, courts: number): PlannedGame[] {
  const s = doublesStructure(teams, courts);
  const games: Omit<PlannedGame, 'num'>[] = [];
  const add = (round: number, court: number, stage: GameStage, pool: PoolName | null, a: Slot, b: Slot) => games.push({ round, court, stage, pool, a, b });
  const T = (seat: number) => `T${seat}`;
  let round = 0;
  if (s.shape === 'rr3' || (s.shape === 'rr' && s.courtsUsed === 1)) {
    for (const [x, y] of SEQUENCE[teams]) add(++round, 1, 'pool', null, T(x), T(y));
    add(++round, 1, 'final', null, 'P1', 'P2');
    return number(games);
  }
  if (s.shape === 'rr') {
    for (const duels of roundRobinRounds(teams)) {
      round++;
      // The courts swap every other round, so no team stays on one court all night (mock 16: Court 9, Court 10, Court 9).
      const placed = duels.map((d, i) => ({ d, court: round % 2 === 0 && duels.length === 2 ? 2 - i : i + 1 })).sort((p, q) => p.court - q.court);
      for (const { d, court } of placed) add(round, court, 'pool', null, T(d[0]), T(d[1]));
    }
    round++;
    add(round, 1, 'final', null, 'P1', 'P2');
    add(round, 2, 'third', null, 'P3', 'P4');
    return number(games);
  }
  // Pools.
  const [a, b] = poolSizes(teams)!;
  const seqA = (a === 4 && b === 3 ? POOL4_BESIDE_3 : SEQUENCE[a]).map(([x, y]): Duel => [x, y]);
  const seqB = SEQUENCE[b].map(([x, y]): Duel => [a + x, a + y]);
  if (s.courtsUsed === 2) {
    const common = Math.min(seqA.length, seqB.length);
    for (let i = 0; i < common; i++) {
      round++;
      add(round, 1, 'pool', 'A', T(seqA[i][0]), T(seqA[i][1]));
      add(round, 2, 'pool', 'B', T(seqB[i][0]), T(seqB[i][1]));
    }
    // The pool of 3 is done: the pool of 4 uses both courts for what it has left.
    for (let i = common; i < seqA.length; i += 2) {
      round++;
      add(round, 1, 'pool', 'A', T(seqA[i][0]), T(seqA[i][1]));
      if (seqA[i + 1]) add(round, 2, 'pool', 'A', T(seqA[i + 1][0]), T(seqA[i + 1][1]));
    }
    round++;
    add(round, 1, 'semi', null, 'A1', 'B2');
    add(round, 2, 'semi', null, 'B1', 'A2');
    const semi1 = games.length - 1;
    round++;
    add(round, 1, 'final', null, `W${semi1}`, `W${semi1 + 1}`);
    add(round, 2, 'third', null, `L${semi1}`, `L${semi1 + 1}`);
    return number(games);
  }
  // 1 court: the pools take turns (A, B, A, B, ...), so no team plays two in a row. A pool of 4 beside a pool of 3 (14 players) plays two of its
  // games for each one of the other pool: A A B, A A B, A A B, its games in the order where each two in a row share no team.
  if (a === 4 && b === 3) {
    const seq4 = SEQUENCE[4];
    for (let i = 0; i < 3; i++) {
      for (const [x, y] of seq4.slice(i * 2, i * 2 + 2)) add(++round, 1, 'pool', 'A', T(x), T(y));
      add(++round, 1, 'pool', 'B', T(seqB[i][0]), T(seqB[i][1]));
    }
  } else {
    for (let i = 0; i < Math.max(seqA.length, seqB.length); i++) {
      if (seqA[i]) add(++round, 1, 'pool', 'A', T(seqA[i][0]), T(seqA[i][1]));
      if (seqB[i]) add(++round, 1, 'pool', 'B', T(seqB[i][0]), T(seqB[i][1]));
    }
  }
  add(++round, 1, 'semi', null, 'A1', 'B2');
  const semi1 = games.length;
  add(++round, 1, 'semi', null, 'B1', 'A2');
  add(++round, 1, 'final', null, `W${semi1}`, `W${semi1 + 1}`);
  return number(games);
}

/** Game numbers in play order (round, then court). 'W'/'L' slots were written with 1-based positions, which are the numbers. */
function number(games: Omit<PlannedGame, 'num'>[]): PlannedGame[] {
  return games.map((g, i) => ({ ...g, num: i + 1 }));
}

/** The pool a seat plays in (null: one group). */
export function poolOfSeat(teams: number, seat: number): PoolName | null {
  const sizes = poolSizes(teams);
  if (!sizes) return null;
  return seat <= sizes[0] ? 'A' : 'B';
}

/** How many times a team plays two games in a row with no game between (rounds back to back with one game each, or on 1 court). */
export function backToBack(games: readonly PlannedGame[], seat: number): number {
  const mine = games.filter((g) => g.stage === 'pool' && (g.a === `T${seat}` || g.b === `T${seat}`)).map((g) => g.round);
  const perRound = new Map<number, number>();
  for (const g of games) perRound.set(g.round, (perRound.get(g.round) ?? 0) + 1);
  let n = 0;
  for (let i = 1; i < mine.length; i++) if (mine[i] === mine[i - 1] + 1 && perRound.get(mine[i]) === 1 && perRound.get(mine[i - 1]) === 1) n++;
  return n;
}

// ---------------------------------------------------------------------------------------------------------------------
// Results and standings
// ---------------------------------------------------------------------------------------------------------------------

/** A game's result as the standings see it: which side won ('a' or 'b'), or none yet; skipped games count for nobody. */
export interface GameResult {
  num: number;
  winner: 'a' | 'b' | null;
  skipped?: boolean;
}

export interface StandingRow {
  seat: number;
  wins: number;
  losses: number;
  /** 1, 2, 3 in order (tied teams keep their seat order). */
  rank: number;
  /** Still level with another team after head to head, once every game of the group is in. */
  tied: boolean;
}

/** Wins and losses from pool games (a game whose teams are seats). */
function record(games: readonly PlannedGame[], results: ReadonlyMap<number, GameResult>, seats: readonly number[]) {
  const w = new Map(seats.map((s) => [s, 0]));
  const l = new Map(seats.map((s) => [s, 0]));
  const beat = new Map<string, true>();
  for (const g of games) {
    if (g.stage !== 'pool') continue;
    const r = results.get(g.num);
    if (!r || r.skipped || !r.winner) continue;
    const x = Number(g.a.slice(1));
    const y = Number(g.b.slice(1));
    const [win, lose] = r.winner === 'a' ? [x, y] : [y, x];
    if (!w.has(win) || !l.has(lose)) continue;
    w.set(win, w.get(win)! + 1);
    l.set(lose, l.get(lose)! + 1);
    beat.set(`${win}>${lose}`, true);
  }
  return { w, l, beat };
}

/** Every pool game of these seats has a result or was skipped. */
export function groupDone(games: readonly PlannedGame[], results: ReadonlyMap<number, GameResult>, seats: readonly number[]): boolean {
  const set = new Set(seats.map((s) => `T${s}`));
  return games.filter((g) => g.stage === 'pool' && set.has(g.a)).every((g) => {
    const r = results.get(g.num);
    return !!r && (r.skipped || !!r.winner);
  });
}

/**
 * Standings for one group (a pool, or all teams in a round robin): most wins first; teams level on wins are ordered by head to head (wins against
 * each other); still level, they stay in seat order and, once every game of the group is in, are marked tied (piece 4 breaks a tie that matters).
 */
export function standings(games: readonly PlannedGame[], results: ReadonlyMap<number, GameResult>, seats: readonly number[], out: ReadonlySet<number> = new Set()): StandingRow[] {
  const { w, l, beat } = record(games, results, seats);
  const done = groupDone(games, results, seats);
  // A team that left during the night goes below every team still playing (it cannot take a playoff place).
  const byWins = [...seats].sort((x, y) => Number(out.has(x)) - Number(out.has(y)) || w.get(y)! - w.get(x)! || x - y);
  const rows: StandingRow[] = [];
  let i = 0;
  while (i < byWins.length) {
    let j = i;
    while (j < byWins.length && w.get(byWins[j]) === w.get(byWins[i]) && out.has(byWins[j]) === out.has(byWins[i])) j++;
    const block = byWins.slice(i, j);
    // Head to head inside the block: wins against the others in it.
    const h2h = new Map(block.map((s) => [s, block.filter((o) => beat.has(`${s}>${o}`)).length]));
    const ordered = [...block].sort((x, y) => h2h.get(y)! - h2h.get(x)! || x - y);
    for (const s of ordered) {
      const level = ordered.filter((o) => h2h.get(o) === h2h.get(s));
      rows.push({ seat: s, wins: w.get(s)!, losses: l.get(s)!, rank: rows.length + 1, tied: done && level.length > 1 && !out.has(s) });
    }
    i = j;
  }
  return rows;
}

/** "1-0" (wins-losses). */
export const recordLabel = (r: Pick<StandingRow, 'wins' | 'losses'>): string => `${r.wins}-${r.losses}`;

/** Every team that is in a slot once the games before it are in, or null (not decided yet, or tied: piece 4). */
export interface Resolved {
  num: number;
  a: number | null;
  b: number | null;
  /** A place this game needs is tied after head to head (the screens say "Tied"; piece 4 settles it). */
  tied: boolean;
  /** A side can never be filled (its team left, or the game it waited on was not played): the game is not played; the team there goes on. */
  never: boolean;
}

/**
 * Who plays each game: seats for the pool games, and for the playoffs once the games before them are in (a place in a pool once that pool is done
 * and the place is not tied; the winner or loser of a game once it has a result). A place that is still tied stays empty and says so.
 * `frozen`: the seats a game had when it got a result (a later change to an earlier game never moves a result to another team).
 * `out`: teams that left during pool play (they drop below every team still playing). A team that leaves after its pool is done keeps its place;
 * a playoff game it can no longer play is a walkover: the other team goes on (`never` on the empty side, and Winner of it is the team there).
 */
export function resolveGames(
  teams: number,
  games: readonly PlannedGame[],
  results: ReadonlyMap<number, GameResult>,
  out: ReadonlySet<number> = new Set(),
  frozen: ReadonlyMap<number, { a: number | null; b: number | null }> = new Map(),
  gone: ReadonlySet<number> = out,
): Resolved[] {
  const sizes = poolSizes(teams);
  const groups: Record<string, number[]> = sizes
    ? { A: range(1, sizes[0]), B: range(sizes[0] + 1, teams) }
    : { P: range(1, teams) };
  const table: Record<string, StandingRow[]> = {};
  const done: Record<string, boolean> = {};
  for (const [k, seats] of Object.entries(groups)) {
    table[k] = standings(games, results, seats, out);
    done[k] = groupDone(games, results, seats);
  }
  const byNum = new Map<number, Resolved>();
  type Place = { seat: number | null; tied: boolean; never: boolean };
  const place = (slot: Slot, partner: Slot): Place => {
    const k = slot[0];
    const n = Number(slot.slice(1));
    if (k === 'T') return { seat: n, tied: false, never: false };
    if (k === 'W' || k === 'L') {
      const g = byNum.get(n);
      const r = results.get(n);
      if (!g) return { seat: null, tied: false, never: false };
      // Not played (skipped, or a side that can never be filled): the one team still in it goes on; nobody is its loser.
      if (r?.skipped || g.never) {
        const still = [g.a, g.b].filter((x): x is number => x !== null && !gone.has(x));
        if (k === 'W' && still.length === 1) return { seat: still[0], tied: false, never: false };
        if (k === 'L' || g.never || (g.a !== null && g.b !== null)) return { seat: null, tied: false, never: true };
        return { seat: null, tied: false, never: false };
      }
      if (!r || !r.winner || g.a === null || g.b === null) return { seat: null, tied: false, never: false };
      const win = r.winner === 'a' ? g.a : g.b;
      return { seat: k === 'W' ? win : win === g.a ? g.b : g.a, tied: false, never: false };
    }
    if (!done[k]) return { seat: null, tied: false, never: false };
    const rows = table[k];
    const row = rows[n - 1];
    if (!row || out.has(row.seat)) return { seat: null, tied: false, never: true };
    if (!row.tied) return { seat: row.seat, tied: false, never: false };
    // A tie that does not change this game (1st and 2nd tied, and this game is 1st against 2nd of the same group): both are in, either way.
    if (partner[0] === k) {
      const m = Number(partner.slice(1));
      const levelSeats = rows.filter((x) => x.tied && x.wins === row.wins).map((x) => x.rank);
      if (levelSeats.length === 2 && levelSeats.includes(n) && levelSeats.includes(m)) return { seat: row.seat, tied: false, never: false };
    }
    return { seat: null, tied: true, never: false };
  };
  for (const g of games) {
    const f = frozen.get(g.num);
    if (f && (f.a !== null || f.b !== null)) {
      byNum.set(g.num, { num: g.num, a: f.a, b: f.b, tied: false, never: f.a === null || f.b === null });
      continue;
    }
    const a = place(g.a, g.b);
    const b = place(g.b, g.a);
    byNum.set(g.num, { num: g.num, a: a.seat, b: b.seat, tied: a.tied || b.tied, never: a.never || b.never });
  }
  return games.map((g) => byNum.get(g.num)!);
}

const range = (from: number, to: number) => Array.from({ length: Math.max(0, to - from + 1) }, (_, i) => from + i);

/** The seats of each group (Pool A, Pool B, or everyone). */
export function groupsOf(teams: number): { pool: PoolName | null; seats: number[] }[] {
  const sizes = poolSizes(teams);
  return sizes ? [{ pool: 'A', seats: range(1, sizes[0]) }, { pool: 'B', seats: range(sizes[0] + 1, teams) }] : [{ pool: null, seats: range(1, teams) }];
}

/** What a playoff slot means in words, before it is decided ("If you finish in the top 2"). */
export function slotWords(stage: GameStage, pool: PoolName | null): string {
  if (stage === 'semi') return pool ? `If you finish in the top 2 of Pool ${pool}` : 'If you finish in the top 2 of your pool';
  if (stage === 'third') return 'If you finish 3rd or 4th';
  return 'If you finish in the top 2';
}

// ---------------------------------------------------------------------------------------------------------------------
// Time check (smart timing)
// ---------------------------------------------------------------------------------------------------------------------

export interface RoundState {
  round: number;
  /** A pool round can be shortened; semifinals, the Final and 3rd place are always to 11. */
  pool: boolean;
  /** What its games are played to now (the plan, or a shorter length the organizer applied). */
  playTo: GameTo;
  /** Every game in it has a result (or was skipped). */
  done: boolean;
  /** When its last game got its result (minutes after midnight the same night), if done. */
  doneAt?: number;
  /** Some game in it has a result already (a round with none can still be shortened: "play to 9 this round"). */
  anyResult?: boolean;
  /** Zip 61: never shortened (Americano's last round), though it is counted at its own length. */
  keep?: boolean;
}

export interface TimeCheck {
  /** The round being played now (the first one not done), or null when the night is over. */
  current: number | null;
  /** Minutes behind the plan as it stands now (0 or more). */
  behind: number;
  /** When the last round should end now (minutes after midnight). */
  finish: number;
  /** Shorter games are suggested from this round, to this length (null: none needed, or nothing left to shorten). */
  suggest: { fromRound: number; to: GameTo; stillOver: number } | null;
}

const lenOf = (r: RoundState, to?: GameTo) => (r.pool ? ROUND_MINUTES[to ?? r.playTo] : ROUND_MINUTES[PLAYOFF_TO]);

/**
 * Smart timing. Each round is planned back to back from the start; a round that finished late pushes the rest. The current round ends at its
 * planned end pushed by that, or now, whichever is later. When the last round would end after the courts close minus the 10 minute buffer,
 * it suggests shorter pool games: games to 9 from the latest round that is enough, else to 7 from the latest round that is enough, else to 7 from
 * the first round that can change (and says how far over it still runs). A round with a result in it is never changed; playoffs never are.
 */
export function timeCheck(rounds: readonly RoundState[], startMin: number, endMin: number, nowMin: number): TimeCheck {
  const list = [...rounds].sort((a, b) => a.round - b.round);
  const cur = list.find((r) => !r.done) ?? null;
  // Planned (as the plan stands now) back to back from the start.
  const planned = new Map<number, { start: number; end: number }>();
  let t = startMin;
  for (const r of list) {
    planned.set(r.round, { start: t, end: t + lenOf(r) });
    t += lenOf(r);
  }
  const plannedFinish = t;
  if (!cur) return { current: null, behind: 0, finish: plannedFinish, suggest: null };
  // When the current round really started: the end of the round before it (when its last result came in), or the planned start.
  const prev = list.filter((r) => r.round < cur.round).pop();
  const startedAt = Math.max(planned.get(cur.round)!.start, prev?.doneAt ?? planned.get(cur.round)!.start);
  const after = list.filter((r) => r.round > cur.round);
  // Rounds that can still change: the ones after this one, and this one while none of its games has a result. Never the playoffs.
  const open = [...(cur.pool && !cur.anyResult && !cur.keep ? [cur] : []), ...after.filter((r) => !r.anyResult && !r.keep)];
  /** When the night ends if pool rounds from `from` on (that can still change) are played to `to`. */
  const ending = (to?: GameTo, from?: number) => {
    const len = (r: RoundState) => lenOf(r, to !== undefined && from !== undefined && r.pool && r.round >= from && open.includes(r) ? minLen(r.playTo, to) : undefined);
    return Math.max(startedAt + len(cur), nowMin) + after.reduce((sum, r) => sum + len(r), 0);
  };
  const finish = ending();
  const behind = Math.max(0, Math.round(finish - plannedFinish));
  const limit = endMin - END_BUFFER;
  if (finish <= limit) return { current: cur.round, behind, finish, suggest: null };
  const pools = open.filter((r) => r.pool);
  for (const to of [9, 7] as GameTo[]) {
    // The latest round from which this length is enough.
    for (let i = pools.length - 1; i >= 0; i--) {
      if (ending(to, pools[i].round) <= limit && pools.slice(i).some((r) => r.playTo > to)) return { current: cur.round, behind, finish, suggest: { fromRound: pools[i].round, to, stillOver: 0 } };
    }
  }
  const first = pools.find((r) => r.playTo > 7);
  if (!first) return { current: cur.round, behind, finish, suggest: null };
  return { current: cur.round, behind, finish, suggest: { fromRound: first.round, to: 7, stillOver: Math.max(0, Math.round(ending(7, first.round) - limit)) } };
}
const minLen = (a: GameTo, b: GameTo): GameTo => (a < b ? a : b);

/**
 * The Time check words (players and the organizer read the same): "Running about 8 minutes behind. From Round 5 on, play to 7 so we finish on
 * time." With nothing behind (a plan that was too tight from the start): "The courts close at 10:00 PM. From Round 3 on, ...". When even that is
 * not enough: "... play to 7. That still runs about 9 minutes over."
 */
export function timeCheckWords(behind: number, fromRound: number, to: GameTo, closeLabel: string, stillOver = 0): string {
  const lead = behind > 0 ? `Running about ${behind} ${behind === 1 ? 'minute' : 'minutes'} behind.` : `The courts close at ${closeLabel}.`;
  return stillOver > 0
    ? `${lead} From Round ${fromRound} on, play to ${to}. That still runs about ${stillOver} ${stillOver === 1 ? 'minute' : 'minutes'} over.`
    : `${lead} From Round ${fromRound} on, play to ${to} so we finish on time.`;
}
