import { describe, expect, it } from 'vitest';
import { AMERICANO_PATTERNS } from '../shared/americanoPatterns';
import { americanoNight, decodeRound, onCourtFor, PATTERN_ROUNDS, patternKey, seatRounds, sitLimit, tallyOf, type SeatRound } from '../shared/americanoSchedule';
import { americanoPlan } from '../shared/tournamentPlan';
import { schedule } from '../shared/tournamentSchedule';

// Zip 80 (🎾80.leftovers): fair sit-outs. Americano: nobody sits more than sitLimit rounds in a row (2 wherever it can be done: every 2 court
// size, and 1 court up to 10 players), sit-outs differ by at most 1 after every round, no partner repeats while a partner is unused, at every
// length a night can cut a pattern to and past the saved 16 rounds. Locked doubles: no team plays 3 rounds in a row where an order allows it.

const sizes = [...Array(11).keys()].map((i) => i + 6);
const keys = sizes.flatMap((n) => (n < 8 ? [[n, 4]] : [[n, 4], [n, 8]]));

/** The most rounds anyone sits in a row and the widest sit-out gap after any round, for these rounds. */
function sitsOf(n: number, rounds: readonly SeatRound[]) {
  const run = new Array<number>(n).fill(0);
  const sits = new Array<number>(n).fill(0);
  let most = 0;
  let gap = 0;
  for (const r of rounds) {
    for (let x = 0; x < n; x++) run[x] = r.sit.includes(x) ? run[x] + 1 : 0;
    for (const s of r.sit) sits[s]++;
    most = Math.max(most, ...run);
    gap = Math.max(gap, Math.max(...sits) - Math.min(...sits));
  }
  return { most, gap };
}

/** Pairs of players who met as opponents twice or more in the first k rounds. */
function repeatedOpponents(n: number, rounds: readonly SeatRound[], k: number): number {
  const t = tallyOf(n, rounds.slice(0, k));
  let c = 0;
  for (let x = 0; x < n; x++) for (let y = x + 1; y < n; y++) if (t.opp[x][y] >= 2) c++;
  return c;
}

describe('zip 80: Americano sit-outs, every size 6 to 16, 1 and 2 courts', () => {
  it('the limit: 2 on every 2 court size and on 1 court up to 10; 3 for 11 to 13 on 1 court; 4 for 14 to 16 on 1 court', () => {
    for (let n = 8; n <= 16; n++) expect(sitLimit(n, 8), `${n}:8`).toBe(2);
    expect(sizes.map((n) => sitLimit(n, 4))).toEqual([2, 2, 2, 2, 2, 3, 3, 3, 4, 4, 4]);
  });

  for (const [n, oc] of keys)
    it(`${n} players, ${oc} on court: the rule at every length 1 to 16 and carried on to 24 rounds`, () => {
      const saved = AMERICANO_PATTERNS[patternKey(n, oc)].map(decodeRound);
      expect(saved).toHaveLength(PATTERN_ROUNDS);
      for (let k = 1; k <= PATTERN_ROUNDS; k++) {
        const s = sitsOf(n, saved.slice(0, k));
        expect(s.most, `${n}:${oc} first ${k}`).toBeLessThanOrEqual(sitLimit(n, oc));
        expect(s.gap, `${n}:${oc} first ${k}`).toBeLessThanOrEqual(1);
      }
      const long = sitsOf(n, seatRounds(n, oc, 24));
      expect(long.most).toBeLessThanOrEqual(sitLimit(n, oc));
      expect(long.gap).toBeLessThanOrEqual(1);
    });

  it('no partner repeats while a partner is still unused, in every changed pattern (all 16 rounds)', () => {
    for (const key of ['9:4', '10:4', '11:4', '12:4', '13:4', '14:4', '15:4', '16:4', '15:8']) {
      const n = Number(key.split(':')[0]);
      const rounds = AMERICANO_PATTERNS[key].map(decodeRound);
      let early = 0;
      rounds.forEach((r, i) => {
        const t = tallyOf(n, rounds.slice(0, i));
        for (const g of r.games)
          for (const [x, y] of [g.a, g.b]) {
            const minX = Math.min(...[...Array(n).keys()].filter((o) => o !== x).map((o) => t.partner[x][o]));
            const minY = Math.min(...[...Array(n).keys()].filter((o) => o !== y).map((o) => t.partner[y][o]));
            if (t.partner[x][y] > minX || t.partner[x][y] > minY) early++;
          }
      });
      expect(early, key).toBe(0);
    }
  });

  it('the opponent mix at the lengths a real night uses (pairs who meet twice or more; the numbers before Zip 80 in the comment)', () => {
    const at = (key: string, ks: number[]) => ks.map((k) => repeatedOpponents(Number(key.split(':')[0]), AMERICANO_PATTERNS[key].map(decodeRound), k));
    expect(at('9:4', [9, 10, 12])).toEqual([3, 6, 12]); // before: 9, 13, 17
    expect(at('10:4', [10, 11, 12])).toEqual([7, 9, 10]); // before: 6, 9, 12 (7 at 10 is the least with 2 in a row; see the stage notes)
    expect(at('11:4', [11, 12])).toEqual([0, 0]); // before: 5, 8
    expect(at('12:4', [12, 13, 14])).toEqual([2, 3, 3]); // before: 6, 8, 11
    expect(at('13:4', [13, 14, 15])).toEqual([0, 1, 2]); // before: 6, 6, 7
    for (const key of ['14:4', '15:4', '16:4']) expect(at(key, [14, 15, 16]), key).toEqual([0, 0, 0]); // before: 2-4, 3-5, 1-4
    expect(at('15:8', [8, 9, 10, 11, 12])).toEqual([0, 0, 1, 3, 8]); // before: 0, 0, 3, 5, 9
  });

  it('a real night: 9 and 10 players on 1 and 2 courts, 2 to 3 hours: nobody sits 3 rounds in a row (by player)', () => {
    for (const n of [9, 10])
      for (const courts of [1, 2])
        for (const minutes of [120, 150, 180]) {
          const ids = [...Array(n).keys()].map((i) => `p${i}`);
          const night = americanoNight(ids, courts, minutes, 'cold-open');
          expect(night.rounds).toBe(americanoPlan(n, courts, minutes).rounds);
          const run = new Map(ids.map((id) => [id, 0]));
          for (let r = 1; r <= night.rounds; r++) {
            const sit = new Set(night.sits.get(r));
            for (const id of ids) run.set(id, sit.has(id) ? run.get(id)! + 1 : 0);
            expect(Math.max(...run.values()), `${n} on ${courts} court(s), ${minutes} min, round ${r}`).toBeLessThanOrEqual(2);
          }
          expect(onCourtFor(n, courts)).toBe(courts === 2 ? 8 : 4);
        }
  });
});

describe('zip 80: Locked doubles, no team plays 3 rounds in a row where an order allows it', () => {
  /** Most rounds in a row a team plays (pool games, then the first playoff round as if it got in) and most pool rounds in a row it sits. */
  function runs(teams: number, courts: number) {
    const g = schedule(teams, courts).filter((x) => x.stage === 'pool');
    const last = Math.max(...g.map((x) => x.round));
    let play = 0;
    let sit = 0;
    for (let s = 1; s <= teams; s++) {
      let p = 0;
      let q = 0;
      for (let r = 1; r <= last + 1; r++) {
        const plays = r > last || g.some((x) => x.round === r && (x.a === `T${s}` || x.b === `T${s}`));
        p = plays ? p + 1 : 0;
        q = plays ? 0 : q + 1;
        play = Math.max(play, p);
        if (r <= last) sit = Math.max(sit, q);
      }
    }
    return { play, sit };
  }

  it('14 players on 2 courts: at most 2 in a row, even counting the semifinal, and nobody sits more than 2 in a row', () => {
    expect(runs(7, 2)).toEqual({ play: 2, sit: 2 });
  });

  it('every pool game once, each round a real split, Pool B always on Court 2 beside a Pool A game', () => {
    const g = schedule(7, 2).filter((x) => x.stage === 'pool');
    expect(g).toHaveLength(9);
    const pairs = g.map((x) => [x.a, x.b].sort().join('-'));
    expect(new Set(pairs).size).toBe(9);
    for (const x of g.filter((y) => y.pool === 'B')) {
      expect(x.court).toBe(2);
      expect(g.some((y) => y.round === x.round && y.pool === 'A' && y.court === 1)).toBe(true);
    }
    for (let r = 1; r <= 5; r++) {
      const seats = g.filter((x) => x.round === r).flatMap((x) => [x.a, x.b]);
      expect(new Set(seats).size).toBe(seats.length);
    }
  });

  it('every other size keeps what it had: playing 3 or more in a row only where every team plays every round or one sits once in 5', () => {
    // 4 teams on 2 courts: all 4 play every round; 5 teams on 2 courts: one team sits each round (each once), so the team sitting first plays
    // the other 4; a group of 3 (6 teams on 2 courts, and 3 teams): every order has a team play the last two, then the playoff. Else 2 at most.
    const allowed: Record<string, number> = { '3:1': 3, '3:2': 3, '4:2': 4, '5:2': 5, '6:2': 3 };
    for (let teams = 3; teams <= 8; teams++)
      for (const courts of [1, 2]) expect(runs(teams, courts).play, `${teams} teams ${courts}`).toBeLessThanOrEqual(allowed[`${teams}:${courts}`] ?? 2);
  });
});
