/* Zip 56 (🎾56.tourney2): Tournaments, piece 2 (tickets), in a real browser, with Alex's changes after testing piece 1.
 *
 *   node e2e/zip56.cjs      (also run by npm run test:e2e)
 *
 * The world is the preview's calm Zip 56 profile (scripts/preview-world-small.ts step 29: the Winter Classic with the date picked for
 * Everyone, which now means tickets are open, 8 on the list, Thu Dec 17) as of Tue Nov 17 2026, 9:00 AM Eastern, the clock 10:00 AM. The dev
 * server runs with PREVIEW_CALM=on and PB_PREVIEW_BUILD=1, as the preview does.
 *   A  The seed: tickets open, nobody paid; organizer Home has picture 29's card (Tickets, no Open tickets) with the smart plan's line.
 *   B  Picking the date opens tickets (Alex: no Open tickets button): Pay by Tue Dec 15, 7:00 PM; "Tickets: 0 of 6 locked in".
 *   C  Parker: Lock my spot, the site's Pay sheet (Pay Alex $16, Venmo, I paid), then "You're locked in" (Zip 63: no waiting words for players).
 *   D  Alex answers on Home (Paid): Parker is locked in.
 *   E  Parker backs out after paying: the Are you sure words say the $16 comes back as credit, and it does.
 *   F  The waitlist screens (12 locked in, picture 12): the 10 preview names cannot fill 12 spots, so the player's answer is stood in for.
 *   G  Cancel or reschedule (picture 30) on Home: Reschedule ("Rescheduled. Pick your dates again"), then Cancel (the plain Canceled card).
 *   H  7 locked in after Pay by: the plain warning on the organizer's card, nobody taken off.
 *   I  Every ticket screen at 390, 360 and 320 wide, light and dark: nothing wider than the screen, nothing sticking out, every list row on one
 *      line (Christopher Vanderberg too).
 *   J  Nobody else gets it: switched off, players get no tournament at all; a canceled one shows only to the players on its list.
 *   K  Alex's changes: the smart plan and the cost lines (and the Booking hours note), the one-line format subtitle (both formats), Create with
 *      no players expected or court plan and space between the $ boxes, a level picked once (Edit is dates only; signing up again skips the
 *      level), and the soft fades only while there is more to scroll.
 * Screenshots: .data/zip56-shots (not in git).
 */
const { spawn, spawnSync } = require('node:child_process');
const { readFileSync, mkdirSync, rmSync } = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.E2E_PORT) || 5457;
const BASE = `http://localhost:${PORT}`;
const SEED_ISO = '2026-11-17T14:00:00.000Z'; // Tue Nov 17, 9:00 AM Eastern
const NOW_MS = Date.parse('2026-11-17T15:00:00.000Z'); // Tue Nov 17, 10:00 AM Eastern
const PIN = /PIN `(\d{6})`/.exec(readFileSync(path.join(ROOT, 'docs/PREVIEW_FAKE_DB.md'), 'utf8'))[1];
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const SHOTS = path.join(ROOT, '.data', 'zip56-shots');

let passed = 0;
let failed = 0;
// ZIP56_ONLY=<words>: run only the checks whose name has those words (to retry one check without the whole run).
const ONLY = process.env.ZIP56_ONLY || '';
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
  const dbFile = path.join(ROOT, '.data', 'zip56.sqlite');
  mkdirSync(SHOTS, { recursive: true });
  rmSync(dbFile, { force: true });
  const seeded = spawnSync('npx', ['vite-node', 'scripts/load-small-local.ts', '--', dbFile, SEED_ISO, '--calm', '--zip55', '--zip56'], { cwd: ROOT, encoding: 'utf8' });
  if (seeded.status !== 0) throw new Error(`could not build the calm world: ${seeded.stderr || seeded.stdout}`);
  if (await fetch(`${BASE}/api/status`).then((r) => r.ok, () => false)) throw new Error(`port ${PORT} is already in use`);
  const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
    cwd: ROOT,
    env: { ...process.env, DEV_DB: dbFile, SETUP_TOKEN: 'zip56-setup-token-0123456789', DEV_CLOCK: '1', PREVIEW_CALM: 'on', PB_PREVIEW_BUILD: '1' },
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
  /** A player's own phone through the API: its name picked, no organizer cookie. */
  async function phone(name) {
    const ctx = await browser.newContext();
    const list = (await (await ctx.request.get(BASE + '/api/group')).json()).players;
    const p = list.find((x) => x.name === name);
    await ctx.request.post(BASE + '/api/me', { data: { playerId: p.id }, headers: { Origin: BASE } });
    return {
      async answer() {
        const text = await (await ctx.request.get(BASE + '/api/group')).text();
        return { text, data: JSON.parse(text) };
      },
      async post(url, data) {
        const r = await ctx.request.post(BASE + url, { data, headers: { Origin: BASE } });
        return { status: r.status(), data: await r.json() };
      },
      close: () => ctx.close(),
    };
  }
  async function answerOf(name) {
    const p = await phone(name);
    const a = await p.answer();
    await p.close();
    return a;
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
    await p.page.waitForTimeout(700);
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
  /** Every row of the lists in `sel` is one line: no piece of text in it runs onto a second line (a long name ends in "..." instead). */
  async function oneLineRows(page, sel) {
    const bad = await page.evaluate((s) => {
      const out = [];
      for (const li of document.querySelectorAll(s)) {
        const walker = document.createTreeWalker(li, NodeFilter.SHOW_TEXT);
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
          if (!n.textContent.trim()) continue;
          const range = document.createRange();
          range.selectNodeContents(n);
          const tops = new Set([...range.getClientRects()].filter((r) => r.width > 0).map((r) => Math.round(r.top)));
          if (tops.size > 1) out.push(`${li.textContent.replace(/\s+/g, ' ').trim()} ("${n.textContent.trim()}" on ${tops.size} lines)`);
        }
      }
      return out;
    }, sel);
    assert(bad.length === 0, `wraps: ${bad.slice(0, 4).join(' | ')}`);
  }
  const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
  const sheetOpen = (page) => page.locator('dialog[open]').last();

  let d = await dash();

  // Zip 63: the card's one look has no See who's in, Edit sign-up or Drop out while tickets are open: a tap on the card opens the overlay, which has them.
  async function openOverlay(page) {
    await page.locator('.tc-hero .tc-title').first().click();
    await page.locator('dialog[open] [data-tw]').waitFor({ timeout: 10000 });
  }
  async function tapLink(page, attr) {
    const own = page.locator(`.tc-hero [${attr}]`);
    if (await own.count()) return own.first().click();
    await openOverlay(page);
    // The site drops a tap that comes right after the last one (its double-tap guard): a pause, as a person makes.
    await page.waitForTimeout(700);
    await page.locator(`dialog[open] [${attr}]`).first().click();
  }
  // ---------------------------------------------------------------- A  the seed
  await check('A seed: the Winter Classic, the date picked: tickets are open (Alex), nobody paid; Home has picture 29\'s card with Tickets and the plan', async () => {
    const t = d.tournament;
    assert(t && t.status === 'tickets' && t.visibility === 'all' && t.signups.length === 8 && t.finalDate === '2026-12-17', JSON.stringify(t && { s: t.status, v: t.visibility, n: t.signups.length, f: t.finalDate }));
    assert(t.payBy === '2026-12-17T00:00:00.000Z', `Pay by Wed Dec 16, 7:00 PM (Zip 59: the night before): ${t.payBy}`);
    assert(t.size === 6 && t.courts === 1 && t.minutes === 150, `the smart plan for nobody locked in: ${JSON.stringify([t.size, t.courts, t.minutes])}`);
    const a = await adminPage();
    await a.page.locator('[data-tm-tickets]').waitFor({ timeout: 15000 });
    assert((await a.page.locator('[data-tm-open-tickets]').count()) === 0, 'no Open tickets button');
    assert(flat(await a.page.locator('[data-tm-row="plan"]').innerText()) === '6 players · 1 court · 2.5 hours', 'the plan line');
    assert(flat(await a.page.locator('[data-tm-row="cost"]').innerText()) === '$8', 'your cost if it fills');
    assert((await a.page.locator('[data-tickets-card]').getAttribute('data-tickets-card')) === '0/6', 'the Home line');
    await shot(a.page, 'A-admin-29');
    assert(a.errors.length === 0, a.errors.join(' | '));
    await a.ctx.close();
  });

  // ---------------------------------------------------------------- B  picking the date opens tickets
  await check('B picking the date opens tickets at once: the date sheet says so, Pay by Wed 7:00 PM, the Home line says Tickets: 0 of 6 locked in', async () => {
    await stage('signup');
    const a = await adminPage();
    await a.page.locator('[data-tm-open-dates]').click();
    await a.page.locator('[data-tm-card="dates"] .tm-day.tm-open').first().waitFor();
    await a.page.locator('[data-tm-card="dates"] [data-day="2026-12-17"]').click();
    // Zip 60: the date sheet is the Finalize screen now: Finalize date locks it (tickets open at once).
    await a.page.locator('[data-tm-finalize-go]').waitFor({ timeout: 10000 });
    await shot(a.page, 'B-date-sheet');
    await a.page.locator('[data-tm-finalize-go]').click();
    await a.page.locator('[data-tm-finalize-go]').waitFor({ state: 'detached', timeout: 10000 });
    await a.ctx.close();
    d = await dash();
    assert(d.tournament.status === 'tickets' && d.tournament.finalDate === '2026-12-17' && d.tournament.payBy === '2026-12-17T00:00:00.000Z', JSON.stringify({ s: d.tournament.status, p: d.tournament.payBy }));
    const h = await adminPage();
    await h.page.locator('[data-tickets-card]').waitFor({ timeout: 15000 });
    assert((await h.page.locator('[data-tickets-card]').getAttribute('data-tickets-card')) === '0/6', 'the Home line');
    // Zip 63: while players who can make the date have not paid, the count's card is mock 14's Remind all unpaid card (same data attribute).
    assert(flat(await h.page.locator('[data-tm-row="paid"]').innerText()) === '0', 'Paid 0');
    await shot(h.page, 'B-admin-tickets-open');
    assert(h.errors.length === 0, h.errors.join(' | '));
    await h.ctx.close();
  });

  // ---------------------------------------------------------------- C  lock my spot, the Pay sheet, I paid
  await check('C Parker: Lock my spot opens the site\'s Pay sheet (Pay Alex $16, Venmo, I paid); I paid waits for Alex', async () => {
    const p = await playerPage('Parker');
    const card = p.page.locator('.tc').first();
    await card.waitFor({ timeout: 15000 });
    const words = flat(await card.innerText());
    // Nobody locked in yet: the plan is 6 players, 2.5 hours (Alex's smart plan); players see its hours.
    // Zip 63: the card's one look (top line, name, format, balls, Lock my spot, Pay by): the hours and See who's in live in the overlay now.
    assert(/^TOURNAMENT · /.test(words) && words.includes('Lock my spot · $16') && /Pay by \d+\/\d+$/.test(words), words);
    await card.locator('[data-tc-lock]').click();
    const pay = p.page.locator('[data-pay-sheet]');
    await pay.waitFor({ timeout: 10000 });
    const sheet = flat(await sheetOpen(p.page).innerText());
    assert(sheet.includes('Pay Alex $16') && sheet.includes('Have the Venmo app? Click here') && /Copy Venmo/.test(sheet) && sheet.includes('I paid'), sheet);
    await shot(p.page, 'C-pay-sheet');
    await p.page.locator('[data-sheet-paid]').click();
    // Zip 63 (Alex, the trust rule): after I paid the player sees "You're locked in" at once; Alex still confirms or undoes it on Home.
    await p.page.locator('.tc').filter({ hasText: 'You’re locked in' }).waitFor({ timeout: 10000 });
    assert(!/confirm|waiting/i.test(flat(await p.page.locator('.tc').first().innerText())), 'no waiting words');
    assert(p.errors.length === 0, p.errors.join(' | '));
    await p.ctx.close();
    d = await dash();
    const k = d.tournament.tickets.find((x) => x.name === 'Parker');
    assert(k && k.claimCents === 1600 && k.place === 'none', JSON.stringify(k));
  });

  // ---------------------------------------------------------------- D  Alex answers
  await check('D Alex taps Paid on Home: Parker is locked in ("You\'re in · 2 hours · You\'re locked in")', async () => {
    const a = await adminPage();
    const claim = a.page.locator('[data-ticket-claim="Parker"]');
    await claim.waitFor({ timeout: 15000 });
    assert(flat(await claim.innerText()).includes('Parker tapped I paid ($16), not confirmed.'), flat(await claim.innerText()));
    await claim.locator('[data-claim-paid]').click();
    await claim.waitFor({ state: 'detached', timeout: 10000 });
    assert((await a.page.locator('[data-tickets-card]').getAttribute('data-tickets-card')) === '1/6', 'the Home line');
    await a.ctx.close();
    const p = await playerPage('Parker');
    const words = flat(await p.page.locator('.tc').first().innerText());
    // Zip 63: the card's one look: See who's in and "You're locked in" at the bottom; the hours and Drop out are in the overlay.
    assert(words.includes('See who’s in') && words.endsWith('You’re locked in'), words);
    await openOverlay(p.page);
    const over = flat(await sheetOpen(p.page).innerText());
    assert(over.includes('2.5 hours') && over.includes('You’re locked in') && over.includes('Drop out'), over);
    await shot(p.page, 'D-parker-locked-in');
    await p.ctx.close();
  });

  // ---------------------------------------------------------------- E  back out after paying
  await check('E Parker backs out after paying: the words say the $16 comes back as credit, and it does', async () => {
    const p = await playerPage('Parker');
    await tapLink(p.page, 'data-tc-drop');
    const text = p.page.locator('[data-tm-backout-text]');
    await text.waitFor({ timeout: 10000 });
    const words = flat(await text.innerText());
    assert(words === 'Are you sure you want to back out of the Winter Classic? You come off the list. You can sign up again if you change your mind. Your $16 comes back as credit.', words);
    const sheet = flat(await sheetOpen(p.page).innerText());
    assert(sheet.includes('Stay signed up') && sheet.includes('Yes, back out'), sheet);
    await shot(p.page, 'E-back-out');
    await p.page.locator('dialog[open] [data-confirm-go]').click();
    await p.page.locator('[data-tm-backout-text]').waitFor({ state: 'detached', timeout: 10000 });
    await p.ctx.close();
    const { data } = await answerOf('Parker');
    assert(data.credit && data.credit.balanceCents === 1600, `credit: ${JSON.stringify(data.credit && data.credit.balanceCents)}`);
    assert(data.tournament.me === null && data.tournament.tickets.locked.length === 0, JSON.stringify(data.tournament.tickets));
  });

  // ---------------------------------------------------------------- F  the waitlist screens (12 locked in)
  // The spots follow the players locked in and fill only at 12; the preview has 10 names (no new names allowed), so the player's answer is
  // stood in for here (as the server sends it: names only, Alex's ship answer 5): 12 locked in, Reese first in line, Vic second (or not in
  // line yet). The server's own waitlist rules are proven to the cent in tests/zip56-tickets.test.ts with 16 players.
  const FILL = ['Alex', 'Parker', 'Rowan', 'Sage', 'Christopher Vanderberg', 'Wren', 'Quinn', 'Zoe', 'Parker', 'Rowan', 'Sage', 'Wren'];
  async function fakeFull(page, inLine) {
    await page.route('**/api/group', async (route) => {
      const res = await route.fetch();
      const data = await res.json();
      const k = data.tournament && data.tournament.tickets;
      if (k) {
        k.size = 12;
        k.full = true;
        k.locked = FILL.map((name) => ({ name }));
        k.line = inLine ? [{ name: 'Reese' }, { name: 'Vic', me: true }] : [{ name: 'Reese' }];
        k.mine = inLine ? { place: 'line', creditCents: 0, paidCents: 0, claimCents: 0, owedCents: 1600 } : null;
      }
      await route.fulfill({ response: res, json: data });
    });
  }
  await check('F 12 locked in: Vic sees "12 spots taken" and Join waitlist; in line, picture 12 (Hold my spot · $16, Just keep me on the list)', async () => {
    await stage('tickets_open');
    const p = await newPage();
    await fakeFull(p.page, false);
    await p.page.goto(`${BASE}/?as=Vic`);
    await p.page.locator('.tc').first().waitFor({ timeout: 30000 });
    await p.page.waitForTimeout(500);
    const words = flat(await p.page.locator('.tc').first().innerText());
    // Zip 63: standby (never waitlist), and the cap is hidden: Join standby, no number.
    assert(words.includes('Join standby') && !/waitlist|12 spots/i.test(words), words);
    await shot(p.page, 'F-full-card');
    await p.ctx.close();
    const q = await newPage();
    await fakeFull(q.page, true);
    await q.page.goto(`${BASE}/?as=Vic`);
    await q.page.locator('.tc-hero').first().waitFor({ timeout: 30000 });
    await openOverlay(q.page);
    await q.page.locator('dialog[open] [data-tc-keep]').waitFor({ timeout: 10000 });
    const overlay = flat(await sheetOpen(q.page).innerText());
    assert(overlay.includes('You’re second on standby') && overlay.includes('Hold my spot · $16') && overlay.includes('Just keep me on the list'), overlay);
    assert(overlay.includes('If someone drops, you’re locked into that spot.') && overlay.includes('If a spot opens, whoever pays first gets it.'), overlay);
    // Alex (ship answer 5): no Paid or Not paid next to anyone else on a player's screen; their own row says You.
    // Zip 63 round 2: Who's in has no count chip at all.
    assert(!/12 in|12 of 12|Paid, first in line|Not paid/.test(overlay) && (await q.page.locator('dialog[open] [data-tw-count]').count()) === 0, overlay);
    assert(flat(await q.page.locator('dialog[open] [data-tw-row="Vic"]').innerText()).endsWith('You'), 'Vic\'s own row');
    await shot(q.page, 'F-waitlist-overlay');
    assert(q.errors.length === 0, q.errors.join(' | '));
    await q.ctx.close();
  });

  // ---------------------------------------------------------------- G  cancel or reschedule
  await check('G Cancel or reschedule (picture 30): Reschedule asks, then players see "Rescheduled. Pick your dates again."', async () => {
    await stage('tickets_open');
    const a = await adminPage();
    await a.page.locator('[data-tm-cancel-or-reschedule]').click();
    await a.page.locator('[data-tm-reschedule]').waitFor({ timeout: 10000 });
    const sheet = flat(await sheetOpen(a.page).innerText());
    assert(sheet.includes('Reschedule') && sheet.includes('Cancel tournament'), sheet);
    await a.page.locator('[data-tm-reschedule]').click();
    await a.page.locator('dialog[open] [data-confirm-go]').click();
    await a.page.waitForTimeout(800);
    await a.ctx.close();
    d = await dash();
    assert(d.tournament.status === 'rescheduled', d.tournament.status);
    const p = await playerPage('Parker');
    const words = flat(await p.page.locator('.tc').first().innerText());
    assert(words.includes('Rescheduled. Pick your dates again.'), words);
    await shot(p.page, 'G-rescheduled');
    await p.ctx.close();
  });
  await check('G Cancel tournament asks, then every paid ticket is credit and players on the list see the plain Canceled card', async () => {
    await stage('tickets_open');
    const before = (await answerOf('Parker')).data.credit.balanceCents;
    const a = await adminPage();
    await a.page.locator('[data-tm-cancel-or-reschedule]').click();
    await a.page.locator('[data-tm-cancel-tournament]').click();
    await a.page.locator('dialog[open] [data-confirm-go]').click();
    await a.page.locator('[data-tm-canceled-note]').waitFor({ timeout: 15000 });
    assert(flat(await a.page.locator('[data-tm-canceled-note]').innerText()) === 'Every paid ticket came back as credit.', 'the organizer note');
    await shot(a.page, 'G-admin-canceled');
    await a.ctx.close();
    const { data } = await answerOf('Parker');
    assert(data.credit.balanceCents === before + 1600, `credit ${before} -> ${data.credit.balanceCents}`);
    const p = await playerPage('Parker');
    const words = flat(await p.page.locator('.tc').first().innerText());
    assert(/canceled/i.test(words) && words.includes('Canceled. Your $16 is back as credit.'), words);
    assert((await p.page.locator('.tc button').count()) === 0, 'the Canceled card has no buttons');
    await shot(p.page, 'G-player-canceled');
    await p.ctx.close();
  });

  // ---------------------------------------------------------------- H  evens
  await check('H 7 locked in after Pay by: the plain warning, and nobody is taken off', async () => {
    await stage('odd');
    const a = await adminPage();
    const warn = a.page.locator('[data-tm-evens]');
    await warn.waitFor({ timeout: 15000 });
    assert(flat(await warn.innerText()) === '7 locked in. Need 1 more or 1 less.', flat(await warn.innerText()));
    assert((await a.page.locator('[data-tickets-card]').getAttribute('data-tickets-card')) === '7/10', 'the Home line (7 locked in: 10 planned)');
    await shot(a.page, 'H-odd');
    await a.ctx.close();
    d = await dash();
    assert(d.tournament.tickets.filter((k) => k.place === 'spot').length === 7, 'still 7');
  });

  // ---------------------------------------------------------------- I  every screen, every size
  for (const scheme of SCHEMES)
    for (const width of SIZES)
      await check(`I tickets open: Vic's card, the overlay (picture 09) and the Pay sheet fit; every row on one line (${width} ${scheme})`, async () => {
        await stage('tickets_open');
        const p = await playerPage('Vic', { width, scheme });
        await fits(p.page, '.tc');
        await openOverlay(p.page);
        await p.page.locator('dialog[open] [data-tw-in]').waitFor({ timeout: 10000 });
        await p.page.waitForTimeout(300);
        await fits(p.page, 'dialog[open] .tc-tw');
        await oneLineRows(p.page, 'dialog[open] .tc-tw-rows li');
        const rows = flat(await p.page.locator('dialog[open] [data-tw-in]').innerText());
        // Zip 63 round 2 (Alex's mocks): everyone on the card, no count, no Open spot rows; only Vic's own row has words.
        assert(!/6 of 8|Open spot/i.test(rows) && rows.includes('Christopher Vanderberg') && rows.includes('Pay to lock in'), rows);
        await shot(p.page, `I-overlay09-${width}-${scheme}`);
        await p.page.locator('dialog[open] [data-tc-lock]').click();
        await p.page.locator('[data-pay-sheet]').waitFor({ timeout: 10000 });
        await p.page.waitForTimeout(300);
        await fits(p.page, 'dialog[open]');
        await shot(p.page, `I-pay10-${width}-${scheme}`);
        assert(p.errors.length === 0, p.errors.join(' | '));
        await p.ctx.close();
      });
  for (const scheme of SCHEMES)
    for (const width of SIZES)
      await check(`I 12 locked in: Vic's card and picture 12 (stood in for), Zoe's picture 11 (locked in, Drop out on the row) fit, rows on one line (${width} ${scheme})`, async () => {
        await stage('all_locked');
        const v = await newPage({ width, scheme });
        await fakeFull(v.page, true);
        await v.page.goto(`${BASE}/?as=Vic`);
        await v.page.locator('.tc-hero').first().waitFor({ timeout: 30000 });
        await fits(v.page, '.tc');
        await openOverlay(v.page);
        await v.page.locator('dialog[open] [data-tc-keep]').waitFor({ timeout: 10000 });
        await v.page.waitForTimeout(300);
        await fits(v.page, 'dialog[open] .tc-tw');
        await oneLineRows(v.page, 'dialog[open] .tc-tw-rows li');
        await shot(v.page, `I-overlay12-${width}-${scheme}`);
        assert(v.errors.length === 0, v.errors.join(' | '));
        await v.ctx.close();
        const z = await playerPage('Zoe', { width, scheme });
        await openOverlay(z.page);
        await z.page.locator('dialog[open] [data-tc-locked]').waitFor({ timeout: 10000 });
        await z.page.waitForTimeout(300);
        await fits(z.page, 'dialog[open] .tc-tw');
        await oneLineRows(z.page, 'dialog[open] .tc-tw-rows li');
        const row = await z.page.evaluate(() => {
          const r = document.querySelector('dialog[open] [data-tc-locked]').getBoundingClientRect();
          return { h: r.height, items: [...document.querySelectorAll('dialog[open] [data-tc-locked] > *')].map((e) => Math.round(e.getBoundingClientRect().top + e.getBoundingClientRect().height / 2)) };
        });
        assert(row.h < 70 && Math.max(...row.items) - Math.min(...row.items) <= 3, `the locked-in row is one line: ${JSON.stringify(row)}`);
        await shot(z.page, `I-overlay11-${width}-${scheme}`);
        assert(z.errors.length === 0, z.errors.join(' | '));
        await z.ctx.close();
      });
  for (const scheme of SCHEMES)
    for (const width of SIZES)
      await check(`I organizer: Home's ticket card and line, the Tickets page, the plan and picture 30 fit (${width} ${scheme})`, async () => {
        await stage('all_locked');
        const a = await adminPage({ width, scheme });
        await a.page.locator('[data-tickets-card]').waitFor({ timeout: 15000 });
        await fits(a.page, 'main');
        await shot(a.page, `I-admin-home-${width}-${scheme}`);
        await a.page.locator('[data-tickets-open]').click();
        await a.page.locator('dialog[open] [data-tm-card="tickets"]').waitFor({ timeout: 10000 });
        await a.page.waitForTimeout(300);
        await fits(a.page, 'dialog[open]');
        const list = flat(await a.page.locator('dialog[open] [data-tm-card="tickets"]').innerText());
        assert(list.includes('Christopher Vanderberg') && /10 of 12 locked in/i.test(list), list);
        await oneLineRows(a.page, 'dialog[open] [data-tm-ticket-row]');
        await a.page.locator('dialog[open] [data-tm-card="plan"]').scrollIntoViewIfNeeded();
        await oneLineRows(a.page, 'dialog[open] [data-tm-card="plan"] .tm-row');
        await shot(a.page, `I-admin-plan-${width}-${scheme}`);
        await shot(a.page, `I-admin-tickets-${width}-${scheme}`);
        await a.page.keyboard.press('Escape');
        await a.page.waitForTimeout(300);
        await a.page.locator('[data-tm-cancel-or-reschedule]').first().click();
        await a.page.locator('dialog[open] [data-tm-cor]').waitFor({ timeout: 10000 });
        await a.page.waitForTimeout(300);
        await fits(a.page, 'dialog[open]');
        await shot(a.page, `I-admin-30-${width}-${scheme}`);
        assert(a.errors.length === 0, a.errors.join(' | '));
        await a.ctx.close();
      });
  for (const scheme of SCHEMES)
    for (const width of SIZES)
      await check(`I locked in, canceled, rescheduled cards and the back out sheet fit (${width} ${scheme})`, async () => {
        await stage('all_locked');
        const v = await playerPage('Vic', { width, scheme });
        await fits(v.page, '.tc');
        await tapLink(v.page, 'data-tc-drop');
        await v.page.locator('[data-tm-backout-text]').waitFor({ timeout: 10000 });
        await fits(v.page, 'dialog[open]');
        await shot(v.page, `I-backout-${width}-${scheme}`);
        await v.ctx.close();
        for (const s of ['canceled', 'rescheduled']) {
          await stage(s);
          const p = await playerPage('Parker', { width, scheme });
          await fits(p.page, '.tc');
          await shot(p.page, `I-${s}-${width}-${scheme}`);
          assert(p.errors.length === 0, p.errors.join(' | '));
          await p.ctx.close();
        }
      });

  // ---------------------------------------------------------------- K  Alex's changes after testing piece 1
  await check('K the smart plan on the tournament page: 8 players, 2 courts, 2 hours; your cost if it fills $12, with 6 paid now $28; the Booking hours note only when needed', async () => {
    await stage('tickets_open');
    const a = await adminPage();
    await a.page.locator('[data-tm-open-page]').click();
    const card = a.page.locator('dialog[open] [data-tm-card="plan"]');
    await card.waitFor({ timeout: 10000 });
    const words = flat(await card.innerText());
    assert(words.includes('8 players') && words.includes('2 courts · 2 hours') && words.includes('Your cost if it fills $12') && words.includes('With 6 paid now $28'), words);
    assert((await a.page.locator('dialog[open] [data-tm-booking-note]').count()) === 0, 'no Booking hours note for 2 hours');
    await shot(a.page, 'K-plan-8');
    await a.ctx.close();
    // 10 locked in: 12 players, 2 courts, 3 hours. With Booking hours off the plan says to turn it on.
    await stage('all_locked');
    await call('PUT', '/api/admin/booking-hours-switch', { on: false });
    try {
      const b = await adminPage();
      await b.page.locator('[data-tm-open-page]').click();
      await b.page.locator('dialog[open] [data-tm-card="plan"]').waitFor({ timeout: 10000 });
      const w2 = flat(await b.page.locator('dialog[open] [data-tm-card="plan"]').innerText());
      // 10 locked in: 12 spots, 2 courts, 3 hours. $144 - 11 x $16 + $28 = -$4 (the tickets cover it); 9 paid now: $144 - $144 + $28 = $28.
      assert(w2.includes('12 players') && w2.includes('2 courts · 3 hours') && w2.includes('Turn on Booking hours'), w2);
      assert(w2.includes('Your cost if it fills -$4') && w2.includes('With 9 paid now $28'), w2);
      await shot(b.page, 'K-plan-12-booking-off');
      await b.ctx.close();
    } finally {
      await call('PUT', '/api/admin/booking-hours-switch', { on: true });
    }
  });
  for (const format of ['doubles', 'americano'])
    for (const scheme of SCHEMES)
      for (const width of [390, 320])
        await check(`K the format in one line under the name, player and organizer (${format}, ${width} ${scheme})`, async () => {
          await call('POST', '/api/admin/tournament-test', { stage: 'signup', format });
          const want = format === 'americano' ? 'Americano (new partner every round)' : 'Locked doubles (same partner all night)';
          const v = await playerPage('Vic', { width, scheme });
          const line = v.page.locator('.tc [data-tc-format-name]');
          await line.waitFor({ timeout: 15000 });
          assert(flat(await line.innerText()) === want && (await v.page.locator('.tc [data-tc-rule]').count()) === 0, flat(await line.innerText()));
          const lines = await line.evaluate((el) => {
            const r = document.createRange();
            r.selectNodeContents(el);
            return new Set([...r.getClientRects()].map((x) => Math.round(x.top))).size;
          });
          assert(lines === 1, `${lines} lines`);
          const color = await line.evaluate((el) => getComputedStyle(el).color);
          await fits(v.page, '.tc');
          await shot(v.page, `K-format-${format}-${width}-${scheme}`);
          await v.ctx.close();
          const a = await adminPage({ width, scheme });
          const al = a.page.locator('.tm-home-format');
          await al.waitFor({ timeout: 15000 });
          assert(flat(await al.innerText()) === want && (await a.page.locator('.tm-home-rule').count()) === 0, flat(await al.innerText()));
          await fits(a.page, '[data-tm-home]');
          await a.ctx.close();
          assert(/rgb/.test(color), color);
        });
  for (const scheme of SCHEMES)
    for (const width of [390, 320])
      await check(`K Create and Edit: no players expected, no court plan; the $ boxes have clear space between them (${width} ${scheme})`, async () => {
        await stage('none');
        const a = await adminPage({ width, scheme });
        await a.page.locator('.tabbar button', { hasText: 'Settings' }).click();
        const sched = a.page.locator('[data-section="schedule"]');
        if (!(await sched.getAttribute('open'))) await sched.locator('summary').click();
        await a.page.locator('[data-tm-schedule-row]').click();
        await a.page.locator('[data-tm-form="create"]').waitFor();
        const text = flat(await a.page.locator('dialog[open]').innerText());
        assert(!/Players expected/i.test(text) && (await a.page.locator('dialog[open] [data-tm-card="size"], dialog[open] .tm-plans').count()) === 0, 'no size or plan rows');
        // The site's double-tap guard drops a tap within 0.4 s and 24 px of the tap that opened the sheet: wait like a person would.
        await a.page.waitForTimeout(600);
        await a.page.locator('[data-format="americano"]').click();
        assert((await a.page.locator('[data-format="americano"]').getAttribute('aria-pressed')) === 'true', 'Americano picked');
        await a.page.locator('[data-tm-card="prize"]').scrollIntoViewIfNeeded();
        const gaps = await a.page.evaluate(() => {
          const boxes = [...document.querySelectorAll('dialog[open] .tm-money')].map((b) => b.getBoundingClientRect()).sort((x, y) => x.top - y.top);
          return boxes.slice(1).map((b, i) => Math.round(b.top - boxes[i].bottom));
        });
        assert(gaps.length >= 2 && gaps.every((g) => g >= 10), `space between the $ boxes: ${gaps}`);
        await fits(a.page, 'dialog[open]');
        await shot(a.page, `K-create-prizes-${width}-${scheme}`);
        await a.ctx.close();
      });
  await check('K the night is over (the answer stood in for): no Cancel or reschedule, no Pay by Change, and Vic\'s ticket has no Mark paid or Take off', async () => {
    await stage('tickets_open');
    const a = await newPage({ organizer: true });
    // The clock cannot pass Dec 17 here, so the organizer's answer says the night has started and is over (what the server sends then).
    await a.page.route('**/api/admin/dashboard', async (route) => {
      const res = await route.fetch();
      const data = await res.json();
      if (data.tournament) Object.assign(data.tournament, { closed: true, over: true });
      await route.fulfill({ response: res, json: data });
    });
    await a.page.goto(`${BASE}/admin`);
    await a.page.locator('[data-tm-home="tickets"]').waitFor({ timeout: 30000 });
    assert((await a.page.locator('[data-tm-cancel-or-reschedule]').count()) === 0, 'no Cancel or reschedule on Home');
    // The chip is drawn in capitals (innerText follows the CSS).
    assert(flat(await a.page.locator('[data-tm-stage]').innerText()).toLowerCase() === 'tickets closed', 'the chip');
    await a.page.locator('[data-tm-tickets]').click();
    await a.page.locator('dialog[open] [data-tm-card="tickets"]').waitFor({ timeout: 10000 });
    assert((await a.page.locator('dialog[open] [data-tm-cancel-or-reschedule], dialog[open] [data-tm-pay-by-change]').count()) === 0, 'no Cancel or reschedule, no Change on the page');
    await a.page.waitForTimeout(600);
    await a.page.locator('dialog[open] [data-tm-ticket-row="Vic"]').click();
    await a.page.locator('dialog[open] [data-tm-ticket-sheet="Vic"]').waitFor({ timeout: 10000 });
    assert((await a.page.locator('dialog[open] [data-tm-ticket-mark], dialog[open] [data-tm-ticket-off]').count()) === 0, 'no Mark paid, no Take off');
    await shot(a.page, 'K-night-over-ticket');
    await a.ctx.close();
  });
  await check('K canceled: no Take off and no level pencils; Tournaments off for players: no Mark paid (the server refuses each of them)', async () => {
    await stage('canceled');
    const a = await adminPage();
    await a.page.locator('[data-tm-open-page]').click();
    await a.page.locator('dialog[open] [data-tm-page]').waitFor({ timeout: 15000 });
    assert((await a.page.locator('dialog[open] [data-tm-pencil]').count()) === 0, 'no level pencils on a canceled tournament');
    await a.page.waitForTimeout(600);
    await a.page.locator('dialog[open] [data-tm-ticket-row="Vic"]').click();
    await a.page.locator('dialog[open] [data-tm-ticket-sheet="Vic"]').waitFor({ timeout: 10000 });
    assert((await a.page.locator('dialog[open] [data-tm-ticket-off], dialog[open] [data-tm-ticket-mark]').count()) === 0, 'no Take off, no Mark paid');
    await a.ctx.close();
    await stage('tickets_open');
    const b = await newPage({ organizer: true });
    // Off for players (the organizer on the private link): the answer stood in for, as the server sends it then.
    await b.page.route('**/api/admin/dashboard', async (route) => {
      const res = await route.fetch();
      const data = await res.json();
      delete data.tournamentsForAll;
      await route.fulfill({ response: res, json: data });
    });
    await b.page.goto(`${BASE}/admin`);
    await b.page.locator('[data-tm-tickets]').waitFor({ timeout: 30000 });
    await b.page.locator('[data-tm-tickets]').click();
    await b.page.locator('dialog[open] [data-tm-card="tickets"]').waitFor({ timeout: 10000 });
    await b.page.waitForTimeout(600);
    await b.page.locator('dialog[open] [data-tm-ticket-row="Vic"]').click();
    await b.page.locator('dialog[open] [data-tm-ticket-sheet="Vic"]').waitFor({ timeout: 10000 });
    assert((await b.page.locator('dialog[open] [data-tm-ticket-mark]').count()) === 0, 'no Mark paid while players cannot see it');
    assert((await b.page.locator('dialog[open] [data-tm-ticket-off]').count()) === 1, 'Take off is still there');
    await b.ctx.close();
  });
  for (const format of ['doubles', 'americano'])
    for (const [width, scheme] of [[390, 'light'], [320, 'dark']])
      await check(`K the format line on the ticket cards too: the player card, Who's in and the organizer's card, one line (${format}, ${width} ${scheme})`, async () => {
        await call('POST', '/api/admin/tournament-test', { stage: 'tickets_open', format });
        const want = format === 'americano' ? 'Americano (new partner every round)' : 'Locked doubles (same partner all night)';
        const oneLine = (loc) =>
          loc.evaluate((el) => {
            const r = document.createRange();
            r.selectNodeContents(el);
            return new Set([...r.getClientRects()].map((x) => Math.round(x.top))).size;
          });
        const p = await playerPage('Parker', { width, scheme });
        const line = p.page.locator('.tc [data-tc-format-name]').first();
        await line.waitFor({ timeout: 15000 });
        assert(flat(await line.innerText()) === want && (await oneLine(line)) === 1, `card: ${flat(await line.innerText())}`);
        await p.page.waitForTimeout(600);
        await openOverlay(p.page);
        const inSheet = p.page.locator('dialog[open] .tc [data-tc-format-name]').first();
        await inSheet.waitFor({ timeout: 10000 });
        assert(flat(await inSheet.innerText()) === want && (await oneLine(inSheet)) === 1, 'Who\'s in');
        await fits(p.page, 'dialog[open]');
        await shot(p.page, `K-ticket-format-${format}-${width}-${scheme}`);
        await p.ctx.close();
        const a = await adminPage({ width, scheme });
        const al = a.page.locator('[data-tm-home="tickets"] .tm-tix-format');
        await al.waitFor({ timeout: 15000 });
        assert(flat(await al.innerText()) === want && (await oneLine(al)) === 1, 'organizer card');
        await fits(a.page, '[data-tm-home]');
        await a.ctx.close();
      });
  await check('K Money > Totals: its own Tournament tickets line, 6 paid $96 (5 Venmo, 1 credit), under the two cards', async () => {
    await stage('tickets_open');
    const a = await adminPage();
    await a.page.locator('.tabbar button', { hasText: 'Money' }).click();
    const totals = a.page.locator('[role="group"][aria-label="Games or Totals"] button', { hasText: 'Totals' });
    await totals.waitFor({ timeout: 15000 });
    await a.page.waitForTimeout(600);
    await totals.click();
    const line = a.page.locator('[data-card="tournament-tickets"]');
    await line.waitFor({ timeout: 15000 });
    const words = flat(await line.innerText());
    assert(words === 'Tournament tickets 6 paid $96', words);
    assert((await a.page.locator('[data-tickets-total="9600"]').count()) === 1, 'the cents');
    await shot(a.page, 'K-totals-tickets');
    await a.ctx.close();
  });
  await check('K a level is picked once: Vic signs up at 3.4, backs out; signing up again skips the level (it stays 3.4); Edit sign-up is dates only', async () => {
    await stage('signup');
    const id = (await dash()).tournament.id;
    const v = await phone('Vic');
    const open = (await v.answer()).data.tournament.openDates;
    assert((await v.post('/api/tournament/signup', { tournamentId: id, level: 340, dates: [open[0]] })).status === 200, 'Vic signs up');
    assert((await v.post('/api/tournament/back-out', { tournamentId: id })).data.result === 'backed_out', 'Vic backs out');
    await v.close();
    const p = await playerPage('Vic');
    await p.page.locator('.tc [data-tc-signup]').click();
    await p.page.locator('dialog[open] [data-tm-step="2"]').waitFor({ timeout: 10000 });
    assert((await p.page.locator('dialog[open] [data-tm-step="1"], dialog[open] [data-tm-back]').count()) === 0, 'no level step, no Back');
    await p.page.locator('dialog[open] button.tm-day.tm-open').first().click();
    await p.page.locator('dialog[open] [data-tm-submit]').click();
    await p.page.locator('dialog[open] [data-tm-submit]').waitFor({ state: 'detached', timeout: 10000 });
    await tapLink(p.page, 'data-tc-edit');
    await p.page.locator('dialog[open] [data-tm-save]').waitFor({ timeout: 10000 });
    assert((await p.page.locator('dialog[open] [data-tm-mylevel], dialog[open] [data-tm-change]').count()) === 0, 'Edit has no level row');
    await shot(p.page, 'K-edit-dates-only');
    await p.ctx.close();
    d = await dash();
    assert(d.tournament.signups.find((s) => s.name === 'Vic').pickedLevel === 340, 'still 3.4');
  });
  await check('K the soft fade shows only while there is more to scroll: the Create calendar at the top, not at its end; the sign-up sheet', async () => {
    await stage('none');
    const a = await adminPage();
    await a.page.locator('.tabbar button', { hasText: 'Settings' }).click();
    const sched = a.page.locator('[data-section="schedule"]');
    if (!(await sched.getAttribute('open'))) await sched.locator('summary').click();
    await a.page.locator('[data-tm-schedule-row]').click();
    const box = a.page.locator('dialog[open] .tm-cal-box');
    await box.waitFor();
    await box.evaluate((el) => (el.scrollTop = 0));
    await a.page.waitForTimeout(200);
    assert(await box.evaluate((el) => el.hasAttribute('data-more') && getComputedStyle(el).maskImage !== 'none'), 'the fade while more months are below');
    await box.evaluate((el) => (el.scrollTop = el.scrollHeight));
    await a.page.waitForTimeout(250);
    assert(await box.evaluate((el) => !el.hasAttribute('data-more') && getComputedStyle(el).maskImage === 'none'), 'no fade at the end');
    await a.ctx.close();
    await stage('signup');
    const v = await playerPage('Vic', { height: 1400 });
    await v.page.locator('.tc [data-tc-signup]').click();
    const bar = v.page.locator('dialog[open] .tm-bottom');
    await bar.waitFor({ timeout: 10000 });
    await v.page.waitForTimeout(300);
    const fit = await bar.evaluate((el) => ({ more: el.hasAttribute('data-more'), op: getComputedStyle(el, '::before').opacity }));
    assert(!fit.more && fit.op === '0', `a tall screen: everything fits, no fade: ${JSON.stringify(fit)}`);
    await v.ctx.close();
    const w = await playerPage('Vic', { height: 560 });
    await w.page.locator('.tc [data-tc-signup]').click();
    const bar2 = w.page.locator('dialog[open] .tm-bottom');
    await bar2.waitFor({ timeout: 10000 });
    await w.page.waitForTimeout(300);
    const short = await bar2.evaluate((el) => ({ more: el.hasAttribute('data-more'), op: getComputedStyle(el, '::before').opacity }));
    assert(short.more && short.op === '1', `a short screen with more below: the fade: ${JSON.stringify(short)}`);
    await w.ctx.close();
  });

  // ---------------------------------------------------------------- J  nobody else gets it
  await check('J switched off while tickets are open: players get no tournament at all (no key, no name, no ticket words)', async () => {
    await stage('tickets_open');
    const id = (await dash()).tournament.id;
    await call('PUT', '/api/admin/tournaments-switch', { on: false });
    try {
      for (const n of ['Vic', 'Parker', 'Reese', 'Christopher Vanderberg']) {
        const { text, data } = await answerOf(n);
        assert(!('tournament' in data), `${n} got a tournament key`);
        for (const w of ['Winter Classic', id, 'tournament', 'Tournament']) assert(!text.includes(w), `${n}'s answer holds "${w}"`);
      }
      const v = await phone('Vic');
      for (const url of ['/api/tournament/lock', '/api/tournament/waitlist', '/api/tournament/paid', '/api/tournament/back-out']) {
        const r = await v.post(url, { tournamentId: id, intent: 'lock', priceCents: 1600, cents: 1600 });
        assert(r.status === 404 && r.data.message === 'This tournament is not open.', `${url}: ${r.status} ${JSON.stringify(r.data)}`);
      }
      await v.close();
      const p = await playerPage('Vic');
      assert((await p.page.locator('.tc, .tc-tw').count()) === 0 && !(await p.page.content()).includes('Winter Classic'), 'Vic sees it');
      await p.ctx.close();
    } finally {
      await call('PUT', '/api/admin/tournaments-switch', { on: true });
    }
  });
  await check('J canceled: only the players who were on its list see the Canceled card; Vic, off the list first, gets nothing', async () => {
    await stage('tickets_open');
    const id = (await dash()).tournament.id;
    const v = await phone('Vic');
    assert((await v.post('/api/tournament/back-out', { tournamentId: id })).data.result === 'backed_out', 'Vic backs out');
    await v.close();
    await call('POST', `/api/admin/tournament/${id}/cancel`, {});
    const vic = await answerOf('Vic');
    assert(!('tournament' in vic.data) && !vic.text.includes('Winter Classic'), 'Vic got it');
    const parker = (await answerOf('Parker')).data;
    assert(parker.tournament && parker.tournament.status === 'canceled' && parker.tournament.canceled.backCents === 1600, JSON.stringify(parker.tournament));
  });

  await stage('date_picked');
  await browser.close();
  console.log(`\nzip56: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
main().catch((err) => {
  console.error(err);
  process.exit(1);
});
