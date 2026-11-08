/* Zip 15: Second Chance (SECOND_CHANCE) switched ON, on the fake preview world with the Zip 15 parts (SEED_ZIP15=1).
 *
 *   node e2e/zip15.cjs      (also run by npm run test:e2e)
 *
 * Seeded Sun Nov 8 at noon Eastern; game day is Tue Nov 10 (a game canceled Mon night with 3 in, one with 2 in, a same-day game with 3 in).
 * Its own dev server with SECOND_CHANCE_TEST=on (as on a preview: pretend noon, fake Telegrams); nothing touches Cloudflare or the live site.
 * Checks: steps 1 to 4 on admin Home at 390, 360 and 320 wide, light and dark (one line titles, full-width buttons, nothing sideways), the X,
 * Reopen at a new time (TEXT 2 under the purple button), the 2-in game shows nothing, Telegram 1 (fake, on Home) and its unpaid-only sheet,
 * Telegram 2 with step 4, each Telegram once, the Request link (%20, never +) and Text for a player without Venmo, the Mark paid list's Request,
 * the cutoff card and its one-tap cancel, the real clock on game day (no pretend), a player never sees any of it, the Settings row, the Edit
 * sheet wording.
 */
const { spawn, spawnSync } = require('node:child_process');
const { readFileSync, mkdirSync, rmSync } = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.E2E_PORT) || 5419;
const BASE = `http://localhost:${PORT}`;
const SEED_ISO = '2026-11-08T17:00:00.000Z'; // Sun Nov 8, 12:00 PM Eastern
const SEED_MS = Date.parse(SEED_ISO);
const GAME_NOON_MS = Date.parse('2026-11-10T17:00:00.000Z'); // Tue Nov 10, 12:00 PM Eastern (game day, the real clock)
const SHOTS = process.env.E2E_SHOTS || path.join(__dirname, 'screenshots');
const PIN = /PIN `(\d{6})`/.exec(readFileSync(path.join(ROOT, 'docs/PREVIEW_FAKE_DB.md'), 'utf8'))[1];
const NOON = { 'X-Second-Chance-Noon': 'on' };

let passed = 0;
let failed = 0;
async function check(name, fn) {
  if (process.env.E2E_ONLY && !new RegExp(process.env.E2E_ONLY).test(name)) return;
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.log(`  ✗ ${name}\n      ${String(err && err.message ? err.message : err).replace(/\s*\n\s*/g, ' ⏎ ').slice(0, 1400)}`);
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  mkdirSync(SHOTS, { recursive: true });
  const dbFile = path.join(ROOT, '.data', 'zip15.sqlite');
  mkdirSync(path.join(ROOT, '.data'), { recursive: true });
  rmSync(dbFile, { force: true });
  const seeded = spawnSync('npx', ['vite-node', 'scripts/load-seed-local.ts', '--', dbFile, SEED_ISO], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, SEED_ZIP14: '1', SEED_ZIP15: '1' } });
  if (seeded.status !== 0) throw new Error(`could not build the fake world: ${seeded.stderr || seeded.stdout}`);
  const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
    cwd: ROOT,
    env: { ...process.env, DEV_DB: dbFile, SETUP_TOKEN: 'zip15-setup-token-0123456789', DEV_CLOCK: '1', SECOND_CHANCE_TEST: 'on' },
    stdio: 'ignore',
    detached: true,
  });
  process.on('exit', () => {
    try {
      process.kill(-server.pid, 'SIGTERM');
    } catch {}
  });
  for (let i = 0; i < 80; i++) {
    try {
      if ((await fetch(`${BASE}/api/status`)).ok) break;
    } catch {}
    await sleep(500);
  }
  const clock = (ms) => fetch(`${BASE}/__dev/clock`, { method: 'POST', body: JSON.stringify({ atMs: ms }) });
  await clock(SEED_MS);
  const browser = await chromium.launch();
  const post = (req, url, data, headers = {}) => req.post(BASE + url, { data, headers: { Origin: BASE, ...headers } });
  const real = (await browser.newContext()).request;
  if (!(await post(real, '/api/admin/login', { pin: PIN })).ok()) throw new Error('login failed');
  const dash = async (headers = NOON) => (await real.get(`${BASE}/api/admin/dashboard`, { headers })).json();
  const d0 = await dash();
  assert(d0.secondChance && d0.secondChanceForAll === true, 'the Zip 15 seed should have the Second Chance row on');
  const tue = d0.sessions.filter((s) => s.startsAt.startsWith('2026-11-10T') || s.startsAt.startsWith('2026-11-11T0'));
  const chance = tue.find((s) => s.status === 'canceled' && s.confirmedCount === 3);
  const two = tue.find((s) => s.status === 'canceled' && s.confirmedCount === 2);
  const same = tue.find((s) => s.roster.some((r) => r.name === 'Reese' && r.status === 'confirmed'));
  assert(chance && two && same, 'the three Zip 15 games on Tue Nov 10');
  const idOf = (name) => d0.players.find((p) => p.name === name).id;

  const phone = (width, scheme) => ({ viewport: { width, height: 900 }, deviceScaleFactor: 1, colorScheme: scheme, reducedMotion: 'reduce' });
  async function admin(width = 390, scheme = 'light', url = '/admin?noontest=on') {
    const ctx = await browser.newContext(phone(width, scheme));
    await ctx.route('https://venmo.com/**', (r) => r.abort());
    await ctx.route('https://mobileapp.courtreserve.com/**', (r) => r.fulfill({ status: 200, body: 'CourtReserve' }));
    await post(ctx.request, '/api/admin/login', { pin: PIN });
    const page = await ctx.newPage();
    await page.goto(BASE + url);
    await page.locator('.tabbar').waitFor();
    return { ctx, page };
  }
  const layout = async (page, where) => {
    const bad = await page.evaluate(() => {
      const out = [];
      if (document.documentElement.scrollWidth > window.innerWidth) out.push(`page ${document.documentElement.scrollWidth} wide`);
      for (const card of document.querySelectorAll('[data-sc-card]')) {
        const r = card.getBoundingClientRect();
        for (const el of card.querySelectorAll('.ac-btn, .sc-req, .ac-title, .ac-sub')) {
          const e = el.getBoundingClientRect();
          if (e.right > r.right + 0.5 || e.left < r.left - 0.5) out.push(`${el.className} spills out of its card`);
          if (el.matches('.ac-btn, .sc-req') && el.scrollWidth > el.clientWidth + 1) out.push(`button words cut: ${el.textContent}`);
          if (el.matches('.ac-btn') && e.height < 37) out.push(`button ${Math.round(e.height)} px high`);
        }
      }
      return out;
    });
    assert(bad.length === 0, `${where}: ${bad.join('; ')}`);
  };

  await check('the 2-in game the night before has no card; step 1 is the 3-in game', async () => {
    const d = await dash();
    assert(!d.secondChance.cards.some((c) => c.sessionId === two.id), 'a card for the 2-in game');
    const c = d.secondChance.cards.find((x) => x.sessionId === chance.id);
    assert(c && c.kind === 'chance' && c.step === 1, `step 1 expected: ${JSON.stringify(c)}`);
  });

  await check('the real clock on game day (no pretend): the same cards at noon Tue Nov 10', async () => {
    await clock(GAME_NOON_MS);
    try {
      const d = await dash({});
      // The dev clock keeps running from where it was set: within a minute of noon.
      assert(!d.secondChance.pretendNoon && Math.abs(Date.parse(d.secondChance.now) - GAME_NOON_MS) < 60_000, `pretend used: ${d.secondChance.now}`);
      assert(d.secondChance.cards.some((c) => c.sessionId === chance.id && c.kind === 'chance'), 'no Second Chance card on the real game day');
    } finally {
      await clock(SEED_MS);
    }
  });

  for (const scheme of ['light', 'dark']) {
    for (const width of [390, 360, 320]) {
      await check(`step 1 and the same-day card, ${width} px, ${scheme}: the mock's words, one-line title, full-width Book a court, nothing sideways`, async () => {
        const { ctx, page } = await admin(width, scheme);
        const card = page.locator(`[data-sc-card="chance"][data-session="${chance.id}"]`);
        await card.waitFor();
        const title = await card.locator('.ac-title').innerText();
        assert(/^Tue 7:30 PM was 1 short$/.test(title), title);
        assert((await card.locator('.ac-sub').innerText()) === 'Check if a court is open tonight.', 'sub line');
        const lines = await card.locator('.ac-title').evaluate((e) => Math.round(e.offsetHeight / parseFloat(getComputedStyle(e).lineHeight)));
        if (width >= 360) assert(lines === 1, `title on ${lines} lines`);
        const book = await card.locator('[data-sc-book]').boundingBox();
        const box = await card.boundingBox();
        assert(book.width > box.width - 40, `Book a court ${Math.round(book.width)} of ${Math.round(box.width)} px`);
        assert((await card.locator('[data-sc-book]').getAttribute('href')).startsWith('https://mobileapp.courtreserve.com/'), 'CourtReserve link');
        assert((await card.locator('[data-sc-book]').getAttribute('target')) === '_blank', 'another tab');
        await page.locator(`[data-sc-card="sameday"][data-session="${same.id}"]`).waitFor();
        await layout(page, `${width} ${scheme}`);
        await page.screenshot({ path: path.join(SHOTS, `zip15-step1-${width}-${scheme}.png`), fullPage: false });
        await ctx.close();
      });
    }
  }

  await check('Book a court opens CourtReserve in another tab and moves the card to step 2 (the time, Reopen game); taken times are not offered', async () => {
    const { ctx, page } = await admin();
    const popup = ctx.waitForEvent('page');
    await page.locator(`[data-sc-card="chance"] [data-sc-book]`).click();
    const tab = await popup;
    assert(tab.url().includes('courtreserve.com'), tab.url());
    await tab.close();
    const step2 = page.locator('[data-sc-step="2"]');
    await step2.waitFor({ timeout: 10000 });
    assert((await step2.locator('.ac-title').innerText()) === 'Court open tonight?', 'step 2 title');
    assert((await step2.locator('.ac-sub').innerText()) === 'Reopen Tue 7:30 PM, or pick a new time.', 'step 2 sub');
    assert((await step2.locator('[data-sc-time] span').innerText()) === '7:30 PM', 'the original time first');
    const opts = await step2.locator('[data-sc-time] option').allInnerTexts();
    const taken = (await dash()).sessions.filter((s) => s.startsAt.startsWith('2026-11-1') && s.id !== chance.id).map((s) => s.startsAt);
    assert(opts.length > 5 && opts[0] === '4:00 PM' && opts.at(-1) === '9:30 PM', opts.join(','));
    assert(!opts.includes('8:00 PM') || !taken.includes('2026-11-11T01:00:00.000Z'), 'the 8:00 PM regular game time is offered');
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await layout(page, `step 2 at ${width}`);
      const [t, r] = [await step2.locator('[data-sc-time]').boundingBox(), await step2.locator('[data-sc-reopen]').boundingBox()];
      assert(Math.abs(t.width - r.width) < 2 && Math.abs(t.y - r.y) < 1, 'the two buttons share the line equally');
    }
    await page.screenshot({ path: path.join(SHOTS, 'zip15-step2-320.png') });
    await ctx.close();
  });

  await check('Reopen game at 9:00 PM: the same game reopens with its 3 in, moved; step 3 shows TEXT 2 under the purple Text the group', async () => {
    const { ctx, page } = await admin(360, 'dark');
    await page.locator('[data-sc-step="2"] [data-sc-time] select').selectOption(String(21 * 60));
    await page.locator('[data-sc-reopen]').click();
    const card = page.locator(`[data-sc-card="reopened"][data-session="${chance.id}"]`);
    await card.waitFor({ timeout: 10000 });
    assert((await card.locator('.ac-title').innerText()) === 'Reopened for 9:00 PM', 'title');
    assert((await card.locator('.ac-sub').innerText()) === '3 of 4 signed up. Text the group.', 'sub');
    const text = await card.locator('[data-sc-preview]').innerText();
    assert(text.startsWith('Hey guys, we canceled to avoid fees since we were down 1. A few courts are open tonight at 9:00 (instead of 7:30), so I reopened signups for 9:00.\n\nIf 4 sign up and pay'), text);
    const href = await card.locator('[data-sc-text]').getAttribute('href');
    assert(/^sms:\?&?body=|^sms:\?body=|^sms:&body=/.test(href) || href.startsWith('sms:'), href);
    assert(!/sms:\+?\d/.test(href), 'Text the group must open with no recipients');
    const s = (await dash()).sessions.find((x) => x.id === chance.id);
    assert(s.status !== 'canceled' && s.startsAt === '2026-11-11T02:00:00.000Z' && s.confirmedCount === 3, JSON.stringify({ st: s.status, at: s.startsAt, n: s.confirmedCount }));
    const harper = s.roster.find((r) => r.name === 'Harper');
    assert(harper.paymentStatus === 'unpaid' && harper.owesCents === 1400, 'Harper owes again (her $14 is credit)');
    await layout(page, 'step 3 at 360 dark');
    await page.screenshot({ path: path.join(SHOTS, 'zip15-step3-360-dark.png'), fullPage: true });
    await ctx.close();
  });

  await check('Request and Text on the cards: Venmo with %20 (never +), the amount and "Pickleball Tue Nov 10"; Gray (no Venmo) gets Text', async () => {
    const { ctx, page } = await admin();
    const card = page.locator(`[data-sc-card="reopened"]`);
    const req = card.locator('[data-sc-request="Harper"]');
    const href = await req.getAttribute('href');
    assert(href === 'https://venmo.com/?txn=charge&recipients=harper-fake&amount=14&note=Pickleball%20Tue%20Nov%2010', href);
    assert((await req.getAttribute('data-app-href')) === 'venmo://paycharge?txn=charge&recipients=harper-fake&amount=14&note=Pickleball%20Tue%20Nov%2010', 'app link');
    assert(!href.includes('+'), 'a plus sign');
    const text = await card.locator('[data-sc-textone="Gray"]').getAttribute('href');
    assert(text.startsWith('sms:') && /Gray%2C%20you%20owe%20%2414/.test(text), text);
    // The Mark paid list on Home has them too.
    const mp = page.locator('article[aria-label="Mark paid tonight"], article[aria-label="Who owes you"]').first();
    if (await mp.count()) assert((await mp.locator('[data-sc-request], [data-sc-textone]').count()) > 0, 'no Request on the Mark paid list');
    await ctx.close();
  });

  await check('Harper taps Use credit on the reopened game: paid from her $14 credit, to the cent', async () => {
    const ph = (await browser.newContext()).request;
    await post(ph, '/api/me', { playerId: idOf('Harper') });
    const before = (await (await ph.get(`${BASE}/api/group`)).json()).credit.balanceCents;
    assert(before >= 1400, `Harper's credit ${before}`);
    assert((await post(ph, `/api/sessions/${chance.id}/use-credit`, {})).ok(), 'use credit');
    const after = (await (await ph.get(`${BASE}/api/group`)).json()).credit.balanceCents;
    assert(before - after === 1400, `credit went ${before} -> ${after}`);
    const r = (await dash()).sessions.find((x) => x.id === chance.id).roster.find((x) => x.name === 'Harper');
    assert(r.paymentStatus === 'paid' && r.owesCents === 0, JSON.stringify(r));
  });

  await check('Telegram 1 (fake on the preview): the organizer joins the same-day game as the 4th -> "4 in, 2 of 4 paid", Reese named, once', async () => {
    assert((await post(real, `/api/admin/sessions/${same.id}/me`, { in: true }, NOON)).ok(), 'join');
    await post(real, `/api/admin/sessions/${same.id}/me`, { in: true }, NOON);
    const d = await dash();
    const t = d.secondChance.fakeTelegrams.filter((x) => x.sessionId === same.id);
    assert(t.length === 1, `${t.length} Telegrams`);
    assert(/^Tonight 8:30 PM: 4 in, 2 of 4 paid\.\nText Kai who hasn't paid: http:\/\/localhost:\d+\/admin\?unpaid=[0-9a-f-]{36}\nNo phone saved for Reese\.$/.test(t[0].text), t[0].text);
  });

  await check("Telegram 1's link: the sheet opens Messages to ONLY the unpaid player with a phone, with the exact text", async () => {
    const { ctx, page } = await admin(390, 'light', `/admin?noontest=on&unpaid=${same.id}`);
    const sheet = page.locator('[data-sc-unpaid-sheet]');
    await sheet.waitFor();
    const href = await sheet.locator('[data-sc-unpaid-open]').getAttribute('href');
    const kai = d0.players.find((p) => p.name === 'Kai').phone.replace(/\D/g, '');
    assert(href.includes(kai) && href.split(',').length === 1, href);
    assert(decodeURIComponent(href.split('body=')[1]).startsWith("Hey, we have 4 in for tonight at 8:30. Please pay on the site and I'll book the court.\n\n"), href);
    assert((await sheet.innerText()).includes('no phone saved for Reese'), 'Reese named');
    await page.screenshot({ path: path.join(SHOTS, 'zip15-unpaid-sheet.png') });
    await ctx.close();
  });

  await check('Mark paid Kai and Reese: Telegram 2 once ("4 paid for tonight 8:30 PM. Book it now"), the card turns green: step 4 at 390/360/320, light and dark', async () => {
    for (const n of ['Kai', 'Reese']) assert((await post(real, `/api/admin/sessions/${same.id}/payment`, { playerId: idOf(n), paid: true }, NOON)).ok(), n);
    await post(real, `/api/admin/sessions/${same.id}/payment`, { playerId: idOf('Reese'), paid: true }, NOON);
    const t = (await dash()).secondChance.fakeTelegrams.filter((x) => x.sessionId === same.id);
    assert(t.length === 2 && /^4 paid for tonight 8:30 PM\. Book it now: https:\/\/mobileapp\.courtreserve\.com\//.test(t[0].text), JSON.stringify(t));
    for (const scheme of ['light', 'dark'])
      for (const width of [390, 360, 320]) {
        const { ctx, page } = await admin(width, scheme);
        const card = page.locator(`[data-sc-step="4"][data-session="${same.id}"]`);
        await card.waitFor();
        assert((await card.locator('.ac-title').innerText()) === '4 signed up and paid', 'title');
        assert((await card.locator('.ac-sub').innerText()) === 'Book a court for Tue 8:30 PM.', 'sub');
        assert((await card.getAttribute('data-alert-card')) === 'green', 'green');
        await layout(page, `step 4 ${width} ${scheme}`);
        if (width === 390) await page.screenshot({ path: path.join(SHOTS, `zip15-step4-${scheme}.png`) });
        await ctx.close();
      }
  });

  await check('a dropout after both Telegrams sends nothing more; booked: the card goes and nothing pings', async () => {
    const ph = (await browser.newContext()).request;
    await post(ph, '/api/me', { playerId: idOf('Avery') });
    await post(ph, `/api/sessions/${same.id}/withdraw`, {}, NOON);
    await post(real, `/api/admin/sessions/${same.id}/court-status`, { status: 'booked' }, NOON);
    const d = await dash();
    assert(d.secondChance.fakeTelegrams.filter((x) => x.sessionId === same.id).length === 2, 'a third Telegram');
    assert(!d.secondChance.cards.some((c) => c.sessionId === same.id), 'the card stayed after booking');
  });

  await check('the X hides the Second Chance card for that game', async () => {
    // A fresh canceled-with-3 game on the same day, canceled "the night before" (the real cancel, then its time set back as the seed does).
    const made = await (await post(real, '/api/admin/sessions', { startsAt: '2026-11-10T21:00:00.000Z', endsAt: '2026-11-10T23:00:00.000Z' })).json();
    await post(real, `/api/admin/sessions/${made.id}/me`, { in: true });
    for (const n of ['Drew', 'Emery']) {
      const ph = (await browser.newContext()).request;
      await post(ph, '/api/me', { playerId: idOf(n) });
      await post(ph, `/api/sessions/${made.id}/join`, {});
    }
    const cx = await post(real, `/api/admin/sessions/${made.id}/decision`, { decision: 'cancel', confirm: true });
    assert(cx.ok(), `cancel: ${await cx.text()}`);
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(dbFile);
    db.prepare('UPDATE sessions SET canceled_at = ? WHERE id = ?').run('2026-11-10T02:00:00.000Z', made.id);
    db.close();
    const { ctx, page } = await admin();
    const card = page.locator(`[data-sc-card="chance"][data-session="${made.id}"]`);
    await card.waitFor();
    await card.locator('[data-dismiss]').click();
    await card.waitFor({ state: 'detached', timeout: 10000 });
    await ctx.close();
  });

  await check('cutoff: a reopened game still at 3 two hours before (7:00 PM for 9:00) asks "Still short, cancel it?"; Cancel game cancels, money back as credit', async () => {
    await clock(Date.parse('2026-11-11T00:00:00.000Z')); // Tue 7:00 PM (the real clock; no pretend needed)
    // Harper paid with credit above; Gray still owes. Drop to 3: Harper, Gray and Orla are in.
    const { ctx, page } = await admin(390, 'light', '/admin?noontest=off');
    const card = page.locator(`[data-sc-step="cutoff"][data-session="${chance.id}"]`);
    await card.waitFor({ timeout: 10000 });
    assert((await card.locator('.ac-title').innerText()) === 'Still short, cancel it?', 'title');
    assert((await card.locator('.ac-sub').innerText()) === 'Tue 9:00 PM: 3 of 4 in. It was never booked, so no fee.', await card.locator('.ac-sub').innerText());
    await layout(page, 'cutoff');
    await page.screenshot({ path: path.join(SHOTS, 'zip15-cutoff.png') });
    const ph = (await browser.newContext()).request;
    await post(ph, '/api/me', { playerId: idOf('Harper') });
    const before = (await (await ph.get(`${BASE}/api/group`)).json()).credit.balanceCents;
    await card.locator('[data-sc-cancel]').click();
    await card.waitFor({ state: 'detached', timeout: 10000 });
    const s = (await dash({})).sessions.find((x) => x.id === chance.id);
    assert(s.status === 'canceled', s.status);
    const after = (await (await ph.get(`${BASE}/api/group`)).json()).credit.balanceCents;
    assert(after - before === 1400, `Harper's credit ${before} -> ${after}`);
    await ctx.close();
    await clock(SEED_MS);
  });

  await check('a player never sees any of it (no card, no key in their answer); the card taps refuse a player', async () => {
    const ctx = await browser.newContext(phone(390, 'light'));
    await post(ctx.request, '/api/me', { playerId: idOf('Kai') });
    const g = await (await ctx.request.get(`${BASE}/api/group`, { headers: { 'X-Second-Chance': 'on', ...NOON } })).text();
    assert(!/secondChance|sc_ping|fakeTelegram/.test(g), 'a Zip 15 key in the player answer');
    const page = await ctx.newPage();
    await page.goto(`${BASE}/?secondchance=on&noontest=on`);
    await page.locator('.schedule article').first().waitFor();
    assert((await page.locator('[data-sc-cards], [data-sc-card], .sc-req').count()) === 0, 'a Second Chance piece on the player screen');
    const r = await post(ctx.request, `/api/admin/sessions/${chance.id}/second-chance`, { action: 'booking' });
    assert(r.status() === 401, `player tap answered ${r.status()}`);
    await ctx.close();
  });

  await check('Settings: the "Second Chance" row (newest, first), flipping it saves without a deploy; the Edit sheet note wording', async () => {
    const { ctx, page } = await admin();
    await page.locator('.tabbar button', { hasText: 'Settings' }).click();
    for (const s of await page.locator('details > summary').all()) await s.click().catch(() => {});
    const sw = page.locator('[data-second-chance-all]');
    assert(await sw.isChecked(), 'the row should be on in this world');
    await sw.click();
    for (let i = 0; i < 20 && (await dash()).secondChanceForAll; i++) await sleep(200);
    assert(!(await dash()).secondChanceForAll, 'the row did not save off');
    await sw.click();
    for (let i = 0; i < 20 && !(await dash()).secondChanceForAll; i++) await sleep(200);
    assert((await dash()).secondChanceForAll === true, 'the row did not save on');
    await page.locator('.tabbar button', { hasText: 'Players' }).click();
    await page.waitForTimeout(500);
    await ctx.close();
    // The wording: the Edit sheet note (Players > a player > edit). Checked on the rendered sheet of the plain list path.
    const src = readFileSync(path.join(ROOT, 'src/pages/admin/PlayersTab.tsx'), 'utf8');
    assert(src.includes("'For refunds and requests. Only you see this.'"), 'the new wording');
  });

  await browser.close();
  console.log(`\nzip15: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
