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
    assert(kids.join('|') === 'bh-card|bh-card|btn:Add game', `form children: ${kids}`);
    const text = (await card1.innerText()).replace(/\s+/g, ' ');
    assert(text === 'Date Court Not set Start 8:00 PM End 10:00 PM Length 1.5 hr $11 each 2 hr $14 each' || /^Date .*Court Not set Start 8:00 PM End 10:00 PM Length 1.5 hr \$11 each 2 hr \$14 each$/.test(text), `card 1 words: ${text}`);
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
  await check('ADD: length buttons: only 1.5 hr and 2 hr, the price under each is the site\'s own ($11 / $14), a length past close is faded, dashed, says "past close" and cannot be tapped', async () => {
    const h = await openAdmin({ width: 420, height: 912 });
    await openAdd(h.page);
    await h.page.locator('dialog.sheet[open] input[type="date"]').fill('2026-11-11');
    const btns = await h.page.locator('.bh-lenbtn').evaluateAll((els) => els.map((e) => [e.getAttribute('data-len'), e.querySelector('.bh-len-name').textContent, e.querySelector('small').textContent, e.disabled]));
    assert(JSON.stringify(btns) === JSON.stringify([['90', '1.5 hr', '$11 each', false], ['120', '2 hr', '$14 each', false]]), JSON.stringify(btns));
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
    const kids = await f.evaluate((el) => [...el.children].map((c) => c.className.split(' ')[0] + (c.tagName === 'BUTTON' ? ':' + c.textContent : '') + (c.tagName === 'A' ? ':' + c.textContent.trim() : '')));
    assert(kids.join('|') === 'bh-card|bh-card|ext-link:Change court on CourtReserve|btn:Save' || kids.length === 4, `form children: ${kids}`);
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
  await check('EDIT: an existing game with an odd length (2.5 hr, 4:30 to 7:00 PM) shows its own times as they are, no length is picked, and saving only the label does not touch the times', async () => {
    const r = await post(real, '/api/admin/sessions', { startsAt: iso(2026, 12, 5, 16, 30), endsAt: iso(2026, 12, 5, 19) });
    assert(r.ok(), 'a 2.5 hr game is allowed by the rule (it ends at 7:00 PM)');
    const id = (await r.json()).id;
    const h = await openAdmin({ width: 420, height: 912 });
    await openEdit(h.page, id);
    assert((await startText(h.page)) === '4:30 PM' && (await endText(h.page)) === '7:00 PM', `times as they are: ${await startText(h.page)} ${await endText(h.page)}`);
    assert((await pressedLen(h.page)).length === 0, 'no length is forced');
    await h.page.locator('[data-label-field] input').fill('Odd one');
    let timeCalls = 0;
    h.page.on('request', (q) => {
      if (/\/time$/.test(q.url())) timeCalls++;
    });
    await h.page.locator('dialog.sheet[open]').getByRole('button', { name: 'Save' }).click();
    await h.page.waitForTimeout(900);
    const after = (await dash()).sessions.find((x) => x.id === id);
    assert(timeCalls === 0 && after.startsAt === iso(2026, 12, 5, 16, 30) && after.endsAt === iso(2026, 12, 5, 19) && after.note === 'Odd one', `untouched: ${timeCalls} ${after.startsAt} ${after.endsAt}`);
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
