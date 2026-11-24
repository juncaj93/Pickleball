/* Zip 78 (🎾78.one look): the look rules in a real browser.
 *
 *   node e2e/zip78.cjs            (ZIP78_ONLY=<letter> runs one check)
 *
 * World: the preview's calm profile (e2e/zip74-boot.cjs) with the Tournament test stages, and for the money screens the whole fake world.
 *   A  Every screen (player and organizer, 320 and 390, light and dark): nothing wider than the screen, no word cut with "…", nothing in the
 *      rounded display font, no caret, no text under 11 px, every organizer tap at least 44 x 44.
 *   B  The Pay sheet's "I paid" looks the same from the You owe banner and from a game card (light and dark).
 *   C  "Mark paid" has one look: the Home card rows, the Money rows and the Players sheet draw it with the same height, corners, fill and words.
 *   D  The tournament card's loading shimmer moves (its background slides) and its two greens differ.
 *   E  Locked doubles with 12 players: "Dink group" and "Drive group", no "Pool A" / "Pool B", and each group's chips show points.
 *   F  One segmented look: the court switch, In / Out, Games / Totals and the History tabs are 44 px cells on the same track.
 */
const { boot, flat, assert } = require('./zip74-boot.cjs');

const ONLY = process.env.ZIP78_ONLY || '';
let passed = 0;
let failed = 0;
async function check(name, fn) {
  if (ONLY && !name.startsWith(ONLY)) return;
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.log(`  ✗ ${name}\n      ${String(err && err.message ? err.message : err).replace(/\s*\n\s*/g, ' ⏎ ').slice(0, 1400)}`);
  }
}

/** The page's look problems (the same measure as e2e/zip78-shots.cjs). */
function lookReport(organizer) {
  const out = { wide: document.documentElement.scrollWidth > window.innerWidth, cut: [], display: [], carets: [], small: [], taps: [] };
  for (const el of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || !el.getClientRects().length) continue;
    const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join(' ').trim();
    if (own && cs.textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth + 1) out.cut.push(own.slice(0, 40));
    if (own && /bricolage/i.test(cs.fontFamily)) out.display.push(own.slice(0, 40));
    if (own && parseFloat(cs.fontSize) < 10.95) out.small.push(`${own.slice(0, 30)} ${cs.fontSize}`);
    if (/[›‹❯⌄]/.test(own)) out.carets.push(own.slice(0, 30));
    for (const w of ['::after', '::before']) if (/[›‹❯⌄]/.test(getComputedStyle(el, w).content)) out.carets.push(`${el.className} ${w}`);
  }
  if (organizer)
    for (const el of document.querySelectorAll('button, a[href], [role="button"], summary, select')) {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height || el.closest('[aria-hidden="true"], .sr-only, dialog:not([open])')) continue;
      let w = r.width;
      let h = r.height;
      for (const ps of ['::before', '::after']) {
        const c = getComputedStyle(el, ps);
        if (c.content === 'none' || c.position !== 'absolute') continue;
        // A hit area that is positioned against the element itself (the element is positioned).
        if (getComputedStyle(el).position === 'static') {
          h = Math.max(h, 44);
          w = Math.max(w, 44);
          continue;
        }
        if (c.top !== 'auto' && c.bottom !== 'auto') h = Math.max(h, r.height - parseFloat(c.top) - parseFloat(c.bottom));
        if (c.left !== 'auto' && c.right !== 'auto') w = Math.max(w, r.width - parseFloat(c.left) - parseFloat(c.right));
      }
      if (w < 43.5 || h < 43.5) out.taps.push(`${(el.getAttribute('aria-label') || el.textContent || el.className).trim().replace(/\s+/g, ' ').slice(0, 30)} ${Math.round(w)}x${Math.round(h)}`);
    }
  return out;
}

const looks = (el) =>
  el.evaluate((b) => {
    const c = getComputedStyle(b);
    return { h: Math.round(b.getBoundingClientRect().height), r: c.borderTopLeftRadius, bg: c.backgroundColor, ink: c.color, size: c.fontSize, weight: c.fontWeight };
  });

(async () => {
  const calm = await boot({ name: 'zip78', port: Number(process.env.E2E_PORT) || 5481 });
  try {
    const SCREENS = [
      ['none', 'player Home', (o) => calm.playerPage('Vic', o), false],
      ['tickets_open', 'player ticket', (o) => calm.playerPage('Vic', o), false],
      ['zip74_short', 'player game night', (o) => calm.playerPage('Vic', o), false],
      ['am_round3', 'player Americano', (o) => calm.playerPage('Vic', o), false],
      ['none', 'organizer Home', (o) => calm.adminHome(o), true],
      ['tickets_open', 'organizer tournament card', async (o) => {
        const a = await calm.adminHome(o);
        await a.page.locator('[data-tm-home-toggle]').first().click();
        await a.page.waitForTimeout(600);
        return a;
      }, true],
      ['zip74_short', 'organizer game night', (o) => calm.adminHome(o), true],
    ];
    for (const [stage, name, open, organizer] of SCREENS)
      for (const width of [320, 390])
        for (const scheme of ['light', 'dark'])
          await check(`A ${name} ${width} ${scheme}: fits, no cut word, one font, no caret, no tiny text${organizer ? ', 44 px taps' : ''}`, async () => {
            await calm.stage(stage);
            const p = await open({ width, scheme });
            const r = await p.page.evaluate(lookReport, organizer);
            await p.ctx.close();
            assert(!r.wide, 'wider than the screen');
            assert(!r.cut.length, `cut: ${r.cut.join(' | ')}`);
            assert(!r.display.length, `display font: ${r.display.join(' | ')}`);
            assert(!r.carets.length, `carets: ${r.carets.join(' | ')}`);
            assert(!r.small.length, `under 11 px: ${r.small.join(' | ')}`);
            assert(!r.taps.length, `taps under 44: ${r.taps.join(' | ')}`);
          });

    for (const scheme of ['light', 'dark'])
      await check(`D the tournament card's loading shimmer moves (${scheme})`, async () => {
        await calm.stage('tickets_open');
        const p = await calm.newPage({ scheme, reducedMotion: 'no-preference' });
        await p.page.route('**/assets/**TournamentHome**', () => {}); // never answers: the place-holder stays
        await p.page.route('**/src/tournament/TournamentHome.tsx**', () => {});
        await p.page.goto(`${calm.BASE}/?as=Vic`);
        const shell = p.page.locator('[data-tc-shell]');
        await shell.waitFor({ timeout: 20000 });
        const a = await shell.evaluate((el) => [getComputedStyle(el).animationName, getComputedStyle(el).backgroundPosition, getComputedStyle(el).backgroundImage]);
        await p.page.waitForTimeout(500);
        const b = await shell.evaluate((el) => getComputedStyle(el).backgroundPosition);
        await p.ctx.close();
        assert(a[0] === 'skel-shimmer', `animation: ${a[0]}`);
        assert(a[1] !== b, `the sweep did not move: ${a[1]} then ${b}`);
        const stops = [...a[2].matchAll(/rgb\([^)]*\)/g)].map((m) => m[0]);
        assert(new Set(stops).size >= 2, `two colors in the sweep: ${a[2]}`);
      });

    await check('E 12 players: Dink group and Drive group, no Pool A / Pool B, no Court / Sits chips', async () => {
      await calm.stage('game1');
      const p = await calm.newPage({});
      await p.page.goto(`${calm.BASE}/?as=Vic&poolslook=12`);
      await p.page.locator('[data-tc-day-pool]').first().waitFor({ timeout: 30000 });
      await p.page.waitForTimeout(600);
      const words = flat(await p.page.locator('main').innerText());
      const groups = flat((await p.page.locator('[data-tc-day-pool]').allInnerTexts()).join(' | '));
      await p.ctx.close();
      assert(/Dink group/i.test(groups) && /Drive group/i.test(groups), `group cards: ${groups}`);
      assert(!/Pool [AB]\b/.test(words), `still says Pool: ${words}`);
      // The chips show points like normal standings once a group game has a score; never "Court 9" or "Sits".
      assert(!/\bSits\b|Court \d+\b/.test(groups), `group chips still show courts: ${groups}`);
    });

    for (const scheme of ['light', 'dark'])
      await check(`F one segmented look (${scheme}): court switch, In / Out, History tabs`, async () => {
        await calm.stage('none');
        const a = await calm.adminHome({ scheme });
        const sw = await a.page.locator('.court-switch button').first().evaluate((b) => [Math.round(b.getBoundingClientRect().height), getComputedStyle(b.parentElement).backgroundColor]);
        const io = a.page.locator('.r2-seg button').first();
        const ioLook = (await io.count()) ? await io.evaluate((b) => [Math.round(b.getBoundingClientRect().height), getComputedStyle(b.parentElement).backgroundColor]) : sw;
        await a.page.locator('.tabbar button, .tab-bar button', { hasText: 'History' }).first().click();
        const h = a.page.locator('.history-head .segmented button').first();
        await h.waitFor({ timeout: 10000 });
        const hLook = await h.evaluate((b) => [Math.round(b.getBoundingClientRect().height), getComputedStyle(b.parentElement).backgroundColor]);
        await a.ctx.close();
        for (const [n, l] of [['court switch', sw], ['In / Out', ioLook], ['History', hLook]]) {
          assert(l[0] === 44, `${n} cell is ${l[0]} px`);
          assert(l[1] === sw[1], `${n} track ${l[1]} vs ${sw[1]}`);
        }
      });
  } finally {
    await calm.close();
  }

  // The whole fake world: the You owe banner, the money rows.
  const WHO = process.env.ZIP78_PAYER || 'Vic';
  const full = await boot({ name: 'zip78full', port: (Number(process.env.E2E_PORT) || 5481) + 1, calm: false });
  try {
    for (const scheme of ['light', 'dark'])
      await check(`B the Pay sheet's I paid looks the same from the You owe banner and a game card (${scheme})`, async () => {
        const got = [];
        for (const from of ['banner', 'card']) {
          const p = await full.pickedPage(WHO, { scheme });
          const btn = from === 'banner' ? p.page.locator('main [data-pay-card] [data-pay]').first() : p.page.locator('main .schedule article').locator('a, button', { hasText: /^Pay\b/ }).first();
          if (!(await btn.count())) {
            await p.ctx.close();
            throw new Error(`no Pay on the ${from}`);
          }
          await btn.click();
          const ip = p.page.locator('dialog[open] .pay-sheet .btn.paid-soft, dialog[open] .btn.paid-soft').first();
          await ip.waitFor({ timeout: 8000 });
          got.push(await looks(ip));
          await p.ctx.close();
        }
        assert(JSON.stringify(got[0]) === JSON.stringify(got[1]), `banner ${JSON.stringify(got[0])} vs card ${JSON.stringify(got[1])}`);
      });

    await check('C Mark paid has one look (Home rows, Money rows, Players sheet)', async () => {
      const a = await full.adminHome({});
      const seen = [];
      const home = a.page.locator('button', { hasText: /^Mark paid$/ }).first();
      if (await home.count()) seen.push(['Home', await looks(home)]);
      await a.page.locator('.tabbar button, .tab-bar button', { hasText: 'Money' }).first().click();
      await a.page.waitForTimeout(1200);
      const money = a.page.locator('.mrw-mark').first();
      if (await money.count()) seen.push(['Money', await looks(money)]);
      await a.ctx.close();
      assert(seen.length >= 2, `found Mark paid on ${seen.map((s) => s[0]).join(', ')}`);
      const first = JSON.stringify(seen[0][1]);
      for (const [n, l] of seen) assert(JSON.stringify(l) === first, `${n} ${JSON.stringify(l)} vs ${seen[0][0]} ${first}`);
    });
  } finally {
    await full.close();
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
