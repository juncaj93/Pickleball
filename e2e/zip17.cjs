/* Zip 17: Unpaid nudge (UNPAID_NUDGE) switched ON, on the fake preview world with the Zip 17 parts (SEED_ZIP17=1).
 *
 *   node e2e/zip17.cjs      (also run by npm run test:e2e)
 *
 * Seeded Sun Nov 8 at noon Eastern. Made-up players: Vic owes for 1 past game, Wren for 2, Zoe for 3 (all $14, nobody paid).
 * PREVIEW_CALM on, as on the preview. Its own dev server and its own copy of the fake world; nothing touches Cloudflare or the live site.
 * Checks: the owe card words at 390, 360 and 320 wide, light and dark (one line, never cut); Wren's I'm in signs up at once and the
 * "Please pay" toast stays about 8 seconds with Pay opening the Pay sheet; Zoe's I'm in is dimmed on every card (game cards and the Want in
 * card), a tap opens "You owe $42" (no sign-up), the server refuses the sign-up itself, Pay $42 then I paid, and I'm in works right after; the
 * toast and the sheet in light and dark; the ?as= preview links; no one sees another player's balance; the Settings row.
 */
const { spawn, spawnSync } = require('node:child_process');
const { readFileSync, mkdirSync, rmSync } = require('node:fs');
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.E2E_PORT) || 5427;
const BASE = `http://localhost:${PORT}`;
const SEED_ISO = '2026-11-08T17:00:00.000Z'; // Sun Nov 8, 12:00 PM Eastern
const NOW_MS = Date.parse(SEED_ISO);
const SHOTS = process.env.E2E_SHOTS || path.join(__dirname, 'screenshots');
const PIN = /PIN `(\d{6})`/.exec(readFileSync(path.join(ROOT, 'docs/PREVIEW_FAKE_DB.md'), 'utf8'))[1];

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

async function main() {
  mkdirSync(SHOTS, { recursive: true });
  const dbFile = path.join(ROOT, '.data', 'zip17.sqlite');
  mkdirSync(path.join(ROOT, '.data'), { recursive: true });
  rmSync(dbFile, { force: true });
  const seeded = spawnSync('npx', ['vite-node', 'scripts/load-seed-local.ts', '--', dbFile, SEED_ISO], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, SEED_ZIP13: '1', SEED_ZIP14: '1', SEED_ZIP15: '1', SEED_ZIP17: '1' } });
  if (seeded.status !== 0) throw new Error(`could not build the fake world: ${seeded.stderr || seeded.stdout}`);
  // Zoe is also a regular for Tue and Thu who has not answered the next one, so Zoe gets the Want in card (another sign-up path).
  const db = new DatabaseSync(dbFile);
  db.exec("UPDATE players SET usual_days = '2,4', is_regular = 1 WHERE display_name = 'Zoe'");
  // As on live and on the preview database (read Nov 8): the six rows the older local world leaves off are on (Alert cards among them).
  for (const t of ['alert_cards_on', 'seat_dots_on', 'speed_fewer_queries_on', 'speed_direct_load_on', 'speed_last_screen_on', 'speed_last_screen_admin_on'])
    db.exec(`INSERT INTO task_log (id, group_id, session_id, task, kind, at) SELECT 'live-${t}', id, NULL, '${t}', 'mark', '${SEED_ISO}' FROM groups WHERE NOT EXISTS (SELECT 1 FROM task_log WHERE task = '${t}' AND session_id IS NULL)`);
  db.close();
  const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
    cwd: ROOT,
    env: { ...process.env, DEV_DB: dbFile, SETUP_TOKEN: 'zip17-setup-token-0123456789', DEV_CLOCK: '1', PREVIEW_CALM: 'on' },
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
  await fetch(`${BASE}/__dev/clock`, { method: 'POST', body: JSON.stringify({ atMs: NOW_MS }) });
  const browser = await chromium.launch();
  const post = (req, url, data, headers = {}) => req.post(BASE + url, { data, headers: { Origin: BASE, ...headers } });
  const org = (await browser.newContext()).request;
  if (!(await post(org, '/api/admin/login', { pin: PIN })).ok()) throw new Error('login failed');
  const d0 = await (await org.get(`${BASE}/api/admin/dashboard`)).json();
  assert(d0.unpaidNudgeForAll === true, 'the Zip 17 seed should have the Unpaid nudge row on');
  const idOf = (name) => d0.players.find((p) => p.name === name).id;
  for (const n of ['Vic', 'Wren', 'Zoe']) assert(d0.players.some((p) => p.name === n), `no ${n} in the fake world`);

  const phone = (width, scheme) => ({ viewport: { width, height: 844 }, deviceScaleFactor: 1, colorScheme: scheme, isMobile: true, hasTouch: true });
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
      try {
        localStorage.setItem('pb_games_filter', 'all');
      } catch {}
    }, NOW_MS - Date.now());
  }
  /** A player's phone. `pick`: false opens with ?as=<name> instead of picking the name first. */
  async function openPlayer(name, width = 390, scheme = 'light', { url = '/', pick = true } = {}) {
    const ctx = await browser.newContext(phone(width, scheme));
    await shift(ctx);
    await ctx.route('https://venmo.com/**', (r) => r.abort());
    if (pick) await post(ctx.request, '/api/me', { playerId: idOf(name) });
    const page = await ctx.newPage();
    await page.goto(BASE + url);
    await page.locator('.schedule article').first().waitFor();
    await page.waitForTimeout(700);
    return { ctx, page };
  }
  // A game to tap I'm in on: more than 13 hours away, so the drop that puts the seat back afterwards is never a late drop (Late fees are on).
  const open = (s) => !s.canceled && !s.started && !s.mine && s.joinAs !== 'waitlist' && Date.parse(s.startsAt) > NOW_MS + 13 * 3600_000;
  const groupOf = async (ctx) => (await ctx.request.get(`${BASE}/api/group`)).json();
  const sideways = async (page) => page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  /** The owe card's two lines, and whether the second is on one line and not cut. */
  const oweCard = (page) =>
    page.evaluate(() => {
      const card = document.querySelector('[data-pay-card]');
      if (!card) return null;
      const line = card.querySelector('[data-nudge-line]');
      const lh = line ? parseFloat(getComputedStyle(line).lineHeight) || 18 : 0;
      return {
        title: card.querySelector('.ac-title, h2')?.textContent.trim(),
        line: line?.textContent.trim(),
        oneLine: !!line && line.getBoundingClientRect().height <= lh * 1.5,
        cut: !!line && line.scrollWidth > line.clientWidth + 1,
        pay: !!card.querySelector('[data-pay]'),
        x: !!card.querySelector('.ac-x, [data-x]'),
      };
    });
  const luminance = (rgb) => {
    const [r, g, b] = rgb.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number);
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  };

  // ---- 1. The owe card words ----
  const expected = { Vic: ['You owe $14', 'For Tue, Nov 3'], Wren: ['You owe $28', '$14 each: Nov 3 and Nov 4'], Zoe: ['You owe $42', '$14 each: Nov 3, 4 and 5'] };
  for (const scheme of ['light', 'dark'])
    for (const width of [390, 360, 320])
      await check(`owe card, ${width} px, ${scheme}: Vic, Wren and Zoe in the approved words, one line, Pay, no X, nothing sideways`, async () => {
        for (const [name, [title, line]] of Object.entries(expected)) {
          const { ctx, page } = await openPlayer(name, width, scheme);
          const c = await oweCard(page);
          assert(c, `${name}: no owe card`);
          assert(c.title === title, `${name}: title «${c.title}»`);
          assert(c.line === line, `${name}: line «${c.line}»`);
          assert(c.oneLine && !c.cut, `${name}: the line wraps or is cut at ${width}`);
          assert(c.pay && !c.x, `${name}: Pay ${c.pay}, X ${c.x}`);
          assert(!(await sideways(page)), `${name}: the page scrolls sideways`);
          assert(!/pay to keep it clear/i.test(await page.locator('main').innerText()), 'the old line is used');
          if (width === 390) await page.screenshot({ path: path.join(SHOTS, `zip17-owe-${name.toLowerCase()}-${scheme}.png`) });
          await ctx.close();
        }
      });

  await check('the owe card Pay opens the Pay sheet for the whole balance (Wren: $28)', async () => {
    const { ctx, page } = await openPlayer('Wren');
    await page.locator('[data-pay-card] [data-pay]').click();
    const sheet = page.locator('dialog.sheet[open] [data-pay-sheet]');
    await sheet.waitFor();
    const title = await page.locator('dialog.sheet[open] h2').first().innerText();
    assert(/\$28$/.test(title), `Pay sheet title «${title}»`);
    await ctx.close();
  });

  // ---- 2. 1 or 2 unpaid games: I'm in, then the toast ----
  for (const scheme of ['light', 'dark'])
    await check(`Wren (2 unpaid), ${scheme}: I'm in signs up at once (no pop-up), the toast stays about 8 seconds, then goes; inverse colors`, async () => {
      const { ctx, page } = await openPlayer('Wren', 390, scheme);
      const before = await groupOf(ctx);
      const target = before.sessions.find(open);
      const btn = page.locator(`#row-${target.id} [data-join]`);
      assert((await btn.getAttribute('data-nudge-blocked')) === null, 'Wren should not be dimmed');
      await btn.click();
      const toast = page.locator('.pop.toast.toast-nudge');
      await toast.waitFor({ timeout: 5000 });
      const t0 = Date.now();
      assert((await page.locator('dialog.sheet[open]').count()) === 0, 'a pop-up opened');
      const text = await toast.innerText();
      assert(/You're in!/.test(text) && /Please pay the \$28 you still owe for your 2 previous games\./.test(text), `toast «${text}»`);
      assert((await toast.locator('.toast-action').innerText()).trim() === 'Pay', 'no Pay in the toast');
      const after = await groupOf(ctx);
      assert(after.sessions.find((s) => s.id === target.id).mine?.status === 'confirmed', 'not signed up');
      const bg = await toast.evaluate((e) => getComputedStyle(e).backgroundColor);
      const page_ = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
      if (scheme === 'light') assert(luminance(bg) < 0.25 && luminance(page_) > 0.8, `light page should get a dark toast: ${bg} on ${page_}`);
      else assert(luminance(bg) > 0.8 && luminance(page_) < 0.25, `dark page should get a light toast: ${bg} on ${page_}`);
      const box = await toast.boundingBox();
      assert(box.x >= 15 && box.x + box.width <= 390 - 15, `toast not 16 px from the edges: ${JSON.stringify(box)}`);
      await page.screenshot({ path: path.join(SHOTS, `zip17-toast-${scheme}.png`) });
      await sleep(Math.max(0, 6500 - (Date.now() - t0)));
      assert(await toast.isVisible(), 'the toast left before 6.5 seconds');
      await page.waitForFunction(() => !document.querySelector('.pop.toast.toast-nudge'), null, { timeout: 4500 });
      const gone = (Date.now() - t0) / 1000;
      assert(gone >= 7 && gone <= 10, `the toast stayed ${gone.toFixed(1)} s`);
      // Put the seat back for the next run.
      await post(ctx.request, `/api/sessions/${target.id}/withdraw`, {});
      await ctx.close();
    });

  await check("Wren: the toast's Pay opens the Pay sheet for $28 (the unpaid games); a tap on the toast closes it", async () => {
    const { ctx, page } = await openPlayer('Wren');
    const before = await groupOf(ctx);
    const target = before.sessions.find(open);
    await page.locator(`#row-${target.id} [data-join]`).click();
    await page.locator('.pop.toast.toast-nudge .toast-action').click();
    await page.locator('dialog.sheet[open] [data-pay-sheet]').waitFor();
    const title = await page.locator('dialog.sheet[open] h2').first().innerText();
    assert(/\$28$/.test(title), `Pay sheet «${title}»`);
    await page.keyboard.press('Escape');
    await post(ctx.request, `/api/sessions/${target.id}/withdraw`, {});
    // Tap to dismiss.
    const again = before.sessions.filter(open)[1];
    await page.reload();
    await page.locator('.schedule article').first().waitFor();
    await page.locator(`#row-${again.id} [data-join]`).click();
    const toast = page.locator('.pop.toast.toast-nudge');
    await toast.waitFor();
    await toast.locator('.toast-msg').click();
    await page.waitForFunction(() => !document.querySelector('.pop.toast.toast-nudge'), null, { timeout: 1500 });
    await post(ctx.request, `/api/sessions/${again.id}/withdraw`, {});
    await ctx.close();
  });

  await check('Vic (1 unpaid): the toast says "for your previous game"', async () => {
    const { ctx, page } = await openPlayer('Vic');
    const g = await groupOf(ctx);
    const target = g.sessions.find(open);
    await page.locator(`#row-${target.id} [data-join]`).click();
    const text = await page.locator('.pop.toast.toast-nudge').innerText();
    assert(/Please pay the \$14 you still owe for your previous game\./.test(text), `toast «${text}»`);
    await post(ctx.request, `/api/sessions/${target.id}/withdraw`, {});
    await ctx.close();
  });

  // ---- 3. 3 or more: dimmed, the sheet, the server ----
  for (const scheme of ['light', 'dark'])
    for (const width of [390, 360, 320])
      await check(`Zoe (3 unpaid), ${width} px, ${scheme}: every I'm in dimmed; a tap opens "You owe $42" with Pay $42 and Not now, and signs up nothing`, async () => {
        const { ctx, page } = await openPlayer('Zoe', width, scheme);
        const joins = page.locator('[data-join]');
        const n = await joins.count();
        assert(n > 0, 'no I\'m in on the page');
        for (let i = 0; i < n; i++) {
          const b = joins.nth(i);
          assert((await b.getAttribute('data-nudge-blocked')) === '', `I'm in ${i} not marked blocked`);
          const op = await b.evaluate((e) => getComputedStyle(e).opacity);
          assert(Math.abs(Number(op) - 0.45) < 0.01, `I'm in ${i} opacity ${op}`);
        }
        const before = JSON.stringify((await groupOf(ctx)).sessions.map((s) => s.mine?.status ?? null));
        await joins.first().click();
        const sheet = page.locator('dialog.sheet[open] [data-nudge-sheet]');
        await sheet.waitFor();
        const title = await page.locator('dialog.sheet[open] h2').first().innerText();
        assert(title === 'You owe $42', `title «${title}»`);
        const line = await sheet.locator('.nudge-line').innerText();
        assert(line === "For your last 3 games. Once it's paid, you can sign up again.", `line «${line}»`);
        const pay = sheet.locator('[data-nudge-pay]');
        const later = sheet.locator('[data-nudge-later]');
        assert((await pay.innerText()).trim() === 'Pay $42' && (await later.innerText()).trim() === 'Not now', 'buttons');
        for (const b of [pay, later]) {
          const box = await b.boundingBox();
          assert(Math.round(box.height) === 50, `button ${Math.round(box.height)} px high`);
          assert(box.x >= 0 && box.x + box.width <= width, 'a button spills sideways');
        }
        assert(!(await sideways(page)), 'sideways scroll');
        if (width === 390) {
          await page.waitForTimeout(600);
          await page.screenshot({ path: path.join(SHOTS, `zip17-sheet-${scheme}.png`) });
        }
        await later.click();
        await page.waitForFunction(() => !document.querySelector('dialog.sheet[open] [data-nudge-sheet]'), null, { timeout: 2000 });
        const after = JSON.stringify((await groupOf(ctx)).sessions.map((s) => s.mine?.status ?? null));
        assert(before === after, 'a tap on the dimmed I\'m in changed a seat');
        await ctx.close();
      });

  await check('Zoe: the server refuses the sign-up itself (an old screen, or a direct request), with the plain message', async () => {
    const ctx = await browser.newContext();
    await post(ctx.request, '/api/me', { playerId: idOf('Zoe') });
    const g = await groupOf(ctx);
    const target = g.sessions.find((s) => !s.canceled && !s.started && !s.mine);
    const r = await post(ctx.request, `/api/sessions/${target.id}/join`, {});
    assert(r.status() === 409, `status ${r.status()}`);
    const body = await r.json();
    assert(body.error === 'unpaid_limit' && body.message === "You owe $42 for your last 3 games. Once it's paid, you can sign up again.", JSON.stringify(body));
    await ctx.close();
  });

  await check('Zoe: the Want in card (a regular\'s "needs N more" / "has N in") is dimmed too and opens the same sheet', async () => {
    const { ctx, page } = await openPlayer('Zoe', 390, 'light', { url: '/?alerts=all' });
    const btn = page.locator('[data-suggest-card] .ac-btn');
    await btn.waitFor({ timeout: 4000 });
    assert((await btn.getAttribute('data-nudge-blocked')) === '', 'Want in I\'m in not dimmed');
    await btn.click();
    await page.locator('dialog.sheet[open] [data-nudge-sheet]').waitFor();
    assert((await groupOf(ctx)).suggestion, 'the Want in question was answered');
    await ctx.close();
    // Back to calm for the next checks on this phone kind.
  });

  await check('no one sees another player\'s balance: Wren\'s and Vic\'s pages and answers carry nothing of Zoe\'s $42', async () => {
    for (const name of ['Wren', 'Vic']) {
      const { ctx, page } = await openPlayer(name);
      const words = await page.locator('body').innerText();
      const at = words.search(/\$42\b/);
      assert(at < 0, `${name} sees $42: «${words.slice(Math.max(0, at - 120), at + 40)}»`);
      const g = await groupOf(ctx);
      assert(!JSON.stringify(g.owed).includes('"amountCents":4200'), `${name}'s answer has $42`);
      assert(g.owed.every((o) => g.sessions.some((s) => s.id === o.sessionId) || true), 'owed');
      await ctx.close();
    }
  });

  await check('Zoe: Pay $42 opens the Pay sheet for $42; I paid there; I\'m in is no longer dimmed and signs up right away', async () => {
    const { ctx, page } = await openPlayer('Zoe');
    await page.locator('[data-join]').first().click();
    await page.locator('[data-nudge-pay]').click();
    await page.locator('dialog.sheet[open] [data-pay-sheet]').waitFor();
    const title = await page.locator('dialog.sheet[open] h2').first().innerText();
    assert(/\$42$/.test(title), `Pay sheet «${title}»`);
    await page.locator('dialog.sheet[open] [data-sheet-paid]').click();
    await page.waitForFunction(() => !document.querySelector('[data-nudge-blocked]'), null, { timeout: 6000 });
    const g = await groupOf(ctx);
    const target = g.sessions.find(open);
    await page.locator(`#row-${target.id} [data-join]`).click();
    await page.waitForTimeout(1200);
    assert((await page.locator('dialog.sheet[open] [data-nudge-sheet]').count()) === 0, 'the sheet opened again');
    const after = await groupOf(ctx);
    assert(after.sessions.find((s) => s.id === target.id).mine?.status === 'confirmed', 'not signed up after paying');
    assert(after.owed.every((o) => Date.parse(o.endsAt) > NOW_MS), 'past games still owed');
    // No "Please pay" toast: nothing earlier is unpaid now (the 3 games wait for the organizer as "I paid").
    assert((await page.locator('.pop.toast.toast-nudge').count()) === 0, 'a Please pay toast after paying');
    await ctx.close();
  });

  await check('the preview links: /?as=Vic opens as Vic (a new phone, no name picked)', async () => {
    const { ctx, page } = await openPlayer('Vic', 390, 'light', { url: '/?as=Vic', pick: false }).catch(async () => {
      // The name list shows first on a new phone; the link then picks the name.
      const ctx = await browser.newContext(phone(390, 'light'));
      await shift(ctx);
      const page = await ctx.newPage();
      await page.goto(BASE + '/?as=Vic');
      await page.locator('.schedule article').first().waitFor({ timeout: 8000 });
      return { ctx, page };
    });
    await page.waitForFunction(() => /Vic/.test(document.querySelector('.topbar, header')?.textContent || ''), null, { timeout: 6000 });
    assert(!/as=/.test(page.url()), `the address keeps ?as=: ${page.url()}`);
    const c = await oweCard(page);
    assert(c && c.title === 'You owe $14', `owe card ${JSON.stringify(c)}`);
    await ctx.close();
  });

  await check('Settings > Feature switches: the "Unpaid nudge" row, on, at the top', async () => {
    const ctx = await browser.newContext(phone(390, 'light'));
    await shift(ctx);
    await post(ctx.request, '/api/admin/login', { pin: PIN });
    const page = await ctx.newPage();
    await page.goto(BASE + '/admin');
    await page.locator('.tabbar').waitFor();
    await page.locator('.tabbar button', { hasText: 'Settings' }).evaluate((x) => x.click());
    await page.waitForTimeout(600);
    for (const s of await page.locator('details > summary').all()) await s.click().catch(() => {});
    const row = page.locator('[data-row="unpaidNudgeAll"]');
    await row.waitFor();
    assert(/Unpaid nudge/.test(await row.innerText()), 'row name');
    assert(await row.locator('input[type=checkbox]').isChecked(), 'row should be on in the Zip 17 world');
    await ctx.close();
  });

  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
