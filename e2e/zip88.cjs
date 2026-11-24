/* Zip 88 (🎾88.rolling courts): browser checks on a LOCAL copy (the preview's calm world, fixed clock Thu Nov 19, 10 AM Eastern).
 *
 *   node e2e/zip88.cjs                  (ZIP88_ONLY=A,B runs some)
 *
 *   A   Picture 1 (zip88_rd3) at 320/390/420, light and dark: ONE night card (no green banner, no scores box, no folded tournament card, no
 *       dark week row), the bars (RD1 RD2 done, RD3 outlined), Court 1 Done "11 – 7" (winner green and bold), Court 2 Playing with Score,
 *       "1 of 2 in", the round pill and status chip the same height, size and weight, Sitting with one ball per sitter, nothing wider than
 *       the screen, no word cut.
 *   B   Rolling courts on the night: Court 2's Score (the real sheet) brings Round 4 onto both courts at once; tap the score box to fix it;
 *       a sitting player's phone follows within one check.
 *   C   Picture 3 (zip88_final): Locked doubles, FINAL wide and outlined, Final and 3rd place pills, the yellow Play to 7, Standings opens.
 *   D   Pause and Player left ask "Are you sure?" first; No changes nothing; Yes pauses (Resume puts it back); Player left opens Who left?.
 *   E   Picture 2 (zip88_early): the look on the Tournament test page: RD4 purple, the RD4 pill purple, Court 2's yellow Play to 9.
 *   F   A bar opens All rounds at that round.
 *   G   Start now (zip88_ready) at 320/390, light and dark: the pill is a solid green 44 px Start now; "Are you sure?" with two equal buttons;
 *       Not yet changes nothing; Yes: the night card with "0 of 2 in", and a player's phone shows Enter score within one check.
 *   H   Team names: Vic keeps Edit name on the night until Net Ninjas' first game has a score, then it is gone.
 * Screenshots: .data/zip88-shots (not in git).
 */
const path = require('node:path');
const { mkdirSync } = require('node:fs');
const { boot, flat, assert, sleep, ROOT } = require('./zip74-boot.cjs');

const SHOTS = path.join(ROOT, '.data', 'zip88-shots');
const ONLY = process.env.ZIP88_ONLY || '';
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

/** Words broken in the middle inside `sel`, and boxes whose text runs past them. */
const cutOrBroken = (page, sel) =>
  page.evaluate((s) => {
    const out = [];
    for (const el of document.querySelectorAll(s)) {
      if (el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX !== 'visible') out.push(`cut: ${el.className} "${el.textContent.trim().slice(0, 30)}"`);
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

(async () => {
  mkdirSync(SHOTS, { recursive: true });
  const b = await boot({ name: 'zip88', port: Number(process.env.E2E_PORT) || 5488 });
  const dash = () => b.call('GET', '/api/admin/dashboard');
  try {
    await check('A picture 1: the one night card (320/390/420, light and dark)', async () => {
      await b.stage('zip88_rd3');
      for (const width of [320, 390, 420]) {
        for (const scheme of ['light', 'dark']) {
          const { page, ctx, errors } = await b.adminHome({ width, scheme });
          await page.locator('[data-nc]').waitFor({ timeout: 15000 });
          assert((await page.locator('[data-nc]').count()) === 1, 'one night card');
          assert((await page.locator('.tm-gd-hero').count()) === 0, 'no green banner');
          assert((await page.locator('[data-tm-round]').count()) === 0, 'no scores box');
          assert((await page.locator('[data-tm-home-toggle]').count()) === 0, 'no folded tournament card');
          assert((await page.locator('.tour-week-row, [data-tour-row]').count()) === 0, 'no dark week row');
          assert(flat(await page.locator('[data-nc-style]').textContent()) === 'Americano · 10 players', 'style line');
          assert(flat(await page.locator('[data-nc-in]').textContent()) === '1 of 2 in', 'the pill');
          const bars = await page.locator('[data-nc-bar]').evaluateAll((xs) => xs.map((x) => `${x.textContent.trim()}:${x.getAttribute('data-state')}`));
          assert(bars.join(' ') === 'RD1:done RD2:done RD3:now RD4:later RD5:later RD6:later', `bars ${bars.join(' ')}`);
          const c1 = page.locator('[data-nc-court="1"]');
          const c2 = page.locator('[data-nc-court="2"]');
          assert((await c1.getAttribute('data-status')) === 'done' && (await c2.getAttribute('data-status')) === 'playing', 'court 1 done, court 2 playing');
          assert(flat(await c1.locator('[data-nc-fix]').textContent()) === '11 – 7', 'the score box');
          assert((await c1.locator('.nc-win').count()) === 1 && (await c1.locator('.nc-lose').count()) === 1, 'winner and loser');
          assert(flat(await c2.locator('[data-nc-score]').textContent()) === 'Score', 'Score on court 2');
          assert(flat(await c1.locator('[data-nc-to]').textContent()) === 'Play to 11', 'quiet Play to 11');
          for (const c of [c1, c2]) {
            const sz = await c.locator('.nc-pill').evaluateAll((xs) => xs.map((x) => { const s = getComputedStyle(x); return `${x.getBoundingClientRect().height}|${s.fontSize}|${s.fontWeight}`; }));
            assert(sz.length === 2 && sz[0] === sz[1] && sz[0].startsWith('26|'), `pill and chip match: ${sz.join(' / ')}`);
          }
          const sitters = Number(await page.locator('[data-nc-sitting]').getAttribute('data-nc-sitting'));
          assert(sitters === 2 && (await page.locator('[data-nc-sitting] .ball').count()) === 2, 'one ball per sitter');
          await b.noWider(page, `night card ${width} ${scheme}`);
          const bad = await cutOrBroken(page, '[data-nc]');
          assert(!bad.length, `${width} ${scheme}: ${bad.join(', ')}`);
          await page.locator('[data-nc]').screenshot({ path: path.join(SHOTS, `A-rd3-${width}-${scheme}.png`) });
          if (width === 390) await page.screenshot({ path: path.join(SHOTS, `A-home-${width}-${scheme}.png`) });
          assert(!errors.length, errors.join('; '));
          await ctx.close();
        }
      }
    });

    await check('B rolling on the night: Score, fix, and a sitting phone follows', async () => {
      await b.stage('zip88_rd3');
      const d0 = await dash();
      const r0 = d0.tournament.rounds;
      const playing = r0.courtsNow.find((c) => c.num !== null);
      const game = r0.games.find((g) => g.num === playing.num);
      const sitters = r0.sittingNow;
      const { page, ctx, errors } = await b.adminHome({ width: 390 });
      await page.locator('[data-nc-court="2"] [data-nc-score]').click();
      await page.locator('[data-tm-am-fix-sheet]').waitFor();
      await page.locator('[data-tm-am-save]').click();
      await page.locator('[data-tm-am-fix-sheet]').waitFor({ state: 'detached' });
      await page.waitForTimeout(800);
      // Both courts free at once: Round 4 on both courts.
      const pills = await page.locator('[data-nc-pill]').evaluateAll((xs) => xs.map((x) => x.textContent.trim()));
      assert(pills.join(',') === 'RD4,RD4', `Round 4 on both courts: ${pills}`);
      assert(flat(await page.locator('[data-nc-in]').textContent()) === '0 of 2 in', 'new pill');
      const bars = await page.locator('[data-nc-bar]').evaluateAll((xs) => xs.map((x) => x.getAttribute('data-state')));
      assert(bars.slice(0, 4).join(',') === 'done,done,done,now', `bars ${bars}`);
      // A player who sat Round 3 and plays Round 4: their phone shows the game on its court within one check.
      const d1 = await dash();
      const on = d1.tournament.rounds.games.filter((g) => g.status === 'playing');
      const who = sitters.find((n) => on.some((g) => [...g.a.names, ...g.b.names].includes(n)));
      assert(who, `a Round 3 sitter plays Round 4 (${sitters})`);
      void game;
      ctx.close();
      const p = await b.playerPage(who, { width: 390 });
      const kicker = flat(await p.page.locator('.tc-gd-next-kicker').first().textContent());
      assert(/^Round 4 · Court \d+$/.test(kicker), `the sitter's card: ${kicker}`);
      assert((await p.page.locator('[data-tc-enter-score]').count()) === 1, 'Enter score on the sitter');
      await p.ctx.close();
      assert(!errors.length, errors.join('; '));
    });

    await check('C picture 3: Locked doubles at the Final (390 light and dark, 320)', async () => {
      await b.stage('zip88_final');
      for (const [width, scheme] of [[390, 'light'], [390, 'dark'], [320, 'light']]) {
        const { page, ctx, errors } = await b.adminHome({ width, scheme });
        await page.locator('[data-nc]').waitFor({ timeout: 15000 });
        assert(flat(await page.locator('[data-nc-style]').textContent()).startsWith('Locked doubles · '), 'style line');
        const bars = await page.locator('[data-nc-bar]').evaluateAll((xs) => xs.map((x) => `${x.textContent.trim()}:${x.getAttribute('data-state')}`));
        assert(bars[bars.length - 1] === 'FINAL:now' && bars.slice(0, -1).every((x) => x.endsWith(':done')), `bars ${bars}`);
        assert((await page.locator('.nc-wide').count()) === 1, 'FINAL is wider');
        const pills = await page.locator('[data-nc-pill]').evaluateAll((xs) => xs.map((x) => `${x.textContent.trim()}:${x.getAttribute('data-tone')}`));
        assert(pills.join(',') === 'Final:green,3rd place:green', `pills ${pills}`);
        const to = await page.locator('.nc-to-pill').evaluateAll((xs) => xs.map((x) => x.textContent.trim()));
        assert(to.join(',') === 'Play to 7,Play to 7', `yellow Play to 7: ${to}`);
        await b.noWider(page, `final ${width}`);
        const bad = await cutOrBroken(page, '[data-nc]');
        assert(!bad.length, bad.join(', '));
        await page.locator('[data-nc]').screenshot({ path: path.join(SHOTS, `C-final-${width}-${scheme}.png`) });
        if (width === 390 && scheme === 'light') {
          await page.locator('[data-nc-standings]').click();
          await page.locator('[data-tm-ld-standings] [data-sl-row]').first().waitFor();
          assert((await page.locator('[data-tm-ld-standings] [data-sl-row]').count()) >= 4, 'standings rows');
          await page.screenshot({ path: path.join(SHOTS, 'C-standings-390.png') });
        }
        assert(!errors.length, errors.join('; '));
        await ctx.close();
      }
    });

    await check('D Pause and Player left ask first', async () => {
      await b.stage('zip88_rd3');
      const { page, ctx, errors } = await b.adminHome({ width: 390 });
      await page.locator('[data-tm-pause]').click();
      assert(flat(await page.locator('[data-nc-ask]').textContent()).includes('Are you sure?'), 'asks');
      await page.locator('[data-nc-no]').click();
      assert((await dash()).tournament.rounds.paused === false, 'No: not paused');
      await page.locator('[data-tm-pause]').click();
      await page.locator('[data-nc-yes]').click();
      await page.locator('[data-tm-paused]').waitFor();
      assert((await dash()).tournament.rounds.paused === true, 'Yes: paused');
      assert(flat(await page.locator('[data-tm-pause]').textContent()) === 'Resume', 'Resume');
      await page.locator('[data-tm-pause]').click();
      await page.locator('[data-tm-paused]').waitFor({ state: 'detached' });
      await page.locator('[data-tm-player-left]').click();
      await page.locator('[data-nc-yes]').click();
      await page.locator('[data-tm-left-pick]').waitFor();
      assert(!errors.length, errors.join('; '));
      await ctx.close();
    });

    await check('E picture 2: the look on the Tournament test page', async () => {
      const { page, ctx, errors } = await b.adminHome({ width: 390 });
      await page.locator('[data-tm-test-row]').first().click();
      await page.locator('[data-tm-stage="zip88_early"]').click();
      await page.locator('[data-tm88-look] [data-nc]').waitFor({ timeout: 15000 });
      const look = page.locator('[data-tm88-look]');
      assert((await look.locator('[data-nc-bar="r4"]').getAttribute('data-state')) === 'early', 'RD4 purple');
      assert((await look.locator('[data-nc-pill="RD4"]').getAttribute('data-tone')) === 'purple', 'RD4 pill purple');
      assert(flat(await look.locator('[data-nc-court="2"] .nc-to-pill').textContent()) === 'Play to 9', 'yellow Play to 9');
      await look.screenshot({ path: path.join(SHOTS, 'E-early-look-390.png') });
      assert(!errors.length, errors.join('; '));
      await ctx.close();
    });

    await check('F a bar opens All rounds at that round', async () => {
      await b.stage('zip88_rd3');
      const { page, ctx, errors } = await b.adminHome({ width: 390 });
      await page.locator('[data-nc-bar="r2"]').click();
      await page.locator('[data-sb-focus="2"]').waitFor();
      assert((await page.locator('[data-sb-mode="all"]').count()) === 1, 'All');
      assert(!errors.length, errors.join('; '));
      await ctx.close();
    });
    await check('G Start now: the pill, Are you sure?, the night starts, a phone follows', async () => {
      for (const [width, scheme] of [[390, 'light'], [390, 'dark'], [320, 'light']]) {
        await b.stage('zip88_ready');
        const { page, ctx, errors } = await b.adminHome({ width, scheme });
        const btn = page.locator('[data-tm88-start]');
        await btn.waitFor({ timeout: 15000 });
        assert((await page.locator('[data-tm-stage]').count()) === 0, 'no pill beside Start now');
        const look = await btn.evaluate((x) => { const r = x.getBoundingClientRect(); const s = getComputedStyle(x); return { h: r.height, bg: s.backgroundColor, primary: getComputedStyle(document.documentElement).getPropertyValue('--primary').trim() }; });
        assert(look.h >= 44, `Start now ${look.h} px tall`);
        await btn.click();
        const yes = page.locator('[data-tm88-yes]');
        const no = page.locator('[data-tm88-no]');
        const [ry, rn] = [await yes.boundingBox(), await no.boundingBox()];
        assert(Math.abs(ry.width - rn.width) < 1 && Math.abs(ry.height - rn.height) < 1, 'two equal buttons');
        assert(flat(await page.locator('[data-tm88-ask]').textContent()).includes('Are you sure?'), 'asks');
        await b.noWider(page, `ask ${width}`);
        await page.locator('[data-tm88-ask]').screenshot({ path: path.join(SHOTS, `G-ask-${width}-${scheme}.png`) });
        await page.locator('[data-tm-home]').first().screenshot({ path: path.join(SHOTS, `G-card-${width}-${scheme}.png`) });
        await no.click();
        assert((await page.locator('[data-tm88-ask]').count()) === 0, 'Not yet closes it');
        assert(!(await dash()).tournament.startedEarly, 'Not yet: not started');
        if (width === 390 && scheme === 'light') {
          await btn.click();
          await yes.click();
          await page.locator('[data-nc]').waitFor({ timeout: 10000 });
          assert(flat(await page.locator('[data-nc-in]').textContent()) === '0 of 2 in', '0 of 2 in');
          assert((await page.locator('[data-tm88-start]').count()) === 0, 'Start now gone');
          await page.locator('[data-nc]').screenshot({ path: path.join(SHOTS, 'G-started-390.png') });
          const d = (await dash()).tournament.day;
          const who = d.games.find((g) => g.num === d.courtsNow[0].num).a.players[0];
          const p = await b.playerPage(who, { width: 390 });
          await p.page.locator('[data-tc-enter-score]').waitFor({ timeout: 6000 });
          await p.ctx.close();
        }
        assert(!errors.length, errors.join('; '));
        await ctx.close();
      }
    });

    await check('H team names: Edit name on the night until the first score', async () => {
      await b.stage('zip88_ready');
      await b.call('POST', `/api/admin/tournament/${(await dash()).tournament.id}/games`, { action: 'start' });
      const p = await b.playerPage('Vic', { width: 390 });
      await p.page.locator('[data-tc-day="night"]').waitFor({ timeout: 15000 });
      const edit = p.page.locator('button', { hasText: 'Edit name' });
      assert((await edit.count()) === 1, 'Edit name on the night');
      await p.page.screenshot({ path: path.join(SHOTS, 'H-vic-night-390.png') });
      const d = (await dash()).tournament.day;
      const g = d.games.find((x) => x.a?.players.includes('Vic') || x.b?.players.includes('Vic'));
      const vic = await b.phone('Vic');
      const r = await vic.post('/api/tournament/game', { tournamentId: (await dash()).tournament.id, num: g.num, action: 'score', mine: 11, theirs: 6 });
      assert(r.ok, `score ${r.status} ${JSON.stringify(r.body)}`);
      await p.page.waitForTimeout(6500);
      assert((await p.page.locator('button', { hasText: 'Edit name' }).count()) === 0, 'Edit name gone after the first score');
      await p.ctx.close();
    });
  } finally {
    await b.close();
    console.log(`\nzip88: ${passed} passed, ${failed} failed`);
    await sleep(100);
    process.exit(failed ? 1 : 0);
  }
})();
