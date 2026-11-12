/* Player gallery (Zip 36): a picture of every PLAYER-side screen and state, light and dark, for designing the Christmas skin on.
 *
 *   node e2e/player-gallery.cjs                (writes docs/player-gallery/, about 10 to 15 minutes)
 *   PG_OUT=/some/dir node e2e/player-gallery.cjs
 *   PG_ONLY=money node e2e/player-gallery.cjs   (only the scenes whose section or name matches; for trying one thing)
 *
 * What it does, in plain words: it builds a fake group on this computer (the ten fixed made-up names of docs/PREVIEW_FAKE_DB.md, fake
 * phone numbers, a fake PIN read from that same file), starts its own copy of the site on its own port, pins the clock, and walks a phone
 * through every screen a player can see. Each screen is photographed on an iPhone Air sized phone (420 x 912 CSS px, 3x) in light and
 * dark. A card, alert or sheet shorter than the screen also gets a tight crop. Pages that scroll also get a whole-page picture.
 *
 * It never touches the live site or the shared preview database: everything is a throwaway sqlite file in .data/ and the dev server
 * on localhost. It changes no site code. Two fake worlds are used (see WORLD A and WORLD B below).
 */
const { spawn, spawnSync } = require('node:child_process');
const { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } = require('node:fs');
const path = require('node:path');
const playwright = require('playwright');
let sharp = null;
try {
  sharp = require('sharp');
} catch {
  /* plain PNGs are fine without it */
}

const ROOT = path.join(__dirname, '..');
const OUT = process.env.PG_OUT ? path.resolve(process.env.PG_OUT) : path.join(ROOT, 'docs', 'player-gallery');
const ONLY = process.env.PG_ONLY ? new RegExp(process.env.PG_ONLY, 'i') : null;
const PORT = Number(process.env.E2E_PORT) || 5436;
const BASE = `http://localhost:${PORT}`;
const VIEW = { width: 420, height: 912 }; // iPhone Air
const SCALE = 3;
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const SCHEMES = process.env.PG_SCHEMES ? process.env.PG_SCHEMES.split(',') : ['light', 'dark'];
// The fake organizer PIN lives only in docs/PREVIEW_FAKE_DB.md; it is read here at run time and never written anywhere.
const PIN = /PIN `(\d{6})`/.exec(readFileSync(path.join(ROOT, 'docs', 'PREVIEW_FAKE_DB.md'), 'utf8'))[1];
const DATA = path.join(ROOT, '.data');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Eastern wall-clock time ("2026-11-12 15:00") as a timestamp, EST or EDT worked out. */
function eastern(local) {
  for (const off of ['-04:00', '-05:00']) {
    const ms = Date.parse(`${local.replace(' ', 'T')}:00${off}`);
    if (new Date(ms).toLocaleString('sv-SE', { timeZone: 'America/Detroit' }).slice(0, 16) === local) return ms;
  }
  throw new Error(`not a time: ${local}`);
}
const nice = (ms) => new Date(ms).toLocaleString('en-US', { timeZone: 'America/Detroit', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

/** The wrangler.toml switches that are ON on live (the same trick the other browser tests use). */
function liveVars() {
  const toml = readFileSync(path.join(ROOT, 'wrangler.toml'), 'utf8');
  const top = toml.slice(toml.indexOf('[vars]'), toml.indexOf('[env.preview]'));
  const out = {};
  for (const m of top.matchAll(/^([A-Z_][A-Z0-9_]*)\s*=\s*"([^"]*)"/gm)) if (m[1] !== 'SITE_URL') out[m[1]] = m[2];
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// The site on this computer
// ---------------------------------------------------------------------------------------------------------------------
let server = null;
async function startSite(dbFile, extraEnv = {}) {
  await stopSite();
  mkdirSync(DATA, { recursive: true });
  server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
    cwd: ROOT,
    env: { ...process.env, ...liveVars(), DEV_DB: dbFile, SETUP_TOKEN: 'player-gallery-setup-token-0123456789', DEV_CLOCK: '1', ...extraEnv },
    stdio: 'ignore',
    detached: true,
  });
  for (let i = 0; i < 160; i++) {
    try {
      if ((await fetch(`${BASE}/api/status`)).ok) return;
    } catch {}
    await sleep(500);
  }
  throw new Error('the site did not start');
}
async function stopSite() {
  if (!server) return;
  try {
    process.kill(-server.pid, 'SIGTERM');
  } catch {}
  server = null;
  await sleep(600);
}
process.on('exit', () => {
  try {
    if (server) process.kill(-server.pid, 'SIGTERM');
  } catch {}
});
let clockMs = 0;
async function setClock(ms) {
  clockMs = ms;
  await fetch(`${BASE}/__dev/clock`, { method: 'POST', body: JSON.stringify({ atMs: ms }) });
}

// ---------------------------------------------------------------------------------------------------------------------
// The picture machinery
// ---------------------------------------------------------------------------------------------------------------------
const failures = [];
const manifest = []; // one row per picture set: { n, section, name, title, who, clock, component, files: [...] }
let counter = 0;
let browser = null;
let org = null; // the organizer's API (a phone-less request context signed in with the fake PIN)
let ids = {}; // fake name -> player id

async function signInOrganizer() {
  org = await playwright.request.newContext({ baseURL: BASE, extraHTTPHeaders: { Origin: BASE } });
  const r = await org.post('/api/admin/login', { data: { pin: PIN } });
  if (!r.ok()) throw new Error('organizer sign-in');
}
const call = async (method, url, data, headers) => {
  const r = await org.fetch(url, { method, data, headers: { Origin: BASE, ...(headers || {}) } });
  const text = await r.text();
  if (!r.ok()) throw new Error(`${method} ${url} -> ${r.status()} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
};
const dash = () => call('GET', '/api/admin/dashboard');
async function loadIds() {
  const d = await dash();
  ids = Object.fromEntries(d.players.map((p) => [p.name, p.id]));
  return d;
}
/** A request context standing in for one player's phone (signed in as that name), for setup taps made "as" the player. */
async function playerApi(name) {
  const ctx = await playwright.request.newContext({ baseURL: BASE, extraHTTPHeaders: { Origin: BASE } });
  const r = await ctx.post('/api/me', { data: { playerId: ids[name] } });
  if (!r.ok()) throw new Error(`pick ${name}: ${r.status()}`);
  const pcall = async (method, url, data) => {
    const res = await ctx.fetch(url, { method, data, headers: { Origin: BASE } });
    const text = await res.text();
    if (!res.ok()) throw new Error(`${name} ${method} ${url} -> ${res.status()} ${text.slice(0, 300)}`);
    return text ? JSON.parse(text) : null;
  };
  return { ctx, call: pcall };
}

/** One phone: a browser context at the picture size, on the pinned clock, signed in as `who` (or nobody). */
async function phone(who, { pct = 100, routes, admin = false } = {}) {
  const ctx = await browser.newContext({
    viewport: VIEW,
    deviceScaleFactor: SCALE,
    isMobile: true,
    hasTouch: true,
    colorScheme: 'light',
    reducedMotion: 'reduce',
    userAgent: UA,
  });
  // A fake clock that starts at the pinned moment and runs on in real time; a picture of a pop-up pauses it so the pop-up stays.
  await ctx.clock.install({ time: clockMs });
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem('pb_games_filter', 'all');
    } catch {}
  });
  if (who) {
    const r = await ctx.request.post(`${BASE}/api/me`, { data: { playerId: ids[who] }, headers: { Origin: BASE } });
    if (!r.ok()) throw new Error(`pick ${who}: ${r.status()}`);
  }
  // The organizer's own phone (the Swap to Alex button only shows when signed in as the organizer).
  if (admin) await ctx.request.post(`${BASE}/api/admin/login`, { data: { pin: PIN }, headers: { Origin: BASE } });
  // Venmo, maps and calendar links never open in a picture.
  await ctx.route('https://venmo.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<p>Venmo</p>' }));
  if (routes) await routes(ctx);
  const page = await ctx.newPage();
  page.setDefaultTimeout(12000);
  if (pct !== 100) {
    await page.addInitScript((p) => {
      const css = `html { font-size: ${p}% !important; } body { font-size: ${(17 * p) / 100}px !important; }`;
      document.addEventListener('DOMContentLoaded', () => {
        const st = document.createElement('style');
        st.textContent = css;
        document.head.appendChild(st);
      });
    }, pct);
  }
  return { ctx, page };
}

async function savePng(buf, file) {
  if (sharp) buf = await sharp(buf).png({ compressionLevel: 9, effort: 10 }).toBuffer();
  writeFileSync(file, buf);
}

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/**
 * Photograph one state in light and dark.
 *   section   the heading in INDEX.md
 *   name      short file name part
 *   title     one plain-English line: what the picture shows
 *   who       the fake player it is seen as (null: nobody picked yet)
 *   component which piece of the site draws it (for the designer)
 *   open      async (page) => ...  gets the page to the state (default: open Home and wait for the games)
 *   go        the address to open (default "/")
 *   crop      a selector (or function page => locator) for a tight crop of one card or sheet, or null
 *   full      also take a whole-page picture (pages that scroll)
 *   pct       text size in percent (100, 125, 150)
 *   clockAt   the pinned clock for this picture ("2026-11-12 15:00"), default: the world's clock
 *   setup     async () => ... runs once before the pictures (taps made through the API, not photographed)
 *   routes    async (ctx) => ... network tricks (offline, empty site), set before the page opens
 */
async function shoot(spec) {
  const { section, name, title, who = null, component, open, go = '/', crop = null, full = false, pct = 100, clockAt, setup, routes, ready = true, freeze = false } = spec;
  if (ONLY && !ONLY.test(`${section} ${name}`)) return null;
  const n = ++counter;
  const num = String(n).padStart(2, '0');
  if (clockAt) await setClock(eastern(clockAt));
  if (setup) await setup();
  const files = [];
  const { ctx, page } = await phone(who, { pct, routes, admin: !!spec.admin });
  try {
    if (go) {
      await page.goto(`${BASE}${go}`);
      if (ready === true) {
        await page.locator('main.page').first().waitFor();
        await page.waitForLoadState('networkidle').catch(() => {});
      }
    }
    // A pop-up that shows by itself on opening ("Game on!") is waited out, so it never covers the picture.
    if (!spec.keepToast) await page.locator('[data-banner]').first().waitFor({ state: 'detached', timeout: 9000 }).catch(() => {});
    if (open) await open(page);
    // Pop-ups go by themselves after a moment: stop the page's clock so this one stays while it is photographed.
    if (freeze) {
      // (If the page's clock has already run past the stop time, try a little later.)
      for (const ahead of [150, 400, 900]) {
        const now = await page.evaluate(() => Date.now());
        try {
          await page.clock.pauseAt(now + ahead);
          break;
        } catch {}
      }
    }
    await page.waitForTimeout(450);
    await page.mouse.move(0, 0).catch(() => {});
    // The same page, light first and then dark (the phone's own light/dark setting is flipped, nothing else changes).
    for (const scheme of SCHEMES) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.waitForTimeout(250);
      const base = `${num}-${name}`;
      const shot = async (suffix, fn) => {
        const file = `${base}${suffix}-${scheme}.png`;
        await savePng(await fn(), path.join(OUT, file));
        files.push(file);
      };
      await shot('', () => page.screenshot({ type: 'png' }));
      const crops = !crop ? [] : Array.isArray(crop) ? crop : [['-crop', crop]];
      for (const [suffix, target] of crops) {
        const loc = typeof target === 'function' ? target(page) : page.locator(target).first();
        if ((await loc.count()) > 0) await shot(suffix, () => loc.screenshot({ type: 'png' }));
        else console.log(`    (no crop target for ${base}${suffix})`);
      }
      if (full) await shot('-full', () => page.screenshot({ type: 'png', fullPage: true }));
    }
  } catch (err) {
    console.log(`  ✗ ${num}-${name}: ${String(err.message).split('\n')[0]}`);
    try {
      await savePng(await page.screenshot({ type: 'png' }), path.join(OUT, `${num}-${name}-FAILED.png`));
    } catch {}
    failures.push(`${num}-${name}: ${String(err.message).split('\n')[0]}`);
    return null;
  } finally {
    await ctx.close();
  }
  manifest.push({ n, section, name, title, who: who || 'nobody picked yet', clock: nice(clockMs) + ' ET', component, files, pct });
  console.log(`  ✓ ${num}-${name}  (${files.length} files)`);
  return n;
}

// ---------------------------------------------------------------------------------------------------------------------
// Chapters: each one starts from a fresh copy of a fake world, so a tap in one chapter never leaks into another.
// ---------------------------------------------------------------------------------------------------------------------
const WORLD_A = '2026-11-12 15:00'; // Thu Nov 12, 3:00 PM Eastern: the pinned "now" of the money and alert world

/** WORLD A: the small preview world (scripts/preview-world-small.ts, the ten fixed names) built as of the pinned moment. */
function buildWorldA() {
  const file = path.join(DATA, 'pg-worldA.template.sqlite');
  mkdirSync(DATA, { recursive: true });
  rmSync(file, { force: true });
  const r = spawnSync('npx', ['vite-node', 'scripts/load-small-local.ts', '--', file, new Date(eastern(WORLD_A)).toISOString()], { cwd: ROOT, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`could not build the fake world: ${r.stderr || r.stdout}`);
  return file;
}

async function chapter(templateFile, at, fn, env = {}) {
  if (process.env.PG_CHAPTER && !new RegExp(process.env.PG_CHAPTER, 'i').test(fn.chapterName || '')) return;
  const db = path.join(DATA, 'pg-chapter.sqlite');
  rmSync(db, { force: true });
  copyFileSync(templateFile, db);
  await startSite(db, env);
  await setClock(eastern(at));
  await signInOrganizer();
  await loadIds();
  await fn();
}

// ---------------------------------------------------------------------------------------------------------------------
// WORLD A scenes: the money and alert screens (read-only first, then the chapters that tap things)
// ---------------------------------------------------------------------------------------------------------------------
const SEC = {
  id: '1. Identity',
  home: '2. Home layout',
  day: '3. Game day',
  money: '4. Money cards and alerts',
  sheet: '5. Sheets and pop-ups',
  extra: '6. Extra: large text',
};
/** Find a game from the organizer's list by its Eastern start ("2026-11-17 19:30") or its note. */
let SESS = [];
const gameAt = (local) => SESS.find((x) => x.startsAt === new Date(eastern(local)).toISOString());
const gameNote = (note) => SESS.find((x) => x.note === note);
const rowSel = (g) => `#row-${g.id}`;
const reload = async () => {
  const d = await loadIds();
  SESS = d.sessions;
  return d;
};

async function scenesAReadOnly() {
  await reload();
  const tonightCourt3 = gameAt('2026-11-12 17:00');
  const tonightRegular = gameAt('2026-11-12 20:00');
  const tonightTbd = gameAt('2026-11-12 21:30');
  const lateFeeTest = gameNote('Late-fee test');
  const feeSplit11 = gameNote('Fee split $11');
  const moved = gameAt('2026-11-17 19:30');
  const standby = gameAt('2026-11-17 20:00');
  const g8 = gameAt('2026-11-24 20:00');
  const thanksgiving = gameAt('2026-11-26 20:00');
  const short = gameAt('2026-11-15 19:30');
  const oneIn = gameAt('2026-11-14 18:00');
  const allPaid = gameNote('All paid');
  const thu = gameAt('2026-11-19 20:00');
  const mixed = gameNote('Mixed payments');
  const decThu = gameAt('2026-12-03 20:00');
  const dec8 = gameAt('2026-12-08 20:00');

  // ---- 1. Identity ----
  await shoot({ section: SEC.id, name: 'who-are-you', title: '"Who are you?": the first visit, no name picked yet, with the organizer sign-in link under the names.', who: null, component: 'PlayerHome.tsx NamePicker, SiteHome.tsx OrganizerLink', crop: '.name-grid' });
  await shoot({
    section: SEC.id, name: 'not-you', title: '"not you?" tapped: the same name list again, with Cancel to go back to your own screen.', who: 'Vic', component: 'PlayerHome.tsx NamePicker (Cancel), Shell.tsx TopBar',
    open: async (page) => { await page.getByRole('button', { name: 'Not you?' }).click(); await page.locator('.name-grid').waitFor(); },
  });
  await shoot({
    section: SEC.id, name: 'add-my-name', title: '"Add my name": typing a name when you are not on the list.', who: null, component: 'PlayerHome.tsx AddMyName',
    open: async (page) => { await page.getByRole('button', { name: 'Add my name' }).click(); await page.getByLabel('Your name').fill('Tatum'); },
    crop: 'form[aria-label="Add my name"]',
  });
  await shoot({
    section: SEC.id, name: 'is-this-you', title: '"Is this you?": the typed name looks like a name already on the list, so the list shows them with "No, I\'m new".', who: null, component: 'PlayerHome.tsx AddMyName',
    open: async (page) => { await page.getByRole('button', { name: 'Add my name' }).click(); await page.getByLabel('Your name').fill('Rowan S'); await page.getByRole('button', { name: 'Continue' }).click(); await page.locator('section[aria-label="Is this you?"]').waitFor(); },
    crop: 'section[aria-label="Is this you?"]',
  });
  await shoot({ section: SEC.id, name: 'bad-link', title: 'A group link that is not valid ("This group link isn\'t valid").', who: null, go: '/g/not-a-real-link-0000000000000000', ready: false, component: 'PlayerHome.tsx (404 branch), ui.tsx Notice',
    open: async (page) => { await page.getByText("This group link isn't valid").waitFor(); }, crop: '.notice, [role="alert"]' });
  await shoot({
    section: SEC.id, name: 'offline-error', title: 'No signal: the error with Try again (the games could not load).', who: 'Vic', ready: false, component: 'ui.tsx ErrorState',
    routes: async (ctx) => { await ctx.route('**/api/group', (r) => r.abort('internetdisconnected')); },
    open: async (page) => { await page.getByText(/No signal/i).waitFor(); },
  });
  await shoot({
    section: SEC.id, name: 'empty-site', title: 'A site with no games at all: "No upcoming sessions yet."', who: 'Vic', component: 'PlayerHome.tsx Empty',
    routes: async (ctx) => {
      await ctx.route('**/api/group', async (r) => {
        const res = await r.fetch();
        const body = await res.json();
        await r.fulfill({ response: res, json: { ...body, sessions: [], owed: [], payDue: [], suggestion: null, afterGame: [], feeNotices: [], extension: undefined } });
      });
    },
    open: async (page) => { await page.getByText('No upcoming sessions yet.').waitFor(); },
  });
  await shoot({
    section: SEC.id, name: 'loading', title: 'The loading skeleton, drawn while the games are still on their way.', who: 'Vic', ready: false, component: 'ui.tsx ScheduleSkeleton',
    routes: async (ctx) => { await ctx.route('**/api/group', () => {}); },
    open: async (page) => { await page.locator('[aria-busy="true"], .skeleton, .sk').first().waitFor().catch(() => {}); },
  });

  await shoot({
    section: SEC.id, name: 'saved-copy', title: 'Opening the site again: the copy of the last screen this phone kept is drawn at once with every button held, until the fresh games arrive.', who: 'Vic', component: 'lastScreen.ts, PlayerHome.tsx SavedScreenView (held cards)',
    open: async (page) => {
      await page.route('**/api/status', () => {});
      await page.route('**/api/group', () => {});
      await page.reload();
      await page.locator('[data-held="yes"]').first().waitFor();
    },
  });

  // ---- 2. Home layout ----
  await shoot({ section: SEC.home, name: 'home-vic', title: 'Home for a player who owes money: the owe card, THIS WEEK, then NEXT WEEK, ending with the "More sessions" button.', who: 'Vic', component: 'PlayerHome.tsx (PayCard, ScheduleRow), Shell.tsx TopBar', full: true });
  await shoot({
    section: SEC.home, name: 'home-later-open', title: 'More sessions tapped: the LATER header and the flat later games, including canceled games and empty games.', who: 'Vic', component: 'PlayerHome.tsx (HOME_COLLAPSE button, ScheduleRow tier later)',
    open: async (page) => { await page.locator('[data-later-toggle]').click(); await page.waitForTimeout(400); await page.locator('[data-later-toggle]').scrollIntoViewIfNeeded(); },
    full: true,
  });
  await shoot({
    section: SEC.home, name: 'home-my-games', title: '"My games" tapped: only the games this player is in.', who: 'Sage', component: 'PlayerHome.tsx GameFilterToggle',
    open: async (page) => { await page.locator('.filter-toggle').first().click(); await page.waitForTimeout(300); }, full: true,
  });
  await shoot({ section: SEC.home, name: 'home-alex-organizer', title: 'The organizer\'s own player page (Alex) as a plain player sees it, "Drop out" on the game he is in.', who: 'Alex', component: 'PlayerHome.tsx', full: true });
  await shoot({
    section: SEC.home, name: 'card-not-in', title: 'A game I am not in: tile, balls, names, I\'m in, and the gray "if 5 play" credit hint.', who: 'Vic', component: 'PlayerHome.tsx ScheduleRow', crop: rowSel(gameAt('2026-11-17 19:30')),
  });
  await shoot({ section: SEC.home, name: 'card-booked-in', title: 'A booked game I am in: "You\'re in", tile check, Calendar and Directions buttons, balls, names, $14 due with Pay, I paid, Drop out.', who: 'Vic', component: 'PlayerHome.tsx ScheduleRow, RowPay, CardButtons.tsx', crop: rowSel(mixed) });
  await shoot({ section: SEC.home, name: 'card-paid', title: '"Paid $14" (paid with cash and confirmed by the organizer): the green Paid pill and Drop out.', who: 'Parker', component: 'PlayerHome.tsx RowPay', crop: rowSel(tonightCourt3) });
  await shoot({ section: SEC.home, name: 'card-self-paid', title: '"Paid $14" that I marked myself, with the small "Didn\'t pay?" link.', who: 'Parker', component: 'PlayerHome.tsx RowPay', crop: rowSel(tonightRegular) });
  await shoot({ section: SEC.home, name: 'card-one-in', title: 'A game with one ball filled and three empty circles (1 in), me in it.', who: 'Vic', component: 'ui.tsx SpotDots', crop: rowSel(oneIn) });
  await shoot({ section: SEC.home, name: 'card-three-in', title: 'A game with 3 of 4 in (three balls, one empty circle).', who: 'Vic', component: 'ui.tsx SpotDots', crop: rowSel(thu) });
  await shoot({ section: SEC.home, name: 'card-eight-in', title: 'A game with 8 in: the balls keep coming on one row, the long names line.', who: 'Zoe', component: 'ui.tsx SpotDots, NamesLine', open: async (page) => { await page.locator('[data-later-toggle]').click(); await page.waitForTimeout(300); }, crop: rowSel(g8) });
  await shoot({ section: SEC.home, name: 'card-short-game', title: 'A 1.5 hour game: the price changes to $11.', who: 'Vic', component: 'PlayerHome.tsx ScheduleRow (short game)', crop: rowSel(short) });
  await shoot({ section: SEC.home, name: 'card-court-waitlist', title: 'The venue has a waitlist for the court: players read "Court not booked" and are in as a normal game.', who: 'Vic', component: 'courtDisplay.ts, PlayerHome.tsx ScheduleRow', crop: rowSel(standby) });
  await shoot({ section: SEC.home, name: 'card-moved', title: 'A moved game (7:00 became 7:30 PM): the tile shows the new time and the blue bar above asks "Still in" or "Can\'t make it".', who: 'Parker', component: 'timeShift.tsx TimeBars, PlayerHome.tsx ScheduleRow', crop: [['-bar', '[data-time-bar]'], ['-crop', rowSel(moved)]] });
  await shoot({ section: SEC.home, name: 'card-extra-game', title: 'An extra game (added by hand): the EXTRA tag under the time and a note pill ("Late-fee test").', who: 'Rowan', component: 'PlayerHome.tsx ScheduleRow, PlayerTile', crop: rowSel(lateFeeTest) });
  await shoot({ section: SEC.home, name: 'card-canceled-fee-split', title: 'A game canceled late with the fee split: "Canceled late. You still owe $11."', who: 'Rowan', component: 'PlayerHome.tsx ScheduleRow (late fee)', crop: rowSel(feeSplit11) });
  await shoot({
    section: SEC.home, name: 'card-canceled-reason', title: 'A canceled game with the organizer\'s reason ("Canceled - Court closed"): "If you paid, it\'s now your credit."', who: 'Parker', component: 'PlayerHome.tsx ScheduleRow (st-canceled)',
    open: async (page) => { await page.locator('[data-later-toggle]').click(); await page.waitForTimeout(300); }, crop: rowSel(thanksgiving),
  });
  await shoot({
    section: SEC.home, name: 'card-thanksgiving', title: 'The Thanksgiving week game: players see no holiday words at all (the holiday note is organizer-only).', who: 'Vic', component: 'PlayerHome.tsx (HolidayPill is organizer-only)',
    open: async (page) => { await page.locator('[data-later-toggle]').click(); await page.waitForTimeout(300); }, crop: rowSel(g8),
  });
  await shoot({
    section: SEC.home, name: 'card-later-open', title: 'A game further out, empty (0 in), booking not open yet: "Court not booked yet".', who: 'Vic', component: 'PlayerHome.tsx ScheduleRow tier later, courtStatus',
    open: async (page) => { await page.locator('[data-later-toggle]').click(); await page.waitForTimeout(300); }, crop: rowSel(dec8),
  });

  // ---- 3. Game day ----
  await shoot({ section: SEC.day, name: 'game-day-court3', title: 'The game day card on a game with a court: TONIGHT tile, "Court 3" and Directions buttons, balls, names.', who: 'Rowan', component: 'GameDay.tsx GameDayButtons, PlayerHome.tsx ScheduleRow', crop: rowSel(tonightCourt3) });
  await shoot({
    section: SEC.day, name: 'game-day-court-map', title: 'Court 3 tapped: the court map with the game\'s court lit.', who: 'Rowan', component: 'GameDay.tsx CourtMap',
    open: async (page) => { await page.locator(`${rowSel(tonightCourt3)} [data-gd-court="3"]`).click(); await page.locator('dialog.cm[open]').waitFor(); await page.waitForTimeout(500); }, crop: 'dialog.cm[open]',
  });
  await shoot({
    section: SEC.day, name: 'game-day-court-tbd', title: '"Court TBD" tapped: the small pop-up "Alex will add it soon."', who: 'Alex', component: 'GameDay.tsx GameDayButtons (gd-pop)', freeze: true,
    open: async (page) => { await page.locator(`${rowSel(tonightRegular)} [data-gd-court="tbd"]`).click(); await page.locator('[data-gd-pop]').waitFor(); }, crop: rowSel(tonightRegular),
  });
  await shoot({ section: SEC.day, name: 'game-day-not-in', title: 'Game day card for a game I am not in (Court TBD, TONIGHT tile, I\'m in).', who: 'Vic', component: 'GameDay.tsx, PlayerHome.tsx ScheduleRow', crop: rowSel(tonightTbd) });
  await shoot({ section: SEC.day, name: 'game-day-started', title: 'A game that started 5 minutes ago (5:05 PM): the card stays up with Court 3 for late arrivals.', who: 'Rowan', clockAt: '2026-11-12 17:05', component: 'GameDay.tsx, PlayerHome.tsx ScheduleRow', crop: rowSel(tonightCourt3), full: true });
  await shoot({ section: SEC.day, name: 'game-day-finished', title: 'After the 5 PM game ended (7:30 PM): the finished game is gone from Home; what is left is tonight\'s other games.', who: 'Rowan', clockAt: '2026-11-12 19:30', component: 'PlayerHome.tsx (ended games are left out by the server)', full: true });
  await setClock(eastern(WORLD_A));

  // ---- 4. Money cards and alerts (read-only looks; the ones that need a tap come later) ----
  await shoot({ section: SEC.money, name: 'owe-two-games', title: '"You owe $28": the owe card for two past unpaid games ("$14 each: Nov 5 and Nov 6"), Pay and I paid.', who: 'Vic', component: 'PlayerHome.tsx PayCard, AlertCard.tsx', crop: '[data-pay-card]' });
  await shoot({ section: SEC.money, name: 'owe-three-games', title: '"You owe $42" for three games: at three, signing up is blocked (the I\'m in buttons are dimmed).', who: 'Zoe', component: 'PlayerHome.tsx PayCard, unpaid-nudge.css', crop: '[data-pay-card]' });
  await shoot({ section: SEC.money, name: 'owe-three-games-blocked-join', title: 'The dimmed I\'m in on a game card while blocked.', who: 'Zoe', component: 'PlayerHome.tsx ScheduleRow (nudge-dim)', crop: rowSel(thu) });
  await shoot({ section: SEC.money, name: 'owe-more-after-redo', title: '"You owe $3 more": a game that owed more after the organizer redid the final price ("final price $14, 4 played").', who: 'Quinn', component: 'PlayerHome.tsx PayCard (oweMoreText), shared/afterGame.ts', crop: '[data-pay-card]' });
  await shoot({ section: SEC.money, name: 'owe-with-credit-and-after-game', title: 'Owe card with "Use credit" (a $8 credit), then the blue "$8 back to your credit" card and the green "Tonight has 4 in" Want in card.', who: 'Rowan', component: 'PlayerHome.tsx PayCard, AfterGameCard, SuggestionCard', crop: [['-owe', '[data-pay-card]'], ['-after-game', '[data-after-game]'], ['-want-in', '[data-suggest-card]']] });
  await shoot({ section: SEC.money, name: 'owe-credit-adjusted', title: 'Owe card carrying the organizer\'s "Credit adjusted: +$5 · Thanks for bringing balls" line.', who: 'Sage', component: 'PlayerHome.tsx PayCard (adjustNote)', crop: '[data-pay-card]' });
  await shoot({ section: SEC.money, name: 'owe-late-fee-and-notice', title: 'Owe card for a late-cancel fee game plus the blue "You no longer owe $14 / Someone took your spot" notice with Dismiss; CASH OUT chip in the header.', who: 'Reese', component: 'PlayerHome.tsx PayCard, FeeNotices, CreditChip', crop: [['-owe', '[data-pay-card]'], ['-notice', '[data-fee-notice]'], ['-chip', '[data-credit-chip]']] });
  await shoot({ section: SEC.money, name: 'owe-long-name', title: 'The longest made-up name ("Christopher Vanderberg") in the header, a $67 owe card over three games and the CREDIT chip.', who: 'Christopher Vanderberg', component: 'Shell.tsx TopBar, PayCard, CreditChip', crop: [['-header', 'header'], ['-owe', '[data-pay-card]']] });
  await shoot({ section: SEC.money, name: 'after-game-credit-back', title: '"$5 back to your credit": the after-game card ("Mon, Nov 9: final price $9, 6 played") with its X.', who: 'Parker', component: 'PlayerHome.tsx AfterGameCard', crop: '[data-after-game]' });
  await shoot({ section: SEC.money, name: 'credit-chip', title: 'The CREDIT chip in the header (only shown when the balance is above zero).', who: 'Parker', component: 'CreditSheet.tsx CreditChip', crop: 'header' });
  await shoot({
    section: SEC.money, name: 'credit-chip-cash-out-pending', title: 'The chip turns into CASH OUT while a cash-out request is waiting.', who: 'Reese', component: 'CreditSheet.tsx CreditChip (pending)', crop: 'header',
  });
  await shoot({
    section: SEC.sheet, name: 'credit-sheet', title: 'The credit sheet: balance, "Request cash out from Alex" and the last 10 credit changes in plain words.', who: 'Parker', component: 'CreditSheet.tsx CreditSheet, ui.tsx Sheet',
    open: async (page) => { await page.locator('[data-credit-chip]').click(); await page.locator('[data-credit-sheet]').waitFor(); await page.waitForTimeout(400); }, crop: 'dialog.sheet[open]',
  });
  await shoot({
    section: SEC.sheet, name: 'credit-sheet-cash-out-pending', title: 'The credit sheet while a cash out is pending: "Cash out requested: $14, pending" and Cancel request.', who: 'Reese', component: 'CreditSheet.tsx (credit-pending)',
    open: async (page) => { await page.locator('[data-credit-chip]').click(); await page.locator('[data-credit-sheet]').waitFor(); await page.waitForTimeout(400); }, crop: 'dialog.sheet[open]',
  });
  await shoot({
    section: SEC.sheet, name: 'credit-sheet-adjusted', title: 'The credit sheet with the organizer\'s hand adjustment line ("Credit adjusted: +$5").', who: 'Sage', component: 'CreditSheet.tsx (credit-adjusted)',
    open: async (page) => { await page.locator('[data-credit-chip]').click(); await page.locator('[data-credit-sheet]').waitFor(); await page.waitForTimeout(400); }, crop: 'dialog.sheet[open]',
  });
  await shoot({
    section: SEC.sheet, name: 'credit-sheet-ask', title: '"Request cash out from Alex" tapped: the amount box with Request and Back.', who: 'Parker', component: 'CreditSheet.tsx (refund-ask)',
    open: async (page) => { await page.locator('[data-credit-chip]').click(); await page.locator('[data-request-refund]').click(); await page.locator('[data-refund-ask]').waitFor(); await page.waitForTimeout(300); }, crop: 'dialog.sheet[open]',
  });
  await shoot({
    section: SEC.sheet, name: 'pay-sheet', title: 'The Pay sheet (Pay tapped): Venmo app link, Copy Venmo handle, the Apple Pay / Zelle / cash line and I paid.', who: 'Vic', component: 'PlayerHome.tsx PaySheet',
    open: async (page) => { await page.locator('[data-pay-card] [data-pay]').click(); await page.locator('[data-pay-sheet]').waitFor(); await page.waitForTimeout(400); }, crop: 'dialog.sheet[open]',
  });
  await shoot({
    section: SEC.sheet, name: 'pay-sheet-row', title: 'The Pay sheet opened from a game card\'s own Pay button ($14).', who: 'Vic', component: 'PlayerHome.tsx PaySheet via RowPay',
    open: async (page) => { await page.locator(`${rowSel(mixed)} a.pay-btn`).click(); await page.locator('[data-pay-sheet]').waitFor(); await page.waitForTimeout(400); }, crop: 'dialog.sheet[open]',
  });
  await shoot({
    section: SEC.sheet, name: 'drop-confirm', title: '"Out for tonight?" confirmation (Drop out tapped): "Your spot opens up for someone else."', who: 'Alex', component: 'PlayerHome.tsx ScheduleRow ConfirmDialog',
    open: async (page) => { await page.locator(`${rowSel(tonightRegular)} .drop-link`).click(); await page.locator('dialog.sheet[open]').waitFor(); await page.waitForTimeout(400); }, crop: 'dialog.sheet[open]',
  });
  await shoot({
    section: SEC.sheet, name: 'drop-confirm-late-fee', title: 'Drop out confirmation past the cancel-by time: the late-fee warning ("You owe $14 unless someone takes your spot").', who: 'Quinn', component: 'PlayerHome.tsx ScheduleRow ConfirmDialog, shared/lateFees.ts',
    open: async (page) => { await page.locator(`${rowSel(lateFeeTest)} .drop-link`).click(); await page.locator('dialog.sheet[open]').waitFor(); await page.waitForTimeout(400); }, crop: 'dialog.sheet[open]',
  });
  await shoot({
    section: SEC.sheet, name: 'blocked-sheet', title: 'Blocked at three unpaid games: "You owe $42 / Pay $42 / Not now".', who: 'Zoe', component: 'PlayerHome.tsx BlockSheet',
    open: async (page) => { await page.locator(`${rowSel(thu)} [data-join]`).click(); await page.locator('[data-nudge-sheet]').waitFor(); await page.waitForTimeout(400); }, crop: 'dialog.sheet[open]',
  });
  await shoot({
    section: SEC.sheet, name: 'calendar-directions', title: 'The Calendar | Directions buttons on a booked game card I am in (a tap opens the phone\'s own Calendar or Maps).', who: 'Vic', component: 'CardButtons.tsx CalendarDirections', crop: `${rowSel(allPaid)}`,
  });
}


/** Taps made through the real buttons (toasts, paid, credit, cash out). Each chapter starts from a fresh copy of the world. */
async function chapterTaps() {
  await reload();
  const moved = gameAt('2026-11-17 19:30');
  const oneIn = gameAt('2026-11-14 18:00');
  const tonightRegular = gameAt('2026-11-12 20:00');
  const tonightTbd = gameAt('2026-11-12 21:30');
  const toastCrop = '[data-banner]';

  await shoot({
    section: SEC.sheet, name: 'cant-make-it-sheet', title: '"Can\'t make it" on the moved-game bar: the same Drop out question, with the button reading "Can\'t make it".', who: 'Parker', component: 'timeShift.tsx TimeBar, PlayerHome.tsx ScheduleRow ConfirmDialog (fromNotice)',
    open: async (page) => { await page.locator('[data-time-bar] .ts-no').click(); await page.locator('dialog.sheet[open]').waitFor(); await page.waitForTimeout(400); }, crop: 'dialog.sheet[open]',
  });
  await shoot({
    section: SEC.money, name: 'still-in-confirmed', title: '"Still in" tapped on the moved-game bar: the button turns into "Confirmed" for a moment before the bar folds away.', who: 'Parker', component: 'timeShift.tsx TimeBar (done)', freeze: true,
    open: async (page) => { await page.locator('[data-time-bar] .ts-yes').click(); await page.locator('[data-time-bar]').getByText('Confirmed').waitFor(); }, crop: '[data-time-bar]',
  });
  await shoot({
    section: SEC.sheet, name: 'toast-error', title: 'A red error pop-up: I\'m in could not reach the site ("That did not work. Try again.").', who: 'Alex', component: 'ui.tsx Banner (pop-error)', keepToast: true, freeze: true,
    routes: async (ctx) => { await ctx.route('**/api/sessions/*/join', (r) => r.abort('failed')); },
    open: async (page) => { await page.locator(`${rowSel(oneIn)} [data-join]`).click(); await page.locator('[data-banner].pop-error').waitFor(); }, crop: toastCrop,
  });
  await shoot({
    section: SEC.sheet, name: 'toast-copied-venmo', title: 'Copy Venmo handle tapped in the Pay sheet: the "Copied @handle" pop-up appears over the sheet.', who: 'Vic', component: 'PlayerHome.tsx PaySheet, ui.tsx Banner', keepToast: true, freeze: true,
    routes: async (ctx) => { await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE }); },
    open: async (page) => { await page.locator('[data-pay-card] [data-pay]').click(); await page.locator('[data-pay-sheet]').waitFor(); await page.locator('[data-copy-venmo]').click(); await page.locator('[data-banner]').waitFor(); }, crop: 'dialog.sheet[open]',
  });
  await shoot({
    section: SEC.sheet, name: 'toast-game-on', title: '"Game on! 4 in": the pop-up when my tap made the 4th player (the pickleball badge).', who: 'Alex', component: 'ui.tsx Banner (ball), PlayerHome.tsx joinToast', keepToast: true, freeze: true,
    open: async (page) => { await page.locator(`${rowSel(moved)} [data-join]`).click(); await page.locator('[data-banner]').waitFor(); }, crop: toastCrop,
  });
  await shoot({
    section: SEC.sheet, name: 'toast-youre-in', title: '"You\'re in" pop-up after tapping I\'m in on a game that still needs players.', who: 'Alex', component: 'ui.tsx Banner, PlayerHome.tsx joinToast', keepToast: true, freeze: true,
    open: async (page) => { await page.locator(`${rowSel(oneIn)} [data-join]`).click(); await page.locator('[data-banner]').waitFor(); }, crop: toastCrop,
  });
  await shoot({
    section: SEC.sheet, name: 'toast-nudge-please-pay', title: 'I\'m in while owing for 1 or 2 past games: the dark "Please pay" pop-up with a Pay button.', who: 'Wren', component: 'ui.tsx Banner (nudge), PlayerHome.tsx joinToast, shared/unpaidNudge.ts', keepToast: true, freeze: true,
    open: async (page) => { await page.locator(`${rowSel(oneIn)} [data-join]`).click(); await page.locator('[data-banner]').waitFor(); }, crop: toastCrop,
  });
  await shoot({
    section: SEC.sheet, name: 'toast-marked-paid', title: 'I paid tapped on the owe card: the "Marked paid" pop-up (the card turns into Paid on the game).', who: 'Zoe', component: 'ui.tsx Banner, PlayerHome.tsx usePaid', keepToast: true, freeze: true,
    open: async (page) => { await page.locator('[data-pay-card] [data-i-paid]').click(); await page.locator('[data-banner]').waitFor(); }, crop: toastCrop,
  });
  await shoot({
    section: SEC.money, name: 'paid-with-credit', title: '"Paid with credit": Use credit tapped with enough credit ($19 covers $14). The row shows Paid with credit and an Undo link; the pop-up says what happened.', who: 'Parker', component: 'PlayerHome.tsx RowPay, useCredit, creditUsedMessage', keepToast: true, freeze: true,
    open: async (page) => { await page.locator(`${rowSel(tonightTbd)} [data-use-credit]`).click(); await page.locator('[data-banner]').waitFor(); }, crop: [['-toast', toastCrop], ['-crop', rowSel(tonightTbd)]],
  });
  await shoot({
    section: SEC.money, name: 'part-credit', title: 'Part credit: Use credit with only $8 of credit on a $14 game: "Credit $8 used" chip and "$6 due".', who: 'Rowan', component: 'PlayerHome.tsx RowPay (chip-credit-used), PayCard', keepToast: true, freeze: true,
    open: async (page) => { await page.locator('[data-pay-card] [data-use-credit]').click(); await page.locator('[data-banner]').waitFor(); }, crop: [['-toast', toastCrop], ['-owe', '[data-pay-card]']],
  });
  await shoot({
    section: SEC.sheet, name: 'toast-drop-undo', title: 'Drop out confirmed: the pop-up says what happens to money and holds a 5 second Undo; the card already shows I\'m in again.', who: 'Alex', component: 'ui.tsx Banner (Undo ring), undoHold.ts, PlayerHome.tsx dropOut', keepToast: true, freeze: true,
    open: async (page) => {
      await page.locator(`${rowSel(tonightRegular)} .drop-link`).click();
      await page.locator('dialog.sheet[open]').getByRole('button', { name: 'Drop out' }).click();
      await page.locator('[data-banner]').waitFor();
    }, crop: [['-toast', toastCrop], ['-crop', rowSel(tonightRegular)]],
  });
  // The page closing sent that drop; put Alex back so nothing later is surprised.
  await call('POST', `/api/admin/sessions/${tonightRegular.id}/me`, { in: true }).catch(() => {});
}
chapterTaps.chapterName = 'taps';

/** Sage asks for her whole $13 credit to be cashed out, then taps I'm in on a game: the cash-out question. */
async function chapterCashOut() {
  await reload();
  const oneIn = gameAt('2026-11-14 18:00');
  await shoot({
    section: SEC.sheet, name: 'toast-cash-out-requested', title: 'Request tapped in the credit sheet: the "Cash out requested" pop-up (the header chip is now CASH OUT).', who: 'Sage', component: 'CreditSheet.tsx, ui.tsx Banner', keepToast: true, freeze: true,
    open: async (page) => {
      await page.locator('[data-credit-chip]').click();
      await page.locator('[data-request-refund]').click();
      await page.locator('[data-refund-ask] button.btn').first().click();
      await page.locator('[data-banner]').waitFor();
    }, crop: [['-toast', '[data-banner]'], ['-header', 'header']],
  });
  await shoot({
    section: SEC.money, name: 'cash-out-prompt', title: '"Use your $13 cash out for this game?": after I\'m in, when a cash out is pending and no other credit covers the game (Use it / No, keep cash out).', who: 'Sage', component: 'CashOutPrompt.tsx', freeze: true,
    open: async (page) => { await page.locator(`${rowSel(oneIn)} [data-join]`).click(); await page.locator('[data-cashout-prompt]').waitFor(); await page.waitForTimeout(300); }, crop: [['-crop', '[data-cashout-prompt]']],
  });
}
chapterCashOut.chapterName = 'cashout';

/** A late drop and a court that opened. */
async function chapterNotes() {
  await reload();
  const lateFeeTest = gameNote('Late-fee test');
  const standby = gameAt('2026-11-17 20:00');
  // Quinn drops out of the game that is already inside its cancel-by time: it would go short, so a late fee is owed.
  const q = await playerApi('Quinn');
  await q.call('POST', `/api/sessions/${lateFeeTest.id}/withdraw`, {});
  await q.ctx.dispose();
  await shoot({ section: SEC.money, name: 'late-fee-owe-card', title: 'A late drop that left the game short: the owe card now reads "You owe $14" with "(late drop)" next to the game, and the game card is back to I\'m in.', who: 'Quinn', component: 'PlayerHome.tsx PayCard (lateFeeLabel), shared/lateFees.ts', crop: [['-owe', '[data-pay-card]'], ['-row', rowSel(lateFeeTest)]] });
  await shoot({ section: SEC.home, name: 'card-dropped-out', title: 'A game I dropped out of: back to the plain I\'m in button.', who: 'Quinn', component: 'PlayerHome.tsx ScheduleRow', crop: rowSel(lateFeeTest) });
  // The venue's waitlist court opens: the three on standby are now simply in a booked game.
  await call('POST', `/api/admin/sessions/${standby.id}/court-status`, { status: 'booked' });

  // Alex marks Reese's pending cash out as sent: Reese sees "Alex sent your $14" with an OK the first time the page opens.
  const req = (await dash()).refundRequests.find((r) => r.playerId === ids.Reese || r.player === 'Reese');
  if (req) {
    await call('POST', `/api/admin/refund-requests/${req.id}`, { action: 'refunded', cents: req.cents ?? req.amountCents });
    await shoot({ section: SEC.sheet, name: 'toast-cash-out-sent', title: 'The organizer sent the cash out: "Alex sent your $14" with an OK button, shown once when the page opens.', who: 'Reese', component: 'PlayerHome.tsx (planCashOut notice), celebrate.ts', keepToast: true, freeze: true,
      open: async (page) => { await page.locator('[data-banner]').waitFor(); }, crop: '[data-banner]' });
  } else console.log('    (no cash-out request found for Reese)');
  await shoot({ section: SEC.home, name: 'card-court-booked', title: 'The same game, Court booked.', who: 'Wren', component: 'PlayerHome.tsx ScheduleRow, courtStatus', crop: rowSel(standby) });
}
chapterNotes.chapterName = 'notes';

/** Extended time: the organizer finalizes tonight's 8 PM game with +30 minutes; players see the alerts. */
async function chapterExtended() {
  await reload();
  const g8 = gameAt('2026-11-12 20:00');
  await setClock(eastern('2026-11-12 22:30'));
  await signInOrganizer();
  // Parker keeps only $2 of credit, so his share of the extra time is part credit.
  const pot = (await dash()).creditLedger.find((l) => l.playerId === ids.Parker);
  await call('POST', `/api/admin/players/${ids.Parker}/credit-adjust`, { direction: 'remove', cents: pot.balanceCents - 200, reason: 'test', seen: pot.balanceCents }, { 'X-Adjust-Credit': 'on' });
  const roster = g8.roster.filter((r) => r.status === 'confirmed').map((r) => r.playerId);
  await call('POST', `/api/admin/sessions/${g8.id}/finalize`, { played: roster, extraMinutes: 30 });
  await reload();
  const next = SESS.filter((x) => Date.parse(x.startsAt) > clockMs && !x.state.flags.canceled).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  await shoot({ section: SEC.money, name: 'extended-owe', title: 'Extended time: "You owe $3 for the extra 30 min" (amber) with the small "Pay now instead" link and the X.', who: 'Vic', component: 'PlayerHome.tsx ExtensionAlerts (owe)', crop: '[data-ext-alert="owe"]' });
  await shoot({ section: SEC.money, name: 'extended-owe-next-game', title: 'The same $3 rides on the next game: "$17 due" with "incl. $3 extension".', who: 'Vic', component: 'PlayerHome.tsx RowPay (inclNote)', crop: '[data-ext-incl]' , full: true });
  await shoot({
    section: SEC.sheet, name: 'extended-pay-now', title: '"Pay now instead" tapped: the Pay sheet for just the $3.', who: 'Vic', component: 'PlayerHome.tsx ExtensionAlerts, PaySheet',
    open: async (page) => { await page.locator('[data-ext-paynow]').click(); await page.locator('[data-pay-sheet]').waitFor(); await page.waitForTimeout(400); }, crop: 'dialog.sheet[open]',
  });
  await shoot({ section: SEC.money, name: 'extended-credit-used', title: 'Extended time: "Your $3 credit was used for ..." (blue, the credit color) for a player whose credit covered the share.', who: 'Christopher Vanderberg', component: 'PlayerHome.tsx ExtensionAlerts (credit)', crop: '[data-ext-alert="credit"]' });
  await shoot({ section: SEC.money, name: 'extended-part-credit', title: 'Extended time, part credit: only $2 of the $3 was covered and the rest is owed.', who: 'Parker', component: 'PlayerHome.tsx ExtensionAlerts (credit and owe)', crop: '[data-ext-alert]' });
  await shoot({ section: SEC.money, name: 'after-game-final-price', title: 'After the game: the Finalize credit-back card and the extension alerts together at the top of Home.', who: 'Parker', component: 'PlayerHome.tsx AfterGameCard, ExtensionAlerts', full: true });
}
chapterExtended.chapterName = 'extended';


/** Seat dots: games with 0 to 10 in, in a row, with and without me (the ring on my own ball). Built on top of world A through the organizer's own buttons. */
async function chapterLadder() {
  await reload();
  const order = ['Vic', 'Parker', 'Wren', 'Rowan', 'Sage', 'Quinn', 'Zoe', 'Reese', 'Christopher Vanderberg', 'Alex'];
  const slots = ['2026-12-05 08:00', '2026-12-05 10:00', '2026-12-05 12:00', '2026-12-05 14:00', '2026-12-05 16:00', '2026-12-05 18:00', '2026-12-06 08:00', '2026-12-06 10:00', '2026-12-06 12:00', '2026-12-06 14:00', '2026-12-06 16:00'];
  const made = [];
  for (let n = 0; n <= 10; n++) {
    const start = eastern(slots[n]);
    const g = await call('POST', '/api/admin/sessions', { startsAt: new Date(start).toISOString(), endsAt: new Date(start + 2 * 3600_000).toISOString(), note: null });
    await call('POST', `/api/admin/sessions/${g.id}/court-status`, { status: 'booked' });
    // Odd counts (and 10) include Vic, the player the picture is taken as, so his own ball shows the "me" ring; even counts do not.
    const pool = n % 2 === 1 || n === 10 ? order : order.filter((x) => x !== 'Vic');
    for (const name of pool.slice(0, n)) {
      if (name === 'Alex') await call('POST', `/api/admin/sessions/${g.id}/me`, { in: true });
      else await call('POST', `/api/admin/sessions/${g.id}/roster`, { playerId: ids[name], action: 'confirm' });
    }
    made.push(g.id);
  }
  const open = async (page) => { await page.locator('[data-later-toggle]').click(); await page.waitForTimeout(400); await page.locator(`#row-${made[0]}`).scrollIntoViewIfNeeded(); };
  await shoot({ section: SEC.home, name: 'seat-dots-0-to-10', title: 'Seat dots in every look: games with 0, 1, 2 ... 10 in (empty dashed ring, filled ball, the ring on MY ball, balls past four on one row). Whole page.', who: 'Vic', component: 'ui.tsx SpotDots, EmptySeat, Pickleball; seat-dots.css; zip10.css', open, full: true });
  await shoot({ section: SEC.home, name: 'seat-dots-rows', title: 'The same games, one close-up each: 0 to 10 in (even counts: I am not in; odd counts and 10: I am in, so my ball has the ring).', who: 'Vic', component: 'ui.tsx SpotDots', open, crop: made.map((id, n) => [`-n${String(n).padStart(2, '0')}`, `#row-${id}`]) });
}
chapterLadder.chapterName = 'ladder';

/** The rest of "Identity": adding a name, an empty My games, link-only, the group word and a removed name. Built on top of world A. */
async function chapterIdentity() {
  await reload();
  await shoot({
    section: SEC.id, name: 'add-name-days', title: 'Add my name, last step: "Any preferred days?" (Tuesday, Thursday, Both, Skip). The made-up name Tatum exists only in this local picture world.', who: null, component: 'PlayerHome.tsx AddMyName (days)',
    open: async (page) => {
      await page.getByRole('button', { name: 'Add my name' }).click();
      await page.getByLabel('Your name').fill('Tatum');
      await page.getByRole('button', { name: 'Continue' }).click();
      await page.locator('section[aria-label="Preferred days"]').waitFor();
    }, crop: 'section[aria-label="Preferred days"]',
  });
  await reload();
  await shoot({
    section: SEC.home, name: 'my-games-empty', title: '"My games" for someone who is in no game yet: "You\'re not in any games yet" and See all games.', who: 'Tatum', component: 'PlayerHome.tsx (empty-mine)',
    open: async (page) => { await page.locator('.filter-toggle').first().click(); await page.locator('.empty-mine').waitFor(); }, crop: '.empty-mine',
  });
  // Link only: the plain address asks for the organizer's link.
  await call('PUT', '/api/admin/group', { openAccess: false });
  await shoot({ section: SEC.id, name: 'link-only', title: 'The group is set to link-only: the plain address says "Open the link your organizer sent you."', who: null, ready: false, component: 'SiteHome.tsx LinkOnly',
    open: async (page) => { await page.getByText('Open the link your organizer sent you').waitFor(); } });
  // Group word.
  await call('PUT', '/api/admin/group', { openAccess: true, groupWord: 'pickle' });
  await shoot({ section: SEC.id, name: 'group-word', title: 'The organizer set a group word: asked once per phone ("What\'s the group word?").', who: null, ready: false, component: 'SiteHome.tsx GroupWord',
    open: async (page) => { await page.getByText("What's the group word?").waitFor(); } });
  await call('PUT', '/api/admin/group', { groupWord: null });
  // A removed name: Vic's phone still remembers him, then the organizer removes him.
  await shoot({
    section: SEC.id, name: 'name-removed', title: 'A name that was removed by the organizer: the phone falls back to "Who are you?" and the name is gone from the list.', who: null, go: null, component: 'PlayerHome.tsx NamePicker',
    open: async (page) => {
      await page.context().request.post(`${BASE}/api/me`, { data: { playerId: ids.Tatum }, headers: { Origin: BASE } });
      await call('DELETE', `/api/admin/players/${ids.Tatum}`);
      await page.goto(`${BASE}/`);
      await page.locator('.name-grid').waitFor();
    }, crop: '.name-grid',
  });
}
chapterIdentity.chapterName = 'identity';

/** A brand new site nobody has set up. */
async function chapterNotSetUp() {
  if (process.env.PG_CHAPTER && !/notsetup/i.test(process.env.PG_CHAPTER)) return;
  const db = path.join(DATA, 'pg-empty.sqlite');
  rmSync(db, { force: true });
  await startSite(db);
  await setClock(eastern(WORLD_A));
  await shoot({ section: SEC.id, name: 'not-set-up', title: 'A site nobody has set up yet: "Nobody has set up this site yet" and Set up the group.', who: null, ready: false, component: 'SiteHome.tsx NotSetUp',
    open: async (page) => { await page.getByText('Nobody has set up this site yet').waitFor(); } });
}

/** Large text: ONE picture each at 125% and 150% text size, for Home and for the money card. */
async function chapterLargeText() {
  await reload();
  for (const pct of [125, 150]) {
    await shoot({ section: SEC.extra, name: `large-text-${pct}-home`, title: `Home at ${pct}% text size (a large-text safety check for the skin), as a player with the owe card, credit and games.`, who: 'Rowan', pct, component: 'large-text.css and every Home card', full: true });
    await shoot({ section: SEC.extra, name: `large-text-${pct}-money-card`, title: `The money card at ${pct}% text size: owe card, Use credit, Pay.`, who: 'Rowan', pct, component: 'PlayerHome.tsx PayCard, alert-cards.css', crop: [['-owe', '[data-pay-card]'], ['-after-game', '[data-after-game]']] });
  }
}
chapterLargeText.chapterName = 'largetext';


// ---------------------------------------------------------------------------------------------------------------------
// INDEX.md
// ---------------------------------------------------------------------------------------------------------------------
const NOT_REACHED = [
  '"Good news, a spot opened up" (the green note after a waitlist spot or an opened court): the site only sends it when a game has a waitlist, and "Card cleanup" (ON on live) removed waitlists, so a player can never see it on the current site. The look is in the code (goodNews.ts, AlertCard tone green, class ac-inline) but nothing can draw it today.',
  'Second Chance revived-game card: Second Chance is organizer-only (cards on admin Home). A player never gets a card of its own; a reopened game just reads as a normal game (and as the blue moved-game bar if its time changed, see the moved-game pictures).',
  'Thanksgiving / holiday hours: players see no holiday words at all (the holiday note is organizer-only), so the game on Thanksgiving week looks like any other game (picture "card-thanksgiving").',
  'Waitlist circles in the seat dots: with Card cleanup ON there is no waitlist, so the seat dots only have an empty ring, a ball and the ring on my own ball.',
  'A part-credit alert for Extended time with a share the credit covers exactly is shown by the credit-used picture; a "$17 due" game with part credit is the same card with the credit chip added (picture "part-credit").',
  'Add to calendar: it is the Calendar half of the Calendar | Directions button (a download the phone handles); there is no screen of ours behind it. Directions likewise opens Apple or Google Maps.',
  'The organizer-only screens (/admin, Setup, Go page, View as bars) are skipped on purpose: they never get the skin.',
];

function writeIndex() {
  const bySection = new Map();
  for (const m of manifest) bySection.set(m.section, [...(bySection.get(m.section) ?? []), m]);
  const sections = [...bySection.keys()].sort();
  const total = manifest.reduce((n, m) => n + m.files.length, 0);
  const lines = [
    '# Player screen gallery (Zip 36)',
    '',
    'Pictures of every PLAYER-side screen and state of the site as it is today, in light and dark, to design the Christmas skin on. Admin screens are not here.',
    '',
    `- Phone: iPhone Air size, ${VIEW.width} x ${VIEW.height} CSS px, ${SCALE}x (${VIEW.width * SCALE} x ${VIEW.height * SCALE} pixels), PNG. Real header, real fonts, real buttons.`,
    '- File names: `NN-name-light.png` / `NN-name-dark.png` is the whole screen. `NN-name-crop-light.png` (or another word after the name, like `-owe` or `-toast`) is a tight crop of just that card or sheet. `NN-name-full-light.png` is the whole scrolling page.',
    '- Made by `node e2e/player-gallery.cjs` on a throwaway fake group on this computer. It never touches the live site or the shared preview database. Fake names only (docs/PREVIEW_FAKE_DB.md): Alex (organizer), Vic, Wren, Zoe, Quinn, Rowan, Parker, Reese, Sage and Christopher Vanderberg. The two screens that add a new name use the made-up name Tatum, in this picture world only.',
    '- Every Settings switch that is ON on live is ON here (the same list the preview uses), plus Extended time. Calm mode is off, so every alert shows, as on live.',
    '- Two clocks: "Thu Nov 12, 3:00 PM" for most pictures; a few move it (noted per picture). All times are Eastern, 12-hour.',
    `- ${manifest.length} screens, ${total} picture files.`,
    '',
  ];
  for (const sec of sections) {
    const rows = bySection.get(sec).sort((a, b) => a.n - b.n);
    lines.push(`## ${sec} (${rows.length})`, '');
    for (const m of rows) {
      const num = String(m.n).padStart(2, '0');
      lines.push(`### ${num} ${m.name}`, '', m.title, '', `- Seen as: ${m.who}. Clock: ${m.clock}.${m.pct !== 100 ? ` Text size ${m.pct}%.` : ''}`, `- Drawn by: ${m.component}`, `- Files: ${m.files.filter((f) => f.endsWith('-light.png')).map((f) => '`' + f.replace('-light.png', '-{light,dark}.png') + '`').join(', ')}`, '');
    }
  }
  lines.push('## States not reached, and why', '');
  for (const t of NOT_REACHED) lines.push(`- ${t}`);
  if (failures.length) lines.push('', '## Pictures that failed on this run', '', ...failures.map((f) => `- ${f}`));
  lines.push('');
  writeFileSync(path.join(OUT, 'INDEX.md'), lines.join('\n'));
}

async function main() {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  browser = await playwright.chromium.launch();
  const a = buildWorldA();
  const readOnly = async () => {
    console.log('World A: read-only screens');
    await scenesAReadOnly();
  };
  readOnly.chapterName = 'readonly';
  await chapter(a, WORLD_A, readOnly);
  for (const fn of [chapterTaps, chapterCashOut, chapterNotes, chapterExtended, chapterLadder, chapterIdentity, chapterLargeText]) await chapter(a, WORLD_A, fn, {});
  await chapterNotSetUp();
  await browser.close();
  await stopSite();
  writeIndex();
  const bytes = readdirSync(OUT).reduce((sum, f) => sum + statSync(path.join(OUT, f)).size, 0);
  console.log(`${manifest.length} screens, ${readdirSync(OUT).filter((f) => f.endsWith('.png')).length} pictures, ${(bytes / 1e6).toFixed(1)} MB in ${path.relative(ROOT, OUT)}`);
  if (failures.length) console.log(`FAILED:\n  ${failures.join('\n  ')}`);
  process.exit(0);
}

if (require.main === module) {
  main().catch(async (err) => {
    console.error(err);
    await stopSite();
    process.exit(1);
  });
}
