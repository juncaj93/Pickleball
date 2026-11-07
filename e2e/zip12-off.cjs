/* Zip 12: the three speed switches OFF must be exactly today's site. This runs today's main (a git worktree, path in MAIN_DIR) and this branch
 * side by side on two copies of the same fake world (seeded by main, so no speed row exists), with the same pinned clock, and compares the
 * rendered HTML of every screen, player and organizer, light and dark, on the first open AND on a second open (a repeat visit: nothing saved
 * shows, nothing is saved), and the order of the first questions on the plain address (the set-up check answers before the games are asked
 * for, as today). The only difference allowed is the three new rows in Settings > Feature switches.
 *
 *   MAIN_DIR=/path/to/main-worktree node e2e/zip12-off.cjs
 *
 * Not part of npm run test:e2e (it needs the second checkout). Nothing here touches Cloudflare or the live site.
 */
const { spawn, spawnSync } = require('node:child_process');
const { readFileSync, mkdirSync, rmSync, copyFileSync } = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const Database = (() => {
  try {
    return require('better-sqlite3');
  } catch {
    return null;
  }
})();

const ROOT = path.join(__dirname, '..');
const MAIN = process.env.MAIN_DIR;
if (!MAIN) throw new Error('set MAIN_DIR to a checkout of main');
const NOW_ISO = '2026-11-05T17:00:00.000Z';
const NOW_MS = Date.parse(NOW_ISO);
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
    console.log(`  ✗ ${name}\n      ${String(err && err.message ? err.message : err).replace(/\s*\n\s*/g, ' ⏎ ').slice(0, 1400)}`);
  }
}
function diffAt(a, b) {
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  return `at ${i}/${a.length}: main «${a.slice(Math.max(0, i - 100), i + 160)}» branch «${b.slice(Math.max(0, i - 100), i + 160)}»`;
}

async function site(dir, port, dbFile) {
  const server = spawn('npx', ['vite', '--port', String(port), '--strictPort'], {
    cwd: dir,
    env: { ...process.env, DEV_DB: dbFile, SETUP_TOKEN: 'zip12-off-setup-token-0123456789', DEV_CLOCK: '1', INSTANT_TAPS: '', ADJUST_CREDIT: '', VENMO_REQUEST: '', HOME_COLLAPSE: '', TONIGHT_GLOW: '', COLOR_CLEANUP: '', PLAYER_CARDS_SIMPLE: '', SHORT_GAMES: '', CARD_TIME_BUTTONS: '', CARD_CLEANUP: '', MOTION: '', MOTION_ADMIN: '', SPEED_FEWER_QUERIES: '', SPEED_DIRECT_LOAD: '', SPEED_LAST_SCREEN: '' },
    stdio: 'ignore',
    detached: true,
  });
  process.on('exit', () => {
    try {
      process.kill(-server.pid, 'SIGTERM');
    } catch {}
  });
  const base = `http://localhost:${port}`;
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(`${base}/api/status`)).ok) break;
    } catch {}
    await sleep(500);
  }
  await fetch(`${base}/__dev/clock`, { method: 'POST', body: JSON.stringify({ atMs: NOW_MS }) });
  return base;
}

async function main() {
  mkdirSync(path.join(ROOT, '.data'), { recursive: true });
  const a = path.join(ROOT, '.data', 'zip12-off-main.sqlite');
  const b = path.join(ROOT, '.data', 'zip12-off-branch.sqlite');
  rmSync(a, { force: true });
  const seeded = spawnSync('npx', ['vite-node', 'scripts/load-seed-local.ts', '--', a, NOW_ISO], { cwd: MAIN, encoding: 'utf8' });
  if (seeded.status !== 0) throw new Error(`seed: ${seeded.stderr || seeded.stdout}`);
  copyFileSync(a, b);
  void Database;
  const [A, B] = await Promise.all([site(MAIN, 5343, a), site(ROOT, 5344, b)]);
  const browser = await chromium.launch();
  const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mobile/15E148 Safari/604.1';
  const norm = (h) =>
    h
      .replace(/«r[0-9a-z]+»/g, '«id»')
      .replace(/(:r[0-9a-z]+:)/g, ':id:')
      .replace(/\/assets\/[^"']+/g, '/assets/x')
      .replace(/ dots-celebrate/g, '')
      .replace(/(datetime="[^"]+?)\.\d{3}Z"/g, '$1Z"')
      .replace(/localhost(:|%3A)534[34]/g, 'localhost$1PORT')
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '<id>');
  async function screen(base, { who, url, scheme, tabName, twice }) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 860 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, colorScheme: scheme, userAgent: UA, reducedMotion: 'reduce' });
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
    await ctx.route('https://venmo.com/**', (r) => r.abort());
    const req = ctx.request;
    await req.post(base + '/api/admin/login', { data: { pin: PIN }, headers: { Origin: base } });
    if (who !== 'admin') {
      const d = await (await req.get(base + '/api/admin/dashboard')).json();
      await req.post(base + '/api/admin/logout', { headers: { Origin: base } });
      await req.post(base + '/api/me', { data: { playerId: d.players.find((p) => p.name === who).id }, headers: { Origin: base } });
    }
    const page = await ctx.newPage();
    const order = [];
    page.on('request', (r) => r.url().includes('/api/') && order.push(`start ${new URL(r.url()).pathname}`));
    page.on('requestfinished', (r) => r.url().includes('/api/') && order.push(`end ${new URL(r.url()).pathname}`));
    const once = async () => {
      order.length = 0;
      await page.goto(base + url);
      await page.waitForLoadState('networkidle');
      if (who === 'admin') await page.locator('.tabbar').waitFor();
      else await page.locator('.schedule article').first().waitFor();
      if (tabName) {
        await page.locator('.tabbar button', { hasText: tabName }).evaluate((x) => x.click());
        await page.waitForTimeout(500);
        if (tabName === 'Settings') for (const s of await page.locator('details > summary').all()) await s.click().catch(() => {});
      }
      await page.waitForTimeout(2000);
    };
    await once();
    let early = '';
    if (twice) {
      // A repeat visit: the games answer is slow, and what shows while it is on its way must be today's (the loading skeleton).
      await page.route('**/api/group', async (r) => (await new Promise((res) => setTimeout(res, 1500)), r.continue()));
      order.length = 0;
      await page.goto(base + url, { waitUntil: 'commit' });
      await page.waitForTimeout(900);
      early = norm(await page.evaluate(() => document.body.innerHTML));
      await page.waitForLoadState('networkidle');
      await page.locator('.schedule article').first().waitFor();
      await page.waitForTimeout(2000);
    }
    const html = norm(await page.evaluate(() => document.body.innerHTML));
    const stored = await page.evaluate(() => [localStorage.getItem('pb_last_screen'), localStorage.getItem('pb_direct_load')]);
    await ctx.close();
    return { html, early, stored, order: order.filter((x) => /status|\/api\/group$/.test(x)).join(' > ') };
  }
  const same = async (name, opts, allow) => {
    await check(name, async () => {
      const [x, y] = await Promise.all([screen(A, opts), screen(B, opts)]);
      const f = allow || ((h) => h);
      if (f(x.html) !== f(y.html)) throw new Error(diffAt(f(x.html), f(y.html)));
      if (x.early !== y.early) throw new Error('while loading: ' + diffAt(x.early, y.early));
      if (y.stored[0] !== null || y.stored[1] !== null) throw new Error(`the branch stored ${JSON.stringify(y.stored)} with the switches off`);
      // The rule, on both: no games question leaves before a set-up answer is back (the dev server asks each one twice, so the exact
      // interleaving of the two copies is timing, not behavior).
      const chain = (o) => {
        const steps = o.split(' > ');
        const firstEnd = steps.indexOf('end /api/status');
        const firstGroup = steps.indexOf('start /api/group');
        return firstEnd >= 0 && firstGroup > firstEnd;
      };
      if (opts.url === '/' && !(chain(x.order) && chain(y.order))) throw new Error(`question order: main ${x.order} | branch ${y.order}`);
    });
  };
  for (const scheme of ['light', 'dark']) {
    for (const who of ['Jordan', 'Harper', 'Avery', 'Gray', 'Casey', 'Kai']) await same(`player home, ${who}, ${scheme}, first and repeat open: identical`, { who, url: '/', scheme, twice: true });
    for (const t of ['Home', 'Players', 'Money', 'History']) await same(`organizer ${t}, ${scheme}: identical`, { who: 'admin', url: '/admin', scheme, tabName: t });
    await same(
      `organizer Settings, ${scheme}: identical apart from the three new switch rows`,
      { who: 'admin', url: '/admin', scheme, tabName: 'Settings' },
      (h) => h.replace(/<div class="set-row-wrap" data-row="speed(LastScreen|DirectLoad|FewerQueries)All">.*?<\/label><\/div>/gs, ''),
    );
  }
  await check('the plain address asks one question after the other, as on main', async () => {
    const y = await screen(B, { who: 'Casey', url: '/', scheme: 'light' });
    const i = y.order.indexOf('end /api/status');
    const j = y.order.indexOf('start /api/group');
    if (!(i >= 0 && j > i)) throw new Error(y.order);
  });
  await browser.close();
  console.log(`\nzip12-off: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
