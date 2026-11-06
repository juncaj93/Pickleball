/* Zip 8: the read-only organizer PIN (the "View only" screens) and the "Last call texts" Settings row.
 *
 *   node e2e/zip8.cjs      (also run by npm run test:e2e)
 *
 * Loads the fake preview world as if it were Mon Nov 9, 2026, 6:05 PM Eastern (the night before a game) into a local file, starts its
 * own dev server on it with a made-up read-only PIN (ORGANIZER_READONLY_PIN, a test value, never the real one) and the server clock
 * pinned, and drives a phone-sized browser. Nothing here touches Cloudflare or the live site.
 * Screenshots: e2e/screenshots/zip8-*.png (ignored by git).
 */
const { spawn, spawnSync } = require('node:child_process');
const { readFileSync, mkdirSync, rmSync } = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.E2E_PORT) || 5293;
const BASE = `http://localhost:${PORT}`;
const NOW_ISO = '2026-11-09T23:05:00.000Z';
const NOW_MS = Date.parse(NOW_ISO);
const SHOTS = process.env.E2E_SHOTS || path.join(__dirname, 'screenshots');
const PIN = /PIN `(\d{6})`/.exec(readFileSync(path.join(ROOT, 'docs/PREVIEW_FAKE_DB.md'), 'utf8'))[1];
const RO_PIN = '40417263'; // a test value for this local server only

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
    console.log(`  ✗ ${name}\n      ${String(err && err.message ? err.message : err).replace(/\s*\n\s*/g, ' ⏎ ').slice(0, 1200)}`);
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  mkdirSync(SHOTS, { recursive: true });
  const dbFile = path.join(ROOT, '.data', 'zip8.sqlite');
  mkdirSync(path.join(ROOT, '.data'), { recursive: true });
  rmSync(dbFile, { force: true });
  const seeded = spawnSync('npx', ['vite-node', 'scripts/load-seed-local.ts', '--', dbFile, NOW_ISO], { cwd: ROOT, encoding: 'utf8' });
  if (seeded.status !== 0) throw new Error(`could not build the fake world: ${seeded.stderr || seeded.stdout}`);
  const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
    cwd: ROOT,
    env: { ...process.env, DEV_DB: dbFile, SETUP_TOKEN: 'zip8-setup-token-0123456789', DEV_CLOCK: '1', ORGANIZER_READONLY_PIN: RO_PIN, TEXTS_R2: 'on', LAST_CALL_TEXTS: 'on', MONEY_REWORK: 'on', INSTANT_TAPS: 'on' },
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
  if (!(await post(real, '/api/admin/login', { pin: PIN })).ok()) throw new Error('real login failed');
  const dash = async () => (await real.get(`${BASE}/api/admin/dashboard`)).json();
  // Last call texts start OFF for everyone here (as on live at ship), so the row is what turns it on.
  await real.put(`${BASE}/api/admin/last-call-switch`, { data: { on: false }, headers: { Origin: BASE } });
  const d0 = await dash();
  const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mobile/15E148 Safari/604.1';
  const phone = (width, scheme = 'light') => ({ viewport: { width, height: 800 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, colorScheme: scheme, userAgent: UA });
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
  /** Sign in through the real sign-in screen with a PIN. */
  async function signIn(pin, { width = 390, scheme = 'light' } = {}) {
    const ctx = await browser.newContext(phone(width, scheme));
    await ctx.addInitScript(shift, NOW_MS - Date.now());
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${BASE}/admin`);
    await page.locator('input[type="password"]').fill(pin);
    await page.locator('button[type="submit"]').click();
    await page.locator('.tabbar').waitFor({ timeout: 10000 });
    await page.waitForTimeout(700);
    return { ctx, page, errors };
  }
  const tab = async (page, name) => {
    await page.locator('.tabbar button', { hasText: name }).first().evaluate((x) => x.click());
    await page.waitForTimeout(600);
  };
  const shot = async (page, name) => (await page.waitForTimeout(400), page.screenshot({ path: path.join(SHOTS, `zip8-${name}.png`) }));
  const snapshotCounts = async () => {
    const d = await dash();
    return JSON.stringify({
      s: d.sessions.map((s) => [s.id, s.bookingStatus, s.state && s.state.flags, s.roster.map((r) => [r.playerId, r.status, r.paymentStatus])]),
      p: d.players.map((p) => [p.id, p.name, p.isActive]),
      g: d.group,
      c: d.creditLedger,
      sw: [d.lastCallTextsForAll, d.tonightGlowForAll, d.homeCollapseForAll],
    });
  };

  await check('read-only PIN: signs in through the normal screen, every tab opens, a "View only" label on the title, no errors', async () => {
    const { ctx, page, errors } = await signIn(RO_PIN);
    const pill = page.locator('[data-view-only]');
    assert((await pill.count()) === 1 && (await pill.textContent()) === 'View only', 'View only label');
    for (const t of ['Home', 'Players', 'Money', 'History', 'Settings']) {
      await tab(page, t);
      assert((await page.locator('main.page').count()) === 1, `${t} opens`);
      assert((await page.locator('[data-view-only]').count()) === 1, `${t}: label stays`);
      await shot(page, `ro-${t.toLowerCase()}`);
    }
    // The label fits on one line next to the title, nothing scrolls sideways, at 320 px too.
    await page.setViewportSize({ width: 320, height: 700 });
    await page.waitForTimeout(300);
    const w = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, inner: window.innerWidth }));
    assert(w.doc <= w.inner, `no sideways scroll at 320 px (${w.doc} > ${w.inner})`);
    const h = await pill.evaluate((el) => el.getBoundingClientRect().height);
    assert(h < 24, `label on one line (${h})`);
    await shot(page, 'ro-320');
    assert(errors.length === 0, `page errors: ${errors.join(' | ')}`);
    await ctx.close();
  });

  await check('read-only PIN: a save is refused calmly ("View only. Nothing was saved."), the screen goes back, nothing changes on the server', async () => {
    const before = await snapshotCounts();
    const { ctx, page } = await signIn(RO_PIN);
    await tab(page, 'Settings');
    for (const x of await page.locator('details > summary').all()) await x.click().catch(() => {});
    const sw = page.locator('[data-last-call-all]');
    await sw.scrollIntoViewIfNeeded();
    assert(!(await sw.isChecked()), 'Last call texts starts off');
    await sw.click();
    const toast = page.locator('text=View only. Nothing was saved.');
    await toast.first().waitFor({ timeout: 5000 });
    // A plain note, not a red error banner.
    const red = await page.locator('.banner.error, .toast.error, [data-kind="error"]').count();
    assert(red === 0, 'not shown as an error');
    await page.waitForTimeout(1500);
    assert(!(await sw.isChecked()), 'the switch is back off');
    await shot(page, 'ro-refused');
    // Home: try Mark paid / any money tap the page offers, then the court switch: all refused.
    await tab(page, 'Money');
    const mark = page.locator('button', { hasText: /^Mark paid$/ }).first();
    if (await mark.count()) {
      await mark.click();
      await page.waitForTimeout(1500);
    }
    assert((await snapshotCounts()) === before, 'nothing on the server changed');
    await ctx.close();
  });

  await check('real PIN: unchanged (no label), and Settings > Feature switches > "Last call texts" saves for everyone and off again', async () => {
    const { ctx, page } = await signIn(PIN);
    assert((await page.locator('[data-view-only]').count()) === 0, 'no View only label for the real PIN');
    await tab(page, 'Settings');
    for (const x of await page.locator('details > summary').all()) await x.click().catch(() => {});
    const row = page.locator('[data-row="lastCallAll"]');
    assert((await row.count()) === 1, 'the row is there');
    const t = await row.locator('.set-name').evaluate((el) => ({ h: el.getBoundingClientRect().height, line: parseFloat(getComputedStyle(el).lineHeight) || 20 }));
    assert(t.h <= t.line * 1.4, 'title on one line');
    const sw = page.locator('[data-last-call-all]');
    await sw.click();
    await page.waitForTimeout(1000);
    let d = await dash();
    assert(d.lastCallTextsForAll === true && d.lastCallTexts === true, 'on for everyone');
    await shot(page, 'settings-last-call');
    await sw.click();
    await page.waitForTimeout(1000);
    d = await dash();
    assert(d.lastCallTextsForAll === false, 'off again');
    await ctx.close();
  });

  await check('dark mode: the View only label is readable (contrast 4.5:1 or more)', async () => {
    const { ctx, page } = await signIn(RO_PIN, { scheme: 'dark' });
    const c = await page.locator('[data-view-only]').evaluate((el) => {
      const rgb = (s) => s.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number);
      const lum = ([r, g, b]) => {
        const f = (v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
        return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
      };
      const cs = getComputedStyle(el);
      const a = lum(rgb(cs.color));
      const b = lum(rgb(cs.backgroundColor));
      return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    });
    assert(c >= 4.5, `contrast ${c.toFixed(2)}`);
    await shot(page, 'ro-dark');
    await ctx.close();
  });

  void d0;
  await browser.close();
  console.log(`\nzip8: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
