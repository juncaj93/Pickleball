/* Zip 97 (🎾97.real pace): browser checks on a LOCAL copy (the preview's world, fixed clock).
 *
 *   node e2e/zip97.cjs                  (ZIP97_ONLY=A,B runs some)
 *
 *   A   8 Locked doubles, fast night (zip97_ld_fast): Round 3, the LAST planned round robin round, is on the courts and the night card offers
 *       "Ahead of time" / Add a round (before Zip 97 it never came this late). Never cut, nothing wider than the screen: 320/375/390/420/440,
 *       text 100/125/150%, light and dark; the question at 375 in both themes. Yes adds RD4 before SEMIS; one round per offer.
 *   B   6 players switch to Americano (zip97_six): the organizer's Home card "The Cold Open switched to Americano (6 players)." /
 *       "6 locked in. 6 players play Americano." (every width, size, theme); View as Parker: "Tournament style is now Americano." once.
 * Screenshots: .data/zip97-shots (not in git).
 */
const path = require('node:path');
const { mkdirSync } = require('node:fs');
const { boot, flat, assert, ROOT } = require('./zip74-boot.cjs');

const SHOTS = path.join(ROOT, '.data', 'zip97-shots');
const ONLY = process.env.ZIP97_ONLY || '';
const WIDTHS = [320, 375, 390, 420, 440];
const SIZES = [100, 125, 150];
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
const zoom = (page, pct) => page.addStyleTag({ content: `html { font-size: ${pct}% !important; }` });

/** Cut (hidden overflow), text past its own box, words broken mid-word. */
const scan = (page, sel) =>
  page.evaluate((s) => {
    const out = [];
    for (const el of document.querySelectorAll(s)) {
      if (!el.getClientRects().length) continue;
      const cs = getComputedStyle(el);
      if (el.scrollWidth > el.clientWidth + 1 && cs.textOverflow !== 'ellipsis' && cs.overflowX !== 'visible') out.push(`cut: "${el.textContent.trim().slice(0, 30)}"`);
      const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let n = walk.nextNode(); n; n = walk.nextNode()) {
        const text = n.textContent || '';
        let at = 0;
        for (const word of text.split(/(\s+)/)) {
          if (word.trim().length > 1) {
            const rg = document.createRange();
            rg.setStart(n, at);
            rg.setEnd(n, at + word.length);
            const rects = [...rg.getClientRects()].filter((x) => x.width > 0);
            if (rects.length > 1 && Math.abs(rects[0].top - rects[rects.length - 1].top) > 2) out.push(`broken: "${word}"`);
          }
          at += word.length;
        }
      }
    }
    return [...new Set(out)];
  }, sel);

(async () => {
  mkdirSync(SHOTS, { recursive: true });
  const port = Number(process.env.E2E_PORT) || 5497;
  const b = await boot({ name: 'zip97', port });
  /** Every width, text size and theme: open, scan, check nothing is wider than the screen. */
  const sweep = async (label, sel, open, extra) => {
    const bad = [];
    for (const scheme of ['light', 'dark'])
      for (const width of WIDTHS)
        for (const pct of SIZES) {
          const p = await open(width, scheme);
          if (pct !== 100) await zoom(p.page, pct);
          await p.page.waitForTimeout(300);
          const found = await scan(p.page, sel);
          const wide = await p.page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
          if (wide) found.push('wider than the screen');
          if (extra) found.push(...(await extra(p.page)));
          if (found.length) {
            bad.push(`${label} ${scheme} ${width} ${pct}%: ${found.join(' | ')}`);
            await p.page.screenshot({ path: path.join(SHOTS, `${label}-${scheme}-${width}-${pct}.png`), fullPage: true });
          }
          if (width === 375 && pct === 100) await p.page.screenshot({ path: path.join(SHOTS, `${label}-${scheme}-375.png`) }).catch(() => undefined);
          assert(!(p.errors || []).length, (p.errors || []).join('; '));
          await p.ctx.close();
        }
    assert(!bad.length, bad.join('\n        '));
  };
  const night = async (width, scheme) => {
    const p = await b.adminHome({ width, scheme });
    await p.page.locator('[data-nc-bonus="round"]').waitFor({ timeout: 15000 });
    return p;
  };
  try {
    await check('A 8 Locked doubles fast night: Add a round with Round 3 (the last planned) on the courts; never cut; Yes adds RD4 before SEMIS', async () => {
      await b.stage('zip97_ld_fast');
      await sweep('ld-fast', '.nc-ahead, .nc-ahead > *, [data-nc] .nc-bar, [data-nc] button', night, async (page) => {
        const out = [];
        const word = flat(await page.locator('[data-nc-bonus] .nc-ahead-word').textContent());
        if (word !== 'Ahead of time') out.push(`word "${word}"`);
        const h = await page.locator('[data-nc-bonus-add]').evaluate((el) => el.getBoundingClientRect().height);
        if (h < 44) out.push(`Add a round ${h} px tall`);
        return out;
      });
      for (const scheme of ['light', 'dark']) {
        const { page, ctx, errors } = await night(375, scheme);
        await page.locator('[data-nc-bonus-add]').click();
        assert(flat(await page.locator('[data-nc-bonus-ask] .nc-ahead-q').textContent()) === 'Add a round? Are you sure?', 'the question');
        await page.locator('[data-nc-bonus-ask]').screenshot({ path: path.join(SHOTS, `A-ask-${scheme}.png`) });
        if (scheme === 'dark') {
          await page.locator('[data-nc-bonus-yes]').click();
          await page.waitForFunction(() => /RD4/.test(document.querySelector('[data-nc]')?.textContent || '') && /SEMIS/.test(document.querySelector('[data-nc]')?.textContent || ''), null, { timeout: 15000 });
          const bars = flat(await page.locator('[data-nc]').first().textContent());
          assert(bars.indexOf('RD4') < bars.indexOf('SEMIS'), `RD4 before SEMIS: ${bars.slice(0, 120)}`);
          assert(!(await page.locator('[data-nc-bonus]').count()), 'one round per offer: no new offer at once');
          await page.locator('[data-nc]').first().screenshot({ path: path.join(SHOTS, 'A-after-yes.png') });
        }
        assert(!errors.length, errors.join('; '));
        await ctx.close();
      }
    });

    await check('B 6 players switch to Americano: the organizer card and the players’ line (every width, size, theme)', async () => {
      await b.stage('zip97_six');
      const open = async (width, scheme) => {
        const p = await b.adminHome({ width, scheme });
        await p.page.locator('[data-tm-odd-switch]').waitFor({ timeout: 15000 });
        return p;
      };
      await sweep('six', '[data-tm-odd-switch], [data-tm-odd-switch] *', open, async (page) => {
        const out = [];
        const t = flat(await page.locator('[data-tm-odd-switch]').textContent());
        if (!t.includes('The Cold Open switched to Americano (6 players).')) out.push(`title "${t}"`);
        if (!t.includes('6 locked in. 6 players play Americano.')) out.push(`sub "${t}"`);
        return out;
      });
      for (const scheme of ['light', 'dark']) {
        const { page, ctx } = await b.playerPage('Parker', { width: 375, scheme });
        await page.getByText('Tournament style is now Americano.').first().waitFor({ timeout: 15000 });
        assert((await page.getByText('Tournament style is now Americano.').count()) === 1, 'the news once');
        await page.screenshot({ path: path.join(SHOTS, `B-parker-${scheme}.png`) });
        await ctx.close();
      }
    });
  } finally {
    await b.close();
    console.log(`\nzip97: ${passed} passed, ${failed} failed`);
    process.exit(failed ? 1 : 0);
  }
})();
