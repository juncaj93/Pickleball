// Zip 89 (🎾89.smart pacing): the base plan BEFORE (today's live plan: rounds 23/19/16 minutes, 10 minutes kept free, no warm-up, no breaks) and
// AFTER (20/16/13, 20 kept free, 10 minutes of warm-up at the start, a 5 minute break after every 2nd round when nobody sits) for every size 6 to
// 16, 1 and 2 courts, 2 / 2.5 / 3 hours, both styles; then The Cold Open (Tue Dec 1, 7:30 to 10 PM, 2 courts) for every likely headcount.
//   npx vite-node scripts/zip89-plan-table.ts
// The AFTER numbers are the live functions (shared/tournamentPlan.ts nightPlan); BEFORE is the same rules with the old numbers.
import { doublesStructure, nightPlan, styleFor, type GameTo, type NightPlan } from '../shared/tournamentPlan';

const OLD = { 11: 23, 9: 19, 7: 16 } as Record<GameTo, number>;
const OLD_BUFFER = 10;
const LENGTHS: GameTo[] = [11, 9, 7];

export function oldPlan(players: number, courts: number, minutes: number, style: 'doubles' | 'americano') {
  const budget = minutes - OLD_BUFFER;
  if (styleFor(style, players) === 'doubles') {
    const s = doublesStructure(Math.floor(players / 2), courts);
    const used = (l: GameTo) => s.poolRounds * OLD[l] + s.playoffRounds * OLD[11];
    const len = LENGTHS.find((l) => used(l) <= budget) ?? 7;
    return { rounds: s.poolRounds + s.playoffRounds, gameTo: len, used: used(len) };
  }
  const onCourt = 4 * Math.max(1, Math.min(courts, Math.floor(players / 4)));
  const at = (l: GameTo) => {
    const rounds = Math.max(0, Math.floor(budget / OLD[l]));
    return { rounds, each: (rounds * onCourt) / players };
  };
  const len = LENGTHS.find((l) => at(l).each >= 4) ?? 7;
  return { rounds: at(len).rounds, gameTo: len, used: at(len).rounds * OLD[len] };
}

const clock = (m: number) => {
  const h = Math.floor(m / 60);
  return `${h % 12 === 0 ? 12 : h % 12}:${String(Math.round(m % 60)).padStart(2, '0')}`;
};
const START = 19 * 60 + 30;
const rows: string[] = [];
const shorter: string[] = [];
for (const style of ['doubles', 'americano'] as const)
  for (const courts of [1, 2])
    for (const minutes of [120, 150, 180])
      for (let n = 6; n <= 16; n++) {
        if (style === 'doubles' && n % 2) continue;
        const b = oldPlan(n, courts, minutes, style);
        const a = nightPlan(n, courts, minutes, style);
        const line = `${style === 'doubles' ? 'LD' : 'AM'} ${String(n).padStart(2)}p ${courts}c ${(minutes / 60).toFixed(1)}h | before ${String(b.rounds).padStart(2)} rd to ${String(b.gameTo).padStart(2)} ${String(b.used).padStart(3)} min ends ${clock(START + b.used)} | after ${String(a.rounds).padStart(2)} rd to ${String(a.gameTo).padStart(2)} +10 warm-up${a.breaks ? ` +${a.breaks} break${a.breaks > 1 ? 's' : ''}` : ''} ${String(a.minutesUsed).padStart(3)} min ends ${clock(START + a.minutesUsed)}${a.fits ? '' : ' (too tight)'}`;
        rows.push(line);
        if (a.rounds < b.rounds || a.gameTo < b.gameTo) shorter.push(line);
      }
console.log(rows.join('\n'));
console.log(`\nSHORTER AFTER (fewer rounds or shorter games): ${shorter.length}`);
console.log(shorter.join('\n'));

// The Cold Open, Tue Dec 1, 7:30 to 10 PM, 2 courts, for 8 to 12 locked in: the style each count plays (odd: Americano), and Americano for the
// even counts too (in case Alex switches).
const what = (p: NightPlan) =>
  p.doubles
    ? p.doubles.shape === 'pools'
      ? `${p.doubles.teams} teams in 2 groups: ${p.doubles.poolRounds} group rounds + semis + Final and 3rd place`
      : `${p.doubles.teams} teams: ${p.doubles.poolRounds} round robin rounds + Final and 3rd place`
    : `${p.rounds} rounds, ${p.onCourt} on court, ${p.gamesEach} games each`;
console.log('\nDEC 1 (7:30 to 10 PM, 2 courts, 10 min warm-up, finish at least 20 min before 10 PM):');
for (let n = 8; n <= 12; n++)
  for (const style of n % 2 ? (['americano'] as const) : (['doubles', 'americano'] as const)) {
    const p = nightPlan(n, 2, 150, style);
    const b = oldPlan(n, 2, 150, style);
    const spare = 150 - p.minutesUsed;
    const flags = [p.rounds < b.rounds || p.gameTo < b.gameTo ? `SHORTER than today (${b.rounds} rd to ${b.gameTo})` : '', spare > 40 ? 'MORE THAN 40 MIN UNUSED' : ''].filter(Boolean);
    console.log(
      `${n} ${style === 'doubles' ? 'Locked doubles' : 'Americano'}: ${what(p)}, to ${p.gameTo}, breaks ${p.breaks}, done ${clock(START + p.minutesUsed)} PM, ${spare} min to spare${flags.length ? ` [${flags.join('; ')}]` : ''}`,
    );
  }
