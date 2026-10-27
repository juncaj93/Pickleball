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
/** Session cards on the organizer Home (attention cards above them are articles too). */
const sessionCards = (page) => page.locator('section[aria-labelledby="sessions-title"] article');

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
        // Own process group, so stopping it also stops the Vite process npx starts.
        detached: true,
      });
  const stopServer = () => {
    if (!server) return;
    try {
      process.kill(-server.pid, 'SIGTERM');
    } catch {
      /* already gone */
    }
  };
  process.on('exit', stopServer);
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
  async function newPage(width, colorScheme = 'light') {
    const ctx = await browser.newContext({ ...phone(width), colorScheme });
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
      await admin.screenshot({ path: path.join(SHOTS, 'setup-done.png'), fullPage: true });
    });

    await check('first visit shows one small dismissible notice, and no blue boxes', async () => {
      await admin.getByRole('button', { name: 'Go to the organizer dashboard' }).click();
      const note = admin.getByRole('note');
      await note.getByText('never sends texts or alerts by itself').waitFor();
      assert((await admin.getByText('Texts are never sent automatically').count()) === 0, 'old blue box still shown');
      assert((await admin.getByText('Times shown in Eastern time').count()) === 0, 'old header line still shown');
      await admin.screenshot({ path: path.join(SHOTS, 'admin-home.png'), fullPage: true });
      await note.getByRole('button', { name: 'Dismiss' }).click();
      await admin.reload();
      await tab(admin, 'Home').waitFor();
      assert((await admin.getByRole('note').count()) === 0, 'notice came back after dismissing');
    });

    await check('floating tab pill has exactly Home, Players, Settings', async () => {
      const nav = admin.getByRole('navigation', { name: 'Organizer sections' });
      const labels = (await nav.getByRole('button').allInnerTexts()).map((t) => t.trim().split('\n')[0].trim());
      assert(JSON.stringify(labels) === JSON.stringify(['Home', 'Players', 'Settings']), `tabs were ${labels}`);
      const box = await nav.boundingBox();
      const vw = admin.viewportSize().width;
      assert(box.x > 8 && box.x + box.width < vw - 8, 'pill should float clear of the screen edges');
      const radius = await nav.evaluate((el) => parseFloat(getComputedStyle(el).borderTopLeftRadius));
      assert(radius >= 24, 'pill should be fully rounded');
      assert((await nav.locator('svg').count()) === 3, 'expected three drawn icons');
      const bg = await admin.evaluate(() => [getComputedStyle(document.documentElement).backgroundColor, getComputedStyle(document.body).backgroundColor]);
      assert(bg[0] === bg[1] && bg[0] !== 'rgba(0, 0, 0, 0)', `page background not set on html: ${bg}`);
    });

    await check('Settings: check-in hours field clears, retypes, and is checked on Save', async () => {
      await tab(admin, 'Settings').click();
      const field = admin.getByLabel(/Day-before check-in/);
      assert((await field.getAttribute('inputmode')) === 'numeric', 'should show the number keypad');
      await field.fill('');
      assert((await field.inputValue()) === '', 'field should stay empty, not jump to 0');
      await field.pressSequentially('24');
      assert((await field.inputValue()) === '24', `typing gave ${await field.inputValue()}`);
      await field.fill('');
      await admin.getByRole('button', { name: 'Save settings' }).click();
      await admin.getByText('Enter a whole number from 1 to 72.').waitFor();
      await field.fill('24');
      await admin.getByLabel('Your name').fill('Robin');
      await admin.getByRole('button', { name: 'Save settings' }).click();
      await admin.locator('.toast', { hasText: 'Settings saved' }).waitFor();
      assert((await admin.getByText('Warn before cancellation deadline').count()) === 0, 'old setting still shown');
      assert((await admin.getByLabel(/Plan sessions ahead/).isVisible()) === false, 'Advanced should start collapsed');
      await admin.getByText('Advanced').click();
      await admin.getByLabel(/Plan sessions ahead/).waitFor();
    });

    await check('Settings: dark mode follows the phone, or Light / Dark', async () => {
      const bgOf = () => admin.evaluate(() => getComputedStyle(document.body).backgroundColor);
      const light = await bgOf();
      await admin.getByRole('button', { name: 'Dark', exact: true }).click();
      const dark = await bgOf();
      assert(light !== dark, 'Dark did not change the colors');
      await admin.reload();
      await tab(admin, 'Home').waitFor();
      assert((await bgOf()) === dark, 'Dark was not remembered after reload');
      await admin.screenshot({ path: path.join(SHOTS, 'admin-dark.png'), fullPage: true });
      await tab(admin, 'Settings').click();
      await admin.getByRole('button', { name: 'System', exact: true }).click();
      assert((await bgOf()) === light, 'System should follow the (light) phone setting');
      await tab(admin, 'Home').click();
    });

    await check('Players screen formats phone numbers like (313) 555-0100', async () => {
      await tab(admin, 'Players').click();
      await admin.getByText('(313) 555-0100').waitFor();
      await tab(admin, 'Home').click();
    });

    console.log('Players');
    const players = {};
    const firstCard = (p) => p.locator('article').first();
    async function openAs(name) {
      const p = await newPage();
      players[name] = p;
      await p.goto(playerLink);
      await p.getByRole('heading', { name: 'Who are you?' }).waitFor();
      await p.getByRole('button', { name, exact: true }).click();
      await p.getByRole('heading', { name: `Welcome, ${name}` }).waitFor();
      return p;
    }
    for (const name of ['Alex', 'Blair', 'Casey', 'Devon']) {
      await check(`${name} picks a name and taps "I'm in"`, async () => {
        const p = await openAs(name);
        await firstCard(p).getByRole('button', { name: "I'm in" }).click();
        await firstCard(p).getByText("You're in", { exact: true }).waitFor();
      });
    }

    await check('the 5th person joins the waitlist as #1', async () => {
      const p = await openAs('Emery');
      await firstCard(p).getByRole('button', { name: 'Join waitlist' }).click();
      await firstCard(p).getByText('#1 on waitlist').waitFor();
      await firstCard(p).getByText('4 going · 1 more makes 6').waitFor();
      for (const n of ['Alex', 'Blair', 'Casey', 'Devon']) await firstCard(p).locator('.going li', { hasText: n }).waitFor();
      await firstCard(p).getByText('1. Emery').waitFor();
      await p.screenshot({ path: path.join(SHOTS, 'player-waitlist.png'), fullPage: true });
    });

    await check('the phone remembers the name: next visit says "Welcome, Alex" with "Not you?"', async () => {
      const p = players.Alex;
      await p.goto(BASE);
      await p.goto(playerLink);
      await p.getByRole('heading', { name: 'Welcome, Alex' }).waitFor();
      await p.getByRole('button', { name: 'Not you?' }).waitFor();
      assert((await p.getByRole('heading', { name: 'Who are you?' }).count()) === 0, 'asked for the name again');
    });

    await check('player Home is one button per session, no extra screens', async () => {
      const card = firstCard(players.Alex);
      const buttons = (await card.getByRole('button').allInnerTexts()).map((t) => t.trim());
      const big = buttons.filter((t) => ["I'm in", "I'm out", 'Join waitlist'].includes(t));
      assert(big.length === 1, `expected one big button, got ${buttons}`);
    });

    await check('players never see phone numbers or the PIN', async () => {
      const html = await players.Alex.content();
      assert(!html.includes('3135550') && !html.includes('555-01'), 'phone number leaked into player page');
      assert(!html.includes(PIN), 'PIN leaked');
    });

    console.log('4, then waitlist, then 6');
    await check('a 6th person brings both in: "Good news, we now have 6"', async () => {
      const p = await openAs('Frankie');
      await firstCard(p).getByRole('button', { name: "I'm in" }).click();
      await p.locator('.toast', { hasText: 'Good news, we now have 6' }).waitFor();
      await firstCard(p).getByText("You're in", { exact: true }).waitFor();
      await players.Emery.reload();
      await firstCard(players.Emery).getByText("Good news, we now have 6, an even number, so you're in.").waitFor();
      await players.Emery.screenshot({ path: path.join(SHOTS, 'player-good-news.png'), fullPage: true });
    });

    await check("organizer gets a text draft for each person moved in", async () => {
      await admin.reload();
      const card = admin.getByRole('article', { name: /Tell them they're in/ });
      await card.getByText(/Good news, Emery! We now have 6/).waitFor();
      await card.getByText(/Good news, Frankie! We now have 6/).waitFor();
      await card.getByRole('link', { name: 'Open in Messages' }).first().waitFor();
      await card.getByRole('button', { name: 'I told Emery' }).click();
      await admin.locator('.toast', { hasText: 'Done' }).waitFor();
      await card.getByText(/Good news, Emery!/).waitFor({ state: 'detached' });
      await card.getByText(/Good news, Frankie!/).waitFor();
    });

    await check('6 going: refund card says $14 each, refund $5, with a Refunded checkbox per person', async () => {
      const card = admin.getByRole('article', { name: /6 going\. Everyone paid \$14\. Refund \$5 each/ });
      await card.waitFor();
      assert((await card.getByRole('checkbox').count()) === 6, 'expected six checkboxes');
      await card.getByRole('checkbox', { name: /Casey/ }).check();
      await admin.locator('.toast', { hasText: 'Casey refunded' }).waitFor();
      await admin.reload();
      assert(await admin.getByRole('article', { name: /Refund \$5 each/ }).getByRole('checkbox', { name: /Casey/ }).isChecked(), 'refund tick not saved');
      await admin.screenshot({ path: path.join(SHOTS, 'admin-refunds.png'), fullPage: true });
      await players.Casey.reload();
      await firstCard(players.Casey).getByText('6 playing, so Robin refunds you $5.').waitFor();
    });

    await check('someone drops out of 6: "5 going, need 4 or 6", nothing moves until the organizer picks', async () => {
      const card = firstCard(players.Casey);
      await card.getByRole('button', { name: "I'm out" }).click();
      await players.Casey.locator('dialog[open]').getByRole('button', { name: "I'm out" }).click();
      await card.getByRole('button', { name: /I'm in|Join waitlist/ }).waitFor();
      await admin.reload();
      const five = admin.getByRole('article', { name: /5 going, need 4 or 6/ });
      await five.getByRole('button', { name: /Back to 4: move .* to the waitlist/ }).waitFor();
      await five.getByRole('button', { name: 'Invite someone to make 6' }).waitFor();
      await admin.screenshot({ path: path.join(SHOTS, 'admin-five.png'), fullPage: true });
      await five.getByRole('button', { name: /Back to 4/ }).click();
      await admin.locator('.toast', { hasText: '4 going' }).waitFor();
      await admin.getByRole('article', { name: /5 going/ }).waitFor({ state: 'detached' });
    });

    console.log('Booking & payments');
    await check('Book a court: CourtReserve button, then enter the details', async () => {
      const courts = admin.getByRole('article', { name: 'Courts to book' });
      const link = courts.getByRole('link', { name: 'Book on CourtReserve' });
      assert((await link.getAttribute('href')) === 'https://app.courtreserve.com/Online/PublicBookings/13765/Landing', 'wrong CourtReserve link');
      const card = sessionCards(admin).first();
      await card.getByRole('button', { name: 'Edit booking' }).click();
      const sheet = admin.locator('dialog[open]');
      await sheet.getByRole('button', { name: 'Booked', exact: true }).click();
      await sheet.getByLabel(/Reservation number/).fill('R-1042');
      await sheet.getByText(/Deadline: .*8:00 AM E[DS]T/).waitFor();
      await admin.screenshot({ path: path.join(SHOTS, 'admin-booking.png') });
      await sheet.getByRole('button', { name: 'Save booking' }).click();
      await admin.locator('dialog[open]').waitFor({ state: 'detached' }).catch(() => {});
      await card.getByText('#R-1042').waitFor();
      await card.getByText(/Cancel by/).waitFor();
    });

    await check('everyone confirmed owes a flat $14; mark paid updates only that player', async () => {
      const card = sessionCards(admin).first();
      await card.getByRole('button', { name: 'Money' }).click();
      const sheet = admin.locator('dialog[open]');
      assert((await sheet.getByText('owes $14').count()) === 4, 'expected four people owing $14');
      const alexRow = sheet.locator('li', { hasText: 'Alex' }).first();
      await alexRow.getByRole('button', { name: 'Mark paid' }).click();
      await sheet.getByText('1/4 paid').waitFor();
      assert((await sheet.getByRole('button', { name: 'Mark paid' }).count()) === 3, 'other players changed');
    });

    await check('payment reminder is a draft, not a sent text', async () => {
      const sheet = admin.locator('dialog[open]');
      const blairRow = sheet.locator('li', { hasText: 'Blair' }).first();
      await blairRow.getByRole('button', { name: 'Payment reminder' }).click();
      const draft = blairRow.locator('.draft');
      await draft.getByText('Draft ready').first().waitFor();
      await draft.getByText(/Hey Blair! You owe \$14 for pickleball/).waitFor();
      const href = await draft.getByRole('link', { name: 'Open in Messages' }).getAttribute('href');
      assert(href.startsWith('sms:+13135550101&body='), `bad sms link ${href}`);
    });

    await check('copy message fallback works', async () => {
      const draft = admin.locator('dialog[open] .draft').first();
      await draft.getByRole('button', { name: 'Copy message' }).click();
      await admin.locator('.toast', { hasText: 'Message copied' }).waitFor();
      const clip = await admin.evaluate(() => navigator.clipboard.readText());
      assert(clip.includes('You owe $14'), `clipboard was ${clip}`);
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

    await check('player sees "You owe $14" with a Pay with Venmo button, amount filled in', async () => {
      const p = players.Blair;
      await p.reload();
      const owe = p.getByRole('region', { name: 'Payments' });
      await owe.getByText(/You owe \$14 for /).first().waitFor();
      const href = await owe.getByRole('link', { name: 'Pay $14 with Venmo' }).first().getAttribute('href');
      assert(href.startsWith('https://venmo.com/organizer?txn=pay&amount=14.00&note=Pickleball'), `bad Venmo link ${href}`);
      assert((await owe.getByText(/may not have marked this paid/).count()) === 0, 'unpaid reminder shown too early');
      await p.screenshot({ path: path.join(SHOTS, 'player-owe.png'), fullPage: true });
      // Alex is marked paid for the first session, so it isn't in Alex's list.
      await players.Alex.reload();
      const blairOwes = await owe.innerText();
      const alexOwes = (await players.Alex.getByRole('region', { name: 'Payments' }).count())
        ? await players.Alex.getByRole('region', { name: 'Payments' }).innerText()
        : '';
      const firstLine = blairOwes.split('\n').find((l) => l.startsWith('You owe'));
      assert(!alexOwes.includes(firstLine), `Alex still owes for the session marked paid: ${firstLine}`);
    });

    await check('Add to Calendar downloads a Pickleball event at 8:00–10:00 PM', async () => {
      const link = firstCard(players.Blair).getByRole('link', { name: 'Add to Calendar' });
      const href = await link.getAttribute('href');
      assert(/^\/api\/sessions\/[0-9a-f-]{36}\/calendar\.ics$/.test(href), `bad calendar link ${href}`);
      const res = await players.Blair.request.get(BASE + href);
      assert(res.headers()['content-type'].includes('text/calendar'), 'not a calendar file');
      const ics = await res.text();
      assert(ics.includes('SUMMARY:Pickleball') && ics.includes('LOCATION:Northville Pickleball Club'), 'wrong event');
      assert(/DTSTART:\d{8}T(00|01)0000Z/.test(ics), 'event should start at 8:00 PM Eastern');
    });

    console.log('Usual days & suggestions');
    await check('organizer sets usual days and Regular / Occasional on the Players screen', async () => {
      await tab(admin, 'Players').click();
      await admin.getByRole('button', { name: 'Edit Devon' }).click();
      const sheet = admin.locator('dialog[open]');
      await sheet.getByRole('group', { name: 'Usual days' }).getByRole('button', { name: 'Tue' }).click();
      await sheet.getByRole('group', { name: 'Usual days' }).getByRole('button', { name: 'Thu' }).click();
      await sheet.getByRole('button', { name: 'Save' }).click();
      await admin.locator('dialog[open]').waitFor({ state: 'detached' }).catch(() => {});
      await admin.locator('li', { hasText: 'Devon' }).getByText('Tue & Thu').waitFor();
      await admin.getByRole('button', { name: 'Add a person' }).click();
      const add = admin.locator('dialog[open]');
      await add.getByLabel('Name', { exact: true }).fill('Ryan');
      await add.getByRole('button', { name: 'Occasional' }).click();
      await add.getByRole('button', { name: 'Save' }).click();
      await admin.locator('li', { hasText: 'Ryan' }).getByText('Occasional').waitFor();
      await tab(admin, 'Home').click();
    });

    await check('a regular gets "Want in on ...? Yes / No"; Yes shows "You\'re in" and Venmo', async () => {
      const p = players.Devon;
      await p.reload();
      const card = p.getByRole('region', { name: /Want in on (Tuesday|Thursday)\?/ });
      await card.waitFor();
      await p.screenshot({ path: path.join(SHOTS, 'player-suggestion.png'), fullPage: true });
      await card.getByRole('button', { name: 'Yes' }).click();
      const answer = p.getByRole('region', { name: 'Your answer' });
      await answer.getByRole('heading', { name: /You're in|on the waitlist/ }).waitFor();
      if ((await answer.getByRole('heading', { name: "You're in" }).count()) > 0) {
        await answer.getByRole('link', { name: 'Pay $14 with Venmo' }).waitFor();
      }
      await answer.getByRole('button', { name: 'Done' }).click();
      await answer.waitFor({ state: 'detached' });
    });

    await check('tapping No hides the suggestion', async () => {
      const p = players.Devon;
      const card = p.getByRole('region', { name: /Want in on/ });
      if ((await card.count()) === 0) return; // nothing else unanswered within 8 days
      const before = await card.innerText();
      await card.getByRole('button', { name: 'No' }).click();
      await p.waitForFunction((b) => {
        const el = [...document.querySelectorAll('section')].find((x) => x.textContent.startsWith('Want in on'));
        return !el || el.innerText !== b;
      }, before);
    });

    await check('occasional people get no suggestions', async () => {
      const p = await openAs('Ryan');
      await p.locator('article').first().waitFor();
      assert((await p.getByRole('region', { name: /Want in on/ }).count()) === 0, 'occasional player got a suggestion');
    });

    console.log('View as');
    await check('"View as..." shows the player\'s screen with a banner, and taps really happen', async () => {
      await admin.reload();
      await admin.getByRole('button', { name: 'View as…' }).click();
      await admin.locator('dialog[open]').getByRole('button', { name: 'Blair', exact: true }).click();
      await admin.getByRole('status').getByText('Viewing as').waitFor();
      await admin.getByRole('heading', { name: 'Welcome, Blair' }).waitFor();
      assert((await admin.getByRole('button', { name: 'Not you?' }).count()) === 0, 'Not you? should be hidden');
      await admin.screenshot({ path: path.join(SHOTS, 'admin-view-as.png'), fullPage: true });
      const second = admin.locator('article').nth(1);
      await second.getByRole('button', { name: "I'm in" }).click();
      await second.getByText("You're in", { exact: true }).waitFor();
      await admin.getByRole('button', { name: 'Exit' }).click();
      await tab(admin, 'Home').waitFor();
      await players.Blair.reload();
      await players.Blair.locator('article').nth(1).getByText("You're in", { exact: true }).waitFor();
      await tab(admin, 'Settings').click();
      await admin.getByText('As player: joined').first().waitFor();
      await tab(admin, 'Home').click();
    });

    console.log('Substitutes');
    let links = {};
    await check('organizer prepares invitations when a spot is open', async () => {
      // Fill the second session up to 3 (Blair, plus Devon if the suggestion put him in).
      for (const name of ['Alex', 'Casey']) {
        const card = players[name].locator('article').nth(1);
        await players[name].reload();
        if ((await card.locator('p', { hasText: /^\d going/ }).innerText()).startsWith('3 going')) break;
        await card.getByRole('button', { name: "I'm in" }).click();
        await card.getByText("You're in", { exact: true }).waitFor();
      }
      await admin.reload();
      const card = sessionCards(admin).nth(1);
      await card.getByRole('button', { name: 'Invite substitutes' }).click();
      const sheet = admin.locator('dialog[open]');
      await sheet.getByText('Frankie').first().waitFor();
      await sheet.getByRole('button', { name: /Prepare invitations/ }).click();
      await sheet.locator('.draft').first().waitFor();
      for (const d of await sheet.locator('.draft').all()) {
        const who = (await d.locator('strong').first().textContent()).trim();
        const body = await d.locator('.bubble').textContent();
        links[who] = body.match(/https?:\/\/\S+\/t\/[A-Za-z0-9_-]+/)[0];
      }
      assert(links.Emery && links.Frankie, `missing links: ${Object.keys(links)}`);
      assert(links.Emery !== links.Frankie, 'links must be personal');
    });

    await check('first claimer gets the spot', async () => {
      const p = await newPage();
      await p.goto(links.Frankie);
      await p.getByRole('button', { name: 'Claim this spot' }).click();
      await p.getByText("You're in!").waitFor();
    });

    await check('later claimer is told the spot is gone', async () => {
      const p = await newPage();
      await p.goto(links.Emery);
      await p.getByText('No spots are open right now.').waitFor();
      assert((await p.getByRole('button', { name: 'Claim this spot' }).count()) === 0, 'claim button still shown');
    });

    await check('invite sheet notices the spot was filled', async () => {
      await admin.locator('dialog[open]').getByText('Spot filled').waitFor({ timeout: 15000 });
      await admin.keyboard.press('Escape');
    });

    console.log('Reschedule & cancel');
    await check('organizer can move a session to a new time', async () => {
      const card = sessionCards(admin).first();
      await card.getByRole('button', { name: 'Reschedule' }).first().click();
      const sheet = admin.locator('dialog[open]');
      await sheet.getByLabel('Start').fill('19:30');
      await sheet.getByText(/New time: .*7:30–10:00 PM E[DS]T/).waitFor();
      await sheet.getByRole('button', { name: 'Move session' }).click();
      await admin.locator('dialog[open]').waitFor({ state: 'detached' }).catch(() => {});
      await card.getByText(/7:30–10:00 PM E[DS]T/).waitFor();
    });

    await check('canceling needs confirmation and warns it does not cancel the court', async () => {
      const card = sessionCards(admin).nth(1);
      await card.getByRole('button', { name: 'Show actions' }).click().catch(() => {});
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
      await tab(admin, 'Home').click();
      const text = await admin.locator('main').innerText();
      assert(/8:00–10:00 PM E[DS]T/.test(text), 'missing Eastern time range');
      assert(!/UTC|GMT|\d{2}:\d{2}:\d{2}/.test(text), 'found UTC or 24h time');
    });

    for (const [width, scheme] of [[360, 'light'], [375, 'dark'], [390, 'light'], [430, 'dark'], [360, 'dark'], [430, 'light']]) {
      await check(`no sideways scrolling at ${width}px in ${scheme} mode (player, organizer, link page)`, async () => {
        const p = await newPage(width, scheme);
        const urls = [playerLink, `${BASE}/admin`, links.Emery];
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
        await p.screenshot({ path: path.join(SHOTS, `player-${width}-${scheme}.png`), fullPage: false });
      });
    }

    await check('organizer pages fit at 360px', async () => {
      const ctx = admin.context();
      const p = await ctx.newPage();
      await p.setViewportSize({ width: 360, height: 780 });
      await p.goto(`${BASE}/admin`);
      for (const name of ['Home', 'Players', 'Settings']) {
        await tab(p, name).click();
        const overflow = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        assert(overflow <= 0, `${name} overflows by ${overflow}px`);
      }
      await tab(p, 'Home').click();
      await p.screenshot({ path: path.join(SHOTS, 'admin-home-360.png'), fullPage: true });
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
    stopServer();
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
