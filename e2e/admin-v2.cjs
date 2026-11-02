/* "New admin layout" (ADMIN_V2, Nov 2026): the organizer's History, Money and Home screens, version 2, plus the motion fix
 * (no rise on load, skeleton shimmer while loading).
 *
 *   node e2e/admin-v2.cjs      (also run by npm run test:e2e)
 *
 * Starts its own dev server with a fresh fake group. The switch is OFF there, so every check opens /admin with the private
 * test link (?adminv2=on) where it needs the new layout. Nothing here touches the live site. Screenshots: e2e/screenshots/admin-v2-*.png.
 */
const { spawn } = require('node:child_process');
const { rmSync, mkdirSync } = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.E2E_PORT) || 5276;
const BASE = `http://localhost:${PORT}`;
const SETUP_TOKEN = 'admin-v2-setup-token-0123456789';
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
  const dbFile = path.join(ROOT, '.data', 'admin-v2.sqlite');
  mkdirSync(path.join(ROOT, '.data'), { recursive: true });
  rmSync(dbFile, { force: true });
  const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
    cwd: ROOT,
    env: { ...process.env, DEV_DB: dbFile, SETUP_TOKEN, DEV_CLOCK: '1', MOTION: '', MOTION_ADMIN: '', ADMIN_V2: '' },
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
  async function openAdmin({ width = 390, scheme = 'light', v2 = true, motion = false, extra = {} } = {}) {
    const ctx = await browser.newContext(phone(width, scheme, extra));
    await post(ctx.request, '/api/admin/login', { pin: PIN });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/admin?${v2 ? 'adminv2=on' : 'adminv2=off'}${motion ? '&motionadmin=on' : ''}`);
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
  const shot = (page, name, full = true) => page.screenshot({ path: path.join(SHOTS, `admin-v2-${name}.png`), fullPage: full });

  // ---------------------------------------------------------------- the switch
  await check('S off by default: the old layout, exactly (no new parts on Home, Money or History)', async () => {
    const { ctx, page } = await openAdmin({ v2: false });
    assert((await page.locator('.hv2-short, .hv2-open, .money-v2, .history-v2').count()) === 0, 'no new parts on Home');
    assert((await page.locator('article.scard').count()) >= 6, 'every game is a full card');
    assert((await page.locator('[data-task="court_book"]').count()) >= 1, 'the old Court still needs to be booked card is there');
    await tab(page, 'Money');
    assert((await page.locator('.money-v2').count()) === 0 && (await page.getByText('Monthly money').count()) === 1, 'old Money tab');
    await tab(page, 'History');
    assert((await page.locator('.history-v2').count()) === 0, 'old History');
    assert((await page.locator('.chip-btn[aria-pressed="true"]').innerText()) === 'Sessions', 'old History opens on Sessions');
    await ctx.close();
  });

  await check('S private link: ?adminv2=on is for that phone only, ?adminv2=off ends it', async () => {
    const a = await openAdmin();
    assert((await a.page.locator('.hv2-short').count()) > 0, 'on for this phone');
    const b = await openAdmin({ v2: false });
    assert((await b.page.locator('.hv2-short').count()) === 0, 'another phone stays off');
    await a.page.goto(`${BASE}/admin?adminv2=off`);
    await a.page.locator('article.scard').first().waitFor();
    assert((await a.page.locator('.hv2-short').count()) === 0, 'off again');
    await a.ctx.close();
    await b.ctx.close();
  });

  await check('S Settings > Feature switches > New admin layout turns it on for every phone, no deploy', async () => {
    const a = await openAdmin({ v2: false });
    await tab(a.page, 'Settings');
    const sect = a.page.locator('details[data-section="switches"]');
    assert((await sect.count()) === 1 && (await sect.locator('summary').innerText()).includes('Feature switches'), 'collapsed section exists');
    assert(!(await sect.evaluate((e) => e.open)), 'collapsed');
    await sect.locator('summary').click();
    assert((await sect.getByText('New admin layout').count()) >= 1, 'the row');
    await a.page.locator('[data-admin-v2-all]').check();
    await a.page.waitForTimeout(700);
    const b = await openAdmin({ v2: false });
    assert((await b.page.locator('.hv2-short').count()) > 0, 'a phone with no link now sees the new layout');
    await a.page.locator('[data-admin-v2-all]').uncheck();
    await a.page.waitForTimeout(700);
    const c = await openAdmin({ v2: false });
    assert((await c.page.locator('.hv2-short').count()) === 0, 'and off again');
    await a.ctx.close();
    await b.ctx.close();
    await c.ctx.close();
  });

  // ---------------------------------------------------------------- 1. History
  await check('1 History: two tabs only, Activity first, no All; Sessions is the old list', async () => {
    const { ctx, page } = await openAdmin();
    await tab(page, 'History');
    const chips = await page.locator('.history-v2 .chip-btn').allInnerTexts();
    assert(JSON.stringify(chips) === JSON.stringify(['Activity', 'Sessions']), `tabs ${chips}`);
    assert((await page.locator('.chip-btn[aria-pressed="true"]').innerText()) === 'Activity', 'opens on Activity');
    assert((await page.locator('ul.activity-list li').count()) > 5, 'activity rows');
    await page.locator('.chip-btn', { hasText: 'Sessions' }).click();
    assert((await page.getByText('No played sessions yet.').count()) + (await page.locator('ul.history-list').count()) === 1, 'the old sessions list');
    await ctx.close();
  });

  await check('1 History: first visit has no NEW group; later it splits NEW and VIEWED, and holds while you stay', async () => {
    const { ctx, page } = await openAdmin();
    await tab(page, 'History');
    await page.locator('ul.activity-list li').first().waitFor();
    assert((await page.locator('[data-divider]').count()) === 0, 'first visit: no divider');
    await tab(page, 'Home'); // leaving the tab marks the visit
    await sleep(1100);
    await join('Julian', B);
    await join('Mitchel', B);
    await tab(page, 'History');
    await page.locator('[data-divider="new"]').waitFor();
    const label = await page.locator('[data-divider="new"]').innerText();
    assert(/new since/i.test(label) && /· 2$/.test(label.trim()), `NEW label "${label}"`);
    assert((await page.locator('[data-divider="viewed"]').count()) === 1, 'VIEWED divider');
    assert((await page.locator('ul[aria-label="New activity"] li').count()) === 2, 'two new rows');
    // Staying on History (even switching sub-tabs) keeps NEW.
    await page.locator('.chip-btn', { hasText: 'Sessions' }).click();
    await page.locator('.chip-btn', { hasText: 'Activity' }).click();
    assert((await page.locator('[data-divider="new"]').count()) === 1, 'NEW stays while on the tab');
    await tab(page, 'Money');
    await tab(page, 'History');
    await page.locator('ul.activity-list li').first().waitFor();
    assert((await page.locator('[data-divider]').count()) === 0, 'next visit: nothing new');
    await shot(page, 'history-390-light');
    await ctx.close();
  });

  await check('1 History: tapping the History tab again does not wipe NEW; events that arrive while you stay are still new next time', async () => {
    const { ctx, page } = await openAdmin();
    await tab(page, 'History');
    await page.locator('ul.activity-list li').first().waitFor();
    await tab(page, 'Home');
    await sleep(1100);
    await join('Brandon', C);
    await tab(page, 'History');
    await page.locator('[data-divider="new"]').waitFor();
    await tab(page, 'History'); // the same tab again
    await page.waitForTimeout(400);
    assert((await page.locator('[data-divider="new"]').count()) === 1, 'NEW is still there after tapping the tab again');
    // Something happens while we stay (the list is not reloaded), then we leave: it is new on the next visit.
    await sleep(1100);
    await join('Mitchel', C);
    await tab(page, 'Home');
    await tab(page, 'History');
    await page.locator('[data-divider="new"]').waitFor();
    assert(/· 1$/.test((await page.locator('[data-divider="new"]').innerText()).trim()), 'the event that was never shown is new');
    await ctx.close();
  });

  // ---------------------------------------------------------------- 2. Money
  await check('2 Money: slim control row, no big heading, always opens on Who paid', async () => {
    const { ctx, page } = await openAdmin();
    await tab(page, 'Money');
    assert((await page.getByText('Monthly money').count()) === 0, 'big heading gone');
    assert((await page.locator('.month-label').innerText()).trim().match(/^[A-Z][a-z]{2} \d{4}$/), 'short month label');
    const pressed = () => page.locator('.mv2-controls .segmented button[aria-pressed="true"]').innerText();
    assert((await pressed()) === 'Who paid', 'Who paid first');
    await page.locator('.mv2-controls .segmented button', { hasText: 'Totals' }).click();
    assert((await pressed()) === 'Totals', 'switched');
    await tab(page, 'Home');
    await tab(page, 'Money');
    assert((await pressed()) === 'Who paid', 'never remembers the last view');
    await ctx.close();
  });

  await check('2 Money: next game open, the rest closed, any number open, one line each when closed', async () => {
    const { ctx, page } = await openAdmin();
    await tab(page, 'Money');
    const games = page.locator('.mv2-game');
    assert((await games.first().getAttribute('data-open')) === 'yes', 'next game open');
    const closed = await page.locator('.mv2-game[data-open="no"]').count();
    assert(closed >= 3, `others closed (${closed})`);
    const second = games.nth(1);
    assert((await second.locator('.mv2-headchip .chip').count()) === 1, 'closed game has a status chip');
    await second.locator('.mv2-toggle').click();
    assert((await games.first().getAttribute('data-open')) === 'yes' && (await second.getAttribute('data-open')) === 'yes', 'two open at once');
    await games.first().locator('.mv2-toggle').click();
    assert((await games.first().getAttribute('data-open')) === 'no', 'folds again');
    await ctx.close();
  });

  await check('2 Money: every row uses the same three columns (name, chip, button) and they line up', async () => {
    const { ctx, page } = await openAdmin();
    await tab(page, 'Money');
    const rows = page.locator('.mv2-game').first().locator('.mv2-row');
    const n = await rows.count();
    assert(n >= 5, `rows ${n}`);
    const boxes = [];
    for (let i = 0; i < n; i++) {
      const r = rows.nth(i);
      const chip = await r.locator('.chip').boundingBox();
      const btn = await r.locator('.mv2-btncell .btn').boundingBox();
      const name = await r.locator('.mv2-who').boundingBox();
      assert(btn && chip && name, `row ${i} parts`);
      boxes.push({ chip, btn, name });
    }
    const same = (k, f) => boxes.every((b) => Math.abs(f(b[k]) - f(boxes[0][k])) <= 1.5);
    // The court row sits in a box that reaches 8 px into the card padding; compare player rows to each other, court to them by right edge.
    const players = boxes.slice(0, -1);
    const eq = (f) => players.every((b) => Math.abs(f(b) - f(players[0])) <= 1.5);
    assert(eq((b) => b.chip.x) && eq((b) => b.chip.width) && eq((b) => b.btn.x) && eq((b) => b.btn.width) && eq((b) => b.name.x), 'player rows: same columns');
    const court = boxes[boxes.length - 1];
    assert(Math.abs(court.chip.x - players[0].chip.x) <= 1.5 && Math.abs(court.btn.x - players[0].btn.x) <= 1.5, 'court row: same columns');
    void same;
    await shot(page, 'money-who-390-light');
    await ctx.close();
  });

  await check('2 Money: Mark paid and Unmark still work, paid count updates, the court row Mark paid works', async () => {
    const { ctx, page } = await openAdmin();
    await tab(page, 'Money');
    const g = page.locator(`.mv2-game[data-session="${A.id}"]`);
    const row = (n) => g.locator(`.mv2-row[data-pay-row="${n}"]`);
    await row('Julian').locator('.btn', { hasText: 'Mark paid' }).click();
    await page.locator('.pop.toast').first().waitFor();
    await page.waitForTimeout(500);
    assert((await row('Julian').locator('.chip').innerText()).includes('Paid'), 'Julian paid');
    assert((await payOf(A, 'Julian')).paymentStatus === 'paid', 'saved on the server');
    await row('Julian').locator('.btn', { hasText: 'Unmark' }).click();
    await page.waitForTimeout(700);
    assert((await payOf(A, 'Julian')).paymentStatus !== 'paid', 'unmarked on the server');
    const courtBtn = g.locator('.mv2-row.court .btn');
    await courtBtn.click();
    await page.waitForTimeout(700);
    assert((await (await dash()).sessions.find((s) => s.id === A.id)).court.paid === true, 'court marked paid');
    await g.locator('.mv2-row.court .btn', { hasText: 'Unmark' }).click();
    await page.waitForTimeout(600);
    await ctx.close();
  });

  await check('2 Money: tapping a row shows the whole line, a self-marked payment keeps Mark paid and Unmark', async () => {
    const { ctx, page } = await openAdmin();
    await tab(page, 'Money');
    const g = page.locator(`.mv2-game[data-session="${A.id}"]`);
    const ry = g.locator('.mv2-row[data-pay-row="Ryan"]');
    const short = await ry.locator('.mv2-line').innerText();
    await ry.locator('.mv2-who').click();
    const full = await ry.locator('.mv2-line').innerText();
    assert(full.length > short.length && /paid \$14 on /.test(full) && /not finalized yet/.test(full), `full text "${full}"`);
    const mit = g.locator('.mv2-row[data-pay-row="Mitchel"]');
    if (selfPaid.ok() && (await payOf(A, 'Mitchel')).selfPaid) {
      await mit.locator('.mv2-who').click();
      assert((await mit.locator('.mv2-btncell .btn').innerText()) === 'Mark paid' && (await mit.locator('.mv2-extra .btn').innerText()) === 'Unmark', 'both actions reachable');
      assert((await mit.locator('.mv2-line').innerText()).includes('self-marked'), 'self-marked shown');
    }
    await ctx.close();
  });

  await check('2 Money: Remind N opens a list, each unpaid player has their own Text link to ONE number with today\'s reminder', async () => {
    const { ctx, page } = await openAdmin();
    await tab(page, 'Money');
    const g = page.locator(`.mv2-game[data-session="${A.id}"]`);
    const unpaid = (await payOf(A, 'Julian')).paymentStatus !== 'paid' ? 2 : 1; // Julian, Nathan (Mitchel may be self-marked)
    const label = await g.locator('[data-remind]').innerText();
    const n = Number(label.replace(/\D/g, ''));
    assert(n >= unpaid, `Remind ${n}`);
    await g.locator('[data-remind]').click();
    const sheet = page.locator('dialog[open]');
    await sheet.waitFor();
    const items = sheet.locator('[data-remind-row]');
    assert((await items.count()) === n, 'one entry per unpaid player');
    for (let i = 0; i < n; i++) {
      const a = items.nth(i).locator('a');
      const href = decodeURIComponent(await a.getAttribute('href'));
      const who = await items.nth(i).getAttribute('data-remind-row');
      assert(/^sms:/.test(href), `sms link ${href}`);
      const nums = (href.match(/\d{10}/g) || []).length;
      assert(nums === 1 && !/,.*\d{10}/.test(href.split('&')[0].split('?')[0]), `exactly one recipient for ${who}: ${href}`);
      assert(href.includes(who) && href.includes('$14'), `today's reminder text for ${who}`);
    }
    await shot(page, 'money-remind-390-light', false);
    await page.keyboard.press('Escape');
    await ctx.close();
  });

  await check('2 Money: a canceled game is one closed line, opening shows what it showed before', async () => {
    const { ctx, page } = await openAdmin();
    await tab(page, 'Money');
    const g = page.locator(`.mv2-game[data-session="${F.id}"]`);
    assert((await g.getAttribute('data-open')) === 'no', 'closed');
    assert((await g.locator('.mv2-sub').innerText()).includes('canceled'), 'says canceled');
    await g.locator('.mv2-toggle').click();
    assert((await g.getByText('Session canceled').count()) === 1 && (await g.getByText('Brandon').count()) >= 1, 'notice and credit list');
    await ctx.close();
  });

  await check('2 Money: Totals shows the same numbers as the money API, in a grid that fits one screen (390x844, 375x667, 360x740)', async () => {
    for (const [w, h] of [[390, 844], [375, 667], [360, 740]]) {
      const ctx = await browser.newContext({ ...phone(w), viewport: { width: w, height: h } });
      await post(ctx.request, '/api/admin/login', { pin: PIN });
      const page = await ctx.newPage();
      await page.goto(`${BASE}/admin?adminv2=on`);
      await page.locator('article.scard').first().waitFor();
      await tab(page, 'Money');
      await page.locator('.mv2-controls .segmented button', { hasText: 'Totals' }).click();
      await page.locator('[data-totals]').waitFor();
      await page.waitForTimeout(400);
      const labels = (await page.locator('.mv2-cell dt').allInnerTexts()).map((t) => t.toLowerCase());
      assert(JSON.stringify(labels) === JSON.stringify(['collected', 'court costs', 'credits owed', 'held', 'membership', 'sessions played']), `labels ${labels}`);
      const p = new Date(Date.now());
      const month = `${p.getFullYear()}-${String(p.getMonth() + 1).padStart(2, '0')}`;
      const m = await (await ctx.request.get(`${BASE}/api/admin/money?month=${month}`)).json();
      const money = (c) => `$${(c / 100).toLocaleString('en-US', { minimumFractionDigits: c % 100 ? 2 : 0 })}`;
      const cells = await page.locator('.mv2-cell dd').allInnerTexts();
      assert(cells[0].trim() === money(m.collectedCents) && cells[3].trim() === money(m.heldCents) && cells[4].trim() === money(m.membershipCents), `numbers ${cells} vs ${m.collectedCents}/${m.heldCents}/${m.membershipCents}`);
      assert((await page.getByText(/Sessions in /).count()) === 1, 'Sessions row');
      // Everything (down to the Sessions row) sits above the tab bar with no scrolling.
      const sc = await page.evaluate(() => ({ bottom: document.querySelector('.money-sess').getBoundingClientRect().bottom, bar: document.querySelector('.tabbar').getBoundingClientRect().top, y: window.scrollY }));
      assert(sc.y === 0 && sc.bottom <= sc.bar, `fits one screen at ${w}x${h}: content ends ${Math.round(sc.bottom)}, tab bar starts ${Math.round(sc.bar)}`);
      if (w === 390) await shot(page, 'money-totals-390-light', false);
      await ctx.close();
    }
  });

  // ---------------------------------------------------------------- 3. Home
  await check('3 Home: the top 2 games are full cards, later games are short rows with count, time, names, pill, chevron', async () => {
    const { ctx, page } = await openAdmin();
    assert((await page.locator('article.scard').count()) === 2, 'two full cards');
    const rows = page.locator('.hv2-short');
    assert((await rows.count()) >= 3, 'short rows');
    const r = rows.first();
    const t = (await r.innerText()).replace(/\s+/g, ' ');
    assert(/\d of 4 in · \d/.test(t) && /(Booked|Not booked|Waitlist)/.test(t), `row text "${t}"`);
    assert((await r.locator('.tile').count()) === 1 && (await r.locator('.hv2-chev').count()) === 1, 'tile and chevron');
    // A card keeps everything it had.
    const c = page.locator('article.scard').first();
    assert((await c.locator('.court-switch').count()) === 1 && (await c.locator('button.icon-round').count()) === 1 && (await c.locator('.paid-pill').count()) === 1, 'switch, gear, paid pill');
    assert((await page.getByText('+ Add game').count()) === 1 && (await page.getByText('Book a court').count()) >= 1, 'Add game and Book a court stay in the header');
    assert((await page.locator('.week-break').count()) >= 3, 'week labels stay');
    await shot(page, 'home-390-light');
    await ctx.close();
  });

  await check('3 Home: tap the date tile or empty space to open or fold; any number open; buttons never fold; a reload goes back to the top 2', async () => {
    const { ctx, page } = await openAdmin();
    const short = page.locator('.hv2-short');
    const id = await short.first().getAttribute('data-session');
    await short.first().locator('.tile').click();
    await page.locator(`article#session-${id}`).waitFor();
    assert((await page.locator('article.scard').count()) === 3, 'three open');
    // The court switch does its job and does not fold.
    await page.locator(`article#session-${id} .court-switch button[aria-pressed="false"]`).first().click();
    await page.waitForTimeout(500);
    assert((await page.locator(`article#session-${id}`).count()) === 1, 'a button tap does not fold');
    await page.locator(`article#session-${id} .court-switch button[data-seg="not_booked"]`).click();
    await page.waitForTimeout(500);
    // Empty space on an open card folds it (the strip under the names is empty space).
    const box = await page.locator(`article#session-${id} .scard-tilecol`).boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height - 2);
    await page.waitForTimeout(300);
    assert((await page.locator(`article#session-${id}`).count()) === 0 && (await page.locator(`#session-${id}.hv2-short`).count()) === 1, 'tile area folds it');
    // Any empty space on a short row opens it; several can be open.
    await page.locator(`#session-${id}.hv2-short`).click({ position: { x: 150, y: 8 } });
    await page.locator(`article#session-${id}`).waitFor();
    await page.locator('.hv2-short').first().click({ position: { x: 150, y: 8 } });
    await page.waitForTimeout(300);
    assert((await page.locator('article.scard').count()) === 4, 'four open at once');
    await page.reload();
    await page.locator('article.scard').first().waitFor();
    assert((await page.locator('article.scard').count()) === 2, 'nothing remembered: back to the top 2');
    await ctx.close();
  });

  await check('3 Home: "Court still needs to be booked" is on the game that needs it, with Book a court; the alert card is gone', async () => {
    const { ctx, page } = await openAdmin();
    assert((await page.locator('[data-task="court_book"]').count()) === 0, 'no separate alert card');
    const need = page.locator('.hv2-short .hv2-need').first();
    assert((await need.count()) === 1, 'the short row says it');
    const id = await need.locator('xpath=ancestor::div[@data-session]').getAttribute('data-session');
    await page.locator(`#session-${id}.hv2-short`).click({ position: { x: 150, y: 8 } });
    const card = page.locator(`article#session-${id}`);
    await card.waitFor();
    assert((await card.locator('[data-court-need]').count()) === 1, 'message on the card');
    const link = card.locator('.court-need-btn a');
    assert((await link.count()) === 1 && /courtreserve/i.test(await link.getAttribute('href')) && (await link.getAttribute('target')) === '_blank', 'Book a court link opens CourtReserve in a new tab');
    // Cash out and Do-this-now cards that are not about the court stay (the old layout's others are untouched code).
    await shot(page, 'home-open-need-390-light');
    await ctx.close();
  });

  await check('3 Home: tapping blank card space to close the gear pop-up does not fold the card; the keyboard can open and fold and keeps its place', async () => {
    const { ctx, page } = await openAdmin();
    const card = page.locator('article.scard').first();
    const id = (await card.getAttribute('id')).replace('session-', '');
    await card.locator('button.icon-round').click();
    await page.locator('.menu-pop').waitFor();
    const box = await card.locator('.scard-tilecol').boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height - 2);
    await page.waitForTimeout(300);
    assert((await page.locator('.menu-pop').count()) === 0 && (await page.locator(`article#session-${id}`).count()) === 1, 'the menu closed and the card stayed open');
    // Keyboard: Enter on a short row opens it and focus lands on the opened card.
    const short = page.locator('.hv2-short').first();
    const sid = await short.getAttribute('data-session');
    await short.focus();
    await page.keyboard.press('Enter');
    await page.locator(`article#session-${sid}`).waitFor();
    await page.waitForTimeout(150);
    assert((await page.evaluate(() => document.activeElement && document.activeElement.id)) === `session-${sid}`, 'focus is on the opened card');
    await ctx.close();
  });

  await check('3 Home: "Show all" and every old action still work (court switch, edit, I\'m in)', async () => {
    const { ctx, page } = await openAdmin();
    const card = page.locator('article.scard').first();
    const id = (await card.getAttribute('id')).replace('session-', '');
    await card.locator('button.icon-round').click();
    await card.locator('[role="menuitem"]', { hasText: 'Edit game' }).click();
    await page.locator('dialog[open]').waitFor();
    assert((await page.locator('article.scard').count()) === 2, 'the edit pop-up did not fold the card');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    assert((await page.locator(`article#session-${id}`).count()) === 1, 'card still open');
    await page.getByRole('button', { name: /Show all/ }).click();
    assert((await page.locator('.hv2-short').count()) >= 8, 'show all');
    await ctx.close();
  });

  // ---------------------------------------------------------------- 5. Label on Edit game
  await check('5 Edit game: a Label field in the same style as Date and Start, prefilled, saved with Save; the old sheet has none', async () => {
    const off = await openAdmin({ v2: false });
    await off.page.locator('article.scard').first().locator('button.icon-round').click();
    await off.page.locator('[role="menuitem"]', { hasText: 'Edit game' }).click();
    await off.page.locator('dialog[open]').waitFor();
    assert((await off.page.locator('[data-label-field]').count()) === 0, 'no Label field with the switch off');
    await off.ctx.close();
    const { ctx, page } = await openAdmin();
    const card = page.locator(`article#session-${A.id}`);
    await card.locator('button.icon-round').click();
    await card.locator('[role="menuitem"]', { hasText: 'Edit game' }).click();
    const sheet = page.locator('dialog[open]');
    await sheet.waitFor();
    const field = sheet.locator('[data-label-field]');
    assert((await field.count()) === 1, 'Label field');
    assert((await field.evaluate((e) => e.className)) === (await sheet.locator('label.field', { hasText: 'Date' }).evaluate((e) => e.className)), 'same style as Date');
    assert((await field.locator('input').inputValue()) === '', 'empty now');
    await field.locator('input').fill("Veteran's Day");
    await sheet.getByRole('button', { name: 'Save' }).click();
    await page.locator('.pop.toast').first().waitFor();
    await page.waitForTimeout(600);
    assert((await card.locator('.game-note').innerText()).includes("Veteran's Day"), 'label shows on the card');
    assert((await (await dash()).sessions.find((x) => x.id === A.id)).note === "Veteran's Day", 'saved');
    // Prefilled next time, and clearing it works.
    await card.locator('button.icon-round').click();
    await card.locator('[role="menuitem"]', { hasText: 'Edit game' }).click();
    await sheet.waitFor();
    assert((await sheet.locator('[data-label-field] input').inputValue()) === "Veteran's Day", 'prefilled');
    await sheet.locator('[data-label-field] input').fill('');
    await sheet.getByRole('button', { name: 'Save' }).click();
    await page.waitForTimeout(900);
    assert((await (await dash()).sessions.find((x) => x.id === A.id)).note === null, 'cleared');
    await ctx.close();
  });

  // ---------------------------------------------------------------- 6. Remove a canceled game from the player screen
  await check('6 gear menu: "Remove from player screen" only on a canceled game and only with the new layout; it hides, never deletes; undo works', async () => {
    const playerSees = async () => ((await (await phones['Ryan'].get(`${BASE}/api/group`)).json()).sessions || []).some((x) => x.id === F.id);
    assert(await playerSees(), 'players see the canceled game today');
    const off = await openAdmin({ v2: false });
    await off.page.getByRole('button', { name: /Show all/ }).click().catch(() => {});
    await off.page.locator(`#session-${F.id} button.icon-round`).click();
    assert((await off.page.locator('[data-hide-game]').count()) === 0, 'not in the old menu');
    await off.ctx.close();
    const { ctx, page } = await openAdmin();
    await page.getByRole('button', { name: /Show all/ }).click();
    await page.locator(`#session-${F.id}.hv2-short`).click({ position: { x: 150, y: 8 } });
    const card = page.locator(`article#session-${F.id}`);
    await card.waitFor();
    // A game that is not canceled has no such row.
    await page.locator(`article#session-${A.id} button.icon-round`).click();
    assert((await page.locator('[data-hide-game]').count()) === 0, 'not on a live game');
    await page.keyboard.press('Escape');
    const moneyBefore = JSON.stringify((await (await areq.get(`${BASE}/api/admin/money?month=${new Date(F.startsAt).toISOString().slice(0, 7)}`)).json()));
    await card.locator('button.icon-round').click();
    await page.locator('[data-hide-game]', { hasText: 'Remove from player screen' }).click();
    await page.locator('.pop.toast').first().waitFor();
    await page.waitForTimeout(700);
    assert((await card.locator('[data-hidden-tag]').count()) === 1, 'the card says Not shown to players');
    assert(!(await playerSees()), 'players no longer see it');
    assert(!(await playerSees()), 'still hidden after another refresh');
    // Still there for the organizer: Home, Money.
    assert((await page.locator(`article#session-${F.id}`).count()) === 1, 'still on organizer Home');
    await tab(page, 'Money');
    assert((await page.locator(`.mv2-game[data-session="${F.id}"]`).count()) === 1, 'still in Money');
    assert(JSON.stringify((await (await areq.get(`${BASE}/api/admin/money?month=${new Date(F.startsAt).toISOString().slice(0, 7)}`)).json())) === moneyBefore, 'Money numbers unchanged');
    await tab(page, 'Home');
    await page.getByRole('button', { name: /Show all/ }).click();
    await page.locator(`#session-${F.id}.hv2-short`).click({ position: { x: 150, y: 8 } });
    await page.locator(`article#session-${F.id} button.icon-round`).click();
    await page.locator('[data-hide-game]', { hasText: 'Show on player screen again' }).click();
    await page.locator('.pop.toast').first().waitFor();
    await page.waitForTimeout(700);
    assert(await playerSees(), 'undo: players see it again');
    assert((await page.locator(`article#session-${F.id} [data-hidden-tag]`).count()) === 0, 'tag gone');
    await ctx.close();
  });

  // ---------------------------------------------------------------- look: sizes, themes, big text
  await check('L every new screen: no sideways scroll at 320 and 390, light and dark, and at 200% text', async () => {
    for (const [w, scheme, big] of [[320, 'light', false], [390, 'dark', false], [320, 'light', true], [390, 'light', true]]) {
      const { ctx, page } = await openAdmin({ width: w, scheme });
      if (big) await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
      await page.waitForTimeout(300);
      const wide = await page.evaluate(() => [...document.querySelectorAll('body *')].filter((e) => e.getBoundingClientRect().right > document.documentElement.clientWidth + 1 && getComputedStyle(e).position !== 'fixed' && !e.closest('.week-break, .players-after, .tabbar')).slice(0, 4).map((e) => `${e.tagName}.${e.className}`));
      // (The "+ Add game" and "Book a court" pills on the week line, the organizer's own I'm in on a full card, and the tab bar already overflow at 200% on 320 px with the switch off: not part of this change.)
      assert(wide.length === 0, `Home ${w} ${scheme} big=${big}: overflow from ${wide}`);
      await tab(page, 'Money');
      await page.locator('.mv2-game').first().waitFor();
      await page.locator('.mv2-game').nth(1).locator('.mv2-toggle').click();
      await noOverflow(page, `Who paid ${w} ${scheme} big=${big}`);
      // Nothing cut off: every chip and button sits inside its game card.
      const out = await page.evaluate(() =>
        [...document.querySelectorAll('.mv2-game')].flatMap((g) => {
          const gb = g.getBoundingClientRect();
          return [...g.querySelectorAll('.chip, .mv2-btncell .btn')].filter((e) => { const b = e.getBoundingClientRect(); return b.right > gb.right + 0.5 || b.left < gb.left - 0.5; }).map((e) => e.textContent);
        }),
      );
      assert(out.length === 0, `cut off: ${out}`);
      await page.locator('.mv2-controls .segmented button', { hasText: 'Totals' }).click();
      await page.locator('[data-totals]').waitFor();
      await noOverflow(page, `Totals ${w} ${scheme} big=${big}`);
      await tab(page, 'History');
      await noOverflow(page, `History ${w} ${scheme} big=${big}`);
      if (!big) {
        await tab(page, 'Money');
        await shot(page, `money-totals-${w}-${scheme}`, false);
      }
      await ctx.close();
    }
  });

  await check('L reduced motion: opening and folding does not animate', async () => {
    const { ctx, page } = await openAdmin({ extra: { reducedMotion: 'reduce' } });
    await page.locator('.hv2-short').first().click({ position: { x: 150, y: 8 } });
    await page.waitForTimeout(30);
    const names = await page.evaluate(() => document.getAnimations().map((a) => a.animationName).filter((n) => n === 'hv2-fade'));
    assert(names.length === 0, 'no fade with Reduce Motion');
    await ctx.close();
  });

  // ---------------------------------------------------------------- 4. Motion
  await check('4 motion: no card rises in when a screen loads (MOTION_ADMIN on), content appears in place', async () => {
    for (const v2 of [false, true]) {
      const ctx = await browser.newContext(phone(390));
      await post(ctx.request, '/api/admin/login', { pin: PIN });
      const page = await ctx.newPage();
      await page.addInitScript(() => {
        window.__anims = [];
        const grab = () => document.getAnimations().forEach((a) => window.__anims.push(a.animationName));
        setInterval(grab, 16);
      });
      await page.goto(`${BASE}/admin?motionadmin=on&adminv2=${v2 ? 'on' : 'off'}`);
      await page.locator('article.scard').first().waitFor();
      await page.waitForTimeout(1200);
      const cls = await page.evaluate(() => document.querySelector('main').className);
      const rises = await page.evaluate(() => window.__anims.filter((n) => n === 'm-rise').length);
      assert(!cls.includes('m-cascade') && rises === 0, `v2=${v2}: cascade ${cls} rises ${rises}`);
      await ctx.close();
    }
  });

  await check('4 motion: while loading, the soft placeholder cards (player shimmer) show after 250 ms instead of the bouncing ball', async () => {
    const ctx = await browser.newContext(phone(390));
    await post(ctx.request, '/api/admin/login', { pin: PIN });
    const page = await ctx.newPage();
    await page.addInitScript(() => localStorage.setItem('pb_motion_admin_test', 'on'));
    await ctx.route('**/api/admin/dashboard', async (route) => {
      await sleep(1500);
      await route.continue();
    });
    await page.goto(`${BASE}/admin`);
    await page.locator('.admin-loading').waitFor({ state: 'attached' });
    assert((await page.locator('.skel').count()) === 0, 'nothing drawn in the first 250 ms');
    await page.waitForTimeout(500);
    assert((await page.locator('.skel').count()) > 3, 'placeholders after 250 ms');
    assert((await page.locator('.m-loading-ball').count()) === 0, 'no bouncing ball');
    const anim = await page.evaluate(() => getComputedStyle(document.querySelector('.skel')).animationName);
    assert(anim === 'skel-shimmer', `shimmer ${anim}`);
    await page.locator('article.scard').first().waitFor({ timeout: 8000 });
    assert((await page.locator('.skel').count()) === 0, 'gone when loaded');
    await ctx.close();
  });

  await browser.close();
  console.log(`\nadmin-v2: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
