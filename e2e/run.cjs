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
/** Open a session card's "More" buttons (Money, Texts, Reschedule, Invite, Cancel). */
async function more(card) {
  const btn = card.getByRole('button', { name: 'More', exact: true });
  const less = card.getByRole('button', { name: 'Less', exact: true });
  // Wait until the card has drawn, then open it unless it's already open.
  await btn.or(less).first().waitFor();
  if (await btn.isVisible()) await btn.click();
  await less.waitFor();
}

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
      // The player link is now just the site address.
      assert(playerLink === BASE, `player link should be the plain address, was ${playerLink}`);
      await admin.screenshot({ path: path.join(SHOTS, 'setup-done.png'), fullPage: true });
    });

    await check('organizer Home is lean: no first-visit notice, no guiding filler, today\'s date top right', async () => {
      await admin.getByRole('button', { name: 'Go to the organizer dashboard' }).click();
      await tab(admin, 'Home').waitFor();
      await sessionCards(admin).first().waitFor();
      assert((await admin.getByRole('note').count()) === 0, 'first-visit notice should be gone');
      for (const filler of [/never sends texts/, /Texts are never sent automatically/, /Times shown in Eastern time/, /When the venue gives you a court/, /After you book, come back/, /Earned when 6 played/, /Hidden from everyone/]) {
        assert((await admin.getByText(filler).count()) === 0, `filler still shown: ${filler}`);
      }
      const today = (await admin.locator('header .today').innerText()).replace(/^Today is\s*/, '').trim();
      const expected = new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'America/Detroit' });
      assert(today === expected, `header date was ${today}, expected ${expected}`);
      const box = await admin.locator('header .today').boundingBox();
      const vw = admin.viewportSize().width;
      assert(box.x + box.width > vw - 40, 'date should sit at the top right');
      await admin.screenshot({ path: path.join(SHOTS, 'admin-home.png'), fullPage: true });
    });

    await check('sessions are grouped by calendar week with a divider', async () => {
      const section = admin.locator('section[aria-labelledby="sessions-title"]');
      const labels = await section.locator('.week-break').allInnerTexts();
      assert(labels.length >= 2, `expected week dividers, got ${labels}`);
      assert(/^(This week|Next week|Week of [A-Z][a-z]{2} \d{1,2})$/i.test(labels[0].trim()), `first divider was ${labels[0]}`);
      // No two dividers in a row, and never more than 2 sessions (Tue + Thu) between them.
      const kids = await section.evaluate((el) => [...el.querySelectorAll(':scope > .week-break, :scope > article')].map((n) => n.tagName));
      let run = 0;
      for (const k of kids) {
        if (k === 'H3') {
          run = 0;
          continue;
        }
        run++;
        assert(run <= 2, 'a week has more than 2 sessions without a divider');
      }
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
      const pillBg = await nav.evaluate((el) => getComputedStyle(el).backgroundColor);
      // "rgb(r g b)", "rgba(r, g, b, a)" or "color(srgb r g b / a)": the alpha is the 4th number, or after "/".
      const nums = pillBg.match(/[\d.]+/g).map(Number);
      const alpha = pillBg.includes('/') ? Number(pillBg.split('/')[1].match(/[\d.]+/)[0]) : pillBg.startsWith('rgba') ? nums[3] : 1;
      assert(alpha >= 0.95, `pill should be solid, background was ${pillBg}`);
      const pad = await admin.evaluate(() => parseFloat(getComputedStyle(document.querySelector('main.page')).paddingBottom));
      assert(pad >= box.height + 24, `not enough room under the last card for the pill (${pad}px)`);
      await admin.locator('header img.brand-logo').waitFor();
      for (const scheme of ['light', 'dark']) {
        await admin.emulateMedia({ colorScheme: scheme });
        const logo = await admin.locator('header img.brand-logo').evaluate((img) => ({
          loaded: img.complete && img.naturalWidth === 128,
          backing: getComputedStyle(img).backgroundColor,
          width: img.getBoundingClientRect().width,
        }));
        assert(logo.loaded, `header logo did not load in ${scheme} mode`);
        assert(logo.backing === 'rgb(255, 255, 255)', `logo should sit on a light backing in ${scheme} mode`);
        assert(logo.width === 32, `header logo should be 32px, was ${logo.width}`);
      }
      await admin.emulateMedia({ colorScheme: 'light' });
      assert((await admin.locator('link[rel="icon"]').getAttribute('href')) === '/favicon-32.png', 'tab icon should be the logo');
      for (const f of ['/apple-touch-icon.png', '/icon-192.png', '/icon-512.png', '/favicon-32.png', '/logo-header.png']) {
        const r = await admin.request.get(BASE + f);
        assert(r.ok() && r.headers()['content-type'].includes('image/png'), `${f} missing`);
      }
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
      await firstCard(p).locator('.me-tag', { hasText: 'Waitlist #1' }).waitFor();
      await firstCard(p).getByText('4 of 4 in').waitFor();
      for (const n of ['Alex', 'Blair', 'Casey', 'Devon']) await firstCard(p).locator('.in-pills li', { hasText: n }).waitFor();
      await firstCard(p).locator('.waitlist-line', { hasText: 'Waitlist: Emery' }).waitFor();
      assert((await firstCard(p).locator('.in-pills li', { hasText: 'Frankie' }).count()) === 0, 'people who have not signed up should not show');
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

    await check('6 going: the first four hear about a $5 credit, the last two owe $9 (6-person discount)', async () => {
      await players.Casey.reload();
      await firstCard(players.Casey).getByText("6 are playing. You'll get a $5 credit toward your next session.").waitFor();
      assert((await firstCard(players.Casey).getByText('6-person discount').count()) === 0, 'first four should not get the discount');
      await players.Frankie.reload();
      const money = firstCard(players.Frankie).getByLabel('Money for this session');
      await money.getByText('You owe $9').waitFor();
      await money.getByText('6-person discount').waitFor();
      await money.getByRole('link', { name: 'Pay $9 with Venmo' }).waitFor();
      assert((await firstCard(players.Frankie).getByText(/credit toward your next/).count()) === 0, 'last two should not hear about a credit');
      await admin.reload();
      assert((await admin.getByText(/Refund \$5 each/).count()) === 0, 'old refund card still shown');
      assert((await admin.getByRole('checkbox', { name: /refunded/i }).count()) === 0, 'Refunded checkbox still shown');
      await players.Frankie.screenshot({ path: path.join(SHOTS, 'player-discount.png'), fullPage: true });
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
      // The discount is gone: everyone is back to $14, and the organizer gets a card to sort it out.
      const dropped = admin.getByRole('article', { name: /Was 6, now 5: discount and credits are off/ });
      await dropped.getByText(/now owes \$14/).first().waitFor();
      await players.Frankie.reload();
      await players.Frankie.getByRole('link', { name: 'Pay $14 with Venmo' }).first().waitFor();
      assert((await firstCard(players.Frankie).getByText('6-person discount').count()) === 0, 'discount text should be gone');
      await players.Alex.reload();
      await firstCard(players.Alex).locator('.in-pills li').first().waitFor();
      assert((await firstCard(players.Alex).getByText(/credit toward your next session/).count()) === 0, 'credit text should be gone');
      await five.getByRole('button', { name: /Back to 4/ }).click();
      await admin.locator('.toast', { hasText: '4 going' }).waitFor();
      await admin.getByRole('article', { name: /5 going/ }).waitFor({ state: 'detached' });
      const nowFour = admin.getByRole('article', { name: /Was 6, now 4: discount and credits are off/ });
      await nowFour.getByRole('button', { name: 'Done, I sorted it out' }).click();
      await nowFour.waitFor({ state: 'detached' });
    });

    console.log('Booking & payments');
    await check('Home: court and players are separate lines; no chip; no duplicate court cards', async () => {
      await admin.reload();
      const section = admin.locator('section[aria-labelledby="sessions-title"]');
      const link = section.getByRole('link', { name: 'Book on CourtReserve' });
      assert((await link.getAttribute('href')) === 'https://app.courtreserve.com/Online/PublicBookings/13765/Landing', 'wrong CourtReserve link');
      await sessionCards(admin).first().waitFor();
      for (const name of [/^Courts to book/, /^Waiting on the court/, /^Short on players/]) {
        assert((await admin.getByRole('article', { name }).count()) === 0, `old ${name} card still on Home`);
      }
      assert((await sessionCards(admin).locator('.chip').count()) === 0, 'session cards should have no status chip');
      // Court buttons live only inside session cards.
      for (const label of ['I booked it', 'Court opened', "Didn't open"]) {
        const all = await admin.getByRole('button', { name: label, exact: true }).count();
        const inCards = await sessionCards(admin).getByRole('button', { name: label, exact: true }).count();
        assert(all === inCards, `${label} shows outside a session card`);
      }
      const cards = sessionCards(admin);
      for (let i = 0; i < (await cards.count()); i++) {
        const c = cards.nth(i);
        assert((await c.locator('.court-status').count()) >= 1, 'every card needs a court line');
        if ((await c.getAttribute('data-court')) !== 'off') {
          const line = (await c.locator('.players-line .players-count').innerText()).trim();
          assert(/^\d of [46] in$/.test(line), `players line was ${line}`);
          const dots = await c.locator('.players-line .dot').count();
          assert(dots === Number(line.split(' of ')[1].split(' ')[0]), `expected a dot per spot, got ${dots}`);
        }
      }
    });

    await check('not booked: amber dashed border, banner with I booked it; one tap books it', async () => {
      const card = sessionCards(admin).first();
      assert((await card.getAttribute('data-court')) === 'needs', 'first card should need a court');
      const banner = card.locator('.court-banner');
      await banner.getByText('Court not booked', { exact: true }).waitFor();
      assert((await banner.locator('svg.court-icon').count()) === 1, 'banner needs an icon with the words');
      const look = await card.evaluate((el) => ({ style: getComputedStyle(el).borderTopStyle, banner: getComputedStyle(el.querySelector('.court-banner')).backgroundColor }));
      assert(look.style === 'dashed', `not-booked border should be dashed, was ${look.style}`);
      await admin.screenshot({ path: path.join(SHOTS, 'admin-not-booked.png') });
      await banner.getByRole('button', { name: 'I booked it' }).click();
      await admin.locator('.toast', { hasText: 'Court booked' }).waitFor();
      assert((await admin.locator('dialog[open]').count()) === 0, 'I booked it should not ask anything');
      const booked = sessionCards(admin).first();
      assert((await booked.getAttribute('data-court')) === 'booked', 'card should now be booked');
      await booked.locator('.court-line').getByText('Court booked', { exact: true }).waitFor();
      await booked.getByText(/^Cancel by .*8:00 AM/).waitFor();
      const edge = await booked.evaluate((el) => ({ style: getComputedStyle(el).borderLeftStyle, width: parseFloat(getComputedStyle(el).borderLeftWidth) }));
      assert(edge.style === 'solid' && edge.width >= 6, `booked card needs a solid left edge: ${JSON.stringify(edge)}`);
      assert((await booked.locator('.court-banner').count()) === 0, 'booked card should have no banner');
    });

    await check('Edit booking: no court number; reservation number and cost under More details', async () => {
      const card = sessionCards(admin).first();
      await card.getByRole('button', { name: 'Edit booking' }).click();
      const edit = admin.locator('dialog[open]');
      await edit.getByLabel(/Cancellation deadline/).waitFor();
      assert((await edit.getByLabel(/Court #|Court number/).count()) === 0, 'court number field still in Edit booking');
      assert(!(await edit.getByLabel(/Reservation number/).isVisible()), 'extras should be tucked under More details');
      await edit.getByText('More details').click();
      await edit.getByLabel(/Reservation number/).fill('R-1042');
      await edit.getByLabel(/Court cost/).fill('48.37');
      await edit.getByText("Your own record. Players never see it, and it's never in a text.").waitFor();
      assert((await edit.getByText(/Split four ways/i).count()) === 0, 'old split helper text still shown');
      await edit.getByText(/Deadline: .*8:00 AM$/).waitFor();
      await admin.screenshot({ path: path.join(SHOTS, 'admin-booking.png') });
      await edit.getByRole('button', { name: 'Save booking' }).click();
      await admin.locator('.toast', { hasText: 'Booking saved' }).waitFor();
      await card.getByText('Reservation #R-1042', { exact: false }).waitFor();
      await card.getByText('$48.37 (only you see this)', { exact: false }).waitFor();
      assert((await admin.getByText(/Court #|Court number/).count()) === 0, 'court number shows on organizer Home');
      await admin.screenshot({ path: path.join(SHOTS, 'admin-booked.png') });
      await players.Alex.reload();
      const row = firstCard(players.Alex);
      await row.locator('.sched-status').getByText('Court booked', { exact: true }).waitFor();
      assert((await players.Alex.getByText(/Court #/).count()) === 0, 'court number shows to players');
      assert((await players.Alex.getByText('Court not booked yet', { exact: true }).count()) > 0, 'other sessions should say Court not booked yet');
      assert((await row.getByRole('button', { name: /I booked it|Court opened/ }).count()) === 0, 'players get no court buttons');
    });

    await check('summary line counts courts, and each part jumps to its first card', async () => {
      await admin.evaluate(() => window.scrollTo(0, 0));
      const summary = admin.locator('.court-summary');
      const text = (await summary.innerText()).trim();
      assert(/^(\d+ booked)?(, )?(\d+ needs? a court)?(, )?(\d+ on the waitlist)?$/.test(text) && /\d/.test(text), `summary was: ${text}`);
      assert(/^1 booked, \d+ needs? a court$/.test(text), `expected 1 booked and the rest needing a court: ${text}`);
      await summary.getByRole('button', { name: /needs? a court/ }).click();
      const target = sessionCards(admin).locator('[data-court="needs"]').first().or(admin.locator('article[data-court="needs"]').first());
      await admin.waitForFunction(() => {
        const el = document.querySelector('article[data-court="needs"]');
        if (!el) return false;
        const r = el.getBoundingClientRect();
        return r.top >= -2 && r.top < window.innerHeight / 2;
      });
      assert((await target.count()) > 0, 'no needs-a-court card');
    });

    await check('session card: one main button, Edit booking, Players, and the rest under More', async () => {
      const card = sessionCards(admin).first();
      const visible = async () =>
        (await card.locator('button:visible').allInnerTexts()).map((t) => t.trim()).filter((t) => !/^(Undo|Venue is open normal hours)$/.test(t));
      const before = await visible();
      assert(JSON.stringify(before) === JSON.stringify(['Text the group poll', 'Edit booking', 'Players', 'More']), `card buttons were ${before}`);
      await more(card);
      const after = await visible();
      for (const b of ['Money', 'Texts', 'Reschedule', 'Cancel session']) assert(after.includes(b), `More is missing ${b}: ${after}`);
      await card.getByRole('button', { name: 'Less' }).click();
    });

    await check('court cost never shows to players', async () => {
      for (const name of ['Alex', 'Blair']) {
        await players[name].reload();
        await firstCard(players[name]).waitFor();
        const html = await players[name].content();
        assert(!html.includes('48.37') && !html.includes('4837'), `court cost leaked to ${name}`);
      }
    });

    await check('"Text the group poll" opens Messages with the date, venue and $14, and has Copy', async () => {
      const card = sessionCards(admin).first();
      await card.getByRole('button', { name: 'Text the group poll' }).click();
      const sheet = admin.locator('dialog[open]');
      const bubble = (await sheet.locator('.bubble').innerText()).trim();
      assert(
        /^Pickleball: (Tue|Thu), [A-Z][a-z]{2} \d{1,2}, 8:00 to 10:00 PM at Northville Pickleball Club\. \$14 each\. In or out\?$/.test(bubble),
        `poll text was: ${bubble}`,
      );
      assert(!bubble.includes('48'), 'court cost in the poll');
      const href = await sheet.getByRole('link', { name: 'Open in Messages' }).getAttribute('href');
      assert(href.startsWith('sms:&body=Pickleball'), `bad sms link ${href}`);
      await sheet.getByRole('button', { name: 'Copy message' }).click();
      await admin.locator('.toast', { hasText: 'Message copied' }).waitFor();
      assert((await admin.evaluate(() => navigator.clipboard.readText())) === bubble, 'clipboard should hold the poll');
      await admin.keyboard.press('Escape');
    });

    await check('holiday pill shows on sessions that fall on one (Election Day, Nov 3)', async () => {
      if (Date.now() > Date.parse('2026-11-04T03:00:00Z')) return; // only while Nov 3, 2026 is still upcoming
      await players.Alex.reload();
      const card = players.Alex.locator('article', { hasText: 'Tuesday, Nov 3' });
      await card.locator('.holiday', { hasText: 'Election Day' }).waitFor();
      const color = await card.locator('.holiday').evaluate((el) => getComputedStyle(el).color);
      const ok = await players.Alex.evaluate(() => getComputedStyle(document.querySelector('.tone-ok') || document.body).color);
      assert(color !== ok, 'holiday pill should not use a status color');
      await admin.reload();
      const hcard = sessionCards(admin).filter({ hasText: 'Election Day' }).first();
      await hcard.locator('.holiday', { hasText: 'Election Day · check venue hours' }).waitFor();
      await hcard.getByRole('button', { name: 'Venue is open normal hours' }).click();
      await hcard.locator('.holiday', { hasText: /^✓ Election Day$/ }).waitFor();
      await admin.reload();
      const after = sessionCards(admin).filter({ hasText: 'Election Day' }).first();
      await after.locator('.holiday', { hasText: /^✓ Election Day$/ }).waitFor();
      assert((await after.getByText('check venue hours').count()) === 0, 'check venue hours should be gone after confirming');
      await admin.screenshot({ path: path.join(SHOTS, 'admin-holiday-confirmed.png'), fullPage: true });
      await after.getByRole('button', { name: 'Undo' }).click();
      await after.locator('.holiday', { hasText: 'Election Day · check venue hours' }).waitFor();
      await players.Alex.reload();
      assert(!(await players.Alex.content()).includes('venue hours'), 'players must never see "check venue hours"');
    });

    await check('everyone confirmed owes a flat $14; mark paid updates only that player', async () => {
      const card = sessionCards(admin).first();
      await more(card);
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
      await draft.getByText('Draft', { exact: true }).first().waitFor();
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

    await check('opening Messages shows "Message ready", never "sent"', async () => {
      const draft = admin.locator('dialog[open] .draft').first();
      await draft.evaluate((el) => {
        // Don't let the test browser try to launch an SMS app.
        el.querySelector('a[href^="sms:"]').addEventListener('click', (e) => e.preventDefault());
      });
      await draft.getByRole('link', { name: 'Open in Messages' }).click();
      await draft.getByText('Message ready.').waitFor();
      assert(!/\bsent\b/i.test(await draft.innerText()), 'the draft must never say it was sent');
      assert((await draft.getByRole('button', { name: /sent/i }).count()) === 0, 'no "I sent it" button');
      await admin.keyboard.press('Escape');
    });

    await check('money lives inside each session row: owe + Venmo, or Paid; no money card', async () => {
      const p = players.Blair;
      await p.reload();
      const money = firstCard(p).getByLabel('Money for this session');
      await money.getByText('You owe $14').waitFor();
      const href = await money.getByRole('link', { name: 'Pay $14 with Venmo' }).getAttribute('href');
      assert(href.startsWith('https://venmo.com/organizer?txn=pay&amount=14.00&note=Pickleball'), `bad Venmo link ${href}`);
      assert((await money.getByText(/may not have marked this paid/).count()) === 0, 'unpaid reminder shown too early');
      assert((await p.getByRole('region', { name: 'Payments' }).count()) === 0, 'separate money card should be gone');
      await p.screenshot({ path: path.join(SHOTS, 'player-owe.png'), fullPage: true });
      // Alex is marked paid for the first session.
      await players.Alex.reload();
      await firstCard(players.Alex).getByLabel('Money for this session').getByText('✓ Paid').waitFor();
    });

    await check('schedule rows: date tile, time without EDT/EST, and a small calendar link', async () => {
      const row = firstCard(players.Blair);
      const tile = (await row.locator('.tile').innerText()).replace(/\s+/g, ' ').trim();
      assert(/^(TUE|THU) \d{1,2} [A-Z]{3}$/.test(tile), `date tile was "${tile}"`);
      await row.locator('.sched-time', { hasText: /^8:00 to 10:00 PM$|^7:30 to 10:00 PM$/ }).waitFor();
      assert(!/\b(EDT|EST)\b/.test(await players.Blair.locator('main').innerText()), 'EDT/EST still on screen');
      const cal = row.getByRole('link', { name: 'Add to Calendar' });
      assert(!(await cal.getAttribute('class')).includes('btn'), 'calendar should be a small link, not a big button');
    });

    await check('Add to Calendar downloads a Pickleball event at 8:00 to 10:00 PM', async () => {
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

    console.log('Open address');
    let privateLink = '';
    await check('the plain address opens "Who are you?" with a small Organizer sign-in link; no private-site screen', async () => {
      const p = await newPage();
      await p.goto(BASE);
      await p.getByRole('heading', { name: 'Who are you?' }).waitFor();
      assert((await p.getByText(/private group site/i).count()) === 0, 'old private-site screen still shown');
      const signIn = p.getByRole('link', { name: 'Organizer sign-in' });
      await signIn.waitFor();
      const box = await signIn.boundingBox();
      const lastBtn = await p.getByRole('button', { name: 'Add my name' }).boundingBox();
      assert(box.y > lastBtn.y, 'Organizer sign-in should be at the bottom');
      await p.getByRole('button', { name: 'Blair', exact: true }).click();
      await p.getByRole('heading', { name: 'Welcome, Blair' }).waitFor();
      await p.reload();
      await p.getByRole('heading', { name: 'Welcome, Blair' }).waitFor();
      await p.screenshot({ path: path.join(SHOTS, 'player-plain-address.png'), fullPage: true });
    });

    await check('Settings: turning the open address OFF goes back to link-only; the long link still works', async () => {
      await tab(admin, 'Settings').click();
      await admin.getByText('Old private link').click();
      privateLink = (await admin.locator('details code.link').textContent()).trim();
      assert(/\/g\/[A-Za-z0-9_-]{20,}$/.test(privateLink), `private link was ${privateLink}`);
      await admin.getByLabel('Anyone with the site address can use it').uncheck();
      await admin.getByRole('button', { name: 'Save settings' }).click();
      await admin.locator('.toast', { hasText: 'Settings saved' }).waitFor();
      assert((await admin.locator('section[aria-labelledby="link-title"] code.link').first().textContent()).includes('/g/'), 'link-only should show the long link');
      const p = await newPage();
      await p.goto(BASE);
      await p.getByText('Open the link your organizer sent you').waitFor();
      await p.getByRole('link', { name: 'Organizer sign-in' }).waitFor();
      await p.goto(privateLink);
      await p.getByRole('heading', { name: 'Who are you?' }).waitFor();
      await admin.getByLabel('Anyone with the site address can use it').check();
      await admin.getByRole('button', { name: 'Save settings' }).click();
      await admin.locator('.toast', { hasText: 'Settings saved' }).waitFor();
      await p.goto(BASE);
      await p.getByRole('heading', { name: 'Who are you?' }).waitFor();
    });

    await check('Settings: a group word is asked once on a new phone, then remembered', async () => {
      await admin.getByLabel(/Group word/).fill('Dink');
      await admin.getByRole('button', { name: 'Save settings' }).click();
      await admin.locator('.toast', { hasText: 'Settings saved' }).waitFor();
      const p = await newPage();
      await p.goto(BASE);
      await p.getByLabel("What's the group word?").fill('nope');
      await p.getByRole('button', { name: 'Continue' }).click();
      await p.getByText("That's not the group word.").waitFor();
      await p.getByLabel("What's the group word?").fill('dink');
      await p.getByRole('button', { name: 'Continue' }).click();
      await p.getByRole('heading', { name: 'Who are you?' }).waitFor();
      await p.reload();
      await p.getByRole('heading', { name: 'Who are you?' }).waitFor();
      // Phones that already picked their name aren't asked.
      await players.Alex.reload();
      await firstCard(players.Alex).waitFor();
      assert((await players.Alex.getByLabel("What's the group word?").count()) === 0, 'known phones should not be asked');
      await admin.getByRole('button', { name: 'Remove the group word' }).click();
      await admin.getByRole('button', { name: 'Save settings' }).click();
      await admin.locator('.toast', { hasText: 'Settings saved' }).waitFor();
      const q = await newPage();
      await q.goto(BASE);
      await q.getByRole('heading', { name: 'Who are you?' }).waitFor();
      await tab(admin, 'Home').click();
    });

    console.log('Roster, names, home screen');
    await check('who\'s in: only people who signed up, as neutral pills; nobody else listed', async () => {
      await players.Alex.reload();
      const card = firstCard(players.Alex);
      await card.locator('.in-pills li', { hasText: 'Alex' }).waitFor();
      assert((await card.locator('.roster li.out').count()) === 0, 'faded not-signed-up names should be gone');
      const styles = await players.Alex.evaluate(() => {
        const probe = document.createElement('span');
        document.body.appendChild(probe);
        const bg = (c) => ((probe.className = c), getComputedStyle(probe).backgroundColor);
        const colors = [bg('chip tone-ok'), bg('chip tone-warn'), bg('chip tone-danger')];
        probe.remove();
        return { pill: getComputedStyle(document.querySelector('.in-pills li')).backgroundColor, colors };
      });
      assert(!styles.colors.includes(styles.pill), `pill uses a status color: ${styles.pill}`);
    });

    await check('players see today\'s date top right and week dividers, without filler', async () => {
      const p = players.Casey;
      await p.reload();
      await p.locator('.schedule article').first().waitFor();
      const today = (await p.locator('header .today').innerText()).replace(/^Today is\s*/, '').trim();
      assert(/^(Sun|Mon|Tue|Wed|Thu|Fri|Sat), [A-Z][a-z]{2} \d{1,2}$/.test(today), `player header date was ${today}`);
      const labels = await p.locator('.schedule .week-break').allInnerTexts();
      assert(labels.length >= 2, `expected week dividers on the player screen, got ${labels}`);
      for (const filler of [/standby list so we're ready/, /Nobody on standby yet/, /so this one is off/]) {
        assert((await p.getByText(filler).count()) === 0, `filler still shown: ${filler}`);
      }
      await p.screenshot({ path: path.join(SHOTS, 'player-weeks.png'), fullPage: true });
    });

    await check('the Home Screen tip is one small line at the very bottom, shown once; Settings has the steps', async () => {
      const p = await newPage();
      await p.goto(playerLink);
      await p.getByRole('button', { name: 'Alex', exact: true }).click();
      const tip = p.getByRole('note', { name: 'Add to Home Screen' });
      await tip.getByText('Tip: add Pickleball to your Home Screen. Tap Share, then Add to Home Screen, then Add.').waitFor();
      // It sits at the very end of the page, below every session.
      const tipTop = (await tip.boundingBox()).y;
      const lastRow = await p.locator('article').last().boundingBox();
      assert(tipTop > lastRow.y + lastRow.height - 1, 'the tip should be at the bottom, after the sessions');
      assert((await p.getByText(/never texts you/i).count()) === 0, '"This site never texts you" should be gone');
      await tip.getByRole('button', { name: 'Dismiss' }).click();
      await p.reload();
      await p.locator('article').first().waitFor();
      assert((await p.getByRole('note', { name: 'Add to Home Screen' }).count()) === 0, 'tip came back');
      const manifest = await (await p.request.get(BASE + '/manifest.webmanifest')).json();
      assert(manifest.display === 'standalone', 'should open full screen from the icon');
      assert(!manifest.start_url, 'no start_url, so each player keeps their own link');
      assert((await p.locator('link[rel="apple-touch-icon"]').getAttribute('href')) === '/apple-touch-icon.png', 'icon spot missing');
      await tab(admin, 'Settings').click();
      await admin.getByRole('heading', { name: 'Add to Home Screen' }).waitFor();
      await tab(admin, 'Home').click();
    });

    await check('"Add my name": duplicate check, then preferred days, then Welcome', async () => {
      const p = await newPage();
      await p.goto(playerLink);
      await p.getByRole('button', { name: 'Add my name' }).click();
      await p.getByLabel('Your name').fill('ryan');
      await p.getByRole('button', { name: 'Continue' }).click();
      await p.getByRole('heading', { name: 'Is this you?' }).waitFor();
      await p.getByRole('button', { name: 'Ryan', exact: true }).waitFor();
      await p.getByRole('button', { name: "No, I'm new" }).click();
      await p.getByText(/Someone already uses "ryan"/).waitFor();
      await p.getByLabel('Your name').fill('Morgan');
      await p.getByRole('button', { name: 'Continue' }).click();
      await p.getByRole('heading', { name: 'Any preferred days?' }).waitFor();
      for (const b of ['Tuesday', 'Thursday', 'Both', 'Skip']) await p.getByRole('button', { name: b, exact: true }).waitFor();
      await p.getByRole('button', { name: 'Both', exact: true }).click();
      await p.getByRole('heading', { name: 'Welcome, Morgan' }).waitFor();
      await p.getByRole('button', { name: 'Not you?' }).waitFor();
      await p.screenshot({ path: path.join(SHOTS, 'player-added-name.png'), fullPage: true });
      await tab(admin, 'Players').click();
      await admin.reload();
      await tab(admin, 'Players').click();
      const row = admin.locator('li', { hasText: 'Morgan' });
      await row.locator('.new-tag', { hasText: 'New' }).waitFor();
      await row.getByText('Tue & Thu').waitFor();
    });

    await check('removing a name: deleted if no history, hidden if they have some', async () => {
      await admin.getByRole('button', { name: 'Edit Morgan' }).click();
      await admin.locator('dialog[open]').getByRole('button', { name: 'Remove from list' }).click();
      await admin.locator('dialog[open]', { hasText: 'Remove Morgan?' }).getByRole('button', { name: 'Remove', exact: true }).click();
      await admin.locator('.toast', { hasText: 'Morgan removed' }).waitFor();
      await admin.locator('li', { hasText: 'Morgan' }).waitFor({ state: 'detached' });
      await admin.getByRole('button', { name: 'Edit Ryan' }).click();
      await admin.locator('dialog[open]').getByRole('button', { name: 'Remove from list' }).click();
      await admin.locator('dialog[open]', { hasText: 'Remove Ryan?' }).getByRole('button', { name: 'Remove', exact: true }).click();
      await admin.locator('.toast', { hasText: /Ryan (removed|hidden)/ }).waitFor();
      await tab(admin, 'Home').click();
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
        if ((await card.locator('.in-line .small').innerText()).startsWith('3 of 4 in')) break;
        await card.getByRole('button', { name: "I'm in" }).click();
        await card.getByText("You're in", { exact: true }).waitFor();
      }
      await admin.reload();
      const card = sessionCards(admin).nth(1);
      await more(card);
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

    console.log('Court waitlist');
    await check('court waitlist: players go on standby; poll text has the link; Court opened moves them in', async () => {
      const card = sessionCards(admin).nth(3);
      const day = (await card.locator('h2').innerText()).trim(); // e.g. "Thu, Nov 5"
      await more(card);
      await card.getByRole('button', { name: 'On court waitlist' }).click();
      const banner = card.locator('.court-banner');
      await banner.getByRole('button', { name: 'Court opened' }).waitFor();
      await banner.getByRole('button', { name: "Didn't open" }).waitFor();
      await banner.getByText('On the court waitlist', { exact: true }).waitFor();
      assert((await card.getAttribute('data-court')) === 'waitlist', 'card should show the court waitlist look');
      assert((await card.getByRole('button', { name: 'I booked it' }).count()) === 0, 'waitlist card should not offer I booked it');
      await admin.screenshot({ path: path.join(SHOTS, 'admin-court-waitlist.png') });
      await more(card);
      await card.getByRole('button', { name: 'Text the group poll' }).click();
      const bubble = (await admin.locator('dialog[open] .bubble').innerText()).trim();
      const re = new RegExp(`^Pickleball ${day}, 8:00 to 10:00 PM\\. I'm on the court waitlist\\. Want to be ready if it opens\\? Tap here: https?://[^\\s/]+(/g/[A-Za-z0-9_-]+)?$`);
      assert(re.test(bubble), `court-waitlist poll was: ${bubble}`);
      await admin.keyboard.press('Escape');

      for (const name of ['Casey', 'Devon']) {
        const p = players[name];
        await p.reload();
        const row = p.locator('article', { hasText: day.replace(/^(Tue|Thu), /, (m) => (m.startsWith('Tue') ? 'Tuesday, ' : 'Thursday, ')) });
        await row.locator('.sched-status').getByText('Waiting on the court', { exact: true }).waitFor();
        await row.getByRole('button', { name: 'Put me on standby' }).click();
        await row.locator('.me-tag', { hasText: /Standby #\d/ }).waitFor();
        assert((await row.getByLabel('Money for this session').count()) === 0, 'standby players owe nothing');
      }
      await players.Casey.screenshot({ path: path.join(SHOTS, 'player-standby.png'), fullPage: true });

      await admin.reload();
      const c2 = sessionCards(admin).nth(3);
      await c2.locator('.players-line').getByText(/2 on standby/).waitFor();
      assert((await admin.getByRole('article', { name: /^Waiting on the court/ }).count()) === 0, 'no separate waiting card');
      assert(/1 on the waitlist/.test(await admin.locator('.court-summary').innerText()), 'summary should count the court waitlist');
      await c2.getByRole('button', { name: 'Court opened' }).click();
      await admin.locator('.toast', { hasText: 'Court opened' }).waitFor();
      assert((await admin.locator('dialog[open]').count()) === 0, 'Court opened should not ask anything');
      await c2.locator('.court-line').getByText('Court booked', { exact: true }).waitFor();
      const tell = admin.getByRole('article', { name: new RegExp(`Tell them they're in: ${day}`) });
      await tell.getByText(/Good news, Casey! The court opened up/).waitFor();

      const p = players.Casey;
      await p.reload();
      const row = p.locator('article', { hasText: day.replace(/^(Tue|Thu), /, (m) => (m.startsWith('Tue') ? 'Tuesday, ' : 'Thursday, ')) });
      await row.locator('.sched-status').getByText('Court booked', { exact: true }).waitFor();
      await row.getByText("Good news, the court opened, so you're in.").waitFor();
      await row.getByLabel('Money for this session').getByRole('link', { name: 'Pay $14 with Venmo' }).waitFor();
    });

    await check('day-before card (when one is due right now): Text the group, Copy, Done; never "sent"', async () => {
      await admin.reload();
      const card = admin.getByRole('article', { name: /^(Tue|Thu), [A-Z][a-z]{2} \d{1,2}: \d in, / });
      if ((await card.count()) === 0) return; // no session inside its 24-hour window at this moment
      const first = card.first();
      const body = (await first.locator('.bubble').innerText()).trim();
      assert(/^Pickleball tomorrow, (Tue|Thu), [A-Z][a-z]{2} \d{1,2}, \d{1,2}:\d{2} to 10:00 PM\. /.test(body), `day-before text was: ${body}`);
      await first.evaluate((el) => el.querySelector('a[href^="sms:"]').addEventListener('click', (e) => e.preventDefault()));
      await first.getByRole('link', { name: 'Text the group' }).click();
      await first.getByText('Message ready.').waitFor();
      assert(!/\bsent\b/i.test(await first.innerText()), 'card must never say sent');
      await first.getByRole('button', { name: 'Copy message' }).click();
      await admin.locator('.toast', { hasText: 'Message copied' }).waitFor();
      await admin.screenshot({ path: path.join(SHOTS, 'admin-day-before.png'), fullPage: true });
      const label = await first.getAttribute('aria-label');
      await first.getByRole('button', { name: 'Done' }).click();
      await admin.getByRole('article', { name: label }).waitFor({ state: 'detached' });
    });

    console.log('Reschedule & cancel');
    await check('organizer can move a session to a new time', async () => {
      const card = sessionCards(admin).first();
      await more(card);
      await card.getByRole('button', { name: 'Reschedule' }).first().click();
      const sheet = admin.locator('dialog[open]');
      await sheet.getByLabel('Start').fill('19:30');
      await sheet.getByText(/New time: .*7:30 to 10:00 PM$/).waitFor();
      await sheet.getByRole('button', { name: 'Move session' }).click();
      await admin.locator('dialog[open]').waitFor({ state: 'detached' }).catch(() => {});
      await card.getByText('7:30 to 10:00 PM', { exact: true }).waitFor();
    });

    await check('canceling needs confirmation and warns it does not cancel the court', async () => {
      const card = sessionCards(admin).nth(1);
      await more(card);
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

    console.log('First session date');
    await check('Settings "First session" hides earlier sessions from Home and players', async () => {
      await tab(admin, 'Settings').click();
      const field = admin.getByLabel('First session');
      // A date one week after the first upcoming session.
      await tab(admin, 'Home').click();
      const firstShown = await sessionCards(admin).first().locator('h2').innerText();
      await tab(admin, 'Settings').click();
      const iso = await admin.evaluate(() => {
        const d = new Date();
        d.setDate(d.getDate() + 9);
        return d.toISOString().slice(0, 10);
      });
      await field.fill(iso);
      await admin.getByRole('button', { name: 'Save settings' }).click();
      await admin.locator('.toast', { hasText: 'Settings saved' }).waitFor();
      await tab(admin, 'Home').click();
      await admin
        .waitForFunction((was) => {
          const h = document.querySelector('section[aria-labelledby="sessions-title"] article h2');
          return h && h.textContent !== was;
        }, firstShown, { timeout: 10000 })
        .catch(() => {});
      const nowFirst = await sessionCards(admin).first().locator('h2').innerText();
      assert(nowFirst !== firstShown, `Home still starts at ${firstShown}`);
      await players.Alex.reload();
      await firstCard(players.Alex).locator('h2').waitFor();
      const playerFirst = await firstCard(players.Alex).locator('h2').innerText();
      assert(!playerFirst.includes(firstShown.split(', ')[1]), `players still see ${firstShown}`);
      // "Show this session" brings one back; then the court never opens.
      await tab(admin, 'Home').click();
      const hidden = admin.getByRole('region', { name: 'Before your first session date' });
      const row = hidden.locator('li').filter({ hasText: 'Nov 3' });
      if (await row.count()) {
        await row.getByRole('button', { name: 'Show this session' }).click();
        await admin.locator('.toast', { hasText: 'is showing' }).waitFor();
        const shown = sessionCards(admin).filter({ hasText: 'Tue, Nov 3' }).first();
        await more(shown);
        await shown.getByRole('button', { name: 'On court waitlist' }).click();
        await shown.getByRole('button', { name: "Didn't open" }).click();
        await admin.locator('dialog[open]').getByRole('button', { name: 'Mark it off' }).click();
        await shown.getByText("Court didn't open").first().waitFor();
        await players.Alex.reload();
        await players.Alex.locator('article', { hasText: 'Tuesday, Nov 3' }).getByText("Court didn't open").waitFor();
      }
      // Put it back for the rest of the checks.
      await tab(admin, 'Settings').click();
      await admin.getByLabel('First session').fill('');
      await admin.getByRole('button', { name: 'Save settings' }).click();
      await admin.locator('.toast', { hasText: 'Settings saved' }).waitFor();
      await tab(admin, 'Home').click();
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
      assert(/8:00 to 10:00 PM/.test(text), 'missing time range');
      assert(!/\b(EDT|EST)\b/.test(text), 'EDT/EST should be gone from screens');
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
        // The floating pill never covers the last card on the organizer Home.
        await p.goto(`${BASE}/admin`);
        const signIn = p.getByLabel('Organizer PIN');
        if (await signIn.isVisible().catch(() => false)) {
          await signIn.fill(PIN);
          await p.getByRole('button', { name: 'Sign in' }).click();
        }
        await sessionCards(p).first().waitFor();
        const showAll = p.getByRole('button', { name: /^Show all/ });
        if (await showAll.count()) await showAll.click();
        await p.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
        const gap = await p.evaluate(() => {
          const cards = [...document.querySelectorAll('main article, main section.card')];
          const last = cards[cards.length - 1].getBoundingClientRect();
          const pill = document.querySelector('.tabbar').getBoundingClientRect();
          return pill.top - last.bottom;
        });
        assert(gap >= 0, `the pill covers the last card by ${-gap}px at ${width}px`);
        await p.screenshot({ path: path.join(SHOTS, `admin-${width}-${scheme}.png`), fullPage: false });
        await p.evaluate(() => window.scrollTo(0, 0));
        await p.screenshot({ path: path.join(SHOTS, `admin-top-${width}-${scheme}.png`), fullPage: false });
        await p.goto(playerLink);
        await p.getByRole('button', { name: 'Alex', exact: true }).click();
        await p.locator('article').first().waitFor();
        const overflow = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        assert(overflow <= 0, `player home overflows by ${overflow}px`);
        await p.screenshot({ path: path.join(SHOTS, `player-${width}-${scheme}.png`), fullPage: false });
      });
    }

    for (const [width, scheme] of [[360, 'light'], [375, 'dark'], [390, 'dark'], [430, 'light']]) {
      await check(`booking form, reschedule and Settings date fields fit at ${width}px (${scheme})`, async () => {
        const p = await admin.context().newPage();
        await p.setViewportSize({ width, height: 844 });
        await p.emulateMedia({ colorScheme: scheme });
        const fits = async (what) => {
          const r = await p.evaluate(() => {
            const vw = window.innerWidth;
            const fields = [...document.querySelectorAll('dialog[open] input, main input')].filter((el) => el.offsetParent !== null);
            const worst = Math.max(0, ...fields.map((el) => el.getBoundingClientRect().right - vw));
            const d = document.querySelector('dialog[open]');
            const dialogOverflow = d ? d.scrollWidth - d.clientWidth : 0;
            return { worst, dialogOverflow, page: document.documentElement.scrollWidth - vw };
          });
          assert(r.worst <= 0 && r.dialogOverflow <= 0 && r.page <= 0, `${what} runs past the edge: ${JSON.stringify(r)}`);
        };
        await p.goto(`${BASE}/admin`);
        const card = sessionCards(p).first();
        await card.getByRole('button', { name: 'Edit booking' }).click();
        await p.locator('dialog[open]').getByLabel(/Cancellation deadline/).waitFor();
        await fits('booking form');
        await p.screenshot({ path: path.join(SHOTS, `booking-${width}-${scheme}.png`) });
        await p.keyboard.press('Escape');
        await more(card);
        await card.getByRole('button', { name: 'Reschedule' }).first().click();
        await p.locator('dialog[open]').getByLabel('Date').waitFor();
        await fits('reschedule form');
        await p.keyboard.press('Escape');
        await tab(p, 'Settings').click();
        await p.getByLabel('First session').waitFor();
        await fits('Settings');
        await p.close();
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
