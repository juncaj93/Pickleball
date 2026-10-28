/* Held money and refunds, on a phone: blue "Paid, not played yet" until the
 * game is played, the Held row, "$X held" on Players, the refund card on Home
 * and on the Money row (Refund opens Venmo, Mark refunded records it, Undo),
 * and the Venmo field on the player Edit screen.
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
      await check(`${tag}: a prepaid game shows Paid in blue with "not played yet", AA contrast, nothing cut off`, async () => {
        await openSess(page, thu);
        const row = sess(page, thu).locator('li.pay-row', { hasText: 'Mitchel' });
        const chip = row.locator('.chip');
        assert(/^Paid$/.test((await chip.innerText()).trim()), 'pill word');
        assert(await chip.evaluate((el) => el.classList.contains('tone-info')), 'pill is not blue');
        const t = squash(await row.innerText());
        assert(/paid \$14 on .*not played yet/.test(t), t);
        const cols = await row.evaluate((el) => {
          const amt = el.querySelector('.held-amt');
          const c = getComputedStyle(amt);
          const chip = getComputedStyle(el.querySelector('.chip'));
          const bg = getComputedStyle(el.closest('details')).backgroundColor;
          return { amt: c.color, bg, chip: chip.color, chipBg: chip.backgroundColor };
        });
        assert(contrast(cols.amt, cols.bg) >= 4.5, `blue text contrast ${contrast(cols.amt, cols.bg).toFixed(2)}`);
        assert(contrast(cols.chip, cols.chipBg) >= 4.5, `pill contrast ${contrast(cols.chip, cols.chipBg).toFixed(2)}`);
        const cut = await row.evaluate((el) => [...el.querySelectorAll('.pay-who, .pay-who *')].filter((x) => x.scrollWidth > x.clientWidth + 1).length);
        assert(cut === 0, 'cut-off text');
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
        const b = await row.evaluate((el) => {
          const box = el.getBoundingClientRect();
          return [...el.querySelectorAll('*')].filter((x) => { const r = x.getBoundingClientRect(); return r.width > 0 && (r.right > box.right + 1 || r.left < box.left - 1); }).length;
        });
        assert(b === 0, 'something sticks out of the row');
        await row.locator('.player-open').click();
        const sheet = page.locator('dialog[open]');
        await sheet.getByText(/not played yet/).first().waitFor();
        assert((await sheet.getByText(/not played yet/).count()) === 2, 'both games should say not played yet');
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

  // ---- The game is played: it turns green and moves to Collected.
  await fetch(`${BASE}/__dev/clock`, { method: 'POST', body: JSON.stringify({ atMs: Date.parse(thu.endsAt) + 3600_000 }) });
  await check('once played, the pill is green (not blue) and the money moved from Held to Collected', async () => {
    const { ctx, page } = await open('light', 390);
    await nav(page, 'Money').click();
    await openSess(page, thu);
    const row = sess(page, thu).locator('li.pay-row', { hasText: 'Mitchel' });
    assert(await row.locator('.chip').evaluate((el) => el.classList.contains('tone-ok')), 'pill is not green');
    assert(!/not played yet/.test(await row.innerText()), 'still says not played yet');
    const sum = squash(await page.locator('.money-sum').innerText());
    assert(/Collected \$28/.test(sum) && !/Held/.test(sum), sum);
    await ctx.close();
  });
  await fetch(`${BASE}/__dev/clock`, { method: 'POST', body: JSON.stringify({ atMs: Date.parse('2026-10-26T12:00:00-04:00') }) });

  // ---- Thu Oct 29 is canceled: refund prompt.
  await call(api.request, 'POST', `/api/admin/sessions/${thu.id}/decision`, { decision: 'cancel', confirm: true });
  for (const scheme of ['light', 'dark']) {
    for (const width of [360, 375, 390, 430]) {
      const tag = `${width}px ${scheme}`;
      const { ctx, page, errors } = await open(scheme, width);
      await check(`${tag}: Home shows the refund card first, with name, amount and Refund; Tue Oct 27 is not in it`, async () => {
        const card = page.getByRole('article', { name: /^Thu, Oct 29 was canceled\. Refund needed:/ });
        await card.waitFor();
        const first = await page.locator('main article').first().getAttribute('aria-label');
        assert(/Refund needed/.test(first), `first card is "${first}"`);
        const t = squash(await card.innerText());
        assert(/Mitchel \$14/.test(t) && /paid \$14/.test(t), t);
        assert(!/Oct 27/.test(t), 'mentions the other game');
        const refund = card.getByRole('link', { name: /^Refund Mitchel/ });
        const href = await refund.getAttribute('href');
        assert(href === 'https://venmo.com/?txn=pay&recipients=Mitchel-K&amount=14&note=Pickleball%20Thu%20Oct%2029%20refund', `href ${href}`);
        assert((await refund.getAttribute('data-app-href')) === 'venmo://paycharge?txn=pay&recipients=Mitchel-K&amount=14&note=Pickleball%20Thu%20Oct%2029%20refund', 'app link');
        assert((await card.getByRole('button', { name: 'Mark refunded' }).count()) === 0, 'Mark refunded shown before tapping Refund');
        const m = await card.evaluate((el) => {
          const box = el.getBoundingClientRect();
          const btns = [...el.querySelectorAll('.pay-btns > *')].map((b) => b.getBoundingClientRect());
          return { out: [...el.querySelectorAll('*')].filter((x) => { const r = x.getBoundingClientRect(); return r.width > 0 && (r.right > box.right + 1 || r.left < box.left - 1); }).length, h: btns.map((b) => b.height) };
        });
        assert(m.out === 0, 'sticks out of the card');
        assert(m.h.every((h) => h >= 44), `tap target ${m.h}`);
        assert((await overflow(page)) <= 0, 'sideways scroll');
      });
      await check(`${tag}: the Money row for the canceled game has the same Refund button, and Tue Oct 27 still shows Mitchel paid`, async () => {
        await nav(page, 'Money').click();
        await openSess(page, thu);
        const row = sess(page, thu).locator('li[data-refund="Mitchel"]');
        await row.getByRole('link', { name: /^Refund Mitchel/ }).waitFor();
        assert(/canceled/.test(await sess(page, thu).locator('summary').innerText()), 'row should say canceled');
        const widths = await row.locator('.pay-btns > *').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().width));
        assert(widths.length === 1, `buttons ${widths}`);
        await openSess(page, tue);
        const tueRow = sess(page, tue).locator('li.pay-row', { hasText: 'Mitchel' });
        assert(await tueRow.locator('.chip').evaluate((el) => el.classList.contains('tone-info')), 'Tue should still be blue');
        const sum = squash(await page.locator('.money-sum').innerText());
        assert(/Held \$28/.test(sum), `canceled game's money is still held until paid back: ${sum}`);
        assert((await overflow(page)) <= 0, 'sideways scroll');
      });
      await check(`${tag}: no browser errors`, async () => assert(errors.length === 0, errors.join(' | ')));
      if (width === 390) await page.screenshot({ path: path.join(SHOTS, `held-refund-${scheme}.png`), fullPage: true });
      await ctx.close();
    }
  }

  // ---- Refund, Mark refunded, Undo.
  {
    const { ctx, page } = await open('light', 390);
    await check('tapping Refund opens Venmo (blocked here) and marks nothing; then Mark refunded appears, and the card goes away', async () => {
      const card = page.getByRole('article', { name: /^Thu, Oct 29 was canceled/ });
      await card.getByRole('link', { name: /^Refund Mitchel/ }).click();
      const mark = card.getByRole('button', { name: 'Mark refunded' });
      await mark.waitFor();
      assert((await card.getByText('Refunded', { exact: true }).count()) === 0, 'marked on tap');
      await page.reload();
      await page.getByRole('article', { name: /^Thu, Oct 29 was canceled/ }).getByRole('button', { name: 'Mark refunded' }).waitFor(); // survives a reload
      await page.getByRole('article', { name: /^Thu, Oct 29 was canceled/ }).getByRole('button', { name: 'Mark refunded' }).click();
      await page.getByRole('article', { name: /^Thu, Oct 29 was canceled/ }).waitFor({ state: 'detached' });
    });
    await check('Held drops by $14, and Undo on the Money row brings the card back', async () => {
      await nav(page, 'Money').click();
      await openSess(page, thu);
      assert(/Held \$14/.test(squash(await page.locator('.money-sum').innerText())), 'Held after refund');
      const row = sess(page, thu).locator('li[data-refund="Mitchel"]');
      await row.getByText('Refunded', { exact: true }).waitFor();
      await row.getByRole('button', { name: 'Undo' }).click();
      await row.getByRole('link', { name: /^Refund Mitchel/ }).waitFor();
      assert(/Held \$28/.test(squash(await page.locator('.money-sum').innerText())), 'Held after undo');
      await nav(page, 'Home').click();
      await page.getByRole('article', { name: /^Thu, Oct 29 was canceled/ }).waitFor();
    });
    await check('nothing here ever says money was sent', async () => {
      const t = await page.locator('body').innerText();
      assert(!/\bsent\b/i.test(t), 'says sent');
    });
    await ctx.close();
  }

  // ---- Players never see any of it.
  await check('player screens carry no held money, refund card or Venmo handle', async () => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 860 }, isMobile: true, hasTouch: true });
    await call(ctx.request, 'POST', '/api/me', { playerId: id.Mitchel });
    const page = await ctx.newPage();
    await page.goto(BASE + '/');
    await page.locator('.schedule article').first().waitFor();
    const t = squash(await page.locator('body').innerText());
    assert(!/held|refund|Mitchel-K|not played yet/i.test(t), t.slice(0, 300));
    const raw = await (await ctx.request.get(BASE + '/api/group')).text();
    assert(!/Mitchel-K|venmo_handle|"venmo":|heldCents/.test(raw), 'API leaks it');
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
