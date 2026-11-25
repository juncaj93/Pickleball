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
  it('20 / 16 / 13 minutes a round, 20 minutes kept free, a tie game 10', () => {
    expect(ROUND_MINUTES).toEqual({ 11: 20, 9: 16, 7: 13 });
    expect(END_BUFFER).toBe(20);
    expect(BONUS_SPARE).toBe(END_BUFFER);
    expect(TIE_MINUTES).toBe(10);
  });
  it('Dec 1 (10 players, 2 courts, 2.5 hours): Locked doubles 5 round robin rounds to 11 + Final and 3rd place; Americano 6 rounds to 11', () => {
    const ld = nightPlan(10, 2, 150, 'doubles');
    expect([ld.doubles!.poolRounds, ld.doubles!.playoffRounds, ld.doubles!.third, ld.gameTo, ld.rounds, ld.minutesUsed, ld.fits]).toEqual([5, 1, true, 11, 6, 120, true]);
    const am = nightPlan(10, 2, 150, 'americano');
    expect([am.rounds, am.gameTo, am.minutesUsed, am.fits]).toEqual([6, 11, 120, true]);
  });
  it('no size 6 to 16 (1 and 2 courts, 2 / 2.5 / 3 hours, both styles) plays fewer rounds or shorter games than with the old numbers', () => {
    const old = { 11: 23, 9: 19, 7: 16 } as const;
    for (const style of ['doubles', 'americano'] as const)
      for (const c of [1, 2])
        for (const m of [120, 150, 180])
          for (let n = 6; n <= 16; n++) {
            const now = nightPlan(n, c, m, style);
            // The old plan, the same rules with 23 / 19 / 16 and 10 minutes kept free.
            const budget = m - 10;
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
            expect(now.rounds, `${style} ${n} ${c} ${m}`).toBeGreaterThanOrEqual(was.rounds);
            expect(now.gameTo, `${style} ${n} ${c} ${m}`).toBeGreaterThanOrEqual(was.gameTo);
          }
  });
});

describe('zip 89: the pace and the offer (pure)', () => {
  it('the pace is the average round from the real start, never under 14 minutes', () => {
    expect(measuredPace(doneUpTo(0, 15), START).pace).toBeNull();
    expect(measuredPace(doneUpTo(2, 15), START)).toMatchObject({ done: 2, pace: 15 });
    expect(measuredPace(doneUpTo(2, 10), START).pace).toBe(PACE_FLOOR);
    // A round to 9 counts against its own table time (16): 12.8 minutes for it is a 16 minute pace for a round to 11.
    expect(measuredPace([{ round: 1, planned: true, done: true, doneAt: START + 12.8, minutes: 16 }], START).pace).toBeCloseTo(16);
    // Rounds after a round still open do not count yet.
    const gap = [{ round: 1, planned: true, done: true, doneAt: START + 15 }, { round: 2, planned: true, done: false }, { round: 3, planned: true, done: true, doneAt: START + 30 }];
    expect(measuredPace(gap, START).done).toBe(1);
  });
  it('offers after a fast round when the rest + the bonus ends 20 minutes early; nothing when it would not', () => {
    // 15 a round: Round 1 done at 7:45, 5 left x 15 = 75, the bonus round at the table's 20 at least (it can never be shortened as it is
    // the night's new last round... and the review's rule): 9:20 PM, 40 minutes to spare.
    const fast = pacing(base({ rounds: doneUpTo(1, 15), nowMin: START + 15 }));
    expect(fast.offer).toEqual({ kind: 'round', key: 'round:1:6' });
    expect(fast.finishWithBonus).toBe(START + 110);
    // 20 a round: 20 + 5 x 20 + 20 = 140 > 130: no offer.
    expect(pacing(base({ rounds: doneUpTo(1, 20), nowMin: START + 20 })).offer).toBeNull();
    // Exactly 20 to spare is enough; 19 is not.
    const edge = (each: number) => pacing(base({ rounds: doneUpTo(1, each), nowMin: START + each })).offer;
    // each + 5 x each + 20 <= 130: each <= 18.33.
    expect(edge(109.9 / 6)).not.toBeNull();
    expect(edge(110.1 / 6)).toBeNull();
  });
  it('a round in progress counts as at most half done', () => {
    const late = pacing(base({ rounds: doneUpTo(1, 15), nowMin: START + 50 }));
    // From 50 - 7.5 = 42.5 minutes in: 42.5 + 75 + 20 = 137.5 > 130: no offer.
    expect(late.finishWithBonus).toBe(START + 137.5);
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
    expect(paceForCheck(false, 24)).toBe(24);
    // One slow round alone never sets the night's time (a late first round): the table, as before.
    expect(paceForCheck(false, 55, 1)).toBeUndefined();
    expect(paceForCheck(false, 24, 2)).toBe(24);
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
  it('a fast night offers Add a round after Round 1; a stale key is refused; Yes adds Round 7 at once; one bonus per scored round', async () => {
    const ctx = await world(10, { format: 'americano' });
    // 13 minutes a game (Alex's night): stop as soon as the offer shows.
    await playPaced(ctx, 13, false, ({ v }) => !!v.bonus);
    let { v } = await night(ctx);
    expect(v.bonus).toMatchObject({ kind: 'round' });
    expect(v.plannedRounds).toBe(6);
    // Players never see an offer (it is the organizer's).
    const phone = await card(ctx, 'Blair');
    expect(JSON.stringify(phone)).not.toContain('"bonus"');
    expect((await call(ctx, { action: 'bonus', key: 'round:0:6' })).status).toBe(409);
    const ok = await call(ctx, { action: 'bonus', key: v.bonus.key });
    expect(ok.status, ok.text).toBe(200);
    expect(ok.data.round).toBe(7);
    // The same tap again (a second phone) is refused; no second offer before another round is in.
    expect((await call(ctx, { action: 'bonus', key: v.bonus.key })).status).toBe(409);
    ({ v } = await night(ctx));
    expect(v.bonus).toBeUndefined();
    expect(Math.max(...v.games.map((g: any) => g.round))).toBe(7);
    // Round 7: 8 on court, two sit; the bars and the players' phones include it.
    const r7 = v.games.filter((g: any) => g.round === 7);
    expect(r7).toHaveLength(2);
    expect(v.sits.find((s: any) => s.round === 7).names).toHaveLength(2);
    const mine = await card(ctx, r7[0].a.names[0]);
    expect(mine.day.rounds.some((r: any) => r.round === 7)).toBe(true);
    expect(mine.day.progress.total).toBe(7);
  }, 60_000);
  it('the offer goes when the window closes; paused: none; a whole night with every offer taken: books zero, the reveal credits once', async () => {
    const ctx = await world(10, { format: 'americano' });
    await playPaced(ctx, 13, false, ({ v }) => !!v.bonus);
    expect((await call(ctx, { action: 'pause' })).status).toBe(200);
    expect((await night(ctx)).v.bonus).toBeUndefined();
    expect((await call(ctx, { action: 'resume' })).status).toBe(200);
    expect((await night(ctx)).v.bonus).toBeTruthy();
    // Ignored: Rounds 2 to 4 go by with the offer showing after each, then no offer with 2 planned rounds left... wait, 2 left still offers;
    // with 1 left (after Round 5) none.
    await playPaced(ctx, 13, false, ({ v }) => v.games.filter((g: any) => g.round <= 5).every((g: any) => g.status === 'done'), false);
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
  it('10 players (5 teams, a 3 hour night): Semifinals first (1 vs 4, 2 vs 3, both courts after the round robin), then the Final best of 3', async () => {
    // (On 2.5 hours a best of 3 never fits: its two games to 11 count at the table's 20 minutes each, as they can never be shortened.)
    const ctx = await world(10, { format: 'doubles', minutes: 180 });
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
    // The night card's bars: the round robin, then SEMIS, then FINAL.
    // Next bonus after another round: the Final best of 3 (a very fast night: at Alex's 13 minutes a game it does not fit, see the simulations).
    await playPaced(ctx, 10, false, ({ v }) => !!v.bonus, false);
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
  it('8 players (4 teams): semifinals, and a Final won 2-0 never shows game 3', async () => {
    const ctx = await world(8, { format: 'doubles' });
    await draftAndPublish(ctx);
    const run = await playPaced(ctx, 12);
    expect(run.offers.map((o) => o.kind)).toEqual(['semis']);
    const { v } = await night(ctx);
    expect(v.games.filter((g: any) => g.stage === 'semi')).toHaveLength(2);
    expect(v.bestOf3).toBeUndefined();
    allThree(ctx);
  }, 60_000);
  it('12 players (groups of 3: 3 pool rounds): never a best of 3 (it needs 3 planned rounds still to play after a round is in)', async () => {
    const ctx = await world(12, { format: 'doubles' });
    await draftAndPublish(ctx);
    const run = await playPaced(ctx, 10);
    expect(run.offers).toEqual([]);
  }, 60_000);
  it('14 players (groups, semifinals already; 3 hours): the first bonus is the best of 3 Final', async () => {
    const ctx = await world(14, { format: 'doubles', minutes: 180 });
    await draftAndPublish(ctx);
    const run = await playPaced(ctx, 12);
    expect(run.offers.map((o) => o.kind)).toEqual(['bestOf3']);
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
  it('Americano ahead: the offer shows; Yes adds Round 7', async () => {
    const { stage, tour, games } = await preview();
    const id = await stage('zip89_am_ahead');
    const t = await tour();
    expect(t.rounds.bonus).toMatchObject({ kind: 'round' });
    expect(t.rounds.timeCheck ?? null).toBeNull();
    expect((await games(id, { action: 'bonus', key: t.rounds.bonus.key })).status).toBe(200);
    expect(Math.max(...(await tour()).rounds.games.map((g: any) => g.round))).toBe(7);
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
