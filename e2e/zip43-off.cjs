/* Zip 43: the Venue charge alert OFF must be exactly today's site. This runs today's main (a git worktree, path in MAIN_DIR) and this branch side by
 * side on two copies of the same fake world (the calm preview profile), the branch with its switch row OFF (the way it ships), two ways (SCENARIO):
 *   plain        the clock at Sat Nov 14, 11:00 AM Eastern;
 *   charge-day   the clock at Mon Nov 30, 9:00 AM Eastern (the court charge day), the switch still OFF: no card may appear.
 * Then it compares, light and dark at 390 px:
 *  - the organizer dashboard answer and the player answers, byte for byte;
 *  - organizer Home (the page's HTML and the picture);
 *  - Settings > Money opened (the page's HTML and the picture): no day rows.
 *
 *   MAIN_DIR=/path/to/main-worktree SCENARIO=plain|charge-day node e2e/zip43-off.cjs
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
const SEED_ISO = '2026-11-14T16:00:00.000Z';
const SCENARIO = process.env.SCENARIO || 'plain';
const NOW_MS = SCENARIO === 'charge-day' ? Date.parse('2026-11-30T14:00:00.000Z') : Date.parse(SEED_ISO);
const PIN = /PIN `(\d{6})`/.exec(readFileSync(path.join(ROOT, 'docs/PREVIEW_FAKE_DB.md'), 'utf8'))[1];
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const PORT_A = Number(process.env.E2E_PORT) || 5671;
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
  db.prepare("DELETE FROM task_log WHERE task = 'venue_alert_on'").run(); // the new row OFF (it ships OFF); every other row as seeded
  db.close();
  const server = spawn('npx', ['vite', '--port', String(port), '--strictPort'], {
    cwd: dir,
    env: { ...process.env, DEV_DB: dbFile, SETUP_TOKEN: 'zip43-off-setup-token-0123456789', DEV_CLOCK: '1', PREVIEW_CALM: 'on' },
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
  const seedFile = path.join(ROOT, '.data', `zip43-off-seed-${SCENARIO}.sqlite`);
  rmSync(seedFile, { force: true });
  const seeded = spawnSync('npx', ['vite-node', 'scripts/load-small-local.ts', '--', seedFile, SEED_ISO, '--calm'], { cwd: ROOT, encoding: 'utf8' });
  if (seeded.status !== 0) throw new Error(`could not build the fake world: ${seeded.stderr || seeded.stdout}`);
  const sides = { main: await site(MAIN, PORT_A, path.join(ROOT, '.data', `zip43-off-main-${SCENARIO}.sqlite`), seedFile), branch: await site(process.env.BRANCH_DIR || ROOT, PORT_A + 2, path.join(ROOT, '.data', `zip43-off-branch-${SCENARIO}.sqlite`), seedFile) };
  const browser = await chromium.launch();
  const got = { main: {}, branch: {} };
  const blank = (t) =>
    t
      .replace(/localhost:\d{4}/g, 'localhost:<port>')
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<id>')
      .replace(/"(now|at|[a-zA-Z]*At)":"[^"]*"/g, '"$1":"<t>"')
      // The change fingerprint ("version") is different on every server start, whatever the code (main against main differs too): blanked.
      .replace(/"version":"[^"]*"/g, '"version":"<v>"')
      .replace(/https:\/\/maps\.apple\.com\/\?daddr=[^"'\s]*/g, 'MAPS');
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
    await fetch(s.BASE + '/__dev/clock', { method: 'POST', body: JSON.stringify({ atMs: NOW_MS }) });
    const list = (await (await fetch(s.BASE + '/api/group', { headers: { Origin: s.BASE } })).json()).players;
    for (const who of ['Parker', 'Vic', 'Sage']) {
      const p = list.find((x) => x.name === who);
      const me = await fetch(s.BASE + '/api/me', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: s.BASE }, body: JSON.stringify({ playerId: p.id }) });
      const cookie = me.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
      got[name][`answer-${who}`] = blank(await (await fetch(s.BASE + '/api/group', { headers: { Cookie: cookie, Origin: s.BASE } })).text());
    }
    for (const scheme of ['light', 'dark']) {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 760 }, isMobile: true, hasTouch: true, colorScheme: scheme, userAgent: UA, reducedMotion: 'reduce' });
      await shiftClock(ctx);
      assert((await ctx.request.post(s.BASE + '/api/admin/login', { data: { pin: PIN }, headers: { Origin: s.BASE } })).ok(), 'login');
      const page = await ctx.newPage();
      await page.goto(s.BASE + '/admin');
      await page.locator('.tabbar').waitFor({ timeout: 25000 });
      await page.waitForTimeout(1500);
      got[name][`dashboard-${scheme}`] = blank(await (await ctx.request.get(s.BASE + '/api/admin/dashboard')).text());
      got[name][`admin-home-${scheme}-html`] = blank(await page.evaluate(() => document.querySelector('main').outerHTML.replace(/ id="[^"]*"/g, '').replace(/aria-labelledby="[^"]*"/g, '')));
      got[name][`admin-home-${scheme}-pixels`] = crypto.createHash('sha1').update(await page.screenshot()).digest('hex');
      await page.locator('.tabbar >> text=Settings').click();
      await page.locator('[data-section="money"] summary').waitFor();
      if (!(await page.locator('[data-section="money"]').evaluate((d) => d.open))) await page.locator('[data-section="money"] summary').click();
      await page.waitForTimeout(700);
      got[name][`settings-money-${scheme}-html`] = blank(await page.locator('[data-section="money"]').evaluate((d) => d.outerHTML.replace(/ id="[^"]*"/g, '').replace(/for="[^"]*"/g, '')));
      got[name][`settings-money-${scheme}-pixels`] = crypto.createHash('sha1').update(await page.locator('[data-section="money"]').screenshot()).digest('hex');
      await ctx.close();
    }
  }
  for (const key of Object.keys(got.main)) {
    await check(`OFF = main (${SCENARIO}): ${key}`, async () => {
      const a = got.main[key];
      const b = got.branch[key];
      if (a === b) return;
      let i = 0;
      while (i < a.length && a[i] === b[i]) i++;
      throw new Error(`differs at ${i}: main «${a.slice(Math.max(0, i - 60), i + 120)}» branch «${b.slice(Math.max(0, i - 60), i + 120)}»`);
    });
  }
  await check('no Venue card or day row on the branch', async () => {
    const bad = Object.entries(got.branch).filter(([k, v]) => k.endsWith('-html') && /data-venue|venue-day|Membership charged on|should have charged/.test(v));
    assert(bad.length === 0, `venue pieces drawn: ${bad.map(([k]) => k)}`);
    assert(!Object.entries(got.branch).some(([k, v]) => (k.startsWith('answer-') || k.startsWith('dashboard-')) && /venueAlert|venueDays/.test(v)), 'an answer carries the feature');
  });
  await browser.close();
  console.log(`\nzip43-off (${SCENARIO}): ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
main().catch((err) => {
  console.error(err);
  process.exit(1);
});
