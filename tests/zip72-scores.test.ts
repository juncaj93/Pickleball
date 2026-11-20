import { describe, expect, it } from 'vitest';
import { playerPhone, setupGroup } from './harness';
import { adminTour, books, card, dash, draftAndPublish, START_MS, world, type World } from './zip58-world';

// Zip 72 (🎾72.scores): scores in Locked doubles, on the real server code. Every Locked doubles game has a score (pool games, semifinals, the
// Final, 3rd place, a tie's Game A and B). The FIRST score from any of the 4 players is the result (Zip 71: no confirming); a second is refused;
// the organizer enters, fixes or clears any score from the night screen. THE TIE RULE (wins, head to head for exactly 2, point difference, points
// scored, then the wheel) ranks the standings, fills the playoffs and orders End tournament.

/** The raw tournament_games row (what the server wrote). */
const row = (ctx: World, num: number) => ctx.app.db.raw.prepare('SELECT * FROM tournament_games WHERE tournament_id = ? AND num = ?').get(ctx.tid, num) as Record<string, unknown>;
const moneyRows = (ctx: World) =>
  JSON.stringify([
    ctx.app.db.raw.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(amount_cents), 0) AS c FROM credit_ledger').get(),
    ctx.app.db.raw.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(paid_cents + credit_cents), 0) AS c FROM tournament_tickets').get(),
  ]);
/** A player's score: `mine` for their own team. */
const enter = async (ctx: World, name: string, num: number, mine: unknown, theirs: unknown, action = 'score') =>
  (await playerPhone(ctx, name)).call('POST', '/api/tournament/game', { tournamentId: ctx.tid, num, action, mine, theirs });
const fix = (ctx: World, body: Record<string, unknown>) => ctx.organizer.call('POST', `/api/admin/tournament/${ctx.tid}/games`, body);

/** 2n players, teams drafted and published, the night started a minute ago. Game 1's two teams and players. */
async function night(n = 8, opts: Parameters<typeof world>[1] = {}) {
  const ctx = await world(n, opts);
  await draftAndPublish(ctx);
  ctx.app.now = START_MS + 60_000;
  const d = (await dash(ctx)).tournament.day;
  const g1 = d.games[0];
  const ta = d.teams.find((x: any) => x.seat === g1.a.seat);
  const tb = d.teams.find((x: any) => x.seat === g1.b.seat);
  return { ctx, num: g1.num as number, teamA: ta.name as string, teamB: tb.name as string, a: ta.players[0].name as string, a2: ta.players[1].name as string, b: tb.players[0].name as string, b2: tb.players[1].name as string };
}

/** Every pool game scored by the organizer: `score(seatA, seatB)` gives [points of seat A, points of seat B]. */
async function scorePools(ctx: World, score: (a: number, b: number) => [number, number]) {
  for (const g of (await adminTour(ctx)).day.games.filter((x: any) => x.stage === 'pool')) {
    const [x, y] = score(g.a.seat, g.b.seat);
    const r = await fix(ctx, { action: 'result', num: g.num, a: x, b: y });
    expect(r.status, r.text).toBe(200);
  }
}
const table =
  (t: Record<string, [number, number]>) =>
  (a: number, b: number): [number, number] => {
    if (t[`${a}>${b}`]) return t[`${a}>${b}`];
    if (t[`${b}>${a}`]) return [t[`${b}>${a}`][1], t[`${b}>${a}`][0]];
    return a < b ? [11, 7] : [7, 11];
  };

describe('zip 72: Enter score in Locked doubles (the first score counts)', () => {
  it("Vic's 11 to 7 is the result at once: all four see Won 11–7 or Lost 7–11, the standings show the point difference, the organizer sees the score", async () => {
    const { ctx, num, a, a2, b, b2, teamA } = await night();
    const before = moneyRows(ctx);
    // Before any score: no point difference chips (picture pair-1), the game is on with Enter score.
    const first = (await card(ctx, a)).day;
    expect(first.games[0]).toMatchObject({ onNow: true, state: 'next' });
    expect(first.standings[0].rows.every((r: any) => r.diff === undefined)).toBe(true);
    expect((await enter(ctx, a, num, 11, 7)).status).toBe(200);
    expect(row(ctx, num)).toMatchObject({ winner: 'a', score_a: 11, score_b: 7, claim: null, claim_by: ctx.byName[a], result_by: 'players' });
    for (const [who, won] of [[a, true], [a2, true], [b, false], [b2, false]] as const) {
      const day = (await card(ctx, who)).day;
      expect(day.games[0], who).toMatchObject({ state: 'done', won, score: won ? { mine: 11, theirs: 7 } : { mine: 7, theirs: 11 } });
      expect(day.games[0].onNow, who).toBeUndefined();
      const me = day.standings[0].rows.find((r: any) => r.me);
      expect([me.record, me.diff], who).toEqual(won ? ['1-0', 4] : ['0-1', -4]);
      // Every row has its chip once a score is in (picture pair-4: "0 pts" for teams that have not played).
      expect(day.standings[0].rows.map((r: any) => r.diff).sort(), who).toEqual([-4, 0, 0, 4]);
    }
    const g = (await dash(ctx)).tournament.day.games[0];
    expect(g).toMatchObject({ winner: 'a', scoreA: 11, scoreB: 7, by: a, resultBy: 'players' });
    expect(Object.keys(g).filter((k) => /claim|disput|wait|confirm/i.test(k))).toEqual([]);
    // History says who entered what.
    const act = (await ctx.organizer.call('GET', '/api/admin/activity')).text;
    expect(act).toContain(`${teamA} won 11 to 7`);
    expect(moneyRows(ctx)).toBe(before);
    books(ctx);
  });

  it('a second score from anyone is refused with who entered it; the same player again is fine; a score that agrees "is in"', async () => {
    const { ctx, num, a, a2, b, teamA } = await night();
    expect((await enter(ctx, a, num, 11, 7)).status).toBe(200);
    const stamp = row(ctx, num).updated_at;
    const other = await enter(ctx, b, num, 11, 9);
    expect(other.status).toBe(409);
    expect(other.text).toContain(`${a} entered ${teamA} 11 to 7. Ask Alex to fix it.`);
    // The same game seen from the other side (their 7, our 11) says the same thing: still refused, nothing to fix.
    const agrees = await enter(ctx, b, num, 7, 11);
    expect(agrees.status).toBe(409);
    expect(agrees.text).toContain(`${a} entered ${teamA} 11 to 7. It is in.`);
    expect((await enter(ctx, a2, num, 11, 7)).text).toContain('It is in.');
    // Vic again (a refresh, a second phone): fine. Vic with another score: refused.
    expect((await enter(ctx, a, num, 11, 7)).status).toBe(200);
    expect((await enter(ctx, a, num, 11, 5)).text).toContain(`You entered ${teamA} 11 to 7. Ask Alex to fix it.`);
    expect(row(ctx, num).updated_at).toBe(stamp);
  });

  it('We won and "<team> won" are gone: the old taps and confirm are refused and write nothing', async () => {
    const { ctx, num, a, b } = await night();
    const stamp = row(ctx, num).updated_at;
    for (const action of ['won', 'lost', 'confirm', 'dispute', 'undo']) {
      const r = await (await playerPhone(ctx, a)).call('POST', '/api/tournament/game', { tournamentId: ctx.tid, num, action });
      expect(r.status, action).toBe(409);
    }
    expect((await (await playerPhone(ctx, b)).call('POST', '/api/tournament/game', { tournamentId: ctx.tid, num, action: 'won' })).text).toContain('Enter the score');
    expect(row(ctx, num).updated_at).toBe(stamp);
    expect(row(ctx, num).winner).toBeNull();
  });

  it('a score that cannot be is refused before anything is written; an odd one is taken (Alex can fix it)', async () => {
    const { ctx, num, a } = await night();
    const stamp = row(ctx, num).updated_at;
    for (const [m, t] of [
      [7, 7],
      [31, 2],
      [-1, 11],
      ['x', 3],
      [11, undefined],
      [11.5, 3],
    ] as [unknown, unknown][]) {
      const r = await enter(ctx, a, num, m, t);
      expect(r.status, `${m}-${t}`).toBe(400);
    }
    expect(row(ctx, num).updated_at).toBe(stamp);
    // 9 to 7 in a game to 11 (cut short by time): taken.
    expect((await enter(ctx, a, num, 9, 7)).status).toBe(200);
    expect(row(ctx, num)).toMatchObject({ score_a: 9, score_b: 7, winner: 'a' });
  });

  it('the losing side can be first: their score names the other team as the winner', async () => {
    const { ctx, num, b2, teamA, a } = await night();
    expect((await enter(ctx, b2, num, 6, 11)).status).toBe(200);
    expect(row(ctx, num)).toMatchObject({ winner: 'a', score_a: 11, score_b: 6, claim_by: ctx.byName[b2] });
    expect((await card(ctx, a)).day.games[0]).toMatchObject({ won: true, score: { mine: 11, theirs: 6 } });
    expect((await enter(ctx, a, num, 11, 6)).text).toContain(`${b2} entered ${teamA} 11 to 6. It is in.`);
  });
});

describe('zip 72: the organizer enters, fixes and clears any score (picture pair-5)', () => {
  it('Set on a game nobody entered (no phones on that court); players cannot answer over it; Fix it; a stale Fix is refused; Clear; a first score again', async () => {
    const { ctx, num, a, b, teamB } = await night();
    // A winner without a score is refused: every game has one.
    expect((await fix(ctx, { action: 'result', num, winner: 'a' })).status).toBe(400);
    expect((await fix(ctx, { action: 'result', num, a: 11, b: 11 })).status).toBe(400);
    expect((await fix(ctx, { action: 'result', num, a: 8, b: 11, seen: { winner: null, scoreA: null, scoreB: null } })).status).toBe(200);
    expect(row(ctx, num)).toMatchObject({ winner: 'b', score_a: 8, score_b: 11, result_by: 'organizer', claim_by: null });
    const r = await enter(ctx, a, num, 11, 8);
    expect(r.status).toBe(409);
    expect(r.text).toContain(`Alex set ${teamB} 11 to 8. Ask Alex to fix it.`);
    expect((await card(ctx, b)).day.games[0]).toMatchObject({ won: true, score: { mine: 11, theirs: 8 } });
    // Fix: what the screen showed must still stand.
    expect((await fix(ctx, { action: 'result', num, a: 11, b: 9, seen: { winner: 'b', scoreA: 8, scoreB: 11 } })).status).toBe(200);
    expect((await fix(ctx, { action: 'result', num, a: 11, b: 2, seen: { winner: 'b', scoreA: 8, scoreB: 11 } })).status).toBe(409);
    expect(row(ctx, num)).toMatchObject({ winner: 'a', score_a: 11, score_b: 9 });
    expect((await ctx.organizer.call('GET', '/api/admin/activity')).text).toContain('11 to 9');
    // Clear: the game is to play again; the first score after it counts.
    expect((await fix(ctx, { action: 'result', num, winner: null, seen: { winner: 'a', scoreA: 11, scoreB: 9 } })).status).toBe(200);
    expect(row(ctx, num)).toMatchObject({ winner: null, score_a: null, score_b: null });
    expect((await enter(ctx, b, num, 11, 4)).status).toBe(200);
    expect(row(ctx, num)).toMatchObject({ winner: 'b', score_a: 4, score_b: 11 });
    books(ctx);
  });

  it('Player left: the team sits out, its games still to play are skipped with no score; played scores stay', async () => {
    const { ctx, num, a, b } = await night();
    expect((await enter(ctx, a, num, 11, 7)).status).toBe(200);
    const r = await fix(ctx, { action: 'left', playerId: ctx.byName[b] });
    expect(r.status, r.text).toBe(200);
    const rows = ctx.app.db.raw.prepare('SELECT num, skipped, score_a, score_b FROM tournament_games WHERE tournament_id = ? ORDER BY num').all(ctx.tid) as any[];
    expect(rows.find((x) => x.num === num)).toMatchObject({ skipped: 0, score_a: 11, score_b: 7 });
    for (const x of rows.filter((y) => y.skipped)) expect([x.score_a, x.score_b]).toEqual([null, null]);
    expect(rows.some((x) => x.skipped)).toBe(true);
  });
});

describe('zip 72: the tie rule on the real server', () => {
  it('8 players: a three-way circle is settled by point difference: no wheel, the Final and 3rd place are filled, players see the chips', async () => {
    const { ctx } = await night(8);
    // Seat 3 beats everyone; 1 > 4 > 2 > 1 below it, by different margins.
    await scorePools(ctx, table({ '3>1': [11, 5], '3>2': [11, 9], '3>4': [11, 8], '1>4': [11, 3], '4>2': [11, 9], '2>1': [11, 9] }));
    const d = (await adminTour(ctx)).day;
    expect(d.ties ?? []).toEqual([]);
    const fin = d.games.find((g: any) => g.stage === 'final');
    const third = d.games.find((g: any) => g.stage === 'third');
    expect([fin.a.seat, fin.b.seat]).toEqual([3, 1]);
    expect([third.a.seat, third.b.seat]).toEqual([2, 4]);
    const name = (await adminTour(ctx)).day.teams.find((x: any) => x.seat === 1).players[0].name;
    const st = (await card(ctx, name)).day.standings[0].rows;
    expect(st.map((r: any) => [r.record, r.diff, r.tied ?? false])).toEqual([
      ['3-0', 11, false],
      ['1-2', 0, false],
      ['1-2', -2, false],
      ['1-2', -9, false],
    ]);
    books(ctx);
  });

  it('8 players, a circle level on everything (every game 11 to 7): the wheel is the last resort', async () => {
    const { ctx } = await night(8);
    await scorePools(ctx, table({ '3>1': [11, 7], '3>2': [11, 7], '3>4': [11, 7], '1>4': [11, 7], '4>2': [11, 7], '2>1': [11, 7] }));
    const d = (await adminTour(ctx)).day;
    expect(d.ties).toHaveLength(1);
    expect(d.ties[0]).toMatchObject({ mode: 'wheel' });
    expect(d.games.find((g: any) => g.stage === 'final').waitB).toBe('Tied');
  });

  it('10 players (5 teams): two teams level on wins are ranked by the game they played, even against point difference', async () => {
    const { ctx } = await night(10);
    // Seat 1 beats everyone. Seats 2 and 3 are 3-1 and 2-... we set: 2 beats 4 and 5 by a lot, loses to 3 by 1 point; 3 loses to 4 and beats 5.
    // 2: beats 4 (11-0), 5 (11-0), loses 1, loses 3 (10-12): 2-2. 3: beats 2, 5; loses 1, 4: 2-2. 4: beats 3, 5... keep 4 at 2-2 too would make
    // three level, so 4 loses to 5: 4 beats 3 only (1-3); 5 beats 4 only (1-3).
    await scorePools(ctx, table({ '1>2': [11, 9], '1>3': [11, 9], '1>4': [11, 9], '1>5': [11, 9], '2>4': [11, 0], '2>5': [11, 0], '3>2': [12, 10], '3>5': [11, 9], '4>3': [11, 9], '5>4': [11, 9] }));
    const name = (await adminTour(ctx)).day.teams.find((x: any) => x.seat === 1).players[0].name;
    const st = (await card(ctx, name)).day.standings[0].rows;
    // Seat 3 (2-2, diff -2) above seat 2 (2-2, diff +18): head to head. Seats 4 and 5 (1-3): 5 beat 4.
    const seatOf = new Map(((await adminTour(ctx)).day.teams as any[]).map((x) => [x.name, x.seat]));
    expect(st.map((r: any) => seatOf.get(r.name))).toEqual([1, 3, 2, 5, 4]);
    const fin = (await adminTour(ctx)).day.games.find((g: any) => g.stage === 'final');
    expect([fin.a.seat, fin.b.seat]).toEqual([1, 3]);
  });

  it('12 players (two pools of 3): the same rule in each pool fills the semifinals; End tournament orders the rest by it across the pools', async () => {
    const { ctx } = await night(12);
    const d0 = (await adminTour(ctx)).day;
    const poolOf = new Map((d0.teams as any[]).map((x) => [x.seat, x.pool]));
    // Each pool: its first seat beats both; the other two: the lower seat wins. Pool B's 3rd loses by a lot, Pool A's 3rd by little.
    const pools = (await adminTour(ctx)).day.games.filter((x: any) => x.stage === 'pool');
    for (const g of pools) {
      const low = Math.min(g.a.seat, g.b.seat);
      const close = poolOf.get(low) === 'A';
      const [w, l] = close ? [11, 9] : [11, 1];
      const r = await fix(ctx, { action: 'result', num: g.num, a: g.a.seat === low ? w : l, b: g.a.seat === low ? l : w });
      expect(r.status, r.text).toBe(200);
    }
    const d = (await adminTour(ctx)).day;
    const semis = d.games.filter((g: any) => g.stage === 'semi');
    expect(semis.every((g: any) => g.a && g.b)).toBe(true);
    // Semifinals, Final and 3rd place, each by a player's score.
    const playerOf = (seat: number) => d.teams.find((x: any) => x.seat === seat).players[0].name as string;
    for (const stage of ['semi', 'final', 'third']) {
      for (const g of (await adminTour(ctx)).day.games.filter((x: any) => x.stage === stage)) {
        const r = await enter(ctx, playerOf(g.a.seat), g.num, 11, 6);
        expect(r.status, r.text).toBe(200);
        expect(row(ctx, g.num)).toMatchObject({ score_a: 11, score_b: 6 });
      }
    }
    const end = (await adminTour(ctx)).end;
    expect(end).toBeTruthy();
    // The order End tournament saves: 5th and 6th are the two pools' 3rd places, both 0-2: Pool A's (lost 9-11 twice, -4) above Pool B's (-20).
    const { doublesOutcome } = await import('../server/tournamentDay');
    const { loadDay } = await import('../server/tournamentDay');
    const t = ctx.app.db.raw.prepare('SELECT * FROM tournaments WHERE id = ?').get(ctx.tid) as any;
    const out = doublesOutcome(t, await loadDay(ctx.app.env.DB, ctx.tid), 'America/Detroit', ctx.app.now);
    const fifth = out.order[4];
    const sixth = out.order[5];
    expect([poolOf.get(fifth), poolOf.get(sixth)]).toEqual(['A', 'B']);
    books(ctx);
  });

  it('a tie game (Game A to 5) takes a score like any game', async () => {
    const { ctx } = await night(8);
    await scorePools(ctx, table({ '3>1': [11, 7], '3>2': [11, 7], '3>4': [11, 7], '1>4': [11, 7], '4>2': [11, 7], '2>1': [11, 7] }));
    const key = (await adminTour(ctx)).day.ties[0].key;
    expect((await fix(ctx, { action: 'spin', key })).status).toBe(200);
    const ga = (await adminTour(ctx)).day.games.find((g: any) => g.tieLabel === 'Game A');
    expect(ga.playTo).toBe(5);
    const who = (await adminTour(ctx)).day.teams.find((x: any) => x.seat === ga.a.seat).players[0].name;
    expect((await enter(ctx, who, ga.num, 5, 3)).status).toBe(200);
    expect(row(ctx, ga.num)).toMatchObject({ score_a: 5, score_b: 3, winner: 'a' });
  });
});

describe('zip 72: the preview stages', () => {
  const NAMES = ['Alex', 'Parker', 'Rowan', 'Sage', 'Christopher Vanderberg', 'Vic', 'Wren', 'Zoe', 'Quinn', 'Reese'];
  async function previewWorld() {
    const ctx = await setupGroup();
    await ctx.organizer.call('PUT', '/api/admin/group', { organizerName: 'Alex' });
    ctx.app.env.PREVIEW_CALM = 'on';
    const byName: Record<string, string> = {};
    for (const n of NAMES) await ctx.organizer.call('POST', '/api/admin/players', { name: n });
    for (const p of (await ctx.organizer.call('GET', '/api/admin/dashboard')).data.players as { id: string; name: string }[]) byName[p.name] = p.id;
    ctx.app.now = Date.parse('2026-11-13T02:00:00.000Z');
    const c = { ...ctx, byName };
    const stage = async (s: string) => {
      const r = await ctx.organizer.call('POST', '/api/admin/tournament-test', { stage: s });
      expect(r.status, r.text).toBe(200);
      return r.data.id as string;
    };
    const group = async (name: string) => (await (await playerPhone(c, name)).call('GET', '/api/group')).data;
    return { ctx, c, stage, group };
  }

  it("zip72_scores (the calm start, Alex's three taps): Vic's Enter score; Parker sees Lost 7–11 and −4 pts; the organizer fixes Game 1", async () => {
    const { ctx, c, stage, group } = await previewWorld();
    const tid = await stage('zip72_scores');
    const vic = (await group('Vic')).tournament.day;
    const g1 = vic.games[0];
    expect(g1).toMatchObject({ label: 'Game 1', onNow: true, opponent: { name: 'Third Shot Gang' } });
    expect((await (await playerPhone(c, 'Vic')).call('POST', '/api/tournament/game', { tournamentId: tid, num: g1.num, action: 'score', mine: 11, theirs: 7 })).status).toBe(200);
    const parker = (await group('Parker')).tournament.day;
    expect(parker.games[0]).toMatchObject({ state: 'done', won: false, score: { mine: 7, theirs: 11 } });
    expect(parker.standings[0].rows.find((r: any) => r.me)).toMatchObject({ record: '0-1', diff: -4 });
    const d = (await ctx.organizer.call('GET', '/api/admin/dashboard')).data.tournament.day;
    const g = d.games.find((x: any) => x.num === g1.num);
    expect(g).toMatchObject({ winner: 'a', scoreA: 11, scoreB: 7, by: 'Vic' });
    const r = await ctx.organizer.call('POST', `/api/admin/tournament/${tid}/games`, { action: 'result', num: g1.num, a: 11, b: 9, seen: { winner: 'a', scoreA: 11, scoreB: 7 } });
    expect(r.status, r.text).toBe(200);
    expect((await group('Parker')).tournament.day.games[0].score).toEqual({ mine: 9, theirs: 11 });
  });

  it('zip72_circle: Kitchen Crew 3-0, the circle settled by point difference (0, −2, −9), the Final set, no wheel; tie3 still shows the wheel', async () => {
    const { ctx, stage, group } = await previewWorld();
    await stage('zip72_circle');
    const vic = (await group('Vic')).tournament.day;
    expect(vic.tie).toBeUndefined();
    expect(vic.standings[0].rows.map((r: any) => [r.name, r.record, r.diff])).toEqual([
      ['Kitchen Crew', '3-0', 11],
      ['Net Ninjas', '1-2', 0],
      ['Third Shot Gang', '1-2', -2],
      ['Dill With It', '1-2', -9],
    ]);
    expect(vic.games.find((g: any) => g.stage === 'final')).toMatchObject({ opponent: { name: 'Kitchen Crew' } });
    expect((await ctx.organizer.call('GET', '/api/admin/dashboard')).data.tournament.day.ties ?? []).toEqual([]);
    await stage('tie3');
    expect((await group('Vic')).tournament.day.tie).toMatchObject({ state: 'spin' });
  });
});
