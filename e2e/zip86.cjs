/* Zip 86 (🎾86.clean admin): browser checks on a LOCAL copy (the preview's calm world, fixed clock Thu Nov 19, 10 AM Eastern).
 *
 *   node e2e/zip86.cjs                  (ZIP86_ONLY=A,B runs some)
 *
 *   A   The tournament card (pictures 5 to 7) at 320/390/420, light and dark: the folded head's status line, the 4 steps, When, the four
 *       buttons and their second lines, Change (Date, Time, Courts, Players you expect, Courts cost), Money (to the cent) and Prizes
 *       (the suggestion); nothing wider than the screen, no word cut.
 *   B   The game card (picture 10): the status button moves on with Undo (and Undo leaves the server as it was), In / Out flips with Undo,
 *       the bottom row is 44 px and on one line, the balls and names on one line, no focus ring on load, the green stripe only while In.
 *   C   The TONIGHT and TOMORROW tiles keep the normal tile width at 100%, 125% and 150% text (picture 8).
 *   D   The admin mini row on the tournament's day (picture 9), no button.
 *   E   The player rows (pictures 1 to 3): next week no button; two weeks Sign up (opens Sign up), Lock in (runs Lock in), Who's in (opens it);
 *       never under THIS WEEK.
 *   F   The player rhythm (picture 4): 6 px higher card, THIS WEEK 14 px under it, headings 10 px above cards, cards 10 apart, NEXT WEEK 20
 *       under the card above, More games 12 under the last card.
 *   G   The Christmas skin on: the card, the game cards and the rows still fit at 390 light and 320 dark.
 * Screenshots: .data/zip86-shots (not in git).
 */
const path = require('node:path');
const { mkdirSync } = require('node:fs');
const { boot, flat, assert, sleep, ROOT } = require('./zip74-boot.cjs');

const SHOTS = path.join(ROOT, '.data', 'zip86-shots');
const ONLY = process.env.ZIP86_ONLY || '';
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

/** Words broken in the middle inside `sel` (a word whose letters sit on two lines), and boxes whose text runs past them. */
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
  const b = await boot({ name: 'zip86', port: Number(process.env.E2E_PORT) || 5486 });
  try {
    await check('A the tournament card, Change, Money and Prizes (320/390/420, light and dark)', async () => {
      await b.stage('zip86_payments');
      for (const width of [320, 390, 420]) {
        for (const scheme of ['light', 'dark']) {
          const { page, ctx, errors } = await b.adminHome({ width, scheme });
          const head = flat(await page.locator('[data-tm86-status]').textContent());
          assert(head === 'Payments · pay by Mon 7 PM', `status line: ${head}`);
          assert(flat(await page.locator('[data-tm-stage]').textContent()) === '4 unpaid', 'the pill');
          await page.locator('[data-tm-home-toggle]').click();
          await page.waitForTimeout(300);
          assert((await page.locator('[data-tm-steps="1"] .tm86-done').count()) === 1, 'Sign up done');
          assert((await page.locator('[data-tm-steps="1"] [aria-current="step"]').textContent()).includes('Payments'), 'Payments current');
          const when = flat(await page.locator('[data-tm86-when]').textContent());
          assert(when.startsWith('Tue Dec 1 · 7:30 to 10 PM2 courts · Locked doubles · $18'), `When: ${when}`);
          assert(!/pay by/.test(when), 'no pay by in When');
          const tickets = flat(await page.locator('.tm86-grid [data-tm-tickets]').textContent());
          assert(tickets === 'Tickets6 of 8 locked in', `Tickets: ${tickets}`);
          assert(flat(await page.locator('[data-tm-remind-btn]').textContent()) === 'Remind4 haven’t paid', 'Remind');
          assert(/^sms:/.test(await page.locator('[data-tm-remind-btn]').getAttribute('href')), 'Remind opens Messages');
          assert(flat(await page.locator('[data-tm86-prizes]').textContent()) === 'PrizesNot set yet', 'Prizes');
          assert(flat(await page.locator('[data-tm86-money]').textContent()) === 'Money+$42 if all pay', 'Money');
          // Every big button 44 px or taller; the old tap rows are gone.
          for (const h of await page.locator('.tm86-btn').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height))) assert(h >= 44, `a button ${h} px`);
          assert((await page.locator('.tm-hc-tap').count()) === 0, 'no tap rows');
          const bad = await cutOrBroken(page, '.tm86');
          assert(bad.length === 0, `card at ${width} ${scheme}: ${bad.join('; ')}`);
          await b.noWider(page, `card ${width} ${scheme}`);
          await page.screenshot({ path: path.join(SHOTS, `A-card-${width}-${scheme}.png`), fullPage: true });
          // Change.
          await page.locator('[data-tm86-change]').click();
          await page.waitForTimeout(500);
          const sheet = page.locator('[data-tm86-change-sheet]');
          assert(flat(await sheet.locator('[data-tm86-date]').textContent()) === 'Tue Dec 1', 'Date');
          assert((await sheet.locator('[data-tm-time-start]').inputValue()) === String(19 * 60 + 30), 'start');
          assert((await sheet.locator('[data-tm-time-end]').inputValue()) === String(22 * 60), 'end');
          assert((await sheet.locator('[data-tm-plan-courts="2"]').getAttribute('aria-pressed')) === 'true', 'courts 2');
          assert(flat(await sheet.locator('[data-tm-expect]').textContent()) === '10', 'expect 10');
          assert(flat(await sheet.locator('[data-tm86-court-cost]').textContent()) === '$120', 'courts cost');
          // One court: the cost follows at once.
          await sheet.locator('[data-tm-plan-courts="1"]').click();
          assert(flat(await sheet.locator('[data-tm86-court-cost]').textContent()) === '$60', 'one court');
          const sb = await cutOrBroken(page, '[data-tm86-change-sheet]');
          assert(sb.length === 0, `change sheet: ${sb.join('; ')}`);
          await page.screenshot({ path: path.join(SHOTS, `A-change-${width}-${scheme}.png`) });
          await page.keyboard.press('Escape');
          await page.waitForTimeout(400);
          // Money.
          await page.locator('[data-tm86-money]').click();
          await page.waitForTimeout(500);
          const ms = page.locator('[data-tm86-money-sheet]');
          const num = async (sel) => Number(await ms.locator(sel).getAttribute(sel.slice(1, -1)));
          assert((await num('[data-tm86-paid]')) === 9000, 'paid $90');
          assert((await num('[data-tm86-so-far]')) === -3000, 'so far');
          assert((await num('[data-tm86-tickets-all]')) === 16200, 'tickets $162');
          assert((await num('[data-tm86-prizes-all]')) === -2800, 'prizes $28');
          assert((await num('[data-tm86-keep]')) === 1400, 'keep +$14');
          const mt = flat(await ms.textContent());
          assert(mt.includes('5 tickets paid$90') && mt.includes('9 tickets (you play free)$162') && mt.includes('You keep+$14') && mt.includes('If all 10 pay'), `Money: ${mt}`);
          await page.screenshot({ path: path.join(SHOTS, `A-money-${width}-${scheme}.png`) });
          // Set prizes opens the Prizes sheet with the 🎾82 suggestion.
          await ms.locator('[data-tm86-set-prizes]').click();
          await page.waitForTimeout(500);
          const pz = page.locator('[data-tm86-prize-sheet]');
          assert(flat(await pz.locator('[data-tm-suggest-words]').textContent()) === 'Suggested: $14 each to the winners', 'suggestion');
          assert(flat(await pz.locator('[data-tm-suggest-left]').textContent()) === 'Tickets $162 − courts $120 = $42 left.', 'left words');
          await page.screenshot({ path: path.join(SHOTS, `A-prizes-${width}-${scheme}.png`) });
          assert(errors.length === 0, errors.join('; '));
          await ctx.close();
        }
      }
    });

    await check('A2 Prizes: Use these and Save set $14 each; the button and Money follow', async () => {
      await b.stage('zip86_payments');
      const { page, ctx } = await b.adminHome({ width: 390 });
      await page.locator('[data-tm-home-toggle]').click();
      await page.locator('[data-tm86-prizes]').click();
      await page.waitForTimeout(400);
      await page.locator('[data-tm-suggest-use]').click();
      await page.locator('[data-tm86-prizes-save]').click();
      await page.waitForFunction(() => /\$14 each to the winners/.test(document.querySelector('[data-tm86-prizes]')?.textContent || ''), null, { timeout: 8000 });
      assert(flat(await page.locator('[data-tm86-money]').textContent()) === 'Money+$14 if all pay', 'button after prizes');
      const t = (await b.call('GET', '/api/admin/dashboard')).tournament;
      assert(t.championCreditCents === 1400 && t.ticketCents === 1800 && t.format === 'doubles', 'saved as set');
      await ctx.close();
    });

    await check('B the game card: status and In / Out taps with Undo, the bottom row, no focus ring', async () => {
      await b.stage('zip86_home');
      for (const scheme of ['light', 'dark']) {
        for (const width of [320, 390, 420]) {
          const { page, ctx, errors } = await b.adminHome({ width, scheme });
          const first = page.locator('.scard86').first();
          assert((await first.getAttribute('data-me-in')) === 'yes', 'stripe while In');
          assert(flat(await first.locator('.r86-status').textContent()) === 'Booked', 'Booked');
          assert(flat(await first.locator('.r86-inout').textContent()) === 'In', 'In');
          assert((await page.locator('.court-switch').count()) === 0, 'no 3-way switch on Home');
          // No card has the focus when Home opens (the old green or lime ring).
          assert(await page.evaluate(() => !document.activeElement || !document.activeElement.closest('.scard, .hv2-short')), 'a card has the focus on load');
          // Bottom row: 44 px, one line.
          const foot = await first.locator('.r86-foot > *').evaluateAll((els) => els.filter((e) => e.getBoundingClientRect().height > 0).map((e) => [Math.round(e.getBoundingClientRect().height), Math.round(e.getBoundingClientRect().top)]));
          assert(foot.length === 3 && foot.every(([h]) => h === 44) && new Set(foot.map(([, t]) => t)).size === 1, `foot ${JSON.stringify(foot)}`);
          assert(flat(await first.locator('.r86-paid').textContent()) === '3 of 3 paid', 'paid pill');
          assert(flat(await first.locator('.r86-court').textContent()) === 'Court 4', 'court 4');
          // Balls and names on one line (when they fit, 390 and up).
          if (width >= 390) {
            const tops = await first.locator('.cl-players .players-top, .cl-players .names-line').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top + e.getBoundingClientRect().height / 2)));
            assert(Math.abs(tops[0] - tops[1]) <= 12, `balls and names ${tops}`);
          }
          const second = page.locator('.scard86').nth(1);
          assert(flat(await second.locator('.r86-status').textContent()) === 'Not booked', 'Not booked');
          assert(flat(await second.locator('.r86-inout').textContent()) === 'Out', 'Out');
          assert((await second.getAttribute('data-me-in')) === null, 'no stripe while Out');
          const border = await second.evaluate((e) => getComputedStyle(e).borderTopStyle);
          assert(border === 'solid', `no dashed outline (${border})`);
          const bad = await cutOrBroken(page, '.scard86');
          assert(bad.length === 0, `cards at ${width} ${scheme}: ${bad.join('; ')}`);
          await b.noWider(page, `cards ${width} ${scheme}`);
          await page.screenshot({ path: path.join(SHOTS, `B-cards-${width}-${scheme}.png`), fullPage: true });
          assert(errors.length === 0, errors.join('; '));
          await ctx.close();
        }
      }
      // The taps: Booked -> Not booked, then Undo: nothing saved.
      const { page, ctx } = await b.adminHome({ width: 390 });
      const first = page.locator('.scard86').first();
      const id = (await first.getAttribute('id')).replace('session-', '');
      const undo = (await b.call('GET', '/api/admin/dashboard')).adminUndo === true;
      await first.locator('.r86-status').click();
      assert(flat(await first.locator('.r86-status').textContent()) === 'Not booked', 'moved at once');
      if (undo) {
        await page.locator('.toast-action').click();
        await page.waitForTimeout(6500);
        const s = (await b.call('GET', '/api/admin/dashboard')).sessions.find((x) => x.id === id);
        assert(s.courtState === 'booked' || s.status === 'booked' || s.bookingStatus === 'booked' || flat(await first.locator('.r86-status').textContent()) === 'Booked', 'Undo left it booked');
        assert(flat(await first.locator('.r86-status').textContent()) === 'Booked', 'back to Booked');
      }
      // Next, Waitlist, Booked (the order), saved.
      await first.locator('.r86-status').click();
      // The site's double-tap guard drops a second tap on the same button within 0.4 s (on purpose); a real next tap comes later.
      await sleep(600);
      await first.locator('.r86-status').click();
      assert(flat(await first.locator('.r86-status').textContent()) === 'Waitlist', 'then Waitlist');
      await sleep(600);
      await first.locator('.r86-status').click();
      assert(flat(await first.locator('.r86-status').textContent()) === 'Booked', 'then Booked');
      await page.waitForTimeout(7000);
      assert(flat(await first.locator('.r86-status').textContent()) === 'Booked', 'saved Booked');
      // In -> Out with Undo; then Out for real.
      await first.locator('.r86-inout').click();
      assert(flat(await first.locator('.r86-inout').textContent()) === 'Out', 'Out at once');
      if (undo) {
        await page.locator('.toast-action').click();
        await page.waitForTimeout(6500);
        assert(flat(await first.locator('.r86-inout').textContent()) === 'In', 'Undo keeps In');
        const s = (await b.call('GET', '/api/admin/dashboard')).sessions.find((x) => x.id === id);
        assert(s.roster.some((r) => r.name === 'Alex' && r.status === 'confirmed'), 'still in on the server');
      }
      // Review fix: Out then In again inside the Undo window sends nothing (never Out, then back In on the waitlist).
      if (undo) {
        await sleep(600);
        await first.locator('.r86-inout').click();
        await sleep(600);
        await first.locator('.r86-inout').click();
        await page.waitForTimeout(6500);
        const s2 = (await b.call('GET', '/api/admin/dashboard')).sessions.find((x) => x.id === id);
        assert(s2.roster.some((r) => r.name === 'Alex' && r.status === 'confirmed'), 'Out then In: still in, nothing saved');
        assert(flat(await first.locator('.r86-inout').textContent()) === 'In', 'shows In');
      }
      await sleep(600);
      await first.locator('.r86-inout').click();
      await page.waitForTimeout(7000);
      const after = (await b.call('GET', '/api/admin/dashboard')).sessions.find((x) => x.id === id);
      assert(!after.roster.some((r) => r.name === 'Alex' && r.status === 'confirmed'), 'Out saved');
      assert((await first.getAttribute('data-me-in')) === null, 'stripe gone');
      await ctx.close();
    });

    await check('C TONIGHT and TOMORROW tiles keep the normal width at 100%, 125% and 150% text', async () => {
      await b.stage('zip86_home');
      for (const size of ['100%', '125%', '150%']) {
        const { page, ctx } = await b.adminHome({ width: 390 });
        await page.addStyleTag({ content: `html { font-size: ${size} !important; }` });
        await page.waitForTimeout(400);
        const w = await page.locator('.scard86 .tile').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().width)));
        assert(w.length >= 2 && w.every((x) => x <= 56), `tiles at ${size}: ${w}`);
        const tag = await page.locator('.scard86 .day-tag').first().evaluate((e) => [e.scrollWidth, e.clientWidth]);
        assert(tag[0] <= tag[1] + 1, `TONIGHT fits at ${size}: ${tag}`);
        await page.screenshot({ path: path.join(SHOTS, `C-tile-${size.replace('%', '')}.png`) });
        await ctx.close();
      }
    });

    await check('D the admin mini row on the tournament day, no button', async () => {
      await b.stage('zip86_payments');
      const { page, ctx } = await b.adminHome({ width: 390 });
      const row = page.locator('[data-tour-row="admin"]');
      assert((await row.count()) === 1, 'one row');
      assert(flat(await row.textContent()) === 'TUE1DECTournamentThe Cold Open7:30 to 10 PM · 6 of 8 locked in', flat(await row.textContent()));
      assert((await row.locator('button').count()) === 0, 'no button');
      await ctx.close();
    });

    await check('E the player rows: next week no button; two weeks Sign up, Lock in, Who’s in', async () => {
      await b.stage('zip86_next');
      {
        const { page, ctx } = await b.playerPage('Parker', { width: 390 });
        const row = page.locator('[data-tour-row]');
        assert((await row.count()) === 1, 'one row next week');
        assert((await row.getAttribute('data-tour-row')) === 'next' && (await row.locator('button').count()) === 0, 'no button next week');
        const head = await page.evaluate(() => {
          const r = document.querySelector('[data-tour-row]');
          let el = r.previousElementSibling;
          while (el && !el.matches('.week-break')) el = el.previousElementSibling;
          return el ? el.textContent : '';
        });
        assert(/Next week/i.test(head), `under ${head}`);
        await page.screenshot({ path: path.join(SHOTS, 'E-next.png'), fullPage: true });
        await ctx.close();
      }
      await b.stage('zip86_signup');
      for (const [who, action, opens] of [
        ['Quinn', 'signup', '.tm-sheet'],
        ['Parker', 'who', '.sheet'],
      ]) {
        const { page, ctx } = await b.playerPage(who, { width: 390 });
        const btn = page.locator(`[data-tour-row-btn="${action}"]`);
        assert((await btn.count()) === 1, `${who}: ${action}`);
        await btn.click();
        await page.waitForTimeout(700);
        assert(await page.locator('dialog[open]').count(), `${who}: a sheet opened`);
        await page.screenshot({ path: path.join(SHOTS, `E-${action}.png`) });
        await ctx.close();
      }
      {
        const { page, ctx } = await b.playerPage('Vic', { width: 390 });
        const btn = page.locator('[data-tour-row-btn="lock"]');
        assert((await btn.count()) === 1, 'Vic: Lock in');
        assert((await page.locator('[data-tour-row] [data-tc-drop], [data-tour-row] .tc-link').count()) === 0, 'never Drop out on the row');
        await btn.click();
        await page.waitForTimeout(1200);
        // Lock in with no credit: the Pay sheet (the card's own flow).
        assert(await page.locator('dialog[open]').count(), 'the Pay sheet opened');
        await page.screenshot({ path: path.join(SHOTS, 'E-lock.png') });
        await ctx.close();
      }
    });

    await check('F the player rhythm (picture 4)', async () => {
      await b.stage('zip70_start');
      for (const scheme of ['light', 'dark']) {
        const { page, ctx } = await b.playerPage('Parker', { width: 390, scheme });
        const m = await page.evaluate(() => {
          const top = (e) => e.getBoundingClientRect().top;
          const bot = (e) => e.getBoundingClientRect().bottom;
          const head = document.querySelector('.topbar, header');
          const tc = document.querySelector('main.page > .tc-wrap');
          const kids = [...document.querySelectorAll('.schedule > *')];
          const out = { card: Math.round(top(tc) - bot(head)), gaps: [] };
          let prev = tc;
          for (const k of kids) {
            out.gaps.push(`${k.matches('.week-break') ? 'H' : 'C'}${Math.round(top(k) - bot(prev))}`);
            prev = k;
          }
          const more = document.querySelector('main.page > .schedule + .btn.ghost.block');
          out.more = more ? Math.round(top(more) - bot(prev)) : null;
          return out;
        });
        // First heading 14 px under the card; every card 10 under its heading or the card before; later headings 20 under the card above.
        const [h1, ...rest] = m.gaps;
        assert(h1 === 'H14', `THIS WEEK ${h1}`);
        for (const g of rest) assert(g === 'C10' || g === 'H20', `gap ${g} (${m.gaps})`);
        assert(m.more === 12, `More games ${m.more}`);
        await ctx.close();
      }
    });

    await check('G the Christmas skin on: the card, the game cards and the rows still fit', async () => {
      await b.call('PUT', '/api/admin/christmas-skin-switch', { mode: 'all' });
      try {
        await b.stage('zip86_home');
        for (const [width, scheme] of [
          [390, 'light'],
          [320, 'dark'],
        ]) {
          const { page, ctx, errors } = await b.adminHome({ width, scheme });
          await page.locator('[data-tm-home-toggle]').click();
          await page.waitForTimeout(400);
          const bad = await cutOrBroken(page, '.tm86, .scard86, [data-tour-row]');
          assert(bad.length === 0, `skin ${width} ${scheme}: ${bad.join('; ')}`);
          await b.noWider(page, `skin ${width} ${scheme}`);
          await page.screenshot({ path: path.join(SHOTS, `G-skin-${width}-${scheme}.png`), fullPage: true });
          assert(errors.length === 0, errors.join('; '));
          await ctx.close();
        }
      } finally {
        await b.call('PUT', '/api/admin/christmas-skin-switch', { mode: 'off' });
      }
    });
  } finally {
    await b.close();
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
