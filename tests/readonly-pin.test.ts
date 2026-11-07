// Zip 8, item A: the read-only organizer PIN (server/viewOnly.ts). Every write from a view-only sign-in is refused on the
// server (the loop runs over the real route list, so a route added later is covered without touching this file), every
// organizer read screen loads, nothing in the database changes, the real PIN works exactly as before, and wrong guesses
// of either PIN share the same lockout.
import { describe, expect, it } from 'vitest';
import { routeList } from '../server/app';
import { isReadSql } from '../server/viewOnly';
import { DAY, firstSession, HOUR, PIN, playerPhone, setupGroup, TestApp } from './harness';

const RO_PIN = '58302917';

/** Every row of every table, as text: two equal snapshots mean nothing in the database changed. */
function snapshot(app: TestApp): string {
  const tables = (app.db.raw.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as { name: string }[]).map((t) => t.name);
  return tables.map((t) => `${t}:${JSON.stringify(app.db.raw.prepare(`SELECT * FROM "${t}" ORDER BY rowid`).all())}`).join('\n');
}

/** A busy group (players in, a payment, credit) with the read-only PIN set, and a phone signed in with it. */
async function world() {
  const ctx = await setupGroup();
  ctx.app.env.ORGANIZER_READONLY_PIN = RO_PIN;
  const s = await firstSession(ctx);
  for (const name of ['Blair', 'Casey', 'Devon', 'Emery']) {
    const phone = await playerPhone(ctx, name);
    expect((await phone.call('POST', `/api/sessions/${s.id}/join`, {})).status).toBe(200);
  }
  await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/payment`, { playerId: ctx.byName.Blair, paid: true });
  const viewer = ctx.app.client();
  viewer.groupKey = ctx.groupKey;
  const login = await viewer.call('POST', '/api/admin/login', { pin: RO_PIN });
  expect(login.status).toBe(200);
  return { ...ctx, s, viewer };
}

/** A real address for a route pattern: ids filled in with real ones, so a route that slipped past the guard would really act. */
function fill(path: string, ids: { session: string; player: string }): string {
  if (path.includes('/sessions/:param')) return path.replace(':param', ids.session);
  if (path.includes('/players/:param')) return path.replace(':param', ids.player);
  return path.replace(/:param/g, 'x0000000-0000-4000-8000-000000000000');
}

describe('read-only organizer PIN (Zip 8)', () => {
  it('signs in with its own session flag and a 12-hour cookie, and the dashboard says View only', async () => {
    const ctx = await world();
    const cookie = ctx.viewer.cookies.get('pb_admin')!;
    expect(cookie.startsWith('ro.')).toBe(true);
    const rows = ctx.app.db.raw.prepare('SELECT id, created_at, expires_at FROM admin_sessions').all() as { id: string; created_at: string; expires_at: string }[];
    const ro = rows.filter((r) => r.id.startsWith('ro:'));
    expect(ro).toHaveLength(1);
    expect(Date.parse(ro[0].expires_at) - Date.parse(ro[0].created_at)).toBe(12 * HOUR);
    const dash = await ctx.viewer.call('GET', '/api/admin/dashboard');
    expect(dash.status).toBe(200);
    expect(dash.data.viewOnly).toBe(true);
    // The real organizer's dashboard has no such flag (its answer is unchanged).
    const real = await ctx.organizer.call('GET', '/api/admin/dashboard');
    expect('viewOnly' in real.data).toBe(false);
    // The PIN itself is never stored or shown anywhere.
    expect(snapshot(ctx.app)).not.toContain(RO_PIN);
    expect(dash.text).not.toContain(RO_PIN);
    expect(real.text).not.toContain(RO_PIN);
  });

  it('refuses EVERY write route with 403 (the real route list), and nothing in the database changes', async () => {
    const ctx = await world();
    const writes = routeList().filter((r) => r.method !== 'GET' && r.method !== 'HEAD');
    // The loop really covers the app: dozens of write routes, organizer and player ones.
    expect(writes.length).toBeGreaterThan(60);
    const before = snapshot(ctx.app);
    const ids = { session: ctx.s.id, player: ctx.byName.Blair };
    const bodies: Record<string, unknown>[] = [{}, { on: true }, { paid: true, playerId: ids.player, confirm: true, decision: 'cancel', name: 'Hacked', pin: PIN, currentPin: PIN, newPin: '999999' }];
    let checked = 0;
    for (const r of writes) {
      if (r.path === '/api/admin/login' || r.path === '/api/admin/logout') continue;
      for (const body of bodies) {
        const res = await ctx.viewer.call(r.method, fill(r.path, ids), body);
        expect(res.status, `${r.method} ${r.path}`).toBe(403);
        expect(res.data.error, `${r.method} ${r.path}`).toBe('view_only');
        checked++;
      }
    }
    // Methods no route uses are refused too (not a "method not allowed" that could hide a new route).
    for (const method of ['PATCH', 'DELETE', 'PUT', 'POST']) {
      expect((await ctx.viewer.call(method, '/api/admin/sessions', {})).status).toBe(403);
      expect((await ctx.viewer.call(method, '/api/does-not-exist', {})).status).toBe(403);
    }
    await ctx.app.settle();
    expect(checked).toBe((writes.length - 2) * bodies.length);
    expect(snapshot(ctx.app)).toBe(before);
  });

  it('opens every organizer read screen (every GET route) without writing anything', async () => {
    const ctx = await world();
    // Let the first load make next weeks' games (as any phone would), so the check below is about the view-only reads.
    await ctx.organizer.call('GET', '/api/admin/dashboard');
    ctx.app.advance(9 * DAY);
    // The 12-hour view-only sign-in ran out meanwhile: sign in again (that, and only that, writes).
    expect((await ctx.viewer.call('POST', '/api/admin/login', { pin: RO_PIN })).status).toBe(200);
    const before = snapshot(ctx.app);
    const reads = routeList().filter((r) => r.method === 'GET');
    expect(reads.length).toBeGreaterThan(10);
    const ids = { session: ctx.s.id, player: ctx.byName.Blair };
    for (const r of reads) {
      const path = fill(r.path, ids);
      const url = path === '/api/admin/money' || path === '/api/admin/month-games' ? `${path}?month=2026-10` : path;
      // (Zip 13: the Players redo summary only exists with its switch on: this phone's private test header turns it on for the read.)
      const res = await ctx.viewer.call('GET', url, undefined, r.path.endsWith('/summary') ? { 'X-Players-Redo': 'on' } : {});
      if (r.path === '/api/cal/:param') expect(res.status).toBe(404); // retired feed: always Not found
      else if (r.path === '/api/admin/month-games') expect([200, 409], url).toContain(res.status); // 409 = Money rework switch off here
      else expect(res.status, url).toBe(200);
    }
    await ctx.app.settle();
    // 9 days later the dashboard would add games; on a view-only read it adds none.
    expect(snapshot(ctx.app)).toBe(before);
    // The same reads by the real organizer still do their usual upkeep.
    await ctx.organizer.call('GET', '/api/admin/dashboard');
    expect(snapshot(ctx.app)).not.toBe(before);
  });

  it('reads the real numbers: the same dashboard as the real PIN', async () => {
    const ctx = await world();
    const real = await ctx.organizer.call('GET', '/api/admin/dashboard');
    const ro = await ctx.viewer.call('GET', '/api/admin/dashboard');
    const { viewOnly, ...rest } = ro.data;
    expect(viewOnly).toBe(true);
    expect(rest).toEqual(real.data);
  });

  it('lets a view-only phone sign out, and sign in again with the real PIN', async () => {
    const ctx = await world();
    expect((await ctx.viewer.call('POST', '/api/admin/logout', {})).status).toBe(200);
    expect((await ctx.viewer.call('GET', '/api/admin/dashboard')).status).toBe(401);
    expect((await ctx.viewer.call('POST', '/api/admin/login', { pin: RO_PIN })).status).toBe(200);
    expect((await ctx.viewer.call('POST', '/api/admin/login', { pin: PIN })).status).toBe(200);
    const dash = await ctx.viewer.call('GET', '/api/admin/dashboard');
    expect(dash.data.viewOnly).toBeUndefined();
    expect((await ctx.viewer.call('PUT', '/api/admin/group', { name: 'Renamed by the real PIN' })).status).toBe(200);
  });

  it('the real PIN still works exactly as before, with or without the secret', async () => {
    const ctx = await world();
    const real = ctx.app.client();
    expect((await real.call('POST', '/api/admin/login', { pin: PIN })).status).toBe(200);
    expect(real.cookies.get('pb_admin')!.startsWith('ro.')).toBe(false);
    expect((await real.call('PUT', '/api/admin/group', { name: 'Still saves' })).status).toBe(200);
    delete ctx.app.env.ORGANIZER_READONLY_PIN;
    const again = ctx.app.client();
    expect((await again.call('POST', '/api/admin/login', { pin: PIN })).status).toBe(200);
    expect((await again.call('PUT', '/api/admin/group', { name: 'Saves with no secret too' })).status).toBe(200);
    expect((await real.call('GET', '/api/admin/dashboard')).status).toBe(200);
  });

  it('no secret = the feature does not exist: the PIN is refused and an existing view-only sign-in stops working', async () => {
    const ctx = await world();
    delete ctx.app.env.ORGANIZER_READONLY_PIN;
    expect((await ctx.viewer.call('GET', '/api/admin/dashboard')).status).toBe(401);
    const c = ctx.app.client();
    expect((await c.call('POST', '/api/admin/login', { pin: RO_PIN })).status).toBe(401);
    // A malformed secret counts as no secret.
    for (const bad of ['', '12345', 'abcdefgh', '1234567890123', ' 5830 2917']) {
      ctx.app.env.ORGANIZER_READONLY_PIN = bad;
      ctx.app.advance(16 * 60_000); // past the lockout window, so each try is a real PIN check
      const d = ctx.app.client();
      expect((await d.call('POST', '/api/admin/login', { pin: bad.trim() || '000000' })).status, JSON.stringify(bad)).toBe(401);
    }
  });

  it('a forged or altered view-only cookie gets nothing', async () => {
    const ctx = await world();
    const token = ctx.viewer.cookies.get('pb_admin')!;
    const stripped = ctx.app.client();
    stripped.cookies.set('pb_admin', token.slice(3)); // the prefix taken off: no such sign-in
    expect((await stripped.call('GET', '/api/admin/dashboard')).status).toBe(401);
    expect((await stripped.call('PUT', '/api/admin/group', { name: 'x' })).status).toBe(401);
    const realToken = ctx.organizer.cookies.get('pb_admin')!;
    const prefixed = ctx.app.client();
    prefixed.cookies.set('pb_admin', `ro.${realToken}`); // a real sign-in with the prefix added: also no such sign-in
    expect((await prefixed.call('GET', '/api/admin/dashboard')).status).toBe(401);
    // A row marked view-only whose cookie lacks the prefix (should never exist) is refused too.
    ctx.app.db.raw.prepare("UPDATE admin_sessions SET id = 'ro:' || id WHERE id NOT LIKE 'ro:%'").run();
    expect((await ctx.organizer.call('GET', '/api/admin/dashboard')).status).toBe(401);
  });

  it('wrong PINs are rate limited the same way, and both PINs share the lockout', async () => {
    const ctx = await world();
    const c = ctx.app.client();
    for (let i = 0; i < 5; i++) expect((await c.call('POST', '/api/admin/login', { pin: '11112222' })).status).toBe(401);
    // Locked: neither the read-only PIN nor the real PIN gets in.
    expect((await c.call('POST', '/api/admin/login', { pin: RO_PIN })).status).toBe(429);
    expect((await c.call('POST', '/api/admin/login', { pin: PIN })).status).toBe(429);
    ctx.app.advance(16 * 60_000);
    expect((await c.call('POST', '/api/admin/login', { pin: RO_PIN })).status).toBe(200);
    // Guesses aimed at the read-only PIN count against the real one too (one counter, per phone and overall).
    const d = ctx.app.client();
    d.cookies.clear();
    const burst = await Promise.all(Array.from({ length: 30 }, (_, i) => d.call('POST', '/api/admin/login', { pin: String(58302900 + i) })));
    expect(burst.filter((r) => r.status === 200).length).toBe(0);
    expect(burst.filter((r) => r.status === 401).length).toBeLessThanOrEqual(5);
  });

  it('a view-only sign-in ends after 12 hours; a PIN change signs it out with every other organizer device', async () => {
    const ctx = await world();
    ctx.app.advance(12 * HOUR + 60_000);
    expect((await ctx.viewer.call('GET', '/api/admin/dashboard')).status).toBe(401);
    expect((await ctx.organizer.call('GET', '/api/admin/dashboard')).status).toBe(200);
    expect((await ctx.viewer.call('POST', '/api/admin/login', { pin: RO_PIN })).status).toBe(200);
    expect((await ctx.organizer.call('POST', '/api/admin/pin', { currentPin: PIN, newPin: '135791' })).status).toBe(200);
    expect((await ctx.viewer.call('GET', '/api/admin/dashboard')).status).toBe(401);
  });

  it('the real PIN can never be changed to the read-only one', async () => {
    const ctx = await world();
    const res = await ctx.organizer.call('POST', '/api/admin/pin', { currentPin: PIN, newPin: RO_PIN });
    expect(res.status).toBe(400);
    expect((await ctx.organizer.call('POST', '/api/admin/pin', { currentPin: PIN, newPin: '97531135' })).status).toBe(200);
  });

  it('"Pretend it\'s" still works for a view-only phone (reads only)', async () => {
    const ctx = await world();
    const res = await ctx.viewer.call('GET', '/api/admin/dashboard', undefined, { 'X-Pretend-Now': '2026-11-03T23:30:00.000Z' });
    expect(res.status).toBe(200);
    const w = await ctx.viewer.call('POST', `/api/admin/sessions/${ctx.s.id}/me`, { in: true }, { 'X-Pretend-Now': '2026-11-03T23:30:00.000Z' });
    expect(w.status).toBe(403);
  });

  it('the view-only database lets only plain reads through', () => {
    for (const sql of ['SELECT * FROM players', '  select 1', 'WITH x AS (SELECT 1) SELECT * FROM x']) expect(isReadSql(sql), sql).toBe(true);
    for (const sql of [
      'INSERT INTO players VALUES (1)',
      'UPDATE groups SET name = 1',
      'DELETE FROM sessions',
      'REPLACE INTO t VALUES (1)',
      'WITH x AS (SELECT 1) INSERT INTO t SELECT * FROM x',
      'WITH x AS (SELECT 1) DELETE FROM t',
      'PRAGMA foreign_keys = off',
      'CREATE TABLE t (a)',
      'SELECT 1; DELETE FROM t',
      'INSERT INTO t SELECT 1 RETURNING *',
      'SELECT * FROM t RETURNING *',
      '',
    ])
      expect(isReadSql(sql), sql).toBe(false);
  });

  it('the backup file a view-only phone downloads has no PIN hash or group word hash (the real PIN cannot be guessed from it)', async () => {
    const ctx = await world();
    const ro = JSON.parse((await ctx.viewer.call('GET', '/api/admin/backup')).text);
    const real = JSON.parse((await ctx.organizer.call('GET', '/api/admin/backup')).text);
    expect(real.tables.groups[0].admin_pin_hash).toMatch(/^pbkdf2-sha256\$/);
    expect(ro.tables.groups[0].admin_pin_hash).toBe('');
    expect(ro.tables.groups[0].group_word_hash).toBeNull();
    expect(JSON.stringify(ro)).not.toContain(real.tables.groups[0].admin_pin_hash);
    // Everything else is the same file.
    const strip = (b: any) => ({ ...b, tables: { ...b.tables, groups: b.tables.groups.map((g: any) => ({ ...g, admin_pin_hash: '', group_word_hash: null })) } });
    expect(ro).toEqual(strip(real));
    // No other read answer carries the hash either.
    for (const r of routeList().filter((x) => x.method === 'GET' && !x.path.includes(':param'))) {
      const res = await ctx.viewer.call('GET', r.path === '/api/admin/money' ? `${r.path}?month=2026-10` : r.path);
      expect(res.text, r.path).not.toContain(real.tables.groups[0].admin_pin_hash);
    }
  });

  it('changing the secret to a new PIN signs every view-only phone out at once (putting the same PIN back lets them in again: they know it anyway)', async () => {
    const ctx = await world();
    expect((await ctx.viewer.call('GET', '/api/admin/dashboard')).status).toBe(200);
    ctx.app.env.ORGANIZER_READONLY_PIN = '61094827';
    expect((await ctx.viewer.call('GET', '/api/admin/dashboard')).status).toBe(401);
    ctx.app.env.ORGANIZER_READONLY_PIN = RO_PIN;
    expect((await ctx.viewer.call('GET', '/api/admin/dashboard')).status).toBe(200); // same PIN again: same fingerprint
    ctx.app.env.ORGANIZER_READONLY_PIN = '61094827';
    const again = ctx.app.client();
    expect((await again.call('POST', '/api/admin/login', { pin: '61094827' })).status).toBe(200);
    expect((await again.call('GET', '/api/admin/dashboard')).data.viewOnly).toBe(true);
    expect((await again.call('POST', '/api/admin/login', { pin: RO_PIN })).status).toBe(401);
  });

  it('a secret saved with a stray space or new line still works (trimmed)', async () => {
    const ctx = await world();
    ctx.app.env.ORGANIZER_READONLY_PIN = `${RO_PIN}\n`;
    expect((await ctx.viewer.call('GET', '/api/admin/dashboard')).data.viewOnly).toBe(true);
    const c = ctx.app.client();
    expect((await c.call('POST', '/api/admin/login', { pin: RO_PIN })).status).toBe(200);
  });
});
