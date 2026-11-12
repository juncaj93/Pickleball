/* Zip 30: phone tag and "Acting for others" (ACTING_FOR_OTHERS), the card at the top of admin Home (mocks acting_for_others_light.png / _dark.png).
 *
 *   node e2e/zip30.cjs      (also run by npm run test:e2e)
 *
 * Fake world (the older big one, Mon Nov 9 at 10 AM Eastern), its own dev server; nothing touches Cloudflare or the live site.
 *   - the switch: ships OFF (no card, no key); the Settings row at the top turns it on for everyone; the private link for one phone;
 *   - the phone code: made once in the browser, kept in storage AND a cookie (each restores the other), sent on player requests only;
 *   - the flow: one phone acts as Casey 3 times, then as Harper: the card says "Casey signed up for Harper", History says "(from Casey's phone)";
 *   - the card: very top of Home, up to 3 rows then "+N more in History" (opens History), the X hides it (History keeps the lines), a newer tap
 *     brings it back; the organizer's own phone and View as never show up;
 *   - the look against the mock (gray circle icon, bold title, X, rows with lines between, time on the right), light and dark;
 *   - strict clipping at 390, 360 and 320 wide, light and dark, text 100, 125 and 150%, with the longest names.
 */
const { spawn, spawnSync } = require('node:child_process');
const { readFileSync, mkdirSync, rmSync } = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.E2E_PORT) || 5430;
const BASE = `http://localhost:${PORT}`;
const NOW_ISO = '2026-11-09T15:00:00.000Z'; // Mon Nov 9, 10:00 AM Eastern
const NOW_MS = Date.parse(NOW_ISO);
const SHOTS = process.env.E2E_SHOTS || path.join(__dirname, 'screenshots');
const PIN = /PIN `(\d{6})`/.exec(readFileSync(path.join(ROOT, 'docs/PREVIEW_FAKE_DB.md'), 'utf8'))[1];

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
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

async function main() {
  mkdirSync(SHOTS, { recursive: true });
  const dbFile = path.join(ROOT, '.data', 'zip30.sqlite');
  mkdirSync(path.join(ROOT, '.data'), { recursive: true });
  rmSync(dbFile, { force: true });
  const seeded = spawnSync('npx', ['vite-node', 'scripts/load-seed-local.ts', '--', dbFile, NOW_ISO], { cwd: ROOT, encoding: 'utf8' });
  if (seeded.status !== 0) throw new Error(`could not build the fake world: ${seeded.stderr || seeded.stdout}`);
  if (await fetch(`${BASE}/api/status`).then((r) => r.ok, () => false)) throw new Error(`port ${PORT} is already in use`);
  const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
    cwd: ROOT,
    env: { ...process.env, DEV_DB: dbFile, SETUP_TOKEN: 'zip30-setup-token-0123456789', DEV_CLOCK: '1' },
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
  await fetch(`${BASE}/__dev/clock`, { method: 'POST', body: JSON.stringify({ atMs: NOW_MS }) });
  const browser = await chromium.launch();
  const post = (req, url, data, headers = {}) => req.post(BASE + url, { data, headers: { Origin: BASE, ...headers } });
  const put = (req, url, data) => req.put(BASE + url, { data, headers: { Origin: BASE } });
  const org = (await browser.newContext()).request;
  if (!(await post(org, '/api/admin/login', { pin: PIN })).ok()) throw new Error('login failed');
  const dash = async (headers = {}) => (await org.get(`${BASE}/api/admin/dashboard`, { headers })).json();
  const d0 = await dash();
  const idOf = (name) => d0.players.find((p) => p.name === name).id;

  async function shift(ctx) {
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
      try {
        localStorage.setItem('pb_games_filter', 'all');
      } catch {}
    }, NOW_MS - Date.now());
  }
  const phoneOpts = (width = 390, scheme = 'light') => ({ viewport: { width, height: 844 }, deviceScaleFactor: 1, colorScheme: scheme, isMobile: true, hasTouch: true, userAgent: UA, reducedMotion: 'reduce' });
  /** A player's phone with `name` picked. Its requests are recorded. */
  async function openPlayer(name, width = 390, scheme = 'light', ctx = null) {
    ctx = ctx ?? (await browser.newContext(phoneOpts(width, scheme)));
    await shift(ctx);
    await post(ctx.request, '/api/me', { playerId: idOf(name) });
    const page = await ctx.newPage();
    const sent = [];
    page.on('request', (r) => {
      const u = new URL(r.url());
      if (u.pathname.startsWith('/api/')) sent.push({ path: u.pathname, method: r.method(), tag: r.headers()['x-phone-tag'] ?? null });
    });
    await page.goto(BASE + '/');
    await page.locator('.schedule article').first().waitFor();
    await page.waitForTimeout(500);
    return { ctx, page, sent };
  }
  const storedTag = (page) => page.evaluate(() => localStorage.getItem('pb_phone_tag'));
  const cookieTag = async (ctx) => (await ctx.cookies(BASE)).find((c) => c.name === 'pb_phone')?.value ?? null;
  const groupOf = async (req) => (await req.get(`${BASE}/api/group`)).json();
  const openGames = (g) => g.sessions.filter((s) => !s.canceled && !s.started && !s.mine && s.joinAs !== 'waitlist' && Date.parse(s.startsAt) > NOW_MS + 13 * 3600_000);
  /** A tap through the real page: I'm in on a game's card. */
  async function tapJoin(page, id) {
    await page.locator(`#row-${id} [data-join]`).first().click();
    await page.waitForTimeout(900);
  }
  async function openAdmin(opts = {}) {
    const width = opts.width ?? 390;
    const ctx = await browser.newContext({ ...phoneOpts(width, opts.scheme ?? 'light'), viewport: { width, height: opts.height ?? 900 } });
    await shift(ctx);
    if (opts.route) await ctx.route('**/api/admin/dashboard', opts.route);
    if (!(await post(ctx.request, '/api/admin/login', { pin: PIN })).ok()) throw new Error('login');
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(BASE + (opts.url ?? '/admin'));
    await page.locator('.tabbar').waitFor();
    if (opts.pct && opts.pct !== 100) await page.addStyleTag({ content: `html { font-size: ${opts.pct}% !important; } body { font-size: ${(17 * opts.pct) / 100}px !important; }` });
    // Test the test: E2E_BREAK='.afo-time{margin-right:-30px}' (any CSS) must make the clipping checks fail.
    if (process.env.E2E_BREAK) await page.addStyleTag({ content: process.env.E2E_BREAK });
    await page.waitForTimeout(400);
    return { ctx, page, errors };
  }
  const cardOf = (page) =>
    page.evaluate(() => {
      const c = document.querySelector('[data-acting-others]');
      if (!c) return null;
      return {
        title: c.querySelector('.afo-title')?.textContent.trim(),
        rows: [...c.querySelectorAll('[data-afo-row]')].map((r) => ({ text: r.querySelector('.afo-text').textContent.replace(/\s+/g, ' ').trim(), time: r.querySelector('.afo-time').textContent.trim() })),
        more: c.querySelector('[data-afo-more]')?.textContent.trim() ?? null,
        first: document.querySelector('main.admin-page')?.firstElementChild === c,
      };
    });

  // ---------------------------------------------------------------- the switch, OFF as it ships
  await check('OFF (as it ships): no Acting for others key in the dashboard, no card on Home', async () => {
    assert(d0.actingOthers === undefined && d0.actingOthersForAll === undefined, 'the seed should have the row OFF');
    const { ctx, page } = await openAdmin();
    assert((await cardOf(page)) === null, 'a card shows with the switch off');
    await ctx.close();
  });

  // ---------------------------------------------------------------- the phone code
  let A; // Casey's phone, used through the whole flow
  await check('a phone gets ONE random code: kept in storage and a cookie, the same after a reload, sent on player requests and never on organizer ones', async () => {
    A = await openPlayer('Casey');
    const tag = await storedTag(A.page);
    assert(/^[A-Za-z0-9_-]{22}$/.test(tag ?? ''), `stored code «${tag}»`);
    assert((await cookieTag(A.ctx)) === tag, 'the cookie copy differs');
    await A.page.reload();
    await A.page.locator('.schedule article').first().waitFor();
    assert((await storedTag(A.page)) === tag, 'a reload made a new code');
    const player = A.sent.filter((s) => !s.path.startsWith('/api/admin/'));
    assert(player.length > 0 && player.every((s) => s.tag === tag), `every player request carries it: ${JSON.stringify(player.slice(0, 4))}`);
    const other = await openPlayer('Drew');
    assert((await storedTag(other.page)) !== tag, 'two phones got the same code');
    await other.ctx.close();
  });

  await check('clearing the storage keeps the code (the cookie puts it back); clearing both makes a new one (a new phone)', async () => {
    const B = await openPlayer('Emery');
    const tag = await storedTag(B.page);
    await B.page.evaluate(() => localStorage.removeItem('pb_phone_tag'));
    await B.page.reload();
    await B.page.locator('.schedule article').first().waitFor();
    assert((await storedTag(B.page)) === tag, 'the cookie did not put the code back');
    await B.ctx.clearCookies({ name: 'pb_phone' });
    await B.page.reload();
    await B.page.locator('.schedule article').first().waitFor();
    assert((await cookieTag(B.ctx)) === tag, 'the storage did not put the cookie back');
    await B.ctx.clearCookies();
    await B.page.evaluate(() => localStorage.clear());
    await post(B.ctx.request, '/api/me', { playerId: idOf('Emery') });
    await B.page.reload();
    await B.page.locator('.schedule article').first().waitFor();
    const fresh = await storedTag(B.page);
    assert(fresh && fresh !== tag, 'clearing both should make a new code');
    await B.ctx.close();
  });

  // ---------------------------------------------------------------- the Settings row
  await check('Settings > Feature switches: "Acting for others" is the top row; tapping it turns the switch on for everyone (no deploy)', async () => {
    const { ctx, page } = await openAdmin();
    await page.locator('.tabbar button', { hasText: 'Settings' }).click();
    await page.waitForTimeout(400);
    for (const s of await page.locator('details > summary').all()) await s.click().catch(() => {});
    const first = await page.locator('#switches [data-row], [data-switches-tidy] [data-row]').evaluateAll((els) => els.map((e) => e.getAttribute('data-row')).filter((k) => k !== 'homeScreenTipAll' && k !== 'gameDayTextAll').slice(0, 4));
    // (Zip 37's Home Screen tip and Game day text rows sit above all of these; the check skips them.)
    // (Zip 32's Players sheet redo row and Zip 34's Check-in pay line row and Zip 31's Extended time row are newer and sit on top of it.)
    assert(first[0] === 'extendedTimeAll' && first[1] === 'checkInPayAll' && first[2] === 'playersSheetRedoAll' && first[3] === 'actingOthersAll', `newest first: ${first}`);
    const row = page.locator('[data-row="actingOthersAll"]');
    assert(/Acting for others/.test(await row.innerText()), 'row label');
    await row.locator('label').click();
    await page.waitForTimeout(900);
    assert((await dash()).actingOthersForAll === true, 'on for everyone after the tap');
    await ctx.close();
  });

  // ---------------------------------------------------------------- the flow
  let games = [];
  await check('Casey x3 from one phone, then "Not you?" Harper and I\'m in: the card says "Casey signed up for Harper"; Casey\'s own taps are not on it', async () => {
    games = openGames(await groupOf(A.ctx.request));
    assert(games.length >= 5, `need 5 open games, found ${games.length}`);
    // Tap 1 through the real page, taps 2 and 3 from the same phone (its cookie carries the code).
    await tapJoin(A.page, games[0].id);
    assert((await groupOf(A.ctx.request)).sessions.find((s) => s.id === games[0].id).mine, 'tap 1 did not sign Casey up');
    assert((await post(A.ctx.request, `/api/sessions/${games[1].id}/join`, {})).ok(), 'tap 2');
    assert((await post(A.ctx.request, `/api/sessions/${games[1].id}/withdraw`, {})).ok(), 'tap 3');
    assert((await dash()).actingOthers.length === 0, 'Casey acting as Casey should not be on the card');
    // "Not you?" > Harper, then I'm in on the page.
    await post(A.ctx.request, '/api/me', { playerId: idOf('Harper') });
    await A.page.reload();
    await A.page.locator('.schedule article').first().waitFor();
    await tapJoin(A.page, games[2].id);
    const d = await dash();
    assert(d.actingOthers.length === 1, `rows: ${JSON.stringify(d.actingOthers)}`);
    const r = d.actingOthers[0];
    assert(r.by === 'Casey' && r.verb === 'signed up' && r.name === 'Harper', JSON.stringify(r));
  });

  await check('admin Home: the card is the very first thing, "Acting for others", one row "Casey signed up for Harper" with the time on the right', async () => {
    const { ctx, page, errors } = await openAdmin();
    const c = await cardOf(page);
    assert(c && c.first, `card missing or not first: ${JSON.stringify(c)}`);
    assert(c.title === 'Acting for others', c.title);
    assert(c.rows.length === 1 && c.rows[0].text === 'Casey signed up for Harper', JSON.stringify(c.rows));
    assert(/^\d{1,2}:\d\d [AP]M$/.test(c.rows[0].time), `time «${c.rows[0].time}»`);
    assert(c.more === null, 'no "+N more" with one row');
    assert(errors.length === 0, errors.join(' | '));
    await page.screenshot({ path: path.join(SHOTS, 'zip30-card-light.png') });
    await ctx.close();
    const dark = await openAdmin({ scheme: 'dark' });
    await dark.page.screenshot({ path: path.join(SHOTS, 'zip30-card-dark.png') });
    await dark.ctx.close();
  });

  await check('History: "Harper said I\'m in for ... (from Casey\'s phone)"; Casey\'s own lines have no note', async () => {
    const { ctx, page } = await openAdmin();
    await page.locator('.tabbar button', { hasText: 'History' }).click();
    await page.waitForTimeout(700);
    const seg = page.locator('button', { hasText: /^Activity$/ });
    if (await seg.count()) await seg.first().click();
    await page.waitForTimeout(700);
    const lines = await page.locator('.a-text').allInnerTexts();
    const harper = lines.filter((l) => /^Harper said I'm in/.test(l));
    assert(harper.length === 1 && / \(from Casey's phone\)$/.test(harper[0]), `Harper's line: ${JSON.stringify(harper)}`);
    assert(lines.filter((l) => /^Casey /.test(l)).every((l) => !/from .* phone/.test(l)), 'a Casey line has a note');
    await ctx.close();
  });

  await check('more than 3: the card shows 3 rows and "+2 more in History"; tapping it opens History', async () => {
    // Casey taps 4 more times as Casey, so the phone stays clearly Casey's (7 of its taps) while Harper's taps add up (the rule: more than half).
    await post(A.ctx.request, '/api/me', { playerId: idOf('Casey') });
    for (const step of ['join', 'withdraw', 'join', 'withdraw']) assert((await post(A.ctx.request, `/api/sessions/${games[1].id}/${step}`, {})).ok(), `Casey ${step}`);
    await post(A.ctx.request, '/api/me', { playerId: idOf('Harper') });
    for (const g of [games[3], games[4]]) assert((await post(A.ctx.request, `/api/sessions/${g.id}/join`, {})).ok(), 'Harper I\'m in');
    assert((await post(A.ctx.request, `/api/sessions/${games[4].id}/withdraw`, {})).ok(), 'Harper drop');
    assert((await post(A.ctx.request, `/api/sessions/${games[3].id}/withdraw`, {})).ok(), 'Harper drop');
    const { ctx, page } = await openAdmin();
    const c = await cardOf(page);
    assert(c.rows.length === 3, `rows ${c.rows.length}`);
    assert(c.rows[0].text === 'Casey backed out for Harper', c.rows[0].text);
    assert(c.more === '+2 more in History', `more «${c.more}»`);
    await page.locator('[data-afo-more]').click();
    await page.waitForTimeout(600);
    const active = await page.locator('.tabbar [aria-current="page"], .tabbar .active, .tabbar [aria-selected="true"]').first().innerText().catch(() => '');
    assert(/History/.test(active) || (await page.locator('.a-text').count()) > 0, `History did not open (${active})`);
    await ctx.close();
  });

  await check('the X hides the card on this phone (History keeps every line); a reload keeps it hidden; a newer tap brings it back with only the new row', async () => {
    const { ctx, page } = await openAdmin();
    await page.locator('[data-afo-x]').click();
    await page.waitForTimeout(300);
    assert((await cardOf(page)) === null, 'still there after the X');
    await page.reload();
    await page.locator('.tabbar').waitFor();
    await page.waitForTimeout(500);
    assert((await cardOf(page)) === null, 'back after a reload');
    assert((await dash()).actingOthers.length === 5, 'the server still has all five (History keeps them)');
    await fetch(`${BASE}/__dev/clock`, { method: 'POST', body: JSON.stringify({ atMs: NOW_MS + 5 * 60_000 }) });
    assert((await post(A.ctx.request, `/api/sessions/${games[3].id}/join`, {})).ok(), 'a new tap');
    await page.reload();
    await page.locator('.tabbar').waitFor();
    await page.waitForTimeout(500);
    const c = await cardOf(page);
    assert(c && c.rows.length === 1 && c.rows[0].text === 'Casey signed up for Harper' && c.more === null, `after the new tap: ${JSON.stringify(c)}`);
    await ctx.close();
  });

  await check("the organizer's own phone (signed in) acting on the player screen never shows up, code or not", async () => {
    const before = (await dash()).actingOthers.length;
    const ctx = await browser.newContext(phoneOpts());
    await shift(ctx);
    await post(ctx.request, '/api/admin/login', { pin: PIN });
    const P = await openPlayer('Lane', 390, 'light', ctx);
    const g = openGames(await groupOf(P.ctx.request))[0];
    for (const n of ['Lane', 'Lane', 'Lane', 'Morgan']) {
      await post(P.ctx.request, '/api/me', { playerId: idOf(n) });
      await post(P.ctx.request, `/api/sessions/${g.id}/join`, {}, { 'X-Phone-Tag': await storedTag(P.page) });
      await post(P.ctx.request, `/api/sessions/${g.id}/withdraw`, {});
    }
    assert((await dash()).actingOthers.length === before, 'the organizer phone was flagged');
    await ctx.close();
  });

  await check('View as: taps in the demo copy never reach the real site, so nothing new shows up', async () => {
    const before = (await dash()).actingOthers.length;
    const { ctx, page } = await openAdmin();
    await page.locator('.topbar-btn', { hasText: 'View as' }).first().click();
    await page.locator('dialog.sheet[open] .name-grid button', { hasText: 'Gray' }).click();
    await page.locator('.schedule article').first().waitFor({ timeout: 15000 });
    const btn = page.locator('[data-join]').first();
    if (await btn.count()) await btn.click().catch(() => {});
    await page.waitForTimeout(900);
    assert((await dash()).actingOthers.length === before, 'View as added a row');
    await ctx.close();
  });

  // ---------------------------------------------------------------- Alex's preview case (Wed Nov 11), every tap through the real screen
  await check("Alex's exact taps on one phone: I'm in, Drop out, I'm in (Drop out's Undo swallows the drop), then Not you? > Drew > I'm in: History says \"(from Blake's phone)\" and the card says \"Blake signed up for Drew\"", async () => {
    const P = await openPlayer('Blake');
    const gs = openGames(await groupOf(P.ctx.request));
    const g1 = gs[0];
    const g2 = gs.find((x) => x.id !== g1.id && !x.confirmed?.some?.((c) => c.name === 'Drew'));
    // I'm in, Drop out (confirm), I'm in again inside the 5-second Undo.
    await P.page.locator(`#row-${g1.id} [data-join]`).first().click();
    await P.page.waitForTimeout(1200);
    await P.page.locator(`#row-${g1.id} .drop-link`).first().click();
    await P.page.locator('dialog[open] button', { hasText: /^Drop out$/ }).first().click();
    await P.page.waitForTimeout(800);
    const again = P.page.locator(`#row-${g1.id} [data-join]`).first();
    if (await again.count()) await again.click();
    else await P.page.locator('.toast-action', { hasText: 'Undo' }).first().click();
    await P.page.waitForTimeout(6500);
    // Not you? > Drew, through the screen.
    await P.page.locator('button.not-you').click();
    await P.page.getByRole('button', { name: 'Drew', exact: true }).first().click();
    await P.page.locator('.schedule article').first().waitFor();
    await P.page.waitForTimeout(800);
    await P.page.locator(`#row-${g2.id} [data-join]`).first().click();
    await P.page.waitForTimeout(1500);
    const tag = await storedTag(P.page);
    assert(P.sent.filter((x) => x.method === 'POST' && x.path.startsWith('/api/sessions/')).every((x) => x.tag === tag), `a tap went without the code: ${JSON.stringify(P.sent.filter((x) => x.method === 'POST'))}`);
    const rows = (await dash()).actingOthers.map((r) => `${r.by ?? 'A new phone'} ${r.verb} for ${r.name}`);
    assert(rows.includes('Blake signed up for Drew'), `card rows: ${JSON.stringify(rows)}`);
    const hist = (await (await org.get(`${BASE}/api/admin/activity`)).json()).entries;
    const drew = hist.find((e) => e.actorLabel === 'Drew' && e.action === 'player_join');
    assert(drew?.from === "from Blake's phone", `Drew's line: ${JSON.stringify(drew)}`);
    // And on the admin screen itself.
    const A2 = await openAdmin();
    const c = await cardOf(A2.page);
    assert(c && c.rows.some((r) => r.text === 'Blake signed up for Drew'), `Home card: ${JSON.stringify(c)}`);
    await A2.ctx.close();
    await P.ctx.close();
  });

  await check('a browser that blocks storage (private window settings): the cookie alone keeps one code, and every tap carries it', async () => {
    const ctx = await browser.newContext(phoneOpts());
    await ctx.addInitScript(() => {
      Object.defineProperty(window, 'localStorage', { get() { throw new Error('storage blocked'); } });
    });
    const P = await openPlayer('Finley', 390, 'light', ctx);
    const first = await cookieTag(P.ctx);
    assert(/^[A-Za-z0-9_-]{22}$/.test(first ?? ''), `cookie code «${first}»`);
    await P.page.reload();
    await P.page.locator('.schedule article').first().waitFor();
    assert((await cookieTag(P.ctx)) === first, 'a reload made a new code');
    const g = openGames(await groupOf(P.ctx.request))[0];
    await P.page.locator(`#row-${g.id} [data-join]`).first().click();
    await P.page.waitForTimeout(1200);
    const joins = P.sent.filter((x) => x.method === 'POST' && x.path.endsWith('/join'));
    assert(joins.length === 1 && joins[0].tag === first, `the tap's code: ${JSON.stringify(joins)}`);
    await ctx.close();
  });

  // ---------------------------------------------------------------- the look
  await check('the look (mock): gray 32 px circle with the swap arrows, bold title, an X with a 44 px tap area, thin lines between rows, light and dark', async () => {
    for (const scheme of ['light', 'dark']) {
      const { ctx, page } = await openAdmin({ scheme });
      // Two rows so there is a line between them.
      await page.evaluate(() => localStorage.removeItem('pb_acting_dismissed'));
      await page.reload();
      await page.locator('[data-acting-others]').waitFor();
      const m = await page.evaluate(() => {
        const c = document.querySelector('[data-acting-others]');
        const icon = c.querySelector('.afo-icon').getBoundingClientRect();
        const iconBg = getComputedStyle(c.querySelector('.afo-icon')).backgroundColor;
        const x = c.querySelector('.afo-x');
        const xr = x.getBoundingClientRect();
        const after = getComputedStyle(x, '::after');
        const rows = [...c.querySelectorAll('.afo-row')];
        return {
          icon: [Math.round(icon.width), Math.round(icon.height)],
          iconBg,
          titleW: Number(getComputedStyle(c.querySelector('.afo-title')).fontWeight),
          tapW: xr.width - 2 * parseFloat(after.left || '0'),
          tapH: xr.height - 2 * parseFloat(after.top || '0'),
          lines: rows.slice(1).map((r) => getComputedStyle(r).borderTopWidth),
          bg: getComputedStyle(c).backgroundColor,
          radius: getComputedStyle(c).borderTopLeftRadius,
          bold: getComputedStyle(c.querySelector('.afo-text strong')).fontWeight,
          verb: getComputedStyle(c.querySelector('.afo-verb')).color,
          name: getComputedStyle(c.querySelector('.afo-text')).color,
        };
      });
      const lum = (rgb) => {
        const [r, g, b] = rgb.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number);
        return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      };
      assert(m.icon[0] === 32 && m.icon[1] === 32, `icon ${m.icon}`);
      const [r, g, b] = m.iconBg.match(/\d+/g).map(Number);
      assert(Math.max(r, g, b) - Math.min(r, g, b) < 16, `icon circle is not a neutral gray: ${m.iconBg}`);
      assert(m.titleW >= 700 && Number(m.bold) >= 700, `title ${m.titleW}, names ${m.bold}`);
      assert(m.tapW >= 44 && m.tapH >= 44, `X tap area ${m.tapW} x ${m.tapH}`);
      assert(m.lines.length > 0 && m.lines.every((w) => w === '1px'), `row lines ${m.lines}`);
      assert(m.radius === '18px', `corners ${m.radius}`);
      assert(m.verb !== m.name, 'the verb should be muted next to the names');
      if (scheme === 'dark') assert(lum(m.bg) < 0.2, `dark card ${m.bg}`);
      else assert(lum(m.bg) > 0.9, `light card ${m.bg}`);
      await page.screenshot({ path: path.join(SHOTS, `zip30-card-3rows-${scheme}.png`), clip: { x: 0, y: 0, width: 390, height: 420 } });
      await ctx.close();
    }
  });

  // ---------------------------------------------------------------- strict clipping (Zip 18 rule)
  /** Text at least 2 px inside the inside edge of the card, nothing overlapping, the time and the title on one line, nothing sideways. */
  const strict = () => {
    const problems = [];
    const root = document.querySelector('[data-acting-others]');
    if (!root) return ['no card'];
    const cs = getComputedStyle(root);
    const bb = root.getBoundingClientRect();
    const inner = { l: bb.left + parseFloat(cs.borderLeftWidth), r: bb.right - parseFloat(cs.borderRightWidth), t: bb.top + parseFloat(cs.borderTopWidth), b: bb.bottom - parseFloat(cs.borderBottomWidth) };
    const textEls = [...root.querySelectorAll('*')].filter((el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()));
    const items = [];
    for (const el of textEls) {
      const rects = [];
      for (const n of el.childNodes) {
        if (n.nodeType !== 3 || !n.textContent.trim()) continue;
        const range = document.createRange();
        range.selectNodeContents(n);
        for (const r of range.getClientRects()) if (r.width > 0 && r.height > 0) rects.push(r);
      }
      const name = `${el.className || el.tagName}:"${el.textContent.trim().slice(0, 18)}"`;
      for (const r of rects) if (r.left < inner.l + 2 || r.right > inner.r - 2 || r.top < inner.t + 2 || r.bottom > inner.b - 2) problems.push(`${name} outside the card (${Math.round(r.left)}-${Math.round(r.right)} vs ${Math.round(inner.l)}-${Math.round(inner.r)})`);
      if (el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).display !== 'inline') problems.push(`${name} wider than itself`);
      items.push({ el, name, rects });
    }
    const boxes = [...root.querySelectorAll('.afo-icon, .afo-x svg')].map((e) => ({ el: e, name: e.className.baseVal ?? e.className, rects: [e.getBoundingClientRect()] }));
    for (const b of boxes) for (const r of b.rects) if (r.left < inner.l + 2 || r.right > inner.r - 2) problems.push(`${b.name} outside the card`);
    const all = [...items, ...boxes];
    for (let i = 0; i < all.length; i++)
      for (let j = i + 1; j < all.length; j++) {
        const a = all[i];
        const b = all[j];
        if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
        for (const x of a.rects)
          for (const y of b.rects) {
            const ox = Math.min(x.right, y.right) - Math.max(x.left, y.left);
            const oy = Math.min(x.bottom, y.bottom) - Math.max(x.top, y.top);
            if (ox > 0.5 && oy > 0.5) problems.push(`${a.name} overlaps ${b.name}`);
          }
      }
    for (const t of root.querySelectorAll('.afo-time')) {
      const range = document.createRange();
      range.selectNodeContents(t);
      if (new Set([...range.getClientRects()].map((r) => Math.round(r.top))).size > 1) problems.push(`time "${t.textContent}" wraps`);
    }
    if (document.documentElement.scrollWidth > window.innerWidth) problems.push('the page scrolls sideways');
    return problems;
  };
  // The longest real names and words, and an older day's time ("Mon 10:45 PM").
  const LONG = [
    { id: 'x1', at: '2026-11-09T14:58:00.000Z', by: 'Christopher Vanderberg', verb: 'took back a refund request', name: 'Christopher Vanderberg' },
    { id: 'x2', at: '2026-11-09T03:45:00.000Z', by: null, verb: 'used cash-out credit', name: 'Christopher Vanderberg' },
    { id: 'x3', at: '2026-11-08T02:05:00.000Z', by: 'Organizer Orla', verb: 'unmarked paid', name: 'Morgan' },
    { id: 'x4', at: '2026-11-07T02:05:00.000Z', by: 'Avery', verb: 'signed up', name: 'Blake' },
  ];
  const longRoute = async (route) => {
    const resp = await route.fetch();
    const json = await resp.json();
    json.actingOthers = LONG;
    await route.fulfill({ response: resp, json });
  };
  for (const scheme of ['light', 'dark'])
    for (const width of [390, 360, 320])
      for (const pct of [100, 125, 150])
        await check(`clipping: ${width} wide, ${scheme}, text ${pct}%: the card with the longest names, nothing clips, overlaps or goes sideways; the times stay on one line`, async () => {
          const { ctx, page } = await openAdmin({ width, scheme, pct, route: longRoute, height: 760 });
          await page.evaluate(() => localStorage.removeItem('pb_acting_dismissed'));
          await page.reload();
          await page.locator('[data-acting-others]').waitFor();
          if (pct !== 100) await page.addStyleTag({ content: `html { font-size: ${pct}% !important; } body { font-size: ${(17 * pct) / 100}px !important; }` });
          if (process.env.E2E_BREAK) await page.addStyleTag({ content: process.env.E2E_BREAK });
          await page.waitForTimeout(200);
          const p = await page.evaluate(`(${strict.toString()})()`);
          const c = await cardOf(page);
          assert(c.rows.length === 3 && c.more === '+1 more in History', JSON.stringify(c));
          assert(c.rows[1].text === 'A new phone used cash-out credit for Christopher Vanderberg', c.rows[1].text);
          assert(/^(Sun|Sat) /.test(c.rows[1].time) || /^Mon /.test(c.rows[1].time) || /^\w{3} \d/.test(c.rows[1].time), `older day time «${c.rows[1].time}»`);
          if (width === 320 && pct === 150) await page.screenshot({ path: path.join(SHOTS, `zip30-clip-320-150-${scheme}.png`), clip: { x: 0, y: 0, width: 320, height: 560 } });
          assert(p.length === 0, p.slice(0, 5).join(' | '));
          await ctx.close();
        });

  await A?.ctx.close();
  await browser.close();
  console.log(`\nzip30: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
