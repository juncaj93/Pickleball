/* The "Want in?" popup and the holiday pill, on a phone: the title by day,
 * the second line by how many are in, the pill on the same line as the date
 * and only as wide as its text, and the same pill on the player and organizer
 * cards. Fake group; the clock is Mon Nov 2, 9:00 AM Eastern.
 *
 *   node e2e/popup.cjs      (also run by npm run test:e2e)
 */
const { spawn } = require('node:child_process');
const { rmSync, mkdirSync } = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.E2E_PORT) || 5198;
const BASE = `http://localhost:${PORT}`;
const SETUP_TOKEN = 'popup-setup-token-0123456789';
const PIN = '482913';
const SHOTS = path.join(__dirname, 'screenshots');
const PEOPLE = ['Alex', 'Ryan', 'Mitchel', 'Brandon', 'Julian', 'Nathan', 'Frankie'];
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
const squash = (t) => t.replace(/\s+/g, ' ').trim();

async function main() {
  const dbFile = path.join(ROOT, '.data', 'popup.sqlite');
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
  await fetch(`${BASE}/__dev/clock`, { method: 'POST', body: JSON.stringify({ atMs: Date.parse('2026-11-02T09:00:00-05:00') }) });

  const browser = await chromium.launch();
  const api = await browser.newContext();
  const call = async (req, method, url, data) => {
    const res = await req.fetch(BASE + url, { method, data, headers: { Origin: BASE } });
    if (!res.ok()) throw new Error(`${method} ${url}: ${res.status()} ${await res.text()}`);
    return res.json().catch(() => ({}));
  };
  await call(api.request, 'POST', '/api/setup', {
    setupToken: SETUP_TOKEN, groupName: 'Pickleball Bros', pin: PIN, venmoUrl: 'https://venmo.com/u/organizer',
    players: PEOPLE.map((name, i) => ({ name, phone: `248555010${i}` })),
  });
  await call(api.request, 'PUT', '/api/admin/group', { organizerName: 'Alex' });
  const d0 = await call(api.request, 'GET', '/api/admin/dashboard');
  const id = Object.fromEntries(d0.players.map((p) => [p.name, p.id]));
  await call(api.request, 'PUT', `/api/admin/players/${id.Frankie}`, { name: 'Frankie', isRegular: true, isActive: true, canReceiveSubstituteInvites: true, usualDays: [2] });
  const tue = d0.sessions.find((s) => new Date(s.startsAt).toLocaleDateString('en-CA', { timeZone: 'America/Detroit' }) === '2026-11-03'); // Election Day
  const OTHERS = ['Ryan', 'Mitchel', 'Brandon', 'Julian', 'Nathan', 'Alex'];
  const setIn = async (n) => {
    // Make exactly n people in, through the organizer's roster control.
    for (const [i, name] of OTHERS.entries()) await call(api.request, 'POST', `/api/admin/sessions/${tue.id}/roster`, { playerId: id[name], action: i < n ? 'confirm' : 'withdraw' });
  };
  const player = async (scheme, width) => {
    const ctx = await browser.newContext({ viewport: { width, height: 860 }, isMobile: true, hasTouch: true, colorScheme: scheme });
    await call(ctx.request, 'POST', '/api/me', { playerId: id.Frankie });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(BASE + '/');
    await page.locator('.schedule article').first().waitFor();
    return { ctx, page, errors };
  };
  const pillInfo = (loc) =>
    loc.evaluate((el) => {
      const r = document.createRange();
      r.selectNodeContents(el);
      const cs = getComputedStyle(el);
      return { w: el.getBoundingClientRect().width, textW: r.getBoundingClientRect().width, size: cs.fontSize, weight: cs.fontWeight, color: cs.color, bg: cs.backgroundColor, text: el.textContent.trim() };
    });

  // ---- Every count: the title and the second line, exactly. Under 4 it says how many more
  // are needed; from 4 on "you'd make it N+1"; only at the organizer's max (set to 6 here) the waitlist.
  const WANT = [
    [0, 'Want in tomorrow?', '', 10],
    [1, 'Want in tomorrow?', 'Needs 3 more to play', 10],
    [2, 'Want in tomorrow?', 'Needs 2 more to play', 10],
    [3, 'Want in tomorrow?', 'Needs 1 more to play', 10],
    [4, 'Want in tomorrow?', "4 are in. You'd make it 5.", 10],
    [5, 'Want in tomorrow?', "5 are in. You'd make it 6.", 10],
    [6, 'Want in tomorrow?', "6 are in. You'd make it 7.", 10],
    [5, 'Want in tomorrow?', "5 are in. You'd make it 6.", 6],
    [6, "Want in on tomorrow's waitlist?", "6 are in. You'd be on the waitlist.", 6],
  ];
  let maxNow = 10;
  for (const [n, title, sub, max] of WANT) {
    if (max !== maxNow) {
      await call(api.request, 'PUT', '/api/admin/group', { settings: { maxPlayers: max } });
      maxNow = max;
    }
    await setIn(n);
    const { ctx, page } = await player('light', 390);
    await check(`${n} in (max ${max}): "${title}" and ${sub ? `"${sub}"` : 'no second line'}; date and time on one line, no holiday pill`, async () => {
      const card = page.locator('section.suggest').first();
      await card.waitFor();
      assert((await card.locator('h2').innerText()).trim() === title, `title: ${await card.locator('h2').innerText()}`);
      const subEl = card.locator('.suggest-sub');
      if (sub) assert(squash(await subEl.innerText()) === sub, `second line: ${await subEl.innerText()}`);
      else assert((await subEl.count()) === 0, 'there should be no second line');
      const when = card.locator('.suggest-when');
      assert(squash(await when.innerText()) === 'Tue, Nov 3 · 8 PM', `line 1: ${await when.innerText()}`);
      assert((await when.locator('.holiday').count()) === 0 && !/Election Day/.test(await card.innerText()), 'the popup has no holiday pill any more');
      const ys = await when.evaluate((el) => [...el.children].map((c) => Math.round(c.getBoundingClientRect().height)));
      assert(ys.length === 1 && ys[0] <= 24, `date and time are not on one line: ${ys}`);
      assert((await card.getByRole('button', { name: 'Yes' }).count()) === 1 && (await card.getByRole('button', { name: 'No' }).count()) === 1, 'Yes and No');
      // The old "spots left" / "until a 6th joins" lines are gone everywhere; the session cards keep their own count.
      assert(!/spots? left|until a 6th|everyone plays|make it \d/.test(await page.locator('.schedule').innerText()), 'popup wording on a session card');
      assert(!/spots? left|until a 6th|everyone plays/.test(await card.innerText()), 'old wording in the popup');
      const count = (await page.locator('.schedule article').first().locator('.in-count').innerText()).trim();
      assert(count === (n < 4 ? `${n} of 4 in` : n >= max ? `${n} in, full` : `${n} in`), `count read "${count}" with ${n} in and a max of ${max}`);
    });
    await ctx.close();
  }

  // ---- The pill: same small pill everywhere, hugging its text, at every width.
  await call(api.request, 'PUT', '/api/admin/group', { settings: { maxPlayers: 10 } });
  await setIn(4);
  for (const scheme of ['light', 'dark']) {
    for (const width of WIDTHS) {
      const tag = `${width}px ${scheme}`;
      const { ctx, page, errors } = await player(scheme, width);
      await check(`${tag}: no holiday pill on the popup or the player cards; nothing cut off, no sideways scroll`, async () => {
        assert((await page.locator('section.suggest .holiday, .schedule .holiday, .schedule .holiday-text').count()) === 0, 'a holiday pill is still on a player screen');
        assert(!/Election Day/.test(await page.locator('main').innerText()), 'the holiday name is still on a player screen');
        const cut = await page.evaluate(() => [...document.querySelectorAll('.holiday, section.suggest *, .sched-status *')].filter((x) => x.children.length === 0 && x.scrollWidth > x.clientWidth + 1 && getComputedStyle(x).overflow !== 'visible').length);
        assert(cut === 0, 'cut-off text');
        assert((await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 0, 'sideways scroll');
        const popBox = await page.locator('section.suggest').boundingBox();
        assert(popBox.x >= 0 && popBox.x + popBox.width <= width + 1, 'the popup fits the screen');
      });
      await check(`${tag}: no browser errors`, async () => assert(errors.length === 0, errors.join(' | ')));
      if (width === 390) await page.screenshot({ path: path.join(SHOTS, `popup-${scheme}.png`) });
      await ctx.close();

      const octx = await browser.newContext({ viewport: { width, height: 860 }, isMobile: true, hasTouch: true, colorScheme: scheme });
      await octx.request.post(BASE + '/api/admin/login', { headers: { Origin: BASE }, data: { pin: PIN } });
      const op = await octx.newPage();
      await op.goto(BASE + '/admin');
      const card = op.locator('section[aria-labelledby="sessions-title"] article', { hasText: 'Election Day' }).first();
      await card.waitFor();
      await check(`${tag}: organizer card has the same pill with "Hours OK" next to it, no overlap, nothing cut off; confirmed shows the pill and Undo, no check mark`, async () => {
        const pill = card.locator('.holiday');
        const a = await pillInfo(pill);
        assert(/^Election Day · check hours$/.test(a.text), a.text);
        assert(a.w <= a.textW + 24, `pill is wider than its text: ${JSON.stringify(a)}`);
        const row = card.locator('.holiday-actions');
        const fit = await row.evaluate((el) => {
          const box = el.getBoundingClientRect();
          const kids = [...el.children].map((c) => c.getBoundingClientRect());
          const over = kids.some((k, i) => kids.some((m, j) => j > i && k.left < m.right - 1 && m.left < k.right - 1 && k.top < m.bottom - 1 && m.top < k.bottom - 1));
          const out = kids.some((k) => k.right > box.right + 1);
          const cut = [...el.querySelectorAll('*')].some((x) => x.children.length === 0 && x.scrollWidth > x.clientWidth + 1 && getComputedStyle(x).overflow !== 'visible');
          return { over, out, cut };
        });
        assert(!fit.over && !fit.out && !fit.cut, `layout ${JSON.stringify(fit)}`);
        await card.getByRole('button', { name: 'Venue is open normal hours' }).click();
        await card.locator('.holiday', { hasText: /^Election Day$/ }).waitFor();
        assert(!/✓/.test(await row.innerText()), 'a check mark is still there');
        await card.getByRole('button', { name: 'Undo' }).waitFor();
        const b = await pillInfo(card.locator('.holiday'));
        assert(b.size === a.size && b.bg === a.bg && b.color === a.color, 'the pill changed look when confirmed');
        await card.getByRole('button', { name: 'Undo' }).click();
        await card.locator('.holiday', { hasText: 'check hours' }).waitFor();
      });
      await octx.close();
    }
  }

  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
