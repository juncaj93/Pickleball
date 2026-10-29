/* Credit, on a phone: Keep as credit on the refund card and Money row, the
 * Players tab credit and "Refund credit balance", "Were you charged?" on
 * cancel, and the player's "You have $X credit" and "Use credit" button.
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
    const cut = [...el.querySelectorAll('*')].filter((x) => x.children.length === 0 && x.scrollWidth > x.clientWidth + 1 && getComputedStyle(x).overflow !== 'visible').length;
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
      (b) => b.getBoundingClientRect().width > 0 && !['secondary', 'ghost', 'danger', 'text-btn'].some((c) => b.classList.contains(c)),
    ).length,
  );

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
    await call(ctx.request, 'POST', '/api/me', { playerId: id[name] });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(BASE + '/');
    await page.locator('.schedule article').first().waitFor();
    return { ctx, page, errors };
  };
  const sess = (page, s) => page.locator(`details.money-sess[data-session="${s.id}"]`);

  // ---- 1. Thu Oct 29 is canceled: the choice (Refund or Keep as credit).
  await call(api.request, 'POST', `/api/admin/sessions/${thu.id}/decision`, { decision: 'cancel', confirm: true });
  for (const scheme of ['light', 'dark']) {
    for (const width of WIDTHS) {
      const tag = `${width}px ${scheme}`;
      const { ctx, page, errors } = await open(scheme, width);
      await check(`${tag}: the Home refund card offers Refund and Keep as credit, tidy`, async () => {
        const card = page.getByRole('article', { name: /^Thu, Oct 29 was canceled\. Refund needed:/ });
        await card.waitFor();
        await card.getByRole('link', { name: /^Refund Mitchel/ }).waitFor();
        await card.getByRole('button', { name: /^Keep \$14 as Mitchel's credit/ }).waitFor();
        assert((await greenButtons(card)) === 0, 'a green button on the refund card');
        await tidy(card, 'refund card');
        await noSideways(page);
      });
      await check(`${tag}: the Money row for the canceled game has the same choice`, async () => {
        await nav(page, 'Money').click();
        const row = sess(page, thu);
        if (!(await row.evaluate((el) => el.open))) await row.locator('summary').click();
        await row.locator('li[data-refund="Mitchel"]').getByRole('button', { name: /^Keep \$14/ }).waitFor();
        await tidy(row.locator('li[data-refund="Mitchel"]'), 'money row');
      });
      await check(`${tag}: no browser errors`, async () => assert(errors.length === 0, errors.join(' | ')));
      await ctx.close();
    }
  }

  // ---- 2. Keep as credit, from the card, once. Then the numbers.
  {
    const { ctx, page } = await open('light', 390);
    await check('tapping Keep as credit settles the card, makes $14 credit, and Held drops', async () => {
      const card = page.getByRole('article', { name: /^Thu, Oct 29 was canceled/ });
      await card.getByRole('button', { name: /^Keep \$14/ }).click();
      await card.waitFor({ state: 'detached' });
      await nav(page, 'Money').click();
      const sum = squash(await page.locator('.money-sum').innerText());
      assert(!/Held/.test(sum), `October has nothing held after keep: ${sum}`);
      assert(/Credits owed −\$14/.test(sum), `credits owed after keep: ${sum}`);
      assert(/Includes \$14 kept from canceled games/.test(sum), `kept note: ${sum}`);
      const row = sess(page, thu);
      if (!(await row.evaluate((el) => el.open))) await row.locator('summary').click();
      await row.getByText('Kept as credit', { exact: true }).waitFor();
      await row.getByRole('button', { name: 'Undo' }).waitFor();
    });
    await ctx.close();
  }
  for (const scheme of ['light', 'dark']) {
    for (const width of WIDTHS) {
      const tag = `${width}px ${scheme}`;
      const { ctx, page, errors } = await open(scheme, width);
      await check(`${tag}: Players tab shows Mitchel's credit, Refund credit balance, and the history by game`, async () => {
        await nav(page, 'Players').click();
        const row = page.locator('li.player-row[data-player="Mitchel"]');
        assert(/Credit \$14/.test(squash(await row.innerText())), squash(await row.innerText()));
        const refund = row.getByRole('link', { name: /^Refund Mitchel \$14 credit balance/ });
        await refund.waitFor();
        assert((await refund.getAttribute('href')) === 'https://venmo.com/?txn=pay&recipients=Mitchel-K&amount=14&note=Pickleball%20credit%20refund', `href ${await refund.getAttribute('href')}`);
        assert((await row.getByRole('button', { name: 'Mark refunded' }).count()) === 0, 'Mark refunded before Venmo was opened');
        assert((await page.locator('li.player-row[data-player="Ryan"]').getByText(/credit/i).count()) === 0, "credit shows on someone else's row");
        await tidy(row, 'player row');
        await noSideways(page);
        await row.locator('.player-open').click();
        const sheet = page.locator('dialog[open]');
        await sheet.locator('[data-credit-section]').waitFor();
        const t = squash(await sheet.locator('[data-credit-section]').innerText());
        assert(/Oct 29/.test(t) && /\+\$14/.test(t), t);
        await tidy(sheet.locator('[data-credit-section]'), 'credit section');
        await page.keyboard.press('Escape');
        await page.locator('dialog[open]').waitFor({ state: 'detached' }).catch(() => {});
      });
      await check(`${tag}: no browser errors`, async () => assert(errors.length === 0, errors.join(' | ')));
      await ctx.close();
    }
  }

  // ---- 3. The player: sees only their own credit; Use credit.
  await join(nov5, ['Mitchel', 'Ryan', 'Brandon', 'Julian']);
  for (const scheme of ['light', 'dark']) {
    for (const width of WIDTHS) {
      const tag = `${width}px ${scheme}`;
      const { ctx, page, errors } = await player('Mitchel', scheme, width);
      await check(`${tag}: player sees "You have $14 credit" and Use credit as the one green button on the game they owe`, async () => {
        await page.locator('[data-credit-line]').waitFor();
        assert(/You have \$14 credit/.test(await page.locator('[data-credit-line]').innerText()), 'credit line');
        const row = page.locator('article.sched', { hasText: 'Nov' }).filter({ has: page.locator('[data-use-credit]') }).first();
        const foot = row.locator('.row-foot');
        await foot.locator('[data-use-credit]').waitFor();
        assert((await greenButtons(foot)) === 1, `green buttons: ${await greenButtons(foot)}`);
        assert((await foot.locator('[data-use-credit]').evaluate((b) => !b.classList.contains('secondary'))), 'Use credit should be the green one');
        assert((await foot.getByRole('link', { name: /^Pay \$14/ }).count()) === 1, 'Pay $14 should show');
        assert((await foot.getByRole('button', { name: 'I paid' }).count()) === 0, 'I paid should wait until Pay is tapped');
        await tidy(foot, 'pay row');
        await noSideways(page);
      });
      await check(`${tag}: no browser errors`, async () => assert(errors.length === 0, errors.join(' | ')));
      await ctx.close();
    }
  }
  {
    const { ctx, page } = await player('Ryan', 'light', 390);
    await check('another player sees no credit line and no Use credit', async () => {
      assert((await page.locator('[data-credit-line]').count()) === 0, 'credit line');
      assert((await page.locator('[data-use-credit]').count()) === 0, 'use credit');
      const t = squash(await page.locator('body').innerText());
      assert(!/credit/i.test(t.replace(/\$5 credit/g, '')), t.slice(0, 300));
      const raw = await (await ctx.request.get(BASE + '/api/group')).text();
      assert(!/creditLedger|keptAsCredit|potCredit/.test(raw), 'API leaks it');
    });
    await ctx.close();
  }
  {
    const { ctx, page } = await player('Mitchel', 'light', 390);
    await check('tapping Use credit pays it: "Paid with credit", and the credit goes to $0', async () => {
      const row = page.locator('article.sched').filter({ has: page.locator('[data-use-credit]') }).first();
      await row.locator('[data-use-credit]').click();
      await page.locator('[data-credit-line]').waitFor({ state: 'detached' });
      await page.getByText('✓ Paid with credit').first().waitFor();
      assert((await page.locator('[data-use-credit]').count()) === 0, 'Use credit still shows');
      await page.screenshot({ path: path.join(SHOTS, 'credit-player-paid.png'), fullPage: true });
    });
    await check('Undo under "Paid with credit" puts the credit back; Use credit works again', async () => {
      const undo = page.locator('[data-undo-credit]').first();
      await undo.waitFor();
      assert((await page.getByRole('button', { name: 'I paid' }).count()) === 0 && (await page.getByText("Didn't pay?").count()) === 0, 'only Undo under the paid tag');
      await undo.click();
      await page.locator('[data-credit-line]').waitFor();
      assert(/You have \$14 credit/.test(await page.locator('[data-credit-line]').innerText()), 'credit is back');
      assert((await page.getByText('✓ Paid with credit').count()) === 0, 'still paid with credit');
      const row = page.locator('article.sched').filter({ has: page.locator('[data-use-credit]') }).first();
      await row.locator('[data-use-credit]').click();
      await page.locator('[data-credit-line]').waitFor({ state: 'detached' });
      await page.getByText('✓ Paid with credit').first().waitFor();
    });
    await ctx.close();
  }

  // ---- 4. Part of the amount: $5 credit against a $14 game, then Pay for the rest.
  {
    const db = new DatabaseSync(dbFile);
    const group = db.prepare('SELECT id FROM groups').get().id;
    db.prepare("INSERT INTO credit_ledger (id, group_id, player_id, kind, amount_cents, session_id, created_at) VALUES ('e2e-k', ?, ?, 'kept', 500, ?, ?)").run(group, id.Julian, thu.id, '2026-10-26T15:00:00.000Z');
    db.close();
    await join(nov10, ['Julian', 'Ryan', 'Brandon', 'Mitchel']);
    for (const scheme of ['light', 'dark']) {
      for (const width of WIDTHS) {
        const tag = `${width}px ${scheme}`;
        const { ctx, page, errors } = await player('Julian', scheme, width);
        await check(`${tag}: credit covers part: Pay stays the green button, Use credit is quiet, the hint says how much`, async () => {
          const row = page.locator('article.sched').filter({ has: page.locator('[data-use-credit]') }).first();
          const foot = row.locator('.row-foot');
          await foot.locator('[data-use-credit]').waitFor();
          assert((await greenButtons(foot)) === 1, `green buttons: ${await greenButtons(foot)}`);
          assert(await foot.locator('[data-use-credit]').evaluate((b) => b.classList.contains('secondary')), 'Use credit should be quiet');
          assert(/Uses your \$5 credit\. \$9 left to pay/.test(await foot.innerText()), await foot.innerText());
          assert(/Pay \$14/.test(await foot.innerText()), await foot.innerText());
          assert((await foot.getByRole('button', { name: 'I paid' }).count()) === 0, 'I paid should wait until Pay is tapped');
          await tidy(foot, 'pay row');
          await noSideways(page);
        });
        await check(`${tag}: after Pay is tapped, I paid joins the row and nothing is left hanging alone`, async () => {
          const row = page.locator('article.sched').filter({ has: page.locator('[data-use-credit]') }).first();
          const foot = row.locator('.row-foot');
          await foot.getByRole('link', { name: /^Pay \$14/ }).click();
          await page.waitForTimeout(1500);
          await foot.getByRole('button', { name: 'I paid' }).waitFor();
          const tops = await foot.evaluate((el) => [...el.querySelectorAll('a.btn, button.btn')].map((b) => ({ t: b.textContent.trim(), y: Math.round(b.getBoundingClientRect().top) })));
          console.log('   rows', width, JSON.stringify(tops), await foot.evaluate((el) => Math.round(el.querySelector('.pay-pair').getBoundingClientRect().width) + '/' + Math.round(el.getBoundingClientRect().width)));
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
    await check('after Use credit the rest is the Pay button for the remaining amount', async () => {
      const row = page.locator('article.sched').filter({ has: page.locator('[data-use-credit]') }).first();
      await row.locator('[data-use-credit]').click();
      await page.locator('[data-credit-line]').waitFor({ state: 'detached' });
      const foot = page.locator('article.sched .row-foot', { hasText: 'Pay $9' }).first();
      await foot.waitFor();
      assert((await foot.locator('[data-use-credit]').count()) === 0, 'Use credit still shows');
      assert((await foot.getByRole('button', { name: 'I paid' }).count()) === 1, 'Pay and I paid after the credit is used');
      assert(/\$9 left to pay\. \$5 credit used\./.test(await page.locator('article.sched', { hasText: 'Pay $9' }).first().innerText()), 'after-credit note');
    });
    await ctx.close();
  }

  // ---- 4b. Game day: the payment card at the top of the player screen.
  {
    const db = new DatabaseSync(dbFile);
    const group = db.prepare('SELECT id FROM groups').get().id;
    const put = db.prepare("INSERT INTO credit_ledger (id, group_id, player_id, kind, amount_cents, session_id, created_at) VALUES (?, ?, ?, 'kept', ?, ?, ?)");
    put.run('e2e-r', group, id.Ryan, 4200, thu.id, '2026-10-26T15:00:00.000Z');
    put.run('e2e-b', group, id.Brandon, 500, thu.id, '2026-10-26T15:00:00.000Z');
    db.close();
    await clock('2026-11-10T09:00:00-05:00'); // game day, after 8:00 AM
    for (const [who, covers] of [['Ryan', true], ['Brandon', false]]) {
      for (const scheme of ['light', 'dark']) {
        for (const width of WIDTHS) {
          const tag = `${width}px ${scheme}`;
          const { ctx, page, errors } = await player(who, scheme, width);
          await check(`${tag}: game-day card, credit ${covers ? 'covers it all: Use credit is the one green button' : 'covers part: Pay stays green, Use credit is quiet'}`, async () => {
            const card = page.locator('section.pay-card');
            await card.waitFor();
            const use = card.locator('[data-use-credit]');
            await use.waitFor();
            assert((await greenButtons(card)) === 1, `green buttons: ${await greenButtons(card)}`);
            assert((await use.evaluate((b) => b.classList.contains('secondary'))) === !covers, 'wrong button is green');
            assert((await card.getByRole('button', { name: 'I paid' }).count()) === 0, 'I paid should wait until Pay is tapped');
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
    await check('Use credit on the game-day card pays the game with credit', async () => {
      await page.locator('section.pay-card [data-use-credit]').click();
      await page.locator('section.pay-card').waitFor({ state: 'detached' });
      await page.getByText('✓ Paid with credit').first().waitFor();
    });
    await ctx.close();
  }

  // ---- 5. "Were you charged for this court?" only within 12 hours.
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
    await check('answering Yes with an amount counts it as that canceled game\'s court cost in Money', async () => {
      const card = page.locator('section[aria-labelledby="sessions-title"] article', { hasText: 'Tue, Nov 10' }).first();
      await card.getByRole('button', { name: /^Session options/ }).click();
      await card.getByRole('button', { name: 'Cancel session' }).click();
      const dlg = page.locator('dialog[open]');
      await dlg.getByRole('button', { name: 'Yes', exact: true }).click();
      await dlg.getByLabel('Amount charged').fill('35');
      await dlg.getByRole('button', { name: 'Cancel session' }).click();
      await page.getByText('Session canceled').first().waitFor();
      const m = await call(api.request, 'GET', '/api/admin/money?month=2026-11');
      const line = m.sessions.find((x) => x.id === nov10.id);
      assert(line.state === 'canceled' && line.charged && line.courtCostCents === 3500, JSON.stringify(line));
      assert(m.courtCostCents === 2 * 4800 + 3500, `court costs ${m.courtCostCents}`); // two played games and the charge
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
