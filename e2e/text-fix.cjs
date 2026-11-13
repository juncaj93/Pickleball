/* Zip 40 "Text the players wording" in a real browser.
 *
 *   node e2e/text-fix.cjs
 *
 * Opens the gear menu > Text the players for a game today, tomorrow and 4 days out (fake clock: Fri Nov 13, 2026, 12:00 PM Eastern) and
 * reads the day word in both tabs. 390 px wide, light and dark. Starts its own dev server with a fake group. Nothing touches the live site.
 */
const { spawn } = require('node:child_process');
const { rmSync, mkdirSync } = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.E2E_PORT) || 5291;
const BASE = `http://localhost:${PORT}`;
const SETUP_TOKEN = 'textfix-setup-token-0123456789';
const PIN = '483920';
const NAMES = ['Alex', 'Ryan', 'Julian', 'Nathan', 'Mitchel', 'Brandon', 'Devon', 'Casey'];
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

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
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
const squash = (t) => t.replace(/\s+/g, ' ').trim();

async function main() {
  const dbFile = path.join(ROOT, '.data', 'textfix.sqlite');
  mkdirSync(path.join(ROOT, '.data'), { recursive: true });
  rmSync(dbFile, { force: true });
  const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
    cwd: ROOT,
    env: { ...process.env, DEV_DB: dbFile, SETUP_TOKEN, DEV_CLOCK: '1', LATE_FEES: '', MOTION: '' },
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
  const setClock = (atMs) => fetch(`${BASE}/__dev/clock`, { method: 'POST', body: JSON.stringify({ atMs }) });
  await setClock(Date.now());

  const browser = await chromium.launch();
  const post = (req, url, data, headers = {}) => req.post(BASE + url, { data, headers: { Origin: BASE, ...headers } });
  const put = (req, url, data) => req.put(BASE + url, { data, headers: { Origin: BASE } });
  const setup = (await browser.newContext()).request;
  const made = await post(setup, '/api/setup', {
    setupToken: SETUP_TOKEN,
    groupName: 'Pickleball',
    pin: PIN,
    venmoUrl: 'https://venmo.com/u/organizer',
    players: NAMES.map((name, i) => ({ name, phone: `24855507${String(i).padStart(2, '0')}` })),
  });
  if (!made.ok()) throw new Error(`setup failed: ${await made.text()}`);
  const areq = (await browser.newContext()).request;
  await post(areq, '/api/admin/login', { pin: PIN });
  await put(areq, '/api/admin/group', { organizerName: 'Alex' });
  let d = await (await areq.get(`${BASE}/api/admin/dashboard`)).json();
  for (const h of d.hiddenSessions || []) await post(areq, `/api/admin/sessions/${h.id}/show`, { shown: true });
  d = await (await areq.get(`${BASE}/api/admin/dashboard`)).json();
  const idOf = (n) => d.players.find((p) => p.name === n).id;
  const phones = {};
  for (const n of NAMES) {
    const c = await browser.newContext();
    await post(c.request, '/api/me', { playerId: idOf(n) });
    phones[n] = c.request;
  }
  // Fake clock: Fri Nov 13, 2026, 12:00 PM Eastern.
  await setClock(Date.parse('2026-11-13T17:00:00Z'));
  const GAMES = [
    ['Today game', '2026-11-14T01:00:00Z', "today's game"],
    ['Tomorrow game', '2026-11-15T01:00:00Z', "tomorrow's game"],
    ['Fourday game', '2026-11-18T01:00:00Z', "Tuesday's game"],
  ];
  const GAME_ID = {};
  for (const [note, startsAt] of GAMES) {
    const dash = await (await areq.get(`${BASE}/api/admin/dashboard`)).json();
    let id = dash.sessions.find((s) => Date.parse(s.startsAt) === Date.parse(startsAt))?.id;
    if (!id) {
      const r = await post(areq, '/api/admin/sessions', { startsAt, endsAt: new Date(Date.parse(startsAt) + 2 * 3600_000).toISOString(), note });
      if (!r.ok()) throw new Error(`add game: ${await r.text()}`);
      id = (await r.json()).id;
    }
    GAME_ID[note] = id;
    await post(areq, `/api/admin/sessions/${id}/court-status`, { status: 'booked' });
    for (const n of ['Ryan', 'Julian']) await post(phones[n], `/api/sessions/${id}/join`, {});
  }

  const phone = (scheme = 'light', width = 393) => ({ viewport: { width, height: 852 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: scheme, userAgent: UA });
  async function open(who, { scheme = 'light', width = 393, query = '' } = {}) {
    const ctx = await browser.newContext(phone(scheme, width));
    await post(ctx.request, '/api/me', { playerId: idOf(who) });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/${query}`);
    await page.locator('.schedule article.sched').first().waitFor();
    return { ctx, page };
  }
  async function openAdmin({ width = 390, scheme = 'light', query = '?latefees=on&adminr2=on' } = {}) {
    const ctx = await browser.newContext(phone(scheme, width));
    await post(ctx.request, '/api/admin/login', { pin: PIN });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/admin${query}`);
    await page.locator('article.scard, article.card').first().waitFor();
    return { ctx, page };
  }
  const tab = async (page, name) => {
    await page.locator('.tabbar button', { hasText: name }).evaluate((b) => b.click());
    await page.waitForTimeout(300);
  };
  const row = (page, s) => page.locator(`#row-${s.id}`);
  const noSideScroll = async (page, what) => {
    const [sw, cw] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
    assert(sw <= cw + 1, `${what}: the page scrolls sideways: ${sw} > ${cw}`);
  };
  const dialogText = async (page) => squash(await page.locator('dialog[open]').innerText());

  /** Open the gear menu of the card that holds `who`, and pick the menu item `name`. */
  async function gearPick(page, who, name) {
    const gear = page.getByRole('button', { name: /^Game menu for / }).filter({ visible: true });
    const n = await gear.count();
    for (let i = 0; i < n; i++) {
      const owner = await gear.nth(i).evaluate((b) => b.closest('article')?.textContent || '');
      if (!owner.includes(who)) continue;
      await gear.nth(i).click();
      const item = page.getByRole('menuitem', { name });
      if (await item.count()) {
        await item.first().click();
        return;
      }
      await page.keyboard.press('Escape');
    }
    throw new Error(`no gear menu item ${name} on the card with ${who}`);
  }


  for (const [scheme, width] of [
    ['light', 390],
    ['dark', 390],
  ]) {
    for (const [note, , word] of GAMES) {
      await check(`${scheme} ${width}px: ${note}: both tabs say ${word}`, async () => {
        const { ctx, page } = await openAdmin({ scheme, width, query: '?latefees=on&adminr2=off&adminv2=off' });
        await gearPick(page, note === 'Fourday game' ? 'Nov 17' : note === 'Tomorrow game' ? 'Nov 14' : 'Nov 13', /Text the players/);
        const box = page.locator('[data-players-text]');
        await box.waitFor({ timeout: 6000 });
        for (const pick of ['court_canceled', 'court_booked']) {
          await box.locator(`[data-pick="${pick}"]`).click();
          const t = await box.locator('textarea').inputValue();
          assert(t.includes(`back out of ${word}.`), `${pick}: ${t.slice(0, 80)}`);
          if (word !== "today's game") assert(!/today|tonight|this evening/i.test(t), `${pick} still says today/tonight`);
        }
        await noSideScroll(page, 'Text the players');
        await ctx.close();
      });
    }
  }

  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
