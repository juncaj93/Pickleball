/* Zip 21: Error alerts (ERROR_ALERTS, ships OFF). The one Settings row and its TEST button, on the organizer's Settings > Feature
 * switches, at 390, 360 and 320 wide, light and dark (the only screen this zip changes): the row sits first, says what it does, starts
 * off, flips on and off with the usual toast, the TEST button is a real button the same size as the other Settings test buttons, and its
 * answer shows in words (locally there is no Telegram, so it says "Not connected"). No horizontal scroll, nothing cut off.
 *
 *   node e2e/zip21.cjs
 *
 * Nothing here touches Cloudflare, Telegram or the live site.
 */
const { spawn, spawnSync } = require('node:child_process');
const { readFileSync, mkdirSync, rmSync } = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const SEED_ISO = '2026-11-08T17:00:00.000Z';
const NOW_MS = Date.parse(SEED_ISO);
const PIN = /PIN `(\d{6})`/.exec(readFileSync(path.join(ROOT, 'docs/PREVIEW_FAKE_DB.md'), 'utf8'))[1];
const PORT = Number(process.env.E2E_PORT || 5391);
const SHOTS = process.env.SHOTS_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
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
const expect = (ok, msg) => {
  if (!ok) throw new Error(msg);
};

async function main() {
  mkdirSync(path.join(ROOT, '.data'), { recursive: true });
  const file = path.join(ROOT, '.data', 'zip21.sqlite');
  rmSync(file, { force: true });
  const seeded = spawnSync('npx', ['vite-node', 'scripts/load-seed-local.ts', '--', file, SEED_ISO], { cwd: ROOT, encoding: 'utf8' });
  if (seeded.status !== 0) throw new Error(`seed: ${seeded.stderr || seeded.stdout}`);
  const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
    cwd: ROOT,
    env: { ...process.env, DEV_DB: file, SETUP_TOKEN: 'zip21-setup-token-0123456789', DEV_CLOCK: '1' },
    stdio: 'ignore',
    detached: true,
  });
  process.on('exit', () => {
    try {
      process.kill(-server.pid, 'SIGTERM');
    } catch {}
  });
  const base = `http://localhost:${PORT}`;
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(`${base}/api/status`)).ok) break;
    } catch {}
    await sleep(500);
  }
  await fetch(`${base}/__dev/clock`, { method: 'POST', body: JSON.stringify({ atMs: NOW_MS }) });
  const browser = await chromium.launch();

  async function settings(width, scheme) {
    const ctx = await browser.newContext({ viewport: { width, height: 860 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, colorScheme: scheme, reducedMotion: 'reduce' });
    await ctx.request.post(base + '/api/admin/login', { data: { pin: PIN }, headers: { Origin: base } });
    const page = await ctx.newPage();
    await page.goto(base + '/admin');
    await page.locator('.tabbar').waitFor();
    await page.locator('.tabbar button', { hasText: 'Settings' }).evaluate((x) => x.click());
    await page.waitForTimeout(500);
    const sw = page.locator('details', { has: page.locator('summary', { hasText: 'Feature switches' }) }).first();
    if (!(await sw.evaluate((d) => d.open).catch(() => false))) await sw.locator('summary').first().click();
    await page.locator('[data-row="errorAlertsAll"]').waitFor();
    return { ctx, page };
  }

  for (const scheme of ['light', 'dark']) {
    for (const width of [390, 360, 320]) {
      await check(`${width} px, ${scheme}: the Error alerts row sits below the newer rows, off, and fits`, async () => {
        const { ctx, page } = await settings(width, scheme);
        const row = page.locator('[data-row="errorAlertsAll"]');
        const first = await page.evaluate(() => {
          const r = document.querySelector('[data-row="errorAlertsAll"]');
          const rows = [...r.parentElement.querySelectorAll(':scope > .set-row-wrap')];
          return rows.indexOf(r);
        });
        // Newest switch first: Zip 21 put Error alerts first; Zip 23 (Totals refresh) and Zip 24 (Booking hours) have since been added above it.
        // (This script was not in npm run test:e2e until Zip 28, so nobody noticed.) So the only rows above it are those two.
        const above = await page.evaluate(() => {
          const r = document.querySelector('[data-row="errorAlertsAll"]');
          return [...r.parentElement.querySelectorAll(':scope > .set-row-wrap')].slice(0, [...r.parentElement.querySelectorAll(':scope > .set-row-wrap')].indexOf(r)).map((x) => (x.querySelector('.set-name')?.textContent ?? '').trim());
        });
        expect(first === 2 && above.join('|') === 'Booking hours|Totals refresh', `the row is at place ${first}, with these above it: ${above.join('|')}`);
        expect((await row.locator('.set-name').innerText()).startsWith('Error alerts'), 'name');
        expect((await row.locator('.set-hint').innerText()) === 'A Telegram to you when the clock, the backup or the database fails. At most 1 an hour per kind, 6 a day', 'hint');
        expect(!(await row.locator('[data-error-alerts-all]').isChecked()), 'ships off');
        const btn = row.locator('[data-error-alert-test]');
        expect((await btn.innerText()) === 'Send TEST error alert', 'button words');
        const box = await btn.boundingBox();
        expect(box && box.x >= 0 && box.x + box.width <= width, `button fits (${JSON.stringify(box)})`);
        // Same look as the other Settings test button (Settings > Alerts).
        const looks = await page.evaluate(() => {
          const mine = document.querySelector('[data-error-alert-test]');
          const other = document.querySelector('[data-smart-test]');
          const f = (e) => { const s = getComputedStyle(e); return [s.height, s.fontSize, s.fontWeight, s.borderRadius, s.backgroundColor, s.color].join(' '); };
          return { mine: f(mine), other: other ? f(other) : null };
        });
        expect(!looks.other || looks.mine === looks.other, `same as Test smart alert: ${looks.mine} vs ${looks.other}`);
        const scroll = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        expect(scroll <= 0, `horizontal scroll ${scroll}`);
        const cut = await row.evaluate((r) => [...r.querySelectorAll('.set-name, .set-hint, button')].some((e) => e.scrollWidth > e.clientWidth + 1));
        expect(!cut, 'text cut off');
        if (SHOTS) await row.screenshot({ path: path.join(SHOTS, `zip21-row-${width}-${scheme}.png`) });
        await ctx.close();
      });
    }
  }

  await check('TEST button locally: says why it could not send (no Telegram here), in words, no seat or setting changed', async () => {
    const { ctx, page } = await settings(390, 'light');
    const before = await (await ctx.request.get(base + '/api/admin/dashboard')).text();
    await page.locator('[data-error-alert-test]').click();
    const note = page.locator('[data-row="errorAlertsAll"] .notice');
    await note.waitFor({ timeout: 5000 });
    expect(/Not connected/.test(await note.innerText()), await note.innerText());
    const after = await (await ctx.request.get(base + '/api/admin/dashboard')).text();
    expect(JSON.parse(before).errorAlertsForAll === JSON.parse(after).errorAlertsForAll, 'switch unchanged');
    await ctx.close();
  });

  await check('the switch flips on and off with the usual toast, saved for every phone, and History says so', async () => {
    const { ctx, page } = await settings(390, 'dark');
    await page.locator('[data-error-alerts-all]').click({ force: true });
    await page.locator('.toast', { hasText: 'Error alerts on' }).waitFor({ timeout: 5000 });
    let d = await (await ctx.request.get(base + '/api/admin/dashboard')).json();
    expect(d.errorAlertsForAll === true, 'saved on');
    if (SHOTS) await page.locator('[data-row="errorAlertsAll"]').screenshot({ path: path.join(SHOTS, 'zip21-row-on-390-dark.png') });
    await page.waitForTimeout(1500);
    await page.locator('[data-error-alerts-all]').click({ force: true });
    await page.locator('.toast', { hasText: 'Error alerts off' }).waitFor({ timeout: 5000 });
    d = await (await ctx.request.get(base + '/api/admin/dashboard')).json();
    expect(d.errorAlertsForAll === undefined, 'saved off');
    const a = await (await ctx.request.get(base + '/api/admin/activity')).text();
    expect(/error_alerts_on/.test(a) && /error_alerts_off/.test(a), 'History rows');
    await ctx.close();
  });

  await browser.close();
  console.log(`\nzip21: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
