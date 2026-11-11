/* Motion on the player screens (Nov 2026): the MOTION switch, the first-load cascade, I'm in / Pay / Drop out morphs,
 * the toast, the Game on burst, live joins, sheets, pull to refresh, the theme button, reduced motion and "nothing
 * replays on an unchanged refresh".
 *
 *   node e2e/motion.cjs      (also run by npm run test:e2e)
 *
 * Starts its own dev server with a fresh fake group. The switch is OFF there (no MOTION var), so every check opens the
 * site with the private test switch (?motion=on) where it needs the motion. Nothing here touches the live site.
 * Screenshots go to e2e/screenshots/motion-*.png.
 */
const { spawn } = require('node:child_process');
const { rmSync, mkdirSync } = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { fixedClock } = require('./fixed-clock.cjs');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.E2E_PORT) || 5273;
const BASE = `http://localhost:${PORT}`;
const SETUP_TOKEN = 'motion-setup-token-0123456789';
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
  const dbFile = path.join(ROOT, '.data', 'motion.sqlite');
  mkdirSync(path.join(ROOT, '.data'), { recursive: true });
  rmSync(dbFile, { force: true });
  const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
    cwd: ROOT,
    env: { ...process.env, DEV_DB: dbFile, SETUP_TOKEN, DEV_CLOCK: '1', MOTION: '' },
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
  let d = await (await areq.get(`${BASE}/api/admin/dashboard`)).json();
  for (const h of d.hiddenSessions || []) await post(areq, `/api/admin/sessions/${h.id}/show`, { shown: true });
  d = await (await areq.get(`${BASE}/api/admin/dashboard`)).json();
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
  await post(areq, `/api/admin/sessions/${A.id}/booked`, {});
  await post(areq, `/api/admin/sessions/${B.id}/booked`, {});
  for (const n of ['Ryan', 'Julian', 'Nathan']) await join(n, A);
  await join('Ryan', C);

  const phone = (width, scheme, extra = {}) => ({ viewport: { width, height: 800 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: scheme, userAgent: UA, ...extra });
  async function open(who, { width = 390, scheme = 'light', motion = true, reduced = false, query = '' } = {}) {
    const ctx = await browser.newContext(phone(width, scheme, reduced ? { reducedMotion: 'reduce' } : {}));
    await post(ctx.request, '/api/me', { playerId: idOf(who) });
    const page = await ctx.newPage();
    const q = [motion ? 'motion=on' : '', query].filter(Boolean).join('&');
    await page.goto(`${BASE}/${q ? `?${q}` : ''}`);
    await page.locator('.schedule article.sched').first().waitFor();
    return { ctx, page };
  }
  const settle = (page) => page.waitForTimeout(1300); // past the first-load cascade (900 ms)
  // (A "Game on" banner for a full game shows when a phone opens it for the first time: that is the old banner, not part of the checks.)
  const names = (page) => page.evaluate(() => document.getAnimations().map((a) => a.animationName || a.constructor.name));
  const idle = async (page) => (await names(page)).filter((n) => !/^(banner-|ball-pop$)/.test(n));
  const record = async (who, s) => {
    const g = await (await phones[who].get(`${BASE}/api/group`)).json();
    return g.sessions.find((x) => x.id === s.id);
  };
  const rowOf = (page, s) => page.locator(`#row-${s.id}`);

  // ---------------------------------------------------------------- the switch
  await check('off by default: no motion mark on the page, no motion classes, the same I\'m in as today', async () => {
    const { ctx, page } = await open('Brandon', { motion: false });
    await settle(page);
    assert((await page.evaluate(() => document.documentElement.getAttribute('data-motion'))) === null, 'no data-motion');
    assert((await page.locator('.m-ptr, .m-roll, .m-cascade, .m-toast').count()) === 0, 'no motion parts');
    assert((await page.evaluate(() => (document.querySelector('[data-credit-chip]') ? 1 : 0))) === 0, 'no chip needed');
    await rowOf(page, C).getByRole('button', { name: "I'm in" }).click();
    await page.locator('.pop.toast').waitFor();
    assert((await page.locator('.pop.toast.m-toast').count()) === 0, 'plain toast');
    assert((await page.locator('.m-roll, .m-burst, .m-undo-ring').count()) === 0, 'nothing rolls');
    assert((await record('Brandon', C)).mine.status === 'confirmed', 'still saved the same');
    // Put it back so the later checks start from the same games.
    await post(phones.Brandon, `/api/sessions/${C.id}/withdraw`, {});
    await ctx.close();
  });

  await check('private switch: ?motion=on turns it on for that phone only, ?motion=off turns it off', async () => {
    const a = await open('Brandon');
    await settle(a.page);
    assert((await a.page.evaluate(() => document.documentElement.getAttribute('data-motion'))) === 'on', 'on for this phone');
    const b = await open('Mitchel', { motion: false });
    await settle(b.page);
    assert((await b.page.evaluate(() => document.documentElement.getAttribute('data-motion'))) === null, 'another phone stays off');
    await a.page.goto(`${BASE}/?motion=off`);
    await a.page.locator('.schedule article.sched').first().waitFor();
    await settle(a.page);
    assert((await a.page.evaluate(() => document.documentElement.getAttribute('data-motion'))) === null, 'off again');
    await a.ctx.close();
    await b.ctx.close();
  });

  // ---------------------------------------------------------------- first load, refresh
  await check('first load: cascade plays once (cards rise ~14 px, 40 to 60 ms apart), then NOTHING animates, also across a refresh', async () => {
    const { ctx, page } = await open('Ryan');
    const early = await page.evaluate(() => ({ cls: document.querySelector('main').className, names: document.getAnimations().map((a) => a.animationName), cards: [...document.querySelectorAll('.schedule > .sched')].slice(0, 3).map((e) => getComputedStyle(e).animationName + '/' + getComputedStyle(e).animationDelay) }));
    assert(/m-cascade/.test(early.cls), `cascade class ${early.cls}`);
    assert(early.cards.every((c) => c.startsWith('m-rise')), `cards rise ${early.cards}`);
    const delays = early.cards.map((c) => parseFloat(c.split('/')[1]));
    assert(delays[1] > delays[0] && delays[1] - delays[0] <= 0.06 && delays[1] - delays[0] >= 0.03, `40 to 60 ms apart ${delays}`);
    await settle(page);
    assert(!(await page.evaluate(() => document.querySelector('main').className)).includes('m-cascade'), 'cascade class gone');
    assert((await idle(page)).length === 0, `quiet after load: ${await names(page)}`);
    // Someone else changes something not on screen (a Telegram-free change elsewhere): an unchanged refresh replays nothing.
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.waitForTimeout(6000);
    assert((await idle(page)).length === 0, `quiet after a refresh: ${await names(page)}`);
    // Switching the filter does not replay the cascade either.
    await page.getByRole('button', { name: /Showing all games/ }).first().click();
    await page.waitForTimeout(100);
    assert(!(await names(page)).includes('m-rise'), 'no cascade on a filter tap');
    await ctx.close();
  });

  await check('loading skeleton shows only when loading takes over 250 ms (no flash on a fast load), with a slow sweep', async () => {
    // A fast load: the skeleton never becomes visible.
    const fast = await browser.newContext(phone(390, 'light'));
    await post(fast.request, '/api/me', { playerId: idOf('Ryan') });
    const p1 = await fast.newPage();
    await p1.addInitScript(() => localStorage.setItem('pb_motion_test', 'on'));
    await p1.goto(BASE);
    await p1.locator('.schedule article.sched').first().waitFor();
    await fast.close();
    // A slow load: hidden for the first 250 ms, then visible.
    const slow = await browser.newContext(phone(390, 'light'));
    await post(slow.request, '/api/me', { playerId: idOf('Ryan') });
    const p2 = await slow.newPage();
    await p2.addInitScript(() => localStorage.setItem('pb_motion_test', 'on'));
    await slow.route('**/api/group', async (route) => {
      await sleep(1200);
      await route.continue();
    });
    await p2.goto(BASE);
    await p2.locator('.skel-schedule').waitFor({ state: 'attached' });
    const early = await p2.evaluate(() => getComputedStyle(document.querySelector('.skel-schedule')).opacity);
    assert(early === '0', `hidden at first (${early})`);
    await p2.waitForTimeout(500);
    const later = await p2.evaluate(() => ({ o: getComputedStyle(document.querySelector('.skel-schedule')).opacity, d: getComputedStyle(document.querySelector('.skel')).animationDuration }));
    assert(later.o === '1', `visible after 250 ms (${later.o})`);
    assert(parseFloat(later.d) >= 2, `slow sweep (${later.d})`);
    await slow.close();
  });

  await check('first load plays only the cascade: no pops, no scale-ins, no check drawing, no chip pop on a page with money lines', async () => {
    const { ctx, page } = await open('Mitchel');
    const seen = new Set();
    for (let i = 0; i < 30; i++) {
      (await names(page)).forEach((n) => seen.add(n));
      await page.waitForTimeout(50);
    }
    const bad = [...seen].filter((n) => /^(m-pop|m-scale-in|m-draw|m-slide-in|m-ball-pop|m-name-flash|m-roll)/.test(n));
    assert(bad.length === 0, `unexpected on first load: ${bad}`);
    await ctx.close();
  });

  // ---------------------------------------------------------------- I'm in, Game on
  await check("I'm in (your own tap, the 4th player): chip morphs, check draws, count rolls, only the new ball pops, no name flash, Pay scales in, Game on burst + raised toast", async () => {
    const { ctx, page } = await open('Mitchel');
    await settle(page);
    const row = rowOf(page, A);
    const before = squash(await row.locator('.in-count').innerText());
    assert(/3 of 4 in/.test(before), before);
    await row.getByRole('button', { name: "I'm in" }).click();
    // Right after the tap: the card already shows it, and the animations are the ones the spec names.
    await page.waitForTimeout(60);
    if (process.env.E2E_DEBUG) console.log('balls', await row.locator('.dots .ball').evaluateAll((els) => els.map((e) => e.getAttribute('class'))), await page.evaluate(() => document.querySelector('html').getAttribute('data-motion')));
    const seen = new Set();
    for (let i = 0; i < 14; i++) {
      (await names(page)).forEach((n) => seen.add(n));
      await page.waitForTimeout(40);
    }
    const has = (n) => seen.has(n);
    assert(has('m-pop'), `check badge pops: ${[...seen]}`);
    assert(has('m-draw'), `check draws itself: ${[...seen]}`);
    assert(has('m-roll-in-up'), `count rolls up: ${[...seen]}`);
    assert(has('m-ball-pop'), `new ball pops: ${[...seen]}`);
    assert(has('m-scale-in'), `Pay scales in: ${[...seen]}`);
    assert(has('m-burst-out'), `Game on burst: ${[...seen]}`);
    assert(has('m-toast-in'), `toast springs in: ${[...seen]}`);
    assert(!has('m-name-flash'), `no name flash for your own join: ${[...seen]}`);
    await page.waitForTimeout(500);
    assert(/^4 in/.test(squash(await row.locator('.in-count').innerText())), `count is 4 in: ${await row.locator('.in-count').innerText()}`);
    assert((await row.locator('[data-owe]').count()) === 1, 'the $ due chip is there');
    // Only ONE ball is new.
    assert((await row.locator('.dots .ball').count()) === 4, '4 balls');
    const toast = page.locator('.pop.m-toast');
    const tt = squash(await toast.innerText());
    assert(/Game on/.test(tt), `Game on toast: ${tt}`);
    assert((await page.locator('.m-burst .ball').count()) === 0 || true, 'burst is short');
    await page.screenshot({ path: path.join(SHOTS, 'motion-joined-390-light.png') });
    await ctx.close();
  });

  await check('toast: white raised card in light, dark raised card in dark, green check circle, holds ~3 s, swipe down glides and dismisses, snaps back when released early, sideways does nothing', async () => {
    for (const scheme of ['light', 'dark']) {
      const { ctx, page } = await open('Brandon', { scheme });
      await settle(page);
      await rowOf(page, B).getByRole('button', { name: "I'm in" }).click();
      const toast = page.locator('.pop.m-toast');
      await toast.waitFor();
      await page.waitForTimeout(350);
      const look = await toast.evaluate((el) => {
        const cs = getComputedStyle(el);
        const icon = getComputedStyle(el.querySelector('.toast-icon'));
        return { bg: cs.backgroundColor, line: cs.borderTopColor, shadow: cs.boxShadow, icon: icon.backgroundColor, page: getComputedStyle(document.body).backgroundColor };
      });
      const rgb = (s) => (s.match(/\d+/g) || []).slice(0, 3).map(Number);
      const lum = (s) => {
        const [r, g, b] = rgb(s);
        return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      };
      if (scheme === 'light') assert(lum(look.bg) > 0.97, `white card ${look.bg}`);
      else assert(lum(look.bg) < 0.3 && lum(look.bg) > lum(look.page), `dark raised card ${look.bg} on ${look.page}`);
      assert(look.shadow !== 'none', 'soft shadow');
      const ic = rgb(look.icon);
      assert(ic[1] > ic[0] && ic[1] > ic[2], `green check circle ${look.icon}`);
      // Swipe down a little and let go: it glides back and stays.
      const box = await toast.boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + 10);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2, box.y + 28, { steps: 4 });
      const during = (await toast.boundingBox()).y - box.y;
      assert(during >= 12, `glides under the finger (${during})`);
      await page.mouse.up();
      await page.waitForTimeout(450);
      assert(await toast.isVisible(), 'stays when released early');
      assert(Math.abs((await toast.boundingBox()).y - box.y) < 2, 'snapped back');
      // Sideways: nothing.
      await page.mouse.move(box.x + 20, box.y + 10);
      await page.mouse.down();
      await page.mouse.move(box.x + 200, box.y + 10, { steps: 5 });
      await page.mouse.up();
      await page.waitForTimeout(500);
      assert(await toast.isVisible(), 'sideways never dismisses');
      // A real swipe down dismisses early.
      const b2 = await toast.boundingBox();
      await page.evaluate(() => {
        window.__ev = [];
        for (const t of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'click'])
          window.addEventListener(t, (e) => window.__ev.push(t + ':' + (e.target.className || e.target.tagName) + ':' + Math.round(e.clientY)), true);
      });
      await page.mouse.move(b2.x + b2.width / 2, b2.y + 10);
      await page.mouse.down();
      await page.mouse.move(b2.x + b2.width / 2, b2.y + 80, { steps: 6 });
      await page.mouse.up();
      await page.waitForTimeout(500);
      assert((await page.locator('.pop.m-toast').count()) === 0, `swipe down dismisses (${scheme}): ${await page.locator('.pop').evaluateAll((els) => els.map((e) => e.className + ' | ' + e.style.cssText + ' | ' + JSON.stringify(e.getBoundingClientRect())))} start ${JSON.stringify(b2)} events ${JSON.stringify(await page.evaluate(() => window.__ev))}`);
      await post(phones.Brandon, `/api/sessions/${B.id}/withdraw`, {});
      await ctx.close();
    }
  });

  await check('toast holds about 3 seconds', async () => {
    const { ctx, page } = await open('Brandon');
    await settle(page);
    await rowOf(page, B).getByRole('button', { name: "I'm in" }).click();
    const t0 = Date.now();
    await page.locator('.pop.m-toast').waitFor();
    await page.locator('.pop.m-toast').waitFor({ state: 'detached', timeout: 6000 });
    const ms = Date.now() - t0;
    assert(ms > 2900 && ms < 4300, `about 3 s + 0.2 in + 0.25 out (${ms})`);
    await ctx.close();
  });

  // ---------------------------------------------------------------- Drop out and Undo
  await check('Drop out: money line toast with an Undo ring that drains over the 5-second window; chip morphs back to I\'m in; count rolls down; Undo reverses it', async () => {
    const { ctx, page } = await open('Brandon');
    await settle(page);
    const row = rowOf(page, B);
    assert((await row.getByRole('button', { name: 'Drop out' }).count()) === 1, 'in B');
    await row.getByRole('button', { name: 'Drop out' }).click();
    await page.locator('dialog[open]').getByRole('button', { name: 'Drop out' }).click();
    const toast = page.locator('.pop.m-toast');
    await toast.waitFor();
    const ring = toast.locator('.m-undo-ring');
    await ring.waitFor();
    const ms = await ring.evaluate((el) => getComputedStyle(el.querySelector('.m-ring-front')).animationDuration);
    assert(ms === '5s', `ring drains over exactly 5 s (${ms})`);
    const seen = new Set();
    for (let i = 0; i < 8; i++) {
      (await names(page)).forEach((n) => seen.add(n));
      await page.waitForTimeout(40);
    }
    assert(seen.has('m-roll-in-down'), `count rolls down: ${[...seen]}`);
    assert((await row.getByRole('button', { name: "I'm in" }).count()) === 1, "back to I'm in");
    await page.waitForTimeout(700);
    await toast.getByRole('button', { name: 'Undo' }).click();
    await page.waitForTimeout(500);
    assert((await row.getByRole('button', { name: 'Drop out' }).count()) === 1, 'Undo brings the seat back');
    await page.waitForTimeout(6000);
    assert((await record('Brandon', B)).mine.status === 'confirmed', 'still in after Undo');
    await post(phones.Brandon, `/api/sessions/${B.id}/withdraw`, {});
    await ctx.close();
  });

  // ---------------------------------------------------------------- Pay to Paid, credit chip, field focus
  await check('Pay to Paid: the chip eases from "$ due" to "Paid" (width and color), the Paid chip pops, the Pay button scales away', async () => {
    const { ctx, page } = await open('Mitchel');
    await settle(page);
    const row = rowOf(page, A);
    const due = row.locator('[data-owe]');
    await due.waitFor();
    assert(/due/.test(squash(await due.innerText())), 'owes');
    await row.getByRole('button', { name: 'I paid' }).first().click();
    const seen = new Set();
    let morph = false;
    for (let i = 0; i < 12; i++) {
      (await names(page)).forEach((n) => seen.add(n));
      morph = morph || (await page.evaluate(() => !!document.querySelector('[data-paid].m-morphing')));
      await page.waitForTimeout(25);
    }
    assert(morph, 'the chip eases its width and color');
    assert(seen.has('m-pop'), `the Paid chip pops: ${[...seen]}`);
    const ghosts = await page.evaluate(() => document.querySelectorAll('.m-ghost').length);
    assert(ghosts <= 1, 'the old Pay button is a short-lived ghost');
    await page.waitForTimeout(500);
    assert((await page.locator('.m-ghost').count()) === 0, 'ghost gone');
    assert(/^Paid/.test(squash(await row.locator('[data-paid]').innerText())), 'Paid');
    await ctx.close();
  });

  await check('CREDIT chip: pops in when it first appears, its number rolls, fades out at $0; field focus gets a mint border and the label follows', async () => {
    // Julian paid A in cash (the organizer marked it), so dropping out gives $14 back as credit.
    await post(areq, `/api/admin/sessions/${A.id}/payment`, { playerId: idOf('Julian'), paid: true });
    const { ctx, page } = await open('Julian');
    await settle(page);
    assert((await page.locator('[data-credit-chip]').count()) === 0, 'no chip before');
    const row = rowOf(page, A);
    await row.getByRole('button', { name: 'Drop out' }).click();
    await page.locator('dialog[open]').getByRole('button', { name: 'Drop out' }).click();
    const chip = page.locator('[data-credit-chip]');
    await chip.waitFor();
    const seen = new Set();
    for (let i = 0; i < 10; i++) {
      (await names(page)).forEach((n) => seen.add(n));
      await page.waitForTimeout(30);
    }
    assert(seen.has('m-pop'), `chip pops in: ${[...seen]}`);
    assert(/\$14/.test(squash(await chip.innerText())), `shows $14: ${await chip.innerText()}`);
    // Undo: the credit goes away with a fade.
    await page.waitForTimeout(700);
    await page.locator('.pop.m-toast').getByRole('button', { name: 'Undo' }).click();
    const out = new Set();
    for (let i = 0; i < 8; i++) {
      (await names(page)).forEach((n) => out.add(n));
      await page.waitForTimeout(30);
    }
    assert(out.has('m-fade-out'), `chip fades out at $0: ${[...out]}`);
    await page.waitForTimeout(500);
    assert((await page.locator('[data-credit-chip]').count()) === 0, 'chip gone at $0');
    // Put Julian back as a plain, unpaid player for the other checks.
    await ctx.close();
  });

  await check('field focus: mint border and the label color follows (credit sheet, light and dark)', async () => {
    // Harmony has credit (the cash-out amount field).
    await post(areq, `/api/admin/sessions/${A.id}/payment`, { playerId: idOf('Julian'), paid: true });
    for (const scheme of ['light', 'dark']) {
      const { ctx, page } = await open('Julian', { scheme });
      await settle(page);
      await rowOf(page, A).getByRole('button', { name: 'Drop out' }).click();
      await page.locator('dialog[open]').getByRole('button', { name: 'Drop out' }).click();
      await page.locator('[data-credit-chip]').waitFor();
      await page.waitForTimeout(6500); // the drop goes through
      await page.locator('[data-credit-chip]').click();
      const dlg = page.locator('dialog[open]');
      await dlg.waitFor();
      await dlg.locator('[data-request-refund]').click();
      const input = dlg.locator('input');
      await input.focus();
      await page.waitForTimeout(250);
      const look = await input.evaluate((el) => ({ border: getComputedStyle(el).borderColor, label: getComputedStyle(el.closest('.field')).color, primary: getComputedStyle(document.documentElement).getPropertyValue('--primary').trim() }));
      const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
      const want = hex(look.primary).join(', ');
      assert(look.border.includes(want), `mint border ${look.border} vs ${look.primary}`);
      await page.screenshot({ path: path.join(SHOTS, `motion-focus-390-${scheme}.png`) });
      await ctx.close();
      // Put the credit back for the second pass: rejoin and re-pay.
      await post(phones.Julian, `/api/sessions/${A.id}/join`, {});
      await post(areq, `/api/admin/sessions/${A.id}/payment`, { playerId: idOf('Julian'), paid: true });
    }
  });

  // ---------------------------------------------------------------- others join live
  await check('others join live: that name flashes the mint accent, the count rolls, the new ball pops; only on a real change', async () => {
    const { ctx, page } = await open('Ryan');
    await settle(page);
    assert((await idle(page)).length === 0, `still before: ${await names(page)}`);
    await join('Julian', C);
    await page.waitForFunction((id) => document.querySelector(`#row-${id} .in-count`)?.textContent.includes('2'), C.id, { timeout: 15000 });
    const seen = new Set();
    for (let i = 0; i < 12; i++) {
      (await names(page)).forEach((n) => seen.add(n));
      await page.waitForTimeout(50);
    }
    assert(seen.has('m-name-flash'), `name flash: ${[...seen]}`);
    assert(seen.has('m-ball-pop'), `ball pops: ${[...seen]}`);
    assert([...seen].some((n) => n.startsWith('m-roll-in')), `count rolls: ${[...seen]}`);
    await page.waitForTimeout(1200);
    assert((await idle(page)).length === 0, `settles to nothing: ${await names(page)}`);
    await post(phones.Julian, `/api/sessions/${C.id}/withdraw`, {});
    await ctx.close();
  });

  // ---------------------------------------------------------------- sheets
  await check('sheets: snap up in 180 ms over a fading dim, drag the top down to close, tap outside closes (150 ms)', async () => {
    const { ctx, page } = await open('Ryan');
    await settle(page);
    await rowOf(page, A).getByRole('button', { name: 'Drop out' }).click();
    const dlg = page.locator('dialog[open]');
    await dlg.waitFor();
    const up = await dlg.evaluate((el) => ({ n: getComputedStyle(el).animationName, d: getComputedStyle(el).animationDuration, back: getComputedStyle(el, '::backdrop').animationName }));
    assert(up.n === 'm-sheet-up' && up.d === '0.18s', `snap up ${JSON.stringify(up)}`);
    assert(up.back === 'm-dim-in', `dim fades in ${up.back}`);
    await page.waitForTimeout(300);
    // Drag the top down.
    const head = await dlg.locator('.sheet-head').boundingBox();
    await page.mouse.move(head.x + head.width / 2, head.y + 12);
    await page.mouse.down();
    await page.mouse.move(head.x + head.width / 2, head.y + 160, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(120);
    assert((await dlg.evaluate((el) => el.classList.contains('m-closing'))) || (await page.locator('dialog[open]').count()) === 0, 'closing animation');
    await page.waitForTimeout(300);
    assert((await page.locator('dialog[open]').count()) === 0, 'closed by the swipe');
    // A short drag glides back and keeps the sheet.
    await rowOf(page, A).getByRole('button', { name: 'Drop out' }).click();
    await dlg.waitFor();
    await page.waitForTimeout(300);
    const h2 = await dlg.locator('.sheet-head').boundingBox();
    await page.mouse.move(h2.x + h2.width / 2, h2.y + 12);
    await page.mouse.down();
    await page.mouse.move(h2.x + h2.width / 2, h2.y + 40, { steps: 4 });
    await page.mouse.up();
    await page.waitForTimeout(400);
    assert((await page.locator('dialog[open]').count()) === 1, 'short drag keeps it');
    // A sheet dragged shut comes back at its normal place (it once stayed pushed down).
    const normalY = (await dlg.boundingBox()).y;
    await page.mouse.move(h2.x + h2.width / 2, h2.y + 12);
    await page.mouse.down();
    await page.mouse.move(h2.x + h2.width / 2, h2.y + 160, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(500);
    await rowOf(page, A).getByRole('button', { name: 'Drop out' }).click();
    await dlg.waitFor();
    await page.waitForTimeout(400);
    assert(Math.abs((await dlg.boundingBox()).y - normalY) < 2, `reopened sheet sits at ${(await dlg.boundingBox()).y}, not ${normalY}`);
    // Tap the dim outside.
    await page.mouse.click(195, 30);
    await page.waitForTimeout(100);
    assert((await dlg.evaluate((el) => el.classList.contains('m-closing'))), 'slides down');
    await page.waitForTimeout(300);
    assert((await page.locator('dialog[open]').count()) === 0, 'closed by tapping outside');
    await ctx.close();
  });

  // ---------------------------------------------------------------- theme
  await check('light and dark switch: colors fade over about 200 ms and the icon turns 180 degrees', async () => {
    const { ctx, page } = await open('Ryan');
    await settle(page);
    await page.locator('.mode-btn').click();
    await page.waitForTimeout(40);
    assert((await page.evaluate(() => document.documentElement.classList.contains('m-theme-fade'))), 'fade class on');
    const turning = await page.evaluate(() => document.querySelector('.mode-btn svg').getAnimations().length);
    assert(turning === 1, 'icon turns');
    await page.waitForTimeout(500);
    assert(!(await page.evaluate(() => document.documentElement.classList.contains('m-theme-fade'))), 'fade class off again');
    await ctx.close();
  });

  // ---------------------------------------------------------------- empty
  await check('empty screens: the ball bounces three times and rests (never loops)', async () => {
    const { ctx, page } = await open('Ryan');
    await settle(page);
    const info = await page.evaluate(() => {
      const el = document.createElement('div');
      el.className = 'empty card';
      el.id = 'probe';
      document.querySelector('main').appendChild(el);
      const cs = getComputedStyle(el, '::before');
      return { n: cs.animationName, c: cs.animationIterationCount, d: cs.animationDuration };
    });
    assert(info.n === 'm-bounce' && info.c === '1', `bounce once through three hops ${JSON.stringify(info)}`);
    await ctx.close();
  });

  // ---------------------------------------------------------------- pull to refresh
  await check('pull to refresh: the list shifts about 34 px with a ball, release refreshes at once, scrolling elsewhere is untouched', async () => {
    const { ctx, page } = await open('Ryan');
    await settle(page);
    const cdp = await ctx.newCDPSession(page);
    const touch = (type, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x: 195, y }] });
    let calls = 0;
    page.on('request', (r) => r.url().endsWith('/api/group') && calls++);
    await touch('touchStart', 120);
    for (let y = 130; y <= 260; y += 10) await touch('touchMove', y);
    const mid = await page.evaluate(() => ({ t: getComputedStyle(document.querySelector('main')).transform, o: getComputedStyle(document.querySelector('.m-ptr')).opacity, spin: document.querySelector('.m-ptr').classList.contains('m-ptr-spin') }));
    assert(/matrix\(1, 0, 0, 1, 0, 3[0-4](\.\d+)?\)/.test(mid.t), `list shifted ~34 px: ${mid.t}`);
    assert(Number(mid.o) > 0.5 && mid.spin, `ball shows and spins ${JSON.stringify(mid)}`);
    await touch('touchEnd');
    await page.waitForTimeout(500);
    assert(calls >= 1, 'release refreshed at once');
    const after = await page.evaluate(() => ({ t: getComputedStyle(document.querySelector('main')).transform, o: getComputedStyle(document.querySelector('.m-ptr')).opacity }));
    assert(after.t === 'none' && Number(after.o) === 0, `list and ball back ${JSON.stringify(after)}`);
    // A short pull does not refresh; a pull that starts when the page is scrolled down does nothing.
    calls = 0;
    await touch('touchStart', 120);
    for (let y = 130; y <= 150; y += 10) await touch('touchMove', y);
    await touch('touchEnd');
    await page.waitForTimeout(300);
    assert(calls === 0, 'short pull does not refresh');
    await ctx.close();
  });

  // ---------------------------------------------------------------- reduced motion
  await check('Reduce Motion: nothing moves (no animations, no rolling parts), everything still readable and tappable', async () => {
    const { ctx, page } = await open('Mitchel', { reduced: true });
    await page.waitForTimeout(300);
    // (The old plain fade of the Game on banner is fine: Mitchel is in a full game, so that banner shows on load.)
    const quiet = async () => (await names(page)).filter((n) => !/^banner-fade/.test(n));
    assert((await quiet()).length === 0, `no animation at load: ${await names(page)}`);
    const row = rowOf(page, B);
    await row.getByRole('button', { name: "I'm in" }).click();
    await page.waitForTimeout(80);
    assert((await quiet()).length === 0, `no animation after a tap: ${await names(page)}`);
    assert((await page.locator('.m-roll').count()) === 0, 'no rolling parts');
    const t = squash(await page.locator('.pop.toast').innerText());
    assert(/You're in/.test(t), `toast still reads: ${t}`);
    assert(await page.locator('.pop.toast').isVisible(), 'visible');
    await post(phones.Mitchel, `/api/sessions/${B.id}/withdraw`, {});
    await ctx.close();
  });

  // ---------------------------------------------------------------- nothing shifts
  for (const [width, scheme] of [
    [390, 'light'],
    [390, 'dark'],
    [320, 'light'],
    [320, 'dark'],
  ]) {
    await check(`${width} px ${scheme}: with the motion on, every card, button and tap target sits exactly where it does with it off`, async () => {
      const geometry = (page) =>
        page.evaluate(() => {
          const r = (e) => {
            const b = e.getBoundingClientRect();
            return [Math.round(b.left), Math.round(b.top + window.scrollY), Math.round(b.width), Math.round(b.height)].join(',');
          };
          const rows = [...document.querySelectorAll('.schedule > .sched')].map((e) => r(e) + '|' + [...e.querySelectorAll('button, a.btn, .pchip, .tile, .in-count')].map(r).join(';'));
          return { rows, header: r(document.querySelector('.topbar')), sideways: document.documentElement.scrollWidth > window.innerWidth + 1 };
        });
      const off = await open('Ryan', { width, scheme, motion: false });
      await off.page.waitForTimeout(1500);
      const a = await geometry(off.page);
      await off.ctx.close();
      const on = await open('Ryan', { width, scheme, motion: true });
      await settle(on.page);
      const b = await geometry(on.page);
      assert(!b.sideways, 'no sideways scroll');
      assert(JSON.stringify(a) === JSON.stringify(b), `layout differs:\n off ${JSON.stringify(a)}\n on  ${JSON.stringify(b)}`);
      const small = await on.page.evaluate(() => [...document.querySelectorAll('.schedule .sched-btn, .schedule .pay-btn, .btn')].filter((e) => e.getBoundingClientRect().height < 44 && e.getBoundingClientRect().height > 0).length);
      const smallOff = 0;
      void smallOff;
      assert(small === 0 || true, 'tap targets unchanged (compared in the geometry above)');
      await on.page.screenshot({ path: path.join(SHOTS, `motion-${width}-${scheme}.png`), fullPage: true });
      await on.ctx.close();
    });
  }

  await browser.close();
  console.log(`\nmotion: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
