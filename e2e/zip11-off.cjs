/* Zip 11: "Alert cards" OFF must be exactly today's site. This runs today's main (a git worktree, path in MAIN_DIR) and this branch side by
 * side on two byte copies of the same fake world (this branch's seed, which has one of every alert: a moved game, a credit adjustment, a late
 * drop someone took, a cash out, a claim, a game to finalize, a Want in card, with the Alert cards row taken out so the switch is OFF), with
 * the same pinned clock, and compares the rendered HTML of every screen, player and organizer, light and dark, before and after the same
 * taps on the alerts. The only difference allowed is the new row in Settings > Feature switches.
 *
 *   MAIN_DIR=/path/to/main-worktree node e2e/zip11-off.cjs
 *
 * Not part of npm run test:e2e (it needs the second checkout). Nothing here touches Cloudflare or the live site.
 */
const { spawn, spawnSync } = require('node:child_process');
const { readFileSync, mkdirSync, rmSync, copyFileSync } = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const MAIN = process.env.MAIN_DIR;
if (!MAIN) throw new Error('set MAIN_DIR to a checkout of main');
const NOW_ISO = '2026-11-06T15:00:00.000Z';
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
  const server = spawn('npx', ['vite', '--port', String(port), '--strictPort'], {
    cwd: dir,
    env: { ...process.env, DEV_DB: dbFile, SETUP_TOKEN: 'zip11-off-setup-token-0123456789', DEV_CLOCK: '1', MOTION: '', MOTION_ADMIN: '' },
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
  const a = path.join(ROOT, '.data', 'zip11-off-main.sqlite');
  const b = path.join(ROOT, '.data', 'zip11-off-branch.sqlite');
  rmSync(a, { force: true });
  const seeded = spawnSync('npx', ['vite-node', 'scripts/load-seed-local.ts', '--', a, NOW_ISO], { cwd: ROOT, encoding: 'utf8' });
  if (seeded.status !== 0) throw new Error(`seed: ${seeded.stderr || seeded.stdout}`);
  // The switch OFF: the Alert cards row is taken out of the world (main never knew it); both sites then get the same bytes.
  const db = new DatabaseSync(a);
  // Both look switches OFF: Alert cards and Seat dots (main knows only the first; neither row may be left).
  const gone = db.prepare("DELETE FROM task_log WHERE task IN ('alert_cards_on', 'seat_dots_on')").run();
  db.close();
  if (gone.changes !== 2) throw new Error(`expected the Alert cards and Seat dots rows in the seed, found ${gone.changes}`);
  copyFileSync(a, b);
  const [A, B] = await Promise.all([site(MAIN, 5343, a), site(ROOT, 5344, b)]);
  const browser = await chromium.launch();
  const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
  const norm = (h) =>
    h
      .replace(/«r[0-9a-z]+»/g, '«id»')
      .replace(/(:r[0-9a-z]+:)/g, ':id:')
      .replace(/\/assets\/[^"']+/g, '/assets/x')
      // The dev server's own cache-buster after a file changed while it ran (not the site's markup).
      .replace(/main\.tsx\?t=\d+/g, 'main.tsx')
      .replace(/ dots-celebrate/g, '')
      .replace(/(datetime="[^"]+?)\.\d{3}Z"/g, '$1Z"')
      .replace(/localhost(:|%3A)534[34]/g, 'localhost$1PORT')
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '<id>');
  async function screen(base, { who, url, scheme, tabName, before, width = 390 }) {
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
    if (who !== 'admin') {
      const d = await (await req.get(base + '/api/admin/dashboard')).json();
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
      await page.waitForTimeout(500);
      if (tabName === 'Settings') for (const s of await page.locator('details > summary').all()) await s.click().catch(() => {});
    }
    if (before) await before(page);
    await page.waitForTimeout(2500);
    const html = norm(await page.evaluate(() => document.body.innerHTML));
    const attr = await page.evaluate(() => document.documentElement.hasAttribute('data-alert-cards') || document.documentElement.hasAttribute('data-seat-dots'));
    await ctx.close();
    return attr ? `<<data-alert-cards on>>${html}` : html;
  }
  /** Each comparison on fresh copies of the same world, so a tap on one never leaks into the next. */
  const same = async (name, opts, allow) => {
    await check(name, async () => {
      const [x, y] = await Promise.all([screen(A, opts), screen(B, opts)]);
      const y2 = allow ? allow(y) : y;
      const x2 = allow ? allow(x) : x;
      if (x2 !== y2) throw new Error(diffAt(x2, y2));
    });
  };
  const PLAYERS = ['Jordan', 'Blake', 'Casey', 'Indy', 'Gray', 'Kai', 'Harper'];
  // Harper (a Thursday regular in the fake world) has the Want in card with empty seats.
  PLAYERS.push('Lane');
  for (const scheme of ['light', 'dark']) {
    for (const who of PLAYERS) await same(`player home, ${who}, ${scheme}: identical`, { who, url: '/', scheme });
    for (const t of ['Home', 'Players', 'Money', 'History']) await same(`organizer ${t}, ${scheme}: identical`, { who: 'admin', url: '/admin', scheme, tabName: t });
    await same(
      `organizer Settings, ${scheme}: identical apart from the new switch row`,
      { who: 'admin', url: '/admin', scheme, tabName: 'Settings' },
      (h) => h.replace(/<div class="set-row-wrap" data-row="(alertCardsAll|seatDotsAll)">.*?<\/label><\/div>/gs, ''),
    );
  }
  for (const width of [360, 320]) {
    for (const who of ['Jordan', 'Casey']) await same(`player home, ${who}, ${width} px: identical`, { who, url: '/', scheme: 'light', width });
    await same(`organizer Home, ${width} px: identical`, { who: 'admin', url: '/admin', scheme: 'light', tabName: 'Home', width });
  }
  const tap = (sel) => async (page) => {
    const b = page.locator(sel).first();
    if (await b.count()) await b.click();
    await page.waitForTimeout(3000);
  };
  const tapText = (re) => async (page) => {
    const b = page.getByRole('button', { name: re }).first();
    if (await b.count()) await b.click();
    await page.waitForTimeout(3000);
  };
  // The alerts' buttons: each tap leaves the same screen behind on both sites.
  await same('player Want in, Yes (Casey), after the tap: identical', { who: 'Casey', url: '/', scheme: 'light', before: tapText(/^Yes$/) });
  await same('player Want in, No (Harper or Casey), after the tap: identical', { who: 'Casey', url: '/', scheme: 'light', before: tapText(/^No$/) });
  await same('player Pay card, I paid (Jordan), after the tap: identical', { who: 'Jordan', url: '/', scheme: 'light', before: tap('.pay-card .btn.secondary') });
  await same('player Pay card, Pay opens the Pay sheet (Jordan): identical', { who: 'Jordan', url: '/', scheme: 'light', before: tap('.pay-card a.btn') });
  await same('player moved game, Still in (Indy), after the tap: identical', { who: 'Indy', url: '/', scheme: 'light', before: tap('.ts-yes') });
  await same("player moved game, Can't make it (Indy), the drop question: identical", { who: 'Indy', url: '/', scheme: 'light', before: tap('.ts-no') });
  await same('player cleared debt, Dismiss (Blake), after the tap: identical', { who: 'Blake', url: '/', scheme: 'light', before: tap('.fee-notice button') });
  await same("player cash-out question (Gray taps I'm in), identical", { who: 'Gray', url: '/', scheme: 'light', before: tap('.schedule article [data-join]') });
  await same('organizer Did you guys play?, Yes (after the tap): identical', { who: 'admin', url: '/admin', scheme: 'light', tabName: 'Home', before: tap('[data-action="played"]') });
  await same('organizer cash-out request, Not now (after the tap): identical', { who: 'admin', url: '/admin', scheme: 'light', tabName: 'Home', before: tap('[data-not-now]') });
  await same("organizer unconfirmed I paid, Didn't pay (after the tap): identical", { who: 'admin', url: '/admin', scheme: 'light', tabName: 'Home', before: tap('[data-claim-not-paid]') });
  await same('organizer +N more opened: identical', { who: 'admin', url: '/admin', scheme: 'light', tabName: 'Home', before: tap('.dn-more') });
  await browser.close();
  console.log(`\nzip11-off: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
