/* Zip 14: the Game day card switch OFF must be exactly today's site, on game day. This runs today's main (a git worktree, path in MAIN_DIR)
 * and this branch side by side on two copies of the same fake world (seeded by main on Tue Nov 10 at 3:28 PM Eastern, game day), with the
 * same pinned clock, and compares the rendered HTML of every screen, player and organizer, light and dark, 390, 360 and 320 wide for the
 * player home (the screen this zip changes), the organizer Edit game and Add game sheets (no Court row), and Settings apart from the one new
 * row. Both copies first get migration 0017 with courts set on two of tonight's games, so this also proves the build before Zip 14 (main)
 * runs unchanged on the migrated database (rollback safety) and that a stored court shows nowhere with the switch off.
 *
 *   MAIN_DIR=/path/to/main-worktree node e2e/zip14-off.cjs
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
const NOW_ISO = '2026-11-10T20:28:00.000Z'; // Tue Nov 10, 3:28 PM Eastern: game day
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
    env: { ...process.env, DEV_DB: dbFile, SETUP_TOKEN: 'zip14-off-setup-token-0123456789', DEV_CLOCK: '1' },
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
  const a = path.join(ROOT, '.data', 'zip14-off-main.sqlite');
  const b = path.join(ROOT, '.data', 'zip14-off-branch.sqlite');
  rmSync(a, { force: true });
  const seeded = spawnSync('npx', ['vite-node', 'scripts/load-seed-local.ts', '--', a, NOW_ISO], { cwd: MAIN, encoding: 'utf8' });
  if (seeded.status !== 0) throw new Error(`seed: ${seeded.stderr || seeded.stdout}`);
  // Migration 0017 on the shared world (as live will have it), recorded as applied, with courts on the two earliest games still to come today.
  const db = new DatabaseSync(a);
  db.exec(readFileSync(path.join(ROOT, 'migrations/0017_court.sql'), 'utf8'));
  db.exec("INSERT INTO _migrations (name) VALUES ('0017_court.sql')");
  const today = db.prepare("SELECT id FROM sessions WHERE starts_at > ? AND starts_at < ? AND status <> 'canceled' ORDER BY starts_at LIMIT 2").all(NOW_ISO, '2026-11-11T05:00:00.000Z');
  if (today.length < 1) throw new Error('no game tonight in the world');
  today.forEach((r, i) => db.prepare('UPDATE sessions SET court = ? WHERE id = ?').run(i === 0 ? 3 : 11, r.id));
  db.close();
  copyFileSync(a, b);
  const [A, B] = await Promise.all([site(MAIN, 5363, a), site(ROOT, 5364, b)]);
  const browser = await chromium.launch();
  const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mobile/15E148 Safari/604.1';
  const norm = (h) =>
    h
      .replace(/«r[0-9a-z]+»/g, '«id»')
      .replace(/(:r[0-9a-z]+:)/g, ':id:')
      .replace(/\/assets\/[^"']+/g, '/assets/x')
      .replace(/ dots-celebrate/g, '')
      .replace(/(datetime="[^"]+?)\.\d{3}Z"/g, '$1Z"')
      .replace(/localhost(:|%3A)536[34]/g, 'localhost$1PORT')
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
  const editTonight = async (page) => {
    await page.locator('button[aria-label^="Game menu"]').first().click();
    await page.getByRole('menuitem', { name: /Edit game/ }).click();
    await page.locator('dialog.sheet[open] form.edit-game').waitFor();
    return String(await page.locator('[data-court-row]').count());
  };
  const addGame = async (page) => {
    await page.getByRole('button', { name: /\+ Add game/ }).first().click();
    await page.locator('dialog.sheet[open] form.add-game').waitFor();
    return String(await page.locator('[data-court-row]').count());
  };
  // The branch's dashboard and player answers carry no new key at all with the switch off.
  await check('API with the switch off: no gameDayCard flag, no court on any game (player and organizer), the stored courts are ignored', async () => {
    const ctx = await browser.newContext();
    await ctx.request.post(B + '/api/admin/login', { data: { pin: PIN }, headers: { Origin: B } });
    const d = await (await ctx.request.get(B + '/api/admin/dashboard')).text();
    if (/gameDayCard|courtNum/.test(d)) throw new Error('dashboard has a Zip 14 key');
    await ctx.request.post(B + '/api/me', { data: { playerId: JSON.parse(d).players.find((p) => p.name === 'Indy').id }, headers: { Origin: B } });
    const g = await (await ctx.request.get(B + '/api/group')).text();
    if (/gameDay|"court":/.test(g)) throw new Error('player answer has a Zip 14 key');
    await ctx.close();
  });
  for (const scheme of ['light', 'dark']) {
    for (const width of [390, 360, 320]) await same(`player home, Indy (in tonight), ${width} px, ${scheme}: identical`, { who: 'Indy', url: '/', scheme, width });
    for (const who of ['Jordan', 'Avery', 'Gray', 'Harper']) await same(`player home, ${who}, ${scheme}: identical`, { who, url: '/', scheme });
    for (const t of ['Home', 'Players', 'Money', 'History']) await same(`organizer ${t}, ${scheme}: identical`, { who: 'admin', url: '/admin', scheme, tabName: t });
    await same(`organizer Edit game on tonight's game, ${scheme}: identical, no Court row`, { who: 'admin', url: '/admin', scheme, act: editTonight });
    await same(`organizer Add game, ${scheme}: identical, no Court row`, { who: 'admin', url: '/admin', scheme, act: addGame });
    await same(
      `organizer Settings, ${scheme}: identical apart from the one new switch row`,
      { who: 'admin', url: '/admin', scheme, tabName: 'Settings' },
      (h) => h.replace(/<div class="set-row-wrap" data-row="gameDayCardAll">.*?<\/label><\/div>/gs, ''),
    );
  }
  await browser.close();
  console.log(`\nzip14-off: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
