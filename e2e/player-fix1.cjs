/* "Player screen small fixes, round 1" (PLAYER_FIX1, Nov 2026) in a real browser.
 *
 *   node e2e/player-fix1.cjs      (also run by npm run test:e2e)
 *
 *   1. Game day after the 8:00 AM cutoff: tonight's game card gets Pay and "I paid" like every later card. The "Tonight:
 *      you owe $14" card at the top stays exactly as it is. Both Pay buttons work and move the same state.
 *   2. The blue TONIGHT tag gets room around its word (light and dark, 320 / 360 / 430 px, text 100% / 150% / 200%).
 *
 * Off (the ship state): every screen is as before. ?playerfix1=on turns it on for that phone only (?playerfix1=off ends it).
 * Settings > Feature switches > "Player screen fixes" turns it on for everyone with no deploy. Every look-only check reads the
 * records back: nothing here moves money.
 *
 * Starts its own dev server with a fresh fake group (e2e/layout-lib.cjs). Nothing here touches the live site.
 */
const path = require('node:path');
const { mkdirSync } = require('node:fs');
const L = require('./layout-lib.cjs');
const { audit } = require('./layout-audit.cjs');

const PORT = Number(process.env.E2E_PORT) || 5316;
const TOKEN = 'playerfix1-setup-token-0123456789';
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
  const { BASE } = await L.startSite({ port: PORT, name: 'player-fix1', token: TOKEN });
  const w = await L.seed({ BASE, token: TOKEN });
  const { browser, post, put, ok, S, idOf, areq } = w;
  // Tue Nov 3, 10:00 AM Eastern: game day, after the 8:00 AM cutoff. Tonight's game is S[1] (8:00 to 10:00 PM, court booked).
  await w.clock('2026-11-03T10:00:00-05:00');
  const phone = (width, scheme) => ({ viewport: { width, height: 900 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, userAgent: L.UA, colorScheme: scheme });
  const sleep = L.sleep;

  /** One player's phone on the home screen, every game showing. `query` is the private link (for example '/?playerfix1=on'). */
  async function open(name, { width = 390, scheme = 'light', pct = 100, query = '', ctx: reuse } = {}) {
    const ctx = reuse || (await browser.newContext(phone(width, scheme)));
    if (!reuse) {
      await ctx.route('https://venmo.com/**', (r) => r.abort());
      await post(ctx.request, '/api/me', { playerId: idOf(name) });
      await ctx.addInitScript(() => {
        try {
          localStorage.setItem('pb_games_filter', 'all');
        } catch {}
      });
    }
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
    // The "Game on!" banner and other toasts are in the way of nothing here; give the page a moment to settle.
    await page.waitForTimeout(450);
    return { ctx, page };
  }
  const row = (page) => page.locator(`#row-${S[1]}`);
  const dash = async () => (await areq.get(`${BASE}/api/admin/dashboard`)).json();
  /** Every seat, payment and credit entry, as the organizer sees them: proof that looking at a screen moves no money. */
  const moneyNow = async () => {
    const d = await dash();
    return JSON.stringify([d.sessions.map((s) => s.roster.map((r) => [r.name, r.status, r.paymentStatus, r.paymentAmountCents ?? null, r.selfPaid])), d.creditLedger]);
  };
  const ryanSeat = async () => {
    const d = await dash();
    const s = d.sessions.find((x) => x.id === S[1]);
    return s.roster.find((r) => r.name === 'Ryan');
  };
  const tagBox = (page) =>
    page.evaluate(() => {
      const t = document.querySelector('.tonight-tag');
      if (!t) return null;
      const r = t.getBoundingClientRect();
      const rg = document.createRange();
      rg.selectNodeContents(t);
      const word = rg.getBoundingClientRect();
      const tile = t.closest('.tile').getBoundingClientRect();
      const cs = getComputedStyle(t);
      return { pill: r.width, word: word.width, side: (r.width - word.width) / 2, tile: tile.width, left: r.left - tile.left, right: tile.right - r.right, h: r.height, bg: cs.backgroundColor, ink: cs.color, scrollOver: t.scrollWidth - t.clientWidth };
    });

  const before = await moneyNow();
  let offTop = '';
  let offTag = null;

  /* ---------------- OFF: exactly today's screen ---------------- */
  await check('ships OFF: after 8:00 AM tonight\'s card shows only "$14 due" and Drop out, the top card has Pay and I paid, the TONIGHT pill hugs its word', async () => {
    const a = await open('Ryan');
    assert((await a.page.locator('.schedule.pf1').count()) === 0, 'the new look is on with the switch off');
    const r = row(a.page);
    assert((await r.locator('a.pay-btn:not(.m-ghost)').count()) === 0, 'Pay on tonight\'s card with the switch off');
    assert((await r.getByRole('button', { name: 'I paid' }).count()) === 0, 'I paid on tonight\'s card with the switch off');
    assert(/\$14 due/.test(await r.innerText()) && /Drop out/.test(await r.innerText()), `card: ${squash(await r.innerText())}`);
    const top = a.page.locator('section.pay-card');
    assert(/Tonight: you owe \$14/.test(await top.innerText()), 'top card title');
    assert((await top.getByRole('link', { name: /Pay \$14 with Venmo/ }).count()) === 1, 'Pay on the top card');
    assert((await top.getByRole('button', { name: 'I paid' }).count()) === 1, 'I paid on the top card');
    offTop = squash(await top.innerText());
    offTag = await tagBox(a.page);
    assert(offTag && offTag.side < 1, `the old pill hugs the word: ${JSON.stringify(offTag)}`);
    await a.ctx.close();
  });

  /* ---------------- the private link: that phone only ---------------- */
  await check('?playerfix1=on: tonight\'s card gets Pay, I paid and Drop out; the top card stays exactly as it was; that phone only; ?playerfix1=off ends it', async () => {
    const a = await open('Ryan', { query: '/?playerfix1=on' });
    assert((await a.page.locator('.schedule.pf1').count()) === 1, 'the new look is not on');
    const r = row(a.page);
    const pay = r.locator('a.pay-btn:not(.m-ghost)');
    assert((await pay.count()) === 1, 'Pay on tonight\'s card');
    assert(squash(await pay.innerText()) === 'Pay', `Pay label: ${await pay.innerText()}`);
    assert((await r.getByRole('button', { name: 'I paid' }).count()) === 1, 'I paid on tonight\'s card');
    assert((await r.getByRole('button', { name: 'Drop out' }).count()) === 1, 'Drop out on tonight\'s card');
    assert(/\$14 due/.test(await r.innerText()), '"$14 due" stays');
    const top = a.page.locator('section.pay-card');
    assert(squash(await top.innerText()) === offTop, `the top card changed: "${squash(await top.innerText())}" vs "${offTop}"`);
    // The same payment link on both buttons: same amount, same note, same app link.
    const topPay = top.getByRole('link', { name: /Pay \$14 with Venmo/ });
    assert((await topPay.getAttribute('href')) === (await pay.getAttribute('href')), 'both Pay buttons use the same Venmo link');
    assert((await topPay.getAttribute('data-app-href')) === (await pay.getAttribute('data-app-href')), 'both Pay buttons use the same app link');
    assert(/amount=14/.test(await pay.getAttribute('href')), 'the amount is $14');
    // Another phone is not switched on.
    const other = await open(L.NOSPACE);
    assert((await other.page.locator('.schedule.pf1').count()) === 0, 'another phone has the new look');
    assert((await row(other.page).locator('a.pay-btn:not(.m-ghost)').count()) === 0, 'another phone has Pay on tonight\'s card');
    assert(!(await other.page.evaluate(() => localStorage.getItem('pb_player_fix1'))), 'another phone is remembered as switched on');
    await other.ctx.close();
    // ?playerfix1=off ends it on this phone.
    await a.page.goto(BASE + '/?playerfix1=off');
    await a.page.locator('.schedule article').first().waitFor();
    assert((await a.page.locator('.schedule.pf1').count()) === 0, '?playerfix1=off should end the private test');
    assert((await row(a.page).locator('a.pay-btn:not(.m-ghost)').count()) === 0, 'Pay is back on the top card only');
    await a.ctx.close();
  });

  /* ---------------- the later cards look the same as tonight's ---------------- */
  await check('with the switch on, tonight\'s card and a later card have the same buttons in the same order (Pay, then I paid and Drop out)', async () => {
    const a = await open('Ryan', { query: '/?playerfix1=on' });
    const shape = (id) =>
      a.page.evaluate((rid) => {
        const r = document.getElementById(`row-${rid}`);
        const pay = r.querySelector('a.pay-btn:not(.m-ghost)');
        const links = [...r.querySelectorAll('.sched-links .link-btn')].map((b) => b.textContent.trim());
        const chip = r.querySelector('[data-owe]');
        return { pay: pay && pay.textContent.trim(), links, chip: chip && chip.textContent.trim(), payNextToChip: !!(pay && chip && pay.closest('.pay-line') === chip.closest('.pay-line')), outline: pay && pay.classList.contains('outline') };
      }, id);
    const tonight = await shape(S[1]);
    const later = await shape(S[3]);
    assert(JSON.stringify(tonight) === JSON.stringify(later), `tonight ${JSON.stringify(tonight)} vs later ${JSON.stringify(later)}`);
    assert(tonight.payNextToChip && tonight.links.join() === 'I paid,Drop out', JSON.stringify(tonight));
    await a.ctx.close();
  });

  /* ---------------- the TONIGHT tag ---------------- */
  const LOOKS = [];
  for (const width of [320, 360, 430]) for (const pct of [100, 150, 200]) for (const scheme of ['light', 'dark']) LOOKS.push({ width, pct, scheme });
  for (const l of LOOKS) {
    await check(`TONIGHT tag, ${l.width}px ${l.scheme} text ${l.pct}%: room on every side, inside its tile, same colors as before, no sideways scroll or cut-off text`, async () => {
      const off = await open('Ryan', l);
      const was = await tagBox(off.page);
      await off.ctx.close();
      const a = await open('Ryan', { ...l, query: '/?playerfix1=on' });
      const t = await tagBox(a.page);
      assert(t, 'no TONIGHT tag');
      assert(t.side >= 6, `side room ${t.side.toFixed(1)}px (was ${was.side.toFixed(1)})`);
      assert(t.h <= was.h + 6, `the pill grew too much: ${t.h.toFixed(1)} vs ${was.h.toFixed(1)}`);
      assert(t.left >= 4 && t.right >= 4, `inside its tile with a gap: ${t.left.toFixed(1)} / ${t.right.toFixed(1)}`);
      assert(t.scrollOver <= 0, 'the word is cut off');
      assert(t.bg === was.bg && t.ink === was.ink, `colors changed: ${was.bg}/${was.ink} -> ${t.bg}/${t.ink}`);
      const problems = await a.page.evaluate(audit, { allowEllipsis: ['.topbar h1', '.topbar .eyebrow'] });
      if (SHOTS) await a.page.locator('.schedule article').first().screenshot({ path: path.join(SHOTS, `tonight-${l.width}-${l.scheme}-${l.pct}.png`) }).catch(() => {});
      await a.ctx.close();
      assert(problems.length === 0, `layout problems (${problems.length}): ${[...new Set(problems)].slice(0, 4).join(' | ')}`);
    });
  }
  await check('the other tiles are untouched: a weekday tile (WED, THU) looks the same with the switch on or off, and no other tag shares the TONIGHT style', async () => {
    const grab = (query) =>
      open('Ryan', { query }).then(async (a) => {
        const out = await a.page.evaluate(() => [...document.querySelectorAll('.tile.ptile .dow')].slice(0, 4).map((e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return [e.textContent, Math.round(r.width), Math.round(r.height), cs.fontSize, cs.color].join('|'); }));
        const owners = await a.page.evaluate(() => [...document.querySelectorAll('.tonight-tag')].map((e) => e.textContent));
        await a.ctx.close();
        return { out, owners };
      });
    const off = await grab('/?playerfix1=off');
    const on = await grab('/?playerfix1=on');
    assert(off.out.length > 0 && JSON.stringify(off.out) === JSON.stringify(on.out), `weekday tiles changed: ${JSON.stringify(off.out)} vs ${JSON.stringify(on.out)}`);
    assert(on.owners.length === 1 && on.owners[0] === 'TONIGHT', `tags with this style: ${JSON.stringify(on.owners)}`);
  });

  /* ---------------- nothing moved so far ---------------- */
  await check('looking at the screens (switch off and on) moved no money: every seat, payment and credit entry is exactly as before', async () => {
    assert((await moneyNow()) === before, 'the books changed');
  });

  /* ---------------- both Pay buttons work, on the same state ---------------- */
  await check('I paid on tonight\'s card: marks Ryan paid once, the top card goes away, the card reads Paid $14; Didn\'t pay? puts it back on both', async () => {
    const a = await open('Ryan', { query: '/?playerfix1=on' });
    const r = row(a.page);
    await r.getByRole('button', { name: 'I paid' }).click();
    await a.page.locator('.toast, [role="status"]', { hasText: 'Marked paid' }).first().waitFor();
    const seat = await ryanSeat();
    assert(seat.selfPaid === true && seat.paymentStatus !== 'unpaid', `server: ${JSON.stringify(seat)}`);
    await a.page.locator('section.pay-card').waitFor({ state: 'detached', timeout: 8000 });
    assert(/Paid \$14/.test(await r.innerText()), `card: ${squash(await r.innerText())}`);
    await r.getByRole('button', { name: "Didn't pay?" }).click();
    await a.page.locator('section.pay-card').waitFor({ timeout: 8000 });
    assert((await ryanSeat()).selfPaid === false, 'server: not paid again');
    await r.locator('a.pay-btn:not(.m-ghost)').waitFor({ timeout: 8000 });
    await r.getByText(/\$14 due/).first().waitFor({ timeout: 8000 });
    assert((await r.locator('a.pay-btn:not(.m-ghost)').count()) === 1, 'the card owes again with its Pay');
    await a.ctx.close();
  });
  await check('I paid on the top card: the same record, and tonight\'s card reads Paid $14 as well', async () => {
    const a = await open('Ryan', { query: '/?playerfix1=on' });
    await a.page.locator('section.pay-card').getByRole('button', { name: 'I paid' }).click();
    await a.page.locator('section.pay-card').waitFor({ state: 'detached', timeout: 8000 });
    assert((await ryanSeat()).selfPaid === true, 'server: paid');
    assert(/Paid \$14/.test(await row(a.page).innerText()), `card: ${squash(await row(a.page).innerText())}`);
    await row(a.page).getByRole('button', { name: "Didn't pay?" }).click();
    await a.page.locator('section.pay-card').waitFor({ timeout: 8000 });
    await a.ctx.close();
  });
  await check('the two I paid buttons tapped together send one request, not two', async () => {
    const a = await open('Ryan', { query: '/?playerfix1=on' });
    let posts = 0;
    a.page.on('request', (rq) => {
      if (rq.method() === 'POST' && /\/api\/sessions\/[^/]+\/paid$/.test(rq.url())) posts++;
    });
    const top = a.page.locator('section.pay-card').getByRole('button', { name: 'I paid' });
    const mine = row(a.page).getByRole('button', { name: 'I paid' });
    await Promise.all([top.dispatchEvent('click'), mine.dispatchEvent('click')]);
    await a.page.locator('section.pay-card').waitFor({ state: 'detached', timeout: 8000 });
    await a.page.waitForTimeout(400);
    assert(posts === 1, `${posts} requests`);
    assert((await ryanSeat()).selfPaid === true, 'paid once');
    await row(a.page).getByRole('button', { name: "Didn't pay?" }).click();
    await a.page.locator('section.pay-card').waitFor({ timeout: 8000 });
    await a.ctx.close();
  });
  await check('tapping Pay on either card moves no money (the organizer\'s books are as before)', async () => {
    const a = await open('Ryan', { query: '/?playerfix1=on' });
    const snap = await moneyNow();
    await a.page.locator('section.pay-card').getByRole('link', { name: /Pay \$14 with Venmo/ }).click();
    await a.page.waitForTimeout(300);
    await row(a.page).locator('a.pay-btn:not(.m-ghost)').click();
    await a.page.waitForTimeout(300);
    assert((await moneyNow()) === snap, 'a Pay tap moved money');
    await a.ctx.close();
  });

  /* ---------------- someone with credit: Use credit and I paid on both ---------------- */
  await check('credit that arrived after sign-up: Use credit on tonight\'s card pays it, the top card goes away; Pay on the top card reveals I paid on the card too', async () => {
    // Pia signs up for tonight (owes $14), then pays for an extra game that is canceled: $14 credit arrives after she signed up.
    const extra = await ok(await post(areq, '/api/admin/sessions', { startsAt: new Date(L.at('2026-11-14T10:30:00-05:00')).toISOString(), endsAt: new Date(L.at('2026-11-14T12:30:00-05:00')).toISOString() }), 'extra game');
    await ok(await post(areq, `/api/admin/sessions/${extra.id}/booked`, {}), 'book extra');
    await w.join('Pia', S[1], 'confirmed');
    await w.join('Pia', extra.id, 'confirmed');
    await w.adminPaid('Pia', extra.id);
    await ok(await post(areq, `/api/admin/sessions/${extra.id}/decision`, { decision: 'cancel', confirm: true }), 'cancel extra');
    const a = await open('Pia', { query: '/?playerfix1=on' });
    const top = a.page.locator('section.pay-card');
    const r = row(a.page);
    await top.waitFor();
    assert((await top.locator('[data-use-credit]').count()) === 1, 'Use credit on the top card');
    assert((await r.locator('[data-use-credit]').count()) === 1, 'Use credit on tonight\'s card');
    assert((await top.getByRole('button', { name: 'I paid' }).count()) === 0 && (await r.getByRole('button', { name: 'I paid' }).count()) === 0, 'I paid waits until Pay is tapped (as always for someone with credit)');
    // Tap Pay on the top card: the card's own I paid shows too (the two stay in step).
    await top.getByRole('link', { name: /Pay \$14 with Venmo/ }).click();
    await r.getByRole('button', { name: 'I paid' }).waitFor({ timeout: 3000 });
    assert((await top.getByRole('button', { name: 'I paid' }).count()) === 1, 'I paid on the top card after Pay');
    // Use credit on tonight's card.
    await r.locator('[data-use-credit]').click();
    await top.waitFor({ state: 'detached', timeout: 8000 });
    assert(/Paid with credit/.test(await r.innerText()), `card: ${squash(await r.innerText())}`);
    const d = await dash();
    const seat = d.sessions.find((x) => x.id === S[1]).roster.find((x) => x.name === 'Pia');
    assert(seat.paymentStatus === 'paid', `server: ${JSON.stringify(seat)}`);
    await a.ctx.close();
  });

  /* ---------------- Settings: for everyone, no deploy ---------------- */
  await check('Settings > Feature switches (collapsed) has "Player screen fixes", off at ship; on shows the new look to every phone, off puts today\'s back; the activity log says so', async () => {
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
    const sw = sect.locator('[data-player-fix1-all]');
    assert(!(await sw.isChecked()), 'off at ship');
    assert(/Player screen fixes/.test(await sect.locator('[data-row="playerFix1All"]').innerText()), 'row label');
    await sw.click();
    await sect.locator('[data-row="playerFix1All"] .save-mark.saved').waitFor();
    assert((await dash()).playerFix1ForAll === true, 'saved on the server');
    let p = await open('Ryan');
    assert((await row(p.page).locator('a.pay-btn:not(.m-ghost)').count()) === 1, 'every phone has Pay on tonight\'s card');
    await p.ctx.close();
    await sw.click();
    await page.waitForTimeout(700);
    assert((await dash()).playerFix1ForAll === false, 'switched off again');
    p = await open('Ryan');
    assert((await row(p.page).locator('a.pay-btn:not(.m-ghost)').count()) === 0, 'today\'s look is back');
    await p.ctx.close();
    const act = await (await areq.get(`${BASE}/api/admin/activity`)).json();
    await ctx.close();
    const text = JSON.stringify(act.entries || []);
    assert(/player_fix1_on/.test(text) && /player_fix1_off/.test(text), 'the activity log shows the switch going on and off');
  });
  await check('a phone left open picks up the Settings switch by itself (5-second refresh)', async () => {
    const p = await open('Ryan');
    assert((await row(p.page).locator('a.pay-btn:not(.m-ghost)').count()) === 0, 'off to begin with');
    await ok(await put(areq, '/api/admin/player-fix1', { on: true }), 'on');
    await row(p.page).locator('a.pay-btn:not(.m-ghost)').waitFor({ timeout: 12000 });
    await ok(await put(areq, '/api/admin/player-fix1', { on: false }), 'off');
    await row(p.page).locator('a.pay-btn:not(.m-ghost)').waitFor({ state: 'detached', timeout: 12000 });
    await p.ctx.close();
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  await browser.close();
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
