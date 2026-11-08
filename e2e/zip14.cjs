/* Zip 14: the Game day card (GAME_DAY_CARD) switched ON, and the court number per game (migration 0017).
 *
 *   node e2e/zip14.cjs      (also run by npm run test:e2e)
 *
 * Fake preview world on game day (Tue Nov 10, 3:28 PM Eastern) with the Zip 14 parts (SEED_ZIP14=1): two extra games tonight, one on
 * Court 3 (Indy paid) and one with no court (Indy owes, a long name in it), plus the regular 8 PM game. Its own dev server with
 * GAME_DAY_TEST=on (as on a preview); nothing touches Cloudflare or the live site.
 * Checks: the card at 390, 360 and 320 wide, light and dark (66 px tile, 17 px "You're in", two equal 30 px buttons on one line, no
 * calendar or arrow buttons, the check badge on the tile's corner, nothing sideways), Court opens the map with that court lit (tap outside,
 * X and Escape close it), Court TBD shows the pop-up that goes by itself, Directions (Apple Maps on an iPhone, Google elsewhere), Reduce
 * Motion holds everything still, the Thursday card, Pay and I paid still work, the organizer Court row and picker (Edit game and Add
 * game) and the card following it, a player and the read-only PIN refused, the Settings row, and the preview-only "next game as today".
 */
const { spawn, spawnSync } = require('node:child_process');
const { readFileSync, mkdirSync, rmSync } = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.E2E_PORT) || 5417;
const BASE = `http://localhost:${PORT}`;
const NOW_ISO = '2026-11-10T20:28:00.000Z'; // Tue Nov 10, 3:28 PM Eastern (game day)
const NOW_MS = Date.parse(NOW_ISO);
const SAT_MS = Date.parse('2026-11-15T04:30:00.000Z'); // Sat Nov 14, 11:30 PM Eastern (every game that day is over)
const SHOTS = process.env.E2E_SHOTS || path.join(__dirname, 'screenshots');
const PIN = /PIN `(\d{6})`/.exec(readFileSync(path.join(ROOT, 'docs/PREVIEW_FAKE_DB.md'), 'utf8'))[1];
const RO_PIN = '86420975';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36';

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
  const dbFile = path.join(ROOT, '.data', 'zip14.sqlite');
  mkdirSync(path.join(ROOT, '.data'), { recursive: true });
  rmSync(dbFile, { force: true });
  const seeded = spawnSync('npx', ['vite-node', 'scripts/load-seed-local.ts', '--', dbFile, NOW_ISO], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, SEED_ZIP14: '1' } });
  if (seeded.status !== 0) throw new Error(`could not build the fake world: ${seeded.stderr || seeded.stdout}`);
  const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
    cwd: ROOT,
    env: { ...process.env, DEV_DB: dbFile, SETUP_TOKEN: 'zip14-setup-token-0123456789', DEV_CLOCK: '1', ORGANIZER_READONLY_PIN: RO_PIN, GAME_DAY_TEST: 'on' },
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
  const clock = (ms) => fetch(`${BASE}/__dev/clock`, { method: 'POST', body: JSON.stringify({ atMs: ms }) });
  await clock(NOW_MS);
  const browser = await chromium.launch();
  const post = (req, url, data, headers = {}) => req.post(BASE + url, { data, headers: { Origin: BASE, ...headers } });
  const real = (await browser.newContext()).request;
  if (!(await post(real, '/api/admin/login', { pin: PIN })).ok()) throw new Error('login failed');
  const dash = async (headers = {}) => (await real.get(`${BASE}/api/admin/dashboard`, { headers })).json();
  const d0 = await dash();
  assert(d0.gameDayCard === true && d0.gameDayCardForAll === true, 'the Zip 14 seed should have the Game day card row on');
  const idOf = (name) => d0.players.find((p) => p.name === name).id;
  const tonight = d0.sessions.filter((s) => s.startsAt.startsWith('2026-11-10T2') || s.startsAt.startsWith('2026-11-11T0'));
  const courtGame = tonight.find((s) => s.courtNum === 3);
  const tbdGame = d0.sessions.find((s) => s.roster.some((r) => r.name === 'Christopher Vanderberg') && !s.courtNum && Date.parse(s.startsAt) - NOW_MS < 9 * 3600_000 && Date.parse(s.startsAt) > NOW_MS);
  assert(courtGame && tbdGame, 'the two Zip 14 games tonight');

  const phone = (width, scheme, opts = {}) => ({
    viewport: { width, height: opts.height || 900 },
    deviceScaleFactor: 1,
    isMobile: true,
    hasTouch: true,
    colorScheme: scheme,
    userAgent: opts.ua || IPHONE,
    reducedMotion: opts.motion ? 'no-preference' : 'reduce',
  });
  const shift = async (ctx, at) =>
    ctx.addInitScript((delta) => {
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
    }, at - Date.now());
  async function openPlayer(name, width = 390, scheme = 'light', opts = {}) {
    const ctx = await browser.newContext(phone(width, scheme, opts));
    await shift(ctx, opts.at || NOW_MS);
    if (opts.storage) await ctx.addInitScript((kv) => Object.entries(kv).forEach(([k, v]) => localStorage.setItem(k, v)), opts.storage);
    await ctx.route('https://venmo.com/**', (r) => r.abort());
    await post(ctx.request, '/api/me', { playerId: idOf(name) });
    const page = await ctx.newPage();
    await page.goto(BASE + (opts.url || '/'));
    await page.locator('.schedule article').first().waitFor();
    await page.waitForTimeout(700);
    return { ctx, page };
  }
  async function openAdmin(width = 390, scheme = 'light', height = 844) {
    const ctx = await browser.newContext(phone(width, scheme, { height }));
    await shift(ctx, NOW_MS);
    await post(ctx.request, '/api/admin/login', { pin: PIN });
    const page = await ctx.newPage();
    await page.goto(BASE + '/admin');
    await page.locator('.tabbar').waitFor();
    await page.waitForTimeout(600);
    return { ctx, page };
  }
  const card = (page, id) => page.locator(`article#row-${id}`);
  const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, `zip14-${name}.png`) });
  const noSideways = async (page, what) => {
    const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
    assert(o.sw <= o.cw + 1, `${what}: sideways ${o.sw} > ${o.cw}`);
  };

  // ------------------------------------------------------------------------------------------------ the card, every size
  for (const scheme of ['light', 'dark']) {
    for (const width of [390, 360, 320]) {
      await check(`card ${width} px ${scheme}: 66 px TONIGHT tile with weekday, 17 px You're in, two equal one-line buttons, no calendar or arrow button`, async () => {
        const { ctx, page } = await openPlayer('Indy', width, scheme);
        for (const [g, label] of [
          [courtGame, 'Court 3'],
          [tbdGame, 'Court TBD'],
        ]) {
          const c = card(page, g.id);
          assert((await c.getAttribute('class')).includes(' gd'), `${label}: the game day card`);
          const m = await c.evaluate((el) => {
            const box = (s) => {
              const e = el.querySelector(s);
              if (!e) return null;
              const r = e.getBoundingClientRect();
              return { x: r.x, y: r.y, w: r.width, h: r.height, right: r.right, bottom: r.bottom, fs: getComputedStyle(e).fontSize, text: e.textContent };
            };
            const btns = [...el.querySelectorAll('.gd-btn')].map((b) => {
              const r = b.getBoundingClientRect();
              return { w: r.width, h: r.height, y: r.y, text: b.textContent, oneLine: b.scrollWidth <= b.clientWidth + 1 };
            });
            return { tile: box('.tile'), tag: box('.day-tag, .tonight-tag'), dow: box('.tile .dow'), check: box('.tile-check'), stin: box('.st-in'), btns, joined: !!el.querySelector('.z9-joined, .cal-icon-link'), time: box('.sched-time'), card: box(':scope') };
          });
          assert(Math.abs(m.tile.w - 66) < 1, `${label}: tile ${m.tile.w} wide`);
          assert(m.tag && /TONIGHT/.test(m.tag.text), `${label}: TONIGHT strip`);
          assert(m.dow && m.dow.text === 'TUE', `${label}: the weekday under the strip`);
          assert(m.stin && m.stin.fs === '17px', `${label}: You're in ${m.stin && m.stin.fs}`);
          assert(m.btns.length === 2, `${label}: two buttons`);
          assert(Math.abs(m.btns[0].w - m.btns[1].w) < 1 && Math.abs(m.btns[0].h - 30) < 0.6 && m.btns[0].y === m.btns[1].y, `${label}: equal 30 px buttons side by side ${JSON.stringify(m.btns)}`);
          assert(m.btns.every((b) => b.oneLine), `${label}: words on one line ${JSON.stringify(m.btns)}`);
          assert(m.btns[0].text === label && /Directions/.test(m.btns[1].text), `${label}: words`);
          assert(!m.joined, `${label}: no calendar or arrow button on game day`);
          // The badge's center sits on the tile's top-right corner (within 2 px).
          const cx = m.check.x + m.check.w / 2;
          const cy = m.check.y + m.check.h / 2;
          assert(Math.abs(cx - m.tile.right) <= 2 && Math.abs(cy - m.tile.y) <= 2, `${label}: badge on the corner (${cx},${cy}) vs (${m.tile.right},${m.tile.y})`);
          assert(/2 hours/.test(m.time.text), `${label}: start and "2 hours" under the tile`);
        }
        const btnStyle = await card(page, courtGame.id).locator('.gd-btn').first().evaluate((b) => {
          const s = getComputedStyle(b);
          return { fw: s.fontWeight, fs: s.fontSize, r: s.borderRadius, bw: s.borderTopWidth };
        });
        assert(btnStyle.fw === '600' && btnStyle.fs === (width <= 340 ? '13px' : '13.5px') && btnStyle.r === '10px' && btnStyle.bw === '1px', `button style ${JSON.stringify(btnStyle)}`);
        // Court TBD is muted: not the blue of Directions.
        const colors = await card(page, tbdGame.id).locator('.gd-btn').evaluateAll((bs) => bs.map((b) => getComputedStyle(b).color));
        assert(colors[0] !== colors[1], 'Court TBD is not blue');
        // Paid and unpaid money rows unchanged: Paid $14 on the court game, $14 due with Pay on the TBD game.
        assert((await card(page, courtGame.id).getByText('Paid $14').count()) === 1, 'Paid $14 pill');
        assert((await card(page, tbdGame.id).getByText('$14 due').count()) === 1 && (await card(page, tbdGame.id).locator(':is(a, button)', { hasText: /^Pay$/ }).count()) === 1, '$14 due and Pay on the unpaid card');
        // The long name is there and nothing runs sideways.
        assert((await card(page, tbdGame.id).getByText(/Christopher/).count()) >= 1, 'long name shown');
        await noSideways(page, `${width} ${scheme}`);
        await card(page, courtGame.id).scrollIntoViewIfNeeded();
        await shot(page, `card-${width}-${scheme}`);
        await ctx.close();
      });
    }
  }

  await check('the Thursday (not today) card: 17 px You\'re in, 7 px above the balls, keeps its calendar | directions button', async () => {
    const { ctx, page } = await openPlayer('Indy');
    const thu = page.locator('.schedule article.tier-this:not(.gd)[data-mine="in"]').first();
    await thu.waitFor();
    const m = await thu.evaluate((el) => {
      const st = el.querySelector('.st-in').getBoundingClientRect();
      const ball = el.querySelector('.sched-main').getBoundingClientRect();
      return { fs: getComputedStyle(el.querySelector('.st-in')).fontSize, joined: !!el.querySelector('.z9-joined'), gap: Math.round(ball.top - el.querySelector('.sched-head').getBoundingClientRect().bottom) };
    });
    assert(m.fs === '17px' && m.joined && m.gap === 7, JSON.stringify(m));
    await ctx.close();
  });

  // ------------------------------------------------------------------------------------------------ Court opens the map
  for (const scheme of ['light', 'dark']) {
    await check(`Court 3 opens the court map with 3 lit (${scheme}); tap outside, X and Escape close it`, async () => {
      const { ctx, page } = await openPlayer('Indy', 390, scheme, { motion: true });
      const c = card(page, courtGame.id);
      await c.getByRole('button', { name: /Court 3/ }).click();
      const map = page.locator('dialog.cm[open]');
      await map.waitFor();
      await page.waitForTimeout(400);
      assert((await map.locator('[data-court-cell]').count()) === 16, '16 courts');
      assert((await map.locator('.cm-cl.me').innerText()) === '3', 'court 3 lit');
      const anim = await map.locator('.cm-cl.me').evaluate((e) => getComputedStyle(e).animationName);
      assert(/cm-glow/.test(anim), `glow ${anim}`);
      assert((await map.locator('[data-court-cell] >> visible=true').count()) === 16, 'all visible');
      assert((await map.locator('button[data-court-cell]').count()) === 0, 'players cannot pick');
      await shot(page, `map-${scheme}`);
      await page.mouse.click(20, 860);
      await page.waitForTimeout(300);
      assert((await page.locator('dialog.cm[open]').count()) === 0, 'tap outside closes');
      await c.getByRole('button', { name: /Court 3/ }).click();
      await map.waitFor();
      await map.getByRole('button', { name: /Close the court map/ }).click();
      await page.waitForTimeout(300);
      assert((await page.locator('dialog.cm[open]').count()) === 0, 'X closes');
      await c.getByRole('button', { name: /Court 3/ }).click();
      await map.waitFor();
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
      assert((await page.locator('dialog.cm[open]').count()) === 0, 'Escape closes');
      await ctx.close();
    });
  }

  await check('Reduce Motion: the lit court and the TONIGHT tile hold still (no glow pulse, no sweep)', async () => {
    const { ctx, page } = await openPlayer('Indy', 390, 'light');
    const tile = await card(page, courtGame.id).locator('.tile').evaluate((e) => [getComputedStyle(e).animationName, getComputedStyle(e, '::after').animationName]);
    assert(tile.every((a) => a === 'none'), `tile ${tile}`);
    await card(page, courtGame.id).getByRole('button', { name: /Court 3/ }).click();
    const me = page.locator('dialog.cm[open] .cm-cl.me');
    await me.waitFor();
    const a = await me.evaluate((e) => [getComputedStyle(e).animationName, getComputedStyle(e, '::after').display]);
    assert(a[0] === 'none' && a[1] === 'none', `court ${a}`);
    await ctx.close();
  });

  await check('motion on: the TONIGHT tile pulses at 2.4 s with the 3.6 s sweep', async () => {
    const { ctx, page } = await openPlayer('Indy', 390, 'light', { motion: true });
    const t = await card(page, courtGame.id).locator('.tile').evaluate((e) => [getComputedStyle(e).animationDuration, getComputedStyle(e, '::after').animationDuration]);
    assert(t[0] === '2.4s' && t[1] === '3.6s', JSON.stringify(t));
    await ctx.close();
  });

  for (const scheme of ['light', 'dark']) {
    await check(`Court TBD (${scheme}): a tap shows "Organizer will add it soon." under the buttons, gone by itself after about 3 seconds; nothing moves`, async () => {
      const { ctx, page } = await openPlayer('Indy', 390, scheme);
      const c = card(page, tbdGame.id);
      const h0 = (await c.boundingBox()).height;
      await c.getByRole('button', { name: /Court not set yet/ }).click();
      const pop = c.locator('[data-gd-pop]');
      await pop.waitFor();
      assert((await pop.innerText()) === 'Organizer will add it soon.', await pop.innerText());
      const pb = await pop.boundingBox();
      const bb = await c.locator('[data-game-day-buttons]').boundingBox();
      assert(pb.y >= bb.y + bb.height && pb.y - (bb.y + bb.height) < 10, 'right under the buttons');
      assert(Math.abs((await c.boundingBox()).height - h0) < 0.5, 'the card does not grow');
      await shot(page, `tbd-${scheme}`);
      await page.waitForTimeout(3300);
      assert((await c.locator('[data-gd-pop]').count()) === 0, 'gone after about 3 s');
      await ctx.close();
    });
  }

  await check('Directions: Apple Maps on an iPhone, Google Maps elsewhere, the one court address, on every game day card (court or not)', async () => {
    for (const [ua, host] of [
      [IPHONE, 'https://maps.apple.com/?daddr='],
      [ANDROID, 'https://www.google.com/maps/dir/?api=1&destination='],
    ]) {
      const { ctx, page } = await openPlayer('Indy', 390, 'light', { ua });
      const hrefs = await page.locator('article.gd [data-gd-directions]').evaluateAll((as) => as.map((a) => a.getAttribute('href')));
      assert(hrefs.length >= 3, `directions on every tonight card (${hrefs.length})`);
      for (const h of hrefs) assert(h.startsWith(host) && h.includes('40100%20Six%20Mile%20Rd'), h);
      await ctx.close();
    }
    // A player who is NOT in tonight's game sees Directions on it too (and Court 3).
    const { ctx, page } = await openPlayer('Harper');
    const c = card(page, courtGame.id);
    assert((await c.locator('[data-gd-directions]').count()) === 1 && (await c.getByRole('button', { name: /Court 3/ }).count()) === 1, 'not in: Court and Directions');
    assert((await c.locator('.tile-check').count()) === 0, 'no check badge when not in');
    await ctx.close();
  });

  await check('Pay and I paid still work on the game day card (unpaid Indy on the TBD game)', async () => {
    const { ctx, page } = await openPlayer('Indy');
    const c = card(page, tbdGame.id);
    const sent = page.waitForRequest((r) => r.url().endsWith(`/api/sessions/${tbdGame.id}/paid`) && r.method() === 'POST', { timeout: 6000 });
    await c.getByRole('button', { name: /^I paid/ }).click();
    const confirm = page.locator('dialog[open]').getByRole('button', { name: /I paid|Yes/ });
    if (await confirm.count()) await confirm.first().click();
    await sent;
    await ctx.close();
  });

  // ------------------------------------------------------------------------------------------------ organizer
  const openEdit = async (page, id) => {
    let a = page.locator(`article#session-${id}`);
    if (!(await a.count())) {
      const all = page.locator('button', { hasText: /^Show all/ });
      if (await all.count()) await all.click();
      await page.locator(`div#session-${id}`).click();
      a = page.locator(`article#session-${id}`);
      await a.waitFor();
    }
    await a.locator('button[aria-label^="Game menu"]').click();
    await page.getByRole('menuitem', { name: /Edit game/ }).click();
    await page.locator('dialog.sheet[open] form.edit-game').waitFor();
    await page.waitForTimeout(400);
  };
  for (const scheme of ['light', 'dark']) {
    await check(`Edit game (${scheme}): Court row "Not set" in blue, the map picks a court in one tap, Save stores it, the player card shows it`, async () => {
      const { ctx, page } = await openAdmin(390, scheme);
      await openEdit(page, tbdGame.id);
      const row = page.locator('dialog.sheet[open] [data-court-row]');
      assert((await row.innerText()).replace(/\s+/g, ' ').trim() === 'Court Not set', await row.innerText());
      const blue = await row.locator('.gd-court-value').evaluate((e) => getComputedStyle(e).color);
      assert(blue === (scheme === 'light' ? 'rgb(42, 63, 176)' : 'rgb(165, 181, 238)'), `Not set is blue: ${blue}`);
      await shot(page, `edit-unset-${scheme}`);
      await row.click();
      const map = page.locator('dialog.cm[open]');
      await map.waitFor();
      assert((await map.locator('button[data-court-cell]').count()) === 16, '16 court buttons');
      assert((await map.getByRole('button', { name: 'Not set yet' }).count()) === 1, 'Not set yet pill');
      await shot(page, `picker-${scheme}`);
      await map.locator('[data-court-cell="7"]').click();
      await page.waitForTimeout(300);
      assert((await page.locator('dialog.cm[open]').count()) === 0, 'one tap picks and closes');
      assert((await row.innerText()).replace(/\s+/g, ' ').trim() === 'Court Court 7', await row.innerText());
      const saved = page.waitForResponse((r) => r.url().endsWith(`/api/admin/sessions/${tbdGame.id}/court-number`) && r.request().method() === 'PUT');
      await page.locator('dialog.sheet[open]').getByRole('button', { name: 'Save' }).click();
      assert((await saved).ok(), 'saved');
      await page.waitForTimeout(800);
      assert((await dash()).sessions.find((s) => s.id === tbdGame.id).courtNum === 7, 'court 7 stored');
      const p = await openPlayer('Indy');
      assert((await card(p.page, tbdGame.id).locator('.gd-btn').first().innerText()) === 'Court 7', 'the card says Court 7');
      await p.ctx.close();
      // Clear it again with "Not set yet".
      await openEdit(page, tbdGame.id);
      await page.locator('dialog.sheet[open] [data-court-row]').click();
      await page.locator('dialog.cm[open]').getByRole('button', { name: 'Not set yet' }).click();
      await page.locator('dialog.sheet[open]').getByRole('button', { name: 'Save' }).click();
      await page.waitForTimeout(900);
      assert(!('courtNum' in (await dash()).sessions.find((s) => s.id === tbdGame.id)), 'cleared');
      await ctx.close();
    });
  }

  await check('Add game: the Court row picks a court and the new game has it; the note is never touched', async () => {
    const { ctx, page } = await openAdmin(390, 'light');
    await page.getByRole('button', { name: /\+ Add game/ }).first().click();
    const sheet = page.locator('dialog.sheet[open]');
    await sheet.locator('[data-court-row]').waitFor();
    await sheet.locator('input[type="date"]').fill('2026-11-21');
    await sheet.locator('[data-court-row]').click();
    await page.locator('dialog.cm[open] [data-court-cell="12"]').click();
    await sheet.getByRole('button', { name: /Add game/ }).click();
    await page.waitForTimeout(1000);
    const g = (await dash()).sessions.find((s) => s.startsAt.startsWith('2026-11-2') && s.courtNum === 12);
    assert(g && (g.note === null || g.note === undefined || g.note === ''), `new game on court 12 ${JSON.stringify(g && { note: g.note })}`);
    await ctx.close();
  });

  await check('a player and the read-only PIN cannot set a court (refused, nothing saved)', async () => {
    const pctx = await browser.newContext();
    await post(pctx.request, '/api/me', { playerId: idOf('Jordan') });
    const r1 = await pctx.request.put(`${BASE}/api/admin/sessions/${courtGame.id}/court-number`, { data: { court: 9 }, headers: { Origin: BASE, 'X-Game-Day-Card': 'on' } });
    assert(r1.status() === 401, `player ${r1.status()}`);
    const ro = (await browser.newContext()).request;
    assert((await post(ro, '/api/admin/login', { pin: RO_PIN })).ok(), 'read-only sign in');
    const r2 = await ro.put(`${BASE}/api/admin/sessions/${courtGame.id}/court-number`, { data: { court: 9 }, headers: { Origin: BASE } });
    assert(r2.status() === 403, `read-only ${r2.status()}`);
    assert((await dash()).sessions.find((s) => s.id === courtGame.id).courtNum === 3, 'still court 3');
    await pctx.close();
  });

  await check('Settings > Feature switches: the "Game day card" row turns it off for everyone (players lose the card) and back on', async () => {
    const { ctx, page } = await openAdmin(390, 'light');
    await page.locator('.tabbar button', { hasText: 'Settings' }).evaluate((x) => x.click());
    await page.waitForTimeout(500);
    for (const s of await page.locator('details > summary').all()) await s.click().catch(() => {});
    const sw = page.locator('[data-row="gameDayCardAll"] input[role="switch"]');
    assert(await sw.isChecked(), 'on from the seed');
    await sw.click();
    await page.waitForTimeout(1200);
    assert((await dash()).gameDayCardForAll === undefined, 'off saved');
    const p = await openPlayer('Indy');
    assert((await p.page.locator('article.gd').count()) === 0, 'no game day card with the row off');
    assert((await p.page.locator('html[data-game-day]').count()) === 0, 'no html marker');
    await p.ctx.close();
    const q = await openPlayer('Indy', 390, 'light', { url: '/?gameday=on' });
    assert((await q.page.locator('article.gd').count()) >= 2, 'the private link shows it on this phone only');
    await q.ctx.close();
    await sw.click();
    await page.waitForTimeout(1200);
    assert((await dash()).gameDayCardForAll === true, 'on again');
    await ctx.close();
  });

  await check('preview only: ?gamedaytest=on shows the NEXT game as the game day card on a day with no game (late Saturday, every game that day over)', async () => {
    await clock(SAT_MS);
    try {
      const plain = await openPlayer('Indy', 390, 'light', { at: SAT_MS });
      assert((await plain.page.locator('article.gd').count()) === 0, 'Saturday: no game day card');
      await plain.ctx.close();
      const t = await openPlayer('Indy', 390, 'light', { at: SAT_MS, url: '/?gamedaytest=on' });
      const gd = t.page.locator('article.gd');
      assert((await gd.count()) >= 1, 'the next game is drawn as game day');
      assert(/TONIGHT/.test(await gd.first().locator('.tile').innerText()), 'with the TONIGHT tile');
      await shot(t.page, 'gamedaytest');
      await t.ctx.close();
    } finally {
      await clock(NOW_MS);
    }
  });

  await browser.close();
  console.log(`\nzip14: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
