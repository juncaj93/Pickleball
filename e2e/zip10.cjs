/* Zip 10: "Card cleanup" (CARD_CLEANUP): cards without count text (balls on one row, people icon + names), vertical centering to the date
 * tile, tinted Later cards, organizer cards and rows; no waitlist and no player cap.
 *
 *   node e2e/zip10.cjs      (also run by npm run test:e2e)
 *
 * Loads the fake preview world as if it were Fri Nov 6, 2026, 10:00 AM Eastern into a local file (Card cleanup is on from the seed, and the
 * seed has games with 1, 3, 4, 5, 8, 11 and 12 in), starts its own dev server on it with the server clock pinned, and drives a phone-sized
 * browser: light and dark, 390, 360 and 320 px. Then the Settings row off (the old cards come back) and the private link ?cardcleanup=on.
 * Nothing here touches Cloudflare or the live site. Screenshots: e2e/screenshots/zip10-*.png (ignored by git).
 */
const { spawn, spawnSync } = require('node:child_process');
const { readFileSync, mkdirSync, rmSync } = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.E2E_PORT) || 5295;
const BASE = `http://localhost:${PORT}`;
const NOW_ISO = '2026-11-06T15:00:00.000Z';
const NOW_MS = Date.parse(NOW_ISO);
const SHOTS = process.env.E2E_SHOTS || path.join(__dirname, 'screenshots');
const PIN = /PIN `(\d{6})`/.exec(readFileSync(path.join(ROOT, 'docs/PREVIEW_FAKE_DB.md'), 'utf8'))[1];
const LIMIT = /DB_LIMIT_MESSAGE = `\$\{NO_CAP_MAX\} (.*?)`;/.exec(readFileSync(path.join(ROOT, 'shared/zip10.ts'), 'utf8'))[1];

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
  const dbFile = path.join(ROOT, '.data', 'zip10.sqlite');
  mkdirSync(path.join(ROOT, '.data'), { recursive: true });
  rmSync(dbFile, { force: true });
  const seeded = spawnSync('npx', ['vite-node', 'scripts/load-seed-local.ts', '--', dbFile, NOW_ISO], { cwd: ROOT, encoding: 'utf8' });
  if (seeded.status !== 0) throw new Error(`could not build the fake world: ${seeded.stderr || seeded.stdout}`);
  const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
    cwd: ROOT,
    env: { ...process.env, DEV_DB: dbFile, SETUP_TOKEN: 'zip10-setup-token-0123456789', DEV_CLOCK: '1' },
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
  const setSwitch = async (on) => {
    const r = await real.put(BASE + '/api/admin/card-cleanup-switch', { data: { on }, headers: { Origin: BASE } });
    if (!r.ok()) throw new Error(`switch: ${r.status()}`);
  };
  const d0 = await dash();
  const nameId = (name) => d0.players.find((p) => p.name === name).id;
  const open = d0.sessions.filter((s) => !s.state.flags.canceled && Date.parse(s.startsAt) > NOW_MS);
  const byCount = (n) => open.find((s) => s.confirmedCount === n);
  const g12 = byCount(12);
  const g11 = byCount(11);
  if (!g12 || !g11 || !byCount(1) || !byCount(8)) throw new Error('the seed has no 1, 8, 11 or 12 player game');
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
    const ctx = await browser.newContext(phone(width, scheme, 900));
    await ctx.addInitScript(shift, NOW_MS - Date.now());
    await post(ctx.request, '/api/admin/login', { pin: PIN });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${BASE}/admin${query}`);
    await page.locator('.tabbar').waitFor();
    await page.waitForTimeout(800);
    return { ctx, page, errors };
  }
  async function openPlayer(name, { width = 390, scheme = 'light', height = 1400, query = '' } = {}) {
    const ctx = await browser.newContext(phone(width, scheme, height));
    await ctx.addInitScript(shift, NOW_MS - Date.now());
    await ctx.addInitScript(() => localStorage.setItem('pb_games_filter', 'all'));
    await post(ctx.request, '/api/me', { playerId: nameId(name) }, { 'X-Group-Key': String(d0.group.privateLink).split('/g/')[1] }).catch(() => {});
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(BASE + String(d0.group.privateLink).replace(/^https?:\/\/[^/]+/, '') + query);
    await page.waitForTimeout(800);
    const picker = page.locator('button', { hasText: new RegExp(`^${name}$`) });
    if (await picker.count()) await picker.first().click().catch(() => {});
    await page.locator('.schedule article').first().waitFor({ timeout: 8000 });
    const more = page.getByRole('button', { name: /More sessions/ });
    if (await more.count()) await more.first().click();
    await page.waitForTimeout(700);
    return { ctx, page, errors };
  }
  const shot = async (page, name, full = true) => (await page.waitForTimeout(350), page.screenshot({ path: path.join(SHOTS, `zip10-${name}.png`), fullPage: full }));
  const card = (page, id) => page.locator(`#row-${id}`);

  /** Every card's geometry and words, read in the page. */
  const still = (page) => page.addStyleTag({ content: '*, *::before, *::after { animation: none !important; transition: none !important; }' });
  const measure = async (page) =>
    (await still(page), page.evaluate(() =>
      [...document.querySelectorAll('.schedule > article.sched')].map((a) => {
        const r = (el) => (el ? el.getBoundingClientRect() : null);
        const tile = r(a.querySelector('.sched-tilecol .tile-wrap'));
        const body = a.querySelector('.sched-body');
        const kids = [...body.children].filter((k) => k.tagName !== 'DIALOG' && getComputedStyle(k).display !== 'none' && k.getBoundingClientRect().height > 0);
        const top = Math.min(...kids.map((k) => k.getBoundingClientRect().top));
        const bottom = Math.max(...kids.map((k) => k.getBoundingClientRect().bottom));
        const dots = a.querySelector('.cl-balls .dots');
        const balls = dots ? [...dots.children].map((b) => b.getBoundingClientRect()) : [];
        const join = a.querySelector('[data-join]');
        const names = a.querySelector('.names-line');
        return {
          id: a.id,
          classes: a.className,
          text: a.innerText,
          tile: tile && { top: tile.top, bottom: tile.bottom, h: tile.height, w: tile.width },
          content: { top, bottom, h: bottom - top },
          bodyRight: body.getBoundingClientRect().right,
          bodyLeft: body.getBoundingClientRect().left,
          bodyW: body.getBoundingClientRect().width,
          balls: balls.map((b) => ({ top: b.top + b.height / 2, left: b.left, right: b.right, w: b.width })),
          hasIcon: !!a.querySelector('.names-line.with-icon .people-icon svg'),
          inCount: !!a.querySelector('.in-count'),
          join: join && { ...JSON.parse(JSON.stringify(join.getBoundingClientRect())), outline: join.classList.contains('outline') },
          names: names && JSON.parse(JSON.stringify(names.getBoundingClientRect())),
          bg: getComputedStyle(a).backgroundColor,
          later: a.classList.contains('cl-later'),
          tier: a.dataset.tier,
        };
      }),
    ));

  // ------------------------------------------------------------ ON (from the seed)
  for (const scheme of ['light', 'dark']) {
    for (const width of [390, 360, 320]) {
      await check(`ON ${scheme} ${width}: no count text, balls on one row and inside the card, people icon + names, no waitlist words`, async () => {
        const { ctx, page, errors } = await openPlayer('Jordan', { width, scheme });
        assert((await page.evaluate(() => document.documentElement.getAttribute('data-card-cleanup'))) === 'on', 'html attribute');
        const cards = await measure(page);
        assert(cards.length > 10, `cards: ${cards.length}`);
        for (const c of cards) {
          assert(!c.inCount, `${c.id}: .in-count`);
          assert(!/\b\d+ of 4 in\b|\b\d+ in\b(?!\s*·)|\bfull\b/i.test(c.text.replace(/You're in|I'm in/g, '')), `${c.id}: count text in «${c.text}»`);
          if (!c.balls.length) continue;
          const tops = new Set(c.balls.map((b) => Math.round(b.top)));
          assert(tops.size === 1, `${c.id}: balls on ${tops.size} rows`);
          assert(c.balls[c.balls.length - 1].right <= c.bodyRight + 0.5, `${c.id}: last ball ${c.balls[c.balls.length - 1].right} past the body ${c.bodyRight}`);
          // Same size as before: 19 px this week, 16 px next week and later.
          const want = c.tier === 'this' ? 19 : 16;
          for (const b of c.balls) assert(Math.abs(b.w - want) < 0.6, `${c.id}: ball ${b.w}, want ${want}`);
        }
        const twelve = cards.find((c) => c.id === `row-${g12.id}`);
        assert(twelve && twelve.balls.length === 12, `12 balls on the 12-in card: ${twelve && twelve.balls.length}`);
        assert(cards.find((c) => c.id === `row-${g11.id}`).balls.length === 11, '11 balls');
        // Every card with names has the people icon; no "In:" label. The names are 13 px (Alex, after the preview).
        for (const c of cards.filter((x) => x.names)) assert(c.hasIcon, `${c.id}: people icon`);
        const fonts = await page.locator('.schedule .names-line.with-icon').evaluateAll((els) => [...new Set(els.map((e) => getComputedStyle(e).fontSize))]);
        assert(fonts.length === 1 && fonts[0] === '13px', `names font ${fonts}`);
        if (width === 390) {
          // Five ordinary names, or six short ones, fit on one line on every card at 390 px.
          const fit = await page.evaluate(() =>
            [...document.querySelectorAll('.schedule > article.sched .names-line.with-icon')].map((line) => {
              const room = line.closest('.sched-body').getBoundingClientRect().width - line.querySelector('.people-icon').getBoundingClientRect().width - parseFloat(getComputedStyle(line).columnGap);
              const c = document.createElement('canvas').getContext('2d');
              const cs = getComputedStyle(line.querySelector('.names-text'));
              c.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
              return { room, five: c.measureText('Alex, Nathan, Joe, Lane, Jordan').width, six: c.measureText('Alex, Joe, Dan, Kai, Sam, Lee').width };
            }),
          );
          for (const f of fit) assert(f.five <= f.room && f.six <= f.room, `names room ${JSON.stringify(f)}`);
        }
        const body = await page.locator('.schedule').innerText();
        assert(!/waitlist|standby|\bIn:/i.test(body), `waitlist words: ${body.match(/.{30}(waitlist|standby|In:).{30}/i)}`);
        if (width === 390) await shot(page, `on-player-${scheme}`);
        if (width === 320) await shot(page, `on-player-${scheme}-320`);
        assert(errors.length === 0, errors.join(' | '));
        await ctx.close();
      });
    }
    await check(`ON ${scheme}: vertical rule: short content is centered on the tile, tall content starts at the tile top`, async () => {
      const { ctx, page, errors } = await openPlayer('Jordan', { scheme });
      const cards = await measure(page);
      let short = 0;
      let tall = 0;
      for (const c of cards) {
        if (c.content.h < c.tile.h - 1) {
          short++;
          const mid = (c.content.top + c.content.bottom) / 2;
          const tmid = (c.tile.top + c.tile.bottom) / 2;
          assert(Math.abs(mid - tmid) <= 1.5, `${c.id}: content middle ${mid} vs tile middle ${tmid}`);
        } else {
          tall++;
          assert(Math.abs(c.content.top - c.tile.top) <= 1.5, `${c.id}: content top ${c.content.top} vs tile top ${c.tile.top}`);
        }
      }
      assert(short > 0 && tall > 0, `both cases seen (short ${short}, tall ${tall})`);
      assert(errors.length === 0, errors.join(' | '));
      await ctx.close();
    });
    await check(`ON ${scheme}: You're in card: status, joined button top right, balls, names, $ due + Pay, I paid and Drop out under`, async () => {
      const { ctx, page, errors } = await openPlayer('Jordan', { scheme });
      const owing = page.locator('.schedule > article.sched[data-mine="in"]', { has: page.locator('[data-owe]') }).first();
      const t = await owing.innerText();
      assert(/^You're in/m.test(t), t);
      const head = await owing.locator('.sched-head').boundingBox();
      const btn = await owing.locator('[data-card-buttons]').boundingBox();
      const body = await owing.locator('.sched-body').boundingBox();
      assert(btn && Math.abs(btn.x + btn.width - (body.x + body.width)) < 3 && Math.abs(btn.y - head.y) < 8, `joined button top right: ${JSON.stringify({ btn, body, head })}`);
      const owe = await owing.locator('[data-owe]').boundingBox();
      const names = await owing.locator('.names-line').boundingBox();
      const links = await owing.locator('.sched-links').boundingBox();
      assert(owe.y > names.y + names.height - 1, 'money row under the names');
      assert(links.y > owe.y + owe.height - 1, 'links under the money row');
      assert(/I paid/.test(await owing.locator('.sched-links').innerText()) && /Drop out/.test(await owing.locator('.sched-links').innerText()), 'I paid, Drop out');
      // Paid: the pill with Drop out to its right.
      const paid = page.locator('.schedule > article.sched[data-mine="in"]', { has: page.locator('[data-paid]') }).first();
      const pill = await paid.locator('[data-paid]').boundingBox();
      const drop = await paid.locator('.drop-link').boundingBox();
      assert(drop.x > pill.x + pill.width - 1 && Math.abs(drop.y + drop.height / 2 - (pill.y + pill.height / 2)) < 6, `Drop out right of the Paid pill: ${JSON.stringify({ pill, drop })}`);
      await owing.screenshot({ path: path.join(SHOTS, `zip10-youre-in-${scheme}.png`) });
      assert(errors.length === 0, errors.join(' | '));
      await ctx.close();
    });
    await check(`ON ${scheme}: Not in card: a normal size filled I'm in under the names (not full width, not on the right), 44 px tall`, async () => {
      const { ctx, page, errors } = await openPlayer('Jordan', { scheme });
      const cards = (await measure(page)).filter((c) => c.join);
      assert(cards.length > 5, `not-in cards: ${cards.length}`);
      for (const c of cards) {
        assert(!c.join.outline, `${c.id}: filled`);
        assert(c.join.width < c.bodyW * 0.7, `${c.id}: not full width (${c.join.width} of ${c.bodyW})`);
        assert(Math.abs(c.join.left - c.bodyLeft) < 2, `${c.id}: left aligned (${c.join.left} vs ${c.bodyLeft})`);
        if (c.names) assert(c.join.top >= c.names.bottom - 1, `${c.id}: under the names`);
        assert(c.join.height >= 44, `${c.id}: ${c.join.height} px tall`);
      }
      await page.locator(`#row-${byCount(1).id}`).screenshot({ path: path.join(SHOTS, `zip10-not-in-${scheme}.png`) });
      assert(errors.length === 0, errors.join(' | '));
      await ctx.close();
    });
    await check(`ON ${scheme}: Later games are a smaller tinted card (56 px tile), names readable on the tint (4.5:1)`, async () => {
      const { ctx, page, errors } = await openPlayer('Jordan', { scheme });
      const cards = await measure(page);
      const later = cards.filter((c) => c.tier === 'later');
      assert(later.length > 3 && later.every((c) => c.later), 'every Later card is a cl-later card');
      const pageBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
      const normal = cards.find((c) => c.tier === 'next' && !/\boff\b/.test(c.classes));
      for (const c of later) {
        assert(Math.abs(c.tile.w - 56) < 1, `${c.id}: tile ${c.tile.w}`);
        assert(c.bg !== pageBg && c.bg !== normal.bg && c.bg !== 'rgba(0, 0, 0, 0)', `${c.id}: tinted (${c.bg} vs page ${pageBg}, card ${normal.bg})`);
      }
      const ratio = await page.evaluate(() => {
        const lum = (c) => {
          const [r, g, b] = c.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number).map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
          return 0.2126 * r + 0.7152 * g + 0.0722 * b;
        };
        const a = document.querySelector('.cl-later .names-line');
        const fg = lum(getComputedStyle(a).color);
        const bg = lum(getComputedStyle(a.closest('.cl-later')).backgroundColor);
        return (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);
      });
      assert(ratio >= 4.5, `contrast ${ratio}`);
      assert(errors.length === 0, errors.join(' | '));
      await ctx.close();
    });
    await check(`ON ${scheme}: organizer Home cards and rows: no count text, balls, people icon + names; switch, In | Out, paid pill and gear stay`, async () => {
      const { ctx, page, errors } = await openAdmin({ scheme });
      const show = page.getByRole('button', { name: /Show all/ });
      if (await show.count()) await show.first().click();
      await page.waitForTimeout(500);
      const cards = page.locator('[data-r2-card]');
      assert((await cards.count()) > 2, 'Home cards');
      assert((await page.locator('[data-r2-card] .players-count').count()) === 0, 'no players-count');
      assert((await page.locator('[data-r2-card] .cl-players').count()) > 0, 'cl-players');
      assert((await page.locator('[data-r2-card] .names-line.with-icon .people-icon').count()) > 0, 'people icon');
      const first = cards.first();
      for (const sel of ['.court-switch, .court-line', '.r2-inout', '.r2-paidcell', '.r2-gear']) assert((await first.locator(sel).count()) > 0, `${sel} on the card`);
      const cardText = await cards.evaluateAll((els) => els.map((e) => e.innerText).join('\n'));
      assert(!/\b\d+ of 4 in\b|\b\d+ in\b(?!\s*·)|\b\d+ in, full\b/.test(cardText.replace(/You're in|I'm in/g, '')), 'no count text on the organizer cards');
      // Tighter Home cards (Alex, after the preview): about 10 px from the note line to the circles, about 6 px from the circles to the names.
      const gaps = await page.evaluate(() =>
        [...document.querySelectorAll('[data-r2-card]')]
          .map((c) => {
            const note = c.querySelector('.r2-mid .game-note');
            // A late-drop line sits between the note and the circles on purpose (Zip 11 seeds one such game): not this measure.
            if (c.querySelector('.r2-mid .late-line')) return null;
            const ball = c.querySelector('.cl-players .dots > *');
            const text = c.querySelector('.cl-players .names-text');
            if (!note || !ball || !text) return null;
            const range = document.createRange();
            range.selectNodeContents(text);
            return { note: ball.getBoundingClientRect().top - note.getBoundingClientRect().bottom, names: range.getClientRects()[0].top - ball.getBoundingClientRect().bottom };
          })
          .filter(Boolean),
      );
      assert(gaps.length > 2, 'cards with a note');
      for (const g of gaps) assert(Math.abs(g.note - 10) <= 1.5 && Math.abs(g.names - 6) <= 1.5, `card gaps ${JSON.stringify(g)}`);
      const rows = page.locator('.hv2-short');
      assert((await rows.count()) > 3, 'folded rows');
      for (const t of await page.locator('.hv2-count.cl-row > strong').allInnerTexts()) assert(/^(~?\d{1,2}(:\d\d)? (AM|PM)|Canceled)$/.test(t.trim()), `row first line is the time: «${t}»`);
      assert((await page.locator('.hv2-count.cl-row .cl-balls .dots').count()) > 3, 'row balls');
      assert((await page.locator('.hv2-names .cl-names .people-icon').count()) > 0, 'row people icon');
      // One row of balls on the rows too, inside the row.
      await still(page);
      const rowsBad = await page.evaluate(() =>
        [...document.querySelectorAll('.hv2-count.cl-row .dots')]
          .filter((d) => new Set([...d.children].map((b) => { const r = b.getBoundingClientRect(); return Math.round(r.top + r.height / 2); })).size > 1 || [...d.children].pop().getBoundingClientRect().right > d.closest('.hv2-main').getBoundingClientRect().right + 0.5)
          .map((d) => `${d.closest('.hv2-short').id}: ${d.children.length} balls, last right ${[...d.children].pop().getBoundingClientRect().right}, main right ${d.closest('.hv2-main').getBoundingClientRect().right}`),
      );
      assert(rowsBad.length === 0, `row balls on one row, inside the row: ${rowsBad.join('; ')}`);
      const body = await page.locator('main, body').first().innerText();
      assert(!/Spot opened/.test(body), 'no Spot opened card');
      await shot(page, `on-admin-${scheme}`);
      assert(errors.length === 0, errors.join(' | '));
      await ctx.close();
    });
  }

  await check('ON: join and drop with no cap: a 12th player joins the 11-in game, 12 balls on one row, then drops (back to 11)', async () => {
    const { ctx, page, errors } = await openPlayer('Harper', { width: 360 });
    const c = card(page, g11.id);
    await c.scrollIntoViewIfNeeded();
    assert((await c.locator('.dots > *').count()) === 11, 'starts at 11');
    await c.locator('[data-join]').click();
    await page.waitForFunction((id) => document.querySelector(`#row-${id}`)?.getAttribute('data-mine') === 'in', g11.id, { timeout: 8000 });
    await page.waitForTimeout(1200);
    assert((await c.locator('.dots > *').count()) === 12, '12 after the tap');
    assert(/Harper/.test(await c.locator('.names-line strong').innerText()), 'own name bold');
    const tops = await c.locator('.dots > *').evaluateAll((els) => new Set(els.map((e) => Math.round(e.getBoundingClientRect().top))).size);
    assert(tops === 1, `one row: ${tops}`);
    await c.screenshot({ path: path.join(SHOTS, 'zip10-twelve-360.png') });
    const s = (await dash()).sessions.find((x) => x.id === g11.id);
    assert(s.confirmedCount === 12 && s.waitlistCount === 0, `server: ${s.confirmedCount} in, ${s.waitlistCount} waiting`);
    await c.locator('.drop-link').click();
    await page.getByRole('button', { name: /^Drop out$/ }).last().click();
    await page.waitForTimeout(6500);
    const s2 = (await dash()).sessions.find((x) => x.id === g11.id);
    assert(s2.confirmedCount === 11, `after the drop: ${s2.confirmedCount}`);
    assert(errors.length === 0, errors.join(' | '));
    await ctx.close();
  });
  await check('ON: a 13th tap on the 12-in game gets the plain refusal (no waitlist, nobody added)', async () => {
    const { ctx, page, errors } = await openPlayer('Casey');
    const c = card(page, g12.id);
    await c.scrollIntoViewIfNeeded();
    await c.locator('[data-join]').click();
    await page.waitForTimeout(1500);
    const toast = await page.locator('.toast, [role="status"], [role="alert"]').allInnerTexts();
    assert(toast.some((t) => t.includes(LIMIT)), `refusal toast: ${JSON.stringify(toast)}`);
    const s = (await dash()).sessions.find((x) => x.id === g12.id);
    assert(s.confirmedCount === 12 && s.waitlistCount === 0, `server: ${s.confirmedCount} in, ${s.waitlistCount} waiting`);
    assert((await c.getAttribute('data-mine')) !== 'in', 'not in');
    assert(errors.length === 0, errors.join(' | '));
    await ctx.close();
  });
  await check('ON: Settings > Feature switches has the "Card cleanup" row, on', async () => {
    const { ctx, page, errors } = await openAdmin();
    await page.locator('.tabbar button', { hasText: 'Settings' }).click();
    await page.waitForTimeout(400);
    for (const s of await page.locator('details > summary').all()) await s.click().catch(() => {});
    const row = page.locator('[data-row="cardCleanupAll"]');
    assert((await row.count()) === 1, 'row');
    assert(/Card cleanup/.test(await row.innerText()), 'name');
    assert(await row.locator('input[data-card-cleanup-all]').isChecked(), 'on');
    assert(errors.length === 0, errors.join(' | '));
    await ctx.close();
  });

  // ------------------------------------------------------------ OFF, then the private link
  await setSwitch(false);
  await check('OFF: the old cards (count text, flat Later rows), no html attribute', async () => {
    const { ctx, page, errors } = await openPlayer('Jordan');
    assert((await page.evaluate(() => document.documentElement.hasAttribute('data-card-cleanup'))) === false, 'no attribute');
    assert((await page.locator('.in-count').count()) > 5, 'count text back');
    assert((await page.locator('.cl-later, .cl-balls, .people-icon').count()) === 0, 'none of the new pieces');
    assert((await page.locator('article.tier-later').count()) > 3, 'flat Later rows');
    await shot(page, 'off-player');
    assert(errors.length === 0, errors.join(' | '));
    await ctx.close();
  });
  await check('OFF + ?cardcleanup=on on one phone: that phone gets the new cards; another phone keeps the old ones', async () => {
    const a = await openPlayer('Jordan', { query: '?cardcleanup=on' });
    assert((await a.page.evaluate(() => document.documentElement.getAttribute('data-card-cleanup'))) === 'on', 'on for this phone');
    assert((await a.page.locator('.in-count').count()) === 0, 'no count text');
    const b = await openPlayer('Avery');
    assert((await b.page.locator('.in-count').count()) > 5, 'other phone unchanged');
    assert(a.errors.length === 0 && b.errors.length === 0, [...a.errors, ...b.errors].join(' | '));
    await a.ctx.close();
    await b.ctx.close();
  });

  await browser.close();
  console.log(`\nzip10: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
