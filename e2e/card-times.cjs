/* The time under the date tile on the player's game cards.
 *
 *   node e2e/card-times.cjs      (also run by npm run test:e2e)
 *
 * Only the START time shows ("7 PM", "7:30 PM", "10:30 AM"), so it always fits
 * under the tile. A game that is not the usual length from Settings also shows
 * where it ends, on a second short line, so nobody is misled. Checked at an
 * iPhone width (393 px, plus 360 and 430) on the big, next-week and LATER cards:
 * nothing overlaps the names, status or Drop out link, the text fits inside the
 * tile's column, the tiles line up from row to row, and the time sits centered
 * under its tile. Starts its own dev server with a fresh fake group.
 */
const { spawn } = require('node:child_process');
const { rmSync, mkdirSync } = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.E2E_PORT) || 5195;
const BASE = `http://localhost:${PORT}`;
const SETUP_TOKEN = 'cardtimes-setup-token-0123456789';
const PIN = '482913';
const NAMES = ['Alex', 'Ryan', 'Julian', 'Nathan', 'Mitchel', 'Brandon', 'Christopher', 'Bartholomew'];
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

/** Games, in order: start (minutes from the usual 8:00 PM start), length in minutes, and what the card should show. */
const PLAN = [
  { from: -60, len: 120, start: '7 PM', end: null }, // 7:00 PM
  { from: -30, len: 120, start: '7:30 PM', end: null }, // 7:30 PM
  { from: -570, len: 120, start: '10:30 AM', end: null }, // 10:30 AM
  { from: 0, len: 90, start: '8 PM', end: '9:30 PM' }, // not the usual length
  { from: -30, len: 150, start: '7:30 PM', end: '10 PM' }, // not the usual length, half-hour start
  { from: 0, len: 120, start: '8 PM', end: null }, // the usual game
  { from: -570, len: 180, start: '10:30 AM', end: '1:30 PM' }, // the widest text
  { from: -30, len: 120, start: '7:30 PM', end: null },
  { from: -60, len: 90, start: '7 PM', end: '8:30 PM' },
  { from: -570, len: 120, start: '10:30 AM', end: null },
];

let passed = 0;
let failed = 0;
async function check(name, fn) {
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

/** Everything about every card's time and layout, measured in the page. */
const report = (page) =>
  page.evaluate(() => {
    const textBox = (el) => {
      const r = document.createRange();
      r.selectNodeContents(el);
      const b = r.getBoundingClientRect();
      return { left: b.left, right: b.right, top: b.top, bottom: b.bottom };
    };
    const meets = (a, b) => a.left < b.right - 0.5 && a.right > b.left + 0.5 && a.top < b.bottom - 0.5 && a.bottom > b.top + 0.5;
    return [...document.querySelectorAll('.schedule article.sched')].map((card) => {
      const col = card.querySelector('.sched-tilecol').getBoundingClientRect();
      const tile = card.querySelector('.tile').getBoundingClientRect();
      const timeEl = card.querySelector('.sched-time');
      const lines = [...timeEl.querySelectorAll('span')].map((s) => ({ text: s.textContent, box: textBox(s) }));
      // Everything else on the card: text and controls outside the tile column.
      const others = [...card.querySelectorAll('*')]
        .filter((el) => !el.closest('.sched-tilecol') && (el.matches('button, a, input') || (el.children.length === 0 && el.textContent.trim() && !el.closest('svg'))))
        .filter((el) => { const b = el.getBoundingClientRect(); return b.width > 0 && b.height > 0; });
      const hits = [];
      for (const l of lines) for (const o of others) if (meets(l.box, o.getBoundingClientRect())) hits.push(`"${l.text}" overlaps ${o.tagName.toLowerCase()}.${o.className || ''} "${o.textContent.trim().slice(0, 24)}"`);
      const cardBox = card.getBoundingClientRect();
      return {
        tier: card.dataset.tier,
        lines: lines.map((l) => l.text),
        fits: lines.every((l) => l.box.left >= col.left - 0.5 && l.box.right <= col.right + 0.5),
        widest: Math.max(...lines.map((l) => l.box.right - l.box.left)),
        colWidth: col.width,
        centered: lines.every((l) => Math.abs((l.box.left + l.box.right) / 2 - (tile.left + tile.right) / 2) <= 3),
        belowTile: lines[0].box.top >= tile.bottom - 1,
        insideCard: lines.every((l) => l.box.left >= cardBox.left && l.box.right <= cardBox.right),
        tileLeft: Math.round(tile.left * 10) / 10,
        tileWidth: Math.round(tile.width * 10) / 10,
        hits,
        pageOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
      };
    });
  });

async function main() {
  const dbFile = path.join(ROOT, '.data', 'cardtimes.sqlite');
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
  await fetch(`${BASE}/__dev/clock`, { method: 'POST', body: JSON.stringify({ atMs: Date.now() }) });

  const browser = await chromium.launch();
  const post = (req, url, data) => req.post(BASE + url, { data, headers: { Origin: BASE } });
  const put = (req, url, data) => req.put(BASE + url, { data, headers: { Origin: BASE } });
  const setup = (await browser.newContext()).request;
  const made = await post(setup, '/api/setup', {
    setupToken: SETUP_TOKEN,
    groupName: 'Pickleball Bros',
    pin: PIN,
    venmoUrl: 'https://venmo.com/u/organizer',
    players: NAMES.map((name, i) => ({ name, phone: `24855504${String(i).padStart(2, '0')}` })),
  });
  if (!made.ok()) throw new Error(`setup failed: ${await made.text()}`);
  const areq = (await browser.newContext()).request;
  await post(areq, '/api/admin/login', { pin: PIN });
  let d = await (await areq.get(`${BASE}/api/admin/dashboard`)).json();
  for (const h of d.hiddenSessions || []) await post(areq, `/api/admin/sessions/${h.id}/show`, { shown: true });
  d = await (await areq.get(`${BASE}/api/admin/dashboard`)).json();
  const games = d.sessions.filter((s) => !s.state.flags.past).slice(0, PLAN.length);
  for (const [i, s] of games.entries()) {
    await post(areq, `/api/admin/sessions/${s.id}/booked`, {});
    const start = Date.parse(s.startsAt) + PLAN[i].from * 60_000;
    const r = await put(areq, `/api/admin/sessions/${s.id}/time`, { startsAt: new Date(start).toISOString(), endsAt: new Date(start + PLAN[i].len * 60_000).toISOString() });
    if (!r.ok()) throw new Error(`reschedule ${i} failed: ${await r.text()}`);
  }
  const idOf = (n) => d.players.find((p) => p.name === n).id;
  // Brandon is in every game (like the "You're in" cards with names and a Drop out link); a few have company, with long names.
  const phones = {};
  for (const n of ['Brandon', 'Julian', 'Christopher', 'Bartholomew']) {
    const c = await browser.newContext();
    await post(c.request, '/api/me', { playerId: idOf(n) });
    phones[n] = c.request;
  }
  for (const [i, s] of games.entries()) {
    await post(phones.Brandon, `/api/sessions/${s.id}/join`, {});
    if (i % 2 === 0) await post(phones.Christopher, `/api/sessions/${s.id}/join`, {});
    if (i % 3 === 0) await post(phones.Bartholomew, `/api/sessions/${s.id}/join`, {});
  }

  const phone = (width, colorScheme) => ({ viewport: { width, height: 852 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme, userAgent: UA });
  async function open(who, width, scheme = 'light') {
    const ctx = await browser.newContext(phone(width, scheme));
    await post(ctx.request, '/api/me', { playerId: idOf(who) });
    const page = await ctx.newPage();
    await page.goto(BASE);
    await page.locator('.schedule article.sched').first().waitFor();
    const more = page.getByRole('button', { name: /^More sessions/ });
    if (await more.count()) await more.click();
    await page.waitForFunction((n) => document.querySelectorAll('.schedule article.sched').length >= n, PLAN.length);
    return { ctx, page };
  }

  const WIDTHS = [393, 360, 430];
  for (const width of WIDTHS) {
    for (const scheme of width === 393 ? ['light', 'dark'] : ['light']) {
      await check(`${width}px (${scheme}): each card shows only the start time, plus the end for a game of another length`, async () => {
        const { ctx, page } = await open('Brandon', width, scheme);
        const rows = (await report(page)).slice(0, PLAN.length); // the games after these keep their usual time
        assert(rows.length === PLAN.length, `expected ${PLAN.length} cards, saw ${rows.length}`);
        rows.forEach((r, i) => {
          const want = PLAN[i].end ? [PLAN[i].start, `–${PLAN[i].end}`] : [PLAN[i].start];
          assert(JSON.stringify(r.lines) === JSON.stringify(want), `card ${i + 1} (${r.tier}): showed ${JSON.stringify(r.lines)}, want ${JSON.stringify(want)}`);
        });
        await ctx.close();
      });
      await check(`${width}px (${scheme}): the time fits under the tile, centered, with nothing overlapping it, on every kind of card`, async () => {
        const { ctx, page } = await open('Brandon', width, scheme);
        const rows = await report(page);
        const tiers = new Set(rows.map((r) => r.tier));
        assert(tiers.size >= 2, `only ${[...tiers]} cards on screen`);
        rows.forEach((r, i) => {
          const where = `card ${i + 1} (${r.tier}, ${JSON.stringify(r.lines)})`;
          assert(r.fits, `${where}: text ${r.widest.toFixed(1)}px wide runs past the ${r.colWidth}px tile column`);
          assert(r.hits.length === 0, `${where}: ${r.hits.join('; ')}`);
          assert(r.centered && r.belowTile && r.insideCard, `${where}: not centered under the tile (centered ${r.centered}, below ${r.belowTile}, inside ${r.insideCard})`);
          assert(!r.pageOverflow, `${where}: the page scrolls sideways`);
        });
        await ctx.close();
      });
      await check(`${width}px (${scheme}): the tiles line up from row to row`, async () => {
        const { ctx, page } = await open('Brandon', width, scheme);
        const rows = await report(page);
        for (const tier of new Set(rows.map((r) => r.tier))) {
          const same = rows.filter((r) => r.tier === tier);
          assert(new Set(same.map((r) => r.tileLeft)).size === 1, `${tier}: tile left edges differ ${[...new Set(same.map((r) => r.tileLeft))]}`);
          assert(new Set(same.map((r) => r.tileWidth)).size === 1, `${tier}: tile widths differ ${[...new Set(same.map((r) => r.tileWidth))]}`);
        }
        await ctx.close();
      });
    }
  }

  await check('the usual length comes from Settings: with a 90-minute usual game the 8 to 9:30 PM game shows only its start, and a 2-hour game shows its end', async () => {
    const r = await put(areq, '/api/admin/group', { settings: { ...d.group.settings, defaultStartMinutes: 20 * 60, defaultEndMinutes: 20 * 60 + 90 } });
    assert(r.ok(), `settings: ${await r.text()}`);
    const { ctx, page } = await open('Brandon', 393);
    const rows = await report(page);
    assert(JSON.stringify(rows[3].lines) === JSON.stringify(['8 PM']), `the 90-minute game showed ${JSON.stringify(rows[3].lines)}`);
    assert(JSON.stringify(rows[5].lines) === JSON.stringify(['8 PM', '–10 PM']), `the 2-hour game showed ${JSON.stringify(rows[5].lines)}`);
    rows.forEach((x, i) => assert(x.fits && x.hits.length === 0, `card ${i + 1}: fits ${x.fits} ${x.hits.join('; ')}`));
    await ctx.close();
    await put(areq, '/api/admin/group', { settings: { ...d.group.settings } });
  });

  await browser.close();
  console.log(`\ncard-times: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
