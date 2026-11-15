// Zip 47 audit probe (security): every POST / PUT / PATCH / DELETE route in server/app.ts (the live route list, so new routes are covered),
// called signed out, from a player phone, from a forged organizer cookie, from another site, and with the read-only PIN, with every feature
// switch ON first (so feature-gated routes reach their real code). Each caller must be refused and the database must not change.
// In-memory database only.
import { describe, expect, it } from 'vitest';
import { routeList } from '../../../server/app';
import { firstSession, PIN, playerPhone, setupGroup, TestApp, type Client } from '../../harness';

const RO_PIN = '58302917';

/** Every row of every table except the attempt counters (a refused sign-in or a refused rate-limited tap may count itself). */
function snapshot(app: TestApp, skip: string[] = ['login_attempts', 'rate_events']): string {
  const tables = (app.db.raw.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as { name: string }[])
    .map((t) => t.name)
    .filter((t) => !skip.includes(t));
  return tables.map((t) => `${t}:${JSON.stringify(app.db.raw.prepare(`SELECT * FROM "${t}" ORDER BY rowid`).all())}`).join('\n');
}

function diffTables(a: string, b: string): string[] {
  const la = a.split('\n');
  const lb = b.split('\n');
  const out: string[] = [];
  for (let i = 0; i < Math.max(la.length, lb.length); i++) if (la[i] !== lb[i]) out.push((la[i] ?? lb[i]).split(':')[0]);
  return out;
}

const WRITES = routeList().filter((r) => r.method !== 'GET' && r.method !== 'HEAD');

/** Turn every feature switch on (PUT /api/admin/*-switch), Christmas skin to Everyone. */
async function allSwitchesOn(o: Client) {
  const switches = routeList().filter((r) => r.method === 'PUT' && /-switch$/.test(r.path));
  const failed: string[] = [];
  for (const r of switches) {
    const bodies = r.path.includes('christmas') ? [{ mode: 'all' }] : r.path.includes('motion') ? [{ which: 'player', on: true }, { which: 'admin', on: true }] : [{ on: true }];
    for (const body of bodies) {
      const res = await o.call('PUT', r.path, body);
      if (res.status !== 200) failed.push(`${r.path} ${res.status} ${res.text.slice(0, 80)}`);
    }
  }
  // Plain PUT switches that are not named *-switch.
  for (const p of ['/api/admin/time-shift', '/api/admin/pay-always', '/api/admin/admin-v2', '/api/admin/admin-r2', '/api/admin/admin-r3', '/api/admin/pay-note', '/api/admin/player-fix1', '/api/admin/texts-r2', '/api/admin/late-fee-split', '/api/admin/money-rework', '/api/admin/instant-taps', '/api/admin/pay-sheet', '/api/admin/late-fees']) {
    await o.call('PUT', p, { on: true });
  }
  return { count: switches.length, failed };
}

async function world() {
  const ctx = await setupGroup();
  ctx.app.env.ORGANIZER_READONLY_PIN = RO_PIN;
  const sw = await allSwitchesOn(ctx.organizer);
  const s = await firstSession(ctx);
  for (const name of ['Blair', 'Casey', 'Devon', 'Emery']) {
    const phone = await playerPhone(ctx, name);
    expect((await phone.call('POST', `/api/sessions/${s.id}/join`, {})).status).toBe(200);
  }
  await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/payment`, { playerId: ctx.byName.Casey, paid: true });
  const g = await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/guest`, { playerId: ctx.byName.Casey, name: 'Sam' });
  return { ...ctx, s, sw, guestAdded: g.status };
}

function fill(path: string, ids: { session: string; player: string }): string {
  if (path.includes('/sessions/:param')) return path.replace(':param', ids.session);
  if (path.includes('/players/:param')) return path.replace(':param', ids.player);
  if (path.includes('/refund-requests/:param')) return path.replace(':param', ids.player);
  return path.replace(/:param/g, 'x0000000-0000-4000-8000-000000000000');
}

function bodiesFor(ids: { session: string; player: string }): Record<string, unknown>[] {
  return [
    {},
    { on: true, mode: 'all' },
    {
      paid: true,
      playerId: ids.player,
      confirm: true,
      decision: 'cancel',
      name: 'Hacked',
      pin: PIN,
      currentPin: PIN,
      newPin: '999999',
      who: 'guest',
      direction: 'add',
      cents: 1400,
      seen: 0,
      keys: ['court:2026-10'],
      token: 'x.y',
      note: 'hacked',
      status: 'booked',
    },
  ];
}

/** Routes anyone may call on purpose, and what they may do. */
const OPEN = new Set([
  'POST /api/setup', // needs the setup token, and refuses once set up
  'POST /api/access', // the group word
  'POST /api/admin/login',
  'POST /api/admin/logout',
  'DELETE /api/me', // forget my name on this phone
  'POST /api/go', // signed token
  'POST /api/gdt', // signed token
  'POST /api/cron/tick', // secret header
  'POST /api/cron/report', // secret header
]);

describe('Zip 47 probe: every write route needs the right sign-in', () => {
  it('world: switches on, guest added', async () => {
    const w = await world();
    expect(w.sw.failed).toEqual([]);
    expect(w.sw.count).toBeGreaterThan(30);
    expect(w.guestAdded).toBe(200);
    expect(WRITES.length).toBeGreaterThan(100);
  });

  it('signed out (no link key, no cookie): every write is refused and nothing changes', async () => {
    const w = await world();
    const ids = { session: w.s.id, player: w.byName.Casey };
    const before = snapshot(w.app);
    const bare = w.app.client();
    const allowed: string[] = [];
    for (const r of WRITES) {
      // With "Anyone with the site address" on, the bare address IS the player link: picking a name is the accepted way in.
      if (r.path === '/api/me' && r.method === 'POST') continue;
      if (r.path === '/api/players/self') continue;
      for (const body of bodiesFor(ids)) {
        const res = await bare.call(r.method, fill(r.path, ids), body);
        if (res.status < 400 && res.data?.applied !== false && !OPEN.has(`${r.method} ${r.path}`)) allowed.push(`${r.method} ${r.path} ${res.status}`);
      }
    }
    expect(allowed).toEqual([]);
    expect(diffTables(before, snapshot(w.app))).toEqual([]);
  });

  it('link key but no name picked: only the name picker and Add my name may work; nothing else changes', async () => {
    const w = await world();
    const ids = { session: w.s.id, player: w.byName.Casey };
    const before = snapshot(w.app);
    const anon = w.app.client();
    anon.groupKey = w.groupKey;
    const allowed: string[] = [];
    for (const r of WRITES) {
      const key = `${r.method} ${r.path}`;
      if (key === 'POST /api/me' || key === 'POST /api/players/self') continue;
      for (const body of bodiesFor(ids)) {
        const res = await anon.call(r.method, fill(r.path, ids), body);
        if (res.status < 400 && res.data?.applied !== false && !OPEN.has(key)) allowed.push(`${key} ${res.status} ${res.text.slice(0, 60)}`);
      }
    }
    expect(allowed).toEqual([]);
    expect(diffTables(before, snapshot(w.app))).toEqual([]);
  });

  it('a player phone (Blair), and forged organizer cookies: every organizer and clock route is refused, nothing changes', async () => {
    const w = await world();
    const ids = { session: w.s.id, player: w.byName.Casey };
    const blair = await playerPhone(w, 'Blair');
    const forgedRo = await playerPhone(w, 'Devon');
    forgedRo.cookies.set('pb_admin', 'ro.' + 'A'.repeat(43));
    const forged = await playerPhone(w, 'Emery');
    forged.cookies.set('pb_admin', 'B'.repeat(43));
    const before = snapshot(w.app);
    const allowed: string[] = [];
    for (const who of [blair, forgedRo, forged]) {
      for (const r of WRITES) {
        if (!r.path.startsWith('/api/admin/') && !r.path.startsWith('/api/cron/')) continue;
        if (r.path === '/api/admin/login' || r.path === '/api/admin/logout') continue;
        for (const body of bodiesFor(ids)) {
          const res = await who.call(r.method, fill(r.path, ids), body);
          if (res.status < 400) allowed.push(`${r.method} ${r.path} ${res.status}`);
        }
      }
    }
    expect(allowed).toEqual([]);
    expect(diffTables(before, snapshot(w.app))).toEqual([]);
  });

  it("a player phone (Blair) calling every player route with Casey's id in the body never touches Casey's rows", async () => {
    const w = await world();
    const caseyId = w.byName.Casey;
    const ids = { session: w.s.id, player: caseyId };
    const blair = await playerPhone(w, 'Blair');
    // Casey also asks for a cash out, so a refund-request row of hers exists.
    const casey = await playerPhone(w, 'Casey');
    await casey.call('POST', '/api/me/refund-request', { cents: 0 });
    const caseyRows = () =>
      snapshot(w.app, ['login_attempts', 'rate_events', 'admin_audit_log'])
        .split('\n')
        .map((line) => {
          const [t, ...rest] = line.split(':');
          const rows = JSON.parse(rest.join(':')) as Record<string, unknown>[];
          return `${t}:${JSON.stringify(rows.filter((row) => JSON.stringify(row).includes(caseyId)))}`;
        })
        .join('\n');
    const before = caseyRows();
    for (const r of WRITES) {
      if (r.path.startsWith('/api/admin/') || r.path.startsWith('/api/cron/') || r.path === '/api/setup') continue;
      if (r.method === 'DELETE' && r.path === '/api/me') continue;
      if (r.path === '/api/me') continue; // picking a name is the accepted way to become anyone (docs/STAGE_NOTES.md)
      for (const body of bodiesFor(ids)) {
        await blair.call(r.method, fill(r.path, ids), { ...body, playerId: caseyId, player: caseyId, hostId: caseyId });
        // Also with Casey's id as a header the server might read.
        await blair.call(r.method, fill(r.path, ids), body, { 'X-View-As': caseyId });
      }
    }
    expect(diffTables(before, caseyRows())).toEqual([]);
  });

  it('read-only PIN with every switch on: every write refused 403 view_only, nothing changes', async () => {
    const w = await world();
    const ids = { session: w.s.id, player: w.byName.Casey };
    const viewer = w.app.client();
    viewer.groupKey = w.groupKey;
    expect((await viewer.call('POST', '/api/admin/login', { pin: RO_PIN })).status).toBe(200);
    // A view-only phone that also picked a name (player cookie too).
    const both = await playerPhone(w, 'Blair');
    expect((await both.call('POST', '/api/admin/login', { pin: RO_PIN })).status).toBe(200);
    const before = snapshot(w.app);
    const wrong: string[] = [];
    for (const who of [viewer, both]) {
      for (const r of WRITES) {
        if (r.path === '/api/admin/login' || r.path === '/api/admin/logout') continue;
        for (const body of bodiesFor(ids)) {
          const res = await who.call(r.method, fill(r.path, ids), body);
          if (res.status !== 403 || res.data?.error !== 'view_only') wrong.push(`${r.method} ${r.path} ${res.status}`);
        }
      }
    }
    expect(wrong).toEqual([]);
    expect(diffTables(before, snapshot(w.app))).toEqual([]);
  });

  it('the real organizer, from another site (Origin header): every write refused 403 bad_origin, nothing changes', async () => {
    const w = await world();
    const ids = { session: w.s.id, player: w.byName.Casey };
    const blair = await playerPhone(w, 'Blair');
    const before = snapshot(w.app);
    const wrong: string[] = [];
    for (const who of [w.organizer, blair]) {
      for (const r of WRITES) {
        for (const origin of ['https://evil.example', 'null', 'https://club.example.evil.example', 'http://club.example']) {
          const res = await who.call(r.method, fill(r.path, ids), bodiesFor(ids)[2], { Origin: origin });
          if (res.status !== 403) wrong.push(`${r.method} ${r.path} ${origin} ${res.status}`);
        }
      }
    }
    expect(wrong).toEqual([]);
    expect(diffTables(before, snapshot(w.app))).toEqual([]);
  });

  it('writes that are not JSON (a plain HTML form) are refused for POST and PUT; DELETE needs no body (noted)', async () => {
    const w = await world();
    const ids = { session: w.s.id, player: w.byName.Casey };
    const wrong: string[] = [];
    for (const r of WRITES.filter((x) => x.method === 'POST' || x.method === 'PUT')) {
      const res = await w.organizer.call(r.method, fill(r.path, ids), undefined, { 'Content-Type': 'application/x-www-form-urlencoded' });
      if (res.status !== 415) wrong.push(`${r.method} ${r.path} ${res.status}`);
    }
    expect(wrong).toEqual([]);
    const deletes = WRITES.filter((x) => x.method === 'DELETE').map((x) => x.path);
    expect(deletes.sort()).toEqual(['/api/admin/players/:param', '/api/me']);
  });
});
