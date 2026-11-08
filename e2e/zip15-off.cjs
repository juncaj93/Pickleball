/* Zip 15: the Second Chance switch OFF must be exactly today's site. This runs today's main (a git worktree, path in MAIN_DIR) and this
 * branch side by side on two copies of the same fake world (the Zip 15 world: a game canceled the night before with 3 in, one with 2 in, a
 * same-day game with a paid and unpaid mix, Venmo saved for some), with the Second Chance row OFF, at noon on that game day (Tue Nov 10), and
 * compares the rendered HTML: organizer Home at 390, 360 and 320 wide, light and dark (the screen this zip changes), the other organizer tabs,
 * the player Edit sheet (the Venmo note), Settings apart from the one new row, and player homes. Also: the dashboard has no Zip 15 key, and
 * a player tap (I'm in) writes no Second Chance row with the switch off.
 *
 *   MAIN_DIR=/path/to/main-worktree node e2e/zip15-off.cjs
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
const SEED_ISO = '2026-11-08T17:00:00.000Z'; // Sun Nov 8, noon Eastern (the seed)
const NOW_ISO = '2026-11-10T17:00:00.000Z'; // Tue Nov 10, noon Eastern: game day
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
    env: { ...process.env, DEV_DB: dbFile, SETUP_TOKEN: 'zip15-off-setup-token-0123456789', DEV_CLOCK: '1' },
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
  const a = path.join(ROOT, '.data', 'zip15-off-main.sqlite');
  const b = path.join(ROOT, '.data', 'zip15-off-branch.sqlite');
  rmSync(a, { force: true });
  // The branch's seed (the Zip 15 games are made through the real site; main runs on it unchanged: no schema change in this zip).
  const seeded = spawnSync('npx', ['vite-node', 'scripts/load-seed-local.ts', '--', a, SEED_ISO], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, SEED_ZIP14: '1', SEED_ZIP15: '1' } });
  if (seeded.status !== 0) throw new Error(`seed: ${seeded.stderr || seeded.stdout}`);
  const db = new DatabaseSync(a);
  db.exec("DELETE FROM task_log WHERE session_id IS NULL AND task = 'second_chance_on'");
  // As on live (read Nov 8): the three Zip 13 rows are on too (Players redo: the Edit player sheet is its sheet).
  for (const t of ['players_redo_on', 'swap_button_on', 'admin_undo_on'])
    db.exec(`INSERT INTO task_log (id, group_id, session_id, task, kind, at) SELECT 'off-${t}', id, NULL, '${t}', 'mark', '${SEED_ISO}' FROM groups`);
  db.close();
  copyFileSync(a, b);
  const [A, B] = await Promise.all([site(MAIN, 5373, a), site(ROOT, 5374, b)]);
  const browser = await chromium.launch();
  const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mobile/15E148 Safari/604.1';
  const norm = (h) =>
    h
      .replace(/«r[0-9a-z]+»/g, '«id»')
      .replace(/(:r[0-9a-z]+:)/g, ':id:')
      .replace(/\/assets\/[^"']+/g, '/assets/x')
      .replace(/ dots-celebrate/g, '')
      .replace(/(datetime="[^"]+?)\.\d{3}Z"/g, '$1Z"')
      .replace(/localhost(:|%3A)537[34]/g, 'localhost$1PORT')
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
    if (who !== 'admin') {
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
    let out = '';
    if (act) out = await act(page);
    await page.waitForTimeout(1500);
    // A passing pop-up ("Game on! 5 in") can be caught mid-slide on either side; its spoken words (aria-live) are still compared.
    await page.evaluate(() => document.querySelectorAll('.pop.toast').forEach((e) => e.remove()));
    const html = norm(await page.evaluate(() => document.documentElement.outerHTML.replace(/<head>.*<\/head>/s, '')));
    await ctx.close();
    return { html, out };
  }
  const same = async (name, opts, allow) => {
    await check(name, async () => {
      const [x, y] = await Promise.all([screen(A, opts), screen(B, opts)]);
      const f = allow || ((h) => h);
      if (f(x.html) !== f(y.html)) throw new Error(diffAt(f(x.html), f(y.html)));
      if (x.out !== y.out) throw new Error(`main «${x.out}» branch «${y.out}»`);
    });
  };
  const editKai = async (page) => {
    await page.locator('[data-pr-row="Kai"]').click();
    await page.locator('[data-pr-edit]').click();
    await page.waitForTimeout(400);
    return (await page.locator('dialog.sheet[open]').last().innerText()).includes('For refunds. Only you see this.') ? 'old note' : 'NEW NOTE';
  };
  for (const scheme of ['light', 'dark']) {
    for (const width of [390, 360, 320]) await same(`organizer Home, ${width} px, ${scheme}: identical (no Second Chance card, no Request button)`, { who: 'admin', url: '/admin?noontest=on&secondchance=off', scheme, width });
    await same(`organizer Edit player sheet, ${scheme}: identical, the old Venmo note`, { who: 'admin', url: '/admin', scheme, tabName: 'Players', act: editKai });
    await same(
      `organizer Settings, ${scheme}: identical apart from the one new switch row`,
      { who: 'admin', url: '/admin', scheme, tabName: 'Settings' },
      (h) => h.replace(/<div class="set-row-wrap" data-row="secondChanceAll">.*?<\/label><\/div>/gs, ''),
    );
  }
  for (const t of ['Players', 'Money', 'History']) await same(`organizer ${t}, light: identical`, { who: 'admin', url: '/admin', scheme: 'light', tabName: t });
  for (const who of ['Kai', 'Harper', 'Reese', 'Indy']) await same(`player home, ${who}, light: identical`, { who, url: '/', scheme: 'light' });
  // Last: it taps on the branch's copy only.
  await check('API with the switch off: no secondChance key in the dashboard or the player answer; a join writes no Second Chance row', async () => {
    const ctx = await browser.newContext();
    await ctx.request.post(B + '/api/admin/login', { data: { pin: PIN }, headers: { Origin: B } });
    const d = await (await ctx.request.get(B + '/api/admin/dashboard', { headers: { 'X-Second-Chance-Noon': 'on' } })).text();
    if (/secondChance/.test(d)) throw new Error('dashboard has a Zip 15 key');
    const dd = JSON.parse(d);
    const same = dd.sessions.find((s) => s.roster.some((r) => r.name === 'Reese' && r.status === 'confirmed') && s.startsAt.startsWith('2026-11-1'));
    await ctx.request.post(B + `/api/admin/sessions/${same.id}/me`, { data: { in: true }, headers: { Origin: B } });
    const db2 = new DatabaseSync(b);
    const rows = db2.prepare("SELECT COUNT(*) AS n FROM task_log WHERE task LIKE 'sc_%'").get().n;
    db2.close();
    if (rows !== 0) throw new Error(`${rows} Second Chance rows written with the switch off`);
    await ctx.request.post(B + `/api/admin/sessions/${same.id}/me`, { data: { in: false }, headers: { Origin: B } });
    await ctx.request.post(B + '/api/me', { data: { playerId: dd.players.find((p) => p.name === 'Kai').id }, headers: { Origin: B } });
    const g = await (await ctx.request.get(B + '/api/group')).text();
    if (/secondChance|sc_/.test(g)) throw new Error('player answer has a Zip 15 key');
    await ctx.close();
  });
  await browser.close();
  console.log(`\nzip15-off: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
