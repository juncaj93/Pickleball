/* Zip 66 (🎾66.admincard): the organizer's tournament card (one closed line, Votes, Not signed up), the tidier Edit page, the level sheet's dates,
 * and the players' in-or-out alert for a date they did not pick, in a real browser.
 *
 *   node e2e/zip66.cjs
 *
 * The world is the preview's calm profile as of Thu Nov 19 2026, 10:00 AM Eastern (with Zip 66's played-lately game), and the Tournament test
 * page's stages zip66_start (8 on the list, Vic and Reese not) and missed_date (finalized on a date Sage did not pick).
 *   A  the card starts as one closed line (mock 01) at 420/390/360/320, light and dark; tap opens (mock 02), tap closes; starts closed again
 *   B  Votes: tap opens who voted what in place (mock 07), tap closes; the names add up to the counts
 *   C  Not signed up: the count, the names and Copy reminder text (mock 09): the exact words on the clipboard, the "Copied" toast
 *   D  the Edit page (mocks 03, 04): Plan, Levels, Pick the date (folded, opens and closes), Settings with Who can see it; body font in Levels
 *   E  the level sheet's "Signed up for" dates (mock 05)
 *   F  the in-or-out alert (picture 10): above the ticket, no pay countdown, I'm in opens the Pay sheet, Can't make it takes them off
 *   G  the organizer's Not signed up row lists the players who missed the date, until they answer
 *   H  66b: the player's ticket is one row (Lock in, Who's in, Drop out) at 420/390/360/320 light and dark; the card is not a tap
 *   I  66b: the tickets folded into the organizer's card: the pill, Not paid yet, Remind all unpaid
 * Screenshots: .data/zip66-shots (not in git).
 */
const { spawn, spawnSync } = require('node:child_process');
const { readFileSync, mkdirSync, rmSync } = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.E2E_PORT) || 5468;
const BASE = `http://localhost:${PORT}`;
const SEED_ISO = '2026-11-19T14:00:00.000Z';
const NOW_MS = Date.parse('2026-11-19T15:00:00.000Z'); // Thu Nov 19, 10:00 AM Eastern
const PIN = /PIN `(\d{6})`/.exec(readFileSync(path.join(ROOT, 'docs/PREVIEW_FAKE_DB.md'), 'utf8'))[1];
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const SHOTS = path.join(ROOT, '.data', 'zip66-shots');

let passed = 0;
let failed = 0;
const ONLY = process.env.ZIP66_ONLY || '';
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
  const dbFile = path.join(ROOT, '.data', 'zip66-e2e.sqlite');
  mkdirSync(SHOTS, { recursive: true });
  rmSync(dbFile, { force: true });
  const seeded = spawnSync('npx', ['vite-node', 'scripts/load-small-local.ts', '--', dbFile, SEED_ISO, '--calm', '--zip55', '--zip60', '--zip66'], { cwd: ROOT, encoding: 'utf8' });
  if (seeded.status !== 0) throw new Error(`could not build the calm world: ${seeded.stderr || seeded.stdout}`);
  if (await fetch(`${BASE}/api/status`).then((r) => r.ok, () => false)) throw new Error(`port ${PORT} is already in use`);
  const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
    cwd: ROOT,
    env: { ...process.env, DEV_DB: dbFile, SETUP_TOKEN: 'zip66-setup-token-0123456789', DEV_CLOCK: '1', PREVIEW_CALM: 'on', PB_PREVIEW_BUILD: '1' },
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

  // ---------------------------------------------------------------- A  one closed line, tap open, tap closed
  await stage('zip66_start');
  for (const width of WIDTHS)
    for (const scheme of SCHEMES)
      await check(`A ${width} ${scheme}: one closed line (ball, name, "8 signed up", chevron); tap opens Style, Votes, Not signed up, Plan, Pick date and Edit; tap closes`, async () => {
        const a = await adminPage({ width, scheme });
        const card = a.page.locator('[data-tm-home]');
        await card.waitFor({ timeout: 15000 });
        const toggle = a.page.locator('[data-tm-home-toggle]');
        assert((await toggle.getAttribute('aria-expanded')) === 'false', 'starts closed');
        assert((await a.page.locator('[data-tm-home-body]').count()) === 0, 'no rows while closed');
        const box = await card.boundingBox();
        assert(box.height >= 50 && box.height <= 58, `one line about 54 px tall, is ${box.height}`);
        assert(flat(await a.page.locator('[data-tm-stage]').innerText()) === '8 signed up', await a.page.locator('[data-tm-stage]').innerText());
        assert((await a.page.locator('.tm-hc-ball svg.ball').count()) === 1, "the site's pickleball icon");
        const cut = await a.page.locator('.tm-hc-name').evaluate((el) => el.scrollWidth > el.clientWidth + 1);
        assert(!cut, 'the name is cut off');
        await oneLine(a.page, '.tm-hc-top');
        await fits(a.page, '[data-tm-home]');
        if (width === 420 || width === 320) await shot(a.page, `A-closed-${width}-${scheme}`);
        await openCard(a.page);
        assert((await toggle.getAttribute('aria-expanded')) === 'true', 'open');
        const rows = await a.page.locator('[data-tm-home-body] .tm-rows > .tm-row > span:first-child').allInnerTexts();
        assert(JSON.stringify(rows.map(flat)) === JSON.stringify(['Style', 'Votes', 'Not signed up', 'Plan']), JSON.stringify(rows));
        assert(flat(await a.page.locator('[data-tm-home-format]').innerText()) === 'Players vote', 'Style');
        assert(flat(await a.page.locator('[data-tm-vote-counts]').innerText()) === 'Doubles 3 · Americano 2 · Either 3', await a.page.locator('[data-tm-vote-counts]').innerText());
        assert(flat(await a.page.locator('[data-tm-home-plan]').innerText()) === '10 players · 2 courts · 2.5 hrs', await a.page.locator('[data-tm-home-plan]').innerText());
        assert((await a.page.locator('[data-tm-open-dates]').count()) === 1 && (await a.page.locator('[data-tm-open-edit]').count()) === 1, 'Pick date and Edit');
        const text = await card.innerText();
        assert(!/can see it/i.test(text), 'no "Everyone can see it" on the card');
        assert(!/[›>]/.test(await a.page.locator('[data-tm-votes-toggle]').innerText()), 'no arrow on Votes');
        // No row wraps (each row is one 38 px line).
        for (const h of await a.page.locator('[data-tm-home-body] .tm-rows > .tm-row').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height)))
          assert(h <= 40, `a row wraps (${h} px)`);
        await oneLine(a.page, '[data-tm-home-body] .tm-rows > .tm-row');
        await fits(a.page, '[data-tm-home]');
        await noDash(a.page, 'the card');
        if (width === 420 || width === 320) await shot(a.page, `A-open-${width}-${scheme}`);
        await toggle.click();
        await a.page.waitForTimeout(200);
        assert((await a.page.locator('[data-tm-home-body]').count()) === 0, 'tap again closes');
        await tapGap(a.page);
        // Starts closed every time Home loads.
        await openCard(a.page);
        await a.page.reload();
        await a.page.locator('[data-tm-home-toggle]').waitFor({ timeout: 15000 });
        assert((await a.page.locator('[data-tm-home-toggle]').getAttribute('aria-expanded')) === 'false', 'closed after a reload');
        await a.ctx.close();
      });

  // ---------------------------------------------------------------- B  Votes
  for (const width of [420, 320])
    for (const scheme of SCHEMES)
      await check(`B ${width} ${scheme}: tap Votes: Doubles, Americano, Either with names in a soft box; tap again closes; starts closed`, async () => {
        const a = await adminPage({ width, scheme });
        await openCard(a.page);
        assert((await a.page.locator('[data-tm-votes-box]').count()) === 0, 'starts closed');
        await a.page.locator('[data-tm-votes-toggle]').click();
        const boxEl = a.page.locator('[data-tm-votes-box]');
        await boxEl.waitFor();
        const t = (await dash()).tournament;
        const byVote = (v) => t.signups.filter((s) => (s.vote || 'either') === v).map((s) => s.name).join(', ') || 'Nobody';
        for (const [key, label] of [['locked', 'Doubles'], ['americano', 'Americano'], ['either', 'Either']]) {
          const row = boxEl.locator(`[data-tm-votes-row="${key}"]`);
          assert(flat(await row.locator('dt').innerText()) === label, label);
          assert(flat(await row.locator('dd').innerText()) === byVote(key), `${label}: ${await row.locator('dd').innerText()}`);
        }
        const bg = await boxEl.evaluate((el) => [getComputedStyle(el).backgroundColor, getComputedStyle(el).borderRadius]);
        assert(bg[0] !== 'rgba(0, 0, 0, 0)' && parseFloat(bg[1]) >= 10, `soft gray rounded box ${bg}`);
        await fits(a.page, '[data-tm-home]');
        await shot(a.page, `B-votes-${width}-${scheme}`);
        await tapGap(a.page);
        await a.page.locator('[data-tm-votes-toggle]').click();
        await a.page.waitForTimeout(200);
        assert((await a.page.locator('[data-tm-votes-box]').count()) === 0, 'tap again closes');
        await a.ctx.close();
      });

  // ---------------------------------------------------------------- C  Not signed up
  for (const scheme of SCHEMES)
    await check(`C 390 ${scheme}: Not signed up 2 (Vic, Reese: played lately, not on the list); Copy reminder text copies the exact words; "Copied"`, async () => {
      const a = await adminPage({ width: 390, scheme });
      await a.ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
      await openCard(a.page);
      assert(flat(await a.page.locator('[data-tm-missing-count]').innerText()) === '2', 'count');
      assert((await a.page.locator('[data-tm-missing-box]').count()) === 0, 'starts closed');
      await a.page.locator('[data-tm-missing-toggle]').click();
      await a.page.locator('[data-tm-missing-box="recent"]').waitFor();
      assert(flat(await a.page.locator('[data-tm-missing-names]').innerText()) === 'Vic, Reese', await a.page.locator('[data-tm-missing-names]').innerText());
      await a.page.locator('[data-tm-missing-copy]').click();
      await a.page.locator('.toast', { hasText: 'Copied' }).waitFor({ timeout: 5000 });
      const copied = await a.page.evaluate(() => navigator.clipboard.readText());
      // No close is stored before the date: the next Tuesday at 8 PM (Tue Nov 24 from Thu Nov 19).
      assert(copied === 'Vic, Reese: sign-ups for The Cold Open close Tue Nov 24 at 8 PM. localhost:5468', copied);
      await fits(a.page, '[data-tm-home]');
      await shot(a.page, `C-missing-390-${scheme}`);
      await tapGap(a.page);
      await a.page.locator('[data-tm-missing-toggle]').click();
      await a.page.waitForTimeout(200);
      assert((await a.page.locator('[data-tm-missing-box]').count()) === 0, 'tap again closes');
      await a.ctx.close();
    });

  // ---------------------------------------------------------------- D  the Edit page
  for (const width of [420, 390, 360, 320])
    for (const scheme of SCHEMES)
      await check(`D ${width} ${scheme}: Edit: Plan, Levels, Pick the date (folded: opens and closes), Settings (Who can see it, no caret), Edit, Cancel tournament`, async () => {
        const a = await adminPage({ width, scheme });
        await openCard(a.page);
        await a.page.locator('[data-tm-open-edit]').click();
        await a.page.locator('[data-tm-page]').waitFor();
        await a.page.waitForTimeout(400);
        const order = await a.page.locator('[data-tm-page] > [data-tm-card]').evaluateAll((els) => els.map((e) => e.dataset.tmCard));
        assert(JSON.stringify(order) === JSON.stringify(['plan', 'levels', 'dates', 'settings']), JSON.stringify(order));
        assert((await a.page.locator('[data-tm-card="page-who"]').count()) === 0, 'no Who can see it card');
        // Plan (mock 03): the pills and one cost line.
        const pills = await a.page.locator('.tm-plan-pill').allInnerTexts();
        assert(JSON.stringify(pills.map(flat)) === JSON.stringify(['10 players', '2 courts', '2.5 hrs']), JSON.stringify(pills));
        const pillTops = new Set(await a.page.locator('.tm-plan-pill').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top))));
        assert(pillTops.size === 1, 'the pills stay on one line');
        assert(/^\$\d+ \(\$\d+ with 0 paid\)$/.test(flat(await a.page.locator('.tm-plan-cost-val').innerText())), await a.page.locator('.tm-plan-cost-val').innerText());
        // Levels: the body font, smaller rows and pencils.
        const lv = await a.page.locator('.tm-lrow').first().evaluate((el) => ({
          h: el.getBoundingClientRect().height,
          name: getComputedStyle(el.querySelector('.tm-lrow-name')).fontFamily,
          body: getComputedStyle(document.body).fontFamily,
          pencil: el.querySelector('.tm-pencil').getBoundingClientRect().width,
        }));
        assert(lv.name === lv.body, `levels in the body font: ${lv.name} vs ${lv.body}`);
        assert(lv.h <= 50 && lv.pencil <= 37, JSON.stringify(lv));
        // Pick the date: folded, "16 offered".
        const dates = a.page.locator('[data-tm-card="dates"]');
        assert((await dates.locator('.tm-day').count()) === 0, 'folded: no calendar');
        assert(/^\d+ offered$/.test(flat(await dates.locator('.tm-chip').innerText())), await dates.locator('.tm-chip').innerText());
        await dates.locator('[data-tm-dates-toggle]').click();
        await dates.locator('.tm-day.tm-open').first().waitFor();
        assert((await dates.locator('.tm-day.tm-open').first().evaluate((el) => getComputedStyle(el).getPropertyValue('--heat-bg').trim())) !== '', 'the heat map');
        await tapGap(a.page);
        await dates.locator('[data-tm-dates-toggle]').click();
        await a.page.waitForTimeout(200);
        assert((await dates.locator('.tm-day').count()) === 0, 'folds again');
        // Settings (mock 04).
        const settings = a.page.locator('[data-tm-card="settings"]');
        await settings.scrollIntoViewIfNeeded();
        const labels = (await settings.locator('.tm-row > span:first-child').allInnerTexts()).map(flat);
        assert(JSON.stringify(labels) === JSON.stringify(['Format', 'Ticket price', '1st place credit', '2nd place credit', 'Who can see it']), JSON.stringify(labels));
        const who = flat(await settings.locator('[data-tm-who-row]').innerText());
        assert(who === 'Everyone', who);
        assert((await settings.locator('[data-tm-who-row]').evaluate((el) => el.closest('button'))) === null, 'not tappable by itself');
        assert((await settings.locator('[data-tm-edit-settings]').count()) === 1, 'Edit');
        assert((await a.page.locator('[data-tm-card="settings"] ~ [data-tm-cancel]').count()) === 1, 'Cancel tournament below');
        await fits(a.page, '[data-tm-page]');
        await oneLine(a.page, '[data-tm-card="settings"] .tm-row, [data-tm-card="plan"] .tm-card-head, .tm-lrow-level');
        await noDash(a.page, 'Edit');
        if (width === 420 || width === 320) {
          await a.page.locator('[data-tm-card="plan"]').scrollIntoViewIfNeeded();
          await shot(a.page, `D-edit-top-${width}-${scheme}`);
          await settings.scrollIntoViewIfNeeded();
          await shot(a.page, `D-edit-settings-${width}-${scheme}`);
        }
        // Who can see it changes with Edit (the form's Only me / Everyone).
        await settings.locator('[data-tm-edit-settings]').click();
        await a.page.locator('[data-tm-form="edit"] [data-vis="me"]').waitFor();
        await a.ctx.close();
      });

  // ---------------------------------------------------------------- E  the level sheet's dates
  for (const scheme of SCHEMES)
    await check(`E 390 ${scheme}: a pencil opens the level sheet with "Signed up for" and that player's dates as chips`, async () => {
      const a = await adminPage({ width: 390, scheme });
      await openCard(a.page);
      await a.page.locator('[data-tm-open-edit]').click();
      await a.page.locator('[data-tm-level-row="Parker"] [data-tm-pencil]').click();
      await a.page.locator('[data-tm-level-sheet]').waitFor();
      const parker = (await dash()).tournament.signups.find((s) => s.name === 'Parker');
      const chips = await a.page.locator('[data-tm-date-chip]').evaluateAll((els) => els.map((e) => e.dataset.tmDateChip));
      assert(JSON.stringify(chips) === JSON.stringify(parker.dates), `${chips} vs ${parker.dates}`);
      assert(flat(await a.page.locator('.tm-signed-for-label').innerText()) === 'Signed up for', 'label');
      assert(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun) [A-Z][a-z]{2} \d{1,2}$/.test(flat(await a.page.locator('[data-tm-date-chip]').first().innerText())), 'chip words');
      await fits(a.page, '[data-tm-level-sheet]');
      await shot(a.page, `E-level-390-${scheme}`);
      await a.ctx.close();
    });

  // ---------------------------------------------------------------- F  the in-or-out alert
  await stage('missed_date');
  const missed = (await dash()).tournament;
  assert(missed.status === 'tickets' && missed.finalDate, 'missed_date stage');
  for (const width of [390, 360, 320])
    for (const scheme of SCHEMES)
      await check(`F ${width} ${scheme}: Sage (did not pick the date): the blue alert above the ticket, I'm in · $16 and Can't make it, no X, no countdown`, async () => {
        const v = await vicCard({ who: 'Sage', width, scheme });
        const alert = v.page.locator('[data-missed-date]');
        await alert.waitFor({ timeout: 15000 });
        const d = new Date(missed.finalDate + 'T12:00:00Z');
        const day = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }).replace(',', '');
        assert(flat(await alert.locator('.ac-title').innerText()) === `The Cold Open is ${day}`, await alert.locator('.ac-title').innerText());
        assert(flat(await alert.innerText()).includes('Most players picked it. Can you make it?'), 'sub');
        assert(flat(await alert.locator('[data-missed-in]').innerText()) === 'I’m in · $16', await alert.locator('[data-missed-in]').innerText());
        assert(flat(await alert.locator('[data-missed-out]').innerText()) === 'Can’t make it', 'out');
        assert((await alert.locator('.ac-x').count()) === 0, 'no X');
        assert((await alert.getAttribute('data-alert-card')) === 'blue', 'blue');
        const above = await v.page.evaluate(() => {
          const a = document.querySelector('[data-missed-date]').getBoundingClientRect();
          const c = document.querySelector('.tc-short').getBoundingClientRect();
          return a.bottom <= c.top;
        });
        assert(above, 'above the ticket card');
        assert((await v.page.locator('[data-pay-countdown]').count()) === 0, 'no pay countdown');
        assert((await v.page.locator('.tc-short [data-tc-lock]').count()) === 1, 'Lock my spot on the ticket stays');
        await fits(v.page, '[data-missed-date]');
        if (width >= 360) await oneLine(v.page, '[data-missed-date] .ac-title, [data-missed-date] .ac-btn');
        await noDash(v.page, 'Sage Home');
        await shot(v.page, `F-alert-${width}-${scheme}`);
        await v.ctx.close();
      });
  await check('F a player who picked the date (Parker) gets no alert', async () => {
    const v = await vicCard({ who: 'Parker' });
    assert((await v.page.locator('[data-missed-date]').count()) === 0, 'no alert');
    await v.ctx.close();
  });
  await check('F the day before Pay by: Parker (unpaid, picked it) sees the countdown; Sage sees only the in-or-out alert', async () => {
    const atMs = Date.parse(missed.payBy) - 20 * 3_600_000;
    await fetch(`${BASE}/__dev/clock`, { method: 'POST', body: JSON.stringify({ atMs }) });
    try {
      const p = await vicCard({ who: 'Parker', atMs });
      await p.page.locator('[data-pay-countdown]').waitFor({ timeout: 15000 });
      await p.ctx.close();
      const s = await vicCard({ who: 'Sage', atMs });
      await s.page.locator('[data-missed-date]').waitFor({ timeout: 15000 });
      assert((await s.page.locator('[data-pay-countdown]').count()) === 0, 'no countdown for Sage');
      await s.ctx.close();
    } finally {
      await fetch(`${BASE}/__dev/clock`, { method: 'POST', body: JSON.stringify({ atMs: NOW_MS }) });
    }
  });
  await check("F I'm in: the date goes on Sage's sign-up and the Pay sheet opens ($16); the alert is gone", async () => {
    const v = await vicCard({ who: 'Sage' });
    await v.page.locator('[data-missed-in]').click();
    await v.page.locator('dialog[open] [data-pay-sheet]').waitFor({ timeout: 10000 });
    assert(flat(await v.page.locator('dialog[open] .sheet-title, dialog[open] h2').first().innerText()).includes('$16'), 'Pay $16');
    await shot(v.page, 'F-in-pay');
    const me = JSON.parse((await answerOf('Sage')).text).tournament.me;
    assert(me.dates.includes(missed.finalDate), 'the date is on her sign-up');
    await v.page.keyboard.press('Escape');
    await v.page.waitForTimeout(400);
    assert((await v.page.locator('[data-missed-date]').count()) === 0, 'the alert is gone');
    await v.ctx.close();
  });

  // ---------------------------------------------------------------- G  the organizer's row after the date
  await check("G after the date: Not signed up lists Sage (Pay by in the copied words); Can't make it takes her off and the row goes", async () => {
    await stage('missed_date');
    const a = await adminPage({ width: 390 });
    await a.ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
    await openCard(a.page);
    assert(flat(await a.page.locator('[data-tm-missing-count]').innerText()) === '1', 'count 1');
    await a.page.locator('[data-tm-missing-toggle]').click();
    await a.page.locator('[data-tm-missing-box="missed"]').waitFor();
    assert(flat(await a.page.locator('[data-tm-missing-names]').innerText()) === 'Sage', 'Sage');
    await a.page.locator('[data-tm-missing-copy]').click();
    await a.page.locator('.toast', { hasText: 'Copied' }).waitFor({ timeout: 5000 });
    const copied = await a.page.evaluate(() => navigator.clipboard.readText());
    assert(/^Sage: sign-ups for The Cold Open close (Mon|Tue|Wed|Thu|Fri|Sat|Sun) [A-Z][a-z]{2} \d{1,2} at 7 PM\. localhost:5468$/.test(copied), copied);
    await shot(a.page, 'G-missed-admin');
    const v = await vicCard({ who: 'Sage' });
    await v.page.locator('[data-missed-out]').click();
    await v.page.locator('[data-confirm-go]').click();
    await v.page.waitForTimeout(800);
    assert((await v.page.locator('[data-missed-date]').count()) === 0, 'the alert is gone');
    assert(JSON.parse((await answerOf('Sage')).text).tournament.me === null, 'off the list');
    await v.ctx.close();
    await a.page.waitForTimeout(5800); // the organizer's screen refreshes by itself
    assert((await a.page.locator('[data-tm-missing-toggle]').count()) === 0, 'the row goes (nobody left)');
    await a.ctx.close();
  });
  await check('G no player answer carries the Not signed up list or anyone\'s vote', async () => {
    await stage('zip66_start');
    for (const who of ['Vic', 'Parker']) {
      const a = await answerOf(who);
      assert(!/notSignedUp|"votes"|"vote"/.test(a.text), `${who}'s answer`);
    }
  });

  // ---------------------------------------------------------------- H  66b: the player's ticket, one row (pictures A1, A2)
  await stage('tickets_open');
  const ROW = { Vic: 'Lock in · $16', Parker: 'Locked in' };
  for (const who of ['Vic', 'Parker'])
    for (const width of WIDTHS)
      for (const scheme of SCHEMES)
        await check(`H ${who} ${width} ${scheme}: one row "${ROW[who]}", "Who's in", "Drop out" on one line, nothing cut, no Pay by on the card`, async () => {
          const v = await vicCard({ who, width, scheme });
          const bar = v.page.locator('.tc-short .tc-bar');
          const parts = (await bar.locator(':scope > *').allInnerTexts()).map(flat);
          assert(JSON.stringify(parts) === JSON.stringify([ROW[who], 'Who’s in', 'Drop out']), JSON.stringify(parts));
          const geo = await bar.evaluate((b) => {
            const bb = b.getBoundingClientRect();
            return [...b.children].map((e) => {
              const r = e.getBoundingClientRect();
              return { mid: Math.round(r.top + r.height / 2), right: r.right, max: bb.right, cut: e.scrollWidth > e.clientWidth + 1 };
            });
          });
          assert(new Set(geo.map((g) => Math.abs(g.mid - geo[0].mid) <= 3)).size === 1 && geo.every((g) => !g.cut && g.right <= g.max + 1), JSON.stringify(geo));
          await oneLine(v.page, '.tc-short .tc-bar');
          assert(!/Pay by/.test(await v.page.locator('.tc-short').innerText()), 'no Pay by on the card');
          if (who === 'Parker') {
            const c = await bar.locator('.tc-state').evaluate((el) => [getComputedStyle(el).justifyContent, getComputedStyle(el).color]);
            assert(c[0] === 'center', `Locked in centered: ${c}`);
          }
          if (width === 420 || width === 320) await shot(v.page, `H-row-${who}-${width}-${scheme}`);
          await v.ctx.close();
        });
  // The reviewer's states, stood in on Vic's answer (the preview's 10 names cannot fill 16 spots): every spot taken, 10th on standby, a held
  // standby spot, and a price with cents. One row, nothing cut, at every width.
  const STANDS = {
    'Join standby': (k) => { k.full = true; k.mine = null; },
    '10th on standby': (k) => { k.full = true; k.line = Array.from({ length: 10 }, (_, i) => ({ name: `P${i}`, ...(i === 9 ? { me: true } : {}) })); k.mine = { place: 'line', creditCents: 0, paidCents: 0, claimCents: 0, owedCents: 1600 }; },
    'Spot held': (k) => { k.full = true; k.line = [{ name: 'Vic', me: true }]; k.mine = { place: 'line', creditCents: 0, paidCents: 1600, claimCents: 0, owedCents: 0 }; },
    'Lock in · $16.50': (k) => { k.priceCents = 1650; },
  };
  for (const [label, fn] of Object.entries(STANDS))
    for (const width of WIDTHS)
      await check(`H stood in, ${label} at ${width}: one row, nothing cut`, async () => {
        const v = await newPage({ width, scheme: width === 320 ? 'dark' : 'light' });
        await v.page.route('**/api/group', async (route) => {
          const res = await route.fetch();
          const j = await res.json();
          if (j.tournament && j.tournament.tickets) fn(j.tournament.tickets);
          await route.fulfill({ response: res, json: j });
        });
        await v.page.goto(`${BASE}/?as=Vic`);
        await v.page.locator('.tc-short .tc-bar').waitFor({ timeout: 30000 });
        await v.page.waitForTimeout(500);
        const parts = await v.page.locator('.tc-short .tc-bar > *').evaluateAll((els) => els.map((e) => ({ t: e.textContent, cut: e.scrollWidth > e.clientWidth + 1, mid: Math.round(e.getBoundingClientRect().top + e.getBoundingClientRect().height / 2) })));
        assert(parts[0].t === label && parts[1].t === 'Who’s in' && parts.every((p) => !p.cut) && parts.every((p) => Math.abs(p.mid - parts[0].mid) <= 3), JSON.stringify(parts));
        await v.ctx.close();
      });
  await check("H the card itself is not a tap; Who's in opens the Who's in list; Drop out opens the Back out confirm", async () => {
    const v = await vicCard({ who: 'Vic' });
    await v.page.locator('.tc-short .tc-title').click();
    await v.page.waitForTimeout(500);
    assert((await v.page.locator('dialog[open]').count()) === 0, 'a tap on the card opens nothing');
    assert((await v.page.locator('.tc-short').evaluate((el) => getComputedStyle(el).cursor)) !== 'pointer', 'no tap style');
    await v.page.locator('.tc-short [data-tc-who]').click();
    await v.page.locator('dialog[open] [data-tw-in]').waitFor({ timeout: 10000 });
    assert((await v.page.locator('dialog[open] [data-tc-lock], dialog[open] [data-tc-edit], dialog[open] .tc-kicker').count()) === 0, 'the sheet is the list (no card copy, no buttons)');
    await v.page.keyboard.press('Escape');
    await v.page.waitForTimeout(500);
    await v.page.locator('.tc-short [data-tc-drop]').click();
    await v.page.locator('[data-tm-backout-text]').waitFor({ timeout: 10000 });
    await v.ctx.close();
  });
  await check('H 3 hours before the start: "Tickets closed" in the lime spot, Who\'s in, no Drop out', async () => {
    await stage('late_cut');
    const v = await vicCard({ who: 'Vic', width: 320 });
    const parts = (await v.page.locator('.tc-short .tc-bar > *').allInnerTexts()).map(flat);
    assert(JSON.stringify(parts) === JSON.stringify(['Tickets closed', 'Who’s in']), JSON.stringify(parts));
    await v.ctx.close();
  });

  // ---------------------------------------------------------------- I  66b: the tickets folded into the organizer's card (pictures A3, A4)
  for (const scheme of SCHEMES)
    await check(`I ${scheme}: no separate tickets card; the pill "3 unpaid" (amber); Not paid yet 3 under Locked in; tap: names, Remind all unpaid, No number for Reese`, async () => {
      await stage('tickets_open');
      const a = await adminPage({ width: 390, scheme });
      await a.page.locator('[data-tm-home]').waitFor({ timeout: 15000 });
      assert((await a.page.locator('.tm-remind, [data-tickets-open], [data-tm-unpaid-chip]').count()) === 0, 'no separate tickets card');
      const pill = a.page.locator('[data-tm-stage]');
      assert(flat(await pill.innerText()) === '3 unpaid' && (await pill.getAttribute('class')).includes('tm-chip-unpaid'), await pill.innerText());
      await shot(a.page, `I-closed-${scheme}`);
      await openCard(a.page);
      const labels = (await a.page.locator('[data-tm-home-body] .tm-rows > .tm-row > span:first-child').allInnerTexts()).map(flat);
      const at = labels.indexOf('Locked in');
      assert(at >= 0 && labels[at + 1] === 'Not paid yet' && !labels.includes('Paid'), JSON.stringify(labels));
      assert(flat(await a.page.locator('[data-tm-row-unpaid]').innerText()) === '3', 'count');
      assert(/pay by/.test(flat(await a.page.locator('[data-tm-row="ticket"]').innerText())), 'Pay by stays in the Ticket row');
      await a.page.locator('[data-tm-unpaid-toggle]').click();
      const box = a.page.locator('[data-tm-unpaid-box]');
      await box.waitFor();
      assert(flat(await box.locator('[data-tm-unpaid-names]').innerText()) === 'Vic, Zoe, Reese', await box.innerText());
      assert(flat(await box.locator('[data-tm-remind-missing]').innerText()) === 'No number for Reese', 'missing number');
      const href = await box.locator('[data-tm-remind-btn]').getAttribute('href');
      const digits = href.replace(/\D/g, '');
      assert(/^sms:/.test(href) && digits.includes('3135550101') && digits.includes('3135550103') && decodeURIComponent(href).includes('please pay for Winter Classic'), href);
      await fits(a.page, '[data-tm-home]');
      await shot(a.page, `I-open-${scheme}`);
      await tapGap(a.page);
      await a.page.locator('[data-tm-unpaid-toggle]').click();
      await a.page.waitForTimeout(200);
      assert((await box.count()) === 0, 'tap again closes');
      await a.ctx.close();
    });
  await check('I everyone paid: the pill "10 locked in" (green), no Not paid yet row; before tickets: "8 signed up"', async () => {
    await stage('all_locked');
    let a = await adminPage({ width: 390 });
    await a.page.locator('[data-tm-home]').waitFor({ timeout: 15000 });
    let pill = a.page.locator('[data-tm-stage]');
    assert(flat(await pill.innerText()) === '10 locked in' && (await pill.getAttribute('class')).includes('tm-chip-ok'), await pill.innerText());
    await openCard(a.page);
    assert((await a.page.locator('[data-tm-unpaid-toggle]').count()) === 0, 'hidden at 0');
    await a.ctx.close();
    await stage('zip66_start');
    a = await adminPage({ width: 390 });
    await a.page.locator('[data-tm-home]').waitFor({ timeout: 15000 });
    assert(flat(await a.page.locator('[data-tm-stage]').innerText()) === '8 signed up', 'before tickets');
    await a.ctx.close();
  });

  await browser.close();
  console.log(`\nzip66: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
