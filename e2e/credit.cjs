/* Credit, on a phone: a canceled game's payment becomes credit by itself (the
 * organizer's Money row lists it, no Refund / Keep choice), the Players tab
 * credit and "Refund credit balance", the player's CREDIT chip and credit
 * sheet (history, Request refund, Cancel request), the organizer's refund
 * request card (Refund opens Venmo, Mark refunded, Not now), "Use credit"
 * with the chip, partial credit, the game-day card, and "Were you charged?"
 * on cancel.
 *
 *   node e2e/credit.cjs      (also run by npm run test:e2e)
 *
 * Starts its own dev server with a fresh fake group (Alex is the organizer).
 * No Venmo page is ever opened: those requests are blocked.
 */
const { spawn } = require('node:child_process');
const { rmSync, mkdirSync } = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const PORT = 5195;
const BASE = `http://localhost:${PORT}`;
const SETUP_TOKEN = 'credit-setup-token-0123456789';
const PIN = '482913';
const SHOTS = path.join(__dirname, 'screenshots');
const PEOPLE = ['Alex', 'Ryan', 'Mitchel', 'Brandon', 'Julian'];
const WIDTHS = [360, 375, 390, 430];
/** Joined players no longer see a credit-back note under Pay (it sits under "I'm in" for people who have not joined). */
const NO_NOTE = '[data-pay-note], [data-credit-note]';

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
const nav = (page, name) => page.getByRole('navigation', { name: 'Organizer sections' }).getByRole('button', { name: new RegExp(`^${name}`) });

/** Nothing sticks out of `el`, no text is cut off, and the visible buttons do not overlap each other. */
async function tidy(locator, what) {
  const r = await locator.evaluate((el) => {
    const box = el.getBoundingClientRect();
    const outEls = [...el.querySelectorAll('*')].filter((x) => {
      const b = x.getBoundingClientRect();
      // The calendar icon hangs a few pixels outside on purpose (it is a bigger tap area than it looks).
      return b.width > 0 && !x.classList.contains('cal-icon-link') && !x.closest('.cal-icon-link') && (b.right > box.right + 1 || b.left < box.left - 1);
    });
    const out = outEls.length;
    const outInfo = outEls.slice(0, 3).map((x) => `${x.tagName}.${x.className} ${Math.round(x.getBoundingClientRect().left)}-${Math.round(x.getBoundingClientRect().right)} in ${Math.round(box.left)}-${Math.round(box.right)}`).join('; ');
    const cut = [...el.querySelectorAll('*')].filter((x) => !x.classList.contains('sr-only') && x.children.length === 0 && x.scrollWidth > x.clientWidth + 1 && getComputedStyle(x).overflow !== 'visible').length;
    const btns = [...el.querySelectorAll('a.btn, button.btn, button.link-btn')].filter((b) => b.getBoundingClientRect().width > 0);
    let overlap = 0;
    for (let i = 0; i < btns.length; i++)
      for (let j = i + 1; j < btns.length; j++) {
        const a = btns[i].getBoundingClientRect();
        const b = btns[j].getBoundingClientRect();
        if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) overlap++;
      }
    return { out, outInfo, cut, overlap, n: btns.length };
  });
  assert(r.out === 0, `${what}: something sticks out: ${r.outInfo}`);
  assert(r.cut === 0, `${what}: text is cut off`);
  assert(r.overlap === 0, `${what}: buttons overlap`);
}
const noSideways = async (page) => assert((await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 0, 'sideways scroll');
const greenButtons = (loc) =>
  loc.evaluate((el) =>
    [...el.querySelectorAll('a.btn, button.btn')].filter(
      (b) => b.getBoundingClientRect().width > 0 && !['secondary', 'outline', 'ghost', 'danger', 'text-btn'].some((c) => b.classList.contains(c)),
    ).length,
  );

/** The CREDIT chip: just left of the date tile, as tall as it, never over the name. */
async function chipPlaced(page, what) {
  const r = await page.evaluate(() => {
    const chip = document.querySelector('header [data-credit-chip]');
    const sq = document.querySelector('header .today');
    const h1 = document.querySelector('header h1');
    const c = chip.getBoundingClientRect();
    const s = sq.getBoundingClientRect();
    const range = document.createRange();
    range.selectNodeContents(h1);
    const name = range.getBoundingClientRect();
    return { gap: s.left - c.right, dh: Math.abs(c.height - s.height), dy: Math.abs(c.top - s.top), nameRight: Math.min(name.right, h1.getBoundingClientRect().right), chipLeft: c.left, h: c.height, inside: c.left >= 0 && s.right <= window.innerWidth };
  });
  assert(r.gap >= -0.5 && r.gap <= 20, `${what}: chip should sit just left of the date tile (gap ${r.gap}px)`);
  assert(r.dh <= 3 && r.dy <= 3, `${what}: chip should be as tall as the date tile (off by ${r.dh}/${r.dy}px)`);
  assert(r.nameRight <= r.chipLeft + 1, `${what}: the name runs under the chip`);
  assert(r.inside, `${what}: header pieces off screen`);
  assert(r.h >= 40, `${what}: chip tap area ${r.h}px`);
}

async function main() {
  const dbFile = path.join(ROOT, '.data', 'credit.sqlite');
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
  const clock = (iso) => fetch(`${BASE}/__dev/clock`, { method: 'POST', body: JSON.stringify({ atMs: Date.parse(iso) }) });
  // Mon Oct 26, 2026, 12:00 PM Eastern.
  const MON = '2026-10-26T12:00:00-04:00';
  await clock(MON);

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
  await call(api.request, 'PUT', `/api/admin/players/${(await call(api.request, 'GET', '/api/admin/dashboard')).players.find((p) => p.name === 'Mitchel').id}`, {
    name: 'Mitchel', isRegular: true, isActive: true, canReceiveSubstituteInvites: true, venmo: '@Mitchel-K',
  });
  const dash = () => call(api.request, 'GET', '/api/admin/dashboard');
  const d0 = await dash();
  const id = Object.fromEntries(d0.players.map((p) => [p.name, p.id]));
  const byDate = (d, date) => d.sessions.find((s) => new Date(s.startsAt).toLocaleDateString('en-CA', { timeZone: 'America/Detroit' }) === date);
  const tue = byDate(d0, '2026-10-27');
  const thu = byDate(d0, '2026-10-29');
  const nov3 = byDate(d0, '2026-11-03');
  const nov5 = byDate(d0, '2026-11-05');
  const nov10 = byDate(d0, '2026-11-10');
  const join = async (s, names) => {
    for (const n of names) await call(api.request, 'POST', `/api/admin/sessions/${s.id}/roster`, { playerId: id[n], action: 'confirm' });
  };
  // Mitchel paid ahead for Thu Oct 29 and Tue Nov 3.
  for (const s of [thu, nov3]) {
    await join(s, ['Mitchel', 'Ryan', 'Brandon', 'Julian']);
    await call(api.request, 'POST', `/api/admin/sessions/${s.id}/payment`, { playerId: id.Mitchel, paid: true });
  }

  const open = async (scheme, width) => {
    const ctx = await browser.newContext({ viewport: { width, height: 860 }, isMobile: true, hasTouch: true, colorScheme: scheme });
    await ctx.route(/venmo\.com/, (r) => r.abort());
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await ctx.request.post(BASE + '/api/admin/login', { headers: { Origin: BASE }, data: { pin: PIN } });
    await page.goto(BASE + '/admin');
    return { ctx, page, errors };
  };
  const player = async (name, scheme, width) => {
    const ctx = await browser.newContext({ viewport: { width, height: 860 }, isMobile: true, hasTouch: true, colorScheme: scheme });
    await ctx.route(/venmo\.com/, (r) => r.abort());
    await call(ctx.request, 'POST', '/api/me', { playerId: id[name] });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(BASE + '/');
    await page.locator('.schedule article').first().waitFor();
    return { ctx, page, errors };
  };
  const sess = (page, s) => page.locator(`details.money-sess[data-session="${s.id}"]`);
  const openSess = async (page, s) => {
    const row = sess(page, s);
    await row.waitFor();
    if (!(await row.evaluate((el) => el.open))) await row.locator('summary').click();
    return row;
  };
  const chip = (page) => page.locator('header [data-credit-chip]');
  const chipText = async (page) => squash(await chip(page).innerText());
  const openSheet = async (page) => {
    await chip(page).click();
    const sheet = page.locator('[data-credit-sheet]');
    await sheet.waitFor();
    return sheet;
  };
  const closeSheet = async (page) => {
    await page.keyboard.press('Escape');
    await page.locator('dialog[open]').waitFor({ state: 'detached' }).catch(() => {});
  };

  // ---- 1. Thu Oct 29 is canceled: Mitchel's $14 becomes credit by itself.
  await call(api.request, 'POST', `/api/admin/sessions/${thu.id}/decision`, { decision: 'cancel', confirm: true });
  for (const scheme of ['light', 'dark']) {
    for (const width of WIDTHS) {
      const tag = `${width}px ${scheme}`;
      const { ctx, page, errors } = await open(scheme, width);
      await check(`${tag}: Home has no refund card; the Money row for the canceled game lists "Now their credit: Mitchel $14 credit" with nothing to tap, tidy`, async () => {
        await page.locator('section[aria-labelledby="sessions-title"] article').first().waitFor();
        assert((await page.getByRole('article', { name: /Refund needed|was canceled\. Refund/ }).count()) === 0, 'the old refund card is still on Home');
        assert((await page.getByRole('button', { name: /Keep .* as .* credit/ }).count()) === 0, 'Keep as credit is gone');
        await nav(page, 'Money').click();
        const row = await openSess(page, thu);
        assert(/canceled/.test(await row.locator('summary').innerText()), 'row should say canceled');
        await row.getByText('Nobody owes for it. Anyone who paid has it as credit.').waitFor();
        const list = row.locator('[data-credit-back-list]');
        await list.getByRole('heading', { name: 'Now their credit' }).waitFor();
        await list.locator('li', { hasText: 'Mitchel' }).getByText('$14 credit', { exact: true }).waitFor();
        assert((await list.locator('li').count()) === 1, 'only the one who paid');
        assert((await row.getByRole('link', { name: /^Refund/ }).count()) === 0 && (await row.getByRole('button', { name: /Mark refunded|Keep/ }).count()) === 0, 'no Refund or Keep as credit on the Money row');
        assert((await greenButtons(row)) === 0, 'a green button on the canceled row');
        await tidy(list, 'credit-back list');
        await noSideways(page);
      });
      await check(`${tag}: the month: Credits owed $14 with its note, nothing held in October, Collected $0`, async () => {
        const sum = squash(await page.locator('.money-sum').innerText());
        assert(/Credits owed \$14/.test(sum), `credits owed: ${sum}`);
        assert(/Money that came back to players as credit\. Not taken off Left\./.test(sum), `credits note: ${sum}`);
        assert(!/Held/.test(sum), `October has nothing held once the game is canceled: ${sum}`);
        assert(/Collected \$0/.test(sum), `collected: ${sum}`);
        assert(!/kept from canceled games|Credit per person/.test(sum), 'old wording');
      });
      await check(`${tag}: no browser errors`, async () => assert(errors.length === 0, errors.join(' | ')));
      await ctx.close();
    }
  }

  // ---- 2. The Players tab: the credit, Refund credit balance, the history.
  for (const scheme of ['light', 'dark']) {
    for (const width of WIDTHS) {
      const tag = `${width}px ${scheme}`;
      const { ctx, page, errors } = await open(scheme, width);
      await check(`${tag}: Players tab shows Mitchel's credit, Refund credit balance (Venmo, exact amount, credit note), and the history by game`, async () => {
        await nav(page, 'Players').click();
        const row = page.locator('li.player-row[data-player="Mitchel"]');
        assert(/Credit \$14/.test(squash(await row.innerText())), squash(await row.innerText()));
        const refund = row.getByRole('link', { name: /^Refund Mitchel \$14 credit balance/ });
        await refund.waitFor();
        assert((await refund.getAttribute('href')) === 'https://venmo.com/?txn=pay&recipients=Mitchel-K&amount=14&note=Pickleball%20credit%20refund', `href ${await refund.getAttribute('href')}`);
        assert((await refund.getAttribute('data-app-href')) === 'venmo://paycharge?txn=pay&recipients=Mitchel-K&amount=14&note=Pickleball%20credit%20refund', 'app link');
        assert((await row.getByRole('button', { name: 'Mark refunded' }).count()) === 0, 'Mark refunded before Venmo was opened');
        assert((await page.locator('li.player-row[data-player="Ryan"]').getByText(/credit/i).count()) === 0, "credit shows on someone else's row");
        await tidy(row, 'player row');
        await noSideways(page);
        await row.locator('.player-open').click();
        const sheet = page.locator('dialog[open]');
        await sheet.locator('[data-credit-section]').waitFor();
        const t = squash(await sheet.locator('[data-credit-section]').innerText());
        assert(/\$14/.test(t) && /\+\$14 canceled Thu, Oct 29/.test(t), t);
        await tidy(sheet.locator('[data-credit-section]'), 'credit section');
        await closeSheet(page);
      });
      await check(`${tag}: no browser errors`, async () => assert(errors.length === 0, errors.join(' | ')));
      await ctx.close();
    }
  }

  // ---- 3. The player: the CREDIT chip, the credit sheet, Use credit; only their own credit.
  await join(nov5, ['Mitchel', 'Ryan', 'Brandon', 'Julian']);
  for (const scheme of ['light', 'dark']) {
    for (const width of WIDTHS) {
      const tag = `${width}px ${scheme}`;
      const { ctx, page, errors } = await player('Mitchel', scheme, width);
      await check(`${tag}: player sees a "CREDIT $14" chip left of the date tile (no "You have $14 credit" line) and Use credit as the one green button on the game they owe`, async () => {
        await chip(page).waitFor();
        assert((await chipText(page)) === 'CREDIT $14', `chip was "${await chipText(page)}"`);
        assert((await chip(page).getAttribute('aria-label')) === '$14 credit. Open your credit', `chip label ${await chip(page).getAttribute('aria-label')}`);
        await chipPlaced(page, tag);
        assert((await page.locator('[data-credit-line]').count()) === 0 && (await page.locator('header').getByText(/You have \$\d+ credit/).count()) === 0, 'the old credit line under the header is gone (the card keeps its own small "You have $14 credit" line)');
        const row = page.locator('article.sched', { hasText: 'Nov' }).filter({ has: page.locator('[data-use-credit]') }).first();
        const foot = row.locator('.sched-body');
        await foot.locator('[data-use-credit]').waitFor();
        assert((await greenButtons(foot)) === 1, `green buttons: ${await greenButtons(foot)}`);
        assert((await foot.locator('[data-use-credit]').evaluate((b) => !b.classList.contains('secondary'))), 'Use credit should be the green one');
        assert((await foot.getByRole('link', { name: /^Pay \$14/ }).count()) === 1, 'Pay $14 should show');
        assert((await foot.getByRole('button', { name: 'I paid' }).count()) === 0, 'I paid should wait until Pay is tapped');
        assert((await row.locator(NO_NOTE).count()) === 0, 'joined people see no credit-back note');
        await tidy(foot, 'pay row');
        await noSideways(page);
      });
      await check(`${tag}: tapping the chip opens the credit sheet: "$14 credit", the history, Request refund, one gray line; tidy`, async () => {
        const sheet = await openSheet(page);
        assert(squash(await sheet.locator('[data-credit-balance]').innerText()) === '$14 credit', `balance was "${await sheet.locator('[data-credit-balance]').innerText()}"`);
        const hist = sheet.locator('[data-credit-history] li');
        assert((await hist.count()) === 1 && squash(await hist.first().innerText()) === '+$14 canceled Thu, Oct 29', `history: ${await hist.allInnerTexts()}`);
        await sheet.locator('[data-request-refund]').waitFor();
        await sheet.getByText('Use your credit when you pay for a game.').waitFor();
        assert((await sheet.locator('[data-refund-pending]').count()) === 0, 'nothing pending');
        assert((await greenButtons(sheet)) <= 1, 'at most one green button on the sheet');
        await tidy(sheet, 'credit sheet');
        assert((await sheet.evaluate((el) => el.closest('dialog').scrollWidth - el.closest('dialog').clientWidth)) <= 0, 'sheet scrolls sideways');
        if (width === 390) await page.screenshot({ path: path.join(SHOTS, `credit-sheet-${scheme}.png`) });
        await closeSheet(page);
      });
      await check(`${tag}: no browser errors`, async () => assert(errors.length === 0, errors.join(' | ')));
      await ctx.close();
    }
  }
  {
    const { ctx, page } = await player('Ryan', 'light', 390);
    await check('another player sees no chip, no credit sheet and no Use credit; nothing about anyone else\'s credit', async () => {
      assert((await chip(page).count()) === 0, 'chip');
      assert((await page.locator('[data-credit-line], [data-credit-sheet]').count()) === 0, 'credit line or sheet');
      assert((await page.locator('[data-use-credit]').count()) === 0, 'use credit');
      const t = squash(await page.locator('body').innerText());
      assert(!/credit/i.test(t.replace(/If \d+ play, you get \$\d+ back as credit\./g, '').replace(/If you paid, it's now your credit\./g, '')), t.slice(0, 300));
      const raw = await (await ctx.request.get(BASE + '/api/group')).text();
      assert(!/creditLedger|keptAsCredit|potCredit|refundRequests|Mitchel-K/.test(raw), 'API leaks it');
      assert(/"balanceCents":0/.test(raw), "own credit should be $0");
    });
    await ctx.close();
  }

  // ---- 4. Refund requests: reserve, cancel, the organizer's card (Not now, Refund + Mark refunded), undo.
  {
    const { ctx, page } = await player('Mitchel', 'light', 390);
    await check('Request refund: the amount box starts at the full $14, never takes more, and a $5 request reserves $5: the chip says REFUND, $9 is left to use', async () => {
      const sheet = await openSheet(page);
      await sheet.locator('[data-request-refund]').click();
      const amount = sheet.getByLabel('Cash out amount');
      assert((await amount.inputValue()) === '14', `prefilled with ${await amount.inputValue()}`);
      await amount.fill('20');
      await sheet.getByRole('button', { name: /^Request cash out from/ }).click();
      await sheet.getByText('You have $14 credit.').waitFor();
      await amount.fill('5');
      await sheet.getByRole('button', { name: /^Request cash out from/ }).click();
      await page.locator('.toast', { hasText: 'Cash out requested' }).waitFor();
      const pending = sheet.locator('[data-refund-pending]');
      await pending.waitFor();
      assert(/^Cash out requested: \$5, pending Cancel request$/.test(squash(await pending.innerText())), `pending line was "${await pending.innerText()}"`);
      assert((await sheet.locator('[data-request-refund]').count()) === 0, 'one request at a time');
      await closeSheet(page);
      assert((await chipText(page)) === 'CASH OUT $14', `chip was "${await chipText(page)}"`);
      // The reserved $5 cannot be spent: $9 covers part of the $14 game.
      const foot = page.locator('article.sched').filter({ has: page.locator('[data-use-credit]') }).first().locator('.sched-body');
      await foot.getByText(/Uses your \$9 credit\. \$5 left to pay/).waitFor();
      assert(await foot.locator('[data-use-credit]').evaluate((b) => !b.classList.contains('outline')), 'Use credit is the filled button even when it covers part');
    });
    await check('Cancel request puts the $5 back: the chip says CREDIT again and Use credit covers the whole game', async () => {
      const sheet = await openSheet(page);
      await sheet.locator('[data-refund-pending]').getByRole('button', { name: 'Cancel request' }).click();
      await page.locator('.toast', { hasText: 'Request canceled' }).waitFor();
      await sheet.locator('[data-request-refund]').waitFor();
      await closeSheet(page);
      assert((await chipText(page)) === 'CREDIT $14', `chip was "${await chipText(page)}"`);
      const foot = page.locator('article.sched').filter({ has: page.locator('[data-use-credit]') }).first().locator('.sched-body');
      assert(await foot.locator('[data-use-credit]').evaluate((b) => !b.classList.contains('outline')), 'Use credit should be filled again');
    });
    await check('a request for the full $14 blocks spending it: no Use credit, Pay $14 stays', async () => {
      const sheet = await openSheet(page);
      await sheet.locator('[data-request-refund]').click();
      await sheet.getByRole('button', { name: /^Request cash out from/ }).click();
      await sheet.locator('[data-refund-pending]').getByText('Cash out requested: $14, pending').waitFor();
      await closeSheet(page);
      assert((await page.locator('[data-use-credit]').count()) === 0, 'Use credit should be gone while the whole credit is reserved');
      await page.locator('article.sched', { hasText: 'Nov' }).getByRole('link', { name: /^Pay \$14/ }).first().waitFor();
      assert((await chipText(page)) === 'CASH OUT $14', `chip was "${await chipText(page)}"`);
      await page.screenshot({ path: path.join(SHOTS, 'credit-player-refund-pending.png'), fullPage: true });
    });
    await ctx.close();
  }
  for (const scheme of ['light', 'dark']) {
    for (const width of WIDTHS) {
      const tag = `${width}px ${scheme}`;
      const { ctx, page, errors } = await open(scheme, width);
      await check(`${tag}: the organizer's Home card "Mitchel requested a refund of $14": green Refund to his Venmo with the credit note, Not now; the Players tab says refund requested and offers no Refund credit balance; tidy`, async () => {
        const card = page.locator('[data-refund-request="Mitchel"]');
        await card.waitFor();
        assert(squash(await card.locator('h3').innerText()) === 'Mitchel requested a refund of $14', `title was "${await card.locator('h3').innerText()}"`);
        const first = await page.locator('main article').first().getAttribute('data-refund-request');
        assert(first === 'Mitchel', 'the refund request comes first on Home');
        const link = card.locator('[data-refund-venmo]');
        assert((await link.getAttribute('href')) === 'https://venmo.com/?txn=pay&recipients=Mitchel-K&amount=14&note=Pickleball%20credit%20refund', `web link ${await link.getAttribute('href')}`);
        assert((await link.getAttribute('data-app-href')) === 'venmo://paycharge?txn=pay&recipients=Mitchel-K&amount=14&note=Pickleball%20credit%20refund', `app link ${await link.getAttribute('data-app-href')}`);
        assert((await card.getByText(/No Venmo saved/).count()) === 0, 'his Venmo is saved');
        assert((await card.locator('[data-mark-refunded]').count()) === 0, 'Mark refunded only after Venmo was opened');
        await card.locator('[data-not-now]').waitFor();
        assert((await greenButtons(card)) === 1, `green buttons: ${await greenButtons(card)}`);
        const h = await card.locator('[data-refund-venmo], [data-not-now]').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
        assert(h.every((x) => x >= 44), `tap targets ${h}`);
        assert(!/\bsent\b/i.test(await card.innerText()), 'says sent');
        await tidy(card, 'refund request card');
        await noSideways(page);
        await nav(page, 'Players').click();
        const row = page.locator('li.player-row[data-player="Mitchel"]');
        await row.getByText('refund requested').waitFor();
        assert((await row.locator('[data-credit-refund]').count()) === 0, 'the reserved $14 cannot be refunded twice');
        await tidy(row, 'player row');
      });
      await check(`${tag}: no browser errors`, async () => assert(errors.length === 0, errors.join(' | ')));
      if (width === 390) await page.screenshot({ path: path.join(SHOTS, `credit-refund-request-${scheme}.png`), fullPage: true });
      await ctx.close();
    }
  }
  {
    const { ctx, page } = await open('light', 390);
    await check('Not now closes the card and gives Mitchel his $14 back to use', async () => {
      const card = page.locator('[data-refund-request="Mitchel"]');
      await card.locator('[data-not-now]').click();
      await page.locator('.toast', { hasText: 'Put off for now' }).waitFor();
      await card.waitFor({ state: 'detached' });
      const m = await player('Mitchel', 'light', 390);
      assert((await chipText(m.page)) === 'CREDIT $14', `chip was "${await chipText(m.page)}"`);
      await m.page.locator('[data-use-credit]').first().waitFor();
      // He asks again, for the next check.
      const sheet = await openSheet(m.page);
      await sheet.locator('[data-request-refund]').click();
      await sheet.getByRole('button', { name: /^Request cash out from/ }).click();
      await sheet.locator('[data-refund-pending]').waitFor();
      await m.ctx.close();
    });
    await check('Refund opens Venmo and marks nothing; Mark refunded (also after a reload) takes the $14 off his credit and closes the card; logged', async () => {
      await page.reload();
      const card = page.locator('[data-refund-request="Mitchel"]');
      await card.waitFor();
      await card.locator('[data-refund-venmo]').click();
      await card.locator('[data-mark-refunded]').waitFor();
      assert((await card.count()) === 1, 'opening Venmo must not close the request');
      await page.reload();
      await page.locator('[data-refund-request="Mitchel"] [data-mark-refunded]').waitFor();
      await page.locator('[data-refund-request="Mitchel"] [data-mark-refunded]').click();
      await page.locator('.toast', { hasText: 'Mitchel refunded' }).waitFor();
      await page.locator('[data-refund-request="Mitchel"]').waitFor({ state: 'detached' });
      const m = await player('Mitchel', 'light', 390);
      assert((await chip(m.page).count()) === 0, 'no chip once the credit was paid back');
      assert((await m.page.locator('[data-use-credit]').count()) === 0, 'no credit left to use');
      await m.ctx.close();
      await nav(page, 'History').click();
      await page.getByRole('button', { name: 'Activity' }).click();
      const acts = page.getByRole('list', { name: 'Activity' });
      await acts.getByText('Mitchel asked for $14 refund of their credit').first().waitFor();
      await acts.getByText('Mitchel took back their refund request').first().waitFor();
      await acts.getByText("Alex put off Mitchel's refund request").first().waitFor();
      await acts.getByText("Alex paid Mitchel's credit back").first().waitFor();
      assert(!/\bsent\b/i.test(await acts.innerText()), 'says sent');
    });
    await check('Undo on the Players tab takes the refund back: Mitchel has $14 again and his request is waiting again (the card is back); Not now frees it; nothing here ever says money was sent', async () => {
      await nav(page, 'Players').click();
      const row = page.locator('li.player-row[data-player="Mitchel"]');
      assert(/\$0/.test(squash(await row.innerText())), squash(await row.innerText()));
      await row.locator('[data-credit-undo="Mitchel"]').click();
      await page.locator('.toast', { hasText: 'Credit refund undone' }).waitFor();
      await row.getByText('Credit $14').waitFor();
      await row.getByText('refund requested').waitFor();
      await row.locator('.player-open').click();
      const t = squash(await page.locator('dialog[open] [data-credit-section]').innerText());
      assert(/\$14/.test(t) && /-\$14 refunded/.test(t) && /undone/i.test(t), t);
      await closeSheet(page);
      assert(!/\bsent\b/i.test(await page.locator('body').innerText()), 'says sent');
      await nav(page, 'Home').click();
      const card = page.locator('[data-refund-request="Mitchel"]');
      await card.waitFor();
      await card.locator('[data-not-now]').click();
      await card.waitFor({ state: 'detached' });
      const m = await player('Mitchel', 'light', 390);
      assert((await chipText(m.page)) === 'CREDIT $14', `chip was "${await chipText(m.page)}"`);
      await m.page.locator('[data-use-credit]').first().waitFor();
      await m.ctx.close();
    });
    await ctx.close();
  }

  // ---- 5. Use credit, and Undo under "Paid with credit".
  {
    const { ctx, page } = await player('Mitchel', 'light', 390);
    await check('tapping Use credit pays it: "Paid with credit", the chip goes, the credit is $0', async () => {
      const row = page.locator('article.sched').filter({ has: page.locator('[data-use-credit]') }).first();
      await row.locator('[data-use-credit]').click();
      await chip(page).waitFor({ state: 'detached' });
      await page.getByText('Paid with credit').first().waitFor();
      assert((await page.locator('[data-use-credit]').count()) === 0, 'Use credit still shows');
      assert((await page.locator('[data-pay-note]').count()) === 0 || !(await row.locator('[data-pay-note]').count()), 'no note once paid');
      await page.screenshot({ path: path.join(SHOTS, 'credit-player-paid.png'), fullPage: true });
    });
    await check('Undo under "Paid with credit" puts the credit back (the chip returns); Use credit works again; the sheet lists it', async () => {
      const undo = page.locator('[data-undo-credit]').first();
      await undo.waitFor();
      assert((await page.getByRole('button', { name: 'I paid' }).count()) === 0 && (await page.getByText("Didn't pay?").count()) === 0, 'only Undo under the paid tag');
      await undo.click();
      await chip(page).waitFor();
      // The chip counts up to the new amount, so wait for it to finish.
      for (let i = 0; i < 40 && (await chipText(page)) !== 'CREDIT $14'; i++) await page.waitForTimeout(100);
      assert((await chipText(page)) === 'CREDIT $14', 'credit is back');
      assert((await page.getByText('Paid with credit').count()) === 0, 'still paid with credit');
      const row = page.locator('article.sched').filter({ has: page.locator('[data-use-credit]') }).first();
      await row.locator('[data-use-credit]').click();
      await chip(page).waitFor({ state: 'detached' });
      await page.getByText('Paid with credit').first().waitFor();
      const m = await call(api.request, 'GET', '/api/admin/dashboard');
      const ledger = m.creditLedger.find((l) => l.playerId === id.Mitchel);
      assert(ledger && ledger.balanceCents === 0 && ledger.entries.some((e) => e.kind === 'used' && !e.endedAt && e.cents === 1400), 'the ledger shows the $14 used');
    });
    await ctx.close();
  }

  // ---- 6. Part of the amount: $5 credit against a $14 game, then Pay for the rest.
  {
    const db = new DatabaseSync(dbFile);
    const group = db.prepare('SELECT id FROM groups').get().id;
    db.prepare("INSERT INTO credit_ledger (id, group_id, player_id, kind, amount_cents, session_id, created_at, reason, played_count) VALUES ('e2e-k', ?, ?, 'kept', 500, ?, ?, 'finalized', 6)").run(group, id.Julian, thu.id, '2026-10-26T15:00:00.000Z');
    db.close();
    await join(nov10, ['Julian', 'Ryan', 'Brandon', 'Mitchel']);
    for (const scheme of ['light', 'dark']) {
      for (const width of WIDTHS) {
        const tag = `${width}px ${scheme}`;
        const { ctx, page, errors } = await player('Julian', scheme, width);
        await check(`${tag}: credit covers part: Use credit is the filled button, Pay is the outline one, the hint says how much; the chip reads CREDIT $5`, async () => {
          assert((await chipText(page)) === 'CREDIT $5', `chip was "${await chipText(page)}"`);
          const row = page.locator('article.sched').filter({ has: page.locator('[data-use-credit]') }).first();
          const foot = row.locator('.sched-body');
          await foot.locator('[data-use-credit]').waitFor();
          assert((await greenButtons(foot)) === 1, `green buttons: ${await greenButtons(foot)}`);
          assert(await foot.locator('[data-use-credit]').evaluate((b) => !b.classList.contains('outline')), 'Use credit is the filled button');
          assert(await foot.getByRole('link', { name: /^Pay \$14/ }).evaluate((b) => b.classList.contains('outline')), 'Pay is the outline button next to it');
          assert(/Uses your \$5 credit\. \$9 left to pay/.test(await foot.innerText()), await foot.innerText());
          assert((await foot.getByRole('link', { name: /^Pay \$14/ }).count()) === 1, 'Pay $14 shows');
          assert((await foot.getByRole('button', { name: 'I paid' }).count()) === 0, 'I paid should wait until Pay is tapped');
          await tidy(foot, 'pay row');
          await noSideways(page);
        });
        await check(`${tag}: after Pay is tapped, I paid joins the row and nothing is left hanging alone`, async () => {
          const row = page.locator('article.sched').filter({ has: page.locator('[data-use-credit]') }).first();
          const foot = row.locator('.sched-body');
          await foot.getByRole('link', { name: /^Pay \$14/ }).click();
          await page.waitForTimeout(1500);
          await foot.getByRole('button', { name: 'I paid' }).waitFor();
          const tops = await foot.evaluate((el) => [...el.querySelectorAll('a.btn, button.btn')].map((b) => ({ t: b.textContent.trim(), y: Math.round(b.getBoundingClientRect().top) })));
          const lines = new Set(tops.map((x) => x.y));
          const last = tops[tops.length - 1];
          assert(lines.size === 1 || tops.filter((x) => x.y === last.y).length >= 2, `a lone button hangs on its own line: ${JSON.stringify(tops)}`);
          await tidy(foot, 'pay row');
          await noSideways(page);
        });
        await check(`${tag}: no browser errors`, async () => assert(errors.length === 0, errors.join(' | ')));
        await ctx.close();
      }
    }
    const { ctx, page } = await player('Julian', 'light', 390);
    await check('after Use credit the rest is the Pay button for the remaining amount; the chip goes', async () => {
      const row = page.locator('article.sched').filter({ has: page.locator('[data-use-credit]') }).first();
      await row.locator('[data-use-credit]').click();
      await chip(page).waitFor({ state: 'detached' });
      const foot = page.locator('article.sched .sched-body', { hasText: 'Pay $9' }).first();
      await foot.waitFor();
      assert((await foot.locator('[data-use-credit]').count()) === 0, 'Use credit still shows');
      assert((await foot.getByRole('button', { name: 'I paid' }).count()) === 1, 'Pay and I paid after the credit is used');
      const after = await page.locator('article.sched', { hasText: 'Pay $9' }).first().innerText();
      assert(/\$9 left to pay/.test(after) && /\$5 credit used/.test(after), 'after-credit chip and line');
    });
    await ctx.close();
  }

  // ---- 6b. Game day: the payment card at the top of the player screen.
  {
    const db = new DatabaseSync(dbFile);
    const group = db.prepare('SELECT id FROM groups').get().id;
    const put = db.prepare("INSERT INTO credit_ledger (id, group_id, player_id, kind, amount_cents, session_id, created_at, reason) VALUES (?, ?, ?, 'kept', ?, ?, ?, 'canceled')");
    put.run('e2e-r', group, id.Ryan, 4200, thu.id, '2026-10-26T15:00:00.000Z');
    put.run('e2e-b', group, id.Brandon, 500, thu.id, '2026-10-26T15:00:00.000Z');
    db.close();
    await clock('2026-11-10T09:00:00-05:00'); // game day, after 8:00 AM
    for (const [who, covers] of [['Ryan', true], ['Brandon', false]]) {
      for (const scheme of ['light', 'dark']) {
        for (const width of WIDTHS) {
          const tag = `${width}px ${scheme}`;
          const { ctx, page, errors } = await player(who, scheme, width);
          await check(`${tag}: game-day card, credit ${covers ? 'covers it all: Use credit is the one green button' : 'covers part: Use credit is still the filled one, Pay is outline'}; no credit-back note for joined people`, async () => {
            const card = page.locator('section.pay-card');
            await card.waitFor();
            const use = card.locator('[data-use-credit]');
            await use.waitFor();
            assert((await greenButtons(card)) === 1, `green buttons: ${await greenButtons(card)}`);
            assert(!(await use.evaluate((b) => b.classList.contains('secondary'))), 'Use credit is the one filled button, covering all or part');
            assert((await card.getByRole('button', { name: 'I paid' }).count()) === 0, 'I paid should wait until Pay is tapped');
            assert((await card.locator(NO_NOTE).count()) === 0, 'no credit-back note on the game-day card');
            await chipPlaced(page, tag);
            await tidy(card, 'pay card');
            await noSideways(page);
          });
          await check(`${tag}: no browser errors`, async () => assert(errors.length === 0, errors.join(' | ')));
          await ctx.close();
        }
      }
    }
    const { ctx, page } = await player('Ryan', 'light', 390);
    await check('after tapping Pay, I paid appears (and stays after a reload)', async () => {
      await page.locator('section.pay-card').getByRole('link', { name: /^Pay \$\d+.* with Venmo/ }).click();
      await page.waitForTimeout(1500);
      await page.locator('section.pay-card').getByRole('button', { name: 'I paid' }).waitFor();
      await page.reload();
      await page.locator('section.pay-card').getByRole('button', { name: 'I paid' }).waitFor();
    });
    await check('Use credit on the game-day card pays all three owed games ($42) with credit; the chip goes; the ledger lists each game', async () => {
      await page.locator('section.pay-card [data-use-credit]').click();
      await page.locator('section.pay-card').waitFor({ state: 'detached' });
      await page.getByText('Paid with credit').first().waitFor();
      assert((await chip(page).count()) === 0, 'no credit left, so no chip');
      const d = await dash();
      const ledger = d.creditLedger.find((l) => l.playerId === id.Ryan);
      const used = ledger.entries.filter((e) => e.kind === 'used' && !e.endedAt).map((e) => e.cents);
      assert(ledger.balanceCents === 0 && JSON.stringify(used) === JSON.stringify([1400, 1400, 1400]), `ledger: ${JSON.stringify(ledger)}`);
    });
    await ctx.close();
  }

  // ---- 7. "Were you charged for this court?" only within 12 hours.
  for (const [iso, asked, label] of [
    ['2026-11-10T09:00:00-05:00', true, '11 hours before'],
    ['2026-11-10T07:00:00-05:00', false, '13 hours before'],
  ]) {
    await clock(iso);
    const { ctx, page } = await open('light', 390);
    await check(`Cancel session ${label}: ${asked ? 'asks' : 'does not ask'} "Were you charged for this court?"`, async () => {
      const card = page.locator('section[aria-labelledby="sessions-title"] article', { hasText: 'Tue, Nov 10' }).first();
      await card.getByRole('button', { name: /^Session options/ }).click();
      await card.getByRole('button', { name: 'Cancel session' }).click();
      const dlg = page.locator('dialog[open]');
      await dlg.getByRole('button', { name: 'Cancel session' }).waitFor();
      const q = dlg.getByText('Were you charged for this court?');
      assert((await q.count()) === (asked ? 1 : 0), `question count ${await q.count()}`);
      if (asked) {
        const no = dlg.getByRole('button', { name: 'No', exact: true });
        assert((await no.getAttribute('aria-pressed')) === 'true', 'No should be the default');
        await dlg.getByRole('button', { name: 'Yes', exact: true }).click();
        const amount = dlg.getByLabel('Amount charged');
        assert((await amount.inputValue()) === '48.00', `default amount ${await amount.inputValue()}`);
        await tidy(dlg, 'cancel sheet');
      }
      await page.keyboard.press('Escape');
      await page.locator('dialog[open]').waitFor({ state: 'detached' }).catch(() => {});
    });
    await ctx.close();
  }
  {
    await clock('2026-11-10T09:00:00-05:00');
    const { ctx, page } = await open('light', 390);
    // Brandon pays cash for Nov 10 before it is canceled (Ryan paid it with credit, Julian used $5 of credit).
    await call(api.request, 'POST', `/api/admin/sessions/${nov10.id}/payment`, { playerId: id.Brandon, paid: true });
    let afterCancel = null;
    await check('answering Yes with an amount counts it as that canceled game\'s court cost in Money; the cash payer is listed as "Now their credit" and gets the credit', async () => {
      const card = page.locator('section[aria-labelledby="sessions-title"] article', { hasText: 'Tue, Nov 10' }).first();
      await card.getByRole('button', { name: /^Session options/ }).click();
      await card.getByRole('button', { name: 'Cancel session' }).click();
      const dlg = page.locator('dialog[open]');
      await dlg.getByRole('button', { name: 'Yes', exact: true }).click();
      await dlg.getByLabel('Amount charged').fill('35');
      await dlg.getByRole('button', { name: 'Cancel session' }).click();
      await page.getByText('Session canceled').first().waitFor();
      const after = page.locator('dialog[open]');
      const list = after.locator('[data-credit-back-list]');
      await list.getByRole('heading', { name: 'Now their credit' }).waitFor();
      await list.locator('li', { hasText: 'Brandon' }).getByText('$14 credit', { exact: true }).waitFor();
      afterCancel = (await list.locator('li').allInnerTexts()).map(squash);
      await page.keyboard.press('Escape');
      const m = await call(api.request, 'GET', '/api/admin/money?month=2026-11');
      const line = m.sessions.find((x) => x.id === nov10.id);
      assert(line.state === 'canceled' && line.charged && line.courtCostCents === 3500, JSON.stringify(line));
      assert(m.courtCostCents === 3500, `court costs ${m.courtCostCents}`); // nothing finalized in November yet, only the charge
      const d = await dash();
      const pot = (n) => d.creditLedger.find((l) => l.playerId === id[n])?.balanceCents ?? 0;
      // Brandon: his $5 plus the $14 back. Ryan: the $14 of credit he paid with is back.
      assert(pot('Brandon') === 1900 && pot('Ryan') === 1400, `credit after the cancel: Brandon ${pot('Brandon')}, Ryan ${pot('Ryan')}`);
    });
    await check('credit used on another game (Julian, $5 toward Tue Nov 3) is untouched by the Nov 10 cancel', async () => {
      const d = await dash();
      const l = d.creditLedger.find((x) => x.playerId === id.Julian);
      const used = (l?.entries ?? []).filter((e) => e.kind === 'used' && !e.endedAt);
      assert((l?.balanceCents ?? 0) === 0 && used.length === 1 && used[0].sessionStartsAt !== nov10.startsAt, `Julian: ${JSON.stringify(l)}`);
    });
    await check('a player who paid the canceled game with credit (Ryan, $14) is listed under "Now their credit" and sees "Your $14 is now credit"', async () => {
      assert(afterCancel, 'the cancel sheet did not open');
      assert(afterCancel.some((t) => /^Ryan \$14 credit$/.test(t)), `the list had: ${JSON.stringify(afterCancel)}`);
      const r = await player('Ryan', 'light', 390);
      const row = r.page.locator('article.sched', { hasText: 'Nov 10' });
      assert((await row.locator('[data-credit-back]').count()) === 0, 'Ryan: no refund line on the canceled game');
      await r.ctx.close();
    });
    await ctx.close();
  }

  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
