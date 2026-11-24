/* Zip 85 (🎾85.final fixes): browser checks on a LOCAL copy (the preview's calm world, fixed clock).
 *
 *   node e2e/zip85.cjs                  (ZIP85_ONLY=A,B,C runs some; ZIP85_SLEEP_MIN sets the idle wait, default 15)
 *
 *   A   Item 3: a phone left ON and untouched 15 minutes in the last round: the last scores bring the waiting card, Reveal standings brings
 *       the board on time (in step with a fresh phone, no touch, no reload), then the cup and the winners ticker after the hold, still no touch.
 *   B   Item 2: Back (an iPhone-size and an Android-size phone) on the open Standings board (results row) and on the reveal board closes the
 *       board and stays on the site.
 *   C   Looks at 320, 360, 390 and 420, light and dark: the ticket's style line wraps (never cut), the organizer's rows never break a word,
 *       the History tabs fit, nothing wider than the screen; item 9's You owe card and Pay sheet (View as Parker) and Money's Tournament
 *       tickets card; item 1: the Plan box's "After full prizes" = the card's.
 * Screenshots: .data/zip85-shots (not in git).
 */
const path = require('node:path');
const { mkdirSync } = require('node:fs');
const { boot, flat, assert, sleep, ROOT } = require('./zip74-boot.cjs');

const SHOTS = path.join(ROOT, '.data', 'zip85-shots');
const ONLY = process.env.ZIP85_ONLY || '';
const SLEEP_MIN = Number(process.env.ZIP85_SLEEP_MIN || 15);
const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36';
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

/** The real wall time each board row comes in; a mark that dies with a reload. */
const RECORDER = () => {
  window.__rv = {};
  window.__loadedAt = performance.timeOrigin;
  const now = () => performance.timeOrigin + performance.now();
  const look = () => {
    document.querySelectorAll('.tc-rv-row').forEach((li) => {
      const p = li.dataset.p;
      if (li.dataset.in === '1' && !(p in window.__rv)) window.__rv[p] = now();
    });
  };
  const start = () => new MutationObserver(look).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-in', 'style'] });
  if (document.documentElement) start();
  else document.addEventListener('DOMContentLoaded', start);
};

/** Words broken in the middle inside `sel` (a word whose letters sit on two lines). */
const brokenWords = (page, sel) =>
  page.evaluate((s) => {
    const out = [];
    for (const el of document.querySelectorAll(s)) {
      const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let n = walk.nextNode(); n; n = walk.nextNode()) {
        const text = n.textContent || '';
        const re = /\S+/g;
        let m;
        while ((m = re.exec(text))) {
          const r = document.createRange();
          r.setStart(n, m.index);
          r.setEnd(n, m.index + m[0].length);
          const tops = new Set([...r.getClientRects()].filter((x) => x.width > 0).map((x) => Math.round(x.top)));
          if (tops.size > 1) out.push(m[0]);
        }
      }
    }
    return out;
  }, sel);

(async () => {
  mkdirSync(SHOTS, { recursive: true });
  const h = await boot({ port: Number(process.env.E2E_PORT) || 5851, name: `zip85${process.env.E2E_PORT || ''}` });
  const shot = (page, name, full = false) => page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: full }).catch(() => {});

  async function phone(who, opts = {}) {
    const p = await h.newPage({ reducedMotion: 'no-preference', ...opts });
    await p.ctx.addInitScript(RECORDER);
    const versions = [];
    p.page.on('request', (r) => {
      if (r.url().includes('/api/group/version')) versions.push(Date.now());
    });
    await p.page.goto(`${h.BASE}/?as=${encodeURIComponent(who)}`);
    await p.page.locator('.schedule, [data-tc-day]').first().waitFor({ timeout: 30000 });
    await sleep(800);
    return { ...p, who, versions };
  }
  const scoreOpen = async () => {
    for (let guard = 0; guard < 5; guard++) {
      const open = (await h.call('GET', '/api/admin/dashboard')).tournament.rounds.games.filter((g) => g.status === 'playing');
      if (!open.length) return;
      for (const g of open) {
        const who = g.a.names[0];
        const ph = await h.phone(who);
        const mine = (await ph.group()).tournament.day.rounds.find((x) => x.num === g.num);
        const r = await ph.post('/api/tournament/game', { tournamentId: (await ph.group()).tournament.id, action: 'score', num: g.num, key: mine.key, mine: 11, theirs: 6 });
        assert(r.ok, `score ${g.num}: ${r.status} ${JSON.stringify(r.body)}`);
        await ph.ctx.close();
      }
    }
  };

  try {
    await check('A item 3: the screen on and untouched in the last round, the reveal on time, then the cup and the ticker, no touch', async () => {
      await h.stage('zip85_idle');
      const idle = await phone('Quinn');
      const idleLoad = await idle.page.evaluate(() => window.__loadedAt);
      const t0 = Date.now();
      await sleep(SLEEP_MIN * 60_000);
      const late = idle.versions.filter((t) => t > t0 + 10.5 * 60_000).length;
      console.log(`        Quinn: ${idle.versions.filter((t) => t > t0).length} checks in ${SLEEP_MIN} min, ${late} after minute 10.5`);
      assert(late > 0, 'the idle phone stopped checking after 10 minutes');
      await scoreOpen();
      const scored = Date.now();
      await idle.page.locator('[data-tc-waiting]').waitFor({ timeout: 8000 });
      console.log(`        Quinn shows the waiting card ${((Date.now() - scored) / 1000).toFixed(1)} s after the last score (no touch)`);
      const vic = await phone('Vic');
      await vic.page.locator('[data-tc-waiting]').waitFor({ timeout: 15000 });
      const a = await h.adminHome();
      await a.page.locator('[data-tm-reveal]').click();
      const tapped = Date.now();
      await idle.page.locator('[data-tc-reveal]').waitFor({ timeout: 6000 });
      console.log(`        Quinn: the board on screen ${((Date.now() - tapped) / 1000).toFixed(1)} s after the tap (no touch)`);
      await sleep(Math.max(0, tapped + 31_000 - Date.now()));
      const a1 = await idle.page.evaluate(() => window.__rv);
      const b1 = await vic.page.evaluate(() => window.__rv);
      const spread = Object.keys(b1)
        .filter((p) => a1[p])
        .map((p) => Math.abs(a1[p] - b1[p]));
      console.log(`        places in step: ${spread.length}, worst ${Math.round(Math.max(0, ...spread))} ms`);
      assert(spread.length >= 5 && spread.every((x) => x <= 300), `out of step ${JSON.stringify(spread)}`);
      // The hold (about 36 s from the tap), then the next 5 second check: the cup and the ticker, still no touch.
      await idle.page.locator('[data-tour-ticker]').first().waitFor({ timeout: 30000 });
      await idle.page.locator('button[aria-label="Champions"]').first().waitFor({ timeout: 10000 });
      console.log(`        Quinn: the ticker and the cup ${((Date.now() - tapped) / 1000).toFixed(0)} s after the tap (no touch)`);
      assert((await idle.page.evaluate(() => window.__loadedAt)) === idleLoad, 'Quinn reloaded');
      await shot(idle.page, 'A-idle-after');
      for (const p of [vic, a, idle]) await p.ctx.close();
    });

    for (const [kind, opts] of [
      ['iPhone', { width: 390, height: 844 }],
      ['Android', { width: 412, height: 915, userAgent: ANDROID_UA }],
    ]) {
      await check(`B item 2 (${kind}): Back closes the Standings board and the reveal board, the site stays`, async () => {
        const open = (who) => phone(who, opts);
        await h.stage('history');
        const p = await open('Vic');
        await p.page.locator('[data-tc-results-open]').first().click();
        await p.page.locator('[data-tc-results="board"]').waitFor({ timeout: 5000 });
        await p.page.goBack();
        await p.page.locator('[data-tc-results="row"]').waitFor({ timeout: 5000 });
        await sleep(600);
        assert(new URL(p.page.url()).host === new URL(h.BASE).host, `left the site: ${p.page.url()}`);
        assert((await p.page.locator('[data-tc-results="board"]').count()) === 0, 'the board is still open');
        // Open, close with the X, then Back: no dead Back (the X gave its entry back).
        await p.page.locator('[data-tc-results-open]').first().click();
        await p.page.locator('[data-tc-results-x]').click({ timeout: 8000 });
        await sleep(600);
        const depth = await p.page.evaluate(() => history.length);
        await p.page.locator('[data-tc-results-open]').first().click();
        await p.page.locator('[data-tc-results="board"]').waitFor({ timeout: 5000 });
        await p.page.goBack();
        await p.page.locator('[data-tc-results="row"]').waitFor({ timeout: 5000 });
        assert(new URL(p.page.url()).host === new URL(h.BASE).host, `left the site after X then Back: ${p.page.url()} (history ${depth})`);
        await p.ctx.close();
        await h.stage('am_done');
        const v = await open('Vic');
        const a = await h.adminHome();
        await a.page.locator('[data-tm-reveal]').click();
        await v.page.locator('[data-tc-reveal]').waitFor({ timeout: 8000 });
        await sleep(9000);
        await v.page.goBack();
        await v.page.waitForFunction(() => !document.querySelector('[data-tc-reveal]'), null, { timeout: 4000 });
        assert(new URL(v.page.url()).host === new URL(h.BASE).host, `left the site: ${v.page.url()}`);
        await v.page.locator('[data-tc-results="row"]').waitFor({ timeout: 5000 });
        await shot(v.page, `B-${kind}-after-back`);
        await v.ctx.close();
        await a.ctx.close();
      });
    }

    await check('C looks: 320 / 360 / 390 / 420, light and dark', async () => {
      const problems = [];
      for (const width of [320, 360, 390, 420]) {
        for (const scheme of ['light', 'dark']) {
          const tag = `${width}-${scheme}`;
          // The ticket (The Cold Open as on live): the style line wraps, never cut.
          await h.stage('zip83_none');
          const t = await phone('Vic', { width, scheme });
          const fmt = await t.page.evaluate(() => {
            const el = document.querySelector('.tc-short .tc-format') || document.querySelector('.tc-format');
            if (!el) return null;
            const card = el.closest('.tc') || el.parentElement;
            const r = el.getBoundingClientRect();
            const c = card.getBoundingClientRect();
            return { text: el.textContent, over: el.scrollWidth - el.clientWidth, right: Math.round(r.right - c.right), lines: Math.round(r.height / parseFloat(getComputedStyle(el).lineHeight)) };
          });
          if (fmt && (fmt.over > 1 || fmt.right > 0)) problems.push(`${tag} ticket style line cut: ${JSON.stringify(fmt)}`);
          const wide = await t.page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
          if (wide[0] > wide[1]) problems.push(`${tag} player Home ${wide[0]} wide`);
          await shot(t.page, `C-ticket-${tag}`);
          await t.ctx.close();
          // Organizer Home: the folded rows never break a word; the card's "After full prizes" = the Plan box's.
          const a = await h.adminHome({ width, scheme });
          const broken = await brokenWords(a.page, '.hv2-names, .hv2-count');
          if (broken.length) problems.push(`${tag} admin rows break words: ${broken.join(', ')}`);
          await a.page.locator('[data-tm-home-toggle]').first().click();
          await sleep(400);
          const card = await a.page.locator('[data-tm-row-after-full]').first().getAttribute('data-tm-row-after-full', { timeout: 3000 }).catch(() => null);
          const planToggle = a.page.locator('[data-tm-plan-toggle]').first();
          if (card !== null && (await planToggle.count())) {
            await planToggle.click();
            const box = await a.page.locator('[data-tm-plan-box] [data-tm-after-full]').first().getAttribute('data-tm-after-full');
            if (box !== card) problems.push(`${tag} Plan box after full ${box} vs card ${card}`);
          } else if (width === 390 && scheme === 'light') problems.push(`${tag} no After full prizes row on the card (${card})`);
          const aw = await a.page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
          if (aw[0] > aw[1]) problems.push(`${tag} admin Home ${aw[0]} wide`);
          await shot(a.page, `C-admin-home-${tag}`);
          // History: the four tabs fit (no tab cut at the edge).
          await a.page.locator('nav.tabbar button', { hasText: 'History' }).click();
          await sleep(600);
          const tabs = await a.page.evaluate(() => {
            const seg = document.querySelector('.history-head .segmented');
            if (!seg) return null;
            const s = seg.getBoundingClientRect();
            return { scroll: seg.scrollWidth - seg.clientWidth, cut: [...seg.querySelectorAll('button')].filter((b) => { const r = b.getBoundingClientRect(); return r.left < s.left - 1 || r.right > s.right + 1; }).map((b) => b.textContent) };
          });
          if (tabs && (tabs.scroll > 1 || tabs.cut.length)) problems.push(`${tag} History tabs: ${JSON.stringify(tabs)}`);
          await shot(a.page, `C-history-${tag}`);
          await a.ctx.close();
        }
      }
      // Item 9 at 320 and 390, light and dark: the You owe card, the Pay sheet, Back closes it; Money's Tournament tickets card.
      await h.stage('zip85_owed');
      for (const width of [320, 390]) {
        for (const scheme of ['light', 'dark']) {
          const tag = `${width}-${scheme}`;
          const p = await phone('Parker', { width, scheme });
          const owe = p.page.locator('[data-ticket-owe]');
          await owe.waitFor({ timeout: 10000 });
          const words = flat(await owe.innerText());
          if (!/You owe \$16/.test(words) || !/For /.test(words)) problems.push(`${tag} owe card words: ${words}`);
          const ow = await p.page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
          if (ow[0] > ow[1]) problems.push(`${tag} owe page ${ow[0]} wide`);
          await shot(p.page, `C-owe-${tag}`);
          await p.page.locator('[data-ticket-owe-pay]').click();
          await p.page.locator('dialog[open] [data-pay-sheet]').waitFor({ timeout: 5000 });
          await shot(p.page, `C-owe-sheet-${tag}`);
          await p.page.goBack();
          await sleep(500);
          if (await p.page.locator('dialog[open] [data-pay-sheet]').count()) problems.push(`${tag} Back did not close the Pay sheet`);
          await p.ctx.close();
          const a = await h.adminHome({ width, scheme });
          await a.page.locator('nav.tabbar button', { hasText: 'Money' }).click();
          const card = a.page.locator('[data-tickets-owed]');
          await card.waitFor({ timeout: 8000 });
          const cw = flat(await card.innerText());
          if (!/Parker/.test(cw) || !/Owes \$16/.test(cw) || !/Mark paid/.test(cw)) problems.push(`${tag} Money card words: ${cw}`);
          const mark = await a.page.locator('[data-ticket-owed-mark]').first().boundingBox();
          if (!mark || mark.height < 43) problems.push(`${tag} Mark paid ${mark && mark.height} px tall`);
          const brokenM = await brokenWords(a.page, '[data-tickets-owed]');
          if (brokenM.length) problems.push(`${tag} Money card breaks words: ${brokenM.join(', ')}`);
          await shot(a.page, `C-money-${tag}`);
          await a.ctx.close();
        }
      }
      console.log(`        ${problems.length ? problems.join('\n        ') : 'no problems'}`);
      assert(problems.length === 0, `${problems.length} look problems`);
    });
  } finally {
    console.log(`\n${passed} passed, ${failed} failed. Pictures: ${SHOTS}`);
    await h.close();
    process.exit(failed ? 1 : 0);
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
