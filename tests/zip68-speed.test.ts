// Zip 68 (🎾68.speed): the organizer's Home in a handful of database trips, with every answer unchanged.
//
// On the preview's fake worlds (the calm one and the full one with months of games and money), with "Fewer database trips" on as on live:
//   1. the dashboard makes at most 4 trips at every stage Alex named (it made 26 to 35), and its 5-second check 2 (it made 3);
//   2. every answer of the fast way (the shared trips) is byte for byte the answer of the plain way (one read after another, as before), at
//      those stages and on the rare paths: extra switches on, hidden games (one with money), the organizer found by name, a pending cash out,
//      and the weekly upkeep writing in the middle of the dashboard (everything kept is forgotten and read again);
//   3. the wrapper's three new pieces (server/speed.ts): the sign-in check and the switch rows in one trip, a write in between makes the
//      first switch question read them again, and alsoNext reads ride in the next prefetch's trip; with the switch off nothing is added.
import { describe, expect, it, vi } from 'vitest';
import { handleApi } from '../server/app';
import { createNodeD1 } from '../dev/nodeD1';
import { type Counted, countingDb } from '../dev/countingDb';
import { buildSmallPreview } from '../scripts/preview-world-small';
import { previewPin } from '../scripts/seed-preview-world';
import { ALL_SWITCHES_READ, fewerQueriesDb, SWITCH_READ } from '../server/speed';

vi.setConfig({ testTimeout: 300_000 });

const AT = Date.parse('2026-11-18T18:30:00.000Z'); // Wed Nov 18, 2026, 1:30 PM Eastern
const seeds = new Map<boolean, Promise<string>>();
const seed = (calm: boolean) => {
  if (!seeds.has(calm)) seeds.set(calm, buildSmallPreview(AT, { calm, zip55: true, zip60: true }).then((s) => s.sql));
  return seeds.get(calm)!;
};

async function world(calm: boolean) {
  const raw = createNodeD1(':memory:');
  raw.raw.exec(await seed(calm));
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
  const stage = async (s: string) => {
    if (s === 'none') return;
    const r = await call('POST', '/api/admin/tournament-test', admin, { stage: s });
    expect(r.status, r.text).toBe(200);
  };
  const mark = (task: string, sessionId: string | null = null) =>
    raw.raw.prepare("INSERT INTO task_log (id, group_id, session_id, task, kind, at) VALUES (?, ?, ?, ?, 'mark', ?)").run(`z68-${task}-${sessionId ?? 'all'}`, groupId, sessionId, task, new Date(AT - 3_600_000).toISOString());
  const unmark = (task: string) => raw.raw.prepare("DELETE FROM task_log WHERE group_id = ? AND session_id IS NULL AND task = ? AND kind = 'mark'").run(groupId, task);
  // The Settings row of "Fewer database trips" off: then the private test header is the only way on, so the SAME rows answer both ways
  // (with the row on, the dashboard says so in one flag, which is the only difference the row itself makes).
  const plainAndFast = async (path: string) => {
    unmark('speed_fewer_queries_on');
    const plain = await call('GET', path, admin);
    const fast = await call('GET', path, admin, undefined, { 'X-Speed-Queries': 'on' });
    mark('speed_fewer_queries_on');
    return { plain, fast };
  };
  return { raw, call, admin, stage, mark, unmark, plainAndFast, groupId };
}

const STAGES = ['none', 'tickets_open', 'all_locked', 'day_ready', 'mid', 'final_done', 'ended'];

describe('Zip 68: the organizer Home in a few trips', () => {
  for (const calm of [true, false]) {
    it(`${calm ? 'calm' : 'full'} world: the dashboard at most 4 trips and the check 2, at every stage, answers unchanged`, async () => {
      const w = await world(calm);
      for (const s of STAGES) {
        await w.stage(s);
        await w.call('GET', '/api/admin/dashboard', w.admin); // the first read does its upkeep once, as on a phone
        const dash = await w.call('GET', '/api/admin/dashboard', w.admin);
        const check = await w.call('GET', '/api/admin/version', w.admin);
        expect(dash.status).toBe(200);
        expect(dash.trips, `${s} dashboard`).toBeLessThanOrEqual(4);
        expect(check.trips, `${s} check`).toBe(2);
        for (const path of ['/api/admin/dashboard', '/api/admin/version']) {
          const { plain, fast } = await w.plainAndFast(path);
          expect(fast.text, `${s} ${path}`).toBe(plain.text);
          expect(fast.trips).toBeLessThan(plain.trips);
        }
      }
    });
  }

  it('the rare paths: extra switches, hidden games, a cash out, the organizer found by name: same answers, still 4 trips', async () => {
    const w = await world(false);
    await w.stage('mid');
    for (const t of ['venue_alert_on', 'acting_others_on', 'second_chance_on', 'players_redo_on', 'spent_totals_on', 'extended_time_on']) {
      w.unmark(t);
      w.mark(t);
    }
    const empty = w.raw.raw.prepare('SELECT s.id FROM sessions s WHERE s.starts_at > ? AND NOT EXISTS (SELECT 1 FROM session_players sp WHERE sp.session_id = s.id) ORDER BY s.starts_at LIMIT 2').all(new Date(AT).toISOString()) as { id: string }[];
    const paid = w.raw.raw.prepare("SELECT session_id AS id FROM session_players WHERE payment_status = 'paid' LIMIT 1").get() as { id: string };
    for (const g of [...empty, paid]) w.mark('admin_hidden_game', g.id);
    expect((w.raw.raw.prepare("SELECT COUNT(*) AS n FROM refund_requests WHERE status = 'pending'").get() as { n: number }).n).toBeGreaterThan(0);
    await w.call('GET', '/api/admin/dashboard', w.admin);
    const dash = await w.call('GET', '/api/admin/dashboard', w.admin);
    expect(dash.trips).toBeLessThanOrEqual(4);
    const body = JSON.parse(dash.text);
    expect(body.hiddenGames.map((g: { id: string }) => g.id).sort()).toEqual(empty.map((g) => g.id).sort());
    expect(body.refundRequests.length).toBeGreaterThan(0);
    let { plain, fast } = await w.plainAndFast('/api/admin/dashboard');
    expect(fast.text).toBe(plain.text);
    w.raw.raw.prepare('UPDATE groups SET organizer_player_id = NULL').run();
    const byName = await w.call('GET', '/api/admin/dashboard', w.admin);
    expect(byName.trips).toBeLessThanOrEqual(4);
    ({ plain, fast } = await w.plainAndFast('/api/admin/dashboard'));
    expect(fast.text).toBe(plain.text);
  });

  it('the weekly upkeep writing in the middle of the dashboard: everything kept is forgotten, the answer is what the plain way says', async () => {
    const w = await world(false);
    await w.stage('tickets_open');
    await w.call('GET', '/api/admin/dashboard', w.admin);
    const last = w.raw.raw.prepare('SELECT s.id, s.starts_at FROM sessions s WHERE s.planned_starts_at IS NOT NULL AND NOT EXISTS (SELECT 1 FROM session_players sp WHERE sp.session_id = s.id) ORDER BY s.starts_at DESC LIMIT 1').get() as { id: string; starts_at: string };
    const takeOut = () => {
      const id = (w.raw.raw.prepare('SELECT id FROM sessions WHERE starts_at = ?').get(last.starts_at) as { id: string }).id;
      w.raw.raw.prepare('DELETE FROM task_log WHERE session_id = ?').run(id);
      w.raw.raw.prepare('DELETE FROM sessions WHERE id = ?').run(id);
    };
    // The same first read twice (the upkeep adds the game back each time, with a new id): the plain way, then the fast way.
    const newId = () => (w.raw.raw.prepare('SELECT id FROM sessions WHERE starts_at = ?').get(last.starts_at) as { id: string }).id;
    takeOut();
    w.unmark('speed_fewer_queries_on');
    const plain = await w.call('GET', '/api/admin/dashboard', w.admin);
    const plainId = newId();
    takeOut();
    const fast = await w.call('GET', '/api/admin/dashboard', w.admin, undefined, { 'X-Speed-Queries': 'on' });
    const fastId = newId();
    w.mark('speed_fewer_queries_on');
    expect(plainId).not.toBe(fastId);
    expect(JSON.parse(fast.text).sessions.some((s: { id: string }) => s.id === fastId)).toBe(true);
    const strip = (t: string, id: string) => t.split(id).join('NEW').replace(/"version":"[^"]*"/, '');
    expect(strip(fast.text, fastId)).toBe(strip(plain.text, plainId));
    const after = await w.call('GET', '/api/admin/dashboard', w.admin);
    expect(after.trips).toBeLessThanOrEqual(4);
  });

  it('a wrong or missing organizer sign-in is refused exactly as before', async () => {
    const w = await world(true);
    for (const cookie of ['', 'pb_admin=not-a-real-token']) {
      for (const path of ['/api/admin/dashboard', '/api/admin/version']) {
        const r = await w.call('GET', path, cookie);
        expect(r.status).toBe(401);
        expect(JSON.parse(r.text).error).toBe('admin_required');
      }
    }
  });
});

describe('Zip 68: the wrapper pieces (server/speed.ts)', () => {
  async function db() {
    const raw = createNodeD1(':memory:');
    raw.raw.exec(await seed(true));
    const groupId = (raw.raw.prepare('SELECT id FROM groups LIMIT 1').get() as { id: string }).id;
    const c: Counted = { trips: 0, statements: 0, sql: [] };
    return { raw, groupId, c, counted: countingDb(raw, c) };
  }
  const check = (d: any, groupId: string) => d.prepare('SELECT id, name FROM groups WHERE id = ?').bind(groupId);

  it('the sign-in check and the switch rows in ONE trip; the switch questions after it cost nothing', async () => {
    const { groupId, c, counted } = await db();
    const f = fewerQueriesDb(counted, 'decide');
    const row = await f.firstWithSwitches<{ id: string }>(check(f, groupId));
    expect(row?.id).toBe(groupId);
    expect(c.trips).toBe(1);
    expect(c.statements).toBe(2);
    expect(await f.prepare(SWITCH_READ).bind(groupId, 'speed_fewer_queries_on').first()).toEqual({ x: 1 });
    expect(await f.prepare(SWITCH_READ).bind(groupId, 'no_such_switch_on').first()).toBeNull();
    expect(c.trips).toBe(1);
    expect(f.isFast()).toBe(true);
  });

  it('switch off: the one shared trip decides, then every read is plain (no trip added, none kept)', async () => {
    const { raw, groupId, c, counted } = await db();
    raw.raw.exec("DELETE FROM task_log WHERE session_id IS NULL AND task = 'speed_fewer_queries_on'");
    const f = fewerQueriesDb(counted, 'decide');
    await f.firstWithSwitches(check(f, groupId));
    expect(await f.prepare(SWITCH_READ).bind(groupId, 'admin_v2_on').first()).toEqual({ x: 1 });
    expect(c.trips).toBe(1);
    expect(f.isFast()).toBe(false);
    await f.prepare(SWITCH_READ).bind(groupId, 'admin_r2_on').first();
    expect(c.trips).toBe(2);
    f.alsoNext([{ kind: 'all', sql: 'SELECT id FROM players WHERE group_id = ?', values: [groupId] }]);
    await f.prefetch([{ kind: 'all', sql: 'SELECT id FROM sessions WHERE group_id = ?', values: [groupId] }]);
    expect(c.trips).toBe(2);
  });

  it('a write after the shared trip: the first switch question reads the rows again and sees the new one', async () => {
    const { groupId, c, counted } = await db();
    const f = fewerQueriesDb(counted, 'decide');
    await f.firstWithSwitches(check(f, groupId));
    await f.prepare("INSERT INTO task_log (id, group_id, session_id, task, kind, at) VALUES ('z68-new', ?, NULL, 'zip68_new_on', 'mark', '2026-11-18T00:00:00.000Z')").bind(groupId).run();
    const before = c.trips;
    expect(await f.prepare(SWITCH_READ).bind(groupId, 'zip68_new_on').first()).toEqual({ x: 1 });
    expect(c.trips).toBe(before + 1);
  });

  it('a failed shared trip: the check alone, as before', async () => {
    const { groupId, c, counted } = await db();
    const refusing: any = { ...counted, batch: () => Promise.reject(new Error('no')) };
    const f = fewerQueriesDb(refusing, 'decide');
    expect((await f.firstWithSwitches<{ id: string }>(check(f, groupId)))?.id).toBe(groupId);
    expect(await f.prepare(SWITCH_READ).bind(groupId, 'admin_v2_on').first()).toEqual({ x: 1 });
    expect(c.sql.filter((s) => s === ALL_SWITCHES_READ).length).toBe(1);
  });

  it('alsoNext: the reads ride in the next prefetch trip and are answered from it', async () => {
    const { groupId, c, counted } = await db();
    const f = fewerQueriesDb(counted, 'fast');
    const players = { kind: 'all' as const, sql: 'SELECT id FROM players WHERE group_id = ? ORDER BY id', values: [groupId] };
    f.alsoNext([players]);
    await f.prefetch([{ kind: 'all', sql: 'SELECT id FROM sessions WHERE group_id = ? ORDER BY id', values: [groupId] }]);
    expect(c.trips).toBe(1);
    expect(c.statements).toBe(2);
    const got = await f.prepare(players.sql).bind(...players.values).all();
    expect(got.results.length).toBeGreaterThan(0);
    expect(c.trips).toBe(1);
  });
});
