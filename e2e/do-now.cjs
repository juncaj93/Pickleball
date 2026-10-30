/* The "Do this now" card at the top of the organizer's Home:
 *   - one task at a time, "+N more" for the rest, same words as the Telegram alert
 *   - fits 360 to 430 px wide in light and dark, buttons at least 44 px tall, no sideways scroll
 *   - the cancel checklist updates as taps are made (Court canceled, Cancel the session)
 *   - the night-before text opens Messages with NO recipients, and the tap is saved on the server
 *   - Settings > Alerts has the Smart alerts switch and the TEST button
 * Fake group, fake clock: Mon Nov 2, 10:15 PM Eastern; Tue Nov 3 has 3 in and a booked court.
 *
 *   node e2e/do-now.cjs      (also run by npm run test:e2e)
 */
const { spawn } = require('node:child_process');
const { rmSync, mkdirSync } = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const PORT = 5234;
const BASE = `http://localhost:${PORT}`;
const SETUP_TOKEN = 'donow-setup-token-0123456789';
const PIN = '482913';
const NAMES = ['Alex', 'Nathan', 'Ryan', 'Mitchel', 'Brandon', 'Julian'];
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const SHOTS = process.env.SHOTS_DIR;

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
  const dbFile = path.join(ROOT, '.data', 'donow.sqlite');
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
  const clock = (iso) => fetch(`${BASE}/__dev/clock`, { method: 'POST', body: JSON.stringify({ atMs: Date.parse(iso) }) });
  await clock('2026-11-02T12:00:00-05:00');

  const browser = await chromium.launch();
  const post = (req, url, data) => req.post(BASE + url, { data, headers: { Origin: BASE } });
  const setup = (await browser.newContext()).request;
  const made = await post(setup, '/api/setup', {
    setupToken: SETUP_TOKEN,
    groupName: 'Pickleball Bros',
    pin: PIN,
    venmoUrl: 'https://venmo.com/u/organizer',
    players: NAMES.map((name, i) => ({ name, phone: `24855503${String(i).padStart(2, '0')}` })),
  });
  if (!made.ok()) throw new Error(`setup failed: ${await made.text()}`);
  const api = (await browser.newContext()).request;
  await post(api, '/api/admin/login', { pin: PIN });
  const dash = async () => (await api.get(`${BASE}/api/admin/dashboard`)).json();
  let d = await dash();
  for (const h of d.hiddenSessions || []) await post(api, `/api/admin/sessions/${h.id}/show`, { shown: true });
  d = await dash();
  const games = d.sessions.filter((s) => !s.state.flags.past);
  for (const s of games) await post(api, `/api/admin/sessions/${s.id}/booked`, {});
  const tue = games.find((s) => s.startsAt.startsWith('2026-11-04T01:00')); // Tue Nov 3, 8 PM Eastern
  assert(tue, `no Tue Nov 3 game in ${games.map((g) => g.startsAt)}`);
  const idOf = (n) => d.players.find((p) => p.name === n).id;
  for (const n of ['Nathan', 'Ryan', 'Mitchel']) {
    const c = await browser.newContext();
    await post(c.request, '/api/me', { playerId: idOf(n) });
    await post(c.request, `/api/sessions/${tue.id}/join`, {});
  }
  await clock('2026-11-02T22:15:00-05:00');

  const phone = (width, colorScheme) => ({ viewport: { width, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme, userAgent: UA });
  async function openHome(width = 390, scheme = 'light') {
    const ctx = await browser.newContext(phone(width, scheme));
    await post(ctx.request, '/api/admin/login', { pin: PIN });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/admin`);
    await page.locator('.do-now').waitFor();
    return { ctx, page };
  }

  await check('one task card at the top of Home, in the alert\'s words, with "+1 more"', async () => {
    const { ctx, page } = await openHome();
    const first = await page.evaluate(() => document.querySelector('main.page')?.firstElementChild?.className ?? '');
    assert(/do-now/.test(first), `first thing on Home: ${first}`);
    const cards = page.locator('.dn-card');
    assert((await cards.count()) === 1, `cards shown: ${await cards.count()}`);
    assert(squash(await page.locator('.dn-card.lead .dn-text').innerText()) === 'Tuesday: only 3 players in.', await page.locator('.dn-text').innerText());
    assert(squash(await page.locator('.dn-eyebrow').first().innerText()).toLowerCase() === 'do this now', 'eyebrow');
    const steps = await page.locator('.dn-step .dn-step-label').allInnerTexts();
    assert(JSON.stringify(steps.map(squash)) === JSON.stringify(['Cancel the court', 'Cancel the session', "Text everyone it's canceled"]), `steps: ${steps}`);
    assert(squash(await page.locator('.dn-more').innerText()) === '+1 more', 'more button');
    await ctx.close();
  });

  for (const width of [360, 375, 390, 430]) {
    for (const scheme of ['light', 'dark']) {
      await check(`fits at ${width} px ${scheme}: no sideways scroll, buttons at least 44 px, readable`, async () => {
        const { ctx, page } = await openHome(width, scheme);
        await page.locator('.dn-more').click();
        const r = await page.evaluate(() => {
          const card = document.querySelector('.dn-card.lead');
          const box = card.getBoundingClientRect();
          const btns = [...document.querySelectorAll('.do-now .btn, .do-now .dn-more')].map((b) => {
            const bb = b.getBoundingClientRect();
            return { h: bb.height, w: bb.width, right: bb.right, text: b.textContent.trim() };
          });
          const text = getComputedStyle(document.querySelector('.dn-text'));
          const bg = getComputedStyle(card).backgroundColor;
          return { overflow: document.documentElement.scrollWidth - window.innerWidth, right: box.right, vw: window.innerWidth, btns, color: text.color, bg };
        });
        assert(r.overflow <= 0, `sideways scroll ${r.overflow}px`);
        assert(r.right <= r.vw, `card past the edge: ${r.right} > ${r.vw}`);
        for (const b of r.btns) {
          assert(b.h >= 44, `"${b.text}" is ${b.h}px tall`);
          assert(b.right <= r.vw, `"${b.text}" past the edge`);
        }
        assert(r.color !== r.bg, `text ${r.color} on ${r.bg}`);
        if (SHOTS && (width === 390 || width === 360)) await page.screenshot({ path: path.join(SHOTS, `do-now-${width}-${scheme}.png`), fullPage: false });
        await ctx.close();
      });
    }
  }

  await check('"+1 more" shows the night-before text, which opens Messages with no recipients', async () => {
    const { ctx, page } = await openHome();
    await page.locator('.dn-more').click();
    const night = page.locator('.dn-card[data-task="night"]');
    await night.waitFor();
    assert(squash(await night.locator('.dn-text').innerText()) === 'Tuesday: 3 players in, need a 4th.', 'night text');
    const href = await night.getByRole('link', { name: /Text the group/ }).getAttribute('href');
    assert(href.startsWith('sms:&body='), `href should have no numbers: ${href}`);
    assert(!/2485550/.test(href), 'a phone number is in the link');
    assert(/Need%201%20more%20for%20pickleball%20tomorrow/.test(href), `Need players text: ${decodeURIComponent(href)}`);
    // Tapping saves the mark (Messages itself can't open in a test browser).
    await page.evaluate(() => document.addEventListener('click', (e) => e.target.closest('a[href^="sms:"]') && e.preventDefault(), true));
    await night.getByRole('link', { name: /Text the group/ }).click();
    for (let i = 0; i < 20 && !(await dash()).taskMarks.includes(`${tue.id}:night_text`); i++) await page.waitForTimeout(150);
    assert((await dash()).taskMarks.includes(`${tue.id}:night_text`), 'mark not saved');
    await page.locator('.dn-more').waitFor({ state: 'detached' });
    await ctx.close();
  });

  await check('the checklist updates: Court canceled, then Cancel the session opens the cancel prompt', async () => {
    const { ctx, page } = await openHome();
    const card = page.locator('.dn-card.lead');
    const courtLink = card.getByRole('link', { name: /Cancel the court/ });
    assert((await courtLink.getAttribute('href')) === 'https://mobileapp.courtreserve.com/Online/Bookings/List/13765?type=1', 'CourtReserve cancel link');
    await card.getByRole('button', { name: 'Court canceled' }).click();
    await card.locator('.dn-step.done[data-step="court"]').waitFor();
    await card.locator('.dn-step.now[data-step="session"]').waitFor();
    await card.getByRole('button', { name: 'Cancel the session' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.waitFor();
    assert(/Cancel Tue, Nov 3\?/.test(await dialog.innerText()), 'cancel prompt');
    assert(await dialog.getByLabel('Reason (optional)').isVisible(), 'reason field');
    await ctx.close();
  });

  await check('Settings > Alerts: the Smart alerts switch and a TEST button', async () => {
    const { ctx, page } = await openHome();
    await page.getByRole('button', { name: 'Settings' }).click();
    await page.getByText('Alerts', { exact: true }).first().click();
    await page.getByText(/Smart alerts/).first().waitFor();
    assert(await page.locator('[data-smart-test]').isVisible(), 'TEST button');
    assert(/TEST/.test(await page.locator('[data-smart-test]').innerText()), 'labeled TEST');
    await ctx.close();
  });

  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
