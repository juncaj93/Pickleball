/* Zip 18 ships live (no switch: the header is look only, View as is a fix). This checks that NOTHING ELSE changed against today's
 * main (a git worktree, path in MAIN_DIR), running both side by side on two copies of the same small preview world, every Settings row
 * and every wrangler.toml switch as on live:
 *  - every organizer screen (Home light and dark, Players, Money, History, Settings): identical, the Admin header included;
 *  - a player's page (Vic, Wren, Zoe, Quinn at 390 / 360 / 320, light and dark): identical apart from the small group label that is gone,
 *    and the light/dark button and the date tile sit at exactly the same spot;
 *  - the organizer's own player page: identical apart from the label, the title button (Alex + swap icon) and the bottom pill that is gone;
 *  - the player answer (/api/group) is byte for byte the same for a player; for the organizer's own phone only goToAdmin differs.
 *
 *   MAIN_DIR=/path/to/main-worktree node e2e/zip18-off.cjs
 *
 * Not part of npm run test:e2e (it needs the second checkout). Nothing here touches Cloudflare or the live site.
 */
const { spawn, spawnSync } = require('node:child_process');
const { readFileSync, mkdirSync, rmSync, copyFileSync } = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const MAIN = process.env.MAIN_DIR;
if (!MAIN) throw new Error('set MAIN_DIR to a checkout of main');
const SEED_ISO = '2026-11-09T17:00:00.000Z'; // Mon Nov 9, noon Eastern
const NOW_MS = Date.parse(SEED_ISO);
const PIN = /PIN `(\d{6})`/.exec(readFileSync(path.join(ROOT, 'docs/PREVIEW_FAKE_DB.md'), 'utf8'))[1];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let passed = 0;
let failed = 0;
async function check(name, fn) {
  if (process.env.E2E_ONLY && !new RegExp(process.env.E2E_ONLY).test(name)) return;
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
  return `at ${i}/${a.length}: main «${a.slice(Math.max(0, i - 120), i + 160)}» branch «${b.slice(Math.max(0, i - 120), i + 160)}»`;
}
function liveVars() {
  const toml = readFileSync(path.join(ROOT, 'wrangler.toml'), 'utf8');
  const top = toml.slice(toml.indexOf('[vars]'), toml.indexOf('[env.preview]'));
  const out = {};
  for (const m of top.matchAll(/^([A-Z_][A-Z0-9_]*)\s*=\s*"([^"]*)"/gm)) if (m[1] !== 'SITE_URL') out[m[1]] = m[2];
  return out;
}

async function site(dir, port, dbFile) {
  const server = spawn('npx', ['vite', '--port', String(port), '--strictPort'], {
    cwd: dir,
    env: { ...process.env, ...liveVars(), DEV_DB: dbFile, SETUP_TOKEN: 'zip18-off-setup-token-0123456789', DEV_CLOCK: '1', APP_BUILD: 'same' },
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
  const a = path.join(ROOT, '.data', 'zip18-off-main.sqlite');
  const b = path.join(ROOT, '.data', 'zip18-off-branch.sqlite');
  rmSync(a, { force: true });
  const seeded = spawnSync('npx', ['vite-node', 'scripts/load-small-local.ts', '--', a, SEED_ISO], { cwd: ROOT, encoding: 'utf8' });
  if (seeded.status !== 0) throw new Error(`seed: ${seeded.stderr || seeded.stdout}`);
  copyFileSync(a, b);
  const [A, B] = await Promise.all([site(MAIN, 5393, a), site(ROOT, 5394, b)]);
  const browser = await chromium.launch();
  const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mobile/15E148 Safari/604.1';
  const norm = (h) =>
    h
      .replace(/«r[0-9a-z]+»/g, '«id»')
      .replace(/(:r[0-9a-z]+:)/g, ':id:')
      .replace(/\/assets\/[^"']+/g, '/assets/x')
      .replace(/ dots-celebrate/g, '')
      .replace(/(datetime="[^"]+?)\.\d{3}Z"/g, '$1Z"')
      .replace(/localhost(:|%3A)539[34]/g, 'localhost$1PORT')
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '<id>');
  async function screen(base, { who, signedIn = false, url = '/', scheme = 'light', tabName, width = 390 }) {
    const ctx = await browser.newContext({ viewport: { width, height: 860 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, colorScheme: scheme, userAgent: UA, reducedMotion: 'reduce' });
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
    const d = await (await req.get(base + '/api/admin/dashboard')).json();
    if (who !== 'admin') {
      if (!signedIn) await req.post(base + '/api/admin/logout', { data: {}, headers: { Origin: base } });
      await req.post(base + '/api/me', { data: { playerId: d.players.find((p) => p.name === who).id }, headers: { Origin: base } });
    }
    const page = await ctx.newPage();
    await page.goto(base + url);
    await page.waitForLoadState('networkidle');
    if (who === 'admin') await page.locator('.tabbar').waitFor();
    else await page.locator('.schedule article').first().waitFor();
    if (tabName) {
      await page.locator('.tabbar button', { hasText: tabName }).evaluate((x) => x.click());
      await page.waitForTimeout(600);
      if (tabName === 'Settings') for (const s of await page.locator('details > summary').all()) await s.click().catch(() => {});
    }
    await page.waitForTimeout(1200);
    await page.evaluate(() => document.querySelectorAll('.pop.toast').forEach((e) => e.remove()));
    const html = norm(await page.evaluate(() => document.documentElement.outerHTML.replace(/<head>.*<\/head>/s, '')));
    const spots = await page.evaluate(() => {
      const r = (s) => {
        const b = document.querySelector(s)?.getBoundingClientRect();
        return b ? [b.left, b.top, b.width, b.height].map((n) => Math.round(n * 10) / 10).join(',') : null;
      };
      return { mode: r('.topbar .mode-btn'), today: r('.topbar .today'), tile: r('.topbar .brand-tile'), main: r('main.page') };
    });
    // The answer as the server sends it, apart from its own clock reading (the two servers answer a few ms apart).
    const api = who === 'admin' ? null : (await (await req.get(base + '/api/group')).text()).replace(/"now":"[^"]+"/, '"now":"x"');
    await ctx.close();
    return { html, spots, api };
  }
  // What this zip changes on a player page, taken out of both sides before comparing.
  const playerAllow = (h) =>
    h
      // The small group label over the name (main only).
      .replace(/<div class="eyebrow">[^<]*<\/div>/g, '')
      // The organizer's own page: main's plain title + "not you?" line, and the branch's title button around the same title.
      .replace(/<button type="button" class="title-swap"[^>]*><h1>([^<]*)<\/h1><svg class="swap-icon".*?<\/svg><\/button>/s, '<h1>$1</h1>')
      // The bottom "Go to Admin" pill (main only).
      .replace(/<div class="go-admin-wrap">.*?<\/div>/s, '')
      // The comment the branch leaves where the pill was is not in the HTML; nothing else to take out.
      ;
  for (const scheme of ['light', 'dark'])
    for (const width of [390, 360, 320])
      for (const who of ['Vic', 'Wren', 'Zoe', 'Quinn']) {
        if (width !== 390 && who === 'Quinn') continue;
        await check(`player page ${who}, ${width} px, ${scheme}: identical to main apart from the label; sun button and date tile at the same spot`, async () => {
          const [x, y] = await Promise.all([screen(A, { who, scheme, width }), screen(B, { who, scheme, width })]);
          const f = playerAllow;
          if (f(x.html) !== f(y.html)) throw new Error(diffAt(f(x.html), f(y.html)));
          if (x.spots.mode !== y.spots.mode || x.spots.today !== y.spots.today || x.spots.tile !== y.spots.tile) throw new Error(`moved: main ${JSON.stringify(x.spots)} branch ${JSON.stringify(y.spots)}`);
          if (x.api !== y.api) throw new Error(`the player answer differs: ${diffAt(x.api, y.api)}`);
        });
      }
  for (const scheme of ['light', 'dark'])
    await check(`the organizer's own player page (signed in), ${scheme}: identical to main apart from the label, the title button and the bottom pill`, async () => {
      const [x, y] = await Promise.all([screen(A, { who: 'Alex', signedIn: true, scheme }), screen(B, { who: 'Alex', signedIn: true, scheme })]);
      const f = playerAllow;
      if (!/go-admin-wrap/.test(x.html)) throw new Error('main has no Go to Admin pill here (the comparison would prove nothing)');
      if (!/title-swap/.test(y.html) || /go-admin/.test(y.html)) throw new Error('branch: no title button, or the pill is still there');
      if (f(x.html) !== f(y.html)) throw new Error(diffAt(f(x.html), f(y.html)));
      if (x.spots.mode !== y.spots.mode || x.spots.today !== y.spots.today) throw new Error(`moved: main ${JSON.stringify(x.spots)} branch ${JSON.stringify(y.spots)}`);
      if (x.api !== y.api) throw new Error(`the answer differs: ${diffAt(x.api, y.api)}`);
    });
  for (const scheme of ['light', 'dark'])
    await check(`organizer Home, ${scheme}: identical (the Admin header included)`, async () => {
      const [x, y] = await Promise.all([screen(A, { who: 'admin', url: '/admin', scheme }), screen(B, { who: 'admin', url: '/admin', scheme })]);
      if (x.html !== y.html) throw new Error(diffAt(x.html, y.html));
    });
  for (const t of ['Players', 'Money', 'History', 'Settings'])
    await check(`organizer ${t}, light: identical`, async () => {
      const [x, y] = await Promise.all([screen(A, { who: 'admin', url: '/admin', tabName: t }), screen(B, { who: 'admin', url: '/admin', tabName: t })]);
      if (x.html !== y.html) throw new Error(diffAt(x.html, y.html));
    });
  await browser.close();
  console.log(`\nzip18-off: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
