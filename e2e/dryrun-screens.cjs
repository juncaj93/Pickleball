/* Two screen fixes from the finalize dry run:
 *   - The player's name in the header is never cut off when the CREDIT chip
 *     shows ("Brand…"): it fits, "not you?" moves under it if needed, and a
 *     long name wraps to two lines. No overlap at 360, 375, 390 and 430 px,
 *     light and dark, and no sideways scrolling.
 *   - The Finalize card (and the Who played sheet) warns before the final tap
 *     when someone tapped "I paid" and the organizer has not confirmed it.
 *
 *   node e2e/dryrun-screens.cjs      (also run by npm run test:e2e)
 *
 * Fake group, fake clock. Pictures go to e2e/screenshots/dryrun-*.png.
 */
const { spawn } = require('node:child_process');
const { rmSync, mkdirSync } = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const PORT = 5243;
const BASE = `http://localhost:${PORT}`;
const SETUP_TOKEN = 'dryrun-screens-token-0123456789';
const PIN = '482913';
const SHOTS = path.join(__dirname, 'screenshots');
const NAMES = ['Alex', 'Ryan', 'Mitchel', 'Brandon', 'Julian', 'Christopher', 'Maximiliana'];

let passed = 0;
let failed = 0;
async function check(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.log(`  ✗ ${name}\n      ${String(err && err.message ? err.message : err).replace(/\s*\n\s*/g, ' ⏎ ').slice(0, 700)}`);
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
const squash = (t) => t.replace(/\s+/g, ' ').trim();

async function main() {
  const dbFile = path.join(ROOT, '.data', 'dryrun-screens.sqlite');
  mkdirSync(path.join(ROOT, '.data'), { recursive: true });
  mkdirSync(SHOTS, { recursive: true });
  rmSync(dbFile, { force: true });
  const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
    cwd: ROOT,
    env: { ...process.env, DEV_DB: dbFile, SETUP_TOKEN, DEV_CLOCK: '1' },
    stdio: 'ignore',
    detached: true,
  });
  process.on('exit', () => {
    try {
      process.kill(-server.pid, 'SIGTERM');
    } catch {}
  });
  for (let i = 0; i < 80; i++) {
    try {
      if ((await fetch(`${BASE}/api/status`)).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  const clock = (iso) => fetch(`${BASE}/__dev/clock`, { method: 'POST', body: JSON.stringify({ atMs: Date.parse(iso) }) });
  await clock('2026-10-26T12:00:00-04:00');

  const browser = await chromium.launch();
  const admin = await browser.newContext();
  const call = async (req, method, url, data) => {
    const res = await req.fetch(BASE + url, { method, data, headers: { Origin: BASE } });
    if (!res.ok()) throw new Error(`${method} ${url}: ${res.status()} ${await res.text()}`);
    return res.json().catch(() => ({}));
  };
  await call(admin.request, 'POST', '/api/setup', {
    setupToken: SETUP_TOKEN,
    groupName: 'Pickleball Bros',
    pin: PIN,
    venmoUrl: 'https://venmo.com/u/organizer',
    players: NAMES.map((name, i) => ({ name, phone: `24855507${String(i).padStart(2, '0')}` })),
  });
  await call(admin.request, 'PUT', '/api/admin/group', { organizerName: 'Alex' });
  let d = await call(admin.request, 'GET', '/api/admin/dashboard');
  const id = Object.fromEntries(d.players.map((p) => [p.name, p.id]));
  const [tue, thu] = d.sessions; // Tue Oct 27 and Thu Oct 29
  // Everyone but Alex gets $14 credit from a canceled Tuesday, so the chip shows.
  const others = NAMES.slice(1);
  for (const n of others) {
    await call(admin.request, 'POST', `/api/admin/sessions/${tue.id}/roster`, { playerId: id[n], action: 'confirm' });
    await call(admin.request, 'POST', `/api/admin/sessions/${tue.id}/payment`, { playerId: id[n], paid: true });
  }
  await call(admin.request, 'POST', `/api/admin/sessions/${tue.id}/decision`, { decision: 'cancel', confirm: true });

  const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
  for (const name of ['Brandon', 'Christopher', 'Maximiliana']) {
    await check(`${name}: the name is whole next to the CREDIT chip, no overlap, at 360/375/390/430 light and dark`, async () => {
      const problems = [];
      for (const width of [360, 375, 390, 430]) {
        for (const scheme of ['light', 'dark']) {
          const ctx = await browser.newContext({ viewport: { width, height: 800 }, isMobile: true, hasTouch: true, colorScheme: scheme, userAgent: UA });
          await ctx.request.post(BASE + '/api/me', { data: { playerId: id[name] }, headers: { Origin: BASE } });
          const page = await ctx.newPage();
          await page.goto(BASE);
          await page.locator('header [data-credit-chip]').waitFor();
          const m = await page.evaluate(() => {
            const box = (el) => el && el.getBoundingClientRect();
            const h1 = document.querySelector('header h1');
            const parts = [h1, document.querySelector('header .not-you'), document.querySelector('header [data-credit-chip]'), document.querySelector('header .today'), document.querySelector('header .topbar-tools')]
              .filter(Boolean)
              .map(box);
            let overlap = 0;
            for (let i = 0; i < parts.length; i++)
              for (let j = i + 1; j < parts.length; j++) {
                const a = parts[i];
                const b = parts[j];
                if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) overlap++;
              }
            return {
              text: h1.textContent,
              cutWide: h1.scrollWidth > h1.clientWidth + 1,
              cutTall: h1.scrollHeight > h1.clientHeight + 1,
              overlap,
              sideways: document.documentElement.scrollWidth - window.innerWidth,
            };
          });
          if (m.text !== name || m.cutWide || m.cutTall || m.overlap || m.sideways > 0) problems.push(`${width} ${scheme}: ${JSON.stringify(m)}`);
          if (width === 390 || width === 360) await page.screenshot({ path: path.join(SHOTS, `dryrun-header-${name}-${width}-${scheme}.png`), clip: { x: 0, y: 0, width, height: 130 } });
          await ctx.close();
        }
      }
      assert(problems.length === 0, problems.join(' | '));
    });
  }

  // Thursday: 6 in and paid, Ryan only tapped "I paid", nobody confirmed it.
  for (const n of ['Mitchel', 'Brandon', 'Julian', 'Christopher', 'Maximiliana']) {
    await call(admin.request, 'POST', `/api/admin/sessions/${thu.id}/roster`, { playerId: id[n], action: 'confirm' });
    await call(admin.request, 'POST', `/api/admin/sessions/${thu.id}/payment`, { playerId: id[n], paid: true });
  }
  await call(admin.request, 'POST', `/api/admin/sessions/${thu.id}/roster`, { playerId: id.Ryan, action: 'confirm' });
  const ryan = await browser.newContext();
  await ryan.request.post(BASE + '/api/me', { data: { playerId: id.Ryan }, headers: { Origin: BASE } });
  await call(ryan.request, 'POST', `/api/sessions/${thu.id}/paid`, { paid: true });
  await clock('2026-10-29T22:05:00-04:00');

  const WARN = 'Ryan tapped I paid, not confirmed yet. Confirm or finalize anyway.';
  for (const scheme of ['light', 'dark']) {
    await check(`Finalize card warns "${WARN}" before the final tap (${scheme}), and in the Who played sheet`, async () => {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, colorScheme: scheme });
      await ctx.request.post(BASE + '/api/admin/login', { data: { pin: PIN }, headers: { Origin: BASE } });
      const page = await ctx.newPage();
      await page.goto(BASE + '/admin');
      const card = page.locator(`[data-finalize="${thu.id}"]`);
      await card.waitFor();
      const warn = card.locator('[data-unconfirmed-paid]');
      assert(squash(await warn.innerText()) === WARN, `card warning: ${await warn.innerText()}`);
      // Above the buttons.
      const w = await warn.boundingBox();
      const b = await card.locator('[data-everyone-played]').boundingBox();
      assert(w.y + w.height <= b.y, 'warning is not above Everyone played');
      await page.screenshot({ path: path.join(SHOTS, `dryrun-finalize-warning-${scheme}.png`), fullPage: false });
      await card.locator('[data-change-played]').click();
      const sheet = page.locator('[data-who-played]');
      await sheet.waitFor();
      assert(squash(await sheet.locator('[data-unconfirmed-paid]').innerText()) === WARN, 'sheet warning missing');
      await ctx.close();
    });
  }

  await check('once the organizer confirms Ryan, the warning is gone', async () => {
    await call(admin.request, 'POST', `/api/admin/sessions/${thu.id}/payment`, { playerId: id.Ryan, paid: true });
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await ctx.request.post(BASE + '/api/admin/login', { data: { pin: PIN }, headers: { Origin: BASE } });
    const page = await ctx.newPage();
    await page.goto(BASE + '/admin');
    const card = page.locator(`[data-finalize="${thu.id}"]`);
    await card.waitFor();
    assert((await card.locator('[data-unconfirmed-paid]').count()) === 0, 'warning still there');
    await ctx.close();
  });

  await browser.close();
  rmSync(dbFile, { force: true });
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
