import { describe, expect, it } from 'vitest';
import { type GameResult, groupTable, type PlannedGame, resolveGames, schedule, standings, tieBlocks } from '../shared/tournamentSchedule';
import { diffLabel, resultTag, scoreHint, scorePair } from '../shared/scores';

// Zip 72 (🎾72.scores): ONE TIE RULE for Locked doubles, everywhere (Alex, Nov 20): wins, then head to head (only when exactly 2 teams are level
// and they played), then point difference, then points scored, then the wheel only if still exactly level. Pools use the same rule inside each
// pool; the same order fills the semifinals, the Final, 3rd place and End tournament. These are the pure checks (shared/tournamentSchedule.ts
// standings, groupTable, resolveGames); tests/zip72-scores.test.ts runs the same rule on the real server.

/** Results for a schedule: `score(a, b)` gives [points of a, points of b] for the pool game between seats a and b (the higher one won). */
function scored(games: PlannedGame[], score: (a: number, b: number) => [number, number]): Map<number, GameResult> {
  const m = new Map<number, GameResult>();
  for (const g of games) {
    if (g.stage !== 'pool') continue;
    const a = Number(g.a.slice(1));
    const b = Number(g.b.slice(1));
    const [x, y] = score(a, b);
    m.set(g.num, { num: g.num, winner: x > y ? 'a' : 'b', scoreA: x, scoreB: y });
  }
  return m;
}
/** A table of game scores by "winner>loser": the winner's points and the loser's. Any game not listed: the lower seat wins 11 to 7. */
const by =
  (table: Record<string, [number, number]>) =>
  (a: number, b: number): [number, number] => {
    if (table[`${a}>${b}`]) return table[`${a}>${b}`];
    if (table[`${b}>${a}`]) {
      const [w, l] = table[`${b}>${a}`];
      return [l, w];
    }
    return a < b ? [11, 7] : [7, 11];
  };
const order = (rows: { seat: number }[]) => rows.map((r) => r.seat);

describe('zip 72: the tie rule (pure)', () => {
  it('two teams level on wins: head to head decides, even when the loser of that game has the better point difference', () => {
    const g = schedule(4, 2);
    // 1 and 2 are 2-1. 2 beat 1 (11-9). 1 crushed everyone else, so 1 has the better point difference; head to head still puts 2 first.
    const r = scored(g, by({ '2>1': [11, 9], '1>3': [11, 0], '1>4': [11, 0], '4>2': [11, 9], '2>3': [11, 9], '3>4': [11, 9] }));
    const rows = standings(g, r, [1, 2, 3, 4]);
    expect(rows.map((x) => [x.seat, `${x.wins}-${x.losses}`, x.diff, x.tied])).toEqual([
      [2, '2-1', 2, false],
      [1, '2-1', 20, false],
      [3, '1-2', -11, false],
      [4, '1-2', -11, false],
    ]);
    // 3 and 4 are level on wins too: 3 beat 4, so 3 is 3rd.
    expect(rows[2].seat).toBe(3);
  });

  it('a three-way circle is settled by point difference (no wheel); the Final follows it', () => {
    const g = schedule(4, 2);
    // Seat 3 beats everyone. 1, 2 and 4 each beat one of the others (1 > 4 > 2 > 1), by different margins (the preview's zip72_circle).
    const r = scored(g, by({ '3>1': [11, 5], '3>2': [11, 9], '3>4': [11, 8], '1>4': [11, 3], '4>2': [11, 9], '2>1': [11, 9] }));
    const rows = standings(g, r, [1, 2, 3, 4]);
    expect(order(rows)).toEqual([3, 1, 2, 4]);
    expect(rows.map((x) => x.diff)).toEqual([11, 0, -2, -9]);
    expect(rows.some((x) => x.tied)).toBe(false);
    expect(tieBlocks(4, g, r, new Set(), [])).toEqual([]);
    // The Final is 1st against 2nd, 3rd place 3rd against 4th: filled at once.
    const res = resolveGames(4, g, r);
    const fin = g.find((x) => x.stage === 'final')!;
    const third = g.find((x) => x.stage === 'third')!;
    expect(res.find((x) => x.num === fin.num)).toMatchObject({ a: 3, b: 1, tied: false });
    expect(res.find((x) => x.num === third.num)).toMatchObject({ a: 2, b: 4, tied: false });
  });

  it('equal point difference: points scored decides', () => {
    const g = schedule(4, 2);
    // 1 > 4 > 2 > 1 below seat 3. Every circle game is won by 2; seat 3's wins are 11-9 over each. Diffs: all three -2 + 2 - 2 = -2.
    // Points scored: 1 scored 9 + 11 + 9 = 29 (scores 13-11 over 4), so we change one margin pair to keep the diffs equal but the points not.
    const r = scored(g, by({ '3>1': [11, 9], '3>2': [11, 9], '3>4': [11, 9], '1>4': [13, 11], '4>2': [11, 9], '2>1': [11, 9] }));
    const rows = standings(g, r, [1, 2, 3, 4]);
    expect(rows.slice(1).map((x) => x.diff)).toEqual([-2, -2, -2]);
    // Points scored: 1: 9 + 13 + 9 = 31; 2: 9 + 9 + 11 = 29; 4: 9 + 11 + 11 = 31. 1 and 4 are level on points too, then they are exactly 2:
    // head to head again (1 beat 4).
    expect(order(rows)).toEqual([3, 1, 4, 2]);
    expect(rows.map((x) => x.pointsFor)).toEqual([33, 31, 31, 29]);
    expect(rows.some((x) => x.tied)).toBe(false);
  });

  it('after point difference splits three, the two still level are settled by the game they played', () => {
    const g = schedule(4, 2);
    // Circle 1 > 2 > 4 > 1 below seat 3. Seat 2 loses big to seat 3 (11-0): 2 is last on difference; 1 and 4 have the same difference, and 4 beat 1.
    const r = scored(g, by({ '3>1': [11, 9], '3>2': [11, 0], '3>4': [11, 9], '1>2': [11, 9], '2>4': [11, 9], '4>1': [11, 9] }));
    const rows = standings(g, r, [1, 2, 3, 4]);
    expect(rows.slice(1).map((x) => [x.seat, x.diff])).toEqual([
      [4, -2],
      [1, -2],
      [2, -11],
    ]);
  });

  it('fully level on every rule: Tied, and the wheel is the last resort', () => {
    const g = schedule(4, 2);
    // Every game 11 to 7: the circle below seat 3 is level on wins, difference and points (the preview's tie3).
    const r = scored(g, by({ '3>1': [11, 7], '3>2': [11, 7], '3>4': [11, 7], '1>4': [11, 7], '4>2': [11, 7], '2>1': [11, 7] }));
    const rows = standings(g, r, [1, 2, 3, 4]);
    expect(rows[0].seat).toBe(3);
    expect(rows.slice(1).every((x) => x.tied)).toBe(true);
    const [b] = tieBlocks(4, g, r, new Set(), []);
    expect(b).toMatchObject({ mode: 'wheel', seats: [1, 2, 4], spinner: 3, order: null });
    // Nothing is tied before every game of the group is in.
    const part = new Map([...r].slice(0, 4));
    expect(standings(g, part, [1, 2, 3, 4]).some((x) => x.tied)).toBe(false);
  });

  it('results from before Zip 72 (who won only, no score): the old way, head to head for two, the wheel for a circle', () => {
    const g = schedule(4, 2);
    const plain = new Map<number, GameResult>();
    const circle = (a: number, b: number) => (a === 3 || b === 3 ? 3 : [a, b].sort().join() === '1,4' ? 1 : [a, b].sort().join() === '2,4' ? 4 : 2);
    for (const x of g.filter((y) => y.stage === 'pool')) {
      const a = Number(x.a.slice(1));
      const b = Number(x.b.slice(1));
      plain.set(x.num, { num: x.num, winner: circle(a, b) === a ? 'a' : 'b' });
    }
    const rows = standings(g, plain, [1, 2, 3, 4]);
    expect(rows.map((x) => x.diff)).toEqual([0, 0, 0, 0]);
    expect(rows.slice(1).every((x) => x.tied)).toBe(true);
  });

  it('pools: the same rule inside each pool; the semifinals take 1st and 2nd of each pool as settled', () => {
    // 6 teams: Pool A seats 1 to 3, Pool B seats 4 to 6, on 2 courts. In Pool A a circle settled by difference; in Pool B two level on
    // wins never happen in a pool of 3 without a circle, so Pool B is a circle level on everything except points scored.
    const g = schedule(6, 2);
    const r = scored(g, by({ '1>2': [11, 3], '2>3': [11, 9], '3>1': [11, 9], '4>5': [11, 9], '5>6': [11, 9], '6>4': [12, 10] }));
    const a = standings(g, r, [1, 2, 3]);
    const b = standings(g, r, [4, 5, 6]);
    // Pool A: 1 is +6, 3 is 0, 2 is -6.
    expect(order(a)).toEqual([1, 3, 2]);
    // Pool B: every team +0 difference... 4: +2 -2 = 0; 5: -2 + 2 = 0; 6: -2 + 2 = 0. Points: 4 scored 21, 5 scored 20, 6 scored 21. 4 and 6 are
    // then exactly 2 level: 6 beat 4.
    expect(b.map((x) => [x.seat, x.diff, x.pointsFor])).toEqual([
      [6, 0, 21],
      [4, 0, 21],
      [5, 0, 20],
    ]);
    const res = resolveGames(6, g, r);
    const semis = g.filter((x) => x.stage === 'semi');
    // A1 vs B2, B1 vs A2.
    expect(res.find((x) => x.num === semis[0].num)).toMatchObject({ a: 1, b: 4 });
    expect(res.find((x) => x.num === semis[1].num)).toMatchObject({ a: 6, b: 3 });
    // groupTable gives the same order (it is what the playoffs and End tournament read).
    expect(order(groupTable(6, g, r, new Set(), [], 'A').rows)).toEqual([1, 3, 2]);
    expect(order(groupTable(6, g, r, new Set(), [], 'B').rows)).toEqual([6, 4, 5]);
  });

  it('a team that left during the pools stays below every team still playing, whatever its points', () => {
    const g = schedule(4, 2);
    const r = scored(g, by({}));
    const rows = standings(g, r, [1, 2, 3, 4], new Set([1]));
    expect(rows[rows.length - 1].seat).toBe(1);
  });
});

describe('zip 72: the score words', () => {
  it('the score, the result tag and the point difference chip', () => {
    expect(scorePair(11, 7)).toBe('11–7');
    expect(resultTag(true, { mine: 11, theirs: 7 })).toBe('Won 11–7');
    expect(resultTag(false, { mine: 7, theirs: 11 })).toBe('Lost 7–11');
    expect(resultTag(true, null)).toBe('Won');
    expect(diffLabel(4)).toBe('+4 pts');
    expect(diffLabel(0)).toBe('0 pts');
    expect(diffLabel(-4)).toBe('−4 pts');
  });
  it('the gentle score check never says anything about a normal finish, and says one plain line about an odd one', () => {
    for (const [a, b, to] of [
      [11, 7, 11],
      [7, 11, 11],
      [12, 10, 11],
      [15, 13, 11],
      [9, 4, 9],
      [5, 3, 5],
      [11, 0, 11],
    ])
      expect(scoreHint(a, b, to), `${a}-${b} to ${to}`).toBeNull();
    expect(scoreHint(9, 7, 11)).toBe('Games are to 11. Fine if it ended early.');
    expect(scoreHint(11, 10, 11)).toBe('A game is won by 2. Check the score.');
    expect(scoreHint(15, 9, 11)).toBe('Past 11, a game ends 2 ahead. Check the score.');
    expect(scoreHint(7, 7, 11)).toBe('A game has a winner. Fix the score.');
  });
});
