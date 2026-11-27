/* 🎾96 audit (read-only, LOCAL copy only): every screen of The Cold Open night, player and organizer, at 375 / 390 / 420 / 440 px, light
 * and dark, text 100 / 125 / 150%; player screens also with the Christmas look ON (Everyone, pretend date Mon Nov 30). Reports, per screen:
 * the page wider than the phone, text cut (hidden overflow with no "…"), text past its own box, a word broken mid-word, a button covered by
 * something else, page errors. Screenshots at 390 (light, dark, Christmas) and 440 / 150% go to .data/zip96-shots.
 *
 *   node e2e/zip96-sweep.cjs            (ZIP96_ONLY=am_round3,zip90_ld narrows the stages; ZIP96_FAST=1 runs only 390 x 100%)
 */
process.env.CHRISTMAS_SKIN_PREVIEW = 'on';
const path = require('node:path');
const { mkdirSync, writeFileSync } = require('node:fs');
const { boot } = require('./zip74-boot.cjs');

const ROOT = path.resolve(__dirname, '..');
const SHOTS = path.join(ROOT, '.data', 'zip96-shots');
mkdirSync(SHOTS, { recursive: true });
const ONLY = (process.env.ZIP96_ONLY || '').split(',').filter(Boolean);
const FAST = !!process.env.ZIP96_FAST;
const WIDTHS = FAST ? [390] : [375, 390, 420, 440];
const SIZES = FAST ? [100] : [100, 125, 150];
const SCHEMES = ['light', 'dark'];

// [stage, who ('admin' or a player name), what to tap after load (regex on a button's words) or null, label]
const SCREENS = [
  ['zip87_early', 'Vic', null, 'tournament card (payments)'],
  ['zip87_early', 'Vic', /^Who.s in/, "Who's in"],
  ['zip87_early', 'Quinn', /^Lock in/, 'Lock in / pay sheet'],
  ['zip87_payday', 'Vic', null, 'Pay by day card'],
  ['zip93_day_before', 'Vic', null, 'tomorrow notice'],
  ['zip95_signup', 'Vic', /^Sign up/, 'Sign up step 1 (recommended)'],
  ['zip93_game_day', 'Vic', null, 'game day before the night'],
  ['zip88_soon', 'Vic', null, 'games start soon'],
  ['am_round3', 'Vic', null, 'night: Americano round 3'],
  ['am_round3', 'Vic', /^Enter score/, 'night: score sheet'],
  ['zip88_sitting', 'Vic', null, 'night: sitting'],
  ['zip89_break', 'Vic', null, 'night: 5 min break'],
  ['zip72_scores', 'Vic', null, 'night: Locked doubles game 1'],
  ['zip88_final', 'Vic', null, 'night: the Final'],
  ['zip77_allin', 'Vic', null, 'standings coming soon'],
  ['zip77_revealed', 'Vic', null, 'reveal board (final)'],
  ['zip79_night', 'Vic', null, 'results row (Americano)'],
    ['zip79_night_ld', 'Vic', null, 'results row (Locked doubles)'],
  ['zip90_ld', 'Vic', null, 'prize reveal: champs (face down)'],
  ['zip90_ld', 'Vic', 'flip', 'prize reveal: flipped / congrats'],
  ['zip90_am', 'Vic', null, 'prize reveal: Americano champion'],
  ['zip90_second', 'Parker', null, 'prize reveal: runner-up'],
  ['zip85_owed', 'Parker', null, 'You owe after the night'],
  ['zip87_payday', 'admin', null, 'admin: Pay by day card'],
  ['zip87_gameday', 'admin', null, 'admin: game day card'],
  ['zip88_ready', 'admin', null, 'admin: Start now'],
  ['zip88_rd3', 'admin', null, 'admin: night card Americano'],
  ['zip88_rd3', 'admin', /^All rounds/, 'admin: All rounds'],
  ['zip89_break', 'admin', null, 'admin: break'],
  ['zip97_ld_fast', 'admin', null, 'admin: Ahead of time / Add a round'],
  ['zip88_final', 'admin', null, 'admin: night card Final'],
  ['final_done', 'admin', null, 'admin: End card (Locked doubles)'],
  ['final_done', 'admin', /^Edit awards/i, 'admin: Edit awards'],
  ['am_done', 'admin', null, 'admin: End card (Americano)'],
  ['zip95_check', 'admin', null, 'admin: Level check card'],
  ['zip97_six', 'admin', null, 'admin: 6 switch to Americano'],
];

const scan = (page, scope) =>
  page.evaluate((scopeSel) => {
    const out = [];
    const root = (scopeSel && [...document.querySelectorAll(scopeSel)].pop()) || document.body;
    const hidden = (el) => {
      for (let e = el; e; e = e.parentElement) {
        if (e.getAttribute && e.getAttribute('aria-hidden') === 'true') return true;
        const cs = getComputedStyle(e);
        if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) return true;
      }
      return false;
    };
    const els = [...root.querySelectorAll('*')].filter(
      (el) => !['SCRIPT', 'STYLE', 'svg', 'path'].includes(el.tagName) && [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 1) && el.getClientRects().length && !hidden(el),
    );
    for (const el of els) {
      if (el.closest('[data-ticker], .ticker, .tk-track, marquee, .tw, .sr-only')) continue;
      const cs = getComputedStyle(el);
      const label = `${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]} "${el.textContent.trim().replace(/\s+/g, ' ').slice(0, 34)}"`;
      if (el.scrollWidth > el.clientWidth + 1 && cs.textOverflow !== 'ellipsis' && cs.overflowX !== 'visible') out.push(`cut: ${label}`);
      // Clipped by an ancestor with hidden overflow (not the scroller of the page itself).
      const r = el.getBoundingClientRect();
      for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
        const acs = getComputedStyle(a);
        if (acs.overflowX === 'hidden' || acs.overflow === 'hidden' || acs.overflowX === 'clip') {
          const ar = a.getBoundingClientRect();
          if (r.right > ar.right + 2 || r.left < ar.left - 2) {
            if (cs.textOverflow !== 'ellipsis') out.push(`clipped by ${a.tagName.toLowerCase()}.${String(a.className).split(' ')[0]}: ${label}`);
          }
          break;
        }
      }
      const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let n = walk.nextNode(); n; n = walk.nextNode()) {
        if (n.parentElement !== el) continue;
        const text = n.textContent || '';
        let at = 0;
        for (const word of text.split(/(\s+)/)) {
          if (word.trim().length > 1) {
            const rg = document.createRange();
            rg.setStart(n, at);
            rg.setEnd(n, at + word.length);
            const rects = [...rg.getClientRects()].filter((x) => x.width > 0);
            if (rects.length > 1 && Math.abs(rects[0].top - rects[rects.length - 1].top) > 2) out.push(`broken word "${word}" in ${label}`);
            const wr = rg.getBoundingClientRect();
            if (wr.width && (wr.right > window.innerWidth + 1 || wr.left < -1)) out.push(`off screen "${word}" in ${label}`);
          }
          at += word.length;
        }
      }
    }
    // Buttons covered by something else (center point lands outside the button).
    for (const btn of root.querySelectorAll('button, a[href], [role="button"]')) {
      if (!btn.getClientRects().length || hidden(btn)) continue;
      const r = btn.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) continue;
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      if (cy < 0 || cy > window.innerHeight || cx < 0 || cx > window.innerWidth) continue;
      const top = document.elementFromPoint(cx, cy);
      const fixedTop = (() => {
        for (let e = top; e; e = e.parentElement) if (['fixed', 'sticky'].includes(getComputedStyle(e).position)) return true;
        return false;
      })();
      if (top && !btn.contains(top) && !top.contains(btn) && !fixedTop && !top.closest('[data-skin-bubble]')) {
        const tl = `${top.tagName.toLowerCase()}.${String(top.className).split(' ')[0]}`;
        if (!/toast|backdrop|scrim|sheet-bg/.test(tl)) out.push(`covered: button "${btn.textContent.trim().slice(0, 24)}" under ${tl} "${(top.textContent || '').trim().slice(0, 20)}"`);
      }
    }
    if (document.documentElement.scrollWidth > window.innerWidth + 0.5) out.push(`page ${document.documentElement.scrollWidth}px wide on ${window.innerWidth}px`);
    return [...new Set(out)];
  }, scope);

(async () => {
  const b = await boot({ name: 'zip96', port: Number(process.env.E2E_PORT) || 5400 });
  const results = [];
  let lastStage = null;
  for (const [stage, who, tap, label] of SCREENS) {
    if (ONLY.length && !ONLY.includes(stage)) continue;
    if (stage !== lastStage) {
      await b.stage(stage);
      lastStage = stage;
    }
    const xmasRuns = who === 'admin' ? [false] : [false, true];
    for (const xmas of xmasRuns)
      for (const scheme of SCHEMES) {
        let p;
        const base = `${stage}|${who}|${label}|${xmas ? 'xmas' : 'plain'}|${scheme}`;
        try {
          if (who === 'admin') p = await b.adminHome({ width: 390, scheme });
          else p = await b.playerPage(who, { width: 390, scheme, query: xmas ? '&xmasmode=all&xmasdate=2026-11-30' : '&xmasmode=off&xmasdate=off' });
          const { page, errors } = p;
          const pre = [];
          if (xmas) {
            const on = await page.evaluate(() => document.documentElement.getAttribute('data-skin'));
            if (!on && (await page.locator('[data-skin-logo]').count())) {
              await page.locator('[data-skin-logo]').first().tap();
              await page.waitForTimeout(3500);
            }
            const after = await page.evaluate(() => document.documentElement.getAttribute('data-skin'));
            if (!after) pre.push('Christmas look did not turn on');
          }
          let scope = null;
          if (tap === 'flip') {
            const cards = page.locator('[data-prize-card], .pr-card, button:has-text("TAP")');
            const n = await cards.count();
            for (let i = 0; i < n; i++) {
              await cards.nth(i).tap().catch(() => {});
              await page.waitForTimeout(1600);
            }
          } else if (tap) {
            const btn = page.locator('button, a, [role="button"]').filter({ hasText: tap }).first();
            if ((await btn.count()) === 0) pre.push(`no button ${tap}`);
            else {
              await btn.scrollIntoViewIfNeeded().catch(() => {});
              await btn.tap();
              await page.waitForTimeout(900);
              if (await page.locator('.sheet').count()) scope = '.sheet';
            }
          }
          for (const width of WIDTHS)
            for (const size of SIZES) {
              if (xmas && size === 125) continue;
              const id = `${base}|${width}|${size}`;
              const issues = [...pre];
              await page.setViewportSize({ width, height: 844 });
              await page.evaluate((pct) => {
                let st = document.getElementById('zip96-size');
                if (!st) {
                  st = document.createElement('style');
                  st.id = 'zip96-size';
                  document.head.appendChild(st);
                }
                st.textContent = pct === 100 ? '' : `html { font-size: ${pct}% !important; }`;
              }, size);
              await page.waitForTimeout(250);
              issues.push(...(await scan(page, scope)));
              if (errors.length) issues.push(...errors.map((e) => `page error: ${e.slice(0, 120)}`));
              if ((width === 390 && size === 100) || (width === 440 && size === 150) || (width === 375 && size === 150)) {
                const file = `${stage}-${who}-${label.replace(/[^a-z0-9]+/gi, '_')}-${xmas ? 'xmas' : 'plain'}-${scheme}-${width}-${size}.png`;
                await page.screenshot({ path: path.join(SHOTS, file), fullPage: true });
              }
              results.push({ id, issues });
              console.log(`${issues.length ? 'ISSUES' : 'ok    '} ${id}${issues.length ? '\n        ' + issues.join('\n        ') : ''}`);
            }
        } catch (err) {
          results.push({ id: base, issues: [`ERROR ${String(err.message || err).split('\n')[0].slice(0, 160)}`] });
          console.log(`ERROR ${base} ${String(err.message || err).split('\n')[0].slice(0, 160)}`);
        } finally {
          if (p) await p.ctx.close().catch(() => {});
        }
      }
  }
  writeFileSync(path.join(ROOT, '.data', 'zip96-sweep.json'), JSON.stringify(results, null, 1));
  console.log(`done: ${results.length} screens, ${results.filter((r) => r.issues.length).length} with issues`);
  await b.close();
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
