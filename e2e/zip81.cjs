/* Zip 81 (🎾81.venue hours): special venue hours in a real browser.
 *
 *   node e2e/zip81.cjs            (ZIP81_ONLY=<letter> runs one check)
 *
 * The world is the preview's calm profile as of Fri Nov 20 2026, 12 PM Eastern (e2e/zip74-boot.cjs), then the Tournament test stage
 * "Venue hours: winter set and holidays" (the flyers' hours and a game on Thu Nov 26 at 8 PM).
 *   A  Home: the amber card first ("Thu Nov 26: the venue closes at noon." / "Your 8 PM game is after that.", Cancel game) at 320/390/420,
 *      light and dark; no page wider than the screen; the Nov 26 game card has no "hours confirmed?" question.
 *   B  Settings > Schedule: the row and its hint; Change: the normal line, the six entries soonest first, Christmas Closed in red; a tap opens
 *      a row in place (Edit, Remove), a second tap closes it. 320/390/420, light and dark.
 *   C  Add special hours: Dates (From, To, seven day rows), One day (Open with hours, Closed); save one, edit it, remove it.
 *   D  Add game: Thanksgiving's Start grid stops at 10:30 AM; Christmas says the venue is closed (the server refusals: tests/zip81-venue-hours).
 *   E  The fake clock: Feb 1 2027: the hint says None, no card. Back to Nov 20: Cancel game on the card cancels the game and the card goes.
 *   F  The tournament: finalized 7:30 to 10 PM, a one-day entry closing at 9 PM on its date: "Your tournament ends after that.", Change time
 *      opens the Time row with the hours line and Save off.
 *   G  On Dec 1 (Winter hours running): Edit Winter hours, change Friday's close, Save: it saves (no browser date check in the way).
 * Screenshots: .data/zip81-shots (not in git).
 */
const path = require('node:path');
const { mkdirSync } = require('node:fs');
const { boot, flat, assert, ROOT } = require('./zip74-boot.cjs');

const SHOTS = path.join(ROOT, '.data', 'zip81-shots');
const ONLY = process.env.ZIP81_ONLY || '';
const NOW = Date.parse('2026-11-20T17:00:00.000Z'); // Fri Nov 20, 12 PM EST
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
  const h = await boot({ port: Number(process.env.E2E_PORT) || 5481, name: 'zip81', seedIso: '2026-11-20T14:00:00.000Z', nowMs: NOW });
  const shot = (page, name, full = false) => page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: full });
  const tab = (page, name) => page.locator('.tabbar button, .tab-bar button', { hasText: name }).first().click();
  async function openSchedule(page) {
    await tab(page, 'Settings');
    const sect = page.locator('details[data-section="schedule"]');
    await sect.waitFor({ timeout: 10000 });
    if (!(await sect.evaluate((el) => el.open))) await sect.locator('summary').click();
    await page.locator('[data-row="specialHours"]').waitFor({ timeout: 10000 });
  }
  /** Save at the bottom of a sheet: scroll it in and let the sheet settle first (a tap during the scroll lands on the sheet's edge). */
  const tapSave = async (page) => {
    const sv = page.locator('[data-vh-save]');
    await sv.scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);
    await sv.click();
  };
  await h.stage('venue_winter');

  await check('A Home card', async () => {
    for (const width of [320, 390, 420]) {
      for (const scheme of ['light', 'dark']) {
        const a = await h.adminHome({ width, scheme });
        // Two games are outside their day's hours on the preview: Thu Nov 26 (noon close) and Thu Dec 24 (2 PM close), soonest first.
        const cards = a.page.locator('[data-venue-conflict="game"]');
        await cards.first().waitFor({ timeout: 10000 });
        assert((await cards.count()) === 2, `cards: ${await cards.count()}`);
        assert(flat(await cards.nth(1).innerText()).includes('Thu Dec 24: the venue closes at 2 PM.'), 'the Christmas Eve card second');
        const card = cards.first();
        const text = flat(await card.innerText());
        assert(text.includes('Thu Nov 26: the venue closes at noon.') && text.includes('Your 8 PM game is after that.'), `the words: ${text}`);
        const btn = card.locator('[data-vh-cancel]');
        assert(flat(await btn.innerText()) === 'Cancel game', 'Cancel game');
        assert(Math.round((await btn.boundingBox()).height) >= 44, 'the button is 44 px or more');
        // First on Home: nothing above it in the main column.
        const top = await card.boundingBox();
        const firstOther = await a.page.locator('main section, main article').first().boundingBox();
        assert(top.y <= firstOther.y + 1, 'the card is first on Home');
        await h.noWider(a.page, `Home ${width} ${scheme}`);
        await shot(a.page, `A-home-${width}-${scheme}`);
        if (width === 390 && scheme === 'light') {
          assert((await a.page.locator('[data-holiday="ask"]').count()) === 0, 'Thanksgiving still asks "hours confirmed?"');
          await btn.click();
          await a.page.getByRole('dialog').first().waitFor({ timeout: 5000 });
          await shot(a.page, 'A-cancel-dialog');
        }
        assert(a.errors.length === 0, a.errors.join('; '));
        await a.ctx.close();
      }
    }
  });

  await check('B Settings row and list', async () => {
    for (const width of [320, 390, 420]) {
      for (const scheme of ['light', 'dark']) {
        const a = await h.adminHome({ width, scheme });
        await openSchedule(a.page);
        const hint = flat(await a.page.locator('[data-special-hint]').innerText());
        assert(hint === 'Winter hours from Nov 23 · 5 holidays', `hint: ${hint}`);
        await h.noWider(a.page, `Settings ${width} ${scheme}`);
        await shot(a.page, `B-row-${width}-${scheme}`);
        await a.page.locator('[data-special-change]').click();
        const list = a.page.locator('[data-vh-list]');
        await list.waitFor({ timeout: 5000 });
        assert(flat(await a.page.locator('[data-vh-normal]').innerText()) === 'Normal: Mon to Sat 8 AM to 10 PM · Sun 8 AM to 7 PM', 'normal line');
        const names = await a.page.locator('[data-vh-item] .vh-name').allInnerTexts();
        assert(JSON.stringify(names) === JSON.stringify(['Winter hours', 'Thanksgiving', 'Christmas Eve', 'Christmas', 'New Year’s Eve', 'New Year’s Day']), `order: ${names}`);
        const closed = a.page.locator('[data-vh-closed]');
        assert((await closed.count()) === 1, 'one Closed');
        const red = await closed.evaluate((el) => getComputedStyle(el).color);
        assert(red !== (await a.page.locator('[data-vh-item="Christmas"] .vh-sub').evaluate((el) => getComputedStyle(el).color)), 'Closed is not red');
        const thanks = a.page.locator('[data-vh-item="Thanksgiving"] [data-vh-toggle]');
        assert(flat(await thanks.innerText()) === 'Thanksgiving Thu Nov 26 · 8 AM to noon', `row: ${flat(await thanks.innerText())}`);
        await thanks.click();
        await a.page.locator('[data-vh-edit]').waitFor({ timeout: 3000 });
        assert((await a.page.locator('[data-vh-remove]').count()) === 1, 'Remove');
        await h.noWider(a.page, `list ${width} ${scheme}`);
        await shot(a.page, `B-list-${width}-${scheme}`);
        // (The site drops a second tap on the same button within 0.4 s, on purpose: wait like a person would.)
        await a.page.waitForTimeout(600);
        await thanks.click();
        await a.page.waitForTimeout(200);
        assert((await a.page.locator('[data-vh-edit]').count()) === 0, 'a second tap closes it');
        assert(a.errors.length === 0, a.errors.join('; '));
        await a.ctx.close();
      }
    }
  });

  await check('C Add, edit, remove', async () => {
    for (const scheme of ['light', 'dark']) {
      const a = await h.adminHome({ width: 390, scheme });
      await openSchedule(a.page);
      await a.page.locator('[data-special-change]').click();
      await a.page.locator('[data-vh-add]').click();
      await a.page.locator('[data-vh-form="add"]').waitFor();
      assert((await a.page.locator('[data-vh-day]').count()) === 7, 'seven day rows');
      await shot(a.page, `C-dates-${scheme}`, true);
      await a.page.locator('[data-vh-kind="day"]').click();
      await a.page.locator('[data-vh-date]').waitFor();
      await shot(a.page, `C-oneday-open-${scheme}`);
      await a.page.locator('[data-vh-closed-day]').click();
      assert((await a.page.locator('[data-vh-day-open]').count()) === 0, 'Closed hides the hours');
      await shot(a.page, `C-oneday-closed-${scheme}`);
      await a.ctx.close();
    }
    const a = await h.adminHome({ width: 390 });
    await openSchedule(a.page);
    await a.page.locator('[data-special-change]').click();
    await a.page.locator('[data-vh-add]').click();
    await a.page.locator('[data-vh-name]').fill('Club night');
    await a.page.locator('[data-vh-kind="day"]').click();
    await a.page.locator('[data-vh-date]').fill('2026-12-10');
    await a.page.locator('[data-vh-closed-day]').click();
    await tapSave(a.page);
    await a.page.locator('[data-vh-item="Club night"]').waitFor({ timeout: 5000 });
    assert(flat(await a.page.locator('[data-vh-item="Club night"]').innerText()) === 'Club night Thu Dec 10 · Closed', 'saved row');
    // Two ranges on one date are refused, with the message under the form. (The "saved" toast fades first: it sits where Save is.)
    await a.page.waitForTimeout(4000);
    await a.page.locator('[data-vh-add]').click();
    await a.page.locator('[data-vh-name]').fill('Holidays');
    await a.page.locator('[data-vh-from]').fill('2026-12-20');
    await a.page.locator('[data-vh-to]').fill('2027-01-05');
    await tapSave(a.page);
    await a.page.waitForTimeout(300);
    await shot(a.page, 'C-overlap', true);
    const problem = flat(await a.page.locator('[data-vh-problem]').innerText());
    assert(problem.includes('overlaps Winter hours'), problem);
    await a.page.getByRole('dialog').getByRole('button', { name: 'Close' }).last().click();
    await a.page.locator('[data-vh-list]').waitFor();
    await a.page.locator('[data-vh-item="Club night"] [data-vh-toggle]').click();
    await a.page.locator('[data-vh-edit]').click();
    await a.page.locator('[data-vh-open-day]').click();
    await a.page.locator('[data-vh-day-open]').fill('10:00');
    await a.page.locator('[data-vh-day-close]').fill('18:00');
    await tapSave(a.page);
    await a.page.waitForFunction(() => document.querySelector('[data-vh-item="Club night"]')?.textContent?.includes('10 AM to 6 PM'), null, { timeout: 5000 });
    await a.page.waitForTimeout(600);
    await a.page.locator('[data-vh-item="Club night"] [data-vh-toggle]').click();
    await a.page.locator('[data-vh-remove]').click();
    await a.page.waitForFunction(() => !document.querySelector('[data-vh-item="Club night"]'), null, { timeout: 5000 });
    assert(a.errors.length === 0, a.errors.join('; '));
    await a.ctx.close();
  });

  await check('D Add game', async () => {
    const a = await h.adminHome({ width: 390 });
    await a.page.locator('button', { hasText: 'Add game' }).first().click();
    const date = a.page.locator('.bh-date-input').first();
    await date.waitFor({ timeout: 5000 });
    await date.fill('2026-11-26');
    await a.page.locator('[data-bh-start]').click();
    await a.page.locator('[data-bh-grid]').waitFor();
    const chips = await a.page.locator('[data-chip]').evaluateAll((els) => els.map((e) => e.getAttribute('data-chip')));
    assert(chips[0] === '08:00' && chips[chips.length - 1] === '10:30', `Thanksgiving chips: ${chips[0]} to ${chips[chips.length - 1]}`);
    await shot(a.page, 'D-thanksgiving-grid');
    await a.page.locator('.bh-grid-sheet').getByRole('button', { name: 'Close' }).click();
    await a.page.waitForTimeout(500);
    await date.fill('2026-12-25');
    await a.page.locator('[data-bh-start]').click();
    const note = flat(await a.page.locator('[data-bh-closed]').innerText());
    assert(note === 'The venue is closed on this day (Christmas). Pick another date.', note);
    await shot(a.page, 'D-christmas-grid');
    assert(a.errors.length === 0, a.errors.join('; '));
    await a.ctx.close();
  });

  await check('F Tournament', async () => {
    await h.stage('zip70_start');
    const d = await h.call('GET', '/api/admin/dashboard');
    const t = d.tournament;
    assert(t && t.finalDate, 'a finalized tournament');
    await h.call('POST', '/api/admin/venue-hours/special', { name: 'Early close', oneDay: true, from: t.finalDate, day: { open: 480, close: 1260 } });
    for (const scheme of ['light', 'dark']) {
      const a = await h.adminHome({ width: 390, scheme });
      const card = a.page.locator('[data-venue-conflict="tournament"]');
      await card.waitFor({ timeout: 10000 });
      const text = flat(await card.innerText());
      // 7:30 PM starts before the 9 PM close, so it ENDS after it.
      assert(text.includes('the venue closes at 9 PM.') && text.includes('Your tournament ends after that.'), text);
      await shot(a.page, `F-card-${scheme}`);
      await card.locator('[data-vh-change-time]').click();
      await a.page.locator('[data-tm-time-box]').waitFor({ timeout: 5000 });
      const line = flat(await a.page.locator('[data-tm-hours]').innerText());
      assert(line.startsWith('The venue is open 8:00 AM to 9:00 PM on this day (Early close).'), line);
      assert(await a.page.locator('[data-tm-time-save]').isDisabled(), 'Save is off outside the hours');
      await shot(a.page, `F-time-${scheme}`);
      assert(a.errors.length === 0, a.errors.join('; '));
      await a.ctx.close();
    }
  });

  await check('E Fake clock and Cancel game', async () => {
    // Cancel game on the card: the usual Cancel flow; the card goes.
    await h.stage('venue_winter');
    let a = await h.adminHome({ width: 390 });
    await a.page.locator('[data-venue-conflict="game"]', { hasText: 'Nov 26' }).locator('[data-vh-cancel]').click();
    const dialog = a.page.getByRole('dialog').first();
    await dialog.waitFor();
    await dialog.getByRole('button', { name: 'Cancel game' }).last().click();
    await a.page.waitForFunction(() => ![...document.querySelectorAll('[data-venue-conflict="game"]')].some((c) => c.textContent.includes('Nov 26')), null, { timeout: 10000 });
    await shot(a.page, 'E-after-cancel');
    assert(a.errors.length === 0, a.errors.join('; '));
    await a.ctx.close();
    // The fake clock after the set (Feb 1 2027, signed in again: the jump ends the old sign-in): no card, the hint says None.
    await h.setClock(Date.parse('2027-02-01T17:00:00.000Z'));
    a = await h.newPage({ width: 390 });
    const pin = h.PIN;
    assert((await a.ctx.request.post(h.BASE + '/api/admin/login', { data: { pin }, headers: { Origin: h.BASE } })).ok(), 'login after the jump');
    await a.page.goto(`${h.BASE}/admin`);
    await a.page.locator('.tab-bar, nav').first().waitFor({ timeout: 30000 });
    await a.page.waitForTimeout(1200);
    assert((await a.page.locator('[data-venue-conflict]').count()) === 0, 'no card after the set');
    await openSchedule(a.page);
    assert(flat(await a.page.locator('[data-special-hint]').innerText()) === 'None', 'None after the set');
    await a.ctx.close();
  });

  await check('G Edit a range that already started', async () => {
    // Tue Dec 1 2026: Winter hours started Nov 23. Change Friday's close and Save (the browser's own date check must not block it).
    await h.setClock(Date.parse('2026-12-01T17:00:00.000Z'));
    const a = await h.newPage({ width: 390 });
    assert((await a.ctx.request.post(h.BASE + '/api/admin/login', { data: { pin: h.PIN }, headers: { Origin: h.BASE } })).ok(), 'login');
    assert((await a.ctx.request.post(h.BASE + '/api/admin/tournament-test', { data: { stage: 'venue_winter' }, headers: { Origin: h.BASE } })).ok(), 'stage');
    await a.page.goto(`${h.BASE}/admin`);
    await a.page.locator('.tab-bar, nav').first().waitFor({ timeout: 30000 });
    await openSchedule(a.page);
    assert(flat(await a.page.locator('[data-special-hint]').innerText()) === 'Winter hours to Jan 31 · 4 holidays', 'hint while running (Thanksgiving is over)');
    await a.page.locator('[data-special-change]').click();
    await a.page.locator('[data-vh-item="Winter hours"] [data-vh-toggle]').click();
    await a.page.locator('[data-vh-edit]').click();
    await a.page.locator('[data-vh-close="Fri"]').fill('21:00');
    await tapSave(a.page);
    await a.page.waitForFunction(() => document.querySelector('[data-vh-item="Winter hours"]')?.textContent?.includes('Fri 8 AM to 9 PM'), null, { timeout: 5000 });
    assert(a.errors.length === 0, a.errors.join('; '));
    await a.ctx.close();
  });

  await h.close();
  console.log(`\nzip81: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
