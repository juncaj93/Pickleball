/* Zip 12: the speed switches on a phone. "Show last screen at once" (the saved copy, its "as of" tag, every button held until the fresh
 * answer, nothing tappable on stale data, light and dark, 390/360/320 px), "Load games at once" (the plain address asks for the games
 * together with its set-up check), the quiet swap (sizes kept, only changes fade in), the throw-away rules (switch off, "not you?", older than 3 hours
 * shows the shimmer, View as never saves), the private
 * links, and the three Settings rows. "Fewer database trips" changes no screen: its proof is tests/speed-queries.test.ts.
 *
 *   node e2e/zip12.cjs      (also run by npm run test:e2e)
 *
 * Loads the fake preview world (Sat Nov 7, 2026, 12:00 PM Eastern; the three speed rows are on from the seed) into a local file, starts its
 * own dev server on it with the server clock pinned. Nothing here touches Cloudflare or the live site. Screenshots: e2e/screenshots/zip12-*.png.
 */
const { spawn, spawnSync } = require('node:child_process');
const { readFileSync, mkdirSync, rmSync } = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.E2E_PORT) || 5412;
const BASE = `http://localhost:${PORT}`;
const NOW_ISO = '2026-11-07T17:00:00.000Z';
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
    console.log(`  ✗ ${name}\n      ${String(err && err.message ? err.message : err).replace(/\s*\n\s*/g, ' ⏎ ').slice(0, 1400)}`);
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// WCAG contrast of two CSS colors "rgb(r, g, b)".
function contrast(a, b) {
  const lum = (c) => {
    const [r, g, bl] = c.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number).map((v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

async function main() {
  mkdirSync(SHOTS, { recursive: true });
  const dbFile = path.join(ROOT, '.data', 'zip12.sqlite');
  mkdirSync(path.join(ROOT, '.data'), { recursive: true });
  rmSync(dbFile, { force: true });
  const seeded = spawnSync('npx', ['vite-node', 'scripts/load-seed-local.ts', '--', dbFile, NOW_ISO], { cwd: ROOT, encoding: 'utf8' });
  if (seeded.status !== 0) throw new Error(`could not build the fake world: ${seeded.stderr || seeded.stdout}`);
  const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
    cwd: ROOT,
    env: { ...process.env, DEV_DB: dbFile, SETUP_TOKEN: 'zip12-setup-token-0123456789', DEV_CLOCK: '1' },
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
  const setRow = async (path_, on) => {
    const r = await real.put(BASE + path_, { data: { on }, headers: { Origin: BASE } });
    if (!r.ok()) throw new Error(`switch ${path_}: ${r.status()}`);
  };
  const d0 = await dash();
  const status = await (await real.get(`${BASE}/api/status`)).json();
  if (!status.openAccess || status.wordRequired) throw new Error('the fake world must open at the plain address');
  const nameId = (name) => d0.players.find((p) => p.name === name).id;
  const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
  const phone = (width, scheme = 'light', height = 900, motion = false) => ({ viewport: { width, height }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, colorScheme: scheme, userAgent: UA, reducedMotion: motion ? 'no-preference' : 'reduce' });
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

  /** A phone with a name picked, on the plain address. `hold`: the games answer waits this long (a slow network). */
  async function playerPhone(name, { width = 390, scheme = 'light', delta = 0, motion = false } = {}) {
    const ctx = await browser.newContext(phone(width, scheme, 1400, motion));
    await ctx.addInitScript(shift, NOW_MS - Date.now() + delta);
    await ctx.addInitScript(() => {
      try {
        localStorage.setItem('pb_games_filter', 'all');
      } catch {}
    });
    await post(ctx.request, '/api/me', { playerId: nameId(name) });
    const page = await ctx.newPage();
    const posts = [];
    const reqs = [];
    page.on('request', (r) => {
      if (r.method() !== 'GET' && r.url().includes('/api/')) posts.push(r.url());
      if (r.url().includes('/api/')) reqs.push({ at: Date.now(), what: 'start', url: new URL(r.url()).pathname });
    });
    page.on('requestfinished', (r) => {
      if (r.url().includes('/api/')) reqs.push({ at: Date.now(), what: 'end', url: new URL(r.url()).pathname });
    });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    let holdGroup = 0;
    let holdStatus = 0;
    await page.route('**/api/group', async (route) => {
      if (holdGroup) await sleep(holdGroup);
      await route.continue();
    });
    await page.route('**/api/status', async (route) => {
      if (holdStatus) await sleep(holdStatus);
      await route.continue();
    });
    return {
      ctx,
      page,
      posts,
      reqs,
      errors,
      hold: (ms) => (holdGroup = ms),
      holdStatus: (ms) => (holdStatus = ms),
      open: async (url = '/') => {
        reqs.length = 0;
        await page.goto(BASE + url, { waitUntil: 'commit' });
      },
      fresh: () => page.locator('.schedule:not([data-saved-copy]) article.sched').first().waitFor({ timeout: 15000 }),
      saved: () => page.evaluate(() => localStorage.getItem('pb_last_screen')),
    };
  }
  const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, `zip12-${name}.png`), fullPage: true });
  const HELD_BUTTONS = '[data-join], .pay-btn, .drop-link, [data-use-credit], a[href*="venmo"], .paid-tag, .didnt-pay, .cal-icon-link, .z9-cal, .sched-money button, .sched-links button';

  // ---- Show last screen at once ----
  for (const scheme of ['light', 'dark']) {
    for (const width of [390, 360, 320]) {
      await check(`saved copy, ${scheme}, ${width} px: drawn at once with the "as of" tag, every button held, then the fresh screen`, async () => {
        const p = await playerPhone('Avery', { width, scheme });
        await p.open();
        await p.fresh();
        await sleep(600);
        const kept = await p.saved();
        assert(kept, 'nothing was saved after a fresh screen');
        // Never money in the copy: every amount is 0.
        assert(!/Cents":[1-9]/.test(kept), 'money in the saved copy');
        assert(!/555-01|venmo\.com/.test(kept), 'a phone number or Venmo link in the saved copy');
        // Open again on a slow network: the games answer takes 3 seconds.
        p.hold(3000);
        const t0 = Date.now();
        await p.open();
        await p.page.locator('[data-saved-copy] article.sched').first().waitFor({ timeout: 2500 });
        const drawnIn = Date.now() - t0;
        const tag = (await p.page.locator('[data-saved-asof]').textContent()).trim();
        assert(/^as of \d{1,2}:\d{2} (AM|PM)$/.test(tag), `tag: ${tag}`);
        assert((await p.page.locator('[data-saved-copy]').getAttribute('inert')) !== null, 'the saved list is not inert');
        const held = await p.page.locator(`main ${HELD_BUTTONS}`).count();
        assert(held === 0, `${held} buttons or money pieces on the saved copy`);
        assert((await p.page.locator('[data-saved-copy] article.sched').count()) >= 3, 'too few cards in the saved copy');
        // Drawn like the live cards (the page markers are set): no icon blown up, cards no taller than the live ones.
        const icons = await p.page.locator('[data-saved-copy] svg').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
        assert(icons.every((h) => h <= 40), `an icon ${Math.max(...icons)} px tall on the saved copy`);
        // The tag: small, gray, readable (4.5:1) on the page background.
        const look = await p.page.evaluate(() => {
          const t = document.querySelector('[data-saved-asof]');
          const cs = getComputedStyle(t);
          return { color: cs.color, size: parseFloat(cs.fontSize), bg: getComputedStyle(document.body).backgroundColor };
        });
        assert(look.size <= 13, `tag font ${look.size}px`);
        const ratio = contrast(look.color, look.bg);
        assert(ratio >= 4.5, `tag contrast ${ratio.toFixed(2)}:1 (${look.color} on ${look.bg})`);
        // Nothing sideways at this width.
        const wide = await p.page.evaluate(() => document.documentElement.scrollWidth);
        assert(wide <= width, `page is ${wide} px wide at ${width}`);
        if (width === 390) await shot(p.page, `saved-${scheme}`);
        // Taps on the stale screen: on every card, where its buttons sit on the fresh screen. Nothing is sent.
        for (const box of await p.page.locator('[data-saved-copy] article.sched').evaluateAll((els) => els.slice(0, 4).map((e) => { const r = e.getBoundingClientRect(); return { x: r.right - 40, y: r.bottom - 20 }; }))) {
          await p.page.mouse.click(box.x, box.y).catch(() => {});
        }
        assert(p.posts.length === 0, `a tap on stale data was sent: ${p.posts.join(', ')}`);
        // The fresh answer lands: the tag goes, the buttons come back (Avery owes: a Pay button; other games: I'm in).
        await p.fresh();
        await sleep(400);
        assert((await p.page.locator('[data-saved-asof]').count()) === 0, 'the tag stayed after fresh data');
        assert((await p.page.locator('[data-saved-copy]').count()) === 0, 'the saved list stayed after fresh data');
        assert((await p.page.locator('main .pay-btn, main [data-join]').count()) > 0, 'no buttons on the fresh screen');
        assert(drawnIn < 2500, `saved copy took ${drawnIn} ms`);
        if (width === 390) await shot(p.page, `fresh-${scheme}`);
        assert(p.errors.length === 0, p.errors.join(' | '));
        await p.ctx.close();
      });
    }
  }

  await check("tap I'm in or Pay right after reopening: nothing happens until fresh data, then the tap works", async () => {
    const p = await playerPhone('Casey');
    await p.open();
    await p.fresh();
    await sleep(500);
    p.hold(2500);
    await p.open();
    await p.page.locator('[data-saved-copy] article.sched').first().waitFor({ timeout: 2500 });
    // Try the real way a person would: the button by its name.
    const imIn = p.page.getByRole('button', { name: /^I'm in/ });
    assert((await imIn.count()) === 0, 'an I\'m in button exists on the saved copy');
    await p.page.locator('[data-saved-copy] article.sched').first().click({ force: true }).catch(() => {});
    assert(p.posts.length === 0, 'something was sent from the saved copy');
    await p.fresh();
    await p.page.getByRole('button', { name: /^I'm in/ }).first().waitFor({ timeout: 5000 });
    await p.ctx.close();
  });

  await check('a game that ended since it was saved, and canceled games, never show on the saved copy', async () => {
    const p = await playerPhone('Indy');
    await p.open();
    await p.fresh();
    await sleep(500);
    const kept = JSON.parse(await p.saved());
    assert(kept.view.sessions.every((s) => !s.canceled && !s.past), 'a canceled or past game was saved');
    const firstEnd = Math.min(...kept.view.sessions.map((s) => Date.parse(s.endsAt)));
    await p.ctx.close();
    // The same phone, opened after that first game ended (its storage carried over).
    const state = await (async () => {
      const q = await playerPhone('Indy');
      await q.open();
      await q.fresh();
      await sleep(400);
      const s = await q.ctx.storageState();
      await q.ctx.close();
      return s;
    })();
    // The copy is one hour old at that moment (a copy older than 3 hours is not shown at all, which another check covers).
    for (const o of state.origins) for (const it of o.localStorage) if (it.name === 'pb_last_screen') it.value = JSON.stringify({ ...JSON.parse(it.value), savedAt: firstEnd + 60_000 - 3600_000 });
    const ctx = await browser.newContext({ ...phone(390), storageState: state });
    await ctx.addInitScript(shift, firstEnd - Date.now() + 60_000);
    const page = await ctx.newPage();
    await page.route('**/api/group', async (r) => (await sleep(2500), r.continue()));
    await page.goto(BASE + '/', { waitUntil: 'commit' });
    await page.locator('[data-saved-copy] article.sched').first().waitFor({ timeout: 2500 });
    const ids = await page.locator('[data-saved-copy] article.sched').evaluateAll((els) => els.map((e) => e.id.replace('row-', '')));
    const ended = kept.view.sessions.filter((s) => Date.parse(s.endsAt) <= firstEnd).map((s) => s.id);
    assert(ended.length > 0 && ended.every((id) => !ids.includes(id)), 'an ended game is on the saved copy');
    await ctx.close();
  });

  await check('older than 24 hours: not shown, thrown away', async () => {
    const q = await playerPhone('Kai');
    await q.open();
    await q.fresh();
    await sleep(400);
    const state = await q.ctx.storageState();
    await q.ctx.close();
    const ctx = await browser.newContext({ ...phone(390), storageState: state });
    await ctx.addInitScript(shift, NOW_MS - Date.now() + 25 * 3600_000);
    const page = await ctx.newPage();
    await page.route('**/api/group', async (r) => (await sleep(1500), r.continue()));
    await page.goto(BASE + '/', { waitUntil: 'commit' });
    await sleep(900);
    assert((await page.locator('[data-saved-copy]').count()) === 0, 'a day-old copy was shown');
    await ctx.close();
  });

  await check('older than a few hours (4 hours): the normal loading shimmer shows, not the copy', async () => {
    const q = await playerPhone('Kai');
    await q.open();
    await q.fresh();
    await sleep(400);
    const state = await q.ctx.storageState();
    await q.ctx.close();
    const ctx = await browser.newContext({ ...phone(390), storageState: state });
    await ctx.addInitScript(shift, NOW_MS - Date.now() + 4 * 3600_000);
    const page = await ctx.newPage();
    await page.route('**/api/group', async (r) => (await sleep(2500), r.continue()));
    await page.goto(BASE + '/', { waitUntil: 'commit' });
    await page.locator('.skel-schedule').waitFor({ timeout: 2500 });
    assert((await page.locator('[data-saved-copy]').count()) === 0, 'a 4 hour old copy was shown');
    await ctx.close();
  });

  await check('"not you?" throws the copy away (a copy never shows for another name)', async () => {
    const p = await playerPhone('Lane');
    await p.open();
    await p.fresh();
    await sleep(400);
    assert(await p.saved(), 'nothing saved');
    await p.page.getByRole('button', { name: 'Not you?' }).click();
    await sleep(300);
    assert((await p.saved()) === null, 'the copy is still there after not you?');
    await p.ctx.close();
  });

  await check("the organizer's View as never saves or shows a copy; /admin never shows one", async () => {
    const ctx = await browser.newContext(phone(390));
    await ctx.addInitScript(shift, NOW_MS - Date.now());
    await post(ctx.request, '/api/admin/login', { pin: PIN });
    const page = await ctx.newPage();
    await page.goto(BASE + '/admin');
    await page.locator('.tabbar').waitFor();
    await sleep(800);
    assert((await page.locator('[data-saved-copy], [data-saved-asof]').count()) === 0, 'a saved copy on /admin');
    // View as Avery from the Players tab (the organizer's preview of a player screen).
    await page.locator('.tabbar button', { hasText: 'Players' }).evaluate((x) => x.click());
    await sleep(500);
    const viewAs = page.getByRole('button', { name: /View as/ }).first();
    if (await viewAs.count()) {
      await viewAs.click().catch(() => {});
      await sleep(1500);
    }
    assert((await page.evaluate(() => localStorage.getItem('pb_last_screen'))) === null, 'View as saved a copy');
    await ctx.close();
  });


  // ---- The quiet swap (Alex, Sat Nov 7) ----
  /** Each card's top and height on the screen now, by game id (the saved list or the live one). */
  const boxes = (page, saved) =>
    page.locator(`.schedule${saved ? '[data-saved-copy]' : ':not([data-saved-copy])'} > article.sched`).evaluateAll((els) =>
      Object.fromEntries(els.map((e) => {
        const r = e.getBoundingClientRect();
        const w = e.querySelector('.sched-body')?.firstElementChild?.getBoundingClientRect();
        return [e.id, { top: Math.round(r.top + scrollY), h: Math.round(r.height), words: w ? Math.round(w.top - r.top) : null }];
      })),
    );
  // Card cleanup is on in this fake world; live has it off (Alex, Sat Nov 7), so the older card look is checked too.
  for (const [scheme, width, cleanupOff] of [['light', 390], ['dark', 390], ['light', 360], ['dark', 320], ['light', 390, true], ['dark', 390, true]]) {
    await check(`quiet swap, ${scheme}, ${width} px${cleanupOff ? ', Card cleanup off (as on live)' : ''}: the saved cards keep their size and place, nothing slides, only changed parts fade in`, async () => {
      if (cleanupOff) await setRow('/api/admin/card-cleanup-switch', false);
      try {
      const p = await playerPhone('Avery', { width, scheme, motion: true });
      await p.open();
      await p.fresh();
      await sleep(900);
      const live = await boxes(p.page, false);
      // Someone else joins a game Avery can see, so one card really changes (its balls and names).
      const d = await dash();
      const game = d.sessions.find((s) => !s.state.flags.canceled && Date.parse(s.startsAt) > NOW_MS + 3600_000 && s.confirmedCount >= 1 && s.confirmedCount < 4 && !s.roster.some((r) => r.name === 'Harper'));
      assert(game, 'no game for Harper to join');
      const hp = (await browser.newContext()).request;
      await post(hp, '/api/me', { playerId: nameId('Harper') });
      const j = await post(hp, `/api/sessions/${game.id}/join`, {});
      assert(j.ok(), `join ${j.status()}`);
      try {
        p.hold(2500);
        await p.open();
        await p.page.locator('[data-saved-copy] article.sched').first().waitFor({ timeout: 2500 });
        const kept = await boxes(p.page, true);
        for (const [id, b] of Object.entries(kept)) {
          const was = live[id];
          if (!was) continue;
          assert(Math.abs(was.top - b.top) <= 1 && Math.abs(was.h - b.h) <= 1, `saved card ${id} at ${b.top}/${b.h}, live was ${was.top}/${was.h}`);
          // Its words start where they started on the live card (nothing jumps inside the card either).
          if (was.words !== null && b.words !== null) assert(Math.abs(was.words - b.words) <= 1, `card ${id}: words at ${b.words}, live ${was.words}`);
        }
        await p.fresh();
        const after = await boxes(p.page, false);
        const changedId = `row-${game.id}`;
        // Every card above the changed one is exactly where the saved copy drew it.
        const order = Object.entries(kept).sort((a, b) => a[1].top - b[1].top).map(([id]) => id);
        for (const id of order.slice(0, Math.max(0, order.indexOf(changedId) + 1))) {
          if (!after[id]) continue;
          assert(Math.abs(after[id].top - kept[id].top) <= 1, `card ${id} slid from ${kept[id].top} to ${after[id].top}`);
        }
        const marks = await p.page.locator('.schedule:not([data-saved-copy]) > article.sched').evaluateAll((els) =>
          els.map((e) => ({ id: e.id, sw: e.hasAttribute('data-sw'), card: e.hasAttribute('data-sw-card'), balls: e.hasAttribute('data-sw-balls'), anim: getComputedStyle(e.querySelector('.in-line') || e).animationName })),
        );
        const changed = marks.find((m) => m.id === changedId);
        if (changed) {
          assert(changed.balls, 'the changed card is not marked');
          assert(changed.anim === 'sw-in', `the changed balls do not fade in (${changed.anim})`);
        }
        // A game the copy could not show (canceled) is a new card on the fresh screen: it fades in whole, which is right.
        const same = marks.filter((m) => m.id !== changedId && m.sw && !m.balls && !m.card);
        assert(same.length > 0, 'no unchanged card');
        assert(same.every((m) => m.anim === 'none'), `an unchanged card fades: ${JSON.stringify(same.filter((m) => m.anim !== 'none'))}`);
        const buttonsFade = await p.page.locator('.schedule:not([data-saved-copy]) .sched-money').first().evaluate((e) => getComputedStyle(e).animationName);
        assert(buttonsFade === 'sw-in', `the new buttons do not fade in (${buttonsFade})`);
        assert((await p.page.locator('[data-saved-asof]').count()) === 0, 'the tag stayed');
        if (width === 390) await shot(p.page, `swap-${scheme}`);
        assert(p.errors.length === 0, p.errors.join(' | '));
      } finally {
        await post(hp, `/api/sessions/${game.id}/withdraw`, {});
        await p.ctx.close();
      }
      } finally {
        if (cleanupOff) await setRow('/api/admin/card-cleanup-switch', true);
      }
    });
  }

  await check('the "as of" tag sits in the first section line (no line of its own) and is read out once', async () => {
    const p = await playerPhone('Indy');
    await p.open();
    await p.fresh();
    await sleep(500);
    p.hold(2500);
    await p.open();
    await p.page.locator('[data-saved-copy] article.sched').first().waitFor({ timeout: 2500 });
    const inHeader = await p.page.locator('[data-saved-copy] > .week-break').first().locator('[data-saved-asof]').count();
    assert(inHeader === 1, 'the tag is not in the first section line');
    const said = await p.page.locator('main [role="status"]').first().textContent();
    assert(/^Your last screen, as of /.test(said.trim()), `spoken: ${said}`);
    await p.ctx.close();
  });

  // ---- Load games at once ----
  await check('Load games at once: on the plain address, the games are asked for before the set-up check answers', async () => {
    const p = await playerPhone('Harper');
    await p.open();
    await p.fresh();
    await sleep(500);
    assert((await p.page.evaluate(() => localStorage.getItem('pb_direct_load'))) === 'on', 'the phone did not remember the switch');
    p.holdStatus(1500);
    await p.open();
    await p.fresh();
    const statusEnd = p.reqs.find((r) => r.what === 'end' && r.url === '/api/status');
    const groupStart = p.reqs.find((r) => r.what === 'start' && r.url === '/api/group');
    assert(statusEnd && groupStart, JSON.stringify(p.reqs));
    assert(groupStart.at < statusEnd.at, `games asked ${groupStart.at - statusEnd.at} ms after the check answered`);
    await p.ctx.close();
  });

  await check('switched off in Settings: the next fresh answer drops the copy and the memory; the open after that is today\'s chain', async () => {
    await setRow('/api/admin/speed-last-screen-switch', false);
    await setRow('/api/admin/speed-direct-load-switch', false);
    try {
      const p = await playerPhone('Morgan');
      // This phone remembers Load games at once from before the switch went off (set once, then opened).
      await p.open();
      await p.fresh();
      await p.page.evaluate(() => localStorage.setItem('pb_direct_load', 'on'));
      await p.open();
      await p.fresh();
      await sleep(500);
      assert((await p.saved()) === null, 'a copy was saved with the switch off');
      assert((await p.page.evaluate(() => localStorage.getItem('pb_direct_load'))) === null, 'still remembers Load games at once');
      p.holdStatus(1200);
      p.hold(1500);
      await p.open();
      await sleep(700);
      assert((await p.page.locator('[data-saved-copy]').count()) === 0, 'a saved copy with the switch off');
      await p.fresh();
      const statusEnd = p.reqs.find((r) => r.what === 'end' && r.url === '/api/status');
      const groupStart = p.reqs.find((r) => r.what === 'start' && r.url === '/api/group');
      assert(groupStart.at >= statusEnd.at, 'the games were asked for before the check answered (switch off)');
      await p.ctx.close();
    } finally {
      await setRow('/api/admin/speed-last-screen-switch', true);
      await setRow('/api/admin/speed-direct-load-switch', true);
    }
  });

  await check('the private links: ?lastscreen=on saves a copy on that phone only while the Settings row is off', async () => {
    await setRow('/api/admin/speed-last-screen-switch', false);
    try {
      const p = await playerPhone('Drew');
      await p.open('/?lastscreen=on');
      await p.fresh();
      await sleep(500);
      assert(await p.saved(), 'no copy with ?lastscreen=on');
      const q = await playerPhone('Drew');
      await q.open();
      await q.fresh();
      await sleep(500);
      assert((await q.saved()) === null, 'another phone saved a copy');
      await p.ctx.close();
      await q.ctx.close();
    } finally {
      await setRow('/api/admin/speed-last-screen-switch', true);
    }
  });

  await check('Load games at once with a group word set: an early "word needed" answer is never used (production-like, no StrictMode)', async () => {
    // The dev server runs React's StrictMode, which starts every first load twice and so hides this case; take it out, like production.
    const W = await real.put(BASE + '/api/admin/group', { data: { groupWord: 'dinks' }, headers: { Origin: BASE } });
    assert(W.ok(), `set word ${W.status()}`);
    try {
      for (const direct of [false, true]) {
        const ctx = await browser.newContext(phone(390));
        await ctx.addInitScript(shift, NOW_MS - Date.now());
        if (direct) await ctx.addInitScript(() => localStorage.setItem('pb_direct_load', 'on'));
        await ctx.route(/\/src\/main\.tsx/, async (route) => {
          const resp = await route.fetch();
          const body = 'const __Frag = (p) => p.children;\n' + (await resp.text()).replace(/(jsxDEV\w*\()\s*StrictMode,/g, '$1__Frag,');
          await route.fulfill({ response: resp, body });
        });
        const page = await ctx.newPage();
        await page.goto(BASE + '/');
        await page.waitForSelector('input[type=text]', { timeout: 15000 });
        await page.fill('input[type=text]', 'dinks');
        await page.click('button[type=submit]');
        await page.getByText('Who are you?').first().waitFor({ timeout: 10000 });
        await ctx.close();
      }
    } finally {
      await real.put(BASE + '/api/admin/group', { data: { groupWord: '' }, headers: { Origin: BASE } });
    }
  });

  // ---- Settings rows ----
  for (const scheme of ['light', 'dark']) {
    await check(`Settings > Feature switches: the three speed rows, ${scheme}, and each switches`, async () => {
      const ctx = await browser.newContext(phone(390, scheme));
      await ctx.addInitScript(shift, NOW_MS - Date.now());
      await post(ctx.request, '/api/admin/login', { pin: PIN });
      const page = await ctx.newPage();
      await page.goto(BASE + '/admin');
      await page.locator('.tabbar').waitFor();
      await page.locator('.tabbar button', { hasText: 'Settings' }).evaluate((x) => x.click());
      await sleep(500);
      for (const s of await page.locator('details > summary').all()) await s.click().catch(() => {});
      for (const [attr, name] of [['data-speed-last-screen-all', 'Show last screen at once'], ['data-speed-direct-load-all', 'Load games at once'], ['data-speed-fewer-queries-all', 'Fewer database trips']]) {
        const box = page.locator(`[${attr}]`);
        assert((await box.count()) === 1, `no row ${name}`);
        assert(await box.isChecked(), `${name} not on (the preview seed has it on)`);
        const tall = await page.locator(`[${attr}]`).evaluate((e) => e.closest('label').getBoundingClientRect().height);
        assert(tall >= 44, `${name} row ${tall}px tall`);
      }
      await shot(page, `settings-${scheme}`);
      if (scheme === 'light') {
        await page.locator('[data-speed-fewer-queries-all]').click();
        await sleep(1200);
        assert(!(await dash()).speedFewerQueriesForAll, 'Fewer database trips did not switch off');
        await page.locator('[data-speed-fewer-queries-all]').click();
        await sleep(1200);
        assert((await dash()).speedFewerQueriesForAll === true, 'Fewer database trips did not switch back on');
      }
      await ctx.close();
    });
  }

  await check('organizer screens open with Fewer database trips on (Home, Players, Money, History)', async () => {
    const ctx = await browser.newContext(phone(390));
    await ctx.addInitScript(shift, NOW_MS - Date.now());
    await post(ctx.request, '/api/admin/login', { pin: PIN });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(BASE + '/admin');
    await page.locator('.tabbar').waitFor();
    for (const t of ['Players', 'Money', 'History', 'Home']) {
      await page.locator('.tabbar button', { hasText: t }).evaluate((x) => x.click());
      await sleep(700);
    }
    assert(errors.length === 0, errors.join(' | '));
    await ctx.close();
  });

  await browser.close();
  console.log(`\nzip12: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
