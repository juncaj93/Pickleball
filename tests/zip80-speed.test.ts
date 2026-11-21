// Zip 80 (🎾80.leftovers): the three organizer reads the 🎾75 audit named (the Money month, an older month's games, a player's card summary)
// in a few trips, every answer byte for byte the plain way's, on the calm and the full fake world (Zip 68's harness). The organizer Home stays 4 / 2.
// (Zip 68's header follows.)
// Zip 68 (🎾68.speed): the organizer's Home in a handful of database trips, with every answer unchanged.
//
// On the preview's fake worlds (the calm one and the full one with months of games and money), with "Fewer database trips" on as on live:
//   1. the dashboard makes at most 4 trips at every stage Alex named (it made 26 to 35), and its 5-second check 2 (it made 3);
//   2. every answer of the fast way (the shared trips) is byte for byte the answer of the plain way (one read after another, as before), at
//      those stages and on the rare paths: extra switches on, hidden games (one with money), the organizer found by name, a pending cash out,
//      and the weekly upkeep writing in the middle of the dashboard (everything kept is forgotten and read again);
//   3. the wrapper's three new pieces (server/speed.ts): the sign-in check and the switch rows in one trip, a write in between makes the
//      first switch question read them again; with the switch off nothing is added.
import { describe, expect, it, vi } from 'vitest';
import { handleApi } from '../server/app';
import { createNodeD1 } from '../dev/nodeD1';
import { type Counted, countingDb } from '../dev/countingDb';
import { buildSmallPreview } from '../scripts/preview-world-small';
import { previewPin } from '../scripts/seed-preview-world';

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


describe('Zip 80: the Money month, month-games and a player summary in a few trips, answers unchanged', () => {
  for (const calm of [true, false])
    it(`${calm ? 'calm' : 'full'} world, at none, all_locked, day_ready, mid`, async () => {
      const w = await world(calm);
      const dash = JSON.parse((await w.call('GET', '/api/admin/dashboard', w.admin)).text);
      const vic = dash.players.find((p: any) => p.name === 'Vic').id;
      const alex = dash.players.find((p: any) => p.name === 'Alex').id;
      // Before Zip 80 (calm / full): money this month 8 / 8, last month 7 / 8, month-games 8 / 9, a player 8 / 12, the organizer 18 / 31.
      const limits: [string, number][] = [
        ['/api/admin/money?month=2026-11', 3],
        ['/api/admin/money?month=2026-10', 3],
        ['/api/admin/month-games?month=2026-10', 3],
        [`/api/admin/players/${vic}/summary`, 2],
        [`/api/admin/players/${alex}/summary`, calm ? 6 : 11],
        ['/api/admin/dashboard', 4],
        ['/api/admin/version', 2],
      ];
      for (const s of ['none', 'all_locked', 'day_ready', 'mid']) {
        await w.stage(s);
        for (const [path, most] of limits) {
          await w.call('GET', path, w.admin); // the first read does the lazy upkeep
          const { plain, fast } = await w.plainAndFast(path);
          expect(fast.status, `${s} ${path}`).toBe(200);
          expect(fast.text, `${s} ${path}: the same answer`).toBe(plain.text);
          const again = await w.call('GET', path, w.admin);
          expect(again.trips, `${s} ${path} trips`).toBeLessThanOrEqual(most);
        }
      }
    });
});
