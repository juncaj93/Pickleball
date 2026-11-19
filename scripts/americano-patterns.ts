// Zip 61: works out the saved Americano patterns (shared/americanoPatterns.ts) once, offline: `npx vite-node scripts/americano-patterns.ts`.
// For every size 6 to 16 and 1 or 2 courts, many seeded tries of the round by round rules, the best kept (shared/americanoSchedule.ts). The
// result is the same on every run (seeded), so running it again rewrites the same file. Pass --check to only print how good each one is.
import { writeFileSync } from 'node:fs';
import { americanoPlan } from '../shared/tournamentPlan';
import { encodeRound, onCourtFor, PATTERN_ROUNDS, patternKey, searchPattern, tallyOf, type SeatRound } from '../shared/americanoSchedule';

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

const out: Record<string, string[]> = {};
for (let n = 6; n <= 16; n++) {
  for (const courts of n < 8 ? [1] : [1, 2]) {
    const oc = onCourtFor(n, courts);
    const p = searchPattern(n, oc, PATTERN_ROUNDS, TRIES, n * 10 + courts);
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
