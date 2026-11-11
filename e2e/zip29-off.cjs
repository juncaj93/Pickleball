/* Zip 29: with "Venmo request" OFF, the Home money card is exactly today's site (the old second card, "Mark paid tonight" / "Who owes you", is the
 * one drawn; the merged "Who hasn't paid" card does not exist then). Runs today's main (a git worktree, path in MAIN_DIR) and this branch side by
 * side on two copies of the same fake world (the small preview world at Tue Nov 10, 7:20 PM Eastern), VENMO_REQUEST=off on both servers, and
 * compares the card's own HTML, plus the people it lists.
 *
 *   MAIN_DIR=/path/to/main-worktree node e2e/zip29-off.cjs
 *
 * Not part of npm run test:e2e (it needs the second checkout). Nothing here touches Cloudflare or the live site.
 */
const { spawn, spawnSync } = require('node:child_process');
const { readFileSync, mkdirSync, rmSync, copyFileSync } = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const MAIN = process.env.MAIN_DIR;
if (!MAIN) throw new Error('set MAIN_DIR to a checkout of main');
const SEED_ISO = '2026-11-11T00:20:00.000Z';
const NOW_MS = Date.parse(SEED_ISO);
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
    console.log(`  ✗ ${name}\n      ${String(err && err.message ? err.message : err).replace(/\s*\n\s*/g, ' ⏎ ').slice(0, 900)}`);
  }
}
const assert = (c, m) => {
  if (!c) throw new Error(m);
};

function liveVars() {
  const toml = readFileSync(path.join(ROOT, 'wrangler.toml'), 'utf8');
  const top = toml.slice(toml.indexOf('[vars]'), toml.indexOf('[env.preview]'));
  const out = {};
  for (const m of top.matchAll(/^([A-Z_][A-Z0-9_]*)\s*=\s*"([^"]*)"/gm)) if (m[1] !== 'SITE_URL') out[m[1]] = m[2];
  return out;
}

async function main() {
  const dbA = path.join(ROOT, '.data', 'zip29off-main.sqlite');
  const dbB = path.join(ROOT, '.data', 'zip29off-branch.sqlite');
  mkdirSync(path.join(ROOT, '.data'), { recursive: true });
  rmSync(dbA, { force: true });
  rmSync(dbB, { force: true });
  const seeded = spawnSync('npx', ['vite-node', 'scripts/load-small-local.ts', '--', dbB, SEED_ISO], { cwd: ROOT, encoding: 'utf8' });
  if (seeded.status !== 0) throw new Error(`could not build the fake world: ${seeded.stderr || seeded.stdout}`);
  copyFileSync(dbB, dbA);
  const servers = [];
  const start = (cwd, port, db) => {
    const s = spawn('npx', ['vite', '--port', String(port), '--strictPort'], {
      cwd,
      env: { ...process.env, ...liveVars(), VENMO_REQUEST: 'off', DEV_DB: db, SETUP_TOKEN: 'zip29off-setup-token-0123456789', DEV_CLOCK: '1', PREVIEW_CALM: 'on' },
      stdio: 'ignore',
      detached: true,
    });
    servers.push(s);
    process.on('exit', () => {
      try {
        process.kill(-s.pid, 'SIGTERM');
      } catch {}
    });
  };
  const PM = Number(process.env.E2E_PORT_MAIN) || 5851;
  const PB = Number(process.env.E2E_PORT_BRANCH) || 5852;
  start(MAIN, PM, dbA);
  start(ROOT, PB, dbB);
  for (const port of [PM, PB])
    for (let i = 0; i < 120; i++) {
      try {
        if ((await fetch(`http://localhost:${port}/api/status`)).ok) break;
      } catch {}
      await sleep(500);
    }
  for (const port of [PM, PB]) await fetch(`http://localhost:${port}/__dev/clock`, { method: 'POST', body: JSON.stringify({ atMs: NOW_MS }) });
  const browser = await chromium.launch();

  async function home(port, width, scheme) {
    const ctx = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: scheme, reducedMotion: 'reduce' });
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
    const base = `http://localhost:${port}`;
    await ctx.request.post(base + '/api/admin/login', { data: { pin: PIN }, headers: { Origin: base } });
    const page = await ctx.newPage();
    await page.goto(base + '/admin');
    await page.locator('.scard, .hv2-short').first().waitFor({ timeout: 30000 });
    await page.waitForTimeout(1500);
    const out = await page.evaluate(() => ({
      markPaid: [...document.querySelectorAll('article[aria-label="Mark paid tonight"], article[aria-label="Who owes you"]')].map((a) => a.outerHTML),
      merged: document.querySelectorAll('[data-vr-cards], [data-vr-card]').length,
      rows: [...document.querySelectorAll('article[aria-label="Mark paid tonight"] [data-mp-row], article[aria-label="Who owes you"] [data-mp-row]')].map((r) => r.getAttribute('data-mp-row')),
    }));
    await ctx.close();
    return out;
  }

  for (const scheme of ['light', 'dark'])
    for (const width of [390, 320]) {
      await check(`VENMO_REQUEST off, ${width} px, ${scheme}: the old Mark paid cards are drawn and equal main's (same HTML), no merged card`, async () => {
        const a = await home(PM, width, scheme);
        const b = await home(PB, width, scheme);
        assert(a.markPaid.length >= 1, 'main should show the old money card in this world');
        assert(b.merged === 0 && a.merged === 0, `merged card with the switch off: main ${a.merged}, branch ${b.merged}`);
        assert(b.markPaid.length === a.markPaid.length, `${b.markPaid.length} cards vs main's ${a.markPaid.length}`);
        for (let i = 0; i < a.markPaid.length; i++) assert(a.markPaid[i] === b.markPaid[i], `card ${i} differs from main: ${a.markPaid[i].length} vs ${b.markPaid[i].length} characters`);
        assert(JSON.stringify(a.rows) === JSON.stringify(b.rows), 'the people differ');
      });
    }

  console.log(`\nzip29-off: ${passed} passed, ${failed} failed`);
  await browser.close();
  for (const s of servers) {
    try {
      process.kill(-s.pid, 'SIGTERM');
    } catch {}
  }
  process.exit(failed ? 1 : 0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
