/* Zip 11: "Alert cards" (ALERT_CARDS): one action-card look for every player and organizer alert.
 *
 *   node e2e/zip11.cjs      (also run by npm run test:e2e)
 *
 * Loads the fake preview world as if it were Fri Nov 6, 2026, 10:00 AM Eastern into a local file (Alert cards is on from the seed, and the
 * seed has one of every alert: a moved game, a credit adjustment, a late drop someone took, a cash out, a claim, a game to finalize, ...),
 * starts its own dev server on it with the server clock pinned, and drives a phone-sized browser: light and dark, 390, 360 and 320 px.
 * Then the Settings row off (the old alerts come back) and the private link ?alertcards=on. Also: the old /t/ link opens the home page.
 * Nothing here touches Cloudflare or the live site. Screenshots: e2e/screenshots/zip11-*.png (ignored by git).
 */
const { spawn, spawnSync } = require('node:child_process');
const { readFileSync, mkdirSync, rmSync } = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.E2E_PORT) || 5311;
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
    console.log(`  ✗ ${name}\n      ${String(err && err.message ? err.message : err).replace(/\s*\n\s*/g, ' ⏎ ').slice(0, 1400)}`);
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** WCAG contrast of two "rgb(r, g, b)" colors. */
function contrast(a, b) {
  const lum = (c) => {
    const [r, g, bl] = c.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number).map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

async function main() {
  mkdirSync(SHOTS, { recursive: true });
  const dbFile = path.join(ROOT, '.data', 'zip11.sqlite');
  mkdirSync(path.join(ROOT, '.data'), { recursive: true });
  rmSync(dbFile, { force: true });
  const seeded = spawnSync('npx', ['vite-node', 'scripts/load-seed-local.ts', '--', dbFile, NOW_ISO], { cwd: ROOT, encoding: 'utf8' });
  if (seeded.status !== 0) throw new Error(`could not build the fake world: ${seeded.stderr || seeded.stdout}`);
  const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
    cwd: ROOT,
    env: { ...process.env, DEV_DB: dbFile, SETUP_TOKEN: 'zip11-setup-token-0123456789', DEV_CLOCK: '1' },
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
  const put = (req, url, data) => req.put(BASE + url, { data, headers: { Origin: BASE } });
  const real = (await browser.newContext()).request;
  await post(real, '/api/admin/login', { pin: PIN });
  const d0 = await (await real.get(`${BASE}/api/admin/dashboard`)).json();
  const key = String(d0.group.privateLink).split('/g/')[1];
  const nameId = (n) => d0.players.find((p) => p.name === n).id;

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
  async function openAdmin({ width = 390, scheme = 'light', query = '' } = {}) {
    const ctx = await browser.newContext(phone(width, scheme, 1400));
    await ctx.addInitScript(shift, NOW_MS - Date.now());
    await post(ctx.request, '/api/admin/login', { pin: PIN });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${BASE}/admin${query}`);
    await page.locator('.tabbar').waitFor();
    await page.waitForTimeout(900);
    return { ctx, page, errors };
  }
  async function openPlayer(name, { width = 390, scheme = 'light', height = 1400, query = '' } = {}) {
    const ctx = await browser.newContext(phone(width, scheme, height));
    await ctx.addInitScript(shift, NOW_MS - Date.now());
    await ctx.addInitScript(() => localStorage.setItem('pb_games_filter', 'all'));
    await post(ctx.request, '/api/me', { playerId: nameId(name) }, { 'X-Group-Key': key }).catch(() => {});
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${BASE}/g/${key}${query}`);
    await page.waitForTimeout(800);
    const picker = page.locator('button', { hasText: new RegExp(`^${name}$`) });
    if (await picker.count()) await picker.first().click().catch(() => {});
    await page.locator('.schedule article').first().waitFor({ timeout: 8000 });
    await page.waitForTimeout(700);
    return { ctx, page, errors };
  }
  const still = (page) => page.addStyleTag({ content: '*, *::before, *::after { animation: none !important; transition: none !important; }' });
  const shot = async (page, name, full = true) => (await still(page), await page.waitForTimeout(250), page.screenshot({ path: path.join(SHOTS, `zip11-${name}.png`), fullPage: full }));

  /** Every alert card on the page: its words, its color tone, sizes, and whether it fits the screen. */
  const cards = (page) =>
    page.evaluate(() =>
      [...document.querySelectorAll('[data-alert-card]')].map((c) => {
        const r = c.getBoundingClientRect();
        const btns = [...c.querySelectorAll('.ac-btn, .ac-x, .ac-link')].map((b) => {
          const s = getComputedStyle(b);
          const br = b.getBoundingClientRect();
          return { text: b.innerText.trim(), cls: b.className, w: br.width, h: br.height, left: br.left, right: br.right, color: s.color, bg: s.backgroundColor, border: s.borderTopColor };
        });
        const cs = getComputedStyle(c);
        const title = c.querySelector('.ac-title');
        const sub = c.querySelector('.ac-sub');
        return {
          tone: c.dataset.alertCard,
          text: c.innerText.trim(),
          title: title ? title.innerText.trim() : '',
          left: r.left,
          right: r.right,
          width: r.width,
          bg: cs.backgroundColor,
          border: cs.borderTopColor,
          borderW: cs.borderTopWidth,
          titleColor: title ? getComputedStyle(title).color : null,
          subColor: sub ? getComputedStyle(sub).color : null,
          badge: c.querySelectorAll(':scope .ac-icon, :scope > .ac-row > .ac-icon, :scope .vr-head > .ac-icon').length,
          titleLines: title ? Math.round(title.getBoundingClientRect().height / parseFloat(getComputedStyle(title).lineHeight)) : 0,
          titleSize: title ? parseFloat(getComputedStyle(title).fontSize) : 0,
          wrappedBtn: [...c.querySelectorAll('.ac-btn')].some((b) => b.getBoundingClientRect().height > 44),
          balls: [...c.querySelectorAll('.ac-seats .ball, .ac-seats .dot')].map((b) => { const r = b.getBoundingClientRect(); return { w: r.width, h: r.height }; }),
          btns,
        };
      }),
    );
  const pageWide = (page) => page.evaluate(() => document.documentElement.scrollWidth);

  /** The checks every alert card must pass: inside the screen, one look, readable, buttons big enough. */
  function lookChecks(list, width, label) {
    for (const c of list) {
      assert(c.left >= 0 && c.right <= width + 0.5, `${label}: card "${c.title}" is outside the screen (${c.left}..${c.right} of ${width})`);
      assert(c.badge >= 1, `${label}: card "${c.title}" has no icon badge`);
      assert(!c.wrappedBtn, `${label}: a button on "${c.title}" wraps its words`);
      for (const b of c.balls) assert(Math.abs(b.w - b.h) < 0.5 && b.w === 16, `${label}: a ball on "${c.title}" is ${b.w} x ${b.h} (not a 16 px circle)`);
      if (c.title && width >= 360 && !/requested a refund|tapped I paid|haven't paid|hasn't paid|going, /.test(c.title)) assert(c.titleLines === 1, `${label}: "${c.title}" wraps at ${width} (${c.titleLines} lines, ${c.titleSize} px)`);
      if (c.title && width < 360 && !/requested a refund|tapped I paid|haven't paid|hasn't paid|going, /.test(c.title)) assert(c.titleLines <= 2, `${label}: "${c.title}" takes ${c.titleLines} lines at ${width}`);
      assert(c.borderW !== '0px', `${label}: card "${c.title}" has no border`);
      assert(contrast(c.titleColor, c.bg) >= 4.5, `${label}: title of "${c.title}" is ${contrast(c.titleColor, c.bg).toFixed(2)}:1`);
      if (c.subColor) assert(contrast(c.subColor, c.bg) >= 4.5, `${label}: sub line of "${c.title}" is ${contrast(c.subColor, c.bg).toFixed(2)}:1`);
      for (const b of c.btns) {
        assert(b.right <= width + 0.5 && b.left >= 0, `${label}: "${b.text}" on "${c.title}" is outside the screen`);
        if (/ac-btn/.test(b.cls)) {
          assert(b.h >= 37.5, `${label}: "${b.text}" is ${b.h} px tall`);
          const filled = b.bg !== 'rgba(0, 0, 0, 0)';
          const ink = contrast(b.color, filled ? b.bg : c.bg);
          assert(ink >= 4.5, `${label}: "${b.text}" on "${c.title}" text is ${ink.toFixed(2)}:1`);
        }
        if (/ac-x/.test(b.cls)) assert(b.h === 24 && b.w === 24, `${label}: the X on "${c.title}" is ${b.w} x ${b.h}`);
      }
      assert(!/waitlist|standby/i.test(c.text), `${label}: "${c.title}" says waitlist or standby: ${c.text}`);
    }
  }

  // Who sees what in the fake world (see the seed's summary).
  const PLAYERS = ['Blake', 'Casey', 'Harper', 'Indy', 'Jordan', 'Gray', 'Kai', 'Lane'];

  // ------------------------------------------------------------ ON (from the seed)
  for (const scheme of ['light', 'dark']) {
    for (const width of [390, 360, 320]) {
      await check(`player alert cards, ${scheme} ${width} px: one look, inside the screen, 4.5:1, 38 px buttons, badges, round balls, one-line titles, no waitlist words`, async () => {
        const seen = new Set();
        for (const name of PLAYERS) {
          const p = await openPlayer(name, { width, scheme });
          const list = await cards(p.page);
          lookChecks(list, width, `${name}`);
          list.forEach((c) => seen.add(c.title.replace(/\$\d+/g, '$N')));
          assert((await pageWide(p.page)) <= width, `${name}: the page scrolls sideways at ${width}`);
          assert(p.errors.length === 0, `${name}: page errors ${p.errors.join(' | ')}`);
          if (width === 390 || width === 320) await shot(p.page, `player-${name}-${width}-${scheme}`);
          await p.ctx.close();
        }
        assert(seen.size >= 4, `only ${seen.size} different player cards: ${[...seen].join(' | ')}`);
      });
      await check(`organizer Home alert cards, ${scheme} ${width} px: one look, inside the screen, 4.5:1`, async () => {
        const a = await openAdmin({ width, scheme });
        const list = await cards(a.page);
        assert(list.length >= 4, `only ${list.length} organizer cards`);
        lookChecks(list, width, 'organizer');
        assert((await pageWide(a.page)) <= width, `the organizer Home scrolls sideways at ${width}`);
        assert(a.errors.length === 0, `page errors ${a.errors.join(' | ')}`);
        if (width === 390 || width === 320) await shot(a.page, `organizer-home-${width}-${scheme}`);
        await a.ctx.close();
      });
    }
  }

  await check('player cards: the mock words (needs N more / has N in, You owe, Credit adjusted, You no longer owe, moved to)', async () => {
    const texts = [];
    for (const name of PLAYERS) {
      const p = await openPlayer(name);
      texts.push(...(await cards(p.page)).map((c) => `${name}: ${c.text.replace(/\s+/g, ' ')}`));
      await p.ctx.close();
    }
    const all = texts.join('\n');
    assert(/Credit adjusted: \+\$5/.test(all) && /Thanks for bringing balls/.test(all), `no Credit adjusted card:\n${all}`);
    assert(/You no longer owe \$14/.test(all) && /Someone took your .* spot/.test(all), `no cleared debt card:\n${all}`);
    assert(/moved to 7:30 PM|moved to 7:30 PM/.test(all) && /Still in/.test(all) && /Can't make it/.test(all), `no moved game card:\n${all}`);
    assert(/You owe \$\d+/.test(all) && /\bPay\b/.test(all), `no Pay card:\n${all}`);
    assert(!/Want in/.test(all), `the old Want in words are still on a card:\n${all}`);
    console.log(`      cards seen:\n        ${texts.join('\n        ')}`);
  });

  await check('the Want in card: "needs N more" with the circles, or "has N in" / "You\'d make it", I\'m in joins, X says No', async () => {
    // Find a player with a Want in card.
    let found = null;
    for (const n of ['Casey', 'Harper', 'Lane', 'Morgan', 'Avery', 'Drew', 'Emery', NO_NUMBER_NAME()]) {
      const p = await openPlayer(n);
      const c = p.page.locator('[data-suggest-card]');
      if (await c.count()) {
        found = { n, p, c };
        break;
      }
      await p.ctx.close();
    }
    assert(found, 'no player in the fake world has a Want in card');
    const t = (await found.c.innerText()).replace(/\s+/g, ' ');
    assert(/^(Tonight|Tomorrow|[A-Z][a-z]+day|Next [A-Z][a-z]+day|[A-Z][a-z]{2}, [A-Z][a-z]{2} \d+) (needs \d more|has \d+ in)/.test(t), `the title reads "${t}"`);
    if (/needs/.test(t)) assert((await found.c.locator('.ac-ball').count()) >= 4, 'needs N more without the circles');
    else assert(/You'd make it \d+/.test(t), `no "You'd make it": ${t}`);
    assert(!/waitlist|full|max|spots? left/i.test(t), `the card implies a cap: ${t}`);
    // X = No: the card goes (the same decline call as before).
    const declined = found.p.page.waitForResponse((r) => /\/decline$/.test(r.url()));
    await found.c.locator('.ac-x').click();
    assert((await declined).ok(), 'the X did not decline');
    await found.p.ctx.close();
  });

  await check('Pay card: Pay on the right opens the Pay sheet, I paid / Use credit are links under the title', async () => {
    const p = await openPlayer('Jordan');
    const pay = p.page.locator('[data-pay-card]');
    assert(await pay.count(), 'Jordan has no Pay card');
    const list = (await cards(p.page)).find((c) => /You owe/.test(c.title));
    const payBtn = list.btns.find((b) => b.text === 'Pay');
    assert(payBtn, `no Pay button: ${JSON.stringify(list.btns.map((b) => b.text))}`);
    assert(payBtn.right > list.right - 40, 'Pay is not on the right');
    await pay.locator('[data-pay]').click();
    await p.page.locator('[data-pay-sheet]').waitFor({ timeout: 3000 });
    await p.ctx.close();
  });

  await check('moved game: Still in saves the same answer; Can\'t make it opens the same drop question', async () => {
    const p = await openPlayer('Indy');
    const bar = p.page.locator('[data-time-bar]').first();
    assert(await bar.count(), 'Indy has no moved game card');
    await bar.locator('.ts-no').click();
    await p.page.locator('dialog[open]').waitFor({ timeout: 3000 });
    assert(/Can't make it/.test(await p.page.locator('dialog[open]').innerText()), 'the drop question does not say Can\'t make it');
    await p.page.keyboard.press('Escape');
    const saved = p.page.waitForResponse((r) => /\/still-in$/.test(r.url()));
    await bar.locator('.ts-yes').click();
    assert((await saved).ok(), 'Still in did not save');
    await p.ctx.close();
  });

  await check('cash-out question: a blue card at the bottom, "Use your $14 cash out for this game?", Use it and No, keep cash out', async () => {
    const p = await openPlayer('Gray');
    // Gray asked to cash out $14: tap I'm in on a game Gray is not in, with a court booked.
    const join = p.page.locator('.schedule article [data-join]').first();
    assert(await join.count(), 'Gray has no I\'m in to tap');
    await join.click();
    const q = p.page.locator('[data-cashout-prompt]');
    await q.waitFor({ timeout: 5000 });
    const t = (await q.innerText()).replace(/\s+/g, ' ');
    assert(/Use your \$\d+ cash out for this game\?/.test(t) && /You asked \w+ to cash out \$\d+/.test(t) && /Use it/.test(t) && /No, keep cash out/.test(t), `the question reads "${t}"`);
    assert((await q.getAttribute('data-alert-card')) === 'blue', 'the question is not a blue card');
    await shot(p.page, 'cashout-390-light', false);
    await q.locator('[data-cashout-keep]').click();
    await q.waitFor({ state: 'detached', timeout: 3000 });
    await p.ctx.close();
  });

  await check('organizer Home: Court, Text, money and after-the-game cards in the mock colors', async () => {
    const a = await openAdmin();
    const list = await cards(a.page);
    const tones = list.map((c) => `${c.tone}: ${c.title}`);
    console.log(`      organizer cards:\n        ${tones.join('\n        ')}`);
    const has = (re, tone) => list.some((c) => re.test(c.title) && (!tone || c.tone === tone));
    assert(has(/requested a refund/, 'blue'), `no blue cash-out request: ${tones.join(' | ')}`);
    assert(has(/tapped I paid/, 'amber'), `no amber unconfirmed I paid: ${tones.join(' | ')}`);
    assert(list.some((c) => c.tone === 'purple'), `no purple text card: ${tones.join(' | ')}`);
    assert(list.some((c) => c.tone === 'green'), `no green after-the-game card: ${tones.join(' | ')}`);
    await a.ctx.close();
  });

  // ------------------------------------------------------------ The balls: the game card's own, side by side
  for (const scheme of ['light', 'dark']) {
    await check(`balls side by side, ${scheme}: the Want in card's balls and seats are the game card's (same component, same colors, perfect circles)`, async () => {
      const p = await openPlayer('Harper', { scheme });
      const want = p.page.locator('[data-suggest-card]');
      assert(await want.count(), 'Harper has no Want in card');
      assert(/needs \d more/.test(await want.innerText()), `Harper's card is not a "needs N more": ${await want.innerText()}`);
      const game = p.page.locator('.schedule > .sched.tier-next').filter({ has: p.page.locator('.dots .dot') }).first();
      assert(await game.count(), 'no Next week game card with an empty seat');
      const look = (root) =>
        root.evaluate((el) => {
          const ball = el.querySelector('.dots .ball');
          const dot = el.querySelector('.dots .dot');
          const skin = ball && getComputedStyle(ball.querySelector('.ball-skin'));
          const holes = ball && getComputedStyle(ball.querySelector('.ball-holes'));
          const ds = dot && getComputedStyle(dot);
          const br = ball && ball.getBoundingClientRect();
          const dr = dot && dot.getBoundingClientRect();
          return {
            ball: ball && { w: br.width, h: br.height, fill: skin.fill, stroke: skin.stroke, sw: skin.strokeWidth, holes: holes.fill, n: ball.querySelectorAll('.ball-holes circle').length, cls: ball.getAttribute('class') },
            dot: dot && { w: dr.width, h: dr.height, mask: ds.maskImage || ds.webkitMaskImage, bg: ds.backgroundColor, border: ds.borderTopColor },
          };
        });
      const a = await look(want);
      const g = await look(game);
      assert(a.ball && g.ball, 'a ball is missing');
      for (const k of ['fill', 'stroke', 'sw', 'holes', 'n', 'cls']) assert(a.ball[k] === g.ball[k], `ball ${k}: alert ${a.ball[k]} vs game card ${g.ball[k]}`);
      assert(a.ball.w === a.ball.h && a.ball.w === g.ball.w, `ball size: alert ${a.ball.w}x${a.ball.h} vs game card ${g.ball.w}x${g.ball.h}`);
      assert(a.dot && g.dot, 'an empty seat is missing');
      assert(a.dot.w === a.dot.h && a.dot.w === g.dot.w, `seat size: alert ${a.dot.w} vs game card ${g.dot.w}`);
      // Seat dots is on in the fake world: both are the same dashed ring.
      assert(/url\(/.test(a.dot.mask) && a.dot.mask === g.dot.mask && a.dot.bg === g.dot.bg, `seat ring: alert ${a.dot.mask.slice(0, 30)} ${a.dot.bg} vs game card ${g.dot.mask.slice(0, 30)} ${g.dot.bg}`);
      await still(p.page);
      await want.screenshot({ path: path.join(SHOTS, `zip11-side-alert-${scheme}.png`) });
      await game.screenshot({ path: path.join(SHOTS, `zip11-side-game-${scheme}.png`) });
      await p.ctx.close();
    });
  }

  // ------------------------------------------------------------ Every alert card, one picture each, with a real game card (for the contact sheet)
  for (const scheme of ['light', 'dark']) {
    await check(`every alert card and a game card at 390, ${scheme}: one picture each`, async () => {
      const dir = path.join(SHOTS, 'zip11-cards');
      mkdirSync(dir, { recursive: true });
      const seen = new Set();
      let n = 0;
      const grab = async (page, who) => {
        await still(page);
        const list = page.locator('[data-alert-card]');
        for (let i = 0; i < (await list.count()); i++) {
          const el = list.nth(i);
          const t = ((await el.locator('.ac-title').first().innerText().catch(() => '')) || (await el.innerText())).replace(/\s+/g, ' ').replace(/\$\d+|\d+/g, 'N');
          if (seen.has(t) || !(await el.isVisible())) continue;
          seen.add(t);
          await el.screenshot({ path: path.join(dir, `${scheme}-${String(++n).padStart(2, '0')}-${who}.png`) });
        }
      };
      for (const name of [...PLAYERS, 'Harper']) {
        const p = await openPlayer(name, { scheme });
        await grab(p.page, name);
        if (name === 'Gray') {
          const join = p.page.locator('.schedule article [data-join]').first();
          if (await join.count()) {
            await join.click();
            await p.page.locator('[data-cashout-prompt]').waitFor({ timeout: 5000 }).catch(() => {});
            await p.page.waitForTimeout(400);
            await grab(p.page, 'Gray-cashout');
          }
        }
        if (name === 'Harper') {
          const game = p.page.locator('.schedule > .sched.tier-next').filter({ has: p.page.locator('.dots .dot') }).first();
          await game.screenshot({ path: path.join(dir, `${scheme}-99-game-card.png`) });
        }
        await p.ctx.close();
      }
      const a = await openAdmin({ scheme });
      await grab(a.page, 'organizer');
      await a.ctx.close();
      assert(n >= 12, `only ${n} different cards`);
    });
  }

  // ------------------------------------------------------------ Seat dots
  await check('Seat dots: on = every empty seat a dashed ring (game cards, organizer cards); off = the old solid circle, with Alert cards on or off', async () => {
    const ringOf = async (page) => page.evaluate(() => [...document.querySelectorAll('.dots .dot')].map((d) => { const st = getComputedStyle(d); return /url\(/.test(st.maskImage || st.webkitMaskImage || ''); }));
    for (const ac of [true, false]) {
      assert((await put(real, '/api/admin/alert-cards-switch', { on: ac })).ok(), 'alert cards switch');
      for (const sd of [true, false]) {
        assert((await put(real, '/api/admin/seat-dots-switch', { on: sd })).ok(), 'seat dots switch');
        const p = await openPlayer('Harper');
        const rings = await ringOf(p.page);
        assert(rings.length > 3, 'no empty seats on the player screen');
        assert(rings.every((r) => r === sd), `player seats with alert cards ${ac}, seat dots ${sd}: ${rings.join(',')}`);
        assert((await p.page.evaluate(() => document.documentElement.hasAttribute('data-seat-dots'))) === sd, 'the html attribute');
        if (sd && ac) await shot(p.page, 'seatdots-on-player-390-light');
        if (!sd && !ac) await shot(p.page, 'seatdots-off-player-390-light');
        await p.ctx.close();
        const a = await openAdmin();
        const ar = await ringOf(a.page);
        assert(ar.length > 0 && ar.every((r) => r === sd), `organizer seats with alert cards ${ac}, seat dots ${sd}`);
        await a.ctx.close();
      }
    }
    // The private link: one phone only.
    const t = await openPlayer('Harper', { query: '?seatdots=on' });
    assert((await ringOf(t.page)).every(Boolean), '?seatdots=on did not turn the rings on for this phone');
    await t.ctx.close();
    assert((await put(real, '/api/admin/alert-cards-switch', { on: true })).ok() && (await put(real, '/api/admin/seat-dots-switch', { on: true })).ok(), 'both back on');
  });

  await check('the old /t/ link opens the home page', async () => {
    const ctx = await browser.newContext(phone(390));
    const page = await ctx.newPage();
    await page.goto(`${BASE}/t/${'x'.repeat(43)}`);
    await page.waitForFunction(() => window.location.pathname === '/');
    await ctx.close();
  });

  // ------------------------------------------------------------ OFF: the Settings row off = the old alerts
  await check('Settings row off: no alert card anywhere, the old alerts are back; ?alertcards=on brings them back on one phone', async () => {
    const r = await put(real, '/api/admin/alert-cards-switch', { on: false });
    assert(r.ok(), `switch off: ${r.status()}`);
    for (const name of ['Jordan', 'Blake', 'Indy']) {
      const p = await openPlayer(name);
      assert((await p.page.locator('[data-alert-card]').count()) === 0, `${name} still has alert cards with the switch off`);
      assert(!(await p.page.evaluate(() => document.documentElement.hasAttribute('data-alert-cards'))), `${name}: <html data-alert-cards> with the switch off`);
      await shot(p.page, `off-player-${name}-390-light`);
      await p.ctx.close();
    }
    const a = await openAdmin();
    assert((await a.page.locator('[data-alert-card]').count()) === 0, 'the organizer still has alert cards with the switch off');
    await shot(a.page, 'off-organizer-home-390-light');
    await a.ctx.close();
    const t = await openPlayer('Jordan', { query: '?alertcards=on' });
    assert((await t.page.locator('[data-alert-card]').count()) > 0, '?alertcards=on did not bring the cards back on this phone');
    await t.ctx.close();
    const back = await put(real, '/api/admin/alert-cards-switch', { on: true });
    assert(back.ok(), 'switch back on');
  });

  await check('Settings > Feature switches has the "Seat dots" and "Alert cards" rows', async () => {
    const a = await openAdmin();
    await a.page.getByRole('button', { name: /Settings/ }).last().click();
    await a.page.waitForTimeout(400);
    const row = a.page.locator('[data-row="alertCardsAll"]');
    if (!(await row.isVisible().catch(() => false))) await a.page.getByText('Feature switches').first().click();
    await row.waitFor({ timeout: 4000 });
    assert(/Alert cards/.test(await row.innerText()), 'no Alert cards row');
    assert(await row.locator('input[data-alert-cards-all]').isChecked(), 'the row is not on in the fake world');
    const sd = a.page.locator('[data-row="seatDotsAll"]');
    assert(/Seat dots/.test(await sd.innerText()) && (await sd.locator('input[data-seat-dots-all]').isChecked()), 'no Seat dots row, or it is off in the fake world');
    await a.ctx.close();
  });

  await browser.close();
  console.log(`\nzip11: ${passed} passed, ${failed} failed`);
  try {
    process.kill(-server.pid, 'SIGTERM');
  } catch {}
  process.exit(failed ? 1 : 0);
}

// The made-up player with no number (scripts/seed-preview-world.ts NO_NUMBER).
function NO_NUMBER_NAME() {
  return 'Reese';
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
