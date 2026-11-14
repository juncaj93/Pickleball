/* Zip 41 (🎾41.tilerules): one simple outline rule for the date tiles on the PLAYER Home, in a real browser.
 *
 *   node e2e/zip41.cjs      (also run by npm run test:e2e)       E2E_SHOTS=<folder> keeps the pictures
 *
 * The SMALL fake world (scripts/load-small-local.ts) as of Thu Nov 12, 2026, 3:00 PM Eastern (TONIGHT, TOMORROW, a canceled game, next week), and
 * again as of Thu Nov 5 (so the games a week later sit in the LATER row). Every wrangler.toml switch as on live.
 *   A  every tile has the same fill; the outline is ONE solid line, identical whatever the court status (booked, not booked, "~8 PM", extra, no
 *      status); no old status layer (.tb) exists on a player tile; canceled keeps its old look;
 *   B  the outline by ROW: this week 2 px ink (mint in dark), next week 1.5 px charcoal, later 1 px charcoal; the tonight and tomorrow tiles are in THIS WEEK;
 *   C  Christmas skin ON: only the TONIGHT and TOMORROW tiles change (red 2 px outline, red band with white word in light, cream band with red word in dark);
 *      every other tile has the normal outline; Christmas Off shows the normal theme exactly;
 *   D  the organizer's tiles keep their court-status ring layers (the admin screens are untouched);
 *   E  at 390 and 360 px, light and dark: nothing sideways.
 */
const { spawn, spawnSync } = require('node:child_process');
const { readFileSync, mkdirSync, rmSync } = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.E2E_PORT) || 5441;
const BASE = `http://localhost:${PORT}`;
const SEED_ISO = '2026-11-12T20:00:00.000Z'; // Thu Nov 12, 3:00 PM Eastern
const EARLIER_MS = Date.parse('2026-11-05T20:00:00.000Z'); // a week earlier: the Nov 15 to Nov 19 games are LATER
const NOW_MS = Date.parse(SEED_ISO);
const SHOTS = process.env.E2E_SHOTS || '';
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
    console.log(`  ✗ ${name}\n      ${String(err && err.message ? err.message : err).replace(/\s*\n\s*/g, ' ⏎ ').slice(0, 1600)}`);
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function liveVars() {
  const toml = readFileSync(path.join(ROOT, 'wrangler.toml'), 'utf8');
  const top = toml.slice(toml.indexOf('[vars]'), toml.indexOf('[env.preview]'));
  const out = {};
  for (const m of top.matchAll(/^([A-Z_][A-Z0-9_]*)\s*=\s*"([^"]*)"/gm)) if (m[1] !== 'SITE_URL') out[m[1]] = m[2];
  return out;
}

// The colors Alex approved (mocks/ in the zip).
const INK = 'rgb(24, 36, 29)';
const MINT = 'rgb(139, 217, 163)';
const CHAR_L = 'rgb(91, 98, 90)';
const CHAR_D = 'rgb(142, 152, 143)';
const RED_L = 'rgb(200, 49, 47)';
const RED_D = 'rgb(217, 58, 53)';
const CREAM = 'rgb(251, 246, 234)';
const WHITE = 'rgb(255, 255, 255)';

async function main() {
  const dbFile = path.join(ROOT, '.data', `zip41-${PORT}.sqlite`);
  mkdirSync(path.join(ROOT, '.data'), { recursive: true });
  if (SHOTS) mkdirSync(SHOTS, { recursive: true });
  rmSync(dbFile, { force: true });
  const seeded = spawnSync('npx', ['vite-node', 'scripts/load-small-local.ts', '--', dbFile, SEED_ISO], { cwd: ROOT, encoding: 'utf8' });
  if (seeded.status !== 0) throw new Error(`could not build the fake world: ${seeded.stderr || seeded.stdout}`);
  if (await fetch(`${BASE}/api/status`).then((r) => r.ok, () => false)) throw new Error(`port ${PORT} is already in use`);
  const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
    cwd: ROOT,
    env: { ...process.env, ...liveVars(), DEV_DB: dbFile, SETUP_TOKEN: 'zip41-setup-token-0123456789', DEV_CLOCK: '1', PREVIEW_CALM: 'on', CHRISTMAS_SKIN_PREVIEW: 'on' },
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
  const setClock = (atMs) => fetch(`${BASE}/__dev/clock`, { method: 'POST', body: JSON.stringify({ atMs }) });
  await setClock(NOW_MS);
  const browser = await chromium.launch();

  async function phone({ width = 390, scheme = 'light', nowMs = NOW_MS } = {}) {
    const ctx = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, colorScheme: scheme, reducedMotion: 'reduce' });
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
    }, nowMs - Date.now());
    const page = await ctx.newPage();
    page.errors = [];
    page.on('pageerror', (e) => page.errors.push(String(e)));
    return { ctx, page };
  }
  /** mode: 'off' = Christmas skin Off for everyone; 'xmas' = Everyone, theme tapped ON. */
  async function home(page, mode, shotName) {
    const q = mode === 'xmas' ? 'xmasmode=all&xmasdate=2026-12-05&xmasreset=1' : 'xmasmode=off';
    await page.goto(`${BASE}/?as=Alex&${q}`);
    await page.locator('.schedule article.sched').first().waitFor({ timeout: 30000 });
    await sleep(900);
    if (mode === 'xmas') {
      await page.locator('[data-skin-logo]').tap();
      await sleep(2600);
    }
    await page.addStyleTag({ content: '*{animation:none!important;transition:none!important}' });
    await sleep(150);
    if (SHOTS && shotName) await page.screenshot({ path: path.join(SHOTS, shotName + '.png'), fullPage: true });
  }
  /** One record per game card on the page. */
  const tiles = (page) =>
    page.evaluate(() =>
      [...document.querySelectorAll('.schedule > article.sched')].map((a) => {
        const t = a.querySelector('.tile.ptile');
        const cs = getComputedStyle(t);
        const tag = t.querySelector('.day-tag');
        const tagCs = tag ? getComputedStyle(tag) : null;
        return {
          row: a.classList.contains('cl-later') ? 'later' : a.classList.contains('tier-next') ? 'next' : a.classList.contains('tier-this') ? 'this' : 'later',
          off: a.classList.contains('off'),
          extra: a.getAttribute('data-extra') === 'yes',
          status: ['ts-booked', 'ts-none', 'ts-wait'].find((c) => t.classList.contains(c)) || (t.classList.contains('ts') ? 'ts' : 'none'),
          day: t.classList.contains('day-tonight') ? 'tonight' : t.classList.contains('day-tomorrow') ? 'tomorrow' : '',
          style: cs.borderTopStyle,
          width: cs.getPropertyValue('--tile-ol-w').trim(),
          color: cs.borderTopColor,
          sides: [cs.borderTopWidth, cs.borderRightWidth, cs.borderBottomWidth, cs.borderLeftWidth].join(' '),
          fill: cs.backgroundColor,
          layers: t.querySelectorAll('.tb, .tb-solid, .tb-dash').length,
          shadow: cs.boxShadow,
          bandBg: tagCs ? tagCs.backgroundColor : null,
          bandInk: tagCs ? tagCs.color : null,
          dowColor: t.querySelector('.dow') ? getComputedStyle(t.querySelector('.dow')).color : null,
          monColor: getComputedStyle(t.querySelector('.mon')).color,
          dayColor: getComputedStyle(t.querySelector('.day')).color,
          time: (a.querySelector('.sched-time')?.textContent || '').slice(0, 9),
        };
      }),
    );
  const noSideways = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 0.5);
  const sameFill = (list, m) => assert(new Set(list.map((t) => t.fill)).size === 1, `${m}: every tile has one fill: ${[...new Set(list.map((t) => t.fill))]}`);

  for (const scheme of ['light', 'dark']) {
    const ink = scheme === 'light' ? INK : MINT;
    const quiet = scheme === 'light' ? CHAR_L : CHAR_D;

    await check(`A+B normal theme, ${scheme}: same fill, one solid outline, color and thickness by row only`, async () => {
      const { ctx, page } = await phone({ scheme });
      await home(page, 'off', `normal-${scheme}-390`);
      const list = await tiles(page);
      const live = list.filter((t) => !t.off);
      assert(live.length >= 10, `enough games on the page: ${live.length}`);
      sameFill(list, 'all');
      assert(list.every((t) => t.layers === 0), `no .tb layers at all: ${list.filter((t) => t.layers).length}`);
      assert(live.every((t) => t.style === 'solid'), `every outline is solid: ${live.map((t) => t.style)}`);
      assert(live.every((t) => new Set(t.sides.split(' ')).size === 1), 'all four sides the same width');
      // The situations: booked, not booked, "~8 PM", extra (a game with no status at all looks the same by the same rule).
      const kinds = new Set(live.map((t) => (t.extra ? 'extra' : t.status)));
      for (const k of ['ts-booked', 'ts-none', 'ts-wait', 'extra']) assert(kinds.has(k), `the fake world has a ${k} game (has ${[...kinds]})`);
      // The row decides, never the status.
      for (const row of ['this', 'next']) {
        const r = live.filter((t) => t.row === row);
        assert(r.length > 0, `${row} row has games`);
        assert(new Set(r.map((t) => `${t.style} ${t.width} ${t.color} ${t.sides}`)).size === 1, `${row}: identical outline whatever the status: ${[...new Set(r.map((t) => `${t.status}/${t.extra} ${t.width} ${t.color}`))]}`);
      }
      const thisRow = live.filter((t) => t.row === 'this');
      assert(thisRow[0].width === '2px' && thisRow[0].color === ink, `this week 2px ${ink}: ${thisRow[0].width} ${thisRow[0].color}`);
      assert(thisRow.some((t) => t.day === 'tonight') && thisRow.some((t) => t.day === 'tomorrow'), 'tonight and tomorrow tiles are in THIS WEEK, with the same outline');
      const nextRow = live.filter((t) => t.row === 'next');
      assert(nextRow[0].width === '1.5px' && nextRow[0].color === quiet, `next week 1.5px ${quiet}: ${nextRow[0].width} ${nextRow[0].color}`);
      // Extra games: same fill, red weekday, plain month and day.
      const extras = live.filter((t) => t.extra);
      assert(extras.length > 0 && extras.every((t) => t.fill === live.find((x) => !x.extra).fill), 'extra games have the same fill');
      const plainNext = nextRow.filter((t) => !t.extra && t.dowColor)[0];
      for (const e of nextRow.filter((t) => t.extra && t.dowColor)) assert(e.dowColor === plainNext.dowColor && e.monColor === plainNext.monColor && e.dayColor === plainNext.dayColor, 'extra tile text colors are the normal ones');
      // Canceled: its old look (2 px ink / light line), not the row color.
      const canceled = list.filter((t) => t.off);
      assert(canceled.length > 0, 'a canceled game exists');
      const oldCanceled = scheme === 'light' ? INK : 'rgb(241, 243, 236)';
      assert(canceled.every((t) => t.style === 'solid' && t.color === oldCanceled), `canceled keeps its old outline: ${canceled.map((t) => t.color)}`);
      assert(page.errors.length === 0, page.errors.join(' | '));
      await ctx.close();
    });

    await check(`B LATER row, ${scheme}: 1 px charcoal, same for every status`, async () => {
      const { ctx, page } = await phone({ scheme, nowMs: EARLIER_MS });
      await setClock(EARLIER_MS);
      try {
      await home(page, 'off');
      await page.locator('button', { hasText: 'More sessions' }).first().click();
      await sleep(900);
      if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `later-${scheme}-390.png`), fullPage: true });
      const list = await tiles(page);
      const later = list.filter((t) => t.row === 'later' && !t.off);
      assert(later.length >= 3, `LATER games on the page: ${later.length} (rows: ${list.map((t) => t.row + (t.off ? "-off" : "")).join(",")})`);
      assert(new Set(later.map((t) => `${t.style} ${t.width} ${t.color}`)).size === 1, `identical LATER outline: ${[...new Set(later.map((t) => `${t.status} ${t.width} ${t.color}`))]}`);
      assert(later[0].width === '1px' && later[0].color === quiet && later[0].style === 'solid', `later 1px ${quiet}: ${later[0].width} ${later[0].color}`);
      sameFill(list, 'later page');
      const next = list.filter((t) => t.row === 'next' && !t.off);
      assert(next.length > 0 && next[0].width === '1.5px', 'next week is 1.5px on the same page');
      assert(list.every((t) => t.layers === 0), 'no status layers');
      } finally {
        await setClock(NOW_MS);
        await ctx.close();
      }
    });
  }

  for (const scheme of ['light', 'dark']) {
    await check(`C Christmas skin ON, ${scheme}: only TONIGHT and TOMORROW change (red outline, band); every other tile is normal`, async () => {
      const { ctx, page } = await phone({ scheme });
      await home(page, 'off');
      const normal = await tiles(page);
      await home(page, 'xmas', `xmas-${scheme}-390`);
      const x = await tiles(page);
      assert(x.length === normal.length, 'same games');
      const red = scheme === 'light' ? RED_L : RED_D;
      const bandBg = scheme === 'light' ? RED_L : CREAM;
      const bandInk = scheme === 'light' ? WHITE : RED_L;
      let specials = 0;
      x.forEach((t, i) => {
        const n = normal[i];
        if (t.day) {
          specials++;
          assert(t.style === 'solid' && t.width === '2px' && t.color === red, `${t.day} tile red 2px ${red}: ${t.width} ${t.color}`);
          assert(t.bandBg === bandBg && t.bandInk === bandInk, `${t.day} band ${bandBg} / ${bandInk}: ${t.bandBg} / ${t.bandInk}`);
        } else {
          assert(t.color === n.color && t.width === n.width && t.style === n.style && t.fill === n.fill, `ordinary tile ${i} (${t.time}) is the normal tile: ${t.width} ${t.color} vs ${n.width} ${n.color}`);
        }
        assert(t.layers === 0, 'no status layers');
      });
      assert(specials >= 5, `tonight and tomorrow tiles present: ${specials}`);
      // Nothing else turns red: the outline of the "~8 PM", not-booked and extra tiles is the row's charcoal.
      assert(x.filter((t) => !t.day && !t.off).every((t) => t.color !== RED_L && t.color !== RED_D), 'no red outline outside tonight and tomorrow');
      assert(await noSideways(page), 'nothing sideways');
      await ctx.close();
    });

    await check(`C Christmas skin OFF, ${scheme}: the normal theme exactly (same as the first normal page)`, async () => {
      const { ctx, page } = await phone({ scheme });
      await home(page, 'off');
      const a = await tiles(page);
      await page.goto(`${BASE}/?as=Alex&xmasmode=all&xmasdate=2026-12-05&xmasreset=1`);
      await page.locator('.schedule article.sched').first().waitFor();
      await sleep(900);
      // Everyone mode, theme not tapped: no Christmas theme attribute, so the plain look.
      assert((await page.evaluate(() => document.documentElement.getAttribute('data-skin'))) === null, 'theme starts OFF');
      const b = await tiles(page);
      assert(JSON.stringify(a.map((t) => [t.style, t.width, t.color, t.fill, t.bandBg, t.bandInk])) === JSON.stringify(b.map((t) => [t.style, t.width, t.color, t.fill, t.bandBg, t.bandInk])), 'theme off = the normal look');
      assert(a.filter((t) => t.day).every((t) => t.color !== RED_L && t.color !== RED_D && t.bandBg !== RED_L && t.bandBg !== CREAM), 'no Christmas red or cream in the normal theme');
      await ctx.close();
    });
  }

  await check('D the organizer tiles keep their court-status ring (the admin screens are untouched)', async () => {
    const { ctx, page } = await phone();
    const r = await ctx.request.post(BASE + '/api/admin/login', { data: { pin: PIN }, headers: { Origin: BASE } });
    assert(r.ok(), 'organizer sign-in');
    await page.goto(`${BASE}/admin`);
    await page.locator('.tabbar').waitFor({ timeout: 30000 });
    await sleep(1200);
    const info = await page.evaluate(() => {
      const ts = [...document.querySelectorAll('.admin-page .tile.ts')];
      return { n: ts.length, layers: ts.filter((t) => t.querySelectorAll('.tb').length === 2).length, ptile: document.querySelectorAll('.admin-page .ptile').length };
    });
    assert(info.n > 0, 'the organizer Home has court-status tiles');
    assert(info.layers === info.n, `each keeps its two ring layers: ${info.layers} of ${info.n}`);
    assert(info.ptile === 0, 'no player tile on the organizer screen');
    await ctx.close();
  });

  for (const width of [390, 360]) {
    for (const scheme of ['light', 'dark']) {
      await check(`E ${width}px ${scheme}: nothing sideways (normal and Christmas)`, async () => {
        const { ctx, page } = await phone({ width, scheme });
        await home(page, 'off', `normal-${scheme}-${width}`);
        assert(await noSideways(page), 'normal: nothing sideways');
        await home(page, 'xmas', `xmas-${scheme}-${width}`);
        assert(await noSideways(page), 'Christmas: nothing sideways');
        assert(page.errors.length === 0, page.errors.join(' | '));
        await ctx.close();
      });
    }
  }

  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
