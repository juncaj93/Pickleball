/* Zip 93 (🎾93.polish): browser checks on a LOCAL copy (the preview's calm world, fixed clock).
 *
 *   node e2e/zip93.cjs                  (ZIP93_ONLY=A,B runs some)
 *
 *   A   The organizer's court picker (the Home card's court button, and Add game's Court row): every court square has a tap area of at least
 *       44 x 44 px on screen (after the 3D tilt), a tap on each square's own edge picks that square, the tap areas never overlap, the X and
 *       Clear stay reachable, and the look is pixel for pixel the same with the tap areas hidden. 320/375/420/440, 100/125/150%, light and
 *       dark. The players' map (display only) gets no tap areas.
 *   B   The players' "scheduled" notice: two days out "The Cold Open is scheduled for ...", the day before "The Cold Open is tomorrow." (the
 *       same second line), on game day no notice. The two Zip 93 stages are the only ones listed on the Tournament test page.
 *   C   Edit awards: the Banner stays up buttons never overlap and are never cut (they wrap to a second line instead); 320/375/420/440,
 *       100/125/150%, light and dark.
 *   D   Standings: no name breaks mid-word (the End card's list, the players' Standings cards, the final board), every width and text size.
 *   E   "adjusted by organizer": the player's credit sheet lines never break mid-word (every width and text size).
 *   F   History > Skills: dates read "AUG" (month in caps), or "AUG 3" when one list has two in the same month.
 * Screenshots: .data/zip93-shots (not in git).
 */
const path = require('node:path');
const { mkdirSync } = require('node:fs');
const { boot, flat, assert, ROOT } = require('./zip74-boot.cjs');

const SHOTS = path.join(ROOT, '.data', 'zip93-shots');
const ONLY = process.env.ZIP93_ONLY || '';
const WIDTHS = [320, 375, 420, 440];
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

/** Words broken inside (a word's letters on two lines) and text cut without "…". */
const broken = (page, sel) =>
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

/** For each court of the open picker: its tap area through the face's centre (width, height), whether every face edge picks it, and overlaps. */
const measureMap = (page) =>
  page.evaluate(() => {
    const map = document.querySelector('dialog.cm[open][data-court-map="pick"]');
    const cells = [...map.querySelectorAll('button[data-court-cell]')];
    const owner = (x, y) => document.elementFromPoint(x, y)?.closest('[data-court-cell]') ?? null;
    const out = [];
    for (const c of cells) {
      const b = c.getBoundingClientRect();
      const cx = b.left + b.width / 2;
      const cy = b.top + b.height / 2;
      const hit = (x, y) => owner(x, y) === c;
      let up = 0;
      let dn = 0;
      let l = 0;
      let r = 0;
      while (up < 120 && hit(cx, cy - up - 0.5)) up += 0.5;
      while (dn < 120 && hit(cx, cy + dn + 0.5)) dn += 0.5;
      while (l < 120 && hit(cx - l - 0.5, cy)) l += 0.5;
      while (r < 120 && hit(cx + r + 0.5, cy)) r += 0.5;
      // The face's own edges (the trapezoid's middle of each side, 1 to 3 px in) must pick this square.
      const edges = [
        [cx, b.top + 1],
        [cx, b.bottom - 1],
        [b.left + 3, cy],
        [b.right - 3, cy],
      ].filter(([x, y]) => !hit(x, y));
      out.push({ n: c.dataset.courtCell, w: l + r, h: up + dn, edgeMiss: edges.length });
    }
    // No overlap: inside every face, the point under the finger belongs to that face's own court (checked on a 3 px grid).
    let stolen = 0;
    for (const c of cells) {
      const b = c.getBoundingClientRect();
      for (let x = b.left + 4; x < b.right - 4; x += 3)
        for (let y = b.top + 2; y < b.bottom - 2; y += 3) {
          const o = owner(x, y);
          if (o && o !== c) stolen++;
        }
    }
    const x = map.querySelector('.cm-x').getBoundingClientRect();
    const clear = map.querySelector('[data-court-clear]').getBoundingClientRect();
    const xOk = document.elementFromPoint(x.left + x.width / 2, x.top + x.height / 2)?.closest('.cm-x') !== null;
    const clearOk = document.elementFromPoint(clear.left + clear.width / 2, clear.top + clear.height / 2)?.closest('[data-court-clear]') !== null;
    return { cells: out, stolen, xOk, clearOk };
  });

/** The largest colour difference between two same-size screenshots (0 to 255). The tilted plane's edges can differ by 1 step between two
 *  draws (anti-aliasing of the 3D layer), which no eye sees; a visible change is far more. */
const pixelDiff = (page, a, b) =>
  page.evaluate(
    async ([x, y]) => {
      const load = async (b64) => {
        const img = new Image();
        img.src = `data:image/png;base64,${b64}`;
        await img.decode();
        const c = document.createElement('canvas');
        c.width = img.width;
        c.height = img.height;
        const g = c.getContext('2d');
        g.drawImage(img, 0, 0);
        return g.getImageData(0, 0, c.width, c.height).data;
      };
      const [p, q] = [await load(x), await load(y)];
      if (p.length !== q.length) return 255;
      let max = 0;
      for (let i = 0; i < p.length; i++) max = Math.max(max, Math.abs(p[i] - q[i]));
      return max;
    },
    [a.toString('base64'), b.toString('base64')],
  );

(async () => {
  mkdirSync(SHOTS, { recursive: true });
  const port = Number(process.env.E2E_PORT) || 5493;
  const b = await boot({ name: 'zip93', port });
  try {
    await check('A the court picker: every court 44 x 44 or more after the tilt, edges pick their own square, the look unchanged', async () => {
      await b.stage('zip86_home');
      const bad = [];
      const sizes = [];
      for (const scheme of ['light', 'dark'])
        for (const width of WIDTHS)
          for (const pct of SIZES) {
            const { page, ctx, errors } = await b.adminHome({ width, scheme });
            if (pct !== 100) await zoom(page, pct);
            await page.locator('.scard86 .r86-court').first().click();
            await page.locator('dialog.cm[open] [data-court-cell]').first().waitFor({ timeout: 8000 });
            await page.waitForTimeout(400);
            const m = await measureMap(page);
            for (const c of m.cells) {
              if (c.w < 44 || c.h < 44) bad.push(`${scheme} ${width} ${pct}%: court ${c.n} ${c.w} x ${c.h}`);
              if (c.edgeMiss) bad.push(`${scheme} ${width} ${pct}%: court ${c.n}: ${c.edgeMiss} face edge(s) pick something else`);
            }
            if (m.stolen) bad.push(`${scheme} ${width} ${pct}%: ${m.stolen} points inside a square pick a neighbour`);
            if (!m.xOk || !m.clearOk) bad.push(`${scheme} ${width} ${pct}%: X ${m.xOk} Clear ${m.clearOk}`);
            sizes.push(...m.cells.map((c) => [c.w, c.h]));
            // The look: the same pixels with the tap areas switched off (they are invisible).
            if (pct === 100) {
              const dlg = page.locator('dialog.cm[open]');
              await page.addStyleTag({ content: 'dialog.cm *, dialog.cm *::before { animation: none !important; transition: none !important; }' });
              await page.waitForTimeout(150);
              const before = await dlg.screenshot();
              const off = await page.addStyleTag({ content: '.cm-pick button.cm-cl::before { display: none !important; }' });
              await page.waitForTimeout(150);
              const after = await dlg.screenshot();
              const diff = before.equals(after) ? 0 : await pixelDiff(page, before, after);
              if (diff > 2) bad.push(`${scheme} ${width}: the map looks different with the tap areas (up to ${diff} colour steps)`);
              await off.evaluate((el) => el.remove());
              if (width === 375) await dlg.screenshot({ path: path.join(SHOTS, `A-map-${scheme}.png`) });
            }
            // A real tap at the very bottom edge of court 13 (the back row, where the rows sit closest) and the top edge of court 9.
            if (pct === 100 && width === 320 && scheme === 'light') {
              const at = await page.evaluate(() => {
                const r13 = document.querySelector('dialog.cm[open] [data-court-cell="13"]').getBoundingClientRect();
                return { x: r13.left + r13.width / 2, y: r13.bottom - 1 };
              });
              await page.mouse.click(at.x, at.y);
              await page.waitForTimeout(300);
              const now = flat(await page.locator('.scard86 .r86-court').first().textContent());
              if (now !== 'Court 13') bad.push(`a tap on 13's bottom edge gave "${now}"`);
              await page.locator('.toast button, [data-undo]').first().click().catch(() => undefined);
            }
            assert(!errors.length, errors.join('; '));
            await ctx.close();
          }
      // Add game's Court row opens the same picker (pick mode) with the same tap areas.
      {
        const { page, ctx } = await b.adminHome({ width: 375 });
        await page.getByRole('button', { name: '+ Add' }).first().click();
        const row = page.locator('.gd-court-row').first();
        await row.waitFor({ timeout: 8000 });
        await row.click();
        await page.locator('dialog.cm[open][data-court-map="pick"] [data-court-cell]').first().waitFor({ timeout: 8000 });
        await page.waitForTimeout(400);
        const m = await measureMap(page);
        for (const c of m.cells) if (c.w < 44 || c.h < 44 || c.edgeMiss) bad.push(`Add game: court ${c.n} ${c.w} x ${c.h} (${c.edgeMiss} edge misses)`);
        if (m.stolen) bad.push(`Add game: ${m.stolen} stolen points`);
        await ctx.close();
      }
      // The players' map (display only): no tap areas at all.
      {
        const { page, ctx } = await b.adminHome({ width: 375 });
        const content = await page.evaluate(() => {
          const d = document.createElement('dialog');
          d.className = 'cm';
          d.innerHTML = '<div class="cm-st"><div class="cm-pl"><div class="cm-rw"><div class="cm-pr"><div class="cm-cl" data-court-cell="1">1</div></div></div></div></div>';
          document.body.append(d);
          const v = getComputedStyle(d.querySelector('.cm-cl'), '::before').content;
          d.remove();
          return v;
        });
        if (content !== 'none' && content !== 'normal') bad.push(`the players' map has a tap area (${content})`);
        await ctx.close();
      }
      const minW = Math.min(...sizes.map((s) => s[0]));
      const minH = Math.min(...sizes.map((s) => s[1]));
      console.log(`        smallest tap area: ${minW} x ${minH} px`);
      assert(!bad.length, bad.slice(0, 12).join('\n        '));
    });

    await check('B the scheduled notice: two days out, the day before ("is tomorrow."), game day (none); the Tournament test list', async () => {
      const notice = async (stage) => {
        await b.stage(stage);
        const { page, ctx, errors } = await b.playerPage('Vic', { width: 375 });
        await page.waitForTimeout(500);
        const cards = await page.locator('[data-format-alert]').evaluateAll((els) => els.map((e) => e.textContent.replace(/\s+/g, ' ').trim()));
        await page.screenshot({ path: path.join(SHOTS, `B-${stage}.png`) });
        assert(!errors.length, errors.join('; '));
        await ctx.close();
        return cards;
      };
      const two = await notice('zip87_paid');
      assert(two.length === 1 && /The Cold Open is scheduled for \w{3} \w{3} \d+\./.test(two[0]), `two days out: ${JSON.stringify(two)}`);
      const sub = two[0].replace(/^.*?\.\s*/, '');
      const before = await notice('zip93_day_before');
      assert(before.length === 1 && before[0].startsWith('The Cold Open is tomorrow.'), `day before: ${JSON.stringify(before)}`);
      assert(before[0].includes(sub.slice(0, 20)), `the same second line: "${before[0]}" vs "${sub}"`);
      const day = await notice('zip93_game_day');
      assert(day.length === 0, `game day: ${JSON.stringify(day)}`);
      // The Tournament test page keeps both Zip 93 stages (a newer zip holds the top "this zip" spot since Zip 94).
      const res = require('node:fs').readFileSync(path.join(ROOT, 'src/pages/admin/TournamentTest.tsx'), 'utf8');
      assert(res.includes("'zip93_day_before'") && res.includes("'zip93_game_day'"), 'both Zip 93 stages still listed');
      assert(res.includes("label: '93: scheduled notice, day before'") && res.includes("label: '93: scheduled notice, game day'"), 'the two labels');
    });

    await check('C Edit awards: the Banner stays up buttons never overlap or cut (every width, 100/125/150%, light and dark)', async () => {
      const bad = [];
      for (const st of ['am_done', 'final_done']) {
        await b.stage(st);
        for (const scheme of ['light', 'dark'])
          for (const width of WIDTHS)
            for (const pct of SIZES) {
              const { page, ctx, errors } = await b.adminHome({ width, scheme });
              if (pct !== 100) await zoom(page, pct);
              await page.locator('.tm-end-edit').first().waitFor({ timeout: 20000 });
              await page.locator('.tm-end-edit').first().click();
              await page.locator('.tm-awards-week').first().waitFor({ timeout: 8000 });
              await page.waitForTimeout(350);
              const r = await page.locator('.tm-awards-week').evaluateAll((els) =>
                els.map((e) => {
                  const b = e.getBoundingClientRect();
                  return { t: e.textContent.trim(), l: b.left, r: b.right, top: b.top, bot: b.bottom, cut: e.scrollWidth > e.clientWidth + 1, h: b.height };
                }),
              );
              for (let i = 0; i < r.length; i++) {
                if (r[i].cut) bad.push(`${st} ${scheme} ${width} ${pct}%: "${r[i].t}" cut`);
                if (r[i].h < 44) bad.push(`${st} ${scheme} ${width} ${pct}%: "${r[i].t}" ${r[i].h} px tall`);
                for (let j = i + 1; j < r.length; j++) {
                  const a = r[i];
                  const c = r[j];
                  if (Math.min(a.r, c.r) - Math.max(a.l, c.l) > 0.5 && Math.min(a.bot, c.bot) - Math.max(a.top, c.top) > 0.5) bad.push(`${st} ${scheme} ${width} ${pct}%: "${a.t}" overlaps "${c.t}"`);
                }
              }
              const wb = await broken(page, '.tm-awards-week');
              if (wb.length) bad.push(`${st} ${scheme} ${width} ${pct}%: ${wb.join(' | ')}`);
              if (width === 320 && pct === 150) await page.locator('.tm-awards-banner').first().screenshot({ path: path.join(SHOTS, `C-${st}-${scheme}-320-150.png`) });
              assert(!errors.length, errors.join('; '));
              await ctx.close();
            }
      }
      assert(!bad.length, bad.slice(0, 12).join('\n        '));
    });

    await check('D standings names never break mid-word (End card, the players’ Standings cards, the final board)', async () => {
      const bad = [];
      const sweep = async (label, open, sel) => {
        for (const width of WIDTHS)
          for (const pct of SIZES) {
            const p = await open(width);
            if (pct !== 100) await zoom(p.page, pct);
            await p.page.waitForTimeout(350);
            const found = await broken(p.page, sel);
            if (found.length) {
              bad.push(`${label} ${width} ${pct}%: ${found.join(' | ')}`);
              await p.page.screenshot({ path: path.join(SHOTS, `D-${label}-${width}-${pct}.png`), fullPage: true });
            }
            assert(!p.errors.length, p.errors.join('; '));
            await p.ctx.close();
          }
      };
      for (const st of ['am_done', 'final_done']) {
        await b.stage(st);
        await sweep(`end-${st}`, async (w) => {
          const p = await b.adminHome({ width: w });
          await p.page.locator('.sl-row').first().waitFor({ state: 'attached', timeout: 20000 });
          return p;
        }, '.sl-name > b, .sl-players');
      }
      await b.stage('am_round3');
      await sweep('player-am', (w) => b.playerPage('Christopher Vanderberg', { width: w }), '.tc-gd-pname > b');
      await b.stage('game1');
      await sweep('player-ld', (w) => b.playerPage('Christopher Vanderberg', { width: w }), '.tc-gd-stand .tc-gd-tn > b, .tc-gd-stand .tc-gd-tn > span');
      await b.stage('zip79_night');
      await sweep('board', (w) => b.playerPage('Christopher Vanderberg', { width: w }), '.tc-rv-name');
      assert(!bad.length, bad.slice(0, 12).join('\n        '));
    });

    await check('E "adjusted by" never breaks mid-word (the credit sheet, every width, 100/125/150%)', async () => {
      await b.stage('none');
      await b.call('PUT', '/api/admin/adjust-credit-switch', { on: true });
      const d = await b.call('GET', '/api/admin/dashboard');
      const who = d.players.find((p) => p.name === 'Christopher Vanderberg');
      // The fake world gives him no credit after 'none', so the server's own check reads $0.
      await b.call('POST', `/api/admin/players/${who.id}/credit-adjust`, { direction: 'add', cents: 500, reason: 'Zip 93 check', seen: 0 });
      const bad = [];
      let seen = 0;
      for (const width of WIDTHS)
        for (const pct of SIZES) {
          const { page, ctx, errors } = await b.pickedPage('Christopher Vanderberg', { width });
          if (pct !== 100) await zoom(page, pct);
          await page.waitForTimeout(300);
          // The credit sheet (the credit chip): "Credit adjusted by Alex: +$5" and the list's "+$5 adjusted by organizer".
          await page.locator('[data-credit-chip]').first().click();
          await page.locator('[data-credit-history]').first().waitFor({ timeout: 8000 });
          await page.waitForTimeout(300);
          seen += await page.locator('[data-adjust-note], [data-credit-history] li').filter({ hasText: /adjusted/i }).count();
          if (width === 375 && pct === 100) await page.screenshot({ path: path.join(SHOTS, 'E-sheet-375.png') });
          const found = await broken(page, '[data-adjust-note], [data-adjust-note] *, [data-credit-history] li, [data-credit-history] li *');
          if (found.length) bad.push(`${width} ${pct}%: ${found.join(' | ')}`);
          if (width === 320 && pct === 150) await page.screenshot({ path: path.join(SHOTS, 'E-adjusted-320-150.png') });
          assert(!errors.length, errors.join('; '));
          await ctx.close();
        }
      assert(seen > 0, 'the adjusted line never showed');
      assert(!bad.length, bad.join('\n        '));
    });

    await check('F History > Skills: the dates read as months in caps ("AUG"), the day only for two in one month', async () => {
      await b.stage('zip79_skills');
      for (const scheme of ['light', 'dark']) {
        const { page, ctx, errors } = await b.adminHome({ width: 390, scheme });
        await page.getByRole('button', { name: 'History' }).first().click();
        await page.locator('[data-history-skills]').click();
        await page.locator('[data-skills-levels]').waitFor({ timeout: 10000 });
        const heads = (await page.locator('.tm-sk-table thead .tm-sk-th-date').allInnerTexts()).map(flat);
        assert(heads.length === 3 && heads.every((h) => /^[A-Z]{3}( \d{1,2})?$/.test(h)), `heads ${JSON.stringify(heads)}`);
        const months = heads.map((h) => h.slice(0, 3));
        heads.forEach((h, i) => assert(/ \d/.test(h) === (months.filter((m) => m === months[i]).length > 1), `the day only when two share a month: ${JSON.stringify(heads)}`));
        await page.locator('[data-skills-top="Sage"]').click();
        const sheet = page.locator('[data-skills-trend="Sage"]');
        await sheet.waitFor({ timeout: 5000 });
        const list = (await sheet.locator('.tm-sk-date').allInnerTexts()).map(flat);
        const labs = (await sheet.locator('.tm-sk-xlabs span').allInnerTexts()).map(flat);
        assert(list.length === 5 && [...list, ...labs].every((h) => /^[A-Z]{3}( \d{1,2})?$/.test(h)), `the trend: ${JSON.stringify(list)} ${JSON.stringify(labs)}`);
        const lm = list.map((h) => h.slice(0, 3));
        list.forEach((h, i) => assert(/ \d/.test(h) === (lm.filter((m) => m === lm[i]).length > 1), `trend days: ${JSON.stringify(list)}`));
        await page.screenshot({ path: path.join(SHOTS, `F-skills-${scheme}.png`) });
        assert(!errors.length, errors.join('; '));
        await ctx.close();
      }
    });
  } finally {
    await b.close();
  }
  console.log(`\nzip93: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
