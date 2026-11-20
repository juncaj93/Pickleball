import { describe, expect, it } from 'vitest';
import { playerPhone } from './harness';
import { adminTour, awards, books, card, group, potOf, START_MS, world, type World } from './zip58-world';
import { REVEAL_HOLD_MS, REVEAL_LEAD_MS, revealPhase, revealPlan } from '../shared/reveal';
import { LivePoller, LIVE_UPDATES } from '../src/livecore';

// Zip 77 (🎾77.reveal): Americano's hidden standings and the standings reveal, on the real server code.
//   - During the night a player's answer carries no table at all (not even in the JSON); the organizer's own signed-in phone keeps it live.
//   - Every game in: `waiting` (the "Final standings coming soon" card); still no table.
//   - Reveal standings is End tournament's same action (credit once, history, medals) and its ended_at is the reveal's clock. The players in the
//     night then get the board: the saved order, `reveal.tapMs`, the number of rows. Until the hold ends nothing at the top of Home tells the
//     winner: no ticker, no congratulations, no medal, no award credit in the chip or the history. Then everything, to the cent.
//   - The timeline: the mock's numbers for 10 players; about 28 s for 9.
//   - Locked doubles is unchanged (its players still see the standings).

const raw = (ctx: World) => ctx.app.db.raw;
const enter = async (ctx: World, name: string, body: Record<string, unknown>) => (await playerPhone(ctx, name)).call('POST', '/api/tournament/game', { tournamentId: ctx.tid, action: 'score', ...body });
const pots = (ctx: World) => Object.fromEntries(Object.keys(ctx.byName).map((n) => [n, potOf(ctx, n)]));
const moneyPrint = (ctx: World) =>
  JSON.stringify([
    raw(ctx).prepare('SELECT player_id, place, price_cents, credit_cents, paid_cents, claim_cents FROM tournament_tickets ORDER BY player_id').all(),
    raw(ctx).prepare("SELECT player_id, kind, amount_cents, reason, ended_at FROM credit_ledger WHERE COALESCE(reason, '') NOT LIKE 'tour:%:champion' AND COALESCE(reason, '') NOT LIKE 'tour:%:second' ORDER BY rowid").all(),
  ]);

/** Every Americano game by a player's first score (side a wins most, by a spread of margins), until every round is in. */
async function playAll(ctx: World, upTo = Infinity) {
  for (let guard = 0; guard < 40; guard++) {
    const r = (await adminTour(ctx)).rounds;
    const open = r.games.filter((g: any) => g.status === 'playing' && g.round <= upTo);
    if (!open.length) return;
    for (const g of open) {
      const who = g.a.names[0];
      const mine = (await card(ctx, who)).day.rounds.find((x: any) => x.num === g.num);
      const aWins = g.num % 3 !== 0;
      const res = await enter(ctx, who, { num: g.num, key: mine.key, mine: aWins ? 11 : 4 + (g.num % 6), theirs: aWins ? 4 + (g.num % 6) : 11 });
      expect(res.status, res.text).toBe(200);
    }
  }
  throw new Error('the night never ended');
}

/** The organizer's own phone, signed in as the organizer and with their own name picked (Blair, in these nights). */
async function organizerPhone(ctx: World, name: string) {
  const c = ctx.organizer;
  c.groupKey = ctx.groupKey;
  expect((await c.call('POST', '/api/me', { playerId: ctx.byName[name] })).status).toBe(200);
  return c;
}

/** Nothing in a player's answer names a place, a record or points of anyone (their own rounds' scores are theirs). */
function noTable(tour: any) {
  expect(tour.day.standings).toEqual([]);
  expect(tour.day.standingsHidden).toBe(true);
  const text = JSON.stringify(tour);
  expect(text).not.toMatch(/"points"|"record"|"rank"/);
}

async function nightOf9() {
  const ctx = await world(9, { format: 'americano', organizer: 'Blair' });
  expect((await adminTour(ctx)).format).toBe('americano');
  ctx.app.now = START_MS + 60_000;
  return ctx;
}

describe('zip 77: hidden standings during the night', () => {
  it('a player gets no table at all (the JSON has no points, records or ranks); the organizer’s own phone keeps it live; View as a player does not', async () => {
    const ctx = await nightOf9();
    await playAll(ctx, 2);
    const vic = await card(ctx, 'Casey');
    noTable(vic);
    expect(vic.day.waiting).toBeUndefined();
    expect(vic.day.rounds.filter((r: any) => r.state === 'done').every((r: any) => r.score)).toBe(true);
    // The whole answer, as the phone receives it: nothing of the table anywhere (the version check is a hash).
    const whole = (await (await playerPhone(ctx, 'Casey')).call('GET', '/api/group')).text;
    expect(whole).not.toMatch(/"standings":\[\{/);
    // The organizer's own player on the organizer's own signed-in phone: the live table (he catches wrong scores there).
    const org = await organizerPhone(ctx, 'Blair');
    const mine = (await org.call('GET', '/api/group')).data.tournament.day;
    expect(mine.standings).toHaveLength(9);
    expect(mine.standingsHidden).toBeUndefined();
    expect(mine.standings.reduce((s: number, r: any) => s + r.points, 0)).toBeGreaterThan(0);
    // View as another player (the organizer's demo of their screen): what that player sees, hidden.
    const asCasey = (await ctx.organizer.call('GET', '/api/group', undefined, { 'X-View-As': ctx.byName.Casey })).data.tournament;
    noTable(asCasey);
    // View as the organizer's own player: live.
    const asBlair = (await ctx.organizer.call('GET', '/api/group', undefined, { 'X-View-As': ctx.byName.Blair })).data.tournament;
    expect(asBlair.day.standings).toHaveLength(9);
    books(ctx);
  });

  it('every game in: waiting (the coming soon card), still no table; the organizer’s End card says Reveal’s rows', async () => {
    const ctx = await nightOf9();
    await playAll(ctx);
    const t = await card(ctx, 'Casey');
    noTable(t);
    expect(t.day.waiting).toBe(true);
    expect(t.day.progress.label).toBe('Done');
    const end = (await adminTour(ctx)).end;
    expect(end).toMatchObject({ format: 'americano', championCents: 1400, secondCents: 700 });
  });

  it('Locked doubles is unchanged: its players see the standings', async () => {
    const { draftAndPublish, playPools } = await import('./zip58-world');
    const ctx = await world(8);
    await draftAndPublish(ctx);
    ctx.app.now = START_MS + 60_000;
    await playPools(ctx, (a, b) => Math.min(a, b));
    const d = (await card(ctx, 'Casey')).day;
    expect(d.standings.length).toBeGreaterThan(0);
    expect(d.standingsHidden).toBeUndefined();
    expect(d.waiting).toBeUndefined();
  });
});

describe('zip 77: Reveal standings', () => {
  it('the same End (credit once, to the cent); the board for the players in it; nothing tells the winner until the hold ends; then all of it', async () => {
    const ctx = await nightOf9();
    const before = moneyPrint(ctx);
    const pot0 = pots(ctx);
    await playAll(ctx);
    const end = (await adminTour(ctx)).end;
    const first = end.first.name as string;
    const second = end.second.name as string;
    const v0 = (await group(ctx, first)).version;
    const tapMs = ctx.app.now;
    expect((await awards(ctx, { action: 'end', seen: end.seen })).status).toBe(200);
    // A double tap or a retry: nothing more (credit once).
    expect((await awards(ctx, { action: 'end', seen: end.seen })).status).toBe(409);
    for (const [n, p] of Object.entries(pots(ctx))) expect(p, n).toBe(pot0[n] + (n === first ? 1400 : n === second ? 700 : 0));
    expect(moneyPrint(ctx)).toBe(before);
    books(ctx);
    // The reveal's clock is the tap (ended_at).
    expect(raw(ctx).prepare('SELECT status, ended_at FROM tournaments WHERE id = ?').get(ctx.tid)).toMatchObject({ status: 'ended', ended_at: new Date(tapMs).toISOString() });

    // The winner's phone: the board's data, in the saved order, and nothing else that tells it.
    const g = await group(ctx, first);
    expect(g.version).not.toBe(v0);
    expect(g.tournament).toMatchObject({ status: 'ended', format: 'americano', reveal: { tapMs, players: 9 } });
    const board = g.tournament.day.standings;
    expect(board).toHaveLength(9);
    expect(board[0]).toMatchObject({ rank: 1, name: first, me: true });
    expect(board[1]).toMatchObject({ rank: 2, name: second });
    const saved = raw(ctx).prepare('SELECT p.display_name AS name FROM tournament_results r JOIN players p ON p.id = r.player_id WHERE r.tournament_id = ? ORDER BY r.finish').all(ctx.tid) as { name: string }[];
    expect(board.map((r: any) => r.name)).toEqual(saved.map((r) => r.name));
    expect(JSON.stringify(g.tournament)).not.toMatch(/cents|\$/i);
    expect(g.tournament.day.final).toBe(true);
    expect(g.tourAwards?.ticker).toBeUndefined();
    expect(g.tourAwards?.congrats).toBeUndefined();
    expect(g.tourAwards?.medals?.[first]).toBeUndefined();
    // The award credit waits on the screen (the money is in the ledger already).
    expect(g.credit.balanceCents).toBe(pot0[first]);
    expect(g.credit.history.some((h: any) => h.tourWhy === 'champion')).toBe(false);
    const g2 = await group(ctx, second);
    expect(g2.credit.balanceCents).toBe(pot0[second]);
    expect(g2.tourAwards?.congrats).toBeUndefined();
    // Someone who was not in the night: no card, no ticker yet.
    const outsider = await group(ctx, 'Shay');
    expect(outsider.tournament).toBeUndefined();
    expect(outsider.tourAwards?.ticker).toBeUndefined();

    // The hold ends: the ticker, the congratulations, the medal and the credit, and the version changed so every phone loads them.
    const v1 = (await group(ctx, first)).version;
    ctx.app.now = tapMs + REVEAL_HOLD_MS;
    const after = await group(ctx, first);
    expect(after.version).not.toBe(v1);
    expect(after.tourAwards.ticker).toMatchObject({ format: 'americano', winner: { name: first } });
    expect(after.tourAwards.congrats.title).toBe('You won The Cold Open');
    expect(after.tourAwards.medals[first]).toBe(1);
    expect(after.credit.balanceCents).toBe(pot0[first] + 1400);
    expect(after.credit.history.some((h: any) => h.tourWhy === 'champion' && h.cents === 1400)).toBe(true);
    expect((await group(ctx, second)).credit.balanceCents).toBe(pot0[second] + 700);
    expect((await group(ctx, second)).tourAwards.congrats.title).toBe('Second place, The Cold Open');
    // The night's card stays (the final standings) for the night, then Home is back to normal.
    expect(after.tournament.status).toBe('ended');
    ctx.app.now = tapMs + 6 * 3_600_000 + 60_000;
    expect((await group(ctx, first)).tournament).toBeUndefined();
    books(ctx);
  });

  it('Edit awards (1st and 2nd swapped): the board shows the saved order, not the table', async () => {
    const ctx = await nightOf9();
    await playAll(ctx);
    const end = (await adminTour(ctx)).end;
    const save = await awards(ctx, { action: 'save', first: end.second.key, second: end.first.key, championCents: 1400, secondCents: 700, weeks: 1 });
    expect(save.status, save.text).toBe(200);
    const end2 = (await adminTour(ctx)).end;
    expect((await awards(ctx, { action: 'end', seen: end2.seen })).status).toBe(200);
    const board = (await card(ctx, end.first.name)).day.standings;
    expect(board.slice(0, 2).map((r: any) => r.name)).toEqual([end.second.name, end.first.name]);
  });

  it('the version check carries the server clock (t, the real time)', async () => {
    const ctx = await nightOf9();
    const r = await (await playerPhone(ctx, 'Casey')).call('GET', '/api/group/version');
    expect(r.data).toMatchObject({ t: ctx.app.now });
    expect(typeof r.data.v).toBe('string');
  });
});

describe('zip 77: the timeline (shared/reveal.ts)', () => {
  it('10 players: the mock’s numbers', () => {
    const p = revealPlan(10);
    expect(p.at.slice(1).map((x) => Number(x.toFixed(2)))).toEqual([24.6, 20.4, 17.8, 15.6, 13.8, 12.2, 10.6, 9, 7.5, 6]);
    expect(p.drum[1]).toBeCloseTo(22.6);
    expect(p.drum[2]).toBeCloseTo(19.7);
    expect(Number(p.x.toFixed(2))).toBe(27.4);
  });
  it('9 players: last 3 at 1.5 s, about 28 s from the tap; more than 10: 1.0 s below 7th', () => {
    const p = revealPlan(9);
    expect(p.at[8] - p.at[9]).toBeCloseTo(1.5);
    expect(p.at[7] - p.at[8]).toBeCloseTo(1.5);
    expect(p.at[6] - p.at[7]).toBeCloseTo(1.6);
    const total = REVEAL_LEAD_MS / 1000 + p.end;
    expect(total).toBeGreaterThan(27);
    expect(total).toBeLessThan(30);
    const big = revealPlan(14);
    expect(big.at[13] - big.at[14]).toBeCloseTo(1);
    expect(big.at[8] - big.at[9]).toBeCloseTo(1);
    expect(big.at[7] - big.at[8]).toBeCloseTo(1.6);
    expect(REVEAL_HOLD_MS).toBeGreaterThanOrEqual(REVEAL_LEAD_MS + revealPlan(16).end * 1000);
  });
  it('phase: before T0, playing, done', () => {
    expect(revealPhase(0, 9, 2_000).phase).toBe('before');
    expect(revealPhase(0, 9, 4_000)).toMatchObject({ phase: 'playing', t: 1 });
    expect(revealPhase(0, 9, 3_000 + revealPlan(9).end * 1000).phase).toBe('done');
  });
});

describe('zip 77: the 2 second check', () => {
  it('while the waiting card shows, every 2 s whatever the person does (no slow-down, no stop); then the usual rhythm', async () => {
    let now = 0;
    const timers: { at: number; fn: () => void }[] = [];
    let checks = 0;
    const p = new LivePoller({
      now: () => now,
      setTimer: (fn, ms) => {
        const t = { at: now + ms, fn };
        timers.push(t);
        return t;
      },
      clearTimer: (t) => {
        const i = timers.indexOf(t as never);
        if (i >= 0) timers.splice(i, 1);
      },
      fetchStamp: async () => {
        checks++;
        return 'same';
      },
      onChange: () => undefined,
      isVisible: () => true,
    });
    const run = async (until: number) => {
      for (;;) {
        timers.sort((a, b) => a.at - b.at);
        const t = timers[0];
        if (!t || t.at > until) break;
        timers.shift();
        now = t.at;
        t.fn();
        await new Promise((r) => setTimeout(r, 0));
      }
      now = until;
    };
    p.setKnown('same');
    p.start();
    p.setFast(2000);
    // 30 minutes without a touch: still every 2 seconds.
    await run(30 * 60_000);
    expect(checks).toBeGreaterThanOrEqual(899);
    p.setFast(null);
    const at = checks;
    await run(30 * 60_000 + LIVE_UPDATES.stopAfterMs);
    expect(checks).toBe(at);
    p.stop();
  });
});
