// Audit 73 (schedules 6 to 16): a sweep of every count 6..16, 1 and 2 courts, every court length the organizer's Time pickers offer (1 to 6
// hours on the half hour), both styles. Prints a compact table to .data/audit73-sched/sweep.txt and asserts only what the rules promise.
// Read-only audit test: it changes no code.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { americanoNight } from '../shared/americanoSchedule';
import { backToBack, resolveGames, schedule, seededRandom, type GameResult, type PlannedGame } from '../shared/tournamentSchedule';
import { fitWords, nightPlan, ROUND_MINUTES, END_BUFFER, styleFor, PLAYOFF_TO, type GameTo } from '../shared/tournamentPlan';
import { suggestedPlan } from '../shared/tournament';

const START = 19 * 60 + 30; // The Cold Open: 7:30 PM
const MINUTES = Array.from({ length: 11 }, (_, i) => 60 + i * 30); // 60..360: playEnds() in src/pages/admin/Tournament.tsx
const clock = (m: number) => `${Math.floor(m / 60) % 12 || 12}:${String(m % 60).padStart(2, '0')}`;

/** Rounds each team plays in a doubles night, with playoffs resolved by a seeded random result for each game. */
function doublesRun(teams: number, courts: number, seed: number) {
  const games = schedule(teams, courts);
  const rnd = seededRandom(seed);
  const results = new Map<number, GameResult>();
  // Play in order: each game gets a random winner and a random score (no ties: distinct scores) once its teams are known.
  for (const g of games) {
    const res = resolveGames(teams, games, results);
    const r = res.find((x) => x.num === g.num)!;
    if (r.a === null || r.b === null) {
      // Still tied (a wheel would decide): pick by seat to keep going.
      continue;
    }
    const aWins = rnd() < 0.5;
    const lose = Math.floor(rnd() * 10);
    results.set(g.num, { num: g.num, winner: aWins ? 'a' : 'b', scoreA: aWins ? 11 : lose, scoreB: aWins ? lose : 11 });
  }
  const res = resolveGames(teams, games, results);
  const roundsOf = new Map<number, number[]>();
  for (const g of games) {
    const r = res.find((x) => x.num === g.num)!;
    for (const s of [r.a, r.b]) if (s !== null) roundsOf.set(s, [...(roundsOf.get(s) ?? []), g.round]);
  }
  return { games, roundsOf, unresolved: res.filter((r) => r.a === null || r.b === null).length };
}

function maxRun(rounds: number[]): number {
  const s = [...new Set(rounds)].sort((a, b) => a - b);
  let best = s.length ? 1 : 0;
  let run = 1;
  for (let i = 1; i < s.length; i++) {
    run = s[i] === s[i - 1] + 1 ? run + 1 : 1;
    best = Math.max(best, run);
  }
  return best;
}

/** True back to back as backToBack() defines it (both rounds have one game only), counted over ALL stages for the team's real games. */
function oneCourtB2B(games: readonly PlannedGame[], rounds: number[]): number {
  const perRound = new Map<number, number>();
  for (const g of games) perRound.set(g.round, (perRound.get(g.round) ?? 0) + 1);
  const s = [...rounds].sort((a, b) => a - b);
  let n = 0;
  for (let i = 1; i < s.length; i++) if (s[i] === s[i - 1] + 1 && perRound.get(s[i]) === 1 && perRound.get(s[i - 1]) === 1) n++;
  return n;
}

type Row = Record<string, string | number | boolean>;
const rows: Row[] = [];
const problems: string[] = [];

describe('audit 73: schedule sweep 6..16 x 1/2 courts x 60..360 min x both styles', () => {
  it('builds every combination and writes the table', () => {
    for (let n = 6; n <= 16; n++)
      for (const courts of [1, 2])
        for (const minutes of MINUTES)
          for (const asked of ['doubles', 'americano'] as const) {
            const style = styleFor(asked, n);
            if (asked === 'doubles' && style === 'americano') {
              // Odd count asked as Locked doubles: must plan as Americano (Auto's switch).
              expect(nightPlan(n, courts, minutes, 'doubles').style).toBe('americano');
              continue; // the Americano row covers it
            }
            const plan = nightPlan(n, courts, minutes, style);
            const fit = fitWords(plan, START);
            const end = START + minutes;
            const row: Row = { n, courts, minutes, style, fits: plan.fits, gameTo: plan.gameTo, planRounds: plan.rounds, used: plan.minutesUsed };
            if (style === 'doubles') {
              const teams = n / 2;
              // Pool b2b by the module's own definition, every seat.
              const games = schedule(teams, courts);
              const schedRounds = Math.max(...games.map((g) => g.round));
              let finish = START;
              for (let r = 1; r <= schedRounds; r++) {
                const list = games.filter((g) => g.round === r);
                finish += list.every((g) => g.stage === 'pool') ? ROUND_MINUTES[plan.gameTo] : ROUND_MINUTES[PLAYOFF_TO];
              }
              let poolB2B = 0;
              for (let s = 1; s <= teams; s++) poolB2B += backToBack(games, s);
              // Over 30 random nights: the longest run of rounds in a row any team plays, and true back to backs (1-game rounds) incl. playoffs.
              let maxConsec = 0;
              let maxPoolConsec = 0;
              let worstB2B = 0;
              let unresolved = 0;
              for (let seed = 1; seed <= 30; seed++) {
                const run = doublesRun(teams, courts, seed);
                unresolved = Math.max(unresolved, run.unresolved);
                let b = 0;
                for (const [seat, rs] of run.roundsOf) {
                  maxConsec = Math.max(maxConsec, maxRun(rs));
                  b += oneCourtB2B(run.games, rs);
                  const poolRs = run.games.filter((g) => g.stage === 'pool' && (g.a === `T${seat}` || g.b === `T${seat}`)).map((g) => g.round);
                  maxPoolConsec = Math.max(maxPoolConsec, maxRun(poolRs));
                }
                worstB2B = Math.max(worstB2B, b);
              }
              // Sit-outs in pool rounds per team (rounds with a game where this team is idle), min/max.
              const poolRounds = [...new Set(games.filter((g) => g.stage === 'pool').map((g) => g.round))];
              const sits = Array.from({ length: teams }, (_, i) => poolRounds.filter((r) => !games.some((g) => g.round === r && (g.a === `T${i + 1}` || g.b === `T${i + 1}`))).length);
              const poolGames = Array.from({ length: teams }, (_, i) => games.filter((g) => g.stage === 'pool' && (g.a === `T${i + 1}` || g.b === `T${i + 1}`)).length);
              Object.assign(row, {
                schedRounds,
                finish: clock(finish),
                end: clock(end),
                overBy: Math.max(0, finish - (end - END_BUFFER)),
                poolB2B,
                worstB2BAllStages: worstB2B,
                maxPoolConsec,
                maxConsecAll: maxConsec,
                sitMin: Math.min(...sits),
                sitMax: Math.max(...sits),
                poolGamesMin: Math.min(...poolGames),
                poolGamesMax: Math.max(...poolGames),
                stages: [...new Set(games.map((g) => g.stage))].join('/'),
                unresolved,
              });
              // The plan and the schedule agree: same number of rounds, same finish.
              if (schedRounds !== plan.rounds) problems.push(`D ${n}p ${courts}c ${minutes}m: plan rounds ${plan.rounds} != schedule rounds ${schedRounds}`);
              if (finish !== START + plan.minutesUsed) problems.push(`D ${n}p ${courts}c ${minutes}m: plan used ${plan.minutesUsed} != schedule ${finish - START}`);
              if (plan.fits && finish > end - END_BUFFER) problems.push(`D ${n}p ${courts}c ${minutes}m: says fits but ends ${clock(finish)} after ${clock(end - END_BUFFER)}`);
            } else {
              const ids = Array.from({ length: n }, (_, i) => `p${String(i + 1).padStart(2, '0')}`);
              const night = americanoNight(ids, courts, minutes, `audit73-${n}`);
              const games = new Map(ids.map((id) => [id, [] as number[]]));
              for (const g of night.games) for (const id of [...g.a, ...g.b]) games.get(id)!.push(g.round);
              const sitCount = ids.map((id) => [...night.sits.values()].filter((s) => s.includes(id)).length);
              const gameCount = ids.map((id) => games.get(id)!.length);
              // Fairness at every round: sit-outs never differ by more than 1 at any prefix.
              let prefixSpread = 0;
              const running = new Map(ids.map((id) => [id, 0]));
              for (let r = 1; r <= night.rounds; r++) {
                for (const id of night.sits.get(r) ?? []) running.set(id, running.get(id)! + 1);
                const v = [...running.values()];
                prefixSpread = Math.max(prefixSpread, Math.max(...v) - Math.min(...v));
              }
              // Longest run of consecutive sits for one player.
              let maxSitRun = 0;
              for (const id of ids) {
                const sr = [...night.sits.entries()].filter(([, s]) => s.includes(id)).map(([r]) => r);
                maxSitRun = Math.max(maxSitRun, maxRun(sr));
              }
              let maxConsec = 0;
              for (const rs of games.values()) maxConsec = Math.max(maxConsec, maxRun(rs));
              // Partner repeats while an unused partner was possible.
              const partnered = new Map<string, number>();
              let earlyRepeat = 0;
              for (const g of night.games)
                for (const [x, y] of [g.a, g.b]) {
                  const k = [x, y].sort().join('+');
                  if (partnered.has(k)) {
                    const usedX = [...partnered.keys()].filter((p) => p.split('+').includes(x)).length;
                    const usedY = [...partnered.keys()].filter((p) => p.split('+').includes(y)).length;
                    if (usedX < n - 1 || usedY < n - 1) earlyRepeat++;
                  }
                  partnered.set(k, (partnered.get(k) ?? 0) + 1);
                }
              const usedCourts = new Set(night.games.map((g) => g.court)).size;
              const finish = START + night.rounds * ROUND_MINUTES[plan.gameTo as GameTo];
              Object.assign(row, {
                schedRounds: night.rounds,
                finish: clock(finish),
                end: clock(end),
                overBy: Math.max(0, finish - (end - END_BUFFER)),
                courtsUsed: usedCourts,
                gamesMin: Math.min(...gameCount),
                gamesMax: Math.max(...gameCount),
                sitMin: Math.min(...sitCount),
                sitMax: Math.max(...sitCount),
                sitPrefixSpread: prefixSpread,
                maxSitRun,
                maxConsecAll: maxConsec,
                earlyPartnerRepeats: earlyRepeat,
              });
              if (night.rounds !== plan.rounds) problems.push(`A ${n}p ${courts}c ${minutes}m: plan rounds ${plan.rounds} != night ${night.rounds}`);
              if (plan.fits && Math.min(...gameCount) < 4) problems.push(`A ${n}p ${courts}c ${minutes}m: says fits but min games ${Math.min(...gameCount)}`);
              if (finish > end - END_BUFFER) problems.push(`A ${n}p ${courts}c ${minutes}m: ends ${clock(finish)} after ${clock(end - END_BUFFER)}`);
              if (prefixSpread > 1) problems.push(`A ${n}p ${courts}c ${minutes}m: sit spread ${prefixSpread} at some round`);
              if (Math.max(...sitCount) - Math.min(...sitCount) > 1) problems.push(`A ${n}p ${courts}c ${minutes}m: sits ${Math.min(...sitCount)}..${Math.max(...sitCount)}`);
              if (earlyRepeat > 0) problems.push(`A ${n}p ${courts}c ${minutes}m: ${earlyRepeat} partner repeats while a new partner was free`);
            }
            row.fit = fit.text;
            // A "too tight on 2 courts" line that tells the organizer to "Use 2 courts".
            if (!fit.fits && courts === 2 && /Use 2 courts/.test(fit.text)) row.badAdvice = true;
            rows.push(row);
          }
    // The starting suggestion for every count fits, in both styles.
    const sug: Row[] = [];
    for (let n = 6; n <= 16; n++) {
      const s = suggestedPlan(n);
      for (const asked of ['doubles', 'americano'] as const) {
        const p = nightPlan(n, s.courts, s.minutes, asked);
        sug.push({ n, asked, style: p.style, courts: s.courts, minutes: s.minutes, start: clock(s.start), fits: p.fits, text: fitWords(p, s.start).text });
      }
    }
    const dir = join(process.cwd(), '.data/audit73-sched');
    mkdirSync(dir, { recursive: true });
    const line = (r: Row) => Object.entries(r).map(([k, v]) => `${k}=${v}`).join(' ');
    writeFileSync(join(dir, 'sweep.txt'), [...rows.map(line), '', '# suggestions', ...sug.map(line), '', '# problems', ...problems].join('\n') + '\n');
    console.log(`rows ${rows.length}; problems ${problems.length}\n${problems.slice(0, 40).join('\n')}`);
    console.log(sug.map(line).join('\n'));
    expect(rows.length).toBeGreaterThan(0);
    for (const s of sug) expect(s.fits, `suggestion ${s.n} ${s.asked}`).toBe(true);
  });

  it('the plan and the schedule agree for every combination (rounds, minutes, fits, sit-outs, partners)', () => {
    expect(problems).toEqual([]);
  });

  it('FINDING: a too-tight line on 2 courts tells the organizer to "Use 2 courts" (16 players, 2 courts, 7:30-10 PM = The Cold Open)', () => {
    const text = fitWords(nightPlan(16, 2, 150, 'doubles'), START).text;
    // Expected wording would not suggest what is already chosen.
    expect(text).toBe('Locked doubles for 16: too tight on 2 courts. Use 2 courts or add court time.');
    const bad = rows.filter((r) => r.badAdvice).map((r) => `${r.n}/${r.courts}c/${r.minutes}m/${r.style}`);
    console.log(`2-court too-tight lines that say "Use 2 courts": ${bad.length}: ${bad.filter((b) => b.includes('/150m/')).join(', ')}`);
    expect(bad.length).toBeGreaterThan(0);
  });

  it('FINDING: 14 players (7 teams) on 2 courts: a Pool A team plays 3 rounds in a row while others in its pool rest', () => {
    const games = schedule(7, 2);
    const seat3 = games.filter((g) => g.stage === 'pool' && (g.a === 'T3' || g.b === 'T3')).map((g) => g.round);
    expect(seat3).toEqual([2, 3, 4]);
    // Pool A rounds have ONE Pool A game each in rounds 1-3 (Pool B is on the other court): seat 3 gets no rest between its 3 games.
    expect(games.filter((g) => g.pool === 'A' && g.round <= 3).length).toBe(3);
  });
});
