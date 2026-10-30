/* Held money, on a phone: blue "Paid, not finalized yet" until the organizer
 * finalizes the game, the Held row, "$X held" on Players, a canceled game's
 * money turning into credit by itself (listed on the Money row, no refund
 * card), Refund credit balance on Players (Venmo, Mark refunded, Undo), and
 * the Venmo field on the player Edit screen.
 *
 *   node e2e/held.cjs      (also run by npm run test:e2e)
 *
 * Starts its own dev server with a fresh fake group (Alex is the organizer).
 * No Venmo page is ever opened: those requests are blocked. Pictures go to
 * e2e/screenshots/held-*.png.
 */
const { spawn } = require('node:child_process');
const { rmSync, mkdirSync } = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const PORT = 5194;
const BASE = `http://localhost:${PORT}`;
const SETUP_TOKEN = 'held-setup-token-0123456789';
const PIN = '482913';
const SHOTS = path.join(__dirname, 'screenshots');
const PEOPLE = ['Alex', 'Ryan', 'Mitchel', 'Brandon', 'Julian'];

let passed = 0;
let failed = 0;
async function check(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.log(`  ✗ ${name}\n      ${String(err && err.message ? err.message : err).replace(/\s*\n\s*/g, ' ⏎ ').slice(0, 600)}`);
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
const squash = (t) => t.replace(/\s+/g, ' ').trim();
const nav = (page, name) => page.getByRole('navigation', { name: 'Organizer sections' }).getByRole('button', { name: new RegExp(`^${name}`) });

/** WCAG contrast ratio of two CSS rgb() colors. */
function contrast(a, b) {
  const lum = (c) => {
    const [r, g, bl] = c.match(/[\d.]+/g).slice(0, 3).map(Number).map((v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

async function main() {
  const dbFile = path.join(ROOT, '.data', 'held.sqlite');
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
  const MON = Date.parse('2026-10-26T12:00:00-04:00');
  const clock = (atMs) => fetch(`${BASE}/__dev/clock`, { method: 'POST', body: JSON.stringify({ atMs }) });
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
  const d0 = await call(api.request, 'GET', '/api/admin/dashboard');
  const id = Object.fromEntries(d0.players.map((p) => [p.name, p.id]));
  const [tue, thu] = d0.sessions; // Tue Oct 27 and Thu Oct 29
  for (const s of [thu, tue]) {
    for (const n of ['Mitchel', 'Ryan', 'Brandon', 'Julian']) await call(api.request, 'POST', `/api/admin/sessions/${s.id}/roster`, { playerId: id[n], action: 'confirm' });
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
  const sess = (page, s) => page.locator(`details.money-sess[data-session="${s.id}"]`);
  const openSess = async (page, s) => {
    await sess(page, s).waitFor();
    if (!(await sess(page, s).evaluate((el) => el.open))) await sess(page, s).locator('summary').click();
  };
  const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  const sticksOut = (loc) =>
    loc.evaluate((el) => {
      const box = el.getBoundingClientRect();
      return [...el.querySelectorAll('*')].filter((x) => { const r = x.getBoundingClientRect(); return r.width > 0 && (r.right > box.right + 1 || r.left < box.left - 1); }).length;
    });

  // ---- The Venmo field on the Edit screen (once).
  {
    const { ctx, page } = await open('light', 390);
    await nav(page, 'Players').click();
    await page.getByRole('button', { name: 'Edit Mitchel' }).click();
    const dlg = page.locator('dialog[open]');
    const field = dlg.getByLabel(/^Venmo link or @name/);
    await check('Venmo field is on the Edit screen under the phone number, blank by default, and not in the Players list', async () => {
      await field.waitFor();
      assert((await field.inputValue()) === '', 'not blank by default');
      const order = await dlg.locator('label.field').evaluateAll((els) => els.map((e) => e.innerText.split('\n')[0].trim()));
      assert(order.findIndex((t) => /^Phone/.test(t)) + 1 === order.findIndex((t) => /^Venmo/.test(t)), `field order: ${order}`);
      assert(!/venmo/i.test(squash(await page.locator('.player-list').innerText())), 'Venmo shows in the Players list');
    });
    await check('a link it cannot read gives a plain message and saves nothing', async () => {
      await field.fill('mitchel please');
      await dlg.getByRole('button', { name: /^Save/ }).click();
      await dlg.getByText(/paste the link from the Venmo app/i).waitFor();
    });
    await check('a pasted link saves and shows back as @Name', async () => {
      await field.fill('https://venmo.com/u/Mitchel-K?utm_source=share');
      await dlg.getByRole('button', { name: /^Save/ }).click();
      await dlg.waitFor({ state: 'detached' });
      await page.getByRole('button', { name: 'Edit Mitchel' }).click();
      assert((await page.locator('dialog[open]').getByLabel(/^Venmo link or @name/).inputValue()) === '@Mitchel-K', 'did not show @Mitchel-K');
      await page.screenshot({ path: path.join(SHOTS, 'held-venmo-field.png') });
      await page.keyboard.press('Escape');
    });
    await ctx.close();
  }

  // ---- Money held for games ahead.
  for (const scheme of ['light', 'dark']) {
    for (const width of [360, 375, 390, 430]) {
      const tag = `${width}px ${scheme}`;
      const { ctx, page, errors } = await open(scheme, width);
      await nav(page, 'Money').click();
      await check(`${tag}: a prepaid game shows Paid in blue with "not finalized yet", AA contrast, nothing cut off`, async () => {
        await openSess(page, thu);
        const row = sess(page, thu).locator('li.pay-row', { hasText: 'Mitchel' });
        const chip = row.locator('.chip');
        assert(/^Paid$/.test((await chip.innerText()).trim()), 'pill word');
        assert(await chip.evaluate((el) => el.classList.contains('tone-info')), 'pill is not blue');
        const t = squash(await row.innerText());
        assert(/paid \$14 on .*not finalized yet/.test(t), t);
        assert(!/not played yet/.test(t), 'old wording');
        const cols = await row.evaluate((el) => {
          const chip = getComputedStyle(el.querySelector('.chip'));
          return { chip: chip.color, chipBg: chip.backgroundColor };
        });
        assert(contrast(cols.chip, cols.chipBg) >= 4.5, `pill contrast ${contrast(cols.chip, cols.chipBg).toFixed(2)}`);
        const cut = await row.evaluate((el) => [...el.querySelectorAll('.pay-who, .pay-who *')].filter((x) => x.scrollWidth > x.clientWidth + 1).length);
        assert(cut === 0, 'cut-off text');
        assert((await sess(page, thu).locator('[data-price-each]').innerText()).trim() === '$14', 'each player pays $14 until finalized');
        assert((await overflow(page)) <= 0, 'sideways scroll');
      });
      await check(`${tag}: monthly Held row is blue and Collected, Court costs and Left stay at $0`, async () => {
        const held = page.locator('.money-sum dt', { hasText: 'Held' });
        await held.waitFor();
        const sum = squash(await page.locator('.money-sum').innerText());
        assert(/Held \$28/.test(sum), sum);
        assert(/Collected \$0/.test(sum) && /Court costs \$0/.test(sum), sum);
        assert(await held.evaluate((el) => el.classList.contains('held-amt')), 'Held label not blue');
      });
      await check(`${tag}: Players tab: "$28 held" under Mitchel's balance, nothing for anyone else, not in your row`, async () => {
        await nav(page, 'Players').click();
        const row = page.locator('li.player-row[data-player="Mitchel"]');
        await row.getByText('$28 held').waitFor();
        assert((await page.getByText(/held/).count()) === 1, 'held shows for someone else');
        assert((await sticksOut(row)) === 0, 'something sticks out of the row');
        await row.locator('.player-open').click();
        const sheet = page.locator('dialog[open]');
        await sheet.getByText(/not finalized yet/).first().waitFor();
        assert((await sheet.getByText(/not finalized yet/).count()) === 2, 'both games should say not finalized yet');
        await page.keyboard.press('Escape');
        await page.locator('dialog[open]').waitFor({ state: 'detached' }).catch(() => {});
      });
      await check(`${tag}: a month with nothing held has no Held row`, async () => {
        await nav(page, 'Money').click();
        await page.getByRole('button', { name: 'Next month' }).click();
        await page.waitForFunction(() => /November/.test(document.querySelector('.month-label')?.textContent ?? ''));
        await page.locator('.money-sum dt', { hasText: 'Held' }).waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
        assert((await page.locator('.money-sum dt', { hasText: 'Held' }).count()) === 0, 'Held row shown at $0');
      });
      await check(`${tag}: no browser errors`, async () => assert(errors.length === 0, errors.join(' | ')));
      if (width === 390) await page.screenshot({ path: path.join(SHOTS, `held-money-${scheme}.png`), fullPage: true });
      await ctx.close();
    }
  }

  // ---- Thu Oct 29 is canceled: Mitchel's $14 is credit by itself.
  await call(api.request, 'POST', `/api/admin/sessions/${thu.id}/decision`, { decision: 'cancel', confirm: true });
  for (const scheme of ['light', 'dark']) {
    for (const width of [360, 375, 390, 430]) {
      const tag = `${width}px ${scheme}`;
      const { ctx, page, errors } = await open(scheme, width);
      await check(`${tag}: Home has no refund card; the Money row for the canceled game lists Mitchel's $14 as credit, with nothing to tap`, async () => {
        await page.locator('section[aria-labelledby="sessions-title"] article').first().waitFor();
        assert((await page.getByRole('article', { name: /Refund needed|was canceled/ }).count()) === 0, 'the old refund card is on Home');
        assert((await page.getByRole('link', { name: /^Refund Mitchel/ }).count()) === 0, 'a Refund button on Home');
        await nav(page, 'Money').click();
        await openSess(page, thu);
        const row = sess(page, thu);
        assert(/canceled/.test(await row.locator('summary').innerText()), 'row should say canceled');
        await row.getByText('Nobody owes for it. Anyone who paid has it as credit.').waitFor();
        const list = row.locator('[data-credit-back-list]');
        await list.getByRole('heading', { name: 'Now their credit' }).waitFor();
        await list.locator('li', { hasText: 'Mitchel' }).getByText('$14 credit', { exact: true }).waitFor();
        assert((await list.locator('li').count()) === 1, 'only Mitchel paid');
        assert((await row.getByRole('link', { name: /^Refund/ }).count()) === 0 && (await row.getByRole('button', { name: /Mark refunded|Keep .* credit|Undo/ }).count()) === 0, 'the old Refund / Keep as credit choice is gone');
        assert((await row.locator('li[data-refund]').count()) === 0, 'old refund rows');
        assert((await sticksOut(list)) === 0, 'sticks out of the row');
        assert((await overflow(page)) <= 0, 'sideways scroll');
      });
      await check(`${tag}: Tue Oct 27 still shows Mitchel paid in blue; the month holds $14 and owes $14 in credit`, async () => {
        await openSess(page, tue);
        const tueRow = sess(page, tue).locator('li.pay-row', { hasText: 'Mitchel' });
        assert(await tueRow.locator('.chip').evaluate((el) => el.classList.contains('tone-info')), 'Tue should still be blue');
        const sum = squash(await page.locator('.money-sum').innerText());
        assert(/Held \$14/.test(sum), `only Tue is held now: ${sum}`);
        assert(/Credits owed \$14/.test(sum), `the canceled game's money is credit: ${sum}`);
        assert(/Money that came back to players as credit/.test(sum), `credits note: ${sum}`);
        assert((await overflow(page)) <= 0, 'sideways scroll');
      });
      await check(`${tag}: Players tab: "$14 held" and "Credit $14" for Mitchel, nothing for anyone else`, async () => {
        await nav(page, 'Players').click();
        const row = page.locator('li.player-row[data-player="Mitchel"]');
        await row.getByText('$14 held').waitFor();
        await row.getByText('Credit $14').waitFor();
        assert((await page.getByText(/held|Credit \$/).count()) === 2, 'held or credit shows for someone else');
        assert((await sticksOut(row)) === 0, 'something sticks out of the row');
      });
      await check(`${tag}: no browser errors`, async () => assert(errors.length === 0, errors.join(' | ')));
      if (width === 390) await page.screenshot({ path: path.join(SHOTS, `held-canceled-${scheme}.png`), fullPage: true });
      await ctx.close();
    }
  }

  // ---- Refund credit balance on Players: Venmo, Mark refunded, Undo.
  {
    const { ctx, page } = await open('light', 390);
    await check('Refund credit balance opens Venmo for exactly $14 to @Mitchel-K with the credit note and marks nothing; then Mark refunded appears (also after a reload) and takes the credit off', async () => {
      await nav(page, 'Players').click();
      const row = page.locator('li.player-row[data-player="Mitchel"]');
      const refund = row.locator('[data-credit-refund="Mitchel"]');
      await refund.waitFor();
      assert((await refund.getAttribute('href')) === 'https://venmo.com/?txn=pay&recipients=Mitchel-K&amount=14&note=Pickleball%20credit%20refund', `href ${await refund.getAttribute('href')}`);
      assert((await refund.getAttribute('data-app-href')) === 'venmo://paycharge?txn=pay&recipients=Mitchel-K&amount=14&note=Pickleball%20credit%20refund', 'app link');
      assert((await row.locator('[data-credit-mark="Mitchel"]').count()) === 0, 'Mark refunded shown before tapping Refund');
      await refund.click();
      await row.locator('[data-credit-mark="Mitchel"]').waitFor();
      await row.getByText('Credit $14').waitFor(); // tapping Refund marks nothing
      await page.reload();
      await nav(page, 'Players').click();
      await page.locator('[data-credit-mark="Mitchel"]').waitFor(); // survives a reload
      await page.locator('[data-credit-mark="Mitchel"]').click();
      await page.locator('.toast', { hasText: 'Credit marked refunded' }).waitFor();
      await page.locator('li.player-row[data-player="Mitchel"]').getByText('Credit $14').waitFor({ state: 'detached' });
      assert(/\$0/.test(squash(await page.locator('li.player-row[data-player="Mitchel"]').innerText())), 'balance should be $0');
    });
    await check('Credits owed drops to $0, and Undo brings the credit back', async () => {
      await nav(page, 'Money').click();
      const sum = squash(await page.locator('.money-sum').innerText());
      assert(/Credits owed \$0/.test(sum) && /Held \$14/.test(sum), `after the refund: ${sum}`);
      await nav(page, 'Players').click();
      await page.locator('[data-credit-undo="Mitchel"]').click();
      await page.locator('.toast', { hasText: 'Credit refund undone' }).waitFor();
      await page.locator('li.player-row[data-player="Mitchel"]').getByText('Credit $14').waitFor();
      await nav(page, 'Money').click();
      assert(/Credits owed \$14/.test(squash(await page.locator('.money-sum').innerText())), 'credits owed after undo');
    });
    await check('nothing here ever says money was sent', async () => {
      const t = await page.locator('body').innerText();
      assert(!/\bsent\b/i.test(t), 'says sent');
    });
    await ctx.close();
  }

  // ---- The game is over: still held until finalized; finalizing moves it to Collected.
  await clock(Date.parse(tue.endsAt) + 3600_000);
  await check('after the game but before finalizing: still blue, still held, the row is tagged "finalize"', async () => {
    const { ctx, page } = await open('light', 390);
    await nav(page, 'Money').click();
    await openSess(page, tue);
    const row = sess(page, tue).locator('li.pay-row', { hasText: 'Mitchel' });
    assert(await row.locator('.chip').evaluate((el) => el.classList.contains('tone-info')), 'pill should still be blue');
    assert(/not finalized yet/.test(await row.innerText()), 'should say not finalized yet');
    await sess(page, tue).locator('summary .owes-tag', { hasText: 'finalize' }).waitFor();
    await sess(page, tue).getByText('Not finalized yet. Finalize it from Home.').waitFor();
    const sum = squash(await page.locator('.money-sum').innerText());
    assert(/Held \$14/.test(sum) && /Collected \$0/.test(sum), sum);
    await ctx.close();
  });
  await check('once finalized (4 played, $14 each), the pill is green (not blue) and the money moved from Held to Collected', async () => {
    const res = await api.request.post(`${BASE}/api/admin/sessions/${tue.id}/finalize`, { data: { everyone: true }, headers: { Origin: BASE } });
    assert(res.ok(), `finalize: ${res.status()} ${await res.text()}`);
    const { ctx, page } = await open('light', 390);
    await nav(page, 'Money').click();
    await openSess(page, tue);
    const row = sess(page, tue).locator('li.pay-row', { hasText: 'Mitchel' });
    assert(await row.locator('.chip').evaluate((el) => el.classList.contains('tone-ok')), 'pill is not green');
    assert(!/not finalized yet|not played yet/.test(await row.innerText()), 'still says not finalized yet');
    assert((await sess(page, tue).locator('[data-finalized-line]').innerText()).trim() === '4 played · $14 each', 'finalized line');
    const sum = squash(await page.locator('.money-sum').innerText());
    assert(/Collected \$14/.test(sum) && !/Held/.test(sum), sum);
    assert(/Court costs −\$48/.test(sum), `court cost counts once finalized: ${sum}`);
    await nav(page, 'Players').click();
    assert((await page.getByText(/held/).count()) === 0, 'nothing held once finalized');
    await ctx.close();
  });
  await clock(MON);

  // ---- Players never see any of it.
  await check('player screens carry no held money, refund card or Venmo handle; only their own credit and a way to ask for it back', async () => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 860 }, isMobile: true, hasTouch: true });
    await call(ctx.request, 'POST', '/api/me', { playerId: id.Mitchel });
    const page = await ctx.newPage();
    await page.goto(BASE + '/');
    await page.locator('.schedule article').first().waitFor();
    const t = squash(await page.locator('body').innerText());
    assert(!/held|Mitchel-K|not played yet|not finalized|Collected|Court costs/i.test(t), t.slice(0, 300));
    assert(!/refund/i.test(t.replace(/Request cash out from \w+/g, '')), `refund words beyond "Request cash out": ${t.slice(0, 300)}`);
    assert(/CREDIT \$14/.test(t), 'his own credit chip');
    const raw = await (await ctx.request.get(BASE + '/api/group')).text();
    assert(!/Mitchel-K|venmo_handle|"venmo":|heldCents|creditLedger/.test(raw), 'API leaks it');
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
