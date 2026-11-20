/* Zip 71 (🎾71.teams): partner taps on game night, Projected teams on the organizer's Levels card, and one banner when the style switches, in a
 * real browser.
 *
 *   node e2e/zip71.cjs
 *
 * The world is the preview's calm profile as of Thu Nov 19 2026, 10:00 AM Eastern, and the Tournament test page's Zip 71 stages.
 *   A  NO CONFIRMING (zip71_taps): Vic's We won (5 second Undo, then sent) is the result; Wren, Parker and Quinn see Game 1 in, no buttons,
 *      nothing to answer; organizer Home: Done, no Confirm. Undo sends nothing, then Parker can answer first. 390/360/320, light and dark.
 *   B  a stale screen: Parker answered first; Wren's tap is refused ("Parker said Third Shot Gang won. Ask Alex to fix it.").
 *   C  Americano (zip71_am): Vic's score is in at once; the other three see it, no Enter score for Round 1, no "Is this right?".
 *   D  Projected teams (zip71_teams, pictures pair-01 and pair-02): the row at the bottom of Levels with 4; tap opens the pictures' list in place,
 *      tap again folds it; body font; the pencil changes Quinn's level and the open list follows with no reload; 390/360/320 light and dark.
 *   E  hidden for Americano (picked, or an odd count); players never see the row or a level.
 *   F  the style switch: one card, not two (Parker, style_odd); its X hides both for good.
 * Screenshots: .data/zip71-shots (not in git).
 */
const { spawn, spawnSync } = require('node:child_process');
const { readFileSync, mkdirSync, rmSync } = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.E2E_PORT) || 5473;
const BASE = `http://localhost:${PORT}`;
const SEED_ISO = '2026-11-19T14:00:00.000Z';
const NOW_MS = Date.parse('2026-11-19T15:00:00.000Z'); // Thu Nov 19, 10:00 AM Eastern
const PIN = /PIN `(\d{6})`/.exec(readFileSync(path.join(ROOT, 'docs/PREVIEW_FAKE_DB.md'), 'utf8'))[1];
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const SHOTS = path.join(ROOT, '.data', 'zip71-shots');

let passed = 0;
let failed = 0;
const ONLY = process.env.ZIP71_ONLY || '';
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
  const dbFile = path.join(ROOT, '.data', 'zip71-e2e.sqlite');
  mkdirSync(SHOTS, { recursive: true });
  rmSync(dbFile, { force: true });
  const seeded = spawnSync('npx', ['vite-node', 'scripts/load-small-local.ts', '--', dbFile, SEED_ISO, '--calm', '--zip55', '--zip60', '--zip66'], { cwd: ROOT, encoding: 'utf8' });
  if (seeded.status !== 0) throw new Error(`could not build the calm world: ${seeded.stderr || seeded.stdout}`);
  if (await fetch(`${BASE}/api/status`).then((r) => r.ok, () => false)) throw new Error(`port ${PORT} is already in use`);
  const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
    cwd: ROOT,
    env: { ...process.env, DEV_DB: dbFile, SETUP_TOKEN: 'zip71-setup-token-0123456789', DEV_CLOCK: '1', PREVIEW_CALM: 'on', PB_PREVIEW_BUILD: '1' },
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
  const call = async (method, url, data) => {
    const r = await admin.request.fetch(BASE + url, { method, data, headers: { Origin: BASE } });
    assert(r.ok(), `${method} ${url}: ${r.status()} ${await r.text()}`);
    return r.json();
  };
  const stage = (s) => call('POST', '/api/admin/tournament-test', { stage: s });
  /** A phone that picked `name` (the API, as the screen sends it). */
  async function phone(name) {
    const ctx = await browser.newContext();
    const list = (await (await ctx.request.get(BASE + '/api/group')).json()).players;
    const p = list.find((x) => x.name === name);
    await ctx.request.post(BASE + '/api/me', { data: { playerId: p.id }, headers: { Origin: BASE } });
    return ctx;
  }
  async function newPage(opts = {}) {
    const { width = 390, scheme = 'light', height = 844, organizer = false } = opts;
    const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, colorScheme: scheme, isMobile: true, hasTouch: true, userAgent: UA, reducedMotion: 'reduce' });
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
    // On game night the week's games fold into "Show future games": wait for the night's view or the schedule, whichever this Home has.
    await p.page.locator('.schedule, [data-tc-day]').first().waitFor({ timeout: 30000 });
    await p.page.reload();
    await p.page.locator('.schedule, [data-tc-day]').first().waitFor({ timeout: 30000 });
    await p.page.waitForTimeout(700);
    return p;
  }
  async function adminHome(opts = {}) {
    const p = await newPage({ ...opts, organizer: true });
    await p.page.goto(`${BASE}/admin`);
    await p.page.locator('.tab-bar, nav').first().waitFor({ timeout: 30000 });
    await p.page.waitForTimeout(1200);
    return p;
  }
  /** The tournament's Edit page (the card opens first when it is one closed line). */
  async function editPage(opts = {}) {
    const p = await adminHome(opts);
    const toggle = p.page.locator('[data-tm-home-toggle][aria-expanded="false"]');
    if (await toggle.count()) await toggle.first().click();
    // Edit before tickets open; Tickets once they are (the same page, the ticket list on top).
    await p.page.locator('[data-tm-open-edit], [data-tm-tickets]').first().click();
    await p.page.locator('[data-tm-card="levels"]').waitFor({ timeout: 10000 });
    await p.page.waitForTimeout(400);
    return p;
  }
  const noWider = async (page, what) => {
    const w = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
    assert(w[0] <= w[1], `${what}: the page is ${w[0]} px wide on a ${w[1]} px screen`);
  };

  const tapGame = async (who, action) => {
    const ctx = await phone(who);
    const tid = (await (await ctx.request.get(BASE + '/api/group')).json()).tournament.id;
    const r = await ctx.request.post(BASE + '/api/tournament/game', { data: { tournamentId: tid, num: 1, action }, headers: { Origin: BASE } });
    const out = { ok: () => r.ok(), status: () => r.status(), body: await r.text() };
    out.text = async () => out.body;
    await ctx.close();
    return out;
  };
  const game1 = async () => (await call('GET', '/api/admin/dashboard')).tournament.day.games.find((g) => g.num === 1);

  await check('A: no confirming: Vic taps We won (5 second Undo, then sent); Wren, Parker and Quinn see Game 1 in with no buttons and nothing to answer; Home has Done and Fix (390/360/320, light and dark)', async () => {
    await stage('zip71_taps');
    const v = await playerPage('Vic');
    await v.page.locator('[data-tc-day-wewon]').click();
    await v.page.locator('.toast-action').first().waitFor({ timeout: 3000 });
    await v.page.waitForTimeout(6500);
    const g = await game1();
    assert(g.winner === 'a' && !g.claim, `the result at once: ${JSON.stringify(g)}`);
    await v.ctx.close();
    for (const who of ['Wren', 'Parker', 'Quinn'])
      for (const width of SIZES)
        for (const scheme of SCHEMES) {
          if (who !== 'Wren' && (width !== 390 || scheme !== 'light')) continue;
          const p = await playerPage(who, { width, scheme });
          const row = p.page.locator('[data-tc-day-game="Game 1"]');
          assert(flat(await row.innerText()).includes(who === 'Wren' ? 'Won' : 'Lost'), `${who}: Game 1 ${await row.innerText()}`);
          assert((await p.page.locator('[data-tc-day-next]').getAttribute('data-tc-day-next')) !== '1', `${who}: the big card moved on from Game 1`);
          assert((await p.page.locator('[data-tc-day-confirm], [data-tc-day-ask], [data-tc-day-yes], [data-tc-day-no], [data-tc-day-waiting]').count()) === 0, `${who}: nothing to confirm`);
          await noWider(p.page, `${who} ${width} ${scheme}`);
          await p.page.screenshot({ path: path.join(SHOTS, `A-${who}-${width}-${scheme}.png`) });
          assert(p.errors.length === 0, p.errors.join('; '));
          await p.ctx.close();
        }
    const a = await adminHome();
    assert((await a.page.locator('[data-tm-confirm]').count()) === 0, 'no Confirm on Home');
    assert(/Done/.test(flat(await a.page.locator('body').innerText())), 'Home: Done');
    await a.page.screenshot({ path: path.join(SHOTS, 'A-admin.png') });
    await a.ctx.close();
  });

  await check('A: Undo inside the 5 seconds sends nothing, then someone else answers first', async () => {
    await stage('zip71_taps');
    const v = await playerPage('Vic');
    let posted = 0;
    v.page.on('request', (r) => r.method() === 'POST' && r.url().includes('/api/tournament/game') && posted++);
    await v.page.locator('[data-tc-day-wewon]').click();
    await v.page.locator('.toast-action').first().click();
    await v.page.waitForTimeout(5800);
    assert(posted === 0, `Undo sends nothing: ${posted}`);
    const r = await tapGame('Parker', 'won');
    assert(r.ok(), `Parker answers first: ${r.status()} ${await r.text()}`);
    assert((await game1()).winner === 'b', 'Third Shot Gang won');
    await v.ctx.close();
  });

  await check('B: a stale screen: Parker answered first; Wren still had the buttons and taps We won: refused with who answered, and her screen shows the result', async () => {
    await stage('zip71_taps');
    const w = await playerPage('Wren');
    await w.page.locator('[data-tc-day-wewon]').waitFor({ timeout: 5000 });
    const r = await tapGame('Parker', 'won');
    assert(r.ok(), `Parker: ${r.status()}`);
    await w.page.locator('[data-tc-day-wewon]').click();
    await w.page.getByText('Parker said Third Shot Gang won. Ask Alex to fix it.').first().waitFor({ timeout: 12000 });
    await w.page.waitForTimeout(1500);
    assert(flat(await w.page.locator('[data-tc-day-game="Game 1"]').innerText()).includes('Lost'), 'Game 1 Lost on her screen');
    assert((await game1()).winner === 'b', 'still Parker\'s answer');
    await w.page.screenshot({ path: path.join(SHOTS, 'B-wren-refused.png') });
    await w.ctx.close();
  });

  await check('C: Americano: Vic enters 11 to 8 and it is in; his partner and both opponents see the score, no Enter score for Round 1, no Is this right?', async () => {
    await stage('zip71_am');
    const dash = await call('GET', '/api/admin/dashboard');
    const g = dash.tournament.rounds.games.find((x) => x.round === 1 && [...x.a.names, ...x.b.names].includes('Vic'));
    const v = await playerPage('Vic');
    await v.page.locator('[data-tc-day-next] button', { hasText: 'Enter score' }).first().click();
    await v.page.locator('[data-tc-score-sheet], .tc-gd-sheet').first().waitFor({ timeout: 5000 });
    await v.ctx.close();
    // The sheet works as before (zip 61's checks); here the score goes in from Vic's phone as his Submit sends it.
    const vp = await phone('Vic');
    const day = (await (await vp.request.get(BASE + '/api/group')).json()).tournament;
    const mine = day.day.rounds.find((r) => r.round === 1);
    const r = await vp.request.post(BASE + '/api/tournament/game', { data: { tournamentId: day.id, num: mine.num, key: mine.key, action: 'score', mine: 11, theirs: 8 }, headers: { Origin: BASE } });
    assert(r.ok(), `Vic's score: ${r.status()} ${await r.text()}`);
    await vp.close();
    for (const who of [...g.a.names, ...g.b.names].filter((n) => n !== 'Vic'))
      for (const scheme of SCHEMES) {
        const p = await playerPage(who, { scheme });
        assert((await p.page.locator('[data-tc-day-confirm], [data-tc-day-ask], [data-tc-day-yes], [data-tc-day-no], [data-tc-day-waiting]').count()) === 0, `${who}: nothing to answer`);
        assert((await p.page.locator('[data-tc-round-card="1"]').count()) === 0, `${who}: no Round 1 card`);
        const r1 = flat(await p.page.locator('[data-tc-round="1"]').first().innerText());
        const won = g.a.names.includes('Vic') === g.a.names.includes(who);
        assert(r1.includes(won ? 'Won' : 'Lost'), `${who}: Round 1 ${won ? 'Won' : 'Lost'}: ${r1}`);
        const ph = await phone(who);
        const sc = (await (await ph.request.get(BASE + '/api/group')).json()).tournament.day.rounds.find((x) => x.round === 1).score;
        await ph.close();
        assert(JSON.stringify(sc) === JSON.stringify(won ? { mine: 11, theirs: 8 } : { mine: 8, theirs: 11 }), `${who}: the score ${JSON.stringify(sc)}`);
        await p.page.screenshot({ path: path.join(SHOTS, `C-${who}-${scheme}.png`) });
        await p.ctx.close();
      }
  });

  const PICTURE = ['Sage 3.4 + Christopher Vanderberg 3.0 6.4', 'Vic 3.2 + Wren 3.2 6.4', 'Rowan 3.5 + Zoe 2.7 6.25', 'Parker 3.6 + Quinn 2.5 6.1'];
  const rows = async (page) => (await page.locator('[data-tm-projected-team]').allInnerTexts()).map(flat);

  await check('D: Projected teams: the row with 4, opens in place with the pictures\' teams, folds again; body font (390/360/320, light and dark)', async () => {
    await stage('zip71_teams');
    for (const width of SIZES)
      for (const scheme of SCHEMES) {
        const p = await editPage({ width, scheme, height: 1400 });
        const row = p.page.locator('[data-tm-projected-toggle]');
        assert((await row.count()) === 1, `${width} ${scheme}: the row`);
        assert(flat(await row.innerText()) === 'Projected teams 4', `${width} ${scheme}: ${await row.innerText()}`);
        assert((await p.page.locator('[data-tm-projected-team]').count()) === 0, 'folded at first');
        // The last row of the Levels card.
        assert(await p.page.locator('[data-tm-card="levels"] [data-tm-projected]').count(), 'inside Levels');
        await row.click();
        assert(JSON.stringify(await rows(p.page)) === JSON.stringify(PICTURE), `${width} ${scheme}: ${JSON.stringify(await rows(p.page))}`);
        await p.page.locator('[data-tm-projected]').scrollIntoViewIfNeeded();
        await p.page.screenshot({ path: path.join(SHOTS, `D-open-${width}-${scheme}.png`) });
        const font = await p.page.locator('[data-tm-projected-team]').first().evaluate((el) => getComputedStyle(el).fontFamily);
        const body = await p.page.evaluate(() => getComputedStyle(document.body).fontFamily);
        assert(font === body && !/Bricolage/i.test(font), `body font, got ${font}`);
        // Nothing overlaps: each total sits to the right of its names.
        for (const li of await p.page.locator('[data-tm-projected-team]').all()) {
          const names = await li.locator('.tm-proj-names').boundingBox();
          const total = await li.locator('.tm-proj-total').boundingBox();
          assert(names.x + names.width <= total.x + 0.5, `${width} ${scheme}: names run into the total`);
        }
        await noWider(p.page, `Edit ${width} ${scheme}`);
        // The site ignores a repeat tap on the same button within 400 ms (the tap guard, shared/tapGuard.ts): a person's second tap is later.
        await p.page.waitForTimeout(450);
        await row.click();
        await p.page.waitForTimeout(300);
        assert((await row.getAttribute('aria-expanded')) === 'false', 'tap again folds it');
        assert(p.errors.length === 0, p.errors.join('; '));
        await p.ctx.close();
      }
  });

  await check('D: the pencil: Quinn to 3.6 and the open list follows at once, no reload', async () => {
    await stage('zip71_teams');
    const p = await editPage({ height: 1400 });
    await p.page.locator('[data-tm-projected-toggle]').click();
    await p.page.evaluate(() => (window.__noReload = true));
    await p.page.locator('[data-tm-level-row="Quinn"] [data-tm-pencil]').click();
    await p.page.locator('[data-tm-level-sheet] [data-level="360"]').click();
    await p.page.locator('[data-tm-level-save]').click();
    const want = ['Rowan 3.5 + Wren 3.2 6.7', 'Quinn 3.6 + Christopher Vanderberg 3.0 6.6', 'Sage 3.4 + Vic 3.2 6.6', 'Parker 3.6 + Zoe 2.7 6.35'];
    let got = [];
    for (let i = 0; i < 40; i++) {
      got = await rows(p.page);
      if (JSON.stringify(got) === JSON.stringify(want)) break;
      await sleep(150);
    }
    assert(JSON.stringify(got) === JSON.stringify(want), `after the pencil: ${JSON.stringify(got)}`);
    assert(await p.page.evaluate(() => window.__noReload === true), 'the page did not reload');
    await p.page.locator('[data-tm-projected]').scrollIntoViewIfNeeded();
    await p.page.screenshot({ path: path.join(SHOTS, 'D-after-pencil.png') });
    await p.ctx.close();
  });

  await check('E: hidden when the night would be Americano (picked, or an odd count); players never see the row or a level', async () => {
    await stage('zip71_teams');
    // An odd count: Quinn backs out (a real tap from her phone).
    const q = await phone('Quinn');
    const tid = (await (await q.request.get(BASE + '/api/group')).json()).tournament.id;
    const out = await q.request.post(BASE + '/api/tournament/back-out', { data: { tournamentId: tid }, headers: { Origin: BASE } });
    assert(out.ok(), `Quinn backs out: ${out.status()} ${await out.text()}`);
    let p = await editPage();
    assert((await p.page.locator('[data-tm-projected]').count()) === 0, '7 on the list: no row');
    await p.ctx.close();
    await stage('am_before');
    p = await editPage();
    assert((await p.page.locator('[data-tm-projected]').count()) === 0, 'Americano: no row');
    await p.ctx.close();
    await stage('zip71_teams');
    const v = await playerPage('Vic');
    const text = await v.page.locator('body').innerText();
    assert(!/Projected/.test(text), 'no Projected teams for a player');
    const answer = await (await (await phone('Vic')).request.get(BASE + '/api/group')).text();
    assert(!/projected/i.test(answer), 'nothing projected in the player answer');
    await v.ctx.close();
    await q.close();
  });

  await check('F: the style switch: one card (the date and the news), not two; its X hides both for good', async () => {
    await stage('style_odd');
    for (const scheme of SCHEMES) {
      const p = await playerPage('Parker', { scheme });
      const cards = p.page.locator('[data-style-note], [data-format-alert]');
      assert((await cards.count()) === 1, `${scheme}: one card, got ${await cards.count()}`);
      const t = flat(await cards.first().innerText());
      assert(/scheduled for/.test(t) && /Tournament style is now Americano\./.test(t) && !/Format: Americano/.test(t), `${scheme}: ${t}`);
      assert((await p.page.getByText('Tournament style is now Americano.').count()) === 1, 'the news once');
      await p.page.screenshot({ path: path.join(SHOTS, `F-one-card-${scheme}.png`) });
      if (scheme === 'dark') {
        await cards.first().locator('button').last().click();
        await p.page.waitForTimeout(300);
        assert((await p.page.locator('[data-style-note], [data-format-alert]').count()) === 0, 'X hides it');
        await p.page.reload();
        await p.page.locator('.schedule, [data-tc-day]').first().waitFor({ timeout: 30000 });
        await p.page.waitForTimeout(800);
        assert((await p.page.locator('[data-style-note], [data-format-alert]').count()) === 0, 'and it stays hidden (both keys)');
      }
      await p.ctx.close();
    }
  });

  await browser.close();
  console.log(`\nzip71: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
