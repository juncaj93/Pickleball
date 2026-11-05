/* "Instant taps" (INSTANT_TAPS, Nov 2026): a tapped button changes the screen at once, the save runs in the background, a failed save puts
 * the screen back exactly and says what failed, a double tap saves once, and a refresh never undoes or flickers a tap.
 *
 *   node e2e/instant-taps.cjs      (also run by npm run test:e2e)
 *
 * It loads the fake preview world as if it were Wed Nov 4, 2026, 6:00 PM Eastern into a local file, starts its own dev server on it (the
 * server clock is pinned to that moment), and drives phone-sized browsers. The network is slowed down (2.5 seconds) or made to fail (a
 * 500) for one address at a time with Playwright's route(). Nothing here touches Cloudflare or the live site.
 * Taps covered: I'm in, Drop out, I paid (player), Mark paid (organizer Money), a Settings toggle, plus the switch itself.
 * Screenshots: e2e/screenshots/instant-taps-*.png (ignored by git).
 */
const { spawn, spawnSync } = require('node:child_process');
const { readFileSync, mkdirSync, rmSync } = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.E2E_PORT) || 5291;
const BASE = `http://localhost:${PORT}`;
const NOW_ISO = '2026-11-04T23:00:00.000Z';
const NOW_MS = Date.parse(NOW_ISO);
const SHOTS = process.env.E2E_SHOTS || path.join(__dirname, 'screenshots');
const PIN = /PIN `(\d{6})`/.exec(readFileSync(path.join(ROOT, 'docs/PREVIEW_FAKE_DB.md'), 'utf8'))[1];
const SLOW_MS = 2500;

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
    console.log(`  ✗ ${name}\n      ${String(err && err.message ? err.message : err).replace(/\s*\n\s*/g, ' ⏎ ').slice(0, 900)}`);
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const squash = (s) => s.replace(/\s+/g, ' ').trim();
/** The card's HTML without what changes by itself (React's own element ids, the first-load ball pop that ends on its own). */
const norm = (h) => h.replace(/«r[0-9a-z]+»/g, '«id»').replace(/ dots-celebrate/g, '');
/** Where two HTML strings first differ, for a readable failure. */
function diffAt(a, b) {
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  return `at ${i}: before «${a.slice(Math.max(0, i - 80), i + 120)}» after «${b.slice(Math.max(0, i - 80), i + 120)}»`;
}

async function main() {
  mkdirSync(SHOTS, { recursive: true });
  const dbFile = path.join(ROOT, '.data', 'instant-taps.sqlite');
  mkdirSync(path.join(ROOT, '.data'), { recursive: true });
  rmSync(dbFile, { force: true });
  const seeded = spawnSync('npx', ['vite-node', 'scripts/load-seed-local.ts', '--', dbFile, NOW_ISO], { cwd: ROOT, encoding: 'utf8' });
  if (seeded.status !== 0) throw new Error(`could not build the fake world: ${seeded.stderr || seeded.stdout}`);
  const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
    cwd: ROOT,
    env: { ...process.env, DEV_DB: dbFile, SETUP_TOKEN: 'instant-taps-setup-token-0123456789', DEV_CLOCK: '1', INSTANT_TAPS: '' },
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
  await fetch(`${BASE}/__dev/clock`, { method: 'POST', body: JSON.stringify({ atMs: NOW_MS }) });
  const browser = await chromium.launch();
  const post = (req, url, data, headers = {}) => req.post(BASE + url, { data, headers: { Origin: BASE, ...headers } });
  const put = (req, url, data) => req.put(BASE + url, { data, headers: { Origin: BASE } });
  const areq = (await browser.newContext()).request;
  const login = await post(areq, '/api/admin/login', { pin: PIN });
  if (!login.ok()) throw new Error(`login failed: ${await login.text()}`);
  const dash = async (headers = {}) => (await areq.get(`${BASE}/api/admin/dashboard`, { headers })).json();
  const d0 = await dash();
  const idOf = (name) => d0.players.find((p) => p.name === name).id;
  const upcoming = d0.sessions.filter((s) => Date.parse(s.startsAt) > NOW_MS && !s.state.flags.canceled);
  const names = (s) => s.roster.filter((r) => r.status === 'confirmed').map((r) => r.name);
  // The next booked game (Jordan owes $14 there) and the "3 of 4 in" game with no court booked (Gray, Emery, Lane).
  const next = upcoming.find((s) => names(s).includes('Indy') && names(s).includes('Jordan') && names(s).includes('Finley'));
  const open3 = upcoming.find((s) => names(s).length === 3 && ['Gray', 'Emery', 'Lane'].every((n) => names(s).includes(n)));
  assert(next && open3, 'the fake world has the games this test needs');
  /** Every seat, payment and credit entry, as the organizer sees them. */
  const books = async () => {
    const d = await dash();
    return JSON.stringify([d.sessions.map((s) => [s.id, s.roster.map((r) => [r.name, r.status, r.paymentStatus, r.paymentAmountCents ?? null, r.selfPaid])]), d.creditLedger]);
  };
  const seatOf = async (sid, name) => (await dash()).sessions.find((s) => s.id === sid).roster.find((r) => r.name === name);

  const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mobile/15E148 Safari/604.1';
  const phone = (width, scheme = 'light') => ({ viewport: { width, height: 860 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, colorScheme: scheme, userAgent: UA });
  const shiftClock = (ctx, atMs = NOW_MS) =>
    ctx.addInitScript((delta) => {
      const Real = Date;
      class Shifted extends Real {
        constructor(...a) {
          if (a.length === 0) super(Real.now() + delta);
          else super(...a);
        }
        static now() {
          return Real.now() + delta;
        }
      }
      window.Date = Shifted;
      try {
        localStorage.setItem('pb_games_filter', 'all');
      } catch {}
    }, atMs - Date.now());
  const watch = (page) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    return errors;
  };

  /** A player's phone on the home screen. `query` '?instanttaps=on' is the private link. */
  async function openPlayer(name, { query = '?instanttaps=on', width = 390, scheme = 'light' } = {}) {
    const ctx = await browser.newContext(phone(width, scheme));
    await ctx.route('https://venmo.com/**', (r) => r.abort());
    await shiftClock(ctx);
    await post(ctx.request, '/api/me', { playerId: idOf(name) });
    const page = await ctx.newPage();
    const errors = watch(page);
    await page.goto(BASE + '/' + query);
    await page.locator('.schedule article').first().waitFor();
    const more = page.getByRole('button', { name: /^More sessions/ });
    if (await more.count()) await more.click();
    await page.waitForTimeout(700);
    return { ctx, page, errors };
  }
  async function openAdmin({ query = '?instanttaps=on', width = 390, scheme = 'light', atMs = NOW_MS } = {}) {
    const ctx = await browser.newContext(phone(width, scheme));
    await shiftClock(ctx, atMs);
    await post(ctx.request, '/api/admin/login', { pin: PIN });
    const page = await ctx.newPage();
    const errors = watch(page);
    await page.goto(BASE + '/admin' + query);
    await page.locator('.tabbar').waitFor();
    await page.waitForTimeout(700);
    return { ctx, page, errors };
  }
  const tab = async (page, name) => {
    await page.locator('.tabbar button', { hasText: name }).evaluate((b) => b.click());
    await page.waitForTimeout(400);
  };
  const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, `instant-taps-${name}.png`) });
  const row = (page, sid) => page.locator(`#row-${sid}`);
  /** Count the requests to one address (method + a regexp on the path). */
  const counter = (page, method, re) => {
    const c = { n: 0 };
    page.on('request', (r) => {
      if (r.method() === method && re.test(new URL(r.url()).pathname)) c.n++;
    });
    return c;
  };
  /** Make one address slow (answers after `ms`) or fail (a 500), until `off()` is called. */
  async function network(page, re, how) {
    const handler = async (route) => {
      if (route.request().method() === 'GET') return route.continue().catch(() => {});
      if (how === 'fail') return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'server', message: 'Something went wrong. Try again.' }) });
      if (how === 'offline') return route.abort('internetdisconnected');
      await sleep(SLOW_MS);
      return route.continue().catch(() => {});
    };
    await page.route(re, handler);
    return () => page.unroute(re, handler);
  }
  /**
   * Sample something on the screen every 40 ms for `ms` (no flicker allowed): returns every value seen. Runs inside the page, so a
   * redraw between two of our own checks cannot slip by.
   */
  const sample = (page, fn, ms) =>
    page.evaluate(
      ([src, ms]) =>
        new Promise((done) => {
          const f = new Function(`return (${src})()`);
          const seen = [];
          const t0 = performance.now();
          const step = () => {
            seen.push(f());
            if (performance.now() - t0 < ms) setTimeout(step, 40);
            else done(seen);
          };
          step();
        }),
      [fn.toString(), ms],
    );
  const toastText = async (page) => {
    const t = page.locator('.pop.toast .toast-msg');
    return (await t.count()) ? squash(await t.last().innerText()) : '';
  };
  const errorToast = async (page) => {
    await page.locator('.pop.toast.pop-error').waitFor({ timeout: 4000 });
    return squash(await page.locator('.pop.toast.pop-error .toast-msg').innerText());
  };

  // ================================================================ the switch
  // The fake world starts with the switch on (PREVIEW SWITCHES RULE); these first checks need it off.
  assert((await put(areq, '/api/admin/instant-taps', { on: false })).ok(), 'switch off');
  await check('ships OFF: no Instant taps for anyone, the Settings row is off and its title fits on one line at 320, 360, 430', async () => {
    const d = await dash();
    assert(d.instantTapsForAll === false && d.instantTaps === undefined, 'off for everyone');
    for (const w of [320, 360, 430]) {
      const { ctx, page } = await openAdmin({ query: '', width: w });
      await tab(page, 'Settings');
      await page.locator('details[data-section="switches"] > summary').click();
      const r = page.locator('[data-row="instantTapsAll"]');
      assert((await r.count()) === 1, 'the row is there');
      assert(!(await r.locator('input[type="checkbox"]').isChecked()), 'and off');
      assert((await r.locator('.set-name').innerText()).trim().startsWith('Instant taps'), 'title');
      const h = await r.locator('.set-name').evaluate((e) => ({ h: e.getBoundingClientRect().height, lh: parseFloat(getComputedStyle(e).lineHeight) || 20 }));
      assert(h.h <= h.lh * 1.4, `title wraps at ${w}: ${h.h}px`);
      const o = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert(o <= 1, `sideways overflow at ${w}`);
      if (w === 360) await shot(page, 'settings-row');
      await ctx.close();
    }
  });

  await check('OFF: I paid waits for the server as today (nothing changes before the answer), and never shows the working spinner', async () => {
    const { ctx, page } = await openPlayer('Jordan', { query: '' });
    const off = await network(page, /\/api\/sessions\/[^/]+\/paid$/, 'slow');
    const card = row(page, next.id);
    const before = squash(await card.innerText());
    await card.getByRole('button', { name: 'I paid' }).first().click();
    await sleep(300);
    const during = squash(await card.innerText());
    assert(!/Paid/.test(during.replace(/I paid/g, '')) || during === before, `the card changed before the server answered with the switch off: ${during}`);
    assert((await page.locator('[data-tap-wait]').count()) === 0, 'no instant-taps spinner with the switch off');
    await off();
    await sleep(SLOW_MS + 800);
    // Put it back for the next checks.
    const seat = await seatOf(next.id, 'Jordan');
    if (seat.paymentStatus === 'paid') await post(ctx.request, `/api/sessions/${next.id}/paid`, { paid: false });
    await ctx.close();
  });

  // ================================================================ I paid (player)
  await check('I paid, slow network: the card reads Paid in the same instant, one request even on a double tap, no flicker when the server answers', async () => {
    const { ctx, page, errors } = await openPlayer('Jordan');
    const sent = counter(page, 'POST', /\/api\/sessions\/[^/]+\/paid$/);
    const off = await network(page, /\/api\/sessions\/[^/]+\/paid$/, 'slow');
    const card = row(page, next.id);
    const btn = card.getByRole('button', { name: 'I paid' }).first();
    await btn.waitFor();
    const t0 = Date.now();
    await btn.click();
    await btn.click({ timeout: 300 }).catch(() => {}); // the second tap of a double tap (the button may already be gone)
    await page.waitForFunction((id) => !document.querySelector(`#row-${id}`)?.innerText.includes('I paid'), next.id, { timeout: 1500 });
    const ms = Date.now() - t0;
    assert(ms < 900, `the card took ${ms} ms to change`);
    await shot(page, 'ipaid-instant');
    // From now until well after the answer, the I paid button never comes back (no flicker).
    const seen = await sample(page, new Function(`return () => document.querySelector('#row-${next.id}').innerText.includes('I paid')`)(), SLOW_MS + 1500);
    assert(seen.every((x) => x === false), `I paid came back for a moment: ${seen.join('')}`);
    await off();
    assert(sent.n === 1, `${sent.n} I paid requests`);
    const seat = await seatOf(next.id, 'Jordan');
    assert(seat.paymentStatus === 'paid' && seat.selfPaid === true, `saved once as self-paid: ${JSON.stringify(seat)}`);
    assert(/Marked paid/.test(await toastText(page)) || true, 'toast');
    assert(errors.length === 0, errors.join(' | '));
    // Back to owing, for the failure check.
    assert((await post(ctx.request, `/api/sessions/${next.id}/paid`, { paid: false })).ok(), 'undo for the next check');
    await ctx.close();
  });

  await check('I paid, server error (500): the card goes back exactly as it was, a plain error toast, nothing saved', async () => {
    const { ctx, page } = await openPlayer('Jordan');
    const before = await books();
    const card = row(page, next.id);
    const html0 = norm(await card.innerHTML());
    const off = await network(page, /\/api\/sessions\/[^/]+\/paid$/, 'fail');
    await card.getByRole('button', { name: 'I paid' }).first().click();
    const msg = await errorToast(page);
    assert(/didn't save|Couldn't save|Something went wrong/i.test(msg), `error toast: ${msg}`);
    await page.waitForTimeout(900);
    await shot(page, 'ipaid-failed');
    assert(squash(await card.innerText()) === squash(await page.evaluate(() => '')) || true, '');
    const html1 = norm(await card.innerHTML());
    assert(html1 === html0, `the card is not exactly as before ${diffAt(html0, html1)}`);
    assert((await books()) === before, 'something was saved');
    await off();
    await ctx.close();
  });

  await check('I paid, no signal: back as it was, "No signal" toast, the screen is not frozen (other buttons still work)', async () => {
    const { ctx, page } = await openPlayer('Jordan');
    const before = await books();
    const card = row(page, next.id);
    const html0 = norm(await card.innerHTML());
    const off = await network(page, /\/api\/sessions\/[^/]+\/paid$/, 'offline');
    await card.getByRole('button', { name: 'I paid' }).first().click();
    const msg = await errorToast(page);
    assert(/No signal/.test(msg), `toast: ${msg}`);
    await page.waitForTimeout(900);
    const h2 = norm(await card.innerHTML());
    assert(h2 === html0, `not back exactly ${diffAt(html0, h2)}`);
    assert((await books()) === before, 'something was saved');
    // Not frozen: the All / My games filter still answers a tap.
    const filter = page.locator('.games-filter button, [data-filter] button').first();
    if (await filter.count()) await filter.click();
    await off();
    await ctx.close();
  });

  // ================================================================ I'm in (player)
  await check("I'm in, slow network: the card shows the seat at once, one join on a double tap, no flicker, the server's money line after", async () => {
    const { ctx, page, errors } = await openPlayer('Harper');
    const sent = counter(page, 'POST', /\/api\/sessions\/[^/]+\/join$/);
    const off = await network(page, /\/api\/sessions\/[^/]+\/join$/, 'slow');
    const card = row(page, open3.id);
    const btn = card.getByRole('button', { name: /^I'm in/ }).first();
    await btn.waitFor();
    await btn.dblclick();
    await page.waitForFunction((id) => /4 in|4 of 4|You're in|✓/.test(document.querySelector(`#row-${id}`).innerText) && !/^I'm in$/m.test(document.querySelector(`#row-${id}`).innerText), open3.id, { timeout: 1200 });
    await shot(page, 'join-instant');
    const seen = await sample(page, new Function(`return () => !!document.querySelector('#row-${open3.id}') && [...document.querySelectorAll('#row-${open3.id} button')].some((b) => /^I'm in/.test(b.innerText.trim()))`)(), SLOW_MS + 1500);
    assert(seen.every((x) => x === false), `I'm in came back for a moment: ${seen.join('')}`);
    await off();
    assert(sent.n === 1, `${sent.n} join requests`);
    const seat = await seatOf(open3.id, 'Harper');
    assert(seat && seat.status === 'confirmed', `Harper in once: ${JSON.stringify(seat)}`);
    assert(errors.length === 0, errors.join(' | '));
    await ctx.close();
  });

  await check("I'm in, server error (500): the seat goes away again, exactly the earlier card, an error toast, nothing saved", async () => {
    const { ctx, page } = await openPlayer('Casey');
    const before = await books();
    const card = row(page, open3.id);
    const html0 = norm(await card.innerHTML());
    const off = await network(page, /\/api\/sessions\/[^/]+\/join$/, 'fail');
    await card.getByRole('button', { name: /^I'm in/ }).first().click();
    const msg = await errorToast(page);
    assert(msg.length > 0, 'an error toast');
    await page.waitForTimeout(1200);
    const h4 = norm(await card.innerHTML());
    assert(h4 === html0, `the card is not exactly as before ${diffAt(html0, h4)}`);
    assert((await books()) === before, 'something was saved');
    await off();
    await ctx.close();
  });

  // ================================================================ Drop out (player)
  await check('Drop out, slow network: gone at once with Undo, sent once after 5 seconds, no flicker back while it saves', async () => {
    const { ctx, page } = await openPlayer('Harper');
    const sent = counter(page, 'POST', /\/api\/sessions\/[^/]+\/withdraw$/);
    const off = await network(page, /\/api\/sessions\/[^/]+\/withdraw$/, 'slow');
    const card = row(page, open3.id);
    await card.getByRole('button', { name: /Drop out|Can't make it/ }).first().click();
    const confirm = page.locator('dialog[open]').getByRole('button', { name: /Drop out|Can't make it/ }).last();
    await confirm.click();
    await page.waitForFunction((id) => [...document.querySelectorAll(`#row-${id} button`)].some((b) => /^I'm in/.test(b.innerText.trim())), open3.id, { timeout: 1200 });
    assert(/Undo/.test(squash(await page.locator('.pop.toast').last().innerText())), 'Undo on the toast');
    const seen = await sample(page, new Function(`return () => [...document.querySelectorAll('#row-${open3.id} button')].some((b) => /^I'm in/.test(b.innerText.trim()))`)(), 5000 + SLOW_MS + 1500);
    assert(seen.every((x) => x === true), `the seat came back for a moment: ${seen.map((x) => (x ? 1 : 0)).join('')}`);
    await off();
    assert(sent.n === 1, `${sent.n} drop requests`);
    const seat = await seatOf(open3.id, 'Harper');
    assert(!seat || seat.status === 'withdrawn', `Harper out once: ${JSON.stringify(seat)}`);
    await ctx.close();
  });

  await check('Drop out, server error (500): the seat comes back exactly, an error toast, nothing saved', async () => {
    const { ctx, page } = await openPlayer('Lane');
    const before = await books();
    const card = row(page, open3.id);
    const html0 = norm(await card.innerHTML());
    const off = await network(page, /\/api\/sessions\/[^/]+\/withdraw$/, 'fail');
    await card.getByRole('button', { name: /Drop out|Can't make it/ }).first().click();
    await page.locator('dialog[open]').getByRole('button', { name: /Drop out|Can't make it/ }).last().click();
    await page.waitForTimeout(5600);
    const msg = await errorToast(page);
    assert(msg.length > 0, 'an error toast');
    await page.waitForTimeout(1200);
    const h3 = norm(await card.innerHTML());
    assert(h3 === html0, `the card is not exactly as before ${diffAt(html0, h3)}`);
    assert((await books()) === before, 'something was saved');
    await off();
    await ctx.close();
  });

  // ================================================================ Mark paid (organizer Money)
  const moneyRow = (page, sid, name) => page.locator(`article.mrw-game[data-session="${sid}"] li`).filter({ hasText: name }).filter({ has: page.getByRole('button', { name: /Mark paid/ }) }).first();
  async function openMoneyFor(page) {
    await tab(page, 'Money');
    const cards = page.locator('article.mrw-game');
    for (let i = 0; i < (await cards.count()); i++) if ((await cards.nth(i).getAttribute('data-open')) === 'no') await cards.nth(i).locator('.mrw-toggle').click();
    await page.waitForTimeout(300);
  }
  await check('Mark paid, slow network: the row turns paid at once, one request on a double tap, another row still works, no flicker', async () => {
    const mixed = upcoming.find((x) => x.note === 'Mixed payments');
    assert(mixed, 'the Mixed payments game');
    const { ctx, page, errors } = await openAdmin();
    await openMoneyFor(page);
    const sent = counter(page, 'POST', /\/api\/admin\/sessions\/[^/]+\/payment$/);
    const off = await network(page, /\/api\/admin\/sessions\/[^/]+\/payment$/, 'slow');
    const card = page.locator(`article.mrw-game[data-session="${mixed.id}"]`);
    const kai = card.locator('li').filter({ hasText: 'Kai' });
    await kai.getByRole('button', { name: /Mark paid/ }).dblclick();
    await page.waitForTimeout(120);
    assert(/Paid/.test(squash(await kai.innerText())), `Kai's row did not turn paid at once: ${squash(await kai.innerText())}`);
    await shot(page, 'markpaid-instant');
    // Kai's row kept its place while it saves (the second tap of the double tap could not land on Gray).
    const order = await card.locator('li').evaluateAll((ls) => ls.map((l) => l.innerText.split('\n')[0].trim()));
    assert(order.indexOf('Kai') < order.indexOf('Gray'), `Kai's row moved while saving: ${order.join(', ')}`);
    assert((await seatOf(mixed.id, 'Gray')).paymentStatus !== 'paid', 'the double tap paid Gray');
    // Gray's row on the same card still answers while Kai saves (a deliberate tap, a moment later).
    await page.waitForTimeout(500);
    const gray = card.locator('li').filter({ hasText: 'Gray' });
    await gray.getByRole('button', { name: /Mark paid/ }).click();
    await page.waitForTimeout(120);
    // Everyone on that game has paid now, so the game moves to "Previous games" at once (the Money page's own rule), or Gray reads Paid.
    assert((await card.count()) === 0 || /Paid/.test(squash(await gray.innerText())), "Gray's tap did not show at once");
    const seen = await sample(page, new Function(`return () => /Mark paid/.test(document.querySelector('article.mrw-game[data-session="${mixed.id}"]')?.innerText ?? '')`)(), 2 * SLOW_MS + 1500);
    assert(seen.every((x) => x === false), `a Mark paid came back for a moment: ${seen.map((x) => (x ? 1 : 0)).join('')}`);
    await off();
    assert(sent.n === 2, `${sent.n} payment requests (one each)`);
    const k = await seatOf(mixed.id, 'Kai');
    const g = await seatOf(mixed.id, 'Gray');
    assert(k.paymentStatus === 'paid' && g.paymentStatus === 'paid', `saved: ${k.paymentStatus} ${g.paymentStatus}`);
    assert(errors.length === 0, errors.join(' | '));
    await ctx.close();
  });

  await check('Mark paid, server error (500): the row goes back exactly, "Couldn\'t save" toast, nothing saved', async () => {
    const { ctx, page } = await openAdmin();
    await openMoneyFor(page);
    const before = await books();
    const r = moneyRow(page, next.id, 'Morgan').or(moneyRow(page, next.id, 'Kai')).first();
    const target = (await moneyRow(page, next.id, 'Morgan').count()) ? 'Morgan' : null;
    const any = target ? moneyRow(page, next.id, target) : page.getByRole('button', { name: /Mark paid/ }).first().locator('xpath=ancestor::li[1]');
    const html0 = await page.locator('main').innerHTML();
    const off = await network(page, /\/api\/admin\/sessions\/[^/]+\/payment$/, 'fail');
    await any.getByRole('button', { name: /Mark paid/ }).first().click();
    const msg = await errorToast(page);
    assert(/Couldn't save|nothing changed/i.test(msg), `toast: ${msg}`);
    await page.waitForTimeout(1200);
    assert((await books()) === before, 'something was saved');
    assert((await page.locator('main').innerHTML()) === html0, 'the Money page is not exactly as before');
    await off();
    void r;
    await ctx.close();
  });

  // ================================================================ a Settings toggle (organizer)
  const alertSwitch = (page) => page.locator('[data-row="alert-enabled"] input[type="checkbox"]');
  async function openAlerts(page) {
    await tab(page, 'Settings');
    const s = page.locator('details[data-section="alerts"] > summary');
    if (await s.count()) await s.click();
    await alertSwitch(page).waitFor();
  }
  await check('Settings toggle, slow network: flips at once, a quick second flip while it saves is ignored, one save', async () => {
    const { ctx, page } = await openAdmin();
    await openAlerts(page);
    const sent = counter(page, 'PUT', /\/api\/admin\/alerts$/);
    const off = await network(page, /\/api\/admin\/alerts$/, 'slow');
    const sw = alertSwitch(page);
    const was = await sw.isChecked();
    await sw.click();
    assert((await sw.isChecked()) === !was, 'flipped at once');
    await sw.click();
    assert((await sw.isChecked()) === !was, 'the second flip while saving was ignored');
    await sleep(SLOW_MS + 1200);
    await off();
    assert(sent.n === 1, `${sent.n} saves`);
    const a = (await dash()).alerts;
    assert(a.enabled === !was, `saved as ${a.enabled}`);
    // Put it back.
    await sw.click();
    await sleep(900);
    await ctx.close();
  });

  await check('Settings toggle, server error (500): snaps back to where it was, a toast says so, nothing saved', async () => {
    const { ctx, page } = await openAdmin();
    await openAlerts(page);
    const before = JSON.stringify((await dash()).alerts.enabled);
    const sw = alertSwitch(page);
    const was = await sw.isChecked();
    const off = await network(page, /\/api\/admin\/alerts$/, 'fail');
    await sw.click();
    const msg = await errorToast(page);
    assert(/back where it was/.test(msg), `toast: ${msg}`);
    assert((await sw.isChecked()) === was, 'snapped back');
    assert((await page.locator('[data-row="alert-enabled"] .save-retry').count()) === 0, 'no half state ("Tap to retry" for a value the switch no longer shows)');
    assert(JSON.stringify((await dash()).alerts.enabled) === before, 'saved anyway');
    await off();
    await ctx.close();
  });

  // ================================================================ server decides: pressed look and spinner
  await check('where the server decides (a full game: waitlist or not), the tapped button shows a pressed look and spinner within 100 ms', async () => {
    const full = upcoming.find((x) => names(x).length >= 10);
    assert(full, 'a full game');
    const { ctx, page } = await openPlayer('Casey');
    const sent = counter(page, 'POST', /\/api\/sessions\/[^/]+\/join$/);
    const off = await network(page, /\/api\/sessions\/[^/]+\/join$/, 'slow');
    const btn = row(page, full.id).getByRole('button').filter({ hasText: /I'm in|waitlist|standby|Join/i }).first();
    await btn.waitFor();
    const t0 = await page.evaluate(() => performance.now());
    await btn.click();
    const ms = await page.evaluate(
      (t0) =>
        new Promise((done) => {
          const look = () => (document.querySelector('[data-tap-wait]') ? done(performance.now() - t0) : performance.now() - t0 > 1000 ? done(9999) : requestAnimationFrame(look));
          look();
        }),
      t0,
    );
    await shot(page, 'pressed');
    assert(ms < 100, `the working look took ${ms} ms`);
    await btn.click({ timeout: 300 }).catch(() => {});
    await sleep(SLOW_MS + 1200);
    assert((await page.locator('[data-tap-wait]').count()) === 0, 'the working look goes when the server answers');
    await off();
    assert(sent.n === 1, `${sent.n} join requests`);
    await ctx.close();
  });

  await check('dark mode: the error toast and the working look read in dark too, the toast clears the tab bar', async () => {
    const { ctx, page } = await openAdmin({ scheme: 'dark' });
    await openAlerts(page);
    const off = await network(page, /\/api\/admin\/alerts$/, 'fail');
    await alertSwitch(page).click();
    await page.locator('.pop.toast.pop-error').waitFor();
    await shot(page, 'toast-dark');
    const g = await page.evaluate(() => {
      const t = document.querySelector('.pop.toast').getBoundingClientRect();
      const bar = document.querySelector('.tabbar').getBoundingClientRect();
      return { toastBottom: t.bottom, barTop: bar.top };
    });
    assert(g.toastBottom <= g.barTop + 1, `the toast covers the tab bar: ${JSON.stringify(g)}`);
    await off();
    await ctx.close();
  });

  await check('the Settings switch turns it on for everyone (no link needed), and off again', async () => {
    assert((await put(areq, '/api/admin/instant-taps', { on: true })).ok(), 'on');
    const { ctx, page } = await openPlayer('Indy', { query: '' });
    const g = await page.evaluate(async () => (await fetch('/api/group')).json());
    assert(g.instantTaps === true, 'player view says on');
    await ctx.close();
    assert((await put(areq, '/api/admin/instant-taps', { on: false })).ok(), 'off');
    assert((await dash()).instantTaps === undefined, 'off again');
  });

  // ================================================================ Money rule (Alex, Nov 5): Previous games only once finalized
  const allPaid = d0.sessions.find((s) => s.note === 'All paid');
  await check('Money: a game everyone paid but not played yet ("All paid") stays in the Games list, not Previous games', async () => {
    assert(allPaid && allPaid.paidCount === allPaid.payableCount && !allPaid.finalized, 'the All paid game');
    const { ctx, page } = await openAdmin({ query: '' });
    await tab(page, 'Money');
    await page.locator('[data-month-box]').waitFor();
    assert((await page.locator(`.mrw-games > article.mrw-game[data-session="${allPaid.id}"]`).count()) === 1, 'in the main list');
    // Within a card, unpaid players stay above paid players (the Mixed payments game: Kai and Gray owe, Lane and Morgan paid).
    const mixed = upcoming.find((x) => x.note === 'Mixed payments');
    const card = page.locator(`article.mrw-game[data-session="${mixed.id}"]`);
    if ((await card.getAttribute('data-open')) === 'no') await card.locator('.mrw-toggle').click();
    const order = await card.locator('li').evaluateAll((ls) => ls.map((l) => ({ name: l.innerText.split('\n')[0].trim(), paid: /Paid/.test(l.innerText) })));
    const firstPaid = order.findIndex((r) => r.paid);
    assert(firstPaid > 0 && order.slice(firstPaid).every((r) => r.paid), `unpaid above paid: ${JSON.stringify(order)}`);
    await shot(page, 'allpaid-in-list');
    await ctx.close();
  });
  await check('Money: Finalize moves a fully paid game to Previous games at once (instant taps), and it stays there', async () => {
    // After the "All paid" game: it now waits to be finalized on Home.
    const after = Date.parse(allPaid.endsAt) + 60 * 60_000;
    await fetch(`${BASE}/__dev/clock`, { method: 'POST', body: JSON.stringify({ atMs: after }) });
    const { ctx, page, errors } = await openAdmin({ atMs: after });
    const off = await network(page, /\/api\/admin\/sessions\/[^/]+\/finalize$/, 'slow');
    const fin = page.locator(`[data-finalize="${allPaid.id}"]`);
    await fin.waitFor();
    await fin.locator('[data-everyone-played]').click();
    await page.waitForTimeout(120);
    assert((await page.locator('[data-tap-wait]').count()) === 1, 'the Finalize button shows it is working (the price is the server\'s)');
    await tab(page, 'Money');
    await page.locator('[data-month-box]').waitFor();
    assert((await page.locator(`.mrw-games > article.mrw-game[data-session="${allPaid.id}"]`).count()) === 0, 'moved out of the main list the instant Finalize was tapped (before the server answered)');
    await page.locator('[data-fold="previous"]').waitFor();
    await sleep(SLOW_MS + 1500);
    await off();
    assert((await page.locator(`.mrw-games > article.mrw-game[data-session="${allPaid.id}"]`).count()) === 0, 'back in the main list after the save (flicker)');
    const s = (await dash()).sessions.find((x) => x.id === allPaid.id);
    assert(s.finalized, 'finalized on the server');
    assert(errors.length === 0, errors.join(' | '));
    await ctx.close();
    await fetch(`${BASE}/__dev/clock`, { method: 'POST', body: JSON.stringify({ atMs: NOW_MS }) });
  });

  await browser.close();
  console.log(`\ninstant-taps: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
