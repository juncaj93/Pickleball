// Audit 73 (privacy, proof only): every organizer route (the real route list) answers 401 with no organizer cookie, also from a player's phone,
// and the read-only organizer PIN cannot write on any tournament route (403 view_only, nothing in the database changes); its reads work.
import { describe, expect, it, vi } from 'vitest';
import { routeList } from '../server/app';
import { playerPhone } from './harness';
import { draftAndPublish, START_MS, world } from './zip58-world';

vi.setConfig({ testTimeout: 300_000 });
const RO_PIN = '58302917';

function snapshot(db: any): string {
  const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as { name: string }[]).map((t) => t.name);
  return tables.map((t) => `${t}:${JSON.stringify(db.prepare(`SELECT * FROM "${t}" ORDER BY rowid`).all())}`).join('\n');
}

describe('audit 73: organizer routes need the organizer, the read-only PIN never writes', () => {
  it('every /api/admin route: 401 with no cookie and with a player cookie (tournament on, teams published, night on)', async () => {
    const ctx = await world(8);
    await draftAndPublish(ctx);
    ctx.app.now = START_MS + 60_000;
    const ids = { id: ctx.tid, param: ctx.tid };
    const fill = (p: string) => p.replace(/:param/g, ids.param);
    const admin = routeList().filter((r) => r.path.startsWith('/api/admin/') && r.path !== '/api/admin/login' && r.path !== '/api/admin/logout');
    expect(admin.length).toBeGreaterThan(100);
    const anon = ctx.app.client();
    anon.groupKey = ctx.groupKey;
    const player = await playerPhone(ctx, 'Casey');
    const bad: string[] = [];
    for (const r of admin) {
      for (const [who, c] of [
        ['anon', anon],
        ['player', player],
      ] as const) {
        const res = await c.call(r.method, fill(r.path), r.method === 'GET' ? undefined : { on: true, stage: 'mid', action: 'draft', booked: r.path.endsWith('court-answer') ? who === 'anon' : undefined });
        if (res.status !== 401) bad.push(`${who} ${r.method} ${r.path} -> ${res.status}`);
      }
    }
    // View as and Pretend need the organizer too.
    expect((await player.call('GET', '/api/group', undefined, { 'X-View-As': ctx.byName.Devon })).status).toBe(401);
    expect((await player.call('GET', '/api/group', undefined, { 'X-Pretend-Now': '2026-11-12T20:00' })).status).toBe(401);
    expect(bad).toEqual([]);
  });

  it('the read-only PIN: every tournament write route 403 view_only and nothing changes; every tournament read 200', async () => {
    const ctx = await world(8);
    ctx.app.env.ORGANIZER_READONLY_PIN = RO_PIN;
    await draftAndPublish(ctx);
    ctx.app.now = START_MS + 60_000;
    const viewer = ctx.app.client();
    viewer.groupKey = ctx.groupKey;
    expect((await viewer.call('POST', '/api/admin/login', { pin: RO_PIN })).status).toBe(200);
    const routes = routeList().filter((r) => /^\/api\/admin\/tournament/.test(r.path));
    const writes = routes.filter((r) => r.method !== 'GET');
    // time, plan, teams, games, awards, finalize, cancel, visibility, ... all present.
    for (const p of ['/time', '/plan', '/teams', '/games', '/awards', '/date', '/level', '/ticket', '/cancel']) expect(writes.some((r) => r.path.endsWith(p)), p).toBe(true);
    const bodies = [
      {},
      { action: 'draft' },
      { action: 'publish' },
      { action: 'result', num: 1, winner: 'a', scoreA: 11, scoreB: 3 },
      { action: 'spin', key: 'x' },
      { action: 'end' },
      { stage: 'mid' },
      { start: 1200, minutes: 120 },
      { playerId: ctx.byName.Blair, level: 300 },
    ];
    const before = snapshot(ctx.app.db.raw);
    const bad: string[] = [];
    for (const r of writes) {
      for (const b of bodies) {
        const res = await viewer.call(r.method, r.path.replace(/:param/g, ctx.tid), b);
        if (res.status !== 403 || res.data?.error !== 'view_only') bad.push(`${r.method} ${r.path} ${JSON.stringify(b)} -> ${res.status} ${res.data?.error}`);
      }
    }
    await ctx.app.settle();
    expect(bad).toEqual([]);
    expect(snapshot(ctx.app.db.raw)).toBe(before);
    for (const r of routes.filter((x) => x.method === 'GET')) {
      const res = await viewer.call('GET', r.path.replace(/:param/g, ctx.tid));
      const real = await ctx.organizer.call('GET', r.path.replace(/:param/g, ctx.tid));
      // The same answer as the real PIN (Finalize's page is 409 once the night has started, for both).
      expect([res.status, res.text], r.path).toEqual([real.status, real.text]);
    }
    // The tournament test stage route: Not found anywhere but a preview, even for the real organizer.
    expect((await ctx.organizer.call('POST', '/api/admin/tournament-test', { stage: 'mid' })).status).toBe(404);
    expect((await (await playerPhone(ctx, 'Blair')).call('GET', '/api/tournament/pools-look')).status).toBe(404);
  });
});
