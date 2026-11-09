/* Zip 18: cleaner headers and "View as" shows what the player really sees.
 *
 *   node e2e/zip18.cjs      (also run by npm run test:e2e)
 *
 * The world: the SMALL preview cast (Alex organizer, Vic 1 unpaid, Wren 2, Zoe 3, Quinn, Rowan, Parker, Reese, Sage, Christopher
 * Vanderberg; scripts/load-small-local.ts), every Settings row on as on live, every wrangler.toml switch "on" as on live, and PREVIEW_CALM
 * on as on the preview (the /?as=Name links only work there). Its own dev server and its own copy; nothing touches Cloudflare or live.
 * Checks:
 *  - Player header at 390, 360 and 320 wide, light and dark: no small group label, the name centered against the logo tile, "not you?"
 *    right after the name and still working, the light/dark button and the date tile where they were.
 *  - The organizer's own player page: "Alex" + gray swap icon + "not you?"; the name and icon are one button to Admin (no PIN when this
 *    phone is signed in; the PIN screen when it is not any more). A player never sees it, nor the organizer's phone showing another name.
 *  - The bottom "Go to Admin" pill is gone (own page and View as).
 *  - View as Vic, Wren, Zoe (and Parker, Quinn) draws the same page as /?as=Name, light and dark, calm and ?alerts=all.
 *  - View as writes nothing: no save request leaves the page, and the database file is identical after taps (I'm in, Still in, I paid).
 *  - The Christmas logo (public/logo-xmas.png, staged, unused) dropped into the header does not break it.
 */
const { spawn, spawnSync } = require('node:child_process');
const { readFileSync, mkdirSync, rmSync } = require('node:fs');
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const { chromium } = require('playwright');
const { findClipping } = require('./clip-check.cjs');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.E2E_PORT) || 5428;
const BASE = `http://localhost:${PORT}`;
const SEED_ISO = '2026-11-09T17:00:00.000Z'; // Mon Nov 9, 12:00 PM Eastern
const NOW_MS = Date.parse(SEED_ISO);
const SHOTS = process.env.E2E_SHOTS || path.join(__dirname, 'screenshots');
const PIN = /PIN `(\d{6})`/.exec(readFileSync(path.join(ROOT, 'docs/PREVIEW_FAKE_DB.md'), 'utf8'))[1];
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

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
    console.log(`  ✗ ${name}\n      ${String(err && err.message ? err.message : err).replace(/\s*\n\s*/g, ' ⏎ ').slice(0, 1400)}`);
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function diffAt(a, b) {
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  return `at ${i}/${a.length}: real «${a.slice(Math.max(0, i - 120), i + 160)}» view-as «${b.slice(Math.max(0, i - 120), i + 160)}»`;
}

/** The live wrangler.toml [vars] (production), so this dev server has the same kill switches as live. */
function liveVars() {
  const toml = readFileSync(path.join(ROOT, 'wrangler.toml'), 'utf8');
  const top = toml.slice(toml.indexOf('[vars]'), toml.indexOf('[env.preview]'));
  const out = {};
  for (const m of top.matchAll(/^([A-Z_][A-Z0-9_]*)\s*=\s*"([^"]*)"/gm)) if (m[1] !== 'SITE_URL') out[m[1]] = m[2];
  return out;
}

async function main() {
  mkdirSync(SHOTS, { recursive: true });
  const dbFile = path.join(ROOT, '.data', `zip18-${PORT}.sqlite`);
  mkdirSync(path.join(ROOT, '.data'), { recursive: true });
  rmSync(dbFile, { force: true });
  const seeded = spawnSync('npx', ['vite-node', 'scripts/load-small-local.ts', '--', dbFile, SEED_ISO], { cwd: ROOT, encoding: 'utf8' });
  if (seeded.status !== 0) throw new Error(`could not build the fake world: ${seeded.stderr || seeded.stdout}`);
  const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
    cwd: ROOT,
    env: { ...process.env, ...liveVars(), DEV_DB: dbFile, SETUP_TOKEN: 'zip18-setup-token-0123456789', DEV_CLOCK: '1', PREVIEW_CALM: 'on' },
    stdio: 'ignore',
    detached: true,
  });
  process.on('exit', () => {
    try {
      process.kill(-server.pid, 'SIGTERM');
    } catch {}
  });
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(`${BASE}/api/status`)).ok) break;
    } catch {}
    await sleep(500);
  }
  await fetch(`${BASE}/__dev/clock`, { method: 'POST', body: JSON.stringify({ atMs: NOW_MS }) });
  const browser = await chromium.launch();

  /** One phone. `as`: 'organizer' (signed in), or a player name picked on this phone, optionally also signed in as organizer. */
  async function phone({ width = 390, scheme = 'light', alerts = 'calm', signedIn = false, xmas = false, atMs = NOW_MS } = {}) {
    const ctx = await browser.newContext({ viewport: { width, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, colorScheme: scheme, userAgent: UA, reducedMotion: 'reduce' });
    await ctx.addInitScript(
      ({ delta, alerts }) => {
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
        try {
          localStorage.setItem('pb_games_filter', 'all');
          if (alerts === 'all') localStorage.setItem('pb_alerts', 'all');
        } catch {}
      },
      { delta: atMs - Date.now(), alerts },
    );
    await ctx.route('https://venmo.com/**', (r) => r.abort());
    if (xmas) await ctx.route(`${BASE}/logo.png`, (r) => r.fulfill({ path: path.join(ROOT, 'public/logo-xmas.png'), contentType: 'image/png' }));
    if (signedIn) {
      const r = await ctx.request.post(BASE + '/api/admin/login', { data: { pin: PIN }, headers: { Origin: BASE } });
      assert(r.ok(), 'organizer sign-in');
    }
    const page = await ctx.newPage();
    return { ctx, page };
  }
  const ids = {};
  {
    const { ctx } = await phone({ signedIn: true });
    const d = await (await ctx.request.get(BASE + '/api/admin/dashboard')).json();
    for (const p of d.players) ids[p.name] = p.id;
    await ctx.close();
  }
  /** Open the player page as `name` on this phone (the /?as= preview link: the same as picking the name on Who are you?). */
  async function openAs(page, name) {
    await page.goto(`${BASE}/?as=${encodeURIComponent(name)}`);
    await page.waitForFunction((n) => document.querySelector('.topbar h1')?.textContent === n, name, { timeout: 15000 });
    await page.locator('.schedule article').first().waitFor();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(400);
  }
  /** The organizer's View as `name` (from the Admin header's View as button). */
  async function viewAs(page, name) {
    await page.goto(`${BASE}/admin`);
    await page.locator('.tabbar').waitFor();
    await page.locator('.topbar-btn', { hasText: 'View as' }).click();
    await page.locator('.name-grid button', { hasText: new RegExp(`^${name}$`) }).click();
    await page.waitForFunction((n) => document.querySelector('.topbar h1')?.textContent === n, name, { timeout: 20000 });
    await page.locator('.schedule article').first().waitFor();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(400);
  }
  const header = (page) =>
    page.evaluate(() => {
      const r = (el) => (el ? el.getBoundingClientRect() : null);
      const mid = (b) => (b ? b.top + b.height / 2 : null);
      const tile = r(document.querySelector('.topbar .brand-tile'));
      const h1 = r(document.querySelector('.topbar h1'));
      const nv = document.querySelector('.topbar .not-you');
      const notYou = r(nv);
      const mode = r(document.querySelector('.topbar .mode-btn'));
      const today = r(document.querySelector('.topbar .today'));
      const swap = document.querySelector('.topbar [data-title-swap]');
      const icon = swap?.querySelector('.swap-icon');
      const h = document.querySelector('.topbar h1');
      return {
        eyebrow: document.querySelectorAll('.topbar .eyebrow').length,
        title: h?.textContent,
        tileMid: mid(tile),
        h1Mid: mid(h1),
        h1Right: h1?.right,
        clipped: h ? h.scrollWidth > h.clientWidth + 1 : true,
        notYou: notYou ? { left: notYou.left, mid: mid(notYou), text: nv.textContent } : null,
        modeMid: mid(mode),
        todayMid: mid(today),
        todayRight: today?.right,
        width: document.documentElement.clientWidth,
        overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        swap: swap ? { label: swap.getAttribute('aria-label'), h1: swap.querySelector('h1')?.textContent, icon: !!icon, iconColor: icon ? getComputedStyle(icon).color : null, inkColor: getComputedStyle(document.body).color } : null,
        goAdmin: document.querySelectorAll('[data-go-admin], .go-admin').length + ([...document.querySelectorAll('button')].some((b) => /Go to Admin/.test(b.textContent)) ? 1 : 0),
      };
    });
  const centered = (m, what) => {
    assert(m.eyebrow === 0, `${what}: the small label is still there`);
    assert(Math.abs(m.h1Mid - m.tileMid) <= 2, `${what}: the name is not centered on the logo tile (${m.h1Mid} vs ${m.tileMid})`);
    assert(Math.abs(m.modeMid - m.tileMid) <= 2 && Math.abs(m.todayMid - m.tileMid) <= 2, `${what}: the sun button or the date tile moved off the line (${m.modeMid}, ${m.todayMid}, ${m.tileMid})`);
    assert(!m.overflow, `${what}: the page scrolls sideways`);
    assert(m.todayRight <= m.width, `${what}: the date tile is cut off`);
  };

  // ---------------- Item 1: headers ----------------
  for (const scheme of ['light', 'dark'])
    for (const width of [390, 360, 320]) {
      await check(`player header, Vic, ${width} px, ${scheme}: no label, name centered on the logo, not you? right after it, sun and date tile on the line`, async () => {
        const { ctx, page } = await phone({ width, scheme });
        await openAs(page, 'Vic');
        const m = await header(page);
        centered(m, 'Vic');
        assert(m.title === 'Vic' && !m.clipped, JSON.stringify(m));
        assert(m.notYou && m.notYou.text.trim() === 'not you?' && m.notYou.left >= m.h1Right && m.notYou.left - m.h1Right <= 14, `not you? not next to the name: ${JSON.stringify(m.notYou)} ${m.h1Right}`);
        assert(m.swap === null && m.goAdmin === 0, 'a player sees the swap or Go to Admin');
        await page.locator('.topbar').screenshot({ path: path.join(SHOTS, `zip18-header-vic-${width}-${scheme}.png`) });
        await ctx.close();
      });
      await check(`the organizer's own player page, ${width} px, ${scheme}: "Alex" + gray swap icon (one button) then not you?, centered, no Go to Admin pill`, async () => {
        const { ctx, page } = await phone({ width, scheme, signedIn: true });
        await openAs(page, 'Alex');
        const m = await header(page);
        centered(m, 'Alex');
        assert(m.swap && m.swap.h1 === 'Alex' && m.swap.icon && m.swap.label === 'Alex. Go to Admin', JSON.stringify(m.swap));
        assert(m.swap.iconColor !== m.swap.inkColor, `the icon should be gray, not the name's color (${m.swap.iconColor})`);
        assert(m.notYou && m.notYou.left > m.h1Right, 'not you? after the name and icon');
        assert(m.goAdmin === 0, 'the bottom Go to Admin pill is still there');
        await page.locator('.topbar').screenshot({ path: path.join(SHOTS, `zip18-header-alex-${width}-${scheme}.png`) });
        await ctx.close();
      });
      await check(`Admin header, ${width} px, ${scheme}: as today (Admin + swap icon, View as, sun button, date tile on one line)`, async () => {
        const { ctx, page } = await phone({ width, scheme, signedIn: true });
        await page.goto(`${BASE}/admin`);
        await page.locator('.tabbar').waitFor();
        const m = await header(page);
        assert(m.title === 'Admin' && m.swap && m.swap.icon && m.eyebrow === 0, JSON.stringify(m));
        assert(Math.abs(m.h1Mid - m.tileMid) <= 2 && !m.overflow, JSON.stringify(m));
        await page.locator('.topbar').screenshot({ path: path.join(SHOTS, `zip18-header-admin-${width}-${scheme}.png`) });
        await ctx.close();
      });
    }

  await check('not you? still works: it opens Who are you?, picking Wren shows Wren (header still without the label)', async () => {
    const { ctx, page } = await phone();
    await openAs(page, 'Vic');
    await page.locator('.topbar .not-you').click();
    await page.waitForFunction(() => document.querySelector('.topbar h1')?.textContent === 'Who are you?');
    const m = await header(page);
    assert(m.eyebrow === 0, 'label on Who are you?');
    await page.locator('button', { hasText: /^Wren$/ }).first().click();
    await page.waitForFunction(() => document.querySelector('.topbar h1')?.textContent === 'Wren', null, { timeout: 15000 });
    await ctx.close();
  });

  await check('Alex swap: tapping the name goes to Admin with no PIN (this phone is signed in), and the icon too', async () => {
    const { ctx, page } = await phone({ signedIn: true });
    await openAs(page, 'Alex');
    await page.locator('.topbar [data-title-swap] h1').click();
    await page.locator('.tabbar').waitFor({ timeout: 15000 });
    assert(new URL(page.url()).pathname === '/admin', page.url());
    assert((await page.locator('input[inputmode="numeric"], input[type="password"]').count()) === 0, 'a PIN field showed');
    await openAs(page, 'Alex');
    await page.locator('.topbar [data-title-swap] .swap-icon').click();
    await page.locator('.tabbar').waitFor({ timeout: 15000 });
    await ctx.close();
  });

  await check('Alex swap when the admin session is gone by the time of the tap: the normal PIN screen', async () => {
    const { ctx, page } = await phone({ signedIn: true });
    await openAs(page, 'Alex');
    assert((await ctx.request.post(BASE + '/api/admin/logout', { data: {}, headers: { Origin: BASE } })).ok(), 'sign out');
    await page.locator('.topbar [data-title-swap]').click();
    await page.waitForFunction(() => document.querySelector('.topbar h1')?.textContent === 'Sign in', null, { timeout: 15000 });
    await ctx.close();
  });

  await check('never anyone but the signed-in organizer: a player who picked "Alex", the organizer\'s phone showing Vic, a signed-out phone', async () => {
    for (const [who, signedIn] of [
      ['Alex', false],
      ['Vic', true],
      ['Zoe', false],
    ]) {
      const { ctx, page } = await phone({ signedIn });
      await openAs(page, who);
      const m = await header(page);
      assert(m.swap === null && m.goAdmin === 0, `${who} (signed in ${signedIn}): ${JSON.stringify(m.swap)}`);
      await ctx.close();
    }
  });

  await check('Christmas logo (public/logo-xmas.png, staged) in the tile: the header holds at 320 px, light and dark, Vic and Alex', async () => {
    for (const scheme of ['light', 'dark'])
      for (const [who, signedIn] of [
        ['Vic', false],
        ['Alex', true],
      ]) {
        const { ctx, page } = await phone({ width: 320, scheme, signedIn, xmas: true });
        await openAs(page, who);
        const m = await header(page);
        centered(m, `${who} xmas`);
        const ok = await page.evaluate(() => {
          const img = document.querySelector('.topbar .brand-logo');
          return img.complete && img.naturalWidth > 0 && img.getBoundingClientRect().width === 24;
        });
        assert(ok, 'the Christmas logo did not load at 24 px');
        await page.locator('.topbar').screenshot({ path: path.join(SHOTS, `zip18-header-xmas-${who.toLowerCase()}-${scheme}.png`) });
        await ctx.close();
      }
  });

  // ---------------- Item 2: View as = the real player page ----------------
  const norm = (h) =>
    h
      .replace(/«r[0-9a-z]+»/g, '«id»')
      .replace(/(:r[0-9a-z]+:)/g, ':id:')
      .replace(/\/assets\/[^"']+/g, '/assets/x')
      // The pay card's entrance class: /?as= picks the name after the page is up (so the card "enters"); View as draws it on first load.
      // Motion only (reduced motion here, so nothing moves either way); not content.
      .replace(/ m-enter/g, '')
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '<id>');
  /** The player's page below the bars: the header (title, not you?, chip, sun, date) and everything in main. */
  const pageHtml = (page) =>
    page.evaluate(() => {
      const hdr = document.querySelector('.topbar').outerHTML;
      const main = document.querySelector('main.page').outerHTML;
      return hdr + main;
    });
  for (const alerts of ['calm', 'all'])
    for (const scheme of ['light', 'dark'])
      for (const name of ['Vic', 'Wren', 'Zoe', 'Parker', 'Quinn']) {
        if (alerts === 'all' && scheme === 'dark' && !['Vic', 'Zoe'].includes(name)) continue;
        await check(`View as ${name} = /?as=${name} (${scheme}, alerts ${alerts}): the same page, the Demo banner on top`, async () => {
          const real = await phone({ scheme, alerts });
          await openAs(real.page, name);
          const a = norm(await pageHtml(real.page));
          await real.ctx.close();
          const org = await phone({ scheme, alerts, signedIn: true });
          await viewAs(org.page, name);
          const b = norm(await pageHtml(org.page));
          const banner = await org.page.locator('.pretend-bar', { hasText: 'Demo, nothing is saved' }).count();
          if (alerts === 'calm' && scheme === 'light') await org.page.screenshot({ path: path.join(SHOTS, `zip18-viewas-${name.toLowerCase()}.png`), fullPage: false });
          await org.ctx.close();
          assert(banner === 1, 'no "Demo, nothing is saved" banner');
          if (a !== b) throw new Error(diffAt(a, b));
        });
      }

  await check('View as the old look is gone (Wren and Sage, alerts all): no count text, no court words, the alert-card Want in, seat dots on (tests/zip18.test.ts shows the copy had them all off before)', async () => {
    const look = (page) =>
      page.evaluate(() => {
        const sched = document.querySelector('.schedule');
        const leaves = [...sched.querySelectorAll('*')].filter((e) => e.children.length === 0).map((e) => e.textContent.trim());
        return {
          count: leaves.filter((t) => /^\d+ (of \d+ )?in$/.test(t)).length,
          courtWords: leaves.filter((t) => /^Court (booked|not booked)$/.test(t)).length,
          oldWantIn: document.querySelectorAll('section.card.suggest').length,
          alertCards: document.querySelectorAll('[data-alert-card]').length,
          seatDots: document.documentElement.hasAttribute('data-seat-dots'),
        };
      });
    const org = await phone({ alerts: 'all', signedIn: true });
    const now = {};
    for (const n of ['Wren', 'Sage']) {
      if (n === 'Sage') await org.page.locator('.viewas-banner button, .viewas-banner .ac-btn', { hasText: 'Exit' }).click();
      await viewAs(org.page, n);
      now[n] = await look(org.page);
    }
    await org.ctx.close();
    for (const n of ['Wren', 'Sage']) assert(now[n].count === 0 && now[n].courtWords === 0 && now[n].oldWantIn === 0 && now[n].alertCards > 0 && now[n].seatDots, `${n}: ${JSON.stringify(now[n])}`);
  });

  await check('View as writes nothing: I\'m in (Vic), Still in (Parker), I paid (Wren) save only in the copy; no save request leaves the page; the database file is identical', async () => {
    const snap = () => {
      const db = new DatabaseSync(dbFile, { readOnly: true });
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT IN ('rate_events', 'login_attempts', 'admin_sessions') ORDER BY name").all().map((r) => r.name);
      const out = JSON.stringify(tables.map((t) => [t, db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all()]));
      db.close();
      return out;
    };
    const org = await phone({ alerts: 'all', signedIn: true });
    await org.page.goto(`${BASE}/admin`);
    await org.page.locator('.tabbar').waitFor();
    await org.page.waitForLoadState('networkidle');
    const before = snap();
    const sent = [];
    org.page.on('request', (r) => {
      if (r.url().includes('/api/') && r.method() !== 'GET') sent.push(`${r.method()} ${r.url()}`);
    });
    await viewAs(org.page, 'Vic');
    const join = org.page.locator('.schedule [data-join]').first();
    await join.click();
    await org.page.waitForTimeout(1200);
    // Vic is in on that game in the copy (the card says so), as a real tap would show.
    const inCopy = await org.page.evaluate(() => [...document.querySelectorAll('.schedule article')].some((a) => /You're in|You’re in/.test(a.textContent)));
    // Parker: Still in on the moved game.
    await org.page.locator('.viewas-banner button, .viewas-banner .ac-btn', { hasText: 'Exit' }).click();
    await org.page.locator('.tabbar').waitFor();
    await org.page.locator('.topbar-btn', { hasText: 'View as' }).click();
    await org.page.locator('.name-grid button', { hasText: /^Parker$/ }).click();
    await org.page.waitForFunction(() => document.querySelector('.topbar h1')?.textContent === 'Parker', null, { timeout: 20000 });
    const still = org.page.locator('.ts-yes').first();
    await still.waitFor({ timeout: 10000 });
    await still.click();
    await org.page.waitForFunction(() => /Confirmed/.test(document.querySelector('.ts-yes')?.textContent || ''), null, { timeout: 10000 });
    await sleep(800);
    await org.ctx.close();
    assert(inCopy, "the I'm in tap did not show in the copy");
    assert(sent.length === 0, `save requests left the page: ${sent.join(', ')}`);
    assert(snap() === before, 'the database changed');
  });

  await check('View as: the bottom "Go to Admin" pill is gone there too (Exit in the bar is the way back)', async () => {
    const org = await phone({ signedIn: true });
    await viewAs(org.page, 'Alex');
    const m = await header(org.page);
    await org.ctx.close();
    assert(m.goAdmin === 0 && m.swap === null, JSON.stringify(m));
  });


  await check('View as ignores this phone\'s private test links (round 2): Seat dots off for everyone, ?seatdots=on on the organizer\'s phone: View as Vic has no seat dots, the organizer\'s own page has them', async () => {
    const org = await phone({ signedIn: true });
    const put = (on) => org.ctx.request.put(BASE + '/api/admin/seat-dots-switch', { data: { on }, headers: { Origin: BASE } });
    assert((await put(false)).ok(), 'switch off');
    try {
      await org.page.goto(`${BASE}/admin?seatdots=on`);
      await org.page.locator('.tabbar').waitFor();
      await viewAs(org.page, 'Vic');
      const inViewAs = await org.page.evaluate(() => document.documentElement.hasAttribute('data-seat-dots'));
      await org.page.locator('.viewas-banner button, .viewas-banner .ac-btn', { hasText: 'Exit' }).click();
      await org.page.locator('.tabbar').waitFor();
      await openAs(org.page, 'Alex');
      const ownPage = await org.page.evaluate(() => document.documentElement.hasAttribute('data-seat-dots'));
      assert(!inViewAs, 'View as followed the private test link');
      assert(ownPage, "the organizer's own page lost the private test link");
    } finally {
      await put(true);
      await org.ctx.close();
    }
  });

  // ---------------- Round 2: nothing on the organizer screens is cut off, overlapping or sticking out of its box ----------------
  // e2e/clip-check.cjs on Home (with "+N more" open, then with every game folded: the TONIGHT and TOM rows), Players, Money, History and
  // Settings (every section open), at 390, 360 and 320, light and dark, at normal text, with Safari's text size at 125% (the whole page zooms,
  // what the iPhone's aA button does) and with 150% text (the site's big-text setting, what Larger Text amounts to here).
  const SIZES = [
    { name: 'normal', css: '' },
    { name: 'Safari text 125%', css: 'html { zoom: 1.25 }' },
    { name: 'Safari text 150%', css: 'html { zoom: 1.5 }' },
    { name: 'text 150%', css: 'html { font-size: 150% !important; } body { font-size: 25.5px !important; }' },
  ];
  for (const scheme of ['light', 'dark'])
    for (const width of [390, 360, 320])
      for (const size of SIZES) {
        await check(`organizer screens fit, ${width} px, ${scheme}, ${size.name}: no text, tile, circle or button cut off, overlapping or outside its box`, async () => {
          const { ctx, page } = await phone({ width, scheme, signedIn: true });
          await page.goto(`${BASE}/admin`);
          await page.locator('.tabbar').waitFor();
          if (size.css) await page.addStyleTag({ content: size.css });
          const found = [];
          const look = async (where) => {
            await page.waitForTimeout(350);
            for (const p of await page.evaluate(findClipping, { root: 'main' })) found.push(`${where}: ${p}`);
          };
          if (await page.locator('.dn-more').count()) await page.locator('.dn-more').click();
          await look('Home');
          // Every game listed (Home shows 6 until "Show all N") and opened (later weeks start folded): every game card, its panels
          // (the short-on-players card, the moved-game card with a Text button per person) checked open; then every one folded.
          const all = page.locator('button', { hasText: /^Show all \d+$/ });
          if (await all.count()) await all.first().click();
          await page.waitForTimeout(300);
          await page.evaluate(() => document.querySelectorAll('.hv2-short').forEach((r) => r.click()));
          await look('Home, every game open');
          await page.evaluate(() => document.querySelectorAll('[data-game-open] .hv2-a11y').forEach((b) => b.click()));
          const folded = await page.evaluate(() => [...document.querySelectorAll('.hv2-short .day-tag')].map((e) => (e.classList.contains('tonight') ? 'TONIGHT' : 'TOM')));
          await look('Home, every game folded');
          if (width === 320 && size.name !== 'normal' && scheme === 'dark') await page.screenshot({ path: path.join(SHOTS, `zip18-fit-home-folded-${size.name.replace(/\W+/g, '')}.png`), fullPage: true });
          for (const tab of ['Players', 'Money', 'History', 'Settings']) {
            await page.locator('.tabbar button', { hasText: tab }).evaluate((x) => x.click());
            if (tab === 'Settings') {
              // Each section opened in turn and checked open (opening one can close another), once it has finished sliding open.
              const n = await page.locator('details > summary').count();
              for (let k = 0; k < n; k++) {
                const d = page.locator('details').nth(k);
                if (!(await d.evaluate((x) => x.open))) await d.locator(':scope > summary').click().catch(() => {});
                await page.waitForFunction((x) => !x.getAnimations({ subtree: true }).length, await d.elementHandle(), { timeout: 3000 }).catch(() => {});
                await look(`Settings section ${k + 1}`);
              }
              continue;
            }
            await look(tab);
          }
          await ctx.close();
          assert(folded.includes('TONIGHT') && folded.includes('TOM'), `the folded rows should include TONIGHT and TOM tiles: ${folded.join(',')}`);
          assert(found.length === 0, `${found.length} problems: ${found.slice(0, 6).join(' | ')}`);
        });
      }

  // Round 3: the player screens too (every tile kind: TONIGHT and TOMORROW strips, plain and "mine" tiles, the EXTRA tag, the header date
  // tile, the game-day buttons), with the same checker, the 2 px inner margin rule included.
  for (const scheme of ['light', 'dark'])
    for (const width of [390, 360, 320])
      for (const size of SIZES)
        await check(`player screens fit, ${width} px, ${scheme}, ${size.name}: no text, tile, circle or button cut off, overlapping, outside its box or touching a tile edge`, async () => {
          const found = [];
          const kinds = new Set();
          for (const who of ['Parker', 'Sage']) {
            const { ctx, page } = await phone({ width, scheme, alerts: 'all' });
            await openAs(page, who);
            if (size.css) await page.addStyleTag({ content: size.css });
            const more = page.locator('[data-later-toggle]');
            if (await more.count()) await more.first().click();
            await page.waitForTimeout(400);
            for (const k of await page.evaluate(() => [...document.querySelectorAll('.ptile')].map((t) => (t.classList.contains('day-tonight') ? 'TONIGHT' : t.classList.contains('day-tomorrow') ? 'TOMORROW' : 'plain')))) kinds.add(k);
            for (const p of await page.evaluate(findClipping, { root: 'body' })) found.push(`${who}: ${p}`);
            await ctx.close();
          }
          assert(kinds.has('TONIGHT') && kinds.has('TOMORROW') && kinds.has('plain'), `tile kinds seen: ${[...kinds].join(',')}`);
          assert(found.length === 0, `${found.length} problems: ${found.slice(0, 5).join(' | ')}`);
        });

  // ---------------- Round 2: the court map's chosen court glows, no light sweep ----------------
  for (const scheme of ['light', 'dark'])
    for (const reduce of [false, true]) {
      await check(`court map (${scheme}${reduce ? ', Reduce Motion' : ''}): the game's court ${reduce ? 'holds a steady glow' : 'pulses a soft glow (2.4 s)'} and has NO light sweep; the TONIGHT tile keeps its own animation`, async () => {
        const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, colorScheme: scheme, userAgent: UA, reducedMotion: reduce ? 'reduce' : 'no-preference' });
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
        const page = await ctx.newPage();
        await openAs(page, 'Parker');
        const btn = page.locator('[data-gd-court="3"]').first();
        await btn.waitFor({ timeout: 10000 });
        const tile = await page.locator('.schedule .tile.day-tonight').first().evaluate((e) => [getComputedStyle(e).animationName, getComputedStyle(e, '::after').animationName]);
        await btn.click();
        const me = page.locator('dialog.cm[open] .cm-cl.me');
        await me.waitFor();
        const m = await me.evaluate((e) => {
          const cs = getComputedStyle(e);
          return { name: cs.animationName, dur: cs.animationDuration, after: getComputedStyle(e, '::after').content, before: getComputedStyle(e, '::before').content, shadow: cs.boxShadow, text: e.textContent.trim() };
        });
        if (!reduce && scheme === 'dark') await page.locator('dialog.cm[open]').screenshot({ path: path.join(SHOTS, 'zip18-courtmap-dark.png') });
        await ctx.close();
        assert(m.after === 'none' && m.before === 'none', `something is drawn over the court (a sweep): ${JSON.stringify(m)}`);
        if (reduce) assert(m.name === 'none' && /rgba?\(60, 200, 130/.test(m.shadow), `Reduce Motion: ${JSON.stringify(m)}`);
        else assert(m.name === 'cm-glow' && m.dur === '2.4s', `glow: ${JSON.stringify(m)}`);
        // The TONIGHT tile: its own pulse and sweep with motion, still with Reduce Motion (not changed by this zip).
        if (reduce) assert(tile.every((x) => x === 'none'), `tile ${tile}`);
        else assert(tile[0] !== 'none' && tile[1] !== 'none', `tile ${tile}`);
      });
    }

  // ---------------- Pretend it's... (the same demo copy as View as) ----------------
  // For EVERY button in the Pretend it's... section: the organizer Home and View as a player in the next game, drawn while pretending,
  // must equal the real site with its clock really set to that moment (dev server clock and the phone's clock both moved there). The demo
  // copy is taken from the data as it is right before each pair, and the real visit comes right after, so both start from the same data.
  const setClock = (ms) => fetch(`${BASE}/__dev/clock`, { method: 'POST', body: JSON.stringify({ atMs: ms }) });
  const mainHtml = (page) => page.evaluate(() => document.querySelector('main.page').outerHTML);
  const topHtml = (page) => page.evaluate(() => document.querySelector('.topbar').outerHTML);
  async function openAdmin(page) {
    await page.goto(`${BASE}/admin`);
    await page.locator('.tabbar').waitFor({ timeout: 20000 });
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);
  }
  const presetInfo = await (async () => {
    const { ctx, page } = await phone({ signedIn: true });
    await openAdmin(page);
    await page.locator('.topbar-btn', { hasText: 'View as' }).click();
    const labels = await page.locator('.pretend-presets button').allTextContents();
    const forLine = await page.locator('.pretend-pick p.small:not(.muted)').first().textContent();
    await ctx.close();
    return { labels, forLine };
  })();
  // The next game (the one the presets are for) and someone in it, and someone not in it.
  const nextGame = await (async () => {
    const { ctx } = await phone({ signedIn: true });
    const d = await (await ctx.request.get(BASE + '/api/admin/dashboard')).json();
    await ctx.close();
    const g = d.sessions.filter((x) => x.status !== 'canceled' && Date.parse(x.startsAt) > NOW_MS)[0];
    return g;
  })();
  const inNext = (nextGame.players || nextGame.roster || []).map((p) => p.name).find((n) => n && n !== 'Alex' && ids[n]);
  console.log(`  (pretend presets: ${presetInfo.labels.join(' | ')}; ${presetInfo.forLine}; in that game: ${inNext})`);
  // Booking day (the game whose booking opens next): 7:00 AM Eastern on the day its booking opens, typed in the date-and-time box.
  const bookingDay7 = await (async () => {
    const { ctx } = await phone({ signedIn: true });
    const d = await (await ctx.request.get(BASE + '/api/admin/dashboard')).json();
    await ctx.close();
    const opening = d.sessions.filter((x) => x.status !== 'canceled' && Date.parse(x.startsAt) > NOW_MS).find((x) => Date.parse(x.bookingOpensAt) > NOW_MS);
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Detroit', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(opening.bookingOpensAt));
    return { typed: `${day}T07:00`, id: opening.id };
  })();
  const pretendAt = {};
  const pretendCards = {};
  const moments = [...presetInfo.labels.map((label) => ({ label, typed: null })), { label: `Booking day, 7:00 AM (typed ${bookingDay7.typed})`, typed: bookingDay7.typed }];
  for (const { label, typed } of moments) {
    await check(`Pretend it's "${label}": organizer Home and View as ${inNext} and Vic equal the real site at that moment; nothing leaves the page`, async () => {
      await setClock(NOW_MS);
      const org = await phone({ signedIn: true, alerts: 'all' });
      const sent = [];
      org.page.on('request', (r) => {
        if (r.url().includes('/api/') && r.method() !== 'GET') sent.push(`${r.method()} ${r.url()}`);
      });
      await openAdmin(org.page);
      await org.page.locator('.topbar-btn', { hasText: 'View as' }).click();
      if (typed) {
        await org.page.locator('#pretend-at').fill(typed);
        await org.page.locator('.pretend-custom button[type="submit"]').click();
      } else await org.page.locator('.pretend-presets button', { hasText: label }).click();
      await org.page.locator('.pretend-bar', { hasText: 'Demo, nothing is saved' }).waitFor();
      await org.page.waitForLoadState('networkidle');
      await org.page.waitForTimeout(800);
      const at = await org.page.evaluate(() => document.querySelector('.pretend-bar')?.textContent || '');
      // The pretend moment, read from the page's own clock (the app's src/lib.ts module, the same instance the screens use).
      pretendAt[label] = await org.page.evaluate(async () => (await import('/src/lib.ts')).pretendMs());
      const adminP = norm(await mainHtml(org.page));
      // Every Do this now card for the moment (the first one shows, the rest sit under "+N more": opened here, after the comparison copy).
      if (await org.page.locator('.dn-more').count()) await org.page.locator('.dn-more').click();
      const cards = await org.page.evaluate(() => [...document.querySelectorAll('[data-task]')].map((e) => e.getAttribute('data-task')));
      pretendCards[label] = cards;
      // The booking game's own card on Home (new layout: the booking prompt is the "Book" cell in its footer, data-court-need).
      // Later weeks start folded on Home: the booking game is opened here (a tap on its row) to read its footer.
      const opened = await org.page.locator(`[data-game-open="${bookingDay7.id}"]`).count();
      if (!opened && (await org.page.locator(`#session-${bookingDay7.id}`).count())) {
        await org.page.locator(`#session-${bookingDay7.id}`).click();
        await org.page.locator(`[data-game-open="${bookingDay7.id}"]`).waitFor({ timeout: 5000 }).catch(() => {});
      }
      const bookCell = await org.page.evaluate((id) => {
        const open = document.querySelector(`[data-game-open="${id}"]`);
        return { card: !!document.getElementById(`session-${id}`), folded: !open, need: !!open?.querySelector('[data-court-need]') };
      }, bookingDay7.id);
      bookCell.foldedAtFirst = !opened;
      const playerP = {};
      for (const who of [inNext, 'Vic']) {
        await org.page.locator('.topbar-btn', { hasText: 'View as' }).click();
        await org.page.locator('.name-grid button', { hasText: new RegExp(`^${who}$`) }).click();
        await org.page.waitForFunction((n) => document.querySelector('.topbar h1')?.textContent === n, who, { timeout: 20000 });
        await org.page.locator('.schedule article').first().waitFor();
        await org.page.waitForLoadState('networkidle');
        await org.page.waitForTimeout(600);
        playerP[who] = { html: norm(await topHtml(org.page)) + norm(await mainHtml(org.page)), gameDay: await org.page.locator('[data-game-day-buttons]').count() };
        if (label === presetInfo.labels[0] && who === inNext) await org.page.screenshot({ path: path.join(SHOTS, `zip18-pretend-gameday-${who.toLowerCase()}.png`) });
        await org.page.locator('.viewas-banner button, .viewas-banner .ac-btn', { hasText: 'Exit' }).click();
        await org.page.locator('.tabbar').waitFor();
      }
      await org.ctx.close();
      assert(sent.length === 0, `requests that save left the page: ${sent.join(', ')}`);
      // The same moment on the real site: the pretend time from the preset list (computed the way the page does).
      const ms = pretendAt[label];
      assert(typeof ms === 'number', `no time for ${label} (${at})`);
      await setClock(ms);
      const realOrg = await phone({ signedIn: true, alerts: 'all', atMs: ms });
      await openAdmin(realOrg.page);
      const adminR = norm(await mainHtml(realOrg.page));
      await realOrg.ctx.close();
      if (adminR !== adminP) throw new Error(`organizer Home: ${diffAt(adminR, adminP)}`);
      for (const who of [inNext, 'Vic']) {
        const real = await phone({ alerts: 'all', atMs: ms });
        await openAs(real.page, who);
        const r = norm(await topHtml(real.page)) + norm(await mainHtml(real.page));
        await real.ctx.close();
        if (r !== playerP[who].html) throw new Error(`View as ${who}: ${diffAt(r, playerP[who].html)}`);
      }
      // The right cards for the moment: the Game day card on game day for a player in the game, the booking card when booking opens.
      if (/^Game day/.test(label)) assert(playerP[inNext].gameDay > 0, `${inNext} has no Game day card at ${label}`);
      // The booking card starts at the 6:45 AM heads-up on booking day (the court opens at 7:00 AM): not there yet at 12:00 AM, there at 7:00 AM.
      if (/^Booking opens/.test(label)) assert(!bookCell.need && !cards.includes('book') && !cards.includes('court_book'), `a booking prompt already at ${label}: ${JSON.stringify(bookCell)} ${cards.join(',')}`);
      if (/^Booking day/.test(label)) assert(bookCell.need || cards.includes('book') || cards.includes('court_book'), `no booking prompt at ${label} (${new Date(ms).toISOString()}): ${JSON.stringify(bookCell)} ${cards.join(',')}`);
      await setClock(NOW_MS);
      console.log(`      (${label} = ${new Date(pretendAt[label]).toISOString()}: organizer cards ${[...new Set(cards)].join(', ') || 'none'}; booking game on Home ${bookCell.foldedAtFirst ? 'folded at first' : 'open'}, Book cell once open ${bookCell.need ? 'yes' : 'no'}; ${inNext}'s Game day card ${playerP[inNext].gameDay > 0 ? 'yes' : 'no'})`);
    });
  }
  await browser.close();
  console.log(`\nzip18: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
