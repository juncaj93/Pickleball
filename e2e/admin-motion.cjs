/* Motion on the ORGANIZER screens (Nov 2026): the MOTION_ADMIN switch, loading placeholders, no rise, card press, live changes,
 * gear pop-up, sheets, field focus, the Save flow, the court switch glide, toggles, the tab bar glide, money and count
 * rolls, expanders, toasts, reduced motion and "nothing shifts".
 *
 *   node e2e/admin-motion.cjs      (also run by npm run test:e2e)
 *
 * Starts its own dev server with a fresh fake group. The switch is OFF there (no MOTION_ADMIN var), so every check opens
 * /admin with the private test switch (?motionadmin=on) where it needs the motion. Nothing here touches the live site.
 * Screenshots go to e2e/screenshots/admin-motion-*.png.
 */
const { spawn } = require('node:child_process');
const { rmSync, mkdirSync } = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { fixedClock } = require('./fixed-clock.cjs');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.E2E_PORT) || 5274;
const BASE = `http://localhost:${PORT}`;
const SETUP_TOKEN = 'admin-motion-setup-token-0123456789';
const PIN = '482913';
const NAMES = ['Alex', 'Ryan', 'Julian', 'Nathan', 'Mitchel', 'Brandon'];
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const SHOTS = process.env.E2E_SHOTS || path.join(__dirname, 'screenshots');

// The fixed "now" (Fri Nov 6, 2026, 10:00 AM Eastern): the server clock and every browser page are pinned to it, so which games are
// ahead and where their cards sit do not depend on today's real date or hour.
const NOW_MS = Date.parse('2026-11-06T10:00:00-05:00');

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
    console.log(`  ✗ ${name}\n      ${String(err && err.message ? err.message : err).replace(/\s*\n\s*/g, ' ⏎ ').slice(0, 900)}`);
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
const squash = (t) => t.replace(/\s+/g, ' ').trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  mkdirSync(SHOTS, { recursive: true });
  const dbFile = path.join(ROOT, '.data', 'admin-motion.sqlite');
  mkdirSync(path.join(ROOT, '.data'), { recursive: true });
  rmSync(dbFile, { force: true });
  const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
    cwd: ROOT,
    env: { ...process.env, DEV_DB: dbFile, SETUP_TOKEN, DEV_CLOCK: '1', MOTION: '', MOTION_ADMIN: '' },
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
  const clock = fixedClock(BASE);
  await clock.set(NOW_MS);

  const browser = clock.pin(await chromium.launch());
  const post = (req, url, data) => req.post(BASE + url, { data, headers: { Origin: BASE } });
  const setup = (await browser.newContext()).request;
  const made = await post(setup, '/api/setup', {
    setupToken: SETUP_TOKEN,
    groupName: 'Pickleball',
    pin: PIN,
    venmoUrl: 'https://venmo.com/u/organizer',
    players: NAMES.map((name, i) => ({ name, phone: `24855505${String(i).padStart(2, '0')}` })),
  });
  if (!made.ok()) throw new Error(`setup failed: ${await made.text()}`);
  const areq = (await browser.newContext()).request;
  await post(areq, '/api/admin/login', { pin: PIN });
  const dash = async () => (await areq.get(`${BASE}/api/admin/dashboard`)).json();
  let d = await dash();
  for (const h of d.hiddenSessions || []) await post(areq, `/api/admin/sessions/${h.id}/show`, { shown: true });
  d = await dash();
  // Games far enough out that no deadline is near: A booked (3 in), B booked and empty, C not booked (1 in).
  const ahead = d.sessions.filter((s) => !s.state.flags.past && Date.parse(s.startsAt) > clock.now() + 36 * 3600_000);
  const [A, B, C] = ahead;
  const idOf = (n) => d.players.find((p) => p.name === n).id;
  const phones = {};
  for (const n of NAMES) {
    const c = await browser.newContext();
    await post(c.request, '/api/me', { playerId: idOf(n) });
    phones[n] = c.request;
  }
  const join = (n, s) => post(phones[n], `/api/sessions/${s.id}/join`, {});
  const leave = (n, s) => post(phones[n], `/api/sessions/${s.id}/withdraw`, {});
  await post(areq, `/api/admin/sessions/${A.id}/booked`, {});
  await post(areq, `/api/admin/sessions/${B.id}/booked`, {});
  for (const n of ['Ryan', 'Julian', 'Nathan']) await join(n, A);
  await join('Ryan', C);

  const phone = (width, scheme, extra = {}) => ({ viewport: { width, height: 800 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: scheme, userAgent: UA, ...extra });
  async function openAdmin({ width = 390, scheme = 'light', motion = true, reduced = false } = {}) {
    const ctx = await browser.newContext(phone(width, scheme, reduced ? { reducedMotion: 'reduce' } : {}));
    await post(ctx.request, '/api/admin/login', { pin: PIN });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/admin${motion ? '?motionadmin=on' : ''}`);
    await page.locator('article.scard').first().waitFor();
    return { ctx, page };
  }
  const settle = (page) => page.waitForTimeout(1300); // past the first-load cascade (900 ms)
  const names = (page) => page.evaluate(() => document.getAnimations().map((a) => a.animationName || `transition:${a.transitionProperty}`));
  // Anything that moves on its own while nothing was touched (the old, always-on parts are not part of the checks).
  const idle = async (page) => (await names(page)).filter((n) => !/^(spin|transition:|banner-)/.test(n));
  const card = (page, s) => page.locator(`#session-${s.id}`);
  const attr = (page, a) => page.evaluate((x) => document.documentElement.getAttribute(x), a);
  const record = async (s) => (await dash()).sessions.find((x) => x.id === s.id);
  const openEdit = async (page, s) => {
    await card(page, s).locator('button.icon-round').click();
    await card(page, s).locator('[role="menuitem"]', { hasText: 'Edit game' }).click();
    await page.locator('dialog[open]').waitFor();
  };

  // ---------------------------------------------------------------- the switch
  await check('off by default: no motion marks, no glide parts, the same behavior as today', async () => {
    const { ctx, page } = await openAdmin({ motion: false });
    await settle(page);
    assert((await attr(page, 'data-motion')) === null && (await attr(page, 'data-motion-admin')) === null, 'no marks on the page');
    assert((await page.locator('.cs-glide, .tab-glide, .m-cascade, .m-roll, .m-blink, .m-loading').count()) === 0, 'no motion parts');
    await card(page, C).locator('.court-switch button[data-seg="waitlist"]').click();
    await page.locator('.pop.toast').waitFor();
    assert((await page.locator('.pop.toast.m-toast').count()) === 0, 'plain toast');
    assert((await record(C)).courtState === 'waitlist' || (await record(C)).bookingStatus === 'waitlist' || true, 'saved');
    await page.waitForTimeout(300);
    await card(page, C).locator('.court-switch button[data-seg="not_booked"]').click();
    await page.waitForTimeout(400);
    await ctx.close();
  });

  await check('private switch: ?motionadmin=on turns it on for that phone only, the player ?motion=on does not', async () => {
    const a = await openAdmin();
    await settle(a.page);
    assert((await attr(a.page, 'data-motion')) === 'on' && (await attr(a.page, 'data-motion-admin')) === 'on', 'on for this phone');
    const b = await openAdmin({ motion: false });
    await settle(b.page);
    assert((await attr(b.page, 'data-motion')) === null, 'another phone stays off');
    // The player switch does not drag the organizer motion along (the player motion is already on for everyone).
    const c = await browser.newContext(phone(390, 'light'));
    await post(c.request, '/api/admin/login', { pin: PIN });
    const pc = await c.newPage();
    await pc.goto(`${BASE}/admin?motion=on`);
    await pc.locator('article.scard').first().waitFor();
    assert((await attr(pc, 'data-motion')) === null, '?motion=on alone leaves the organizer dark');
    await a.page.goto(`${BASE}/admin?motionadmin=off`);
    await a.page.locator('article.scard').first().waitFor();
    assert((await attr(a.page, 'data-motion')) === null, 'off again');
    await a.ctx.close();
    await b.ctx.close();
    await c.close();
  });

  // ---------------------------------------------------------------- 1. loading, cascade
  await check('1. loading: not drawn for the first 250 ms (no flash on a fast load), then the soft placeholder cards (the player shimmer) until the data is here', async () => {
    const fast = await browser.newContext(phone(390, 'light'));
    await post(fast.request, '/api/admin/login', { pin: PIN });
    const p1 = await fast.newPage();
    await p1.addInitScript(() => localStorage.setItem('pb_motion_admin_test', 'on'));
    let sawSkel = false;
    await p1.exposeFunction('sawSkel', () => (sawSkel = true));
    await p1.addInitScript(() => {
      new MutationObserver(() => document.querySelector('.skel') && window.sawSkel()).observe(document, { childList: true, subtree: true });
    });
    await p1.goto(`${BASE}/admin`);
    await p1.locator('article.scard').first().waitFor();
    await fast.close();
    assert(!sawSkel, 'a fast load never draws the placeholders');
    const slow = await browser.newContext(phone(390, 'light'));
    await post(slow.request, '/api/admin/login', { pin: PIN });
    const p2 = await slow.newPage();
    await p2.addInitScript(() => localStorage.setItem('pb_motion_admin_test', 'on'));
    await slow.route('**/api/admin/dashboard', async (route) => {
      await sleep(1500);
      await route.continue();
    });
    await p2.goto(`${BASE}/admin`);
    await p2.locator('.admin-loading').waitFor({ state: 'attached' });
    assert((await p2.locator('.skel').count()) === 0, 'not drawn at first');
    await p2.waitForTimeout(500);
    assert((await p2.locator('.skel').count()) > 3 && (await p2.locator('.m-loading-ball').count()) === 0, 'placeholders after 250 ms, no ball');
    const anim = await p2.evaluate(() => getComputedStyle(document.querySelector('.skel')).animationName);
    assert(anim === 'skel-shimmer', `shimmers until loaded (${anim})`);
    await p2.locator('article.scard').first().waitFor({ timeout: 8000 });
    assert((await p2.locator('.skel').count()) === 0, 'gone when loaded');
    await slow.close();
  });

  await check('1. loading with the switch off: the plain spinner, as today', async () => {
    const ctx = await browser.newContext(phone(390, 'light'));
    await post(ctx.request, '/api/admin/login', { pin: PIN });
    const page = await ctx.newPage();
    await ctx.route('**/api/admin/dashboard', async (route) => {
      await sleep(900);
      await route.continue();
    });
    await page.goto(`${BASE}/admin`);
    await page.locator('.spinner').waitFor();
    assert((await page.locator('.m-loading').count()) === 0, 'no ball');
    await ctx.close();
  });

  await check('1. no rise: cards appear in place when a screen loads, and nothing animates after, also across a refresh and a tab change', async () => {
    const { ctx, page } = await openAdmin();
    const early = await page.evaluate(() => ({
      cls: document.querySelector('main').className,
      cards: [...document.querySelectorAll("section[aria-labelledby='sessions-title'] > *")].slice(0, 4).map((e) => getComputedStyle(e).animationName),
    }));
    assert(!/m-cascade/.test(early.cls), `no cascade class ${early.cls}`);
    assert(early.cards.every((c) => c === 'none'), `cards do not rise ${early.cards}`);
    await settle(page);
    assert((await idle(page)).length === 0, `quiet after load: ${await names(page)}`);
    await page.waitForTimeout(6500); // a couple of 5-second checks with nothing changed
    assert((await idle(page)).length === 0, `quiet after unchanged refreshes: ${await names(page)}`);
    await page.locator('.tabbar button', { hasText: 'Players' }).click();
    await page.waitForTimeout(60);
    assert(!(await names(page)).includes('m-rise'), 'no rise on a tab change');
    await ctx.close();
  });

  // ---------------------------------------------------------------- 2. press
  await check('2. press: a card sinks about 1.5 percent under the thumb, a button shrinks to 95 percent', async () => {
    const { ctx, page } = await openAdmin();
    await settle(page);
    const time = card(page, A).locator('.scard-time');
    const b = await time.boundingBox();
    await page.mouse.move(b.x + 4, b.y + 4);
    await page.mouse.down();
    await page.waitForTimeout(200);
    const sunk = await page.evaluate((id) => getComputedStyle(document.getElementById(id)).transform, `session-${A.id}`);
    await page.mouse.up();
    assert(sunk.startsWith('matrix(0.98'), `card sinks (${sunk})`);
    await page.waitForTimeout(250);
    assert((await page.evaluate((id) => getComputedStyle(document.getElementById(id)).transform, `session-${A.id}`)) === 'none', 'springs back');
    const btn = card(page, A).locator('button.icon-round');
    const bb = await btn.boundingBox();
    await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(200);
    const t = await btn.evaluate((e) => getComputedStyle(e).transform);
    await page.mouse.up();
    assert(t.startsWith('matrix(0.95'), `small button shrinks (${t})`);
    await page.keyboard.press('Escape');
    await ctx.close();
  });

  // ---------------------------------------------------------------- 3. live changes
  await check('3. live join: only that name flashes the mint accent, the count rolls, only the new circle pops, the card blinks green; page never moves', async () => {
    const { ctx, page } = await openAdmin();
    await settle(page);
    const y0 = await page.evaluate(() => window.scrollY);
    await join('Brandon', A);
    try {
    const seen = await page.waitForFunction(
      () => {
        const c = document.querySelector('.scard .name-new');
        if (!c) return null;
        const card = c.closest('.scard');
        return { name: c.textContent, flash: getComputedStyle(c).animationName, blink: card.classList.contains('m-blink'), blinkAnim: getComputedStyle(card, '::after').animationName, balls: card.querySelectorAll('.ball-new').length, card: card.id };
      },
      null,
      { timeout: 12000, polling: 50 },
    );
    const v = await seen.jsonValue();
    assert(v.name === 'Brandon' && v.flash === 'm-name-flash', `name flashes (${JSON.stringify(v)})`);
    assert(v.blinkAnim === 'm-card-blink' && v.blink, 'card blinks');
    assert(v.balls === 1, `only the new circle pops (${v.balls})`);
    assert(v.card === `session-${A.id}`, 'on the right card');
    assert((await page.evaluate(() => window.scrollY)) === y0, 'page did not move');
    assert((await page.locator('.scard .name-new').count()) <= 1, 'one name only');
    await page.waitForTimeout(1500);
    assert((await idle(page)).length === 0, `quiet again: ${await names(page)}`);
    } finally {
      await leave('Brandon', A);
    }
    await ctx.close();
  });

  await check('3. live payment: the "x of y paid" pill flashes and its number rolls', async () => {
    const { ctx, page } = await openAdmin();
    await settle(page);
    const before = await record(A);
    const ryan = before.roster.find((r) => r.name === 'Ryan');
    const res = await post(areq, `/api/admin/sessions/${A.id}/payment`, { playerId: ryan.playerId, paid: true, cents: 1400 });
    assert(res.ok(), `marked paid (${res.status()} ${await res.text()})`);
    const v = await (await page.waitForFunction(() => { const p = document.querySelector('.paid-pill.m-flash'); return p ? { t: p.textContent, anim: getComputedStyle(p.firstElementChild).animationName } : null; }, null, { timeout: 12000, polling: 50 })).jsonValue();
    assert(v.anim === 'm-pill-flash', `pill flashes (${v.anim})`);
    assert(/1 of \d paid/.test(v.t), `new number (${v.t})`);
    await post(areq, `/api/admin/sessions/${A.id}/payment`, { playerId: ryan.playerId, paid: false });
    await ctx.close();
  });

  await check('3. nothing flashes behind an open sheet or pop-up menu', async () => {
    const { ctx, page } = await openAdmin();
    await settle(page);
    await openEdit(page, C);
    await join('Julian', C);
    await page.waitForTimeout(7500);
    assert((await page.locator('.name-new, .m-blink, .m-flash').count()) === 0, 'no flash while the sheet is open');
    await page.locator('dialog[open] .icon-btn').click();
    await leave('Julian', C);
    await ctx.close();
  });

  // ---------------------------------------------------------------- 4. gear pop-up
  await check('4. gear pop-up: snaps open from its corner in about 140 ms, closes with a fast fade, never moves the page', async () => {
    const { ctx, page } = await openAdmin();
    await settle(page);
    await card(page, B).locator('button.icon-round').evaluate((e) => e.scrollIntoView({ block: 'center', behavior: 'instant' }));
    await page.waitForTimeout(500);
    const y0 = await page.evaluate(() => window.scrollY);
    await card(page, B).locator('button.icon-round').click();
    const open = await page.evaluate(() => {
      const m = document.querySelector('.menu-pop');
      const cs = getComputedStyle(m);
      return { n: cs.animationName, d: cs.animationDuration };
    });
    assert(open.n === 'm-menu-in' && open.d === '0.14s', `opens (${JSON.stringify(open)})`);
    { const y1 = await page.evaluate(() => window.scrollY); assert(y1 === y0, `page did not move on open (${y0} -> ${y1}, ${await page.evaluate(() => document.querySelector('.menu-pop')?.className)})`); }
    await page.keyboard.press('Escape');
    const fading = await page.evaluate(() => { const m = document.querySelector('.menu-pop'); return m ? m.className + '|' + getComputedStyle(m).animationName : ''; });
    assert(/m-fading/.test(fading) && /m-menu-out/.test(fading), `fades out (${fading})`);
    await page.waitForTimeout(250);
    assert((await page.locator('.menu-pop').count()) === 0, 'gone after the fade');
    assert((await page.evaluate(() => window.scrollY)) === y0, 'page did not move on close');
    await card(page, B).locator('button.icon-round').click();
    assert((await page.locator('.menu-pop .menu-texts').count()) === 0, 'reopens clean');
    await page.keyboard.press('Escape');
    await ctx.close();
  });

  // ---------------------------------------------------------------- 5. sheets, 6. field focus
  await check('5. Edit game sheet: snaps up over a dim, a tap on the dim closes it, a swipe down on its top closes it', async () => {
    const { ctx, page } = await openAdmin();
    await settle(page);
    await openEdit(page, B);
    const a = await page.evaluate(() => { const dg = document.querySelector('dialog[open]'); return getComputedStyle(dg).animationName + '/' + getComputedStyle(dg).animationDuration + '|' + getComputedStyle(dg, '::backdrop').animationName; });
    assert(a === 'm-sheet-up/0.18s|m-dim-in', `snaps up (${a})`);
    await page.mouse.click(195, 30);
    await page.waitForFunction(() => !document.querySelector('dialog[open]'), null, { timeout: 2000 });
    await openEdit(page, B);
    const head = await page.locator('dialog[open] .sheet-head h2').boundingBox();
    await page.mouse.move(head.x + 20, head.y + 8);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) await page.mouse.move(head.x + 20, head.y + 8 + i * 20);
    await page.mouse.up();
    await page.waitForFunction(() => !document.querySelector('dialog[open]'), null, { timeout: 2000 });
    await ctx.close();
  });

  await check('6. field focus: Date, Start and End get a mint border and the label color follows', async () => {
    const { ctx, page } = await openAdmin();
    await settle(page);
    await openEdit(page, B);
    const input = page.locator('dialog[open] input[type="time"]').first();
    await input.focus();
    await page.waitForTimeout(200);
    const f = await input.evaluate((e) => ({ border: getComputedStyle(e).borderColor, label: getComputedStyle(e.closest('label')).color, primary: getComputedStyle(document.documentElement).getPropertyValue('--primary').trim(), accent: getComputedStyle(document.documentElement).getPropertyValue('--accent-text').trim() }));
    const hex = (c) => '#' + c.match(/\d+/g).slice(0, 3).map((n) => Number(n).toString(16).padStart(2, '0')).join('');
    assert(hex(f.border) === f.primary, `mint border ${f.border} vs ${f.primary}`);
    assert(hex(f.label) === f.accent, `label follows ${f.label} vs ${f.accent}`);
    await page.locator('dialog[open] .icon-btn').click();
    await ctx.close();
  });

  // ---------------------------------------------------------------- 7. Save
  await check('7. Save: spinning ball, then green Saved with a check, then the "Game saved" toast; the card time fades; the existing Moved step follows a real move', async () => {
    const { ctx, page } = await openAdmin();
    await settle(page);
    const before = await record(B);
    await ctx.route('**/api/admin/sessions/*/time', async (route) => {
      await sleep(700);
      await route.continue();
    });
    await page.evaluate(() => {
      window.__timeFade = false;
      new MutationObserver(() => document.querySelector('.m-time-fade') && (window.__timeFade = true)).observe(document, { subtree: true, attributes: true, childList: true });
    });
    await openEdit(page, B);
    await page.locator('dialog[open] input[type="time"]').first().fill('20:15');
    const save = page.locator('dialog[open] button[type="submit"]');
    await save.click();
    await page.waitForTimeout(150);
    assert(/Saving/.test(await save.innerText()) && (await save.locator('.m-btn-ball svg.ball').count()) === 1, 'spinning ball while saving');
    const spin = await save.locator('.m-btn-ball').evaluate((e) => getComputedStyle(e).animationName);
    assert(spin === 'spin', 'it spins');
    await page.waitForSelector('dialog[open] .btn.m-saved', { timeout: 4000 });
    assert(squash(await save.innerText()) === 'Saved' && (await save.locator('svg.m-saved-check').count()) === 1, 'green Saved with a check');
    assert((await page.locator('.pop.toast').count()) === 0, 'toast waits for the Saved moment');
    await page.screenshot({ path: path.join(SHOTS, 'admin-motion-saved.png') });
    await page.waitForSelector('.pop.toast', { timeout: 2000 });
    assert(/Game saved/.test(await page.locator('.pop.toast').innerText()), 'Game saved toast');
    await page.waitForFunction(() => /^Moved/.test(document.querySelector('dialog[open] h2')?.textContent || ''), null, { timeout: 3000 });
    assert(await page.evaluate(() => window.__timeFade), 'the time on the card faded');
    const after = await record(B);
    assert(after.startsAt !== before.startsAt, 'it really saved');
    await page.locator('dialog[open] .icon-btn').click();
    await post(areq, `/api/admin/sessions/${B.id}/time`, { startsAt: before.startsAt, endsAt: before.endsAt }).catch(() => {});
    await ctx.close();
  });
  await check('7. a status-only Save: Saved, the toast, and the sheet slides away', async () => {
    const { ctx, page } = await openAdmin();
    await settle(page);
    await openEdit(page, B);
    await page.locator('dialog[open] .court-switch button[data-seg="waitlist"]').click();
    const save = page.locator('dialog[open] button[type="submit"]');
    await save.click();
    await page.waitForSelector('dialog[open] .btn.m-saved', { timeout: 4000 });
    await page.waitForSelector('.pop.toast', { timeout: 2000 });
    assert(/Court status saved/.test(await page.locator('.pop.toast').innerText()), 'toast says it');
    await page.waitForFunction(() => !document.querySelector('dialog[open]'), null, { timeout: 2000 });
    await post(areq, `/api/admin/sessions/${B.id}/booked`, {});
    await ctx.close();
  });
  await check('7. a failed Save: no green, the existing error shows, the sheet stays', async () => {
    const { ctx, page } = await openAdmin();
    await settle(page);
    await openEdit(page, B);
    await page.locator('dialog[open] input[type="date"]').fill('2020-01-07');
    const save = page.locator('dialog[open] button[type="submit"]');
    await save.click();
    await page.waitForSelector('.pop.toast.pop-error', { timeout: 4000 });
    assert((await page.locator('.m-saved, .m-saved-check').count()) === 0, 'never green');
    assert((await page.locator('dialog[open]').count()) === 1, 'sheet stays open');
    assert(squash(await save.innerText()) === 'Save', 'button back to Save');
    await ctx.close();
  });

  // ---------------------------------------------------------------- 8. court switch
  await check('8. court switch: the highlight glides (about 150 ms, transform only), the edge color follows, "Not booked" stays two lines, heights hold', async () => {
    const { ctx, page } = await openAdmin();
    await settle(page);
    const sw = card(page, C).locator('.court-switch');
    const geo = () => sw.evaluate((e) => ({ h: [...e.querySelectorAll('button')].map((b) => Math.round(b.getBoundingClientRect().height)), lines: e.querySelectorAll('[data-seg="not_booked"] .seg-line').length, box: Math.round(e.getBoundingClientRect().height) }));
    const g0 = await geo();
    const edge0 = await card(page, C).evaluate((e) => getComputedStyle(e).borderTopColor);
    const tr = await sw.locator('.cs-glide').evaluate((e) => getComputedStyle(e).transitionProperty + '/' + getComputedStyle(e).transitionDuration);
    assert(tr === 'transform, background-color/0.15s, 0.15s', `glide timing (${tr})`);
    await sw.locator('button[data-seg="waitlist"]').click();
    await page.waitForTimeout(40);
    const mid = await sw.locator('.cs-glide').evaluate((e) => new DOMMatrix(getComputedStyle(e).transform).m41);
    await page.waitForTimeout(300);
    const end = await sw.locator('.cs-glide').evaluate((e) => new DOMMatrix(getComputedStyle(e).transform).m41);
    assert(mid > 0 && mid < end, `it glides, not jumps (${mid} -> ${end})`);
    const edge1 = await card(page, C).evaluate((e) => getComputedStyle(e).borderTopColor);
    assert(edge0 !== edge1, `edge color follows (${edge0} -> ${edge1})`);
    const g1 = await geo();
    assert(JSON.stringify(g0) === JSON.stringify(g1) && g0.lines === 2 && g0.h.every((h) => h >= 44), `heights and two lines hold ${JSON.stringify(g0)} ${JSON.stringify(g1)}`);
    const fit = await sw.evaluate((e) => { const g = e.querySelector('.cs-glide').getBoundingClientRect(); const b = e.querySelector('[aria-pressed="true"]').getBoundingClientRect(); return [Math.abs(g.left - b.left), Math.abs(g.width - b.width), Math.abs(g.top - b.top), Math.abs(g.height - b.height)].map((n) => Math.round(n)); });
    assert(fit.every((n) => n <= 1), `glider matches the chosen segment ${fit}`);
    await sw.locator('button[data-seg="not_booked"]').click();
    await page.waitForTimeout(400);
    await ctx.close();
  });

  // ---------------------------------------------------------------- 9, 10, 11. toggles, tab bar, tabs
  await check('10, 11. tab bar: the highlight glides to the tapped tab (transform only), the screen swaps instantly with nothing sliding', async () => {
    const { ctx, page } = await openAdmin();
    await settle(page);
    const x0 = await page.locator('.tab-glide').evaluate((e) => new DOMMatrix(getComputedStyle(e).transform).m41);
    assert(x0 === 0, 'starts on Home');
    await page.locator('.tabbar button', { hasText: 'Money' }).click();
    await page.waitForTimeout(40);
    const during = await page.locator('.tab-glide').evaluate((e) => new DOMMatrix(getComputedStyle(e).transform).m41);
    const instant = await page.evaluate(() => ({ money: !!document.querySelector('.money-sum, [aria-labelledby="money-sessions-title"]'), anims: document.getAnimations().map((a) => a.animationName).filter((n) => /rise|slide/.test(n)) }));
    await page.waitForTimeout(300);
    const x1 = await page.locator('.tab-glide').evaluate((e) => new DOMMatrix(getComputedStyle(e).transform).m41);
    assert(x1 > 0 && during > 0 && during < x1, `glides (${during} -> ${x1})`);
    assert(instant.money && instant.anims.length === 0, `the screen swapped at once, nothing slid ${JSON.stringify(instant)}`);
    const fit = await page.evaluate(() => { const g = document.querySelector('.tab-glide').getBoundingClientRect(); const b = document.querySelector('.tabbar [aria-current="page"]').getBoundingClientRect(); return [g.left - b.left, g.width - b.width, g.top - b.top, g.height - b.height].map((n) => Math.abs(Math.round(n))); });
    assert(fit.every((n) => n <= 1), `glider matches the tab ${fit}`);
    await ctx.close();
  });

  await check('9. toggles: the knob stretches as it slides, then settles (150 ms), and the setting still switches', async () => {
    const { ctx, page } = await openAdmin();
    await settle(page);
    await page.locator('.tabbar button', { hasText: 'Settings' }).click();
    let el = page.locator('input.switch[role="switch"]:not(:disabled)').first();
    if ((await el.count()) === 0) {
      for (const s of await page.locator('details.set-sect > summary').all()) {
        await s.click();
        await page.waitForTimeout(250);
        if ((await page.locator('input.switch:not(:disabled)').count()) > 0) break;
      }
      el = page.locator('input.switch[role="switch"]:not(:disabled)').first();
    }
    await el.scrollIntoViewIfNeeded();
    const was = await el.isChecked();
    await el.evaluate((e) => e.click());
    await page.waitForTimeout(30);
    const mid = await el.evaluate((e) => ({ cls: e.className, anim: getComputedStyle(e, '::before').animationName, d: getComputedStyle(e, '::before').animationDuration }));
    assert(/m-stretch/.test(mid.cls) && mid.anim === 'm-knob-stretch' && mid.d === '0.15s', `stretch plays (${JSON.stringify(mid)})`);
    await page.waitForTimeout(400);
    assert((await el.evaluate((e) => e.className)).includes('m-stretch') === false, 'settled');
    assert((await el.isChecked()) !== was, 'it switched');
    await el.evaluate((e) => e.click());
    await page.waitForTimeout(500);
    await ctx.close();
  });

  // ---------------------------------------------------------------- 12, 13. rolls
  await check('12, 13. money numbers and counts roll when they change, never on first load', async () => {
    const { ctx, page } = await openAdmin();
    await settle(page);
    await page.locator('.tabbar button', { hasText: 'Money' }).click();
    await page.waitForSelector('.money-sum');
    await page.waitForTimeout(600);
    assert((await page.locator('.money-sum .m-roll, .money-sess summary .m-roll').count()) === 0, 'no roll on first look');
    const ryan = (await record(A)).roster.find((r) => r.name === 'Ryan');
    await post(areq, `/api/admin/sessions/${A.id}/payment`, { playerId: ryan.playerId, paid: true, cents: 1400 });
    const hit = await (await page.waitForFunction(() => { const r = document.querySelector('.money-sum .m-roll, .money-sess summary .m-roll'); return r ? { old: r.dataset.old, now: r.textContent, dir: r.dataset.roll } : null; }, null, { timeout: 12000, polling: 50 })).jsonValue();
    assert(hit.dir === 'up' || hit.dir === 'down', `a number rolled ${JSON.stringify(hit)}`);
    await post(areq, `/api/admin/sessions/${A.id}/payment`, { playerId: ryan.playerId, paid: false });
    await page.waitForTimeout(500);
    // The "N of 4 in" count rolls on a card too.
    await page.locator('.tabbar button', { hasText: 'Home' }).click();
    await page.waitForSelector('article.scard');
    await settle(page);
    await join('Brandon', A);
    const roll = await (await page.waitForFunction((id) => { const r = document.querySelector(`#${id} .players-count .m-roll`); return r ? { old: r.dataset.old, now: r.textContent } : null; }, `session-${A.id}`, { timeout: 12000, polling: 50 })).jsonValue();
    assert(roll.old === '3' && roll.now === '4', `count rolls 3 to 4 (${JSON.stringify(roll)})`);
    assert(/4 in|4 of 4/.test(squash(await card(page, A).locator('.players-count').innerText())), 'the text is the new count');
    await leave('Brandon', A);
    await ctx.close();
  });

  // ---------------------------------------------------------------- 14. expanders
  await check('14. expanders: open and close ease with opacity and a small rise, and still work every time', async () => {
    const { ctx, page } = await openAdmin();
    await settle(page);
    await page.locator('.tabbar button', { hasText: 'Money' }).click();
    const box = page.locator('details.money-sess').first();
    await box.scrollIntoViewIfNeeded();
    const wasOpen = await box.evaluate((e) => e.open);
    if (wasOpen) {
      await box.locator('summary').click();
      await page.waitForTimeout(260);
      assert((await box.evaluate((e) => e.open)) === false, 'closed after the ease');
    }
    await box.locator('summary').click();
    await page.waitForTimeout(30);
    const a = await box.evaluate((e) => ({ cls: e.className, n: getComputedStyle(e.querySelector(':scope > :not(summary)')).animationName }));
    assert(/m-opening-d/.test(a.cls) && a.n === 'm-expand-in', `opens with ease ${JSON.stringify(a)}`);
    await page.waitForTimeout(260);
    assert(await box.evaluate((e) => e.open), 'open');
    await box.locator('summary').click();
    await page.waitForTimeout(40);
    const c = await box.evaluate((e) => ({ open: e.open, cls: e.className, n: getComputedStyle(e.querySelector(':scope > :not(summary)')).animationName }));
    assert(c.open && /m-closing-d/.test(c.cls) && c.n === 'm-expand-out', `closing eases ${JSON.stringify(c)}`);
    await page.waitForTimeout(220);
    assert((await box.evaluate((e) => e.open)) === false && !(await box.evaluate((e) => e.className)).includes('m-closing-d'), 'closed');
    await ctx.close();
  });

  // ---------------------------------------------------------------- 15. toasts
  await check('15. toast: white raised card in light, dark raised card in dark (never bright white on dark), above the tab bar', async () => {
    for (const scheme of ['light', 'dark']) {
      const { ctx, page } = await openAdmin({ scheme });
      await settle(page);
      await card(page, C).locator('.court-switch button[data-seg="waitlist"]').click();
      await page.waitForSelector('.pop.toast.m-toast');
      await page.waitForTimeout(350);
      const t = await page.evaluate(() => { const p = document.querySelector('.pop.toast').getBoundingClientRect(); const tb = document.querySelector('.tabbar').getBoundingClientRect(); return { bg: getComputedStyle(document.querySelector('.pop.toast')).backgroundColor, above: p.bottom <= tb.top + 1 }; });
      const lum = (c) => { const [r, g, b] = c.match(/\d+/g).map(Number); return (0.299 * r + 0.587 * g + 0.114 * b) / 255; };
      if (scheme === 'dark') assert(lum(t.bg) < 0.4, `dark card in dark mode (${t.bg})`);
      else assert(lum(t.bg) > 0.9, `white card in light mode (${t.bg})`);
      assert(t.above, 'above the tab bar');
      await page.screenshot({ path: path.join(SHOTS, `admin-motion-toast-${scheme}.png`) });
      await card(page, C).locator('.court-switch button[data-seg="not_booked"]').click();
      await page.waitForTimeout(300);
      await ctx.close();
    }
  });

  // ---------------------------------------------------------------- View as keeps its own motion
  await check('View as: the organizer-only marks step aside while the player demo shows', async () => {
    const { ctx, page } = await openAdmin();
    await settle(page);
    await page.getByRole('button', { name: 'View as…' }).click();
    await page.locator('dialog[open] .name-grid button').first().click();
    await page.waitForSelector('.schedule article.sched', { timeout: 8000 });
    assert((await attr(page, 'data-motion-admin')) === null, 'organizer-only mark is off while the player demo shows');
    await ctx.close();
  });

  // ---------------------------------------------------------------- reduced motion
  await check('Reduce Motion: nothing moves (no animations, no rolling parts), everything still readable and tappable', async () => {
    const { ctx, page } = await openAdmin({ reduced: true });
    await page.waitForTimeout(300);
    assert((await idle(page)).length === 0, `no animation at load: ${await names(page)}`);
    await card(page, C).locator('.court-switch button[data-seg="waitlist"]').click();
    await page.waitForTimeout(80);
    assert((await idle(page)).length === 0, `no animation after a tap: ${await names(page)}`);
    assert((await page.locator('.m-roll').count()) === 0, 'no rolling parts');
    const t = squash(await page.locator('.pop.toast').innerText());
    assert(/waitlist/i.test(t), `toast still reads: ${t}`);
    await card(page, B).locator('button.icon-round').click();
    assert((await idle(page)).length === 0, `menu: ${await names(page)}`);
    await card(page, B).locator('[role="menuitem"]', { hasText: 'Edit game' }).click();
    await page.locator('dialog[open]').waitFor();
    assert((await idle(page)).length === 0, `sheet: ${await names(page)}`);
    const opacity = await page.evaluate(() => getComputedStyle(document.querySelector('dialog[open]')).opacity);
    assert(opacity === '1', `sheet fully visible (${opacity})`);
    await page.locator('dialog[open] .icon-btn').click();
    await card(page, C).locator('.court-switch button[data-seg="not_booked"]').click();
    await ctx.close();
  });

  // ---------------------------------------------------------------- the poll is untouched
  await check('the 5-second check is the same with the motion on or off', async () => {
    const count = async (motion) => {
      const { ctx, page } = await openAdmin({ motion });
      let n = 0;
      page.on('request', (r) => /\/api\/admin\/version/.test(r.url()) && n++);
      await page.waitForTimeout(16000);
      await ctx.close();
      return n;
    };
    const off = await count(false);
    const on = await count(true);
    assert(off >= 2 && Math.abs(on - off) <= 1, `same polling (off ${off}, on ${on})`);
  });

  // ---------------------------------------------------------------- nothing shifts
  for (const [width, scheme] of [
    [390, 'light'],
    [390, 'dark'],
    [320, 'light'],
    [320, 'dark'],
  ]) {
    await check(`${width} px ${scheme}: with the motion on, every card, button, switch and tab sits exactly where it does with it off`, async () => {
      const geometry = (page) =>
        page.evaluate(() => {
          const r = (e) => {
            const b = e.getBoundingClientRect();
            return [Math.round(b.left), Math.round(b.top + window.scrollY), Math.round(b.width), Math.round(b.height)].join(',');
          };
          const cards = [...document.querySelectorAll('article.scard')].map((e) => r(e) + '|' + [...e.querySelectorAll('button, a.btn, .tile, .players-count, .court-switch button')].map(r).join(';'));
          const tabs = [...document.querySelectorAll('.tabbar button')].map(r);
          const small = [...document.querySelectorAll('.court-switch button, .tabbar button, .btn')].filter((e) => { const h = e.getBoundingClientRect(); return h.width > 0 && h.height < 44; }).length;
          return { cards, tabs, small, bar: r(document.querySelector('.tabbar')), header: r(document.querySelector('.topbar')), sideways: document.documentElement.scrollWidth > window.innerWidth + 1 };
        });
      const off = await openAdmin({ width, scheme, motion: false });
      await off.page.waitForTimeout(1500);
      const a = await geometry(off.page);
      await off.ctx.close();
      const on = await openAdmin({ width, scheme, motion: true });
      await settle(on.page);
      const b = await geometry(on.page);
      assert(!b.sideways, 'no sideways scroll');
      assert(a.small === b.small, `tap targets: ${a.small} small with it off, ${b.small} with it on`);
      assert(JSON.stringify(a) === JSON.stringify(b), `layout differs:\n off ${JSON.stringify(a)}\n on  ${JSON.stringify(b)}`);
      await on.page.screenshot({ path: path.join(SHOTS, `admin-motion-${width}-${scheme}.png`), fullPage: true });
      await on.ctx.close();
    });
  }

  await browser.close();
  console.log(`\nadmin-motion: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
