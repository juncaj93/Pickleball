/* Zip 90 (🎾90.prize reveal): browser checks on a LOCAL copy (the preview's calm world, fixed clock).
 *
 *   node e2e/zip90.cjs                  (ZIP90_ONLY=A,B runs some)
 *
 *   A   Locked doubles champs (zip90_ld), View as Vic at 420 light and dark, motion on: two face-down cards (the ball, TAP as wide as it), no
 *       medal by the name, no credit chip. Tap the medal card: it flips, a copy flies to the name, the medal lands (the cup glows about a
 *       second later); tap the credit card: the chip opens with $14. Nice only after both; Nice: the card is gone for good, the header keeps both.
 *   B   Leave before Nice: one card flipped, reload: both cards face down again and the header masked again. Other phones (Parker, the
 *       organizer's API) see Vic's medal and every count as they are, before and after.
 *   C   Americano champion, no credit (zip90_am), reduced motion: one card, the medal only, centered at the two-card size; the flip changes the
 *       header at once (no flying copy).
 *   D   Runner-up (zip90_second), View as Parker: "Congrats on 2nd place!", one card, $7 credit, no medal; the chip opens with $7.
 *   E   The title on one line at 320 (shrinks, never cut) and the spacing: the gap under the card = the gap between the results row and Your
 *       games; the same top gap as the results row when it is first.
 *   F   The header (zip90_header) at 320/375/420/440, light and dark, text 100/125/150%, names Vic, Christopher, Bartholomew, Maximilianus,
 *       Christopher Vanderberg, with and without a medal: one row, "not you?" beside or under (lined up with the name), "…" only when the name
 *       alone can't fit, the medal right after the name, tap areas 44 x 44, nothing wider than the screen. Christmas skin on too.
 *   G   Admin: the pill says "+ Add" and opens the same Add game sheet.
 *   H   The replay stage (zip90_replay), View as Vic twice: face down and masked each time, the slam, the spacing Alex checks (the medal right
 *       after the name, about 4 px between the cup and light/dark circles, about 8 px each side of the credit).
 * Screenshots: .data/zip90-shots (not in git).
 */
const path = require('node:path');
const { mkdirSync } = require('node:fs');
const { boot, flat, assert, sleep, ROOT } = require('./zip74-boot.cjs');

const SHOTS = path.join(ROOT, '.data', 'zip90-shots');
const ONLY = process.env.ZIP90_ONLY || '';
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
const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, `${name}.png`) });

/** What the header shows: the medals by the name, the credit chip's amount, and whether a header piece is still closed. */
const header = (page) =>
  page.evaluate(() => {
    const md = document.querySelector('.topbar .h1-badge .md');
    const slot = document.querySelector('.topbar [data-rv-slot]');
    const chip = document.querySelector('.topbar [data-credit-chip]');
    const vis = (e) => !!e && getComputedStyle(e).visibility !== 'hidden' && e.getBoundingClientRect().width > 0;
    return {
      medals: md && vis(md) && !md.closest('[data-rv-slot]') ? Number(md.getAttribute('data-medals')) : 0,
      credit: chip && vis(chip) && !chip.closest('[data-rv-slot]') ? (chip.querySelector('.cc-ghost')?.textContent ?? '') + '|' + (chip.getAttribute('aria-label') ?? '') : '',
      slot: slot ? slot.getAttribute('data-rv-slot') : null,
    };
  });

(async () => {
  mkdirSync(SHOTS, { recursive: true });
  const NOW = Date.parse('2026-11-19T15:00:00.000Z');
  const b = await boot({ name: 'zip90', port: Number(process.env.E2E_PORT) || 5490, nowMs: NOW });
  try {
    await check('A Locked doubles champs: face down, the slam, Nice (420, light and dark)', async () => {
      for (const scheme of ['light', 'dark']) {
        await b.stage('zip90_ld');
        const { page, ctx, errors } = await b.pickedPage('Vic', { width: 420, scheme, reducedMotion: 'no-preference' });
        const card = page.locator('[data-tour-congrats]');
        await card.waitFor({ timeout: 15000 });
        assert(flat(await card.locator('.rvl-kicker').textContent()) === 'The Cold Open champions', 'the caps line');
        assert(flat(await card.locator('.rvl-title').textContent()) === 'Congrats, you and Wren won!', 'the title');
        assert((await card.locator('[data-pz-card]').count()) === 2, 'two cards');
        assert((await card.locator('[data-tour-nice]').count()) === 0, 'no Nice before the cards are turned');
        const ball = await card.locator('[data-pz-card="medal"] .rvl-ball').boundingBox();
        const tap = await card.locator('[data-pz-card="medal"] .rvl-tap').boundingBox();
        assert(Math.abs(ball.width - 60) <= 1 && Math.abs(tap.width - ball.width) <= 1, `ball ${ball.width}, TAP ${tap.width}`);
        assert(Math.abs(ball.x + ball.width / 2 - (tap.x + tap.width / 2)) <= 1, 'TAP centered under the ball');
        let h = await header(page);
        assert(h.medals === 0 && h.credit === '' && h.slot === null, `masked before: ${JSON.stringify(h)}`);
        const g = await (await page.request.get(`${b.BASE}/api/group`)).json();
        assert(g.tourAwards.medals.Vic === 1 && g.credit.balanceCents >= 1400, 'the server still sends the real medal and credit');
        await shot(page, `A-before-${scheme}`);
        // The medal.
        await card.locator('[data-pz-card="medal"] .rvl-front').click();
        await page.waitForFunction(() => document.querySelector('.rvl-ghost') !== null, null, { timeout: 3000 });
        await page.waitForFunction(() => document.querySelector('.rvl-ghost') === null, null, { timeout: 3000 });
        h = await header(page);
        assert(h.medals === 1 && h.credit === '', `the medal landed, the credit still held: ${JSON.stringify(h)}`);
        await page.waitForFunction(() => document.querySelector('.topbar .cup-btn.rv-glow') !== null, null, { timeout: 3000 });
        await shot(page, `A-medal-${scheme}`);
        assert((await card.locator('[data-tour-nice]').count()) === 0, 'no Nice after one card');
        // The credit.
        await card.locator('[data-pz-card="credit"] .rvl-front').click();
        await page.waitForFunction(() => document.querySelector('.rvl-ghost-credit') !== null, null, { timeout: 3000 });
        await page.waitForFunction(() => document.querySelector('.rvl-ghost') === null && !document.querySelector('.topbar [data-rv-slot]'), null, { timeout: 3000 });
        await sleep(900);
        h = await header(page);
        assert(h.medals === 1 && h.credit.startsWith('$14|$14 credit'), `both landed: ${JSON.stringify(h)}`);
        assert(flat(await card.locator('[data-pz-card="credit"] .rvl-odo-size').textContent()) === '$14', 'the credit card says $14');
        const nice = card.locator('[data-tour-nice]');
        await nice.waitFor();
        await sleep(1400);
        assert(!(await page.locator('.topbar .cup-btn.rv-glow').count()), 'the cup glow fades');
        await shot(page, `A-both-${scheme}`);
        await nice.click();
        await card.waitFor({ state: 'detached', timeout: 8000 });
        await page.reload();
        await page.locator('.schedule, [data-tc-day]').first().waitFor({ timeout: 30000 });
        await sleep(700);
        assert((await page.locator('[data-tour-congrats]').count()) === 0, 'Nice: the card does not come back');
        h = await header(page);
        assert(h.medals === 1 && h.credit.startsWith('$14|'), `after Nice: ${JSON.stringify(h)}`);
        assert(!errors.length, errors.join('; '));
        await ctx.close();
      }
    });

    await check('B Leave before Nice: face down again; other phones never masked', async () => {
      await b.stage('zip90_ld');
      const parker = await b.phone('Parker');
      const before = await parker.group();
      assert(before.tourAwards.medals.Vic === 1 && before.tourAwards.medals.Wren === 1, 'Parker sees both medals');
      const { page, ctx } = await b.pickedPage('Vic', { width: 390, reducedMotion: 'no-preference' });
      const card = page.locator('[data-tour-congrats]');
      await card.waitFor({ timeout: 15000 });
      await card.locator('[data-pz-card="medal"] .rvl-front').click();
      await page.waitForFunction(() => document.querySelector('.topbar .h1-badge .md') && !document.querySelector('.rvl-ghost'), null, { timeout: 4000 });
      await page.reload();
      await card.waitFor({ timeout: 15000 });
      await sleep(600);
      assert((await card.locator('[data-pz-flipped]').count()) === 0, 'both face down again');
      const h = await header(page);
      assert(h.medals === 0 && h.credit === '', `masked again: ${JSON.stringify(h)}`);
      // One phone, two winners (the reviewer's case): Vic lands both, then "not you?" picks Wren (her card has the same key): Wren's cards are
      // face down and her header is masked; back to Vic: face down and masked again too.
      await page.waitForTimeout(200);
      for (const k of ['medal', 'credit']) {
        if (await card.locator(`[data-pz-card="${k}"][data-pz-flipped]`).count()) continue;
        await card.locator(`[data-pz-card="${k}"] .rvl-front`).click();
        await page.waitForFunction(() => document.querySelector('.rvl-ghost') !== null, null, { timeout: 3000 });
        await page.waitForFunction(() => !document.querySelector('.rvl-ghost') && !document.querySelector('.topbar [data-rv-slot]'), null, { timeout: 4000 });
        await sleep(900);
      }
      let hv = await header(page);
      assert(hv.medals === 1 && hv.credit.startsWith('$14|'), `Vic landed: ${JSON.stringify(hv)}`);
      for (const who of ['Wren', 'Vic']) {
        await page.locator('.topbar .not-you').click();
        await page.getByRole('button', { name: who, exact: true }).first().click();
        await page.waitForFunction((w) => (document.querySelector('.topbar h1')?.textContent ?? '').startsWith(w), who, { timeout: 15000 });
        await card.waitFor({ timeout: 15000 });
        await sleep(600);
        assert((await card.locator('[data-pz-flipped]').count()) === 0, `${who}: face down`);
        hv = await header(page);
        assert(hv.medals === 0 && hv.credit === '', `${who}: masked ${JSON.stringify(hv)}`);
      }
      // Wren's phone holds Wren's own prize; Parker's screen shows Vic and Wren's medals on the ticker and the game cards.
      const p = await b.pickedPage('Parker', { width: 390 });
      const tick = flat(await p.page.locator('.tw').first().innerText());
      assert(/Vic/.test(tick) && (await p.page.locator('.tw [data-medals]').count()) >= 2, 'Parker: the ticker with the medals');
      const after = await parker.group();
      assert(JSON.stringify(after.tourAwards.medals) === JSON.stringify(before.tourAwards.medals), 'nothing changed for anyone else');
      await p.ctx.close();
      await ctx.close();
    });

    await check('C Americano champion, no credit: one card, the medal (reduced motion: no flight)', async () => {
      await b.stage('zip90_am');
      for (const scheme of ['light', 'dark']) {
        const { page, ctx, errors } = await b.pickedPage('Vic', { width: 420, scheme, reducedMotion: 'reduce' });
        const card = page.locator('[data-tour-congrats]');
        await card.waitFor({ timeout: 15000 });
        assert(flat(await card.locator('.rvl-kicker').textContent()) === 'The Cold Open champion', 'the caps line');
        assert(flat(await card.locator('.rvl-title').textContent()) === 'Congrats, you won!', 'the title');
        assert((await card.locator('[data-pz-card]').count()) === 1 && (await card.locator('[data-pz-card="medal"]').count()) === 1, 'one card: the medal');
        const one = await card.locator('[data-pz-card]').boundingBox();
        const box = await card.boundingBox();
        assert(Math.abs(one.x + one.width / 2 - (box.x + box.width / 2)) <= 1 && one.width < box.width / 2, 'centered at the two-card size');
        let h = await header(page);
        assert(h.medals === 0, `the medal held: ${JSON.stringify(h)}`);
        await card.locator('[data-pz-card="medal"] .rvl-front').click();
        await sleep(200);
        assert((await page.locator('.rvl-ghost').count()) === 0, 'reduced motion: nothing flies');
        h = await header(page);
        assert(h.medals === 1, `the medal at once: ${JSON.stringify(h)}`);
        await card.locator('[data-tour-nice]').waitFor();
        await shot(page, `C-${scheme}`);
        assert(!errors.length, errors.join('; '));
        await ctx.close();
      }
    });

    await check('D Runner-up: one card, $7 credit, no medal', async () => {
      await b.stage('zip90_second');
      for (const scheme of ['light', 'dark']) {
        const { page, ctx, errors } = await b.pickedPage('Parker', { width: 420, scheme, reducedMotion: 'no-preference' });
        const card = page.locator('[data-tour-congrats]');
        await card.waitFor({ timeout: 15000 });
        assert(flat(await card.locator('.rvl-kicker').textContent()) === 'The Cold Open runner-up', 'the caps line');
        assert(flat(await card.locator('.rvl-title').textContent()) === 'Congrats on 2nd place!', 'the title');
        assert((await card.locator('[data-pz-card]').count()) === 1 && (await card.locator('[data-pz-card="credit"]').count()) === 1, 'one card: the credit');
        const bal = (await (await page.request.get(`${b.BASE}/api/group`)).json()).credit.balanceCents;
        let h = await header(page);
        const held = bal - 700;
        assert(held > 0 ? h.credit.includes(`$${held / 100} credit`) : h.credit === '', `the $7 held back: ${JSON.stringify(h)} (balance ${bal})`);
        await shot(page, `D-before-${scheme}`);
        await card.locator('[data-pz-card="credit"] .rvl-front').click();
        await page.waitForFunction(() => document.querySelector('.rvl-ghost-credit') !== null, null, { timeout: 3000 });
        await page.waitForFunction(() => !document.querySelector('.rvl-ghost') && !document.querySelector('.topbar [data-rv-slot]') && document.querySelector('[data-tour-nice]'), null, { timeout: 5000 });
        await sleep(900);
        h = await header(page);
        assert(h.credit.includes(`$${bal / 100} credit`) && h.medals === 0, `landed: ${JSON.stringify(h)}`);
        assert(flat(await card.locator('.rvl-odo-size').textContent()) === '$7', '$7 on the card');
        const lines = await card.locator('.rvl-what, .rvl-why').evaluateAll((els) => els.map((e) => e.getClientRects().length));
        assert(lines.every((n) => n === 1), 'Credit and Towards next game on one line each');
        await shot(page, `D-after-${scheme}`);
        assert(!errors.length, errors.join('; '));
        await ctx.close();
        await b.stage('zip90_second');
      }
    });

    await check('E The title on one line at 320, and the spacing', async () => {
      await b.stage('zip90_ld');
      for (const [width, pct] of [
        [320, 100],
        [320, 125],
        [375, 150],
        [440, 100],
      ]) {
        const { page, ctx } = await b.pickedPage('Vic', { width });
        if (pct !== 100) await zoom(page, pct);
        await page.setViewportSize({ width, height: 844 });
        await sleep(300);
        const t = await page.locator('.rvl-title').evaluate((e) => ({ sw: e.scrollWidth, cw: e.clientWidth, h: e.getBoundingClientRect().height, fs: parseFloat(getComputedStyle(e).fontSize), lh: parseFloat(getComputedStyle(e).lineHeight), root: parseFloat(getComputedStyle(document.documentElement).fontSize) }));
        // One line, shrinking down to 0.9 rem; only past that (very big text on the smallest phone) may it wrap, never cut.
        const oneLine = t.sw <= t.cw + 1 && t.h < t.lh * 1.5;
        assert(oneLine || (pct > 100 && Math.abs(t.fs - 0.9 * t.root) <= 0.5 && t.sw <= t.cw + 1), `one line at ${width}/${pct}%: ${JSON.stringify(t)}`);
        assert(t.fs >= 0.9 * t.root - 0.5, `not under 0.9 rem: ${JSON.stringify(t)}`);
        const fits = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
        assert(fits, `nothing wider than the screen at ${width}/${pct}%`);
        if (pct === 100) {
          const m = await page.evaluate(() => {
            const r = (s) => document.querySelector(s).getBoundingClientRect();
            const yg = [...document.querySelectorAll('[data-tournament="ended"] > *')].find((e) => !e.matches('[data-tc-results]'));
            return { pzB: r('[data-tour-congrats]').bottom, resT: r('[data-tc-results]').top, resB: r('[data-tc-results]').bottom, ygT: yg ? yg.getBoundingClientRect().top : null, pzT: r('[data-tour-congrats]').top };
          });
          assert(m.ygT !== null && Math.abs(m.resT - m.pzB - (m.ygT - m.resB)) <= 1, `the gap under the card = the gap above Your games: ${JSON.stringify(m)}`);
          await shot(page, `E-${width}`);
        }
        await ctx.close();
      }
      // The same top gap with no card (the results row first) and with the card.
      const tops = [];
      for (const stage of ['zip90_header', 'zip90_second']) {
        await b.stage(stage);
        const { page, ctx } = await b.pickedPage(stage === 'zip90_second' ? 'Parker' : 'Vic', { width: 390 });
        tops.push(await page.evaluate(() => (document.querySelector('[data-tour-congrats]') ?? document.querySelector('[data-tournament]')).getBoundingClientRect().top - document.querySelector('.tw').getBoundingClientRect().bottom));
        await ctx.close();
      }
      assert(Math.abs(tops[0] - tops[1]) <= 1, `same top gap: ${tops}`);
    });

    await check('F The header: one row, beside / under / "…" (320 to 440, light and dark, 100 to 150%, Christmas skin)', async () => {
      const run = async (label, width, scheme, pct, page) => {
        if (pct !== 100) await zoom(page, pct);
        await sleep(250);
        for (const name of ['Vic', 'Christopher', 'Bartholomew', 'Maximilianus', 'Christopher Vanderberg']) {
          for (const medal of [true, false]) {
            const r = await page.evaluate(
              ({ name, medal }) => {
                const n = document.querySelector('.topbar .h1-name') || document.querySelector('.topbar h1');
                n.textContent = name;
                const bd = document.querySelector('.topbar .h1-badge');
                if (bd) bd.style.display = medal ? '' : 'none';
                const rc = (e) => e.getBoundingClientRect();
                const row = document.querySelector('.topbar-row');
                const end = document.querySelector('.topbar-end');
                const h1 = document.querySelector('.topbar h1');
                const nameEl = document.querySelector('.topbar .h1-name') || h1;
                const ny = document.querySelector('.topbar .not-you');
                const items = [...end.querySelectorAll('.mode-btn, [data-credit-chip], .today')].map(rc);
                const mid = (x) => x.top + x.height / 2;
                return {
                  wide: document.documentElement.scrollWidth > window.innerWidth,
                  oneRow: [...row.children].every((c) => rc(c).top < rc(document.querySelector('.topbar-text')).bottom) && items.every((x) => Math.abs(mid(x) - mid(items[items.length - 1])) <= 6),
                  h1: rc(h1),
                  ny: rc(ny),
                  endLeft: rc(end).left,
                  cut: nameEl.scrollWidth > nameEl.clientWidth + 1,
                  badgeGap: bd && medal ? rc(bd).left - rc(nameEl).right : 0,
                  taps: [...end.querySelectorAll('.mode-btn, [data-credit-chip]')].map((e) => [Math.round(rc(e).width), Math.round(rc(e).height)]),
                  room: rc(document.querySelector('.title-line')).width,
                  needed: (() => {
                    const c = h1.cloneNode(true);
                    c.style.cssText = 'position:absolute;visibility:hidden;width:auto;max-width:none;overflow:visible';
                    c.querySelectorAll('*').forEach((x) => (x.style.overflow = 'visible'));
                    document.body.appendChild(c);
                    const w = c.getBoundingClientRect().width;
                    c.remove();
                    return w;
                  })(),
                };
              },
              { name, medal },
            );
            const where = `${label} ${width} ${scheme} ${pct}% ${name}${medal ? ' +medal' : ''}`;
            assert(!r.wide, `${where}: wider than the screen`);
            assert(r.oneRow, `${where}: not one row`);
            assert(r.ny.right <= r.endLeft + 0.5, `${where}: "not you?" runs into the buttons`);
            const beside = r.ny.top < r.h1.bottom - 4 && r.ny.left >= r.h1.right - 1;
            const under = r.ny.top >= r.h1.bottom - 4 && Math.abs(r.ny.left - r.h1.left) <= 1;
            assert(beside || under, `${where}: "not you?" neither beside nor under ${JSON.stringify(r)}`);
            if (beside) assert(!r.cut, `${where}: cut while "not you?" is beside`);
            if (under) assert(r.needed + 7 + r.ny.width > r.room - 0.5, `${where}: "not you?" under though both fit (${r.needed} + ${r.ny.width} in ${r.room})`);
            if (r.cut) assert(r.needed > r.room - 0.5, `${where}: "…" though the name fits`);
            assert(Math.abs(r.badgeGap) <= 1.5, `${where}: a gap before the medal (${r.badgeGap})`);
            assert(r.taps.every(([w, h]) => w >= 44 && h >= 44), `${where}: tap areas ${JSON.stringify(r.taps)}`);
          }
        }
      };
      await b.stage('zip90_header');
      for (const width of [320, 375, 420, 440])
        for (const scheme of ['light', 'dark'])
          for (const pct of [100, 125, 150]) {
            const { page, ctx, errors } = await b.pickedPage('Christopher Vanderberg', { width, scheme });
            await run('plain', width, scheme, pct, page);
            if (pct === 100) await shot(page, `F-${width}-${scheme}`);
            assert(!errors.length, errors.join('; '));
            await ctx.close();
          }
      // The real names, as they come: Vic beside at 375, Christopher Vanderberg under with "…" at 375.
      for (const [who, width, want] of [
        ['Vic', 375, 'beside'],
        ['Christopher Vanderberg', 375, 'under'],
      ]) {
        const { page, ctx } = await b.pickedPage(who, { width });
        const r = await page.evaluate(() => {
          const a = document.querySelector('.topbar h1').getBoundingClientRect();
          const n = document.querySelector('.topbar .not-you').getBoundingClientRect();
          return n.top >= a.bottom - 4 ? 'under' : 'beside';
        });
        assert(r === want, `${who} at ${width}: ${r}`);
        await ctx.close();
      }
      // The Christmas skin.
      await b.setClock(Date.parse('2026-11-28T15:00:00.000Z'));
      await b.call('PUT', '/api/admin/christmas-skin-switch', { mode: 'all' });
      await b.stage('zip90_header');
      try {
        for (const [width, scheme] of [
          [375, 'light'],
          [320, 'dark'],
        ]) {
          const p = await b.newPage({ width, scheme });
          await p.ctx.addInitScript(() => {
            try {
              localStorage.setItem('pb_xmas_theme', 'on');
              localStorage.setItem('pb_xmas_hint', '1');
              localStorage.setItem('pb_xmas_back', '1');
            } catch {}
          });
          await p.page.goto(`${b.BASE}/?as=${encodeURIComponent('Christopher Vanderberg')}`);
          await p.page.locator('.schedule, [data-tc-day]').first().waitFor({ timeout: 30000 });
          await p.page.waitForTimeout(700);
          await run('xmas', width, scheme, 100, p.page);
          await shot(p.page, `F-xmas-${width}-${scheme}`);
          assert(!p.errors.length, p.errors.join('; '));
          await p.ctx.close();
        }
      } finally {
        await b.call('PUT', '/api/admin/christmas-skin-switch', { mode: 'off' });
        await b.setClock(NOW);
      }
    });

    await check('H Replay stage: View as Vic, the slam, pick it again, the cards are face down again (Alex\'s phone check)', async () => {
      for (let round = 0; round < 2; round++) {
        await b.stage('zip90_replay');
        const { page, ctx, errors } = await b.playerPage('Vic', { width: 390, scheme: round ? 'dark' : 'light', reducedMotion: 'no-preference' });
        const card = page.locator('[data-tour-congrats]');
        await card.waitFor({ timeout: 15000 });
        assert((await card.locator('[data-pz-flipped]').count()) === 0, `round ${round}: face down`);
        let h = await header(page);
        assert(h.medals === 0 && h.credit === '', `round ${round}: masked ${JSON.stringify(h)}`);
        for (const k of ['medal', 'credit']) {
          await card.locator(`[data-pz-card="${k}"] .rvl-front`).click();
          await page.waitForFunction(() => document.querySelector('.rvl-ghost') !== null, null, { timeout: 3000 });
          await page.waitForFunction(() => !document.querySelector('.rvl-ghost') && !document.querySelector('.topbar [data-rv-slot]'), null, { timeout: 3000 });
        }
        await sleep(1000);
        h = await header(page);
        assert(h.medals === 1 && h.credit.startsWith('$14|'), `round ${round}: landed ${JSON.stringify(h)}`);
        // The spacing Alex will look at: the medal right after "Vic", the circles about 4 px apart, about 8 px each side of the credit.
        const sp = await page.evaluate(() => {
          const r = (s) => document.querySelector(s).getBoundingClientRect();
          const circle = (s) => { const x = r(s); return { left: x.left + 4, right: x.right - 4 }; };
          const cup = circle('.topbar .cup-btn');
          const mode = circle('.topbar .mode-btn:not(.cup-btn)');
          const amt = [r('.topbar .cc-label'), r('.topbar .cc-amount')];
          return { medal: r('.topbar .h1-badge').left - r('.topbar .h1-name').right, circles: mode.left - cup.right, left: Math.min(amt[0].left, amt[1].left) - mode.right, right: r('.topbar .today').left - Math.max(amt[0].right, amt[1].right) };
        });
        assert(Math.abs(sp.medal) <= 1.5 && Math.abs(sp.circles - 4) <= 1 && sp.left >= 6 && sp.left <= 11 && Math.abs(sp.right - 8) <= 1.5, `round ${round}: spacing ${JSON.stringify(sp)}`);
        await shot(page, `H-replay-${round}`);
        assert(!errors.length, errors.join('; '));
        await ctx.close();
      }
    });

    await check('I Rounds 2 and 3: the organizer header spacing, the card\'s condensed top, the medal placed exactly like the game cards\' medal', async () => {
      await b.stage('zip90_header');
      for (const width of [375, 420, 440])
        for (const scheme of ['light', 'dark']) {
          const a = await b.adminHome({ width, scheme });
          await a.page.locator('[data-cup]').waitFor({ timeout: 15000 });
          const r = await a.page.evaluate(() => {
            const r = (e) => e.getBoundingClientRect();
            const va = document.querySelector('.r2-hdr-actions .topbar-btn'), cup = document.querySelector('.r2-hdr-actions .cup-btn'), mode = document.querySelector('.r2-hdr-actions .mode-btn:not(.cup-btn)'), day = document.querySelector('.topbar .today'), h1 = document.querySelector('.topbar h1');
            const mid = (x) => r(x).top + r(x).height / 2;
            return { vaToCup: r(cup).left + 4 - r(va).right, circles: r(mode).left + 4 - (r(cup).right - 4), modeToDate: r(day).left - (r(mode).right - 4), oneLine: [va, cup, mode, day].every((x) => Math.abs(mid(x) - mid(h1)) <= 6), taps: [cup, mode].every((x) => r(x).width >= 44 && r(x).height >= 44), wide: document.documentElement.scrollWidth > innerWidth };
          });
          assert(Math.abs(r.circles - 4) <= 0.6 && Math.abs(r.vaToCup - 4) <= 0.6 && Math.abs(r.modeToDate - 8) <= 0.6 && r.oneLine && r.taps && !r.wide, `admin ${width} ${scheme}: ${JSON.stringify(r)}`);
          if (scheme === 'light') await shot(a.page, `I-admin-${width}`);
          await a.ctx.close();
        }
      // The medal: the disc's edge under the name's baseline by the ticker's measure (about 0.17 of the size), for 1 medal, after the slam, 2.
      // Round 3 (Alex): the medal by the name sits exactly like the medal after a name on the game cards (the look he approved): its bottom
      // against the name's baseline, as a share of the font size, and its height, the same for 1 medal, 2, and right after the slam.
      const medals = (page) =>
        page.evaluate(() => {
          const one = (ico) => {
            const md = ico.closest('.md-btn') || ico.closest('.md');
            let n = md.previousSibling;
            while (n && !(n.nodeType === 3 && n.textContent.trim()) && !(n.nodeType === 1 && n.textContent.trim())) n = n.previousSibling;
            if (!n) n = md.closest('h1') && md.closest('h1').querySelector('.h1-name');
            const host = n.nodeType === 3 ? n.parentNode : n;
            const p = document.createElement('span');
            p.style.cssText = 'display:inline-block;width:0;height:0;vertical-align:baseline';
            if (n.nodeType === 3) n.parentNode.insertBefore(p, n.nextSibling);
            else n.appendChild(p);
            const base = p.getBoundingClientRect().bottom;
            p.remove();
            const fs = parseFloat(getComputedStyle(host).fontSize);
            const r = ico.getBoundingClientRect();
            return { drop: (r.top + (r.height * 25.5) / 26 - base) / fs, size: r.height / fs };
          };
          const card = [...document.querySelectorAll('main .md-ico')].find((i) => !i.closest('.tw') && !i.closest('.rvl'));
          return { card: card ? one(card) : null, header: [...document.querySelectorAll('.topbar .h1-badge .md-ico')].map(one) };
        });
      const same = (m, n, what) => {
        assert(m.card && m.header.length === n, `${what}: ${JSON.stringify(m)}`);
        for (const h of m.header) assert(Math.abs(h.drop - m.card.drop) <= 0.01 && Math.abs(h.size - m.card.size) <= 0.01, `${what}: like the game card ${JSON.stringify(m)}`);
      };
      const withGame = async (page) => {
        const fut = page.getByRole('button', { name: 'Show future games' });
        if (await fut.count()) {
          await fut.click();
          await sleep(600);
        }
      };
      const hid = (await b.stage('history')).id;
      const vic = await b.phone('Vic');
      await vic.post('/api/tournament/award-seen', { tournamentId: hid });
      for (const se of (await vic.group()).sessions.slice(0, 1)) await vic.post(`/api/sessions/${se.id}/join`, {});
      const two = await b.pickedPage('Vic', { width: 390 });
      await withGame(two.page);
      same(await medals(two.page), 2, '2 medals');
      await two.ctx.close();
      await b.stage('zip90_replay');
      for (const se of (await vic.group()).sessions.slice(0, 1)) await vic.post(`/api/sessions/${se.id}/join`, {});
      const { page, ctx } = await b.pickedPage('Vic', { width: 390, reducedMotion: 'no-preference' });
      await page.locator('[data-pz-card="medal"] .rvl-front').click();
      await page.waitForFunction(() => document.querySelector('.rvl-ghost') !== null);
      await page.waitForFunction(() => !document.querySelector('.rvl-ghost'));
      await sleep(500);
      await withGame(page);
      same(await medals(page), 1, 'after the slam');
      await page.evaluate(() => window.scrollTo(0, 0));
      // The card's top: the caps line, the title and the cards closer (2 px and 11 px), the padding as before (18 px).
      const g = await page.evaluate(() => { const r = (s) => document.querySelector(s).getBoundingClientRect(); return { pad: r('.rvl-kicker').top - r('.rvl').top, a: r('.rvl-title').top - r('.rvl-kicker').bottom, b: r('.rvl-cards').top - r('.rvl-title').bottom }; });
      assert(Math.abs(g.pad - 18) <= 1 && g.a <= 3 && g.b <= 12, `card top: ${JSON.stringify(g)}`);
      await shot(page, 'I-card');
      await ctx.close();
    });

    await check('G Admin: "+ Add" opens the Add game sheet', async () => {
      await b.stage('none');
      const { page, ctx } = await b.adminHome({ width: 390 });
      const pill = page.getByRole('button', { name: '+ Add', exact: true }).first();
      await pill.waitFor({ timeout: 15000 });
      assert((await page.getByText('+ Add game').count()) === 0, 'the old words are gone');
      await pill.click();
      await page.locator('dialog[open]').getByRole('button', { name: 'Add game', exact: true }).waitFor({ timeout: 8000 });
      await ctx.close();
    });
  } finally {
    await b.close();
    console.log(`\nzip90: ${passed} passed, ${failed} failed`);
    process.exit(failed ? 1 : 0);
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
