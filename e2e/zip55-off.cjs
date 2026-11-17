/* Zip 55 "Tournaments": with the switch OFF the site must be exactly today's site (main). This runs today's main (a git worktree, path in
 * MAIN_DIR) and this branch side by side on two copies of the same fake world (built by this branch's seed, the Zip 51 calm profile, then the
 * Tournaments row and every tournament row taken out; the migration's three empty tables stay, as they will be on live), and compares:
 *  - the player answers (/api/group) and their "did anything change?" stamps (/api/group/version) for four players, byte for byte;
 *  - the player Home (HTML and picture, light and dark, 390 and 320) for three players;
 *  - the organizer dashboard, History and View as extras, byte for byte; organizer Home (picture, light and dark, 390);
 *  - Settings (HTML): the same except the one new Feature switches row "Tournaments" (how it gets turned on), which is cut out first.
 * Then, on the branch only: a tournament that exists with the switch off changes nothing a player gets.
 *
 *   MAIN_DIR=/path/to/main-worktree node e2e/zip55-off.cjs
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
const SEED_ISO = '2026-11-16T01:00:00.000Z'; // Sun Nov 15, 8:00 PM Eastern
// The clock stays at the seed moment: a later clock makes each server's upkeep add next weeks' games with fresh random ids, so the change
// fingerprint (a hash of those ids) would differ between two servers whatever the code (Zip 42's off check does the same).
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

/**
 * The seed, warmed once by one server at the comparison moment (its first answers add the regular games the calm profile took out, with new random
 * ids), so the two copies hold the same games and neither server makes its own: then the change fingerprint (a hash of those ids) is comparable.
 */
async function warm(seedFile) {
  const port = 5680;
  const server = spawn('npx', ['vite', '--port', String(port), '--strictPort'], {
    cwd: ROOT,
    env: { ...process.env, DEV_DB: seedFile, SETUP_TOKEN: 'zip55-off-setup-token-0123456789', DEV_CLOCK: '1', PREVIEW_CALM: 'on' },
    stdio: 'ignore',
    detached: true,
  });
  const BASE = `http://localhost:${port}`;
  for (let i = 0; i < 90; i++) {
    if (await fetch(`${BASE}/api/status`).then((r) => r.ok, () => false)) break;
    await sleep(500);
  }
  await fetch(`${BASE}/__dev/clock`, { method: 'POST', body: JSON.stringify({ atMs: NOW_MS }) });
  await fetch(`${BASE}/api/group`, { headers: { Origin: BASE } });
  const login = await fetch(`${BASE}/api/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: BASE }, body: JSON.stringify({ pin: PIN }) });
  const cookie = login.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  await fetch(`${BASE}/api/admin/dashboard`, { headers: { Cookie: cookie, Origin: BASE } });
  await fetch(`${BASE}/api/admin/logout`, { method: 'POST', headers: { Cookie: cookie, Origin: BASE } });
  try {
    process.kill(-server.pid, 'SIGTERM');
  } catch {}
  await sleep(1500);
}

async function site(dir, port, dbFile, seedFile) {
  copyFileSync(seedFile, dbFile);
  const db = new DatabaseSync(dbFile);
  // The data main would have, with the switch off: no Tournaments row, no tournament rows (the empty tables stay), no History line about one.
  db.prepare("DELETE FROM task_log WHERE task = 'tournaments_on'").run();
  db.prepare('DELETE FROM tournaments').run();
  db.prepare("DELETE FROM admin_audit_log WHERE action LIKE 'tournament%'").run();
  db.close();
  const server = spawn('npx', ['vite', '--port', String(port), '--strictPort'], {
    cwd: dir,
    env: { ...process.env, DEV_DB: dbFile, SETUP_TOKEN: 'zip55-off-setup-token-0123456789', DEV_CLOCK: '1', PREVIEW_CALM: 'on', PB_PREVIEW_BUILD: '' },
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
  const seedFile = path.join(ROOT, '.data', 'zip55-off-seed.sqlite');
  rmSync(seedFile, { force: true });
  const seeded = spawnSync('npx', ['vite-node', 'scripts/load-small-local.ts', '--', seedFile, SEED_ISO, '--calm', '--zip51'], { cwd: ROOT, encoding: 'utf8' });
  if (seeded.status !== 0) throw new Error(`could not build the fake world: ${seeded.stderr || seeded.stdout}`);
  await warm(seedFile);
  const sides = { main: await site(MAIN, 5681, path.join(ROOT, '.data', 'zip55-off-main.sqlite'), seedFile), branch: await site(ROOT, 5682, path.join(ROOT, '.data', 'zip55-off-branch.sqlite'), seedFile) };
  const browser = await chromium.launch();
  const got = { main: {}, branch: {} };
  const blank = (t) =>
    String(t)
      .replace(/localhost:568\d/g, 'localhost:<port>')
      .replace(/localhost%3A568\d/g, 'localhost%3A<port>')
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<id>')
      .replace(/"(now|at|[a-zA-Z]*At)":"[^"]*"/g, '"$1":"<t>"')
      .replace(/https:\/\/maps\.apple\.com\/\?daddr=[^"'\s]*/g, 'MAPS')
      .replace(/ m-enter/g, '')
      .replace(/ data-sw-main=""/g, '')
      .replace(/ data-sw=""/g, '')
      // A game's status swap animation mark: on whichever side happened to draw a refresh mid-animation (timing, not code).
      .replace(/ data-sw-status=""/g, '');
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
    // Pin the clock again so both sides are read in the same 10-minute stamp bucket.
    await fetch(s.BASE + '/__dev/clock', { method: 'POST', body: JSON.stringify({ atMs: NOW_MS }) });
    const list = (await (await fetch(s.BASE + '/api/group', { headers: { Origin: s.BASE } })).json()).players;
    for (const who of ['Parker', 'Vic', 'Alex', 'Christopher Vanderberg']) {
      const p = list.find((x) => x.name === who);
      const me = await fetch(s.BASE + '/api/me', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: s.BASE }, body: JSON.stringify({ playerId: p.id }) });
      const cookie = me.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
      got[name][`answer-${who}`] = blank(await (await fetch(s.BASE + '/api/group', { headers: { Cookie: cookie, Origin: s.BASE } })).text());
      got[name][`stamp-${who}`] = await (await fetch(s.BASE + '/api/group/version', { headers: { Cookie: cookie, Origin: s.BASE } })).text();
    }
    for (const scheme of ['light', 'dark'])
      for (const width of [390, 320])
        for (const who of ['Parker', 'Vic', 'Alex']) {
          const ctx = await browser.newContext({ viewport: { width, height: 760 }, isMobile: true, hasTouch: true, colorScheme: scheme, userAgent: UA, reducedMotion: 'reduce' });
          await shiftClock(ctx);
          const page = await ctx.newPage();
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
    for (const scheme of ['light', 'dark']) {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 760 }, isMobile: true, hasTouch: true, colorScheme: scheme, userAgent: UA, reducedMotion: 'reduce' });
      await shiftClock(ctx);
      assert((await ctx.request.post(s.BASE + '/api/admin/login', { data: { pin: PIN }, headers: { Origin: s.BASE } })).ok(), 'login');
      const page = await ctx.newPage();
      await page.goto(s.BASE + '/admin');
      await page.locator('.tabbar').waitFor();
      await page.waitForTimeout(1500);
      got[name][`dashboard-${scheme}`] = blank(await (await ctx.request.get(s.BASE + '/api/admin/dashboard')).text());
      got[name][`activity-${scheme}`] = blank(await (await ctx.request.get(s.BASE + '/api/admin/activity')).text());
      got[name][`demo-extras-${scheme}`] = blank(await (await ctx.request.get(s.BASE + '/api/admin/demo-extras')).text()).replace(/"at":"[^"]*"/g, '"at":"<t>"');
      got[name][`admin-home-${scheme}`] = crypto.createHash('sha1').update(await page.screenshot()).digest('hex');
      got[name][`admin-home-${scheme}-html`] = blank(await page.evaluate(() => document.querySelector('main').outerHTML.replace(/ id="[^"]*"/g, '').replace(/aria-labelledby="[^"]*"/g, '')));
      // Settings: every section open; the one new Feature switches row ("Tournaments") is cut out before comparing.
      await page.locator('.tabbar button', { hasText: 'Settings' }).click();
      await page.waitForTimeout(500);
      await page.evaluate(() => document.querySelectorAll('details.set-sect').forEach((d) => (d.open = true)));
      await page.waitForTimeout(400);
      got[name][`settings-${scheme}-html`] = blank(
        await page.evaluate(() => {
          const main = document.querySelector('main').cloneNode(true);
          main.querySelectorAll('[data-row="tournamentsAll"]').forEach((r) => r.remove());
          return main.outerHTML.replace(/ id="[^"]*"/g, '').replace(/aria-labelledby="[^"]*"/g, '').replace(/ for="[^"]*"/g, '');
        }),
      );
      if (name === 'branch') got.branchSettingsRow = await page.locator('[data-row="tournamentsAll"]').count();
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
  await check('the branch has the new Feature switches row "Tournaments" (the one intended difference, off)', async () => {
    assert(got.branchSettingsRow === 1, `rows: ${got.branchSettingsRow}`);
  });
  await check('no tournament words or flags anywhere on the branch with the switch off', async () => {
    const bad = Object.entries(got.branch).filter(([k, v]) => typeof v === 'string' && !k.startsWith('settings-') && /tournament|Tournament|data-tc|tm-/.test(v));
    assert(bad.length === 0, `tournament pieces: ${bad.map(([k]) => k)}`);
  });
  // A tournament that exists while the switch is OFF (Everyone, even): still nothing to a player, and the organizer's answers are main's.
  await check('switch off with a tournament in the database (Everyone): a player answer and the dashboard stay main\'s', async () => {
    const db = new DatabaseSync(path.join(ROOT, '.data', 'zip55-off-branch.sqlite'));
    const g = db.prepare('SELECT id FROM groups').get();
    db.prepare(
      "INSERT INTO tournaments (id, group_id, name, size, courts, minutes, start_minutes, ticket_cents, champion_credit_cents, offered_dates, status, visibility, created_at, updated_at) VALUES ('t-off', ?, 'Hidden Cup', 8, 2, 120, 1170, 1600, 1400, '[\"2026-12-03\"]', 'signup', 'all', '2026-11-17T15:00:00.000Z', '2026-11-17T15:00:00.000Z')",
    ).run(g.id);
    db.close();
    const s = sides.branch;
    await fetch(s.BASE + '/__dev/clock', { method: 'POST', body: JSON.stringify({ atMs: NOW_MS }) });
    const list = (await (await fetch(s.BASE + '/api/group', { headers: { Origin: s.BASE } })).json()).players;
    const p = list.find((x) => x.name === 'Parker');
    const me = await fetch(s.BASE + '/api/me', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: s.BASE }, body: JSON.stringify({ playerId: p.id }) });
    const cookie = me.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
    const text = await (await fetch(s.BASE + '/api/group', { headers: { Cookie: cookie, Origin: s.BASE } })).text();
    assert(!text.includes('Hidden Cup') && !text.includes('tournament'), 'a player got it');
    assert(blank(text) === got.main['answer-Parker'], 'the answer is not main\'s');
  });
  await browser.close();
  console.log(`\nzip55-off: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
main().catch((err) => {
  console.error(err);
  process.exit(1);
});
