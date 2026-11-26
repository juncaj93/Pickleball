/* Zip 95 (🎾95.level check): browser checks on a LOCAL copy (the preview's calm world, fixed clock).
 *
 *   node e2e/zip95.cjs                  (ZIP95_ONLY=A,B runs some)
 *
 *   A   zip95_check, organizer Home: the Level check card is the FIRST thing on Home ("LEVEL CHECK · THE COLD OPEN", "Suggest a higher level
 *       next time?"), Vic "3.0 · won all 5 games" and Wren "3.2 · won 4 of 5, champion" (nobody else); one green button per row; every tap
 *       area 44 px; light and dark. Yes on Vic: 3.2 3.4 3.5 3.6+ with 3.2 picked, and Save; pick 3.4, Save: his row goes. No on Wren: the card
 *       goes. A reload: still gone.
 *   B   The card at 320/375/390/420/440, text 100/125/150%, light and dark, both looks (No/Yes and the levels): nothing cut, nothing past its
 *       box, no word broken, the page never wider than the phone.
 *   C   zip95_signup, View as Vic, Sign up: 3.0 picked (PREVIOUS RATING); 3.2 has RECOMMENDED and "Based on recent performance", not picked;
 *       tap 3.2: the old row grays, the tag stays; Next plays the level up (to 3.2). Zoe (not asked about): no tag. The tag and level rows never
 *       cut at 320/375/390/420/440, 100/125/150%, light and dark.
 * Screenshots: .data/zip95-shots (not in git).
 */
const path = require('node:path');
const { mkdirSync } = require('node:fs');
const { boot, flat, assert } = require('./zip74-boot.cjs');

const ROOT = path.resolve(__dirname, '..');
const SHOTS = path.join(ROOT, '.data', 'zip95-shots');
const ONLY = process.env.ZIP95_ONLY || '';
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

/** Cut (hidden overflow without "…"), text past its own box, a word broken mid-word. */
const scan = (page, sel) =>
  page.evaluate((s) => {
    const out = [];
    for (const el of document.querySelectorAll(s)) {
      if (!el.getClientRects().length) continue;
      const cs = getComputedStyle(el);
      if (el.scrollWidth > el.clientWidth + 1 && cs.textOverflow !== 'ellipsis' && cs.overflowX !== 'visible') out.push(`cut: "${el.textContent.trim().slice(0, 30)}"`);
      const r = el.getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(el);
      const tr = range.getBoundingClientRect();
      if (tr.width && (tr.right > r.right + 1 || tr.left < r.left - 1)) out.push(`past its box: "${el.textContent.trim().slice(0, 30)}"`);
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

/** In the page: every visible button or choice in `sel` smaller than 44 x 44. */
const small = (page, sel) =>
  page.evaluate((s) =>
    [...document.querySelectorAll(s)]
      .filter((el) => el.getClientRects().length)
      .map((el) => [el.textContent.trim(), el.getBoundingClientRect()])
      .filter(([, r]) => r.height < 43.5 || r.width < 43.5)
      .map(([t, r]) => `${t} ${Math.round(r.width)}x${Math.round(r.height)}`),
  sel);

/** Filled green buttons per row (the site's own green, as the design check counts them). */
const greensPerRow = (page) =>
  page.evaluate(() => {
    const probe = document.createElement('button');
    probe.className = 'btn';
    document.body.append(probe);
    const green = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return [...document.querySelectorAll('.lc-row')].map((row) => [...row.querySelectorAll('button, a')].filter((b) => b.getClientRects().length && getComputedStyle(b).backgroundColor === green).length);
  });

(async () => {
  mkdirSync(SHOTS, { recursive: true });
  const port = Number(process.env.E2E_PORT) || 5495;
  const b = await boot({ name: 'zip95', port });
  const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
  const home = async (opts) => {
    const p = await b.adminHome(opts);
    await p.page.locator('[data-level-check]').waitFor({ timeout: 20000 });
    return p;
  };
  const phone = async (who, { width = 390, scheme = 'light' } = {}) => {
    const p = await b.newPage({ width, scheme, reducedMotion: 'no-preference' });
    await p.page.goto(`${b.BASE}/?as=${encodeURIComponent(who)}`);
    await p.page.locator('.schedule, [data-tc-day]').first().waitFor({ timeout: 30000 });
    await p.page.waitForTimeout(600);
    return p;
  };
  const openSignup = async (p) => {
    await p.page.locator('[data-tc-signup]').first().click();
    await p.page.locator('[data-tm-step="1"]').waitFor({ timeout: 5000 });
    await p.page.waitForTimeout(450);
  };
  try {
    await check('A the Level check card: first on Home, Vic and Wren only, Yes > pick > Save, No, gone after a reload', async () => {
      await b.stage('zip95_check');
      for (const scheme of ['light', 'dark']) {
        const { page, ctx, errors } = await home({ width: 390, scheme });
        // The very first card in the Home tab.
        const first = await page.evaluate(() => {
          const card = document.querySelector('[data-level-check]');
          const all = [...document.querySelectorAll('main section, main article, main .card')].filter((x) => x.getClientRects().length && !x.closest('[data-level-check]') && !x.closest('header'));
          return all.every((x) => card.compareDocumentPosition(x) & Node.DOCUMENT_POSITION_FOLLOWING);
        });
        assert(first, 'the card is not first on Home');
        assert(/^level check · the cold open$/i.test(flat(await page.locator('.lc-kicker').innerText())), 'the kicker');
        assert(flat(await page.locator('.lc-title').innerText()) === 'Suggest a higher level next time?', 'the title');
        const rows = await page.locator('.lc-row').evaluateAll((els) => els.map((e) => [e.querySelector('.lc-name').textContent.trim(), e.querySelector('.lc-line').textContent.trim()]));
        assert(JSON.stringify(rows) === JSON.stringify([['Vic', '3.0 · won all 5 games'], ['Wren', '3.2 · won 4 of 5, champion']]), `rows: ${JSON.stringify(rows)}`);
        assert(JSON.stringify(await greensPerRow(page)) === '[1,1]', `green buttons per row: ${JSON.stringify(await greensPerRow(page))}`);
        const tiny = await small(page, '.lc-row button, .lc-level');
        assert(!tiny.length, `under 44 px: ${tiny.join(', ')}`);
        await shot(page, `A-card-${scheme}`);
        await page.locator('[data-level-check-row="Vic"] [data-lc-yes]').click();
        const levels = await page.locator('[data-level-check-row="Vic"] .lc-level').evaluateAll((els) => els.map((e) => [e.textContent.trim(), e.querySelector('input').checked]));
        assert(JSON.stringify(levels) === JSON.stringify([['3.2', true], ['3.4', false], ['3.5', false], ['3.6+', false]]), `levels: ${JSON.stringify(levels)}`);
        assert(JSON.stringify(await greensPerRow(page)) === '[1,1]', 'Save is the picking row’s one green button');
        const tiny2 = await small(page, '.lc-row button, .lc-level');
        assert(!tiny2.length, `under 44 px: ${tiny2.join(', ')}`);
        await shot(page, `A-yes-${scheme}`);
        assert(!errors.length, errors.join('; '));
        await ctx.close();
      }
      // The taps (light): pick 3.4, Save; No on Wren; a reload.
      const { page, ctx, errors } = await home({ width: 390 });
      await page.locator('[data-level-check-row="Vic"] [data-lc-yes]').click();
      await page.locator('[data-level-check-row="Vic"] [data-lc-level="340"]').click();
      assert(await page.locator('[data-level-check-row="Vic"] [data-lc-level="340"] input').isChecked(), '3.4 is not picked');
      await page.locator('[data-level-check-row="Vic"] [data-lc-save]').click();
      await page.locator('[data-level-check-row="Vic"]').waitFor({ state: 'detached', timeout: 5000 });
      await page.locator('[data-level-check-row="Wren"] [data-lc-no]').click();
      await page.locator('[data-level-check]').waitFor({ state: 'detached', timeout: 5000 });
      await page.waitForTimeout(1500);
      await page.reload();
      await page.locator('.tab-bar, nav').first().waitFor({ timeout: 30000 });
      await page.waitForTimeout(1500);
      assert((await page.locator('[data-level-check]').count()) === 0, 'the card came back after a reload');
      assert(!errors.length, errors.join('; '));
      await ctx.close();
      const dash = await b.call('GET', '/api/admin/dashboard');
      assert(dash.levelCheck === undefined, 'the server still sends the card');
    });

    await check('B the card never cut: 320/375/390/420/440, 100/125/150%, light and dark, No/Yes and the levels', async () => {
      await b.stage('zip95_check');
      const bad = [];
      for (const scheme of ['light', 'dark'])
        for (const width of WIDTHS)
          for (const pct of SIZES) {
            const { page, ctx, errors } = await home({ width, scheme });
            if (pct !== 100) await zoom(page, pct);
            await page.waitForTimeout(300);
            for (const look of ['answer', 'levels']) {
              if (look === 'levels') await page.locator('[data-level-check-row="Vic"] [data-lc-yes]').click();
              await page.waitForTimeout(150);
              const found = await scan(page, '.lc-kicker, .lc-title, .lc-name, .lc-line, .lc-level, .lc-row .btn');
              const wide = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
              const tiny = await small(page, '.lc-row button, .lc-level');
              if (found.length || wide || tiny.length) {
                bad.push(`${scheme} ${width} ${pct}% ${look}: ${[...found, ...(wide ? ['the page is wider than the phone'] : []), ...tiny.map((t) => `small ${t}`)].join(' | ')}`);
                await page.screenshot({ path: path.join(SHOTS, `B-${scheme}-${width}-${pct}-${look}.png`), fullPage: true });
              }
              if (width === 320 && pct === 150) await shot(page, `B-${scheme}-320-150-${look}`);
            }
            assert(!errors.length, errors.join('; '));
            await ctx.close();
          }
      assert(!bad.length, bad.join('\n        '));
    });

    await check('C the next sign-up: 3.0 picked (Previous rating), 3.2 Recommended; tap 3.2: the level up; Zoe: no tag; never cut', async () => {
      await b.stage('zip95_signup');
      for (const scheme of ['light', 'dark']) {
        const p = await phone('Vic', { scheme });
        await openSignup(p);
        const prev = p.page.locator('[data-tm-previous]');
        assert((await prev.getAttribute('data-level')) === '300' && (await prev.getAttribute('aria-checked')) === 'true', '3.0 is not the picked previous row');
        const rec = p.page.locator('[data-tm-recommended]');
        assert((await rec.count()) === 1, 'one recommended row');
        assert((await rec.getAttribute('data-level')) === '320', 'the recommended row is not 3.2');
        assert((await rec.getAttribute('aria-checked')) === 'false', '3.2 picked by itself');
        assert(/^recommended$/i.test(flat(await rec.locator('.tm-level-rectag').innerText())), 'the tag');
        assert(flat(await rec.locator('.tm-level-recwhy').innerText()) === 'Based on recent performance', 'the line under the tag');
        const order = await rec.evaluate((el) => [...el.querySelector('.tm-level-recwrap').childNodes].map((n) => (n.nodeType === 1 ? n.className : 'text')));
        assert(JSON.stringify(order) === JSON.stringify(['tm-level-rectag', 'tm-level-recwhy', 'text']), `order: ${JSON.stringify(order)}`);
        await shot(p.page, `C-open-${scheme}`);
        await rec.click();
        assert((await rec.getAttribute('aria-checked')) === 'true', '3.2 is not picked');
        assert(/tm-level-prev-off/.test(await prev.getAttribute('class')), 'the old row is not gray');
        assert((await rec.locator('.tm-level-rectag').count()) === 1, 'the tag went');
        await shot(p.page, `C-picked-${scheme}`);
        await p.page.locator('[data-tm-next]').click();
        await p.page.locator('[data-tm-levelup]').waitFor({ timeout: 2000 });
        assert((await p.page.locator('[data-tm-levelup]').getAttribute('data-to')) === '320', 'the level up does not go to 3.2');
        assert(!p.errors.length, p.errors.join('; '));
        await p.ctx.close();
      }
      const zoe = await phone('Zoe');
      await openSignup(zoe);
      assert((await zoe.page.locator('[data-tm-recommended]').count()) === 0, 'Zoe has a recommended row');
      assert((await zoe.page.locator('[data-tm-previous]').getAttribute('data-level')) === '275', 'Zoe’s previous rating');
      await zoe.ctx.close();
      const bad = [];
      for (const scheme of ['light', 'dark'])
        for (const width of WIDTHS)
          for (const pct of SIZES) {
            const p = await phone('Vic', { width, scheme });
            if (pct !== 100) await zoom(p.page, pct);
            await openSignup(p);
            const found = await scan(p.page, '.tm-level-rectag, .tm-level-recwhy, .tm-level-prevtag, .tm-level-num, .tm-level-text');
            const wide = await p.page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
            if (found.length || wide) {
              bad.push(`${scheme} ${width} ${pct}%: ${[...found, ...(wide ? ['the page is wider than the phone'] : [])].join(' | ')}`);
              await p.page.screenshot({ path: path.join(SHOTS, `C-${scheme}-${width}-${pct}.png`) });
            }
            if (width === 320 && pct === 150) await shot(p.page, `C-${scheme}-320-150`);
            await p.ctx.close();
          }
      assert(!bad.length, bad.join('\n        '));
    });
  } finally {
    await b.close();
    console.log(`\nzip95: ${passed} passed, ${failed} failed`);
    process.exit(failed ? 1 : 0);
  }
})();
