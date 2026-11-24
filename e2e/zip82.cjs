/* Zip 82 (🎾82.night admin) in a real browser.
 *
 *   node e2e/zip82.cjs            (ZIP82_ONLY=<letter> runs one check)
 *
 * The world is the preview's calm profile (e2e/zip74-boot.cjs), then the Tournament test stages.
 *   A  Standings during the night (am_round3, picture 2): the Standings link next to All rounds opens "Standings", "After Round 2. Only you see
 *      this until the reveal.", 10 rows, the gold medal on 1st only, no name cut; 320/390/420, light and dark; no page wider than the screen.
 *   B  All rounds as a scoreboard (picture 4): it opens on "Needs a score · 2"; each card has Court, the Playing chip and Enter score; Enter
 *      score opens "Set · Round 3 · Court N" at 11 to 0; Save: the sheet is still open where it was, the card now says Done with Fix and its
 *      score (the winner's number green); All shows every round with "Sitting:" lines and Done cards with Fix.
 *   C  All games, Locked doubles (picture 3): the tie game stage: Game A · Court N (Playing, Enter score), Game B (Up next, no button); team
 *      names with their two players under them; 320/390/420, light and dark.
 *   D  The End card (picture 1): Americano last round in: "Only you see this until the reveal.", every player, the gold on 1st; Edit awards:
 *      "Tickets $... − courts $... = $... left.", "Suggested: ...", Use these fills the boxes; Locked doubles Final done: the teams with
 *      their players, 2nd place rows.
 *   E  The price check: the tournament card's Time box shows "After full prizes: ..." next to the money line.
 *   F  Tap a medal (pictures 5 and 6): History stage. Parker's own medal at the top: "Your wins", Spring Fling; Vic: 2 rows, newest first;
 *      the tap area is 44 x 44 and the layout did not move; the winners ticker's medals are not buttons. Organizer History > Tournaments: tap
 *      Vic's medals: "Vic’s wins".
 * Screenshots: .data/zip82-shots (not in git).
 */
const path = require('node:path');
const { mkdirSync } = require('node:fs');
const { boot, flat, assert, ROOT } = require('./zip74-boot.cjs');

const SHOTS = path.join(ROOT, '.data', 'zip82-shots');
const ONLY = process.env.ZIP82_ONLY || '';
const NOW = Date.parse('2026-11-19T15:00:00.000Z');
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
    console.log(`  FAIL  ${name}\n        ${String(err && err.stack ? err.stack : err).split('\n').slice(0, 5).join('\n        ')}`);
  }
}
const SIZES = [320, 390, 420].flatMap((width) => ['light', 'dark'].map((scheme) => ({ width, scheme })));

(async () => {
  mkdirSync(SHOTS, { recursive: true });
  const h = await boot({ port: Number(process.env.E2E_PORT) || 5482, name: 'zip82', nowMs: NOW });
  const shot = (page, name, full = false) => page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: full });
  /** The title of the open sheet holding `inner` (two sheets can be open: the score sheet over the scoreboard). */
  const titleOf = async (page, inner = '') => (await page.locator(inner ? `dialog[open]:has(${inner})` : 'dialog[open]').last().locator('h2').first().innerText()).trim();
  /** Nothing in the box ends in "…" or is cut (scrollWidth over clientWidth on a one-line name). */
  const noCut = async (loc, what) => {
    const cut = await loc.evaluateAll((els) => els.filter((e) => e.scrollWidth > e.clientWidth + 1 || /…$/.test(e.textContent || '')).map((e) => e.textContent));
    assert(cut.length === 0, `${what}: cut ${cut.join(', ')}`);
  };

  await check('A Standings during the night', async () => {
    await h.stage('am_round3');
    for (const { width, scheme } of SIZES) {
      const a = await h.adminHome({ width, scheme });
      const link = a.page.locator('[data-tm-am-standings]');
      await link.waitFor({ timeout: 15000 });
      const box = await link.boundingBox();
      assert(box.height >= 44, `Standings link ${box.height} px tall`);
      await link.click();
      await a.page.locator('[data-sl="night"]').waitFor({ timeout: 5000 });
      assert((await titleOf(a.page)) === 'Standings', 'title');
      const note = await a.page.locator('[data-sl-note]').innerText();
      assert(note === 'After Round 2. Only you see this until the reveal.', `note: ${note}`);
      const rows = a.page.locator('[data-sl="night"] [data-sl-row]');
      assert((await rows.count()) === 10, `rows ${await rows.count()}`);
      assert((await a.page.locator('[data-sl="night"] .sl-medal').count()) === 1, 'one medal');
      assert((await rows.first().locator('.sl-medal').count()) === 1, 'the medal on 1st');
      await noCut(a.page.locator('[data-sl="night"] .sl-name b'), 'names');
      const chips = (await a.page.locator('[data-sl="night"] .sl-chip').allInnerTexts()).map(flat);
      assert(chips.every((c) => /^\d+ pts$/.test(c)), `chips ${chips}`);
      await h.noWider(a.page, `standings ${width} ${scheme}`);
      if (width === 390) await shot(a.page, `A-standings-${scheme}`);
      assert(!a.errors.length, a.errors.join('; '));
      await a.ctx.close();
    }
  });

  await check('B All rounds scoreboard', async () => {
    await h.stage('am_round3');
    const a = await h.adminHome({ width: 390 });
    await a.page.locator('[data-tm-am-all]').first().click();
    const sb = a.page.locator('[data-sb="am"]');
    await sb.waitFor({ timeout: 5000 });
    assert((await sb.getAttribute('data-sb-mode')) === 'needs', 'opens on Needs a score');
    const needsBtn = a.page.locator('[data-sb-needs]');
    assert((await needsBtn.innerText()).trim() === 'Needs a score · 2', `switch: ${await needsBtn.innerText()}`);
    assert((await needsBtn.getAttribute('aria-pressed')) === 'true', 'Needs pressed');
    const cards = sb.locator('[data-sb-game]');
    assert((await cards.count()) === 2, `needs cards ${await cards.count()}`);
    const first = cards.first();
    assert((await first.getAttribute('data-status')) === 'playing', 'playing');
    assert(/^Court \d+$/.test((await first.locator('.sb-where b').innerText()).trim()), 'Court N');
    assert((await first.locator('.sb-chip').innerText()).trim() === 'Playing', 'chip');
    const enter = first.locator('[data-sb-enter]');
    assert(((await enter.boundingBox()).height) >= 44, 'Enter score 44 px');
    await shot(a.page, 'B-needs-light');
    const num = await first.getAttribute('data-sb-game');
    await enter.click();
    await a.page.locator(`[data-tm-am-fix-sheet="${num}"]`).waitFor({ timeout: 5000 });
    const t = await titleOf(a.page, `[data-tm-am-fix-sheet="${num}"]`);
    assert(/^Set · Round 3 · Court \d+$/.test(t), `fix title ${t}`);
    assert((await a.page.locator('[data-tm-am-num="a"]').innerText()).trim() === '11' && (await a.page.locator('[data-tm-am-num="b"]').innerText()).trim() === '0', '11 to 0');
    await a.page.locator('[data-tm-am-minus="a"]').click();
    for (let i = 0; i < 4; i++) await a.page.locator('[data-tm-am-plus="b"]').click();
    await a.page.locator('[data-tm-am-save]').click();
    await a.page.locator(`[data-tm-am-fix-sheet="${num}"]`).waitFor({ state: 'detached', timeout: 8000 });
    // The scoreboard is still open, on Needs a score, and the card updated in place.
    await a.page.waitForTimeout(800);
    assert((await sb.isVisible()) && (await sb.getAttribute('data-sb-mode')) === 'needs', 'still on Needs a score');
    const card = sb.locator(`[data-sb-game="${num}"]`);
    await a.page.waitForFunction((n) => document.querySelector(`[data-sb-game="${n}"]`)?.getAttribute('data-status') === 'done', num, { timeout: 8000 });
    assert((await card.locator('[data-sb-fix]').count()) === 1, 'Fix now');
    const scores = (await card.locator('.sb-score').allInnerTexts()).map(flat);
    assert(scores.join('-') === '10-4', `scores ${scores}`);
    const win = await card.locator('.sb-score.sb-win').innerText();
    assert(win.trim() === '10', 'the winner green');
    assert((await needsBtn.innerText()).trim() === 'Needs a score · 1', 'count down to 1');
    // All: every round, Done cards with Fix, sitting lines.
    await a.page.locator('[data-sb-all]').click();
    assert((await sb.getAttribute('data-sb-mode')) === 'all', 'All');
    assert((await sb.locator('[data-sb-round]').count()) >= 6, 'six rounds');
    assert((await sb.locator('[data-sb-round="1"] [data-sb-fix]').count()) >= 1, 'round 1 Fix');
    assert((await sb.locator('[data-sb-sits]').count()) >= 1, 'Sitting lines');
    assert(/^Sitting: /.test(await sb.locator('[data-sb-sits]').first().innerText()), 'Sitting words');
    assert((await sb.locator('[data-status="next"] .sb-btn').count()) === 0, 'Up next has no button');
    assert((await sb.locator('[data-status="next"] .sb-chip').first().innerText()).trim() === 'Up next', 'Up next chip');
    await shot(a.page, 'B-all-light');
    assert(!a.errors.length, a.errors.join('; '));
    await a.ctx.close();
    for (const { width, scheme } of SIZES) {
      const b = await h.adminHome({ width, scheme });
      await b.page.locator('[data-tm-am-all]').first().click();
      await b.page.locator('[data-sb="am"]').waitFor({ timeout: 5000 });
      await b.page.locator('[data-sb-all]').click();
      await noCut(b.page.locator('.sb-names b'), 'pairs');
      await h.noWider(b.page, `all rounds ${width} ${scheme}`);
      if (width === 390 && scheme === 'dark') await shot(b.page, 'B-all-dark');
      await b.ctx.close();
    }
  });

  await check('C All games, Locked doubles (tie game)', async () => {
    await h.stage('zip82_tie');
    for (const { width, scheme } of SIZES) {
      const a = await h.adminHome({ width, scheme });
      await a.page.locator('[data-tm-all-games]').first().click();
      const sb = a.page.locator('[data-sb="ld"]');
      await sb.waitFor({ timeout: 5000 });
      assert((await sb.getAttribute('data-sb-mode')) === 'needs', 'opens on Needs');
      const heads = (await sb.locator('.sb-where b').allInnerTexts()).map(flat);
      assert(heads.some((x) => /^Game A · Court \d+$/.test(x)), `Game A: ${heads}`);
      const ga = sb.locator('[data-sb-game]').filter({ hasText: 'Game A' }).first();
      assert((await ga.locator('[data-sb-enter]').count()) === 1, 'Game A Enter score');
      assert((await ga.locator('.sb-names span').count()) === 2, 'players under the team names');
      await a.page.locator('[data-sb-all]').click();
      const gb = sb.locator('[data-sb-game]').filter({ hasText: 'Game B' }).first();
      assert((await gb.getAttribute('data-status')) === 'next' && (await gb.locator('.sb-btn').count()) === 0, 'Game B Up next, no button');
      assert((await sb.locator('[data-status="done"] [data-sb-fix]').count()) >= 6, 'pool games Done with Fix');
      await noCut(sb.locator('.sb-names b'), 'team names');
      await h.noWider(a.page, `all games ${width} ${scheme}`);
      if (width === 390) await shot(a.page, `C-all-games-${scheme}`);
      assert(!a.errors.length, a.errors.join('; '));
      await a.ctx.close();
    }
  });

  await check('D The End card and Edit awards', async () => {
    await h.stage('am_done');
    for (const { width, scheme } of SIZES) {
      const a = await h.adminHome({ width, scheme });
      const end = a.page.locator('[data-tm-end]');
      await end.waitFor({ timeout: 15000 });
      const list = end.locator('[data-sl="end"]');
      assert((await list.locator('[data-sl-note]').innerText()) === 'Only you see this until the reveal.', 'note');
      const n = await list.locator('[data-sl-row]').count();
      assert(n >= 9, `rows ${n}`);
      assert((await list.locator('.sl-medal').count()) === 1, 'one medal');
      // The list sits between the header and the prize rows.
      const order = await end.evaluate((el) => [...el.querySelectorAll('[data-tm-edit-awards], [data-sl="end"], [data-tm-end-row="first"]')].map((x) => x.getAttribute('data-sl') || x.getAttribute('data-tm-end-row') || 'edit'));
      assert(order.join(',') === 'edit,end,first', `order ${order}`);
      const firstName = (await list.locator('[data-sl-row]').first().locator('.sl-name b').innerText()).trim();
      const firstRow = (await end.locator('[data-tm-end-row="first"] .tm-end-val b').innerText()).trim();
      assert(firstName === firstRow, `${firstName} vs ${firstRow}`);
      await noCut(list.locator('.sl-name b'), 'names');
      await h.noWider(a.page, `end ${width} ${scheme}`);
      if (width === 390) {
        await end.scrollIntoViewIfNeeded();
        await shot(a.page, `D-end-am-${scheme}`);
      }
      if (width === 390 && scheme === 'light') {
        await a.page.locator('[data-tm-edit-awards]').click();
        const sug = a.page.locator('[data-tm-suggest]');
        await sug.waitFor({ timeout: 5000 });
        const left = await a.page.locator('[data-tm-suggest-left]').innerText();
        assert(/^Tickets \$\d+ − courts \$\d+ = \$\d+ (left|short)\.$/.test(left), `left: ${left}`);
        const words = await a.page.locator('[data-tm-suggest-words]').innerText();
        assert(/^Suggested: (full prizes \(1st \$14 · 2nd \$7 each\)|1st only \(\$14 each\)|medals only)$/.test(words), `words: ${words}`);
        // Change the boxes, then Use these puts the suggestion back.
        await a.page.locator('[data-tm-award-money="champion"]').fill('5');
        await a.page.locator('[data-tm-suggest-use]').click();
        const tier = await sug.getAttribute('data-tm-suggest');
        const want = tier === 'full' ? ['14', '7'] : tier === 'first' ? ['14', '0'] : ['0', '0'];
        assert((await a.page.locator('[data-tm-award-money="champion"]').inputValue()) === want[0], 'champion filled');
        assert((await a.page.locator('[data-tm-award-money="second"]').inputValue()) === want[1], 'second filled');
        assert((await a.page.locator('[data-tm-suggest-use]').innerText()).trim() === 'Using these', 'Using these');
        await shot(a.page, 'D-edit-awards-light');
      }
      assert(!a.errors.length, a.errors.join('; '));
      await a.ctx.close();
    }
    await h.stage('final_done');
    for (const scheme of ['light', 'dark']) {
      const a = await h.adminHome({ width: 390, scheme });
      const end = a.page.locator('[data-tm-end]');
      await end.waitFor({ timeout: 15000 });
      const list = end.locator('[data-sl="end"]');
      assert((await list.locator('[data-sl-row]').count()) === 4, 'four teams');
      assert((await list.locator('[data-sl-row]').first().locator('.sl-medal').count()) === 1, 'gold on the winners');
      assert((await list.locator('.sl-players').count()) === 4, 'players under each team');
      assert((await end.locator('[data-tm-end-row="second"]').count()) === 1 && (await end.locator('[data-tm-end-row="second-credit"]').count()) === 1, '2nd place rows');
      await end.scrollIntoViewIfNeeded();
      await shot(a.page, `D-end-ld-${scheme}`);
      await a.ctx.close();
    }
  });

  await check('E The price check on the money line', async () => {
    await h.stage('zip70_start');
    const a = await h.adminHome({ width: 390 });
    await a.page.locator('[data-tm-home-toggle]').waitFor({ timeout: 15000 });
    await a.page.locator('[data-tm-home-toggle]').click();
    await a.page.locator('[data-tm-home-body]').waitFor({ timeout: 10000 });
    await a.page.locator('[data-tm-time-toggle]').click();
    const after = a.page.locator('[data-tm-after-full]').first();
    await after.waitFor({ timeout: 5000 });
    const text = (await after.innerText()).trim();
    assert(/^After full prizes: (\+\$\d+|\$\d+ short)$/.test(text), `after: ${text}`);
    const cents = Number(await after.getAttribute('data-tm-after-full'));
    const color = await after.evaluate((el) => getComputedStyle(el).color);
    const red = await a.page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--danger-fg'));
    if (cents < 0) assert(red.trim() && color !== 'rgb(0, 0, 0)', 'short is red');
    await shot(a.page, 'E-money-line');
    assert(!a.errors.length, a.errors.join('; '));
    await a.ctx.close();
  });

  await check('F Tap a medal', async () => {
    await h.stage('history');
    for (const { width, scheme } of SIZES) {
      const p = await h.playerPage('Parker', { width, scheme });
      const btn = p.page.locator('[data-medals-btn="Parker"]').first();
      await btn.waitFor({ timeout: 15000 });
      assert((await btn.getAttribute('aria-label')) === 'Your wins, 1 medal', `label ${await btn.getAttribute('aria-label')}`);
      // The 44 x 44 tap area: points 20 px out from the medal's middle land on the button.
      const box = await btn.boundingBox();
      const cx = box.x + box.width / 2;
      const cy = box.y + box.height / 2;
      for (const [dx, dy] of [
        [0, -20],
        [0, 20],
      ]) {
        const hit = await p.page.evaluate(([x, y]) => !!document.elementFromPoint(x, y)?.closest('[data-medals-btn]'), [cx + dx, cy + dy]);
        assert(hit, `tap area at ${dx},${dy}`);
      }
      await btn.click();
      await p.page.locator('[data-ws-list]').waitFor({ timeout: 8000 });
      assert((await titleOf(p.page)) === 'Your wins', 'Your wins');
      const rows = (await p.page.locator('[data-ws-row] b').allInnerTexts()).map(flat);
      assert(rows.join() === 'Spring Fling', `rows ${rows}`);
      const sub = (await p.page.locator('[data-ws-row] .ws-text span').first().innerText()).trim();
      assert(/^[A-Z][a-z]{2} [A-Z][a-z]{2} \d{1,2}, \d{4} · Americano$/.test(sub), `sub ${sub}`);
      await h.noWider(p.page, `wins ${width} ${scheme}`);
      if (width === 390) await shot(p.page, `F-your-wins-${scheme}`);
      // The ticker's medals stay a picture.
      assert((await p.page.locator('[data-tour-ticker] [data-medals-btn]').count()) === 0, 'ticker not tappable');
      assert(!p.errors.length, p.errors.join('; '));
      await p.ctx.close();
    }
    // Vic's own: two wins, newest first, Locked doubles names the partner.
    const v = await h.playerPage('Vic', { width: 390 });
    await v.page.locator('[data-medals-btn="Vic"]').first().click();
    await v.page.locator('[data-ws-list]').waitFor({ timeout: 8000 });
    const vic = (await v.page.locator('[data-ws-row] b').allInnerTexts()).map(flat);
    assert(vic[0] === 'The Cold Open' && vic.length === 2, `Vic rows ${vic}`);
    assert(/Locked doubles with Wren$/.test(await v.page.locator('[data-ws-row] .ws-text span').first().innerText()), 'partner');
    await v.ctx.close();
    // The organizer: History > Tournaments, Vic's medals.
    const a = await h.adminHome({ width: 390 });
    await a.page.locator('.tab-bar button, .tabbar button', { hasText: 'History' }).first().click();
    const chip = a.page.locator('button', { hasText: 'Tournaments' }).first();
    await chip.waitFor({ timeout: 10000 });
    await chip.click();
    const mb = a.page.locator('[data-th-win="Vic"] [data-medals-btn="Vic"]');
    await mb.waitFor({ timeout: 10000 });
    assert((await mb.getAttribute('aria-label')) === 'Vic’s wins, 2 medals', 'History label');
    await mb.click();
    await a.page.locator('[data-ws-list]').waitFor({ timeout: 8000 });
    assert((await titleOf(a.page)) === 'Vic’s wins', 'title');
    assert((await a.page.locator('[data-ws-row]').count()) === 2, 'two rows');
    await shot(a.page, 'F-admin-history-wins');
    assert(!a.errors.length, a.errors.join('; '));
    await a.ctx.close();
  });

  console.log(`\nzip82: ${passed} passed, ${failed} failed`);
  await h.close();
  process.exit(failed ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
