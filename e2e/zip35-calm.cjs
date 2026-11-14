/* Zip 35: the PREVIEW CALM RULE (docs/SITE_RULES.md). The default preview profile (`npm run db:seed:preview`, built here with --calm) opens calm.
 *
 *   node e2e/zip35-calm.cjs      (also run by npm run test:e2e)
 *
 * The CALM small world on its own dev server (PREVIEW_CALM and SECOND_CHANCE_TEST on, as on a preview), at 390 px wide, light and dark:
 *   (Zip 42: the calm profile now holds the Guest spot games; the Second Chance and "Test game" checks this file had moved to the full world.)
 *   C1  admin Home: the "Guest test" card is on the first screen, Home fits two screens at most, no unrelated money rows (Remind, Finalize, haven't paid);
 *   C2  the money cell opens the Players sheet with Rowan, his guest Sam, Parker, his guest Billy and Christopher (two taps from the preview link);
 *   C4  player Home (Rowan): no alert cards, no money, at most three plain games and "More sessions".
 */
const { spawn, spawnSync } = require('node:child_process');
const { readFileSync, mkdirSync, rmSync } = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.E2E_PORT) || 5436;
const BASE = `http://localhost:${PORT}`;
const NOW_ISO = '2026-11-12T23:00:00.000Z'; // Thu Nov 12, 6:00 PM Eastern
const NOW_MS = Date.parse(NOW_ISO);
const PIN = /PIN `(\d{6})`/.exec(readFileSync(path.join(ROOT, 'docs/PREVIEW_FAKE_DB.md'), 'utf8'))[1];
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

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
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const dbFile = path.join(ROOT, '.data', 'zip35-calm.sqlite');
  mkdirSync(path.join(ROOT, '.data'), { recursive: true });
  rmSync(dbFile, { force: true });
  const seeded = spawnSync('npx', ['vite-node', 'scripts/load-small-local.ts', '--', dbFile, NOW_ISO, '--calm'], { cwd: ROOT, encoding: 'utf8' });
  if (seeded.status !== 0) throw new Error(`could not build the calm world: ${seeded.stderr || seeded.stdout}`);
  if (await fetch(`${BASE}/api/status`).then((r) => r.ok, () => false)) throw new Error(`port ${PORT} is already in use`);
  const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
    cwd: ROOT,
    env: { ...process.env, DEV_DB: dbFile, SETUP_TOKEN: 'zip35c-setup-token-0123456789', DEV_CLOCK: '1', PREVIEW_CALM: 'on', SECOND_CHANCE_TEST: 'on' },
    stdio: 'ignore',
    detached: true,
  });
  process.on('exit', () => {
    try {
      process.kill(-server.pid, 'SIGTERM');
    } catch {}
  });
  for (let i = 0; i < 80; i++) {
    try {
      if ((await fetch(`${BASE}/api/status`)).ok) break;
    } catch {}
    await sleep(500);
  }
  await fetch(`${BASE}/__dev/clock`, { method: 'POST', body: JSON.stringify({ atMs: NOW_MS }) });
  const browser = await chromium.launch();
  const org = (await browser.newContext()).request;
  await org.post(BASE + '/api/admin/login', { data: { pin: PIN }, headers: { Origin: BASE } });
  const dash = async () => (await org.get(BASE + '/api/admin/dashboard', { headers: { Origin: BASE } })).json();
  const d0 = await dash();
  const eastern = (iso) => new Date(iso).toLocaleString('en-US', { timeZone: 'America/Detroit', hour: 'numeric', minute: '2-digit' });
  // Zip 42: the calm profile now keeps the two Guest spot games (the Zip 35 Second Chance scene lives in the full world, e2e/zip35.cjs).
  const guestTest = d0.sessions.find((s) => s.note === 'Guest test');
  const guestPaid = d0.sessions.find((s) => s.note === 'Guest paid');
  assert(guestTest && guestPaid, 'the two Guest spot games are missing from the calm world');
  const lateScenes = ['Late: 4 seats', 'Late: host 4th', 'Late: host 5th'].map((note) => d0.sessions.find((s) => s.note === note));
  assert(lateScenes.every(Boolean), 'the three round 3 late scenes are missing from the calm world');

  const shift = (ctx) =>
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
  const phone = (scheme) => browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, colorScheme: scheme, isMobile: true, hasTouch: true, userAgent: UA, reducedMotion: 'reduce' });
  async function openAdmin(scheme, url = '/admin?noontest=on') {
    const ctx = await phone(scheme);
    await shift(ctx);
    await ctx.request.post(BASE + '/api/admin/login', { data: { pin: PIN }, headers: { Origin: BASE } });
    const page = await ctx.newPage();
    await page.goto(BASE + url);
    await page.locator('.tabbar').waitFor({ timeout: 20000 });
    await page.waitForTimeout(1200);
    return { ctx, page };
  }

  for (const scheme of ['light', 'dark']) {
    await check(`C1 (${scheme}): admin Home at 390 px: the five Guest spot games come first, Home fits two screens at most, no unrelated money rows`, async () => {
      const { ctx, page } = await openAdmin(scheme, '/admin');
      const ids = await page.locator('article[data-r2-card]').evaluateAll((els) => els.map((e) => e.id));
      if (process.env.CALM_SHOT) await page.screenshot({ path: process.env.CALM_SHOT, fullPage: true });
      // Round 3: the three late scenes (next day 5:30 to 6:30 PM) come right before "Guest test" (7:30 PM): all five Guest spot games come first.
      const want = [...lateScenes, guestTest, guestPaid].map((g) => `session-${g.id}`);
      assert(ids.slice(0, 5).join('|') === want.join('|'), `first cards: ${ids.slice(0, 6)}`);
      await page.evaluate(() => window.scrollTo(0, 0));
      const box = await page.locator(`article[id="${want[0]}"]`).boundingBox();
      assert(box && box.y + 120 < 844, `the first Guest spot card is not on the first screen: ${JSON.stringify(box)}`);
      const fit = await page.evaluate(() => ({ h: document.documentElement.scrollHeight, w: window.innerHeight }));
      assert(fit.h <= fit.w * 2 + 2, `Home needs more than two screens: page ${fit.h}px, screen ${fit.w}px`);
      const text = await page.locator('body').innerText();
      for (const bad of ['Remind', 'Finalize', "haven't paid", 'Who owes']) assert(!text.includes(bad), `unrelated money text on Home: "${bad}"`);
      assert((await page.locator('article').count()) <= 7, `${await page.locator('article').count()} games on Home`);
      await ctx.close();
    });
  }

  await check('C2: two taps from the preview link: the money cell opens the Players sheet with Rowan, his guest Sam, Parker, his guest Billy and Christopher', async () => {
    const { ctx, page } = await openAdmin('light', '/admin');
    const cell = page.locator(`article[id="session-${guestTest.id}"] [data-paid-cell]`);
    await cell.scrollIntoViewIfNeeded();
    await cell.click();
    const dlg = page.locator('dialog.sheet[open]').first();
    await dlg.waitFor({ timeout: 10000 });
    await page.waitForTimeout(400);
    const names = (await dlg.locator('.ps-row .ps-name').allInnerTexts()).map((t) => t.trim());
    assert(names.join('|') === 'Rowan|Sam|Parker|Billy|Christopher Vanderberg', `rows: ${names.join(', ')}`);
    await ctx.close();
  });

  for (const scheme of ['light', 'dark']) {
    await check(`C4 (${scheme}): player Home (Reese) at 390 px: plain games only, no alert cards, no money`, async () => {
      // Zip 38: the kept tonight games have Rowan in (and owing, which is a real pay card), so the calm check looks at Reese, who is in none of them.
      const rowan = d0.players.find((p) => p.name === 'Reese');
      const ctx = await phone(scheme);
      await shift(ctx);
      await ctx.request.post(BASE + '/api/me', { data: { playerId: rowan.id }, headers: { Origin: BASE } });
      const page = await ctx.newPage();
      await page.goto(BASE + '/');
      await page.waitForTimeout(2500);
      // Zip 38: the calm profile also keeps tonight's and tomorrow's games for the player screens (the Christmas skin needs them), so the player
      // Home is no longer one screen. What stays calm: no alert cards, no pay card, no credit chip, no "You owe".
      await page.locator('.schedule article.sched').first().waitFor({ timeout: 20000 });
      const text = await page.locator('body').innerText();
      for (const bad of ['CREDIT', 'Mark paid', 'Request cash out']) assert(!new RegExp(bad).test(text), `unrelated text on player Home: "${bad}"`);
      const found = await page.evaluate(() => ['.ac', '[data-pay-card]', '.credit-chip'].map((q) => `${q}=${document.querySelectorAll(q).length}`).join(' '));
      assert(/\.ac=0 \[data-pay-card\]=0 \.credit-chip=0/.test(found), `an alert card, pay card or credit chip is showing on the calm player Home: ${found}`);
      await ctx.close();
    });
  }

  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
