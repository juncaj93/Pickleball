// Zip 61: works out the saved Americano patterns (shared/americanoPatterns.ts) once, offline: `npx vite-node scripts/americano-patterns.ts`.
// For every size 6 to 16 and 1 or 2 courts, many seeded tries of the round by round rules, the best kept (shared/americanoSchedule.ts). The
// result is the same on every run (seeded), so running it again rewrites the same file. Pass --check to only print how good each one is.
// Zip 74: 7 players on 1 court has one more rule (nobody sits 3 rounds in a row), so it comes from its own seeded search (`noLongSits`).
// Zip 80: the sit rule for every size (SIT_LIMIT in shared/americanoSchedule.ts): the sizes that broke it come from the sit searches in
// scripts/americano-patterns-lib.ts (FIXED below); every other size is still made exactly as before, so its saved pattern did not change.
import { writeFileSync } from 'node:fs';
import { americanoPlan } from '../shared/tournamentPlan';
import { encodeRound, onCourtFor, PATTERN_ROUNDS, patternKey, searchPattern, sitLimit, type SeatRound } from '../shared/americanoSchedule';
import { noLongSits, noLongSitsLean, quality, searchNoLongSits, sitStats } from './americano-patterns-lib';

const TRIES = Number(process.env.TRIES ?? 400);

/**
 * Zip 80: the sizes that let someone sit 3 or more rounds in a row before, each from a sit search at its limit (sitLimit). 1 court: the beam
 * (noLongSitsLean, the width and the opponent cap tried until the mix was as good as before, or as good as the limit allows); 2 courts (15
 * players): the seeded tries with the sit rule (searchNoLongSits).
 */
const FIXED: Record<string, () => SeatRound[]> = {
  '9:4': () => noLongSitsLean(9, PATTERN_ROUNDS, 4000, 1, sitLimit(9, 4)),
  '10:4': () => noLongSitsLean(10, PATTERN_ROUNDS, 4000, 1, sitLimit(10, 4)),
  '11:4': () => noLongSitsLean(11, PATTERN_ROUNDS, 4000, 1, sitLimit(11, 4)),
  '12:4': () => noLongSitsLean(12, PATTERN_ROUNDS, 3000, 1, sitLimit(12, 4)),
  '13:4': () => noLongSitsLean(13, PATTERN_ROUNDS, 600, 1, sitLimit(13, 4)),
  '14:4': () => noLongSitsLean(14, PATTERN_ROUNDS, 2000, 1, sitLimit(14, 4)),
  '15:4': () => noLongSitsLean(15, PATTERN_ROUNDS, 2000, 1, sitLimit(15, 4)),
  '16:4': () => noLongSitsLean(16, PATTERN_ROUNDS, 2000, 1, sitLimit(16, 4)),
  '15:8': () => searchNoLongSits(15, 8, PATTERN_ROUNDS, 400, 24, sitLimit(15, 8), 2),
};

const out: Record<string, string[]> = {};
for (let n = 6; n <= 16; n++) {
  for (const courts of n < 8 ? [1] : [1, 2]) {
    const oc = onCourtFor(n, courts);
    const key = patternKey(n, oc);
    const p = FIXED[key] ? FIXED[key]() : n === 7 && oc === 4 ? noLongSits(n, PATTERN_ROUNDS) : searchPattern(n, oc, PATTERN_ROUNDS, TRIES, n * 10 + courts);
    const sat = sitStats(n, p);
    if (sat.maxRun > sitLimit(n, oc) || sat.maxGap > 1) throw new Error(`${key}: sits ${sat.maxRun} in a row (limit ${sitLimit(n, oc)}), sit-outs ${sat.maxGap} apart`);
    out[patternKey(n, oc)] = p.map(encodeRound);
    const at = [120, 150, 180].map((m) => americanoPlan(n, courts, m)).filter((x) => x.fits).map((x) => {
      const q = quality(n, p.slice(0, x.rounds));
      return `${x.minutes / 60}h ${x.rounds}r: early ${q.early}, opp ${q.oMin}..${q.oMax}${oc === 8 ? `, courts ${q.cSpread}` : ''}`;
    });
    console.log(`${n}p ${courts}c (${oc} on): all ${PATTERN_ROUNDS} early ${quality(n, p).early}, most sits in a row ${sat.maxRun} | ${at.join(' | ')}`);
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
