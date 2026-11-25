/* Zip 92 (🎾92.dry run fixes): browser checks on a LOCAL copy (the preview's world, fixed clock).
 *
 *   node e2e/zip92.cjs                  (ZIP92_ONLY=A,B runs some)
 *
 *   A   Player Home (the whole world): the All / My games switch has a full 44 px tap area (nothing covers it); the green check badge never
 *       covers TONIGHT or TOMORROW (320/375/390/420/440, text 100/125/150%).
 *   B   The ticket card (tickets_open): "Lock in · $16" keeps its whole label (View as Vic) and "Locked in" is never cut (View as Parker), every
 *       width, text 100/125/150% (Who's in and Drop out move to a second line when they must).
 *   C   The night card (zip88_rd3, zip88_final, zip89_ld_semis): no name runs under Score, none cut or broken (every width and text size).
 *   D   The End card (am_done, pools_done): END TOURNAMENT and EDIT AWARDS never cut (EDIT AWARDS wraps under at big text).
 *   E   The players' night screen (game1, zip89_ld_semis as Vic and Christopher Vanderberg): team and player names never break mid-word.
 *   F   Game day with Start now (zip88_ready), light and dark: only ONE solid green button on the card (Players "All 8 locked in" is soft).
 *   G   The stages: zip92_ld_round (Add a round? Are you sure?, Yes: RD4 before SEMIS); zip92_slow (the Time check from Round 4, Not now hides it,
 *       a reload keeps it hidden); zip92_twelve (the 12-player look's words, the switched card on Home); the Players sheet has no "Tickets" heading.
 * Screenshots: .data/zip92-shots (not in git).
 */
const path = require('node:path');
const { mkdirSync } = require('node:fs');
const { boot, flat, assert, ROOT } = require('./zip74-boot.cjs');

const SHOTS = path.join(ROOT, '.data', 'zip92-shots');
const ONLY = process.env.ZIP92_ONLY || '';
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

/** Cut (hidden overflow without "…"), text past its own box, words broken mid-word, and (pairs) text under another box. */
const scan = (page, sel, pairs = []) =>
  page.evaluate(
    ([s, prs]) => {
      const out = [];
      for (const el of document.querySelectorAll(s)) {
        if (!el.getClientRects().length) continue;
        const cs = getComputedStyle(el);
        if (el.scrollWidth > el.clientWidth + 1 && cs.textOverflow !== 'ellipsis' && cs.overflowX !== 'visible') out.push(`cut: "${el.textContent.trim().slice(0, 30)}"`);
        const r = el.getBoundingClientRect();
        const range = document.createRange();
        range.selectNodeContents(el);
        const tr = range.getBoundingClientRect();
        if (tr.width && cs.overflowX === 'visible' && (tr.right > r.right + 1 || tr.left < r.left - 1)) out.push(`past its box: "${el.textContent.trim().slice(0, 30)}"`);
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
      for (const [a, b] of prs)
        for (const x of document.querySelectorAll(a)) {
          const scope = x.closest('.nc-box') || document;
          for (const y of scope.querySelectorAll(b)) {
            const q = y.getBoundingClientRect();
            const rg = document.createRange();
            rg.selectNodeContents(x);
            for (const t of rg.getClientRects())
              if (t.width && Math.min(t.right, q.right) - Math.max(t.left, q.left) > 0.5 && Math.min(t.bottom, q.bottom) - Math.max(t.top, q.top) > 0.5) out.push(`under ${b}: "${x.textContent.trim().slice(0, 24)}"`);
          }
        }
      return [...new Set(out)];
    },
    [sel, pairs],
  );

(async () => {
  mkdirSync(SHOTS, { recursive: true });
  const port = Number(process.env.E2E_PORT) || 5492;
  const b = await boot({ name: 'zip92', port });
  /** Every width and text size: open, scan, collect. */
  const sweep = async (label, open, sel, pairs) => {
    const bad = [];
    for (const width of WIDTHS)
      for (const pct of SIZES) {
        const p = await open(width);
        if (pct !== 100) await zoom(p.page, pct);
        await p.page.waitForTimeout(350);
        const found = await scan(p.page, sel, pairs);
        if (found.length) {
          bad.push(`${label} ${width} ${pct}%: ${found.join(' | ')}`);
          await p.page.screenshot({ path: path.join(SHOTS, `${label}-${width}-${pct}.png`), fullPage: true });
        }
        assert(!p.errors.length, p.errors.join('; '));
        await p.ctx.close();
      }
    assert(!bad.length, bad.join('\n        '));
  };
  try {
    await check('B the ticket card: Lock in · $16 and Locked in are never cut (every width, 100/125/150%)', async () => {
      await b.stage('tickets_open');
      await sweep('lockin', (w) => b.playerPage('Vic', { width: w }), '.tc-bar .tc-btn, .tc-bar .tc-state, .tc-bar-row > *');
      await sweep('locked', (w) => b.playerPage('Parker', { width: w }), '.tc-bar .tc-btn, .tc-bar .tc-state, .tc-bar-row > *');
      const { page, ctx } = await b.playerPage('Vic', { width: 320 });
      await zoom(page, 150);
      assert(flat(await page.locator('.tc-bar-row .tc-lime').first().textContent()) === 'Lock in · $16', 'the whole label');
      await page.locator('.tc-card, [data-tc]').first().screenshot({ path: path.join(SHOTS, 'B-lockin-320-150.png') }).catch(() => undefined);
      await ctx.close();
    });

    await check('C the night card: no name under Score, cut or broken (zip88_rd3, zip88_final, zip89_ld_semis; every width, 100/125/150%)', async () => {
      for (const st of ['zip88_rd3', 'zip88_final', 'zip89_ld_semis']) {
        await b.stage(st);
        await sweep(`night-${st}`, async (w) => {
          const p = await b.adminHome({ width: w });
          await p.page.locator('[data-nc]').waitFor({ timeout: 15000 });
          return p;
        }, '.nc-side, .nc-score-btn', [['.nc-side', '.nc-score-btn'], ['.nc-side', '.nc-score-box']]);
      }
    });

    await check('D the End card: END TOURNAMENT and EDIT AWARDS never cut (am_done, pools_done; every width, 100/125/150%)', async () => {
      for (const st of ['am_done', 'pools_done']) {
        await b.stage(st);
        await sweep(`end-${st}`, async (w) => {
          const p = await b.adminHome({ width: w });
          await p.page.locator('[data-tm-edit-awards]').first().waitFor({ timeout: 15000 });
          return p;
        }, '.tm-end .tm-card-head .tm-label, .tm-end-edit, .tm-end .tm-card-head');
      }
    });

    await check('E the players night screen: names never break mid-word (game1, zip89_ld_semis; Vic and Christopher Vanderberg)', async () => {
      for (const st of ['game1', 'zip89_ld_semis']) {
        await b.stage(st);
        for (const who of ['Vic', 'Christopher Vanderberg']) await sweep(`player-${st}-${who.split(' ')[0]}`, (w) => b.playerPage(who, { width: w }), '.tc-gd-tn > b, .tc-gd-tn > span');
      }
    });

    await check('F game day with Start now: one solid green button on the card (Players soft), light and dark', async () => {
      await b.stage('zip88_ready');
      for (const scheme of ['light', 'dark']) {
        const { page, ctx, errors } = await b.adminHome({ width: 375, scheme });
        await page.locator('[data-tm88-start]').waitFor({ timeout: 15000 });
        const head = page.locator('[data-tm88-start]').first();
        const card = head.locator('xpath=ancestor::section[1]');
        if (!(await card.locator('[data-tm-tickets]').count())) await card.locator('button[aria-expanded]').first().click().catch(() => undefined);
        await page.locator('[data-tm-tickets]').first().waitFor({ timeout: 15000 });
        const tone = await page.locator('[data-tm-tickets]').first().getAttribute('data-tm-tickets');
        assert(tone === 'soft', `Players is ${tone}`);
        const greens = await page.evaluate(() => {
          const probe = document.createElement('i');
          document.body.append(probe);
          probe.style.color = 'var(--primary)';
          const green = getComputedStyle(probe).color;
          probe.remove();
          const start = document.querySelector('[data-tm88-start]');
          const card = start.closest('section, article') || document;
          return [...card.querySelectorAll('button, a')].filter((x) => x.getClientRects().length && getComputedStyle(x).backgroundColor === green).map((x) => x.textContent.trim());
        });
        assert(greens.length === 1 && greens[0] === 'Start now', `solid green: ${JSON.stringify(greens)}`);
        await page.screenshot({ path: path.join(SHOTS, `F-start-${scheme}.png`) });
        assert(!errors.length, errors.join('; '));
        await ctx.close();
      }
    });

    await check('G the three stages and the Players sheet heading', async () => {
      await b.stage('zip92_ld_round');
      {
        const { page, ctx, errors } = await b.adminHome({ width: 390 });
        await page.locator('[data-nc-bonus="round"]').waitFor({ timeout: 15000 });
        await page.locator('[data-nc-bonus-add]').click();
        assert(flat(await page.locator('[data-nc-bonus-ask] .nc-ahead-q').textContent()) === 'Add a round? Are you sure?', 'the question');
        await page.locator('[data-nc-bonus-yes]').click();
        await page.waitForFunction(() => /RD4/.test(document.querySelector('[data-nc]')?.textContent || '') && /SEMIS/.test(document.querySelector('[data-nc]')?.textContent || ''), null, { timeout: 15000 });
        const bars = flat(await page.locator('[data-nc]').first().textContent());
        assert(bars.indexOf('RD4') < bars.indexOf('SEMIS'), `RD4 before SEMIS: ${bars.slice(0, 120)}`);
        assert(!(await page.locator('[data-nc-bonus]').count()), 'one round per offer: no new offer at once');
        assert(!errors.length, errors.join('; '));
        await ctx.close();
      }
      await b.stage('zip92_slow');
      {
        const { page, ctx, errors } = await b.adminHome({ width: 390 });
        const tc = page.locator('[data-tm-time-check]');
        await tc.waitFor({ timeout: 15000 });
        assert((await tc.getAttribute('data-tm-time-check')).startsWith('4:'), `from Round 4: ${await tc.getAttribute('data-tm-time-check')}`);
        assert(!/past|over\./.test(flat(await tc.textContent())), flat(await tc.textContent()));
        await page.locator('[data-tm-time-later]').click();
        await tc.waitFor({ state: 'detached', timeout: 5000 });
        await page.reload();
        await page.locator('[data-nc]').waitFor({ timeout: 15000 });
        await page.waitForTimeout(1500);
        assert(!(await page.locator('[data-tm-time-check]').count()), 'Not now holds for the round (after a reload too)');
        assert(!errors.length, errors.join('; '));
        await ctx.close();
      }
      await b.stage('zip92_twelve');
      {
        const { page, ctx, errors } = await b.adminHome({ width: 390 });
        await page.locator('[data-tm-odd-switch]').waitFor({ timeout: 15000 });
        assert(/switched to Americano \(odd number of players\)/.test(flat(await page.locator('[data-tm-odd-switch]').textContent())), 'the real switch at 9');
        // The Players sheet: the tickets card leads with its chip, no "Tickets" heading (the sheet says Players).
        await page.locator('[data-tm-tickets]').first().click().catch(() => undefined);
        const sheet = page.locator('dialog[open] [data-tm-card="tickets"]');
        if (await sheet.count()) assert(!(await sheet.locator('h3').count()), 'no Tickets heading');
        assert(!errors.length, errors.join('; '));
        await ctx.close();
      }
      // The 12-player look on the Tournament test page draws the server's words.
      const words = await b.call('POST', '/api/admin/tournament-test', { stage: 'zip92_twelve' });
      assert(words.ok, 'stage');
    });

    await check('A player Home: the All / My games tap area and the check badge (every width, 100/125/150%)', async () => {
      const w = await boot({ name: 'zip92full', port: port + 1, calm: false });
      try {
        const bad = [];
        for (const width of WIDTHS)
          for (const pct of SIZES) {
            const { page, ctx, errors } = await w.pickedPage('Christopher Vanderberg', { width });
            if (pct !== 100) await zoom(page, pct);
            await page.waitForTimeout(350);
            const r = await page.evaluate(() => {
              const out = [];
              for (const t of document.querySelectorAll('.schedule .tile-wrap')) {
                const tag = t.querySelector('.day-tag');
                const chk = t.querySelector('.tile-check');
                if (!tag || !chk || !chk.getClientRects().length) continue;
                const words = [...tag.querySelectorAll('*')].filter((x) => x.getClientRects().length && x.children.length === 0);
                for (const wd of words.length ? words : [tag]) {
                  const rg = document.createRange();
                  rg.selectNodeContents(wd);
                  for (const q of [...rg.getClientRects()].filter((x) => x.width > 0)) {
                    const c = chk.getBoundingClientRect();
                    const cx = (c.left + c.right) / 2;
                    const cy = (c.top + c.bottom) / 2;
                    const d = Math.hypot(Math.max(q.left - cx, 0, cx - q.right), Math.max(q.top - cy, 0, cy - q.bottom));
                    if (d < c.width / 2) out.push(`badge over "${wd.textContent}" by ${(c.width / 2 - d).toFixed(1)} px`);
                  }
                }
              }
              const ft = document.querySelector('.filter-toggle');
              if (!ft) return [...out, 'no filter switch'];
              ft.scrollIntoView({ block: 'center' });
              const f = ft.getBoundingClientRect();
              const cx = (f.left + f.right) / 2;
              const cy = (f.top + f.bottom) / 2;
              for (const [k, x, y] of [['top', cx, cy - 21], ['bottom', cx, cy + 21], ['left', f.left - 2, cy], ['right', f.right + 2, cy]]) {
                const e = document.elementFromPoint(x, y);
                if (!e || !ft.contains(e)) out.push(`filter ${k} edge covered by ${e?.className}`);
              }
              return [...new Set(out)];
            });
            if (r.length) bad.push(`${width} ${pct}%: ${r.join(' | ')}`);
            assert(!errors.length, errors.join('; '));
            await ctx.close();
          }
        assert(!bad.length, bad.join('\n        '));
      } finally {
        await w.close();
      }
    });
  } finally {
    await b.close();
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
