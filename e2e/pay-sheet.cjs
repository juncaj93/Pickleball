/* The Pay sheet (PAY_SHEET, Nov 2026) in a real browser.
 *
 *   node e2e/pay-sheet.cjs      (also run by npm run test:e2e)
 *
 * Off (the ship state): Pay is exactly what it was (a link to Venmo, no sheet). ?paysheet=on turns it on for that phone
 * only (?paysheet=off ends it); Settings > Feature switches > "Pay sheet" turns it on for everyone with no deploy. On: both
 * Pay buttons (the "Tonight: you owe" card at the top and a game card) open a small bottom sheet: title "Pay Alex $14", two
 * equal buttons ("Have the Venmo app? Click here" = the same Venmo link, "Copy Venmo @handle"), a gray Apple Pay / Zelle /
 * cash line, and "I paid". Nothing else. The Zelle number is Settings > Money (default 248-247-9231).
 * The real Venmo app cannot be opened here: the link's address is checked, the tap itself is the owner's phone test.
 *
 * Starts its own dev server with a fresh fake group (e2e/layout-lib.cjs). Nothing here touches the live site.
 */
const path = require('node:path');
const { mkdirSync } = require('node:fs');
const L = require('./layout-lib.cjs');
const { audit } = require('./layout-audit.cjs');

const PORT = Number(process.env.E2E_PORT) || 5318;
const TOKEN = 'paysheet-setup-token-0123456789';
const SHOTS = process.env.LAYOUT_SHOTS || '';

let passed = 0;
let failed = 0;
async function check(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.log(`  ✗ ${name}\n      ${String(err && err.message ? err.message : err).replace(/\s*\n\s*/g, ' ⏎ ').slice(0, 1400)}`);
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
const squash = (t) => String(t || '').replace(/\s+/g, ' ').trim();
const bigText = (page, pct) =>
  pct === 100 ? Promise.resolve() : page.addStyleTag({ content: `html { font-size: ${pct}% !important; } body { font-size: ${(17 * pct) / 100}px !important; }` });

async function main() {
  if (SHOTS) mkdirSync(SHOTS, { recursive: true });
  const { BASE } = await L.startSite({ port: PORT, name: 'pay-sheet', token: TOKEN });
  const w = await L.seed({ BASE, token: TOKEN });
  const { browser, post, put, ok, S, idOf, areq } = w;
  const phone = (width, scheme) => ({ viewport: { width, height: 900 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, userAgent: L.UA, colorScheme: scheme });

  async function open(name, { width = 390, scheme = 'light', pct = 100, query = '' } = {}) {
    const ctx = await browser.newContext(phone(width, scheme));
    // Venmo's own address is never really opened; the app link (venmo://) is recorded instead of followed.
    await ctx.route('https://venmo.com/**', (r) => r.abort());
    await post(ctx.request, '/api/me', { playerId: idOf(name) });
    await ctx.addInitScript(() => {
      try {
        localStorage.setItem('pb_games_filter', 'all');
      } catch {}
      window.__copied = [];
      const clip = { writeText: (t) => (window.__copied.push(t), Promise.resolve()) };
      Object.defineProperty(navigator, 'clipboard', { value: clip, configurable: true });
    });
    const page = await ctx.newPage();
    await page.goto(BASE + query);
    await page.locator('.schedule article').first().waitFor();
    const more = page.getByRole('button', { name: /^More sessions/ });
    if (await more.count()) {
      await more.click();
      await page.waitForTimeout(200);
    }
    await page.evaluate((x) => (window.__layoutW = x), width);
    await bigText(page, pct);
    await page.waitForTimeout(450);
    return { ctx, page };
  }
  const dash = async () => (await areq.get(`${BASE}/api/admin/dashboard`)).json();
  /** Every seat and payment by game (new weeks appear as the clock moves, so games are matched by id), plus the credit ledger. */
  const moneyNow = async () => {
    const d = await dash();
    const games = {};
    for (const s of d.sessions) games[s.id] = s.roster.map((r) => [r.name, r.status, r.paymentStatus, r.paymentAmountCents ?? null, r.selfPaid]);
    return { games, ledger: d.creditLedger };
  };
  const sameBooks = (a, b) => Object.keys(a.games).every((id) => JSON.stringify(a.games[id]) === JSON.stringify(b.games[id])) && JSON.stringify(a.ledger) === JSON.stringify(b.ledger);
  const ryanSeat = async (sid) => (await dash()).sessions.find((x) => x.id === sid).roster.find((r) => r.name === 'Ryan');
  const row = (page, sid) => page.locator(`#row-${sid}`);
  const sheet = (page) => page.locator('dialog.sheet[open]');
  const body = async (page) => squash(await sheet(page).innerText());

  /* ---- Monday 9:00 AM: no top card yet; Ryan owes $14 on tonight's and Thursday's games (rows have Pay) ---- */
  await w.clock('2026-11-02T09:00:00-05:00');
  const before = await moneyNow();

  await check('ships OFF: Pay is a plain link to Venmo, tapping it opens no sheet and keeps the old behavior', async () => {
    const a = await open('Ryan');
    const pay = row(a.page, S[1]).locator('a.pay-btn');
    assert((await pay.count()) === 1, 'Pay on the card');
    assert(/^https:\/\/venmo\.com\/\?txn=pay&recipients=organizer&amount=14/.test(await pay.getAttribute('href')), 'the Venmo link');
    assert(/^venmo:\/\/paycharge\?/.test(await pay.getAttribute('data-app-href')), 'the app link');
    await pay.click();
    await a.page.waitForTimeout(500);
    assert((await sheet(a.page).count()) === 0, 'a sheet opened with the switch off');
    assert((await a.page.locator('[data-pay-sheet]').count()) === 0, 'a Pay sheet is on the page with the switch off');
    await a.ctx.close();
  });

  await check('?paysheet=on: Pay on a game card opens the sheet: title, two equal buttons, gray line, I paid, nothing else; that phone only; ?paysheet=off ends it', async () => {
    const a = await open('Ryan', { query: '/?paysheet=on' });
    const pay = row(a.page, S[1]).locator('a.pay-btn');
    const href = await pay.getAttribute('href');
    const appHref = await pay.getAttribute('data-app-href');
    await pay.click();
    await sheet(a.page).waitFor();
    assert((await sheet(a.page).locator('h2').innerText()) === 'Pay Alex $14', `title: ${await sheet(a.page).locator('h2').innerText()}`);
    const buttons = sheet(a.page).locator('.sheet-body .btn');
    assert((await buttons.count()) === 3, `${await buttons.count()} buttons`);
    assert(squash(await buttons.nth(0).innerText()) === 'Have the Venmo app? Click here', 'first button');
    assert(squash(await buttons.nth(1).innerText()) === 'Copy Venmo @organizer', `second button: ${await buttons.nth(1).innerText()}`);
    assert(squash(await buttons.nth(2).innerText()) === 'I paid', 'third button');
    assert(squash(await sheet(a.page).locator('.pay-alt').innerText()) === 'No Venmo? Apple Pay or Zelle 248-247-9231, or cash.', 'gray line');
    // The green button is the same link Pay always had.
    assert((await buttons.nth(0).getAttribute('href')) === href && (await buttons.nth(0).getAttribute('data-app-href')) === appHref, 'the same Venmo link');
    assert(/amount=14/.test(href) && /note=Pickleball/.test(href), 'the amount and note');
    // Nothing else in the sheet.
    const words = await body(a.page);
    assert(words === 'Pay Alex $14 ✕ Have the Venmo app? Click here Copy Venmo @organizer No Venmo? Apple Pay or Zelle 248-247-9231, or cash. I paid', `sheet text: ${words}`);
    assert((await sheet(a.page).locator('a[href]').count()) === 1, 'only the Venmo link, no web link');
    // Another phone is not switched on.
    const other = await open(L.NOSPACE);
    await row(other.page, S[1]).locator('a.pay-btn').click();
    await other.page.waitForTimeout(400);
    assert((await other.page.locator('dialog.sheet[open]').count()) === 0, 'another phone has the sheet');
    await other.ctx.close();
    await a.page.goto(BASE + '/?paysheet=off');
    await a.page.locator('.schedule article').first().waitFor();
    assert((await a.page.locator('[data-pay-sheet]').count()) === 0, '?paysheet=off should end it');
    await a.ctx.close();
  });

  await check('Copy Venmo @handle copies "@organizer" (nothing else) and says so; the books do not move', async () => {
    const a = await open('Ryan', { query: '/?paysheet=on' });
    await row(a.page, S[1]).locator('a.pay-btn').click();
    await sheet(a.page).waitFor();
    await sheet(a.page).locator('[data-copy-venmo]').click();
    await a.page.waitForTimeout(300);
    assert(JSON.stringify(await a.page.evaluate(() => window.__copied)) === '["@organizer"]', `copied: ${JSON.stringify(await a.page.evaluate(() => window.__copied))}`);
    assert(/Copied @organizer/.test(await a.page.locator('body').innerText()), 'the toast says so');
    assert(sameBooks(before, await moneyNow()), 'money moved');
    await a.ctx.close();
  });

  await check('I paid in the sheet does what the card\'s I paid does: Ryan marked paid once, the sheet closes, the card reads Paid $14', async () => {
    const a = await open('Ryan', { query: '/?paysheet=on' });
    await row(a.page, S[1]).locator('a.pay-btn').click();
    await sheet(a.page).waitFor();
    let posts = 0;
    a.page.on('request', (rq) => {
      if (rq.method() === 'POST' && /\/api\/sessions\/[^/]+\/paid$/.test(rq.url())) posts++;
    });
    await sheet(a.page).locator('[data-sheet-paid]').click();
    await a.page.locator('dialog.sheet[open]').waitFor({ state: 'detached', timeout: 8000 }).catch(() => {});
    await row(a.page, S[1]).getByText(/Paid \$14/).first().waitFor({ timeout: 8000 });
    const seat = await ryanSeat(S[1]);
    assert(seat.selfPaid === true && posts === 1, `server: ${JSON.stringify(seat)} requests: ${posts}`);
    assert((await sheet(a.page).count()) === 0, 'the sheet is closed');
    await row(a.page, S[1]).getByRole('button', { name: "Didn't pay?" }).click();
    await a.page.waitForTimeout(600);
    assert((await ryanSeat(S[1])).selfPaid === false, 'put back');
    await a.ctx.close();
  });

  await check('the green button follows the link as always (a phone: the app address; the page does not leave) and the "No Venmo? note" does not show while the sheet is on', async () => {
    const a = await open('Ryan', { query: '/?paysheet=on&paynote=on' });
    await row(a.page, S[1]).locator('a.pay-btn').click();
    await sheet(a.page).waitFor();
    await sheet(a.page).locator('.pay-pair .btn').first().click();
    await a.page.waitForTimeout(3000);
    assert((await a.page.locator('.pop', { hasText: 'No Venmo?' }).count()) === 0, 'the note showed with the sheet on');
    assert((await a.page.locator('dialog.sheet[open]').count()) === 1, 'the sheet stays so I paid is there on return');
    await a.ctx.close();
  });

  /* ---- Settings: the switch and the number ---- */
  await check('Settings > Feature switches has "Pay sheet" (off at ship): on shows the sheet to every phone, off puts Pay back; the activity log says so', async () => {
    const ctx = await browser.newContext(phone(390, 'light'));
    await post(ctx.request, '/api/admin/login', { pin: L.PIN });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/admin`);
    await page.locator('section[aria-labelledby="sessions-title"]').waitFor();
    await page.locator('nav.tabbar').getByRole('button', { name: /^Settings/ }).click();
    const sect = page.locator('details.set-sect', { hasText: 'Feature switches' });
    await sect.waitFor();
    assert((await sect.evaluate((d) => d.open)) === false, 'Feature switches starts collapsed');
    await sect.locator('summary').click();
    const sw = sect.locator('[data-pay-sheet-all]');
    assert(!(await sw.isChecked()), 'off at ship');
    await sw.click();
    await sect.locator('[data-row="paySheetAll"] .save-mark.saved').waitFor();
    assert((await dash()).paySheetForAll === true, 'saved on the server');
    let p = await open('Ryan');
    await row(p.page, S[1]).locator('a.pay-btn').click();
    await sheet(p.page).waitFor();
    await p.ctx.close();
    await sw.click();
    await page.waitForTimeout(700);
    assert((await dash()).paySheetForAll === false, 'switched off again');
    p = await open('Ryan');
    await row(p.page, S[1]).locator('a.pay-btn').click();
    await p.page.waitForTimeout(400);
    assert((await p.page.locator('dialog.sheet[open]').count()) === 0, 'Pay is back as it was');
    await p.ctx.close();
    const act = await (await areq.get(`${BASE}/api/admin/activity`)).json();
    const text = JSON.stringify(act.entries || []);
    assert(/pay_sheet_on/.test(text) && /pay_sheet_off/.test(text), 'the activity log shows the switch');
    await ctx.close();
  });

  await check('Settings > Money has "Apple Pay / Zelle number" (default 248-247-9231): a new number shows on the sheet, blank leaves the line out, a bad number is refused', async () => {
    const ctx = await browser.newContext(phone(390, 'light'));
    await post(ctx.request, '/api/admin/login', { pin: L.PIN });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/admin`);
    await page.locator('section[aria-labelledby="sessions-title"]').waitFor();
    await page.locator('nav.tabbar').getByRole('button', { name: /^Settings/ }).click();
    const money = page.locator('details.set-sect', { hasText: 'Money' }).first();
    await money.waitFor();
    if (!(await money.evaluate((d) => d.open))) await money.locator('summary').click();
    const box = money.locator('[data-row="zelleNumber"] input');
    assert((await box.inputValue()) === '248-247-9231', `default: ${await box.inputValue()}`);
    await box.fill('313-555-0142');
    await box.blur();
    await money.locator('.save-mark.saved').first().waitFor();
    const player = await open('Ryan', { query: '/?paysheet=on' });
    await row(player.page, S[1]).locator('a.pay-btn').click();
    await sheet(player.page).waitFor();
    assert(/Zelle 313-555-0142, or cash\./.test(await body(player.page)), `line: ${await body(player.page)}`);
    await player.ctx.close();
    await box.fill('');
    await box.blur();
    await page.waitForTimeout(900);
    const blank = await open('Ryan', { query: '/?paysheet=on' });
    await row(blank.page, S[1]).locator('a.pay-btn').click();
    await sheet(blank.page).waitFor();
    assert((await sheet(blank.page).locator('.pay-alt').count()) === 0, 'a blank number leaves the gray line out');
    assert((await sheet(blank.page).locator('.sheet-body .btn').count()) === 3, 'the buttons stay');
    await blank.ctx.close();
    await box.fill('hello');
    await box.blur();
    await page.waitForTimeout(500);
    assert(/phone number/i.test(await money.innerText()), 'a bad number is refused with a message');
    await box.fill('248-247-9231');
    await box.blur();
    await page.waitForTimeout(900);
    assert((await dash()).group.zelleNumber === '248-247-9231', 'back to the default number');
    await ctx.close();
  });

  /* ---- Game day: the card at the top, and both Pay buttons ---- */
  await w.clock('2026-11-03T10:00:00-05:00');

  await check('game day: Pay on the "Tonight: you owe $14" card opens the same sheet (same amount, same link); I paid there marks paid and the card goes away', async () => {
    const a = await open('Ryan', { query: '/?paysheet=on&playerfix1=on' });
    const top = a.page.locator('section.pay-card');
    const topPay = top.getByRole('link', { name: /Pay \$14 with Venmo/ });
    const href = await topPay.getAttribute('href');
    await topPay.click();
    await sheet(a.page).waitFor();
    assert((await sheet(a.page).locator('h2').innerText()) === 'Pay Alex $14', 'title');
    assert((await sheet(a.page).locator('.pay-pair .btn').first().getAttribute('href')) === href, 'same link as the top Pay');
    await sheet(a.page).locator('[data-sheet-paid]').click();
    await top.waitFor({ state: 'detached', timeout: 8000 });
    assert((await ryanSeat(S[1])).selfPaid === true, 'server: paid');
    assert(/Paid \$14/.test(squash(await row(a.page, S[1]).innerText())), 'tonight\'s card reads Paid $14 too');
    await row(a.page, S[1]).getByRole('button', { name: "Didn't pay?" }).click();
    await top.waitFor({ timeout: 8000 });
    await a.ctx.close();
  });
  await check('game day with both Pay buttons (Player screen fixes on): each opens its own sheet, I paid in either updates both cards', async () => {
    const a = await open('Ryan', { query: '/?paysheet=on&playerfix1=on' });
    // The top card's own sheet first (closed with its X), then the game card's.
    await a.page.locator('section.pay-card').getByRole('link', { name: /Pay \$14 with Venmo/ }).click();
    await sheet(a.page).waitFor();
    assert((await sheet(a.page).locator('h2').innerText()) === 'Pay Alex $14', 'the top card\'s sheet');
    await sheet(a.page).getByRole('button', { name: 'Close' }).click();
    await a.page.locator('dialog.sheet[open]').waitFor({ state: 'detached' });
    await row(a.page, S[1]).locator('a.pay-btn').click();
    await sheet(a.page).waitFor();
    assert((await sheet(a.page).locator('h2').innerText()) === 'Pay Alex $14', 'the card\'s sheet');
    await sheet(a.page).locator('[data-sheet-paid]').click();
    await a.page.locator('section.pay-card').waitFor({ state: 'detached', timeout: 8000 });
    assert((await ryanSeat(S[1])).selfPaid === true, 'server: paid');
    await row(a.page, S[1]).getByRole('button', { name: "Didn't pay?" }).click();
    await a.page.locator('section.pay-card').waitFor({ timeout: 8000 });
    await a.ctx.close();
  });

  /* ---- Looks ---- */
  /** Opens the sheet from the top card or from tonight's game card, then measures it. */
  const openSheet = async (page, from) => {
    const link = from === 'top' ? page.locator('section.pay-card').getByRole('link', { name: /Pay \$14 with Venmo/ }) : row(page, S[1]).locator('a.pay-btn');
    await link.click();
    await sheet(page).waitFor();
    await page.waitForTimeout(400);
    return page.evaluate(() => {
      const d = document.querySelector('dialog.sheet[open]');
      const btns = [...d.querySelectorAll('.sheet-body .btn')];
      const [g, c, p] = btns.map((b) => b.getBoundingClientRect());
      const cs = (el) => getComputedStyle(el);
      return {
        gh: g.height, ch: c.height, gw: g.width, cw: c.width,
        green: [cs(btns[0]).backgroundColor, cs(btns[0]).color],
        outline: [cs(btns[1]).backgroundColor, cs(btns[1]).color, cs(btns[1]).borderTopColor],
        paid: [cs(btns[2]).backgroundColor, p.height],
        paidCheck: btns[2].querySelectorAll('svg.paid-check').length,
        paidSize: [p.width, p.height],
        paidBorder: cs(btns[2]).borderTopColor,
        paidCenter: p.left + p.width / 2,
        sheetCenter: g.left + g.width / 2,
        title: cs(d.querySelector('h2')).fontSize,
        dw: d.getBoundingClientRect().width,
        scroll: d.scrollWidth - d.clientWidth,
        within: d.getBoundingClientRect().left >= -1 && d.getBoundingClientRect().right <= innerWidth + 1,
      };
    });
  };
  for (const width of [320, 360, 430]) {
    for (const scheme of ['light', 'dark']) {
      for (const pct of [100, 200]) {
        await check(`sheet look, ${width}px ${scheme} text ${pct}%, from the top card and from the game card: the two buttons are the same height, outline and filled as the Pay card, nothing cut off or past the edge, no sideways scroll`, async () => {
          const a = await open('Ryan', { width, scheme, pct, query: '/?paysheet=on&playerfix1=on' });
          const titles = [];
          for (const from of ['top', 'card']) {
            const m = await openSheet(a.page, from);
            titles.push(m.title);
            assert(m.paidSize[0] >= m.gw / 2 - 1.5 && m.paidSize[0] <= m.gw * 0.62 && m.paidSize[1] >= 52, `${from}: the I paid button is not about half the width (half, or just wider when huge text needs it: ${m.paidSize[0]} vs ${m.gw}) or too short: ${m.paidSize}`);
            assert(Math.abs(m.paidCenter - m.sheetCenter) <= 1.5, `${from}: the I paid button is not centered: ${m.paidCenter} vs ${m.sheetCenter}`);
            assert(m.paidBorder !== 'rgba(0, 0, 0, 0)' && m.paidBorder !== m.paid[0] && m.paidBorder === m.outline[2], `${from}: the I paid outline is not the dark green outline: ${m.paidBorder} vs ${m.outline[2]}`);
            assert(Math.abs(m.gh - m.ch) < 1 && Math.abs(m.gw - m.cw) < 1, `${from}: unequal buttons: ${m.gw}x${m.gh} vs ${m.cw}x${m.ch}`);
            assert(m.scroll <= 0 && m.within, `${from}: sheet scrolls sideways or leaves the screen: ${JSON.stringify(m)}`);
            assert(m.outline[0] === 'rgba(0, 0, 0, 0)' && m.paid[0] !== 'rgba(0, 0, 0, 0)' && m.paid[0] !== m.green[0] && m.paid[0] !== m.outline[0] && m.paidCheck === 1 && m.green[0] !== m.outline[0], `${from}: colors: ${JSON.stringify(m)}`);
            const problems = await a.page.evaluate(audit, { scope: 'dialog.sheet[open]', allowEllipsis: [] });
            if (SHOTS) await a.page.screenshot({ path: path.join(SHOTS, `paysheet-${from}-${width}-${scheme}-${pct}.png`) }).catch(() => {});
            assert(problems.length === 0, `${from}: layout problems (${problems.length}): ${[...new Set(problems)].slice(0, 4).join(' | ')}`);
            await sheet(a.page).getByRole('button', { name: 'Close' }).click();
            await a.page.locator('dialog.sheet[open]').waitFor({ state: 'detached' });
          }
          assert(titles[0] === titles[1], `the title is a different size in the two places: ${titles}`);
          await a.ctx.close();
        });
      }
    }
  }
  await check('on a wide screen (800 px) the sheet is the same width from the top card and from the game card, and not wider than 640 px', async () => {
    const ctx = await browser.newContext({ viewport: { width: 800, height: 900 }, userAgent: L.UA, colorScheme: 'light' });
    await ctx.route('https://venmo.com/**', (r) => r.abort());
    await post(ctx.request, '/api/me', { playerId: idOf('Ryan') });
    await ctx.addInitScript(() => localStorage.setItem('pb_games_filter', 'all'));
    const page = await ctx.newPage();
    await page.goto(BASE + '/?paysheet=on&playerfix1=on');
    await page.locator('section.pay-card').waitFor();
    const widths = [];
    for (const from of ['top', 'card']) {
      const m = await openSheet(page, from);
      widths.push(Math.round(m.dw));
      await sheet(page).getByRole('button', { name: 'Close' }).click();
      await page.locator('dialog.sheet[open]').waitFor({ state: 'detached' });
    }
    await ctx.close();
    assert(widths[0] === widths[1] && widths[0] <= 640, `widths: ${widths}`);
  });

  await check('looking at the sheet and copying moved no money: every seat, payment and credit entry is as before', async () => {
    assert(sameBooks(before, await moneyNow()), 'the books changed');

  });

  console.log(`\n${passed} passed, ${failed} failed`);
  await browser.close();
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
