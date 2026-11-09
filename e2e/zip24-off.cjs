/* Zip 24: the Booking hours switch OFF must be exactly today's site. This runs today's main (a git worktree, path in MAIN_DIR) and this
 * branch side by side on two copies of the same fake world, with the Booking hours row OFF and every other row as on live, and compares the
 * rendered HTML:
 *  - the screens this zip changes: Add game, Edit game (a regular game, and one with players in), Settings > Schedule > Usual game time, at 390, 360
 *    and 320 wide, light and dark;
 *  - organizer Settings apart from the one new switch row, organizer Home light and dark, Players, Money and History;
 *  - the answers: the dashboard has no Zip 24 key, and Add game / a moved game / the usual time accept an out-of-hours time exactly as main does.
 *  And ONE more thing: the new screens ON in this branch touch no other screen (organizer Home is still identical with the switch on).
 *
 *   MAIN_DIR=/path/to/main-worktree node e2e/zip24-off.cjs
 *
 * Not part of npm run test:e2e (it needs the second checkout). Nothing here touches Cloudflare or the live site.
 */
const { spawn, spawnSync } = require('node:child_process');
const { readFileSync, mkdirSync, rmSync, copyFileSync } = require('node:fs');
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const MAIN = process.env.MAIN_DIR;
if (!MAIN) throw new Error('set MAIN_DIR to a checkout of main');
const SEED_ISO = '2026-11-09T15:00:00.000Z'; // Mon Nov 9, 10:00 AM Eastern (the seed, and now)
const NOW_MS = Date.parse(SEED_ISO);
const PIN = /PIN `(\d{6})`/.exec(readFileSync(path.join(ROOT, 'docs/PREVIEW_FAKE_DB.md'), 'utf8'))[1];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
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
function diffAt(a, b) {
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  return `at ${i}/${a.length}: main «${a.slice(Math.max(0, i - 100), i + 160)}» branch «${b.slice(Math.max(0, i - 100), i + 160)}»`;
}

async function site(dir, port, dbFile) {
  // As on live: no PREVIEW_CALM, every wrangler.toml switch at its default ("on" = allowed), the Settings rows decide.
  const server = spawn('npx', ['vite', '--port', String(port), '--strictPort'], {
    cwd: dir,
    env: { ...process.env, DEV_DB: dbFile, SETUP_TOKEN: 'zip24-off-setup-token-0123456789', DEV_CLOCK: '1' },
    stdio: 'ignore',
    detached: true,
  });
  process.on('exit', () => {
    try {
      process.kill(-server.pid, 'SIGTERM');
    } catch {}
  });
  const base = `http://localhost:${port}`;
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(`${base}/api/status`)).ok) break;
    } catch {}
    await sleep(500);
  }
  await fetch(`${base}/__dev/clock`, { method: 'POST', body: JSON.stringify({ atMs: NOW_MS }) });
  return base;
}

async function main() {
  mkdirSync(path.join(ROOT, '.data'), { recursive: true });
  const a = path.join(ROOT, '.data', 'zip24-off-main.sqlite');
  const b = path.join(ROOT, '.data', 'zip24-off-branch.sqlite');
  rmSync(a, { force: true });
  const seeded = spawnSync('npx', ['vite-node', 'scripts/load-seed-local.ts', '--', a, SEED_ISO], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, SEED_ZIP13: '1', SEED_ZIP14: '1', SEED_ZIP15: '1', SEED_ZIP17: '1' } });
  if (seeded.status !== 0) throw new Error(`seed: ${seeded.stderr || seeded.stdout}`);
  const db = new DatabaseSync(a);
  // The row this zip adds is OFF, as it ships. As on live: every other Settings row is on, including the six the older local world leaves off.
  db.exec("DELETE FROM task_log WHERE session_id IS NULL AND task = 'booking_hours_on'");
  for (const t of ['alert_cards_on', 'seat_dots_on', 'speed_fewer_queries_on', 'speed_direct_load_on', 'speed_last_screen_on', 'speed_last_screen_admin_on'])
    db.exec(`INSERT INTO task_log (id, group_id, session_id, task, kind, at) SELECT 'live-${t}', id, NULL, '${t}', 'mark', '${SEED_ISO}' FROM groups WHERE NOT EXISTS (SELECT 1 FROM task_log WHERE task = '${t}' AND session_id IS NULL)`);
  db.close();
  copyFileSync(a, b);
  const [A, B] = await Promise.all([site(MAIN, 5397, a), site(ROOT, 5398, b)]);
  const browser = await chromium.launch();
  const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
  const norm = (h) =>
    h
      .replace(/«r[0-9a-z]+»/g, '«id»')
      .replace(/(:r[0-9a-z]+:)/g, ':id:')
      .replace(/\/assets\/[^"']+/g, '/assets/x')
      .replace(/ dots-celebrate/g, '')
      .replace(/(datetime="[^"]+?)\.\d{3}Z"/g, '$1Z"')
      .replace(/(datetime="\d{4}-\d\d-\d\dT\d\d:\d\d):\d\dZ"/g, '$1Z"')
      .replace(/localhost(:|%3A)539[78]/g, 'localhost$1PORT')
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '<id>');
  async function screen(base, { url = '/admin', scheme = 'light', tabName, act, width = 390, pretendOn = false }) {
    const ctx = await browser.newContext({ viewport: { width, height: 860 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, colorScheme: scheme, userAgent: UA, reducedMotion: 'reduce' });
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
    await ctx.route('https://venmo.com/**', (r) => r.abort());
    const req = ctx.request;
    await req.post(base + '/api/admin/login', { data: { pin: PIN }, headers: { Origin: base } });
    const page = await ctx.newPage();
    await page.goto(base + url);
    await page.waitForLoadState('networkidle');
    await page.locator('.tabbar').waitFor();
    if (tabName) {
      await page.locator('.tabbar button', { hasText: tabName }).evaluate((x) => x.click());
      await page.waitForTimeout(600);
      if (tabName === 'Settings') for (const s of await page.locator('details > summary').all()) await s.click().catch(() => {});
    }
    let out = '';
    if (act) out = await act(page, req, base);
    await page.waitForTimeout(1200);
    await page.evaluate(() => document.querySelectorAll('.pop.toast').forEach((e) => e.remove()));
    const html = norm(await page.evaluate(() => document.documentElement.outerHTML.replace(/<head>.*<\/head>/s, '')));
    await ctx.close();
    return { html, out };
  }
  const same = async (name, opts, allow) => {
    await check(name, async () => {
      const [x, y] = await Promise.all([screen(A, opts), screen(B, opts)]);
      const f = allow || ((h) => h);
      if (f(x.html) !== f(y.html)) throw new Error(diffAt(f(x.html), f(y.html)));
      if (x.out !== y.out) throw new Error(`main «${x.out}» branch «${y.out}»`);
    });
  };
  const firstGame = async (base) => {
    const ctx = await browser.newContext();
    await ctx.request.post(base + '/api/admin/login', { data: { pin: PIN }, headers: { Origin: base } });
    const d = await (await ctx.request.get(base + '/api/admin/dashboard')).json();
    await ctx.close();
    return d.sessions.filter((s) => Date.parse(s.startsAt) > NOW_MS && !s.state.flags.canceled);
  };
  const games = await firstGame(A);
  const openEdit = (idx) => async (page) => {
    const id = games[idx].id;
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
    await page.waitForTimeout(500);
    return '';
  };
  const openAdd = async (page) => {
    await page.getByRole('button', { name: /\+ Add game/ }).first().click();
    await page.locator('dialog.sheet[open] form.add-game').waitFor();
    await page.waitForTimeout(400);
    return '';
  };
  const openUsual = async (page) => {
    // (The screen helper has already opened every Settings section.)
    await page.locator('[data-row="usualTime"] button', { hasText: 'Change' }).click();
    await page.locator('dialog.sheet[open] form').waitFor();
    await page.waitForTimeout(400);
    return '';
  };
  const usualOutOfHours = async (page) => {
    await openUsual(page);
    const t = page.locator('dialog.sheet[open] input[type="time"]');
    await t.nth(0).fill('21:00');
    await t.nth(1).fill('23:00');
    await page.waitForTimeout(200);
    return '';
  };
  for (const scheme of ['light', 'dark'])
    for (const width of [390, 360, 320]) {
      await same(`Add game, ${width} px, ${scheme}: identical to main`, { act: openAdd, scheme, width });
      await same(`Edit game (first game), ${width} px, ${scheme}: identical to main`, { act: openEdit(0), scheme, width });
    }
  await same('Edit game (second game), light: identical to main', { act: openEdit(1) });
  // (The Settings page behind the sheet differs from main only by the one new switch row.)
  const noRow = (h) => h.replace(/<div class="set-row-wrap" data-row="bookingHoursAll">.*?<\/label><\/div>/gs, '').replace(/Booking hours on, /g, '');
  for (const scheme of ['light', 'dark']) {
    await same(`Settings > Schedule > Usual game time sheet, ${scheme}: identical to main`, { tabName: 'Settings', act: openUsual, scheme }, noRow);
    await same(`...with 9:00 to 11:00 PM typed in (no message, Save on, as on main), ${scheme}: identical to main`, { tabName: 'Settings', act: usualOutOfHours, scheme }, noRow);
  }
  for (const scheme of ['light', 'dark'])
    await same(
      `organizer Settings, ${scheme}: identical apart from the one new switch row`,
      { url: '/admin', tabName: 'Settings', scheme },
      (h) => h.replace(/<div class="set-row-wrap" data-row="bookingHoursAll">.*?<\/label><\/div>/gs, '').replace(/Booking hours on, /g, ''),
    );
  for (const scheme of ['light', 'dark']) await same(`organizer Home, ${scheme}: identical`, { scheme });
  for (const t of ['Players', 'Money', 'History']) await same(`organizer ${t}, light: identical`, { tabName: t });
  await check('answers with the switch off: no Zip 24 key in the dashboard; an out-of-hours Add game, a moved game and a usual time are accepted exactly as main does', async () => {
    const call = async (base, method, p, data) => {
      const ctx = await browser.newContext();
      await ctx.request.post(base + '/api/admin/login', { data: { pin: PIN }, headers: { Origin: base } });
      const r = await ctx.request.fetch(base + p, { method, data, headers: { Origin: base } });
      const out = { status: r.status(), body: (await r.text()).replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '<id>') };
      await ctx.close();
      return out;
    };
    const d = await call(B, 'GET', '/api/admin/dashboard');
    if (/bookingHours/i.test(d.body)) throw new Error('dashboard has a Zip 24 key');
    const day = (h, m = 0) => new Date(Date.UTC(2026, 10, 25, h + 5, m)).toISOString();
    const cases = [
      ['POST', '/api/admin/sessions', { startsAt: day(6), endsAt: day(8) }],
      ['POST', '/api/admin/sessions', { startsAt: day(23), endsAt: new Date(Date.parse(day(23)) + 2 * 3600_000).toISOString() }],
      ['POST', '/api/admin/sessions', { startsAt: day(20), endsAt: day(19) }],
      ['PUT', `/api/admin/sessions/${games[0].id}/time`, { startsAt: day(21), endsAt: day(23) }],
      ['PUT', '/api/admin/group', { settings: { defaultStartMinutes: 21 * 60, defaultEndMinutes: 23 * 60 } }],
    ];
    for (const [m, p, data] of cases) {
      const [x, y] = await Promise.all([call(A, m, p, data), call(B, m, p, data)]);
      if (x.status !== y.status || x.body !== y.body) throw new Error(`${m} ${p}: main ${x.status} ${x.body.slice(0, 120)} / branch ${y.status} ${y.body.slice(0, 120)}`);
    }
  });
  await check('the switch ON touches no other screen: organizer Home and Players are identical to main', async () => {
    for (const opts of [{ tabName: 'Players' }, {}]) {
      const [x, y] = await Promise.all([screen(A, { ...opts, url: '/admin' }), screen(B, { ...opts, url: '/admin?bookinghours=on' })]);
      if (x.html !== y.html) throw new Error(diffAt(x.html, y.html));
    }
  });
  await browser.close();
  console.log(`\nzip24-off: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
