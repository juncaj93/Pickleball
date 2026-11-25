/* Zip 89 (🎾89.smart pacing): browser checks on a LOCAL copy (the preview's calm world, fixed clock).
 *
 *   node e2e/zip89.cjs                  (ZIP89_ONLY=A,B runs some)
 *
 *   A   Americano ahead (zip89_am_ahead) at 320/390/420, light and dark, text at 100, 125 and 150%: the slim green "Ahead of time" line with
 *       Add a round (44 px) sits right above All rounds / Standings, inside the card, nothing wider than the screen, no word cut anywhere on
 *       the night card (large text: a court box puts Score under the names).
 *   B   The tap: "Add a round? Are you sure?" with two equal buttons (44 px; Yes the site green, No a red outline); No changes nothing; Yes
 *       adds RD7 to the bars at once and the line goes. A player's phone (View as Vic) never shows the line.
 *   C   Locked doubles ahead (zip89_ld_semis): "Add semifinals? Are you sure?", Yes: SEMIS between RD3 and FINAL.
 *   D   Best of 3 in play (zip89_bo3) at 320/390, light and dark: the "Final · G2" pill, "Best of 3 · G1 11–8 · G2 –" under the box; the
 *       finalist's phone lists "Final · Game 2".
 * Screenshots: .data/zip89-shots (not in git).
 */
const path = require('node:path');
const { mkdirSync } = require('node:fs');
const { boot, flat, assert, ROOT } = require('./zip74-boot.cjs');

const SHOTS = path.join(ROOT, '.data', 'zip89-shots');
const ONLY = process.env.ZIP89_ONLY || '';
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

/** Words broken in the middle, or boxes cut, inside `sel`. */
const cutOrBroken = (page, sel) =>
  page.evaluate((s) => {
    const out = [];
    for (const el of document.querySelectorAll(s)) {
      if (el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX !== 'visible') out.push(`cut: ${el.className}`);
      const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let n = walk.nextNode(); n; n = walk.nextNode()) {
        const text = n.textContent || '';
        let at = 0;
        for (const word of text.split(/(\s+)/)) {
          if (word.trim().length > 1) {
            const r = document.createRange();
            r.setStart(n, at);
            r.setEnd(n, at + word.length);
            const rects = [...r.getClientRects()].filter((x) => x.width > 0);
            if (rects.length > 1 && Math.abs(rects[0].top - rects[rects.length - 1].top) > 2) out.push(`broken: "${word}"`);
          }
          at += word.length;
        }
      }
    }
    return out;
  }, sel);
const zoom = (page, pct) => page.addStyleTag({ content: `html { font-size: ${pct}% !important; }` });
const box = (loc) => loc.evaluate((x) => { const r = x.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), top: r.top, bottom: r.bottom }; });

(async () => {
  mkdirSync(SHOTS, { recursive: true });
  const b = await boot({ name: 'zip89', port: Number(process.env.E2E_PORT) || 5489 });
  const dash = () => b.call('GET', '/api/admin/dashboard');
  try {
    await check('A the offer line (320/390/420, light and dark, text 100/125/150%)', async () => {
      await b.stage('zip89_am_ahead');
      for (const width of [320, 390, 420])
        for (const scheme of ['light', 'dark'])
          for (const pct of [100, 125, 150]) {
            const { page, ctx, errors } = await b.adminHome({ width, scheme });
            if (pct !== 100) await zoom(page, pct);
            const line = page.locator('[data-nc-bonus]');
            await line.waitFor({ timeout: 15000 });
            assert(flat(await line.locator('.nc-ahead-word').textContent()) === 'Ahead of time', 'the words');
            const add = line.locator('[data-nc-bonus-add]');
            assert(flat(await add.textContent()) === 'Add a round', 'the button');
            const a = await box(add);
            assert(a.h >= 44, `button ${a.h} px tall`);
            // Right above All rounds / Standings, inside the card.
            const l = await box(line);
            const btns = await box(page.locator('.nc-btns'));
            assert(l.bottom <= btns.top && btns.top - l.bottom < 20, `line above All rounds (${l.bottom} / ${btns.top})`);
            const bg = await line.evaluate((x) => getComputedStyle(x).backgroundColor);
            assert(bg !== 'rgba(0, 0, 0, 0)', 'a tinted line');
            await b.noWider(page, `offer ${width} ${scheme} ${pct}%`);
            // The whole night card: with large text a court box stacks its row (Score under the names), so no name is cut or broken.
            const bad = await cutOrBroken(page, '[data-nc]');
            assert(!bad.length, `${width} ${scheme} ${pct}%: ${bad.join(', ')}`);
            if (pct === 100 || width === 320) await page.locator('[data-nc]').screenshot({ path: path.join(SHOTS, `A-offer-${width}-${scheme}-${pct}.png`) });
            assert(!errors.length, errors.join('; '));
            await ctx.close();
          }
    });

    await check('B Are you sure?: two equal buttons; No keeps it; Yes adds RD7; players never see it', async () => {
      await b.stage('zip89_am_ahead');
      for (const scheme of ['light', 'dark']) {
        const { page, ctx, errors } = await b.adminHome({ width: 390, scheme });
        await page.locator('[data-nc-bonus-add]').click();
        const ask = page.locator('[data-nc-bonus-ask]');
        await ask.waitFor();
        assert(flat(await ask.locator('.nc-ahead-q').textContent()) === 'Add a round? Are you sure?', 'the question');
        const yes = await box(ask.locator('[data-nc-bonus-yes]'));
        const no = await box(ask.locator('[data-nc-bonus-no]'));
        assert(yes.w === no.w && yes.h === no.h && yes.h >= 44, `equal buttons ${JSON.stringify([yes, no])}`);
        const [yBg, nBorder, nBg] = await ask.evaluate((x) => {
          const y = getComputedStyle(x.querySelector('[data-nc-bonus-yes]'));
          const n = getComputedStyle(x.querySelector('[data-nc-bonus-no]'));
          return [y.backgroundColor, n.borderTopColor, n.backgroundColor];
        });
        const [primary, danger] = await page.evaluate(() => {
          const probe = document.createElement('i');
          document.body.append(probe);
          probe.style.color = 'var(--primary)';
          const p = getComputedStyle(probe).color;
          probe.style.color = 'var(--danger-edge)';
          const d = getComputedStyle(probe).color;
          probe.remove();
          return [p, d];
        });
        assert(yBg === primary, `Yes green ${yBg} / ${primary}`);
        assert(nBorder === danger && nBg !== danger, `No red outline ${nBorder} / ${danger}`);
        await page.locator('[data-nc]').screenshot({ path: path.join(SHOTS, `B-ask-390-${scheme}.png`) });
        await ask.locator('[data-nc-bonus-no]').click();
        await page.locator('[data-nc-bonus]').waitFor();
        assert(Math.max(...(await dash()).tournament.rounds.games.map((g) => g.round)) === 6, 'No changed nothing');
        if (scheme === 'dark') {
          await page.locator('[data-nc-bonus-add]').click();
          await page.locator('[data-nc-bonus-yes]').click();
          await page.locator('[data-nc-bar="r7"]').waitFor({ timeout: 8000 });
          assert((await page.locator('[data-nc-bonus], [data-nc-bonus-ask]').count()) === 0, 'the line goes');
          await page.locator('[data-nc]').screenshot({ path: path.join(SHOTS, 'B-added-390-dark.png') });
        }
        assert(!errors.length, errors.join('; '));
        await ctx.close();
      }
      await b.stage('zip89_am_ahead');
      const p = await b.playerPage('Vic', { width: 390 });
      assert((await p.page.locator('[data-nc-bonus], .nc-ahead').count()) === 0, 'never on a phone');
      await p.ctx.close();
    });

    await check('C Locked doubles: Add semifinals? Yes: SEMIS before FINAL', async () => {
      await b.stage('zip89_ld_semis');
      const { page, ctx, errors } = await b.adminHome({ width: 390 });
      await page.locator('[data-nc-bonus-add]').click();
      assert(flat(await page.locator('[data-nc-bonus-ask] .nc-ahead-q').textContent()) === 'Add semifinals? Are you sure?', 'the question');
      await page.locator('[data-nc-bonus-yes]').click();
      await page.locator('[data-nc-bar="semi"]').waitFor({ timeout: 8000 });
      const bars = await page.locator('[data-nc-bar]').evaluateAll((xs) => xs.map((x) => x.textContent.trim()));
      assert(bars.join(' ') === 'RD1 RD2 RD3 SEMIS FINAL', `bars ${bars.join(' ')}`);
      await page.locator('[data-nc]').screenshot({ path: path.join(SHOTS, 'C-semis-390.png') });
      assert(!errors.length, errors.join('; '));
      await ctx.close();
    });

    await check('D best of 3 in play (320/390, light and dark), and the finalist’s phone', async () => {
      await b.stage('zip89_bo3');
      for (const width of [320, 390])
        for (const scheme of ['light', 'dark']) {
          const { page, ctx, errors } = await b.adminHome({ width, scheme });
          await page.locator('[data-nc]').waitFor({ timeout: 15000 });
          const pills = await page.locator('[data-nc-pill]').evaluateAll((xs) => xs.map((x) => x.textContent.trim()));
          assert(pills.includes('Final · G2') && pills.includes('3rd place'), `pills ${pills}`);
          assert(flat(await page.locator('[data-nc-series]').textContent()) === 'Best of 3 · G1 11–8 · G2 –', 'the series line');
          await b.noWider(page, `bo3 ${width} ${scheme}`);
          const bad = await cutOrBroken(page, '[data-nc]');
          assert(!bad.length, `${width} ${scheme}: ${bad.join(', ')}`);
          await page.locator('[data-nc]').screenshot({ path: path.join(SHOTS, `D-bo3-${width}-${scheme}.png`) });
          assert(!errors.length, errors.join('; '));
          await ctx.close();
        }
      const p = await b.playerPage('Vic', { width: 390 });
      const text = flat(await p.page.locator('body').textContent());
      assert(text.includes('Final · Game 2'), 'the phone lists Final · Game 2');
      await p.page.screenshot({ path: path.join(SHOTS, 'D-vic-390.png') });
      await p.ctx.close();
    });
  } finally {
    console.log(`\nzip89: ${passed} passed, ${failed} failed`);
    await b.close();
    process.exit(failed ? 1 : 0);
  }
})();
