// Zip 61: works out the saved Americano patterns (shared/americanoPatterns.ts) once, offline: `npx vite-node scripts/americano-patterns.ts`.
// For every size 6 to 16 and 1 or 2 courts, many seeded tries of the round by round rules, the best kept (shared/americanoSchedule.ts). The
// result is the same on every run (seeded), so running it again rewrites the same file. Pass --check to only print how good each one is.
// Zip 74: 7 players on 1 court has one more rule (nobody sits 3 rounds in a row), so it comes from its own seeded search (`noLongSits`).
import { writeFileSync } from 'node:fs';
import { americanoPlan } from '../shared/tournamentPlan';
import { encodeRound, onCourtFor, PATTERN_ROUNDS, patternCost, patternKey, searchPattern, seeded, tallyOf, type SeatRound } from '../shared/americanoSchedule';

const TRIES = Number(process.env.TRIES ?? 400);

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

const out: Record<string, string[]> = {};
for (let n = 6; n <= 16; n++) {
  for (const courts of n < 8 ? [1] : [1, 2]) {
    const oc = onCourtFor(n, courts);
    const p = n === 7 && oc === 4 ? noLongSits(n, PATTERN_ROUNDS) : searchPattern(n, oc, PATTERN_ROUNDS, TRIES, n * 10 + courts);
    out[patternKey(n, oc)] = p.map(encodeRound);
    const at = [120, 150, 180].map((m) => americanoPlan(n, courts, m)).filter((x) => x.fits).map((x) => {
      const q = quality(n, p.slice(0, x.rounds));
      return `${x.minutes / 60}h ${x.rounds}r: early ${q.early}, opp ${q.oMin}..${q.oMax}${oc === 8 ? `, courts ${q.cSpread}` : ''}`;
    });
    console.log(`${n}p ${courts}c (${oc} on): all ${PATTERN_ROUNDS} early ${quality(n, p).early} | ${at.join(' | ')}`);
  }
}
if (!process.argv.includes('--check')) {
  const body = Object.entries(out)
    .map(([k, v]) => `  '${k}': [\n${v.map((r) => `    '${r}',`).join('\n')}\n  ],`)
    .join('\n');
  writeFileSync(
    new URL('../shared/americanoPatterns.ts', import.meta.url),
    `// Zip 61: the saved Americano patterns, made by scripts/americano-patterns.ts (do not edit by hand; run it again). Key "players:on court".\n` +
      `// Each round: the court 1 game | the court 2 game (seats: pair, then the other pair) / the seats that sit. Read by shared/americanoSchedule.ts.\n` +
      `export const AMERICANO_PATTERNS: Record<string, readonly string[]> = {\n${body}\n};\n`,
  );
}
