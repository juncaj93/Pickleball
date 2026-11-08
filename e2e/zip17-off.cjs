/* Zip 17: the Unpaid nudge switch OFF must be exactly today's site. This runs today's main (a git worktree, path in MAIN_DIR) and this
 * branch side by side on two copies of the same fake world (the Zip 17 world: Vic, Wren and Zoe owe for 1, 2 and 3 past games), with the
 * Unpaid nudge row OFF and every other row as on live, and compares the rendered HTML: player homes (the screen this zip changes: the owe
 * card, the game cards' I'm in, the Want in card) at 390, 360 and 320 wide, light and dark; the player page right after I'm in (the toast's
 * spoken words: main's "You're in" banner, not the nudge); a 3-game player's I'm in signs up as today; organizer Home and Settings apart from
 * the one new row; and no Zip 17 key in any answer.
 *
 *   MAIN_DIR=/path/to/main-worktree node e2e/zip17-off.cjs
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
const SEED_ISO = '2026-11-08T17:00:00.000Z'; // Sun Nov 8, noon Eastern (the seed, and now)
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
    env: { ...process.env, DEV_DB: dbFile, SETUP_TOKEN: 'zip17-off-setup-token-0123456789', DEV_CLOCK: '1' },
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
  const a = path.join(ROOT, '.data', 'zip17-off-main.sqlite');
  const b = path.join(ROOT, '.data', 'zip17-off-branch.sqlite');
  rmSync(a, { force: true });
  // The branch's seed (Vic, Wren and Zoe are made through the real site; main runs on it unchanged: no schema change in this zip).
  const seeded = spawnSync('npx', ['vite-node', 'scripts/load-seed-local.ts', '--', a, SEED_ISO], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, SEED_ZIP13: '1', SEED_ZIP14: '1', SEED_ZIP15: '1', SEED_ZIP17: '1' } });
  if (seeded.status !== 0) throw new Error(`seed: ${seeded.stderr || seeded.stdout}`);
  const db = new DatabaseSync(a);
  // The row this zip adds: OFF, as it ships.
  db.exec("DELETE FROM task_log WHERE session_id IS NULL AND task = 'unpaid_nudge_on'");
  // As on live (read Nov 8): every other Settings row is on, including the six the older local world leaves off.
  for (const t of ['alert_cards_on', 'seat_dots_on', 'speed_fewer_queries_on', 'speed_direct_load_on', 'speed_last_screen_on', 'speed_last_screen_admin_on'])
    db.exec(`INSERT INTO task_log (id, group_id, session_id, task, kind, at) SELECT 'live-${t}', id, NULL, '${t}', 'mark', '${SEED_ISO}' FROM groups WHERE NOT EXISTS (SELECT 1 FROM task_log WHERE task = '${t}' AND session_id IS NULL)`);
  // Zoe is a regular (the Want in card, another sign-up path).
  db.exec("UPDATE players SET usual_days = '2,4', is_regular = 1 WHERE display_name = 'Zoe'");
  db.close();
  copyFileSync(a, b);
  const [A, B] = await Promise.all([site(MAIN, 5383, a), site(ROOT, 5384, b)]);
  const browser = await chromium.launch();
  const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mobile/15E148 Safari/604.1';
  const norm = (h) =>
    h
      .replace(/«r[0-9a-z]+»/g, '«id»')
      .replace(/(:r[0-9a-z]+:)/g, ':id:')
      .replace(/\/assets\/[^"']+/g, '/assets/x')
      .replace(/ dots-celebrate/g, '')
      .replace(/(datetime="[^"]+?)\.\d{3}Z"/g, '$1Z"')
      .replace(/localhost(:|%3A)538[34]/g, 'localhost$1PORT')
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '<id>');
  async function screen(base, { who, url = '/', scheme = 'light', tabName, act, width = 390 }) {
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
        localStorage.setItem('pb_games_filter', 'all');
      } catch {}
    }, NOW_MS - Date.now());
    await ctx.route('https://venmo.com/**', (r) => r.abort());
    const req = ctx.request;
    await req.post(base + '/api/admin/login', { data: { pin: PIN }, headers: { Origin: base } });
    const d = await (await req.get(base + '/api/admin/dashboard')).json();
    if (who !== 'admin') {
      await req.post(base + '/api/admin/logout', { headers: { Origin: base } });
      await req.post(base + '/api/me', { data: { playerId: d.players.find((p) => p.name === who).id }, headers: { Origin: base } });
    }
    const page = await ctx.newPage();
    await page.goto(base + url);
    await page.waitForLoadState('networkidle');
    if (who === 'admin') await page.locator('.tabbar').waitFor();
    else await page.locator('.schedule article').first().waitFor();
    if (tabName) {
      await page.locator('.tabbar button', { hasText: tabName }).evaluate((x) => x.click());
      await page.waitForTimeout(600);
      if (tabName === 'Settings') for (const s of await page.locator('details > summary').all()) await s.click().catch(() => {});
    }
    let out = '';
    if (act) out = await act(page, req, base);
    await page.waitForTimeout(1500);
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
  for (const scheme of ['light', 'dark'])
    for (const width of [390, 360, 320])
      for (const who of ['Vic', 'Wren', 'Zoe'])
        await same(`player home, ${who}, ${width} px, ${scheme}: identical (the old owe card words, I'm in not dimmed)`, { who, scheme, width });
  for (const who of ['Jordan', 'Kai', 'Casey']) await same(`player home, ${who}, light: identical`, { who });
  // I'm in on the first game more than 13 hours away (no late drop afterwards): the banner's spoken words and the page after it.
  const joinFirst = async (page, req, base) => {
    const g = await (await req.get(base + '/api/group')).json();
    const s = g.sessions.find((x) => !x.canceled && !x.started && !x.mine && x.joinAs !== 'waitlist' && Date.parse(x.startsAt) > Date.now() + 13 * 3600_000);
    await page.locator(`#row-${s.id} [data-join]`).click();
    await page.waitForTimeout(900);
    const spoken = await page.evaluate(() => [...document.querySelectorAll('[aria-live]')].map((e) => e.textContent).join(' | '));
    const sheet = await page.locator('dialog.sheet[open]').count();
    const after = await (await req.get(base + '/api/group')).json();
    return `${spoken} | sheet ${sheet} | in ${after.sessions.find((x) => x.id === s.id).mine?.status}`;
  };
  await same("Wren (2 unpaid) taps I'm in: today's banner, no Please pay toast", { who: 'Wren', act: joinFirst });
  await same("Zoe (3 unpaid) taps I'm in: signs up as today, no sheet", { who: 'Zoe', act: joinFirst });
  await same(
    'organizer Settings, light: identical apart from the one new switch row',
    { who: 'admin', url: '/admin', tabName: 'Settings' },
    (h) => h.replace(/<div class="set-row-wrap" data-row="unpaidNudgeAll">.*?<\/label><\/div>/gs, ''),
  );
  // Organizer Home is not changed by this zip. Its long card titles shrink to fit by a timing-dependent helper (src/AlertCard.tsx useFitTitle:
  // it remembers the width it measured before shrinking, so a later redraw can leave a title unshrunk); the same code on main lands either
  // way depending on load timing. Only that one inline font size (and the button width it moves) is left out of the comparison.
  const fitFree = (h) => h.replace(/(<h3 class="ac-title[^"]*") style="[^"]*"/g, '$1');
  for (const scheme of ['light', 'dark']) await same(`organizer Home, ${scheme}: identical (apart from the shrink-to-fit title size)`, { who: 'admin', url: '/admin', scheme }, fitFree);
  for (const t of ['Players', 'Money', 'History']) await same(`organizer ${t}, light: identical`, { who: 'admin', url: '/admin', tabName: t });
  await check('API with the switch off: no Zip 17 key in the player answer (Zoe) or the dashboard', async () => {
    const ctx = await browser.newContext();
    await ctx.request.post(B + '/api/admin/login', { data: { pin: PIN }, headers: { Origin: B } });
    const d = await (await ctx.request.get(B + '/api/admin/dashboard')).text();
    if (/unpaidNudge/.test(d)) throw new Error('dashboard has a Zip 17 key');
    const zoe = JSON.parse(d).players.find((p) => p.name === 'Vic').id;
    await ctx.request.post(B + '/api/me', { data: { playerId: zoe }, headers: { Origin: B } });
    const g = await (await ctx.request.get(B + '/api/group')).text();
    if (/unpaidNudge/.test(g)) throw new Error('player answer has a Zip 17 key');
    await ctx.close();
  });
  await browser.close();
  console.log(`\nzip17-off: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
