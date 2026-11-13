/* Zip 16: After-game cards (AFTER_GAME_CARD) switched ON, and the dark-mode in-between look of every player alert card (Alert cards).
 *
 *   node e2e/zip16.cjs      (also run by npm run test:e2e)
 *
 * Fake preview world seeded Sun Nov 8, 3:00 PM Eastern with the Zip 16 parts (SEED_ZIP16=1): Parker got $5 back from one game (6 played),
 * Rowan $8 from two ($5 + $3), Quinn paid $11, the game was reopened and redone with 4 played ($14): Quinn owes $3 more. Its own dev server
 * with PREVIEW_CALM=on (as on a preview); nothing touches Cloudflare or the live site.
 * Checks: the credit-back card at 390, 360 and 320 wide, light and dark (the mock's words, one card, inside the screen, the X), the card
 * amount equals the credit chip, the combined card, the owes-more card with Pay, the X (stays closed after a reload, no money change), the
 * 7-day end, another player and a phone with no name see nothing, ?as=Parker on a preview, the private link with the row off, the Settings
 * row, and the dark look on every player alert card type (1.5 px border, the tint fill, the badge, 4.5:1 words) with light unchanged.
 */
const { spawn, spawnSync } = require('node:child_process');
const { readFileSync, mkdirSync, rmSync } = require('node:fs');
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.E2E_PORT) || 5419;
const BASE = `http://localhost:${PORT}`;
const NOW_ISO = '2026-11-08T20:00:00.000Z'; // Sun Nov 8, 3:00 PM Eastern (the seed)
const NOW_MS = Date.parse(NOW_ISO);
const DAY = 86_400_000;
const SHOTS = process.env.E2E_SHOTS || path.join(__dirname, 'screenshots');
const PIN = /PIN `(\d{6})`/.exec(readFileSync(path.join(ROOT, 'docs/PREVIEW_FAKE_DB.md'), 'utf8'))[1];
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

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
  const dbFile = path.join(ROOT, '.data', 'zip16.sqlite');
  mkdirSync(path.join(ROOT, '.data'), { recursive: true });
  rmSync(dbFile, { force: true });
  const seeded = spawnSync('npx', ['vite-node', 'scripts/load-seed-local.ts', '--', dbFile, NOW_ISO], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, SEED_ZIP16: '1' } });
  if (seeded.status !== 0) throw new Error(`could not build the fake world: ${seeded.stderr || seeded.stdout}`);
  const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
    cwd: ROOT,
    env: { ...process.env, DEV_DB: dbFile, SETUP_TOKEN: 'zip16-setup-token-0123456789', DEV_CLOCK: '1', PREVIEW_CALM: 'on' },
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
  const dash = async () => (await real.get(`${BASE}/api/admin/dashboard`)).json();
  const d0 = await dash();
  assert(d0.afterGameCardForAll === true, 'the Zip 16 seed should have the After-game cards row on');
  const idOf = (name) => d0.players.find((p) => p.name === name).id;

  // The dark look is checked on a 2x screen, like a phone (a 1 px screen rounds a 1.5 px border down to 1 px).
  const phone = (width, scheme, dpr = 1) => ({ viewport: { width, height: 860 }, deviceScaleFactor: dpr, isMobile: true, hasTouch: true, colorScheme: scheme, userAgent: IPHONE, reducedMotion: 'reduce' });
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
    const ctx = opts.ctx || (await browser.newContext(phone(width, scheme, opts.dpr || 1)));
    if (!opts.ctx) {
      await shift(ctx, opts.at || NOW_MS);
      if (opts.storage) await ctx.addInitScript((kv) => Object.entries(kv).forEach(([k, v]) => localStorage.setItem(k, v)), opts.storage);
      await ctx.route('https://venmo.com/**', (r) => r.abort());
      if (name) await post(ctx.request, '/api/me', { playerId: idOf(name) });
    }
    const page = await ctx.newPage();
    await page.goto(BASE + (opts.url || '/'));
    if (name) await page.locator('.schedule article').first().waitFor();
    await page.waitForTimeout(900);
    return { ctx, page };
  }
  const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, `zip16-${name}.png`), fullPage: false });
  const noSideways = async (page, what) => {
    const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
    assert(o.sw <= o.cw + 1, `${what}: sideways ${o.sw} > ${o.cw}`);
  };
  const cardInfo = (page) =>
    page.evaluate(() => {
      const cards = [...document.querySelectorAll('main [data-alert-card]')];
      return cards.map((c) => {
        const r = c.getBoundingClientRect();
        const x = c.querySelector('.ac-x');
        const xr = x && x.getBoundingClientRect();
        const xa = x && getComputedStyle(x, '::after');
        return {
          title: (c.querySelector('.ac-title') || {}).textContent,
          sub: (c.querySelector('.ac-sub') || {}).textContent,
          tone: c.getAttribute('data-alert-card'),
          after: c.hasAttribute('data-after-game'),
          cents: c.getAttribute('data-after-game-cents'),
          left: r.left,
          right: r.right,
          titleLines: (() => {
            const t = c.querySelector('.ac-title');
            return t ? Math.round(t.offsetHeight / parseFloat(getComputedStyle(t).lineHeight)) : 0;
          })(),
          x: xr ? { w: xr.width + 2 * Math.abs(parseFloat(xa.left) || 0), h: xr.height + 2 * Math.abs(parseFloat(xa.top) || 0) } : null,
          pay: !!c.querySelector('[data-pay]'),
          links: [...c.querySelectorAll('.ac-link')].map((l) => l.textContent),
        };
      });
    });
  const chip = async (page) => ((await page.locator('.credit-chip, [data-credit-chip]').first().textContent().catch(() => '')) || '').replace(/\s+/g, ' ');

  // ------------------------------------------------------------------------------------------------ the credit-back card, every size
  for (const scheme of ['light', 'dark']) {
    for (const width of [390, 360, 320]) {
      await check(`Parker ${width} px ${scheme}: ONE blue card "$5 back to your credit" / final price $9 (6 played), X 44 px, inside the screen; the chip says $5`, async () => {
        const { ctx, page } = await openPlayer('Parker', width, scheme);
        const cards = await cardInfo(page);
        assert(cards.length === 1, `calm preview: exactly one card, got ${JSON.stringify(cards.map((c) => c.title))}`);
        const c = cards[0];
        assert(c.after && c.tone === 'blue', 'the blue after-game card');
        assert(c.title === '$5 back to your credit', `title ${c.title}`);
        assert(c.sub === 'Thu, Nov 5: final price $9 (6 played)', `sub ${c.sub}`);
        assert(c.cents === '500', `card amount ${c.cents}`);
        assert(c.x && c.x.w >= 44 && c.x.h >= 44, `X tap area ${JSON.stringify(c.x)}`);
        assert(c.left >= 0 && c.right <= width, `inside the screen ${c.left}..${c.right}`);
        assert(width < 360 || c.titleLines === 1, `one-line title at ${width}: ${c.titleLines}`);
        assert(/\$5/.test(await chip(page)), `credit chip ${await chip(page)}`);
        await noSideways(page, `${width} ${scheme}`);
        await shot(page, `parker-${width}-${scheme}`);
        await ctx.close();
      });
    }
  }

  await check('Rowan: ONE combined card "$8 back to your credit" / "2 games: Thu, Nov 5 and Fri, Nov 6"; the chip says $8 (the card equals the credit change)', async () => {
    for (const scheme of ['light', 'dark']) {
      const { ctx, page } = await openPlayer('Rowan', 390, scheme);
      const cards = await cardInfo(page);
      assert(cards.length === 1, `one card, got ${cards.length}`);
      assert(cards[0].title === '$8 back to your credit' && cards[0].sub === '2 games: Thu, Nov 5 and Fri, Nov 6', `${cards[0].title} / ${cards[0].sub}`);
      assert(cards[0].cents === '800', `amount ${cards[0].cents}`);
      // Rowan had no credit before these two games: the chip is exactly the credit change.
      const g = await (await ctx.request.get(BASE + '/api/group')).json();
      assert(g.credit.balanceCents === 800, `balance ${g.credit.balanceCents}`);
      assert(/\$8/.test(await chip(page)), `chip ${await chip(page)}`);
      await shot(page, `rowan-390-${scheme}`);
      await ctx.close();
    }
  });

  for (const scheme of ['light', 'dark']) {
    for (const width of [390, 360, 320]) {
      await check(`Quinn ${width} px ${scheme}: the amber owe card says "You owe $3 more" / final price $14 (4 played), with Pay and I paid; no credit-back card`, async () => {
        const { ctx, page } = await openPlayer('Quinn', width, scheme);
        const cards = await cardInfo(page);
        assert(cards.length === 1, `one card, got ${JSON.stringify(cards.map((c) => c.title))}`);
        const c = cards[0];
        assert(c.tone === 'amber' && !c.after, 'the amber owe card');
        assert(c.title === 'You owe $3 more', `title ${c.title}`);
        assert(c.sub === 'Fri, Nov 6: final price $14 (4 played)', `sub ${c.sub}`);
        assert(c.pay && c.links.includes('I paid'), `Pay ${c.pay}, links ${c.links}`);
        assert(c.left >= 0 && c.right <= width, 'inside the screen');
        await noSideways(page, `${width} ${scheme}`);
        await shot(page, `quinn-${width}-${scheme}`);
        await ctx.close();
      });
    }
  }

  await check('the X closes it: gone at once and after a reload, the credit and chip unchanged, nothing sent to the server', async () => {
    const { ctx, page } = await openPlayer('Parker', 390, 'light');
    const before = (await (await ctx.request.get(BASE + '/api/group')).json()).credit.balanceCents;
    const writes = [];
    page.on('request', (r) => {
      if (r.method() !== 'GET') writes.push(r.url());
    });
    await page.locator('[data-after-game] .ac-x').click();
    await page.waitForTimeout(300);
    assert((await page.locator('[data-after-game]').count()) === 0, 'card gone');
    assert(writes.length === 0, `requests sent: ${writes}`);
    await page.reload();
    await page.locator('.schedule article').first().waitFor();
    await page.waitForTimeout(800);
    assert((await page.locator('[data-after-game]').count()) === 0, 'still closed after a reload');
    const after = (await (await ctx.request.get(BASE + '/api/group')).json()).credit.balanceCents;
    assert(before === 500 && after === 500, `credit ${before} -> ${after}`);
    assert(/\$5/.test(await chip(page)), 'chip still $5');
    await ctx.close();
  });

  await check('7 days after the credit: no card (the credit stays)', async () => {
    await clock(NOW_MS + 7 * DAY + 3600_000);
    const { ctx, page } = await openPlayer('Parker', 390, 'light', { at: NOW_MS + 7 * DAY + 3600_000 });
    assert((await page.locator('[data-after-game]').count()) === 0, 'no card after 7 days');
    assert((await (await ctx.request.get(BASE + '/api/group')).json()).credit.balanceCents === 500, 'credit stays');
    await ctx.close();
    await clock(NOW_MS);
  });

  await check('another player never sees it (Indy, with ?alerts=all, got no credit back: no card, an empty list); a phone with no name sees the name list, no card', async () => {
    const { ctx, page } = await openPlayer('Indy', 390, 'light', { storage: { pb_alerts: 'all' }, url: '/?alerts=all' });
    assert((await page.locator('[data-after-game]').count()) === 0, 'Indy sees no after-game card');
    const g = await (await ctx.request.get(BASE + '/api/group', { headers: { 'X-Preview-Alerts': 'all' } })).json();
    assert(Array.isArray(g.afterGame) && g.afterGame.length === 0, `Indy's list: ${JSON.stringify(g.afterGame)}`);
    // Parker's own records are his alone.
    const pk = await browser.newContext();
    await post(pk.request, '/api/me', { playerId: idOf('Parker') });
    const mine = (await (await pk.request.get(BASE + '/api/group')).json()).afterGame.map((c) => c.id);
    await pk.close();
    assert(mine.length === 1 && !JSON.stringify(g).includes(mine[0]), 'Parker record not in Indy answer');
    await ctx.close();
    const anon = await browser.newContext(phone(390, 'light'));
    await shift(anon, NOW_MS);
    const p2 = await anon.newPage();
    await p2.goto(BASE + '/');
    await p2.getByText('Who are you?').first().waitFor();
    assert((await p2.locator('[data-after-game]').count()) === 0, 'no card before a name is picked');
    const ga = await (await anon.request.get(BASE + '/api/group')).json();
    assert(Array.isArray(ga.afterGame) && ga.afterGame.length === 0, `no records for a phone with no name: ${JSON.stringify(ga.afterGame)}`);
    await anon.close();
  });

  await check('preview link ?as=Parker opens the page as Parker (no name list), with the card', async () => {
    const ctx = await browser.newContext(phone(390, 'light'));
    await shift(ctx, NOW_MS);
    const page = await ctx.newPage();
    await page.goto(BASE + '/?as=Parker');
    await page.locator('[data-after-game]').waitFor({ timeout: 8000 });
    assert((await page.locator('.topbar, header').first().textContent()).includes('Parker'), 'the page is Parker');
    assert(!/as=/.test(page.url()), `the link word is taken out of the address: ${page.url()}`);
    await ctx.close();
  });

  await check('the Settings row: on for everyone; off hides the card (the private ?aftergame=on still shows it on one phone)', async () => {
    const ctx = await browser.newContext(phone(390, 'light'));
    await shift(ctx, NOW_MS);
    await post(ctx.request, '/api/admin/login', { pin: PIN });
    const page = await ctx.newPage();
    await page.goto(BASE + '/admin');
    await page.locator('.tabbar').waitFor();
    await page.locator('.tabbar button', { hasText: 'Settings' }).evaluate((x) => x.click());
    await page.waitForTimeout(500);
    for (const s of await page.locator('details > summary').all()) await s.click().catch(() => {});
    const row = page.locator('[data-row="afterGameCardAll"]');
    assert((await row.count()) === 1, 'the row is there');
    assert((await row.locator('.set-name').textContent()).includes('After-game cards'), 'its name');
    // Newest first: Zip 23's Totals refresh, Zip 21's Error alerts, then Zip 17's Unpaid nudge sit above it now.
    const firstTwo = await page.locator('#switches [data-row], [data-switches-tidy] [data-row]').evaluateAll((els) => els.map((e) => e.getAttribute('data-row')).filter((k) => k !== 'christmasSkinAll' && k !== 'cheaperFixAll' && k !== 'homeScreenTipAll' && k !== 'gameDayTextAll').slice(0, 10));
    // (Zip 30's Acting for others is newer still and sits on top.)
    // (Zip 32's Players sheet redo is newer still, and Zip 34's Check-in pay line newer again; Zip 31's Extended time sits on top of all.)
    assert(firstTwo.join('|') === 'tapGuardFixAll|extendedTimeAll|checkInPayAll|playersSheetRedoAll|actingOthersAll|spentTotalsAll|bookingHoursAll|totalsRefreshAll|errorAlertsAll|unpaidNudgeAll', `newest first: ${firstTwo}`);
    assert(await row.locator('input').isChecked(), 'on in the seed');
    await row.locator('input').click();
    await page.waitForTimeout(1200);
    assert((await dash()).afterGameCardForAll !== true, 'switched off');
    const off = await openPlayer('Parker', 390, 'light');
    assert((await off.page.locator('[data-after-game]').count()) === 0, 'off: no card');
    await off.ctx.close();
    const priv = await openPlayer('Parker', 390, 'light', { url: '/?aftergame=on' });
    assert((await priv.page.locator('[data-after-game]').count()) === 1, '?aftergame=on: the card on that phone');
    await priv.ctx.close();
    await row.locator('input').click();
    await page.waitForTimeout(1200);
    assert((await dash()).afterGameCardForAll === true, 'back on');
    await ctx.close();
  });

  // ------------------------------------------------------------------------------------------------ the dark look, every alert card type
  // Who shows which card in the fake world (with ?alerts=all): Casey credit adjusted + Want in; Jordan "You owe $N total"; Gray owes one game;
  // Blake "You no longer owe"; Indy the moved game; Harper Want in; Parker after-game; Quinn owes more.
  const PEOPLE = ['Casey', 'Jordan', 'Gray', 'Blake', 'Indy', 'Harper', 'Parker', 'Quinn'];
  const look = (page) =>
    page.evaluate(() => {
      // Colors as numbers: rgb(), rgba() or color(srgb ...) (color-mix gives the last).
      const parse = (s) => {
        let m = /rgba?\(([^)]+)\)/.exec(s);
        if (m) {
          const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
          return { r: p[0], g: p[1], b: p[2], a: p[3] === undefined ? 1 : p[3] };
        }
        m = /color\(srgb ([^)]+)\)/.exec(s);
        if (m) {
          const p = m[1].split(/[ /]+/).filter(Boolean).map(Number);
          return { r: p[0] * 255, g: p[1] * 255, b: p[2] * 255, a: p[3] === undefined ? 1 : p[3] };
        }
        return null;
      };
      const lum = (c) => {
        const f = (v) => {
          v /= 255;
          return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
        };
        return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
      };
      const ratio = (a, b) => {
        const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
        return (x + 0.05) / (y + 0.05);
      };
      const page = parse(getComputedStyle(document.body).backgroundColor);
      // Chrome rounds a 1.5 px border down to whole pixels when it reports (and draws) it; Safari keeps 1.5 px. So the rule that applies is read.
      const rules = [];
      const walk = (list, media) => {
        for (const r of list) {
          if (r.media && r.cssRules) {
            if (window.matchMedia(r.media.mediaText).matches) walk(r.cssRules, true);
          } else if (r.selectorText && r.style && r.style.borderWidth) rules.push(r);
        }
      };
      for (const sh of document.styleSheets) {
        try {
          walk(sh.cssRules, false);
        } catch {}
      }
      const declaredWidth = (el) => {
        let w = null;
        for (const r of rules) if (el.matches(r.selectorText)) w = r.style.borderWidth;
        return w;
      };
      return [...document.querySelectorAll('[data-alert-card]')].map((c) => {
        const s = getComputedStyle(c);
        const bg = parse(s.backgroundColor);
        const icon = c.querySelector('.ac-icon');
        const t = c.querySelector('.ac-title');
        const sub = c.querySelector('.ac-sub');
        return {
          tone: c.getAttribute('data-alert-card'),
          title: t && t.textContent.slice(0, 40),
          bw: declaredWidth(c) || s.borderTopWidth,
          bg: s.backgroundColor,
          border: s.borderTopColor,
          icon: icon && getComputedStyle(icon).backgroundColor,
          pageVsCard: page && bg ? Math.abs(lum(page) - lum(bg)) : 0,
          titleRatio: t && bg ? ratio(parse(getComputedStyle(t).color), bg) : 99,
          subRatio: sub && bg ? ratio(parse(getComputedStyle(sub).color), bg) : 99,
        };
      });
    });
  const types = new Set();
  for (const width of [390, 360, 320]) {
    await check(`dark look ${width} px: every player alert card has the 1.5 px border, a tinted fill (not the plain card color), a tinted badge, words 4.5:1 or better`, async () => {
      for (const who of PEOPLE) {
        const { ctx, page } = await openPlayer(who, width, 'dark', { storage: { pb_alerts: 'all' }, url: '/?alerts=all', dpr: 2 });
        const cards = await look(page);
        for (const c of cards) {
          types.add(`${c.tone}:${(c.title || '').replace(/\$\d+/g, '$N').replace(/(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\w*/g, 'DAY').slice(0, 24)}`);
          assert(c.bw === '1.5px', `${who} "${c.title}": border ${c.bw}`);
          assert(c.bg !== 'rgb(24, 34, 28)', `${who} "${c.title}": plain card color ${c.bg}`);
          assert(/color\(srgb|rgba?\(/.test(c.icon || 'rgb('), `${who} badge ${c.icon}`);
          assert(c.titleRatio >= 4.5 && c.subRatio >= 4.5, `${who} "${c.title}": contrast ${c.titleRatio.toFixed(2)} / ${c.subRatio.toFixed(2)}`);
        }
        if (width === 390) await shot(page, `dark-${who}`);
        await ctx.close();
      }
    });
  }
  await check('dark look covers each card type (owe one and several, owe more, no longer owe, credit adjusted, Want in, moved game, credit back)', async () => {
    const list = [...types].join(' | ');
    for (const re of [/amber:You owe \$N total/, /amber:You owe \$N for/, /amber:You owe \$N more/, /blue:You no longer owe/, /blue:Credit adjusted/, /green:DAY/, /blue:DAY.*moved|blue:.*moved|blue:DAY/, /blue:\$N back to your credit/])
      assert(re.test(list), `missing ${re} in ${list}`);
  });
  await check('dark look on the banner ("Alex sent your $10", errors) and the cash-out question: the same rules', async () => {
    const { ctx, page } = await openPlayer('Casey', 390, 'dark', { dpr: 2 });
    const r = await page.evaluate(() => {
      const mk = (cls) => {
        const d = document.createElement('div');
        d.className = cls;
        d.innerHTML = '<span class="toast-icon"></span><span class="toast-msg">Alex sent your $10</span>';
        document.body.appendChild(d);
        const s = getComputedStyle(d);
        const out = { bw: [...document.styleSheets].flatMap((sh) => { try { return [...sh.cssRules]; } catch { return []; } }).flatMap((r) => (r.cssRules && r.media && matchMedia(r.media.mediaText).matches ? [...r.cssRules] : [r])).filter((r) => r.selectorText && r.style && r.style.borderWidth && d.matches(r.selectorText)).map((r) => r.style.borderWidth).pop(), bg: s.backgroundColor, icon: getComputedStyle(d.querySelector('.toast-icon')).backgroundColor };
        d.remove();
        return out;
      };
      const q = document.createElement('div');
      q.className = 'cashout-prompt ac ac-blue';
      document.body.appendChild(q);
      const qs = getComputedStyle(q);
      const cash = { bw: [...document.styleSheets].flatMap((sh) => { try { return [...sh.cssRules]; } catch { return []; } }).flatMap((r) => (r.cssRules && r.media && matchMedia(r.media.mediaText).matches ? [...r.cssRules] : [r])).filter((r) => r.selectorText && r.style && r.style.borderWidth && q.matches(r.selectorText)).map((r) => r.style.borderWidth).pop(), bg: qs.backgroundColor };
      q.remove();
      return { ok: mk('pop toast'), err: mk('pop toast pop-error'), cash };
    });
    for (const [k, v] of Object.entries(r)) assert(v.bw === '1.5px' && v.bg !== 'rgb(24, 34, 28)', `${k}: ${JSON.stringify(v)}`);
    await ctx.close();
  });
  await check('light mode unchanged: every card 1 px border, the plain white card, the old badge tint', async () => {
    for (const who of ['Casey', 'Jordan', 'Blake', 'Parker', 'Quinn']) {
      const { ctx, page } = await openPlayer(who, 390, 'light', { storage: { pb_alerts: 'all' }, url: '/?alerts=all', dpr: 2 });
      for (const c of await look(page)) {
        assert(c.bw === '1px' && c.bg === 'rgb(255, 255, 255)' && c.border === 'rgb(218, 217, 207)', `${who} "${c.title}": ${c.bw} ${c.bg} ${c.border}`);
        assert(!/color\(srgb/.test(c.icon), `${who} badge ${c.icon}`);
      }
      await ctx.close();
    }
  });
  // Alex, Nov 8 (after the preview): the organizer cards get the same dark look; light unchanged.
  const adminLook = async (width, scheme) => {
    const ctx = await browser.newContext(phone(width, scheme, 2));
    await shift(ctx, NOW_MS);
    await post(ctx.request, '/api/admin/login', { pin: PIN });
    await ctx.addInitScript(() => localStorage.setItem('pb_alerts', 'all'));
    const page = await ctx.newPage();
    await page.goto(BASE + '/admin?alerts=all');
    await page.locator('.tabbar').waitFor();
    await page.waitForTimeout(900);
    const cards = await look(page);
    await noSideways(page, `admin ${width} ${scheme}`);
    if (width === 390) await shot(page, `admin-${scheme}`);
    await ctx.close();
    return cards;
  };
  for (const width of [390, 360, 320]) {
    await check(`organizer Home dark ${width} px: every alert card has the 1.5 px border, a tinted fill, words 4.5:1 or better`, async () => {
      const cards = await adminLook(width, 'dark');
      assert(cards.length >= 3, `admin cards: ${cards.length}`);
      const tones = new Set(cards.map((c) => c.tone));
      for (const c of cards) {
        assert(c.bw === '1.5px', `admin "${c.title}": border ${c.bw}`);
        assert(c.bg !== 'rgb(24, 34, 28)', `admin "${c.title}": plain card color ${c.bg}`);
        assert(c.titleRatio >= 4.5 && c.subRatio >= 4.5, `admin "${c.title}": contrast ${c.titleRatio.toFixed(2)} / ${c.subRatio.toFixed(2)}`);
      }
      assert(tones.size >= 2, `several tones: ${[...tones]}`);
    });
  }
  await check('organizer Home light: unchanged (1 px border, plain white card)', async () => {
    for (const c of await adminLook(390, 'light')) assert(c.bw === '1px' && c.bg === 'rgb(255, 255, 255)', `admin "${c.title}": ${c.bw} ${c.bg}`);
  });

  await browser.close();
  console.log(`\nzip16: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
