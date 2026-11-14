/* Zip 44 (🎾44.cleanup), item 1: the Later cards are barely off white in light mode (--cl-later-bg #f9f9f6), dark mode untouched.
 *
 *   node e2e/zip44.cjs          E2E_SHOTS=<folder> keeps the pictures (and writes <name>.png so two runs can be compared)
 *   Z44_ROOT=<another checkout> node e2e/zip44.cjs     runs the same pictures against another checkout (main), for the dark-mode pixel compare
 *
 * The small fake world as of Thu Nov 12, 2026, 3:00 PM Eastern, its own dev server, every wrangler.toml switch as on live. A phone at
 * 390, 360 and 320 px, light and dark, normal look and the Christmas skin (Just me link). Reads every Later card's background and the
 * contrast of every word on it. Nothing here touches Cloudflare or the live site.
 */
const { spawn, spawnSync } = require('node:child_process');
const { readFileSync, mkdirSync, rmSync, writeFileSync } = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { chromium } = require('playwright');

const ROOT = process.env.Z44_ROOT || path.join(__dirname, '..');
const PORT = Number(process.env.E2E_PORT) || 5446;
const BASE = `http://localhost:${PORT}`;
const SEED_ISO = '2026-11-12T20:00:00.000Z'; // Thu Nov 12, 3:00 PM Eastern
const NOW_MS = Date.parse(SEED_ISO);
const SHOTS = process.env.E2E_SHOTS || '';
const TAG = process.env.Z44_TAG || 'branch';

let passed = 0;
let failed = 0;
async function check(name, fn) {
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

async function main() {
  const dbFile = path.join(ROOT, '.data', `zip44-${PORT}.sqlite`);
  mkdirSync(path.join(ROOT, '.data'), { recursive: true });
  if (SHOTS) mkdirSync(SHOTS, { recursive: true });
  rmSync(dbFile, { force: true });
  const seeded = spawnSync('npx', ['vite-node', 'scripts/load-small-local.ts', '--', dbFile, SEED_ISO], { cwd: ROOT, encoding: 'utf8' });
  if (seeded.status !== 0) throw new Error(`could not build the fake world: ${seeded.stderr || seeded.stdout}`);
  if (await fetch(`${BASE}/api/status`).then((r) => r.ok, () => false)) throw new Error(`port ${PORT} is already in use`);
  const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
    cwd: ROOT,
    env: { ...process.env, ...liveVars(), DEV_DB: dbFile, SETUP_TOKEN: 'zip44-setup-token-0123456789', DEV_CLOCK: '1', PREVIEW_CALM: 'on', CHRISTMAS_SKIN_PREVIEW: 'on' },
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

  async function phone(width, scheme) {
    const ctx = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, colorScheme: scheme, reducedMotion: 'reduce' });
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
    await ctx.addInitScript(() => localStorage.setItem('pb_games_filter', 'all'));
    const page = await ctx.newPage();
    page.errors = [];
    page.on('pageerror', (e) => page.errors.push(String(e)));
    return { ctx, page };
  }
  async function home(page, query) {
    await page.goto(`${BASE}/?as=Alex${query ? '&' + query : ''}`);
    await page.locator('.schedule article.sched').first().waitFor({ timeout: 30000 });
    const more = page.getByRole('button', { name: /More sessions/ });
    if (await more.count()) await more.first().click();
    await page.evaluate(() => document.fonts.ready);
    await sleep(900);
    await page.addStyleTag({ content: '*, *::before, *::after { animation: none !important; transition: none !important; caret-color: transparent !important; }' });
    await sleep(300);
  }
  /** Each Later card: its background, and the lowest contrast of any word on it. */
  const readLater = (page) =>
    page.evaluate(() => {
      const parse = (c) => c.match(/[\d.]+/g).map(Number);
      const lum = (c) => {
        const [r, g, b] = parse(c).slice(0, 3).map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      };
      const ratio = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
      return [...document.querySelectorAll('.schedule > .sched.cl-later')].map((a) => {
        const bg = getComputedStyle(a).backgroundColor;
        let worst = { r: 99, text: '' };
        const walk = document.createTreeWalker(a, NodeFilter.SHOW_TEXT);
        for (let n = walk.nextNode(); n; n = walk.nextNode()) {
          const t = n.textContent.trim();
          const el = n.parentElement;
          if (!t || !el || el.getBoundingClientRect().height === 0) continue;
          // Words inside a button or chip sit on that element's own fill, not the card: skip those, they are not on the Later tint.
          if (el.closest('button, .pchip, .tile, .pill, .chip')) continue;
          const cs = getComputedStyle(el);
          if (cs.visibility === 'hidden' || cs.display === 'none') continue;
          const r = ratio(cs.color, bg);
          if (r < worst.r) worst = { r, text: t.slice(0, 30) };
        }
        return { id: a.id, off: a.classList.contains('off'), bg, border: getComputedStyle(a).borderTopColor, worst };
      });
    });

  const SIZES = [390, 360, 320];
  const LIGHT_BG = 'rgb(249, 249, 246)';
  const DARK_BG = 'rgb(27, 38, 32)';
  const summary = [];
  for (const scheme of ['light', 'dark']) {
    for (const width of SIZES) {
      for (const look of ['normal', 'christmas']) {
        await check(`${look} ${scheme} ${width}px: Later cards ${scheme === 'light' ? LIGHT_BG : DARK_BG}, every word on them 4.5:1 or better, nothing sideways`, async () => {
          const { ctx, page } = await phone(width, scheme);
          await home(page, look === 'christmas' ? 'xmasdate=2026-12-05&xmasmode=me' : '');
          if (look === 'christmas') {
            // Just me is kept on the server: a later phone may already have it on, so tap only when it is off.
            if ((await page.evaluate(() => document.documentElement.getAttribute('data-skin'))) !== 'christmas') {
              await page.locator('[data-skin-logo="me"]').tap();
              await sleep(2600);
            }
            await page.addStyleTag({ content: '*, *::before, *::after { animation: none !important; transition: none !important; }' });
            assert((await page.evaluate(() => document.documentElement.getAttribute('data-skin'))) === 'christmas', 'skin on');
          }
          const rows = await readLater(page);
          assert(rows.length >= 2, `Later cards: ${rows.length}`);
          for (const r of rows) {
            assert(r.bg === (scheme === 'light' ? LIGHT_BG : DARK_BG), `${r.id}${r.off ? ' (canceled)' : ''}: background ${r.bg}`);
            assert(r.worst.r >= 4.5, `${r.id}${r.off ? ' (canceled)' : ''}: "${r.worst.text}" ${r.worst.r.toFixed(2)}:1`);
          }
          const sideways = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
          assert(sideways <= 0, `sideways ${sideways}px`);
          assert(page.errors.length === 0, page.errors.join(' | '));
          summary.push(`${look} ${scheme} ${width}: ${rows.length} Later cards (${rows.filter((r) => r.off).length} canceled), lowest word ${Math.min(...rows.map((r) => r.worst.r)).toFixed(1)}:1, border ${rows[0].border}`);
          if (SHOTS) {
            const buf = await page.screenshot({ path: path.join(SHOTS, `zip44-${TAG}-${look}-${scheme}-${width}.png`), fullPage: true });
            writeFileSync(path.join(SHOTS, `zip44-${TAG}-${look}-${scheme}-${width}.sha`), crypto.createHash('sha256').update(buf).digest('hex'));
            // Pictures can differ by a hair between two runs of the SAME code (text smoothing), so the compare that counts is every element's
            // colors, borders, shadows and box, in page order.
            const styles = await page.evaluate(() =>
              [...document.querySelectorAll('body *')]
                .map((el) => {
                  const cs = getComputedStyle(el);
                  const r = el.getBoundingClientRect();
                  return [el.tagName, el.className && el.className.baseVal === undefined ? el.className : '', cs.color, cs.backgroundColor, cs.borderTopColor, cs.borderBottomColor, cs.boxShadow, cs.opacity, cs.fill, cs.stroke, Math.round((r.x + scrollX) * 10), Math.round((r.y + scrollY) * 10), Math.round(r.width * 10), Math.round(r.height * 10)].join('|');
                })
                .join('\n'),
            );
            writeFileSync(path.join(SHOTS, `zip44-${TAG}-${look}-${scheme}-${width}.sty`), crypto.createHash('sha256').update(styles).digest('hex') + ' ' + styles.split('\n').length);
            writeFileSync(path.join(SHOTS, `zip44-${TAG}-${look}-${scheme}-${width}.sty.txt`), styles);
          }
          await ctx.close();
        });
      }
    }
  }
  console.log(summary.join('\n'));
  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
