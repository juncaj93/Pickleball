/* Zip 63 (🎾63.tickets): the gold-ball ticket card, Standby, the pay countdown and Remind all unpaid, in a real browser.
 *
 *   node e2e/zip63.cjs      (also run by npm run test:e2e)
 *
 * The world is the preview's calm profile as of Tue Nov 17 2026, 10:00 AM Eastern, with the Tournament test page's stages (server/tournamentTest.ts).
 *   A  the card (mocks 00 to 07): top line, name, format, one ball per player who can make the date, gold = locked in, the lime button, "Pay by 12/16";
 *      390/360/320, light and dark, nothing wraps or sticks out, no em dashes
 *   B  3, 8, 10, 12, 14 and 16 balls stay on ONE row at 420/390/360/320; the sizes at 420 are the mocks' (26, 22, 19, 17 px)
 *   C  a ball that turns gold while the card is open pops and glows (the 7th, in the order people pay); none with reduced motion
 *   D  before a date: one ball per sign-up and no gold; Edit sign-up and Drop out are in the card's overlay once tickets open
 *   E  every spot taken (the hidden cap, stood in): "Join standby", standby wording everywhere, never "waitlist"
 *   F  the countdown at each moment (3 days, 2 days, tomorrow, today, hours, minutes, late), the tone, the button, Pay opens the Pay sheet; late with no
 *      spot free and a paid player: no countdown
 *   G  the organizer's Remind all unpaid card (mock 14): the chip, the rows, Messages with the unpaid numbers and the text; hidden when all paid
 *   H  who can see it: Only me and the switch off send no tournament data at all
 *   I  the card's loading placeholder has the site's shimmer (.skel)
 * Screenshots: .data/zip63-shots (not in git).
 */
const { spawn, spawnSync } = require('node:child_process');
const { readFileSync, mkdirSync, rmSync } = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.E2E_PORT) || 5463;
const BASE = `http://localhost:${PORT}`;
const SEED_ISO = '2026-11-17T14:00:00.000Z';
const NOW_MS = Date.parse('2026-11-17T15:00:00.000Z'); // Tue Nov 17, 10:00 AM Eastern
const PIN = /PIN `(\d{6})`/.exec(readFileSync(path.join(ROOT, 'docs/PREVIEW_FAKE_DB.md'), 'utf8'))[1];
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const SHOTS = path.join(ROOT, '.data', 'zip63-shots');

let passed = 0;
let failed = 0;
const ONLY = process.env.ZIP63_ONLY || '';
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
  const dbFile = path.join(ROOT, '.data', 'zip63.sqlite');
  mkdirSync(SHOTS, { recursive: true });
  rmSync(dbFile, { force: true });
  const seeded = spawnSync('npx', ['vite-node', 'scripts/load-small-local.ts', '--', dbFile, SEED_ISO, '--calm', '--zip55', '--zip60'], { cwd: ROOT, encoding: 'utf8' });
  if (seeded.status !== 0) throw new Error(`could not build the calm world: ${seeded.stderr || seeded.stdout}`);
  if (await fetch(`${BASE}/api/status`).then((r) => r.ok, () => false)) throw new Error(`port ${PORT} is already in use`);
  const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
    cwd: ROOT,
    env: { ...process.env, DEV_DB: dbFile, SETUP_TOKEN: 'zip63-setup-token-0123456789', DEV_CLOCK: '1', PREVIEW_CALM: 'on', PB_PREVIEW_BUILD: '1' },
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
    await v.page.locator('.tc-hero').first().waitFor({ timeout: 20000 });
    return v;
  }
  const cardOneLine = async (page) => oneLine(page, '.tc-hero .tc-kicker, .tc-hero .tc-format, .tc-hero .tc-btn, .tc-foot, .tc-hero .tc-link');
  /** Every ball's top: one row means one top. */
  const ballRow = (page) =>
    page.evaluate(() => {
      const balls = [...document.querySelectorAll('.tc-hero .tc-ball')];
      const row = document.querySelector('.tc-hero .tc-balls');
      const box = row ? row.getBoundingClientRect() : null;
      return {
        n: balls.length,
        gold: balls.filter((b) => b.classList.contains('tc-gold')).length,
        tops: [...new Set(balls.map((b) => Math.round(b.getBoundingClientRect().top)))],
        size: balls[0] ? +balls[0].getBoundingClientRect().width.toFixed(1) : 0,
        right: balls.length ? Math.max(...balls.map((b) => b.getBoundingClientRect().right)) : 0,
        rowRight: box ? box.right : 0,
        card: document.querySelector('.tc-hero').getBoundingClientRect().right,
      };
    });

  // ---------------------------------------------------------------- A  the card
  await stage('tickets_open');
  for (const scheme of SCHEMES)
    for (const width of SIZES)
      await check(`A the card: top line, name, format, 9 balls with 6 gold, Lock my spot, Pay by 12/16; nothing wraps (${width} ${scheme})`, async () => {
        const v = await vicCard({ width, scheme });
        const card = v.page.locator('.tc-hero').first();
        assert(flat(await card.locator('.tc-kicker').innerText()) === 'TOURNAMENT · THU DEC 17 · ~7:30 PM', await card.locator('.tc-kicker').innerText());
        assert(flat(await card.locator('.tc-title').innerText()) === 'Winter Classic', 'the real name');
        assert(flat(await card.locator('[data-tc-lock]').innerText()) === 'Lock my spot · $16', 'the lime button');
        const foot = card.locator('.tc-foot');
        assert(flat(await foot.innerText()) === 'Pay by 12/16', await foot.innerText());
        const style = await foot.evaluate((e) => ({ tag: e.tagName, deco: getComputedStyle(e).textDecorationLine, links: e.querySelectorAll('a,button').length }));
        assert(style.tag === 'P' && style.deco === 'none' && style.links === 0, `Pay by is plain text: ${JSON.stringify(style)}`);
        const row = await ballRow(v.page);
        assert(row.n === 9 && row.gold === 6, `9 balls (who can make the date), 6 gold: ${JSON.stringify(row)}`);
        assert(row.tops.length === 1, `one row: ${row.tops}`);
        const gold = await card.locator('.tc-ball').evaluateAll((els) => els.map((e) => e.dataset.tb).join(','));
        assert(gold === 'gold,gold,gold,gold,gold,gold,ball,ball,ball', `gold fills from the left: ${gold}`);
        assert((await card.locator('.tc-stub, .tc-track, .dot, [data-tc-who], [data-tc-edit], [data-tc-drop]').count()) === 0, 'no stub, steps, empty rings, See who is in or links on the mock card');
        assert(!/\d+ of \d+|paid/i.test(flat(await card.innerText())), 'no counts on the card');
        await cardOneLine(v.page);
        await fits(v.page, '.tc-hero');
        await noDash(v.page, 'the card');
        await shot(v.page, `A-card-${width}-${scheme}`);
        assert(v.errors.length === 0, v.errors.join(' | '));
        await v.ctx.close();
      });

  // ---------------------------------------------------------------- B  10 to 16 on one row
  const MOCK_SIZE = { 3: 26, 8: 26, 10: 26, 12: 22, 14: 19, 16: 17 };
  for (const [n, g] of [[3, 1], [8, 5], [10, 3], [12, 7], [14, 9], [16, 12]])
    for (const width of [420, 390, 360, 320])
      await check(`B ${n} balls (${g} gold) on one row at ${width}`, async () => {
        const v = await newPage({ width, scheme: width === 320 ? 'dark' : 'light' });
        await v.page.goto(`${BASE}/?as=Vic&balls=${n},${g}`);
        await v.page.locator('.tc-hero').first().waitFor({ timeout: 20000 });
        const row = await ballRow(v.page);
        assert(row.n === n && row.gold === g, JSON.stringify(row));
        assert(row.tops.length === 1, `one row: ${JSON.stringify(row)}`);
        assert(row.right <= row.rowRight + 0.5 && row.right <= row.card, `inside the card: ${JSON.stringify(row)}`);
        if (width === 420) assert(Math.abs(row.size - MOCK_SIZE[n]) < 0.6, `the mock's size ${MOCK_SIZE[n]} px: ${row.size}`);
        await cardOneLine(v.page);
        await fits(v.page, '.tc-hero');
        if (width === 320 || width === 420) await shot(v.page, `B-${n}-${width}`);
        await v.page.goto(`${BASE}/?as=Vic&balls=off`);
        await v.ctx.close();
      });

  // ---------------------------------------------------------------- C  a ball turns gold while the card is open
  await check('C the 7th payer: the 7th ball turns gold with the pop and glow (motion on), steady after; reduced motion: no animation', async () => {
    await stage('tickets_open');
    const v = await vicCard({ reducedMotion: 'no-preference' });
    const calm = await newPage({});
    await calm.page.goto(`${BASE}/?as=Vic`);
    await calm.page.locator('.tc-hero').first().waitFor({ timeout: 20000 });
    const t = (await dash()).tournament;
    const zoe = (await dash()).players.find((p) => p.name === 'Zoe').id;
    await call('POST', `/api/admin/tournament/${t.id}/ticket`, { playerId: zoe, action: 'mark_paid' });
    let fresh = null;
    for (let i = 0; i < 40 && !fresh; i++) {
      await sleep(250);
      fresh = await v.page.evaluate(() => {
        const balls = [...document.querySelectorAll('.tc-hero .tc-ball')];
        const i = balls.findIndex((b) => b.classList.contains('tc-gold-new'));
        if (i < 0) return null;
        const b = balls[i];
        return { i, gold: balls.filter((x) => x.classList.contains('tc-gold')).length, anim: getComputedStyle(b).animationName, ball: getComputedStyle(b.querySelector('.ball')).animationName };
      });
    }
    assert(fresh && fresh.i === 6 && fresh.gold === 7, `the 7th ball lights: ${JSON.stringify(fresh)}`);
    assert(fresh.anim === 'tc-gold-in' && fresh.ball === 'm-ball-pop', `the glow and the site's pop: ${JSON.stringify(fresh)}`);
    await v.page.waitForTimeout(1400);
    assert((await v.page.locator('.tc-hero .tc-gold-new').count()) === 0, 'steady after');
    // Reduced motion: the same gold, no animation.
    for (let i = 0; i < 40; i++) {
      if ((await calm.page.locator('.tc-hero .tc-gold').count()) === 7) break;
      await sleep(250);
    }
    const still = await calm.page.evaluate(() => [...document.querySelectorAll('.tc-hero .tc-ball')].map((b) => getComputedStyle(b).animationName).filter((a) => a !== 'none'));
    assert(still.length === 0, `no animation with reduced motion: ${still}`);
    await v.ctx.close();
    await calm.ctx.close();
  });

  // ---------------------------------------------------------------- D  before a date; the overlay's links
  await check('D before a date: one ball per sign-up, no gold, DATE TBD; signed up: See who\'s signed up and the two links', async () => {
    await stage('vote_open');
    for (const scheme of SCHEMES)
      for (const width of SIZES) {
        const v = await vicCard({ width, scheme });
        const row = await ballRow(v.page);
        assert(row.n === 3 && row.gold === 0 && row.tops.length === 1, JSON.stringify(row));
        assert(flat(await v.page.locator('.tc-hero .tc-kicker').innerText()) === 'TOURNAMENT · DATE TBD · ~7:30 PM', 'TBD');
        assert(flat(await v.page.locator('.tc-hero .tc-format').innerText()) === 'Tournament style TBD', 'TBD style');
        assert((await v.page.locator('.tc-hero [data-tc-signup]').count()) === 1, 'Sign up');
        await cardOneLine(v.page);
        await fits(v.page, '.tc-hero');
        await shot(v.page, `D-vote-${width}-${scheme}`);
        await v.ctx.close();
      }
    const p = await vicCard({ who: 'Parker' });
    assert((await p.page.locator('.tc-hero [data-tc-who]').count()) === 1 && (await p.page.locator('.tc-hero [data-tc-edit]').count()) === 1 && (await p.page.locator('.tc-hero [data-tc-drop]').count()) === 1, 'listed: See who and the links');
    assert(flat(await p.page.locator('.tc-foot').innerText()) === 'You’re on the list. We’re picking the date.', await p.page.locator('.tc-foot').innerText());
    await p.ctx.close();
  });
  await check('D tickets open: tapping the card opens the overlay with Edit sign-up and Drop out (they left the Home card)', async () => {
    await stage('tickets_open');
    const v = await vicCard({});
    // Vic is on the list with no ticket at tickets_open: Lock my spot.
    await v.page.locator('.tc-hero [data-tc-lock]').waitFor({ timeout: 20000 });
    await v.page.locator('.tc-hero .tc-title').click();
    const sheet = v.page.locator('dialog[open]');
    await sheet.locator('[data-tw]').waitFor({ timeout: 10000 });
    assert((await sheet.locator('[data-tc-edit]').count()) === 1 && (await sheet.locator('[data-tc-drop]').count()) === 1, 'the two links in the overlay');
    await fits(v.page, 'dialog[open] .tc-hero');
    await shot(v.page, 'D-overlay');
    // Edit sign-up from the overlay opens Edit my sign-up (closing the overlay must not close it again).
    await v.page.waitForTimeout(700);
    await sheet.locator('[data-tc-edit]').click();
    await v.page.locator('dialog[open] [data-tm-save]').waitFor({ timeout: 10000 });
    await v.page.waitForTimeout(600);
    assert((await v.page.locator('dialog[open] [data-tm-save]').count()) === 1, 'Edit my sign-up stays open');
    await v.ctx.close();
  });

  // ---------------------------------------------------------------- E  standby (the cap stood in: 16 locked in needs 16 names)
  for (const scheme of SCHEMES)
    for (const width of SIZES)
      await check(`E every spot taken: Join standby, 16 balls, standby words, no "waitlist" (${width} ${scheme})`, async () => {
        await stage('tickets_open');
        const v = await newPage({ width, scheme });
        const names = ['Alex', 'Parker', 'Rowan', 'Sage', 'Christopher Vanderberg', 'Wren', 'Quinn', 'Zoe', 'Reese', 'Parker', 'Rowan', 'Sage', 'Wren', 'Quinn', 'Zoe', 'Reese'];
        await v.page.route(/\/api\/group(\?|$)/, async (route) => {
          const res = await route.fetch();
          const j = await res.json();
          if (j.tournament && j.tournament.tickets) {
            j.tournament.going = 17;
            j.tournament.tickets.full = true;
            j.tournament.tickets.size = 16;
            j.tournament.tickets.locked = names.map((name) => ({ name }));
            j.tournament.tickets.line = [{ name: 'Christopher Vanderberg' }];
            if (j.tournament.me === null) j.tournament.me = { level: 320, dates: [j.tournament.finalDate] };
          }
          await route.fulfill({ response: res, json: j });
        });
        await v.page.goto(`${BASE}/?as=Vic`);
        await v.page.locator('.tc-hero [data-tc-join]').waitFor({ timeout: 20000 });
        assert(flat(await v.page.locator('.tc-hero [data-tc-join]').innerText()) === 'Join standby', 'Join standby');
        const row = await ballRow(v.page);
        assert(row.n === 16 && row.gold === 16 && row.tops.length === 1, JSON.stringify(row));
        assert(flat(await v.page.locator('.tc-foot').innerText()) === 'Pay by 12/16', 'Pay by under Join standby (mock 15)');
        await cardOneLine(v.page);
        await fits(v.page, '.tc-hero');
        await shot(v.page, `E-standby-${width}-${scheme}`);
        await v.page.locator('.tc-hero .tc-title').click();
        const sheet = v.page.locator('dialog[open]');
        await sheet.locator('[data-tw]').waitFor({ timeout: 10000 });
        const words = flat(await sheet.innerText());
        assert(/standby/i.test(words) && !/wait ?list/i.test(words), words);
        assert(!/of 16|16 spots/i.test(words), `the cap stays hidden: ${words}`);
        assert(!/wait ?list/i.test(flat(await v.page.locator('body').innerText())), 'no waitlist anywhere on Home');
        await v.ctx.close();
      });

  // ---------------------------------------------------------------- F  the countdown
  // The stages set Pay by from the server's clock; the dev clock keeps running, so the hours and minutes are checked loosely.
  const MOMENTS = [
    ['pay_3d', /^3 days left to pay$/, 'amber', /^Pay by (Fri|Sat|Sun|Mon|Tue|Wed|Thu) 7:00 PM$/],
    ['pay_2d', /^2 days left to pay$/, 'amber', /^Pay by (Fri|Sat|Sun|Mon|Tue|Wed|Thu) 7:00 PM$/],
    ['pay_1d', /^Payment due tomorrow$/, 'amber', /^Pay by 7:00 PM$/],
    ['pay_today', /^Payment due today$/, 'red', /^Pay by 7:00 PM tonight$/],
    ['pay_hours', /^Due in 5 hours$/, 'red', /^Pay by \d{1,2}:\d\d (AM|PM) (today|tonight)$/],
    ['pay_minutes', /^Due in 4\d minutes$/, 'red', /^Pay by \d{1,2}:\d\d (AM|PM) (today|tonight)$/],
    ['pay_late', /^Your payment is late$/, 'late', /^Pay now to stay in Winter Classic$/],
  ];
  for (const [st, title, tone, sub] of MOMENTS)
    await check(`F countdown ${st}: ${title} at the top of Home, the right tone and button (390/360/320, light and dark)`, async () => {
      await stage(st);
      // Vic is on the list and unpaid at every countdown stage.
      for (const scheme of SCHEMES)
        for (const width of SIZES) {
          const v = await vicCard({ width, scheme });
          const alert = v.page.locator('[data-pay-countdown]');
          await alert.waitFor({ timeout: 10000 });
          assert((await alert.getAttribute('data-pay-countdown')) === tone, `tone ${await alert.getAttribute('data-pay-countdown')}`);
          assert(title.test(flat(await alert.locator('.ac-title').innerText())), await alert.innerText());
          assert(sub.test(flat(await alert.locator('.ac-sub').innerText()).replace(/ /g, ' ')), await alert.locator('.ac-sub').innerText());
          assert(flat(await alert.locator('[data-pay-countdown-btn]').innerText()) === (tone === 'late' ? 'Pay now' : 'Pay $16'), 'the button');
          // First thing on Home under the header (above the card).
          const order = await v.page.evaluate(() => {
            const a = document.querySelector('[data-pay-countdown]').getBoundingClientRect().top;
            const c = document.querySelector('.tc-hero').getBoundingClientRect().top;
            const f = document.querySelector('[data-format-alert]');
            return a < c && (!f || a < f.getBoundingClientRect().top);
          });
          assert(order, 'first: above the date alert and the card');
          // The site's alert card keeps a title on one line from 360 px up; below that it wraps to two balanced lines (src/AlertCard.tsx).
          await oneLine(v.page, width >= 360 ? '[data-pay-countdown] .ac-title, [data-pay-countdown] .ac-btn' : '[data-pay-countdown] .ac-btn');
          await fits(v.page, '[data-pay-countdown]');
          await noDash(v.page, st);
          await shot(v.page, `F-${st}-${width}-${scheme}`);
          await v.ctx.close();
        }
      // Pay opens the same Pay sheet as Lock my spot (Vic has no credit: the sheet for $16).
      const v = await vicCard({});
      await v.page.locator('[data-pay-countdown-btn]').click();
      const sheet = v.page.locator('dialog[open]');
      await sheet.waitFor({ timeout: 10000 });
      assert(/\$16/.test(flat(await sheet.innerText())), await sheet.innerText());
      await v.ctx.close();
    });
  await check('F the card goes the moment they pay (I paid); late with no spot free shows none', async () => {
    await stage('pay_1d');
    const v = await vicCard({});
    await v.page.locator('[data-pay-countdown-btn]').click();
    const sheet = v.page.locator('dialog[open]');
    await sheet.waitFor({ timeout: 10000 });
    await sheet.getByRole('button', { name: /I paid/ }).click();
    await v.page.locator('[data-pay-countdown]').waitFor({ state: 'detached', timeout: 10000 });
    assert(flat(await v.page.locator('.tc-foot').innerText()).startsWith('Paid'), await v.page.locator('.tc-foot').innerText());
    await v.ctx.close();
    await stage('pay_closed');
    const c = await vicCard({});
    await c.page.waitForTimeout(500);
    assert((await c.page.locator('[data-pay-countdown]').count()) === 0, 'closed: no countdown');
    await c.ctx.close();
  });

  await check('F standby, unpaid, a spot open but tickets closed after Pay by (the reviewer\'s case): no countdown, so no Pay now that would fail', async () => {
    await stage('pay_late');
    const v = await newPage({});
    await v.page.route(/\/api\/group(\?|$)/, async (route) => {
      const res = await route.fetch();
      const j = await res.json();
      if (j.tournament && j.tournament.tickets) {
        j.tournament.tickets.closed = true;
        j.tournament.tickets.freed = 0;
        j.tournament.tickets.line = [{ name: 'Vic', me: true }];
        j.tournament.tickets.mine = { place: 'line', creditCents: 0, paidCents: 0, claimCents: 0, owedCents: 1600 };
      }
      await route.fulfill({ response: res, json: j });
    });
    await v.page.goto(`${BASE}/?as=Vic`);
    await v.page.locator('.tc-hero').first().waitFor({ timeout: 20000 });
    await v.page.waitForTimeout(400);
    assert((await v.page.locator('[data-pay-countdown]').count()) === 0, 'no countdown while tickets are closed for them');
    await v.ctx.close();
  });

  // ---------------------------------------------------------------- G  Remind all unpaid
  for (const scheme of SCHEMES)
    for (const width of SIZES)
      await check(`G Remind all unpaid (mock 14): the chip, Paid 6, Not paid yet 3, Pay by, Messages with the numbers (${width} ${scheme})`, async () => {
        await stage('tickets_open');
        const a = await adminPage({ width, scheme });
        const card = a.page.locator('[data-tm-remind]');
        await card.waitFor({ timeout: 15000 });
        assert(flat(await card.locator('.tm-remind-label').innerText()) === 'WINTER CLASSIC · TICKETS', await card.locator('.tm-remind-label').innerText());
        assert(flat(await card.locator('[data-tm-unpaid-chip]').innerText()) === '3 UNPAID', await card.locator('[data-tm-unpaid-chip]').innerText());
        assert(flat(await card.locator('[data-tm-row="paid"]').innerText()) === '6' && flat(await card.locator('[data-tm-row="unpaid"]').innerText()) === '3', 'the rows');
        assert(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun) 7:00\sPM$/.test(flat(await card.locator('[data-tm-row="payby"]').innerText())), 'Pay by');
        const href = await card.locator('[data-tm-remind-btn]').getAttribute('href');
        assert(/^sms:/.test(href), href);
        const body = decodeURIComponent(href.split('body=')[1] || '');
        assert(/^Hey, please pay for Winter Classic by \w+ so the courts are locked in for \w+/.test(body), body);
        const bg = await card.locator('[data-tm-remind-btn]').evaluate((e) => getComputedStyle(e).backgroundColor);
        assert(bg === (scheme === 'dark' ? 'rgb(35, 122, 82)' : 'rgb(30, 106, 72)'), `the mock's green: ${bg}`);
        await oneLine(a.page, '[data-tm-remind] .tm-row, [data-tm-remind] .tm-remind-head, [data-tm-remind-btn]');
        await fits(a.page, '[data-tm-remind]');
        await shot(a.page, `G-remind-${width}-${scheme}`);
        await a.ctx.close();
      });
  await check('G hidden when everyone has paid (the count card instead)', async () => {
    await stage('all_locked');
    const a = await adminPage({});
    await a.page.locator('[data-tm-home]').first().waitFor({ timeout: 15000 });
    assert((await a.page.locator('[data-tm-remind]').count()) === 0, 'no remind card');
    assert((await a.page.locator('[data-tickets-card]').count()) === 1, 'the count card');
    await a.ctx.close();
  });

  // ---------------------------------------------------------------- H  who can see it
  await check('H Only me and the switch off: Vic gets no tournament data at all (no name, no Pay by, no count)', async () => {
    // Only me can be set only while no player holds a ticket (the site's rule since Zip 56): the vote stage.
    await stage('vote_open');
    let t = (await dash()).tournament;
    assert((await answerOf('Vic')).data.tournament, 'shown on Everyone');
    await call('PUT', `/api/admin/tournament/${t.id}/visibility`, { visibility: 'me' });
    const hidden = await answerOf('Vic');
    assert(!('tournament' in hidden.data) && !hidden.text.includes('The Cold Open') && !hidden.text.includes('going'), 'Only me: nothing');
    const v = await playerPage('Vic', {});
    assert((await v.page.locator('.tc-hero, [data-pay-countdown]').count()) === 0, 'no card, no countdown');
    await v.ctx.close();
    // The switch off, with tickets open and Vic unpaid inside the countdown: nothing.
    await stage('pay_1d');
    t = (await dash()).tournament;
    assert((await answerOf('Vic')).text.includes('payBy'), 'on: Pay by sent');
    await call('PUT', '/api/admin/tournaments-switch', { on: false });
    const off = await answerOf('Vic');
    assert(!('tournament' in off.data) && !off.text.includes('payBy') && !off.text.includes('Winter Classic'), 'switch off: nothing');
    const o = await playerPage('Vic', {});
    assert((await o.page.locator('.tc-hero, [data-pay-countdown], [data-tc-shell]').count()) === 0, 'switch off: no card, no countdown');
    await o.ctx.close();
    await call('PUT', '/api/admin/tournaments-switch', { on: true });
  });

  // ---------------------------------------------------------------- I  the placeholder's shimmer
  await check('I the card\'s loading placeholder uses the site\'s .skel shimmer, the card\'s size', async () => {
    await stage('tickets_open');
    const v = await newPage({ reducedMotion: 'no-preference' });
    await v.page.route(/TournamentHome/, async (route) => {
      await sleep(4000);
      await route.continue();
    });
    await v.page.goto(`${BASE}/?as=Vic`);
    const shell = v.page.locator('[data-tc-shell]');
    await shell.waitFor({ timeout: 20000 });
    const s = await shell.evaluate((e) => ({ cls: e.className, anim: getComputedStyle(e).animationName, h: e.getBoundingClientRect().height, bg: getComputedStyle(e).backgroundImage }));
    assert(/\bskel\b/.test(s.cls) && s.anim === 'skel-shimmer' && /gradient/.test(s.bg) && s.h >= 250, JSON.stringify(s));
    await shot(v.page, 'I-shell');
    await v.ctx.close();
  });

  await browser.close();
  console.log(`\nzip63: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
