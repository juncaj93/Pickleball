/* Zip 34: "Check-in pay line" (CHECKIN_PAY_LINE, ships OFF). Words only.
 *
 *   node e2e/zip34.cjs      (also run by npm run test:e2e)
 *
 * The SMALL fake world (the 10 fixed names), pretending it is Thu Nov 12, 6:00 PM Eastern, on its own dev server; nothing touches Cloudflare.
 *   1  the Settings row is the TOP row, can be switched off and on with a tap, and holds at 390/360/320, light and dark (nothing clipped);
 *   2  OFF: the gear menu's Text the group > Check-in on "Mixed payments" (Vic and Wren owe) has the old words, no pay line;
 *   3  ON: the same game gets the pay line; "All paid" (4 of 4 paid) keeps the plain words, byte for byte what OFF gave;
 *   4  the private link for one phone (/admin?checkinpay=on) shows the pay line with the row OFF, another phone does not;
 *   5  the gear menu's Text the group list stays inside the screen at 390/360/320, light and dark, text 100 and 150%.
 */
const { spawn, spawnSync } = require('node:child_process');
const { readFileSync, mkdirSync, rmSync } = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { findClipping } = require('./clip-check.cjs');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.E2E_PORT) || 5434;
const BASE = `http://localhost:${PORT}`;
const NOW_ISO = '2026-11-12T23:00:00.000Z'; // Thu Nov 12, 6:00 PM Eastern
const NOW_MS = Date.parse(NOW_ISO);
const PIN = /PIN `(\d{6})`/.exec(readFileSync(path.join(ROOT, 'docs/PREVIEW_FAKE_DB.md'), 'utf8'))[1];
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

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
    console.log(`  ✗ ${name}\n      ${String(err && err.message ? err.message : err).replace(/\s*\n\s*/g, ' ⏎ ').slice(0, 1600)}`);
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const dbFile = path.join(ROOT, '.data', 'zip34.sqlite');
  mkdirSync(path.join(ROOT, '.data'), { recursive: true });
  rmSync(dbFile, { force: true });
  const seeded = spawnSync('npx', ['vite-node', 'scripts/load-small-local.ts', '--', dbFile, NOW_ISO], { cwd: ROOT, encoding: 'utf8' });
  if (seeded.status !== 0) throw new Error(`could not build the fake world: ${seeded.stderr || seeded.stdout}`);
  if (await fetch(`${BASE}/api/status`).then((r) => r.ok, () => false)) throw new Error(`port ${PORT} is already in use`);
  const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
    cwd: ROOT,
    env: { ...process.env, DEV_DB: dbFile, SETUP_TOKEN: 'zip34-setup-token-0123456789', DEV_CLOCK: '1', MOTION_ADMIN: 'on', MOTION: 'on' },
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
  const orgCtx = await browser.newContext();
  const org = orgCtx.request;
  const call = async (method, url, data, headers = {}) => {
    const res = await org.fetch(BASE + url, { method, data, headers: { Origin: BASE, ...headers } });
    return { status: res.status(), ok: res.ok(), json: await res.json().catch(() => ({})) };
  };
  if (!(await call('POST', '/api/admin/login', { pin: PIN })).ok) throw new Error('login failed');
  const dash = async (headers) => (await call('GET', '/api/admin/dashboard', undefined, headers)).json;
  const d0 = await dash();
  const byNote = (note) => d0.sessions.find((s) => s.note === note);
  const mixed = byNote('Mixed payments'); // 4 in: Parker and Christopher Vanderberg paid, Vic and Wren owe
  const allPaid = byNote('All paid'); // 4 of 4 paid
  assert(mixed && allPaid, 'the preview scenes "Mixed payments" and "All paid" are missing');
  assert(mixed.roster.filter((r) => r.owesCents > 0 && r.status === 'confirmed').length === 2, 'Mixed payments should have two people who owe');
  assert(allPaid.roster.every((r) => r.owesCents === 0), 'All paid should owe nothing');
  const setSwitch = (on) => call('PUT', '/api/admin/checkin-pay-switch', { on });

  async function shift(ctx) {
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
  }
  async function openAdmin({ width = 390, scheme = 'light', pct = 100, url = '/admin', height = 800 } = {}) {
    const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, colorScheme: scheme, isMobile: true, hasTouch: true, userAgent: UA, reducedMotion: 'reduce' });
    await shift(ctx);
    assert((await ctx.request.post(BASE + '/api/admin/login', { data: { pin: PIN }, headers: { Origin: BASE } })).ok(), 'admin login');
    const page = await ctx.newPage();
    await page.goto(BASE + url);
    await page.locator('article[data-r2-card]').first().waitFor({ timeout: 20000 });
    // Home lists today and tomorrow first; the other games sit behind "Show all".
    const all = page.getByRole('button', { name: /^Show all/ });
    if (await all.count()) {
      await all.first().click();
      await page.waitForTimeout(400);
    }
    if (pct !== 100) await page.addStyleTag({ content: `html { font-size: ${pct}% !important; } body { font-size: ${(17 * pct) / 100}px !important; }` });
    await page.waitForTimeout(500);
    return { ctx, page };
  }
  const cardOf = (page, id) => page.locator(`article[id="session-${id}"]`);
  /** Open the gear menu > Text the group on a game and return the words behind its Check-in row (what Messages would open with). */
  async function gearCheckIn(page, id) {
    const card = cardOf(page, id);
    await card.scrollIntoViewIfNeeded();
    await card.getByRole('button', { name: /^Game menu for/ }).click();
    await page.getByRole('menuitem', { name: 'Text the group', exact: true }).click();
    const link = page.locator('[data-text="checkin"] a');
    await link.waitFor();
    const href = await link.getAttribute('href');
    const m = /[?&]body=([^&]*)/.exec(href);
    assert(m, `no body in ${href}`);
    return decodeURIComponent(m[1]);
  }
  const closeMenus = async (page) => {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);
  };

  // ================================================================ the Settings row
  await check('the Settings row "Check-in pay line" sits right under Zip 31\'s Extended time at the top, can be switched off and on with a tap, and holds at 390/360/320, light and dark', async () => {
    assert((await dash()).checkInPayForAll === true, 'the preview world should have the row on (PREVIEW SWITCHES RULE)');
    assert((await setSwitch(false)).ok, 'switch off');
    assert((await dash()).checkInPayForAll === undefined, 'off after the Settings row is off');
    for (const scheme of ['light', 'dark']) {
      for (const width of [390, 360, 320]) {
        const { ctx, page } = await openAdmin({ width, scheme });
        await page.locator('.tabbar button', { hasText: 'Settings' }).click();
        await page.waitForTimeout(400);
        for (const s of await page.locator('details > summary').all()) await s.click().catch(() => {});
        const first = await page.locator('#switches [data-row], [data-switches-tidy] [data-row]').evaluateAll((els) => els.slice(0, 3).map((e) => e.getAttribute('data-row')));
        // (Zip 35's Tap guard fix and Zip 31's Extended time are newer and sit on top.)
        assert(first[0] === 'tapGuardFixAll' && first[1] === 'extendedTimeAll' && first[2] === 'checkInPayAll', `newest first: ${first}`);
        const r = page.locator('[data-row="checkInPayAll"]');
        await r.scrollIntoViewIfNeeded();
        assert(/Check-in pay line/.test(await r.innerText()), 'row label');
        assert(!(await r.locator('input[type=checkbox]').isChecked()), 'the row starts off');
        const problems = await page.evaluate(findClipping, { root: '[data-row="checkInPayAll"]' });
        assert(problems.length === 0, `${scheme} ${width}: ${problems.join(' | ')}`);
        const sideways = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        assert(sideways <= 1, `${scheme} ${width}: the page scrolls sideways by ${sideways}px`);
        if (scheme === 'light' && width === 390) {
          await r.locator('label').click();
          await page.waitForTimeout(900);
          assert((await dash()).checkInPayForAll === true, 'on for everyone after the tap');
          await r.locator('label').click();
          await page.waitForTimeout(900);
          assert((await dash()).checkInPayForAll === undefined, 'off again after the second tap');
        }
        await ctx.close();
      }
    }
  });

  // ================================================================ the words
  await check('OFF: Text the group > Check-in on "Mixed payments" has the old words, no pay line', async () => {
    assert((await setSwitch(false)).ok, 'switch off');
    const { ctx, page } = await openAdmin();
    const off = await gearCheckIn(page, mixed.id);
    assert(/^Pickleball .+ @ .+!\n4 in so far\./.test(off), `old words expected: ${JSON.stringify(off)}`);
    assert(!/Pay \$/.test(off), 'no pay line with the switch off');
    await ctx.close();
  });

  let offAllPaid = '';
  await check('ON: "Mixed payments" gets the pay line; "All paid" keeps the plain words, byte for byte what OFF gave', async () => {
    {
      const { ctx, page } = await openAdmin();
      offAllPaid = await gearCheckIn(page, allPaid.id);
      await ctx.close();
    }
    assert((await setSwitch(true)).ok, 'switch on');
    const { ctx, page } = await openAdmin();
    const withLine = await gearCheckIn(page, mixed.id);
    assert(/^Pickleball .+ @ .+!\n4 in\. Still in\? Pay \$14 to confirm\.\nNeed out\? Tell me (tonight|early)\.\n\npickleball\.juncaj\.net$/.test(withLine) || /\n\n[\w.:/-]+$/.test(withLine), `pay line expected: ${JSON.stringify(withLine)}`);
    assert(/4 in\. Still in\? Pay \$14 to confirm\./.test(withLine), `pay line expected: ${JSON.stringify(withLine)}`);
    assert(!/drop|cancel|remove|owe|unpaid/i.test(withLine), 'soft words only');
    await closeMenus(page);
    const plain = await gearCheckIn(page, allPaid.id);
    assert(plain === offAllPaid, `all paid should read exactly as with the switch off:\n${JSON.stringify(plain)}\n${JSON.stringify(offAllPaid)}`);
    assert(!/Pay \$/.test(plain), 'no pay line when everyone paid');
    await ctx.close();
  });

  await check('the private link for one phone: /admin?checkinpay=on shows the pay line with the row OFF; another phone does not', async () => {
    assert((await setSwitch(false)).ok, 'switch off');
    const a = await openAdmin({ url: '/admin?checkinpay=on' });
    assert(/Pay \$14 to confirm/.test(await gearCheckIn(a.page, mixed.id)), 'the private link did not turn it on');
    await a.page.goto(BASE + '/admin?checkinpay=off');
    await a.page.locator('article[data-r2-card]').first().waitFor();
    await a.page.getByRole('button', { name: /^Show all/ }).first().click();
    await a.page.waitForTimeout(400);
    assert(!/Pay \$/.test(await gearCheckIn(a.page, mixed.id)), '=off did not end it');
    await a.ctx.close();
    const b = await openAdmin();
    assert(!/Pay \$/.test(await gearCheckIn(b.page, mixed.id)), 'another phone should not see it');
    await b.ctx.close();
  });

  // ================================================================ the list stays on screen
  await check('the Text the group list stays inside the screen with the pay line on: 390/360/320, light and dark, text 100% and 150%', async () => {
    assert((await setSwitch(true)).ok, 'switch on');
    for (const scheme of ['light', 'dark']) {
      for (const width of [390, 360, 320]) {
        for (const pct of [100, 150]) {
          const { ctx, page } = await openAdmin({ width, scheme, pct });
          const body = await gearCheckIn(page, mixed.id);
          assert(/Pay \$14 to confirm/.test(body), `${scheme} ${width} ${pct}: pay line missing`);
          const problems = await page.evaluate(findClipping, { root: '.menu-pop' });
          assert(problems.length === 0, `${scheme} ${width} ${pct}%: ${problems.join(' | ')}`);
          const box = await page.locator('.menu-pop').boundingBox();
          assert(box && box.x >= -1 && box.x + box.width <= width + 1, `${scheme} ${width} ${pct}%: the menu sticks out sideways (${JSON.stringify(box)})`);
          await ctx.close();
        }
      }
    }
  });

  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
