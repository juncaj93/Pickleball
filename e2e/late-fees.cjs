/* "Late drops owe $14" (LATE_FEES, Nov 2026) in a real browser.
 *
 *   node e2e/late-fees.cjs      (also run by npm run test:e2e)
 *
 * Off at ship: the drop dialog says what it always said. With ?latefees=on on one phone, past the cancel-by (start
 * minus 12 hours): the dialog warns "If no one takes your spot, you still owe $14", the banner says so, and the top Pay
 * card shows "(late drop)". The organizer (/admin?latefees=on) gets Find a sub and Clear on the Home late-drop card, an
 * Unpaid row on Money with Clear, and "Did the venue waive the fee?" when canceling late. 360 and 430 px, light and dark.
 *
 * Starts its own dev server with a fresh fake group and a fake clock. Nothing here touches the live site.
 */
const { spawn } = require('node:child_process');
const { rmSync, mkdirSync } = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.E2E_PORT) || 5281;
const BASE = `http://localhost:${PORT}`;
const SETUP_TOKEN = 'latefees-setup-token-0123456789';
const PIN = '483920';
const NAMES = ['Alex', 'Ryan', 'Julian', 'Nathan', 'Mitchel', 'Brandon', 'Devon', 'Casey'];
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
    console.log(`  ✗ ${name}\n      ${String(err && err.message ? err.message : err).replace(/\s*\n\s*/g, ' ⏎ ').slice(0, 900)}`);
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
const squash = (t) => t.replace(/\s+/g, ' ').trim();

async function main() {
  const dbFile = path.join(ROOT, '.data', 'latefees.sqlite');
  mkdirSync(path.join(ROOT, '.data'), { recursive: true });
  rmSync(dbFile, { force: true });
  const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
    cwd: ROOT,
    env: { ...process.env, DEV_DB: dbFile, SETUP_TOKEN, DEV_CLOCK: '1', LATE_FEES: '', MOTION: '' },
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
  const post = (req, url, data, headers = {}) => req.post(BASE + url, { data, headers: { Origin: BASE, ...headers } });
  const put = (req, url, data) => req.put(BASE + url, { data, headers: { Origin: BASE } });
  const setup = (await browser.newContext()).request;
  const made = await post(setup, '/api/setup', {
    setupToken: SETUP_TOKEN,
    groupName: 'Pickleball Bros',
    pin: PIN,
    venmoUrl: 'https://venmo.com/u/organizer',
    players: NAMES.map((name, i) => ({ name, phone: `24855507${String(i).padStart(2, '0')}` })),
  });
  if (!made.ok()) throw new Error(`setup failed: ${await made.text()}`);
  const areq = (await browser.newContext()).request;
  await post(areq, '/api/admin/login', { pin: PIN });
  await put(areq, '/api/admin/group', { organizerName: 'Alex' });
  let d = await (await areq.get(`${BASE}/api/admin/dashboard`)).json();
  for (const h of d.hiddenSessions || []) await post(areq, `/api/admin/sessions/${h.id}/show`, { shown: true });
  d = await (await areq.get(`${BASE}/api/admin/dashboard`)).json();
  const [A, B] = d.sessions.filter((s) => !s.state.flags.past && Date.parse(s.startsAt) > Date.now() + 14 * 3600_000).slice(0, 2);
  const idOf = (n) => d.players.find((p) => p.name === n).id;
  const phones = {};
  for (const n of NAMES) {
    const c = await browser.newContext();
    await post(c.request, '/api/me', { playerId: idOf(n) });
    phones[n] = c.request;
  }
  const join = (n, s) => post(phones[n], `/api/sessions/${s.id}/join`, {});
  for (const s of [A, B]) {
    await post(areq, `/api/admin/sessions/${s.id}/court-status`, { status: 'booked' });
    for (const n of ['Ryan', 'Julian', 'Nathan', 'Mitchel']) await join(n, s);
  }
  // Five hours before A: past the cancel-by (start minus 12 hours).
  await setClock(Date.parse(A.startsAt) - 5 * 3600_000);

  const phone = (scheme = 'light', width = 393) => ({ viewport: { width, height: 852 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: scheme, userAgent: UA });
  async function open(who, { scheme = 'light', width = 393, query = '' } = {}) {
    const ctx = await browser.newContext(phone(scheme, width));
    await post(ctx.request, '/api/me', { playerId: idOf(who) });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/${query}`);
    await page.locator('.schedule article.sched').first().waitFor();
    return { ctx, page };
  }
  async function openAdmin({ width = 390, scheme = 'light', query = '?latefees=on&adminr2=on' } = {}) {
    const ctx = await browser.newContext(phone(scheme, width));
    await post(ctx.request, '/api/admin/login', { pin: PIN });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/admin${query}`);
    await page.locator('article.scard, article.card').first().waitFor();
    return { ctx, page };
  }
  const tab = async (page, name) => {
    await page.locator('.tabbar button', { hasText: name }).evaluate((b) => b.click());
    await page.waitForTimeout(300);
  };
  const row = (page, s) => page.locator(`#row-${s.id}`);
  const noSideScroll = async (page, what) => {
    const [sw, cw] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
    assert(sw <= cw + 1, `${what}: the page scrolls sideways: ${sw} > ${cw}`);
  };
  const dialogText = async (page) => squash(await page.locator('dialog[open]').innerText());

  await check('off (ship state): the drop dialog says what it always said, nothing about owing', async () => {
    const { ctx, page } = await open('Julian');
    await row(page, A).getByRole('button', { name: 'Drop out' }).click();
    const t = await dialogText(page);
    assert(/Your spot opens up for someone else\./.test(t) && !/owe|cancel-by/.test(t), `dialog: ${t}`);
    await page.locator('dialog[open]').getByRole('button', { name: 'Cancel' }).click().catch(() => page.keyboard.press('Escape'));
    await ctx.close();
  });

  for (const [scheme, width] of [
    ['light', 360],
    ['dark', 430],
  ]) {
    await check(`${scheme} ${width}px: ?latefees=on, 4 in: the dialog warns "you still owe $14" with the 12-hour cancel-by time`, async () => {
      const { ctx, page } = await open('Ryan', { scheme, width, query: '?latefees=on' });
      await row(page, A).getByRole('button', { name: 'Drop out' }).click();
      const t = await dialogText(page);
      assert(/It's past the \d{1,2}:\d{2} (AM|PM) cancel-by\. If no one takes your spot, you still owe \$14\./.test(t), `dialog: ${t}`);
      await noSideScroll(page, 'dialog');
      await page.keyboard.press('Escape');
      await ctx.close();
    });
  }

  await check('Drop out: the banner says "You owe $14 unless someone takes your spot", then the top Pay card shows "(late drop)"', async () => {
    const { ctx, page } = await open('Ryan', { query: '?latefees=on' });
    await row(page, A).getByRole('button', { name: 'Drop out' }).click();
    await page.locator('dialog[open]').getByRole('button', { name: 'Drop out' }).click();
    const toast = squash(await page.locator('.toast-msg').first().innerText());
    assert(toast === "You're out. You owe $14 unless someone takes your spot.", `banner: ${toast}`);
    // The held drop goes out after the 5-second Undo.
    await page.waitForTimeout(6500);
    await page.reload();
    const pay = page.locator('section.pay-card');
    await pay.waitFor({ timeout: 8000 });
    const p = squash(await pay.innerText());
    assert(/You owe \$14 for \w{3}, \w{3} \d+ \(late drop\)/.test(p), `Pay card: ${p}`);
    assert(/I paid|Pay with Venmo/.test(p), `Pay card buttons: ${p}`);
    await noSideScroll(page, 'Pay card');
    await ctx.close();
    const g = await (await areq.get(`${BASE}/api/admin/dashboard`)).json();
    const seat = g.sessions.find((s) => s.id === A.id).roster.find((r) => r.name === 'Ryan');
    assert(seat.status === 'withdrawn' && seat.lateFee && seat.lateFee.kind === 'late_drop' && seat.owesCents === 1400, `seat: ${JSON.stringify(seat)}`);
  });

  await check('another phone (no test link) sees nothing about Ryan\'s debt', async () => {
    const { ctx, page } = await open('Julian');
    const t = squash(await page.locator('main').innerText());
    assert(!/late drop|Ryan owes/i.test(t), `Julian sees: ${t.slice(0, 300)}`);
    await ctx.close();
  });

  for (const [scheme, width] of [
    ['light', 360],
    ['dark', 430],
  ]) {
    await check(`${scheme} ${width}px organizer: Home late-drop card has Find a sub and Clear (no Done); Money shows an Unpaid "late drop" row with Clear`, async () => {
      const { ctx, page } = await openAdmin({ scheme, width });
      const card = page.locator('article', { hasText: 'Late drop' }).filter({ has: page.locator('[data-find-sub]') }).first();
      await card.waitFor({ timeout: 8000 });
      const t = squash(await card.innerText());
      assert(/Ryan/.test(t) && /owes \$14 unless someone takes the spot/.test(t), `card: ${t}`);
      assert((await card.getByRole('button', { name: 'Done' }).count()) === 0, 'Done still shows');
      const href = await card.locator('[data-find-sub]').getAttribute('href');
      assert(/^sms:/.test(href) && /pickleball/i.test(decodeURIComponent(href)), `Find a sub link: ${href}`);
      await noSideScroll(page, 'Home');
      await tab(page, 'Money');
      const game = page.locator(`[data-session="${A.id}"]`).first();
      if ((await game.getAttribute('data-open')) !== 'yes') await game.locator('.r2m-toggle').click();
      const r = page.locator('[data-pay-row="Ryan"]').first();
      await r.waitFor({ timeout: 8000 });
      const rt = squash(await r.innerText());
      assert(/Unpaid/.test(rt) && /late drop · owes \$14/.test(rt), `Money row: ${rt}`);
      await r.locator('.mv2-who').click();
      for (const why of ['sub', 'venue', 'choice']) assert((await r.locator(`[data-clear-why="${why}"]`).count()) === 1, `Clear ${why} missing`);
      await noSideScroll(page, 'Money');
      await ctx.close();
    });
  }

  await check('Clear (Sub found) from the Home card: the debt ends, Ryan gets $14 back as nothing owed, History says why', async () => {
    const { ctx, page } = await openAdmin();
    const card = page.locator('article', { hasText: 'Late drop' }).filter({ has: page.locator('[data-find-sub]') }).first();
    await card.locator('[data-clear-fee="Ryan"]').click();
    await card.locator('[data-clear-why="sub"]').click();
    await page.waitForTimeout(800);
    const g = await (await areq.get(`${BASE}/api/admin/dashboard`)).json();
    const seat = g.sessions.find((s) => s.id === A.id).roster.find((r) => r.name === 'Ryan');
    assert(!seat.lateFee && seat.owesCents === 0, `seat after Clear: ${JSON.stringify(seat)}`);
    assert(g.audit.some((a) => a.action === 'late_fee_cleared' && a.details.why === 'sub'), 'History line');
    await ctx.close();
    const v = await (await phones.Ryan.get(`${BASE}/api/group`)).json();
    assert(!v.owed.some((o) => o.lateFee), `Ryan still owes: ${JSON.stringify(v.owed)}`);
  });

  await check('Cancel inside 12 hours (switch on): "Did the venue waive the fee?" with no default; No keeps everyone owing', async () => {
    await setClock(Date.parse(B.startsAt) - 5 * 3600_000);
    const { ctx, page } = await openAdmin({ query: '?latefees=on&adminr2=off' });
    // The gear menu's Cancel session (old card layout).
    const card = page.locator(`article.scard[data-session="${B.id}"], article.scard`).filter({ hasText: '' }).first();
    await card.waitFor();
    const r = await post(areq, `/api/admin/sessions/${B.id}/decision`, { decision: 'cancel', confirm: true }, { 'X-Late-Fees': 'on' });
    assert(r.status() === 400, `cancel without an answer: ${r.status()}`);
    const r2 = await post(areq, `/api/admin/sessions/${B.id}/decision`, { decision: 'cancel', confirm: true, venueWaived: false }, { 'X-Late-Fees': 'on' });
    assert(r2.ok(), `cancel No: ${await r2.text()}`);
    const v = await (await phones.Julian.get(`${BASE}/api/group`)).json();
    const o = v.owed.find((x) => x.sessionId === B.id);
    assert(o && o.lateFee === 'canceled_late' && o.amountCents === 1400, `Julian owed: ${JSON.stringify(v.owed)}`);
    await ctx.close();
  });

  await check('the cancel sheet asks "Did the venue waive the fee?" (Yes / No, neither picked) on a game inside 12 hours', async () => {
    // A fresh game inside 12 hours: the next one after B.
    const g = await (await areq.get(`${BASE}/api/admin/dashboard`)).json();
    const C = g.sessions.filter((s) => !s.state.flags.canceled && Date.parse(s.startsAt) > Date.parse(B.startsAt))[0];
    await setClock(Date.parse(C.startsAt) - 3 * 3600_000);
    await join('Devon', C);
    const { ctx, page } = await openAdmin({ query: '?latefees=on&adminr2=off&adminv2=off' });
    const gear = page.getByRole('button', { name: /^Game menu for / }).filter({ visible: true });
    const n = await gear.count();
    let opened = false;
    for (let i = 0; i < n && !opened; i++) {
      await gear.nth(i).click();
      const item = page.getByRole('menuitem', { name: /Cancel session/ });
      // The menu that belongs to C: its card holds Devon.
      const owner = await gear.nth(i).evaluate((b) => b.closest('article')?.textContent || '');
      if ((await item.count()) && /Devon/.test(owner)) {
        await item.first().click();
        opened = true;
      } else await page.keyboard.press('Escape');
    }
    assert(opened, 'no gear menu for the game');
    const t = await dialogText(page);
    assert(/Did the venue waive the fee\?/.test(t) && !/Were you charged/.test(t), `sheet: ${t}`);
    const pressed = await page.locator('dialog[open] [data-venue-waived] button[aria-pressed="true"]').count();
    assert(pressed === 0, `a default is picked: ${pressed}`);
    await noSideScroll(page, 'cancel sheet');
    await ctx.close();
  });

  await check('Settings > Feature switches has "Late drops owe $14", off', async () => {
    const { ctx, page } = await openAdmin({ query: '?adminr2=on' });
    await tab(page, 'Settings');
    const sw = page.locator('[data-late-fees-all]');
    await page.locator('#switches, [id*="switches"]').first().evaluate((el) => el.closest('details')?.setAttribute('open', '')).catch(() => {});
    assert((await sw.count()) === 1, 'switch row missing');
    assert((await sw.isChecked()) === false, 'switch is on at ship');
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
