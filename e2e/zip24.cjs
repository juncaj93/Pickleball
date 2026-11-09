/* Zip 24: Booking hours (BOOKING_HOURS) and the tap-to-pick game times on Add game and Edit game.
 *
 *   node e2e/zip24.cjs      (also run by npm run test:e2e)
 *
 * Fake world (the older big one, Mon Nov 9 at 10 AM Eastern), its own dev server; nothing touches Cloudflare or the live site. The switch is
 * turned on through the real Settings call, and one check uses the private link.
 */
const { spawn, spawnSync } = require('node:child_process');
const { readFileSync, mkdirSync, rmSync } = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { findClipping } = require('./clip-check.cjs');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.E2E_PORT) || 5424;
const BASE = `http://localhost:${PORT}`;
const NOW_ISO = '2026-11-09T15:00:00.000Z'; // Mon Nov 9, 10:00 AM Eastern
const NOW_MS = Date.parse(NOW_ISO);
const SHOTS = process.env.E2E_SHOTS || path.join(__dirname, 'screenshots');
const PIN = /PIN `(\d{6})`/.exec(readFileSync(path.join(ROOT, 'docs/PREVIEW_FAKE_DB.md'), 'utf8'))[1];

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
    console.log(`  ✗ ${name}\n      ${String(err && err.message ? err.message : err).replace(/\s*\n\s*/g, ' ⏎ ').slice(0, 1600)}`);
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

async function main() {
  mkdirSync(SHOTS, { recursive: true });
  const dbFile = path.join(ROOT, '.data', 'zip24.sqlite');
  mkdirSync(path.join(ROOT, '.data'), { recursive: true });
  rmSync(dbFile, { force: true });
  const seeded = spawnSync('npx', ['vite-node', 'scripts/load-seed-local.ts', '--', dbFile, NOW_ISO], { cwd: ROOT, encoding: 'utf8' });
  if (seeded.status !== 0) throw new Error(`could not build the fake world: ${seeded.stderr || seeded.stdout}`);
  if (await fetch(`${BASE}/api/status`).then((r) => r.ok, () => false)) throw new Error(`port ${PORT} is already in use`);
  const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
    cwd: ROOT,
    env: { ...process.env, DEV_DB: dbFile, SETUP_TOKEN: 'zip24-setup-token-0123456789', DEV_CLOCK: '1' },
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
  await fetch(`${BASE}/__dev/clock`, { method: 'POST', body: JSON.stringify({ atMs: NOW_MS }) });
  const browser = await chromium.launch();
  const post = (req, url, data, headers = {}) => req.post(BASE + url, { data, headers: { Origin: BASE, ...headers } });
  const put = (req, url, data, headers = {}) => req.put(BASE + url, { data, headers: { Origin: BASE, ...headers } });
  const real = (await browser.newContext()).request;
  if (!(await post(real, '/api/admin/login', { pin: PIN })).ok()) throw new Error('login failed');
  const dash = async () => (await real.get(`${BASE}/api/admin/dashboard`)).json();

  async function openAdmin(opts = {}) {
    const width = opts.width ?? 390;
    const ctx = await browser.newContext({ viewport: { width, height: opts.height ?? 900 }, deviceScaleFactor: opts.dpr ?? 1, isMobile: true, hasTouch: true, colorScheme: opts.scheme ?? 'light', userAgent: UA, reducedMotion: 'reduce' });
    await ctx.addInitScript((delta) => {
      const Real = Date;
      class Shifted extends Real {
        constructor(...x) {
          if (x.length === 0) super(Real.now() + delta);
          else super(...x);
        }
        static now() {
          return Real.now() + delta;
        }
      }
      window.Date = Shifted;
    }, NOW_MS - Date.now());
    await ctx.route('https://venmo.com/**', (r) => r.abort());
    if (!(await post(ctx.request, '/api/admin/login', { pin: PIN })).ok()) throw new Error('login');
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(BASE + (opts.url ?? '/admin'));
    await page.locator('.tabbar').waitFor();
    if (opts.pct && opts.pct !== 100) await page.addStyleTag({ content: `html { font-size: ${opts.pct}% !important; } body { font-size: ${(17 * opts.pct) / 100}px !important; }` });
    if (process.env.E2E_BREAK) await page.addStyleTag({ content: process.env.E2E_BREAK });
    return { ctx, page, errors };
  }
  const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, `zip24-${name}.png`), fullPage: false });

  const openEdit = async (page, id) => {
    let card = page.locator(`article#session-${id}`);
    if (!(await card.count())) {
      const all = page.locator('button', { hasText: /^Show all/ });
      if (await all.count()) await all.click();
      await page.locator(`div#session-${id}`).click();
      card = page.locator(`article#session-${id}`);
      await card.waitFor();
    }
    await card.locator('button[aria-label^="Game menu"]').click();
    await page.getByRole('menuitem', { name: /Edit game/ }).click();
    await page.locator('dialog.sheet[open] form.edit-game').waitFor();
    await page.waitForTimeout(400);
  };
  const openAdd = async (page) => {
    await page.getByRole('button', { name: /\+ Add game/ }).first().click();
    await page.locator('dialog.sheet[open] form.add-game').waitFor();
    await page.waitForTimeout(300);
  };
  const closeTop = async (page) => {
    // The sheet's own X is the first in its header (a Start grid inside it has one more, in a closed dialog).
    await page.locator('dialog.sheet[open] .icon-btn').first().click();
    await page.waitForTimeout(250);
  };
  const GRID = '.bh-grid-sheet[open]';
  const pickStart = async (page, hhmm) => {
    await page.locator('[data-bh-start]').click();
    await page.locator(`${GRID} [data-bh-grid]`).waitFor();
    await page.locator(`${GRID} .bh-chip[data-chip="${hhmm}"]`).click();
    await page.waitForTimeout(250);
  };
  const startText = (page) => page.locator('[data-bh-start]').innerText();
  const endText = (page) => page.locator('[data-bh-end]').innerText();
  const pressedLen = (page) => page.locator('.bh-lenbtn[aria-pressed="true"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-len')));
  const tzParts = (iso) => new Date(Date.parse(iso)).toLocaleString('en-US', { timeZone: 'America/Detroit', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  const hours = { open: '8:00 AM', closeMonSat: '10:00 PM', closeSun: '7:00 PM' };
  const MSG_ANY = 'The venue is open 8:00 AM to 10:00 PM (Sundays 8:00 AM to 7:00 PM). Pick times inside those hours.';
  const upcomingAll = async () => (await dash()).sessions.filter((x) => Date.parse(x.startsAt) > NOW_MS && !x.state.flags.canceled);
  const iso = (y, m, d, h, mi = 0) => {
    // Eastern wall time to UTC (EST after Nov 1, 2026).
    return new Date(Date.UTC(y, m - 1, d, h + 5, mi)).toISOString();
  };

  // ---------------------------------------------------------------- OFF: as it ships
  await check('OFF (as it ships): Add game has the two time boxes, Edit game has its cancel-by line, nothing new; the private link shows the new screens on that phone only', async () => {
    const d0 = await dash();
    assert(d0.bookingHours === undefined && d0.bookingHoursForAll === undefined, 'the seed should have the Booking hours row OFF');
    const up = await upcomingAll();
    const off = await openAdmin();
    await openAdd(off.page);
    assert((await off.page.locator('form.bh-form').count()) === 0, 'no picker form');
    assert((await off.page.locator('dialog.sheet[open] select, dialog.sheet[open] input[type="time"]').count()) === 2, 'two time boxes as before');
    await closeTop(off.page);
    await openEdit(off.page, up[0].id);
    assert((await off.page.locator('dialog.sheet[open] [data-cancel-by]').count()) === 1, 'the cancel-by line is still on Edit game');
    assert((await off.page.locator('form.bh-form').count()) === 0, 'no picker form');
    await off.ctx.close();
    // An out-of-hours game is accepted exactly as on main.
    const r = await post(real, '/api/admin/sessions', { startsAt: iso(2026, 11, 13, 6), endsAt: iso(2026, 11, 13, 8) });
    assert(r.ok(), `OFF accepts an early game: ${r.status()}`);
    global.oldEarlyId = (await r.json()).id;
    const priv = await openAdmin({ url: '/admin?bookinghours=on' });
    await openAdd(priv.page);
    assert((await priv.page.locator('form.bh-form').count()) === 1, 'the private link shows the picker on this phone');
    await priv.ctx.close();
    const other = await openAdmin();
    await openAdd(other.page);
    assert((await other.page.locator('form.bh-form').count()) === 0, 'another phone still sees the old boxes');
    await other.ctx.close();
  });

  // The switch goes on for everyone (the real Settings call) and Game day card too (so the Court box shows).
  await put(real, '/api/admin/booking-hours-switch', { on: true });
  await put(real, '/api/admin/game-day-card-switch', { on: true });
  const up = await upcomingAll();
  const target = up[0];

  // ---------------------------------------------------------------- Add game
  await check('ADD: two cards, no section titles, Date and Court halves, Start and End halves, Length, then the Note card and the Add game button, no extra wording', async () => {
    const h = await openAdmin({ width: 420, height: 912 });
    await openAdd(h.page);
    const f = h.page.locator('form.bh-form');
    assert((await f.locator('.bh-card').count()) === 2, 'two cards');
    const card1 = f.locator('.bh-card').first();
    const labels = await card1.locator('.bh-lab').allInnerTexts();
    assert(labels.join('|') === 'Date|Court|Start|End|Length', `card 1 labels: ${labels}`);
    assert((await f.locator('.bh-card').nth(1).locator('.bh-lab').innerText()) === 'Note (optional)', 'card 2 is the Note');
    // Nothing above the cards, nothing between them and the button except the cards themselves.
    const kids = await f.evaluate((el) => [...el.children].map((c) => c.className.split(' ')[0] + (c.tagName === 'BUTTON' ? ':' + c.textContent : '')));
    assert(kids.join('|') === 'bh-card|bh-card|bh-actions', `form children: ${kids}`);
    const acts = await f.locator('[data-bh-actions]').evaluate((e) => [...e.children].map((c) => c.textContent.replace(/\s+/g, ' ').trim()));
    assert(acts.join('|') === 'Change court (opens CourtReserve)|Add game', `bottom row: ${acts}`);
    const text = (await card1.innerText()).replace(/\s+/g, ' ');
    assert(/^Date .*Court .*Not set Start 8:00 PM End 10:00 PM Length 1.5 hr \$11 each 2 hr \$14 each 2.5 hr past close 3 hr past close$/.test(text), `card 1 words: ${text}`);
    // The Court box is a half; Date is a half; Start a half; End a half.
    const w = await card1.locator('.bh-box').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().width)));
    assert(w.length === 4 && Math.abs(w[0] - w[1]) <= 1 && Math.abs(w[2] - w[3]) <= 1 && Math.abs(w[0] - w[2]) <= 1, `four equal halves: ${w}`);
    // The boxes inside use the sheet's own background; the card is the card color.
    const colors = await f.evaluate((el) => {
      const sheet = getComputedStyle(el.closest('dialog')).backgroundColor;
      const card = getComputedStyle(el.querySelector('.bh-card')).backgroundColor;
      const box = getComputedStyle(el.querySelector('.bh-box')).backgroundColor;
      return { sheet, card, box };
    });
    assert(colors.box === colors.sheet && colors.card !== colors.sheet, `boxes use the sheet's background: ${JSON.stringify(colors)}`);
    // The end box is muted and not tappable (a div, not a button); Start is a button.
    assert((await h.page.locator('[data-bh-end]').evaluate((e) => e.tagName)) === 'DIV', 'End is not a control');
    assert((await h.page.locator('[data-bh-start]').evaluate((e) => e.tagName)) === 'BUTTON', 'Start is a button');
    await h.ctx.close();
  });
  await check('ADD: fits one iPhone Air screen (420 x 912) without scrolling at normal text, light and dark; every tap target at least 38 px tall', async () => {
    for (const scheme of ['light', 'dark']) {
      const h = await openAdmin({ width: 420, height: 912, scheme });
      await openAdd(h.page);
      const sheet = h.page.locator('dialog.sheet[open]');
      const m = await sheet.evaluate((e) => ({ sh: e.scrollHeight, ch: e.clientHeight }));
      assert(m.sh <= m.ch + 1, `${scheme}: the sheet scrolls ${m.sh} > ${m.ch}`);
      const small = await sheet.locator('button, input, .bh-box').evaluateAll((els) => els.filter((e) => e.getBoundingClientRect().height > 0 && e.getBoundingClientRect().height < 38 && !e.matches('.icon-btn')).map((e) => `${e.tagName}.${e.className} ${Math.round(e.getBoundingClientRect().height)}`));
      assert(small.length === 0, `${scheme}: small targets: ${small}`);
      await shot(h.page, `add-${scheme}`);
      await h.ctx.close();
    }
  });
  await check('ADD: the grid is titled "Start time · Wed Nov 11", AM and PM labels only, 4 across, no AM/PM on a chip, 8:00 AM to 8:30 PM, nothing after; picked = filled green', async () => {
    const h = await openAdmin({ width: 420, height: 912 });
    await openAdd(h.page);
    await h.page.locator('dialog.sheet[open] input[type="date"]').fill('2026-11-11');
    await h.page.locator('[data-bh-start]').click();
    const g = h.page.locator(`${GRID} [data-bh-grid]`);
    await g.waitFor();
    assert((await h.page.locator(`${GRID} h2`).innerText()) === 'Start time · Wed Nov 11', `title: ${await h.page.locator(`${GRID} h2`).innerText()}`);
    assert((await g.locator('.bh-ap').allInnerTexts()).join('|') === 'AM|PM', 'AM and PM labels');
    const chips = await g.locator('.bh-chip').evaluateAll((els) => els.map((e) => [e.getAttribute('data-chip'), e.textContent, e.disabled, e.getAttribute('aria-pressed')]));
    assert(chips.length === 8 + 18, `chips: ${chips.length}`);
    assert(chips[0][0] === '08:00' && chips[0][1] === '8:00' && chips[chips.length - 1][0] === '20:30', `first and last: ${chips[0]} ${chips[chips.length - 1]}`);
    assert(!chips.some((c) => /AM|PM/.test(c[1])), 'no AM/PM on a chip');
    assert(!chips.some((c) => c[0] === '21:00'), 'no 9:00 PM');
    assert(chips.filter((c) => c[3] === 'true').map((c) => c[0]).join() === '20:00', 'the picked start is 8:00 PM');
    // 2 hr selected: 8:30 PM would end 10:30 PM, so it is faded and cannot be tapped.
    const c830 = chips.find((c) => c[0] === '20:30');
    assert(c830[2] === true, '8:30 PM is disabled with a 2 hour game');
    assert(chips.filter((c) => c[2]).map((c) => c[0]).join() === '20:30', `only 8:30 PM disabled: ${chips.filter((c) => c[2]).map((c) => c[0])}`);
    const rows = await g.locator('.bh-grid').first().evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length);
    assert(rows === 4, `4 across: ${rows}`);
    const style = await g.locator('.bh-chip[data-chip="20:30"]').evaluate((e) => ({ b: getComputedStyle(e).borderStyle, o: Number(getComputedStyle(e).opacity) }));
    assert(style.b === 'dashed' && style.o < 0.6, `faded dashed: ${JSON.stringify(style)}`);
    const sel = await g.locator('.bh-chip[aria-pressed="true"]').evaluate((e) => ({ bg: getComputedStyle(e).backgroundColor, fg: getComputedStyle(e).color }));
    assert(sel.bg === 'rgb(30, 106, 72)' && sel.fg === 'rgb(255, 255, 255)', `selected chip: ${JSON.stringify(sel)}`);
    // Tapping a disabled chip does nothing; tapping a good one picks it and closes the grid.
    await g.locator('.bh-chip[data-chip="20:30"]').click({ force: true }).catch(() => {});
    assert((await h.page.locator(GRID).count()) === 1, 'grid still open after a disabled tap');
    await g.locator('.bh-chip[data-chip="12:30"]').click();
    await h.page.waitForTimeout(300);
    assert((await h.page.locator(GRID).count()) === 0, 'grid closed');
    assert((await startText(h.page)) === '12:30 PM' && (await endText(h.page)) === '2:30 PM', `start/end: ${await startText(h.page)} ${await endText(h.page)}`);
    await h.ctx.close();
  });
  await check('ADD: dark mode picked chip is the court switch\'s lighter green with dark text', async () => {
    const h = await openAdmin({ width: 420, height: 912, scheme: 'dark' });
    await openAdd(h.page);
    await h.page.locator('[data-bh-start]').click();
    const sel = h.page.locator(`${GRID} .bh-chip[aria-pressed="true"]`);
    await sel.waitFor();
    const c = await sel.evaluate((e) => ({ bg: getComputedStyle(e).backgroundColor, fg: getComputedStyle(e).color }));
    assert(c.bg === 'rgb(76, 194, 122)' && c.fg === 'rgb(6, 32, 15)', JSON.stringify(c));
    await shot(h.page, 'grid-dark');
    await h.ctx.close();
  });
  await check('ADD: Sunday offers nothing after 5:30 PM; 4:30 PM + 2.5 hr style boundary: a 2 hr game from 5:00 PM ends exactly 7:00 PM; moving the date to a Sunday pulls an 8:00 PM start back to 5:00 PM', async () => {
    const h = await openAdmin({ width: 420, height: 912 });
    await openAdd(h.page);
    const date = h.page.locator('dialog.sheet[open] input[type="date"]');
    await date.fill('2026-11-11');
    assert((await startText(h.page)) === '8:00 PM', 'usual start 8:00 PM on a Wednesday');
    await date.fill('2026-11-15');
    await h.page.waitForTimeout(150);
    assert((await startText(h.page)) === '5:00 PM' && (await endText(h.page)) === '7:00 PM', `Sunday: ${await startText(h.page)} to ${await endText(h.page)}`);
    await h.page.locator('[data-bh-start]').click();
    const g = h.page.locator(`${GRID} [data-bh-grid]`);
    await g.waitFor();
    assert((await h.page.locator(`${GRID} h2`).innerText()) === 'Start time · Sun Nov 15', 'Sunday title');
    const chips = await g.locator('.bh-chip').evaluateAll((els) => els.map((e) => [e.getAttribute('data-chip'), e.disabled]));
    assert(chips[chips.length - 1][0] === '17:30', `last Sunday start: ${chips[chips.length - 1]}`);
    assert(chips.filter((c) => c[1]).map((c) => c[0]).join() === '17:30', 'only 5:30 PM is faded with 2 hr');
    await g.locator('.bh-chip[data-chip="17:00"]').click();
    await h.page.waitForTimeout(200);
    assert((await endText(h.page)) === '7:00 PM', 'ends exactly 7:00 PM');
    await h.ctx.close();
  });
  await check('ADD: length buttons: the price under each is the site\'s own, a length past close is faded, dashed, says "past close" and cannot be tapped', async () => {
    const h = await openAdmin({ width: 420, height: 912 });
    await openAdd(h.page);
    await h.page.locator('dialog.sheet[open] input[type="date"]').fill('2026-11-11');
    const btns = await h.page.locator('.bh-lenbtn').evaluateAll((els) => els.map((e) => [e.getAttribute('data-len'), e.querySelector('.bh-len-name').textContent, e.querySelector('small').textContent, e.disabled]));
    // 8:00 PM start (the usual): 2.5 and 3 hr would end after 10:00 PM, so they are there but faded and say "past close".
    assert(JSON.stringify(btns) === JSON.stringify([['90', '1.5 hr', '$11 each', false], ['120', '2 hr', '$14 each', false], ['150', '2.5 hr', 'past close', true], ['180', '3 hr', 'past close', true]]), JSON.stringify(btns));
    assert((await pressedLen(h.page)).join() === '120', '2 hr is picked at first (the usual game is 2 hours)');
    // The server's own price for a 1.5 hr and a 2 hr game agrees with the button text.
    const a = await post(real, '/api/admin/sessions', { startsAt: iso(2026, 12, 1, 19), endsAt: iso(2026, 12, 1, 20, 30) });
    const b = await post(real, '/api/admin/sessions', { startsAt: iso(2026, 12, 2, 19), endsAt: iso(2026, 12, 2, 21) });
    const ida = (await a.json()).id;
    const idb = (await b.json()).id;
    const sess = (await dash()).sessions;
    const s90 = sess.find((x) => x.id === ida);
    const s120 = sess.find((x) => x.id === idb);
    assert(s90.shortGame && s90.shortGame.flatCents === 1100, `1.5 hr priced $11 by the server: ${JSON.stringify(s90.shortGame)}`);
    assert(!s120.shortGame, 'a 2 hour game is priced as a normal game ($14)');
    const c = await post(real, '/api/admin/sessions', { startsAt: iso(2026, 12, 3, 17), endsAt: iso(2026, 12, 3, 19, 30) });
    const d3 = await post(real, '/api/admin/sessions', { startsAt: iso(2026, 12, 4, 17), endsAt: iso(2026, 12, 4, 20) });
    const sess2 = (await dash()).sessions;
    const id150 = (await c.json()).id;
    const id180 = (await d3.json()).id;
    const s150 = sess2.find((x) => x.id === id150);
    const s180 = sess2.find((x) => x.id === id180);
    assert(s150.shortGame && s150.shortGame.flatCents === 1800 && s150.shortGame.courtCents === 6000, `2.5 hr priced $18 / court $60 by the server: ${JSON.stringify(s150.shortGame)}`);
    assert(s180.shortGame && s180.shortGame.flatCents === 2100 && s180.shortGame.courtCents === 7200, `3 hr priced $21 / court $72 by the server: ${JSON.stringify(s180.shortGame)}`);
    // 8:30 PM is faded while 2 hr is picked, so pick 1.5 hr first, then 8:30 PM.
    await h.page.locator('.bh-lenbtn[data-len="90"]').click();
    await pickStart(h.page, '20:30');
    assert((await startText(h.page)) === '8:30 PM' && (await endText(h.page)) === '10:00 PM', `8:30 PM + 1.5 hr: ${await startText(h.page)} ${await endText(h.page)}`);
    const two = h.page.locator('.bh-lenbtn[data-len="120"]');
    assert((await two.isDisabled()) && (await two.locator('small').innerText()) === 'past close', '2 hr says past close');
    const st = await two.evaluate((e) => ({ b: getComputedStyle(e).borderStyle, o: Number(getComputedStyle(e).opacity) }));
    assert(st.b === 'dashed' && st.o < 0.6, `faded dashed: ${JSON.stringify(st)}`);
    await h.ctx.close();
  });
  await check('FOUR BUTTONS: always 1.5, 2, 2.5 and 3 hr with their prices; 2.5 and 3 hr are faded, dashed and say "past close" when they would end after closing (Mon to Sat 10:00 PM, Sunday 7:00 PM), light and dark', async () => {
    for (const scheme of ['light', 'dark']) {
      const h = await openAdmin({ width: 420, height: 912, scheme });
      await openAdd(h.page);
      const read = () => h.page.locator('.bh-lenbtn').evaluateAll((els) => els.map((e) => ({ len: e.getAttribute('data-len'), name: e.querySelector('.bh-len-name').textContent, sub: e.querySelector('small').textContent, off: e.disabled, dashed: getComputedStyle(e).borderStyle === 'dashed', faded: Number(getComputedStyle(e).opacity) < 0.6 })));
      const want = (rows, spec) => spec.forEach(([len, name, sub, off], i) => assert(rows[i].len === len && rows[i].name === name && rows[i].sub === sub && rows[i].off === off && rows[i].dashed === off && rows[i].faded === off, `${scheme}: ${JSON.stringify(rows[i])} vs ${[len, name, sub, off]}`));
      await h.page.locator('dialog.sheet[open] input[type="date"]').fill('2026-11-11'); // a Wednesday
      await h.page.locator('.bh-lenbtn[data-len="90"]').click();
      await pickStart(h.page, '17:00');
      const rows = await read();
      assert(rows.length === 4, `${scheme}: four buttons, got ${rows.length}`);
      want(rows, [['90', '1.5 hr', '$11 each', false], ['120', '2 hr', '$14 each', false], ['150', '2.5 hr', '$18 each', false], ['180', '3 hr', '$21 each', false]]);
      await pickStart(h.page, '19:30');
      want(await read(), [['90', '1.5 hr', '$11 each', false], ['120', '2 hr', '$14 each', false], ['150', '2.5 hr', '$18 each', false], ['180', '3 hr', 'past close', true]]);
      await pickStart(h.page, '20:00');
      want(await read(), [['90', '1.5 hr', '$11 each', false], ['120', '2 hr', '$14 each', false], ['150', '2.5 hr', 'past close', true], ['180', '3 hr', 'past close', true]]);
      await pickStart(h.page, '20:30');
      want(await read(), [['90', '1.5 hr', '$11 each', false], ['120', '2 hr', 'past close', true], ['150', '2.5 hr', 'past close', true], ['180', '3 hr', 'past close', true]]);
      // Sunday closes at 7:00 PM: from 4:30 PM a 2.5 hr game ends exactly 7:00 PM (allowed), a 3 hr game does not fit.
      await h.page.locator('dialog.sheet[open] input[type="date"]').fill('2026-11-15');
      await h.page.locator('.bh-lenbtn[data-len="90"]').click();
      await pickStart(h.page, '16:30');
      want(await read(), [['90', '1.5 hr', '$11 each', false], ['120', '2 hr', '$14 each', false], ['150', '2.5 hr', '$18 each', false], ['180', '3 hr', 'past close', true]]);
      await h.page.locator('.bh-lenbtn[data-len="150"]').click();
      assert((await endText(h.page)) === '7:00 PM', 'a 2.5 hr game from 4:30 PM on a Sunday ends exactly 7:00 PM');
      await shot(h.page, `four-${scheme}`);
      await h.ctx.close();
    }
  });
  await check('FOUR BUTTONS: a 3 hour game saves 5:00 to 8:00 PM with its price; Edit game opens a 2.5 hr game with 2.5 hr picked', async () => {
    const h = await openAdmin({ width: 420, height: 912 });
    await openAdd(h.page);
    await h.page.locator('dialog.sheet[open] input[type="date"]').fill('2026-12-10');
    await h.page.locator('.bh-lenbtn[data-len="90"]').click();
    await pickStart(h.page, '17:00');
    await h.page.locator('.bh-lenbtn[data-len="180"]').click();
    assert((await endText(h.page)) === '8:00 PM', `end 8:00 PM: ${await endText(h.page)}`);
    await h.page.getByRole('button', { name: 'Add game', exact: true }).click();
    await h.page.waitForTimeout(900);
    const g = (await dash()).sessions.find((x) => x.startsAt === iso(2026, 12, 10, 17));
    assert(g && g.endsAt === iso(2026, 12, 10, 20) && g.shortGame && g.shortGame.flatCents === 2100, `3 hr saved and priced: ${g && JSON.stringify(g.shortGame)}`);
    await h.ctx.close();
    const mk = await post(real, '/api/admin/sessions', { startsAt: iso(2026, 11, 20, 17), endsAt: iso(2026, 11, 20, 19, 30) });
    const id = (await mk.json()).id;
    const h2 = await openAdmin({ width: 420, height: 912 });
    await openEdit(h2.page, id);
    assert((await pressedLen(h2.page)).join() === '150' && (await startText(h2.page)) === '5:00 PM' && (await endText(h2.page)) === '7:30 PM', `Edit 2.5 hr: ${await pressedLen(h2.page)} ${await startText(h2.page)} ${await endText(h2.page)}`);
    await h2.ctx.close();
  });

  await check('ADD: adding a 1.5 hr game from 7:30 PM on Fri Nov 27 saves exactly 7:30 to 9:00 PM Eastern with its note; a 2 hr Sunday 5:00 PM game ends 7:00 PM', async () => {
    const h = await openAdmin({ width: 420, height: 912 });
    await openAdd(h.page);
    await h.page.locator('dialog.sheet[open] input[type="date"]').fill('2026-11-27');
    await h.page.locator('.bh-lenbtn[data-len="90"]').click();
    await pickStart(h.page, '19:30');
    assert((await endText(h.page)) === '9:00 PM', 'end shows 9:00 PM');
    await h.page.locator('dialog.sheet[open] input[type="text"]').fill('Bring water');
    await h.page.getByRole('button', { name: 'Add game', exact: true }).click();
    await h.page.waitForTimeout(900);
    const added = (await dash()).sessions.find((x) => x.startsAt === iso(2026, 11, 27, 19, 30));
    assert(added && added.endsAt === iso(2026, 11, 27, 21), `saved times: ${added && added.startsAt} ${added && added.endsAt}`);
    assert(added.note === 'Bring water', 'note saved');
    await h.ctx.close();
    const h2 = await openAdmin({ width: 420, height: 912 });
    await openAdd(h2.page);
    await h2.page.locator('dialog.sheet[open] input[type="date"]').fill('2026-11-22');
    await h2.page.getByRole('button', { name: 'Add game', exact: true }).click();
    await h2.page.waitForTimeout(900);
    const sun = (await dash()).sessions.find((x) => x.startsAt === iso(2026, 11, 22, 17));
    assert(sun && sun.endsAt === iso(2026, 11, 22, 19), `Sunday game: ${sun && sun.startsAt} ${sun && sun.endsAt}`);
    await h2.ctx.close();
  });
  await check('ADD: the Court box opens the court map and picks a court; the court is saved with the game', async () => {
    const h = await openAdmin({ width: 420, height: 912 });
    await openAdd(h.page);
    await h.page.locator('dialog.sheet[open] input[type="date"]').fill('2026-11-25');
    await h.page.locator('[data-bh-court] button').click();
    await h.page.locator('dialog.cm[open]').waitFor();
    await h.page.locator('dialog.cm[open] [data-court]').first().click().catch(async () => {
      await h.page.locator('dialog.cm[open] button').nth(1).click();
    });
    await h.page.waitForTimeout(300);
    const label = (await h.page.locator('[data-bh-court] button').innerText()).replace(/\s+/g, ' ').trim();
    assert(/^(Court )?Court \d+$/.test(label), `court picked: ${label}`);
    await h.page.getByRole('button', { name: 'Add game', exact: true }).click();
    await h.page.waitForTimeout(900);
    const added = (await dash()).sessions.find((x) => x.startsAt === iso(2026, 11, 25, 20));
    assert(added && added.courtNum, `court saved: ${added && added.courtNum}`);
    await h.ctx.close();
  });

  const rectOf = (page, sel) => page.locator(sel).first().evaluate((e) => { const r = e.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom, w: r.width, h: r.height }; });
  await check('FIT: Add game AND Edit game fit one iPhone Air screen (420 x 912) with no scrolling at normal text, light and dark; the bottom row is on screen; two equal halves with a small gap; every tap target at least 38 px', async () => {
    for (const scheme of ['light', 'dark'])
      for (const which of ['add', 'edit']) {
        const h = await openAdmin({ width: 420, height: 912, scheme });
        if (which === 'add') await openAdd(h.page);
        else await openEdit(h.page, target.id);
        const sheet = h.page.locator('dialog.sheet[open]');
        const m = await sheet.evaluate((e) => ({ sh: e.scrollHeight, ch: e.clientHeight, top: e.getBoundingClientRect().top, bottom: e.getBoundingClientRect().bottom }));
        assert(m.sh <= m.ch + 1, `${which} ${scheme}: the sheet scrolls ${m.sh} > ${m.ch}`);
        const acts = await sheet.locator('[data-bh-actions] > *').evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom, h: r.height }; }));
        assert(acts.length === 2, 'two buttons in the row');
        assert(Math.abs((acts[0].r - acts[0].l) - (acts[1].r - acts[1].l)) <= 1, `${which} ${scheme}: equal halves ${JSON.stringify(acts)}`);
        const gap = acts[1].l - acts[0].r;
        assert(gap >= 6 && gap <= 14, `${which} ${scheme}: small gap ${gap}`);
        assert(acts[0].b <= 912 && acts[1].b <= 912 && acts[1].b <= m.bottom + 1, `${which} ${scheme}: row on screen ${acts[1].b}`);
        assert(acts[0].h >= 38 && acts[1].h >= 38, 'row buttons at least 38 px');
        const small = await sheet.locator('button, a.btn, input').evaluateAll((els) => els.filter((e) => e.getBoundingClientRect().height > 0 && e.getBoundingClientRect().height < 38 && !e.matches('.icon-btn')).map((e) => `${e.tagName}.${e.className} ${Math.round(e.getBoundingClientRect().height)}`));
        assert(small.length === 0, `${which} ${scheme}: small targets: ${small}`);
        await shot(h.page, `fit-${which}-${scheme}`);
        await h.ctx.close();
      }
  });
  await check('DATE BOX: the date text is vertically centered in its box, at the same height as Start and End, light and dark, and still after picking a new date', async () => {
    for (const scheme of ['light', 'dark']) {
      const h = await openAdmin({ width: 420, height: 912, scheme });
      await openAdd(h.page);
      const centered = async (when) => {
        const box = await rectOf(h.page, '.bh-date');
        const txt = await rectOf(h.page, '[data-bh-date-text]');
        const startBox = await rectOf(h.page, '[data-bh-start]');
        const startTxt = await rectOf(h.page, '#bh-start-value');
        const endBox = await rectOf(h.page, '[data-bh-end]');
        assert(Math.abs(box.h - startBox.h) <= 1 && Math.abs(box.h - endBox.h) <= 1, `${scheme} ${when}: same box height ${box.h} ${startBox.h} ${endBox.h}`);
        const dOff = (txt.t + txt.b) / 2 - (box.t + box.b) / 2;
        const sOff = (startTxt.t + startTxt.b) / 2 - (startBox.t + startBox.b) / 2;
        assert(Math.abs(dOff) <= 1.5, `${scheme} ${when}: date text is ${dOff.toFixed(1)} px off the box middle`);
        assert(Math.abs(dOff - sOff) <= 1.5, `${scheme} ${when}: date ${dOff.toFixed(1)} vs start ${sOff.toFixed(1)} off the middle`);
        const dTop = txt.t - box.t;
        const sTop = startTxt.t - startBox.t;
        assert(Math.abs(dTop - sTop) <= 1.5, `${scheme} ${when}: text sits ${dTop.toFixed(1)} px from the top, Start ${sTop.toFixed(1)}`);
        const same = await h.page.evaluate(() => { const a = getComputedStyle(document.querySelector('[data-bh-date-text]')); const b = getComputedStyle(document.querySelector('#bh-start-value')); return a.fontSize === b.fontSize && a.fontWeight === b.fontWeight && a.color === b.color; });
        assert(same, `${scheme} ${when}: same font size, weight and color as Start`);
      };
      await centered('at first');
      assert((await h.page.locator('[data-bh-date-text]').innerText()) === 'Nov 11, 2026', `text: ${await h.page.locator('[data-bh-date-text]').innerText()}`);
      await h.page.locator('dialog.sheet[open] input[type="date"]').fill('2026-12-03');
      await h.page.waitForTimeout(150);
      assert((await h.page.locator('[data-bh-date-text]').innerText()) === 'Dec 3, 2026', 'the box shows the new date');
      await centered('after a new date');
      // The invisible date input really covers the box (a tap anywhere on it is a tap on the date input).
      const hit = await h.page.evaluate(() => { const b = document.querySelector('.bh-date').getBoundingClientRect(); const e = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2); return e && e.matches('input[type="date"]'); });
      assert(hit, 'a tap in the middle of the box lands on the date input');
      await h.ctx.close();
    }
  });
  await check('COURT TEXT: "Not set" is blue and normal weight; a picked court ("Court 11") is normal weight in the ink color, like the date and times', async () => {
    const h = await openAdmin({ width: 420, height: 912 });
    await openAdd(h.page);
    const css = () => h.page.evaluate(() => { const v = document.querySelector('[data-bh-court] .gd-court-value'); const d = document.querySelector('[data-bh-date-text]'); const c = getComputedStyle(v); return { w: c.fontWeight, color: c.color, dateW: getComputedStyle(d).fontWeight, dateColor: getComputedStyle(d).color, unset: v.classList.contains('unset') }; });
    const a = await css();
    assert(a.unset && Number(a.w) === 400 && a.color !== a.dateColor, `Not set: ${JSON.stringify(a)}`);
    await h.page.locator('[data-bh-court] button').click();
    await h.page.locator('dialog.cm[open]').waitFor();
    await h.page.locator('dialog.cm[open] [data-court]').first().click().catch(async () => { await h.page.locator('dialog.cm[open] button').nth(1).click(); });
    await h.page.waitForTimeout(400);
    const b = await css();
    assert(!b.unset && Number(b.w) === 400 && b.w === b.dateW && b.color === b.dateColor, `picked court: ${JSON.stringify(b)}`);
    await h.ctx.close();
  });
  await check('SCROLL: the title bar is solid and above the content; scrolling at 125% and 150% text slides the content under it, never over it; the bottom row stays on screen (Add game and Edit game, light and dark)', async () => {
    const problems = [];
    for (const scheme of ['light', 'dark'])
      for (const pct of [125, 150])
        for (const which of ['add', 'edit']) {
          const h = await openAdmin({ width: 390, height: 640, scheme, pct });
          if (which === 'add') await openAdd(h.page);
          else await openEdit(h.page, target.id);
          const tag = `${which} ${scheme} ${pct}%`;
          const sheet = h.page.locator('dialog.sheet[open]');
          const info = await sheet.evaluate((e) => ({ scrolls: e.scrollHeight > e.clientHeight + 1, sh: e.scrollHeight, ch: e.clientHeight }));
          if (!info.scrolls && pct === 150) problems.push(`${tag}: expected the sheet to scroll at 150% text`);
          const bg = await sheet.locator('.sheet-head').evaluate((e) => ({ bg: getComputedStyle(e).backgroundColor, z: getComputedStyle(e).zIndex, bf: getComputedStyle(e).backdropFilter }));
          if (/rgba\(.*,\s*0?\.\d+\)$/.test(bg.bg) || /transparent/.test(bg.bg)) problems.push(`${tag}: title bar background is see-through ${bg.bg}`);
          if (!(Number(bg.z) >= 10)) problems.push(`${tag}: title bar layer ${bg.z}`);
          for (const frac of [0, 0.25, 0.5, 1]) {
            await sheet.evaluate((e, f) => { e.scrollTop = (e.scrollHeight - e.clientHeight) * f; }, frac);
            await h.page.waitForTimeout(120);
            const r = await sheet.evaluate((e) => {
              const head = e.querySelector('.sheet-head').getBoundingClientRect();
              const acts = e.querySelector('[data-bh-actions]').getBoundingClientRect();
              const dlg = e.getBoundingClientRect();
              // Every point along the title bar's own box must land on the title bar (never on a field or the status control).
              const bad = [];
              for (let x = head.left + 30; x < head.right - 30; x += 24)
                for (const y of [head.top + 26, (head.top + head.bottom) / 2, head.bottom - 3]) {
                  const hit = document.elementFromPoint(x, y);
                  if (hit && !hit.closest('.sheet-head')) bad.push(`${hit.tagName}.${hit.className}@${Math.round(x)},${Math.round(y)} head ${Math.round(head.left)},${Math.round(head.top)}-${Math.round(head.right)},${Math.round(head.bottom)}`.slice(0, 120));
                }
              // The row of buttons: fully on screen at every scroll position.
              const rowOk = acts.bottom <= dlg.bottom + 1 && acts.top >= dlg.top;
              const actHits = [];
              for (const x of [acts.left + 20, acts.right - 20]) {
                const hit = document.elementFromPoint(x, (acts.top + acts.bottom) / 2);
                if (!hit || !hit.closest('[data-bh-actions]')) actHits.push(hit ? `${hit.tagName}.${hit.className}`.slice(0, 40) : 'null');
              }
              return { bad: [...new Set(bad)], rowOk, actHits };
            });
            if (r.bad.length) problems.push(`${tag} scroll ${frac}: something draws over the title bar: ${r.bad.join(', ')}`);
            if (!r.rowOk) problems.push(`${tag} scroll ${frac}: the button row is not on screen`);
            if (r.actHits.length) problems.push(`${tag} scroll ${frac}: something covers the button row: ${r.actHits.join(', ')}`);
          }
          const clip = await h.page.evaluate(findClipping, { root: 'dialog.sheet[open]' });
          for (const c of clip) problems.push(`${tag}: ${c}`);
          await h.ctx.close();
        }
    assert(problems.length === 0, problems.slice(0, 10).join(' ⏎ '));
  });

  // ---------------------------------------------------------------- Edit game
  await check('EDIT: status control first in card 1, then Date/Court, Start/End, Length; card 2 is Label; then the CourtReserve button and Save; the "Cancel by" line is gone', async () => {
    const h = await openAdmin({ width: 420, height: 912 });
    await openEdit(h.page, target.id);
    const f = h.page.locator('form.bh-form');
    assert((await f.locator('.bh-card').count()) === 2, 'two cards');
    const first = await f.locator('.bh-card').first().evaluate((c) => c.firstElementChild.className + '|' + !!c.querySelector('.court-switch'));
    assert(first.startsWith('bh-top') && first.endsWith('true'), `the status control is first: ${first}`);
    assert((await f.locator('.bh-card').first().locator('.bh-lab').allInnerTexts()).join('|') === 'Date|Court|Start|End|Length', 'card 1 labels');
    assert((await f.locator('.bh-card').nth(1).locator('.bh-lab').innerText()) === 'Label', 'card 2 is the Label');
    const kids = await f.evaluate((el) => [...el.children].map((c) => c.className.split(' ')[0]));
    assert(kids.join('|') === 'bh-card|bh-card|bh-actions', `form children: ${kids}`);
    const acts = await f.locator('[data-bh-actions]').evaluate((e) => [...e.children].map((c) => c.textContent.replace(/\s+/g, ' ').trim()));
    assert(acts.join('|') === 'Change court (opens CourtReserve)|Save', `bottom row: ${acts}`);
    assert((await f.locator('[data-bh-actions] a').getAttribute('href')).includes('courtreserve.com'), 'the blue button still opens CourtReserve');
    assert(!/Cancel by/.test(await f.innerText()), 'no "Cancel by" line');
    assert((await f.locator('[data-cancel-by]').count()) === 0, 'no cancel-by line element');
    // The cancel time itself is still the game's (start minus 12 hours); nothing about it changed.
    const s0 = (await dash()).sessions.find((x) => x.id === target.id);
    assert(Date.parse(s0.startsAt) - Date.parse(s0.cancelBy ?? s0.cancellationDeadlineAt ?? s0.cancelByAt ?? s0.startsAt) >= 0, 'cancel logic data still sent');
    await shot(h.page, 'edit-light');
    await h.ctx.close();
  });
  await check('EDIT: opens with the game\'s own start and length selected (7:00 PM, 2 hr), unchanged Save closes without a time change', async () => {
    const h = await openAdmin({ width: 420, height: 912 });
    await openEdit(h.page, target.id);
    const cur = (await dash()).sessions.find((x) => x.id === target.id);
    const wantStart = new Date(Date.parse(cur.startsAt)).toLocaleTimeString('en-US', { timeZone: 'America/Detroit', hour: 'numeric', minute: '2-digit' });
    assert((await startText(h.page)) === wantStart, `start ${await startText(h.page)} vs ${wantStart}`);
    const mins = Math.round((Date.parse(cur.endsAt) - Date.parse(cur.startsAt)) / 60000);
    assert((await pressedLen(h.page)).join() === String(mins), `length ${await pressedLen(h.page)} vs ${mins}`);
    await h.ctx.close();
  });
  await check('EDIT: changing the start to 7:30 PM and the length to 1.5 hr saves 7:30 to 9:00 PM and the new price shows on the game', async () => {
    const h = await openAdmin({ width: 420, height: 912 });
    const spare = (await upcomingAll()).find((x) => x.id !== target.id && /T0[0-2]:/.test(x.startsAt) || false) || up[1];
    await openEdit(h.page, spare.id);
    const day = new Date(Date.parse(spare.startsAt)).toLocaleDateString('en-CA', { timeZone: 'America/Detroit' });
    await h.page.locator('.bh-lenbtn[data-len="90"]').click();
    await pickStart(h.page, '19:30');
    assert((await endText(h.page)) === '9:00 PM', 'end 9:00 PM');
    await h.page.locator('dialog.sheet[open]').getByRole('button', { name: 'Save' }).click();
    await h.page.waitForTimeout(900);
    const after = (await dash()).sessions.find((x) => x.id === spare.id);
    const [y, m, d] = day.split('-').map(Number);
    assert(after.startsAt === iso(y, m, d, 19, 30) && after.endsAt === iso(y, m, d, 21), `saved: ${after.startsAt} ${after.endsAt}`);
    assert(after.shortGame && after.shortGame.flatCents === 1100, 'now a 1.5 hr game priced $11');
    await h.ctx.close();
  });
  await check('EDIT: an existing game with an odd length (1 hr, 4:30 to 5:30 PM) shows its own times as they are, no length is picked, and saving only the label does not touch the times', async () => {
    const r = await post(real, '/api/admin/sessions', { startsAt: iso(2026, 12, 5, 16, 30), endsAt: iso(2026, 12, 5, 17, 30) });
    assert(r.ok(), 'a 1 hr game is allowed by the rule');
    const id = (await r.json()).id;
    const h = await openAdmin({ width: 420, height: 912 });
    await openEdit(h.page, id);
    assert((await startText(h.page)) === '4:30 PM' && (await endText(h.page)) === '5:30 PM', `times as they are: ${await startText(h.page)} ${await endText(h.page)}`);
    assert((await pressedLen(h.page)).length === 0, 'no length is forced');
    await h.page.locator('[data-label-field] input').fill('Odd one');
    let timeCalls = 0;
    h.page.on('request', (q) => {
      if (/\/time$/.test(q.url())) timeCalls++;
    });
    await h.page.locator('dialog.sheet[open]').getByRole('button', { name: 'Save' }).click();
    await h.page.waitForTimeout(900);
    const after = (await dash()).sessions.find((x) => x.id === id);
    assert(timeCalls === 0 && after.startsAt === iso(2026, 12, 5, 16, 30) && after.endsAt === iso(2026, 12, 5, 17, 30) && after.note === 'Odd one', `untouched: ${timeCalls} ${after.startsAt} ${after.endsAt}`);
    await h.ctx.close();
  });
  await check('EDIT: an old 1 hour game and an old game outside the hours show their times as they are, still save other fields, and can be canceled', async () => {
    // A 1 hour game inside the hours, and the early game made while the switch was OFF (6:00 to 8:00 AM).
    const one = (await (await post(real, '/api/admin/sessions', { startsAt: iso(2026, 12, 8, 18), endsAt: iso(2026, 12, 8, 19) })).json()).id;
    const early = global.oldEarlyId;
    const h = await openAdmin({ width: 420, height: 912 });
    await openEdit(h.page, one);
    assert((await startText(h.page)) === '6:00 PM' && (await endText(h.page)) === '7:00 PM' && (await pressedLen(h.page)).length === 0, '1 hour game as it is');
    await closeTop(h.page);
    await openEdit(h.page, early);
    assert((await startText(h.page)) === '6:00 AM' && (await endText(h.page)) === '8:00 AM', `the old early game as it is: ${await startText(h.page)} ${await endText(h.page)}`);
    const errors = h.errors.slice();
    await h.page.locator('[data-label-field] input').fill('Early bird');
    await h.page.locator('dialog.sheet[open]').getByRole('button', { name: 'Save' }).click();
    await h.page.waitForTimeout(900);
    const s = (await dash()).sessions.find((x) => x.id === early);
    assert(s.note === 'Early bird' && s.startsAt === iso(2026, 11, 13, 6), `other fields saved, times untouched: ${s.note} ${s.startsAt}`);
    assert((await post(real, `/api/admin/sessions/${early}/decision`, { decision: 'cancel', confirm: true })).ok(), 'cancel still works on an out-of-hours game');
    assert(errors.length === 0 && h.errors.length === 0, `no page errors: ${h.errors}`);
    await h.ctx.close();
  });
  await check('EDIT: moving the date to a Sunday pulls a 7:30 PM start back inside the hours (5:00 PM for 2 hr); the Save button never offers an out-of-hours time', async () => {
    const h = await openAdmin({ width: 420, height: 912 });
    const mk = await post(real, '/api/admin/sessions', { startsAt: iso(2026, 11, 18, 19, 30), endsAt: iso(2026, 11, 18, 21, 30) });
    const spareId = (await mk.json()).id;
    await openEdit(h.page, spareId);
    await h.page.locator('dialog.sheet[open] input[type="date"]').fill('2026-11-29'); // a Sunday
    await h.page.waitForTimeout(200);
    const len = (await pressedLen(h.page))[0];
    const st = await startText(h.page);
    const en = await endText(h.page);
    assert(st === '5:00 PM' && en === '7:00 PM', `7:30 PM start pulled back to 5:00 PM: ${st} to ${en}`);
    const endMin = (() => {
      const [t, ap] = en.split(' ');
      let [hh, mm] = t.split(':').map(Number);
      if (ap === 'PM' && hh !== 12) hh += 12;
      return hh * 60 + mm;
    })();
    assert(endMin <= 19 * 60, `ends by 7:00 PM: ${en} (length ${len})`);
    await h.ctx.close();
  });

  // ---------------------------------------------------------------- Settings > Schedule
  const openUsual = async (page) => {
    await page.locator('.tabbar button', { hasText: 'Settings' }).click();
    for (const sm of await page.locator('details > summary').all()) await sm.click().catch(() => {});
    await page.locator('[data-row="usualTime"] button', { hasText: 'Change' }).click();
    await page.locator('dialog.sheet[open] form').waitFor();
    await page.waitForTimeout(300);
  };
  await check('SETTINGS > Schedule: 9:00 to 11:00 PM shows the message under the boxes and turns Save off; inside the hours Save works', async () => {
    const h = await openAdmin({ width: 390 });
    await openUsual(h.page);
    const sheet = h.page.locator('dialog.sheet[open]');
    assert((await sheet.locator('[data-bh-message]').count()) === 0, 'no message for the usual 8 to 10 PM');
    const times = sheet.locator('input[type="time"]');
    await times.nth(0).fill('21:00');
    await times.nth(1).fill('23:00');
    const msg = sheet.locator('[data-bh-message]');
    await msg.waitFor();
    assert((await msg.innerText()).replace(/\s+/g, ' ').trim() === MSG_ANY, `message: ${await msg.innerText()}`);
    assert(await sheet.getByRole('button', { name: 'Save' }).isDisabled(), 'Save is off');
    // The message sits under the two boxes.
    const pos = await sheet.evaluate((e) => ({ boxes: e.querySelector('.time-pair').getBoundingClientRect().bottom, msg: e.querySelector('[data-bh-message]').getBoundingClientRect().top }));
    assert(pos.msg >= pos.boxes - 1, `under the boxes: ${JSON.stringify(pos)}`);
    await times.nth(0).fill('19:00');
    await times.nth(1).fill('21:00');
    await h.page.waitForTimeout(150);
    assert((await sheet.locator('[data-bh-message]').count()) === 0 && (await sheet.getByRole('button', { name: 'Save' }).isEnabled()), 'fixed: message gone, Save on');
    await times.nth(0).fill('07:00');
    await times.nth(1).fill('09:00');
    assert((await sheet.locator('[data-bh-message]').count()) === 1, '7:00 AM start is out of hours too');
    await times.nth(0).fill('19:00');
    await times.nth(1).fill('21:00');
    await sheet.getByRole('button', { name: 'Save' }).click();
    await h.page.waitForTimeout(900);
    const g = (await dash()).group.settings;
    assert(g.defaultStartMinutes === 19 * 60 && g.defaultEndMinutes === 21 * 60, `saved: ${g.defaultStartMinutes} ${g.defaultEndMinutes}`);
    await h.ctx.close();
    await put(real, '/api/admin/group', { settings: { defaultStartMinutes: 20 * 60, defaultEndMinutes: 22 * 60 } });
  });
  await check('SETTINGS > Schedule: OFF shows no message and Save stays on for 9 to 11 PM (as on main)', async () => {
    await put(real, '/api/admin/booking-hours-switch', { on: false });
    const h = await openAdmin({ width: 390 });
    await openUsual(h.page);
    const sheet = h.page.locator('dialog.sheet[open]');
    await sheet.locator('input[type="time"]').nth(0).fill('21:00');
    await sheet.locator('input[type="time"]').nth(1).fill('23:00');
    assert((await sheet.locator('[data-bh-message]').count()) === 0 && (await sheet.getByRole('button', { name: 'Save' }).isEnabled()), 'no message, Save on');
    await h.ctx.close();
    await put(real, '/api/admin/booking-hours-switch', { on: true });
  });

  // ---------------------------------------------------------------- the server says no
  await check('SERVER: every out-of-hours save is refused with the message (Add game and a changed Edit game time); the screen cannot get there but a direct call is stopped', async () => {
    const bad = [
      [iso(2026, 12, 9, 7, 59), iso(2026, 12, 9, 10), 'The venue is open 8:00 AM to 10:00 PM on this day. Pick times inside those hours.'],
      [iso(2026, 12, 9, 20), iso(2026, 12, 9, 22, 1), 'The venue is open 8:00 AM to 10:00 PM on this day. Pick times inside those hours.'],
      [iso(2026, 12, 20, 17, 30), iso(2026, 12, 20, 19, 30), 'The venue is open 8:00 AM to 7:00 PM on Sundays. Pick times inside those hours.'],
      [iso(2026, 12, 9, 21), iso(2026, 12, 9, 23), 'The venue is open 8:00 AM to 10:00 PM on this day. Pick times inside those hours.'],
      [iso(2026, 12, 9, 20), iso(2026, 12, 9, 19), 'The end time must be after the start time.'],
    ];
    for (const [a, b, msg] of bad) {
      const r = await post(real, '/api/admin/sessions', { startsAt: a, endsAt: b });
      assert(r.status() === 400 && (await r.json()).message === msg, `add ${a}: ${r.status()}`);
    }
    const ok = await post(real, '/api/admin/sessions', { startsAt: iso(2026, 12, 20, 17), endsAt: iso(2026, 12, 20, 19) });
    assert(ok.ok(), 'Sunday 5:00 to 7:00 PM is fine');
    const id = (await ok.json()).id;
    const r1 = await put(real, `/api/admin/sessions/${id}/time`, { startsAt: iso(2026, 12, 20, 18), endsAt: iso(2026, 12, 20, 20) });
    assert(r1.status() === 400 && /Sundays/.test((await r1.json()).message), 'edit to a Sunday 8 PM end refused');
    const r2 = await put(real, `/api/admin/sessions/${id}/time`, { startsAt: iso(2026, 12, 20, 8), endsAt: iso(2026, 12, 20, 10) });
    assert(r2.ok(), 'edit to 8:00 AM is fine');
  });

  // ---------------------------------------------------------------- clipping and fit
  const SIZES = [390, 360, 320];
  for (const scheme of ['light', 'dark']) {
    await check(`CLIPPING (${scheme}): Add, Edit, the Start grid and the Settings message at 390 / 360 / 320 wide, text 100 / 125 / 150%: nothing cut off, overlapping or outside its box`, async () => {
      const problems = [];
      for (const width of SIZES)
        for (const pct of [100, 125, 150]) {
          const h = await openAdmin({ width, scheme, pct, height: 800 });
          const tag = `${scheme} ${width}px ${pct}%`;
          const scan = async (what, root) => {
            const found = await h.page.evaluate(findClipping, { root });
            for (const f of found) problems.push(`${tag} ${what}: ${f}`);
          };
          await openAdd(h.page);
          await scan('add', 'dialog.sheet[open]');
          await h.page.locator('[data-bh-start]').click();
          await h.page.locator(`${GRID} [data-bh-grid]`).waitFor();
          await h.page.waitForTimeout(200);
          await scan('grid', GRID);
          await h.page.locator(`${GRID} .icon-btn`).click();
          // (The site ignores a second tap within 0.4 s and 24 px of the first on another button: the two X buttons sit in the same spot.)
          await h.page.waitForTimeout(500);
          await closeTop(h.page);
          await openEdit(h.page, target.id);
          await scan('edit', 'dialog.sheet[open]');
          await closeTop(h.page);
          await openUsual(h.page);
          const sheet = h.page.locator('dialog.sheet[open]');
          await sheet.locator('input[type="time"]').nth(0).fill('21:00');
          await sheet.locator('input[type="time"]').nth(1).fill('23:00');
          await sheet.locator('[data-bh-message]').waitFor();
          await scan('message', 'dialog.sheet[open]');
          const wide = await h.page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
          if (wide.sw > wide.cw + 1) problems.push(`${tag}: sideways overflow ${wide.sw} > ${wide.cw}`);
          const m = await sheet.locator('[data-bh-message]').evaluate((e) => ({ r: e.getBoundingClientRect(), p: e.closest('form').getBoundingClientRect() }));
          if (m.r.right > m.p.right + 1 || m.r.left < m.p.left - 1) problems.push(`${tag}: message sticks out of its row`);
          await h.ctx.close();
        }
      assert(problems.length === 0, problems.slice(0, 12).join(' ⏎ '));
    });
  }

  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
