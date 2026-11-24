/* Zip 70 (🎾70.time): the organizer's Time and Plan (pictures 1, 2, 3, 7), Finalize's Time, fit line and money line (picture 4), the players'
 * time range and the moved-time card (pictures 5, 6), the late drop rule's two lines, and the dry run fixes 2 and 6, in a real browser.
 *
 *   node e2e/zip70.cjs
 *
 * The world is the preview's calm profile as of Thu Nov 19 2026, 10:00 AM Eastern, and the Tournament test page's Zip 70 stages: The Cold Open
 * as on live (Locked doubles, $18, credits $0, Tue Dec 1, 7:30 to 10 PM on 2 courts, 6 locked in of 8, Vic and Zoe unpaid).
 *   A  the card (picture 1): Date, Time, Plan, You make if it fills +$6 (green), Locked in 6 of 8, at 420/390/360/320 light and dark, no row wraps
 *   B  tap Time (picture 2): the pickers, the fit line, the money line as they change; Save; the venue card; players see the moved card (picture 6)
 *   C  when it would cost Alex (picture 3): Your cost if it fills $18 in red, no minus
 *   D  tap Plan (picture 7): Expect - and +, Courts 1 | 2, fit and money lines, Save
 *   E  Finalize (picture 4): Time, "Americano for 9", the money line updating with Time and Courts
 *   F  the players' ticket (picture 5): 7:30 PM / to 10 PM, never cut at 320
 *   G  the moved-time card (picture 6) at every width; X dismisses it for good on that phone
 *   H  the late drop rule: the Drop out sheet's two lines only when it applies; the toast
 *   I  dry run fix 2: the Switched to Americano card keeps its words wide at 420/390/360/320; fix 3: no past pay line in its text
 *   J  dry run fix 6: Currently playing says "3rd place" (and the Final's own card stays)
 * Screenshots: .data/zip70-shots (not in git).
 */
const { spawn, spawnSync } = require('node:child_process');
const { readFileSync, mkdirSync, rmSync } = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.E2E_PORT) || 5470;
const BASE = `http://localhost:${PORT}`;
const SEED_ISO = '2026-11-19T14:00:00.000Z';
const NOW_MS = Date.parse('2026-11-19T15:00:00.000Z'); // Thu Nov 19, 10:00 AM Eastern
const PIN = /PIN `(\d{6})`/.exec(readFileSync(path.join(ROOT, 'docs/PREVIEW_FAKE_DB.md'), 'utf8'))[1];
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const SHOTS = path.join(ROOT, '.data', 'zip70-shots');

let passed = 0;
let failed = 0;
const ONLY = process.env.ZIP70_ONLY || '';
async function check(name, fn) {
  if (ONLY && !name.includes(ONLY)) return;
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.log(`  ✗ ${name}\n      ${String(err && err.message ? err.message : err).replace(/\s*\n\s*/g, ' ⏎ ').slice(0, 1400)}`);
  }
}
const assert = (c, m) => {
  if (!c) throw new Error(m);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const flat = (t) => String(t).replace(/\s+/g, ' ').trim();
const SIZES = [390, 360, 320];
const SCHEMES = ['light', 'dark'];

async function main() {
  const dbFile = path.join(ROOT, '.data', 'zip70-e2e.sqlite');
  mkdirSync(SHOTS, { recursive: true });
  rmSync(dbFile, { force: true });
  const seeded = spawnSync('npx', ['vite-node', 'scripts/load-small-local.ts', '--', dbFile, SEED_ISO, '--calm', '--zip55', '--zip60', '--zip66'], { cwd: ROOT, encoding: 'utf8' });
  if (seeded.status !== 0) throw new Error(`could not build the calm world: ${seeded.stderr || seeded.stdout}`);
  if (await fetch(`${BASE}/api/status`).then((r) => r.ok, () => false)) throw new Error(`port ${PORT} is already in use`);
  const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
    cwd: ROOT,
    env: { ...process.env, DEV_DB: dbFile, SETUP_TOKEN: 'zip70-setup-token-0123456789', DEV_CLOCK: '1', PREVIEW_CALM: 'on', PB_PREVIEW_BUILD: '1' },
    stdio: 'ignore',
    detached: true,
  });
  process.on('exit', () => {
    try {
      process.kill(-server.pid, 'SIGTERM');
    } catch {}
  });
  for (let i = 0; i < 90; i++) {
    if (await fetch(`${BASE}/api/status`).then((r) => r.ok, () => false)) break;
    await sleep(500);
  }
  await fetch(`${BASE}/__dev/clock`, { method: 'POST', body: JSON.stringify({ atMs: NOW_MS }) });
  const browser = await chromium.launch();
  const shift = (ctx, at = NOW_MS) =>
    ctx.addInitScript((delta) => {
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
    }, at - Date.now());

  const admin = await browser.newContext();
  assert((await admin.request.post(BASE + '/api/admin/login', { data: { pin: PIN }, headers: { Origin: BASE } })).ok(), 'admin login');
  const adminCookies = await admin.cookies();
  const dash = async () => (await admin.request.get(BASE + '/api/admin/dashboard')).json();
  const call = async (method, url, data) => {
    const r = await admin.request.fetch(BASE + url, { method, data, headers: { Origin: BASE } });
    assert(r.ok(), `${method} ${url}: ${r.status()} ${await r.text()}`);
    return r.json();
  };
  const stage = (s) => call('POST', '/api/admin/tournament-test', { stage: s });
  async function answerOf(name) {
    const ctx = await browser.newContext();
    const list = (await (await ctx.request.get(BASE + '/api/group')).json()).players;
    const p = list.find((x) => x.name === name);
    await ctx.request.post(BASE + '/api/me', { data: { playerId: p.id }, headers: { Origin: BASE } });
    const text = await (await ctx.request.get(BASE + '/api/group')).text();
    await ctx.close();
    return { text, data: JSON.parse(text) };
  }
  async function newPage(opts = {}) {
    const { width = 390, scheme = 'light', height = 844, organizer = false, reducedMotion = 'reduce' } = opts;
    const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, colorScheme: scheme, isMobile: true, hasTouch: true, userAgent: UA, reducedMotion });
    await shift(ctx, opts.atMs);
    if (organizer) await ctx.addCookies(adminCookies.map((c) => ({ ...c })));
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    return { ctx, page, errors };
  }
  async function playerPage(who, opts = {}) {
    const p = await newPage(opts);
    await p.page.goto(`${BASE}/?as=${encodeURIComponent(who)}`);
    await p.page.locator('.schedule').first().waitFor({ timeout: 30000 });
    await p.page.reload();
    await p.page.locator('.schedule').first().waitFor({ timeout: 30000 });
    await p.page.waitForTimeout(700);
    return p;
  }
  /** Zip 66: open the organizer's tournament card when it is closed (it starts as one closed line). */
  async function openTourCard(page) {
    const toggle = page.locator('[data-tm-home-toggle][aria-expanded="false"]');
    if (await toggle.count()) {
      await toggle.first().click();
      await page.locator('[data-tm-home-body]').first().waitFor({ timeout: 10000 });
    }
  }
  async function adminPage(opts = {}) {
    const p = await newPage({ ...opts, organizer: true });
    await p.page.goto(`${BASE}/admin`);
    await p.page.locator('.tabbar').waitFor({ timeout: 30000 });
    await p.page.waitForTimeout(700);
    return p;
  }
  async function fits(page, sel) {
    const r = await page.evaluate((s) => {
      const out = { page: [document.documentElement.scrollWidth, window.innerWidth], bad: [] };
      for (const root of document.querySelectorAll(s)) {
        const box = root.getBoundingClientRect();
        for (const el of root.querySelectorAll('*')) {
          const b = el.getBoundingClientRect();
          if (b.width === 0 || b.height === 0) continue;
          if (getComputedStyle(el).position === 'absolute') continue;
          if (b.right > box.right + 1 || b.left < box.left - 1) out.bad.push(`${el.tagName}.${el.className} ${Math.round(b.left)}..${Math.round(b.right)} outside ${Math.round(box.left)}..${Math.round(box.right)}`);
        }
      }
      return out;
    }, sel);
    assert(r.page[0] <= r.page[1], `the page is wider than the screen (${r.page[0]} > ${r.page[1]})`);
    assert(r.bad.length === 0, `sticks out: ${r.bad.slice(0, 4).join(' | ')}`);
  }
  /** No piece of text under `sel` runs onto a second line. */
  async function oneLine(page, sel) {
    const bad = await page.evaluate((s) => {
      const out = [];
      for (const root of document.querySelectorAll(s)) {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
          if (!n.textContent.trim()) continue;
          const range = document.createRange();
          range.selectNodeContents(n);
          const tops = new Set([...range.getClientRects()].filter((r) => r.width > 0).map((r) => Math.round(r.top)));
          if (tops.size > 1) out.push(`"${n.textContent.trim()}" on ${tops.size} lines`);
        }
      }
      return out;
    }, sel);
    assert(bad.length === 0, `wraps: ${bad.slice(0, 4).join(' | ')}`);
  }
  const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
  const noDash = async (page, where) => {
    const text = await page.evaluate(() => document.body.innerText);
    assert(!text.includes('\u2014'), `an em dash on ${where}`);
  };
  const openSchedule = async (a) => {
    await a.page.locator('.tabbar button', { hasText: 'Settings' }).click();
    const sched = a.page.locator('[data-section="schedule"]');
    if (!(await sched.getAttribute('open'))) await sched.locator('summary').click();
    await a.page.locator('[data-tm-schedule-row]').click();
  };

  async function postAs(name, url, data, method = 'POST') {
    const ctx = await browser.newContext();
    const list = (await (await ctx.request.get(BASE + '/api/group')).json()).players;
    await ctx.request.post(BASE + '/api/me', { data: { playerId: list.find((x) => x.name === name).id }, headers: { Origin: BASE } });
    const r = await ctx.request.fetch(BASE + url, { method, data, headers: { Origin: BASE } });
    const out = { status: r.status(), body: await r.text() };
    await ctx.close();
    return out;
  }
  /** A player's page with the ticket card drawn. */
  async function vicCard(opts = {}) {
    const v = await playerPage(opts.who || 'Vic', opts);
    await v.page.locator('.tc-short').first().waitFor({ timeout: 20000 });
    return v;
  }
  const WIDTHS = [420, 390, 360, 320];
  const tapGap = (page) => page.waitForTimeout(450); // the site ignores a second tap on the same thing within a moment (tap guard)
  async function openCard(page) {
    await page.locator('[data-tm-home-toggle]').click();
    await page.locator('[data-tm-home-body]').waitFor({ timeout: 10000 });
    await tapGap(page);
  }


  const colorOf = (loc) => loc.evaluate((el) => getComputedStyle(el).color);
  const varColor = (page, name) =>
    page.evaluate((n) => {
      const d = document.createElement('span');
      d.style.color = `var(${n})`;
      document.body.appendChild(d);
      const c = getComputedStyle(d).color;
      d.remove();
      return c;
    }, name);
  const rowsOf = async (page) => (await page.locator('[data-tm-home-body] .tm-rows > .tm-row').allInnerTexts()).map((x) => flat(x));

  // ---------------------------------------------------------------- A  the card (picture 1)
  let info = await stage('zip70_start');
  assert(info.date === '2026-12-01', `The Cold Open on Tue Dec 1, is ${info.date}`);
  for (const width of WIDTHS)
    for (const scheme of SCHEMES)
      await check(`A ${width} ${scheme}: Date Tue Dec 1, Time 7:30 to 10 PM, Plan 8 players, You make if it fills +$6 (green), Locked in 6 of 8; no row wraps`, async () => {
        const a = await adminPage({ width, scheme });
        await a.page.locator('[data-tm-home]').waitFor({ timeout: 15000 });
        await openCard(a.page);
        const rows = await rowsOf(a.page);
        const want = ['Style Locked doubles', 'Not signed up 1', 'Date Tue Dec 1', 'Time 7:30 to 10 PM', 'Plan 8 players · 2 courts · 2.5 hrs', 'You make if it fills +$6', 'Locked in 6 of 8', 'Not paid yet 2', 'Ticket $18 · pay by Mon 7:00 PM'];
        assert(JSON.stringify(rows) === JSON.stringify(want), JSON.stringify(rows));
        const money = a.page.locator('[data-tm-row-money]');
        assert((await colorOf(money)) === (await varColor(a.page, '--ok-fg')), 'the +$6 is green (--ok-fg)');
        for (const h of await a.page.locator('[data-tm-home-body] .tm-rows > .tm-row').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height)))
          assert(h <= 44, `a row wraps (${h} px)`); // Zip 78: every row is a 44 px tap now; a wrapped row would be taller
        await oneLine(a.page, '[data-tm-home-body] .tm-rows > .tm-row');
        await fits(a.page, '[data-tm-home]');
        await noDash(a.page, 'the card');
        assert(a.errors.length === 0, a.errors.join(' | '));
        await a.page.locator('[data-tm-home]').screenshot({ path: path.join(SHOTS, `A-card-${width}-${scheme}.png`) });
        await a.ctx.close();
      });

  // ---------------------------------------------------------------- B  tap Time (picture 2), save, the players' card
  for (const width of WIDTHS)
    for (const scheme of SCHEMES)
      await check(`B ${width} ${scheme}: tap Time: the two pickers, the fit line and the money line follow the end; tap again closes`, async () => {
        const a = await adminPage({ width, scheme });
        await a.page.locator('[data-tm-home]').waitFor({ timeout: 15000 });
        await openCard(a.page);
        await a.page.locator('[data-tm-time-toggle]').click();
        const box = a.page.locator('[data-tm-time-box]');
        await box.waitFor({ timeout: 5000 });
        await a.page.locator('[data-tm-time-end]').selectOption(String(21 * 60 + 30));
        assert(flat(await box.locator('[data-tm-box-fit]').innerText()) === 'Locked doubles for 8: games to 11, done about 9:00 PM.', await box.locator('[data-tm-box-fit]').innerText());
        assert(flat(await box.locator('[data-tm-money-line]').innerText()) === 'Courts $96 · Tickets $126 · You +$30', await box.locator('[data-tm-money-line]').innerText());
        await oneLine(a.page, '[data-tm-time-box] .tm-hc-times');
        await fits(a.page, '[data-tm-home]');
        await box.screenshot({ path: path.join(SHOTS, `B-time-${width}-${scheme}.png`) });
        await tapGap(a.page);
        await a.page.locator('[data-tm-time-toggle]').click();
        await a.page.waitForTimeout(200);
        assert((await box.count()) === 0, 'tap again closes');
        await a.ctx.close();
      });
  await check('B Save moves the end: the card, History, the venue card with the new times; Vic sees the moved card and "to 9:30 PM"', async () => {
    const a = await adminPage({ width: 390 });
    await a.page.locator('[data-tm-home]').waitFor({ timeout: 15000 });
    await openCard(a.page);
    await a.page.locator('[data-tm-time-toggle]').click();
    await a.page.locator('[data-tm-time-end]').selectOption(String(21 * 60 + 30));
    await a.page.locator('[data-tm-time-save]').click();
    await a.page.locator('[data-tm-time-box]').waitFor({ state: 'detached', timeout: 10000 });
    assert(flat(await a.page.locator('[data-tm-row-time]').innerText()) === '7:30 to 9:30 PM', await a.page.locator('[data-tm-row-time]').innerText());
    assert(flat(await a.page.locator('[data-tm-row-money]').innerText()) === '+$30', await a.page.locator('[data-tm-row-money]').innerText());
    const venue = a.page.locator('[data-tm-venue-alert]');
    await venue.waitFor({ timeout: 5000 });
    assert(/7:30 to 9:30 PM/.test(await venue.innerText()), await venue.innerText());
    const d = (await dash()).tournament;
    assert(d.start === 1170 && d.minutes === 120 && d.payBy === '2026-12-01T00:00:00.000Z', JSON.stringify([d.start, d.minutes, d.payBy]));
    await a.ctx.close();
    const v = await vicCard({ width: 390 });
    const note = v.page.locator('[data-time-note]');
    await note.waitFor({ timeout: 10000 });
    assert(/The Cold Open now ends at 9:30 PM \(was 10 PM\)\./.test(flat(await note.innerText())) && /Based on the number of players locked in\./.test(await note.innerText()), await note.innerText());
    assert(flat(await v.page.locator('[data-tc-stub-end]').innerText()) === 'to 9:30 PM', await v.page.locator('[data-tc-stub-end]').innerText());
    await v.ctx.close();
  });

  // ---------------------------------------------------------------- C  it would cost Alex (picture 3)
  await stage('zip70_loss');
  for (const width of WIDTHS)
    for (const scheme of SCHEMES)
      await check(`C ${width} ${scheme}: 3 hours: "Your cost if it fills" "$18" in red, no minus`, async () => {
        const a = await adminPage({ width, scheme });
        await a.page.locator('[data-tm-home]').waitFor({ timeout: 15000 });
        await openCard(a.page);
        const rows = await rowsOf(a.page);
        assert(rows.includes('Your cost if it fills $18') && rows.includes('Plan 8 players · 2 courts · 3 hrs'), JSON.stringify(rows));
        const money = a.page.locator('[data-tm-row-money]');
        assert((await colorOf(money)) === (await varColor(a.page, '--danger-fg')), 'red (--danger-fg)');
        await oneLine(a.page, '[data-tm-home-body] .tm-rows > .tm-row');
        if (width === 390) await a.page.locator('[data-tm-home]').screenshot({ path: path.join(SHOTS, `C-loss-${width}-${scheme}.png`) });
        await a.ctx.close();
      });

  // ---------------------------------------------------------------- D  tap Plan (picture 7)
  await stage('zip70_start');
  for (const width of WIDTHS)
    for (const scheme of SCHEMES)
      await check(`D ${width} ${scheme}: tap Plan: Expect 8 with - and +, Courts 1 | 2; + to 10: fit and money follow; no wrap`, async () => {
        const a = await adminPage({ width, scheme });
        await a.page.locator('[data-tm-home]').waitFor({ timeout: 15000 });
        await openCard(a.page);
        await a.page.locator('[data-tm-plan-toggle]').click();
        const box = a.page.locator('[data-tm-plan-box]');
        await box.waitFor({ timeout: 5000 });
        assert(flat(await box.locator('[data-tm-expect]').innerText()) === '8', 'Expect starts on 8');
        // Never fewer than the 6 locked in.
        for (let i = 0; i < 2; i++) {
          await box.locator('[data-tm-expect-minus]').click();
          await tapGap(a.page);
        }
        assert(flat(await box.locator('[data-tm-expect]').innerText()) === '6' && (await box.locator('[data-tm-expect-minus]').isDisabled()), 'stops at 6');
        for (let i = 0; i < 4; i++) {
          await box.locator('[data-tm-expect-plus]').click();
          await tapGap(a.page);
        }
        assert(flat(await box.locator('[data-tm-expect]').innerText()) === '10', 'up to 10');
        assert(flat(await box.locator('[data-tm-box-fit]').innerText()) === 'Locked doubles for 10: games to 11, done about 9:50 PM.', await box.locator('[data-tm-box-fit]').innerText());
        assert(flat(await box.locator('[data-tm-money-line]').innerText()) === 'Courts $120 · Tickets $162 · You +$42', await box.locator('[data-tm-money-line]').innerText());
        for (const b of await box.locator('button').all()) {
          const r = await b.boundingBox();
          assert(r.height >= 43.5, `a button under 44 px (${r.height})`);
        }
        await oneLine(a.page, '[data-tm-plan-box] .tm-fin-row');
        await fits(a.page, '[data-tm-home]');
        await box.screenshot({ path: path.join(SHOTS, `D-plan-${width}-${scheme}.png`) });
        await a.ctx.close();
      });
  await check('D Save: Plan 10 players, You make if it fills +$42; a reload keeps it', async () => {
    const a = await adminPage({ width: 390 });
    await a.page.locator('[data-tm-home]').waitFor({ timeout: 15000 });
    await openCard(a.page);
    await a.page.locator('[data-tm-plan-toggle]').click();
    for (let i = 0; i < 2; i++) {
      await a.page.locator('[data-tm-expect-plus]').click();
      await tapGap(a.page);
    }
    await a.page.locator('[data-tm-plan-save]').click();
    await a.page.locator('[data-tm-plan-box]').waitFor({ state: 'detached', timeout: 10000 });
    const rows = await rowsOf(a.page);
    assert(rows.includes('Plan 10 players · 2 courts · 2.5 hrs') && rows.includes('You make if it fills +$42') && rows.includes('Locked in 6 of 8'), JSON.stringify(rows));
    await a.ctx.close();
  });

  // ---------------------------------------------------------------- E  Finalize (picture 4)
  for (const width of WIDTHS)
    for (const scheme of SCHEMES)
      await check(`E ${width} ${scheme}: Finalize: Time, "Americano for 9", the money line; Courts 1 moves it`, async () => {
        info = await stage('zip70_finalize');
        const a = await adminPage({ width, scheme });
        await a.page.locator('[data-tm-home]').waitFor({ timeout: 15000 });
        await openCard(a.page);
        await a.page.locator('[data-tm-open-dates]').click();
        await a.page.locator('button[data-day="2026-12-01"]').first().click();
        const fin = a.page.locator('[data-tm-finalize]');
        await fin.waitFor({ timeout: 10000 });
        assert((await fin.locator('.tm-fin-row-label').allInnerTexts()).map(flat).join('|') === 'Time|Courts|Pay by', 'Time, Courts, Pay by');
        assert(flat(await fin.locator('[data-tm-fin-fit]').innerText()) === 'Americano for 9: games to 11, done about 9:50 PM.', await fin.locator('[data-tm-fin-fit]').innerText());
        assert(flat(await fin.locator('[data-tm-money-line]').innerText()) === 'Courts $120 · Tickets $144 · You +$24', await fin.locator('[data-tm-money-line]').innerText());
        await fin.locator('[data-tm-fin-courts="1"]').click();
        await tapGap(a.page);
        assert(flat(await fin.locator('[data-tm-money-line]').innerText()) === 'Courts $60 · Tickets $144 · You +$84', await fin.locator('[data-tm-money-line]').innerText());
        await fin.locator('[data-tm-fin-courts="2"]').click();
        await tapGap(a.page);
        await oneLine(a.page, '[data-tm-finalize] .tm-fin-row');
        await fits(a.page, '[data-tm-finalize] .tm-fin-rows');
        await fits(a.page, '[data-tm-finalize] [data-tm-money-line]');
        await fin.screenshot({ path: path.join(SHOTS, `E-finalize-${width}-${scheme}.png`) });
        await a.ctx.close();
      });

  // ---------------------------------------------------------------- F  the players' ticket (picture 5)
  await stage('zip70_start');
  for (const width of WIDTHS)
    for (const scheme of SCHEMES)
      await check(`F ${width} ${scheme}: Vic's ticket: "7:30 PM" then "to 10 PM" under Dec 1, not cut`, async () => {
        const v = await vicCard({ width, scheme });
        const stub = v.page.locator('[data-tc-stub]').first();
        assert(flat(await stub.locator('.tc-time').innerText()) === '7:30 PM', await stub.locator('.tc-time').innerText());
        const end = stub.locator('[data-tc-stub-end]');
        assert(flat(await end.innerText()) === 'to 10 PM', await end.innerText());
        const cut = await end.evaluate((el) => {
          const s = el.closest('.tc-stub').getBoundingClientRect();
          const b = el.getBoundingClientRect();
          return b.left < s.left - 0.5 || b.right > s.right + 0.5 || el.scrollWidth > el.clientWidth + 1;
        });
        assert(!cut, '"to 10 PM" is cut');
        assert((await v.page.locator('[data-time-note]').count()) === 0, 'no moved card before a move');
        await fits(v.page, '.tc-short');
        await v.page.locator('.tc-short').first().screenshot({ path: path.join(SHOTS, `F-ticket-${width}-${scheme}.png`) });
        await v.ctx.close();
      });

  // ---------------------------------------------------------------- G  the moved-time card (picture 6)
  await stage('zip70_moved');
  for (const width of WIDTHS)
    for (const scheme of SCHEMES)
      await check(`G ${width} ${scheme}: "The Cold Open now ends at 9:30 PM (was 10 PM)." first on Home, with an X; the ticket says to 9:30 PM`, async () => {
        const v = await vicCard({ width, scheme });
        const note = v.page.locator('[data-time-note]');
        await note.waitFor({ timeout: 10000 });
        assert(flat(await note.locator('.ac-title').innerText()) === 'The Cold Open now ends at 9:30 PM (was 10 PM).', await note.innerText());
        assert(flat(await note.locator('.ac-sub').innerText()) === 'Based on the number of players locked in.', await note.innerText());
        const nb = await note.boundingBox();
        const tb = await v.page.locator('.tc-short').first().boundingBox();
        assert(nb.y < tb.y, 'above the ticket');
        assert(flat(await v.page.locator('[data-tc-stub-end]').innerText()) === 'to 9:30 PM', 'the stub');
        await fits(v.page, '[data-time-note]');
        await note.screenshot({ path: path.join(SHOTS, `G-moved-${width}-${scheme}.png`) });
        await v.ctx.close();
      });
  await check('G the X dismisses it for good on that phone (a reload keeps it gone); Reese (not on the date) and a phone not on the list get it only if on the list', async () => {
    const v = await vicCard({ width: 390 });
    await v.page.locator('[data-time-note] [data-dismiss]').click();
    await v.page.waitForTimeout(300);
    assert((await v.page.locator('[data-time-note]').count()) === 0, 'gone');
    await v.page.reload();
    await v.page.locator('.tc-short').first().waitFor({ timeout: 20000 });
    await v.page.waitForTimeout(600);
    assert((await v.page.locator('[data-time-note]').count()) === 0, 'still gone after a reload');
    await v.ctx.close();
    const reese = await answerOf('Reese');
    assert(reese.data.tournament.timeNote, 'Reese is on the list: the card');
  });

  // ---------------------------------------------------------------- H  the late drop rule's two lines
  await stage('zip70_late');
  for (const width of [390, 320])
    for (const scheme of SCHEMES)
      await check(`H ${width} ${scheme}: Parker (locked in, 8 in, Pay by passed): Drop out says the two lines; Zoe (not locked in): the usual words`, async () => {
        const p = await vicCard({ who: 'Parker', width, scheme });
        await p.page.locator('[data-tc-drop]').click();
        const keep = p.page.locator('[data-tm-backout-keeps]');
        await keep.waitFor({ timeout: 5000 });
        // Zip 74 (picture pair-6): the kept case's body is just the money line, under "Drop out of The Cold Open?".
        const words = flat(await keep.innerText());
        assert(words === 'Dropping out now means no credit back, unless someone takes your spot. Below 8 players we lose the second court, which is already paid for.', words);
        assert((await p.page.locator('[data-tm-backout-text]').count()) === 0, 'no "comes back as credit" line');
        assert(flat(await p.page.locator('dialog[open]').innerText()).startsWith('Drop out of The Cold Open?'), 'the title');
        await p.page.locator('[role="dialog"], .confirm').last().screenshot({ path: path.join(SHOTS, `H-drop-${width}-${scheme}.png`) }).catch(() => undefined);
        await p.ctx.close();
        const z = await vicCard({ who: 'Zoe', width, scheme });
        await z.page.locator('[data-tc-drop]').click();
        await z.page.locator('[data-tm-backout-text]').waitFor({ timeout: 5000 });
        assert((await z.page.locator('[data-tm-backout-keeps]').count()) === 0, 'not for Zoe');
        await z.ctx.close();
      });
  await check('H Parker drops: the toast says no credit back; History says $18 kept', async () => {
    const p = await vicCard({ who: 'Parker', width: 390 });
    await p.page.locator('[data-tc-drop]').click();
    await p.page.getByRole('button', { name: 'Yes, drop out' }).click();
    await p.page.locator('.toast-msg', { hasText: "You’re off the list. No credit back unless someone takes your spot." }).waitFor({ timeout: 10000 });
    await p.ctx.close();
    const h = await (await admin.request.get(BASE + '/api/admin/activity')).json();
    assert(h.entries.some((e) => e.action === 'tournament_back_out' && e.details.keptCents === 1800), 'History: kept $18');
  });

  // ---------------------------------------------------------------- I  dry run fixes 2 and 3: the Switched to Americano card
  info = await stage('backed_out');
  for (const width of WIDTHS)
    for (const scheme of SCHEMES)
      await check(`I ${width} ${scheme}: "switched to Americano": the words keep the card's width (never one word a line), the button under them`, async () => {
        const a = await adminPage({ width, scheme });
        const card = a.page.locator('[data-tm-odd-switch]');
        await card.waitFor({ timeout: 15000 });
        const r = await card.evaluate((el) => {
          const c = el.getBoundingClientRect();
          const text = el.querySelector('.ac-text').getBoundingClientRect();
          const title = el.querySelector('.ac-title');
          const lh = parseFloat(getComputedStyle(title).lineHeight);
          return { textShare: text.width / c.width, titleLines: Math.round(title.getBoundingClientRect().height / lh) };
        });
        assert(r.textShare > 0.6, `the words get ${Math.round(r.textShare * 100)}% of the card`);
        assert(r.titleLines <= 3, `the title runs ${r.titleLines} lines`);
        const btn = await card.locator('[data-tm-copy-text]').boundingBox();
        const txt = await card.locator('.ac-text').boundingBox();
        assert(btn.y >= txt.y + txt.height - 1, 'the button is under the words');
        await fits(a.page, '[data-tm-odd-switch]');
        await card.screenshot({ path: path.join(SHOTS, `I-odd-${width}-${scheme}.png`) });
        await a.ctx.close();
      });
  await check('I fix 3: in the last 3 hours the Copy text has no pay line; before them it has one', async () => {
    const d = (await dash()).tournament;
    let a = await adminPage({ width: 390 });
    await a.page.locator('[data-tm-odd-switch]').waitFor({ timeout: 15000 });
    assert(/pay by/.test(await a.page.locator('[data-tm-copy-text]').getAttribute('data-tm-copy-text')), 'a pay line before the cutoff');
    await a.ctx.close();
    const [y, m, dd] = d.finalDate.split('-').map(Number);
    // The start in Eastern (EST in December: UTC-5), then 2 hours before it.
    const startMs = Date.UTC(y, m - 1, dd, Math.floor(d.start / 60) + 5, d.start % 60);
    await fetch(`${BASE}/__dev/clock`, { method: 'POST', body: JSON.stringify({ atMs: startMs - 2 * 3_600_000 }) });
    try {
      a = await adminPage({ width: 390, atMs: startMs - 2 * 3_600_000 });
      await a.page.locator('[data-tm-odd-switch]').waitFor({ timeout: 15000 });
      const text = await a.page.locator('[data-tm-copy-text]').getAttribute('data-tm-copy-text');
      assert(!/pay by/i.test(text), text);
      await a.ctx.close();
    } finally {
      await fetch(`${BASE}/__dev/clock`, { method: 'POST', body: JSON.stringify({ atMs: NOW_MS }) });
    }
  });

  // ---------------------------------------------------------------- J  dry run fix 6: "3rd place" in Currently playing
  await stage('final_on');
  await check('J Vic (in the Final): Currently playing names the other game "3rd place", never "Round"', async () => {
    const v = await newPage({ width: 390 });
    await v.page.goto(`${BASE}/?as=Vic`);
    await v.page.locator('[data-tournament]').first().waitFor({ timeout: 30000 });
    await v.page.waitForTimeout(800);
    const live = v.page.locator('[data-tc-day-live]');
    if (await live.count()) {
      const t = flat(await live.innerText());
      assert(/3rd place/.test(t) && !/Round \d/.test(t), t);
    } else {
      // The Final's own card names it ("Also now · Court 2 · 3rd place"); the server's live list carries the label.
      const g = (await answerOf('Vic')).data.tournament.day;
      assert(g.live.every((x) => x.label && !/^Round/.test(x.label)) || g.alsoNow, JSON.stringify(g.live));
    }
    await v.ctx.close();
    for (const who of ['Sage', 'Parker']) {
      const d = (await answerOf(who)).data.tournament.day;
      for (const x of d.live) assert(x.label === 'Final' || x.label === '3rd place', `${who}: ${x.label}`);
    }
  });
  await browser.close();
  console.log(`\nzip70: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
