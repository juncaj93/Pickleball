/* Zip 64 (🎾64.finalize): the short ticket, the clearer sign-up words, Who's in with the X, the heat map, the one-screen Finalize and the venue
 * reminder, the style rules on screen and late paying, in a real browser.
 *
 *   node e2e/zip64.cjs
 *
 * The world is the preview's calm profile as of Tue Nov 17 2026, 10:00 AM Eastern, with the Tournament test page's stages (server/tournamentTest.ts).
 *   A  mocks 00 and 01 at 420: the heights, the stub (77 px), the notch (a real cutout), the tear line, the bar, light and dark
 *   B  every state on the short shape at 390, 360 and 320, light and dark: one line each, nothing sticks out, about 150 to 192 px tall
 *   C  Edit and Drop out: 36 px tap areas, far apart
 *   D  the sign-up words (mock 02) and Edit sign-up's line; Who's in has the round X, no "Home" back link
 *   E  the heat map (mock 03): the ramp's ends, one text color, the note
 *   F  Finalize on one Air screen (420 x 912, no scrolling) and at 390/360/320 light and dark; Plays and Pay by saved; the venue reminder and Done
 *   G  the style rules on screen: the switched card, Switch back, the players' banner
 *   H  late paying: Pay now works while a spot is open; 3 hours before the start it is closed
 *   I  who can see it: Only me and the switch off send no tournament data
 * Screenshots: .data/zip64-shots (not in git).
 */
const { spawn, spawnSync } = require('node:child_process');
const { readFileSync, mkdirSync, rmSync } = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.E2E_PORT) || 5465;
const BASE = `http://localhost:${PORT}`;
const SEED_ISO = '2026-11-17T14:00:00.000Z';
const NOW_MS = Date.parse('2026-11-17T15:00:00.000Z'); // Tue Nov 17, 10:00 AM Eastern
const PIN = /PIN `(\d{6})`/.exec(readFileSync(path.join(ROOT, 'docs/PREVIEW_FAKE_DB.md'), 'utf8'))[1];
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const SHOTS = path.join(ROOT, '.data', 'zip64-shots');

let passed = 0;
let failed = 0;
const ONLY = process.env.ZIP64_ONLY || '';
async function check(name, fn) {
  if (ONLY && !name.includes(ONLY)) return;
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.log(`  ✗ ${name}\n      ${String(err && err.message ? err.message : err).replace(/\s*\n\s*/g, ' ⏎ ').slice(0, 1400)}`);
  }
}
const assert = (c, m) => {
  if (!c) throw new Error(m);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const flat = (t) => String(t).replace(/\s+/g, ' ').trim();
const SIZES = [390, 360, 320];
const SCHEMES = ['light', 'dark'];

async function main() {
  const dbFile = path.join(ROOT, '.data', 'zip64.sqlite');
  mkdirSync(SHOTS, { recursive: true });
  rmSync(dbFile, { force: true });
  const seeded = spawnSync('npx', ['vite-node', 'scripts/load-small-local.ts', '--', dbFile, SEED_ISO, '--calm', '--zip55', '--zip60'], { cwd: ROOT, encoding: 'utf8' });
  if (seeded.status !== 0) throw new Error(`could not build the calm world: ${seeded.stderr || seeded.stdout}`);
  if (await fetch(`${BASE}/api/status`).then((r) => r.ok, () => false)) throw new Error(`port ${PORT} is already in use`);
  const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
    cwd: ROOT,
    env: { ...process.env, DEV_DB: dbFile, SETUP_TOKEN: 'zip64-setup-token-0123456789', DEV_CLOCK: '1', PREVIEW_CALM: 'on', PB_PREVIEW_BUILD: '1' },
    stdio: 'ignore',
    detached: true,
  });
  process.on('exit', () => {
    try {
      process.kill(-server.pid, 'SIGTERM');
    } catch {}
  });
  for (let i = 0; i < 90; i++) {
    if (await fetch(`${BASE}/api/status`).then((r) => r.ok, () => false)) break;
    await sleep(500);
  }
  await fetch(`${BASE}/__dev/clock`, { method: 'POST', body: JSON.stringify({ atMs: NOW_MS }) });
  const browser = await chromium.launch();
  const shift = (ctx) =>
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
    }, NOW_MS - Date.now());

  const admin = await browser.newContext();
  assert((await admin.request.post(BASE + '/api/admin/login', { data: { pin: PIN }, headers: { Origin: BASE } })).ok(), 'admin login');
  const adminCookies = await admin.cookies();
  const dash = async () => (await admin.request.get(BASE + '/api/admin/dashboard')).json();
  const call = async (method, url, data) => {
    const r = await admin.request.fetch(BASE + url, { method, data, headers: { Origin: BASE } });
    assert(r.ok(), `${method} ${url}: ${r.status()} ${await r.text()}`);
    return r.json();
  };
  const stage = (s) => call('POST', '/api/admin/tournament-test', { stage: s });
  async function answerOf(name) {
    const ctx = await browser.newContext();
    const list = (await (await ctx.request.get(BASE + '/api/group')).json()).players;
    const p = list.find((x) => x.name === name);
    await ctx.request.post(BASE + '/api/me', { data: { playerId: p.id }, headers: { Origin: BASE } });
    const text = await (await ctx.request.get(BASE + '/api/group')).text();
    await ctx.close();
    return { text, data: JSON.parse(text) };
  }
  async function newPage(opts = {}) {
    const { width = 390, scheme = 'light', height = 844, organizer = false, reducedMotion = 'reduce' } = opts;
    const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, colorScheme: scheme, isMobile: true, hasTouch: true, userAgent: UA, reducedMotion });
    await shift(ctx);
    if (organizer) await ctx.addCookies(adminCookies.map((c) => ({ ...c })));
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    return { ctx, page, errors };
  }
  async function playerPage(who, opts = {}) {
    const p = await newPage(opts);
    await p.page.goto(`${BASE}/?as=${encodeURIComponent(who)}`);
    await p.page.locator('.schedule').first().waitFor({ timeout: 30000 });
    await p.page.reload();
    await p.page.locator('.schedule').first().waitFor({ timeout: 30000 });
    await p.page.waitForTimeout(700);
    return p;
  }
  async function adminPage(opts = {}) {
    const p = await newPage({ ...opts, organizer: true });
    await p.page.goto(`${BASE}/admin`);
    await p.page.locator('.tabbar').waitFor({ timeout: 30000 });
    await p.page.waitForTimeout(700);
    return p;
  }
  async function fits(page, sel) {
    const r = await page.evaluate((s) => {
      const out = { page: [document.documentElement.scrollWidth, window.innerWidth], bad: [] };
      for (const root of document.querySelectorAll(s)) {
        const box = root.getBoundingClientRect();
        for (const el of root.querySelectorAll('*')) {
          const b = el.getBoundingClientRect();
          if (b.width === 0 || b.height === 0) continue;
          if (getComputedStyle(el).position === 'absolute') continue;
          if (b.right > box.right + 1 || b.left < box.left - 1) out.bad.push(`${el.tagName}.${el.className} ${Math.round(b.left)}..${Math.round(b.right)} outside ${Math.round(box.left)}..${Math.round(box.right)}`);
        }
      }
      return out;
    }, sel);
    assert(r.page[0] <= r.page[1], `the page is wider than the screen (${r.page[0]} > ${r.page[1]})`);
    assert(r.bad.length === 0, `sticks out: ${r.bad.slice(0, 4).join(' | ')}`);
  }
  /** No piece of text under `sel` runs onto a second line. */
  async function oneLine(page, sel) {
    const bad = await page.evaluate((s) => {
      const out = [];
      for (const root of document.querySelectorAll(s)) {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
          if (!n.textContent.trim()) continue;
          const range = document.createRange();
          range.selectNodeContents(n);
          const tops = new Set([...range.getClientRects()].filter((r) => r.width > 0).map((r) => Math.round(r.top)));
          if (tops.size > 1) out.push(`"${n.textContent.trim()}" on ${tops.size} lines`);
        }
      }
      return out;
    }, sel);
    assert(bad.length === 0, `wraps: ${bad.slice(0, 4).join(' | ')}`);
  }
  const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
  const noDash = async (page, where) => {
    const text = await page.evaluate(() => document.body.innerText);
    assert(!text.includes('\u2014'), `an em dash on ${where}`);
  };
  const openSchedule = async (a) => {
    await a.page.locator('.tabbar button', { hasText: 'Settings' }).click();
    const sched = a.page.locator('[data-section="schedule"]');
    if (!(await sched.getAttribute('open'))) await sched.locator('summary').click();
    await a.page.locator('[data-tm-schedule-row]').click();
  };

  async function postAs(name, url, data, method = 'POST') {
    const ctx = await browser.newContext();
    const list = (await (await ctx.request.get(BASE + '/api/group')).json()).players;
    await ctx.request.post(BASE + '/api/me', { data: { playerId: list.find((x) => x.name === name).id }, headers: { Origin: BASE } });
    const r = await ctx.request.fetch(BASE + url, { method, data, headers: { Origin: BASE } });
    const out = { status: r.status(), body: await r.text() };
    await ctx.close();
    return out;
  }
  /** Vic's page with the card drawn. `motion`: let the gold pop play (the other pages use reduced motion). */
  async function vicCard(opts = {}) {
    const v = await playerPage(opts.who || 'Vic', opts);
    await v.page.locator('.tc-short').first().waitFor({ timeout: 20000 });
    return v;
  }

  const ONE = '.tc-short .tc-kicker, .tc-short .tc-format, .tc-short .tc-btn, .tc-short .tc-aside, .tc-short .tc-link, .tc-short .tc-wd, .tc-short .tc-day, .tc-short .tc-mon, .tc-short .tc-time';
  const cardBox = (page) =>
    page.evaluate(() => {
      const c = document.querySelector('.tc-short');
      const r = c.getBoundingClientRect();
      const stub = c.querySelector('.tc-stub').getBoundingClientRect();
      const bar = c.querySelector('.tc-bar').getBoundingClientRect();
      const btn = c.querySelector('.tc-bar .tc-btn');
      const b = btn ? btn.getBoundingClientRect() : null;
      const title = c.querySelector('.tc-title');
      return {
        h: +r.height.toFixed(1),
        w: r.width,
        stub: Math.round(stub.width),
        mask: getComputedStyle(c).webkitMaskImage || getComputedStyle(c).maskImage,
        tear: getComputedStyle(c.querySelector('.tc-stub'), '::after').backgroundImage,
        btnTop: b ? +(b.top - r.top).toFixed(1) : null,
        btnH: b ? +b.height.toFixed(1) : null,
        btnW: b ? +b.width.toFixed(1) : null,
        barH: bar.height,
        titleCut: title.scrollWidth > title.clientWidth + 1,
      };
    });

  // ---------------------------------------------------------------- A  mocks 00 and 01 at 420
  await stage('zip64_start');
  for (const scheme of SCHEMES)
    for (const [who, mock, want] of [
      ['Vic', '00', 184],
      ['Parker', '01', 176],
    ])
      await check(`A mock ${mock} (${who}) at 420 ${scheme}: about ${want} px, the 77 px stub, the notch, the tear line, the bar`, async () => {
        const v = await vicCard({ who, width: 420, height: 912, scheme });
        const box = await cardBox(v.page);
        assert(Math.abs(box.h - want) <= 2, `height ${box.h}, the mock ${want}`);
        assert(box.stub === 77, `stub ${box.stub}`);
        assert(/radial-gradient/.test(box.mask), `the notch is a real cutout: ${box.mask}`);
        assert(/linear-gradient/.test(box.tear), `the dashed tear line: ${box.tear}`);
        assert(Math.abs(box.btnTop - 123) <= 1.5, `the bar's button at the mock's height: ${box.btnTop}`);
        const c = v.page.locator('.tc-short').first();
        assert(flat(await c.locator('.tc-kicker').innerText()) === 'TOURNAMENT', await c.locator('.tc-kicker').innerText());
        assert(flat(await c.locator('.tc-title').innerText()) === 'The Cold Open', 'the real name, mixed case');
        assert(flat(await c.locator('.tc-format').innerText()) === 'Tournament style TBD', 'TBD');
        assert(flat(await c.locator('.tc-stub').innerText()) === 'DATE TBD DEC ~7:30 PM', await c.locator('.tc-stub').innerText());
        if (who === 'Vic') {
          assert(box.btnH === 48 && Math.abs(box.btnW - 360) <= 1, `one wide lime Sign up: ${JSON.stringify(box)}`);
          assert(flat(await c.locator('.tc-bar').innerText()) === 'Sign up', 'no hint words');
        } else {
          assert(box.btnH === 40 && box.btnW < 200, `the narrower gray button: ${JSON.stringify(box)}`);
          assert(flat(await c.locator('.tc-bar').innerText()) === 'See who’s signed up Edit Drop out', await c.locator('.tc-bar').innerText());
        }
        assert((await c.locator('.tc-track, .tc-foot, .tc-halo').count()) === 0, 'no steps strip, no foot line');
        await oneLine(v.page, ONE);
        await fits(v.page, '.tc-short');
        await shot(v.page, `A-${mock}-420-${scheme}`);
        assert(v.errors.length === 0, v.errors.join(' | '));
        await v.ctx.close();
      });

  // ---------------------------------------------------------------- B  every state, every width
  const STATES = [
    ['zip64_start', 'Vic', 'open', 'Sign up'],
    ['zip64_start', 'Parker', 'listed', 'See who’s signed up'],
    ['vote_majority', 'Parker', 'lock', 'Lock my spot · $16'],
    ['tickets_open', 'Parker', 'in', 'See who’s in'],
    ['late_open', 'Vic', 'lock', 'Lock my spot · $16'],
    ['late_cut', 'Vic', 'closed', 'See who’s in'],
    ['canceled', 'Parker', 'canceled', null],
    ['rescheduled', 'Parker', 'rescheduled', 'See who’s signed up'],
    ['style_odd', 'Parker', 'in', 'See who’s in'],
  ];
  let lastStage = '';
  for (const [st, who, data, btn] of STATES)
    for (const scheme of SCHEMES)
      for (const width of [390, 360, 320])
        await check(`B ${st} as ${who} (${data}) at ${width} ${scheme}: the short shape, one line each, nothing sticks out`, async () => {
          if (st !== lastStage) {
            await stage(st);
            lastStage = st;
          }
          const v = await vicCard({ who, width, scheme });
          const c = v.page.locator('.tc-short').first();
          assert((await c.getAttribute('data-tc')) === data, `state ${await c.getAttribute('data-tc')}`);
          const box = await cardBox(v.page);
          assert(box.h >= 140 && box.h <= 192, `height ${box.h}`);
          assert(!box.titleCut, 'the name is not cut');
          if (btn) assert(flat(await c.locator('.tc-bar .tc-btn').first().innerText()) === btn, await c.locator('.tc-bar').innerText());
          const cut = await c.evaluate((e) => [...e.querySelectorAll('.tc-btn, .tc-aside')].filter((x) => x.scrollWidth > x.clientWidth + 1).map((x) => x.textContent));
          assert(cut.length === 0, `cut words: ${cut}`);
          await oneLine(v.page, ONE);
          await fits(v.page, '.tc-short');
          await noDash(v.page, 'the card');
          if (width === 390 || width === 320) await shot(v.page, `B-${st}-${who}-${width}-${scheme}`);
          assert(v.errors.length === 0, v.errors.join(' | '));
          await v.ctx.close();
        });

  // ---------------------------------------------------------------- C  Edit and Drop out
  await stage('zip64_start');
  for (const width of [420, 390, 360, 320])
    await check(`C Edit and Drop out at ${width}: 36 px tall tap areas, apart, inside the card`, async () => {
      const v = await vicCard({ who: 'Parker', width });
      const r = await v.page.evaluate(() => {
        const [e, d] = [...document.querySelectorAll('.tc-bar .tc-link')].map((x) => x.getBoundingClientRect());
        const card = document.querySelector('.tc-short').getBoundingClientRect();
        return { eh: e.height, dh: d.height, gap: d.left - e.right, right: card.right - d.right };
      });
      assert(r.eh >= 36 && r.dh >= 36, `tap areas ${JSON.stringify(r)}`);
      assert(r.gap >= (width >= 390 ? 16 : 12), `apart: ${JSON.stringify(r)}`);
      assert(r.right >= 12, `inside: ${JSON.stringify(r)}`);
      await v.ctx.close();
    });

  // ---------------------------------------------------------------- D  the sign-up words, Who's in X
  await check('D Sign up step 2 (mock 02): "Step 2 of 2 · Your dates" and the new line; no start time line', async () => {
    await stage('zip64_start');
    const v = await vicCard();
    await v.page.locator('[data-tc-signup]').click();
    await v.page.locator('dialog[open] .tm-level').first().click();
    await v.page.locator('[data-tm-next]').click();
    const step = v.page.locator('dialog[open] [data-tm-step="2"]');
    assert(flat(await step.locator('.tm-eyebrow').first().textContent()) === 'Step 2 of 2 · Your dates', await step.locator('.tm-eyebrow').first().textContent());
    assert(flat(await step.locator('[data-tm-dates-help]').textContent()) === 'Tap every date you can make. We pick the one that works for the most people.', 'the line');
    assert(!/Green dates|Games start/.test(await step.innerText()), 'the old lines are gone');
    await shot(v.page, 'D-signup');
    await v.ctx.close();
  });
  await check('D Edit sign-up: the same line without the step label', async () => {
    const v = await vicCard({ who: 'Parker' });
    await v.page.locator('[data-tc-edit]').click();
    const sheet = v.page.locator('dialog[open]');
    assert(flat(await sheet.locator('[data-tm-dates-help]').textContent()) === 'Tap every date you can make. We pick the one that works for the most people.', 'the line');
    assert(!/Step 2/.test(await sheet.innerText()), 'no step label');
    await v.ctx.close();
  });
  await check("D Who's in: the round X at the top right, no Home back link", async () => {
    await stage('tickets_open');
    const v = await vicCard({ who: 'Parker' });
    await v.page.locator('.tc-short .tc-title').click();
    const sheet = v.page.locator('dialog[open].tc-tw-overlay');
    await sheet.waitFor({ timeout: 10000 });
    assert((await sheet.locator('[data-sheet-back]').count()) === 0, 'no back link');
    const x = await sheet.locator('.sheet-head .icon-btn[aria-label="Close"]').boundingBox();
    assert(x && x.x > 300, `the X on the right: ${JSON.stringify(x)}`);
    await sheet.locator('.sheet-head .icon-btn[aria-label="Close"]').click();
    await v.page.waitForTimeout(400);
    assert((await v.page.locator('dialog[open].tc-tw-overlay').count()) === 0, 'X closes it');
    await v.ctx.close();
  });

  // ---------------------------------------------------------------- E  the heat map
  const openDates = async (a) => {
    await a.page.locator('[data-tm-open-dates]').click();
    await a.page.locator('[data-tm-card="dates"] .tm-day.tm-open').first().waitFor();
  };
  for (const scheme of SCHEMES)
    await check(`E the heat map (${scheme}): the brightest for the most, the palest for the fewest, one text color, the note`, async () => {
      await stage('zip64_start');
      const a = await adminPage({ width: 420, height: 912, scheme });
      await openDates(a);
      const tiles = await a.page.evaluate(() =>
        [...document.querySelectorAll('[data-tm-card="dates"] .tm-day.tm-open[data-heat]')].map((e) => ({
          n: Number(e.querySelector('.tm-badge').textContent),
          bg: getComputedStyle(e).backgroundColor,
          color: getComputedStyle(e).color,
        })),
      );
      const max = Math.max(...tiles.map((t) => t.n));
      const min = Math.min(...tiles.map((t) => t.n));
      const top = tiles.find((t) => t.n === max);
      const low = tiles.find((t) => t.n === min);
      const want = scheme === 'light' ? ['rgb(63, 214, 138)', 'rgb(211, 241, 225)', 'rgb(16, 35, 26)'] : ['rgb(31, 138, 83)', 'rgb(21, 51, 34)', 'rgb(255, 255, 255)'];
      assert(top.bg === want[0] && low.bg === want[1], `ends ${top.bg} ${low.bg}`);
      assert(new Set(tiles.map((t) => t.color)).size === 1 && tiles[0].color === want[2], `one text color ${[...new Set(tiles.map((t) => t.color))]}`);
      assert(flat(await a.page.locator('[data-tm-dates-note]').innerText()) === 'Brighter green means more can play. Tap a date to pick it.', 'note');
      await shot(a.page, `E-heat-${scheme}`);
      await a.ctx.close();
    });

  // ---------------------------------------------------------------- F  Finalize on one screen
  const best = async () => {
    const t = (await dash()).tournament;
    const counts = {};
    for (const s of t.signups) for (const d of s.dates) counts[d] = (counts[d] || 0) + 1;
    return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
  };
  for (const scheme of SCHEMES)
    for (const [width, height] of [
      [420, 912],
      [390, 844],
      [360, 780],
      [320, 640],
    ])
      await check(`F Finalize at ${width} x ${height} ${scheme}: the rows, one line each${width === 420 ? ', no scrolling on one Air screen' : ''}`, async () => {
        await stage('zip64_start');
        const day = await best();
        const a = await adminPage({ width, height, scheme });
        await openDates(a);
        await a.page.locator(`[data-tm-card="dates"] [data-day="${day}"]`).click();
        await a.page.locator('[data-tm-fin-count]').waitFor({ timeout: 10000 });
        const sheet = a.page.locator('dialog.tm-date-sheet[open]');
        const text = flat(await sheet.innerText());
        assert(/^Finalize (Mon|Tue|Wed|Thu|Fri|Sat|Sun) [A-Z][a-z]{2} \d+/.test(text), text.slice(0, 60));
        assert(/9 can play/.test(text), text.slice(0, 120));
        assert(/STYLE|Style/.test(text) && /Auto/.test(text) && /Doubles/.test(text) && /Americano/.test(text), 'the three styles');
        assert(/Votes: Doubles 3 · Americano 2 · Either 4/.test(text), `votes: ${text}`);
        assert(!/plan fits|Nobody picked|Ticket price/.test(text), 'removed lines');
        assert((await sheet.locator('[data-tm-fin-start]').inputValue()) === String(19 * 60 + 30) && (await sheet.locator('[data-tm-fin-end]').inputValue()) === String(22 * 60), 'Plays 7:30 PM to 10:00 PM');
        await oneLine(a.page, 'dialog.tm-date-sheet[open] .tm-fin-row, dialog.tm-date-sheet[open] .tm-fin-votes, dialog.tm-date-sheet[open] .tm-fin-style button, dialog.tm-date-sheet[open] .tm-fin-actions .btn');
        await fits(a.page, 'dialog.tm-date-sheet[open] .sheet-body');
        if (width === 420) {
          const s = await a.page.evaluate(() => {
            const b = document.querySelector('dialog.tm-date-sheet[open] .sheet-body');
            const d = document.querySelector('dialog.tm-date-sheet[open]');
            return { body: [b.scrollHeight, b.clientHeight], dlg: [d.scrollHeight, d.clientHeight], bottom: document.querySelector('[data-tm-finalize-go]').getBoundingClientRect().bottom };
          });
          assert(s.body[0] <= s.body[1] + 1 && s.dlg[0] <= s.dlg[1] + 1 && s.bottom <= 912, `no scrolling: ${JSON.stringify(s)}`);
        }
        await shot(a.page, `F-finalize-${width}-${scheme}`);
        assert(a.errors.length === 0, a.errors.join(' | '));
        await a.ctx.close();
      });
  await check('F Finalize saves Plays 7:30 to 10:30 PM and Pay by, opens tickets; the venue reminder with the real times; Done hides it', async () => {
    await stage('zip64_start');
    const day = await best();
    const a = await adminPage({ width: 420, height: 912 });
    await openDates(a);
    await a.page.locator(`[data-tm-card="dates"] [data-day="${day}"]`).click();
    await a.page.locator('[data-tm-fin-count]').waitFor({ timeout: 10000 });
    await a.page.locator('[data-tm-fin-end]').selectOption(String(22 * 60 + 30));
    await a.page.locator('[data-format="doubles"]').click();
    await a.page.locator('[data-tm-finalize-go]').click();
    await a.page.locator('[data-tm-finalize]').waitFor({ state: 'detached', timeout: 10000 });
    const t = (await dash()).tournament;
    assert(t.status === 'tickets' && t.start === 19 * 60 + 30 && t.minutes === 180 && t.startSet === true, JSON.stringify({ s: t.status, start: t.start, m: t.minutes }));
    assert(t.format === 'doubles', t.format);
    await a.page.goto(`${BASE}/admin`);
    const venue = a.page.locator('[data-tm-venue-alert]');
    await venue.waitFor({ timeout: 10000 });
    assert(flat(await venue.innerText()).startsWith('Call the venue: keep courts 1 and 2 together, 7:30 to 10:30 PM'), await venue.innerText());
    await shot(a.page, 'F-venue');
    await venue.locator('[data-tm-venue-done]').click();
    await a.page.waitForTimeout(300);
    assert((await a.page.locator('[data-tm-venue-alert]').count()) === 0, 'Done hides it');
    await a.page.reload();
    await a.page.locator('.tabbar').waitFor();
    await a.page.waitForTimeout(600);
    assert((await a.page.locator('[data-tm-venue-alert]').count()) === 0, 'and it stays hidden');
    // The player's stub: the real start with no "~", the style still TBD.
    const v = await vicCard({ who: 'Parker' });
    const stub = flat(await v.page.locator('.tc-short .tc-stub').innerText());
    assert(/^[A-Z]{3} \d+ [A-Z]{3} 7:30 PM$/.test(stub), stub);
    assert(flat(await v.page.locator('.tc-short .tc-format').innerText()) === 'Tournament style TBD', 'TBD until Pay by');
    await v.ctx.close();
    await a.ctx.close();
  });

  // ---------------------------------------------------------------- G  the style rules on screen
  await check('G odd after Pay by: the organizer\'s "switched to Americano" card; the players\' banner', async () => {
    await stage('style_odd');
    const a = await adminPage({ width: 390 });
    const odd = a.page.locator('[data-tm-odd-switch]');
    await odd.waitFor({ timeout: 10000 });
    assert(flat(await odd.innerText()).startsWith('The Cold Open switched to Americano (odd number of players).'), await odd.innerText());
    await shot(a.page, 'G-odd-admin');
    await a.ctx.close();
    const v = await vicCard({ who: 'Parker' });
    const note = v.page.locator('[data-style-note]');
    await note.waitFor({ timeout: 10000 });
    assert(flat(await note.innerText()).startsWith('Tournament style is now Americano.'), await note.innerText());
    assert(flat(await v.page.locator('.tc-short .tc-format').innerText()) === 'Americano (new partner every round)', 'the card');
    await shot(v.page, 'G-odd-player');
    await v.ctx.close();
  });
  await check('G even again: "Switch back to Locked doubles?" never switches by itself; Not now hides it; Switch switches; the banner says so', async () => {
    await stage('style_back');
    const a = await adminPage({ width: 390, scheme: 'dark' });
    const card = a.page.locator('[data-tm-switch-back]');
    await card.waitFor({ timeout: 10000 });
    await shot(a.page, 'G-back-admin');
    await a.page.waitForTimeout(5500);
    assert((await dash()).tournament.format === 'americano', 'not by itself');
    await card.locator('[data-tm-switch-back-later]').click();
    await a.page.waitForTimeout(300);
    assert((await a.page.locator('[data-tm-switch-back]').count()) === 0, 'Not now hides it');
    await a.ctx.close();
    const b = await adminPage({ width: 390 });
    await b.page.evaluate(() => localStorage.removeItem('pb_tour_style_seen'));
    await b.page.reload();
    await b.page.locator('[data-tm-switch-back-go]').click();
    await b.page.waitForTimeout(800);
    assert((await dash()).tournament.format === 'doubles', 'Switch');
    await b.ctx.close();
    const v = await vicCard({ who: 'Parker' });
    const note = v.page.locator('[data-style-note]');
    await note.waitFor({ timeout: 10000 });
    assert(flat(await note.innerText()).startsWith('Tournament style is back to Locked doubles.'), await note.innerText());
    await v.ctx.close();
  });

  // ---------------------------------------------------------------- H  late paying
  await check('H late, a spot open: "Your payment is late", Pay now opens the Pay sheet (no fee: $16)', async () => {
    await stage('late_open');
    const v = await vicCard();
    const late = v.page.locator('[data-pay-countdown="late"]');
    await late.waitFor({ timeout: 10000 });
    assert(flat(await v.page.locator('.tc-short .tc-aside').innerText()) === 'Still open', await v.page.locator('.tc-short .tc-aside').innerText());
    await late.locator('[data-pay-countdown-btn]').click();
    await v.page.locator('dialog[open]', { hasText: '$16' }).waitFor({ timeout: 10000 });
    await shot(v.page, 'H-late-pay');
    await v.ctx.close();
  });
  await check('H 3 hours before the start: closed for Vic (no countdown, Tickets closed); the server says "Tickets are closed."', async () => {
    await stage('late_cut');
    const v = await vicCard();
    assert((await v.page.locator('[data-pay-countdown]').count()) === 0, 'no countdown');
    assert(flat(await v.page.locator('.tc-short .tc-aside').innerText()) === 'Tickets closed', 'aside');
    await v.ctx.close();
    const t = JSON.parse((await answerOf('Vic')).text).tournament;
    const r = await postAs('Vic', '/api/tournament/lock', { tournamentId: t.id, intent: 'lock', priceCents: 1600 });
    assert(r.status === 409 && JSON.parse(r.body).message === 'Tickets are closed.', r.body);
  });

  // ---------------------------------------------------------------- I  who can see it
  await check('I Only me and the switch off: no tournament data for a player', async () => {
    await stage('zip64_start');
    const t = (await dash()).tournament;
    await call('PUT', `/api/admin/tournament/${t.id}/visibility`, { visibility: 'me' });
    let a = await answerOf('Vic');
    assert(a.data.tournament === undefined && !/Cold Open|startSet|styleTbd/.test(a.text), 'Only me');
    await call('PUT', `/api/admin/tournament/${t.id}/visibility`, { visibility: 'all' });
    await call('PUT', '/api/admin/tournaments-switch', { on: false });
    a = await answerOf('Vic');
    assert(a.data.tournament === undefined && !/Cold Open/.test(a.text), 'switch off');
    await call('PUT', '/api/admin/tournaments-switch', { on: true });
  });

  await browser.close();
  console.log(`\nzip64: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
