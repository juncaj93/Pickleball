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
  const phone = (width, scheme = 'light', height = 800) => ({ viewport: { width, height }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, colorScheme: scheme, userAgent: UA });
  async function openAdmin({ width = 390, scheme = 'light', url = '/admin', height = 800 } = {}) {
    const ctx = await browser.newContext(phone(width, scheme, height));
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
  await check('1 top row: month box (NOV 26) then Games | Totals, equal widths, no arrows or carets', async () => {
    const { ctx, page } = await openAdmin({ width: 390 });
    await money(page);
    assert((await page.locator('[data-month-box]').innerText()).trim() === 'NOV 26', 'month box text');
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
    assert((await page.locator('[data-month-box]').innerText()).trim() === 'OCT 26', 'picking a month changes the box');
    assert((await page.locator('[data-month-pop]').count()) === 0, 'and closes the list');
    await page.locator('[data-month-box]').click();
    await page.keyboard.press('Escape');
    assert((await page.locator('[data-month-pop]').count()) === 0, 'Escape closes it');
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
      assert(/^COURT COSTS|Court costs/i.test(dom.cols[0]) && /session/.test(dom.cols[0]) && /monthly/.test(dom.cols[1]) && /from players/.test(dom.cols[2]), `columns ${dom.cols}`);
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
    const card = page.locator(`article.mrw-game[data-session="${testGame.id}"]`);
    await card.waitFor();
    if ((await card.getAttribute('data-open')) === 'no') await card.locator('.mrw-toggle').click();
    await card.locator('[data-hide-from-list]').click();
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
    const firstId = await page.locator('article.scard').first().getAttribute('id');
    await page.locator('article.scard').first().locator('button[aria-label^="Game menu"]').click();
    await page.locator('[data-hide-from-list]').click();
    const dlg = page.locator('dialog[open]');
    assert(/Nothing is deleted/.test(await dlg.innerText()), 'says nothing is deleted');
    await dlg.getByText('Go back').click();
    assert((await page.locator(`[id="${firstId}"]`).count()) === 1, 'Go back changes nothing');
    await page.locator('article.scard').first().locator('button[aria-label^="Game menu"]').click();
    await page.locator('[data-hide-from-list]').click();
    await page.locator('dialog[open]').getByText('Hide it').click();
    await page.waitForTimeout(900);
    assert((await page.locator(`[id="${firstId}"]`).count()) === 0, 'hidden from Home');
    const id = firstId.replace('session-', '');
    await post(areq, `/api/admin/sessions/${id}/hide-from-list`, { hidden: false });
    await ctx.close();
  });

  // ---------------------------------------------------------------- edit charge
  await check('7 Edit charge on a canceled game: Yes counts the court in Totals, No takes it away; no money moves', async () => {
    const { ctx, page } = await openAdmin();
    const credit0 = JSON.stringify((await dash()).creditLedger);
    const so = async () => (await moneyApi('2026-11')).rework;
    const was = await so();
    await money(page);
    await page.locator('[data-fold="later"] .mrw-fold-head').click();
    const row = page.locator(`[data-fold="later"] .mrw-prow[data-session="${court.id}"]`);
    await row.locator('.mrw-prow-head').click();
    assert(/Venue charged:\s*No/.test(await row.locator('[data-charge-line]').innerText()), 'says No');
    await row.locator('[data-edit-charge]').click();
    const sheet = page.locator('dialog[open] [data-edit-charge-sheet]');
    await sheet.waitFor();
    await sheet.getByRole('button', { name: 'Yes' }).click();
    assert((await sheet.locator('input').inputValue()) === '48', 'amount starts at the usual court cost');
    await shot(page, 'edit-charge');
    await sheet.locator('[data-save-charge]').click();
    await page.waitForTimeout(900);
    assert(/Venue charged:\s*\$48/.test(await row.locator('[data-charge-line]').innerText()), 'now says $48');
    const yes = await so();
    assert(yes.courtCostCents === was.courtCostCents + 4800 && yes.courtSessions === was.courtSessions + 1, `Totals count the court: ${was.courtCostCents} -> ${yes.courtCostCents}`);
    await row.locator('[data-edit-charge]').click();
    const sheet2 = page.locator('dialog[open] [data-edit-charge-sheet]');
    await sheet2.getByRole('button', { name: 'No' }).click();
    await sheet2.locator('[data-save-charge]').click();
    await page.waitForTimeout(900);
    const no = await so();
    assert(no.courtCostCents === was.courtCostCents && no.courtSessions === was.courtSessions, 'and No takes it away again');
    assert(JSON.stringify((await dash()).creditLedger) === credit0, 'no credit moved');
    // The Totals tab on the page follows.
    await page.locator('.mrw-seg button', { hasText: 'Totals' }).click();
    await page.locator('[data-totals]').waitFor();
    await ctx.close();
  });
  await check('7 a canceled game with nobody owing has Hide from list; a fee-kept one does not', async () => {
    const { ctx, page } = await openAdmin();
    await money(page);
    await page.locator('[data-fold="later"] .mrw-fold-head').click();
    const row = page.locator(`[data-fold="later"] .mrw-prow[data-session="${court.id}"]`);
    await row.locator('.mrw-prow-head').click();
    assert((await row.locator('[data-closed-body] [data-hide-from-list]').count()) === 1, 'Hide from list on the closed game');
    await ctx.close();
  });

  // ---------------------------------------------------------------- cancel sheet
  await check('8 cancel sheet "Were you charged?": No when more than 12 hours out, Yes inside 12 hours, and either can be flipped', async () => {
    const { ctx, page } = await openAdmin();
    await tab(page, 'Home');
    const sheetFor = async (id) => {
      let card = page.locator(`article#session-${id}`);
      if (!(await card.count())) {
        const all = page.locator('button', { hasText: /^Show all/ });
        if (await all.count()) await all.click();
        await page.locator(`div#session-${id}`).click();
        card = page.locator(`article#session-${id}`);
        await card.waitFor();
      }
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
      assert(names[1] === 'Late-cancel fee split', `then the next newest (off): ${names[1]}`);
      const group = page.locator('[data-live-stable]');
      assert((await group.count()) === 1, 'Live and stable group');
      assert(/Live and stable/.test(await group.locator('summary').innerText()), 'its name');
      await group.locator('summary').click();
      const live = await group.locator('.set-name').evaluateAll((els) => els.map((e) => e.innerText.trim()));
      assert(live[0] === 'Texts and alerts, round 2' && live.at(-1) === 'Ask for payment on every game' || live.includes('Moved-game notice for everyone'), `older switches in the group: ${live}`);
      assert(!live.includes('Money page rework') && !live.includes('Late-cancel fee split'), 'the newest and any switch that is off stay out of the group');
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
  await check('Tap targets on the new Money page are at least 44 px', async () => {
    const { ctx, page } = await openAdmin({ width: 390 });
    await money(page);
    await openAllCards(page);
    const small = await page.evaluate(() =>
      [...document.querySelectorAll('.mrw-month, .mrw-seg button, .mrw-mark, .mrw-undo, .mrw-remind, .mrw-toggle, .mrw-fold-head, .mrw-who, .mrw-hide-link')]
        .map((e) => ({ c: e.className, h: Math.round(e.getBoundingClientRect().height) }))
        .filter((x) => x.h > 0 && x.h < 40),
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
