/* The text suggestion cards at the top of the organizer's Home, on a phone:
 * what shows and when, the one green Text button that opens Messages with the
 * words and the numbers ready, hiding after a tap (on this device only) until
 * the situation changes, at most two cards with a "more" link, nothing at all
 * when nothing needs a text, and never on a player's screen or View as.
 *
 *   node e2e/suggest.cjs      (also run by npm run test:e2e)
 *
 * Starts its own dev server with a fresh fake group (Alex is the organizer).
 */
const { spawn } = require('node:child_process');
const { rmSync, mkdirSync } = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const PORT = 5197;
const BASE = `http://localhost:${PORT}`;
const SETUP_TOKEN = 'suggest-setup-token-0123456789';
const PIN = '482913';
const SHOTS = path.join(__dirname, 'screenshots');
const PEOPLE = ['Alex', 'Ryan', 'Mitchel', 'Brandon', 'Julian', 'Nathan'];
const WIDTHS = [360, 375, 390, 430];

let passed = 0;
let failed = 0;
async function check(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.log(`  ✗ ${name}\n      ${String(err && err.message ? err.message : err).replace(/\s*\n\s*/g, ' ⏎ ').slice(0, 700)}`);
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
function smsOf(href) {
  const m = href.match(/^sms:(?:\/\/open\?addresses=)?([^?&]*)[?&]body=(.*)$/);
  if (!m) throw new Error(`not an sms link: ${href}`);
  return { to: m[1] ? m[1].split(',') : [], body: decodeURIComponent(m[2]) };
}

async function main() {
  const dbFile = path.join(ROOT, '.data', 'suggest.sqlite');
  mkdirSync(path.join(ROOT, '.data'), { recursive: true });
  mkdirSync(SHOTS, { recursive: true });
  rmSync(dbFile, { force: true });
  const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
    cwd: ROOT,
    env: { ...process.env, DEV_DB: dbFile, SETUP_TOKEN, DEV_CLOCK: '1' },
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
    await new Promise((r) => setTimeout(r, 500));
  }
  const clock = (iso) => fetch(`${BASE}/__dev/clock`, { method: 'POST', body: JSON.stringify({ atMs: Date.parse(iso) }) });
  await clock('2026-10-31T12:00:00-04:00'); // Sat noon: the next game (Tue Nov 3, 8:00 PM) is 80 hours away

  const browser = await chromium.launch();
  const api = await browser.newContext();
  const call = async (req, method, url, data) => {
    const res = await req.fetch(BASE + url, { method, data, headers: { Origin: BASE } });
    if (!res.ok()) throw new Error(`${method} ${url}: ${res.status()} ${await res.text()}`);
    return res.json().catch(() => ({}));
  };
  await call(api.request, 'POST', '/api/setup', {
    setupToken: SETUP_TOKEN,
    groupName: 'Pickleball Bros',
    pin: PIN,
    venmoUrl: 'https://venmo.com/u/organizer',
    players: PEOPLE.map((name, i) => ({ name, phone: `248555010${i}` })),
  });
  await call(api.request, 'PUT', '/api/admin/group', { organizerName: 'Alex' });
  const dash = () => call(api.request, 'GET', '/api/admin/dashboard');
  const d0 = await dash();
  const id = Object.fromEntries(d0.players.map((p) => [p.name, p.id]));
  const thu = d0.sessions.find((s) => new Date(s.startsAt).toLocaleDateString('en-CA', { timeZone: 'America/Detroit' }) === '2026-11-03');
  const roster = (s, name, action = 'confirm') => call(api.request, 'POST', `/api/admin/sessions/${s.id}/roster`, { playerId: id[name], action });

  const open = async (scheme, width) => {
    const ctx = await browser.newContext({ viewport: { width, height: 860 }, isMobile: true, hasTouch: true, colorScheme: scheme });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await ctx.request.post(BASE + '/api/admin/login', { headers: { Origin: BASE }, data: { pin: PIN } });
    await page.goto(BASE + '/admin');
    await page.locator('section[aria-labelledby="sessions-title"] article').first().waitFor();
    return { ctx, page, errors };
  };
  const cards = (page) => page.locator('article[data-suggest]');

  // ---- Nothing needs a text: Home has no cards at all (Sat noon, the next game is 80 hours away).
  {
    const { ctx, page } = await open('light', 390);
    await check('nothing needs a text: no cards and no "Texts to send" section', async () => {
      assert((await cards(page).count()) === 0, 'cards showing: ' + (await cards(page).evaluateAll((as) => as.map((a) => a.getAttribute('aria-label')))).join(' | '));
      assert((await page.locator('.suggest-cards').count()) === 0, 'empty section');
    });
    await ctx.close();
  }

  // ---- 49 hours before: nothing. 47 hours before: Need players.
  await roster(thu, 'Ryan');
  await roster(thu, 'Mitchel');
  await clock('2026-11-01T19:00:00-05:00'); // Sun 7:00 PM, 49 hours before Tue 8:00 PM
  {
    const { ctx, page } = await open('light', 390);
    await check('49 hours before with 2 in: no Need players card', async () => assert((await cards(page).count()) === 0, 'card shows too early'));
    await ctx.close();
  }
  await clock('2026-11-01T21:00:00-05:00'); // 47 hours before
  for (const scheme of ['light', 'dark']) {
    for (const width of WIDTHS) {
      const tag = `${width}px ${scheme}`;
      const { ctx, page, errors } = await open(scheme, width);
      await check(`${tag}: 47 hours before with 2 in: one Need players card, the Text button is the only green one, nothing cut off`, async () => {
        const c = cards(page);
        assert((await c.count()) === 1, `cards: ${await c.count()}`);
        const card = c.first();
        assert(/^Need players: /.test(await card.getAttribute('aria-label')), await card.getAttribute('aria-label'));
        const t = (await card.innerText()).replace(/\s+/g, ' ');
        assert(/Group chat/.test(t) && /Tue, Nov 3/.test(t), t);
        const text = card.getByRole('link', { name: /^Text/ });
        const { to, body } = smsOf(await text.getAttribute('href'));
        assert(to.length === 0, 'a group chat has no numbers');
        assert(body === 'Need 2 more for pickleball Tue Nov 3, 8:00 PM. In? localhost:' + PORT, `body: ${body}`);
        const m = await card.evaluate((el) => {
          const box = el.getBoundingClientRect();
          const btn = el.querySelector('a.btn').getBoundingClientRect();
          const pre = el.querySelector('.sg-preview');
          const greens = [...el.querySelectorAll('a.btn, button.btn')].filter((b) => !b.classList.contains('secondary')).length;
          return {
            out: [...el.querySelectorAll('*')].filter((x) => { const r = x.getBoundingClientRect(); return r.width > 0 && (r.right > box.right + 1 || r.left < box.left - 1); }).length,
            btnH: btn.height,
            oneLine: pre.getBoundingClientRect().height < 28,
            greens,
          };
        });
        assert(m.out === 0, 'sticks out of the card');
        assert(m.btnH >= 44, `tap target ${m.btnH}`);
        assert(m.oneLine, 'preview is more than one line');
        assert(m.greens === 1, `green buttons: ${m.greens}`);
        assert(!/\bsent\b/i.test(t), 'says sent');
        assert((await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 0, 'sideways scroll');
      });
      await check(`${tag}: no layout jump: the same cards in the same place after a reload`, async () => {
        const before = await cards(page).first().boundingBox();
        const sessionTop = await page.locator('section[aria-labelledby="sessions-title"] article').first().boundingBox();
        await page.reload();
        await cards(page).first().waitFor();
        const after = await cards(page).first().boundingBox();
        assert(Math.abs(before.y - after.y) < 1 && Math.abs(before.height - after.height) < 1, `${JSON.stringify(before)} vs ${JSON.stringify(after)}`);
        const sessionTop2 = await page.locator('section[aria-labelledby="sessions-title"] article').first().boundingBox();
        assert(Math.abs(sessionTop.y - sessionTop2.y) < 1, 'session list moved');
      });
      await check(`${tag}: no browser errors`, async () => assert(errors.length === 0, errors.join(' | ')));
      if (width === 390) await page.screenshot({ path: path.join(SHOTS, `suggest-need-${scheme}.png`) });
      await ctx.close();
    }
  }

  // ---- Tap Text: the card hides (on this phone), stays hidden on reload, comes back when the count changes.
  {
    const { ctx, page } = await open('light', 390);
    await check('tapping Text hides the card, also after a reload; nothing was saved on the server', async () => {
      const card = cards(page).first();
      await card.evaluate((el) => el.querySelector('a.btn').addEventListener('click', (e) => e.preventDefault()));
      await card.getByRole('link', { name: /^Text/ }).click();
      await card.waitFor({ state: 'detached' });
      await page.reload();
      await page.locator('section[aria-labelledby="sessions-title"] article').first().waitFor();
      assert((await cards(page).count()) === 0, 'came back after reload');
      const stored = await page.evaluate(() => localStorage.getItem('pb_text_tapped'));
      assert(stored && /need:/.test(stored), `device memory: ${stored}`);
      const raw = JSON.stringify(await dash());
      assert(!/pb_text_tapped|tapped/.test(raw), 'the server knows');
    });
    await check('a player joining (count changes) brings the card back with the new number', async () => {
      await roster(thu, 'Brandon');
      await page.reload();
      const card = cards(page).first();
      await card.waitFor();
      const { body } = smsOf(await card.getByRole('link', { name: /^Text/ }).getAttribute('href'));
      assert(/^Need 1 more for pickleball/.test(body), body);
    });
    await check('with 4 in the Need card is gone; 6:00 PM the day before brings Check-in to the 4 who are in', async () => {
      await roster(thu, 'Julian');
      await clock('2026-11-02T17:59:00-05:00'); // Mon 5:59 PM
      await page.reload();
      await page.locator('section[aria-labelledby="sessions-title"] article').first().waitFor();
      assert((await cards(page).count()) === 0, `cards at 5:59 PM: ${await cards(page).count()}`);
      await clock('2026-11-02T18:00:00-05:00'); // Mon 6:00 PM
      await page.reload();
      const card = cards(page).first();
      await card.waitFor();
      assert(/^Check-in: /.test(await card.getAttribute('aria-label')), await card.getAttribute('aria-label'));
      const { to, body } = smsOf(await card.getByRole('link', { name: /^Text/ }).getAttribute('href'));
      assert(to.length === 4, `numbers: ${to}`);
      assert(body === 'Pickleball tomorrow, 8:00 PM. Still in? Update here: localhost:' + PORT, body);
      assert(/4 players/.test(await card.innerText()), 'who it goes to');
    });
    await ctx.close();
  }

  // ---- Players never see it, and neither does View as.
  await check('a player screen and View as carry no suggestion card', async () => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 860 }, isMobile: true });
    await call(ctx.request, 'POST', '/api/me', { playerId: id.Ryan });
    const page = await ctx.newPage();
    await page.goto(BASE + '/');
    await page.locator('.schedule article').first().waitFor();
    assert((await page.locator('.suggest-cards, article[data-suggest]').count()) === 0, 'cards on a player screen');
    assert(!(await page.locator('body').innerText()).includes('Texts to send'), 'wording on a player screen');
    await ctx.close();
    const { ctx: c2, page: p2 } = await open('light', 390);
    await cards(p2).first().waitFor().catch(() => {});
    await p2.locator('header').getByRole('button', { name: 'View as…' }).click();
    await p2.locator('dialog[open]').getByRole('button', { name: 'Ryan' }).click();
    await p2.locator('.viewas-banner').waitFor();
    assert((await cards(p2).count()) === 0, 'cards while viewing as a player');
    await c2.close();
  });

  // ---- At most two cards, with a "more" link; canceled games never.
  {
    await clock('2026-11-02T09:00:00-05:00');
    for (const [day, h] of [['02', 18], ['02', 20], ['03', 12]]) {
      await call(api.request, 'POST', '/api/admin/sessions', { startsAt: new Date(`2026-11-${day}T${h}:00:00-05:00`).toISOString(), endsAt: new Date(`2026-11-${day}T${h + 2}:00:00-05:00`).toISOString() });
    }
    await localStorageClear();
    const { ctx, page } = await open('light', 390);
    await check('three games need a text: two cards and "1 more", which opens the third', async () => {
      await cards(page).first().waitFor();
      const n = await cards(page).count();
      assert(n === 2, `cards shown: ${n}`);
      const more = page.locator('.sg-more');
      assert(/^\d+ more$/.test((await more.innerText()).trim()), await more.innerText());
      await more.click();
      assert((await cards(page).count()) >= 3, 'more did not open the rest');
      await page.screenshot({ path: path.join(SHOTS, 'suggest-more.png') });
    });
    await check('a canceled game has no card', async () => {
      const d = await dash();
      const extra = d.sessions.find((s) => s.extra);
      await call(api.request, 'POST', `/api/admin/sessions/${extra.id}/decision`, { decision: 'cancel', confirm: true });
      await page.reload();
      await page.locator('section[aria-labelledby="sessions-title"] article').first().waitFor();
      assert((await page.locator(`article[data-suggest][data-session="${extra.id}"]`).count()) === 0, 'card on a canceled game');
    });
    await ctx.close();
  }

  async function localStorageClear() {
    /* each test context starts with empty storage; nothing to clear */
  }

  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
