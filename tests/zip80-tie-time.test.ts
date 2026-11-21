import { describe, expect, it } from 'vitest';
import { TIE_MINUTES } from '../shared/tournamentPlan';
import { type RoundState, tieGamesAhead, timeCheck } from '../shared/tournamentSchedule';
import { adminTour, card, draftAndPublish, games, playerOfSeat, START_MS, world } from './zip58-world';

// Zip 80 (🎾80.leftovers): a tie's Game A and Game B (to 5, the wheel's games) count in the night's time: the playoff round they come before
// starts only once they end, so the Time check and the night's times stay true. Before, they were stored in the playoff round and added nothing.

const S = 19 * 60 + 30;
const E = 22 * 60;
/** 12 players on 2 courts: 3 pool rounds to 11, the semis (round 4), the Final and 3rd place (round 5). */
const rounds = (done: number, doneAt: number[], extra: Partial<Record<number, Partial<RoundState>>> = {}): RoundState[] =>
  [1, 2, 3, 4, 5].map((r) => ({ round: r, pool: r <= 3, playTo: 11, done: r <= done, doneAt: doneAt[r - 1], ...extra[r] }));

describe('zip 80: tie games in the Time check', () => {
  it('a tie game is 13 minutes; Game A and Game B on one court are one after another, two ties on two courts side by side', () => {
    expect(TIE_MINUTES).toBe(13);
    expect(tieGamesAhead([{ stage: 'tie', court: 1 }, { stage: 'tie', court: 1 }, { stage: 'semi', court: 1 }])).toBe(2);
    expect(tieGamesAhead([{ stage: 'tie', court: 1 }, { stage: 'tie', court: 2 }])).toBe(1);
    expect(tieGamesAhead([{ stage: 'final', court: 1 }])).toBe(0);
  });

  it('no tie: exactly as before (pools on time, nothing behind)', () => {
    const tc = timeCheck(rounds(3, [S + 23, S + 46, S + 69]), S, E, S + 70);
    expect(tc).toMatchObject({ current: 4, behind: 0, finish: S + 115, suggest: null });
  });

  it('the wheel spins as the pools end: the semis wait for Game A and Game B (26 minutes), and that shows as time behind', () => {
    // Spun at 8:40 PM (S + 70): Game A and Game B still to play on one court: they end about 9:06 PM; semis 9:06 to 9:29, Final to 9:52.
    const tc = timeCheck(rounds(3, [S + 23, S + 46, S + 69], { 4: { tiesEnd: S + 70 + 2 * TIE_MINUTES } }), S, E, S + 70);
    expect(tc.finish).toBe(S + 70 + 26 + 46);
    expect(tc.behind).toBe(27);
    // Nothing left to shorten (pool games are in, playoffs never change): no suggestion.
    expect(tc.suggest).toBeNull();
  });

  it('the tie games are in: the semis start when the last one ended', () => {
    const tc = timeCheck(rounds(3, [S + 23, S + 46, S + 69], { 4: { tiesEnd: S + 92 } }), S, E, S + 93);
    expect(tc).toMatchObject({ current: 4, finish: S + 92 + 46, behind: 23 });
  });

  it('a tie played beside a pool game still going (a free court) only counts where it runs past that game', () => {
    // Round 3 is still being played (planned to end S + 69); the tie games end S + 76: the semis start at S + 76, 7 minutes late.
    const tc = timeCheck(rounds(2, [S + 23, S + 46], { 4: { tiesEnd: S + 76 } }), S, E, S + 50);
    expect(tc).toMatchObject({ current: 3, finish: S + 76 + 46, behind: 7, suggest: null });
    // Ending before round 3 does: nothing changes.
    expect(timeCheck(rounds(2, [S + 23, S + 46], { 4: { tiesEnd: S + 60 } }), S, E, S + 50)).toMatchObject({ behind: 0, finish: S + 115 });
  });

  it('a late night that still fits, then a tie that ends after the pools: the end moves, and shorter pool games are not suggested (they would not help)', () => {
    // Round 1 done 8:15 PM (22 late): the night ends 9:47 PM, inside the 9:50 limit.
    const late = timeCheck(rounds(1, [S + 45]), S, E, S + 46);
    expect(late).toMatchObject({ behind: 22, finish: S + 137, suggest: null });
    // A tie whose games end at 9:11 PM (after round 3's 9:01): the semis wait for it; the end is 9:57 PM, 32 minutes behind the plan.
    const withTie = timeCheck(rounds(1, [S + 45], { 4: { tiesEnd: S + 101 } }), S, E, S + 46);
    expect(withTie).toMatchObject({ behind: 32, finish: S + 147, suggest: null });
  });

  it('no tie: an overdue round still gets its "play to 7" advice exactly as before (the review\'s probe)', () => {
    const r: RoundState[] = [
      { round: 1, pool: true, playTo: 11, done: true, doneAt: 1163 },
      { round: 2, pool: true, playTo: 11, done: false },
      { round: 3, pool: false, playTo: 11, done: false },
      { round: 4, pool: false, playTo: 11, done: false },
    ];
    expect(timeCheck(r, 1140, 1240, 1200).suggest).toEqual({ fromRound: 2, to: 7, stillOver: 16 });
  });
});

describe('zip 80: a 12 player night on the real server: a three-way tie in a group moves the semifinal time', () => {
  it('Game A and Game B: the players\' night times say the semis begin after them', async () => {
    const ctx = await world(12);
    await draftAndPublish(ctx);
    ctx.app.now = START_MS + 75 * 60_000; // 8:45 PM, the pools are in (3 rounds of 23 minutes end 8:39 PM)
    const d = (await adminTour(ctx)).day;
    // Dink group (seats 1 to 3): a circle (1 beats 2, 2 beats 3, 3 beats 1, all 11 to 7); Drive group: the lower seat wins.
    for (const g of d.games.filter((x: any) => x.stage === 'pool')) {
      const [a, b] = [g.a.seat, g.b.seat];
      const circle = (x: number, y: number) => (x === 1 && y === 2) || (x === 2 && y === 3) || (x === 3 && y === 1);
      const aWins = a <= 3 ? circle(a, b) || !circle(b, a) : a < b;
      expect((await games(ctx, { action: 'result', num: g.num, winner: aWins ? 'a' : 'b' })).status).toBe(200);
    }
    const name = await playerOfSeat(ctx, 4);
    const before = (await card(ctx, name)).day.night as { label: string; time: string }[];
    expect(before.map((x) => x.label)).toEqual(['Group play · 3 rounds', 'Semifinals', 'Final and 3rd place']);
    expect(before[1].time).toBe('8:40 PM');
    const tie = (await adminTour(ctx)).day.ties[0];
    expect(tie).toMatchObject({ mode: 'wheel' });
    expect((await games(ctx, { action: 'spin', key: tie.key })).status).toBe(200);
    const tieGames = (await adminTour(ctx)).day.games.filter((g: any) => g.stage === 'tie');
    const after = (await card(ctx, name)).day.night as { label: string; time: string }[];
    // Spun at 8:45 PM: the tie games end 8:45 + 13 x (games on one court); the semis wait for them.
    const end = 20 * 60 + 45 + tieGames.length * TIE_MINUTES;
    const label = (m: number) => `${Math.floor(Math.round(m / 5) * 5 / 60) - 12}:${String(Math.round(m / 5) * 5 % 60).padStart(2, '0')} PM`;
    expect(after[1].time).toBe(label(end));
    expect(after[2].time).toBe(label(end + 23));
  });
});
