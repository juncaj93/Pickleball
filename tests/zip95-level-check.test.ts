// Zip 95 (🎾95.level check), on the real server code with the preview's own stages and fixed names:
//   1. the Level check card after a tournament ends: who qualifies (80% or more of at least 3 regular games, or the champion; never 3.6+, never
//      the organizer), the gray line's words, Yes (Save) and No (one task_log row each, written once), gone when all are answered or 3 days on;
//      playoff and tie games never count; Locked doubles and Americano; Only me never;
//   2. the next sign-up: RECOMMENDED for the level Alex saved, the previous level still picked; only for the NEXT tournament signed up for;
//      nothing when it equals the previous level; nothing for a No;
//   3. Alex's speed rule: admin Home 4 trips, its 5 second check 2, every answer byte for byte the plain way's.
import { describe, expect, it, vi } from 'vitest';
import { PIN, playerPhone, setupGroup } from './harness';
import { activityText } from '../shared/activity';
import type { ActivityEntry } from '../shared/api';
import { levelCheckLine, levelsAbove, qualifies, savedLevel } from '../shared/levelCheck';
import { handleApi } from '../server/app';
import { createNodeD1 } from '../dev/nodeD1';
import { type Counted, countingDb } from '../dev/countingDb';
import { buildSmallPreview } from '../scripts/preview-world-small';
import { previewPin } from '../scripts/seed-preview-world';

vi.setConfig({ testTimeout: 300_000 });

const NAMES = ['Alex', 'Parker', 'Rowan', 'Sage', 'Christopher Vanderberg', 'Vic', 'Wren', 'Zoe', 'Quinn', 'Reese'];
/** Wed Dec 2, 2026, 10:00 AM Eastern (The Cold Open was the night before). */
const MORNING = Date.parse('2026-12-02T15:00:00.000Z');
const DAY = 86_400_000;

async function previewWorld(extra: string[] = []) {
  const ctx = await setupGroup();
  await ctx.organizer.call('PUT', '/api/admin/group', { organizerName: 'Alex' });
  ctx.app.env.PREVIEW_CALM = 'on';
  const byName: Record<string, string> = {};
  for (const n of [...NAMES, ...extra]) await ctx.organizer.call('POST', '/api/admin/players', { name: n });
  for (const p of (await ctx.organizer.call('GET', '/api/admin/dashboard')).data.players as { id: string; name: string }[]) byName[p.name] = p.id;
  ctx.app.now = MORNING;
  // Five weeks after setup: the organizer signs in again.
  expect((await ctx.organizer.call('POST', '/api/admin/login', { pin: PIN })).status).toBe(200);
  const c = { ...ctx, byName };
  const stage = async (s: string) => {
    const r = await ctx.organizer.call('POST', '/api/admin/tournament-test', { stage: s });
    expect(r.status, r.text).toBe(200);
    return r.data.id as string;
  };
  const card = async () => (await ctx.organizer.call('GET', '/api/admin/dashboard')).data.levelCheck;
  const tour = async (name: string) => (await (await playerPhone(c, name)).call('GET', '/api/group')).data.tournament;
  const sql = (q: string, ...args: unknown[]) => (ctx.app.db as any).raw.prepare(q).run(...args);
  const all = (q: string, ...args: unknown[]) => (ctx.app.db as any).raw.prepare(q).all(...args);
  const save = (tournamentId: string, name: string, level: number | null) =>
    ctx.organizer.call('POST', '/api/admin/level-check', { tournamentId, playerId: byName[name], level });
  return { ctx, c, byName, stage, card, tour, sql, all, save };
}

describe('zip 95: the rules', () => {
  it('80% or more of at least 3 regular games, or the champion; never the top level', () => {
    expect(qualifies({ played: 5, won: 5, champion: false, level: 300 })).toBe(true);
    expect(qualifies({ played: 5, won: 4, champion: false, level: 320 })).toBe(true);
    expect(qualifies({ played: 5, won: 3, champion: false, level: 320 })).toBe(false);
    expect(qualifies({ played: 3, won: 3, champion: false, level: 300 })).toBe(true);
    expect(qualifies({ played: 2, won: 2, champion: false, level: 300 })).toBe(false);
    expect(qualifies({ played: 5, won: 2, champion: true, level: 300 })).toBe(true);
    expect(qualifies({ played: 5, won: 5, champion: true, level: 360 })).toBe(false);
    expect(qualifies({ played: 5, won: 5, champion: true, level: null })).toBe(false);
    expect(qualifies({ played: 10, won: 8, champion: false, level: 350 })).toBe(true);
    expect(qualifies({ played: 9, won: 7, champion: false, level: 350 })).toBe(false);
  });
  it('the gray line and the levels above', () => {
    expect(levelCheckLine({ played: 5, won: 5, champion: false, level: 300 })).toBe('3.0 · won all 5 games');
    expect(levelCheckLine({ played: 5, won: 4, champion: true, level: 320 })).toBe('3.2 · won 4 of 5, champion');
    expect(levelCheckLine({ played: 0, won: 0, champion: true, level: 275 })).toBe('2.7 · champion');
    expect(levelsAbove(300)).toEqual([320, 340, 350, 360]);
    expect(levelsAbove(350)).toEqual([360]);
    expect(savedLevel('320')).toBe(320);
    expect(savedLevel('no')).toBeNull();
    expect(savedLevel('333')).toBeNull();
  });
});

describe('zip 95 part 1: the Level check card', () => {
  it('Locked doubles: Vic 5-0 and Wren 4-1 champion; not Parker (3.6+), Alex (the organizer), Rowan and Zoe (3-2); until 3 days after the end', async () => {
    const w = await previewWorld();
    const id = await w.stage('zip95_check');
    const card = await w.card();
    expect(card).toMatchObject({ tournamentId: id, name: 'The Cold Open' });
    expect(card.rows.map((r: any) => [r.name, r.level, r.line])).toEqual([
      ['Vic', 300, '3.0 · won all 5 games'],
      ['Wren', 320, '3.2 · won 4 of 5, champion'],
    ]);
    const ended = w.all('SELECT ended_at FROM tournaments WHERE id = ?', id)[0].ended_at as string;
    expect(card.until).toBe(new Date(Date.parse(ended) + 3 * DAY).toISOString());
    // Nobody's level reaches a player's answer.
    expect(JSON.stringify(await w.tour('Vic'))).not.toMatch(/levelCheck|recommended|Level check/i);
    // Three days after the end: gone, and a late answer is refused.
    w.ctx.app.now = Date.parse(ended) + 3 * DAY + 60_000;
    expect(await w.card()).toBeUndefined();
    expect((await w.save(id, 'Vic', 320)).status).toBe(409);
    w.ctx.app.now = Date.parse(ended) + 3 * DAY - 60_000;
    expect((await w.card()).rows).toHaveLength(2);
  });

  it('Yes (Save) and No: one row each, written once; the card goes when all are answered; wrong levels and other players are refused', async () => {
    const w = await previewWorld();
    const id = await w.stage('zip95_check');
    // Not a level above theirs, not a level, a player the card does not ask about.
    expect((await w.save(id, 'Vic', 300)).status).toBe(400);
    expect((await w.save(id, 'Vic', 310)).status).toBe(400);
    expect((await w.save(id, 'Rowan', 360)).status).toBe(409);
    expect((await w.save(id, 'Parker', null)).status).toBe(409);
    const yes = await w.save(id, 'Vic', 320);
    expect(yes.status, yes.text).toBe(200);
    expect(yes.data.changed).toBe(true);
    expect((await w.card()).rows.map((r: any) => r.name)).toEqual(['Wren']);
    // A second tap (or another phone) changes nothing: the first answer stands.
    const again = await w.save(id, 'Vic', 360);
    expect(again.status).toBe(409);
    expect(again.data.message).toBe('Vic was already answered. Look again.');
    expect((await w.save(id, 'Wren', undefined as never)).status).toBe(400);
    expect((await w.save(id, 'Wren', null)).data.changed).toBe(true);
    expect(await w.card()).toBeUndefined();
    const rows = w.all("SELECT task, detail, session_id FROM task_log WHERE task LIKE 'level_check:%' ORDER BY detail");
    expect(rows).toEqual([
      { task: `level_check:${id}:${w.byName.Vic}`, detail: '320', session_id: null },
      { task: `level_check:${id}:${w.byName.Wren}`, detail: 'no', session_id: null },
    ]);
    // Activity says what was done, in words.
    const act = ((await w.ctx.organizer.call('GET', '/api/admin/activity')).data.entries as ActivityEntry[])
      .filter((e) => e.action === 'tournament_level_check')
      .map((e) => activityText(e, 'America/Detroit', 'Alex'));
    expect(act).toEqual(['Alex kept Wren’s level after The Cold Open', 'Alex suggested 3.2 for Vic next time (after The Cold Open)']);
    // Money untouched: the stage and the answers wrote no credit and no ticket.
    expect(w.all('SELECT COUNT(*) AS n FROM credit_ledger')[0].n).toBe(0);
    expect(w.all('SELECT COUNT(*) AS n FROM tournament_tickets')[0].n).toBe(0);
  });

  it('playoff and tie games never count: Vic 4-1 in the round robin (80%) stays on after losing the Final, and extra tie losses change nothing', async () => {
    const w = await previewWorld();
    const id = await w.stage('zip95_check');
    // Round 6: Dill With It beats Net Ninjas instead. Counting the lost Final, Vic would be 4-2 (67%).
    w.sql("UPDATE tournament_games SET winner = 'b' WHERE tournament_id = ? AND round = 6 AND seat_a = 1", id);
    // Two tie games and a semifinal lost by Net Ninjas: not regular games either.
    for (const [n, stage] of [
      [20, 'tie'],
      [21, 'tie'],
      [22, 'semi'],
    ] as const)
      w.sql(
        `INSERT INTO tournament_games (id, tournament_id, num, round, court, stage, pool, slot_a, slot_b, play_to, winner, result_at, result_by, skipped, seat_a, seat_b, created_at, updated_at)
         VALUES (?, ?, ?, 9, 1, ?, NULL, 'T1', 'T5', ?, 'b', ?, 'players', 0, 1, 5, ?, ?)`,
        `x${n}`, id, n, stage, stage === 'tie' ? 5 : 11, new Date(MORNING).toISOString(), new Date(MORNING).toISOString(), new Date(MORNING).toISOString(),
      );
    // A skipped game never counts either.
    w.sql(
      `INSERT INTO tournament_games (id, tournament_id, num, round, court, stage, pool, slot_a, slot_b, play_to, winner, result_at, result_by, skipped, seat_a, seat_b, created_at, updated_at)
       VALUES ('x23', ?, 23, 9, 2, 'pool', NULL, 'T1', 'T3', 11, NULL, NULL, 'skipped', 1, NULL, NULL, ?, ?)`,
      id, new Date(MORNING).toISOString(), new Date(MORNING).toISOString(),
    );
    const card = await w.card();
    expect(card.rows.find((r: any) => r.name === 'Vic').line).toBe('3.0 · won 4 of 5');
  });

  it('a level the organizer changed is the one used; an Only me tournament never asks; nothing at all after a canceled one', async () => {
    const w = await previewWorld();
    const id = await w.stage('zip95_check');
    // Alex set Vic to 3.6+ on the night: the top level, so not asked.
    w.sql('UPDATE tournament_results SET approved_level = 360 WHERE tournament_id = ? AND player_id = ?', id, w.byName.Vic);
    expect((await w.card()).rows.map((r: any) => r.name)).toEqual(['Wren']);
    w.sql('UPDATE tournament_results SET approved_level = 340 WHERE tournament_id = ? AND player_id = ?', id, w.byName.Vic);
    expect((await w.card()).rows[0]).toMatchObject({ name: 'Vic', level: 340, line: '3.4 · won all 5 games' });
    w.sql("UPDATE tournaments SET visibility = 'me' WHERE id = ?", id);
    expect(await w.card()).toBeUndefined();
    expect((await w.save(id, 'Wren', 340)).status).toBe(409);
  });

  it('Americano: each player’s own rounds, from the saved scores; the 1st place medal is the champion', async () => {
    const w = await previewWorld();
    const id = await w.stage('zip77_revealed');
    const games = w.all("SELECT slot_a, slot_b, winner FROM tournament_games WHERE tournament_id = ? AND stage = 'pool' AND skipped = 0 AND winner IS NOT NULL", id) as {
      slot_a: string;
      slot_b: string;
      winner: string;
    }[];
    expect(games.length).toBeGreaterThan(10);
    const results = w.all(
      'SELECT r.player_id, p.display_name AS name, COALESCE(r.approved_level, r.picked_level) AS level, r.medal FROM tournament_results r JOIN players p ON p.id = r.player_id WHERE r.tournament_id = ?',
      id,
    ) as { player_id: string; name: string; level: number; medal: number }[];
    const organizer = w.byName.Alex;
    const expected = results
      .map((r) => {
        const mine = games.filter((g) => g.slot_a.split('+').includes(r.player_id) || g.slot_b.split('+').includes(r.player_id));
        const won = mine.filter((g) => (g.winner === 'a' ? g.slot_a : g.slot_b).split('+').includes(r.player_id)).length;
        return { r, f: { played: mine.length, won, champion: r.medal === 1, level: r.level } };
      })
      .filter(({ r, f }) => r.player_id !== organizer && qualifies(f))
      .map(({ r, f }) => [r.name, levelCheckLine(f)])
      .sort();
    const card = await w.card();
    expect(expected.length).toBeGreaterThan(0);
    expect((card?.rows ?? []).map((r: any) => [r.name, r.line]).sort()).toEqual(expected);
    // The 1st place medal holder is asked whatever their rounds (unless at the top or the organizer).
    const gold = results.find((r) => r.medal === 1)!;
    if (gold.level < 360 && gold.player_id !== organizer) expect(card.rows.some((r: any) => r.name === gold.name)).toBe(true);
  });
});

describe('zip 95 part 2: the next sign-up', () => {
  it('Vic: 3.0 picked (previous), 3.2 recommended; Wren (No): nothing new; nobody else’s answer reaches anyone', async () => {
    const w = await previewWorld(['Kai']);
    await w.stage('zip95_signup');
    const vic = await w.tour('Vic');
    expect(vic.status).toBe('signup');
    expect(vic.me).toBeNull();
    expect(vic.previousLevel).toBe(300);
    expect(vic.recommendedLevel).toBe(320);
    // Wren is on Winter Classic's list (no level step); off it, she starts on 3.2 with nothing new (Alex said No).
    expect((await w.tour('Wren')).previousLevel).toBeUndefined();
    w.sql("DELETE FROM tournament_signups WHERE player_id = ? AND tournament_id = (SELECT id FROM tournaments WHERE name = 'Winter Classic')", w.byName.Wren);
    const wren = await w.tour('Wren');
    expect(wren.previousLevel).toBe(320);
    expect(wren.recommendedLevel).toBeUndefined();
    expect(JSON.stringify(wren)).not.toMatch(/"no"|level_check/);
    expect((await w.tour('Kai')).recommendedLevel).toBeUndefined();
    // The organizer's card is gone (both answered, and five days on).
    expect(await w.card()).toBeUndefined();
  });

  it('used up only by being LOCKED IN for a later tournament that is not canceled; a canceled sign-up or a back out brings it back', async () => {
    const w = await previewWorld();
    const winter = await w.stage('zip95_signup');
    const vic = await playerPhone(w.c, 'Vic');
    const t = (await vic.call('GET', '/api/group')).data.tournament;
    expect(t.recommendedLevel).toBe(320);
    // He signs up for Winter Classic (picking 3.2: the level up, a screen thing only); then Winter Classic is canceled and Spring Fling opens.
    const up = await vic.call('POST', '/api/tournament/signup', { tournamentId: winter, level: 320, dates: [t.openDates[0]] });
    expect(up.status, up.text).toBe(200);
    expect((await w.ctx.organizer.call('POST', `/api/admin/tournament/${winter}/cancel`, {})).status).toBe(200);
    const made = await w.ctx.organizer.call('POST', '/api/admin/tournament', {
      name: 'Spring Fling',
      dates: ['2026-12-15', '2026-12-17'],
      size: 8,
      courts: 2,
      minutes: 120,
      start: 1170,
      ticketCents: 1600,
      creditCents: 1400,
      visibility: 'all',
    });
    expect(made.status, made.text).toBe(200);
    const view = async () => (await vic.call('GET', '/api/group')).data.tournament;
    // A canceled sign-up never uses it up.
    expect((await view()).name).toBe('Spring Fling');
    expect((await view()).previousLevel).toBe(300);
    expect((await view()).recommendedLevel).toBe(320);
    // Signed up but never locked in (Winter Classic as if it went ahead and he did not pay): still there.
    w.sql("UPDATE tournaments SET status = 'ended', ended_at = ?, canceled_at = NULL WHERE id = ?", new Date(MORNING - 3_600_000).toISOString(), winter);
    w.sql("UPDATE tournament_signups SET status = 'in' WHERE tournament_id = ? AND player_id = ?", winter, w.byName.Vic);
    expect((await view()).recommendedLevel).toBe(320);
    // An I paid for the whole ticket still waiting counts as locked in (as everyone sees it): used up.
    w.sql(
      `INSERT INTO tournament_tickets (id, tournament_id, player_id, place, place_at, price_cents, credit_cents, paid_cents, claim_cents, claim_at, created_at, updated_at)
       VALUES ('z95k', ?, ?, 'none', NULL, 1600, 0, 0, 1600, ?, ?, ?)`,
      winter, w.byName.Vic, new Date(MORNING).toISOString(), new Date(MORNING).toISOString(), new Date(MORNING).toISOString(),
    );
    expect((await view()).recommendedLevel).toBeUndefined();
    // A spot, paid: used up.
    w.sql("UPDATE tournament_tickets SET place = 'spot', place_at = ?, claim_cents = 0, claim_at = NULL, paid_cents = 1600 WHERE id = 'z95k'", new Date(MORNING).toISOString());
    expect((await view()).recommendedLevel).toBeUndefined();
    expect((await view()).previousLevel).toBe(300);
    // A back out (the sign-up 'out', the spot given back): it shows again.
    w.sql("UPDATE tournament_tickets SET place = 'none', paid_cents = 0 WHERE id = 'z95k'");
    w.sql("UPDATE tournament_signups SET status = 'out' WHERE tournament_id = ? AND player_id = ?", winter, w.byName.Vic);
    expect((await view()).recommendedLevel).toBe(320);
    // Locked in, but that tournament canceled: it shows again.
    w.sql("UPDATE tournament_tickets SET place = 'spot', paid_cents = 1600 WHERE id = 'z95k'");
    w.sql("UPDATE tournament_signups SET status = 'in' WHERE tournament_id = ? AND player_id = ?", winter, w.byName.Vic);
    expect((await view()).recommendedLevel).toBeUndefined();
    w.sql("UPDATE tournaments SET status = 'canceled', canceled_at = ? WHERE id = ?", new Date(MORNING).toISOString(), winter);
    expect((await view()).recommendedLevel).toBe(320);
  });

  it('nothing new when the recommended level IS the previous one (Alex already raised him)', async () => {
    const w = await previewWorld();
    await w.stage('zip95_signup');
    w.sql("UPDATE tournament_results SET approved_level = 320 WHERE player_id = ? AND tournament_id = (SELECT id FROM tournaments WHERE name = 'The Cold Open')", w.byName.Vic);
    const vic = await w.tour('Vic');
    expect(vic.previousLevel).toBe(320);
    expect(vic.recommendedLevel).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Alex's speed rule: the organizer's Home on the preview's fake world, "Fewer database trips" on as on live.
// ---------------------------------------------------------------------------------------------------------------------
const AT = Date.parse('2026-11-18T18:30:00.000Z');
describe('zip 95: admin Home stays 4 trips, its 5 second check 2, answers unchanged', () => {
  it('at none, all_locked, mid, zip95_check and zip95_signup', async () => {
    const { sql } = await buildSmallPreview(AT, { calm: true, zip55: true, zip60: true });
    const raw = createNodeD1(':memory:');
    raw.raw.exec(sql);
    const c: Counted = { trips: 0, statements: 0, sql: [] };
    const env: any = { DB: countingDb(raw, c), PREVIEW_CALM: 'on' };
    const call = async (method: string, path: string, cookie = '', body?: unknown, headers: Record<string, string> = {}) => {
      const h = new Headers(headers);
      if (cookie) h.set('Cookie', cookie);
      if (body !== undefined) h.set('Content-Type', 'application/json');
      h.set('Origin', 'https://preview.example');
      c.trips = 0;
      const res = await handleApi(new Request('https://preview.example' + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }), env, AT, () => {});
      return { status: res.status, text: await res.text(), trips: c.trips, cookie: res.headers.getSetCookie().map((x) => x.split(';')[0]).join('; ') };
    };
    const admin = (await call('POST', '/api/admin/login', '', { pin: previewPin() })).cookie;
    const groupId = (raw.raw.prepare('SELECT id FROM groups LIMIT 1').get() as { id: string }).id;
    const mark = () =>
      raw.raw.prepare("INSERT INTO task_log (id, group_id, session_id, task, kind, at) VALUES ('z95-fast', ?, NULL, 'speed_fewer_queries_on', 'mark', ?)").run(groupId, new Date(AT - 3_600_000).toISOString());
    const unmark = () => raw.raw.prepare("DELETE FROM task_log WHERE group_id = ? AND session_id IS NULL AND task = 'speed_fewer_queries_on' AND kind = 'mark'").run(groupId);
    for (const s of ['none', 'all_locked', 'mid', 'zip95_check', 'zip95_signup']) {
      if (s !== 'none') {
        const r = await call('POST', '/api/admin/tournament-test', admin, { stage: s });
        expect(r.status, r.text).toBe(200);
      }
      for (const [path, most] of [
        ['/api/admin/dashboard', 4],
        ['/api/admin/version', 2],
      ] as const) {
        await call('GET', path, admin);
        unmark();
        const plain = await call('GET', path, admin);
        const fast = await call('GET', path, admin, undefined, { 'X-Speed-Queries': 'on' });
        mark();
        expect(fast.text, `${s} ${path}: the same answer`).toBe(plain.text);
        const again = await call('GET', path, admin);
        expect(again.trips, `${s} ${path} trips`).toBeLessThanOrEqual(most);
        if (path === '/api/admin/dashboard') expect(JSON.parse(again.text).levelCheck?.rows?.length ?? 0, s).toBe(s === 'zip95_check' ? 2 : 0);
      }
    }
  });
});
