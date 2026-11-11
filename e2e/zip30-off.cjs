/* Zip 30: the "Acting for others" switch OFF must be exactly today's site. This runs today's main (a git worktree, path in MAIN_DIR) and this
 * branch side by side on two copies of the same fake world (built with migration 0018, so main also runs on the migrated database: the
 * rollback case), with the new row OFF and every other row as on live. The same phone taps are made on both (one phone acts as Indy 3 times,
 * then as Kai, sending its phone code): the branch records the codes quietly, main ignores them. Then it compares:
 *  - organizer Home (the screen this zip changes) at 390, 360 and 320 wide, light and dark; History light and dark; Players, Money;
 *  - organizer Settings apart from the one new switch row;
 *  - the player screen (Indy's and Kai's phone) light and dark;
 *  - the answers: dashboard, History (activity) and the player answer byte for byte (ids and times blanked);
 *  - main's View as on the migrated database opens (the demo copy leaves the new column out).
 *
 *   MAIN_DIR=/path/to/main-worktree node e2e/zip30-off.cjs
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
    env: { ...process.env, DEV_DB: dbFile, SETUP_TOKEN: 'zip30-off-setup-token-0123456789', DEV_CLOCK: '1' },
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
  const a = path.join(ROOT, '.data', 'zip30-off-main.sqlite');
  const b = path.join(ROOT, '.data', 'zip30-off-branch.sqlite');
  rmSync(a, { force: true });
  const seeded = spawnSync('npx', ['vite-node', 'scripts/load-seed-local.ts', '--', a, SEED_ISO], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, SEED_ZIP13: '1', SEED_ZIP14: '1', SEED_ZIP15: '1', SEED_ZIP17: '1' } });
  if (seeded.status !== 0) throw new Error(`seed: ${seeded.stderr || seeded.stdout}`);
  const db = new DatabaseSync(a);
  if (!db.prepare("SELECT 1 FROM pragma_table_info('admin_audit_log') WHERE name = 'device_tag'").get()) throw new Error('the world should be built with migration 0018');
  // The row this zip adds is OFF, as it ships. As on live: every other Settings row is on, including the six the older local world leaves off.
  db.exec("DELETE FROM task_log WHERE session_id IS NULL AND task = 'acting_others_on'");
  for (const t of ['alert_cards_on', 'seat_dots_on', 'speed_fewer_queries_on', 'speed_direct_load_on', 'speed_last_screen_on', 'speed_last_screen_admin_on'])
    db.exec(`INSERT INTO task_log (id, group_id, session_id, task, kind, at) SELECT 'live-${t}', id, NULL, '${t}', 'mark', '${SEED_ISO}' FROM groups WHERE NOT EXISTS (SELECT 1 FROM task_log WHERE task = '${t}' AND session_id IS NULL)`);
  db.close();
  copyFileSync(a, b);
  const [A, B] = await Promise.all([site(MAIN, 5397, a), site(ROOT, 5398, b)]);
  const browser = await chromium.launch();
  const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
  const TAG = 'indysphonecode00000001';

  // The same taps on both sites: Indy x3, then "Not you?" Kai and I'm in, all from one phone with its code.
  const taps = async (base) => {
    const ctx = await browser.newContext();
    const r = ctx.request;
    const H = { Origin: base, 'X-Phone-Tag': TAG };
    await r.post(base + '/api/admin/login', { data: { pin: PIN }, headers: { Origin: base } });
    const d = await (await r.get(base + '/api/admin/dashboard')).json();
    await r.post(base + '/api/admin/logout', { data: {}, headers: { Origin: base } });
    await ctx.clearCookies();
    const id = (n) => d.players.find((p) => p.name === n).id;
    await r.post(base + '/api/me', { data: { playerId: id('Indy') }, headers: H });
    const g = (await (await r.get(base + '/api/group', { headers: H })).json()).sessions.filter((s) => !s.canceled && !s.started && !s.mine && s.joinAs !== 'waitlist' && Date.parse(s.startsAt) > NOW_MS + 13 * 3600_000);
    const out = [];
    for (const [who, step, gi] of [['Indy', 'join', 0], ['Indy', 'withdraw', 0], ['Indy', 'join', 1], ['Kai', 'join', 2]]) {
      if (who === 'Kai') await r.post(base + '/api/me', { data: { playerId: id('Kai') }, headers: H });
      out.push((await r.post(`${base}/api/sessions/${g[gi].id}/${step}`, { data: {}, headers: H })).status());
    }
    await ctx.close();
    return out.join(',');
  };
  const [ta, tb] = await Promise.all([taps(A), taps(B)]);
  await check('the same four taps work on both sites (main ignores the phone code; the branch records it quietly)', async () => {
    if (ta !== '200,200,200,200' || tb !== ta) throw new Error(`main ${ta}, branch ${tb}`);
    const x = new DatabaseSync(b);
    const n = x.prepare('SELECT COUNT(*) AS n FROM admin_audit_log WHERE device_tag = ?').get(TAG).n;
    const y = new DatabaseSync(a);
    const m = y.prepare('SELECT COUNT(*) AS n FROM admin_audit_log WHERE device_tag IS NOT NULL').get().n;
    x.close();
    y.close();
    if (n !== 4 || m !== 0) throw new Error(`branch recorded ${n} (want 4), main ${m} (want 0)`);
  });

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
  async function screen(base, { url = '/admin', scheme = 'light', tabName, width = 390, player = null }) {
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
      try {
        localStorage.setItem('pb_phone_tag', 'indysphonecode00000001');
      } catch {}
    }, NOW_MS - Date.now());
    await ctx.route('https://venmo.com/**', (r) => r.abort());
    const req = ctx.request;
    if (player) {
      const o = await browser.newContext();
      await o.request.post(base + '/api/admin/login', { data: { pin: PIN }, headers: { Origin: base } });
      const d = await (await o.request.get(base + '/api/admin/dashboard')).json();
      await o.close();
      await req.post(base + '/api/me', { data: { playerId: d.players.find((p) => p.name === player).id }, headers: { Origin: base } });
    } else await req.post(base + '/api/admin/login', { data: { pin: PIN }, headers: { Origin: base } });
    const page = await ctx.newPage();
    await page.goto(base + (player ? '/' : url));
    await page.waitForLoadState('networkidle');
    if (player) await page.locator('.schedule article').first().waitFor();
    else await page.locator('.tabbar').waitFor();
    if (tabName) {
      await page.locator('.tabbar button', { hasText: tabName }).evaluate((x) => x.click());
      await page.waitForTimeout(600);
      if (tabName === 'Settings') for (const s of await page.locator('details > summary').all()) await s.click().catch(() => {});
      if (tabName === 'History') {
        const seg = page.locator('button', { hasText: /^Activity$/ });
        if (await seg.count()) await seg.first().click();
      }
    }
    await page.waitForTimeout(1200);
    await page.evaluate(() => document.querySelectorAll('.pop.toast').forEach((e) => e.remove()));
    const html = norm(await page.evaluate(() => document.documentElement.outerHTML.replace(/<head>.*<\/head>/s, '')));
    await ctx.close();
    return html;
  }
  const same = async (name, opts, allow) => {
    await check(name, async () => {
      const [x, y] = await Promise.all([screen(A, opts), screen(B, opts)]);
      const f = allow || ((h) => h);
      if (f(x) !== f(y)) throw new Error(diffAt(f(x), f(y)));
    });
  };
  for (const scheme of ['light', 'dark']) for (const width of [390, 360, 320]) await same(`organizer Home, ${width} px, ${scheme}: identical to main`, { scheme, width });
  for (const scheme of ['light', 'dark']) await same(`organizer History (Activity), ${scheme}: identical to main (no "from ... phone" notes)`, { tabName: 'History', scheme });
  for (const t of ['Players', 'Money']) await same(`organizer ${t}, light: identical`, { tabName: t });
  for (const scheme of ['light', 'dark'])
    await same(
      `organizer Settings, ${scheme}: identical apart from the one new switch row`,
      { tabName: 'Settings', scheme },
      (h) => h.replace(/<div class="set-row-wrap" data-row="actingOthersAll">.*?<\/label><\/div>/gs, '').replace(/Acting for others on, /g, ''),
    );
  for (const scheme of ['light', 'dark']) for (const who of ['Indy', 'Kai']) await same(`player screen (${who}), ${scheme}: identical`, { player: who, scheme });

  await check('answers with the switch off: dashboard, History and the player answer are byte for byte main (ids and times blanked)', async () => {
    const get = async (base, p, player) => {
      const ctx = await browser.newContext();
      await ctx.request.post(base + '/api/admin/login', { data: { pin: PIN }, headers: { Origin: base } });
      if (player) {
        const d = await (await ctx.request.get(base + '/api/admin/dashboard')).json();
        await ctx.request.post(base + '/api/admin/logout', { data: {}, headers: { Origin: base } });
        await ctx.request.post(base + '/api/me', { data: { playerId: d.players.find((x) => x.name === player).id }, headers: { Origin: base } });
      }
      const r = await (await ctx.request.get(base + p, { headers: { 'X-Phone-Tag': TAG } })).text();
      await ctx.close();
      // The taps ran a few milliseconds apart on the two servers: their times are compared to the second.
      return norm(r).replace(/(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)\.\d{3}Z/g, '$1Z').replace(/"(version|now|checkedAt|v)":"[^"]*"/g, '"$1":"x"').replace(/"(version|v)":\d+/g, '"$1":0');
    };
    for (const [p, who] of [['/api/admin/dashboard'], ['/api/admin/activity'], ['/api/group', 'Kai'], ['/api/group', 'Indy']]) {
      const [x, y] = await Promise.all([get(A, p, who), get(B, p, who)]);
      if (x !== y) throw new Error(`${p} ${who ?? ''}: ${diffAt(x, y)}`);
      if (/actingOthers|device_tag|indysphonecode/i.test(y)) throw new Error(`${p}: the answer mentions the new feature`);
    }
  });

  await check("main on the migrated database (the rollback case): View as opens and its demo copy answers (the new column is left out)", async () => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 860 }, isMobile: true, hasTouch: true, userAgent: UA });
    await ctx.request.post(A + '/api/admin/login', { data: { pin: PIN }, headers: { Origin: A } });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(A + '/admin');
    await page.locator('.tabbar').waitFor();
    await page.locator('.topbar-btn', { hasText: 'View as' }).first().click();
    await page.locator('dialog.sheet[open] .name-grid button', { hasText: 'Kai' }).click();
    await page.locator('.schedule article').first().waitFor({ timeout: 20000 });
    const text = await page.locator('body').innerText();
    if (/Something went wrong|no column named/i.test(text)) throw new Error(text.slice(0, 300));
    if (errors.length) throw new Error(errors.join(' | '));
    await ctx.close();
  });

  await browser.close();
  console.log(`\nzip30-off: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
