/* Zip 37: both switches OFF must be exactly today's site. This runs today's main (a git worktree, path in MAIN_DIR) and this branch side by
 * side on two copies of the same fake world, with the two new rows OFF and every other row as on live. Then it compares:
 *  - the player Home as three fake players (HTML and picture, light and dark, 390 and 320; the tip card never exists with the row off);
 *  - the player answers (/api/group) and the organizer dashboard byte for byte;
 *  - organizer Home (the picture, light and dark, 390).
 *
 *   MAIN_DIR=/path/to/main-worktree node e2e/zip37-off.cjs
 *
 * Not part of npm run test:e2e (it needs the second checkout, with its own node_modules made of hard links, not a symlink).
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
const SEED_ISO = '2026-11-12T23:00:00.000Z'; // Thu Nov 12, 6:00 PM Eastern
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
  db.prepare("DELETE FROM task_log WHERE task IN ('home_screen_tip_on', 'game_day_text_on')").run(); // the new rows OFF; every other row as seeded (as on live)
  db.close();
  const server = spawn('npx', ['vite', '--port', String(port), '--strictPort'], {
    cwd: dir,
    env: { ...process.env, DEV_DB: dbFile, SETUP_TOKEN: 'zip37-off-setup-token-0123456789', DEV_CLOCK: '1', PREVIEW_CALM: 'on' },
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
  return { BASE };
}

async function main() {
  mkdirSync(path.join(ROOT, '.data'), { recursive: true });
  const seedFile = path.join(ROOT, '.data', 'zip37-off-seed.sqlite');
  rmSync(seedFile, { force: true });
  const seeded = spawnSync('npx', ['vite-node', 'scripts/load-small-local.ts', '--', seedFile, SEED_ISO], { cwd: ROOT, encoding: 'utf8' });
  if (seeded.status !== 0) throw new Error(`could not build the fake world: ${seeded.stderr || seeded.stdout}`);
  const sides = { main: await site(MAIN, 5661, path.join(ROOT, '.data', 'zip37-off-main.sqlite'), seedFile), branch: await site(ROOT, 5662, path.join(ROOT, '.data', 'zip37-off-branch.sqlite'), seedFile) };
  const browser = await chromium.launch();
  const got = { main: {}, branch: {} };
  const blank = (t) => t.replace(/localhost:566\d/g, 'localhost:<port>').replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<id>').replace(/"(now|at|[a-zA-Z]*At)":"[^"]*"/g, '"$1":"<t>"').replace(/https:\/\/maps\.apple\.com\/\?daddr=[^"'\s]*/g, 'MAPS').replace(/ m-enter/g, '').replace(/ data-sw-main=""/g, '').replace(/ data-sw=""/g, '');
  const shiftClock = (ctx) =>
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
  for (const [name, s] of Object.entries(sides)) {
    // The player answers, byte for byte, for three players.
    const list = (await (await fetch(s.BASE + '/api/group', { headers: { Origin: s.BASE } })).json()).players;
    for (const who of ['Parker', 'Vic', 'Sage']) {
      const p = list.find((x) => x.name === who);
      const me = await fetch(s.BASE + '/api/me', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: s.BASE }, body: JSON.stringify({ playerId: p.id }) });
      const cookie = me.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
      got[name][`answer-${who}`] = blank(await (await fetch(s.BASE + '/api/group', { headers: { Cookie: cookie, Origin: s.BASE } })).text());
    }
    for (const scheme of ['light', 'dark'])
      for (const width of [390, 320]) {
        for (const who of ['Parker', 'Vic']) {
          const ctx = await browser.newContext({ viewport: { width, height: 760 }, isMobile: true, hasTouch: true, colorScheme: scheme, userAgent: UA, reducedMotion: 'reduce' });
          await shiftClock(ctx);
          const page = await ctx.newPage();
          // A phone far past its second visit: with the row off nothing may show.
          await page.addInitScript(() => localStorage.setItem('pb_hs_first', '1'));
          await page.goto(`${s.BASE}/?as=${who}`);
          await page.locator('.schedule').first().waitFor({ timeout: 25000 });
          await page.reload();
          await page.locator('.schedule').first().waitFor({ timeout: 25000 });
          await page.waitForTimeout(2500);
          const key = `home-${who}-${scheme}-${width}`;
          got[name][key + '-pixels'] = crypto.createHash('sha1').update(await page.screenshot()).digest('hex');
          got[name][key + '-html'] = blank(await page.evaluate(() => document.querySelector('main').outerHTML.replace(/ id="[^"]*"/g, '').replace(/aria-labelledby="[^"]*"/g, '')));
          await ctx.close();
        }
      }
    for (const scheme of ['light', 'dark']) {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 760 }, isMobile: true, hasTouch: true, colorScheme: scheme, userAgent: UA, reducedMotion: 'reduce' });
      await shiftClock(ctx);
      assert((await ctx.request.post(s.BASE + '/api/admin/login', { data: { pin: PIN }, headers: { Origin: s.BASE } })).ok(), 'login');
      const page = await ctx.newPage();
      await page.goto(s.BASE + '/admin');
      await page.locator('article[data-r2-card]').first().waitFor();
      await page.waitForTimeout(700);
      got[name][`dashboard-${scheme}`] = blank(await (await ctx.request.get(s.BASE + '/api/admin/dashboard')).text());
      got[name][`admin-home-${scheme}`] = crypto.createHash('sha1').update(await page.screenshot()).digest('hex');
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
      throw new Error(`differs at ${i}: main «${a.slice(Math.max(0, i - 60), i + 120)}» branch «${b.slice(Math.max(0, i - 60), i + 120)}»`);
    });
  }
  await check('no tip card on the branch with the row off', async () => {
    assert(!Object.entries(got.branch).some(([k, v]) => k.endsWith('-html') && v.includes('data-hs-tip')), 'a card was drawn');
  });
  await browser.close();
  console.log(`\nzip37-off: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
main().catch((err) => {
  console.error(err);
  process.exit(1);
});
