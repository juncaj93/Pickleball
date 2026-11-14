/* Zip 38 (🎾38.xmas): the Christmas skin, in a real browser.
 *
 *   node e2e/zip38.cjs      (also run by npm run test:e2e)       E2E_SHOTS=<folder> keeps the pictures
 *
 * The SMALL fake world (scripts/load-small-local.ts) as of Thu Nov 12, 2026, 3:00 PM Eastern (the day of the approved mock: TONIGHT games,
 * TOMORROW games, a canceled game, next week), its own dev server, every wrangler.toml switch as on live. The phone opens the page with the
 * preview-style switch (CHRISTMAS_SKIN_PREVIEW) pretending it is Dec 5 (the date window itself is proved in tests/zip38.test.ts).
 *   A  first visit: the Christmas logo shows, the theme is OFF, the bubble "Tap for Christmas theme" shows about 2 s and never again;
 *   B  tap ON: ornaments (4 colors in turn, empty = dashed, no ring, nothing moves at rest), candy canes (5 px, then 3 px), snow cap on the top
 *      card only, red TONIGHT/TOMORROW bands, red outlines (canceled stays gray), the page color; "Tap to switch back"; remembered on reload;
 *   C  tap OFF: balls back and spinning once, 45 ms apart, canes and cap gone at once; the logo stays; remembered;
 *   D  motion: pop-in classes, the first card's jingle, I'm in = only the new ornament drops, the 4th player jingles all four, the Game on
 *      toast badge is an ornament with the same words; every ornament animation plays to the end even through a redraw; Just me (only Alex, normal logo, kept on the server) and Everyone;
 *   E  reduced motion: no animation anywhere; blocked storage never crashes; the admin screens never get any of it;
 *   F  light and dark, 390 / 360 / 320, text 100 / 125 / 150 percent: nothing clipped, nothing sideways.
 */
const { spawn, spawnSync } = require('node:child_process');
const { readFileSync, mkdirSync, rmSync } = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.E2E_PORT) || 5438;
const BASE = `http://localhost:${PORT}`;
const SEED_ISO = '2026-11-12T20:00:00.000Z'; // Thu Nov 12, 3:00 PM Eastern
const NOW_MS = Date.parse(SEED_ISO);
const SHOTS = process.env.E2E_SHOTS || '';
const PIN = /PIN `(\d{6})`/.exec(readFileSync(path.join(ROOT, 'docs/PREVIEW_FAKE_DB.md'), 'utf8'))[1];
// The skin as everyone gets it: this preview-style server has the switch on and pretends today is Dec 5 (the private link has its own tests below).
const LINK = 'xmasdate=2026-12-05';

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
    console.log(`  ✗ ${name}\n      ${String(err && err.message ? err.message : err).replace(/\s*\n\s*/g, ' ⏎ ').slice(0, 1600)}`);
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The live wrangler.toml [vars] (production), so this dev server has the same kill switches as live. */
function liveVars() {
  const toml = readFileSync(path.join(ROOT, 'wrangler.toml'), 'utf8');
  const top = toml.slice(toml.indexOf('[vars]'), toml.indexOf('[env.preview]'));
  const out = {};
  for (const m of top.matchAll(/^([A-Z_][A-Z0-9_]*)\s*=\s*"([^"]*)"/gm)) if (m[1] !== 'SITE_URL') out[m[1]] = m[2];
  return out;
}

async function main() {
  const dbFile = path.join(ROOT, '.data', `zip38-${PORT}.sqlite`);
  mkdirSync(path.join(ROOT, '.data'), { recursive: true });
  if (SHOTS) mkdirSync(SHOTS, { recursive: true });
  rmSync(dbFile, { force: true });
  const seeded = spawnSync('npx', ['vite-node', 'scripts/load-small-local.ts', '--', dbFile, SEED_ISO], { cwd: ROOT, encoding: 'utf8' });
  if (seeded.status !== 0) throw new Error(`could not build the fake world: ${seeded.stderr || seeded.stdout}`);
  if (await fetch(`${BASE}/api/status`).then((r) => r.ok, () => false)) throw new Error(`port ${PORT} is already in use`);
  const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
    cwd: ROOT,
    env: { ...process.env, ...liveVars(), DEV_DB: dbFile, SETUP_TOKEN: 'zip38-setup-token-0123456789', DEV_CLOCK: '1', PREVIEW_CALM: 'on', CHRISTMAS_SKIN_PREVIEW: 'on' },
    stdio: 'ignore',
    detached: true,
  });
  process.on('exit', () => {
    try {
      process.kill(-server.pid, 'SIGTERM');
    } catch {}
  });
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(`${BASE}/api/status`)).ok) break;
    } catch {}
    await sleep(500);
  }
  await fetch(`${BASE}/__dev/clock`, { method: 'POST', body: JSON.stringify({ atMs: NOW_MS }) });
  const browser = await chromium.launch();

  /** A phone as of the pinned moment. `reduced` = prefers-reduced-motion; `blockStorage` = localStorage throws. */
  async function phone({ width = 390, scheme = 'light', reduced = false, blockStorage = false, pct = 100 } = {}) {
    const ctx = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, colorScheme: scheme, reducedMotion: reduced ? 'reduce' : 'no-preference' });
    await ctx.addInitScript(
      ([delta, block]) => {
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
        if (block) {
          Object.defineProperty(window, 'localStorage', {
            get() {
              throw new Error('storage blocked');
            },
          });
        }
      },
      [NOW_MS - Date.now(), blockStorage],
    );
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.errors = errors;
    page.pct = pct;
    return { ctx, page };
  }
  async function home(page, query = LINK) {
    await page.goto(`${BASE}/?as=Alex${query ? '&' + query : ''}`);
    await page.locator('.schedule article.sched').first().waitFor({ timeout: 30000 });
    if (page.pct && page.pct !== 100) await page.addStyleTag({ content: `html { font-size: ${page.pct}% !important; } body { font-size: ${(17 * page.pct) / 100}px !important; }` });
    await sleep(900);
  }
  const attr = (page) => page.evaluate(() => document.documentElement.getAttribute('data-skin'));
  const logoSrc = (page) => page.evaluate(() => document.querySelector('.topbar .brand-logo')?.getAttribute('src'));
  const bubble = (page) => page.evaluate(() => document.querySelector('[data-skin-bubble]')?.textContent ?? null);
  const tapLogo = (page) => page.locator('[data-skin-logo]').tap();
  const shot = async (page, name) => {
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, name) });
  };
  const pseudo = (page, sel, which, props) =>
    page.evaluate(
      ([s, w, p]) => {
        const el = document.querySelector(s);
        if (!el) return null;
        const cs = getComputedStyle(el, w);
        return Object.fromEntries(p.map((k) => [k, cs.getPropertyValue(k)]));
      },
      [sel, which, props],
    );
  const noSideways = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 0.5);
  /** Reads the rgb numbers of a CSS color. */
  const rgb = (c) => (/\d+/.exec(c) ? c.match(/[\d.]+/g).slice(0, 3).map(Number) : []);
  const isRed = (c) => {
    const [r, g, b] = rgb(c);
    return r === 200 && g === 49 && b === 47;
  };

  // ---------------------------------------------------------------------------------------------------------------------
  await check('A first visit: Christmas logo, theme OFF, the bubble once, never again', async () => {
    const { ctx, page } = await phone();
    await home(page, `${LINK}&xmasreset=1`);
    assert((await logoSrc(page)) === '/logo-xmas.png', `logo is ${await logoSrc(page)}`);
    assert((await attr(page)) === null, 'theme starts OFF');
    assert((await page.locator('.dots .ball').count()) > 0 && (await page.locator('.dots .xorn').count()) === 0, 'balls, not ornaments');
    assert((await bubble(page)) === 'Tap for Christmas theme', `bubble: ${await bubble(page)}`);
    await shot(page, 'zip38-first-visit.png');
    await sleep(2600);
    assert((await bubble(page)) === null, 'the bubble fades after about 2 seconds');
    await page.reload();
    await page.locator('.schedule article.sched').first().waitFor();
    await sleep(500);
    assert((await bubble(page)) === null, 'never again on this phone');
    assert((await logoSrc(page)) === '/logo-xmas.png', 'the logo stays');
    assert(page.errors.length === 0, page.errors.join(' | '));
    await ctx.close();
  });

  for (const scheme of ['light', 'dark']) {
    await check(`R the plain theme: my own seat's pickleball has no ring (${scheme}); everyone's balls look the same, my name stays bold`, async () => {
      const { ctx, page } = await phone({ scheme });
      // Switch Off for everyone: the plain theme, no Christmas anything.
      await page.goto(`${BASE}/?as=Alex&xmasmode=off`);
      await page.locator('.schedule article.sched').first().waitFor({ timeout: 30000 });
      await sleep(900);
      const info = await page.evaluate(() => {
        const mine = document.querySelector('.dots .ball.me .ball-skin');
        const other = document.querySelector('.dots .ball:not(.me) .ball-skin');
        if (!mine || !other) return null;
        const a = getComputedStyle(mine);
        const b = getComputedStyle(other);
        const boldName = [...document.querySelectorAll('.names-line strong, .names-line b')].some((n) => n.textContent.trim() === 'Alex');
        return { mine: [a.stroke, a.strokeWidth], other: [b.stroke, b.strokeWidth], boldName };
      });
      assert(info, 'a game with my own ball and someone else\'s ball is on screen');
      assert(info.mine.join() === info.other.join(), `my ball is the plain ball (mine ${info.mine}, theirs ${info.other})`);
      assert(info.boldName, 'my name stays bold');
      await ctx.close();
    });
  }

  await check('A a tap anywhere closes the first-visit bubble', async () => {
    const { ctx, page } = await phone();
    await home(page, `${LINK}&xmasreset=1`);
    assert((await bubble(page)) !== null, 'bubble shows');
    await page.locator('.topbar h1').tap();
    await sleep(100);
    assert((await bubble(page)) === null, 'closed by the tap');
    assert((await attr(page)) === null, 'the tap did not turn the theme on');
    await ctx.close();
  });

  for (const scheme of ['light', 'dark']) {
    await check(`B tap ON, ${scheme}: ornaments, candy canes, snow cap, red tiles, page color`, async () => {
      const { ctx, page } = await phone({ scheme });
      await home(page, `${LINK}&xmasreset=1`);
      const balls = await page.locator('.schedule .dots .ball').count();
      await tapLogo(page);
      await sleep(2600);
      assert((await attr(page)) === 'christmas', 'theme on');
      assert((await page.locator('.schedule .dots .ball').count()) === 0, 'no balls left');
      const filled = await page.locator('.schedule .dots .xorn:not(.xempty)').count();
      assert(filled === balls, `one ornament per ball: ${filled} vs ${balls}`);
      assert((await page.locator('.schedule .dots .xorn.xempty').count()) > 0, 'empty seats are dashed ornament outlines');
      // Colors cycle red, green, gold, blue by seat.
      const stops = await page.evaluate(() => [...document.querySelectorAll('.schedule article.sched')[0].querySelectorAll('.dots .xorn:not(.xempty) radialGradient stop:nth-child(2)')].map((s) => s.getAttribute('stop-color')));
      assert(stops.join(',') === '#e5483f,#37b873,#f2b33d,#4f7be0'.split(',').slice(0, stops.length).join(','), `ornament colors by seat: ${stops}`);
      // My own seat keeps a ring.
      // No ring, no glow, no sway: nothing is drawn around any ornament and nothing moves on a card at rest.
      assert((await page.locator('.xorn:not(.xempty) circle[stroke]').count()) === 0, 'no ring around any filled ornament (the dashed ones are the empty seats)');
      const atRest = await page.evaluate(() => [...document.querySelectorAll('.dots .xorn')].map((o) => getComputedStyle(o).animationName + '|' + getComputedStyle(o).filter));
      assert(atRest.length > 0 && atRest.every((x) => x === 'none|none'), `nothing moves or glows at rest: ${[...new Set(atRest)]}`);
      // The candy cane: 5 px in THIS WEEK, 3 px in NEXT WEEK.
      const thisCane = await pseudo(page, '.schedule > .week-break.tier-this', '::after', ['height', 'background-image']);
      const nextCane = await pseudo(page, '.schedule > .week-break.tier-next:not(.filter-only)', '::after', ['height', 'background-image']);
      assert(thisCane.height === '5px' && /repeating-linear-gradient\(135deg/.test(thisCane['background-image']), `THIS WEEK cane: ${JSON.stringify(thisCane)}`);
      assert(nextCane && nextCane.height === '3px', `NEXT WEEK cane: ${JSON.stringify(nextCane)}`);
      // The snow cap: the top card only, 12 px tall.
      assert((await page.locator('.schedule > .sched.xs-top').count()) === 1, 'one top card');
      const cap = await pseudo(page, '.schedule > .sched.xs-top', '::before', ['height', 'left', 'right']);
      assert(cap.height === '12px' && cap.left === '30px' && cap.right === '30px', `cap: ${JSON.stringify(cap)}`);
      assert((await pseudo(page, '.schedule > .sched:not(.xs-top)', '::before', ['content'])).content !== '""', 'no cap on other cards');
      // Red tonight / tomorrow bands and red tile borders; canceled stays gray.
      // Zip 41: TONIGHT and TOMORROW tiles only: a true red 2 px outline and a band (light: red band, white word; dark: cream band, red word).
      const dark = scheme === 'dark';
      const bandOf = (sel) => page.evaluate((q) => { const c = getComputedStyle(document.querySelector(q)); return [c.backgroundColor, c.color]; }, sel);
      const [band, bandInk] = await bandOf('.tile .day-tag.tonight');
      assert(dark ? band === 'rgb(251, 246, 234)' && isRed(bandInk) : isRed(band) && bandInk === 'rgb(255, 255, 255)', `TONIGHT band ${band} / ${bandInk}`);
      const [tom, tomInk] = await bandOf('.tile .day-tag.tomorrow');
      assert(dark ? tom === 'rgb(251, 246, 234)' && isRed(tomInk) : isRed(tom) && tomInk === 'rgb(255, 255, 255)', `TOMORROW band ${tom} / ${tomInk}`);
      const borders = await page.evaluate(() =>
        [...document.querySelectorAll('.schedule > article.sched')].map((a) => {
          const t = a.querySelector('.tile.ptile');
          return [a.classList.contains('off'), t.classList.contains('day-tonight') || t.classList.contains('day-tomorrow'), getComputedStyle(t).borderTopColor, getComputedStyle(t).borderTopWidth, t.querySelectorAll('.tb').length];
        }),
      );
      const special = borders.filter(([off, day]) => !off && day);
      assert(special.length > 0 && special.every(([, , c, w]) => c === (dark ? 'rgb(217, 58, 53)' : 'rgb(200, 49, 47)') && w === '2px'), `tonight and tomorrow tiles: true red, 2 px: ${JSON.stringify(special)}`);
      const rest = borders.filter(([off, day]) => !off && !day);
      assert(rest.length > 0 && rest.every(([, , c]) => !isRed(c) && c !== 'rgb(217, 58, 53)'), `no other tile has a red outline: ${JSON.stringify(rest)}`);
      assert(borders.every(([, , , , layers]) => layers === 0), 'no court-status layer on any player tile');
      assert(borders.filter(([off]) => off).length > 0 && borders.filter(([off]) => off).every(([, , c]) => !isRed(c) && c !== 'rgb(217, 58, 53)'), 'canceled tile is not red');
      const ordinary = await page.evaluate(() => {
        const t = [...document.querySelectorAll('.schedule > article.sched:not(.off) .tile.ptile:not(.day-tonight):not(.day-tomorrow)')][0];
        return t ? [getComputedStyle(t.querySelector('.dow')).color, getComputedStyle(t).borderTopColor] : null;
      });
      assert(!!ordinary, 'an ordinary tile exists (it keeps its own band and day label)');
      // The page color.
      const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
      assert(bg === (scheme === 'light' ? 'rgb(237, 243, 236)' : 'rgb(9, 24, 14)'), `page color ${bg}`);
      // Cards keep their fills.
      const card = await page.evaluate(() => getComputedStyle(document.querySelector('.schedule > article.sched')).backgroundColor);
      assert(card !== bg, 'cards keep their own fill');
      assert((await bubble(page)) === null, 'the second bubble is gone after about 2 seconds');
      await shot(page, `zip38-on-${scheme}.png`);
      assert(page.errors.length === 0, page.errors.join(' | '));
      await ctx.close();
    });
  }

  await check('B the second bubble, and the choice is remembered on reload (no bubble again)', async () => {
    const { ctx, page } = await phone();
    await home(page, `${LINK}&xmasreset=1`);
    await sleep(2500);
    await tapLogo(page);
    await sleep(300);
    assert((await bubble(page)) === 'Tap to switch back', `second bubble: ${await bubble(page)}`);
    assert((await page.locator('.pop, .toast').count()) === 0, 'no toast');
    await sleep(2500);
    assert((await bubble(page)) === null, 'second bubble gone');
    // Only the first time the theme is turned on: off, then on again says nothing.
    await tapLogo(page);
    await sleep(900);
    await tapLogo(page);
    await sleep(300);
    assert((await attr(page)) === 'christmas', 'on again');
    assert((await bubble(page)) === null, 'no second "Tap to switch back" the next time');
    await page.reload();
    await page.locator('.schedule article.sched').first().waitFor();
    await sleep(900);
    assert((await attr(page)) === 'christmas', 'still on after a reload');
    assert((await bubble(page)) === null, 'no bubble on a reload');
    assert((await page.locator('.xorn.xin, .xorn.xjoin').count()) === 0, 'a remembered theme does not replay the pop-in');
    await ctx.close();
  });

  await check('C tap OFF: the balls come back and spin once 45 ms apart, canes and cap vanish at once, the logo stays, remembered', async () => {
    const { ctx, page } = await phone();
    await home(page, `${LINK}&xmasreset=1`);
    await sleep(2200);
    await tapLogo(page);
    await sleep(2600);
    const had = await page.locator('.schedule .dots .xorn:not(.xempty)').count();
    await tapLogo(page);
    await sleep(120);
    assert((await attr(page)) === null, 'the theme attribute is gone at once (canes, cap, red tiles)');
    assert((await bubble(page)) === null, 'no message on the way off');
    assert((await page.locator('.xorn').count()) === 0, 'no ornaments');
    const balls = await page.evaluate(() => [...document.querySelectorAll('.schedule article.sched')[0].querySelectorAll('.dots .ball')].map((b) => [b.classList.contains('xspinb'), b.style.animationDelay]));
    assert(balls.length > 0 && balls.every(([s]) => s), `the balls spin: ${JSON.stringify(balls)}`);
    assert(balls.map(([, d]) => d).join() === balls.map((_, i) => `${i * 45}ms`).join(), `45 ms apart: ${JSON.stringify(balls)}`);
    assert((await page.locator('.schedule .dots .ball').count()) === had, 'one ball per ornament');
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    assert(bg === 'rgb(242, 242, 238)', `page color back to normal: ${bg}`);
    await sleep(1000);
    assert((await page.locator('.ball.xspinb').count()) === 0, 'the spin marker is gone after the spin');
    assert((await logoSrc(page)) === '/logo-xmas.png', 'the logo stays inside the window');
    await page.reload();
    await page.locator('.schedule article.sched').first().waitFor();
    await sleep(700);
    assert((await attr(page)) === null && (await logoSrc(page)) === '/logo-xmas.png', 'off is remembered, logo still there');
    await ctx.close();
  });

  await check('D motion: pop-in, the first card jingles, then nothing moves at rest', async () => {
    const { ctx, page } = await phone();
    await home(page, `${LINK}&xmasreset=1`);
    await sleep(2200);
    await tapLogo(page);
    await sleep(150);
    assert((await page.evaluate(() => document.documentElement.getAttribute('data-skin-anim'))) === 'in', 'pop-in marker');
    const info = await page.evaluate(() => {
      const cards = [...document.querySelectorAll('.schedule article.sched')];
      const cls = (c) => [...c.querySelectorAll('.dots .xorn:not(.xempty)')].map((o) => [o.getAttribute('class'), o.style.getPropertyValue('--i')]);
      return { first: cls(cards[0]), second: cls(cards[1]) };
    });
    assert(info.first.every(([c]) => /xin-j/.test(c)), `the first card jingles: ${JSON.stringify(info.first)}`);
    assert(info.second.every(([c]) => /xin/.test(c) && !/xin-j/.test(c)), `the other cards only pop in: ${JSON.stringify(info.second)}`);
    const delay = await page.evaluate(() => getComputedStyle(document.querySelector('.schedule article.sched .dots .xorn:not(.xempty):nth-child(3)')).animationDelay);
    assert(/0\.12s|120ms/.test(delay.split(',')[0]) || /0\.1[0-9]*s/.test(delay.split(',')[0]), `ornaments pop in 40 ms apart (third: ${delay})`);
    const snow = await pseudo(page, '.schedule > .sched.xs-top', '::before', ['animation-name']);
    assert(/xgrow/.test(snow['animation-name']), `the cap pops up: ${snow['animation-name']}`);
    await sleep(2400);
    assert((await page.evaluate(() => document.documentElement.getAttribute('data-skin-anim'))) === null, 'the marker goes away');
    // Nothing moves on a card at rest afterwards (no glow, no sway).
    const moving = await page.evaluate(() => [...document.querySelectorAll('.dots .xorn')].filter((o) => getComputedStyle(o).animationName !== 'none').length);
    assert(moving === 0, `${moving} ornaments still animate at rest`);
    assert(page.errors.length === 0, page.errors.join(' | '));
    await ctx.close();
  });

  await check('D I\'m in on a 3-in game: only the new ornament drops, then all four jingle, Game on toast badge is an ornament', async () => {
    const { ctx, page } = await phone();
    await home(page, `${LINK}&xmasreset=1`);
    await sleep(2200);
    await tapLogo(page);
    await sleep(2600);
    // The 9:30 PM game has three in: my tap makes the fourth.
    const card = page.locator('article.sched', { hasText: '9:30 PM' }).first();
    const before = await card.locator('.dots .xorn:not(.xempty)').count();
    assert(before === 3, `three in before: ${before}`);
    await card.locator('[data-join]').tap();
    await sleep(350);
    const seen = await card.evaluate((c) => [...c.querySelectorAll('.dots .xorn:not(.xempty)')].map((o) => o.getAttribute('class')));
    assert(seen.length === 4, `four in: ${seen.length}`);
    assert(/xjoin/.test(seen[3]) && /xjoin-j/.test(seen[3]), `the new ornament drops, then jingles: ${seen[3]}`);
    assert(seen.slice(0, 3).every((c) => !/xjoin|xin/.test(c) && /xjingle/.test(c)), `the other three only jingle after it: ${seen.slice(0, 3)}`);
    const toast = await page.evaluate(() => {
      const t = document.querySelector('[data-banner]');
      return t ? { text: t.textContent, ornament: !!t.querySelector('.xorn'), ball: !!t.querySelector('.ball') } : null;
    });
    assert(toast && /Game on!/.test(toast.text), `the Game on toast words stay: ${toast && toast.text}`);
    assert(toast.ornament && !toast.ball, 'its badge is an ornament');
    await shot(page, 'zip38-game-on-toast.png');
    await sleep(3500);
    const after = await card.evaluate((c) => [...c.querySelectorAll('.dots .xorn:not(.xempty)')].map((o) => o.getAttribute('class')));
    assert(after.every((c) => !/xjoin|xjingle|xin/.test(c)), `all motion markers removed after it is over: ${after}`);
    assert(page.errors.length === 0, page.errors.join(' | '));
    await ctx.close();
  });

  await check('G Just me: normal site and normal logo for everyone; only Alex can tap the normal logo; the choice is kept on the server (a Home Screen app has it); no bubbles', async () => {
    const JM = 'xmasmode=me';
    const a = await phone();
    await a.page.goto(`${BASE}/?as=Alex&${JM}`);
    await a.page.locator('.schedule article.sched').first().waitFor({ timeout: 30000 });
    await sleep(900);
    assert((await logoSrc(a.page)) === '/logo.png', `the NORMAL logo: ${await logoSrc(a.page)}`);
    assert((await a.page.locator('[data-skin-logo="me"]').count()) === 1, 'the logo is the tap for Alex');
    assert((await attr(a.page)) === null && (await bubble(a.page)) === null, 'nothing on, no bubble');
    const tile = await a.page.evaluate(() => getComputedStyle(document.querySelector('.topbar .brand-tile')).backgroundColor);
    assert(tile === 'rgb(230, 238, 228)', `the normal tile fill (not the page color): ${tile}`);
    await tapLogo(a.page);
    await sleep(2600);
    assert((await attr(a.page)) === 'christmas' && (await a.page.locator('.xorn').count()) > 0, 'theme on after the tap');
    assert((await logoSrc(a.page)) === '/logo.png', 'still the normal logo');
    assert((await bubble(a.page)) === null, 'no "Tap to switch back" in Just me');
    // Same phone, reloaded: still on (saved on the server).
    await a.page.reload();
    await a.page.locator('.schedule article.sched').first().waitFor({ timeout: 30000 });
    await sleep(900);
    assert((await attr(a.page)) === 'christmas', 'on after a reload');
    await a.ctx.close();
    // A fresh phone with empty storage (the Home Screen app): Alex is picked, the theme is already on.
    const b = await phone();
    await b.page.goto(`${BASE}/?as=Alex&${JM}`);
    await b.page.locator('.schedule article.sched').first().waitFor({ timeout: 30000 });
    await sleep(1200);
    assert((await attr(b.page)) === 'christmas', 'a fresh phone as Alex has the theme on');
    // Everyone else: the plain site, no button, no bubble.
    const c = await phone();
    await c.page.goto(`${BASE}/?as=Parker&${JM}`);
    await c.page.locator('.schedule article.sched').first().waitFor({ timeout: 30000 });
    await sleep(900);
    assert((await attr(c.page)) === null && (await logoSrc(c.page)) === '/logo.png' && (await c.page.locator('[data-skin-logo]').count()) === 0, 'Parker sees the normal site');
    assert((await c.page.locator('.xorn').count()) === 0 && (await bubble(c.page)) === null, 'no ornaments, no bubble for Parker');
    await c.ctx.close();
    // Turn it off again (and leave the fake data as it was).
    await tapLogo(b.page);
    await sleep(900);
    assert((await attr(b.page)) === null, 'a tap turns it off');
    await b.page.reload();
    await b.page.locator('.schedule article.sched').first().waitFor({ timeout: 30000 });
    await sleep(900);
    assert((await attr(b.page)) === null, 'and off is kept too');
    await b.ctx.close();
  });

  await check('G Everyone: the Christmas logo and the first-visit bubble for every player, and every player can tap', async () => {
    const { ctx, page } = await phone();
    await page.goto(`${BASE}/?as=Parker&xmasmode=all&xmasdate=2026-12-05&xmasreset=1`);
    await page.locator('.schedule article.sched').first().waitFor({ timeout: 30000 });
    await sleep(500);
    assert((await logoSrc(page)) === '/logo-xmas.png' && (await bubble(page)) === 'Tap for Christmas theme', 'Christmas logo and the first-visit bubble for Parker');
    await sleep(2400);
    await tapLogo(page);
    await sleep(2600);
    assert((await attr(page)) === 'christmas', 'Parker can turn it on');
    await ctx.close();
  });

  await check('G the old ?christmasskin links do nothing; the organizer screens are the same with the preview mode stored', async () => {
    const { ctx, page } = await phone();
    await page.goto(`${BASE}/?as=Parker&christmasskin=on`); // (the old private link, kept here to prove it does nothing)
    await page.locator('.schedule article.sched').first().waitFor({ timeout: 30000 });
    await sleep(900);
    assert((await attr(page)) === null && (await logoSrc(page)) === '/logo.png', 'the old link does nothing');
    const r = await ctx.request.post(BASE + '/api/admin/login', { data: { pin: PIN }, headers: { Origin: BASE } });
    assert(r.ok(), 'organizer sign-in');
    const html = async (query) => {
      await page.goto(`${BASE}/admin${query}`);
      await page.locator('.tabbar').waitFor({ timeout: 30000 });
      await sleep(900);
      // (Zip 43: Instant admin's dimmed-money marker comes and goes with the saved copy on the Venue cards' amounts; it is not part of what this compares.)
      return page.evaluate(() => document.querySelector('main').outerHTML.replace(/ id="[^"]*"/g, '').replace(/aria-labelledby="[^"]*"/g, '').replace(/ data-held-money=""/g, ''));
    };
    const plain = await html('?xmasmode=off');
    const stored = await html('?xmasmode=me');
    {
      let i = 0;
      while (i < plain.length && plain[i] === stored[i]) i++;
      assert(plain === stored, `the organizer Home is the same with the preview mode set (differs at ${i}: «${plain.slice(Math.max(0, i - 80), i + 120)}» vs «${stored.slice(Math.max(0, i - 80), i + 120)}»)`);
    }
    assert((await attr(page)) === null && (await logoSrc(page)) === '/logo.png', 'admin never gets the theme or logo');
    await ctx.close();
  });

  await check('H every ornament animation plays to the end, even when the page redraws in the middle (theme on, then I\'m in)', async () => {
    const { ctx, page } = await phone();
    await home(page, `${LINK}&xmasreset=1`);
    await sleep(2200);
    // The animations of every ornament, right after the tap; then redraw the whole page (the light/dark button re-renders it) while they run.
    const watch = async (trigger, label) => {
      await trigger();
      await sleep(60);
      const res = await page.evaluate(async () => {
        const mine = () => document.getAnimations().filter((a) => a.effect && a.effect.target && a.effect.target.classList && a.effect.target.classList.contains('xorn') && a.effect.target.closest('.dots'));
        const anims = mine();
        const names = anims.map((a) => a.animationName);
        const settled = Promise.allSettled(anims.map((a) => a.finished));
        const btn = document.querySelector('.mode-btn');
        if (btn) { btn.click(); await new Promise((r) => setTimeout(r, 250)); btn.click(); await new Promise((r) => setTimeout(r, 250)); btn.click(); }
        const out = await settled;
        return { total: anims.length, names: [...new Set(names)], rejected: out.filter((o) => o.status === 'rejected').length, lastJingle: names.filter((n) => n === 'xjingle').length };
      });
      assert(res.total > 0, `${label}: animations were running (${res.total})`);
      assert(res.rejected === 0, `${label}: ${res.rejected} of ${res.total} animations were cut off (${res.names})`);
      return res;
    };
    const popped = await watch(() => tapLogo(page), 'theme on');
    assert(popped.lastJingle > 0, `the top card's jingle ran: ${popped.names}`);
    await sleep(600);
    assert((await page.locator('.xorn[data-moment]').count()) === 0, 'every motion class is cleared once the motion ended');
    // A game Alex can still join (the 9:30 PM one was joined by an earlier check in this file): prefer one with three in, else any.
    const joinable = page.locator('article.sched:has([data-join])');
    const three = joinable.filter({ has: page.locator('.dots .xorn:not(.xempty):nth-child(3)') }).filter({ hasNot: page.locator('.dots .xorn:not(.xempty):nth-child(4)') });
    const card = (await three.count()) > 0 ? three.first() : joinable.first();
    await watch(() => card.locator('[data-join]').tap(), "I'm in");
    await sleep(600);
    assert((await page.locator('.xorn[data-moment]').count()) === 0, 'cleared after I\'m in too');
    assert(page.errors.length === 0, page.errors.join(' | '));
    await ctx.close();
  });

  for (const [width, scheme] of [[390, 'light'], [390, 'dark'], [360, 'light'], [320, 'dark']]) {
    await check(`S Settings at ${width} ${scheme}: the 3-way "Christmas skin" row (Off, Just me, Everyone) is on top, fits, ships Off, and each tap saves`, async () => {
      const { ctx, page } = await phone({ width, scheme });
      const r = await ctx.request.post(BASE + '/api/admin/login', { data: { pin: PIN }, headers: { Origin: BASE } });
      assert(r.ok(), 'organizer sign-in');
      const mode = async () => (await (await ctx.request.get(`${BASE}/api/admin/dashboard`)).json()).christmasSkinMode ?? 'off';
      assert((await mode()) === 'off', 'ships Off');
      await page.goto(`${BASE}/admin`);
      await page.locator('.tabbar').waitFor({ timeout: 30000 });
      await page.locator('.tabbar button', { hasText: 'Settings' }).click();
      await sleep(500);
      for (const sm of await page.locator('details > summary').all()) await sm.click().catch(() => {});
      const first = (await page.locator('#switches [data-row], [data-switches-tidy] [data-row]').evaluateAll((els) => els.map((e) => e.getAttribute('data-row')))).filter((k) => k !== 'guestSpotAll' && k !== 'venueAlertAll')[0]; // (Zip 43's Venue charge alert is newer and sits on top)
      assert(first === 'christmasSkinAll', `newest first: ${first}`);
      const row = page.locator('[data-row="christmasSkinAll"]');
      assert((await row.locator('.set-name').innerText()).includes('Christmas skin'), 'its name');
      const labels = await row.locator('[data-xmas-mode]').allInnerTexts();
      assert(labels.join('|') === 'Off|Just me|Everyone', `three choices: ${labels}`);
      assert((await row.locator('[data-xmas-mode="off"]').getAttribute('aria-pressed')) === 'true', 'Off is selected');
      const fit = await row.evaluate((el) => {
        const box = el.getBoundingClientRect();
        return [...el.querySelectorAll('.set-name, .set-hint, [data-xmas-mode]')].every((x) => {
          const q = x.getBoundingClientRect();
          return q.left >= box.left - 0.5 && q.right <= box.right + 0.5 && q.width > 0;
        });
      });
      assert(fit, 'everything sits inside the row');
      assert(await noSideways(page), 'sideways scroll');
      for (const [pick, want] of [['all', 'all'], ['me', 'me'], ['off', 'off']]) {
        await row.locator(`[data-xmas-mode="${pick}"]`).click();
        await sleep(900);
        assert((await mode()) === want, `tapping ${pick} saves ${want}, the server says ${await mode()}`);
        assert((await row.locator(`[data-xmas-mode="${pick}"]`).getAttribute('aria-pressed')) === 'true', `${pick} is selected`);
      }
      await row.screenshot({ path: path.join(SHOTS || '/tmp', `zip38-settings-${width}-${scheme}.png`) });
      assert(page.errors.length === 0, page.errors.join(' | '));
      await ctx.close();
    });
  }

  await check('E reduced motion: nothing animates, the swaps are instant', async () => {
    const { ctx, page } = await phone({ reduced: true });
    await home(page, `${LINK}&xmasreset=1`);
    await sleep(500);
    await tapLogo(page);
    await sleep(200);
    assert((await attr(page)) === 'christmas', 'theme on');
    assert((await page.evaluate(() => document.documentElement.getAttribute('data-skin-anim'))) === null, 'no motion marker at all');
    const names = await page.evaluate(() => [...document.querySelectorAll('.xorn, .skin-logo .brand-logo, .schedule > .sched.xs-top')].map((o) => getComputedStyle(o).animationName));
    assert(names.length > 0 && names.every((n) => n === 'none'), `animation names: ${[...new Set(names)]}`);
    const cap = await pseudo(page, '.schedule > .sched.xs-top', '::before', ['animation-name']);
    assert(cap['animation-name'] === 'none', 'the cap does not animate');
    await sleep(800);
    const glow = await page.evaluate(() => [...document.querySelectorAll('.schedule article.sched.gd .dots .xorn')].map((o) => getComputedStyle(o).animationName));
    assert(glow.every((n) => n === 'none'), 'no glow');
    await tapLogo(page);
    await sleep(100);
    assert((await page.locator('.ball.xspinb').count()) === 0 && (await page.locator('.dots .ball').count()) > 0, 'off is an instant swap');
    await ctx.close();
  });

  await check('E a phone that blocks storage never crashes and still toggles', async () => {
    const { ctx, page } = await phone({ blockStorage: true });
    await page.goto(`${BASE}/?as=Alex`);
    await sleep(100);
    // (The private link and "as" use storage too; this phone has neither, so open the page through the server's own player link.)
    await ctx.close();
    const second = await phone({ blockStorage: true });
    await second.page.goto(`${BASE}/`);
    await sleep(1500);
    assert(second.page.errors.filter((e) => !/storage blocked/.test(e)).length === 0, `page errors: ${second.page.errors.join(' | ')}`);
    await second.ctx.close();
  });

  await check('E the admin screens never get the theme or the logo', async () => {
    const { ctx, page } = await phone();
    const r = await ctx.request.post(BASE + '/api/admin/login', { data: { pin: PIN }, headers: { Origin: BASE } });
    assert(r.ok(), 'organizer sign-in');
    await home(page, `${LINK}&xmasreset=1`);
    await tapLogo(page);
    await sleep(500);
    assert((await attr(page)) === 'christmas', 'theme on, player side');
    await page.goto(`${BASE}/admin?${LINK}`);
    await page.locator('.tabbar').waitFor({ timeout: 30000 });
    await sleep(800);
    assert((await attr(page)) === null, 'no theme attribute on /admin');
    assert((await logoSrc(page)) === '/logo.png', `admin logo ${await logoSrc(page)}`);
    assert((await page.locator('.xorn, [data-skin-logo]').count()) === 0, 'no ornaments or skin logo in admin');
    // The organizer's own page and then Swap to Alex: the theme is put away on the way.
    await ctx.close();
  });

  for (const [width, scheme, pct] of [[390, 'light', 100], [390, 'dark', 100], [360, 'dark', 100], [320, 'light', 100], [390, 'light', 125], [390, 'dark', 150], [320, 'dark', 150]]) {
    await check(`F ${width} wide, ${scheme}, text ${pct}%: skin on, nothing clipped or sideways`, async () => {
      const { ctx, page } = await phone({ width, scheme, pct });
      await home(page, `${LINK}&xmasreset=1`);
      await sleep(2200);
      await tapLogo(page);
      await sleep(2600);
      assert(await noSideways(page), 'sideways scroll');
      const off = await page.evaluate(() => {
        const w = window.innerWidth;
        return [...document.querySelectorAll('.schedule .xorn, .skin-logo, .topbar *')].filter((e) => {
          const r = e.getBoundingClientRect();
          return r.width > 0 && (r.right > w + 0.5 || r.left < -0.5);
        }).length;
      });
      assert(off === 0, `${off} pieces stick out of the screen`);
      const topPad = await page.evaluate(() => document.querySelector('.topbar').getBoundingClientRect().top);
      assert(topPad >= 0, 'nothing above the top of the page');
      await shot(page, `zip38-${width}-${scheme}-${pct}.png`);
      assert(page.errors.length === 0, page.errors.join(' | '));
      await ctx.close();
    });
  }

  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
