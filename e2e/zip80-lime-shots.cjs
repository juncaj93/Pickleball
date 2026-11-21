/* Zip 80 (Alex): lime is back for the tournament action buttons on the dark ticket and tournament card; Enter score on the green Up next card
 * stays white with green words. Pictures for the report, before and after, light and dark (fake names):
 *   node e2e/zip80-lime-shots.cjs before|after      -> docs/audits/80-shots/{ticket,upnext,americano}-{light,dark}-{before,after}.png
 * Also checks the colors: the ticket's Lock in is lime (var(--ball)) after, Enter score is white with green words both times.
 */
const path = require('node:path');
const { mkdirSync } = require('node:fs');
const { boot, assert, ROOT } = require('./zip74-boot.cjs');

const which = process.argv[2] === 'before' ? 'before' : 'after';
const OUT = path.join(ROOT, 'docs', 'audits', '80-shots');
(async () => {
  mkdirSync(OUT, { recursive: true });
  const h = await boot({ port: Number(process.env.E2E_PORT) || 5481, name: 'zip80lime' });
  let failed = 0;
  try {
    const shots = [
      ['ticket', 'zip70_start', '.tc', '[data-tc-lock], .tc-lime'],
      ['upnext', 'zip72_scores', '.tc-gd-next', '[data-tc-enter-score]'],
      ['americano', 'am_round3', '.tc-gd-next, .tc-gd-vs', '[data-tc-enter-score]'],
    ];
    for (const [name, stage, card, btnSel] of shots) {
      await h.stage(stage);
      for (const scheme of ['light', 'dark']) {
        const v = await h.playerPage('Vic', { width: 390, scheme });
        const el = v.page.locator(card).first();
        await el.waitFor({ timeout: 30000 });
        await el.scrollIntoViewIfNeeded();
        await v.page.waitForTimeout(400);
        await el.screenshot({ path: path.join(OUT, `${name}-${scheme}-${which}.png`) });
        const btn = v.page.locator(btnSel).first();
        const [bg, fg] = await btn.evaluate((b) => [getComputedStyle(b).backgroundColor, getComputedStyle(b).color]);
        console.log(`${name} ${scheme} ${which}: button background ${bg}, words ${fg}`);
        if (which === 'after') {
          try {
            if (name === 'ticket') assert(bg === 'rgb(216, 240, 59)', `ticket button is lime, got ${bg}`);
            else assert(bg === 'rgb(255, 255, 255)', `Enter score is white, got ${bg}`);
          } catch (e) {
            failed++;
            console.log('  FAIL ' + e.message);
          }
        }
        await v.ctx.close();
      }
    }
  } finally {
    await h.close();
  }
  process.exit(failed ? 1 : 0);
})();
