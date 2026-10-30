/* After-screenshots of every screen, for looking at the design.
 *
 *   node e2e/shots.cjs            (writes docs/screenshots/*.png)
 *   SHOT_WIDTHS=390 SHOT_SCHEMES=light node e2e/shots.cjs
 *
 * Starts its own dev server with a fresh test group (fake names and phone
 * numbers), with the clock pinned to Tue Oct 27, 2026, 2:14 PM Eastern.
 * Nothing here touches the live site.
 */
const { spawn } = require('node:child_process');
const { rmSync, mkdirSync } = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const PORT = 5198;
const BASE = `http://localhost:${PORT}`;
const SETUP_TOKEN = 'shots-setup-token-0123456789';
const PIN = '482913';
const OUT = process.env.SHOT_DIR ? path.resolve(process.env.SHOT_DIR) : path.join(ROOT, 'docs', 'screenshots');
const WIDTHS = (process.env.SHOT_WIDTHS || '360,390').split(',').map(Number);
const SCHEMES = (process.env.SHOT_SCHEMES || 'light,dark').split(',');
const NAMES = ['Alex', 'Alec', 'Armen', 'Ryan', 'Brandon', 'Julian', 'Mitchel', 'Nathan'];

async function main() {
  const dbFile = path.join(ROOT, '.data', 'shots.sqlite');
  mkdirSync(path.join(ROOT, '.data'), { recursive: true });
  rmSync(dbFile, { force: true });
  mkdirSync(OUT, { recursive: true });
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
  await fetch(`${BASE}/__dev/clock`, { method: 'POST', body: JSON.stringify({ atMs: Date.parse('2026-10-27T14:14:00-04:00') }) });

  const browser = await chromium.launch();
  const phone = (width, colorScheme) => ({
    viewport: { width, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    colorScheme,
    reducedMotion: 'reduce',
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  });
  const post = (req, url, data) => req.post(BASE + url, { data, headers: { Origin: BASE } });

  // ---- The group ----
  const setup = await (await browser.newContext()).request;
  const made = await post(setup, '/api/setup', {
    setupToken: SETUP_TOKEN,
    groupName: 'Pickleball Bros',
    pin: PIN,
    venmoUrl: 'https://venmo.com/u/organizer',
    players: NAMES.map((name, i) => ({ name, phone: `248555010${i}` })),
  });
  if (!made.ok()) throw new Error(`setup failed: ${await made.text()}`);
  const adminCtx = await browser.newContext(phone(390, 'light'));
  const areq = adminCtx.request;
  await post(areq, '/api/admin/login', { pin: PIN });
  let d = await (await areq.get(`${BASE}/api/admin/dashboard`)).json();
  // Thursday this week: shown early and waiting on the court, like the real site today.
  const hidden = d.hiddenSessions[d.hiddenSessions.length - 1];
  if (hidden) {
    await post(areq, `/api/admin/sessions/${hidden.id}/show`, { shown: true });
    await post(areq, `/api/admin/sessions/${hidden.id}/court`, { action: 'waitlist' });
  }
  d = await (await areq.get(`${BASE}/api/admin/dashboard`)).json();
  const upcoming = d.sessions.filter((s) => !s.state.flags.past);
  // Book the first three Nov sessions; a few players sign up for some.
  for (const s of upcoming.filter((x) => x.courtState !== 'waitlist').slice(0, 3)) await post(areq, `/api/admin/sessions/${s.id}/booked`, {});
  const joinAs = async (name, sessionIds) => {
    const ctx = await browser.newContext();
    const p = d.players.find((x) => x.name === name);
    await post(ctx.request, '/api/me', { playerId: p.id });
    for (const id of sessionIds) await post(ctx.request, `/api/sessions/${id}/join`, {});
    await ctx.close();
  };
  const nov = upcoming.filter((x) => x.courtState !== 'waitlist');
  await joinAs('Ryan', [nov[0].id, nov[1].id]);
  await joinAs('Brandon', [nov[0].id]);
  await joinAs('Julian', [nov[0].id, nov[1].id]);
  await joinAs('Nathan', [nov[1].id]);
  // After-the-game screens: the first November game with 5 in, Ryan paid ahead.
  await joinAs('Mitchel', [nov[0].id]);
  await joinAs('Nathan', [nov[0].id]);
  await post(areq, `/api/admin/sessions/${nov[0].id}/payment`, { playerId: d.players.find((x) => x.name === 'Ryan').id, paid: true });
  await adminCtx.close();

  // ---- Screens ----
  const shots = [];
  for (const width of WIDTHS) {
    for (const scheme of SCHEMES) {
      const ctx = await browser.newContext(phone(width, scheme));
      const page = await ctx.newPage();
      const snap = async (name, full = false) => {
        await page.waitForTimeout(150);
        const file = path.join(OUT, `${name}-${width}-${scheme}.png`);
        await page.screenshot({ path: file, fullPage: full });
        shots.push(file);
      };
      await page.goto(`${BASE}/admin`);
      await page.getByLabel('Organizer PIN').fill(PIN);
      await page.getByRole('button', { name: 'Sign in' }).click();
      const cards = page.locator('section[aria-labelledby="sessions-title"] article');
      await cards.first().waitFor();
      await snap('01-organizer-home');
      // Gear panel and the Text choices on the first booked card.
      const booked = cards.filter({ has: page.locator('.court-line') }).first();
      await booked.getByRole('button', { name: /^Session options/ }).click();
      await booked.getByRole('button', { name: 'Text', exact: true }).click();
      await booked.scrollIntoViewIfNeeded();
      await page.evaluate(() => window.scrollBy(0, -80));
      await snap('02-organizer-gear-panel');
      await booked.getByRole('button', { name: /^Session options/ }).click();
      // Add game sheet.
      await page.getByRole('button', { name: '+ Add game' }).click();
      await page.locator('dialog[open]').waitFor();
      await snap('03-add-game-sheet');
      await page.keyboard.press('Escape');
      // Edit booking sheet.
      await booked.getByRole('button', { name: /^Session options/ }).click();
      await booked.locator('.options').getByRole('button', { name: 'Edit booking' }).click();
      await page.locator('dialog[open]').waitFor();
      await snap('04-edit-booking-sheet');
      await page.keyboard.press('Escape');
      const tab = (n) => page.getByRole('navigation', { name: 'Organizer sections' }).getByRole('button', { name: new RegExp(`^${n}`) });
      await tab('Players').click();
      await page.locator('.player-list').waitFor();
      await snap('05-players');
      await tab('Money').click();
      await page.locator('.money-sum').waitFor();
      await snap('06-money');
      await tab('History').click();
      await page.getByRole('group', { name: 'Show' }).waitFor();
      await snap('07-history');
      await page.getByRole('button', { name: 'Activity' }).click();
      await page.waitForTimeout(300);
      await snap('08-history-activity');
      await tab('Settings').click();
      await page.locator('details.set-sect').first().waitFor();
      await snap('09-settings');
      await page.locator('details.set-sect').nth(1).locator('summary').click();
      await snap('10-settings-open');
      await page.locator('details.set-sect').nth(1).locator('summary').click();
      // View as Ryan.
      await tab('Home').click();
      await page.getByRole('button', { name: 'View as…' }).click();
      await page.locator('dialog[open]').waitFor();
      await snap('11-view-as-picker');
      await page.locator('dialog[open]').getByRole('button', { name: 'Ryan', exact: true }).click();
      await page.locator('.schedule article').first().waitFor();
      await page.waitForTimeout(200);
      await snap('12-player-view-as');
      await snap('13-player-full', true);
      await page.getByRole('button', { name: 'Not you?' }).click();
      await page.locator('.name-grid').waitFor();
      await snap('14-who-are-you');
      await ctx.close();

      // After the game: the Finalize card, Money once finalized, the player's credit chip and sheet.
      const after = await browser.newContext(phone(width, scheme));
      await fetch(`${BASE}/__dev/clock`, { method: 'POST', body: JSON.stringify({ atMs: Date.parse(nov[0].endsAt) + 30 * 60_000 }) });
      await post(after.request, '/api/admin/login', { pin: PIN });
      const ap = await after.newPage();
      await ap.goto(`${BASE}/admin`);
      await ap.locator(`[data-finalize="${nov[0].id}"]`).waitFor();
      await ap.screenshot({ path: path.join(OUT, `15-finalize-card-${width}-${scheme}.png`) });
      await ap.locator(`[data-finalize="${nov[0].id}"] [data-change-played]`).click();
      await ap.locator('[data-who-played]').waitFor();
      await ap.screenshot({ path: path.join(OUT, `16-who-played-${width}-${scheme}.png`) });
      await ap.locator('[data-confirm-played]').click();
      await ap.locator(`[data-finalize="${nov[0].id}"]`).waitFor({ state: 'detached' });
      await ap.getByRole('navigation', { name: 'Organizer sections' }).getByRole('button', { name: /^Money/ }).click();
      const sess = ap.locator(`details.money-sess[data-session="${nov[0].id}"]`);
      await sess.waitFor();
      await sess.evaluate((el) => (el.open = true));
      await sess.scrollIntoViewIfNeeded();
      await ap.screenshot({ path: path.join(OUT, `17-money-finalized-${width}-${scheme}.png`) });
      const pc = await browser.newContext(phone(width, scheme));
      await post(pc.request, '/api/me', { playerId: d.players.find((x) => x.name === 'Ryan').id });
      const pp = await pc.newPage();
      await pp.goto(BASE);
      await pp.locator('header [data-credit-chip]').waitFor();
      await pp.screenshot({ path: path.join(OUT, `18-player-credit-chip-${width}-${scheme}.png`) });
      await pp.locator('header [data-credit-chip]').click();
      await pp.locator('[data-credit-sheet]').waitFor();
      await pp.waitForTimeout(300);
      await pp.screenshot({ path: path.join(OUT, `19-player-credit-sheet-${width}-${scheme}.png`) });
      for (const n of ['15-finalize-card', '16-who-played', '17-money-finalized', '18-player-credit-chip', '19-player-credit-sheet']) shots.push(path.join(OUT, `${n}-${width}-${scheme}.png`));
      await pc.close();
      // Back before the game for the next width.
      await post(after.request, `/api/admin/sessions/${nov[0].id}/reopen`, {});
      await after.close();
      await fetch(`${BASE}/__dev/clock`, { method: 'POST', body: JSON.stringify({ atMs: Date.parse('2026-10-27T14:14:00-04:00') }) });
    }
  }
  await browser.close();
  console.log(`${shots.length} screenshots in ${path.relative(ROOT, OUT)}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
