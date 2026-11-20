/* Zip 72 (🎾72.scores): scores in Locked doubles and one tie rule, in a real browser.
 *
 *   node e2e/zip72.cjs
 *
 * The world is the preview's calm profile as of Thu Nov 19 2026, 10:00 AM Eastern, and the Tournament test page's Zip 72 stages.
 *   A  picture pair-1 (zip72_scores): Vic's VS card has ONE lime Enter score button (no We won, no "<team> won"). 390/360/320, light and dark.
 *   B  picture pair-2: Enter score opens "Final score" with the two team names, − and +, Submit score; a win lights "✓ Let's go!", the banner
 *      "Net Ninjas won 11 to 7" with Undo and its circle, no drain line; sent after 5 seconds: 11 to 7 is in. A loss says "Onto the next!".
 *   C  picture pair-4: Your games "Won 11–7" (green) / "Lost 7–11" (soft red), the next game blue; Standings "+4 pts", "0 pts", "−4 pts".
 *      390/360/320, light and dark; the tag never wraps or cuts; nothing wider than the screen.
 *   D  picture pair-5: organizer Home: Fix on Game 1: "Fix Game 1 · Court 1", the two team names with − and +, Save; the row says 11 to 7; no
 *      Confirm anywhere. Light and dark.
 *   E  the gentle check: 9 to 7 in a game to 11 says "Games are to 11. Fine if it ended early." and can still be sent; equal scores cannot.
 *   F  zip72_circle: the circle settled by point difference (+11, 0, −2, −9 pts), no wheel; Vic's Final is against Kitchen Crew.
 *   G  one count: an I paid waiting counts on every organizer row ("Locked in 7 of 8", the Tickets chip, the Plan chip), as players see it.
 *   H  Americano rows show the score too ("Won 11–8").
 * Screenshots: .data/zip72-shots (not in git).
 */
const { spawn, spawnSync } = require('node:child_process');
const { readFileSync, mkdirSync, rmSync } = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.E2E_PORT) || 5474;
const BASE = `http://localhost:${PORT}`;
const SEED_ISO = '2026-11-19T14:00:00.000Z';
const NOW_MS = Date.parse('2026-11-19T15:00:00.000Z'); // Thu Nov 19, 10:00 AM Eastern
const PIN = /PIN `(\d{6})`/.exec(readFileSync(path.join(ROOT, 'docs/PREVIEW_FAKE_DB.md'), 'utf8'))[1];
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const SHOTS = path.join(ROOT, '.data', 'zip72-shots');

let passed = 0;
let failed = 0;
const ONLY = process.env.ZIP72_ONLY || '';
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
  const dbFile = path.join(ROOT, '.data', 'zip72-e2e.sqlite');
  mkdirSync(SHOTS, { recursive: true });
  rmSync(dbFile, { force: true });
  const seeded = spawnSync('npx', ['vite-node', 'scripts/load-small-local.ts', '--', dbFile, SEED_ISO, '--calm', '--zip55', '--zip60', '--zip66'], { cwd: ROOT, encoding: 'utf8' });
  if (seeded.status !== 0) throw new Error(`could not build the calm world: ${seeded.stderr || seeded.stdout}`);
  if (await fetch(`${BASE}/api/status`).then((r) => r.ok, () => false)) throw new Error(`port ${PORT} is already in use`);
  const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
    cwd: ROOT,
    env: { ...process.env, DEV_DB: dbFile, SETUP_TOKEN: 'zip72-setup-token-0123456789', DEV_CLOCK: '1', PREVIEW_CALM: 'on', PB_PREVIEW_BUILD: '1' },
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
    await p.page.goto(`${BASE}/?as=${encodeURIComponent(who)}${opts.query ?? ''}`);
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
  const MINUS = '−';
  const DASH = '–';
  /** Set the score sheet's two numbers by typing (the sheet's own inputs). */
  async function setScore(page, mine, theirs) {
    for (const [id, n] of [['mine', mine], ['theirs', theirs]]) {
      const box = page.locator(`[data-tc-score-num="${id}"]`);
      await box.fill(String(n));
    }
  }

  await check('A pair-1: one lime Enter score button on the VS card, no We won (390/360/320, light and dark)', async () => {
    await stage('zip72_scores');
    for (const width of SIZES)
      for (const scheme of SCHEMES) {
        const p = await playerPage('Vic', { width, scheme });
        const card = p.page.locator('[data-tc-day-next="1"]');
        await card.waitFor({ timeout: 5000 });
        const btns = card.locator('button');
        assert((await btns.count()) === 1, `one button: ${await btns.allInnerTexts()}`);
        assert(flat(await btns.first().innerText()) === 'Enter score', `Enter score: ${await btns.first().innerText()}`);
        assert((await p.page.locator('[data-tc-day-wewon], [data-tc-day-theywon]').count()) === 0, 'no We won, no "<team> won"');
        const bg = await btns.first().evaluate((el) => getComputedStyle(el).backgroundColor);
        assert(/rgb\(21[0-9], 2[34][0-9], [0-9]{1,2}\)|rgb\(2[0-2][0-9], 2[34][0-9], [0-9]{1,2}\)/.test(bg), `lime: ${bg}`);
        const text = flat(await card.innerText());
        assert(text.includes('Net Ninjas') && text.includes('Third Shot Gang') && text.includes('Vic + Wren') && text.includes('Parker + Quinn'), text);
        await noWider(p.page, `Vic ${width} ${scheme}`);
        await p.page.screenshot({ path: path.join(SHOTS, `A-${width}-${scheme}.png`) });
        assert(p.errors.length === 0, p.errors.join('; '));
        await p.ctx.close();
      }
  });

  await check('B pair-2: the Final score sheet with the team names; a win: "✓ Let\'s go!", the banner with Undo and its circle, no drain line; 11 to 7 is in after 5 seconds', async () => {
    for (const scheme of SCHEMES) {
      await stage('zip72_scores');
      const p = await playerPage('Vic', { scheme, reducedMotion: 'no-preference', query: '&motion=on' });
      await p.page.locator('[data-tc-enter-score]').click();
      const sheet = p.page.locator('[data-tc-score-sheet="1"]');
      await sheet.waitFor({ timeout: 5000 });
      const dialog = p.page.locator('dialog[open]').filter({ has: sheet });
      assert(flat(await dialog.innerText()).startsWith('Final score'), `the title: ${flat(await dialog.innerText()).slice(0, 40)}`);
      const names = (await sheet.locator('.tc-gd-score-name').allInnerTexts()).map(flat);
      assert(JSON.stringify(names) === JSON.stringify(['Net Ninjas', 'Third Shot Gang']), `the team names, ours first: ${names}`);
      assert((await sheet.locator('[data-tc-score-num="mine"]').inputValue()) === '11', 'starts at 11');
      // − and + work: theirs up to 7 by taps.
      for (let i = 0; i < 7; i++) await sheet.locator('[data-tc-score-plus="theirs"]').click();
      assert((await sheet.locator('[data-tc-score-num="theirs"]').inputValue()) === '7', 'theirs 7');
      assert((await sheet.locator('[data-tc-score-hint]').count()) === 0, 'no check line for 11 to 7');
      await p.page.screenshot({ path: path.join(SHOTS, `B-sheet-${scheme}.png`) });
      if (scheme === 'dark') {
        await p.page.locator('.sheet-close, [aria-label="Close"]').first().click();
        await p.ctx.close();
        continue;
      }
      await sheet.locator('[data-tc-score-submit]').click();
      await p.page.locator('[data-tc-day-lit="mine"]').waitFor({ timeout: 2000 });
      assert(flat(await p.page.locator('[data-tc-enter-score]').first().innerText()).includes('Let’s go!'), 'the lit button');
      const box = p.page.locator('.pop.toast').first();
      await box.waitFor({ timeout: 3000 });
      assert(flat(await box.innerText()).includes('Net Ninjas won 11 to 7'), `the banner: ${await box.innerText()}`);
      assert((await box.locator('.m-undo-ring').count()) === 1, 'the circle on Undo');
      assert((await box.locator('.toast-drain').count()) === 0, 'no drain line');
      await p.page.screenshot({ path: path.join(SHOTS, 'B-lit.png') });
      assert((await game1()).winner === null, 'nothing sent during the 5 seconds');
      await p.page.waitForTimeout(6500);
      const g = await game1();
      assert(g.winner === 'a' && g.scoreA === 11 && g.scoreB === 7 && g.by === 'Vic', `in: ${JSON.stringify(g)}`);
      assert(p.errors.length === 0, p.errors.join('; '));
      await p.ctx.close();
    }
    // A loss from the other side: "Onto the next!".
    await stage('zip72_scores');
    const q = await playerPage('Quinn', { reducedMotion: 'no-preference', query: '&motion=on' });
    await q.page.locator('[data-tc-enter-score]').click();
    await q.page.locator('[data-tc-score-sheet]').waitFor({ timeout: 5000 });
    await setScore(q.page, 8, 11);
    await q.page.locator('[data-tc-score-submit]').click();
    await q.page.locator('[data-tc-day-lit="theirs"]').waitFor({ timeout: 2000 });
    assert(flat(await q.page.locator('[data-tc-enter-score]').first().innerText()) === 'Onto the next!', 'Onto the next!');
    assert(flat(await q.page.locator('.pop.toast').first().innerText()).includes('Net Ninjas won 11 to 8'), 'the banner names the winners');
    await q.page.locator('.toast-action').first().click();
    await q.page.waitForTimeout(5800);
    assert((await game1()).winner === null, 'Undo sent nothing');
    await q.ctx.close();
  });

  const tint = (loc) =>
    loc.evaluate((el) => {
      const c = document.createElement('canvas').getContext('2d');
      c.fillStyle = getComputedStyle(el).backgroundColor;
      c.fillRect(0, 0, 1, 1);
      const [r, g, b] = c.getImageData(0, 0, 1, 1).data;
      return { r, g, b };
    });

  await check('C pair-4: Your games "Won 11–7" / "Lost 7–11", Standings "+4 pts" / "0 pts" / "−4 pts" (390/360/320, light and dark)', async () => {
    await stage('zip72_scores');
    const vp = await phone('Vic');
    const tid = (await (await vp.request.get(BASE + '/api/group')).json()).tournament.id;
    const r = await vp.request.post(BASE + '/api/tournament/game', { data: { tournamentId: tid, num: 1, action: 'score', mine: 11, theirs: 7 }, headers: { Origin: BASE } });
    assert(r.ok(), `Vic's score: ${r.status()} ${await r.text()}`);
    await vp.close();
    for (const [who, tag, chip] of [
      ['Vic', `Won 11${DASH}7`, '+4 pts'],
      ['Parker', `Lost 7${DASH}11`, `${MINUS}4 pts`],
    ])
      for (const width of SIZES)
        for (const scheme of SCHEMES) {
          if (who === 'Parker' && width === 320 && scheme === 'dark') continue;
          const p = await playerPage(who, { width, scheme });
          const row = p.page.locator('[data-tc-day-game="Game 1"]');
          const t = row.locator('[data-tc-day-result]');
          assert(flat(await t.innerText()) === tag, `${who}: ${await t.innerText()}`);
          // The tag sits on one line, inside the row.
          const [tb, rb] = await Promise.all([t.boundingBox(), row.boundingBox()]);
          assert(tb.height < 30 && tb.x + tb.width <= rb.x + rb.width + 0.5, `${who} ${width}: the tag fits on one line: ${JSON.stringify(tb)}`);
          const c = await tint(row);
          if (who === 'Vic') assert(c.g > c.r, `${who} ${scheme}: the won row is green ${JSON.stringify(c)}`);
          else assert(c.r > c.g, `${who} ${scheme}: the lost row is soft red ${JSON.stringify(c)}`);
          const mine = p.page.locator('[data-tc-day-stand].tc-gd-me');
          assert(flat(await mine.locator('[data-tc-day-diff]').innerText()) === chip, `${who}: ${await mine.innerText()}`);
          const chips = (await p.page.locator('[data-tc-day-standings] [data-tc-day-diff]').allInnerTexts()).map(flat);
          assert(JSON.stringify([...chips].sort()) === JSON.stringify(['+4 pts', '0 pts', '0 pts', `${MINUS}4 pts`].sort()), `every row has a chip: ${chips}`);
          await noWider(p.page, `${who} ${width} ${scheme}`);
          await p.page.locator('[data-tc-day-games]').screenshot({ path: path.join(SHOTS, `C-${who}-games-${width}-${scheme}.png`) });
          await p.page.locator('[data-tc-day-standings]').screenshot({ path: path.join(SHOTS, `C-${who}-standings-${width}-${scheme}.png`) });
          assert(p.errors.length === 0, p.errors.join('; '));
          await p.ctx.close();
        }
  });

  await check('D pair-5: organizer Home: Set Game 1 · Court 1 (Zip 77) with the team names, − and +, Save; the row says 11 to 7; no Confirm (light and dark)', async () => {
    for (const scheme of SCHEMES) {
      await stage('zip72_scores');
      const a = await adminHome({ scheme });
      assert((await a.page.locator('[data-tm-confirm], [data-tm-am-confirm]').count()) === 0, 'no Confirm');
      await a.page.locator('[data-tm-fix-game="1"]').click();
      const sheet = a.page.locator('[data-tm-fix-sheet="1"]');
      await sheet.waitFor({ timeout: 5000 });
      const dialog = a.page.locator('dialog[open]').filter({ has: sheet });
      // Zip 77 (the 🎾75 audit): Game 1 has no result yet, so the sheet is "Set Game 1 · Court 1" (Fix once it has one).
      assert(flat(await dialog.innerText()).startsWith('Set Game 1 · Court 1'), `title: ${flat(await dialog.innerText()).slice(0, 40)}`);
      const names = (await sheet.locator('.tm-am-step-name').allInnerTexts()).map(flat);
      assert(JSON.stringify(names) === JSON.stringify(['Net Ninjas', 'Third Shot Gang']), `names: ${names}`);
      for (let i = 0; i < 7; i++) await sheet.locator('[data-tm-am-plus="b"]').click();
      assert(flat(await sheet.locator('[data-tm-am-num="a"]').innerText()) === '11' && flat(await sheet.locator('[data-tm-am-num="b"]').innerText()) === '7', 'the numbers');
      await a.page.screenshot({ path: path.join(SHOTS, `D-fix-${scheme}.png`) });
      await sheet.locator('[data-tm-fix-save]').click();
      await a.page.waitForTimeout(1500);
      const g = await game1();
      assert(g.winner === 'a' && g.scoreA === 11 && g.scoreB === 7 && g.resultBy === 'organizer', JSON.stringify(g));
      const row = flat(await a.page.locator('[data-tm-result="1"]').innerText());
      assert(row.includes('Net Ninjas') && row.includes('11 to 7') && row.includes('Fix'), `the row: ${row}`);
      await a.page.screenshot({ path: path.join(SHOTS, `D-after-${scheme}.png`) });
      assert(a.errors.length === 0, a.errors.join('; '));
      await a.ctx.close();
    }
  });

  await check('E the gentle check: 9 to 7 in a game to 11 says so and can still be sent; equal scores cannot be sent', async () => {
    await stage('zip72_scores');
    const p = await playerPage('Wren');
    await p.page.locator('[data-tc-enter-score]').click();
    await p.page.locator('[data-tc-score-sheet]').waitFor({ timeout: 5000 });
    await setScore(p.page, 7, 7);
    assert(await p.page.locator('[data-tc-score-submit]').isDisabled(), 'equal: cannot send');
    await setScore(p.page, 9, 7);
    assert(flat(await p.page.locator('[data-tc-score-hint]').innerText()) === 'Games are to 11. Fine if it ended early.', 'the hint');
    assert(!(await p.page.locator('[data-tc-score-submit]').isDisabled()), 'odd: can send');
    await p.page.screenshot({ path: path.join(SHOTS, 'E-hint.png') });
    await p.ctx.close();
  });

  await check('F zip72_circle: the circle settled by point difference, no wheel; the Final is set (390 light and dark)', async () => {
    await stage('zip72_circle');
    for (const scheme of SCHEMES) {
      const p = await playerPage('Vic', { scheme });
      assert((await p.page.locator('[data-tc-tie], .tc-wheel, [data-tc-wheel]').count()) === 0, 'no wheel');
      const rows = (await p.page.locator('[data-tc-day-standings] [data-tc-day-stand]').allInnerTexts()).map(flat);
      const want = [['Kitchen Crew', '3-0', '+11 pts'], ['Net Ninjas', '1-2', '0 pts'], ['Third Shot Gang', '1-2', `${MINUS}2 pts`], ['Dill With It', '1-2', `${MINUS}9 pts`]];
      want.forEach(([n, rec, chip], i) => assert(rows[i].includes(n) && rows[i].replace(/\s/g, '').includes(rec) && rows[i].includes(chip), `row ${i + 1}: ${rows[i]}`));
      const fin = flat(await p.page.locator('[data-tc-day-next]').innerText());
      assert(/final/i.test(fin) && fin.includes('Kitchen Crew'), `the Final: ${fin}`);
      await p.page.screenshot({ path: path.join(SHOTS, `F-circle-${scheme}.png`), fullPage: true });
      await p.ctx.close();
    }
    const a = await adminHome();
    assert((await a.page.locator('[data-tm-tie], [data-tm-wheel]').count()) === 0, 'no wheel on Home');
    await a.ctx.close();
  });

  await check('G one count: an I paid waiting counts on every organizer row as it does for players', async () => {
    await stage('tickets_open');
    const before = (await call('GET', '/api/admin/dashboard')).tournament;
    const vp = await phone('Vic');
    const g = await (await vp.request.get(BASE + '/api/group')).json();
    const tid = g.tournament.id;
    let r = await vp.request.post(BASE + '/api/tournament/lock', { data: { tournamentId: tid, intent: 'lock', priceCents: g.tournament.tickets?.priceCents ?? g.tournament.priceCents ?? 1600 }, headers: { Origin: BASE } });
    assert(r.ok(), `lock: ${r.status()} ${await r.text()}`);
    const owed = (await (await vp.request.get(BASE + '/api/group')).json()).tournament.tickets.mine.owedCents;
    if (owed > 0) {
      r = await vp.request.post(BASE + '/api/tournament/paid', { data: { tournamentId: tid, cents: owed }, headers: { Origin: BASE } });
      assert(r.ok(), `I paid: ${r.status()} ${await r.text()}`);
    }
    const seen = (await (await vp.request.get(BASE + '/api/group')).json()).tournament.tickets.locked.length;
    await vp.close();
    const t = (await call('GET', '/api/admin/dashboard')).tournament;
    assert(t.lockedIn === before.lockedIn + 1 && t.lockedIn === seen, `server: ${before.lockedIn} -> ${t.lockedIn}, players see ${seen}`);
    const a = await adminHome();
    const toggle = a.page.locator('[data-tm-home-toggle][aria-expanded="false"]');
    if (await toggle.count()) await toggle.first().click();
    await a.page.waitForTimeout(400);
    const row = flat(await a.page.locator('[data-tm-row="locked"]').first().innerText());
    assert(row.startsWith(`${t.lockedIn} of `), `Home card: Locked in ${row} (server ${t.lockedIn})`);
    await a.page.screenshot({ path: path.join(SHOTS, 'G-card.png') });
    await a.page.locator('[data-tm-open-edit], [data-tm-tickets]').first().click();
    await a.page.locator('[data-tm-locked-chip]').waitFor({ timeout: 10000 });
    const chip = flat(await a.page.locator('[data-tm-locked-chip]').innerText());
    assert(chip.startsWith(`${t.lockedIn} of `), `Tickets chip: ${chip}`);
    const plan = a.page.locator('[data-tm-plan-locked]');
    if (await plan.count()) assert(flat(await plan.innerText()) === `${t.lockedIn} locked in`, `Plan chip: ${await plan.innerText()}`);
    await a.ctx.close();
  });

  await check('H Americano rows show the score too: "Won 11–8"', async () => {
    await stage('zip71_am');
    const vp = await phone('Vic');
    const day = (await (await vp.request.get(BASE + '/api/group')).json()).tournament;
    const mine = day.day.rounds.find((x) => x.round === 1);
    const r = await vp.request.post(BASE + '/api/tournament/game', { data: { tournamentId: day.id, num: mine.num, key: mine.key, action: 'score', mine: 11, theirs: 8 }, headers: { Origin: BASE } });
    assert(r.ok(), `Vic: ${r.status()}`);
    await vp.close();
    for (const scheme of SCHEMES) {
      const p = await playerPage('Vic', { scheme });
      const tag = flat(await p.page.locator('[data-tc-round="1"] [data-tc-day-result]').innerText());
      assert(tag === `Won 11${DASH}8`, tag);
      await noWider(p.page, `americano ${scheme}`);
      await p.page.locator('[data-tc-rounds]').screenshot({ path: path.join(SHOTS, `H-${scheme}.png`) });
      await p.ctx.close();
    }
  });

  await browser.close();
  console.log(`\nzip72: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
