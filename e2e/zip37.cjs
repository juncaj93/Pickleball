/* Zip 37: "Home Screen tip" (HOME_SCREEN_TIP) and "Game day text" (GAME_DAY_TEXT), both ship OFF.
 *
 *   node e2e/zip37.cjs      (also run by npm run test:e2e)       E2E_SHOTS=<folder> keeps the pictures
 *
 * The SMALL fake world (the 10 fixed names) on its own dev server; nothing touches Cloudflare.
 *   A  the card: above THIS WEEK, the mock's words and sizes, light and dark, 390/360/320, nothing clipped;
 *   B  when it shows, in the real browser: first visit hidden, a quick reload hidden, second visit shown, the X is for good, iPhone and iPad
 *      Safari only, a Home Screen app hidden, a player from before this shipped sees it at once, a phone that blocks storage never crashes;
 *   C  the sheet: three pictured steps, rings are true circles (same width and height), the dark toolbar picture in dark mode, the green
 *      Got it in both modes, Got it and the sheet's X both finish it for good;
 *   D  OFF: no flag, no card (the private link still works on one phone);
 *   E  the game day text page (/gt/preview): the words, the Messages link (only the players in the game, never the organizer), no numbers on
 *      screen, a bad link says so and holds no number; nothing clipped at 390/360/320, light and dark.
 */
const { spawn, spawnSync } = require('node:child_process');
const { readFileSync, mkdirSync, rmSync } = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { findClipping } = require('./clip-check.cjs');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.E2E_PORT) || 5437;
const BASE = `http://localhost:${PORT}`;
const SHOTS = process.env.E2E_SHOTS || '';
const PIN = /PIN `(\d{6})`/.exec(readFileSync(path.join(ROOT, 'docs/PREVIEW_FAKE_DB.md'), 'utf8'))[1];
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const IPAD_AS_MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
const CHROME_IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0.6723.37 Mobile/15E148 Safari/604.1';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';
const DESKTOP = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';

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
    console.log(`  ✗ ${name}\n      ${String(err && err.message ? err.message : err).replace(/\s*\n\s*/g, ' ⏎ ').slice(0, 1600)}`);
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const dbFile = path.join(ROOT, '.data', 'zip37.sqlite');
  mkdirSync(path.join(ROOT, '.data'), { recursive: true });
  if (SHOTS) mkdirSync(SHOTS, { recursive: true });
  rmSync(dbFile, { force: true });
  const seeded = spawnSync('npx', ['vite-node', 'scripts/load-small-local.ts', '--', dbFile, new Date().toISOString()], { cwd: ROOT, encoding: 'utf8' });
  if (seeded.status !== 0) throw new Error(`could not build the fake world: ${seeded.stderr || seeded.stdout}`);
  if (await fetch(`${BASE}/api/status`).then((r) => r.ok, () => false)) throw new Error(`port ${PORT} is already in use`);
  const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
    cwd: ROOT,
    env: { ...process.env, DEV_DB: dbFile, SETUP_TOKEN: 'zip37-setup-token-0123456789', PREVIEW_CALM: 'on', GAME_DAY_TEXT_PREVIEW: 'on', MOTION_ADMIN: 'on', MOTION: 'on' },
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
  const browser = await chromium.launch();
  const orgCtx = await browser.newContext();
  const call = async (method, url, data, headers = {}) => {
    const res = await orgCtx.request.fetch(BASE + url, { method, data, headers: { Origin: BASE, ...headers } });
    return { status: res.status(), ok: res.ok(), json: await res.json().catch(() => ({})), text: await res.text().catch(() => '') };
  };
  if (!(await call('POST', '/api/admin/login', { pin: PIN })).ok) throw new Error('login failed');
  const dash = async (headers) => (await call('GET', '/api/admin/dashboard', undefined, headers)).json;
  const d0 = await dash();
  assert(d0.homeScreenTipForAll === true && d0.gameDayTextForAll === true, 'the preview world should have both rows on (PREVIEW SWITCHES RULE: the switches being built are on in their own preview)');
  const setTip = (on) => call('PUT', '/api/admin/home-screen-tip-switch', { on });

  /** A phone. `ua` iPhone Safari by default. `init` runs before the page's own scripts. */
  async function phone({ width = 390, scheme = 'light', ua = IPHONE, init = null, height = 800, pct = 100, dpr = 1 } = {}) {
    const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: dpr, colorScheme: scheme, isMobile: true, hasTouch: true, userAgent: ua, reducedMotion: 'reduce' });
    if (init) await ctx.addInitScript(init);
    const page = await ctx.newPage();
    page.pct = pct;
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.errors = errors;
    return { ctx, page };
  }
  /** Open Home as a fake player and wait for the schedule. */
  async function home(page, name, query = '') {
    await page.goto(`${BASE}/?as=${encodeURIComponent(name)}${query ? '&' + query : ''}`);
    await page.locator('.schedule').first().waitFor({ timeout: 25000 });
    if (page.pct && page.pct !== 100) await page.addStyleTag({ content: `html { font-size: ${page.pct}% !important; } body { font-size: ${(17 * page.pct) / 100}px !important; }` });
    await page.waitForTimeout(500);
  }
  const reload = async (page) => {
    await page.reload();
    await page.locator('.schedule').first().waitFor({ timeout: 25000 });
    await page.waitForTimeout(400);
  };
  const tipCount = (page) => page.locator('[data-hs-tip]').count();
  const store = (page, key) => page.evaluate((k) => localStorage.getItem(k), key);
  const shot = async (page, name, sel) => {
    if (!SHOTS) return;
    const file = path.join(SHOTS, name);
    if (sel) await page.locator(sel).first().screenshot({ path: file });
    else await page.screenshot({ path: file });
  };
  const rgb = (c) => c.replace(/\s/g, '');

  // ================================================================ A: the card
  for (const scheme of ['light', 'dark']) {
    await check(`A ${scheme}: the card sits above THIS WEEK, has the mock's words, sizes and colors`, async () => {
      const { ctx, page } = await phone({ scheme, dpr: 2 });
      await home(page, 'Parker', 'hstip=now');
      await reload(page);
      assert((await tipCount(page)) === 1, 'the card should show on the second visit');
      const card = page.locator('[data-hs-tip]');
      const top = await card.evaluate((el) => el.getBoundingClientRect().top);
      const weekTop = await page.locator('.week-break').first().evaluate((el) => el.getBoundingClientRect().top);
      assert(top < weekTop, `the card (${top}) should be above THIS WEEK (${weekTop})`);
      const title = await page.locator('.hs-tip-title').innerText();
      const sub = await page.locator('.hs-tip-sub').innerText();
      const pill = await page.locator('.hs-tip-pill').innerText();
      assert(title === 'Rather have this as an app?' && sub === 'Add it to your Home Screen' && pill === 'Show me how', `words: ${title} / ${sub} / ${pill}`);
      assert((await page.getByText('Not now').count()) === 0, 'there is no Not now link');
      const s = await page.evaluate(() => {
        const q = (sel) => document.querySelector(sel);
        const cs = (el) => getComputedStyle(el);
        const card = q('.hs-tip');
        const ring = q('.hs-tip-x-ring').getBoundingClientRect();
        const pill = q('.hs-tip-pill');
        return {
          radius: cs(card).borderTopLeftRadius,
          border: cs(card).borderTopWidth,
          bg: cs(card).backgroundColor,
          line: cs(card).borderTopColor,
          titleSize: cs(q('.hs-tip-title')).fontSize,
          titleWeight: cs(q('.hs-tip-title')).fontWeight,
          subSize: cs(q('.hs-tip-sub')).fontSize,
          subColor: cs(q('.hs-tip-sub')).color,
          pillH: pill.getBoundingClientRect().height,
          pillBg: cs(pill).backgroundColor,
          pillInk: cs(pill).color,
          pillBelowText: pill.getBoundingClientRect().top >= q('.hs-tip-sub').getBoundingClientRect().bottom,
          xRing: [ring.width, ring.height],
          icon: [q('.hs-tip-icon').getBoundingClientRect().width, q('.hs-tip-icon').getBoundingClientRect().height],
          iconBg: cs(q('.hs-tip-icon')).backgroundColor,
          xHit: [q('.hs-tip-x').getBoundingClientRect().width, q('.hs-tip-x').getBoundingClientRect().height],
        };
      });
      const want = scheme === 'light' ? { bg: 'rgb(241,242,251)', line: 'rgb(201,207,238)', sub: 'rgb(102,106,98)', pillBg: 'rgb(56,70,166)', pillInk: 'rgb(255,255,255)', iconBg: 'rgb(225,229,248)' } : { bg: 'rgb(23,29,46)', line: 'rgb(47,58,99)', sub: 'rgb(154,160,151)', pillBg: 'rgb(165,176,244)', pillInk: 'rgb(20,26,69)', iconBg: 'rgb(37,44,82)' };
      // Chromium draws a 1.5px border as 1px (a whole pixel); iPhone Safari keeps 1.5px. The mock's value is in the stylesheet itself.
      assert(s.radius === '24px' && ['1px', '1.5px'].includes(s.border), `radius ${s.radius}, border ${s.border}`);
      assert(/\.hs-tip \{[^}]*border: 1\.5px solid var\(--hs-card-line\)/s.test(readFileSync(path.join(ROOT, 'src/home-screen-tip.css'), 'utf8')), 'the card border is 1.5px in the stylesheet');
      assert(rgb(s.bg) === want.bg && rgb(s.line) === want.line && rgb(s.subColor) === want.sub, `colors ${s.bg} ${s.line} ${s.subColor}`);
      assert(rgb(s.pillBg) === want.pillBg && rgb(s.pillInk) === want.pillInk && rgb(s.iconBg) === want.iconBg, `pill/icon ${s.pillBg} ${s.pillInk} ${s.iconBg}`);
      assert(s.titleSize === '16.5px' && s.titleWeight === '700' && s.subSize === '14px', `type ${s.titleSize} ${s.titleWeight} ${s.subSize}`);
      assert(s.pillH === 38 && s.pillBelowText, `pill ${s.pillH} below ${s.pillBelowText}`);
      assert(s.xRing[0] === 32 && s.xRing[1] === 32 && s.icon[0] === 34 && s.icon[1] === 34, `x ${s.xRing} icon ${s.icon}`);
      assert(s.xHit[0] >= 44 && s.xHit[1] >= 44, `the X tap area is ${s.xHit}`);
      await shot(page, `card_${scheme}_390.png`, '[data-hs-tip]');
      await shot(page, `home_${scheme}_390.png`);
      assert(page.errors.length === 0, `page errors: ${page.errors}`);
      await ctx.close();
    });
    for (const width of [390, 360, 320]) {
      await check(`A ${scheme} ${width}: card and sheet are not clipped, not wider than the screen, at text 100% and 150%`, async () => {
        for (const pct of [100, 150]) {
          const { ctx, page } = await phone({ width, scheme, pct });
          await home(page, 'Parker', 'hstip=now');
          await reload(page);
          assert((await tipCount(page)) === 1, 'the card shows');
          const problems = await page.evaluate(findClipping, { root: '[data-hs-tip]' });
          assert(problems.length === 0, `card clipped at ${width}/${pct}%: ${problems.join(' | ')}`);
          const wide = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
          assert(!wide, 'the page scrolls sideways');
          await page.locator('[data-hs-show]').click();
          await page.locator('[data-hs-steps]').waitFor();
          await page.waitForTimeout(500);
          const sheet = await page.evaluate(findClipping, { root: 'dialog.hs-sheet' });
          assert(sheet.length === 0, `sheet clipped at ${width}/${pct}%: ${sheet.join(' | ')}`);
          if (pct === 100) await shot(page, `sheet_${scheme}_${width}.png`, 'dialog.hs-sheet');
          await ctx.close();
        }
      });
    }
  }

  // ================================================================ B: when it shows
  await check('B first visit hidden, quick reload hidden, second visit (30+ minutes later) shown, the X is for good', async () => {
    const { ctx, page } = await phone();
    await home(page, 'Parker');
    assert((await tipCount(page)) === 0, 'a brand new phone gets a clean first screen');
    assert((await store(page, 'pb_hs_first')) !== null, 'the first open is written down');
    await reload(page);
    assert((await tipCount(page)) === 0, 'a quick reload is not a second visit');
    // 29 minutes later: still not.
    await page.evaluate(() => localStorage.setItem('pb_hs_first', String(Date.now() - 29 * 60000)));
    await reload(page);
    assert((await tipCount(page)) === 0, '29 minutes is not a second visit');
    await page.evaluate(() => localStorage.setItem('pb_hs_first', String(Date.now() - 31 * 60000)));
    await reload(page);
    assert((await tipCount(page)) === 1, '31 minutes later is the second visit');
    await page.locator('[data-hs-x]').click();
    await page.waitForTimeout(300);
    assert((await tipCount(page)) === 0, 'the X hides it now');
    assert((await store(page, 'pb_hs_done')) === '1', 'the X is remembered');
    await reload(page);
    assert((await tipCount(page)) === 0, 'and never again on this phone');
    assert((await page.getByText('Not now').count()) === 0, 'no Not now');
    assert(page.errors.length === 0, `page errors: ${page.errors}`);
    await ctx.close();
  });

  await check('B iPhone and iPad Safari only: Android, a computer, Chrome on iPhone, and a Home Screen app never see it', async () => {
    const old = () => localStorage.setItem('pb_hs_first', String(Date.now() - 5 * 3600000));
    for (const [name, opts] of [
      ['Android', { ua: ANDROID }],
      ['a computer', { ua: DESKTOP }],
      ['Chrome on iPhone', { ua: CHROME_IOS }],
      ['a Home Screen app (navigator.standalone)', { init: () => Object.defineProperty(navigator, 'standalone', { value: true }) }],
      ['a Home Screen app (display-mode: standalone)', { init: () => { const m = window.matchMedia.bind(window); window.matchMedia = (q) => (/display-mode:\s*standalone/.test(q) ? { matches: true, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false } : m(q)); } }],
    ]) {
      const { ctx, page } = await phone(opts);
      await home(page, 'Parker');
      await page.evaluate(old);
      await reload(page);
      assert((await tipCount(page)) === 0, `${name} must not see the card`);
      await ctx.close();
    }
    // The iPad that says it is a Mac (touch screen) is an iPad: it sees it.
    const { ctx, page } = await phone({ ua: IPAD_AS_MAC, init: () => { Object.defineProperty(navigator, 'platform', { get: () => 'MacIntel' }); Object.defineProperty(navigator, 'maxTouchPoints', { get: () => 5 }); } });
    await home(page, 'Parker');
    await page.evaluate(old);
    await reload(page);
    assert((await tipCount(page)) === 1, 'an iPad in Safari sees the card');
    await ctx.close();
  });

  await check('B a player from before this shipped (name already picked, no first-open record) sees it on the next open', async () => {
    const { ctx, page } = await phone();
    await home(page, 'Parker'); // picks the name (cookie)
    await page.evaluate(() => localStorage.clear()); // as if the phone never kept a first open
    await reload(page);
    assert((await tipCount(page)) === 1, 'it shows at once');
    assert((await store(page, 'pb_hs_first')) === '1', 'a long-ago first open is written');
    await ctx.close();
  });

  await check('B never on "Who are you?", never in View as; a phone that blocks storage never crashes and shows it at most once per page load', async () => {
    // Who are you?
    const a = await phone();
    await a.page.goto(`${BASE}/`);
    await a.page.waitForTimeout(1500);
    await a.page.evaluate(() => localStorage.setItem('pb_hs_first', '1'));
    await a.page.reload();
    await a.page.waitForTimeout(1500);
    assert((await tipCount(a.page)) === 0, 'not on the name picker');
    await a.ctx.close();
    // View as: the organizer's demo copy of a player's screen.
    const org = await browser.newContext({ viewport: { width: 390, height: 800 }, userAgent: IPHONE, isMobile: true, hasTouch: true });
    await org.request.post(BASE + '/api/admin/login', { data: { pin: PIN }, headers: { Origin: BASE } });
    const p = await org.newPage();
    await p.addInitScript(() => localStorage.setItem('pb_hs_first', '1'));
    await p.goto(`${BASE}/admin`);
    await p.locator('article[data-r2-card]').first().waitFor({ timeout: 20000 });
    assert((await tipCount(p)) === 0, 'not on /admin');
    await org.close();
    // View as (the organizer's demo copy of a player's screen), on a phone that would otherwise be far past its second visit.
    const va = await phone();
    await va.page.addInitScript(() => localStorage.setItem('pb_hs_first', '1'));
    assert((await va.ctx.request.post(BASE + '/api/admin/login', { data: { pin: PIN }, headers: { Origin: BASE } })).ok(), 'admin login');
    await va.page.goto(`${BASE}/admin`);
    await va.page.locator('.tabbar').waitFor();
    await va.page.locator('.topbar-btn', { hasText: 'View as' }).click();
    await va.page.locator('.name-grid button', { hasText: /^Parker$/ }).click();
    await va.page.waitForFunction(() => document.querySelector('.topbar h1')?.textContent === 'Parker', null, { timeout: 20000 });
    await va.page.locator('.schedule article').first().waitFor();
    await va.page.waitForTimeout(800);
    assert((await tipCount(va.page)) === 0, 'not in View as');
    await va.ctx.close();
    // Storage blocked.
    const blocked = await phone({ init: () => Object.defineProperty(window, 'localStorage', { get() { throw new Error('storage blocked'); } }) });
    await blocked.page.goto(`${BASE}/?as=Parker`);
    await blocked.page.locator('.schedule').first().waitFor({ timeout: 25000 });
    await blocked.page.waitForTimeout(600);
    assert((await tipCount(blocked.page)) === 0, 'a brand new phone that cannot keep a first open never shows it');
    await blocked.page.reload();
    await blocked.page.locator('.schedule').first().waitFor({ timeout: 25000 });
    await blocked.page.waitForTimeout(600);
    const n = await tipCount(blocked.page);
    assert(n <= 1, `at most once per page load (${n})`);
    if (n === 1) {
      await blocked.page.locator('[data-hs-x]').click();
      await blocked.page.waitForTimeout(300);
      assert((await tipCount(blocked.page)) === 0, 'the X still hides it for this page load');
    }
    assert(blocked.page.errors.length === 0, `blocked storage must not crash: ${blocked.page.errors}`);
    await blocked.ctx.close();
  });

  // ================================================================ C: the sheet
  for (const scheme of ['light', 'dark']) {
    await check(`C ${scheme}: the sheet has three pictured steps, true circles, the right toolbar picture and the green Got it; Got it finishes it for good`, async () => {
      const { ctx, page } = await phone({ scheme });
      await home(page, 'Parker', 'hstip=now');
      await reload(page);
      await page.locator('[data-hs-show]').click();
      await page.locator('[data-hs-steps]').waitFor();
      await page.waitForTimeout(600);
      assert((await page.locator('dialog.hs-sheet h2').innerText()) === 'Add to Home Screen', 'title');
      const steps = await page.locator('[data-hs-step]').evaluateAll((els) => els.map((e) => e.querySelector('.hs-step-title').textContent));
      assert(JSON.stringify(steps) === JSON.stringify(['Tap the Share button', 'Tap View More', 'Tap Add to Home Screen']), `steps: ${steps}`);
      assert((await page.getByText("Scroll down if you don't see it").count()) === 1, 'the hint under step 3');
      const pics = await page.evaluate(() =>
        [...document.querySelectorAll('.hs-img')].filter((i) => getComputedStyle(i).display !== 'none').map((i) => ({ src: i.getAttribute('src'), ok: i.complete && i.naturalWidth > 0, w: i.getBoundingClientRect().width })),
      );
      assert(pics.length === 3 && pics.every((x) => x.ok), `pictures: ${JSON.stringify(pics)}`);
      assert(pics[0].src.includes(scheme === 'dark' ? 'toolbar-dark' : 'toolbar-light'), `the ${scheme} toolbar picture: ${pics[0].src}`);
      const rings = await page.evaluate(() => [...document.querySelectorAll('[data-hs-ring="dot"]')].map((r) => { const b = r.getBoundingClientRect(); return [Math.round(b.width * 100) / 100, Math.round(b.height * 100) / 100, getComputedStyle(r).borderRadius]; }));
      assert(rings.length === 2 && rings[0][0] === 54 && rings[0][1] === 54 && rings[1][0] === 78 && rings[1][1] === 78 && rings.every((r) => r[2] === '50%'), `rings are fixed circles: ${JSON.stringify(rings)}`);
      assert((await page.locator('[data-hs-ring="row"]').count()) === 1, 'step 3 outlines the whole row');
      // Each ring sits on its target inside its picture.
      const inside = await page.evaluate(() => [...document.querySelectorAll('.hs-pic')].map((p) => { const r = p.querySelector('.hs-ring').getBoundingClientRect(); const b = p.getBoundingClientRect(); return r.left >= b.left - 3 && r.right <= b.right + 3 && r.top >= b.top - 3 && r.bottom <= b.bottom + 3; }));
      assert(inside.every(Boolean), `rings stay inside their pictures: ${inside}`);
      const go = await page.locator('[data-hs-gotit]').evaluate((el) => ({ bg: getComputedStyle(el).backgroundColor, ink: getComputedStyle(el).color, h: el.getBoundingClientRect().height, w: el.getBoundingClientRect().width }));
      const wantGo = scheme === 'light' ? ['rgb(55,105,77)', 'rgb(255,255,255)'] : ['rgb(76,194,122)', 'rgb(10,42,22)'];
      assert(rgb(go.bg) === wantGo[0] && rgb(go.ink) === wantGo[1] && go.h === 52, `Got it: ${JSON.stringify(go)}`);
      await shot(page, `sheet_full_${scheme}_390.png`);
      await page.locator('[data-hs-gotit]').click();
      await page.waitForTimeout(500);
      assert((await page.locator('dialog.hs-sheet[open]').count()) === 0, 'the sheet closes');
      assert((await tipCount(page)) === 0, 'and the card is gone');
      assert((await store(page, 'pb_hs_done')) === '1', 'Got it counts as done');
      await reload(page);
      assert((await tipCount(page)) === 0, 'and it never comes back');
      assert(page.errors.length === 0, `page errors: ${page.errors}`);
      await ctx.close();
    });
  }
  await check('C the sheet\'s own X also counts as done', async () => {
    const { ctx, page } = await phone();
    await home(page, 'Parker', 'hstip=now');
    await reload(page);
    await page.locator('[data-hs-show]').click();
    await page.locator('[data-hs-steps]').waitFor();
    await page.locator('dialog.hs-sheet .sheet-head .icon-btn').click();
    await page.waitForTimeout(500);
    assert((await tipCount(page)) === 0 && (await store(page, 'pb_hs_done')) === '1', 'closing with the X finishes it');
    await reload(page);
    assert((await tipCount(page)) === 0, 'for good');
    await ctx.close();
  });

  // ================================================================ D: OFF
  await check('D OFF: no flag in the answer and no card, even for a phone that would be past its second visit; the private link works for that one phone', async () => {
    assert((await setTip(false)).ok, 'switch off');
    assert((await dash()).homeScreenTipForAll === undefined, 'the Settings row reads off');
    const { ctx, page } = await phone();
    await home(page, 'Parker', 'hstip=now');
    await reload(page);
    assert((await tipCount(page)) === 0, 'off: no card');
    assert((await store(page, 'pb_hs_first')) !== null && true, 'hstip=now only touches this phone');
    await ctx.close();
    // A phone that never opened Home while it was off keeps no record at all.
    const fresh = await phone();
    await home(fresh.page, 'Sage');
    assert((await store(fresh.page, 'pb_hs_first')) === null, 'switch off: nothing is written on the phone');
    // The private link, one phone.
    await home(fresh.page, 'Sage', 'homescreentip=on&hstip=now');
    await reload(fresh.page);
    assert((await tipCount(fresh.page)) === 1, 'the private link shows it on this phone');
    await fresh.ctx.close();
    const other = await phone();
    await home(other.page, 'Sage', 'hstip=now');
    await reload(other.page);
    assert((await tipCount(other.page)) === 0, 'another phone does not');
    await other.ctx.close();
    assert((await setTip(true)).ok, 'switch back on');
  });

  // ================================================================ E: the game day text page
  const gdt = async (opts) => {
    const { ctx, page } = await phone(opts);
    const links = [];
    page.on('request', (r) => links.push(r.url()));
    await page.goto(`${BASE}/gt/preview`);
    await page.locator('[data-gdt-open], [data-gdt-none], .notice, [role="alert"]').first().waitFor({ timeout: 20000 });
    await page.waitForTimeout(500);
    return { ctx, page };
  };
  for (const scheme of ['light', 'dark']) {
    await check(`E ${scheme}: /gt/preview shows the words and opens Messages to only the players in the game (never the organizer, no numbers on screen)`, async () => {
      const { ctx, page } = await gdt({ scheme });
      const body = await page.locator('[data-gdt-body]').innerText();
      const lines = body.split('\n');
      assert(/^Pickleball (tonight|today|tomorrow|[A-Z][a-z]{2} [A-Z][a-z]{2} \d+) @ \d{1,2}(:\d{2})?(am|pm)!( \(Court \d+\))?$/.test(lines[0]), `first line: ${lines[0]}`);
      assert(lines[1] === '' && lines[2] === 'Northville Pickleball Club' && lines[3] === 'Directions:', `lines: ${JSON.stringify(lines.slice(0, 5))}`);
      assert(lines[4] === 'https://maps.apple.com/?daddr=40100+Six+Mile+Rd,+Northville,+MI+48168,+United+States', `directions: ${lines[4]}`);
      const href = await page.locator('[data-gdt-open]').getAttribute('href');
      const m = /^sms:([^&?]*)&body=(.*)$/.exec(href);
      assert(m, `iPhone format sms:+1N,+1N&body= : ${href.slice(0, 80)}`);
      const numbers = m[1].split(',');
      assert(numbers.length >= 1 && numbers.every((n) => /^\+1313555\d{4}$/.test(n)), `numbers: ${numbers}`);
      assert(!numbers.includes('+13135550100'), 'Alex, the organizer, is never in it');
      assert(!numbers.includes('+13135550107') && new Set(numbers).size === numbers.length, 'Reese has no number; no repeats');
      assert(decodeURIComponent(m[2]) === body, 'the link carries exactly the words on screen');
      assert(!/\n/.test(href) && m[2].includes('%0A'), 'real line breaks are %0A');
      const screen = await page.locator('main').innerText();
      assert(!/\+1313|555-0|\(313\)/.test(screen), 'no phone number is shown on screen');
      assert(/Only the players in this game/.test(screen), 'the calm line');
      const problems = await page.evaluate(findClipping, { root: 'main' });
      assert(problems.length === 0, `clipped: ${problems.join(' | ')}`);
      await shot(page, `gdt_${scheme}_390.png`);
      assert(page.errors.length === 0, `page errors: ${page.errors}`);
      await ctx.close();
    });
  }
  for (const width of [360, 320]) {
    await check(`E ${width}: the page is not clipped, light and dark`, async () => {
      for (const scheme of ['light', 'dark']) {
        const { ctx, page } = await gdt({ width, scheme });
        const problems = await page.evaluate(findClipping, { root: 'main' });
        assert(problems.length === 0, `clipped at ${width} ${scheme}: ${problems.join(' | ')}`);
        assert(!(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)), 'sideways scroll');
        await ctx.close();
      }
    });
  }
  await check('E a bad link says so calmly and the page holds no number; Android gets ?body=', async () => {
    const { ctx, page } = await phone();
    await page.goto(`${BASE}/gt/abc.def`);
    await page.locator('main .notice, main [role="alert"], main .warn').first().waitFor({ timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(500);
    const html = await page.content();
    assert(/This link does not work/.test(html), 'says it does not work');
    assert(!/\+1313|555-0|data-gdt-open/.test(html), 'no number, no Messages button');
    await ctx.close();
    const android = await phone({ ua: ANDROID });
    await android.page.goto(`${BASE}/gt/preview`);
    await android.page.locator('[data-gdt-open]').waitFor({ timeout: 20000 });
    const href = await android.page.locator('[data-gdt-open]').getAttribute('href');
    assert(/^sms:[^&?]+\?body=/.test(href), `Android format: ${href.slice(0, 60)}`);
    await android.ctx.close();
  });

  await browser.close();
  console.log(`\nzip37: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
