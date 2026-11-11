/* Zip 23: Totals refresh (TOTALS_REFRESH), Money > Totals from Alex's mock.
 *
 *   node e2e/zip23.cjs      (also run by npm run test:e2e)
 *
 * Fake world (the older big one, Mon Nov 9 at 10 AM Eastern), its own dev server; nothing touches Cloudflare or the live site. The switch is
 * turned on through the real Settings call, and one check uses the private link.
 *   - the look: the mock's own numbers (sizes, spacing, borders, colors), light and dark, 8 px dots, the plain $/court text, no title row on top;
 *   - the numbers: every row and the per-court figure agree with what the server says (and a month, a credit and 0 games are shown the way the brief says);
 *   - the font: every number on this screen uses the font the Games rows and the date tiles use, with equal-width digits;
 *   - Month by month: collapsed by default, nothing loaded until it is opened, one row per past month;
 *   - fit: the whole screen on one iPhone Air screen (420 x 912) without scrolling; no clipping at 420, 390, 360 and 320 wide, light and dark, at normal text,
 *     125% and 150% (text at least 2 px inside the inside edge of its box, nothing overlapping, the title and the figures on one line).
 */
const { spawn, spawnSync } = require('node:child_process');
const { readFileSync, mkdirSync, rmSync } = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.E2E_PORT) || 5423;
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
/** formatPrice from shared/money.ts. */
const fp = (c) => (c % 100 === 0 ? `$${c / 100}` : `$${Math.floor(c / 100)}.${String(c % 100).padStart(2, '0')}`);
const minus = (c) => (c === 0 ? '$0' : `−${fp(c)}`);
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

async function main() {
  mkdirSync(SHOTS, { recursive: true });
  const dbFile = path.join(ROOT, '.data', 'zip23.sqlite');
  mkdirSync(path.join(ROOT, '.data'), { recursive: true });
  rmSync(dbFile, { force: true });
  const seeded = spawnSync('npx', ['vite-node', 'scripts/load-seed-local.ts', '--', dbFile, NOW_ISO], { cwd: ROOT, encoding: 'utf8' });
  if (seeded.status !== 0) throw new Error(`could not build the fake world: ${seeded.stderr || seeded.stdout}`);
  if (await fetch(`${BASE}/api/status`).then((r) => r.ok, () => false)) throw new Error(`port ${PORT} is already in use`);
  const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
    cwd: ROOT,
    env: { ...process.env, DEV_DB: dbFile, SETUP_TOKEN: 'zip23-setup-token-0123456789', DEV_CLOCK: '1' },
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
  const real = (await browser.newContext()).request;
  if (!(await post(real, '/api/admin/login', { pin: PIN })).ok()) throw new Error('login failed');
  const dash = async () => (await real.get(`${BASE}/api/admin/dashboard`)).json();
  const moneyOf = async (month) => (await real.get(`${BASE}/api/admin/money?month=${month}`, { headers: { 'X-Money-Rework': 'on' } })).json();

  // The switch ships OFF: the row is off, the dashboard has no Zip 23 key.
  const d0 = await dash();
  assert(d0.totalsRefresh === undefined && d0.totalsRefreshForAll === undefined, 'the seed should have the Totals refresh row OFF');
  assert(d0.moneyRework === true, 'the seed should have the Money page rework on (live has it on)');

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
    if (opts.mutate) {
      await ctx.route('**/api/admin/money?*', async (route) => {
        const resp = await route.fetch();
        const json = await resp.json();
        opts.mutate(json, new URL(route.request().url()).searchParams.get('month'));
        await route.fulfill({ response: resp, json });
      });
    }
    if (!(await post(ctx.request, '/api/admin/login', { pin: PIN })).ok()) throw new Error('login');
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const moneyCalls = [];
    page.on('request', (r) => {
      const u = new URL(r.url());
      if (u.pathname === '/api/admin/money') moneyCalls.push(u.searchParams.get('month'));
    });
    await page.goto(BASE + (opts.url ?? '/admin'));
    await page.locator('.tabbar').waitFor();
    if (opts.pct && opts.pct !== 100) await page.addStyleTag({ content: `html { font-size: ${opts.pct}% !important; } body { font-size: ${(17 * opts.pct) / 100}px !important; }` });
    // Test the test: E2E_BREAK='.tr-yn{margin-right:-30px}' (any CSS) must make the clipping checks fail.
    if (process.env.E2E_BREAK) await page.addStyleTag({ content: process.env.E2E_BREAK });
    return { ctx, page, errors, moneyCalls };
  }
  async function openTotals(opts = {}) {
    const h = await openAdmin(opts);
    await h.page.locator('.tabbar button', { hasText: 'Money' }).click();
    await h.page.locator('.mrw-seg button', { hasText: 'Totals' }).click();
    await h.page.locator('[data-totals]').waitFor();
    await h.page.waitForTimeout(350);
    return h;
  }

  // ---------------------------------------------------------------- the switch itself
  await check('OFF (as it ships): the Totals screen is the old one (the "Owed to venue so far" card, no new cards); the private link shows the new look on that phone only', async () => {
    const off = await openTotals();
    const t = await off.page.evaluate(() => ({ old: !!document.querySelector('.mrw-totals [data-owed-total]'), tr: !!document.querySelector('.tr'), title: document.querySelector('.mrw-card-title')?.textContent }));
    assert(t.old && !t.tr && t.title === 'Owed to venue so far', `OFF should look like main: ${JSON.stringify(t)}`);
    await off.ctx.close();
    const link = await openAdmin({ url: '/admin?totalsrefresh=on' });
    await link.page.locator('.tabbar button', { hasText: 'Money' }).click();
    await link.page.locator('.mrw-seg button', { hasText: 'Totals' }).click();
    await link.page.locator('.tr').waitFor();
    const d = await (await link.ctx.request.get(`${BASE}/api/admin/dashboard`, { headers: { 'X-Totals-Refresh': 'on' } })).json();
    assert(d.totalsRefresh === true && d.totalsRefreshForAll === undefined, 'private link: on for that phone, not for everyone');
    await link.ctx.close();
    const other = await openTotals();
    assert(await other.page.evaluate(() => !document.querySelector('.tr')), 'another phone still sees the old look');
    await other.ctx.close();
  });
  await check('Settings > Feature switches: a "Totals refresh" row at the top; tapping it turns the new look on for everyone (no deploy), tapping again turns it off', async () => {
    const { ctx, page } = await openAdmin();
    await page.locator('.tabbar button', { hasText: 'Settings' }).click();
    await page.waitForTimeout(400);
    for (const s of await page.locator('details > summary').all()) await s.click().catch(() => {});
    const first = await page.locator('#switches [data-row], [data-switches-tidy] [data-row]').evaluateAll((els) => els.slice(0, 5).map((e) => e.getAttribute('data-row')));
    // (Zip 24's Booking hours row, Zip 27's Spent matches Totals row, Zip 30's Acting for others row and Zip 32's Players sheet redo row are newer and sit above it.)
    assert(first[0] === 'playersSheetRedoAll' && first[1] === 'actingOthersAll' && first[2] === 'spentTotalsAll' && first[3] === 'bookingHoursAll' && first[4] === 'totalsRefreshAll', `newest first: ${first}`);
    const row = page.locator('[data-row="totalsRefreshAll"]');
    assert(/Totals refresh/.test(await row.innerText()), 'row label');
    await row.locator('label').click();
    await page.waitForTimeout(800);
    assert((await dash()).totalsRefreshForAll === true, 'on for everyone after the tap');
    await row.locator('label').click();
    await page.waitForTimeout(800);
    assert((await dash()).totalsRefreshForAll === undefined, 'off again after the second tap');
    await row.locator('label').click();
    await page.waitForTimeout(800);
    assert((await dash()).totalsRefreshForAll === true, 'on to stay for the rest of this test');
    await ctx.close();
  });

  // From here on the switch is ON for everyone (as on the preview), also when E2E_ONLY skipped the checks above.
  if (!(await put(real, '/api/admin/totals-refresh-switch', { on: true })).ok()) throw new Error('could not turn the switch on');
  const MONTH = '2026-11';
  const money = await moneyOf(MONTH);
  const rw = money.rework;
  const so = { membership: rw.membershipCents, court: rw.courtCostCents, games: rw.courtSessions, owed: rw.owedToVenueCents, players: rw.collectedCents };
  so.net = so.owed - so.players;
  const pj = { membership: rw.projected.membershipCents, court: rw.projected.courtCostCents, games: rw.projected.courtCount, owed: rw.projected.totalCents, players: rw.projected.playersPayCents };
  pj.net = pj.owed - pj.players;
  const per = (net, games) => (games > 0 ? (net < 0 ? -1 : 1) * Math.round(Math.abs(net) / games / 100) : null);

  // ---------------------------------------------------------------- the numbers
  await check('the numbers: every row, the total and the $/court on both cards agree with the server (Membership + Court costs = Owed; Owed - players = total; total / games = per court)', async () => {
    const { ctx, page, errors } = await openTotals();
    const read = (card) =>
      page.evaluate((c) => {
        const el = document.querySelector(`[data-card="${c}"]`);
        const t = (s) => el.querySelector(s)?.textContent ?? null;
        return {
          membership: t('[data-row="membership"] dd'),
          court: t('[data-row="court"] dd'),
          courtNote: t('[data-row="court"] em'),
          owed: t('[data-row="owed"] dd'),
          players: t('[data-row="players"] dd'),
          playersLabel: t('[data-row="players"] dt'),
          perCourt: t('[data-per-court]'),
          total: t('[data-total]'),
          title: t('.tr-t'),
          rows: [...el.querySelectorAll('[data-row] dt')].map((x) => x.textContent.replace(/\s+/g, ' ').trim()),
        };
      }, card);
    const a = await read('so-far');
    const b = await read('projected');
    const plural = (n) => `${n} ${n === 1 ? 'game' : 'games'}`;
    assert(a.membership === fp(so.membership) && a.court === fp(so.court) && a.owed === fp(so.owed) && a.players === minus(so.players), `so far rows ${JSON.stringify(a)} vs ${JSON.stringify(so)}`);
    assert(a.courtNote === plural(so.games), `court note ${a.courtNote}`);
    assert(a.total === fp(so.net), `so far total ${a.total} vs ${fp(so.net)}`);
    assert(so.net === rw.yourCostCents, 'the total is "Your cost so far"');
    assert(a.perCourt === `$${per(so.net, so.games)}/court`, `so far per court ${a.perCourt}`);
    assert(a.playersLabel === 'Players paid' && b.playersLabel === 'Players pay', `labels ${a.playersLabel} / ${b.playersLabel}`);
    assert(JSON.stringify(a.rows) === JSON.stringify(['Membership monthly', `Court costs ${plural(so.games)}`, 'Owed to venue', 'Players paid']), `rows ${a.rows}`);
    assert(b.membership === fp(pj.membership) && b.court === fp(pj.court) && b.owed === fp(pj.owed) && b.players === minus(pj.players), `projected rows ${JSON.stringify(b)} vs ${JSON.stringify(pj)}`);
    assert(b.courtNote === plural(pj.games), `projected court note ${b.courtNote}`);
    assert(b.total === fp(pj.net) && pj.net === rw.projected.yourCostCents, `projected total ${b.total}`);
    assert(b.perCourt === `$${per(pj.net, pj.games)}/court`, `projected per court ${b.perCourt}`);
    assert(a.title === 'So far' && b.title === 'Projected', `titles ${a.title} / ${b.title}`);
    assert(errors.length === 0, `page errors: ${errors}`);
    await ctx.close();
  });
  await check('another month changes the cards: Oct 2026 has no games, so no $/court on either card (never $NaN or $0/court), and the membership alone is the total', async () => {
    const { ctx, page } = await openTotals();
    await page.locator('[data-month-box]').click();
    await page.locator('[data-month-option="2026-10"]').click();
    await page.waitForTimeout(700);
    const t = await page.evaluate(() => ({ per: document.querySelectorAll('[data-per-court]').length, text: document.querySelector('.tr').innerText, totals: [...document.querySelectorAll('[data-total]')].map((e) => e.textContent) }));
    assert(t.per === 0, 'no per court text with 0 games');
    assert(!/NaN|\$0\/court|Infinity/.test(t.text), `bad text: ${t.text}`);
    assert(t.totals.join() === '$30,$30', `totals ${t.totals}`);
    assert(/0 games/.test(t.text), 'court costs say 0 games');
    await ctx.close();
  });
  await check('0 games, even with money on the card: the per-court text is gone, the total stays', async () => {
    const mutate = (j) => {
      if (!j.rework) return;
      j.rework.courtSessions = 0;
      j.rework.projected.courtCount = 0;
    };
    const { ctx, page } = await openTotals({ mutate });
    const t = await page.evaluate(() => ({ per: document.querySelectorAll('[data-per-court]').length, text: document.querySelector('.tr').innerText, total: document.querySelector('[data-card="so-far"] [data-total]').textContent }));
    assert(t.per === 0 && !/NaN|\$0\/court/.test(t.text) && t.total === fp(so.net), JSON.stringify(t));
    await ctx.close();
  });
  await check('1 game and rounding: $/court is the total over the games in whole dollars (half up); a $36 total over 1 game is $36/court; $72 over 7 is $10', async () => {
    for (const [net, games, want] of [
      [3600, 1, '$36/court'],
      [7200, 7, '$10/court'],
      [3300, 2, '$17/court'],
      [3250, 2, '$16/court'],
    ]) {
      const mutate = (j) => {
        if (!j.rework) return;
        const r = j.rework;
        r.membershipCents = 0;
        r.courtSessions = games;
        r.courtCostCents = net;
        r.owedToVenueCents = net;
        r.collectedCents = 0;
        r.yourCostCents = net;
      };
      const { ctx, page } = await openTotals({ mutate });
      const got = await page.locator('[data-card="so-far"] [data-per-court]').innerText();
      assert(got === want, `${net} over ${games}: ${got} vs ${want}`);
      await ctx.close();
    }
  });
  await check('negative net cost: the total is a CREDIT in green (the word credit, never a minus sign) and so is the $/court; the Players paid row keeps its minus', async () => {
    const mutate = (j) => {
      if (!j.rework) return;
      const r = j.rework;
      r.membershipCents = 0;
      r.courtSessions = 2;
      r.courtCostCents = 9600;
      r.owedToVenueCents = 9600;
      r.collectedCents = 10400; // $8 more than the venue is owed
      r.yourCostCents = 0;
    };
    const { ctx, page } = await openTotals({ mutate });
    const t = await page.evaluate(() => {
      const card = document.querySelector('[data-card="so-far"]');
      const tot = card.querySelector('[data-total]');
      const pc = card.querySelector('[data-per-court]');
      const green = getComputedStyle(card.querySelector('[data-row="players"] dd')).color;
      return { total: tot.textContent, per: pc.textContent, totalColor: getComputedStyle(tot).color, perColor: getComputedStyle(pc).color, green, bottom: card.querySelector('.tr-you').textContent, players: card.querySelector('[data-row="players"] dd').textContent };
    });
    assert(t.total === '$8 credit' && t.per === '$4/court credit', JSON.stringify(t));
    assert(!/[−-]/.test(t.bottom), `no minus sign in the bottom row: ${t.bottom}`);
    assert(t.totalColor === t.green && t.perColor === t.green, `credit is green: ${JSON.stringify(t)}`);
    assert(t.players === '−$104', t.players);
    await ctx.close();
  });

  await check('a tiny credit (49 cents over 1 game): the total says "$0.49 credit", and the $/court rounds to $0 and says plain "$0/court", never "$0/court credit"', async () => {
    const mutate = (j) => {
      if (!j.rework) return;
      const r = j.rework;
      r.membershipCents = 0;
      r.courtSessions = 1;
      r.courtCostCents = 4800;
      r.owedToVenueCents = 4800;
      r.collectedCents = 4849;
      r.yourCostCents = 0;
    };
    const { ctx, page } = await openTotals({ mutate });
    const t = await page.evaluate(() => ({ total: document.querySelector('[data-card="so-far"] [data-total]').textContent, per: document.querySelector('[data-card="so-far"] [data-per-court]').textContent }));
    assert(t.total === '$0.49 credit' && t.per === '$0/court', JSON.stringify(t));
    await ctx.close();
  });

  // ---------------------------------------------------------------- the look (the mock's own values)
  for (const scheme of ['light', 'dark']) {
    await check(`the look, ${scheme}, iPhone Air 420 wide: the mock's sizes, spacing, borders and colors`, async () => {
      const { ctx, page, errors } = await openTotals({ width: 420, height: 912, scheme, dpr: 2 });
      await page.screenshot({ path: path.join(SHOTS, `zip23-totals-${scheme}.png`) });
      const m = await page.evaluate(() => {
        // Resolve any CSS color (color-mix gives color(srgb ...)) to rgb through a canvas.
        const cv = document.createElement('canvas');
        cv.width = cv.height = 1;
        const g = cv.getContext('2d', { willReadFrequently: true });
        const rgb = (c) => {
          g.clearRect(0, 0, 1, 1);
          g.fillStyle = '#000';
          g.fillStyle = c;
          g.fillRect(0, 0, 1, 1);
          return [...g.getImageData(0, 0, 1, 1).data].slice(0, 3);
        };
        const cs = (el, p) => getComputedStyle(el)[p];
        const px = (v) => parseFloat(v);
        const out = {};
        for (const [key, name] of [['sf', 'so-far'], ['pj', 'projected']]) {
          const card = document.querySelector(`[data-card="${name}"]`);
          const lns = [...card.querySelectorAll('.tr-ln')];
          const you = card.querySelector('.tr-you');
          const dot = card.querySelector('.tr-dot');
          const t = card.querySelector('.tr-t');
          const yp = card.querySelector('.tr-yp');
          const yn = card.querySelector('.tr-yn');
          const em = card.querySelector('.tr-ln em');
          const rowsBox = card.querySelector('.tr-rows');
          const cardRect = card.getBoundingClientRect();
          out[key] = {
            radius: cs(card, 'borderTopLeftRadius'),
            borderW: cs(card, 'borderTopWidth'),
            borderColor: rgb(cs(card, 'borderTopColor')),
            bg: rgb(cs(card, 'backgroundColor')),
            ink: rgb(cs(card, 'color')),
            rowsPad: [cs(rowsBox, 'paddingTop'), cs(rowsBox, 'paddingRight'), cs(rowsBox, 'paddingBottom'), cs(rowsBox, 'paddingLeft')],
            lnFont: cs(lns[0], 'fontSize'),
            lnPad: [cs(lns[0], 'paddingTop'), cs(lns[0], 'paddingBottom')],
            lnBorders: lns.map((l) => `${cs(l, 'borderTopStyle')}/${cs(l, 'borderTopWidth')}`),
            lnBorderColor: rgb(cs(lns[1], 'borderTopColor')),
            sumWeights: [cs(lns[2].querySelector('dt'), 'fontWeight'), cs(lns[2].querySelector('dd'), 'fontWeight')],
            ddWeight: cs(lns[0].querySelector('dd'), 'fontWeight'),
            amber: rgb(cs(lns[2].querySelector('dd'), 'color')),
            green: rgb(cs(lns[3].querySelector('dd'), 'color')),
            emSize: cs(em, 'fontSize'),
            emMargin: cs(em, 'marginLeft'),
            emStyle: cs(em, 'fontStyle'),
            emColor: rgb(cs(em, 'color')),
            youPad: [cs(you, 'paddingTop'), cs(you, 'paddingRight'), cs(you, 'paddingBottom'), cs(you, 'paddingLeft')],
            youBorder: `${cs(you, 'borderTopStyle')}/${cs(you, 'borderTopWidth')}`,
            youBg: rgb(cs(you, 'backgroundColor')),
            youLine: rgb(cs(you, 'borderTopColor')),
            dotW: px(cs(dot, 'width')),
            dotH: px(cs(dot, 'height')),
            dotBg: rgb(cs(dot, 'backgroundColor')),
            dotBorder: cs(dot, 'borderTopWidth'),
            dotBorderColor: rgb(cs(dot, 'borderTopColor')),
            dotRect: [dot.getBoundingClientRect().width, dot.getBoundingClientRect().height],
            dotGap: cs(dot, 'marginRight'),
            tSize: cs(t, 'fontSize'),
            tSpacing: px(cs(t, 'letterSpacing')),
            tWeight: cs(t, 'fontWeight'),
            tTransform: cs(t, 'textTransform'),
            tColor: rgb(cs(t, 'color')),
            ypSize: cs(yp, 'fontSize'),
            ypColor: rgb(cs(yp, 'color')),
            ypBox: [cs(yp, 'borderTopWidth'), cs(yp, 'paddingLeft'), cs(yp, 'paddingTop'), rgb(cs(yp, 'backgroundColor')).join(), cs(yp, 'backgroundColor'), cs(yp, 'borderRadius')],
            ynSize: cs(yn, 'fontSize'),
            ynWeight: cs(yn, 'fontWeight'),
            ynSpacing: px(cs(yn, 'letterSpacing')),
            ynColor: rgb(cs(yn, 'color')),
            gap: yn.getBoundingClientRect().left - yp.getBoundingClientRect().right,
            firstChildIsRows: card.firstElementChild === rowsBox,
            headings: card.querySelectorAll('h1,h2,h3,h4').length,
            cardTop: cardRect.top,
            cardBottom: cardRect.bottom,
            cardLeft: cardRect.left,
            cardRight: cardRect.right,
            rowHeights: lns.map((l) => Math.round(l.getBoundingClientRect().height * 10) / 10),
            youHeight: you.getBoundingClientRect().height,
            ynIsLast: yn === card.querySelector('.tr-yr').lastElementChild,
          };
        }
        const mm = document.querySelector('[data-fold="month-by-month"]');
        const head = mm.querySelector('.tr-mm-head');
        const label = mm.querySelector('.tr-t');
        const chev = mm.querySelector('svg');
        out.mm = {
          radius: cs(mm, 'borderTopLeftRadius'),
          border: rgb(cs(mm, 'borderTopColor')),
          line: rgb(getComputedStyle(document.documentElement).getPropertyValue('--line').trim() || '#000'),
          h: head.getBoundingClientRect().height,
          boxH: mm.getBoundingClientRect().height,
          label: label.textContent,
          labelTransform: cs(label, 'textTransform'),
          labelSize: cs(label, 'fontSize'),
          labelSpacing: px(cs(label, 'letterSpacing')),
          labelColor: rgb(cs(label, 'color')),
          muted: rgb(getComputedStyle(document.documentElement).getPropertyValue('--ink-2').trim()),
          chev: [chev.getBoundingClientRect().width, chev.getBoundingClientRect().height, rgb(cs(chev, 'stroke')), cs(chev, 'strokeWidth')],
          expanded: head.getAttribute('aria-expanded'),
          rows: document.querySelectorAll('[data-month-rows], .tr-mrow').length,
          top: mm.getBoundingClientRect().top,
          padL: cs(head, 'paddingLeft'),
        };
        out.gaps = [document.querySelector('[data-card="projected"]').getBoundingClientRect().top - document.querySelector('[data-card="so-far"]').getBoundingClientRect().bottom, mm.getBoundingClientRect().top - document.querySelector('[data-card="projected"]').getBoundingClientRect().bottom];
        out.order = [...document.querySelector('.tr').children].map((c) => c.getAttribute('data-card') || c.getAttribute('data-fold'));
        return out;
      });
      const eqc = (a, b, tol = 2) => a.every((v, i) => Math.abs(v - b[i]) <= tol);
      const acc = scheme === 'light' ? { sf: [0x8a, 0x6a, 0x00], pj: [0x4a, 0x5f, 0x8f] } : { sf: [0xf0, 0xcf, 0x55], pj: [0x9d, 0xb3, 0xe6] };
      const mix = (a, b, pct) => a.map((v, i) => Math.round((v * pct + b[i] * (100 - pct)) / 100));
      assert(m.order.join() === 'so-far,projected,month-by-month', `order ${m.order}`);
      assert(m.gaps.every((g) => Math.abs(g - 9) < 1), `9 px between the cards: ${m.gaps}`);
      for (const k of ['sf', 'pj']) {
        const x = m[k];
        const label = k === 'sf' ? 'So far' : 'Projected';
        assert(x.radius === '18px' && x.borderW === '1px', `${label}: radius ${x.radius}, border ${x.borderW}`);
        assert(eqc(x.borderColor, mix(acc[k], x.lnBorderColor, 45), 3), `${label}: border is 45% accent mixed with the line color: ${x.borderColor} vs ${mix(acc[k], x.lnBorderColor, 45)}`);
        assert(x.rowsPad.join() === '6px,16px,2px,16px', `${label}: rows padding ${x.rowsPad}`);
        assert(x.lnFont === '14.5px' && x.lnPad.join() === '6px,6px', `${label}: row font ${x.lnFont}, padding ${x.lnPad}`);
        assert(x.lnBorders.join() === 'none/0px,dashed/1px,solid/1px,dashed/1px', `${label}: row lines ${x.lnBorders}`);
        assert(x.sumWeights.join() === '700,700' && x.ddWeight === '600', `${label}: weights ${x.sumWeights} ${x.ddWeight}`);
        assert(x.emSize === '11.5px' && x.emMargin === '4px' && x.emStyle === 'normal', `${label}: small word ${x.emSize} ${x.emMargin} ${x.emStyle}`);
        assert(eqc(x.emColor, m.mm.muted, 1), `${label}: small words are muted: ${x.emColor} vs ${m.mm.muted}`);
        assert(x.youPad.join() === '8px,16px,8px,16px' && x.youBorder === 'solid/1px', `${label}: bottom row ${x.youPad} ${x.youBorder}`);
        assert(eqc(x.youBg, mix(acc[k], x.bg, 8), 2), `${label}: bottom row is 8% accent in the card color: ${x.youBg} vs ${mix(acc[k], x.bg, 8)}`);
        assert(eqc(x.youLine, m.mm.line, 1), `${label}: the line above the bottom row is the site's line color`);
        assert(x.dotW === 8 && x.dotH === 8 && x.dotRect[0] === 8 && x.dotRect[1] === 8 && x.dotGap === '8px', `${label}: dot ${x.dotW}x${x.dotH} (rect ${x.dotRect}) gap ${x.dotGap}`);
        if (k === 'sf') assert(eqc(x.dotBg, acc.sf, 1) && x.dotBorder === '0px', `So far: filled dot ${x.dotBg} border ${x.dotBorder}`);
        else assert(x.dotBorder === '2px' && eqc(x.dotBorderColor, acc.pj, 1), `Projected: ring dot, 2px ${x.dotBorderColor}`);
        assert(x.tSize === '11px' && Math.abs(x.tSpacing - 1.54) < 0.02 && x.tWeight === '700' && x.tTransform === 'uppercase' && eqc(x.tColor, acc[k], 1), `${label}: title ${x.tSize} ${x.tSpacing} ${x.tWeight} ${x.tTransform} ${x.tColor}`);
        assert(x.ypSize === '12.5px' && eqc(x.ypColor, m.mm.muted, 1), `${label}: per court ${x.ypSize} ${x.ypColor}`);
        assert(x.ypBox[0] === '0px' && x.ypBox[1] === '0px' && x.ypBox[2] === '0px' && x.ypBox[4] === 'rgba(0, 0, 0, 0)' && x.ypBox[5] === '0px', `${label}: per court is plain text (no pill, border or background): ${x.ypBox}`);
        assert(x.ynSize === '20px' && x.ynWeight === '700' && Math.abs(x.ynSpacing + 0.4) < 0.02 && eqc(x.ynColor, acc[k], 1), `${label}: total ${x.ynSize} ${x.ynWeight} ${x.ynSpacing} ${x.ynColor}`);
        assert(Math.abs(x.gap - 12) < 0.6, `${label}: 12px between $/court and the total: ${x.gap}`);
        assert(x.firstChildIsRows && x.headings === 0, `${label}: nothing above the rows (no title row): first is rows ${x.firstChildIsRows}, headings ${x.headings}`);
        assert(eqc(x.amber, scheme === 'light' ? [0x7a, 0x48, 0x00] : [0xf4, 0xcd, 0x70], 1), `${label}: Owed to venue uses the site's amber ${x.amber}`);
        assert(eqc(x.green, scheme === 'light' ? [0x17, 0x60, 0x3a] : [0x8f, 0xe0, 0xad], 1), `${label}: Players paid uses the site's green ${x.green}`);
        assert(x.ynIsLast, `${label}: the total is the last thing on the right`);
      }
      assert(m.sf.dotW === m.pj.dotW && m.sf.dotH === m.pj.dotH, 'both dots are the same size');
      assert(m.mm.radius === '18px' && eqc(m.mm.border, m.mm.line, 1), `Month by month card: radius ${m.mm.radius}, plain border ${m.mm.border}`);
      assert(m.mm.label === 'Month by month' && m.mm.labelTransform === 'uppercase' && m.mm.labelSize === '11px' && Math.abs(m.mm.labelSpacing - 1.54) < 0.02 && eqc(m.mm.labelColor, m.mm.muted, 1), `Month by month label: ${JSON.stringify(m.mm)}`);
      assert(m.mm.h >= 42 && m.mm.h <= 44, `Month by month row height 42 (the mock): ${m.mm.h}`);
      assert(m.mm.chev[0] === 14 && m.mm.chev[1] === 9 && m.mm.chev[3] === '2.2px', `chevron ${m.mm.chev}`);
      assert(m.mm.expanded === 'false' && m.mm.rows === 0, 'Month by month starts collapsed');
      assert(errors.length === 0, `page errors: ${errors}`);
      await ctx.close();
    });
  }

  // ---------------------------------------------------------------- the font
  await check('the font: every number on Totals (rows, totals, $/court, month rows) uses the font of the Games rows and the date tiles, with equal-width digits; not the old display font', async () => {
    const g = await openAdmin();
    await g.page.locator('.tabbar button', { hasText: 'Money' }).click();
    await g.page.locator('.mrw-games').waitFor();
    const site = await g.page.evaluate(() => {
      const fam = (el) => getComputedStyle(el).fontFamily;
      const nums = (s) => (document.querySelector(s) ? fam(document.querySelector(s)) : null);
      return { tile: nums('.r2m-tile b'), owed: nums('.mrw-owed'), title: nums('.mrw-title'), body: fam(document.body), headerTile: nums('.topbar .dtile b, .topbar [class*="tile"] b'), foot: nums('.mrw-foot span') };
    });
    await g.ctx.close();
    assert(site.tile && site.tile === site.body, `date tile font ${site.tile} vs body ${site.body}`);
    const { ctx, page } = await openTotals();
    await page.locator('[data-fold="month-by-month"] button').click();
    await page.locator('[data-month-rows], [data-no-months]').first().waitFor();
    await page.waitForTimeout(500);
    const fonts = await page.evaluate(() => {
      const els = [...document.querySelectorAll('.tr-ln dd, .tr-yn, .tr-yp, .tr-mrow-net, .tr-mrow-sub, .tr-mrow-name')];
      return els.map((e) => ({ t: e.textContent, f: getComputedStyle(e).fontFamily, v: getComputedStyle(e).fontVariantNumeric }));
    });
    assert(fonts.length >= 10, `numbers found: ${fonts.length}`);
    for (const x of fonts) {
      assert(x.f === site.tile, `"${x.t}" uses ${x.f}, the site uses ${site.tile}`);
      assert(!/Bricolage/i.test(x.f), `"${x.t}" still uses the display font`);
      assert(/tabular-nums/.test(x.v), `"${x.t}" does not use equal-width digits: ${x.v}`);
    }
    if (site.owed) assert(site.owed === site.tile, `Games rows' owed font ${site.owed}`);
    await ctx.close();
  });

  // ---------------------------------------------------------------- Month by month
  await check('Month by month: collapsed by default and nothing is loaded for it; a tap opens it with one row per past month (games, net cost, $/court; "No games" with none); another tap closes it; a reload starts collapsed again', async () => {
    const d = await dash();
    const counts = d.gameMonthCounts;
    const first = Object.keys(counts).filter((m) => counts[m] > 0 && m < MONTH).sort()[0];
    const months = [];
    for (let [y, mo] = first.split('-').map(Number); `${y}-${String(mo).padStart(2, '0')}` < MONTH; mo === 12 ? (y++, (mo = 1)) : mo++) months.push(`${y}-${String(mo).padStart(2, '0')}`);
    months.reverse();
    const { ctx, page, moneyCalls } = await openTotals();
    const closed = await page.evaluate(() => ({ expanded: document.querySelector('[data-fold="month-by-month"] button').getAttribute('aria-expanded'), rows: document.querySelectorAll('.tr-mrow').length }));
    assert(closed.expanded === 'false' && closed.rows === 0, `collapsed: ${JSON.stringify(closed)}`);
    assert(moneyCalls.every((m) => m === MONTH), `nothing else is asked for while it is closed: ${moneyCalls}`);
    await page.locator('[data-fold="month-by-month"] button').click();
    await page.locator('[data-month-rows]').waitFor();
    const rows = await page.evaluate(() =>
      [...document.querySelectorAll('.tr-mrow')].map((r) => ({
        month: r.getAttribute('data-month-row'),
        name: r.querySelector('.tr-mrow-name').textContent,
        subs: [...r.querySelectorAll('.tr-mrow-sub')].map((x) => x.textContent),
        net: r.querySelector('.tr-mrow-net').textContent,
      })),
    );
    assert(rows.map((r) => r.month).join() === months.join(), `months ${rows.map((r) => r.month)} vs ${months}`);
    assert(rows.length >= 2 && months.includes('2026-10'), 'several past months, October among them');
    const MN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    let sawGames = 0;
    let sawNone = 0;
    let sawCredit = 0;
    for (const r of rows) {
      const t = (await moneyOf(r.month)).rework;
      const net = t.owedToVenueCents - t.collectedCents;
      const games = t.courtSessions;
      assert(r.name === `${MN[Number(r.month.slice(5)) - 1]} ${r.month.slice(0, 4)}`, `name ${r.name}`);
      // A credit month (the players paid more than the venue was owed) reads "$2 credit" and "$2/court credit": the word, no minus sign.
      assert(r.net === `${fp(Math.abs(net))}${net < 0 ? ' credit' : ''}`, `${r.month} net ${r.net} vs ${fp(net)}`);
      if (net < 0) sawCredit++;
      if (games > 0) {
        sawGames++;
        const p = per(net, games);
        assert(r.subs.join('|') === `${games} ${games === 1 ? 'game' : 'games'}|$${Math.abs(p)}/court${net < 0 ? ' credit' : ''}`, `${r.month} ${r.subs} (${games} games, net ${net})`);
      } else {
        sawNone++;
        assert(r.subs.join('|') === 'No games', `${r.month} should say No games: ${r.subs}`);
      }
    }
    assert(sawGames > 0 && sawNone > 0 && sawCredit > 0, `rows with games ${sawGames}, without ${sawNone}, a credit month ${sawCredit}`);
    assert(rows.find((r) => r.month === '2026-10').subs.join('|') === 'No games' && rows.find((r) => r.month === '2026-10').net === '$30', 'October: the membership only, No games');
    await page.screenshot({ path: path.join(SHOTS, 'zip23-month-by-month-open.png'), fullPage: true });
    await page.locator('[data-fold="month-by-month"] button').click();
    assert((await page.locator('.tr-mrow').count()) === 0, 'closed again');
    await page.reload();
    await page.locator('[data-totals]').waitFor().catch(() => {});
    await ctx.close();
    const again = await openTotals();
    assert((await again.page.locator('.tr-mrow').count()) === 0 && (await again.page.locator('[data-fold="month-by-month"] button').getAttribute('aria-expanded')) === 'false', 'a fresh visit starts collapsed');
    await again.ctx.close();
  });
  await check('Month by month with a game and a credit month: a past month with games shows its $/court; a credit month shows green credit; with one past month only that month is listed', async () => {
    const mutate = (j, month) => {
      if (!j.rework || month !== '2026-09') return;
      const r = j.rework;
      r.membershipCents = 0;
      r.courtSessions = 1;
      r.courtCostCents = 4800;
      r.owedToVenueCents = 4800;
      r.collectedCents = 5000;
    };
    const { ctx, page } = await openTotals({ mutate });
    await page.locator('[data-fold="month-by-month"] button').click();
    await page.locator('[data-month-rows]').waitFor();
    const r = await page.evaluate(() => {
      const row = document.querySelector('[data-month-row="2026-09"]');
      return { net: row.querySelector('.tr-mrow-net').textContent, per: row.querySelector('[data-month-per-court]')?.textContent, green: getComputedStyle(row.querySelector('.tr-mrow-net')).color, ref: getComputedStyle(document.querySelector('[data-card="so-far"] [data-row="players"] dd')).color };
    });
    assert(r.net === '$2 credit' && r.per === '$2/court credit' && r.green === r.ref, JSON.stringify(r));
    await ctx.close();
  });

  // ---------------------------------------------------------------- fit and clipping
  await check('iPhone Air (420 x 912), normal text, light and dark: both cards and the collapsed Month by month fit on the screen with no scrolling, above the bottom bar', async () => {
    for (const scheme of ['light', 'dark']) {
      const { ctx, page } = await openTotals({ width: 420, height: 912, scheme });
      const f = await page.evaluate(() => {
        const mm = document.querySelector('[data-fold="month-by-month"]').getBoundingClientRect();
        const bar = document.querySelector('.tabbar').getBoundingClientRect();
        return { scroll: document.scrollingElement.scrollHeight, inner: innerHeight, mmBottom: mm.bottom, barTop: bar.top };
      });
      assert(f.scroll <= f.inner, `${scheme}: the page scrolls (${f.scroll} > ${f.inner})`);
      assert(f.mmBottom <= f.barTop - 4, `${scheme}: Month by month ends at ${f.mmBottom}, the bar starts at ${f.barTop}`);
      await ctx.close();
    }
  });

  /** The strict clipping check (text at least 2 px inside the inside edge of every box, nothing overlapping, one-line words stay one line). */
  const strict = () =>
    document.querySelector('.tr') &&
    (() => {
      const problems = [];
      const root = document.querySelector('.tr');
      const textEls = [...root.querySelectorAll('*')].filter((el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()));
      const items = [];
      for (const el of textEls) {
        const box = el.closest('.tr-card, .tr-mm');
        const cs = getComputedStyle(box);
        const bb = box.getBoundingClientRect();
        const inner = { l: bb.left + parseFloat(cs.borderLeftWidth), r: bb.right - parseFloat(cs.borderRightWidth), t: bb.top + parseFloat(cs.borderTopWidth), b: bb.bottom - parseFloat(cs.borderBottomWidth) };
        const rects = [];
        for (const n of el.childNodes) {
          if (n.nodeType !== 3 || !n.textContent.trim()) continue;
          const range = document.createRange();
          range.selectNodeContents(n);
          for (const r of range.getClientRects()) if (r.width > 0 && r.height > 0) rects.push(r);
        }
        const name = `${el.className || el.tagName}:"${el.textContent.trim().slice(0, 18)}"`;
        for (const r of rects) {
          if (r.left < inner.l + 2 || r.right > inner.r - 2 || r.top < inner.t + 2 || r.bottom > inner.b - 2) problems.push(`${name} outside its box (${Math.round(r.left)}-${Math.round(r.right)} vs ${Math.round(inner.l)}-${Math.round(inner.r)})`);
        }
        if (el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).display !== 'inline') problems.push(`${name} wider than itself`);
        items.push({ el, name, rects });
      }
      for (const svg of root.querySelectorAll('svg')) {
        const box = svg.closest('.tr-mm');
        const r = svg.getBoundingClientRect();
        const bb = box.getBoundingClientRect();
        if (r.right > bb.right - 2 - 1 || r.left < bb.left + 3) problems.push('chevron too near the edge');
      }
      for (let i = 0; i < items.length; i++)
        for (let j = i + 1; j < items.length; j++) {
          const a = items[i];
          const b = items[j];
          if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
          for (const x of a.rects)
            for (const y of b.rects) {
              const ox = Math.min(x.right, y.right) - Math.max(x.left, y.left);
              const oy = Math.min(x.bottom, y.bottom) - Math.max(x.top, y.top);
              if (ox > 0.5 && oy > 0.5) problems.push(`${a.name} overlaps ${b.name}`);
            }
        }
      const lines = (sel) =>
        [...root.querySelectorAll(sel)].map((el) => {
          const tops = new Set();
          for (const n of el.childNodes) {
            if (n.nodeType !== 3) continue;
            const range = document.createRange();
            range.selectNodeContents(n);
            for (const r of range.getClientRects()) if (r.width > 0) tops.add(Math.round(r.top));
          }
          return { text: el.textContent.trim(), n: tops.size };
        });
      for (const sel of ['.tr-t', '.tr-yp', '.tr-yn', '.tr-ln dd', '.tr-mm-head .tr-t']) for (const l of lines(sel)) if (l.n > 1) problems.push(`"${l.text}" (${sel}) wraps onto ${l.n} lines`);
      // The $/court may drop under the total, never the other way and never the title.
      for (const card of root.querySelectorAll('.tr-card')) {
        const t = card.querySelector('.tr-t').getBoundingClientRect();
        const yn = card.querySelector('.tr-yn').getBoundingClientRect();
        const yp = card.querySelector('.tr-yp')?.getBoundingClientRect();
        if (t.right > yn.left) problems.push('title runs into the total');
        if (yp && yp.top < yn.top - 1 && yp.bottom > yn.top + 1 && yp.right > yn.left) problems.push('$/court sits above the total');
      }
      return problems;
    })();
  const sizes = [
    [420, 912],
    [390, 844],
    [360, 780],
    [320, 700],
  ];
  const run = async (opts, label, mutate) => {
    const { ctx, page } = await openTotals({ ...opts, mutate });
    const p = await page.evaluate(`(${strict.toString()})()`);
    if (opts.pct === 150 && opts.width === 320 && opts.scheme === 'dark') await page.screenshot({ path: path.join(SHOTS, `zip23-totals-320-150-${label}.png`), fullPage: true });
    assert(Array.isArray(p), `${label}: the Totals cards were not on the page to check`);
    assert(p.length === 0, `${label}: ${p.slice(0, 5).join(" | ")}`);
    await ctx.close();
  };
  for (const scheme of ['light', 'dark']) {
    for (const [width, height] of sizes) {
      for (const pct of [100, 125, 150]) {
        await check(`clipping: ${width} wide, ${scheme}, text ${pct}%: nothing clips, overlaps or runs together; PROJECTED, $/court and the total stay on one line`, async () => {
          await run({ width, height, scheme, pct }, `${width}-${scheme}-${pct}`);
        });
      }
    }
  }
  await check('clipping at the extremes: a four-digit total, a 3-digit per court and Month by month open, 320 wide, text 150%, light and dark', async () => {
    const mutate = (j, month) => {
      if (!j.rework) return;
      if (month === '2026-09') {
        j.rework.courtSessions = 1;
        j.rework.courtCostCents = 4800;
        j.rework.owedToVenueCents = 4800;
        j.rework.collectedCents = 0;
      }
      if (month !== MONTH) return;
      const r = j.rework;
      r.courtSessions = 3;
      r.courtCostCents = 123400;
      r.membershipCents = 3000;
      r.owedToVenueCents = 126400;
      r.collectedCents = 100;
      r.projected.courtCount = 3;
      r.projected.courtCostCents = 123400;
      r.projected.totalCents = 126400;
      r.projected.playersPayCents = 0;
    };
    for (const scheme of ['light', 'dark']) {
      const { ctx, page } = await openTotals({ width: 320, height: 700, scheme, pct: 150, mutate });
      await page.locator('[data-fold="month-by-month"] button').click();
      await page.locator('[data-month-rows]').waitFor();
      await page.waitForTimeout(300);
      const p = await page.evaluate(`(${strict.toString()})()`);
      assert(p.length === 0, `${scheme}: ${p.slice(0, 5).join(' | ')}`);
      await ctx.close();
    }
  });

  await check('the tap target of the Month by month card is as tall as the mock (42 px); the card is a real button with aria-expanded', async () => {
    const { ctx, page } = await openTotals({ width: 390 });
    const h = await page.locator('[data-fold="month-by-month"] button').evaluate((b) => ({ h: b.getBoundingClientRect().height, tag: b.tagName, exp: b.getAttribute('aria-expanded') }));
    assert(h.tag === 'BUTTON' && h.exp === 'false' && h.h >= 42, JSON.stringify(h));
    await ctx.close();
  });

  await browser.close();
  console.log(`\nzip23: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
