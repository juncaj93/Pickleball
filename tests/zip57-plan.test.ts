import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { americanoPlan, doublesPlan, fitWords, nightPlan, ROUND_MINUTES, suggestedPlan } from '../shared/tournamentPlan';
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
        if (r.style === 'doubles') expect(p.minutesUsed).toBeGreaterThan(r.minutes - 10);
        else expect(p.gamesEach!).toBeLessThan(4);
        return;
      }
      expect(p.fits).toBe(true);
      expect(p.minutesUsed).toBeLessThanOrEqual(r.minutes - 10);
      if (r.style === 'doubles') {
        const m = /^to (\d+), (\d+) rounds, (\d+) min$/.exec(r.expect)!;
        expect([p.gameTo, p.rounds, p.minutesUsed]).toEqual([Number(m[1]), Number(m[2]), Number(m[3])]);
        // The finish time: start + minutes used (7:00 PM start, 92 minutes: 8:32 PM).
        expect(19 * 60 + p.minutesUsed).toBe(19 * 60 + Number(m[3]));
      } else {
        const m = /^to (\d+), (\d+) rounds, ([\d.]+) games each$/.exec(r.expect)!;
        expect([p.gameTo, p.rounds, p.gamesEach!.toFixed(1)]).toEqual([Number(m[1]), Number(m[2]), m[3]]);
        expect(p.minutesUsed).toBe(p.rounds * ROUND_MINUTES[p.gameTo]);
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
    expect(fitWords(nightPlan(12, 2, 180, 'doubles'), 19 * 60)).toEqual({ fits: true, text: 'Locked doubles for 12: pool games to 11, done about 8:55 PM.' });
    expect(fitWords(nightPlan(12, 1, 120, 'doubles'), 19 * 60 + 30)).toEqual({ fits: false, text: 'Locked doubles for 12: too tight on 1 court. Use 2 courts or add court time.' });
    expect(fitWords(nightPlan(8, 2, 150, 'doubles'), 19 * 60 + 30).text).toBe('Locked doubles for 8: games to 11, done about 9:00 PM.');
    expect(fitWords(nightPlan(9, 2, 150, 'doubles'), 19 * 60 + 30).text).toBe('Americano for 9: games to 11, done about 9:50 PM.');
    // 14 and 16 (mocks 52 and 53): semifinals about 8:55 PM, done about 9:40 to 9:45.
    expect(fitWords(nightPlan(14, 2, 180, 'doubles'), 19 * 60).text).toBe('Locked doubles for 14: pool games to 11, done about 9:40 PM.');
    expect(fitWords(nightPlan(16, 2, 180, 'doubles'), 19 * 60).text).toBe('Locked doubles for 16: pool games to 9, done about 9:40 PM.');
  });
  it('an odd count on Locked doubles plans as Americano (zip 64: odd plays Americano)', () => {
    expect(nightPlan(9, 2, 150, 'doubles').style).toBe('americano');
    expect(nightPlan(10, 2, 150, 'doubles').style).toBe('doubles');
  });
});
