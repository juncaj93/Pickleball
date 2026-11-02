/* "Ask for payment on every game" (PAY_ALWAYS, Nov 2026) in a real browser.
 *
 *   node e2e/pay-always.cjs      (also run by npm run test:e2e)
 *
 * Off (the ship state): a game with no court booked shows no Pay, as before. ?payalways=on on one phone shows Pay,
 * "$14 due" and I paid on Not booked and Waitlist games, on that phone only; ?payalways=off ends it. The organizer's
 * Settings > Money > "Ask for payment on every game" turns it on for everyone with no deploy. The game-day Pay card,
 * narrow phones (no sideways scroll), light and dark. Every check reads the records back: the switch moves no money.
 *
 * Starts its own dev server with a fresh fake group. Nothing here touches the live site.
 */
const { spawn } = require('node:child_process');
const { rmSync, mkdirSync } = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.E2E_PORT) || 5274;
const BASE = `http://localhost:${PORT}`;
const SETUP_TOKEN = 'payalways-setup-token-0123456789';
const PIN = '573904';
const NAMES = ['Alex', 'Ryan', 'Julian', 'Nathan', 'Mitchel', 'Brandon', 'Devon', 'Casey'];
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const MONEY = /\$\d+ due|\bPay\b|I paid/;

let passed = 0;
let failed = 0;
async function check(name, fn) {
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
const squash = (t) => t.replace(/\s+/g, ' ').trim();

async function main() {
  const dbFile = path.join(ROOT, '.data', 'payalways.sqlite');
  mkdirSync(path.join(ROOT, '.data'), { recursive: true });
  rmSync(dbFile, { force: true });
  const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
    cwd: ROOT,
    env: { ...process.env, DEV_DB: dbFile, SETUP_TOKEN, DEV_CLOCK: '1', PAY_ALWAYS: '', MOTION: '' },
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
  const setClock = (atMs) => fetch(`${BASE}/__dev/clock`, { method: 'POST', body: JSON.stringify({ atMs }) });
  await setClock(Date.now());

  const browser = await chromium.launch();
  const post = (req, url, data) => req.post(BASE + url, { data, headers: { Origin: BASE } });
  const put = (req, url, data) => req.put(BASE + url, { data, headers: { Origin: BASE } });
  const setup = (await browser.newContext()).request;
  const made = await post(setup, '/api/setup', {
    setupToken: SETUP_TOKEN,
    groupName: 'Pickleball Bros',
    pin: PIN,
    venmoUrl: 'https://venmo.com/u/organizer',
    players: NAMES.map((name, i) => ({ name, phone: `24855506${String(i).padStart(2, '0')}` })),
  });
  if (!made.ok()) throw new Error(`setup failed: ${await made.text()}`);
  const areq = (await browser.newContext()).request;
  await post(areq, '/api/admin/login', { pin: PIN });
  await put(areq, '/api/admin/group', { organizerName: 'Alex' });
  let d = await (await areq.get(`${BASE}/api/admin/dashboard`)).json();
  for (const h of d.hiddenSessions || []) await post(areq, `/api/admin/sessions/${h.id}/show`, { shown: true });
  d = await (await areq.get(`${BASE}/api/admin/dashboard`)).json();
  // A: Not booked. B: Waitlist. C: Booked.
  const [A, B, C] = d.sessions.filter((s) => !s.state.flags.past).slice(0, 3);
  const idOf = (n) => d.players.find((p) => p.name === n).id;
  const phones = {};
  for (const n of NAMES) {
    const c = await browser.newContext();
    await post(c.request, '/api/me', { playerId: idOf(n) });
    phones[n] = c.request;
  }
  const join = (n, s) => post(phones[n], `/api/sessions/${s.id}/join`, {});
  await post(areq, `/api/admin/sessions/${B.id}/court-status`, { status: 'waitlist' });
  await post(areq, `/api/admin/sessions/${C.id}/court-status`, { status: 'booked' });
  for (const s of [A, B, C]) await join('Devon', s);
  await join('Casey', A);
  await post(areq, `/api/admin/sessions/${A.id}/payment`, { playerId: idOf('Casey'), paid: true });
  await join('Brandon', A);

  const moneyNow = async () =>
    JSON.stringify(
      (await (await areq.get(`${BASE}/api/admin/dashboard`)).json()).sessions.map((s) => s.roster.map((r) => [r.name, r.status, r.paymentStatus, r.paymentAmountCents ?? null, r.selfPaid])),
    );
  const ledgerNow = async () => JSON.stringify((await (await areq.get(`${BASE}/api/admin/dashboard`)).json()).creditLedger);

  const phone = (scheme = 'light', width = 393) => ({ viewport: { width, height: 852 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: scheme, userAgent: UA });
  async function open(who, { scheme = 'light', width = 393, query = '', ctx: reuse } = {}) {
    const ctx = reuse || (await browser.newContext(phone(scheme, width)));
    if (!reuse) await post(ctx.request, '/api/me', { playerId: idOf(who) });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/${query}`);
    await page.locator('.schedule article.sched').first().waitFor();
    const more = page.getByRole('button', { name: /^More sessions/ });
    if (await more.count()) await more.click();
    return { ctx, page };
  }
  const row = (page, s) => page.locator(`#row-${s.id}`);
  const text = async (page, s) => squash(await row(page, s).innerText());
  const noSideScroll = async (page) => {
    const [sw, cw] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
    assert(sw <= cw + 1, `the page scrolls sideways: ${sw} > ${cw}`);
  };

  const before = await moneyNow();

  await check('off (ship state): no Pay on Not booked or Waitlist games; the booked game keeps its Pay', async () => {
    const { ctx, page } = await open('Devon');
    for (const s of [A, B]) {
      const t = await text(page, s);
      assert(/Court not booked/.test(t), `status: ${t}`);
      assert(!MONEY.test(t), `money words on a game with no court: ${t}`);
    }
    const c = await text(page, C);
    assert(/\$14 due/.test(c) && /\bPay\b/.test(c), `booked game: ${c}`);
    await ctx.close();
  });

  for (const scheme of ['light', 'dark']) {
    await check(`${scheme}: ?payalways=on shows "$14 due", Pay and I paid on Not booked and Waitlist games (this phone only)`, async () => {
      const { ctx, page } = await open('Devon', { scheme, query: '?payalways=on' });
      for (const s of [A, B, C]) {
        const t = await text(page, s);
        assert(/\$14 due/.test(t), `due chip: ${t}`);
        const pay = row(page, s).getByRole('link', { name: /Pay \$14 with Venmo/ });
        assert((await pay.count()) === 1, `Pay link: ${t}`);
        const href = await pay.getAttribute('href');
        assert(/venmo\.com/.test(href) && /amount=14/.test(href), `Venmo link: ${href}`);
        assert((await row(page, s).getByRole('button', { name: 'I paid' }).count()) === 1, `I paid: ${t}`);
        const box = await pay.boundingBox();
        assert(box && box.height >= 32, `Pay button is too small: ${box && box.height}`);
      }
      // The court words do not change.
      assert(/Court not booked/.test(await text(page, A)) && /Court not booked/.test(await text(page, B)), 'court words');
      await noSideScroll(page);
      // Another phone at the same moment: still off.
      const other = await open('Brandon', { scheme });
      assert(!MONEY.test(await text(other.page, A)), `Brandon (no test link) sees money words: ${await text(other.page, A)}`);
      await other.ctx.close();
      await ctx.close();
    });
  }

  await check('the test link is remembered on that phone, and ?payalways=off ends it', async () => {
    const ctx = await browser.newContext(phone());
    await post(ctx.request, '/api/me', { playerId: idOf('Devon') });
    let { page } = await open('Devon', { ctx, query: '?payalways=on' });
    await page.close();
    ({ page } = await open('Devon', { ctx }));
    assert(/\$14 due/.test(await text(page, A)), `remembered: ${await text(page, A)}`);
    await page.close();
    ({ page } = await open('Devon', { ctx, query: '?payalways=off' }));
    assert(!MONEY.test(await text(page, A)), `after off: ${await text(page, A)}`);
    await ctx.close();
  });

  await check('a paid seat on a Not booked game reads "Paid $14" with the switch on and off', async () => {
    for (const q of ['?payalways=on', '?payalways=off']) {
      const { ctx, page } = await open('Casey', { query: q });
      const t = await text(page, A);
      assert(/Paid \$14/.test(t) && !/\$14 due/.test(t), `${q}: ${t}`);
      await ctx.close();
    }
  });

  await check('showing the switch moved no money: every seat and credit entry is exactly as before', async () => {
    assert((await moneyNow()) === before, 'seats changed');
  });

  await check('I paid on a Not booked game (test link on): the card says Paid $14 with "Didn\'t pay?", and the organizer sees the claim', async () => {
    const { ctx, page } = await open('Devon', { query: '?payalways=on' });
    await row(page, A).getByRole('button', { name: 'I paid' }).click();
    await page.waitForFunction((id) => /Paid \$14/.test(document.querySelector(`#row-${id}`)?.textContent || ''), A.id, { timeout: 8000 });
    assert(/Didn't pay\?/.test(await text(page, A)), `undo link: ${await text(page, A)}`);
    const g = await (await areq.get(`${BASE}/api/admin/dashboard`)).json();
    const seat = g.sessions.find((s) => s.id === A.id).roster.find((r) => r.name === 'Devon');
    assert(seat.paymentStatus === 'paid' && seat.selfPaid, `seat: ${JSON.stringify(seat)}`);
    const a = g.sessions.find((s) => s.id === A.id);
    assert(a.paidCount === 2 && a.payableCount === 3, `x of y paid: ${a.paidCount} of ${a.payableCount}`);
    await ctx.close();
  });

  await check('game day from 8:00 AM: the Pay card at the top lists the Not booked game (test link on), not with it off', async () => {
    await setClock(Date.parse(A.startsAt) - 5 * 3600_000);
    try {
      const on = await open('Brandon', { query: '?payalways=on' });
      const card = on.page.locator('section.pay-card');
      await card.waitFor({ timeout: 8000 });
      assert(/\$14/.test(squash(await card.innerText())), `pay card: ${squash(await card.innerText())}`);
      await on.ctx.close();
      const off = await open('Brandon', { query: '?payalways=off' });
      assert((await off.page.locator('section.pay-card').count()) === 0, 'pay card shows with the switch off');
      await off.ctx.close();
    } finally {
      await setClock(Date.now());
    }
  });

  await check('360 px, light and dark: Pay on a no-court game fits, no sideways scroll', async () => {
    for (const scheme of ['light', 'dark']) {
      const { ctx, page } = await open('Brandon', { scheme, width: 360, query: '?payalways=on' });
      await noSideScroll(page);
      const pay = row(page, A).getByRole('link', { name: /Pay \$14 with Venmo/ });
      const box = await pay.boundingBox();
      const rb = await row(page, A).boundingBox();
      assert(box && rb && box.x >= rb.x - 1 && box.x + box.width <= rb.x + rb.width + 1, `Pay sticks out of the card: ${JSON.stringify(box)} ${JSON.stringify(rb)}`);
      await ctx.close();
    }
  });

  await check('Settings > Money > "Ask for payment on every game": off at first; on shows Pay to every phone; off hides it again', async () => {
    const ctx = await browser.newContext(phone());
    await post(ctx.request, '/api/admin/login', { pin: PIN });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/admin`);
    await page.getByRole('button', { name: 'Settings' }).first().click();
    const sect = page.locator('details[data-section="money"]');
    await sect.waitFor();
    if (!(await sect.evaluate((el) => el.open))) await sect.locator('summary').click();
    const sw = page.locator('input[data-pay-always-all]');
    await sw.waitFor();
    assert(!(await sw.isChecked()), 'the switch starts on');
    const label = squash(await page.locator('[data-row="payAlwaysAll"]').innerText());
    assert(/Ask for payment on every game/.test(label), `label: ${label}`);
    await sw.click();
    await page.waitForFunction(async () => (await (await fetch('/api/admin/dashboard')).json()).payAlwaysForAll === true, null, { timeout: 8000 });
    const p = await open('Brandon');
    assert(/\$14 due/.test(await text(p.page, A)), `everyone on: ${await text(p.page, A)}`);
    await p.ctx.close();
    await sw.click();
    await page.waitForFunction(async () => (await (await fetch('/api/admin/dashboard')).json()).payAlwaysForAll === false, null, { timeout: 8000 });
    const q = await open('Brandon');
    assert(!MONEY.test(await text(q.page, A)), `everyone off: ${await text(q.page, A)}`);
    await q.ctx.close();
    await ctx.close();
  });

  await check('a page left open picks up the Settings switch by itself (5-second refresh)', async () => {
    const { ctx, page } = await open('Brandon');
    assert(!MONEY.test(await text(page, A)), 'starts off');
    assert((await put(areq, '/api/admin/pay-always', { on: true })).ok(), 'switched on');
    await page.waitForFunction((id) => /\$14 due/.test(document.querySelector(`#row-${id}`)?.textContent || ''), A.id, { timeout: 15000 });
    assert((await put(areq, '/api/admin/pay-always', { on: false })).ok(), 'switched off');
    await page.waitForFunction((id) => !/\$14 due/.test(document.querySelector(`#row-${id}`)?.textContent || ''), A.id, { timeout: 15000 });
    await ctx.close();
  });

  await check('credit entries never changed during any of it', async () => {
    const ledger = JSON.parse(await ledgerNow());
    assert(ledger.every((p) => p.balanceCents === 0), `credit: ${JSON.stringify(ledger)}`);
  });

  await browser.close();
  console.log(`\npay-always: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
