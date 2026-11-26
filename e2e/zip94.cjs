/* Zip 94 (🎾94.early bird): browser checks on a LOCAL copy (the preview's world, fixed clock).
 *
 *   node e2e/zip94.cjs                  (ZIP94_ONLY=A,B runs some)
 *
 *   A   Days before (zip94_three, View as Vic): "Lock in · $20 $18" with the $20 struck through, "Save $2 for 3 more days" gray under the
 *       buttons; never cut, never broken mid-word: 320/375/390/420/440, text 100/125/150%, light and dark. Nothing wider than the screen.
 *   B   Last day (zip94_last): the line is gold, "Save $2 for 9 more hours" (every width and text size).
 *   C   After (zip94_over): "Lock in · $20" and "Pay by <day> 7 PM"; Parker (locked in early) sees no new line.
 *   D   Tap Lock in (zip94_three, Vic): the Pay sheet asks $18.
 *   E   The gear sheet (zip94_three): Early price $18 and Early price until, fixed (players locked in), right under Ticket price.
 *   F   Money + Prizes (zip94_mixed): the Prizes sheet's "Tickets $170 − courts" (5 × $18 + 4 × $20).
 * Screenshots: .data/zip94-shots (not in git).
 */
const path = require('node:path');
const { mkdirSync } = require('node:fs');
const { boot, flat, assert, ROOT } = require('./zip74-boot.cjs');

const SHOTS = path.join(ROOT, '.data', 'zip94-shots');
const ONLY = process.env.ZIP94_ONLY || '';
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

(async () => {
  mkdirSync(SHOTS, { recursive: true });
  const port = Number(process.env.E2E_PORT) || 5494;
  const b = await boot({ name: 'zip94', port });
  const SEL = '.tc-bar .tc-btn, .tc-bar .tc-state, .tc-bar-row > *, .tc-early-foot';
  /** Every width, text size and theme: open, scan, check nothing is wider than the screen. */
  const sweep = async (label, open, extra) => {
    const bad = [];
    for (const scheme of ['light', 'dark'])
      for (const width of WIDTHS)
        for (const pct of SIZES) {
          const p = await open(width, scheme);
          if (pct !== 100) await zoom(p.page, pct);
          await p.page.waitForTimeout(300);
          const found = await scan(p.page, SEL);
          const wide = await p.page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
          if (wide) found.push('wider than the screen');
          if (extra) found.push(...(await extra(p.page)));
          if (found.length) {
            bad.push(`${label} ${scheme} ${width} ${pct}%: ${found.join(' | ')}`);
            await p.page.screenshot({ path: path.join(SHOTS, `${label}-${scheme}-${width}-${pct}.png`), fullPage: true });
          }
          if (width === 375 && pct === 100) await p.page.locator('[data-tc]').first().screenshot({ path: path.join(SHOTS, `${label}-${scheme}-375.png`) }).catch(() => undefined);
          assert(!p.errors.length, p.errors.join('; '));
          await p.ctx.close();
        }
    assert(!bad.length, bad.join('\n        '));
  };
  const lockText = (page) => page.locator('.tc-bar-row .tc-lime').first().textContent().then(flat);
  try {
    await check('A days before: Lock in · $20 $18 (struck) and "Save $2 for 3 more days", never cut (every width, size, theme)', async () => {
      await b.stage('zip94_three');
      await sweep('three', (w, scheme) => b.playerPage('Vic', { width: w, scheme }), async (page) => {
        const out = [];
        const t = await lockText(page);
        if (t !== 'Lock in · $20 $18') out.push(`label "${t}"`);
        if (flat(await page.locator('[data-tc-was]').first().textContent()) !== '$20') out.push('no struck $20');
        const line = flat(await page.locator('[data-tc-early]').first().textContent());
        if (line !== 'Save $2 for 3 more days') out.push(`line "${line}"`);
        if ((await page.locator('[data-tc-early]').first().getAttribute('data-tc-early')) !== 'save') out.push('line not gray');
        const deco = await page.locator('[data-tc-was]').first().evaluate((el) => getComputedStyle(el).textDecorationLine);
        if (!/line-through/.test(deco)) out.push('the $20 is not struck through');
        return out;
      });
    });

    await check('B last day: gold "Save $2 for 9 more hours" (every width, size, theme)', async () => {
      await b.stage('zip94_last');
      await sweep('last', (w, scheme) => b.playerPage('Vic', { width: w, scheme }), async (page) => {
        const out = [];
        const line = flat(await page.locator('[data-tc-early]').first().textContent());
        if (!/^Save \$2 for (9|8) more hours$/.test(line)) out.push(`line "${line}"`);
        if ((await page.locator('[data-tc-early]').first().getAttribute('data-tc-early')) !== 'last') out.push('not gold');
        return out;
      });
    });

    await check('C after: Lock in · $20 and "Pay by <day> 7 PM"; Parker locked in early sees nothing new', async () => {
      await b.stage('zip94_over');
      await sweep('over', (w, scheme) => b.playerPage('Vic', { width: w, scheme }), async (page) => {
        const out = [];
        const t = await lockText(page);
        if (t !== 'Lock in · $20') out.push(`label "${t}"`);
        const line = flat(await page.locator('[data-tc-early]').first().textContent());
        if (!/^Pay by [A-Z][a-z]{2} 7 PM$/.test(line)) out.push(`line "${line}"`);
        return out;
      });
      const { page, ctx } = await b.playerPage('Parker', { width: 375 });
      assert((await page.locator('[data-tc-early]').count()) === 0, 'Parker sees a new line');
      assert((await page.locator('[data-tc-was]').count()) === 0, 'Parker sees a strike');
      await ctx.close();
    });

    await check('D tap Lock in (days before): the Pay sheet asks $18', async () => {
      await b.stage('zip94_three');
      const { page, ctx } = await b.playerPage('Vic', { width: 375 });
      await page.locator('[data-tc-lock]').first().click();
      await page.waitForTimeout(1200);
      const body = flat(await page.locator('body').textContent());
      assert(/\$18/.test(body) && !/Pay Alex \$20|\$20 due/.test(body), 'the sheet asks $18');
      await page.screenshot({ path: path.join(SHOTS, 'D-pay-sheet.png') });
      await ctx.close();
    });

    await check('E the gear sheet: Early price $18 and its end, fixed, under Ticket price', async () => {
      await b.stage('zip94_three');
      for (const scheme of ['light', 'dark']) {
        const { page, ctx, errors } = await b.adminHome({ width: 375, scheme });
        // The card starts folded: one tap opens it, then its gear.
        if (!(await page.locator('[data-tm86-change]').count())) await page.getByText('The Cold Open', { exact: true }).first().click();
        await page.locator('[data-tm86-change]').first().click();
        await page.locator('[data-tm94-early]').waitFor({ timeout: 15000 });
        const order = await page.evaluate(() => [...document.querySelectorAll('[data-tm87-ticket], [data-tm94-early], [data-tm94-early-until]')].map((x) => Object.keys(x.dataset)[0]));
        assert(order.join() === 'tm87Ticket,tm94Early,tm94EarlyUntil', `order ${order}`);
        assert(flat(await page.locator('[data-tm94-early-fixed]').textContent()) === '$18', 'Early price $18');
        await page.locator('[data-tm94-early]').scrollIntoViewIfNeeded();
        await page.screenshot({ path: path.join(SHOTS, `E-gear-${scheme}.png`) });
        assert(!errors.length, errors.join('; '));
        await ctx.close();
      }
    });

    await check('G the gear sheet, nobody locked in yet: type $14 under the $16 ticket, pick the day and time, Save', async () => {
      await b.stage('date_picked');
      await b.call('PUT', '/api/admin/early-bird-switch', { on: true });
      const before = (await b.call('GET', '/api/admin/dashboard')).tournament;
      assert(before.early && before.early.cents === null && !before.early.locked, `early ${JSON.stringify(before.early)}`);
      const { page, ctx, errors } = await b.adminHome({ width: 375 });
      if (!(await page.locator('[data-tm86-change]').count())) await page.getByText(before.name, { exact: true }).first().click();
      await page.locator('[data-tm86-change]').first().click();
      await page.locator('#tm94-early').fill('14');
      await page.locator('[data-tm94-early-day]').waitFor({ timeout: 5000 });
      const days = await page.locator('[data-tm94-early-day] option').evaluateAll((os) => os.map((o) => o.value).filter(Boolean));
      await page.locator('[data-tm94-early-day]').selectOption(days[1] ?? days[0]);
      await page.locator('[data-tm94-early-time]').selectOption(String(19 * 60));
      await page.locator('[data-tm94-early-until]').scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(SHOTS, 'G-gear-edit.png') });
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      await page.waitForTimeout(1500);
      const after = (await b.call('GET', '/api/admin/dashboard')).tournament;
      assert(after.early.cents === 1400 && !!after.early.until, `saved ${JSON.stringify(after.early)}`);
      assert(!errors.length, errors.join('; '));
      await ctx.close();
      await b.call('PUT', '/api/admin/early-bird-switch', { on: false });
    });

    await check('F Money + Prizes with mixed prices: Tickets $170 (5 × $18 + 4 × $20)', async () => {
      await b.stage('zip94_mixed');
      const { page, ctx } = await b.adminHome({ width: 390 });
      const t = (await b.call('GET', '/api/admin/dashboard')).tournament;
      assert(t.money.ticketsCents === 17000, `tickets ${t.money.ticketsCents}`);
      assert(t.cost.paidNowCents === 13000, `paid now ${t.cost.paidNowCents}`);
      const prizes = page.locator('[data-tm86-prizes]').first();
      if (await prizes.count()) {
        await prizes.click();
        await page.waitForTimeout(900);
        const body = flat(await page.locator('body').textContent());
        assert(/Tickets \$170/.test(body), 'the Prizes sheet says Tickets $170');
        await page.screenshot({ path: path.join(SHOTS, 'F-prizes.png') });
      }
      await ctx.close();
    });
  } finally {
    await b.close();
    console.log(`\nzip94: ${passed} passed, ${failed} failed`);
    process.exit(failed ? 1 : 0);
  }
})();
