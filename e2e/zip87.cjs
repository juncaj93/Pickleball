/* Zip 87 (🎾87.card polish): browser checks on a LOCAL copy (the preview's calm world, fixed clock Thu Nov 19, 10 AM Eastern).
 *
 *   node e2e/zip87.cjs                  (ZIP87_ONLY=A,B runs some)
 *
 *   A   Each state's card (pictures 3 to 8) at 320/390/420, light and dark: the words and the tone of every button, the status line, the pill,
 *       the steps (underlined words), the date tile (TONIGHT on game day), the 44 px gear; nothing wider than the screen, no word cut.
 *   B   Even gaps (picture 1): the steps flush under the head, 12 px above and below the date row, 12 px to the buttons, 12 px to the bottom.
 *   C   Large text (125% and 150%) and the Christmas skin on: the card still fits at 320 and 390, light and dark.
 *   D   The gear's sheet (picture 2, round 2: every setting) on an iPhone Air (420 x 912): the rows in order, no prizes or money, Plans changed?
 *       with Reschedule and Cancel on one line, then Save; each asks "Are you sure?" first (Keep it leaves everything as it was).
 *   E   Prizes for both styles (picture 9): the money left, Use these fills both boxes, Costs and You keep, Save; the button then reads
 *       "$14 each to winners" (soft green) and Money "+$14 if all pay"; the server holds both boxes.
 *   F   Game day: Teams opens the team draft above the card; Americano: Rounds, soft green "6 rounds ready" (no draft, nothing to do).
 * Screenshots: .data/zip87-shots (not in git).
 */
const path = require('node:path');
const { mkdirSync } = require('node:fs');
const { boot, flat, assert, ROOT } = require('./zip74-boot.cjs');

const SHOTS = path.join(ROOT, '.data', 'zip87-shots');
const ONLY = process.env.ZIP87_ONLY || '';
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

/** Boxes whose text runs past them, and words broken in the middle (letters on two lines). */
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

/** What each stage must show: the status line, the pill, the step, the tile's tag, and every button as "tone|words". */
const STATES = {
  zip87_early: { status: 'Payments · pay by Mon 7 PM', pill: '4 unpaid', step: '1', tile: 'date', buttons: ['soft|Players6 of 10 locked in', 'plain|Remind4 haven’t paid', 'plain|PrizesNot set yet', 'plain|Money+$42 if all pay'] },
  zip87_payday: { status: 'Payments · pay by today 7 PM', pill: '2 unpaid', step: '1', tile: 'tomorrow', buttons: ['soft|Players8 of 10 locked in', 'amber|Remind2 left · due 7 PM', 'plain|PrizesNot set yet', 'plain|Money+$42 if all pay'] },
  zip87_past: { status: 'Payments · Pay by passed', pill: '2 unpaid', step: '1', tile: 'date', buttons: ['soft|Players8 of 10 locked in', 'red|Remind2 past due', 'plain|PrizesNot set yet', 'plain|Money+$42 if all pay'] },
  zip87_paid: { status: 'Payments · all paid', pill: '10 locked in', step: '1', tile: 'date', buttons: ['solid|PlayersAll 10 locked in', 'quiet|RemindEveryone paid', 'plain|PrizesNot set yet', 'plain|Money+$42 if all pay'] },
  zip87_gameday: { status: 'Game night · 7:30 PM', pill: '10 locked in', step: '2', tile: 'tonight', buttons: ['solid|PlayersAll 10 locked in', 'amber|TeamsDraft before 7:30', 'amber|PrizesSet before tonight', 'plain|Money+$42 if all pay'] },
  zip87_allset: { status: 'Game night · 7:30 PM', pill: '10 locked in', step: '2', tile: 'tonight', buttons: ['solid|PlayersAll 10 locked in', 'soft|Teams5 teams set', 'soft|Prizes$14 each to winners', 'plain|MoneyYou keep +$14'] },
};

async function openCard(page) {
  await page.locator('[data-tm-home-toggle]').click();
  await page.waitForTimeout(350);
}
const buttonsOf = (page) => page.locator('.tm87-body .tm86-grid > *').evaluateAll((els) => els.map((e) => `${[...e.classList].find((c) => c.startsWith('tm87-')).slice(5)}|${e.textContent.replace(/\s+/g, ' ').trim().replace(/ /g, '').replace(/(\D)(\d)/, '$1$2')}`));
const norm = (xs) => xs.map((x) => x.replace(/\s+/g, ''));

(async () => {
  mkdirSync(SHOTS, { recursive: true });
  const b = await boot({ name: 'zip87', port: Number(process.env.E2E_PORT) || 5487 });
  try {
    await check('A each state: words, tones, status line, pill, steps, tile, gear (320/390/420, light and dark)', async () => {
      for (const [stage, want] of Object.entries(STATES)) {
        await b.stage(stage);
        for (const width of [320, 390, 420]) {
          for (const scheme of ['light', 'dark']) {
            const { page, ctx, errors } = await b.adminHome({ width, scheme });
            assert(flat(await page.locator('[data-tm86-status]').textContent()) === want.status, `${stage}: status ${flat(await page.locator('[data-tm86-status]').textContent())}`);
            assert(flat(await page.locator('[data-tm-stage]').textContent()) === want.pill, `${stage}: pill`);
            await openCard(page);
            assert((await page.locator(`[data-tm-steps="${want.step}"]`).count()) === 1, `${stage}: step ${want.step}`);
            // A ✓ on every done step (at 320 the green word and line alone: no room beside "Payments").
            const ticks = await page.locator('.tm87-done .tm87-tick').evaluateAll((els) => els.filter((e) => e.getBoundingClientRect().width > 0).length);
            assert(ticks === (width >= 390 ? Number(want.step) : 0), `${stage} ${width}: ${ticks} ✓`);
            assert((await page.locator('[data-tm87-tile]').getAttribute('data-tm87-tile')) === want.tile, `${stage}: tile ${await page.locator('[data-tm87-tile]').getAttribute('data-tm87-tile')}`);
            const got = norm(await buttonsOf(page));
            assert(JSON.stringify(got) === JSON.stringify(norm(want.buttons)), `${stage} ${width} ${scheme}: ${JSON.stringify(got)}`);
            // Status lines (the second line) never bold.
            for (const w of await page.locator('.tm87-body .tm86-btn-sub').evaluateAll((els) => els.map((e) => Number(getComputedStyle(e).fontWeight)))) assert(w < 600, `${stage}: a bold status line (${w})`);
            // The gear: round, 44 px, opens Change. No Change button and no "Cancel or reschedule" link on the card.
            const g = await page.locator('.tm87-gear').evaluate((e) => [e.getBoundingClientRect().width, e.getBoundingClientRect().height, getComputedStyle(e).borderRadius]);
            assert(g[0] === 44 && g[1] === 44 && g[2] === '50%', `gear ${g}`);
            assert((await page.locator('.tm87 [data-tm-cancel-or-reschedule], .tm87 .tm86-change').count()) === 0, 'no Change button, no Cancel or reschedule link');
            // The date row: the time on one line at 390 and wider; the plan line too.
            if (width >= 390) {
              for (const sel of ['.tm87-when .tm86-when-main', '.tm87-when .tm86-when-sub']) {
                const lines = await page.locator(sel).evaluate((e) => Math.round(e.getBoundingClientRect().height / parseFloat(getComputedStyle(e).lineHeight)));
                assert(lines === 1, `${stage} ${width}: ${sel} on ${lines} lines`);
              }
            }
            for (const h of await page.locator('.tm86-btn').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height))) assert(h >= 44, `a button ${h} px`);
            const bad = await cutOrBroken(page, '.tm87');
            assert(bad.length === 0, `${stage} ${width} ${scheme}: ${bad.join('; ')}`);
            await b.noWider(page, `${stage} ${width} ${scheme}`);
            if (width === 390) await page.locator('.tm87').screenshot({ path: path.join(SHOTS, `A-${stage}-${scheme}.png`) });
            assert(errors.length === 0, errors.join('; '));
            await ctx.close();
          }
        }
      }
    });

    await check('B even gaps: steps flush under the head, 12 px around the date row, 12 px to the buttons and to the bottom', async () => {
      await b.stage('zip87_early');
      for (const width of [320, 390, 420]) {
        const { page, ctx } = await b.adminHome({ width });
        await openCard(page);
        const m = await page.evaluate(() => {
          const r = (s) => document.querySelector(s).getBoundingClientRect();
          const when = document.querySelector('.tm87-when');
          const cs = getComputedStyle(when);
          return {
            head: r('.tm87 .tm-hc-head').bottom,
            body: r('.tm87-body').top,
            steps: r('.tm87-steps').top,
            stepsBottom: r('.tm87-steps').bottom,
            whenTop: r('.tm87-when').top,
            padTop: parseFloat(cs.paddingTop),
            padBottom: parseFloat(cs.paddingBottom),
            line: cs.borderBottomStyle,
            whenBottom: r('.tm87-when').bottom,
            grid: r('.tm87-body .tm86-grid').top,
            gridBottom: r('.tm87-body .tm86-grid').bottom,
            card: r('.tm87').bottom,
            gap: getComputedStyle(document.querySelector('.tm87-body')).rowGap,
          };
        });
        assert(Math.abs(m.steps - m.body) <= 1.5, `steps flush (${m.steps - m.body})`);
        assert(Math.abs(m.whenTop - m.stepsBottom) <= 0.5, `no gap between the steps and the date row (${m.whenTop - m.stepsBottom})`);
        assert(m.padTop === 12 && m.padBottom === 12 && m.line === 'solid', `date row padding ${m.padTop}/${m.padBottom} ${m.line}`);
        assert(Math.abs(m.grid - m.whenBottom - 12) <= 0.5, `12 px to the buttons (${m.grid - m.whenBottom})`);
        assert(Math.abs(m.card - m.gridBottom - 12) <= 1.5, `12 px to the bottom (${m.card - m.gridBottom})`);
        assert(m.gap === 'normal' || m.gap === '0px', `no flex gap (${m.gap})`);
        await ctx.close();
      }
    });

    await check('C large text (125%, 150%) and the Christmas skin: the card still fits (320 and 390, light and dark)', async () => {
      await b.stage('zip87_gameday');
      for (const size of ['125%', '150%']) {
        for (const [width, scheme] of [
          [320, 'dark'],
          [390, 'light'],
        ]) {
          const { page, ctx } = await b.adminHome({ width, scheme });
          await page.addStyleTag({ content: `html { font-size: ${size} !important; }` });
          await openCard(page);
          const bad = await cutOrBroken(page, '.tm87');
          assert(bad.length === 0, `${size} ${width} ${scheme}: ${bad.join('; ')}`);
          await b.noWider(page, `${size} ${width} ${scheme}`);
          const tile = await page.locator('.tm87-tile .tile').evaluate((e) => Math.round(e.getBoundingClientRect().width));
          assert(tile <= 56, `the tile keeps its width at ${size}: ${tile}`);
          await page.locator('.tm87').screenshot({ path: path.join(SHOTS, `C-text-${size.replace('%', '')}-${width}-${scheme}.png`) });
          await ctx.close();
        }
      }
      await b.call('PUT', '/api/admin/christmas-skin-switch', { mode: 'all' });
      try {
        for (const stage of ['zip87_early', 'zip87_allset']) {
          await b.stage(stage);
          for (const [width, scheme] of [
            [390, 'light'],
            [320, 'dark'],
          ]) {
            const { page, ctx, errors } = await b.adminHome({ width, scheme });
            await openCard(page);
            const bad = await cutOrBroken(page, '.tm87');
            assert(bad.length === 0, `skin ${stage} ${width} ${scheme}: ${bad.join('; ')}`);
            await b.noWider(page, `skin ${width} ${scheme}`);
            await page.locator('.tm87').screenshot({ path: path.join(SHOTS, `C-skin-${stage}-${width}-${scheme}.png`) });
            assert(errors.length === 0, errors.join('; '));
            await ctx.close();
          }
        }
      } finally {
        await b.call('PUT', '/api/admin/christmas-skin-switch', { mode: 'off' });
      }
    });

    await check('D the gear sheet on an iPhone Air: every setting in order, no prizes or money, Plans changed? on one line, then Save; Are you sure? first', async () => {
      await b.stage('zip87_early');
      for (const scheme of ['light', 'dark']) {
        const { page, ctx } = await b.adminHome({ width: 420, height: 912, scheme });
        await openCard(page);
        await page.locator('.tm87-gear').click();
        await page.waitForTimeout(600);
        const sheet = page.locator('[data-tm86-change-sheet]');
        const row = sheet.locator('[data-tm87-plans]');
        assert(flat(await row.textContent()) === 'Plans changed?RescheduleCancel', flat(await row.textContent()));
        const tops = await row.locator('.tm86-label, button').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top + e.getBoundingClientRect().height / 2)));
        assert(Math.max(...tops) - Math.min(...tops) <= 3, `one line: ${tops}`);
        // The plain box style (no red), 44 px.
        for (const c of await row.locator('button').evaluateAll((els) => els.map((e) => [getComputedStyle(e).color, getComputedStyle(e).backgroundColor, e.getBoundingClientRect().height]))) assert(c[2] >= 44, `button ${c}`);
        // Round 2 (Alex): every setting is here now, so the sheet scrolls; Plans changed? is last, then Save.
        const order = await sheet.locator('.tm86-field .tm86-label').allTextContents();
        const want = ['Date', 'Time', 'Courts', 'Players you expect', 'Courts cost', 'Style', 'Ticket price (tickets sold)', 'Pay by', 'Who can see it', 'Name', 'Plans changed?'];
        assert(JSON.stringify(order.map(flat)) === JSON.stringify(want), `rows ${JSON.stringify(order.map(flat))}`);
        await sheet.locator('[data-tm86-save]').scrollIntoViewIfNeeded();
        const save = await sheet.locator('[data-tm86-save]').evaluate((e) => e.getBoundingClientRect().bottom);
        assert(save <= 912, `Save reachable (${save})`);
        // No prizes and no money line here (they live in Prizes and Money).
        const words = flat(await sheet.textContent());
        assert(!/credit|Champion|You make if it fills|prize/i.test(words), `no prizes or money: ${words}`);
        await page.screenshot({ path: path.join(SHOTS, `D-change-air-${scheme}.png`) });
        // Are you sure? first; Keep it changes nothing.
        await row.locator('[data-tm-reschedule]').click();
        await page.waitForTimeout(300);
        // (The confirm sits inside the Change sheet, so the outer sheet matches too.)
        assert((await page.locator('.sheet').filter({ hasText: 'Are you sure?' }).filter({ hasText: 'Reschedule: the date comes off' }).count()) >= 1, 'Reschedule asks first');
        await page.screenshot({ path: path.join(SHOTS, `D-sure-${scheme}.png`) });
        await page.getByRole('button', { name: 'Keep it' }).click();
        await page.waitForTimeout(300);
        await row.locator('[data-tm-cancel-tournament]').click();
        await page.waitForTimeout(300);
        const body = await page.locator('.sheet').filter({ hasText: 'Are you sure?' }).filter({ hasText: 'players see it canceled' }).last().textContent();
        assert(/back as credit/.test(body), `Cancel asks first: ${flat(body)}`);
        await page.getByRole('button', { name: 'Keep it' }).click();
        await page.waitForTimeout(300);
        const t = (await b.call('GET', '/api/admin/dashboard')).tournament;
        assert(t.status === 'tickets' && t.finalDate, 'nothing changed');
        await ctx.close();
      }
    });

    await check('E Prizes for both styles: Use these, Costs and You keep, Save; the button and Money follow; both boxes saved', async () => {
      for (const scheme of ['dark', 'light']) {
        await b.stage('zip87_prizes');
        const { page, ctx } = await b.adminHome({ width: 390, scheme });
        await openCard(page);
        await page.locator('[data-tm86-prizes]').click();
        await page.waitForTimeout(500);
        const pz = page.locator('[data-tm86-prize-sheet]');
        assert(flat(await pz.locator('.pz-left').textContent()) === 'Tickets $162 − courts $120 = $42 left', flat(await pz.locator('.pz-left').textContent()));
        const titles = await pz.locator('.pz-box-title').allTextContents();
        assert(JSON.stringify(titles) === JSON.stringify(['Locked doubles', 'If Americano']), `titles ${titles}`);
        assert(flat(await pz.locator('[data-pz-top] .pz-tag').textContent()) === 'Plan now', 'Plan now tag');
        assert((await pz.getByText('Medal and banner are automatic', { exact: false }).count()) === 0, 'the old note is gone');
        await pz.locator('[data-pz-use]').click();
        await page.waitForTimeout(200);
        const vals = await pz.locator('[data-pz-money]').evaluateAll((els) => els.map((e) => e.value));
        assert(JSON.stringify(vals) === JSON.stringify(['14', '0', '14', '7']), `filled ${vals}`);
        assert((await pz.locator('[data-pz-box="doubles"] .pz-foot').getAttribute('data-pz-cost')) === '2800', 'doubles costs $28');
        assert((await pz.locator('[data-pz-box="doubles"] .pz-foot').getAttribute('data-pz-keep')) === '1400', 'doubles keep +$14');
        assert((await pz.locator('[data-pz-box="americano"] .pz-foot').getAttribute('data-pz-cost')) === '2100', 'americano costs $21');
        assert((await pz.locator('[data-pz-box="americano"] .pz-foot').getAttribute('data-pz-keep')) === '2100', 'americano keep +$21');
        assert(flat(await pz.locator('[data-pz-box="doubles"] .pz-foot').textContent()) === 'Costs $28You keep +$14', 'doubles foot words');
        // A 2nd place for the team: the cost follows at once ($14 + $7) x 2 = $42.
        await pz.locator('[data-pz-money="doubles-second"]').fill('7');
        assert((await pz.locator('[data-pz-box="doubles"] .pz-foot').getAttribute('data-pz-cost')) === '4200', 'doubles with 2nd costs $42');
        await pz.locator('[data-pz-money="doubles-second"]').fill('0');
        const bad = await cutOrBroken(page, '[data-tm86-prize-sheet]');
        assert(bad.length === 0, `prizes ${scheme}: ${bad.join('; ')}`);
        const save = await pz.locator('[data-tm86-prizes-save]').evaluate((e) => e.getBoundingClientRect().bottom);
        assert(save <= 844, `Save on screen (${save})`);
        await page.screenshot({ path: path.join(SHOTS, `E-prizes-${scheme}.png`) });
        if (scheme === 'light') {
          await pz.locator('[data-tm86-prizes-save]').click();
          await page.waitForFunction(() => /\$14 each to winners/.test(document.querySelector('[data-tm86-prizes]')?.textContent || ''), null, { timeout: 8000 });
          assert((await page.locator('[data-tm86-prizes]').getAttribute('data-tm86-prizes')) === 'soft', 'soft green once set');
          assert(flat(await page.locator('[data-tm86-money]').textContent()) === 'Money+$14 if all pay', 'Money after prizes');
          const t = (await b.call('GET', '/api/admin/dashboard')).tournament;
          assert(JSON.stringify(t.prizes) === JSON.stringify({ doubles: { first: 1400, second: 0 }, americano: { first: 1400, second: 700 }, saved: true }), JSON.stringify(t.prizes));
          assert(t.championCreditCents === 1400, 'the planned box in the columns');
        }
        await ctx.close();
      }
    });

    await check('F game day: Teams opens the team draft above the card', async () => {
      await b.stage('zip87_gameday');
      const { page, ctx } = await b.adminHome({ width: 390 });
      await openCard(page);
      await page.locator('[data-tm87-teams]').click();
      await page.waitForTimeout(900);
      const top = await page.locator('[data-tm-draft-prompt], [data-tm-draft-card]').first().evaluate((e) => e.getBoundingClientRect().top);
      assert(top >= -2 && top < 300, `the draft is on screen (${top})`);
      await ctx.close();
      // Americano on game day (Alex, round 2): no draft, so Rounds is soft green with the real count, never amber.
      const t = (await b.call('GET', '/api/admin/dashboard')).tournament;
      await b.call('PUT', `/api/admin/tournament/${t.id}`, { name: t.name, dates: t.offeredDates, ticketCents: t.ticketCents, creditCents: t.championCreditCents, visibility: t.visibility, format: 'americano' });
      const t2 = (await b.call('GET', '/api/admin/dashboard')).tournament;
      assert(t2.format === 'americano' && t2.rounds, 'switched to Americano with rounds');
      for (const scheme of ['light', 'dark']) {
        const am = await b.adminHome({ width: 390, scheme });
        await openCard(am.page);
        const r = am.page.locator('[data-tm87-rounds]');
        assert((await r.getAttribute('data-tm87-rounds')) === 'soft', `Rounds tone ${await r.getAttribute('data-tm87-rounds')}`);
        assert(flat(await r.textContent()) === `Rounds${t2.rounds.plan.rounds} rounds ready`, flat(await r.textContent()));
        await am.page.locator('.tm87').screenshot({ path: path.join(SHOTS, `F-americano-${scheme}.png`) });
        await am.ctx.close();
      }
    });
    await check('G one Save for every setting: name, players you expect and Pay by in one tap; the server holds all three', async () => {
      await b.stage('zip87_early');
      const { page, ctx } = await b.adminHome({ width: 390 });
      await openCard(page);
      await page.locator('.tm87-gear').click();
      await page.waitForTimeout(500);
      const sheet = page.locator('[data-tm86-change-sheet]');
      await sheet.locator('[data-tm-name]').fill('The Cold Open 2');
      await sheet.locator('[data-tm-expect-minus]').click();
      await sheet.locator('[data-tm-pay-time]').selectOption(String(18 * 60));
      await sheet.locator('[data-tm86-save]').click();
      await page.waitForFunction(() => !document.querySelector('[data-tm86-change-sheet]'), null, { timeout: 8000 });
      const t = (await b.call('GET', '/api/admin/dashboard')).tournament;
      assert(t.name === 'The Cold Open 2', `name ${t.name}`);
      assert(t.expected === 9, `expected ${t.expected}`);
      assert(/T23:00:00/.test(t.payBy), `pay by ${t.payBy}`);
      // The prize boxes and the price are untouched by the settings save.
      assert(t.ticketCents === 1800 && t.championCreditCents === 0, 'price and prizes as they were');
      await ctx.close();
    });

    await check('H the Players sheet: tickets, Levels with pencils, Projected teams; no Plan, Pick the date, Settings, Edit or Cancel; no Edit page anywhere', async () => {
      await b.stage('zip87_early');
      for (const scheme of ['light', 'dark']) {
        const { page, ctx } = await b.adminHome({ width: 390, scheme });
        await openCard(page);
        await page.locator('.tm86-grid [data-tm-tickets]').click();
        await page.waitForTimeout(500);
        const cards = await page.locator('[data-tm-page="players"] > section').evaluateAll((els) => els.map((e) => e.getAttribute('data-tm-card')));
        assert(JSON.stringify(cards) === JSON.stringify(['tickets', 'levels', 'projected']), `cards ${cards}`);
        assert((await page.locator('[data-tm-page="players"] [data-tm-pencil]').count()) === 10, 'a pencil per player');
        assert((await page.locator('[data-tm-edit-settings], [data-tm-card="plan"], [data-tm-card="settings"], [data-tm-card="dates"], [data-tm-cancel-or-reschedule], [data-tm-cancel]').count()) === 0, 'nothing else');
        await page.locator('[data-tm-page="players"]').screenshot({ path: path.join(SHOTS, `H-players-${scheme}.png`) });
        await ctx.close();
      }
      // Settings > Schedule: the tournament's row opens the same settings sheet (no Edit page).
      const { page, ctx } = await b.adminHome({ width: 390 });
      await page.locator('.tabbar a, .tabbar button').filter({ hasText: 'Settings' }).first().click();
      await page.waitForTimeout(600);
      const row = page.locator('[data-tm-open-row]');
      if (await row.count()) {
        // (The row sits in a folded Settings section; a click by script opens it the way a tap does.)
        await row.evaluate((e) => e.click());
        await page.waitForTimeout(500);
        assert((await page.locator('[data-tm86-change-sheet]').count()) === 1, 'the settings sheet');
      }
      assert((await page.locator('[data-tm-form="edit"]').count()) === 0, 'no Edit page');
      await ctx.close();
    });

    await check('I sign-up stage: the gear has the dates offered and the start facts, Cancel only; the gear is the Settings tab gear, crisp and centered', async () => {
      await b.stage('signup');
      for (const scheme of ['light', 'dark']) {
        const { page, ctx } = await b.adminHome({ width: 390, scheme });
        await openCard(page);
        const g = await page.locator('.tm87-gear').evaluate((e) => {
          const r = e.getBoundingClientRect();
          const i = e.querySelector('svg').getBoundingClientRect();
          return { w: r.width, h: r.height, icon: e.querySelector('svg').getAttribute('data-icon'), dx: i.left + i.width / 2 - (r.left + r.width / 2), dy: i.top + i.height / 2 - (r.top + r.height / 2), bg: getComputedStyle(e).backgroundColor };
        });
        // The same gray as the other round buttons (the sheets' close button): the --fill token.
        const tab = await page.evaluate(() => {
          const x = document.createElement('span');
          x.style.background = 'var(--fill)';
          document.querySelector('.tm87').appendChild(x);
          const c = getComputedStyle(x).backgroundColor;
          x.remove();
          return c;
        });
        assert(g.w === 44 && g.h === 44 && g.icon === 'gear' && Math.abs(g.dx) <= 0.5 && Math.abs(g.dy) <= 0.5, `gear ${JSON.stringify(g)}`);
        assert(g.bg === tab, `the same gray (${g.bg} vs ${tab})`);
        await page.locator('.tm87-gear').click();
        await page.waitForTimeout(500);
        const sheet = page.locator('[data-tm86-change-sheet]');
        const words = flat(await sheet.textContent());
        assert(words.includes('Start time7 to 7:30 PM, by players') && words.includes('Ends10 PM close'), words);
        assert((await sheet.locator('[data-tm87-offer]').count()) === 1, 'dates offered');
        assert((await sheet.locator('[data-tm-reschedule]').count()) === 0 && (await sheet.locator('[data-tm-cancel-tournament]').count()) === 1, 'Cancel only');
        await sheet.locator('[data-tm87-offer-toggle]').click();
        await page.waitForTimeout(300);
        await page.screenshot({ path: path.join(SHOTS, `I-signup-settings-${scheme}.png`) });
        await ctx.close();
      }
    });
    await check('J the court picker is the venue map (tap saves with Undo, current lit, Clear); the game menu: Text the group, Edit game, Cancel game', async () => {
      await b.stage('zip86_home');
      for (const scheme of ['light', 'dark']) {
        const { page, ctx, errors } = await b.adminHome({ width: 390, scheme });
        const first = page.locator('.scard86').first();
        await first.locator('.r86-court').click();
        await page.waitForTimeout(500);
        const map = page.locator('[data-court-map="pick"]');
        assert((await map.count()) === 1, 'the court map opens');
        assert((await map.locator('[data-court-cell]').count()) === 16 && (await map.textContent()).includes('ENTRANCE'), 'the venue map');
        // The current court is lit (Court 4 from the stage; the dark pass sees the 9 the light pass saved).
        const now = flat(await first.locator('.r86-court').textContent()).replace('Court ', '');
        const lit = await map.locator('[data-court-cell]').evaluateAll((els) => els.filter((e) => e.getAttribute('aria-pressed') === 'true' && e.classList.contains('me')).map((e) => e.dataset.courtCell));
        assert(JSON.stringify(lit) === JSON.stringify([now]) && (scheme === 'dark' || now === '4'), `current court lit (${lit}, Court ${now})`);
        assert(flat(await map.locator('[data-court-clear]').textContent()) === 'Clear', 'Clear');
        assert((await page.locator('.r86-picker, .r86-pick').count()) === 0, 'the plain grid is gone');
        await page.screenshot({ path: path.join(SHOTS, `J-map-${scheme}.png`) });
        if (scheme === 'light') {
          // One tap saves (after the Undo window when Undo is on), and the button shows it at once.
          await map.locator('[data-court-cell="9"]').click();
          assert(flat(await first.locator('.r86-court').textContent()) === 'Court 9', 'Court 9 at once');
          await page.waitForTimeout(7000);
          const id = (await first.getAttribute('id')).replace('session-', '');
          const sv = (await b.call('GET', '/api/admin/dashboard')).sessions.find((x) => x.id === id);
          assert(sv.courtNum === 9, `court 9 saved (${sv.courtNum})`);
        } else await page.keyboard.press('Escape');
        await page.waitForTimeout(400);
        // The game menu: no Players, no Add to calendar (a booked game).
        await first.locator('.game-menu .icon-round').click();
        await page.waitForTimeout(300);
        const rows = (await page.locator('[role="menu"]').getByRole('menuitem').allInnerTexts()).map((x) => flat(x));
        const want = rows.includes('Text the players') ? ['Text the group', 'Text the players', 'Edit game', 'Cancel game'] : ['Text the group', 'Edit game', 'Cancel game'];
        assert(JSON.stringify(rows) === JSON.stringify(want), `menu ${JSON.stringify(rows)}`);
        await page.screenshot({ path: path.join(SHOTS, `J-menu-${scheme}.png`) });
        assert(errors.length === 0, errors.join('; '));
        await ctx.close();
      }
    });
  } finally {
    await b.close();
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
