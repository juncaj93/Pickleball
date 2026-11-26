// Zip 92 (🎾92.dry run fixes): the three night rules 🎾91's dry run asked for, checked on the real server code (tests/zip92-world.ts plays whole
// fake Cold Open nights the way Alex runs them).
//   9   12 locked in at Pay by plays Americano, exactly like an odd count (the switch, Alex's card and Telegram alert, History, the players'
//       banner); 8 and 10 keep Locked doubles; 13 is odd as before.
//   10  Locked doubles "one more round robin round": the offer when the semifinals and a best of 3 are in the night or cannot be offered.
//   11  The Time check eases into a slow night's pace, never shortens a round on a court, says "past 10:00 PM" only past the booked end, and
//       names each prompt by its round (at most one per round on Alex's phone).
import { describe, expect, it } from 'vitest';
import { AMERICANO_EVEN, doublesRefusal, oddSwitchWords, playsAmericano, styleAtClose } from '../shared/tournament';
import { activityText } from '../shared/activity';
import { EASE_ROUNDS, livePace, measuredPace, paceForCheck, pacing, type PaceRound } from '../shared/smartPacing';
import { standings, timeCheck, timeCheckWords, type PlannedGame, type RoundState } from '../shared/tournamentSchedule';
import { loadDay, writePoolRound } from '../server/tournamentDay';
import type { TournamentRow } from '../server/tournament';
import { coldOpen, dash, END_MS, integrityBad, PAY_BY_MS, phone, playNight, START_MS } from './zip92-world';

const group = async (ctx: Awaited<ReturnType<typeof coldOpen>>['ctx'], name: string) => (await (await phone(ctx, name)).call('GET', '/api/group')).data.tournament;
const activity = async (ctx: Awaited<ReturnType<typeof coldOpen>>['ctx']) =>
  (await ctx.organizer.call('GET', '/api/admin/activity')).data.entries as { action: string; details: Record<string, unknown> }[];

describe('fix 9 and the fairness rule: 12 and 14 players play Americano', () => {
  it('the rule: every odd count, 12 and 14 (Zip 97: and 6); 8, 10 and 16 keep the style', () => {
    // Zip 97: 6 plays Americano too (AMERICANO_EVEN = 6, 12, 14).
    expect([6, 7, 9, 11, 12, 13, 14, 15].every(playsAmericano)).toBe(true);
    expect([8, 10, 16].some(playsAmericano)).toBe(false);
    expect(styleAtClose('doubles', 12)).toBe('americano');
    expect(styleAtClose('doubles', 10)).toBe('doubles');
    expect(styleAtClose('doubles', 14)).toBe('americano');
    expect(styleAtClose('doubles', 16)).toBe('doubles');
    expect(oddSwitchWords('The Cold Open', 12)).toBe('The Cold Open switched to Americano (12 players).');
    expect(oddSwitchWords('The Cold Open', 11)).toBe('The Cold Open switched to Americano (odd number of players).');
    expect(oddSwitchWords('The Cold Open')).toBe('The Cold Open switched to Americano (odd number of players).');
    expect(AMERICANO_EVEN).toEqual([6, 12, 14]);
    expect(doublesRefusal(12)).toBe('12 players play Americano. 12 are locked in.');
    expect(doublesRefusal(14)).toBe('14 players play Americano. 14 are locked in.');
    expect(doublesRefusal(9)).toBe('Locked doubles needs an even number. 9 are locked in.');
  });

  for (const n of [10, 11, 12, 13, 14, 16]) {
    it(`${n} locked in on a Locked doubles vote at Pay by`, async () => {
      const sent: string[] = [];
      const { ctx } = await coldOpen({ n, style: 'vote', courts: 2, log: [], stopAfterPay: true, sent });
      ctx.app.now = PAY_BY_MS + 5 * 60_000;
      const [a, b] = await Promise.all([dash(ctx), group(ctx, 'Casey')]);
      await ctx.app.settle();
      const t = a.tournament;
      const switched = playsAmericano(n);
      expect(t.lockedIn).toBe(n);
      expect(t.format).toBe(switched ? 'americano' : 'doubles');
      expect(b.format).toBe(switched ? 'americano' : 'doubles');
      // One switch, one Telegram alert, one History line, the organizer's card and the players' banner, the same as an odd count.
      await dash(ctx);
      await ctx.app.settle();
      expect(sent).toEqual(switched ? [`The Cold Open switched to Americano (${n % 2 === 0 ? `${n} players` : 'odd number of players'}). ${n} are locked in.`] : []);
      const lines = (await activity(ctx)).filter((e) => e.action === 'tournament_format' && e.details.how === 'odd');
      expect(lines).toHaveLength(switched ? 1 : 0);
      if (switched) {
        expect(activityText(lines[0] as never, 'America/Detroit', 'Alex')).toBe(`The Cold Open switched to Americano (${n} locked in${n % 2 === 0 ? '' : ', an odd number'})`);
        expect(t.oddSwitch).toBeTruthy();
        expect(t.switchBack).toBeNull();
        expect((await group(ctx, 'Devon')).styleNote?.text).toBe('Tournament style is now Americano.');
        // Locked doubles cannot be picked back while the count plays Americano, by the gear or by Switch back.
        const back = await ctx.organizer.call('POST', `/api/admin/tournament/${ctx.tid}/switch-back`, {});
        expect(back.status).toBe(409);
        expect(back.data.message).toBe(doublesRefusal(n));
      } else expect((await group(ctx, 'Devon')).styleNote).toBeUndefined();
      expect(integrityBad(ctx)).toEqual([]);
    }, 60_000);
  }

  it('after the switch at 12: a back out to 11 stays Americano (no Switch back?); a second to 10 offers Switch back', async () => {
    const { ctx } = await coldOpen({ n: 12, style: 'vote', courts: 2, log: [], stopAfterPay: true });
    ctx.app.now = PAY_BY_MS + 5 * 60_000;
    expect((await dash(ctx)).tournament.format).toBe('americano');
    for (const [who, left] of [
      ['Kit', 11],
      ['Kai', 10],
    ] as const) {
      const out = await (await phone(ctx, who)).call('POST', '/api/tournament/back-out', { tournamentId: ctx.tid });
      expect(out.status, out.text).toBe(200);
      const t = (await dash(ctx)).tournament;
      expect(t.lockedIn).toBe(left);
      expect(t.format).toBe('americano');
      expect(!!t.switchBack).toBe(left === 10);
      expect(!!t.oddSwitch).toBe(left === 11);
    }
    expect(integrityBad(ctx)).toEqual([]);
  }, 60_000);
});

describe('fix 10: Locked doubles one more round robin round', () => {
  const rows = (ctx: Awaited<ReturnType<typeof coldOpen>>['ctx']) =>
    ctx.app.db.raw.prepare('SELECT num, round, stage, court, slot_a, slot_b, play_to FROM tournament_games WHERE tournament_id = ? ORDER BY num').all(ctx.tid) as {
      num: number;
      round: number;
      stage: string;
      court: number;
      slot_a: string;
      slot_b: string;
      play_to: number;
    }[];

  it('8 players on a fast night: offered after Round 1 (the semifinals are in the plan, a best of 3 needs 3 rounds left); Yes adds Round 4 = Round 1 again, before the semifinals; once only; nothing past 10 PM; money to the cent', async () => {
    const { ctx } = await coldOpen({ n: 8, style: 'vote', courts: 2, log: [] });
    const run = await playNight(ctx, 'fast', 811, true);
    expect(run.offers.map((o) => [o.kind, o.afterRound, o.plannedLeft])).toEqual([['round', 1, 2]]);
    const g = rows(ctx);
    const pool = g.filter((x) => x.stage === 'pool');
    expect(Math.max(...pool.map((x) => x.round))).toBe(4);
    const r1 = pool.filter((x) => x.round === 1).map((x) => `${x.court}:${x.slot_a}-${x.slot_b}`);
    const r4 = pool.filter((x) => x.round === 4).map((x) => `${x.court}:${x.slot_a}-${x.slot_b}`);
    expect(r4).toEqual(r1);
    // The playoffs moved one round later and two numbers on; the Final and 3rd place still point at the semifinals.
    const semis = g.filter((x) => x.stage === 'semi');
    expect(semis.map((x) => [x.round, x.slot_a, x.slot_b])).toEqual([
      [5, 'P1', 'P4'],
      [5, 'P2', 'P3'],
    ]);
    const fin = g.find((x) => x.stage === 'final')!;
    const third = g.find((x) => x.stage === 'third')!;
    expect([fin.round, fin.slot_a, fin.slot_b]).toEqual([6, `W${semis[0].num}`, `W${semis[1].num}`]);
    expect([third.round, third.slot_a, third.slot_b]).toEqual([6, `L${semis[0].num}`, `L${semis[1].num}`]);
    expect(g.map((x) => x.num)).toEqual(g.map((_, i) => i + 1));
    expect(run.finish).toBeLessThanOrEqual(END_MS);
    expect(run.end?.status).toBe(200);
    expect(run.money.startsWith('0')).toBe(true);
    expect(run.overlap).toEqual([]);
  }, 60_000);

  it('declined: nothing is added', async () => {
    const { ctx } = await coldOpen({ n: 8, style: 'vote', courts: 2, log: [] });
    const run = await playNight(ctx, 'fast', 810, false);
    // Zip 97: one more round robin round may be offered with fewer than 2 planned rounds left (until the playoffs start): declined after Round
    // 1, it is offered again after Round 2 (was once). Declined both times: nothing is added.
    expect(run.offers.map((o) => o.kind)).toEqual(['round', 'round']);
    expect(Math.max(...rows(ctx).filter((x) => x.stage === 'pool').map((x) => x.round))).toBe(3);
    expect(run.money.startsWith('0')).toBe(true);
  }, 60_000);

  it('5 teams: the next round robin round again (its sitter sits again, never the team that sat the round before); a stale second tap writes nothing', async () => {
    const { ctx } = await coldOpen({ n: 10, style: 'vote', courts: 2, log: [] });
    const t = ctx.app.db.raw.prepare('SELECT * FROM tournaments WHERE id = ?').get(ctx.tid) as unknown as TournamentRow;
    const day = await loadDay(ctx.app.db as never, ctx.tid);
    const before = rows(ctx);
    // Two taps in the same millisecond (review): one adds the round, the other changes nothing and undoes nothing of the first.
    const both = await Promise.all([writePoolRound(ctx.app.db as never, t, day, '2026-12-02T01:00:00.000Z'), writePoolRound(ctx.app.db as never, t, day, '2026-12-02T01:00:00.000Z')]);
    expect(both.filter(Boolean)).toHaveLength(1);
    // The same tap again, from what was read before the first one: refused, nothing changed.
    expect(await writePoolRound(ctx.app.db as never, t, day, '2026-12-02T01:00:01.000Z')).toBe(false);
    const g = rows(ctx);
    expect(g.length).toBe(before.length + 2);
    const pool = g.filter((x) => x.stage === 'pool');
    const seats = (r: number) => new Set(pool.filter((x) => x.round === r).flatMap((x) => [x.slot_a, x.slot_b]));
    const sitter = (r: number) => ['T1', 'T2', 'T3', 'T4', 'T5'].find((s) => !seats(r).has(s));
    expect(Math.max(...pool.map((x) => x.round))).toBe(6);
    expect(pool.filter((x) => x.round === 6).map((x) => `${x.slot_a}-${x.slot_b}`)).toEqual(pool.filter((x) => x.round === 1).map((x) => `${x.slot_a}-${x.slot_b}`));
    expect(sitter(6)).toBe(sitter(1));
    expect(sitter(6)).not.toBe(sitter(5));
    const fin = g.find((x) => x.stage === 'final')!;
    const third = g.find((x) => x.stage === 'third')!;
    expect([fin.round, third.round]).toEqual([7, 7]);
    expect(g.map((x) => x.num)).toEqual(g.map((_, i) => i + 1));
  }, 60_000);

  it('standings: with an extra round (5 teams, one has a game fewer) wins become the share of games won; equal schedules are exactly as before', () => {
    const game = (num: number, round: number, a: number, b: number): PlannedGame => ({ num, round, court: 1, stage: 'pool', pool: null, a: `T${a}`, b: `T${b}` });
    const games = [game(1, 1, 1, 2), game(2, 1, 3, 4), game(3, 2, 1, 3), game(4, 2, 2, 4), game(5, 3, 1, 4), game(6, 3, 2, 3)];
    const win = (w: 'a' | 'b') => ({ winner: w, skipped: false, scoreA: w === 'a' ? 11 : 5, scoreB: w === 'a' ? 5 : 11 });
    // Four teams, three games each (T2 wins all three): plain wins, T2 first.
    const even = new Map([1, 2, 3, 4, 5, 6].map((n) => [n, win(n === 1 || n === 3 || n === 5 ? 'b' : 'a')] as const)) as never;
    expect(standings(games, even, [1, 2, 3, 4]).map((r) => r.seat)[0]).toBe(2);
    // An extra game for T1, T2 only (T3 and T4 sit): T3 3-0 then has one game fewer than T2 at 3-1.
    const extra = [...games, game(7, 4, 1, 2)];
    const res = new Map([
      [1, win('b')],
      [2, win('a')],
      [3, win('b')],
      [4, win('b')],
      [5, win('b')],
      [6, win('b')],
      [7, win('b')],
    ] as never) as never;
    // T3 3-0 (three games), T4 2-1, T2 2-2 (four games), T1 0-4: by wins T2 would tie T4; by the share won T4 (67%) is above T2 (50%).
    const rows = standings(extra, res, [1, 2, 3, 4]);
    expect(rows.map((r) => `${r.seat}:${r.wins}-${r.losses}`)).toEqual(['3:3-0', '4:2-1', '2:2-2', '1:0-4']);
  });
});

describe('fix 11: the Time check', () => {
  it('a slow night eases into its pace: a third after Round 1, two thirds after Round 2, all of it from Round 3', () => {
    expect(EASE_ROUNDS).toBe(3);
    // Zip 97: from the table's 17 (was 20): 26 is 17 + 9 / 3 = 20 after Round 1 (was 22), 17 + 9 x 2 / 3 = 23 after Round 2 (was 24).
    expect(paceForCheck(false, 26, 1)).toBeCloseTo(20, 5);
    expect(paceForCheck(false, 26, 2)).toBeCloseTo(23, 5);
    expect(paceForCheck(false, 26, 3)).toBe(26);
    expect(paceForCheck(false, 26, 0)).toBeUndefined();
    // Not slower than the table: nothing (Zip 97: the table is 17, so the input is 17; 18 is now slower than the table).
    expect(paceForCheck(false, 17, 2)).toBeUndefined();
    expect(paceForCheck(true, 15)).toBe(15);
  });

  it('the pace is live: a round running past its table time counts as it goes, and reads the same the moment its last score comes in', () => {
    const r = (round: number, doneAt?: number): PaceRound => ({ round, planned: true, done: doneAt !== undefined, doneAt, minutes: 20, ...(round === 1 ? { pauseBefore: 10 } : {}) });
    // 7:30 start (450), Round 1 done 8:05 (25 minutes of play), Round 2 still on.
    const rounds = [r(1, 485), r(2), r(3)];
    expect(livePace(rounds, 450, 500)).toEqual(measuredPace(rounds, 450));
    const at = livePace(rounds, 450, 512);
    expect(at.done).toBe(2);
    const scored = measuredPace([r(1, 485), r(2, 512), r(3)], 450);
    expect(at.pace).toBeCloseTo(scored.pace!, 6);
    expect(at.latest).toBeCloseTo(scored.latest!, 6);
  });

  it('never shortens a round that is on a court; "past 10:00 PM" only past the booked end', () => {
    const s = (round: number, extra: Partial<RoundState> = {}): RoundState => ({ round, pool: true, playTo: 11, done: false, ...extra });
    // 7:30 to 10 PM (450 to 600), Round 1 done at 8:20 (very late), Round 2 already on both courts.
    const late = [s(1, { done: true, doneAt: 500, anyResult: true }), s(2, { onCourt: true }), s(3), s(4), s(5), s(6)];
    const c = timeCheck(late, 460, 600, 501, 25);
    expect(c.suggest?.fromRound).toBeGreaterThanOrEqual(3);
    const free = timeCheck(late.map((x) => ({ ...x, onCourt: false })), 460, 600, 501, 25);
    expect(free.suggest?.fromRound).toBe(2);
    // Even to 7 from Round 3 it ends at 8:21 + 25 + 4 x 16.25 = 9:51: inside 10 PM, so "so we finish on time" (it used to say "over").
    expect(c.suggest?.stillOver).toBe(0);
    expect(timeCheckWords(31, 3, 7, '10:00 PM', 0)).toBe('Running about 31 minutes behind. From Round 3 on, play to 7 so we finish on time.');
    expect(timeCheckWords(40, 3, 7, '10:00 PM', 6)).toBe('Running about 40 minutes behind. From Round 3 on, play to 7. That still runs about 6 minutes past 10:00 PM.');
    // Much later and slower: even to 7 it runs past 10 PM, and stillOver is counted from 10 PM (not from the 9:40 aim).
    const worse = timeCheck(late, 460, 600, 560, 30);
    expect(worse.suggest?.to).toBe(7);
    expect(worse.suggest!.stillOver).toBeGreaterThan(0);
    const aim = timeCheck(late, 460, 620, 560, 30);
    expect(worse.suggest!.stillOver - (aim.suggest?.stillOver ?? 0)).toBe(20);
  });

  it('a stale extra round never shows as an offer in the last 2 planned rounds', () => {
    const r = (round: number, doneAt?: number): PaceRound => ({ round, planned: round <= 3, done: doneAt !== undefined, doneAt, minutes: 20, ...(round === 1 ? { pauseBefore: 10 } : {}) });
    const base = { startMin: 450, endMin: 600, kind: 'round' as const, fixedBonus: false, bonusMinutes: 20, started: true, over: false, paused: false, behind: false, leftOpen: false };
    expect(pacing({ ...base, rounds: [r(1, 473), r(2), r(3), r(4)], nowMin: 474 }).offer?.kind).toBe('round');
    expect(pacing({ ...base, rounds: [r(1, 473), r(2, 486), r(3), r(4)], nowMin: 487 }).offer).toBeNull();
  });

  it('the dry run: 8 and 10 Locked doubles and 12 by vote at every pace, offers taken or not: nothing past 10 PM, at most one prompt a round, no game shortened on a court, money to the cent', async () => {
    for (const n of [8, 10, 12])
      for (const pace of ['fast', 'normal', 'slow', 'mixed'] as const)
        for (const accept of [true, false]) {
          const { ctx, before } = await coldOpen({ n, style: 'vote', courts: 2, log: [] });
          expect(before.formatAtClose).toBe(n === 12 ? 'americano' : 'doubles');
          const run = await playNight(ctx, pace, n * 100 + pace.length * 10 + (accept ? 1 : 0), accept);
          const where = `${n} ${pace} ${accept}`;
          expect(run.finish, where).toBeLessThanOrEqual(END_MS);
          expect(run.finish, where).toBeGreaterThan(START_MS);
          const perRound = new Map<number | null, number>();
          for (const x of run.timeChecks) perRound.set(x.round, (perRound.get(x.round) ?? 0) + 1);
          expect(Math.max(0, ...perRound.values()), where).toBeLessThanOrEqual(1);
          expect(run.shortenedOnCourt, where).toEqual([]);
          for (const x of run.timeChecks) if (/past/.test(x.text)) expect(run.finish, where).toBeGreaterThan(END_MS);
          expect(run.end?.status, where).toBe(200);
          expect(run.money.startsWith('0'), `${where}: ${run.money}`).toBe(true);
        }
  }, 240_000);
});
