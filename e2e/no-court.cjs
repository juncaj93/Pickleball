/* A game with no court booked works like a normal game for players:
 * "Court not booked", "3 of 4 in", "I'm in" / "You're in" with Drop out, never the
 * words waitlist, waiting or standby, and no money prompts until a court is booked.
 *
 *   node e2e/no-court.cjs      (also run by npm run test:e2e)
 *
 * Starts its own dev server with a fresh fake group. Nothing here touches the live site.
 * Display only: the checks also read the records back to be sure they did not change.
 */
const { spawn } = require('node:child_process');
const { rmSync, mkdirSync } = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.E2E_PORT) || 5262;
const BASE = `http://localhost:${PORT}`;
const SETUP_TOKEN = 'nocourt-setup-token-0123456789';
const PIN = '482913';
const NAMES = ['Alex', 'Ryan', 'Julian', 'Nathan', 'Mitchel', 'Brandon', 'Devon', 'Casey'];
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const FORBIDDEN = /waitlist|waiting|standby/i;

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
  const dbFile = path.join(ROOT, '.data', 'nocourt.sqlite');
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
  const setClock = (atMs) => fetch(`${BASE}/__dev/clock`, { method: 'POST', body: JSON.stringify({ atMs }) });
  // The page times Drop out with the browser's real clock, so the server's fake clock starts at the real time too.
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
    players: NAMES.map((name, i) => ({ name, phone: `24855505${String(i).padStart(2, '0')}` })),
  });
  if (!made.ok()) throw new Error(`setup failed: ${await made.text()}`);
  const areq = (await browser.newContext()).request;
  await post(areq, '/api/admin/login', { pin: PIN });
  let d = await (await areq.get(`${BASE}/api/admin/dashboard`)).json();
  for (const h of d.hiddenSessions || []) await post(areq, `/api/admin/sessions/${h.id}/show`, { shown: true });
  d = await (await areq.get(`${BASE}/api/admin/dashboard`)).json();
  const [A, B, C] = d.sessions.filter((s) => !s.state.flags.past).slice(0, 3);
  const idOf = (n) => d.players.find((p) => p.name === n).id;
  const phones = {};
  for (const n of NAMES) {
    const c = await browser.newContext();
    await post(c.request, '/api/me', { playerId: idOf(n) });
    phones[n] = c.request;
  }
  const join = (n, s) => post(phones[n], `/api/sessions/${s.id}/join`, {});
  // C has a court. B: two in, then the organizer puts it on the court waitlist and a third taps I'm in (kept as standby behind the scenes).
  await post(areq, `/api/admin/sessions/${C.id}/booked`, {});
  await join('Ryan', B);
  await join('Julian', B);
  await post(areq, `/api/admin/sessions/${B.id}/court`, { action: 'waitlist' });
  await join('Nathan', B);
  // A has no court: Devon is in and owes $14, Casey is in and already paid.
  await join('Devon', A);
  await join('Casey', A);
  assert((await post(phones.Casey, `/api/sessions/${A.id}/paid`, { paid: true })).ok(), 'Casey paid');

  const phone = (scheme = 'light') => ({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: scheme, userAgent: UA });
  async function open(who, scheme) {
    const ctx = await browser.newContext(phone(scheme));
    await post(ctx.request, '/api/me', { playerId: d.players.find((p) => p.name === who).id });
    const page = await ctx.newPage();
    await page.goto(BASE);
    await page.locator('.schedule article.sched').first().waitFor();
    const more = page.getByRole('button', { name: /^More sessions/ });
    if (await more.count()) await more.click();
    return { ctx, page };
  }
  const row = (page, s) => page.locator(`#row-${s.id}`);
  const text = async (page, s) => squash(await row(page, s).innerText());
  /** The record behind the screen, read from the server. */
  const record = async (who, s) => {
    const g = await (await phones[who].get(`${BASE}/api/group`)).json();
    return g.sessions.find((x) => x.id === s.id).mine;
  };

  for (const scheme of ['light', 'dark']) {
    await check(`${scheme}: a game with no court (and one on the court waitlist) never says waitlist, waiting or standby`, async () => {
      const { ctx, page } = await open('Brandon', scheme);
      for (const s of [A, B]) {
        const t = await text(page, s);
        assert(!FORBIDDEN.test(t), `card says a waiting word: ${t}`);
        assert(/Court not booked/.test(t), `status should say Court not booked: ${t}`);
      }
      // The page as a whole, banners and prompts too.
      const body = await page.locator('main').innerText();
      assert(!FORBIDDEN.test(body), `the page says a waiting word: ${body.match(FORBIDDEN)}`);
      await ctx.close();
    });
  }

  await check('the court-waitlist game counts everyone who tapped I\'m in ("3 of 4 in", never "0 on standby") and offers I\'m in', async () => {
    const { ctx, page } = await open('Brandon');
    const t = await text(page, B);
    assert(/3 of 4 in/.test(t), `count line: ${t}`);
    assert(/Ryan, Julian, Nathan/.test(t), `names: ${t}`);
    assert((await row(page, B).getByRole('button', { name: "I'm in" }).count()) === 1, `I'm in button: ${t}`);
    assert((await row(page, B).getByRole('button', { name: /standby/i }).count()) === 0, 'a standby button is still there');
    await ctx.close();
  });

  await check('I\'m in, Drop out and I\'m in again on a game with no court: normal words every time, never waiting words', async () => {
    const { ctx, page } = await open('Brandon');
    const pop = page.locator('.pop');
    await row(page, B).getByRole('button', { name: "I'm in" }).click();
    await pop.waitFor();
    assert(squash(await pop.innerText()) === "You're in", `banner after I'm in: "${await pop.innerText()}"`);
    await row(page, B).locator('.st-in', { hasText: "You're in" }).waitFor();
    let t = await text(page, B);
    assert(/4 in/.test(t) && /Drop out/.test(t) && !FORBIDDEN.test(t), `joined: ${t}`);
    await pop.waitFor({ state: 'detached', timeout: 5000 });
    // Drop out: the confirm sheet and the Undo banner use no waiting words either.
    await row(page, B).getByRole('button', { name: 'Drop out' }).click();
    const sheet = page.locator('dialog[open]');
    await sheet.waitFor();
    assert(!FORBIDDEN.test(await sheet.innerText()), `drop sheet: ${await sheet.innerText()}`);
    const sent = page.waitForResponse((r) => /\/withdraw$/.test(r.url()), { timeout: 15000 });
    await sheet.getByRole('button', { name: 'Drop out' }).click();
    await pop.waitFor();
    const banner = squash(await pop.innerText());
    assert(/You dropped out\./.test(banner) && /Undo/.test(banner) && !FORBIDDEN.test(banner), `drop banner: ${banner}`);
    t = await text(page, B);
    assert(/I'm in/.test(t) && !FORBIDDEN.test(t), `after the drop: ${t}`);
    await sent;
    await page.waitForTimeout(500);
    // Join again.
    await row(page, B).getByRole('button', { name: "I'm in" }).click();
    await page.locator('.pop', { hasText: "You're in" }).waitFor();
    t = await text(page, B);
    assert(/You're in/.test(t) && /Drop out/.test(t) && !FORBIDDEN.test(t), `joined again: ${t}`);
    assert(!FORBIDDEN.test(await page.locator('main').innerText()), 'the page says a waiting word');
    await ctx.close();
  });

  await check('an Undo straight after dropping out takes the player back in with the normal "You\'re back in"', async () => {
    const { ctx, page } = await open('Mitchel');
    await row(page, B).getByRole('button', { name: "I'm in" }).click();
    await page.locator('.pop', { hasText: "You're in" }).waitFor();
    await page.locator('.pop').waitFor({ state: 'detached', timeout: 5000 });
    await row(page, B).getByRole('button', { name: 'Drop out' }).click();
    await page.locator('dialog[open]').getByRole('button', { name: 'Drop out' }).click();
    const pop = page.locator('.pop');
    await pop.waitFor();
    await pop.getByRole('button', { name: 'Undo' }).click();
    await row(page, B).locator('.st-in', { hasText: "You're in" }).waitFor();
    assert(!FORBIDDEN.test(await text(page, B)), `after Undo: ${await text(page, B)}`);
    await ctx.close();
  });

  await check('the records behind the screen are unchanged: someone who tapped I\'m in is still on the list server-side, and a payment stays a payment', async () => {
    const nathan = await record('Nathan', B);
    assert(nathan.status === 'waitlisted', `Nathan's record is "${nathan.status}"; only the screen should change`);
    const devon = await record('Devon', A);
    assert(devon.oweCents === 1400 && devon.paymentStatus === 'unpaid', `Devon's record: ${JSON.stringify({ owe: devon.oweCents, pay: devon.paymentStatus })}`);
    const casey = await record('Casey', A);
    assert(casey.paymentStatus === 'paid', `Casey's record: ${casey.paymentStatus}`);
  });

  // Game day for A (Mon morning style): the top Pay card and the row's pay buttons.
  const gameDay = Date.parse(A.startsAt) - 10 * 3600_000; // 10 hours before the start: game day, after 8 AM Eastern
  await setClock(gameDay);
  const payWords = /\bdue\b|left to pay|Pay \$|\bPay\b|I paid|Use credit/;

  await check('(b) no court + unpaid: no due line, no Pay or I paid, no Pay card at the top, even on game day; Drop out stays', async () => {
    const { ctx, page } = await open('Devon');
    assert((await page.locator('.pay-card').count()) === 0, 'a Pay card is up with no court booked');
    const t = await text(page, A);
    assert(!payWords.test(t), `pay words on the card: ${t}`);
    assert(/Drop out/.test(t) && /You're in/.test(t) && /Court not booked/.test(t), `card: ${t}`);
    await ctx.close();
  });

  await check('(c) no court + already paid: still shows paid', async () => {
    const { ctx, page } = await open('Casey');
    const t = await text(page, A);
    assert(/Paid/.test(t), `Casey's card should still say Paid: ${t}`);
    assert(!/\bdue\b|I paid|Pay \$/.test(t), `and nothing owed: ${t}`);
    await ctx.close();
  });

  await check('(d) the court gets booked: the pay prompts appear for the player who is in and unpaid', async () => {
    assert((await post(areq, `/api/admin/sessions/${A.id}/booked`, {})).ok(), 'booked');
    const { ctx, page } = await open('Devon');
    await page.locator('.pay-card').waitFor();
    const t = await text(page, A);
    assert(/Court booked/.test(t), `status: ${t}`);
    assert(/Pay|I paid|due/.test(t) || (await page.locator('.pay-card').innerText()).includes('$14'), `no pay prompt after booking: ${t}`);
    await ctx.close();
  });

  await check('(e) booked, then changed back to not booked: the prompts go away again and the payment stays paid', async () => {
    const r = await put(areq, `/api/admin/sessions/${A.id}/booking`, { bookingStatus: 'needs_booking', courtCostCents: null });
    assert(r.ok(), `un-book: ${await r.text()}`);
    const devon = await open('Devon');
    assert((await devon.page.locator('.pay-card').count()) === 0, 'the Pay card is still up');
    const t = await text(devon.page, A);
    assert(!payWords.test(t) && /Court not booked/.test(t), `card: ${t}`);
    await devon.ctx.close();
    const casey = await open('Casey');
    assert(/Paid/.test(await text(casey.page, A)), 'Casey no longer shows paid');
    await casey.ctx.close();
    assert((await record('Casey', A)).paymentStatus === 'paid', 'the record says paid');
  });

  await browser.close();
  console.log(`\nno-court: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
