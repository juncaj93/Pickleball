/* Zip 35: the PREVIEW CALM RULE (docs/SITE_RULES.md). The default preview profile (`npm run db:seed:preview`, built here with --calm) opens calm.
 *
 *   node e2e/zip35-calm.cjs      (also run by npm run test:e2e)
 *
 * The CALM small world on its own dev server (PREVIEW_CALM and SECOND_CHANCE_TEST on, as on a preview), at 390 px wide, light and dark:
 *   C1  admin Home, opened at /admin?noontest=on: the first screen shows the Second Chance card "Tue 8:00 PM was 1 short" with its Book a court
 *       button, the whole Home fits in one screen without scrolling, and has no "haven't paid" rows (no Mark paid, Request, Remind, Finalize);
 *   C2  Book a court (the card's first step) leads to the time picker, which ends at 8:00 PM (Booking hours is on), then Reopen game works;
 *   C3  Money > Previous games > "Test game" is there with Hide from list (two taps from Money);
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
  const late = d0.sessions.find((s) => s.state.flags.canceled && s.confirmedCount === 3 && eastern(s.startsAt) === '8:00 PM');
  assert(late, 'the 8:00 PM Second Chance game is missing from the calm world');
  const dayKey = new Date(late.startsAt).toLocaleDateString('en-CA', { timeZone: 'America/Detroit' });

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
    await check(`C1 (${scheme}): admin Home at 390 px: the Second Chance card is the first thing, Home fits one screen, no unpaid rows`, async () => {
      const { ctx, page } = await openAdmin(scheme);
      const card = page.locator(`[data-sc-card="chance"][data-session="${late.id}"]`);
      await card.waitFor({ timeout: 15000 });
      const box = await card.boundingBox();
      assert(box && box.y < 200 && box.y + box.height < 400, `the card is not at the top: ${JSON.stringify(box)}`);
      assert(/Tue 8:00 PM was 1 short/.test(await card.innerText()), `card words: ${await card.innerText()}`);
      assert((await card.getByText('Book a court').count()) === 1, 'Book a court on the card');
      const fit = await page.evaluate(() => ({ h: document.documentElement.scrollHeight, w: window.innerHeight }));
      assert(fit.h <= fit.w + 2, `Home needs scrolling: page ${fit.h}px, screen ${fit.w}px`);
      const text = await page.locator('body').innerText();
      for (const bad of ['Mark paid', 'Request', 'Remind', 'Finalize', "haven't paid", 'Who owes', 'owes $']) assert(!text.includes(bad), `unrelated money text on Home: "${bad}"`);
      assert((await page.locator('article').count()) <= 3, `${await page.locator('article').count()} games on Home`);
      await ctx.close();
    });
  }

  await check('C2: Book a court leads to the time picker (ends 8:00 PM, hours on), and Reopen game reopens at 7:00 PM', async () => {
    const { ctx, page } = await openAdmin('light');
    // The card's first step opens CourtReserve in another tab and moves the card to step 2 at the same moment: send the same tap.
    const r = await org.post(`${BASE}/api/admin/sessions/${late.id}/second-chance`, { data: { action: 'booking' }, headers: { Origin: BASE } });
    assert(r.ok(), 'step 1 to 2');
    await page.reload();
    const sel = page.locator(`[data-sc-card="chance"][data-session="${late.id}"] select[aria-label="Start time"]`);
    await sel.waitFor({ timeout: 15000 });
    const labels = await sel.locator('option').evaluateAll((os) => os.map((o) => o.textContent.trim()));
    assert(labels.at(-1) === '8:00 PM' && !labels.includes('8:30 PM'), `picker: ${labels.join(', ')}`);
    await sel.selectOption({ label: '7:00 PM' });
    await page.locator(`[data-sc-card][data-session="${late.id}"] [data-sc-reopen]`).click();
    await page.getByText('Reopened for 7:00 PM').first().waitFor({ timeout: 10000 });
    const g = (await dash()).sessions.find((s) => s.id === late.id);
    assert(!g.state.flags.canceled && eastern(g.startsAt) === '7:00 PM', `reopened: canceled=${g.state.flags.canceled} ${eastern(g.startsAt)}`);
    await ctx.close();
    assert(dayKey.length === 10, 'day key');
  });

  for (const scheme of ['light', 'dark']) {
    await check(`C3 (${scheme}): Money > Previous games > Test game is there with Hide from list`, async () => {
      const { ctx, page } = await openAdmin(scheme, '/admin');
      await page.locator('.tabbar button', { hasText: 'Money' }).click();
      await page.waitForTimeout(600);
      await page.locator('[data-fold="previous"] .mrw-fold-head').click();
      const test = (await dash()).sessions.find((s) => s.note === 'Test game');
      assert(test, 'the Test game');
      const row = page.locator(`[data-fold="previous"] .mrw-prow[data-session="${test.id}"]`);
      await row.waitFor({ timeout: 15000 });
      await page.waitForTimeout(600);
      await row.locator('.mrw-prow-head').click();
      await row.locator('[data-closed-body] [data-hide-from-list]').waitFor({ timeout: 10000 });
      await ctx.close();
    });
  }

  for (const scheme of ['light', 'dark']) {
    await check(`C4 (${scheme}): player Home (Rowan) at 390 px: plain games only, no alert cards, no money`, async () => {
      const rowan = d0.players.find((p) => p.name === 'Rowan');
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
      for (const bad of ['You owe', 'CREDIT', 'Mark paid', 'Request cash out']) assert(!new RegExp(bad).test(text), `unrelated text on player Home: "${bad}"`);
      assert((await page.locator('.ac, .pay-card, .credit-chip').count()) === 0, 'an alert card, pay card or credit chip is showing on the calm player Home');
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
