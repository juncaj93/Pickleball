// Zip 57 (🎾57.tourney3): the Locked doubles night as pure functions, shared by the server, the organizer's file and the player's tournament file
// (never the player download). Everything here is a function of its inputs only, so tests/zip57-schedule.test.ts checks every size 6 to 16.
//   draftTeams     auto-pair the locked-in players by level so team totals are close (strongest with weakest), with "Redo the draw"
//   poolsOf        which teams go in Pool A and Pool B (6 teams and more), balanced by team total
//   schedule       the games: round, court (1 or 2), stage, pool and who plays (a team, a place in a pool, the winner of a game)
//   standings      THE ranking (Zip 72, one tie rule everywhere): wins, then head to head (only exactly 2 level, and they played), then point
//                  difference, then points scored; still level says "Tied" (the wheel, or the organizer's picks, break it)
//   resolveGames   who is in each playoff game once the pool games are done
//   timeCheck      is the night running late, and from which round shorter games finish it on time
// The structure (how many rounds, which courts) is shared/tournamentPlan.ts's doublesStructure, the game plan table.
import { doublesStructure, END_BUFFER, type GameTo, PLAYOFF_TO, ROUND_MINUTES } from './tournamentPlan';
import { groupName } from './scores';

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
export type GameStage = 'pool' | 'semi' | 'final' | 'third' | 'tie';

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
  // The pool of 4 on its own court (7 teams on 2 courts have their own order: FOURTEEN_TWO_COURTS).
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

/**
 * Zip 80: 14 players on 2 courts (Pool A of 4 beside Pool B of 3), round by round: [court 1, court 2]. The only kind of order where no team plays
 * 3 rounds in a row, even counting the semifinal right after the pools, and nobody sits more than 2 in a row (every order was tried): Pool A
 * opens on both courts, then each Pool B game is played beside a Pool A game (Pool B stays on Court 2, the Drive group's court), and the
 * last pool round is one Pool A game. Seats are pool places (Pool B's 1 to 3 are seats 5 to 7).
 */
const FOURTEEN_TWO_COURTS: [[PoolName, Duel], [PoolName, Duel] | null][] = [
  [['A', [1, 2]], ['A', [3, 4]]],
  [['A', [1, 3]], ['B', [1, 2]]],
  [['A', [2, 4]], ['B', [1, 3]]],
  [['A', [1, 4]], ['B', [2, 3]]],
  [['A', [2, 3]], null],
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
  const seqA = SEQUENCE[a].map(([x, y]): Duel => [x, y]);
  const seqB = SEQUENCE[b].map(([x, y]): Duel => [a + x, a + y]);
  if (s.courtsUsed === 2) {
    if (a === 4 && b === 3) {
      for (const both of FOURTEEN_TWO_COURTS) {
        round++;
        both.forEach((g, i) => {
          if (!g) return;
          const [pool, [x, y]] = g;
          const off = pool === 'A' ? 0 : a;
          add(round, i + 1, 'pool', pool, T(off + x), T(off + y));
        });
      }
    } else {
      // Pools of the same size: one game of each pool every round, side by side.
      for (let i = 0; i < seqA.length; i++) {
        round++;
        add(round, 1, 'pool', 'A', T(seqA[i][0]), T(seqA[i][1]));
        add(round, 2, 'pool', 'B', T(seqB[i][0]), T(seqB[i][1]));
      }
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

/**
 * A game's result as the standings see it: which side won ('a' or 'b'), or none yet; skipped games count for nobody. Zip 72: the points each side
 * scored (Locked doubles keeps scores now; a result from before has none, and counts as a win with no points).
 */
export interface GameResult {
  num: number;
  winner: 'a' | 'b' | null;
  skipped?: boolean;
  scoreA?: number | null;
  scoreB?: number | null;
}

export interface StandingRow {
  seat: number;
  wins: number;
  losses: number;
  /** Zip 72: points scored and given up in this group's pool games, and the difference (scored minus given up). */
  pointsFor: number;
  pointsAgainst: number;
  diff: number;
  /** 1, 2, 3 in order (tied teams keep their seat order). */
  rank: number;
  /** Still level with another team on every rule, once every game of the group is in. */
  tied: boolean;
  /** Zip 58: which run of still-level teams this row is in (rows with the same `block` are tied with each other). */
  block?: number;
}

/** Each team's numbers from pool games (a game whose teams are seats): wins, losses, points, and who beat whom. */
interface Record_ {
  w: Map<number, number>;
  l: Map<number, number>;
  pf: Map<number, number>;
  pa: Map<number, number>;
  beat: Map<string, true>;
}

/** Wins, losses and points from pool games (a game whose teams are seats). */
function record(games: readonly PlannedGame[], results: ReadonlyMap<number, GameResult>, seats: readonly number[]): Record_ {
  const zero = () => new Map(seats.map((s) => [s, 0]));
  const w = zero();
  const l = zero();
  const pf = zero();
  const pa = zero();
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
    if (typeof r.scoreA === 'number' && typeof r.scoreB === 'number') {
      pf.set(x, pf.get(x)! + r.scoreA);
      pa.set(x, pa.get(x)! + r.scoreB);
      pf.set(y, pf.get(y)! + r.scoreB);
      pa.set(y, pa.get(y)! + r.scoreA);
    }
  }
  return { w, l, pf, pa, beat };
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
 * Zip 72, THE TIE RULE (Alex, Nov 20; one rule everywhere): teams level on wins are split by
 *   1. head to head, only when exactly 2 teams are level and they played each other (the winner of that game goes first);
 *   2. point difference (points scored minus points given up, pool games of the group);
 *   3. points scored;
 * and any teams still level after a split go through the same steps again (so two left level after point difference are settled by their
 * game). Teams level on all of it stay level: the wheel (three) or the organizer's picks (four or more) settle it. Returns the runs still level,
 * in order (each run in seat order).
 */
function settle(block: readonly number[], rec: Record_): number[][] {
  if (block.length <= 1) return [[...block]];
  if (block.length === 2) {
    const [x, y] = block;
    if (rec.beat.has(`${x}>${y}`) !== rec.beat.has(`${y}>${x}`)) return rec.beat.has(`${x}>${y}`) ? [[x], [y]] : [[y], [x]];
  }
  const diff = (s: number) => rec.pf.get(s)! - rec.pa.get(s)!;
  for (const key of [diff, (s: number) => rec.pf.get(s)!]) {
    const values = [...new Set(block.map(key))].sort((p, q) => q - p);
    if (values.length > 1) return values.flatMap((v) => settle(block.filter((s) => key(s) === v), rec));
  }
  return [[...block].sort((p, q) => p - q)];
}

/**
 * Standings for one group (a pool, or all teams in a round robin): most wins first; teams level on wins are ordered by THE TIE RULE (settle
 * above); still level, they stay in seat order and, once every game of the group is in, are marked tied.
 */
export function standings(games: readonly PlannedGame[], results: ReadonlyMap<number, GameResult>, seats: readonly number[], out: ReadonlySet<number> = new Set()): StandingRow[] {
  const rec = record(games, results, seats);
  const { w, l, pf, pa } = rec;
  const done = groupDone(games, results, seats);
  // A team that left during the night goes below every team still playing (it cannot take a playoff place).
  const byWins = [...seats].sort((x, y) => Number(out.has(x)) - Number(out.has(y)) || w.get(y)! - w.get(x)! || x - y);
  const rows: StandingRow[] = [];
  let i = 0;
  let blockNo = 0;
  while (i < byWins.length) {
    let j = i;
    while (j < byWins.length && w.get(byWins[j]) === w.get(byWins[i]) && out.has(byWins[j]) === out.has(byWins[i])) j++;
    for (const level of settle(byWins.slice(i, j), rec)) {
      blockNo++;
      for (const s of level)
        rows.push({
          seat: s,
          wins: w.get(s)!,
          losses: l.get(s)!,
          pointsFor: pf.get(s)!,
          pointsAgainst: pa.get(s)!,
          diff: pf.get(s)! - pa.get(s)!,
          rank: rows.length + 1,
          tied: done && level.length > 1 && !out.has(s),
          block: blockNo,
        });
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
  /** A place this game needs is still tied after the tie rule (the screens say "Tied"; the wheel or the picks settle it). */
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
  /** Zip 58: the stored answers to ties (the wheel, the organizer's picks). */
  records: readonly TieRecord[] = [],
): Resolved[] {
  const sizes = poolSizes(teams);
  const groups: Record<string, number[]> = sizes
    ? { A: range(1, sizes[0]), B: range(sizes[0] + 1, teams) }
    : { P: range(1, teams) };
  const table: Record<string, StandingRow[]> = {};
  const done: Record<string, boolean> = {};
  for (const [k, seats] of Object.entries(groups)) {
    // Zip 58: a tie that matters is settled by its answer (the wheel and its playoff games, or the organizer's picks); one that does not matter
    // (the places it shares are in the same game) is not a tie at all.
    table[k] = groupTable(teams, games, results, out, records, k as GroupKey, gone).rows;
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
    // Zip 58: a tie that does not change this game (1st and 2nd tied, and this game is 1st against 2nd) is no tie (groupTable); one that does
    // waits for its answer.
    void partner;
    if (!row.tied) return { seat: row.seat, tied: false, never: false };
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

// Zip 78: a pool's name in words ("Dink group", "Drive group"), kept in the tiny scores file so the players' download never pulls this one in.
export { groupName };

/** The seats of each group (Pool A, Pool B, or everyone). */
export function groupsOf(teams: number): { pool: PoolName | null; seats: number[] }[] {
  const sizes = poolSizes(teams);
  return sizes ? [{ pool: 'A', seats: range(1, sizes[0]) }, { pool: 'B', seats: range(sizes[0] + 1, teams) }] : [{ pool: null, seats: range(1, teams) }];
}

/** What a playoff slot means in words, before it is decided ("If you finish in the top 2"). */
export function slotWords(stage: GameStage, pool: PoolName | null): string {
  if (stage === 'semi') return pool ? `If you finish in the top 2 of the ${groupName(pool)}` : 'If you finish in the top 2 of your group';
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
  /**
   * Zip 80: the tie games (Game A, Game B, to 5) this round waits for end at this time (minutes after midnight): their last result once all
   * are in, else now plus TIE_MINUTES for each game still to finish on the busiest court (tieGamesAhead). They are played as soon as the wheel
   * spins, on a free court, so they can run beside a pool game; this round's own games start when both are over.
   */
  tiesEnd?: number;
  /** Zip 89: a break before it (minutes: 5 planned, or as taken once it started). */
  gap?: number;
}

/** Zip 80: how many tie games are played one after another (the most on any one court: a tie's Game A and Game B share a court). */
export function tieGamesAhead(games: readonly { stage: string; court: number }[]): number {
  const perCourt = new Map<number, number>();
  for (const g of games) if (g.stage === 'tie') perCourt.set(g.court, (perCourt.get(g.court) ?? 0) + 1);
  return Math.max(0, ...perCourt.values());
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
 * planned end pushed by that, or now, whichever is later. When the last round would end after the courts close minus the buffer (Zip 89: 20 minutes),
 * it suggests shorter pool games: games to 9 from the latest round that is enough, else to 7 from the latest round that is enough, else to 7 from
 * the first round that can change (and says how far over it still runs). A round with a result in it is never changed; playoffs never are.
 */
export function timeCheck(rounds: readonly RoundState[], startMin: number, endMin: number, nowMin: number, pace?: number): TimeCheck {
  const list = [...rounds].sort((a, b) => a.round - b.round);
  // Zip 89: a night with a bonus round in it was judged by its measured pace when the bonus was added, so from then on the rounds still to play
  // count at that pace (minutes for a round to 11, scaled to the round's length), and a round starts when the one before it ended (not at a
  // planned time). Without `pace` (no bonus), everything is exactly as before.
  const len = pace === undefined ? lenOf : (r: RoundState, to?: GameTo) => (lenOf(r, to) * pace) / ROUND_MINUTES[PLAYOFF_TO];
  const cur = list.find((r) => !r.done) ?? null;
  // Planned (as the plan stands now) back to back from the start.
  const planned = new Map<number, { start: number; end: number }>();
  let t = startMin;
  for (const r of list) {
    // Zip 80: the plan never has a tie in it (nobody knew there would be one), so the minutes a tie adds show as time behind.
    t += r.gap ?? 0;
    planned.set(r.round, { start: t, end: t + lenOf(r) });
    t += lenOf(r);
  }
  const plannedFinish = t;
  if (!cur) return { current: null, behind: 0, finish: plannedFinish, suggest: null };
  // When the current round really started: the end of the round before it (when its last result came in), or the planned start.
  const prev = list.filter((r) => r.round < cur.round).pop();
  // Zip 80: a round that waits for tie games starts once they are over too.
  const startedAt =
    pace === undefined
      ? Math.max(planned.get(cur.round)!.start, prev?.doneAt !== undefined ? prev.doneAt + (cur.gap ?? 0) : planned.get(cur.round)!.start, cur.tiesEnd ?? -Infinity)
      : Math.max(prev?.doneAt !== undefined ? prev.doneAt + (cur.gap ?? 0) : startMin, cur.tiesEnd ?? -Infinity);
  const after = list.filter((r) => r.round > cur.round);
  // Rounds that can still change: the ones after this one, and this one while none of its games has a result. Never the playoffs.
  const open = [...(cur.pool && !cur.anyResult && !cur.keep ? [cur] : []), ...after.filter((r) => !r.anyResult && !r.keep)];
  /** When the night ends if pool rounds from `from` on (that can still change) are played to `to`. */
  const ending = (to?: GameTo, from?: number) => {
    const lenAt = (r: RoundState) => len(r, to !== undefined && from !== undefined && r.pool && r.round >= from && open.includes(r) ? minLen(r.playTo, to) : undefined);
    // Each later round starts when the one before ends, or (Zip 80) when the tie games it waits for end, whichever is later.
    return after.reduce((at, r) => Math.max(at + (r.gap ?? 0), r.tiesEnd ?? -Infinity) + lenAt(r), Math.max(startedAt + lenAt(cur), nowMin));
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
  // Zip 80: when the playoffs wait for tie games anyway, shorter pool games may save nothing: then there is nothing to suggest. (Only with a
  // tie: without one, shorter games always save time, and the suggestion is exactly as before.)
  const tieAhead = [cur, ...after].some((r) => r.tiesEnd !== undefined);
  if (!first || (tieAhead && ending(7, first.round) >= finish)) return { current: cur.round, behind, finish, suggest: null };
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

// ---------------------------------------------------------------------------------------------------------------------
// Zip 58: ties for a playoff place
// ---------------------------------------------------------------------------------------------------------------------
// Zip 72: a tie is what is left after THE TIE RULE (standings above: wins, head to head for exactly 2, point difference, points scored). With
// scores a three-way circle is almost always settled by point difference; teams still level on all of it are the last resort: THE WHEEL picks
// one of three for a bye, the other two play Game A to 5, and (when the tie decides more than which two go on) the winner of A plays the bye
// team to 5 in Game B. Four or more level:
// the organizer picks, one tap per place. A tie only matters when the places it shares lead to different games (1st and 2nd tied before a Final
// between 1st and 2nd: both are in either way, no tie).

export type GroupKey = 'P' | 'A' | 'B';
/** Game A and Game B are played to this. */
export const TIE_TO = 5;

/** A tie's stored answer (migration 0029's tournament_ties). */
export interface TieRecord {
  key: string;
  kind: 'wheel' | 'pick';
  bye: number | null;
  picks: number[];
  gameA: number | null;
  gameB: number | null;
}

/**
 * 'a': the tie decides only who of three is out (two of them go on to the same game): Game A, its loser is out, the bye team and A's winner go
 * on. 'ab': it decides the top place (or every place): Game A, then the winner of A plays the bye team (Game B); B's winner takes the top place.
 */
export type TieShape = 'a' | 'ab';

export interface TieBlock {
  key: string;
  group: GroupKey;
  pool: PoolName | null;
  /** The tied seats, in seat order. */
  seats: number[];
  /** The first place they share in the group (1-based). */
  from: number;
  mode: 'wheel' | 'pick';
  shape: TieShape | null;
  /** The stored answer for exactly this tie (an answer to another tie, after a result was fixed, never applies). */
  record: TieRecord | null;
  /** Every place of the tie in order once it is settled, else null. */
  order: number[] | null;
  /** The game the top tied place leads to ('final', 'semi' or 'third'). */
  target: 'final' | 'semi' | 'third';
  /** The seat whose players spin the wheel: the best record in the group outside the tie. Null: the organizer spins. */
  spinner: number | null;
  /** 'pick': how many places are still to be picked (0 once settled). */
  needPicks: number;
}

/** The tie's key: its group and its seats ('P:1,2,4'). */
export const tieKeyOf = (group: GroupKey, seats: readonly number[]): string => `${group}:${[...seats].sort((a, b) => a - b).join(',')}`;

/**
 * Which places of a group the playoff games use. Places that meet in the same game share a class (the Final's 1st and 2nd, the 3rd place
 * game's 3rd and 4th); a place that meets a team from elsewhere has a class of its own; a place no game uses is 'out'.
 */
export function placeClasses(games: readonly PlannedGame[], group: GroupKey): Map<number, { cls: string; stage: GameStage }> {
  const out = new Map<number, { cls: string; stage: GameStage }>();
  const placeIn = (slot: Slot) => (slot[0] === group && /^\d+$/.test(slot.slice(1)) ? Number(slot.slice(1)) : null);
  for (const g of games) {
    if (g.stage === 'pool' || g.stage === 'tie') continue;
    const a = placeIn(g.a);
    const b = placeIn(g.b);
    if (a !== null && b !== null) {
      out.set(a, { cls: `${g.num}`, stage: g.stage });
      out.set(b, { cls: `${g.num}`, stage: g.stage });
    } else {
      if (a !== null) out.set(a, { cls: `${g.num}:a`, stage: g.stage });
      if (b !== null) out.set(b, { cls: `${g.num}:b`, stage: g.stage });
    }
  }
  return out;
}

/** The two sides of a tie game, as seats ('T3' a seat, 'W12' the winner of tie game 12), and which side won. */
function tieGameOutcome(
  games: readonly PlannedGame[],
  results: ReadonlyMap<number, GameResult>,
  num: number,
  known: ReadonlyMap<number, number>,
  gone: ReadonlySet<number>,
): { win: number; lose: number } | null {
  const g = games.find((x) => x.num === num);
  const r = results.get(num);
  if (!g || !r) return null;
  const seatOf = (slot: Slot): number | null => (slot[0] === 'T' ? Number(slot.slice(1)) : slot[0] === 'W' ? (known.get(Number(slot.slice(1))) ?? null) : null);
  const a = seatOf(g.a);
  const b = seatOf(g.b);
  if (a === null || b === null) return null;
  // Not played because a team left (review): the team still there goes on.
  if (r.skipped || (!r.winner && (gone.has(a) || gone.has(b)))) {
    if (gone.has(a) && !gone.has(b)) return { win: b, lose: a };
    if (gone.has(b) && !gone.has(a)) return { win: a, lose: b };
    return null;
  }
  if (!r.winner) return null;
  return r.winner === 'a' ? { win: a, lose: b } : { win: b, lose: a };
}

/** The ties of one group that matter, each with its answer if it has one, and the group's table with every settled tie in its settled order. */
export function groupTable(
  teams: number,
  games: readonly PlannedGame[],
  results: ReadonlyMap<number, GameResult>,
  out: ReadonlySet<number>,
  records: readonly TieRecord[],
  group: GroupKey,
  /** Teams that left at any point (review): in a tie they go to the bottom of it and take no part in the wheel or its games. */
  gone: ReadonlySet<number> = out,
): { rows: StandingRow[]; blocks: TieBlock[] } {
  const seats = groupsOf(teams).find((g) => (g.pool ?? 'P') === group)?.seats ?? [];
  const raw = standings(games, results, seats, out);
  const done = !!seats.length && groupDone(games, results, seats);
  // Admin speed rule: a tie exists only once every game of the group is in; before that this is the plain table, nothing else worked out.
  if (!done) return { rows: raw, blocks: [] };
  const classes = placeClasses(games, group);
  const clsOf = (place: number) => classes.get(place)?.cls ?? 'out';
  const shapeOf = (cls: string[]): TieShape | null => (cls.length === 3 ? (cls[0] === cls[1] && cls[1] !== cls[2] ? 'a' : 'ab') : null);
  const keyOf = (tied: number[], from: number) => {
    const shape = shapeOf(tied.map((_, i) => clsOf(from + i)));
    return `${tieKeyOf(group, tied)}${shape ? `:${shape}` : ''}`;
  };
  // Review: a team that left after the pools. Before the wheel spins it drops to the bottom of its tie and the teams still playing settle it
  // (the tie rule among them); once the wheel has spun the tie stays as it was and the leaver's playoff game is a walkover (tieGameOutcome).
  const rec = record(games, results, seats);
  const rows: StandingRow[] = [];
  let extra = 1000;
  for (let i = 0; i < raw.length; ) {
    let j = i + 1;
    if (raw[i].tied) while (j < raw.length && raw[j].tied && raw[j].block === raw[i].block) j++;
    const run = raw.slice(i, j);
    const tiedSeats = run.map((r) => r.seat).sort((a, b) => a - b);
    const spun = records.some((x) => x.key === keyOf(tiedSeats, run[0].rank));
    if (run.length > 1 && run.some((r) => gone.has(r.seat)) && !spun) {
      const live = run.filter((r) => !gone.has(r.seat)).map((r) => r.seat);
      const parts = settle(live, rec);
      for (const part of parts) {
        extra++;
        for (const seat of part) rows.push({ ...run.find((r) => r.seat === seat)!, rank: rows.length + 1, tied: done && part.length > 1, block: extra });
      }
      for (const r of run.filter((x) => gone.has(x.seat))) rows.push({ ...r, rank: rows.length + 1, tied: false, block: ++extra });
    } else for (const r of run) rows.push({ ...r, rank: rows.length + 1 });
    i = j;
  }
  const blocks: TieBlock[] = [];
  if (!done) return { rows, blocks };
  const runs = new Map<number, StandingRow[]>();
  for (const r of rows) if (r.tied) runs.set(r.block ?? r.rank, [...(runs.get(r.block ?? r.rank) ?? []), r]);
  for (const run of runs.values()) {
    if (run.length < 2) continue;
    const from = run[0].rank;
    const places = run.map((_, i) => from + i);
    const cls = places.map(clsOf);
    if (cls.every((c) => c === cls[0])) continue; // no tie: those places lead to the same game (or to none)
    const tied = run.map((r) => r.seat).sort((a, b) => a - b);
    const mode: TieBlock['mode'] = tied.length === 3 ? 'wheel' : 'pick';
    const shape: TieShape | null = mode === 'wheel' ? shapeOf(cls) : null;
    // The shape is part of the key (review): if fixed results move the tie to other places, it is a new tie with its own spin.
    const key = keyOf(tied, from);
    const record = records.find((x) => x.key === key && x.kind === mode) ?? null;
    let order: number[] | null = null;
    let needPicks = 0;
    if (mode === 'pick') {
      const picks = [...new Set((record?.picks ?? []).filter((s) => tied.includes(s)))];
      const rest = tied.filter((s) => !picks.includes(s));
      // Picked one place at a time, until the places left all lead to the same game (or one team is left).
      const same = (xs: number[]) => xs.map(clsOf).every((c, _, all) => c === all[0]);
      let need = 0;
      while (picks.length + need < places.length - 1 && !same(places.slice(picks.length + need))) need++;
      needPicks = need;
      if (needPicks === 0) order = [...picks, ...rest];
    } else if (record && record.bye !== null && tied.includes(record.bye) && record.gameA !== null) {
      const known = new Map<number, number>();
      const a = tieGameOutcome(games, results, record.gameA, known, gone);
      if (a) {
        known.set(record.gameA, a.win);
        if (shape === 'a') order = [record.bye, a.win, a.lose];
        else if (record.gameB !== null) {
          const b = tieGameOutcome(games, results, record.gameB, known, gone);
          if (b) order = [b.win, b.lose, a.lose];
        }
      }
    }
    const top = places.map((p) => classes.get(p)).find((x) => !!x);
    const target: TieBlock['target'] = top?.stage === 'semi' ? 'semi' : top?.stage === 'third' ? 'third' : 'final';
    const spinner = rows.find((r) => !tied.includes(r.seat) && !out.has(r.seat) && !gone.has(r.seat))?.seat ?? null;
    blocks.push({ key, group, pool: group === 'P' ? null : group, seats: tied, from, mode, shape, record, order, target, spinner: mode === 'wheel' ? spinner : null, needPicks });
  }
  // The table as the playoffs read it: a settled tie in its settled order; a tie that does not matter is no tie; a tie still waiting stays tied.
  const waiting = new Set(blocks.filter((b) => !b.order).flatMap((b) => b.seats));
  const settled = rows.map((r) => ({ ...r, tied: waiting.has(r.seat) }));
  for (const b of blocks) {
    if (!b.order) continue;
    b.order.forEach((seat, i) => {
      const was = rows.find((r) => r.seat === seat)!;
      settled[b.from - 1 + i] = { ...was, rank: b.from + i, tied: false };
    });
  }
  return { rows: settled, blocks };
}

/** Every tie that matters, in every group. */
export function tieBlocks(
  teams: number,
  games: readonly PlannedGame[],
  results: ReadonlyMap<number, GameResult>,
  out: ReadonlySet<number>,
  records: readonly TieRecord[],
  gone: ReadonlySet<number> = out,
): TieBlock[] {
  return groupsOf(teams).flatMap((g) => groupTable(teams, games, results, out, records, (g.pool ?? 'P') as GroupKey, gone).blocks);
}

/**
 * The playoff games the wheel makes for a three-way tie (`bye` the wheel's answer): Game A between the two other teams (seat order), and Game B
 * (shape 'ab') between the winner of A and the bye team. `firstNum`: the next free game number. Both to 5, in `round` (the first playoff round,
 * before the semifinals or the Final), on `court` (the first free court).
 */
export function tieGames(block: Pick<TieBlock, 'seats' | 'shape' | 'pool'>, bye: number, firstNum: number, round: number, court: number): PlannedGame[] {
  const [x, y] = block.seats.filter((s) => s !== bye);
  const a: PlannedGame = { num: firstNum, round, court, stage: 'tie', pool: block.pool, a: `T${x}`, b: `T${y}` };
  if (block.shape === 'a') return [a];
  return [a, { num: firstNum + 1, round, court, stage: 'tie', pool: block.pool, a: `W${firstNum}`, b: `T${bye}` }];
}
