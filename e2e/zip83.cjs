/* Zip 83 (🎾83.champions) in a real browser.
 *
 *   node e2e/zip83.cjs            (ZIP83_ONLY=<letter> runs one check)
 *
 * The world is the preview's calm profile (e2e/zip74-boot.cjs), then the Tournament test stages.
 *   A  The cup on player Home (History with tournaments, pictures 1 and 3): left of light/dark, the same round button (44 x 44, the same
 *      ring, fill and shadow), aria-label "Champions", the 26 px cup centered; the long name at the top wraps, never cut; 320/390/420, light
 *      and dark; no page wider than the screen.
 *   B  Tap the cup (picture 2): "Champions", REIGNING CHAMPS The Cold Open, "Tue ... · Locked doubles", Vic and Wren with the gold medal, Net
 *      Ninjas; PAST CHAMPIONS: Vic (Summer Slam · ... · Americano), Parker (Spring Fling · ...); no money; rows are not buttons; names never cut.
 *   C  Organizer Home: the cup left of light/dark (the same button), the same wall.
 *   D  Champions: none: no cup on player or organizer Home, the light/dark button exactly where it was.
 *   E  One tournament only (Tournament ended): no PAST CHAMPIONS heading.
 *   F  The Americano reveal: mid-reveal the wall's JSON has no trace of the night and there is no cup; after the board, it is the reigning one.
 *   G  Only me: the tournament leaves the wall (and the cup) for players and the organizer.
 *   H  The Christmas skin on: the cup and the wall at 390 light and 320 dark.
 *   I  The Tournament test page: only this zip's two stages; every older stage and look tool behind the small "All tests" link.
 *   J  The wall's own file cannot be fetched (a page open across a deploy): "Could not load the champions.", never a blank page.
 * Screenshots: .data/zip83-shots (not in git).
 */
const path = require('node:path');
const { mkdirSync } = require('node:fs');
const { DatabaseSync } = require('node:sqlite');
const { boot, flat, assert, ROOT } = require('./zip74-boot.cjs');

const SHOTS = path.join(ROOT, '.data', 'zip83-shots');
const ONLY = process.env.ZIP83_ONLY || '';
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
const DATE_RE = /^[A-Z][a-z]{2} [A-Z][a-z]{2} \d{1,2}, \d{4}$/;

(async () => {
  mkdirSync(SHOTS, { recursive: true });
  const h = await boot({ port: Number(process.env.E2E_PORT) || 5483, name: 'zip83', nowMs: NOW });
  const shot = (page, name, full = false) => page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: full });
  const titleOf = async (page) => (await page.locator('dialog[open]').last().locator('h2').first().innerText()).trim();
  const noCut = async (loc, what) => {
    const cut = await loc.evaluateAll((els) => els.filter((e) => e.scrollWidth > e.clientWidth + 1 || /…$/.test(e.textContent || '')).map((e) => e.textContent));
    assert(cut.length === 0, `${what}: cut ${cut.join(', ')}`);
  };
  /** The cup and the light/dark button: the same round button, side by side, the cup centered. */
  const cupLook = async (page, what) => {
    const cup = page.locator('[data-cup]');
    await cup.waitFor({ timeout: 15000 });
    assert((await cup.count()) === 1, `${what}: one cup`);
    assert((await cup.getAttribute('aria-label')) === 'Champions', `${what}: label`);
    const look = await page.evaluate(() => {
      const c = document.querySelector('[data-cup]');
      const m = document.querySelector('.mode-btn:not([data-cup])');
      const box = (e) => e.getBoundingClientRect().toJSON();
      const ring = (e) => {
        const s = getComputedStyle(e, '::after');
        return [s.inset, s.borderTopWidth, s.borderTopColor, s.backgroundColor, s.boxShadow, s.borderRadius].join(' | ');
      };
      return { cup: box(c), mode: box(m), svg: box(c.querySelector('svg')), ringC: ring(c), ringM: ring(m) };
    });
    assert(look.cup.width === 44 && look.cup.height === 44, `${what}: cup ${look.cup.width} x ${look.cup.height}`);
    assert(look.mode.width === look.cup.width && look.mode.height === look.cup.height, `${what}: same size as light/dark`);
    assert(look.ringC === look.ringM, `${what}: the same ring\n  ${look.ringC}\n  ${look.ringM}`);
    // Zip 90 (Alex): on the player header the two circles sit about 4 px apart (each tap area still 44 x 44): the visible circles (4 px inside
    // the tap area) never touch, the cup on the left.
    assert(look.mode.x + 4 - (look.cup.x + look.cup.width - 4) >= 3.5, `${what}: the cup is left of light/dark, the circles apart`);
    assert(Math.abs(look.cup.y - look.mode.y) < 0.5, `${what}: on one line`);
    assert(Math.round(look.svg.width) === 26 && Math.round(look.svg.height) === 26, `${what}: the cup is 26 px (${look.svg.width})`);
    const dx = look.svg.x + look.svg.width / 2 - (look.cup.x + look.cup.width / 2);
    const dy = look.svg.y + look.svg.height / 2 - (look.cup.y + look.cup.height / 2);
    assert(Math.abs(dx) < 0.6 && Math.abs(dy) < 0.6, `${what}: centered (${dx}, ${dy})`);
  };
  /** The wall as on picture 2 (History with tournaments). */
  const wallLook = async (page, what) => {
    await page.locator('[data-cup]').click();
    await page.locator('[data-cw]').waitFor({ timeout: 8000 });
    assert((await titleOf(page)) === 'Champions', `${what}: title`);
    const reign = page.locator('[data-cw-reign]');
    assert((await reign.locator('.cw-kicker').textContent()) === 'Reigning champs', `${what}: kicker`);
    assert(flat(await reign.locator('.cw-kicker').innerText()) === 'REIGNING CHAMPS', `${what}: small caps`);
    const kick = await reign.locator('.cw-kicker').evaluate((e) => [getComputedStyle(e).color, getComputedStyle(document.documentElement).getPropertyValue('--ball').trim()]);
    const ball = await page.evaluate((c) => {
      const d = document.createElement('i');
      d.style.color = c;
      document.body.append(d);
      const v = getComputedStyle(d).color;
      d.remove();
      return v;
    }, kick[1]);
    assert(kick[0] === ball, `${what}: kicker in the ball yellow (${kick[0]} vs ${ball})`);
    assert(flat(await reign.locator('.cw-name').innerText()) === 'The Cold Open', `${what}: name`);
    const line = flat(await reign.locator('.cw-line').innerText()).split(' · ');
    assert(line.length === 2 && DATE_RE.test(line[0]) && line[1] === 'Locked doubles', `${what}: line ${line}`);
    const winners = (await reign.locator('[data-cw-winner]').allInnerTexts()).map(flat);
    assert(winners.join() === 'Vic,Wren', `${what}: winners ${winners}`);
    assert((await reign.locator('[data-cw-winner] .cw-medal').count()) === 2, `${what}: a medal each`);
    assert(flat(await reign.locator('[data-cw-team]').innerText()) === 'Net Ninjas', `${what}: team`);
    assert(flat(await page.locator('.cw-past-h').innerText()) === 'PAST CHAMPIONS', `${what}: past heading`);
    const rows = page.locator('[data-cw-row]');
    assert((await rows.count()) === 2, `${what}: 2 past rows`);
    const r = [];
    for (let i = 0; i < 2; i++) r.push([flat(await rows.nth(i).locator('b').innerText()), flat(await rows.nth(i).locator('.cw-row-text > span').innerText())]);
    assert(r[0][0] === 'Vic' && /^Summer Slam · [A-Z][a-z]{2} [A-Z][a-z]{2} \d{1,2}, \d{4} · Americano$/.test(r[0][1]), `${what}: row 1 ${r[0]}`);
    assert(r[1][0] === 'Parker' && /^Spring Fling · .* · Americano$/.test(r[1][1]), `${what}: row 2 ${r[1]}`);
    assert((await page.locator('[data-cw] button, [data-cw] a').count()) === 0, `${what}: rows are not buttons`);
    const text = await page.locator('dialog[open]').last().innerText();
    assert(!/\$|credit/i.test(text), `${what}: no money`);
    await noCut(page.locator('[data-cw-winner] span, .cw-name, .cw-row-text b, .cw-row-text > span, .cw-line, .cw-team'), `${what}: names`);
    await h.noWider(page, what);
  };

  await check('A The cup on player Home', async () => {
    await h.stage('history');
    for (const { width, scheme } of SIZES) {
      for (const who of ['Parker', 'Christopher Vanderberg']) {
        const p = await h.playerPage(who, { width, scheme });
        await cupLook(p.page, `${who} ${width} ${scheme}`);
        // The name's own box (a medal's 44 x 44 tap area reaches outside the h1 by design, Zip 82). Zip 90 (Alex): the player header is one
        // row and a name that alone can't fit ends in "…" (e2e/zip90.cjs F checks when); a short name is never cut.
        if (who === 'Parker') await noCut(p.page.locator('.topbar h1:not(.has-badge), .topbar h1 .h1-name'), `${who} ${width} name`);
        // At 320 the buttons and the date stay on the name's row for a short name (Parker); a long one may drop them to a row of their own.
        if (who === 'Parker') {
          const rows = await p.page.evaluate(() => [document.querySelector('.topbar h1').getBoundingClientRect().top, document.querySelector('[data-cup]').getBoundingClientRect().bottom]);
          assert(rows[1] > rows[0], `${who} ${width}: the cup dropped under the name`);
        }
        await h.noWider(p.page, `${who} ${width} ${scheme}`);
        if (width === 390 && who === 'Parker') await shot(p.page, `A-home-${scheme}`);
        if (width === 320) await shot(p.page, `A-home-320-${who.split(' ')[0]}-${scheme}`);
        assert(!p.errors.length, p.errors.join('; '));
        await p.ctx.close();
      }
    }
  });

  await check('B The Champions wall', async () => {
    await h.stage('history');
    for (const { width, scheme } of SIZES) {
      const p = await h.playerPage('Parker', { width, scheme });
      await wallLook(p.page, `${width} ${scheme}`);
      if (width === 390 || width === 320) await shot(p.page, `B-wall-${width}-${scheme}`);
      // The X closes it; the cup opens it again.
      await p.page.keyboard.press('Escape');
      await p.page.locator('dialog[open]').waitFor({ state: 'detached', timeout: 3000 }).catch(() => {});
      assert(!p.errors.length, p.errors.join('; '));
      await p.ctx.close();
    }
  });

  await check('C Organizer Home: the cup and the wall', async () => {
    await h.stage('history');
    for (const { width, scheme } of SIZES) {
      const a = await h.adminHome({ width, scheme });
      await cupLook(a.page, `admin ${width} ${scheme}`);
      // 390 and wider: the logo, Admin, View as, the cup, light/dark and the date stay on one line (as before the cup).
      if (width >= 390) {
        const rows = await a.page.evaluate(() => [document.querySelector('.topbar h1').getBoundingClientRect().top, document.querySelector('[data-cup]').getBoundingClientRect().bottom]);
        assert(rows[1] > rows[0], `admin ${width}: the cup dropped under the title`);
      }
      await h.noWider(a.page, `admin ${width} ${scheme}`);
      if (width === 390) {
        await shot(a.page, `C-admin-${scheme}`);
        await wallLook(a.page, `admin ${scheme}`);
        await shot(a.page, `C-admin-wall-${scheme}`);
      }
      assert(!a.errors.length, a.errors.join('; '));
      await a.ctx.close();
    }
  });

  await check('D Champions: none (no cup, nothing moves)', async () => {
    const before = {};
    await h.stage('history');
    for (const scheme of ['light', 'dark']) {
      const p = await h.playerPage('Parker', { width: 390, scheme });
      before[scheme] = await p.page.locator('.mode-btn:not([data-cup])').boundingBox();
      await p.ctx.close();
    }
    await h.stage('zip83_none');
    for (const scheme of ['light', 'dark']) {
      const p = await h.playerPage('Parker', { width: 390, scheme });
      assert((await p.page.locator('[data-cup]').count()) === 0, 'no cup for Parker');
      const m = await p.page.locator('.mode-btn').boundingBox();
      assert(Math.abs(m.x - before[scheme].x) < 0.5 && Math.abs(m.y - before[scheme].y) < 0.5, `light/dark moved: ${JSON.stringify(m)} vs ${JSON.stringify(before[scheme])}`);
      const r = await p.page.evaluate(() => fetch('/api/tournament/champions').then((x) => x.json()));
      assert(JSON.stringify(r) === '{"tournaments":[]}', `wall JSON ${JSON.stringify(r)}`);
      await shot(p.page, `D-none-${scheme}`);
      assert(!p.errors.length, p.errors.join('; '));
      await p.ctx.close();
      const a = await h.adminHome({ width: 390, scheme });
      assert((await a.page.locator('[data-cup]').count()) === 0, 'no cup on organizer Home');
      assert((await a.page.locator('.mode-btn').count()) === 1, 'light/dark still there');
      await a.ctx.close();
    }
  });

  await check('E One tournament: no Past champions heading', async () => {
    await h.stage('ended');
    const p = await h.playerPage('Parker', { width: 390 });
    await p.page.locator('[data-cup]').click();
    await p.page.locator('[data-cw]').waitFor({ timeout: 8000 });
    assert((await p.page.locator('.cw-past-h').count()) === 0, 'no heading');
    assert((await p.page.locator('[data-cw-row]').count()) === 0, 'no rows');
    assert((await p.page.locator('[data-cw-winner]').allInnerTexts()).map(flat).join() === 'Vic,Wren', 'Vic and Wren');
    await shot(p.page, 'E-one');
    await p.ctx.close();
  });

  await check('F The Americano reveal is never spoiled', async () => {
    const made = await h.stage('zip77_running');
    const tap = made.tapMs;
    const v = await h.phone('Parker');
    const json = async () => (await v.ctx.request.get(h.BASE + '/api/tournament/champions')).text();
    // Before the board starts, while it plays, and just before the hold ends: nothing.
    for (const at of [tap - 3000, tap + 15_000, tap + 35_000]) {
      await h.setClock(at);
      const t = await json();
      assert(t === '{"tournaments":[]}', `mid-reveal JSON at +${at - tap} ms: ${t}`);
      const g = await v.group();
      assert(!g.tourAwards?.medals || Object.keys(g.tourAwards.medals).length === 0, `medals mid-reveal ${JSON.stringify(g.tourAwards)}`);
    }
    const mid = await h.playerPage('Parker', { width: 390 });
    assert((await mid.page.locator('[data-cup]').count()) === 0, 'no cup mid-reveal');
    await mid.ctx.close();
    await h.setClock(tap + 40_000);
    const after = JSON.parse(await json());
    assert(after.tournaments.length === 1 && after.tournaments[0].format === 'americano' && after.tournaments[0].winners.length === 1, `after: ${JSON.stringify(after)}`);
    await v.ctx.close();
    await h.setClock(NOW);
  });

  await check('G Only me: out of the wall for everyone', async () => {
    await h.stage('history');
    const db = new DatabaseSync(h.dbFile);
    db.prepare("UPDATE tournaments SET visibility = 'me' WHERE name = 'The Cold Open'").run();
    db.close();
    const v = await h.phone('Parker');
    const t = await (await v.ctx.request.get(h.BASE + '/api/tournament/champions')).text();
    assert(!t.includes('The Cold Open'), `player JSON ${t}`);
    const names = JSON.parse(t).tournaments.map((x) => x.name);
    assert(names.join() === 'Summer Slam,Spring Fling', `player rows ${names}`);
    await v.ctx.close();
    const o = await h.call('GET', '/api/admin/champions');
    assert(o.tournaments.map((x) => x.name).join() === 'Summer Slam,Spring Fling', `organizer rows ${JSON.stringify(o)}`);
  });

  await check('H The Christmas skin on', async () => {
    await h.setClock(Date.parse('2026-11-28T15:00:00.000Z'));
    await h.call('PUT', '/api/admin/christmas-skin-switch', { mode: 'all' });
    await h.stage('history');
    try {
      for (const [width, scheme] of [
        [390, 'light'],
        [320, 'dark'],
      ]) {
        const p = await h.newPage({ width, scheme });
        await p.ctx.addInitScript(() => {
          try {
            localStorage.setItem('pb_xmas_theme', 'on');
            localStorage.setItem('pb_xmas_hint', '1');
            localStorage.setItem('pb_xmas_back', '1');
          } catch {}
        });
        await p.page.goto(`${h.BASE}/?as=Parker`);
        await p.page.locator('.schedule, [data-tc-day]').first().waitFor({ timeout: 30000 });
        await p.page.waitForTimeout(700);
        await cupLook(p.page, `xmas ${width} ${scheme}`);
        await shot(p.page, `H-xmas-home-${width}-${scheme}`);
        await wallLook(p.page, `xmas ${width} ${scheme}`);
        await shot(p.page, `H-xmas-wall-${width}-${scheme}`);
        assert(!p.errors.length, p.errors.join('; '));
        await p.ctx.close();
      }
    } finally {
      await h.call('PUT', '/api/admin/christmas-skin-switch', { mode: 'off' });
      await h.setClock(NOW);
    }
  });

  await check('I The Tournament test page: only this zip, older ones behind All tests', async () => {
    const a = await h.adminHome({ width: 390 });
    await a.page.locator('[data-tm-test-row="home"]').click();
    await a.page.locator('[data-tm-test-current]').waitFor({ timeout: 10000 });
    const now = await a.page.locator('[data-tm-test-current] [data-tm-stage]').evaluateAll((els) => els.map((e) => e.getAttribute('data-tm-stage')));
    assert(now.join() === 'history,zip83_none', `this zip: ${now}`);
    assert((await a.page.locator('[data-tm-stage]').count()) === 2, 'no older stage before the link');
    assert((await a.page.locator('[data-tm-test-balls], [data-tm-test-pools]').count()) === 0, 'older look tools hidden');
    const link = a.page.locator('[data-tm-test-all-link]');
    assert((await link.innerText()).trim() === 'All tests', 'the link');
    const box = await link.boundingBox();
    assert(box.height >= 44, `link ${box.height} px`);
    await shot(a.page, 'I-test-page', true);
    await link.click();
    assert((await a.page.locator('[data-tm-test-all] [data-tm-stage]').count()) > 50, 'every older stage');
    assert((await a.page.locator('[data-tm-test-all] [data-tm-stage="signup"]').count()) === 1, 'signup among them');
    assert((await a.page.locator('[data-tm-test-balls]').count()) === 1, 'Ball look back');
    assert(!a.errors.length, a.errors.join('; '));
    await a.ctx.close();
  });

  await check('J The wall’s file cannot be fetched: Could not load, never a blank page', async () => {
    await h.stage('history');
    const p = await h.playerPage('Parker', { width: 390 });
    await p.page.route(/\/ChampionsSheet[-.]/, (r) => r.abort());
    await p.page.locator('[data-cup]').click();
    const msg = p.page.locator('dialog[open] .cw-file-failed');
    await msg.waitFor({ timeout: 8000 });
    assert(flat(await msg.locator('p').innerText()) === 'Could not load the champions.', 'words');
    assert((await titleOf(p.page)) === 'Champions', 'title');
    assert((await p.page.locator('.topbar h1').count()) === 1, 'the page is still there');
    await shot(p.page, 'J-file-failed');
    await p.ctx.close();
  });

  await h.close();
  console.log(`\nzip83: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
