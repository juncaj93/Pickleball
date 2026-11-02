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

  // Extra games a few hours out (so they are inside 12 hours at once), each with a different player to find its card by.
  const addGameIn = async (hours, note) => {
    const now = Date.parse((await (await areq.get(`${BASE}/api/admin/dashboard`)).json()).now);
    const start = Math.ceil((now + hours * 3600_000) / 900_000) * 900_000;
    const r = await post(areq, '/api/admin/sessions', { startsAt: new Date(start).toISOString(), endsAt: new Date(start + 2 * 3600_000).toISOString(), note });
    assert(r.ok(), `add game: ${await r.text()}`);
    return (await r.json()).id;
  };
  const A_TEXT = "Hey guys, sorry, I have to back out of today's game. I canceled the court, so you can still book the same slot as non-members. It's only $2 more per person. Book online: https://app.courtreserve.com/Online/publicbookings/13765?tab=reserve&step=initial or call the courts at 810-207-5698. Sorry again, hope you can still get it in!";
  const B_TEXT = "Hey guys, sorry, I have to back out of today's game. The court is still booked under my name, so you can still play. They might charge you $2 more each since the non-member rate is $16. They may be cool though and let you play under my membership pricing. Questions? Call the courts at 810-207-5698. Sorry again!";
  /** Open the gear menu of the card that holds `who`, and pick the menu item `name`. */
  async function gearPick(page, who, name) {
    const gear = page.getByRole('button', { name: /^Game menu for / }).filter({ visible: true });
    const n = await gear.count();
    for (let i = 0; i < n; i++) {
      const owner = await gear.nth(i).evaluate((b) => b.closest('article')?.textContent || '');
      if (!owner.includes(who)) continue;
      await gear.nth(i).click();
      const item = page.getByRole('menuitem', { name });
      if (await item.count()) {
        await item.first().click();
        return;
      }
      await page.keyboard.press('Escape');
    }
    throw new Error(`no gear menu item ${name} on the card with ${who}`);
  }

  const lateCancels = [
    ['light', 360, 'Brandon'],
    ['dark', 430, 'Casey'],
  ];
  const gameOf = {};
  for (const [i, [, , who]] of lateCancels.entries()) {
    gameOf[who] = await addGameIn(3 + i, `Cancel test ${who}`);
    await join(who, { id: gameOf[who] });
    await join('Julian', { id: gameOf[who] });
  }
  for (const [scheme, width, who] of lateCancels) {
    await check(`${scheme} ${width}px: cancel inside 12 hours asks "Did the venue waive the fee or give you credit toward the next booking?" (nothing picked); No opens the "Heads up" text to the players who were in, and Text the players with "Court canceled" picked`, async () => {
      const { ctx, page } = await openAdmin({ scheme, width, query: '?latefees=on&adminr2=off&adminv2=off' });
      await gearPick(page, `Cancel test ${who}`, /Cancel session/);
      const t = await dialogText(page);
      assert(/Did the venue waive the fee or give you credit toward the next booking\?/.test(t) && !/Were you charged/.test(t), `sheet: ${t}`);
      assert((await page.locator('dialog[open] [data-venue-waived] button[aria-pressed="true"]').count()) === 0, 'a default is picked');
      await noSideScroll(page, 'cancel sheet');
      // Confirming with no answer is refused on the sheet itself.
      await page.locator('dialog[open]').getByRole('button', { name: 'Cancel session' }).click();
      await page.locator('dialog[open] .field-error', { hasText: 'Pick Yes or No.' }).waitFor({ timeout: 4000 });
      await page.locator('dialog[open] [data-venue-waived]').getByRole('button', { name: 'No' }).click();
      await page.locator('dialog[open]').getByRole('button', { name: 'Cancel session' }).click();
      const after = page.locator('[data-late-cancel="fee_kept"]');
      await after.waitFor({ timeout: 8000 });
      const body = await after.locator('[data-draft="canceled_fee_kept"] textarea').inputValue();
      assert(/^Heads up: today's game is canceled, and since it's inside 12 hours the venue is charging us for the court\. If you were signed up, your \$14 share still applies \(if you already paid, you're all set\)\. You can pay on the site: \S+\. Sorry about that!$/.test(body), `No text: ${body}`);
      assert(!/credit|tomorrow/.test(body), `No text mentions credit: ${body}`);
      const head = squash(await after.locator('[data-draft="canceled_fee_kept"] .draft-head').innerText());
      assert(/The players who were in · 2/.test(head), `who: ${head}`);
      const href = await after.locator('[data-draft="canceled_fee_kept"] [data-draft-open]').getAttribute('href');
      assert(/^sms:/.test(href) && /Heads%20up|Heads up/.test(href), `Messages link: ${href}`);
      // Text the players: Court canceled first and picked.
      assert((await after.locator('[data-pick="court_canceled"][aria-pressed="true"]').count()) === 1, 'Court canceled not picked');
      assert((await after.locator('[data-players-text] textarea').inputValue()) === A_TEXT, 'A text');
      await after.locator('[data-pick="court_booked"]').click();
      assert((await after.locator('[data-players-text] textarea').inputValue()) === B_TEXT, 'B text');
      await noSideScroll(page, 'after-cancel sheet');
      await page.screenshot({ path: path.join(ROOT, '.data', `late-fees-after-cancel-${scheme}-${width}.png`), fullPage: true });
      await ctx.close();
      // Money: the player's Pay card and the organizer's numbers match the No case.
      const v = await (await phones[who].get(`${BASE}/api/group`)).json();
      const o = v.owed.find((x) => x.sessionId === gameOf[who]);
      assert(o && o.lateFee === 'canceled_late' && o.amountCents === 1400, `owed: ${JSON.stringify(v.owed)}`);
    });
  }

  await check('gear menu > Text the players (switch on): "Court canceled" picked, editable, to the 2 players in (not you, not the waitlist)', async () => {
    const gid = await addGameIn(5.5, 'Text test');
    for (const n of ['Nathan', 'Mitchel']) await join(n, { id: gid });
    for (const [scheme, width] of [
      ['light', 360],
      ['dark', 430],
    ]) {
      const { ctx, page } = await openAdmin({ scheme, width, query: '?latefees=on&adminr2=off&adminv2=off' });
      await gearPick(page, 'Text test', /Text the players/);
      const box = page.locator('[data-players-text]');
      await box.waitFor({ timeout: 6000 });
      assert((await box.locator('[data-pick="court_canceled"][aria-pressed="true"]').count()) === 1, 'A not picked');
      assert((await box.locator('textarea').inputValue()) === A_TEXT, 'A text');
      const head = squash(await box.locator('.draft-head').innerText());
      assert(/The players who are in · 2/.test(head) && /2 numbers/.test(head), `who: ${head}`);
      await box.locator('textarea').fill('Edited words');
      const href = await box.locator('[data-draft-open]').getAttribute('href');
      assert(/Edited%20words|Edited words/.test(decodeURIComponent(href)), `edited text not in the link: ${href}`);
      await noSideScroll(page, 'Text the players');
      await ctx.close();
    }
    // Off: no menu item.
    const { ctx, page } = await openAdmin({ query: '?latefees=off&adminr2=off&adminv2=off' });
    const gear = page.getByRole('button', { name: /^Game menu for / }).filter({ visible: true }).first();
    await gear.click();
    assert((await page.getByRole('menuitem', { name: /Text the players/ }).count()) === 0, 'menu item shows with the switch off');
    await ctx.close();
  });

  for (const [scheme, width] of [
    ['light', 360],
    ['dark', 430],
  ]) {
    await check(`${scheme} ${width}px: Ryan (debt cleared, "Sub found") sees "Good news: someone took your spot ... You no longer owe $14." until he dismisses it`, async () => {
      const ctx = await browser.newContext(phone(scheme, width));
      await post(ctx.request, '/api/me', { playerId: idOf('Ryan') });
      const page = await ctx.newPage();
      await page.goto(`${BASE}/`);
      const n = page.locator('[data-fee-notice="sub"]');
      await n.waitFor({ timeout: 8000 });
      const t = squash(await n.innerText());
      assert(/^Good news: someone took your spot for \w{3}, \w{3} \d+\. You no longer owe \$14\. Dismiss$/.test(t), `notice: ${t}`);
      await noSideScroll(page, 'notice');
      await page.reload();
      await n.waitFor({ timeout: 8000 });
      await n.getByRole('button', { name: 'Dismiss' }).click();
      await page.reload();
      await page.locator('.schedule article.sched').first().waitFor();
      assert((await page.locator('[data-fee-notice]').count()) === 0, 'notice back after Dismiss');
      await ctx.close();
      // The next run (dark) uses a fresh phone, so it shows again there.
    });
  }

  await check('another player never sees Ryan\'s notice', async () => {
    const { ctx, page } = await open('Julian');
    assert((await page.locator('[data-fee-notice]').count()) === 0, 'Julian sees a notice');
    await ctx.close();
  });

  await check('the organizer drops late (In / Out) and the game goes short: Money shows "late drop (you) · owes $14" with a one-tap Clear', async () => {
    const gid = await addGameIn(7, 'Org test');
    for (const n of ['Nathan', 'Mitchel', 'Brandon']) await join(n, { id: gid });
    await post(areq, `/api/admin/sessions/${gid}/me`, { in: true });
    await post(areq, `/api/admin/sessions/${gid}/payment`, { playerId: idOf('Alex'), paid: true });
    const out = await post(areq, `/api/admin/sessions/${gid}/me`, { in: false }, { 'X-Late-Fees': 'on' });
    assert((await out.json()).lateFee, 'no debt');
    const { ctx, page } = await openAdmin({ width: 360, scheme: 'dark' });
    await tab(page, 'Money');
    const game = page.locator(`[data-session="${gid}"]`).first();
    if ((await game.getAttribute('data-open')) !== 'yes') await game.locator('.r2m-toggle').click();
    const r = page.locator('[data-pay-row="Alex"]').first();
    await r.waitFor({ timeout: 8000 });
    const rt = squash(await r.innerText());
    assert(/late drop \(you\) · owes \$14/.test(rt) && /Clear/.test(rt) && !/Mark paid/.test(rt), `row: ${rt}`);
    assert(/Unpaid/.test(rt) && !/\bPaid\b/.test(rt), `chip on your own debt: ${rt}`);
    await r.locator('.mv2-btncell button').click();
    await page.waitForTimeout(900);
    const g = await (await areq.get(`${BASE}/api/admin/dashboard`)).json();
    assert(!g.sessions.find((s) => s.id === gid).roster.find((x) => x.name === 'Alex').lateFee, 'still owes after one tap');
    await noSideScroll(page, 'Money');
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
