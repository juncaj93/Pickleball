// Behind-the-scenes audit (Sun Nov 1, 2026): sign-in and security, swept
// over EVERY route in server/app.ts (read from the source, so a new route is
// covered without editing this file). Throwaway in-memory database only.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { handleApi } from '../server/app';
import { DAY, ORIGIN, PIN, playerPhone, setupGroup, TestApp } from './harness';

const ROUTES = [...readFileSync(join(process.cwd(), 'server/app.ts'), 'utf8').matchAll(/route\('(GET|POST|PUT|DELETE)', '([^']+)'/g)].map((m) => ({ method: m[1], path: m[2] }));
// Login and logout are open on purpose (signing out with no session does nothing).
const ADMIN_ROUTES = ROUTES.filter((r) => r.path.startsWith('/api/admin/') && r.path !== '/api/admin/login' && r.path !== '/api/admin/logout');
const fill = (path: string, id: string) => path.replace(/:(\w+)/g, () => id);

/** Things an error answer must never show. */
const LEAKS = /\bat \w+ \(|node:|\.ts:\d|SQLITE|sqlite|D1_|constraint failed|no such (table|column)|TypeError|ReferenceError|stack/i;

async function world() {
  const ctx = await setupGroup();
  const dash = (await ctx.organizer.call('GET', '/api/admin/dashboard')).data;
  const session = dash.sessions.find((s: any) => Date.parse(s.startsAt) > ctx.app.now);
  const blair = await playerPhone(ctx, 'Blair');
  const casey = await playerPhone(ctx, 'Casey');
  return { ctx, session, blair, casey };
}

describe('every organizer route refuses without a valid organizer session', () => {
  it(`found ${ADMIN_ROUTES.length} organizer routes in server/app.ts`, () => {
    expect(ADMIN_ROUTES.length).toBeGreaterThanOrEqual(39);
  });

  it('no cookie, a player cookie, a made-up cookie, a signed-out cookie and an expired one all get 401 and change nothing', async () => {
    const { ctx, session, blair } = await world();
    const before = JSON.stringify(ctx.app.db.raw.prepare('SELECT * FROM sessions ORDER BY id').all()) + JSON.stringify(ctx.app.db.raw.prepare('SELECT * FROM players ORDER BY id').all());
    const anon = ctx.app.client();
    anon.groupKey = ctx.groupKey;
    const forged = ctx.app.client();
    forged.cookies.set('pb_admin', 'A'.repeat(43));
    // A real organizer session that signed out.
    const old = ctx.app.client();
    expect((await old.call('POST', '/api/admin/login', { pin: PIN })).status).toBe(200);
    const oldCookie = old.cookies.get('pb_admin')!;
    await old.call('POST', '/api/admin/logout', {});
    const out = ctx.app.client();
    out.cookies.set('pb_admin', oldCookie);
    for (const who of [anon, blair, forged, out]) {
      for (const r of ADMIN_ROUTES) {
        const res = await who.call(r.method, fill(r.path, session.id), r.method === 'POST' || r.method === 'PUT' ? { pin: PIN, name: 'X', status: 'booked', decision: 'cancel', confirm: true, booked: false } : undefined);
        expect(res.status, `${r.method} ${r.path}`).toBe(401);
      }
    }
    // 30 days later the organizer's own session has expired.
    const fresh = ctx.app.client();
    await fresh.call('POST', '/api/admin/login', { pin: PIN });
    ctx.app.advance(31 * DAY);
    expect((await fresh.call('GET', '/api/admin/dashboard')).status).toBe(401);
    ctx.app.advance(-31 * DAY);
    const after = JSON.stringify(ctx.app.db.raw.prepare('SELECT * FROM sessions ORDER BY id').all()) + JSON.stringify(ctx.app.db.raw.prepare('SELECT * FROM players ORDER BY id').all());
    expect(after).toBe(before);
  });

  it('the cron tick and the TEST alerts answer Not found / 401 to anyone without the secret or the PIN', async () => {
    const { ctx, blair } = await world();
    for (const who of [ctx.app.client(), blair]) {
      expect((await who.call('POST', '/api/cron/tick', {})).status).toBe(404);
      expect((await who.call('POST', '/api/admin/alerts/test', {})).status).toBe(401);
      expect((await who.call('POST', '/api/admin/alerts/smart-test', {})).status).toBe(401);
    }
  });
});

describe('cookies and the PIN', () => {
  it('organizer cookie: HttpOnly, Secure, SameSite=Strict, only for /api, 30 days; player cookie: HttpOnly, Secure, Lax, 1 year', async () => {
    const { ctx } = await world();
    const c = ctx.app.client();
    const res = await c.call('POST', '/api/admin/login', { pin: PIN });
    const admin = res.headers.getSetCookie().find((x) => x.startsWith('pb_admin='))!;
    expect(admin).toMatch(/; Path=\/api; HttpOnly; SameSite=Strict; Max-Age=2592000; Secure$/);
    const p = ctx.app.client();
    p.groupKey = ctx.groupKey;
    const pick = await p.call('POST', '/api/me', { playerId: ctx.byName.Blair });
    const player = pick.headers.getSetCookie().find((x) => x.startsWith('pb_player='))!;
    expect(player).toMatch(/; Path=\/api; HttpOnly; SameSite=Lax; Max-Age=31536000; Secure$/);
  });

  it('5 wrong PINs from one phone lock it out for 15 minutes, even for the right PIN; 20 overall locks everyone', async () => {
    const { ctx } = await world();
    const bad = ctx.app.client();
    const codes = [];
    for (let i = 0; i < 7; i++) codes.push((await bad.call('POST', '/api/admin/login', { pin: '000000' }, { 'CF-Connecting-IP': '10.0.0.1' })).status);
    expect(codes).toEqual([401, 401, 401, 401, 401, 429, 429]);
    expect((await bad.call('POST', '/api/admin/login', { pin: PIN }, { 'CF-Connecting-IP': '10.0.0.1' })).status).toBe(429);
    // Another phone still gets in.
    expect((await ctx.app.client().call('POST', '/api/admin/login', { pin: PIN }, { 'CF-Connecting-IP': '10.0.0.2' })).status).toBe(200);
    ctx.app.advance(16 * 60_000);
    expect((await bad.call('POST', '/api/admin/login', { pin: PIN }, { 'CF-Connecting-IP': '10.0.0.1' })).status).toBe(200);
    // A spread-out guesser (a new address each time) hits the overall cap of 20.
    const spread = [];
    for (let i = 0; i < 25; i++) spread.push((await ctx.app.client().call('POST', '/api/admin/login', { pin: '111111' }, { 'CF-Connecting-IP': `10.1.0.${i}` })).status);
    expect(spread.filter((s) => s === 401).length).toBe(20);
    expect(spread.slice(-3)).toEqual([429, 429, 429]);
    // A burst of 30 guesses at once: still at most 5 PIN checks for that phone.
    ctx.app.advance(16 * 60_000);
    const burst = await Promise.all(Array.from({ length: 30 }, () => ctx.app.client().call('POST', '/api/admin/login', { pin: '222222' }, { 'CF-Connecting-IP': '10.2.0.1' })));
    expect(burst.filter((r) => r.status === 401).length).toBeLessThanOrEqual(5);
  });
});

describe('requests from other sites (CSRF) and odd requests', () => {
  it('a state-changing request from another site, or not sent as JSON, is refused', async () => {
    const { ctx, session, blair } = await world();
    const evil = await blair.call('POST', `/api/sessions/${session.id}/join`, {}, { Origin: 'https://evil.example' });
    expect(evil.status).toBe(403);
    // A plain HTML form can only send form or text bodies: refused before anything happens.
    for (const type of ['application/x-www-form-urlencoded', 'text/plain', 'multipart/form-data; boundary=x']) {
      const res = await handleApi(
        new Request(`${ORIGIN}/api/sessions/${session.id}/join`, { method: 'POST', headers: { 'Content-Type': type, 'X-Group-Key': ctx.groupKey, Cookie: [...blair.cookies].map(([k, v]) => `${k}=${v}`).join('; ') }, body: 'a=b' }),
        ctx.app.env,
        ctx.app.now,
      );
      expect(res.status, type).toBe(415);
    }
    const seats = ctx.app.db.raw.prepare('SELECT COUNT(*) AS n FROM session_players').get() as any;
    expect(seats.n).toBe(0);
  });

  it('a cookie with a broken %-escape (say from another site on the same domain) never breaks the site (fresh audit A)', async () => {
    const { ctx } = await world();
    const res = await handleApi(new Request(`${ORIGIN}/api/status`, { headers: { Cookie: 'x=%E0%A4%A; pb_player=%' } }), ctx.app.env, ctx.app.now);
    expect(res.status).toBe(200);
    const admin = await handleApi(new Request(`${ORIGIN}/api/admin/dashboard`, { headers: { Cookie: 'pb_admin=%E0%A4%A' } }), ctx.app.env, ctx.app.now);
    expect(admin.status).toBe(401);
  });

  it('broken addresses, wrong methods and huge bodies get a plain answer, never a server error', async () => {
    const { blair } = await world();
    expect((await blair.call('POST', '/api/sessions/%E0%A4%A/join', {})).status).toBe(404);
    expect((await blair.call('PATCH', '/api/group')).status).toBe(405);
    expect((await blair.call('POST', '/api/me', 'x'.repeat(30_000))).status).toBe(413);
    expect((await blair.call('POST', '/api/me', [1, 2])).status).toBe(400);
    const r = await blair.call('GET', `/api/${'a/'.repeat(2000)}`);
    expect(r.status).toBe(404);
  });
});

describe('player routes act only on the player whose phone it is (IDOR)', () => {
  it('ids put in the body or the address never let Blair act for Casey or read Casey\'s money', async () => {
    const { ctx, session, blair, casey } = await world();
    const caseyId = ctx.byName.Casey;
    const PLAYER_ROUTES = ROUTES.filter((r) => !r.path.startsWith('/api/admin') && !['/api/setup', '/api/cron/tick'].includes(r.path) && r.method !== 'GET');
    const snapshot = () => JSON.stringify(ctx.app.db.raw.prepare("SELECT * FROM session_players WHERE player_id = ?").all(caseyId)) + JSON.stringify(ctx.app.db.raw.prepare('SELECT * FROM credit_ledger WHERE player_id = ?').all(caseyId)) + JSON.stringify(ctx.app.db.raw.prepare('SELECT * FROM refund_requests WHERE player_id = ?').all(caseyId));
    // Casey has a seat and some credit.
    await casey.call('POST', `/api/sessions/${session.id}/join`, {});
    const before = snapshot();
    for (const r of PLAYER_ROUTES) {
      if (r.path === '/api/me' || r.path === '/api/players/self' || r.path === '/api/access' || r.path.startsWith('/api/link') || r.path === '/api/go') continue;
      const body = { playerId: caseyId, player_id: caseyId, id: caseyId, cents: 1400, amountCents: 1400, days: [2] };
      const res = await blair.call(r.method, fill(r.path, session.id), r.method === 'DELETE' ? undefined : body);
      expect(res.status, `${r.method} ${r.path}`).toBeLessThan(500);
      // Using Casey's id as the game id is just a missing game.
      const res2 = await blair.call(r.method, fill(r.path, caseyId), r.method === 'DELETE' ? undefined : body);
      expect(res2.status, `${r.method} ${r.path} with a player id`).toBeLessThan(500);
    }
    await ctx.app.settle();
    expect(snapshot()).toBe(before);
    // What Blair's phone can read never holds Casey's money.
    const view = await blair.call('GET', '/api/group');
    const caseyRows = JSON.stringify(view.data).match(new RegExp(`"${caseyId}"[^}]*`, 'g')) ?? [];
    for (const row of caseyRows) expect(row).not.toMatch(/credit|paid|cents|venmo|phone/i);
  });
});

describe('every field: huge, emoji, HTML, SQL, wrong types, negative or giant numbers', () => {
  const NASTY: unknown[] = [
    'x'.repeat(19_000),
    '🏓'.repeat(50),
    '<script>alert(1)</script>',
    "'; DROP TABLE players; --",
    '\u0000‮',
    -1,
    -1e308,
    1e308,
    2 ** 53 + 1,
    0.5,
    NaN,
    true,
    null,
    [],
    [1, 'a', null],
    { a: { b: { c: 1 } } },
    '2026-02-30T25:61:00Z',
    '../../etc/passwd',
  ];
  const FIELDS = ['name', 'phone', 'pin', 'newPin', 'currentPin', 'playerId', 'startsAt', 'endsAt', 'status', 'decision', 'reason', 'action', 'cents', 'chargedCents', 'courtCostCents', 'pricePerPlayerCents', 'maxPlayers', 'mark', 'token', 'venmo', 'venmoUrl', 'note', 'played', 'everyone', 'confirm', 'usualDays', 'days', 'groupWord', 'word', 'smartAlerts', 'enabled', 'reservationReference', 'requestId', 'amountCents', 'settings', 'firstSessionDate', 'paid', 'method', 'confirmNew', 'groupName'];

  it('no route answers 5xx or shows database or code text, signed in as the organizer or as a player', async () => {
    const { ctx, session, blair } = await world();
    const errors: string[] = [];
    const playerId = ctx.byName.Devon;
    for (const who of [ctx.organizer, blair]) {
      for (const r of ROUTES) {
        if (r.method === 'GET' || r.method === 'DELETE' || r.path === '/api/admin/logout' || r.path === '/api/admin/rotate-link' || r.path === '/api/admin/pin') continue;
        for (const value of NASTY) {
          const body: Record<string, unknown> = {};
          for (const f of FIELDS) body[f] = value;
          const res = await who.call(r.method, fill(r.path, r.path.includes('/players/') ? playerId : session.id), body);
          if (res.status >= 500 || LEAKS.test(res.text)) errors.push(`${res.status} ${r.method} ${r.path} <- ${JSON.stringify(value).slice(0, 30)}: ${res.text.slice(0, 120)}`);
        }
      }
    }
    await ctx.app.settle();
    expect(errors).toEqual([]);
    // Still one group, nobody's PIN changed, the database still answers.
    expect((await ctx.organizer.call('GET', '/api/admin/dashboard')).status).toBe(200);
  }, 120_000);

  it('a server error shows a plain message, never the error itself', async () => {
    const app = new TestApp();
    const ctx = await setupGroup(app);
    app.db.raw.exec('DROP TABLE organizer_alerts');
    const res = await ctx.organizer.call('PUT', '/api/admin/alerts', { enabled: true });
    expect(res.status).toBe(500);
    expect(res.data).toEqual({ error: 'server_error', message: 'Something went wrong. Try again.' });
  });
});

describe('no secrets in the repo or the built site', () => {
  it('no Telegram token, Cloudflare token or private key in tracked files', async () => {
    const { execSync } = await import('node:child_process');
    const files = execSync('git ls-files', { encoding: 'utf8' }).split('\n').filter((f) => f && !/\.(png|jpg|ico|woff2?)$/.test(f) && !f.includes('package-lock'));
    const hits: string[] = [];
    for (const f of files) {
      let text = '';
      try {
        text = readFileSync(f, 'utf8');
      } catch {
        continue;
      }
      if (/\b\d{8,10}:[A-Za-z0-9_-]{35}\b/.test(text)) hits.push(`${f}: Telegram-shaped token`);
      if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(text)) hits.push(`${f}: private key`);
      if (/CLOUDFLARE_API_TOKEN\s*=\s*['"]?[A-Za-z0-9_-]{30,}/.test(text)) hits.push(`${f}: Cloudflare token`);
    }
    expect(hits).toEqual([]);
  });
});
