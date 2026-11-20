/* Zip 74 (🎾74.polish): the 🎾73 audit's fixes and the game night polish, in a real browser.
 *
 *   node e2e/zip74.cjs            (ZIP74_ONLY=<letter> runs one check)
 *
 * The world is the preview's calm profile as of Thu Nov 19 2026, 10:00 AM Eastern (e2e/zip74-boot.cjs), and the Tournament test stages.
 *   A  names never cut, never split inside a word: Americano Your rounds ("With Christopher Vanderberg", "vs ... + ..."), Your games,
 *      Standings, Currently playing (both styles), Also now; the score tag and the kicker stay on one line. 320/390/420, light and dark.
 *   B  the organizer's All rounds and Fix sheet at 320: no name cut or split inside a word.
 *   C  the ticket's Pay sheet in dark mode: Copy Venmo is light green on the dark sheet (real contrast); light unchanged.
 *   D  pictures pair-1 and pair-2: Your team has one "Edit name" (no pencil, no dice); the "Team name" sheet: the box with the name,
 *      "Need help? Randomize a name" puts a new name in the box and saves nothing; Save saves it. Light and dark, 390 and 320.
 *   E  pictures pair-3 and pair-4: Alex shortens to 9 at Round 2: the amber alert "Starting Round 2, all games go to 9 points." for every
 *      player, "Play to 9 points" on the Up next card, "Play to 9" beside the shortened games (no "· to 9"); X hides it (also after a
 *      reload); to 7 at Round 3 shows a new alert. The Final row has no pill. Americano: the same alert and pills. 320/390/420, light and dark.
 *   F  picture pair-5: the Final is set: Vic (in it) sees "You're in the Final! It goes to 11 points." / "Head to Court 1."; Rowan (3rd place)
 *      does not. The Final's VS card has no Play to pill. Light and dark.
 *   G  picture pair-6: Back out before Pay by: "Back out of The Cold Open?", the short words; after Pay by below 8 (Parker): the one money
 *      line, Stay signed up / Yes, back out. Never "the The". 390 and 320, light and dark.
 * Screenshots: .data/zip74-shots (not in git).
 */
const path = require('node:path');
const { mkdirSync } = require('node:fs');
const { boot, flat, assert, ROOT } = require('./zip74-boot.cjs');

const SHOTS = path.join(ROOT, '.data', 'zip74-shots');
const ONLY = process.env.ZIP74_ONLY || '';
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
const SIZES = [420, 390, 320];
const SCHEMES = ['light', 'dark'];

/** In the page: every element matching `sel` shows all its text (nothing cut by an ellipsis or hidden overflow) and no word of it is split
 *  across two lines. Returns the problems. */
const wholeNames = (page, sel) =>
  page.evaluate((s) => {
    const bad = [];
    for (const el of document.querySelectorAll(s)) {
      const cs = getComputedStyle(el);
      if (cs.textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth + 1) bad.push(`cut: ${el.textContent}`);
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const text = n.textContent;
        const re = /\S+/g;
        let m;
        while ((m = re.exec(text))) {
          const r = document.createRange();
          r.setStart(n, m.index);
          r.setEnd(n, m.index + m[0].length);
          const tops = new Set([...r.getClientRects()].filter((x) => x.width > 0).map((x) => Math.round(x.top)));
          if (tops.size > 1) bad.push(`split: "${m[0]}" in "${el.textContent}"`);
        }
      }
    }
    return bad;
  }, sel);
/** One line: the element's height is about one line of its own text. */
const oneLine = (page, sel) =>
  page.evaluate((s) => {
    const bad = [];
    for (const el of document.querySelectorAll(s)) {
      const lh = parseFloat(getComputedStyle(el).lineHeight) || parseFloat(getComputedStyle(el).fontSize) * 1.3;
      const rects = new Set([...(() => {
        const r = document.createRange();
        r.selectNodeContents(el);
        return r.getClientRects();
      })()].filter((x) => x.width > 0).map((x) => Math.round(x.top)));
      if (rects.size > 1 || el.getBoundingClientRect().height > lh * 1.9) bad.push(el.textContent);
    }
    return bad;
  }, sel);

async function main() {
  mkdirSync(SHOTS, { recursive: true });
  const h = await boot();
  const tid = async () => (await h.call('GET', '/api/admin/dashboard')).tournament.id;
  const apply = async (fromRound, to) => h.call('POST', `/api/admin/tournament/${await tid()}/games`, { action: 'apply', fromRound, to });

  await check('A names never cut or split; score tags and kickers on one line (both styles, 420/390/320, light and dark)', async () => {
    for (const st of ['am_round3', 'final_on', 'mid']) {
      await h.stage(st);
      for (const width of SIZES)
        for (const scheme of SCHEMES) {
          const p = await h.playerPage('Vic', { width, scheme, height: 900 });
          const bad = await wholeNames(p.page, '.tc-gd-main b, .tc-gd-main > span, .tc-gd-tn > b, .tc-gd-tn > span, .tc-gd-pname > b, .tc-also-body b, .tc-also-body span, .tc-tie-btn, button.tc-tie-spin');
          assert(bad.length === 0, `${st} ${width} ${scheme}: ${bad.slice(0, 4).join(' | ')}`);
          const lines = await oneLine(p.page, '[data-tc-day-result], .tc-gd-playto, .tc-gd-court, .tc-gd-rec, .tc-gd-pts');
          assert(lines.length === 0, `${st} ${width} ${scheme} wraps: ${lines.slice(0, 4).join(' | ')}`);
          await h.noWider(p.page, `${st} ${width} ${scheme}`);
          if (width === 320) await p.page.screenshot({ path: path.join(SHOTS, `A-${st}-${width}-${scheme}.png`), fullPage: true });
          assert(p.errors.length === 0, p.errors.join('; '));
          await p.ctx.close();
        }
    }
    // The Americano picture's long name: "With Christopher Vanderberg" whole (Vic's rounds include him at some point in am_round3's draw).
    await h.stage('am_round3');
    const p = await h.playerPage('Vic', { width: 320 });
    const withs = (await p.page.locator('.tc-gd-with').allInnerTexts()).map(flat);
    assert(withs.every((w) => !w.includes('…')), withs.join(' | '));
    await p.ctx.close();
  });

  await check('B the organizer at 320: All rounds and the Fix sheet keep names whole', async () => {
    await h.stage('am_round3');
    for (const scheme of SCHEMES) {
      const a = await h.adminHome({ width: 320, scheme });
      await a.page.locator('[data-tm-am-all]').first().click();
      await a.page.locator('[data-tm-am-all-sheet]').waitFor({ timeout: 5000 });
      const bad = await wholeNames(a.page, '[data-tm-am-all-sheet] .tm-gd-side > b');
      assert(bad.length === 0, `All rounds ${scheme}: ${bad.slice(0, 4).join(' | ')}`);
      await a.page.screenshot({ path: path.join(SHOTS, `B-all-${scheme}.png`) });
      await a.ctx.close();
      const b = await h.adminHome({ width: 320, scheme });
      await b.page.locator('[data-tm-am-fix]').first().click();
      await b.page.locator('[data-tm-am-fix-sheet]').waitFor({ timeout: 5000 });
      const bad2 = await wholeNames(b.page, '.tm-am-step-name');
      assert(bad2.length === 0, `Fix ${scheme}: ${bad2.join(' | ')}`);
      await b.page.screenshot({ path: path.join(SHOTS, `B-fix-${scheme}.png`) });
      await b.ctx.close();
    }
  });

  await check('C the ticket Pay sheet: Copy Venmo has real contrast in dark mode', async () => {
    await h.stage('tickets_open');
    for (const scheme of SCHEMES) {
      const p = await h.playerPage('Vic', { width: 390, scheme });
      await p.page.locator('[data-tc-lock]').first().click();
      const b = p.page.locator('[data-copy-venmo]');
      await b.waitFor({ timeout: 8000 });
      const c = await b.evaluate((el) => getComputedStyle(el).color);
      if (scheme === 'dark') assert(c === 'rgb(127, 217, 163)', `dark: light green text, got ${c}`);
      else assert(c === 'rgb(30, 106, 72)', `light unchanged, got ${c}`);
      await p.page.screenshot({ path: path.join(SHOTS, `C-pay-${scheme}.png`) });
      await p.ctx.close();
    }
  });

  await check('D pictures pair-1 and pair-2: Edit name, the Team name sheet, Randomize fills the box, Save saves (light and dark)', async () => {
    await h.stage('teams_published');
    for (const [width, scheme] of [[390, 'light'], [390, 'dark'], [320, 'light']]) {
      const p = await h.playerPage('Vic', { width, scheme, height: 1000 });
      const tc = p.page.locator('[data-tc-day-team-card]');
      await tc.waitFor({ timeout: 10000 });
      assert((await tc.locator('[data-tc-team-pencil], [data-tc-team-dice]').count()) === 0, 'no pencil, no dice');
      const edit = tc.locator('[data-tc-team-edit]');
      assert(flat(await edit.innerText()) === 'Edit name', 'Edit name');
      const eb = await edit.boundingBox();
      const nb = await tc.locator('.tc-gd-tn b').first().boundingBox();
      assert(eb.x > nb.x + nb.width - 2, 'on the right of the name');
      await tc.scrollIntoViewIfNeeded();
      await p.page.screenshot({ path: path.join(SHOTS, `D-card-${width}-${scheme}.png`) });
      await edit.click();
      const sheet = p.page.locator('dialog[open]').filter({ has: p.page.locator('[data-tc-team-sheet]') });
      await sheet.waitFor({ timeout: 5000 });
      assert(flat(await sheet.innerText()).startsWith('Team name'), 'title Team name');
      const box = sheet.locator('[data-tc-team-input]');
      const current = flat(await tc.locator('.tc-gd-tn b').first().innerText());
      assert((await box.inputValue()) === current, `the box holds the name: ${await box.inputValue()} / ${current}`);
      assert(flat(await sheet.locator('[data-tc-team-random]').innerText()) === 'Need help? Randomize a name', 'Randomize link');
      await sheet.locator('[data-tc-team-random]').click();
      await p.page.waitForFunction((was) => document.querySelector('[data-tc-team-input]').value !== was, current, { timeout: 5000 });
      const rolled = await box.inputValue();
      assert(!['Third Shot Gang', 'Kitchen Crew', 'Dill With It'].includes(rolled), `a free name: ${rolled}`);
      await p.page.screenshot({ path: path.join(SHOTS, `D-sheet-${width}-${scheme}.png`) });
      const saved = (await h.call('GET', '/api/admin/dashboard')).tournament.day.teams.map((x) => x.name);
      assert(saved.includes(current) && !saved.includes(rolled), 'Randomize saved nothing');
      await h.noWider(p.page, `D ${width} ${scheme}`);
      assert(p.errors.length === 0, p.errors.join('; '));
      if (scheme === 'dark') {
        await box.fill('Dink Tanks');
        await sheet.locator('[data-tc-team-save]').click();
        await p.page.locator('[data-tc-day-team-card]', { hasText: 'Dink Tanks' }).waitFor({ timeout: 8000 });
        const now = (await h.call('GET', '/api/admin/dashboard')).tournament.day.teams.map((x) => x.name);
        assert(now.includes('Dink Tanks'), 'saved');
      }
      await p.ctx.close();
    }
  });

  await check('E pictures pair-3 and pair-4: Play to 9 at Round 2: the alert for everyone, the pills, X hides it, to 7 is a new alert (420/390/320, light and dark)', async () => {
    await h.stage('mid');
    await apply(2, 9);
    for (const width of SIZES)
      for (const scheme of SCHEMES) {
        const p = await h.playerPage('Vic', { width, scheme, height: 1100 });
        const al = p.page.locator('[data-short-alert]');
        await al.waitFor({ timeout: 8000 });
        const words = flat(await al.innerText());
        assert(words.includes('Starting Round 2, all games go to 9 points.') && words.includes('We’re running behind, so games are shorter.'), words);
        const big = p.page.locator('[data-tc-day-next] .tc-gd-playto-big');
        assert(flat(await big.innerText()) === 'Play to 9 points', 'the Up next pill');
        const card = await p.page.locator('[data-tc-day-next]').boundingBox();
        const pb = await big.boundingBox();
        assert(Math.abs(pb.x + pb.width / 2 - (card.x + card.width / 2)) < 3, 'centered');
        const rows = p.page.locator('[data-tc-day-game]');
        const texts = (await rows.allInnerTexts()).map(flat);
        assert(texts.filter((t) => t.includes('Play to 9')).length === 2, `two shortened rows: ${texts.join(' | ')}`);
        assert(!texts.some((t) => /· to 9/.test(t)), 'no "· to 9" left');
        assert(!texts.find((t) => t.startsWith('Final')).includes('Play to'), 'the Final row has no pill');
        assert((await p.page.locator('[data-tc-day-time]').count()) === 0, 'no repeated Time check line');
        await h.noWider(p.page, `E ${width} ${scheme}`);
        await p.page.screenshot({ path: path.join(SHOTS, `E-${width}-${scheme}.png`) });
        assert(p.errors.length === 0, p.errors.join('; '));
        await p.ctx.close();
      }
    // Every player on the night sees it (one from each team).
    for (const who of ['Parker', 'Rowan', 'Sage']) {
      const p = await h.playerPage(who, { width: 390 });
      await p.page.locator('[data-short-alert]').waitFor({ timeout: 8000 });
      await p.ctx.close();
    }
    // X hides it, and it stays hidden after a reload; a second shortening (to 7 from Round 3) is a new alert.
    const p = await h.playerPage('Vic', { width: 390 });
    await p.page.locator('[data-short-alert] .ac-x, [data-short-alert] button[aria-label]').last().click();
    await p.page.waitForTimeout(300);
    assert((await p.page.locator('[data-short-alert]').count()) === 0, 'X hides it');
    await p.page.reload();
    await p.page.locator('[data-tc-day]').first().waitFor({ timeout: 15000 });
    await p.page.waitForTimeout(800);
    assert((await p.page.locator('[data-short-alert]').count()) === 0, 'still hidden after a reload');
    await apply(3, 7);
    await p.page.reload();
    await p.page.locator('[data-short-alert]').waitFor({ timeout: 8000 });
    assert(flat(await p.page.locator('[data-short-alert]').innerText()).includes('Starting Round 3, all games go to 7 points.'), 'the new alert');
    await p.ctx.close();
    // Americano: the same alert and the pills.
    await h.stage('am_round3');
    await apply(3, 9);
    for (const scheme of SCHEMES) {
      const a = await h.playerPage('Vic', { width: 390, scheme, height: 1100 });
      await a.page.locator('[data-short-alert]').waitFor({ timeout: 8000 });
      assert(flat(await a.page.locator('[data-short-alert]').innerText()).includes('Starting Round 3, all games go to 9 points.'), 'Americano alert');
      assert((await a.page.locator('[data-tc-round] .tc-gd-playto').count()) >= 1, 'Americano row pills');
      await a.page.screenshot({ path: path.join(SHOTS, `E-am-${scheme}.png`) });
      await a.ctx.close();
    }
  });

  await check('F picture pair-5: the Final alert for the 4 players in it only (light and dark)', async () => {
    await h.stage('final_on');
    for (const scheme of SCHEMES) {
      const p = await h.playerPage('Vic', { width: 390, scheme });
      const al = p.page.locator('[data-final-alert]');
      await al.waitFor({ timeout: 8000 });
      const words = flat(await al.innerText());
      assert(words.includes('You’re in the Final! It goes to 11 points.') && /Head to Court \d\./.test(words), words);
      assert((await p.page.locator('[data-tc-day-next] .tc-gd-playto').count()) === 0, 'the Final has no Play to pill');
      await p.page.screenshot({ path: path.join(SHOTS, `F-${scheme}.png`) });
      await p.ctx.close();
    }
    for (const who of ['Wren', 'Parker', 'Quinn']) {
      const p = await h.playerPage(who, { width: 390 });
      await p.page.locator('[data-final-alert]').waitFor({ timeout: 8000 });
      await p.ctx.close();
    }
    for (const who of ['Rowan', 'Sage']) {
      const p = await h.playerPage(who, { width: 390 });
      await p.page.waitForTimeout(500);
      assert((await p.page.locator('[data-final-alert]').count()) === 0, `${who} is not in the Final`);
      await p.ctx.close();
    }
  });

  await check('G picture pair-6: the back out sheet before and after Pay by, never "the The" (390/320, light and dark)', async () => {
    for (const [st, who] of [['zip70_start', 'Parker'], ['zip70_late', 'Parker']]) {
      await h.stage(st);
      for (const width of [390, 320])
        for (const scheme of SCHEMES) {
          const p = await h.playerPage(who, { width, scheme });
          await p.page.locator('[data-tc-drop]').click();
          const d = p.page.locator('dialog[open]');
          await d.waitFor({ timeout: 5000 });
          const text = flat(await d.innerText());
          assert(text.startsWith('Back out of The Cold Open?'), text.slice(0, 60));
          assert(!/the The/.test(text), 'never "the The"');
          assert(text.includes('Stay signed up') && text.includes('Yes, back out'), 'the two buttons');
          if (st === 'zip70_late') {
            const keep = flat(await d.locator('[data-tm-backout-keeps]').innerText());
            assert(keep === 'Backing out now means no credit back, unless someone takes your spot. Below 8 players we lose the second court, which is already paid for.', keep);
            assert((await d.locator('[data-tm-backout-text]').count()) === 0, 'only the money line');
          } else {
            const w = flat(await d.locator('[data-tm-backout-text]').innerText());
            assert(w.startsWith('You come off the list. You can sign up again if you change your mind.'), w);
          }
          await h.noWider(p.page, `G ${st} ${width} ${scheme}`);
          await p.page.screenshot({ path: path.join(SHOTS, `G-${st}-${width}-${scheme}.png`) });
          await p.ctx.close();
        }
    }
  });

  await h.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
