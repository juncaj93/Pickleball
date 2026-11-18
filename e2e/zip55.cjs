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
 *   F  The level list: Sage's pick, the organizer sets 3.4. G  Pick the date: tickets open at once (Alex, Zip 56).
 *   H  Changes after the date is picked: a new sign-up (only that date), an edit, a back out.
 *   I  Create tournament (No tournament first): a 32-letter name, 10 players, $0 credit, Only me.
 *   J  Every screen at 390, 360 and 320 wide, light and dark: nothing wider than the screen, no clipped button, the level rows on one line.
 *   L  The date is picked while a player's Edit sheet is open: look again, the stale date drops out.
 *   M  Pass 2: the admin card's stage buttons, every month pair fits the stub, room above Dates that work.
 *   N  Americano (pass 3): the label, the four steps, the admin card, Edit's Format and two prize rows.
 *   K  Every offered date has passed (clock moved to Jan 20): players get no card at all; the admin card says "Dates have passed. Add dates."
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
// ZIP55_ONLY=<words>: run only the checks whose name has those words (to retry one check without the whole run).
const ONLY = process.env.ZIP55_ONLY || '';
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
  let clockMs = NOW_MS; // the browser's clock follows the server's dev clock (K moves both)
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
    }, clockMs - Date.now());

  // The organizer, through the API (the same calls the screens make).
  const admin = await browser.newContext();
  assert((await admin.request.post(BASE + '/api/admin/login', { data: { pin: PIN }, headers: { Origin: BASE } })).ok(), 'admin login');
  let adminCookies = await admin.cookies();
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
        // Under the name: the format and its one rule (no small label above the name any more).
        // Zip 56 (Alex): the format in ONE line, no separate rule line.
        assert(flat(await a.page.locator('[data-tc-format-name]').innerText()) === 'Locked doubles (same partner all night)' && (await a.page.locator('[data-tc-rule]').count()) === 0, card);
        const order = await a.page.evaluate(() => ['.tc-title', '[data-tc-format-name]', '[data-tc-sub]'].map((q) => document.querySelector(q).getBoundingClientRect().top));
        assert(order.every((y, i) => i === 0 || y > order[i - 1]), `title, format, rule, then the line: ${order}`);
        assert((await a.page.locator('.tc-kicker').count()) === 0, 'the old label above the name');
        assert(/Pick the dates you can play/.test(card) && /Sign up/.test(card) && /VOTE/.test(card) && /FINAL/.test(card), card);
        // Feedback pass 1: the stub says TBD (not ?), and the card has no border line running over the notch (its edge is drawn inside).
        assert(flat(await a.page.locator('.tc-day').innerText()) === 'TBD', 'the stub says TBD');
        assert((await a.page.locator('.tc').evaluate((el) => getComputedStyle(el).borderTopWidth)) === '0px', 'a border line over the notch');
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
        assert(labels.join(',') === '2.5,2.7,3.0,3.2,3.4,3.5,3.6+', labels.join(','));
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
    assert(card.includes('Locked doubles') && card.includes('You’re on the list. We’re picking the date.') && card.includes('Edit sign-up') && card.includes('Drop out'), card);
    await v.page.locator('[data-tc-who]').click();
    const names = await v.page.locator('[data-tm-who-row] .tm-who-name').allInnerTexts();
    assert(names.length === 7 && names.includes('Vic') && names.includes('Christopher Vanderberg'), names.join(', '));
    const sheet = await v.page.locator('dialog[open]').innerText();
    assert(!/\$|3\.\d|2\.\d/.test(sheet), `the list shows money or levels: ${flat(sheet)}`);
    // Feedback pass 1: "SIGNED UP" on one line with the count beside it; the sheet opens without focusing the X (no ring after a tap).
    const head = await v.page.locator('dialog[open] .tm-who-head').evaluate((el) => {
      const [label, chip] = [el.querySelector('.tm-head-label').getBoundingClientRect(), el.querySelector('.tm-chip').getBoundingClientRect()];
      return { labelH: label.height, chipLeft: chip.left, labelRight: label.right, sameRow: Math.abs(label.top + label.height / 2 - (chip.top + chip.height / 2)) < 4 };
    });
    assert(head.sameRow && head.chipLeft > head.labelRight && head.labelH < 24, JSON.stringify(head));
    const focused = await v.page.evaluate(() => (document.activeElement ? `${document.activeElement.tagName}.${document.activeElement.className}` : ''));
    assert(!/BUTTON/.test(focused), `focused on open: ${focused}`);
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
        await v.page.locator('dialog[open] [data-tm-save]').waitFor();
        // Zip 56 (Alex): Edit my sign-up is the dates only; the level was picked once.
        assert((await v.page.locator('dialog[open] [data-tm-mylevel], dialog[open] [data-tm-change]').count()) === 0, 'no level row');
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
  await check('D Edit: one more date (the level stays: Alex, a level is picked once); Save changes', async () => {
    const v = await playerPage('Vic');
    await v.page.locator('[data-tc-edit]').click();
    const open = await v.page.locator('dialog[open] button.tm-day.tm-open').evaluateAll((els) => els.map((e) => e.dataset.day));
    await v.page.locator(`dialog[open] [data-day="${open[0]}"]`).click();
    await v.page.locator('[data-tm-save]').click();
    await v.page.locator('dialog[open]').waitFor({ state: 'detached', timeout: 10000 }).catch(() => {});
    await v.page.waitForTimeout(600);
    await v.ctx.close();
    d = await dash();
    const me = d.tournament.signups.find((s) => s.name === 'Vic');
    assert(me.pickedLevel === 340 && me.dates.length === 3, JSON.stringify(me));
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
        // Levels live inside Edit (pass 2: no Levels button on the card).
        await a.page.locator('[data-tm-open-edit]').click();
        await a.page.locator('[data-tm-level-row]').first().waitFor();
        await a.page.locator('[data-tm-card="levels"]').scrollIntoViewIfNeeded();
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
    await a.page.locator('[data-tm-open-edit]').click();
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
  await check('G Pick the date: the counts, the best date, Pick; tickets open at once (Zip 56, Alex)', async () => {
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
    assert(d.tournament.status === 'tickets' && finalDay === best && !!d.tournament.payBy, JSON.stringify([d.tournament.status, finalDay, best]));
  });
  await check('G after the date is picked the admin card is picture 29 (Zip 56): Tickets; the name opens the whole tournament page at the top and stays where you scroll', async () => {
    const a = await adminPage();
    // Zip 56 (picture 29, Alex): tickets are open: the button is Tickets (no Open tickets, no Edit); the tournament's name opens its page.
    assert((await a.page.locator('[data-tm-tickets]').count()) === 1 && (await a.page.locator('[data-tm-open-tickets], [data-tm-open-edit]').count()) === 0, 'Tickets, no Open tickets, no Edit');
    await a.page.locator('[data-tm-open-page]').click();
    await a.page.locator('[data-tm-page]').waitFor();
    await a.page.waitForTimeout(600);
    const top = await a.page.evaluate(() => document.querySelector('dialog[open] .sheet-body')?.scrollTop ?? document.querySelector('dialog[open]').scrollTop);
    assert(top === 0, `opened scrolled to ${top}`);
    // Scroll down and it stays put.
    await a.page.evaluate(() => {
      const b = document.querySelector('dialog[open] .sheet-body');
      const el = b && b.scrollHeight > b.clientHeight ? b : document.querySelector('dialog[open]');
      el.scrollTop = 400;
    });
    await a.page.waitForTimeout(1500);
    const after = await a.page.evaluate(() => {
      const b = document.querySelector('dialog[open] .sheet-body');
      return Math.max(b ? b.scrollTop : 0, document.querySelector('dialog[open]').scrollTop);
    });
    assert(after >= 300, `snapped back to ${after}`);
    assert((await a.page.locator('dialog[open] [data-tm-edit-settings]').count()) === 1, 'Edit settings is there');
    await a.ctx.close();
  });
  for (const scheme of SCHEMES)
    for (const width of SIZES)
      await check(`G the card once the date is picked: Parker (on the list) sees Lock my spot, Zoe (not on it) sees Sign up (${width} ${scheme})`, async () => {
        for (const who of ['Parker', 'Zoe']) {
          const v = await playerPage(who, { width, scheme });
          // Zip 56 (Alex): picking the date opened tickets.
          await v.page.locator(who === 'Parker' ? '.tc[data-tc="lock"]' : '.tc[data-tc="date"]').waitFor({ timeout: 15000 });
          const card = flat(await v.page.locator('.tc').innerText());
          assert(who === 'Parker' ? card.includes('Lock my spot · $16') : card.includes('Tickets are open. Sign up first.') && card.includes('Locked doubles (same partner all night)'), card);
          const [y, m, dd] = finalDay.split('-').map(Number);
          const wd = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'][new Date(Date.UTC(y, m - 1, dd)).getUTCDay()];
          assert(card.includes(wd) && card.includes(String(dd)), `${card} (${finalDay})`);
          assert((await v.page.locator('[data-tc-signup]').count()) === (who === 'Zoe' ? 1 : 0), `${who}: Sign up shows only when not on the list`);
          await fits(v.page, '.tc');
          await shot(v.page, `G-${who}-${width}-${scheme}`);
          await v.ctx.close();
        }
      });

  // ---------------------------------------------------------------- H  changes after the date is picked
  await check('H after the date is picked: Zoe signs up (only that date, already picked), Parker opens Edit (dates only), Quinn backs out', async () => {
    const z = await playerPage('Zoe');
    await z.page.locator('[data-tc-signup]').click();
    await z.page.locator('[data-level="275"]').click();
    await z.page.locator('[data-tm-next]').click();
    const open = await z.page.locator('dialog[open] button.tm-day.tm-open, dialog[open] button.tm-day.tm-on').evaluateAll((els) => els.map((e) => e.dataset.day));
    assert(open.length === 1 && open[0] === finalDay, `open: ${open.join(',')}`);
    assert(flat(await z.page.locator('[data-tm-picked]').innerText()).startsWith('1 picked'), 'the date starts picked');
    await z.page.locator('[data-tm-submit]').click();
    await z.page.locator('.tc[data-tc="lock"] [data-tc-who]').waitFor({ timeout: 10000 });
    await z.ctx.close();
    const parkerDates = (await dash()).tournament.signups.find((s) => s.name === 'Parker').dates.join();
    const p = await playerPage('Parker');
    await p.page.locator('[data-tc-edit]').click();
    await p.page.locator('dialog[open] [data-tm-save]').waitFor();
    assert((await p.page.locator('dialog[open] [data-tm-change]').count()) === 0, 'no level row (Alex)');
    await p.ctx.close();
    const q = await playerPage('Quinn');
    await q.page.locator('[data-tc-drop]').click();
    await q.page.locator('dialog[open] [data-confirm-go]').click();
    await q.page.locator('.tc [data-tc-signup]').waitFor({ timeout: 10000 });
    await q.ctx.close();
    d = await dash();
    const names = d.tournament.signups.map((s) => s.name);
    assert(names.includes('Zoe') && !names.includes('Quinn'), names.join(', '));
    assert(d.tournament.signups.find((s) => s.name === 'Parker').dates.join() === parkerDates, 'Parker kept his dates');
    assert(d.tournament.signups.find((s) => s.name === 'Zoe').dates.join() === finalDay, 'Zoe can make the date');
    assert(d.tournament.status === 'tickets' && d.tournament.finalDate === finalDay, 'still the same date');
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
        // Zip 56 (Alex): no players expected and no court plan on Create.
        assert((await a.page.locator('dialog[open] [data-tm-card="size"], dialog[open] .tm-plans').count()) === 0, 'no size or plan rows');
        await a.page.locator('[data-tm-card="prize"]').scrollIntoViewIfNeeded();
        await shot(a.page, `I-create-prize-${width}-${scheme}`);
        await a.ctx.close();
      });
  await check('I Create: a 32-letter name, three dates, $0 credit, Only me; then the card on Alex\'s phone', async () => {
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
    // Pass 3: the format starts on Locked doubles, two big choices, each with its one rule.
    assert((await a.page.locator('[data-format="doubles"]').getAttribute('aria-pressed')) === 'true', 'Doubles by default');
    assert(flat(await a.page.locator('[data-tm-card="format"]').innerText()).toUpperCase() === 'FORMAT LOCKED DOUBLES SAME PARTNER ALL NIGHT AMERICANO NEW PARTNER EVERY ROUND', await a.page.locator('[data-tm-card="format"]').innerText());
    const big = await a.page.locator('[data-format]').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
    assert(big.every((h) => h >= 56 && h < 90), `heights ${big}`);
    const lines = await a.page.locator('.tm-format-name').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
    assert(lines.every((h) => h < 30), `a name wraps: ${lines}`);
    await a.page.locator('#tm-credit').fill('0');
    assert((await a.page.locator('.tm-says, [data-tm-card="players-see"]').count()) === 0, 'no "What players see" card (Alex took the prize line off the sign-up)');
    assert(flat(await a.page.locator('[data-tm-total]').innerText()) === '$0', 'total $0');
    assert(flat(await a.page.locator('[data-tm-open-signup]').innerText()) === 'Open sign-up (only me)', 'the button');
    await a.page.locator('[data-tm-open-signup]').click();
    await a.page.locator('[data-tm-form]').waitFor({ state: 'detached', timeout: 10000 });
    await a.ctx.close();
    d = await dash();
    assert(d.tournament && d.tournament.name === name && d.tournament.size === 6 && d.tournament.championCreditCents === 0 && d.tournament.visibility === 'me', JSON.stringify(d.tournament));
    assert(!('tournament' in (await playerAnswer('Vic')).data), 'a player still sees nothing');
    for (const width of SIZES) {
      const al = await playerPage('Alex', { width, organizer: true });
      await al.page.locator('.tc').waitFor({ timeout: 15000 });
      await fits(al.page, '.tc, .tc-strip');
      await shot(al.page, `I-long-name-${width}`);
      await al.ctx.close();
    }
  });

  await check('I with a tournament open, Settings > Schedule still shows Create tournament; a tap says "Finish or cancel the current one first." and opens nothing', async () => {
    const a = await adminPage();
    await a.page.locator('.tabbar button', { hasText: 'Settings' }).click();
    const sched = a.page.locator('[data-section="schedule"]');
    if (!(await sched.getAttribute('open'))) await sched.locator('summary').click();
    const row = a.page.locator('[data-tm-schedule-row]');
    assert(flat(await row.innerText()).startsWith('Create tournament'), await row.innerText());
    assert((await a.page.locator('[data-tm-open-row]').count()) === 1, 'the open tournament has its own row');
    await row.click();
    await a.page.getByText('Finish or cancel the current one first.').first().waitFor({ timeout: 5000 });
    assert((await a.page.locator('[data-tm-form="create"]').count()) === 0, 'Create opened anyway');
    await a.ctx.close();
  });

  // ---------------------------------------------------------------- M  pass 2 (Alex): card buttons, the month pair, Edit sheet spacing
  await stage('signup');
  for (const scheme of SCHEMES)
    for (const width of SIZES)
      await check(`M no date yet: the admin card has one row, Pick date and Edit (no Levels) (${width} ${scheme})`, async () => {
        const a = await adminPage({ width, scheme });
        await a.page.locator('[data-tm-home]').waitFor({ timeout: 15000 });
        const b = await a.page.locator('.tm-home-actions .btn').evaluateAll((els) => els.map((e) => ({ t: e.innerText.trim(), top: Math.round(e.getBoundingClientRect().top), h: e.getBoundingClientRect().height })));
        assert(b.map((x) => x.t).join('|') === 'Pick date|Edit', JSON.stringify(b));
        assert(flat(await a.page.locator('.tm-home-format').innerText()) === 'Locked doubles (same partner all night)' && (await a.page.locator('.tm-home-rule').count()) === 0, 'admin format in one line (Alex)');
        assert(b[0].top === b[1].top && b.every((x) => x.h < 60), `one row, one line each: ${JSON.stringify(b)}`);
        await fits(a.page, '[data-tm-home]');
        await shot(a.page, `M-admin-card-${width}-${scheme}`);
        await a.ctx.close();
      });
  await check('M every month pair on the stub ("DEC–JAN", "MAY–JUN", ...) fits the date column with room on both sides, at 320', async () => {
    const v = await playerPage('Vic', { width: 320 });
    await v.page.locator('.tc .tc-mon').waitFor({ timeout: 15000 });
    const label = flat(await v.page.locator('.tc .tc-mon').innerText());
    assert(/^[A-Z]{3}–[A-Z]{3}$/.test(label) && (await v.page.locator('.tc .tc-mon-span').count()) === 1, label);
    const worst = await v.page.evaluate(() => {
      const M = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
      const el = document.querySelector('.tc .tc-mon');
      const col = document.querySelector('.tc .tc-stub').getBoundingClientRect();
      let w = { room: 99, text: '' };
      for (let i = 0; i < 12; i++) {
        el.textContent = `${M[i]}–${M[(i + 1) % 12]}`;
        const r = el.getBoundingClientRect();
        const room = Math.min(r.left - col.left, col.right - r.right);
        if (room < w.room) w = { room, text: el.textContent, width: r.width, col: col.width };
      }
      return w;
    });
    assert(worst.room >= 6, `tightest: ${JSON.stringify(worst)}`);
    await shot(v.page, 'M-stub-320');
    await v.ctx.close();
  });
  for (const scheme of SCHEMES)
    for (const width of SIZES)
      await check(`M Edit my sign-up: dates only, "Dates that work" first, no level row (${width} ${scheme})`, async () => {
        const p = await playerPage('Parker', { width, scheme });
        await p.page.locator('[data-tc-edit]').click();
        await p.page.locator('dialog[open] .tm-eyebrow-dates').waitFor();
        assert((await p.page.locator('dialog[open] [data-tm-mylevel]').count()) === 0, 'no level row (Alex)');
        await fits(p.page, 'dialog[open]');
        await shot(p.page, `M-edit-${width}-${scheme}`);
        await p.ctx.close();
      });

  // ---------------------------------------------------------------- N  Americano (pass 3): the format at each stage
  for (const st of ['signup', 'date_picked']) {
    await call('POST', '/api/admin/tournament-test', { stage: st, format: 'americano' });
    for (const scheme of SCHEMES)
      for (const width of SIZES)
        await check(`N Americano, ${st === 'signup' ? 'sign-up open' : 'date picked'}: Americano and "New partner every round" under the name, steps Vote, Tickets, Games, Winners; the admin card too (${width} ${scheme})`, async () => {
          const v = await playerPage('Parker', { width, scheme });
          await v.page.locator('.tc[data-tc-format="americano"]').waitFor({ timeout: 15000 });
          // Zip 56 (Alex): picking the date opens tickets; the format shows on the cards before that, in one line.
          if (st === 'signup') assert(flat(await v.page.locator('[data-tc-format-name]').innerText()) === 'Americano (new partner every round)' && (await v.page.locator('[data-tc-rule]').count()) === 0, 'format in one line');
          const steps = (await v.page.locator('.tc-step-label').allInnerTexts()).map(flat);
          assert(steps.join('|') === 'VOTE|TICKETS|GAMES|WINNERS', steps.join('|'));
          // The line through the dots runs from the first dot to the last.
          const line = await v.page.evaluate(() => {
            const dots = [...document.querySelectorAll('.tc-step-dot')].map((d) => d.getBoundingClientRect());
            const track = document.querySelector('.tc-track');
            const b = getComputedStyle(track, '::before');
            const r = track.getBoundingClientRect();
            return { first: dots[0].left + dots[0].width / 2 - r.left, last: dots[dots.length - 1].left + dots[dots.length - 1].width / 2 - r.left, left: parseFloat(b.left), right: r.width - parseFloat(b.right) };
          });
          assert(Math.abs(line.first - line.left) < 3 && Math.abs(line.last - line.right) < 3, JSON.stringify(line));
          await fits(v.page, '.tc');
          await shot(v.page, `N-americano-${st}-${width}-${scheme}`);
          await v.ctx.close();
          const a = await adminPage({ width, scheme });
          await a.page.locator('[data-tm-home]').waitFor({ timeout: 15000 });
          if (st === 'signup') {
            assert(flat(await a.page.locator('.tm-home-format').innerText()) === 'Americano (new partner every round)' && (await a.page.locator('.tm-home-rule').count()) === 0, 'admin format in one line');
          } else {
            // Zip 56: once the date is picked the organizer's card is picture 29's (no format line, as drawn; a question for Alex).
            assert((await a.page.locator('[data-tm-home="tickets"] [data-tm-tickets]').count()) === 1, 'picture 29\'s card, tickets open');
          }
          await fits(a.page, '[data-tm-home]');
          await a.ctx.close();
        });
  }
  await check('N Edit an Americano: Format shows Americano (can change), two prize rows 1st and 2nd; switch to Locked doubles and back in the form', async () => {
    // Zip 56 (Alex): picking the date opens tickets and locks the format, so this Edit is during sign-up.
    await call('POST', '/api/admin/tournament-test', { stage: 'signup', format: 'americano' });
    const a = await adminPage();
    // Edit opens the tournament page; its Settings card's Edit opens the form (a pause first: the site drops a tap right after the last one).
    await a.page.locator('[data-tm-open-edit]').click();
    await a.page.locator('dialog[open] [data-tm-edit-settings]').waitFor({ timeout: 15000 });
    await a.page.waitForTimeout(600);
    await a.page.locator('dialog[open] [data-tm-edit-settings]').click();
    await a.page.locator('[data-tm-form="edit"]').waitFor();
    assert((await a.page.locator('[data-format="americano"]').getAttribute('aria-pressed')) === 'true', 'Americano picked');
    assert(!(await a.page.locator('[data-format="doubles"]').isDisabled()), 'not locked before tickets open');
    assert((await a.page.locator('#tm-credit2').inputValue()) === '7', 'the 2nd place credit');
    const prize = flat(await a.page.locator('[data-tm-card="prize"]').innerText());
    assert(prize.includes('1st place credit') && prize.includes('2nd place credit') && !prize.includes('Winners'), prize);
    await a.page.locator('[data-format="doubles"]').click();
    assert((await a.page.locator('#tm-credit2').count()) === 0 && flat(await a.page.locator('[data-tm-card="prize"]').innerText()).includes('Game credit for each winner'), 'Doubles rows');
    await a.page.locator('[data-format="americano"]').click();
    await shot(a.page, 'N-edit-americano');
    await a.ctx.close();
  });
  await check('N the date is picked (tickets open): the page says Americano and Edit shows the format locked', async () => {
    await call('POST', '/api/admin/tournament-test', { stage: 'date_picked', format: 'americano' });
    const a = await adminPage();
    await a.page.locator('[data-tm-open-page]').click();
    assert(flat(await a.page.locator('[data-tm-format-row]').innerText()) === 'Americano', 'the Settings row');
    await a.page.locator('[data-tm-edit-settings]').click();
    await a.page.locator('[data-tm-form="edit"]').waitFor();
    assert((await a.page.locator('[data-format="americano"]').getAttribute('aria-pressed')) === 'true', 'Americano picked');
    assert(await a.page.locator('[data-format="doubles"]').isDisabled(), 'locked once tickets are open');
    await a.ctx.close();
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

  // ---------------------------------------------------------------- L  the date is picked while a player's Edit sheet is open
  await stage('signup');
  await check('L Parker ticks a date in Edit, the organizer picks another date meanwhile: Save says look again, the stale date drops out, then he saves the picked date', async () => {
    const before = (await dash()).tournament;
    const mine = before.signups.find((x) => x.name === 'Parker').dates;
    const other = before.offeredDates.find((x) => !mine.includes(x));
    const final = mine[0];
    const p = await playerPage('Parker');
    await p.page.locator('[data-tc-edit]').click();
    await p.page.locator(`dialog[open] [data-day="${other}"]`).click();
    assert((await p.page.locator(`dialog[open] [data-day="${other}"]`).getAttribute('aria-pressed')) === 'true', 'ticked');
    await call('PUT', `/api/admin/tournament/${before.id}/date`, { date: final });
    await p.page.locator('dialog[open] [data-tm-save]').click();
    await p.page.waitForTimeout(1200);
    assert((await p.page.locator('dialog[open] [data-tm-save]').count()) === 1, 'the sheet stays open after look again');
    assert((await p.page.locator(`dialog[open] [data-day="${other}"].tm-on`).count()) === 0, 'the stale date is still on');
    const tap = p.page.locator(`dialog[open] [data-day="${final}"]`);
    if ((await tap.getAttribute('aria-pressed')) !== 'true') await tap.click();
    await p.page.locator('dialog[open] [data-tm-save]').click();
    await p.page.locator('dialog[open] [data-tm-save]').waitFor({ state: 'detached', timeout: 10000 });
    assert(p.errors.length === 0, p.errors.join(' | '));
    await p.ctx.close();
    const after = (await dash()).tournament.signups.find((x) => x.name === 'Parker').dates;
    assert(after.join() === final, after.join());
  });

  // ---------------------------------------------------------------- K  every offered date has passed (none picked)
  await stage('signup');
  clockMs = Date.parse('2027-01-20T15:00:00.000Z'); // Wed Jan 20, 10:00 AM Eastern: the last test date (Jan 14) has passed
  await fetch(`${BASE}/__dev/clock`, { method: 'POST', body: JSON.stringify({ atMs: clockMs }) });
  assert((await admin.request.post(BASE + '/api/admin/login', { data: { pin: PIN }, headers: { Origin: BASE } })).ok(), 'admin login again');
  adminCookies = await admin.cookies();
  await check('K every date has passed: players get no tournament at all (the same as none); the date pick refuses', async () => {
    for (const n of ['Vic', 'Parker']) {
      const { text, data } = await playerAnswer(n);
      assert(!('tournament' in data) && !text.includes('Winter Classic'), `${n} still gets the tournament`);
    }
    const t = (await dash()).tournament;
    const r = await admin.request.fetch(BASE + `/api/admin/tournament/${t.id}/date`, { method: 'PUT', data: { date: t.offeredDates[0] }, headers: { Origin: BASE } });
    assert(r.status() === 400, `date pick: ${r.status()}`);
  });
  for (const scheme of SCHEMES)
    for (const width of SIZES)
      await check(`K every date has passed: no card for Vic or Parker; the admin card says "Dates have passed. Add dates." (${width} ${scheme})`, async () => {
        for (const n of ['Vic', 'Parker']) {
          const v = await playerPage(n, { width, scheme });
          assert((await v.page.locator('.tc, .tc-shell').count()) === 0, `${n} sees a card`);
          await v.ctx.close();
        }
        const a = await adminPage({ width, scheme });
        await a.page.locator('[data-tm-home]').waitFor({ timeout: 15000 });
        assert(flat(await a.page.locator('[data-tm-home-note]').innerText()) === 'Dates have passed. Add dates.', 'the admin note');
        await fits(a.page, '[data-tm-home]');
        await shot(a.page, `K-admin-home-passed-${width}-${scheme}`);
        await a.ctx.close();
      });
  await check('K the organizer\'s Pick the date card says every date has passed and points to Edit', async () => {
    const a = await adminPage();
    await a.page.locator('[data-tm-open-dates]').click();
    const note = flat(await a.page.locator('[data-tm-dates-note]').innerText());
    assert(note === 'Every date you offered has passed. Tap Edit below to offer new ones.', note);
    assert((await a.page.locator('[data-tm-card="dates"] .tm-day.tm-open').count()) === 0, 'an offered date still looks open');
    assert((await a.page.locator('[data-tm-card="dates"] button.tm-day.tm-past').count()) === 0, 'a past date can be tapped');
    assert((await a.page.locator('[data-tm-card="dates"] .tm-day.tm-past').count()) > 0, 'the past dates are shown');
    await fits(a.page, 'dialog[open]');
    await shot(a.page, 'K-admin-dates-passed');
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
