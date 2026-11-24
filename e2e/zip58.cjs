/* Zip 58 (🎾58.tourney4): ties, the Final, End tournament, the ticker, medals and the records, in a real browser on the preview's calm world and
 * the Tournament test page's stages (server/tournamentTest.ts). The clock is Thu Nov 19, 2026, 8:00 PM Eastern (game night).
 *
 *   node e2e/zip58.cjs
 *
 *   A  Tied for the final (picture 20), Vic: the bar, Standings with In the final and Tied, the Three-way tie card with the wheel and
 *      "Kitchen Crew: spin the wheel" (not a button on Vic's phone); 390/360/320, light and dark; nothing wider than the screen
 *   B  Rowan (Kitchen Crew) spins: the wheel turns and stops (the motion), then The wheel picked and the Playoff card (picture 21); Vic's phone
 *      plays the spin once too, then shows the same answer after a reload
 *   C  the organizer: the wheel card on Home, Spin (reduced motion: no turning, the answer at once), The wheel picked
 *   D  the Final (picture 22), Vic: the Final card with We won and "Also now · Court 2 · 3rd place"; 390/360/320, light and dark
 *   E  End tournament (picture 43): Final is done, the rows, Edit awards (picture 42: Change, credit, 1 to 4 weeks, Save), Confirm winners and end
 *   F  after the end (pictures 38 to 40): the slim ticker the whole width, the congratulations card with Nice, the medal by the name, game cards;
 *      Parker sees the ticker only; reduced motion: the ticker stands still; light and dark, 390/360/320
 *   G  History > Tournaments (picture 46) and the Players sheet's TOURNAMENTS card (picture 47); Americano's End card (picture 37) and its Edit awards (41)
 *   H  switched off: nothing about it reaches a player; no em dashes; no page errors
 * Screenshots: .data/zip58-shots (not in git).
 */
const { spawn, spawnSync } = require('node:child_process');
const { readFileSync, mkdirSync, rmSync } = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.E2E_PORT) || 5472;
const BASE = `http://localhost:${PORT}`;
const SEED_ISO = '2026-11-19T15:00:00.000Z';
const NOW_MS = Date.parse('2026-11-20T01:00:00.000Z'); // Thu Nov 19, 8:00 PM Eastern (game night)
const PIN = /PIN `(\d{6})`/.exec(readFileSync(path.join(ROOT, 'docs/PREVIEW_FAKE_DB.md'), 'utf8'))[1];
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const SHOTS = path.join(ROOT, '.data', 'zip58-shots');

let passed = 0;
let failed = 0;
const ONLY = process.env.ZIP58_ONLY || '';
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
  const dbFile = path.join(ROOT, '.data', 'zip58.sqlite');
  mkdirSync(SHOTS, { recursive: true });
  rmSync(dbFile, { force: true });
  const seeded = spawnSync('npx', ['vite-node', 'scripts/load-small-local.ts', '--', dbFile, SEED_ISO, '--calm', '--zip55', '--zip60'], { cwd: ROOT, encoding: 'utf8' });
  if (seeded.status !== 0) throw new Error(`could not build the calm world: ${seeded.stderr || seeded.stdout}`);
  if (await fetch(`${BASE}/api/status`).then((r) => r.ok, () => false)) throw new Error(`port ${PORT} is already in use`);
  const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
    cwd: ROOT,
    env: { ...process.env, DEV_DB: dbFile, SETUP_TOKEN: 'zip58-setup-token-0123456789', DEV_CLOCK: '1', PREVIEW_CALM: 'on', PB_PREVIEW_BUILD: '1', CHRISTMAS_SKIN_PREVIEW: 'on' },
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


  const tieKey = async () => (await dash()).tournament.day.ties[0].key;

  // ---------------------------------------------------------------- A  Tied for the final
  for (const scheme of SCHEMES)
    await check(`A tied for the final (${scheme}): bar, standings chips, the three-way tie card; 390/360/320`, async () => {
      await stage('tie3');
      const v = await playerPage('Vic', { scheme });
      await v.page.locator('[data-tc-tie]').waitFor({ timeout: 20000 });
      assert((await bar(v.page)) === 'TIED FOR THE FINAL', await bar(v.page));
      const rows = (await v.page.locator('[data-tc-day-stand]').allInnerTexts()).map(flat);
      assert(rows[0] === '1 Kitchen Crew Rowan + Zoe 3-0 In the final', rows[0]);
      assert(rows.slice(1).every((r) => r.endsWith('1-2 Tied')), rows.join(' | '));
      const card = flat(await v.page.locator('[data-tc-tie]').innerText());
      assert(card.startsWith('THREE-WAY TIE Each team beat one of the others.') || card.startsWith('Three-way tie Each team beat one of the others.'), card);
      assert(card.endsWith('Kitchen Crew: spin the wheel'), card);
      assert((await v.page.locator('[data-tc-tie-spin]').count()) === 0, 'not a button on Vic\'s phone');
      assert((await v.page.locator('[data-tc-tie] [data-wheel="ready"] .tc-wh-text').count()) === 3, 'three slices');
      assert((await v.page.locator('[data-future-toggle]').count()) === 1, 'Show future games');
      for (const w of SIZES) {
        await v.page.setViewportSize({ width: w, height: 844 });
        await fits(v.page, '.tc-gd');
        await oneLine(v.page, '[data-tc-day-stand] .tc-gd-chip');
        await wholeWords(v.page, '[data-tc-tie-wait], .tc-tie-line'); // Zip 74: "<team>: spin the wheel" wraps between words, never cut
        await SH(v.page, `A-tie-${w}-${scheme}`);
      }
      await v.page.setViewportSize({ width: 390, height: 1900 });
      await SH(v.page, `A-tie-full-${scheme}`);
      await noDash(v.page, 'the tie');
      assert(v.errors.length === 0, v.errors.join(' | '));
      await v.ctx.close();
    });

  // ---------------------------------------------------------------- B  Rowan spins
  await check('B Rowan spins: the wheel turns and stops; The wheel picked; Playoff (Game A, Game B, Final, 3rd place); Vic plays it once', async () => {
    await stage('tie3');
    const vic = await playerPage('Vic', { reducedMotion: 'no-preference' });
    const r = await playerPage('Rowan', { reducedMotion: 'no-preference' });
    await r.page.locator('[data-tc-tie-spin]').waitFor({ timeout: 20000 });
    assert(flat(await r.page.locator('[data-tc-tie-spin]').innerText()) === 'Kitchen Crew: spin the wheel', 'the button');
    await r.page.locator('[data-tc-tie-spin]').click();
    await r.page.locator('[data-tc-tie] [data-wheel="spinning"]').waitFor({ timeout: 5000 });
    await r.page.waitForTimeout(1500);
    const mid = await r.page.locator('.tc-wh-turn').first().evaluate((el) => getComputedStyle(el).transform);
    assert(mid && mid !== 'none', `turning: ${mid}`);
    await SH(r.page, 'B-spinning');
    await r.page.locator('[data-tc-tie-picked]').waitFor({ timeout: 12000 });
    const picked = flat(await r.page.locator('[data-tc-tie-picked] .tc-tie-picked-text').innerText());
    assert(/^(Net Ninjas|Third Shot Gang|Dill With It) get the bye .+ \+ .+$/i.test(picked), picked);
    assert((await r.page.locator('[data-tc-tie-picked] [data-wheel="picked"] .tc-wh-win').count()) === 1, 'the bye slice lit');
    const po = (await r.page.locator('[data-tc-playoff-row]').allInnerTexts()).map(flat);
    assert(po.length === 4, po.join(' | '));
    assert(/^Game A Court 1 .+ vs .+ To 5\. Loser is out\.$/.test(po[0]), po[0]);
    assert(/^Game B Court 1 Winner of A vs .+ To 5\. Loser is out\.$/.test(po[1]), po[1]);
    assert(/^Final Court 1 Winner of B vs Kitchen Crew To 11$/.test(po[2]), po[2]);
    assert(po[3] === '3rd place Court 2 Losers of A and B Same time as the final', po[3]);
    assert((await bar(r.page)) === 'PLAYOFF', await bar(r.page));
    for (const w of SIZES) {
      await r.page.setViewportSize({ width: w, height: 844 });
      await fits(r.page, '.tc-gd');
      await SH(r.page, `B-playoff-${w}`);
    }
    // Vic's phone (refreshing by itself) plays the spin once, then shows the same answer.
    await vic.page.locator('[data-tc-tie-picked]').waitFor({ timeout: 25000 });
    assert(flat(await vic.page.locator('[data-tc-tie-picked] .tc-tie-picked-text').innerText()) === picked, 'the same answer on Vic\'s phone');
    await vic.page.reload();
    await vic.page.locator('[data-tc-tie-picked]').waitFor({ timeout: 20000 });
    assert((await vic.page.locator('[data-tc-tie] [data-wheel]').count()) === 0, 'no spin again after a reload');
    // A team in Game A sees its game as the big card with Enter score (Zip 72).
    const ans = (await answerOf('Vic')).data.tournament.day;
    const mine = ans.games.find((g) => g.state === 'next');
    if (mine && mine.stage === 'tie') {
      const k = flat(await vic.page.locator('.tc-gd-next-kicker').innerText()).toUpperCase();
      assert(k.startsWith(mine.label.toUpperCase()), k);
      assert((await vic.page.locator('[data-tc-enter-score]').count()) === 1, 'Enter score on Game A');
    }
    await SH(vic.page, 'B-vic-playoff');
    assert(vic.errors.length === 0 && r.errors.length === 0, [...vic.errors, ...r.errors].join(' | '));
    await vic.ctx.close();
    await r.ctx.close();
  });

  // ---------------------------------------------------------------- C  the organizer spins
  for (const scheme of SCHEMES)
    await check(`C organizer (${scheme}): the wheel card on Home, Spin, The wheel picked; Game A and B in the round`, async () => {
      await stage('tie3');
      const a = await adminPage({ scheme });
      await a.page.locator('[data-tm-tie]').waitFor({ timeout: 20000 });
      assert(flat(await a.page.locator('[data-tm-tie-spin]').innerText()) === 'Kitchen Crew: spin the wheel', 'the organizer can spin');
      for (const w of SIZES) {
        await a.page.setViewportSize({ width: w, height: 844 });
        await fits(a.page, '[data-tm-tie]');
        await SH(a.page, `C-admin-tie-${w}-${scheme}`);
      }
      await a.page.setViewportSize({ width: 390, height: 844 });
      await a.page.locator('[data-tm-tie-spin]').click();
      await a.page.locator('[data-tm-tie-picked]').waitFor({ timeout: 15000 });
      assert(/get the bye/.test(await a.page.locator('[data-tm-tie-picked]').innerText()), 'picked');
      const rows = (await a.page.locator('[data-tm-result]').allInnerTexts()).map(flat).join(' | ');
      assert(/To 5|to 5|vs/.test(rows), rows);
      await SH(a.page, `C-admin-picked-${scheme}`);
      assert(a.errors.length === 0, a.errors.join(' | '));
      await a.ctx.close();
    });

  // ---------------------------------------------------------------- D  the Final
  for (const scheme of SCHEMES)
    await check(`D the Final (${scheme}): the Final card with We won, Also now · Court 2 · 3rd place; 390/360/320`, async () => {
      await stage('final_on');
      const v = await playerPage('Vic', { scheme });
      await v.page.locator('[data-tc-also-now]').waitFor({ timeout: 20000 });
      assert((await bar(v.page)) === 'FINAL', await bar(v.page));
      const k = flat(await v.page.locator('.tc-gd-next-kicker').innerText()).toUpperCase();
      assert(k === 'FINAL · COURT 1', k);
      assert(flat(await v.page.locator('[data-tc-day-next] .tc-gd-vs').innerText()) === 'Net Ninjas Vic + Wren VS Third Shot Gang Parker + Quinn', 'the VS card');
      assert((await v.page.locator('[data-tc-enter-score]').count()) === 1, 'Enter score');
      const also = flat(await v.page.locator('[data-tc-also-now]').innerText());
      assert(/^ALSO NOW · COURT 2 · 3RD PLACE Kitchen Crew vs Dill With It Rowan \+ Zoe vs Sage \+ Christopher( Vanderberg)?/i.test(also), also);
      for (const w of SIZES) {
        await v.page.setViewportSize({ width: w, height: 844 });
        await fits(v.page, '.tc-gd');
        await oneLine(v.page, '[data-tc-also-now] .tc-gd-label, [data-tc-also-now] b');
        await SH(v.page, `D-final-${w}-${scheme}`);
      }
      await noDash(v.page, 'the Final');
      assert(v.errors.length === 0, v.errors.join(' | '));
      await v.ctx.close();
    });

  // ---------------------------------------------------------------- E  End tournament
  for (const scheme of SCHEMES)
    await check(`E End tournament (${scheme}): Final is done, the rows, Edit awards, Confirm winners and end`, async () => {
      await stage('final_done');
      const a = await adminPage({ scheme });
      await a.page.locator('[data-tm-end]').waitFor({ timeout: 20000 });
      const done = flat(await a.page.locator('[data-tm-end-done]').innerText());
      assert(/^FINAL IS DONE Net Ninjas won Vic \+ Wren beat Third Shot Gang \(Parker \+ Quinn\)\.$/i.test(done), done);
      const rows = (await a.page.locator('[data-tm-end-row]').allInnerTexts()).map(flat);
      assert(rows.join(' | ') === 'Winners Net Ninjas Vic + Wren | Medal for each Yes | Game credit for each $14 | 2nd place Third Shot Gang Parker + Quinn | 2nd place credit for each None | Winners banner 1 week | 3rd place Dill With It Sage + Christopher Vanderberg', rows.join(' | '));
      assert((await a.page.locator('[data-tm-round]').count()) === 0 && (await a.page.locator('[data-tm-pause]').count()) === 0, 'no round results, no Pause');
      for (const w of SIZES) {
        await a.page.setViewportSize({ width: w, height: 844 });
        await fits(a.page, '[data-tm-end], [data-tm-end-done]');
        await oneLine(a.page, '[data-tm-end-row] > span:first-child, [data-tm-end] .tm-label');
        await SH(a.page, `E-end-${w}-${scheme}`);
      }
      await a.page.setViewportSize({ width: 390, height: 844 });
      if (scheme === 'light') {
        // Edit awards: 2 weeks, $10 each; Change shows every team.
        await a.page.locator('[data-tm-edit-awards]').click();
        await a.page.locator('[data-tm-awards]').waitFor();
        await a.page.locator('[data-tm-award-change="first"]').click();
        assert((await a.page.locator('[data-tm-award-choice]').count()) === 4, 'four teams to pick from');
        await a.page.locator('[data-tm-award-choice="Net Ninjas"]').click();
        await a.page.locator('[data-tm-award-money="champion"]').fill('10');
        await a.page.locator('[data-tm-weeks="2"]').click();
        for (const w of SIZES) {
          await a.page.setViewportSize({ width: w, height: 844 });
          await oneLine(a.page, '.tm-awards-week');
          await SH(a.page, `E-awards-${w}`);
        }
        await a.page.locator('[data-tm-awards-save]').click();
        await a.page.locator('[data-tm-awards]').waitFor({ state: 'detached', timeout: 10000 });
        const r2 = (await a.page.locator('[data-tm-end-row]').allInnerTexts()).map(flat);
        assert(r2.includes('Game credit for each $10') && r2.includes('Winners banner 2 weeks'), r2.join(' | '));
        await a.page.locator('[data-tm-end-confirm]').click();
        await a.page.locator('[data-tm-end]').waitFor({ state: 'detached', timeout: 15000 });
        const d = await dash();
        assert(!d.tournament, 'Home is back to normal');
      }
      assert(a.errors.length === 0, a.errors.join(' | '));
      await a.ctx.close();
    });

  // ---------------------------------------------------------------- F  after the end
  for (const scheme of SCHEMES)
    await check(`F after the end (${scheme}): the ticker the whole width, the congratulations card, the medal by the name; Parker the ticker only`, async () => {
      await stage('ended');
      const v = await playerPage('Vic', { scheme, reducedMotion: 'no-preference' });
      await v.page.locator('[data-tour-ticker]').waitFor({ timeout: 20000 });
      const box = await v.page.locator('[data-tour-ticker]').boundingBox();
      assert(Math.round(box.width) === 390 && box.x === 0, `full width: ${JSON.stringify(box)}`);
      assert(box.height >= 30 && box.height <= 52, `slim: ${box.height}`);
      const text = flat(await v.page.locator('[data-tour-ticker] .tw-run').first().innerText()).toUpperCase();
      assert(text.startsWith('THE COLD OPEN CHAMPIONS NET NINJAS VIC') && text.includes('WREN'), text);
      const anim = await v.page.locator('.tw-track').evaluate((el) => getComputedStyle(el).animationName);
      assert(anim === 'tw-run', `runs: ${anim}`);
      const c = flat(await v.page.locator('[data-tour-congrats]').innerText());
      assert(c === 'You won The Cold Open $14 credit toward your next game, plus a medal next to your name. Nice', c);
      assert((await v.page.locator('header [data-medals="1"], .topbar [data-medals="1"]').count()) >= 1, 'a medal by the name at the top');
      assert((await v.page.locator('[data-tc-day-hero], [data-future-toggle]').count()) === 0, 'no live view, no Show future games');
      for (const w of SIZES) {
        await v.page.setViewportSize({ width: w, height: 844 });
        const b = await v.page.locator('[data-tour-ticker]').boundingBox();
        assert(Math.round(b.width) === w, `ticker ${b.width} at ${w}`);
        await fits(v.page, '[data-tour-congrats]');
        await SH(v.page, `F-winner-${w}-${scheme}`);
      }
      await v.page.setViewportSize({ width: 390, height: 844 });
      await v.page.locator('[data-tour-nice]').click();
      await v.page.locator('[data-tour-congrats]').waitFor({ state: 'detached', timeout: 8000 });
      await v.page.reload();
      await v.page.locator('[data-tour-ticker]').waitFor({ timeout: 20000 });
      assert((await v.page.locator('[data-tour-congrats]').count()) === 0, 'Nice: the card does not come back');
      const p = await playerPage('Parker', { scheme });
      await p.page.locator('[data-tour-ticker]').waitFor({ timeout: 20000 });
      assert((await p.page.locator('[data-tour-congrats]').count()) === 0, 'Parker: no card');
      await SH(p.page, `F-parker-${scheme}`);
      await noDash(v.page, 'after the end');
      assert(v.errors.length === 0 && p.errors.length === 0, [...v.errors, ...p.errors].join(' | '));
      await v.ctx.close();
      await p.ctx.close();
    });
  await check('F reduced motion: the ticker stands still', async () => {
    await stage('ended');
    const v = await playerPage('Wren', { reducedMotion: 'reduce' });
    await v.page.locator('[data-tour-ticker]').waitFor({ timeout: 20000 });
    const anim = await v.page.locator('.tw-track').evaluate((el) => getComputedStyle(el).animationName);
    assert(anim === 'none', `still: ${anim}`);
    await v.ctx.close();
  });

  // ---------------------------------------------------------------- G  History, the Players sheet, Americano
  for (const scheme of SCHEMES)
    await check(`G History > Tournaments and the Players sheet (${scheme}); 390/360/320`, async () => {
      await stage('history');
      const a = await adminPage({ scheme });
      await a.page.locator('.tabbar').getByText('History', { exact: true }).click();
      await a.page.locator('[data-history-tournaments]').click();
      await a.page.locator('[data-th-list]').waitFor({ timeout: 15000 });
      const list = (await a.page.locator('[data-th-row]').allInnerTexts()).map(flat);
      assert(list.length === 3 && list[0].startsWith('The Cold Open'), list.join(' | '));
      assert(/1st Net Ninjas Vic \+ Wren$/.test(list[0]), list[0]);
      const wins = (await a.page.locator('[data-th-win]').allInnerTexts()).map(flat);
      assert(wins[0].startsWith('1 Vic') && wins[0].includes('2 wins') && /3 played$/i.test(wins[0]), wins.join(' | '));
      for (const w of SIZES) {
        await a.page.setViewportSize({ width: w, height: 900 });
        await fits(a.page, '[data-th]');
        await oneLine(a.page, '[data-th-win] .th-wins, [data-th-win] .th-chip');
        await SH(a.page, `G-history-${w}-${scheme}`);
      }
      // Players > Vic: TOURNAMENTS.
      await a.page.setViewportSize({ width: 390, height: 900 });
      await a.page.locator('.tabbar').getByText('Players', { exact: true }).click();
      await a.page.locator('[data-pr-row="Vic"], [data-player="Vic"] button').first().click();
      const t = a.page.locator('[data-pr-card="tournaments"]');
      await t.waitFor({ timeout: 15000 });
      const tt = flat(await t.innerText());
      assert(/^TOURNAMENTS Played 3 Won 2 Medals Runner-up 1 The Cold Open, \w{3} \d+ 1st with Wren Summer Slam, \w{3} \d+ 1st Spring Fling, \w{3} \d+ 2nd$/.test(tt), tt);
      await t.scrollIntoViewIfNeeded();
      await SH(a.page, `G-players-${scheme}`);
      assert(a.errors.length === 0, a.errors.join(' | '));
      await a.ctx.close();
    });
  await check('G Americano End card (picture 37) and Edit awards (picture 41)', async () => {
    await stage('am_done');
    const a = await adminPage({});
    await a.page.locator('[data-tm-end]').waitFor({ timeout: 20000 });
    const done = flat(await a.page.locator('[data-tm-end-done]').innerText());
    assert(/^ROUND 6 IS DONE Vic finished first .+ was second\.$/i.test(done), done);
    const rows = (await a.page.locator('[data-tm-end-row]').allInnerTexts()).map(flat);
    assert(rows[0] === '1st place Vic' && rows[1] === 'Medal and credit Medal + $14' && rows[3] === 'Credit $7' && rows[4] === 'Winners banner 1 week', rows.join(' | '));
    await SH(a.page, 'G-am-end');
    await a.page.locator('[data-tm-edit-awards]').click();
    await a.page.locator('[data-tm-awards]').waitFor();
    assert((await a.page.locator('[data-tm-award-pick]').count()) === 2, '1st and 2nd place');
    for (const w of SIZES) {
      await a.page.setViewportSize({ width: w, height: 844 });
      await oneLine(a.page, '.tm-awards-week, .tm-awards-kicker');
      await SH(a.page, `G-am-awards-${w}`);
    }
    assert(a.errors.length === 0, a.errors.join(' | '));
    await a.ctx.close();
  });

  // ---------------------------------------------------------------- I  Alex's look fixes (Nov 19): the ticker's hard ends, the medal after the name
  for (const stageName of ['ended', 'history'])
    for (const skin of ['off', 'on'])
      for (const scheme of SCHEMES)
        await check(`I look fixes (${stageName}, Christmas skin ${skin}, ${scheme}): ticker ends hard; the medal reads like an emoji after the name; 420/390/360/320`, async () => {
          await stage(stageName);
          const v = await newPage({ scheme });
          await v.page.goto(`${BASE}/?as=Vic${skin === 'on' ? '&xmasmode=all&xmasdate=2026-12-05&xmasreset=1' : ''}`);
          await v.page.locator('[data-tour-ticker]').waitFor({ timeout: 30000 });
          if (skin === 'on') {
            await sleep(2400);
            await v.page.locator('[data-skin-logo]').tap();
            await sleep(2600);
            const on = await v.page.evaluate(() => document.documentElement.getAttribute('data-skin'));
            assert(on === 'christmas', `the Christmas look is on: ${on}`);
          }
          const n = stageName === 'history' ? 2 : 1;
          for (const w of [420, 390, 360, 320]) {
            await v.page.setViewportSize({ width: w, height: 844 });
            await sleep(150);
            const m = await v.page.evaluate(() => {
              const tw = document.querySelector('[data-tour-ticker]');
              const cs = getComputedStyle(tw);
              const h1 = document.querySelector('.topbar h1.has-badge');
              const name = h1.querySelector('.h1-name');
              const r = document.createRange();
              r.selectNodeContents(name);
              const nameBox = [...r.getClientRects()].pop();
              const badge = h1.querySelector('[data-medals]');
              const icon = badge.querySelector('.md-ico').getBoundingClientRect();
              const all = badge.getBoundingClientRect();
              const notYou = document.querySelector('.not-you').getBoundingClientRect();
              const fs = parseFloat(getComputedStyle(h1).fontSize);
              return { mask: cs.maskImage || cs.webkitMaskImage || 'none', wmask: cs.webkitMaskImage || 'none', twLeft: tw.getBoundingClientRect().left, twWidth: tw.getBoundingClientRect().width,
                inH1: !!badge.closest('h1'), medals: badge.getAttribute('data-medals'), fs, iconH: icon.height, gap: all.left - nameBox.right, nameTop: nameBox.top, nameBottom: nameBox.bottom,
                iconTop: icon.top, iconBottom: icon.bottom, notYouLeft: notYou.left, badgeRight: all.right, notYouTop: notYou.top };
            });
            assert((m.mask === 'none' || !m.mask) && (m.wmask === 'none' || !m.wmask), `no fade on the ticker ends: ${m.mask} ${m.wmask}`);
            assert(m.twLeft === 0 && Math.round(m.twWidth) === w, `edge to edge: ${m.twLeft} ${m.twWidth}`);
            assert(m.inH1 && m.medals === String(n), `the medals sit in the name's heading (${m.medals})`);
            // As tall as the name's letters: 0.7 to 0.9 of the font size (a capital letter is about 0.72).
            assert(m.iconH >= m.fs * 0.68 && m.iconH <= m.fs * 0.9, `medal height ${m.iconH.toFixed(1)} for a ${m.fs}px name`);
            // A normal space after the name (0.15 to 0.4 em).
            assert(m.gap >= m.fs * 0.15 && m.gap <= m.fs * 0.4, `space after the name ${m.gap.toFixed(1)}px`);
            // On the name's line: inside its line box, its bottom near the text baseline (the line box bottom less the descent).
            assert(m.iconTop >= m.nameTop - 1 && m.iconBottom <= m.nameBottom + 1, `on the name's line: ${m.iconTop}..${m.iconBottom} in ${m.nameTop}..${m.nameBottom}`);
            assert(m.notYouLeft >= m.badgeRight || m.notYouTop > m.nameBottom - 2, 'not you? after the medal');
            await v.page.screenshot({ path: path.join(SHOTS, `I-${stageName}-${skin}-${scheme}-${w}.png`), clip: { x: 0, y: 0, width: w, height: 140 } });
          }
          assert(v.errors.length === 0, v.errors.join(' | '));
          await v.ctx.close();
        });

  // ---------------------------------------------------------------- H  who may see it
  await check('H switched off: no tournament data and no ticker or medals for a player', async () => {
    await stage('ended');
    await call('PUT', '/api/admin/tournaments-switch', { on: false });
    const v = await answerOf('Vic');
    assert(!('tournament' in v.data) && !('tourAwards' in v.data), 'no tournament keys');
    assert(!v.text.includes('The Cold Open') && !v.text.includes('Net Ninjas'), 'nothing of it');
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
