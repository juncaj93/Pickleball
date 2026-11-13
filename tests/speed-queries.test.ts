// Zip 12, SPEED_FEWER_QUERIES: the PROOF that fewer database trips change no answer. On the fake preview world, seeded at four
// moments (a weekend, game day morning, during a game, the morning after), with the Zip 9 and Zip 10 switch rows on and off, every
// screen's JSON is compared byte for byte with the switch OFF and ON. Then the trip counts: ON meets the targets, OFF is exactly
// main's count, the kill switch removes the wrapper, and a write in the middle of a request is never answered from before it.
import { describe, expect, it, vi } from 'vitest';

// Each test builds the fake world (a few seconds on a busy machine).
vi.setConfig({ testTimeout: 60_000 });
// PB_SPEED_FORCE=1 turns the switch on for every request, "off" included: then only the answers are compared, not the trips.
const forcedRun = process.env.PB_SPEED_FORCE === '1';
import { createNodeD1 } from '../dev/nodeD1';
import { type Counted, countingDb } from '../dev/countingDb';
import { handleApi } from '../server/app';
import { buildSeed, previewPin } from '../scripts/seed-preview-world';
import { fewerQueriesDb, SPEED_FEWER_QUERIES_TASK, withFewerQueries } from '../server/speed';
import { makeCtx } from '../server/context';

const MOMENTS = {
  weekend: Date.parse('2026-11-07T17:00:00.000Z'), // Sat Nov 7, 12:00 PM Eastern
  gameDayMorning: Date.parse('2026-11-10T16:30:00.000Z'), // Tue Nov 10, 11:30 AM Eastern
  duringGame: Date.parse('2026-11-11T01:30:00.000Z'), // Tue Nov 10, 8:30 PM Eastern
  morningAfter: Date.parse('2026-11-11T14:00:00.000Z'), // Wed Nov 11, 9:00 AM Eastern
};
const ZIP9_10 = ['short_games_on', 'card_time_buttons_on', 'card_cleanup_on'];

async function world(at: number, zip910: boolean, extraEnv: Record<string, string> = {}) {
  const { sql } = await buildSeed(at);
  const raw = createNodeD1(':memory:');
  raw.raw.exec(sql);
  // The seed turns the Zip 12 rows on (the preview rule); these tests switch them per request, so they start off.
  raw.raw.exec("DELETE FROM task_log WHERE session_id IS NULL AND kind = 'mark' AND task LIKE 'speed_%'");
  if (!zip910) raw.raw.exec(`DELETE FROM task_log WHERE session_id IS NULL AND kind = 'mark' AND task IN (${ZIP9_10.map((t) => `'${t}'`).join(', ')})`);
  const c: Counted = { trips: 0, statements: 0, sql: [] };
  const env: any = { DB: countingDb(raw, c), MOTION: 'on', MOTION_ADMIN: 'on', ...extraEnv };
  const call = async (method: string, path: string, cookie = '', body?: unknown, headers: Record<string, string> = {}) => {
    const h = new Headers(headers);
    if (cookie) h.set('Cookie', cookie);
    if (body !== undefined) h.set('Content-Type', 'application/json');
    c.trips = 0;
    c.seq = [];
    const res = await handleApi(new Request('https://preview.example' + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }), env, at, () => {});
    const text = await res.text();
    const headersOut: [string, string][] = [];
    res.headers.forEach((v, k) => {
      if (k !== 'set-cookie') headersOut.push([k, v]);
    });
    // mainTrips: what main asks (main has no Zip 12 or Zip 13 rows: the reads of `speed_...` and the three Zip 13 rows are taken out; Zip 14 to 17, Zip 21, Zip 23, Zip 24, Zip 27, Zip 30, Zip 31 and Zip 32 rows too).
    const speedReads = (c.seq ?? []).filter((x) => x.includes('"speed_') || /"(players_redo_on|swap_button_on|admin_undo_on|game_day_card_on|second_chance_on|after_game_card_on|unpaid_nudge_on|error_alerts_on|totals_refresh_on|spent_totals_on|booking_hours_on|acting_others_on|players_sheet_redo_on|checkin_pay_line_on|extended_time_on|home_screen_tip_on|game_day_text_on|tap_guard_fix_on|christmas_skin_on|christmas_skin_tester)"/.test(x)).length;
    return { status: res.status, text, headers: headersOut, trips: c.trips, mainTrips: c.trips - speedReads, cookie: res.headers.getSetCookie().map((x) => x.split(';')[0]).join('; ') };
  };
  const login = await call('POST', '/api/admin/login', '', { pin: previewPin() });
  const admin = login.cookie;
  const dash = JSON.parse((await call('GET', '/api/admin/dashboard', admin)).text);
  const phones: Record<string, string> = {};
  for (const name of ['Avery', 'Indy', 'Gray', 'Casey', 'Kai', 'Orla']) {
    const p = dash.players.find((x: any) => x.name.startsWith(name));
    if (!p) continue;
    phones[name] = (await call('POST', '/api/me', '', { playerId: p.id })).cookie;
  }
  return { raw, call, admin, phones, dash, env, counted: c };
}

const ON = { 'X-Speed-Queries': 'on' };

describe('SPEED_FEWER_QUERIES: same answers, byte for byte', () => {
  for (const [label, at] of Object.entries(MOMENTS)) {
    for (const zip910 of [true, false]) {
      it(`${label}, Zip 9 and 10 rows ${zip910 ? 'on' : 'off'}: every screen identical with the switch off and on`, async () => {
        const w = await world(at, zip910);
        const someone = w.dash.players.find((p: any) => p.name.startsWith('Avery'));
        const month = new Date(at).toISOString().slice(0, 7);
        const screens: [string, string, string, Record<string, string>][] = [
          ['status', '/api/status', '', {}],
          ...Object.entries(w.phones).flatMap(([n, ck]): [string, string, string, Record<string, string>][] => [
            [`group ${n}`, '/api/group', ck, {}],
            [`version ${n}`, '/api/group/version', ck, {}],
          ]),
          ['group, no name picked', '/api/group', '', {}],
          ['dashboard', '/api/admin/dashboard', w.admin, {}],
          ['admin version', '/api/admin/version', w.admin, {}],
          ['money', '/api/admin/money', w.admin, {}],
          ['money, month', `/api/admin/money?month=${month}`, w.admin, {}],
          ['month games', `/api/admin/month-games?month=${month}`, w.admin, {}],
          ['history', '/api/admin/activity', w.admin, {}],
          ['view as', '/api/group', w.admin, { 'X-View-As': someone.id }],
        ];
        let offTrips = 0;
        let onTrips = 0;
        for (const [name, path, ck, h] of screens) {
          await w.call('GET', path, ck, undefined, h); // warm: upkeep (next weeks' games) happens once, before both
          const off = await w.call('GET', path, ck, undefined, h);
          const on = await w.call('GET', path, ck, undefined, { ...h, ...ON });
          const offAgain = await w.call('GET', path, ck, undefined, h);
          expect(off.status, name).toBe(200);
          expect(on.status, name).toBe(off.status);
          expect(on.text, name).toBe(off.text);
          expect(on.headers, name).toEqual(off.headers);
          expect(offAgain.text, name).toBe(off.text);
          offTrips += off.trips;
          onTrips += on.trips;
        }
        if (!forcedRun) expect(onTrips).toBeLessThan(offTrips / 2);
      }, 60_000);
    }
  }
});

describe('SPEED_FEWER_QUERIES: trips', () => {
  it('meets the targets with the switch on (group about 10, dashboard about 20, version check about 4)', async () => {
    const w = await world(MOMENTS.weekend, true);
    const ck = w.phones.Avery;
    for (const [path, cookie, most] of [
      ['/api/group', ck, 10],
      ['/api/group/version', ck, 4],
      ['/api/admin/dashboard', w.admin, 22],
      ['/api/admin/version', w.admin, 3],
      ['/api/admin/money', w.admin, 10],
      ['/api/status', '', 1],
    ] as const) {
      await w.call('GET', path, cookie);
      const on = await w.call('GET', path, cookie, undefined, ON);
      expect(on.trips, path).toBeLessThanOrEqual(most);
    }
  });

  it.skipIf(forcedRun)('with the Settings rows off, asks the database exactly as many times as main did (the new rows cost nothing)', async () => {
    // main's counts on this world, measured before Zip 12 (scripts/count-queries.ts): group 47, version 21, dashboard 81, money 27.
    const w = await world(Date.parse('2026-11-08T17:00:00.000Z'), true);
    const ck = w.phones.Casey;
    await w.call('GET', '/api/group', ck);
    const before = await w.call('GET', '/api/group', ck);
    // Same world with the kill switch "off" (no wrapper at all = main's code path).
    const k = await world(Date.parse('2026-11-08T17:00:00.000Z'), true, { SPEED_FEWER_QUERIES: 'off' });
    const kck = k.phones.Casey;
    await k.call('GET', '/api/group', kck);
    const main = await k.call('GET', '/api/group', kck);
    expect(before.trips).toBe(main.mainTrips);
    for (const path of ['/api/admin/dashboard', '/api/admin/version', '/api/admin/money', '/api/admin/activity']) {
      await w.call('GET', path, w.admin);
      await k.call('GET', path, k.admin);
      expect((await w.call('GET', path, w.admin)).trips, path).toBe((await k.call('GET', path, k.admin)).mainTrips);
    }
  });

  it.skipIf(forcedRun)('the Settings row on: every phone gets fewer trips, with the same answer', async () => {
    const w = await world(MOMENTS.weekend, true);
    const ck = w.phones.Indy;
    await w.call('GET', '/api/group', ck);
    const off = await w.call('GET', '/api/group', ck);
    const put = await w.call('PUT', '/api/admin/speed-fewer-queries-switch', w.admin, { on: true }, { Origin: 'https://preview.example' });
    expect(put.status).toBe(200);
    const on = await w.call('GET', '/api/group', ck);
    expect(on.trips).toBeLessThanOrEqual(10);
    expect(on.text).toBe(off.text);
    const row = w.raw.raw.prepare("SELECT COUNT(*) AS n FROM task_log WHERE task = ? AND session_id IS NULL AND kind = 'mark'").get(SPEED_FEWER_QUERIES_TASK) as { n: number };
    expect(row.n).toBe(1);
    // The kill switch wins over the row.
    w.env.SPEED_FEWER_QUERIES = 'off';
    const killed = await w.call('GET', '/api/group', ck);
    expect(killed.mainTrips).toBe(off.trips);
    expect(killed.text).toBe(off.text);
  });
});

describe('SPEED_FEWER_QUERIES: the wrapper never answers from before a write', () => {
  it('an early answer is handed out once per listed use; a write throws early answers away; finish() steps aside', async () => {
    const raw = createNodeD1(':memory:');
    raw.raw.exec("CREATE TABLE t (id TEXT PRIMARY KEY, v INTEGER); INSERT INTO t VALUES ('a', 1);");
    const c: Counted = { trips: 0, statements: 0, sql: [] };
    const db = fewerQueriesDb(countingDb(raw, c), 'fast');
    const SQL = 'SELECT v FROM t WHERE id = ?';
    const read = () => db.prepare(SQL).bind('a').first<{ v: number }>();
    // Listed twice: one trip for both uses; the two answers are separate objects (one use cannot change the other).
    await db.prefetch([{ kind: 'first', sql: SQL, values: ['a'] }, { kind: 'first', sql: SQL, values: ['a'] }]);
    expect(c.trips).toBe(1);
    const one = (await read()) as { v: number };
    one.v = 99;
    expect((await read())?.v).toBe(1);
    expect(c.trips).toBe(1);
    // A third use was not listed: it goes to the database, as today.
    expect((await read())?.v).toBe(1);
    expect(c.trips).toBe(2);
    // A write in between: the early answer is gone, the read sees the change.
    await db.prefetch([{ kind: 'first', sql: SQL, values: ['a'] }]);
    await db.prepare('UPDATE t SET v = 2 WHERE id = ?').bind('a').run();
    expect((await read())?.v).toBe(2);
    await db.prefetch([{ kind: 'first', sql: SQL, values: ['a'] }]);
    await db.batch([db.prepare("UPDATE t SET v = 3 WHERE id = 'a'")]);
    expect((await read())?.v).toBe(3);
    db.finish();
    const n = c.trips;
    await db.prefetch([{ kind: 'first', sql: SQL, values: ['a'] }]);
    await read();
    await read();
    expect(c.trips).toBe(n + 2); // after finish(): no early trip, each read its own
  });

  it('an early batch that set off before a write is not used', async () => {
    const raw = createNodeD1(':memory:');
    raw.raw.exec("CREATE TABLE t (id TEXT PRIMARY KEY, v INTEGER); INSERT INTO t VALUES ('a', 1);");
    const db = fewerQueriesDb(raw, 'fast');
    const SQL = 'SELECT v FROM t WHERE id = ?';
    await Promise.all([db.prefetch([{ kind: 'first', sql: SQL, values: ['a'] }]), db.prepare("UPDATE t SET v = 5 WHERE id = 'a'").run()]);
    expect((await db.prepare(SQL).bind('a').first<{ v: number }>())?.v).toBe(5);
  });

  it('switch questions follow a switch flipped in the same request', async () => {
    const w = await world(MOMENTS.weekend, true);
    const ctx = makeCtx(new Request('https://preview.example/api/x', { headers: ON }), { ...w.env, DB: w.raw }, MOMENTS.weekend);
    const { ctx: fast } = withFewerQueries(ctx);
    const gid = (w.raw.raw.prepare('SELECT id FROM groups').get() as { id: string }).id;
    const ask = () => fast.db.prepare("SELECT 1 AS x FROM task_log WHERE group_id = ? AND session_id IS NULL AND task = ? AND kind = 'mark' LIMIT 1").bind(gid, 'card_cleanup_on').first();
    expect(await ask()).toEqual({ x: 1 });
    await fast.db.prepare("DELETE FROM task_log WHERE group_id = ? AND session_id IS NULL AND task = ? AND kind = 'mark'").bind(gid, 'card_cleanup_on').run();
    expect(await ask()).toBeNull();
  });

  it.skipIf(forcedRun)('kill switch off: the request keeps its own database (no wrapper at all)', () => {
    const raw = createNodeD1(':memory:');
    const ctx = makeCtx(new Request('https://x.example/api/group', { headers: ON }), { DB: raw, SPEED_FEWER_QUERIES: 'off' }, 0);
    const out = withFewerQueries(ctx);
    expect(out.db).toBeNull();
    expect(out.ctx.db).toBe(raw);
  });
});
