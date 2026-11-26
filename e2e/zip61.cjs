/* Zip 61 (🎾61.americano): the Americano night in a real browser, on the preview's calm world and the Tournament test page's Americano stages
 * (server/tournamentTest.ts). The clock is Thu Nov 19, 2026, 8:00 PM Eastern (game night).
 *
 *   node e2e/zip61.cjs
 *
 *   A  Vic before the night (picture 31): the one-row ticket (Americano line), then Your rounds with Round 4 a Break
 *   B  Vic at Round 3 (picture 32): the hero, the VS card with Enter score, Your rounds (Won / Lost tags), Standings with points, Currently
 *      playing, Show future games; light and dark at 390, 360, 320; no row wraps
 *   C  Enter score (picture 33) and the win motion (picture 36): lime "✓ Let's go!", the slide to the break card, Round 4 of 7, the Won tag,
 *      the banner with Undo and its countdown circle (Zip 71: no drain line), sent after 5 seconds
 *   D  a losing score (picture 37): the white glow and "Onto the next!", the slide, the Lost tag; Undo sends nothing
 *   E  the other side (zip 71, no confirming): the score is in at once; no "Is this right?", no Enter score for that round
 *   F  a break (picture 35): the dark card, who else sits, Currently playing shows every court
 *   G  the organizer: the rounds before the night; on the night the round's scores, Fix with two numbers, Player left, Pause (no Confirm)
 *   H  switched from Locked doubles: "Tournament style is now Americano." and the rounds
 *   I  reduced motion (no glow, no slide), who may see it (switched off: nothing), no em dashes, nothing wider than the screen, no page errors
 * Screenshots: .data/zip61-shots (not in git).
 */
const { spawn, spawnSync } = require('node:child_process');
const { readFileSync, mkdirSync, rmSync } = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.E2E_PORT) || 5468;
const BASE = `http://localhost:${PORT}`;
const SEED_ISO = '2026-11-19T15:00:00.000Z';
const NOW_MS = Date.parse('2026-11-20T01:00:00.000Z'); // Thu Nov 19, 8:00 PM Eastern (game night)
const PIN = /PIN `(\d{6})`/.exec(readFileSync(path.join(ROOT, 'docs/PREVIEW_FAKE_DB.md'), 'utf8'))[1];
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const SHOTS = path.join(ROOT, '.data', 'zip61-shots');

let passed = 0;
let failed = 0;
const ONLY = process.env.ZIP61_ONLY || '';
async function check(name, fn) {
  if (ONLY && !name.includes(ONLY)) return;
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.log(`  ✗ ${name}\n      ${String(err && err.message ? err.message : err).replace(/\s*\n\s*/g, ' ⏎ ').slice(0, 1400)}`);
  }
}
const assert = (c, m) => {
  if (!c) throw new Error(m);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const flat = (t) => String(t).replace(/\s+/g, ' ').trim();
const SIZES = [390, 360, 320];
const SCHEMES = ['light', 'dark'];

async function main() {
  const dbFile = path.join(ROOT, '.data', 'zip61.sqlite');
  mkdirSync(SHOTS, { recursive: true });
  rmSync(dbFile, { force: true });
  const seeded = spawnSync('npx', ['vite-node', 'scripts/load-small-local.ts', '--', dbFile, SEED_ISO, '--calm', '--zip55', '--zip60'], { cwd: ROOT, encoding: 'utf8' });
  if (seeded.status !== 0) throw new Error(`could not build the calm world: ${seeded.stderr || seeded.stdout}`);
  if (await fetch(`${BASE}/api/status`).then((r) => r.ok, () => false)) throw new Error(`port ${PORT} is already in use`);
  const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
    cwd: ROOT,
    env: { ...process.env, DEV_DB: dbFile, SETUP_TOKEN: 'zip61-setup-token-0123456789', DEV_CLOCK: '1', PREVIEW_CALM: 'on', PB_PREVIEW_BUILD: '1' },
    stdio: 'ignore',
    detached: true,
  });
  process.on('exit', () => {
    try {
      process.kill(-server.pid, 'SIGTERM');
    } catch {}
  });
  for (let i = 0; i < 90; i++) {
    if (await fetch(`${BASE}/api/status`).then((r) => r.ok, () => false)) break;
    await sleep(500);
  }
  await fetch(`${BASE}/__dev/clock`, { method: 'POST', body: JSON.stringify({ atMs: NOW_MS }) });
  const browser = await chromium.launch();
  const shift = (ctx) =>
    ctx.addInitScript((delta) => {
      const Real = Date;
      class Shifted extends Real {
        constructor(...x) {
          if (x.length === 0) super(Real.now() + delta);
          else super(...x);
        }
        static now() {
          return Real.now() + delta;
        }
      }
      window.Date = Shifted;
    }, NOW_MS - Date.now());

  const admin = await browser.newContext();
  assert((await admin.request.post(BASE + '/api/admin/login', { data: { pin: PIN }, headers: { Origin: BASE } })).ok(), 'admin login');
  const adminCookies = await admin.cookies();
  const dash = async () => (await admin.request.get(BASE + '/api/admin/dashboard')).json();
  const call = async (method, url, data) => {
    const r = await admin.request.fetch(BASE + url, { method, data, headers: { Origin: BASE } });
    assert(r.ok(), `${method} ${url}: ${r.status()} ${await r.text()}`);
    return r.json();
  };
  const stage = (s) => call('POST', '/api/admin/tournament-test', { stage: s });
  async function answerOf(name) {
    const ctx = await browser.newContext();
    const list = (await (await ctx.request.get(BASE + '/api/group')).json()).players;
    const p = list.find((x) => x.name === name);
    await ctx.request.post(BASE + '/api/me', { data: { playerId: p.id }, headers: { Origin: BASE } });
    const text = await (await ctx.request.get(BASE + '/api/group')).text();
    await ctx.close();
    return { text, data: JSON.parse(text) };
  }
  async function postAs(name, url, data) {
    const ctx = await browser.newContext();
    const list = (await (await ctx.request.get(BASE + '/api/group')).json()).players;
    await ctx.request.post(BASE + '/api/me', { data: { playerId: list.find((x) => x.name === name).id }, headers: { Origin: BASE } });
    const r = await ctx.request.fetch(BASE + url, { method: 'POST', data, headers: { Origin: BASE } });
    const out = { status: r.status(), body: await r.text() };
    await ctx.close();
    return out;
  }
  async function newPage(opts = {}) {
    const { width = 390, scheme = 'light', height = 844, organizer = false, reducedMotion = 'reduce' } = opts;
    const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, colorScheme: scheme, isMobile: true, hasTouch: true, userAgent: UA, reducedMotion });
    await shift(ctx);
    if (organizer) await ctx.addCookies(adminCookies.map((c) => ({ ...c })));
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    return { ctx, page, errors };
  }
  async function playerPage(who, opts = {}) {
    const p = await newPage(opts);
    await p.page.goto(`${BASE}/?as=${encodeURIComponent(who)}`);
    await p.page.locator('.schedule, [data-future-toggle]').first().waitFor({ timeout: 30000 });
    await p.page.reload();
    await p.page.locator('.schedule, [data-future-toggle]').first().waitFor({ timeout: 30000 });
    await p.page.waitForTimeout(700);
    return p;
  }
  async function adminPage(opts = {}) {
    const p = await newPage({ ...opts, organizer: true });
    await p.page.goto(`${BASE}/admin`);
    await p.page.locator('.tabbar').waitFor({ timeout: 30000 });
    await p.page.waitForTimeout(700);
    return p;
  }
  async function fits(page, sel) {
    const r = await page.evaluate((s) => {
      const out = { page: [document.documentElement.scrollWidth, window.innerWidth], bad: [] };
      for (const root of document.querySelectorAll(s)) {
        const box = root.getBoundingClientRect();
        for (const el of root.querySelectorAll('*')) {
          const b = el.getBoundingClientRect();
          if (b.width === 0 || b.height === 0) continue;
          if (getComputedStyle(el).position === 'absolute') continue;
          if (el.matches('[data-tc-day-slide]') || el.closest('.tc-gd-slide-out')) continue;
          if (b.right > box.right + 1 || b.left < box.left - 1) out.bad.push(`${el.tagName}.${el.className} ${Math.round(b.left)}..${Math.round(b.right)} outside ${Math.round(box.left)}..${Math.round(box.right)}`);
        }
      }
      return out;
    }, sel);
    assert(r.page[0] <= r.page[1], `the page is wider than the screen (${r.page[0]} > ${r.page[1]})`);
    assert(r.bad.length === 0, `sticks out: ${r.bad.slice(0, 4).join(' | ')}`);
  }
  /** No piece of text under `sel` runs onto a second line. */
  async function oneLine(page, sel) {
    const bad = await page.evaluate((s) => {
      const out = [];
      for (const root of document.querySelectorAll(s)) {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
          if (!n.textContent.trim()) continue;
          const range = document.createRange();
          range.selectNodeContents(n);
          const tops = new Set([...range.getClientRects()].filter((r) => r.width > 0).map((r) => Math.round(r.top)));
          if (tops.size > 1) out.push(`"${n.textContent.trim()}" on ${tops.size} lines`);
        }
      }
      return out;
    }, sel);
    assert(bad.length === 0, `wraps: ${bad.slice(0, 4).join(' | ')}`);
  }
  /** Zip 74 (the 🎾73 audit: names are never cut): text under `sel` may wrap, but only between words, and nothing is cut with an ellipsis. */
  async function wholeWords(page, sel) {
    const bad = await page.evaluate((s) => {
      const out = [];
      for (const root of document.querySelectorAll(s)) {
        for (const el of [root, ...root.querySelectorAll('*')]) {
          if (getComputedStyle(el).textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth + 1) out.push(`cut: "${el.textContent.trim()}"`);
        }
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
          const re = /\S+/g;
          let m;
          while ((m = re.exec(n.textContent))) {
            const range = document.createRange();
            range.setStart(n, m.index);
            range.setEnd(n, m.index + m[0].length);
            const tops = new Set([...range.getClientRects()].filter((r) => r.width > 0).map((r) => Math.round(r.top)));
            if (tops.size > 1) out.push(`"${m[0]}" split in "${n.textContent.trim()}"`);
          }
        }
      }
      return out;
    }, sel);
    assert(bad.length === 0, `names: ${bad.slice(0, 4).join(' | ')}`);
  }
  const SH = (page, name) => page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
  const noDash = async (page, where) => {
    const text = await page.evaluate(() => document.body.innerText);
    assert(!text.includes('—'), `an em dash on ${where}`);
  };
  const toastBox = (page) => page.locator('.pop.toast');
  const bar = (page) => page.locator('[data-tc-day-progress]').innerText().then((x) => flat(x).toUpperCase());
  const vicRound = async (n) => (await answerOf('Vic')).data.tournament.day.rounds.find((r) => r.round === n);
  /** Enter a score on the open sheet: the two numbers by typing (the − and + are checked in C). */
  async function typeScore(page, mine, theirs) {
    await page.locator('[data-tc-score-num="mine"]').fill(String(mine));
    await page.locator('[data-tc-score-num="theirs"]').fill(String(theirs));
  }

  // ---------------------------------------------------------------- A  before the night
  await stage('am_before');
  for (const scheme of SCHEMES)
    await check(`A before the night (${scheme}): the ticket, then Your rounds; Round 4 is a Break; 390/360/320`, async () => {
      const v = await playerPage('Vic', { scheme });
      await v.page.locator('[data-tc-rounds]').waitFor({ timeout: 20000 });
      const body = flat(await v.page.locator('.tc-wrap').innerText());
      assert(body.includes('Americano (new partner every round)'), 'the format line on the ticket');
      const rows = await v.page.locator('[data-tc-round]').count();
      assert(rows === 7, `7 rounds (Zip 97): ${rows}`);
      assert(flat(await v.page.locator('[data-tc-round="4"]').innerText()) === 'Round 4 Break', await v.page.locator('[data-tc-round="4"]').innerText());
      assert(/^Round 1 Court \d With .+ vs .+ \+ .+$/.test(flat(await v.page.locator('[data-tc-round="1"]').innerText())), await v.page.locator('[data-tc-round="1"]').innerText());
      for (const w of SIZES) {
        await v.page.setViewportSize({ width: w, height: 844 });
        await fits(v.page, '.tc-wrap');
        await wholeWords(v.page, '[data-tc-round]'); // Zip 74: names wrap between words, never cut
        await oneLine(v.page, '[data-tc-round] [data-tc-day-result], [data-tc-round] .tc-gd-court');
        await SH(v.page, `A-before-${w}-${scheme}`);
      }
      await noDash(v.page, 'before the night');
      assert(v.errors.length === 0, v.errors.join(' | '));
      await v.ctx.close();
    });

  // ---------------------------------------------------------------- B  the night at Round 3
  for (const scheme of SCHEMES)
    await check(`B Round 3 (${scheme}): hero, VS card with Enter score, Your rounds, no Standings (Zip 77: the line), Currently playing, Show future games`, async () => {
      await stage('am_round3');
      const v = await playerPage('Vic', { scheme });
      await v.page.locator('[data-tc-day-hero]').waitFor({ timeout: 20000 });
      assert((await bar(v.page)) === 'ROUND 3 OF 7', await bar(v.page));
      const r3 = await vicRound(3);
      const kicker = flat(await v.page.locator('.tc-gd-next-kicker').innerText()).toUpperCase();
      assert(kicker === `ROUND 3 · COURT ${r3.court}`, kicker);
      const vs = flat(await v.page.locator('[data-tc-round-card] .tc-gd-vs').innerText());
      assert(vs === `You + ${r3.partner} VS ${r3.opponents[0]} + ${r3.opponents[1]}`, vs);
      assert(flat(await v.page.locator('[data-tc-enter-score]').innerText()) === 'Enter score', 'Enter score');
      // Rounds 1 and 2: done (green) with a Won or Lost tag; Round 3 next (blue).
      for (const n of [1, 2]) {
        const row = v.page.locator(`[data-tc-round="${n}"]`);
        assert((await row.getAttribute('data-state')) === 'done', `round ${n} done`);
        assert(/^(Won|Lost) \d+\u2013\d+$/.test(flat(await row.locator('.tc-gd-tag').innerText())), `a tag with the score (Zip 72): ${await row.locator('.tc-gd-tag').innerText()}`);
      }
      assert((await v.page.locator('[data-tc-round="3"]').getAttribute('data-state')) === 'next', 'round 3 next');
      // Zip 77: no Standings card for players during the night (the server sends no table); one line at the bottom instead.
      assert((await v.page.locator('[data-tc-day-stand]').count()) === 0, 'a table during the night');
      assert(flat(await v.page.locator('[data-tc-standings-later]').innerText()) === 'Standings will be revealed at the end of the night.', 'the line');
      const live = flat(await v.page.locator('[data-tc-day-live]').innerText());
      assert(/^Currently playing Round 3 Court \d .+ \+ .+ VS .+ \+ .+$/i.test(live), live);
      assert(flat(await v.page.locator('[data-future-toggle]').innerText()) === 'Show future games', 'Show future games');
      assert((await v.page.locator('.tc-short').count()) === 0, 'the ticket gives way to the night');
      for (const w of SIZES) {
        await v.page.setViewportSize({ width: w, height: 844 });
        await fits(v.page, '.tc-gd');
        await wholeWords(v.page, '[data-tc-round], [data-tc-day-stand]'); // Zip 74: names wrap between words, never cut
        await oneLine(v.page, '.tc-gd-hero-top, [data-tc-round] [data-tc-day-result], [data-tc-day-stand] .tc-gd-rec, [data-tc-day-stand] .tc-gd-pts');
        await SH(v.page, `B-round3-${w}-${scheme}`);
      }
      await v.page.setViewportSize({ width: 390, height: 2400 });
      await SH(v.page, `B-round3-full-${scheme}`);
      await noDash(v.page, 'the night');
      assert(v.errors.length === 0, v.errors.join(' | '));
      await v.ctx.close();
    });

  // ---------------------------------------------------------------- C  Enter score and the win motion
  for (const scheme of SCHEMES)
    await check(`C Enter score (${scheme}): the sheet, − and +, Submit: lime "✓ Let's go!", the slide to the break, Round 4 of 7, Won, the banner, sent at 5 seconds`, async () => {
      await stage('am_round3');
      const r3 = await vicRound(3);
      const v = await playerPage('Vic', { scheme, reducedMotion: 'no-preference' });
      await v.page.locator('[data-tc-enter-score]').click();
      const sheet = v.page.locator('[data-tc-score-sheet]');
      await sheet.waitFor();
      assert(flat(await v.page.locator('.sheet h2, [role="dialog"] h2').first().innerText()) === 'Final score', 'Final score');
      assert(flat(await v.page.locator('[data-tc-score-row="mine"] .tc-gd-score-name').innerText()) === `You + ${r3.partner}`, 'our side');
      // − and + are 44 px, and step the number.
      const box = await v.page.locator('[data-tc-score-plus="theirs"]').boundingBox();
      assert(box.width >= 44 && box.height >= 44, `44 px: ${box.width}x${box.height}`);
      for (let i = 0; i < 8; i++) await v.page.locator('[data-tc-score-plus="theirs"]').click();
      assert((await v.page.locator('[data-tc-score-num="theirs"]').inputValue()) === '8', 'theirs 8');
      assert((await v.page.locator('[data-tc-score-num="mine"]').inputValue()) === '11', 'mine starts at 11');
      for (const w of SIZES) {
        await v.page.setViewportSize({ width: w, height: 844 });
        await fits(v.page, '[data-tc-score-sheet]');
        await wholeWords(v.page, '.tc-gd-score-name'); // Zip 74: names wrap between words, never cut
        await SH(v.page, `C-sheet-${w}-${scheme}`);
      }
      await v.page.setViewportSize({ width: 390, height: 844 });
      let posted = 0;
      v.page.on('request', (r) => r.method() === 'POST' && r.url().endsWith('/api/tournament/game') && posted++);
      await v.page.locator('[data-tc-score-submit]').click();
      await v.page.waitForTimeout(350);
      const lit = await v.page.evaluate(() => {
        const card = document.querySelector('[data-tc-round-card="3"]');
        return {
          btn: card.querySelector('[data-tc-enter-score]').innerText.trim(),
          check: !!card.querySelector('.tc-gd-litcheck'),
          bg: getComputedStyle(card.querySelector('.tc-gd-side-a')).backgroundColor,
        };
      });
      assert(lit.btn === '✓ Let’s go!' && lit.check && /216, 240, 59/.test(lit.bg), `lit: ${JSON.stringify(lit)}`);
      await toastBox(v.page).waitFor();
      const tText = flat(await toastBox(v.page).innerText());
      assert(tText.startsWith(`You + ${r3.partner} won 11 to 8`) && tText.includes('Undo'), `banner: ${tText}`);
      // Zip 71 (Alex): no draining line along the banner; the countdown circle on Undo stays (5 seconds).
      assert((await toastBox(v.page).locator('.toast-drain').count()) === 0, 'no drain line');
      // The circle is drawn while the site's Motion switch is on (it is on live; this world has it off): when drawn, it runs the 5 seconds.
      if (await toastBox(v.page).locator('.m-undo-ring').count()) {
        const ring = await toastBox(v.page).locator('.m-undo-ring').evaluate((el) => getComputedStyle(el).getPropertyValue('--ring-ms').trim());
        assert(ring === '5000ms', `the circle: ${ring}`);
      }
      await SH(v.page, `C-lit-${scheme}`);
      await v.page.locator('.tc-gd-slide-out').waitFor({ timeout: 2500 });
      await SH(v.page, `C-slide-${scheme}`);
      await v.page.waitForTimeout(600);
      // Vic sits Round 4: the break card slides in; the hero says Round 4 of 7 (7 rounds since Zip 97); Round 3 has its Won tag; the highlight moved to Round 4.
      assert((await v.page.locator('[data-tc-break="4"]').count()) === 1, 'the break card');
      assert((await bar(v.page)) === 'ROUND 4 OF 7', await bar(v.page));
      const row3 = v.page.locator('[data-tc-round="3"]');
      assert((await row3.getAttribute('data-state')) === 'done' && /^Won \d+\u2013\d+$/.test(flat(await row3.locator('.tc-gd-tag-won').innerText())), 'Round 3 Won with the score');
      assert((await v.page.locator('[data-tc-round="4"]').getAttribute('data-state')) === 'next', 'the highlight on Round 4');
      assert(posted === 0, 'nothing sent yet');
      await SH(v.page, `C-break-${scheme}`);
      await v.page.waitForTimeout(3900);
      assert(posted === 1, `sent after 5 seconds: ${posted}`);
      const g = (await dash()).tournament.rounds.games.find((x) => x.num === r3.num);
      assert(g.status === 'done' && Math.max(g.scoreA, g.scoreB) === 11 && Math.min(g.scoreA, g.scoreB) === 8 && g.by === 'Vic', JSON.stringify(g));
      assert(v.errors.length === 0, v.errors.join(' | '));
      await v.ctx.close();
    });

  // ---------------------------------------------------------------- D  a losing score
  await check('D a losing score: the winners glow white, "Onto the next!", then the slide and the Lost tag; Undo puts Round 3 back and sends nothing', async () => {
    await stage('am_round3');
    const r3 = await vicRound(3);
    const v = await playerPage('Vic', { reducedMotion: 'no-preference' });
    await v.page.locator('[data-tc-enter-score]').click();
    await typeScore(v.page, 8, 11);
    let posted = 0;
    v.page.on('request', (r) => r.method() === 'POST' && r.url().endsWith('/api/tournament/game') && posted++);
    await v.page.locator('[data-tc-score-submit]').click();
    await v.page.waitForTimeout(350);
    const lost = await v.page.evaluate(() => {
      const card = document.querySelector('[data-tc-round-card="3"]');
      const winners = card.querySelector('.tc-gd-vs > .tc-gd-tn:last-child');
      return {
        btn: card.querySelector('[data-tc-enter-score]').innerText.trim(),
        lime: !!card.querySelector('.tc-gd-litcheck'),
        bg: getComputedStyle(winners).backgroundColor,
        ring: getComputedStyle(winners).boxShadow,
        mine: Number(getComputedStyle(card.querySelector('.tc-gd-side-a')).opacity),
      };
    });
    assert(lost.btn === 'Onto the next!' && !lost.lime && /255, 255, 255, 0\.16/.test(lost.bg) && /255, 255, 255, 0\.35\) 0px 0px 0px 2px/.test(lost.ring) && lost.mine < 1, `lost: ${JSON.stringify(lost)}`);
    const tText = flat(await toastBox(v.page).innerText());
    assert(tText.startsWith(`${r3.opponents[0]} + ${r3.opponents[1]} won 11 to 8`), `banner: ${tText}`);
    await SH(v.page, 'D-onto-next');
    await v.page.locator('.tc-gd-slide-out').waitFor({ timeout: 2500 });
    await v.page.waitForTimeout(600);
    assert(/^Lost \d+\u2013\d+$/.test(flat(await v.page.locator('[data-tc-round="3"] .tc-gd-tag').innerText())), 'Lost tag with the score');
    const tagBg = await v.page.locator('[data-tc-round="3"] .tc-gd-tag').evaluate((el) => el.className);
    assert(!tagBg.includes('tc-gd-tag-won'), 'gray, not green');
    await toastBox(v.page).locator('.toast-action').click();
    await v.page.waitForTimeout(700);
    assert((await v.page.locator('[data-tc-round-card="3"]').count()) === 1, 'Undo puts Round 3 back');
    assert((await bar(v.page)) === 'ROUND 3 OF 7', 'the bar goes back');
    await v.page.waitForTimeout(5200);
    assert(posted === 0, `Undo sends nothing: ${posted}`);
    assert(v.errors.length === 0, v.errors.join(' | '));
    await v.ctx.close();
  });

  // ---------------------------------------------------------------- E  the other side sees it in (zip 71: no confirming)
  for (const scheme of SCHEMES)
    await check(`E the other side (${scheme}): Vic's score is in at once; no "Is this right?", no Enter score for Round 3`, async () => {
      await stage('am_round3');
      const r3 = await vicRound(3);
      const sent = await postAs('Vic', '/api/tournament/game', { tournamentId: (await dash()).tournament.id, num: r3.num, key: r3.key, action: 'score', mine: 11, theirs: 8 });
      assert(sent.status === 200, sent.body);
      const g = (await dash()).tournament.rounds.games.find((x) => x.num === r3.num);
      assert(g.status === 'done', `in at once: ${g.status}`);
      const q = await playerPage(r3.opponents[0], { scheme });
      await q.page.waitForTimeout(800);
      assert((await q.page.locator('[data-tc-day-confirm], [data-tc-day-yes], [data-tc-day-no], [data-tc-day-ask]').count()) === 0, 'nothing to answer');
      assert((await q.page.locator('[data-tc-round-card="3"]').count()) === 0, 'Round 3 is done on their screen');
      await SH(q.page, `E-other-side-${scheme}`);
      assert(q.errors.length === 0, q.errors.join(' | '));
      await q.ctx.close();
    });

  // ---------------------------------------------------------------- F  a break
  await stage('am_break');
  for (const scheme of SCHEMES)
    await check(`F a break (${scheme}): the dark card, who else sits, every court under Currently playing`, async () => {
      const v = await playerPage('Vic', { scheme });
      await v.page.locator('[data-tc-break="4"]').waitFor({ timeout: 20000 });
      const card = flat(await v.page.locator('[data-tc-break="4"]').innerText());
      assert(/^Round 4 · Your break On break until Round 5 \S.* is on break too\.$/i.test(card), card);
      assert((await v.page.locator('[data-tc-day-live] .tc-gd-row').count()) === 2, 'both courts');
      assert((await bar(v.page)) === 'ROUND 4 OF 7', await bar(v.page));
      for (const w of SIZES) {
        await v.page.setViewportSize({ width: w, height: 844 });
        await fits(v.page, '.tc-gd');
        await SH(v.page, `F-break-${w}-${scheme}`);
      }
      assert(v.errors.length === 0, v.errors.join(' | '));
      await v.ctx.close();
    });

  // ---------------------------------------------------------------- G  the organizer
  await stage('am_before');
  for (const scheme of SCHEMES)
    await check(`G the organizer before the night (${scheme}): the Rounds card, the plan line, All rounds`, async () => {
      const a = await adminPage({ scheme });
      await a.page.locator('[data-tm-am-rounds]').waitFor({ timeout: 15000 });
      const plan = flat(await a.page.locator('[data-tm-am-plan]').innerText());
      assert(plan === '10 locked in. 7 rounds to 11, 2 sit each round. New partner every round.', plan);
      await a.page.locator('[data-tm-am-all]').click();
      await a.page.locator('[data-tm-am-all-sheet]').waitFor();
      assert((await a.page.locator('[data-tm-am-all-sheet] [data-tm-am-game]').count()) === 14, '14 games');
      for (const w of SIZES) {
        await a.page.setViewportSize({ width: w, height: 844 });
        await fits(a.page, '[data-tm-am-all-sheet]');
        await SH(a.page, `G-all-${w}-${scheme}`);
      }
      assert(a.errors.length === 0, a.errors.join(' | '));
      await a.ctx.close();
    });
  for (const scheme of SCHEMES)
    await check(`G the organizer on the night (${scheme}): Round 7 scores, Fix with two numbers, Player left, Pause`, async () => {
      await stage('am_standings');
      const a = await adminPage({ scheme });
      await a.page.locator('[data-tm-am-night]').waitFor({ timeout: 15000 });
      // Zip 88: the one night card: the last round is in play, both courts on it (RD7 since Zip 97's 7 rounds).
      assert((await a.page.locator('[data-nc-bar="r7"][data-state="now"]').count()) === 1, 'RD7 in play');
      assert((await a.page.locator('[data-nc-pill="RD7"]').count()) === 2, 'two games in Round 7');
      for (const w of SIZES) {
        await a.page.setViewportSize({ width: w, height: 844 });
        await fits(a.page, '[data-nc]');
        await SH(a.page, `G-night-${w}-${scheme}`);
      }
      await a.page.setViewportSize({ width: 390, height: 844 });
      // Set a score with the two numbers.
      const first = a.page.locator('[data-nc-score]').first();
      const num = await first.getAttribute('data-nc-score');
      await first.click();
      await a.page.locator('[data-tm-am-fix-sheet]').waitFor();
      for (let i = 0; i < 6; i++) await a.page.locator('[data-tm-am-plus="b"]').click();
      const shownB = flat(await a.page.locator('[data-tm-am-num="b"]').innerText());
      assert(shownB === '6', `the + stepped to ${shownB}`);
      await SH(a.page, `G-fix-${scheme}`);
      await a.page.locator('[data-tm-am-save]').click();
      await a.page.waitForTimeout(900);
      const g = (await dash()).tournament.rounds.games.find((x) => String(x.num) === num);
      assert(g.status === 'done' && g.scoreA === 11 && g.scoreB === 6, JSON.stringify(g));
      // Player left: the sheet lists the players; picking one shows Remove.
      await a.page.locator('[data-tm-player-left]').click();
      await a.page.locator('[data-nc-yes]').click();
      await a.page.locator('[data-tm-left-pick]').waitFor();
      await a.page.locator('[data-tm-left-who]').first().click();
      await a.page.locator('[data-tm-left-sheet]').waitFor();
      await SH(a.page, `G-left-${scheme}`);
      await a.page.keyboard.press('Escape');
      await a.page.waitForTimeout(300);
      // Pause shows on the card (Zip 88: after "Are you sure?").
      await a.page.locator('[data-tm-pause]').click();
      await a.page.locator('[data-nc-yes]').click();
      await a.page.locator('[data-tm-paused]').waitFor({ timeout: 5000 });
      await a.page.locator('[data-tm-pause]').click();
      await a.page.waitForTimeout(600);
      assert(a.errors.length === 0, a.errors.join(' | '));
      await a.ctx.close();
    });
  await check('G zip 71: no score waits for a Yes, so the night card has no Confirm (Round 2 is in on the Round 3 card)', async () => {
    await stage('am_round3');
    const a = await adminPage({});
    await a.page.locator('[data-tm-am-night]').waitFor({ timeout: 15000 });
    assert((await a.page.locator('[data-tm-am-confirm]').count()) === 0, 'no Confirm');
    const d = (await dash()).tournament.rounds;
    assert(d.games.filter((g) => g.round === 2 && g.status === 'done').length === 2, 'Round 2 in');
    await a.ctx.close();
  });

  // ---------------------------------------------------------------- H  switched from Locked doubles
  await stage('am_switched');
  await check('H switched from Locked doubles: "Tournament style is now Americano." and the new rounds', async () => {
    const v = await playerPage('Vic', {});
    await v.page.locator('[data-tc-rounds]').waitFor({ timeout: 20000 });
    const text = flat(await v.page.locator('body').innerText());
    assert(text.includes('Tournament style is now Americano.'), 'the style line');
    assert((await v.page.locator('[data-tc-round]').count()) === 7, 'seven rounds');
    await SH(v.page, 'H-switched');
    assert(v.errors.length === 0, v.errors.join(' | '));
    await v.ctx.close();
  });

  // ---------------------------------------------------------------- I  reduced motion, who may see it
  await check('I reduced motion: no glow, no slide (the card just changes)', async () => {
    await stage('am_round3');
    const v = await playerPage('Vic', { reducedMotion: 'reduce' });
    await v.page.locator('[data-tc-enter-score]').click();
    await v.page.locator('[data-tc-score-submit]').click();
    await v.page.waitForTimeout(120);
    assert((await v.page.locator('.tc-gd-litcheck, .tc-gd-next-lit, .tc-gd-next-lost, .tc-gd-slide-out').count()) === 0, 'no glow or slide');
    assert((await v.page.locator('[data-tc-break="4"]').count()) === 1, 'the break card at once');
    await v.page.waitForTimeout(5300);
    await v.ctx.close();
  });
  await check('I switched off: no tournament data for a player (no rounds, no names of the night)', async () => {
    await stage('am_round3');
    await call('PUT', '/api/admin/tournaments-switch', { on: false });
    const v = await answerOf('Vic');
    assert(!('tournament' in v.data), 'no tournament key');
    assert(!v.text.includes('americano') && !v.text.includes('The Cold Open'), 'nothing of the night');
    await call('PUT', '/api/admin/tournaments-switch', { on: true });
  });

  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
