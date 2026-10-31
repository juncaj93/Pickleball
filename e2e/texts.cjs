/* The organizer's Text menu, payment reminders, and the player's unpaid card,
 * on a phone: only the texts that fit the game, who each goes to, the exact
 * words, nothing cut off or overlapping, and the card that stays until paid.
 *
 *   node e2e/texts.cjs      (also run by npm run test:e2e)
 *
 * Starts its own dev server with a fresh fake group (Alex is the organizer).
 * Opening a text only builds an sms: link; nothing is ever sent.
 */
const { spawn } = require('node:child_process');
const { rmSync, mkdirSync } = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.E2E_PORT) || 5193;
const BASE = `http://localhost:${PORT}`;
const SETUP_TOKEN = 'texts-setup-token-0123456789';
const PIN = '482913';
const SHOTS = path.join(__dirname, 'screenshots');
const PEOPLE = ['Alex', 'Ryan', 'Brandon', 'Julian', 'Mitchel', 'Nathan'];

let passed = 0;
let failed = 0;
async function check(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.log(`  ✗ ${name}\n      ${String(err && err.message ? err.message : err).replace(/\s*\n\s*/g, ' ⏎ ').slice(0, 600)}`);
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
const squash = (t) => t.replace(/\s+/g, ' ').trim();
const nav = (page, name) => page.getByRole('navigation', { name: 'Organizer sections' }).getByRole('button', { name: new RegExp(`^${name}`) });
function smsOf(href) {
  const m = href.match(/^sms:(?:\/\/open\?addresses=)?([^?&]*)[?&]body=(.*)$/);
  if (!m) throw new Error(`not an sms link: ${href}`);
  return { to: m[1] ? m[1].split(',') : [], body: decodeURIComponent(m[2]) };
}

async function main() {
  const dbFile = path.join(ROOT, '.data', 'texts.sqlite');
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
  // The pretend "now" for the server and for every browser page (so Home's time-based lists agree).
  let simNow = Date.now();
  const clock = (iso) => {
    simNow = Date.parse(iso);
    return fetch(`${BASE}/__dev/clock`, { method: 'POST', body: JSON.stringify({ atMs: simNow }) });
  };
  await clock('2026-10-26T12:00:00-04:00'); // Mon Oct 26, 12:00 PM Eastern

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
    // Nathan has no number saved.
    players: PEOPLE.map((name, i) => ({ name, phone: name === 'Nathan' ? undefined : `248555010${i}` })),
  });
  await call(api.request, 'PUT', '/api/admin/group', { organizerName: 'Alex' });
  // Pay prompts and Use credit only show once a court is booked (a game with no court reads like a normal game; see e2e/no-court.cjs),
  // so the games in this fixture have a court.
  const d0 = await call(api.request, 'GET', '/api/admin/dashboard');
  for (const s of d0.sessions.filter((x) => !x.state.flags.past)) await call(api.request, 'POST', `/api/admin/sessions/${s.id}/booked`, {});
  const id = Object.fromEntries(d0.players.map((p) => [p.name, p.id]));
  const [tue, thu] = d0.sessions; // Tue Oct 27, Thu Oct 29
  console.log('sessions', d0.sessions.slice(0, 3).map((s) => s.startsAt));
  const confirm = (s, n) => call(api.request, 'POST', `/api/admin/sessions/${s.id}/roster`, { playerId: id[n], action: 'confirm' });
  // Tue: Alex (organizer), Ryan, Brandon, Nathan (no number): exactly 4. Thu: Ryan and Mitchel: 2 in.
  await call(api.request, 'POST', `/api/admin/sessions/${tue.id}/me`, { in: true });
  for (const n of ['Ryan', 'Brandon', 'Nathan']) await confirm(tue, n);
  for (const n of ['Ryan', 'Mitchel']) await confirm(thu, n);
  const phone = (n) => `+1248555010${PEOPLE.indexOf(n)}`;

  const open = async (scheme, width) => {
    const ctx = await browser.newContext({ viewport: { width, height: 860 }, isMobile: true, hasTouch: true, colorScheme: scheme });
    await ctx.clock.setFixedTime(simNow);
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await ctx.request.post(BASE + '/api/admin/login', { headers: { Origin: BASE }, data: { pin: PIN } });
    await page.goto(BASE + '/admin');
    return { ctx, page, errors };
  };
  const cardFor = (page, s) => page.locator(`#session-${s.id}`);
  async function menuOf(page, s) {
    const card = cardFor(page, s);
    await card.waitFor({ timeout: 6000 }).catch(async (e) => {
      await page.screenshot({ path: path.join(SHOTS, 'texts-debug.png'), fullPage: true });
      throw e;
    });
    const gear = card.getByRole('button', { name: /^Game menu for/ });
    if ((await gear.getAttribute('aria-expanded')) !== 'true') await gear.click();
    const btn = card.getByRole('menuitem', { name: 'Text the group', exact: true });
    if ((await btn.getAttribute('aria-expanded')) !== 'true') await btn.click();
    const menu = card.locator('.text-menu');
    await menu.locator('.text-row').first().waitFor();
    return menu;
  }
  const names = async (menu) => (await menu.locator('.text-row .text-name').allInnerTexts()).map((x) => x.trim());
  const fits = (menu) =>
    menu.evaluate((el) => {
      const box = el.getBoundingClientRect();
      const rows = [...el.querySelectorAll('.text-choice')].map((a) => a.getBoundingClientRect());
      const cut = [...el.querySelectorAll('.text-name, .text-who, .missing-numbers')].filter((x) => x.scrollWidth > x.clientWidth + 1).length;
      const out = [...el.querySelectorAll('*')].filter((x) => { const r = x.getBoundingClientRect(); return r.width > 0 && (r.right > box.right + 1 || r.left < box.left - 1); }).length;
      let overlap = false;
      for (let i = 1; i < rows.length; i++) if (rows[i].top < rows[i - 1].bottom - 1) overlap = true;
      return { tall: rows.every((r) => r.height >= 44), cut, out, overlap, sideways: document.documentElement.scrollWidth - window.innerWidth };
    });

  for (const scheme of ['light', 'dark']) {
    for (const width of [360, 375, 390, 430]) {
      const tag = `${width}px ${scheme}`;
      const { ctx, page, errors } = await open(scheme, width);
      await check(`${tag}: 4 in: Share the game (group chat) and Check-in (saved numbers, missing named); no Day before, Last call or Spot open`, async () => {
        const menu = await menuOf(page, tue);
        const list = await names(menu);
        assert(JSON.stringify(list) === JSON.stringify(['Share the game', 'Check-in']), `menu: ${list}`);
        const share = menu.locator('[data-text="share"]');
        const sh = smsOf(await share.locator('a').getAttribute('href'));
        assert(sh.to.length === 0 && /^Pickleball (?:tonight|tomorrow|today|Tue Oct 27), 8:00 PM\. In or out here: \S+$/.test(sh.body), `share: ${sh.body}`);
        assert((await share.locator('.text-who').innerText()).trim() === 'Group chat, you pick', 'share who');
        const ci = menu.locator('[data-text="checkin"]');
        const c = smsOf(await ci.locator('a').getAttribute('href'));
        assert(JSON.stringify(c.to.sort()) === JSON.stringify([phone('Ryan'), phone('Brandon')].sort()), `check-in numbers: ${c.to}`);
        assert(/^Pickleball (tomorrow|today|tonight), 8:00 PM\. Can't make it\? Update here: \S+$/.test(c.body), `check-in: ${c.body}`);
        assert(!/ASAP|text me|\bsent\b/i.test(c.body), 'bad words');
        assert((await ci.locator('.text-who').innerText()).trim() === 'Everyone signed up', 'check-in who');
        await ci.getByText('Missing numbers: Nathan').waitFor();
        const f = await fits(menu);
        assert(f.tall && f.cut === 0 && f.out === 0 && !f.overlap && f.sideways <= 0, `layout ${JSON.stringify(f)}`);
        if (width === 390) await page.screenshot({ path: path.join(SHOTS, `texts-menu-${scheme}.png`) });
      });
      await check(`${tag}: 2 in: Share the game and Need players (need 2); no Check-in`, async () => {
        const menu = await menuOf(page, thu);
        const list = await names(menu);
        assert(JSON.stringify(list) === JSON.stringify(['Share the game', 'Need players']), `menu: ${list}`);
        const need = smsOf(await menu.locator('[data-text="need"] a').getAttribute('href'));
        assert(need.to.length === 0 && /^Need 2 more for pickleball Thu Oct 29, 8:00 PM\. In\? \S+$/.test(need.body), `need: ${need.body}`);
        const f = await fits(menu);
        assert(f.tall && f.cut === 0 && f.out === 0 && !f.overlap && f.sideways <= 0, `layout ${JSON.stringify(f)}`);
      });
      await check(`${tag}: tapping a text says Message ready, never sent`, async () => {
        const menu = await menuOf(page, thu);
        await menu.locator('[data-text="share"] a').evaluate((a) => a.addEventListener('click', (e) => e.preventDefault(), { once: true }));
        await menu.locator('[data-text="share"] a').click();
        await menu.getByText('Message ready', { exact: true }).waitFor();
        assert(!/\bsent\b/i.test(await menu.innerText()), 'says sent');
      });
      await check(`${tag}: no browser errors`, async () => assert(errors.length === 0, errors.join(' | ')));
      await ctx.close();
    }
  }

  // ---- 5 in, then 6 in: still just Share the game and Check-in (Down to 5 and Now 6 are gone).
  for (const [add, n] of [[["Julian"], 5], [["Mitchel"], 6]]) {
    for (const name of add) await confirm(tue, name);
    const { ctx, page } = await open('light', 390);
    await check(`${n} in: the menu is still Share the game and Check-in; the Check-in goes to everyone signed up; no Down to 5 or Now 6`, async () => {
      await page.locator(`#session-${tue.id} .players-count`, { hasText: new RegExp(`^${n} in$`) }).waitFor();
      const menu = await menuOf(page, tue);
      const list = await names(menu);
      assert(JSON.stringify(list) === JSON.stringify(['Share the game', 'Check-in']), `menu: ${list}`);
      assert((await menu.locator('[data-text="down5"], [data-text="now6"]').count()) === 0, 'old rows');
      const c = smsOf(await menu.locator('[data-text="checkin"] a').getAttribute('href'));
      assert(c.to.length === n - 2, `check-in numbers with ${n} in (Nathan has none, Alex is me): ${c.to}`);
      assert(!/Good news|even number|6 for pickleball/.test(await menu.innerText()), 'old wording');
    });
    await ctx.close();
  }
  for (const name of ['Julian', 'Mitchel']) await call(api.request, 'POST', `/api/admin/sessions/${tue.id}/roster`, { playerId: id[name], action: 'withdraw' });

  // ---- Payment reminders on the Money tab (game day: Tue Oct 27, 10:00 AM).
  await clock('2026-10-27T10:00:00-04:00');
  await call(api.request, 'POST', `/api/admin/sessions/${thu.id}/roster`, { playerId: id.Brandon, action: 'confirm' });
  await call(api.request, 'POST', `/api/admin/sessions/${thu.id}/roster`, { playerId: id.Julian, action: 'confirm' });
  for (const scheme of ['light', 'dark']) {
    for (const width of [360, 430]) {
      const tag = `${width}px ${scheme}`;
      const { ctx, page } = await open(scheme, width);
      await nav(page, 'Money').click();
      await check(`${tag}: Money: 2 or more unpaid shows "Remind all unpaid" to just their numbers, with Missing numbers`, async () => {
        const draft = page.locator('.draft', { hasText: 'Remind all unpaid' });
        await draft.waitFor();
        const t = squash(await draft.innerText());
        assert(/Missing numbers: Nathan/.test(t), t);
        assert(/Hey, looks like you haven't paid for pickleball yet\. Pay here: \S+/.test(t), t);
        const link = smsOf(await draft.getByRole('link', { name: 'Remind all unpaid' }).getAttribute('href'));
        assert(!link.to.includes(phone('Alex')) && link.to.length === 2, `numbers: ${link.to}`);
        assert((await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 0, 'sideways scroll');
      });
      await check(`${tag}: Money: one player's reminder names the game; owing two games gives the total`, async () => {
        const sess = page.locator(`details.money-sess[data-session="${tue.id}"]`);
        await sess.waitFor();
        if (!(await sess.evaluate((el) => el.open))) await sess.locator('summary').click();
        const row = sess.locator('li.pay-row', { hasText: 'Brandon' });
        await row.getByRole('button', { name: 'Payment reminder' }).click();
        const body = squash(await row.locator('.bubble').innerText());
        // Brandon is in Tue (today) and Thu (Thu has 4 by then), but Thu is not due yet: one game.
        assert(/^Hey Brandon, you owe \$14 for pickleball Tue Oct 27\. Pay here: \S+$/.test(body), body);
        const ryan = sess.locator('li.pay-row', { hasText: 'Ryan' });
        assert((await ryan.count()) === 1, 'Ryan not on Tue');
      });
      await ctx.close();
    }
  }

  // ---- The player's unpaid card: one compact card, stays until paid, even for past games.
  await call(api.request, 'POST', `/api/admin/sessions/${tue.id}/payment`, { playerId: id.Brandon, paid: true });
  await clock('2026-10-29T10:00:00-04:00'); // Thu morning: Tue is over, Thu is today
  const player = async (name, width, scheme) => {
    const ctx = await browser.newContext({ viewport: { width, height: 860 }, isMobile: true, hasTouch: true, colorScheme: scheme });
    await ctx.clock.setFixedTime(simNow);
    await call(ctx.request, 'POST', '/api/me', { playerId: id[name] });
    const page = await ctx.newPage();
    await page.goto(BASE + '/');
    await page.locator('.schedule article, .pay-card').first().waitFor();
    return { ctx, page };
  };
  for (const scheme of ['light', 'dark']) {
    for (const width of [360, 375, 390, 430]) {
      const tag = `${width}px ${scheme}`;
      await check(`${tag}: Ryan owes Tue (past) and Thu: ONE compact card at the top with both games and the total`, async () => {
        const { ctx, page } = await player('Ryan', width, scheme);
        assert((await page.locator('.pay-card').count()) === 1, 'more than one pay card');
        const card = page.locator('.pay-card');
        const t = squash(await card.innerText());
        assert(/You owe \$28 total/.test(t) && /Tue, Oct 27: \$14/.test(t) && /Thu, Oct 29: \$14/.test(t), t);
        await card.getByRole('link', { name: /^Pay \$28 with Venmo/ }).waitFor();
        await card.getByRole('button', { name: 'I paid' }).waitFor();
        const top = await card.evaluate((el) => el.getBoundingClientRect().top);
        assert(top < 140, `card is not at the top: ${top}px`);
        const f = await page.evaluate(() => ({ sideways: document.documentElement.scrollWidth - window.innerWidth }));
        assert(f.sideways <= 0, 'sideways scroll');
        assert(!/Northville|court cost|\(248\)|248555/i.test(await page.locator('body').innerText()), 'private info on a player screen');
        if (width === 390) await page.screenshot({ path: path.join(SHOTS, `texts-paycard-${scheme}.png`) });
        await ctx.close();
      });
    }
  }
  await check('Alex (organizer) and Brandon (paid Tue, Thu not due yet owes Thu): no card for the organizer; Brandon sees only Thu', async () => {
    const a = await player('Alex', 390, 'light');
    assert((await a.page.locator('.pay-card').count()) === 0, 'organizer sees a pay card');
    await a.ctx.close();
    const b = await player('Brandon', 390, 'light');
    const t = squash(await b.page.locator('.pay-card').innerText());
    assert(/you owe \$14/i.test(t) && !/Tue, Oct 27/.test(t), t);
    await b.ctx.close();
    const m = await player('Mitchel', 390, 'light');
    await m.page.locator('.pay-card').waitFor();
    await m.ctx.close();
  });
  await check('a canceled game never shows the card, and once paid it goes away', async () => {
    await call(api.request, 'POST', `/api/admin/sessions/${thu.id}/decision`, { decision: 'cancel', confirm: true });
    const m = await player('Mitchel', 390, 'light');
    assert((await m.page.locator('.pay-card').count()) === 0, 'card for a canceled game');
    await m.ctx.close();
    const r = await player('Ryan', 390, 'light');
    const t = squash(await r.page.locator('.pay-card').innerText());
    assert(/You owe \$14 for Tue, Oct 27/.test(t), t); // the past, unpaid game still stays
    await r.page.getByRole('button', { name: 'I paid' }).first().click();
    await r.page.locator('.pay-card').waitFor({ state: 'detached' });
    await r.ctx.close();
  });

  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
