/* Zip 13: the three new switches OFF (Players redo, Swap to Alex, Undo on admin toasts) must be exactly today's site. This runs today's main
 * (a git worktree, path in MAIN_DIR) and this branch side by side on two copies of the same fake world (seeded by main, so no Zip 13 row
 * exists), with the same pinned clock, and compares the rendered HTML of every screen, player and organizer, light and dark, and of the
 * organizer's own player page (a phone signed in as the organizer: no "Go to Admin"), and after a Mark paid tap (Undo off: saved at once,
 * the same toast). Differences allowed: the three new rows in Settings > Feature switches, and the Money > Totals projected card (the
 * projected costs fix ships live-on, no switch).
 *
 *   MAIN_DIR=/path/to/main-worktree node e2e/zip13-off.cjs
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
const NOW_ISO = '2026-11-07T17:00:00.000Z';
const NOW_MS = Date.parse(NOW_ISO);
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
  return `at ${i}/${a.length}: main «${a.slice(Math.max(0, i - 100), i + 160)}» branch «${b.slice(Math.max(0, i - 100), i + 160)}»`;
}

async function site(dir, port, dbFile) {
  // As on live: the look and speed switches that are off there are off here (empty = the default, which every Settings row then decides).
  const server = spawn('npx', ['vite', '--port', String(port), '--strictPort'], {
    cwd: dir,
    env: { ...process.env, DEV_DB: dbFile, SETUP_TOKEN: 'zip13-off-setup-token-0123456789', DEV_CLOCK: '1' },
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
  const a = path.join(ROOT, '.data', 'zip13-off-main.sqlite');
  const b = path.join(ROOT, '.data', 'zip13-off-branch.sqlite');
  rmSync(a, { force: true });
  const seeded = spawnSync('npx', ['vite-node', 'scripts/load-seed-local.ts', '--', a, NOW_ISO], { cwd: MAIN, encoding: 'utf8' });
  if (seeded.status !== 0) throw new Error(`seed: ${seeded.stderr || seeded.stdout}`);
  copyFileSync(a, b);
  const [A, B] = await Promise.all([site(MAIN, 5353, a), site(ROOT, 5354, b)]);
  const browser = await chromium.launch();
  const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mobile/15E148 Safari/604.1';
  const norm = (h) =>
    h
      .replace(/«r[0-9a-z]+»/g, '«id»')
      .replace(/(:r[0-9a-z]+:)/g, ':id:')
      .replace(/\/assets\/[^"']+/g, '/assets/x')
      .replace(/ dots-celebrate/g, '')
      .replace(/(datetime="[^"]+?)\.\d{3}Z"/g, '$1Z"')
      .replace(/localhost(:|%3A)535[34]/g, 'localhost$1PORT')
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '<id>');
  async function screen(base, { who, url, scheme, tabName, act, width = 390 }) {
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
    if (who === 'organizer-page') {
      // The organizer's own phone on the player page: still signed in as the organizer, and picked their own name.
      await req.post(base + '/api/me', { data: { playerId: d.me.id }, headers: { Origin: base } });
    } else if (who !== 'admin') {
      await req.post(base + '/api/admin/logout', { headers: { Origin: base } });
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
    let toast = '';
    if (act) toast = await act(page);
    await page.waitForTimeout(2000);
    const html = norm(await page.evaluate(() => document.body.innerHTML));
    await ctx.close();
    return { html, toast };
  }
  const same = async (name, opts, allow) => {
    await check(name, async () => {
      const [x, y] = await Promise.all([screen(A, opts), screen(B, opts)]);
      const f = allow || ((h) => h);
      if (f(x.html) !== f(y.html)) throw new Error(diffAt(f(x.html), f(y.html)));
      if (x.toast !== y.toast) throw new Error(`toast: main «${x.toast}» branch «${y.toast}»`);
    });
  };
  const noProjected = (h) => h.replace(/<section class="card mrw-card" data-card="projected".*?<\/section>/gs, '');
  for (const scheme of ['light', 'dark']) {
    for (const who of ['Jordan', 'Avery', 'Gray', 'Casey']) await same(`player home, ${who}, ${scheme}: identical`, { who, url: '/', scheme });
    await same(`the organizer's own player page (signed in as organizer), ${scheme}: identical, no Go to Admin`, { who: 'organizer-page', url: '/', scheme });
    for (const t of ['Home', 'Players', 'Money', 'History']) await same(`organizer ${t}, ${scheme}: identical`, { who: 'admin', url: '/admin', scheme, tabName: t });
    for (const width of [360, 320]) await same(`organizer Players at ${width} px, ${scheme}: identical`, { who: 'admin', url: '/admin', scheme, tabName: 'Players', width });
    await same(
      `organizer Settings, ${scheme}: identical apart from the three new switch rows`,
      { who: 'admin', url: '/admin', scheme, tabName: 'Settings' },
      (h) => h.replace(/<div class="set-row-wrap" data-row="(adminUndo|swapButton|playersRedo)All">.*?<\/label><\/div>/gs, ''),
    );
  }
  await same(
    'organizer Money > Totals: identical apart from the projected card (the projected fix ships live-on)',
    {
      who: 'admin',
      url: '/admin',
      scheme: 'light',
      tabName: 'Money',
      act: async (page) => {
        await page.getByRole('button', { name: /^Totals$/ }).click();
        await page.locator('[data-totals]').waitFor();
        return '';
      },
    },
    noProjected,
  );
  await same('organizer Players tab: tap a row opens the same sheet as main', {
    who: 'admin',
    url: '/admin',
    scheme: 'light',
    tabName: 'Players',
    act: async (page) => {
      await page.locator('.player-open, .r3-open').nth(2).click();
      await page.locator('dialog[open]').waitFor();
      await page.waitForTimeout(700);
      return '';
    },
  });
  await same('Mark paid with Undo off: saved at once, the same toast and screen as main', {
    who: 'admin',
    url: '/admin',
    scheme: 'light',
    tabName: 'Money',
    act: async (page) => {
      const btn = page.locator('article.mrw-game').getByRole('button', { name: /Mark paid/ }).first();
      const saved = page.waitForRequest((r) => /\/payment$/.test(r.url()) && r.method() === 'POST', { timeout: 1500 });
      await btn.click();
      await saved;
      const t = await page.locator('[data-banner] .toast-msg').first().innerText({ timeout: 4000 });
      const undo = await page.locator('[data-banner] .toast-action').count();
      return `${t}|undo:${undo}`;
    },
  });
  await browser.close();
  console.log(`\nzip13-off: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
