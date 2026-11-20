import { describe, expect, it } from 'vitest';
import { playerPhone } from './harness';
import { adminTour, awards, books, card, draftAndPublish, potOf, START_MS, world, type World } from './zip58-world';

// Zip 72 (🎾72.scores), the AUDIT before shipping: 🎾69's dry run nights again, played to the end on the real server code with scores, and
// the money checked to the cent. Every result is a player's first score (or the organizer's, for a court with no phones). Each night:
//   - the money before the night (every ticket, every credit pot) is read; the night is played; End tournament grants the awards;
//   - afterward every pot is exactly what it was plus the award credit, and nothing else moved (tickets, ledger rows); the books checks read 0.
//   Night 1: 10 players, Locked doubles (5 teams, round robin on 2 courts), with a head-to-head tie between two teams level on wins, one game
//            entered by Alex (nobody in it has a phone), an Undo (nothing sent), and a second score refused.
//   Night 2: 9 players, Americano (an odd count plays Americano), every round's score from a player, 1st $14 and 2nd $7.
//   Night 3: 8 players, Locked doubles, a three-way circle settled by point difference (no wheel), then the Final and 3rd place.

const raw = (ctx: World) => ctx.app.db.raw;
/** Every ticket's money and every ledger row, as one string (anything that moves money changes it). */
const moneyPrint = (ctx: World) =>
  JSON.stringify([
    raw(ctx).prepare('SELECT player_id, place, price_cents, credit_cents, paid_cents, claim_cents FROM tournament_tickets ORDER BY player_id').all(),
    raw(ctx).prepare("SELECT player_id, kind, amount_cents, five_cents, reason, ended_at FROM credit_ledger WHERE COALESCE(reason, '') NOT LIKE 'tour:%:champion' AND COALESCE(reason, '') NOT LIKE 'tour:%:second' ORDER BY rowid").all(),
  ]);
const awardRows = (ctx: World) =>
  raw(ctx).prepare("SELECT player_id, amount_cents, reason FROM credit_ledger WHERE reason LIKE ? ORDER BY amount_cents DESC, player_id").all(`tour:${ctx.tid}:%`) as { player_id: string; amount_cents: number; reason: string }[];
const enter = async (ctx: World, name: string, body: Record<string, unknown>) => (await playerPhone(ctx, name)).call('POST', '/api/tournament/game', { tournamentId: ctx.tid, action: 'score', ...body });
const fix = (ctx: World, body: Record<string, unknown>) => ctx.organizer.call('POST', `/api/admin/tournament/${ctx.tid}/games`, body);
const nameOfSeat = (d: any, seat: number, i = 0) => d.teams.find((x: any) => x.seat === seat).players[i].name as string;
/** Every pot of every player, by name. */
const pots = (ctx: World) => Object.fromEntries(Object.keys(ctx.byName).map((n) => [n, potOf(ctx, n)]));

/** End tournament by the organizer's real tap, with the card as shown. Returns the award rows. */
async function endNight(ctx: World) {
  const end = (await adminTour(ctx)).end;
  expect(end, 'End tournament shows').toBeTruthy();
  const r = await awards(ctx, { action: 'end', seen: end.seen });
  expect(r.status, r.text).toBe(200);
  return { end, rows: awardRows(ctx) };
}

/**
 * Play every Locked doubles game still open, round by round, each by the first player of side a with `score(seatA, seatB)` (points of side a,
 * points of side b), except games `byOrganizer` (Alex enters them: nobody in it has a phone).
 */
async function playLocked(ctx: World, score: (a: number, b: number, stage: string) => [number, number], byOrganizer: (g: any) => boolean = () => false) {
  for (let guard = 0; guard < 40; guard++) {
    const d = (await adminTour(ctx)).day;
    const open = d.games.filter((g: any) => !g.winner && !g.skipped && g.a && g.b);
    if (!open.length) return;
    const round = Math.min(...open.map((g: any) => g.round));
    for (const g of open.filter((x: any) => x.round === round)) {
      const [x, y] = score(g.a.seat, g.b.seat, g.stage);
      const r = byOrganizer(g) ? await fix(ctx, { action: 'result', num: g.num, a: x, b: y }) : await enter(ctx, nameOfSeat(d, g.a.seat), { num: g.num, mine: x, theirs: y });
      expect(r.status, `game ${g.num}: ${r.text}`).toBe(200);
    }
  }
  throw new Error('the night never ended');
}

describe('zip 72 audit: the dry run nights, to the end, money to the cent', () => {
  it('Night 1: 10 players, Locked doubles: scores, a head-to-head tie, Alex enters a game with no phones, Undo, a second score refused; End grants $14 x 2', async () => {
    const ctx = await world(10);
    await draftAndPublish(ctx);
    ctx.app.now = START_MS + 60_000;
    const before = moneyPrint(ctx);
    const pot0 = pots(ctx);
    const d0 = (await adminTour(ctx)).day;
    expect(d0.teams).toHaveLength(5);
    // Undo: Vic's 5 seconds run on the phone and send nothing (no request); nothing is written, so anyone may be first after it.
    const g1 = d0.games[0];
    expect(raw(ctx).prepare('SELECT winner FROM tournament_games WHERE tournament_id = ? AND num = ?').get(ctx.tid, g1.num)).toMatchObject({ winner: null });
    // A second score is refused (the first one is the result).
    expect((await enter(ctx, nameOfSeat(d0, g1.a.seat), { num: g1.num, mine: 11, theirs: 6 })).status).toBe(200);
    const second = await enter(ctx, nameOfSeat(d0, g1.b.seat), { num: g1.num, mine: 11, theirs: 9 });
    expect(second.status).toBe(409);
    expect(second.text).toContain('Ask Alex to fix it.');
    // The pools: seat 1 beats everyone; 2 and 3 are level on wins (2-2) and 3 beat 2 by one point while 2 has the far better point difference:
    // head to head puts 3 above 2. 4 and 5 are 1-3 each; 5 beat 4. Every game that seat 5 plays is entered by Alex (no phones on that court).
    const t: Record<string, [number, number]> = { '2>4': [11, 0], '2>5': [11, 0], '3>2': [12, 10], '3>5': [11, 9], '4>3': [11, 9], '5>4': [11, 9] };
    const pool = (a: number, b: number): [number, number] => {
      if (a === 1) return [11, 6];
      if (b === 1) return [6, 11];
      if (t[`${a}>${b}`]) return t[`${a}>${b}`];
      const [w, l] = t[`${b}>${a}`];
      return [l, w];
    };
    await playLocked(ctx, (a, b, stage) => (stage === 'pool' ? pool(a, b) : [11, 8]), (g) => g.stage === 'pool' && (g.a.seat === 5 || g.b.seat === 5));
    const d = (await adminTour(ctx)).day;
    expect(d.ties ?? []).toEqual([]);
    const st = (await card(ctx, nameOfSeat(d, 1))).day.standings[0].rows;
    const seatOf = new Map((d.teams as any[]).map((x) => [x.name, x.seat]));
    expect(st.map((r: any) => seatOf.get(r.name))).toEqual([1, 3, 2, 5, 4]);
    expect(st.map((r: any) => r.record)).toEqual(['4-0', '2-2', '2-2', '1-3', '1-3']);
    // Alex's games carry his name as the one who set them; the others the player who entered them.
    expect(d.games.filter((g: any) => g.stage === 'pool' && (g.a.seat === 5 || g.b.seat === 5)).every((g: any) => g.resultBy === 'organizer')).toBe(true);
    // Every Locked doubles game has a score: pool, Final, 3rd place.
    const rows = raw(ctx).prepare('SELECT stage, score_a, score_b, winner FROM tournament_games WHERE tournament_id = ?').all(ctx.tid) as any[];
    expect(rows.every((r) => r.score_a !== null && r.score_b !== null && r.winner !== null)).toBe(true);
    expect(rows.map((r) => r.stage).sort()).toEqual([...Array(10).fill('pool'), 'final', 'third'].sort());
    // The money did not move during the night; End grants the champion credit to the Final's winners, once.
    expect(moneyPrint(ctx)).toBe(before);
    const { end, rows: award } = await endNight(ctx);
    expect(end.first.name).toBe(d.teams.find((x: any) => x.seat === 1).name);
    expect(award.map((r) => r.amount_cents)).toEqual([1400, 1400]);
    const champs = [nameOfSeat(d, 1, 0), nameOfSeat(d, 1, 1)];
    for (const [n, p] of Object.entries(pots(ctx))) expect(p, n).toBe(pot0[n] + (champs.includes(n) ? 1400 : 0));
    expect(moneyPrint(ctx)).toBe(before);
    books(ctx);
  });

  it('Night 2: 9 players, Americano: every round by a player\'s score; 1st gets $14, 2nd $7, to the cent', async () => {
    const ctx = await world(9);
    // After Pay by (world's clock), the first screen read settles the style: 9 locked in is odd, so Americano. Then the night starts.
    expect((await adminTour(ctx)).format).toBe('americano');
    ctx.app.now = START_MS + 60_000;
    expect((await adminTour(ctx)).format).toBe('americano');
    const before = moneyPrint(ctx);
    const pot0 = pots(ctx);
    for (let guard = 0; guard < 30; guard++) {
      const r = (await adminTour(ctx)).rounds;
      const open = r.games.filter((g: any) => g.status === 'playing');
      if (!open.length) break;
      for (const g of open) {
        const who = g.a.names[0];
        const mine = (await card(ctx, who)).day.rounds.find((x: any) => x.num === g.num);
        // Side a wins the lower game numbers by 11 to 4 + num % 6, side b the rest: a spread of wins and points.
        const aWins = g.num % 3 !== 0;
        const res = await enter(ctx, who, { num: g.num, key: mine.key, mine: aWins ? 11 : 4 + (g.num % 6), theirs: aWins ? 4 + (g.num % 6) : 11 });
        expect(res.status, res.text).toBe(200);
        // The other side cannot answer over it.
        const other = g.b.names[0];
        const theirs = (await card(ctx, other)).day.rounds.find((x: any) => x.num === g.num);
        expect((await enter(ctx, other, { num: g.num, key: theirs.key, mine: 11, theirs: 2 })).status).toBe(409);
      }
    }
    const r = (await adminTour(ctx)).rounds;
    expect(r.games.every((g: any) => g.status === 'done')).toBe(true);
    expect(moneyPrint(ctx)).toBe(before);
    const { end, rows: award } = await endNight(ctx);
    expect(award.map((x) => x.amount_cents)).toEqual([1400, 700]);
    const first = end.first.name as string;
    const secondName = end.second.name as string;
    for (const [n, p] of Object.entries(pots(ctx))) expect(p, n).toBe(pot0[n] + (n === first ? 1400 : n === secondName ? 700 : 0));
    expect(moneyPrint(ctx)).toBe(before);
    books(ctx);
  });

  it('Night 3: 8 players, Locked doubles: a three-way circle settled by point difference (no wheel); the Final and 3rd place; $14 x 2', async () => {
    const ctx = await world(8);
    await draftAndPublish(ctx);
    ctx.app.now = START_MS + 60_000;
    const before = moneyPrint(ctx);
    const pot0 = pots(ctx);
    const t: Record<string, [number, number]> = { '3>1': [11, 5], '3>2': [11, 9], '3>4': [11, 8], '1>4': [11, 3], '4>2': [11, 9], '2>1': [11, 9] };
    const pool = (a: number, b: number): [number, number] => (t[`${a}>${b}`] ? t[`${a}>${b}`] : [t[`${b}>${a}`][1], t[`${b}>${a}`][0]]);
    // The Final: side a (1st, Kitchen Crew's seat 3) loses 9 to 11 (an upset); 3rd place 11 to 7.
    await playLocked(ctx, (a, b, stage) => (stage === 'pool' ? pool(a, b) : stage === 'final' ? [9, 11] : [11, 7]));
    const d = (await adminTour(ctx)).day;
    expect(d.ties ?? []).toEqual([]);
    expect(d.games.some((g: any) => g.stage === 'tie')).toBe(false);
    const fin = d.games.find((g: any) => g.stage === 'final');
    expect([fin.a.seat, fin.b.seat, fin.winner]).toEqual([3, 1, 'b']);
    const third = d.games.find((g: any) => g.stage === 'third');
    expect([third.a.seat, third.b.seat]).toEqual([2, 4]);
    expect(moneyPrint(ctx)).toBe(before);
    const { end, rows: award } = await endNight(ctx);
    expect(end.first.name).toBe(d.teams.find((x: any) => x.seat === 1).name);
    expect(award.map((x) => x.amount_cents)).toEqual([1400, 1400]);
    const champs = [nameOfSeat(d, 1, 0), nameOfSeat(d, 1, 1)];
    for (const [n, p] of Object.entries(pots(ctx))) expect(p, n).toBe(pot0[n] + (champs.includes(n) ? 1400 : 0));
    // The saved finish order follows the night: the champions, the Final's losers, 3rd place's winners, then 4th.
    const res = raw(ctx).prepare('SELECT player_id, finish FROM tournament_results WHERE tournament_id = ? ORDER BY finish, player_id').all(ctx.tid) as any[];
    const finishOf = (seat: number) => res.find((x) => x.player_id === ctx.byName[nameOfSeat(d, seat)]).finish;
    expect([finishOf(1), finishOf(3), finishOf(2), finishOf(4)]).toEqual([1, 2, 3, 4]);
    expect(moneyPrint(ctx)).toBe(before);
    books(ctx);
  });
});
