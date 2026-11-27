/* Zip 100 (🎾100.card row): the admin game card's bottom row (the paid pill, the court, directions) on Alex's iPhone Air with a two-digit court.
 *
 *   node e2e/zip100.cjs                  (ZIP100_ONLY=A,B runs some)
 *
 * The preview's calm world on a local server (zip86_home: the first card is booked, Court 4, "3 of 3 paid").
 *   A   Court 16 saved for real (the same call the court map makes), 420 px light and dark: the three buttons on ONE line under the names,
 *       44 px each; screenshots (.data/zip100-shots).
 *   B   Every mix: courts 1, 9, 16, 99 and "?", paid "0 of 0 paid" / "3 of 4 paid" / "All paid" / "10 of 12 paid", at 320 / 375 / 390 / 420 /
 *       440, light and dark, text 100 / 125 / 150 %:
 *       - 375 and up at 100 %: one line ("0 of 0 paid", "3 of 4 paid", "All paid"); at 420 and 440 under the names;
 *       - always: 44 px tall, nothing past the card, no word cut; the row is under the names, across the card, or (only when that is too
 *         wide) the paid pill alone with the court and directions together on the next line. Directions never sit alone.
 *   C   The Book button in place of the court (a game that still needs booking): the same rule.
 * The court and paid words in B are set in the page (the layout only; the server allows courts 1 to 16 and the card says "N of M paid").
 */
const path = require('node:path');
const { mkdirSync } = require('node:fs');
const { boot, flat, assert, ROOT } = require('./zip74-boot.cjs');

const SHOTS = path.join(ROOT, '.data', 'zip100-shots');
const ONLY = process.env.ZIP100_ONLY || '';
let passed = 0;
let failed = 0;
async function check(name, fn) {
  if (ONLY && !ONLY.split(',').some((x) => name.split(' ')[0] === x)) return;
  const t0 = Date.now();
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  } catch (err) {
    failed++;
    console.log(`  ✗ ${name}\n        ${String(err && err.stack ? err.stack : err).split('\n').slice(0, 5).join('\n        ')}`);
  }
}

/** Where the bottom row's buttons sit on the card with `idx`: 'under' (one line under the names), 'full' (one line across the card),
 *  'split' (paid alone, the pair under it), or a problem. Optional words are set in the page first. */
function rowFacts(page, idx, court, paid) {
  return page.evaluate(
    ([idx, court, paid]) => {
      const card = document.querySelectorAll('.scard86')[idx];
      const foot = card.querySelector('.r86-foot');
      const c = card.querySelector('.r86-court');
      if (court !== null && c) c.textContent = court;
      if (paid !== null) card.querySelector('.r86-paid-text').textContent = paid;
      const R = (e) => e.getBoundingClientRect();
      const p = R(card.querySelector('.r86-paid'));
      const second = card.querySelector('.r86-court') || card.querySelector('.r86-book');
      const s = R(second);
      const d = R(card.querySelector('.r86-dir'));
      const names = R(card.querySelector('.r2-mid'));
      const cb = R(card);
      const fb = R(foot);
      const heights = [p.height, second.classList.contains('r86-book') ? R(second.querySelector('.btn')).height : s.height, d.height].map(Math.round);
      const words = [...card.querySelectorAll('.r86-paid-text, .r86-court')].filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => e.textContent);
      const top = (r) => Math.round(r.top);
      let mode = 'bad';
      if (top(p) === top(s) && top(s) === top(d)) mode = Math.abs(p.left - names.left) <= 1 ? 'under' : Math.abs(p.left - fb.left) <= 1 ? 'full' : 'bad';
      else if (top(s) === top(d) && s.top >= p.bottom && Math.abs(p.left - fb.left) <= 1 && Math.abs(s.left - fb.left) <= 1) mode = 'split';
      const past = [p, s, d].some((r) => r.right > cb.right - 1 || r.left < cb.left + 1);
      return { mode, heights, past, words, dirAlone: top(d) !== top(s), text: [flat0(card.querySelector('.r86-paid')), second.textContent.trim()] };
      function flat0(e) {
        return e.textContent.replace(/\s+/g, ' ').trim();
      }
    },
    [idx, court, paid],
  );
}

(async () => {
  mkdirSync(SHOTS, { recursive: true });
  const b = await boot({ name: 'zip100', port: Number(process.env.E2E_PORT) || 5500 });
  try {
    await b.stage('zip86_home');
    let firstId = null;
    {
      const { page, ctx } = await b.adminHome({ width: 420 });
      firstId = (await page.locator('.scard86').first().getAttribute('id')).replace('session-', '');
      await ctx.close();
    }

    await check('A Court 16 for real at 420 (iPhone Air): one line under the names, light and dark', async () => {
      await b.call('PUT', `/api/admin/sessions/${firstId}/court-number`, { court: 16 });
      for (const scheme of ['light', 'dark']) {
        const { page, ctx, errors } = await b.adminHome({ width: 420, scheme });
        const f = await rowFacts(page, 0, null, null);
        assert(f.text[1] === 'Court 16', `court: ${f.text}`);
        assert(f.mode === 'under' && f.heights.every((h) => h === 44) && !f.past, `Court 16 at 420 ${scheme}: ${JSON.stringify(f)}`);
        await page.locator('.scard86').first().screenshot({ path: path.join(SHOTS, `A-420-${scheme}-court16.png`) });
        assert(errors.length === 0, errors.join('; '));
        await ctx.close();
      }
      await b.call('PUT', `/api/admin/sessions/${firstId}/court-number`, { court: 4 });
    });

    await check('B every court, paid words, width, text size, light and dark: one line where it must, the pair never split', async () => {
      const bad = [];
      let seen = { under: 0, full: 0, split: 0 };
      for (const scheme of ['light', 'dark']) {
        for (const width of [320, 375, 390, 420, 440]) {
          const { page, ctx, errors } = await b.adminHome({ width, scheme });
          for (const size of ['100%', '125%', '150%']) {
            await page.evaluate((s) => (document.documentElement.style.fontSize = s), size);
            for (const court of ['Court 1', 'Court 9', 'Court 16', 'Court 99', 'Court ?']) {
              for (const paid of ['0 of 0 paid', '3 of 4 paid', 'All paid', '10 of 12 paid']) {
                const f = await rowFacts(page, 0, court, paid);
                const at = `${scheme} ${width} ${size} ${court} "${paid}"`;
                seen[f.mode] = (seen[f.mode] || 0) + 1;
                if (f.mode === 'bad' || f.dirAlone) bad.push(`${at}: ${f.mode}${f.dirAlone ? ' (directions alone)' : ''}`);
                if (!f.heights.every((h) => h === 44)) bad.push(`${at}: heights ${f.heights}`);
                if (f.past) bad.push(`${at}: past the card`);
                if (f.words.length) bad.push(`${at}: cut ${f.words}`);
                const usual = paid !== '10 of 12 paid';
                if (size === '100%' && width >= 375 && usual && f.mode === 'split') bad.push(`${at}: not one line`);
                if (size === '100%' && width >= 420 && usual && f.mode !== 'under') bad.push(`${at}: not under the names (${f.mode})`);
              }
            }
          }
          await page.evaluate(() => (document.documentElement.style.fontSize = ''));
          const w = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
          if (w[0] > w[1]) bad.push(`${scheme} ${width}: page ${w[0]} wide`);
          if (errors.length) bad.push(`${scheme} ${width}: ${errors.join('; ')}`);
          if (width === 420 && scheme === 'light') {
            await rowFacts(page, 0, 'Court 99', '0 of 0 paid');
            await page.locator('.scard86').first().screenshot({ path: path.join(SHOTS, 'B-420-light-court99.png') });
          }
          if (width === 320 && scheme === 'dark') {
            await page.evaluate(() => (document.documentElement.style.fontSize = '150%'));
            await rowFacts(page, 0, 'Court 16', '10 of 12 paid');
            await page.locator('.scard86').first().screenshot({ path: path.join(SHOTS, 'B-320-dark-150-split.png') });
          }
          await ctx.close();
        }
      }
      assert(bad.length === 0, `${bad.length} problems:\n        ${bad.slice(0, 12).join('\n        ')}`);
      assert(seen.under > 0 && seen.full > 0 && seen.split > 0, `all three steps were seen: ${JSON.stringify(seen)}`);
    });

    await check('C the Book button in place of the court: the same rule', async () => {
      const bad = [];
      for (const width of [320, 390, 420]) {
        for (const size of ['100%', '150%']) {
          const { page, ctx } = await b.adminHome({ width });
          await page.evaluate((s) => (document.documentElement.style.fontSize = s), size);
          const n = await page.locator('.scard86').count();
          let found = false;
          for (let i = 0; i < n; i++) {
            if ((await page.locator('.scard86').nth(i).locator('.r86-book').count()) === 0) continue;
            found = true;
            const f = await rowFacts(page, i, null, '0 of 0 paid');
            if (f.mode === 'bad' || f.dirAlone || f.past) bad.push(`${width} ${size}: ${JSON.stringify(f)}`);
            if (size === '100%' && f.mode === 'split' && width >= 390) bad.push(`${width} ${size}: not one line`);
          }
          if (!found) bad.push(`${width}: no card with Book`);
          await ctx.close();
        }
      }
      assert(bad.length === 0, bad.join('\n        '));
    });
  } finally {
    await b.close();
  }
  console.log(`\nzip100: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
