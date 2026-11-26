// Zip 97 (🎾97.real pace, Alex Nov 26): the night planned closer to the real pace, and fast nights filled with play.
//   1. THE PACE: regular games (pool / round robin rounds, Americano rounds) 17 minutes to 11, 14 to 9, 11 to 7 (were 20 / 16 / 13); playoff
//      games stay 20 (PLAYOFF_MINUTES), never shortened; ties follow (8); warm-up 10, breaks 5, end buffer 20 stay.
//   2. BONUS UNTIL THE PLAYOFFS: Locked doubles' one more round robin round can come after ANY fully scored pool round until a playoff game has
//      started (it needed 2 planned rounds left). Americano unchanged (2 left).
//   3. 6 PLAYERS PLAY AMERICANO at Pay by, exactly like 12 and 14.
import { describe, expect, it } from 'vitest';
import { AMERICANO_EVEN, doublesRefusal, oddSwitchSub, oddSwitchWords, PLANS, playsAmericano, styleAtClose } from '../shared/tournament';
import { BONUS_MIN_LEFT, pacing, type PaceRound } from '../shared/smartPacing';
import { BREAK_MINUTES, END_BUFFER, nightPlan, PLAYOFF_MINUTES, ROUND_MINUTES, TIE_MINUTES, WARM_UP } from '../shared/tournamentPlan';
import { timeCheck } from '../shared/tournamentSchedule';
import { fairnessOf } from '../shared/tournamentFairness';
import { coldOpen, dash, END_MS, integrityBad, PAY_BY_MS, phone, playNight } from './zip92-world';

describe('1. the pace', () => {
  it('regular 17 / 14 / 11, playoffs 20, ties 8; warm-up, breaks and the end buffer unchanged', () => {
    expect(ROUND_MINUTES).toEqual({ 11: 17, 9: 14, 7: 11 });
    expect(PLAYOFF_MINUTES).toBe(20);
    expect(TIE_MINUTES).toBe(8);
    expect([WARM_UP, BREAK_MINUTES, END_BUFFER]).toEqual([10, 5, 20]);
  });

  it('the plan costs pool rounds at 17 and playoff rounds at 20 (Locked doubles), every Americano round at 17', () => {
    // 10 Locked doubles, 2 courts, 2.5 hours: 5 round robin rounds + Final and 3rd place = 10 + 5 x 17 + 20 = 115.
    const ld = nightPlan(10, 2, 150, 'doubles');
    expect([ld.rounds, ld.gameTo, ld.minutesUsed, ld.builtIn]).toEqual([6, 11, 115, { semis: false, bestOf3: false }]);
    // 8 Locked doubles: 3 round robin + semis + Final (2 breaks) = 10 + 3 x 17 + 2 x 20 + 10 = 111.
    const ld8 = nightPlan(8, 2, 150, 'doubles');
    expect([ld8.rounds, ld8.minutesUsed, ld8.builtIn.semis, ld8.breaks]).toEqual([5, 111, true, 2]);
    // 10 Americano: 7 rounds to 11 = 10 + 7 x 17 = 129 (was 6 rounds, 130).
    const am = nightPlan(10, 2, 150, 'americano');
    expect([am.rounds, am.gameTo, am.minutesUsed]).toEqual([7, 11, 129]);
  });

  it('the Time check: a pool round 17 at the table, a playoff 20, and "play to 9" saves the new regular numbers', () => {
    const start = 19 * 60 + 40;
    const rounds = [1, 2, 3, 4, 5].map((round) => ({ round, pool: round <= 5, playTo: 11 as const, done: false }));
    const playoff = { round: 6, pool: false, playTo: 11 as const, done: false };
    const c = timeCheck([...rounds, playoff], start, 22 * 60, start);
    expect(c.finish).toBe(start + 5 * 17 + 20);
    // 25 minutes late after Round 1: games to 9 from Round 2 bring it back (14 a round, 3 saved each, 4 rounds).
    const late = timeCheck([{ ...rounds[0], done: true, doneAt: start + 42, anyResult: true }, ...rounds.slice(1), playoff], start, 22 * 60, start + 42);
    expect(late.suggest?.to).toBe(9);
  });
});

describe('2. Locked doubles bonus until the playoffs (shared/smartPacing.ts)', () => {
  // 8 players: 3 planned round robin rounds, the semifinals and the Final at 20 (fixed).
  const night = (done: number): PaceRound[] => [
    ...[1, 2, 3].map((round) => ({ round, planned: true, done: round <= done, doneAt: round <= done ? 19 * 60 + 40 + round * 13 : undefined, minutes: 17, ...(round === 1 ? { pauseBefore: 10 } : {}) })),
    { round: 4, planned: false, done: false, minutes: 20, fixed: true },
    { round: 5, planned: false, done: false, minutes: 20, fixed: true },
  ];
  const base = { startMin: 19 * 60 + 30, endMin: 22 * 60, kind: 'round' as const, bonusMinutes: 17, started: true, over: false, paused: false, behind: false, leftOpen: false };

  it('after Round 2 of 3 (one planned round left): offered with minLeft 0; the old rule (2 left) said no', () => {
    const r = night(2);
    expect(pacing({ ...base, rounds: r, nowMin: 19 * 60 + 67, minLeft: 0 }).offer?.kind).toBe('round');
    expect(pacing({ ...base, rounds: r, nowMin: 19 * 60 + 67 }).offer).toBeNull();
  });

  it('right after the last planned round (nothing planned left) while the playoffs wait: still offered', () => {
    expect(pacing({ ...base, rounds: night(3), nowMin: 19 * 60 + 80, minLeft: 0 }).offer?.kind).toBe('round');
  });

  it('never when it would not end 20 minutes before the booked end (playoffs counted at 20), behind, or paused', () => {
    expect(pacing({ ...base, rounds: night(2), nowMin: 19 * 60 + 67, minLeft: 0, endMin: 19 * 60 + 67 + 60 }).offer).toBeNull();
    expect(pacing({ ...base, rounds: night(2), nowMin: 19 * 60 + 67, minLeft: 0, behind: true }).offer).toBeNull();
    expect(pacing({ ...base, rounds: night(2), nowMin: 19 * 60 + 67, minLeft: 0, paused: true }).offer).toBeNull();
  });

  it('Americano keeps its rule: 2 planned rounds left', () => {
    expect(BONUS_MIN_LEFT).toBe(2);
    const am = (done: number): PaceRound[] => [1, 2, 3, 4, 5, 6, 7].map((round) => ({ round, planned: true, done: round <= done, doneAt: round <= done ? 19 * 60 + 40 + round * 13 : undefined, minutes: 17 }));
    expect(pacing({ ...base, rounds: am(5), nowMin: 19 * 60 + 106 }).offer?.kind).toBe('round');
    expect(pacing({ ...base, rounds: am(6), nowMin: 19 * 60 + 119 }).offer).toBeNull();
  });

  it('a fast 8 Locked doubles night on the real server, every offer taken: round robin rounds only, one per scored round, all before the playoffs; nothing past 10 PM; money to the cent', async () => {
    const { ctx } = await coldOpen({ n: 8, style: 'vote', courts: 2, log: [] });
    const run = await playNight(ctx, 'fast', 9701, true);
    const offers = run.offers.map((o) => [o.kind, o.afterRound]);
    // (At the 14 minute pace floor the second offer here misses the 9:40 aim by under a minute: one offer, after Round 1.)
    expect(offers.length).toBeGreaterThan(0);
    expect(offers.every(([k]) => k === 'round')).toBe(true);
    // One per fully scored round.
    expect(new Set(offers.map(([, r]) => r)).size).toBe(offers.length);
    // Every offer came before the playoffs: the pool rounds after it.
    const rows = ctx.app.db.raw.prepare("SELECT round, stage FROM tournament_games WHERE tournament_id = ? ORDER BY num").all(ctx.tid) as { round: number; stage: string }[];
    const lastPool = Math.max(...rows.filter((x) => x.stage === 'pool').map((x) => x.round));
    expect(lastPool).toBe(3 + offers.length);
    expect(Math.min(...rows.filter((x) => x.stage !== 'pool').map((x) => x.round))).toBe(lastPool + 1);
    expect(run.offers.every((o) => o.afterRound < lastPool)).toBe(true);
    expect(run.finish).toBeLessThanOrEqual(END_MS - 0);
    expect(run.end?.status).toBe(200);
    expect(run.money.startsWith('0')).toBe(true);
    expect(run.overlap).toEqual([]);
    expect(run.shortenedOnCourt).toEqual([]);
  }, 120_000);

  it('declined: offers after Round 1 AND Round 2 (one planned round left: the old rule never offered there); nothing is added', async () => {
    const { ctx } = await coldOpen({ n: 8, style: 'vote', courts: 2, log: [] });
    const run = await playNight(ctx, 'fast', 9700, false);
    expect(run.offers.map((o) => [o.kind, o.afterRound, o.plannedLeft])).toEqual([
      ['round', 1, 2],
      ['round', 2, 1],
    ]);
    const rows = ctx.app.db.raw.prepare("SELECT MAX(round) AS r FROM tournament_games WHERE tournament_id = ? AND stage = 'pool'").get(ctx.tid) as { r: number };
    expect(rows.r).toBe(3);
    expect(run.money.startsWith('0')).toBe(true);
  }, 120_000);
});

describe('3. 6 players play Americano', () => {
  it('the rule and its words', () => {
    expect(AMERICANO_EVEN).toEqual([6, 12, 14]);
    expect(playsAmericano(6)).toBe(true);
    expect([8, 10, 16].some(playsAmericano)).toBe(false);
    expect(styleAtClose('doubles', 6)).toBe('americano');
    expect(oddSwitchWords('The Cold Open', 6)).toBe('The Cold Open switched to Americano (6 players).');
    expect(oddSwitchSub(6)).toBe('6 locked in. 6 players play Americano.');
    expect(doublesRefusal(6)).toBe('6 players play Americano. 6 are locked in.');
    // The fairness rule: 6 as Locked doubles fails (3 teams, 2 regular games each); as Americano it passes.
    expect(fairnessOf(6, 2, 150, 'doubles').pass).toBe(false);
    expect(fairnessOf(6, 2, 150, 'americano').pass).toBe(true);
    // The plan words for 6 no longer describe Locked doubles.
    expect(PLANS[6].every((p) => p.note.includes('Americano'))).toBe(true);
  });

  it('6 locked in on a Locked doubles vote at Pay by: the switch, one Telegram alert, History, the players’ line; Locked doubles cannot be picked back', async () => {
    const sent: string[] = [];
    const { ctx } = await coldOpen({ n: 6, style: 'vote', courts: 2, log: [], stopAfterPay: true, sent });
    ctx.app.now = PAY_BY_MS + 5 * 60_000;
    const t = (await dash(ctx)).tournament;
    await ctx.app.settle();
    expect(t.lockedIn).toBe(6);
    expect(t.format).toBe('americano');
    expect(t.oddSwitch).toBeTruthy();
    await dash(ctx);
    await ctx.app.settle();
    expect(sent).toEqual(['The Cold Open switched to Americano (6 players). 6 are locked in.']);
    const lines = ((await ctx.organizer.call('GET', '/api/admin/activity')).data.entries as { action: string; details: Record<string, unknown> }[]).filter(
      (e) => e.action === 'tournament_format' && e.details.how === 'odd',
    );
    expect(lines).toHaveLength(1);
    expect((await (await phone(ctx, 'Casey')).call('GET', '/api/group')).data.tournament.styleNote?.text).toBe('Tournament style is now Americano.');
    const back = await ctx.organizer.call('POST', `/api/admin/tournament/${ctx.tid}/switch-back`, {});
    expect(back.status).toBe(409);
    expect(back.data.message).toBe(doublesRefusal(6));
    expect(integrityBad(ctx)).toEqual([]);
  }, 60_000);

  it('the whole 6 player night as Americano: ends by 10 PM, money to the cent', async () => {
    const { ctx, before } = await coldOpen({ n: 6, style: 'vote', courts: 2, log: [] });
    expect(before.plan.style).toBe('americano');
    const run = await playNight(ctx, 'normal', 9706, true);
    expect(run.finish).toBeLessThanOrEqual(END_MS);
    expect(run.end?.status).toBe(200);
    expect(run.money.startsWith('0')).toBe(true);
  }, 120_000);
});
