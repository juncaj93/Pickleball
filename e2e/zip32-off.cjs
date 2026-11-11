/* Zip 32: the "Players sheet redo" switch OFF must be exactly today's site for the screen it changes. This runs today's main (a git worktree,
 * path in MAIN_DIR) and this branch side by side on two copies of the same fake world (the small preview world, Thu Nov 12, 6 PM Eastern), with
 * the new row OFF and every other row as on live. Then it compares:
 *  - the old Players sheet, opened from the money cell AND from the gear menu's Players, light and dark, 390 and 320 wide: the page's HTML
 *    and the picture, pixel for pixel;
 *  - organizer Home (light and dark, 390): the picture;
 *  - the dashboard answer byte for byte (the new fields are left out while the row is off).
 * (The four polish fixes of this zip change the Undo toast, a played game's icon and gear, and the gear menu inside a sheet: they are live-on bug
 *  fixes, so those screens are not compared here.)
 *
 *   MAIN_DIR=/path/to/main-worktree node e2e/zip32-off.cjs
 *
 * Not part of npm run test:e2e (it needs the second checkout). The worktree needs its own node_modules (a copy or hard links, not a symlink:
 * a symlinked folder outside the checkout makes the dev server refuse the font files and the two sides then draw different fonts).
 * Nothing here touches Cloudflare or the live site.
 */
const { spawn, spawnSync } = require('node:child_process');
const { readFileSync, mkdirSync, rmSync, copyFileSync } = require('node:fs');
const { DatabaseSync } = require('node:sqlite');
const crypto = require('node:crypto');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const MAIN = process.env.MAIN_DIR;
if (!MAIN) throw new Error('set MAIN_DIR to a checkout of main');
const SEED_ISO = '2026-11-12T23:00:00.000Z'; // Thu Nov 12, 6:00 PM Eastern (the seed, and now)
const NOW_MS = Date.parse(SEED_ISO);
const PIN = /PIN `(\d{6})`/.exec(readFileSync(path.join(ROOT, 'docs/PREVIEW_FAKE_DB.md'), 'utf8'))[1];
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
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
const assert = (c, m) => {
  if (!c) throw new Error(m);
};

async function site(dir, port, dbFile, seedFile) {
  copyFileSync(seedFile, dbFile);
  const db = new DatabaseSync(dbFile);
  db.prepare("DELETE FROM task_log WHERE task = 'players_sheet_redo_on'").run(); // the new row OFF; every other row as seeded (as on live)
  db.close();
  const server = spawn('npx', ['vite', '--port', String(port), '--strictPort'], {
    cwd: dir,
    env: { ...process.env, DEV_DB: dbFile, SETUP_TOKEN: 'zip32-off-setup-token-0123456789', DEV_CLOCK: '1' },
    stdio: 'ignore',
    detached: true,
  });
  process.on('exit', () => {
    try {
      process.kill(-server.pid, 'SIGTERM');
    } catch {}
  });
  const BASE = `http://localhost:${port}`;
  for (let i = 0; i < 90; i++) {
    try {
      if ((await fetch(`${BASE}/api/status`)).ok) break;
    } catch {}
    await sleep(500);
  }
  await fetch(`${BASE}/__dev/clock`, { method: 'POST', body: JSON.stringify({ atMs: NOW_MS }) });
  return { BASE, kill: () => { try { process.kill(-server.pid, 'SIGTERM'); } catch {} } };
}

async function main() {
  mkdirSync(path.join(ROOT, '.data'), { recursive: true });
  const seedFile = path.join(ROOT, '.data', 'zip32-off-seed.sqlite');
  rmSync(seedFile, { force: true });
  const seeded = spawnSync('npx', ['vite-node', 'scripts/load-small-local.ts', '--', seedFile, SEED_ISO], { cwd: ROOT, encoding: 'utf8' });
  if (seeded.status !== 0) throw new Error(`could not build the fake world: ${seeded.stderr || seeded.stdout}`);
  const sides = { main: await site(MAIN, 5651, path.join(ROOT, '.data', 'zip32-off-main.sqlite'), seedFile), branch: await site(ROOT, 5652, path.join(ROOT, '.data', 'zip32-off-branch.sqlite'), seedFile) };
  const browser = await chromium.launch();
  const got = { main: {}, branch: {} };
  const blank = (t) => t.replace(/localhost:565\d/g, 'localhost:<port>').replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<id>').replace(/"(now|at|[a-zA-Z]*At)":"[^"]*"/g, '"$1":"<t>"');
  for (const [name, s] of Object.entries(sides)) {
    for (const scheme of ['light', 'dark'])
      for (const width of [390, 320]) {
        const ctx = await browser.newContext({ viewport: { width, height: 760 }, isMobile: true, hasTouch: true, colorScheme: scheme, userAgent: UA, reducedMotion: 'reduce' });
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
        assert((await ctx.request.post(s.BASE + '/api/admin/login', { data: { pin: PIN }, headers: { Origin: s.BASE } })).ok(), 'login');
        const page = await ctx.newPage();
        await page.goto(s.BASE + '/admin');
        await page.locator('article[data-r2-card]').first().waitFor();
        await page.waitForTimeout(700);
        const dashText = await (await ctx.request.get(s.BASE + '/api/admin/dashboard')).text();
        const dash = JSON.parse(dashText);
        got[name][`dashboard-${scheme}-${width}`] = blank(dashText);
        if (width === 390) got[name][`home-${scheme}`] = crypto.createHash('sha1').update(await page.screenshot()).digest('hex');
        const g = dash.sessions.find((x) => x.roster.some((r) => r.name === 'Reese' && r.status === 'declined'));
        for (const opener of ['cell', 'gear']) {
          if (opener === 'cell') {
            const c = page.locator(`article[id="session-${g.id}"] [data-paid-cell]`);
            await c.scrollIntoViewIfNeeded();
            await c.click();
          } else {
            await page.locator(`article[id="session-${g.id}"]`).getByRole('button', { name: /^Game menu for/ }).click();
            await page.getByRole('menuitem', { name: 'Players', exact: true }).click();
          }
          await page.locator('dialog.sheet[open]').waitFor();
          await page.waitForTimeout(500);
          const key = `sheet-${opener}-${scheme}-${width}`;
          got[name][key + '-pixels'] = crypto.createHash('sha1').update(await page.screenshot()).digest('hex');
          got[name][key + '-html'] = await page.evaluate(() => document.querySelector('dialog.sheet[open]').outerHTML.replace(/ id="[^"]*"/g, '').replace(/aria-labelledby="[^"]*"/g, ''));
          await page.evaluate(() => {
            for (const d of document.querySelectorAll('dialog[open]')) d.close();
          });
          await page.waitForTimeout(250);
        }
        await ctx.close();
      }
  }
  for (const key of Object.keys(got.main)) {
    await check(`OFF = main: ${key}`, async () => {
      const a = got.main[key];
      const b = got.branch[key];
      if (a === b) return;
      let i = 0;
      while (i < a.length && a[i] === b[i]) i++;
      throw new Error(`differs at ${i}/${a.length}: main «${a.slice(Math.max(0, i - 80), i + 120)}» branch «${b.slice(Math.max(0, i - 80), i + 120)}»`);
    });
  }
  for (const s of Object.values(sides)) s.kill();
  await browser.close();
  console.log(`\nzip32-off: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
