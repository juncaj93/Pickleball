import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { americanoPlan, BREAK_MINUTES, doublesPlan, END_BUFFER, fitWords, nightPlan, ROUND_MINUTES, suggestedPlan, WARM_UP } from '../shared/tournamentPlan';
import { planFit, smartPlan } from '../shared/tournament';

// Zip 57: the game plan table (reference/GAME_PLAN_TABLE.md from the zip, copied unchanged into tests/fixtures) is the single source of truth.
// This reads the table itself and checks EVERY row, both styles, every court time: rounds, game length, minutes used (Locked doubles), games each
// (Americano), and NO where it does not fit. The finish time is the start plus the minutes used.

const TABLE = readFileSync(join(process.cwd(), 'tests/fixtures/GAME_PLAN_TABLE.md'), 'utf8');
const HOURS: Record<string, number> = { '2h': 120, '2.5h': 150, '3h': 180 };

type Row = { style: 'doubles' | 'americano'; players: number; courts: number; minutes: number; expect: string };

function rows(): Row[] {
  const out: Row[] = [];
  let style: Row['style'] | null = null;
  for (const line of TABLE.split('\n')) {
    if (line.startsWith('## LOCKED DOUBLES')) style = 'doubles';
    else if (line.startsWith('## AMERICANO')) style = 'americano';
    else if (line.startsWith('## ')) style = null;
    const m = /^- (\d+) players, (\d) courts?: (.*)$/.exec(line);
    if (!m || !style) continue;
    for (const cell of m[3].split(' | ')) {
      const c = /^(2h|2\.5h|3h): (.*)$/.exec(cell.trim());
      if (!c) throw new Error(`bad cell: ${cell}`);
      out.push({ style, players: Number(m[1]), courts: Number(m[2]), minutes: HOURS[c[1]], expect: c[2].trim() });
    }
  }
  return out;
}

describe('zip 57: the game plan table, every row', () => {
  const all = rows();
  it('reads the whole table (Locked doubles 12 lines, Americano 20 lines, 3 court times each)', () => {
    expect(all.filter((r) => r.style === 'doubles')).toHaveLength(12 * 3);
    expect(all.filter((r) => r.style === 'americano')).toHaveLength(20 * 3);
  });
  for (const r of all) {
    it(`${r.style} ${r.players} players, ${r.courts} court${r.courts > 1 ? 's' : ''}, ${r.minutes / 60}h: ${r.expect}`, () => {
      const p = r.style === 'doubles' ? doublesPlan(r.players, r.courts, r.minutes) : americanoPlan(r.players, r.courts, r.minutes);
      // The same answer from the one entry point (nightPlan), with the style the count really plays.
      expect(nightPlan(r.players, r.courts, r.minutes, r.style)).toEqual(p);
      if (r.expect === 'NO') {
        expect(p.fits).toBe(false);
        // Never silently run over: a NO still plans games to 7 (the Time check then says how far behind).
        expect(p.gameTo).toBe(7);
        // Locked doubles runs over the court time; Americano fits its rounds but cannot give everyone 4 games.
        if (r.style === 'doubles') expect(p.minutesUsed).toBeGreaterThan(r.minutes - END_BUFFER);
        else expect(p.gamesEach!).toBeLessThan(4);
        return;
      }
      expect(p.fits).toBe(true);
      expect(p.minutesUsed).toBeLessThanOrEqual(r.minutes - END_BUFFER);
      if (r.style === 'doubles') {
        const m = /^to (\d+), (\d+) rounds, (\d+) min$/.exec(r.expect)!;
        expect([p.gameTo, p.rounds, p.minutesUsed]).toEqual([Number(m[1]), Number(m[2]), Number(m[3])]);
        // The finish time: start + minutes used, warm-up and breaks included (Zip 89; 7:00 PM start, 95 minutes: 8:35 PM).
        expect(19 * 60 + p.minutesUsed).toBe(19 * 60 + Number(m[3]));
      } else {
        const m = /^to (\d+), (\d+) rounds, ([\d.]+) games each$/.exec(r.expect)!;
        expect([p.gameTo, p.rounds, p.gamesEach!.toFixed(1)]).toEqual([Number(m[1]), Number(m[2]), m[3]]);
        // Zip 89: the minutes used are the warm-up, the rounds and the breaks. Nobody sits when everyone is on court every round (8 on 2
        // courts): then a 5 minute break after every 2nd round, never after the last.
        const noSit = p.onCourt! >= r.players;
        const breaks = noSit ? Math.floor((p.rounds - 1) / 2) : 0;
        expect([p.noSit, p.breaks]).toEqual([noSit, breaks]);
        expect(p.minutesUsed).toBe(WARM_UP + p.rounds * ROUND_MINUTES[p.gameTo] + breaks * BREAK_MINUTES);
      }
    });
  }
});

describe('zip 57: the starting suggestion, the plan line and the words', () => {
  it('suggests the table courts and hours for every count 6 to 16', () => {
    const want: Record<number, [number, number]> = { 6: [1, 150], 7: [1, 150], 8: [2, 120], 9: [2, 150], 10: [2, 150], 11: [2, 150], 12: [2, 180], 13: [2, 180], 14: [2, 180], 15: [2, 180], 16: [2, 180] };
    for (const [n, [c, m]] of Object.entries(want)) expect(suggestedPlan(Number(n))).toMatchObject({ courts: c, minutes: m });
    expect(suggestedPlan(14).start).toBe(19 * 60);
    expect(suggestedPlan(10).start).toBe(19 * 60 + 30);
  });
  it('the organizer plan for 14 and 16 is its own: 2 courts, 3 hours, 7:00 PM (no longer the 12-player plan by accident)', () => {
    for (const n of [13, 14, 15, 16]) expect(smartPlan(n)).toMatchObject({ courts: 2, minutes: 180, start: 19 * 60 });
    expect(smartPlan(12)).toMatchObject({ size: 14, courts: 2, minutes: 180 });
    expect(smartPlan(5)).toMatchObject({ size: 8, courts: 2, minutes: 120 });
    expect(smartPlan(0)).toMatchObject({ size: 6, courts: 1, minutes: 150 });
    // Every planned size uses the table's suggestion.
    for (let n = 0; n <= 20; n++) {
      const p = smartPlan(n);
      expect(p).toMatchObject(suggestedPlan(p.size));
    }
    expect(planFit(15)).toEqual({ fits: 16, over: 0 });
    expect(planFit(19)).toEqual({ fits: 16, over: 3 });
  });
  it('fit words: mocks 60 and 61', () => {
    // Zip 89 (20 a round to 11, 16 to 9, 13 to 7; 10 minutes of warm-up at the start, 20 kept free at the end, so 30 less to plan in; a 5
    // minute break after every 2nd round when nobody sits): "done about" is the start plus the warm-up, the rounds and the breaks.
    // 12 on 2 courts: 5 rounds to 11 = 100 minutes + 10 warm-up, 7:00 + 110.
    expect(fitWords(nightPlan(12, 2, 180, 'doubles'), 19 * 60)).toEqual({ fits: true, text: 'Locked doubles for 12: pool games to 11, done about 8:50 PM.' });
    expect(fitWords(nightPlan(12, 1, 120, 'doubles'), 19 * 60 + 30)).toEqual({ fits: false, text: 'Locked doubles for 12: too tight on 1 court. Use 2 courts or add court time.' });
    // 8 on 2 courts (4 teams, nobody sits): 4 rounds to 11 = 80 minutes + 1 break (after round 2) + 10 warm-up = 95 from 7:30. 9 (Americano,
    // one sits each round): 120 minutes to plan in = 6 rounds to 11 = 120 minutes + 10 warm-up.
    expect(fitWords(nightPlan(8, 2, 150, 'doubles'), 19 * 60 + 30).text).toBe('Locked doubles for 8: games to 11, done about 9:05 PM.');
    expect(fitWords(nightPlan(9, 2, 150, 'doubles'), 19 * 60 + 30).text).toBe('Americano for 9: games to 11, done about 9:40 PM.');
    // 14 and 16 (mocks 52 and 53; Zip 89 numbers, 150 minutes to plan in): 14 is 5 pool rounds + 2 playoff rounds, all to 11 (140 minutes + 10
    // warm-up): semifinals about 8:50 PM, done about 9:30. 16 is 6 + 2 rounds: all to 11 would be 160, too many, so pool games to 9 (6 x 16 + 2
    // x 20 = 136 + 10 warm-up = 146): semifinals about 8:45 PM, done about 9:25.
    expect(fitWords(nightPlan(14, 2, 180, 'doubles'), 19 * 60).text).toBe('Locked doubles for 14: pool games to 11, done about 9:30 PM.');
    expect(fitWords(nightPlan(16, 2, 180, 'doubles'), 19 * 60).text).toBe('Locked doubles for 16: pool games to 9, done about 9:25 PM.');
  });
  it('an odd count on Locked doubles plans as Americano (zip 64: odd plays Americano)', () => {
    expect(nightPlan(9, 2, 150, 'doubles').style).toBe('americano');
    expect(nightPlan(10, 2, 150, 'doubles').style).toBe('doubles');
  });
});
