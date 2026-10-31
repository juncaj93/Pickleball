/* "Cancel with a reason", in the browser: the organizer cancels a future game
 * with a reason (Sessions tab), sees "Canceled - <reason>", the player's card
 * for that game reads "Canceled - <reason>" (the player-side checks follow the
 * new player wording and may fail until that ships), an HTML-looking reason is
 * shown as plain text with no injected element, and Reopen clears it.
 * Fake group; the clock is Mon Nov 2, 9:00 AM Eastern.
 *
 *   node e2e/cancel-reason.cjs      (also run by npm run test:e2e)
 */
const { spawn } = require('node:child_process');
const { rmSync, mkdirSync } = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.E2E_PORT) || 5210;
const BASE = `http://localhost:${PORT}`;
const SETUP_TOKEN = 'cancel-reason-token-0123456789';
const PIN = '482913';
const PEOPLE = ['Alex', 'Ryan', 'Mitchel', 'Brandon', 'Julian', 'Nathan', 'Frankie'];
const HTML_REASON = '<img src=x onerror=alert(1)> & "q"';

let passed = 0;
let failed = 0;
async function check(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.log(`  ✗ ${name}\n      ${String(err && err.message ? err.message : err).replace(/\s*\n\s*/g, ' ⏎ ').slice(0, 700)}`);
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
const squash = (t) => t.replace(/\s+/g, ' ').trim();

async function main() {
  const dbFile = path.join(ROOT, '.data', 'cancel-reason.sqlite');
  mkdirSync(path.join(ROOT, '.data'), { recursive: true });
  rmSync(dbFile, { force: true });
  const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
    cwd: ROOT,
    env: { ...process.env, DEV_DB: dbFile, SETUP_TOKEN, DEV_CLOCK: '1' },
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
  await fetch(`${BASE}/__dev/clock`, { method: 'POST', body: JSON.stringify({ atMs: Date.parse('2026-11-02T09:00:00-05:00') }) });

  const browser = await chromium.launch();
  const api = await browser.newContext();
  const call = async (req, method, url, data) => {
    const res = await req.fetch(BASE + url, { method, data, headers: { Origin: BASE } });
    if (!res.ok()) throw new Error(`${method} ${url}: ${res.status()} ${await res.text()}`);
    return res.json().catch(() => ({}));
  };
  await call(api.request, 'POST', '/api/setup', {
    setupToken: SETUP_TOKEN, groupName: 'Pickleball Bros', pin: PIN, venmoUrl: 'https://venmo.com/u/organizer',
    players: PEOPLE.map((name, i) => ({ name, phone: `248555010${i}` })),
  });
  await call(api.request, 'PUT', '/api/admin/group', { organizerName: 'Alex' });
  const d0 = await call(api.request, 'GET', '/api/admin/dashboard');
  const id = Object.fromEntries(d0.players.map((p) => [p.name, p.id]));
  const thu = d0.sessions.find((s) => new Date(s.startsAt).toLocaleDateString('en-CA', { timeZone: 'America/Detroit' }) === '2026-11-05');
  assert(thu, 'no Thu Nov 5 game');
  const DATE = 'Thu, Nov 5';
  const adminSession = async () => (await call(api.request, 'GET', '/api/admin/dashboard')).sessions.find((s) => s.id === thu.id);

  const organizer = async () => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 860 }, isMobile: true, hasTouch: true });
    await ctx.request.post(BASE + '/api/admin/login', { headers: { Origin: BASE }, data: { pin: PIN } });
    const page = await ctx.newPage();
    await page.goto(BASE + '/admin');
    const card = page.locator('section[aria-labelledby="sessions-title"] article', { hasText: DATE }).first();
    await card.waitFor();
    return { ctx, page, card };
  };
  // Open the card's options menu (it may still be open from before), then pick an item.
  const pick = async (card, name) => {
    const item = card.getByRole('button', { name, exact: true });
    if (!(await item.isVisible())) await card.getByRole('button', { name: /^Session options/ }).click();
    await item.click();
  };
  const playerCard = async () => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 860 }, isMobile: true, hasTouch: true });
    await call(ctx.request, 'POST', '/api/me', { playerId: id.Frankie });
    const page = await ctx.newPage();
    await page.goto(BASE + '/');
    const card = page.locator(`#row-${thu.id}`);
    await card.waitFor();
    return { ctx, page, card };
  };

  // ---- Cancel through the organizer UI, empty reason first (the field is optional and always there).
  {
    const { ctx, page, card } = await organizer();
    await check('the cancel dialog always has an optional "Reason (optional)" field with a 40 character limit', async () => {
      await pick(card, 'Cancel session');
      const dlg = page.locator('dialog[open]');
      const field = dlg.getByLabel('Reason (optional)');
      await field.waitFor();
      assert((await field.getAttribute('maxlength')) === '40', 'maxlength');
      assert((await field.getAttribute('placeholder')) === 'Thanksgiving', 'placeholder');
      assert((await field.inputValue()) === '', 'starts empty');
      await page.keyboard.press('Escape');
      await page.locator('dialog[open]').waitFor({ state: 'detached' }).catch(() => {});
    });
    await check('cancel with a reason: the card reads "Canceled - <reason>" and the API stores it', async () => {
      await pick(card, 'Cancel session');
      const dlg = page.locator('dialog[open]');
      await dlg.getByLabel('Reason (optional)').fill('Thanksgiving week');
      await dlg.getByRole('button', { name: 'Cancel session' }).click();
      await page.getByText('Session canceled').first().waitFor();
      await page.keyboard.press('Escape');
      await page.locator('dialog[open]').waitFor({ state: 'detached' }).catch(() => {});
      assert((await adminSession()).cancelReason === 'Thanksgiving week', 'stored');
      await page.reload();
      const c = page.locator('section[aria-labelledby="sessions-title"] article', { hasText: DATE }).first();
      await c.waitFor();
      assert(squash(await c.locator('.court-line .court-status').first().innerText()) === 'Canceled - Thanksgiving week', `card: ${squash(await c.locator('.court-line .court-status').first().innerText())}`);
      assert(!/—/.test(await c.innerText()), 'no em dash');
    });
    await ctx.close();
  }

  // ---- The player's card (player-side wording is being changed in parallel).
  {
    const { ctx, page, card } = await playerCard();
    await check('player card for that game reads "Canceled - Thanksgiving week"', async () => {
      const t = squash(await card.locator('.sched-status').innerText());
      assert(t === 'Canceled - Thanksgiving week', `status: ${t}`);
    });
    await ctx.close();
  }

  // ---- Reopen clears it everywhere.
  {
    const { ctx, page, card } = await organizer();
    await check('reopen clears the reason: organizer card, API and player card', async () => {
      await pick(card, 'Reopen session');
      await page.locator('dialog[open]').getByRole('button', { name: 'Reopen session' }).click();
      await page.getByText('Session reopened').first().waitFor();
      assert((await adminSession()).cancelReason === null, 'still stored');
      assert(!/Canceled/.test(await card.innerText()), 'card still says canceled');
      const p = await playerCard();
      assert(!/Canceled|Thanksgiving/.test(await p.card.innerText()), 'player card still shows it');
      await p.ctx.close();
    });
    await ctx.close();
  }

  // ---- No reason: plain Canceled, then an HTML-looking reason shown literally.
  {
    const { ctx, page, card } = await organizer();
    await check('cancel with no reason reads plain "Canceled"; the player card reads "Canceled" too', async () => {
      await pick(card, 'Cancel session');
      await page.locator('dialog[open]').getByRole('button', { name: 'Cancel session' }).click();
      await page.getByText('Session canceled').first().waitFor();
      await page.keyboard.press('Escape');
      await page.locator('dialog[open]').waitFor({ state: 'detached' }).catch(() => {});
      assert((await adminSession()).cancelReason === null, 'should be null');
      await page.reload();
      const c = page.locator('section[aria-labelledby="sessions-title"] article', { hasText: DATE }).first();
      await c.waitFor();
      assert(squash(await c.locator('.court-line .court-status').first().innerText()) === 'Canceled', 'organizer card');
      const p = await playerCard();
      const t = squash(await p.card.locator('.sched-status').innerText());
      await p.ctx.close();
      assert(t === 'Canceled', `player status: ${t}`);
    });
    await check('reopen again, then cancel with an HTML-looking reason', async () => {
      await page.reload();
      const c = page.locator('section[aria-labelledby="sessions-title"] article', { hasText: DATE }).first();
      await pick(c, 'Reopen session');
      await page.locator('dialog[open]').getByRole('button', { name: 'Reopen session' }).click();
      await page.getByText('Session reopened').first().waitFor();
      await pick(c, 'Cancel session');
      const dlg = page.locator('dialog[open]');
      await dlg.getByLabel('Reason (optional)').fill(HTML_REASON);
      await dlg.getByRole('button', { name: 'Cancel session' }).click();
      await page.getByText('Session canceled').first().waitFor();
      await page.keyboard.press('Escape');
      await page.locator('dialog[open]').waitFor({ state: 'detached' }).catch(() => {});
      assert((await adminSession()).cancelReason === HTML_REASON, 'stored as typed');
    });
    await check('organizer screen shows the HTML-looking reason as literal text and injects no element', async () => {
      const dialogs = [];
      page.on('dialog', (d) => {
        dialogs.push(d.message());
        d.dismiss().catch(() => {});
      });
      await page.reload();
      const c = page.locator('section[aria-labelledby="sessions-title"] article', { hasText: DATE }).first();
      await c.waitFor();
      assert(squash(await c.locator('.court-line .court-status').first().innerText()) === `Canceled - ${HTML_REASON}`, `card: ${squash(await c.locator('.court-line .court-status').first().innerText())}`);
      assert((await page.locator('main img[src="x"], img[onerror]').count()) === 0, 'an img element was injected');
      await page.waitForTimeout(500);
      assert(dialogs.length === 0, `an alert fired: ${dialogs}`);
    });
    await ctx.close();
  }
  {
    const { ctx, page, card } = await playerCard();
    await check('player screen shows the HTML-looking reason as literal text and injects no element', async () => {
      const dialogs = [];
      page.on('dialog', (d) => {
        dialogs.push(d.message());
        d.dismiss().catch(() => {});
      });
      await page.reload();
      await card.waitFor();
      const t = squash(await page.locator(`#row-${thu.id}`).locator('.sched-status').innerText());
      assert(t === `Canceled - ${HTML_REASON}`, `status: ${t}`);
      assert((await page.locator('main img[src="x"], img[onerror]').count()) === 0, 'an img element was injected');
      assert(dialogs.length === 0, `an alert fired: ${dialogs}`);
    });
    await ctx.close();
  }

  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
