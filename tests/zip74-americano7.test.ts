import { describe, expect, it } from 'vitest';
import { AMERICANO_PATTERNS } from '../shared/americanoPatterns';
import { decodeRound, PATTERN_ROUNDS, tallyOf, type SeatRound } from '../shared/americanoSchedule';
import { americanoPlan } from '../shared/tournamentPlan';

// Zip 74: 7 players on 1 court (4 play, 3 sit). The saved pattern '7:4' must never make anyone sit 3 rounds in a row, and keep every other rule,
// at every length a night can cut it to (a night uses the first rounds of the pattern).

const N = 7;
const rounds: SeatRound[] = AMERICANO_PATTERNS['7:4'].map(decodeRound);

/** Every length the plan can pick for 7 players on 1 court (any court time up to the saved 16 rounds), plus every length 1 to 16. */
const planLengths = [...new Set(Array.from({ length: 400 }, (_, m) => americanoPlan(N, 1, m + 30).rounds))].filter((k) => k >= 1 && k <= PATTERN_ROUNDS);
const lengths = [...new Set([...planLengths, ...Array.from({ length: PATTERN_ROUNDS }, (_, i) => i + 1)])].sort((a, b) => a - b);

describe('zip 74: the 7 player, 1 court Americano pattern', () => {
  it('has 16 rounds, each 4 distinct players and 3 distinct sitters covering seats 0 to 6', () => {
    expect(rounds).toHaveLength(PATTERN_ROUNDS);
    for (const r of rounds) {
      expect(r.games).toHaveLength(1);
      const on = [...r.games[0].a, ...r.games[0].b];
      expect(new Set(on).size).toBe(4);
      expect(new Set(r.sit).size).toBe(3);
      expect([...on, ...r.sit].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    }
  });

  it('the plan picks lengths the pattern covers (7 players, 1 court: 6 to 10 rounds for 2 to 4 hours)', () => {
    expect([120, 150, 180, 210, 240].map((m) => americanoPlan(N, 1, m).rounds)).toEqual([6, 7, 7, 8, 10]);
    expect(planLengths.length).toBeGreaterThan(5);
  });

  for (const k of lengths)
    it(`first ${k} rounds: nobody sits 3 in a row, sit-outs differ by at most 1`, () => {
      const run = new Array<number>(N).fill(0);
      const sits = new Array<number>(N).fill(0);
      for (const r of rounds.slice(0, k)) {
        for (let x = 0; x < N; x++) run[x] = r.sit.includes(x) ? run[x] + 1 : 0;
        for (const s of r.sit) sits[s]++;
        expect(Math.max(...run)).toBeLessThanOrEqual(2);
        expect(Math.max(...sits) - Math.min(...sits)).toBeLessThanOrEqual(1);
      }
    });

  it('no partner repeats while a partner is still unused (early repeats 0), at every round', () => {
    let early = 0;
    rounds.forEach((r, i) => {
      const t = tallyOf(N, rounds.slice(0, i));
      for (const [x, y] of [r.games[0].a, r.games[0].b]) {
        const minX = Math.min(...[...Array(N).keys()].filter((o) => o !== x).map((o) => t.partner[x][o]));
        const minY = Math.min(...[...Array(N).keys()].filter((o) => o !== y).map((o) => t.partner[y][o]));
        if (t.partner[x][y] > minX || t.partner[x][y] > minY) early++;
      }
    });
    expect(early).toBe(0);
  });

  it('opponents stay spread: at most 2 apart at every length up to 16 rounds', () => {
    for (let k = 1; k <= PATTERN_ROUNDS; k++) {
      const t = tallyOf(N, rounds.slice(0, k));
      const counts = [...Array(N).keys()].flatMap((x) => [...Array(N).keys()].filter((y) => y > x).map((y) => t.opp[x][y]));
      expect(Math.max(...counts) - Math.min(...counts), `${k} rounds`).toBeLessThanOrEqual(2);
    }
  });
});
