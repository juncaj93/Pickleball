/* Zip 22: the folded TONIGHT tile on admin Home (item 3; item 1, games past midnight, was dropped: the venue closes by 10 PM).
 *
 *   node e2e/zip22.cjs      (also run by npm run test:e2e)
 *
 * The world: the SMALL preview cast (scripts/load-small-local.ts) as if it were Tue Nov 10, 2026, 12:00 PM Eastern (a game day, so
 * tonight's game shows the TONIGHT tile), every Settings row on as on live and every wrangler.toml switch as on live. Its own dev
 * server and its own copy; nothing touches Cloudflare or the live site.
 * Checks, at 390, 375, 360 and 320 wide, light and dark: the folded TONIGHT word has at least 7 px clear on both sides inside the tile's
 * border and is centered; TOM and the plain folded tiles keep their width and 8 px label; nothing sideways.
 * Screenshots: e2e/screenshots/zip22-tonight-*.png (ignored by git).
 */
const { spawn, spawnSync } = require('node:child_process');
const { readFileSync, mkdirSync, rmSync } = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.E2E_PORT) || 5432;
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
  const dbFile = path.join(ROOT, '.data', `zip22-${PORT}.sqlite`);
  mkdirSync(path.join(ROOT, '.data'), { recursive: true });
  rmSync(dbFile, { force: true });
  const seeded = spawnSync('npx', ['vite-node', 'scripts/load-small-local.ts', '--', dbFile, SEED_ISO], { cwd: ROOT, encoding: 'utf8' });
  if (seeded.status !== 0) throw new Error(`could not build the fake world: ${seeded.stderr || seeded.stdout}`);
  const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
    cwd: ROOT,
    env: { ...process.env, ...liveVars(), DEV_DB: dbFile, SETUP_TOKEN: 'zip22-setup-token-0123456789', DEV_CLOCK: '1', PREVIEW_CALM: 'on' },
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

  const d0 = await dash();
  // The game to move: the first one on Thu Nov 12 (two days out: not started, not tonight).
  // (The small world has more than one game that day: take the evening one, the usual kind.)
  const onThu = d0.sessions.filter((s) => s.status !== 'canceled' && new Date(s.startsAt).toLocaleDateString('en-CA', { timeZone: TZ }) === '2026-11-12');
  const thu = onThu.find((s) => Number(new Date(s.startsAt).toLocaleString('en-US', { timeZone: TZ, hour: 'numeric', hour12: false })) >= 17) ?? onThu[0];
  assert(thu, 'a Thu Nov 12 game in the small world');

  async function openAdmin(opts) {
    const p = await phone(opts);
    await p.page.goto(BASE + '/admin');
    await p.page.locator('.hv2-short, article.scard').first().waitFor({ timeout: 30000 });
    await p.page.waitForLoadState('networkidle');
    // Home lists the first games; the rest sit behind "Show all N".
    const all = p.page.getByRole('button', { name: /Show all/ });
    if (await all.count()) await all.first().click();
    await p.page.locator(`#session-${thu.id}`).first().waitFor({ state: 'attached', timeout: 15000 });
    return p;
  }
  const noSideways = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 0.5);

  // ---------------------------------------------------------------- Item 3: the folded TONIGHT tile
  for (const width of [390, 375, 360, 320]) {
    for (const scheme of ['light', 'dark']) {
      await check(`folded TONIGHT tile at ${width} ${scheme}: at least 7 px clear on both sides of the word, TOM and plain tiles unchanged`, async () => {
        const { ctx, page, errors } = await openAdmin({ width, scheme });
        await page.locator('.day-tag.tonight').first().waitFor({ timeout: 15000 });
        // Fold tonight's card (a tap on the card, as on the phone) when it starts open.
        if (!(await page.locator('.hv2-short:has(.day-tag.tonight)').count())) {
          await page.evaluate(() => document.querySelector('.day-tag.tonight')?.closest('article')?.click());
          await page.waitForTimeout(500);
        }
        // And every other card, so a TOM and a plain folded tile are on screen too.
        await page.evaluate(() => document.querySelectorAll('article.hv2-card, .admin-page article').forEach((a) => !a.classList.contains('hv2-short') && a.querySelector('.court-switch') && a.click()));
        await page.waitForTimeout(500);
        const row = page.locator('.hv2-short:has(.day-tag.tonight)').first();
        await row.waitFor({ timeout: 10000 });
        const m = await row.locator('.tile').first().evaluate((t) => {
          const tag = t.querySelector('.day-tag.tonight');
          const range = document.createRange();
          range.selectNodeContents(tag);
          const tr = range.getBoundingClientRect();
          const r = t.getBoundingClientRect();
          const bw = parseFloat(getComputedStyle(t).borderLeftWidth);
          return { tileW: r.width, left: tr.left - (r.left + bw), right: r.right - bw - tr.right, font: getComputedStyle(tag).fontSize, word: tag.innerText.trim() };
        });
        assert(m.word === 'TONIGHT', `the word: ${m.word}`);
        assert(m.left >= 7 && m.right >= 7, `room inside the tile: ${JSON.stringify(m)}`);
        assert(Math.abs(m.left - m.right) < 1, `centered: ${JSON.stringify(m)}`);
        const others = await page.evaluate(() =>
          [...document.querySelectorAll('.hv2-short .tile')].filter((t) => !t.querySelector('.day-tag.tonight')).map((t) => ({ w: t.getBoundingClientRect().width, tag: t.querySelector('.day-tag') ? getComputedStyle(t.querySelector('.day-tag')).fontSize : null })),
        );
        assert(others.length > 0, 'other folded rows on screen');
        for (const o of others) assert(o.w === m.tileW && (o.tag === null || o.tag === '8px'), `other tiles as before (same width, TOM at 8 px): ${JSON.stringify(others)}`);
        assert(await noSideways(page), 'sideways scroll');
        await row.scrollIntoViewIfNeeded();
        if (width === 390) {
          const b = await row.boundingBox();
          await page.screenshot({ path: path.join(SHOTS, `zip22-tonight-${width}-${scheme}.png`), clip: { x: 0, y: Math.max(0, b.y - 8), width, height: b.height + 16 } });
        }
        assert(errors.length === 0, errors.join(' | '));
        await ctx.close();
      });
    }
  }

  await browser.close();
  console.log(`\nzip22: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
