/* Zip 10: "Card cleanup" OFF must be exactly today's site. This runs today's main (a git worktree, path in MAIN_DIR) and this branch side by
 * side on two copies of the same fake world (seeded by main, so the Card cleanup row does not exist and Gray is still the real standby on the
 * full 10-in game), with the same pinned clock, and compares the rendered HTML of every screen, player and organizer, light and dark, before
 * and after the same taps (including an 11th I'm in on the full game, which must still go on the waitlist). The only difference allowed is
 * the new row in Settings > Feature switches.
 *
 *   MAIN_DIR=/path/to/main-worktree node e2e/zip10-off.cjs
 *
 * Not part of npm run test:e2e (it needs the second checkout). Nothing here touches Cloudflare or the live site.
 */
const { spawn, spawnSync } = require('node:child_process');
const { readFileSync, mkdirSync, rmSync, copyFileSync } = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const Database = (() => {
  try {
    return require('better-sqlite3');
  } catch {
    return null;
  }
})();

const ROOT = path.join(__dirname, '..');
const MAIN = process.env.MAIN_DIR;
if (!MAIN) throw new Error('set MAIN_DIR to a checkout of main');
const NOW_ISO = '2026-11-05T17:00:00.000Z';
const NOW_MS = Date.parse(NOW_ISO);
const PIN = /PIN `(\d{6})`/.exec(readFileSync(path.join(ROOT, 'docs/PREVIEW_FAKE_DB.md'), 'utf8'))[1];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let passed = 0;
let failed = 0;
async function check(name, fn) {
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
  const server = spawn('npx', ['vite', '--port', String(port), '--strictPort'], {
    cwd: dir,
    env: { ...process.env, DEV_DB: dbFile, SETUP_TOKEN: 'zip10-off-setup-token-0123456789', DEV_CLOCK: '1', INSTANT_TAPS: '', ADJUST_CREDIT: '', VENMO_REQUEST: '', HOME_COLLAPSE: '', TONIGHT_GLOW: '', COLOR_CLEANUP: '', PLAYER_CARDS_SIMPLE: '', SHORT_GAMES: '', CARD_TIME_BUTTONS: '', CARD_CLEANUP: '', MOTION: '', MOTION_ADMIN: '' },
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
  const a = path.join(ROOT, '.data', 'zip10-off-main.sqlite');
  const b = path.join(ROOT, '.data', 'zip10-off-branch.sqlite');
  rmSync(a, { force: true });
  // Today's main seeds the world (so it holds exactly the switches main knows); the branch gets a byte copy of the same file.
  const seeded = spawnSync('npx', ['vite-node', 'scripts/load-seed-local.ts', '--', a, NOW_ISO], { cwd: MAIN, encoding: 'utf8' });
  if (seeded.status !== 0) throw new Error(`seed: ${seeded.stderr || seeded.stdout}`);
  copyFileSync(a, b);
  void Database;
  const [A, B] = await Promise.all([site(MAIN, 5333, a), site(ROOT, 5334, b)]);
  const browser = await chromium.launch();
  const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mobile/15E148 Safari/604.1';
  // Everything that differs between two runs by itself: React's element ids, the version stamp, build hashes in asset names.
  const norm = (h) =>
    h
      .replace(/«r[0-9a-z]+»/g, '«id»')
      .replace(/(:r[0-9a-z]+:)/g, ':id:')
      .replace(/\/assets\/[^"']+/g, '/assets/x')
      .replace(/ dots-celebrate/g, '')
      // The setup step above runs a few milliseconds apart on the two sites (its Activity entry shows the same minute).
      .replace(/(datetime="[^"]+?)\.\d{3}Z"/g, '$1Z"')
      // The two sites run on two ports; the address shows up in links and texts.
      .replace(/localhost(:|%3A)533[34]/g, 'localhost$1PORT')
      // The 1.5 hour game added above gets its own random id on each site.
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '<id>');
  async function screen(base, { who, url, scheme, tabName, before }) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 860 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, colorScheme: scheme, userAgent: UA, reducedMotion: 'reduce' });
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
    if (who === 'admin') await req.post(base + '/api/admin/login', { data: { pin: PIN }, headers: { Origin: base } });
    else {
      await req.post(base + '/api/admin/login', { data: { pin: PIN }, headers: { Origin: base } });
      const d = await (await req.get(base + '/api/admin/dashboard')).json();
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
      await page.waitForTimeout(500);
      if (tabName === 'Settings') for (const s of await page.locator('details > summary').all()) await s.click().catch(() => {});
    }
    if (before) await before(page);
    await page.waitForTimeout(2500);
    const html = norm(await page.evaluate(() => document.body.innerHTML));
    await ctx.close();
    return html;
  }
  const same = async (name, opts, allow) => {
    await check(name, async () => {
      const [x, y] = await Promise.all([screen(A, opts), screen(B, opts)]);
      const y2 = allow ? allow(y) : y;
      const x2 = allow ? allow(x) : x;
      if (x2 !== y2) throw new Error(diffAt(x2, y2));
    });
  };
  // The Money rule Alex added on Nov 5 (a fully paid game moves to Previous games only once finalized) is NOT behind the switch: it applies
  // on its own. The fake world's "All paid" game (everyone paid, not played yet) is the one game it moves, so for this comparison one of
  // its players is unmarked on BOTH sites first; then the Money page must be identical too. The rule itself is tested in
  // tests/money-finalized-rule.test.ts and e2e/instant-taps.cjs.
  for (const base of [A, B]) {
    const ctx = await browser.newContext();
    await ctx.request.post(base + '/api/admin/login', { data: { pin: PIN }, headers: { Origin: base } });
    const d = await (await ctx.request.get(base + '/api/admin/dashboard')).json();
    const g = d.sessions.find((s) => s.note === 'All paid');
    const r = g.roster.find((x) => x.name === 'Indy');
    const res = await ctx.request.post(base + `/api/admin/sessions/${g.id}/payment`, { data: { playerId: r.playerId, paid: false, seen: r.moneySeen }, headers: { Origin: base } });
    if (!res.ok()) throw new Error(`unmark on ${base}: ${await res.text()}`);
    // The same 1.5 hour game on both sites: Thu Nov 12, 7:30 to 9:00 PM Eastern, booked, Jordan and Kai in.
    const add = await ctx.request.post(base + '/api/admin/sessions', { data: { startsAt: '2026-11-13T00:30:00.000Z', endsAt: '2026-11-13T02:00:00.000Z', note: null }, headers: { Origin: base } });
    if (!add.ok()) throw new Error(`add short game on ${base}: ${await add.text()}`);
    await ctx.close();
  }
  for (const base of [A, B]) {
    const ctx = await browser.newContext();
    await ctx.request.post(base + '/api/admin/login', { data: { pin: PIN }, headers: { Origin: base } });
    const d = await (await ctx.request.get(base + '/api/admin/dashboard')).json();
    const g = d.sessions.find((s) => s.startsAt === '2026-11-13T00:30:00.000Z');
    if (!g) throw new Error(`no short game on ${base}`);
    await ctx.request.post(base + `/api/admin/sessions/${g.id}/court-status`, { data: { status: 'booked' }, headers: { Origin: base } });
    for (const n of ['Jordan', 'Kai']) {
      const pid = d.players.find((p) => p.name === n).id;
      const r = await ctx.request.post(base + `/api/admin/sessions/${g.id}/roster`, { data: { action: 'confirm', playerId: pid }, headers: { Origin: base } });
      if (!r.ok()) throw new Error(`add ${n} on ${base}: ${await r.text()}`);
    }
    await ctx.close();
  }
  for (const scheme of ['light', 'dark']) {
    for (const who of ['Jordan', 'Harper', 'Avery', 'Gray', 'Casey', 'Kai']) await same(`player home, ${who}, ${scheme}: identical`, { who, url: '/', scheme });
    for (const t of ['Home', 'Players', 'Money', 'History']) await same(`organizer ${t}, ${scheme}: identical`, { who: 'admin', url: '/admin', scheme, tabName: t });
    // Settings: the new row (and its name in the note) is the one thing that may differ.
    await same(
      `organizer Settings, ${scheme}: identical apart from the new switch row`,
      { who: 'admin', url: '/admin', scheme, tabName: 'Settings' },
      (h) => h.replace(/<div class="set-row-wrap" data-row="cardCleanupAll">.*?<\/label><\/div>/gs, ''),
    );
  }
  // After taps (each on its own copy, so both sites start the same): the screen a tap leaves behind is the same too.
  const tapThen = (label) => async (page) => {
    const b = page.getByRole('button', { name: label }).first();
    if (await b.count()) await b.click();
    await page.waitForTimeout(3500);
  };
  // Sheets: the Players gear sheet (no Adjust credit row), the Money Remind sheet (no Venmo request), a player's credit sheet.
  const openThen = (fn) => async (page) => {
    await fn(page);
    await page.waitForTimeout(1500);
  };
  await same('organizer Players gear sheet (Harper), light: identical', { who: 'admin', url: '/admin', scheme: 'light', tabName: 'Players', before: openThen(async (p) => p.locator('[data-player="Harper"] [data-r3-gear]').click()) });
  await same('organizer Money, first game open and its Remind sheet, light: identical', { who: 'admin', url: '/admin', scheme: 'light', tabName: 'Money', before: openThen(async (p) => { await p.locator('[data-remind]').first().click(); }) });
  await same('player credit sheet (Harper), light: identical', { who: 'Harper', url: '/', scheme: 'light', before: openThen(async (p) => { await p.locator('.credit-chip, [aria-label*="credit"]').first().click(); }) });
  await same('player I paid (Jordan), after the tap: identical', { who: 'Jordan', url: '/', scheme: 'light', before: tapThen('I paid') });
  await same("player I'm in (Casey), after the tap: identical", { who: 'Casey', url: '/', scheme: 'light', before: tapThen(/^I'm in/) });
  await same("player Leave waitlist dialog (Gray, the standby), light: identical", { who: 'Gray', url: '/', scheme: 'light', before: tapThen(/Leave (waitlist|standby)/) });
  // An 11th I'm in on the full game (through the API on both sites): the waitlist, exactly as before.
  for (const base of [A, B]) {
    const ctx = await browser.newContext();
    await ctx.request.post(base + '/api/admin/login', { data: { pin: PIN }, headers: { Origin: base } });
    const d = await (await ctx.request.get(base + '/api/admin/dashboard')).json();
    const full = d.sessions.find((s) => s.confirmedCount === 10 && s.waitlistCount === 1);
    if (!full) throw new Error(`${base}: no full game with a standby`);
    await ctx.request.post(base + '/api/admin/logout', { headers: { Origin: base } });
    await ctx.request.post(base + '/api/me', { data: { playerId: d.players.find((p) => p.name === 'Harper').id }, headers: { Origin: base } });
    const j = await (await ctx.request.post(base + `/api/sessions/${full.id}/join`, { data: {}, headers: { Origin: base } })).json();
    await check(`${base === A ? 'main' : 'branch'}: an 11th I'm in on the full game goes on the waitlist (#2)`, async () => {
      if (j.result !== 'waitlisted' || j.position !== 2) throw new Error(JSON.stringify(j));
    });
    await ctx.close();
  }
  for (const scheme of ['light', 'dark']) {
    await same(`player home after the 11th I'm in (Harper, #2 on the waitlist), ${scheme}: identical`, { who: 'Harper', url: '/', scheme });
    await same(`organizer Home after the 11th I'm in, ${scheme}: identical`, { who: 'admin', url: '/admin', scheme, tabName: 'Home' });
  }
  await browser.close();
  console.log(`\nzip10-off: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
