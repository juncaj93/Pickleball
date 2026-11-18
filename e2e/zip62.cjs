/* Zip 62 (🎾62.speed): the tournament card draws with the rest of the player's Home, in a real browser, on the REAL BUILT site (the built
 * files served the way Cloudflare Pages serves them, kept a year by the browser; /api goes to a local dev server on the fake world). The dev
 * server's own page is not used: it sends the card's code as a chain of dozens of small source files, which no phone ever gets.
 *
 *   node e2e/zip62.cjs      (also run by npm run test:e2e; about 3 minutes)
 *
 * The world is the preview's calm Zip 60 profile as of Wed Nov 18 2026, 1:30 PM Eastern, with The Cold Open at the Tournament test page's
 * stages (server/tournamentTest.ts). Nothing looks different: the card is the same card; only WHEN it appears changes.
 *   A  a phone that has had the card before: the card's own file starts as the page opens (before the games answer is back), and the real card
 *      is on screen in the very same moment as the fresh games, with no dark placeholder at any time (390/360/320, light and dark; the
 *      Speed check stage, The Cold Open as on live, and the tickets stage)
 *   B  a phone's first look (nothing remembered yet): as before, the placeholder holds the card's place until its file is here, then the card
 *   C  the card is the same both ways (the same words, the same height), and nothing on Home sticks out or is wider than the screen
 *   D  switched off: a phone that never had a card never fetches its file; one that had it forgets it at the first answer without a card, and
 *      the next open fetches nothing
 *   E  the organizer: with a tournament on Home the card's file starts at once, and View as draws the player's card with no placeholder
 *   F  no em dashes on Home
 * Screenshots: .data/zip62-shots (not in git).
 */
const { spawn, spawnSync } = require('node:child_process');
const { existsSync, readFileSync, mkdirSync, rmSync } = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.E2E_PORT) || 5462;
const API = `http://localhost:${PORT}`;
const BASE = `http://localhost:${PORT + 1}`;
const SEED_ISO = '2026-11-18T18:00:00.000Z';
const NOW_MS = Date.parse('2026-11-18T18:30:00.000Z'); // Wed Nov 18, 1:30 PM Eastern
const PIN = /PIN `(\d{6})`/.exec(readFileSync(path.join(ROOT, 'docs/PREVIEW_FAKE_DB.md'), 'utf8'))[1];
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const SHOTS = path.join(ROOT, '.data', 'zip62-shots');

let passed = 0;
let failed = 0;
const ONLY = process.env.ZIP62_ONLY || '';
async function check(name, fn) {
  if (ONLY && !name.includes(ONLY)) return;
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.log(`  ✗ ${name}\n      ${String(err && err.message ? err.message : err).replace(/\s*\n\s*/g, ' ⏎ ').slice(0, 1400)}`);
  }
}
const assert = (c, m) => {
  if (!c) throw new Error(m);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const flat = (t) => String(t).replace(/\s+/g, ' ').trim();
const SIZES = [390, 360, 320];
const SCHEMES = ['light', 'dark'];

/** Runs in the page before any of its own code: notes the moment each thing is first on screen (a DOM change), in the page's own clock. */
function watch() {
  const out = (window.__zip62 = { shell: null, card: null, games: null, cardWithGames: null });
  const look = () => {
    const t = performance.now();
    const card = !!document.querySelector('[data-tournament]');
    if (out.shell === null && document.querySelector('.tc-shell')) out.shell = t;
    if (out.games === null && document.querySelector('.schedule:not([data-saved-copy]) [data-tier]')) {
      out.games = t;
      // The same DOM change that put the fresh games on screen: was the real card already there?
      out.cardWithGames = card;
    }
    if (out.card === null && card) out.card = t;
  };
  new MutationObserver(look).observe(document, { childList: true, subtree: true, attributes: false });
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.woff2': 'font/woff2', '.wasm': 'application/wasm', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain' };

/** A small stand-in for Cloudflare Pages (as in e2e/zip48.cjs): the built files (assets kept a year), /admin -> admin.html, else the page; /api to the dev server. */
function staticServer(dir, port) {
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
    let file = path.join(dir, decodeURIComponent(url.pathname));
    const send = (f, status = 200) => {
      res.writeHead(status, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream', 'Cache-Control': f.includes('/assets/') && status === 200 ? 'public, max-age=31536000, immutable' : 'no-cache' });
      res.end(req.method === 'HEAD' ? undefined : readFileSync(f));
    };
    if (url.pathname !== '/' && existsSync(file) && !file.endsWith('/')) return send(file);
    if (/^\/admin\/?$/.test(url.pathname) && existsSync(path.join(dir, 'admin.html'))) return send(path.join(dir, 'admin.html'));
    file = path.join(dir, 'index.html');
    return send(file);
  });
  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}

async function main() {
  const dbFile = path.join(ROOT, '.data', 'zip62.sqlite');
  mkdirSync(SHOTS, { recursive: true });
  rmSync(dbFile, { force: true });
  // The site as a preview build makes it (the preview-only ?as= link and Tournament test route need the preview's server setting, set below).
  const dist = path.join(os.tmpdir(), `zip62-dist-${PORT}`);
  const built = spawnSync(process.execPath, [path.join(ROOT, 'node_modules/vite/bin/vite.js'), 'build', '--outDir', dist, '--emptyOutDir', '--logLevel', 'error'], {
    cwd: ROOT,
    env: { ...process.env, NODE_ENV: 'production', APP_BUILD: 'zip62-e2e', PB_PREVIEW_BUILD: '1' },
    encoding: 'utf8',
  });
  if (built.status !== 0) throw new Error(`build failed: ${built.stderr || built.stdout}`);
  const seeded = spawnSync('npx', ['vite-node', 'scripts/load-small-local.ts', '--', dbFile, SEED_ISO, '--calm', '--zip55', '--zip60'], { cwd: ROOT, encoding: 'utf8' });
  if (seeded.status !== 0) throw new Error(`could not build the calm world: ${seeded.stderr || seeded.stdout}`);
  if (await fetch(`${API}/api/status`).then((r) => r.ok, () => false)) throw new Error(`port ${PORT} is already in use`);
  const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
    cwd: ROOT,
    env: { ...process.env, DEV_DB: dbFile, SETUP_TOKEN: 'zip62-setup-token-0123456789', DEV_CLOCK: '1', PREVIEW_CALM: 'on', PB_PREVIEW_BUILD: '1' },
    stdio: 'ignore',
    detached: true,
  });
  process.on('exit', () => {
    try {
      process.kill(-server.pid, 'SIGTERM');
    } catch {}
  });
  for (let i = 0; i < 90; i++) {
    if (await fetch(`${API}/api/status`).then((r) => r.ok, () => false)) break;
    await sleep(500);
  }
  await fetch(`${API}/__dev/clock`, { method: 'POST', body: JSON.stringify({ atMs: NOW_MS }) });
  const site = await staticServer(dist, PORT + 1);
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
    }, NOW_MS - Date.now());

  const admin = await browser.newContext();
  assert((await admin.request.post(BASE + '/api/admin/login', { data: { pin: PIN }, headers: { Origin: BASE } })).ok(), 'admin login');
  const adminCookies = await admin.cookies();
  const call = async (method, url, data) => {
    const r = await admin.request.fetch(BASE + url, { method, data, headers: { Origin: BASE } });
    assert(r.ok(), `${method} ${url}: ${r.status()} ${await r.text()}`);
    return r.json();
  };
  const stage = (s) => call('POST', '/api/admin/tournament-test', { stage: s });
  const switchTo = (on) => call('PUT', '/api/admin/tournaments-switch', { on });

  /** One phone (its own storage and cache, kept across opens). */
  async function phone(opts = {}) {
    const { width = 390, scheme = 'light', organizer = false } = opts;
    const ctx = await browser.newContext({ viewport: { width, height: 844 }, deviceScaleFactor: 1, colorScheme: scheme, isMobile: true, hasTouch: true, userAgent: UA, reducedMotion: 'reduce' });
    await shift(ctx);
    await ctx.addInitScript(watch);
    if (organizer) await ctx.addCookies(adminCookies.map((c) => ({ ...c })));
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const asked = [];
    page.on('request', (r) => asked.push({ url: r.url(), at: Date.now() }));
    return { ctx, page, errors, asked };
  }
  /** Opens the player's Home (the name picked by the preview's ?as= link the first time) and waits until the fresh games are on screen. */
  async function open(p, who, { card = true } = {}) {
    p.asked.length = 0;
    await p.page.goto(`${BASE}/${who ? `?as=${encodeURIComponent(who)}` : ''}`);
    await p.page.locator('.schedule:not([data-saved-copy]) [data-tier]').first().waitFor({ timeout: 30000 });
    if (card) await p.page.locator('[data-tournament]').first().waitFor({ timeout: 30000 });
    await p.page.waitForTimeout(500);
    const marks = await p.page.evaluate(() => window.__zip62);
    const timing = await p.page.evaluate(() => {
      const res = performance.getEntriesByType('resource');
      const file = res.find((e) => /TournamentHome/.test(e.name));
      const group = res.find((e) => /\/api\/group$/.test(e.name));
      return { fileStart: file ? file.startTime : null, groupEnd: group ? group.responseEnd : null };
    });
    return { ...marks, ...timing, fetchedFile: p.asked.some((r) => /TournamentHome/.test(r.url)) };
  }
  async function fits(page, sel) {
    const r = await page.evaluate((s) => {
      const out = { page: [document.documentElement.scrollWidth, window.innerWidth], bad: [] };
      for (const root of document.querySelectorAll(s)) {
        const box = root.getBoundingClientRect();
        for (const el of root.querySelectorAll('*')) {
          const b = el.getBoundingClientRect();
          if (b.width === 0 || b.height === 0) continue;
          if (getComputedStyle(el).position === 'absolute') continue;
          if (b.right > box.right + 1 || b.left < box.left - 1) out.bad.push(`${el.tagName}.${el.className} ${Math.round(b.left)}..${Math.round(b.right)} outside ${Math.round(box.left)}..${Math.round(box.right)}`);
        }
      }
      return out;
    }, sel);
    assert(r.page[0] <= r.page[1], `the page is wider than the screen (${r.page[0]} > ${r.page[1]})`);
    assert(r.bad.length === 0, `sticks out: ${r.bad.slice(0, 4).join(' | ')}`);
  }
  const cardFacts = (page) =>
    page.evaluate(() => {
      const el = document.querySelector('[data-tournament]');
      return el ? { text: el.innerText.replace(/\s+/g, ' ').trim(), h: Math.round(el.getBoundingClientRect().height) } : null;
    });
  const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, `${name}.png`) });

  // ---------------------------------------------------------------- A, B, C  the card with the rest of Home
  for (const s of ['speed_check', 'tickets_open']) {
    await stage(s);
    for (const scheme of SCHEMES)
      for (const width of SIZES)
        await check(`A-C ${s}: first look as before, then the card with the fresh games and no placeholder (${width} ${scheme})`, async () => {
          const p = await phone({ width, scheme });
          // B: the first look on this phone (nothing remembered): the placeholder holds the place until the file is here, as before.
          const first = await open(p, 'Parker');
          assert(first.card !== null, 'the card came');
          assert(first.shell !== null && first.shell <= first.card, `the placeholder showed first, as before (${JSON.stringify(first)})`);
          const before = await cardFacts(p.page);
          assert((await p.page.evaluate(() => localStorage.getItem('pb_tour_seen'))) === '1', 'the phone remembers it had a card');
          // A: the next open: the file starts before the games answer is back, and the card is drawn in the same moment as the fresh games.
          for (let i = 0; i < 2; i++) {
            const again = await open(p, null);
            assert(again.shell === null, `no placeholder at any moment (${JSON.stringify(again)})`);
            assert(again.cardWithGames === true, `the card was on screen in the same moment as the fresh games (${JSON.stringify(again)})`);
            assert(again.fileStart !== null && again.groupEnd !== null && again.fileStart < again.groupEnd, `the card's file started before the games answer was back (${JSON.stringify(again)})`);
          }
          // C: the same card both ways.
          const after = await cardFacts(p.page);
          assert(after && before && after.text === before.text && after.h === before.h, `the same card: ${JSON.stringify(before)} vs ${JSON.stringify(after)}`);
          await fits(p.page, 'main.page');
          assert(p.errors.length === 0, `page errors: ${p.errors.join(' | ')}`);
          await shot(p.page, `A-${s}-${width}-${scheme}`);
          await p.ctx.close();
        });
  }

  // ---------------------------------------------------------------- D  switched off
  await check('D switched off: a phone that never had a card never fetches its file', async () => {
    await stage('vote_open');
    await switchTo(false);
    const p = await phone();
    for (let i = 0; i < 2; i++) {
      const o = await open(p, i === 0 ? 'Vic' : null, { card: false });
      assert(!o.fetchedFile, 'the card file was fetched');
      assert((await p.page.locator('[data-tournament], .tc-shell').count()) === 0, 'no card');
    }
    assert((await p.page.evaluate(() => localStorage.getItem('pb_tour_seen'))) === null, 'nothing remembered');
    await p.ctx.close();
  });
  await check('D switched off after a card: the phone forgets it at the first answer without one, and the next open fetches nothing', async () => {
    await stage('vote_open');
    const p = await phone();
    await open(p, 'Parker');
    assert((await p.page.evaluate(() => localStorage.getItem('pb_tour_seen'))) === '1', 'remembered');
    await switchTo(false);
    const o1 = await open(p, null, { card: false });
    assert((await p.page.locator('[data-tournament], .tc-shell').count()) === 0, 'no card once off');
    assert((await p.page.evaluate(() => localStorage.getItem('pb_tour_seen'))) === null, 'forgotten at the first answer without a card');
    void o1;
    const o2 = await open(p, null, { card: false });
    assert(!o2.fetchedFile, 'the next open fetches nothing');
    await p.ctx.close();
    await switchTo(true);
  });

  // ---------------------------------------------------------------- E  the organizer and View as
  await check('E the organizer: the card file starts with the dashboard, and View as draws the card with no placeholder (390 light and dark)', async () => {
    await stage('speed_check');
    for (const scheme of SCHEMES) {
      const a = await phone({ organizer: true, scheme });
      await a.page.goto(`${BASE}/admin`);
      await a.page.locator('.tabbar').waitFor({ timeout: 30000 });
      await a.page.waitForFunction(() => performance.getEntriesByType('resource').some((e) => /TournamentHome/.test(e.name)), null, { timeout: 15000 });
      await a.page.locator('.topbar-btn', { hasText: 'View as' }).click();
      await a.page.evaluate(() => {
        window.__zip62.shell = null;
        window.__zip62.card = null;
      });
      await a.page.locator('.name-grid button', { hasText: /^Parker$/ }).click();
      await a.page.locator('[data-tournament]').first().waitFor({ timeout: 30000 });
      await a.page.waitForTimeout(400);
      const m = await a.page.evaluate(() => window.__zip62);
      assert(m.shell === null, `no placeholder in View as (${JSON.stringify(m)})`);
      await fits(a.page, 'main.page');
      assert(a.errors.length === 0, `page errors: ${a.errors.join(' | ')}`);
      await shot(a.page, `E-view-as-${scheme}`);
      await a.ctx.close();
    }
  });

  // ---------------------------------------------------------------- F  words
  await check('F no em dashes on Home with the card', async () => {
    await stage('tickets_open');
    const p = await phone();
    await open(p, 'Parker');
    const text = await p.page.evaluate(() => document.body.innerText);
    assert(!text.includes('\u2014'), 'an em dash');
    assert(/The Cold Open|Winter/.test(flat(text)), 'the card is there');
    await p.ctx.close();
  });

  await stage('none');
  await browser.close();
  site.close();
  console.log(`\nzip62: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
