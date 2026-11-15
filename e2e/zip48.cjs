/* Zip 48 (🎾48.speedsplit): the organizer screens are their own file. Browser checks on the REAL BUILT site (not the dev server), main's
 * build and this branch's build side by side on the same fake world:
 *
 *   node e2e/zip48.cjs                 builds both (main from a throw-away git worktree of origin/main), then checks
 *   Z48_MAIN_DIST=<dir> node e2e/zip48.cjs     use an already built main instead
 *   E2E_SHOTS=<folder>                 keeps the pictures
 *   Z48_SIZES=390 Z48_SCHEMES=light    fewer sizes; Z48_ONLY=<regex> only the checks whose names match
 *
 * Not in the full run (e2e/suite.cjs): like zip23-off it needs a second checkout (main's build). Started by hand; about 10 minutes.
 *
 * 1. Same look: player screens (Who are you?, a player's Home, the credit sheet, the Christmas skin) and organizer screens (Home, Players,
 *    Money, History, Settings, a game menu, the Players sheet, View as), 390 / 360 / 320 px, light and dark: every element's place, size,
 *    words and computed style are the same on main and on the branch.
 * 2. Players never download the organizer files, and no organizer style rule matches anything on a player screen.
 * 3. /admin: admin.html starts the organizer files at once; nothing blank, no loading flash on the organizer's phone.
 * 4. The organizer's phone fetches the organizer file quietly on its player screen; "Go to Admin" then draws at once.
 * 5. Deep links all open.
 * 6. An old page whose organizer file is gone reloads once and opens Admin; a second failure shows Try again (no loop).
 * 7. No signal: Try again screen, never blank; back online it opens by itself. A style file that failed is fetched again.
 *
 * The local servers copy Cloudflare Pages' rules that matter here: /admin serves admin.html, a missing /assets/ file is a real 404, any
 * other address gets the page. /api goes to a dev server on the small fake world (Thu Nov 12, 2026, 3:00 PM Eastern). Nothing here
 * touches Cloudflare or the live site.
 */
const { spawn, spawnSync } = require('node:child_process');
const { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.E2E_PORT) || 5480;
const API = `http://localhost:${PORT}`;
const BRANCH = `http://localhost:${PORT + 1}`;
const MAIN = `http://localhost:${PORT + 2}`;
const SEED_ISO = '2026-11-12T20:00:00.000Z'; // Thu Nov 12, 3:00 PM Eastern
const NOW_MS = Date.parse(SEED_ISO);
const SHOTS = process.env.E2E_SHOTS || '';
const PIN = /PIN `(\d{6})`/.exec(readFileSync(path.join(ROOT, 'docs/PREVIEW_FAKE_DB.md'), 'utf8'))[1];
const SIZES = (process.env.Z48_SIZES || '390,360,320').split(',').map(Number);
const SCHEMES = (process.env.Z48_SCHEMES || 'light,dark').split(',');

let passed = 0;
let failed = 0;
const ONLY = process.env.Z48_ONLY ? new RegExp(process.env.Z48_ONLY) : null;
async function check(name, fn) {
  if (ONLY && !ONLY.test(name)) return;
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

function liveVars() {
  const toml = readFileSync(path.join(ROOT, 'wrangler.toml'), 'utf8');
  const top = toml.slice(toml.indexOf('[vars]'), toml.indexOf('[env.preview]'));
  const out = {};
  for (const m of top.matchAll(/^([A-Z_][A-Z0-9_]*)\s*=\s*"([^"]*)"/gm)) if (m[1] !== 'SITE_URL') out[m[1]] = m[2];
  return out;
}

function viteBuild(cwd, outDir) {
  const r = spawnSync(process.execPath, [path.join(cwd, 'node_modules/vite/bin/vite.js'), 'build', '--outDir', outDir, '--emptyOutDir', '--logLevel', 'error'], {
    cwd,
    env: { ...process.env, NODE_ENV: 'production', APP_BUILD: `zip48-${path.basename(outDir)}` },
    encoding: 'utf8',
  });
  if (r.status !== 0) throw new Error(`build failed in ${cwd}: ${r.stderr || r.stdout}`);
}

function buildMain() {
  if (process.env.Z48_MAIN_DIST) return process.env.Z48_MAIN_DIST;
  const wt = path.join(ROOT, '.data', 'zip48-main-wt');
  // Built copies go to the system temp folder (a copy under the project would be read by tests that scan every file).
  const out = path.join(os.tmpdir(), 'zip48-main-dist');
  spawnSync('git', ['worktree', 'remove', '--force', wt], { cwd: ROOT });
  rmSync(wt, { recursive: true, force: true });
  const add = spawnSync('git', ['worktree', 'add', '--detach', wt, 'origin/main'], { cwd: ROOT, encoding: 'utf8' });
  if (add.status !== 0) throw new Error(`git worktree: ${add.stderr}`);
  symlinkSync(path.join(ROOT, 'node_modules'), path.join(wt, 'node_modules'));
  try {
    viteBuild(wt, out);
  } finally {
    spawnSync('git', ['worktree', 'remove', '--force', wt], { cwd: ROOT });
  }
  return out;
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.woff2': 'font/woff2', '.wasm': 'application/wasm', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain' };

/** A small stand-in for Cloudflare Pages: the files, /admin -> admin.html, missing /assets/ = 404, else the page; /api to the dev server. */
function staticServer(dir, port) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/__dev/')) {
      const p = http.request(`${API}${req.url}`, { method: req.method, headers: req.headers }, (r) => {
        res.writeHead(r.statusCode, r.headers);
        r.pipe(res);
      });
      p.on('error', () => {
        res.statusCode = 502;
        res.end();
      });
      req.pipe(p);
      return;
    }
    let file = path.join(dir, decodeURIComponent(url.pathname));
    const send = (f, status = 200) => {
      res.writeHead(status, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream', 'Cache-Control': f.includes('/assets/') && status === 200 ? 'public, max-age=31536000, immutable' : 'no-cache' });
      res.end(req.method === 'HEAD' ? undefined : readFileSync(f));
    };
    if (url.pathname !== '/' && existsSync(file) && !file.endsWith('/')) return send(file);
    if (/^\/admin\/?$/.test(url.pathname) && existsSync(path.join(dir, 'admin.html'))) return send(path.join(dir, 'admin.html'));
    if (url.pathname.startsWith('/assets/')) return send(path.join(dir, 'assets/404.html'), 404);
    file = path.join(dir, 'index.html');
    return send(file);
  });
  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}

async function main() {
  const dbFile = path.join(ROOT, '.data', `zip48-${PORT}.sqlite`);
  mkdirSync(path.join(ROOT, '.data'), { recursive: true });
  if (SHOTS) mkdirSync(SHOTS, { recursive: true });
  console.log('Building the branch and main...');
  const branchDist = path.join(os.tmpdir(), 'zip48-branch-dist');
  viteBuild(ROOT, branchDist);
  const mainDist = buildMain();
  assert(existsSync(path.join(branchDist, 'admin.html')), 'branch build has no admin.html');
  rmSync(dbFile, { force: true });
  const seeded = spawnSync('npx', ['vite-node', 'scripts/load-small-local.ts', '--', dbFile, SEED_ISO], { cwd: ROOT, encoding: 'utf8' });
  if (seeded.status !== 0) throw new Error(`could not build the fake world: ${seeded.stderr || seeded.stdout}`);
  if (await fetch(`${API}/api/status`).then((r) => r.ok, () => false)) throw new Error(`port ${PORT} is already in use`);
  const dev = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
    cwd: ROOT,
    env: { ...process.env, ...liveVars(), DEV_DB: dbFile, SETUP_TOKEN: 'zip48-setup-token-0123456789', DEV_CLOCK: '1', PREVIEW_CALM: 'on', CHRISTMAS_SKIN_PREVIEW: 'on', GAME_DAY_TEXT_PREVIEW: 'on' },
    stdio: 'ignore',
    detached: true,
  });
  process.on('exit', () => {
    try {
      process.kill(-dev.pid, 'SIGTERM');
    } catch {}
  });
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(`${API}/api/status`)).ok) break;
    } catch {}
    await sleep(500);
  }
  await fetch(`${API}/__dev/clock`, { method: 'POST', body: JSON.stringify({ atMs: NOW_MS }) });
  const servers = [await staticServer(branchDist, PORT + 1), await staticServer(mainDist, PORT + 2)];
  const browser = await chromium.launch();

  const adminCss = readFileSync(path.join(branchDist, 'assets', readdirSync(path.join(branchDist, 'assets')).find((f) => /^AdminEntry-.*\.css$/.test(f))), 'utf8');
  const mainCss = readFileSync(path.join(branchDist, 'assets', readdirSync(path.join(branchDist, 'assets')).find((f) => /^index-.*\.css$/.test(f))), 'utf8');

  async function phone(base, width, scheme, { organizer = false } = {}) {
    const ctx = await browser.newContext({ viewport: { width, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, colorScheme: scheme, reducedMotion: 'reduce' });
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
    if (organizer) {
      const r = await ctx.request.post(base + '/api/admin/login', { data: { pin: PIN }, headers: { Origin: base } });
      assert(r.ok(), `sign in ${r.status()}`);
    }
    const page = await ctx.newPage();
    page.errors = [];
    page.on('pageerror', (e) => page.errors.push(String(e)));
    page.requests = [];
    page.on('request', (r) => page.requests.push(r.url()));
    return { ctx, page };
  }

  const settle = async (page) => {
    await page.evaluate(() => document.fonts.ready);
    await sleep(700);
    await page.addStyleTag({ content: '*, *::before, *::after { animation: none !important; transition: none !important; caret-color: transparent !important; }' });
    await sleep(250);
  };

  /** Every visible element: tag, classes, its own words, box, and its full computed style (plus ::before and ::after). */
  const snapshot = (page) =>
    page.evaluate(() => {
      const out = [];
      const props = (cs) => {
        const o = {};
        for (let i = 0; i < cs.length; i++) o[cs[i]] = cs.getPropertyValue(cs[i]);
        return o;
      };
      const roots = [...document.querySelectorAll('body *')].filter((e) => !['SCRIPT', 'STYLE', 'LINK'].includes(e.tagName));
      for (const el of roots) {
        const r = el.getBoundingClientRect();
        const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join(' ');
        out.push({
          k: `${el.tagName.toLowerCase()}.${[...el.classList].join('.')}`,
          t: own.replace(/Updated .*/, 'Updated').replace(/localhost:\d+/g, 'localhost'),
          b: [r.x, r.y, r.width, r.height].map((v) => Math.round(v * 10) / 10).join(','),
          s: props(getComputedStyle(el)),
          a: getComputedStyle(el, '::before').content + '|' + getComputedStyle(el, '::after').content,
        });
      }
      return out;
    });

  function diff(a, b) {
    if (a.length !== b.length) return `element count ${a.length} (branch) vs ${b.length} (main)`;
    for (let i = 0; i < a.length; i++) {
      const x = a[i];
      const y = b[i];
      if (x.k !== y.k) return `#${i} ${x.k} vs ${y.k}`;
      if (x.t !== y.t) return `#${i} ${x.k} words "${x.t}" vs "${y.t}"`;
      if (x.b !== y.b) return `#${i} ${x.k} box ${x.b} vs ${y.b}`;
      if (x.a !== y.a) return `#${i} ${x.k} before/after ${x.a} vs ${y.a}`;
      for (const p of Object.keys(y.s)) if (x.s[p] !== y.s[p] && !ROOT_VARS.has(p)) return `#${i} ${x.k} ${p}: ${x.s[p]} vs ${y.s[p]}`;
    }
    return null;
  }

  const ROOT_VARS = new Set();
  /** Organizer-only style rules (in the organizer file, not in the player file) that match anything on the page right now. */
  const adminOnly = (() => {
    const split = (css) => {
      const out = [];
      let depth = 0;
      let start = 0;
      for (let i = 0; i < css.length; i++) {
        if (css[i] === '{') depth++;
        else if (css[i] === '}' && --depth === 0) {
          out.push(css.slice(start, i + 1));
          start = i + 1;
        }
      }
      return out;
    };
    const main = new Set(split(mainCss));
    const sels = [];
    // A rule on the page root that only SETS custom properties (--name) cannot change the player screen unless the player style reads them.
    // (Those properties are also left out of the before/after comparison: they exist on main's player page and not on the branch's, by design.)
    const rootOnlyVars = (rule) => /^(:root|html)([:\[][^{ >+~]*)?\{/.test(rule) && rule.slice(rule.indexOf('{') + 1, -1).split(';').filter(Boolean).every((d) => d.trim().startsWith('--'));
    for (const r of split(adminCss).filter((x) => !main.has(x))) {
      const walk = (rule) => {
        if (rule.startsWith('@media') || rule.startsWith('@supports')) return split(rule.slice(rule.indexOf('{') + 1, rule.lastIndexOf('}'))).forEach(walk);
        if (rule.startsWith('@')) return;
        if (rootOnlyVars(rule)) {
          for (const v of rule.match(/--[\w-]+(?=\s*:)/g) || []) ROOT_VARS.add(v);
          for (const v of rule.match(/--[\w-]+(?=\s*:)/g) || []) if (mainCss.includes(`var(${v}`)) throw new Error(`the player style reads ${v}, which only the organizer file sets`);
          return;
        }
        sels.push(rule.slice(0, rule.indexOf('{')));
      };
      walk(r);
    }
    return sels;
  })();
  const adminRulesMatching = (page) =>
    page.evaluate((sels) => {
      const hits = new Set();
      for (const s of sels)
        for (const one of s.split(/,(?![^(]*\))/)) {
          // Hover, focus and the like: test the element itself without them (could it ever match?). ::before/::after: the element.
          const plain = one.replace(/::?(before|after|placeholder|marker|backdrop|-webkit-[\w-]+)/g, '').replace(/:(hover|focus|focus-visible|focus-within|active|visited|checked|disabled|enabled|placeholder-shown)\b/g, '').trim() || '*';
          try {
            if (document.querySelector(plain)) hits.add(one);
          } catch {
            /* a selector this browser cannot read: skipped */
          }
        }
      return [...hits];
    }, adminOnly);

  // ---------- 1 and 2: player screens, main vs branch ----------
  console.log(`Player screens (${adminOnly.length} organizer-only selectors checked on each)...`);
  const playerScenes = [
    { name: 'Who are you?', url: '/', ready: (p) => p.getByText('Who are you?').first().waitFor({ timeout: 30000 }) },
    { name: "Parker's Home", url: '/?as=Parker', ready: (p) => p.locator('.schedule article.sched').first().waitFor({ timeout: 30000 }) },
    {
      name: "Reese's credit sheet",
      url: '/?as=Reese',
      ready: async (p) => {
        await p.locator('.schedule article.sched').first().waitFor({ timeout: 30000 });
        await p.locator('[data-credit-chip]').first().click();
        await p.locator('[data-credit-history]').first().waitFor({ timeout: 10000 });
      },
    },
    { name: 'Christmas skin (Everyone, Dec 5)', url: '/?as=Rowan&xmasmode=all&xmasdate=2026-12-05', ready: (p) => p.locator('.schedule article.sched').first().waitFor({ timeout: 30000 }) },
  ];
  for (const scheme of SCHEMES)
    for (const width of SIZES)
      for (const scene of playerScenes) {
        await check(`player ${scene.name}, ${width} px ${scheme}: same as main, no organizer file, no organizer rule matches`, async () => {
          const snaps = [];
          for (const base of [BRANCH, MAIN]) {
            const { ctx, page } = await phone(base, width, scheme);
            try {
              await page.goto(base + scene.url);
              await scene.ready(page);
              await settle(page);
              snaps.push(await snapshot(page));
              if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `player-${scene.name.replace(/\W+/g, '_')}-${width}-${scheme}-${base === BRANCH ? 'branch' : 'main'}.png`), fullPage: true });
              if (base === BRANCH) {
                const admin = page.requests.filter((u) => /AdminEntry|zip11-/.test(u));
                assert(admin.length === 0, `player downloaded ${admin.join(', ')}`);
                const hits = await adminRulesMatching(page);
                assert(hits.length === 0, `organizer rules match here: ${hits.slice(0, 6).join(' | ')}`);
              }
              assert(page.errors.length === 0, page.errors.join(' | '));
            } finally {
              await ctx.close();
            }
          }
          const d = diff(snaps[0], snaps[1]);
          assert(!d, d);
        });
      }

  // ---------- 1: organizer screens, main vs branch ----------
  console.log('Organizer screens...');
  const tab = (name) => async (p) => {
    await p.locator('nav.tabbar button', { hasText: name }).click();
    await sleep(400);
  };
  const adminScenes = [
    { name: 'Home', act: async () => {} },
    { name: 'Players', act: tab('Players') },
    { name: 'Money', act: tab('Money') },
    { name: 'History', act: tab('History') },
    { name: 'Settings', act: tab('Settings') },
    {
      name: 'game menu',
      act: async (p) => {
        await p.locator('[aria-label^="Game menu for"]').first().click();
        await p.locator('[role="menu"], .menu-pop').first().waitFor({ timeout: 10000 });
      },
    },
    {
      name: 'Players sheet',
      act: async (p) => {
        await p.locator('[aria-label^="Game menu for"]').first().click();
        await p.getByRole('menuitem', { name: /^Players/ }).first().click();
        await p.locator('dialog[open]').first().waitFor({ timeout: 10000 });
        await sleep(400);
      },
    },
    {
      name: 'View as Parker',
      act: async (p) => {
        await p.getByRole('button', { name: /^View as/ }).first().click();
        await p.locator('dialog[open]').getByRole('button', { name: /^Parker/ }).first().click();
        await p.locator('.schedule article.sched').first().waitFor({ timeout: 30000 });
        await sleep(600);
      },
    },
  ];
  for (const scheme of SCHEMES)
    for (const width of SIZES)
      for (const scene of adminScenes) {
        await check(`organizer ${scene.name}, ${width} px ${scheme}: same as main`, async () => {
          const snaps = [];
          for (const base of [BRANCH, MAIN]) {
            const { ctx, page } = await phone(base, width, scheme, { organizer: true });
            try {
              await page.goto(base + '/admin');
              await page.locator('nav.tabbar').waitFor({ timeout: 30000 });
              await settle(page);
              await scene.act(page);
              await settle(page);
              snaps.push(await snapshot(page));
              if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `admin-${scene.name.replace(/\W+/g, '_')}-${width}-${scheme}-${base === BRANCH ? 'branch' : 'main'}.png`), fullPage: true });
              assert(page.errors.length === 0, page.errors.join(' | '));
            } finally {
              await ctx.close();
            }
          }
          const d = diff(snaps[0], snaps[1]);
          assert(!d, d);
        });
      }

  // ---------- 3, 4: /admin opening, the organizer phone ----------
  /** Records whether the loading screen or a blank page ever showed after the first draw. */
  const watchFlash = (ctx) =>
    ctx.addInitScript(() => {
      window.__flash = { spinner: false, blankAfterDraw: false, drawn: false };
      new MutationObserver(() => {
        const root = document.getElementById('root');
        if (!root) return;
        if (root.childElementCount > 0) window.__flash.drawn = true;
        else if (window.__flash.drawn) window.__flash.blankAfterDraw = true;
        if (document.querySelector('.spinner, .admin-loading')) window.__flash.spinner = true;
      }).observe(document, { childList: true, subtree: true });
    });

  await check('/admin serves admin.html: organizer files start at once, style after the main style, dashboard draws, no blank after the first draw', async () => {
    const { ctx, page } = await phone(BRANCH, 390, 'light', { organizer: true });
    await watchFlash(ctx);
    await page.goto(BRANCH + '/admin');
    await page.locator('nav.tabbar').waitFor({ timeout: 30000 });
    const links = await page.evaluate(() => [...document.querySelectorAll('link')].map((l) => `${l.rel} ${l.getAttribute('href')}`));
    assert(links.some((l) => /^modulepreload \/assets\/AdminEntry-/.test(l)), links.join(' | '));
    const css = links.filter((l) => l.startsWith('stylesheet'));
    assert(css.length === 2 && /index-/.test(css[0]) && /AdminEntry-/.test(css[1]), `style files: ${css.join(' | ')}`);
    const f = await page.evaluate(() => window.__flash);
    assert(!f.blankAfterDraw, 'went blank after the first draw');
    assert(page.errors.length === 0, page.errors.join(' | '));
    await ctx.close();
  });

  await check('Instant admin: the second open draws the saved screen with no loading screen at all', async () => {
    const { ctx, page } = await phone(BRANCH, 390, 'light', { organizer: true });
    await page.goto(BRANCH + '/admin?lastscreenadmin=on');
    await page.locator('nav.tabbar').waitFor({ timeout: 30000 });
    await sleep(1500);
    const saved = await page.evaluate(() => !!localStorage.getItem('pb_last_admin'));
    await watchFlash(ctx);
    await page.goto(BRANCH + '/admin');
    await page.locator('nav.tabbar').waitFor({ timeout: 30000 });
    const f = await page.evaluate(() => window.__flash);
    assert(saved, 'no saved copy was kept (Instant admin)');
    assert(!f.spinner, 'the loading screen showed');
    assert(!f.blankAfterDraw, 'went blank after the first draw');
    await ctx.close();
  });

  await check("organizer's phone: the player screen fetches the organizer file quietly; Go to Admin then draws with no loading screen", async () => {
    const { ctx, page } = await phone(BRANCH, 390, 'light', { organizer: true });
    await page.goto(BRANCH + '/admin');
    await page.locator('nav.tabbar').waitFor({ timeout: 30000 });
    assert(await page.evaluate(() => localStorage.getItem('pb_organizer_phone') === '1'), 'organizer phone flag not set');
    await page.goto(BRANCH + '/?as=Alex');
    await page.locator('.schedule article.sched').first().waitFor({ timeout: 30000 });
    page.requests = [];
    await sleep(4500);
    assert(page.requests.some((u) => /AdminEntry-.*\.js/.test(u)), 'no background fetch of the organizer file');
    await page.evaluate(() => {
      window.__sawSpinner = false;
      new MutationObserver(() => {
        if (document.querySelector('.spinner, .admin-loading')) window.__sawSpinner = true;
      }).observe(document, { childList: true, subtree: true });
    });
    const go = page.getByRole('button', { name: /Go to Admin/ });
    if (await go.count()) await go.first().click();
    else await page.evaluate(() => (history.pushState(null, '', '/admin'), dispatchEvent(new PopStateEvent('popstate'))));
    await page.locator('nav.tabbar').waitFor({ timeout: 30000 });
    assert(!(await page.evaluate(() => window.__sawSpinner)), 'the loading screen showed');
    assert(page.errors.length === 0, page.errors.join(' | '));
    await ctx.close();
  });

  await check("a player's phone never fetches the organizer file, even after 6 seconds on the screen", async () => {
    const { ctx, page } = await phone(BRANCH, 390, 'light');
    await page.goto(BRANCH + '/?as=Parker');
    await page.locator('.schedule article.sched').first().waitFor({ timeout: 30000 });
    await sleep(6000);
    assert(!page.requests.some((u) => /AdminEntry|zip11-/.test(u)), page.requests.filter((u) => /assets/.test(u)).join(' | '));
    await ctx.close();
  });

  // ---------- 5: deep links ----------
  for (const [url, organizer, want] of [
    ['/admin', false, /Sign in|PIN/i],
    ['/admin/', true, /Organizer|Admin|Home/],
    ['/admin?lastscreenadmin=on', true, /Home/],
    ['/admin?noontest=on', true, /Home/],
    ['/?as=Parker&xmasmode=me', false, /Parker/],
    ['/setup', false, /./],
    ['/t/abc', false, /Who are you|Pickleball/],
    ['/go/nothing-here', true, /./],
    ['/gt/preview', true, /./],
    ['/g/nothing-here', false, /./],
  ]) {
    await check(`deep link ${url}${organizer ? ' (organizer)' : ''} opens, no errors`, async () => {
      const { ctx, page } = await phone(BRANCH, 390, 'light', { organizer });
      await page.goto(BRANCH + url);
      await sleep(2500);
      const text = await page.evaluate(() => document.getElementById('root').innerText);
      assert(text.trim().length > 0, 'blank page');
      assert(want.test(text), `words: ${text.slice(0, 200)}`);
      assert(page.errors.length === 0, page.errors.join(' | '));
      await ctx.close();
    });
  }

  // ---------- 6: an old page after a deploy ----------
  const toAdmin = (page) => page.evaluate(() => (history.pushState(null, '', '/admin'), dispatchEvent(new PopStateEvent('popstate'))));
  await check('old page: the organizer file is gone (404) once: the page reloads once by itself and opens Admin', async () => {
    const { ctx, page } = await phone(BRANCH, 390, 'light', { organizer: true });
    await page.goto(BRANCH + '/?as=Parker');
    await page.locator('.schedule article.sched').first().waitFor({ timeout: 30000 });
    let gone = 1;
    await page.route(/AdminEntry-.*\.js$/, (route) => (gone-- > 0 ? route.fulfill({ status: 404, body: 'Not found' }) : route.continue()));
    let loads = 0;
    page.on('load', () => loads++);
    await toAdmin(page);
    await page.locator('nav.tabbar').waitFor({ timeout: 30000 });
    assert(loads === 1, `page loads after the failure: ${loads} (want exactly one reload)`);
    assert(page.errors.length === 0, page.errors.join(' | '));
    await ctx.close();
  });

  await check('old page, still failing right after that reload: Try again, no reload loop', async () => {
    const { ctx, page } = await phone(BRANCH, 390, 'light', { organizer: true });
    await page.goto(BRANCH + '/?as=Parker');
    await page.locator('.schedule article.sched').first().waitFor({ timeout: 30000 });
    await page.route(/AdminEntry-.*\.js$/, (route) => route.fulfill({ status: 404, body: 'Not found' }));
    let loads = 0;
    page.on('load', () => loads++);
    await toAdmin(page);
    await page.getByRole('button', { name: 'Try again' }).waitFor({ timeout: 30000 });
    await sleep(2500);
    assert(loads === 1, `page loads: ${loads} (want the one reload, then Try again)`);
    assert(await page.getByText('The organizer page could not load.').isVisible(), 'no words on the Try again screen');
    // Fixed (a new deploy is in): a tap on Try again opens Admin.
    await page.unroute(/AdminEntry-.*\.js$/);
    await page.getByRole('button', { name: 'Try again' }).click();
    await page.locator('nav.tabbar').waitFor({ timeout: 30000 });
    await ctx.close();
  });

  await check('storage blocked (private mode style): a missing organizer file shows Try again, never a reload loop', async () => {
    const { ctx, page } = await phone(BRANCH, 390, 'light', { organizer: true });
    await ctx.addInitScript(() => {
      Object.defineProperty(window, 'sessionStorage', {
        get() {
          throw new Error('blocked');
        },
      });
    });
    await page.goto(BRANCH + '/?as=Parker');
    await page.locator('.schedule article.sched').first().waitFor({ timeout: 30000 });
    await page.route(/AdminEntry-.*\.js$/, (route) => route.fulfill({ status: 404, body: 'Not found' }));
    let loads = 0;
    page.on('load', () => loads++);
    await toAdmin(page);
    await page.getByRole('button', { name: 'Try again' }).waitFor({ timeout: 30000 });
    await sleep(3000);
    assert(loads === 0, `page reloaded ${loads} time(s) with storage blocked`);
    await ctx.close();
  });

  await check('a stalled download: Try again ("taking a long time") after 15 seconds, then Admin opens by itself when the file lands', async () => {
    const { ctx, page } = await phone(BRANCH, 390, 'light', { organizer: true });
    await page.goto(BRANCH + '/?as=Parker');
    await page.locator('.schedule article.sched').first().waitFor({ timeout: 30000 });
    const held = [];
    await page.route(/AdminEntry-.*\.js$/, (route) => held.push(route));
    await toAdmin(page);
    await page.getByText(/taking a long time/).waitFor({ timeout: 25000 });
    assert(held.length > 0, 'the file was never asked for');
    for (const r of held) await r.continue();
    await page.locator('nav.tabbar').waitFor({ timeout: 30000 });
    assert(page.errors.length === 0, page.errors.join(' | '));
    await ctx.close();
  });

  // ---------- 7: no signal ----------
  for (const scheme of SCHEMES)
    for (const width of SIZES)
      await check(`no signal, ${width} px ${scheme}: Try again screen (never blank); back online it opens Admin by itself`, async () => {
        const { ctx, page } = await phone(BRANCH, width, scheme, { organizer: true });
        await page.goto(BRANCH + '/?as=Parker');
        await page.locator('.schedule article.sched').first().waitFor({ timeout: 30000 });
        await ctx.setOffline(true);
        await toAdmin(page);
        await page.getByRole('button', { name: 'Try again' }).waitFor({ timeout: 30000 });
        assert(await page.getByText(/No connection right now/).isVisible(), 'no offline words');
        const box = await page.getByRole('button', { name: 'Try again' }).boundingBox();
        assert(box && box.height >= 44 && box.x >= 0 && box.x + box.width <= width, `button ${JSON.stringify(box)}`);
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'sideways scroll');
        if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `offline-${width}-${scheme}.png`) });
        await ctx.setOffline(false);
        await page.locator('nav.tabbar').waitFor({ timeout: 30000 });
        assert(page.errors.length === 0, page.errors.join(' | '));
        await ctx.close();
      });

  await check('the organizer style file failed and the site did not answer: Try again fetches the style file again, Admin is styled', async () => {
    const { ctx, page } = await phone(BRANCH, 390, 'light', { organizer: true });
    await page.goto(BRANCH + '/?as=Parker');
    await page.locator('.schedule article.sched').first().waitFor({ timeout: 30000 });
    let cssFails = 1;
    let headFails = 1;
    await page.route(/AdminEntry-.*\.css$/, (route) => (cssFails-- > 0 ? route.abort() : route.continue()));
    await page.route((u) => u.pathname === '/', (route) => (route.request().method() === 'HEAD' && headFails-- > 0 ? route.abort() : route.continue()));
    await toAdmin(page);
    await page.getByRole('button', { name: 'Try again' }).waitFor({ timeout: 30000 });
    await page.getByRole('button', { name: 'Try again' }).click();
    await page.locator('nav.tabbar').waitFor({ timeout: 30000 });
    const state = await page.evaluate(() => [...document.querySelectorAll('link[rel="stylesheet"]')].map((l) => ({ href: l.getAttribute('href'), ok: !!l.sheet })));
    assert(state.every((s) => s.ok), JSON.stringify(state));
    assert(state.filter((s) => /AdminEntry-/.test(s.href)).length === 1, JSON.stringify(state));
    await settle(page);
    const got = await snapshot(page);
    await ctx.close();
    // The same steps with nothing failing.
    const n = await phone(BRANCH, 390, 'light', { organizer: true });
    await n.page.goto(BRANCH + '/?as=Parker');
    await n.page.locator('.schedule article.sched').first().waitFor({ timeout: 30000 });
    await toAdmin(n.page);
    await n.page.locator('nav.tabbar').waitFor({ timeout: 30000 });
    await settle(n.page);
    const want = await snapshot(n.page);
    await n.ctx.close();
    const d = diff(got, want);
    if (d && SHOTS) writeFileSync(path.join(SHOTS, 'refetch-diff.json'), JSON.stringify({ got: got.map((e) => [e.k, e.t, e.b, e.s]), want: want.map((e) => [e.k, e.t, e.b, e.s]) }, null, 0));
    assert(!d, `after the style file came back: ${d}`);
  });

  for (const s of servers) s.close();
  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  writeFileSync(path.join(ROOT, '.data', 'zip48-result.json'), JSON.stringify({ passed, failed }));
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
