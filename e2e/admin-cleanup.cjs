/* The organizer cleanup: game cards, the court switch, the gear pop-up, Edit game, the paid pill,
 * the cancel-by warning and the organizer's live updates.
 * A fake group on a throwaway dev server; nothing here touches the live site.
 *
 *   node e2e/admin-cleanup.cjs      (also run by npm run test:e2e)
 *
 * Checked at phone widths (360, 393, 430) in light and dark mode.
 */
const { spawn } = require('node:child_process');
const { rmSync, mkdirSync } = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.E2E_PORT) || 5270;
const BASE = `http://localhost:${PORT}`;
const SETUP_TOKEN = 'admincleanup-setup-token-0123456789';
const PIN = '482913';
const NAMES = ['Alex', 'Ryan', 'Julian', 'Nathan', 'Mitchel', 'Brandon', 'Christopher', 'Bartholomew', 'Maximilian', 'Wilhelmina', 'Anastasia'];
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const SHOTS = path.join(__dirname, 'screenshots');

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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const HOUR = 3600_000;

const CARDS = 'section[aria-labelledby="sessions-title"] article.scard';

async function main() {
  const dbFile = path.join(ROOT, '.data', 'admincleanup.sqlite');
  mkdirSync(path.join(ROOT, '.data'), { recursive: true });
  mkdirSync(SHOTS, { recursive: true });
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
    await sleep(500);
  }
  const now = Date.now();
  await fetch(`${BASE}/__dev/clock`, { method: 'POST', body: JSON.stringify({ atMs: now }) });

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
  const dash = async () => (await areq.get(`${BASE}/api/admin/dashboard`)).json();
  let d = await dash();
  for (const h of d.hiddenSessions || []) await post(areq, `/api/admin/sessions/${h.id}/show`, { shown: true });
  d = await dash();
  const idOf = (n) => d.players.find((p) => p.name === n).id;

  // Eight upcoming games, each moved to a start time of its own.
  //   0 booked, 3 in, 2 paid, 7:30 PM, far out        4 waitlist, 10:30 AM
  //   1 not booked, 1 in, 7 PM                         5 cancel-by in about 8 hours (red line), starts in ~20 hours
  //   2 booked, nobody in                              6 starts in ~60 hours: no red line
  //   3 waitlist, 2 in
  const games = d.sessions.filter((s) => !s.state.flags.past).slice(0, 8);
  const at = (s, h, m, plusDays) => {
    const base = new Date(Date.parse(s.startsAt));
    const local = new Date(base.toLocaleString('en-US', { timeZone: 'America/Detroit' }));
    const delta = (h - local.getHours()) * HOUR + (m - local.getMinutes()) * 60_000 + plusDays * 24 * HOUR;
    return Date.parse(s.startsAt) + delta;
  };
  const plan = [
    { h: 19, m: 30 },
    { h: 19, m: 0 },
    { h: 19, m: 0 },
    { h: 20, m: 0 },
    { h: 10, m: 30 },
    { abs: now + 20 * HOUR },
    { abs: now + 60 * HOUR },
    { h: 19, m: 0 },
  ];
  for (const [i, s] of games.entries()) {
    const start = plan[i].abs ?? at(s, plan[i].h, plan[i].m, 0);
    const r = await put(areq, `/api/admin/sessions/${s.id}/time`, { startsAt: new Date(start).toISOString(), endsAt: new Date(start + 2 * HOUR).toISOString() });
    if (!r.ok() && r.status() !== 409) throw new Error(`move ${i} failed: ${await r.text()}`);
  }
  d = await dash();
  const byTime = d.sessions.filter((s) => !s.state.flags.past);
  const phones = {};
  for (const n of ['Alex', 'Ryan', 'Julian', 'Nathan', 'Brandon']) {
    const c = await browser.newContext();
    await post(c.request, '/api/me', { playerId: idOf(n) });
    phones[n] = c.request;
  }
  // Set each game's court state with the new switch itself.
  const court = (id, status) => post(areq, `/api/admin/sessions/${id}/court-status`, { status });
  // Give each game a job by its start time.
  const order = byTime.slice(0, 8).map((s) => s.id);
  const roles = {};
  const sorted = byTime.slice(0, 8);
  roles.redLine = sorted.find((s) => Math.abs(Date.parse(s.startsAt) - (now + 20 * HOUR)) < 2 * HOUR).id;
  roles.noRed = sorted.find((s) => Math.abs(Date.parse(s.startsAt) - (now + 60 * HOUR)) < 2 * HOUR).id;
  const rest = sorted.filter((s) => s.id !== roles.redLine && s.id !== roles.noRed).map((s) => s.id);
  [roles.paid, roles.notBooked, roles.bookedEmpty, roles.waitA, roles.waitB, roles.spare] = rest;

  await court(roles.paid, 'booked');
  for (const n of ['Alex', 'Ryan', 'Julian']) await post(phones[n], `/api/sessions/${roles.paid}/join`, {});
  for (const n of ['Alex', 'Ryan']) await post(areq, `/api/admin/sessions/${roles.paid}/payment`, { playerId: idOf(n), paid: true });
  await post(phones.Nathan, `/api/sessions/${roles.notBooked}/join`, {});
  await court(roles.bookedEmpty, 'booked');
  await court(roles.waitA, 'waitlist');
  for (const n of ['Alex', 'Ryan']) await post(phones[n], `/api/sessions/${roles.waitA}/join`, {});
  await court(roles.waitB, 'waitlist');
  await court(roles.redLine, 'booked');
  // A booked game with long names, so the names line wraps to two or three lines.
  await court(roles.spare, 'booked');
  for (const n of ['Bartholomew', 'Maximilian', 'Wilhelmina', 'Anastasia', 'Christopher']) {
    const c = await browser.newContext();
    await post(c.request, '/api/me', { playerId: idOf(n) });
    await post(c.request, `/api/sessions/${roles.spare}/join`, {});
  }

  const phone = (width, colorScheme) => ({ viewport: { width, height: 852 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme, userAgent: UA });
  async function openAdmin(width = 393, scheme = 'light') {
    const ctx = await browser.newContext(phone(width, scheme));
    await post(ctx.request, '/api/admin/login', { pin: PIN });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/admin`);
    await page.locator(CARDS).first().waitFor();
    const all = page.getByRole('button', { name: /^Show all/ });
    if (await all.count()) await all.click();
    return { ctx, page };
  }
  const card = (page, id) => page.locator(`#session-${id}`);

  // ---------- layout: tile, time under it, switch, at phone widths in both themes ----------
  const LAYOUT = (page) =>
    page.evaluate((sel) => {
      const meets = (a, b) => a.left < b.right - 0.5 && a.right > b.left + 0.5 && a.top < b.bottom - 0.5 && a.bottom > b.top + 0.5;
      const textBox = (el) => {
        const r = document.createRange();
        r.selectNodeContents(el);
        const b = r.getBoundingClientRect();
        return { left: b.left, right: b.right, top: b.top, bottom: b.bottom };
      };
      return [...document.querySelectorAll(sel)].map((c) => {
        const col = c.querySelector('.scard-tilecol').getBoundingClientRect();
        const tile = c.querySelector('.tile').getBoundingClientRect();
        const time = c.querySelector('[data-card-time]');
        const tb = textBox(time);
        const sw = c.querySelector('.court-switch');
        const segs = sw ? [...sw.querySelectorAll('button')] : [];
        const cardBox = c.getBoundingClientRect();
        const everything = [...c.querySelectorAll('button, a, input')].filter((e) => !e.closest('.scard-tilecol') && e.getBoundingClientRect().width > 0);
        const hits = everything.filter((e) => meets(tb, e.getBoundingClientRect())).map((e) => e.textContent.trim().slice(0, 20));
        const swBox = sw ? sw.getBoundingClientRect() : null;
        const clipped = segs.filter((b) => b.scrollWidth > b.clientWidth + 1).map((b) => b.textContent);
        const small = [...c.querySelectorAll('button, a')]
          .filter((e) => e.getBoundingClientRect().width > 0 && !e.closest('.game-note') && !e.matches('.icon-round, .me-in'))
          .filter((e) => !e.closest('.paid-pill') && e.getBoundingClientRect().height < 43.5)
          .map((e) => `${e.textContent.trim().slice(0, 18)} ${Math.round(e.getBoundingClientRect().height)}px`);
        return {
          id: c.id,
          time: time.textContent.trim(),
          fits: tb.left >= col.left - 0.5 && tb.right <= col.right + 0.5,
          oneLine: tb.bottom - tb.top < parseFloat(getComputedStyle(time).fontSize) * 1.6,
          centered: Math.abs((tb.left + tb.right) / 2 - (tile.left + tile.right) / 2) <= 3,
          below: tb.top >= tile.bottom - 1,
          hits,
          hasEnd: /[–-]/.test(time.textContent),
          switchOk: !sw || (swBox.right <= cardBox.right + 0.5 && swBox.left >= cardBox.left - 0.5),
          clipped,
          small,
          overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
        };
      });
    }, CARDS);

  for (const width of [393, 360, 430]) {
    for (const scheme of width === 393 ? ['light', 'dark'] : ['light']) {
      await check(`${width}px (${scheme}): the date tile has the start time under it, on one line, no end time, nothing overlapping`, async () => {
        const { ctx, page } = await openAdmin(width, scheme);
        const rows = await LAYOUT(page);
        assert(rows.length >= 7, `only ${rows.length} cards`);
        const times = rows.map((r) => r.time);
        for (const t of ['7:30 PM', '7 PM', '10:30 AM', '8 PM']) assert(times.includes(t), `no card shows "${t}": ${times.join(', ')}`);
        rows.forEach((r, i) => {
          const w = `card ${i + 1} ("${r.time}")`;
          assert(r.fits && r.oneLine, `${w}: time does not fit one line under the tile`);
          assert(r.centered && r.below, `${w}: not centered under the tile`);
          assert(r.hits.length === 0, `${w}: overlaps ${r.hits.join(', ')}`);
          assert(!r.hasEnd, `${w}: prints an end time`);
          assert(r.switchOk && r.clipped.length === 0, `${w}: the switch runs outside the card or clips ${r.clipped}`);
          assert(r.small.length === 0, `${w}: tap targets under 44px: ${r.small.join('; ')}`);
          assert(!r.overflow, `${w}: the page scrolls sideways`);
        });
        await page.screenshot({ path: path.join(SHOTS, `admin-cards-${width}-${scheme}.png`), fullPage: false });
        await ctx.close();
      });
    }
  }

  // ---------- the switch ----------
  await check('every live game card has the always-visible Not booked | Waitlist | Booked switch, and no old blue court block', async () => {
    const { ctx, page } = await openAdmin();
    const n = await page.locator(CARDS).count();
    assert((await page.locator(`${CARDS} .court-switch`).count()) === n, 'a card has no switch');
    for (const id of [roles.paid, roles.notBooked, roles.waitA]) {
      const segs = (await card(page, id).locator('.court-switch button').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim());
      assert(JSON.stringify(segs) === JSON.stringify(['Not booked', 'Waitlist', 'Booked']), `segments ${segs}`);
    }
    assert((await page.locator('.court-banner').count()) === 0, 'the old court banner is still on a card');
    assert((await page.getByText(/Not available|Court waitlist|Edit booking|Modify court/).count()) === 0, 'old wording is still on screen');
    await ctx.close();
  });

  await check('the right segment is on for booked, not booked and waitlist games (old third value reads as Waitlist)', async () => {
    const { ctx, page } = await openAdmin();
    const on = async (id) => (await card(page, id).locator('.court-switch button[aria-pressed="true"]').innerText()).replace(/\s+/g, ' ').trim();
    assert((await on(roles.paid)) === 'Booked', 'booked');
    assert((await on(roles.notBooked)) === 'Not booked', 'not booked');
    assert((await on(roles.waitA)) === 'Waitlist', 'waitlist');
    await ctx.close();
  });

  await check('one tap changes it, it saves, and it is still there after a reload', async () => {
    const { ctx, page } = await openAdmin();
    const c = card(page, roles.notBooked);
    await c.getByRole('button', { name: 'Waitlist', exact: true }).click();
    await page.waitForFunction((id) => document.querySelector(`#session-${id} .court-switch button[aria-pressed="true"]`)?.textContent.trim() === 'Waitlist', roles.notBooked);
    await page.reload();
    await page.locator(CARDS).first().waitFor();
    assert((await card(page, roles.notBooked).locator('.court-switch button[aria-pressed="true"]').innerText()) === 'Waitlist', 'waitlist did not survive a reload');
    assert((await dash()).sessions.find((s) => s.id === roles.notBooked).bookingStatus === 'unavailable', 'the stored value should be the existing third value');
    await card(page, roles.notBooked).getByRole('button', { name: 'Booked', exact: true }).click();
    await page.waitForFunction((id) => document.querySelector(`#session-${id} .court-switch button[aria-pressed="true"]`)?.textContent === 'Booked', roles.notBooked);
    await card(page, roles.notBooked).getByRole('button', { name: 'Not booked', exact: true }).click();
    await page.waitForFunction((id) => document.querySelector(`#session-${id} .court-switch button[aria-pressed="true"]`)?.textContent === 'Not booked', roles.notBooked);
    await page.reload();
    await page.locator(CARDS).first().waitFor();
    assert((await card(page, roles.notBooked).locator('.court-switch button[aria-pressed="true"]').innerText()).replace(/\s+/g, ' ').trim() === 'Not booked', 'not booked did not survive a reload');
    await ctx.close();
  });

  for (const scheme of ['light', 'dark']) {
    await check(`(${scheme}) the chosen segment is filled, readable (4.5:1 or better) and told apart by color; Waitlist is blue and Booked is green`, async () => {
      const { ctx, page } = await openAdmin(393, scheme);
      const read = await page.evaluate(
        ([a, b, c]) => {
          const lum = (rgb) => {
            const v = rgb.map((x) => {
              x /= 255;
              return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
            });
            return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
          };
          const parse = (s) => (s.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
          const ratio = (fg, bg) => {
            const [x, y] = [lum(parse(fg)), lum(parse(bg))];
            return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
          };
          return [a, b, c].map((id) => {
            const on = document.querySelector(`#session-${id} .court-switch button[aria-pressed="true"]`);
            const off = document.querySelector(`#session-${id} .court-switch button[aria-pressed="false"]`);
            const cs = getComputedStyle(on);
            const track = getComputedStyle(on.parentElement).backgroundColor;
            return { seg: on.textContent, bg: cs.backgroundColor, ratio: ratio(cs.color, cs.backgroundColor), vsTrack: ratio(cs.backgroundColor, track), offRatio: ratio(getComputedStyle(off).color, track), rgb: parse(cs.backgroundColor) };
          });
        },
        [roles.notBooked, roles.waitA, roles.paid],
      );
      for (const r of read) {
        assert(r.ratio >= 4.5, `${r.seg}: text ${r.ratio.toFixed(2)}:1 on ${r.bg}`);
        assert(r.vsTrack >= 1.5, `${r.seg}: the fill hardly differs from the track (${r.vsTrack.toFixed(2)}:1)`);
        assert(r.offRatio >= 4.5, `${r.seg}: unselected text ${r.offRatio.toFixed(2)}:1`);
      }
      const [, wait, booked] = read;
      assert(wait.rgb[2] > wait.rgb[0] && wait.rgb[2] > wait.rgb[1], `Waitlist should be blue, got ${wait.bg}`);
      assert(booked.rgb[1] > booked.rgb[0] && booked.rgb[1] >= booked.rgb[2], `Booked should be green, got ${booked.bg}`);
      await page.screenshot({ path: path.join(SHOTS, `admin-switch-${scheme}.png`) });
      await ctx.close();
    });
  }

  // ---------- the gear pop-up ----------
  await check('the gear opens a small pop-up next to it with the five rows in order; Cancel is red, last and apart', async () => {
    const { ctx, page } = await openAdmin();
    const c = card(page, roles.paid);
    await c.getByRole('button', { name: /^Game menu for/ }).click();
    const menu = page.getByRole('menu');
    await menu.waitFor();
    const rows = (await menu.getByRole('menuitem').allInnerTexts()).map((t) => t.trim());
    assert(JSON.stringify(rows) === JSON.stringify(['Text the group', 'Edit game', 'Players', 'Add to calendar', 'Cancel session']), `rows: ${rows}`);
    const gear = await c.getByRole('button', { name: /^Game menu for/ }).boundingBox();
    const box = await menu.boundingBox();
    assert(Math.abs(box.x + box.width - (gear.x + gear.width)) < 16, `not anchored to the gear (menu right ${box.x + box.width}, gear right ${gear.x + gear.width})`);
    assert(box.y >= gear.y + gear.height - 4 && box.y - (gear.y + gear.height) < 20, 'not directly under the gear');
    assert(box.width < 300, `menu is ${box.width}px wide, that is a sheet, not a pop-up`);
    const cancel = menu.getByRole('menuitem', { name: 'Cancel session' });
    const color = await cancel.evaluate((e) => getComputedStyle(e).color);
    const [r, g, b] = color.match(/[\d.]+/g).map(Number);
    assert(r > g + 30 && r > b + 30, `Cancel session should be red, got ${color}`);
    const heights = await menu.getByRole('menuitem').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
    assert(heights.every((h) => h >= 43.5), `rows under 44px: ${heights}`);
    assert((await page.getByText(/Edit booking|Modify court/).count()) === 0, 'old menu rows are back');
    await page.screenshot({ path: path.join(SHOTS, 'admin-menu.png') });
    await ctx.close();
  });

  await check('Escape closes the menu and puts focus back on the gear; so does a tap outside; arrow keys move between rows', async () => {
    const { ctx, page } = await openAdmin();
    const c = card(page, roles.notBooked);
    const gear = c.getByRole('button', { name: /^Game menu for/ });
    await gear.click();
    await page.getByRole('menu').waitFor();
    const first = await page.evaluate(() => document.activeElement?.textContent?.trim());
    assert(first === 'Text the group', `focus should start on the first row, was "${first}"`);
    await page.keyboard.press('ArrowDown');
    assert((await page.evaluate(() => document.activeElement?.textContent?.trim())) === 'Edit game', 'ArrowDown');
    await page.keyboard.press('End');
    assert((await page.evaluate(() => document.activeElement?.textContent?.trim())) === 'Cancel session', 'End');
    await page.keyboard.press('Escape');
    await page.getByRole('menu').waitFor({ state: 'detached' });
    assert(await gear.evaluate((e) => e === document.activeElement), 'focus did not return to the gear');
    assert((await gear.getAttribute('aria-expanded')) === 'false', 'aria-expanded');
    await gear.click();
    await page.getByRole('menu').waitFor();
    await page.mouse.click(20, 400);
    await page.getByRole('menu').waitFor({ state: 'detached' });
    await ctx.close();
  });

  await check('Players opens the same players screen the pill opens; Edit game opens the one sheet', async () => {
    const { ctx, page } = await openAdmin();
    const c = card(page, roles.paid);
    await c.getByRole('button', { name: /^Game menu for/ }).click();
    await page.getByRole('menuitem', { name: 'Players' }).click();
    const title1 = await page.locator('dialog[open] h2').innerText();
    assert(/^Players/.test(title1), `title ${title1}`);
    await page.locator('dialog[open]').getByRole('button', { name: 'Close' }).click();
    await c.getByRole('button', { name: /of 3 paid/ }).click();
    const title2 = await page.locator('dialog[open] h2').innerText();
    assert(title2 === title1, `pill opened "${title2}", menu opened "${title1}"`);
    await ctx.close();
  });

  // ---------- even spacing on the cards, and one look for the switch ----------
  // Measures the visible rows of every card: top padding, gap count row to names, gap names to pill, bottom padding.
  const SPACING = (page, sel) =>
    page.evaluate((cardsSel) => {
      const r = (e) => e.getBoundingClientRect();
      return [...document.querySelectorAll(cardsSel)].map((c) => {
        const cb = r(c);
        const count = c.querySelector('.players-count');
        const names = c.querySelector('.names-line, .waitlist-line');
        const wait = c.querySelector('.waitlist-line');
        const pill = c.querySelector('.paid-pill > span');
        const sw = c.querySelector('.court-switch');
        const tile = c.querySelector('.scard-tilecol');
        const me = c.querySelector('.players-after .btn, .players-after .me-state');
        const top = Math.min(...[sw, c.querySelector('.court-line')].filter(Boolean).map((e) => r(e).top), r(tile).top);
        const bottoms = [pill, wait, names, count, me, c.querySelector('.cancel-by-soon')].filter(Boolean).map((e) => r(e).bottom);
        const lineH = names ? parseFloat(getComputedStyle(names).lineHeight) : 0;
        const rows = {
          topPad: top - cb.top,
          switchToCount: count ? r(count).top - (sw ? r(sw).bottom : r(c.querySelector('.court-line')).bottom) : null,
          countToNames: names && count ? r(names).top - r(count).bottom : null,
          namesToPill: names && pill ? r(pill).top - (wait ? r(wait).bottom : r(names).bottom) : null,
          bottomPad: cb.bottom - Math.max(...bottoms),
        };
        return {
          id: c.id,
          switch: c.dataset.switch,
          nameLines: names ? Math.round(r(names).height / lineH) : 0,
          pill: !!pill,
          ...Object.fromEntries(Object.entries(rows).map(([k, v]) => [k, v === null ? null : Math.round(v * 10) / 10])),
        };
      });
    }, sel);

  // ---------- the pop-up never hides behind the bottom bar ----------
  for (const [height, label] of [[664, 'with Safari\'s bottom bar showing'], [560, 'on a short phone'], [420, 'on a very short screen']]) {
    await check(`390px ${label}: the gear pop-up on the first, a middle and the LAST card has every row on screen and tappable, above the tab bar`, async () => {
      const ctx = await browser.newContext({ ...phone(390, 'light'), viewport: { width: 390, height } });
      await post(ctx.request, '/api/admin/login', { pin: PIN });
      const page = await ctx.newPage();
      await page.goto(`${BASE}/admin`);
      await page.locator(CARDS).first().waitFor();
      const all = page.getByRole('button', { name: /^Show all/ });
      if (await all.count()) await all.click();
      const n = await page.locator(CARDS).count();
      assert(n >= 7, `only ${n} cards`);
      const picks = [0, Math.floor(n / 2), n - 1];
      const seen = new Set();
      for (const i of picks) {
        const c = page.locator(CARDS).nth(i);
        await c.scrollIntoViewIfNeeded();
        if (i === n - 1) await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
        const gear = c.getByRole('button', { name: /^Game menu for/ });
        await gear.click();
        const menu = page.getByRole('menu');
        await menu.waitFor();
        const r = await page.evaluate(() => {
          const bar = document.querySelector('.tabbar').getBoundingClientRect();
          const pop = document.querySelector('[role="menu"]');
          const pr = pop.getBoundingClientRect();
          const rows = [...pop.querySelectorAll('[role="menuitem"]')].map((e) => {
            const b = e.getBoundingClientRect();
            const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
            return { text: e.textContent.trim(), top: b.top, bottom: b.bottom, left: b.left, right: b.right, tappable: !!hit && (hit === e || e.contains(hit)), clipped: pop.scrollHeight > pop.clientHeight + 1 };
          });
          return { place: [...pop.classList].find((c) => c.startsWith('place-')), barTop: bar.top, vh: window.innerHeight, vw: window.innerWidth, popTop: pr.top, popBottom: pr.bottom, rows };
        });
        seen.add(r.place);
        const w = `card ${i + 1}/${n} (${r.place})`;
        const names = r.rows.map((x) => x.text);
        assert(['Text the group', 'Edit game', 'Players', 'Cancel session'].every((t) => names.includes(t)), `${w}: rows ${names}`);
        assert(names[names.length - 1] === 'Cancel session', `${w}: Cancel session should be last`);
        for (const row of r.rows) {
          assert(row.top >= 0 && row.bottom <= r.barTop + 0.5 && row.bottom <= r.vh && row.left >= 0 && row.right <= r.vw, `${w}: "${row.text}" is off screen or behind the tab bar (top ${Math.round(row.top)}, bottom ${Math.round(row.bottom)}, tab bar at ${Math.round(r.barTop)})`);
          assert(row.tappable, `${w}: "${row.text}" is covered by something else`);
        }
        assert(r.popBottom <= r.barTop + 0.5, `${w}: pop-up runs behind the tab bar`);
        // Players really opens from here, then the menu works again.
        await page.getByRole('menuitem', { name: 'Players' }).click();
        assert(/^Players/.test(await page.locator('dialog[open] h2').innerText()), `${w}: Players did not open`);
        await page.locator('dialog[open]').getByRole('button', { name: 'Close' }).click();
        // Close paths and scrolling still work.
        await gear.click();
        await page.getByRole('menu').waitFor();
        await page.keyboard.press('Escape');
        await page.getByRole('menu').waitFor({ state: 'detached', timeout: 4000 }).catch(() => { throw new Error(`${w}: Escape did not close the pop-up`); });
        await gear.click();
        await page.getByRole('menu').waitFor();
        await page.mouse.click(8, 8);
        await page.getByRole('menu').waitFor({ state: 'detached', timeout: 4000 }).catch(() => { throw new Error(`${w}: a tap outside did not close the pop-up`); });
      }
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.mouse.wheel(0, 300);
      await sleep(300);
      assert((await page.evaluate(() => window.scrollY)) > 100, 'the page no longer scrolls with the pop-up closed');
      // The last card is never hidden by the tab bar once scrolled to the end.
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      const gap = await page.evaluate(() => {
        const cards = document.querySelectorAll('section[aria-labelledby="sessions-title"] article.scard');
        return document.querySelector('.tabbar').getBoundingClientRect().top - cards[cards.length - 1].getBoundingClientRect().bottom;
      });
      assert(gap >= 8, `the last card sits ${Math.round(gap)}px from the tab bar (it is hidden)`);
      await page.screenshot({ path: path.join(SHOTS, `admin-menu-last-${height}.png`) });
      console.log(`      (placements used: ${[...seen].join(', ')})`);
      await ctx.close();
    });
  }

  await check('390px: opening the gear menu (and Edit game, Players, Cancel) never moves the page, at several scroll positions, on the first, a middle and the last card', async () => {
    const ctx = await browser.newContext({ ...phone(390, 'light'), viewport: { width: 390, height: 700 } });
    await post(ctx.request, '/api/admin/login', { pin: PIN });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/admin`);
    await page.locator(CARDS).first().waitFor();
    const all = page.getByRole('button', { name: /^Show all/ });
    if (await all.count()) await all.click();
    const n = await page.locator(CARDS).count();
    const maxY = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
    const spots = [0, Math.round(maxY * 0.25), Math.round(maxY * 0.5), Math.round(maxY * 0.75), maxY];
    const y = () => page.evaluate(() => Math.round(window.scrollY * 100) / 100);
    let opened = 0;
    const placements = new Set();
    for (const target of spots) {
      await page.evaluate((t) => window.scrollTo(0, t), target);
      await sleep(150);
      const visible = await page.locator(CARDS).evaluateAll((els) =>
        els.map((e, idx) => ({ idx, b: e.querySelector('.icon-round').getBoundingClientRect() })).filter((x) => x.b.top >= 70 && x.b.bottom <= 640).map((x) => x.idx),
      );
      const picks = [...new Set([visible[0], visible[Math.floor(visible.length / 2)], visible[visible.length - 1]])].filter((v) => v !== undefined);
      for (const i of picks) {
        await page.evaluate((t) => window.scrollTo(0, t), target);
        await sleep(120);
        const before = await y();
        const c = page.locator(CARDS).nth(i);
        const box = await c.getByRole('button', { name: /^Game menu for/ }).boundingBox();
        // Only gears that are on screen here (a tap on one that is not would be impossible for a person too).
        if (!box || box.y < 70 || box.y + box.height > 640) continue;
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        await page.getByRole('menu').waitFor();
        await sleep(250);
        const during = await y();
        placements.add(await page.getByRole('menu').evaluate((e) => [...e.classList].find((c) => c.startsWith('place-'))));
        assert(during === before, `card ${i + 1}: opening the menu moved the page from ${before} to ${during}`);
        // Every row is on screen and tappable without scrolling.
        const rows = await page.getByRole('menu').getByRole('menuitem').evaluateAll((els) =>
          els.map((e) => {
            const b = e.getBoundingClientRect();
            const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
            return { t: e.textContent.trim(), ok: b.top >= 0 && b.bottom <= window.innerHeight && !!hit && (hit === e || e.contains(hit)) };
          }),
        );
        assert(rows.every((r) => r.ok), `card ${i + 1}: rows not reachable ${JSON.stringify(rows.filter((r) => !r.ok))}`);
        await page.keyboard.press('Escape');
        await page.getByRole('menu').waitFor({ state: 'detached' });
        assert((await y()) === before, `card ${i + 1}: closing the menu moved the page`);
        // The other pop-ups opened from the menu.
        for (const row of ['Edit game', 'Players', 'Cancel session']) {
          await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
          await page.getByRole('menu').waitFor();
          await page.getByRole('menuitem', { name: row }).click();
          await page.locator('dialog[open]').waitFor();
          await sleep(200);
          assert((await y()) === before, `card ${i + 1}: opening "${row}" moved the page`);
          await page.keyboard.press('Escape');
          await page.locator('dialog[open]').waitFor({ state: 'detached' });
          assert((await y()) === before, `card ${i + 1}: closing "${row}" moved the page`);
        }
        opened++;
      }
    }
    assert(opened >= 8, `only ${opened} menus were tried`);
    assert(placements.has('place-down') && placements.has('place-up'), `expected both down and up placements, saw ${[...placements]}`);
    console.log(`      (${opened} menus opened, placements used: ${[...placements].join(', ')})`);
    await ctx.close();
  });

  const SHAPE = (page, sel) =>
    page.evaluate((cardsSel) => {
      const lines = (btn) => {
        const spans = [...btn.querySelectorAll('.seg-line')];
        return spans.length ? new Set(spans.map((e) => Math.round(e.getBoundingClientRect().top))).size : 1;
      };
      return [...document.querySelectorAll(cardsSel)].map((sw) => {
        const b = [...sw.querySelectorAll('button')];
        return { notBookedLines: lines(b[0]), heights: b.map((x) => Math.round(x.getBoundingClientRect().height * 10) / 10), pressed: b.findIndex((x) => x.getAttribute('aria-pressed') === 'true'), text: b.map((x) => x.textContent.replace(/\s+/g, ' ').trim()).join('|') };
      });
    }, sel);

  for (const width of [360, 393, 430]) {
    await check(`${width}px: "Not booked" is always on two lines, and the three segments are the same height on every card and in Edit game`, async () => {
      const { ctx, page } = await openAdmin(width, 'light');
      const shapes = await SHAPE(page, `${CARDS} .court-switch`);
      assert(shapes.length >= 8, `${shapes.length} switches`);
      shapes.forEach((r, i) => {
        assert(r.text === 'Not booked|Waitlist|Booked', `switch ${i + 1}: ${r.text}`);
        assert(r.notBookedLines === 2, `switch ${i + 1}: "Not booked" is on ${r.notBookedLines} line(s)`);
        assert(new Set(r.heights).size === 1, `switch ${i + 1}: segment heights differ ${r.heights}`);
      });
      assert(new Set(shapes.map((r) => r.heights[0])).size === 1, `heights differ between cards: ${[...new Set(shapes.map((r) => r.heights[0]))]}`);
      // Every segment selected in turn on one card: nothing changes height or width of the switch.
      const c = card(page, roles.spare);
      const sw = c.locator('.court-switch');
      const before = await sw.boundingBox();
      const cardBefore = await c.boundingBox();
      for (const v of ['not_booked', 'waitlist', 'booked']) {
        await c.getByRole('button', { name: /Not\s*booked|Waitlist|Booked/ }).first().evaluate(() => {});
        await c.locator(`.court-switch button[data-seg="${v}"]`).click();
        await page.waitForFunction(([id, vv]) => document.querySelector(`#session-${id} .court-switch button[data-seg="${vv}"]`)?.getAttribute('aria-pressed') === 'true', [roles.spare, v]);
        const after = await sw.boundingBox();
        // (The card's own border is 1 to 2 px wider for Not booked and Waitlist, so only the height and the equal thirds are exact.)
        assert(Math.abs(after.height - before.height) < 0.5 && Math.abs(after.width - before.width) <= 3, `switch changed size when ${v} was picked: ${JSON.stringify(before)} vs ${JSON.stringify(after)}`);
        const seg = await sw.locator('button').evaluateAll((bs) => bs.map((b) => [Math.round(b.getBoundingClientRect().width), Math.round(b.getBoundingClientRect().height * 10) / 10]));
        assert(new Set(seg.map((x) => x[0])).size === 1 && new Set(seg.map((x) => x[1])).size === 1, `segments are not equal after picking ${v}: ${JSON.stringify(seg)}`);
      }
      void cardBefore;
      await c.getByRole('button', { name: /^Game menu for/ }).click();
      await page.getByRole('menuitem', { name: 'Edit game' }).click();
      const sheet = await SHAPE(page, 'dialog[open] .court-switch');
      assert(sheet.length === 1 && sheet[0].notBookedLines === 2 && new Set(sheet[0].heights).size === 1, `Edit game switch: ${JSON.stringify(sheet)}`);
      assert(sheet[0].heights[0] === shapes[0].heights[0], `Edit game segments are ${sheet[0].heights[0]}px, cards ${shapes[0].heights[0]}px: not one shared look`);
      await ctx.close();
    });
  }

  const evenly = (rows, where) => {
    for (const r of rows) {
      const w = `${where}, ${r.switch} card, ${r.nameLines} name line(s), ${r.pill ? 'pill' : 'no pill'}`;
      if (r.id === rows[0].id && r.bottomPad > 60) continue; // the short-on-players panel adds its own space below
      assert(Math.abs(r.topPad - 12) <= 0.6, `${w}: top padding ${r.topPad}px, want 12`);
      if (r.bottomPad <= 60) assert(Math.abs(r.bottomPad - 12) <= 0.6, `${w}: bottom padding ${r.bottomPad}px, want 12`);
      if (r.countToNames !== null) assert(Math.abs(r.countToNames - 7.2) <= 0.6, `${w}: count row to names ${r.countToNames}px, want 7.2`);
      if (r.namesToPill !== null) assert(Math.abs(r.namesToPill - 7.2) <= 0.6, `${w}: names to pill ${r.namesToPill}px, want 7.2`);
      if (r.countToNames !== null && r.namesToPill !== null) assert(Math.abs(r.countToNames - r.namesToPill) <= 0.6, `${w}: the gap above the names (${r.countToNames}px) and below it (${r.namesToPill}px) differ`);
    }
  };
  for (const [width, scheme] of [[360, 'light'], [393, 'light'], [393, 'dark'], [430, 'light']]) {
    await check(`${width}px (${scheme}): the count row, names and paid pill sit the same distance apart (7.2px), with 12px above and below, on every kind of card`, async () => {
      const { ctx, page } = await openAdmin(width, scheme);
      const rows = await SPACING(page, CARDS);
      const kinds = new Set(rows.map((r) => `${r.switch}/${r.nameLines}/${r.pill}`));
      for (const want of ['booked/1/true', 'not_booked/1/true']) assert([...kinds].some((k) => k === want), `no card of kind ${want}; have ${[...kinds]}`);
      assert(rows.some((r) => r.nameLines >= 2), 'no card with a names line that wraps');
      assert(rows.some((r) => !r.pill && r.countToNames === null), 'no card without a pill');
      assert(rows.some((r) => r.switch === 'waitlist'), 'no waitlist card');
      assert(rows.some((r) => r.nameLines === 1 && r.pill), 'no one-name card');
      assert(rows.some((r) => r.nameLines === 1 && r.pill && r.countToNames !== null), 'no three-name card');
      if (process.env.SHOW_SPACING) console.log(JSON.stringify(rows));
      evenly(rows, `${width}px ${scheme}`);
      await ctx.close();
    });
  }

  await check('the spacing does not move when the live refresh redraws the cards', async () => {
    const { ctx, page } = await openAdmin(390, 'light');
    const before = JSON.stringify(await SPACING(page, CARDS));
    const topBefore = await page.locator(CARDS).first().evaluate((e) => Math.round(e.getBoundingClientRect().top + window.scrollY));
    // A change somewhere else on the screen forces a full redraw of every card.
    await post(areq, `/api/admin/sessions/${roles.bookedEmpty}/court-status`, { status: 'booked' });
    await page.waitForFunction((id) => document.querySelector(`#session-${id}`)?.dataset.switch === 'booked', roles.bookedEmpty, { timeout: 15000 });
    await sleep(600);
    const after = JSON.stringify(await SPACING(page, CARDS));
    assert(before === after, `spacing changed on refresh:\n${before}\n${after}`);
    const topAfter = await page.locator(CARDS).first().evaluate((e) => Math.round(e.getBoundingClientRect().top + window.scrollY));
    assert(topBefore === topAfter, `the first card moved from ${topBefore} to ${topAfter}`);
    await ctx.close();
  });

  await check('Edit game on a short phone (390 x 560): Save can be scrolled to and tapped, and the sheet stays above the tab bar', async () => {
    const ctx = await browser.newContext({ ...phone(390, 'light'), viewport: { width: 390, height: 560 } });
    await post(ctx.request, '/api/admin/login', { pin: PIN });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/admin`);
    await page.locator(CARDS).first().waitFor();
    const c = card(page, roles.paid);
    await c.scrollIntoViewIfNeeded();
    await c.getByRole('button', { name: /^Game menu for/ }).click();
    await page.getByRole('menuitem', { name: 'Edit game' }).click();
    const save = page.locator('dialog[open]').getByRole('button', { name: 'Save', exact: true });
    await save.scrollIntoViewIfNeeded();
    const r = await save.evaluate((e) => {
      const b = e.getBoundingClientRect();
      const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
      return { top: b.top, bottom: b.bottom, vh: window.innerHeight, tappable: hit === e || e.contains(hit), tab: document.querySelector('.tabbar').getBoundingClientRect().top };
    });
    assert(r.top >= 0 && r.bottom <= r.vh && r.tappable, `Save is off screen or covered: ${JSON.stringify(r)}`);
    await save.click();
    await page.locator('dialog[open]').waitFor({ state: 'detached' });
    await ctx.close();
  });

  // ---------- Edit game ----------
  await check('Edit game: one sheet with the switch, the automatic cancel-by line, Date, Start, End, the CourtReserve button and one Save; none of the old fields', async () => {
    const { ctx, page } = await openAdmin();
    const c = card(page, roles.paid);
    await c.getByRole('button', { name: /^Game menu for/ }).click();
    await page.getByRole('menuitem', { name: 'Edit game' }).click();
    const sheet = page.locator('dialog[open]');
    const title = await sheet.locator('h2').innerText();
    assert(/^Edit game · (Mon|Tue|Wed|Thu|Fri|Sat|Sun) [A-Z][a-z]{2} \d{1,2}$/.test(title), `title "${title}"`);
    assert((await sheet.locator('.court-switch button').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim()).join('|') === 'Not booked|Waitlist|Booked', 'switch');
    const line = (await sheet.locator('[data-cancel-by]').innerText()).trim();
    assert(/^Cancel by (Mon|Tue|Wed|Thu|Fri|Sat|Sun) \d{1,2}:\d{2} (AM|PM), set automatically\.$/.test(line), `cancel-by line "${line}"`);
    assert((await sheet.locator('[data-cancel-by] input, input[type="datetime-local"]').count()) === 0, 'the cancel-by should not be editable');
    for (const label of ['Date', 'Start', 'End']) assert((await sheet.getByLabel(label, { exact: true }).count()) === 1, `no ${label} field`);
    await sheet.getByRole('link', { name: /Change court on CourtReserve/ }).waitFor();
    assert((await sheet.getByRole('button', { name: 'Save', exact: true }).count()) === 1, 'one Save');
    const text = await sheet.innerText();
    for (const gone of ['More details', 'Not available', 'Fill in', 'Deadline', 'deadline', 'Reservation number', 'Court cost', 'Move session', 'Change time or date']) assert(!text.includes(gone), `still shows "${gone}"`);
    await page.screenshot({ path: path.join(SHOTS, 'admin-edit-game.png') });
    await ctx.close();
  });

  await check('Edit game: changing only the switch saves only the status (no move, no text sheet)', async () => {
    const { ctx, page } = await openAdmin();
    const c = card(page, roles.bookedEmpty);
    const startBefore = (await dash()).sessions.find((s) => s.id === roles.bookedEmpty).startsAt;
    await c.getByRole('button', { name: /^Game menu for/ }).click();
    await page.getByRole('menuitem', { name: 'Edit game' }).click();
    const sheet = page.locator('dialog[open]');
    await sheet.getByRole('button', { name: 'Waitlist', exact: true }).click();
    // Picking in the sheet does not save yet.
    assert((await (await dash()).sessions.find((s) => s.id === roles.bookedEmpty).bookingStatus) === 'booked', 'saved before Save');
    await sheet.getByRole('button', { name: 'Save', exact: true }).click();
    await page.locator('dialog[open]').waitFor({ state: 'detached' });
    await page.waitForFunction((id) => document.querySelector(`#session-${id} .court-switch button[aria-pressed="true"]`)?.textContent.trim() === 'Waitlist', roles.bookedEmpty);
    const after = (await dash()).sessions.find((s) => s.id === roles.bookedEmpty);
    assert(after.startsAt === startBefore, 'the time moved');
    assert(after.bookingStatus === 'unavailable', 'waitlist should store the existing third value');
    await ctx.close();
  });

  await check('Edit game: a new time moves the game (players are not texted), moves cancel-by with it, and opens the Moved text', async () => {
    const { ctx, page } = await openAdmin();
    const c = card(page, roles.noRed);
    const s0 = (await dash()).sessions.find((s) => s.id === roles.noRed);
    await c.getByRole('button', { name: /^Game menu for/ }).click();
    await page.getByRole('menuitem', { name: 'Edit game' }).click();
    const sheet = page.locator('dialog[open]');
    const before = (await sheet.locator('[data-cancel-by]').innerText()).trim();
    await sheet.getByLabel('Start', { exact: true }).fill('09:00');
    const preview = (await sheet.locator('[data-cancel-by]').innerText()).trim();
    // A 9:00 AM start means cancel by 9:00 PM the evening before.
    assert(/9:00 PM, set automatically\.$/.test(preview) && preview !== before, `cancel-by line did not follow the start: "${before}" then "${preview}"`);
    await sheet.getByRole('button', { name: 'Save', exact: true }).click();
    await page.waitForFunction(() => /^Moved/.test(document.querySelector('dialog[open] h2')?.textContent || ''));
    const moved = (await dash()).sessions.find((s) => s.id === roles.noRed);
    assert(moved.startsAt !== s0.startsAt, 'the game did not move');
    assert(Date.parse(moved.startsAt) - Date.parse(moved.cancellationDeadlineAt) === 12 * HOUR, 'saved deadline is not start minus 12 hours');
    const modal = page.locator('dialog[open]');
    assert((await modal.getByText('Is the court booked for the new time?').count()) === 1, 'the court question should follow a plain move');
    assert((await modal.getByRole('link', { name: /Text the players/ }).count()) === 1, 'the Moved text is offered, not sent');
    await ctx.close();
  });

  // ---------- the paid pill and the cancel-by warning ----------
  await check('the pill reads "2 of 3 paid", hides when nobody is in, and opens the players screen', async () => {
    const { ctx, page } = await openAdmin();
    const pill = card(page, roles.paid).locator('.paid-pill');
    assert((await pill.innerText()).trim() === '2 of 3 paid', `pill "${await pill.innerText()}"`);
    // The pill looks 26px tall; its tap area reaches 44px (like the gear). A tap 8px above and below its edge still lands on it.
    const reach = await pill.evaluate((e) => {
      const b = e.getBoundingClientRect();
      const x = b.left + b.width / 2;
      const hit = (y) => { const h = document.elementFromPoint(x, y); return !!h && (h === e || e.contains(h) || h.closest('.paid-pill') === e.closest('.paid-pill')); };
      return { up: hit(b.top - 8), down: hit(b.bottom + 8), mid: hit(b.top + b.height / 2) };
    });
    assert(reach.up && reach.down && reach.mid, `pill tap area too small: ${JSON.stringify(reach)}`);
    assert((await card(page, roles.bookedEmpty).locator('.paid-pill').count()) === 0, 'pill shows with nobody in');
    assert((await card(page, roles.noRed).locator('.paid-pill').count()) === 0, 'pill on an empty game');
    assert((await card(page, roles.notBooked).locator('.paid-pill').innerText()).trim() === '0 of 1 paid', 'not booked game with one in');
    await pill.click();
    assert(/^Players/.test(await page.locator('dialog[open] h2').innerText()), 'the pill should open Players');
    await ctx.close();
  });

  await check('the cancel-by line shows in red only in the last 24 hours before cancel-by', async () => {
    const { ctx, page } = await openAdmin();
    const red = card(page, roles.redLine).locator('.cancel-by-soon');
    const text = (await red.innerText()).trim();
    assert(/^Cancel by \d{1,2}:\d{2} (AM|PM) (today|tomorrow)$/.test(text), `line "${text}"`);
    const color = await red.evaluate((e) => getComputedStyle(e).color);
    const [r, g, b] = color.match(/[\d.]+/g).map(Number);
    assert(r > g + 30 && r > b + 30, `should be red: ${color}`);
    assert((await page.locator('.cancel-by-soon').count()) === 1, 'it shows on more than one card');
    assert((await card(page, roles.paid).getByText(/Cancel by/).count()) === 0, 'cancel-by shown far ahead');
    assert((await page.locator(CARDS).getByText(/^Deadline/).count()) === 0, 'a Deadline line is still on a card');
    await ctx.close();
  });

  // ---------- players never see Waitlist ----------
  await check('players read a waitlisted game exactly like a game with no court booked', async () => {
    const ctx = await browser.newContext(phone(393, 'light'));
    await post(ctx.request, '/api/me', { playerId: idOf('Brandon') });
    const page = await ctx.newPage();
    await page.goto(BASE);
    await page.locator('.schedule article.sched').first().waitFor();
    const more = page.getByRole('button', { name: /^More sessions/ });
    if (await more.count()) await more.click();
    const text = await page.locator('.schedule').innerText();
    assert(!/waitlist|standby|waiting|not available|unavailable/i.test(text), `player screen shows a waiting word: ${text.match(/.{20}(waitlist|standby|waiting|not available|unavailable).{20}/i)}`);
    assert(/Court not booked/.test(text), 'players should see Court not booked');
    await ctx.close();
  });

  // ---------- Do this now ----------
  await check('Do this now keeps "Court opened" and "Didn\'t open" for waitlisted games; the game cards do not', async () => {
    const { ctx, page } = await openAdmin();
    const card1 = page.locator('.do-now [data-task="court_waitlist"]').first();
    await card1.waitFor();
    await card1.getByRole('button', { name: 'Court opened' }).waitFor();
    await card1.getByRole('button', { name: "Didn't open" }).waitFor();
    assert((await page.locator(`${CARDS} button:has-text("Court opened")`).count()) === 0, 'Court opened is on a game card');
    // One court card per game: a waitlisted game never also gets "No court yet / I booked it".
    await page.getByRole('button', { name: /^\+\d+ more/ }).click().catch(() => {});
    for (const id of [roles.waitA, roles.waitB]) {
      const cards = await page.locator(`.do-now article[data-session="${id}"]`).evaluateAll((els) => els.map((e) => e.getAttribute('data-task')));
      assert(cards.length === 1 && cards[0] === 'court_waitlist', `waitlisted game has Do this now cards: ${cards}`);
    }
    for (const kind of ['nocourt', 'nocourt_later', 'book']) {
      for (const id of [roles.waitA, roles.waitB]) assert((await page.locator(`.do-now [data-task="${kind}"][data-session="${id}"]`).count()) === 0, `${kind} card on a waitlisted game`);
    }
    await ctx.close();
  });

  // ---------- live updates ----------
  await check('the organizer screen refreshes by itself (about every 5 seconds), without moving the page, and says "Updated just now"', async () => {
    const { ctx, page } = await openAdmin();
    await page.locator('[data-updated]').waitFor();
    assert(/^Updated just now$/.test((await page.locator('[data-updated]').innerText()).trim()), 'updated line');
    await page.evaluate(() => window.scrollTo(0, 260));
    const y0 = await page.evaluate(() => window.scrollY);
    const paid = card(page, roles.paid).locator('.paid-pill');
    assert((await paid.innerText()).trim() === '2 of 3 paid', 'start');
    // Someone else (another device) marks the third player paid.
    await post(areq, `/api/admin/sessions/${roles.paid}/payment`, { playerId: idOf('Julian'), paid: true });
    await page.waitForFunction((id) => document.querySelector(`#session-${id} .paid-pill`)?.textContent.trim() === '3 of 3 paid', roles.paid, { timeout: 15000 });
    const y1 = await page.evaluate(() => window.scrollY);
    assert(Math.abs(y1 - y0) <= 1, `the page jumped from ${y0} to ${y1}`);
    await ctx.close();
  });

  await check('a refresh never closes the gear pop-up or a sheet: it waits until they close, then catches up', async () => {
    const { ctx, page } = await openAdmin();
    const c = card(page, roles.notBooked);
    await c.getByRole('button', { name: /^Game menu for/ }).click();
    await page.getByRole('menu').waitFor();
    await post(areq, `/api/admin/sessions/${roles.notBooked}/court-status`, { status: 'booked' });
    await sleep(8000);
    assert((await page.getByRole('menu').count()) === 1, 'the pop-up closed by itself');
    assert((await c.locator('.court-switch button[aria-pressed="true"]').innerText()).replace(/\s+/g, ' ').trim() === 'Not booked', 'the card changed under an open pop-up');
    await page.keyboard.press('Escape');
    await page.waitForFunction((id) => document.querySelector(`#session-${id} .court-switch button[aria-pressed="true"]`)?.textContent === 'Booked', roles.notBooked, { timeout: 15000 });
    // A sheet: open Edit game, change something, hold, and the sheet and the typing stay.
    await c.getByRole('button', { name: /^Game menu for/ }).click();
    await page.getByRole('menuitem', { name: 'Edit game' }).click();
    const sheet = page.locator('dialog[open]');
    await sheet.getByLabel('Start', { exact: true }).fill('18:15');
    assert((await page.locator('[data-updated]').evaluate((e) => getComputedStyle(e).visibility)) === 'hidden', '"Updated" should hide while a sheet is open');
    await post(areq, `/api/admin/sessions/${roles.notBooked}/court-status`, { status: 'waitlist' });
    await sleep(8000);
    assert((await page.locator('dialog[open]').count()) === 1, 'the sheet closed by itself');
    assert((await sheet.getByLabel('Start', { exact: true }).inputValue()) === '18:15', 'typing was overwritten');
    await sheet.getByRole('button', { name: 'Close' }).click();
    await page.waitForFunction((id) => document.querySelector(`#session-${id} .court-switch button[aria-pressed="true"]`)?.textContent.trim() === 'Waitlist', roles.notBooked, { timeout: 15000 });
    assert((await page.locator('[data-updated]').evaluate((e) => getComputedStyle(e).visibility)) === 'visible', '"Updated" should come back');
    await ctx.close();
  });

  await check('the extra cost is small: one tiny check per refresh, the full load only when something changed', async () => {
    const { ctx, page } = await openAdmin();
    await sleep(500);
    const calls = { version: 0, dashboard: 0 };
    page.on('request', (r) => {
      if (r.url().includes('/api/admin/version')) calls.version++;
      if (r.url().includes('/api/admin/dashboard')) calls.dashboard++;
    });
    await sleep(16_000);
    assert(calls.version >= 2 && calls.version <= 4, `expected about 3 checks in 16 s, saw ${calls.version}`);
    assert(calls.dashboard === 0, `idle page reloaded the full list ${calls.dashboard} times`);
    console.log(`      (${calls.version} tiny checks in 16 s = about ${Math.round((calls.version / 16) * 3600)} per hour while active)`);
    await ctx.close();
  });

  await browser.close();
  console.log(`\nadmin-cleanup: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
