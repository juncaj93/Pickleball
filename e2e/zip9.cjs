/* Zip 9: Short games (1.5 hour games) and Card time and buttons (time line under the date tile, joined Calendar | Directions button).
 *
 *   node e2e/zip9.cjs      (also run by npm run test:e2e)
 *
 * Loads the fake preview world as if it were Fri Nov 6, 2026, 10:00 AM Eastern into a local file, starts its own dev server on it with the
 * server clock pinned, and drives a phone-sized browser. Both switches are checked OFF (Settings rows off, no private link: the cards and
 * the organizer screens look exactly as before) and ON (light and dark, 390, 360 and 320 px). Nothing here touches Cloudflare or the live site.
 * Screenshots: e2e/screenshots/zip9-*.png (ignored by git).
 */
const { spawn, spawnSync } = require('node:child_process');
const { readFileSync, mkdirSync, rmSync } = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.E2E_PORT) || 5294;
const BASE = `http://localhost:${PORT}`;
const NOW_ISO = '2026-11-06T15:00:00.000Z';
const NOW_MS = Date.parse(NOW_ISO);
const SHOTS = process.env.E2E_SHOTS || path.join(__dirname, 'screenshots');
const PIN = /PIN `(\d{6})`/.exec(readFileSync(path.join(ROOT, 'docs/PREVIEW_FAKE_DB.md'), 'utf8'))[1];

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
  const dbFile = path.join(ROOT, '.data', 'zip9.sqlite');
  mkdirSync(path.join(ROOT, '.data'), { recursive: true });
  rmSync(dbFile, { force: true });
  const seeded = spawnSync('npx', ['vite-node', 'scripts/load-seed-local.ts', '--', dbFile, NOW_ISO], { cwd: ROOT, encoding: 'utf8' });
  if (seeded.status !== 0) throw new Error(`could not build the fake world: ${seeded.stderr || seeded.stdout}`);
  const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
    cwd: ROOT,
    env: { ...process.env, DEV_DB: dbFile, SETUP_TOKEN: 'zip9-setup-token-0123456789', DEV_CLOCK: '1', TEXTS_R2: 'on', MONEY_REWORK: 'on', INSTANT_TAPS: 'on', LATE_FEES: 'on', LATE_FEE_SPLIT: 'on' },
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
  const setSwitches = async (on) => {
    for (const p of ['/api/admin/short-games-switch', '/api/admin/card-time-switch']) {
      const r = await real.put(BASE + p, { data: { on }, headers: { Origin: BASE } });
      if (!r.ok()) throw new Error(`${p}: ${r.status()}`);
    }
  };
  const d0 = await dash();
  const nameId = (name) => d0.players.find((p) => p.name === name).id;
  const shortGame = d0.sessions.find((s) => Date.parse(s.endsAt) - Date.parse(s.startsAt) === 90 * 60_000 && !s.note);
  if (!shortGame) throw new Error('the seed has no 1.5 hour game');
  const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
  const phone = (width, scheme = 'light', height = 900) => ({ viewport: { width, height }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, colorScheme: scheme, userAgent: UA });
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
  async function openAdmin({ width = 390, scheme = 'light' } = {}) {
    const ctx = await browser.newContext(phone(width, scheme, 800));
    await ctx.addInitScript(shift, NOW_MS - Date.now());
    await post(ctx.request, '/api/admin/login', { pin: PIN });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${BASE}/admin`);
    await page.locator('.tabbar').waitFor();
    await page.waitForTimeout(800);
    return { ctx, page, errors };
  }
  async function openPlayer(name, { width = 390, scheme = 'light', height = 1400 } = {}) {
    const ctx = await browser.newContext(phone(width, scheme, height));
    await ctx.addInitScript(shift, NOW_MS - Date.now());
    await ctx.addInitScript(() => localStorage.setItem('pb_games_filter', 'all'));
    await post(ctx.request, '/api/me', { playerId: nameId(name) }, { 'X-Group-Key': String(d0.group.privateLink).split('/g/')[1] }).catch(() => {});
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(BASE + String(d0.group.privateLink).replace(/^https?:\/\/[^/]+/, ''));
    await page.waitForTimeout(800);
    const picker = page.locator('button', { hasText: new RegExp(`^${name}$`) });
    if (await picker.count()) await picker.first().click().catch(() => {});
    await page.locator('.schedule article').first().waitFor({ timeout: 8000 });
    // Later games sit behind "More sessions" (Home collapse): open it so every tier shows.
    const more = page.getByRole('button', { name: /More sessions/ });
    if (await more.count()) await more.first().click();
    await page.waitForTimeout(600);
    return { ctx, page, errors };
  }
  const shot = async (page, name, full = true) => (await page.waitForTimeout(350), page.screenshot({ path: path.join(SHOTS, `zip9-${name}.png`), fullPage: full }));
  const card = (page, id) => page.locator(`#row-${id}`);

  // ------------------------------------------------------------ OFF
  await setSwitches(false);
  await check('OFF: player cards have no time line, no joined button (the old calendar icon), $14 on the 1.5 hour game', async () => {
    const { ctx, page, errors } = await openPlayer('Jordan');
    assert((await page.locator('[data-card-buttons]').count()) === 0, 'no joined button');
    assert((await page.locator('.z9-length').count()) === 0, 'no length line');
    const c = card(page, shortGame.id);
    assert((await c.count()) === 1, 'the short game card');
    const text = await c.innerText();
    assert(/\$14 due/.test(text), `"$14 due" with the switch off: ${text}`);
    // A non-2-hour game keeps the old "–9 PM" end line under the tile.
    assert(/9 PM/.test(await c.locator('[data-sched-time]').innerText()), 'old end line');
    assert((await page.locator('.cal-icon-link').count()) > 0, 'old calendar icon');
    await shot(page, 'off-player');
    assert(errors.length === 0, errors.join(' | '));
    await ctx.close();
  });
  await check('OFF: Add game 7:30 to 9:00 PM shows no heads-up; no tag on the organizer Home', async () => {
    const { ctx, page, errors } = await openAdmin();
    assert((await page.locator('[data-short-tag]').count()) === 0, 'no tag');
    await page.getByRole('button', { name: /\+ Add game/ }).first().click();
    await page.waitForTimeout(400);
    const selects = page.locator('.add-game select');
    if ((await selects.count()) === 2) {
      await selects.nth(0).selectOption('19:30');
      await selects.nth(1).selectOption('21:00');
    } else {
      await page.locator('.add-game input[type="time"]').nth(0).fill('19:30');
      await page.locator('.add-game input[type="time"]').nth(1).fill('21:00');
    }
    await page.waitForTimeout(200);
    assert((await page.locator('[data-short-headsup]').count()) === 0, 'no heads-up when off');
    assert(errors.length === 0, errors.join(' | '));
    await ctx.close();
  });

  // ------------------------------------------------------------ ON
  await setSwitches(true);
  for (const scheme of ['light', 'dark']) {
    await check(`ON ${scheme}: Add game, 7:30 to 9:00 PM: the heads-up under the times; it goes away at 9:30 PM`, async () => {
      const { ctx, page, errors } = await openAdmin({ scheme });
      await page.getByRole('button', { name: /\+ Add game/ }).first().click();
      await page.waitForTimeout(400);
      const selects = page.locator('.add-game select');
      const setTimes = async (a, b) => {
        if ((await selects.count()) === 2) {
          await selects.nth(0).selectOption(a);
          await selects.nth(1).selectOption(b);
        } else {
          await page.locator('.add-game input[type="time"]').nth(0).fill(a);
          await page.locator('.add-game input[type="time"]').nth(1).fill(b);
        }
        await page.waitForTimeout(200);
      };
      await setTimes('19:30', '21:00');
      const box = page.locator('[data-short-headsup]');
      assert((await box.count()) === 1, 'heads-up shows');
      const t = (await box.innerText()).replace(/\s+/g, ' ');
      assert(t.includes('1.5 hour game') && t.includes('Court $36. Players pay $11 each (4 in), less if more join.'), t);
      await box.scrollIntoViewIfNeeded();
      await shot(page, `on-addgame-${scheme}`, false);
      await setTimes('19:30', '21:30');
      assert((await box.count()) === 0, 'gone at 2 hours');
      await setTimes('19:30', '20:30');
      assert((await box.count()) === 0, 'gone at 1 hour');
      assert(errors.length === 0, errors.join(' | '));
      await ctx.close();
    });
    await check(`ON ${scheme}: the organizer tag "1.5 hr game · $11 each" on the 1.5 hour game only`, async () => {
      const { ctx, page, errors } = await openAdmin({ scheme });
      // Home lists the first games; the rest sit behind "Show all N".
      const all = page.getByRole('button', { name: /Show all/ });
      if (await all.count()) await all.first().click();
      await page.waitForTimeout(600);
      if (process.env.E2E_DEBUG) console.log(await page.evaluate((id) => { const el = document.getElementById(`session-${id}`); return el ? el.outerHTML.slice(0, 3000) : 'MISSING ' + [...document.querySelectorAll('[id^=session-]')].map((e) => e.id + ':' + e.className).join(' '); }, shortGame.id));
      const tags = page.locator('[data-short-tag]');
      const rowsText = await page.locator(`#session-${shortGame.id}`).innerText().catch(() => '');
      const n = await tags.count();
      assert(n > 0 || /1\.5 hr game · \$11 each/.test(rowsText), `a tag on the short game (${n}) ${rowsText}`);
      if (n > 0) assert((await tags.first().innerText()).includes('1.5 HR'), 'pill text');
      // Every fact once: no other "1.5 hour" words on the short game's own card or row.
      assert(!/1\.5 hour/i.test(rowsText), `no second length on the organizer card: ${rowsText}`);
      // The TONIGHT and TOM tiles (Zip 9 fix): the ring covers the tile's edge exactly and the strip runs under it, so no light line shows.
      const tiles = await page.evaluate(() => [...document.querySelectorAll('.admin-page .tile.ts.day-tonight, .admin-page .tile.ts.day-tomorrow')].map((el) => {
        const r = el.getBoundingClientRect();
        const ring = el.querySelector('.tb-solid');
        const rr = ring.getBoundingClientRect();
        const tag = el.querySelector('.day-tag').getBoundingClientRect();
        const cs = getComputedStyle(ring);
        return { inset: cs.boxShadow.includes('inset'), bw: parseFloat(cs.borderLeftWidth), ringOut: [r.left - rr.left, rr.right - r.right], tag: [tag.left - rr.left, rr.right - tag.right], clip: getComputedStyle(el).backgroundClip };
      }));
      assert(tiles.length >= 2, `TONIGHT and TOM tiles (${tiles.length})`);
      for (const t of tiles) {
        assert(t.inset && t.bw === 0, `ring is an inset shadow: ${JSON.stringify(t)}`);
        assert(t.ringOut[0] >= 0 && t.ringOut[1] >= 0, `ring reaches past the tile edge: ${JSON.stringify(t)}`);
        assert(Math.abs(t.tag[0]) < 0.01 && Math.abs(t.tag[1]) < 0.01, `strip runs to the ring's outer edge: ${JSON.stringify(t)}`);
        assert(t.clip === 'border-box', `fill to the outer edge: ${JSON.stringify(t)}`);
      }
      // The tile keeps its height and the word and date stay where they were (the strip starts 1.5 px higher and is 1.5 px taller on top):
      // the word starts 5 px below the tile's inner top edge, as before the fix, and the TONIGHT/TOM tile is as tall as on main (60.34 px at 390).
      const spots = await page.evaluate(() => [...document.querySelectorAll('.admin-page .scard .tile.ts.day-tonight, .admin-page .scard .tile.ts.day-tomorrow')].map((el) => {
        const tag = el.querySelector('.day-tag');
        const r = el.getBoundingClientRect();
        const word = tag.getBoundingClientRect().top + parseFloat(getComputedStyle(tag).paddingTop) - (r.top + parseFloat(getComputedStyle(el).borderTopWidth));
        return { word, h: r.height };
      }));
      for (const x of spots) assert(Math.abs(x.word - 5) < 0.05 && Math.abs(x.h - Number(process.env.ZIP9_TILE_H || 60.34375)) < 0.5, `word and height as before: ${JSON.stringify(spots)}`);
      // The normal games carry none.
      for (const s of d0.sessions.filter((x) => x.id !== shortGame.id).slice(0, 6)) {
        const t = await page.locator(`#session-${s.id}`).innerText().catch(() => '');
        assert(!/1\.5 h/i.test(t), `no tag on ${s.startsAt}`);
      }
      await page.locator(`#session-${shortGame.id}`).scrollIntoViewIfNeeded().catch(() => {});
      await shot(page, `on-admin-home-${scheme}`);
      assert(errors.length === 0, errors.join(' | '));
      await ctx.close();
    });
    for (const width of [390, 360, 320]) {
      await check(`ON ${scheme} ${width}px: "$11 due", the time line in every tier, the joined button, 44 px tap areas, no sideways scroll`, async () => {
        const { ctx, page, errors } = await openPlayer('Jordan', { width, scheme });
        const c = card(page, shortGame.id);
        const text = await c.innerText();
        assert(/\$11 due/.test(text), `"$11 due": ${text}`);
        // Every fact once (Alex, Nov 6): the length only under the time, the price only on the pill.
        assert((text.match(/1\.5 hour/g) || []).length === 1, `"1.5 hours" once: ${text}`);
        assert((text.match(/\$11/g) || []).length === 1, `"$11" once: ${text}`);
        assert((await c.locator('.game-note').count()) === 0, 'no note chip on the 1.5 hour game');
        assert((await c.locator('.z9-length').innerText()) === '1.5 hours', 'short game says 1.5 hours');
        // Every tier shows a start time and a length line.
        const tiers = await page.evaluate(() => [...document.querySelectorAll('.schedule article.sched')].map((a) => ({ tier: a.getAttribute('data-tier'), len: a.querySelector('.z9-length')?.textContent ?? null, time: a.querySelector('[data-sched-time] span')?.textContent ?? null })));
        for (const t of tiers) assert(t.len && t.time, `tier ${t.tier}: time ${t.time} length ${t.len}`);
        const seen = new Set(tiers.map((t) => t.tier));
        assert(seen.has('this') || seen.has('next'), `tiers seen: ${[...seen]}`);
        assert(tiers.some((t) => t.len === '2 hours'), 'a 2 hour game says 2 hours');
        // The joined button, only on cards where Jordan is in.
        const buttons = page.locator('[data-card-buttons]');
        assert((await buttons.count()) > 0, 'joined button');
        const inCards = await page.locator('.schedule article[data-mine="in"]').count();
        assert((await buttons.count()) <= inCards, `only on "You're in" cards (${await buttons.count()} of ${inCards})`);
        assert((await page.locator('.schedule article:not([data-mine="in"]) [data-card-buttons]').count()) === 0, 'never on a card you are not in');
        const b = c.locator('[data-card-buttons]');
        assert((await b.count()) === 1, 'joined button on the short game');
        const cal = b.locator('[data-card-calendar]');
        const dir = b.locator('[data-card-directions]');
        assert((await cal.getAttribute('aria-label')) === 'Add to calendar', 'calendar label');
        assert((await dir.getAttribute('aria-label')) === 'Directions', 'directions label');
        assert((await cal.getAttribute('href')) === `/api/sessions/${shortGame.id}/calendar.ics`, 'calendar href');
        const href = await dir.getAttribute('href');
        assert(href === 'https://maps.apple.com/?daddr=Northville+Pickleball+Club', `iPhone maps link: ${href}`);
        // Size: about 26 px tall, icons about 15 px, and each half has a 44 px tall hit area (the ::before).
        const m = await b.evaluate((el) => {
          const r = el.getBoundingClientRect();
          const halves = [...el.querySelectorAll('.z9-half')].map((h) => {
            const hr = h.getBoundingClientRect();
            const before = getComputedStyle(h, '::before');
            return { w: hr.width, h: hr.height, top: parseFloat(before.top), bottom: parseFloat(before.bottom), icon: h.querySelector('svg').getBoundingClientRect().height };
          });
          const card = el.closest('article').getBoundingClientRect();
          return { h: r.height, right: card.right - r.right, top: r.top - card.top, halves };
        });
        assert(m.h >= 24 && m.h <= 28, `height ${m.h}`);
        for (const h of m.halves) {
          assert(Math.abs(h.icon - 15) <= 1, `icon ${h.icon}`);
          const hit = h.h + -h.top + -h.bottom;
          assert(hit >= 44, `hit area ${hit}`);
        }
        assert(m.right < 40, `top right of the card (${m.right} px from the right edge)`);
        // The time line: start then length, smaller and gray.
        const style = await c.locator('.z9-length').evaluate((el) => ({ fs: parseFloat(getComputedStyle(el).fontSize), pfs: parseFloat(getComputedStyle(el.parentElement).fontSize), color: getComputedStyle(el).color }));
        assert(style.fs < style.pfs, `smaller (${style.fs} < ${style.pfs})`);
        const w = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, inner: window.innerWidth }));
        assert(w.doc <= w.inner, `no sideways scroll (${w.doc} > ${w.inner})`);
        await shot(page, `on-player-${scheme}-${width}`);
        assert(errors.length === 0, errors.join(' | '));
        await ctx.close();
      });
    }
  }
  await check('ON: Directions on Android is the Google maps link; a tap on Pay asks for $11', async () => {
    const ctx = await browser.newContext({ ...phone(390), userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36' });
    await ctx.addInitScript(shift, NOW_MS - Date.now());
    await post(ctx.request, '/api/me', { playerId: nameId('Jordan') }, { 'X-Group-Key': String(d0.group.privateLink).split('/g/')[1] });
    const page = await ctx.newPage();
    await page.goto(BASE + String(d0.group.privateLink).replace(/^https?:\/\/[^/]+/, ''));
    await page.locator('.schedule article').first().waitFor();
    await page.waitForTimeout(600);
    const href = await card(page, shortGame.id).locator('[data-card-directions]').getAttribute('href');
    assert(href === 'https://www.google.com/maps/dir/?api=1&destination=Northville+Pickleball+Club', href);
    const text = await card(page, shortGame.id).innerText();
    assert(/\$11 due/.test(text) && /Pay/.test(text), `"$11 due" and Pay: ${text}`);
    const labels = await card(page, shortGame.id).locator('[aria-label*="Pay"]').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
    for (const l of labels) assert(!/\$14/.test(l), `no $14 on Pay: ${l}`);
    await ctx.close();
  });
  await check('ON: the calendar half downloads a 90 minute event for the 1.5 hour game', async () => {
    const res = await fetch(`${BASE}/api/sessions/${shortGame.id}/calendar.ics`);
    const text = await res.text();
    const s = /DTSTART;TZID=[^:]+:\d{8}T(\d{6})/.exec(text)[1];
    const e = /DTEND;TZID=[^:]+:\d{8}T(\d{6})/.exec(text)[1];
    assert(s === '193000' && e === '210000', `${s} to ${e}`);
  });
  await check('Settings > Feature switches shows the two rows, newest first, and they turn the switches off and on', async () => {
    const { ctx, page, errors } = await openAdmin();
    await page.locator('.tabbar button', { hasText: 'Settings' }).first().evaluate((x) => x.click());
    await page.waitForTimeout(600);
    for (const x of await page.locator('details > summary').all()) await x.click().catch(() => {});
    const sg = page.locator('[data-short-games-all]');
    const ct = page.locator('[data-card-time-all]');
    assert((await sg.count()) === 1 && (await ct.count()) === 1, 'both rows');
    assert(await sg.isChecked(), 'Short games on');
    await sg.scrollIntoViewIfNeeded();
    await shot(page, 'on-settings', false);
    await sg.click();
    await page.waitForTimeout(900);
    assert((await dash()).shortGamesForAll === false, 'switched off by the row');
    await sg.click();
    await page.waitForTimeout(900);
    assert((await dash()).shortGamesForAll === true, 'switched on again');
    assert(errors.length === 0, errors.join(' | '));
    await ctx.close();
  });

  await browser.close();
  console.log(`zip9: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
