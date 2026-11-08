/* Zip 16: the After-game cards switch OFF must be exactly today's site, with ONE intended difference: the dark-mode look of the player alert
 * cards (it rides on Alert cards, already on live). This runs today's main (a git worktree, path in MAIN_DIR) and this branch side by side on
 * two copies of the same fake world (the Zip 16 world: Parker $5 back, Rowan $8 back from two games, Quinn owes $3 more after a reopen and
 * redo), with the After-game cards row OFF, and compares:
 *  - the rendered HTML of the player homes (Parker, Rowan, Quinn, Casey, Jordan, Gray, Blake, Indy) at 390, 360 and 320 wide, light and dark;
 *  - every element's look (colors, borders, sizes, fonts) on those screens: identical in light; identical in dark except the alert cards'
 *    fill, border and badge colors (the intended difference);
 *  - organizer Home light and dark, Settings apart from the one new row, Players, Money and History;
 *  - the answers: no Zip 16 key in the player answer or the dashboard.
 *
 *   MAIN_DIR=/path/to/main-worktree node e2e/zip16-off.cjs
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
const SEED_ISO = '2026-11-08T20:00:00.000Z'; // Sun Nov 8, 3:00 PM Eastern (the seed)
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
  // As on live: the look and speed switches that are off there are off here (empty = the default, which every Settings row then decides).
  const server = spawn('npx', ['vite', '--port', String(port), '--strictPort'], {
    cwd: dir,
    env: { ...process.env, DEV_DB: dbFile, SETUP_TOKEN: 'zip16-off-setup-token-0123456789', DEV_CLOCK: '1' },
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
  const a = path.join(ROOT, '.data', 'zip16-off-main.sqlite');
  const b = path.join(ROOT, '.data', 'zip16-off-branch.sqlite');
  rmSync(a, { force: true });
  // The branch's seed (the Zip 16 games are made through the real site; main runs on it unchanged: no schema change in this zip).
  const seeded = spawnSync('npx', ['vite-node', 'scripts/load-seed-local.ts', '--', a, SEED_ISO], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, SEED_ZIP16: '1' } });
  if (seeded.status !== 0) throw new Error(`seed: ${seeded.stderr || seeded.stdout}`);
  const db = new DatabaseSync(a);
  db.exec("DELETE FROM task_log WHERE session_id IS NULL AND task = 'after_game_card_on'");
  db.close();
  copyFileSync(a, b);
  const [A, B] = await Promise.all([site(MAIN, 5383, a), site(ROOT, 5384, b)]);
  const browser = await chromium.launch();
  const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
  const norm = (h) =>
    h
      // The one attribute the branch adds to <html> on the player screen (the dark look hangs on it; it changes nothing by itself).
      .replace(/ data-ac-player="on"/g, '')
      .replace(/«r[0-9a-z]+»/g, '«id»')
      .replace(/(:r[0-9a-z]+:)/g, ':id:')
      .replace(/\/assets\/[^"']+/g, '/assets/x')
      .replace(/ dots-celebrate/g, '')
      .replace(/(datetime="[^"]+?)\.\d{3}Z"/g, '$1Z"')
      .replace(/localhost(:|%3A)538[34]/g, 'localhost$1PORT')
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '<id>');
  // Every element's look. In dark, the alert cards' own fill, border and badge colors are left out (the intended difference).
  const looks = (page, scheme) =>
    page.evaluate((dark) => {
      const props = ['color', 'background-color', 'border-top-color', 'border-left-color', 'border-top-width', 'font-size', 'font-weight', 'line-height', 'padding-top', 'padding-left', 'margin-top', 'display', 'opacity', 'box-shadow', 'width', 'height'];
      const skip = new Set(['background-color', 'border-top-color', 'border-left-color']);
      return [...document.querySelectorAll('body *')]
        .map((el) => {
          const s = getComputedStyle(el);
          const card = el.matches('.ac, .pop.toast, .ac .ac-icon, .pop.toast .toast-icon');
          return `${el.tagName}.${el.className && el.className.baseVal === undefined ? el.className : ''}|` + props.filter((p) => !(dark && card && skip.has(p))).map((p) => s.getPropertyValue(p)).join(';');
        })
        .join('\n');
    }, scheme === 'dark');
  async function screen(base, { who, url, scheme, tabName, width = 390, styles = false }) {
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
    await page.waitForTimeout(1500);
    // Every web font in before anything is measured (a font still loading on one side changes text widths).
    await page.evaluate(() => document.fonts.ready.then(() => null));
    await page.waitForTimeout(200);
    // A passing pop-up ("Game on! 5 in") can be caught mid-slide on either side; its spoken words (aria-live) are still compared.
    await page.evaluate(() => document.querySelectorAll('.pop.toast').forEach((e) => e.remove()));
    const html = norm(await page.evaluate(() => document.documentElement.outerHTML.replace(/<head>.*<\/head>/s, '')));
    const look = styles ? await looks(page, scheme) : '';
    await ctx.close();
    return { html, look };
  }
  const same = async (name, opts, allow) => {
    await check(name, async () => {
      const [x, y] = await Promise.all([screen(A, opts), screen(B, opts)]);
      const f = allow || ((h) => h);
      if (f(x.html) !== f(y.html)) throw new Error(diffAt(f(x.html), f(y.html)));
      if (x.look !== y.look) throw new Error(`look: ${diffAt(x.look, y.look)}`);
    });
  };
  for (const scheme of ['light', 'dark']) {
    for (const width of [390, 360, 320])
      for (const who of ['Parker', 'Rowan', 'Quinn', 'Casey'])
        await same(`player home ${who}, ${width} px, ${scheme}: identical${scheme === 'dark' ? ' apart from the alert card colors' : ''} (no after-game card, the old owe card words)`, { who, url: '/', scheme, width, styles: true });
    for (const who of ['Jordan', 'Gray', 'Blake', 'Indy']) await same(`player home ${who}, 390 px, ${scheme}: identical${scheme === 'dark' ? ' apart from the alert card colors' : ''}`, { who, url: '/', scheme, styles: true });
    await same(`organizer Home, 390 px, ${scheme}: identical (looks too)`, { who: 'admin', url: '/admin', scheme, styles: true });
    await same(`organizer Settings, ${scheme}: identical apart from the one new switch row`, { who: 'admin', url: '/admin', scheme, tabName: 'Settings' }, (h) =>
      h.replace(/<div class="set-row-wrap" data-row="afterGameCardAll">.*?<\/label><\/div>/gs, ''),
    );
  }
  for (const t of ['Players', 'Money', 'History']) await same(`organizer ${t}, light: identical`, { who: 'admin', url: '/admin', scheme: 'light', tabName: t });
  await check('API with the switch off: no Zip 16 key in the player answer (Parker, Quinn) or the dashboard', async () => {
    const ctx = await browser.newContext();
    await ctx.request.post(B + '/api/admin/login', { data: { pin: PIN }, headers: { Origin: B } });
    const d = await (await ctx.request.get(B + '/api/admin/dashboard')).text();
    if (/afterGame/.test(d)) throw new Error('dashboard has a Zip 16 key');
    const dd = JSON.parse(d);
    for (const who of ['Parker', 'Quinn']) {
      await ctx.request.post(B + '/api/me', { data: { playerId: dd.players.find((p) => p.name === who).id }, headers: { Origin: B } });
      const g = await (await ctx.request.get(B + '/api/group')).text();
      if (/afterGame|"more"|"preview"/.test(g)) throw new Error(`${who}: player answer has a Zip 16 key`);
    }
    await ctx.close();
  });
  await browser.close();
  console.log(`\nzip16-off: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
