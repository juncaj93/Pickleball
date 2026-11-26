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
  // Zip 89: 20 minutes are kept free at the end (was 10). Zip 97: a pool round is 17 minutes to 11 (was 20), a playoff round 20: the pools end
  // S + 51 (8:21 PM), the plan S + 91 (9:01 PM), the limit S + 130 (9:40 PM). A tie game to 5 is 8 minutes (Zip 97, was 10). (Zip 97: the
  // inputs below moved with it, so "on time" is still on time.)
  it('a tie game is 8 minutes (Zip 97, was 10); Game A and Game B on one court are one after another, two ties on two courts side by side', () => {
    expect(TIE_MINUTES).toBe(8);
    expect(tieGamesAhead([{ stage: 'tie', court: 1 }, { stage: 'tie', court: 1 }, { stage: 'semi', court: 1 }])).toBe(2);
    expect(tieGamesAhead([{ stage: 'tie', court: 1 }, { stage: 'tie', court: 2 }])).toBe(1);
    expect(tieGamesAhead([{ stage: 'final', court: 1 }])).toBe(0);
  });

  it('no tie: exactly as before (pools on time, nothing behind)', () => {
    // Zip 97: on time is 17 a pool round (was 20), the plan ends S + 91 (was S + 100).
    const tc = timeCheck(rounds(3, [S + 17, S + 34, S + 51]), S, E, S + 52);
    expect(tc).toMatchObject({ current: 4, behind: 0, finish: S + 91, suggest: null });
  });

  it('the wheel spins as the pools end: the semis wait for Game A and Game B (16 minutes, Zip 97: was 20), and that shows as time behind', () => {
    // Zip 97: spun at 8:22 PM (S + 52, the pools on time at 17): Game A and Game B still to play on one court: they end about 8:38 PM; semis
    // 8:38 to 8:58, Final to 9:18: 17 behind the plan's 9:01 (was 21).
    const tc = timeCheck(rounds(3, [S + 17, S + 34, S + 51], { 4: { tiesEnd: S + 52 + 2 * TIE_MINUTES } }), S, E, S + 52);
    expect(tc.finish).toBe(S + 52 + 16 + 40);
    expect(tc.behind).toBe(17);
    // Nothing left to shorten (pool games are in, playoffs never change): no suggestion.
    expect(tc.suggest).toBeNull();
  });

  it('the tie games are in: the semis start when the last one ended', () => {
    // Zip 97: the pools on time at 17 (end S + 51), the tie games 16 minutes after them: 16 behind (was 20 after pools ending S + 60).
    const tc = timeCheck(rounds(3, [S + 17, S + 34, S + 51], { 4: { tiesEnd: S + 67 } }), S, E, S + 68);
    expect(tc).toMatchObject({ current: 4, finish: S + 67 + 40, behind: 16 });
  });

  it('a tie played beside a pool game still going (a free court) only counts where it runs past that game', () => {
    // Zip 97 (17 a pool round): Round 3 is still being played (planned to end S + 51, was S + 60); the tie games end S + 58: the semis start at
    // S + 58, 7 minutes late.
    const tc = timeCheck(rounds(2, [S + 17, S + 34], { 4: { tiesEnd: S + 58 } }), S, E, S + 43);
    expect(tc).toMatchObject({ current: 3, finish: S + 58 + 40, behind: 7, suggest: null });
    // Ending before round 3 does: nothing changes (Zip 97: the plan ends S + 91, was S + 100).
    expect(timeCheck(rounds(2, [S + 17, S + 34], { 4: { tiesEnd: S + 46 } }), S, E, S + 43)).toMatchObject({ behind: 0, finish: S + 91 });
  });

  it('a late night that still fits, then a tie that ends after the pools: the end moves, and shorter pool games are not suggested (they would not help)', () => {
    // Round 1 done 8:15 PM (Zip 97: 28 late, its table time is 17): the night ends 9:29 PM (S + 45 + 2 x 17 + 2 x 20), inside the 9:40 limit.
    const late = timeCheck(rounds(1, [S + 45]), S, E, S + 46);
    expect(late).toMatchObject({ behind: 28, finish: S + 119, suggest: null });
    // A tie whose games end at 9:05 PM (after round 3's 8:49): the semis wait for it; the end is 9:45 PM (past the limit), 44 minutes behind
    // the plan's 9:01 (Zip 97, was 35 behind 9:10).
    const withTie = timeCheck(rounds(1, [S + 45], { 4: { tiesEnd: S + 95 } }), S, E, S + 46);
    expect(withTie).toMatchObject({ behind: 44, finish: S + 135, suggest: null });
  });

  it('no tie: an overdue round still gets its "play to 7" advice exactly as before (the review\'s probe)', () => {
    // Round 2 was planned to end 1180 and is still going at 1200: it ends now, then two playoff rounds of 20: 1240, 20 past the 1220 limit
    // (shorter games in round 2 cannot save anything once it runs past its time).
    const r: RoundState[] = [
      { round: 1, pool: true, playTo: 11, done: true, doneAt: 1163 },
      { round: 2, pool: true, playTo: 11, done: false },
      { round: 3, pool: false, playTo: 11, done: false },
      { round: 4, pool: false, playTo: 11, done: false },
    ];
    // Zip 92: it ends at 1240, the booked end itself: 20 past the aim but not past the end, so nothing "still runs over".
    expect(timeCheck(r, 1140, 1240, 1200).suggest).toEqual({ fromRound: 2, to: 7, stillOver: 0 });
    expect(timeCheck(r, 1140, 1230, 1200).suggest).toEqual({ fromRound: 2, to: 7, stillOver: 10 });
  });
});

// Zip 92: 12 players play Americano now (shared/tournament.ts playsAmericano, the fairness rule), so the groups night on the real server is 16
// players: two groups of 4 (Dink: seats 1 to 4, Drive: seats 5 to 8), 6 pool rounds to 7 on 2.5 hours (Zip 97: 11 minutes each, was 13).
describe('zip 80: a 16 player night on the real server: a three-way tie in a group moves the semifinal time', () => {
  it('Game A and Game B: the players\' night times say the semis begin after them', async () => {
    const ctx = await world(16);
    await draftAndPublish(ctx);
    // Zip 97: 8:46 PM, the pools are in (after the 10 minute warm-up, 6 rounds of 11 minutes end 8:46 PM; was 9:00 PM, 6 rounds of 13 to 8:58).
    ctx.app.now = START_MS + 76 * 60_000;
    const d = (await adminTour(ctx)).day;
    // Dink group (seats 1 to 4): a circle among seats 1 to 3 (1 beats 2, 2 beats 3, 3 beats 1, all 11 to 7), and all three beat seat 4; Drive
    // group: the lower seat wins.
    for (const g of d.games.filter((x: any) => x.stage === 'pool')) {
      const [a, b] = [g.a.seat, g.b.seat];
      const circle = (x: number, y: number) => (x === 1 && y === 2) || (x === 2 && y === 3) || (x === 3 && y === 1);
      const aWins = a <= 3 ? circle(a, b) || !circle(b, a) : a < b;
      expect((await games(ctx, { action: 'result', num: g.num, winner: aWins ? 'a' : 'b' })).status).toBe(200);
    }
    const name = await playerOfSeat(ctx, 4);
    const before = (await card(ctx, name)).day.night as { label: string; time: string }[];
    expect(before.map((x) => x.label)).toEqual(['Group play · 6 rounds', 'Semifinals', 'Final and 3rd place']);
    // Zip 97: 8:46 PM, shown as 8:45 PM (was 9:00 PM).
    expect(before[1].time).toBe('8:45 PM');
    const tie = (await adminTour(ctx)).day.ties[0];
    expect(tie).toMatchObject({ mode: 'wheel' });
    expect((await games(ctx, { action: 'spin', key: tie.key })).status).toBe(200);
    const tieGames = (await adminTour(ctx)).day.games.filter((g: any) => g.stage === 'tie');
    const after = (await card(ctx, name)).day.night as { label: string; time: string }[];
    // Spun at 8:46 PM (Zip 97, was 9:00 PM): the tie games end 8:46 + 8 x (games on one court); the semis wait for them, then the Final 20
    // minutes later.
    const end = 20 * 60 + 46 + tieGames.length * TIE_MINUTES;
    const label = (m: number) => `${Math.floor(Math.round(m / 5) * 5 / 60) - 12}:${String(Math.round(m / 5) * 5 % 60).padStart(2, '0')} PM`;
    expect(after[1].time).toBe(label(end));
    expect(after[2].time).toBe(label(end + 20));
  });
});
