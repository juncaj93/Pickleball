/* Admin audit (Sun Nov 1, 2026): the organizer's Home after requested changes 15 and 16.
 *   16: a game never marked Booked gets one plain court card. Before it is over: "Court still needs
 *       to be booked" with the CourtReserve link. After its date: "Did you guys play?" with
 *       "Yes, we played" and "Cancel game". No "Court opened" / "Didn't open" anywhere.
 *   15: notice cards (texts to send) get an X that hides them on this phone until something new.
 * Plus layout checks of these cards at 390 and 320 px, light and dark.
 * A fake group on a throwaway dev server with a fake clock; nothing here touches the live site.
 *
 *   node e2e/admin-audit.cjs      (also run by npm run test:e2e)
 */
const { spawn } = require('node:child_process');
const { rmSync, mkdirSync } = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.E2E_PORT) || 5281;
const BASE = `http://localhost:${PORT}`;
const SETUP_TOKEN = 'adminaudit-setup-token-0123456789';
const PIN = '482913';
const NAMES = ['Alex', 'Ryan', 'Julian', 'Nathan', 'Mitchel', 'Brandon', "Seán O'Brien-Núñez"];
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const SHOTS = path.join(__dirname, 'screenshots');
const HOUR = 3600_000;
const DAY = 24 * HOUR;

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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Midnight-ish: 10:00 AM Eastern on the calendar day after `iso`. */
function nextDayTenAm(iso) {
  const tz = 'America/Detroit';
  const fmt = (ms) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
  const day = fmt(Date.parse(iso));
  let t = Date.parse(iso);
  while (fmt(t) === day) t += 15 * 60_000;
  return t + 10 * HOUR;
}

async function main() {
  const dbFile = path.join(ROOT, '.data', 'adminaudit.sqlite');
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
    await sleep(500);
  }
  const clock = (atMs) => fetch(`${BASE}/__dev/clock`, { method: 'POST', body: JSON.stringify({ atMs }) });
  await clock(Date.now());

  const browser = await chromium.launch();
  const post = (req, url, data) => req.post(BASE + url, { data, headers: { Origin: BASE } });
  const put = (req, url, data) => req.put(BASE + url, { data, headers: { Origin: BASE } });
  const setup = (await browser.newContext()).request;
  const made = await post(setup, '/api/setup', {
    setupToken: SETUP_TOKEN,
    groupName: 'Pickleball Bros',
    pin: PIN,
    venmoUrl: 'https://venmo.com/u/organizer',
    players: NAMES.map((name, i) => ({ name, phone: `24855504${String(i).padStart(2, '0')}` })),
  });
  if (!made.ok()) throw new Error(`setup failed: ${await made.text()}`);
  let areq = (await browser.newContext()).request;
  await post(areq, '/api/admin/login', { pin: PIN });
  const dash = async () => (await areq.get(`${BASE}/api/admin/dashboard`)).json();
  let d = await dash();
  for (const h of d.hiddenSessions || []) await post(areq, `/api/admin/sessions/${h.id}/show`, { shown: true });
  d = await dash();
  const idOf = (n) => d.players.find((p) => p.name === n).id;
  const phones = {};
  for (const n of NAMES) {
    const c = await browser.newContext();
    await post(c.request, '/api/me', { playerId: idOf(n) });
    phones[n] = c.request;
  }
  const court = (id, status) => post(areq, `/api/admin/sessions/${id}/court-status`, { status });

  // Two games that will be in the past: "played" (Yes, we played) and "cancel" (Cancel game).
  const [gPlayed, gCancel, gNext] = d.sessions.filter((s) => !s.state.flags.past);
  for (const g of [gPlayed, gCancel]) {
    await court(g.id, 'booked');
    for (const n of ['Alex', 'Ryan', 'Julian', 'Nathan']) await post(phones[n], `/api/sessions/${g.id}/join`, {});
    for (const n of ['Alex', 'Ryan']) await post(areq, `/api/admin/sessions/${g.id}/payment`, { playerId: idOf(n), paid: true });
  }
  // Played was on the venue Waitlist, Cancel was never booked: both "never marked Booked".
  await court(gPlayed.id, 'waitlist');
  await court(gCancel.id, 'not_booked');

  // The clock: 10:00 AM the day after the second game. Sign in again on the new day.
  const nowMs = nextDayTenAm(gCancel.startsAt);
  await clock(nowMs);
  areq = (await browser.newContext()).request;
  await post(areq, '/api/admin/login', { pin: PIN });
  d = await dash();
  // The next game: tomorrow 7 PM, on Waitlist, with 2 in (a "Need players" text card and the court card).
  const tomorrow7 = nextDayTenAm(new Date(nowMs).toISOString()) + 9 * HOUR;
  const mv = await put(areq, `/api/admin/sessions/${gNext.id}/time`, { startsAt: new Date(tomorrow7).toISOString(), endsAt: new Date(tomorrow7 + 2 * HOUR).toISOString() });
  if (!mv.ok() && mv.status() !== 409) throw new Error(`move failed: ${await mv.text()}`);
  await court(gNext.id, 'waitlist');
  for (const n of ['Mitchel', 'Brandon']) await post(phones[n], `/api/sessions/${gNext.id}/join`, {});
  // A second game within 48 hours with 1 in: a second "Need players" card, for the double-tap check.
  const gSecond = d.sessions.filter((x) => Date.parse(x.startsAt) > nowMs && x.id !== gNext.id)[0];
  const in40 = nowMs + 40 * HOUR;
  const mv2 = await put(areq, `/api/admin/sessions/${gSecond.id}/time`, { startsAt: new Date(in40).toISOString(), endsAt: new Date(in40 + 2 * HOUR).toISOString() });
  if (!mv2.ok() && mv2.status() !== 409) throw new Error(`move 2 failed: ${await mv2.text()}`);
  await post(phones.Brandon, `/api/sessions/${gSecond.id}/join`, {});
  const moneyOf = async (id) => {
    const s = (await dash()).sessions.find((x) => x.id === id);
    return JSON.stringify(s.roster.map((r) => [r.playerId, r.status, r.paymentStatus, r.paymentAmountCents, r.creditCents]));
  };
  const potOf = async (name) => ((await dash()).creditLedger.find((l) => l.playerId === idOf(name)) || {}).balanceCents || 0;

  const phone = (width, colorScheme) => ({ viewport: { width, height: 800 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme, userAgent: UA });
  async function openAdmin(width = 390, scheme = 'light') {
    const ctx = await browser.newContext(phone(width, scheme));
    await post(ctx.request, '/api/admin/login', { pin: PIN });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/admin`);
    await page.locator('section[aria-labelledby="sessions-title"]').waitFor();
    return { ctx, page };
  }
  const playedCard = (page, id) => page.locator(`.do-now article[data-task="court_played"][data-session="${id}"]`);
  const bookCard = (page, id) => page.locator(`.do-now article[data-task="court_book"][data-session="${id}"]`);

  // ---------- 16 ----------
  for (const [width, scheme] of [
    [390, 'light'],
    [390, 'dark'],
    [320, 'light'],
    [320, 'dark'],
  ]) {
    await check(`16 at ${width} px ${scheme}: past games ask "Did you guys play?", the waitlisted game says "Court still needs to be booked"; no old court buttons; fits`, async () => {
      const { ctx, page } = await openAdmin(width, scheme);
      for (const g of [gPlayed, gCancel]) {
        const c = playedCard(page, g.id);
        await c.waitFor();
        // One question at a time: the game's Finalize card waits for the answer.
        assert((await page.locator(`[data-finalize="${g.id}"]`).count()) === 0, 'Finalize card shown before "Did you guys play?" was answered');
        assert((await c.locator('.dn-text').innerText()) === 'Did you guys play?', 'wording');
        const buttons = await c.getByRole('button').allInnerTexts();
        assert(JSON.stringify(buttons) === JSON.stringify(['Yes, we played', 'Cancel game']), `buttons: ${buttons}`);
        assert((await c.getByRole('link').count()) === 0, 'no court link on the after-the-game card');
      }
      const b = bookCard(page, gNext.id);
      await b.waitFor();
      assert((await b.locator('.dn-text').innerText()) === 'Court still needs to be booked', 'wording');
      assert((await b.getByRole('button').count()) === 0, 'nothing else on it');
      const href = await b.getByRole('link').getAttribute('href');
      const pill = await page.getByRole('link', { name: /Book a court/ }).first().getAttribute('href');
      assert(href === pill, `booking link ${href} is not the Book a court link ${pill}`);
      assert((await page.getByRole('button', { name: /^(Court opened|Didn't open|I booked it)$/ }).count()) === 0, 'old court buttons still shown');
      // One court card per game.
      for (const g of [gPlayed, gCancel, gNext]) assert((await page.locator(`.do-now article[data-session="${g.id}"]`).count()) === 1, 'one court card per game');
      // Layout: no sideways scroll, every button and link 44 px tall, nothing past the card's edge.
      const lay = await page.evaluate(() => {
        const bad = [];
        for (const c of document.querySelectorAll('.do-now article')) {
          const cb = c.getBoundingClientRect();
          for (const e of c.querySelectorAll('button, a')) {
            const r = e.getBoundingClientRect();
            if (r.height < 43.5) bad.push(`${e.textContent.trim() || e.getAttribute('aria-label')} ${Math.round(r.height)}px tall`);
            if (r.right > cb.right + 0.5 || r.left < cb.left - 0.5) bad.push(`${e.textContent.trim()} sticks out`);
          }
        }
        return { bad, sideways: document.documentElement.scrollWidth > window.innerWidth + 1 };
      });
      assert(!lay.sideways, 'sideways scroll');
      assert(lay.bad.length === 0, lay.bad.join(', '));
      await page.locator('.do-now').screenshot({ path: path.join(SHOTS, `admin-audit-court-cards-${width}-${scheme}.png`) });
      await ctx.close();
    });
  }

  await check('16: "Yes, we played" moves no money, clears the card (also on a second phone) and brings the Finalize card into view', async () => {
    const before = await moneyOf(gPlayed.id);
    const { ctx, page } = await openAdmin();
    const other = await openAdmin(320, 'dark');
    // The finger taps Yes, then taps the same spot again at about 0.8 s and 1.3 s (a slow double tap):
    // the next game's card and then the Finalize card move under it. Neither may take the tap.
    const yes = playedCard(page, gPlayed.id).getByRole('button', { name: 'Yes, we played' });
    await yes.evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
    await sleep(200);
    const yb = await yes.boundingBox();
    const tapAt = () => page.mouse.click(yb.x + yb.width / 2, yb.y + yb.height / 2);
    await tapAt();
    await sleep(800);
    await tapAt();
    await sleep(500);
    await tapAt();
    await page.locator('.toast', { hasText: 'Saved' }).first().waitFor();
    await sleep(1500);
    const dd = await dash();
    assert(!dd.sessions.find((x) => x.id === gPlayed.id).finalized, 'a slow double tap finalized the game');
    assert(!dd.taskMarks.includes(`${gCancel.id}:played`), 'a slow double tap answered Yes for the next game too');
    assert((await playedCard(page, gCancel.id).count()) === 1, 'the next game is no longer asked');
    await playedCard(page, gPlayed.id).waitFor({ state: 'detached' });
    assert((await moneyOf(gPlayed.id)) === before, 'money moved');
    const fin = page.locator(`[data-finalize="${gPlayed.id}"]`);
    await fin.waitFor();
    // In view (focus is left alone here: the extra taps above moved it on purpose).
    const fb = await fin.boundingBox();
    assert(fb && fb.y >= 0 && fb.y < page.viewportSize().height, `the Finalize card is not in view: ${JSON.stringify(fb)}`);
    await other.page.reload();
    await other.page.locator('section[aria-labelledby="sessions-title"]').waitFor();
    await playedCard(other.page, gCancel.id).waitFor();
    assert((await playedCard(other.page, gPlayed.id).count()) === 0, 'still asked on the second phone');
    await ctx.close();
    await other.ctx.close();
  });

  await check('16: "Cancel game" opens the usual Cancel session dialog (no court-cancel warning after the game); credit back once; players see Canceled', async () => {
    const alex0 = await potOf('Alex');
    const ryan0 = await potOf('Ryan');
    const { ctx, page } = await openAdmin(320, 'light');
    await playedCard(page, gCancel.id).getByRole('button', { name: 'Cancel game' }).click();
    const dlg = page.locator('dialog[open]');
    await dlg.waitFor();
    assert(/Cancel /.test(await dlg.locator('h2, h3').first().innerText()), 'the Cancel session dialog');
    assert((await dlg.getByText('This does not cancel your court').count()) === 0, 'court-cancel warning on a game that is over');
    await dlg.getByRole('button', { name: 'Cancel session' }).dblclick();
    await page.locator('.toast', { hasText: 'Session canceled' }).waitFor();
    await sleep(500);
    assert((await potOf('Alex')) === alex0 + 1400 && (await potOf('Ryan')) === ryan0 + 1400, 'credit back is not exactly $14 each');
    assert((await potOf('Julian')) === 0, 'unpaid player got credit');
    await page.keyboard.press('Escape');
    await page.reload();
    await page.locator('section[aria-labelledby="sessions-title"]').waitFor();
    assert((await page.locator(`.do-now article[data-session="${gCancel.id}"]`).count()) === 0, 'a canceled game still has a court card');
    const g = (await (await phones.Alex.get(`${BASE}/api/group`)).json()).sessions.find((s) => s.id === gCancel.id);
    assert(!g || g.canceled === true || (g.state && g.state.flags && g.state.flags.canceled), 'players do not see it canceled');
    await ctx.close();
  });

  await check('16: moving the switch to Booked clears "Court still needs to be booked", seats and money untouched', async () => {
    const before = await moneyOf(gNext.id);
    const { ctx, page } = await openAdmin();
    await bookCard(page, gNext.id).waitFor();
    await page.locator(`#session-${gNext.id}`).getByRole('button', { name: 'Booked', exact: true }).click();
    await bookCard(page, gNext.id).waitFor({ state: 'detached' });
    assert((await moneyOf(gNext.id)) === before, 'money or seats moved');
    await page.locator(`#session-${gNext.id}`).getByRole('button', { name: 'Waitlist', exact: true }).click();
    await bookCard(page, gNext.id).waitFor();
    assert((await moneyOf(gNext.id)) === before, 'money or seats moved back');
    await ctx.close();
  });

  // ---------- 15 ----------
  const needCard = (page) => page.locator(`article[data-suggest="need"][data-session="${gNext.id}"]`);
  await check('15: the Need players notice has an X (44 px, labeled); it hides the card, stays hidden after reload, comes back when the count changes', async () => {
    const { ctx, page } = await openAdmin(320, 'dark');
    const c = needCard(page);
    await c.waitFor();
    const x = c.getByRole('button', { name: /^Dismiss: Need players/ });
    const box = await x.boundingBox();
    const cardBox = await c.boundingBox();
    assert(box.width >= 44 && box.height >= 44, `X is ${box.width}x${box.height}`);
    assert(Math.abs(box.x + box.width - (cardBox.x + cardBox.width)) <= 1 && Math.abs(box.y - cardBox.y) <= 1, 'X is not in the top-right corner');
    // The X never covers the card's words.
    const overlap = await c.evaluate((card) => {
      const xr = card.querySelector('.card-x').getBoundingClientRect();
      const hit = [];
      for (const el of card.querySelectorAll('.sg-kind, .sg-who, .sg-when, .sg-preview')) {
        const r = document.createRange();
        r.selectNodeContents(el);
        const b = r.getBoundingClientRect();
        if (b.width && b.left < xr.right && b.right > xr.left + 0.5 && b.top < xr.bottom && b.bottom > xr.top) hit.push(el.className);
      }
      return hit;
    });
    assert(overlap.length === 0, `X covers: ${overlap}`);
    await x.click();
    await c.waitFor({ state: 'detached' });
    await page.reload();
    await page.locator('section[aria-labelledby="sessions-title"]').waitFor();
    await sleep(300);
    assert((await needCard(page).count()) === 0, 'came back after reload');
    // Another phone still has it.
    const other = await openAdmin();
    await needCard(other.page).waitFor();
    await other.ctx.close();
    // Something new: a third player joins. The card is back with the new count.
    await post(phones.Alex, `/api/sessions/${gNext.id}/join`, {});
    await page.reload();
    await needCard(page).waitFor();
    await ctx.close();
  });

  await check('15: a quick double tap on an X hides one card, not the one that slides up under the finger', async () => {
    const { ctx, page } = await openAdmin(390, 'light');
    const xs = page.locator('article[data-suggest] .card-x');
    await xs.first().waitFor();
    const ids = async () => page.locator('article[data-suggest]').evaluateAll((els) => els.map((e) => `${e.dataset.suggest}:${e.dataset.session}`));
    const before = await ids();
    assert(before.length >= 2, `need two notice cards, found ${before.length}`);
    await xs.first().evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
    await sleep(200);
    const box = await xs.first().boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await sleep(150);
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await sleep(400);
    const after = await ids();
    assert(!after.includes(before[0]), `the first card is still there: ${before} -> ${after}`);
    assert(after.includes(before[1]), `a double tap also hid the card below: ${before} -> ${after}`);
    // After the pause, the next X works as usual.
    await sleep(800);
    await xs.first().evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
    await sleep(200);
    const x2 = await xs.first().boundingBox();
    await page.mouse.click(x2.x + x2.width / 2, x2.y + x2.height / 2);
    await sleep(300);
    assert(!(await ids()).includes(after[0]), 'the next X did not work after the pause');
    await page.evaluate(() => localStorage.clear());
    await ctx.close();
  });

  await check('15: cards that need an answer or money have no X (Finalize, Who owes, court cards)', async () => {
    const { ctx, page } = await openAdmin();
    await page.locator('[data-finalize]').first().waitFor();
    for (const sel of ['[data-finalize]', '.do-now article[data-task^="court_"]', '[data-refund-request]', '[data-payment-claim]', 'article[aria-label="Who owes you"]', 'article[aria-label="Mark paid tonight"]', 'article[data-suggest="pay"]']) {
      const n = await page.locator(`${sel} .card-x`).count();
      assert(n === 0, `${sel} has an X`);
    }
    await ctx.close();
  });

  await check('15: with storage blocked, the X still hides the card for the visit and nothing breaks', async () => {
    const ctx = await browser.newContext(phone(390, 'light'));
    await ctx.addInitScript(() => {
      Object.defineProperty(window, 'localStorage', {
        get() {
          throw new Error('blocked');
        },
      });
    });
    await post(ctx.request, '/api/admin/login', { pin: PIN });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(`${BASE}/admin`);
    await page.locator('section[aria-labelledby="sessions-title"]').waitFor();
    const c = needCard(page);
    await c.waitFor();
    await c.getByRole('button', { name: /^Dismiss/ }).click();
    await c.waitFor({ state: 'detached' });
    assert(errors.length === 0, errors.join(' | '));
    await ctx.close();
  });

  await browser.close();
  console.log(`\nadmin-audit: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
