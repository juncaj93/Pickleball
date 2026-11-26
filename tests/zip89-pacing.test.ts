import { describe, expect, it } from 'vitest';
import { bonusRound, type PlayedGame } from '../shared/americanoSchedule';
import { BONUS_SPARE, PACE_FLOOR, measuredPace, paceForCheck, pacing, type PaceInput } from '../shared/smartPacing';
import { END_BUFFER, nightPlan, ROUND_MINUTES, TIE_MINUTES } from '../shared/tournamentPlan';
import { playerPhone } from './harness';
import { adminTour, awards, card, draftAndPublish, START_MS, world } from './zip58-world';
import { allThree, call, night, playPaced, sc, score } from './zip89-world';

// Zip 89 (🎾89.smart pacing): the honest base plan, the live pace, the bonus offer and what a bonus is (both styles), on the pure rules and on the
// real server. The whole-night simulations at 12, 15, 20 and 25 minutes a game are tests/zip89-pacing-sim.test.ts.

const START = 19 * 60 + 30;
const base = (over: Partial<PaceInput> = {}): PaceInput => ({
  rounds: [1, 2, 3, 4, 5, 6].map((round) => ({ round, planned: true, done: false })),
  startMin: START,
  endMin: START + 150,
  nowMin: START,
  kind: 'round',
  started: true,
  over: false,
  paused: false,
  behind: false,
  leftOpen: false,
  ...over,
});
const doneUpTo = (k: number, each: number) => [1, 2, 3, 4, 5, 6].map((round) => ({ round, planned: true, done: round <= k, ...(round <= k ? { doneAt: START + round * each } : {}) }));

describe('zip 89: the base plan (one place for the numbers)', () => {
  it('17 / 14 / 11 minutes a round (Zip 97, were 20 / 16 / 13), 20 minutes kept free, a tie game 8 (Zip 97, was 10)', () => {
    // Zip 97: regular rounds 17 to 11, 14 to 9, 11 to 7; a tie game 8.
    expect(ROUND_MINUTES).toEqual({ 11: 17, 9: 14, 7: 11 });
    expect(END_BUFFER).toBe(20);
    expect(BONUS_SPARE).toBe(END_BUFFER);
    expect(TIE_MINUTES).toBe(8);
  });
  it('Dec 1 (10 players, 2 courts, 2.5 hours): Locked doubles 5 round robin rounds to 11 + Final and 3rd place; Americano 7 rounds to 11 (Zip 97, was 6)', () => {
    // Zip 89 (Alex): 10 minutes of warm-up, then the rounds. Someone sits every round: no breaks. Zip 97: Locked doubles 10 + 5 x 17 + 20 = 115
    // (done 9:25 PM, was 130); Americano 7 rounds, 10 + 7 x 17 = 129 (done 9:39 PM, was 6 rounds, 130).
    const ld = nightPlan(10, 2, 150, 'doubles');
    expect([ld.doubles!.poolRounds, ld.doubles!.playoffRounds, ld.doubles!.third, ld.gameTo, ld.rounds, ld.minutesUsed, ld.fits, ld.breaks]).toEqual([5, 1, true, 11, 6, 115, true, 0]);
    const am = nightPlan(10, 2, 150, 'americano');
    expect([am.rounds, am.gameTo, am.minutesUsed, am.fits, am.breaks]).toEqual([7, 11, 129, true, 0]);
  });
  it('Dec 1 for 8 to 12 locked in: every plan done at least 20 minutes before 10 PM with the warm-up; breaks only when nobody sits', () => {
    // [players, style, rounds, to, breaks, minutes from 7:30 to the planned end]. Zip 97 (17 a regular round, 20 a playoff round): 8 Locked
    // doubles 10 + 3 x 17 + 2 x 20 + 10 = 111 (was 120); Americano one round more (8: 6 rounds, 122; 9 to 12: 7 rounds, 129); 10 Locked doubles
    // 115; 12 Locked doubles 10 + 3 x 17 + 2 x 20 = 101.
    const want: [number, 'doubles' | 'americano', number, number, number, number][] = [
      [8, 'doubles', 5, 11, 2, 111],
      [8, 'americano', 6, 11, 2, 122],
      [9, 'americano', 7, 11, 0, 129],
      [10, 'doubles', 6, 11, 0, 115],
      [10, 'americano', 7, 11, 0, 129],
      [11, 'americano', 7, 11, 0, 129],
      [12, 'doubles', 5, 11, 0, 101],
      [12, 'americano', 7, 11, 0, 129],
    ];
    // Alex, "build in what fits": 8 Locked doubles gets its semifinals in the plan (3 round robin + semis + Final and 3rd place, done 9:30).
    expect(nightPlan(8, 2, 150, 'doubles').builtIn).toEqual({ semis: true, bestOf3: false });
    for (const n of [10, 12]) expect(nightPlan(n, 2, 150, 'doubles').builtIn).toEqual({ semis: false, bestOf3: false });
    for (const [n, style, rounds, to, breaks, used] of want) {
      const p = nightPlan(n, 2, 150, style);
      expect([p.rounds, p.gameTo, p.breaks, p.minutesUsed], `${n} ${style}`).toEqual([rounds, to, breaks, used]);
      expect(150 - p.minutesUsed).toBeGreaterThanOrEqual(20);
    }
    // Nobody sits: 8 Americano on 2 courts and 4 teams on 2 courts; 9 or 10 on 2 courts and 6 on 1 court sit.
    expect([8, 9, 10].map((n) => nightPlan(n, 2, 150, 'americano').noSit)).toEqual([true, false, false]);
    expect(nightPlan(8, 2, 150, 'doubles').noSit).toBe(true);
    expect(nightPlan(6, 1, 150, 'americano').noSit).toBe(false);
  });
  it('only three sizes (all Americano: 8 on 2 courts for 2.5 and 3 hours, 9 on 1 court for 3 hours) play fewer rounds or shorter games than today (the warm-up and breaks)', () => {
    const shorter: string[] = [];
    const old = { 11: 23, 9: 19, 7: 16 } as const;
    for (const style of ['doubles', 'americano'] as const)
      for (const c of [1, 2])
        for (const m of [120, 150, 180])
          for (let n = 6; n <= 16; n++) {
            const now = nightPlan(n, c, m, style);
            // The old plan, the same rules with 23 / 19 / 16 and 10 minutes kept free.
            const budget = m - 10; // the old plan: 10 minutes kept free, no warm-up
            let was: { rounds: number; gameTo: number };
            if (now.doubles) {
              const s = now.doubles;
              const len = ([11, 9, 7] as const).find((l) => s.poolRounds * old[l] + s.playoffRounds * 23 <= budget) ?? 7;
              was = { rounds: s.poolRounds + s.playoffRounds, gameTo: len };
            } else {
              const on = now.onCourt!;
              const at = (l: 11 | 9 | 7) => Math.floor(budget / old[l]);
              const len = ([11, 9, 7] as const).find((l) => (at(l) * on) / n >= 4) ?? 7;
              was = { rounds: at(len), gameTo: len };
            }
            if (now.rounds < was.rounds || now.gameTo < was.gameTo) shorter.push(`${now.style} ${n} ${c} ${m}`);
          }
    // Zip 97: with 17 / 14 / 11 no size plays fewer rounds or shorter games than the old 23 / 19 / 16 plan any more (were 3: Americano 8 on 2
    // courts for 2.5 and 3 hours, 9 on 1 court for 3 hours).
    expect([...new Set(shorter)].sort()).toEqual([]);
  });
});

describe('zip 89: the pace and the offer (pure)', () => {
  it('the pace is the average round from the real start, never under 14 minutes', () => {
    expect(measuredPace(doneUpTo(0, 15), START).pace).toBeNull();
    expect(measuredPace(doneUpTo(2, 15), START)).toMatchObject({ done: 2, pace: 15 });
    expect(measuredPace(doneUpTo(2, 10), START).pace).toBe(PACE_FLOOR);
    // A round to 9 counts against its own table time (Zip 97: 14, was 16): 14 minutes for it is a 17 minute pace for a round to 11 (Zip 97: the
    // input is now 14 minutes at the new table's 14, since 12.8 at 14 would fall under the 14 minute floor).
    expect(measuredPace([{ round: 1, planned: true, done: true, doneAt: START + 14, minutes: ROUND_MINUTES[9] }], START).pace).toBeCloseTo(17);
    // Rounds after a round still open do not count yet.
    const gap = [{ round: 1, planned: true, done: true, doneAt: START + 15 }, { round: 2, planned: true, done: false }, { round: 3, planned: true, done: true, doneAt: START + 30 }];
    expect(measuredPace(gap, START).done).toBe(1);
  });
  it('offers after a fast round when the rest + the bonus ends 20 minutes early; nothing when it would not', () => {
    // 15 a round: Round 1 done at 7:45, 5 left x 15 = 75, the bonus round at the table's 17 at least (Zip 97, was 20; it can never be shortened
    // as it is the night's new last round... and the review's rule): 9:17 PM (Zip 97, was 9:20), 43 minutes to spare.
    const fast = pacing(base({ rounds: doneUpTo(1, 15), nowMin: START + 15 }));
    expect(fast.offer).toEqual({ kind: 'round', key: 'round:1:6' });
    expect(fast.finishWithBonus).toBe(START + 107);
    // 20 a round: 20 + 5 x 20 + 17 = 137 > 130 (Zip 97: the bonus at 17): no offer.
    expect(pacing(base({ rounds: doneUpTo(1, 20), nowMin: START + 20 })).offer).toBeNull();
    // Exactly 20 to spare is enough; 19 is not.
    const edge = (each: number) => pacing(base({ rounds: doneUpTo(1, each), nowMin: START + each })).offer;
    // Zip 97: the edge is now slower than the table's 17, so the bonus counts at the pace too (never faster than the table): each + 5 x each +
    // each <= 130: each <= 18.57 (was each + 5 x each + 20 <= 130, 18.33).
    expect(edge(129.9 / 7)).not.toBeNull();
    expect(edge(130.1 / 7)).toBeNull();
  });
  it('a round in progress counts as at most half done', () => {
    const late = pacing(base({ rounds: doneUpTo(1, 15), nowMin: START + 50 }));
    // From 50 - 7.5 = 42.5 minutes in: 42.5 + 75 + 17 = 134.5 > 130 (Zip 97: the bonus at 17, was 20 and 137.5): no offer.
    expect(late.finishWithBonus).toBe(START + 134.5);
    expect(late.offer).toBeNull();
  });
  it('never inside the last 2 planned rounds (a bonus round is never counted as planned)', () => {
    expect(pacing(base({ rounds: doneUpTo(4, 14), nowMin: START + 56 })).offer).not.toBeNull();
    expect(pacing(base({ rounds: doneUpTo(5, 14), nowMin: START + 70 })).offer).toBeNull();
    const withBonus = [...doneUpTo(5, 14), { round: 7, planned: false, done: false }, { round: 8, planned: false, done: false }];
    expect(pacing(base({ rounds: withBonus, nowMin: START + 70 })).plannedLeft).toBe(1);
    expect(pacing(base({ rounds: withBonus, nowMin: START + 70 })).offer).toBeNull();
  });
  it('no offer while paused, behind, mid Player left, not started, over, with no bonus left, or before a new round is scored after the last bonus', () => {
    const r = doneUpTo(2, 14);
    const at = { rounds: r, nowMin: START + 28 };
    expect(pacing(base(at)).offer).not.toBeNull();
    for (const over of [{ paused: true }, { behind: true }, { leftOpen: true }, { started: false }, { over: true }, { kind: null }] as Partial<PaceInput>[])
      expect(pacing(base({ ...at, ...over })).offer, JSON.stringify(over)).toBeNull();
    // A bonus added after Round 2 was in: no new offer until Round 3 is in.
    expect(pacing(base({ ...at, lastBonusAt: START + 29 })).offer).toBeNull();
    expect(pacing(base({ rounds: doneUpTo(3, 14), nowMin: START + 42, lastBonusAt: START + 29 })).offer).not.toBeNull();
  });
  it('the Time check gets the pace only with a bonus in the night or when it runs slower than the table', () => {
    expect(paceForCheck(false, null)).toBeUndefined();
    expect(paceForCheck(false, 15)).toBeUndefined();
    expect(paceForCheck(true, 15)).toBe(15);
    // Zip 92: a slow night eases in (a third of the way after Round 1, two thirds after Round 2, all of it from Round 3). Zip 97: from the
    // table's 17 (was 20): 26 after Round 1 is 17 + 9 / 3 = 20 (was 22).
    expect(paceForCheck(false, 24, 3)).toBe(24);
    expect(paceForCheck(false, 26, 1)).toBeCloseTo(20, 6);
    expect(paceForCheck(false, 24, 2)).toBeCloseTo(17 + (7 * 2) / 3, 6);
    expect(paceForCheck(false, 55, 0)).toBeUndefined();
  });
});

describe('zip 89: the Americano bonus round (pure)', () => {
  it('nobody left: the saved pattern’s next round (fair sits, new partners); someone left: a fair round of the players still in', () => {
    const ids = Array.from({ length: 10 }, (_, i) => `p${i}`);
    const played: PlayedGame[] = [];
    // Build 6 rounds the same way the night does, then ask for the 7th and an 8th.
    for (let r = 0; r < 8; r++) {
      const next = bonusRound(played, ids, new Set(), 2, 'tour1');
      expect(next).toHaveLength(2);
      const on = new Set(next!.flatMap((g) => [...g.a, ...g.b]));
      expect(on.size).toBe(8);
      next!.forEach((g) => played.push({ round: r + 1, court: g.court, a: g.a, b: g.b, skipped: false }));
    }
    // 8 rounds of 10 players, 8 on court: everyone sat once or twice, nobody twice before everyone once (sits differ by at most 1).
    const sits = ids.map((id) => [1, 2, 3, 4, 5, 6, 7, 8].filter((r) => !played.some((g) => g.round === r && [...g.a, ...g.b].includes(id))).length);
    expect(Math.max(...sits) - Math.min(...sits)).toBeLessThanOrEqual(1);
    // With one player gone: only the 9 still in, 8 on court, the least-sat one sits.
    const gone = new Set(['p0']);
    const after = bonusRound(played, ids, gone, 2, 'tour1')!;
    const on = after.flatMap((g) => [...g.a, ...g.b]);
    expect(on).not.toContain('p0');
    expect(new Set(on).size).toBe(8);
    // Fewer than 4 still in: no round.
    expect(bonusRound(played, ids, new Set(ids.slice(0, 7)), 2, 'tour1')).toBeNull();
  });
});

describe('zip 89: Americano on the real server (10 players, the Dec 1 night)', () => {
  it('a fast night offers Add a round after Round 1; a stale key is refused; Yes adds Round 9 at once (Zip 97: on 3 hours); one bonus per scored round', async () => {
    // Zip 97: the 17 minute table fills 2.5 hours with 7 rounds (10 + 7 x 17 = 129), so even at the 14 minute floor no bonus fits there any more
    // (10 + 13 + 6 x 14 + 17 = 124, past 9:40). To keep this test's purpose (a fast night is offered a round), the night is 3 hours: 8 rounds
    // planned (10 + 8 x 17 = 146), the bonus is Round 9.
    const ctx = await world(10, { format: 'americano', minutes: 180 });
    // 13 minutes a game (Alex's night): stop as soon as the offer shows.
    await playPaced(ctx, 13, false, ({ v }) => !!v.bonus);
    let { v } = await night(ctx);
    expect(v.bonus).toMatchObject({ kind: 'round' });
    expect(v.plannedRounds).toBe(8);
    // Players never see an offer (it is the organizer's).
    const phone = await card(ctx, 'Blair');
    expect(JSON.stringify(phone)).not.toContain('"bonus"');
    expect((await call(ctx, { action: 'bonus', key: 'round:0:6' })).status).toBe(409);
    const ok = await call(ctx, { action: 'bonus', key: v.bonus.key });
    expect(ok.status, ok.text).toBe(200);
    // Zip 97: on 3 hours the bonus is Round 9 (8 planned).
    expect(ok.data.round).toBe(9);
    // The same tap again (a second phone) is refused; no second offer before another round is in.
    expect((await call(ctx, { action: 'bonus', key: v.bonus.key })).status).toBe(409);
    ({ v } = await night(ctx));
    expect(v.bonus).toBeUndefined();
    expect(Math.max(...v.games.map((g: any) => g.round))).toBe(9);
    // Round 9 (Zip 97, was Round 7): 8 on court, two sit; the bars and the players' phones include it.
    const r9 = v.games.filter((g: any) => g.round === 9);
    expect(r9).toHaveLength(2);
    expect(v.sits.find((s: any) => s.round === 9).names).toHaveLength(2);
    const mine = await card(ctx, r9[0].a.names[0]);
    expect(mine.day.rounds.some((r: any) => r.round === 9)).toBe(true);
    expect(mine.day.progress.total).toBe(9);
  }, 60_000);
  it('the offer goes when the window closes; paused: none; a whole night with every offer taken: books zero, the reveal credits once', async () => {
    // Zip 97: on 3 hours (8 rounds planned), as above: on 2.5 hours the 17 minute table leaves no room for a bonus at the 14 minute floor.
    const ctx = await world(10, { format: 'americano', minutes: 180 });
    await playPaced(ctx, 13, false, ({ v }) => !!v.bonus);
    expect((await call(ctx, { action: 'pause' })).status).toBe(200);
    expect((await night(ctx)).v.bonus).toBeUndefined();
    expect((await call(ctx, { action: 'resume' })).status).toBe(200);
    expect((await night(ctx)).v.bonus).toBeTruthy();
    // Ignored: Rounds 2 to 6 go by with the offer showing after each, then no offer with 2 planned rounds left... wait, 2 left still offers;
    // with 1 left (Zip 97: after Round 7 of 8, was Round 5 of 6) none.
    await playPaced(ctx, 13, false, ({ v }) => v.games.filter((g: any) => g.round <= 7).every((g: any) => g.status === 'done'), false);
    expect((await night(ctx)).v.bonus).toBeUndefined();
    const run = await playPaced(ctx, 13, true, undefined, false);
    const t = await adminTour(ctx);
    const before = ctx.app.db.raw.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(amount_cents), 0) AS c FROM credit_ledger WHERE reason LIKE 'tour:%'").get() as any;
    expect((await awards(ctx, { action: 'end', seen: t.end.seen })).status).toBe(200);
    await awards(ctx, { action: 'end', seen: t.end.seen });
    const after = ctx.app.db.raw.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(amount_cents), 0) AS c FROM credit_ledger WHERE reason LIKE 'tour:%'").get() as any;
    expect([after.n - before.n, after.c - before.c]).toEqual([2, 1400 + 700]);
    allThree(ctx);
    expect(run.offers).toHaveLength(0);
  }, 60_000);
});

describe('zip 89: Locked doubles on the real server', () => {
  it('10 players (5 teams, 2.5 hours, the semis do not fit the plan): a fast night is offered Semifinals (1 vs 4, 2 vs 3, both courts after the round robin)', async () => {
    const ctx = await world(10, { format: 'doubles', minutes: 150 });
    await draftAndPublish(ctx);
    await playPaced(ctx, 10, false, ({ v }) => !!v.bonus);
    let { v } = await night(ctx);
    expect(v.bonus.kind).toBe('semis');
    const before = v.games.map((g: any) => `${g.num}:${g.stage}:${g.round}`);
    expect(before.slice(-2)).toEqual(['11:final:6', '12:third:6']);
    expect((await call(ctx, { action: 'bonus', key: v.bonus.key })).status).toBe(200);
    ({ v } = await night(ctx));
    expect(v.games.slice(-4).map((g: any) => `${g.num}:${g.stage}:${g.round}:${g.court}:${g.waitA}-${g.waitB}`)).toEqual([
      '11:semi:6:1:1st-4th',
      '12:semi:6:2:2nd-3rd',
      '13:final:7:1:Winner of game 11-Winner of game 12',
      '14:third:7:2:Loser of game 11-Loser of game 12',
    ]);
    allThree(ctx);
  }, 120_000);
  it('10 players on 3 hours: the semifinals are built in from the start; a fast night is offered the Final best of 3, played to 1-1 and game 3', async () => {
    const ctx = await world(10, { format: 'doubles', minutes: 180 });
    await draftAndPublish(ctx);
    let { v } = await night(ctx);
    // Alex: the semifinals fit at the table's pace, so they are part of the plan (published with the teams), not an offer.
    expect(v.games.filter((g: any) => g.stage === 'semi')).toHaveLength(2);
    await playPaced(ctx, 10, false, ({ v }) => !!v.bonus);
    ({ v } = await night(ctx));
    expect(v.bonus.kind).toBe('bestOf3');
    expect((await call(ctx, { action: 'bonus', key: v.bonus.key })).status).toBe(200);
    ({ v } = await night(ctx));
    expect(v.bestOf3).toEqual({ wins: [0, 0], winner: null });
    // Game 3 is not part of the night until 1-1.
    expect(v.games.filter((g: any) => g.stage === 'final').map((g: any) => g.finalGame)).toEqual([1, 2]);
    // Play to the Final and score it 1-1, then game 3.
    await playPaced(ctx, 10, false, ({ v }) => v.games.some((g: any) => g.stage === 'final' && g.finalGame === 1 && g.started), false);
    ({ v } = await night(ctx));
    const g1 = v.games.find((g: any) => g.finalGame === 1);
    const g1Names = sc(g1);
    expect((await score(ctx, g1Names.a[0], g1.num, 11, 7)).status).toBe(200);
    ({ v } = await night(ctx));
    expect(v.bestOf3).toEqual({ wins: [1, 0], winner: null });
    expect((await adminTour(ctx)).end ?? null).toBeNull();
    const g2 = v.games.find((g: any) => g.finalGame === 2);
    expect(g2.started).toBe(true);
    expect((await score(ctx, g1Names.a[0], g2.num, 8, 11)).status).toBe(200);
    ({ v } = await night(ctx));
    expect(v.bestOf3).toEqual({ wins: [1, 1], winner: null });
    const g3 = v.games.find((g: any) => g.finalGame === 3);
    expect(g3.started).toBe(true);
    // The finalists' phones: "Final · Game 3", the one alert for the series.
    const phone = await card(ctx, g1Names.b[0]);
    expect(phone.day.games.map((g: any) => g.label)).toContain('Final · Game 3');
    expect(phone.day.finalAlert.title).toBe('You’re in the Final! Best of 3 games to 11.');
    expect((await score(ctx, g1Names.b[0], g3.num, 11, 9)).status).toBe(200);
    ({ v } = await night(ctx));
    expect(v.bestOf3).toEqual({ wins: [1, 2], winner: 'b' });
    // Finish the 3rd place game; End: the series winner is the champion, credit once, books zero; money unchanged by the bonus.
    await playPaced(ctx, 10, false, undefined, false);
    const t = await adminTour(ctx);
    expect(t.end).toBeTruthy();
    // The best of 3 winner is the Final's winner: 1st on the End card's standings (the board players get) and the pick for the medal and credit.
    expect(t.end.standings[0]).toMatchObject({ name: g2.b.name, medal: true });
    expect(JSON.stringify(t.end.first)).toContain(g2.b.name);
    expect(t.end.second ? JSON.stringify(t.end.second) : g2.a.name).toContain(g2.a.name);
    expect((await awards(ctx, { action: 'end', seen: t.end.seen })).status).toBe(200);
    allThree(ctx);
  }, 120_000);
  it('8 players (4 teams) on 2.5 hours, the Dec 1 night: semifinals built in from the start; a single Final; Zip 92: the only offer is one more round robin round', async () => {
    const ctx = await world(8, { format: 'doubles', minutes: 150 });
    await draftAndPublish(ctx);
    expect((await night(ctx)).v.games.filter((g: any) => g.stage === 'semi')).toHaveLength(2);
    const run = await playPaced(ctx, 12);
    // A best of 3 needs 3 planned rounds still to play: never on 3 round robin rounds. Zip 92: one more round robin round instead.
    expect(run.offers.map((o: any) => o.kind ?? o)).toEqual(['round']);
    const { v } = await night(ctx);
    expect(v.games.filter((g: any) => g.stage === 'semi')).toHaveLength(2);
    expect(v.bestOf3).toBeUndefined();
    allThree(ctx);
  }, 60_000);
  // Zip 92: 12 and 14 play Americano now (shared/tournament.ts playsAmericano: their pools have a group of three), so the groups nights here
  // are 16 players (two groups of 4: 6 pool rounds, then the semifinals, then the Final and 3rd place).
  it('16 players (groups of 4) on 2.5 hours: never a best of 3 (it needs 3 planned rounds still to play after a round is in); Zip 92: 12 and 14 play Americano', async () => {
    const ctx = await world(16, { format: 'doubles' });
    await draftAndPublish(ctx);
    const run = await playPaced(ctx, 10);
    expect(run.offers).toEqual([]);
  }, 60_000);
  // Zip 92: 16, not 14; at 16 the best of 3 Final fits from 4 hours (3.5 hours plays the pools to 11 with a single Final).
  it('16 players (groups) on 4 hours: the best of 3 Final fits the plan, so it is built in from the start (no offer)', async () => {
    const ctx = await world(16, { format: 'doubles', minutes: 240 });
    await draftAndPublish(ctx);
    expect(nightPlan(16, 2, 210, 'doubles').builtIn).toEqual({ semis: false, bestOf3: false });
    expect(nightPlan(16, 2, 240, 'doubles').builtIn).toEqual({ semis: false, bestOf3: true });
    const run = await playPaced(ctx, 12);
    expect(run.offers).toEqual([]);
    const { v, t } = await night(ctx);
    const fin = v.games.filter((g: any) => g.stage === 'final');
    // The simulation's scores: side a wins games whose number is not a multiple of 3.
    expect(fin.length).toBeGreaterThanOrEqual(2);
    expect(v.bestOf3.winner).not.toBeNull();
    if (v.bestOf3.wins.includes(0)) expect(fin).toHaveLength(2);
    expect(t.end).toBeTruthy();
    expect((await awards(ctx, { action: 'end', seen: t.end.seen })).status).toBe(200);
    allThree(ctx);
    // A player's phone never gets the offer.
    const phone = await playerPhone(ctx, 'Blair');
    expect(JSON.stringify((await phone.call('GET', '/api/group')).data)).not.toContain('"bonus"');
    void START_MS;
  }, 60_000);
});

describe('zip 89: the preview stages (the preview’s fixed names)', () => {
  const NAMES = ['Alex', 'Parker', 'Rowan', 'Sage', 'Christopher Vanderberg', 'Vic', 'Wren', 'Zoe', 'Quinn', 'Reese'];
  async function preview() {
    const { setupGroup } = await import('./harness');
    const ctx = await setupGroup();
    await ctx.organizer.call('PUT', '/api/admin/group', { organizerName: 'Alex' });
    ctx.app.env.PREVIEW_CALM = 'on';
    for (const n of NAMES) await ctx.organizer.call('POST', '/api/admin/players', { name: n });
    // Thursday Nov 12, 8:15 PM Eastern.
    ctx.app.now = Date.parse('2026-11-13T01:15:00.000Z');
    const stage = async (s: string) => {
      const r = await ctx.organizer.call('POST', '/api/admin/tournament-test', { stage: s });
      expect(r.status, r.text).toBe(200);
      return r.data.id as string;
    };
    const tour = async () => (await ctx.organizer.call('GET', '/api/admin/dashboard')).data.tournament;
    const games = (id: string, body: Record<string, unknown>) => ctx.organizer.call('POST', `/api/admin/tournament/${id}/games`, body);
    return { ctx, stage, tour, games };
  }
  it('Americano ahead: the offer shows; Yes adds Round 8 (Zip 97: 7 planned, was Round 7)', async () => {
    const { stage, tour, games } = await preview();
    const id = await stage('zip89_am_ahead');
    const t = await tour();
    expect(t.rounds.bonus).toMatchObject({ kind: 'round' });
    expect(t.rounds.timeCheck ?? null).toBeNull();
    expect((await games(id, { action: 'bonus', key: t.rounds.bonus.key })).status).toBe(200);
    // Zip 97: the plan is 7 rounds at 17 minutes (was 6), so the bonus is Round 8.
    expect(Math.max(...(await tour()).rounds.games.map((g: any) => g.round))).toBe(8);
  });
  it('Locked doubles ahead: the semis offer; Yes puts SEMIS before the FINAL', async () => {
    const { stage, tour, games } = await preview();
    const id = await stage('zip89_ld_semis');
    const t = await tour();
    expect(t.day.bonus).toMatchObject({ kind: 'semis' });
    expect((await games(id, { action: 'bonus', key: t.day.bonus.key })).status).toBe(200);
    expect((await tour()).day.games.map((g: any) => g.stage)).toEqual(['pool', 'pool', 'pool', 'pool', 'pool', 'pool', 'semi', 'semi', 'final', 'third']);
  });
  it('best-of-3 Final in play: Game 1 in, Game 2 and 3rd place on the courts; 1-1 brings Game 3; 2-1 ends it', async () => {
    const { stage, tour, games } = await preview();
    const id = await stage('zip89_bo3');
    let d = (await tour()).day;
    expect(d.bestOf3).toEqual({ wins: [1, 0], winner: null });
    expect(d.bonus).toBeUndefined();
    const g2 = d.games.find((g: any) => g.finalGame === 2);
    const third = d.games.find((g: any) => g.stage === 'third');
    expect(d.courtsNow.map((c: any) => c.num).sort()).toEqual([g2.num, third.num].sort());
    const fix = (g: any, a: number, b: number) => games(id, { action: 'result', num: g.num, a, b, seen: { winner: g.winner, scoreA: g.scoreA, scoreB: g.scoreB } });
    expect((await fix(g2, 9, 11)).status).toBe(200);
    d = (await tour()).day;
    expect(d.bestOf3).toEqual({ wins: [1, 1], winner: null });
    const g3 = d.games.find((g: any) => g.finalGame === 3);
    expect(g3.started).toBe(true);
    expect((await fix(g3, 11, 4)).status).toBe(200);
    expect((await tour()).day.bestOf3).toEqual({ wins: [2, 1], winner: 'a' });
  });
});

describe('zip 89 (review): a best of 3 Final stays one series between the same two teams', () => {
  async function bo3() {
    const { setupGroup } = await import('./harness');
    const ctx = await setupGroup();
    await ctx.organizer.call('PUT', '/api/admin/group', { organizerName: 'Alex' });
    ctx.app.env.PREVIEW_CALM = 'on';
    for (const n of ['Alex', 'Parker', 'Rowan', 'Sage', 'Christopher Vanderberg', 'Vic', 'Wren', 'Zoe', 'Quinn', 'Reese']) await ctx.organizer.call('POST', '/api/admin/players', { name: n });
    ctx.app.now = Date.parse('2026-11-13T01:15:00.000Z');
    const id = (await ctx.organizer.call('POST', '/api/admin/tournament-test', { stage: 'zip89_bo3' })).data.id as string;
    const tour = async () => (await ctx.organizer.call('GET', '/api/admin/dashboard')).data.tournament;
    const games = (body: Record<string, unknown>) => ctx.organizer.call('POST', `/api/admin/tournament/${id}/games`, body);
    const fix = (g: any, a: number, b: number) => games({ action: 'result', num: g.num, a, b, seen: { winner: g.winner, scoreA: g.scoreA, scoreB: g.scoreB } });
    return { ctx, tour, games, fix };
  }
  it('a team leaving during the series: the team still in wins the Final; End works and pays it', async () => {
    const { tour, games } = await bo3();
    const d = (await tour()).day;
    // Third Shot Gang (Parker + Quinn, the Final's side b) leave during game 2.
    const left = d.teams.find((x: any) => x.name === 'Third Shot Gang');
    const r = await games({ action: 'left', playerId: left.players[0].id });
    expect(r.status, r.text).toBe(200);
    const t = await tour();
    expect(t.end, 'the End card').toBeTruthy();
    expect(t.end.standings[0]).toMatchObject({ name: 'Net Ninjas', medal: true });
  });
  it('a semifinal fixed after Final game 1 never moves games 2 and 3 to another team', async () => {
    const { tour, fix } = await bo3();
    let d = (await tour()).day;
    const semi = d.games.find((g: any) => g.stage === 'semi' && g.court === 2);
    // Flip the 2nd vs 3rd semifinal (Kitchen Crew wins it now).
    expect((await fix(semi, 7, 11)).status).toBe(200);
    d = (await tour()).day;
    const names = (g: any) => `${g.a?.name} v ${g.b?.name}`;
    const g1 = d.games.find((g: any) => g.finalGame === 1);
    const g2 = d.games.find((g: any) => g.finalGame === 2);
    expect(names(g2)).toBe(names(g1));
    expect(names(g1)).toBe('Net Ninjas v Third Shot Gang');
  });
});

describe('zip 89 (Alex): the warm-up and breaks when nobody sits', () => {
  it('the pace never counts the warm-up or a break', () => {
    // Round 1 done 24 minutes after the start (10 of them warm-up), Round 2 14 minutes later: 14 a round, not 19.
    const r = [
      { round: 1, planned: true, done: true, doneAt: START + 24, pauseBefore: 10 },
      { round: 2, planned: true, done: true, doneAt: START + 38 },
      { round: 3, planned: true, done: true, doneAt: START + 57, pauseBefore: 5 },
    ];
    expect(measuredPace(r, START).pace).toBeCloseTo((57 - 15) / 3);
    expect(measuredPace(r, START).latest).toBeCloseTo(14);
  });
  it('8 Americano on 2 courts: the warm-up line in Round 1; a 5 minute break after Round 2 (no offer during it); Skip break starts Round 3', async () => {
    const ctx = await world(8, { format: 'americano' });
    ctx.app.now = START_MS + 60_000;
    let { v } = await night(ctx);
    expect(v.warmUp).toBe(true);
    expect((await card(ctx, 'Blair')).day.warmUp).toBe(true);
    // Rounds 1 and 2 at 13 minutes a game (Round 1 after the warm-up).
    await playPaced(ctx, 13, false, ({ v }) => v.games.filter((g: any) => g.round <= 2).every((g: any) => g.status === 'done'));
    ({ v } = await night(ctx));
    expect(v.warmUp).toBeUndefined();
    expect(v.breakNow.round).toBe(3);
    expect(Date.parse(v.breakNow.until) - ctx.app.now).toBeGreaterThan(4 * 60_000);
    expect(v.courtsNow.every((c: any) => c.num === null)).toBe(true);
    expect(v.bonus).toBeUndefined();
    const phone = (await card(ctx, 'Blair')).day;
    expect(phone.breakNow.round).toBe(3);
    // Skip break: Round 3 on both courts at once.
    expect((await call(ctx, { action: 'skipBreak' })).status).toBe(200);
    ({ v } = await night(ctx));
    expect(v.breakNow).toBeUndefined();
    expect(v.courtsNow.map((c: any) => v.games.find((g: any) => g.num === c.num)?.round)).toEqual([3, 3]);
    expect((await call(ctx, { action: 'skipBreak' })).status).toBe(409);
    // The rest of the night: the break after Round 4 ends by itself after 5 minutes; every game once; money to the cent.
    const run = await playPaced(ctx, 13, true, undefined, false);
    expect(run.breaks).toBeGreaterThanOrEqual(1);
    const t = await adminTour(ctx);
    expect((await awards(ctx, { action: 'end', seen: t.end.seen })).status).toBe(200);
    allThree(ctx);
  }, 60_000);
  it('10 Americano on 2 courts (two sit each round): no breaks', async () => {
    const ctx = await world(10, { format: 'americano' });
    const run = await playPaced(ctx, 13, false);
    expect(run.breaks).toBe(0);
  }, 60_000);
  it('8 Locked doubles (4 teams on 2 courts): a break after Round 2, then Round 3 by itself after 5 minutes', async () => {
    const ctx = await world(8, { format: 'doubles' });
    await draftAndPublish(ctx);
    await playPaced(ctx, 13, false, ({ v }) => !!v.breakNow);
    const { v } = await night(ctx);
    expect(v.breakNow.round).toBe(3);
    ctx.app.now = Date.parse(v.breakNow.until) + 1000;
    const after = (await night(ctx)).v;
    expect(after.breakNow).toBeUndefined();
    expect(after.courtsNow.filter((c: any) => c.num !== null)).toHaveLength(2);
  }, 60_000);
});

describe('zip 89: the break stage', () => {
  it('Pacing: 5 min break: the break on, about 4 minutes left, Skip break puts Round 3 on both courts', async () => {
    const { setupGroup } = await import('./harness');
    const ctx = await setupGroup();
    await ctx.organizer.call('PUT', '/api/admin/group', { organizerName: 'Alex' });
    ctx.app.env.PREVIEW_CALM = 'on';
    for (const n of ['Alex', 'Parker', 'Rowan', 'Sage', 'Christopher Vanderberg', 'Vic', 'Wren', 'Zoe', 'Quinn', 'Reese']) await ctx.organizer.call('POST', '/api/admin/players', { name: n });
    ctx.app.now = Date.parse('2026-11-13T01:15:00.000Z');
    const r = await ctx.organizer.call('POST', '/api/admin/tournament-test', { stage: 'zip89_break' });
    expect(r.status, r.text).toBe(200);
    const d = (await ctx.organizer.call('GET', '/api/admin/dashboard')).data.tournament.day;
    expect(d.breakNow.round).toBe(3);
    const left = Date.parse(d.breakNow.until) - ctx.app.now;
    expect(left).toBeGreaterThan(3 * 60_000);
    expect(left).toBeLessThanOrEqual(4 * 60_000);
    expect((await ctx.organizer.call('POST', `/api/admin/tournament/${r.data.id}/games`, { action: 'skipBreak' })).status).toBe(200);
    const after = (await ctx.organizer.call('GET', '/api/admin/dashboard')).data.tournament.day;
    expect(after.breakNow).toBeUndefined();
    expect(after.courtsNow.map((c: any) => after.games.find((g: any) => g.num === c.num)?.round)).toEqual([3, 3]);
  });
});
