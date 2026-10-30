/* Round 2 of the player-screen redesign, on a phone at 360, 375, 390 and 430 px,
 * light and dark, fake group, fake clock (Mon Nov 2, 9:00 AM Eastern):
 *   - compact two-column LATER rows and compact joined / owing states in every tier
 *     (joining adds about one line, not three), calendar icon at the end of the status line
 *   - no refund line on the card after a drop; the credit chip counts up
 *   - the pickleball spins in when someone joins
 *   - one pop-up banner at the bottom of the screen (above sheets), timings, tap to dismiss
 *   - "Request cash out from Alex" in the credit sheet
 *
 *   node e2e/round2.cjs      (also run by npm run test:e2e)
 */
const { spawn } = require('node:child_process');
const { rmSync, mkdirSync } = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const PORT = 5232;
const BASE = `http://localhost:${PORT}`;
const SETUP_TOKEN = 'round2-setup-token-0123456789';
const PIN = '482913';
const NAMES = ['Alex', 'Ryan', 'Julian', 'Nathan', 'Mitchel', 'Brandon', 'Sam', 'Blair', 'Emery'];
const WIDTHS = [360, 375, 390, 430];
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
  const dbFile = path.join(ROOT, '.data', 'round2.sqlite');
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
  await fetch(`${BASE}/__dev/clock`, { method: 'POST', body: JSON.stringify({ atMs: Date.parse('2026-11-02T09:00:00-05:00') }) });

  const browser = await chromium.launch();
  const post = (req, url, data) => req.post(BASE + url, { data, headers: { Origin: BASE } });
  const setup = (await browser.newContext()).request;
  const made = await post(setup, '/api/setup', {
    setupToken: SETUP_TOKEN,
    groupName: 'Pickleball Bros',
    pin: PIN,
    venmoUrl: 'https://venmo.com/u/organizer',
    players: NAMES.map((name, i) => ({ name, phone: `24855502${String(i).padStart(2, '0')}` })),
  });
  if (!made.ok()) throw new Error(`setup failed: ${await made.text()}`);
  const areq = (await browser.newContext()).request;
  await post(areq, '/api/admin/login', { pin: PIN });
  let d = await (await areq.get(`${BASE}/api/admin/dashboard`)).json();
  for (const h of d.hiddenSessions || []) await post(areq, `/api/admin/sessions/${h.id}/show`, { shown: true });
  d = await (await areq.get(`${BASE}/api/admin/dashboard`)).json();
  const games = d.sessions.filter((s) => !s.state.flags.past);
  for (const s of games) await post(areq, `/api/admin/sessions/${s.id}/booked`, {});
  const idOf = (n) => d.players.find((p) => p.name === n).id;
  const who = {};
  for (const n of NAMES) {
    const c = await browser.newContext();
    await post(c.request, '/api/me', { playerId: idOf(n) });
    who[n] = c.request;
  }
  const join = (n, i) => post(who[n], `/api/sessions/${games[i].id}/join`, {});
  // Some company on a few games, so names and balls show.
  for (const [i, k] of [[0, 3], [1, 2], [2, 1], [3, 5], [4, 1], [6, 2]]) for (const n of ['Nathan', 'Mitchel', 'Brandon', 'Blair', 'Emery'].slice(0, k)) await join(n, i);
  // Ryan: owing on 0 (this week), 2 (next week), 4 (later); paid himself on 3 (next week) and 6 (later).
  for (const i of [0, 2, 4, 3, 6]) await join('Ryan', i);
  for (const i of [3, 6]) await post(who.Ryan, `/api/sessions/${games[i].id}/paid`, { paid: true });

  const phone = (width, colorScheme, extra = {}) => ({ viewport: { width, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme, userAgent: UA, ...extra });
  async function open(name, width, scheme, extra) {
    const ctx = await browser.newContext(phone(width, scheme, extra));
    await post(ctx.request, '/api/me', { playerId: idOf(name) });
    const page = await ctx.newPage();
    await page.goto(BASE);
    await page.locator('.schedule article').first().waitFor();
    const more = page.getByRole('button', { name: /^More sessions/ });
    if (await more.count()) await more.click();
    return { ctx, page };
  }

  /** Visible boxes of the parts of a card, to check nothing overlaps or leaks out. */
  const cardFacts = (page) =>
    page.evaluate(() =>
      [...document.querySelectorAll('.schedule article')].map((a) => {
        const box = a.getBoundingClientRect();
        const rect = (el) => {
          const r = el.getBoundingClientRect();
          return { l: r.left, r: r.right, t: r.top, b: r.bottom, w: r.width, h: r.height };
        };
        const parts = [...a.querySelectorAll('.sched-status, .in-line, .names-line, .waitlist-line, .pchip, .btn, .sched-links .quiet-link, .inline-links .quiet-link, .credit-note, .sched-sub')]
          .filter((e) => e.getBoundingClientRect().width > 0)
          .map((e) => ({ name: (e.className + ' ' + e.textContent.trim()).slice(0, 40), ...rect(e) }));
        const filled = [...a.querySelectorAll('.btn')].filter((b) => !b.classList.contains('outline') && b.getBoundingClientRect().width > 0).length;
        const small = [...a.querySelectorAll('.btn, .quiet-link, .cal-icon-link')]
          .filter((e) => e.getBoundingClientRect().width > 0)
          .map((e) => {
            const bf = getComputedStyle(e, '::before');
            const extra = bf.content !== 'none' && bf.position === 'absolute' ? parseFloat(bf.height) || 0 : 0;
            return [e.textContent.trim() || e.getAttribute('aria-label'), Math.max(e.getBoundingClientRect().height, extra)];
          })
          .filter(([, h]) => h < 43.5);
        const cal = a.querySelector('.cal-icon-link');
        const head = a.querySelector('.sched-head');
        const status = a.querySelector('.sched-status');
        return {
          tier: a.dataset.tier,
          mine: !!a.dataset.mine,
          h: box.height,
          box: rect(a),
          parts,
          filled,
          small,
          cal: cal ? rect(cal) : null,
          calInLinks: !!a.querySelector('.sched-links .cal-icon-link, .inline-links .cal-icon-link'),
          head: head ? rect(head) : null,
          status: status ? rect(status) : null,
          money: (a.querySelector('.sched-money') || { innerText: '' }).innerText.replace(/\s+/g, ' ').trim(),
          overflowX: a.scrollWidth > a.clientWidth + 1,
        };
      }),
    );

  for (const width of WIDTHS) {
    for (const scheme of ['light', 'dark']) {
      await check(`${width}px ${scheme}: compact cards in every tier, nothing overlaps or leaks, taps are 44px, one filled button per card`, async () => {
        const { ctx, page } = await open('Ryan', width, scheme);
        const facts = await cardFacts(page);
        assert(facts.length >= 8, `only ${facts.length} cards`);
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'the page scrolls sideways');
        for (const c of facts) {
          const where = `${c.tier}${c.mine ? ' joined' : ''} "${c.money}"`;
          assert(c.box.r <= width + 0.5 && c.box.l >= -0.5, `${where}: card off screen`);
          for (const p of c.parts) assert(p.r <= c.box.r + 1 && p.l >= c.box.l - 1 && p.b <= c.box.b + 1, `${where}: "${p.name}" leaks out of the card`);
          for (let i = 0; i < c.parts.length; i++)
            for (let j = i + 1; j < c.parts.length; j++) {
              const a = c.parts[i];
              const b = c.parts[j];
              const x = Math.min(a.r, b.r) - Math.max(a.l, b.l);
              const y = Math.min(a.b, b.b) - Math.max(a.t, b.t);
              assert(!(x > 1 && y > 1), `${where}: "${a.name}" overlaps "${b.name}"`);
            }
          assert(c.filled <= 1, `${where}: ${c.filled} filled buttons`);
          assert(c.small.length === 0, `${where}: small taps ${JSON.stringify(c.small)}`);
        }
        // Heights at the targets (a little room for a wrapped names line).
        const tall = (tier, joined, text) => facts.filter((c) => c.tier === tier && c.mine === joined && (!text || text.test(c.money)));
        const max = (list) => Math.max(...list.map((c) => c.h));
        const limits = [
          ['this', true, /due/, 250, 'THIS WEEK joined and owing'],
          ['next', true, /Paid/, 205, 'NEXT WEEK joined and paid'],
          ['next', true, /due/, 215, 'NEXT WEEK joined and owing'],
          ['later', true, /due/, 140, 'LATER joined and owing'],
          ['later', true, /Paid/, 135, 'LATER joined and paid'],
          ['later', false, null, 112, 'LATER not joined'],
        ];
        for (const [tier, joined, text, limit, label] of limits) {
          const list = tall(tier, joined, text);
          assert(list.length > 0, `no card for ${label}`);
          assert(max(list) <= limit, `${label} is ${max(list)}px tall (limit ${limit})`);
        }
        // The calendar icon: at the right end of the status line on joined cards only, never on the links line.
        for (const c of facts) {
          if (!c.mine) assert(!c.cal, `${c.tier}: a not-joined card shows the calendar icon`);
          else {
            assert(c.cal && !c.calInLinks, `${c.tier}: joined card needs the calendar icon at the end of the status line`);
            assert(c.cal.l >= c.status.r - 2 && c.cal.r <= c.box.r + 1, `${c.tier}: calendar icon is not right of the status text`);
            assert(Math.abs((c.cal.t + c.cal.b) / 2 - (c.status.t + c.status.b) / 2) <= 14, `${c.tier}: calendar icon is not on the status line`);
          }
        }
        // Chip and button share a line wherever both are on the right or in the card body.
        for (const c of facts.filter((x) => x.mine && /due/.test(x.money))) {
          const chip = c.parts.find((p) => p.name.includes('pchip'));
          const pay = c.parts.find((p) => /^btn/.test(p.name));
          assert(chip && pay && Math.abs((chip.t + chip.b) / 2 - (pay.t + pay.b) / 2) < 24 || c.tier === 'later', `${c.tier}: the amber chip and the button are not side by side`);
        }
        await page.screenshot({ path: path.join(__dirname, 'screenshots', `round2-${width}-${scheme}.png`), fullPage: true });
        await ctx.close();
      });
    }
  }

  await check('joining does not make a card jump: each card in its not-joined state, tap I\'m in, the height grows by about one line', async () => {
    for (const width of [360, 390]) {
      const { ctx, page } = await open('Sam', width, 'light');
      const cards = await page.locator('.schedule article').count();
      for (const idx of [1, 4, 5]) {
        // 1: this week, 4/5: later (the card list is stable: Sam has joined nothing yet).
        const card = page.locator('.schedule article').nth(idx);
        if (!(await card.getByRole('button', { name: "I'm in" }).count())) continue;
        const tier = await card.getAttribute('data-tier');
        const before = (await card.boundingBox()).height;
        await card.getByRole('button', { name: "I'm in" }).click();
        await card.locator('.tile-check').waitFor();
        await page.waitForTimeout(600);
        const after = (await page.locator('.schedule article').nth(idx).boundingBox()).height;
        const limit = tier === 'later' ? 48 : 62;
        assert(after - before <= limit, `${width}px ${tier}: joining grew the card ${after - before}px (${before} to ${after}), limit ${limit}`);
      }
      assert(cards >= 6, 'cards');
      await ctx.close();
    }
  });
  await check('Next week and this week: take the not-joined card to joined, then a NEXT WEEK one too', async () => {
    const { ctx, page } = await open('Sam', 390, 'light');
    const card = page.locator('.schedule article[data-tier="next"]').first();
    const before = (await card.boundingBox()).height;
    await card.getByRole('button', { name: "I'm in" }).click();
    await card.locator('.tile-check').waitFor();
    await page.waitForTimeout(600);
    const after = (await card.boundingBox()).height;
    assert(after - before <= 62, `NEXT WEEK grew ${after - before}px`);
    await ctx.close();
  });

  await check('a game that was paid and dropped: no refund line on the card, the chip appears and counts up to $14 without changing width, then pulses', async () => {
    const { ctx, page } = await open('Julian', 390, 'light');
    const card = page.locator('.schedule article').nth(1);
    assert((await page.locator('[data-credit-chip]').count()) === 0, 'Julian should start with no credit chip');
    await card.getByRole('button', { name: "I'm in" }).click();
    await card.locator('.tile-check').waitFor();
    await card.getByRole('button', { name: 'I paid' }).first().click();
    await card.locator('.paid-tag').waitFor();
    await card.getByRole('button', { name: 'Drop out' }).click();
    await page.locator('dialog[open]').getByRole('button', { name: 'Drop out' }).click();
    const chip = page.locator('header [data-credit-chip]');
    await chip.waitFor();
    const seen = [];
    const widths = new Set();
    let pulsed = false;
    for (let i = 0; i < 40; i++) {
      seen.push(squash(await chip.locator('.cc-amount').innerText()));
      widths.add(await chip.evaluate((el) => el.offsetWidth));
      if (await chip.evaluate((el) => el.classList.contains('pulse'))) pulsed = true;
      if (seen[seen.length - 1] === '$14' && pulsed) break;
      await page.waitForTimeout(40);
    }
    const nums = seen.map((t) => Number(t.replace('$', '')));
    assert(nums.every((n, i) => i === 0 || n >= nums[i - 1]), `chip went backwards: ${seen}`);
    assert(seen[seen.length - 1] === '$14', `chip ended at ${seen[seen.length - 1]}`);
    assert(nums[0] < 14 || seen.length > 1, `chip never counted up: ${seen}`);
    assert(widths.size === 1, `chip changed width while counting: ${[...widths]}`);
    assert(pulsed, 'chip did not pulse when the count ended');
    assert((await page.locator('[data-credit-back]').count()) === 0, 'the "Your $14 is now credit. Request refund" line is gone');
    assert(!/Request refund|is now credit\. /.test(await card.innerText()), `card text: ${await card.innerText()}`);
    await ctx.close();
  });
  await check('reduce motion: the credit chip shows the new number straight away, balls do not animate', async () => {
    const { ctx, page } = await open('Blair', 390, 'light', { reducedMotion: 'reduce' });
    const card = page.locator('.schedule article').nth(1);
    await card.getByRole('button', { name: "I'm in" }).click();
    await card.locator('.tile-check').waitFor();
    await card.getByRole('button', { name: 'I paid' }).first().click();
    await card.locator('.paid-tag').waitFor();
    await card.getByRole('button', { name: 'Drop out' }).click();
    await page.locator('dialog[open]').getByRole('button', { name: 'Drop out' }).click();
    const chip = page.locator('header [data-credit-chip]');
    await chip.waitFor();
    assert(squash(await chip.locator('.cc-amount').innerText()) === '$14', `chip showed ${await chip.locator('.cc-amount').innerText()}`);
    await ctx.close();
  });

  await check('a pickleball spins in when someone joins (only the new one), and not on page load; reduce motion turns it off', async () => {
    const { ctx, page } = await open('Mitchel', 390, 'light');
    assert((await page.locator('.ball.ball-new').count()) === 0, 'balls animate on first load');
    const card = page.locator('.schedule article').nth(5);
    const before = await card.locator('.ball').count();
    await card.getByRole('button', { name: "I'm in" }).click();
    await card.locator('.tile-check').waitFor();
    await card.locator('.ball.ball-new').first().waitFor();
    assert((await card.locator('.ball.ball-new').count()) === 1 && (await card.locator('.ball').count()) === before + 1, 'exactly one new ball');
    const anim = await card.locator('.ball.ball-new').evaluate((el) => ({ name: getComputedStyle(el).animationName, dur: getComputedStyle(el).animationDuration }));
    assert(anim.name === 'ball-spin-in' && parseFloat(anim.dur) >= 0.4 && parseFloat(anim.dur) <= 0.5, `animation ${JSON.stringify(anim)}`);
    await ctx.close();
    const rm = await open('Emery', 390, 'light', { reducedMotion: 'reduce' });
    const c2 = rm.page.locator('.schedule article').nth(5);
    await c2.getByRole('button', { name: "I'm in" }).click();
    await c2.locator('.tile-check').waitFor();
    await rm.page.waitForTimeout(200);
    const name = await c2.locator('.ball').last().evaluate((el) => getComputedStyle(el).animationName);
    assert(name === 'none', `reduce motion still animates: ${name}`);
    await rm.ctx.close();
  });

  await check('one banner for every pop-up: bottom center above the Safari bar, a check icon, stays about 1.5 s then goes, tap closes it early, a new message replaces the old one', async () => {
    const { ctx, page } = await open('Brandon', 390, 'light');
    const card = page.locator('.schedule article').nth(4);
    await card.getByRole('button', { name: "I'm in" }).click();
    const pop = page.locator('.pop');
    await pop.waitFor();
    assert(squash(await pop.innerText()) === "You're in", `banner said "${await pop.innerText()}"`);
    const info = await pop.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { l: r.left, r: r.right, b: r.bottom, w: r.width, vw: innerWidth, vh: innerHeight, pos: getComputedStyle(el).position, open: el.matches(':popover-open'), icon: !!el.querySelector('.toast-icon svg') };
    });
    assert(info.pos === 'fixed' && info.open && info.icon, JSON.stringify(info));
    assert(Math.abs((info.l + info.r) / 2 - info.vw / 2) < 3 && info.w <= 342, `banner is not centered or too wide: ${JSON.stringify(info)}`);
    assert(info.vh - info.b >= 85 && info.vh - info.b <= 125, `banner is ${info.vh - info.b}px above the bottom`);
    const t0 = Date.now();
    await page.waitForTimeout(900);
    assert((await page.locator('.pop').count()) === 1, 'banner left too early');
    await pop.waitFor({ state: 'detached', timeout: 3000 });
    const gone = Date.now() - t0;
    assert(gone >= 1500 && gone <= 2700, `banner was on screen about ${gone} ms`);
    // Tap to dismiss.
    await card.getByRole('button', { name: 'Drop out' }).click();
    await page.locator('dialog[open]').getByRole('button', { name: 'Drop out' }).click();
    await page.locator('.pop').waitFor();
    await page.locator('.pop').click();
    await page.locator('.pop').waitFor({ state: 'detached', timeout: 900 });
    // A new message replaces the old one.
    await card.getByRole('button', { name: "I'm in" }).click();
    await page.locator('.pop').waitFor();
    await card.locator('.tile-check').waitFor();
    await card.getByRole('button', { name: 'Drop out' }).click();
    await page.locator('dialog[open]').getByRole('button', { name: 'Drop out' }).click();
    await page.locator('.pop', { hasText: "You're out" }).waitFor();
    assert((await page.locator('.pop').count()) === 1, 'two banners at once');
    await ctx.close();
  });
  await check('the banner shows above an open sheet (the credit sheet), and an error banner reads as one', async () => {
    const { ctx, page } = await open('Julian', 390, 'light');
    await page.locator('header [data-credit-chip]').click();
    const sheet = page.locator('[data-credit-sheet]');
    await sheet.waitFor();
    // The sheet is for credit: ask for a $5 cash out; the confirmation banner shows above the sheet.
    await sheet.locator('[data-request-refund]').click();
    await page.getByLabel('Cash out amount').fill('5');
    await sheet.getByRole('button', { name: /^Request cash out from Alex$/ }).click();
    const pop = page.locator('.pop');
    await pop.waitFor();
    assert(squash(await pop.innerText()) === 'Cash out requested', `banner said ${await pop.innerText()}`);
    const topLayer = await pop.evaluate((el) => el.matches(':popover-open'));
    assert(topLayer, 'the banner is not in the top layer, so a sheet could cover it');
    await page.screenshot({ path: path.join(__dirname, 'screenshots', 'round2-banner-over-sheet.png') });
    const pending = await sheet.locator('[data-refund-pending]').innerText();
    assert(/Cash out requested: \$5, pending/.test(squash(pending)), pending);
    await ctx.close();
  });
  await check('banner timings live in one place at the top of the code, and reduce motion fades only', async () => {
    const { ctx, page } = await open('Nathan', 390, 'light', { reducedMotion: 'reduce' });
    const card = page.locator('.schedule article').nth(5);
    await card.getByRole('button', { name: "I'm in" }).click();
    const pop = page.locator('.pop');
    await pop.waitFor();
    const a = await pop.evaluate((el) => getComputedStyle(el).animationName);
    assert(a === 'banner-fade-in', `reduce-motion animation: ${a}`);
    await ctx.close();
    const src = require('node:fs').readFileSync(path.join(ROOT, 'src', 'ui.tsx'), 'utf8');
    assert(/export const BANNER_TIMING = \{[\s\S]*fadeIn[\s\S]*stay[\s\S]*out[\s\S]*\}/.test(src), 'BANNER_TIMING missing');
  });
  await check('the credit sheet says "Request cash out from Alex" and no player wording says refund', async () => {
    const { ctx, page } = await open('Blair', 390, 'light');
    await page.locator('header [data-credit-chip]').click();
    const sheet = page.locator('[data-credit-sheet]');
    await sheet.waitFor();
    const t = squash(await sheet.innerText());
    assert(/Request cash out from Alex/.test(t), t);
    assert(!/refund/i.test(t), `refund word in the sheet: ${t}`);
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
