/* Zip 31: with "Extended time" OFF, the site is exactly today's main. Runs today's main (a git worktree, path in MAIN_DIR) and this branch side
 * by side on two copies of the same fake world (the small preview world at Thu Nov 12, 9:00 PM Eastern, built by this branch, so it carries
 * migration 0019's columns: main reading a migrated database is the code rollback too), the Settings row OFF on the branch, and compares:
 *  - the organizer's Home (the whole page HTML), the Finalize card and its "Change who played" sheet, at 390 and 320, light and dark;
 *  - two player pages (light and dark);
 *  - the dashboard, player and Money answers, byte for byte (apart from the change stamp);
 *  - a Finalize through the sheet on both, then the Money month and the player answers again.
 *
 *   MAIN_DIR=/path/to/main-worktree node e2e/zip31-off.cjs
 *
 * Not part of npm run test:e2e (it needs the second checkout). Nothing here touches Cloudflare or the live site.
 */
const { spawn, spawnSync } = require('node:child_process');
const { readFileSync, mkdirSync, rmSync, copyFileSync } = require('node:fs');
const path = require('node:path');
const { chromium, request } = require('playwright');

const ROOT = path.join(__dirname, '..');
const MAIN = process.env.MAIN_DIR;
if (!MAIN) throw new Error('set MAIN_DIR to a checkout of main');
const SEED_ISO = '2026-11-13T02:00:00.000Z'; // Thu Nov 12, 9:00 PM Eastern
const NOW_MS = Date.parse(SEED_ISO);
const PIN = /PIN `(\d{6})`/.exec(readFileSync(path.join(ROOT, 'docs/PREVIEW_FAKE_DB.md'), 'utf8'))[1];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let passed = 0;
let failed = 0;
async function check(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.log(`  ✗ ${name}\n      ${String(err && err.message ? err.message : err).replace(/\s*\n\s*/g, ' ⏎ ').slice(0, 900)}`);
  }
}
const assert = (c, m) => {
  if (!c) throw new Error(m);
};
function liveVars() {
  const toml = readFileSync(path.join(ROOT, 'wrangler.toml'), 'utf8');
  const top = toml.slice(toml.indexOf('[vars]'), toml.indexOf('[env.preview]'));
  const out = {};
  for (const m of top.matchAll(/^([A-Z_][A-Z0-9_]*)\s*=\s*"([^"]*)"/gm)) if (m[1] !== 'SITE_URL') out[m[1]] = m[2];
  return out;
}
const PM = Number(process.env.E2E_PORT_MAIN) || 5861;
const PB = Number(process.env.E2E_PORT_BRANCH) || 5862;
// The two servers run on different ports (a link carries the address), and their fake clocks tick on their own (a tap made a few ms apart):
// those are the only differences allowed. Seconds and milliseconds of a saved time are left out; the minutes must match.
const norm = (h) =>
  h
    .replace(new RegExp(`(?:%3A|:)(?:${PM}|${PB})`, 'g'), ':PORT')
    .replace(/Updated (just now|\d+ min ago)/g, 'Updated')
    .replace(/(T\d\d:\d\d):\d\d\.\d{3}Z/g, '$1:SSZ');
function same(a, b, what) {
  const x = norm(a);
  const y = norm(b);
  if (x === y) return;
  let k = 0;
  while (k < x.length && x[k] === y[k]) k++;
  throw new Error(`${what} differs from main at ${k}: main «${x.slice(Math.max(0, k - 80), k + 80)}» branch «${y.slice(Math.max(0, k - 80), k + 80)}»`);
}
const stripStamp = (o) => JSON.stringify(o, (k, v) => (k === 'version' || k === 'now' ? undefined : v));

async function main() {
  const dbA = path.join(ROOT, '.data', 'zip31off-main.sqlite');
  const dbB = path.join(ROOT, '.data', 'zip31off-branch.sqlite');
  mkdirSync(path.join(ROOT, '.data'), { recursive: true });
  rmSync(dbA, { force: true });
  rmSync(dbB, { force: true });
  // Built at 3:00 PM so the afternoon games below can still be added; the clock then moves to 9:00 PM.
  const seeded = spawnSync('npx', ['vite-node', 'scripts/load-small-local.ts', '--', dbB, '2026-11-12T20:00:00.000Z'], { cwd: ROOT, encoding: 'utf8' });
  if (seeded.status !== 0) throw new Error(`could not build the fake world: ${seeded.stderr || seeded.stdout}`);
  copyFileSync(dbB, dbA);
  const servers = [];
  const start = (cwd, port, db) => {
    const s = spawn('npx', ['vite', '--port', String(port), '--strictPort'], {
      cwd,
      env: { ...process.env, ...liveVars(), DEV_DB: db, SETUP_TOKEN: 'zip31off-setup-token-0123456789', DEV_CLOCK: '1', PREVIEW_CALM: 'on' },
      stdio: 'ignore',
      detached: true,
    });
    servers.push(s);
    process.on('exit', () => {
      try {
        process.kill(-s.pid, 'SIGTERM');
      } catch {}
    });
  };
  start(MAIN, PM, dbA);
  start(ROOT, PB, dbB);
  for (const port of [PM, PB])
    for (let i = 0; i < 120; i++) {
      try {
        if ((await fetch(`http://localhost:${port}/api/status`)).ok) break;
      } catch {}
      await sleep(500);
    }
  const apis = {};
  for (const port of [PM, PB]) {
    await fetch(`http://localhost:${port}/__dev/clock`, { method: 'POST', body: JSON.stringify({ atMs: Date.parse('2026-11-12T20:00:00.000Z') }) });
    const base = `http://localhost:${port}`;
    apis[port] = await request.newContext({ baseURL: base, extraHTTPHeaders: { Origin: base } });
    assert((await apis[port].post('/api/admin/login', { data: { pin: PIN } })).ok(), 'sign-in');
  }
  // The branch's Settings row OFF (the fake world has it on, as the preview does). Main has no such row to read.
  assert((await apis[PB].put('/api/admin/extended-time-switch', { data: { on: false } })).ok(), 'switch off');
  // The same afternoon game on both (same request, same order): 4 in, so a Finalize card shows at 9 PM.
  const ids = {};
  for (const port of [PM, PB]) {
    const api = apis[port];
    const d = await (await api.get('/api/admin/dashboard')).json();
    const id = Object.fromEntries(d.players.map((p) => [p.name, p.id]));
    let made = null;
    for (let k = 1; k < 16 && !made; k++) {
      const s0 = Date.parse('2026-11-12T20:00:00.000Z') + k * 30 * 60_000;
      const r = await api.post('/api/admin/sessions', { data: { startsAt: new Date(s0).toISOString(), endsAt: new Date(s0 + 2 * 3600_000).toISOString(), note: null } });
      if (r.status() === 409) continue;
      assert(r.ok(), `add game ${r.status()}`);
      made = (await r.json()).id;
    }
    await api.post(`/api/admin/sessions/${made}/court-status`, { data: { status: 'booked' } });
    await api.post(`/api/admin/sessions/${made}/me`, { data: { in: true } });
    for (const n of ['Parker', 'Sage', 'Christopher Vanderberg']) await api.post(`/api/admin/sessions/${made}/roster`, { data: { playerId: id[n], action: 'confirm' } });
    ids[port] = { game: made, id };
    await fetch(`http://localhost:${port}/__dev/clock`, { method: 'POST', body: JSON.stringify({ atMs: NOW_MS }) });
    assert((await api.post('/api/admin/login', { data: { pin: PIN } })).ok(), 'sign-in again');
  }
  const browser = await chromium.launch();
  async function page(port, width, scheme, url) {
    const ctx = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: scheme, reducedMotion: 'reduce' });
    await ctx.addInitScript((delta) => {
      const Real = Date;
      class Shifted extends Real {
        constructor(...x) {
          if (x.length === 0) super(Real.now() + delta);
          else super(...x);
        }
        static now() {
          return Real.now() + delta;
        }
      }
      window.Date = Shifted;
      try {
        localStorage.setItem('pb_games_filter', 'all');
      } catch {}
    }, NOW_MS - Date.now());
    const base = `http://localhost:${port}`;
    await ctx.request.post(base + '/api/admin/login', { data: { pin: PIN }, headers: { Origin: base } });
    const p = await ctx.newPage();
    await p.goto(base + url);
    await p.waitForTimeout(2500);
    return { ctx, p };
  }

  for (const scheme of ['light', 'dark'])
    for (const width of [390, 320])
      await check(`OFF, organizer Home ${width} ${scheme}: the whole page and the Change who played sheet equal main's`, async () => {
        const out = {};
        for (const port of [PM, PB]) {
          const { ctx, p } = await page(port, width, scheme, '/admin?alerts=all');
          const card = p.locator(`[data-finalize="${ids[port].game}"]`);
          await card.waitFor({ timeout: 20000 });
          const home = await p.locator('main').innerHTML();
          const label = (await card.locator('[data-change-played]').innerText()).trim();
          await card.locator('[data-change-played]').click();
          await p.locator('dialog[open] [data-who-played]').waitFor();
          await p.waitForTimeout(400);
          const sheet = await p.locator('dialog[open]').innerHTML();
          out[port] = { home: home.replaceAll(ids[port].game, 'GAME'), label, sheet };
          await ctx.close();
        }
        assert(out[PM].label === 'Change who played' && out[PB].label === 'Change who played', `labels ${out[PM].label} / ${out[PB].label}`);
        same(out[PM].sheet, out[PB].sheet, 'the sheet');
        same(out[PM].home, out[PB].home, 'Home');
      });

  for (const scheme of ['light', 'dark'])
    for (const name of ['Sage', 'Parker'])
      await check(`OFF, player page (${name}, ${scheme}) equals main's`, async () => {
        const out = {};
        for (const port of [PM, PB]) {
          const { ctx, p } = await page(port, 390, scheme, `/?as=${name}`);
          out[port] = (await p.locator('main').innerHTML()).replaceAll(ids[port].game, 'GAME');
          await ctx.close();
        }
        same(out[PM], out[PB], `${name}'s page`);
      });

  const answers = async (port) => {
    const api = apis[port];
    const dash = await (await api.get('/api/admin/dashboard')).json();
    const sage = await (await api.get('/api/group', { headers: { 'X-View-As': ids[port].id.Sage } })).json();
    const money = await (await api.get('/api/admin/money?month=2026-11')).json();
    // History on the dashboard is the newest 60 lines: the branch's one extra setup line ("Extended time" off) pushes main's 60th out.
    if (port === PB) dash.audit = dash.audit.filter((e) => e.action !== 'extended_time_off');
    else dash.audit = dash.audit.slice(0, 59);
    return { dash: stripStamp(dash).replaceAll(ids[port].game, 'GAME'), sage: stripStamp(sage).replaceAll(ids[port].game, 'GAME'), money: stripStamp(money).replaceAll(ids[port].game, 'GAME') };
  };
  await check('OFF: the dashboard, player and Money answers are byte for byte main\'s (apart from the change stamp)', async () => {
    const a = await answers(PM);
    const b = await answers(PB);
    // (Rows made by the setup taps on each copy have their own random ids.)
    const noIds = (s) => s.replace(/"(id|requestId)":"[0-9a-f-]{36}"/g, '"$1":"X"');
    same(a.money, b.money, 'Money');
    same(noIds(a.sage), noIds(b.sage), "Sage's answer");
    // The dashboard: the branch's own "Extended time" Settings row is off (no key), the rest equal.
    same(noIds(a.dash), noIds(b.dash), 'dashboard');
  });

  await check('OFF: Finalize through the sheet (with an extraMinutes sent anyway) moves the money exactly as main', async () => {
    for (const port of [PM, PB]) {
      const g = ids[port];
      const r = await apis[port].post(`/api/admin/sessions/${g.game}/finalize`, { data: { played: ['Alex', 'Parker', 'Sage', 'Christopher Vanderberg'].map((n) => g.id[n]), extraMinutes: 30 } });
      assert(r.ok(), `finalize ${port}: ${r.status()} ${await r.text()}`);
    }
    const a = await answers(PM);
    const b = await answers(PB);
    same(a.money, b.money, 'Money after Finalize');
    // Ids of the new credit rows are random: compare without them.
    const noIds = (s) => s.replace(/"id":"[0-9a-f-]{36}"/g, '"id":"X"');
    same(noIds(a.sage), noIds(b.sage), "Sage's answer after Finalize");
  });

  console.log(`\nzip31-off: ${passed} passed, ${failed} failed`);
  await browser.close();
  for (const s of servers) {
    try {
      process.kill(-s.pid, 'SIGTERM');
    } catch {}
  }
  process.exit(failed ? 1 : 0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
