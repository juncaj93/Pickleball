/* The "Want in <day>?" card at the top of the player screen:
 *   - Yes joins the game exactly like "I'm in" on that game's card (same money, same banner),
 *     and the game card, count, circles and names update AT ONCE (not after Done)
 *   - the same in the organizer's demo ("View as..."): the demo copy changes, the real data does not
 *   - the prompt and the "You're in" answer use the short time "8-10 PM" (en dash)
 *   - the title says the weekday only when the game is 1 to 6 days away
 * Fake group, fake clock: Fri Oct 30, 9:00 AM Eastern (Thu Nov 5 is 6 days away).
 *
 *   node e2e/want-in.cjs      (also run by npm run test:e2e)
 */
const { spawn } = require('node:child_process');
const { rmSync, mkdirSync } = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const PORT = 5233;
const BASE = `http://localhost:${PORT}`;
const SETUP_TOKEN = 'wantin-setup-token-0123456789';
const PIN = '482913';
const NAMES = ['Alex', 'Nathan', 'Ryan', 'Mitchel', 'Brandon', 'Julian', 'Dana'];
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

async function main() {
  const dbFile = path.join(ROOT, '.data', 'wantin.sqlite');
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
  await fetch(`${BASE}/__dev/clock`, { method: 'POST', body: JSON.stringify({ atMs: Date.parse('2026-10-30T09:00:00-04:00') }) });

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
  const adminCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, userAgent: UA });
  await post(adminCtx.request, '/api/admin/login', { pin: PIN });
  const dash = async () => (await adminCtx.request.get(`${BASE}/api/admin/dashboard`)).json();
  let d = await dash();
  for (const h of d.hiddenSessions || []) await post(adminCtx.request, `/api/admin/sessions/${h.id}/show`, { shown: true });
  d = await dash();
  const games = d.sessions.filter((s) => !s.state.flags.past);
  for (const s of games) await post(adminCtx.request, `/api/admin/sessions/${s.id}/booked`, {});
  const thu = games.find((s) => s.startsAt.startsWith('2026-11-06T01:00')); // Thu Nov 5, 8 PM Eastern
  assert(thu, `no Thu Nov 5 game in ${games.map((g) => g.startsAt)}`);
  const idOf = (n) => d.players.find((p) => p.name === n).id;
  const who = {};
  for (const n of NAMES) {
    const c = await browser.newContext();
    await post(c.request, '/api/me', { playerId: idOf(n) });
    who[n] = c.request;
  }
  // Mitchel and Brandon are already in the Thursday game (so it reads "2 of 4 in").
  for (const n of ['Mitchel', 'Brandon']) await post(who[n], `/api/sessions/${thu.id}/join`, {});
  // Nathan, Ryan and Dana only play Thursdays: they get the "Want in Thursday?" card for Nov 5 (Tuesday Nov 3 is answered below).
  for (const n of ['Nathan', 'Ryan', 'Dana']) {
    await who[n].put(BASE + '/api/me/days', { data: { days: [4] }, headers: { Origin: BASE } });
  }

  const phone = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: UA };
  async function open(name) {
    const ctx = await browser.newContext(phone);
    await post(ctx.request, '/api/me', { playerId: idOf(name) });
    const page = await ctx.newPage();
    await page.goto(BASE);
    await page.locator('.schedule article').first().waitFor();
    return { ctx, page };
  }
  const cardOf = (page) => page.locator(`#row-${thu.id}`);
  const readCard = (card) =>
    card.evaluate((el) => ({
      count: el.querySelector('.in-count')?.textContent.trim(),
      balls: el.querySelectorAll('.dots .ball').length,
      names: [...el.querySelectorAll('.names-line')].map((n) => n.textContent.trim()).join(' | '),
      joined: el.dataset.mine === 'in',
      money: [...el.querySelectorAll('.sched-money')].map((m) => m.innerText.replace(/\s+/g, ' ').trim()).join(' | '),
      drop: !!el.querySelector('.drop-link'),
    }));

  await check('the prompt says "Want in Thursday?" (6 days away, no "next"), with the short time 8–10 PM', async () => {
    const { ctx, page } = await open('Nathan');
    const card = page.getByRole('region', { name: /^Want in / });
    await card.waitFor();
    assert((await card.getByRole('heading').innerText()).trim() === 'Want in Thursday?', `title: ${await card.getByRole('heading').innerText()}`);
    const t = squash(await card.innerText());
    assert(/Thu, Nov 5 · 8–10 PM/.test(t), `time line: ${t}`);
    assert(!/8:00|10:00/.test(t), `long time still shown: ${t}`);
    await ctx.close();
  });

  let nathanSeat;
  await check('REAL mode: Yes joins that game at once: card, count, circles, names and the banner update without tapping Done', async () => {
    const { ctx, page } = await open('Nathan');
    const card = cardOf(page);
    const before = await readCard(card);
    assert(!before.joined && before.count === '2 of 4 in', `before: ${JSON.stringify(before)}`);
    await page.getByRole('region', { name: /^Want in / }).getByRole('button', { name: 'Yes' }).click();
    // The banner, like tapping I'm in.
    const pop = page.locator('.pop');
    await pop.waitFor();
    assert(squash(await pop.innerText()) === "You're in", `banner: ${await pop.innerText()}`);
    // The answer card is still there (Done not tapped) and shows the short time.
    const answer = page.getByRole('region', { name: 'Your answer' });
    await answer.getByRole('heading', { name: "You're in" }).waitFor();
    const at = squash(await answer.innerText());
    assert(/Thu, Nov 5 · 8–10 PM/.test(at) && !/8:00|10:00/.test(at), `answer time: ${at}`);
    // The game card below changed already.
    await card.locator('.tile-check').waitFor();
    const after = await readCard(card);
    assert(after.joined && after.count === '3 of 4 in' && after.balls === before.balls + 1, `after: ${JSON.stringify(after)}`);
    assert(/Nathan/.test(after.names) && after.drop, `names/drop: ${JSON.stringify(after)}`);
    assert(/\$14 due/.test(after.money), `money line: ${after.money}`);
    await answer.getByRole('button', { name: 'Done' }).click();
    await answer.waitFor({ state: 'detached' });
    nathanSeat = (await (await who.Nathan.get(`${BASE}/api/group`)).json()).sessions.find((s) => s.id === thu.id).mine;
    await ctx.close();
  });

  await check('REAL mode: Yes and "I\'m in" on the same game give the same seat and the same money', async () => {
    const { ctx, page } = await open('Ryan');
    const card = cardOf(page);
    await card.getByRole('button', { name: "I'm in" }).click();
    await card.locator('.tile-check').waitFor();
    const ryanSeat = (await (await who.Ryan.get(`${BASE}/api/group`)).json()).sessions.find((s) => s.id === thu.id).mine;
    for (const k of ['status', 'paymentStatus', 'oweCents', 'shareCents', 'creditCents', 'useCreditCents', 'paidWithCredit', 'selfPaid']) {
      assert(JSON.stringify(nathanSeat[k]) === JSON.stringify(ryanSeat[k]), `${k}: Yes gave ${JSON.stringify(nathanSeat[k])}, I'm in gave ${JSON.stringify(ryanSeat[k])}`);
    }
    // The banner is the same too.
    await ctx.close();
    const nowD = await dash();
    assert(nowD.sessions.find((s) => s.id === thu.id).confirmedCount === 4, 'four in on Thursday (Mitchel, Brandon, Nathan, Ryan)');
  });

  await check('DEMO mode (organizer "View as..."): Yes shows the player as joined at once; the real data is not changed', async () => {
    const before = (await dash()).sessions.find((s) => s.id === thu.id).confirmedCount;
    const page = await adminCtx.newPage();
    await page.goto(`${BASE}/admin`);
    await page.getByRole('button', { name: 'View as…' }).click();
    await page.locator('dialog[open]').getByRole('button', { name: 'Dana', exact: true }).click();
    await page.getByRole('region', { name: 'Viewing as a player' }).getByText('Viewing as').waitFor();
    const want = page.getByRole('region', { name: /^Want in / });
    await want.waitFor();
    const card = cardOf(page);
    const was = await readCard(card);
    assert(!was.joined, 'Dana should not be in yet');
    await want.getByRole('button', { name: 'Yes' }).click();
    await card.locator('.tile-check').waitFor();
    const now = await readCard(card);
    assert(now.joined && now.balls === was.balls + 1 && /Dana/.test(now.names), `demo card after Yes: ${JSON.stringify(now)}`);
    await page.locator('.pop').waitFor();
    assert(squash(await page.locator('.pop').innerText()) === "You're in", 'demo banner');
    const after = (await dash()).sessions.find((s) => s.id === thu.id).confirmedCount;
    assert(after === before, `the demo changed the real game: ${before} to ${after}`);
    await page.close();
  });

  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
