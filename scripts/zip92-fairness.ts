// Zip 92: THE FAIRNESS TABLE (shared/tournamentFairness.ts) for 8 to 16 players, 1 and 2 courts, 2 / 2.5 / 3 hours, both styles.
//   npx vite-node scripts/zip92-fairness.ts            every row
//   npx vite-node scripts/zip92-fairness.ts -- fails   only the rows that fail
import { fairnessOf } from '../shared/tournamentFairness';

const onlyFails = process.argv.includes('fails');
console.log('players  style      courts hours  regular (min-max)  playoff  rounds  last-from  fits  result');
for (const style of ['doubles', 'americano'] as const)
  for (let n = 8; n <= 16; n++) {
    if (style === 'doubles' && n % 2 === 1) continue;
    for (const courts of [2, 1])
      for (const minutes of [120, 150, 180]) {
        const f = fairnessOf(n, courts, minutes, style);
        const why = [!f.even && 'uneven', !f.enough && 'too few', !f.noEarlyEnd && 'ends early', !f.fits && 'too tight'].filter(Boolean).join(', ');
        if (onlyFails && f.pass) continue;
        console.log(
          `${String(n).padEnd(8)} ${(style === 'doubles' ? 'Locked' : 'Americano').padEnd(10)} ${String(courts).padEnd(6)} ${String(minutes / 60).padEnd(6)} ${`${f.min}-${f.max}`.padEnd(18)} ${String(f.playoff).padEnd(8)} ${String(f.rounds).padEnd(7)} ${String(f.earliestLast).padEnd(10)} ${(f.fits ? 'yes' : 'no').padEnd(5)} ${f.pass ? 'PASS' : `FAIL (${why})`}`,
        );
      }
  }
