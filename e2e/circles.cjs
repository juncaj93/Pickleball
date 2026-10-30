/* The pickleball circles on every session card, 0 to 10 in plus a waitlist,
 * on the player screen and the organizer Home, at 360, 375, 390 and 430 px,
 * light and dark.
 *
 *   node e2e/circles.cjs
 *
 * Starts its own dev server with a fresh fake group. Nothing here touches the
 * live site.
 */
const { spawn } = require('node:child_process');
const { rmSync, mkdirSync } = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const PORT = 5193;
const BASE = `http://localhost:${PORT}`;
const SETUP_TOKEN = 'circles-setup-token-0123456789';
const PIN = '482913';
const NAMES = ['Alex', 'Alec', 'Armen', 'Ryan', 'Brandon', 'Julian', 'Mitchel', 'Nathan', 'Christopher', 'Bartholomew', 'Sam', 'Jo'];

let passed = 0;
let failed = 0;
async function check(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.log(`  ✗ ${name}\n      ${String(err && err.message ? err.message : err).slice(0, 600)}`);
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

/** Every "who's in" row on the page: its count text, how many rows of balls, and whether anything spills or drops a line. */
const rowsOf = (page, rowSel, countSel) =>
  page.evaluate(
    ([rowSel, countSel]) =>
      [...document.querySelectorAll(rowSel)].map((row) => {
        const kids = [...row.querySelectorAll('.dots > *')].map((c) => c.getBoundingClientRect());
        const r = row.getBoundingClientRect();
        const after = row.querySelector('.players-after');
        const a = after && after.getBoundingClientRect();
        const dots = row.querySelector('.dots').getBoundingClientRect();
        const card = getComputedStyle(row.closest('article'));
        const dot = row.querySelector('.dots .dot');
        return {
          text: row.querySelector(countSel).textContent.trim(),
          balls: row.querySelectorAll('.dots .ball').length,
          empties: row.querySelectorAll('.dots .dot').length,
          ballRows: new Set(kids.map((k) => Math.round((k.top + k.bottom) / 20))).size,
          spills: row.scrollWidth > row.clientWidth + 1 || r.right > window.innerWidth,
          // The organizer's own I'm in stays on the same line, at the right, clear of the balls.
          afterOnLine: !a || (a.top < r.top + 4 && a.bottom > r.bottom - 4),
          afterClear: !a || a.left >= dots.right - 0.5,
          dotBorder: dot ? getComputedStyle(dot).borderTopColor : null,
          // Flat LATER rows and canceled cards have no background of their own: use what is behind them.
          cardBg: (() => { for (let e = row; e; e = e.parentElement) { const c = getComputedStyle(e).backgroundColor; if (c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent') return c; } return getComputedStyle(document.body).backgroundColor; })(),
        };
      }),
    [rowSel, countSel],
  );

/** WCAG contrast of two rgb() colors. */
function contrast(a, b) {
  const lum = (c) => {
    const [r, g, bl] = c.match(/[\d.]+/g).slice(0, 3).map(Number).map((v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

function expectRow(row, where) {
  const m = row.text.match(/^(\d+)( of 4)? in(, full)?$/);
  assert(m, `${where}: count text "${row.text}"`);
  const n = Number(m[1]);
  assert(row.balls === n, `${where}: ${n} in but ${row.balls} balls`);
  assert(row.empties === Math.max(0, 4 - n), `${where}: ${row.empties} empty circles at ${n} in`);
  assert(!row.spills, `${where}: "${row.text}" spills past the card`);
  assert(row.ballRows <= 2, `${where}: balls on ${row.ballRows} rows`);
  if (n <= 4) assert(row.ballRows === 1, `${where}: "${row.text}" wraps onto a second row`);
  assert(row.afterOnLine, `${where}: "${row.text}": the I'm in button dropped to its own line`);
  assert(row.afterClear, `${where}: "${row.text}": the I'm in button covers the balls`);
  if (row.dotBorder) assert(contrast(row.dotBorder, row.cardBg) >= 3, `${where}: empty circle contrast ${contrast(row.dotBorder, row.cardBg).toFixed(2)} is under 3:1`);
  return n;
}

async function main() {
  const dbFile = path.join(ROOT, '.data', 'circles.sqlite');
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
  await fetch(`${BASE}/__dev/clock`, { method: 'POST', body: JSON.stringify({ atMs: Date.parse('2026-10-27T14:14:00-04:00') }) });

  const browser = await chromium.launch();
  const post = (req, url, data) => req.post(BASE + url, { data, headers: { Origin: BASE } });
  const setup = (await browser.newContext()).request;
  const made = await post(setup, '/api/setup', {
    setupToken: SETUP_TOKEN,
    groupName: 'Pickleball Bros',
    pin: PIN,
    venmoUrl: 'https://venmo.com/u/organizer',
    players: NAMES.map((name, i) => ({ name, phone: `24855501${String(i).padStart(2, '0')}` })),
  });
  if (!made.ok()) throw new Error(`setup failed: ${await made.text()}`);
  const areq = (await browser.newContext()).request;
  await post(areq, '/api/admin/login', { pin: PIN });
  let d = await (await areq.get(`${BASE}/api/admin/dashboard`)).json();
  for (const h of d.hiddenSessions || []) await post(areq, `/api/admin/sessions/${h.id}/show`, { shown: true });
  d = await (await areq.get(`${BASE}/api/admin/dashboard`)).json();
  const games = d.sessions.filter((s) => !s.state.flags.past);
  for (const s of games) await post(areq, `/api/admin/sessions/${s.id}/booked`, {});
  // Game k gets k people (Alec first; the organizer Alex stays out), the 12th gets 11: 10 in, Jo waiting.
  const phones = {};
  for (const n of NAMES.slice(1)) {
    const ctx = await browser.newContext();
    await post(ctx.request, '/api/me', { playerId: d.players.find((p) => p.name === n).id });
    phones[n] = ctx.request;
  }
  const wanted = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
  for (let k = 0; k < Math.min(games.length, wanted.length); k++)
    for (const n of NAMES.slice(1, 1 + wanted[k])) await post(phones[n], `/api/sessions/${games[k].id}/join`, {});

  const phone = (width, colorScheme) => ({
    viewport: { width, height: 844 },
    deviceScaleFactor: 1,
    isMobile: true,
    hasTouch: true,
    colorScheme,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  });

  for (const width of [360, 375, 390, 430]) {
    for (const scheme of ['light', 'dark']) {
      await check(`player at ${width}px (${scheme}): 0 to 10 in and the waitlist`, async () => {
        const ctx = await browser.newContext(phone(width, scheme));
        await post(ctx.request, '/api/me', { playerId: d.players.find((p) => p.name === 'Ryan').id });
        const page = await ctx.newPage();
        await page.goto(BASE);
        await page.locator('.schedule article').first().waitFor();
        const more = page.getByRole('button', { name: /^More sessions/ });
        if (await more.count()) await more.click();
        const rows = await rowsOf(page, '.schedule .in-line', '.in-count');
        const seen = rows.map((r, i) => expectRow(r, `card ${i + 1}`));
        for (const n of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) assert(seen.includes(n), `no card with ${n} in (saw ${seen})`);
        assert(rows.filter((r) => r.text === '10 in, full').length === 2, 'two full games (one with a waitlist)');
        await page.getByText('Waitlist: Jo').waitFor();
        await ctx.close();
      });
      await check(`organizer at ${width}px (${scheme}): 0 to 10 in, I'm in stays on the line`, async () => {
        const ctx = await browser.newContext(phone(width, scheme));
        await post(ctx.request, '/api/admin/login', { pin: PIN });
        const page = await ctx.newPage();
        await page.goto(`${BASE}/admin`);
        await page.locator('section[aria-labelledby="sessions-title"] article').first().waitFor();
        const all = page.getByRole('button', { name: /^Show all/ });
        if (await all.count()) await all.click();
        const rows = await rowsOf(page, 'section[aria-labelledby="sessions-title"] .players-top', '.players-count');
        const seen = rows.map((r, i) => expectRow(r, `card ${i + 1}`));
        // This week's games sit above the list on the organizer Home, so the 1-in game isn't here.
        for (const n of [0, 2, 3, 4, 5, 6, 7, 8, 9, 10]) assert(seen.includes(n), `no card with ${n} in (saw ${seen})`);
        await ctx.close();
      });
    }
  }

  await check('the 10th person in does not make the organizer card taller (360px)', async () => {
    const ctx = await browser.newContext(phone(360, 'light'));
    await post(ctx.request, '/api/admin/login', { pin: PIN });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/admin`);
    await page.locator('section[aria-labelledby="sessions-title"] article').first().waitFor();
    const all = page.getByRole('button', { name: /^Show all/ });
    if (await all.count()) await all.click();
    const nine = games[9].id;
    const heightOf = () => page.locator(`#session-${nine} .players-top`).evaluate((el) => el.getBoundingClientRect().height);
    const before = await heightOf();
    await post(phones.Sam, `/api/sessions/${nine}/join`, {});
    await page.reload();
    await page.locator('section[aria-labelledby="sessions-title"] article').first().waitFor();
    if (await all.count()) await all.click();
    await page.locator(`#session-${nine} .players-count`, { hasText: '10 in, full' }).waitFor();
    const after = await heightOf();
    assert(Math.abs(after - before) <= 1, `row height went from ${before}px to ${after}px`);
    await ctx.close();
  });

  await check('balls spring in when someone joins, and stay still under Reduce Motion', async () => {
    for (const reducedMotion of ['no-preference', 'reduce']) {
      const ctx = await browser.newContext({ ...phone(390, 'light'), reducedMotion });
      await post(ctx.request, '/api/me', { playerId: d.players.find((p) => p.name === 'Ryan').id });
      const page = await ctx.newPage();
      await page.goto(BASE);
      await page.locator('.schedule .dots .ball').first().waitFor();
      const anim = await page.evaluate(() => getComputedStyle(document.querySelector('.schedule .dots .ball')).animationName);
      if (reducedMotion === 'reduce') assert(anim === 'none', `Reduce Motion still animates (${anim})`);
      else assert(anim === 'spot-pop', `no spring when someone joins (${anim})`);
      await ctx.close();
    }
  });

  await browser.close();
  console.log(`\ncircles: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
