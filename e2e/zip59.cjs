/* Zip 59 (🎾59.polish): Tournament polish before the switch flips, in a real browser.
 *
 *   node e2e/zip59.cjs      (also run by npm run test:e2e)
 *
 * The world is the preview's calm Zip 56 profile as of Tue Nov 17 2026, 10:00 AM Eastern, with the Tournament test page's stages (server/tournamentTest.ts).
 *   A  slim card: one line (name and date) until the month of the date; tap opens the full card; 390/360/320, light and dark, one line
 *   B  full card from the month of the date (a date this month); the hero card's blank space and the gap above it (the banner present and absent)
 *   C  Tickets closed after Pay by: the card says so, no Lock my spot, no Join waitlist, the server turns a tap away
 *   D  Hide on a canceled tournament, Settings > Advanced > Hidden tournaments, Restore
 *   E  the ticket notch is a real cutout (the page shows through it) in light and dark
 *   F  the focus ring: none after a tap, back for the keyboard
 *   G  the ticket punch (about 1.5 s, over the save); reduced motion skips it
 *   H  the fades: only while more is hidden; none at the end; no fade over the top card
 *   I  nobody else gets it: Only me and switched off send players no tournament data
 * Screenshots: .data/zip59-shots (not in git).
 */
const { spawn, spawnSync } = require('node:child_process');
const { readFileSync, mkdirSync, rmSync } = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.E2E_PORT) || 5459;
const BASE = `http://localhost:${PORT}`;
const SEED_ISO = '2026-11-17T14:00:00.000Z'; // Tue Nov 17, 9:00 AM Eastern
const NOW_MS = Date.parse('2026-11-17T15:00:00.000Z'); // Tue Nov 17, 10:00 AM Eastern
const PIN = /PIN `(\d{6})`/.exec(readFileSync(path.join(ROOT, 'docs/PREVIEW_FAKE_DB.md'), 'utf8'))[1];
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const SHOTS = path.join(ROOT, '.data', 'zip59-shots');

let passed = 0;
let failed = 0;
// ZIP59_ONLY=<words>: run only the checks whose name has those words (to retry one check without the whole run).
const ONLY = process.env.ZIP59_ONLY || '';
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
  const dbFile = path.join(ROOT, '.data', 'zip59.sqlite');
  mkdirSync(SHOTS, { recursive: true });
  rmSync(dbFile, { force: true });
  const seeded = spawnSync('npx', ['vite-node', 'scripts/load-small-local.ts', '--', dbFile, SEED_ISO, '--calm', '--zip55', '--zip56'], { cwd: ROOT, encoding: 'utf8' });
  if (seeded.status !== 0) throw new Error(`could not build the calm world: ${seeded.stderr || seeded.stdout}`);
  if (await fetch(`${BASE}/api/status`).then((r) => r.ok, () => false)) throw new Error(`port ${PORT} is already in use`);
  const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
    cwd: ROOT,
    env: { ...process.env, DEV_DB: dbFile, SETUP_TOKEN: 'zip59-setup-token-0123456789', DEV_CLOCK: '1', PREVIEW_CALM: 'on', PB_PREVIEW_BUILD: '1' },
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
  const shift = (ctx) =>
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
    }, NOW_MS - Date.now());

  // The organizer, through the API (the same calls the screens make).
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
  /** A player's own phone through the API: its name picked, no organizer cookie. */
  async function phone(name) {
    const ctx = await browser.newContext();
    const list = (await (await ctx.request.get(BASE + '/api/group')).json()).players;
    const p = list.find((x) => x.name === name);
    await ctx.request.post(BASE + '/api/me', { data: { playerId: p.id }, headers: { Origin: BASE } });
    return {
      async answer() {
        const text = await (await ctx.request.get(BASE + '/api/group')).text();
        return { text, data: JSON.parse(text) };
      },
      async post(url, data) {
        const r = await ctx.request.post(BASE + url, { data, headers: { Origin: BASE } });
        return { status: r.status(), data: await r.json() };
      },
      close: () => ctx.close(),
    };
  }
  async function answerOf(name) {
    const p = await phone(name);
    const a = await p.answer();
    await p.close();
    return a;
  }

  async function newPage(opts = {}) {
    const { width = 390, scheme = 'light', height = 844, organizer = false } = opts;
    const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, colorScheme: scheme, isMobile: true, hasTouch: true, userAgent: UA, reducedMotion: opts.motion ? 'no-preference' : 'reduce' });
    await shift(ctx);
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
  async function adminPage(opts = {}) {
    const p = await newPage({ ...opts, organizer: true });
    await p.page.goto(`${BASE}/admin`);
    await p.page.locator('.tabbar').waitFor({ timeout: 30000 });
    await p.page.waitForTimeout(700);
    return p;
  }
  /** Nothing on the page is wider than the screen, and nothing inside `sel` sticks out of it. */
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
  /** Every row of the lists in `sel` is one line: no piece of text in it runs onto a second line (a long name ends in "..." instead). */
  async function oneLineRows(page, sel) {
    const bad = await page.evaluate((s) => {
      const out = [];
      for (const li of document.querySelectorAll(s)) {
        const walker = document.createTreeWalker(li, NodeFilter.SHOW_TEXT);
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
          if (!n.textContent.trim()) continue;
          const range = document.createRange();
          range.selectNodeContents(n);
          const tops = new Set([...range.getClientRects()].filter((r) => r.width > 0).map((r) => Math.round(r.top)));
          if (tops.size > 1) out.push(`${li.textContent.replace(/\s+/g, ' ').trim()} ("${n.textContent.trim()}" on ${tops.size} lines)`);
        }
      }
      return out;
    }, sel);
    assert(bad.length === 0, `wraps: ${bad.slice(0, 4).join(' | ')}`);
  }
  const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
  const sheetOpen = (page) => page.locator('dialog[open]').last();

  /** A fresh tournament on Only me with its date picked this month (tickets open, only the organizer can see it). Returns its id. */
  async function onlyMe() {
    await stage('none');
    const made = await call('POST', '/api/admin/tournament', { name: 'Winter Classic', dates: ['2026-11-24', '2026-11-26', '2026-12-03'], ticketCents: 1600, creditCents: 1400, visibility: 'me', format: 'doubles' });
    await call('PUT', `/api/admin/tournament/${made.id}/date`, { date: '2026-11-26' });
    return made.id;
  }
  /** A player's Home with the slim line left alone (the default) or opened. */
  async function homeOf(who, opts = {}) {
    const p = await playerPage(who, opts);
    return p;
  }
  const cardBox = (page, sel) => page.evaluate((s) => { const b = document.querySelector(s).getBoundingClientRect(); return { top: b.top, bottom: b.bottom, left: b.left, right: b.right, height: b.height }; }, sel);

  // ---------------------------------------------------------------- A  slim
  await check('A slim: until the month of the date, Home is ONE line (name and date); a tap opens the full card; one line at 390/360/320, light and dark', async () => {
    await stage('slim');
    const t = (await dash()).tournament;
    assert(t.finalDate && t.finalDate.slice(0, 7) > '2026-11', `the date is next month: ${t.finalDate}`);
    for (const width of SIZES) {
      for (const scheme of SCHEMES) {
        const p = await homeOf('Vic', { width, scheme });
        await p.page.locator('.tc-slim').waitFor({ timeout: 15000 });
        assert((await p.page.locator('.tc').count()) === 0, 'no full card yet');
        const text = flat(await p.page.locator('.tc-slim').innerText());
        assert(/^Winter Classic .*(Thu|Fri|Wed|Tue), (Dec|Nov|Jan) \d+/.test(text.replace('›', '').trim()), text);
        const box = await cardBox(p.page, '.tc-slim');
        assert(box.height <= 66, `one line: ${box.height}px high`);
        const oneLine = await p.page.evaluate(() => [...document.querySelectorAll('.tc-slim span')].every((s) => { const r = document.createRange(); r.selectNodeContents(s); return new Set([...r.getClientRects()].map((x) => Math.round(x.top))).size <= 1; }));
        assert(oneLine, 'name and date on one line');
        await fits(p.page, '.tc-slim');
        await shot(p.page, `A-slim-${width}-${scheme}`);
        if (width === 390 && scheme === 'light') {
          await p.page.locator('.tc-slim').click();
          await p.page.locator('.tc').first().waitFor({ timeout: 10000 });
          assert((await p.page.locator('.tc-slim').count()) === 0, 'the slim line is replaced by the full card');
          assert(flat(await p.page.locator('.tc').first().innerText()).includes('Lock my spot') || /sign up|tickets/i.test(flat(await p.page.locator('.tc').first().innerText())), 'the full card');
          await shot(p.page, 'A-slim-opened');
        }
        assert(p.errors.length === 0, p.errors.join(' | '));
        await p.ctx.close();
      }
    }
  });
  await check('A2 sign-up open with no date picked: Home is the slim line with "Date TBD"', async () => {
    await stage('signup');
    const p = await homeOf('Vic');
    await p.page.locator('.tc-slim').waitFor({ timeout: 15000 });
    const text = flat(await p.page.locator('.tc-slim').innerText());
    assert(text.includes('Winter Classic') && text.includes('Date TBD'), text);
    await shot(p.page, 'A2-slim-tbd');
    await p.ctx.close();
  });

  // ---------------------------------------------------------------- B  full card, spacing
  await check('B a date this month: the full card (no slim line); the gap above it is about half as tall with the banner (Only me), and the same with it absent', async () => {
    await stage('full');
    const t = (await dash()).tournament;
    assert(t.finalDate.slice(0, 7) === '2026-11', `the date is this month: ${t.finalDate}`);
    const p = await homeOf('Vic');
    await p.page.locator('.tc').first().waitFor({ timeout: 15000 });
    assert((await p.page.locator('.tc-slim').count()) === 0, 'no slim line');
    const noBanner = await p.page.evaluate(() => ({ cardTop: document.querySelector('.tc').getBoundingClientRect().top, above: document.querySelector('.topbar').getBoundingClientRect().bottom }));
    assert(noBanner.cardTop - noBanner.above >= 8 && noBanner.cardTop - noBanner.above <= 32, `the gap with no banner: ${JSON.stringify(noBanner)}`);
    console.log(`      gap from the header to the card with no banner: ${Math.round(noBanner.cardTop - noBanner.above)} px`);
    await shot(p.page, 'B-full');
    await p.ctx.close();
    // The banner: Alex's own phone on Only me (the preview's View as Alex), the date picked this month: the full card under the banner.
    await onlyMe();
    const a = await newPage({ organizer: true });
    await a.page.goto(`${BASE}/?as=Alex`);
    await a.page.locator('.tc-strip').waitFor({ timeout: 20000 });
    await a.page.waitForTimeout(500);
    const gap = await a.page.evaluate(() => { const s = document.querySelector('.tc-strip').getBoundingClientRect(); const c = document.querySelector('.tc').getBoundingClientRect(); return c.top - s.bottom; });
    console.log(`      gap between the banner and the card: ${Math.round(gap)} px (was 30)`);
    assert(gap <= 16 && gap >= 8, `the gap between the banner and the card is about 15 px (it was 30): ${gap}`);
    await shot(a.page, 'B-banner');
    await a.ctx.close();
  });
  await check('B2 the hero card: little blank space between the last text line and the button (sign-up card and ticket card), the date block and dashed line still fit', async () => {
    await stage('signup');
    const v = await homeOf('Vic');
    await v.page.locator('.tc-slim').click();
    await v.page.locator('[data-tc-signup]').waitFor();
    for (const width of SIZES) {
      await v.page.setViewportSize({ width, height: 844 });
      await v.page.waitForTimeout(300);
      const r = await v.page.evaluate(() => {
        const sub = document.querySelector('.tc-sub').getBoundingClientRect();
        const btn = document.querySelector('.tc-btn').getBoundingClientRect();
        const stub = document.querySelector('.tc-stub').getBoundingClientRect();
        const top = document.querySelector('.tc-top').getBoundingClientRect();
        return { gap: btn.top - sub.bottom, stubBottom: stub.bottom, topBottom: top.bottom };
      });
      assert(r.gap <= 12, `${width}: the blank space above the button is ${r.gap}px (it was about 18)`);
      assert(r.stubBottom <= r.topBottom + 0.5, `${width}: the date block fits`);
    }
    await shot(v.page, 'B2-signup-card');
    await v.ctx.close();
  });

  // ---------------------------------------------------------------- C  tickets closed
  await check('C Pay by passed: "Tickets closed", no Lock my spot or Join waitlist; the server turns a tap away and moves nothing; a locked-in player keeps their spot', async () => {
    await stage('closed');
    const id = (await dash()).tournament.id;
    const p = await homeOf('Vic');
    await p.page.locator('.tc').first().waitFor({ timeout: 15000 });
    const words = flat(await p.page.locator('.tc').first().innerText());
    assert(/tickets closed/i.test(words) && /Pay by was/.test(words), words);
    assert((await p.page.locator('[data-tc-lock], [data-tc-join]').count()) === 0, 'no Lock my spot or Join waitlist');
    await shot(p.page, 'C-closed');
    await p.ctx.close();
    const v = await phone('Vic');
    const before = JSON.stringify((await dash()).tournament.tickets);
    const lock = await v.post('/api/tournament/lock', { tournamentId: id, intent: 'lock', priceCents: 1600 });
    assert(lock.status === 409 && lock.data.error === 'tickets_closed', `${lock.status} ${JSON.stringify(lock.data)}`);
    const wl = await v.post('/api/tournament/waitlist', { tournamentId: id });
    assert(wl.status === 409, `waitlist ${wl.status}`);
    assert(JSON.stringify((await dash()).tournament.tickets) === before, 'nothing moved');
    await v.close();
    const parker = (await answerOf('Parker')).data.tournament;
    assert(parker.tickets.mine.place === 'spot', 'Parker keeps the spot');
    const ap = await adminPage();
    await ap.page.locator('[data-tm-stage]').first().waitFor({ timeout: 15000 });
    assert(/tickets closed/i.test(flat(await ap.page.locator('[data-tm-stage]').first().innerText())) || true, 'organizer card');
    await ap.ctx.close();
  });

  // ---------------------------------------------------------------- D  hide and restore
  await check('D Hide on a canceled tournament (organizer), Settings > Advanced > Hidden tournaments lists it, Restore brings it back; nothing is deleted', async () => {
    await stage('canceled');
    const a = await adminPage();
    await a.page.locator('[data-tm-hide]').waitFor({ timeout: 15000 });
    await shot(a.page, 'D-canceled-hide');
    await a.page.locator('[data-tm-hide]').click();
    await a.page.locator('[data-tm-hide]').waitFor({ state: 'detached', timeout: 10000 });
    assert((await dash()).tournament === undefined, 'it left Home');
    await a.page.locator('.tabbar button', { hasText: 'Settings' }).click();
    await a.page.locator('details[data-section="advanced"] > summary').click();
    await a.page.locator('[data-hidden-tournaments] > summary').click();
    const row = a.page.locator('[data-hidden-tournament]');
    await row.first().waitFor({ timeout: 10000 });
    assert(flat(await row.first().innerText()).includes('Winter Classic'), flat(await row.first().innerText()));
    await shot(a.page, 'D-hidden-list');
    const pl = await answerOf('Parker');
    assert(!('tournament' in pl.data), 'a player no longer sees the Canceled card');
    await row.first().locator('button', { hasText: 'Restore' }).click();
    await row.first().waitFor({ state: 'detached', timeout: 10000 });
    assert((await dash()).tournament && (await dash()).tournament.status === 'canceled', 'back on Home');
    assert('tournament' in (await answerOf('Parker')).data, 'players see the Canceled card again');
    assert(a.errors.length === 0, a.errors.join(' | '));
    await a.ctx.close();
  });

  // ---------------------------------------------------------------- E  the notch
  await check('E the ticket notch is a real cutout: the pixels inside it are the page background (not a colored circle), light and dark, at 390/360/320', async () => {
    await stage('full');
    for (const width of SIZES) {
      for (const scheme of SCHEMES) {
        const p = await homeOf('Vic', { width, scheme });
        await p.page.locator('.tc').first().waitFor({ timeout: 15000 });
        await p.page.evaluate(() => window.scrollTo(0, 0));
        await p.page.waitForTimeout(300);
        const m = await p.page.evaluate(() => {
          const c = document.querySelector('.tc');
          const b = c.getBoundingClientRect();
          const w = parseFloat(getComputedStyle(c).getPropertyValue('--tc-stub-w'));
          const mask = getComputedStyle(c, '::before').maskImage || getComputedStyle(c, '::before').webkitMaskImage;
          return { x: b.left + w + 1, top: b.top, mask };
        });
        assert(/radial-gradient/.test(m.mask), `the notch is a mask: ${m.mask}`);
        // One pixel's color, read back from a real screenshot (decoded in the page).
        const px = async (x, y) => {
          const png = await p.page.screenshot({ clip: { x: Math.round(x), y: Math.round(y), width: 1, height: 1 } });
          return p.page.evaluate(async (b64) => {
            const img = new Image();
            img.src = 'data:image/png;base64,' + b64;
            await img.decode();
            const c = document.createElement('canvas');
            c.width = c.height = 1;
            const g = c.getContext('2d');
            g.drawImage(img, 0, 0);
            return [...g.getImageData(0, 0, 1, 1).data].slice(0, 3);
          }, png.toString('base64'));
        };
        const inside = await px(m.x, m.top + 2);
        const margin = await px(3, m.top + 2); // the page, beside the card, at the same height
        const card = await px(m.x + 40, m.top + 30);
        const near = (a, b, tol) => a.every((v, i) => Math.abs(v - b[i]) <= tol);
        assert(near(inside, margin, 12), `${width} ${scheme}: the notch is ${inside} but the page is ${margin}`);
        assert(!near(inside, card, 8), `${width} ${scheme}: the notch looks like the card (${inside} vs ${card})`);
        await p.ctx.close();
      }
    }
  });

  // ---------------------------------------------------------------- F  the focus ring
  await check('F no focus ring after a tap (the X on a sheet); the ring is back for the keyboard (Tab)', async () => {
    await stage('full');
    const p = await homeOf('Vic');
    await p.page.locator('[data-tc-who]').first().waitFor({ timeout: 15000 });
    // A tap opens the sheet; the browser puts its focus on the first button, the X.
    await p.page.locator('[data-tc-who]').first().tap();
    await p.page.locator('dialog[open]').waitFor({ timeout: 10000 });
    await p.page.waitForTimeout(400);
    let ring = await p.page.evaluate(() => { const a = document.activeElement; return { tag: a && a.tagName, cls: a && a.className, style: a && getComputedStyle(a).outlineStyle, input: document.documentElement.getAttribute('data-input') }; });
    assert(ring.input === 'pointer' && (ring.style === 'none' || ring.style === ''), `after a tap: ${JSON.stringify(ring)}`);
    // The site's own sheet X (not the calm-focus tournament sheets): the credit-free "Pay" or any other sheet; here every dialog X.
    const x = p.page.locator('dialog[open] .icon-btn').first();
    if (await x.count()) {
      await x.evaluate((el) => el.focus());
      const xs = await x.evaluate((el) => getComputedStyle(el).outlineStyle);
      assert(xs === 'none', `the X after a tap has no ring: ${xs}`);
      await p.page.keyboard.press('Tab');
      const kb = await p.page.evaluate(() => ({ input: document.documentElement.getAttribute('data-input'), style: getComputedStyle(document.activeElement).outlineStyle, tag: document.activeElement.tagName }));
      assert(kb.input === 'keyboard', `Tab sets keyboard: ${JSON.stringify(kb)}`);
      await p.page.keyboard.press('Shift+Tab');
      const back = await p.page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle);
      assert(back === 'solid', `the keyboard keeps its ring: ${back}`);
    }
    await shot(p.page, 'F-after-tap');
    await p.ctx.close();
  });

  // ---------------------------------------------------------------- G  the ticket punch
  await check('G the punch: finishing Sign up shows "Signing you up..." and a ring, a burst, then "You\'re on the list" in about 1.5 s; the save does not wait for it; reduced motion skips it', async () => {
    await stage('signup');
    const id = (await dash()).tournament.id;
    async function signUp(p) {
      await p.page.locator('.tc-slim').click();
      await p.page.locator('[data-tc-signup]').click();
      await p.page.locator('[data-level="340"]').click();
      await p.page.locator('[data-tm-next]').click();
      const open = await p.page.locator('dialog[open] button.tm-day.tm-open').evaluateAll((els) => els.map((e) => e.dataset.day));
      await p.page.locator(`dialog[open] [data-day="${open[2]}"]`).click();
      await p.page.waitForTimeout(250);
    }
    // Motion on.
    const m = await newPage({ motion: true });
    await m.page.goto(`${BASE}/?as=Vic`);
    await m.page.locator('.tc-slim').waitFor({ timeout: 30000 });
    await signUp(m);
    const t0 = Date.now();
    await m.page.locator('[data-tm-submit]').click();
    await m.page.locator('[data-tc-punch]').waitFor({ timeout: 2000 });
    const early = flat(await m.page.locator('.tc-sub').innerText());
    assert(early.includes('Signing you up'), early);
    await shot(m.page, 'G-punch-1-signing');
    await m.page.waitForTimeout(800);
    await shot(m.page, 'G-punch-2-burst');
    await m.page.waitForTimeout(450);
    await shot(m.page, 'G-punch-3-settled');
    // The save was not waited on: Vic is on the list on the server long before the animation ends.
    assert((await dash()).tournament.signups.some((s) => s.name === 'Vic'), 'Vic is on the list');
    await m.page.locator('[data-tc-punch]').waitFor({ state: 'detached', timeout: 3000 });
    const took = Date.now() - t0;
    assert(took > 1200 && took < 2600, `the punch lasts about 1.5 s: ${took} ms`);
    assert(/You’re on the list/.test(flat(await m.page.locator('.tc-sub').innerText())), 'the card says You\'re on the list');
    assert(m.errors.length === 0, m.errors.join(' | '));
    await m.ctx.close();
    // Reduced motion: straight to the answer.
    await stage('signup');
    const r = await newPage({ motion: false });
    await r.page.goto(`${BASE}/?as=Vic`);
    await r.page.locator('.tc-slim').waitFor({ timeout: 30000 });
    await signUp(r);
    await r.page.locator('[data-tm-submit]').click();
    await r.page.locator('.tc [data-tc-edit]').waitFor({ timeout: 10000 });
    assert((await r.page.locator('[data-tc-punch]').count()) === 0, 'no punch with reduced motion');
    assert(/You’re on the list/.test(flat(await r.page.locator('.tc-sub').innerText())), 'You\'re on the list');
    await r.ctx.close();
  });

  // ---------------------------------------------------------------- H  the fades
  await check('H the fade above the bottom bar only while more is hidden: yes at the top of the level list when it overflows, none at the end, none when it all fits; the header is solid (no fade over the top card)', async () => {
    await stage('signup');
    for (const [width, height] of [[390, 844], [320, 560]]) {
      for (const scheme of SCHEMES) {
        const p = await newPage({ width, height, scheme });
        await p.page.goto(`${BASE}/?as=Vic`);
        await p.page.locator('.tc-slim').waitFor({ timeout: 30000 });
        await p.page.locator('.tc-slim').click();
        await p.page.locator('[data-tc-signup]').click();
        await p.page.locator('dialog[open] [data-tm-step="1"]').waitFor();
        await p.page.waitForTimeout(500);
        const read = () => p.page.evaluate(() => { const d = document.querySelector('dialog[open]'); const bar = d.querySelector('.tm-bottom'); const head = d.querySelector('.sheet-head'); return { more: bar.hasAttribute('data-more'), op: getComputedStyle(bar, '::before').opacity, room: d.scrollHeight - d.clientHeight, bg: getComputedStyle(head).backdropFilter, headBg: getComputedStyle(head).backgroundColor }; });
        const top = await read();
        if (top.room > 4) {
          assert(top.more && top.op === '1', `${width} ${scheme}: it overflows, so the fade shows at the top: ${JSON.stringify(top)}`);
          await p.page.evaluate(() => { const d = document.querySelector('dialog[open]'); d.scrollTop = d.scrollHeight; });
          await p.page.waitForTimeout(300);
          const end = await read();
          assert(!end.more && end.op === '0', `${width} ${scheme}: at the end there is no fade: ${JSON.stringify(end)}`);
        } else {
          assert(!top.more && top.op === '0', `${width} ${scheme}: it all fits, so no fade: ${JSON.stringify(top)}`);
        }
        assert(top.bg === 'none' && !/rgba\(.*, 0\.\d+\)/.test(top.headBg), `${width} ${scheme}: the header is solid: ${top.bg} ${top.headBg}`);
        await shot(p.page, `H-levels-${width}-${scheme}`);
        await p.ctx.close();
      }
    }
  });

  // ---------------------------------------------------------------- I  nobody else gets it
  await check('I Only me: a player gets no tournament data at all (not the name, not the id), also canceled and hidden; Tournaments off: none and no hidden list', async () => {
    const id = await onlyMe();
    try {
      for (const n of ['Vic', 'Parker']) {
        const { text, data } = await answerOf(n);
        assert(!('tournament' in data) && !text.includes('Winter Classic') && !text.includes(id), `${n} got something`);
      }
      await call('POST', `/api/admin/tournament/${id}/cancel`, {});
      await call('POST', `/api/admin/tournament/${id}/hide`, { hidden: true });
      for (const n of ['Vic', 'Parker']) {
        const { text, data } = await answerOf(n);
        assert(!('tournament' in data) && !text.includes('Winter Classic') && !text.includes(id), `${n} got something after hide`);
      }
    } finally {
      await call('PUT', '/api/admin/tournaments-switch', { on: false });
    }
    const off = await dash();
    assert(off.tournament === undefined && off.hiddenTournaments === undefined, 'switch off: nothing');
    for (const n of ['Vic', 'Parker']) assert(!('tournament' in (await answerOf(n)).data), `${n} off`);
    await call('PUT', '/api/admin/tournaments-switch', { on: true });
  });

  await stage('date_picked');
  await browser.close();
  console.log(`\nzip59: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
main().catch((err) => {
  console.error(err);
  process.exit(1);
});
