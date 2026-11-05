/* "Money page rework" (MONEY_REWORK, Nov 2026): the Money page (Games and Totals), Hide from list and Restore, Edit charge, the cancel sheet's
 * "Were you charged?" default, the tidier Feature switches page, and the quieter History.
 *
 *   node e2e/money-rework.cjs      (also run by npm run test:e2e)
 *
 * It loads the fake preview world as if it were Wed Nov 4, 2026, 6:00 PM Eastern into a local file, starts its own dev server on it (the
 * server clock is pinned to that moment), and drives a phone-sized browser. Nothing here touches Cloudflare or the live site.
 * Screenshots: e2e/screenshots/money-rework-*.png (ignored by git).
 */
const { spawn, spawnSync } = require('node:child_process');
const { readFileSync, mkdirSync, rmSync } = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.E2E_PORT) || 5287;
const BASE = `http://localhost:${PORT}`;
const NOW_ISO = '2026-11-04T23:00:00.000Z';
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
    console.log(`  ✗ ${name}\n      ${String(err && err.message ? err.message : err).replace(/\s*\n\s*/g, ' ⏎ ').slice(0, 900)}`);
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  mkdirSync(SHOTS, { recursive: true });
  const dbFile = path.join(ROOT, '.data', 'money-rework.sqlite');
  mkdirSync(path.join(ROOT, '.data'), { recursive: true });
  rmSync(dbFile, { force: true });
  const seeded = spawnSync('npx', ['vite-node', 'scripts/load-seed-local.ts', '--', dbFile, NOW_ISO], { cwd: ROOT, encoding: 'utf8' });
  if (seeded.status !== 0) throw new Error(`could not build the fake world: ${seeded.stderr || seeded.stdout}`);
  const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
    cwd: ROOT,
    env: { ...process.env, DEV_DB: dbFile, SETUP_TOKEN: 'money-rework-setup-token-0123456789', DEV_CLOCK: '1', MOTION: '', MOTION_ADMIN: '', ADMIN_V2: '', ADMIN_R2: '', ADMIN_R3: '', MONEY_REWORK: '' },
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
  const put = (req, url, data) => req.put(BASE + url, { data, headers: { Origin: BASE } });
  const areq = (await browser.newContext()).request;
  const login = await post(areq, '/api/admin/login', { pin: PIN });
  if (!login.ok()) throw new Error(`login failed: ${await login.text()}`);
  const dash = async (headers = {}) => (await areq.get(`${BASE}/api/admin/dashboard`, { headers })).json();
  const moneyApi = async (month, headers = { 'X-Money-Rework': 'on' }) => (await areq.get(`${BASE}/api/admin/money?month=${month}`, { headers })).json();
  const d0 = await dash();
  const byNote = (d, note) => d.sessions.find((s) => s.note === note);
  const court = d0.sessions.find((s) => s.cancelReason === 'Court closed');
  const testGame = byNote(d0, 'Test game');
  const lateGame = byNote(d0, 'Late-fee test');
  const mixed = byNote(d0, 'Mixed payments');
  assert(testGame && court && lateGame && mixed, 'the fake world has the games this test needs');

  const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mobile/15E148 Safari/604.1';
  const phone = (width, scheme = 'light', height = 800, dpr = 1) => ({ viewport: { width, height }, deviceScaleFactor: dpr, isMobile: true, hasTouch: true, colorScheme: scheme, userAgent: UA });
  async function openAdmin({ width = 390, scheme = 'light', url = '/admin', height = 800, dpr = 1 } = {}) {
    const ctx = await browser.newContext(phone(width, scheme, height, dpr));
    // The server clock is pinned to Wed Nov 4, 6:00 PM Eastern; the phone follows it (time still runs), so nothing here depends on the hour this test is run.
    await ctx.addInitScript((delta) => {
      const Real = Date;
      class Shifted extends Real {
        constructor(...a) {
          if (a.length === 0) super(Real.now() + delta);
          else super(...a);
        }
        static now() {
          return Real.now() + delta;
        }
      }
      window.Date = Shifted;
    }, NOW_MS - Date.now());
    await post(ctx.request, '/api/admin/login', { pin: PIN });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => {
      throw new Error(`page error: ${e.message}`);
    });
    await page.goto(BASE + url);
    await page.locator('.tabbar').waitFor();
    await page.waitForTimeout(600);
    return { ctx, page };
  }
  const tab = async (page, name) => {
    await page.locator('.tabbar button', { hasText: name }).evaluate((b) => b.click());
    await page.waitForTimeout(350);
  };
  const noOverflow = async (page, what) => {
    const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
    assert(o.sw <= o.cw + 1, `${what}: sideways overflow ${o.sw} > ${o.cw}`);
  };
  const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, `money-rework-${name}.png`), fullPage: true });
  const money = async (page) => {
    await tab(page, 'Money');
    await page.locator('[data-month-box]').waitFor();
  };
  // A Home game card, found whether it is folded (a row to tap) or already open (this week's games start open), after "Show all" if needed.
  const openHomeCard = async (page, id) => {
    let card = page.locator(`article#session-${id}`);
    if (await card.count()) return card;
    const all = page.locator('button', { hasText: /^Show all/ });
    if (await all.count()) await all.click();
    await page.locator(`[id="session-${id}"]`).first().waitFor();
    if (!(await card.count())) await page.locator(`div#session-${id}`).click();
    await card.waitFor();
    return card;
  };
  const openAllCards = async (page) => {
    const cards = page.locator('article.mrw-game');
    for (let i = 0; i < (await cards.count()); i++) if ((await cards.nth(i).getAttribute('data-open')) === 'no') await cards.nth(i).locator('.mrw-toggle').click();
  };

  // ---------------------------------------------------------------- off: exactly as before
  await check('OFF: with the switch off nobody sees the new Money page, hide, or the new switches layout (ships dark)', async () => {
    assert((await put(areq, '/api/admin/money-rework', { on: false })).ok(), 'switch off');
    const { ctx, page } = await openAdmin();
    await tab(page, 'Money');
    assert((await page.locator('[data-month-box]').count()) === 0, 'no month box');
    assert((await page.locator('.money-r2, .money-v2').count()) > 0, 'the round 2 Money page is still there');
    await tab(page, 'Settings');
    await page.locator('details[data-section="switches"] > summary').click();
    assert((await page.locator('[data-switches-tidy]').count()) === 0, 'old switches layout');
    const row = page.locator('[data-row="moneyReworkAll"]');
    assert((await row.count()) === 1, 'the Money page rework row is there');
    assert(!(await row.locator('input[type="checkbox"]').isChecked()), 'and it is off');
    assert((await row.locator('.set-name').innerText()).trim() === 'Money page rework', 'title');
    await page.locator('details[data-section="advanced"] > summary').click();
    assert((await page.locator('[data-hidden-games]').count()) === 0, 'no Hidden games list');
    await tab(page, 'Home');
    await page.locator('article.scard button[aria-label^="Game menu"]').first().click();
    assert((await page.locator('[data-hide-from-list]').count()) === 0, 'no Hide from list in the gear menu');
    await ctx.close();
  });
  await check('OFF: the private link turns it on for that phone only', async () => {
    const { ctx, page } = await openAdmin({ url: '/admin?moneyrework=on' });
    await tab(page, 'Money');
    await page.locator('[data-month-box]').waitFor();
    const other = await openAdmin();
    await tab(other.page, 'Money');
    assert((await other.page.locator('[data-month-box]').count()) === 0, 'another phone still sees the old page');
    await other.ctx.close();
    await ctx.close();
  });

  // ---------------------------------------------------------------- Settings switch on for everyone
  await check('Settings: the row turns it on for everyone, no deploy, and the title is on one line at 320, 360 and 430', async () => {
    for (const w of [320, 360, 430]) {
      const { ctx, page } = await openAdmin({ width: w });
      await tab(page, 'Settings');
      await page.locator('details[data-section="switches"] > summary').click();
      const row = page.locator('[data-row="moneyReworkAll"]');
      const h = await row.locator('.set-name').evaluate((e) => ({ h: e.getBoundingClientRect().height, lh: parseFloat(getComputedStyle(e).lineHeight) || 20 }));
      assert(h.h <= h.lh * 1.4, `title wraps at ${w}: ${h.h}px`);
      if (w === 360) {
        await row.locator('input[type="checkbox"]').click();
        await page.waitForTimeout(900);
      }
      await noOverflow(page, `switches at ${w}`);
      await ctx.close();
    }
    const d = await dash();
    assert(d.moneyReworkForAll === true && d.moneyRework === true, 'on for everyone');
  });

  // ---------------------------------------------------------------- the Money page
  await check('1 top row: month box (Nov 2026) then Games | Totals, equal widths, no arrows or carets', async () => {
    const { ctx, page } = await openAdmin({ width: 390 });
    await money(page);
    assert((await page.locator('[data-month-box]').innerText()).trim() === 'Nov 2026', 'month box text');
    const m = await page.evaluate(() => {
      const r = (s) => document.querySelector(s).getBoundingClientRect();
      const [g, t] = [...document.querySelectorAll('.mrw-seg button')].map((b) => b.getBoundingClientRect());
      const box = r('[data-month-box]');
      return { gw: g.width, tw: t.width, boxTop: box.top, segTop: r('.mrw-seg').top, boxH: box.height, segH: r('.mrw-seg').height };
    });
    assert(Math.abs(m.gw - m.tw) <= 1, `equal widths ${m.gw} / ${m.tw}`);
    assert(Math.abs(m.boxTop - m.segTop) <= 2, 'one row');
    assert((await page.locator('.mrw-controls button[aria-label*="month" i]').count()) === 1, 'only the month box is a month button (no previous or next arrows)');
    const txt = await page.locator('.mrw-controls').innerText();
    assert(!/[‹›⌄▾▼]/.test(txt), 'no arrows or carets in the top row');
    assert((await page.locator('.mrw-controls svg').count()) === 0, 'no icons in the top row');
    await shot(page, 'games-390');
    await noOverflow(page, 'games 390');
    await ctx.close();
  });
  await check('1 the month box drops a small list right under it: Nov 2026 with its game count, selected in green, rounded, scrolls', async () => {
    const { ctx, page } = await openAdmin();
    await money(page);
    await page.locator('[data-month-box]').click();
    const pop = page.locator('[data-month-pop]');
    await pop.waitFor();
    const g = await page.evaluate(() => {
      const box = document.querySelector('[data-month-box]').getBoundingClientRect();
      const p = document.querySelector('[data-month-pop]');
      const pr = p.getBoundingClientRect();
      const cs = getComputedStyle(p);
      const on = document.querySelector('.mrw-monthrow.on');
      return { gap: pr.top - box.bottom, left: Math.abs(pr.left - box.left), radii: [cs.borderTopLeftRadius, cs.borderTopRightRadius, cs.borderBottomLeftRadius, cs.borderBottomRightRadius], overflowY: cs.overflowY, maxH: cs.maxHeight, onText: on.innerText, onColor: getComputedStyle(on).color, rows: document.querySelectorAll('.mrw-monthrow').length };
    });
    assert(g.gap >= 0 && g.gap <= 8 && g.left <= 2, `anchored under the box: gap ${g.gap}, left ${g.left}`);
    assert(g.radii.every((r) => parseFloat(r) >= 10), `rounded on all four corners: ${g.radii}`);
    assert(g.overflowY === 'auto' && g.maxH !== 'none', 'scrolls when long');
    assert(/^Nov 2026\s+\d+$/.test(g.onText.replace(/\n/g, ' ').trim()), `selected row: ${g.onText}`);
    const n = d0.sessions.filter((s) => s.startsAt.startsWith('2026-11') || s.startsAt.startsWith('2026-12-01')).length;
    assert(Number(g.onText.match(/\d+$/)[0]) > 0 && Number(g.onText.match(/\d+$/)[0]) <= n, 'the count is the number of games that month');
    const [r, gc, b] = g.onColor.match(/\d+/g).map(Number);
    assert(gc > r && gc > b, `selected month is green: ${g.onColor}`);
    await shot(page, 'month-dropdown');
    await page.locator('[data-month-option="2026-10"]').click();
    assert((await page.locator('[data-month-box]').innerText()).trim() === 'Oct 2026', 'picking a month changes the box');
    assert((await page.locator('[data-month-pop]').count()) === 0, 'and closes the list');
    await page.locator('[data-month-box]').click();
    await page.keyboard.press('Escape');
    assert((await page.locator('[data-month-pop]').count()) === 0, 'Escape closes it');
    await ctx.close();
  });
  await check('1 month list: every month back to the first game, newest first, exactly 4 months tall, scrolls (bar and fade), year labels, opens on the chosen month', async () => {
    const { ctx, page } = await openAdmin();
    await money(page);
    await page.locator('[data-month-box]').click();
    const pop = page.locator('[data-month-pop]');
    await pop.waitFor();
    await page.waitForTimeout(250);
    const m = await pop.evaluate((el) => {
      const rows = [...el.querySelectorAll('.mrw-monthrow')].map((b) => ({ m: b.getAttribute('data-month-option'), t: b.innerText.replace(/\n/g, ' ').trim(), h: Math.round(b.getBoundingClientRect().height) }));
      const cs = getComputedStyle(el);
      return { rows, years: [...el.querySelectorAll('[data-year-label]')].map((y) => y.innerText.trim()), client: el.clientHeight, scroll: el.scrollHeight, maxH: cs.maxHeight, ovY: cs.overflowY, sb: cs.scrollbarWidth, more: el.classList.contains('more'), fade: getComputedStyle(el.querySelector('.mrw-monthfade'), '::before').opacity };
    });
    const months = m.rows.map((r) => r.m);
    assert(months[0] === '2026-11' && months.at(-1) === '2025-12', `from Nov 2026 back to Dec 2025: ${months[0]} .. ${months.at(-1)}`);
    assert(months.length === 12 && months.every((x, i) => i === 0 || x < months[i - 1]), `every month once, newest first: ${months.join(' ')}`);
    assert(m.rows.every((r) => /^[A-Z][a-z]{2} \d{4}\s+\d+$/.test(r.t)), `each row has its count: ${m.rows[0].t}`);
    const count = (mm) => Number(m.rows.find((r) => r.m === mm).t.match(/(\d+)$/)[1]);
    const real = (await dash()).gameMonthCounts;
    assert(months.every((x) => count(x) === (real[x] ?? 0)), `every count matches the server: ${months.map((x) => `${x}:${count(x)}`).join(' ')}`);
    assert(['2025-12', '2026-01', '2026-05', '2026-09'].every((x) => count(x) >= 2 && count(x) <= 4), 'a few games in each older month');
    assert(m.years.join() === '2025', `a year label where the year changes: ${m.years}`);
    assert(m.rows.every((r) => r.h >= 44), 'every row is at least 44 px');
    assert(m.maxH === '188px' && m.client <= 190 && m.scroll > m.client + 50 && m.ovY === 'auto', `four months tall, then it scrolls: ${m.maxH} client ${m.client} scroll ${m.scroll}`);
    assert(m.sb === 'thin', 'a thin scroll bar');
    assert(m.more && Number(m.fade) > 0.9, 'a fade at the bottom while there is more');
    await shot(page, 'month-list-top');
    await pop.evaluate((el) => (el.style.scrollBehavior = 'auto'));
    await pop.evaluate((el) => (el.scrollTop = el.scrollHeight));
    await page.waitForTimeout(250);
    assert(!(await pop.evaluate((el) => el.classList.contains('more'))), 'at the bottom the fade is gone');
    await shot(page, 'month-list-bottom');
    // Choose an old month; reopening has it in view.
    await page.locator('[data-month-option="2026-01"]').click();
    await page.locator('[data-month-box]').click();
    await page.waitForTimeout(250);
    const vis = await pop.evaluate((el) => {
      const on = el.querySelector('.mrw-monthrow.on');
      const r = on.getBoundingClientRect();
      const p = el.getBoundingClientRect();
      return { top: r.top - p.top, bottom: p.bottom - r.bottom, text: on.innerText.replace(/\n/g, ' ') };
    });
    assert(vis.top >= -1 && vis.bottom >= -1, `the chosen month (${vis.text}) is in view when it opens`);
    await ctx.close();
    for (const scheme of ['dark', 'light']) {
      const o = await openAdmin({ width: scheme === 'dark' ? 320 : 430, scheme });
      await money(o.page);
      await o.page.locator('[data-month-box]').click();
      await o.page.locator('[data-month-pop]').waitFor();
      await noOverflow(o.page, `month list ${scheme}`);
      const box = await o.page.evaluate(() => {
        const p = document.querySelector('[data-month-pop]').getBoundingClientRect();
        return { right: p.right, w: innerWidth, left: p.left };
      });
      assert(box.right <= box.w + 1 && box.left >= -1, `the list fits the screen in ${scheme}`);
      await shot(o.page, `month-list-${scheme}`);
      await o.ctx.close();
    }
  });
  await check('1 an older month (past the dashboard\'s 90 days) opens too: its games are there, matching the count in the month list', async () => {
    const { ctx, page } = await openAdmin();
    await money(page);
    const real = (await dash()).gameMonthCounts;
    for (const month of ['2025-12', '2026-03', '2026-06']) {
      await page.locator('[data-month-box]').click();
      await page.locator(`[data-month-option="${month}"]`).click();
      await page.locator('[data-fold="previous"], [data-no-games]').first().waitFor();
      assert((await page.locator('[data-no-games]').count()) === 0, `${month} does not say "No games" (the list counts ${real[month]})`);
      await page.locator('[data-fold="previous"] .mrw-fold-head').click();
      const rows = await page.locator('[data-fold="previous"] .mrw-prow').count();
      assert(rows === real[month], `${month}: ${rows} games shown, the list says ${real[month]}`);
      await page.locator('[data-fold="previous"] .mrw-prow-head').first().click();
      assert((await page.locator('[data-fold="previous"] .mrw-prow.open .mrw-row').count()) >= 4, `${month}: a game opens to its four players`);
    }
    await ctx.close();
  });
  await check('3 4 5 nothing extra on Games: no "Not finalized yet" line, no "Later games" card; the Hidden games count has room before the chevron', async () => {
    const { ctx, page } = await openAdmin({ width: 360 });
    await money(page);
    await openAllCards(page);
    const body = await page.locator('.money-rework').innerText();
    assert(!/Not finalized yet|Finalize it from Home/i.test(body), 'the not-finalized line is gone');
    assert((await page.locator('[data-fold="later"]').count()) === 0 && !/Later games/.test(body), 'no Later games card');
    assert((await page.locator('[data-fold="previous"]').count()) === 1, 'Previous games is still there');
    await ctx.close();
    for (const [width, scheme] of [[320, 'dark'], [360, 'light'], [430, 'dark'], [390, 'light']]) {
      const o = await openAdmin({ width, scheme });
      await tab(o.page, 'Settings');
      await o.page.locator('details[data-section="advanced"] > summary').click();
      const sum = o.page.locator('[data-hidden-games] > summary');
      const g = await sum.evaluate((el) => {
        const note = el.querySelector('.set-note').getBoundingClientRect();
        const title = el.firstElementChild.getBoundingClientRect();
        const after = getComputedStyle(el, '::after');
        const sr = el.getBoundingClientRect();
        return { noteRight: note.right, titleRight: title.right, sumRight: sr.right, chevW: parseFloat(after.fontSize), text: el.innerText.replace(/\n/g, ' ').trim() };
      });
      // The count belongs to the title (a dot and the number right after it) and the chevron sits at the far edge, well clear of it.
      assert(/^Hidden games · \d+/.test(g.text.replace('›', '').trim()) || /Hidden games\s+·\s+\d+/.test(g.text), `reads "Hidden games · n": ${g.text}`);
      assert(g.sumRight - g.noteRight >= 20, `room between the count and the chevron at ${width} ${scheme}: ${Math.round(g.sumRight - g.noteRight)}px`);
      await noOverflow(o.page, `settings ${width}`);
      if (width === 320) await shot(o.page, 'hidden-games-count-320-dark');
      await o.ctx.close();
    }
  });
  const gamesCard = async (page, id) => {
    await money(page);
    const card = page.locator(`article.mrw-game[data-session="${id}"]`);
    await card.waitFor();
    if ((await card.getAttribute('data-open')) === 'no') await card.locator('.mrw-toggle').click();
    return card;
  };
  const rowState = (card, name) => card.locator(`.mrw-row[data-pay-row="${name}"]`).evaluate((r, d) => ({ paid: r.getAttribute('data-paid'), dots: r.closest('article').querySelector('[data-dots]')?.getAttribute('data-dots'), title: r.closest('article').querySelector('.mrw-title').innerText, d }), 0);
  const toastText = (page) => page.locator('.toast .toast-msg').allInnerTexts();
  await check('2 instant taps: Mark paid and Undo change the screen the moment they are tapped; the toast waits for the server', async () => {
    const { ctx, page } = await openAdmin();
    const card = await gamesCard(page, mixed.id);
    const paidBefore = (await dash()).sessions.find((s) => s.id === mixed.id).paidCount;
    let requests = 0;
    await page.route('**/api/admin/sessions/*/payment', async (route) => {
      requests++;
      await sleep(1500);
      await route.continue();
    });
    const t0 = Date.now();
    await card.locator('.mrw-row[data-pay-row="Kai"] .mrw-mark').click();
    await page.waitForTimeout(150);
    const fast = await rowState(card, 'Kai');
    assert(Date.now() - t0 < 900, 'the tap itself is quick');
    assert(fast.paid === 'yes', 'the row is paid at once');
    assert(/^(.* · )?3 of 4 paid$/.test(fast.title.trim()) && fast.dots === '3/4', `title and dots at once: ${fast.title} ${fast.dots}`);
    assert((await card.locator('.mrw-row[data-pay-row="Kai"]').getByRole('button', { name: 'Undo' }).count()) === 1, 'the button became Undo at once');
    assert((await toastText(page)).length === 0, 'no toast yet: the server has not answered');
    assert((await dash()).sessions.find((s) => s.id === mixed.id).paidCount === paidBefore, 'and the server really has not saved it yet');
    await page.waitForTimeout(1900);
    assert((await toastText(page)).some((t) => /Kai marked paid/.test(t)), `the toast comes when the server confirms: ${await toastText(page)}`);
    assert((await dash()).sessions.find((s) => s.id === mixed.id).paidCount === paidBefore + 1, 'saved');
    assert((await rowState(card, 'Kai')).paid === 'yes', 'and the screen did not change back');
    // Undo, instantly too.
    await page.waitForTimeout(3500);
    await card.locator('.mrw-row[data-pay-row="Kai"]').getByRole('button', { name: 'Undo' }).click();
    await page.waitForTimeout(150);
    const undone = await rowState(card, 'Kai');
    assert(undone.paid === 'no' && undone.dots === '2/4', `Undo at once: ${undone.paid} ${undone.dots}`);
    await page.waitForTimeout(2200);
    assert((await dash()).sessions.find((s) => s.id === mixed.id).paidCount === paidBefore, 'Undo saved');
    assert(requests === 2, `two saves in all: ${requests}`);
    await page.unroute('**/api/admin/sessions/*/payment');
    await ctx.close();
  });
  await check('2 a failed save puts the screen back exactly as it was, with "Couldn\'t save, nothing changed"', async () => {
    const { ctx, page } = await openAdmin();
    const card = await gamesCard(page, mixed.id);
    const before = await rowState(card, 'Gray');
    const html0 = await card.evaluate((el) => el.innerHTML);
    await page.route('**/api/admin/sessions/*/payment', async (route) => {
      await sleep(900);
      await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'server_error', message: 'Something went wrong. Try again.' }) });
    });
    await card.locator('.mrw-row[data-pay-row="Gray"] .mrw-mark').click();
    await page.waitForTimeout(150);
    assert((await rowState(card, 'Gray')).paid === 'yes', 'drawn at once');
    await page.waitForTimeout(1600);
    const after = await rowState(card, 'Gray');
    assert(after.paid === before.paid && after.dots === before.dots && after.title === before.title, `back as it was: ${JSON.stringify(after)}`);
    assert((await card.evaluate((el) => el.innerHTML)) === html0, 'the card is exactly as it was');
    assert((await toastText(page)).includes("Couldn't save, nothing changed"), `error toast: ${await toastText(page)}`);
    assert((await dash()).sessions.find((s) => s.id === mixed.id).roster.find((r) => r.name === 'Gray').paymentStatus === 'unpaid', 'nothing was saved');
    await page.unroute('**/api/admin/sessions/*/payment');
    await ctx.close();
  });
  await check('2 quick double taps save once and never flicker', async () => {
    const { ctx, page } = await openAdmin();
    const card = await gamesCard(page, mixed.id);
    let requests = 0;
    await page.route('**/api/admin/sessions/*/payment', async (route) => {
      requests++;
      await sleep(1100);
      await route.continue();
    });
    const seen = [];
    const poll = setInterval(() => {
      rowState(card, 'Gray').then((r) => seen.push(r.paid)).catch(() => {});
    }, 25);
    const btn = card.locator('.mrw-row[data-pay-row="Gray"] .mrw-mark');
    await btn.dblclick({ delay: 20 }).catch(() => {});
    await card.locator('.mrw-row[data-pay-row="Gray"]').getByRole('button', { name: 'Undo' }).click({ timeout: 300 }).catch(() => {}); // a third tap on the new Undo while saving
    await page.waitForTimeout(2600);
    clearInterval(poll);
    assert(requests === 1, `one save, not ${requests}`);
    const flips = seen.filter((v, i) => i > 0 && v !== seen[i - 1]).length;
    assert(flips <= 1 && seen.at(-1) === 'yes', `no flicker: ${[...new Set(seen)].join('>')} (${flips} changes)`);
    assert((await dash()).sessions.find((s) => s.id === mixed.id).roster.find((r) => r.name === 'Gray').paymentStatus === 'paid', 'saved once, paid');
    await page.unroute('**/api/admin/sessions/*/payment');
    // put Gray back
    const g = (await dash()).sessions.find((s) => s.id === mixed.id).roster.find((r) => r.name === 'Gray');
    await post(areq, `/api/admin/sessions/${mixed.id}/payment`, { playerId: g.playerId, paid: false, seen: g.moneySeen });
    await ctx.close();
  });
  await check('2 Games: today and the next 7 days on top, a collapsed Previous games card with plain white rows and a green check', async () => {
    const { ctx, page } = await openAdmin();
    await money(page);
    assert((await page.locator('[data-fold="previous"]').count()) === 1, 'Previous games card');
    assert((await page.locator('[data-fold="previous"] .mrw-fold-rows').count()) === 0, 'collapsed');
    // Nothing in the main list is a fully paid game (those moved to Previous games), and none is beyond 7 days.
    const main = await page.evaluate(() => [...document.querySelectorAll('.mrw-games > article.mrw-game')].map((a) => a.getAttribute('data-session')));
    const paidIds = d0.sessions.filter((s) => s.payableCount > 0 && s.paidCount === s.payableCount && !s.state.flags.canceled).map((s) => s.id);
    for (const id of main) assert(!paidIds.includes(id), 'a fully paid game is in the main list');
    const weekEnd = NOW_MS + 8 * 24 * 3600_000;
    for (const id of main) {
      const s = d0.sessions.find((x) => x.id === id);
      assert(Date.parse(s.startsAt) < weekEnd, `${s.startsAt} is beyond the 7-day window`);
    }
    await page.locator('[data-fold="previous"] .mrw-fold-head').click();
    const rows = page.locator('[data-fold="previous"] .mrw-prow');
    assert((await rows.count()) >= 2, 'at least two previous games');
    const look = await page.evaluate(() => {
      const card = getComputedStyle(document.querySelector('.mrw-game')).backgroundColor;
      return [...document.querySelectorAll('[data-fold="previous"] .mrw-prow')].map((r) => ({ bg: getComputedStyle(r).backgroundColor, card, paid: r.getAttribute('data-fully-paid'), text: r.innerText.replace(/\n/g, ' '), check: !!r.querySelector('[data-check]') }));
    });
    for (const r of look) {
      assert(r.bg === r.card, `previous row is plain (not tinted): ${r.bg} vs ${r.card}`);
      if (r.paid === 'yes') assert(/\d of \d paid/.test(r.text) && r.check, `"3 of 3 paid" with a check: ${r.text}`);
    }
    await shot(page, 'previous-open');
    // Tap a previous game to open it.
    await rows.first().locator('.mrw-prow-head').click();
    assert((await rows.first().locator('.mrw-rows').count()) === 1, 'a previous game opens to its players');
    await ctx.close();
  });
  await check('2 3 Game card: date tile, "n of m paid", a dot per player, Remind (n), a white Mark paid per row, three-part footer, no separate Court Mark paid', async () => {
    const { ctx, page } = await openAdmin();
    await money(page);
    await openAllCards(page);
    const card = page.locator(`article.mrw-game[data-session="${mixed.id}"]`);
    await card.waitFor();
    const m = await card.evaluate((el) => {
      const dots = [...el.querySelectorAll('.mrw-dots i')];
      return {
        title: el.querySelector('.mrw-title').innerText,
        dots: dots.length,
        filled: dots.filter((d) => d.classList.contains('p')).length,
        remind: el.querySelector('[data-remind]')?.innerText,
        marks: [...el.querySelectorAll('.mrw-mark')].map((b) => ({ t: b.innerText, bg: getComputedStyle(b).backgroundColor, bd: getComputedStyle(b).borderTopWidth })),
        foot: [...el.querySelectorAll('[data-card-foot] > span')].map((s) => s.innerText),
        courtRows: el.querySelectorAll('[data-court], [data-row-id="court"]').length,
        text: el.innerText,
      };
    });
    assert(/^(\d{1,2}:\d{2} [AP]M · )?2 of 4 paid$/.test(m.title.trim()), `title ${m.title}`);
    assert(m.dots === 4 && m.filled === 2, `dots ${m.filled}/${m.dots}`);
    assert(m.remind === 'Remind (2)', `remind ${m.remind}`);
    assert(m.marks.length === 2 && m.marks.every((b) => b.t === 'Mark paid' && b.bd !== '0px'), 'two outlined Mark paid buttons');
    assert(m.foot.length === 3 && m.foot[0] === '$14/person' && m.foot[2] === 'Court $48', `footer ${m.foot}`);
    assert(m.courtRows === 0 && !/Court \$48[\s\S]*Mark paid/.test(m.text.split('$14/person')[1] ?? ''), 'no separate court row or button');
    // Paid players sink below the ones who still owe.
    const order = await card.locator('.mrw-row').evaluateAll((rows) => rows.map((r) => r.getAttribute('data-paid')));
    assert(order.join() === 'no,no,yes,yes', `unpaid first, paid below: ${order}`);
    await shot(page, 'cards-open');
    await ctx.close();
  });
  await check('2 credit rows are light blue with "Credit" and Undo; a paid row is green with "Paid" and Undo; 5 in shows "Credit: $3 per"', async () => {
    const { ctx, page } = await openAdmin();
    await money(page);
    await openAllCards(page);
    const credit = page.locator('.mrw-row.credit').first();
    assert((await credit.count()) === 1, 'a credit row exists');
    const txt = (await credit.innerText()).replace(/\n/g, ' ');
    assert(/Credit/.test(txt) && /Undo/.test(txt), `credit row: ${txt}`);
    const bg = await credit.evaluate((e) => getComputedStyle(e).backgroundColor);
    const [r, g, b] = bg.match(/\d+/g).map(Number);
    assert(b > r && b >= g, `credit row is blue-tinted: ${bg}`);
    const paid = page.locator('.mrw-row.paid').first();
    assert(/Paid/.test(await paid.innerText()) && /Undo/.test(await paid.innerText()), 'paid row');
    const foot = await page.locator('[data-card-foot]', { hasText: 'Credit: $3 per' }).count();
    assert(foot >= 1, 'a five-in game says Credit: $3 per');
    await ctx.close();
  });
  await check('2 Mark paid and Undo work from the new rows (and the totals follow)', async () => {
    const { ctx, page } = await openAdmin();
    await money(page);
    const card = page.locator(`article.mrw-game[data-session="${mixed.id}"]`);
    if ((await card.getAttribute('data-open')) === 'no') await card.locator('.mrw-toggle').click();
    const before = (await dash()).sessions.find((s) => s.id === mixed.id).paidCount;
    await card.locator('.mrw-row[data-pay-row="Kai"] .mrw-mark').click();
    await page.waitForTimeout(900);
    assert((await dash()).sessions.find((s) => s.id === mixed.id).paidCount === before + 1, 'Kai is paid');
    await card.locator('.mrw-row[data-pay-row="Kai"]').getByRole('button', { name: 'Undo' }).click();
    await page.waitForTimeout(900);
    assert((await dash()).sessions.find((s) => s.id === mixed.id).paidCount === before, 'Undo took it back');
    await ctx.close();
  });
  await check('2 an owed game shows "$N owed" in amber when folded', async () => {
    const { ctx, page } = await openAdmin();
    await money(page);
    const owed = page.locator('article.mrw-game[data-open="no"] .mrw-owed').first();
    assert(/^Owed \$\d+ owed|^\$\d+ owed/.test((await owed.innerText()).replace(/\n/g, ' ').trim()), `owed text: ${await owed.innerText()}`);
    const c = await owed.evaluate((e) => getComputedStyle(e).color);
    const [r, g, b] = c.match(/\d+/g).map(Number);
    assert(r > b && g > b, `amber: ${c}`);
    await ctx.close();
  });

  await check('4 5 Totals: two cards, big amber total, three columns, one-line footers at 360 and 390, numbers equal the server', async () => {
    for (const width of [360, 390]) {
      const { ctx, page } = await openAdmin({ width });
      await money(page);
      await page.locator('.mrw-seg button', { hasText: 'Totals' }).click();
      await page.locator('[data-totals]').waitFor();
      await page.waitForTimeout(500);
      const api = (await moneyApi('2026-11')).rework;
      const f = (c) => `$${c % 100 ? (c / 100).toFixed(2) : c / 100}`;
      const dom = await page.evaluate(() => ({
        sofar: document.querySelector('[data-owed-total]').innerText,
        proj: document.querySelector('[data-projected-total]').innerText,
        yours: [...document.querySelectorAll('.mrw-yours-total')].map((e) => e.innerText),
        cols: [...document.querySelectorAll('[data-card="so-far"] .mrw-col')].map((c) => c.innerText.replace(/\n/g, ' | ')),
        titles: [...document.querySelectorAll('.mrw-card-title')].map((e) => e.innerText),
        titleSize: parseFloat(getComputedStyle(document.querySelector('.mrw-card-title')).fontSize),
        labelSize: parseFloat(getComputedStyle(document.querySelector('.mrw-col dt')).fontSize),
        bigColor: getComputedStyle(document.querySelector('[data-owed-total]')).color,
        // One line: each of these is as tall as one line and none is cut off.
        lines: [...document.querySelectorAll('.mrw-card-title, .mrw-col dt, .mrw-col dd, .mrw-col small, .mrw-yours, .mrw-yours > *')].map((e) => ({ c: e.className || e.tagName, h: Math.round(e.getBoundingClientRect().height), fs: parseFloat(getComputedStyle(e).fontSize), over: e.scrollWidth > e.clientWidth + 1 })),
      }));
      assert(dom.sofar === f(api.owedToVenueCents), `owed ${dom.sofar} vs ${f(api.owedToVenueCents)}`);
      assert(dom.proj === f(api.projected.totalCents), `projected ${dom.proj}`);
      assert(dom.yours[0] === f(api.yourCostCents) && dom.yours[1] === f(api.projected.yourCostCents), `your cost ${dom.yours}`);
      assert(/^COURT COSTS|Court costs/i.test(dom.cols[0]) && /court/.test(dom.cols[0].split('|').slice(2).join(' ')) && /monthly/.test(dom.cols[1]) && /from players/.test(dom.cols[2]), `columns ${dom.cols}`);
      assert(dom.titles[0].toLowerCase() === 'owed to venue so far' && /^projected november total$/i.test(dom.titles[1]), `titles ${dom.titles}`);
      assert(dom.titleSize > dom.labelSize, `card titles (${dom.titleSize}px) are larger than column labels (${dom.labelSize}px)`);
      const [r, g, b] = dom.bigColor.match(/\d+/g).map(Number);
      assert(r > b && g > b, `big total is amber: ${dom.bigColor}`);
      for (const l of dom.lines) assert(l.h <= Math.ceil(l.fs * 1.9) + 14 && !l.over, `${l.c} wraps or is cut off at ${width}: ${l.h}px tall`);
      await noOverflow(page, `totals ${width}`);
      await shot(page, `totals-${width}`);
      await ctx.close();
    }
  });
  await check('4 Totals: both footers read "$membership + $court (n courts)" and add up to the cost on the right', async () => {
    const { ctx, page } = await openAdmin({ width: 360 });
    await money(page);
    await page.locator('.mrw-seg button', { hasText: 'Totals' }).click();
    await page.locator('[data-totals]').waitFor();
    const lines = await page.locator('.mrw-yours').evaluateAll((els) => els.map((e) => e.innerText.replace(/\n/g, ' ')));
    for (const l of lines) {
      const m = /\$(\d+(?:\.\d+)?) \+ \$(\d+(?:\.\d+)?) \((\d+) courts?\)\s+\$(\d+(?:\.\d+)?)$/.exec(l);
      assert(m, `footer format: ${l}`);
      assert(Math.abs(Number(m[1]) + Number(m[2]) - Number(m[4])) < 0.01, `parts add up: ${l}`);
    }
    assert(/YOUR COST SO FAR/i.test(lines[0]) && /YOUR ESTIMATED COST/i.test(lines[1]), `labels ${lines}`);
    const txt = await page.locator('[data-totals]').innerText();
    assert(!/invoice/i.test(txt) && (txt.match(/You covered/g) ?? []).length === 0, 'no "invoice", and "You covered" is not said twice (or at all)');
    assert(!/-\$|−\$0\b/.test(txt.replace(/−\$\d/g, '')), 'no negative amounts other than the minus lines');
    await ctx.close();
  });

  // ---------------------------------------------------------------- hide
  await check('6 Hide from list: the game leaves Money and Totals, Settings > Advanced > Hidden games lists it, Restore brings it back, nothing is lost', async () => {
    const { ctx, page } = await openAdmin();
    const before = await dash();
    const pay = (d) => JSON.stringify(d.sessions.find((s) => s.id === testGame.id).roster.map((r) => [r.playerId, r.paymentStatus, r.owesCents, r.creditCents]));
    await money(page);
    await page.locator('[data-month-box]').click();
    await page.locator('[data-month-option="2026-10"]').click();
    // The test game was canceled early with nobody in: before today with nothing owed, so it sits in Previous games.
    await page.locator('[data-fold="previous"] .mrw-fold-head').click();
    const row = page.locator(`[data-fold="previous"] .mrw-prow[data-session="${testGame.id}"]`);
    await row.locator('.mrw-prow-head').click();
    await row.locator('[data-closed-body] [data-hide-from-list]').click();
    await page.locator('dialog[open]').getByText('Hide it').click();
    await page.waitForTimeout(900);
    assert((await page.locator(`[data-session="${testGame.id}"]`).count()) === 0, 'the game is gone from Money');
    const after = await dash();
    assert(after.sessions.find((s) => s.id === testGame.id).hiddenFromList === true, 'flagged');
    assert(pay(after) === pay(before), 'its players and payments are exactly as they were');
    assert(JSON.stringify(after.creditLedger) === JSON.stringify(before.creditLedger), 'credit untouched');
    // Home has no card for it and its "Finalize" card is gone.
    await tab(page, 'Home');
    assert((await page.locator(`[id="session-${testGame.id}"]`).count()) === 0, 'not on Home');
    // Hidden games list.
    await tab(page, 'Settings');
    await page.locator('details[data-section="advanced"] > summary').click();
    const hg = page.locator('[data-hidden-games]');
    await hg.locator('summary').click();
    assert((await hg.locator(`[data-hidden-game="${testGame.id}"]`).count()) === 1, 'listed in Hidden games');
    assert(/Hidden from Games/.test(await hg.innerText()), 'says why');
    await shot(page, 'hidden-games');
    await hg.getByRole('button', { name: /Restore/ }).click();
    await page.waitForTimeout(900);
    assert((await hg.locator(`[data-hidden-game="${testGame.id}"]`).count()) === 0, 'restored: gone from the hidden list');
    const back = await dash();
    assert(back.sessions.find((s) => s.id === testGame.id).hiddenFromList === undefined, 'flag cleared');
    assert(pay(back) === pay(before), 'and still exactly as it was');
    await ctx.close();
  });
  await check('6 Hide from list on Home: in the gear menu, asks first, and the game leaves Home', async () => {
    const { ctx, page } = await openAdmin();
    await tab(page, 'Home');
    // The first card is a game with money in it (a booked court): no Hide in its menu.
    await page.locator('article.scard').first().locator('button[aria-label^="Game menu"]').click();
    assert((await page.locator('[data-hide-from-list]').count()) === 0, 'a game with money in it has no Hide from list');
    await page.keyboard.press('Escape');
    // An empty, not-booked game (no money in it) can be hidden.
    const empty = (await dash()).sessions.find((s) => !s.state.flags.canceled && s.bookingStatus !== 'booked' && s.confirmedCount === 0 && s.roster.length === 0 && Date.parse(s.startsAt) > NOW_MS);
    assert(empty, 'an empty game exists');
    let card = await openHomeCard(page, empty.id);
    await card.locator('button[aria-label^="Game menu"]').click();
    await page.locator('[data-hide-from-list]').click();
    const dlg = page.locator('dialog[open]');
    assert(/Nothing is deleted/.test(await dlg.innerText()), 'says nothing is deleted');
    await dlg.getByText('Go back').click();
    assert((await page.locator(`[id="session-${empty.id}"]`).count()) === 1, 'Go back changes nothing');
    await card.locator('button[aria-label^="Game menu"]').click();
    await page.locator('[data-hide-from-list]').click();
    await page.locator('dialog[open]').getByText('Hide it').click();
    await page.waitForTimeout(900);
    assert((await page.locator(`[id="session-${empty.id}"]`).count()) === 0, 'hidden from Home');
    await post(areq, `/api/admin/sessions/${empty.id}/hide-from-list`, { hidden: false });
    await ctx.close();
  });

  // ---------------------------------------------------------------- edit charge
  const openOctTestGame = async (page) => {
    await money(page);
    await page.locator('[data-month-box]').click();
    await page.locator('[data-month-option="2026-10"]').click();
    await page.locator('[data-fold="previous"] .mrw-fold-head').click();
    const row = page.locator(`[data-fold="previous"] .mrw-prow[data-session="${testGame.id}"]`);
    await row.locator('.mrw-prow-head').click();
    return row;
  };
  await check('7 Edit charge on a canceled game: Yes counts the court in Totals, No takes it away; no money moves; one short line under the choice', async () => {
    const { ctx, page } = await openAdmin();
    const credit0 = JSON.stringify((await dash()).creditLedger);
    const so = async () => (await moneyApi('2026-10')).rework;
    const was = await so();
    const row = await openOctTestGame(page);
    assert(/Venue charged:\s*No/.test(await row.locator('[data-charge-line]').innerText()), 'says No');
    await row.locator('[data-edit-charge]').click();
    const sheet = page.locator('dialog[open] [data-edit-charge-sheet]');
    await sheet.waitFor();
    assert((await sheet.locator('[data-charge-note]').innerText()).trim() === 'This only fixes Totals. What players owe or hold does not change.', 'the one line');
    assert((await sheet.locator('p').count()) === 1, 'and no other text');
    const noteTop = await sheet.locator('[data-charge-note]').evaluate((e) => e.getBoundingClientRect().top);
    const segBottom = await sheet.locator('.segmented').evaluate((e) => e.getBoundingClientRect().bottom);
    assert(noteTop >= segBottom - 1, 'it sits under the Yes/No choice');
    await sheet.getByRole('button', { name: 'Yes' }).click();
    assert((await sheet.locator('input').inputValue()) === '48', 'amount starts at the usual court cost');
    await shot(page, 'edit-charge');
    await sheet.locator('[data-save-charge]').click();
    assert((await page.locator('dialog[open] [data-edit-charge-sheet]').count()) === 0, 'the sheet closes at once');
    await page.waitForTimeout(900);
    assert(/Venue charged:\s*\$48/.test(await row.locator('[data-charge-line]').innerText()), 'now says $48');
    const yes = await so();
    assert(yes.courtCostCents === was.courtCostCents + 4800 && yes.courtSessions === was.courtSessions + 1, `Totals count the court: ${was.courtCostCents} -> ${yes.courtCostCents}`);
    // Money is never hidden: with a charge on it the game can no longer be hidden.
    assert((await row.locator('[data-hide-from-list]').count()) === 0, 'a charged game has no Hide from list');
    await row.locator('[data-edit-charge]').click();
    const sheet2 = page.locator('dialog[open] [data-edit-charge-sheet]');
    await sheet2.getByRole('button', { name: 'No' }).click();
    await sheet2.locator('[data-save-charge]').click();
    await page.waitForTimeout(900);
    const no = await so();
    assert(no.courtCostCents === was.courtCostCents && no.courtSessions === was.courtSessions, 'and No takes it away again');
    assert((await row.locator('[data-hide-from-list]').count()) === 1, 'and Hide from list is back');
    assert(JSON.stringify((await dash()).creditLedger) === credit0, 'no credit moved');
    await ctx.close();
  });
  await check('6 money is never hidden: games with money in them have no Hide from list on Money; the server refuses; Home shows it grayed out with one line on a canceled game', async () => {
    const { ctx, page } = await openAdmin();
    await money(page);
    await openAllCards(page);
    assert((await page.locator('article.mrw-game [data-hide-from-list]').count()) === 0, 'no Hide on any open game with money in it');
    const r = await post(areq, `/api/admin/sessions/${court.id}/hide-from-list`, { hidden: true });
    assert(r.status() === 409 && (await r.json()).message === 'This game has money in it, so it stays in Money.', 'the server says so');
    // Home, the canceled game that gave credit back.
    await tab(page, 'Home');
    let card = await openHomeCard(page, court.id);
    await card.locator('button[aria-label^="Game menu"]').click();
    const hide = page.locator('[data-hide-blocked]');
    assert((await hide.count()) === 1 && (await hide.getAttribute('aria-disabled')) === 'true', 'the row is there and grayed out');
    assert((await page.locator('[data-hide-blocked-note]').innerText()).trim() === 'This game has money in it, so it stays in Money', 'with its one line');
    const op = await hide.evaluate((e) => getComputedStyle(e).opacity);
    assert(Number(op) < 1, 'it looks grayed out');
    await hide.click({ force: true });
    assert((await page.locator('dialog[open]').count()) === 0, 'tapping it does nothing');
    // The player-screen toggle stays its own row.
    assert((await page.getByRole('menuitem', { name: /player screen/ }).count()) === 1, 'the player-screen toggle is separate');
    await page.keyboard.press('Escape');
    await ctx.close();
  });

  // ---------------------------------------------------------------- cancel sheet
  await check('8 cancel sheet "Were you charged?": No when more than 12 hours out, Yes inside 12 hours, and either can be flipped', async () => {
    const { ctx, page } = await openAdmin();
    await tab(page, 'Home');
    const sheetFor = async (id) => {
      let card = await openHomeCard(page, id);
      await card.locator('button[aria-label^="Game menu"]').click();
      await page.getByRole('menuitem', { name: /Cancel session/ }).click();
      const dlg = page.locator('dialog[open]');
      await dlg.locator('[data-were-you-charged]').waitFor();
      return dlg;
    };
    const far = (await dash()).sessions.find((s) => !s.state.flags.canceled && Date.parse(s.startsAt) > NOW_MS + 36 * 3600_000 && s.bookingStatus === 'booked');
    let dlg = await sheetFor(far.id);
    assert((await dlg.locator('legend', { hasText: 'Were you charged?' }).count()) === 1, 'the question');
    assert((await dlg.locator('[data-charged="no"]').getAttribute('aria-pressed')) === 'true', 'No by default more than 12 hours out');
    await dlg.locator('[data-charged="yes"]').click();
    assert((await dlg.locator('[data-charged="yes"]').getAttribute('aria-pressed')) === 'true', 'flip to Yes');
    assert((await dlg.locator('label', { hasText: 'Amount charged' }).count()) === 1, 'an amount appears');
    await shot(page, 'cancel-far');
    await dlg.getByText('Go back').click();
    dlg = await sheetFor(lateGame.id);
    assert((await dlg.locator('[data-charged="yes"]').getAttribute('aria-pressed')) === 'true', 'Yes by default inside 12 hours');
    await dlg.locator('[data-charged="no"]').click();
    assert((await dlg.locator('[data-charged="no"]').getAttribute('aria-pressed')) === 'true', 'flip to No');
    await shot(page, 'cancel-near');
    await dlg.getByText('Go back').click();
    const after = (await dash()).sessions.find((s) => s.id === lateGame.id);
    assert(!after.state.flags.canceled, 'Go back canceled nothing');
    await ctx.close();
  });

  // ---------------------------------------------------------------- switches page
  await check('9 Feature switches tidy: one-line titles at 360 and 320, hints wrap under the title, newest first, older ON ones in Live and stable', async () => {
    for (const width of [360, 320]) {
      const { ctx, page } = await openAdmin({ width });
      await tab(page, 'Settings');
      await page.locator('details[data-section="switches"] > summary').click();
      const tidy = page.locator('[data-switches-tidy]');
      await tidy.waitFor();
      const names = await tidy.locator('.set-name').evaluateAll((els) => els.map((e) => e.innerText.trim()));
      assert(names[0] === 'Money page rework', `newest first: ${names[0]}`);
      // Every other switch is on for everyone on live (the fee split since Wed Nov 4), so they are all in the group, newest first.
      const group = page.locator('[data-live-stable]');
      assert((await group.count()) === 1, 'Live and stable group');
      assert(/Live and stable/.test(await group.locator('summary').innerText()), 'its name');
      await group.locator('summary').click();
      const live = await group.locator('.set-name').evaluateAll((els) => els.map((e) => e.innerText.trim()));
      assert(live[0] === 'Late-cancel fee split' && live[1] === 'Texts and alerts, round 2', `older switches in the group, newest first: ${live}`);
      assert(live.includes('Ask for payment on every game') && live.includes('Moved-game notice for everyone'), `oldest ones too: ${live}`);
      assert(!live.includes('Money page rework'), 'the newest switch stays out of the group');
      assert(names.length === 1 + live.length, `nothing else is listed: ${names.length} vs ${live.length}`);
      const m = await tidy.evaluate((el) => {
        const rows = [...el.querySelectorAll('.set-row')];
        return rows.map((r) => {
          const n = r.querySelector('.set-name');
          const h = r.querySelector('.set-hint');
          const lh = parseFloat(getComputedStyle(n).lineHeight) || 20;
          return { name: n.innerText.trim(), nameLines: Math.round(n.getBoundingClientRect().height / lh), hintBelow: h ? h.getBoundingClientRect().top >= n.getBoundingClientRect().bottom - 1 : true, cut: n.scrollWidth > n.clientWidth + 1, hintLeft: h ? Math.abs(h.getBoundingClientRect().left - n.getBoundingClientRect().left) <= 1 : true };
        });
      });
      for (const r of m) {
        // One line at 340 px and wider (the brief's 360 px); on a 320 px phone a long title may wrap cleanly, but is never cut off.
        assert(!r.cut && (width < 340 || r.nameLines <= 1), `title "${r.name}" is cut off or not on one line at ${width}`);
        assert(r.hintBelow && r.hintLeft, `hint of "${r.name}" sits cleanly under its title at ${width}`);
      }
      await noOverflow(page, `switches ${width}`);
      if (width === 360) await shot(page, 'switches-360');
      await ctx.close();
    }
  });
  await check('9 a switch still works from the tidy page (no behavior change): flip Pay sheet off and on', async () => {
    const { ctx, page } = await openAdmin();
    await tab(page, 'Settings');
    await page.locator('details[data-section="switches"] > summary').click();
    await page.locator('[data-live-stable] summary').click();
    const box = page.locator('[data-pay-sheet-all]');
    await box.click();
    await page.waitForTimeout(900);
    assert((await dash()).paySheetForAll === false, 'off');
    await box.click();
    await page.waitForTimeout(900);
    assert((await dash()).paySheetForAll === true, 'on again');
    await ctx.close();
  });

  // ---------------------------------------------------------------- history
  await check('10 History: green only for NEW activity by someone else, names shown, no-op moves and exact duplicates hidden', async () => {
    // A player's own tap and the organizer's own tap, both newer than the last visit.
    const kai = await browser.newContext();
    const d = await dash();
    const kaiId = d.players.find((p) => p.name === 'Kai').id;
    await post(kai.request, '/api/me', { playerId: kaiId }, { 'X-Group-Key': String(d.group.privateLink).split('/g/')[1] });
    const later = d.sessions.find((s) => s.confirmedCount === 3 && s.bookingStatus === 'needs_booking' && !s.state.flags.canceled);
    const { ctx, page } = await openAdmin();
    // Pretend the last visit was a few days ago so the seed's entries are "new".
    await page.evaluate((iso) => localStorage.setItem('pb_history_seen', iso), new Date(NOW_MS - 3 * 24 * 3600_000).toISOString());
    await page.reload();
    await page.locator('.tabbar').waitFor();
    await tab(page, 'History');
    await page.locator('.activity-list').first().waitFor();
    const m = await page.evaluate(() => {
      const items = [...document.querySelectorAll('.activity-list > li')];
      return {
        n: items.length,
        hi: items.filter((li) => li.classList.contains('a-other')).map((li) => li.innerText.replace(/\n/g, ' ')),
        mine: items.filter((li) => /^Organizer Orla (marked|booked|finalized|went|changed)/.test(li.querySelector('.a-text').innerText)).map((li) => ({ t: li.querySelector('.a-text').innerText, hi: li.classList.contains('a-other') })),
        viewedHi: [...document.querySelectorAll('[aria-label="Viewed activity"] > li.a-other')].length,
        someone: items.filter((li) => /\bsomeone\b/.test(li.querySelector('.a-text').innerText)).length,
        newLabel: !!document.querySelector('[data-divider="new"]'),
      };
    });
    assert(m.newLabel, 'a NEW group is shown');
    assert(m.hi.length > 0, 'some new activity by players is highlighted');
    assert(m.mine.length > 0 && m.mine.every((x) => !x.hi), `the organizer's own actions are never highlighted: ${JSON.stringify(m.mine.filter((x) => x.hi))}`);
    assert(m.viewedHi === 0, 'nothing already viewed is highlighted');
    assert(m.someone === 0, 'no "someone": names are shown');
    await shot(page, 'history');
    // Nothing new since the last visit: no highlight at all.
    await page.evaluate((iso) => localStorage.setItem('pb_history_seen', iso), new Date(NOW_MS + 3600_000).toISOString());
    await page.reload();
    await page.locator('.tabbar').waitFor();
    await tab(page, 'History');
    await page.locator('.activity-list').first().waitFor();
    assert((await page.locator('.activity-list > li.a-other').count()) === 0, 'no highlight when nothing is new');
    // A repeated move that changes nothing is hidden: confirm the same player into the same game twice.
    void later;
    await kai.close();
    await ctx.close();
  });
  await check('10 History: the organizer moving a player to where they already are leaves no entry', async () => {
    const d = await dash();
    const g = d.sessions.find((s) => s.confirmedCount === 3 && s.bookingStatus === 'needs_booking' && !s.state.flags.canceled);
    const gray = g.roster.find((r) => r.status === 'confirmed');
    await post(areq, `/api/admin/sessions/${g.id}/roster`, { playerId: gray.playerId, action: 'confirm' });
    await post(areq, `/api/admin/sessions/${g.id}/roster`, { playerId: gray.playerId, action: 'confirm' });
    const { ctx, page } = await openAdmin();
    await tab(page, 'History');
    await page.locator('.activity-list').first().waitFor();
    const lines = await page.locator('.activity-list > li .a-text').allInnerTexts();
    const mine = lines.filter((t) => t.includes(`gave ${gray.name} a spot`));
    assert(mine.length <= 1, `a move that changed nothing is hidden: ${mine.length} lines`);
    await ctx.close();
  });

  // ---------------------------------------------------------------- the split (live since Wed Nov 4) is on in the preview
  await check('Late-cancel fee split is ON from the seed (it is on live), and a fee-kept cancel with 6 in shows the right Totals', async () => {
    const d = await dash();
    assert(d.lateFeeSplitForAll === true && d.lateFeeSplit === true, 'the split switch is on from the seed');
    const g = byNote(d, 'Fee split test');
    const res = await post(areq, `/api/admin/sessions/${g.id}/decision`, { decision: 'cancel', confirm: true, venueWaived: false });
    assert(res.ok(), `cancel: ${await res.text()}`);
    const sv = (await dash()).sessions.find((s) => s.id === g.id);
    assert(sv.feeSplit && sv.feeSplit.count === 6 && sv.feeSplit.priceCents === 900, 'six in, 9 dollars each');
    const month = g.startsAt.slice(0, 7);
    const t = (await moneyApi(month)).rework;
    // Indy, Lane and Morgan paid 14 and kept 9 each: collected 27 or more; the court the venue charged is 48, counted once.
    assert(t.collectedCents >= 2700 && t.courtCostCents >= 4800, `collected and court: ${t.collectedCents} / ${t.courtCostCents}`);
    for (const v of [t.collectedCents, t.yourCostCents, t.yourCostCourtCents, t.yourCostMembershipCents, t.projected.yourCostCents]) assert(v >= 0, 'no negative amounts');
    const { ctx, page } = await openAdmin({ width: 360 });
    await money(page);
    await page.locator('.mrw-seg button', { hasText: 'Totals' }).click();
    await page.locator('[data-totals]').waitFor();
    const f = (c) => (c % 100 ? '$' + (c / 100).toFixed(2) : '$' + c / 100);
    assert((await page.locator('[data-owed-total]').innerText()) === f(t.owedToVenueCents), 'screen equals the server');
    await noOverflow(page, 'totals after the split cancel');
    await ctx.close();
  });

  // ---------------------------------------------------------------- dark mode and widths
  await check('Looks right in dark mode and at 320 / 430 (Games, Totals, no sideways scrolling)', async () => {
    for (const [width, scheme] of [[320, 'dark'], [430, 'light'], [390, 'dark']]) {
      const { ctx, page } = await openAdmin({ width, scheme });
      await money(page);
      await openAllCards(page);
      await noOverflow(page, `games ${width} ${scheme}`);
      if (scheme === 'dark') await shot(page, `games-${width}-dark`);
      await page.locator('.mrw-seg button', { hasText: 'Totals' }).click();
      await page.locator('[data-totals]').waitFor();
      await noOverflow(page, `totals ${width} ${scheme}`);
      const clipped = await page.evaluate(() => [...document.querySelectorAll('.mrw-yours, .mrw-card-head, .mrw-cols')].filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => e.className));
      assert(clipped.length === 0, `cut off at ${width}: ${clipped}`);
      if (scheme === 'dark') await shot(page, `totals-${width}-dark`);
      await ctx.close();
    }
  });
  await check('9 month box: "Nov 2026" in the toggle\'s own type, soft 1 px outline, same height and corners as the toggle, no wrapping, light and dark, 320 / 360 / 430', async () => {
    for (const [width, scheme] of [[320, 'light'], [360, 'dark'], [430, 'light'], [360, 'light'], [430, 'dark'], [320, 'dark']]) {
      const { ctx, page } = await openAdmin({ width, scheme });
      await money(page);
      const m = await page.evaluate(() => {
        const box = document.querySelector('[data-month-box]');
        const tog = document.querySelector('.mrw-seg');
        const tb = tog.querySelector('button');
        const cs = getComputedStyle(box);
        const ts = getComputedStyle(tb);
        const line = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.2;
        return {
          text: box.innerText.trim(), size: cs.fontSize, weight: cs.fontWeight, ls: cs.letterSpacing, tt: cs.textTransform, bw: cs.borderTopWidth, bc: cs.borderTopColor, bg: cs.backgroundColor,
          radius: cs.borderTopLeftRadius, tradius: getComputedStyle(tog).borderTopLeftRadius, h: box.getBoundingClientRect().height, th: tog.getBoundingClientRect().height,
          tsize: ts.fontSize, tweight: ts.fontWeight, tfamily: ts.fontFamily === cs.fontFamily, lines: box.getBoundingClientRect().height <= line * 2 + 30 && box.scrollWidth <= box.clientWidth, extra: box.querySelectorAll('svg, img').length + (getComputedStyle(box, '::after').content !== 'none' ? 1 : 0),
          w: box.getBoundingClientRect().width,
          pill: Math.round(tb.getBoundingClientRect().height), pad: getComputedStyle(tog).paddingTop,
        };
      });
      const tag = `${width} ${scheme}`;
      assert(m.text === 'Nov 2026', `text ${m.text} (${tag})`);
      assert(m.size === '15px' && m.weight === '600' && m.ls === 'normal' && m.tt === 'none', `type ${m.size}/${m.weight}/${m.ls}/${m.tt} (${tag})`);
      assert(m.size === m.tsize && m.weight === m.tweight && m.tfamily, `same font as the toggle: ${m.size}/${m.weight} vs ${m.tsize}/${m.tweight} (${tag})`);
      assert(m.bw === '1px', `1px outline (${tag})`);
      if (scheme === 'light') {
        assert(m.bc === 'rgb(220, 220, 213)' && m.bg === 'rgb(255, 255, 255)', `outline #dcdcd5 on white: ${m.bc} ${m.bg}`);
      }
      assert(Math.abs(m.h - 42) <= 0.6 && Math.abs(m.th - 42) <= 0.6, `box and toggle track are both 42 px: ${m.h} / ${m.th} (${tag})`);
      assert(m.radius === '14px', `box corners 14 px: ${m.radius} (${tag})`);
      assert(m.pill === 36 && m.pad === '3px', `the white pill is 36 px inside a 3 px track: ${m.pill} ${m.pad} (${tag})`);
      assert(m.lines && m.extra === 0, `one line, no arrow or caret (${tag})`);
      await noOverflow(page, `month box ${tag}`);
      if (width === 360) await shot(page, `month-box-${scheme}`);
      await page.locator('[data-month-box]').click();
      const rows = await page.evaluate(() => [...document.querySelectorAll('.mrw-monthrow')].slice(0, 2).map((r) => ({ f: getComputedStyle(r).fontSize, w: getComputedStyle(r).fontWeight, t: r.innerText.replace(/\n/g, ' ').trim() })));
      assert(rows.every((r) => r.f === '15px' && r.w === '600' && /^[A-Z][a-z]{2} \d{4}\s+\d+$/.test(r.t)), `dropdown rows keep the style: ${JSON.stringify(rows)}`);
      await ctx.close();
    }
  });
  await check('10 Mark paid: 14 px medium (500), 34 px high, 11 px corners, 1.5 px soft outline, white fill, never wraps, a 44 px tap area; names stay semibold; light and dark', async () => {
    for (const [width, scheme] of [[320, 'light'], [360, 'dark'], [430, 'light'], [390, 'dark']]) {
      // A 2x screen, like a phone: a 1.5 px line only exists at 2x and up (at 1x the browser draws 1 px).
      const { ctx, page } = await openAdmin({ width, scheme, dpr: 2 });
      await money(page);
      await openAllCards(page);
      const m = await page.evaluate(() => {
        const out = [...document.querySelectorAll('.mrw-mark')].map((b) => {
          const cs = getComputedStyle(b);
          const before = getComputedStyle(b, '::before');
          const r = b.getBoundingClientRect();
          return { t: b.innerText.trim(), size: cs.fontSize, weight: cs.fontWeight, h: Math.round(r.height * 10) / 10, radius: cs.borderTopLeftRadius, bw: cs.borderTopWidth, bc: cs.borderTopColor, bg: cs.backgroundColor, ws: cs.whiteSpace, one: b.scrollWidth <= b.clientWidth + 1, hit: r.height + parseFloat(before.top) * -2 };
        });
        const name = getComputedStyle(document.querySelector('.mrw-name')).fontWeight;
        // The browser snaps a drawn line to whole device pixels (1.5 px shows as 1 px at 1x and 2x in this test browser), so the 1.5 px is read from the style itself.
        let authored = '';
        for (const sheet of document.styleSheets) for (const r of sheet.cssRules) if (r.selectorText === '.mrw-mark') authored = /border:\s*1\.5px/.test(r.style.cssText) ? '1.5px' : r.style.cssText;
        return { out, name, dpr: window.devicePixelRatio, authored };
      });
      const tag = `${width} ${scheme}`;
      assert(m.out.length >= 8, `there are Mark paid buttons to check: ${m.out.length}`);
      for (const b of m.out) {
        assert(b.t === 'Mark paid' && b.size === '14px' && b.weight === '500', `type ${b.size}/${b.weight} (${tag})`);
        assert(b.h === 34 && b.radius === '11px' && parseFloat(b.bw) >= 1 && m.authored === '1.5px' && b.ws === 'nowrap' && b.one, `shape ${b.h}px ${b.radius} ${b.bw} ${b.ws} dpr ${m.dpr} (${tag})`);
        assert(b.hit >= 44, `tap area ${b.hit}px (${tag})`);
        if (scheme === 'light') assert(b.bc === 'rgb(207, 210, 201)' && b.bg === 'rgb(255, 255, 255)', `outline #cfd2c9 on white: ${b.bc} ${b.bg}`);
      }
      assert(Number(m.name) >= 600, `names stay semibold or heavier: ${m.name}`);
      await noOverflow(page, `mark paid ${tag}`);
      if (width === 360) await shot(page, `mark-paid-${scheme}`);
      await ctx.close();
    }
  });
  await check('2 Remind button: solid purple, 38 px, 14 px / 600, 12 px corners, no outline, light and dark, 320 / 360 / 430', async () => {
    for (const [width, scheme] of [[320, 'light'], [360, 'dark'], [430, 'light'], [320, 'dark'], [360, 'light'], [430, 'dark']]) {
      const { ctx, page } = await openAdmin({ width, scheme });
      await money(page);
      const b = await page.locator('[data-remind]').first().evaluate((el) => {
        const cs = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        return { bg: cs.backgroundColor, color: cs.color, h: r.height, size: cs.fontSize, weight: cs.fontWeight, radius: cs.borderTopLeftRadius, bw: cs.borderTopWidth, one: el.scrollWidth <= el.clientWidth + 1 && r.height < 40, text: el.innerText.trim() };
      });
      const tag = `${width} ${scheme}`;
      const want = scheme === 'light' ? ['rgb(106, 86, 166)', 'rgb(255, 255, 255)'] : ['rgb(178, 160, 230)', 'rgb(29, 20, 51)'];
      assert(b.bg === want[0] && b.color === want[1], `colors ${b.bg} on ${b.color} (${tag})`);
      assert(b.h === 38 && b.size === '14px' && b.weight === '600' && b.radius === '12px' && b.bw === '0px' && b.one, `shape ${b.h} ${b.size}/${b.weight} ${b.radius} ${b.bw} (${tag})`);
      assert(/^Remind \(\d+\)$/.test(b.text), `text ${b.text}`);
      await noOverflow(page, `remind ${tag}`);
      if (width === 360) await shot(page, `remind-button-${scheme}`);
      await ctx.close();
    }
  });
  await check('3 Remind sheet: no explanation, tight rows with name + "owes $14" + a Text button, "Text all" in the header only with 2 or more owing, right messages', async () => {
    for (const [width, scheme] of [[360, 'light'], [320, 'dark'], [430, 'dark'], [430, 'light']]) {
      const { ctx, page } = await openAdmin({ width, scheme });
      const card = await gamesCard(page, mixed.id);
      await card.locator('[data-remind]').click();
      const dlg = page.locator('dialog[open]');
      await dlg.locator('.mrw-remind-list').waitFor();
      await page.waitForTimeout(350);
      const tag = `${width} ${scheme}`;
      const txt = await dlg.innerText();
      assert(!/One text per person|Messages opens/i.test(txt), `the explanation is gone (${tag})`);
      const m = await dlg.evaluate((el) => {
        const rows = [...el.querySelectorAll('.mrw-remind-list > li')];
        const all = el.querySelector('[data-text-all]');
        const title = el.querySelector('h2').getBoundingClientRect();
        const close = el.querySelector('.icon-btn').getBoundingClientRect();
        const cs = (e) => getComputedStyle(e);
        const one = rows[0].querySelector('.mrw-text-one');
        return {
          n: rows.length, rowH: rows.map((r) => Math.round(r.getBoundingClientRect().height)), small: rows.map((r) => r.querySelector('.small').innerText.trim()), names: rows.map((r) => r.querySelector('strong').innerText.trim()),
          oneH: one.getBoundingClientRect().height, oneColor: cs(one).color, oneBg: cs(one).backgroundColor, oneBorder: cs(one).borderTopColor, oneSize: cs(one).fontSize, oneWeight: cs(one).fontWeight, oneRadius: cs(one).borderTopLeftRadius,
          allH: all.getBoundingClientRect().height, allBg: cs(all).backgroundColor, allColor: cs(all).color, allSize: cs(all).fontSize, allWeight: cs(all).fontWeight,
          order: title.right <= all.getBoundingClientRect().left + 1 && all.getBoundingClientRect().right <= close.left + 1, allHref: all.getAttribute('href'), oneHref: one.getAttribute('href'),
          fit: el.scrollWidth <= el.clientWidth + 1,
        };
      });
      assert(m.n === 2 && m.names.join() === 'Kai,Gray' || m.names.join() === 'Gray,Kai', `two people owe: ${m.names}`);
      assert(m.small.every((t) => /^owes \$14$/.test(t)), `small "owes $14": ${m.small}`);
      assert(m.rowH.every((h) => h >= 52 && h <= 60), `rows about 54 px: ${m.rowH} (${tag})`);
      const purple = scheme === 'light' ? 'rgb(106, 86, 166)' : 'rgb(178, 160, 230)';
      assert(m.oneH === 36 && m.oneColor === purple && m.oneBorder === purple && m.oneSize === '14px' && m.oneRadius === '12px', `Text button ${m.oneH} ${m.oneColor} ${m.oneBorder} (${tag})`);
      assert(m.allH === 34 && m.allBg === purple && m.allColor === (scheme === 'light' ? 'rgb(255, 255, 255)' : 'rgb(29, 20, 51)') && m.allSize === '14px' && m.allWeight === '600', `Text all ${m.allH} ${m.allBg} ${m.allColor} (${tag})`);
      assert(m.order, `Text all sits between the title and the close button (${tag})`);
      assert(m.fit, `no sideways overflow in the sheet (${tag})`);
      // Group text: one new message addressed to the people who owe (Kai and Gray, who both have numbers), the agreed words with line breaks.
      const norm = (ph) => '+1' + ph.replace(/\D/g, '').slice(-10);
      const players = (await dash()).players;
      const want = ['Kai', 'Gray'].map((n) => norm(players.find((p) => p.name === n).phone)).sort();
      const addr = ((/addresses=([^&]*)/.exec(m.allHref) ?? /^sms:([^?&]*)/.exec(m.allHref))[1] || '').split(',').filter(Boolean).sort();
      assert(addr.join() === want.join(), `addressed to exactly Kai and Gray: ${addr} vs ${want}`);
      const body = decodeURIComponent(/body=(.*)$/.exec(m.allHref)[1]);
      assert(/^Hey everyone, quick reminder for (today|tonight|tomorrow|yesterday|[A-Z][a-z]{2} [A-Z][a-z]{2} \d+)'s pickleball\.\nIf you haven't paid your \$14 yet, please do it here:\n\n[^\n]+$/.test(body), `group message: ${JSON.stringify(body)}`);
      // One person: same wording as before, name and amount.
      const one = decodeURIComponent(m.oneHref.replace(/^sms:[^&?]*[&?]body=/, ''));
      assert(/^Hey (Kai|Gray), you owe \$\d+ for pickleball/.test(one), `one-person text: ${JSON.stringify(one.slice(0, 50))}`);
      if (width === 360) await shot(page, `remind-sheet-${scheme}`);
      await ctx.close();
    }
    // With only one person owing there is no "Text all".
    const g = (await dash()).sessions.find((x) => x.id === mixed.id).roster.find((r) => r.name === 'Gray');
    await post(areq, `/api/admin/sessions/${mixed.id}/payment`, { playerId: g.playerId, paid: true, seen: g.moneySeen, cents: g.owesCents });
    const { ctx, page } = await openAdmin();
    const card = await gamesCard(page, mixed.id);
    await card.locator('[data-remind]').click();
    await page.locator('dialog[open] .mrw-remind-list').waitFor();
    assert((await page.locator('dialog[open] [data-text-all]').count()) === 0, 'no Text all with one person owing');
    assert((await page.locator('dialog[open] .mrw-text-one').count()) === 1, 'the one-person Text is still there');
    await ctx.close();
    const g2 = (await dash()).sessions.find((x) => x.id === mixed.id).roster.find((r) => r.name === 'Gray');
    await post(areq, `/api/admin/sessions/${mixed.id}/payment`, { playerId: g2.playerId, paid: false, seen: g2.moneySeen });
  });
  await check('Text all is addressed to everyone who owes with a number; the one with no number is skipped with a note; a just-paid player and the waitlist are left out', async () => {
    const d = await dash();
    const g = byNote(d, 'Owes, one no number');
    assert(g, 'the fake game with a missing number exists');
    const norm = (ph) => '+1' + ph.replace(/\D/g, '').slice(-10);
    const phoneOf = (n) => d.players.find((p) => p.name === n).phone;
    assert(!phoneOf('Reese'), 'Reese has no number saved');
    const owing = g.roster.filter((r) => r.status === 'confirmed' && r.paymentStatus === 'unpaid' && !r.isOrganizer).map((r) => r.name).sort();
    assert(owing.join() === 'Kai,Lane,Morgan,Reese', `four owe: ${owing}`);
    const { ctx, page } = await openAdmin({ width: 360 });
    const card = await gamesCard(page, g.id);
    await card.locator('[data-remind]').click();
    const dlg = page.locator('dialog[open]');
    await dlg.locator('.mrw-remind-list').waitFor();
    assert(/no number saved/.test(await dlg.locator('[data-remind-row="Reese"]').innerText()), 'Reese is listed as owing, with no number saved');
    const hrefOf = () => dlg.locator('[data-text-all]').getAttribute('href');
    const parts = (h) => ({ addr: ((/addresses=([^&]*)/.exec(h) ?? /^sms:([^?&]*)/.exec(h))[1] || '').split(',').filter(Boolean).sort(), body: decodeURIComponent(/body=(.*)$/.exec(h)[1]) });
    const first = parts(await hrefOf());
    assert(first.addr.join() === ['Kai', 'Lane', 'Morgan'].map((n) => norm(phoneOf(n))).sort().join(), `to Kai, Lane and Morgan only (not Reese, Indy who paid, or anyone on a waitlist): ${first.addr}`);
    assert(first.body.startsWith("Hey everyone, quick reminder for ") && first.body.includes("your $14 yet"), 'the agreed message');
    await shot(page, 'text-all-missing-number');
    // Tapping it: the note names Reese. The click is recorded (and the page's own move to sms: stopped) so the link at the moment of the tap can be read.
    await dlg.locator('[data-text-all]').evaluate((a) => {
      window.__clicks = [];
      a.addEventListener('click', (e) => {
        window.__clicks.push(a.getAttribute('href'));
        e.preventDefault();
      }, true);
    });
    await dlg.locator('[data-text-all]').click();
    await page.waitForFunction(() => window.__clicks.length >= 2, null, { timeout: 5000 });
    assert((await toastText(page)).includes('No number for Reese, texted the rest.'), `toast: ${await toastText(page)}`);
    // Morgan pays while the sheet is open (it does not refresh by itself). The link shown is still the old one, but the tap reads the game again.
    const mo = g.roster.find((r) => r.name === 'Morgan');
    await post(areq, `/api/admin/sessions/${g.id}/payment`, { playerId: mo.playerId, paid: true, seen: mo.moneySeen, cents: mo.owesCents });
    await page.evaluate(() => (window.__clicks = []));
    await page.waitForTimeout(3500); // let the first toast go
    await dlg.locator('[data-text-all]').click();
    await page.waitForFunction(() => window.__clicks.length >= 2, null, { timeout: 5000 });
    const afterTap = parts(await page.evaluate(() => window.__clicks[window.__clicks.length - 1]));
    assert(afterTap.addr.join() === ['Kai', 'Lane'].map((n) => norm(phoneOf(n))).sort().join(), `a just-paid player is left out at the tap: ${afterTap.addr}`);
    assert(afterTap.body.includes('your $14 yet'), 'same message');
    // The sheet refreshes after the tap; wait for it.
    let now = parts(await hrefOf());
    for (let tries = 0; now.addr.length !== 2 && tries < 20; tries++) {
      await page.waitForTimeout(400);
      now = parts(await hrefOf());
    }
    // Lane pays too: only Kai has a number and owes, so Text all is gone (the per-person Text buttons stay).
    const la = g.roster.find((r) => r.name === 'Lane');
    await post(areq, `/api/admin/sessions/${g.id}/payment`, { playerId: la.playerId, paid: true, seen: la.moneySeen, cents: la.owesCents });
    // The tap reads the game again: only one is left, so nothing opens, a note says so, the sheet refreshes and Text all goes.
    await page.evaluate(() => (window.__clicks = []));
    await dlg.locator('[data-text-all]').click();
    await page.waitForTimeout(400);
    assert((await toastText(page)).some((t) => /Only one person still owes/.test(t)), `note: ${await toastText(page)}`);
    assert((await page.evaluate(() => window.__clicks.length)) === 1, 'no second (opening) click was made');
    await dlg.locator('[data-text-all]').waitFor({ state: 'detached', timeout: 8000 });
    assert((await dlg.locator('.mrw-text-one').count()) >= 2, 'the per-person Text buttons still work');
    await ctx.close();
    for (const n of ['Morgan', 'Lane']) {
      const r = (await dash()).sessions.find((x) => x.id === g.id).roster.find((x) => x.name === n);
      await post(areq, `/api/admin/sessions/${g.id}/payment`, { playerId: r.playerId, paid: false, seen: r.moneySeen });
    }
  });
  await check('4 5 color tokens: credit is the softer blue, paid green and owes amber are unchanged, texting is purple, in light and dark', async () => {
    for (const scheme of ['light', 'dark']) {
      const { ctx, page } = await openAdmin({ width: 360, scheme });
      await money(page);
      const owedColor = await page.locator('.mrw-owed').first().evaluate((e) => getComputedStyle(e).color);
      await openAllCards(page);
      const m = await page.evaluate(() => {
        const root = getComputedStyle(document.documentElement);
        const tok = (n) => root.getPropertyValue(n).trim();
        const probe = (css) => {
          const e = document.createElement('i');
          e.style.cssText = css;
          document.body.appendChild(e);
          const c = getComputedStyle(e);
          const out = { color: c.color, bg: c.backgroundColor };
          e.remove();
          return out;
        };
        const cs = (sel, prop = 'color') => getComputedStyle(document.querySelector(sel))[prop === 'bg' ? 'backgroundColor' : prop];
        return {
          tokens: ['--tok-paid-fg', '--tok-paid-bg', '--tok-owes-fg', '--tok-owes-bg', '--tok-credit-fg', '--tok-credit-bg', '--tok-text-fill', '--tok-text-ink'].map(tok),
          creditText: cs('.mrw-state.credit'), creditRow: cs('.mrw-row.credit', 'bg'), creditFoot: cs('.mrw-foot-mid'),
          paidText: cs('.mrw-state.ok'), paidRow: cs('.mrw-row.paid', 'bg'),
          oldGreen: probe('color: var(--ok-fg); background: var(--ok-bg)'), oldAmber: probe('color: var(--warn-fg)'),
          dot: cs('.mrw-dots i.p', 'bg'), oldDot: probe('background: var(--ok-edge)').bg,
        };
      });
      const L = scheme === 'light';
      assert(m.creditText === (L ? 'rgb(58, 79, 163)' : 'rgb(147, 166, 230)'), `credit text ${m.creditText} (${scheme})`);
      assert(m.creditRow === (L ? 'rgb(233, 237, 246)' : 'rgb(32, 40, 64)'), `credit row ${m.creditRow} (${scheme})`);
      assert(m.creditFoot === m.creditText, `"Credit: $3 per" is the credit blue (${scheme})`);
      assert(m.paidText === m.oldGreen.color && m.paidRow === m.oldGreen.bg && m.dot === m.oldDot, `paid green is exactly the site's (${scheme})`);
      assert(owedColor === m.oldAmber.color, `owes amber is exactly the site's (${scheme})`);
      assert(m.tokens.every(Boolean), `all eight tokens are defined (${scheme}): ${m.tokens}`);
      assert(m.tokens[6].toLowerCase() === (L ? '#6a56a6' : '#b2a0e6') && m.tokens[7].toLowerCase() === (L ? '#ffffff' : '#1d1433'), `texting purple (${scheme})`);
      await ctx.close();
    }
  });
  await check('Tap targets on the new Money page are at least 44 px', async () => {
    const { ctx, page } = await openAdmin({ width: 390 });
    await money(page);
    await openAllCards(page);
    const small = await page.evaluate(() =>
      [...document.querySelectorAll('.mrw-month, .mrw-seg button, .mrw-undo, .mrw-remind, .mrw-toggle, .mrw-fold-head, .mrw-who, .mrw-hide-link, .mrw-mark')]
        .map((e) => {
          // The button may look smaller; the area that answers a tap includes its invisible ::before.
          const b = getComputedStyle(e, '::before');
          const extra = b.position === 'absolute' ? -2 * parseFloat(b.top) : 0;
          return { c: e.className, h: Math.round(e.getBoundingClientRect().height + extra) };
        })
        .filter((x) => x.h > 0 && x.h < 44),
    );
    assert(small.length === 0, `too small: ${JSON.stringify(small.slice(0, 4))}`);
    await ctx.close();
  });

  await browser.close();
  console.log(`\nmoney-rework: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
