/* Zip 74 (🎾74.polish): the shared start for the Zip 74 browser checks (e2e/zip74.cjs): the preview's calm world on a local server with a fixed
 * clock, the organizer's cookie, the Tournament test stages, and phones by name. Same pattern as e2e/zip72.cjs.
 */
const { spawn, spawnSync } = require('node:child_process');
const { readFileSync, mkdirSync, rmSync } = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const flat = (t) => String(t).replace(/\s+/g, ' ').trim();
const assert = (c, m) => {
  if (!c) throw new Error(m);
};

async function boot({ port = Number(process.env.E2E_PORT) || 5476, seedIso = '2026-11-19T14:00:00.000Z', nowMs = Date.parse('2026-11-19T15:00:00.000Z'), name = 'zip74', calm = true } = {}) {
  const BASE = `http://localhost:${port}`;
  const PIN = /PIN `(\d{6})`/.exec(readFileSync(path.join(ROOT, 'docs/PREVIEW_FAKE_DB.md'), 'utf8'))[1];
  const dbFile = path.join(ROOT, '.data', `${name}-e2e.sqlite`);
  mkdirSync(path.join(ROOT, '.data'), { recursive: true });
  rmSync(dbFile, { force: true });
  const seeded = spawnSync('npx', ['vite-node', 'scripts/load-small-local.ts', '--', dbFile, seedIso, ...(calm ? ['--calm'] : []), '--zip55', '--zip60', '--zip66'], { cwd: ROOT, encoding: 'utf8' });
  if (seeded.status !== 0) throw new Error(`could not build the calm world: ${seeded.stderr || seeded.stdout}`);
  if (await fetch(`${BASE}/api/status`).then((r) => r.ok, () => false)) throw new Error(`port ${port} is already in use`);
  const server = spawn('npx', ['vite', '--port', String(port), '--strictPort'], {
    cwd: ROOT,
    env: { ...process.env, DEV_DB: dbFile, SETUP_TOKEN: `${name}-setup-token-0123456789`, DEV_CLOCK: '1', PREVIEW_CALM: calm ? 'on' : 'off', PB_PREVIEW_BUILD: '1' },
    stdio: 'ignore',
    detached: true,
  });
  const stop = () => {
    try {
      process.kill(-server.pid, 'SIGTERM');
    } catch {}
  };
  process.on('exit', stop);
  for (let i = 0; i < 120; i++) {
    if (await fetch(`${BASE}/api/status`).then((r) => r.ok, () => false)) break;
    await sleep(500);
  }
  let now = nowMs;
  const setClock = async (ms) => {
    now = ms;
    await fetch(`${BASE}/__dev/clock`, { method: 'POST', body: JSON.stringify({ atMs: ms }) });
  };
  await setClock(nowMs);
  const browser = await chromium.launch();
  const shift = (ctx) =>
    ctx.addInitScript((delta) => {
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
    }, now - Date.now());

  const admin = await browser.newContext();
  assert((await admin.request.post(BASE + '/api/admin/login', { data: { pin: PIN }, headers: { Origin: BASE } })).ok(), 'admin login');
  const adminCookies = await admin.cookies();
  const call = async (method, url, data) => {
    const r = await admin.request.fetch(BASE + url, { method, data, headers: { Origin: BASE } });
    assert(r.ok(), `${method} ${url}: ${r.status()} ${await r.text()}`);
    return r.json();
  };
  const stage = (s) => call('POST', '/api/admin/tournament-test', { stage: s });
  /** A phone that picked `name` (the API, as the screen sends it). */
  async function phone(who) {
    const ctx = await browser.newContext();
    const list = (await (await ctx.request.get(BASE + '/api/group')).json()).players;
    const p = list.find((x) => x.name === who);
    await ctx.request.post(BASE + '/api/me', { data: { playerId: p.id }, headers: { Origin: BASE } });
    const post = async (url, data) => {
      const r = await ctx.request.post(BASE + url, { data, headers: { Origin: BASE } });
      return { status: r.status(), ok: r.ok(), body: await r.json().catch(() => ({})) };
    };
    const group = async () => (await ctx.request.get(BASE + '/api/group')).json();
    return { ctx, post, group, id: p.id };
  }
  async function newPage(opts = {}) {
    const { width = 390, scheme = 'light', height = 844, organizer = false, reducedMotion = 'reduce' } = opts;
    const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, colorScheme: scheme, isMobile: true, hasTouch: true, userAgent: UA, reducedMotion });
    await shift(ctx);
    if (organizer) await ctx.addCookies(adminCookies.map((c) => ({ ...c })));
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    return { ctx, page, errors };
  }
  async function playerPage(who, opts = {}) {
    const p = await newPage(opts);
    await p.page.goto(`${BASE}/?as=${encodeURIComponent(who)}${opts.query ?? ''}`);
    await p.page.locator('.schedule, [data-tc-day]').first().waitFor({ timeout: 30000 });
    await p.page.reload();
    await p.page.locator('.schedule, [data-tc-day]').first().waitFor({ timeout: 30000 });
    await p.page.waitForTimeout(700);
    return p;
  }
  async function adminHome(opts = {}) {
    const p = await newPage({ ...opts, organizer: true });
    await p.page.goto(`${BASE}/admin`);
    await p.page.locator('.tab-bar, nav').first().waitFor({ timeout: 30000 });
    await p.page.waitForTimeout(1200);
    return p;
  }
  const noWider = async (page, what) => {
    const w = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
    assert(w[0] <= w[1], `${what}: the page is ${w[0]} px wide on a ${w[1]} px screen`);
  };
  const close = async () => {
    await browser.close();
    stop();
  };
  return { BASE, PIN, browser, call, stage, phone, newPage, playerPage, adminHome, noWider, setClock, close, dbFile };
}

module.exports = { boot, flat, assert, sleep, ROOT };
