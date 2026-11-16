/* Zip 51 (🎾51.edgecases): the screens the last money edge cases changed, on the Zip 51 calm world (the default preview profile).
 *
 *   node e2e/zip51.cjs      (also run by npm run test:e2e)
 *
 * The world is built as of Sun Nov 15 2026, 8:00 PM Eastern; the clock is Mon Nov 16, 10:00 AM. "Drop test" (7:00 PM: Parker paid $14, Quinn,
 * Sage, Christopher Vanderberg) and "Back in test" (8:00 PM: Rowan, Reese, Sage, Christopher Vanderberg) are inside their 12 hours.
 *   D1  F-16, the dialog checks at the tap (390, 360, 320; light and dark): Parker's Drop out says "you still owe $14"; with it open, Rowan is put
 *       in (5 in); Drop out: nothing is dropped, the dialog stays with "This just changed." and "your $14 comes back as credit"; Stay in closes it.
 *   D2  F-16, the server checks at the send: Drop out matches, then Rowan comes in during the 5-second Undo: the drop is refused, the dialog
 *       opens again with the real words; Drop out then: "You dropped out. $14 back as credit."
 *   B1  F-15: Reese drops out late on "Back in test" (owes $14), the Players tab says "1 late drop"; Alex adds Reese back from the Players sheet:
 *       the Players tab no longer says it (light and dark).
 *   V1  F-9: Home opens on last month's two venue cards ($30, $96); moving "Court costs charged on" to the 15th keeps both as they were.
 * Screenshots: .data/zip51-shots (not in git).
 */
const { spawn, spawnSync } = require('node:child_process');
const { readFileSync, mkdirSync, rmSync } = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.E2E_PORT) || 5451;
const BASE = `http://localhost:${PORT}`;
const SEED_ISO = '2026-11-16T01:00:00.000Z'; // Sun Nov 15, 8:00 PM Eastern
const NOW_MS = Date.parse('2026-11-16T15:00:00.000Z'); // Mon Nov 16, 10:00 AM Eastern
const PIN = /PIN `(\d{6})`/.exec(readFileSync(path.join(ROOT, 'docs/PREVIEW_FAKE_DB.md'), 'utf8'))[1];
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const SHOTS = path.join(ROOT, '.data', 'zip51-shots');

let passed = 0;
let failed = 0;
async function check(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.log(`  ✗ ${name}\n      ${String(err && err.message ? err.message : err).replace(/\s*\n\s*/g, ' ⏎ ').slice(0, 1400)}`);
  }
}
const assert = (c, m) => {
  if (!c) throw new Error(m);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const flat = (t) => String(t).replace(/\s+/g, ' ').trim();

async function main() {
  const dbFile = path.join(ROOT, '.data', 'zip51.sqlite');
  mkdirSync(SHOTS, { recursive: true });
  rmSync(dbFile, { force: true });
  const seeded = spawnSync('npx', ['vite-node', 'scripts/load-small-local.ts', '--', dbFile, SEED_ISO, '--calm', '--zip51'], { cwd: ROOT, encoding: 'utf8' });
  if (seeded.status !== 0) throw new Error(`could not build the calm world: ${seeded.stderr || seeded.stdout}`);
  if (await fetch(`${BASE}/api/status`).then((r) => r.ok, () => false)) throw new Error(`port ${PORT} is already in use`);
  const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
    cwd: ROOT,
    env: { ...process.env, DEV_DB: dbFile, SETUP_TOKEN: 'zip51-setup-token-0123456789', DEV_CLOCK: '1', PREVIEW_CALM: 'on' },
    stdio: 'ignore',
    detached: true,
  });
  process.on('exit', () => {
    try {
      process.kill(-server.pid, 'SIGTERM');
    } catch {}
  });
  for (let i = 0; i < 90; i++) {
    if (await fetch(`${BASE}/api/status`).then((r) => r.ok, () => false)) break;
    await sleep(500);
  }
  await fetch(`${BASE}/__dev/clock`, { method: 'POST', body: JSON.stringify({ atMs: NOW_MS }) });
  const browser = await chromium.launch();
  const shift = (ctx) =>
    ctx.addInitScript((delta) => {
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

  const admin = await browser.newContext();
  assert((await admin.request.post(BASE + '/api/admin/login', { data: { pin: PIN }, headers: { Origin: BASE } })).ok(), 'admin login');
  const dash = async () => (await admin.request.get(BASE + '/api/admin/dashboard')).json();
  const post = async (url, data) => {
    const r = await admin.request.post(BASE + url, { data, headers: { Origin: BASE } });
    assert(r.ok(), `${url}: ${r.status()} ${await r.text()}`);
    return r.json();
  };
  let d = await dash();
  const gd = d.sessions.find((s) => s.note === 'Drop test');
  const gb = d.sessions.find((s) => s.note === 'Back in test');
  assert(gd && gb, 'the two Zip 51 games are in the calm world');
  assert(d.lateFees === true, 'Late fees are on, as on live');
  const ids = Object.fromEntries(d.players.map((p) => [p.name, p.id]));
  const seat = async (g, name) => (await dash()).sessions.find((s) => s.id === g.id).roster.find((x) => x.name === name);
  const rowan = (action) => post(`/api/admin/sessions/${gd.id}/roster`, { playerId: ids.Rowan, action });

  async function playerPage(who, { width = 390, scheme = 'light', height = 844 } = {}) {
    const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, colorScheme: scheme, isMobile: true, hasTouch: true, userAgent: UA, reducedMotion: 'reduce' });
    await shift(ctx);
    const page = await ctx.newPage();
    await page.goto(`${BASE}/?as=${encodeURIComponent(who)}`);
    await page.locator('.schedule article.sched').first().waitFor({ timeout: 30000 });
    await page.reload();
    await page.locator('.schedule article.sched').first().waitFor({ timeout: 30000 });
    await page.waitForTimeout(800);
    return { ctx, page };
  }
  async function adminPage({ width = 390, scheme = 'light', height = 844, url = '/admin' } = {}) {
    const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, colorScheme: scheme, isMobile: true, hasTouch: true, userAgent: UA, reducedMotion: 'reduce' });
    await shift(ctx);
    assert((await ctx.request.post(BASE + '/api/admin/login', { data: { pin: PIN }, headers: { Origin: BASE } })).ok(), 'admin login');
    const page = await ctx.newPage();
    await page.goto(BASE + url);
    await page.locator('article[data-r2-card], [data-venue-alerts]').first().waitFor({ timeout: 30000 });
    await page.waitForTimeout(600);
    return { ctx, page };
  }
  const card = (page, id) => page.locator(`article#row-${id}`);
  const noSideScroll = async (page, what) => {
    const w = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
    assert(w[0] <= w[1], `${what}: the page is wider than the screen (${w[0]} > ${w[1]})`);
  };
  const openDrop = async (page) => {
    const c = card(page, gd.id);
    await c.scrollIntoViewIfNeeded();
    await c.locator('.drop-link').click();
    const dlg = page.locator('dialog.sheet[open]').first();
    await dlg.waitFor();
    await page.waitForTimeout(350);
    return dlg;
  };
  const OWES = 'If no one takes your spot, you still owe $14.';
  const BACK = 'Enough players are still in, so your $14 comes back as credit.';

  // ---------------------------------------------------------------- D1: the dialog checks at the tap
  for (const scheme of ['light', 'dark'])
    for (const width of [390, 360, 320])
      await check(`D1 Drop out money changed while the dialog was open: it says so, nothing dropped (${width} ${scheme})`, async () => {
        const { ctx, page } = await playerPage('Parker', { width, scheme });
        const dlg = await openDrop(page);
        const before = flat(await dlg.innerText());
        assert(before.includes(OWES) && !before.includes('This just changed'), `before: ${before}`);
        await rowan('confirm'); // another phone: Rowan is in, 5 in
        await dlg.locator('.btn-row button', { hasText: 'Drop out' }).click();
        await page.locator('dialog.sheet[open] [data-drop-changed]').waitFor({ timeout: 8000 });
        await page.waitForTimeout(400);
        const after = flat(await page.locator('dialog.sheet[open]').first().innerText());
        assert(after.includes('This just changed.') && after.includes(BACK) && !after.includes(OWES), `after: ${after}`);
        assert((await page.locator('.toast, [role="status"]').filter({ hasText: "You're out" }).count()) === 0, 'no "You\'re out" toast');
        const weight = await page.locator('dialog.sheet[open] [data-drop-changed]').evaluate((el) => Number(getComputedStyle(el).fontWeight));
        assert(weight >= 600, `"This just changed." is bold (${weight})`);
        await noSideScroll(page, 'the refreshed dialog');
        await page.screenshot({ path: path.join(SHOTS, `D1-${width}-${scheme}.png`) });
        assert((await seat(gd, 'Parker')).status === 'confirmed', 'Parker is still in');
        await page.locator('dialog.sheet[open] .btn-row button', { hasText: 'Go back' }).click();
        await page.waitForTimeout(400);
        assert((await page.locator('dialog.sheet[open]').count()) === 0, 'Go back closes it');
        // Open again: the plain words, no "This just changed." left over.
        const again = await openDrop(page);
        const t = flat(await again.innerText());
        assert(t.includes(BACK) && !t.includes('This just changed'), `reopened: ${t}`);
        await ctx.close();
        await rowan('withdraw');
      });

  // ---------------------------------------------------------------- D0 and D3: Alex's tap 1 (Mon Nov 16) with two tabs
  // Alex had Parker's dialog open, took the spot as Rowan in another tab, came back: the $14 was gone and no "This just changed." showed.
  // D0 proves why: coming back to a tab after 30 seconds or more reloads the page (src/lib.ts useRefreshOnReturn), so the open dialog was
  // already redrawn with the real money when the red Drop out was tapped. Nothing was stale, so nothing needed asking again.
  // D3: the preview-only link ?holdrefresh=on stops that reload (and the live change check) on that phone, so the dialog really goes stale
  // and the tap shows "This just changed.". Quinn (not paid) is used so Parker stays ready for D2.
  const quinn = (action) => post(`/api/admin/sessions/${gd.id}/roster`, { playerId: ids.Quinn, action });
  const awayAndBack = async (page, ms, during) => {
    const setVis = (v) =>
      page.evaluate((state) => {
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => state === 'hidden' });
        document.dispatchEvent(new Event('visibilitychange'));
      }, v);
    await setVis('hidden');
    await during();
    await page.waitForTimeout(ms);
    await setVis('visible');
  };
  await check('D0 two tabs, away 31 seconds: the open dialog redraws with the real money before the tap; the red Drop out drops at that amount, no prompt', async () => {
    const { ctx, page } = await playerPage('Quinn');
    const dlg = await openDrop(page);
    assert(flat(await dlg.innerText()).includes(OWES), `starts at "you still owe $14": ${flat(await dlg.innerText())}`);
    await awayAndBack(page, 31000, () => rowan('confirm')); // the other tab: Rowan takes a spot (5 in)
    // The page reloads on its own when it comes back: the dialog's words change with no tap.
    const deadline = Date.now() + 8000;
    let now = '';
    while (Date.now() < deadline) {
      now = flat(await page.locator('dialog.sheet[open]').first().innerText());
      if (!now.includes(OWES)) break;
      await page.waitForTimeout(200);
    }
    assert(!now.includes(OWES) && !now.includes('This just changed'), `the dialog redrew itself with the real money: ${now}`);
    await page.screenshot({ path: path.join(SHOTS, 'D0-redrawn.png') });
    await page.locator('dialog.sheet[open] .btn-row button', { hasText: 'Drop out' }).click();
    await page.waitForTimeout(2500);
    assert((await page.locator('dialog.sheet[open] [data-drop-changed]').count()) === 0, 'no "This just changed." (the screen was already right)');
    await page.waitForTimeout(4500);
    const r = await seat(gd, 'Quinn');
    assert(r.status === 'withdrawn', `Quinn is out: ${r.status}`);
    assert(!r.lateFee || r.lateFee.oweCents === 0, `Quinn owes nothing: ${JSON.stringify(r.lateFee)}`);
    await ctx.close();
    await rowan('withdraw');
    await quinn('confirm');
    assert((await seat(gd, 'Quinn')).status === 'confirmed', 'Quinn back in for D3');
  });
  for (const scheme of ['light', 'dark'])
    await check(`D3 ?holdrefresh=on (preview only): the same two tabs, the dialog stays old, the red Drop out shows "This just changed." and drops nothing (${scheme})`, async () => {
      const { ctx, page } = await playerPage('Quinn', { scheme });
      await page.goto(`${BASE}/?holdrefresh=on`);
      await page.locator('[data-hold-refresh]').waitFor({ timeout: 15000 });
      const dlg = await openDrop(page);
      assert(flat(await dlg.innerText()).includes(OWES), 'starts at "you still owe $14"');
      await awayAndBack(page, 31000, () => rowan('confirm'));
      await page.waitForTimeout(3000);
      assert(flat(await page.locator('dialog.sheet[open]').first().innerText()).includes(OWES), 'the dialog still shows the old $14 (refresh paused)');
      await page.locator('dialog.sheet[open] .btn-row button', { hasText: 'Drop out' }).click();
      await page.locator('dialog.sheet[open] [data-drop-changed]').waitFor({ timeout: 8000 });
      await page.waitForTimeout(400);
      const t = flat(await page.locator('dialog.sheet[open]').first().innerText());
      assert(t.includes('This just changed.') && !t.includes(OWES), `the fresh words: ${t}`);
      assert((await seat(gd, 'Quinn')).status === 'confirmed', 'nothing was dropped');
      await noSideScroll(page, 'the hold-refresh page');
      await page.screenshot({ path: path.join(SHOTS, `D3-${scheme}.png`) });
      await page.locator('dialog.sheet[open] .btn-row button', { hasText: 'Go back' }).click();
      await page.goto(`${BASE}/?holdrefresh=off`);
      await page.locator('.schedule article.sched').first().waitFor({ timeout: 15000 });
      await page.waitForTimeout(800);
      assert((await page.locator('[data-hold-refresh]').count()) === 0, '?holdrefresh=off ends it');
      await ctx.close();
      await rowan('withdraw');
    });

  // ---------------------------------------------------------------- D2: the server checks at the send
  await check('D2 the money changed during the 5-second Undo: the server drops nothing, the dialog comes back with the real words; then the drop', async () => {
    const { ctx, page } = await playerPage('Parker');
    const dlg = await openDrop(page);
    assert(flat(await dlg.innerText()).includes(OWES), 'starts at "you still owe $14"');
    await dlg.locator('.btn-row button', { hasText: 'Drop out' }).click();
    await page.locator('.toast').filter({ hasText: "You're out" }).first().waitFor({ timeout: 8000 }).catch(async () => {
      throw new Error(`no first toast: ${JSON.stringify(await page.locator('.toast').allInnerTexts())} dialogs ${await page.locator('dialog.sheet[open]').count()}`);
    });
    await rowan('confirm'); // during the Undo window
    await page.locator('dialog.sheet[open] [data-drop-changed]').waitFor({ timeout: 12000 });
    const t = flat(await page.locator('dialog.sheet[open]').first().innerText());
    assert(t.includes('This just changed.') && t.includes(BACK), `the dialog again: ${t}`);
    assert((await seat(gd, 'Parker')).status === 'confirmed', 'nothing was dropped');
    await page.screenshot({ path: path.join(SHOTS, 'D2-again.png') });
    await page.locator('dialog.sheet[open] .btn-row button', { hasText: 'Drop out' }).click();
    const toast = page.locator('.toast').filter({ hasText: 'You dropped out' }).first();
    await toast.waitFor({ timeout: 8000 }).catch(async () => {
      throw new Error(`no second toast: ${JSON.stringify(await page.locator('.toast').allInnerTexts())} dialog: ${flat(await page.locator('dialog.sheet[open]').first().innerText().catch(() => '-'))}`);
    });
    assert(flat(await toast.innerText()).startsWith('You dropped out. $14 back as credit.'), flat(await toast.innerText()));
    await page.waitForTimeout(6500);
    const r = await seat(gd, 'Parker');
    assert(r.status === 'withdrawn', `Parker is out: ${r.status}`);
    const v = await (await ctx.request.get(BASE + '/api/group')).json();
    assert(v.credit.balanceCents === 1400, `Parker's $14 is credit: ${v.credit.balanceCents}`);
    await ctx.close();
  });

  // ---------------------------------------------------------------- B1: back In from the Players sheet
  await check('B1 setup: Reese drops out late on "Back in test" (owes $14)', async () => {
    const { ctx, page } = await playerPage('Reese');
    const c = card(page, gb.id);
    await c.scrollIntoViewIfNeeded();
    await c.locator('.drop-link').click();
    const dlg = page.locator('dialog.sheet[open]').first();
    await dlg.waitFor();
    await page.waitForTimeout(300);
    assert(flat(await dlg.innerText()).includes(OWES), flat(await dlg.innerText()));
    await dlg.locator('.btn-row button', { hasText: 'Drop out' }).click();
    await page.waitForTimeout(6800);
    await ctx.close();
    const r = await seat(gb, 'Reese');
    assert(r.status === 'withdrawn' && r.lateFee && r.lateFee.kind === 'late_drop', `Reese: ${JSON.stringify({ s: r.status, f: r.lateFee })}`);
    assert((await dash()).players.find((p) => p.name === 'Reese').lateDrops === 1, 'one late drop');
  });
  await check('B1 Alex adds Reese back (the Players sheet\'s Add, same call); the game moves to Wednesday; Reese drops early: no "Late drop" left over', async () => {
    await post(`/api/admin/sessions/${gb.id}/roster`, { playerId: ids.Reese, action: 'confirm' });
    let r = await seat(gb, 'Reese');
    assert(r.status === 'confirmed' && r.owesCents === 1400 && !r.lateFee, `Reese back in: ${JSON.stringify({ s: r.status, o: r.owesCents, f: r.lateFee })}`);
    assert((await dash()).players.find((p) => p.name === 'Reese').lateDrops === 0, 'no late drop counted');
    const two = 2 * 24 * 3600_000;
    const moved = await admin.request.put(BASE + `/api/admin/sessions/${gb.id}/time`, { data: { startsAt: new Date(Date.parse(gb.startsAt) + two).toISOString(), endsAt: new Date(Date.parse(gb.endsAt) + two).toISOString() }, headers: { Origin: BASE } });
    assert(moved.ok(), `move: ${moved.status()} ${await moved.text()}`);
    const { ctx, page } = await playerPage('Reese');
    const c = card(page, gb.id);
    await c.scrollIntoViewIfNeeded();
    await c.locator('.drop-link').click();
    const dlg = page.locator('dialog.sheet[open]').first();
    await dlg.waitFor();
    await page.waitForTimeout(300);
    assert(flat(await dlg.innerText()).includes('Your spot opens up for someone else.'), flat(await dlg.innerText()));
    await dlg.locator('.btn-row button', { hasText: 'Drop out' }).click();
    await page.waitForTimeout(6800);
    await ctx.close();
    r = await seat(gb, 'Reese');
    assert(r.status === 'withdrawn' && !r.lateDropAt, `Reese out, not late: ${JSON.stringify({ s: r.status, at: r.lateDropAt })}`);
  });
  for (const scheme of ['light', 'dark'])
    await check(`B1 the game card on organizer Home has no "Late drop" tag for Reese (${scheme})`, async () => {
      const { ctx, page } = await adminPage({ scheme });
      const c = page.locator(`article[id="session-${gb.id}"]`);
      await c.scrollIntoViewIfNeeded();
      await page.waitForTimeout(300);
      assert((await c.locator('.late-line').count()) === 0, `late tag: ${flat(await c.innerText())}`);
      await noSideScroll(page, 'Home');
      await c.screenshot({ path: path.join(SHOTS, `B1-card-${scheme}.png`) });
      await ctx.close();
    });

  // ---------------------------------------------------------------- V1: the venue cards through a moved day
  for (const scheme of ['light', 'dark'])
    await check(`V1 Home opens on the two venue cards; a moved court day keeps both (${scheme})`, async () => {
      const { ctx, page } = await adminPage({ scheme });
      const words = async () => (await page.locator('[data-venue-alerts] [data-venue-alert]').allInnerTexts()).map(flat);
      const before = await words();
      assert(before.length === 2 && before.some((t) => t.includes('$30')) && before.some((t) => t.includes('$96')), `cards: ${before.join(' | ')}`);
      await page.screenshot({ path: path.join(SHOTS, `V1-home-${scheme}.png`) });
      if (scheme === 'light') {
        const r = await admin.request.put(BASE + '/api/admin/group', { data: { venueDays: { courtDay: 15 } }, headers: { Origin: BASE } });
        assert(r.ok(), `move: ${r.status()}`);
      }
      await page.reload();
      await page.locator('[data-venue-alerts]').waitFor({ timeout: 30000 });
      await page.waitForTimeout(400);
      const after = await words();
      assert(after.join('|') === before.join('|'), `after the move: ${after.join(' | ')}`);
      await noSideScroll(page, 'Home');
      await ctx.close();
    });

  await browser.close();
  console.log(`\nzip51: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
