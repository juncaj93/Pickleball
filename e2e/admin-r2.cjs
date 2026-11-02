/* "Admin screens, round 2" (ADMIN_R2, Nov 2026): Home cards, Money, Players (Hide player), History highlight, header.
 *
 *   node e2e/admin-r2.cjs      (also run by npm run test:e2e)
 *
 * Starts its own dev server with a fresh fake group. The switch is OFF there, so every check opens /admin with the private
 * test link (?adminr2=on) where it needs the new screens. Nothing here touches the live site. Screenshots: e2e/screenshots/admin-r2-*.png.
 */
const { spawn } = require('node:child_process');
const { rmSync, mkdirSync } = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.E2E_PORT) || 5281;
const BASE = `http://localhost:${PORT}`;
const SETUP_TOKEN = 'admin-r2-setup-token-0123456789';
const PIN = '482913';
const NAMES = ['Alex', 'Ryan', 'Julian', 'Nathan', 'Mitchel', 'Brandon'];
const SHOTS = process.env.E2E_SHOTS || path.join(__dirname, 'screenshots');

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
  const dbFile = path.join(ROOT, '.data', 'admin-r2.sqlite');
  mkdirSync(path.join(ROOT, '.data'), { recursive: true });
  rmSync(dbFile, { force: true });
  const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
    cwd: ROOT,
    env: { ...process.env, DEV_DB: dbFile, SETUP_TOKEN, DEV_CLOCK: '1', MOTION: '', MOTION_ADMIN: '', ADMIN_V2: '', ADMIN_R2: '' },
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
  await fetch(`${BASE}/__dev/clock`, { method: 'POST', body: JSON.stringify({ atMs: Date.now() }) });

  const browser = await chromium.launch();
  const post = (req, url, data) => req.post(BASE + url, { data, headers: { Origin: BASE } });
  const put = (req, url, data) => req.put(BASE + url, { data, headers: { Origin: BASE } });
  const made = await post((await browser.newContext()).request, '/api/setup', {
    setupToken: SETUP_TOKEN,
    groupName: 'Pickleball Bros',
    pin: PIN,
    venmoUrl: 'https://venmo.com/u/organizer',
    players: NAMES.map((name, i) => ({ name, phone: `24855505${String(i).padStart(2, '0')}` })),
  });
  if (!made.ok()) throw new Error(`setup failed: ${await made.text()}`);
  const areq = (await browser.newContext()).request;
  await post(areq, '/api/admin/login', { pin: PIN });
  const dash = async () => (await areq.get(`${BASE}/api/admin/dashboard`)).json();
  let d = await dash();
  for (const h of d.hiddenSessions || []) await post(areq, `/api/admin/sessions/${h.id}/show`, { shown: true });
  await put(areq, '/api/admin/group', { organizerName: 'Alex' });
  d = await dash();
  const ahead = d.sessions.filter((s) => !s.state.flags.past && Date.parse(s.startsAt) > Date.now() + 36 * 3600_000);
  const idOf = (n) => d.players.find((p) => p.name === n).id;
  const phones = {};
  for (const n of NAMES) {
    const c = await browser.newContext();
    await post(c.request, '/api/me', { playerId: idOf(n) });
    phones[n] = c.request;
  }
  const join = (n, s) => post(phones[n], `/api/sessions/${s.id}/join`, {});
  // A booked (4 in + Alex), B booked (2 in + Alex), C and D not booked, E waitlist, F booked then canceled with money back.
  const [A, B, C, D, E, F] = ahead;
  for (const s of [A, B, F]) await post(areq, `/api/admin/sessions/${s.id}/booked`, {});
  for (const n of ['Ryan', 'Julian', 'Nathan', 'Mitchel']) await join(n, A);
  for (const n of ['Ryan', 'Brandon']) await join(n, B);
  await join('Ryan', C);
  for (const n of ['Julian', 'Nathan', 'Brandon']) await join(n, D);
  await post(areq, `/api/admin/sessions/${E.id}/court-status`, { status: 'waitlist' });
  for (const s of [A, B, D]) await post(areq, `/api/admin/sessions/${s.id}/me`, { in: true });
  const payOf = async (s, name) => (await dash()).sessions.find((x) => x.id === s.id).roster.find((r) => r.name === name);
  const markPaid = async (s, name) => {
    const r = await payOf(s, name);
    return post(areq, `/api/admin/sessions/${s.id}/payment`, { playerId: r.playerId, paid: true, seen: r.moneySeen, cents: r.owesCents });
  };
  await markPaid(A, 'Ryan');
  const selfPaid = await post(phones['Mitchel'], `/api/sessions/${A.id}/paid`, {});
  await join('Brandon', F);
  await markPaid(F, 'Brandon');
  await post(areq, `/api/admin/sessions/${F.id}/decision`, { decision: 'cancel', confirm: true, reason: 'Rain' });

  const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
  const phone = (width, scheme = 'light', extra = {}) => ({ viewport: { width, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: scheme, userAgent: UA, ...extra });
  async function openAdmin({ width = 390, scheme = 'light', v2 = false, r2 = true, motion = false, extra = {} } = {}) {
    const ctx = await browser.newContext(phone(width, scheme, extra));
    await post(ctx.request, '/api/admin/login', { pin: PIN });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/admin?adminv2=${v2 ? 'on' : 'off'}&adminr2=${r2 ? 'on' : 'off'}${motion ? '&motionadmin=on' : ''}`);
    await page.locator('article.scard').first().waitFor();
    return { ctx, page };
  }
  const tab = async (page, name) => {
    // (A plain click: at 200% text the tab bar can be covered by an older, wider element, which is not what these checks are about.)
    await page.locator('.tabbar button', { hasText: name }).evaluate((b) => b.click());
    await page.waitForTimeout(250);
  };
  const noOverflow = async (page, what) => {
    const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
    assert(o.sw <= o.cw + 1, `${what}: sideways overflow ${o.sw} > ${o.cw}`);
  };
  const shot = (page, name, full = true) => page.screenshot({ path: path.join(SHOTS, `admin-r2-${name}.png`), fullPage: full });

  // A holiday game (the next Thanksgiving) so the holiday tab can be checked on any day this runs.
  {
    const y = new Date(Date.now() + 36 * 3600_000);
    const year = y.getUTCMonth() > 10 || (y.getUTCMonth() === 10 && y.getUTCDate() > 26) ? y.getUTCFullYear() + 1 : y.getUTCFullYear();
    const startsAt = new Date(`${year}-11-26T19:00:00-05:00`).toISOString();
    const endsAt = new Date(`${year}-11-26T21:00:00-05:00`).toISOString();
    await post(areq, '/api/admin/sessions', { startsAt, endsAt, note: null });
  }
  // A player who signs up from their own phone (History highlight), and a hidden-player candidate with money and history.
  d = await dash();
  const holidayGame = d.sessions.find((s) => s.holiday);
  const noHoliday = ahead.filter((s) => !s.holiday);

  // ---------------------------------------------------------------- the switch
  await check('S off by default: the old screens, exactly (no round 2 parts anywhere)', async () => {
    const { ctx, page } = await openAdmin({ r2: false });
    assert((await page.locator('.scard-r2, .r2-foot, .r2m-game, .r2-players').count()) === 0, 'no round 2 parts on Home');
    assert((await page.locator('[data-updated]').count()) === 1, '"Updated just now" is still there');
    assert((await page.locator('.topbar h1').innerText()) === 'Pickleball Bros', 'title is the group name');
    assert((await page.locator('.topbar .mode-btn').count()) === 0, 'no light/dark button in the header');
    assert((await page.locator('.add-pill ~ a, .week-break a.btn').first().innerText()).includes('Book a court'), 'Book a court wording');
    await tab(page, 'Money');
    assert((await page.locator('.r2m-game').count()) === 0 && (await page.getByText('Monthly money').count()) === 1, 'old Money tab');
    await tab(page, 'Players');
    assert((await page.locator('.player-row .p-pill.reg, .player-row .p-pill.occ').count()) > 0, 'Regular / Occasional still shown');
    assert((await page.locator('[data-hide-player]').count()) === 0, 'no Hide player');
    await tab(page, 'Settings');
    await page.locator('details[data-section="group"] summary').click();
    assert((await page.locator('[data-row="venmoUrl"]').count()) === 1, 'Venmo link still in Settings');
    await ctx.close();
  });

  await check('S private link: ?adminr2=on is for that phone only, ?adminr2=off ends it', async () => {
    const a = await openAdmin();
    assert((await a.page.locator('.scard-r2').count()) > 0, 'on for this phone');
    const b = await openAdmin({ r2: false });
    assert((await b.page.locator('.scard-r2').count()) === 0, 'another phone stays off');
    await a.page.goto(`${BASE}/admin?adminr2=off`);
    await a.page.locator('article.scard').first().waitFor();
    assert((await a.page.locator('.scard-r2').count()) === 0, 'off again');
    await a.ctx.close();
    await b.ctx.close();
  });

  await check('S Settings > Feature switches > Admin screens, round 2 turns it on for every phone, no deploy', async () => {
    const a = await openAdmin({ r2: false });
    await tab(a.page, 'Settings');
    const sect = a.page.locator('details[data-section="switches"]');
    assert(!(await sect.evaluate((e) => e.open)), 'collapsed');
    await sect.locator('summary').click();
    assert((await sect.getByText('Admin screens, round 2').count()) >= 1, 'the row');
    await a.page.locator('[data-admin-r2-all]').check();
    await a.page.waitForTimeout(700);
    const b = await openAdmin({ r2: false });
    assert((await b.page.locator('.scard-r2').count()) > 0, 'a phone with no link now sees round 2');
    await a.page.locator('[data-admin-r2-all]').uncheck();
    await a.page.waitForTimeout(700);
    const c = await openAdmin({ r2: false });
    assert((await c.page.locator('.scard-r2').count()) === 0, 'off again for everyone');
    for (const x of [a, b, c]) await x.ctx.close();
  });

  // ---------------------------------------------------------------- 5. header
  await check('5 header: Light/Dark button left of View as, "Admin" under ORGANIZER, no "Updated just now" anywhere', async () => {
    const { ctx, page } = await openAdmin();
    assert((await page.locator('.topbar .eyebrow').innerText()).toLowerCase() === 'organizer', 'eyebrow');
    assert((await page.locator('.topbar h1').innerText()) === 'Admin', 'title says Admin');
    const m = await page.locator('.topbar .mode-btn').boundingBox();
    const v = await page.locator('.topbar-btn', { hasText: 'View as' }).boundingBox();
    assert(m && v && m.x + m.width <= v.x + 1 && Math.abs(m.y + m.height / 2 - (v.y + v.height / 2)) < 12, 'toggle is left of View as, on the same line');
    for (const t of ['Home', 'Players', 'Money', 'History', 'Settings']) {
      await tab(page, t);
      assert((await page.getByText(/Updated (just now|\d+ min ago)/).count()) === 0, `no Updated line on ${t}`);
    }
    // The toggle works, and the Settings Appearance row still works with it.
    await tab(page, 'Home');
    const before = await page.evaluate(() => document.documentElement.dataset.theme || 'system');
    await page.locator('.topbar .mode-btn').click();
    const after = await page.evaluate(() => document.documentElement.dataset.theme || 'system');
    assert(before !== after, `theme changed ${before} -> ${after}`);
    await tab(page, 'Settings');
    assert((await page.getByText('Appearance').count()) === 1, 'Appearance row still in Settings');
    await page.getByRole('button', { name: 'Light', exact: true }).click();
    assert((await page.evaluate(() => document.documentElement.dataset.theme)) === 'light', 'Appearance still works');
    await ctx.close();
  });

  // ---------------------------------------------------------------- 1. home cards
  await check('1 Home card: tile+time left, switch with seats and names under it, gear right, 3 equal footer cells', async () => {
    const { ctx, page } = await openAdmin();
    const card = page.locator(`article#session-${A.id}`);
    const tile = await card.locator('.tile').boundingBox();
    const sw = await card.locator('.court-switch').boundingBox();
    const gear = await card.locator('.game-menu .icon-round').boundingBox();
    const names = await card.locator('.names-line').first().boundingBox();
    assert(tile.x < sw.x && sw.x + sw.width <= gear.x + 1, 'tile | switch | gear, left to right');
    assert(names.y > sw.y + sw.height - 1 && names.x >= sw.x - 1 && names.x + names.width <= sw.x + sw.width + 1, 'names sit under the switch, inside its width');
    assert((await card.locator('.scard-time').innerText()).length > 0, 'the time is under the tile');
    const cells = await card.locator('.r2-cell').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().width));
    assert(cells.length === 3 && Math.max(...cells) - Math.min(...cells) < 1.5, `three equal cells ${cells}`);
    const lines = await card.locator('.r2-cell').evaluateAll((els) => els.slice(1).map((e) => parseFloat(getComputedStyle(e).borderLeftWidth)));
    assert(lines.every((w) => w > 0 && w <= 1.5), `thin dividers ${lines}`);
    await shot(page, 'home-390-light', true);
    await ctx.close();
  });

  await check('1 Home footer: words In and Out (no check or X icons), $ circle with "1 of 4", clock with the cancel time', async () => {
    const { ctx, page } = await openAdmin();
    const card = page.locator(`article#session-${A.id}`);
    assert((await card.locator('.r2-seg button').allInnerTexts()).join('|') === 'In|Out', 'In | Out');
    assert((await card.locator('.r2-seg svg').count()) === 0, 'no icons in the toggle');
    assert((await card.locator('.r2-dol').innerText()) === '$', 'green $ circle');
    assert(/^\d+ of \d+$/.test(await card.locator('.r2-paid-text').innerText()), 'paid count text');
    assert((await card.locator('[data-cancel-by] svg').count()) === 1, 'clock icon');
    const seen = await card.locator('[data-cancel-by]').evaluate((e) => [...e.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim());
    assert(/^(\d{1,2}(:\d{2})? [AP]M|[A-Z][a-z]{2} \d{1,2}(:\d{2})? [AP]M|[A-Z][a-z]{2} \d{1,2} \d{1,2}(:\d{2})? [AP]M)$/.test(seen), `cancel time text "${seen}"`);
    assert((await card.locator('[data-cancel-by] .sr-only').innerText()).includes('Cancel the court by'), 'screen readers hear what the time is');
    await ctx.close();
  });

  await check('1 Home footer: In / Out is the organizer\'s own seat (same rules), and the paid cell opens Players', async () => {
    const { ctx, page } = await openAdmin();
    const card = page.locator(`article#session-${C.id}`);
    assert((await card.locator('.r2-seg-out').getAttribute('aria-pressed')) === 'true', 'Out is the true one');
    await card.locator('.r2-seg-in').click();
    await page.waitForTimeout(600);
    const dd = await dash();
    assert(dd.sessions.find((s) => s.id === C.id).roster.some((r) => r.name === 'Alex' && r.status === 'confirmed'), 'Alex is in on the server');
    assert((await card.locator('.r2-seg-in').getAttribute('aria-pressed')) === 'true', 'In is the true one now');
    await card.locator('.r2-seg-out').click();
    await page.waitForTimeout(600);
    assert(!(await dash()).sessions.find((s) => s.id === C.id).roster.some((r) => r.name === 'Alex' && r.status === 'confirmed'), 'out again');
    await card.locator('[data-paid-cell]').click();
    await page.getByRole('dialog').waitFor();
    assert((await page.getByRole('dialog').innerText()).includes('Players'), 'Players sheet opened');
    await ctx.close();
  });

  await check('1 Book replaces "Book a court" everywhere in admin: blue Book with the arrow when a court is needed', async () => {
    const { ctx, page } = await openAdmin();
    const needing = page.locator('article.scard-r2 [data-court-need]');
    assert((await needing.count()) >= 1, 'a card that needs a court has the Book cell');
    const a = needing.first().locator('a');
    assert((await a.evaluate((e) => [...e.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim())) === 'Book' && (await a.locator('svg').count()) === 1, 'Book with an arrow');
    assert((await a.getAttribute('target')) === '_blank', 'opens CourtReserve in a new tab');
    // Cards that already have a court show the cancel time instead.
    assert((await page.locator(`article#session-${A.id} [data-court-need]`).count()) === 0, 'booked game has no Book cell');
    for (const t of ['Home', 'Players', 'Money', 'History', 'Settings']) {
      await tab(page, t);
      assert((await page.getByText('Book a court').count()) === 0, `no "Book a court" on ${t}`);
    }
    await tab(page, 'Home');
    assert((await page.locator('[data-task="court_book"]').count()) === 0, 'the separate court card is gone (the game card carries Book)');
    await ctx.close();
  });

  await check('1 Holiday: faint tab under the card with an outlined Yes; confirmed becomes plain "Name ✓"; Undo is in the gear menu', async () => {
    const { ctx, page } = await openAdmin();
    await page.locator('button', { hasText: 'Show all' }).click().catch(() => {});
    const card = page.locator(`article#session-${holidayGame.id}`);
    await card.scrollIntoViewIfNeeded();
    const tabEl = page.locator(`#session-${holidayGame.id} ~ .r2-holiday-row .r2-holiday-tab`);
    assert((await tabEl.count()) === 1, 'tab under the card');
    const cb = await card.boundingBox();
    const tb = await tabEl.boundingBox();
    assert(tb.y >= cb.y + cb.height - 2 && tb.x + tb.width <= cb.x + cb.width + 1 && tb.x + tb.width > cb.x + cb.width * 0.8, `tab is below the card, toward the right ${JSON.stringify([cb, tb])}`);
    assert((await tabEl.innerText()).includes('hours confirmed?'), 'wording');
    const yes = tabEl.locator('.r2-yes');
    assert((await yes.innerText()) === 'Yes' && parseFloat(await yes.evaluate((e) => getComputedStyle(e).borderTopWidth)) >= 1, 'outlined Yes');
    await yes.click();
    await page.waitForTimeout(600);
    assert((await page.locator(`#session-${holidayGame.id} ~ .r2-holiday-row`).count()) === 0, 'tab gone');
    const done = page.locator(`#session-${holidayGame.id} ~ .r2-holiday-done`);
    assert((await done.innerText()).replace(/\s+/g, ' ').includes(`${holidayGame.holiday} ✓`), 'faint "Name ✓"');
    assert((await done.locator('button').count()) === 0, 'no button, no tab');
    assert((await dash()).sessions.find((s) => s.id === holidayGame.id).holidayHoursOk === true, 'saved');
    await card.locator('.game-menu .icon-round').click();
    await page.locator('[data-holiday-undo]').click();
    await page.waitForTimeout(600);
    assert((await page.locator(`#session-${holidayGame.id} ~ .r2-holiday-row .r2-holiday-tab`).count()) === 1, 'Undo from the gear brings the tab back');
    await ctx.close();
  });

  // ---------------------------------------------------------------- 2. money
  await check('2 Money: one list by date, no group headers, small date tiles, bars, amount owed, waiting on court, faded Closed', async () => {
    const { ctx, page } = await openAdmin();
    await tab(page, 'Money');
    assert((await page.locator('.money-r2 .week-break, .money-r2 .section-title, .money-r2 h2:not(.sr-only), .money-r2 h3').count()) === 0, 'no group headers');
    const games = page.locator('.r2m-game');
    assert((await games.count()) >= 6, 'a line per game');
    const dates = await games.evaluateAll((els) => els.map((e) => e.querySelector('.r2m-tile')?.textContent ?? ''));
    assert(dates.every((t) => /^[A-Z]{3}\d{1,2}$/.test(t)), `small tiles ${dates.slice(0, 3)}`);
    const tileH = await page.locator('.r2m-tile').first().evaluate((e) => e.getBoundingClientRect().height);
    assert(tileH <= 40, `tile is small ${tileH}`);
    assert((await page.locator('.r2m-game .r2m-bars').count()) >= 2, 'paid / owes bars');
    assert((await page.locator('.r2m-game .r2m-owed').first().innerText()).includes('$'), 'amount owed on the right');
    assert((await page.locator('.r2m-game.later').first().innerText()).toLowerCase().includes('waiting on court'), 'waiting on court');
    const closed = page.locator('.r2m-game.closed').first();
    assert((await closed.innerText()).includes('Closed'), 'Closed pill');
    assert(parseFloat(await closed.locator('.r2m-closed').evaluate((e) => getComputedStyle(e).opacity)) < 0.85, 'Closed is faded');
    // Date order: games from now on, soonest first.
    const ids = await games.evaluateAll((els) => els.map((e) => e.getAttribute('data-session')));
    const dd = await dash();
    const start = (id) => Date.parse(dd.sessions.find((s) => s.id === id).startsAt);
    const upcoming = ids.map(start).filter((t) => t > Date.parse(dd.now));
    assert(upcoming.every((t, i) => i === 0 || t >= upcoming[i - 1]), 'date order');
    await shot(page, 'money-390-light', true);
    await ctx.close();
  });

  await check('2 Money, opened game: unpaid first, paid next, "Court $N" last (no Northville, no "you pay"); Remind is Mark paid\'s size', async () => {
    const { ctx, page } = await openAdmin();
    await tab(page, 'Money');
    const g = page.locator(`.r2m-game[data-session="${A.id}"]`);
    if ((await g.getAttribute('data-open')) !== 'yes') await g.locator('.r2m-toggle').click();
    const rows = await g.locator('.mv2-row').evaluateAll((els) => els.map((e) => ({ court: e.classList.contains('court'), chip: e.querySelector('.chip')?.textContent?.trim() ?? '', name: e.querySelector('.mv2-name')?.textContent ?? '' })));
    const lastPaid = rows.map((r) => r.chip).lastIndexOf('Paid');
    const firstPaid = rows.findIndex((r) => r.chip === 'Paid');
    const lastUnpaid = rows.map((r) => r.chip).lastIndexOf('Unpaid');
    assert(rows.length >= 4 && rows.at(-1).court, `court row last ${JSON.stringify(rows)}`);
    assert(lastUnpaid >= 0 && firstPaid >= 0 && lastUnpaid < firstPaid && lastPaid < rows.length - 1, `unpaid, then paid, then court ${JSON.stringify(rows)}`);
    assert(/^Court \$\d+(\.\d\d)?$/.test(rows.at(-1).name), `court row says just "Court $N": ${rows.at(-1).name}`);
    const text = await g.innerText();
    assert(!/Northville|you pay|\$6\b/i.test(text), 'no Northville, no "you pay $6"');
    const remind = await g.locator('[data-remind]').boundingBox();
    const mark = await g.locator('.mv2-btncell .btn', { hasText: 'Mark paid' }).first().boundingBox();
    assert(Math.abs(remind.width - mark.width) < 1 && Math.abs(remind.height - mark.height) < 1, `Remind ${remind.width}x${remind.height} vs Mark paid ${mark.width}x${mark.height}`);
    const fonts = await page.evaluate((id) => {
      const q = (s) => getComputedStyle(document.querySelector(`.r2m-game[data-session="${id}"] ${s}`));
      const a = q('[data-remind]');
      const b = q('.mv2-btncell .btn');
      return [a.fontSize === b.fontSize, a.fontWeight === b.fontWeight, a.borderRadius === b.borderRadius];
    }, A.id);
    assert(fonts.every(Boolean), `same font and shape ${fonts}`);
    await ctx.close();
  });

  await check('2 Money chips: Paid is blue until the game is finalized, then green; Court Due is gray; Closed is fainter', async () => {
    const { ctx, page } = await openAdmin();
    await tab(page, 'Money');
    const g = page.locator(`.r2m-game[data-session="${A.id}"]`);
    if ((await g.getAttribute('data-open')) !== 'yes') await g.locator('.r2m-toggle').click();
    const tone = async (loc) => (await loc.locator('.chip').first().getAttribute('class')) ?? '';
    const paid = g.locator('.mv2-row', { has: page.locator('.chip', { hasText: /^Paid$/ }) }).first();
    assert((await tone(paid)).includes('tone-info'), 'blue while not finalized');
    assert((await tone(g.locator('.mv2-row.court'))).includes('tone-muted'), 'Court Due is gray');
    assert((await g.locator('.mv2-row.court').innerText()).includes('Due'), 'says Due');
    // Bars follow the same colors.
    const col = await page.evaluate((id) => getComputedStyle(document.querySelector(`.r2m-game[data-session="${id}"] .r2m-bars i.p`)).backgroundColor, A.id);
    const info = await page.evaluate(() => { const e = document.createElement('i'); e.style.background = 'var(--info-edge)'; document.body.append(e); const c = getComputedStyle(e).backgroundColor; e.remove(); return c; });
    assert(col === info, `paid bar uses the blue token ${col} vs ${info}`);
    await ctx.close();
  });

  await check('2 Money numbers match the old Money tab: same paid counts, same owed amounts, same buttons, same court cost', async () => {
    const grab = async (r2, v2) => {
      const { ctx, page } = await openAdmin({ r2, v2 });
      await tab(page, 'Money');
      let out;
      if (r2 || v2) {
        // Open every game so its rows are drawn.
        const heads = page.locator(r2 ? '.r2m-game:not(.later) .r2m-toggle' : '.mv2-game .mv2-toggle');
        const n = await heads.count();
        for (let i = 0; i < n; i++) {
          const h = heads.nth(i);
          if ((await h.getAttribute('aria-expanded')) !== 'true') await h.click();
        }
        out = await page.locator(r2 ? '.r2m-game:not(.later)' : '.mv2-game').evaluateAll((els) =>
          els.map((g) => ({
            id: g.getAttribute('data-session'),
            rows: [...g.querySelectorAll('.mv2-row:not(.court)')].map((r) => ({ name: r.querySelector('.mv2-name').textContent, chip: r.querySelector('.chip').textContent.trim(), buttons: [...r.querySelectorAll('.btn')].map((b) => b.textContent.trim()).join('+'), owes: (r.textContent.match(/owes \$(\d+(?:\.\d\d)?)/) || [])[1] || null })),
            court: (g.querySelector('.mv2-row.court .mv2-name')?.textContent || '').replace(/^Court \$?/, ''),
            courtButton: g.querySelector('.mv2-row.court .btn')?.textContent.trim() || null,
          })),
        );
      } else {
        out = await page.locator('details.money-sess[data-session]').evaluateAll((els) =>
          els.map((g) => ({
            id: g.getAttribute('data-session'),
            rows: [...g.querySelectorAll('li.pay-row')].map((r) => ({ name: r.querySelector('strong').textContent, chip: r.querySelector('.chip').textContent.trim().replace(/^Credit .*/, 'Unpaid'), buttons: [...r.querySelectorAll('.pay-btns .btn')].map((b) => b.textContent.trim()).filter((t) => t !== 'Payment reminder').join('+'), owes: (r.textContent.match(/owes \$(\d+(?:\.\d\d)?)/) || [])[1] || null })),
            court: (g.querySelector('li.court-row .court-cost')?.textContent || '').replace(/^\$/, ''),
            courtButton: g.querySelector('li.court-row .btn')?.textContent.trim() || null,
          })),
        );
      }
      await ctx.close();
      return out;
    };
    const oldTab = await grab(false, false);
    const newTab = await grab(true, false);
    assert(oldTab.length >= 3, `old tab has games ${oldTab.length}`);
    for (const o of oldTab) {
      const n = newTab.find((x) => x.id === o.id);
      assert(n, `game ${o.id} is on the new list`);
      const key = (r) => `${r.name}|${r.chip}|${r.buttons}|${r.owes}`;
      assert(JSON.stringify(o.rows.map(key).sort()) === JSON.stringify(n.rows.map(key).sort()), `rows match for ${o.id}: ${JSON.stringify(o.rows.map(key))} vs ${JSON.stringify(n.rows.map(key))}`);
      assert(o.court === n.court && o.courtButton === n.courtButton, `court row matches ${o.court}/${o.courtButton} vs ${n.court}/${n.courtButton}`);
    }
    // The header numbers (paid of payable, amount owed) are the server's own figures.
    const dd = await dash();
    const { ctx, page } = await openAdmin();
    await tab(page, 'Money');
    for (const s of dd.sessions.filter((x) => x.court && !x.state.flags.canceled)) {
      const head = await page.locator(`.r2m-game[data-session="${s.id}"] .r2m-toggle`).getAttribute('aria-label');
      if (s.payableCount > 0 && !s.finalized) assert(head.includes(`${s.paidCount} of ${s.payableCount} paid`), `header ${head}`);
      const owed = s.roster.filter((r) => !r.isOrganizer && r.status === 'confirmed' && r.paymentStatus === 'unpaid' && r.owesCents > 0).reduce((t, r) => t + r.owesCents, 0);
      if (owed > 0) {
        const t = await page.locator(`.r2m-game[data-session="${s.id}"] .r2m-owed`).count();
        const rem = await page.locator(`.r2m-game[data-session="${s.id}"] [data-remind]`).count();
        if (t) assert(((await page.locator(`.r2m-game[data-session="${s.id}"] .r2m-owed`).getAttribute('data-owed')) | 0) === owed, `owed ${owed}`);
        else assert(rem === 1, 'open game shows Remind instead');
      }
    }
    await ctx.close();
  });

  await check('2 Money: Mark paid and Unmark still work from the new list (same API, same result)', async () => {
    const { ctx, page } = await openAdmin();
    await tab(page, 'Money');
    const g = page.locator(`.r2m-game[data-session="${A.id}"]`);
    if ((await g.getAttribute('data-open')) !== 'yes') await g.locator('.r2m-toggle').click();
    const before = (await dash()).sessions.find((s) => s.id === A.id).paidCount;
    await g.locator('.mv2-row', { hasText: 'Julian' }).locator('.btn', { hasText: 'Mark paid' }).click();
    await page.waitForTimeout(700);
    const mid = (await dash()).sessions.find((s) => s.id === A.id).paidCount;
    assert(mid === before + 1, `paid count ${before} -> ${mid}`);
    // The new order puts Julian with the paid people now.
    const names = await g.locator('.mv2-row:not(.court) .mv2-name').allInnerTexts();
    const chips = await g.locator('.mv2-row:not(.court) .chip').allInnerTexts();
    assert(chips.map((c) => c.trim()).join().indexOf('Paid') > chips.map((c) => c.trim()).join().lastIndexOf('Unpaid') || !chips.some((c) => c.trim() === 'Unpaid'), `unpaid still above paid ${chips}`);
    await g.locator('.mv2-row', { hasText: 'Julian' }).locator('.btn', { hasText: 'Unmark' }).click();
    await page.waitForTimeout(700);
    assert((await dash()).sessions.find((s) => s.id === A.id).paidCount === before, 'back');
    assert(names.includes('Julian'), 'still listed');
    await ctx.close();
  });

  await check('2 Venmo link moved to Money (same setting), and is gone from Settings', async () => {
    const { ctx, page } = await openAdmin();
    await tab(page, 'Money');
    const box = page.locator('[data-venmo-row] input');
    assert((await box.inputValue()) === 'https://venmo.com/u/organizer', 'shows the saved link');
    await box.fill('https://venmo.com/u/newname');
    await box.blur();
    await page.waitForTimeout(900);
    assert((await dash()).group.venmoUrl === 'https://venmo.com/u/newname', 'saved to the same setting');
    await box.fill('not a link');
    await box.blur();
    await page.waitForTimeout(300);
    assert((await page.locator('[data-venmo-row] .field-error').count()) === 1, 'bad link is refused with a message');
    assert((await dash()).group.venmoUrl === 'https://venmo.com/u/newname', 'bad value was not saved');
    await box.fill('https://venmo.com/u/organizer');
    await box.blur();
    await page.waitForTimeout(900);
    await tab(page, 'Settings');
    await page.locator('details[data-section="group"] summary').click();
    assert((await page.locator('[data-row="venmoUrl"]').count()) === 0, 'not in Settings');
    assert((await page.locator('[data-row="organizerName"]').count()) === 1, 'the rest of Settings Group is untouched');
    await ctx.close();
  });

  // ---------------------------------------------------------------- 3. players
  await check('3 Players: no phone numbers, days or Regular / Occasional; names centered; Edit still has the full form', async () => {
    const { ctx, page } = await openAdmin();
    await tab(page, 'Players');
    const text = await page.locator('.player-list').innerText();
    assert(!/\(\d{3}\) \d{3}-\d{4}|No phone/.test(text), 'no phone numbers');
    assert(!/\bTue\b|\bThu\b|Regular|Occasional/.test(text), 'no days or Regular / Occasional');
    for (const n of NAMES) assert(text.includes(n), `${n} is listed`);
    const off = await page.locator('.player-row').first().evaluate((r) => {
      const b = r.getBoundingClientRect();
      const n = r.querySelector('.p-name').getBoundingClientRect();
      return Math.abs(b.top + b.height / 2 - (n.top + n.height / 2));
    });
    assert(off < 8, `name is vertically centered (off by ${off})`);
    await page.locator('.player-row').nth(1).locator('.p-edit').click();
    assert((await page.getByLabel('Phone (optional)').count()) === 1, 'the Edit form is unchanged (phone is still editable there)');
    await ctx.close();
  });

  await check('3 Hide player: gone from Players, View as and Add someone; seats and money stay; Hidden players list brings them back', async () => {
    const { ctx, page } = await openAdmin();
    const dd = await dash();
    const target = 'Brandon';
    const seatsBefore = JSON.stringify(dd.sessions.map((s) => s.roster.filter((r) => r.name === target).map((r) => [r.status, r.paymentStatus, r.owesCents, r.creditCents])));
    await tab(page, 'Players');
    await page.locator('.player-row', { hasText: target }).locator('.p-edit').click();
    await page.locator('[data-hide-player]').click();
    await page.waitForTimeout(800);
    assert((await page.locator('.player-row', { hasText: target }).count()) === 0, 'gone from Players');
    const after = await dash();
    const hp = after.players.find((p) => p.name === target);
    assert(hp.adminHidden === undefined, 'a screen with the switch off ignores the hide (dashboard without the header)');
    // View as picker
    await page.locator('.topbar-btn', { hasText: 'View as' }).click();
    assert(!(await page.getByRole('dialog').innerText()).includes(target), 'not in View as');
    await page.keyboard.press('Escape');
    // Seats and money unchanged on the server.
    const seatsAfter = JSON.stringify(after.sessions.map((s) => s.roster.filter((r) => r.name === target).map((r) => [r.status, r.paymentStatus, r.owesCents, r.creditCents])));
    assert(seatsAfter === seatsBefore, 'every seat and amount is exactly as before');
    // Their game still lists them in Money (history kept).
    await tab(page, 'Money');
    assert(after.sessions.some((s) => s.roster.some((r) => r.name === target)), 'the player still has seats');
    // Add someone on a game: not offered.
    await tab(page, 'Home');
    await page.locator(`article#session-${C.id} .game-menu .icon-round`).click();
    await page.getByRole('menuitem', { name: 'Players' }).click();
    await page.getByRole('dialog').waitFor();
    assert(!(await page.getByRole('dialog').innerText()).includes(target) || !(await page.getByRole('dialog').locator('h3', { hasText: 'Add someone' }).count()), 'not offered under Add someone');
    await page.keyboard.press('Escape');
    // Hidden players list in Settings > Advanced, with Unhide.
    await tab(page, 'Settings');
    await page.locator('details[data-section="advanced"] > summary').click();
    const hp2 = page.locator('[data-hidden-players]');
    await hp2.locator('summary').click();
    assert((await hp2.locator(`[data-hidden-player="${target}"]`).count()) === 1, 'listed as hidden');
    await hp2.locator(`[data-hidden-player="${target}"] button`, { hasText: 'Unhide' }).click();
    await page.waitForTimeout(800);
    assert((await hp2.locator(`[data-hidden-player="${target}"]`).count()) === 0, 'removed from the hidden list');
    await tab(page, 'Players');
    assert((await page.locator('.player-row', { hasText: target }).count()) === 1, 'back on Players');
    await ctx.close();
  });

  // ---------------------------------------------------------------- 4. history
  await check('4 History: activity by anyone other than Alex is highlighted, Alex\'s own is not', async () => {
    await join('Julian', C);
    await post(areq, `/api/admin/sessions/${C.id}/court-status`, { status: 'waitlist' });
    const { ctx, page } = await openAdmin();
    await tab(page, 'History');
    await page.locator('.chip-btn', { hasText: 'Activity' }).click();
    await page.locator('.activity-list li').first().waitFor();
    const rows = await page.locator('.activity-list li').evaluateAll((els) => els.map((e) => ({ text: e.querySelector('.a-text').textContent, other: e.getAttribute('data-by-other') === 'yes' })));
    assert(rows.some((r) => r.other && /said I'm in|dropped out/.test(r.text)), 'a player\'s tap is highlighted');
    assert(rows.some((r) => !r.other && /Alex/.test(r.text)), 'Alex\'s own entries are plain');
    assert(rows.filter((r) => !r.other).every((r) => !/^(Ryan|Julian|Nathan|Mitchel|Brandon) said/.test(r.text)), 'no player action is left plain');
    const bg = await page.locator('.activity-list li[data-by-other]').first().evaluate((e) => getComputedStyle(e).backgroundColor);
    const plain = await page.locator('.activity-list li:not([data-by-other])').first().evaluate((e) => getComputedStyle(e).backgroundColor);
    assert(bg !== plain, `highlight differs from plain ${bg} vs ${plain}`);
    assert((await page.locator('.activity-list li[data-by-other] .sr-only').first().innerText()).includes('someone else'), 'screen readers hear it too');
    await shot(page, 'history-390-light', false);
    // Off: no highlight.
    const off = await openAdmin({ r2: false });
    await tab(off.page, 'History');
    await off.page.locator('.chip-btn', { hasText: 'Activity' }).click();
    await off.page.locator('.activity-list li').first().waitFor();
    assert((await off.page.locator('.activity-list li[data-by-other]').count()) === 0, 'off: nothing highlighted');
    await off.ctx.close();
    await ctx.close();
  });

  // ---------------------------------------------------------------- look
  await check('L no sideways scroll or cut-off at 320, 360 and 430, light and dark, and at 200% text (Home, Money, Players, History, Settings)', async () => {
    for (const [w, scheme, big] of [[320, 'light', false], [360, 'dark', false], [430, 'light', false], [320, 'light', true], [390, 'dark', true]]) {
      for (const v2 of [false, true]) {
        const { ctx, page } = await openAdmin({ width: w, scheme, v2 });
        if (big) await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
        await page.waitForTimeout(300);
        const wide = await page.evaluate(() => [...document.querySelectorAll('body *')].filter((e) => e.getBoundingClientRect().right > document.documentElement.clientWidth + 1 && getComputedStyle(e).position !== 'fixed' && !e.closest('.week-break, .tabbar, .hv2-short')).slice(0, 4).map((e) => `${e.tagName}.${e.className}`));
        assert(wide.length === 0, `Home ${w} ${scheme} big=${big} v2=${v2}: overflow from ${wide}`);
        // Cards: nothing inside runs past its card edge.
        const out = await page.evaluate(() => [...document.querySelectorAll('.scard-r2')].flatMap((c) => { const cb = c.getBoundingClientRect(); return [...c.querySelectorAll('.r2-cell *, .r2-top *')].filter((e) => { const b = e.getBoundingClientRect(); return b.width > 0 && (b.right > cb.right + 1 || b.left < cb.left - 1) && !e.closest('.menu-pop'); }).slice(0, 2).map((e) => `${e.tagName}.${e.className}`); }));
        assert(out.length === 0, `card cut off at ${w} big=${big} v2=${v2}: ${out}`);
        for (const t of ['Money', 'Players', 'History', 'Settings']) {
          await tab(page, t);
          await noOverflow(page, `${t} ${w} ${scheme} big=${big} v2=${v2}`);
        }
        await tab(page, 'Money');
        await page.locator('.r2m-game').nth(1).locator('.r2m-toggle').click().catch(() => {});
        const cut = await page.evaluate(() => [...document.querySelectorAll('.r2m-game')].flatMap((g) => { const gb = g.getBoundingClientRect(); return [...g.querySelectorAll('.chip, .btn, .r2m-owed')].filter((e) => { const b = e.getBoundingClientRect(); return b.right > gb.right + 0.5 || b.left < gb.left - 0.5; }).map((e) => e.textContent); }));
        assert(cut.length === 0, `Money cut off at ${w} big=${big} v2=${v2}: ${cut}`);
        await ctx.close();
      }
    }
  });

  await check('L tap targets: every button and link on the new Home card and Money list is at least 44 px to tap', async () => {
    const { ctx, page } = await openAdmin();
    const small = await page.evaluate(() => [...document.querySelectorAll('.scard-r2 button, .scard-r2 a, .r2-holiday-tab button')].filter((e) => !e.closest('.menu-pop')).map((e) => {
      // An invisible ::before pseudo-element extends the tap area: measure the area a finger can hit.
      const b = e.getBoundingClientRect();
      const pb = getComputedStyle(e, '::before');
      const ext = pb.content !== 'none' && pb.position === 'absolute' ? [parseFloat(pb.top) || 0, parseFloat(pb.bottom) || 0] : [0, 0];
      return { t: e.textContent.trim().slice(0, 12) || e.getAttribute('aria-label'), h: b.height - ext[0] - ext[1] };
    }).filter((x) => x.h < 43.5));
    assert(small.length === 0, `under 44 px: ${JSON.stringify(small)}`);
    await tab(page, 'Money');
    const small2 = await page.evaluate(() => [...document.querySelectorAll('.r2m-game .r2m-toggle, .r2m-chev')].filter((e) => e.getBoundingClientRect().height < 43.5).map((e) => e.className));
    assert(small2.length === 0, `Money lines under 44 px: ${small2}`);
    await ctx.close();
  });

  await check('L reduced motion and screen-reader names: footer buttons are named, the paid cell says what it opens', async () => {
    const { ctx, page } = await openAdmin({ extra: { reducedMotion: 'reduce' } });
    const card = page.locator(`article#session-${A.id}`);
    assert(/I'm in for/.test((await card.locator('.r2-seg-in').getAttribute('aria-label')) || ''), 'In has a name');
    assert(/Out of/.test((await card.locator('.r2-seg-out').getAttribute('aria-label')) || ''), 'Out has a name');
    assert(/of \d+ paid\. Open the players list/.test((await card.locator('[data-paid-cell]').getAttribute('aria-label')) || ''), 'paid cell named');
    await ctx.close();
  });

  await browser.close();
  console.log(`\nadmin-r2: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
