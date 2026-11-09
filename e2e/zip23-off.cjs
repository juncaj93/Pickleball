/* Zip 23: the Totals refresh switch OFF must be exactly today's site. This runs today's main (a git worktree, path in MAIN_DIR) and this
 * branch side by side on two copies of the same fake world, with the Totals refresh row OFF and every other row as on live, and compares the
 * rendered HTML:
 *  - the old Money > Totals screen (the screen this zip changes) at 390, 360 and 320 wide, light and dark, and again with Month box = Oct 2026;
 *  - organizer Settings apart from the one new switch row, organizer Home light and dark, Players, Money > Games and History;
 *  - the answers: the dashboard has no Zip 23 key, and the money answer for several months is byte for byte main's.
 *  And ONE more thing: the new look ON in this branch uses no other card on the page (the Games tab is still identical with the switch on).
 *
 *   MAIN_DIR=/path/to/main-worktree node e2e/zip23-off.cjs
 *
 * Not part of npm run test:e2e (it needs the second checkout). Nothing here touches Cloudflare or the live site.
 */
const { spawn, spawnSync } = require('node:child_process');
const { readFileSync, mkdirSync, rmSync, copyFileSync } = require('node:fs');
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const MAIN = process.env.MAIN_DIR;
if (!MAIN) throw new Error('set MAIN_DIR to a checkout of main');
const SEED_ISO = '2026-11-09T15:00:00.000Z'; // Mon Nov 9, 10:00 AM Eastern (the seed, and now)
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
  return `at ${i}/${a.length}: main «${a.slice(Math.max(0, i - 100), i + 160)}» branch «${b.slice(Math.max(0, i - 100), i + 160)}»`;
}

async function site(dir, port, dbFile) {
  // As on live: no PREVIEW_CALM, every wrangler.toml switch at its default ("on" = allowed), the Settings rows decide.
  const server = spawn('npx', ['vite', '--port', String(port), '--strictPort'], {
    cwd: dir,
    env: { ...process.env, DEV_DB: dbFile, SETUP_TOKEN: 'zip23-off-setup-token-0123456789', DEV_CLOCK: '1' },
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
  const a = path.join(ROOT, '.data', 'zip23-off-main.sqlite');
  const b = path.join(ROOT, '.data', 'zip23-off-branch.sqlite');
  rmSync(a, { force: true });
  const seeded = spawnSync('npx', ['vite-node', 'scripts/load-seed-local.ts', '--', a, SEED_ISO], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, SEED_ZIP13: '1', SEED_ZIP14: '1', SEED_ZIP15: '1', SEED_ZIP17: '1' } });
  if (seeded.status !== 0) throw new Error(`seed: ${seeded.stderr || seeded.stdout}`);
  const db = new DatabaseSync(a);
  // The row this zip adds is OFF, as it ships. As on live: every other Settings row is on, including the six the older local world leaves off.
  db.exec("DELETE FROM task_log WHERE session_id IS NULL AND task = 'totals_refresh_on'");
  for (const t of ['alert_cards_on', 'seat_dots_on', 'speed_fewer_queries_on', 'speed_direct_load_on', 'speed_last_screen_on', 'speed_last_screen_admin_on'])
    db.exec(`INSERT INTO task_log (id, group_id, session_id, task, kind, at) SELECT 'live-${t}', id, NULL, '${t}', 'mark', '${SEED_ISO}' FROM groups WHERE NOT EXISTS (SELECT 1 FROM task_log WHERE task = '${t}' AND session_id IS NULL)`);
  db.close();
  copyFileSync(a, b);
  const [A, B] = await Promise.all([site(MAIN, 5395, a), site(ROOT, 5396, b)]);
  const browser = await chromium.launch();
  const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
  const norm = (h) =>
    h
      .replace(/«r[0-9a-z]+»/g, '«id»')
      .replace(/(:r[0-9a-z]+:)/g, ':id:')
      .replace(/\/assets\/[^"']+/g, '/assets/x')
      .replace(/ dots-celebrate/g, '')
      .replace(/(datetime="[^"]+?)\.\d{3}Z"/g, '$1Z"')
      .replace(/(datetime="\d{4}-\d\d-\d\dT\d\d:\d\d):\d\dZ"/g, '$1Z"')
      .replace(/localhost(:|%3A)539[56]/g, 'localhost$1PORT')
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '<id>');
  async function screen(base, { url = '/admin', scheme = 'light', tabName, act, width = 390, pretendOn = false }) {
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
    }, NOW_MS - Date.now());
    await ctx.route('https://venmo.com/**', (r) => r.abort());
    const req = ctx.request;
    await req.post(base + '/api/admin/login', { data: { pin: PIN }, headers: { Origin: base } });
    const page = await ctx.newPage();
    await page.goto(base + url);
    await page.waitForLoadState('networkidle');
    await page.locator('.tabbar').waitFor();
    if (tabName) {
      await page.locator('.tabbar button', { hasText: tabName }).evaluate((x) => x.click());
      await page.waitForTimeout(600);
      if (tabName === 'Settings') for (const s of await page.locator('details > summary').all()) await s.click().catch(() => {});
    }
    let out = '';
    if (act) out = await act(page, req, base);
    await page.waitForTimeout(1200);
    await page.evaluate(() => document.querySelectorAll('.pop.toast').forEach((e) => e.remove()));
    const html = norm(await page.evaluate(() => document.documentElement.outerHTML.replace(/<head>.*<\/head>/s, '')));
    await ctx.close();
    return { html, out };
  }
  const toTotals = async (page) => {
    await page.locator('.mrw-seg button', { hasText: 'Totals' }).click();
    await page.locator('[data-totals]').waitFor();
    await page.waitForTimeout(700);
    return '';
  };
  const toOct = async (page) => {
    await toTotals(page);
    await page.locator('[data-month-box]').click();
    await page.locator('[data-month-option="2026-10"]').click();
    await page.waitForTimeout(800);
    return '';
  };
  const same = async (name, opts, allow) => {
    await check(name, async () => {
      const [x, y] = await Promise.all([screen(A, opts), screen(B, opts)]);
      const f = allow || ((h) => h);
      if (f(x.html) !== f(y.html)) throw new Error(diffAt(f(x.html), f(y.html)));
      if (x.out !== y.out) throw new Error(`main «${x.out}» branch «${y.out}»`);
    });
  };
  for (const scheme of ['light', 'dark'])
    for (const width of [390, 360, 320]) await same(`Money > Totals (the old screen), ${width} px, ${scheme}: identical to main`, { tabName: 'Money', act: toTotals, scheme, width });
  await same('Money > Totals with the month box on Oct 2026, light: identical to main', { tabName: 'Money', act: toOct });
  await same('Money > Totals, Oct 2026, dark: identical to main', { tabName: 'Money', act: toOct, scheme: 'dark' });
  for (const scheme of ['light', 'dark'])
    await same(
      `organizer Settings, ${scheme}: identical apart from the one new switch row`,
      { url: '/admin', tabName: 'Settings', scheme },
      (h) => h.replace(/<div class="set-row-wrap" data-row="totalsRefreshAll">.*?<\/label><\/div>/gs, '').replace(/Totals refresh on, /g, ''),
    );
  for (const scheme of ['light', 'dark']) await same(`organizer Home, ${scheme}: identical`, { scheme });
  await same('organizer Money > Games, light: identical', { tabName: 'Money' });
  for (const t of ['Players', 'History']) await same(`organizer ${t}, light: identical`, { tabName: t });
  await check('answers with the switch off: no Zip 23 key in the dashboard, and the money answer for every month is byte for byte main', async () => {
    const get = async (base, p) => {
      const ctx = await browser.newContext();
      await ctx.request.post(base + '/api/admin/login', { data: { pin: PIN }, headers: { Origin: base } });
      const r = await (await ctx.request.get(base + p, { headers: { 'X-Money-Rework': 'on' } })).text();
      await ctx.close();
      return r;
    };
    const d = await get(B, '/api/admin/dashboard');
    if (/totalsRefresh/i.test(d)) throw new Error('dashboard has a Zip 23 key');
    for (const m of ['2026-11', '2026-10', '2026-09', '2026-03', '2025-12']) {
      const [x, y] = await Promise.all([get(A, `/api/admin/money?month=${m}`), get(B, `/api/admin/money?month=${m}`)]);
      if (x !== y) throw new Error(`money ${m}: ${diffAt(x, y)}`);
    }
  });
  await check('the switch ON changes Money > Totals only: the Games tab and organizer Home are identical to main (the new look touches no other card)', async () => {
    const on = { url: '/admin?totalsrefresh=on' };
    for (const opts of [{ ...on, tabName: 'Money' }, { ...on }]) {
      const [x, y] = await Promise.all([screen(A, { ...opts, url: '/admin' }), screen(B, opts)]);
      if (x.html !== y.html) throw new Error(diffAt(x.html, y.html));
    }
  });
  await browser.close();
  console.log(`\nzip23-off: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
