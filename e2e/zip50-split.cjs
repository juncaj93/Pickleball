/* Zip 50: deep links after the Zip 48 split, in a real browser, on the real built files (no second checkout needed).
 *
 *   node e2e/zip50-split.cjs            (E2E_PORT=5490 by default: the dev server on E2E_PORT for /api, the built site on E2E_PORT+1)
 *
 * The built site is served by a small stand-in for Cloudflare Pages that does what the preview showed (docs/STAGE_NOTES.md, Zip 48):
 * /admin and /admin?... -> admin.html; /admin/ and /admin.html -> 308 to /admin with the ?... kept; a missing /assets/ file -> 404;
 * anything else -> the page. The fake world is the small preview world (scripts/load-small-local.ts), on its own database file.
 * Checks:
 *  1. Signed out: /admin shows the PIN screen and every organizer answer the page got was 401; /admin/?lastscreenadmin=on lands on
 *     /admin?lastscreenadmin=on (308, ?... kept) and the phone remembers the private link; /admin.html lands on /admin.
 *  2. Organizer: /admin/, /admin?unpaid=<game> (Telegram 1's link opens the "Text who hasn't paid" sheet when Second Chance is on),
 *     /admin?playersredo=on&venmorequest=on (remembered), View as a player from the organizer screens.
 *  3. A private link on /admin works even when the organizer file never arrives (the player download reads it first): one reload, then
 *     Try again, and the link is remembered.
 *  4. Player links never fetch an organizer file: /?as=Parker, /g/<the group key>, /go/..., /gt/preview, /setup, /t/abc.
 * By hand (not in e2e/suite.cjs).
 */
const { spawn, spawnSync } = require('node:child_process');
const { existsSync, mkdirSync, readFileSync, rmSync } = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.E2E_PORT) || 5490;
const API = `http://localhost:${PORT}`;
const SITE = `http://localhost:${PORT + 1}`;
const SEED_ISO = '2026-11-12T20:00:00.000Z'; // Thu Nov 12, 3:00 PM Eastern
const NOW_MS = Date.parse(SEED_ISO);
// The preview database's PIN, read from the one place it is written (never printed).
const PIN = /PIN `(\d{6})`/.exec(readFileSync(path.join(ROOT, 'docs/PREVIEW_FAKE_DB.md'), 'utf8'))[1];

let passed = 0;
let failed = 0;
async function check(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.log(`  ✗ ${name}\n      ${String(err && err.message ? err.message : err).replace(/\s*\n\s*/g, ' ⏎ ').slice(0, 1200)}`);
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function liveVars() {
  const toml = readFileSync(path.join(ROOT, 'wrangler.toml'), 'utf8');
  const top = toml.slice(toml.indexOf('[vars]'), toml.indexOf('[env.preview]'));
  const out = {};
  for (const m of top.matchAll(/^([A-Z_][A-Z0-9_]*)\s*=\s*"([^"]*)"/gm)) if (m[1] !== 'SITE_URL') out[m[1]] = m[2];
  return out;
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.woff2': 'font/woff2', '.wasm': 'application/wasm', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain' };

/** A stand-in for Cloudflare Pages, with the redirects the preview showed. */
function pagesServer(dir, port) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/__dev/')) {
      const p = http.request(`${API}${req.url}`, { method: req.method, headers: req.headers }, (r) => {
        res.writeHead(r.statusCode, r.headers);
        r.pipe(res);
      });
      p.on('error', () => {
        res.statusCode = 502;
        res.end();
      });
      req.pipe(p);
      return;
    }
    if (url.pathname === '/admin/' || url.pathname === '/admin.html') {
      res.writeHead(308, { Location: `/admin${url.search}` });
      return res.end();
    }
    const send = (f, status = 200) => {
      res.writeHead(status, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream', 'Cache-Control': f.includes('/assets/') && status === 200 ? 'public, max-age=31536000, immutable' : 'no-cache' });
      res.end(req.method === 'HEAD' ? undefined : readFileSync(f));
    };
    const file = path.join(dir, decodeURIComponent(url.pathname));
    if (url.pathname !== '/' && existsSync(file) && !file.endsWith('/')) return send(file);
    if (url.pathname === '/admin') return send(path.join(dir, 'admin.html'));
    if (url.pathname.startsWith('/assets/')) return send(path.join(dir, 'assets/404.html'), 404);
    return send(path.join(dir, 'index.html'));
  });
  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}

async function main() {
  const dbFile = path.join(ROOT, '.data', `zip50-${PORT}.sqlite`);
  mkdirSync(path.join(ROOT, '.data'), { recursive: true });
  // Built copy in the system temp folder (a copy under the project would be read by tests that scan every file).
  const dist = path.join(os.tmpdir(), `zip50-split-dist-${PORT}`);
  console.log('Building...');
  const b = spawnSync(process.execPath, [path.join(ROOT, 'node_modules/vite/bin/vite.js'), 'build', '--outDir', dist, '--emptyOutDir', '--logLevel', 'error'], {
    cwd: ROOT,
    env: { ...process.env, NODE_ENV: 'production', APP_BUILD: 'zip50-split' },
    encoding: 'utf8',
  });
  if (b.status !== 0) throw new Error(`build failed: ${b.stderr || b.stdout}`);
  assert(existsSync(path.join(dist, 'admin.html')), 'the build has no admin.html');
  rmSync(dbFile, { force: true });
  const seeded = spawnSync('npx', ['vite-node', 'scripts/load-small-local.ts', '--', dbFile, SEED_ISO], { cwd: ROOT, encoding: 'utf8' });
  if (seeded.status !== 0) throw new Error(`could not build the fake world: ${seeded.stderr || seeded.stdout}`);
  if (await fetch(`${API}/api/status`).then((r) => r.ok, () => false)) throw new Error(`port ${PORT} is already in use`);
  const dev = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
    cwd: ROOT,
    env: { ...process.env, ...liveVars(), DEV_DB: dbFile, SETUP_TOKEN: 'zip50-setup-token-0123456789', DEV_CLOCK: '1', PREVIEW_CALM: 'on', GAME_DAY_TEXT_PREVIEW: 'on' },
    stdio: 'ignore',
    detached: true,
  });
  process.on('exit', () => {
    try {
      process.kill(-dev.pid, 'SIGTERM');
    } catch {}
    rmSync(dbFile, { force: true });
  });
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(`${API}/api/status`)).ok) break;
    } catch {}
    await sleep(500);
  }
  await fetch(`${API}/__dev/clock`, { method: 'POST', body: JSON.stringify({ atMs: NOW_MS }) });
  const server = await pagesServer(dist, PORT + 1);
  const browser = await chromium.launch();

  async function phone({ organizer = false } = {}) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
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
    }, NOW_MS - Date.now());
    if (organizer) {
      const r = await ctx.request.post(SITE + '/api/admin/login', { data: { pin: PIN }, headers: { Origin: SITE } });
      assert(r.ok(), `sign in ${r.status()}`);
    }
    const page = await ctx.newPage();
    page.errors = [];
    page.on('pageerror', (e) => page.errors.push(String(e)));
    page.requests = [];
    page.on('request', (r) => page.requests.push(r.url()));
    page.adminAnswers = [];
    page.on('response', (r) => {
      if (new URL(r.url()).pathname.startsWith('/api/admin/')) page.adminAnswers.push(`${new URL(r.url()).pathname} ${r.status()}`);
    });
    page.redirects = [];
    page.on('response', (r) => {
      if (r.status() >= 300 && r.status() < 400) page.redirects.push(`${new URL(r.url()).pathname}${new URL(r.url()).search} ${r.status()} ${r.headers().location}`);
    });
    return { ctx, page };
  }
  const local = (page, key) => page.evaluate((k) => localStorage.getItem(k), key);
  const organizerFetched = (page) => page.requests.filter((u) => /\/assets\/(AdminEntry|zip11)-/.test(u));

  // The organizer's dashboard (for a game id and the group key; read through the API, never printed).
  const login = await fetch(`${API}/api/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: API }, body: JSON.stringify({ pin: PIN }) });
  const cookie = (login.headers.get('set-cookie') || '').split(';')[0];
  const dash = await (await fetch(`${API}/api/admin/dashboard`, { headers: { Cookie: cookie } })).json();
  const groupKey = String(dash.group.privateLink || '').split('/g/')[1];
  const game = dash.sessions.find((s) => s.status !== 'canceled' && Date.parse(s.startsAt) > NOW_MS) || dash.sessions[0];

  // ---------- 1: signed out ----------
  await check('signed out, /admin: the PIN screen; every organizer answer the page got was 401', async () => {
    const { ctx, page } = await phone();
    await page.goto(SITE + '/admin');
    await page.getByText(/PIN/).first().waitFor({ timeout: 30000 });
    await sleep(1000);
    assert(page.adminAnswers.length > 0, 'the page asked the server nothing');
    assert(page.adminAnswers.every((a) => / 401$/.test(a)), page.adminAnswers.join(' | '));
    assert(organizerFetched(page).length > 0, 'admin.html did not start the organizer files');
    assert(page.errors.length === 0, page.errors.join(' | '));
    await ctx.close();
  });

  await check('signed out, /admin/?lastscreenadmin=on: 308 to /admin with the ?... kept, the PIN screen, the link remembered', async () => {
    const { ctx, page } = await phone();
    await page.goto(SITE + '/admin/?lastscreenadmin=on');
    await page.getByText(/PIN/).first().waitFor({ timeout: 30000 });
    const u = new URL(page.url());
    assert(u.pathname === '/admin' && u.search === '?lastscreenadmin=on', `landed on ${u.pathname}${u.search}`);
    assert(page.redirects.some((r) => /^\/admin\/\?lastscreenadmin=on 308 \/admin\?lastscreenadmin=on$/.test(r)), page.redirects.join(' | '));
    assert((await local(page, 'pb_lastscreenadmin')) === 'on', 'the private link was not remembered');
    assert(page.errors.length === 0, page.errors.join(' | '));
    await ctx.close();
  });

  await check('signed out, /admin.html: lands on /admin and shows the PIN screen', async () => {
    const { ctx, page } = await phone();
    await page.goto(SITE + '/admin.html');
    await page.getByText(/PIN/).first().waitFor({ timeout: 30000 });
    assert(new URL(page.url()).pathname === '/admin', page.url());
    await ctx.close();
  });

  // ---------- 2: the organizer ----------
  await check('organizer, /admin/: 308 to /admin, the dashboard', async () => {
    const { ctx, page } = await phone({ organizer: true });
    await page.goto(SITE + '/admin/');
    await page.locator('nav.tabbar').waitFor({ timeout: 30000 });
    assert(new URL(page.url()).pathname === '/admin', page.url());
    assert(page.errors.length === 0, page.errors.join(' | '));
    await ctx.close();
  });

  await check("organizer, /admin?unpaid=<game> (Telegram 1's link): the dashboard and the Text who hasn't paid sheet", async () => {
    assert(game && /^[0-9a-f-]{36}$/.test(game.id), 'no game in the fake world');
    const { ctx, page } = await phone({ organizer: true });
    await page.goto(`${SITE}/admin?unpaid=${game.id}`);
    await page.locator('nav.tabbar').waitFor({ timeout: 30000 });
    if (dash.secondChance) {
      await page.locator('[data-sc-unpaid-sheet]').waitFor({ timeout: 15000 });
      assert(await page.getByText("Text who hasn’t paid").first().isVisible(), 'no sheet title');
    } else {
      console.log('      (Second Chance is off in this world: only the dashboard is checked)');
    }
    assert(page.errors.length === 0, page.errors.join(' | '));
    await ctx.close();
  });

  await check('organizer, /admin?playersredo=on&venmorequest=on: the dashboard, both private links remembered', async () => {
    const { ctx, page } = await phone({ organizer: true });
    await page.goto(SITE + '/admin?playersredo=on&venmorequest=on');
    await page.locator('nav.tabbar').waitFor({ timeout: 30000 });
    assert((await local(page, 'pb_playersredo')) === 'on', 'playersredo not remembered');
    assert((await local(page, 'pb_venmo_request')) === 'on', 'venmorequest not remembered');
    await page.goto(SITE + '/admin?playersredo=off&venmorequest=off');
    await page.locator('nav.tabbar').waitFor({ timeout: 30000 });
    assert((await local(page, 'pb_playersredo')) === null && (await local(page, 'pb_venmo_request')) === null, '=off did not end them');
    assert(page.errors.length === 0, page.errors.join(' | '));
    await ctx.close();
  });

  await check('organizer, View as a player: the player screen inside the organizer screens', async () => {
    const { ctx, page } = await phone({ organizer: true });
    await page.goto(SITE + '/admin');
    await page.locator('nav.tabbar').waitFor({ timeout: 30000 });
    await page.getByRole('button', { name: /^View as/ }).first().click();
    await page.locator('dialog[open]').getByRole('button', { name: /^Parker/ }).first().click();
    await page.locator('.schedule article.sched').first().waitFor({ timeout: 30000 });
    assert(/Parker/.test(await page.evaluate(() => document.getElementById('root').innerText)), 'not Parker');
    assert(new URL(page.url()).pathname === '/admin', page.url());
    assert(page.errors.length === 0, page.errors.join(' | '));
    await ctx.close();
  });

  // ---------- 3: a private link with the organizer file missing ----------
  await check('organizer file missing (always 404): /admin?noontest=on reloads once, then Try again; the link is still remembered', async () => {
    const { ctx, page } = await phone({ organizer: true });
    await page.route(/\/assets\/AdminEntry-.*\.js$/, (route) => route.fulfill({ status: 404, body: 'Not found' }));
    let loads = 0;
    page.on('load', () => loads++);
    await page.goto(SITE + '/admin?noontest=on');
    await page.getByRole('button', { name: 'Try again' }).waitFor({ timeout: 30000 });
    await sleep(2500);
    assert(loads === 2, `page loads: ${loads} (want the first open and exactly one reload)`);
    assert((await local(page, 'pb_noontest')) === 'on', 'the private link was not remembered');
    assert(await page.evaluate(() => sessionStorage.getItem('pb_admin_reload_at') !== null), 'the reload was not written down');
    await page.unroute(/\/assets\/AdminEntry-.*\.js$/);
    await page.getByRole('button', { name: 'Try again' }).click();
    await page.locator('nav.tabbar').waitFor({ timeout: 30000 });
    await page.goto(SITE + '/admin?noontest=off');
    await page.locator('nav.tabbar').waitFor({ timeout: 30000 });
    assert((await local(page, 'pb_noontest')) === null, '=off did not end it');
    await ctx.close();
  });

  // ---------- 4: player links ----------
  const playerLinks = [
    ['/?as=Parker', /Parker/],
    ['/?as=Parker&xmasmode=me', /Parker/],
    [`/g/${groupKey}`, /./],
    [`/g/${groupKey}/`, /./],
    ['/go/nothing-here', /./],
    ['/gt/preview', /./],
    ['/setup', /./],
    ['/t/abc', /Who are you|Pickleball/],
  ];
  for (const [url, want] of playerLinks) {
    const label = url.startsWith('/g/') ? url.replace(groupKey, '<group key>') : url;
    await check(`player link ${label}: opens, never fetches an organizer file`, async () => {
      assert(groupKey, 'no group key');
      const { ctx, page } = await phone();
      await page.goto(SITE + url);
      await sleep(3000);
      const text = await page.evaluate(() => document.getElementById('root').innerText);
      assert(text.trim().length > 0, 'blank page');
      assert(want.test(text), `words: ${text.slice(0, 120)}`);
      assert(organizerFetched(page).length === 0, organizerFetched(page).join(' | '));
      // (The set-up page asks for a new organizer PIN in its own form; every other player link never shows the PIN screen.)
      if (url !== '/setup') assert(!/Organizer PIN|Enter (the )?PIN/i.test(text), 'shows the PIN screen');
      assert(page.errors.length === 0, page.errors.join(' | '));
      await ctx.close();
    });
  }

  server.close();
  await browser.close();
  rmSync(dist, { recursive: true, force: true });
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
