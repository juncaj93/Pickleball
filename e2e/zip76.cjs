/* Zip 76 (🎾76.money fixes): the changed screens in a real browser.
 *
 *   node e2e/zip76.cjs            (ZIP76_ONLY=<letter> runs one check)
 *
 * The world is the preview's calm profile (e2e/zip74-boot.cjs) with the Tournament test page's "Tournament ended" stage: The Cold Open
 * ended tonight, $14 credit to each champion.
 *   A  Money > Totals (pictures totals-pair-1, 2): So far has "The Cold Open tournament" with its result; a tap opens Tickets / Courts /
 *      Prizes in place (no caret), a second tap closes it; the row is at least 44 px tall. 420/390/320, light and dark, nothing wider than
 *      the screen, no word cut.
 *   B  Running total: a "Tournaments 1" row; Month by month opens.
 *   C  a champion (award credit) taps I'm in (credit used), then Drop out: the dialog says "$14 comes back as credit." (MUST 2's money line).
 *   D  the Pay sheet button reads "Open Venmo".
 *   E  Add my name > Is this you?: Back returns to the name box with the typed name kept.
 * Screenshots: .data/zip76-shots (not in git).
 */
const path = require('node:path');
const { mkdirSync } = require('node:fs');
const { boot, flat, assert, ROOT } = require('./zip74-boot.cjs');

const SHOTS = path.join(ROOT, '.data', 'zip76-shots');
const ONLY = process.env.ZIP76_ONLY || '';
let passed = 0;
let failed = 0;
async function check(name, fn) {
  if (ONLY && !name.startsWith(ONLY)) return;
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.log(`  ✗ ${name}\n      ${String(err && err.message ? err.message : err).replace(/\s*\n\s*/g, ' ⏎ ').slice(0, 1400)}`);
  }
}
const SIZES = [420, 390, 320];
const SCHEMES = ['light', 'dark'];

(async () => {
  mkdirSync(SHOTS, { recursive: true });
  const b = await boot({ name: 'zip76', port: Number(process.env.E2E_PORT) || 5479 });
  const shot = (page, n) => page.screenshot({ path: path.join(SHOTS, `${n}.png`), fullPage: true });
  try {
    await b.stage('ended');
    const dash = await b.call('GET', '/api/admin/dashboard');
    const champs = (dash.creditLedger || []).filter((l) => l.balanceCents >= 1400).map((l) => dash.players.find((p) => p.id === l.playerId)?.name).filter(Boolean);

    async function totals(opts) {
      const a = await b.adminHome(opts);
      await a.page.locator('.tabbar button', { hasText: 'Money' }).click();
      const t = a.page.locator('[role="group"][aria-label="Games or Totals"] button', { hasText: 'Totals' });
      await t.waitFor({ timeout: 15000 });
      await a.page.waitForTimeout(500);
      await t.click();
      await a.page.locator('[data-card="so-far"]').waitFor({ timeout: 15000 });
      return a;
    }

    for (const width of SIZES)
      for (const scheme of SCHEMES)
        await check(`A Totals: The Cold Open tournament row, tap opens Tickets / Courts / Prizes, tap closes (${width} ${scheme})`, async () => {
          const a = await totals({ width, scheme });
          const row = a.page.locator('[data-card="so-far"] [data-row="tournament"]');
          await row.waitFor({ timeout: 15000 });
          const words = flat(await row.innerText());
          assert(/^The Cold Open tournament (−\$\d+|\$\d+)$/.test(words), `row words: ${words}`);
          assert(!/the The/.test(words), words);
          const box = await row.boundingBox();
          assert(box && box.height >= 44, `row height ${box && box.height}`);
          assert((await a.page.locator('[data-card="so-far"] .tr-tour .tr-chev').count()) === 0, 'no caret');
          await row.locator('button').click();
          const tickets = a.page.locator('[data-card="so-far"] [data-row="tour-tickets"]');
          await tickets.waitFor({ timeout: 5000 });
          const detail = flat(await a.page.locator('[data-card="so-far"]').innerText());
          assert(/Tickets \d+ paid \$\d+/.test(detail) && /Courts 2 courts · 2\.5 hrs −\$120/.test(detail) && /Prizes credit −\$\d+/.test(detail), detail);
          // The sum is right: tickets - courts - prizes = the result.
          const n = (re) => Number((re.exec(detail) || [])[1]);
          const t = n(/Tickets \d+ paid \$(\d+)/);
          const p = n(/Prizes credit −\$(\d+)/);
          const res = Number(await row.locator('dd').getAttribute('data-tournament-result')) / 100;
          assert(t - 120 - p === res, `tickets ${t} - 120 - prizes ${p} = ${res}`);
          await b.noWider(a.page, 'Totals');
          const cut = await a.page.evaluate(() => [...document.querySelectorAll('.tr *')].filter((e) => e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflow === 'hidden').length);
          assert(cut === 0, `${cut} cut boxes`);
          await shot(a.page, `A-totals-open-${width}-${scheme}`);
          await a.page.waitForTimeout(600); // past the page's double-tap guard (0.4 s)
          await row.locator('button').click();
          await a.page.waitForTimeout(300);
          assert((await tickets.count()) === 0, 'a second tap closes it');
          assert(a.errors.length === 0, a.errors.join(' | '));
          await a.ctx.close();
        });

    await check('B Running total: Tournaments 1 in Out of pocket; Month by month opens', async () => {
      const a = await totals({ width: 390 });
      await a.page.locator('[data-fold="running-total"] button').first().click();
      const r = a.page.locator('[data-row="rt-tournaments"]');
      await r.waitFor({ timeout: 15000 });
      assert(/^Tournaments 1 (−\$\d+|\$\d+)$/.test(flat(await r.innerText())), flat(await r.innerText()));
      await a.page.locator('[data-fold="month-by-month"] button').first().click();
      await a.page.waitForTimeout(800);
      await shot(a.page, 'B-running-total-390');
      await a.ctx.close();
    });

    // C: champion 1 on a game a week out (a plain drop), champion 2 on tonight's game (past the cancel-by, the game would be short).
    const dropCase = async (who, which, scheme, want, tag) => {
      const p = await b.playerPage(who, { width: 390, scheme });
      const join = p.page.locator('[data-join]')[which]();
      await join.click();
      await p.page.waitForTimeout(1500);
      await p.page.reload();
      await p.page.locator('.schedule').first().waitFor({ timeout: 15000 });
      await p.page.waitForTimeout(700);
      await p.page.locator('button', { hasText: /^Drop out$/ })[which]().click();
      const dlg = p.page.locator('dialog[open]');
      await dlg.waitFor({ timeout: 5000 });
      const words = flat(await dlg.innerText());
      assert(words.includes(want) && !/you still owe/.test(words), words);
      await shot(p.page, `C-${tag}-390-${scheme}`);
      await p.ctx.close();
    };
    await check('C a champion ($14 award credit) on a later game: I\'m in uses it; Drop out says "$14 comes back as credit." (light, dark)', async () => {
      assert(champs.length >= 2, `two champions with credit: ${champs.join(', ')}`);
      await dropCase(champs[0], 'last', 'light', 'Your spot opens up for someone else. $14 comes back as credit.', 'plain');
    });
    await check('C2 MUST 2: the other champion on tonight\'s game past the cancel-by: "Your $14 stays on this game unless someone takes your spot." (never "you still owe")', async () => {
      await dropCase(champs[1], 'first', 'dark', 'Your $14 stays on this game unless someone takes your spot.', 'late-paid');
    });

    await check('D the Pay sheet: "Open Venmo"', async () => {
      const p = await b.playerPage('Vic', { width: 390 });
      const join = p.page.locator('[data-join]').first();
      if (await join.count()) await join.click();
      await p.page.waitForTimeout(1500);
      const pay = p.page.locator('button, a', { hasText: /^Pay$/ }).first();
      if (await pay.count()) {
        await pay.click();
        const sheet = p.page.locator('dialog[open]');
        await sheet.waitFor({ timeout: 5000 });
        const words = flat(await sheet.innerText());
        assert(words.includes('Open Venmo') && !words.includes('Click here'), words);
        await shot(p.page, 'D-pay-sheet-390');
      } else {
        // No game asks for payment in this world: the words are checked in the source the sheet renders.
        const src = require('node:fs').readFileSync(path.join(ROOT, 'src/PaySheet.tsx'), 'utf8');
        assert(src.includes('Open Venmo') && !src.includes('Click here'), 'PaySheet words');
      }
      await p.ctx.close();
    });

    for (const width of [390, 320])
      await check(`E Add my name > Is this you?: Back keeps the typed name (${width})`, async () => {
        const p = await b.newPage({ width });
        await p.page.goto(`${b.BASE}/`);
        const add = p.page.locator('button', { hasText: 'Add my name' });
        await add.waitFor({ timeout: 20000 });
        await add.click();
        await p.page.locator('input[type="text"]').fill('vic');
        await p.page.locator('button', { hasText: 'Continue' }).click();
        await p.page.locator('[aria-label="Is this you?"]').waitFor({ timeout: 10000 });
        await shot(p.page, `E-is-this-you-${width}`);
        await p.page.locator('[data-is-this-you-back]').click();
        const box = p.page.locator('input[type="text"]');
        await box.waitFor({ timeout: 5000 });
        assert((await box.inputValue()) === 'vic', `kept: ${await box.inputValue()}`);
        await p.ctx.close();
      });
  } finally {
    await b.close();
  }
  console.log(`\nzip76: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
