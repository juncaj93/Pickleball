// Zip 61 (🎾61.americano): THE AMERICANO SCHEDULE. Every round you get a new partner, everyone plays for their own points, nobody has a fixed team.
// A pure function of the player list, the court count and the court time (shared/tournamentPlan.ts americanoPlan gives the rounds and the game
// length, the game plan table), so tests/zip61-americano.test.ts checks it for every size 6 to 16 and every row of the table.
//
// The rules (the brief, part 1):
//   - every round, everyone plays on a court or sits; players on court = 4 x the smaller of (courts, players / 4)
//   - nobody sits twice before everyone has sat once (sit-outs differ by at most 1, at every round)
//   - partners do not repeat until every possible partner has been used (and later: nobody partners someone a 3rd time before every partner twice)
//   - opponents are spread as evenly as possible
//   - courts rotate so nobody is stuck on one court
//
// How: the pattern for a size is worked out over seat numbers 0..n-1 (who sits, who partners whom, which court), and then the night's players
// are put in the seats. Finding a good pattern takes a search (many tries, keep the best), which is too slow to run on every screen refresh, so
// the patterns for 6 to 16 players, 1 and 2 courts, up to 16 rounds are worked out once by scripts/americano-patterns.ts and saved in
// shared/americanoPatterns.ts. A night longer than that (more than 16 rounds) carries on from the saved pattern with the same rules, one round
// at a time (`extendRounds`). The tests check the saved patterns against the rules, so a hand edit that breaks one fails them.
import { americanoPlan, type GameTo, type NightPlan } from './tournamentPlan';
import { AMERICANO_PATTERNS } from './americanoPatterns';

/** One game of a pattern: two pairs of seats, and the court (1 or 2). */
export interface SeatGame {
  court: 1 | 2;
  a: [number, number];
  b: [number, number];
}
/** One round of a pattern: its games and who sits. */
export interface SeatRound {
  games: SeatGame[];
  sit: number[];
}

/** The rounds a saved pattern holds (a longer night carries on with extendRounds). */
export const PATTERN_ROUNDS = 16;

/** Players on court each round (the table's rule): 4 x the smaller of (courts, players / 4). */
export const onCourtFor = (players: number, courts: number): number => 4 * Math.max(1, Math.min(courts >= 2 ? 2 : 1, Math.floor(players / 4)));

/** A small seeded random number source (mulberry32), so the search is the same every time it runs. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The counts the rules are checked on, as a pattern grows. */
export interface Tally {
  n: number;
  sits: number[];
  partner: number[][];
  opp: number[][];
  court: number[][];
}
export function emptyTally(n: number): Tally {
  const grid = () => Array.from({ length: n }, () => new Array<number>(n).fill(0));
  return { n, sits: new Array<number>(n).fill(0), partner: grid(), opp: grid(), court: Array.from({ length: n }, () => [0, 0]) };
}
export function addRound(t: Tally, r: SeatRound): void {
  for (const s of r.sit) t.sits[s]++;
  for (const g of r.games) {
    for (const [x, y] of [g.a, g.b]) {
      t.partner[x][y]++;
      t.partner[y][x]++;
    }
    for (const x of g.a)
      for (const y of g.b) {
        t.opp[x][y]++;
        t.opp[y][x]++;
      }
    for (const x of [...g.a, ...g.b]) t.court[x][g.court - 1]++;
  }
}
export function tallyOf(n: number, rounds: readonly SeatRound[]): Tally {
  const t = emptyTally(n);
  for (const r of rounds) addRound(t, r);
  return t;
}

/** The fewest times this seat has partnered anyone. */
const minPartner = (t: Tally, x: number): number => {
  let m = Infinity;
  for (let y = 0; y < t.n; y++) if (y !== x && t.partner[x][y] < m) m = t.partner[x][y];
  return m;
};

/** Every way to put 4 players into two pairs, and 8 players into two games of two pairs (each game once). */
function splitsOf(p: readonly number[]): [number, number][][] {
  // [pair1, pair2] for 4; [pair1, pair2, pair3, pair4] for 8 (game 1 is pairs 1 and 2, game 2 is pairs 3 and 4).
  const four = (q: readonly number[]): [number, number][][] => [
    [
      [q[0], q[1]],
      [q[2], q[3]],
    ],
    [
      [q[0], q[2]],
      [q[1], q[3]],
    ],
    [
      [q[0], q[3]],
      [q[1], q[2]],
    ],
  ];
  if (p.length === 4) return four(p);
  const out: [number, number][][] = [];
  const rest = p.slice(1);
  for (let i = 0; i < rest.length; i++)
    for (let j = i + 1; j < rest.length; j++)
      for (let k = j + 1; k < rest.length; k++) {
        const g1 = [p[0], rest[i], rest[j], rest[k]];
        const g2 = rest.filter((_, x) => x !== i && x !== j && x !== k);
        for (const s1 of four(g1)) for (const s2 of four(g2)) out.push([...s1, ...s2]);
      }
  return out;
}

/**
 * What a round costs against the counts so far (lower is better): a partner repeat while a partner is still unused is by far the worst; then
 * repeats at all; then opponents met again (squared, so the spread stays even).
 */
function roundCost(t: Tally, pairs: [number, number][]): number {
  let c = 0;
  for (const [x, y] of pairs) {
    const k = t.partner[x][y];
    if (k > minPartner(t, x) || k > minPartner(t, y)) c += 1_000_000;
    c += 1000 * k * k;
  }
  for (let g = 0; g < pairs.length; g += 2)
    for (const x of pairs[g])
      for (const y of pairs[g + 1]) {
        const k = t.opp[x][y];
        c += 10 * (k + 1) * (k + 1);
      }
  return c;
}

/** Who sits this round: the seats that have sat least (so nobody sits twice before everyone sat once), ties at random. */
function pickSitters(t: Tally, count: number, rnd: () => number): number[] {
  if (count <= 0) return [];
  const order = [...Array(t.n).keys()].map((s) => ({ s, k: t.sits[s], r: rnd() })).sort((a, b) => a.k - b.k || a.r - b.r);
  return order.slice(0, count).map((x) => x.s);
}

type Duo = [[number, number], [number, number]];

/** How uneven each player's court 1 and court 2 games get with `one` on court 1 and `two` on court 2 (squared, summed). */
function courtSpread(t: Tally, one: Duo, two: Duo): number {
  let c = 0;
  for (const x of [...one[0], ...one[1]]) c += (t.court[x][0] + 1 - t.court[x][1]) ** 2;
  for (const x of [...two[0], ...two[1]]) c += (t.court[x][0] - t.court[x][1] - 1) ** 2;
  return c;
}

/** Which game goes on court 1: the way that keeps each player's court 1 and court 2 games closest to even (so everyone moves between them). */
function placeCourts(t: Tally, games: Duo[]): { games: SeatGame[]; cost: number } {
  if (games.length === 1) return { games: [{ court: 1, a: games[0][0], b: games[0][1] }], cost: 0 };
  const keep = courtSpread(t, games[0], games[1]);
  const flip = courtSpread(t, games[1], games[0]);
  const [x, y] = keep <= flip ? [games[0], games[1]] : [games[1], games[0]];
  return {
    games: [
      { court: 1, a: x[0], b: x[1] },
      { court: 2, a: y[0], b: y[1] },
    ],
    cost: Math.min(keep, flip),
  };
}

/** One more round with the rules, against the counts so far (`tally` is updated). The best split, ties at random. */
export function nextRound(t: Tally, onCourt: number, rnd: () => number, courtWeight = 2): SeatRound {
  const sit = pickSitters(t, t.n - onCourt, rnd);
  const sitting = new Set(sit);
  const playing = [...Array(t.n).keys()].filter((s) => !sitting.has(s));
  let best: SeatGame[] | null = null;
  let bestCost = Infinity;
  for (const split of splitsOf(playing)) {
    const games: Duo[] = [];
    for (let g = 0; g < split.length; g += 2) games.push([split[g], split[g + 1]]);
    const placed = placeCourts(t, games);
    const c = roundCost(t, split) + courtWeight * placed.cost + rnd();
    if (c < bestCost) {
      bestCost = c;
      best = placed.games;
    }
  }
  const round: SeatRound = { games: best!, sit: sit.sort((a, b) => a - b) };
  addRound(t, round);
  return round;
}

/** The fewest and most times any two players met as opponents, and the most uneven court split of any player (2 court nights). */
export function spreadOf(t: Tally): { oppMin: number; oppMax: number; courts: number } {
  let oppMin = Infinity;
  let oppMax = 0;
  let courts = 0;
  for (let x = 0; x < t.n; x++) {
    for (let y = 0; y < t.n; y++) if (x !== y) (oppMin = Math.min(oppMin, t.opp[x][y])), (oppMax = Math.max(oppMax, t.opp[x][y]));
    courts = Math.max(courts, Math.abs(t.court[x][0] - t.court[x][1]));
  }
  return { oppMin, oppMax, courts };
}

/**
 * How good a whole pattern is (lower is better), over every length a night can cut it to (a night uses its first rounds): a partner repeat while
 * a partner is unused counts most; then the gap between the most and fewest times two players meet as opponents; then uneven courts; then
 * the opponents' repeats themselves.
 */
export function patternCost(n: number, rounds: readonly SeatRound[]): number {
  const t = emptyTally(n);
  let total = 0;
  rounds.forEach((r, i) => {
    for (const g of r.games) {
      for (const [x, y] of [g.a, g.b]) {
        const k = t.partner[x][y];
        if (k > minPartner(t, x) || k > minPartner(t, y)) total += 1_000_000;
      }
    }
    addRound(t, r);
    // Lengths a real night uses weigh most (4 to 10 rounds).
    const w = i + 1 >= 4 && i + 1 <= 10 ? 10 : 1;
    const s = spreadOf(t);
    total += w * (100 * (s.oppMax - s.oppMin) + 30 * Math.max(0, s.courts - 1));
  });
  for (let x = 0; x < n; x++) for (let y = 0; y < n; y++) total += t.opp[x][y] ** 2;
  return total;
}

/** Swap the two courts of a round (the same games, the other way round). */
const flipped = (r: SeatRound): SeatRound => (r.games.length === 2 ? { ...r, games: r.games.map((g) => ({ ...g, court: (3 - g.court) as 1 | 2 })) } : r);

/** Courts, once the games are set: flip whole rounds while that makes the courts more even (the games and who sits never change). */
export function balanceCourts(n: number, rounds: SeatRound[]): SeatRound[] {
  if (!rounds.some((r) => r.games.length === 2)) return rounds;
  let list = rounds;
  let cost = patternCost(n, list);
  for (let pass = 0; pass < 6; pass++) {
    let better = false;
    for (let i = 0; i < list.length; i++) {
      const next = list.map((r, k) => (k === i ? flipped(r) : r));
      const c = patternCost(n, next);
      if (c < cost) {
        list = next;
        cost = c;
        better = true;
      }
    }
    if (!better) break;
  }
  return list;
}

/**
 * 8 players on 2 courts (everyone plays every round): a whole night with every partner exactly once in 7 rounds and every opponent exactly twice
 * (a "whist" night), found by trying the rounds in turn and stepping back when one cannot go on. Then the 7 rounds are put in the order, and
 * each round's courts the way round, that keeps everyone's court 1 and court 2 games closest to even at every round (the order of the rounds
 * changes nothing about partners or opponents over the whole night). Null when it is not found in time.
 */
export function perfectEight(rnd: () => number): SeatRound[] | null {
  const partner = Array.from({ length: 8 }, () => new Array<number>(8).fill(0));
  const opp = Array.from({ length: 8 }, () => new Array<number>(8).fill(0));
  const all = splitsOf([0, 1, 2, 3, 4, 5, 6, 7]);
  const out: [number, number][][] = [];
  let steps = 0;
  const mark = (sp: [number, number][], d: number) => {
    for (const [x, y] of sp) (partner[x][y] += d), (partner[y][x] += d);
    for (const g of [0, 2]) for (const x of sp[g]) for (const y of sp[g + 1]) (opp[x][y] += d), (opp[y][x] += d);
  };
  const go = (): boolean => {
    if (out.length === 7) return true;
    if (++steps > 50000) return false;
    const options = all.filter((sp) => sp.every(([x, y]) => partner[x][y] === 0) && [0, 2].every((g) => sp[g].every((x) => sp[g + 1].every((y) => opp[x][y] < 2))));
    for (const sp of options.map((o) => ({ o, r: rnd() })).sort((a, b) => a.r - b.r).map((x) => x.o)) {
      mark(sp, 1);
      out.push(sp);
      if (go()) return true;
      out.pop();
      mark(sp, -1);
    }
    return false;
  };
  if (!go()) return null;
  // The order and the courts: every order of the 7 rounds and every way round of each, the evenest courts at every round kept.
  const perms: number[][] = [];
  const perm = (rest: number[], acc: number[]) => (rest.length ? rest.forEach((x, i) => perm([...rest.slice(0, i), ...rest.slice(i + 1)], [...acc, x])) : perms.push(acc));
  perm([0, 1, 2, 3, 4, 5, 6], []);
  let best: { order: number[]; mask: number } | null = null;
  let bestCost = Infinity;
  const diff = new Array<number>(8);
  for (const order of perms) {
    for (let mask = 0; mask < 128; mask++) {
      diff.fill(0);
      let c = 0;
      for (let i = 0; i < 7; i++) {
        const sp = out[order[i]];
        const flip = mask & (1 << i) ? -1 : 1;
        for (const x of [...sp[0], ...sp[1]]) diff[x] += flip;
        for (const x of [...sp[2], ...sp[3]]) diff[x] -= flip;
        let worst = 0;
        for (const d of diff) worst = Math.max(worst, Math.abs(d));
        c += Math.max(0, worst - 1) * (i + 1 >= 4 ? 10 : 1);
        if (c >= bestCost) break;
      }
      if (c < bestCost) {
        bestCost = c;
        best = { order, mask };
      }
    }
  }
  return best!.order.map((k, i) => {
    const sp = out[k];
    const [one, two] = best!.mask & (1 << i) ? [[sp[2], sp[3]], [sp[0], sp[1]]] : [[sp[0], sp[1]], [sp[2], sp[3]]];
    return { games: [{ court: 1, a: one[0], b: one[1] }, { court: 2, a: two[0], b: two[1] }], sit: [] } as SeatRound;
  });
}

/** The search: many seeded tries of the round by round rules, the best one kept (scripts/americano-patterns.ts runs it once, offline). */
export function searchPattern(n: number, onCourt: number, rounds: number, tries: number, seed = 61): SeatRound[] {
  let best: SeatRound[] = [];
  let bestCost = Infinity;
  // 8 players on 2 courts start from the whist night (worked out once; the tries differ in the rounds after it).
  const whist = n === 8 && onCourt === 8 ? perfectEight(seeded(seed)) : null;
  for (let i = 0; i < tries; i++) {
    const rnd = seeded(seed * 7919 + i);
    let list: SeatRound[] = whist ? [...whist] : [];
    const t = tallyOf(n, list);
    while (list.length < rounds) list.push(nextRound(t, onCourt, rnd, 0));
    list = balanceCourts(n, list.slice(0, rounds));
    const c = patternCost(n, list);
    if (c < bestCost) {
      bestCost = c;
      best = list;
    }
  }
  return bestCourts(n, best);
}

/** The best way round for the courts of the first 10 rounds, every one of the 1,024 tried (then the rest flipped one by one). */
function bestCourts(n: number, rounds: SeatRound[]): SeatRound[] {
  const head = Math.min(10, rounds.length);
  if (!rounds.slice(0, head).some((r) => r.games.length === 2)) return rounds;
  let best = rounds;
  let bestCost = Infinity;
  for (let mask = 0; mask < 1 << head; mask++) {
    const list = rounds.map((r, i) => (i < head && mask & (1 << i) ? flipped(r) : r));
    // Every length a night stops at counts (not only the last): the worst court split at each of them.
    const t = emptyTally(n);
    let c = 0;
    for (let i = 0; i < head; i++) {
      addRound(t, list[i]);
      c += 1000 * Math.max(0, spreadOf(t).courts - 1) * (i + 1 >= 4 ? 10 : 1);
    }
    if (c < bestCost) {
      bestCost = c;
      best = list;
    }
  }
  return balanceCourts(n, best);
}

/** Carry a pattern on past its saved rounds with the same rules (a night longer than 16 rounds). */
export function extendRounds(n: number, onCourt: number, start: readonly SeatRound[], rounds: number): SeatRound[] {
  const out = start.slice(0, rounds);
  if (out.length >= rounds) return out;
  const t = tallyOf(n, out);
  const rnd = seeded(n * 100 + onCourt);
  while (out.length < rounds) out.push(nextRound(t, onCourt, rnd));
  return out;
}

/** "8:4" (players and players on court): a saved pattern's key. */
export const patternKey = (n: number, onCourt: number): string => `${n}:${onCourt}`;

/** The pattern for a size: the saved one cut to the night's rounds (or carried on past it). */
export function seatRounds(n: number, onCourt: number, rounds: number): SeatRound[] {
  const saved = (AMERICANO_PATTERNS[patternKey(n, onCourt)] ?? []).map(decodeRound);
  if (saved.length) return extendRounds(n, onCourt, saved, rounds);
  return extendRounds(n, onCourt, [], rounds);
}

/** Saved patterns are short strings so the file stays small: "0 1 2 3|4 5 6 7/8 9" (court 1 game | court 2 game / who sits). */
export function encodeRound(r: SeatRound): string {
  const games = [...r.games].sort((a, b) => a.court - b.court).map((g) => [...g.a, ...g.b].join(' '));
  return `${games.join('|')}/${r.sit.join(' ')}`;
}
export function decodeRound(s: string): SeatRound {
  const [g, sit] = s.split('/');
  const games = g.split('|').map((x, i): SeatGame => {
    const q = x.split(' ').map(Number);
    return { court: (i + 1) as 1 | 2, a: [q[0], q[1]], b: [q[2], q[3]] };
  });
  return { games, sit: sit ? sit.split(' ').filter(Boolean).map(Number) : [] };
}

// ---------------------------------------------------------------------------------------------------------------------
// The night: the players put in the seats
// ---------------------------------------------------------------------------------------------------------------------

/** One game of the night: round, court, the two pairs (player ids) and what it is played to. */
export interface AmericanoGame {
  num: number;
  round: number;
  court: 1 | 2;
  a: [string, string];
  b: [string, string];
  playTo: GameTo;
}
export interface AmericanoNight {
  plan: NightPlan;
  games: AmericanoGame[];
  /** Who sits each round (player ids), by round number. */
  sits: Map<number, string[]>;
  rounds: number;
}

/** A number from a string (the tournament id), so the seats differ between tournaments but never between two reads of one. */
function hashOf(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Who gets which seat: the players in id order, shuffled by the tournament's own number (the same for every read of the same list). */
export function seatOrder(players: readonly string[], key: string): string[] {
  const list = [...new Set(players)].sort();
  const rnd = seeded(hashOf(key));
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

/**
 * THE FUNCTION (players, courts, minutes): the Americano night. `key` (the tournament id) decides who gets which seat. Players are the ids of the
 * players locked in; 6 to 16 (fewer than 4 makes no game; more than 16 is held to the cap's plan). Every game of the night in play order.
 */
export function americanoNight(players: readonly string[], courts: number, minutes: number, key: string): AmericanoNight {
  const seats = seatOrder(players, key);
  const n = seats.length;
  const plan = americanoPlan(Math.max(n, 4), courts >= 2 ? 2 : 1, minutes);
  if (n < 4) return { plan, games: [], sits: new Map(), rounds: 0 };
  const onCourt = onCourtFor(n, courts);
  const pattern = seatRounds(n, onCourt, plan.rounds);
  const games: AmericanoGame[] = [];
  const sits = new Map<number, string[]>();
  pattern.forEach((r, i) => {
    const round = i + 1;
    sits.set(round, r.sit.map((s) => seats[s]));
    for (const g of [...r.games].sort((x, y) => x.court - y.court)) {
      games.push({ num: games.length + 1, round, court: g.court, a: [seats[g.a[0]], seats[g.a[1]]], b: [seats[g.b[0]], seats[g.b[1]]], playTo: plan.gameTo });
    }
  });
  return { plan, games, sits, rounds: pattern.length };
}

/** How a game is stored (tournament_games.slot_a / slot_b): the two player ids with "+" between ("id1+id2"). */
export const pairSlot = (p: readonly [string, string]): string => `${p[0]}+${p[1]}`;
export const slotPair = (s: string): [string, string] | null => {
  const parts = s.split('+');
  return parts.length === 2 && parts[0] && parts[1] ? [parts[0], parts[1]] : null;
};
/** A stored game is an Americano game (its slots are two players each, not a team seat like "T3"). */
export const isAmericanoSlot = (s: string): boolean => slotPair(s) !== null;

// ---------------------------------------------------------------------------------------------------------------------
// The points table (part 4)
// ---------------------------------------------------------------------------------------------------------------------

/** One game's score as the table sees it (only games that count: a score that stands or is waiting for the other side). */
export interface ScoredGame {
  a: readonly string[];
  b: readonly string[];
  scoreA: number;
  scoreB: number;
}

export interface PointsRow {
  id: string;
  wins: number;
  losses: number;
  /** Points scored in every game played. */
  points: number;
  /** Points scored minus points against. */
  diff: number;
  played: number;
  /** 1, 2, 3 in order (players level on every rule keep the order they came in). */
  rank: number;
  /** The night is over and this player is still level with another on every rule: "Tied" (the organizer is told). */
  tied: boolean;
}

/**
 * The live points table (Alex, Nov 19). While everyone has played the same number of games: wins first, then total points (picture 32).
 * Whenever players have played different numbers of games (a sit-out, or someone left): win percentage first, then total points. Players still
 * level keep their order (the caller passes ids in name order) and, once the night's games are all in (`final`), are marked tied: the screens
 * say "Tied" and the organizer is told.
 */
export function pointsTable(ids: readonly string[], games: readonly ScoredGame[], opts: { final: boolean }): PointsRow[] {
  const rec = new Map(ids.map((id) => [id, { wins: 0, losses: 0, points: 0, against: 0, played: 0 }]));
  for (const g of games) {
    const aWon = g.scoreA > g.scoreB;
    for (const [side, mine, theirs, won] of [
      [g.a, g.scoreA, g.scoreB, aWon],
      [g.b, g.scoreB, g.scoreA, !aWon],
    ] as const) {
      for (const id of side) {
        const r = rec.get(id);
        if (!r) continue;
        r.played++;
        r.points += mine;
        r.against += theirs;
        if (won) r.wins++;
        else r.losses++;
      }
    }
  }
  // Different numbers of games: win percentage, compared as fractions (cross multiplied, so 2 of 3 and 4 of 6 are equal; no games is 0%).
  const unequal = new Set([...rec.values()].map((r) => r.played)).size > 1;
  const cmp = (x: string, y: string): number => {
    const a = rec.get(x)!;
    const b = rec.get(y)!;
    if (!unequal) return b.wins - a.wins || b.points - a.points;
    return b.wins * (a.played || 1) - a.wins * (b.played || 1) || b.points - a.points;
  };
  const order = [...ids].sort((x, y) => cmp(x, y) || ids.indexOf(x) - ids.indexOf(y));
  const rows: PointsRow[] = order.map((id, i) => {
    const r = rec.get(id)!;
    return { id, wins: r.wins, losses: r.losses, points: r.points, diff: r.points - r.against, played: r.played, rank: i + 1, tied: false };
  });
  if (opts.final) {
    for (let i = 0; i < rows.length; i++) {
      const near = [rows[i - 1], rows[i + 1]].filter((o): o is PointsRow => !!o);
      rows[i].tied = rows[i].played > 0 && near.some((o) => o.played > 0 && cmp(rows[i].id, o.id) === 0);
    }
  }
  return rows;
}

/** "2-0" (wins-losses), the same as the Locked doubles standings. */
export const winLoss = (r: Pick<PointsRow, 'wins' | 'losses'>): string => `${r.wins}-${r.losses}`;

/** Players have played different numbers of games (the table then ranks by win percentage). */
export const gamesDiffer = (rows: readonly Pick<PointsRow, 'played'>[]): boolean => new Set(rows.map((r) => r.played)).size > 1;
