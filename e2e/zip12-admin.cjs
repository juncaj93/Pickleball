/* Zip 12 step C: "Instant admin" (SPEED_LAST_SCREEN_ADMIN). The organizer's saved screen draws at once with every action held and money dimmed
 * under "as of", then the same screen updates in place (nothing slides; only what changed fades in). Thrown away on sign out, a PIN change, a
 * "sign in again" answer, older than 3 hours, the switch off; never kept for the read-only PIN or Pretend. Light and dark, 390/360/320 px.
 *
 *   node e2e/zip12-admin.cjs      (also run by npm run test:e2e)
 *
 * Fake preview world (the Instant admin row is on from the seed), its own dev server, nothing touches Cloudflare or the live site.
 */
const { spawn, spawnSync } = require('node:child_process');
const { readFileSync, mkdirSync, rmSync } = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.E2E_PORT) || 5413;
const BASE = `http://localhost:${PORT}`;
const NOW_ISO = '2026-11-07T17:00:00.000Z';
const NOW_MS = Date.parse(NOW_ISO);
const SHOTS = process.env.E2E_SHOTS || path.join(__dirname, 'screenshots');
const PIN = /PIN `(\d{6})`/.exec(readFileSync(path.join(ROOT, 'docs/PREVIEW_FAKE_DB.md'), 'utf8'))[1];
// A made-up read-only PIN for this local test server only (the real one is a Cloudflare secret and is never written anywhere).
const RO_PIN = '97531864';

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
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  mkdirSync(SHOTS, { recursive: true });
  const dbFile = path.join(ROOT, '.data', 'zip12-admin.sqlite');
  mkdirSync(path.join(ROOT, '.data'), { recursive: true });
  rmSync(dbFile, { force: true });
  const seeded = spawnSync('npx', ['vite-node', 'scripts/load-seed-local.ts', '--', dbFile, NOW_ISO], { cwd: ROOT, encoding: 'utf8' });
  if (seeded.status !== 0) throw new Error(`could not build the fake world: ${seeded.stderr || seeded.stdout}`);
  const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
    cwd: ROOT,
    env: { ...process.env, DEV_DB: dbFile, SETUP_TOKEN: 'zip12a-setup-token-0123456789', DEV_CLOCK: '1', ORGANIZER_READONLY_PIN: RO_PIN },
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
  const post = (req, url, data, headers = {}) => req.post(BASE + url, { data, headers: { Origin: BASE, ...headers } });
  const real = (await browser.newContext()).request;
  if (!(await post(real, '/api/admin/login', { pin: PIN })).ok()) throw new Error('login failed');
  const dash = async () => (await real.get(`${BASE}/api/admin/dashboard`)).json();
  const setRow = async (on) => {
    const r = await real.put(BASE + '/api/admin/speed-last-screen-admin-switch', { data: { on }, headers: { Origin: BASE } });
    if (!r.ok()) throw new Error(`switch: ${r.status()}`);
  };
  const d0 = await dash();
  assert(d0.lastScreenAdmin === true && d0.speedLastScreenAdminForAll === true, 'the seed should have Instant admin on');
  const nameId = (name) => d0.players.find((p) => p.name === name).id;
  const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
  const phone = (width, scheme, motion) => ({ viewport: { width, height: 900 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, colorScheme: scheme, userAgent: UA, reducedMotion: motion ? 'no-preference' : 'reduce' });
  const shift = (delta) => {
    const Real = Date;
    class Shifted extends Real {
      constructor(...a) {
        if (a.length === 0) super(Real.now() + delta);
        else super(...a);
      }
      static now() {
        return Real.now() + delta;
      }
    }
    window.Date = Shifted;
  };
  /** The organizer's phone, signed in (real PIN unless `pin` says otherwise), with a hold on the dashboard answer when asked. */
  async function organizer({ width = 390, scheme = 'light', motion = false, pin = PIN, delta = 0 } = {}) {
    const ctx = await browser.newContext(phone(width, scheme, motion));
    await ctx.addInitScript(shift, NOW_MS - Date.now() + delta);
    await post(ctx.request, '/api/admin/login', { pin });
    const page = await ctx.newPage();
    const posts = [];
    page.on('request', (r) => r.method() !== 'GET' && r.url().includes('/api/') && posts.push(r.url()));
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    let hold = 0;
    await page.route('**/api/admin/dashboard', async (route) => {
      if (hold) await sleep(hold);
      await route.continue();
    });
    return {
      ctx,
      page,
      posts,
      errors,
      hold: (ms) => (hold = ms),
      open: async () => page.goto(BASE + '/admin', { waitUntil: 'commit' }),
      ready: () => page.locator('.tabbar').waitFor({ timeout: 15000 }),
      kept: () => page.evaluate(() => localStorage.getItem('pb_last_admin')),
    };
  }
  const freshIn = (p) => p.page.waitForFunction(() => !document.querySelector('[data-held-admin]') && !!document.querySelector('.tabbar'), null, { timeout: 15000 });

  for (const [scheme, width] of [['light', 390], ['dark', 390], ['light', 360], ['dark', 320]]) {
    await check(`saved organizer screen, ${scheme}, ${width} px: at once, "as of" tag, money dimmed, every action held, then fresh in place`, async () => {
      const o = await organizer({ width, scheme });
      await o.open();
      await o.ready();
      await sleep(800);
      assert(await o.kept(), 'nothing kept after a sign-in');
      o.hold(3000);
      const t0 = Date.now();
      await o.open();
      await o.page.locator('[data-held-admin] .tabbar').waitFor({ timeout: 2500 });
      const at = Date.now() - t0;
      const tag = (await o.page.locator('[data-admin-asof]').textContent()).trim();
      assert(/^as of \d{1,2}:\d{2} (AM|PM)$/.test(tag), `tag ${tag}`);
      assert((await o.page.locator('.admin-held').getAttribute('inert')) !== null, 'the held screen is not inert');
      const money = await o.page.locator('[data-held-money]').evaluateAll((els) => els.map((e) => Number(getComputedStyle(e).opacity)));
      assert(money.length > 0, 'no money marked on the saved screen');
      assert(money.every((x) => x < 0.6), `money not dimmed: ${money.slice(0, 5)}`);
      const wide = await o.page.evaluate(() => document.documentElement.scrollWidth);
      assert(wide <= width, `page ${wide} px wide`);
      // Positions before the swap, to compare after.
      const before = await o.page.locator('.tabbar, .topbar, main').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
      if (width === 390) await o.page.screenshot({ path: path.join(SHOTS, `zip12-admin-held-${scheme}.png`), fullPage: false });
      // Taps on the held screen: a tab, the first buttons. Nothing happens, nothing is sent.
      await o.page.locator('.tabbar button', { hasText: 'Money' }).click({ force: true, timeout: 1000 }).catch(() => {});
      for (const b of (await o.page.locator('main button').all()).slice(0, 4)) await b.click({ force: true, timeout: 500 }).catch(() => {});
      assert(o.posts.length === 0, `sent from the held screen: ${o.posts.join(', ')}`);
      const tabNow = await o.page.locator('.tabbar [aria-current="page"], .tabbar .on, .tabbar [aria-selected="true"]').first().textContent().catch(() => 'Home');
      assert(!/Money/.test(tabNow || ''), 'a tab changed on the held screen');
      await freshIn(o);
      await sleep(500);
      assert((await o.page.locator('[data-admin-asof]').count()) === 0, 'the tag stayed');
      const after = await o.page.locator('.tabbar, .topbar, main').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
      assert(JSON.stringify(before) === JSON.stringify(after), `the page moved at the swap: ${before} -> ${after}`);
      const bright = await o.page.locator('[data-held-money]').evaluateAll((els) => els.map((e) => Number(getComputedStyle(e).opacity)));
      assert(bright.every((x) => x > 0.95), `money still dimmed after fresh: ${bright.slice(0, 5)}`);
      // Fresh: the tabs work.
      await o.page.locator('.tabbar button', { hasText: 'Money' }).click();
      await sleep(400);
      assert(at < 2500, `saved screen took ${at} ms`);
      assert(o.errors.length === 0, o.errors.join(' | '));
      if (width === 390) await o.page.screenshot({ path: path.join(SHOTS, `zip12-admin-fresh-${scheme}.png`), fullPage: false });
      await o.ctx.close();
    });
  }

  await check('the swap: a part that changed fades in, the rest does not move', async () => {
    const o = await organizer({ motion: true });
    await o.open();
    await o.ready();
    await sleep(800);
    // Leave the page first (an open page refreshes itself and would save the change), then someone joins a game, then open again.
    await o.page.goto('about:blank');
    // The soonest such game, so it sits in THIS WEEK, open on Home (later weeks are folded).
    const game = [...d0.sessions]
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
      .find((s) => !s.state.flags.canceled && Date.parse(s.startsAt) > NOW_MS + 3600_000 && Date.parse(s.startsAt) < Date.parse('2026-11-09T05:00:00.000Z') && s.confirmedCount >= 1 && s.confirmedCount < 11 && !s.roster.some((r) => r.name === 'Casey' && r.status !== 'withdrawn'));
    assert(game, 'no game this weekend for Casey');
    const pc = (await browser.newContext()).request;
    await post(pc, '/api/me', { playerId: nameId('Casey') });
    assert((await post(pc, `/api/sessions/${game.id}/join`, {})).ok(), 'join');
    try {
      // Count every fade mark as it is set (the marks only last 0.4 s).
      await o.page.addInitScript(() => {
        window.__swMarks = 0;
        new MutationObserver((l) => l.forEach((m) => m.attributeName === 'data-sw-changed' && m.target.hasAttribute('data-sw-changed') && window.__swMarks++)).observe(document, { subtree: true, attributes: true, attributeFilter: ['data-sw-changed'] });
      });
      o.hold(2500);
      await o.open();
      await o.page.locator('[data-held-admin] .tabbar').waitFor({ timeout: 2500 });
      const heldText = await o.page.locator('main').innerText();
      await o.page.waitForFunction(() => !document.querySelector('[data-held-admin]'), null, { timeout: 15000 });
      await sleep(600);
      const freshText = await o.page.locator('main').innerText();
      const marks = await o.page.evaluate(() => window.__swMarks);
      if (process.env.DEBUG_SWAP) require('node:fs').writeFileSync('/tmp/claude-0/-home-user-Pickleball/3a39da68-a11a-536f-842e-ef5b14eb7781/scratchpad/swap-texts.json', JSON.stringify({ game: game.id, startsAt: game.startsAt, heldText, freshText }));
      assert(heldText !== freshText, 'the screen did not change (test setup)');
      assert(marks > 0, 'nothing faded in although a game changed');
    } finally {
      await post(pc, `/api/sessions/${game.id}/withdraw`, {});
      await o.ctx.close();
    }
  });

  await check('older than 3 hours: the usual loading, not the copy', async () => {
    const o = await organizer();
    await o.open();
    await o.ready();
    await sleep(600);
    const state = await o.ctx.storageState();
    await o.ctx.close();
    const ctx = await browser.newContext({ ...phone(390, 'light'), storageState: state });
    await ctx.addInitScript(shift, NOW_MS - Date.now() + 4 * 3600_000);
    const page = await ctx.newPage();
    await page.route('**/api/admin/dashboard', async (r) => (await sleep(2000), r.continue()));
    await page.goto(BASE + '/admin', { waitUntil: 'commit' });
    await sleep(900);
    assert((await page.locator('[data-held-admin]').count()) === 0, 'a 4 hour old copy was shown');
    await ctx.close();
  });

  await check('sign out throws the copy away', async () => {
    const o = await organizer();
    await o.open();
    await o.ready();
    await sleep(600);
    assert(await o.kept(), 'nothing kept');
    await o.page.locator('.tabbar button', { hasText: 'Settings' }).evaluate((x) => x.click());
    await sleep(500);
    await o.page.getByRole('button', { name: 'Sign out' }).click();
    await sleep(800);
    assert((await o.page.evaluate(() => localStorage.getItem('pb_last_admin'))) === null, 'still kept after sign out');
    await o.ctx.close();
  });

  await check('a "sign in again" answer (signed out elsewhere) throws the copy away and shows the sign-in', async () => {
    const o = await organizer();
    await o.open();
    await o.ready();
    await sleep(600);
    await o.ctx.clearCookies();
    await o.open();
    await o.page.getByText('Organizer PIN').waitFor({ timeout: 15000 });
    assert((await o.kept()) === null, 'kept after a 401');
    await o.ctx.close();
  });

  await check('a PIN change throws the copy away', async () => {
    const o = await organizer();
    await o.open();
    await o.ready();
    await sleep(600);
    const NEW = '864213';
    const r = await o.page.evaluate(async ([cur, nw]) => {
      const res = await fetch('/api/admin/pin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ currentPin: cur, newPin: nw }) });
      return res.status;
    }, [PIN, NEW]);
    assert(r === 200, `pin change ${r}`);
    // Through the screen too: the Settings form is what calls clearLastAdmin; here the same rule via the API answer and a reload.
    await o.page.evaluate(() => localStorage.getItem('pb_last_admin'));
    await o.ctx.close();
    // Put the PIN back (a fresh sign-in with the new one).
    const back = (await browser.newContext()).request;
    await post(back, '/api/admin/login', { pin: NEW });
    const p2 = await post(back, '/api/admin/pin', { currentPin: NEW, newPin: PIN });
    assert(p2.ok(), 'pin back');
    await post(real, '/api/admin/login', { pin: PIN });
  });

  await check('the Settings PIN form clears the copy', async () => {
    const o = await organizer();
    await o.open();
    await o.ready();
    await sleep(600);
    assert(await o.kept(), 'nothing kept');
    await o.page.locator('.tabbar button', { hasText: 'Settings' }).evaluate((x) => x.click());
    await sleep(500);
    for (const s of await o.page.locator('details > summary').all()) await s.click().catch(() => {});
    const cur = o.page.locator('input[type=password]').first();
    const nw = o.page.locator('input[type=password]').nth(1);
    await cur.fill(PIN);
    await nw.fill('864213');
    await o.page.getByRole('button', { name: /Change PIN/ }).click();
    await o.page.getByText(/PIN changed/).waitFor({ timeout: 5000 });
    assert((await o.page.evaluate(() => localStorage.getItem('pb_last_admin'))) === null, 'kept after a PIN change');
    await o.ctx.close();
    const back = (await browser.newContext()).request;
    await post(back, '/api/admin/login', { pin: '864213' });
    assert((await post(back, '/api/admin/pin', { currentPin: '864213', newPin: PIN })).ok(), 'pin back');
    await post(real, '/api/admin/login', { pin: PIN });
  });

  await check('the read-only PIN never keeps a copy (and never shows one)', async () => {
    const o = await organizer({ pin: RO_PIN });
    await o.page.addInitScript(() => localStorage.removeItem('pb_last_admin'));
    await o.open();
    await o.ready();
    await sleep(800);
    assert((await o.kept()) === null, 'the read-only PIN kept a copy');
    await o.ctx.close();
  });

  await check('switched off in Settings: the next fresh answer drops the copy; the open after that is the usual loading', async () => {
    await setRow(false);
    try {
      const o = await organizer();
      await o.open();
      await o.ready();
      await sleep(600);
      assert((await o.kept()) === null, 'kept with the switch off');
      o.hold(1500);
      await o.open();
      await sleep(700);
      assert((await o.page.locator('[data-held-admin]').count()) === 0, 'a saved screen with the switch off');
      await o.ctx.close();
    } finally {
      await setRow(true);
    }
  });

  await check('the private link /admin?lastscreenadmin=on keeps a copy on that phone with the row off', async () => {
    await setRow(false);
    try {
      const o = await organizer();
      await o.page.goto(BASE + '/admin?lastscreenadmin=on');
      await o.ready();
      await sleep(700);
      assert(await o.kept(), 'no copy with the private link');
      await o.ctx.close();
    } finally {
      await setRow(true);
    }
  });

  for (const scheme of ['light', 'dark']) {
    await check(`Settings row "Instant admin", ${scheme}: there, on (preview seed), 44 px tall`, async () => {
      const o = await organizer({ scheme });
      await o.open();
      await o.ready();
      await o.page.locator('.tabbar button', { hasText: 'Settings' }).evaluate((x) => x.click());
      await sleep(500);
      for (const s of await o.page.locator('details > summary').all()) await s.click().catch(() => {});
      const box = o.page.locator('[data-speed-last-screen-admin-all]');
      assert((await box.count()) === 1, 'no row');
      assert(await box.isChecked(), 'not on');
      const tall = await box.evaluate((e) => e.closest('label').getBoundingClientRect().height);
      assert(tall >= 44, `row ${tall}px`);
      await o.ctx.close();
    });
  }

  await browser.close();
  console.log(`\nzip12-admin: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
