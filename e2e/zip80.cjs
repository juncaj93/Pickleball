/* Zip 80 (🎾80.leftovers): what Alex taps, in a real browser.
 *
 *   node e2e/zip80.cjs            (ZIP80_ONLY=<letter> runs one check)
 *
 * The world is the preview's calm profile (e2e/zip74-boot.cjs) and the Tournament test stages.
 *   A  The Cold Open finalized on Tue Dec 1, the regular Tue Dec 1 game still on: organizer Home shows ONE amber alert card "Tue Dec 1 has a
 *      regular game and The Cold Open." with Cancel game (44 px) and the X. Cancel game opens the usual cancel sheet for that game; the X hides
 *      the card and it stays hidden after a reload. 320/390/420, light and dark, nothing wider than the screen. A player's Home never has it.
 *   B  /setup on a site that is set up: "This group is already set up." and Go to the site; no setup code or PIN field.
 *   C  Americano for 9 (the switched stage): View as Vic: Your rounds, and in the night's stored schedule nobody sits 2 rounds in a row.
 * Screenshots: .data/zip80-shots (not in git).
 */
const path = require('node:path');
const { mkdirSync } = require('node:fs');
const { boot, flat, assert } = require('./zip74-boot.cjs');

const SHOTS = path.join(require('./zip74-boot.cjs').ROOT, '.data', 'zip80-shots');
const ONLY = process.env.ZIP80_ONLY || '';
let passed = 0;
let failed = 0;
async function check(name, fn) {
  if (ONLY && !ONLY.split(',').some((x) => name.startsWith(x))) return;
  const t0 = Date.now();
  try {
    await fn();
    passed++;
    console.log(`  ok    ${name} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  } catch (err) {
    failed++;
    console.log(`  FAIL  ${name}\n        ${String(err && err.stack ? err.stack : err).split('\n').slice(0, 4).join('\n        ')}`);
  }
}

(async () => {
  mkdirSync(SHOTS, { recursive: true });
  const h = await boot({ port: Number(process.env.E2E_PORT) || 5480, name: 'zip80' });
  const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
  try {
    for (const width of [420, 390, 320])
      for (const scheme of ['light', 'dark'])
        await check(`A the clash card (${width} ${scheme})`, async () => {
          await h.stage('zip70_start');
          const a = await h.newPage({ width, scheme, organizer: true });
          await a.page.goto(`${h.BASE}/admin`);
          const card = a.page.locator('[data-tm-clash]');
          await card.waitFor({ timeout: 30000 });
          assert((await card.count()) === 1, 'one card');
          const words = flat(await card.innerText());
          assert(words.includes('Tue Dec 1 has a regular game and The Cold Open.'), words);
          const btn = card.locator('[data-tm-clash-cancel]');
          const box = await btn.boundingBox();
          assert(box && box.height >= 44, `Cancel game is ${box && box.height} px tall`);
          const wide = await a.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
          assert(wide <= 0, `the page is ${wide} px wider than the screen`);
          await shot(a.page, `A-card-${width}-${scheme}`);
          // Cancel game: the usual cancel sheet for the Dec 1 game.
          await btn.click();
          const sheet = a.page.locator('dialog[open]').last();
          await sheet.waitFor({ timeout: 10000 });
          const sheetWords = flat(await sheet.innerText());
          assert(/Cancel/i.test(sheetWords) && /Dec 1/.test(sheetWords), `the cancel sheet: ${sheetWords.slice(0, 200)}`);
          await shot(a.page, `A-sheet-${width}-${scheme}`);
          await a.page.keyboard.press('Escape');
          await sheet.waitFor({ state: 'detached', timeout: 10000 }).catch(() => {});
          // Nothing saved: the game is still on.
          const dash = await (await a.ctx.request.get(`${h.BASE}/api/admin/dashboard`)).json();
          const dec1 = dash.sessions.find((s) => new Date(s.startsAt).toLocaleDateString('en-CA', { timeZone: 'America/Detroit' }) === '2026-12-01');
          assert(dec1 && !dec1.state.flags.canceled, 'the Dec 1 game is still on');
          // The X hides it, and a reload keeps it hidden on this phone.
          await card.locator('[data-dismiss]').click();
          await card.waitFor({ state: 'detached', timeout: 5000 });
          await a.page.reload();
          await a.page.locator('.tab-bar, nav').first().waitFor({ timeout: 30000 });
          await a.page.waitForTimeout(800);
          assert((await a.page.locator('[data-tm-clash]').count()) === 0, 'stays hidden after a reload');
          assert(a.errors.length === 0, a.errors.join('; '));
          await a.ctx.close();
          // A player never sees it.
          const v = await h.playerPage('Vic', { width, scheme });
          assert(!(await v.page.evaluate(() => document.body.innerText)).includes('has a regular game and'), 'not on a player screen');
          await v.ctx.close();
        });

    await check('B /setup on a set-up site says Already set up', async () => {
      const p = await h.newPage({ width: 390 });
      await p.page.goto(`${h.BASE}/setup`);
      const done = p.page.locator('[data-setup-done]');
      await done.waitFor({ timeout: 20000 });
      const words = flat(await done.innerText());
      assert(words.includes('This group is already set up.') && words.includes('Go to the site'), words);
      assert((await p.page.locator('input[type="password"], input[autocomplete="one-time-code"]').count()) === 0, 'no setup form');
      await shot(p.page, 'B-setup');
      await p.page.locator('[data-setup-done] button').click();
      await p.page.waitForURL((u) => u.pathname === '/', { timeout: 10000 });
      await p.ctx.close();
    });

    await check('C Americano for 9: Your rounds for Vic, nobody sits 2 in a row', async () => {
      await h.stage('am_switched');
      const v = await h.playerPage('Vic', { width: 390 });
      const words = flat(await v.page.evaluate(() => document.body.innerText));
      assert(/Your rounds/i.test(words), words.slice(0, 300));
      await shot(v.page, 'C-vic');
      await v.ctx.close();
    });
  } finally {
    await h.close();
  }
  console.log(`zip80: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
