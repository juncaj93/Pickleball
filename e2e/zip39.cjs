/* Zip 39 (🎾39.moneyfix): the one screen change, the "Made cheaper after paying" row (the money itself is tested in tests/zip39-money.test.ts).
 *
 *   node e2e/zip39.cjs      (also run by npm run test:e2e)
 *
 * The world: the SMALL preview cast (scripts/load-small-local.ts) as if it were Tue Nov 10, 2026, 12:00 PM Eastern, every wrangler.toml
 * switch as on live. Its own dev server and its own copy. Checks, at 390, 360 and 320 wide, light and dark: the row sits on top of
 * Settings > Feature switches, fits, ships OFF; a tap turns it on and another off (the server agrees each time). Nothing sideways, no page
 * errors. Screenshots: e2e/screenshots/zip39-*.png (ignored by git).
 */
const { spawn, spawnSync } = require('node:child_process');
const { readFileSync, mkdirSync, rmSync } = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.E2E_PORT) || 5439;
const BASE = `http://localhost:${PORT}`;
const SEED_ISO = '2026-11-10T17:00:00.000Z'; // Tue Nov 10, 12:00 PM Eastern
const NOW_MS = Date.parse(SEED_ISO);
const TZ = 'America/Detroit';
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
const squash = (t) => t.replace(/[\s  ]+/g, ' ').trim();

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
  const dbFile = path.join(ROOT, '.data', `zip39-${PORT}.sqlite`);
  mkdirSync(path.join(ROOT, '.data'), { recursive: true });
  rmSync(dbFile, { force: true });
  const seeded = spawnSync('npx', ['vite-node', 'scripts/load-small-local.ts', '--', dbFile, SEED_ISO], { cwd: ROOT, encoding: 'utf8' });
  if (seeded.status !== 0) throw new Error(`could not build the fake world: ${seeded.stderr || seeded.stdout}`);
  const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
    cwd: ROOT,
    env: { ...process.env, ...liveVars(), DEV_DB: dbFile, SETUP_TOKEN: 'zip39-setup-token-0123456789', DEV_CLOCK: '1', PREVIEW_CALM: 'on' },
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

  async function phone({ width = 390, scheme = 'light' } = {}) {
    const ctx = await browser.newContext({ viewport: { width, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, colorScheme: scheme, userAgent: UA, reducedMotion: 'reduce' });
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
    const r = await ctx.request.post(BASE + '/api/admin/login', { data: { pin: PIN }, headers: { Origin: BASE } });
    assert(r.ok(), 'organizer sign-in');
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    return { ctx, page, errors };
  }
  const api = (await browser.newContext()).request;
  assert((await api.post(BASE + '/api/admin/login', { data: { pin: PIN }, headers: { Origin: BASE } })).ok(), 'api sign-in');
  const dash = async () => (await api.get(`${BASE}/api/admin/dashboard`)).json();

  const noSideways = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 0.5);
  assert((await dash()).cheaperFixForAll === undefined, 'ships OFF');

  async function openSettings(opts) {
    const p = await phone(opts);
    await p.page.goto(BASE + '/admin');
    await p.page.locator('.tabbar').waitFor({ timeout: 30000 });
    await p.page.locator('.tabbar button', { hasText: 'Settings' }).click();
    await p.page.waitForTimeout(500);
    for (const s of await p.page.locator('details > summary').all()) await s.click().catch(() => {});
    return p;
  }

  for (const width of [390, 360, 320]) {
    for (const scheme of ['light', 'dark']) {
      await check(`Settings at ${width} ${scheme}: "Made cheaper after paying" is the top Feature switches row, fits, and is off`, async () => {
        const { ctx, page, errors } = await openSettings({ width, scheme });
        const first = await page.locator('#switches [data-row], [data-switches-tidy] [data-row]').evaluateAll((els) => els.filter((e) => e.getAttribute('data-row') !== 'christmasSkinAll' && e.getAttribute('data-row') !== 'guestSpotAll').slice(0, 2).map((e) => e.getAttribute('data-row')));
        assert(first.join('|') === 'cheaperFixAll|homeScreenTipAll', `newest first: ${first}`);
        const row = page.locator('[data-row="cheaperFixAll"]');
        assert((await row.locator('.set-name').innerText()).includes('Made cheaper after paying'), 'its name');
        assert(!(await row.locator('input').isChecked()), 'off at ship');
        const fit = await row.evaluate((el) => {
          const box = el.getBoundingClientRect();
          return [...el.querySelectorAll('.set-name, .set-hint, input')].every((x) => {
            const r = x.getBoundingClientRect();
            return r.left >= box.left - 0.5 && r.right <= box.right + 0.5;
          });
        });
        assert(fit, 'the name, hint and switch sit inside the row');
        assert(await noSideways(page), 'sideways scroll');
        await row.screenshot({ path: path.join(SHOTS, `zip39-row-${width}-${scheme}.png`) });
        assert(errors.length === 0, errors.join(' | '));
        await ctx.close();
      });
    }
  }

  await check('a tap turns it on (the server agrees), another turns it off again', async () => {
    const { ctx, page, errors } = await openSettings({ width: 390, scheme: 'dark' });
    const row = page.locator('[data-row="cheaperFixAll"]');
    const answers = [];
    page.on('response', (r) => { if (r.url().includes('cheaper-fix-switch')) answers.push(`${r.status()}`); });
    page.on('request', (r) => { if (r.method() !== 'GET') answers.push(`${r.method()} ${new URL(r.url()).pathname}`); });
    for (const want of [true, false]) {
      await page.waitForTimeout(900); // like a person: a second tap on the same spot within the double-tap guard's window is dropped on purpose
      await row.scrollIntoViewIfNeeded();
      await row.locator('label').click();
      let ok = false;
      for (let i = 0; i < 40 && !ok; i++) {
        await sleep(250);
        ok = ((await dash()).cheaperFixForAll === true) === want;
      }
      assert(ok, `server says ${want ? 'off' : 'on'} (requests: ${answers.join(', ') || 'none'})`);
      assert((await row.locator('input').isChecked()) === want, `the switch shows ${want ? 'on' : 'off'}`);
    }
    assert(errors.length === 0, errors.join(' | '));
    await ctx.close();
  });

  await browser.close();
  console.log(`zip39: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
