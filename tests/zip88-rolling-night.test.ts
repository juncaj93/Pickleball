import { describe, expect, it } from 'vitest';
import { playerPhone } from './harness';
import { adminTour, awards, books, card, draftAndPublish, START_MS, type World, world } from './zip58-world';

// Zip 88 (🎾88.rolling courts): whole nights on the REAL server code with rolling courts, one court always faster (Court 1 about 11 minutes a
// game, Court 2 about 16). The players' phones score each game when it ends on its court. At every step: nobody is on two courts, a game not on
// a court is refused ("That game is not on a court yet."), a court never waits while a game it may start exists, a sitting player sees their
// game the moment it reaches a court. At the end: every game played exactly once, the reveal / End credits once, the books all zero.

const sc = (o: { a: { names?: string[]; players?: string[] } | null; b: { names?: string[]; players?: string[] } | null }) => ({
  a: o.a?.names ?? o.a?.players ?? [],
  b: o.b?.names ?? o.b?.players ?? [],
});
/** The night as the organizer's screen gets it: the style's games and the courts now. */
async function night(ctx: World) {
  const t = await adminTour(ctx);
  const v = t.format === 'americano' ? t.rounds : t.day;
  return { t, v, games: v.games as any[], courts: (v.courtsNow ?? []) as { court: number; num: number | null; last: number | null }[] };
}
/** A player's score as their screen sends it (Americano: the game's key from their own card; Locked doubles: just the numbers). */
async function score(ctx: World, name: string, num: number, mine: number, theirs: number) {
  const phone = await playerPhone(ctx, name);
  const t = (await phone.call('GET', '/api/group')).data.tournament;
  const key = t?.day?.rounds?.find((r: any) => r.num === num)?.key;
  return phone.call('POST', '/api/tournament/game', { tournamentId: ctx.tid, num, action: 'score', mine, theirs, ...(key ? { key } : {}) });
}
const lengthOf = (court: number, num: number) => (court === 1 ? 10 + (num % 3) : 15 + ((num * 7) % 4));

/** Plays the whole night; returns how many games each player started, the order games went on, and how often a court waited. */
async function playNight(ctx: World, opts: { onStep?: (step: number) => Promise<void> } = {}) {
  ctx.app.now = START_MS + 60_000;
  const ends = new Map<number, number>();
  const started: number[] = [];
  let early = 0;
  let refusedChecked = 0;
  for (let step = 0; step < 120; step++) {
    const { t, v, games, courts } = await night(ctx);
    // Locked doubles: End shows once the Final is in; 3rd place beside it still plays to the end.
    if (t.end && courts.every((c) => c.num === null)) break;
    // A tie for a playoff place: the organizer spins (or picks); its games then roll onto the free court.
    const tie = (v.ties ?? []).find((x: any) => (x.mode === 'wheel' && !x.bye) || (x.mode === 'pick' && x.needPicks > 0));
    if (tie) {
      const body = tie.mode === 'wheel' ? { action: 'spin', key: tie.key } : { action: 'pick', key: tie.key, seat: tie.teams.find((x: any) => !tie.picks.includes(x.seat)).seat, picks: tie.picks };
      expect((await ctx.organizer.call('POST', `/api/admin/tournament/${ctx.tid}/games`, body)).status).toBe(200);
      continue;
    }
    const live = courts.filter((c) => c.num !== null).map((c) => ({ court: c.court, g: games.find((x) => x.num === c.num) }));
    expect(live.length, `step ${step}: something is on a court`).toBeGreaterThan(0);
    // Nobody on two courts.
    const on = live.flatMap(({ g }) => [...sc(g).a, ...sc(g).b]);
    expect(new Set(on).size, `step ${step}: double-booked ${on}`).toBe(on.length);
    // The courts and the games' own courts agree.
    for (const { court, g } of live) expect(g.court).toBe(court);
    // A game still waiting for a court is refused, with the new words (checked a few times a night).
    const notOn = (g: any) => (t.format === 'americano' ? g.status === 'later' : g.started === false && !g.winner && !g.skipped);
    const waiting = games.find((g) => notOn(g) && sc(g).a.length);
    if (waiting && refusedChecked < 3) {
      refusedChecked++;
      const r = await score(ctx, sc(waiting).a[0], waiting.num, 11, 3);
      expect([r.status, r.data.message]).toEqual([409, 'That game is not on a court yet.']);
    }
    for (const { court, g } of live) {
      if (!ends.has(g.num)) {
        ends.set(g.num, ctx.app.now + lengthOf(court, g.num) * 60_000);
        started.push(g.num);
        // Rolling courts at work: a pool game started while a game of an earlier round is still to finish.
        const open = (x: any) => x.status === 'playing' || x.status === 'later' || (x.stage !== undefined && !x.winner && !x.skipped);
        if ((g.stage ?? 'pool') === 'pool' && games.some((x) => (x.stage ?? 'pool') === 'pool' && x.round < g.round && open(x))) early++;
        // The phones follow: a player of a game that just went on sees it on their card with its court and Enter score.
        const who = sc(g).a[0];
        const mine = await card(ctx, who);
        const row = t.format === 'americano' ? mine.day.rounds.find((r: any) => r.num === g.num) : mine.day.games.find((x: any) => x.num === g.num);
        expect(row.onNow, `${who} sees game ${g.num} on`).toBe(true);
        expect(row.court).toBe(court);
      }
    }
    const next = Math.min(...live.map(({ g }) => ends.get(g.num)!));
    ctx.app.now = Math.max(ctx.app.now, next);
    for (const { g } of live) {
      if (ends.get(g.num)! > ctx.app.now) continue;
      const winA = g.num % 3 !== 0;
      const lose = 2 + ((g.num * 5) % 8);
      const to = g.playTo ?? 11;
      const r = await score(ctx, sc(g).a[0], g.num, winA ? to : Math.min(lose, to - 2), winA ? Math.min(lose, to - 2) : to);
      expect(r.status, r.text).toBe(200);
    }
    if (opts.onStep) await opts.onStep(step);
  }
  const { t, games } = await night(ctx);
  expect(t.end, 'every game in: the End card').toBeTruthy();
  // Every game played exactly once (or off, when someone left).
  for (const g of games) expect(g.status === 'done' || g.status === 'skipped' || !!g.winner || g.skipped, `game ${g.num}`).toBe(true);
  expect(new Set(started).size).toBe(started.length);
  return { started, games, early };
}

/** Reveal standings / End tournament; the champion credit lands once; the books read zero. */
async function endNight(ctx: World) {
  const t = await adminTour(ctx);
  const before = ctx.app.db.raw.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(amount_cents), 0) AS c FROM credit_ledger WHERE reason LIKE 'tour:%'").get() as any;
  expect((await awards(ctx, { action: 'end', seen: t.end.seen })).status).toBe(200);
  // A second tap changes nothing.
  await awards(ctx, { action: 'end', seen: t.end.seen });
  const after = ctx.app.db.raw.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(amount_cents), 0) AS c FROM credit_ledger WHERE reason LIKE 'tour:%'").get() as any;
  books(ctx);
  return { before, after };
}

describe('zip 88: Americano nights with rolling courts on the real server', () => {
  for (const n of [8, 9, 10, 11, 12, 13, 14, 16]) {
    it(`${n} players: every game once, nobody on two courts, phones follow, the reveal credits once, books zero`, async () => {
      const ctx = await world(n, { format: 'americano' });
      const { started, early } = await playNight(ctx);
      // 11 and 12 players: a court starts a later round early; 8 to 10: the fair schedule never allows it (courts wait as before).
      if (n >= 11) expect(early).toBeGreaterThan(0);
      else expect(early).toBe(0);
      const sched = (await adminTour(ctx)).rounds.games.map((g: any) => g.num);
      expect([...started].sort((a, b) => a - b)).toEqual([...sched].sort((a: number, b: number) => a - b));
      const { before, after } = await endNight(ctx);
      // Americano: 1st $14 and 2nd $7, once each (the world's prizes).
      expect(after.n - before.n).toBe(2);
      expect(after.c - before.c).toBe(1400 + 700);
    }, 120_000);
  }
});

describe('zip 88: Locked doubles nights with rolling courts on the real server', () => {
  for (const n of [8, 10, 12, 14, 16]) {
    it(`${n} players: pools roll, playoffs wait for their teams, Final and 3rd side by side, End credits once`, async () => {
      const ctx = await world(n, { format: 'doubles' });
      await draftAndPublish(ctx);
      const finalAt: Record<string, number> = {};
      const { early } = await playNight(ctx, {
        onStep: async () => {
          const { games } = await night(ctx);
          for (const g of games) if ((g.stage === 'final' || g.stage === 'third') && g.started && !(g.stage in finalAt)) finalAt[g.stage] = ctx.app.now;
        },
      });
      // Groups nights (12): each group plays at its own pace, so a court starts its next round early.
      if (n >= 12) expect(early).toBeGreaterThan(0);
      const { games } = await night(ctx);
      if (finalAt.third !== undefined) expect(finalAt.third).toBe(finalAt.final);
      expect(games.filter((g: any) => g.stage === 'final')).toHaveLength(1);
      const { before, after } = await endNight(ctx);
      // Locked doubles pays the winning team only: $14 each.
      expect(after.n - before.n).toBe(2);
      expect(after.c - before.c).toBe(2 * 1400);
    }, 120_000);
  }
});

describe('zip 88: one court (rolling courts change nothing: one game after another)', () => {
  for (const [n, format] of [[8, 'americano'], [10, 'americano'], [8, 'doubles']] as const) {
    it(`${format} ${n} on 1 court: every game in schedule order`, async () => {
      const ctx = await world(n, { format, courts: 1, minutes: 180 });
      if (format === 'doubles') await draftAndPublish(ctx);
      const { started } = await playNight(ctx);
      expect(started).toEqual([...started].sort((a, b) => a - b));
      await endNight(ctx);
    }, 120_000);
  }
});

describe('zip 88: Fix, Clear, Player left and Pause keep working with rolling courts', () => {
  it('Fix keeps the courts as they are; Clear leaves the game played (needs a score) and the courts unmoved; the organizer sets it again', async () => {
    const ctx = await world(10, { format: 'americano' });
    ctx.app.now = START_MS + 60_000;
    // Round 1 in on both courts, then Court 1's Round 2 game.
    const first = await night(ctx);
    for (const c of first.courts) {
      const g = first.games.find((x) => x.num === c.num);
      ctx.app.now += 60_000;
      expect((await score(ctx, g.a.names[0], g.num, 11, 5)).status).toBe(200);
    }
    const mid = await night(ctx);
    const fixGame = first.games.find((x) => x.num === first.courts[0].num);
    const done = mid.games.find((x) => x.num === fixGame.num);
    ctx.app.now += 5 * 60_000;
    const fix = await ctx.organizer.call('POST', `/api/admin/tournament/${ctx.tid}/games`, { action: 'score', num: done.num, a: 9, b: 11, seen: done.stamp });
    expect(fix.status, fix.text).toBe(200);
    const afterFix = await night(ctx);
    expect(afterFix.courts).toEqual(mid.courts);
    expect(afterFix.games.find((x) => x.num === done.num)).toMatchObject({ scoreA: 9, scoreB: 11, status: 'done' });
    // Clear: the game is played (on its court earlier) and needs a score; the courts do not move.
    const cleared = afterFix.games.find((x) => x.num === done.num);
    const clr = await ctx.organizer.call('POST', `/api/admin/tournament/${ctx.tid}/games`, { action: 'clear', num: done.num, seen: cleared.stamp });
    expect(clr.status, clr.text).toBe(200);
    const afterClear = await night(ctx);
    expect(afterClear.courts).toEqual(mid.courts);
    const again = afterClear.games.find((x) => x.num === done.num);
    expect(again).toMatchObject({ status: 'playing', scoreA: null });
    // Its players can enter it again (it was on a court), or the organizer sets it.
    const set = await ctx.organizer.call('POST', `/api/admin/tournament/${ctx.tid}/games`, { action: 'score', num: done.num, a: 11, b: 4, seen: again.stamp });
    expect(set.status, set.text).toBe(200);
    expect((await night(ctx)).courts).toEqual(mid.courts);
    books(ctx);
  });

  it('the organizer cannot set a score on a game waiting for a court; Pause changes nothing on the courts', async () => {
    const ctx = await world(10, { format: 'americano' });
    ctx.app.now = START_MS + 60_000;
    const n0 = await night(ctx);
    const waiting = n0.games.find((g) => g.status === 'later');
    const r = await ctx.organizer.call('POST', `/api/admin/tournament/${ctx.tid}/games`, { action: 'score', num: waiting.num, a: 11, b: 3, seen: waiting.stamp });
    expect([r.status, r.data.message]).toEqual([409, 'That game is not on a court yet.']);
    expect((await ctx.organizer.call('POST', `/api/admin/tournament/${ctx.tid}/games`, { action: 'pause' })).status).toBe(200);
    expect((await night(ctx)).courts).toEqual(n0.courts);
    expect((await ctx.organizer.call('POST', `/api/admin/tournament/${ctx.tid}/games`, { action: 'resume' })).status).toBe(200);
  });

  it('Player left while on a court (Americano): the court frees, their later games are off, the night still ends and reveals', async () => {
    const ctx = await world(10, { format: 'americano' });
    let left = '';
    await playNight(ctx, {
      onStep: async (step) => {
        if (step !== 3 || left) return;
        const { v, courts, games } = await night(ctx);
        const g = games.find((x) => x.num === courts[0].num);
        left = g.a.names[0];
        const id = v.players.find((p: any) => p.name === left).id;
        const r = await ctx.organizer.call('POST', `/api/admin/tournament/${ctx.tid}/games`, { action: 'left', playerId: id });
        expect(r.status, r.text).toBe(200);
        const after = await night(ctx);
        expect(after.games.find((x) => x.num === g.num).status).toBe('skipped');
        expect(after.courts.every((c) => c.num !== g.num)).toBe(true);
      },
    });
    expect(left).not.toBe('');
    const { v } = await night(ctx);
    expect(v.players.find((p: any) => p.name === left).left).toBe(true);
    await endNight(ctx);
  }, 120_000);

  it('Player left on Locked doubles: Remove (the team sits out) mid pool play; the night ends', async () => {
    const ctx = await world(12, { format: 'doubles' });
    await draftAndPublish(ctx);
    let done = false;
    await playNight(ctx, {
      onStep: async (step) => {
        if (step !== 2 || done) return;
        done = true;
        const { v } = await night(ctx);
        const team = v.teams[v.teams.length - 1];
        const r = await ctx.organizer.call('POST', `/api/admin/tournament/${ctx.tid}/games`, { action: 'left', playerId: team.players[0].id });
        expect(r.status, r.text).toBe(200);
      },
    });
    expect(done).toBe(true);
    await endNight(ctx);
  }, 120_000);
});


describe('zip 88: the night card model on real nights (src/pages/admin/nightCardData.ts)', () => {
  it('Americano, 12 players: a round started early is purple (bar and pill); the lowest round in play is outlined; "1 of 2 in" counts the boxes', async () => {
    const { americanoNightModel } = await import('../src/pages/admin/nightCardData');
    const ctx = await world(12, { format: 'americano' });
    let purple = 0;
    await playNight(ctx, {
      onStep: async () => {
        const t = await adminTour(ctx);
        if (t.end) return;
        const m = americanoNightModel(t.rounds);
        expect(m.style).toBe('Americano · 12 players');
        expect(m.bars.filter((b) => b.state === 'now')).toHaveLength(1);
        const now = m.bars.find((b) => b.state === 'now')!;
        expect(m.bars.slice(0, m.bars.indexOf(now)).every((b) => b.state === 'done')).toBe(true);
        for (const box of m.boxes) {
          const round = Number(box.pill.text.slice(2));
          expect(box.pill.tone).toBe(round > now.rounds[0] ? 'purple' : 'green');
          if (box.pill.tone === 'purple') {
            purple++;
            expect(m.bars.find((b) => b.rounds[0] === round)!.state).toBe('early');
          }
        }
        expect(m.inCount).toBe(m.boxes.filter((b) => b.status === 'done').length);
        // Sitting: nobody in a box.
        const inBoxes = m.boxes.flatMap((b) => [...b.a.split(' + '), ...b.b.split(' + ')]);
        expect(m.sitting.some((x) => inBoxes.includes(x))).toBe(false);
      },
    });
    expect(purple).toBeGreaterThan(0);
  }, 120_000);

  it('Locked doubles: pool rounds then FINAL (wide) without groups; SEMIS then FINAL with groups; playoff pills by name', async () => {
    const { doublesNightModel } = await import('../src/pages/admin/nightCardData');
    for (const n of [10, 12]) {
      const ctx = await world(n, { format: 'doubles' });
      await draftAndPublish(ctx);
      const seen = new Set<string>();
      await playNight(ctx, {
        onStep: async () => {
          const t = await adminTour(ctx);
          const m = doublesNightModel(t.day);
          const labels = m.bars.map((b) => b.label);
          if (n === 10) {
            expect(labels[labels.length - 1]).toBe('FINAL');
            expect(m.bars[m.bars.length - 1].wide).toBe(true);
            expect(labels).not.toContain('SEMIS');
          } else expect(labels.slice(-2)).toEqual(['SEMIS', 'FINAL']);
          for (const b of m.boxes) seen.add(b.pill.text);
        },
      });
      expect(seen.has('Final')).toBe(true);
      expect(seen.has('3rd place')).toBe(true);
      if (n === 12) expect(seen.has('Semifinal')).toBe(true);
    }
  }, 180_000);
});

describe('zip 88 review fixes on the real server', () => {
  it('a cleared score on a waiting court: the box asks for a score again (not "in", not Off)', async () => {
    const { americanoNightModel } = await import('../src/pages/admin/nightCardData');
    const ctx = await world(10, { format: 'americano' });
    ctx.app.now = START_MS + 60_000;
    // Rounds 1 and 2 in on both courts, then Court 1's Round 3 game: Court 1 waits (10 players never start a round early).
    for (let r = 0; r < 2; r++) {
      const n = await night(ctx);
      for (const c of n.courts) {
        const g = n.games.find((x) => x.num === c.num);
        ctx.app.now += 60_000;
        expect((await score(ctx, g.a.names[0], g.num, 11, 6)).status).toBe(200);
      }
    }
    const n3 = await night(ctx);
    const g3 = n3.games.find((x) => x.num === n3.courts[0].num);
    ctx.app.now += 60_000;
    expect((await score(ctx, g3.a.names[0], g3.num, 11, 7)).status).toBe(200);
    const waiting = await night(ctx);
    expect(waiting.courts[0]).toEqual({ court: 1, num: null, last: g3.num });
    expect(americanoNightModel(waiting.v).inCount).toBe(1);
    const stamp = waiting.games.find((x) => x.num === g3.num).stamp;
    expect((await ctx.organizer.call('POST', `/api/admin/tournament/${ctx.tid}/games`, { action: 'clear', num: g3.num, seen: stamp })).status).toBe(200);
    const m = americanoNightModel((await night(ctx)).v);
    const box = m.boxes.find((b) => b.court === 1)!;
    expect(box).toMatchObject({ num: g3.num, status: 'playing', scoreA: null });
    expect(m.inCount).toBe(0);
  });

  it('Locked doubles: a game skipped when a team left, then cleared, is a game to play again (it is not stuck as finished)', async () => {
    const ctx = await world(10, { format: 'doubles' });
    await draftAndPublish(ctx);
    ctx.app.now = START_MS + 60_000;
    const { v } = await night(ctx);
    const team = v.teams[v.teams.length - 1];
    expect((await ctx.organizer.call('POST', `/api/admin/tournament/${ctx.tid}/games`, { action: 'left', playerId: team.players[0].id })).status).toBe(200);
    const after = await night(ctx);
    const off = after.games.find((g) => g.skipped && !g.started);
    expect(off).toBeTruthy();
    const clr = await ctx.organizer.call('POST', `/api/admin/tournament/${ctx.tid}/games`, { action: 'result', num: off.num, winner: null, seen: { winner: null, scoreA: off.scoreA, scoreB: off.scoreB } });
    expect(clr.status, clr.text).toBe(200);
    const row = ctx.app.db.raw.prepare('SELECT skipped, result_at FROM tournament_games WHERE tournament_id = ? AND num = ?').get(ctx.tid, off.num) as any;
    expect(row).toEqual({ skipped: 0, result_at: null });
  });
});
