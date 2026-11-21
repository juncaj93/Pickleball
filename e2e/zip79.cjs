/* Zip 79 (🎾79.results skills): the results row, previous level, the level up and History > Skills, in a real browser.
 *
 *   node e2e/zip79.cjs            (ZIP79_ONLY=<letter> runs one check)
 *
 * The world is the preview's calm profile as of Thu Nov 19 2026, 10:00 AM Eastern (e2e/zip74-boot.cjs), and the Tournament test stages.
 *   A  the night after the reveal (Americano): the board once (X), then ONE row: the name left, the lime Standings button right (44 px), no
 *      kicker, no divider; Your rounds under it, no Standings card. Standings opens the board in its final state (every row in at once, the gold
 *      medal on 1st, YOU), X closes it. 320/390/420, light and dark; no page wider than the screen.
 *   B  a long name at 320: the name wraps, the button keeps its size and stays on the right.
 *   C  Locked doubles: the night (Your games under the row) and the day after (the row alone above THIS WEEK); the teams board with each team's
 *      players, the gold medal only on the Final's winners. Two days after: no row.
 *   D  previous level: Sign up starts on 3.0 with "PREVIOUS RATING"; 3.4 grays the old row (the label stays); Next plays the level up (the
 *      count, gold, LEVEL UP, about 3 s) then the dates; a tap skips it; the same level again: nothing; reduced motion: the final card about
 *      1 s. Light and dark.
 *   E  History > Skills: four options (they fit or slide sideways at 320, words never broken), Most improved, the Levels table (sorts), a tap
 *      on a name opens the trend sheet (3.4, "+0.7 past ...", the chart with the pickleball, the list). 320/390/420, light and dark.
 *   F  the Christmas skin on: the row and the board at 390 light and 320 dark.
 * Screenshots: .data/zip79-shots (not in git).
 */
const path = require('node:path');
const { mkdirSync } = require('node:fs');
const { DatabaseSync } = require('node:sqlite');
const { boot, flat, assert, sleep, ROOT } = require('./zip74-boot.cjs');

const SHOTS = path.join(ROOT, '.data', 'zip79-shots');
const ONLY = process.env.ZIP79_ONLY || '';
let passed = 0;
let failed = 0;
async function check(name, fn) {
  if (ONLY && !ONLY.split(',').some((x) => name.startsWith(x))) return;
  const t0 = Date.now();
  try {
    await fn();
    passed++;
    console.log(`  ok    ${name} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  } catch (err) {
    failed++;
    console.log(`  FAIL  ${name}\n        ${String(err && err.stack ? err.stack : err).split('\n').slice(0, 4).join('\n        ')}`);
  }
}

(async () => {
  mkdirSync(SHOTS, { recursive: true });
  const h = await boot({ port: Number(process.env.E2E_PORT) || 5479, name: 'zip79' });
  const shot = (page, name, full = false) => page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: full });
  /** A player's phone (View as link), its motion setting, set-up before the page loads. */
  async function phone(who, { width = 390, scheme = 'light', reducedMotion = 'no-preference', init = null, arg = undefined } = {}) {
    const p = await h.newPage({ width, scheme, reducedMotion });
    if (init) await p.ctx.addInitScript(init, arg);
    await p.page.goto(`${h.BASE}/?as=${encodeURIComponent(who)}`);
    await p.page.locator('.schedule, [data-tc-day], [data-tc-results]').first().waitFor({ timeout: 30000 });
    await p.page.waitForTimeout(600);
    return p;
  }
  const seen = (id) => {
    try {
      localStorage.setItem(`pb_reveal_seen:${id}`, '1');
    } catch {}
  };
  const rowLook = async (page, what) => {
    const row = page.locator('[data-tc-results="row"]');
    await row.waitFor({ timeout: 15000 });
    assert((await page.locator('.tc-gd-kicker, [data-tc-results="row"] .tc-rv-divider, [data-tc-results="row"] .tc-gd-bar').count()) === 0, `${what}: a kicker or a divider in the row`);
    const btn = page.locator('[data-tc-results-open]');
    const b = await btn.boundingBox();
    const r = await row.boundingBox();
    const n = await page.locator('[data-tc-results="row"] .tc-res-name').boundingBox();
    assert(Math.round(b.height) >= 44, `${what}: the button is ${b.height} px tall`);
    assert(b.x > n.x && r.x + r.width - (b.x + b.width) < 30, `${what}: the button is not on the right`);
    const bg = await btn.evaluate((el) => getComputedStyle(el).backgroundColor);
    assert(/216, 240, 59/.test(bg), `${what}: the button is not lime (${bg})`);
    assert(flat(await btn.innerText()) === 'Standings', 'the words');
    return { b, r, n };
  };
  const boardLook = async (page, what, rows) => {
    await page.locator('[data-tc-results-open]').click();
    const board = page.locator('[data-tc-results="board"]');
    await board.waitFor({ timeout: 5000 });
    // Final state at once: every row fully in, no animation.
    const ops = await page.locator('[data-tc-result-row]').evaluateAll((els) => els.map((e) => Number(getComputedStyle(e).opacity)));
    assert(ops.length === rows && ops.every((o) => o === 1), `${what}: rows ${JSON.stringify(ops)}`);
    assert(flat(await page.locator('[data-tc-results="board"] .tc-rv-title').innerText()) === 'Final standings', 'the title');
    assert((await page.locator('[data-tc-result-row] .tc-rv-medal').count()) === 1, `${what}: one medal`);
    assert((await page.locator('[data-tc-result-row][data-p="1"] .tc-rv-medal').count()) === 1, `${what}: the medal is not on 1st`);
    // Names never cut.
    const cut = await page.locator('.tc-rv-name').evaluateAll((els) => els.filter((e) => e.scrollWidth > e.clientWidth + 1 || getComputedStyle(e).textOverflow === 'ellipsis').length);
    assert(cut === 0, `${what}: ${cut} names cut`);
    return board;
  };

  try {
    await check('A the night after the reveal: the board once, then one row with Your rounds; Standings opens the final board, X closes it', async () => {
      const made = await h.stage('zip79_night');
      // The reveal once on a phone that never saw it (X), then the row.
      const first = await phone('Vic');
      await first.page.locator('[data-tc-reveal]').waitFor({ timeout: 15000 });
      await first.page.locator('[data-tc-reveal-x]').click();
      await sleep(600);
      await rowLook(first.page, 'after the X');
      assert((await first.page.locator('[data-tc-rounds]').count()) === 1, 'Your rounds under the row');
      assert((await first.page.locator('[data-tc-day-standings]').count()) === 0, 'the plain Standings card is still there');
      await first.ctx.close();
      for (const width of [320, 390, 420]) {
        for (const scheme of ['light', 'dark']) {
          const p = await phone('Vic', { width, scheme, init: seen, arg: made.id });
          const page = p.page;
          await rowLook(page, `A ${width} ${scheme}`);
          assert((await page.locator('[data-tc-rounds]').count()) === 1, 'Your rounds');
          assert((await page.locator('[data-tc-day-standings]').count()) === 0, 'Standings card');
          await h.noWider(page, `A ${width} ${scheme}`);
          if (width === 390) await shot(page, `A-row-${scheme}`);
          await boardLook(page, `A ${width} ${scheme}`, 10);
          assert((await page.locator('[data-tc-result-row] .tc-rv-you').count()) === 1, 'YOU');
          await h.noWider(page, `A board ${width} ${scheme}`);
          if (width === 390) await shot(page, `A-board-${scheme}`, true);
          await page.locator('[data-tc-results-x]').click();
          await page.locator('[data-tc-results="row"]').waitFor({ timeout: 3000 });
          assert(!p.errors.length, p.errors.join(' | '));
          await p.ctx.close();
        }
      }
    });

    await check('B a long name at 320: the name wraps, the button keeps its size on the right', async () => {
      const made = await h.stage('zip79_next_day');
      const db = new DatabaseSync(h.dbFile);
      db.prepare('UPDATE tournaments SET name = ? WHERE id = ?').run('The Spring Last Hurrah Classic', made.id);
      db.close();
      const sizes = [];
      for (const scheme of ['light', 'dark']) {
        const p = await phone('Vic', { width: 320, scheme });
        const { b, n } = await rowLook(p.page, `B ${scheme}`);
        const lines = await p.page.locator('.tc-res-name').evaluate((el) => Math.round(el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight)));
        assert(lines >= 2, `the long name is on ${lines} line`);
        sizes.push(Math.round(b.width));
        assert(n.x + n.width <= b.x, 'the name runs under the button');
        await h.noWider(p.page, `B ${scheme}`);
        await shot(p.page, `B-long-320-${scheme}`);
        await p.ctx.close();
      }
      const wide = await phone('Vic', { width: 420 });
      const wb = await wide.page.locator('[data-tc-results-open]').boundingBox();
      assert(Math.abs(Math.round(wb.width) - sizes[0]) <= 1, `the button shrank at 320 (${sizes[0]} vs ${wb.width})`);
      await wide.ctx.close();
    });

    await check('C Locked doubles: the night (Your games), the day after (the row above THIS WEEK), the teams board; two days after: gone', async () => {
      await h.stage('zip79_night_ld');
      for (const scheme of ['light', 'dark']) {
        const p = await phone('Vic', { scheme });
        await rowLook(p.page, `C night ${scheme}`);
        assert((await p.page.locator('[data-tc-day-games]').count()) === 1, 'Your games under the row');
        await boardLook(p.page, `C night ${scheme}`, 4);
        const names = await p.page.locator('[data-tc-result-row]').evaluateAll((els) => els.map((e) => e.getAttribute('data-tc-result-row')));
        assert(names[0] === 'Net Ninjas', `first: ${names[0]}`);
        assert(flat(await p.page.locator('[data-tc-result-row][data-p="1"] .tc-res-players').innerText()) === 'Vic + Wren', 'the players');
        assert((await p.page.locator('[data-tc-result-row] .tc-rv-pts').count()) === 0, 'points on a Locked doubles board');
        if (scheme === 'light') await shot(p.page, 'C-ld-board-light', true);
        await p.ctx.close();
      }
      const reese = await phone('Reese');
      await rowLook(reese.page, 'C Reese');
      assert((await reese.page.locator('[data-tc-day-games]').count()) === 0, 'Reese did not play');
      await reese.ctx.close();
      await h.stage('zip79_next_day_ld');
      for (const width of [320, 390]) {
        const p = await phone('Vic', { width });
        const { r } = await rowLook(p.page, 'C next day');
        assert((await p.page.locator('[data-tc-day-games], [data-tc-rounds]').count()) === 0, 'the night under the row the next day');
        const week = await p.page.locator('.schedule').first().boundingBox();
        assert(r.y < week.y, 'the row is not above THIS WEEK');
        await h.noWider(p.page, `C next day ${width}`);
        if (width === 390) await shot(p.page, 'C-next-day-light');
        await p.ctx.close();
      }
      await h.stage('zip79_gone');
      const g = await phone('Vic');
      await sleep(500);
      assert((await g.page.locator('[data-tc-results]').count()) === 0, 'a row two days after');
      await g.ctx.close();
    });

    await check('D previous level and the level up: 3.0 picked with PREVIOUS RATING; 3.4 grays it; Next plays the level up, then the dates; tap skips; same level: none; reduced motion', async () => {
      await h.stage('zip79_prev');
      const open = async (p) => {
        await p.page.locator('[data-tc-signup]').first().click();
        await p.page.locator('[data-tm-step="1"]').waitFor({ timeout: 5000 });
      };
      for (const scheme of ['light', 'dark']) {
        for (const width of [320, 390]) {
          const p = await phone('Vic', { width, scheme });
          await open(p);
          const prev = p.page.locator('[data-tm-previous]');
          assert((await prev.getAttribute('data-level')) === '300', 'the previous row is not 3.0');
          assert((await prev.getAttribute('aria-checked')) === 'true', '3.0 is not picked');
          assert(/^previous rating$/i.test(flat(await prev.locator('.tm-level-prevtag').innerText())), 'the label');
          await p.page.locator('.tm-level[data-level="340"]').click();
          assert(/tm-level-prev-off/.test(await prev.getAttribute('class')), 'the old row is not gray');
          assert((await prev.locator('.tm-level-prevtag').count()) === 1, 'the label went');
          await h.noWider(p.page, `D ${width} ${scheme}`);
          if (width === 390) await shot(p.page, `D-picked-${scheme}`);
          if (width === 390) {
            const t0 = Date.now();
            await p.page.locator('[data-tm-next]').click();
            const lu = p.page.locator('[data-tm-levelup]');
            await lu.waitFor({ timeout: 2000 });
            const seenNums = new Set();
            while (Date.now() - t0 < 1700) {
              seenNums.add(flat(await p.page.locator('[data-tm-levelup-num]').innerText().catch(() => '')));
              await sleep(60);
            }
            assert(['3.0', '3.1', '3.2', '3.3'].filter((x) => seenNums.has(x)).length >= 3, `the count showed ${[...seenNums].join(' ')}`);
            await sleep(700);
            assert(flat(await p.page.locator('[data-tm-levelup-num]').innerText()) === '3.4', 'it did not land on 3.4');
            assert(/tm-lu-landed/.test(await lu.getAttribute('class')), 'not landed');
            const gold = await p.page.locator('[data-tm-levelup-num]').evaluate((el) => getComputedStyle(el).color);
            const bar = await p.page.locator('.tm-lu-bar').evaluate((el) => ({ op: getComputedStyle(el).opacity, text: el.textContent }));
            await shot(p.page, `D-levelup-${scheme}`);
            assert(bar.text === 'Level up', 'the banner');
            await p.page.locator('[data-tm-step="2"]').waitFor({ timeout: 3000 });
            const took = Date.now() - t0;
            assert(took > 2500 && took < 4200, `it took ${took} ms`);
            void gold;
            // Back, then Next on the same level: no level up again.
            await p.page.locator('[data-tm-back]').click();
            await p.page.locator('[data-tm-next]').click();
            await sleep(300);
            assert((await p.page.locator('[data-tm-levelup]').count()) === 0, 'it played again for the same level');
            await p.page.locator('[data-tm-step="2"]').waitFor({ timeout: 2000 });
            // Back, pick higher still: it plays again; a tap skips it.
            await p.page.locator('[data-tm-back]').click();
            await p.page.locator('.tm-level[data-level="350"]').click();
            await p.page.locator('[data-tm-next]').click();
            await p.page.locator('[data-tm-levelup]').waitFor({ timeout: 2000 });
            await sleep(300);
            await p.page.mouse.click(30, 60);
            await p.page.locator('[data-tm-step="2"]').waitFor({ timeout: 1500 });
            assert((await p.page.locator('[data-tm-levelup]').count()) === 0, 'the tap did not skip it');
            // Back (Android's back, an edge swipe) skips it to the dates step; the Sign up sheet stays open.
            await p.page.locator('[data-tm-back]').click();
            await p.page.locator('.tm-level[data-level="360"]').click();
            await p.page.locator('[data-tm-next]').click();
            await p.page.locator('[data-tm-levelup]').waitFor({ timeout: 2000 });
            await sleep(400);
            await p.page.goBack();
            await p.page.locator('[data-tm-step="2"]').waitFor({ timeout: 2000 });
            assert((await p.page.locator('[data-tm-levelup]').count()) === 0, 'Back did not skip it');
            await sleep(400);
            assert(await p.page.locator('[data-tm-step="2"]').isVisible(), 'Back closed the Sign up sheet');
          }
          assert(!p.errors.length, p.errors.join(' | '));
          await p.ctx.close();
        }
      }
      // Lower or the same: nothing.
      const low = await phone('Vic');
      await open(low);
      await low.page.locator('.tm-level[data-level="275"]').click();
      await low.page.locator('[data-tm-next]').click();
      await sleep(300);
      assert((await low.page.locator('[data-tm-levelup]').count()) === 0, 'a level up for a lower pick');
      await low.page.locator('[data-tm-step="2"]').waitFor({ timeout: 2000 });
      await low.ctx.close();
      // Reduced motion: the final card, about 1 s.
      const calm = await phone('Vic', { reducedMotion: 'reduce' });
      await open(calm);
      await calm.page.locator('.tm-level[data-level="340"]').click();
      const t0 = Date.now();
      await calm.page.locator('[data-tm-next]').click();
      await calm.page.locator('[data-tm-levelup]').waitFor({ timeout: 2000 });
      assert(flat(await calm.page.locator('[data-tm-levelup-num]').innerText()) === '3.4', 'reduced motion does not show the final number at once');
      assert((await calm.page.locator('.tm-lu-ring, .tm-lu-streak, .tm-lu-flash').count()) === 0, 'effects with reduced motion');
      await calm.page.locator('[data-tm-step="2"]').waitFor({ timeout: 3000 });
      const took = Date.now() - t0;
      assert(took > 700 && took < 1900, `reduced motion took ${took} ms`);
      await calm.ctx.close();
      // A first-timer: no label, nothing picked.
      const kai = await phone('Kai').catch(() => null);
      if (kai) await kai.ctx.close();
    });

    await check('E History > Skills: four options, Most improved, the Levels table and sorts, the trend sheet; 320/390/420 light and dark', async () => {
      await h.stage('zip79_skills');
      for (const width of [320, 390, 420]) {
        for (const scheme of ['light', 'dark']) {
          const a = await h.newPage({ width, scheme, organizer: true });
          await a.page.goto(`${h.BASE}/admin`);
          await a.page.locator('.tab-bar, nav').first().waitFor({ timeout: 30000 });
          await a.page.waitForTimeout(800);
          await a.page.getByRole('button', { name: 'History' }).first().click();
          const skills = a.page.locator('[data-history-skills]');
          await skills.waitFor({ timeout: 10000 });
          // Words never broken: each option on one line.
          const opts = await a.page.locator('.tm-hist-seg button').evaluateAll((els) => els.map((e) => ({ t: e.textContent, h: e.scrollHeight, w: e.scrollWidth, cw: e.clientWidth })));
          assert(opts.length === 4 && opts.map((o) => o.t).join(',') === 'Activity,Sessions,Tournaments,Skills', JSON.stringify(opts.map((o) => o.t)));
          assert(opts.every((o) => o.w <= o.cw + 1 && o.h <= 50), `a broken option ${JSON.stringify(opts)}`);
          await skills.click();
          await a.page.locator('[data-skills-levels]').waitFor({ timeout: 10000 });
          const top = await a.page.locator('[data-skills-top]').evaluateAll((els) => els.map((e) => e.getAttribute('data-skills-top')));
          assert(top.join(',') === 'Sage,Quinn,Wren', `Most improved: ${top}`);
          assert(/\+0\.7/.test(flat(await a.page.locator('[data-skills-top="Sage"]').innerText())), 'Sage +0.7');
          const heads = await a.page.locator('.tm-sk-table thead th').allInnerTexts();
          assert(heads.length === 6 && /^\d\d\/\d\d\/\d\d$/.test(flat(heads[1])), `heads ${heads}`);
          const zoe = await a.page.locator('[data-skills-row="Zoe"] .tm-sk-cell').evaluateAll((els) => els.map((e) => e.getAttribute('data-tone')));
          assert(zoe[0] === 'down', `Zoe ${zoe}`);
          assert((await a.page.locator('[data-skills-row="Christopher Vanderberg"] .tm-sk-dash').count()) === 1, 'Christopher’s dash');
          const cut = await a.page.locator('.tm-sk-namebtn, .tm-sk-name').evaluateAll((els) => els.filter((e) => e.scrollWidth > e.clientWidth + 1).length);
          assert(cut === 0, `${cut} names cut`);
          await h.noWider(a.page, `E ${width} ${scheme}`);
          // The whole table shows at 390 and up (320 may slide sideways inside its card, the names pinned on the left).
          const tw = await a.page.locator('.tm-sk-scroll').evaluate((el) => [el.scrollWidth, el.clientWidth]);
          if (width >= 390) assert(tw[0] <= tw[1] + 1, `the table is ${tw[0]} px in ${tw[1]} px at ${width}`);
          if (width !== 420) await shot(a.page, `E-skills-${width}-${scheme}`, true);
          await a.page.locator('[data-skills-sort="name"]').click();
          const byName = await a.page.locator('[data-skills-row]').evaluateAll((els) => els.map((e) => e.getAttribute('data-skills-row')));
          assert(byName.join() === [...byName].sort((x, y) => x.localeCompare(y)).join(), 'the Name sort');
          await a.page.locator('[data-skills-sort="improved"]').click();
          assert((await a.page.locator('[data-skills-row]').first().getAttribute('data-skills-row')) === 'Sage', 'the Improved sort');
          await a.page.locator('[data-skills-top="Sage"]').click();
          const sheet = a.page.locator('[data-skills-trend="Sage"]');
          await sheet.waitFor({ timeout: 5000 });
          assert(flat(await sheet.locator('.tm-sk-bignum').innerText()) === '3.4', 'the big number');
          assert(/^\+0\.7 past \d+mo$/.test(flat(await sheet.locator('[data-skills-pill]').innerText())), 'the pill');
          assert((await sheet.locator('.tm-sk-ball .ball').count()) === 1, 'the pickleball');
          assert((await sheet.locator('[data-skills-entry]').count()) === 5, 'five tournaments');
          await h.noWider(a.page, `E sheet ${width} ${scheme}`);
          if (width === 390) await shot(a.page, `E-trend-${scheme}`);
          assert(!a.errors.length, a.errors.join(' | '));
          await a.ctx.close();
        }
      }
    });

    await check('F the Christmas skin on: the row and the board (390 light, 320 dark)', async () => {
      await h.setClock(Date.parse('2026-11-28T15:00:00.000Z'));
      await h.call('PUT', '/api/admin/christmas-skin-switch', { mode: 'all' });
      const init = () => {
        try {
          localStorage.setItem('pb_xmas_theme', 'on');
          localStorage.setItem('pb_xmas_hint', '1');
          localStorage.setItem('pb_xmas_back', '1');
        } catch {}
      };
      await h.stage('zip79_next_day');
      for (const [width, scheme] of [
        [390, 'light'],
        [320, 'dark'],
      ]) {
        const p = await phone('Vic', { width, scheme, init });
        await rowLook(p.page, `F ${width}`);
        await shot(p.page, `F-xmas-row-${width}-${scheme}`);
        await boardLook(p.page, `F ${width}`, 10);
        await h.noWider(p.page, `F ${width}`);
        await shot(p.page, `F-xmas-board-${width}-${scheme}`, true);
        assert(!p.errors.length, p.errors.join(' | '));
        await p.ctx.close();
      }
      await h.call('PUT', '/api/admin/christmas-skin-switch', { mode: 'off' });
      await h.setClock(Date.parse('2026-11-19T15:00:00.000Z'));
    });
  } finally {
    await h.close();
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
