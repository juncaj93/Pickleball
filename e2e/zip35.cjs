/* Zip 35: Second Chance past closing (Part A) and "Tap guard fix" (Part B, TAP_GUARD_FIX, ships OFF).
 *
 *   node e2e/zip35.cjs      (also run by npm run test:e2e)
 *
 * The SMALL fake world (the 10 fixed names) on its own dev server, with the clock moved to noon on its Second Chance game day; nothing touches
 * Cloudflare.
 *   A1  Second Chance with Booking hours ON: the Reopen picker of a game near closing (8:00 PM to 10:00 PM) ends at 8:00 PM; with Booking hours
 *       OFF the old list (to 9:30 PM) is back, so nothing changed for OFF;
 *   A2  a time past closing sent anyway is refused and the game stays canceled with nothing moved; a fitting time reopens and moves it;
 *   A3  the card's "no time fits" message and the normal step 2 card stay inside the screen at 390/360/320, light and dark, text 100 and 150%.
 *   B1  Settings > Feature switches: "Tap guard fix" is the TOP row, can be tapped off and on, and holds at 390/360/320, light and dark;
 *   B2  the guard on real clicks (buttons placed on the page): OFF is today's rule (a close tap on another button is dropped, the same button
 *       twice is not); ON drops the same button twice, lets a neighbour through, and still drops a tap on another button when the first
 *       button went away or moved; text boxes are never dropped;
 *   B3  Hide from list, then Hide it, 14 px and 10 ms apart: OFF drops the second tap (today), ON hides the game;
 *   B4  Mark paid double tapped (switch OFF and ON): one request, the neighbouring row is NOT paid, and the Undo toast is not hit;
 *   B5  the player's Pay sheet (switch OFF and ON): Pay double tapped opens one sheet, I paid double tapped sends one request.
 */
const { spawn, spawnSync } = require('node:child_process');
const { readFileSync, mkdirSync, rmSync } = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { findClipping } = require('./clip-check.cjs');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.E2E_PORT) || 5435;
const BASE = `http://localhost:${PORT}`;
const NOW0_ISO = '2026-11-12T23:00:00.000Z'; // Thu Nov 12, 6:00 PM Eastern: the world is built as of this moment
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
    console.log(`  ✗ ${name}\n      ${String(err && err.message ? err.message : err).replace(/\s*\n\s*/g, ' ⏎ ').slice(0, 1600)}`);
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const dbFile = path.join(ROOT, '.data', 'zip35.sqlite');
  mkdirSync(path.join(ROOT, '.data'), { recursive: true });
  rmSync(dbFile, { force: true });
  const seeded = spawnSync('npx', ['vite-node', 'scripts/load-small-local.ts', '--', dbFile, NOW0_ISO], { cwd: ROOT, encoding: 'utf8' });
  if (seeded.status !== 0) throw new Error(`could not build the fake world: ${seeded.stderr || seeded.stdout}`);
  if (await fetch(`${BASE}/api/status`).then((r) => r.ok, () => false)) throw new Error(`port ${PORT} is already in use`);
  const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
    cwd: ROOT,
    env: { ...process.env, DEV_DB: dbFile, SETUP_TOKEN: 'zip35-setup-token-0123456789', DEV_CLOCK: '1' },
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
  await fetch(`${BASE}/__dev/clock`, { method: 'POST', body: JSON.stringify({ atMs: Date.parse(NOW0_ISO) }) });
  const browser = await chromium.launch();
  const orgCtx = await browser.newContext();
  const call = async (method, url, data, headers = {}) => {
    const res = await orgCtx.request.fetch(BASE + url, { method, data, headers: { Origin: BASE, ...headers } });
    return { status: res.status(), ok: res.ok(), json: await res.json().catch(() => ({})) };
  };
  if (!(await call('POST', '/api/admin/login', { pin: PIN })).ok) throw new Error('login failed');
  const dash = async (headers) => (await call('GET', '/api/admin/dashboard', undefined, headers)).json;
  const d0 = await dash();
  assert(d0.instantTaps === true, 'the preview world should have Instant taps on (the guard only runs then)');
  assert(d0.bookingHours === true && d0.bookingHoursForAll === true, 'the preview world should have Booking hours on');
  assert(d0.tapGuardFixForAll === true, 'the preview world should have Tap guard fix on (PREVIEW SWITCHES RULE)');

  // ---- Second Chance: the game near closing (8:00 PM) and its day
  const eastern = (iso) => new Date(iso).toLocaleString('en-US', { timeZone: 'America/Detroit', hour: 'numeric', minute: '2-digit' });
  const lateGame = d0.sessions.find((s) => s.state.flags.canceled && s.confirmedCount === 3 && eastern(s.startsAt) === '8:00 PM');
  assert(lateGame, 'the Second Chance game near closing time (8:00 PM, canceled the night before, 3 in) is missing from the preview world');
  const dayKey = new Date(lateGame.startsAt).toLocaleDateString('en-CA', { timeZone: 'America/Detroit' }); // 2026-11-17
  const GAME_DAY_MS = Date.parse(`${dayKey}T12:00:00-05:00`); // noon on its game day (EST)
  // Part B runs at the world's own "now" (Thu Nov 12, 6:00 PM, so its Money games are as seeded); Part A moves the clock to noon on game day.
  let NOW_MS = Date.parse(NOW0_ISO);
  const setClock = async (ms) => {
    NOW_MS = ms;
    await fetch(`${BASE}/__dev/clock`, { method: 'POST', body: JSON.stringify({ atMs: ms }) });
  };

  async function shift(ctx) {
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
  }
  async function openAdmin({ width = 390, scheme = 'light', pct = 100, url = '/admin', height = 800, tab } = {}) {
    const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, colorScheme: scheme, isMobile: true, hasTouch: true, userAgent: UA, reducedMotion: 'reduce' });
    await shift(ctx);
    assert((await ctx.request.post(BASE + '/api/admin/login', { data: { pin: PIN }, headers: { Origin: BASE } })).ok(), 'admin login');
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(BASE + url);
    await page.locator('.tabbar').waitFor({ timeout: 20000 });
    await page.waitForTimeout(700);
    if (pct !== 100) await page.addStyleTag({ content: `html { font-size: ${pct}% !important; } body { font-size: ${(17 * pct) / 100}px !important; }` });
    if (tab) {
      await page.locator('.tabbar button', { hasText: tab }).click();
      await page.waitForTimeout(500);
    }
    return { ctx, page, errors };
  }
  const sc = (id, body) => call('POST', `/api/admin/sessions/${id}/second-chance`, body);
  const card = (page) => page.locator(`[data-sc-card="chance"][data-session="${lateGame.id}"]`);
  const pickerLabels = (page) => card(page).locator('select[aria-label="Start time"] option').evaluateAll((os) => os.map((o) => o.textContent.trim()));
  const gameNow = async () => (await dash()).sessions.find((s) => s.id === lateGame.id);
  const setHours = (on) => call('PUT', '/api/admin/booking-hours-switch', { on });

  // ================================================================ Part B
  const setGuard = (on) => call('PUT', '/api/admin/tap-guard-switch', { on });
  await check('B1: the Settings row "Tap guard fix" is the TOP row, can be tapped off and on, holds at 390/360/320, light and dark', async () => {
    assert((await dash()).tapGuardFixForAll === true, 'on in the seed');
    assert((await setGuard(false)).ok, 'off');
    assert((await dash()).tapGuardFixForAll === undefined, 'off after the row is off');
    for (const scheme of ['light', 'dark']) {
      for (const width of [390, 360, 320]) {
        const { ctx, page } = await openAdmin({ width, scheme, tab: 'Settings' });
        for (const s of await page.locator('details > summary').all()) await s.click().catch(() => {});
        const first = await page.locator('#switches [data-row], [data-switches-tidy] [data-row]').evaluateAll((els) => els.slice(0, 3).map((e) => e.getAttribute('data-row')));
        assert(first[0] === 'tapGuardFixAll' && first[1] === 'extendedTimeAll', `newest first: ${first}`);
        const r = page.locator('[data-row="tapGuardFixAll"]');
        await r.scrollIntoViewIfNeeded();
        assert(/Tap guard fix/.test(await r.innerText()), 'row label');
        assert(!(await r.locator('input[type=checkbox]').isChecked()), 'the row starts off here');
        const problems = await page.evaluate(findClipping, { root: '[data-row="tapGuardFixAll"]' });
        assert(problems.length === 0, `${scheme} ${width}: ${problems.join(' | ')}`);
        const sideways = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        assert(sideways <= 1, `${scheme} ${width}: sideways ${sideways}px`);
        if (scheme === 'light' && width === 390) {
          await r.locator('label').click();
          await page.waitForTimeout(900);
          assert((await dash()).tapGuardFixForAll === true, 'on for everyone after the tap');
          await r.locator('label').click();
          await page.waitForTimeout(900);
          assert((await dash()).tapGuardFixForAll === undefined, 'off again after the second tap');
        }
        await ctx.close();
      }
    }
  });

  /** Put test buttons on the page, tap them with the real mouse, and report what each received. */
  async function guardScene(page, scene) {
    return page.evaluate(async (scene) => {
      const host = document.createElement('div');
      host.id = 'tap-lab';
      host.style.cssText = 'position:fixed;left:0;top:0;width:100%;height:100%;z-index:99999;background:#fff';
      host.innerHTML = `<button id="A" style="position:absolute;left:20px;top:40px;width:120px;height:44px">A</button>
        <button id="B" style="position:absolute;left:20px;top:100px;width:120px;height:44px">B</button>
        <button id="C" style="position:absolute;left:20px;top:300px;width:120px;height:44px">C</button>
        <input id="T" type="text" style="position:absolute;left:200px;top:40px;width:120px;height:44px">`;
      document.body.appendChild(host);
      const hits = { A: 0, B: 0, C: 0, T: 0 };
      for (const id of ['A', 'B', 'C', 'T']) host.querySelector('#' + id).addEventListener('click', () => (hits[id] += 1));
      window.__tapLab = { host, hits };
      return scene ? scene(hits) : hits;
    }, scene);
  }
  async function clickAt(page, sel, dx = 0, dy = 0) {
    const b = await page.locator(sel).boundingBox();
    await page.mouse.click(b.x + b.width / 2 + dx, b.y + b.height / 2 + dy);
  }
  const hitsOf = (page) => page.evaluate(() => ({ ...window.__tapLab.hits }));

  /** One real-mouse scenario against the guard, on a fresh admin page with the Tap guard fix in the given state. */
  async function lab(on, steps) {
    const { ctx, page } = await openAdmin({ url: on ? '/admin?tapguard=on' : '/admin?tapguard=off' });
    assert((await page.evaluate(() => 1)) === 1, 'page');
    await guardScene(page);
    const out = await steps(page);
    await ctx.close();
    return out;
  }
  await check('B2: the guard on real clicks. OFF is today\'s rule; ON drops a repeat on the same button, lets a neighbour through, and still drops a tap on another button when the first one went away or moved', async () => {
    assert((await setGuard(false)).ok, 'row off, so only the private link decides');
    // Instant taps (and so the guard) must be on for the page; the world has it on for everyone.
    for (const on of [false, true]) {
      // 1. the same button twice, fast
      let h = await lab(on, async (page) => {
        await clickAt(page, '#A');
        await clickAt(page, '#A');
        return hitsOf(page);
      });
      assert(on ? h.A === 1 : h.A === 2, `same button twice, tap guard ${on ? 'ON' : 'OFF'}: A got ${h.A} (ON must drop the repeat, OFF is today's: both count)`);
      // 2. two buttons side by side (56 px apart centers would be outside 24 px, so tap close to each other's edge: 10 px apart)
      h = await lab(on, async (page) => {
        const a = await page.locator('#A').boundingBox();
        const b = await page.locator('#B').boundingBox();
        // A's bottom edge, then B's top edge: 100 - 84 = 16 px apart.
        await page.mouse.click(a.x + 60, a.y + a.height - 1);
        await page.waitForTimeout(280); // a quick but aimed tap: after 0.2 s
        await page.mouse.click(b.x + 60, b.y + 1);
        return hitsOf(page);
      });
      assert(on ? h.A === 1 && h.B === 1 : h.A === 1 && h.B === 0, `two neighbours, tap guard ${on ? 'ON' : 'OFF'}: A=${h.A} B=${h.B} (ON: both; OFF: B dropped, as today)`);
      // 2b. the same neighbours tapped back to back (under 0.2 s): the second half of a double tap, dropped in both
      h = await lab(on, async (page) => {
        const a = await page.locator('#A').boundingBox();
        const b = await page.locator('#B').boundingBox();
        await page.mouse.click(a.x + 60, a.y + a.height - 1);
        await page.mouse.click(b.x + 60, b.y + 1);
        return hitsOf(page);
      });
      assert(h.A === 1 && h.B === 0, `neighbours tapped back to back, tap guard ${on ? 'ON' : 'OFF'}: A=${h.A} B=${h.B} (B must be dropped)`);
      // 3. far apart: always both
      h = await lab(on, async (page) => {
        await clickAt(page, '#A');
        await clickAt(page, '#C');
        return hitsOf(page);
      });
      assert(h.A === 1 && h.C === 1, `far apart, tap guard ${on ? 'ON' : 'OFF'}: A=${h.A} C=${h.C}`);
      // 4. the first button goes away when tapped, the next lands on B under the same finger spot: dropped in both
      h = await lab(on, async (page) => {
        await page.evaluate(() => {
          const A = document.querySelector('#A');
          A.addEventListener('click', () => A.remove());
        });
        const a = await page.locator('#A').boundingBox();
        const b = await page.locator('#B').boundingBox();
        await page.mouse.click(a.x + 60, a.y + a.height - 1);
        await page.mouse.click(b.x + 60, b.y + 1);
        return hitsOf(page);
      });
      assert(h.A === 1 && h.B === 0, `the first button vanished, tap guard ${on ? 'ON' : 'OFF'}: A=${h.A} B=${h.B} (B must be dropped: it could be the wrong person)`);
      // 5. the first button slides away (the card moved), the next lands on whatever is there now
      h = await lab(on, async (page) => {
        await page.evaluate(() => {
          const A = document.querySelector('#A');
          A.addEventListener('click', () => (A.style.top = '240px'));
        });
        const a = await page.locator('#A').boundingBox();
        const b = await page.locator('#B').boundingBox();
        await page.mouse.click(a.x + 60, a.y + a.height - 1);
        await page.mouse.click(b.x + 60, b.y + 1);
        return hitsOf(page);
      });
      assert(h.A === 1 && h.B === 0, `the first button moved, tap guard ${on ? 'ON' : 'OFF'}: A=${h.A} B=${h.B} (B must be dropped)`);
      // 6. a text box: two quick clicks are never dropped
      h = await lab(on, async (page) => {
        await clickAt(page, '#T');
        await clickAt(page, '#T');
        return hitsOf(page);
      });
      assert(h.T === 2, `text box twice, tap guard ${on ? 'ON' : 'OFF'}: T=${h.T}`);
      // 7. a label and its switch: the browser sends the switch its own click for the label tap; that is ONE tap and must toggle it
      const sw = await lab(on, async (page) => {
        await page.evaluate(() => {
          const host = document.querySelector('#tap-lab');
          host.insertAdjacentHTML('beforeend', '<label id="L" style="position:absolute;left:200px;top:300px;width:160px;height:44px;display:block">switch <input id="S" type="checkbox"></label>');
        });
        await clickAt(page, '#L', -40, 0);
        const once = await page.evaluate(() => document.querySelector('#S').checked);
        await page.waitForTimeout(700);
        await clickAt(page, '#L', -40, 0);
        const twice = await page.evaluate(() => document.querySelector('#S').checked);
        return { once, twice };
      });
      assert(sw.once === true && sw.twice === false, `a label tapped twice, 0.7 s apart, tap guard ${on ? 'ON' : 'OFF'}: ${JSON.stringify(sw)} (each tap must toggle it)`);
    }
    assert((await setGuard(true)).ok, 'row back on');
  });

  /** The Money tab game that can be hidden ("Test game") and its two buttons. */
  async function hideScene(on) {
    const { ctx, page } = await openAdmin({ url: on ? '/admin?tapguard=on' : '/admin?tapguard=off', tab: 'Money' });
    const requests = [];
    page.on('request', (r) => {
      if (r.method() !== 'POST' && r.method() !== 'PUT') return;
      if (/hide|hidden/i.test(new URL(r.url()).pathname)) requests.push(new URL(r.url()).pathname);
    });
    return { ctx, page, requests };
  }
  await check('B3: Hide from list, then Hide it, 14 px and a few milliseconds apart: OFF drops the second tap (today), ON hides the game', async () => {
    assert((await setGuard(false)).ok, 'row off');
    const tests = (await dash()).sessions.filter((s) => s.note === 'Test game');
    assert(tests.length === 1, `the "Test game" scene: ${tests.length}`);
    for (const on of [false, true]) {
      const { ctx, page, requests } = await hideScene(on);
      // The test game was canceled early with nobody in: before today with nothing owed, so it sits in Previous games (as in e2e/money-rework.cjs).
      await page.locator('[data-fold="previous"] .mrw-fold-head').click();
      const row = page.locator(`[data-fold="previous"] .mrw-prow[data-session="${tests[0].id}"]`);
      await row.waitFor({ timeout: 15000 });
      await page.waitForTimeout(600); // a person's pace: the page's fast-tap guard (switch off) would drop a tap this close to the one before
      await row.locator('.mrw-prow-head').click();
      const openHide = row.locator('[data-closed-body] [data-hide-from-list]');
      await openHide.waitFor({ timeout: 15000 });
      await openHide.scrollIntoViewIfNeeded();
      // Both clicks are sent as the page's own click events with a position 14 px apart, a few milliseconds apart: the fast neighbour tap.
      const out = await page.evaluate(async (id) => {
        const fire = (el, x, y) => el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, composed: true, detail: 1, clientX: x, clientY: y, view: window }));
        const first = document.querySelector('.mrw-prow[data-session="' + id + '"] [data-closed-body] [data-hide-from-list]');
        fire(first, 200, 400);
        // The question opens on the next frame.
        let confirm = null;
        for (let i = 0; i < 40 && !confirm; i++) {
          await new Promise((r) => setTimeout(r, 5));
          confirm = [...document.querySelectorAll('dialog[open] button')].find((b) => /^Hide it$/.test(b.textContent.trim()));
        }
        if (!confirm) return { opened: false };
        await new Promise((r) => setTimeout(r, 280)); // quick but aimed: after 0.2 s, still inside 400 ms
        fire(confirm, 210, 410); // 14 px away
        return { opened: true };
      }, tests[0].id);
      assert(out.opened, `tap guard ${on ? 'ON' : 'OFF'}: the question did not open`);
      // Hide waits 5 seconds for Undo before it is sent (Undo on admin toasts), so wait that out before counting requests.
      await page.waitForTimeout(6500);
      if (on) assert(requests.length >= 1, `tap guard ON: the fast second tap on Hide it did not go through (requests: ${requests.length})`);
      else assert(requests.length === 0 && (await page.locator('dialog[open]').count()) === 1, `tap guard OFF: today's guard should drop the second tap (requests: ${requests.length}, dialog open: ${await page.locator('dialog[open]').count()})`);
      await ctx.close();
    }
    assert((await setGuard(true)).ok, 'row back on');
  });

  await check('B4: Mark paid double tapped, tap guard OFF and ON: one request, the row under it is NOT paid, and the Undo toast is not hit', async () => {
    const mixed = (await dash()).sessions.find((s) => s.note === 'Mixed payments');
    assert(mixed, 'the Mixed payments game');
    assert((await setGuard(false)).ok, 'row off, so only the private link decides');
    for (const on of [false, true]) {
      const { ctx, page } = await openAdmin({ url: on ? '/admin?tapguard=on' : '/admin?tapguard=off', tab: 'Money' });
      const payments = [];
      page.on('request', (r) => {
        if (r.method() === 'POST' && /\/api\/admin\/sessions\/[^/]+\/payment$/.test(new URL(r.url()).pathname)) payments.push(r.url());
      });
      const gameCard = page.locator(`article.mrw-game[data-session="${mixed.id}"]`);
      await gameCard.waitFor({ timeout: 15000 });
      if ((await gameCard.getAttribute('data-open')) === 'no') await gameCard.locator('.mrw-toggle').click();
      await page.waitForTimeout(400);
      const rows = gameCard.locator('li').filter({ has: page.getByRole('button', { name: /Mark paid/ }) });
      const n = await rows.count();
      assert(n >= 2, `two people who owe on Mixed payments: ${n}`);
      const firstName = (await rows.nth(0).innerText()).split('\n')[0].trim();
      const secondName = (await rows.nth(1).innerText()).split('\n')[0].trim();
      await rows.nth(0).getByRole('button', { name: /Mark paid/ }).dblclick();
      // Mark paid waits 5 seconds for Undo before it is sent (Undo on admin toasts), so wait that out.
      await page.waitForTimeout(7000);
      const roster = (await dash()).sessions.find((s) => s.id === mixed.id).roster;
      const paid = (nm) => roster.find((r) => r.name === nm)?.paymentStatus === 'paid';
      assert(paid(firstName), `${firstName} should be paid (tap guard ${on ? 'ON' : 'OFF'})`);
      assert(!paid(secondName), `${secondName} was paid by the second half of the double tap (tap guard ${on ? 'ON' : 'OFF'})`);
      assert(payments.length === 1, `${payments.length} payment requests for one double tap (tap guard ${on ? 'ON' : 'OFF'})`);
      assert(!/Undone/.test(await page.locator('body').innerText()), 'the Undo toast was hit by the double tap');
      // Put it back for the next round.
      await call('POST', `/api/admin/sessions/${mixed.id}/payment`, { playerId: roster.find((r) => r.name === firstName).playerId, paid: false });
      await ctx.close();
    }
    assert((await setGuard(true)).ok, 'row back on');
  });

  await check('B5: the Pay sheet (player): Pay double tapped opens ONE sheet, I paid double tapped sends ONE request; tap guard OFF and ON', async () => {
    const vic = (await dash()).players.find((p) => p.name === 'Vic');
    assert(vic, 'Vic in the fake world');
    assert((await setGuard(false)).ok, 'row off, so only the private link decides');
    for (const on of [false, true]) {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, userAgent: UA, reducedMotion: 'reduce' });
      await shift(ctx);
      await ctx.route(/venmo\.com/, (r) => r.abort());
      await ctx.request.post(BASE + '/api/me', { data: { playerId: vic.id }, headers: { Origin: BASE } });
      const page = await ctx.newPage();
      const paid = [];
      const bad = [];
      page.on('request', (r) => {
        if (r.method() === 'POST' && /\/api\/sessions\/[^/]+\/paid$/.test(new URL(r.url()).pathname)) paid.push(r.url());
      });
      page.on('pageerror', (e) => bad.push(String(e)));
      await page.goto(BASE + (on ? '/?tapguard=on' : '/?tapguard=off'));
      const pay = page.locator('a.pay-btn:not(.m-ghost)').first();
      await pay.waitFor({ timeout: 15000 });
      await page.waitForTimeout(2000); // let the first load and the switch answer settle, as a person's first tap would come later than that
      await pay.scrollIntoViewIfNeeded();
      await pay.dblclick();
      await page.waitForTimeout(900);
      assert((await page.locator('dialog[open]').count()) === 1, `tap guard ${on ? 'ON' : 'OFF'}: ${await page.locator('dialog[open]').count()} sheets after a double tap on Pay`);
      assert(paid.length === 0, 'opening the sheet must send nothing');
      await page.locator('dialog[open]').getByRole('button', { name: 'I paid' }).dblclick();
      await page.waitForTimeout(1500);
      assert(paid.length === 1, `tap guard ${on ? 'ON' : 'OFF'}: ${paid.length} I paid requests for one double tap`);
      assert(bad.length === 0, bad.join(' | '));
      // Take Vic's I paid back so the next round starts from the same card.
      const sid = /\/api\/sessions\/([^/]+)\/paid$/.exec(new URL(paid[0]).pathname)[1];
      await call('POST', `/api/admin/sessions/${sid}/payment`, { playerId: vic.id, paid: false });
      await ctx.close();
    }
    assert((await setGuard(true)).ok, 'row back on');
  });

  // ================================================================ Part A (the clock moves to noon on game day)
  await setClock(GAME_DAY_MS);
  await check('A1: with Booking hours ON the Reopen picker of the 8:00 PM game ends at 8:00 PM; OFF gives the old list to 9:30 PM; ON again', async () => {
    assert((await sc(lateGame.id, { action: 'booking' })).ok, 'step 1 -> 2');
    const { ctx, page } = await openAdmin();
    await card(page).waitFor({ timeout: 15000 });
    let labels = await pickerLabels(page);
    assert(labels[0] === '4:00 PM' && labels.at(-1) === '8:00 PM', `ON: ${labels.join(', ')}`);
    assert(!labels.some((l) => ['8:30 PM', '9:00 PM', '9:30 PM'].includes(l)), `ON still offers a time past closing: ${labels.join(', ')}`);
    assert((await setHours(false)).ok, 'Booking hours off');
    await page.reload();
    await card(page).waitFor({ timeout: 15000 });
    labels = await pickerLabels(page);
    assert(labels.at(-1) === '9:30 PM' && labels.includes('9:00 PM'), `OFF is not the old list: ${labels.join(', ')}`);
    assert((await setHours(true)).ok, 'Booking hours back on');
    await page.reload();
    await card(page).waitFor({ timeout: 15000 });
    assert((await pickerLabels(page)).at(-1) === '8:00 PM', 'ON again');
    await ctx.close();
  });

  await check('A2: a time past closing sent anyway is refused (400) and the game stays canceled and where it was; a time that fits reopens and moves it from the screen', async () => {
    const before = await gameNow();
    assert(before.state.flags.canceled, 'the game starts canceled');
    const late = await sc(lateGame.id, { action: 'reopen', minutes: 21 * 60 });
    assert(late.status === 400, `9:00 PM answered ${late.status}`);
    const after = await gameNow();
    assert(after.state.flags.canceled && after.startsAt === before.startsAt && after.endsAt === before.endsAt, `the refused tap changed the game: canceled=${after.state.flags.canceled} ${after.startsAt}`);
    const { ctx, page } = await openAdmin();
    await card(page).waitFor({ timeout: 15000 });
    await card(page).locator('select[aria-label="Start time"]').selectOption({ label: '7:00 PM' });
    await card(page).locator('[data-sc-reopen]').click();
    await page.locator('[data-sc-card][data-session="' + lateGame.id + '"][data-sc-step="3"]').or(page.getByText('Reopened for 7:00 PM')).first().waitFor({ timeout: 10000 });
    const moved = await gameNow();
    assert(!moved.state.flags.canceled && eastern(moved.startsAt) === '7:00 PM' && eastern(moved.endsAt) === '9:00 PM', `reopened game: canceled=${moved.state.flags.canceled} ${eastern(moved.startsAt)} to ${eastern(moved.endsAt)}`);
    assert(moved.confirmedCount === 3, `its people are still in: ${moved.confirmedCount}`);
    await ctx.close();
  });

  await check('A3: the step 2 card and its "no time fits" message stay inside the screen: 390/360/320, light and dark, text 100% and 150%', async () => {
    // A fresh canceled game is needed for step 2 again: use the regular Second Chance game of that day (canceled the night before with 3 in).
    const others = (await dash()).sessions.filter((s) => s.state.flags.canceled && s.confirmedCount === 3 && s.id !== lateGame.id && new Date(s.startsAt).toLocaleDateString('en-CA', { timeZone: 'America/Detroit' }) === dayKey);
    assert(others.length >= 1, 'a second Second Chance game on that day');
    const other = others[0];
    assert((await sc(other.id, { action: 'booking' })).ok, 'step 1 -> 2');
    for (const scheme of ['light', 'dark']) {
      for (const width of [390, 360, 320]) {
        for (const pct of [100, 150]) {
          const { ctx, page } = await openAdmin({ width, scheme, pct });
          const c = page.locator(`[data-sc-card="chance"][data-session="${other.id}"]`);
          await c.waitFor({ timeout: 15000 });
          let problems = await page.evaluate(findClipping, { root: `[data-sc-card="chance"][data-session="${other.id}"]` });
          assert(problems.length === 0, `step 2 card ${scheme} ${width} ${pct}%: ${problems.join(' | ')}`);
          // The same card as it looks when no time fits (the answer is rewritten here, so no game is changed): a game 7 hours long.
          await page.route('**/api/admin/dashboard', async (route) => {
            const res = await route.fetch();
            const json = await res.json();
            for (const x of json.secondChance?.cards ?? []) if (x.kind === 'chance') x.endsAt = new Date(Date.parse(x.startsAt) + 7 * 3600_000).toISOString();
            await route.fulfill({ response: res, json });
          });
          await page.reload();
          await c.waitFor({ timeout: 15000 });
          await page.waitForTimeout(300);
          const text = await c.innerText();
          assert(/No time fits inside the venue hours/.test(text), `${scheme} ${width} ${pct}%: no message: ${text}`);
          assert(await c.locator('[data-sc-reopen]').isDisabled(), 'Reopen game should be disabled when no time fits');
          assert((await c.locator('select').count()) === 0, 'no time picker when nothing fits');
          problems = await page.evaluate(findClipping, { root: `[data-sc-card="chance"][data-session="${other.id}"]` });
          assert(problems.length === 0, `no-time card ${scheme} ${width} ${pct}%: ${problems.join(' | ')}`);
          const sideways = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
          assert(sideways <= 1, `${scheme} ${width} ${pct}%: sideways scroll ${sideways}px`);
          await ctx.close();
        }
      }
    }
  });

  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
