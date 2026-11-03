/* "Admin screens, round 3" (ADMIN_R3, Nov 2026): Edit game, Add game, Settings clean-up, Players layout.
 *
 *   node e2e/admin-r3.cjs      (also run by npm run test:e2e)
 *
 * Starts its own dev server with a fresh fake group. The switch is OFF there, so every check opens /admin with the private test
 * links (?adminr2=on&adminr3=on) where it needs the new screens. Nothing here touches the live site. Screenshots: e2e/screenshots/admin-r3-*.png.
 */
const { spawn } = require('node:child_process');
const { rmSync, mkdirSync } = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.E2E_PORT) || 5283;
const BASE = `http://localhost:${PORT}`;
const SETUP_TOKEN = 'admin-r3-setup-token-0123456789';
const PIN = '482913';
const NAMES = ['Alex', 'Alec', 'Armen', 'Ryan', 'Brandon', 'Julian', 'Mitchel', 'Nathan', 'Peter', 'Test'];
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
  const dbFile = path.join(ROOT, '.data', 'admin-r3.sqlite');
  mkdirSync(path.join(ROOT, '.data'), { recursive: true });
  rmSync(dbFile, { force: true });
  const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
    cwd: ROOT,
    env: { ...process.env, DEV_DB: dbFile, SETUP_TOKEN, DEV_CLOCK: '1', MOTION: '', MOTION_ADMIN: '', ADMIN_V2: '', ADMIN_R2: '', ADMIN_R3: '' },
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
  const dash = async () => (await areq.get(`${BASE}/api/admin/dashboard`, { headers: { 'X-Admin-R2': 'on', 'X-Admin-R3': 'on' } })).json();
  let d = await dash();
  for (const h of d.hiddenSessions || []) await post(areq, `/api/admin/sessions/${h.id}/show`, { shown: true });
  await put(areq, '/api/admin/group', { organizerName: 'Alex' });
  d = await dash();
  const idOf = (n) => d.players.find((p) => p.name === n).id;
  const phones = {};
  for (const n of NAMES) {
    const c = await browser.newContext();
    await post(c.request, '/api/me', { playerId: idOf(n) });
    phones[n] = c.request;
  }
  const join = (n, s) => post(phones[n], `/api/sessions/${s.id}/join`, {});
  const ahead = d.sessions.filter((s) => Date.parse(s.startsAt) > Date.now() + 36 * 3600_000);
  const [A, B] = ahead;
  for (const s of [A, B]) await post(areq, `/api/admin/sessions/${s.id}/booked`, {});
  const payOf = async (s, name) => (await dash()).sessions.find((x) => x.id === s.id).roster.find((r) => r.name === name);
  const markPaid = async (s, name) => {
    const r = await payOf(s, name);
    return post(areq, `/api/admin/sessions/${s.id}/payment`, { playerId: r.playerId, paid: true, seen: r.moneySeen, cents: r.owesCents });
  };
  // Game A: five paid, then played and finalized (six play with the organizer: $9 each, $5 back). Game B: Mitchel paid ($14 held).
  const five = ['Alec', 'Armen', 'Ryan', 'Brandon', 'Julian'];
  for (const n of five) await join(n, A);
  await post(areq, `/api/admin/sessions/${A.id}/me`, { in: true });
  for (const n of five) await markPaid(A, n);
  await join('Mitchel', B);
  await join('Nathan', B);
  await markPaid(B, 'Mitchel');
  await fetch(`${BASE}/__dev/clock`, { method: 'POST', body: JSON.stringify({ atMs: Date.parse(A.endsAt) + 3600_000 }) });
  const fin = await post(areq, `/api/admin/sessions/${A.id}/finalize`, { everyone: true });
  if (!fin.ok()) throw new Error(`finalize failed: ${await fin.text()}`);
  await put(areq, `/api/admin/players/${idOf('Test')}`, { name: 'Test', isActive: false });
  // The clock stays just after game A, so its seven players have "played" and game B is the next one.
  await put(areq, '/api/admin/pay-always', { on: true });
  await put(areq, '/api/admin/time-shift', { on: false });

  const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mobile/15E148 Safari/604.1';
  const phone = (width, scheme = 'light', extra = {}, height = 640) => ({ viewport: { width, height }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: scheme, userAgent: UA, ...extra });
  async function openAdmin({ width = 360, height = 640, scheme = 'light', r3 = true, extra = {} } = {}) {
    const ctx = await browser.newContext(phone(width, scheme, extra, height));
    await post(ctx.request, '/api/admin/login', { pin: PIN });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/admin?adminr2=on&adminr3=${r3 ? 'on' : 'off'}`);
    await page.locator('article.scard').first().waitFor();
    return { ctx, page };
  }
  const tab = async (page, name) => {
    await page.locator('.tabbar button', { hasText: name }).evaluate((b) => b.click());
    await page.waitForTimeout(300);
  };
  const noOverflow = async (page, what) => {
    const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
    assert(o.sw <= o.cw + 1, `${what}: sideways overflow ${o.sw} > ${o.cw}`);
  };
  const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, `admin-r3-${name}.png`), fullPage: false });
  const openSheetFor = async (page, id) => {
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

  // ---------------------------------------------------------------- off: exactly as before
  await check('OFF: with round 3 off every screen is as before (old Players list, Court label, chips, Settings rows)', async () => {
    const { ctx, page } = await openAdmin({ r3: false });
    await openSheetFor(page, B.id);
    assert((await page.locator('dialog.sheet[open] #edit-court-label').count()) === 1, 'Court label is back');
    assert((await page.locator('form.edit-game-r3').count()) === 0, 'no round 3 class');
    await page.locator('dialog.sheet[open] .icon-btn').first().click();
    await page.waitForTimeout(300);
    await page.getByRole('button', { name: /\+ Add game/ }).first().click();
    assert((await page.locator('dialog.sheet[open] .chip-btn').count()) === 3, 'suggested-day chips are back');
    assert((await page.locator('dialog.sheet[open] input[type="time"]').count()) === 2, 'plain time boxes');
    await page.locator('dialog.sheet[open] .icon-btn').first().click();
    await page.waitForTimeout(300);
    await tab(page, 'Players');
    assert((await page.locator('[data-r3-players]').count()) === 0, 'old Players list');
    assert((await page.locator('.player-row .p-edit').count()) > 0, 'text Edit buttons');
    assert((await page.getByRole('button', { name: 'Add a person' }).count()) === 1, 'Add a person below the list');
    await tab(page, 'Settings');
    assert((await page.getByText('Appearance').count()) === 1, 'Appearance row is back');
    await page.locator('details[data-section="schedule"] summary').click();
    assert((await page.locator('[data-row="firstSessionDate"]').count()) === 1, 'First session date is back');
    assert((await page.locator('[data-row="timeShiftAll"]').count()) === 1, 'Moved-game notice in Schedule');
    assert((await page.locator('details[data-section="access"]').count()) === 1 && (await page.locator('details[data-section="pin"]').count()) === 1, 'Access and Change PIN sections');
    await page.locator('details[data-section="alerts"] summary').click();
    assert((await page.getByText('Send test alert').count()) === 1 && (await page.getByText('Send TEST smart alert').count()) === 1, 'two test buttons');
    await ctx.close();
  });

  // ---------------------------------------------------------------- Players
  await check('4 Players: every row the same height, one screen at 360 x 640 with 10 players + Add a person, no scrolling', async () => {
    const { ctx, page } = await openAdmin();
    await tab(page, 'Players');
    await page.locator('[data-r3-players]').waitFor();
    const m = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('[data-r3-players] > li:not(.r3-add)')];
      const tb = document.querySelector('.tabbar').getBoundingClientRect();
      const add = document.querySelector('.r3-add').getBoundingClientRect();
      return { n: rows.length, hs: rows.map((r) => Math.round(r.getBoundingClientRect().height * 10) / 10), addBottom: add.bottom, tabTop: tb.top, docH: document.documentElement.scrollHeight, winH: innerHeight };
    });
    assert(m.n === 10, `10 players listed, got ${m.n}`);
    assert(new Set(m.hs).size === 1, `all rows the same height: ${m.hs}`);
    assert(m.docH <= m.winH, `no scrolling: page ${m.docH} > screen ${m.winH}`);
    assert(m.addBottom <= m.tabTop, `Add a person (${m.addBottom}) sits above the tab bar (${m.tabTop})`);
    await shot(page, 'players-360');
    await ctx.close();
  });

  await check('4 Players: line 1 name, line 2 "N played · $X spent", pills only when not zero, hidden reads "Hidden · N played"', async () => {
    const { ctx, page } = await openAdmin();
    await tab(page, 'Players');
    const row = (n) => page.locator(`[data-r3-players] li[data-player="${n}"]`);
    assert((await row('Alec').locator('.r3-name').innerText()) === 'Alec', 'name on line 1');
    assert(/^1 played · \$9 spent$/.test(await row('Alec').locator('[data-r3-stats]').innerText()), `Alec line 2: ${await row('Alec').locator('[data-r3-stats]').innerText()}`);
    assert((await row('Alec').locator('[data-r3-credit]').innerText()) === '$5 credit', 'Alec credit pill');
    assert((await row('Alec').locator('[data-r3-held]').count()) === 0, 'no held pill for Alec');
    assert((await row('Mitchel').locator('[data-r3-held]').innerText()) === '$14 held', 'Mitchel held pill');
    assert((await row('Mitchel').locator('[data-r3-credit]').count()) === 0, 'no credit pill for Mitchel');
    assert(/^0 played · \$0 spent$/.test(await row('Nathan').locator('[data-r3-stats]').innerText()), 'Nathan has no pills and $0 spent');
    assert((await row('Nathan').locator('.r3-pill').count()) === 0, 'no pill at all for Nathan');
    assert((await row('Alex').locator('.r3-pill').count()) === 0, 'the organizer has no pills');
    assert((await row('Test').locator('[data-r3-stats]').innerText()) === 'Hidden · 0 played', 'hidden player stays in the list');
    // nothing else on the row: no phone, no Regular/Occasional, no Owes, no Edit word
    const t = await page.locator('[data-r3-players]').innerText();
    assert(!/Regular|Occasional|Owes|\(248\)/.test(t), `no old bits: ${t.slice(0, 200)}`);
    await ctx.close();
  });

  await check('4 Players: round gray gear (44 px tap) opens the same Edit sheet; Add a person is the last row inside the card', async () => {
    const { ctx, page } = await openAdmin();
    await tab(page, 'Players');
    const gear = page.locator('[data-r3-players] li[data-player="Alec"] [data-r3-gear]');
    const box = await gear.evaluate((e) => {
      const b = e.getBoundingClientRect();
      const pb = getComputedStyle(e, '::before');
      return { w: b.width, h: b.height + (parseFloat(pb.top) < 0 ? -2 * parseFloat(pb.top) : 0), radius: getComputedStyle(e, '::after').borderRadius };
    });
    assert(box.w >= 44 && box.h >= 44, `gear tap area ${box.w} x ${box.h}`);
    assert((await gear.locator('svg[data-icon="gear"]').count()) === 1, 'the Home gear icon');
    await gear.click();
    await page.locator('dialog.sheet[open]').getByText('Edit Alec').waitFor();
    assert((await page.locator('dialog.sheet[open] input').first().inputValue()) === 'Alec', 'same Edit sheet with the name');
    await page.locator('dialog.sheet[open] .icon-btn').first().click();
    await page.waitForTimeout(300);
    const last = page.locator('[data-r3-players] > li').last();
    assert(/Add a person/.test(await last.innerText()), 'Add a person is the last row');
    await last.locator('button').click();
    await page.locator('dialog.sheet[open]').getByText('Add a person').first().waitFor();
    await ctx.close();
  });

  await check('4 Players: zebra uses the existing off-white tint; works in dark; no sideways overflow at 320, 360, 430', async () => {
    for (const [w, scheme] of [[320, 'light'], [360, 'dark'], [430, 'light']]) {
      const { ctx, page } = await openAdmin({ width: w, scheme });
      await tab(page, 'Players');
      const bg = await page.evaluate(() => {
        const rows = [...document.querySelectorAll('[data-r3-players] > li')];
        return [getComputedStyle(rows[0]).backgroundColor, getComputedStyle(rows[1]).backgroundColor, getComputedStyle(rows[2]).backgroundColor, getComputedStyle(document.documentElement).getPropertyValue('--surface-2').trim()];
      });
      assert(bg[0] !== bg[1] && bg[0] === bg[2], `zebra at ${w} ${scheme}: ${bg}`);
      await noOverflow(page, `Players ${w}`);
      const hs = await page.evaluate(() => [...document.querySelectorAll('[data-r3-players] > li:not(.r3-add)')].map((r) => Math.round(r.getBoundingClientRect().height)));
      assert(new Set(hs).size === 1, `same heights at ${w} ${scheme}: ${hs}`);
      if (w === 360) await shot(page, 'players-dark');
      await ctx.close();
    }
  });

  await check('4 Players: a row with BOTH pills and big numbers stays the same height (320 and 360) and the row name reads the numbers', async () => {
    for (const w of [320, 360]) {
      const { ctx, page } = await openAdmin({ width: w });
      await tab(page, 'Players');
      const hs = await page.evaluate(() => {
        const li = document.querySelector('[data-r3-players] li[data-player="Alec"]');
        const sub = li.querySelector('.r3-sub');
        sub.querySelector('[data-r3-stats]').textContent = '112 played · $1,234 spent';
        const held = document.createElement('span');
        held.className = 'r3-pill r3-held';
        held.textContent = '$28 held';
        sub.appendChild(held);
        return [...document.querySelectorAll('[data-r3-players] > li:not(.r3-add)')].map((r) => Math.round(r.getBoundingClientRect().height));
      });
      assert(new Set(hs).size === 1, `both pills at ${w}: row heights ${hs}`);
      await noOverflow(page, `both pills ${w}`);
      await ctx.close();
    }
    const { ctx, page } = await openAdmin();
    await tab(page, 'Players');
    const label = await page.locator('[data-r3-players] li[data-player="Mitchel"] .r3-open').getAttribute('aria-label');
    assert(/Mitchel, 0 played · \$0 spent, \$14 held/.test(label), `row name: ${label}`);
    await ctx.close();
  });

  await check('4 Players: Larger Text still lays out (rows may grow, nothing cut off sideways)', async () => {
    const { ctx, page } = await openAdmin({ width: 360 });
    await page.evaluate(() => (document.documentElement.style.fontSize = '200%'));
    await tab(page, 'Players');
    await noOverflow(page, 'Players at 200% text');
    await ctx.close();
  });

  // ---------------------------------------------------------------- Edit game
  await check('1 Edit game: no "Court" label, the whole sheet fits 360 x 640 with no scrolling', async () => {
    const { ctx, page } = await openAdmin();
    await openSheetFor(page, B.id);
    const sheet = page.locator('dialog.sheet[open]');
    assert((await sheet.locator('#edit-court-label').count()) === 0, 'Court label is gone');
    assert((await sheet.locator('[role="group"][aria-label="Court status"], .court-switch').count()) >= 1, 'the court switch is still there');
    const m = await sheet.evaluate((e) => ({ sh: e.scrollHeight, ch: e.clientHeight }));
    assert(m.sh <= m.ch + 1, `sheet scrolls: ${m.sh} > ${m.ch}`);
    const save = await sheet.getByRole('button', { name: 'Save' }).boundingBox();
    assert(save && save.y + save.height <= 640, 'Save is on screen');
    await shot(page, 'edit-game');
    await ctx.close();
  });

  await check('1 Edit game: still saves a changed court status (nothing about saving changed)', async () => {
    const { ctx, page } = await openAdmin();
    await openSheetFor(page, B.id);
    const sheet = page.locator('dialog.sheet[open]');
    await sheet.getByRole('button', { name: /Waitlist/ }).click();
    await sheet.getByRole('button', { name: 'Save' }).click();
    await page.waitForTimeout(800);
    const s = (await dash()).sessions.find((x) => x.id === B.id);
    assert(s.court?.switch === 'waitlist' || JSON.stringify(s).includes('waitlist'), 'court status saved as waitlist');
    await post(areq, `/api/admin/sessions/${B.id}/booked`, {});
    await ctx.close();
  });

  // ---------------------------------------------------------------- Add game
  await check('2 Add game: calendar date only (no chips), start and end in 30-minute steps', async () => {
    const { ctx, page } = await openAdmin();
    await page.getByRole('button', { name: /\+ Add game/ }).first().click();
    const sheet = page.locator('dialog.sheet[open]');
    assert((await sheet.locator('.chip-btn').count()) === 0, 'no suggested-day chips');
    assert((await sheet.locator('input[type="date"]').count()) === 1, 'one calendar date picker');
    const opts = await sheet.locator('select').first().locator('option').allInnerTexts();
    assert(opts.includes('7:00 PM') && opts.includes('7:30 PM') && opts.includes('8:00 PM'), `7:00 / 7:30 / 8:00 PM offered: ${opts.slice(0, 5)}`);
    const vals = await sheet.locator('select').first().locator('option').evaluateAll((os) => os.map((o) => o.value));
    assert(vals.every((v) => /:(00|30)$/.test(v)), `only :00 and :30: ${vals}`);
    assert((await sheet.locator('select').count()) === 2, 'start and end');
    await shot(page, 'add-game');
    await ctx.close();
  });

  await check('2 Add game: adding a 7:30 PM to 9:30 PM game on a free date works and the game is saved at that time', async () => {
    const { ctx, page } = await openAdmin();
    await page.getByRole('button', { name: /\+ Add game/ }).first().click();
    const sheet = page.locator('dialog.sheet[open]');
    const day = new Date(Date.now() + 40 * 86400_000);
    const iso = `${day.getUTCFullYear()}-${String(day.getUTCMonth() + 1).padStart(2, '0')}-${String(day.getUTCDate()).padStart(2, '0')}`;
    await sheet.locator('input[type="date"]').fill(iso);
    await sheet.locator('select').nth(0).selectOption('19:30');
    await sheet.locator('select').nth(1).selectOption('21:30');
    await sheet.getByRole('button', { name: 'Add game' }).click();
    await page.waitForTimeout(900);
    const added = (await dash()).sessions.find((s) => s.startsAt.startsWith(day.toISOString().slice(0, 7)) && new Date(s.startsAt).getTime() > Date.now() + 38 * 86400_000 && /T(23|00):30:00/.test(s.startsAt));
    assert(added, '7:30 PM Eastern game exists');
    await ctx.close();
  });

  // ---------------------------------------------------------------- Settings
  await check('3 Settings: Appearance, First session date gone; Venmo only in Money; test alert merged; no small print', async () => {
    const { ctx, page } = await openAdmin();
    await tab(page, 'Settings');
    await page.evaluate(() => document.querySelectorAll('details').forEach((x) => (x.open = true)));
    assert((await page.getByText('Appearance').count()) === 0, 'no Appearance row');
    assert((await page.locator('[data-row="firstSessionDate"]').count()) === 0, 'no First session date');
    assert((await page.locator('[data-row="venmoUrl"]').count()) === 1, 'exactly one Venmo link');
    assert((await page.locator('details[data-section="money"] [data-row="venmoUrl"]').count()) === 1, 'the Venmo link is in Money');
    assert((await page.getByRole('button', { name: 'Test smart alert' }).count()) === 1, 'one Test smart alert button');
    assert((await page.getByText(/Send test alert/).count()) === 0 && (await page.getByText(/TEST smart alert/).count()) === 0, 'old buttons gone');
    assert((await page.locator('details[data-section="alerts"]').getByText('Only you get these').count()) === 0, 'small print deleted');
    await ctx.close();
  });

  await check('3 Settings: Access and Change PIN live inside Advanced with Hidden players; the switches moved into Feature switches keep their state', async () => {
    const { ctx, page } = await openAdmin();
    await tab(page, 'Settings');
    await page.evaluate(() => document.querySelectorAll('details').forEach((x) => (x.open = true)));
    const adv = page.locator('details[data-section="advanced"]');
    assert((await adv.locator('[data-hidden-players]').count()) === 1, 'Hidden players still in Advanced');
    assert((await adv.locator('[data-adv="access"]').count()) === 1, 'Access inside Advanced');
    assert((await adv.locator('[data-adv="pin"]').count()) === 1, 'Change PIN inside Advanced');
    assert((await page.locator('details[data-section="access"], details[data-section="pin"]').count()) === 0, 'no separate Access / Change PIN sections');
    const sw = page.locator('details[data-section="switches"]');
    assert((await sw.locator('[data-row="payAlwaysAll"]').count()) === 1 && (await sw.locator('[data-row="timeShiftAll"]').count()) === 1, 'both moved rows are in Feature switches');
    assert((await page.locator('details[data-section="money"] [data-row="payAlwaysAll"]').count()) === 0 && (await page.locator('details[data-section="schedule"] [data-row="timeShiftAll"]').count()) === 0, 'and gone from where they were');
    assert((await sw.locator('[data-pay-always-all]').isChecked()) === true, 'Ask for payment on every game is still ON (as it was set)');
    assert((await sw.locator('[data-time-shift-all]').isChecked()) === false, 'Moved-game notice is still OFF (as it was set)');
    assert((await sw.locator('[data-row="lateFeesAll"]').count()) === 1, 'the Late drops row is still there');
    assert((await sw.locator('[data-row="adminR3All"]').count()) === 1, 'the round 3 row is there');
    await ctx.close();
  });

  await check('3 Settings: flipping each moved switch still works (moves at once, saved on the server, snaps back on failure)', async () => {
    const { ctx, page } = await openAdmin();
    await tab(page, 'Settings');
    await page.evaluate(() => document.querySelectorAll('details').forEach((x) => (x.open = true)));
    const sw = page.locator('details[data-section="switches"]');
    // Moved-game notice: off -> on, then back
    await sw.locator('[data-time-shift-all]').click();
    assert((await sw.locator('[data-time-shift-all]').isChecked()) === true, 'moved at once');
    await page.waitForTimeout(600);
    assert((await dash()).timeShiftForAll === true, 'Moved-game notice saved on');
    await sw.locator('[data-time-shift-all]').click();
    await page.waitForTimeout(600);
    assert((await dash()).timeShiftForAll === false, 'Moved-game notice saved off');
    // Ask for payment: on -> off, then back on
    await sw.locator('[data-pay-always-all]').click();
    await page.waitForTimeout(600);
    assert((await dash()).payAlwaysForAll === false, 'Ask for payment saved off');
    await sw.locator('[data-pay-always-all]').click();
    await page.waitForTimeout(600);
    assert((await dash()).payAlwaysForAll === true, 'Ask for payment saved on again');
    // A failed save snaps the switch back.
    await page.route('**/api/admin/time-shift', (r) => r.fulfill({ status: 500, body: '{"error":"x"}', contentType: 'application/json' }));
    await sw.locator('[data-time-shift-all]').click();
    await page.waitForTimeout(900);
    assert((await sw.locator('[data-time-shift-all]').isChecked()) === false, 'snapped back after the failed save');
    await ctx.close();
  });

  await check('3 Settings: the round 3 switch row turns it on for everyone (with round 2) and off again, no deploy', async () => {
    const { ctx, page } = await openAdmin({ r3: false });
    await tab(page, 'Settings');
    await page.locator('details[data-section="switches"] summary').click();
    await page.locator('[data-admin-r3-all]').click();
    await page.waitForTimeout(700);
    const dd = await (await areq.get(`${BASE}/api/admin/dashboard`, { headers: { 'X-Admin-R2': 'on' } })).json();
    assert(dd.adminR3ForAll === true && dd.adminR3 === true, 'on for everyone');
    await page.locator('[data-admin-r3-all]').click();
    await page.waitForTimeout(700);
    const d2 = await (await areq.get(`${BASE}/api/admin/dashboard`, { headers: { 'X-Admin-R2': 'on' } })).json();
    assert(d2.adminR3ForAll === false && d2.adminR3 === false, 'off again');
    await ctx.close();
  });

  await browser.close();
  console.log(`\nadmin-r3: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
