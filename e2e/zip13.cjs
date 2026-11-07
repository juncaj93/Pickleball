/* Zip 13: Players redo (PLAYERS_REDO), Swap to Alex (SWAP_BUTTON), Undo on admin toasts (ADMIN_UNDO), and the projected costs fix.
 *
 *   node e2e/zip13.cjs      (also run by npm run test:e2e)
 *
 * Fake preview world (the three Zip 13 rows are on from the seed), its own dev server; nothing touches Cloudflare or the live site.
 * Undo: for every action that has it, the database is read in full before the tap and after Undo (+ the 5 seconds), and must be byte for
 * byte the same, with no request for that action ever sent.
 */
const { spawn, spawnSync } = require('node:child_process');
const { readFileSync, mkdirSync, rmSync } = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.E2E_PORT) || 5415;
const BASE = `http://localhost:${PORT}`;
const NOW_ISO = '2026-11-07T17:00:00.000Z';
const NOW_MS = Date.parse(NOW_ISO);
const SHOTS = process.env.E2E_SHOTS || path.join(__dirname, 'screenshots');
const PIN = /PIN `(\d{6})`/.exec(readFileSync(path.join(ROOT, 'docs/PREVIEW_FAKE_DB.md'), 'utf8'))[1];
const RO_PIN = '86420975';

let passed = 0;
let failed = 0;
async function check(name, fn) {
  if (process.env.E2E_ONLY && !new RegExp(process.env.E2E_ONLY).test(name)) return;
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  mkdirSync(SHOTS, { recursive: true });
  const dbFile = path.join(ROOT, '.data', 'zip13.sqlite');
  mkdirSync(path.join(ROOT, '.data'), { recursive: true });
  rmSync(dbFile, { force: true });
  const seeded = spawnSync('npx', ['vite-node', 'scripts/load-seed-local.ts', '--', dbFile, NOW_ISO], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, SEED_ZIP13: '1' } });
  if (seeded.status !== 0) throw new Error(`could not build the fake world: ${seeded.stderr || seeded.stdout}`);
  const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
    cwd: ROOT,
    env: { ...process.env, DEV_DB: dbFile, SETUP_TOKEN: 'zip13-setup-token-0123456789', DEV_CLOCK: '1', ORGANIZER_READONLY_PIN: RO_PIN },
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
  await fetch(`${BASE}/__dev/clock`, { method: 'POST', body: JSON.stringify({ atMs: NOW_MS }) });
  const browser = await chromium.launch();
  const post = (req, url, data, headers = {}) => req.post(BASE + url, { data, headers: { Origin: BASE, ...headers } });
  const real = (await browser.newContext()).request;
  if (!(await post(real, '/api/admin/login', { pin: PIN })).ok()) throw new Error('login failed');
  const dash = async () => (await real.get(`${BASE}/api/admin/dashboard`)).json();
  // The whole database as the backup file has it, minus what reading itself touches (sign-ins, rate counters, phones' picks).
  const snapshot = async () => {
    const b = await (await real.get(`${BASE}/api/admin/backup`)).json();
    const t = { ...b.tables };
    for (const k of ['admin_sessions', 'login_attempts', 'rate_events', 'player_devices']) delete t[k];
    return JSON.stringify(t);
  };
  const d0 = await dash();
  assert(d0.playersRedo === true && d0.swapButton === true && d0.adminUndo === true, 'the seed should have the three Zip 13 rows on');
  const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
  const phone = (width, scheme) => ({ viewport: { width, height: 900 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, colorScheme: scheme, userAgent: UA, reducedMotion: 'reduce' });
  async function openAdmin(width = 390, scheme = 'light', opts = {}) {
    const ctx = await browser.newContext(phone(width, scheme));
    await ctx.addInitScript((delta) => {
      const Real = Date;
      class Shifted extends Real {
        constructor(...x) {
          if (x.length === 0) super(Real.now() + delta);
          else super(...x);
        }
        static now() {
          return Real.now() + delta;
        }
      }
      window.Date = Shifted;
    }, NOW_MS - Date.now());
    await ctx.route('https://venmo.com/**', (r) => r.abort());
    if (!(await post(ctx.request, '/api/admin/login', { pin: opts.pin ?? PIN })).ok()) throw new Error('login');
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    if (process.env.E2E_DEBUG) page.on('console', (m) => /HOLDFIRE/.test(m.text()) && console.log('      ' + m.text().slice(0, 600)));
    const sent = [];
    page.on('request', (r) => r.method() !== 'GET' && r.url().includes('/api/') && sent.push(`${r.method()} ${new URL(r.url()).pathname}`));
    await page.goto(BASE + (opts.url ?? '/admin'));
    await page.locator('.tabbar').waitFor();
    return { ctx, page, errors, sent };
  }
  const tab = async (page, name) => {
    await page.locator('.tabbar button', { hasText: name }).click();
    await page.waitForTimeout(400);
  };
  const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, `zip13-${name}.png`) });

  // ================================================================ 1 Players redo
  for (const scheme of ['light', 'dark']) {
    for (const width of [390, 360, 320]) {
      await check(`Players list ${width} px ${scheme}: one card, every row 46 px and one line, no arrows or gears, chips never wrap, small Add a person`, async () => {
        const { ctx, page, errors } = await openAdmin(width, scheme);
        await tab(page, 'Players');
        await page.locator('[data-players-redo]').waitFor();
        const m = await page.evaluate(() => {
          const rows = [...document.querySelectorAll('.pr-row')].map((r) => {
            const box = r.getBoundingClientRect();
            const kids = [...r.children].map((c) => c.getBoundingClientRect());
            const name = r.querySelector('.pr-name');
            return {
              h: box.height,
              lines: new Set(kids.filter((k) => k.width > 0).map((k) => Math.round(k.top + k.height / 2))).size,
              over: kids.some((k) => k.right > box.right + 0.5),
              nameCut: name.scrollWidth > name.clientWidth + 1,
              chips: r.querySelectorAll('.pr-chip').length,
              colored: r.querySelectorAll('.pr-chip:not(.pr-more)').length,
            };
          });
          const add = document.querySelector('[data-pr-add]').getBoundingClientRect();
          return {
            rows,
            month: document.querySelector('[data-pr-month]').innerText,
            gears: document.querySelectorAll('.pr-list svg:not(.pr-cal), .pr-list .r3-gear').length,
            add: add.height,
            pageOver: document.documentElement.scrollWidth > window.innerWidth,
          };
        });
        assert(m.month === 'NOV 2026', `month label ${m.month}`);
        assert(m.rows.length >= 10, `rows ${m.rows.length}`);
        for (const r of m.rows) {
          assert(Math.abs(r.h - 46) < 0.6, `row height ${r.h}`);
          assert(r.lines === 1, 'a row on one line');
          assert(!r.over, 'nothing past the row');
          assert(r.colored <= 1 && r.chips <= 2, 'at most one colored chip and one +N');
        }
        assert(m.gears === 0, 'no arrows or gears in the list');
        assert(Math.abs(m.add - 44) < 1, `Add a person is 44 px (${m.add})`);
        assert(!m.pageOver, 'no sideways scroll');
        assert(errors.length === 0, errors.join('; '));
        await shot(page, `players-${width}-${scheme}`);
        await ctx.close();
      });
    }
  }

  await check('Players list: chip priority Owes > Held > Credit with +N, "N played" is this month, days of this and next week, cash out not on the list', async () => {
    const d = await dash();
    const { ctx, page } = await openAdmin();
    await tab(page, 'Players');
    const rows = await page.evaluate(() =>
      [...document.querySelectorAll('.pr-row')].map((r) => ({
        name: r.getAttribute('data-pr-row'),
        sub: r.querySelector('[data-pr-sub]').innerText,
        chip: r.querySelector('[data-pr-chip]')?.getAttribute('data-pr-chip') ?? null,
        chipText: r.querySelector('[data-pr-chip]')?.innerText ?? '',
        more: r.querySelector('[data-pr-more]')?.innerText ?? '',
      })),
    );
    for (const r of rows) {
      const p = d.players.find((x) => x.name === r.name);
      assert(r.sub.startsWith(`${p.monthPlayed} played`) || r.sub.startsWith(`Hidden · ${p.monthPlayed} played`), `${r.name}: ${r.sub} vs ${p.monthPlayed}`);
      assert(!/Next|,/.test(r.sub), `${r.name}: no "Next" and no commas (${r.sub})`);
      assert(!/cash|refund/i.test(r.chipText + r.more), 'cash out is not on the list');
    }
    const orla = rows.find((r) => r.name === d.players.find((p) => p.id === d.me.id).name);
    assert(orla && orla.chip === null, 'the organizer has no money chip');
    assert(rows.some((r) => r.chip === 'owes' && r.more), 'an Owes chip with +N');
    assert(rows.some((r) => r.chip === 'held'), 'a Held chip');
    assert(rows.some((r) => r.chip === 'credit'), 'a Credit chip');
    assert(rows.every((r) => !r.chip || /^(Owes|Held|Credit) \$\d/.test(r.chipText)), 'short chip words');
    await ctx.close();
  });

  await check('details sheet: tap a row, a bottom sheet (no new screen) with the name, a pencil, NOV 2026 / MONEY / ALL TIME; tap outside closes it', async () => {
    const { ctx, page } = await openAdmin();
    await tab(page, 'Players');
    await page.locator('[data-pr-row="Avery"]').click();
    const dlg = page.locator('dialog.pr-sheet[open]');
    await dlg.waitFor();
    await dlg.locator('[data-pr-kv="month-spent"] b').filter({ hasText: '$' }).waitFor();
    const m = await dlg.evaluate((el) => {
      const h2 = el.querySelector('.sheet-head h2').getBoundingClientRect();
      const pen = el.querySelector('[data-pr-edit]').getBoundingClientRect();
      const x = el.querySelector('.sheet-head [aria-label="Close"]').getBoundingClientRect();
      const head = el.querySelector('.sheet-head').getBoundingClientRect();
      return {
      // Alex, Nov 7: the pencil in a small circle right next to the name; the ✕ alone at the top right, like the edit sheet.
      penNextToName: pen.left - h2.right >= 0 && pen.left - h2.right <= 16 && Math.abs(pen.top + pen.height / 2 - (h2.top + h2.height / 2)) < 6 && pen.width <= 34,
      closeRight: head.right - x.right < 20 && x.left - pen.right > 40,
      title: el.querySelector('.sheet-head h2').innerText,
      close: el.querySelectorAll('.sheet-head [aria-label="Close"]').length,
      pen: !!el.querySelector('[data-pr-edit]'),
      cards: [...el.querySelectorAll('[data-pr-card] h4')].map((h) => h.innerText),
      money: [...el.querySelectorAll('[data-pr-card="money"] .pr-kv span')].map((s) => s.innerText),
      };
    });
    assert(m.title === 'Avery' && m.pen && m.close === 1, JSON.stringify(m));
    assert(m.penNextToName && m.closeRight, `pencil next to the name, ✕ alone on the right: ${JSON.stringify(m)}`);
    assert(m.cards.join('|') === 'NOV 2026|MONEY|ALL TIME', m.cards.join('|'));
    assert(m.money.slice(0, 3).join('|') === 'Owes|Held for a game|Credit', m.money.join('|'));
    assert(page.url().endsWith('/admin'), 'still the same screen');
    await shot(page, 'details');
    await page.mouse.click(200, 20);
    await page.waitForTimeout(500);
    assert((await page.locator('dialog.pr-sheet[open]').count()) === 0, 'tap outside closes');
    // A pending cash out shows on the details sheet only.
    const d = await dash();
    const rr = d.refundRequests[0];
    if (rr) {
      await page.locator(`[data-pr-row="${rr.name}"]`).click();
      await page.locator('dialog.pr-sheet[open] [data-pr-kv="cash-out"]').waitFor();
      await page.keyboard.press('Escape');
    }
    await ctx.close();
  });

  await check('edit sheet: the pencil opens "Edit Avery" with ✕: Name, Phone, Venmo, the note, Hide from the name list, Save; no Plays or Usual days; Adjust credit, Hide player, Remove from list kept below Save in the same order', async () => {
    const { ctx, page } = await openAdmin();
    await tab(page, 'Players');
    await page.locator('[data-pr-row="Avery"]').click();
    await page.locator('[data-pr-edit]').click();
    const dlg = page.locator('dialog.pr-edit-sheet[open]');
    await dlg.waitFor();
    const m = await dlg.evaluate((el) => ({
      title: el.querySelector('.sheet-head h2').innerText,
      close: el.querySelectorAll('.sheet-head [aria-label="Close"]').length,
      text: el.innerText,
      order: [...el.querySelector('form').children].map((c) => (c.matches('[data-adjust-credit-row]') ? 'adjust' : c.matches('[data-hide-player]') ? 'hide' : c.matches('button[type="submit"]') ? 'save' : c.matches('.btn.danger') ? 'remove' : '')).filter(Boolean),
    }));
    assert(m.title === 'Edit Avery' && m.close === 1, `${m.title} ${m.close}`);
    for (const w of ['Name', 'Phone (optional)', 'Venmo link or @name (optional)', 'For refunds. Only you see this.', 'Hide from the name list']) assert(m.text.includes(w), `has ${w}`);
    assert(!/Plays|Usual days|Regular|Occasional/.test(m.text), 'no Plays or Usual days');
    assert(m.order.join(',') === 'save,adjust,hide,remove', m.order.join(','));
    await shot(page, 'edit');
    // Save keeps the old Plays and Usual days as they were.
    const before = (await dash()).players.find((p) => p.name === 'Avery');
    await dlg.locator('input[type="tel"]').fill('(313) 555-0177');
    await dlg.locator('button[type="submit"]').click();
    await page.waitForTimeout(1200);
    const after = (await dash()).players.find((p) => p.name === 'Avery');
    assert(after.phone !== before.phone && after.isRegular === before.isRegular && JSON.stringify(after.usualDays) === JSON.stringify(before.usualDays), 'phone saved, Plays and days unchanged');
    await post(real, '/api/admin/players/' + after.id, {}, {}).catch(() => {});
    await real.put(`${BASE}/api/admin/players/${after.id}`, { data: { name: before.name, phone: before.phone, isRegular: before.isRegular, isActive: before.isActive, canReceiveSubstituteInvites: before.canReceiveSubstituteInvites, usualDays: before.usualDays, venmo: before.venmo }, headers: { Origin: BASE } });
    await ctx.close();
  });

  await check("the organizer's own Spent (month and All time) equals Money Totals \"Your cost so far\" (one source)", async () => {
    const d = await dash();
    const sum = await (await real.get(`${BASE}/api/admin/players/${d.me.id}/summary`)).json();
    const nov = await (await real.get(`${BASE}/api/admin/money?month=2026-11`)).json();
    assert(sum.organizer === true && sum.month.spentCents === nov.rework.yourCostCents, `month ${sum.month.spentCents} vs Money ${nov.rework.yourCostCents}`);
    let all = 0;
    for (let y = 2025, m = 1; y < 2026 || (y === 2026 && m <= 11); m === 12 ? ((m = 1), y++) : m++) {
      const mm = await (await real.get(`${BASE}/api/admin/money?month=${y}-${String(m).padStart(2, '0')}`)).json();
      all += mm.rework.yourCostCents;
    }
    assert(sum.allTime.spentCents === all, `all time ${sum.allTime.spentCents} vs the months ${all}`);
    assert(sum.month.played === 2, `the organizer played 2 games this month (${sum.month.played})`);
    const { ctx, page } = await openAdmin();
    await tab(page, 'Players');
    await page.locator(`[data-pr-row="${d.players.find((p) => p.id === d.me.id).name}"]`).click();
    await page.locator('[data-pr-kv="month-spent"] b').filter({ hasText: '$' }).waitFor();
    const shown = await page.locator('[data-pr-kv="month-spent"] b').innerText();
    assert(shown === `$${nov.rework.yourCostCents / 100}`, `sheet says ${shown}`);
    await ctx.close();
  });

  // ================================================================ 2 Swap to Alex
  for (const scheme of ['light', 'dark']) {
    for (const width of [390, 360, 320]) {
      await check(`header ${width} px ${scheme}: no ORGANIZER, "Admin" + swap icon is one button, "View as", everything on one line`, async () => {
        const { ctx, page } = await openAdmin(width, scheme);
        const m = await page.evaluate(() => {
          const t = document.querySelector('[data-title-swap]');
          const r = t.getBoundingClientRect();
          const end = document.querySelector('.topbar-end').getBoundingClientRect();
          const h1 = t.querySelector('h1');
          return {
            eyebrow: document.querySelectorAll('.topbar .eyebrow').length,
            text: t.innerText.trim(),
            icon: !!t.querySelector('.swap-icon'),
            size: getComputedStyle(h1).fontSize,
            tapH: r.height,
            sameLine: Math.abs(r.top + r.height / 2 - (end.top + end.height / 2)) < 12,
            noOverlap: r.right <= end.left + 1,
            viewAs: [...document.querySelectorAll('.topbar-btn')].map((b) => b.innerText.trim()),
          };
        });
        assert(m.eyebrow === 0, 'no ORGANIZER label');
        assert(m.text === 'Admin' && m.icon, m.text);
        // The site's own title size (it steps down a little on narrow phones, the player page's name too).
        assert(parseFloat(m.size) >= 19 && parseFloat(m.size) <= 25, m.size);
        assert(m.tapH >= 44, 'one 44 px tap target');
        assert(m.sameLine && m.noOverlap, 'one line, no overlap');
        assert(m.viewAs.includes('View as'), m.viewAs.join('|'));
        await page.screenshot({ path: path.join(SHOTS, `zip13-header-${width}-${scheme}.png`), clip: { x: 0, y: 0, width, height: 110 } });
        await ctx.close();
      });
    }
  }

  for (const scheme of ['light', 'dark']) {
    await check(`swap ${scheme}: Admin goes to your own player page, "Go to Admin" (30 px, 13 px gray, 1 px line, the same gap as More sessions) comes back; no new sign-in`, async () => {
      const { ctx, page, sent } = await openAdmin(390, scheme);
      const d = await dash();
      await post(ctx.request, '/api/me', { playerId: d.me.id });
      await page.locator('[data-title-swap]').click();
      await page.locator('[data-go-admin]').waitFor();
      assert(/\/g\//.test(page.url()), page.url());
      const me = await page.locator('.topbar h1').innerText();
      assert(me === d.players.find((p) => p.id === d.me.id).name, `the player page shows ${me}`);
      await page.locator('[data-go-admin]').scrollIntoViewIfNeeded();
      const m = await page.evaluate(() => {
        const end = document.querySelector('.page-end');
        const pill = document.querySelector('[data-go-admin]');
        const above = end.previousElementSibling.getBoundingClientRect();
        const cs = getComputedStyle(pill);
        const p = pill.getBoundingClientRect();
        return { h: p.height, size: cs.fontSize, border: cs.borderTopWidth, bg: cs.backgroundColor, gapBelow: p.top - end.getBoundingClientRect().top, gapAbove: end.getBoundingClientRect().top - above.bottom, centered: Math.abs(p.left + p.width / 2 - window.innerWidth / 2) < 2, text: pill.innerText.trim() };
      });
      assert(Math.abs(m.h - 30) < 1 && m.size === '13px' && m.border === '1px' && /rgba\(0, 0, 0, 0\)|transparent/.test(m.bg), JSON.stringify(m));
      assert(Math.abs(m.gapBelow - m.gapAbove) < 1, `gaps ${m.gapAbove} / ${m.gapBelow}`);
      assert(m.centered && m.text === 'Go to Admin', JSON.stringify(m));
      await shot(page, `alex-${scheme}`);
      await page.locator('[data-go-admin]').click();
      await page.locator('.tabbar').waitFor();
      assert(page.url().endsWith('/admin'), page.url());
      assert(!sent.some((x) => /login|logout/.test(x)), `no sign-in or out: ${sent.join(', ')}`);
      await ctx.close();
    });
  }

  await check('View as: "Go to Admin" at the bottom of the View as page goes back to the organizer screen', async () => {
    const { ctx, page } = await openAdmin();
    await page.locator('.topbar-btn', { hasText: 'View as' }).click();
    await page.locator('dialog[open] .name-grid button', { hasText: 'Casey' }).click();
    await page.locator('[data-go-admin]').waitFor();
    await page.locator('[data-go-admin]').click();
    await page.locator('.tabbar').waitFor();
    assert((await page.locator('[data-go-admin]').count()) === 0, 'back on the organizer screen');
    await ctx.close();
  });

  await check('a player never sees the swap controls: no Go to Admin, no title button, even with the private link on their phone', async () => {
    const ctx = await browser.newContext(phone(390, 'light'));
    const d = await dash();
    await ctx.addInitScript(() => localStorage.setItem('pb_swapbutton', 'on'));
    await post(ctx.request, '/api/me', { playerId: d.players.find((p) => p.name === 'Casey').id });
    const page = await ctx.newPage();
    await page.goto(BASE + '/');
    await page.locator('.schedule article').first().waitFor();
    await page.waitForTimeout(800);
    assert((await page.locator('[data-go-admin], [data-title-swap]').count()) === 0, 'nothing for a player');
    const view = await (await ctx.request.get(`${BASE}/api/group`, { headers: { 'X-Swap-Button': 'on' } })).json();
    assert(view.goToAdmin === undefined, 'the server never says so to a player');
    // The read-only PIN helper is not the organizer on a player page either.
    const ro = await browser.newContext(phone(390, 'light'));
    await post(ro.request, '/api/admin/login', { pin: RO_PIN });
    await post(ro.request, '/api/me', { playerId: d.me.id });
    const roView = await (await ro.request.get(`${BASE}/api/group`)).json();
    assert(roView.goToAdmin === undefined, 'not for the read-only PIN');
    await ro.close();
    // Signed out: gone.
    const org = await browser.newContext(phone(390, 'light'));
    await post(org.request, '/api/admin/login', { pin: PIN });
    await post(org.request, '/api/me', { playerId: d.me.id });
    assert((await (await org.request.get(`${BASE}/api/group`)).json()).goToAdmin === true, 'the organizer gets it');
    await post(org.request, '/api/admin/logout', {});
    assert((await (await org.request.get(`${BASE}/api/group`)).json()).goToAdmin === undefined, 'gone after sign out');
    await org.close();
    await ctx.close();
  });

  // ================================================================ 3 Undo on admin toasts
  const undoCase = async (name, run, setup) =>
    check(`Undo: ${name}: the toast has Undo at once; tapping it sends nothing and the database is exactly as before`, async () => {
      if (setup) await setup();
      const { ctx, page, sent, errors } = await openAdmin();
      const before = await snapshot();
      const n0 = sent.length;
      await run(page);
      const banner = page.locator('[data-banner]').filter({ has: page.locator('.toast-action', { hasText: 'Undo' }) }).last();
      await banner.waitFor({ timeout: 3000 });
      // (A sheet that closes with the tap takes a moment; the banner then sits on the page again.)
      await page.waitForTimeout(700);
      await page.locator('[data-banner]').filter({ has: page.locator('.toast-action', { hasText: 'Undo' }) }).last().locator('.toast-action').click();
      if (process.env.E2E_DEBUG) console.log('      after Undo:', JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('[data-banner]')].map((b) => b.innerText + ' @' + b.parentElement.tagName))));
      await page.waitForTimeout(6500);
      const extra = sent.slice(n0).filter((x) => !/\/summary$/.test(x));
      assert(extra.length === 0, `sent: ${extra.join(', ')}`);
      const after = await snapshot();
      assert(after === before, 'the database changed');
      assert(errors.length === 0, errors.join('; '));
      await ctx.close();
    });
  const moneyRow = (page, name) => page.locator('article.mrw-game li').filter({ hasText: name }).filter({ has: page.getByRole('button', { name: /Mark paid/ }) }).first();
  await undoCase('Mark paid (Money)', async (page) => {
    await tab(page, 'Money');
    await moneyRow(page, 'Kai').getByRole('button', { name: /Mark paid/ }).click();
  });
  // Alex, Nov 7: Mark paid on Home (the "Who owes you" / "Mark paid tonight" card) showed no Undo; it has one now.
  await undoCase('Mark paid (Home, Who owes you / Mark paid tonight)', async (page) => {
    await page.locator('article[aria-label="Who owes you"] button, article[aria-label="Mark paid tonight"] button', { hasText: 'Mark paid' }).first().click();
  });
  await undoCase('Mark paid (Players sheet)', async (page) => {
    await tab(page, 'Players');
    await page.locator('[data-pr-row="Jordan"]').click();
    await page.locator('dialog.pr-sheet[open] .player-money button', { hasText: 'Mark paid' }).first().click();
  });
  await undoCase('Unmark (Money)', async (page) => {
    await tab(page, 'Money');
    // Every game card open, then the first paid row's Undo (Unmark).
    const cards = page.locator('article.mrw-game');
    for (let i = 0; i < (await cards.count()); i++) if ((await cards.nth(i).getAttribute('data-open')) === 'no') await cards.nth(i).locator('.mrw-toggle').click();
    await page.locator('article.mrw-game li button', { hasText: /^Undo$/ }).first().click();
  });
  await undoCase('court status Not booked to Booked', async (page) => {
    const d = await dash();
    const g = d.sessions.find((s) => !s.state.flags.canceled && s.bookingStatus !== 'booked' && Date.parse(s.startsAt) > NOW_MS);
    const card = page.locator(`article#session-${g.id}`);
    if (!(await card.count())) {
      const all = page.locator('button', { hasText: /^Show all/ });
      if (await all.count()) await all.click();
      if (!(await card.count())) await page.locator(`div#session-${g.id}`).click();
    }
    await card.locator('.court-switch [data-seg="booked"]').click();
  });
  await undoCase(
    'Finalize (Everyone played)',
    async (page) => {
      await page.locator('[data-finalize] button', { hasText: 'Everyone played' }).first().click();
    },
    // The fake world's game waiting to be finalized asks "Did you guys play?" first; answering Yes (before the snapshot) brings its Finalize card.
    async () => {
      const g = (await dash()).sessions.find((s) => s.needsFinalize);
      // ("Yes, we played", the same mark the Did you guys play? card saves.)
      await real.post(`${BASE}/api/admin/sessions/${g.id}/task-mark`, { data: { mark: 'played' }, headers: { Origin: BASE } });
    },
  );
  await undoCase('Cancel session', async (page) => {
    const d = await dash();
    const g = d.sessions.find((s) => !s.state.flags.canceled && Date.parse(s.startsAt) > NOW_MS + 48 * 3600_000 && s.bookingStatus === 'booked');
    let card = page.locator(`article#session-${g.id}`);
    if (!(await card.count())) {
      const all = page.locator('button', { hasText: /^Show all/ });
      if (await all.count()) await all.click();
      if (!(await card.count())) await page.locator(`div#session-${g.id}`).click();
    }
    await card.locator('button[aria-label^="Game menu"]').click();
    await page.getByRole('menuitem', { name: /Cancel session/ }).click();
    await page.locator('dialog[open] button', { hasText: /^Cancel session$/ }).click();
  });
  await undoCase('Give spot (add a player to a game)', async (page) => {
    const d = await dash();
    const g = d.sessions.find((s) => !s.state.flags.canceled && Date.parse(s.startsAt) > NOW_MS + 48 * 3600_000 && s.confirmedCount < 8);
    let card = page.locator(`article#session-${g.id}`);
    if (!(await card.count())) {
      const all = page.locator('button', { hasText: /^Show all/ });
      if (await all.count()) await all.click();
      if (!(await card.count())) await page.locator(`div#session-${g.id}`).click();
    }
    await card.locator('button[aria-label^="Game menu"]').click();
    await page.getByRole('menuitem', { name: /^Players/ }).click();
    await page.locator('dialog[open] button', { hasText: 'Give spot' }).first().click();
  });
  await undoCase(
    'Remove from a game (its own older Undo, now tappable over the open sheet)',
    async (page) => {
      const d = await dash();
      const g = d.sessions.find((s) => !s.state.flags.canceled && Date.parse(s.startsAt) > NOW_MS + 48 * 3600_000 && s.confirmedCount >= 2);
      let card = page.locator(`article#session-${g.id}`);
      if (!(await card.count())) {
        const all = page.locator('button', { hasText: /^Show all/ });
        if (await all.count()) await all.click();
        if (!(await card.count())) await page.locator(`div#session-${g.id}`).click();
      }
      await card.locator('button[aria-label^="Game menu"]').click();
      await page.getByRole('menuitem', { name: /^Players/ }).click();
      await page.locator('dialog[open] button', { hasText: /^Remove$/ }).first().click();
      await page.locator('dialog[open] button', { hasText: /^Remove$/ }).last().click();
      // The Undo must be what a finger lands on (the open sheet used to cover it for taps).
      const undo = page.locator('[data-banner] .toast-action', { hasText: 'Undo' }).last();
      await page.waitForTimeout(500);
      if (process.env.E2E_DEBUG) console.log('      banners:', JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('[data-banner]')].map((b) => [b.innerText.slice(0, 30), b.parentElement.tagName, b.parentElement.open, b.matches(':popover-open'), b.getBoundingClientRect().height]))), JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('dialog')].map((d) => [d.open, d.querySelector('h2')?.innerText]))));
      await undo.waitFor();
      await page.waitForTimeout(400);
      const box = await undo.boundingBox();
      const hit = await page.evaluate(({ x, y }) => !!document.elementFromPoint(x, y)?.closest('.toast-action'), { x: box.x + box.width / 2, y: box.y + box.height / 2 });
      assert(hit, 'the Undo over the open sheet can be tapped');
    },
  );
  await undoCase('Adjust credit', async (page) => {
    await tab(page, 'Players');
    await page.locator('[data-pr-row="Casey"]').click();
    await page.locator('[data-pr-edit]').click();
    await page.locator('[data-adjust-credit-row]').click();
    await page.locator('[data-adjust-sheet]').waitFor();
    await page.locator('[data-adjust-chip="5"]').click();
    await page.locator('[data-adjust-reason]').fill('Test');
    await page.locator('[data-adjust-save]').click();
  });
  await undoCase('Not now on a cash out request', async (page) => {
    await page.locator('[data-refund-request] button', { hasText: 'Not now' }).first().click();
  });
  await undoCase('Paid on an unconfirmed "I paid"', async (page) => {
    await page.locator('[data-payment-claim] button', { hasText: /^Paid$/ }).first().click();
  });

  await check('Undo: left alone, Mark paid saves once after 5 seconds; polls in the meantime never flip the row back', async () => {
    const { ctx, page, sent } = await openAdmin();
    await tab(page, 'Money');
    const row = moneyRow(page, 'Gray');
    const label = await row.innerText();
    const t0 = Date.now();
    await row.getByRole('button', { name: /Mark paid/ }).click();
    // Something else changes meanwhile (a player joins a game), so the organizer screen reloads under the held tap.
    const d = await dash();
    const other = await browser.newContext();
    await post(other.request, '/api/me', { playerId: d.players.find((p) => p.name === 'Harper').id });
    const target = d.sessions.find((s) => !s.state.flags.canceled && Date.parse(s.startsAt) > NOW_MS + 72 * 3600_000 && !s.roster.some((r) => r.name === 'Harper'));
    await post(other.request, `/api/sessions/${target.id}/join`, {});
    const name = label.split('\n')[0];
    for (let i = 0; i < 8; i++) {
      await page.waitForTimeout(500);
      const stillPaid = await page.locator('article.mrw-game li').filter({ hasText: name }).filter({ has: page.getByRole('button', { name: /Mark paid/ }) }).count();
      if (Date.now() - t0 < 4500) assert(stillPaid === 0 || i === 0, 'the row flipped back while held');
    }
    await page.waitForTimeout(Math.max(0, 7000 - (Date.now() - t0)));
    const paySends = sent.filter((x) => /\/payment$/.test(x));
    assert(paySends.length === 1, `one save: ${paySends.join(', ')}`);
    await other.close();
    await ctx.close();
  });

  await check('Undo: two quick Mark paid taps each keep their own Undo; undoing the first leaves the second saved', async () => {
    const { ctx, page, sent } = await openAdmin();
    await tab(page, 'Money');
    const rows = page.locator('article.mrw-game li').filter({ has: page.getByRole('button', { name: /Mark paid/ }) });
    const first = (await rows.nth(0).innerText()).split('\n')[0];
    await rows.nth(0).getByRole('button', { name: /Mark paid/ }).click();
    await page.waitForTimeout(300);
    const second = (await rows.nth(0).innerText()).split('\n')[0];
    await rows.nth(0).getByRole('button', { name: /Mark paid/ }).click();
    const undos = page.locator('[data-banner] .toast-action', { hasText: 'Undo' });
    await page.waitForTimeout(300);
    assert((await undos.count()) === 2, `two Undo toasts (${await undos.count()})`);
    await page.locator('[data-banner][data-stack] .toast-action', { hasText: 'Undo' }).click();
    await page.waitForTimeout(6500);
    const pays = sent.filter((x) => /\/payment$/.test(x));
    assert(pays.length === 1, `only the second saved (${pays.length})`);
    void first;
    void second;
    await ctx.close();
  });

  await check('Undo off (the Settings row off): Mark paid saves at once and its toast has no Undo, as before', async () => {
    await real.put(`${BASE}/api/admin/admin-undo-switch`, { data: { on: false }, headers: { Origin: BASE } });
    const { ctx, page, sent } = await openAdmin();
    await tab(page, 'Money');
    const n0 = sent.length;
    await page.locator('article.mrw-game li').filter({ has: page.getByRole('button', { name: /Mark paid/ }) }).first().getByRole('button', { name: /Mark paid/ }).click();
    await page.waitForTimeout(800);
    assert(sent.slice(n0).some((x) => /\/payment$/.test(x)), 'saved at once');
    assert((await page.locator('[data-banner] .toast-action', { hasText: 'Undo' }).count()) === 0, 'no Undo');
    await real.put(`${BASE}/api/admin/admin-undo-switch`, { data: { on: true }, headers: { Origin: BASE } });
    await ctx.close();
  });

  // ================================================================ Settings rows and the private links
  await check('Settings: three rows (Undo on admin toasts, Swap to Alex, Players redo) at the top of Feature switches, each saves itself', async () => {
    const { ctx, page } = await openAdmin();
    await tab(page, 'Settings');
    const sum = page.locator('details > summary', { hasText: 'Feature switches' });
    if (await sum.count()) await sum.click();
    for (const a of ['data-admin-undo-all', 'data-swap-button-all', 'data-players-redo-all']) assert((await page.locator(`[${a}]`).count()) === 1, a);
    const sw = page.locator('[data-players-redo-all]');
    await sw.click();
    await page.waitForTimeout(1200);
    assert((await dash()).playersRedoForAll === undefined, 'off saved');
    await sw.click();
    await page.waitForTimeout(1200);
    assert((await dash()).playersRedoForAll === true, 'on saved');
    await ctx.close();
  });

  await check('kill-switch and private link: with the row off, only /admin?playersredo=on shows the redo on that phone', async () => {
    await real.put(`${BASE}/api/admin/players-redo-switch`, { data: { on: false }, headers: { Origin: BASE } });
    let { ctx, page } = await openAdmin();
    await tab(page, 'Players');
    assert((await page.locator('[data-players-redo]').count()) === 0, 'off: the old list');
    await ctx.close();
    ({ ctx, page } = await openAdmin(390, 'light', { url: '/admin?playersredo=on' }));
    await tab(page, 'Players');
    assert((await page.locator('[data-players-redo]').count()) === 1, 'the private link');
    await ctx.close();
    await real.put(`${BASE}/api/admin/players-redo-switch`, { data: { on: true }, headers: { Origin: BASE } });
  });

  // ================================================================ 4 Projected costs
  await check('Projected: Not booked and Waitlist games count, canceled games do not; the three projected lines agree', async () => {
    const d = await dash();
    const nov = await (await real.get(`${BASE}/api/admin/money?month=2026-11`)).json();
    const p = nov.rework.projected;
    const t = nov.rework;
    const from = Date.parse('2026-11-01T04:00:00Z');
    const to = Date.parse('2026-12-01T05:00:00Z');
    const inMonth = d.sessions.filter((s) => Date.parse(s.startsAt) >= from && Date.parse(s.startsAt) < to);
    const coming = inMonth.filter((s) => !s.state.flags.canceled && Date.parse(s.endsAt) > NOW_MS && !s.hiddenFromList);
    assert(coming.some((s) => s.bookingStatus !== 'booked'), 'the world has a Not booked or Waitlist game still to come');
    assert(inMonth.some((s) => s.state.flags.canceled), 'and a canceled one');
    assert(p.addedCourts >= coming.length, `every game still to come counts (${p.addedCourts} >= ${coming.length})`);
    assert(p.courtCount === t.courtSessions + p.addedCourts, 'courts');
    assert(p.totalCents === p.courtCostCents + p.membershipCents, 'total');
    assert(p.yourCostCents === Math.max(0, p.courtCostCents + p.membershipCents - p.playersPayCents), 'your estimated cost');
    console.log(`      projected Nov (fake world): ${p.courtCount} courts, ${p.courtCostCents / 100} court + ${p.membershipCents / 100} membership = ${p.totalCents / 100}; players pay ${p.playersPayCents / 100}; your estimated cost ${p.yourCostCents / 100}`);
  });

  await browser.close();
  console.log(`\nzip13: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
