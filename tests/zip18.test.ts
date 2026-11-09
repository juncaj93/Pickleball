// Zip 18: "View as" shows what that player really sees (server/zip18.ts, src/demo), and the header's swap on the organizer's own page.
//
// The world: the small preview cast (Alex organizer, Vic 1 unpaid, Wren 2, Zoe 3, Quinn, Rowan, Parker, Reese, Sage, Christopher
// Vanderberg) with every Settings row on, as on live, and the live wrangler.toml [vars] (every kill switch "on").
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import initSqlJs from 'sql.js';
import { describe, expect, it } from 'vitest';
import { createSandbox, type Sandbox } from '../src/demo/sandbox';
import { buildSmallPreview, SMALL_NAMES } from '../scripts/preview-world-small';
import { Client, ORIGIN, TestApp } from './harness';
import { switchEnvOf } from '../server/zip18';

const NOW = Date.parse('2026-11-09T17:00:00.000Z'); // Mon Nov 9, 12:00 PM Eastern
const PREVIEW_PIN = /PIN `(\d{6})`/.exec(readFileSync('docs/PREVIEW_FAKE_DB.md', 'utf8'))![1];
const migrations = () => readdirSync('migrations').filter((f) => f.endsWith('.sql')).sort().map((f) => readFileSync(join('migrations', f), 'utf8'));

/** The production [vars] of wrangler.toml (the live kill switches), as the live site has them. */
function liveVars(): Record<string, string> {
  const toml = readFileSync('wrangler.toml', 'utf8');
  const top = toml.slice(toml.indexOf('[vars]'), toml.indexOf('[env.preview]'));
  const out: Record<string, string> = {};
  for (const m of top.matchAll(/^([A-Z_][A-Z0-9_]*)\s*=\s*"([^"]*)"/gm)) out[m[1]] = m[2];
  return out;
}

const TABLES = ['groups', 'players', 'sessions', 'session_players', 'credits', 'credit_ledger', 'refund_requests', 'session_action_tokens', 'player_devices', 'admin_audit_log', 'admin_sessions', 'task_log', 'organizer_alerts', 'rate_events', 'login_attempts'];

async function world(env: Record<string, string> = liveVars()) {
  const app = new TestApp();
  app.now = NOW;
  const { sql } = await buildSmallPreview(NOW);
  app.db.raw.exec(sql);
  Object.assign(app.env, env);
  const organizer = app.client();
  const login = await organizer.call('POST', '/api/admin/login', { pin: PREVIEW_PIN }, { Origin: ORIGIN });
  if (login.status !== 200) throw new Error(`login: ${login.text}`);
  const dash = (await organizer.call('GET', '/api/admin/dashboard')).data;
  const groupKey = String(dash.group.privateLink).split('/g/')[1];
  const ids: Record<string, string> = Object.fromEntries(dash.players.map((p: any) => [p.name, p.id]));
  const snapshot = () => Object.fromEntries(TABLES.map((t) => [t, app.db.raw.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all()]));
  return { app, organizer, groupKey, ids, snapshot };
}
type W = Awaited<ReturnType<typeof world>>;

async function phoneOf(w: W, name: string): Promise<Client> {
  const c = w.app.client();
  c.groupKey = w.groupKey;
  const r = await c.call('POST', '/api/me', { playerId: w.ids[name] });
  if (r.status !== 200) throw new Error(`pick ${name}: ${r.text}`);
  return c;
}

/** The organizer's demo copy, built the way src/demo/load.ts builds it (the backup plus /api/admin/demo-extras). */
async function demo(w: W, withExtras = true): Promise<Sandbox> {
  const backup = (await w.organizer.call('GET', '/api/admin/backup')).data;
  const extras = withExtras ? (await w.organizer.call('GET', '/api/admin/demo-extras')).data : null;
  return createSandbox(await initSqlJs(), backup, migrations(), ORIGIN, extras);
}
async function viewAs(sb: Sandbox, w: W, name: string, method = 'GET', path = '/api/group', body?: unknown) {
  const res = await sb.request(method, path, body, { 'X-View-As': w.ids[name] }, w.app.now);
  return { status: res.status, data: await res.json() };
}
/** What can differ between a player's own phone and View as of the same player: only the View as marker itself. */
const same = (g: any) => {
  const { viewingAs: _v, ...rest } = g;
  return rest;
};

describe('Zip 18: View as answers exactly what the player sees (the live switches)', () => {
  it('Vic (1 unpaid), Wren (2), Zoe (3) and every other name: View as = that player\'s own phone, key for key', async () => {
    const w = await world();
    const sb = await demo(w);
    for (const name of SMALL_NAMES) {
      const own = (await (await phoneOf(w, name)).call('GET', '/api/group')).data;
      const seen = (await viewAs(sb, w, name)).data;
      expect(seen.viewingAs, name).toBe(true);
      expect(same(seen), name).toEqual(same(own));
    }
  }, 120_000);

  it('the switches are really on in View as (the old look is gone): Card cleanup, Alert cards, Seat dots, Short games, Players see no count text', async () => {
    const w = await world();
    const sb = await demo(w);
    const g = (await viewAs(sb, w, 'Wren')).data;
    for (const k of ['cardCleanup', 'alertCards', 'seatDots', 'shortGames', 'cardTimeButtons', 'playerCardsSimple', 'colorCleanup', 'tonightGlow', 'homeCollapse', 'instantTaps', 'payAlways', 'paySheet', 'playerFix1', 'timeShift', 'motion', 'gameDayCard', 'afterGameCard'])
      expect(g[k], k).toBe(true);
    expect(g.unpaidNudge).toEqual({ limit: 3 });
    // Before this zip the copy had no switch rows: every one read off (the old look Alex saw for Brandon).
    const old = (await viewAs(await demo(w, false), w, 'Wren')).data;
    for (const k of ['cardCleanup', 'alertCards', 'seatDots', 'gameDayCard', 'afterGameCard', 'unpaidNudge']) expect(old[k], k).toBeUndefined();
  }, 120_000);

  it('a switch turned OFF on live is off in View as too, and a kill switch set to "off" too (any switch, no View as edit)', async () => {
    const w = await world();
    expect((await w.organizer.call('PUT', '/api/admin/seat-dots-switch', { on: false }, { Origin: ORIGIN })).status).toBe(200);
    Object.assign(w.app.env, { ALERT_CARDS: 'off' });
    const sb = await demo(w);
    const own = (await (await phoneOf(w, 'Vic')).call('GET', '/api/group')).data;
    const seen = (await viewAs(sb, w, 'Vic')).data;
    expect(own.seatDots).toBeUndefined();
    expect(own.alertCards).toBeUndefined();
    expect(same(seen)).toEqual(same(own));
  }, 120_000);

  it('the organizer\'s own name in View as: what Alex\'s player page shows on a phone that is not signed in; never the swap', async () => {
    const w = await world();
    const sb = await demo(w);
    const seen = (await viewAs(sb, w, 'Alex')).data;
    expect(seen.goToAdmin).toBeUndefined();
    expect(same(seen)).toEqual(same((await (await phoneOf(w, 'Alex')).call('GET', '/api/group')).data));
  }, 120_000);
});

describe('Zip 18: View as writes nothing real', () => {
  it('every player tap in View as (I\'m in, I paid, Drop out, Still in, Use credit, a cash out) changes only the copy; the real database is identical', async () => {
    const w = await world();
    const before = w.snapshot();
    const sb = await demo(w);
    const g = (await viewAs(sb, w, 'Wren')).data;
    const open = g.sessions.find((s: any) => !s.mine && !s.canceled);
    expect(open).toBeTruthy();
    const taps: [string, string, string, unknown][] = [
      ['Wren', 'POST', `/api/sessions/${open.id}/join`, {}],
      ['Wren', 'POST', `/api/sessions/${open.id}/paid`, { paid: true }],
      ['Wren', 'POST', `/api/sessions/${open.id}/withdraw`, {}],
      ['Vic', 'POST', `/api/sessions/${open.id}/join`, {}],
      ['Vic', 'POST', `/api/sessions/${open.id}/still-in`, {}],
      ['Parker', 'POST', '/api/me/refund-request', {}],
    ];
    let saved = 0;
    for (const [name, method, path, body] of taps) if ((await viewAs(sb, w, name, method, path, body)).status === 200) saved++;
    expect(saved).toBeGreaterThanOrEqual(3);
    // The copy changed (Vic is in there) ...
    expect((await viewAs(sb, w, 'Vic')).data.sessions.find((s: any) => s.id === open.id).mine).toBeTruthy();
    // ... the real site did not, not one row of any table.
    expect(w.snapshot()).toEqual(before);
    expect((await (await phoneOf(w, 'Vic')).call('GET', '/api/group')).data.sessions.find((s: any) => s.id === open.id).mine).toBeFalsy();
  }, 120_000);

  it('the live site itself refuses a View as save (the second wall): 403 "Demo only", nothing written', async () => {
    const w = await world();
    const before = w.snapshot();
    const g = (await w.organizer.call('GET', '/api/group', undefined, { 'X-View-As': w.ids.Vic })).data;
    const open = g.sessions.find((s: any) => !s.mine && !s.canceled);
    const r = await w.organizer.call('POST', `/api/sessions/${open.id}/join`, {}, { 'X-View-As': w.ids.Vic, Origin: ORIGIN });
    expect(r.status).toBe(403);
    expect(r.data.error).toBe('demo_only');
    expect(w.snapshot()).toEqual(before);
  }, 120_000);
});

describe('Zip 18: GET /api/admin/demo-extras', () => {
  it('organizer only; every task_log row of the group; only on/off settings (no PIN, token or secret); reading it writes nothing', async () => {
    const w = await world({ ...liveVars(), TELEGRAM_BOT_TOKEN: '123:secret-token', TELEGRAM_CHAT_ID: '42', ORGANIZER_READONLY_PIN: '55512345', SETUP_TOKEN: 'abc' });
    const before = w.snapshot();
    const r = await w.organizer.call('GET', '/api/admin/demo-extras');
    expect(r.status).toBe(200);
    const rows = w.app.db.raw.prepare('SELECT COUNT(*) AS n FROM task_log').get() as { n: number };
    expect(r.data.taskLog.length).toBe(rows.n);
    expect(r.data.taskLog.some((t: any) => t.task === 'card_cleanup_on' && t.session_id === null && t.kind === 'mark')).toBe(true);
    expect(r.data.env.CARD_CLEANUP).toBe('on');
    expect(r.text).not.toMatch(/secret-token|55512345|"abc"|SITE_URL|TELEGRAM|SETUP_TOKEN|ORGANIZER_READONLY_PIN/);
    for (const v of Object.values(r.data.env)) expect(['on', 'off']).toContain(String(v).trim().toLowerCase());
    expect(w.snapshot()).toEqual(before);
    // A player's phone, a made-up cookie, nobody: refused.
    expect((await (await phoneOf(w, 'Vic')).call('GET', '/api/admin/demo-extras')).status).toBe(401);
    expect((await w.app.client().call('GET', '/api/admin/demo-extras')).status).toBe(401);
  }, 120_000);

  it('switchEnvOf keeps exactly the on/off settings', () => {
    expect(switchEnvOf({ A_B: 'on', C: ' OFF ', D: 'onn', e_lower: 'on', F: 1, G: { on: true }, SANDBOX: 'on', PIN: '123456' })).toEqual({ A_B: 'on', C: ' OFF ' });
  });

  it('a server from before Zip 18 (no extras): the copy still starts, every switch off there, as before', async () => {
    const w = await world();
    const sb = await demo(w, false);
    const g = (await viewAs(sb, w, 'Vic')).data;
    expect(g.me.name).toBe('Vic');
    expect(g.cardCleanup).toBeUndefined();
  }, 120_000);
});

describe('Zip 18: the swap on the organizer\'s own player page', () => {
  it('only a phone signed in as the organizer, showing the organizer\'s own name; not for another name on that phone, never for a player', async () => {
    const w = await world();
    const org = w.organizer;
    org.groupKey = w.groupKey;
    expect((await org.call('POST', '/api/me', { playerId: w.ids.Alex })).status).toBe(200);
    expect((await org.call('GET', '/api/group')).data.goToAdmin).toBe(true);
    // The organizer's phone picked another name ("not you?"): no swap on that page.
    expect((await org.call('POST', '/api/me', { playerId: w.ids.Vic })).status).toBe(200);
    expect((await org.call('GET', '/api/group')).data.goToAdmin).toBeUndefined();
    // A player who picked Alex's name on their own phone: never.
    expect((await (await phoneOf(w, 'Alex')).call('GET', '/api/group')).data.goToAdmin).toBeUndefined();
    // View as Alex on the live site (reads are allowed there): never.
    expect((await org.call('GET', '/api/group', undefined, { 'X-View-As': w.ids.Alex })).data.goToAdmin).toBeUndefined();
  }, 120_000);
});
