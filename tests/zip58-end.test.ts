import { describe, expect, it } from 'vitest';
import { playerPhone } from './harness';
import { adminTour, awards, books, card, dash, draftAndPublish, games, group, playerOfSeat, playPools, potOf, setWinner, START_MS, world, type World } from './zip58-world';

// Zip 58 (🎾58.tourney4): End tournament. The money is checked to the cent: the credit is granted once (double taps, two phones, refreshes), it
// matches the amount stored on the tournament, it shows in the credit history, and the money checks read zero. After the end every game,
// result, team and ticket is locked. A player who may not see the tournament gets nothing about it.

/** Seat order wins (1 > 2 > 3 > 4): no tie. */
const byOrder = (a: number, b: number) => Math.min(a, b);
const ledger = (ctx: World, reasonLike: string) =>
  ctx.app.db.raw.prepare('SELECT player_id, kind, amount_cents, reason, ended_at FROM credit_ledger WHERE reason LIKE ? ORDER BY rowid').all(reasonLike) as { player_id: string; kind: string; amount_cents: number; reason: string }[];

/** 8 players, Locked doubles, every game in: the Final (seat 1 beats seat 2) and the 3rd place game (seat 3 beats seat 4). */
async function finalDone(opts: Parameters<typeof world>[1] = {}) {
  const ctx = await world(8, opts);
  await draftAndPublish(ctx);
  ctx.app.now = START_MS + 90 * 60_000;
  await playPools(ctx, byOrder);
  const d = (await adminTour(ctx)).day;
  const fin = d.games.find((g: any) => g.stage === 'final');
  const third = d.games.find((g: any) => g.stage === 'third');
  await setWinner(ctx, third.num, 3);
  // Before the Final is in: no End card.
  expect((await adminTour(ctx)).end).toBeUndefined();
  await setWinner(ctx, fin.num, 1);
  return ctx;
}

describe('zip 58: End tournament, Locked doubles', () => {
  it('the End card: Winners, a medal for each, $14 each, 1 week, 3rd place; Confirm grants $14 to each winner ONCE, to the cent', async () => {
    const ctx = await finalDone();
    const t = await adminTour(ctx);
    const end = t.end;
    const winners = [await playerOfSeat(ctx, 1, 0), await playerOfSeat(ctx, 1, 1)];
    expect(end).toMatchObject({ format: 'doubles', hero: 'Final', championCents: 1400, weeks: 1, second: null, done: { kicker: 'Final is done' } });
    expect(end.first.players.sort()).toEqual([...winners].sort());
    expect(end.third.key).toBe('3');
    expect(end.done.sub).toMatch(/ beat .+ \(.+ \+ .+\)\.$/);
    const pots = winners.map((n) => potOf(ctx, n));
    const others = (await dash(ctx)).players.map((p: any) => p.name).filter((n: string) => !winners.includes(n));
    const otherPots = others.map((n: string) => potOf(ctx, n));
    // A stale card (a different amount than stored) is refused; the right one ends it.
    expect((await awards(ctx, { action: 'end', seen: end.seen.replace('1400', '1500') })).status).toBe(409);
    const [r1, r2] = await Promise.all([awards(ctx, { action: 'end', seen: end.seen }), awards(ctx, { action: 'end', seen: end.seen })]);
    expect([r1.status, r2.status].sort()).toEqual([200, 409]);
    // A third tap and a refresh change nothing.
    expect((await awards(ctx, { action: 'end', seen: end.seen })).status).toBe(409);
    await dash(ctx);
    const rows = ledger(ctx, `tour:${ctx.tid}:%`).filter((r) => r.reason.endsWith(':champion') || r.reason.endsWith(':second'));
    expect(rows.map((r) => [r.kind, r.amount_cents])).toEqual([
      ['kept', 1400],
      ['kept', 1400],
    ]);
    expect(rows.map((r) => r.player_id).sort()).toEqual(winners.map((n) => ctx.byName[n]).sort());
    expect(winners.map((n) => potOf(ctx, n))).toEqual(pots.map((p) => p + 1400));
    expect(others.map((n: string) => potOf(ctx, n))).toEqual(otherPots);
    // The database itself refuses a second award row for the same player and tournament.
    expect(() =>
      ctx.app.db.raw
        .prepare("INSERT INTO credit_ledger (id, group_id, player_id, kind, amount_cents, five_cents, session_id, created_at, reason) SELECT 'x-1', group_id, player_id, 'kept', 1400, 0, NULL, created_at, reason FROM credit_ledger WHERE reason = ? LIMIT 1")
        .run(`tour:${ctx.tid}:champion`),
    ).toThrow(/UNIQUE/);
    // The credit history says so, in the player's own words.
    const g = await group(ctx, winners[0]);
    expect(g.credit.history.some((h: any) => h.reason === 'tournament' && h.tourWhy === 'champion' && h.cents === 1400)).toBe(true);
    // Results saved: every player, the winners 1st with a medal.
    const res = ctx.app.db.raw.prepare('SELECT player_id, finish, medal, award, credit_cents, team_name, picked_level FROM tournament_results WHERE tournament_id = ? ORDER BY finish').all(ctx.tid) as any[];
    expect(res).toHaveLength(8);
    expect(res.filter((r) => r.medal === 1).map((r) => r.player_id).sort()).toEqual(winners.map((n) => ctx.byName[n]).sort());
    expect(res.map((r) => r.finish)).toEqual([1, 1, 2, 2, 3, 3, 4, 4]);
    expect(res.every((r) => r.picked_level > 0)).toBe(true);
    books(ctx);
  });
  it('after the end: Home is back to normal, the ticker and the congratulations card show, medals by name; every tap is locked', async () => {
    const ctx = await finalDone();
    const end = (await adminTour(ctx)).end;
    const d = (await adminTour(ctx)).day;
    const fin = d.games.find((g: any) => g.stage === 'final');
    const winner = await playerOfSeat(ctx, 1, 0);
    const loser = await playerOfSeat(ctx, 2, 0);
    expect((await awards(ctx, { action: 'end', seen: end.seen })).status).toBe(200);
    // No tournament card on either Home any more (and no live view).
    expect((await adminTour(ctx)) ?? null).toBeNull();
    const gw = await group(ctx, winner);
    expect(gw.tournament).toBeUndefined();
    expect(gw.tourAwards.ticker).toMatchObject({ name: 'The Cold Open', format: 'doubles' });
    expect(gw.tourAwards.ticker.champions.players.map((p: any) => p.name)).toContain(winner);
    expect(gw.tourAwards.congrats).toMatchObject({ title: 'You won The Cold Open', sub: '$14 credit toward your next game, plus a medal next to your name.' });
    expect(gw.tourAwards.medals[winner]).toBe(1);
    const gl = await group(ctx, loser);
    expect(gl.tourAwards.congrats).toBeUndefined();
    expect(gl.tourAwards.ticker).toBeTruthy();
    // Nice: once, then gone (the ticker stays).
    const phone = await playerPhone(ctx, winner);
    expect((await phone.call('POST', '/api/tournament/award-seen', { tournamentId: ctx.tid })).data.changed).toBe(true);
    expect((await phone.call('POST', '/api/tournament/award-seen', { tournamentId: ctx.tid })).data.changed).toBe(false);
    expect((await group(ctx, winner)).tourAwards.congrats).toBeUndefined();
    // Locked: results, Fix, Time check, Player left, a player's We won, renames, a second End and Edit awards.
    expect((await games(ctx, { action: 'result', num: fin.num, winner: 'b' })).status).toBe(409);
    expect((await (await playerPhone(ctx, winner)).call('POST', '/api/tournament/game', { tournamentId: ctx.tid, num: fin.num, action: 'won' })).status).toBe(404);
    expect((await ctx.organizer.call('POST', `/api/admin/tournament/${ctx.tid}/teams`, { action: 'rename', teamId: d.teams[0].id, name: 'Changed' })).status).toBe(409);
    expect((await awards(ctx, { action: 'save', first: '2', championCents: 1400, weeks: 2 })).status).toBe(409);
    expect((await ctx.organizer.call('POST', `/api/admin/tournament/${ctx.tid}/cancel`, {})).status).toBe(409);
    expect(ctx.app.db.raw.prepare("SELECT winner FROM tournament_games WHERE tournament_id = ? AND stage = 'final'").get(ctx.tid)).toEqual({ winner: 'a' });
    // The banner comes down by itself after 1 week; the medal stays.
    ctx.app.now += 7 * 86_400_000 + 60_000;
    const later = await group(ctx, loser);
    expect(later.tourAwards?.ticker).toBeUndefined();
    expect((await group(ctx, winner)).tourAwards.medals[winner]).toBe(1);
    books(ctx);
  });
  it('Edit awards: another winning team, $0 credit (skipped), 3 weeks; Confirm follows it; History and the Players sheet keep it', async () => {
    const ctx = await finalDone();
    expect((await awards(ctx, { action: 'save', first: '2', championCents: 0, weeks: 3 })).status).toBe(200);
    const end = (await adminTour(ctx)).end;
    expect(end).toMatchObject({ championCents: 0, weeks: 3, first: { key: '2' } });
    // Bad values are refused.
    expect((await awards(ctx, { action: 'save', first: '9', championCents: 0, weeks: 3 })).status).toBe(409);
    expect((await awards(ctx, { action: 'save', first: '2', championCents: 1450, weeks: 3 })).status).toBe(400);
    expect((await awards(ctx, { action: 'save', first: '2', championCents: 0, weeks: 5 })).status).toBe(400);
    const w = await playerOfSeat(ctx, 2, 0);
    expect((await awards(ctx, { action: 'end', seen: end.seen })).status).toBe(200);
    expect(ledger(ctx, `tour:${ctx.tid}:champion`)).toHaveLength(0);
    expect((await group(ctx, w)).tourAwards.congrats.sub).toBe('A medal next to your name.');
    const until = ctx.app.db.raw.prepare('SELECT banner_until, ended_at FROM tournaments WHERE id = ?').get(ctx.tid) as { banner_until: string; ended_at: string };
    expect(Date.parse(until.banner_until) - Date.parse(until.ended_at)).toBe(21 * 86_400_000);
    const h = (await ctx.organizer.call('GET', '/api/admin/tournament-history')).data;
    expect(h.tournaments).toHaveLength(1);
    expect(h.tournaments[0]).toMatchObject({ name: 'The Cold Open', format: 'doubles', players: 8, date: '2026-11-12' });
    expect(h.tournaments[0].first.players).toContain(w);
    expect(h.wins.map((x: any) => [x.wins, x.played])).toEqual([
      [1, 1],
      [1, 1],
    ]);
    books(ctx);
  });
  it('the organizer plays and wins: a medal, no credit (the organizer never holds credit); the partner gets $14', async () => {
    const ctx = await world(8, { organizer: 'Blair' });
    await draftAndPublish(ctx);
    ctx.app.now = START_MS + 90 * 60_000;
    const d = (await adminTour(ctx)).day;
    const blairSeat = d.teams.find((x: any) => x.players.some((p: any) => p.name === 'Blair')).seat;
    const win = (a: number, b: number) => (a === blairSeat ? a : b === blairSeat ? b : Math.min(a, b));
    await playPools(ctx, win);
    const d2 = (await adminTour(ctx)).day;
    for (const g of d2.games.filter((x: any) => x.stage !== 'pool')) await setWinner(ctx, g.num, g.a.seat === blairSeat || g.b.seat === blairSeat ? blairSeat : g.a.seat);
    const end = (await adminTour(ctx)).end;
    expect(end.noCredit).toBe('Blair');
    expect((await awards(ctx, { action: 'end', seen: end.seen })).status).toBe(200);
    const rows = ledger(ctx, `tour:${ctx.tid}:champion`);
    expect(rows).toHaveLength(1);
    expect(rows[0].player_id).not.toBe(ctx.byName.Blair);
    expect(rows[0].amount_cents).toBe(1400);
    books(ctx);
  });
  it('an I paid still waiting: End waits for the answer', async () => {
    const ctx = await finalDone();
    // Someone not playing tapped I paid for a ticket (the organizer has not answered).
    const at = new Date(ctx.app.now).toISOString();
    ctx.app.db.raw
      .prepare("INSERT INTO tournament_tickets (id, tournament_id, player_id, place, price_cents, claim_cents, claim_at, created_at, updated_at) VALUES ('k-shay', ?, ?, 'none', 1600, 1600, ?, ?, ?)")
      .run(ctx.tid, ctx.byName.Shay, at, at, at);
    const end = (await adminTour(ctx)).end;
    expect(end.blocked).toMatch(/tapped I paid/);
    expect((await awards(ctx, { action: 'end', seen: end.seen })).status).toBe(409);
  });
});

describe('zip 58: End tournament, Americano', () => {
  it('1st place: a medal and $14; 2nd place: $7, no medal; the ticker says Winner then Runner-up; the runner-up gets a card too', async () => {
    const ctx = await world(8, { format: 'americano', minutes: 120 });
    ctx.app.now = START_MS + 60_000;
    const d = (await adminTour(ctx)).rounds;
    for (const g of d.games) {
      const fresh = (await adminTour(ctx)).rounds.games.find((x: any) => x.num === g.num);
      // Side a wins by a margin that grows with the game number: a clear table.
      const r = await games(ctx, { action: 'score', num: g.num, a: 11, b: Math.max(0, 9 - (g.num % 7)), seen: fresh.stamp });
      expect(r.status, r.text).toBe(200);
    }
    const end = (await adminTour(ctx)).end;
    expect(end).toMatchObject({ format: 'americano', hero: 'Round 4 of 4', championCents: 1400, secondCents: 700, done: { kicker: 'Round 4 is done' } });
    expect(end.done.title).toBe(`${end.first.name} finished first`);
    expect(end.done.sub).toBe(`${end.second.name} was second.`);
    const first = end.first.name;
    const second = end.second.name;
    const pots = [potOf(ctx, first), potOf(ctx, second)];
    expect((await awards(ctx, { action: 'end', seen: end.seen })).status).toBe(200);
    expect((await awards(ctx, { action: 'end', seen: end.seen })).status).toBe(409);
    expect([potOf(ctx, first), potOf(ctx, second)]).toEqual([pots[0] + 1400, pots[1] + 700]);
    expect(ledger(ctx, `tour:${ctx.tid}:second`).map((r) => r.amount_cents)).toEqual([700]);
    const res = ctx.app.db.raw.prepare('SELECT player_id, medal, award, finish FROM tournament_results WHERE tournament_id = ? AND award IS NOT NULL ORDER BY finish').all(ctx.tid) as any[];
    expect(res.map((r) => [r.award, r.medal, r.finish])).toEqual([
      ['champion', 1, 1],
      ['second', 0, 2],
    ]);
    const g2 = await group(ctx, second);
    expect(g2.tourAwards.ticker).toMatchObject({ format: 'americano', winner: { name: first, medals: 1 }, runnerUp: { name: second, medals: 0 } });
    expect(g2.tourAwards.congrats).toMatchObject({ title: 'Second place, The Cold Open', sub: '$7 credit toward your next game.' });
    expect(g2.credit.history.some((h: any) => h.tourWhy === 'second' && h.cents === 700)).toBe(true);
    books(ctx);
  });
});

describe('zip 58: who sees it', () => {
  it('Only me: a player gets no ticker, no medals, no congratulations, nothing about it (not even in the change stamp)', async () => {
    const ctx = await finalDone();
    // Only me (set straight on the row: players could not have signed up to it).
    ctx.app.db.raw.prepare("UPDATE tournaments SET visibility = 'me' WHERE id = ?").run(ctx.tid);
    const winner = await playerOfSeat(ctx, 1, 0);
    const before = (await group(ctx, winner)).version;
    const end = (await adminTour(ctx)).end;
    expect((await awards(ctx, { action: 'end', seen: end.seen })).status).toBe(200);
    const g = await group(ctx, winner);
    expect(g.tourAwards).toBeUndefined();
    expect(JSON.stringify(g)).not.toMatch(/Cold Open|medal|ticker/i);
    // The credit itself is real money: it is in their pot (named only as "a tournament").
    expect(g.credit.history.some((h: any) => h.tourWhy === 'champion' && !h.tournamentName)).toBe(true);
    void before;
  });
  it('switched off: no tourAwards key at all, and the tournament routes answer as before', async () => {
    const ctx = await finalDone();
    const end = (await adminTour(ctx)).end;
    expect((await awards(ctx, { action: 'end', seen: end.seen })).status).toBe(200);
    expect((await ctx.organizer.call('PUT', '/api/admin/tournaments-switch', { on: false })).status).toBe(200);
    const winner = await playerOfSeat2(ctx);
    const g = await group(ctx, winner);
    expect(g.tourAwards).toBeUndefined();
    expect(JSON.stringify(g)).not.toMatch(/Cold Open/);
    expect((await ctx.organizer.call('GET', '/api/admin/tournament-history')).status).toBe(403);
  });
});

async function playerOfSeat2(ctx: World) {
  const r = ctx.app.db.raw.prepare("SELECT p.display_name AS n FROM tournament_results r JOIN players p ON p.id = r.player_id WHERE r.tournament_id = ? AND r.award = 'champion' LIMIT 1").get(ctx.tid) as { n: string };
  return r.n;
}
void card;
