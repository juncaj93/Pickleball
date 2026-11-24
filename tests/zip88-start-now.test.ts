import { describe, expect, it } from 'vitest';
import { playerPhone } from './harness';
import { adminTour, books, card, draftAndPublish, START_MS, teams, type World, world } from './zip58-world';

// Zip 88 (Alex): START NOW. On game day, once the teams are published (Locked doubles) and the courts' numbers are set, the organizer's card
// pill is "Start now"; the tap starts the night at once (the night card, games on the courts, players can enter scores). Not tapped: the
// night starts at its start time. Money (court cost, tickets, prizes) and the planned end never change. No migration: one task_log row.
// And TEAM NAMES: a player can rename their team until their team's first game has a score.

const GAME_DAY_MORNING = START_MS - 9 * 3_600_000; // Thu Nov 12, 10:30 AM Eastern
const start = (ctx: World) => ctx.organizer.call('POST', `/api/admin/tournament/${ctx.tid}/games`, { action: 'start' });
/** Everything money: every credit row and ticket, and the organizer's money line and cost. */
async function money(ctx: World) {
  const t = await adminTour(ctx);
  return JSON.stringify([
    ctx.app.db.raw.prepare('SELECT * FROM credit_ledger ORDER BY rowid').all(),
    ctx.app.db.raw.prepare('SELECT * FROM tournament_tickets ORDER BY rowid').all(),
    // The amounts (the money line's `closed` flag does flip: tickets close when the night starts).
    { ...t.money, closed: undefined },
    t.cost,
    t.start,
    t.minutes,
    t.championCreditCents,
    t.secondCreditCents,
  ]);
}

describe('zip 88: Start now', () => {
  it('Locked doubles: offered only on game day with teams and courts set; the tap starts the night at once; money and the end unchanged', async () => {
    const ctx = await world(10, { format: 'doubles' });
    await draftAndPublish(ctx);
    // The day before: no Start now.
    expect((await adminTour(ctx)).startNow).toBeUndefined();
    ctx.app.now = GAME_DAY_MORNING;
    // Game day, courts not set yet: no Start now, and the server refuses.
    expect((await adminTour(ctx)).startNow).toBeUndefined();
    expect((await start(ctx)).status).toBe(409);
    expect((await teams(ctx, { action: 'courts', numbers: [9, 10] })).status).toBe(200);
    const before = await adminTour(ctx);
    expect(before.startNow).toBe(true);
    expect(before.day.started).toBe(false);
    const name = before.day.teams[0].players[0].name;
    expect((await card(ctx, name)).day.started).toBe(false);
    // Not started yet: a score is refused as before.
    const g1 = before.day.games[0];
    const early = await (await playerPhone(ctx, g1.a.players[0])).call('POST', '/api/tournament/game', { tournamentId: ctx.tid, num: g1.num, action: 'score', mine: 11, theirs: 4 });
    expect(early.status).toBe(409);
    const m0 = await money(ctx);
    // The tap.
    ctx.app.now += 60_000;
    const r = await start(ctx);
    expect(r.status, r.text).toBe(200);
    const after = await adminTour(ctx);
    expect(after.startNow).toBeUndefined();
    expect(after.startedEarly).toBe(new Date(ctx.app.now).toISOString());
    expect(after.day.started).toBe(true);
    // The night card's courts: Games 1 and 2 on, nothing in yet ("0 of 2 in").
    expect(after.day.courtsNow.map((c: any) => c.num)).toEqual([1, 2]);
    expect(after.timeOpen).toBe(false);
    expect(after.planOpen).toBe(false);
    // Money, the planned start and the end: exactly as before.
    expect(await money(ctx)).toBe(m0);
    // Players: their game is on its court with Enter score at once, and the score goes in.
    const mine = (await card(ctx, g1.a.players[0])).day;
    expect(mine.started).toBe(true);
    expect(mine.today).toBe(true);
    expect(mine.games.find((g: any) => g.num === g1.num)).toMatchObject({ onNow: true, court: 9 });
    const s = await (await playerPhone(ctx, g1.a.players[0])).call('POST', '/api/tournament/game', { tournamentId: ctx.tid, num: g1.num, action: 'score', mine: 11, theirs: 4 });
    expect(s.status, s.text).toBe(200);
    // A second tap (another phone) changes nothing.
    const again = await start(ctx);
    expect(again.status).toBe(200);
    expect((await adminTour(ctx)).startedEarly).toBe(after.startedEarly);
    expect(Number((ctx.app.db.raw.prepare("SELECT COUNT(*) AS n FROM task_log WHERE task LIKE 'tournament_start:%'").get() as any).n)).toBe(1);
    // History says so.
    const { activityText } = await import('../shared/activity');
    const entries = (await ctx.organizer.call('GET', '/api/admin/activity')).data.entries as any[];
    expect(entries.map((e) => activityText(e, 'America/Detroit', 'Alex'))).toContain('Alex started The Cold Open early');
    books(ctx);
  });

  it('Americano: Start now with the courts set; scores open at once; the reveal and the money work as on any night', async () => {
    const ctx = await world(10, { format: 'americano' });
    ctx.app.now = GAME_DAY_MORNING;
    expect((await adminTour(ctx)).startNow).toBeUndefined();
    expect((await teams(ctx, { action: 'courts', numbers: [1, 2] })).status).toBe(200);
    expect((await adminTour(ctx)).startNow).toBe(true);
    const m0 = await money(ctx);
    expect((await start(ctx)).status).toBe(200);
    const r = (await adminTour(ctx)).rounds;
    expect(r.started).toBe(true);
    expect(r.games.filter((g: any) => g.status === 'playing')).toHaveLength(2);
    const g = r.games[0];
    const phone = await playerPhone(ctx, g.a.names[0]);
    const key = (await phone.call('GET', '/api/group')).data.tournament.day.rounds.find((x: any) => x.num === g.num).key;
    expect((await phone.call('POST', '/api/tournament/game', { tournamentId: ctx.tid, num: g.num, key, action: 'score', mine: 11, theirs: 6 })).status).toBe(200);
    expect(await money(ctx)).toBe(m0);
    books(ctx);
  });

  it('not tapped: the night starts at its start time as before', async () => {
    const ctx = await world(8, { format: 'doubles' });
    await draftAndPublish(ctx);
    expect((await teams(ctx, { action: 'courts', numbers: [1, 2] })).status).toBe(200);
    ctx.app.now = START_MS - 60_000;
    expect((await adminTour(ctx)).day.started).toBe(false);
    ctx.app.now = START_MS + 1;
    const t = await adminTour(ctx);
    expect(t.day.started).toBe(true);
    expect(t.startNow).toBeUndefined();
    expect(t.startedEarly).toBeUndefined();
  });
});

describe('zip 88: team names until the first score', () => {
  it('the pencil stays after the start until their first game has a score; Alex renames any time; names stay unique', async () => {
    const ctx = await world(8, { format: 'doubles' });
    await draftAndPublish(ctx);
    ctx.app.now = START_MS + 5 * 60_000;
    const d = (await adminTour(ctx)).day;
    // A team whose first game is on now, and one sitting (8 players: every team plays Round 1; use the second game's team).
    const g1 = d.games[0];
    const a = g1.a.players[0];
    const ph = await playerPhone(ctx, a);
    expect((await card(ctx, a)).day.team.canRename).toBe(true);
    expect((await ph.call('POST', '/api/tournament/team-name', { tournamentId: ctx.tid, name: 'Dink Dynasty' })).status).toBe(200);
    // Another team's name is refused (unique, any case).
    expect((await ph.call('POST', '/api/tournament/team-name', { tournamentId: ctx.tid, name: d.teams.find((x: any) => !x.players.some((p: any) => p.name === a)).name.toUpperCase() })).status).toBe(409);
    // The first score: the pencil goes for that team (both partners) and the other team in that game.
    expect((await ph.call('POST', '/api/tournament/game', { tournamentId: ctx.tid, num: g1.num, action: 'score', mine: 11, theirs: 8 })).status).toBe(200);
    expect((await card(ctx, a)).day.team.canRename).toBeUndefined();
    expect((await card(ctx, g1.a.players[1])).day.team.canRename).toBeUndefined();
    expect((await card(ctx, g1.b.players[0])).day.team.canRename).toBeUndefined();
    expect((await ph.call('POST', '/api/tournament/team-name', { tournamentId: ctx.tid, name: 'Too Late' })).status).toBe(409);
    // A team whose first game has no score yet keeps it.
    const g2 = d.games[1];
    expect((await card(ctx, g2.a.players[0])).day.team.canRename).toBe(true);
    // The organizer renames any team any time.
    const team = (await adminTour(ctx)).day.teams.find((x: any) => x.players.some((p: any) => p.name === a));
    expect((await teams(ctx, { action: 'rename', teamId: team.id, name: 'Late Bloomers' })).status).toBe(200);
    expect((await card(ctx, a)).day.team.name).toBe('Late Bloomers');
  });
});

describe('zip 88: Games start soon on the players phones', () => {
  it('game day before the start: startsSoon with the planned start; not the day before; gone at the start or at Start now', async () => {
    for (const format of ['americano', 'doubles'] as const) {
      const ctx = await world(10, { format });
      if (format === 'doubles') await draftAndPublish(ctx);
      const who = format === 'doubles' ? (await adminTour(ctx)).day.teams[0].players[0].name : 'Blair';
      expect((await card(ctx, who)).day.startsSoon).toBeUndefined();
      ctx.app.now = START_MS - 20 * 60_000;
      expect((await card(ctx, who)).day.startsSoon).toEqual({ startsAt: new Date(START_MS).toISOString() });
      ctx.app.now = GAME_DAY_MORNING;
      expect((await card(ctx, who)).day.startsSoon).toEqual({ startsAt: new Date(START_MS).toISOString() });
      expect((await teams(ctx, { action: 'courts', numbers: [1, 2] })).status).toBe(200);
      expect((await start(ctx)).status).toBe(200);
      const after = (await card(ctx, who)).day;
      expect(after.startsSoon).toBeUndefined();
      expect(after.started).toBe(true);
      // No Start now: gone at the start time.
      const ctx2 = await world(8, { format });
      if (format === 'doubles') await draftAndPublish(ctx2);
      const who2 = format === 'doubles' ? (await adminTour(ctx2)).day.teams[0].players[0].name : 'Blair';
      ctx2.app.now = START_MS + 1;
      expect((await card(ctx2, who2)).day.startsSoon).toBeUndefined();
    }
  });

  it('the countdown words', async () => {
    const { countdownText } = await import('../shared/reveal');
    expect(countdownText(24 * 60_000 + 10_000)).toBe('24:10');
    expect(countdownText(30 * 60_000)).toBe('30:00');
    expect(countdownText(59_001)).toBe('1:00');
    expect(countdownText(500)).toBe('0:01');
    expect(countdownText(-5)).toBe('0:00');
  });
});
