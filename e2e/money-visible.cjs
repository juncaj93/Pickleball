/* Money the player can see (money audit, Oct 31, 2026), on a phone, fake data only:
 *   - I'm in with credit: the banner says "You're in. $14 credit used." (part cover on a booked
 *     court: "You're in. $3 credit used, $11 due."; no court booked: "You're in. $3 credit used.")
 *   - Drop out: "You dropped out. $14 credit returned." with Undo; nothing paid: "You dropped out."
 *   - Undo puts everything back exactly (the drop was never sent)
 *   - the credit sheet (tap the CREDIT chip) lists the latest changes in plain words, newest first:
 *     "Oct 31: $14 returned from Nov 3 (you dropped)", "Oct 31: $14 used for Nov 3"
 *   - at 360, 375, 390 and 430 px, light and dark: the banner and the sheet fit, nothing cut off,
 *     no overlap, no sideways scroll
 *
 *   node e2e/money-visible.cjs      (also run by npm run test:e2e)
 *
 * Starts its own dev server with a fresh fake group (Alex is the organizer). No Telegram, no Venmo.
 */
const { spawn } = require('node:child_process');
const { rmSync, mkdirSync } = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const PORT = 5263;
const BASE = `http://localhost:${PORT}`;
const SETUP_TOKEN = 'money-visible-setup-token-0123456789';
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
  const dbFile = path.join(ROOT, '.data', 'money-visible.sqlite');
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
  give('Ryan', 300);
  give('Bartholomew', 300);
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

  const banner = page => page.locator('.pop').last();
  const bannerSays = async (page, re, what) => {
    await page.waitForFunction((src) => [...document.querySelectorAll('.pop')].some((p) => new RegExp(src).test(p.innerText.replace(/\s+/g, ' '))), re.source, { timeout: 6000 }).catch(() => {});
    const t = squash(await banner(page).innerText());
    assert(re.test(t), `${what}: banner said "${t}"`);
  };
  const fits = async (page, loc, width, what) => {
    const box = await loc.boundingBox();
    assert(box && box.x >= 0 && box.x + box.width <= width, `${what}: off screen (${JSON.stringify(box)})`);
    await tidy(loc, what);
    await noSideways(page);
  };
  const db2 = () => new DatabaseSync(dbFile);
  const liveUsed = (name) => {
    const d = db2();
    const r = d.prepare("SELECT COALESCE(SUM(amount_cents), 0) AS c FROM credit_ledger WHERE kind = 'used' AND player_id = ? AND ended_at IS NULL").get(id[name]);
    d.close();
    return r.c;
  };

  console.log('Every width, light and dark (Mitchel, $14 credit)');
  for (const scheme of SCHEMES) {
    for (const width of WIDTHS) {
      await check(`${width}px ${scheme}: I'm in says "$14 credit used"; Drop out says "$14 credit returned" with Undo; the credit sheet lists both; all fit`, async () => {
        const { ctx, page, errors } = await player('Mitchel', scheme, width);
        await tapIn(page, nov3);
        await bannerSays(page, /^You're in\. \$14 credit used\.$/, 'I\'m in');
        await fits(page, banner(page), width, 'join banner');
        await card(page, nov3).locator('[data-paid]').waitFor();
        await page.locator('.pop').first().waitFor({ state: 'detached', timeout: 8000 }).catch(() => {});
        // Drop out: the banner says what happens to the money, with Undo, before anything is sent.
        await card(page, nov3).getByRole('button', { name: /^Drop out/ }).click();
        const confirm = page.getByRole('button', { name: /^Drop out/ }).last();
        await confirm.click();
        await bannerSays(page, /^You dropped out\. \$14 credit returned\. Undo$/, 'drop');
        // The CREDIT chip is there at the same moment as the banner (Undo still offered), not after it goes.
        await page.locator('header [data-credit-chip]').waitFor({ timeout: 1500 });
        assert((await banner(page).getByRole('button', { name: 'Undo' }).count()) === 1, 'the chip came with the banner, while Undo still shows');
        await fits(page, banner(page), width, 'drop banner');
        await page.screenshot({ path: path.join(SHOTS, `money-visible-drop-${width}-${scheme}.png`) });
        // Let the 5 seconds run out: the drop is sent and the credit is back in the pot (the chip already said so).
        await page.waitForTimeout(6500);
        // (The chip fades in and counts up from $0, so wait for it to land.)
        await page
          .waitForFunction(() => document.querySelector('header [data-credit-chip] .cc-now')?.textContent === '$14', null, { timeout: 15000 })
          .catch(() => {});
        assert((await chipText(page)) === 'CREDIT $14', `chip after the drop: ${await chipText(page)}`);
        await page.locator('header [data-credit-chip]').click();
        const sheet = page.locator('[data-credit-sheet]');
        await sheet.waitFor();
        const lines = (await sheet.locator('[data-credit-history] li').allInnerTexts()).map(squash);
        assert(lines[0] === 'Oct 31: $14 returned from Nov 3 (you dropped)' && lines[1] === 'Oct 31: $14 used for Nov 3', `history: ${JSON.stringify(lines)}`);
        assert(lines.length <= 10, 'at most 10 lines');
        assert(!lines.join(' ').includes('\u2014'), 'no em dashes');
        await fits(page, sheet, width, 'credit sheet');
        await page.screenshot({ path: path.join(SHOTS, `money-visible-sheet-${width}-${scheme}.png`) });
        assert(errors.length === 0, errors.join(' | '));
        await ctx.close();
      });
    }
  }

  console.log('Undo');
  await check('Undo within 5 seconds: the seat is still paid with credit, the pot untouched, nothing was sent', async () => {
    const { ctx, page } = await player('Mitchel', 'light', 390);
    await tapIn(page, nov3);
    await card(page, nov3).locator('[data-paid]').waitFor();
    const usedBefore = liveUsed('Mitchel');
    assert(usedBefore === 1400, `credit on the game before: ${usedBefore}`);
    await card(page, nov3).getByRole('button', { name: /^Drop out/ }).click();
    await page.getByRole('button', { name: /^Drop out/ }).last().click();
    await bannerSays(page, /credit returned\. Undo$/, 'drop');
    await page.locator('header [data-credit-chip]').waitFor({ timeout: 1500 });
    await banner(page).getByRole('button', { name: 'Undo' }).click();
    // Undo: the credit goes away again at once, and the seat is back Paid with credit.
    await page.locator('header [data-credit-chip]').waitFor({ state: 'detached', timeout: 1500 });
    await card(page, nov3).locator('[data-paid]').waitFor();
    await page.waitForTimeout(6500);
    assert(liveUsed('Mitchel') === 1400, 'the credit stayed on the game');
    assert(squash(await card(page, nov3).locator('[data-paid]').innerText()) === 'Paid with credit', 'still Paid with credit');
    assert((await chipText(page)) === '', 'no credit chip ($0 left)');
    // Out for good (straight to the server) so the pot is $14 again.
    await call(ctx.request, 'POST', `/api/sessions/${nov3.id}/withdraw`, {});
    await ctx.close();
  });

  console.log('Part cover and nothing paid');
  await check('Ryan ($3) on a booked game: "You\'re in. $3 credit used, $11 due."', async () => {
    const { ctx, page } = await player('Ryan', 'light', 390);
    await tapIn(page, nov3);
    await bannerSays(page, /^You're in\. \$3 credit used, \$11 due\.$/, 'part cover');
    await ctx.close();
  });
  await check('Bartholomew ($3) on a game with no court: "You\'re in. $3 credit used." (no amount due before Court booked)', async () => {
    const { ctx, page } = await player('Bartholomew', 'dark', 360);
    await tapIn(page, nov5);
    await bannerSays(page, /^You're in\. \$3 credit used\.$/, 'no court');
    await ctx.close();
  });
  await check('Julian (no credit, never paid) drops out: just "You dropped out. Undo"', async () => {
    const { ctx, page } = await player('Julian', 'light', 375);
    await tapIn(page, nov3);
    await bannerSays(page, /^You're in$/, 'no credit');
    await page.locator('.pop').first().waitFor({ state: 'detached', timeout: 8000 }).catch(() => {});
    await card(page, nov3).getByRole('button', { name: /^Drop out/ }).click();
    await page.getByRole('button', { name: /^Drop out/ }).last().click();
    await bannerSays(page, /^You dropped out\. Undo$/, 'nothing paid');
    await ctx.close();
  });

  await browser.close();
  console.log(`\nmoney-visible: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
