// Zip 80: the searches behind scripts/americano-patterns.ts, in their own file so tests and checks can use them without writing the patterns file.
import { bestCourts, nextRound, patternCost, seeded, tallyOf, type SeatRound } from '../shared/americanoSchedule';

/** Partner repeats made while that player still had a partner never used (must be 0), the opponent spread, the court spread. */
export function quality(n: number, rounds: readonly SeatRound[]) {
  let early = 0;
  const seen: SeatRound[] = [];
  for (const r of rounds) {
    const t = tallyOf(n, seen);
    for (const g of r.games)
      for (const [x, y] of [g.a, g.b]) {
        const minX = Math.min(...[...Array(n).keys()].filter((o) => o !== x).map((o) => t.partner[x][o]));
        const minY = Math.min(...[...Array(n).keys()].filter((o) => o !== y).map((o) => t.partner[y][o]));
        if (t.partner[x][y] > minX || t.partner[x][y] > minY) early++;
      }
    seen.push(r);
  }
  const t = tallyOf(n, rounds);
  let oMax = 0;
  let oMin = Infinity;
  let cSpread = 0;
  for (let x = 0; x < n; x++) {
    for (let y = 0; y < n; y++) if (x !== y) (oMax = Math.max(oMax, t.opp[x][y])), (oMin = Math.min(oMin, t.opp[x][y]));
    cSpread = Math.max(cSpread, Math.abs(t.court[x][0] - t.court[x][1]));
  }
  return { early, oMin, oMax, cSpread };
}

/**
 * Zip 74: one court, and nobody sits more than `maxRun` rounds in a row. A seeded beam search, round by round, over every (who sits, how the 4
 * pair up): at every round the sit-outs differ by at most 1, no sit streak passes `maxRun`, no partner repeats while one is unused, and the
 * opponent spread stays within `oppGap`. The `width` cheapest go on (the spread at every length a night stops at, weighted as patternCost, then
 * the opponents' repeats); the one with the lowest patternCost wins.
 */
export function noLongSits(n: number, rounds: number, width = 2000, seed = 1, maxRun = 2, oppGap = 2): SeatRound[] {
  const rnd = seeded(seed);
  const all = [...Array(n).keys()];
  const options: { sit: number[]; pairs: [number, number][] }[] = [];
  for (let m = 0; m < 1 << n; m++) {
    const sit = all.filter((x) => m & (1 << x));
    if (sit.length !== n - 4) continue;
    const q = all.filter((x) => !(m & (1 << x)));
    for (const pairs of [
      [[q[0], q[1]], [q[2], q[3]]],
      [[q[0], q[2]], [q[1], q[3]]],
      [[q[0], q[3]], [q[1], q[2]]],
    ] as [number, number][][])
      options.push({ sit, pairs });
  }
  type State = { rounds: SeatRound[]; sits: number[]; run: number[]; partner: number[][]; opp: number[][]; cost: number; rank: number };
  const grid = () => Array.from({ length: n }, () => new Array<number>(n).fill(0));
  const minP = (p: number[][], x: number) => Math.min(...all.filter((y) => y !== x).map((y) => p[x][y]));
  let beam: State[] = [{ rounds: [], sits: new Array<number>(n).fill(0), run: new Array<number>(n).fill(0), partner: grid(), opp: grid(), cost: 0, rank: 0 }];
  for (let r = 0; r < rounds; r++) {
    const next: State[] = [];
    for (const s of beam)
      for (const o of options) {
        const sits = s.sits.slice();
        for (const x of o.sit) sits[x]++;
        if (Math.max(...sits) - Math.min(...sits) > 1) continue;
        const run = s.run.map((v, x) => (o.sit.includes(x) ? v + 1 : 0));
        if (Math.max(...run) > maxRun) continue;
        if (o.pairs.some(([x, y]) => s.partner[x][y] > minP(s.partner, x) || s.partner[x][y] > minP(s.partner, y))) continue;
        const partner = s.partner.map((a) => a.slice());
        const opp = s.opp.map((a) => a.slice());
        for (const [x, y] of o.pairs) partner[x][y]++, partner[y][x]++;
        for (const x of o.pairs[0]) for (const y of o.pairs[1]) opp[x][y]++, opp[y][x]++;
        let lo = Infinity;
        let hi = 0;
        let sq = 0;
        for (const x of all) for (const y of all) if (x !== y) (lo = Math.min(lo, opp[x][y])), (hi = Math.max(hi, opp[x][y])), (sq += opp[x][y] ** 2);
        if (hi - lo > oppGap) continue;
        const cost = s.cost + (r + 1 >= 4 && r + 1 <= 10 ? 10 : 1) * 100 * (hi - lo);
        const round: SeatRound = { games: [{ court: 1, a: o.pairs[0], b: o.pairs[1] }], sit: o.sit };
        next.push({ rounds: [...s.rounds, round], sits, run, partner, opp, cost, rank: cost + sq + rnd() });
      }
    if (!next.length) throw new Error(`noLongSits: no way on at round ${r + 1}`);
    beam = next.sort((a, b) => a.rank - b.rank).slice(0, width);
  }
  return beam.map((s) => ({ s, c: patternCost(n, s.rounds) })).sort((a, b) => a.c - b.c)[0].s.rounds;
}

/** Zip 80: the most rounds anyone sits in a row, and the most the sit-outs ever differ (after every round), over the rounds given. */
export function sitStats(n: number, rounds: readonly SeatRound[]): { maxRun: number; maxGap: number } {
  const run = new Array<number>(n).fill(0);
  const sits = new Array<number>(n).fill(0);
  let maxRun = 0;
  let maxGap = 0;
  for (const r of rounds) {
    for (let x = 0; x < n; x++) run[x] = r.sit.includes(x) ? run[x] + 1 : 0;
    for (const s of r.sit) sits[s]++;
    maxRun = Math.max(maxRun, ...run);
    maxGap = Math.max(maxGap, Math.max(...sits) - Math.min(...sits));
  }
  return { maxRun, maxGap };
}

/**
 * Zip 80: two courts, and nobody sits more than `maxRun` rounds in a row (15 players on 2 courts: 8 play, 7 sit). The beam above is too big
 * here (6,435 ways to pick who sits, each with 315 ways to make the games), so this is searchPattern's seeded tries with one more rule: the
 * sitters are the least-sat seats (so sit-outs differ by at most 1), never one that has sat `maxRun` in a row while another least-sat seat can
 * sit instead, ties at random; then the best games for those sitters (nextRound). A try that cannot keep the rule is thrown away; the try
 * with the lowest patternCost wins (then the courts are evened out, as searchPattern does). `courtWeight` weighs the courts while the games
 * are picked (nextRound's own weight; 0 as searchPattern).
 */
export function searchNoLongSits(n: number, onCourt: number, rounds: number, tries: number, seed: number, maxRun = 2, courtWeight = 0): SeatRound[] {
  let best: SeatRound[] | null = null;
  let bestCost = Infinity;
  for (let i = 0; i < tries; i++) {
    const rnd = seeded(seed * 7919 + i);
    const t = tallyOf(n, []);
    const run = new Array<number>(n).fill(0);
    const list: SeatRound[] = [];
    let ok = true;
    while (list.length < rounds) {
      const order = [...Array(n).keys()]
        .map((s) => ({ s, k: t.sits[s], must: run[s] >= maxRun ? 1 : 0, r: rnd() }))
        .sort((a, b) => a.k - b.k || a.must - b.must || a.r - b.r);
      const sit = order.slice(0, n - onCourt);
      if (sit.some((x) => x.must)) {
        ok = false;
        break;
      }
      const round = nextRound(t, onCourt, rnd, courtWeight, sit.map((x) => x.s).sort((a, b) => a - b));
      for (let x = 0; x < n; x++) run[x] = round.sit.includes(x) ? run[x] + 1 : 0;
      list.push(round);
    }
    if (!ok) continue;
    const c = patternCost(n, list);
    if (c < bestCost) {
      bestCost = c;
      best = list;
    }
  }
  if (!best) throw new Error(`searchNoLongSits: no try kept the rule for ${n} players`);
  return bestCourts(n, best);
}

/**
 * Zip 80: noLongSits for the bigger one court sizes (9 to 16 players). The same rules and the same ranking (the opponent spread at every length
 * a night stops at, then the opponents' repeats, ties at random; `heavy` is the lengths that weigh most, 4 to 10 rounds as patternCost), but a round's candidates are kept as numbers only and the opponent counts are
 * updated a pair at a time, so a wide beam fits in memory (16 players: 5,460 ways a round can go, times the width). `oppGap` caps the spread.
 */
export function noLongSitsLean(n: number, rounds: number, width: number, seed: number, maxRun: number, oppGap = 2, heavy: [number, number] = [4, 10], judge: (r: SeatRound[]) => number = (r) => patternCost(n, r)): SeatRound[] {
  const rnd = seeded(seed);
  const all = [...Array(n).keys()];
  const options: { sit: number[]; pairs: [number, number][] }[] = [];
  for (let m = 0; m < 1 << n; m++) {
    let c = 0;
    for (let x = 0; x < n; x++) if (m & (1 << x)) c++;
    if (c !== n - 4) continue;
    const sit = all.filter((x) => m & (1 << x));
    const q = all.filter((x) => !(m & (1 << x)));
    for (const pairs of [
      [[q[0], q[1]], [q[2], q[3]]],
      [[q[0], q[2]], [q[1], q[3]]],
      [[q[0], q[3]], [q[1], q[2]]],
    ] as [number, number][][])
      options.push({ sit, pairs });
  }
  const O = options.length;
  type State = { prev: State | null; opt: number; sits: Int8Array; run: Int8Array; partner: Uint8Array; opp: Uint8Array; hist: number[]; cost: number; sq: number };
  let beam: State[] = [
    { prev: null, opt: -1, sits: new Int8Array(n), run: new Int8Array(n), partner: new Uint8Array(n * n), opp: new Uint8Array(n * n), hist: [n * (n - 1)], cost: 0, sq: 0 },
  ];
  for (let r = 0; r < rounds; r++) {
    const total = beam.length * O;
    const rank = new Float64Array(total).fill(Infinity);
    const step = new Float64Array(total);
    let kept = 0;
    beam.forEach((s, si) => {
      const minP = all.map((x) => Math.min(...all.filter((y) => y !== x).map((y) => s.partner[x * n + y])));
      let lo0 = 0;
      while (!s.hist[lo0]) lo0++;
      for (let oi = 0; oi < O; oi++) {
        const o = options[oi];
        let bad = false;
        for (const x of o.sit) if (s.run[x] + 1 > maxRun) bad = true;
        if (bad) continue;
        let mn = Infinity;
        let mx = -Infinity;
        for (let x = 0; x < n; x++) {
          const v = s.sits[x] + (o.sit.includes(x) ? 1 : 0);
          if (v < mn) mn = v;
          if (v > mx) mx = v;
        }
        if (mx - mn > 1) continue;
        if (o.pairs.some(([x, y]) => s.partner[x * n + y] > minP[x] || s.partner[x * n + y] > minP[y])) continue;
        // The 4 opponent pairs, each counted both ways (as the original grid sums do).
        const hist = s.hist.slice();
        let sq = s.sq;
        for (const x of o.pairs[0])
          for (const y of o.pairs[1]) {
            const v = s.opp[x * n + y];
            hist[v] -= 2;
            hist[v + 1] = (hist[v + 1] ?? 0) + 2;
            sq += 2 * (2 * v + 1);
          }
        let lo = 0;
        while (!hist[lo]) lo++;
        const hi = hist.length - 1 - [...hist].reverse().findIndex((c) => c > 0);
        if (hi - lo > oppGap) continue;
        const cost = s.cost + (r + 1 >= heavy[0] && r + 1 <= heavy[1] ? 10 : 1) * 100 * (hi - lo);
        const idx = si * O + oi;
        rank[idx] = cost + sq + rnd();
        step[idx] = cost;
        kept++;
        void lo0;
      }
    });
    if (!kept) throw new Error(`noLongSitsLean: no way on at round ${r + 1}`);
    const sorted = Float64Array.from(rank).sort();
    const cut = sorted[Math.min(width, kept) - 1];
    const pick: number[] = [];
    for (let i = 0; i < total; i++) if (rank[i] <= cut) pick.push(i);
    pick.sort((a, b) => rank[a] - rank[b]);
    beam = pick.slice(0, width).map((idx) => {
      const s = beam[Math.floor(idx / O)];
      const oi = idx % O;
      const o = options[oi];
      const sits = s.sits.slice();
      const run = s.run.slice();
      for (let x = 0; x < n; x++) run[x] = o.sit.includes(x) ? run[x] + 1 : 0;
      for (const x of o.sit) sits[x]++;
      const partner = s.partner.slice();
      const opp = s.opp.slice();
      const hist = s.hist.slice();
      let sq = s.sq;
      for (const [x, y] of o.pairs) partner[x * n + y]++, partner[y * n + x]++;
      for (const x of o.pairs[0])
        for (const y of o.pairs[1]) {
          const v = opp[x * n + y];
          hist[v] -= 2;
          hist[v + 1] = (hist[v + 1] ?? 0) + 2;
          sq += 2 * (2 * v + 1);
          opp[x * n + y]++, opp[y * n + x]++;
        }
      return { prev: s, opt: oi, sits, run, partner, opp, hist, cost: step[idx], sq };
    });
  }
  const roundsOf = (s: State): SeatRound[] => {
    const out: SeatRound[] = [];
    for (let p: State | null = s; p && p.opt >= 0; p = p.prev) {
      const o = options[p.opt];
      out.unshift({ games: [{ court: 1, a: o.pairs[0], b: o.pairs[1] }], sit: o.sit });
    }
    return out;
  };
  return beam.map((s) => ({ r: roundsOf(s) })).map((x) => ({ ...x, c: judge(x.r) })).sort((a, b) => a.c - b.c)[0].r;
}
