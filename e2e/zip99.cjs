/* Zip 99 (🎾99.snow, Alex's pick): the small tournament row is left out when it would be the FIRST card in the list and the big tournament
 * card shows above; a week heading left with no card under it goes too. The Christmas snow cap stays on the first game card, as before.
 *
 *   node e2e/zip99.cjs                  (ZIP99_ONLY=A,B runs some)
 *
 * The preview's calm world on a local server, the clock on Sat Nov 28, 2026, noon Eastern (inside the Christmas window).
 *   A   Row would be first (zip86_next: The Cold Open Tue Dec 1, no game before it): no row; NEXT WEEK stays (the Dec 1 game is under it);
 *       the big card shows; theme on: one snow cap, on the first game card.
 *   B   My games with only a game the week after (the tournament's week has none of Parker's games): no row and no NEXT WEEK heading; LATER
 *       over the game.
 *   C   A game before the tournament (zip86_signup: The Cold Open Tue Dec 8): the row stays, under LATER, after the games; snow on the first game.
 *   D   320 / 375 / 390 / 420 / 440, light and dark, text 100 / 125 / 150 %, theme off and on: no row, no empty heading, the cap on the first
 *       game card, nothing wider than the screen, no errors.
 * Screenshots: .data/zip99-shots (not in git).
 */
const path = require('node:path');
const { mkdirSync } = require('node:fs');
const { boot, assert, ROOT } = require('./zip74-boot.cjs');

const SHOTS = path.join(ROOT, '.data', 'zip99-shots');
const ONLY = process.env.ZIP99_ONLY || '';
const NOW = Date.parse('2026-11-28T17:00:00.000Z'); // Sat Nov 28, 12:00 PM Eastern
let passed = 0;
let failed = 0;
async function check(name, fn) {
  if (ONLY && !ONLY.split(',').some((x) => name.split(' ')[0] === x)) return;
  const t0 = Date.now();
  try {
    await fn();
    passed++;
    console.log(`  ok    ${name} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  } catch (err) {
    failed++;
    console.log(`  FAIL  ${name}\n        ${String(err && err.stack ? err.stack : err).split('\n').slice(0, 5).join('\n        ')}`);
  }
}

/** The list in order: headings ('h:Next week') and cards ('row' / 'game'), the big card, where the snow sits. */
function listFacts(page) {
  return page.evaluate(() => {
    const items = [...document.querySelectorAll('.schedule > .week-break:not(.filter-only), .schedule > .sched, .schedule > .tw-row')].map((el) =>
      el.classList.contains('week-break') ? `h:${el.querySelector('h3')?.textContent ?? ''}` : el.classList.contains('tw-row') ? 'row' : 'game',
    );
    const empty = items.filter((x, i) => x.startsWith('h:') && (i === items.length - 1 || items[i + 1].startsWith('h:')));
    const capped = [...document.querySelectorAll('.xs-top')];
    const firstGame = document.querySelector('.schedule > .sched');
    let cap = null;
    if (firstGame && firstGame.classList.contains('xs-top')) {
      const cs = getComputedStyle(firstGame, '::before');
      cap = { content: cs.content, height: cs.height, left: cs.left, right: cs.right };
    }
    return { items, empty, big: document.querySelectorAll('[data-tournament] .tc-card, [data-tournament] [data-tc-card], .tc-wrap').length > 0, capped: capped.length, capOnFirstGame: !!cap, cap, skin: document.documentElement.getAttribute('data-skin') };
  });
}

(async () => {
  mkdirSync(SHOTS, { recursive: true });
  const b = await boot({ name: 'zip99', port: Number(process.env.E2E_PORT) || 5499 });
  try {
    await b.setClock(NOW);
    await b.call('PUT', '/api/admin/christmas-skin-switch', { mode: 'all' });
    const themeOn = async (page) => {
      const logo = page.locator('button.skin-logo');
      await logo.waitFor({ timeout: 15000 });
      if ((await page.evaluate(() => document.documentElement.getAttribute('data-skin'))) !== 'christmas') await logo.click();
      await page.waitForTimeout(500);
    };

    await check('A row would be first: no row, NEXT WEEK stays over the game, snow on the first game', async () => {
      await b.stage('zip86_next');
      const { page, ctx, errors } = await b.playerPage('Parker', { width: 390 });
      const off = await listFacts(page);
      assert(off.big, 'the big card shows');
      assert(!off.items.includes('row'), `no row: ${off.items}`);
      assert(off.items[0] === 'h:Next week' && off.items[1] === 'game', `NEXT WEEK over the first game: ${off.items}`);
      assert(off.empty.length === 0 && off.capped === 0, JSON.stringify(off));
      await page.screenshot({ path: path.join(SHOTS, 'A-390-light-off.png') });
      await themeOn(page);
      const on = await listFacts(page);
      assert(on.skin === 'christmas' && on.capped === 1 && on.capOnFirstGame, `snow on the first game: ${JSON.stringify(on)}`);
      assert(on.cap.height === '12px' && on.cap.left === '30px' && on.cap.right === '30px', JSON.stringify(on.cap));
      await page.screenshot({ path: path.join(SHOTS, 'A-390-light-on.png') });
      assert(errors.length === 0, errors.join('; '));
      await ctx.close();
    });

    await check('B My games, nothing of mine in the tournament week: no row and no empty NEXT WEEK', async () => {
      await b.stage('zip86_next');
      const parker = await b.phone('Parker');
      const later = (await parker.group()).sessions.find((x) => !x.canceled && Date.parse(x.startsAt) > Date.parse('2026-12-07T05:00:00Z'));
      assert(later, 'a game the week after next');
      const joined = await parker.post(`/api/sessions/${later.id}/join`, {});
      assert(joined.ok, `join: ${joined.status} ${JSON.stringify(joined.body)}`);
      try {
        const { page, ctx, errors } = await b.playerPage('Parker', { width: 390 });
        await page.locator('.filter-toggle').first().click();
        await page.waitForTimeout(500);
        // LATER games sit behind More games; with them folded the list is empty and only the switch line shows (no heading, no row).
        const folded = await listFacts(page);
        assert(folded.items.length === 0 && (await page.locator('.schedule > .filter-only .filter-toggle').count()) === 1, `folded: ${folded.items}`);
        await page.locator('[data-later-toggle]').click();
        await page.waitForTimeout(500);
        const f = await listFacts(page);
        await page.screenshot({ path: path.join(SHOTS, 'B-mine-390.png'), fullPage: true });
        assert(f.big && !f.items.includes('row') && !f.items.includes('h:Next week'), `no row, no NEXT WEEK: ${f.items}`);
        assert(f.items[0] === 'h:Later' && f.items[1] === 'game' && f.empty.length === 0, `LATER over the game: ${f.items}`);
        await page.screenshot({ path: path.join(SHOTS, 'B-mine-390.png') });
        await page.locator('.filter-toggle').first().click();
        assert(errors.length === 0, errors.join('; '));
        await ctx.close();
      } finally {
        await parker.post(`/api/sessions/${later.id}/withdraw`, {});
        await parker.ctx.close();
      }
    });

    await check('C a game before the tournament: the row stays after the games, snow on the first game', async () => {
      await b.stage('zip86_signup');
      const { page, ctx, errors } = await b.playerPage('Parker', { width: 390 });
      await themeOn(page);
      const f = await listFacts(page);
      const r = f.items.indexOf('row');
      assert(r > 0 && f.items.slice(0, r).includes('game'), `the row after a game: ${f.items}`);
      assert(f.capped === 1 && f.capOnFirstGame && f.empty.length === 0, JSON.stringify(f));
      await page.screenshot({ path: path.join(SHOTS, 'C-390-on.png'), fullPage: true });
      assert(errors.length === 0, errors.join('; '));
      await ctx.close();
    });

    await check('D sizes, light and dark, text sizes, theme off and on', async () => {
      await b.stage('zip86_next');
      const bad = [];
      for (const scheme of ['light', 'dark']) {
        for (const width of [320, 375, 390, 420, 440]) {
          const { page, ctx, errors } = await b.playerPage('Parker', { width, scheme });
          for (const theme of ['off', 'on']) {
            if (theme === 'on') await themeOn(page);
            for (const size of ['100%', '125%', '150%']) {
              await page.evaluate((s) => (document.documentElement.style.fontSize = s), size);
              await page.waitForTimeout(250);
              const f = await listFacts(page);
              const tag = `${scheme} ${width} ${size} theme ${theme}`;
              if (!f.big || f.items.includes('row') || f.empty.length || f.items[1] !== 'game') bad.push(`${tag}: ${f.items}`);
              if (theme === 'on' ? !(f.capped === 1 && f.capOnFirstGame) : f.capped !== 0) bad.push(`${tag}: snow ${JSON.stringify(f.cap)} ${f.capped}`);
              const w = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
              if (w[0] > w[1]) bad.push(`${tag}: page ${w[0]} on ${w[1]}`);
              if (width === 320 || width === 440) await page.screenshot({ path: path.join(SHOTS, `D-${width}-${scheme}-${theme}-${size.replace('%', '')}.png`) });
            }
          }
          if (errors.length) bad.push(`${scheme} ${width}: ${errors.join('; ')}`);
          await ctx.close();
        }
      }
      assert(bad.length === 0, bad.join('\n'));
    });
  } finally {
    await b.call('PUT', '/api/admin/christmas-skin-switch', { mode: 'off' }).catch(() => {});
    await b.close();
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
