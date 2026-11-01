/* "Good news, a spot opened up, so you're in." shows only the FIRST time (Alex, Nov 1):
 *   - shows the first time the promoted player sees the game, and stays for that visit (5-second refresh)
 *   - gone for good after a reload, and after the 5-second refresh that follows it
 *   - a brand new promotion on a different game still shows once (also when it lands while the page is open)
 *   - organizer's "View as..." (demo): shows once per demo session; the real phone memory is untouched
 *   - fits at 320 px and 390 px, light and dark
 * Fake group, fake clock: Fri Oct 30, 9:00 AM Eastern. Max players 4.
 *
 *   node e2e/good-news.cjs      (also run by npm run test:e2e)
 */
const { spawn } = require('node:child_process');
const { rmSync, mkdirSync } = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.E2E_PORT) || 5241;
const BASE = `http://localhost:${PORT}`;
const SETUP_TOKEN = 'goodnews-setup-token-0123456789';
const PIN = '482913';
const NAMES = ['Alex', 'Nathan', 'Ryan', 'Mitchel', 'Brandon', 'Julian', 'Dana'];
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const NEWS = "Good news, a spot opened up, so you're in.";

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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const dbFile = path.join(ROOT, '.data', 'goodnews.sqlite');
  mkdirSync(path.join(ROOT, '.data'), { recursive: true });
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
    await sleep(500);
  }
  await fetch(`${BASE}/__dev/clock`, { method: 'POST', body: JSON.stringify({ atMs: Date.parse('2026-10-30T09:00:00-04:00') }) });

  const browser = await chromium.launch();
  const post = (req, url, data) => req.post(BASE + url, { data, headers: { Origin: BASE } });
  const setup = (await browser.newContext()).request;
  const made = await post(setup, '/api/setup', {
    setupToken: SETUP_TOKEN,
    groupName: 'Pickleball Bros',
    pin: PIN,
    venmoUrl: 'https://venmo.com/u/organizer',
    players: NAMES.map((name, i) => ({ name, phone: `24855504${String(i).padStart(2, '0')}` })),
  });
  if (!made.ok()) throw new Error(`setup failed: ${await made.text()}`);
  const adminCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, userAgent: UA });
  await post(adminCtx.request, '/api/admin/login', { pin: PIN });
  await adminCtx.request.put(BASE + '/api/admin/group', { data: { settings: { maxPlayers: 4 } }, headers: { Origin: BASE } });
  const dash = async () => (await adminCtx.request.get(`${BASE}/api/admin/dashboard`)).json();
  let d = await dash();
  for (const h of d.hiddenSessions || []) await post(adminCtx.request, `/api/admin/sessions/${h.id}/show`, { shown: true });
  d = await dash();
  const games = d.sessions.filter((s) => !s.state.flags.past);
  for (const s of games) await post(adminCtx.request, `/api/admin/sessions/${s.id}/booked`, {});
  const tue = games.find((s) => s.startsAt.startsWith('2026-11-04T01:00')); // Tue Nov 3, 8 PM Eastern
  const thu = games.find((s) => s.startsAt.startsWith('2026-11-06T01:00')); // Thu Nov 5, 8 PM Eastern
  assert(tue && thu, `games: ${games.map((g) => g.startsAt)}`);
  const idOf = (n) => d.players.find((p) => p.name === n).id;
  const who = {};
  for (const n of NAMES) {
    const c = await browser.newContext();
    await post(c.request, '/api/me', { playerId: idOf(n) });
    who[n] = c.request;
  }
  const join = (n, s) => post(who[n], `/api/sessions/${s.id}/join`, {});
  const drop = (n, s) => post(who[n], `/api/sessions/${s.id}/withdraw`, {});

  // Tue: four in, Julian waits, Nathan drops: Julian moves in.
  for (const n of ['Nathan', 'Ryan', 'Mitchel', 'Brandon']) await join(n, tue);
  const j = await (await join('Julian', tue)).json();
  assert(j.result === 'waitlisted', `Julian should wait on Tue: ${JSON.stringify(j)}`);
  await drop('Nathan', tue);
  const tueMine = (await (await who.Julian.get(`${BASE}/api/group`)).json()).sessions.find((s) => s.id === tue.id).mine;
  assert(tueMine.status === 'confirmed' && tueMine.promotion === 'spot_opened', `Julian moved in on Tue: ${JSON.stringify(tueMine)}`);

  const phone = (w, scheme) => ({ viewport: { width: w, height: 800 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: UA, colorScheme: scheme });
  const noteIn = (page, s) => page.locator(`#row-${s.id}`).getByText(NEWS);

  // One phone for Julian, kept for the whole run (its browser storage is the memory).
  const jctx = await browser.newContext(phone(390, 'light'));
  await post(jctx.request, '/api/me', { playerId: idOf('Julian') });
  const jp = await jctx.newPage();

  await check('first look: the note shows on the game Julian moved into', async () => {
    await jp.goto(BASE);
    await jp.locator(`#row-${tue.id}`).waitFor();
    await noteIn(jp, tue).waitFor({ timeout: 4000 });
  });

  await check('same visit: still there after the 5-second refresh (no blink)', async () => {
    // Something changes so the refresh really reloads the list.
    await join('Dana', thu);
    await jp.locator(`#row-${thu.id}`).getByText('Dana').waitFor({ timeout: 15000 });
    assert(await noteIn(jp, tue).isVisible(), 'the note vanished during the visit it first showed in');
  });

  await check('reload: gone for good, and the 5-second refresh does not bring it back', async () => {
    await jp.reload();
    await jp.locator(`#row-${tue.id}`).waitFor();
    await sleep(800);
    assert((await noteIn(jp, tue).count()) === 0, 'the note came back after a reload');
    await join('Nathan', thu);
    await jp.locator(`#row-${thu.id}`).getByText('Nathan').waitFor({ timeout: 15000 });
    assert((await noteIn(jp, tue).count()) === 0, 'the note came back after the refresh');
    // Julian is still really in, with the promotion on the server: only the phone's memory hides it.
    const m = (await (await who.Julian.get(`${BASE}/api/group`)).json()).sessions.find((s) => s.id === tue.id).mine;
    assert(m.promotion === 'spot_opened', 'server promotion should be untouched');
  });

  await check('a new promotion on a different game shows once, even when it lands while the page is open', async () => {
    // Thu: Dana, Nathan in; Ryan and Mitchel make 4; Julian waits; Ryan drops: Julian moves in.
    for (const n of ['Ryan', 'Mitchel']) await join(n, thu);
    const r = await (await join('Julian', thu)).json();
    assert(r.result === 'waitlisted', `Julian should wait on Thu: ${JSON.stringify(r)}`);
    await drop('Ryan', thu);
    await noteIn(jp, thu).waitFor({ timeout: 15000 });
    assert((await noteIn(jp, tue).count()) === 0, 'the old Tue note came back with the new one');
    await jp.reload();
    await jp.locator(`#row-${thu.id}`).waitFor();
    await sleep(800);
    assert((await noteIn(jp, thu).count()) === 0 && (await noteIn(jp, tue).count()) === 0, 'a note came back after reload');
  });

  await check('a new phone (or cleared storage) is a first look again; another name on the same phone has its own memory', async () => {
    const other = await browser.newContext(phone(390, 'light'));
    await post(other.request, '/api/me', { playerId: idOf('Julian') });
    const p = await other.newPage();
    await p.goto(BASE);
    await noteIn(p, tue).waitFor({ timeout: 4000 });
    await other.close();
  });

  for (const [w, scheme] of [
    [320, 'light'],
    [320, 'dark'],
    [390, 'dark'],
  ]) {
    await check(`fits at ${w} px, ${scheme}: no sideways scroll, note inside its card, readable`, async () => {
      const c = await browser.newContext(phone(w, scheme));
      await post(c.request, '/api/me', { playerId: idOf('Julian') });
      const p = await c.newPage();
      await p.goto(BASE);
      const n = noteIn(p, tue);
      await n.waitFor({ timeout: 4000 });
      const r = await p.evaluate(
        ({ id, text }) => {
          const card = document.getElementById(`row-${id}`).getBoundingClientRect();
          const el = [...document.querySelectorAll(`#row-${id} *`)].find((e) => e.textContent.trim() === text && e.children.length === 0) || null;
          const box = el.closest('[role="status"], .notice, div').getBoundingClientRect();
          const cs = getComputedStyle(el);
          return { sw: document.documentElement.scrollWidth, iw: window.innerWidth, inCard: box.left >= card.left - 0.5 && box.right <= card.right + 0.5, color: cs.color };
        },
        { id: tue.id, text: NEWS },
      );
      assert(r.sw <= r.iw, `sideways scroll ${r.sw} > ${r.iw}`);
      assert(r.inCard, 'note sticks out of its card');
      await c.close();
    });
  }

  await check('View as (demo): the organizer sees the note once per demo session; the real phone memory is untouched', async () => {
    const page = await adminCtx.newPage();
    await page.goto(`${BASE}/admin`);
    for (let round = 0; round < 2; round++) {
      await page.getByRole('button', { name: 'View as…' }).click();
      await page.locator('dialog[open]').getByRole('button', { name: 'Julian', exact: true }).click();
      await page.getByRole('region', { name: 'Viewing as a player' }).getByText('Viewing as').waitFor();
      await noteIn(page, tue).waitFor({ timeout: 6000 });
      await noteIn(page, thu).waitFor({ timeout: 6000 });
      await page.getByRole('region', { name: 'Viewing as a player' }).getByRole('button', { name: 'Exit' }).click();
      await page.getByRole('button', { name: 'View as…' }).waitFor();
    }
    const saved = await page.evaluate(() => localStorage.getItem('pb_good_news_seen'));
    assert(saved === null, `demo wrote to the phone memory: ${saved}`);
    await page.close();
    // Julian's own phone still never sees it again.
    await jp.reload();
    await jp.locator(`#row-${tue.id}`).waitFor();
    await sleep(500);
    assert((await noteIn(jp, tue).count()) === 0 && (await noteIn(jp, thu).count()) === 0, 'demo brought the note back on the real phone');
  });

  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
