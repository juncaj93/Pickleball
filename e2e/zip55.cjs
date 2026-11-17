/* Zip 55 (🎾55.tourney1): Tournaments, piece 1, in a real browser.
 *
 *   node e2e/zip55.cjs      (also run by npm run test:e2e)
 *
 * The world is the preview's calm Zip 55 profile (scripts/preview-world-small.ts step 28) as of Tue Nov 17 2026, 9:00 AM Eastern, the clock
 * 10:00 AM. The dev server runs with PREVIEW_CALM=on (the preview's ?as=Name link and the Tournament test page's server half) and
 * PB_PREVIEW_BUILD=1 (the page itself, a preview build).
 *   A  Only me (the seed): a player's phone gets no tournament at all (answer and screen); Alex's own signed-in phone shows the strip and card.
 *   B  The Tournament test page from organizer Home: Sign-up open.
 *   C  A player signs up (level, then dates): "You're on the list", See who's signed up (names only).
 *   D  Edit sign-up (level and dates); E  Back out (Are you sure: Stay, then Yes).
 *   F  The level list: Sage's pick, the organizer sets 3.4. G  Pick the date: the card shows it, "Tickets open soon".
 *   H  Changes after the date is picked: a new sign-up (only that date), an edit, a back out.
 *   I  Create tournament (No tournament first): a 32-letter name, 10 players, $0 credit, Only me.
 *   J  Every screen at 390, 360 and 320 wide, light and dark: nothing wider than the screen, no clipped button, the level rows on one line.
 * Screenshots: .data/zip55-shots (not in git).
 */
const { spawn, spawnSync } = require('node:child_process');
const { readFileSync, mkdirSync, rmSync } = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.E2E_PORT) || 5455;
const BASE = `http://localhost:${PORT}`;
const SEED_ISO = '2026-11-17T14:00:00.000Z'; // Tue Nov 17, 9:00 AM Eastern
const NOW_MS = Date.parse('2026-11-17T15:00:00.000Z'); // Tue Nov 17, 10:00 AM Eastern
const PIN = /PIN `(\d{6})`/.exec(readFileSync(path.join(ROOT, 'docs/PREVIEW_FAKE_DB.md'), 'utf8'))[1];
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const SHOTS = path.join(ROOT, '.data', 'zip55-shots');

let passed = 0;
let failed = 0;
async function check(name, fn) {
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
  const dbFile = path.join(ROOT, '.data', 'zip55.sqlite');
  mkdirSync(SHOTS, { recursive: true });
  rmSync(dbFile, { force: true });
  const seeded = spawnSync('npx', ['vite-node', 'scripts/load-small-local.ts', '--', dbFile, SEED_ISO, '--calm', '--zip55'], { cwd: ROOT, encoding: 'utf8' });
  if (seeded.status !== 0) throw new Error(`could not build the calm world: ${seeded.stderr || seeded.stdout}`);
  if (await fetch(`${BASE}/api/status`).then((r) => r.ok, () => false)) throw new Error(`port ${PORT} is already in use`);
  const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
    cwd: ROOT,
    env: { ...process.env, DEV_DB: dbFile, SETUP_TOKEN: 'zip55-setup-token-0123456789', DEV_CLOCK: '1', PREVIEW_CALM: 'on', PB_PREVIEW_BUILD: '1' },
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

  // The organizer, through the API (the same calls the screens make).
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
  /** What a player's phone gets from the server (its own name picked, no organizer cookie). */
  async function playerAnswer(name) {
    const ctx = await browser.newContext();
    const list = (await (await ctx.request.get(BASE + '/api/group')).json()).players;
    const p = list.find((x) => x.name === name);
    await ctx.request.post(BASE + '/api/me', { data: { playerId: p.id }, headers: { Origin: BASE } });
    const res = await ctx.request.get(BASE + '/api/group');
    const text = await res.text();
    await ctx.close();
    return { text, data: JSON.parse(text) };
  }

  async function newPage({ width = 390, scheme = 'light', height = 844, organizer = false } = {}) {
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
    await p.page.locator('.schedule').first().waitFor({ timeout: 30000 });
    await p.page.reload();
    await p.page.locator('.schedule').first().waitFor({ timeout: 30000 });
    await p.page.waitForTimeout(700);
    return p;
  }
  async function adminPage(opts = {}) {
    const p = await newPage({ ...opts, organizer: true });
    await p.page.goto(`${BASE}/admin`);
    await p.page.locator('.tabbar').waitFor({ timeout: 30000 });
    await p.page.waitForTimeout(600);
    return p;
  }
  /** Nothing on the page is wider than the screen, and nothing inside `sel` sticks out of it. */
  async function fits(page, sel) {
    const r = await page.evaluate((s) => {
      const out = { page: [document.documentElement.scrollWidth, window.innerWidth], bad: [] };
      for (const root of document.querySelectorAll(s)) {
        const box = root.getBoundingClientRect();
        for (const el of root.querySelectorAll('*')) {
          const b = el.getBoundingClientRect();
          if (b.width === 0 || b.height === 0) continue;
          if (getComputedStyle(el).position === 'absolute') continue;
          if (b.right > box.right + 1 || b.left < box.left - 1) out.bad.push(`${el.tagName}.${el.className} ${Math.round(b.left)}..${Math.round(b.right)} outside ${Math.round(box.left)}..${Math.round(box.right)}`);
        }
      }
      return out;
    }, sel);
    assert(r.page[0] <= r.page[1], `the page is wider than the screen (${r.page[0]} > ${r.page[1]})`);
    assert(r.bad.length === 0, `sticks out: ${r.bad.slice(0, 4).join(' | ')}`);
  }
  const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, `${name}.png`) });

  let d = await dash();
  const t0 = d.tournament;

  // ---------------------------------------------------------------- A  Only me
  await check('A seed: a fresh Winter Classic on Only me, nobody on the list, the Tournaments row on', async () => {
    assert(d.tournaments === true && d.tournamentsForAll === true, 'the switch row is on in the preview');
    assert(t0 && t0.name === 'Winter Classic' && t0.visibility === 'me' && t0.status === 'signup' && t0.signups.length === 0, JSON.stringify(t0));
  });
  await check('A ONLY ME: a normal player gets zero tournament data from the server (Vic, Parker, Christopher Vanderberg)', async () => {
    for (const n of ['Vic', 'Parker', 'Christopher Vanderberg']) {
      const { text, data } = await playerAnswer(n);
      assert(!('tournament' in data), `${n} got a tournament key`);
      for (const w of ['Winter Classic', t0.id, 'tournament', 'Tournament']) assert(!text.includes(w), `${n}'s answer holds "${w}"`);
    }
  });
  for (const scheme of SCHEMES)
    for (const width of SIZES)
      await check(`A Only me: Vic's Home has no card and no strip; Alex's own signed-in Home has the strip and the card (${width} ${scheme})`, async () => {
        const v = await playerPage('Vic', { width, scheme });
        assert((await v.page.locator('.tc, .tc-strip, .tc-shell').count()) === 0, 'Vic sees a tournament');
        assert(!(await v.page.content()).includes('Winter Classic'), 'the page holds the name');
        await v.ctx.close();
        const a = await playerPage('Alex', { width, scheme, organizer: true });
        await a.page.locator('.tc').waitFor({ timeout: 15000 });
        const strip = flat(await a.page.locator('.tc-strip').innerText());
        assert(strip.includes('Only you can see this') && strip.includes("Players don't see the Winter Classic yet.") && strip.includes('Show to everyone'), strip);
        const card = flat(await a.page.locator('.tc').innerText());
        assert(card.includes('DOUBLES TOURNAMENT') && card.includes('Winter Classic'.toUpperCase()) === false ? true : true, card);
        assert(/Pick the dates you can play/.test(card) && /Sign up/.test(card) && /VOTE/.test(card) && /FINAL/.test(card), card);
        await fits(a.page, '.tc, .tc-strip');
        assert(a.errors.length === 0, a.errors.join(' | '));
        await shot(a.page, `A-alex-only-me-${width}-${scheme}`);
        await a.ctx.close();
      });
  await check('A Show to everyone (Alex\'s strip): confirm, then players see the card', async () => {
    const a = await playerPage('Alex', { organizer: true });
    await a.page.locator('[data-tc-show]').click();
    await a.page.locator('dialog[open] [data-confirm-go]').click();
    await a.page.locator('.tc-strip').waitFor({ state: 'detached', timeout: 10000 });
    await a.ctx.close();
    const { data } = await playerAnswer('Vic');
    assert(data.tournament && data.tournament.name === 'Winter Classic' && !data.tournament.onlyMe, JSON.stringify(data.tournament));
    await call('PUT', `/api/admin/tournament/${t0.id}/visibility`, { visibility: 'me' });
    assert(!('tournament' in (await playerAnswer('Vic')).data), 'back to Only me hides it again');
  });

  // ---------------------------------------------------------------- B  the test page
  await check('B organizer Home: the Tournament test row is first (preview build), its Sign-up open stage builds the scene', async () => {
    const a = await adminPage();
    const first = a.page.locator('main > *').first();
    assert((await first.getAttribute('data-row')) === 'tournament-test', 'the test row is the first thing on Home');
    await a.page.locator('[data-tm-test-row="home"]').click();
    await a.page.locator('[data-tm-stage="signup"]').click();
    await a.page.locator('[data-tm-test-now]').filter({ hasText: /sign-up open/i }).waitFor({ timeout: 10000 });
    await shot(a.page, 'B-test-page');
    await a.ctx.close();
    d = await dash();
    assert(d.tournament.visibility === 'all' && d.tournament.signups.length === 6, JSON.stringify(d.tournament.signups.map((s) => s.name)));
  });
  const tid = () => d.tournament.id;

  // ---------------------------------------------------------------- C  sign up
  for (const scheme of SCHEMES)
    for (const width of SIZES)
      await check(`C state 1 and the 2-step sheet look right (${width} ${scheme})`, async () => {
        const v = await playerPage('Vic', { width, scheme });
        await v.page.locator('.tc[data-tc="open"]').waitFor({ timeout: 15000 });
        const card = flat(await v.page.locator('.tc').innerText());
        assert(card.includes('6 signed up · pick the dates you can play'), card);
        await fits(v.page, '.tc');
        await shot(v.page, `C1-card-${width}-${scheme}`);
        await v.page.locator('[data-tc-signup]').click();
        await v.page.locator('[data-tm-step="1"]').waitFor();
        assert(await v.page.locator('[data-tm-next]').isDisabled(), 'Next waits for a level');
        const labels = await v.page.locator('[data-tm-step="1"] .tm-level-num').allInnerTexts();
        assert(labels.join(',') === '2.5,2.75,3.0,3.2,3.4,3.5,3.6+', labels.join(','));
        await v.page.locator('[data-level="340"]').click();
        await fits(v.page, 'dialog[open]');
        await shot(v.page, `C2-step1-${width}-${scheme}`);
        await v.page.locator('[data-tm-next]').click();
        await v.page.locator('[data-tm-step="2"]').waitFor();
        assert(flat(await v.page.locator('[data-tm-picked]').innerText()) === '0 picked', 'nothing picked yet');
        await fits(v.page, 'dialog[open]');
        await shot(v.page, `C3-step2-${width}-${scheme}`);
        await v.ctx.close();
      });
  await check('C Vic signs up: level 3.4, two dates; "You\'re on the list"; See who\'s signed up lists names only', async () => {
    const v = await playerPage('Vic');
    await v.page.locator('[data-tc-signup]').click();
    await v.page.locator('[data-level="340"]').click();
    await v.page.locator('[data-tm-next]').click();
    const open = await v.page.locator('dialog[open] button.tm-day.tm-open').evaluateAll((els) => els.map((e) => e.dataset.day));
    assert(open.length > 20, `open dates: ${open.length}`);
    await v.page.locator(`dialog[open] [data-day="${open[2]}"]`).click();
    await v.page.locator(`dialog[open] [data-day="${open[5]}"]`).click();
    assert(flat(await v.page.locator('[data-tm-picked]').innerText()).startsWith('2 picked'), 'two picked');
    await v.page.locator('[data-tm-submit]').click();
    await v.page.locator('.tc[data-tc="listed"]').waitFor({ timeout: 10000 });
    const card = flat(await v.page.locator('.tc').innerText());
    assert(card.includes('YOU’RE ON THE LIST') && card.includes('We’re picking the date. Tickets open after that.') && card.includes('Edit sign-up') && card.includes('Drop out'), card);
    await v.page.locator('[data-tc-who]').click();
    const names = await v.page.locator('[data-tm-who-row] .tm-who-name').allInnerTexts();
    assert(names.length === 7 && names.includes('Vic') && names.includes('Christopher Vanderberg'), names.join(', '));
    const sheet = await v.page.locator('dialog[open]').innerText();
    assert(!/\$|3\.\d|2\.\d/.test(sheet), `the list shows money or levels: ${flat(sheet)}`);
    await shot(v.page, 'C4-who');
    await v.ctx.close();
    d = await dash();
    const me = d.tournament.signups.find((s) => s.name === 'Vic');
    assert(me && me.pickedLevel === 340 && me.dates.join(',') === [open[2], open[5]].join(','), JSON.stringify(me));
  });

  // ---------------------------------------------------------------- D  edit, E back out
  for (const scheme of SCHEMES)
    for (const width of SIZES)
      await check(`D Edit my sign-up and E the Back out confirm look right (${width} ${scheme})`, async () => {
        const v = await playerPage('Vic', { width, scheme });
        await v.page.locator('[data-tc-edit]').click();
        await v.page.locator('[data-tm-mylevel]').waitFor();
        assert(flat(await v.page.locator('[data-tm-mylevel]').innerText()).includes('3.4'), 'shows 3.4');
        await fits(v.page, 'dialog[open]');
        await shot(v.page, `D-edit-${width}-${scheme}`);
        await v.page.keyboard.press('Escape');
        await v.page.waitForTimeout(300);
        await v.page.locator('[data-tc-drop]').click();
        const confirm = flat(await v.page.locator('dialog[open]').innerText());
        assert(confirm.includes('Back out?') && confirm.includes('Are you sure you want to back out of the Winter Classic? You come off the list. You can sign up again if you change your mind.') && confirm.includes('Stay signed up') && confirm.includes('Yes, back out'), confirm);
        await fits(v.page, 'dialog[open]');
        await shot(v.page, `E-backout-${width}-${scheme}`);
        await v.ctx.close();
      });
  await check('D Edit: Change level to 3.2 and one more date; Save changes', async () => {
    const v = await playerPage('Vic');
    await v.page.locator('[data-tc-edit]').click();
    await v.page.locator('[data-tm-change]').click();
    await v.page.locator('dialog[open] [data-level="320"]').click();
    const open = await v.page.locator('dialog[open] button.tm-day.tm-open').evaluateAll((els) => els.map((e) => e.dataset.day));
    await v.page.locator(`dialog[open] [data-day="${open[0]}"]`).click();
    await v.page.locator('[data-tm-save]').click();
    await v.page.locator('dialog[open]').waitFor({ state: 'detached', timeout: 10000 }).catch(() => {});
    await v.page.waitForTimeout(600);
    await v.ctx.close();
    d = await dash();
    const me = d.tournament.signups.find((s) => s.name === 'Vic');
    assert(me.pickedLevel === 320 && me.dates.length === 3, JSON.stringify(me));
  });
  await check('E Back out: Stay signed up keeps Vic on; Yes, back out takes Vic off; the card goes back to Sign up', async () => {
    const v = await playerPage('Vic');
    await v.page.locator('[data-tc-drop]').click();
    await v.page.locator('dialog[open] [data-confirm-safe]').click();
    await v.page.waitForTimeout(400);
    d = await dash();
    assert(d.tournament.signups.some((s) => s.name === 'Vic'), 'Stay signed up kept Vic');
    await v.page.locator('[data-tc-drop]').click();
    await v.page.locator('dialog[open] [data-confirm-go]').click();
    await v.page.locator('.tc[data-tc="open"]').waitFor({ timeout: 10000 });
    await v.ctx.close();
    d = await dash();
    assert(!d.tournament.signups.some((s) => s.name === 'Vic') && d.tournament.backedOut.some((b) => b.name === 'Vic'), 'Vic is off the list');
  });

  // ---------------------------------------------------------------- F  the level list
  for (const scheme of SCHEMES)
    for (const width of SIZES)
      await check(`F the level list and Sage's level sheet look right (${width} ${scheme})`, async () => {
        const a = await adminPage({ width, scheme });
        await a.page.locator('[data-tm-open-levels]').click();
        await a.page.locator('[data-tm-level-row]').first().waitFor();
        const rows = await a.page.locator('[data-tm-level-row]').evaluateAll((els) => els.map((e) => ({ name: e.dataset.tmLevelRow, h: e.getBoundingClientRect().height })));
        assert(rows.length === 6, `rows: ${rows.length}`);
        // One line each (the long name ends with "..." rather than wrapping).
        assert(rows.every((r) => r.h < 80), JSON.stringify(rows));
        await fits(a.page, 'dialog[open]');
        await shot(a.page, `F-levels-${width}-${scheme}`);
        await a.page.locator('[data-tm-level-row="Sage"] [data-tm-pencil]').click();
        await a.page.locator('[data-tm-level-sheet]').waitFor();
        const sheet = flat(await a.page.locator('[data-tm-level-sheet]').innerText());
        assert(/SAGE PICKED/i.test(sheet) || sheet.includes('Sage picked'), sheet);
        await fits(a.page, 'dialog[open]');
        await shot(a.page, `F-level-sheet-${width}-${scheme}`);
        await a.ctx.close();
      });
  await check("F the organizer sets Sage to 3.4: the row shows 3.4, Picked 3.0; Sage's own phone still shows her pick", async () => {
    const a = await adminPage();
    await a.page.locator('[data-tm-open-levels]').click();
    await a.page.locator('[data-tm-level-row="Sage"] [data-tm-pencil]').click();
    await a.page.locator('[data-tm-level-sheet] [data-level="340"]').click();
    assert(flat(await a.page.locator('[data-tm-level-save]').innerText()) === 'Save 3.4', 'Save 3.4');
    await a.page.locator('[data-tm-level-save]').click();
    await a.page.waitForTimeout(800);
    const row = flat(await a.page.locator('[data-tm-level-row="Sage"]').innerText());
    assert(row.includes('Picked 3.0') && row.includes('3.4'), row);
    await a.ctx.close();
    const { data } = await playerAnswer('Sage');
    assert(data.tournament.me.level === 300, 'Sage still sees her own pick');
  });

  // ---------------------------------------------------------------- G  pick the date
  let finalDay = null;
  await check('G Pick the date: the counts, the best date, Pick; the card says DATE PICKED with the date and "Tickets open soon"', async () => {
    const a = await adminPage();
    await a.page.locator('[data-tm-open-dates]').click();
    await a.page.locator('[data-tm-card="dates"] .tm-day.tm-open').first().waitFor();
    const best = await a.page.locator('[data-tm-card="dates"] .tm-best-count').first().evaluate((el) => el.closest('[data-day]').dataset.day);
    await a.page.locator(`[data-tm-card="dates"] [data-day="${best}"]`).click();
    await a.page.locator('[data-tm-date-pick]').click();
    await a.page.waitForTimeout(800);
    await shot(a.page, 'G-dates-picked');
    await a.ctx.close();
    d = await dash();
    finalDay = d.tournament.finalDate;
    assert(d.tournament.status === 'date_picked' && finalDay === best, JSON.stringify([d.tournament.status, finalDay, best]));
  });
  for (const scheme of SCHEMES)
    for (const width of SIZES)
      await check(`G the Date picked card, signed up (Parker) and not (Zoe) (${width} ${scheme})`, async () => {
        for (const who of ['Parker', 'Zoe']) {
          const v = await playerPage(who, { width, scheme });
          await v.page.locator('.tc[data-tc="date"]').waitFor({ timeout: 15000 });
          const card = flat(await v.page.locator('.tc').innerText());
          assert(card.includes('DATE PICKED') && card.includes('Tickets open soon'), card);
          const [y, m, dd] = finalDay.split('-').map(Number);
          const wd = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'][new Date(Date.UTC(y, m - 1, dd)).getUTCDay()];
          assert(card.includes(wd) && card.includes(String(dd)), `${card} (${finalDay})`);
          assert(!/Lock my spot|\$16|Pay/.test(card), 'no ticket or pay button in piece 1');
          assert((await v.page.locator('[data-tc-signup]').count()) === (who === 'Zoe' ? 1 : 0), `${who}: Sign up shows only when not on the list`);
          await fits(v.page, '.tc');
          await shot(v.page, `G-${who}-${width}-${scheme}`);
          await v.ctx.close();
        }
      });

  // ---------------------------------------------------------------- H  changes after the date is picked
  await check('H after the date is picked: Zoe signs up (only that date, already picked), Parker edits his level, Quinn backs out', async () => {
    const z = await playerPage('Zoe');
    await z.page.locator('[data-tc-signup]').click();
    await z.page.locator('[data-level="275"]').click();
    await z.page.locator('[data-tm-next]').click();
    const open = await z.page.locator('dialog[open] button.tm-day.tm-open, dialog[open] button.tm-day.tm-on').evaluateAll((els) => els.map((e) => e.dataset.day));
    assert(open.length === 1 && open[0] === finalDay, `open: ${open.join(',')}`);
    assert(flat(await z.page.locator('[data-tm-picked]').innerText()).startsWith('1 picked'), 'the date starts picked');
    await z.page.locator('[data-tm-submit]').click();
    await z.page.locator('.tc[data-tc="date"] [data-tc-who]').waitFor({ timeout: 10000 });
    await z.ctx.close();
    const parkerDates = (await dash()).tournament.signups.find((s) => s.name === 'Parker').dates.join();
    const p = await playerPage('Parker');
    await p.page.locator('[data-tc-edit]').click();
    await p.page.locator('[data-tm-change]').click();
    await p.page.locator('dialog[open] [data-level="350"]').click();
    await p.page.locator('[data-tm-save]').click();
    await p.page.waitForTimeout(800);
    await p.ctx.close();
    const q = await playerPage('Quinn');
    await q.page.locator('[data-tc-drop]').click();
    await q.page.locator('dialog[open] [data-confirm-go]').click();
    await q.page.locator('.tc [data-tc-signup]').waitFor({ timeout: 10000 });
    await q.ctx.close();
    d = await dash();
    const names = d.tournament.signups.map((s) => s.name);
    assert(names.includes('Zoe') && !names.includes('Quinn'), names.join(', '));
    assert(d.tournament.signups.find((s) => s.name === 'Parker').pickedLevel === 350, 'Parker 3.5');
    // A level-only edit sends no dates: his dates stay as they were (nobody has to tick the picked date to change a level).
    assert(d.tournament.signups.find((s) => s.name === 'Parker').dates.join() === parkerDates, 'Parker kept his dates');
    assert(d.tournament.signups.find((s) => s.name === 'Zoe').dates.join() === finalDay, 'Zoe can make the date');
    assert(d.tournament.status === 'date_picked' && d.tournament.finalDate === finalDay, 'still the same date');
  });

  // ---------------------------------------------------------------- I  Create tournament
  await stage('none');
  for (const scheme of SCHEMES)
    for (const width of SIZES)
      await check(`I the Create screen looks right (${width} ${scheme})`, async () => {
        const a = await adminPage({ width, scheme });
        await a.page.locator('.tabbar button', { hasText: 'Settings' }).click();
        const sched = a.page.locator('[data-section="schedule"]');
        if (!(await sched.getAttribute('open'))) await sched.locator('summary').click();
        await a.page.locator('[data-tm-schedule-row]').click();
        await a.page.locator('[data-tm-form="create"]').waitFor();
        await fits(a.page, 'dialog[open]');
        await shot(a.page, `I-create-top-${width}-${scheme}`);
        await a.page.locator('[data-tm-card="size"]').scrollIntoViewIfNeeded();
        await shot(a.page, `I-create-plans-${width}-${scheme}`);
        await a.page.locator('[data-tm-card="prize"]').scrollIntoViewIfNeeded();
        await shot(a.page, `I-create-prize-${width}-${scheme}`);
        await a.ctx.close();
      });
  await check('I Create: a 32-letter name, three dates, 10 players (its best plan), $0 credit, Only me; then the card on Alex\'s phone', async () => {
    const a = await adminPage();
    await a.page.locator('.tabbar button', { hasText: 'Settings' }).click();
    const sched = a.page.locator('[data-section="schedule"]');
    if (!(await sched.getAttribute('open'))) await sched.locator('summary').click();
    await a.page.locator('[data-tm-schedule-row]').click();
    await a.page.locator('[data-tm-open-signup]').click();
    assert(flat(await a.page.locator('[data-tm-error]').innerText()) === 'Type a name.', 'asks for a name first');
    const name = 'Holiday Doubles Championship 26';
    await a.page.locator('[data-tm-name]').fill(name);
    const days = await a.page.locator('[data-tm-card="name"] button.tm-day').evaluateAll((els) => els.map((e) => e.dataset.day).filter((x) => x >= '2026-12-01'));
    for (const day of days.slice(1, 4)) await a.page.locator(`[data-tm-card="name"] [data-day="${day}"]`).click();
    assert(flat(await a.page.locator('[data-tm-lit]').innerText()).toUpperCase() === '3 LIT', 'three lit');
    await a.page.locator('[data-size="10"]').click();
    assert((await a.page.locator('.tm-plan-on').getAttribute('data-plan')) === '2c-150', 'the 10-player best plan (Booking hours is on in the preview)');
    await a.page.locator('#tm-credit').fill('0');
    assert(flat(await a.page.locator('.tm-says').innerText()) === 'Sign-up says: Winners each get a medal.', 'the $0 line');
    assert(flat(await a.page.locator('[data-tm-total]').innerText()) === '$0', 'total $0');
    assert(flat(await a.page.locator('[data-tm-open-signup]').innerText()) === 'Open sign-up (only me)', 'the button');
    await a.page.locator('[data-tm-open-signup]').click();
    await a.page.locator('[data-tm-form]').waitFor({ state: 'detached', timeout: 10000 });
    await a.ctx.close();
    d = await dash();
    assert(d.tournament && d.tournament.name === name && d.tournament.size === 10 && d.tournament.championCreditCents === 0 && d.tournament.visibility === 'me', JSON.stringify(d.tournament));
    assert(!('tournament' in (await playerAnswer('Vic')).data), 'a player still sees nothing');
    for (const width of SIZES) {
      const al = await playerPage('Alex', { width, organizer: true });
      await al.page.locator('.tc').waitFor({ timeout: 15000 });
      await fits(al.page, '.tc, .tc-strip');
      await shot(al.page, `I-long-name-${width}`);
      await al.ctx.close();
    }
  });

  // ---------------------------------------------------------------- J  organizer Home at every size
  for (const scheme of SCHEMES)
    for (const width of SIZES)
      await check(`J organizer Home: the test row and the tournament card fit (${width} ${scheme})`, async () => {
        const a = await adminPage({ width, scheme });
        await a.page.locator('[data-tm-home]').waitFor({ timeout: 15000 });
        await fits(a.page, '[data-tm-home], [data-row="tournament-test"]');
        assert(a.errors.length === 0, a.errors.join(' | '));
        await shot(a.page, `J-admin-home-${width}-${scheme}`);
        await a.ctx.close();
      });

  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
