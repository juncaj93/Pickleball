/* The organizer pays the venue: the court row on Money > Who paid, the header
 * counts, the monthly summary, the Players tab, and the player screens.
 *
 *   node e2e/court.cjs      (also run by npm run test:e2e)
 *
 * Starts its own dev server with a fresh fake group where Alex is the
 * organizer. Pictures go to e2e/screenshots/court-*.png.
 */
const { spawn } = require('node:child_process');
const { rmSync, mkdirSync } = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.E2E_PORT) || 5195;
const BASE = `http://localhost:${PORT}`;
const SETUP_TOKEN = 'court-setup-token-0123456789';
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
    console.log(`  ✗ ${name}\n      ${String(err && err.message ? err.message : err).replace(/\s*\n\s*/g, ' ⏎ ').slice(0, 500)}`);
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
const squash = (t) => t.replace(/\s+/g, ' ').trim();

async function main() {
  const dbFile = path.join(ROOT, '.data', 'court.sqlite');
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
  // Mon Oct 26, 2026, 12:00 PM Eastern.
  await fetch(`${BASE}/__dev/clock`, { method: 'POST', body: JSON.stringify({ atMs: Date.parse('2026-10-26T12:00:00-04:00') }) });

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
    players: PEOPLE.map((name, i) => ({ name, phone: `248555010${i}` })),
  });
  await call(api.request, 'PUT', '/api/admin/group', { organizerName: 'Alex' });
  const d0 = await call(api.request, 'GET', '/api/admin/dashboard');
  const id = Object.fromEntries(d0.players.map((p) => [p.name, p.id]));
  const [four, six] = d0.sessions;
  // Four playing: Alex (organizer) and three others.
  await call(api.request, 'POST', `/api/admin/sessions/${four.id}/me`, { in: true });
  for (const n of ['Ryan', 'Brandon', 'Julian']) await call(api.request, 'POST', `/api/admin/sessions/${four.id}/roster`, { playerId: id[n], action: 'confirm' });
  // The next game: Alex is not playing; Ryan and Brandon are.
  for (const n of ['Ryan', 'Brandon']) await call(api.request, 'POST', `/api/admin/sessions/${six.id}/roster`, { playerId: id[n], action: 'confirm' });

  for (const [width, scheme] of [360, 375, 390, 430].flatMap((w) => [[w, 'light'], [w, 'dark']])) {
    const ctx = await browser.newContext({ viewport: { width, height: 860 }, isMobile: true, hasTouch: true, colorScheme: scheme });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await ctx.request.post(BASE + '/api/admin/login', { headers: { Origin: BASE }, data: { pin: PIN } });
    await page.goto(BASE + '/admin');
    await page.getByRole('navigation', { name: 'Organizer sections' }).getByRole('button', { name: /^Money/ }).click();
    const sess = (s) => page.locator(`details.money-sess[data-session="${s.id}"]`);
    const open = async (s) => {
      await sess(s).waitFor();
      if (!(await sess(s).evaluate((el) => el.open))) await sess(s).locator('summary').click();
    };
    const tag = `${width}px ${scheme}`;

    await check(`${tag}: header counts other players only ("0 of 3 paid", "3 owe")`, async () => {
      await sess(four).waitFor();
      const head = squash(await sess(four).locator('summary').innerText());
      assert(/0 of 3 paid/.test(head) && /3 owe/.test(head), head);
    });

    await check(`${tag}: your row is a court row: "You pay Northville Pickleball", $48, players cover $42, your share $6, Court due`, async () => {
      await open(four);
      const row = sess(four).locator('[data-court]');
      const t = squash(await row.innerText());
      assert(/You pay Northville Pickleball/.test(t), t);
      assert(/\$48/.test(t), t);
      assert(/Players cover \$42, your share \$6/.test(t), t);
      assert(/Court due/.test(t), t);
      assert(!/Payment reminder/.test(t), `reminder on court row: ${t}`);
      assert(!/Alex owes/.test(squash(await sess(four).innerText())), 'still says Alex owes');
      // The other three still have their reminder.
      assert((await sess(four).getByRole('button', { name: 'Payment reminder' }).count()) === 3, 'players lost their reminder buttons');
    });
    await page.screenshot({ path: path.join(SHOTS, `court-${width}-${scheme}-due.png`), fullPage: true });

    await check(`${tag}: Mark paid on the court row says Court paid and leaves the counts alone; Unmark undoes it`, async () => {
      const row = sess(four).locator('[data-court]');
      await row.getByRole('button', { name: 'Mark paid' }).click();
      await row.getByText('Court paid').waitFor();
      const head = squash(await sess(four).locator('summary').innerText());
      assert(/0 of 3 paid/.test(head), head);
      await row.getByRole('button', { name: 'Unmark' }).click();
      await row.getByText('Court due').waitFor();
    });

    await check(`${tag}: a player paying moves the count to "1 of 3" and the court row keeps "Players cover $42"`, async () => {
      await sess(four).locator('li', { hasText: 'Ryan' }).getByRole('button', { name: 'Mark paid' }).click();
      await page.locator(`details.money-sess[data-session="${four.id}"] summary`, { hasText: '1 of 3 paid' }).waitFor();
      assert(/Players cover \$42, your share \$6/.test(squash(await sess(four).locator('[data-court]').innerText())), 'cover line changed');
    });

    await check(`${tag}: a game you are not in still has the court row (2 others cover $28, your share $20)`, async () => {
      await open(six);
      const t = squash(await sess(six).locator('[data-court]').innerText());
      assert(/You pay Northville Pickleball/.test(t) && /\$48/.test(t) && /Players cover \$28, your share \$20/.test(t) && /Court due/.test(t), t);
      assert(/0 of 2 paid/.test(squash(await sess(six).locator('summary').innerText())), 'header count');
    });

    await check(`${tag}: monthly summary counts only what the other players paid`, async () => {
      const sum = squash(await page.locator('.money-sum').innerText());
      assert(/Collected \$0/.test(sum) || /Collected\s*\$0/.test(sum), sum);
      assert(/Membership \$30/.test(sum), sum);
      assert(!/Surplus/.test(sum), 'shows a surplus with nothing paid');
    });

    await check(`${tag}: Players tab shows no $14 balance for you, and still shows the others'`, async () => {
      await page.getByRole('navigation', { name: 'Organizer sections' }).getByRole('button', { name: /^Players/ }).click();
      const alex = page.locator('li.player-row[data-player="Alex"]');
      await alex.waitFor();
      const a = squash(await alex.innerText());
      assert(!/Owes|\$14/.test(a), a);
      const ryan = squash(await page.locator('li.player-row[data-player="Brandon"]').innerText());
      assert(/Owes \$28/.test(ryan) || /Owes \$14/.test(ryan) || /\$0/.test(ryan), ryan);
      await alex.locator('.player-open').click();
      const sheet = squash(await page.locator('dialog[open]').innerText());
      assert(/You pay the court directly/.test(sheet) && !/\$14/.test(sheet), sheet);
    });
    await page.screenshot({ path: path.join(SHOTS, `court-${width}-${scheme}-players.png`), fullPage: true });

    await check(`${tag}: Who paid layout: court name and $48 on one line, equal-width buttons, 44px taps, nothing cut off or overlapping`, async () => {
      await page.keyboard.press('Escape');
      await page.locator('dialog[open]').waitFor({ state: 'detached' }).catch(() => {});
      await page.getByRole('navigation', { name: 'Organizer sections' }).getByRole('button', { name: /^Money/ }).click();
      await open(four);
      await sess(four).getByRole('button', { name: 'Payment reminder' }).first().waitFor();
      const m = await sess(four).evaluate((el) => {
        const r = (e) => e.getBoundingClientRect();
        const court = el.querySelector('[data-court]');
        const name = r(court.querySelector('.pc-name'));
        const cost = r(court.querySelector('.court-cost'));
        const sub = r(court.querySelector('.pc-sub'));
        const cr = r(court);
        const pairs = [...el.querySelectorAll('.pay-btns')].map((g) => [...g.children].map((b) => { const q = r(b); return { w: q.width, h: q.height, l: q.left, rt: q.right, cut: b.scrollWidth > b.clientWidth + 1 }; }));
        const rows = [...el.querySelectorAll('.pay-row')].map((x) => r(x).height);
        const text = [...el.querySelectorAll('.pay-who, .pc-name, .pc-sub span')].filter((x) => x.scrollWidth > x.clientWidth + 1).length;
        const overlap = (a, b) => a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;
        return { nameTop: name.top, costTop: cost.top, nameH: name.height, costH: cost.height, costRight: cost.right, courtRight: cr.right, subTop: sub.top, nameBottom: name.bottom, ov: overlap(name, cost), pairs, rows, text, padL: cost.left - cr.left, nameL: name.left - cr.left };
      });
      assert(Math.abs(m.nameTop + m.nameH / 2 - (m.costTop + m.costH / 2)) < 6 || width < 375, `$48 not beside name: ${JSON.stringify(m)}`);
      assert(!m.ov && m.costRight <= m.courtRight - 8, 'cost overlaps or touches the edge');
      assert(m.nameL >= 8, `court text only ${m.nameL}px from the edge`);
      assert(m.text === 0, 'cut-off text');
      for (const g of m.pairs) {
        for (const b of g) assert(b.h >= 44 && !b.cut, `button ${b.w}x${b.h} cut=${b.cut}`);
        assert(g.length === 2 || g.length === 1, 'pair size');
        for (const b of m.pairs.flat()) assert(Math.abs(b.w - m.pairs[0][0].w) < 1.5 && Math.abs(b.h - m.pairs[0][0].h) < 1.5, `unequal buttons: ${JSON.stringify(m.pairs)}`);
      }
      assert(m.rows.every((h) => h < 150), `player rows too tall: ${m.rows}`);
    });
    await check(`${tag}: nothing spills sideways`, async () => {
      const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      assert(over <= 0, `page scrolls sideways by ${over}px`);
    });
    await check(`${tag}: no browser errors`, async () => assert(errors.length === 0, errors.join(' | ')));
    await ctx.close();
    // Put Ryan back to unpaid so the next screen width starts from the same place.
    await call(api.request, 'POST', `/api/admin/sessions/${four.id}/payment`, { playerId: id.Ryan, paid: false });
  }

  // Player screens: Alex (the organizer as a player) sees no Pay and no $14; Ryan sees his normal Pay; nobody sees court words.
  // Game day morning, after 8:00 AM, when the pay card is up.
  await fetch(`${BASE}/__dev/clock`, { method: 'POST', body: JSON.stringify({ atMs: Date.parse(four.startsAt) - 10 * 3600_000 }) });
  const phone = async (name) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 860 }, isMobile: true, hasTouch: true });
    await call(ctx.request, 'POST', '/api/me', { playerId: id[name] });
    const page = await ctx.newPage();
    await page.goto(BASE + '/');
    return { ctx, page };
  };
  const COURT_WORDS = /Northville Pickleball|You pay|Court due|Court paid|Players cover|your share|court cost|\$48/i;

  await check('player screen, Alex (organizer): no Pay button, no "you owe" card, no $14, no court words', async () => {
    const { ctx, page } = await phone('Alex');
    await page.locator('.schedule article').first().waitFor({ timeout: 8000 });
    const t = squash(await page.locator('body').innerText());
    assert(!/Pay \$|Pay with Venmo|I paid|you owe|\$14/i.test(t), `money shows for the organizer: ${t.slice(0, 300)}`);
    assert(!COURT_WORDS.test(t.replace(/Northville Pickleball Club/g, '')), `court words on a player screen: ${t.slice(0, 300)}`);
    assert((await page.locator('header').first().innerText()).includes('Alex'), 'not on Alex\'s screen');
    await page.screenshot({ path: path.join(SHOTS, 'court-player-alex.png'), fullPage: true });
    await ctx.close();
  });

  // Pay prompts only show once a court is booked (a game with no court reads like a normal game and asks for nothing; see e2e/no-court.cjs),
  // so this check books the game's court, then puts it back.
  await call(api.request, 'POST', `/api/admin/sessions/${four.id}/booked`, {});
  await check('player screen, Ryan: still sees Pay $14 and I paid, and no court words', async () => {
    const { ctx, page } = await phone('Ryan');
    await page.locator('.schedule article').first().waitFor({ timeout: 8000 });
    const t = squash(await page.locator('body').innerText());
    assert(/you owe \$14/.test(t) && /Pay with Venmo/.test(t) && /I paid/.test(t), `Ryan lost his Pay buttons: ${t.slice(0, 300)}`);
    assert(!COURT_WORDS.test(t.replace(/Northville Pickleball Club/g, '')), `court words on a player screen: ${t.slice(0, 300)}`);
    await ctx.close();
  });
  await call(api.request, 'PUT', `/api/admin/sessions/${four.id}/booking`, { bookingStatus: 'needs_booking', courtCostCents: null });

  await check('View as Alex in the demo: still no Pay and no court words', async () => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 860 }, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    await ctx.request.post(BASE + '/api/admin/login', { headers: { Origin: BASE }, data: { pin: PIN } });
    await page.goto(BASE + '/admin');
    await page.getByRole('button', { name: /View as/ }).first().click();
    await page.getByRole('button', { name: /^Alex$/ }).first().click().catch(() => {});
    await page.getByText(/Viewing as Alex/).waitFor({ timeout: 8000 });
    const t = squash(await page.locator('body').innerText());
    assert(!/Pay \$|Pay with Venmo|you owe|\$14/i.test(t), `money shows in View as: ${t.slice(0, 300)}`);
    assert(!COURT_WORDS.test(t.replace(/Northville Pickleball Club/g, '')), `court words in View as: ${t.slice(0, 300)}`);
    await ctx.close();
  });

  // ---- After the games: the court row counts others at the final price once finalized.
  for (const n of ['Julian', 'Mitchel', 'Nathan']) await call(api.request, 'POST', `/api/admin/sessions/${six.id}/roster`, { playerId: id[n], action: 'confirm' });
  await fetch(`${BASE}/__dev/clock`, { method: 'POST', body: JSON.stringify({ atMs: Date.parse(six.endsAt) + 3600_000 }) });
  await check('before finalizing, the court row still counts others at $14; after finalizing it uses the final price (4 played with you: $14, cover $42; 5 others played: $11 each, they cover the $48 court)', async () => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 860 }, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    await ctx.request.post(BASE + '/api/admin/login', { headers: { Origin: BASE }, data: { pin: PIN } });
    await page.goto(BASE + '/admin');
    await page.getByRole('navigation', { name: 'Organizer sections' }).getByRole('button', { name: /^Money/ }).click();
    const sess = (s) => page.locator(`details.money-sess[data-session="${s.id}"]`);
    const open = async (s) => {
      await sess(s).waitFor();
      if (!(await sess(s).evaluate((el) => el.open))) await sess(s).locator('summary').click();
    };
    await open(six);
    assert(/Players cover \$70, your share \$0|Players cover the court/.test(squash(await sess(six).locator('[data-court]').innerText())), `before: ${squash(await sess(six).locator('[data-court]').innerText())}`);
    for (const s of [four, six]) {
      const res = await api.request.post(`${BASE}/api/admin/sessions/${s.id}/finalize`, { data: { everyone: true }, headers: { Origin: BASE } });
      assert(res.ok(), `finalize: ${res.status()} ${await res.text()}`);
    }
    await page.reload();
    await page.getByRole('navigation', { name: 'Organizer sections' }).getByRole('button', { name: /^Money/ }).click();
    await open(four);
    assert(/4 played · \$14 each/.test(squash(await sess(four).locator('summary').innerText())), 'four: summary');
    assert(/Players cover \$42, your share \$6/.test(squash(await sess(four).locator('[data-court]').innerText())), `four: ${squash(await sess(four).locator('[data-court]').innerText())}`);
    await open(six);
    assert(/5 played · \$11 each/.test(squash(await sess(six).locator('summary').innerText())), 'six: summary');
    const t = squash(await sess(six).locator('[data-court]').innerText());
    assert(/Players cover the court/.test(t) && /\$48/.test(t), `six: ${t}`);
    assert((await sess(six).getByText(/owes \$11/).count()) === 5, 'five others owe the final $11');
    assert(!/Alex owes|\$14/.test(squash(await sess(six).locator('[data-court]').innerText())), 'the organizer never owes');
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
