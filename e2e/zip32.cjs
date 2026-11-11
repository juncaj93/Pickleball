/* Zip 32: "Players sheet redo" (PLAYERS_SHEET_REDO, ships OFF) and the four polish fixes (mocks/1_players_sheet_light.png / _dark.png).
 *
 *   node e2e/zip32.cjs      (also run by npm run test:e2e)
 *
 * The SMALL fake world (the 10 fixed names), pretending it is Thu Nov 12, 6:00 PM Eastern, on its own dev server; nothing touches Cloudflare.
 *   Part A  1 the white Undo toast: the pill sits fully inside it (light/dark, 390/360/320, text 100 and 150%, motion on and off);
 *           2 History > Sessions, a played game: a green check (the Canceled game keeps the slash);
 *           3 no gear on a played (finalized) game; the gear on a canceled or not-yet-finalized game opens a menu that stays inside the screen;
 *           (4 is e2e/credit.cjs: the four Nov 10 tests now use the pretend clock.)
 *   Part B  the switch (ships off, the Settings row at the top, the private link for one phone); OFF = the old sheet; ON = the new one from BOTH
 *           places that open it (the money cell and the gear's Players); every action is the old one: Remind (the same sheet), Mark paid (same
 *           call, same Undo toast), Request (the same Venmo link), Remove (same question, same Undo), Add (Give spot: the same call, "full" says so);
 *           who marked it paid; the declined notice and its chip; strict clipping at 390/360/320, light and dark, text 100/125/150%, with 3 and 9 players.
 */
const { spawn, spawnSync } = require('node:child_process');
const { readFileSync, mkdirSync, rmSync } = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { findClipping } = require('./clip-check.cjs');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.E2E_PORT) || 5432;
const BASE = `http://localhost:${PORT}`;
const NOW_ISO = '2026-11-12T23:00:00.000Z'; // Thu Nov 12, 6:00 PM Eastern
const NOW_MS = Date.parse(NOW_ISO);
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
    console.log(`  ✗ ${name}\n      ${String(err && err.message ? err.message : err).replace(/\s*\n\s*/g, ' ⏎ ').slice(0, 1600)}`);
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  mkdirSync(SHOTS, { recursive: true });
  const dbFile = path.join(ROOT, '.data', 'zip32.sqlite');
  mkdirSync(path.join(ROOT, '.data'), { recursive: true });
  rmSync(dbFile, { force: true });
  const seeded = spawnSync('npx', ['vite-node', 'scripts/load-small-local.ts', '--', dbFile, NOW_ISO], { cwd: ROOT, encoding: 'utf8' });
  if (seeded.status !== 0) throw new Error(`could not build the fake world: ${seeded.stderr || seeded.stdout}`);
  if (await fetch(`${BASE}/api/status`).then((r) => r.ok, () => false)) throw new Error(`port ${PORT} is already in use`);
  const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
    cwd: ROOT,
    env: { ...process.env, DEV_DB: dbFile, SETUP_TOKEN: 'zip32-setup-token-0123456789', DEV_CLOCK: '1', MOTION_ADMIN: 'on', MOTION: 'on' },
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
  const orgCtx = await browser.newContext();
  const org = orgCtx.request;
  const call = async (method, url, data, headers = {}) => {
    const res = await org.fetch(BASE + url, { method, data, headers: { Origin: BASE, ...headers } });
    return { status: res.status(), ok: res.ok(), json: await res.json().catch(() => ({})) };
  };
  if (!(await call('POST', '/api/admin/login', { pin: PIN })).ok) throw new Error('login failed');
  const dash = async (headers) => (await call('GET', '/api/admin/dashboard', undefined, headers)).json;
  const d0 = await dash();
  const idOf = (name) => d0.players.find((p) => p.name === name).id;
  // The game with Reese's decline: "game 1" of the preview world (Alex, Parker paid, Vic and Christopher Vanderberg owe).
  const g1 = d0.sessions.find((s) => s.roster.some((r) => r.name === 'Reese' && r.status === 'declined'));
  assert(g1, 'the preview scene (Reese declined game 1) is missing');
  const sessionOf = async (id) => (await dash()).sessions.find((s) => s.id === id);

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
  /** The organizer's phone. `motion` runs with animations allowed (the Undo ring); the default is reduced motion. */
  async function openAdmin({ width = 390, scheme = 'light', pct = 100, motion = false, url = '/admin', height = 760 } = {}) {
    const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, colorScheme: scheme, isMobile: true, hasTouch: true, userAgent: UA, reducedMotion: motion ? 'no-preference' : 'reduce' });
    await shift(ctx);
    assert((await ctx.request.post(BASE + '/api/admin/login', { data: { pin: PIN }, headers: { Origin: BASE } })).ok(), 'admin login');
    const page = await ctx.newPage();
    await page.goto(BASE + url);
    await page.locator('article[data-r2-card]').first().waitFor({ timeout: 20000 });
    if (pct !== 100) await page.addStyleTag({ content: `html { font-size: ${pct}% !important; } body { font-size: ${(17 * pct) / 100}px !important; }` });
    await page.waitForTimeout(500);
    return { ctx, page };
  }
  const cardOf = (page, id) => page.locator(`article[id="session-${id}"]`);
  const openByMoneyCell = async (page, id) => {
    const cell = cardOf(page, id).locator('[data-paid-cell]');
    await cell.scrollIntoViewIfNeeded();
    await cell.click();
    await page.locator('dialog.sheet[open]').waitFor();
    await page.waitForTimeout(350);
  };
  const closeSheets = async (page) => {
    await page.evaluate(() => {
      for (const d of document.querySelectorAll('dialog[open]')) d.close();
    });
    await page.waitForTimeout(250);
  };
  const setSwitch = (on) => call('PUT', '/api/admin/players-sheet-redo-switch', { on });
  const sheet = (page) => page.locator('dialog.sheet[open]').first();
  const row = (page, name) => page.locator(`dialog.sheet[open] [data-ps-row="${name}"]`);

  // ================================================================ the switch
  await check('the switch ships OFF in the world, then the Settings row is the TOP row and turns it on for everyone (no deploy)', async () => {
    // The preview world has it on (PREVIEW SWITCHES RULE); a live site starts with it off: here it is switched off first.
    assert((await dash()).playersSheetRedoForAll === true, 'the preview world should have the row on');
    assert((await setSwitch(false)).ok, 'switch off');
    assert((await dash()).playersSheetRedo === undefined, 'off after the Settings row is off');
    const { ctx, page } = await openAdmin();
    await page.locator('.tabbar button', { hasText: 'Settings' }).click();
    await page.waitForTimeout(400);
    for (const s of await page.locator('details > summary').all()) await s.click().catch(() => {});
    const first = await page.locator('#switches [data-row], [data-switches-tidy] [data-row]').evaluateAll((els) => els.slice(0, 4).map((e) => e.getAttribute('data-row')));
    // (Zip 35's Tap guard fix, Zip 34's Check-in pay line row and Zip 31's Extended time row are newer and sit on top of it.)
    assert(first[0] === 'tapGuardFixAll' && first[1] === 'extendedTimeAll' && first[2] === 'checkInPayAll' && first[3] === 'playersSheetRedoAll', `newest first: ${first}`);
    const r = page.locator('[data-row="playersSheetRedoAll"]');
    assert(/Players sheet redo/.test(await r.innerText()), 'row label');
    assert(!(await r.locator('input[type=checkbox]').isChecked()), 'the row starts off');
    await r.locator('label').click();
    await page.waitForTimeout(900);
    assert((await dash()).playersSheetRedoForAll === true, 'on for everyone after the tap');
    await ctx.close();
  });

  await check('OFF: the money cell AND the gear menu open the old sheet, exactly as before (Confirmed chips, Remove buttons, Add someone with Give spot)', async () => {
    assert((await setSwitch(false)).ok, 'switch off');
    const { ctx, page } = await openAdmin();
    await openByMoneyCell(page, g1.id);
    const dlg = sheet(page);
    assert((await dlg.locator('[data-players-sheet]').count()) === 0, 'the new sheet showed with the switch off');
    assert(/Players ·/.test(await dlg.locator('h2').first().innerText()), 'old title');
    assert((await dlg.getByRole('button', { name: 'Remove', exact: true }).count()) >= 2, 'old pink Remove buttons');
    assert((await dlg.getByRole('heading', { name: 'Add someone' }).count()) === 1, 'old Add someone list');
    assert((await dlg.getByRole('button', { name: 'Give spot' }).count()) >= 3, 'old Give spot buttons');
    assert(!/Remind/.test(await dlg.innerText()), 'no Remind on the old sheet');
    await closeSheets(page);
    await cardOf(page, g1.id).getByRole('button', { name: /^Game menu for/ }).click();
    await page.getByRole('menuitem', { name: 'Players', exact: true }).click();
    await page.locator('dialog.sheet[open]').waitFor();
    assert((await sheet(page).locator('[data-players-sheet]').count()) === 0, 'gear Players: new sheet with the switch off');
    assert((await sheet(page).getByRole('heading', { name: 'Add someone' }).count()) === 1, 'gear Players: old sheet');
    await ctx.close();
  });

  await check('the private link for one phone: /admin?playerssheet=on opens the new sheet with the row OFF (and stays for that phone); =off ends it', async () => {
    assert((await setSwitch(false)).ok, 'switch off');
    const { ctx, page } = await openAdmin({ url: '/admin?playerssheet=on' });
    await openByMoneyCell(page, g1.id);
    assert((await sheet(page).locator('[data-players-sheet]').count()) === 1, 'the private link did not turn it on');
    await closeSheets(page);
    await page.goto(BASE + '/admin');
    await page.locator('article[data-r2-card]').first().waitFor();
    await openByMoneyCell(page, g1.id);
    assert((await sheet(page).locator('[data-players-sheet]').count()) === 1, 'it should stay on for that phone');
    await closeSheets(page);
    await page.goto(BASE + '/admin?playerssheet=off');
    await page.locator('article[data-r2-card]').first().waitFor();
    await openByMoneyCell(page, g1.id);
    assert((await sheet(page).locator('[data-players-sheet]').count()) === 0, '=off did not end it');
    await ctx.close();
    // Another phone never had it.
    const b = await openAdmin();
    await openByMoneyCell(b.page, g1.id);
    assert((await sheet(b.page).locator('[data-players-sheet]').count()) === 0, 'another phone should not see it');
    await b.ctx.close();
  });

  // ================================================================ the new sheet
  assert((await setSwitch(true)).ok, 'switch on');

  // ================================================================ strict clipping (the Zip 18 rule)
  // (Quinn stays out on purpose: the sheet still needs a name to tap.)
  const g1Names = ['Zoe', 'Wren', 'Rowan', 'Sage', 'Reese'];
  /** The roster check at the top: the sheet is drawn at every width, scheme and text size; nothing clips, overlaps or goes sideways; header stays put. */
  async function clipRun(label) {
    for (const scheme of ['light', 'dark'])
      for (const width of [390, 360, 320])
        for (const pct of [100, 125, 150])
          await check(`clipping (${label}): ${width} wide, ${scheme}, text ${pct}%: nothing clips, overlaps or goes sideways; the header stays fixed; the Add button is reachable`, async () => {
            const { ctx, page } = await openAdmin({ width, scheme, pct });
            await openByMoneyCell(page, g1.id);
            const dlg = sheet(page);
            const problems = await page.evaluate(findClipping, { root: 'dialog.sheet[open]' });
            const sideways = await page.evaluate(() => {
              const d = document.querySelector('dialog.sheet[open]');
              return d.scrollWidth - d.clientWidth;
            });
            // Open the three-dot menu of the LAST row and pick a name: the menu and the Add button stay on screen.
            const lastDots = dlg.locator('.ps-dots').last();
            await lastDots.scrollIntoViewIfNeeded();
            await lastDots.click();
            await page.waitForTimeout(150);
            const pop = await dlg.locator('.ps-pop').boundingBox();
            const view = page.viewportSize();
            const popOk = pop && pop.x >= 0 && pop.x + pop.width <= view.width && pop.y >= 0 && pop.y + pop.height <= view.height;
            await page.keyboard.press('Escape');
            await dlg.locator('[data-ps-chip]').first().scrollIntoViewIfNeeded();
            await dlg.locator('[data-ps-chip]').first().click();
            const addBtn = dlg.locator('[data-ps-add-btn]');
            await addBtn.scrollIntoViewIfNeeded();
            const addBox = await addBtn.boundingBox();
            const sheetBox = await page.evaluate(() => {
              const r = document.querySelector('dialog.sheet[open]').getBoundingClientRect();
              return { top: r.top, bottom: r.bottom };
            });
            const addOk = addBox && addBox.y >= sheetBox.top && addBox.y + addBox.height <= sheetBox.bottom + 1;
            const headTop = await page.evaluate(async () => {
              const d = document.querySelector('dialog.sheet[open]');
              d.scrollTop = d.scrollHeight;
              await new Promise((r) => setTimeout(r, 60));
              return Math.round(d.querySelector('.sheet-head').getBoundingClientRect().top - d.getBoundingClientRect().top);
            });
            if (width === 320 && pct === 150) await page.screenshot({ path: path.join(SHOTS, `zip32-clip-${label}-320-150-${scheme}.png`) });
            await ctx.close();
            assert(problems.length === 0, problems.slice(0, 4).join(' | '));
            assert(sideways <= 1, `sideways scroll ${sideways}px`);
            assert(popOk, `the three-dot menu left the screen: ${JSON.stringify(pop)}`);
            assert(addOk, `the Add button is not inside the sheet: ${JSON.stringify(addBox)} in ${JSON.stringify(sheetBox)}`);
            assert(Math.abs(headTop) <= 1, `the header moved (${headTop}px) when the body scrolled`);
          });
  }

  await check('the layout: header, "1 of 3 paid · $14 each" with Remind, one grey "Reese declined" line, ONE card of rows, ADD SOMEONE chips; Alex (the host) is not listed', async () => {
    const { ctx, page } = await openAdmin();
    await openByMoneyCell(page, g1.id);
    const dlg = sheet(page);
    assert((await dlg.locator('h2').first().innerText()) === 'Players · Thu, Nov 12', await dlg.locator('h2').first().innerText());
    assert((await dlg.getByRole('button', { name: 'Close' }).count()) === 1, 'the X');
    const summary = (await dlg.locator('[data-ps-summary] .ps-count').innerText()).replace(/\s+/g, ' ');
    assert(summary === '1 of 3 paid · $14 each', summary);
    assert((await dlg.locator('[data-ps-remind]').innerText()) === 'Remind', 'Remind');
    assert((await dlg.locator('[data-ps-declined]').innerText()).replace(/\s+/g, ' ') === 'Reese declined', await dlg.locator('[data-ps-declined]').innerText());
    assert((await dlg.locator('[data-ps-declined] button, [data-ps-declined] a').count()) === 0, 'no button on the notice');
    assert((await dlg.locator('ul[data-ps-list]').count()) === 1, 'one card');
    const names = await dlg.locator('[data-ps-row] .ps-name').allInnerTexts();
    assert(JSON.stringify(names) === JSON.stringify(['Parker', 'Vic', 'Christopher Vanderberg']), `rows: ${names}`);
    assert(!names.includes('Alex'), 'the host is listed');
    // Every row has the pickleball and a three-dot menu.
    assert((await dlg.locator('[data-ps-row] .ps-ball svg.ball').count()) === 3, 'pickleball icons');
    assert((await dlg.locator('[data-ps-row] .ps-dots').count()) === 3, 'three-dot menus');
    // No big pink buttons, no "Confirmed" words, no Give spot buttons.
    assert((await dlg.getByRole('button', { name: 'Give spot' }).count()) === 0 && !/Confirmed/.test(await dlg.innerText()), 'old pieces still there');
    const chips = await dlg.locator('[data-ps-chip]').allInnerTexts();
    assert(JSON.stringify([...chips].sort()) === JSON.stringify(['Quinn', 'Reese', 'Rowan', 'Sage', 'Wren', 'Zoe']), `chips: ${chips}`);
    assert(chips[chips.length - 1] === 'Reese' || chips.includes('Reese'), 'the declined player is a chip too');
    assert((await dlg.locator('[data-ps-add-btn]').count()) === 0, 'no Add button before a pick');
    await ctx.close();
  });

  // The 3-player game, before any test below changes it.
  await clipRun('3 players');

  await check('paid rows say who marked it and when: "Marked paid by Parker · time" (his own I paid) and "You marked it paid · time" (Mark paid); unpaid rows: amber "Owes $14", Mark paid and Request', async () => {
    const { ctx, page } = await openAdmin();
    await openByMoneyCell(page, g1.id);
    const parker = row(page, 'Parker');
    assert(/^Marked paid by Parker · \d{1,2}:\d{2}\s?[AP]M$/.test((await parker.locator('[data-ps-paid-line]').innerText()).replace(/\s+/g, ' ').replace(/ | /g, ' ')), await parker.locator('[data-ps-paid-line]').innerText());
    assert((await parker.locator('[data-ps-paid-chip]').innerText()).trim() === 'Paid', 'Paid chip');
    assert((await parker.getByRole('button', { name: /Mark/ }).count()) === 0, 'no buttons on a paid row');
    for (const n of ['Vic', 'Christopher Vanderberg']) {
      const r = row(page, n);
      assert((await r.locator('[data-ps-owes-line]').innerText()) === 'Owes $14', `${n} owes line`);
      assert((await r.locator('[data-ps-markpaid]').innerText()) === 'Mark paid', `${n} Mark paid`);
      const req = r.locator('a.sc-req');
      assert((await req.innerText()) === 'Request', `${n} Request`);
      const href = await req.getAttribute('href');
      assert(/venmo\.com/.test(href) && /amount=14/.test(href), `${n} Venmo link ${href}`);
      assert(/Pickleball%20(Thu|Tue)/.test(href) || /note=Pickleball/.test(href), `${n} note ${href}`);
    }
    await ctx.close();
    // The organizer's own Mark paid reads "You marked it paid" (checked after Mark paid below, and here from the server's record of another game).
    const done = d0.sessions.find((s) => s.roster.some((r) => r.paymentStatus === 'paid' && !r.selfPaid && !r.isOrganizer && r.status === 'confirmed'));
    assert(done, 'the world should have a game paid by the organizer');
  });

  await check('Mark paid: the Home money card\'s own call: toast "Vic marked paid" with Undo; Undo puts nothing through; waiting saves it; the row then says "You marked it paid"; the card count follows', async () => {
    const { ctx, page } = await openAdmin();
    await openByMoneyCell(page, g1.id);
    const vic = row(page, 'Vic');
    await vic.locator('[data-ps-markpaid]').click();
    const undo = page.locator('.pop.toast .toast-action', { hasText: 'Undo' }).first();
    await undo.waitFor({ timeout: 5000 });
    assert(/Vic marked paid/.test(await page.locator('.pop.toast').first().innerText()), 'toast words');
    assert((await row(page, 'Vic').locator('[data-ps-paid-chip]').count()) === 1, 'shown at once');
    await page.waitForTimeout(900);
    await undo.click();
    await page.waitForTimeout(6500);
    assert((await sessionOf(g1.id)).roster.find((r) => r.name === 'Vic').paymentStatus === 'unpaid', 'Undo must save nothing');
    assert((await row(page, 'Vic').locator('[data-ps-owes-line]').count()) === 1, 'back to owing after Undo');
    await row(page, 'Vic').locator('[data-ps-markpaid]').click();
    await page.locator('.pop.toast .toast-action', { hasText: 'Undo' }).first().waitFor();
    await page.waitForTimeout(6500);
    const v = (await sessionOf(g1.id)).roster.find((r) => r.name === 'Vic');
    assert(v.paymentStatus === 'paid' && v.selfPaid === false && v.paidAt, JSON.stringify(v));
    await page.waitForTimeout(800);
    const line = (await row(page, 'Vic').locator('[data-ps-paid-line]').innerText()).replace(/\s+/g, ' ');
    assert(/^You marked it paid · \d{1,2}:\d{2}/.test(line), line);
    assert(/^2 of 3 paid/.test((await sheet(page).locator('.ps-count').innerText()).replace(/\s+/g, ' ')), 'summary follows');
    await ctx.close();
  });

  await check('Remind opens the same sheet the Home money card opens ("Remind · Thu, Nov 12", one Text per person who owes); gone when nobody owes', async () => {
    const { ctx, page } = await openAdmin();
    await openByMoneyCell(page, g1.id);
    await page.locator('dialog.sheet[open] [data-ps-remind]').click();
    await page.waitForTimeout(400);
    const dlgs = page.locator('dialog.sheet[open]');
    assert((await dlgs.count()) === 2, `two sheets open, ${await dlgs.count()}`);
    const top = dlgs.last();
    assert(/^Remind · Thu, Nov 12$/.test((await top.locator('h2').first().innerText()).trim()), await top.locator('h2').first().innerText());
    const rows = await top.locator('[data-remind-row]').evaluateAll((els) => els.map((e) => e.getAttribute('data-remind-row')));
    assert(JSON.stringify(rows) === JSON.stringify(['Christopher Vanderberg']), `owes: ${rows}`); // Vic was marked paid above
    assert((await top.locator('a[href^="sms:"]').count()) >= 1, 'a Text link');
    await ctx.close();
    // Everybody paid: no Remind.
    const g = await sessionOf(g1.id);
    const c = g.roster.find((r) => r.name === 'Christopher Vanderberg');
    assert((await call('POST', `/api/admin/sessions/${g1.id}/payment`, { playerId: c.playerId, paid: true, seen: c.moneySeen, cents: c.owesCents })).ok, 'pay the last one');
    const b = await openAdmin();
    await openByMoneyCell(b.page, g1.id);
    assert((await sheet(b.page).locator('[data-ps-remind]').count()) === 0, 'Remind with nobody owing');
    assert(/^3 of 3 paid/.test((await sheet(b.page).locator('.ps-count').innerText()).replace(/\s+/g, ' ')), 'all paid');
    await b.ctx.close();
  });

  const putBack = async () => call('POST', `/api/admin/sessions/${g1.id}/roster`, { playerId: idOf('Parker'), action: 'confirm' });
  await check('Remove (in the three-dot menu): the same question "Remove Parker?", the same toast with Undo; Undo keeps them; waiting removes them (and the chip appears)', async () => {
    const { ctx, page } = await openAdmin();
    await openByMoneyCell(page, g1.id);
    const dlg = sheet(page);
    await row(page, 'Parker').locator('.ps-dots').click();
    const rm = dlg.getByRole('menuitem', { name: 'Remove Parker' });
    await rm.waitFor();
    const pop = await dlg.locator('.ps-pop').boundingBox();
    const view = page.viewportSize();
    assert(pop.x >= 0 && pop.x + pop.width <= view.width && pop.y >= 0 && pop.y + pop.height <= view.height, `menu outside the screen: ${JSON.stringify(pop)}`);
    await rm.click();
    const ask = page.locator('dialog.sheet[open]').last();
    assert((await ask.locator('h2').first().innerText()).trim() === 'Remove Parker?', 'the question');
    assert(/They'll show as withdrawn/.test(await ask.innerText()), 'the same words');
    await ask.getByRole('button', { name: 'Remove', exact: true }).click();
    const undo = page.locator('.pop.toast .toast-action', { hasText: 'Undo' }).first();
    await undo.waitFor({ timeout: 5000 });
    assert(/Parker removed/.test(await page.locator('.pop.toast').first().innerText()), 'toast words');
    assert((await row(page, 'Parker').locator('.ps-sub').innerText()) === 'Removed', 'shown as removed at once');
    await page.waitForTimeout(900); // an Undo tapped right after the Remove tap is read as a double tap and ignored, on purpose
    await undo.click();
    await page.waitForTimeout(6500);
    assert((await sessionOf(g1.id)).roster.find((r) => r.name === 'Parker').status === 'confirmed', 'Undo keeps Parker in');
    assert((await row(page, 'Parker').locator('[data-ps-paid-chip]').count()) === 1, 'Parker is back on the sheet');
    // Now really remove (no Undo).
    await row(page, 'Parker').locator('.ps-dots').click();
    await dlg.getByRole('menuitem', { name: 'Remove Parker' }).click();
    await page.locator('dialog.sheet[open]').last().getByRole('button', { name: 'Remove', exact: true }).click();
    await page.locator('.pop.toast .toast-action', { hasText: 'Undo' }).first().waitFor();
    await page.waitForTimeout(6500);
    assert((await sessionOf(g1.id)).roster.find((r) => r.name === 'Parker').status === 'withdrawn', 'Parker removed');
    await page.waitForTimeout(600);
    assert((await dlg.locator('[data-ps-chip="Parker"]').count()) === 1, 'Parker is a name to add again');
    await ctx.close();
  });

  await putBack(); // Parker is back in (whatever the check above did), for the checks below

  await check('Add: tap a chip (green outline plus check), tap again to unselect; "Add Wren" for one, "Add 2 players" for two; it runs Give spot (toast "Wren got a spot"); a declined player is a chip and can be given a spot', async () => {
    const { ctx, page } = await openAdmin();
    await openByMoneyCell(page, g1.id);
    const dlg = sheet(page);
    const wren = dlg.locator('[data-ps-chip="Wren"]');
    await wren.click();
    assert((await wren.getAttribute('aria-pressed')) === 'true' && (await wren.locator('svg').count()) === 1, 'selected look');
    assert((await dlg.locator('[data-ps-add-btn]').innerText()) === 'Add Wren', await dlg.locator('[data-ps-add-btn]').innerText());
    await wren.click();
    assert((await wren.getAttribute('aria-pressed')) === 'false' && (await dlg.locator('[data-ps-add-btn]').count()) === 0, 'unselect');
    await wren.click();
    await dlg.locator('[data-ps-chip="Reese"]').click();
    assert((await dlg.locator('[data-ps-add-btn]').innerText()) === 'Add 2 players', await dlg.locator('[data-ps-add-btn]').innerText());
    await dlg.locator('[data-ps-add-btn]').click();
    await page.locator('.pop.toast').first().waitFor({ timeout: 6000 });
    await page.waitForTimeout(7500);
    const g = await sessionOf(g1.id);
    const st = (n) => g.roster.find((r) => r.name === n)?.status;
    assert(st('Wren') === 'confirmed' && st('Reese') === 'confirmed', `Wren ${st('Wren')}, Reese ${st('Reese')}`);
    await page.waitForTimeout(500);
    assert((await row(page, 'Wren').count()) === 1 && (await row(page, 'Reese').count()) === 1, 'they are rows now');
    assert((await dlg.locator('[data-ps-declined]').count()) === 0, 'Reese no longer declined');
    await ctx.close();
  });

  await check('Add on a FULL game says so in the server\'s words (not a silent grayed button): Max players 4 → "The game is full (4 in)."', async () => {
    const before = (await dash()).group.settings;
    // Card cleanup (no cap) is the live rule; with it off the plain "The game is full" words apply (the server's answer is checked in tests/zip32.test.ts).
    assert((await call('PUT', '/api/admin/card-cleanup-switch', { on: false })).ok, 'card cleanup off');
    try {
      assert((await call('PUT', '/api/admin/group', { settings: { maxPlayers: 4 } })).ok, 'max 4');
      const { ctx, page } = await openAdmin();
      await openByMoneyCell(page, g1.id);
      const dlg = sheet(page);
      const confirmed = (await sessionOf(g1.id)).confirmedCount;
      assert(confirmed >= 4, `the game should be full, ${confirmed} confirmed`);
      await dlg.locator('[data-ps-chip="Zoe"]').click();
      const btn = dlg.locator('[data-ps-add-btn]');
      assert(!(await btn.isDisabled()), 'the Add button must not be a silent disabled one');
      await btn.click();
      const toast = page.locator('.pop.toast').first();
      await toast.waitFor({ timeout: 4000 });
      assert(/The game is full \(4 in\)\./.test(await toast.innerText()), await toast.innerText());
      assert((await sessionOf(g1.id)).roster.find((r) => r.name === 'Zoe')?.status !== 'confirmed', 'Zoe must not be in');
      await ctx.close();
      // The old sheet's other two buttons are still here: a waitlisted player has Give spot (same full rule), a confirmed one has To waitlist in the menu.
      assert((await call('POST', `/api/admin/sessions/${g1.id}/roster`, { playerId: idOf('Zoe'), action: 'waitlist' })).ok, 'Zoe to the waitlist');
      const w = await openAdmin();
      await openByMoneyCell(w.page, g1.id);
      const wd = sheet(w.page);
      assert((await row(w.page, 'Zoe').locator('.ps-sub').innerText()).startsWith('#1 on waitlist'), 'waitlist line');
      assert((await wd.locator('[data-ps-chip="Zoe"]').count()) === 0, 'a waitlisted name is not a chip');
      await row(w.page, 'Zoe').locator('[data-ps-givespot]').click();
      await w.page.locator('.pop.toast').first().waitFor({ timeout: 4000 });
      assert(/The game is full \(4 in\)\./.test(await w.page.locator('.pop.toast').first().innerText()), 'Give spot on a full game says so');
      await row(w.page, 'Vic').locator('.ps-dots').click();
      assert((await wd.getByRole('menuitem', { name: 'Move Vic to the waitlist' }).count()) === 1, 'To waitlist in the menu');
      await w.ctx.close();
      // More names than free seats: nothing is added, the picks stay, it says how many fit.
      // (Zoe leaves the waitlist first: raising Max players would move a waiting player in by itself.)
      assert((await call('POST', `/api/admin/sessions/${g1.id}/roster`, { playerId: idOf('Zoe'), action: 'withdraw' })).ok, 'Zoe off the waitlist');
      assert((await call('PUT', '/api/admin/group', { settings: { maxPlayers: (await sessionOf(g1.id)).confirmedCount + 1 } })).ok, 'one spot left');
      const o = await openAdmin();
      await openByMoneyCell(o.page, g1.id);
      const od = sheet(o.page);
      await od.locator('[data-ps-chip="Quinn"]').click();
      await od.locator('[data-ps-chip="Rowan"]').click();
      await od.locator('[data-ps-add-btn]').click();
      await o.page.locator('.pop.toast').first().waitFor({ timeout: 4000 });
      assert(/Only 1 spot left/.test(await o.page.locator('.pop.toast').first().innerText()), `${await o.page.locator('.pop.toast').first().innerText()} (confirmed ${(await sessionOf(g1.id)).confirmedCount}, roster ${JSON.stringify((await sessionOf(g1.id)).roster.map((r) => r.name + ':' + r.status))})`);
      assert((await od.locator('[data-ps-chip="Quinn"]').getAttribute('aria-pressed')) === 'true', 'the picks stay');
      await o.ctx.close();
    } finally {
      await call('PUT', '/api/admin/group', { settings: { maxPlayers: before.maxPlayers } });
      await call('PUT', '/api/admin/card-cleanup-switch', { on: true });
    }
  });

  await check('the gear menu\'s Players opens the NEW sheet too (both places that open it)', async () => {
    const { ctx, page } = await openAdmin();
    await cardOf(page, g1.id).getByRole('button', { name: /^Game menu for/ }).click();
    await page.getByRole('menuitem', { name: 'Players', exact: true }).click();
    await page.locator('dialog.sheet[open] [data-players-sheet]').waitFor();
    assert(/^Players · Thu, Nov 12$/.test((await sheet(page).locator('h2').first().innerText()).trim()), 'title');
    await ctx.close();
    // Nothing else opens a roster sheet.
    const src = readFileSync(path.join(ROOT, 'src/pages/admin/GameMenu.tsx'), 'utf8') + readFileSync(path.join(ROOT, 'src/pages/admin/CardR2.tsx'), 'utf8') + readFileSync(path.join(ROOT, 'src/pages/admin/Sessions.tsx'), 'utf8');
    const openers = (src.match(/open\('roster'/g) || []).length;
    assert(openers === 3, `places that open the roster sheet: ${openers} (the classic card, the round-2 card, the gear)`);
  });

  // ================================================================ Part A
  await check('A1: the green Undo pill sits fully INSIDE the white toast (light and dark, 390/360/320, text 100 and 150%, motion on and off)', async () => {
    const bad = [];
    for (const scheme of ['light', 'dark'])
      for (const [width, pct] of [[390, 100], [360, 100], [320, 100], [390, 150], [320, 150]])
        for (const motion of [false, true]) {
          const { ctx, page } = await openAdmin({ width, scheme, pct, motion });
          const btn = page.locator('[data-vr-markpaid]').first();
          await btn.scrollIntoViewIfNeeded();
          await btn.click();
          await page.locator('.pop.toast .toast-action').first().waitFor({ timeout: 6000 });
          await page.waitForTimeout(450);
          const m = await page.evaluate(() => {
            const t = document.querySelector('.pop.toast');
            const a = t.querySelector('.toast-action');
            const tr = t.getBoundingClientRect();
            const ar = a.getBoundingClientRect();
            const cs = getComputedStyle(t);
            return { right: tr.right - parseFloat(cs.borderRightWidth) - ar.right, top: ar.top - tr.top - parseFloat(cs.borderTopWidth), bottom: tr.bottom - parseFloat(cs.borderBottomWidth) - ar.bottom, left: ar.left - tr.left, vw: innerWidth, trRight: tr.right, trLeft: tr.left };
          });
          if (m.right < 6 || m.top < 6 || m.bottom < 6 || m.trLeft < 0 || m.trRight > m.vw) bad.push(`${scheme} ${width}@${pct} motion=${motion}: ${JSON.stringify(m)}`);
          if (width === 390 && pct === 100 && motion) await page.screenshot({ path: path.join(SHOTS, `zip32-toast-${scheme}.png`), clip: { x: 0, y: 540, width, height: 220 } });
          // Undo it, so the test saves nothing and the next round has the same rows.
          await page.locator('.pop.toast .toast-action').first().click();
          await ctx.close();
        }
    assert(bad.length === 0, bad.slice(0, 4).join(' | '));
  });

  await check('A2 and A3: History > Sessions: a PLAYED game shows a green check and has NO gear; a CANCELED game keeps its slash icon and its gear, whose menu stays inside the screen and scrolls; a not-yet-finalized game keeps its gear', async () => {
    for (const scheme of ['light', 'dark']) {
      const { ctx, page } = await openAdmin({ scheme });
      await page.getByRole('button', { name: 'History' }).click();
      await page.getByRole('button', { name: 'Sessions', exact: true }).click();
      const rows = page.locator('ul.history-list button.history-row');
      const texts = [];
      for (let i = 0; i < (await rows.count()); i++) texts.push(await rows.nth(i).innerText());
      const at = (re) => texts.findIndex((t) => re.test(t));
      const play = at(/played/);
      const canc = at(/Canceled/);
      const notf = at(/Finalize/);
      assert(play >= 0 && canc >= 0 && notf >= 0, `rows: ${texts.map((t) => t.slice(0, 30)).join(' / ')}`);
      // played
      await rows.nth(play).click();
      let dlg = sheet(page);
      await dlg.locator('.court-status').first().waitFor();
      assert((await dlg.locator('.court-status').first().innerText()).trim() === 'Played', 'Played line');
      assert((await dlg.locator('.court-status svg.court-icon-played').count()) === 1, 'a check, not the slash');
      assert((await dlg.locator('.court-status svg.court-icon path').evaluateAll((ps) => ps.map((p) => p.getAttribute('d')))).join('|').includes('m7.8 12.3'), 'the check mark path');
      const col = await dlg.locator('.court-icon-played').evaluate((e) => getComputedStyle(e).color);
      const [r, g, b] = col.match(/\d+/g).map(Number);
      assert(g > r && g > b - 40, `the check is not green: ${col}`);
      assert((await dlg.locator('.game-menu').count()) === 0, 'a gear on a played game');
      await closeSheets(page);
      // canceled: slash icon kept, gear kept, menu inside the screen
      await rows.nth(canc).click();
      dlg = sheet(page);
      await dlg.locator('.court-status').first().waitFor();
      assert((await dlg.locator('.court-status svg.court-icon-played').count()) === 0, 'Canceled must not get the check');
      assert((await dlg.locator('.court-status svg.court-icon path').evaluateAll((ps) => ps.map((p) => p.getAttribute('d')))).join('|').includes('m5.8 5.8'), 'the slash path stays on Canceled');
      await dlg.locator('.game-menu button[aria-haspopup="menu"]').click();
      await page.waitForTimeout(300);
      let m = await page.evaluate(() => {
        const p = document.querySelector('.menu-pop');
        const r = p.getBoundingClientRect();
        return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, vw: innerWidth, vh: innerHeight, scroll: getComputedStyle(p).overflowY, inSheet: !!p.closest('dialog') };
      });
      assert(m.top >= 0 && m.bottom <= m.vh && m.left >= 0 && m.right <= m.vw, `canceled game's menu is outside the screen: ${JSON.stringify(m)}`);
      assert(m.inSheet, 'the menu must be inside the open sheet (the page behind it is under the sheet)');
      // a menu item can really be tapped (it is on top, not hidden behind the sheet)
      const hit = await page.evaluate(() => {
        const it = document.querySelector('.menu-pop [role="menuitem"]');
        const r = it.getBoundingClientRect();
        const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return it.contains(top);
      });
      assert(hit, 'the menu row is covered by something else');
      await closeSheets(page);
      // not finalized: gear kept, same rule
      await rows.nth(notf).click();
      dlg = sheet(page);
      await dlg.locator('.game-menu button[aria-haspopup="menu"]').click();
      await page.waitForTimeout(300);
      m = await page.evaluate(() => {
        const p = document.querySelector('.menu-pop');
        const r = p.getBoundingClientRect();
        return { top: r.top, bottom: r.bottom, vh: innerHeight, inSheet: !!p.closest('dialog') };
      });
      assert(m.top >= 0 && m.bottom <= m.vh && m.inSheet, `not-finalized game's menu: ${JSON.stringify(m)}`);
      await page.screenshot({ path: path.join(SHOTS, `zip32-gear-${scheme}.png`) });
      await ctx.close();
    }
  });

  await check('A3 (Home): the gear on an upcoming game still opens its menu fully on screen (under, over, or as the panel above the tab bar)', async () => {
    for (const [width, height] of [[390, 760], [320, 560]]) {
      const { ctx, page } = await openAdmin({ width, height });
      const cards = page.locator('article[data-r2-card]');
      for (const idx of [0, 1, (await cards.count()) - 1]) {
        const gear = cards.nth(idx).getByRole('button', { name: /^Game menu for/ });
        await gear.scrollIntoViewIfNeeded();
        await gear.click();
        await page.waitForTimeout(300);
        const m = await page.evaluate(() => {
          const p = document.querySelector('.menu-pop');
          const r = p.getBoundingClientRect();
          const bar = document.querySelector('.tabbar')?.getBoundingClientRect();
          return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, vw: innerWidth, vh: innerHeight, barTop: bar ? bar.top : innerHeight, scroll: getComputedStyle(p).overflowY };
        });
        assert(m.top >= 0 && m.left >= 0 && m.right <= m.vw && m.bottom <= m.barTop + 1, `${width}x${height} card ${idx}: ${JSON.stringify(m)}`);
        await page.keyboard.press('Escape');
        await page.waitForTimeout(150);
      }
      await ctx.close();
    }
  });

  // The 9 to 10 player game is the same game filled up (Alex and everyone else).
  for (const n of g1Names) {
    const r = await call('POST', `/api/admin/sessions/${g1.id}/roster`, { playerId: idOf(n), action: 'confirm' });
    if (!r.ok) console.log(`  (could not add ${n}: ${r.status})`);
  }
  await clipRun('9 players');

  await browser.close();
  console.log(`\nzip32: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
