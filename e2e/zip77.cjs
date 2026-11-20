/* Zip 77 (🎾77.reveal): Americano's hidden standings, the standings reveal and the game night fixes, in a real browser.
 *
 *   node e2e/zip77.cjs            (ZIP77_ONLY=<letter> runs one check)
 *
 * The world is the preview's calm profile as of Thu Nov 19 2026, 10:00 AM Eastern (e2e/zip74-boot.cjs), and the Tournament test stages.
 *   A  picture 1: the last round: Vic sees no Standings card, the one line at the bottom; Your rounds and Currently playing stay; the API answer
 *      has no table. 320/390/420, light and dark.
 *   B  picture 2: all games in: no kicker, the bar a 3 px divider, "Final standings coming soon" on one line at 390 with three bouncing balls;
 *      the phone checks every 2 s with nobody touching it. Organizer Home: Edit awards and "Reveal standings".
 *   C  the reveal, synced: Vic and Parker (Parker's clock 40 s wrong) waiting; Alex taps Reveal standings; Zoe opens mid-reveal. Every place
 *      lands on all phones within 0.3 s; the countdown starts on both together; the order is the saved one, Vic 1st with the gold medal and YOU;
 *      no money on the board; nothing tells the winner at the top of Home until the hold ends; the X; X folds it away; the final standings card.
 *   D  after: a phone that opens after it finished sees the final board once (X), the next load does not; reduced motion: no rays, sparks or
 *      shake, the same timing.
 *   E  Back closes sheets: the player's score sheet (Back, X, Escape, the backdrop), the organizer's tabs (Back to the last tab), a sheet on a
 *      tab, never leaving the site while a sheet is open.
 *   F  the Up next card's contrast (lime and white pass AA), the Court link's 44 px tap area, the tournament card's links 44 px, "Set · Round 6".
 *   G  the Christmas skin on (Nov 28, Everyone, the theme on): the waiting card and the final board look right; 320 px no sideways scroll.
 * Screenshots: .data/zip77-shots (not in git).
 */
const path = require('node:path');
const { mkdirSync } = require('node:fs');
const { boot, flat, assert, sleep, ROOT } = require('./zip74-boot.cjs');

const SHOTS = path.join(ROOT, '.data', 'zip77-shots');
const ONLY = process.env.ZIP77_ONLY || '';
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

/** Records, in each page, the real wall time (not the page's Date) when each board row comes in and when the countdown first shows. */
const RECORDER = () => {
  window.__rv = {};
  const now = () => performance.timeOrigin + performance.now();
  const look = () => {
    const c = document.querySelector('.tc-rv-count');
    if (c && c.style.display !== 'none' && !('count' in window.__rv)) window.__rv.count = now();
    document.querySelectorAll('.tc-rv-row').forEach((li) => {
      const p = li.dataset.p;
      if (li.dataset.in === '1' && !(p in window.__rv)) window.__rv[p] = now();
    });
  };
  const start = () => new MutationObserver(look).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-in', 'style'] });
  if (document.documentElement) start();
  else document.addEventListener('DOMContentLoaded', start);
};

(async () => {
  mkdirSync(SHOTS, { recursive: true });
  const h = await boot({ port: Number(process.env.E2E_PORT) || 5477, name: 'zip77' });
  const shot = (page, name, full = false) => page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: full });
  /** A player's phone with extra set-up before the page loads (`init`), its own motion setting and clock skew. */
  async function phone(who, { width = 390, scheme = 'light', reducedMotion = 'no-preference', skewMs = 0, init = null } = {}) {
    const p = await h.newPage({ width, scheme, reducedMotion });
    if (skewMs) await p.ctx.addInitScript((d) => {
      const N = Date.now.bind(Date);
      Date.now = () => N() + d;
    }, skewMs);
    await p.ctx.addInitScript(RECORDER);
    if (init) await p.ctx.addInitScript(init);
    const versions = [];
    p.page.on('request', (r) => {
      if (r.url().includes('/api/group/version')) versions.push(Date.now());
    });
    await p.page.goto(`${h.BASE}/?as=${encodeURIComponent(who)}`);
    await p.page.locator('.schedule, [data-tc-day]').first().waitFor({ timeout: 30000 });
    return { ...p, versions };
  }

  try {
    await check('A picture 1: the last round: no Standings card, the line at the bottom, Your rounds and Currently playing; no table in the answer', async () => {
      await h.stage('zip77_last');
      for (const width of [320, 390, 420]) {
        for (const scheme of ['light', 'dark']) {
          const p = await phone('Vic', { width, scheme });
          const page = p.page;
          await page.locator('[data-tc-standings-later]').waitFor({ timeout: 15000 });
          assert((await page.locator('[data-tc-day-standings]').count()) === 0, 'a Standings card shows');
          assert(flat(await page.locator('[data-tc-standings-later]').innerText()) === 'Standings will be revealed at the end of the night.', 'the line');
          assert((await page.locator('[data-tc-rounds]').count()) === 1, 'Your rounds');
          assert((await page.locator('[data-tc-day-live]').count()) === 1, 'Currently playing');
          const css = await page.locator('[data-tc-standings-later]').evaluate((el) => ({ align: getComputedStyle(el).textAlign, color: getComputedStyle(el).color }));
          assert(css.align === 'center', 'centered');
          await h.noWider(page, `A ${width} ${scheme}`);
          assert(!p.errors.length, p.errors.join(' | '));
          if (width === 390) await shot(page, `A-last-${scheme}`, true);
          await p.ctx.close();
        }
      }
      const vic = await h.phone('Vic');
      const g = await vic.group();
      const text = JSON.stringify(g.tournament);
      assert(Array.isArray(g.tournament.day.standings) && g.tournament.day.standings.length === 0, 'standings sent');
      assert(!/"points"|"record"|"rank"/.test(text), 'the answer names points, records or ranks');
      await vic.ctx.close();
    });

    await check('B picture 2: all games in: no kicker, a 3 px divider, the coming soon card (one line at 390, 3 balls), a check every 2 s; Reveal standings on Home', async () => {
      await h.stage('zip77_allin');
      for (const scheme of ['light', 'dark']) {
        for (const width of [320, 390, 420]) {
          const p = await phone('Vic', { width, scheme });
          const page = p.page;
          await page.locator('[data-tc-waiting]').waitFor({ timeout: 15000 });
          assert((await page.locator('.tc-gd-kicker').count()) === 0, 'a kicker shows');
          const bar = await page.locator('.tc-rv-divider').evaluate((el) => ({ h: el.getBoundingClientRect().height, bg: getComputedStyle(el).backgroundColor }));
          assert(Math.round(bar.h) === 3 && /255, 255, 255, 0\.16/.test(bar.bg), `divider ${JSON.stringify(bar)}`);
          const title = page.locator('.tc-rv-wait-title');
          assert(flat(await title.innerText()) === 'Final standings coming soon', 'the words');
          const lines = await title.evaluate((el) => Math.round(el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight)));
          if (width >= 390) assert(lines === 1, `${lines} lines at ${width}`);
          assert((await page.locator('[data-tc-waiting] .ball').count()) === 3, 'three balls');
          assert((await page.locator('[data-tc-day-standings]').count()) === 0, 'Standings card');
          await h.noWider(page, `B ${width} ${scheme}`);
          if (width === 390) {
            await shot(page, `B-allin-${scheme}`);
            // Nobody touches the phone: still a check every 2 seconds.
            const n0 = p.versions.length;
            await sleep(8200);
            const n = p.versions.length - n0;
            assert(n >= 3 && n <= 5, `${n} checks in 8 s`);
          }
          assert(!p.errors.length, p.errors.join(' | '));
          await p.ctx.close();
        }
      }
      const a = await h.adminHome();
      const btn = a.page.locator('[data-tm-reveal]');
      await btn.waitFor({ timeout: 15000 });
      assert(flat(await btn.innerText()) === 'Reveal standings', 'the button');
      assert((await a.page.locator('[data-tm-edit-awards]').count()) === 1, 'Edit awards');
      await shot(a.page, 'B-admin');
      await a.ctx.close();
    });

    await check('C the reveal, synced: two phones (one clock 40 s off) and one opened mid-reveal land every place within 0.3 s; the hold; X; the final standings', async () => {
      await h.stage('zip77_allin');
      const vic = await phone('Vic');
      const parker = await phone('Parker', { skewMs: 40_000, scheme: 'dark' });
      await vic.page.locator('[data-tc-waiting]').waitFor();
      await parker.page.locator('[data-tc-waiting]').waitFor();
      await sleep(2500);
      const a = await h.adminHome();
      await a.page.locator('[data-tm-reveal]').click();
      const tapped = Date.now();
      // Mid-reveal: Zoe opens 13 s after the tap (about 4th to 5th place).
      await sleep(13_000);
      const zoe = await phone('Zoe');
      const zoeOpen = Date.now();
      await zoe.page.locator('[data-tc-reveal]').waitFor({ timeout: 10000 });
      await sleep(3000);
      await shot(vic.page, 'C-mid-vic');
      await shot(zoe.page, 'C-mid-zoe');
      // Until the hold ends, nothing at the top of Home tells the winner (the ticker, the card, the medal, the credit).
      for (const p of [vic, parker, zoe]) {
        assert((await p.page.locator('[data-tour-ticker]').count()) === 0, 'the ticker shows during the reveal');
        assert((await p.page.locator('[data-medals]').count()) === 0, 'a medal shows during the reveal');
        assert(!(await p.page.locator('body').innerText()).includes('You won The Cold Open'), 'the congratulations show during the reveal');
      }
      await sleep(Math.max(0, tapped + 31_000 - Date.now()));
      const rv = {};
      for (const [n, p] of [['vic', vic], ['parker', parker], ['zoe', zoe]]) rv[n] = await p.page.evaluate(() => window.__rv);
      const rows = await vic.page.locator('.tc-rv-row').count();
      assert(rows === 10, `${rows} rows`);
      // Countdown together (the two that waited).
      assert(Math.abs(rv.vic.count - rv.parker.count) <= 300, `countdown ${Math.round(rv.vic.count - rv.parker.count)} ms apart`);
      assert(Math.abs(rv.vic.count - (tapped + 3000)) < 2600, `countdown ${Math.round(rv.vic.count - tapped)} ms after the tap`);
      const spread = [];
      for (let place = 1; place <= rows; place++) {
        const xs = [rv.vic[place], rv.parker[place]];
        assert(xs.every((x) => typeof x === 'number'), `place ${place} never came in`);
        // Zoe opened mid-reveal: places that came in after she had the clock compare too; the earlier ones were simply there.
        if (rv.vic[place] > zoeOpen + 1500) xs.push(rv.zoe[place]);
        const d = Math.max(...xs) - Math.min(...xs);
        spread.push(Math.round(d));
        assert(d <= 300, `place ${place}: ${Math.round(d)} ms apart`);
      }
      console.log(`        places land within ${Math.max(...spread)} ms across the phones (${spread.join(', ')})`);
      // The timeline: last place 6 s after T0, 1st 24.6 s after T0 (10 players), about 3 s after the tap.
      const t0 = rv.vic.count;
      console.log(`        last place ${((rv.vic[10] - t0) / 1000).toFixed(2)} s, 1st ${((rv.vic[1] - t0) / 1000).toFixed(2)} s after the countdown started`);
      assert(Math.abs(rv.vic[10] - t0 - 6000) < 250 && Math.abs(rv.vic[1] - t0 - 24600) < 250, 'the timeline');
      // The order and the look: Vic 1st (the gold row with the medal), YOU on his own row, no money anywhere on the board.
      const first = vic.page.locator('.tc-rv-row[data-p="1"]');
      assert((await first.getAttribute('data-tc-reveal-row')) === 'Vic', 'Vic is not 1st');
      assert(await first.evaluate((el) => el.classList.contains('tc-rv-gold')), 'not gold');
      assert(await first.locator('.tc-rv-md svg').isVisible(), 'the medal');
      assert((await vic.page.locator('.tc-rv-row[data-p="1"] .tc-rv-you').count()) === 1, 'YOU on Vic');
      assert((await parker.page.locator('.tc-rv-you').count()) === 1, 'YOU on Parker');
      assert(!/\$/.test(await vic.page.locator('[data-tc-board]').innerText()), 'money on the board');
      await shot(vic.page, 'C-final-vic');
      await shot(parker.page, 'C-final-parker-dark');
      // The X is in; it folds the board away; the final standings card follows (no Live chip).
      const x = vic.page.locator('[data-tc-reveal-x]');
      assert(await x.isVisible(), 'the X');
      await x.click();
      await vic.page.locator('[data-tc-day-standings]').waitFor({ timeout: 3000 });
      assert((await vic.page.locator('[data-tc-board]').count()) === 0, 'the board stays');
      assert((await vic.page.locator('[data-tc-day-stand]').count()) === 10, 'the final standings');
      assert((await vic.page.locator('.tc-gd-live').count()) === 0, 'a Live chip');
      // After the hold, the ticker and the congratulations come (the next check).
      await sleep(Math.max(0, tapped + 45_000 - Date.now()));
      const body = await vic.page.locator('body').innerText();
      assert(body.includes('You won The Cold Open'), 'the congratulations');
      assert((await vic.page.locator('[data-tour-ticker]').count()) === 1, 'the ticker');
      await shot(vic.page, 'C-after-x', true);
      for (const p of [vic, parker, zoe]) assert(!p.errors.length, p.errors.join(' | '));
      for (const p of [vic, parker, zoe, a]) await p.ctx.close();
    });

    await check('D after: opened after it finished: the final board once (X), the next load the standings card; reduced motion: no rays, sparks or shake, same timing', async () => {
      await h.stage('zip77_revealed');
      for (const scheme of ['light', 'dark']) {
        const p = await phone('Vic', { scheme });
        await p.page.locator('[data-tc-board]').waitFor({ timeout: 15000 });
        await sleep(600);
        assert(await p.page.locator('[data-tc-reveal-x]').isVisible(), 'the X');
        assert((await p.page.locator('.tc-rv-row.tc-rv-gold').count()) === 1, 'the gold row');
        await shot(p.page, `D-after-${scheme}`, true);
        // Names never cut, never split inside a word (320 px, the narrowest phone).
        await p.page.setViewportSize({ width: 320, height: 844 });
        await sleep(400);
        const split = await p.page.evaluate(() => {
          const bad = [];
          for (const el of document.querySelectorAll('.tc-rv-name')) {
            const node = el.firstChild;
            const text = node.textContent;
            let at = 0;
            for (const word of text.split(' ')) {
              const r = document.createRange();
              r.setStart(node, at);
              r.setEnd(node, at + word.length);
              if (new Set([...r.getClientRects()].map((x) => Math.round(x.top))).size > 1) bad.push(word);
              at += word.length + 1;
            }
            if (el.scrollWidth > el.clientWidth + 1) bad.push(`${text} (cut)`);
          }
          return bad;
        });
        assert(!split.length, `split or cut at 320: ${split.join(', ')}`);
        await h.noWider(p.page, `D 320 ${scheme}`);
        await p.page.reload();
        await p.page.locator('[data-tc-day-standings]').waitFor({ timeout: 15000 });
        assert((await p.page.locator('[data-tc-board]').count()) === 0, 'the board again');
        assert(!p.errors.length, p.errors.join(' | '));
        await p.ctx.close();
      }
      // Reduced motion, opened mid-reveal: no rays, sparks or waves, the card never shakes; the rows still come in on time.
      await h.stage('zip77_running');
      const r = await phone('Wren', { reducedMotion: 'reduce' });
      const t0 = Date.now() + 6000 + 3000;
      await r.page.locator('[data-tc-reveal]').waitFor({ timeout: 15000 });
      assert((await r.page.locator('.tc-rv-rays, .tc-rv-spark, .tc-rv-wave').count()) === 0, 'effects with reduced motion');
      let moved = 0;
      while (Date.now() < t0 + 26_000) {
        const tf = await r.page.locator('[data-tc-reveal]').evaluate((el) => el.style.transform);
        if (tf && tf !== 'none') moved++;
        await sleep(150);
      }
      assert(moved === 0, 'the card shook');
      const rv = await r.page.evaluate(() => window.__rv);
      assert(rv[1] && Math.abs(rv[1] - (t0 + 24600)) < 1200, `1st at ${rv[1] ? Math.round(rv[1] - t0) : 'never'} ms`);
      await shot(r.page, 'D-reduced');
      assert(!r.errors.length, r.errors.join(' | '));
      await r.ctx.close();
    });

    await check('E Back closes sheets: the score sheet (Back, X, Escape, backdrop), never leaving the site; the organizer’s tabs go back to the last tab', async () => {
      await h.stage('zip77_last');
      const p = await h.newPage({ reducedMotion: 'reduce' });
      const page = p.page;
      await page.goto('about:blank');
      await page.goto(`${h.BASE}/?as=Vic`);
      await page.locator('[data-tc-enter-score]').waitFor({ timeout: 20000 });
      const sheetOpen = () => page.locator('dialog[open]').count();
      for (const how of ['back', 'x', 'escape', 'backdrop', 'back']) {
        await page.locator('[data-tc-enter-score]').click();
        await page.locator('dialog[open]').waitFor();
        if (how === 'back') await page.goBack();
        if (how === 'x') await page.locator('dialog[open] .icon-btn').click();
        if (how === 'escape') await page.keyboard.press('Escape');
        if (how === 'backdrop') await page.mouse.click(195, 30);
        await sleep(500);
        assert((await sheetOpen()) === 0, `${how}: the sheet stayed open`);
        assert(page.url().startsWith(h.BASE), `${how}: left the site (${page.url()})`);
      }
      // Every entry was given back: one Back now leaves for the page before the site.
      await page.goBack();
      await sleep(500);
      assert(page.url() === 'about:blank', `a dead Back: ${page.url()}`);
      await p.ctx.close();
      // The organizer: Home > Money > Players, Back, Back; a sheet on a tab: Back closes it, the tab stays.
      const a = await h.adminHome({ reducedMotion: 'reduce' });
      const tab = (name) => a.page.locator('.tab-bar button, nav button').filter({ hasText: name }).first();
      const current = () => a.page.locator('.tab-bar button[aria-current="page"], nav button[aria-current="page"], .tab-bar button[aria-selected="true"], nav button[aria-selected="true"]').first().innerText();
      await tab('Money').click();
      await sleep(300);
      await tab('Players').click();
      await sleep(300);
      await a.page.goBack();
      await sleep(400);
      assert(flat(await current()).includes('Money'), `Back went to ${flat(await current())}`);
      await a.page.goBack();
      await sleep(400);
      assert(flat(await current()).includes('Home'), `Back went to ${flat(await current())}`);
      assert(a.page.url().endsWith('/admin'), a.page.url());
      // A sheet on Home (the round's Set sheet): Back closes it and Home stays.
      const set = a.page.locator('[data-tm-am-game] button').filter({ hasText: /^Set$/ }).first();
      if (await set.count()) {
        await set.click();
        await a.page.locator('dialog[open]').waitFor();
        await a.page.goBack();
        await sleep(500);
        assert((await a.page.locator('dialog[open]').count()) === 0, 'the sheet stayed');
        assert(flat(await current()).includes('Home'), 'the tab moved');
      }
      assert(!a.errors.length, a.errors.join(' | '));
      await a.ctx.close();
    });

    await check('F the Up next card passes AA; the Court link and the card links are 44 px to tap; "Set · Round 6" on a game with no score', async () => {
      await h.stage('zip77_last');
      const p = await phone('Vic', { reducedMotion: 'reduce' });
      const page = p.page;
      await page.locator('[data-tc-day-next]').waitFor();
      const bg = await page.locator('[data-tc-day-next]').evaluate((el) => getComputedStyle(el).backgroundImage);
      assert(bg.includes('rgb(31, 112, 73)'), bg);
      const court = page.locator('[data-tc-day-court]').first();
      const box = await court.boundingBox();
      for (const dy of [-10, box.height + 9]) {
        const hit = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest('[data-tc-day-court]') !== null, [box.x + box.width / 2, box.y + dy]);
        assert(hit, `the Court tap area misses ${dy} px`);
      }
      await p.ctx.close();
      // The card links before the night: Edit and Drop out at least 44 px.
      await h.stage('zip70_start');
      const q = await phone('Parker', { reducedMotion: 'reduce' });
      await q.page.locator('[data-tc-drop]').first().waitFor({ timeout: 15000 });
      for (const sel of ['[data-tc-drop]', '[data-tc-edit]']) {
        const els = q.page.locator(sel);
        for (let i = 0; i < (await els.count()); i++) {
          const b = await els.nth(i).boundingBox();
          if (b) assert(b.height >= 44, `${sel} ${b.height} px tall`);
        }
      }
      await q.ctx.close();
      await h.stage('zip77_last');
      const a = await h.adminHome({ reducedMotion: 'reduce' });
      const btn = a.page.locator('[data-tm-am-game] button').filter({ hasText: /^Set$/ }).first();
      await btn.waitFor({ timeout: 15000 });
      await btn.click();
      const title = flat(await a.page.locator('dialog[open] h2').first().innerText());
      assert(/^Set · Round 6 · /.test(title), title);
      await a.ctx.close();
    });

    await check('G the Christmas skin on (Nov 28, Everyone): the waiting card and the final board; 320 px, no sideways scroll', async () => {
      await h.setClock(Date.parse('2026-11-28T15:00:00.000Z'));
      await h.call('PUT', '/api/admin/christmas-skin-switch', { mode: 'all' });
      const init = () => {
        try {
          localStorage.setItem('pb_xmas_theme', 'on');
          localStorage.setItem('pb_xmas_hint', '1');
          localStorage.setItem('pb_xmas_back', '1');
        } catch {}
      };
      for (const st of ['zip77_allin', 'zip77_revealed']) {
        await h.stage(st);
        for (const [width, scheme] of [[390, 'light'], [320, 'dark']]) {
          const p = await phone('Vic', { width, scheme, init });
          await p.page.locator(st === 'zip77_allin' ? '[data-tc-waiting]' : '[data-tc-board]').waitFor({ timeout: 15000 });
          await sleep(800);
          await h.noWider(p.page, `G ${st} ${width}`);
          await shot(p.page, `G-xmas-${st}-${width}-${scheme}`, st === 'zip77_revealed');
          assert(!p.errors.length, p.errors.join(' | '));
          await p.ctx.close();
        }
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
