/* Zip 56 (🎾56.tourney2): Tournaments, piece 2 (tickets), in a real browser.
 *
 *   node e2e/zip56.cjs      (also run by npm run test:e2e)
 *
 * The world is the preview's calm Zip 56 profile (scripts/preview-world-small.ts step 29: the Winter Classic at Date picked for Everyone, 8 on
 * the list, Thu Dec 17 picked) as of Tue Nov 17 2026, 9:00 AM Eastern, the clock 10:00 AM. The dev server runs with PREVIEW_CALM=on and
 * PB_PREVIEW_BUILD=1, as the preview does.
 *   A  The seed: organizer Home shows picture 29's card with Open tickets.
 *   B  Open tickets from Home: Pay by Tue Dec 15, 7:00 PM; the Home line "Tickets: 0 of 8 locked in".
 *   C  Parker: Lock my spot, the site's Pay sheet (Pay Alex $16, Venmo, I paid), then "Paid · Waiting for Alex to confirm".
 *   D  Alex answers on Home (Paid): Parker is locked in.
 *   E  Parker backs out after paying: the Are you sure words say the $16 comes back as credit, and it does.
 *   F  Spots full (test page stage): Vic sees "8 spots taken"; Join waitlist opens picture 12; Just keep me on the list; Zoe backs out and Reese
 *      (paid, first in line) moves in by itself.
 *   G  Cancel or reschedule (picture 30) on Home: Reschedule ("Rescheduled. Pick your dates again"), then Cancel (the plain Canceled card).
 *   H  7 locked in after Pay by: the plain warning on the organizer's card, nobody taken off.
 *   I  Every ticket screen at 390, 360 and 320 wide, light and dark: nothing wider than the screen, nothing sticking out, every list row on one
 *      line (Christopher Vanderberg too).
 *   J  Nobody else gets it: switched off, players get no tournament at all; a canceled one shows only to the players on its list.
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

  // ---------------------------------------------------------------- A  the seed
  await check('A seed: the Winter Classic at Date picked for Everyone, 8 on the list, Thu Dec 17; Home shows Open tickets', async () => {
    const t = d.tournament;
    assert(t && t.status === 'date_picked' && t.visibility === 'all' && t.signups.length === 8 && t.finalDate === '2026-12-17', JSON.stringify(t && { s: t.status, v: t.visibility, n: t.signups.length, f: t.finalDate }));
    assert(t.payBy === '2026-12-16T00:00:00.000Z', `Open tickets starts with Tue Dec 15, 7:00 PM: ${t.payBy}`);
    const a = await adminPage();
    await a.page.locator('[data-tm-open-tickets]').waitFor({ timeout: 15000 });
    await shot(a.page, 'A-admin-29');
    assert(a.errors.length === 0, a.errors.join(' | '));
    await a.ctx.close();
  });

  // ---------------------------------------------------------------- B  open tickets
  await check('B Open tickets from Home: Pay by Tue 7:00 PM; the Home line says Tickets: 0 of 8 locked in', async () => {
    const a = await adminPage();
    await a.page.locator('[data-tm-open-tickets]').click();
    const go = a.page.locator('[data-tm-pay-go]');
    await go.waitFor({ timeout: 10000 });
    const sheet = flat(await sheetOpen(a.page).innerText());
    assert(/Pay by/i.test(sheet), sheet);
    await shot(a.page, 'B-open-tickets-sheet');
    await go.click();
    await a.page.locator('[data-tickets-card]').waitFor({ timeout: 15000 });
    assert((await a.page.locator('[data-tickets-card]').getAttribute('data-tickets-card')) === '0/8', 'the Home line');
    assert(flat(await a.page.locator('[data-tickets-card]').innerText()).includes('Tickets: 0 of 8 locked in'), 'the words');
    await shot(a.page, 'B-admin-tickets-open');
    assert(a.errors.length === 0, a.errors.join(' | '));
    await a.ctx.close();
    d = await dash();
    assert(d.tournament.status === 'tickets' && d.tournament.payBy === '2026-12-16T00:00:00.000Z', JSON.stringify({ s: d.tournament.status, p: d.tournament.payBy }));
  });

  // ---------------------------------------------------------------- C  lock my spot, the Pay sheet, I paid
  await check('C Parker: Lock my spot opens the site\'s Pay sheet (Pay Alex $16, Venmo, I paid); I paid waits for Alex', async () => {
    const p = await playerPage('Parker');
    const card = p.page.locator('.tc').first();
    await card.waitFor({ timeout: 15000 });
    const words = flat(await card.innerText());
    assert(/tickets open/i.test(words) && words.includes('2 hours · Pay by Tue 7:00 PM') && words.includes('Lock my spot · $16') && words.includes('See who’s in'), words);
    await card.locator('[data-tc-lock]').click();
    const pay = p.page.locator('[data-pay-sheet]');
    await pay.waitFor({ timeout: 10000 });
    const sheet = flat(await sheetOpen(p.page).innerText());
    assert(sheet.includes('Pay Alex $16') && sheet.includes('Have the Venmo app? Click here') && /Copy Venmo/.test(sheet) && sheet.includes('I paid'), sheet);
    await shot(p.page, 'C-pay-sheet');
    await p.page.locator('[data-sheet-paid]').click();
    await p.page.locator('.tc').filter({ hasText: 'Waiting for Alex to confirm' }).waitFor({ timeout: 10000 });
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
    assert((await a.page.locator('[data-tickets-card]').getAttribute('data-tickets-card')) === '1/8', 'the Home line');
    await a.ctx.close();
    const p = await playerPage('Parker');
    const words = flat(await p.page.locator('.tc').first().innerText());
    assert(/you’re in/i.test(words) && words.includes('2 hours · You’re locked in') && words.includes('See who’s in') && words.includes('Drop out'), words);
    await shot(p.page, 'D-parker-locked-in');
    await p.ctx.close();
  });

  // ---------------------------------------------------------------- E  back out after paying
  await check('E Parker backs out after paying: the words say the $16 comes back as credit, and it does', async () => {
    const p = await playerPage('Parker');
    await p.page.locator('.tc [data-tc-drop]').first().click();
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

  // ---------------------------------------------------------------- F  spots full, the waitlist
  await check('F spots full: Vic sees "8 spots taken"; Join waitlist opens picture 12; Just keep me on the list keeps Vic second', async () => {
    await stage('spots_full');
    const p = await playerPage('Vic');
    const card = p.page.locator('.tc').first();
    const words = flat(await card.innerText());
    assert(/8 spots taken/i.test(words) && words.includes('Join the waitlist in case someone drops') && words.includes('Join waitlist'), words);
    await card.locator('[data-tc-join]').click();
    await p.page.locator('dialog[open] [data-tc-keep]').waitFor({ timeout: 10000 });
    const overlay = flat(await sheetOpen(p.page).innerText());
    assert(overlay.includes('You’re second on the waitlist') && overlay.includes('Hold my spot · $16') && overlay.includes('Just keep me on the list'), overlay);
    assert(overlay.includes('If someone drops, you’re locked into that spot.') && overlay.includes('If a spot opens, whoever pays first gets it.'), overlay);
    await shot(p.page, 'F-waitlist-overlay');
    await p.page.locator('dialog[open] [data-tc-keep]').click();
    await p.page.locator('dialog[open] [data-tc-keep]').waitFor({ state: 'detached', timeout: 10000 });
    await p.page.waitForTimeout(400);
    const after = flat(await p.page.locator('.tc').first().innerText());
    assert(/waitlist/i.test(after) && after.includes('You’re second on the waitlist'), after);
    assert(p.errors.length === 0, p.errors.join(' | '));
    await p.ctx.close();
  });
  await check('F Zoe backs out: Reese (paid, first in line) moves into the spot by itself; Vic (unpaid) stays in line, now first', async () => {
    const zoe = await phone('Zoe');
    const out = await zoe.post('/api/tournament/back-out', { tournamentId: (await dash()).tournament.id, backCents: 1600 });
    await zoe.close();
    assert(out.status === 200 && out.data.result === 'backed_out', JSON.stringify(out));
    d = await dash();
    const reese = d.tournament.tickets.find((k) => k.name === 'Reese');
    assert(reese && reese.place === 'spot', JSON.stringify(reese));
    const p = await playerPage('Reese');
    assert(/you’re in/i.test(flat(await p.page.locator('.tc').first().innerText())), 'Reese sees You\'re in');
    await p.ctx.close();
    const v = (await answerOf('Vic')).data.tournament.tickets;
    assert(v.line.length === 1 && v.line[0].me && !v.line[0].paid, JSON.stringify(v.line));
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
    assert((await a.page.locator('[data-tickets-card]').getAttribute('data-tickets-card')) === '7/8', 'the Home line');
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
        await p.page.locator('.tc [data-tc-who]').first().click();
        await p.page.locator('dialog[open] [data-tw-in]').waitFor({ timeout: 10000 });
        await p.page.waitForTimeout(300);
        await fits(p.page, 'dialog[open] .tc-tw');
        await oneLineRows(p.page, 'dialog[open] .tc-tw-rows li');
        const rows = flat(await p.page.locator('dialog[open] [data-tw-in]').innerText());
        assert(/6 of 8/i.test(rows) && rows.includes('Christopher Vanderberg') && rows.includes('Pay to lock in') && rows.includes('Open spot'), rows);
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
      await check(`I spots full: Vic's card and picture 12, Zoe's picture 11 (locked in, Drop out on the row) fit, rows on one line (${width} ${scheme})`, async () => {
        await stage('spots_full');
        const v = await playerPage('Vic', { width, scheme });
        await fits(v.page, '.tc');
        await v.page.locator('.tc [data-tc-join]').first().click();
        await v.page.locator('dialog[open] [data-tc-keep]').waitFor({ timeout: 10000 });
        await v.page.waitForTimeout(300);
        await fits(v.page, 'dialog[open] .tc-tw');
        await oneLineRows(v.page, 'dialog[open] .tc-tw-rows li');
        await shot(v.page, `I-overlay12-${width}-${scheme}`);
        assert(v.errors.length === 0, v.errors.join(' | '));
        await v.ctx.close();
        const z = await playerPage('Zoe', { width, scheme });
        await z.page.locator('.tc [data-tc-who]').first().click();
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
      await check(`I organizer: Home's ticket card and line, the Tickets page and picture 30 fit (${width} ${scheme})`, async () => {
        await stage('spots_full');
        const a = await adminPage({ width, scheme });
        await a.page.locator('[data-tickets-card]').waitFor({ timeout: 15000 });
        await fits(a.page, 'main');
        await shot(a.page, `I-admin-home-${width}-${scheme}`);
        await a.page.locator('[data-tickets-open]').click();
        await a.page.locator('dialog[open] [data-tm-card="tickets"]').waitFor({ timeout: 10000 });
        await a.page.waitForTimeout(300);
        await fits(a.page, 'dialog[open]');
        const list = flat(await a.page.locator('dialog[open] [data-tm-card="tickets"]').innerText());
        assert(list.includes('Christopher Vanderberg') && /8 of 8 locked in/i.test(list), list);
        await oneLineRows(a.page, 'dialog[open] [data-tm-ticket-row]');
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
        await v.page.locator('.tc [data-tc-drop]').first().click();
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

  // ---------------------------------------------------------------- J  nobody else gets it
  await check('J switched off while tickets are open: players get no tournament at all (no key, no name, no ticket words)', async () => {
    await stage('spots_full');
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
    await stage('spots_full');
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
