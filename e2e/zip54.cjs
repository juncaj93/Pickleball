/* Zip 54: the "Running total" card on Money > Totals (between Projected and Month by month, collapsed).
 *
 *   node e2e/zip54.cjs      (also run by npm run test:e2e)
 *
 * Fake world (Mon Nov 16 at 10 AM Eastern), its own dev server; nothing touches Cloudflare or the live site. Two kinds of checks:
 *   - Alex's own numbers (Oct $30 with no games, Nov so far $192 court / $168 players / 4 games) are put on the wire by rewriting the money answers
 *     in the browser, so the screen must show $60 / $24 / $84 / $42 a month / $21 a game;
 *   - the fake world's real numbers (a year of months): the card must equal the So far card plus every Month by month row, month by month.
 * Also: collapsed by default and nothing extra loaded while closed, opens and closes, both cards together, a credit, no games, another month picked,
 * no clipping or wrapping at 360, 390 and 420 wide in light and dark.
 */
const { spawn, spawnSync } = require('node:child_process');
const { readFileSync, mkdirSync, rmSync } = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.E2E_PORT) || 5454;
const BASE = `http://localhost:${PORT}`;
const NOW_ISO = '2026-11-16T15:00:00.000Z'; // Mon Nov 16, 10:00 AM Eastern
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
const per = (net, n) => (n > 0 ? (net < 0 ? -1 : 1) * Math.round(Math.abs(net) / n / 100) : null);

/** A month answer (the part of the server's answer the cards read), in cents. */
const monthAnswer = (membership, court, players, games) => ({
  courtSessions: games,
  courtCostCents: court,
  membershipCents: membership,
  owedToVenueCents: membership + court,
  collectedCents: players,
  yourCostCents: Math.max(0, membership + court - players),
  yourCostCourtCents: 0,
  yourCostMembershipCents: membership,
  projected: { courtCount: 8, addedCourts: 4, courtCostCents: 38400, membershipCents: 3000, totalCents: 41400, playersPayCents: 33600, yourCostCents: 7800, yourCostCourtCents: 4800, yourCostMembershipCents: 3000 },
});
/** Alex's real numbers today (Mon Nov 16): Oct $30, no games; Nov so far membership $30, court $192, players paid $168, 4 games. */
const ALEX = { '2026-10': monthAnswer(3000, 0, 0, 0), '2026-11': monthAnswer(3000, 19200, 16800, 4) };

async function main() {
  mkdirSync(SHOTS, { recursive: true });
  const dbFile = path.join(ROOT, '.data', 'zip54.sqlite');
  mkdirSync(path.join(ROOT, '.data'), { recursive: true });
  rmSync(dbFile, { force: true });
  const seeded = spawnSync('npx', ['vite-node', 'scripts/load-seed-local.ts', '--', dbFile, NOW_ISO], { cwd: ROOT, encoding: 'utf8' });
  if (seeded.status !== 0) throw new Error(`could not build the fake world: ${seeded.stderr || seeded.stdout}`);
  if (await fetch(`${BASE}/api/status`).then((r) => r.ok, () => false)) throw new Error(`port ${PORT} is already in use`);
  const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
    cwd: ROOT,
    env: { ...process.env, DEV_DB: dbFile, SETUP_TOKEN: 'zip54-setup-token-0123456789', DEV_CLOCK: '1' },
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
  const post = (req, url, data) => req.post(BASE + url, { data, headers: { Origin: BASE } });
  const put = (req, url, data) => req.put(BASE + url, { data, headers: { Origin: BASE } });
  const real = (await browser.newContext()).request;
  if (!(await post(real, '/api/admin/login', { pin: PIN })).ok()) throw new Error('login failed');
  const moneyOf = async (month) => (await real.get(`${BASE}/api/admin/money?month=${month}`, { headers: { 'X-Money-Rework': 'on' } })).json();
  // The Totals look this card lives in is ON, as on the preview and live.
  if (!(await put(real, '/api/admin/totals-refresh-switch', { on: true })).ok()) throw new Error('could not turn Totals refresh on');

  /** opts.answers: month -> answer to put on the wire; opts.counts: replaces the dashboard's game counts per month. */
  async function openTotals(opts = {}) {
    const width = opts.width ?? 390;
    const ctx = await browser.newContext({ viewport: { width, height: opts.height ?? 900 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, colorScheme: opts.scheme ?? 'light', userAgent: UA, reducedMotion: 'reduce' });
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
    if (opts.answers) {
      await ctx.route('**/api/admin/money?*', async (route) => {
        const resp = await route.fetch();
        const json = await resp.json();
        const m = new URL(route.request().url()).searchParams.get('month');
        if (opts.answers[m]) json.rework = opts.answers[m];
        else if (opts.answers[m] === null) delete json.rework; // a month the server gave no numbers for
        await route.fulfill({ response: resp, json });
      });
    }
    if (opts.delay) {
      await ctx.route('**/api/admin/money?*', async (route) => {
        const m = new URL(route.request().url()).searchParams.get('month');
        if (m === opts.delay.month && opts.delay.on()) await sleep(opts.delay.ms);
        await route.fallback();
      });
    }
    if (opts.counts) {
      await ctx.route('**/api/admin/dashboard*', async (route) => {
        const resp = await route.fetch();
        const json = await resp.json();
        json.gameMonthCounts = opts.counts;
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
    await page.goto(BASE + '/admin');
    await page.locator('.tabbar').waitFor();
    await page.locator('.tabbar button', { hasText: 'Money' }).click();
    await page.locator('.mrw-seg button', { hasText: 'Totals' }).click();
    await page.locator('[data-totals]').waitFor();
    await page.waitForTimeout(350);
    return { ctx, page, errors, moneyCalls };
  }
  const ALEX_OPTS = { answers: ALEX, counts: { '2026-11': 4 } };
  const head = (page, fold) => page.locator(`[data-fold="${fold}"] .tr-mm-head`);
  const openFold = async (page, fold) => {
    await head(page, fold).click();
    await page.waitForTimeout(500);
  };
  /** The Running total rows as plain text and numbers. */
  const readRt = (page) =>
    page.evaluate(() => {
      const el = document.querySelector('[data-fold="running-total"]');
      const rows = {};
      for (const r of el.querySelectorAll('.tr-ln')) rows[r.getAttribute('data-row')] = { label: r.querySelector('dt').textContent.replace(/\s+/g, ' ').trim(), value: r.querySelector('dd').textContent.replace(/\s+/g, ' ').trim(), cls: r.querySelector('dd').className, color: getComputedStyle(r.querySelector('dd')).color };
      const t = el.querySelector('.tr-you .tr-t');
      const n = el.querySelector('[data-per-game]');
      return { rows, foot: t ? t.textContent.replace(/\s+/g, ' ').trim() : null, footUpper: t ? getComputedStyle(t).textTransform : null, perGameLabel: el.querySelector('.tr-yp')?.textContent ?? null, perGame: n ? n.textContent.replace(/\s+/g, ' ').trim() : null, perGameCls: n ? n.className : null, text: el.textContent };
    });

  // ---------------------------------------------------------------- the card, closed
  await check('between Projected and Month by month, collapsed by default (label left, chevron right), loads nothing while closed', async () => {
    const { ctx, page, errors, moneyCalls } = await openTotals(ALEX_OPTS);
    const order = await page.evaluate(() => [...document.querySelectorAll('.tr > *')].map((e) => e.getAttribute('data-card') || e.getAttribute('data-fold')));
    assert(JSON.stringify(order) === JSON.stringify(['so-far', 'projected', 'running-total', 'month-by-month']), `order: ${order}`);
    const f = await page.evaluate(() => {
      const el = document.querySelector('[data-fold="running-total"]');
      const mm = document.querySelector('[data-fold="month-by-month"]');
      const h = el.querySelector('.tr-mm-head');
      const mh = mm.querySelector('.tr-mm-head');
      const label = h.querySelector('.tr-t').getBoundingClientRect();
      const chev = h.querySelector('.tr-chev').getBoundingClientRect();
      return { expanded: h.getAttribute('aria-expanded'), label: h.querySelector('.tr-t').textContent, labelLeft: label.left < chev.left, rows: !!el.querySelector('.tr-ln'), sameHeight: Math.abs(h.getBoundingClientRect().height - mh.getBoundingClientRect().height) < 0.5, sameBox: el.getBoundingClientRect().height === mm.getBoundingClientRect().height };
    });
    assert(f.expanded === 'false' && f.label === 'Running total' && f.labelLeft && !f.rows, `closed: ${JSON.stringify(f)}`);
    assert(f.sameHeight && f.sameBox, 'the closed card is the same height as Month by month');
    assert(moneyCalls.every((m) => m === '2026-11'), `nothing but this month is loaded while both are closed: ${moneyCalls}`);
    assert(errors.length === 0, `page errors: ${errors}`);
    await ctx.close();
  });

  await check('opens and closes (tap the head again to close); the chevron turns', async () => {
    const { ctx, page } = await openTotals(ALEX_OPTS);
    await openFold(page, 'running-total');
    assert((await head(page, 'running-total').getAttribute('aria-expanded')) === 'true', 'open');
    assert((await page.locator('[data-fold="running-total"] .tr-ln').count()) === 4, 'four rows');
    const turned = await page.evaluate(() => getComputedStyle(document.querySelector('[data-fold="running-total"] .tr-chev')).transform);
    assert(turned !== 'none', 'chevron turned');
    await openFold(page, 'running-total');
    assert((await head(page, 'running-total').getAttribute('aria-expanded')) === 'false' && (await page.locator('[data-fold="running-total"] .tr-ln').count()) === 0, 'closed again');
    await ctx.close();
  });

  // ---------------------------------------------------------------- Alex's numbers
  await check("Alex's numbers on the built screen: Membership 2 months $60, Court costs after players 4 games $24, Out of pocket $84 (amber like Owed to venue), Average per month $42, SINCE OCT / per game $21", async () => {
    const { ctx, page, moneyCalls } = await openTotals(ALEX_OPTS);
    const callsBefore = moneyCalls.length;
    await openFold(page, 'running-total');
    const r = await readRt(page);
    assert(r.rows['rt-membership'].label === 'Membership 2 months' && r.rows['rt-membership'].value === '$60', JSON.stringify(r.rows['rt-membership']));
    assert(r.rows['rt-court'].label === 'Court costs after players 4 games' && r.rows['rt-court'].value === '$24', JSON.stringify(r.rows['rt-court']));
    assert(r.rows['rt-out'].label === 'Out of pocket' && r.rows['rt-out'].value === '$84', JSON.stringify(r.rows['rt-out']));
    assert(r.rows['rt-average'].label === 'Average per month' && r.rows['rt-average'].value === '$42', JSON.stringify(r.rows['rt-average']));
    assert(r.foot === 'Since Oct' && r.footUpper === 'uppercase', `footer: ${r.foot} ${r.footUpper}`);
    assert(r.perGameLabel === 'per game' && r.perGame === '$21', `per game: ${r.perGameLabel} ${r.perGame}`);
    const owed = await page.evaluate(() => getComputedStyle(document.querySelector('[data-card="so-far"] [data-row="owed"] dd')).color);
    assert(r.rows['rt-out'].color === owed, `Out of pocket is amber like Owed to venue: ${r.rows['rt-out'].color} vs ${owed}`);
    assert(r.rows['rt-out'].cls.includes('am') && r.rows['rt-out'].cls !== '' && /bold|700/.test(await page.evaluate(() => getComputedStyle(document.querySelector('[data-row="rt-out"] dd')).fontWeight) + 'bold'), 'bold amber');
    // The So far card above is untouched, and the card asked only for the one extra month (October).
    assert((await page.locator('[data-card="so-far"] .tr-yn').getAttribute('data-total')) === '5400', 'So far card still $54');
    assert(JSON.stringify(moneyCalls.slice(callsBefore)) === JSON.stringify(['2026-10']), `opening the card asks only for October (this month is already on screen): ${moneyCalls.slice(callsBefore)}`);
    await page.screenshot({ path: path.join(SHOTS, 'zip54-alex-open-light.png') });
    await ctx.close();
  });

  await check("Month by month now lists October ($30, No games) when it is open, and the card's numbers equal So far + those rows", async () => {
    const { ctx, page } = await openTotals(ALEX_OPTS);
    await openFold(page, 'month-by-month');
    const rows = await page.evaluate(() => [...document.querySelectorAll('[data-month-row]')].map((r) => ({ m: r.getAttribute('data-month-row'), net: Number(r.querySelector('[data-month-net]').getAttribute('data-month-net')), sub: r.querySelector('.tr-mrow-sub').textContent })));
    assert(rows.length === 1 && rows[0].m === '2026-10' && rows[0].net === 3000 && rows[0].sub === 'No games', JSON.stringify(rows));
    await openFold(page, 'running-total');
    const r = await readRt(page);
    const so = Number(await page.locator('[data-card="so-far"] .tr-yn').getAttribute('data-total'));
    assert(r.rows['rt-out'].value === `$${(rows.reduce((a, x) => a + x.net, 0) + so) / 100}`, `out of pocket = rows + So far: ${r.rows['rt-out'].value}`);
    await ctx.close();
  });

  await check('both cards open together share the loaded months (each month asked for once); closing one leaves the other; Month by month works alone', async () => {
    const { ctx, page, moneyCalls } = await openTotals(ALEX_OPTS);
    await openFold(page, 'month-by-month');
    await openFold(page, 'running-total');
    assert((await page.locator('[data-month-row]').count()) === 1 && (await page.locator('[data-fold="running-total"] .tr-ln').count()) === 4, 'both show');
    assert(moneyCalls.filter((m) => m === '2026-10').length === 1, `October asked for once: ${moneyCalls}`);
    await openFold(page, 'month-by-month');
    assert((await page.locator('[data-month-row]').count()) === 0 && (await page.locator('[data-fold="running-total"] .tr-ln').count()) === 4, 'closing Month by month leaves Running total');
    await openFold(page, 'running-total');
    await openFold(page, 'month-by-month');
    assert((await page.locator('[data-month-row]').count()) === 1, 'Month by month alone still works');
    await ctx.close();
  });

  // ---------------------------------------------------------------- edge cases on the wire
  await check('no games at all: the per game part is gone (label and number), the rest still shows', async () => {
    const { ctx, page } = await openTotals({ answers: { '2026-10': monthAnswer(3000, 0, 0, 0), '2026-11': monthAnswer(3000, 0, 0, 0) }, counts: { '2026-11': 0 } });
    await openFold(page, 'running-total');
    const r = await readRt(page);
    assert(r.perGame === null && r.perGameLabel === null, 'no per game');
    assert(r.rows['rt-court'].label === 'Court costs after players 0 games' && r.rows['rt-court'].value === '$0' && r.rows['rt-out'].value === '$60' && r.rows['rt-average'].value === '$30', JSON.stringify(r.rows));
    assert(r.foot === 'Since Oct', 'footer label stays');
    await ctx.close();
  });

  await check('one month only (an October that has no earlier month): "1 month", "1 game", singular words', async () => {
    // The clock says November, so a one-month world is made by a month list that starts now: October is hidden from the list by asking for no earlier month.
    const { ctx, page } = await openTotals({ answers: { '2026-10': null, '2026-11': monthAnswer(3000, 4800, 1400, 1) }, counts: { '2026-11': 1 } });
    await openFold(page, 'running-total');
    const r = await readRt(page);
    // October has no answer (null) so it is not counted: only November is.
    assert(r.rows['rt-membership'].label === 'Membership 1 month' && r.rows['rt-court'].label === 'Court costs after players 1 game', JSON.stringify(r.rows));
    assert(r.rows['rt-out'].value === '$64' && r.rows['rt-average'].value === '$64' && r.perGame === '$64' && r.foot === 'Since Nov', JSON.stringify(r));
    await ctx.close();
  });

  await check('a credit (players paid more than the costs): green, the word "credit", no minus sign anywhere on the card', async () => {
    const { ctx, page } = await openTotals({ answers: { '2026-10': monthAnswer(0, 0, 0, 0), '2026-11': monthAnswer(0, 9600, 12000, 2) }, counts: { '2026-11': 2 } });
    await openFold(page, 'running-total');
    const r = await readRt(page);
    assert(r.rows['rt-out'].value === '$24 credit' && r.rows['rt-average'].value === '$12 credit' && r.perGame === '$12 credit' && r.rows['rt-court'].value === '$24 credit', JSON.stringify(r));
    assert(/gr/.test(r.rows['rt-out'].cls) && !/am/.test(r.rows['rt-out'].cls) && /credit/.test(r.perGameCls), 'green classes');
    const paid = await page.evaluate(() => getComputedStyle(document.querySelector('[data-card="so-far"] [data-row="players"] dd')).color);
    assert(r.rows['rt-out'].color === paid, `same green as the other cards: ${r.rows['rt-out'].color} vs ${paid}`);
    assert(!/[−-]/.test(r.text.replace(/\s/g, '')), `no minus sign: ${r.text}`);
    await ctx.close();
  });

  // ---------------------------------------------------------------- the fake world's real numbers
  await check("the fake world (a year of months): Out of pocket = the So far card + every Month by month row; months, games and both averages follow", async () => {
    const { ctx, page } = await openTotals();
    await openFold(page, 'running-total');
    await openFold(page, 'month-by-month');
    const rows = await page.evaluate(() => [...document.querySelectorAll('[data-month-row]')].map((r) => ({ m: r.getAttribute('data-month-row'), net: Number(r.querySelector('[data-month-net]').getAttribute('data-month-net')), sub: r.querySelectorAll('.tr-mrow-sub')[0].textContent })));
    const soNet = Number(await page.locator('[data-card="so-far"] .tr-yn').getAttribute('data-total'));
    // Every month the server knows, straight from its own answers.
    const months = rows.map((r) => r.m).sort();
    assert(months.length >= 11 && months[0] <= '2026-01', `a year of past months: ${months}`);
    let membership = 0;
    let after = 0;
    let games = 0;
    // Zip 76: Totals also counts credit the organizer added by hand (Adjust credit: a cost in its month, the hand-credit row) and each ended
    // tournament's result (made money lowers what you are out of pocket). The per game figure is the regular games only (no tournaments).
    let hand = 0;
    let tourn = 0;
    for (const m of [...months, '2026-11']) {
      const rw = (await moneyOf(m)).rework;
      membership += rw.membershipCents;
      after += rw.courtCostCents - rw.collectedCents;
      games += rw.courtSessions;
      hand += rw.handCreditCents || 0;
      tourn -= (rw.tournaments || []).reduce((a, t) => a + t.resultCents, 0);
    }
    const regular = membership + after + hand;
    const out = regular + tourn;
    const sumRows = rows.reduce((a, r) => a + r.net, 0) + soNet;
    assert(out === sumRows, `server sum ${out} vs rows + So far ${sumRows}`);
    const n = months.length + 1;
    const r = await readRt(page);
    const dollars = (c) => (c < 0 ? `$${Math.abs(c) / 100} credit` : `$${c / 100}`);
    assert(r.rows['rt-membership'].value === `$${membership / 100}` && r.rows['rt-membership'].label === `Membership ${n} months`, JSON.stringify(r.rows['rt-membership']));
    assert(r.rows['rt-court'].label === `Court costs after players ${games} games`, r.rows['rt-court'].label);
    assert(r.rows['rt-out'].value === dollars(out), `out ${r.rows['rt-out'].value} vs ${dollars(out)}`);
    const avg = per(out, n);
    assert(r.rows['rt-average'].value === (avg < 0 ? `$${-avg} credit` : `$${avg}`), `avg ${r.rows['rt-average'].value} vs ${avg}`);
    const pg = per(regular, games);
    assert(r.perGame === (pg < 0 ? `$${-pg} credit` : `$${pg}`), `per game ${r.perGame} vs ${pg}`);
    assert(r.foot === 'Since Dec 2025', `a first month in an earlier year carries its year: ${r.foot}`);
    await ctx.close();
  });

  await check("another month picked in the month box (September): the Running total is still the whole run up to now, the same numbers", async () => {
    const a = await openTotals();
    await openFold(a.page, 'running-total');
    const before = await readRt(a.page);
    await a.page.locator('[data-month-box]').click();
    await a.page.locator('[data-month-option="2026-09"]').click();
    await a.page.waitForTimeout(700);
    const sf = await a.page.locator('[data-card="so-far"]').getAttribute('data-card');
    assert(sf === 'so-far', 'So far card is there');
    // (4 rows, plus Zip 76's hand-credit and Tournaments rows when the world has them)
    assert((await a.page.locator('[data-fold="running-total"] .tr-ln').count()) >= 4, 'still open with rows');
    const after = await readRt(a.page);
    assert(JSON.stringify(after.rows) === JSON.stringify(before.rows) && after.perGame === before.perGame && after.foot === before.foot, `unchanged\n${JSON.stringify(before.rows)}\n${JSON.stringify(after.rows)}`);
    await a.ctx.close();
  });

  await check('picking the current month while an older one is on screen: the open card never counts the old month\'s numbers as this month\'s (no wrong figure while it loads)', async () => {
    let slow = false;
    const a = await openTotals({ delay: { month: '2026-11', ms: 1500, on: () => slow } });
    await openFold(a.page, 'running-total');
    const right = (await readRt(a.page)).rows['rt-out'].value;
    await a.page.locator('[data-month-box]').click();
    await a.page.locator('[data-month-option="2026-09"]').click();
    await a.page.waitForTimeout(700);
    slow = true;
    await a.page.locator('[data-month-box]').click();
    await a.page.locator('[data-month-option="2026-11"]').click();
    const seen = new Set();
    for (let i = 0; i < 14; i++) {
      const v = await a.page.evaluate(() => document.querySelector('[data-fold="running-total"] [data-row="rt-out"] dd')?.textContent ?? null);
      if (v !== null) seen.add(v);
      await a.page.waitForTimeout(100);
    }
    assert([...seen].every((v) => v === right), `while the month loads the card showed ${[...seen]} (right answer ${right})`);
    await a.page.waitForTimeout(1200);
    assert((await readRt(a.page)).rows['rt-out'].value === right, 'right when loaded');
    await a.ctx.close();
  });

  // ---------------------------------------------------------------- fit
  for (const width of [360, 390, 420]) {
    for (const scheme of ['light', 'dark']) {
      await check(`${width} wide, ${scheme}: Running total open next to the other cards, no text wraps, clips or overlaps, no sideways scroll`, async () => {
        const { ctx, page, errors } = await openTotals({ ...ALEX_OPTS, width, scheme, height: 1000 });
        await openFold(page, 'running-total');
        const f = await page.evaluate(() => {
          const el = document.querySelector('[data-fold="running-total"]');
          const bad = [];
          const lineOf = (n) => parseFloat(getComputedStyle(n).lineHeight) || parseFloat(getComputedStyle(n).fontSize) * 1.3;
          for (const n of el.querySelectorAll('dt, dd, em, small, .tr-t, .tr-yp, .tr-yn')) {
            const r = n.getBoundingClientRect();
            if (r.height > lineOf(n) * 1.6 + 1) bad.push(`wraps: ${n.textContent.trim()} (${Math.round(r.height)}px)`);
            if (n.scrollWidth > n.clientWidth + 1 && getComputedStyle(n).display !== 'inline') bad.push(`clips: ${n.textContent.trim()}`);
          }
          const card = el.getBoundingClientRect();
          for (const n of el.querySelectorAll('.tr-ln dd, .tr-yn')) if (n.getBoundingClientRect().right > card.right - 8) bad.push(`too close to the edge: ${n.textContent}`);
          for (const row of el.querySelectorAll('.tr-ln')) {
            const a = row.querySelector('dt').getBoundingClientRect();
            const b = row.querySelector('dd').getBoundingClientRect();
            if (a.right > b.left + 1 || a.height > 30) bad.push(`label meets number: ${row.textContent}`);
          }
          return { bad, scrollX: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1, theme: getComputedStyle(document.body).backgroundColor };
        });
        assert(f.bad.length === 0, f.bad.join(' | '));
        assert(!f.scrollX, 'sideways scroll');
        assert(errors.length === 0, `page errors: ${errors}`);
        await page.screenshot({ path: path.join(SHOTS, `zip54-open-${width}-${scheme}.png`) });
        await openFold(page, 'running-total');
        await page.screenshot({ path: path.join(SHOTS, `zip54-closed-${width}-${scheme}.png`) });
        await ctx.close();
      });
    }
  }

  await browser.close();
  console.log(`\nzip54: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
