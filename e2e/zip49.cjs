/* Zip 49 (🎾49.moneyfix): the screens the money fixes changed, on the Zip 49 calm world (the default preview profile).
 *
 *   node e2e/zip49.cjs      (also run by npm run test:e2e)
 *
 * The world is built as of Sun Nov 15 2026, 12:00 PM Eastern; the clock is 1:00 PM. "Late, 1 short" and "Late, 2 short" start about 9 and 9.5
 * hours after the seed, so both are inside their 12 hours. Rowan + Sam (guest) in each; Rowan tapped I paid $28 (not confirmed). "Text all" is Mon Nov 16,
 * 7:00 PM: Rowan + Sam owe $28, Parker owes $14, Christopher Vanderberg paid.
 *   L1  Drop out words on both late games (390, 360, 320; light and dark): "$14 ... Your guest's spot isn't needed" and "your 2 spots ... $28"
 *   G0  before any drop: Rowan with Sam grouped under him on the Players sheet (as built in Zip 42)
 *   L2  Rowan drops on both late games (the toast says $14 on "Late, 1 short")
 *   L3  the late rows (390, 360, 320; light and dark): "Late drop · owes $14", "Paid $28 · $14 to give back", "Give back $14"; on "Late, 2 short"
 *       "Late drop · owes $28", Paid $28, Sam grouped under Rowan ("Guest of Rowan · late drop")
 *   L4  Give back $14: the toast, then "Paid $14" with "$14 back" (3 widths, light and dark); Rowan's credit chip $14
 *   T1  Text all on "Text all": the message asks for $14, never $28
 *   N1  a 20-letter guest name on the player card and the Players sheet (320 to 390, light and dark): nothing wider than the screen
 *   W1  Who played on "Text all" after it ends: Rowan off -> "Rowan didn't play, so Sam didn't either. Rowan owes $14, for the 1 spot the game was short."
 * Screenshots: .data/zip49-shots (not in git).
 */
const { spawn, spawnSync } = require('node:child_process');
const { readFileSync, mkdirSync, rmSync } = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.E2E_PORT) || 5449;
const BASE = `http://localhost:${PORT}`;
const SEED_ISO = '2026-11-15T17:00:00.000Z'; // Sun Nov 15, 12:00 PM Eastern
const NOW_MS = Date.parse('2026-11-15T18:00:00.000Z'); // Sun Nov 15, 1:00 PM Eastern
const PIN = /PIN `(\d{6})`/.exec(readFileSync(path.join(ROOT, 'docs/PREVIEW_FAKE_DB.md'), 'utf8'))[1];
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const SHOTS = path.join(ROOT, '.data', 'zip49-shots');
const LONG = 'Bartholomew-Alexandr';

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
  const dbFile = path.join(ROOT, '.data', 'zip49.sqlite');
  mkdirSync(SHOTS, { recursive: true });
  rmSync(dbFile, { force: true });
  const seeded = spawnSync('npx', ['vite-node', 'scripts/load-small-local.ts', '--', dbFile, SEED_ISO, '--calm', '--zip49'], { cwd: ROOT, encoding: 'utf8' });
  if (seeded.status !== 0) throw new Error(`could not build the calm world: ${seeded.stderr || seeded.stdout}`);
  if (await fetch(`${BASE}/api/status`).then((r) => r.ok, () => false)) throw new Error(`port ${PORT} is already in use`);
  const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
    cwd: ROOT,
    env: { ...process.env, DEV_DB: dbFile, SETUP_TOKEN: 'zip49-setup-token-0123456789', DEV_CLOCK: '1', PREVIEW_CALM: 'on' },
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
  let clock = NOW_MS;
  const setClock = (ms) => {
    clock = ms;
    return fetch(`${BASE}/__dev/clock`, { method: 'POST', body: JSON.stringify({ atMs: ms }) });
  };
  await setClock(NOW_MS);
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
    }, clock - Date.now());

  const admin = await browser.newContext();
  assert((await admin.request.post(BASE + '/api/admin/login', { data: { pin: PIN }, headers: { Origin: BASE } })).ok(), 'admin login');
  const dash = async () => (await admin.request.get(BASE + '/api/admin/dashboard')).json();
  const post = async (url, data) => {
    const r = await admin.request.post(BASE + url, { data, headers: { Origin: BASE } });
    assert(r.ok(), `${url}: ${r.status()} ${await r.text()}`);
    return r.json();
  };
  let d = await dash();
  const g1 = d.sessions.find((s) => s.note === 'Late, 1 short');
  const g2 = d.sessions.find((s) => s.note === 'Late, 2 short');
  const gt = d.sessions.find((s) => s.note === 'Text all');
  assert(g1 && g2 && gt, 'the three Zip 49 games are in the calm world');
  assert(d.guestSpot === true && d.lateFees === true, 'Guest spot and Late fees are on, as on live');
  const ids = Object.fromEntries(d.players.map((p) => [p.name, p.id]));

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
    // (After the last game ends, Home may hold only the Finalize card: the site makes fewer games ahead now.)
    await page.locator('article[data-r2-card], [data-finalize]').first().waitFor({ timeout: 30000 });
    await page.waitForTimeout(600);
    return { ctx, page };
  }
  const card = (page, id) => page.locator(`article#row-${id}`);
  const noSideScroll = async (page, what) => {
    const w = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
    assert(w[0] <= w[1], `${what}: the page is wider than the screen (${w[0]} > ${w[1]})`);
  };
  const inside = async (loc, what) => {
    const bad = await loc.evaluate((el) => {
      const box = el.getBoundingClientRect();
      return [...el.querySelectorAll('button, a, .pchip, .names-line, p, span')]
        .filter((x) => x.getClientRects().length && x.getBoundingClientRect().right > box.right + 0.5)
        .map((x) => x.textContent.trim().slice(0, 40));
    });
    assert(bad.length === 0, `${what}: sticks out: ${bad.join(' | ')}`);
  };
  const openSheet = async (page, id) => {
    // Home opens the first game; the others are folded rows: unfold this one first.
    const folded = page.locator(`div.hv2-short[data-session="${id}"]`);
    if ((await folded.count()) > 0) {
      await folded.scrollIntoViewIfNeeded();
      await folded.click();
      await page.waitForTimeout(500);
    }
    const cell = page.locator(`article[id="session-${id}"] [data-paid-cell]`);
    await cell.scrollIntoViewIfNeeded();
    await cell.click();
    await page.locator('dialog.sheet[open]').waitFor();
    await page.waitForTimeout(400);
    return page.locator('dialog.sheet[open]').first();
  };

  // ---------------------------------------------------------------- L1: the two drop dialogs
  // Zip 76 (MUST 2): a seat already paid (an I paid waiting too) says "Your $14 stays on this game unless ...", never "you still owe".
  const words = [
    [g1, "Your guest Sam drops out too. Your $14 stays on this game unless someone takes your spot. Your guest’s spot isn’t needed."],
    [g2, 'Your guest Sam drops out too. Your $28 stays on this game unless someone takes your 2 spots.'],
  ];
  for (const scheme of ['light', 'dark'])
    for (const width of [390, 360, 320])
      await check(`L1 Drop out words, I paid $28 not confirmed (${width} ${scheme})`, async () => {
        const { ctx, page } = await playerPage('Rowan', { width, scheme });
        for (const [g, want] of words) {
          const c = card(page, g.id);
          await c.scrollIntoViewIfNeeded();
          await inside(c, `${g.note} card`);
          await c.locator('.drop-link').click();
          const dlg = page.locator('dialog.sheet[open]').first();
          await dlg.waitFor();
          await page.waitForTimeout(350);
          const body = flat(await dlg.innerText());
          assert(body.includes(want), `${g.note}: ${body}`);
          await noSideScroll(page, `${g.note} dialog`);
          await page.screenshot({ path: path.join(SHOTS, `L1-${g.note.replace(/\W+/g, '')}-${width}-${scheme}.png`) });
          await dlg.locator('.btn-row button', { hasText: 'Stay in' }).click();
          await page.waitForTimeout(400);
        }
        await ctx.close();
      });

  // ---------------------------------------------------------------- G0: the pair grouped, as built before (before any drop)
  for (const scheme of ['light', 'dark'])
    await check(`G0 "Late, 2 short" before the drop: Rowan with Sam grouped under him (${scheme})`, async () => {
      const { ctx, page } = await adminPage({ scheme });
      const dlg = await openSheet(page, g2.id);
      const rows = (await dlg.locator('[data-ps-pair="Rowan"] .ps-row .ps-name').allInnerTexts()).map(flat);
      assert(rows.join('|') === 'Rowan|Sam', `the pair: ${rows}`);
      await dlg.screenshot({ path: path.join(SHOTS, `G0-pair-${scheme}.png`) });
      await ctx.close();
    });

  // ---------------------------------------------------------------- L2: the flow on "Late, 1 short"
  await check('L2 Rowan drops on "Late, 1 short" (toast: Your $14 stays)', async () => {
    const { ctx, page } = await playerPage('Rowan');
    const c = card(page, g1.id);
    await c.scrollIntoViewIfNeeded();
    await c.locator('.drop-link').click();
    const dlg = page.locator('dialog.sheet[open]').first();
    await dlg.waitFor();
    await page.waitForTimeout(300);
    await dlg.locator('.btn-row button', { hasText: 'Drop out both' }).click();
    const toast = page.locator('.toast, [role="status"]').filter({ hasText: "You’re out" }).first();
    await toast.waitFor({ timeout: 8000 });
    assert(/Your \$14 stays on this game unless someone takes your spot/.test(flat(await toast.innerText())), flat(await toast.innerText()));
    await page.waitForTimeout(6500); // the 5-second Undo goes by, then the drop is sent
    await ctx.close();
    const r = (await dash()).sessions.find((s) => s.id === g1.id).roster.find((x) => x.name === 'Rowan');
    assert(r.status === 'withdrawn' && r.selfPaid && r.paymentAmountCents === 2800, `after the drop: ${JSON.stringify({ s: r.status, self: r.selfPaid, amt: r.paymentAmountCents })}`);
  });
  await check('L2 setup: Rowan drops on "Late, 2 short" too', async () => {
    const { ctx, page } = await playerPage('Rowan');
    const c = card(page, g2.id);
    await c.scrollIntoViewIfNeeded();
    await c.locator('.drop-link').click();
    const dlg = page.locator('dialog.sheet[open]').first();
    await dlg.waitFor();
    await page.waitForTimeout(300);
    await dlg.locator('.btn-row button', { hasText: 'Drop out both' }).click();
    await page.waitForTimeout(6500);
    await ctx.close();
    const r = (await dash()).sessions.find((s) => s.id === g2.id).roster.find((x) => x.name === 'Rowan');
    assert(r.status === 'withdrawn' && r.guest && r.guest.status === 'late', `2 short after the drop: ${JSON.stringify({ s: r.status, g: r.guest })}`);
  });

  const rowWords = async (dlg, name) => {
    const row = dlg.locator(`[data-ps-row="${name}"]`);
    return {
      line: flat(await row.locator('[data-ps-late-line]').innerText()),
      note: (await row.locator('[data-ps-late-note]').count()) ? flat(await row.locator('[data-ps-late-note]').innerText()) : null,
      chip: (await row.locator('[data-ps-paid-chip]').count()) ? flat(await row.locator('[data-ps-paid-chip]').innerText()) : null,
      button: (await row.locator('[data-ps-markpaid]').count()) ? flat(await row.locator('[data-ps-markpaid]').innerText()) : null,
    };
  };
  const sameWords = (got, want, what) => assert(JSON.stringify(got) === JSON.stringify(want), `${what}: ${JSON.stringify(got)}`);
  const lookAt = async (page, dlg, what, shot) => {
    await noSideScroll(page, what);
    await inside(dlg.locator('[data-ps-list]'), what);
    await dlg.screenshot({ path: path.join(SHOTS, shot) });
  };

  for (const scheme of ['light', 'dark'])
    for (const width of [390, 360, 320])
      await check(`L3 the late rows say the money (${width} ${scheme})`, async () => {
        const { ctx, page } = await adminPage({ scheme, width });
        let dlg = await openSheet(page, g1.id);
        sameWords(await rowWords(dlg, 'Rowan'), { line: 'Late drop · owes $14', note: 'Paid $28 · $14 to give back', chip: null, button: 'Give back $14' }, '1 short');
        await lookAt(page, dlg, '1 short sheet', `L3-1short-${width}-${scheme}.png`);
        await page.keyboard.press('Escape');
        await page.waitForTimeout(400);
        dlg = await openSheet(page, g2.id);
        sameWords(await rowWords(dlg, 'Rowan'), { line: 'Late drop · owes $28', note: 'Marked paid by Rowan', chip: 'Paid $28', button: null }, '2 short');
        const pair = (await dlg.locator('[data-ps-pair="Rowan"] .ps-row .ps-name').allInnerTexts()).map(flat);
        assert(pair.join('|') === 'Rowan|Sam', `2 short: Sam grouped under Rowan: ${pair}`);
        assert(flat(await dlg.locator('[data-ps-guest="Sam"] [data-ps-guest-line]').innerText()) === 'Guest of Rowan · late drop', 'Sam line');
        await lookAt(page, dlg, '2 short sheet', `L3-2short-${width}-${scheme}.png`);
        await ctx.close();
      });

  await check('L4 Give back $14: toast, then the row reads Paid $14 with "$14 back"; Rowan\'s credit is $14', async () => {
    const { ctx, page } = await adminPage();
    const dlg = await openSheet(page, g1.id);
    await dlg.locator('[data-ps-giveback="Rowan"]').click();
    const toast = page.locator('.toast, [role="status"]').filter({ hasText: 'back to Rowan' }).first();
    await toast.waitFor({ timeout: 10000 });
    assert(flat(await toast.innerText()).includes('$14 back to Rowan as credit'), flat(await toast.innerText()));
    await page.waitForTimeout(6500);
    const r = (await dash()).sessions.find((s) => s.id === g1.id).roster.find((x) => x.name === 'Rowan');
    assert(r.paymentAmountCents === 1400 && r.trimBackCents === 1400 && !r.selfPaid, `server: ${JSON.stringify({ amt: r.paymentAmountCents, back: r.trimBackCents, self: r.selfPaid })}`);
    await ctx.close();
    const p = await playerPage('Rowan');
    const chip = p.page.locator('[data-credit-chip], .credit-chip').first();
    await chip.waitFor({ timeout: 8000 });
    assert(/\$14/.test(flat(await chip.innerText())), `credit chip: ${await chip.innerText()}`);
    await p.ctx.close();
  });
  for (const scheme of ['light', 'dark'])
    for (const width of [390, 360, 320])
      await check(`L4 after the give-back: Paid $14, $14 back (${width} ${scheme})`, async () => {
        const { ctx, page } = await adminPage({ scheme, width });
        const dlg = await openSheet(page, g1.id);
        sameWords(await rowWords(dlg, 'Rowan'), { line: 'Late drop · owes $14', note: '$14 back', chip: 'Paid $14', button: null }, 'after');
        await lookAt(page, dlg, 'after sheet', `L4-after-${width}-${scheme}.png`);
        await ctx.close();
      });

  // ---------------------------------------------------------------- T1: Text all
  await check('T1 Text all on "Text all" asks for $14, never $28', async () => {
    const { ctx, page } = await adminPage();
    const dlg = await openSheet(page, gt.id);
    await dlg.locator('[data-ps-remind]').click();
    await page.waitForTimeout(500);
    const link = page.locator('[data-text-all]').first();
    await link.waitFor({ timeout: 8000 });
    const href = decodeURIComponent((await link.getAttribute('href')) || '');
    assert(href.includes('$14') && !href.includes('$28'), `Text all message: ${href}`);
    await page.screenshot({ path: path.join(SHOTS, 'T1-remind.png') });
    await ctx.close();
  });

  // ---------------------------------------------------------------- N1: a 20-letter guest name
  await check('N1 setup: Parker brings a 20-letter guest on "Text all"', async () => {
    await post(`/api/admin/sessions/${gt.id}/guest`, { playerId: ids.Parker, name: LONG });
  });
  for (const scheme of ['light', 'dark'])
    for (const width of [390, 360, 320])
      await check(`N1 "${LONG}" fits on the player card and the Players sheet (${width} ${scheme})`, async () => {
        const p = await playerPage('Parker', { width, scheme });
        const c = card(p.page, gt.id);
        await c.scrollIntoViewIfNeeded();
        assert(flat(await c.innerText()).includes(LONG), 'the card shows the whole name');
        await noSideScroll(p.page, 'player Home');
        await inside(c, 'Parker card');
        await c.screenshot({ path: path.join(SHOTS, `N1-card-${width}-${scheme}.png`) });
        await p.ctx.close();
        const { ctx, page } = await adminPage({ scheme, width });
        const dlg = await openSheet(page, gt.id);
        assert(flat(await dlg.innerText()).includes(LONG), 'the sheet shows the whole name');
        await noSideScroll(page, 'Players sheet');
        await inside(dlg.locator('[data-ps-list]'), 'Players list');
        await dlg.screenshot({ path: path.join(SHOTS, `N1-sheet-${width}-${scheme}.png`) });
        await ctx.close();
      });

  // ---------------------------------------------------------------- W1: Who played note
  // "Text all" after it ends: Rowan + Sam, Parker + Bartholomew-Alexandr (N1), Christopher. Rowan off: 3 played, 1 short.
  for (const scheme of ['light', 'dark'])
    await check(`W1 Who played on "Text all": Rowan off -> owes $14 for the 1 spot (${scheme})`, async () => {
      await setClock(Date.parse(gt.endsAt) + 30 * 60_000);
      const { ctx, page } = await adminPage({ scheme, url: '/admin?alerts=all' });
      await page.locator(`[data-finalize="${gt.id}"] [data-change-played]`).waitFor({ timeout: 20000 });
      await page.locator(`[data-finalize="${gt.id}"] [data-change-played]`).click();
      const sheet = page.locator('dialog.sheet[open] [data-who-played]');
      await sheet.waitFor();
      await page.waitForTimeout(400);
      const host = sheet.locator('[data-tile="Rowan"]');
      if ((await host.count()) > 0) await host.click();
      else await sheet.locator('input[aria-label="Rowan played"]').click();
      await page.waitForTimeout(300);
      const note = flat(await sheet.locator('[data-who-played-note]').innerText());
      assert(note === "Rowan didn’t play, so Sam didn’t either. Rowan owes $14, for the 1 spot the game was short.", note);
      await noSideScroll(page, 'Who played');
      await page.screenshot({ path: path.join(SHOTS, `W1-${scheme}.png`) });
      await ctx.close();
      await setClock(NOW_MS);
    });

  await browser.close();
  console.log(`\nzip49: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
