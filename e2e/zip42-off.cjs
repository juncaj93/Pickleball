/* Zip 42 "Guest spot": with the switch OFF (and no guest anywhere) the site must be exactly today's site. This runs today's main (a git
 * worktree, path in MAIN_DIR) and this branch side by side on two copies of the same fake world (built by this branch, then every guest and the
 * Guest spot row taken out, so the data is what main would have; the migration's four empty columns stay, as they will be on live), and compares:
 *  - the player Home as Rowan (the host in the seed), Parker and Vic (HTML and picture, light and dark, 390 and 320);
 *  - the player answers (/api/group) and the organizer dashboard byte for byte;
 *  - organizer Home (the picture, light and dark, 390) and the Players sheet of the game Rowan is in (HTML and picture).
 *
 *   MAIN_DIR=/path/to/main-worktree node e2e/zip42-off.cjs
 *
 * Not part of npm run test:e2e (it needs the second checkout, with its own node_modules made of hard links, not a symlink).
 * Nothing here touches Cloudflare or the live site.
 */
const { spawn, spawnSync } = require('node:child_process');
const { readFileSync, writeFileSync, mkdirSync, rmSync, copyFileSync } = require('node:fs');
const { DatabaseSync } = require('node:sqlite');
const crypto = require('node:crypto');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const MAIN = process.env.MAIN_DIR;
if (!MAIN) throw new Error('set MAIN_DIR to a checkout of main');
const SEED_ISO = '2026-11-12T23:00:00.000Z'; // Thu Nov 12, 6:00 PM Eastern (the fake world is built as of this moment)
const SCENARIO = 'off';
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

async function site(dir, port, dbFile, seedFile, isBranch) {
  copyFileSync(seedFile, dbFile);
  const db = new DatabaseSync(dbFile);
  // The Guest spot row OFF, no guest anywhere, and no History line about one: the data main would have.
  db.prepare("DELETE FROM task_log WHERE task = 'guest_spot_on'").run();
  db.prepare('UPDATE session_players SET guest_name = NULL, guest_status = NULL, guest_seq = NULL, guest_at = NULL').run();
  db.prepare("DELETE FROM admin_audit_log WHERE action IN ('guest_added', 'guest_removed', 'guest_moved_in', 'guest_spot_on', 'guest_spot_off')").run();
  db.close();
  const server = spawn('npx', ['vite', '--port', String(port), '--strictPort'], {
    cwd: dir,
    env: { ...process.env, DEV_DB: dbFile, SETUP_TOKEN: 'zip42-off-setup-token-0123456789', DEV_CLOCK: '1', PREVIEW_CALM: 'on' },
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
  const seedFile = path.join(ROOT, '.data', 'zip42-off-seed.sqlite');
  rmSync(seedFile, { force: true });
  const seeded = spawnSync('npx', ['vite-node', 'scripts/load-small-local.ts', '--', seedFile, SEED_ISO], { cwd: ROOT, encoding: 'utf8' });
  if (seeded.status !== 0) throw new Error(`could not build the fake world: ${seeded.stderr || seeded.stdout}`);
  const sides = { main: await site(MAIN, 5671, path.join(ROOT, '.data', 'zip42-off-main.sqlite'), seedFile, false), branch: await site(ROOT, 5672, path.join(ROOT, '.data', 'zip42-off-branch.sqlite'), seedFile, true) };
  const browser = await chromium.launch();
  const got = { main: {}, branch: {} };
  // (off-inside: a clock jumped to Dec 5 makes each server's upkeep add next weeks' games with fresh random ids, so the change fingerprint, which hashes those ids, differs between two servers whatever the code: it is blanked there. Off and row-on-out compare it byte for byte.)
  const rowNote = (t) => t;
  const blank = (t) => rowNote(t).replace(/localhost:567\d/g, 'localhost:<port>').replace(/localhost%3A567\d/g, 'localhost%3A<port>').replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<id>').replace(/"(now|at|[a-zA-Z]*At)":"[^"]*"/g, '"$1":"<t>"').replace(/https:\/\/maps\.apple\.com\/\?daddr=[^"'\s]*/g, 'MAPS').replace(/ m-enter/g, '').replace(/ data-sw-main=""/g, '').replace(/ data-sw=""/g, '');
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
    // The fake clock keeps running after it is set: pin it again so both sides are read at the same moment (a 10 minute fingerprint bucket must not tick over between them).
    await fetch(s.BASE + '/__dev/clock', { method: 'POST', body: JSON.stringify({ atMs: NOW_MS }) });
    // The player answers, byte for byte, for three players.
    const list = (await (await fetch(s.BASE + '/api/group', { headers: { Origin: s.BASE } })).json()).players;
    for (const who of ['Rowan', 'Parker', 'Vic']) {
      const p = list.find((x) => x.name === who);
      const me = await fetch(s.BASE + '/api/me', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: s.BASE }, body: JSON.stringify({ playerId: p.id }) });
      const cookie = me.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
      got[name][`answer-${who}`] = blank(await (await fetch(s.BASE + '/api/group', { headers: { Cookie: cookie, Origin: s.BASE } })).text());
    }
    for (const scheme of ['light', 'dark'])
      for (const width of [390, 320]) {
        for (const who of ['Rowan', 'Parker', 'Vic']) {
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
      // The Players sheet of the first open game card (the same game on both sides; no guest anywhere), and its first row's menu.
      {
        const cell = page.locator('article[data-r2-card] [data-paid-cell]').first();
        await cell.scrollIntoViewIfNeeded();
        await cell.click();
        await page.locator('dialog.sheet[open]').waitFor();
        await page.waitForTimeout(700);
        got[name][`players-sheet-${scheme}-html`] = blank(await page.locator('dialog.sheet[open]').first().evaluate((d) => d.outerHTML.replace(/ id="[^"]*"/g, '').replace(/aria-labelledby="[^"]*"/g, '')));
        got[name][`players-sheet-${scheme}-pixels`] = crypto.createHash('sha1').update(await page.screenshot()).digest('hex');
        const dots = page.locator('dialog.sheet[open] .ps-dots').first();
        if (await dots.count()) {
          await dots.click();
          await page.waitForTimeout(300);
          got[name][`players-menu-${scheme}-html`] = blank(await page.locator('dialog.sheet[open] .ps-pop').first().evaluate((d) => d.outerHTML));
        }
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
      throw new Error(`differs at ${i}: main «${a.slice(Math.max(0, i - 60), i + 120)}» branch «${b.slice(Math.max(0, i - 60), i + 120)}»`);
    });
  }
  await check('no guest words, buttons or flags anywhere on the branch with the switch off', async () => {
    const bad = Object.entries(got.branch).filter(([k, v]) => typeof v === 'string' && /Remove guest|Add a guest|\(guest\)|guestSpot|data-remove-guest|data-ps-guest/.test(v));
    assert(bad.length === 0, `guest pieces: ${bad.map(([k]) => k)}`);
  });
  await browser.close();
  console.log(`\nzip42-off: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
main().catch((err) => {
  console.error(err);
  process.exit(1);
});
