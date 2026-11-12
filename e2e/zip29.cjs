/* Zip 29 (look and name polish): browser checks for items 2, 3 and 4. (Item 1, the name, is tests/zip29-rename.test.ts; item 5 changed nothing.)
 *
 *   node e2e/zip29.cjs      (also run by npm run test:e2e)
 *
 * The world: the SMALL preview cast (scripts/load-small-local.ts) as of Tue Nov 10, 7:20 PM Eastern, every Settings row on as on live, every
 * wrangler.toml switch as on live, PREVIEW_CALM on as on the preview. Alex's game tonight is Booked with Court 13 (set through the organizer's
 * own API, as Alex does), and Alex is added to the Thursday "All paid" game so a plain weekday tile with a badge exists too.
 * Own dev server on its own port and its own copy; nothing touches Cloudflare or live.
 *
 * Engines: WebKit (the engine of every iPhone) when it can start here (set PLAYWRIGHT_BROWSERS_PATH to a folder holding it), else Chromium,
 * and the report says which. Pictures are taken at device scale 3 (a real iPhone) so every pixel check reads real device pixels.
 *
 * Item 2, the player's Tonight card (390, 360 and 320 wide, light and dark, text 100, 125 and 150%):
 *   - the Tonight tile is the same size as the weekday tile on the other THIS WEEK cards (width and height), the band replaces the weekday
 *   - band: dark green with white letters in light mode, bright green with dark letters in dark mode, contrast 4.5 or better, edge to edge
 *     inside the outline (pixels sampled just inside every rounded corner must be the band's color, never a pale gap)
 *   - outline: dark ink in light mode, green in dark mode
 *   - glow: one soft shadow around the tile only; no ancestor clips it (overflow, paint containment, clip-path), and the picture is smooth
 *     (no step in brightness along a line out from the tile: a cut-off glow shows as a straight edge)
 *   - badge: centered on the tile's top-right corner, on top of everything (hit tests all around it), a ring of the card's own color around it
 *     (pixels), nothing clips it; the same on the Thursday (weekday) card
 *   - Court and Directions side by side at 390 and 360 (and 320 at normal text); any size: no text cut off, nothing overlapping
 * Item 3: the length line under the time (player cards and admin game tiles) is the game's own length, small, regular weight, a tad gray,
 *   quieter than the time.
 * Item 4, the organizer's Home:
 *   a. Court 13 | arrow on a game with a court number (the arrow is the player card's Directions link); the clock cell where there is none
 *   b. money cell: all paid = green circle with a check and normal text; anyone owes (or nobody paid yet) = amber circle with $ and amber text;
 *      the circle and the text are the size they were
 *   c. the folded TONIGHT tile (and TOM) at 420, 390, 360 and 320 wide, text 100, 125 and 150%, light and dark, WebKit at device scale 3: the
 *      glyph box of the word is fully inside the band (at least 3 px above and below), inside the tile's inside edge (at least 2 px each side),
 *      the band never touches the big date number, and nothing between the word and the tile clips it
 * E2E_BREAK=band|tile|badge|glow puts the old rules back and the matching checks must fail (proof the checks bite).
 */
const { spawn, spawnSync } = require('node:child_process');
const { readFileSync, mkdirSync, rmSync } = require('node:fs');
const path = require('node:path');
const playwright = require('playwright');
const { findClipping } = require('./clip-check.cjs');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.E2E_PORT) || 5433;
const BASE = `http://localhost:${PORT}`;
const SEED_ISO = '2026-11-11T00:20:00.000Z'; // Tue Nov 10, 7:20 PM Eastern
const NOW_MS = Date.parse(SEED_ISO);
const SHOTS = process.env.E2E_SHOTS || path.join(__dirname, 'screenshots');
const PIN = /PIN `(\d{6})`/.exec(readFileSync(path.join(ROOT, 'docs/PREVIEW_FAKE_DB.md'), 'utf8'))[1];
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const BREAK = process.env.E2E_BREAK || '';

const knownOnMain = new Set();
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
    console.log(`  ✗ ${name}\n      ${String(err && err.message ? err.message : err).replace(/\s*\n\s*/g, ' ⏎ ').slice(0, 900)}`);
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

// ---- pixel helpers (a blank page decodes a screenshot and reads its pixels) ----
let decoder = null;
async function decode(buf) {
  return decoder.evaluate(async (b64) => {
    const blob = await (await fetch(`data:image/png;base64,${b64}`)).blob();
    const bmp = await createImageBitmap(blob);
    const c = document.createElement('canvas');
    c.width = bmp.width;
    c.height = bmp.height;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(bmp, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height);
    // Keep the pixels on the page; the checks ask for single pixels by number.
    window.__img = d;
    return { w: c.width, h: c.height };
  }, buf.toString('base64'));
}
const pixel = (x, y) =>
  decoder.evaluate(
    ([x, y]) => {
      const d = window.__img;
      const i = (Math.max(0, Math.min(d.height - 1, y)) * d.width + Math.max(0, Math.min(d.width - 1, x))) * 4;
      return [d.data[i], d.data[i + 1], d.data[i + 2]];
    },
    [Math.round(x), Math.round(y)],
  );
const parseRgb = (s) => {
  const m = /rgba?\(([\d.]+)[, ]+([\d.]+)[, ]+([\d.]+)/.exec(s || '');
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
};
const near = (a, b, tol) => a && b && Math.abs(a[0] - b[0]) <= tol && Math.abs(a[1] - b[1]) <= tol && Math.abs(a[2] - b[2]) <= tol;
const lum = (c) => {
  const f = (v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
};
const contrast = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

/** The old rules, put back on purpose (E2E_BREAK), so the matching checks must fail. */
const BREAKS = {
  tile: 'html[data-game-day] .schedule > .sched.gd .sched-tilecol{width:66px !important} html[data-game-day] .schedule > .sched.gd .tile.ptile{width:66px !important}',
  band: ':root[data-tonight-glow] .hv2-short .tile .day-tag{height:auto !important;font-size:6.75px !important;padding:3px 0 2px !important;display:block !important;overflow:hidden !important;line-height:1.15 !important} :root[data-tonight-glow] .hv2-short .tile.day-tonight{overflow:visible !important}',
  badge: '.schedule .tile-wrap > .tile-check{border:0 !important;top:-4px !important;right:-4px !important} .tile-wrap{overflow:hidden !important}',
  glow: '.sched-tilecol{overflow:hidden !important}',
};

async function main() {
  mkdirSync(SHOTS, { recursive: true });
  const dbFile = path.join(ROOT, '.data', `zip29-${PORT}.sqlite`);
  mkdirSync(path.join(ROOT, '.data'), { recursive: true });
  rmSync(dbFile, { force: true });
  const seeded = spawnSync('npx', ['vite-node', 'scripts/load-small-local.ts', '--', dbFile, SEED_ISO], { cwd: ROOT, encoding: 'utf8' });
  if (seeded.status !== 0) throw new Error(`could not build the fake world: ${seeded.stderr || seeded.stdout}`);
  const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
    cwd: ROOT,
    env: { ...process.env, ...liveVars(), DEV_DB: dbFile, SETUP_TOKEN: 'zip29-setup-token-0123456789', DEV_CLOCK: '1', PREVIEW_CALM: 'on' },
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

  let engineName = 'chromium';
  let browser;
  try {
    browser = await playwright.webkit.launch();
    engineName = 'webkit';
  } catch {
    browser = await playwright.chromium.launch();
  }
  console.log(`engine: ${engineName}${engineName === 'chromium' ? ' (WebKit could not start here; the folded-tile check is then proven in Chromium only)' : ''}`);
  const chromiumBrowser = engineName === 'chromium' ? browser : await playwright.chromium.launch();
  decoder = await (await chromiumBrowser.newContext()).newPage();

  async function phone(br, { width = 390, scheme = 'light', signedIn = false, pct = 100, scale = 3 } = {}) {
    const ctx = await br.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: scale, isMobile: true, hasTouch: true, colorScheme: scheme, userAgent: UA, reducedMotion: 'reduce' });
    await ctx.addInitScript(
      ({ delta }) => {
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
        try {
          localStorage.setItem('pb_games_filter', 'all');
        } catch {}
      },
      { delta: NOW_MS - Date.now() },
    );
    await ctx.route('https://venmo.com/**', (r) => r.abort());
    if (signedIn) {
      const r = await ctx.request.post(BASE + '/api/admin/login', { data: { pin: PIN }, headers: { Origin: BASE } });
      assert(r.ok(), 'organizer sign-in');
    }
    const page = await ctx.newPage();
    page._pct = pct;
    return { ctx, page };
  }
  async function bigText(page, pct) {
    const css = (pct !== 100 ? `html { font-size: ${pct}% !important; } body { font-size: ${(17 * pct) / 100}px !important; }` : '') + (BREAK && BREAKS[BREAK] ? BREAKS[BREAK] : '');
    if (css) await page.addStyleTag({ content: css });
    await page.waitForTimeout(350);
  }

  // ---- set the world up: Alex's game tonight is Booked, Court 13; Alex joins the Thursday "All paid" game ----
  const world = {};
  {
    const { ctx } = await phone(chromiumBrowser, { signedIn: true });
    const api = (m, u, data) => ctx.request.fetch(BASE + u, { method: m, data: data ?? {}, headers: { Origin: BASE } });
    const dash = await (await api('GET', '/api/admin/dashboard')).json();
    const tonight = dash.sessions.filter((s) => s.startsAt >= '2026-11-11T00:00:00.000Z' && s.startsAt < '2026-11-11T05:00:00.000Z').sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    world.tonightId = tonight[0].id;
    assert((await api('POST', `/api/admin/sessions/${world.tonightId}/booked`)).ok(), 'book tonight');
    assert((await api('PUT', `/api/admin/sessions/${world.tonightId}/court-number`, { court: 13 })).ok(), 'court 13');
    // A game from an earlier day (Sunday) with a court number, to prove past games keep what they showed.
    const earlier = dash.sessions.filter((x) => x.startsAt >= '2026-11-08T00:00:00.000Z' && x.startsAt < '2026-11-10T00:00:00.000Z' && !x.state.flags.canceled).sort((a, b) => a.startsAt.localeCompare(b.startsAt))[0];
    world.pastCourtId = earlier.id;
    assert((await api('PUT', `/api/admin/sessions/${earlier.id}/court-number`, { court: 7 })).ok(), 'court 7 on an earlier game');
    const allPaid = dash.sessions.find((s) => s.note === 'All paid');
    world.allPaidId = allPaid.id;
    const j = await api('POST', `/api/admin/sessions/${allPaid.id}/me`, { in: true });
    assert(j.ok(), `Alex joins the All paid game: ${j.status}`);
    // The last Tonight game (9:30 PM, 3 in) gets everybody paid, so a card in the all-paid state is on the screen.
    const last = tonight[tonight.length - 1];
    const full = await (await api('GET', '/api/admin/dashboard')).json();
    const lastNow = full.sessions.find((x) => x.id === last.id);
    for (const r of lastNow.roster.filter((x) => !x.isOrganizer && x.status === 'confirmed' && x.paymentStatus === 'unpaid'))
      assert((await api('POST', `/api/admin/sessions/${last.id}/payment`, { playerId: r.playerId, paid: true, seen: r.moneySeen, cents: r.owesCents })).ok(), `mark ${r.name} paid`);
    world.paidAllId = last.id;
    world.needsCourtId = (dash.sessions.find((x) => x.startsAt >= '2026-11-13T00:00:00.000Z' && x.startsAt < '2026-11-13T03:00:00.000Z') || {}).id;
    const d2 = await (await api('GET', '/api/admin/dashboard')).json();
    world.sessions = d2.sessions;
    await ctx.close();
  }
  const lengthOf = (s) => {
    const m = Math.round((Date.parse(s.endsAt) - Date.parse(s.startsAt)) / 60000);
    return m === 90 ? '1.5 hours' : m === 120 ? '2 hours' : m === 150 ? '2.5 hours' : m === 180 ? '3 hours' : m === 60 ? '1 hour' : `${m / 60} hours`;
  };

  // =============================================================================================================================
  // ITEM 2 and 3 (player side)
  // =============================================================================================================================
  async function playerMetrics(page) {
    return page.evaluate((tonightId) => {
      const R = (e) => {
        const b = e.getBoundingClientRect();
        return { x: b.x, y: b.y, w: b.width, h: b.height, r: b.right, b: b.bottom };
      };
      const cs = (e, p) => getComputedStyle(e)[p];
      const glyph = (el) => {
        const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        const rects = [];
        for (let n = w.nextNode(); n; n = w.nextNode()) {
          if (!n.textContent.trim()) continue;
          const rg = document.createRange();
          rg.selectNodeContents(n);
          for (const q of rg.getClientRects()) rects.push({ x: q.x, y: q.y, r: q.right, b: q.bottom });
        }
        if (!rects.length) return null;
        return { x: Math.min(...rects.map((q) => q.x)), y: Math.min(...rects.map((q) => q.y)), r: Math.max(...rects.map((q) => q.r)), b: Math.max(...rects.map((q) => q.b)) };
      };
      const clippers = (el) => {
        const out = [];
        for (let a = el.parentElement; a && a !== document.body && a !== document.documentElement; a = a.parentElement) {
          const s = getComputedStyle(a);
          const contain = s.contain || '';
          if (/hidden|clip|auto|scroll/.test(s.overflowX + ' ' + s.overflowY) || /paint|strict|content/.test(contain) || (s.clipPath && s.clipPath !== 'none') || (s.maskImage && s.maskImage !== 'none')) {
            out.push(`${a.tagName.toLowerCase()}.${String(a.className).split(' ').slice(0, 2).join('.')} overflow=${s.overflowX}/${s.overflowY} contain=${contain} clip=${s.clipPath}`);
          }
        }
        return out;
      };
      const card = document.getElementById(`row-${tonightId}`);
      const cards = [...document.querySelectorAll('.schedule > .sched.tier-this')];
      // A plain weekday tile with a badge: the Thursday "All paid" game (Alex joined it).
      const plain = cards.find((c) => c.querySelector('.tile .dow') && c.querySelector('.tile-check') && !c.classList.contains('gd'));
      // A Tonight tile with no court ring and no badge (an added game, "EXTRA"): the band is cut to the tile's own rounded edge.
      const bare = cards.find((c) => c.id !== `row-${tonightId}` && c.querySelector('.tile.day-tonight') && !c.querySelector('.tile-check'));
      const info = (c, scroll) => {
        if (scroll) c.scrollIntoView({ block: 'center' });
        const tile = c.querySelector('.tile.ptile');
        const wrap = c.querySelector('.tile-wrap');
        const tag = c.querySelector('.day-tag');
        const chk = c.querySelector('.tile-check');
        const tb = c.querySelector('.tb-solid');
        const len = c.querySelector('.z9-length');
        const time = c.querySelector('.sched-time > span');
        return {
          id: c.id,
          card: R(c),
          cardBg: cs(c, 'backgroundColor'),
          tile: R(tile),
          tileCls: tile.className,
          tileShadow: cs(tile, 'boxShadow'),
          radius: parseFloat(cs(tile, 'borderTopLeftRadius')),
          bw: parseFloat(getComputedStyle(tile).getPropertyValue('--tb-w')) || parseFloat(cs(tile, 'borderTopWidth')),
          wrap: R(wrap),
          tag: tag ? R(tag) : null,
          tagBg: tag ? cs(tag, 'backgroundColor') : null,
          tagColor: tag ? cs(tag, 'color') : null,
          tagGlyph: tag ? glyph(tag) : null,
          tagText: tag ? tag.textContent : null,
          dow: tile.querySelector('.dow') ? tile.querySelector('.dow').textContent : null,
          day: R(tile.querySelector('.day')),
          mon: R(tile.querySelector('.mon')),
          ring: tb ? cs(tb, 'boxShadow') : null,
          ringBorder: tb ? cs(tb, 'borderTopColor') : null,
          ownBorder: cs(tile, 'borderTopColor'),
          badge: chk ? R(chk) : null,
          badgeBorder: chk ? cs(chk, 'borderTopWidth') : null,
          badgeClippers: chk ? clippers(chk) : [],
          glowClippers: clippers(tile),
          len: len ? { text: len.textContent, color: cs(len, 'color'), weight: cs(len, 'fontWeight'), size: parseFloat(cs(len, 'fontSize')), r: R(len) } : null,
          time: time ? { color: cs(time, 'color'), weight: cs(time, 'fontWeight'), size: parseFloat(cs(time, 'fontSize')), text: time.textContent } : null,
          btns: [...c.querySelectorAll('.gd-btn')].map((b) => ({ r: R(b), text: b.textContent.trim(), href: b.getAttribute('href') })),
          body: R(c.querySelector('.sched-body')),
          hit: chk
            ? [0, 45, 90, 135, 180, 225, 270, 315].map((deg) => {
                const b = chk.getBoundingClientRect();
                const rad = (b.width / 2) * 0.62;
                const px = b.x + b.width / 2 + Math.cos((deg * Math.PI) / 180) * rad;
                const py = b.y + b.height / 2 + Math.sin((deg * Math.PI) / 180) * rad;
                const top = document.elementFromPoint(px, py);
                return !!top && (top === chk || chk.contains(top));
              })
            : [],
        };
      };
      return { tonight: info(card), plain: plain ? info(plain, true) : null, bare: bare ? info(bare, true) : null, vw: document.documentElement.clientWidth, scrollW: document.documentElement.scrollWidth };
    }, world.tonightId);
  }
  async function freezeGlow(page) {
    await page.addStyleTag({ content: '.tile.day-tonight, .tile.day-tonight::after { animation-play-state: paused !important; animation-delay: -1.1s !important; }' });
  }

  const engines = [{ name: engineName, br: browser, scales: [390, 360, 320] }];
  for (const scheme of ['light', 'dark'])
    for (const width of [390, 360, 320])
      for (const pct of [100, 125, 150]) {
        const tag = `${engineName}, ${width} px, ${scheme}, text ${pct}%`;
        const { ctx, page } = await phone(browser, { width, scheme, pct });
        await page.goto(`${BASE}/?as=Alex`);
        await page.locator(`#row-${world.tonightId}`).waitFor({ timeout: 20000 });
        await page.waitForLoadState('networkidle');
        await bigText(page, pct);
        await page.waitForTimeout(400);
        const m = await playerMetrics(page);
        const T = m.tonight;
        const P = m.plain;
        const ink = scheme === 'light';
        const slack = pct === 100 ? 0.8 : 1.2;

        await check(`item 2 (${tag}): the Tonight tile is the same size as the weekday tile on the other cards, TONIGHT band replaces the weekday`, async () => {
          assert(P, 'no plain weekday card with a badge in the world');
          assert(Math.abs(T.tile.w - P.tile.w) <= slack && Math.abs(T.tile.h - P.tile.h) <= slack, `Tonight tile ${T.tile.w.toFixed(1)} x ${T.tile.h.toFixed(1)} vs weekday tile ${P.tile.w.toFixed(1)} x ${P.tile.h.toFixed(1)}`);
          assert(T.tagText === 'TONIGHT' && T.dow === null, `band text ${T.tagText}, weekday row ${T.dow}`);
          assert(T.tag.b <= T.day.y + 0.5, `band bottom ${T.tag.b} touches the date number at ${T.day.y}`);
        });
        await check(`item 2 (${tag}): band colors and contrast (${ink ? 'dark green, white letters' : 'bright green, dark letters'}), outline ${ink ? 'dark ink' : 'green'}`, async () => {
          const bg = parseRgb(T.tagBg);
          const fg = parseRgb(T.tagColor);
          assert(bg && fg, `colors ${T.tagBg} ${T.tagColor}`);
          if (ink) assert(lum(bg) < 0.14 && lum(fg) > 0.9, `light mode band ${T.tagBg} letters ${T.tagColor}`);
          else assert(lum(bg) > 0.3 && lum(fg) < 0.1, `dark mode band ${T.tagBg} letters ${T.tagColor}`);
          assert(contrast(bg, fg) >= 4.5, `contrast ${contrast(bg, fg).toFixed(2)}`);
          const ring = parseRgb(T.ring && T.ring !== 'none' ? T.ring : T.ringBorder);
          assert(ring, `ring ${T.ring}`);
          if (ink) assert(lum(ring) < 0.05, `outline should be black-ish: ${T.ring}`);
          else assert(lum(ring) > 0.45 && ring[1] > ring[0], `outline should be green: ${T.ring}`);
          // An added game's Tonight tile has no court ring: its own border must be the same ink / green.
          const own = m.bare && parseRgb(m.bare.ownBorder);
          assert(own, `no plain-border Tonight tile (${m.bare && m.bare.ownBorder})`);
          if (ink) assert(lum(own) < 0.05, `plain-border outline should be black-ish: ${m.bare.ownBorder}`);
          else assert(lum(own) > 0.45 && own[1] > own[0], `plain-border outline should be green: ${m.bare.ownBorder}`);
        });
        await check(`item 2 (${tag}): the word TONIGHT sits fully inside its band (3 px above and below, 2 px each side)`, async () => {
          const g = T.tagGlyph;
          assert(g, 'no glyph box');
          const band = T.tag;
          assert(g.y - band.y >= 3 && band.b - g.b >= 3, `glyph ${g.y.toFixed(1)}..${g.b.toFixed(1)} in band ${band.y.toFixed(1)}..${band.b.toFixed(1)}`);
          assert(g.x - T.tile.x >= 2 + T.bw && T.tile.r - g.r >= 2 + T.bw, `glyph ${g.x.toFixed(1)}..${g.r.toFixed(1)} in tile ${T.tile.x.toFixed(1)}..${T.tile.r.toFixed(1)}`);
          // The check badge (centered on the tile's top-right corner) must not touch the word: at the word's top, middle and bottom, the circle's left
          // edge is at least 2 px right of the word's end.
          const b = T.badge;
          const rad = b.w / 2;
          const cx = b.x + rad;
          const cy = b.y + rad;
          for (const y of [g.y, (g.y + g.b) / 2, g.b]) {
            const dy = y - cy;
            if (Math.abs(dy) >= rad) continue;
            const edge = cx - Math.sqrt(rad * rad - dy * dy);
            assert(edge - g.r >= 2, `the word ends at ${g.r.toFixed(1)}, the badge starts at ${edge.toFixed(1)} (${(edge - g.r).toFixed(1)} px)`);
          }
        });
        await check(`item 2 (${tag}): the band fills the tile edge to edge, no pale gap in the top corners (pixels; the ring tile and the plain-border tile)`, async () => {
          await freezeGlow(page);
          const bad = [];
          // Alex's tile (court ring): the top-left corner (the badge sits over the top-right one). An added game's tile (own border): both corners.
          for (const [X, sides] of [[T, ['left']], [m.bare, ['left', 'right']]]) {
            assert(X, 'no Tonight tile to sample');
            await page.evaluate((id) => document.getElementById(id).scrollIntoView({ block: 'center' }), X.id);
            const fresh = await page.evaluate((id) => {
              const b = document.getElementById(id).querySelector('.tile.ptile').getBoundingClientRect();
              return { x: b.x, y: b.y, w: b.width, h: b.height, r: b.right };
            }, X.id);
            const pad = 6;
            const shot = await page.screenshot({ clip: { x: fresh.x - pad, y: fresh.y - pad, width: fresh.w + 2 * pad, height: fresh.h + 2 * pad } });
            const sc = (await decode(shot)).w / (fresh.w + 2 * pad);
            const bg = parseRgb(X.tagBg);
            const R = X.radius;
            const inner = R - X.bw - 1.2;
            const spots = [];
            if (sides.includes('left')) for (const a of [200, 215, 230, 245, 260]) spots.push([fresh.x + R, a]);
            if (sides.includes('right')) for (const a of [280, 295, 310, 325, 340]) spots.push([fresh.r - R, a]);
            for (const [cx, a] of spots) {
              const px = cx + Math.cos((a * Math.PI) / 180) * inner;
              const py = fresh.y + R + Math.sin((a * Math.PI) / 180) * inner;
              const c = await pixel((px - (fresh.x - pad)) * sc, (py - (fresh.y - pad)) * sc);
              if (!near(c, bg, 22)) bad.push(`${X.id.slice(4, 12)} ${a}deg ${c} vs band ${bg}`);
            }
          }
          assert(bad.length === 0, bad.join('; '));
        });
        await check(`item 2 (${tag}): the glow is one soft shadow, nothing around the tile clips it, and the picture has no cut-off step`, async () => {
          assert(T.tileShadow && T.tileShadow !== 'none' && /\d+px/.test(T.tileShadow), `tile shadow ${T.tileShadow}`);
          assert(!/(^|, )rgba?\([^)]*\) 0px 0px 0px [1-9]/.test(T.tileShadow), `a solid ring in the glow: ${T.tileShadow}`);
          assert(T.glowClippers.length === 0, `clipped by ${T.glowClippers.join(' | ')}`);
          await freezeGlow(page);
          await page.evaluate(() => document.querySelectorAll('.tile.day-tonight').forEach((t) => (t.style.animation = 'none')));
          await page.evaluate((id) => document.getElementById(id).scrollIntoView({ block: 'center' }), T.id);
          const ft = await page.evaluate((id) => {
            const b = document.getElementById(id).querySelector('.tile.ptile').getBoundingClientRect();
            return { x: b.x, y: b.y, w: b.width, h: b.height };
          }, T.id);
          const reach = 16;
          const shot = await page.screenshot({ clip: { x: ft.x - reach, y: ft.y - reach, width: ft.w + 2 * reach, height: ft.h + 2 * reach } });
          const dim = await decode(shot);
          const sc = dim.w / (ft.w + 2 * reach);
          const ch = ink ? 0 : 1; // the channel the glow changes most against the card
          const steps = [];
          // Walk outward from three free spots (left, lower left, top; the badge covers the top right and the time sits under the tile).
          const walks = [
            ['left', (t) => [reach - t, reach + ft.h / 2]],
            ['lower left', (t) => [reach - t, reach + ft.h * 0.85]],
            ['top', (t) => [reach + ft.w * 0.3, reach - t]],
          ];
          for (const [name, at] of walks) {
            let prev = null;
            for (let t = 2.2; t < 12; t += 1 / sc) {
              const [x, y] = at(t);
              const c = await pixel(x * sc, y * sc);
              if (prev) steps.push({ name, t, d: Math.abs(c[ch] - prev[ch]) });
              prev = c;
            }
          }
          const worst = steps.reduce((a, b) => (b.d > a.d ? b : a), { d: 0 });
          assert(worst.d <= 9, `a jump of ${worst.d} at ${worst.name} ${worst.t.toFixed(1)} px out`);
        });
        await check(`item 2 (${tag}): the check badge sits on the tile's top-right corner, on top, with a ring of the card's color, clipped by nothing (Tonight and weekday cards)`, async () => {
          for (const [label, X] of [['Tonight', T], ['weekday', P]]) {
            assert(X && X.badge, `${label}: no badge`);
            const cx = X.badge.x + X.badge.w / 2;
            const cy = X.badge.y + X.badge.h / 2;
            assert(Math.abs(cx - X.tile.r) <= 3 && Math.abs(cy - X.tile.y) <= 3, `${label}: badge center ${cx.toFixed(1)},${cy.toFixed(1)} vs corner ${X.tile.r.toFixed(1)},${X.tile.y.toFixed(1)}`);
            assert(X.hit.every(Boolean), `${label}: something sits on top of the badge: ${X.hit}`);
            assert(X.badgeClippers.length === 0, `${label}: clipped by ${X.badgeClippers.join(' | ')}`);
            assert(parseFloat(X.badgeBorder) >= 2.5, `${label}: the ring is ${X.badgeBorder}`);
          }
          await page.evaluate(() => document.querySelectorAll('.tile.day-tonight').forEach((t) => (t.style.animation = 'none')));
          const pad = 4;
          for (const [label, X] of [['Tonight', T], ['weekday', P]]) {
            const box = { x: X.badge.x - pad, y: X.badge.y - pad, width: X.badge.w + 2 * pad, height: X.badge.h + 2 * pad };
            // The weekday card may be off the first screen: scroll it in view first (the numbers were read before, so re-read).
            const fresh = await page.evaluate((id) => {
              const el = document.getElementById(id).querySelector('.tile-check');
              el.scrollIntoView({ block: 'center' });
              const b = el.getBoundingClientRect();
              return { x: b.x, y: b.y, w: b.width, h: b.height };
            }, X.id);
            const shot = await page.screenshot({ clip: { x: fresh.x - pad, y: fresh.y - pad, width: fresh.w + 2 * pad, height: fresh.h + 2 * pad } });
            const sc = (await decode(shot)).w / (fresh.w + 2 * pad);
            const card = parseRgb(X.cardBg);
            const r = fresh.w / 2 - 1.4; // inside the outer edge of the 3 px ring
            const bad = [];
            // up-right of the badge is over the card; down-left is over the tile and the band; both rings must be the card's own color.
            for (const deg of [300, 330, 20, 110, 135, 160]) {
              const px = pad + fresh.w / 2 + Math.cos((deg * Math.PI) / 180) * r;
              const py = pad + fresh.h / 2 + Math.sin((deg * Math.PI) / 180) * r;
              const c = await pixel(px * sc, py * sc);
              if (!near(c, card, 14)) bad.push(`${label} ${deg}deg ${c} vs card ${card}`);
            }
            assert(bad.length === 0, bad.join('; '));
          }
        });
        if (pct === 100 || pct === 125 || width === 390) {
          await check(`item 2 (${tag}): Court and Directions side by side (390 and 360 always, 320 at normal text), never cut off`, async () => {
            assert(T.btns.length === 2, `buttons ${JSON.stringify(T.btns.map((b) => b.text))}`);
            assert(/^Court 13$/.test(T.btns[0].text) && /Directions/.test(T.btns[1].text), `texts ${T.btns.map((b) => b.text)}`);
            const side = Math.abs(T.btns[0].r.y - T.btns[1].r.y) <= 1.5;
            const mustSide = (width >= 360 && pct <= 125) || (width === 320 && pct === 100);
            if (mustSide) assert(side, `stacked: ${JSON.stringify(T.btns.map((b) => b.r))}`);
            for (const b of T.btns) assert(b.r.r <= T.body.r + 0.5 && b.r.x >= T.body.x - 0.5, `button outside the card body: ${JSON.stringify(b.r)} body ${T.body.x}..${T.body.r}`);
            assert(!m.scrollW || m.scrollW <= m.vw + 1, `the page scrolls sideways: ${m.scrollW} > ${m.vw}`);
          });
        }
        await check(`item 3 (${tag}): the length line "${T.len && T.len.text}" is small, regular weight, gray, quieter than the time`, async () => {
          assert(T.len && T.time, 'no length line or time');
          assert(T.len.text === '2 hours', `Tonight's length ${T.len.text}`);
          // Zip 29 fixed the big-text layout where the tile column was 0 px wide (time and length had no size): both must have a real size at every text size.
          assert(T.time.size > 0 && T.len.size > 0, `time ${T.time.size} px, length line ${T.len.size} px: they have no size`);
          assert(Number(T.len.weight) <= 500 && Number(T.time.weight) >= 650, `weights ${T.len.weight} vs ${T.time.weight}`);
          assert(T.len.size < T.time.size, `sizes ${T.len.size} vs ${T.time.size}`);
          const a = parseRgb(T.len.color);
          const b = parseRgb(T.time.color);
          assert(lum(a) !== lum(b) && (ink ? lum(a) > lum(b) : lum(a) < lum(b)), `colors ${T.len.color} vs ${T.time.color}`);
        });
        await check(`item 2 (${tag}): nothing cut off or overlapping on the Tonight and weekday cards`, async () => {
          const bad = [];
          for (const id of [T.id, P && P.id]) {
            const found = await page.evaluate(findClipping, { root: `#${id}` });
            bad.push(...found.map((f) => `${id.slice(0, 8)}: ${f}`));
          }
          assert(bad.length === 0, bad.slice(0, 4).join(' | '));
        });
        if (scheme === 'light' && width === 390 && pct === 100) await page.locator(`#row-${world.tonightId}`).screenshot({ path: path.join(SHOTS, `zip29-tonight-light.png`) });
        if (scheme === 'dark' && width === 390 && pct === 100) await page.locator(`#row-${world.tonightId}`).screenshot({ path: path.join(SHOTS, `zip29-tonight-dark.png`) });
        await ctx.close();
      }

  // The length line for every card, from the server's own times (not a fixed 2).
  await check('item 3: every player card shows its own length (1.5 hours on the 1.5 hour game, 2 hours on the others)', async () => {
    const { ctx, page } = await phone(browser, { width: 390 });
    await page.goto(`${BASE}/?as=Alex`);
    await page.locator('.schedule article').first().waitFor();
    await page.waitForLoadState('networkidle');
    const seen = await page.evaluate(() => [...document.querySelectorAll('.schedule > .sched')].map((c) => ({ id: c.id.replace('row-', ''), len: c.querySelector('.z9-length')?.textContent ?? null })));
    await ctx.close();
    let withLen = 0;
    let oneAndHalf = 0;
    for (const c of seen) {
      const s = world.sessions.find((x) => x.id === c.id);
      if (!s) continue;
      assert(c.len === lengthOf(s), `${c.id.slice(0, 8)}: shows ${c.len}, the game is ${lengthOf(s)}`);
      withLen++;
      if (c.len === '1.5 hours') oneAndHalf++;
    }
    assert(withLen >= 8 && oneAndHalf >= 1, `${withLen} cards checked, ${oneAndHalf} of 1.5 hours`);
  });

  // =============================================================================================================================
  // ITEM 3 and 4a, 4b (the organizer's game cards)
  // =============================================================================================================================
  // The player card's Court and Directions buttons: the link, and the outline and word colors (light and dark) the admin button must match.
  const playerBtnLook = {};
  let playerDirections = null;
  for (const scheme of ['light', 'dark']) {
    const { ctx, page } = await phone(browser, { width: 390, scheme });
    await page.goto(`${BASE}/?as=Alex`);
    await page.locator(`#row-${world.tonightId}`).waitFor();
    playerDirections = await page.locator(`#row-${world.tonightId} [data-gd-directions]`).getAttribute('href');
    playerBtnLook[scheme] = await page.locator(`#row-${world.tonightId} .gd-btn`).first().evaluate((b) => {
      const c = getComputedStyle(b);
      return { border: c.borderTopColor, width: c.borderTopWidth, color: c.color };
    });
    await ctx.close();
  }

  for (const scheme of ['light', 'dark'])
    for (const width of [390, 360, 320])
      for (const pct of [100, 125, 150]) {
        const tag = `${engineName}, ${width} px, ${scheme}, text ${pct}%`;
        const { ctx, page } = await phone(browser, { width, scheme, pct, signedIn: true });
        await page.goto(`${BASE}/admin?alerts=all`);
        await page.locator('[data-r2-card]').first().waitFor({ timeout: 20000 });
        await page.waitForLoadState('networkidle');
        await bigText(page, pct);
        const cards = await page.evaluate(() => {
          const R = (e) => {
            const b = e.getBoundingClientRect();
            return { x: b.x, y: b.y, w: b.width, h: b.height, r: b.right, b: b.bottom };
          };
          const rgb = (e, p) => getComputedStyle(e)[p];
          const root = getComputedStyle(document.documentElement);
          return [...document.querySelectorAll('[data-r2-card]')].map((c) => {
            const id = c.id.replace('session-', '');
            const len = c.querySelector('[data-card-length]');
            const time = c.querySelector('[data-card-time]');
            const paid = c.querySelector('[data-paid-cell]');
            const dol = c.querySelector('.r2-dol');
            const txt = c.querySelector('.r2-paid-text');
            const cj = c.querySelector('[data-court-joined]');
            const dir = c.querySelector('[data-court-directions]');
            const cancel = c.querySelector('[data-cancel-by]');
            const foot = c.querySelector('[data-r2-foot]');
            const half = cj && cj.querySelector('[data-court-num]');
            return {
              id,
              btnLook: cj ? { border: getComputedStyle(cj).borderTopColor, width: getComputedStyle(cj).borderTopWidth, h: R(cj).h, dividerColor: getComputedStyle(dir).borderLeftColor, dividerWidth: getComputedStyle(dir).borderLeftWidth, color: getComputedStyle(half).color, arrow: getComputedStyle(dir).color } : null,
              stacked: getComputedStyle(c.querySelector('.scard-tilecol')).flexDirection === 'row',
              cardW: R(c).w - 24,
              len: len ? { text: len.textContent, size: parseFloat(rgb(len, 'fontSize')), weight: rgb(len, 'fontWeight'), color: rgb(len, 'color'), r: R(len) } : null,
              time: time ? { size: parseFloat(rgb(time, 'fontSize')), weight: rgb(time, 'fontWeight'), color: rgb(time, 'color') } : null,
              paid: paid
                ? { state: paid.getAttribute('data-paid-state'), text: txt.textContent, hasCheck: !!dol.querySelector('svg'), dolText: dol.textContent, dolBg: rgb(dol, 'backgroundColor'), dolW: R(dol).w, dolH: R(dol).h, txtColor: rgb(txt, 'color'), txtSize: parseFloat(rgb(txt, 'fontSize')), rem: parseFloat(root.fontSize), ink: rgb(txt, 'color') }
                : null,
              court: cj ? { text: cj.querySelector('[data-court-num]').textContent.trim(), href: dir.getAttribute('href'), target: dir.getAttribute('target'), r: R(cj), cell: R(cj.closest('.r2-cell')) } : null,
              cancelBy: !!cancel,
              foot: foot ? R(foot) : null,
              primary: root.getPropertyValue('--primary').trim(),
              warnEdge: root.getPropertyValue('--warn-edge').trim(),
              warnFg: root.getPropertyValue('--warn-fg').trim(),
            };
          });
        });
        const sessions = world.sessions;
        const withLen = cards.filter((c) => c.len);
        await check(`item 3 (${tag}): every organizer game tile shows its own length under the time, small and gray`, async () => {
          assert(cards.length >= 6, `${cards.length} cards`);
          for (const c of cards) {
            const s = sessions.find((x) => x.id === c.id);
            assert(c.len && c.len.text === lengthOf(s), `${c.id.slice(0, 8)}: ${c.len && c.len.text} vs ${lengthOf(s)}`);
            assert(Number(c.len.weight) <= 500 && c.len.size < c.time.size, `${c.id.slice(0, 8)}: weight ${c.len.weight} size ${c.len.size} vs time ${c.time.size}`);
            assert(c.len.r.r - c.len.r.x <= (c.stacked ? c.cardW : 58), `${c.id.slice(0, 8)}: the line is wider than its column (${(c.len.r.r - c.len.r.x).toFixed(1)} px)`);
          }
        });
        await check(`item 4a (${tag}): Court 13 | arrow on a game with a court number (the arrow is the player's Directions link); the clock cell where there is none`, async () => {
          const tonight = cards.find((c) => c.id === world.tonightId);
          assert(tonight.court && tonight.court.text === 'Court 13', `tonight's button ${JSON.stringify(tonight.court)}`);
          assert(tonight.court.href === playerDirections && tonight.court.target === '_blank', `directions ${tonight.court.href} vs player ${playerDirections}`);
          assert(tonight.court.r.x >= tonight.court.cell.x - 0.5 && tonight.court.r.r <= tonight.court.cell.r + 0.5, `the button runs out of its cell: ${JSON.stringify(tonight.court.r)} cell ${JSON.stringify(tonight.court.cell)}`);
          assert(!tonight.cancelBy, 'a clock next to the court button');
          // Zip 29 (Alex): the soft periwinkle outline of the player card's buttons (same color and 1 px), the deep blue words, the same 32 px height.
          const pl = playerBtnLook[scheme];
          const bl = tonight.btnLook;
          assert(bl.border === pl.border && bl.width === pl.width, `outline ${bl.border} ${bl.width} vs the player's ${pl.border} ${pl.width}`);
          assert(bl.dividerColor === pl.border && bl.dividerWidth === pl.width, `divider ${bl.dividerColor} ${bl.dividerWidth}`);
          assert(bl.color === pl.color && bl.arrow === pl.color, `words ${bl.color}, arrow ${bl.arrow} vs the player's ${pl.color}`);
          assert(Math.abs(bl.h - 32) <= 0.6, `height ${bl.h}`);
          for (const c of cards) {
            const s = sessions.find((x) => x.id === c.id);
            if (s.courtNum !== undefined) assert(c.court && c.court.text === `Court ${s.courtNum}`, `${c.id.slice(0, 8)}: court ${s.courtNum} but button ${c.court && c.court.text}`);
            else assert(!c.court, `${c.id.slice(0, 8)}: a court button on a game with no court number`);
          }
          assert(cards.every((c) => !(c.cancelBy && c.court)), 'a clock and a court button in one cell');
        });
        await check(`item 4a (${tag}): a game with no court number keeps its footer cell exactly as before (empty after the cancel-by time, Book where a court is needed)`, async () => {
          const cell = await page.evaluate(
            ([quiet, needs]) => {
              const one = (id) => {
                const c = document.getElementById(`session-${id}`);
                const end = c && c.querySelector('.r2-endcell');
                return end ? { joined: !!end.querySelector('[data-court-joined]'), clock: !!end.querySelector('[data-cancel-by]'), book: !!end.querySelector('[data-court-need]'), text: end.textContent.trim() } : null;
              };
              return { quiet: one(quiet), needs: one(needs) };
            },
            [world.paidAllId, world.needsCourtId],
          );
          // The 9:30 PM game: its cancel-by time (9:30 AM today) has passed and it has no court number: nothing in the cell, as on main.
          assert(cell.quiet && !cell.quiet.joined && !cell.quiet.clock && !cell.quiet.book && cell.quiet.text === '', `no-court game cell: ${JSON.stringify(cell.quiet)}`);
          // Thu 12's game still needs its court booked: the Book button stays, no court button.
          assert(cell.needs && !cell.needs.joined && cell.needs.book, `court-needed game cell: ${JSON.stringify(cell.needs)}`);
        });
        await check(`item 4b (${tag}): money cell: all paid is a green check with plain text, anyone owing is an amber $ with amber text, same size as before`, async () => {
          const withPaid = cards.filter((c) => c.paid);
          const owed = withPaid.filter((c) => c.paid.state === 'owed');
          const all = withPaid.filter((c) => c.paid.state === 'all');
          assert(owed.length >= 3 && all.length >= 1, `states: ${withPaid.map((c) => c.paid.state + ':' + c.paid.text).join(', ')}`);
          for (const c of all) {
            const p = c.paid;
            assert(p.hasCheck && p.dolText.trim() === '', `${p.text}: no check`);
            const [a, b] = p.text.split(' of ');
            assert(a === b, `all-paid but ${p.text}`);
            assert(lum(parseRgb(p.dolBg)) > 0 && p.dolBg !== 'rgba(0, 0, 0, 0)', `circle ${p.dolBg}`);
          }
          for (const c of owed) {
            const p = c.paid;
            assert(!p.hasCheck && p.dolText.trim() === '$', `${p.text}: the circle says "${p.dolText}"`);
            const [a, b] = p.text.split(' of ').map(Number);
            assert(a < b, `owed but ${p.text}`);
          }
          // Amber vs green are different hues: red above blue and green clearly above blue for amber; green circle: green well above red.
          const dolOwed = parseRgb(owed[0].paid.dolBg);
          const dolAll = parseRgb(all[0].paid.dolBg);
          assert(dolOwed[0] > dolOwed[2] + 60 && dolOwed[1] > dolOwed[2] + 30, `owed circle is not amber: ${owed[0].paid.dolBg}`);
          assert(dolAll[1] > dolAll[0] + 30, `all-paid circle is not green: ${all[0].paid.dolBg}`);
          const txtOwed = parseRgb(owed[0].paid.txtColor);
          assert(contrast(txtOwed, parseRgb('rgb(255,255,255)')) !== 0 && txtOwed[0] > txtOwed[2], `owed text is not amber/brown: ${owed[0].paid.txtColor}`);
          assert(all[0].paid.txtColor !== owed[0].paid.txtColor, 'all-paid text is amber too');
          // Same size as before: circle 1.3125rem (21 px at 100%), text 0.86rem.
          const rem = owed[0].paid.rem;
          for (const c of withPaid) {
            assert(Math.abs(c.paid.dolW - 1.3125 * rem) <= 0.6 && Math.abs(c.paid.dolH - 1.3125 * rem) <= 0.6, `circle ${c.paid.dolW}x${c.paid.dolH} vs ${1.3125 * rem}`);
            assert(Math.abs(c.paid.txtSize - 0.86 * rem) <= 0.4, `text ${c.paid.txtSize} vs ${0.86 * rem}`);
          }
        });
        await check(`money cards (${tag}): one card, "Who hasn't paid": Mark paid next to Request or Text on every row, Remind on every game, the second card is gone, nothing cut off`, async () => {
          const m = await page.evaluate(() => ({
            old: document.querySelectorAll('article[aria-label="Mark paid tonight"], article[aria-label="Who owes you"], [data-mp-card]').length,
            cards: document.querySelectorAll('[data-vr-card]').length,
            remind: document.querySelectorAll('[data-vr-card] [data-vr-remind]').length,
            rows: [...document.querySelectorAll('[data-vr-row]')].map((r) => ({
              who: r.getAttribute('data-vr-row'),
              mark: r.querySelectorAll('button[data-vr-markpaid]').length,
              request: r.querySelectorAll('[data-venmo-request]').length,
              text: r.querySelectorAll('[data-sc-textone]').length,
              none: /no Venmo saved/.test(r.textContent) ? 1 : 0,
              buttons: r.querySelectorAll('button, a').length,
            })),
          }));
          assert(m.old === 0, `the second money card is still there (${m.old})`);
          assert(m.cards >= 3 && m.remind === m.cards, `${m.cards} game cards, ${m.remind} Remind buttons`);
          assert(m.rows.length >= 6, `${m.rows.length} rows`);
          for (const r of m.rows) {
            assert(r.mark === 1, `${r.who}: ${r.mark} Mark paid buttons`);
            assert(r.request + r.text + r.none === 1, `${r.who}: Request ${r.request}, Text ${r.text}, no-Venmo words ${r.none}`);
            assert(r.buttons <= 2, `${r.who}: ${r.buttons} buttons on a row (two at most: Mark paid and Request or Text)`);
          }
          assert(m.rows.some((r) => r.request === 1) && m.rows.some((r) => r.text === 1), 'the world should have both a Request and a Text row');
          const bad = await page.evaluate(findClipping, { root: '[data-vr-cards]' });
          assert(bad.length === 0, bad.slice(0, 4).join(' | '));
        });
        await check(`item 4a/4b (${tag}): nothing cut off or overlapping on the organizer's game cards`, async () => {
          const bad = [];
          for (const id of [world.tonightId, world.allPaidId]) {
            const found = await page.evaluate(findClipping, { root: `#session-${id}` });
            bad.push(...found.map((f) => `${id.slice(0, 8)}: ${f}`));
          }
          assert(bad.length === 0, bad.slice(0, 4).join(' | '));
        });
        if (scheme === 'light' && width === 390 && pct === 100) await page.locator(`#session-${world.tonightId}`).screenshot({ path: path.join(SHOTS, 'zip29-admin-card-light.png') });
        if (scheme === 'dark' && width === 390 && pct === 100) await page.locator(`#session-${world.tonightId}`).screenshot({ path: path.join(SHOTS, 'zip29-admin-card-dark.png') });
        await ctx.close();
      }

  await check('money cards: Mark paid on a row of the merged card marks that player paid (Undo window, then saved) and the row goes', async () => {
    const { ctx, page } = await phone(browser, { width: 390, signedIn: true });
    const dashBefore = await (await ctx.request.get(BASE + '/api/admin/dashboard')).json();
    await page.goto(`${BASE}/admin?alerts=all`);
    await page.locator('[data-vr-card]').first().waitFor({ timeout: 20000 });
    // Sage on the 8:45 PM extra game (Court 3) owes $14 in the world.
    const card = page.locator(`[data-vr-card="${dashBefore.sessions.find((x) => x.courtNum === 3).id}"]`);
    const sage = card.locator('[data-vr-row="Sage"]');
    assert((await sage.count()) === 1, 'Sage is on the 8:45 PM card');
    await sage.locator('button[data-vr-markpaid]').click();
    await page.waitForTimeout(6500);
    const after = await (await ctx.request.get(BASE + '/api/admin/dashboard')).json();
    const s = after.sessions.find((x) => x.courtNum === 3);
    const row = s.roster.find((r) => r.name === 'Sage');
    assert(row.paymentStatus === 'paid', `Sage is ${row.paymentStatus} after Mark paid`);
    assert((await page.locator(`[data-vr-card="${s.id}"] [data-vr-row="Sage"]`).count()) === 0, 'the row is gone');
    await ctx.close();
  });

  await check('item 4a: a game from an earlier day keeps what it showed (no Court | arrow), though it has a court number', async () => {
    const { ctx, page } = await phone(browser, { width: 390, signedIn: true });
    await page.goto(`${BASE}/admin?alerts=all`);
    await page.locator('[data-r2-card]').first().waitFor({ timeout: 20000 });
    // Games from an earlier day live in History: tap the row to open its card in the sheet.
    await page.locator('.tabbar button, .tabbar a', { hasText: /^History$/ }).first().click();
    await page.locator('main button', { hasText: /^Sessions$/ }).first().click();
    let row = page.locator(`li[data-session="${world.pastCourtId}"] .history-row`);
    if ((await row.count()) === 0) await page.locator('main button', { hasText: /^Show older$/ }).first().click().catch(() => {});
    row = page.locator(`li[data-session="${world.pastCourtId}"] .history-row`);
    await row.click();
    await page.locator('dialog[open] [data-r2-card]').waitFor({ timeout: 10000 });
    const cell = await page.evaluate(() => {
      const c = document.querySelector('dialog[open] [data-r2-card]');
      return { exists: !!c, joined: !!(c && c.querySelector('[data-court-joined]')), foot: !!(c && c.querySelector('[data-r2-foot]')) };
    });
    assert(cell.exists && cell.foot && !cell.joined, `earlier game: ${JSON.stringify(cell)}`);
    // And the server really sent a court number for it (so the rule, not a missing number, is what hides the button).
    const sent = (await (await ctx.request.get(BASE + '/api/admin/dashboard')).json()).sessions.find((x) => x.id === world.pastCourtId);
    assert(sent.courtNum === 7, `court number sent: ${sent.courtNum}`);
    await ctx.close();
  });

  // =============================================================================================================================
  // ITEM 4c: the folded TONIGHT tile (WebKit, device scale 3)
  // =============================================================================================================================
  for (const scheme of ['light', 'dark'])
    for (const width of [420, 390, 360, 320])
      for (const pct of [100, 125, 150]) {
        const tag = `${engineName} @3x, ${width} px, ${scheme}, text ${pct}%`;
        const { ctx, page } = await phone(browser, { width, scheme, pct, signedIn: true, scale: 3 });
        await page.goto(`${BASE}/admin?alerts=all`);
        await page.locator('[data-r2-card]').first().waitFor({ timeout: 20000 });
        await page.waitForLoadState('networkidle');
        // Fold every game that starts open (tap the date tile).
        for (let i = 0; i < 4; i++) {
          const t = page.locator('.hv2-open .tile').first();
          if ((await t.count()) === 0) break;
          await t.click();
          await page.waitForTimeout(350);
        }
        await bigText(page, pct);
        const rows = await page.evaluate(() => {
          const R = (e) => {
            const b = e.getBoundingClientRect();
            return { x: b.x, y: b.y, w: b.width, h: b.height, r: b.right, b: b.bottom };
          };
          const glyph = (el) => {
            const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
            const rects = [];
            for (let n = w.nextNode(); n; n = w.nextNode()) {
              if (!n.textContent.trim()) continue;
              const rg = document.createRange();
              rg.selectNodeContents(n);
              for (const q of rg.getClientRects()) rects.push({ x: q.x, y: q.y, r: q.right, b: q.bottom });
            }
            return rects.length ? { x: Math.min(...rects.map((q) => q.x)), y: Math.min(...rects.map((q) => q.y)), r: Math.max(...rects.map((q) => q.r)), b: Math.max(...rects.map((q) => q.b)) } : null;
          };
          return [...document.querySelectorAll('.hv2-short .tile')].filter((t) => t.querySelector('.day-tag')).map((t) => {
            const tag = t.querySelector('.day-tag:not([hidden])');
            const visibleWord = [...t.querySelectorAll('.day-tag .dt-full, .day-tag .dt-short')].find((e) => getComputedStyle(e).display !== 'none') || tag;
            const cs = getComputedStyle(t);
            const ct = getComputedStyle(tag);
            const clippers = [];
            for (let a = visibleWord.parentElement; a && a !== t.parentElement; a = a.parentElement) {
              const s = getComputedStyle(a);
              if (a !== t && /hidden|clip/.test(s.overflowX + s.overflowY)) clippers.push(a.className);
            }
            return {
              cls: t.className,
              word: visibleWord.textContent,
              tile: R(t),
              bw: parseFloat(cs.borderTopWidth),
              tileOverflow: cs.overflowX + '/' + cs.overflowY,
              band: R(tag),
              day: R(t.querySelector('.day')),
              glyph: glyph(visibleWord),
              font: parseFloat(getComputedStyle(visibleWord).fontSize),
              bg: ct.backgroundColor,
              fg: ct.color,
              clippers,
            };
          });
        });
        await check(`item 4c (${tag}): the word on every folded TONIGHT and TOM tile is fully inside its band and tile (glyph box, device pixels)`, async () => {
          assert(rows.some((r) => /day-tonight/.test(r.cls)), 'no folded TONIGHT tile on this screen');
          for (const r of rows) {
            const g = r.glyph;
            assert(g, `${r.word}: no glyph box`);
            const clearTop = g.y - r.band.y;
            const clearBot = r.band.b - g.b;
            const clearL = g.x - (r.tile.x + r.bw);
            const clearR = r.tile.r - r.bw - g.r;
            assert(clearTop >= 3 && clearBot >= 3, `${r.word}: ${clearTop.toFixed(2)} px above, ${clearBot.toFixed(2)} px below (band ${r.band.h.toFixed(1)} px tall, word ${r.font.toFixed(1)} px)`);
            assert(clearL >= 2 && clearR >= 2, `${r.word}: ${clearL.toFixed(2)} px left, ${clearR.toFixed(2)} px right inside the tile (tile ${r.tile.w.toFixed(1)} px wide)`);
            assert(r.band.y >= r.tile.y - 0.5 && r.band.b <= r.tile.b + 0.5, `${r.word}: the band leaves the tile`);
            assert(r.band.b <= r.day.y + 0.5, `${r.word}: the band (bottom ${r.band.b.toFixed(1)}) overlaps the date number (top ${r.day.y.toFixed(1)})`);
            assert(r.clippers.length === 0, `${r.word}: clipped by ${r.clippers.join(' | ')}`);
          }
        });
        await check(`item 4c (${tag}): the band has its own height (at least 16 px) and the word is not tiny (at least 7.5 px), TONIGHT is the new look`, async () => {
          for (const r of rows) {
            assert(r.band.h >= 15.9, `${r.word}: band ${r.band.h.toFixed(2)} px tall`);
            assert(r.font >= 7.4, `${r.word}: ${r.font.toFixed(2)} px type`);
            assert(r.tile.w >= 47.5 && r.tile.w <= 48.5, `${r.word}: the folded tile is ${r.tile.w.toFixed(1)} px wide (it is 48 px)`);
          }
          const t = rows.find((r) => /day-tonight/.test(r.cls));
          const bg = parseRgb(t.bg);
          const fg = parseRgb(t.fg);
          if (scheme === 'light') assert(lum(bg) < 0.14 && lum(fg) > 0.9, `light band ${t.bg} letters ${t.fg}`);
          else assert(lum(bg) > 0.3 && lum(fg) < 0.1, `dark band ${t.bg} letters ${t.fg}`);
          assert(contrast(bg, fg) >= 4.5, `contrast ${contrast(bg, fg).toFixed(2)}`);
        });
        if (width === 390 && pct === 100) await page.locator('.hv2-short').first().screenshot({ path: path.join(SHOTS, `zip29-folded-${scheme}.png`) });
        await ctx.close();
      }

  for (const k of knownOnMain) console.log(`  (known on main) ${k}`);
  console.log(`\n${passed} passed, ${failed} failed (engine ${engineName})`);
  await browser.close();
  if (chromiumBrowser !== browser) await chromiumBrowser.close();
  try {
    process.kill(-server.pid, 'SIGTERM');
  } catch {}
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
