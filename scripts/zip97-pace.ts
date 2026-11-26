// Zip 97 (🎾97.real pace): the numbers the report asks for, from the live functions.
//   npx vite-node scripts/zip97-pace.ts
// 1. The Cold Open (Tue Dec 1, 7:30 to 10 PM, 2 courts; Locked doubles by vote) at 6 to 12 locked in: the style the count plays (the style rule),
//    rounds, game length, done about, minutes to spare, and the organizer card's court time line.
// 2. Every suggested court time (suggestedPlan) and whether a SHORTER booking now gives everyone a full night (the court time line's rule).
import { playsAmericano, suggestedPlan } from '../shared/tournament';
import { courtTimeLine } from '../shared/tournamentCard';
import { clockLabel, nightPlan, type NightPlan } from '../shared/tournamentPlan';

const START = 19 * 60 + 30;
const what = (p: NightPlan) =>
  p.doubles
    ? `${p.doubles.teams} teams: ${p.doubles.poolRounds} ${p.doubles.shape === 'pools' ? 'group' : 'round robin'} rounds${p.builtIn.semis || p.doubles.semis ? ' + semis' : ''} + ${p.builtIn.bestOf3 ? 'best of 3 Final' : 'Final'}${p.doubles.third ? ' and 3rd place' : ''}`
    : `${p.rounds} rounds, ${p.gamesEach} games each`;
const line = (n: number, courts: number, start: number, minutes: number) =>
  courtTimeLine({ finalDate: '2026-12-01', signups: [], tickets: [], lockedIn: n, courts, start, minutes, format: 'doubles' } as never);

console.log('THE COLD OPEN (7:30 to 10 PM, 2 courts, Locked doubles by vote):');
for (let n = 6; n <= 12; n++) {
  const style = playsAmericano(n) ? 'americano' : 'doubles';
  const p = nightPlan(n, 2, 150, style);
  console.log(
    `${String(n).padStart(2)} ${style === 'doubles' ? 'Locked doubles' : 'Americano'}: ${what(p)}, to ${p.gameTo}${p.breaks ? `, ${p.breaks} breaks` : ''}, done about ${clockLabel(START + p.minutesUsed)}, ${150 - p.minutesUsed} min to spare | ${line(n, 2, START, 150)}`,
  );
}

console.log('\nSUGGESTED COURT TIME (suggestedPlan) and the court time line at that booking:');
for (let n = 6; n <= 16; n++) {
  const s = suggestedPlan(n);
  console.log(`${String(n).padStart(2)}: ${s.courts} ${s.courts === 1 ? 'court' : 'courts'} ${s.minutes / 60} h from ${clockLabel(s.start)} | ${line(n, s.courts, s.start, s.minutes)}`);
}
