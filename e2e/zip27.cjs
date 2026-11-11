/* Zip 27: the screens the Audit A money fixes touch (the money itself is tested in tests/zip27-money.test.ts).
 *
 *   node e2e/zip27.cjs      (also run by npm run test:e2e)
 *
 * The world: the SMALL preview cast (scripts/load-small-local.ts) as if it were Tue Nov 10, 2026, 12:00 PM Eastern, every Settings row
 * on as on the preview (Spent matches Totals included) and every wrangler.toml switch as on live. Its own dev server and its own copy.
 * Checks, at 390, 360 and 320 wide, light and dark: the "Spent matches Totals" row sits on top of Settings > Feature switches, fits and
 * is on; the Players sheet's Spent reads the server's number ("$8 credit" for a credit month, never a minus sign); the switch off and on
 * again; Remove on a player who is still in a game says why and changes nothing. Nothing sideways, no page errors.
 * Screenshots: e2e/screenshots/zip27-*.png (ignored by git).
 */
const { spawn, spawnSync } = require('node:child_process');
const { readFileSync, mkdirSync, rmSync } = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.E2E_PORT) || 5437;
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
  const dbFile = path.join(ROOT, '.data', `zip27-${PORT}.sqlite`);
  mkdirSync(path.join(ROOT, '.data'), { recursive: true });
  rmSync(dbFile, { force: true });
  const seeded = spawnSync('npx', ['vite-node', 'scripts/load-small-local.ts', '--', dbFile, SEED_ISO], { cwd: ROOT, encoding: 'utf8' });
  if (seeded.status !== 0) throw new Error(`could not build the fake world: ${seeded.stderr || seeded.stdout}`);
  const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
    cwd: ROOT,
    env: { ...process.env, ...liveVars(), DEV_DB: dbFile, SETUP_TOKEN: 'zip27-setup-token-0123456789', DEV_CLOCK: '1', PREVIEW_CALM: 'on' },
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
  assert(d0.spentTotalsForAll === true && d0.spentTotals === true, 'the preview world has Spent matches Totals on');
  const noSideways = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 0.5);
  const money = (c) => `$${Math.round(Math.abs(c) / 100)}`;
  const spentWords = (c) => (c < 0 ? `${money(c)} credit` : money(c));
  const putSwitch = async (on) => assert((await api.put(`${BASE}/api/admin/spent-totals-switch`, { data: { on }, headers: { Origin: BASE } })).ok(), 'switch saved');

  async function openTab(opts, tab) {
    const p = await phone(opts);
    await p.page.goto(BASE + '/admin');
    await p.page.locator('.tabbar').waitFor({ timeout: 30000 });
    await p.page.locator('.tabbar button', { hasText: tab }).click();
    await p.page.waitForTimeout(500);
    return p;
  }

  for (const width of [390, 360, 320]) {
    for (const scheme of ['light', 'dark']) {
      await check(`Settings at ${width} ${scheme}: "Spent matches Totals" sits right under Zip 31's Extended time, Zip 34's Check-in pay line, Zip 32's Players sheet redo and Zip 30's Acting for others at the top of Feature switches, fits, and is on`, async () => {
        const { ctx, page, errors } = await openTab({ width, scheme }, 'Settings');
        for (const s of await page.locator('details > summary').all()) await s.click().catch(() => {});
        const first = await page.locator('#switches [data-row], [data-switches-tidy] [data-row]').evaluateAll((els) => els.slice(0, 7).map((e) => e.getAttribute('data-row')));
        assert(first.join('|') === 'extendedTimeAll|checkInPayAll|playersSheetRedoAll|actingOthersAll|spentTotalsAll|bookingHoursAll|totalsRefreshAll', `newest first: ${first}`);
        const row = page.locator('[data-row="spentTotalsAll"]');
        assert((await row.locator('.set-name').innerText()).includes('Spent matches Totals'), 'its name');
        assert(await row.locator('input').isChecked(), 'on in this world');
        const fit = await row.evaluate((el) => {
          const box = el.getBoundingClientRect();
          return [...el.querySelectorAll('.set-name, .set-hint, input')].every((x) => {
            const r = x.getBoundingClientRect();
            return r.left >= box.left - 0.5 && r.right <= box.right + 0.5;
          });
        });
        assert(fit, 'the name, hint and switch sit inside the row');
        assert(await noSideways(page), 'sideways scroll');
        if (width === 390) await row.screenshot({ path: path.join(SHOTS, `zip27-row-${scheme}.png`) });
        assert(errors.length === 0, errors.join(' | '));
        await ctx.close();
      });
      await check(`Players sheet at ${width} ${scheme}: Spent reads the server's number (the organizer's own may be a credit)`, async () => {
        for (const name of ['Alex', 'Vic']) {
          const { ctx, page, errors } = await openTab({ width, scheme }, 'Players');
          const id = d0.players.find((p) => p.name === name).id;
          const sum = await (await api.get(`${BASE}/api/admin/players/${id}/summary`)).json();
          await page.locator(`[data-pr-row="${name}"]`).first().click();
          const sheet = page.locator(`[data-pr-details="${name}"]`);
          await sheet.waitFor({ timeout: 10000 });
          await page.waitForTimeout(600);
          const month = squash(await sheet.locator('[data-pr-kv="month-spent"]').innerText());
          const all = squash(await sheet.locator('[data-pr-kv="all-spent"]').innerText());
          assert(month.endsWith(spentWords(sum.month.spentCents)), `${name} month: "${month}" vs ${sum.month.spentCents}`);
          assert(all.endsWith(spentWords(sum.allTime.spentCents)), `${name} all time: "${all}" vs ${sum.allTime.spentCents}`);
          assert(!/-\$/.test(month + all), 'never a minus sign');
          assert(await noSideways(page), 'sideways scroll');
          if (width === 390) await sheet.screenshot({ path: path.join(SHOTS, `zip27-spent-${name}-${scheme}.png`) });
          assert(errors.length === 0, errors.join(' | '));
          await ctx.close();
        }
      });
    }
  }

  await check('switch off, the organizer\'s Spent is never below $0 (as main); on again, it is the Totals "So far" figure', async () => {
    const alex = d0.players.find((p) => p.name === 'Alex').id;
    await putSwitch(false);
    const off = await (await api.get(`${BASE}/api/admin/players/${alex}/summary`)).json();
    assert(off.month.spentCents >= 0 && off.allTime.spentCents >= 0, `off: ${JSON.stringify(off)}`);
    assert((await dash()).spentTotalsForAll === undefined, 'the row is off');
    await putSwitch(true);
    const on = await (await api.get(`${BASE}/api/admin/players/${alex}/summary`)).json();
    const month = new Date(NOW_MS).toLocaleDateString('en-CA', { timeZone: TZ }).slice(0, 7);
    const t = (await (await api.get(`${BASE}/api/admin/money?month=${month}`)).json()).rework;
    assert(on.month.spentCents === t.owedToVenueCents - t.collectedCents, `on: ${on.month.spentCents} vs ${t.owedToVenueCents - t.collectedCents}`);
  });

  await check('Remove on a player who is still in a game: the server says why and the name stays', async () => {
    const d = await dash();
    const inGame = d.sessions.find((s) => s.status !== 'canceled' && Date.parse(s.endsAt) > NOW_MS && s.roster.some((r) => r.status === 'confirmed' && r.name !== 'Alex'));
    const who = inGame.roster.find((r) => r.status === 'confirmed' && r.name !== 'Alex');
    const res = await api.delete(`${BASE}/api/admin/players/${who.playerId}`, { headers: { Origin: BASE } });
    assert(res.status() === 409, `status ${res.status()}`);
    const body = await res.json();
    assert(body.error === 'player_in_games' && body.message.startsWith(`${who.name} is still in `) && body.message.endsWith('then remove the name.'), JSON.stringify(body));
    assert((await dash()).players.find((p) => p.id === who.playerId).isActive === true, 'still on the list');
  });

  await browser.close();
  console.log(`\nzip27: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
