/* Two quick taps on a money button do the thing once and never flash a red
 * error: Use credit (player), Everyone played (Finalize card on Home), Reopen
 * (Money), and Request cash out (credit sheet).
 *
 *   node e2e/double-tap.cjs      (also run by npm run test:e2e)
 *
 * Fake group, fake clock. No Venmo page is ever opened.
 */
const { spawn } = require('node:child_process');
const { rmSync, mkdirSync } = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.E2E_PORT) || 5241;
const BASE = `http://localhost:${PORT}`;
const SETUP_TOKEN = 'doubletap-setup-token-0123456789';
const PIN = '482913';
const NAMES = ['Alex', 'Ryan', 'Mitchel', 'Brandon', 'Julian', 'Nathan', 'Dana'];

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
const nav = (page, name) => page.getByRole('navigation', { name: 'Organizer sections' }).getByRole('button', { name: new RegExp(`^${name}`) });

async function main() {
  const dbFile = path.join(ROOT, '.data', 'double-tap.sqlite');
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
    await new Promise((r) => setTimeout(r, 500));
  }
  const clock = (iso) => fetch(`${BASE}/__dev/clock`, { method: 'POST', body: JSON.stringify({ atMs: Date.parse(iso) }) });
  await clock('2026-10-26T12:00:00-04:00');

  const browser = await chromium.launch();
  const admin = await browser.newContext();
  const call = async (req, method, url, data) => {
    const res = await req.fetch(BASE + url, { method, data, headers: { Origin: BASE } });
    if (!res.ok()) throw new Error(`${method} ${url}: ${res.status()} ${await res.text()}`);
    return res.json().catch(() => ({}));
  };
  await call(admin.request, 'POST', '/api/setup', {
    setupToken: SETUP_TOKEN,
    groupName: 'Pickleball Bros',
    pin: PIN,
    venmoUrl: 'https://venmo.com/u/organizer',
    players: NAMES.map((name, i) => ({ name, phone: `24855506${String(i).padStart(2, '0')}` })),
  });
  await call(admin.request, 'PUT', '/api/admin/group', { organizerName: 'Alex' });
  const dash = () => call(admin.request, 'GET', '/api/admin/dashboard');
  // Pay prompts and Use credit only show once a court is booked (a game with no court reads like a normal game; see e2e/no-court.cjs),
  // so the games in this fixture have a court.
  let d = await dash();
  for (const s of d.sessions.filter((x) => !x.state.flags.past)) await call(admin.request, 'POST', `/api/admin/sessions/${s.id}/booked`, {});
  const id = Object.fromEntries(d.players.map((p) => [p.name, p.id]));
  const [tue, thu] = d.sessions; // Tue Oct 27 and Thu Oct 29
  // Mitchel and Ryan paid for Tuesday.
  for (const n of ['Mitchel', 'Ryan']) {
    await call(admin.request, 'POST', `/api/admin/sessions/${tue.id}/roster`, { playerId: id[n], action: 'confirm' });
    await call(admin.request, 'POST', `/api/admin/sessions/${tue.id}/payment`, { playerId: id[n], paid: true });
  }
  // Thursday: six in, everyone but Mitchel paid. They are added before any credit exists, so Mitchel's seat stays
  // unpaid and Use credit is still his to tap (credit at sign-up is automatic now).
  for (const n of ['Ryan', 'Mitchel', 'Brandon', 'Julian', 'Nathan', 'Dana']) await call(admin.request, 'POST', `/api/admin/sessions/${thu.id}/roster`, { playerId: id[n], action: 'confirm' });
  for (const n of ['Ryan', 'Brandon', 'Julian', 'Nathan', 'Dana']) await call(admin.request, 'POST', `/api/admin/sessions/${thu.id}/payment`, { playerId: id[n], paid: true });
  // Then Tuesday is canceled: Mitchel and Ryan get $14 credit each.
  await call(admin.request, 'POST', `/api/admin/sessions/${tue.id}/decision`, { decision: 'cancel', confirm: true });
  {
    const d1 = await dash();
    for (const n of ['Mitchel', 'Ryan']) {
      const l = d1.creditLedger.find((x) => x.playerId === id[n]);
      if (!l || l.balanceCents !== 1400) throw new Error(`${n} credit after the cancel: ${JSON.stringify(l)}`);
    }
  }

  const phone = (name) => async () => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await ctx.route(/venmo\.com/, (r) => r.abort());
    if (name) await ctx.request.post(BASE + '/api/me', { data: { playerId: id[name] }, headers: { Origin: BASE } });
    else await ctx.request.post(BASE + '/api/admin/login', { data: { pin: PIN }, headers: { Origin: BASE } });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    return { ctx, page, errors };
  };
  /** Every red banner that shows during `ms`. */
  const watchErrors = (page) =>
    page.evaluate(() => {
      window.__redBanners = [];
      new MutationObserver(() => {
        for (const el of document.querySelectorAll('.pop.pop-error')) window.__redBanners.push(el.textContent.trim());
      }).observe(document.body, { childList: true, subtree: true, attributes: true });
    });
  const redBanners = (page) => page.evaluate(() => window.__redBanners);
  const twice = (loc) => loc.evaluate((b) => { b.click(); b.click(); });

  await check('Use credit tapped twice: $14 used once, no red banner', async () => {
    const { ctx, page } = await phone('Mitchel')();
    await page.goto(BASE);
    const btn = page.locator(`#row-${thu.id} [data-use-credit]`);
    await btn.waitFor();
    await watchErrors(page);
    await twice(btn);
    await page.locator('.pop').first().waitFor();
    await page.waitForTimeout(800);
    assert((await redBanners(page)).length === 0, `red banner: ${await redBanners(page)}`);
    d = await dash();
    const ledger = d.creditLedger.find((l) => l.playerId === id.Mitchel);
    assert(ledger.balanceCents === 0, `credit left: ${ledger.balanceCents}`);
    await ctx.close();
  });

  await clock('2026-10-29T22:05:00-04:00'); // Thu Oct 29, 10:05 PM: the game is over
  await check('Everyone played tapped twice: finalized once at $9, no red banner', async () => {
    const { ctx, page } = await phone(null)();
    await page.goto(BASE + '/admin');
    const btn = page.getByRole('button', { name: 'Everyone played' });
    await btn.waitFor();
    await watchErrors(page);
    await twice(btn);
    await page.locator('.pop').first().waitFor();
    await page.waitForTimeout(800);
    assert((await redBanners(page)).length === 0, `red banner: ${await redBanners(page)}`);
    d = await dash();
    const s = d.sessions.find((x) => x.id === thu.id);
    assert(s.finalized && s.finalized.priceCents === 900, `finalized: ${JSON.stringify(s.finalized)}`);
    const brandon = d.creditLedger.find((l) => l.playerId === id.Brandon);
    assert(brandon.balanceCents === 500, `Brandon credit ${brandon.balanceCents}`);
    await ctx.close();
  });

  await check('Reopen tapped twice on Money: reopened once, no red banner', async () => {
    const { ctx, page } = await phone(null)();
    await page.goto(BASE + '/admin');
    await nav(page, 'Money').click();
    const sess = page.locator(`details.money-sess[data-session="${thu.id}"]`);
    await sess.waitFor();
    if (!(await sess.evaluate((el) => el.open))) await sess.locator('summary').click();
    const btn = sess.locator('[data-reopen]');
    await btn.waitFor();
    await watchErrors(page);
    await twice(btn);
    await page.locator('.pop').first().waitFor();
    await page.waitForTimeout(800);
    assert((await redBanners(page)).length === 0, `red banner: ${await redBanners(page)}`);
    d = await dash();
    assert(!d.sessions.find((x) => x.id === thu.id).finalized, 'still finalized');
    await ctx.close();
  });

  await check('Request cash out tapped twice: one request, no leftover error line', async () => {
    const { ctx, page } = await phone('Ryan')();
    await page.goto(BASE);
    await page.locator('header [data-credit-chip]').click();
    const sheet = page.locator('[data-credit-sheet]');
    await sheet.waitFor();
    await sheet.getByRole('button', { name: /Request cash out/ }).first().click();
    const send = sheet.getByRole('button', { name: /^(Send|Request)/ }).last();
    await send.waitFor();
    await twice(send);
    await sheet.getByText(/pending/i).first().waitFor();
    await page.waitForTimeout(800);
    const text = (await sheet.innerText()).replace(/\s+/g, ' ');
    assert(!/already/i.test(text), `error line: ${text}`);
    d = await dash();
    assert(d.refundRequests.filter((r) => r.playerId === id.Ryan).length === 1, 'not exactly one request');
    await ctx.close();
  });

  await browser.close();
  rmSync(dbFile, { force: true });
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
