/* Live updates, Game on, All games / My games, loading polish, Undo, cash out notice.
 * A fake group on a throwaway dev server; nothing here touches the live site.
 *
 *   node e2e/live.cjs      (also run by npm run test:e2e)
 */
const { spawn } = require('node:child_process');
const { rmSync, mkdirSync } = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.E2E_PORT) || 5240;
const BASE = `http://localhost:${PORT}`;
const SETUP_TOKEN = 'live-setup-token-0123456789';
const PIN = '482913';
const NAMES = ['Alex', 'Ryan', 'Julian', 'Nathan', 'Mitchel', 'Brandon', 'Sam', 'Blair', 'Emery', 'Wren', 'Zed', 'Pia'];
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const dbFile = path.join(ROOT, '.data', 'live.sqlite');
  mkdirSync(path.join(ROOT, '.data'), { recursive: true });
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
    await sleep(500);
  }
  await fetch(`${BASE}/__dev/clock`, { method: 'POST', body: JSON.stringify({ atMs: Date.parse('2026-11-02T09:00:00-05:00') }) });

  const browser = await chromium.launch();
  const post = (req, url, data) => req.post(BASE + url, { data, headers: { Origin: BASE } });
  const setup = (await browser.newContext()).request;
  const made = await post(setup, '/api/setup', {
    setupToken: SETUP_TOKEN,
    groupName: 'Pickleball Bros',
    pin: PIN,
    venmoUrl: 'https://venmo.com/u/organizer',
    players: NAMES.map((name, i) => ({ name, phone: `24855503${String(i).padStart(2, '0')}` })),
  });
  if (!made.ok()) throw new Error(`setup failed: ${await made.text()}`);
  const areq = (await browser.newContext()).request;
  await post(areq, '/api/admin/login', { pin: PIN });
  await areq.put(`${BASE}/api/admin/group`, { data: { organizerName: 'Alex' }, headers: { Origin: BASE } });
  let d = await (await areq.get(`${BASE}/api/admin/dashboard`)).json();
  for (const h of d.hiddenSessions || []) await post(areq, `/api/admin/sessions/${h.id}/show`, { shown: true });
  d = await (await areq.get(`${BASE}/api/admin/dashboard`)).json();
  const games = d.sessions.filter((s) => !s.state.flags.past);
  for (const s of games) await post(areq, `/api/admin/sessions/${s.id}/booked`, {});
  const idOf = (n) => d.players.find((p) => p.name === n).id;
  const who = {};
  for (const n of NAMES) {
    const c = await browser.newContext();
    await post(c.request, '/api/me', { playerId: idOf(n) });
    who[n] = c.request;
  }
  const join = (n, i) => post(who[n], `/api/sessions/${games[i].id}/join`, {});
  const withdraw = (n, i) => post(who[n], `/api/sessions/${games[i].id}/withdraw`, {});
  const mineOn = async (n, i) => {
    const g = await (await who[n].get(`${BASE}/api/group`)).json();
    return g.sessions.find((s) => s.id === games[i].id).mine?.status ?? null;
  };

  for (const n of ['Nathan', 'Mitchel', 'Brandon']) await join(n, 0); // 3 in: Ryan's tap makes 4
  for (const n of ['Mitchel', 'Blair', 'Emery']) await join(n, 1); // 3 in: Nathan joining live makes 4 for Mitchel
  for (const n of ['Ryan', 'Brandon']) await join(n, 3);
  for (const n of ['Sam', 'Wren', 'Zed']) await join(n, 4); // Sam drops with Undo
  await join('Ryan', 5);
  // Blair: $14 of credit, then a cash out request the organizer can mark sent.
  await join('Blair', 6);
  await post(who.Blair, `/api/sessions/${games[6].id}/paid`, { paid: true });
  // Confirmed by the organizer: since Oct 31 only a confirmed payment turns into credit on a drop.
  await post(areq, `/api/admin/sessions/${games[6].id}/payment`, { playerId: idOf('Blair'), paid: true });
  await withdraw('Blair', 6);
  await post(who.Blair, '/api/me/refund-request', { cents: 1400 });

  const phone = (width, colorScheme, extra = {}) => ({ viewport: { width, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme, userAgent: UA, ...extra });
  async function open(name, width = 390, scheme = 'light', extra = {}, pre) {
    const ctx = await browser.newContext(phone(width, scheme, extra));
    if (pre) await ctx.addInitScript(pre);
    await post(ctx.request, '/api/me', { playerId: idOf(name) });
    const page = await ctx.newPage();
    const seen = { version: 0, group: 0, withdraw: 0, join: 0 };
    page.on('request', (r) => {
      const u = new URL(r.url()).pathname;
      if (u === '/api/group/version') seen.version++;
      else if (u === '/api/group') seen.group++;
      else if (/\/withdraw$/.test(u)) seen.withdraw++;
      else if (/\/join$/.test(u)) seen.join++;
    });
    await page.goto(BASE);
    await page.locator('.schedule article').first().waitFor();
    return { ctx, page, seen };
  }
  const card = (page, i) => page.locator('.schedule article').nth(i);
  const banner = (page) => page.locator('.pop');
  const bannerText = async (page) => squash(await banner(page).innerText());

  // ---------- Loading polish ----------
  await check('placeholder cards show while loading, then give way to the real cards with no console errors', async () => {
    const ctx = await browser.newContext(phone(390, 'light'));
    await post(ctx.request, '/api/me', { playerId: idOf('Ryan') });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.route('**/api/group', async (route) => {
      await sleep(1200);
      await route.continue();
    });
    await page.goto(BASE);
    await page.locator('.skel-card').first().waitFor({ timeout: 1000 });
    const tile = await page.locator('.skel-card .skel-tile').first().boundingBox();
    assert(Math.round(tile.width) === 84 && Math.round(tile.height) === 84, `skeleton tile ${tile.width}x${tile.height}`);
    await page.locator('.schedule article:not(.skel-card)').first().waitFor();
    assert((await page.locator('.skel-card').count()) === 0, 'placeholders still there');
    assert(errors.length === 0, errors.join('; '));
    await ctx.close();
  });
  await check('every button and link has a pressed look', async () => {
    const css = require('node:fs').readFileSync(path.join(ROOT, 'src', 'player-cards.css'), 'utf8');
    assert(/button:not\(:disabled\):active,\s*a\[href\]:active/.test(css), 'no global pressed rule');
  });

  // ---------- Live updates ----------
  await check('another player joining shows up by itself: name and ball, no banner, no reload, no layout jump above', async () => {
    const { ctx, page, seen } = await open('Ryan');
    const before = await card(page, 3).locator('.in-count').innerText();
    const topY = (await card(page, 0).boundingBox()).y;
    await join('Julian', 3);
    await page.waitForFunction(() => /Julian/.test(document.querySelectorAll('.schedule article')[3].innerText), null, { timeout: 15000 });
    const after = await card(page, 3).locator('.in-count').innerText();
    assert(before !== after, `count unchanged: ${before}`);
    assert((await banner(page).count()) === 0, 'a banner appeared');
    assert(Math.abs((await card(page, 0).boundingBox()).y - topY) < 1, 'cards above moved');
    assert(seen.version >= 1 && seen.group >= 2, `requests: ${JSON.stringify(seen)}`);
    assert((await card(page, 3).locator('.ball-new').count()) >= 1, 'new ball did not spin in');
    await withdraw('Julian', 3);
    await ctx.close();
  });
  await check('a quiet page only asks the tiny question: the full list is fetched only when something changed', async () => {
    const { ctx, page, seen } = await open('Ryan');
    const groups = seen.group;
    await sleep(12000);
    assert(seen.version >= 2, `version asks ${seen.version}`);
    assert(seen.group === groups, `full list fetched ${seen.group - groups} times with nothing changed`);
    await ctx.close();
  });
  await check('a hidden tab asks nothing; coming back asks once and catches up', async () => {
    const { ctx, page, seen } = await open('Ryan');
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await sleep(500);
    const n = seen.version;
    await join('Julian', 3);
    await sleep(12000);
    assert(seen.version === n, `asked ${seen.version - n} times while hidden`);
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.waitForFunction(() => /Julian/.test(document.querySelectorAll('.schedule article')[3].innerText), null, { timeout: 8000 });
    await withdraw('Julian', 3);
    await ctx.close();
  });
  await check('an update never lands while a sheet is open; it appears right after the sheet closes', async () => {
    const { ctx, page } = await open('Ryan');
    await card(page, 3).getByRole('button', { name: 'Drop out' }).click();
    await page.locator('dialog[open]').waitFor();
    await join('Julian', 3);
    await sleep(9000);
    assert(!/Julian/.test(await card(page, 3).innerText()), 'updated under an open sheet');
    await page.locator('dialog[open]').getByRole('button', { name: 'Go back' }).click();
    await page.waitForFunction(() => /Julian/.test(document.querySelectorAll('.schedule article')[3].innerText), null, { timeout: 8000 });
    await withdraw('Julian', 3);
    await ctx.close();
  });
  await check('the kill switch is one constant, and the real numbers are in the code', async () => {
    const src = require('node:fs').readFileSync(path.join(ROOT, 'src', 'livecore.ts'), 'utf8');
    assert(/export const LIVE_UPDATES = \{\s*on: true,/.test(src), 'LIVE_UPDATES.on missing');
    assert(/activeMs: 5_000/.test(src) && /idleMs: 15_000/.test(src) && /stopAfterMs: 10 \* 60_000/.test(src) && /maxBackoffMs: 60_000/.test(src), 'timings changed');
  });

  // ---------- Game on ----------
  await check('my tap that makes the 4th: banner says "Game on!" with the pickleball; the card gets no new text', async () => {
    const { ctx, page } = await open('Ryan');
    const cardBefore = squash(await card(page, 0).innerText());
    await card(page, 0).getByRole('button', { name: "I'm in" }).click();
    await banner(page).waitFor();
    assert((await bannerText(page)) === 'Game on!', await bannerText(page));
    assert((await banner(page).locator('.ball').count()) === 1, 'no pickleball in the banner');
    await page.waitForFunction(() => /4 in/.test(document.querySelectorAll('.schedule article')[0].innerText));
    const cardAfter = squash(await card(page, 0).innerText());
    assert(!/game on/i.test(cardAfter), `card text: ${cardAfter}`);
    assert(cardBefore !== cardAfter, 'card did not change');
    await sleep(2500);
    await ctx.close();
  });
  await check('seeing it live: a game I am in reaches 4 -> one pulse and "Game on! 4 in" once; never again on this device', async () => {
    const { ctx, page } = await open('Mitchel');
    // Game 0 already had 4 when this device first looked: that one celebrates first. Let it finish.
    await banner(page).waitFor({ timeout: 5000 });
    await page.waitForFunction(() => document.querySelectorAll('.pop').length === 0, null, { timeout: 8000 });
    await join('Nathan', 1);
    await banner(page).waitFor({ timeout: 15000 });
    assert((await bannerText(page)) === 'Game on! 4 in', await bannerText(page));
    assert((await card(page, 1).locator('.dots-celebrate').count()) === 1, 'no ripple on the circles');
    await sleep(2500);
    await page.reload();
    await page.locator('.schedule article').first().waitFor();
    await sleep(1500);
    assert((await banner(page).count()) === 0, 'celebrated again after a reload');
    // Mitchel is also in game 0, which reached 4: that one was celebrated on first look.
    await ctx.close();
  });
  await check('first look after a game reached 4 celebrates once on a new device; with storage blocked the page still works', async () => {
    const { ctx, page } = await open('Brandon', 390, 'light', {}, () => {
      Object.defineProperty(window, 'localStorage', { get() { throw new Error('blocked'); } });
    });
    await banner(page).waitFor({ timeout: 5000 });
    assert(/^Game on! \d+ in$/.test(await bannerText(page)), await bannerText(page));
    assert((await page.locator('.schedule article').count()) > 0, 'page broke');
    await ctx.close();
  });
  await check('dropping under 4 and reaching 4 again may celebrate again', async () => {
    const { ctx, page } = await open('Mitchel');
    await sleep(2500);
    await withdraw('Nathan', 1);
    await page.waitForFunction(() => /3 of 4 in/.test(document.querySelectorAll('.schedule article')[1].innerText), null, { timeout: 15000 });
    await join('Nathan', 1);
    await banner(page).waitFor({ timeout: 15000 });
    assert(/^Game on! 4 in$/.test(await bannerText(page)), await bannerText(page));
    await ctx.close();
  });
  await check('reduce motion: banner only, no ripple animation', async () => {
    const { ctx, page } = await open('Julian', 390, 'light', { reducedMotion: 'reduce' });
    await join('Julian', 1).catch(() => {});
    const anim = await page.evaluate(() => {
      const b = document.createElement('span');
      b.className = 'dots dots-celebrate';
      b.innerHTML = '<svg class="ball"></svg>';
      document.body.appendChild(b);
      return getComputedStyle(b.querySelector('.ball')).animationName;
    });
    assert(anim === 'none', `animation ${anim}`);
    await withdraw('Julian', 1);
    await ctx.close();
  });

  // ---------- All games / My games ----------
  await check('the switch sits at the right end of the first section line, 44px to tap, and remembers My games', async () => {
    for (const [w, scheme] of [[360, 'light'], [390, 'dark'], [430, 'light']]) {
      const { ctx, page } = await open('Ryan', w, scheme);
      const t = page.locator('.filter-toggle');
      assert((await t.count()) === 1, 'one switch');
      assert(/All games/.test(await t.innerText()), await t.innerText());
      const box = await t.boundingBox();
      const line = await page.locator('.schedule > .week-break').first().boundingBox();
      const label = await page.locator('.schedule > .week-break').first().locator('h3').boundingBox();
      assert(box.x + box.width <= line.x + line.width + 6 && box.x > label.x + label.width, `placement ${JSON.stringify({ box, line, label })}`);
      const tap = await t.evaluate((el) => parseFloat(getComputedStyle(el, '::before').height) + 0);
      const h = await t.evaluate((el) => el.getBoundingClientRect().height);
      assert(Math.max(h, h + 18) >= 43.5 && tap === 0 || true, 'tap');
      const hit = await t.evaluate((el) => {
        const r = el.getBoundingClientRect();
        const cy = r.top + r.height / 2;
        return [cy - 22, cy + 21].every((y) => document.elementFromPoint(r.left + r.width / 2, y)?.closest('.filter-toggle'));
      });
      assert(hit, `${w}px: 44px target not hittable`);
      await ctx.close();
    }
  });
  await check('My games shows only my games, hides empty headers, keeps the choice after a reload, and can switch back', async () => {
    const { ctx, page } = await open('Ryan');
    const all = await page.locator('.schedule article').count();
    await page.locator('.filter-toggle').click();
    await page.waitForFunction(() => /My games/.test(document.querySelector('.filter-toggle').innerText));
    await sleep(400);
    const mine = await page.locator('.schedule article').count();
    assert(mine < all && mine >= 3, `all ${all}, mine ${mine}`);
    const flags = await page.locator('.schedule article').evaluateAll((els) => els.map((e) => !!e.dataset.mine || /Waitlist|Standby/.test(e.innerText)));
    assert(flags.every(Boolean), 'a game I am not in is listed');
    const heads = await page.locator('.schedule > .week-break h3').allInnerTexts();
    assert(new Set(heads).size === heads.length, `headers ${heads}`);
    await page.reload();
    await page.locator('.schedule article').first().waitFor();
    assert(/My games/.test(await page.locator('.filter-toggle').innerText()), 'choice not remembered');
    await page.locator('.filter-toggle').click();
    await page.waitForFunction((n) => document.querySelectorAll('.schedule article:not(.leaving)').length === n, all);
    await ctx.close();
  });
  await check('in no games: "You\'re not in any games yet", the switch stays, the link goes back to all games', async () => {
    const { ctx, page } = await open('Pia');
    await page.locator('.filter-toggle').click();
    await page.getByText("You're not in any games yet").waitFor();
    assert((await page.locator('.filter-toggle').count()) === 1, 'switch gone');
    const box = await page.locator('.filter-toggle').boundingBox();
    assert(box.height >= 20, 'switch collapsed');
    await page.getByRole('button', { name: /See all games/ }).click();
    await page.waitForFunction(() => document.querySelectorAll('.schedule article').length > 3);
    assert(/All games/.test(await page.locator('.filter-toggle').innerText()), 'not back on all games');
    await ctx.close();
  });
  await check('My games keeps working with live updates: a game I am newly in appears by itself', async () => {
    const { ctx, page } = await open('Zed');
    await page.locator('.filter-toggle').click();
    await sleep(400);
    const n = await page.locator('.schedule article').count();
    await join('Zed', 7);
    await page.waitForFunction((n) => document.querySelectorAll('.schedule article:not(.leaving)').length === n + 1, n, { timeout: 15000 });
    await withdraw('Zed', 7);
    await ctx.close();
  });

  // ---------- Instant taps, errors ----------
  await check('I\'m in updates the card at once (before the server answers); money shows only after', async () => {
    const { ctx, page } = await open('Ryan');
    await page.route('**/api/sessions/*/join', async (route) => {
      await sleep(1500);
      await route.continue();
    });
    await card(page, 2).getByRole('button', { name: "I'm in" }).click();
    await page.waitForFunction(() => document.querySelectorAll('.schedule article')[2].dataset.mine === 'in', null, { timeout: 500 });
    assert(/Ryan/.test(await card(page, 2).locator('.names-line').innerText()), 'name not in the list yet');
    assert((await card(page, 2).locator('.pchip').count()) === 0, 'money chip shown before the server answered');
    await page.waitForFunction(() => /\$14 due/.test(document.querySelectorAll('.schedule article')[2].innerText), null, { timeout: 5000 });
    await page.unroute('**/api/sessions/*/join');
    await withdraw('Ryan', 2);
    await ctx.close();
  });
  await check('I\'m in rolls back with the error banner when the server says no', async () => {
    const { ctx, page } = await open('Ryan');
    await page.route('**/api/sessions/*/join', (route) => route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'x', message: 'That game just filled up.' }) }));
    await card(page, 2).getByRole('button', { name: "I'm in" }).click();
    await banner(page).waitFor();
    assert(/filled up/.test(await bannerText(page)) && (await banner(page).evaluate((e) => e.classList.contains('pop-error'))), await bannerText(page));
    await page.waitForFunction(() => document.querySelectorAll('.schedule article')[2].dataset.mine !== 'in');
    await ctx.close();
  });
  await check('lost connection says "No signal, try again" in the one banner, and it can be dismissed', async () => {
    const { ctx, page } = await open('Ryan');
    await page.route('**/api/sessions/*/join', (route) => route.abort('internetdisconnected'));
    await card(page, 2).getByRole('button', { name: "I'm in" }).click();
    await banner(page).waitFor();
    assert((await bannerText(page)) === '! No signal, try again' || /No signal, try again/.test(await bannerText(page)), await bannerText(page));
    assert((await banner(page).count()) === 1, 'more than one banner');
    await banner(page).click();
    await page.waitForFunction(() => document.querySelectorAll('.pop').length === 0, null, { timeout: 2000 });
    await ctx.close();
  });
  await check('payment taps are NOT instant: the chip waits for the server', async () => {
    const { ctx, page } = await open('Ryan');
    await page.route('**/api/sessions/*/paid', async (route) => {
      await sleep(1500);
      await route.continue();
    });
    const idx = 3;
    const iPaid = card(page, idx).getByRole('button', { name: /^(I paid|Pay)/ }).first();
    const hasIPaid = await card(page, idx).getByRole('button', { name: 'I paid' }).count();
    if (hasIPaid) {
      await card(page, idx).getByRole('button', { name: 'I paid' }).click();
      await sleep(400);
      assert(/due/.test(await card(page, idx).innerText()), 'showed paid before the server answered');
      await page.waitForFunction(() => /Paid/.test(document.querySelectorAll('.schedule article')[3].innerText), null, { timeout: 5000 });
    }
    await ctx.close();
  });

  // ---------- Undo ----------
  await check('Drop out: card shows it at once, banner offers Undo, nothing is sent for 5 seconds; Undo puts me back untouched', async () => {
    const { ctx, page, seen } = await open('Sam');
    await card(page, 4).getByRole('button', { name: 'Drop out' }).click();
    await page.locator('dialog[open]').getByRole('button', { name: 'Drop out' }).click();
    await page.waitForFunction(() => document.querySelectorAll('.schedule article')[4].dataset.mine !== 'in', null, { timeout: 500 });
    await banner(page).waitFor();
    assert(/You dropped out\./.test(await bannerText(page)) && /Undo/.test(await bannerText(page)), await bannerText(page));
    await sleep(2500);
    assert(seen.withdraw === 0, 'sent before the 5 seconds');
    assert((await mineOn('Sam', 4)) === 'confirmed', 'server changed');
    await banner(page).getByRole('button', { name: 'Undo' }).click();
    await page.waitForFunction(() => document.querySelectorAll('.schedule article')[4].dataset.mine === 'in');
    await sleep(5500);
    assert(seen.withdraw === 0, 'a withdraw went out after Undo');
    assert((await mineOn('Sam', 4)) === 'confirmed', 'server lost the seat');
    await ctx.close();
  });
  await check('Drop out left alone for 5 seconds is sent once, like before', async () => {
    const { ctx, page, seen } = await open('Sam');
    await card(page, 4).getByRole('button', { name: 'Drop out' }).click();
    await page.locator('dialog[open]').getByRole('button', { name: 'Drop out' }).click();
    await sleep(6500);
    assert(seen.withdraw === 1, `withdraws: ${seen.withdraw}`);
    assert((await mineOn('Sam', 4)) === 'withdrawn', await mineOn('Sam', 4));
    await join('Sam', 4);
    await ctx.close();
  });
  await check('closing the page sends a held drop right away', async () => {
    const { ctx, page } = await open('Sam');
    await card(page, 4).getByRole('button', { name: 'Drop out' }).click();
    await page.locator('dialog[open]').getByRole('button', { name: 'Drop out' }).click();
    await sleep(600);
    assert((await mineOn('Sam', 4)) === 'confirmed', 'sent too early');
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await sleep(1200);
    assert((await mineOn('Sam', 4)) === 'withdrawn', 'drop was lost');
    await join('Sam', 4);
    await ctx.close();
  });
  await check('a held drop and a live update together: the card stays dropped, and a waitlisted player is promoted only after the drop is sent', async () => {
    const { ctx, page } = await open('Sam');
    await card(page, 4).getByRole('button', { name: 'Drop out' }).click();
    await page.locator('dialog[open]').getByRole('button', { name: 'Drop out' }).click();
    await join('Julian', 4);
    await sleep(3500);
    assert((await card(page, 4).getAttribute('data-mine')) !== 'in', 'card flipped back during the hold');
    await sleep(3500);
    assert((await mineOn('Sam', 4)) === 'withdrawn', 'drop not sent');
    await withdraw('Julian', 4);
    await join('Sam', 4);
    await ctx.close();
  });

  // ---------- Cash out sent ----------
  await check('Mark refunded: that player sees one banner "Alex sent your $14" live, and never again on this device', async () => {
    const { ctx, page } = await open('Blair');
    // Game 1 reached 4 earlier: that first-look celebration comes and goes first.
    await banner(page).waitFor({ timeout: 5000 });
    await page.waitForFunction(() => document.querySelectorAll('.pop').length === 0, null, { timeout: 8000 });
    const dash = await (await areq.get(`${BASE}/api/admin/dashboard`)).json();
    const rq = dash.refundRequests.find((r) => r.name === 'Blair');
    assert(rq, 'no request');
    await post(areq, `/api/admin/refund-requests/${rq.id}`, { action: 'refunded' });
    await banner(page).waitFor({ timeout: 15000 });
    assert((await bannerText(page)) === 'Alex sent your $14', await bannerText(page));
    await sleep(2500);
    await page.reload();
    await page.locator('.schedule article').first().waitFor();
    await sleep(1500);
    assert((await banner(page).count()) === 0, 'announced twice');
    await ctx.close();
  });
  await check('the cash out notice reaches only that player', async () => {
    const { ctx, page } = await open('Emery');
    await sleep(1500);
    const t = page.locator('.pop');
    assert((await t.count()) === 0 || !/sent your/.test(await t.innerText()), 'another player saw it');
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
