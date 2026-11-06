/* Zip 7: Tonight glow (TONIGHT_GLOW), Color cleanup (COLOR_CLEANUP), Simpler player cards (PLAYER_CARDS_SIMPLE), and the Home collapse
 * "Show fewer" fix.
 *
 *   node e2e/zip7.cjs      (also run by npm run test:e2e)
 *
 * It loads the fake preview world as if it were Thu Nov 5, 2026, 12:00 PM Eastern into a local file, starts its own dev server on it (the
 * server clock is pinned to that moment, so none of this depends on today's real date), turns the three new switches OFF for everyone (so the
 * private links are what turns them on) and drives a phone-sized browser. Nothing here touches Cloudflare or the live site.
 * Screenshots: e2e/screenshots/zip7-*.png (ignored by git).
 */
const { spawn, spawnSync } = require('node:child_process');
const { readFileSync, mkdirSync, rmSync } = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.E2E_PORT) || 5292;
const BASE = `http://localhost:${PORT}`;
const NOW_ISO = '2026-11-05T17:00:00.000Z';
const NOW_MS = Date.parse(NOW_ISO);
const SHOTS = process.env.E2E_SHOTS || path.join(__dirname, 'screenshots');
const PIN = /PIN `(\d{6})`/.exec(readFileSync(path.join(ROOT, 'docs/PREVIEW_FAKE_DB.md'), 'utf8'))[1];
// playerfix1=on too: it is ON on live and on the preview, and it gives the TONIGHT tag extra padding (the TOMORROW band must still fit).
const ALL_ON = 'tonightglow=on&colorcleanup=on&playercards=on&playerfix1=on';

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
    console.log(`  ✗ ${name}\n      ${String(err && err.message ? err.message : err).replace(/\s*\n\s*/g, ' ⏎ ').slice(0, 1200)}`);
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  mkdirSync(SHOTS, { recursive: true });
  const dbFile = path.join(ROOT, '.data', 'zip7.sqlite');
  mkdirSync(path.join(ROOT, '.data'), { recursive: true });
  rmSync(dbFile, { force: true });
  const seeded = spawnSync('npx', ['vite-node', 'scripts/load-seed-local.ts', '--', dbFile, NOW_ISO], { cwd: ROOT, encoding: 'utf8' });
  if (seeded.status !== 0) throw new Error(`could not build the fake world: ${seeded.stderr || seeded.stdout}`);
  const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
    cwd: ROOT,
    env: { ...process.env, DEV_DB: dbFile, SETUP_TOKEN: 'zip7-setup-token-0123456789', DEV_CLOCK: '1' },
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
  const put = (req, url, data, headers = {}) => req.put(BASE + url, { data, headers: { Origin: BASE, ...headers } });
  const areq = (await browser.newContext()).request;
  const login = await post(areq, '/api/admin/login', { pin: PIN });
  if (!login.ok()) throw new Error(`login failed: ${await login.text()}`);
  const dash = async (headers = {}) => (await areq.get(`${BASE}/api/admin/dashboard`, { headers })).json();
  // The preview has the new switches on for everyone; for these tests they start OFF so the private links are what turns them on.
  for (const p of ['tonight-glow-switch', 'color-cleanup-switch', 'player-cards-switch', 'home-collapse-switch']) await put(areq, `/api/admin/${p}`, { on: false });
  const d0 = await dash();
  assert(d0.tonightGlow === undefined && d0.colorCleanup === undefined && d0.playerCardsSimple === undefined, 'all three start off');
  const nameId = (d, n) => d.players.find((p) => p.name === n).id;
  const byNote = (d, note) => d.sessions.find((s) => s.note === note);
  const eastDate = (iso) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/Detroit' });
  const today = eastDate(NOW_ISO);
  const tomorrowDate = eastDate(new Date(NOW_MS + 24 * 3600_000).toISOString());
  const tonightGames = d0.sessions.filter((s) => eastDate(s.startsAt) === today && !s.state.flags.canceled);
  const tomorrowGames = d0.sessions.filter((s) => eastDate(s.startsAt) === tomorrowDate && !s.state.flags.canceled);
  assert(tonightGames.length > 0 && tomorrowGames.length > 0, `the fake world has a game tonight (${tonightGames.length}) and tomorrow (${tomorrowGames.length})`);

  const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mobile/15E148 Safari/604.1';
  const phone = (width, scheme = 'light', height = 800, extra = {}) => ({ viewport: { width, height }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, colorScheme: scheme, userAgent: UA, ...extra });
  const shift = (delta) => {
    const Real = Date;
    class Shifted extends Real {
      constructor(...a) {
        if (a.length === 0) super(Real.now() + delta);
        else super(...a);
      }
      static now() {
        return Real.now() + delta;
      }
    }
    window.Date = Shifted;
  };
  async function openAdmin({ width = 390, scheme = 'light', url = '/admin', reduced = false } = {}) {
    const ctx = await browser.newContext(phone(width, scheme, 800, reduced ? { reducedMotion: 'reduce' } : {}));
    await ctx.addInitScript(shift, NOW_MS - Date.now());
    await post(ctx.request, '/api/admin/login', { pin: PIN });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(BASE + url);
    await page.locator('.tabbar').waitFor();
    await page.waitForTimeout(700);
    return { ctx, page, errors };
  }
  async function openPlayer(name, { width = 390, scheme = 'light', height = 900, query = '', filter = 'all', reduced = false } = {}) {
    const ctx = await browser.newContext(phone(width, scheme, height, reduced ? { reducedMotion: 'reduce' } : {}));
    await ctx.addInitScript(shift, NOW_MS - Date.now());
    if (filter) await ctx.addInitScript((f) => localStorage.setItem('pb_games_filter', f), filter);
    await post(ctx.request, '/api/me', { playerId: nameId(d0, name) }, { 'X-Group-Key': String(d0.group.privateLink).split('/g/')[1] }).catch(() => {});
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(BASE + String(d0.group.privateLink).replace(/^https?:\/\/[^/]+/, '') + (query ? `?${query}` : ''));
    await page.waitForTimeout(800);
    const picker = page.locator('button', { hasText: new RegExp(`^${name}$`) });
    if (await picker.count()) await picker.first().click().catch(() => {});
    await page.locator('.schedule article, .pay-card').first().waitFor({ timeout: 8000 });
    await page.waitForTimeout(500);
    return { ctx, page, errors };
  }
  const tab = async (page, name) => {
    await page.locator('.tabbar button', { hasText: name }).first().evaluate((x) => x.click());
    await page.waitForTimeout(500);
  };
  const shot = async (page, name) => (await page.waitForTimeout(500), page.screenshot({ path: path.join(SHOTS, `zip7-${name}.png`) }));
  const noSideScroll = async (page, what) => {
    const w = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, inner: window.innerWidth }));
    assert(w.doc <= w.inner, `${what}: the page scrolls sideways (${w.doc} > ${w.inner})`);
  };
  const css = (loc, prop, pseudo) => loc.evaluate((el, [p, ps]) => getComputedStyle(el, ps || null).getPropertyValue(p), [prop, pseudo]);
  /** The card of a game by its note or by its date label on a player screen. */
  const rowByNote = (page, note) => page.locator('.schedule > .sched', { hasText: note }).first();
  const tonightRow = (page) => page.locator('.schedule > .sched', { has: page.locator('.tile', { hasText: /TONIGHT|^THU/ }) }).first();
  const tileOf = (row) => row.locator('.tile.ptile').first();
  /** The banner rule, for every TONIGHT / TOMORROW tag on the page: a strip flush with the tile's top edge and full inner width, replacing the weekday, with the date number and month below it, 9 px or bigger, never clipped; TOM only where TOMORROW cannot fit. */
  const bannerProblems = (page) =>
    page.evaluate(() => {
      const out = [];
      for (const t of document.querySelectorAll('.day-tag')) {
        const tile = t.closest('.tile');
        const tr = tile.getBoundingClientRect();
        const cs = getComputedStyle(tile);
        const L = tr.left + parseFloat(cs.borderLeftWidth);
        const R = tr.right - parseFloat(cs.borderRightWidth);
        const T = tr.top + parseFloat(cs.borderTopWidth);
        const r = t.getBoundingClientRect();
        const vis = [...t.querySelectorAll('span')].find((x) => getComputedStyle(x).display !== 'none') || t;
        const word = vis.textContent.trim();
        const name = `${word} on a ${Math.round(tr.width)} px tile`;
        if (Math.abs(r.left - L) > 1 || Math.abs(r.right - R) > 1) out.push(`${name}: not the full inner width (${Math.round(r.left - L)}, ${Math.round(R - r.right)})`);
        if (Math.abs(r.top - T) > 1) out.push(`${name}: not flush with the top edge (${Math.round(r.top - T)})`);
        if (tile.querySelector('.dow')) out.push(`${name}: a weekday is still on the tile`);
        const day = tile.querySelector('.day');
        const mon = tile.querySelector('.mon');
        if (!day || !mon || day.getBoundingClientRect().top < r.bottom - 0.5 || mon.getBoundingClientRect().top < day.getBoundingClientRect().bottom - 0.5) out.push(`${name}: date number and month are not below the strip`);
        if (parseFloat(getComputedStyle(vis).fontSize) < 9) out.push(`${name}: type under 9 px`);
        if (t.scrollWidth > t.clientWidth + 1) out.push(`${name}: clipped`);
        const rg = document.createRange();
        rg.selectNodeContents(vis);
        if (rg.getBoundingClientRect().width > r.width + 0.5) out.push(`${name}: the word is wider than the strip`);
        if (word === 'TOM' && t.classList.contains('tonight')) out.push('TONIGHT must never be shortened');
        if (parseFloat(getComputedStyle(t).borderTopLeftRadius) < 2) out.push(`${name}: strip corners are not rounded to the tile`);
      }
      return out;
    });
  const idOf = async (row) => (await row.getAttribute('id')).replace('row-', '');

  const game = {
    tonight: tonightGames.sort((a, b) => a.startsAt.localeCompare(b.startsAt))[0],
    tomorrow: tomorrowGames[0],
    later: byNote(d0, 'Court closed') || null,
  };

  // =============================================================== A. TONIGHT GLOW
  await check('A: switch OFF: tonight is the old blue TONIGHT strip, no tomorrow tag, no glow, no attributes on the page', async () => {
    const p = await openPlayer('Jordan');
    const row = p.page.locator(`#row-${game.tonight.id}`);
    const tag = row.locator('.tonight-tag');
    assert((await tag.count()) === 1 && (await tag.innerText()).trim() === 'TONIGHT', 'the old strip is there');
    assert((await tag.getAttribute('class')) === 'tonight-tag', 'with its old class only');
    assert((await p.page.locator('.day-tag').count()) === 0, 'no new tags anywhere');
    assert((await css(tileOf(row), 'animation-name')) === 'none', 'no glow');
    assert(await p.page.evaluate(() => !document.documentElement.hasAttribute('data-tonight-glow') && !document.documentElement.hasAttribute('data-color-cleanup') && !document.documentElement.hasAttribute('data-player-cards')), 'no page attribute');
    assert((await p.page.locator('.court-status').count()) > 0, 'court words are still on the cards');
    await p.ctx.close();
  });
  for (const scheme of ['light', 'dark']) {
    await check(`A: TONIGHT is a solid green band that glows; TOMORROW is a soft green band, still; other days show the weekday (${scheme})`, async () => {
      const p = await openPlayer('Jordan', { scheme, query: 'tonightglow=on' });
      const row = p.page.locator(`#row-${game.tonight.id}`);
      const tag = row.locator('.day-tag.tonight');
      assert((await tag.innerText()).trim() === 'TONIGHT', 'TONIGHT');
      const want = scheme === 'light' ? ['rgb(31, 107, 69)', 'rgb(255, 255, 255)'] : ['rgb(76, 197, 138)', 'rgb(13, 42, 27)'];
      assert((await css(tag, 'background-color')) === want[0] && (await css(tag, 'color')) === want[1], `TONIGHT colors ${await css(tag, 'background-color')} / ${await css(tag, 'color')}`);
      // Glow and sweep: on the date badge only.
      assert((await css(tileOf(row), 'animation-name')) === 'z7-pulse', 'the badge pulses');
      assert((await css(tileOf(row), 'animation-name', '::after')) === 'z7-sweep', 'with a light sweep');
      assert((await css(row, 'animation-name')) !== 'z7-pulse' && (await css(row, 'box-shadow')) !== (await css(tileOf(row), 'box-shadow')), 'the card itself does not glow');
      assert((await css(row.locator('.sched-body'), 'animation-name')) === 'none', 'nor its body');
      const tm = p.page.locator(`#row-${game.tomorrow.id} .day-tag.tomorrow`);
      assert((await tm.innerText()).trim() === 'TOMORROW', 'TOMORROW');
      const want2 = scheme === 'light' ? ['rgb(223, 240, 230)', 'rgb(31, 107, 69)'] : ['rgb(28, 58, 42)', 'rgb(139, 224, 179)'];
      assert((await css(tm, 'background-color')) === want2[0] && (await css(tm, 'color')) === want2[1], 'TOMORROW colors');
      const trow = p.page.locator(`#row-${game.tomorrow.id}`);
      assert((await css(tileOf(trow), 'animation-name')) === 'none', 'no motion on TOMORROW');
      // A game 3+ days out keeps its weekday.
      const far = p.page.locator('.schedule > .sched', { has: p.page.locator('.tile .dow') }).first();
      assert((await far.locator('.day-tag').count()) === 0, 'other days have no tag');
      if (scheme === 'light') await shot(p.page, 'tiles-light');
      else await shot(p.page, 'tiles-dark');
      await p.ctx.close();
    });
  }
  await check('A: Reduce Motion holds everything still (glow, sweep) but keeps the band', async () => {
    const p = await openPlayer('Jordan', { query: 'tonightglow=on', reduced: true });
    const row = p.page.locator(`#row-${game.tonight.id}`);
    assert((await css(tileOf(row), 'animation-name')) === 'none', 'no pulse');
    assert((await css(tileOf(row), 'animation-name', '::after')) === 'none', 'no sweep');
    assert((await row.locator('.day-tag.tonight').count()) === 1, 'the band is still there');
    await p.ctx.close();
  });
  await check('A: a canceled game or a game that already started wears no tag', async () => {
    const p = await openPlayer('Jordan', { query: 'tonightglow=on' });
    const canceled = p.page.locator('.schedule > .sched.off').first();
    assert((await canceled.locator('.day-tag').count()) === 0, 'canceled: weekday');
    await p.ctx.close();
  });
  for (const width of [390, 360, 320]) {
    await check(`A: the banner is a strip across the top of the tile on every player card at ${width} px, light and dark (with Player screen fixes on too), no sideways scroll`, async () => {
      for (const scheme of ['light', 'dark']) {
        const p = await openPlayer('Jordan', { width, scheme, query: ALL_ON });
        assert((await p.page.locator('.schedule.pf1').count()) === 1, 'Player screen fixes is on too');
        assert((await p.page.locator('.day-tag').count()) >= 3, 'tags on the page');
        const bad = await bannerProblems(p.page);
        assert(bad.length === 0, `banner (${scheme}): ${bad.join('; ')}`);
        // TOMORROW is the full word on this week's and next week's tiles.
        const tm = p.page.locator(`#row-${game.tomorrow.id} .day-tag.tomorrow`);
        assert((await tm.innerText()).trim() === 'TOMORROW', `TOMORROW in full on the card (${await tm.innerText()})`);
        await noSideScroll(p.page, `player ${width} ${scheme}`);
        if (width === 320) await shot(p.page, `player-320-${scheme}`);
        await p.ctx.close();
      }
    });
  }
  await check('A: a LATER row tile (56 px, too narrow for TOMORROW at 9 px) says TOM, still 9 px and flush; TONIGHT stays whole', async () => {
    const p = await openPlayer('Jordan', { width: 320, query: ALL_ON });
    // Put a copy of tomorrow's and tonight's tiles into a LATER-tier card shell on the page.
    await p.page.evaluate(([a, b]) => {
      const mk = (id) => {
        const src = document.getElementById(`row-${id}`).cloneNode(true);
        src.id = `later-${id}`;
        src.className = src.className.replace(/tier-\w+/, 'tier-later');
        src.dataset.tier = 'later';
        document.querySelector('.schedule').append(src);
      };
      mk(a);
      mk(b);
    }, [game.tomorrow.id, game.tonight.id]);
    await p.page.waitForTimeout(300);
    const info = await p.page.evaluate(([a, b]) => ({ tomorrow: document.querySelector(`#later-${a} .day-tag`).innerText.trim(), tonight: document.querySelector(`#later-${b} .day-tag`).innerText.trim(), width: document.querySelector(`#later-${a} .tile`).getBoundingClientRect().width }), [game.tomorrow.id, game.tonight.id]);
    assert(info.tomorrow === 'TOM' && info.tonight === 'TONIGHT', `LATER tile words: ${JSON.stringify(info)}`);
    const bad = await bannerProblems(p.page);
    assert(bad.length === 0, `banner: ${bad.join('; ')}`);
    await p.ctx.close();
  });
  await check('A: organizer Home tiles say TONIGHT / TOMORROW too; the Money list tiles keep the weekday', async () => {
    const { ctx, page } = await openAdmin({ url: '/admin?tonightglow=on' });
    assert((await page.locator(`#session-${game.tonight.id} .day-tag.tonight`).count()) === 1, 'admin TONIGHT');
    assert((await page.locator(`#session-${game.tomorrow.id} .day-tag.tomorrow`).count()) === 1, 'admin TOMORROW');
    assert((await css(page.locator(`#session-${game.tonight.id} .tile`), 'animation-name')) === 'z7-pulse', 'admin badge glows');
    await shot(page, 'admin-tiles');
    await tab(page, 'Money');
    await page.waitForTimeout(500);
    assert((await page.locator('.day-tag').count()) === 0, 'no tags on Money');
    await ctx.close();
    const off = await openAdmin();
    assert((await off.page.locator('.day-tag').count()) === 0, 'admin switch off: weekday');
    await off.ctx.close();
  });
  for (const width of [390, 360, 320]) {
    await check(`A: organizer Home banners are flush strips at ${width} px, light and dark: TONIGHT whole, TOMORROW says TOM at 9 px on the narrow tile`, async () => {
      for (const scheme of ['light', 'dark']) {
        const { ctx, page } = await openAdmin({ width, scheme, url: `/admin?${ALL_ON}` });
        assert((await page.locator('.day-tag').count()) >= 3, 'tags on the page');
        const bad = await bannerProblems(page);
        assert(bad.length === 0, `banner (${scheme}): ${bad.join('; ')}`);
        const tm = (await page.locator(`#session-${game.tomorrow.id} .day-tag.tomorrow`).innerText()).trim();
        assert(tm === 'TOM', `the narrow organizer tile says TOM (${tm})`);
        assert((await page.locator(`#session-${game.tonight.id} .day-tag.tonight`).innerText()).trim() === 'TONIGHT', 'TONIGHT whole');
        await noSideScroll(page, `admin ${width} ${scheme}`);
        if (width === 320) await shot(page, `admin-banner-320-${scheme}`);
        await ctx.close();
      }
    });
  }

  // =============================================================== B. COLOR CLEANUP
  // A waitlist game that shows on the organizer Home: tomorrow's game for the length of the color tests (put back to Booked after).
  await post(areq, `/api/admin/sessions/${game.tomorrow.id}/court-status`, { status: 'waitlist' });
  for (const scheme of ['light', 'dark']) {
    await check(`B: Waitlist is neutral gray (selected state and card border), Extra game is a gray outline (${scheme})`, async () => {
      const { ctx, page } = await openAdmin({ scheme, url: '/admin?colorcleanup=on' });
      const wl = game.tomorrow;
      const card = page.locator(`#session-${wl.id}`);
      const seg = card.locator('.court-switch button[data-seg="waitlist"]');
      const want = scheme === 'light' ? ['rgb(75, 85, 99)', 'rgb(255, 255, 255)'] : ['rgb(154, 163, 176)', 'rgb(20, 24, 28)'];
      assert((await css(seg, 'background-color')) === want[0] && (await css(seg, 'color')) === want[1], `Waitlist ${await css(seg, 'background-color')} / ${await css(seg, 'color')}`);
      const border = await css(card, 'border-top-color');
      assert(!/^rgb\((28|111), (79|163), (148|234)\)$/.test(border), `the Waitlist card border is not blue (${border})`);
      const extra = page.locator('.extra-tag').first();
      assert((await css(extra, 'background-color')) === 'rgba(0, 0, 0, 0)', 'Extra game has no fill');
      const col = (await css(extra, 'color')).match(/\d+/g).map(Number);
      assert(Math.abs(col[0] - col[1]) < 14 && Math.abs(col[1] - col[2]) < 14, `Extra game text is gray (${col})`);
      await shot(page, `admin-colors-${scheme}`);
      await ctx.close();
    });
  }
  await check('B: with the switch OFF, Waitlist is still blue and the Extra game tag is still purple', async () => {
    const { ctx, page } = await openAdmin();
    const wl = game.tomorrow;
    assert((await css(page.locator(`#session-${wl.id} .court-switch button[data-seg="waitlist"]`), 'background-color')) === 'rgb(28, 79, 148)', 'blue Waitlist');
    const col = (await css(page.locator('.extra-tag').first(), 'color')).match(/\d+/g).map(Number);
    assert(col[2] > col[1] + 30, `purple Extra game (${col})`);
    await ctx.close();
  });
  await post(areq, `/api/admin/sessions/${game.tomorrow.id}/court-status`, { status: 'booked' });
  for (const scheme of ['light', 'dark']) {
    await check(`B: the Canceled pill is neutral GRAY (it was green), the canceled row and its date tile are dimmed, no red on the row (${scheme}), before and after`, async () => {
      const q = await openPlayer('Jordan', { scheme, query: 'colorcleanup=on&homecollapse=on' });
      await q.page.locator('[data-later-toggle]').click().catch(() => {});
      await q.page.waitForTimeout(400);
      const pill = q.page.locator('.st-canceled.note-pill, .st-canceled.note-box').first();
      assert((await pill.count()) === 1, 'a canceled game with a reason is shown');
      assert(/^Canceled - .+/.test((await pill.innerText()).trim()), `pill words (${await pill.innerText()})`);
      const num = async (loc, prop) => (await css(loc, prop)).match(/[\d.]+/g).map(Number);
      const [bg, fg] = [await num(pill, 'background-color'), await num(pill, 'color')];
      const want = scheme === 'light' ? [[233, 235, 238], [75, 85, 99]] : [[38, 44, 40], [170, 178, 172]];
      assert(JSON.stringify(bg.slice(0, 3)) === JSON.stringify(want[0]) && JSON.stringify(fg.slice(0, 3)) === JSON.stringify(want[1]), `gray pill (${bg} / ${fg})`);
      const lum = (c) => c.map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)).reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
      const ratio = (Math.max(lum(bg), lum(fg)) + 0.05) / (Math.min(lum(bg), lum(fg)) + 0.05);
      assert(ratio >= 4.5, `contrast ${ratio.toFixed(2)}`);
      const row = pill.locator('xpath=ancestor::article[contains(@class,"sched")]');
      const opacity = parseFloat(await css(row.locator('.sched-tilecol'), 'opacity'));
      assert(opacity >= 0.55 && opacity <= 0.6, `the date tile and time are dimmed to about 58% (${opacity})`);
      // No red anywhere on the row: every text and border color on it has no strong red lead.
      const reds = await row.evaluate((r) => [r, ...r.querySelectorAll('*')].flatMap((e) => { const cs = getComputedStyle(e); return [cs.color, cs.backgroundColor, cs.borderTopColor].filter((c) => { const m = c.match(/[\d.]+/g).map(Number); return (m[3] === undefined || m[3] > 0) && m[0] > m[1] + 40 && m[0] > m[2] + 40; }).map((c) => `${e.className} ${c}`); }));
      assert(reds.length === 0, `red on the canceled row: ${reds.slice(0, 3)}`);
      await pill.scrollIntoViewIfNeeded();
      await shot(q.page, `canceled-after-${scheme}`);
      await q.ctx.close();
      const o = await openPlayer('Jordan', { scheme, query: 'homecollapse=on' });
      await o.page.locator('[data-later-toggle]').click().catch(() => {});
      await o.page.waitForTimeout(400);
      const old = o.page.locator('.st-canceled.note-pill, .st-canceled.note-box').first();
      const oc = (await css(old, 'color')).match(/\d+/g).map(Number);
      assert(oc[1] > oc[0] && oc[1] > oc[2] - 5, `before: green (${oc})`);
      const orow = old.locator('xpath=ancestor::article[contains(@class,"sched")]');
      assert(parseFloat(await css(orow.locator('.sched-tilecol'), 'opacity')) === 1, 'before: tile not dimmed');
      await old.scrollIntoViewIfNeeded();
      await shot(o.page, `canceled-before-${scheme}`);
      await o.ctx.close();
    });
  }
  await check('B: every Text button is purple, credit is blue, links stay blue (Book link)', async () => {
    const { ctx, page } = await openAdmin({ url: '/admin?colorcleanup=on' });
    const sms = page.locator('a.btn[href^="sms:"], a.btn[href^="sms://"]').first();
    assert((await sms.count()) === 1, 'a Text button is on Home');
    assert((await css(sms, 'background-color')) === 'rgb(106, 86, 166)', `purple (${await css(sms, 'background-color')})`);
    const book = page.locator('a', { hasText: /^Book/ }).first();
    if (await book.count()) {
      const c = (await css(book, 'color')).match(/\d+/g).map(Number);
      assert(c[2] > c[0], `Book stays blue (${c})`);
    }
    await ctx.close();
    const p = await openPlayer('Harper', { query: 'colorcleanup=on' });
    const lab = p.page.locator('.credit-chip .cc-label');
    assert((await css(lab, 'color')) === 'rgb(58, 79, 163)', `credit label blue (${await css(lab, 'color')})`);
    await p.ctx.close();
  });
  await check('B: the Cancel sheet drops the "Players will see it as canceled" line and shortens the "fee is kept" line; both unchanged with the switch off', async () => {
    const g = byNote(d0, 'Late-fee test');
    const run = async (url) => {
      const { ctx, page } = await openAdmin({ url });
      const card = page.locator(`#session-${g.id}`);
      await card.getByRole('button', { name: /^Game menu for/ }).click();
      await card.getByRole('menuitem', { name: 'Cancel session', exact: true }).click();
      const dlg = page.locator('dialog[open]');
      await dlg.waitFor();
      const text = (await dlg.innerText()).replace(/\s+/g, ' ');
      await ctx.close();
      return text;
    };
    const off = await run('/admin');
    const on = await run('/admin?colorcleanup=on');
    assert(off.includes('Players will see it as canceled, and reminders and payments stop for it.'), 'OFF: old line there');
    assert(!on.includes('Players will see it as canceled'), 'ON: line gone');
    const oldKept = /Yes: the fee is kept[^.]*\.[^.]*\./.exec(off);
    assert(/Yes: the fee is kept\. \d+ are in, so everyone signed up owes \$\d+ \(anything paid above that comes back as credit\)\. Late drops still owe \$14\./.test(off) || /Yes: the fee is kept, and everyone signed up still owes their \$14/.test(off), `OFF: old kept line (${oldKept && oldKept[0]})`);
    assert(/Yes: the fee is kept\. Everyone signed up owes \$\d+\./.test(on) && !/anything paid above/.test(on) && !/Late drops still owe/.test(on), `ON: short kept line (${on.slice(on.indexOf('Yes:'), on.indexOf('Yes:') + 120)})`);
    console.log(`      OLD: ${(/Yes: the fee is kept[^]*?(\$14\.|\$14 \(late drops too\)\.)/.exec(off) || [''])[0]}`);
    console.log(`      NEW: ${(/Yes: the fee is kept\. Everyone[^.]*\./.exec(on) || [''])[0]}`);
  });

  // =============================================================== C. SIMPLER PLAYER CARDS
  const wordsOnCards = (page) => page.evaluate(() => [...document.querySelectorAll('.schedule > .sched')].map((r) => ({ id: r.id, text: [...r.querySelectorAll('*')].filter((e) => !e.closest('button, [aria-hidden="true"], .sr-only')).map((e) => (e.children.length === 0 ? e.textContent : '')).join(' ').replace(/\s+/g, ' ').trim(), mine: r.dataset.mine === 'in', cal: r.querySelectorAll('.cal-icon-link').length, join: r.querySelectorAll('[data-join]').length, dot: r.querySelectorAll('.court-dot').length, head: r.querySelectorAll('.sched-head').length })));
  for (const scheme of ['light', 'dark']) {
    await check(`C: no "Court booked / not booked" words or dot on any card; calendar icon only next to You're in (${scheme})`, async () => {
      for (const who of ['Jordan', 'Avery', 'Casey', 'Gray']) {
        const p = await openPlayer(who, { scheme, query: 'playercards=on&homecollapse=on' });
        await p.page.locator('[data-later-toggle]').click().catch(() => {});
        await p.page.waitForTimeout(300);
        const rows = await wordsOnCards(p.page);
        assert(rows.length >= 6, `${who}: cards shown (${rows.length})`);
        for (const r of rows) {
          assert(!/court booked|court not booked|booked|waitlist(?!\b.*label)|standby/i.test(r.text.replace(/On the waitlist/g, '')), `${who} ${r.id}: forbidden words in «${r.text}»`);
          assert(r.dot === 0, `${who} ${r.id}: a dot`);
          assert(r.cal === (r.mine ? 1 : 0), `${who} ${r.id}: calendar icon ${r.cal} for mine=${r.mine}`);
        }
        const notIn = rows.filter((r) => !r.mine && r.join > 0);
        for (const r of notIn) assert(r.head === 0 && /of 4 in|\d+ in/.test(r.text), `${who} ${r.id}: not-in card is just the count and I'm in («${r.text}»)`);
        if (who === 'Casey' && scheme === 'light') await shot(p.page, 'cards-casey');
        if (who === 'Jordan') await shot(p.page, `cards-jordan-${scheme}`);
        await p.ctx.close();
      }
    });
  }
  await check("C: with the switch OFF the cards still say Court booked / Court not booked, with the dot", async () => {
    const p = await openPlayer('Jordan');
    await p.page.getByRole('button', { name: /^More sessions/ }).click();
    await p.page.waitForTimeout(400);
    const rows = await wordsOnCards(p.page);
    assert(rows.some((r) => /Court booked/.test(r.text)) && rows.some((r) => /Court not booked/.test(r.text)), `court words (${rows.length} rows: ${rows.map((r) => r.text.slice(0, 40)).join(' | ')})`);
    assert(rows.some((r) => r.dot > 0), 'dot');
    await p.ctx.close();
  });
  await check('C: game notes and the Court number pill stay; ONE small "On the waitlist" label only for the player on the list', async () => {
    const g = byNote(d0, 'Mixed payments');
    const full = d0.sessions.find((s) => s.confirmedCount >= 10 && s.waitlistCount === 1);
    const p = await openPlayer('Gray', { query: `playercards=on&homecollapse=on&s=${full.id}` });
    assert((await p.page.locator(`#row-${g.id} .game-note`).innerText()).trim() === 'Mixed payments', 'the admin note is kept');
    const row = p.page.locator(`#row-${full.id}`);
    assert((await row.locator('.on-waitlist').count()) === 1 && (await row.locator('.on-waitlist').innerText()).trim() === 'On the waitlist', 'Gray: the label');
    assert((await p.page.locator('.on-waitlist').count()) === 1, 'only one label on the whole screen');
    const t = (await row.innerText()).replace(/\s+/g, ' ');
    assert(!/in line|if someone drops|Standby|Waitlist:/i.test(t), `no other waitlist words (${t})`);
    await p.ctx.close();
    const q = await openPlayer('Casey', { query: `playercards=on&homecollapse=on&s=${full.id}` });
    assert((await q.page.locator('.on-waitlist').count()) === 0, 'Casey (not on a list) sees no label');
    assert(!/Waitlist:|On the waitlist/.test(await q.page.locator(`#row-${full.id}`).innerText()), 'and no list of waiting names');
    await q.ctx.close();
  });
  await check("C: tapping I'm in instantly makes the You're in card with the calendar icon (even with a slow server)", async () => {
    const p = await openPlayer('Casey', { query: 'playercards=on&instanttaps=on' });
    await p.page.route('**/api/sessions/*/join', async (r) => {
      await sleep(2500);
      await r.continue();
    });
    const row = p.page.locator('.schedule > .sched', { has: p.page.locator('[data-join]') }).filter({ hasNotText: 'waitlist' }).first();
    const id = await idOf(row);
    await row.locator('[data-join]').click();
    await p.page.waitForTimeout(350);
    const now = p.page.locator(`#row-${id}`);
    assert((await now.getAttribute('data-mine')) === 'in', "the card says you're in at once");
    assert((await now.locator('.cal-icon-link').count()) === 1, 'with the calendar icon');
    assert(/You're in/.test(await now.innerText()), "You're in text");
    await p.page.waitForTimeout(3000);
    assert((await now.getAttribute('data-mine')) === 'in', 'and it stays after the server answers');
    await shot(p.page, 'cards-after-tap');
    await p.ctx.close();
  });
  for (const width of [390, 360, 320]) {
    await check(`C: all three switches together: nothing spills at ${width} px (player Home, Settings, organizer Home), light and dark`, async () => {
      for (const scheme of ['light', 'dark']) {
        const p = await openPlayer('Gray', { width, scheme, query: ALL_ON });
        await noSideScroll(p.page, `player ${width} ${scheme}`);
        const bad = await p.page.evaluate(() => [...document.querySelectorAll('.schedule *')].filter((e) => { const r = e.getBoundingClientRect(); return r.width && (r.right > innerWidth + 0.5 || r.left < -0.5); }).map((e) => e.className).slice(0, 5));
        assert(bad.length === 0, `spills: ${bad}`);
        assert(p.errors.length === 0, `page errors: ${p.errors}`);
        await p.ctx.close();
        const a = await openAdmin({ width, scheme, url: `/admin?${ALL_ON}` });
        await noSideScroll(a.page, `admin ${width} ${scheme}`);
        assert(a.errors.length === 0, `admin errors: ${a.errors}`);
        await a.ctx.close();
      }
    });
  }

  // =============================================================== D. Show fewer
  await check('D: a texted link to a later game opens the list and "Show fewer" folds it again (HOME_COLLAPSE on)', async () => {
    const later = d0.sessions.filter((s) => !s.state.flags.canceled).sort((a, b) => a.startsAt.localeCompare(b.startsAt)).slice(-1)[0];
    const p = await openPlayer('Jordan', { query: `homecollapse=on&s=${later.id}`, filter: 'all' });
    const toggle = p.page.locator('[data-later-toggle]');
    assert((await toggle.innerText()).trim() === 'Show fewer', 'the link opened the list');
    await toggle.click();
    await p.page.waitForTimeout(500);
    assert((await toggle.innerText()).trim() === 'More sessions', 'Show fewer folded it');
    assert((await p.page.locator(`#row-${later.id}`).count()) === 0, 'the later game is hidden');
    await toggle.click();
    await p.page.waitForTimeout(400);
    assert((await toggle.innerText()).trim() === 'Show fewer' && (await p.page.locator(`#row-${later.id}`).count()) === 1, 'and opens again');
    await p.ctx.close();
  });

  // =============================================================== Settings rows
  await check('Settings > Feature switches: three rows, each title on one line; each saves for everyone (no private link needed) and off again', async () => {
    const { ctx, page } = await openAdmin();
    await tab(page, 'Settings');
    for (const s of await page.locator('details > summary').all()) await s.click().catch(() => {});
    for (const [row, attr, key, flag] of [
      ['tonightGlowAll', 'data-tonight-glow-all', 'tonightGlowForAll', 'tonightGlow'],
      ['colorCleanupAll', 'data-color-cleanup-all', 'colorCleanupForAll', 'colorCleanup'],
      ['playerCardsAll', 'data-player-cards-all', 'playerCardsSimpleForAll', 'playerCardsSimple'],
    ]) {
      const r = page.locator(`[data-row="${row}"]`);
      assert((await r.count()) === 1, `row ${row}`);
      const h = await r.locator('.set-name').evaluate((el) => ({ h: el.getBoundingClientRect().height, line: parseFloat(getComputedStyle(el).lineHeight) || 20 }));
      assert(h.h <= h.line * 1.4, `${row} title on one line`);
      const sw = page.locator(`[${attr}]`);
      assert(!(await sw.isChecked()), `${row} starts off`);
      await sw.click();
      await page.waitForTimeout(900);
      const d = await dash();
      assert(d[key] === true && d[flag] === true, `${row} on for everyone`);
      await sw.click();
      await page.waitForTimeout(900);
      assert((await dash())[key] === false, `${row} off again`);
    }
    await shot(page, 'settings-switches');
    await ctx.close();
  });

  await browser.close();
  console.log(`\nzip7: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
