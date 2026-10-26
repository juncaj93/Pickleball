/* Browser tests: drives the real app (Vite dev server + local SQLite API)
 * in Chromium with an iPhone-sized screen.
 *
 *   npm run test:e2e
 *
 * Against a deployed copy instead (it creates a group there, so only point
 * this at a throwaway test site, never the real one):
 *
 *   E2E_BASE_URL=https://example.pages.dev E2E_SETUP_TOKEN=... npm run test:e2e
 *
 * Needs Playwright with Chromium available (`npx playwright install chromium`
 * if it isn't already on your machine).
 */
const { spawn } = require('node:child_process');
const { rmSync, mkdirSync } = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const PORT = 5199;
const REMOTE = process.env.E2E_BASE_URL ? process.env.E2E_BASE_URL.replace(/\/$/, '') : null;
const BASE = REMOTE ?? `http://localhost:${PORT}`;
const SETUP_TOKEN = process.env.E2E_SETUP_TOKEN ?? 'e2e-setup-token-0123456789';
const PIN = '482913';
const SHOTS = path.join(__dirname, 'screenshots');

let passed = 0;
let failed = 0;
const failures = [];

async function check(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    failures.push(name);
    console.log(`  ✗ ${name}\n      ${String(err && err.message ? err.message : err).split('\n')[0]}`);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

/** Bottom tab bar button (card buttons can share the same label). */
const tab = (page, name) => page.getByRole('navigation', { name: 'Organizer sections' }).getByRole('button', { name: new RegExp(`^${name}`) });

async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`${BASE}/api/status`);
      if (res.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('dev server did not start');
}

async function main() {
  mkdirSync(path.join(ROOT, '.data'), { recursive: true });
  const dbFile = path.join(ROOT, '.data', 'e2e.sqlite');
  rmSync(dbFile, { force: true });
  rmSync(SHOTS, { recursive: true, force: true });
  mkdirSync(SHOTS, { recursive: true });

  let serverLog = '';
  const server = REMOTE
    ? null
    : spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
        cwd: ROOT,
        env: { ...process.env, DEV_DB: dbFile, SETUP_TOKEN },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
  server?.stdout.on('data', (d) => (serverLog += d));
  server?.stderr.on('data', (d) => (serverLog += d));

  const proxy = REMOTE && process.env.HTTPS_PROXY ? { proxy: { server: process.env.HTTPS_PROXY } } : {};
  const browser = await chromium.launch(proxy);
  const pageErrors = [];
  const phone = (width = 390) => ({
    viewport: { width, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  });
  async function newPage(width) {
    const ctx = await browser.newContext(phone(width));
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
    const page = await ctx.newPage();
    page.setDefaultTimeout(10000);
    page.on('pageerror', (e) => pageErrors.push(String(e)));
    page.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && pageErrors.push(m.text()));
    return page;
  }

  try {
    await waitForServer();
    const admin = await newPage();
    let playerLink = '';

    console.log('Setup');
    await check('landing page sends a new organizer to setup', async () => {
      await admin.goto(BASE);
      await admin.getByRole('button', { name: 'Set up the group' }).click();
      await admin.getByRole('heading', { name: 'Set up your group' }).waitFor();
    });

    await check('setup creates the group and shows the player link', async () => {
      await admin.getByLabel('Setup code').fill(SETUP_TOKEN);
      await admin.getByLabel('Group name').fill('Dink Dynasty');
      await admin.getByLabel('PIN', { exact: true }).fill(PIN);
      await admin.getByLabel('PIN again').fill(PIN);
      await admin.getByLabel('Your Venmo link (optional)').fill('https://venmo.com/u/organizer');
      const names = ['Alex', 'Blair', 'Casey', 'Devon', 'Emery', 'Frankie'];
      for (let i = 0; i < names.length; i++) {
        await admin.getByLabel(`Player ${i + 1} name`).fill(names[i]);
        await admin.getByLabel(`Player ${i + 1} phone`).fill(`313555010${i}`);
      }
      await admin.getByRole('button', { name: 'Create group' }).click();
      await admin.getByText('Share this link with your players').waitFor();
      playerLink = (await admin.locator('code.link').textContent()).trim();
      assert(/\/g\/[A-Za-z0-9_-]{20,}$/.test(playerLink), `unexpected link ${playerLink}`);
      await admin.getByText('never sends texts by itself').waitFor();
      await admin.screenshot({ path: path.join(SHOTS, 'setup-done.png'), fullPage: true });
    });

    await check('organizer dashboard says texts are not sent automatically', async () => {
      await admin.getByRole('button', { name: 'Go to the organizer dashboard' }).click();
      await admin.getByText('Texts are never sent automatically').first().waitFor();
      await admin.getByText('Alerts only appear when you open this page').waitFor();
      await admin.screenshot({ path: path.join(SHOTS, 'admin-todo.png'), fullPage: true });
    });

    console.log('Players');
    const players = {};
    for (const name of ['Alex', 'Blair', 'Casey', 'Devon', 'Emery']) {
      await check(`${name} picks a name and signs up`, async () => {
        const p = await newPage();
        players[name] = p;
        await p.goto(playerLink);
        await p.getByRole('heading', { name: 'Who are you?' }).waitFor();
        await p.getByRole('button', { name, exact: true }).click();
        await p.getByText(`Playing as`).waitFor();
        const first = p.locator('article').first();
        if (name === 'Emery') {
          await first.getByRole('button', { name: 'Join waitlist' }).click();
          await first.getByText("You're #1 on the waitlist").waitFor();
        } else {
          await first.getByRole('button', { name: 'Claim spot' }).click();
          await first.getByText("You're in").first().waitFor();
        }
      });
    }

    await check('player page shows four named spots and the waitlist', async () => {
      const first = players.Emery.locator('article').first();
      await players.Emery.reload();
      await first.getByText('Full').waitFor();
      for (const n of ['Alex', 'Blair', 'Casey', 'Devon']) await first.locator('.spot', { hasText: n }).waitFor();
      await first.getByText('1. Emery').waitFor();
      await players.Emery.screenshot({ path: path.join(SHOTS, 'player-home.png'), fullPage: true });
    });

    await check('players never see phone numbers or the PIN', async () => {
      const html = await players.Alex.content();
      assert(!html.includes('3135550'), 'phone number leaked into player page');
      assert(!html.includes(PIN), 'PIN leaked');
    });

    console.log('Booking & payments');
    await check('organizer records a booking with cost and deadline', async () => {
      await admin.reload();
      await tab(admin, 'Sessions').click();
      const card = admin.locator('article').first();
      await card.getByRole('button', { name: 'Edit booking' }).click();
      const sheet = admin.locator('dialog[open]');
      await sheet.getByRole('button', { name: 'Booked', exact: true }).click();
      await sheet.getByLabel('Venue', { exact: true }).fill('Rec Center Court 2');
      await sheet.getByLabel('Reservation number').fill('R-1042');
      await sheet.getByLabel('Actual court cost').fill('45.01');
      await sheet.getByRole('button', { name: /Fill in 12 hours before start/ }).click();
      await sheet.getByText(/Deadline: .*8:00 AM E[DS]T/).waitFor();
      await admin.screenshot({ path: path.join(SHOTS, 'admin-booking.png') });
      await sheet.getByRole('button', { name: 'Save booking' }).click();
      await admin.locator('dialog[open]').waitFor({ state: 'detached' }).catch(() => {});
      await card.getByText('Rec Center Court 2').waitFor();
      await card.getByText(/Cancel by/).waitFor();
    });

    await check('cost splits into shares that add up ($45.01 → 11.26 + 3×11.25)', async () => {
      const card = admin.locator('article').first();
      await card.getByRole('button', { name: 'Payments' }).click();
      const sheet = admin.locator('dialog[open]');
      await sheet.getByText('Share $11.26').waitFor();
      assert((await sheet.getByText('Share $11.25').count()) === 3, 'expected three $11.25 shares');
    });

    await check('mark paid updates only that player', async () => {
      const sheet = admin.locator('dialog[open]');
      const alexRow = sheet.locator('li', { hasText: 'Alex' }).first();
      await alexRow.getByRole('button', { name: 'Mark paid' }).click();
      await sheet.getByText('1/4 paid').waitFor();
      await alexRow.getByText('Paid', { exact: true }).waitFor();
      assert((await sheet.getByRole('button', { name: 'Mark paid' }).count()) === 3, 'other players changed');
    });

    await check('payment reminder is a draft, not a sent text', async () => {
      const sheet = admin.locator('dialog[open]');
      const blairRow = sheet.locator('li', { hasText: 'Blair' }).first();
      await blairRow.getByRole('button', { name: 'Payment reminder' }).click();
      const draft = blairRow.locator('.draft');
      await draft.getByText('Draft ready').first().waitFor();
      await draft.getByText(/Hey Blair! You owe \$11\.25 for pickleball/).waitFor();
      const href = await draft.getByRole('link', { name: 'Open in Messages' }).getAttribute('href');
      assert(href.startsWith('sms:+13135550101&body='), `bad sms link ${href}`);
      await admin.screenshot({ path: path.join(SHOTS, 'admin-payments.png') });
    });

    await check('copy message fallback works', async () => {
      const draft = admin.locator('dialog[open] .draft').first();
      await draft.getByRole('button', { name: 'Copy message' }).click();
      await admin.locator('.toast', { hasText: 'Message copied' }).waitFor();
      const clip = await admin.evaluate(() => navigator.clipboard.readText());
      assert(clip.includes('You owe $11.25'), `clipboard was ${clip}`);
    });

    await check('opening the composer does not mark it sent', async () => {
      const draft = admin.locator('dialog[open] .draft').first();
      await draft.evaluate((el) => {
        // Don't let the test browser try to launch an SMS app.
        el.querySelector('a[href^="sms:"]').addEventListener('click', (e) => e.preventDefault());
      });
      await draft.getByRole('link', { name: 'Open in Messages' }).click();
      await draft.getByText('Not sent until you press send there').waitFor();
      assert((await draft.getByText('Marked sent').count()) === 0, 'claimed sent');
      await draft.getByRole('button', { name: 'I sent it' }).click();
      await draft.getByText('Marked sent').waitFor();
      await admin.keyboard.press('Escape');
    });

    await check('player sees only their own share and status', async () => {
      await players.Blair.reload();
      const first = players.Blair.locator('article').first();
      await first.getByText('$11.25').waitFor();
      await first.getByText('Unpaid', { exact: true }).waitFor();
      assert((await first.getByText('Paid', { exact: true }).count()) === 0, "saw someone else's paid status");
    });

    console.log('Withdraw & substitutes');
    await check('withdrawing asks for confirmation, then frees the spot', async () => {
      const first = players.Blair.locator('article').first();
      await first.getByRole('button', { name: 'Withdraw' }).click();
      const dlg = players.Blair.locator('dialog[open]');
      await dlg.getByText('Withdraw from this session?').waitFor();
      await dlg.getByRole('button', { name: 'Withdraw' }).click();
      await first.getByText('1 open').waitFor();
    });

    let links = {};
    await check('organizer prepares substitute invitations', async () => {
      await admin.reload();
      await tab(admin, 'Sessions').click();
      const card = admin.locator('article').first();
      await card.getByRole('button', { name: 'Invite substitutes' }).click();
      const sheet = admin.locator('dialog[open]');
      await sheet.getByText('Emery').first().waitFor();
      await sheet.getByRole('button', { name: /Prepare invitations/ }).click();
      await sheet.locator('.draft').first().waitFor();
      for (const d of await sheet.locator('.draft').all()) {
        const who = (await d.locator('strong').first().textContent()).trim();
        const body = await d.locator('.bubble').textContent();
        links[who] = body.match(/https?:\/\/\S+\/t\/[A-Za-z0-9_-]+/)[0];
      }
      assert(links.Emery && links.Frankie, `missing links: ${Object.keys(links)}`);
      assert(links.Emery !== links.Frankie, 'links must be personal');
      await admin.screenshot({ path: path.join(SHOTS, 'admin-invite.png') });
    });

    await check('first claimer gets the spot', async () => {
      const p = await newPage();
      await p.goto(links.Emery);
      await p.getByRole('button', { name: 'Claim this spot' }).click();
      await p.getByText("You're in!").waitFor();
      await p.screenshot({ path: path.join(SHOTS, 'claim-success.png') });
    });

    await check('later claimer is told the spot is gone', async () => {
      const p = await newPage();
      await p.goto(links.Frankie);
      await p.getByText('No spots are open right now.').waitFor();
      assert((await p.getByRole('button', { name: 'Claim this spot' }).count()) === 0, 'claim button still shown');
    });

    await check('invite sheet notices the spot was filled', async () => {
      await admin.locator('dialog[open]').getByText('Spot filled').waitFor({ timeout: 15000 });
      await admin.keyboard.press('Escape');
    });

    console.log('Cancel');
    await check('canceling needs confirmation and warns it does not cancel the court', async () => {
      const card = admin.locator('article').nth(1);
      await card.getByRole('button', { name: 'Cancel session' }).click();
      const dlg = admin.locator('dialog[open]');
      await dlg.getByText('This does not cancel your court').waitFor();
      await dlg.getByRole('button', { name: 'Go back' }).click();
      await card.getByRole('button', { name: 'Cancel session' }).waitFor();
      assert((await card.getByText('Canceled', { exact: true }).count()) === 0, 'canceled without confirming');
      await card.getByRole('button', { name: 'Cancel session' }).click();
      await admin.locator('dialog[open]').getByRole('button', { name: 'Cancel session' }).click();
      await card.getByText('Canceled', { exact: true }).first().waitFor();
    });

    console.log('Accessibility & layout');
    await check('every button and link has an accessible name', async () => {
      for (const p of [admin, players.Alex]) {
        const unnamed = await p.evaluate(() =>
          [...document.querySelectorAll('button, a[href]')]
            .filter((el) => el.offsetParent !== null)
            .filter((el) => !(el.getAttribute('aria-label') || el.textContent.trim()))
            .map((el) => el.outerHTML.slice(0, 80)),
        );
        assert(unnamed.length === 0, `unnamed controls: ${unnamed.join(' | ')}`);
      }
    });

    await check('touch targets are at least 44px tall', async () => {
      for (const p of [admin, players.Alex]) {
        const small = await p.evaluate(() =>
          [...document.querySelectorAll('.btn, .tabbar button, .icon-btn, .segmented button')]
            .filter((el) => el.offsetParent !== null)
            .filter((el) => el.getBoundingClientRect().height < 43.5)
            .map((el) => el.textContent.trim()),
        );
        assert(small.length === 0, `too small: ${small.join(', ')}`);
      }
    });

    await check('keyboard: Tab reaches controls with a visible focus ring, Escape closes dialogs', async () => {
      await tab(admin, 'Players').click();
      await admin.keyboard.press('Tab');
      const outline = await admin.evaluate(() => getComputedStyle(document.activeElement).outlineStyle);
      assert(outline !== 'none', 'no focus outline');
      await admin.getByRole('button', { name: 'Edit Alex' }).focus();
      await admin.keyboard.press('Enter');
      await admin.locator('dialog[open]').waitFor();
      await admin.keyboard.press('Escape');
      await admin.locator('dialog[open]').waitFor({ state: 'detached' });
    });

    await check('times show in Eastern 12-hour format, never UTC', async () => {
      await tab(admin, 'Sessions').click();
      const text = await admin.locator('main').innerText();
      assert(/8:00–10:00 PM E[DS]T/.test(text), 'missing Eastern time range');
      assert(!/UTC|GMT|\d{2}:\d{2}:\d{2}/.test(text), 'found UTC or 24h time');
    });

    for (const width of [360, 375, 390, 430]) {
      await check(`no sideways scrolling at ${width}px (player, organizer, link page)`, async () => {
        const p = await newPage(width);
        const urls = [playerLink, `${BASE}/admin`, links.Frankie];
        for (const url of urls) {
          await p.goto(url);
          await p.waitForLoadState('networkidle');
          const overflow = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
          assert(overflow <= 0, `${url} overflows by ${overflow}px`);
        }
        await p.goto(playerLink);
        await p.getByRole('button', { name: 'Alex', exact: true }).click();
        await p.locator('article').first().waitFor();
        const overflow = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        assert(overflow <= 0, `player home overflows by ${overflow}px`);
        await p.screenshot({ path: path.join(SHOTS, `player-${width}.png`), fullPage: false });
      });
    }

    await check('organizer pages fit at 360px', async () => {
      const ctx = admin.context();
      const p = await ctx.newPage();
      await p.setViewportSize({ width: 360, height: 780 });
      await p.goto(`${BASE}/admin`);
      for (const name of ['To do', 'Sessions', 'Payments', 'Players', 'Settings']) {
        await tab(p, name).click();
        const overflow = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        assert(overflow <= 0, `${name} overflows by ${overflow}px`);
      }
      await tab(p, 'Sessions').click();
      await p.screenshot({ path: path.join(SHOTS, 'admin-sessions-360.png'), fullPage: true });
    });

    await check('bad links show a clear error state', async () => {
      const p = await newPage();
      await p.goto(`${BASE}/t/${'x'.repeat(43)}`);
      await p.getByText("This link doesn't work").waitFor();
      await p.goto(`${BASE}/g/${'y'.repeat(24)}`);
      await p.getByText("This group link isn't valid").waitFor();
    });

    await check('wrong PIN is rejected in the UI', async () => {
      const p = await newPage();
      await p.goto(`${BASE}/admin`);
      await p.getByLabel('Organizer PIN').fill('000000');
      await p.getByRole('button', { name: 'Sign in' }).click();
      await p.getByText('That PIN is not right.').waitFor();
    });

    await check('no JavaScript errors in the browser', async () => {
      assert(pageErrors.length === 0, pageErrors.join('\n'));
    });
  } finally {
    await browser.close();
    server?.kill();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) {
    console.log('Failed:', failures.join('; '));
    if (process.env.E2E_DEBUG) console.log(serverLog);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
