import { describe, expect, it } from 'vitest';
import { playerPhone } from './harness';
import { adminTour, awards, card, dash, draftAndPublish, games, group, playPools, setWinner, START_MS, world, type World } from './zip58-world';
import { championsFrom, hasChampions, pastLine, reigningLine, winnersLine } from '../shared/champions';
import { REVEAL_HOLD_MS } from '../shared/reveal';

// Zip 83 (🎾83.champions), on the real server code:
//   1. the cup's rule: it shows only when the medal counts the page already loads have someone (players), or the dashboard says `champions`
//      (the organizer); no champ yet, no cup;
//   2. the wall (GET /api/tournament/champions, /api/admin/champions): newest first, the winners in End's order, the team name on Locked
//      doubles, no money; Only me and test tournaments never; it agrees with the medals and the wins sheet;
//   3. the Americano reveal is never spoiled: mid-reveal the JSON has no trace of the night (and no cup from it), then it joins.

const raw = (ctx: World) => ctx.app.db.raw;

/** Every Americano game by a player's first score, until every round is in (as Zip 82's test). */
async function playAmericano(ctx: World) {
  for (let guard = 0; guard < 60; guard++) {
    const r = (await adminTour(ctx)).rounds;
    const open = r.games.filter((g: any) => g.status === 'playing');
    if (!open.length) return;
    for (const g of open) {
      const who = g.a.names[0];
      const mine = (await card(ctx, who)).day.rounds.find((x: any) => x.num === g.num);
      const aWins = g.num % 3 !== 0;
      const res = await (await playerPhone(ctx, who)).call('POST', '/api/tournament/game', { tournamentId: ctx.tid, action: 'score', num: g.num, key: mine.key, mine: aWins ? 11 : 4 + (g.num % 6), theirs: aWins ? 4 + (g.num % 6) : 11 });
      expect(res.status, res.text).toBe(200);
    }
  }
  throw new Error('the night never ended');
}

/** Locked doubles to End (as Zip 82's test). */
async function doublesDone(n: number) {
  const ctx = await world(n);
  await draftAndPublish(ctx);
  ctx.app.now = START_MS + 60_000;
  await playPools(ctx, (a, b) => Math.min(a, b));
  for (let guard = 0; guard < 20 && !(await adminTour(ctx)).end; guard++) {
    const d = (await adminTour(ctx)).day;
    const open = d.games.filter((g: any) => !g.winner && !g.skipped && g.a && g.b);
    if (!open.length) {
      const tie = d.ties?.[0];
      if (!tie) throw new Error('stuck');
      const r = tie.mode === 'wheel' ? await games(ctx, { action: 'spin', key: tie.key }) : await games(ctx, { action: 'pick', key: tie.key, seat: tie.teams[0].seat, picks: tie.picks });
      expect(r.status, r.text).toBe(200);
      continue;
    }
    for (const g of open) await setWinner(ctx, g.num, Math.min(g.a.seat, g.b.seat));
  }
  expect((await adminTour(ctx)).end).toBeTruthy();
  return ctx;
}

/** An older finished tournament straight into the tables (as the preview's History stage writes them). */
function addPast(ctx: World, o: { id: string; name: string; date: string; visibility: 'all' | 'me'; format: 'americano' | 'doubles'; winners: string[]; team?: string }) {
  const at = `${o.date}T23:00:00.000Z`;
  raw(ctx)
    .prepare(
      `INSERT INTO tournaments (id, group_id, name, size, courts, minutes, start_minutes, ticket_cents, champion_credit_cents, offered_dates, final_date, status, visibility, created_at, updated_at, format, second_credit_cents, ended_at, end_key, banner_until)
       SELECT ?, group_id, ?, 12, 2, 150, 1170, 1600, 1400, '[]', ?, 'ended', ?, ?, ?, ?, 700, ?, ?, ? FROM tournaments WHERE id = ?`,
    )
    .run(o.id, o.name, o.date, o.visibility, at, at, o.format, at, o.id + 'k', at, ctx.tid);
  o.winners.forEach((name, i) =>
    raw(ctx)
      .prepare('INSERT INTO tournament_results (id, tournament_id, player_id, finish, wins, losses, points, medal, award, credit_cents, team_name, created_at) VALUES (?, ?, ?, 1, 5, 0, 55, 1, ?, 0, ?, ?)')
      .run(`${o.id}r${i}`, o.id, ctx.byName[name], 'champion', o.team ?? null, at),
  );
}

/** Each winner on the wall once per tournament, counted: exactly the medal counts (the wall agrees with the medals). */
const wallCounts = (wall: any) => {
  const n: Record<string, number> = {};
  for (const t of wall.tournaments) for (const w of t.winners) n[w] = (n[w] ?? 0) + 1;
  return n;
};

describe('zip 83: the cup and the Champions wall', () => {
  it('no champ yet: no medals, no cup, an empty wall; End tournament: the cup, the reigning champs with their team', async () => {
    const ctx = await doublesDone(8);
    // Before End: nothing anywhere.
    const before = await group(ctx, 'Shay');
    expect(hasChampions(before.tourAwards?.medals)).toBe(false);
    expect((await dash(ctx)).champions).toBeUndefined();
    const shay = await playerPhone(ctx, 'Shay');
    expect((await shay.call('GET', '/api/tournament/champions')).data).toEqual({ tournaments: [] });
    expect((await ctx.organizer.call('GET', '/api/admin/champions')).data).toEqual({ tournaments: [] });

    const end = (await adminTour(ctx)).end;
    expect((await awards(ctx, { action: 'end', seen: end.seen })).status).toBe(200);
    // Locked doubles joins at End tournament, at once.
    const g = await group(ctx, 'Shay');
    expect(hasChampions(g.tourAwards?.medals)).toBe(true);
    expect((await dash(ctx)).champions).toBe(true);
    const r = await shay.call('GET', '/api/tournament/champions');
    expect(r.status, r.text).toBe(200);
    expect(r.data.tournaments).toEqual([{ name: 'The Cold Open', date: '2026-11-12', format: 'doubles', winners: end.first.players, team: end.first.name }]);
    expect(r.text).not.toMatch(/cents|\$|credit/i);
    expect((await ctx.organizer.call('GET', '/api/admin/champions')).data).toEqual(r.data);
  });

  it('newest first; Only me and test tournaments never; the wall agrees with the medals and the wins sheet', async () => {
    const ctx = await doublesDone(8);
    const end = (await adminTour(ctx)).end;
    expect((await awards(ctx, { action: 'end', seen: end.seen })).status).toBe(200);
    const [a, b] = end.first.players as string[];
    addPast(ctx, { id: 't-summer', name: 'Summer Slam', date: '2026-08-15', visibility: 'all', format: 'americano', winners: [a] });
    addPast(ctx, { id: 't-spring', name: 'Spring Fling', date: '2026-04-18', visibility: 'all', format: 'doubles', winners: ['Shay', b], team: 'Dink Dynasty' });
    addPast(ctx, { id: 't-secret', name: 'Secret Test', date: '2026-10-01', visibility: 'me', format: 'americano', winners: ['Shay'] });
    const shay = await playerPhone(ctx, 'Shay');
    const r = await shay.call('GET', '/api/tournament/champions');
    expect(r.data.tournaments.map((t: any) => [t.name, t.winners])).toEqual([
      ['The Cold Open', [a, b]],
      ['Summer Slam', [a]],
      ['Spring Fling', ['Shay', b]],
    ]);
    expect(r.data.tournaments[1].team).toBeUndefined();
    expect(r.data.tournaments[2].team).toBe('Dink Dynasty');
    expect(r.text).not.toContain('Secret Test');
    // The medals on screen (the organizer's own phone too) count exactly the wall's rows; each winner's wins sheet has as many rows.
    const medals = (await group(ctx, 'Shay')).tourAwards.medals;
    expect(wallCounts(r.data)).toEqual(medals);
    for (const [name, n] of Object.entries(medals)) {
      const w = await shay.call('GET', `/api/tournament/wins?name=${encodeURIComponent(name)}`);
      expect(w.data.wins.map((x: any) => x.tournament)).toEqual(r.data.tournaments.filter((t: any) => t.winners.includes(name)).map((t: any) => t.name));
      expect(w.data.wins).toHaveLength(n as number);
    }
    // The organizer's wall is the same rows.
    expect((await ctx.organizer.call('GET', '/api/admin/champions')).data).toEqual(r.data);
  });

  it('only an Only me tournament has a winner: players get no cup and an empty wall; the organizer gets no cup either', async () => {
    const ctx = await doublesDone(8);
    raw(ctx).prepare("UPDATE tournaments SET visibility = 'me' WHERE id = ?").run(ctx.tid);
    const end = (await adminTour(ctx)).end;
    expect((await awards(ctx, { action: 'end', seen: end.seen })).status).toBe(200);
    expect(hasChampions((await group(ctx, 'Shay')).tourAwards?.medals)).toBe(false);
    const shay = await playerPhone(ctx, 'Shay');
    const r = await shay.call('GET', '/api/tournament/champions');
    expect(r.data).toEqual({ tournaments: [] });
    expect(r.text).not.toContain('The Cold Open');
    expect((await dash(ctx)).champions).toBeUndefined();
    expect((await ctx.organizer.call('GET', '/api/admin/champions')).data).toEqual({ tournaments: [] });
  });

  it('an Americano reveal still playing: no cup from it, the wall JSON has no trace of it; once the board is done it joins', async () => {
    const ctx = await world(9, { format: 'americano' });
    ctx.app.now = START_MS + 60_000;
    await playAmericano(ctx);
    const end = (await adminTour(ctx)).end;
    const tap = ctx.app.now;
    expect((await awards(ctx, { action: 'end', seen: end.seen })).status).toBe(200);
    const first = end.first.name as string;
    const shay = await playerPhone(ctx, 'Shay');
    // Mid-reveal (the full board takes about 30 seconds; the hold is the longest board's, 16 players).
    for (const at of [tap + 1_000, tap + 20_000, tap + REVEAL_HOLD_MS - 1]) {
      ctx.app.now = at;
      expect(hasChampions((await group(ctx, 'Shay')).tourAwards?.medals)).toBe(false);
      const r = await shay.call('GET', '/api/tournament/champions');
      expect(r.data).toEqual({ tournaments: [] });
      expect(r.text).not.toContain(first);
      expect((await dash(ctx)).champions).toBeUndefined();
    }
    ctx.app.now = tap + REVEAL_HOLD_MS;
    expect(hasChampions((await group(ctx, 'Shay')).tourAwards?.medals)).toBe(true);
    const r = await shay.call('GET', '/api/tournament/champions');
    expect(r.data.tournaments).toEqual([{ name: 'The Cold Open', date: '2026-11-12', format: 'americano', winners: [first] }]);
    expect((await dash(ctx)).champions).toBe(true);
  });

  it('a phone with no name picked is refused; with Tournaments off for everyone the wall is empty', async () => {
    const ctx = await doublesDone(8);
    const end = (await adminTour(ctx)).end;
    expect((await awards(ctx, { action: 'end', seen: end.seen })).status).toBe(200);
    const anon = ctx.app.client();
    anon.groupKey = ctx.groupKey;
    expect((await anon.call('GET', '/api/tournament/champions')).status).toBe(401);
    expect((await ctx.organizer.call('PUT', '/api/admin/tournaments-switch', { on: false })).status).toBe(200);
    const shay = await playerPhone(ctx, 'Shay');
    expect((await shay.call('GET', '/api/tournament/champions')).data).toEqual({ tournaments: [] });
    expect((await group(ctx, 'Shay')).tourAwards).toBeUndefined();
    expect((await dash(ctx)).champions).toBeUndefined();
  });
});

describe('zip 83: the words', () => {
  const cold = { name: 'The Cold Open', date: '2026-12-01', format: 'doubles' as const, winners: ['Vic', 'Wren'], team: 'Net Ninjas' };
  const summer = { name: 'Summer Slam', date: '2026-08-15', format: 'americano' as const, winners: ['Vic'] };
  it('"Tue Dec 1, 2026 · Locked doubles", "Vic + Wren", "Summer Slam · Sat Aug 15, 2026 · Americano"', () => {
    expect(reigningLine(cold)).toBe('Tue Dec 1, 2026 · Locked doubles');
    expect(winnersLine(cold)).toBe('Vic + Wren');
    expect(winnersLine(summer)).toBe('Vic');
    expect(pastLine(summer)).toBe('Summer Slam · Sat Aug 15, 2026 · Americano');
    expect(pastLine({ ...summer, date: null })).toBe('Summer Slam · Americano');
  });
  it('the cup rule: any medal count above 0', () => {
    expect(hasChampions(undefined)).toBe(false);
    expect(hasChampions({})).toBe(false);
    expect(hasChampions({ Vic: 0 })).toBe(false);
    expect(hasChampions({ Vic: 2 })).toBe(true);
  });
  it('grouping keeps the read order and each name once', () => {
    const row = (t: string, n: string, team: string | null = null) => ({ tournament_id: t, name: t.toUpperCase(), final_date: null, format: team ? 'doubles' : 'americano', team_name: team, display_name: n });
    expect(championsFrom([row('a', 'Vic', 'NN'), row('a', 'Wren', 'NN'), row('b', 'Parker'), row('a', 'Vic', 'NN')]).tournaments).toEqual([
      { name: 'A', date: null, format: 'doubles', winners: ['Vic', 'Wren'], team: 'NN' },
      { name: 'B', date: null, format: 'americano', winners: ['Parker'] },
    ]);
  });
});
