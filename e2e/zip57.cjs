/* Zip 57 (🎾57.tourney3): teams, the schedule and game night in a real browser, on the preview's calm world and the Tournament test page's
 * game day stages (server/tournamentTest.ts). The clock is Thu Nov 19, 2026, 8:00 PM Eastern (game night).
 *
 *   node e2e/zip57.cjs
 *
 *   A  admin: Draft teams (mock 15), tap two players to swap (add-on C), Redo, Publish; light and dark at 420, 390, 360, 320
 *   B  Vic before the night (mock 16): the ticket, Your team, Your games with courts, All teams
 *   C  game night as Vic (mock 17): Game 1 with We won; the add-on's motion (D): lime with "✓ Let's go!", the slide, the toast with Undo,
 *      sent after 5 seconds;
 *      Parker gets "Did you win?" (mock 19) and confirms
 *   D  the organizer's game night (mocks 48 to 50): the round's results, Confirm, Fix, the Time check with Apply, Pause, Player left
 *   E  12 players pools look (mock 51), The night
 *   F  Finalize: the Courts row and the Fits / Too tight line (mocks 60 and 61), light and dark, one Air screen
 *   G  a back out after publishing (odd count): Americano, Copy text for the group, no teams for players
 *   H  who may see it: switched off, no tournament data; no em dashes; nothing wider than the screen; no page errors
 * Screenshots: .data/zip57-shots (not in git).
 */
const { spawn, spawnSync } = require('node:child_process');
const { readFileSync, mkdirSync, rmSync } = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.E2E_PORT) || 5467;
const BASE = `http://localhost:${PORT}`;
const SEED_ISO = '2026-11-19T15:00:00.000Z';
const NOW_MS = Date.parse('2026-11-20T01:00:00.000Z'); // Thu Nov 19, 8:00 PM Eastern (game night)
const PIN = /PIN `(\d{6})`/.exec(readFileSync(path.join(ROOT, 'docs/PREVIEW_FAKE_DB.md'), 'utf8'))[1];
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const SHOTS = path.join(ROOT, '.data', 'zip57-shots');

let passed = 0;
let failed = 0;
const ONLY = process.env.ZIP57_ONLY || '';
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
  const dbFile = path.join(ROOT, '.data', 'zip57.sqlite');
  mkdirSync(SHOTS, { recursive: true });
  rmSync(dbFile, { force: true });
  const seeded = spawnSync('npx', ['vite-node', 'scripts/load-small-local.ts', '--', dbFile, SEED_ISO, '--calm', '--zip55', '--zip60'], { cwd: ROOT, encoding: 'utf8' });
  if (seeded.status !== 0) throw new Error(`could not build the calm world: ${seeded.stderr || seeded.stdout}`);
  if (await fetch(`${BASE}/api/status`).then((r) => r.ok, () => false)) throw new Error(`port ${PORT} is already in use`);
  const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
    cwd: ROOT,
    env: { ...process.env, DEV_DB: dbFile, SETUP_TOKEN: 'zip57-setup-token-0123456789', DEV_CLOCK: '1', PREVIEW_CALM: 'on', PB_PREVIEW_BUILD: '1' },
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
          if (el.matches('[data-tc-day-slide]')) continue;
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
  const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
  const noDash = async (page, where) => {
    const text = await page.evaluate(() => document.body.innerText);
    assert(!text.includes('\u2014'), `an em dash on ${where}`);
  };
  const openSchedule = async (a) => {
    await a.page.locator('.tabbar button', { hasText: 'Settings' }).click();
    const sched = a.page.locator('[data-section="schedule"]');
    if (!(await sched.getAttribute('open'))) await sched.locator('summary').click();
    await a.page.locator('[data-tm-schedule-row]').click();
  };

  async function postAs(name, url, data, method = 'POST') {
    const ctx = await browser.newContext();
    const list = (await (await ctx.request.get(BASE + '/api/group')).json()).players;
    await ctx.request.post(BASE + '/api/me', { data: { playerId: list.find((x) => x.name === name).id }, headers: { Origin: BASE } });
    const r = await ctx.request.fetch(BASE + url, { method, data, headers: { Origin: BASE } });
    const out = { status: r.status(), body: await r.text() };
    await ctx.close();
    return out;
  }
  /** Vic's page with the card drawn. `motion`: let the gold pop play (the other pages use reduced motion). */
  async function vicCard(opts = {}) {
    const v = await playerPage(opts.who || 'Vic', opts);
    await v.page.locator('.tc-short').first().waitFor({ timeout: 20000 });
    return v;
  }


  const SH = async (page, name) => shot(page, name);
  const bar2 = (page) => page.locator('[data-tc-day-progress]').innerText().then((x) => flat(x).toUpperCase());
  const ROWS = '.tc-gd-row, .tm-gd-team, .tm-gd-result';

  // ---------------------------------------------------------------- A  the draft (mock 15) and the add-on's tap-to-swap (C)
  const DRAFT_SIZES = [420, 390, 360, 320];
  await stage('day_ready');
  for (const scheme of SCHEMES)
    await check(`A draft teams, tap two players to swap, publish (${scheme})`, async () => {
      if (scheme === 'dark') await stage('day_ready');
      const a = await adminPage({ scheme, reducedMotion: 'no-preference' });
      await a.page.locator('[data-tm-draft]').click();
      await a.page.locator('[data-tm-draft-card]').waitFor();
      const rows = await a.page.locator('[data-tm-team]').allInnerTexts();
      assert(rows.length === 4, `4 teams: ${rows.length}`);
      const chip = () => a.page.locator('[data-tm-draft-count]').innerText().then(flat);
      assert((await chip()).toUpperCase() === '8 LOCKED IN', 'the count chip');
      const totals = () => a.page.locator('[data-tm-team-total]').allInnerTexts().then((x) => x.map(flat));
      const t0 = await totals();
      assert(JSON.stringify(t0) === JSON.stringify(['6.1', '6.25', '6.4', '6.4']), `totals with no "=": ${t0}`);
      // Pairs only (no team names, no explanation line), no Swap buttons, no Swap sheet.
      assert((await a.page.locator('[data-tm-draft-card] .tm-gd-tname, [data-tm-draft-note], [data-tm-swap], [data-tm-swap-sheet]').count()) === 0, 'no names, note or Swap buttons');
      // Each player is its own button: name left, level right, 44 px tall, the full middle column.
      const btns = a.page.locator('[data-tm-player]');
      assert((await btns.count()) === 8, 'eight player buttons');
      for (const w of DRAFT_SIZES) {
        await a.page.setViewportSize({ width: w, height: 844 });
        await fits(a.page, '[data-tm-draft-card]');
        const geo = await a.page.evaluate(() =>
          [...document.querySelectorAll('[data-tm-player]')].map((b) => {
            const r = b.getBoundingClientRect();
            const col = b.parentElement.getBoundingClientRect();
            const n = b.querySelector('.tm-gd-pbtn-name').getBoundingClientRect();
            const l = b.querySelector('.tm-gd-pbtn-lvl').getBoundingClientRect();
            return { h: r.height, full: Math.abs(r.width - col.width) < 1.5, order: n.right <= l.left + 1 };
          }),
        );
        assert(geo.every((g) => g.h >= 44 && g.full && g.order), `buttons at ${w}: ${JSON.stringify(geo.slice(0, 2))}`);
        await SH(a.page, `A-draft-${w}-${scheme}`);
      }
      // A long name cuts with an ellipsis inside its button (on screen only).
      await a.page.locator('[data-tm-player] .tm-gd-pbtn-name').first().evaluate((el) => (el.textContent = 'Bartholomew Featherstonehaugh'));
      await a.page.setViewportSize({ width: 320, height: 844 });
      const cut = await a.page.locator('[data-tm-player] .tm-gd-pbtn-name').first().evaluate((el) => ({ over: el.scrollWidth > el.clientWidth, ell: getComputedStyle(el).textOverflow }));
      assert(cut.over && cut.ell === 'ellipsis', `ellipsis: ${JSON.stringify(cut)}`);
      await fits(a.page, '[data-tm-draft-card]');
      await SH(a.page, `A-draft-long-320-${scheme}`);
      await a.page.reload();
      await a.page.locator('[data-tm-draft-card]').waitFor();
      await a.page.setViewportSize({ width: 390, height: 844 });
      const nameAt = (i) => btns.nth(i).getAttribute('data-tm-player-name');
      // Pick team 1's second player: lime with dark text, the chip says "Swap <name> with…".
      const first = await nameAt(1);
      await btns.nth(1).click();
      assert((await btns.nth(1).getAttribute('aria-pressed')) === 'true', 'picked');
      await a.page.waitForTimeout(450);
      const look = await btns.nth(1).evaluate((el) => [getComputedStyle(el).backgroundColor, getComputedStyle(el).color]);
      assert(look[0] === 'rgb(216, 240, 59)' && look[1] === 'rgb(26, 36, 16)', `lime: ${look}`);
      assert((await chip()).toUpperCase() === `SWAP ${first} WITH…`.toUpperCase(), await chip());
      const chipBg = await a.page.locator('[data-tm-draft-count]').evaluate((el) => getComputedStyle(el).backgroundColor);
      assert(chipBg === 'rgb(216, 240, 59)', `lime chip: ${chipBg}`);
      await SH(a.page, `A-picked-${scheme}`);
      // Tap them again: unpick. Tap the teammate: the teammate is picked instead.
      await btns.nth(1).click();
      assert((await btns.nth(1).getAttribute('aria-pressed')) === 'false' && (await chip()).toUpperCase() === '8 LOCKED IN', 'unpicked');
      await btns.nth(1).click();
      const mate = await nameAt(0);
      await btns.nth(0).click();
      assert((await btns.nth(0).getAttribute('aria-pressed')) === 'true' && (await btns.nth(1).getAttribute('aria-pressed')) === 'false', 'the teammate instead');
      assert((await chip()).toUpperCase() === `SWAP ${mate} WITH…`.toUpperCase(), await chip());
      await btns.nth(0).click();
      // Pick team 1's 2nd, tap team 2's 1st: they change places, both totals flash and update, saved at once.
      const other = await nameAt(2);
      await btns.nth(1).click();
      await btns.nth(2).click();
      const flashing = await a.page.locator('[data-tm-team-total].tm-gd-flash').count();
      assert(flashing === 2, `two totals flash: ${flashing}`);
      const moving = await a.page.evaluate(() => document.getAnimations().filter((x) => x.constructor.name === 'Animation' && x.effect && x.effect.target && x.effect.target.matches('[data-tm-player]')).length);
      assert(moving === 2, `two names slide: ${moving}`);
      await SH(a.page, `A-swapping-${scheme}`);
      assert((await nameAt(1)) === other && (await nameAt(2)) === first, `places: ${await nameAt(1)} ${await nameAt(2)}`);
      assert((await chip()).toUpperCase() === '8 LOCKED IN', 'the pick clears');
      const t1 = await totals();
      assert(t1[0] !== t0[0] && t1[1] !== t0[1], `totals update: ${t0} -> ${t1}`);
      await a.page.waitForTimeout(1200);
      const saved = (await dash()).tournament.day.teams;
      assert(saved[0].players.some((p) => p.name === other) && saved[1].players.some((p) => p.name === first), 'saved on the server');
      await a.page.reload();
      await a.page.locator('[data-tm-draft-card]').waitFor();
      assert((await nameAt(1)) === other, 'still swapped after a reload');
      // Redo clears a pick.
      await btns.nth(3).click();
      await a.page.locator('[data-tm-redo]').click();
      await a.page.waitForTimeout(900);
      assert((await a.page.locator('[data-tm-player][aria-pressed="true"]').count()) === 0 && (await chip()).toUpperCase() === '8 LOCKED IN', 'Redo clears the pick');
      await btns.nth(0).click();
      await a.page.locator('[data-tm-publish]').click();
      await a.page.locator('[data-tm-night]').waitFor({ timeout: 10000 });
      await SH(a.page, `A-night-admin-390-${scheme}`);
      await noDash(a.page, 'admin');
      assert(a.errors.length === 0, a.errors.join(' | '));
      await a.ctx.close();
    });
  await check('A reduced motion: a swap just changes places (no slide)', async () => {
    await stage('day_ready');
    const a = await adminPage({ reducedMotion: 'reduce' });
    await a.page.locator('[data-tm-draft]').click();
    await a.page.locator('[data-tm-draft-card]').waitFor();
    const btns = a.page.locator('[data-tm-player]');
    const first = await btns.nth(1).getAttribute('data-tm-player-name');
    await btns.nth(1).click();
    await btns.nth(2).click();
    const moving = await a.page.evaluate(() => document.getAnimations().filter((x) => x.constructor.name === 'Animation').length);
    assert(moving === 0, `no animation: ${moving}`);
    assert((await btns.nth(2).getAttribute('data-tm-player-name')) === first, 'swapped');
    await a.ctx.close();
  });

  // ---------------------------------------------------------------- B  before the night (mock 16)
  await stage('teams_published');
  for (const scheme of SCHEMES)
    for (const w of SIZES)
      await check(`B Vic before the night at ${w} ${scheme}: your team (pencil, dice), your games, all teams`, async () => {
        const v = await playerPage('Vic', { width: w, scheme });
        await v.page.locator('[data-tc-day="before"]').waitFor({ timeout: 15000 });
        assert((await v.page.locator('.tc-short').count()) === 1, 'the ticket stays');

        const games = (await v.page.locator('[data-tc-day-game]').allInnerTexts()).map(flat);
        assert(games.length === 4 && games[0].startsWith('Game 1 Court 1 vs Third Shot Gang') && games[3].startsWith('Final'), games.join(' | '));
        // Your team: the name big in the body font, the players under it, a pencil and a dice (before Game 1).
        const tc = v.page.locator('[data-tc-day-team-card]');
        assert(flat(await tc.innerText()).includes('Net Ninjas Vic + Wren'), await tc.innerText());
        assert((await tc.locator('[data-tc-team-pencil], [data-tc-team-dice]').count()) === 2, 'pencil and dice');
        const font = await tc.locator('.tc-gd-tn b').first().evaluate((el) => getComputedStyle(el).fontFamily);
        assert(!/Bricolage/i.test(font), `body font for the team name: ${font}`);
        assert((await v.page.locator('[data-tc-day-team]').count()) === 4, 'all teams');
        await fits(v.page, '.tc-gd');
        await v.page.evaluate(() => window.scrollTo(0, 0));
        await SH(v.page, `B-before-${w}-${scheme}`);
        await v.page.locator('[data-tc-day-games]').scrollIntoViewIfNeeded();
        await SH(v.page, `B-before-games-${w}-${scheme}`);
        await noDash(v.page, 'player');
        assert(v.errors.length === 0, v.errors.join(' | '));
        await v.ctx.close();
      });

  // ---------------------------------------------------------------- C  game night as Vic and Parker (mocks 17 to 19) and the add-on's motion (D)
  const toastBox = (page) => page.locator('.pop.toast');
  await stage('game1');
  for (const scheme of SCHEMES)
    await check(`C Game 1 (${scheme}): We won lights up, slides on, toast with Undo, sent after 5 s, Parker confirms`, async () => {
      if (scheme === 'dark') await stage('game1');
      const v = await playerPage('Vic', { scheme, reducedMotion: 'no-preference' });
      await v.page.locator('[data-tc-day-hero]').waitFor({ timeout: 15000 });
      assert((await v.page.locator('.tc-short').count()) === 0, 'the live view takes the ticket place');
      // The week's game cards fold into one button during the live window; it opens and folds in place.
      assert((await v.page.locator('.schedule').count()) === 0, 'future games folded');
      await v.page.locator('[data-future-toggle]').click();
      assert((await v.page.locator('.schedule').count()) === 1, 'opened in place');
      await v.page.waitForTimeout(600);
      const label = flat(await v.page.locator('[data-future-toggle]').innerText());
      assert(label === 'Hide future games', label);
      await v.page.locator('[data-future-toggle]').click();
      await v.page.waitForTimeout(300);
      assert((await v.page.locator('.schedule').count()) === 0, `folded again (${flat(await v.page.locator('[data-future-toggle]').innerText())})`);
      // The big card: both teams side by side with VS, players under each.
      assert(/Net Ninjas Vic \+ Wren VS Third Shot Gang Parker \+ Quinn/.test(flat(await v.page.locator('[data-tc-day-next]').innerText())), await v.page.locator('[data-tc-day-next]').innerText());
      const nums = await v.page.locator('.tc-gd-rec').first().evaluate((el) => getComputedStyle(el).fontFamily);
      assert(!/Bricolage/i.test(nums), `body font for records: ${nums}`);
      const bar = () => v.page.locator('[data-tc-day-progress]').innerText().then((x) => flat(x).toUpperCase());
      assert((await bar()) === 'GAME 1 OF 3', await bar());
      for (const w of [420, ...SIZES]) {
        await v.page.setViewportSize({ width: w, height: 844 });
        await fits(v.page, '.tc-gd, [data-tc-day-hero]');
        await SH(v.page, `C-game1-${w}-${scheme}`);
      }
      await v.page.setViewportSize({ width: 390, height: 844 });
      let posted = 0;
      v.page.on('request', (r) => r.method() === 'POST' && r.url().endsWith('/api/tournament/game') && posted++);
      // Tap We won: our side lights lime with a check, the button says "✓ Let's go!", the other side and button dim.
      await v.page.locator('[data-tc-day-wewon]').click();
      await v.page.waitForTimeout(350);
      const btn = flat(await v.page.locator('[data-tc-day-next="1"] [data-tc-day-wewon]').innerText());
      assert(btn === '✓ Let\u2019s go!', `button: ${btn}`);
      const lit = await v.page.evaluate(() => {
        const card = document.querySelector('[data-tc-day-next="1"]');
        const mine = card.querySelector('.tc-gd-side-a');
        const theirs = card.querySelector('.tc-gd-vs > .tc-gd-tn:last-child');
        return {
          check: !!card.querySelector('.tc-gd-litcheck'),
          litBg: mine && getComputedStyle(mine).backgroundColor,
          otherOpacity: theirs && Number(getComputedStyle(theirs).opacity),
          otherBtn: Number(getComputedStyle(card.querySelector('[data-tc-day-theywon]')).opacity),
        };
      });
      assert(lit.check && /216, 240, 59/.test(lit.litBg) && lit.otherOpacity < 1 && lit.otherBtn < 1, `lit: ${JSON.stringify(lit)}`);
      // The real bottom banner: "Net Ninjas won Game 1", Undo, and a thin line draining over 5 seconds.
      await toastBox(v.page).waitFor();
      const tText = flat(await toastBox(v.page).innerText());
      assert(tText.startsWith('Net Ninjas won Game 1') && tText.includes('Undo'), `toast: ${tText}`);
      const drain = await toastBox(v.page).locator('.toast-drain').evaluate((el) => [getComputedStyle(el).animationName, getComputedStyle(el).animationDuration]);
      assert(drain[0] === 'toast-drain' && drain[1] === '5s', `drain: ${drain}`);
      await SH(v.page, `C-lit-${scheme}`);
      // About a second later the card slides to Game 2; the bar says Game 2 of 3; Game 1 gets a green Won tag.
      await v.page.locator('.tc-gd-slide-out').waitFor({ timeout: 2500 });
      await SH(v.page, `C-slide-${scheme}`);
      await v.page.waitForTimeout(600);
      // (data-tc-day-next is the night's game number; Vic's Game 2 is a later game of the night.)
      assert((await v.page.locator('[data-tc-day-next]').getAttribute('data-tc-day-next')) !== '1', 'Game 1 left the big card');
      assert(/^(Up next · )?Game 2/i.test(flat(await v.page.locator('.tc-gd-next-kicker').innerText())), await v.page.locator('.tc-gd-next-kicker').innerText());
      assert((await bar()) === 'GAME 2 OF 3', await bar());
      const g1 = v.page.locator('[data-tc-day-game="Game 1"]');
      assert((await g1.getAttribute('data-state')) === 'done' && flat(await g1.locator('.tc-gd-tag-won').innerText()) === 'Won', 'Game 1 Won tag');
      assert((await v.page.locator('[data-tc-day-game="Game 2"]').getAttribute('data-state')) === 'next', 'the highlight moves to Game 2');
      assert(posted === 0, 'nothing sent yet');
      await SH(v.page, `C-game2-${scheme}`);
      // Sent at 5 seconds.
      await v.page.waitForTimeout(3800);
      assert(posted === 1, `sent after 5 seconds: ${posted}`);
      await v.page.reload();
      await v.page.locator('[data-tc-day-hero]').waitFor();
      await v.page.waitForTimeout(800);
      const stand = flat(await v.page.locator('[data-tc-day-standings]').innerText());
      assert(stand.includes('Net Ninjas Vic + Wren 1-0'), stand);
      assert(v.errors.length === 0, v.errors.join(' | '));
      await v.ctx.close();
      // Parker's "Did you win?" stays as it was.
      const p = await playerPage('Parker', { scheme });
      await p.page.locator('[data-tc-day-confirm]').waitFor({ timeout: 15000 });
      await SH(p.page, `C-confirm-${scheme}`);
      await p.page.locator('[data-tc-day-yes]').click();
      await p.page.waitForTimeout(800);
      const d = await dash();
      assert(d.tournament.day.games[0].winner === 'a', 'confirmed');
      assert(p.errors.length === 0, p.errors.join(' | '));
      await p.ctx.close();
    });
  await check('C "<other team> won": no lime, the card slides, the banner names them; Undo puts Game 1 back', async () => {
    await stage('game1');
    const v = await playerPage('Vic', { reducedMotion: 'no-preference' });
    await v.page.locator('[data-tc-day-theywon]').waitFor({ timeout: 15000 });
    let posted = 0;
    v.page.on('request', (r) => r.method() === 'POST' && r.url().endsWith('/api/tournament/game') && posted++);
    await v.page.locator('[data-tc-day-theywon]').click();
    await v.page.waitForTimeout(80);
    assert((await v.page.locator('.tc-gd-litcheck, .tc-gd-next-lit').count()) === 0, 'no lime');
    assert(!flat(await v.page.locator('body').innerText()).includes('Let\u2019s go'), 'no Let\u2019s go');
    assert((await v.page.locator('.tc-gd-slide-out').count()) === 1, 'it slides at once');
    const tText = flat(await toastBox(v.page).innerText());
    assert(tText.startsWith('Third Shot Gang won Game 1') && tText.includes('Undo'), `toast: ${tText}`);
    await v.page.waitForTimeout(600);
    assert((await v.page.locator('[data-tc-day-game="Game 1"] .tc-gd-tag').innerText()) === 'Lost', 'Lost tag');
    await SH(v.page, 'C-theywon');
    await toastBox(v.page).locator('.toast-action').click();
    await v.page.waitForTimeout(600);
    assert((await v.page.locator('[data-tc-day-next]').getAttribute('data-tc-day-next')) === '1', 'Undo puts Game 1 back');
    assert(flat(await v.page.locator('[data-tc-day-wewon]').innerText()) === 'We won', 'with We won');
    assert((await bar2(v.page)) === 'GAME 1 OF 3', 'the bar goes back');
    await v.page.waitForTimeout(5200);
    assert(posted === 0, `Undo sends nothing: ${posted}`);
    await v.ctx.close();
  });
  await check('C leaving Home inside the 5 seconds still sends it; reduced motion has no glow or slide', async () => {
    await stage('game1');
    const v = await playerPage('Vic', { reducedMotion: 'reduce' });
    await v.page.locator('[data-tc-day-wewon]').waitFor({ timeout: 15000 });
    await v.page.locator('[data-tc-day-wewon]').click();
    await v.page.waitForTimeout(80);
    assert((await v.page.locator('.tc-gd-litcheck, .tc-gd-next-lit, .tc-gd-slide-out').count()) === 0, 'no glow or slide');
    assert((await v.page.locator('[data-tc-day-next]').getAttribute('data-tc-day-next')) !== '1' && /Game 2/i.test(await v.page.locator('.tc-gd-next-kicker').innerText()), 'the card just changes');
    // The phone locks or the player switches apps inside the 5 seconds: the page goes hidden, and the result is sent then.
    await v.page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await sleep(900);
    await v.ctx.close();
    await sleep(900);
    const d = await dash();
    const g = d.tournament.day.games.find((x) => x.num === 1);
    assert(g.claim === 'a' || g.winner === 'a', `sent on leaving: ${JSON.stringify({ claim: g.claim, winner: g.winner })}`);
  });

  // ---------------------------------------------------------------- D  the organizer's game night (mocks 48 to 50)
  await stage('mid');
  for (const scheme of SCHEMES)
    await check(`D admin game night (${scheme}): results, Time check Apply, Fix, Pause, Player left`, async () => {
      if (scheme === 'dark') await stage('mid');
      const a = await adminPage({ scheme });
      await a.page.locator('[data-tm-night]').waitFor({ timeout: 15000 });
      await a.page.locator('[data-tm-time-check]').waitFor({ timeout: 5000 });
      await SH(a.page, `D-night-390-${scheme}`);
      for (const w of SIZES) {
        await a.page.setViewportSize({ width: w, height: 844 });
        await fits(a.page, '[data-tm-night], [data-tm-round], [data-tm-time-check]');
        await SH(a.page, `D-night-${w}-${scheme}`);
      }
      await a.page.setViewportSize({ width: 390, height: 844 });
      await a.page.locator('[data-tm-fix-game]').first().click();
      await a.page.locator('[data-tm-fix-sheet]').waitFor();
      await SH(a.page, `D-fix-${scheme}`);
      await a.page.locator('[data-tm-fix-pick="b"]').click();
      await a.page.locator('[data-tm-fix-save]').click();
      await a.page.waitForTimeout(700);
      await a.page.locator('[data-tm-time-apply]').click();
      await a.page.waitForTimeout(700);
      await a.page.locator('[data-tm-player-left]').click();
      await a.page.locator('[data-tm-left-who]').first().click();
      await a.page.locator('[data-tm-left-sheet]').waitFor();
      await SH(a.page, `D-left-${scheme}`);
      await a.page.locator('[data-tm-left-confirm]').click();
      await a.page.waitForTimeout(700);
      await a.page.locator('[data-tm-pause]').click();
      await a.page.waitForTimeout(700);
      await SH(a.page, `D-after-${scheme}`);
      assert(a.errors.length === 0, a.errors.join(' | '));
      await a.ctx.close();
    });

  // ---------------------------------------------------------------- E  12 players pools (mock 51)
  await stage('game1');
  for (const scheme of SCHEMES)
    await check(`E 12 players pools look (${scheme})`, async () => {
      const v = await newPage({ scheme });
      await v.page.goto(`${BASE}/?as=Vic&poolslook=12`);
      await v.page.locator('[data-tc-day-pool="A"]').waitFor({ timeout: 20000 });
      assert(flat(await v.page.locator('[data-tc-day-progress]').innerText()).toUpperCase() === 'POOL PLAY · ROUND 1 OF 3', await v.page.locator('[data-tc-day-progress]').innerText());
      await SH(v.page, `E-pools-390-${scheme}`);
      await v.page.locator('[data-tc-day-night]').scrollIntoViewIfNeeded();
      await SH(v.page, `E-night-390-${scheme}`);
      await fits(v.page, '.tc-gd');
      await v.ctx.close();
    });

  // ---------------------------------------------------------------- F  Finalize with Courts (mocks 60 and 61)
  await stage('zip64_start');
  for (const scheme of SCHEMES)
    await check(`F Finalize: Courts row and the fit line (${scheme})`, async () => {
      const a = await adminPage({ scheme, width: 420, height: 912 });
      // Zip 66: the organizer's card starts collapsed.
      const closed = a.page.locator('[data-tm-home-toggle][aria-expanded="false"]');
      if (await closed.count()) await closed.click();
      await a.page.locator('[data-tm-open-dates]').click();
      await a.page.locator('button[data-heat]').first().waitFor({ timeout: 10000 });
      // The date most can make (from the organizer's own answer).
      const t = (await dash()).tournament;
      const count = (d) => t.signups.filter((x) => x.dates.includes(d)).length;
      const best = [...t.offeredDates].sort((x, y) => count(y) - count(x))[0];
      await a.page.locator(`button[data-day="${best}"]`).click();
      await a.page.locator('[data-tm-finalize]').waitFor({ timeout: 10000 });
      await a.page.waitForTimeout(400);
      await SH(a.page, `F-fits-420-${scheme}`);
      const fit = flat(await a.page.locator('[data-tm-fin-fit]').innerText());
      assert(fit.startsWith('Fits 8 players.'), fit);
      await a.page.locator('[data-tm-fin-courts="1"]').click();
      await a.page.locator('[data-tm-fin-end]').selectOption(String(19 * 60 + 30 + 60));
      await a.page.waitForTimeout(200);
      const tight = flat(await a.page.locator('[data-tm-fin-fit]').innerText());
      assert(tight === 'Too tight for 8 players on 1 court. Use 2 courts or add court time.', tight);
      await SH(a.page, `F-tight-420-${scheme}`);
      const go = await a.page.locator('[data-tm-finalize-go]').boundingBox();
      assert(go && go.y + go.height <= 912, `Finalize date on one screen: ${JSON.stringify(go)}`);
      assert(a.errors.length === 0, a.errors.join(' | '));
      await a.ctx.close();
    });

  // ---------------------------------------------------------------- G  a back out after publishing (odd count)
  await stage('backed_out');
  await check('G backed out: Americano, Copy text for the group, no teams for players', async () => {
    const a = await adminPage({});
    await a.page.locator('[data-tm-odd-switch]').waitFor({ timeout: 15000 });
    const text = await a.page.locator('[data-tm-copy-text]').getAttribute('data-tm-copy-text');
    assert(/^Zoe backed out of The Cold Open\. One spot is open on [A-Z][a-z]{2} [A-Z][a-z]{2} \d+: \$16, pay by .*\. \S+$/.test(text), text);
    await SH(a.page, 'G-odd-admin');
    await a.ctx.close();
    const v = await answerOf('Vic');
    assert(v.data.tournament && !v.data.tournament.day, 'no teams on an Americano night');
    assert(v.data.tournament.styleNote && v.data.tournament.styleNote.text === 'Tournament style is now Americano.', JSON.stringify(v.data.tournament.styleNote));
  });

  // ---------------------------------------------------------------- H  who may see it
  await stage('game1');
  await check('H switched off: no tournament data for a player', async () => {
    await call('PUT', '/api/admin/tournaments-switch', { on: false });
    const v = await answerOf('Vic');
    assert(!('tournament' in v.data), 'no tournament key');
    assert(!v.text.includes('Net Ninjas'), 'no team name');
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
