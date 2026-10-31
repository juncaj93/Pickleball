/* Credit used automatically at I'm in, on a phone (fake data only):
 *   - full cover: "Paid with credit" at once, no Pay, on a booked game and on one with no court
 *   - part cover: "Credit $3 used", then "$11 due" and Pay only once the court is booked
 *   - the header credit chip goes down at once
 *   - a pending cash out: the small bottom question "Use the $10 you asked to cash out for this game?"
 *     (Use it / No, keep cash out), the organizer's Home card disappearing
 *   - the organizer's Who paid: "Paid with credit", "Credit $3" and Unmark
 *   - layout of the chips and the question at 360, 375, 390 and 430 px, light and dark:
 *     nothing sticks out, no cut-off text, no overlap, at most one filled green button per card
 *
 *   node e2e/auto-credit.cjs      (also run by npm run test:e2e)
 *
 * Starts its own dev server with a fresh fake group (Alex is the organizer).
 * No Venmo page is opened and no Telegram message is sent (no bot is set up).
 */
const { spawn } = require('node:child_process');
const { rmSync, mkdirSync } = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const PORT = 5251;
const BASE = `http://localhost:${PORT}`;
const SETUP_TOKEN = 'auto-credit-setup-token-0123456789';
const PIN = '482913';
const SHOTS = path.join(__dirname, 'screenshots');
const PEOPLE = ['Alex', 'Ryan', 'Mitchel', 'Brandon', 'Julian', 'Bartholomew'];
const WIDTHS = [360, 375, 390, 430];
const SCHEMES = ['light', 'dark'];

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
const nav = (page, name) => page.getByRole('navigation', { name: 'Organizer sections' }).getByRole('button', { name: new RegExp(`^${name}`) });

/** Nothing sticks out of `el`, no text is cut off, buttons and chips do not overlap each other. */
async function tidy(locator, what) {
  const r = await locator.evaluate((el) => {
    const box = el.getBoundingClientRect();
    const out = [...el.querySelectorAll('*')].filter((x) => {
      const b = x.getBoundingClientRect();
      return b.width > 0 && !x.classList.contains('cal-icon-link') && !x.closest('.cal-icon-link') && (b.right > box.right + 1 || b.left < box.left - 1);
    });
    const cut = [...el.querySelectorAll('*')].filter((x) => !x.classList.contains('sr-only') && x.children.length === 0 && x.scrollWidth > x.clientWidth + 1 && getComputedStyle(x).overflow !== 'visible').length;
    const parts = [...el.querySelectorAll('a.btn, button.btn, button.link-btn, .pchip')].filter((b) => b.getBoundingClientRect().width > 0);
    let overlap = 0;
    for (let i = 0; i < parts.length; i++)
      for (let j = i + 1; j < parts.length; j++) {
        if (parts[i].contains(parts[j]) || parts[j].contains(parts[i])) continue;
        const a = parts[i].getBoundingClientRect();
        const b = parts[j].getBoundingClientRect();
        if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) overlap++;
      }
    return { out: out.length, outInfo: out.slice(0, 2).map((x) => `${x.tagName}.${x.className}`).join('; '), cut, overlap };
  });
  assert(r.out === 0, `${what}: something sticks out: ${r.outInfo}`);
  assert(r.cut === 0, `${what}: text is cut off`);
  assert(r.overlap === 0, `${what}: chips or buttons overlap`);
}
const noSideways = async (page) => assert((await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 0, 'sideways scroll');
const greenButtons = (loc) =>
  loc.evaluate(
    (el) =>
      [...el.querySelectorAll('a.btn, button.btn')].filter(
        (b) => b.getBoundingClientRect().width > 0 && !['secondary', 'outline', 'ghost', 'danger', 'text-btn'].some((c) => b.classList.contains(c)),
      ).length,
  );

async function main() {
  const dbFile = path.join(ROOT, '.data', 'auto-credit.sqlite');
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
  // Sat Oct 31, 2026, 11:00 AM Eastern: nobody is signing up, the next games are Tue Nov 3 and Thu Nov 5.
  await clock('2026-10-31T11:00:00-04:00');

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
  const byDate = (d, date) => d.sessions.find((s) => new Date(s.startsAt).toLocaleDateString('en-CA', { timeZone: 'America/Detroit' }) === date);
  const nov3 = byDate(d0, '2026-11-03');
  const nov5 = byDate(d0, '2026-11-05');
  // Tue Nov 3 has its court; Thu Nov 5 does not yet.
  await call(api.request, 'POST', `/api/admin/sessions/${nov3.id}/booked`, {});

  // Fake credit, as if earlier canceled games came back: written straight into this throwaway database.
  const db = new DatabaseSync(dbFile);
  const give = (name, cents) =>
    db
      .prepare(
        `INSERT INTO credit_ledger (id, group_id, player_id, kind, amount_cents, session_id, created_at, reason)
         SELECT ?, id, ?, 'kept', ?, NULL, '2026-10-30T15:00:00.000Z', 'canceled' FROM groups`,
      )
      .run(`fake-${name}-${cents}`, id[name], cents);
  give('Mitchel', 1400);
  give('Julian', 1400);
  give('Ryan', 300);
  give('Bartholomew', 300);
  give('Brandon', 1000);
  db.close();

  const player = async (name, scheme, width) => {
    const ctx = await browser.newContext({ viewport: { width, height: 860 }, isMobile: true, hasTouch: true, colorScheme: scheme });
    await ctx.route(/venmo\.com/, (r) => r.abort());
    await call(ctx.request, 'POST', '/api/me', { playerId: id[name] });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(BASE + '/');
    await page.locator('.schedule article').first().waitFor();
    return { ctx, page, errors };
  };
  const card = (page, s) => page.locator(`#row-${s.id}`);
  const chipText = async (page) => {
    const c = page.locator('header [data-credit-chip]');
    return (await c.count()) ? squash(await c.innerText()) : '';
  };
  const tapIn = async (page, s) => {
    await card(page, s).getByRole('button', { name: /^I'm in/ }).click();
    await card(page, s).getByText("You're in").first().waitFor();
  };

  // Brandon asks to cash out his $10 before anything else.
  {
    const c = await browser.newContext();
    await call(c.request, 'POST', '/api/me', { playerId: id.Brandon });
    await call(c.request, 'POST', '/api/me/refund-request', { cents: 1000 });
    await c.close();
  }

  console.log('Full cover');
  await check('Mitchel ($14) taps I\'m in on a booked game: "Paid with credit" at once, no Pay, the header chip goes', async () => {
    const { ctx, page, errors } = await player('Mitchel', 'light', 390);
    assert((await chipText(page)).includes('$14'), `chip before: ${await chipText(page)}`);
    await tapIn(page, nov3);
    const c = card(page, nov3);
    await c.locator('[data-paid]').waitFor();
    assert(squash(await c.locator('[data-paid]').innerText()) === 'Paid with credit', `chip: ${await c.locator('[data-paid]').innerText()}`);
    assert((await c.locator('[data-owe], [data-use-credit]').count()) === 0, 'no amount due or Use credit');
    assert((await c.getByRole('link', { name: /Pay/ }).count()) === 0, 'no Pay');
    await page.waitForFunction(() => !document.querySelector('header [data-credit-chip]'), null, { timeout: 4000 });
    assert(errors.length === 0, errors.join(' | '));
    await ctx.close();
  });
  await check('Julian ($14) on a game with no court: "Paid with credit" shows straight away', async () => {
    const { ctx, page } = await player('Julian', 'light', 390);
    await tapIn(page, nov5);
    const c = card(page, nov5);
    await c.locator('[data-paid]').waitFor();
    assert(squash(await c.locator('[data-paid]').innerText()) === 'Paid with credit', 'Paid with credit');
    assert((await c.innerText()).includes('Court not booked'), 'still reads Court not booked');
    await ctx.close();
  });

  console.log('Part cover');
  await check('Ryan ($3) on a booked game: "Credit $3 used", "$11 due" and Pay, one filled button', async () => {
    const { ctx, page } = await player('Ryan', 'light', 390);
    await tapIn(page, nov3);
    const c = card(page, nov3);
    await c.locator('[data-credit-used]').waitFor();
    assert(squash(await c.locator('[data-credit-used]').innerText()) === 'Credit $3 used', await c.locator('[data-credit-used]').innerText());
    assert(squash(await c.locator('[data-owe]').innerText()) === '$11 due', await c.locator('[data-owe]').innerText());
    assert((await c.getByRole('link', { name: 'Pay $11 with Venmo' }).count()) === 1, 'Pay $11');
    assert((await greenButtons(c)) <= 1, 'more than one filled button');
    assert((await chipText(page)) === '', 'credit chip gone ($0 left)');
    await ctx.close();
  });
  await check('Bartholomew ($3) on a game with no court: only "Credit $3 used"; no $11 due, no Pay until Court booked', async () => {
    const { ctx, page } = await player('Bartholomew', 'light', 390);
    await tapIn(page, nov5);
    const c = card(page, nov5);
    await c.locator('[data-credit-used]').waitFor();
    assert((await c.locator('[data-owe]').count()) === 0, 'no amount due yet');
    assert((await c.getByRole('link', { name: /Pay/ }).count()) === 0, 'no Pay yet');
    await ctx.close();
  });

  console.log('Pending cash out');
  for (const scheme of SCHEMES) {
    for (const width of WIDTHS) {
      await check(`the question at ${width}px ${scheme}: shows after I'm in, fits, one filled button; No, keep cash out closes it`, async () => {
        const { ctx, page, errors } = await player('Brandon', scheme, width);
        await tapIn(page, nov3);
        const q = page.locator('[data-cashout-prompt]');
        await q.waitFor();
        assert(squash(await q.locator('.cashout-q').innerText()) === 'Use the $10 you asked to cash out for this game?', await q.innerText());
        await tidy(q, 'question');
        const box = await q.boundingBox();
        assert(box.x >= 8 && box.x + box.width <= width - 8, `inside the screen (${box.x}, ${box.width})`);
        assert((await greenButtons(q)) === 1, 'one filled button (Use it)');
        for (const b of await q.locator('button').all()) assert((await b.boundingBox()).height >= 44, '44px tap target');
        // No banner on top of it.
        assert((await page.locator('[data-banner]').count()) === 0, 'a banner covers the question');
        await noSideways(page);
        await page.screenshot({ path: path.join(SHOTS, `auto-credit-question-${width}-${scheme}.png`) });
        await q.getByRole('button', { name: 'No, keep cash out' }).click();
        await q.waitFor({ state: 'detached' });
        // Kept: in, owes $14, the request stays.
        assert(squash(await card(page, nov3).locator('[data-owe]').innerText()).startsWith('$14 due'), 'owes $14');
        assert((await card(page, nov3).locator('[data-credit-used]').count()) === 0, 'no credit used');
        assert(errors.length === 0, errors.join(' | '));
        // Out again for the next width (straight to the server: no Undo wait).
        await call(ctx.request, 'POST', `/api/sessions/${nov3.id}/withdraw`, {});
        await ctx.close();
      });
    }
  }
  await check('Use it: the $10 goes on the game ("Credit $10 used", "$4 due"), the request is withdrawn and the Home card goes', async () => {
    const { ctx, page } = await player('Brandon', 'light', 390);
    await tapIn(page, nov3);
    const q = page.locator('[data-cashout-prompt]');
    await q.getByRole('button', { name: 'Use it' }).click();
    await q.waitFor({ state: 'detached' });
    const c = card(page, nov3);
    await c.locator('[data-credit-used]').waitFor();
    assert(squash(await c.locator('[data-credit-used]').innerText()) === 'Credit $10 used', 'Credit $10 used');
    assert(squash(await c.locator('[data-owe]').innerText()) === '$4 due', '$4 due');
    assert((await chipText(page)) === '', 'credit chip gone');
    assert((await dash()).refundRequests.length === 0, 'Home card gone');
    await ctx.close();
  });

  console.log('Cards at every width');
  for (const scheme of SCHEMES) {
    for (const width of WIDTHS) {
      await check(`chips at ${width}px ${scheme}: Paid with credit, Credit $3 used + $11 due + Pay, Credit $3 used alone`, async () => {
        const looks = [
          ['Mitchel', nov3],
          ['Ryan', nov3],
          ['Bartholomew', nov5],
          ['Brandon', nov3],
        ];
        for (const [name, s] of looks) {
          const { ctx, page, errors } = await player(name, scheme, width);
          const c = card(page, s);
          await c.scrollIntoViewIfNeeded();
          await tidy(c, `${name}'s card`);
          assert((await greenButtons(c)) <= 1, `${name}: more than one filled button`);
          await noSideways(page);
          if (width === 360) await page.screenshot({ path: path.join(SHOTS, `auto-credit-${name}-${width}-${scheme}.png`) });
          assert(errors.length === 0, errors.join(' | '));
          await ctx.close();
        }
      });
    }
  }

  console.log('The organizer');
  await check('Who paid: "Paid with credit", "Credit $3" with Unmark; Unmark puts the $3 back in Ryan\'s credit', async () => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 860 }, isMobile: true, hasTouch: true });
    await ctx.request.post(BASE + '/api/admin/login', { headers: { Origin: BASE }, data: { pin: PIN } });
    const page = await ctx.newPage();
    await page.goto(BASE + '/admin');
    await nav(page, 'Money').click();
    const row = page.locator(`details.money-sess[data-session="${nov3.id}"]`);
    await row.waitFor();
    if (!(await row.evaluate((el) => el.open))) await row.locator('summary').click();
    const mitchel = row.locator('[data-pay-row="Mitchel"]');
    const ryan = row.locator('[data-pay-row="Ryan"]');
    assert((await mitchel.innerText()).includes('Paid with credit'), await mitchel.innerText());
    assert((await ryan.innerText()).includes('Credit $3'), await ryan.innerText());
    await ryan.locator('[data-unmark-credit]').click();
    await page.waitForFunction((sel) => !document.querySelector(sel)?.innerText.includes('Credit $3'), `details.money-sess[data-session="${nov3.id}"] [data-pay-row="Ryan"]`);
    const d = await dash();
    assert(d.creditLedger.find((l) => l.playerId === id.Ryan).balanceCents === 300, 'Ryan has $3 again');
    await ctx.close();
  });

  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
