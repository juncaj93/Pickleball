import { describe, expect, it } from 'vitest';
import { type GameResult, groupTable, type PlannedGame, schedule, standings, tieBlocks, tieGames } from '../shared/tournamentSchedule';
import { adminTour, card, draftAndPublish, games, playerOfSeat, playPools, setWinner, spin, START_MS, world } from './zip58-world';

// Zip 58 (🎾58.tourney4): ties for a playoff place. Two teams level: head to head. Three teams that each beat one of the others: the wheel picks a
// bye, Game A and (when needed) Game B to 5. Four or more: the organizer picks. A tie that does not change any game is no tie.

/** Results for a schedule from a rule: the winner of seats a and b. */
function resultsOf(games: PlannedGame[], win: (a: number, b: number) => number): Map<number, GameResult> {
  const m = new Map<number, GameResult>();
  for (const g of games) {
    if (g.stage !== 'pool') continue;
    const a = Number(g.a.slice(1));
    const b = Number(g.b.slice(1));
    m.set(g.num, { num: g.num, winner: win(a, b) === a ? 'a' : 'b' });
  }
  return m;
}
/** Seat 1 beats everyone; 2, 3 and 4 each beat one of the others (2 > 3 > 4 > 2). */
const circleBelowOne = (a: number, b: number) => (a === 1 || b === 1 ? 1 : (a === 2 && b === 3) || (a === 3 && b === 2) ? 2 : (a === 3 && b === 4) || (a === 4 && b === 3) ? 3 : 4);
/** 1, 2 and 3 each beat one of the others (1 > 2 > 3 > 1); everyone beats seat 4. */
const circleAtTop = (a: number, b: number) => (a === 4 ? b : b === 4 ? a : (a === 1 && b === 2) || (a === 2 && b === 1) ? 1 : (a === 2 && b === 3) || (a === 3 && b === 2) ? 2 : 3);

describe('zip 58: the tie rules (pure)', () => {
  it('two teams level on wins are split by the game they played each other (head to head, again inside a level block)', () => {
    const g = schedule(4, 2);
    // 1 beats 2, 2 beats 3, 3 beats 1, 4 loses all but beats... 4 beats nobody: 1, 2 and 3 are 2-1 (a circle). Then 2 beats 4 etc. Use a rule where
    // 1 and 2 are 2-1, 3 and 4 are 1-2: 1 beats 2, 1 beats 3, 4 beats 1; 2 beats 3, 2 beats 4; 3 beats 4.
    const win = (a: number, b: number) => {
      const key = [a, b].sort().join('');
      return ({ '12': 1, '13': 1, '14': 4, '23': 2, '24': 2, '34': 3 } as Record<string, number>)[key];
    };
    const rows = standings(g, resultsOf(g, win), [1, 2, 3, 4]);
    expect(rows.map((r) => [r.seat, `${r.wins}-${r.losses}`, r.tied])).toEqual([
      [1, '2-1', false],
      [2, '2-1', false],
      [3, '1-2', false],
      [4, '1-2', false],
    ]);
  });
  it('round robin of 4, a circle for 2nd: the wheel, Game A and Game B; the spinner is the 3-0 team', () => {
    const g = schedule(4, 2);
    const r = resultsOf(g, circleBelowOne);
    const [b] = tieBlocks(4, g, r, new Set(), []);
    expect(b).toMatchObject({ key: 'P:2,3,4:ab', mode: 'wheel', shape: 'ab', from: 2, target: 'final', spinner: 1, order: null });
    // Without an answer the Final and the 3rd place game wait.
    const made = tieGames(b, 3, 9, 4, 1);
    expect(made.map((x) => [x.num, x.stage, x.a, x.b])).toEqual([
      [9, 'tie', 'T2', 'T4'],
      [10, 'tie', 'W9', 'T3'],
    ]);
    // Game A: 4 beats 2. Game B: 3 beats 4. Order: 3 (2nd, the Final), 4 (3rd), 2 (4th).
    const all = [...g, ...made];
    const res = new Map(r);
    res.set(9, { num: 9, winner: 'b' });
    res.set(10, { num: 10, winner: 'b' });
    const rec = { key: b.key, kind: 'wheel' as const, bye: 3, picks: [], gameA: 9, gameB: 10 };
    const t = groupTable(4, all, res, new Set(), [rec], 'P');
    expect(t.blocks[0].order).toEqual([3, 4, 2]);
    expect(t.rows.map((x) => x.seat)).toEqual([1, 3, 4, 2]);
  });
  it('a circle at the top (2 of 3 to the Final): Game A only; the bye team and the winner of A play the Final', () => {
    const g = schedule(4, 2);
    const r = resultsOf(g, circleAtTop);
    const [b] = tieBlocks(4, g, r, new Set(), []);
    expect(b).toMatchObject({ key: 'P:1,2,3:a', mode: 'wheel', shape: 'a', from: 1, spinner: 4 });
    expect(tieGames(b, 2, 9, 4, 1)).toHaveLength(1);
  });
  it('1st and 2nd level before a Final between 1st and 2nd: no tie (both are in either way)', () => {
    // 6 players (3 teams), each 1-1: all three tied for 2 places: a wheel (shape a, no spinner: the organizer spins).
    const g3 = schedule(3, 1);
    const circle = (a: number, b: number) => ((a === 1 && b === 2) || (a === 2 && b === 1) ? 1 : (a === 2 && b === 3) || (a === 3 && b === 2) ? 2 : 3);
    const [b3] = tieBlocks(3, g3, resultsOf(g3, circle), new Set(), []);
    expect(b3).toMatchObject({ mode: 'wheel', shape: 'a', spinner: null });
    // Round robin of 5 (one sits each round): 3, 4 and 5 in a circle below two clear leaders: 3rd place game (P3 vs P4), 2 of 3 go on.
    const g5 = schedule(5, 2);
    const order5 = (a: number, b: number) => {
      if (a <= 2 || b <= 2) return Math.min(a, b) === 1 || (a !== 1 && b !== 1 && Math.min(a, b) === 2) ? Math.min(a, b) : Math.min(a, b);
      return (a === 3 && b === 4) || (a === 4 && b === 3) ? 3 : (a === 4 && b === 5) || (a === 5 && b === 4) ? 4 : 5;
    };
    const [b5] = tieBlocks(5, g5, resultsOf(g5, order5), new Set(), []);
    expect(b5).toMatchObject({ key: 'P:3,4,5:a', shape: 'a', target: 'third', spinner: 1 });
  });
  it('four or more level: the organizer picks, one place at a time, until the places left lead to the same game', () => {
    // 16 players: pools of 4. Pool A all 1.5... Use a round robin of 4 where everyone is 1-2 but seat 1 (3-0): 2, 3, 4 a circle is a wheel. For 4
    // level: pools of 4 where every team is 1-1 after... not possible in 3 games each. Use a pool of 5 (10 players, round robin) with every team 2-2.
    const g = schedule(5, 2);
    const win = (a: number, b: number) => ((b - a + 5) % 5 <= 2 ? a : b); // each team beats the next two: everyone 2-2
    const [b] = tieBlocks(5, g, resultsOf(g, win), new Set(), []);
    // Places 1 and 2 meet in the Final, 3 and 4 in the 3rd place game, 5 is out: picked down to the last two (4th and 5th differ).
    expect(b).toMatchObject({ mode: 'pick', from: 1, needPicks: 4, order: null });
    const rec = (picks: number[]) => ({ key: b.key, kind: 'pick' as const, bye: null, picks, gameA: null, gameB: null });
    expect(tieBlocks(5, g, resultsOf(g, win), new Set(), [rec([3])])[0].needPicks).toBe(3);
    const done = groupTable(5, g, resultsOf(g, win), new Set(), [rec([3, 1, 5, 2])], 'P');
    expect(done.blocks[0].order).toEqual([3, 1, 5, 2, 4]);
    expect(done.rows.map((r) => r.seat)).toEqual([3, 1, 5, 2, 4]);
  });
});

describe('zip 58: the wheel on the real server (8 players, round robin, a circle for 2nd)', () => {
  async function tied() {
    const ctx = await world(8);
    await draftAndPublish(ctx);
    ctx.app.now = START_MS + 60 * 60_000;
    await playPools(ctx, circleBelowOne);
    return ctx;
  }
  it('Tied for the final: the standings say In the final and Tied; only the 3-0 team can spin; the server picks once', async () => {
    const ctx = await tied();
    const d = (await adminTour(ctx)).day;
    expect(d.ties).toHaveLength(1);
    const tie = d.ties[0];
    expect(tie).toMatchObject({ key: 'P:2,3,4:ab', mode: 'wheel', target: 'final' });
    expect(tie.spinner.name).toBe(d.teams.find((x: any) => x.seat === 1).name);
    // The Final and the 3rd place game wait.
    const fin = d.games.find((g: any) => g.stage === 'final');
    expect([fin.waitB, d.games.find((g: any) => g.stage === 'third').waitA]).toEqual(['Tied', 'Tied']);
    // A player in the tie: "Tied for the final", the wheel, no button that works.
    const tiedName = await playerOfSeat(ctx, 2);
    const v = (await card(ctx, tiedName)).day;
    expect(v.progress.label).toBe('Tied for the final');
    expect(v.tie).toMatchObject({ state: 'spin', target: 'final' });
    expect(v.tie.canSpin).toBeUndefined();
    expect(v.tie.teams).toHaveLength(3);
    const rows = v.standings[0].rows;
    expect(rows[0]).toMatchObject({ rank: 1, record: '3-0', through: 'final' });
    expect(rows.slice(1).every((r: any) => r.tied && r.record === '1-2')).toBe(true);
    // Not the spinner: refused. The spinner's phone has the button.
    expect((await spin(ctx, tiedName, tie.key)).status).toBe(409);
    const spinner = await playerOfSeat(ctx, 1, 1);
    expect((await card(ctx, spinner)).day.tie.canSpin).toBe(true);
    const r1 = await spin(ctx, spinner, tie.key);
    expect(r1.status, r1.text).toBe(200);
    expect(r1.data.already).toBe(false);
    expect([2, 3, 4]).toContain(r1.data.bye);
    // A second tap (or the organizer at the same time) gets the stored answer; nothing new is made.
    const r2 = await spin(ctx, spinner, tie.key);
    expect(r2.data).toMatchObject({ bye: r1.data.bye, already: true });
    const r3 = await games(ctx, { action: 'spin', key: tie.key });
    expect(r3.data).toMatchObject({ bye: r1.data.bye, already: true });
    expect(ctx.app.db.raw.prepare("SELECT COUNT(*) AS n FROM tournament_games WHERE tournament_id = ? AND stage = 'tie'").get(ctx.tid)).toEqual({ n: 2 });
    // Everyone sees the same answer after a refresh.
    const after = (await card(ctx, tiedName)).day;
    expect(after.tie).toMatchObject({ state: 'playoff', bye: { name: d.teams.find((x: any) => x.seat === r1.data.bye).name } });
    expect(after.progress.label).toBe('Playoff');
    expect(after.playoff.map((x: any) => x.label)).toEqual(['Game A', 'Game B', 'Final', '3rd place']);
    expect(after.playoff[0].sub).toBe('To 5. Loser is out.');
    expect(after.playoff[2].title).toMatch(/^Winner of B vs /);
    expect(after.playoff[3]).toMatchObject({ title: 'Losers of A and B', sub: 'Same time as the final' });
  });
  it('Game A and Game B to 5 decide 2nd; the Final is Winner of B vs the 3-0 team; 3rd place is the losers of A and B', async () => {
    const ctx = await tied();
    const tie = (await adminTour(ctx)).day.ties[0];
    const bye = (await games(ctx, { action: 'spin', key: tie.key })).data.bye as number;
    const d = (await adminTour(ctx)).day;
    const [ga, gb] = d.games.filter((g: any) => g.stage === 'tie');
    expect([ga.tieLabel, gb.tieLabel, ga.playTo, gb.playTo]).toEqual(['Game A', 'Game B', 5, 5]);
    const others = [2, 3, 4].filter((s) => s !== bye);
    expect([ga.a.seat, ga.b.seat]).toEqual(others);
    expect(gb.a).toBeNull();
    // A player in Game A: their big card is Game A, with We won.
    const inA = await playerOfSeat(ctx, others[0]);
    const mine = (await card(ctx, inA)).day.games.find((g: any) => g.label === 'Game A');
    expect(mine).toMatchObject({ stage: 'tie', state: 'next', onNow: true, playTo: 5 });
    expect((await play(ctx, inA, ga.num, 'won')).status).toBe(200);
    // Game B: the winner of A against the bye team.
    const d2 = (await adminTour(ctx)).day;
    const gb2 = d2.games.find((g: any) => g.num === gb.num);
    expect([gb2.a.seat, gb2.b.seat]).toEqual([others[0], bye]);
    await setWinner(ctx, gb.num, bye);
    const d3 = (await adminTour(ctx)).day;
    expect(d3.ties).toBeUndefined();
    const fin = d3.games.find((g: any) => g.stage === 'final');
    const third = d3.games.find((g: any) => g.stage === 'third');
    expect([fin.a.seat, fin.b.seat]).toEqual([1, bye]);
    expect([third.a.seat, third.b.seat].sort()).toEqual([others[0], others[1]].sort());
    // The finalist sees the 3rd place game beside the Final (picture 22).
    const finalist = await playerOfSeat(ctx, 1);
    const v = (await card(ctx, finalist)).day;
    expect(v.alsoNow).toMatchObject({ label: '3rd place' });
    expect(v.tie).toBeUndefined();
  });
  it('a pool result fixed after the spin that ends the tie sets its games aside (they come back if the tie does)', async () => {
    const ctx = await tied();
    const tie = (await adminTour(ctx)).day.ties[0];
    await games(ctx, { action: 'spin', key: tie.key });
    const d = (await adminTour(ctx)).day;
    expect(d.games.filter((g: any) => g.stage === 'tie')).toHaveLength(2);
    // Fix a pool game so seat 2 beats seat 4 too: 2 is 2-1, no tie.
    const g24 = d.games.find((g: any) => g.stage === 'pool' && [g.a.seat, g.b.seat].sort().join() === '2,4');
    await setWinner(ctx, g24.num, 2);
    const d2 = (await adminTour(ctx)).day;
    expect(d2.ties).toBeUndefined();
    expect(d2.games.filter((g: any) => g.stage === 'tie')).toHaveLength(0);
    expect(d2.games.find((g: any) => g.stage === 'final').b.seat).toBe(2);
    // Back as it was: the same tie, the same answer, its games again.
    await setWinner(ctx, g24.num, 4);
    const d3 = (await adminTour(ctx)).day;
    expect(d3.ties[0].bye).toBeTruthy();
    expect(d3.games.filter((g: any) => g.stage === 'tie')).toHaveLength(2);
  });
});

describe('zip 58: a tied team leaves (review)', () => {
  it('after the spin: its tie game is not played, the team still there goes on, and the tie settles', async () => {
    const ctx = await world(8);
    await draftAndPublish(ctx);
    ctx.app.now = START_MS + 60 * 60_000;
    await playPools(ctx, circleBelowOne);
    const tie = (await adminTour(ctx)).day.ties[0];
    const bye = (await games(ctx, { action: 'spin', key: tie.key })).data.bye as number;
    const [ga] = (await adminTour(ctx)).day.games.filter((g: any) => g.stage === 'tie');
    // One team of Game A leaves (Player left, Remove): Game A is skipped and the other team goes on to Game B.
    const leaving = ga.a.seat;
    const who = await playerOfSeat(ctx, leaving);
    const left = await games(ctx, { action: 'left', playerId: ctx.byName[who] });
    expect(left.status, left.text).toBe(200);
    const d = (await adminTour(ctx)).day;
    const gb = d.games.find((g: any) => g.tieLabel === 'Game B');
    expect([gb.a?.seat, gb.b?.seat]).toEqual([ga.b.seat, bye]);
    await setWinner(ctx, gb.num, bye);
    const d2 = (await adminTour(ctx)).day;
    expect(d2.ties).toBeUndefined();
    expect(d2.games.find((g: any) => g.stage === 'final').b.seat).toBe(bye);
  });
  it('before the spin: a team that left is not in the tie (two left: head to head settles it)', async () => {
    const ctx = await world(8);
    await draftAndPublish(ctx);
    ctx.app.now = START_MS + 60 * 60_000;
    await playPools(ctx, circleBelowOne);
    const who = await playerOfSeat(ctx, 4);
    expect((await games(ctx, { action: 'left', playerId: ctx.byName[who] })).status).toBe(200);
    const d = (await adminTour(ctx)).day;
    expect(d.ties).toBeUndefined();
    // 2 beat 3 (head to head): 2 is in the Final.
    expect(d.games.find((g: any) => g.stage === 'final').b.seat).toBe(2);
  });
});

async function play(ctx: Awaited<ReturnType<typeof world>>, name: string, num: number, action: string) {
  const { playerPhone } = await import('./harness');
  const { asScore } = await import('./zip72-taps');
  return (await playerPhone(ctx, name)).call('POST', '/api/tournament/game', { tournamentId: ctx.tid, num, ...asScore(action) });
}
