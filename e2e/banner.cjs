/* The pop-up banner ("You're in", "You dropped out. Undo") on an iPhone-sized
 * screen (393 x 852): where it sits, that it never blocks a tap for longer than
 * needed, and that the 5-second Undo works.
 *
 *   node e2e/banner.cjs      (also run by npm run test:e2e)
 *
 * Starts its own dev server with a fresh fake group. Nothing here touches the
 * live site. The home-indicator space at the bottom of an iPhone is simulated by
 * setting --safe-bottom (the one place the CSS reads env(safe-area-inset-bottom)
 * for the banner), so "counted once, not twice" can be checked in a plain browser.
 */
const { spawn } = require('node:child_process');
const { rmSync, mkdirSync } = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.E2E_PORT) || 5194;
const BASE = `http://localhost:${PORT}`;
const SETUP_TOKEN = 'banner-setup-token-0123456789';
const PIN = '482913';
const NAMES = ['Alex', 'Ryan', 'Julian', 'Nathan', 'Mitchel', 'Brandon', 'Sam', 'Blair', 'Emery', 'Wren', 'Zed', 'Pia'];
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const VIEW = { width: 393, height: 852 };
/** The banner's bottom edge should end this far above the bottom of the visible screen (above the safe area). */
const GAP_MIN = 16;
const GAP_MAX = 24;

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

/** Where the banner is once it has finished fading in (it slides up the last 8px as it appears), against the visible screen. */
const measure = (page) =>
  page.locator('.pop').evaluate(async (el) => {
    await Promise.all(el.getAnimations().map((a) => a.finished.catch(() => {})));
    const r = el.getBoundingClientRect();
    const safe = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--safe-bottom')) || 0;
    return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, vh: window.innerHeight, safe, gap: window.innerHeight - r.bottom, open: el.matches(':popover-open'), pe: getComputedStyle(el).pointerEvents };
  });

async function main() {
  const dbFile = path.join(ROOT, '.data', 'banner.sqlite');
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
  // The page times Drop out with the browser's real clock, so the server's fake clock starts at the real time too.
  await fetch(`${BASE}/__dev/clock`, { method: 'POST', body: JSON.stringify({ atMs: Date.now() }) });

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
  const areq = (await browser.newContext()).request;
  await post(areq, '/api/admin/login', { pin: PIN });
  let d = await (await areq.get(`${BASE}/api/admin/dashboard`)).json();
  for (const h of d.hiddenSessions || []) await post(areq, `/api/admin/sessions/${h.id}/show`, { shown: true });
  d = await (await areq.get(`${BASE}/api/admin/dashboard`)).json();
  const games = d.sessions.filter((s) => !s.state.flags.past);
  for (const s of games) await post(areq, `/api/admin/sessions/${s.id}/booked`, {});
  const idOf = (n) => d.players.find((p) => p.name === n).id;
  // A game more than 3 days away: Drop out waits 5 seconds for Undo there (close to the start it is sent at once).
  const far = games.findIndex((g) => Date.parse(g.startsAt) - Date.now() > 3 * 86_400_000);
  if (far < 0 || far > 4) throw new Error(`no game 3+ days away among the first cards (${far})`);

  const phone = (colorScheme, reducedMotion = 'no-preference') => ({ viewport: VIEW, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme, reducedMotion, userAgent: UA });
  /** A fresh phone for one player: they start out in none of the games. */
  async function open(name, scheme = 'light', reducedMotion) {
    const ctx = await browser.newContext(phone(scheme, reducedMotion));
    await post(ctx.request, '/api/me', { playerId: idOf(name) });
    const page = await ctx.newPage();
    await page.goto(BASE);
    await page.locator('.schedule article').first().waitFor();
    return { ctx, page };
  }
  const cards = (page) => page.locator('.schedule article');
  const dropOut = async (page, card) => {
    await card.getByRole('button', { name: 'Drop out' }).click();
    await page.locator('dialog[open]').getByRole('button', { name: 'Drop out' }).click();
  };

  for (const scheme of ['light', 'dark']) {
    await check(`${scheme}: "You're in" sits ${GAP_MIN} to ${GAP_MAX} px above the bottom of the screen, centered, in the top layer`, async () => {
      const { ctx, page } = await open(scheme === 'light' ? 'Ryan' : 'Julian', scheme);
      await cards(page).nth(far).getByRole('button', { name: "I'm in" }).click();
      await page.locator('.pop').waitFor();
      const m = await measure(page);
      assert(m.open, 'banner is not in the top layer');
      assert(m.gap - m.safe >= GAP_MIN && m.gap - m.safe <= GAP_MAX, `banner ends ${m.gap}px above the bottom (safe area ${m.safe}px); want ${GAP_MIN} to ${GAP_MAX}px above the safe area`);
      assert(Math.abs((m.left + m.right) / 2 - VIEW.width / 2) < 3, 'banner is not centered');
      await ctx.close();
    });

    await check(`${scheme}: "You dropped out. Undo" sits ${GAP_MIN} to ${GAP_MAX} px above the bottom, and stays about 5 seconds`, async () => {
      const { ctx, page } = await open(scheme === 'light' ? 'Nathan' : 'Mitchel', scheme);
      const card = cards(page).nth(far);
      await card.getByRole('button', { name: "I'm in" }).click();
      await page.locator('.pop').waitFor({ state: 'detached', timeout: 4000 });
      await dropOut(page, card);
      const pop = page.locator('.pop');
      await pop.waitFor();
      const t0 = Date.now();
      assert(/You dropped out\./.test(await pop.innerText()) && /Undo/.test(await pop.innerText()), `banner said "${await pop.innerText()}"`);
      const m = await measure(page);
      assert(m.gap - m.safe >= GAP_MIN && m.gap - m.safe <= GAP_MAX, `banner ends ${m.gap}px above the bottom (safe area ${m.safe}px)`);
      await pop.waitFor({ state: 'detached', timeout: 8000 });
      const stayed = Date.now() - t0;
      assert(stayed >= 4700 && stayed <= 6200, `Undo banner was up ${stayed} ms, want about 5000`);
      await ctx.close();
    });
  }

  await check('the iPhone home-indicator space is counted once, not twice (--safe-bottom 34px)', async () => {
    const { ctx, page } = await open('Brandon');
    await page.evaluate(() => document.documentElement.style.setProperty('--safe-bottom', '34px'));
    await cards(page).nth(far).getByRole('button', { name: "I'm in" }).click();
    await page.locator('.pop').waitFor();
    const m = await measure(page);
    assert(m.safe === 34, `--safe-bottom was ${m.safe}`);
    assert(m.gap >= 34 + GAP_MIN && m.gap <= 34 + GAP_MAX, `with 34px of home-indicator space the banner ends ${m.gap}px above the bottom; want ${34 + GAP_MIN} to ${34 + GAP_MAX}`);
    await ctx.close();
  });

  await check('the 5-second Undo stays tappable the whole time, and Undo puts the player back in', async () => {
    const { ctx, page } = await open('Sam');
    const card = cards(page).nth(far);
    await card.getByRole('button', { name: "I'm in" }).click();
    await page.locator('.pop').waitFor({ state: 'detached', timeout: 4000 });
    await dropOut(page, card);
    const pop = page.locator('.pop');
    await pop.waitFor();
    // Still there and tappable late in the window (4 s in).
    await page.waitForTimeout(3800);
    const undo = pop.getByRole('button', { name: 'Undo' });
    const box = await undo.boundingBox();
    assert(box && box.height >= 44, `Undo tap area is ${box && box.height}px tall`);
    const hit = await page.evaluate(({ x, y }) => { const el = document.elementFromPoint(x, y); return !!el && !!el.closest('.toast-action'); }, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
    assert(hit, 'something else is on top of the Undo button');
    await undo.click();
    await pop.waitFor({ state: 'detached', timeout: 2000 });
    await card.getByRole('button', { name: 'Drop out' }).waitFor({ timeout: 3000 });
    await ctx.close();
  });

  await check('with the banner up, the page can be scrolled so no button or link is left under it', async () => {
    const { ctx, page } = await open('Blair');
    const card = cards(page).nth(far);
    await card.getByRole('button', { name: "I'm in" }).click();
    await page.locator('.pop').waitFor({ state: 'detached', timeout: 4000 });
    await dropOut(page, card);
    await page.locator('.pop').waitFor();
    const clear = await page.evaluate(() => {
      window.scrollTo(0, document.documentElement.scrollHeight);
      return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => {
        const pop = document.querySelector('.pop').getBoundingClientRect();
        // Everything tappable on the page (cards, the Drop out / I'm in buttons, "More sessions"), scrolled all the way down.
        const hits = [...document.querySelectorAll('main button, main a')].map((b) => b.getBoundingClientRect()).filter((r) => r.width && r.height && r.bottom > pop.top && r.top < pop.bottom && r.right > pop.left && r.left < pop.right);
        resolve({ covered: hits.length, popTop: pop.top, lowest: Math.max(...hits.map((r) => r.bottom), 0) });
      })));
    });
    assert(clear.covered === 0, `the banner still covers ${clear.covered} button(s) or link(s) even when the page is scrolled all the way down (banner top ${clear.popTop})`);
    await ctx.close();
  });

  await check('once the banner is gone nothing is left on top: the page scrolls and the cards underneath tap normally', async () => {
    const { ctx, page } = await open('Emery');
    await cards(page).nth(1).getByRole('button', { name: "I'm in" }).click();
    await page.locator('.pop').waitFor();
    await page.locator('.pop').waitFor({ state: 'detached', timeout: 4000 });
    assert((await page.locator('[popover]:popover-open').count()) === 0, 'a popover is still open');
    const before = await page.evaluate(() => window.scrollY);
    await page.mouse.wheel(0, 300);
    await page.evaluate(() => window.scrollBy(0, 300));
    assert((await page.evaluate(() => window.scrollY)) > before, 'the page does not scroll once the banner is gone');
    // The bottom strip is free: whatever is at the banner's old spot is the page, not a leftover layer.
    const top = await page.evaluate(({ w, h }) => { const el = document.elementFromPoint(w / 2, h - 40); return !!el && !el.closest('.pop'); }, { w: VIEW.width, h: VIEW.height });
    assert(top, 'a leftover banner layer is still catching taps at the bottom');
    await cards(page).nth(2).getByRole('button', { name: "I'm in" }).click();
    await page.locator('.pop').waitFor();
    await ctx.close();
  });

  await check('a banner that is leaving (fading and swiping away) no longer catches taps', async () => {
    const { ctx, page } = await open('Wren');
    await cards(page).first().getByRole('button', { name: "I'm in" }).click();
    const pop = page.locator('.pop');
    await pop.waitFor();
    // Close it early, and read what it does with taps the moment it starts to leave (before it is removed).
    const pe = await pop.evaluate((el) => {
      el.click();
      return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve({ cls: el.className, pe: getComputedStyle(el).pointerEvents }))));
    });
    assert(/leaving/.test(pe.cls), `banner did not start leaving: ${pe.cls}`);
    assert(pe.pe === 'none', `a leaving banner still catches taps (${pe.pe})`);
    await ctx.close();
  });

  await check('organizer screen: the banner stands just above the floating tab bar and never covers a tab', async () => {
    const ctx = await browser.newContext(phone('light'));
    await post(ctx.request, '/api/admin/login', { pin: PIN });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/admin`);
    const card = page.locator('section[aria-labelledby="sessions-title"] article').first();
    await card.waitFor();
    await card.getByRole('button', { name: "I'm in" }).click();
    await page.locator('.pop').waitFor();
    const m = await measure(page);
    const tab = await page.locator('.tabbar').evaluate((el) => { const r = el.getBoundingClientRect(); return { top: r.top }; });
    assert(m.bottom <= tab.top - 6, `banner (bottom ${m.bottom}) covers the tab bar (top ${tab.top})`);
    assert(tab.top - m.bottom <= 24, `banner floats ${tab.top - m.bottom}px above the tab bar, want at most 24px`);
    await ctx.close();
  });

  await check('Reduce Motion: the banner only fades (no slide or swipe) and still goes', async () => {
    const { ctx, page } = await open('Zed', 'light', 'reduce');
    await cards(page).first().getByRole('button', { name: "I'm in" }).click();
    const pop = page.locator('.pop');
    await pop.waitFor();
    const anim = await pop.evaluate((el) => getComputedStyle(el).animationName);
    assert(anim === 'banner-fade-in', `under Reduce Motion the banner should only fade (no slide), animation was ${anim}`);
    await pop.waitFor({ state: 'detached', timeout: 4000 });
    await ctx.close();
  });

  await browser.close();
  console.log(`\nbanner: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
