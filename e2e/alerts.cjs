/* Settings > Alerts on a phone: collapsed like the other rows, opens, the
 * switches save themselves, the test button explains itself, and nothing
 * spills sideways.
 *
 *   node e2e/alerts.cjs      (also run by npm run test:e2e)
 *
 * Starts its own dev server with a fresh fake group. The local server has no
 * Telegram secrets, so it shows "Not connected"; the "Sent to Telegram" state
 * is checked with the test button's answer faked in the browser. No real
 * message is ever sent. Pictures go to e2e/screenshots/alerts-*.png.
 */
const { spawn } = require('node:child_process');
const { rmSync, mkdirSync } = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const PORT = 5196;
const BASE = `http://localhost:${PORT}`;
const SETUP_TOKEN = 'alerts-setup-token-0123456789';
const PIN = '482913';
const SHOTS = path.join(__dirname, 'screenshots');

let passed = 0;
let failed = 0;
async function check(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.log(`  ✗ ${name}\n      ${String(err && err.message ? err.message : err).replace(/\s*\n\s*/g, ' ⏎ ').slice(0, 500)}`);
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function main() {
  const dbFile = path.join(ROOT, '.data', 'alerts.sqlite');
  mkdirSync(path.join(ROOT, '.data'), { recursive: true });
  mkdirSync(SHOTS, { recursive: true });
  rmSync(dbFile, { force: true });
  const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
    cwd: ROOT,
    env: { ...process.env, DEV_DB: dbFile, SETUP_TOKEN },
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
    await new Promise((r) => setTimeout(r, 500));
  }
  const browser = await chromium.launch();
  const setup = await browser.newContext();
  const res = await setup.request.post(BASE + '/api/setup', {
    headers: { Origin: BASE },
    data: { setupToken: SETUP_TOKEN, groupName: 'Pickleball Bros', pin: PIN, players: ['Alex', 'Ryan', 'Brandon', 'Julian'].map((name) => ({ name })) },
  });
  assert(res.ok(), `setup failed: ${res.status()}`);

  for (const scheme of ['light', 'dark']) {
    for (const width of [360, 375, 390, 430]) {
      const ctx = await browser.newContext({ viewport: { width, height: 860 }, isMobile: true, hasTouch: true, colorScheme: scheme });
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      await ctx.request.post(BASE + '/api/admin/login', { headers: { Origin: BASE }, data: { pin: PIN } });
      await page.goto(BASE + '/admin');
      await page.getByRole('button', { name: /Settings/ }).first().click();
      const sect = page.locator('details[data-section="alerts"]');
      const tag = `${width} ${scheme}`;

      await check(`${tag}: Alerts is a collapsed row like the others, saying Not connected`, async () => {
        await sect.waitFor();
        assert(!(await sect.evaluate((d) => d.open)), 'starts open');
        const summary = (await sect.locator('summary').innerText()).replace(/\s+/g, ' ');
        assert(/Alerts/.test(summary) && /Not connected/.test(summary), summary);
        const h = (await sect.locator('summary').boundingBox()).height;
        assert(h >= 44 && h <= 56, `row is ${h}px tall`);
      });

      await sect.locator('summary').click();
      await check(`${tag}: status line, the main switch and five alert switches all on (drops within 36 hours, falls below 4, reaches 4, refund requests, smart alerts), test buttons, no token or chat ID`, async () => {
        const status = await page.getByTestId('alert-status').innerText();
        assert(/Not connected/.test(status) && /No alerts yet/.test(status), status);
        const switches = sect.getByRole('switch');
        assert((await switches.count()) === 6, `found ${await switches.count()} switches`);
        for (let i = 0; i < 6; i++) assert(await switches.nth(i).isChecked(), `switch ${i} off`);
        const labels = (await sect.locator('.alert-subs .set-name').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim());
        assert(JSON.stringify(labels) === JSON.stringify(['Someone drops within 36 hours', 'A game falls below 4', "A game reaches 4 (it's on)", 'Refund requests', 'Smart alerts ("Do this now" reminders)']), `switches were ${JSON.stringify(labels)}`);
        assert(!/6 down to 5|reaches 6|Under 4, or|Finalize reminder/.test(await sect.innerText()), 'old alert wording');
        await sect.getByRole('button', { name: 'Send test alert' }).waitFor();
        await sect.getByRole('button', { name: 'Send TEST smart alert' }).waitFor();
        const text = await sect.innerText();
        assert(!/token|chat id|\d{8,}/i.test(text), 'shows a secret-looking value');
      });

      await check(`${tag}: nothing sticks out sideways and tap targets are big enough`, async () => {
        const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        assert(over <= 0, `page scrolls sideways by ${over}px`);
        const boxes = await sect.locator('label.alert-switch, .alert-test button').evaluateAll((els) =>
          els.map((e) => {
            const r = e.getBoundingClientRect();
            return { w: r.width, h: r.height, right: r.right };
          }),
        );
        for (const b of boxes) {
          assert(b.h >= 40, `tap target ${b.h}px tall`);
          assert(b.right <= width + 0.5, `sticks out at ${b.right}px on a ${width}px screen`);
        }
        const clipped = await sect.locator('.set-name').evaluateAll((els) => els.filter((e) => e.scrollWidth > e.clientWidth + 1).length);
        assert(clipped === 0, `${clipped} labels cut off`);
      });

      if (width === 360) {
        await check(`${tag}: turning a switch off saves by itself and stays off after reload`, async () => {
          const drop = sect.getByRole('switch', { name: /drops within 36 hours/ });
          await drop.click();
          await sect.getByText('✓ Saved').first().waitFor({ timeout: 4000 });
          await page.reload();
          await page.getByRole('button', { name: /Settings/ }).first().click();
          const s2 = page.locator('details[data-section="alerts"]');
          if (!(await s2.evaluate((d) => d.open))) await s2.locator('summary').click();
          assert(!(await s2.getByRole('switch', { name: /drops within 36 hours/ }).isChecked()), 'did not stay off');
          await s2.getByRole('switch', { name: /drops within 36 hours/ }).click();
          await s2.getByText('✓ Saved').first().waitFor({ timeout: 4000 });
        });
        await check(`${tag}: main switch off greys out the other four`, async () => {
          const main = sect.getByRole('switch', { name: /Telegram alerts to me/ });
          await main.click();
          await sect.getByText('✓ Saved').first().waitFor({ timeout: 4000 });
          for (const name of [/drops within 36 hours/, /falls below 4/, /reaches 4/, /Refund requests/]) assert(await sect.getByRole('switch', { name }).isDisabled(), `${name} not disabled`);
          await main.click();
          await sect.getByText('✓ Saved').first().waitFor({ timeout: 4000 });
        });
      }

      await check(`${tag}: Send test alert explains Not connected in plain words`, async () => {
        await sect.getByRole('button', { name: 'Send test alert' }).click();
        await sect.getByText(/Not connected: the bot token or chat ID is missing on Cloudflare\./).waitFor({ timeout: 4000 });
      });
      await page.screenshot({ path: path.join(SHOTS, `alerts-${width}-${scheme}-not-connected.png`), fullPage: true });

      await check(`${tag}: a good send shows "Sent to Telegram"`, async () => {
        await page.route('**/api/admin/alerts/test', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }));
        await sect.getByRole('button', { name: 'Send test alert' }).click();
        await sect.getByText('✓ Sent to Telegram').waitFor({ timeout: 4000 });
        const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        assert(over <= 0, `page scrolls sideways by ${over}px`);
        await page.unroute('**/api/admin/alerts/test');
      });
      await sect.scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(SHOTS, `alerts-${width}-${scheme}.png`) });
      await check(`${tag}: no browser errors`, async () => assert(errors.length === 0, errors.join(' | ')));
      await ctx.close();
    }
  }
  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
