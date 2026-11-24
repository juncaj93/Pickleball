import { describe, expect, it } from 'vitest';
import { playerPhone } from './harness';
import { adminTour, awards, books, card, dash, draftAndPublish, games, group, playPools, potOf, setWinner, START_MS, world, type World } from './zip58-world';
import {
  afterFullCents,
  afterFullWords,
  leftWords,
  PRIZE_TIERS,
  suggestedTier,
  suggestionWords,
  tiersOf,
  tierAmounts,
  tierCostCents,
} from '../shared/tournamentMoney';
import { prizeCentsOf } from '../shared/tournament';
import { afterRoundWords, boardGame, firstOpenRound } from '../src/pages/admin/scoreboardData';
import { winDate, winLine, winsTitle } from '../shared/wins';
import { REVEAL_HOLD_MS } from '../shared/reveal';

// Zip 82 (🎾82.night admin), on the real server code:
//   1. the End card's standings (both styles) are the board players get after End / the reveal, row for row (9, 10, 11 Americano; 8, 10, 12
//      Locked doubles), and players still get no table before the reveal;
//   2. the organizer's Standings sheet during an Americano night is the live table (organizer only);
//   3. the scoreboards' Needs a score / status rules;
//   4. Alex's prize tiers and the price check (one set of functions), and Locked doubles' 2nd place credit (the Final's runner-up), to the cent;
//   5. tap a medal: the wins sheet's rows match the medals the viewer sees (Only me never counts; a reveal still playing never counts).

const raw = (ctx: World) => ctx.app.db.raw;

/** Every Americano game by a player's first score (side a wins most, by a spread of margins), until every round is in. */
async function playAmericano(ctx: World, upTo = Infinity) {
  for (let guard = 0; guard < 60; guard++) {
    const r = (await adminTour(ctx)).rounds;
    const open = r.games.filter((g: any) => g.status === 'playing' && g.round <= upTo);
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

async function americanoNight(n: number) {
  const ctx = await world(n, { format: 'americano' });
  expect((await adminTour(ctx)).format).toBe('americano');
  ctx.app.now = START_MS + 60_000;
  return ctx;
}

/** Locked doubles to the Final: pool games by seat order, every playoff game by the lower seat, until End shows. */
async function doublesDone(n: number) {
  const ctx = await world(n, { secondCents: 700 });
  await draftAndPublish(ctx);
  ctx.app.now = START_MS + 60_000;
  await playPools(ctx, (a, b) => Math.min(a, b));
  for (let guard = 0; guard < 20 && !(await adminTour(ctx)).end; guard++) {
    const d = (await adminTour(ctx)).day;
    const open = d.games.filter((g: any) => !g.winner && !g.skipped && g.a && g.b);
    if (!open.length) {
      // A tie for a place: the organizer spins (three) or picks.
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

const plain = (rows: any[]) => rows.map((r) => [r.name, r.record]);

describe('zip 82: the End card standings are the board', () => {
  for (const n of [9, 10, 11]) {
    it(`Americano for ${n}: the End card lists the reveal board row for row; players get no table before the reveal; the gold medal on 1st only`, async () => {
      const ctx = await americanoNight(n);
      await playAmericano(ctx);
      const t = await adminTour(ctx);
      const end = t.end;
      expect(end.standings).toHaveLength(n);
      expect(end.standings.filter((r: any) => r.medal)).toHaveLength(1);
      expect(end.standings[0]).toMatchObject({ name: end.first.name, medal: true });
      expect(end.standings[1].name).toBe(end.second.name);
      for (const r of end.standings) expect(r.chip).toMatch(/^\d+ pts$/);
      // The live Standings sheet (no picks changed) is the same order.
      expect(t.rounds.standings.map((r: any) => r.name)).toEqual(end.standings.map((r: any) => r.name));
      // Players: still no table (Zip 77's rule).
      const before = await card(ctx, end.first.name);
      expect(before.day.standings).toEqual([]);
      expect(before.day.standingsHidden).toBe(true);
      expect(JSON.stringify(before)).not.toMatch(/"points"|"record"|"rank"/);
      // Reveal: the board players get is the End card, row for row (name, W-L, points).
      expect((await awards(ctx, { action: 'end', seen: end.seen })).status).toBe(200);
      const board = (await card(ctx, end.first.name)).day.standings;
      expect(board.map((r: any) => [r.name, r.record, `${r.points} pts`])).toEqual(end.standings.map((r: any) => [r.name, r.record, r.chip]));
      books(ctx);
    });
  }

  it('Americano: Edit awards swaps 1st and 2nd: the End card follows the saved order (as the board will), the gold on the new 1st', async () => {
    const ctx = await americanoNight(9);
    await playAmericano(ctx);
    const end = (await adminTour(ctx)).end;
    expect((await awards(ctx, { action: 'save', first: end.second.key, second: end.first.key, championCents: 1400, secondCents: 700, weeks: 1 })).status).toBe(200);
    const end2 = (await adminTour(ctx)).end;
    expect(end2.standings.slice(0, 2).map((r: any) => r.name)).toEqual([end.second.name, end.first.name]);
    expect(end2.standings[0].medal).toBe(true);
    expect((await awards(ctx, { action: 'end', seen: end2.seen })).status).toBe(200);
    expect((await card(ctx, end.first.name)).day.standings.map((r: any) => r.name)).toEqual(end2.standings.map((r: any) => r.name));
  });

  for (const n of [8, 10, 12]) {
    it(`Locked doubles for ${n}: the End card lists the teams in the order the results board shows after End, gold on the Final winners`, async () => {
      const ctx = await doublesDone(n);
      const end = (await adminTour(ctx)).end;
      expect(end.standings).toHaveLength(n / 2);
      expect(end.standings[0]).toMatchObject({ name: end.first.name, medal: true });
      expect(end.standings.filter((r: any) => r.medal)).toHaveLength(1);
      expect(end.standings[0].players.sort()).toEqual([...end.first.players].sort());
      for (const r of end.standings) expect(r.chip).toMatch(/^([+−]\d+|0) pts$/);
      // Point differences add up to zero across the night.
      const sum = end.standings.reduce((s: number, r: any) => s + Number(r.chip.replace('−', '-').replace(' pts', '')), 0);
      expect(sum).toBe(0);
      expect((await awards(ctx, { action: 'end', seen: end.seen })).status).toBe(200);
      const rows = (await card(ctx, end.first.players[0])).results.rows;
      expect(plain(rows)).toEqual(plain(end.standings));
      books(ctx);
    });
  }
});

describe('zip 82: the Standings sheet during the night', () => {
  it('organizer only: the live table after Round 2; a player still gets nothing; the words say where the night is', async () => {
    const ctx = await americanoNight(10);
    await playAmericano(ctx, 2);
    const r = (await adminTour(ctx)).rounds;
    expect(r.standings).toHaveLength(10);
    expect(r.standings.reduce((s: number, x: any) => s + x.points, 0)).toBeGreaterThan(0);
    expect(afterRoundWords(r.games)).toBe('After Round 2.');
    const p = await card(ctx, 'Casey');
    expect(p.day.standings).toEqual([]);
    expect(JSON.stringify(await group(ctx, 'Casey'))).not.toMatch(/"standings":\[\{/);
  });

  it('the words', () => {
    const g = (round: number, status: string) => ({ round, status }) as any;
    expect(afterRoundWords([g(1, 'playing'), g(1, 'playing')])).toBe('No scores yet.');
    expect(afterRoundWords([g(1, 'done'), g(1, 'playing'), g(2, 'later')])).toBe('Round 1: 1 game of 2 in.');
    expect(afterRoundWords([g(1, 'done'), g(1, 'skipped'), g(2, 'done'), g(2, 'playing')])).toBe('After Round 1, plus 1 game of Round 2.');
    expect(afterRoundWords([g(1, 'done'), g(2, 'done')])).toBe('After Round 2, every game in.');
  });
});

describe('zip 82: the scoreboards', () => {
  it('Locked doubles: Playing when its round has come, Up next after; Done with the winner; a playoff names itself', () => {
    const base = { court: 1, courtNumber: 3, pool: null, playTo: 11, scoreA: null, scoreB: null, skipped: false, resultBy: null, winner: null } as const;
    const team = (seat: number, name: string) => ({ seat, name, players: [`${name} A`, `${name} B`] });
    const d = { round: 2, started: true, over: false };
    const playing = boardGame({ ...base, num: 3, round: 2, stage: 'pool', a: team(1, 'Net Ninjas'), b: team(2, 'Kitchen Crew') }, d);
    expect(playing).toMatchObject({ head: 'Court 3', status: 'playing', needs: true, fixable: false, scores: [null, null] });
    expect(playing.sides[0]).toEqual({ name: 'Net Ninjas', players: 'Net Ninjas A + Net Ninjas B' });
    const due = boardGame({ ...base, num: 1, round: 1, stage: 'pool', a: team(1, 'Net Ninjas'), b: team(3, 'Dill With It') }, d);
    expect(due).toMatchObject({ status: 'playing', needs: true });
    const next = boardGame({ ...base, num: 5, round: 3, stage: 'pool', a: team(1, 'Net Ninjas'), b: team(4, 'Third Shot Gang') }, d);
    expect(next).toMatchObject({ status: 'next', needs: false, fixable: false });
    const done = boardGame({ ...base, num: 2, round: 1, stage: 'pool', a: team(2, 'Kitchen Crew'), b: team(4, 'Third Shot Gang'), winner: 'b', scoreA: 7, scoreB: 11 }, d);
    expect(done).toMatchObject({ status: 'done', winner: 1, scores: [7, 11], fixable: true, needs: false });
    const final = boardGame({ ...base, num: 9, round: 4, stage: 'final', a: null, b: null, waitA: '1st', waitB: '2nd' }, d);
    expect(final).toMatchObject({ head: 'Final · Court 3', status: 'next', needs: false });
    const tieA = boardGame({ ...base, num: 7, round: 2, stage: 'tie' as any, tieLabel: 'Game A', a: team(1, 'Net Ninjas'), b: team(2, 'Kitchen Crew') }, d);
    expect(tieA).toMatchObject({ head: 'Game A · Court 3', status: 'playing', needs: true });
    // Paused (the server sends no round): the first round with a game still open counts, so Enter score stays (review).
    const games = [due, playing, next].map((x) => ({ ...base, num: x.key, round: x.round, stage: 'pool' as const, a: team(1, 'A'), b: team(2, 'B') }));
    expect(firstOpenRound(games)).toBe(1);
    expect(boardGame(games[0], { round: null, started: true, over: false }, firstOpenRound(games)).needs).toBe(true);
    expect(boardGame(games[2], { round: null, started: true, over: false }, firstOpenRound(games)).needs).toBe(false);
    // Before the night: nothing needs a score.
    expect(boardGame({ ...base, num: 1, round: 1, stage: 'pool', a: team(1, 'Net Ninjas'), b: team(3, 'Dill With It') }, { round: null, started: false, over: false }).needs).toBe(false);
  });

  it('the tie game stage: All games counts Game A as Needs a score (the real spin)', async () => {
    const ctx = await doublesTie();
    const d = (await adminTour(ctx)).day;
    const cards = d.games.map((g: any) => boardGame(g, d));
    const tieCards = cards.filter((c: ReturnType<typeof boardGame>) => /^Game [AB] · /.test(c.head));
    expect(tieCards.length).toBe(2);
    expect(tieCards.filter((c: ReturnType<typeof boardGame>) => c.needs)).toHaveLength(1);
  });
});

/** Three teams level in a circle (zip 58's tie3 shape) on 6 players? No: 8 players, seat 3 beats all, 1 > 4 > 2 > 1, then the spin. */
async function doublesTie() {
  const ctx = await world(8);
  await draftAndPublish(ctx);
  ctx.app.now = START_MS + 60_000;
  const d0 = (await adminTour(ctx)).day;
  for (const g of d0.games.filter((x: any) => x.stage === 'pool')) {
    const [a, b] = [g.a.seat, g.b.seat];
    const pair = [a, b].sort().join();
    const w = a === 3 || b === 3 ? 3 : pair === '1,4' ? 1 : pair === '2,4' ? 4 : 2;
    const r = await games(ctx, { action: 'result', num: g.num, a: w === a ? 11 : 7, b: w === a ? 7 : 11 });
    expect(r.status, r.text).toBe(200);
  }
  const tie = (await adminTour(ctx)).day.ties?.[0];
  expect(tie?.mode).toBe('wheel');
  expect((await games(ctx, { action: 'spin', key: tie.key })).status).toBe(200);
  return ctx;
}

describe('zip 82: suggested prizes and the price check (Alex’s rules)', () => {
  it('the tiers cost: Americano full $21, 1st only $14; Locked doubles (Zip 83: no 2nd place) 1st $28 or medals; medals $0', () => {
    expect(PRIZE_TIERS).toEqual(['full', 'first', 'medals']);
    expect(tiersOf('americano')).toEqual(['full', 'first', 'medals']);
    expect(tiersOf('doubles')).toEqual(['first', 'medals']);
    expect(tierCostCents('full', 'americano')).toBe(2100);
    expect(tierCostCents('first', 'americano')).toBe(1400);
    expect(tierCostCents('first', 'doubles')).toBe(2800);
    expect(tierCostCents('full', 'doubles')).toBe(2800);
    expect(tierCostCents('medals', 'doubles')).toBe(0);
    expect(tierAmounts('full')).toEqual({ firstCents: 1400, secondCents: 700 });
    expect(tierAmounts('full', 'doubles')).toEqual({ firstCents: 1400, secondCents: 0 });
    expect(tierAmounts('first')).toEqual({ firstCents: 1400, secondCents: 0 });
    expect(tierAmounts('medals')).toEqual({ firstCents: 0, secondCents: 0 });
    // The money line's prize total follows the same amounts (Locked doubles: two winners, never a 2nd place, whatever is saved for it).
    expect(prizeCentsOf('doubles', 1400, 700)).toBe(tierCostCents('first', 'doubles'));
    expect(prizeCentsOf('doubles', 1400, 0)).toBe(2800);
    expect(prizeCentsOf('americano', 1400, 700)).toBe(tierCostCents('full', 'americano'));
  });

  it('the highest tier what is left can pay, whole tiers only, never an odd amount', () => {
    for (const [left, am, ld] of [
      [4200, 'full', 'first'],
      [4199, 'full', 'first'],
      [2800, 'full', 'first'],
      [2799, 'full', 'medals'],
      [2100, 'full', 'medals'],
      [2099, 'first', 'medals'],
      [1400, 'first', 'medals'],
      [1399, 'medals', 'medals'],
      [0, 'medals', 'medals'],
      [-3000, 'medals', 'medals'],
    ] as const) {
      expect(suggestedTier(left, 'americano'), `${left} americano`).toBe(am);
      expect(suggestedTier(left, 'doubles'), `${left} doubles`).toBe(ld);
    }
    expect(suggestionWords('full')).toBe('Suggested: full prizes (1st $14 · 2nd $7)');
    expect(suggestionWords('first')).toBe('Suggested: 1st only ($14)');
    expect(suggestionWords('medals')).toBe('Suggested: medals only');
    expect(suggestionWords('first', 'doubles')).toBe('Suggested: $14 each to the winners');
    expect(suggestionWords('medals', 'doubles')).toBe('Suggested: medals only');
    expect(leftWords(16200, 12000)).toBe('Tickets $162 − courts $120 = $42 left.');
    expect(leftWords(9000, 12000)).toBe('Tickets $90 − courts $120 = $30 short.');
  });

  it('the price check: what is left after the full tier, red and "short" when below 0', () => {
    expect(afterFullCents(16200, 12000, 'americano')).toBe(2100);
    expect(afterFullWords(2100)).toBe('After full prizes: +$21');
    // Zip 83: Locked doubles counts $28 (1st $14 each, no 2nd place). The Cold Open at 9 paid: $162 − $120 − $28 = +$14.
    expect(afterFullCents(16200, 12000, 'doubles')).toBe(1400);
    expect(afterFullWords(1400)).toBe('After full prizes: +$14');
    expect(afterFullCents(14000, 12000, 'doubles')).toBe(-800);
    expect(afterFullWords(-800)).toBe('After full prizes: $8 short');
    expect(afterFullWords(0)).toBe('After full prizes: +$0');
  });

  it('Edit awards gets the real money: tickets in (as Totals) and the courts from the final time and courts', async () => {
    const ctx = await americanoNight(9);
    await playAmericano(ctx);
    const end = (await adminTour(ctx)).end;
    // 9 locked in at $16 each, all with credit: $144; 2 courts x 2.5 hours x $24 = $120.
    expect(end.money).toEqual({ ticketsCents: 9 * 1600, courtCents: 12000 });
    expect(suggestedTier(end.money.ticketsCents - end.money.courtCents, 'americano')).toBe('full');
    // A standby hold that never got a spot goes back at End, so it never counts (review): only spots, as Totals reads them after End.
    // Shay (not in the night) on standby with $16 paid: still $144.
    raw(ctx)
      .prepare("INSERT INTO tournament_tickets (id, tournament_id, player_id, place, place_at, price_cents, credit_cents, paid_cents, claim_cents, created_at, updated_at) VALUES ('standby-1', ?, ?, 'line', ?, 1600, 0, 1600, 0, ?, ?)")
      .run(ctx.tid, ctx.byName.Shay, new Date(ctx.app.now).toISOString(), new Date(ctx.app.now).toISOString(), new Date(ctx.app.now).toISOString());
    expect((await adminTour(ctx)).end.money).toEqual({ ticketsCents: 9 * 1600, courtCents: 12000 });
  });
});

describe('zip 83: Locked doubles has NO 2nd place, ever (Alex; Zip 82’s runner-up credit is gone), to the cent', () => {
  it('even with $7 saved for 2nd: no 2nd place on the End card, only the winners get credit (once), no 2nd place row or card; the books read zero', async () => {
    const ctx = await doublesDone(8);
    expect(raw(ctx).prepare('SELECT second_credit_cents AS c FROM tournaments WHERE id = ?').get(ctx.tid)).toEqual({ c: 700 });
    const end = (await adminTour(ctx)).end;
    expect(end.second).toBeNull();
    expect(end.secondCents).toBe(0);
    const firsts = end.first.players as string[];
    const all = (await dash(ctx)).players.map((p: any) => p.name) as string[];
    const before = Object.fromEntries(all.map((n) => [n, potOf(ctx, n)]));
    expect((await awards(ctx, { action: 'end', seen: end.seen })).status).toBe(200);
    expect((await awards(ctx, { action: 'end', seen: end.seen })).status).toBe(409);
    for (const n of all) expect(potOf(ctx, n), n).toBe(before[n] + (firsts.includes(n) ? 1400 : 0));
    expect(raw(ctx).prepare("SELECT COUNT(*) AS c FROM tournament_results WHERE tournament_id = ? AND award = 'second'").get(ctx.tid)).toEqual({ c: 0 });
    expect(raw(ctx).prepare('SELECT COUNT(*) AS c FROM tournament_results WHERE tournament_id = ? AND award IS NOT NULL').get(ctx.tid)).toEqual({ c: 2 });
    const medals = raw(ctx).prepare('SELECT p.display_name AS n FROM tournament_results r JOIN players p ON p.id = r.player_id WHERE r.tournament_id = ? AND r.medal = 1').all(ctx.tid) as { n: string }[];
    expect(medals.map((m) => m.n).sort()).toEqual([...firsts].sort());
    // Nobody but the winners gets a card ("Second place, ..." never shows for Locked doubles).
    for (const n of all.filter((x) => !firsts.includes(x))) expect((await group(ctx, n)).tourAwards?.congrats, n).toBeUndefined();
    books(ctx);
  });

  it('Edit awards: a 2nd place pick or amount sent for Locked doubles is ignored; moving 1st keeps the Final’s winner right below it', async () => {
    const ctx = await doublesDone(8);
    const end = (await adminTour(ctx)).end;
    const other = end.choices.find((c: any) => c.key !== end.first.key);
    expect((await awards(ctx, { action: 'save', first: other.key, second: end.first.key, championCents: 1400, secondCents: 900, weeks: 1 })).status).toBe(200);
    const end2 = (await adminTour(ctx)).end;
    expect(end2.second).toBeNull();
    expect(end2.secondCents).toBe(0);
    expect(end2.standings.slice(0, 2).map((r: any) => r.name)).toEqual([other.name, end.first.name]);
    const all = (await dash(ctx)).players.map((p: any) => p.name) as string[];
    const before = Object.fromEntries(all.map((n) => [n, potOf(ctx, n)]));
    expect((await awards(ctx, { action: 'end', seen: end2.seen })).status).toBe(200);
    const winners = other.players as string[];
    for (const n of all) expect(potOf(ctx, n), n).toBe(before[n] + (winners.includes(n) ? 1400 : 0));
    books(ctx);
  });
});

describe('zip 82: tap a medal (the wins sheet)', () => {
  it('the rows match the medals the viewer sees: Only me never counts; newest first; the partner on Locked doubles; organizer the same', async () => {
    const ctx = await doublesDone(8);
    const end = (await adminTour(ctx)).end;
    expect((await awards(ctx, { action: 'end', seen: end.seen })).status).toBe(200);
    const winner = end.first.players[0] as string;
    const partner = end.first.players[1] as string;
    // An older public win and an Only me (test) win for the same player.
    const pid = ctx.byName[winner];
    const add = (id: string, name: string, date: string, visibility: string, format: string) => {
      raw(ctx)
        .prepare(
          `INSERT INTO tournaments (id, group_id, name, size, courts, minutes, start_minutes, ticket_cents, champion_credit_cents, offered_dates, final_date, status, visibility, created_at, updated_at, format, second_credit_cents, ended_at, end_key, banner_until)
           SELECT ?, group_id, ?, 12, 2, 150, 1170, 1600, 1400, '[]', ?, 'ended', ?, ?, ?, ?, 700, ?, ?, ? FROM tournaments WHERE id = ?`,
        )
        .run(id, name, date, visibility, `${date}T23:00:00.000Z`, `${date}T23:00:00.000Z`, format, `${date}T23:00:00.000Z`, id + 'k', `${date}T23:00:00.000Z`, ctx.tid);
      raw(ctx)
        .prepare('INSERT INTO tournament_results (id, tournament_id, player_id, finish, wins, losses, points, medal, award, credit_cents, created_at) VALUES (?, ?, ?, 1, 5, 0, 55, 1, ?, 0, ?)')
        .run(id + 'r', id, pid, 'champion', `${date}T23:00:00.000Z`);
    };
    add('t-summer', 'Summer Slam', '2026-08-15', 'all', 'americano');
    add('t-test', 'Secret Test', '2026-10-01', 'me', 'americano');
    const g = await group(ctx, 'Shay');
    expect(g.tourAwards.medals[winner]).toBe(2);
    const shay = await playerPhone(ctx, 'Shay');
    const r = await shay.call('GET', `/api/tournament/wins?name=${encodeURIComponent(winner)}`);
    expect(r.status, r.text).toBe(200);
    expect(r.data.wins).toEqual([
      { tournament: 'The Cold Open', date: '2026-11-12', format: 'doubles', partner },
      { tournament: 'Summer Slam', date: '2026-08-15', format: 'americano' },
    ]);
    expect(r.data.wins).toHaveLength(g.tourAwards.medals[winner]);
    expect(r.text).not.toMatch(/cents|\$/);
    // The organizer's tap: the same rows; History and the Players card show the same count.
    const o = await ctx.organizer.call('GET', `/api/admin/tournament-wins?name=${encodeURIComponent(winner)}`);
    expect(o.data).toEqual(r.data);
    const h = await ctx.organizer.call('GET', '/api/admin/tournament-history');
    expect(h.data.wins.find((w: any) => w.name === winner).medals).toBe(2);
    expect((await ctx.organizer.call('PUT', '/api/admin/players-redo-switch', { on: true })).status).toBe(200);
    const sum = await ctx.organizer.call('GET', `/api/admin/players/${pid}/summary`);
    expect(sum.data.tournaments?.medals, sum.text).toBe(2);
    // Nobody's name: no rows; a missing name is refused; a phone with no name picked is refused.
    expect((await shay.call('GET', '/api/tournament/wins?name=Nobody')).data.wins).toEqual([]);
    expect((await shay.call('GET', '/api/tournament/wins')).status).toBe(400);
  });

  it('an Americano reveal still playing: the medal and its row both wait', async () => {
    const ctx = await americanoNight(9);
    await playAmericano(ctx);
    const end = (await adminTour(ctx)).end;
    const tap = ctx.app.now;
    expect((await awards(ctx, { action: 'end', seen: end.seen })).status).toBe(200);
    const first = end.first.name as string;
    const shay = await playerPhone(ctx, 'Shay');
    expect((await group(ctx, 'Shay')).tourAwards?.medals?.[first]).toBeUndefined();
    expect((await shay.call('GET', `/api/tournament/wins?name=${encodeURIComponent(first)}`)).data.wins).toEqual([]);
    ctx.app.now = tap + REVEAL_HOLD_MS;
    expect((await group(ctx, 'Shay')).tourAwards.medals[first]).toBe(1);
    expect((await shay.call('GET', `/api/tournament/wins?name=${encodeURIComponent(first)}`)).data.wins).toHaveLength(1);
  });

  it('the words: "Your wins", "Vic’s wins", "Tue Dec 1, 2026 · Locked doubles with Wren", "Sat Aug 15, 2026 · Americano"', () => {
    expect(winsTitle('Parker', 'Parker')).toBe('Your wins');
    expect(winsTitle('Vic', 'Parker')).toBe('Vic’s wins');
    expect(winDate('2026-12-01')).toBe('Tue Dec 1, 2026');
    expect(winLine({ tournament: 'The Cold Open', date: '2026-12-01', format: 'doubles', partner: 'Wren' })).toBe('Tue Dec 1, 2026 · Locked doubles with Wren');
    expect(winLine({ tournament: 'Summer Slam', date: '2026-08-15', format: 'americano' })).toBe('Sat Aug 15, 2026 · Americano');
  });
});
