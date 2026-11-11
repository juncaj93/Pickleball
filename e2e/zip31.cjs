/* Zip 31, "Extended time" (EXTENDED_TIME): browser checks for every screen this zip changed.
 *
 *   node e2e/zip31.cjs      (also run by npm run test:e2e)
 *
 * The world: the SMALL preview cast (scripts/load-small-local.ts) as of Thu Nov 12, 2026, 3:00 PM Eastern, every Settings row on as on live
 * plus "Extended time" (the preview's rows), every wrangler.toml switch as on live, PREVIEW_CALM on as on the preview. Three games are added
 * this afternoon through the organizer's own API: 4 in (Alex, Parker, Christopher Vanderberg, Sage), 6 in and 10 in; then the clock moves to
 * 9:00 PM so each has its Finalize card. Own dev server on its own port and its own copy; nothing touches Cloudflare or live.
 *
 *  1. Switch OFF (the Settings row off): the Finalize card says "Change who played" and opens the old list sheet (exactly main).
 *  2. Switch ON: "Edit players / time"; the tiles sheet (4, 6 and 10 tiles): summary "4 played · $14 each", None picked, +30 min shows
 *     "3 others pay $3 each" / "You cover $3", a tile tapped off goes dashed and gray and the numbers follow, Confirm always in view.
 *  3. Strict clipping (e2e/clip-check.cjs) on the sheet with 4, 6 and 10 players, the Home rows, the player alert, the next game card and the
 *     Pay sheet: 390, 360 and 320 wide, light and dark, text 100, 125 and 150%.
 *  4. Confirm (+30 min): Home lists the three shares ("$3 extension · Thu, Nov 12"); Sage (no credit) sees "You owe $3 for the extra 30 min we
 *     added ..." (Zip 31 round 3: "You owe $3 for tonight's extra 30 min. It's added to your next game.") with "Pay now instead", and her next game reads "$17 due" with "incl. $3
 *     extension"; Christopher Vanderberg (credit) sees the blue "Your $3 credit was used ..."; with +1 hr Parker ($5 credit) sees the part one.
 * Pictures go to e2e/screenshots (zip31-*.png), light and dark, for the report.
 */
const { spawn, spawnSync } = require('node:child_process');
const { readFileSync, mkdirSync, rmSync } = require('node:fs');
const path = require('node:path');
const playwright = require('playwright');
const { findClipping } = require('./clip-check.cjs');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.E2E_PORT) || 5441;
const BASE = `http://localhost:${PORT}`;
const SEED_ISO = '2026-11-12T20:00:00.000Z'; // Thu Nov 12, 3:00 PM Eastern
const NOW_MS = Date.parse(SEED_ISO);
const AFTER_MS = Date.parse('2026-11-13T02:00:00.000Z'); // Thu Nov 12, 9:00 PM Eastern
const SHOTS = process.env.E2E_SHOTS || path.join(__dirname, 'screenshots');
const PIN = /PIN `(\d{6})`/.exec(readFileSync(path.join(ROOT, 'docs/PREVIEW_FAKE_DB.md'), 'utf8'))[1];
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const FULL = process.env.E2E_FULL !== '0';

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

async function main() {
  mkdirSync(SHOTS, { recursive: true });
  const dbFile = path.join(ROOT, '.data', `zip31-${PORT}.sqlite`);
  mkdirSync(path.join(ROOT, '.data'), { recursive: true });
  rmSync(dbFile, { force: true });
  const seeded = spawnSync('npx', ['vite-node', 'scripts/load-small-local.ts', '--', dbFile, SEED_ISO], { cwd: ROOT, encoding: 'utf8' });
  if (seeded.status !== 0) throw new Error(`could not build the fake world: ${seeded.stderr || seeded.stdout}`);
  const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
    cwd: ROOT,
    env: { ...process.env, ...liveVars(), DEV_DB: dbFile, SETUP_TOKEN: 'zip31-setup-token-0123456789', DEV_CLOCK: '1', PREVIEW_CALM: 'on' },
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
  const setClock = (ms) => fetch(`${BASE}/__dev/clock`, { method: 'POST', body: JSON.stringify({ atMs: ms }) });
  await setClock(NOW_MS);
  let clockMs = NOW_MS;

  const browser = await playwright.chromium.launch();
  const api = await playwright.request.newContext({ baseURL: BASE, extraHTTPHeaders: { Origin: BASE } });
  assert((await api.post('/api/admin/login', { data: { pin: PIN } })).ok(), 'organizer sign-in');
  const call = async (method, url, data) => {
    const r = await api.fetch(url, { method, data, headers: { Origin: BASE } });
    const text = await r.text();
    if (!r.ok()) throw new Error(`${method} ${url} -> ${r.status()} ${text.slice(0, 300)}`);
    return text ? JSON.parse(text) : null;
  };
  let d = await call('GET', '/api/admin/dashboard');
  const id = Object.fromEntries(d.players.map((p) => [p.name, p.id]));
  /** A booked game at the first free half hour from `fromMs`, with these players in (Alex through his own In). */
  async function game(fromMs, names) {
    let made = null;
    for (let k = 0; k < 16 && !made; k++) {
      const start = fromMs + k * 30 * 60_000;
      const r = await api.fetch('/api/admin/sessions', { method: 'POST', data: { startsAt: new Date(start).toISOString(), endsAt: new Date(start + 2 * 3600_000).toISOString(), note: null }, headers: { Origin: BASE } });
      if (r.status() === 409) continue;
      if (!r.ok()) throw new Error(`add game -> ${r.status()} ${await r.text()}`);
      made = (await r.json()).id;
    }
    assert(made, 'a free slot for the game');
    await call('POST', `/api/admin/sessions/${made}/court-status`, { status: 'booked' });
    for (const n of names) {
      if (n === 'Alex') await call('POST', `/api/admin/sessions/${made}/me`, { in: true });
      else await call('POST', `/api/admin/sessions/${made}/roster`, { playerId: id[n], action: 'confirm' });
    }
    return made;
  }
  const FOUR = ['Alex', 'Parker', 'Christopher Vanderberg', 'Sage'];
  const SIX = ['Alex', 'Parker', 'Christopher Vanderberg', 'Sage', 'Rowan', 'Quinn'];
  const TEN = ['Alex', 'Parker', 'Christopher Vanderberg', 'Sage', 'Rowan', 'Quinn', 'Vic', 'Wren', 'Zoe', 'Reese'];
  // Earlier this afternoon so they are over by 9 PM; the 4-in game is the one finalized (the others only open their sheets).
  const g4 = await game(NOW_MS + 30 * 60_000, FOUR);
  const g6 = await game(NOW_MS + 30 * 60_000, SIX);
  const g10 = await game(NOW_MS + 30 * 60_000, TEN);
  // Credit set by hand (Adjust credit, as Alex does): Sage none (the owe alert), Christopher Vanderberg $5 (covers $3), Parker $5 (covers
  // $3; after the +1 hr redo $5 of $6).
  const potOf = async (name) => ((await call('GET', '/api/admin/dashboard')).creditLedger.find((l) => l.playerId === id[name]) || { balanceCents: 0, reservedCents: 0 });
  async function setCredit(name, cents) {
    const now = await potOf(name);
    const delta = cents - now.balanceCents;
    if (delta === 0) return;
    const r = await api.fetch(`/api/admin/players/${id[name]}/credit-adjust`, { method: 'POST', data: { direction: delta > 0 ? 'add' : 'remove', cents: Math.abs(delta), reason: 'test', seen: now.balanceCents }, headers: { Origin: BASE, 'X-Adjust-Credit': 'on' } });
    if (!r.ok()) throw new Error(`credit ${name} -> ${r.status()} ${await r.text()}`);
  }
  // Sage's next game: tomorrow evening, booked, unpaid (where the $3 rides: "$17 due").
  const next = await game(NOW_MS + 27 * 3600_000, ['Sage', 'Christopher Vanderberg', 'Parker']);
  await setCredit('Sage', 0);
  await setCredit('Christopher Vanderberg', 500);
  await setCredit('Parker', 500);
  await setClock(AFTER_MS);
  clockMs = AFTER_MS;
  assert((await api.post('/api/admin/login', { data: { pin: PIN } })).ok(), 'organizer sign-in again');

  async function phone({ width = 390, scheme = 'light', signedIn = false, pct = 100 } = {}) {
    const ctx = await browser.newContext({ viewport: { width, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, colorScheme: scheme, userAgent: UA, reducedMotion: 'reduce' });
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
      { delta: clockMs - Date.now() },
    );
    await ctx.route('https://venmo.com/**', (r) => r.abort());
    if (signedIn) assert((await ctx.request.post(BASE + '/api/admin/login', { data: { pin: PIN }, headers: { Origin: BASE } })).ok(), 'sign-in');
    const page = await ctx.newPage();
    return { ctx, page, pct };
  }
  async function bigText(page, pct) {
    if (pct !== 100) await page.addStyleTag({ content: `html { font-size: ${pct}% !important; } body { font-size: ${(17 * pct) / 100}px !important; }` });
    await page.waitForTimeout(300);
  }
  const clip = async (page, root) => {
    const problems = await page.evaluate(findClipping, { root });
    assert(problems.length === 0, problems.slice(0, 6).join(' | '));
  };
  async function openSheet(page, sessionId) {
    const card = page.locator(`[data-finalize="${sessionId}"]`);
    await card.scrollIntoViewIfNeeded();
    await card.locator('[data-change-played]').click();
    await page.locator('dialog[open] [data-who-played]').waitFor({ timeout: 8000 });
    await page.waitForTimeout(400);
  }

  // ---------- 1. OFF: exactly main ----------
  await call('PUT', '/api/admin/extended-time-switch', { on: false });
  await check('switch OFF: the Finalize card says "Change who played" and opens the old list (no tiles, no EXTENDED TIME)', async () => {
    const { ctx, page } = await phone({ signedIn: true });
    // (The calm preview shows only the zip being built's cards; every card, as on live.)
    await page.goto(`${BASE}/admin?alerts=all`);
    await page.locator(`[data-finalize="${g4}"]`).waitFor({ timeout: 15000 });
    const label = (await page.locator(`[data-finalize="${g4}"] [data-change-played]`).innerText()).trim();
    assert(label === 'Change who played', `label: ${label}`);
    await openSheet(page, g4);
    assert((await page.locator('dialog[open] [data-who-played-tiles]').count()) === 0, 'no tiles sheet');
    assert((await page.locator('dialog[open] ul.who-played input[role="switch"]').count()) === 4, 'the old switch list');
    assert((await page.locator('dialog[open] .xt-seg').count()) === 0, 'no EXTENDED TIME');
    await ctx.close();
  });
  await call('PUT', '/api/admin/extended-time-switch', { on: true });

  // ---------- 2. ON: the card, the sheet ----------
  await check('ON: "Edit players / time"; the tiles sheet: 4 tiles, summary, None picked, +30 min line, tap a tile off', async () => {
    const { ctx, page } = await phone({ signedIn: true });
    await page.goto(`${BASE}/admin`);
    await page.locator(`[data-finalize="${g4}"]`).waitFor({ timeout: 15000 });
    const label = (await page.locator(`[data-finalize="${g4}"] [data-change-played]`).innerText()).trim();
    assert(label === 'Edit players / time', `label: ${label}`);
    const everyone = (await page.locator(`[data-finalize="${g4}"] [data-everyone-played]`).innerText()).trim();
    assert(everyone === 'Everyone played', `the shortcut stays: ${everyone}`);
    await page.screenshot({ path: path.join(SHOTS, 'zip31-finalize-card-light.png') });
    await openSheet(page, g4);
    const sheet = page.locator('dialog[open]');
    assert((await sheet.locator('.sheet-head h2').innerText()).trim() === 'Who played · Thu, Nov 12', `title: ${await sheet.locator('.sheet-head h2').innerText()}`);
    assert((await sheet.locator('.xt-tile').count()) === 4, 'four tiles');
    assert((await sheet.locator('.xt-tile.on .xt-check').count()) === 4, 'every tile checked');
    const you = await sheet.locator('[data-tile="Alex"]').innerText();
    assert(/Alex\s*\(you\)/.test(you), `Alex (you): ${you}`);
    assert((await sheet.locator('[data-finalize-live]').innerText()).replace(/\s+/g, ' ').trim() === '4 played · $14 each', `summary: ${await sheet.locator('[data-finalize-live]').innerText()}`);
    assert((await sheet.locator('.xt-seg [data-extra="0"]').getAttribute('aria-pressed')) === 'true', 'None picked');
    assert((await sheet.locator('[data-extra-split]').count()) === 0, 'no amber line with None');
    await sheet.locator('.xt-seg [data-extra="30"]').click();
    const l = (await sheet.locator('.xt-split-l').innerText()).trim();
    const r = (await sheet.locator('.xt-split-r').innerText()).trim();
    assert(l === '3 others pay $3 each' && r === 'You cover $3', `split: ${l} / ${r}`);
    await page.screenshot({ path: path.join(SHOTS, 'zip31-sheet-4-light.png') });
    // Off: dashed gray, no badge; numbers follow (3 played: $14, 2 others pay $4, you $4).
    await sheet.locator('[data-tile="Sage"]').click();
    const off = sheet.locator('[data-tile="Sage"]');
    assert((await off.getAttribute('aria-pressed')) === 'false', 'Sage off');
    assert((await off.locator('.xt-check').count()) === 0, 'no badge when off');
    const style = await off.evaluate((el) => getComputedStyle(el).borderTopStyle);
    assert(style === 'dashed', `dashed outline: ${style}`);
    const l2 = (await sheet.locator('.xt-split-l').innerText()).trim();
    assert(l2 === '2 others pay $4 each', `after toggling Sage off: ${l2}`);
    await sheet.locator('[data-tile="Sage"]').click();
    await ctx.close();
  });

  // ---------- 3. Strict clipping on the sheet: 4, 6, 10 players ----------
  const sizes = FULL ? [390, 360, 320] : [390];
  const schemes = FULL ? ['light', 'dark'] : ['light'];
  const pcts = FULL ? [100, 125, 150] : [100];
  for (const [n, sid] of [
    [4, g4],
    [6, g6],
    [10, g10],
  ]) {
    for (const width of sizes)
      for (const scheme of schemes)
        for (const pct of pcts)
          await check(`sheet with ${n} players, ${width} ${scheme} ${pct}%: nothing clipped, Confirm in view without scrolling`, async () => {
            const { ctx, page } = await phone({ width, scheme, signedIn: true });
            await page.goto(`${BASE}/admin`);
            await page.locator(`[data-finalize="${sid}"]`).waitFor({ timeout: 15000 });
            await bigText(page, pct);
            await openSheet(page, sid);
            await page.locator('dialog[open] .xt-seg [data-extra="60"]').click();
            await page.waitForTimeout(150);
            await clip(page, 'dialog[open]');
            const box = await page.locator('dialog[open] [data-confirm-played]').boundingBox();
            const vh = page.viewportSize().height;
            assert(box && box.y >= 0 && box.y + box.height <= vh + 0.5, `Confirm at ${box && Math.round(box.y)}..${box && Math.round(box.y + box.height)} of ${vh}`);
            // Every tile reachable: scrolled to, the last tile is fully in view and above Confirm.
            const last = page.locator('dialog[open] .xt-tile').last();
            await last.scrollIntoViewIfNeeded();
            await page.waitForTimeout(100);
            const lb = await last.boundingBox();
            const cb = await page.locator('dialog[open] [data-confirm-played]').boundingBox();
            assert(lb && cb && lb.y + lb.height <= cb.y + 1, `last tile ${Math.round(lb.y + lb.height)} under Confirm ${Math.round(cb.y)}`);
            if (width === 390 && pct === 100) await page.screenshot({ path: path.join(SHOTS, `zip31-sheet-${n}-${scheme}.png`) });
            await ctx.close();
          });
  }

  // ---------- 4. Confirm +30 min, then every screen that shows it ----------
  await check('Confirm with +30 min: the game is final, $12 extra court cost written, three $3 shares', async () => {
    const { ctx, page } = await phone({ signedIn: true });
    await page.goto(`${BASE}/admin`);
    await page.locator(`[data-finalize="${g4}"]`).waitFor({ timeout: 15000 });
    await openSheet(page, g4);
    await page.locator('dialog[open] .xt-seg [data-extra="30"]').click();
    await page.locator('dialog[open] [data-confirm-played]').click();
    // Undo on admin toasts: the save waits 5 seconds.
    await page.waitForTimeout(6500);
    await ctx.close();
    const dd = await call('GET', '/api/admin/dashboard');
    const rows = (dd.extensionOwed || []).filter((x) => x.sessionId === g4);
    // Sage owes $3; Parker and Christopher Vanderberg had credit, so theirs was paid at once (not on the owed list).
    assert(rows.length === 1 && rows[0].name === 'Sage' && rows[0].shareCents === 300 && rows[0].owedCents === 300, `owed: ${JSON.stringify(rows)}`);
    const cv = (await (await api.fetch('/api/group', { headers: { 'X-View-As': id['Christopher Vanderberg'] } })).json()).extension;
    assert(cv && cv.shares.length === 1 && cv.shares[0].shareCents === 300 && cv.shares[0].creditCents === 300 && cv.owedCents === 0, `CV: ${JSON.stringify(cv)}`);
    const act = await call('GET', '/api/admin/activity');
    assert(act.entries.some((e) => e.action === 'extension_set' && e.details.costCents === 1200 && e.details.organizerCents === 300), 'History: $12 court, you cover $3');
  });

  for (const scheme of ['light', 'dark'])
    for (const width of sizes)
      for (const pct of pcts)
        await check(`Home extension rows, ${width} ${scheme} ${pct}%: "$3 extension · Thu, Nov 12", Mark paid, nothing clipped`, async () => {
          const { ctx, page } = await phone({ width, scheme, signedIn: true });
          await page.goto(`${BASE}/admin`);
          await page.locator('[data-ext-owed]').waitFor({ timeout: 15000 });
          await bigText(page, pct);
          const sage = page.locator('[data-ext-owed] [data-ext-row="Sage"]');
          const text = (await sage.innerText()).replace(/\s+/g, ' ');
          assert(/Sage/.test(text) && /\$3 extension · Thu, Nov 12/.test(text) && /Mark paid/.test(text), `row: ${text}`);
          // The amount and the date are never cut with "...": the whole line is drawn.
          const what = sage.locator('.xt-what');
          const cut = await what.evaluate((el) => el.scrollWidth > el.clientWidth + 1 || getComputedStyle(el).textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth);
          assert(!cut, 'the "$3 extension · Thu, Nov 12" line is cut off');
          await clip(page, '[data-ext-owed]');
          if (width === 390 && pct === 100) {
            await page.locator('[data-ext-owed]').scrollIntoViewIfNeeded();
            await page.screenshot({ path: path.join(SHOTS, `zip31-home-rows-${scheme}.png`) });
          }
          await ctx.close();
        });

  const player = async (name, opts) => {
    const p = await phone(opts);
    await p.page.goto(`${BASE}/?as=${encodeURIComponent(name)}`);
    await p.page.locator('main').waitFor();
    await p.page.waitForTimeout(800);
    return p;
  };
  for (const scheme of ['light', 'dark'])
    for (const width of sizes)
      for (const pct of pcts)
        await check(`Sage (no credit), ${width} ${scheme} ${pct}%: the owe alert, "$17 due" with "incl. $3 extension", nothing clipped`, async () => {
          const { ctx, page } = await player('Sage', { width, scheme });
          await bigText(page, pct);
          const alert = page.locator('[data-ext-alert="owe"]');
          await alert.waitFor({ timeout: 10000 });
          const words = (await alert.locator('.xt-alert-text').innerText()).replace(/\s+/g, ' ').trim();
          assert(words === "You owe $3 for tonight's extra 30 min. It's added to your next game.", `alert: ${words}`);
          assert((await alert.locator('.xt-alert-text b').innerText()).trim() === '$3', 'the amount in bold');
          assert((await alert.locator('[data-ext-paynow]').innerText()).trim() === 'Pay now instead', 'Pay now instead');
          assert((await alert.locator('[data-dismiss]').count()) === 1, 'an X');
          // The game it rides on: the soonest coming game Sage owes for (the server picks it); exactly one card carries the note.
          assert((await page.locator('[data-ext-incl]').count()) === 1, 'one card with the note');
          const card = page.locator('article.sched', { has: page.locator('[data-ext-incl]') });
          await card.scrollIntoViewIfNeeded();
          const due = (await card.locator('[data-owe]').first().innerText()).replace(/\s+/g, ' ').trim();
          assert(/^\$17 due/.test(due), `next game: ${due}`);
          assert((await card.locator('[data-ext-incl]').innerText()).trim() === 'incl. $3 extension', 'the grey note');
          await clip(page, 'main');
          // One style for every alert (Alex, after the preview): the extension alert's text is the money card's line (size, weight), its link
          // the money card's "I paid" (size, weight), and every alert on the page has the same badge, X and padding.
          const look = await page.evaluate(() => {
            const cs = (el) => (el ? getComputedStyle(el) : null);
            const pick = (el, keys) => (el ? Object.fromEntries(keys.map((k) => [k, cs(el)[k]])) : null);
            const ext = document.querySelector('[data-ext-alert="owe"]');
            const money = document.querySelector('[data-pay-card]');
            const lh = parseFloat(cs(ext.querySelector('.xt-alert-text')).lineHeight);
            return {
              extText: pick(ext.querySelector('.xt-alert-text'), ['fontSize', 'fontWeight']),
              moneyText: pick(money && money.querySelector('.ac-sub'), ['fontSize', 'fontWeight']),
              extLink: pick(ext.querySelector('[data-ext-paynow]'), ['fontSize', 'fontWeight']),
              moneyLink: pick(money && money.querySelector('.ac-link'), ['fontSize', 'fontWeight']),
              lines: Math.round(ext.querySelector('.xt-alert-text').getBoundingClientRect().height / lh),
              cards: [...document.querySelectorAll('main .ac')].filter((a) => !a.closest('.viewas-banner')).map((a) => ({
                pad: cs(a).padding,
                icon: a.querySelector('.ac-icon') ? `${a.querySelector('.ac-icon').getBoundingClientRect().width}` : null,
                x: a.querySelector('.ac-x') ? `${a.querySelector('.ac-x').getBoundingClientRect().width}` : null,
                sub: [...a.querySelectorAll('.ac-sub')].map((x) => cs(x).fontSize),
                link: [...a.querySelectorAll('.ac-link')].map((x) => `${cs(x).fontSize}/${cs(x).fontWeight}`),
              })),
            };
          });
          if (look.moneyText) assert(JSON.stringify(look.extText) === JSON.stringify(look.moneyText), `text ${JSON.stringify(look.extText)} vs the money card ${JSON.stringify(look.moneyText)}`);
          if (look.moneyLink) assert(JSON.stringify(look.extLink) === JSON.stringify(look.moneyLink), `link ${JSON.stringify(look.extLink)} vs I paid ${JSON.stringify(look.moneyLink)}`);
          const same = (key) => new Set(look.cards.map((c) => c[key]).filter((x) => x !== null)).size <= 1;
          assert(same('pad') && same('icon') && same('x'), `alerts differ: ${JSON.stringify(look.cards.map((c) => [c.pad, c.icon, c.x]))}`);
          assert(new Set(look.cards.flatMap((c) => c.sub)).size <= 1, `alert lines differ: ${JSON.stringify(look.cards.map((c) => c.sub))}`);
          assert(new Set(look.cards.flatMap((c) => c.link)).size <= 1, `alert links differ: ${JSON.stringify(look.cards.map((c) => c.link))}`);
          if (pct === 100 && width >= 360) assert(look.lines <= 2, `the alert takes ${look.lines} lines`);
          if (width === 390 && pct === 100) {
            await page.evaluate(() => window.scrollTo(0, 0));
            await page.screenshot({ path: path.join(SHOTS, `zip31-player-alert-${scheme}.png`) });
            await card.scrollIntoViewIfNeeded();
            await card.screenshot({ path: path.join(SHOTS, `zip31-next-game-${scheme}.png`) });
          }
          await ctx.close();
        });

  await check('Pay now instead opens the Pay sheet for just $3; nothing clipped there (390 light and dark)', async () => {
    for (const scheme of ['light', 'dark']) {
      const { ctx, page } = await player('Sage', { scheme });
      await page.locator('[data-ext-paynow]').click();
      const sheet = page.locator('dialog[open]');
      await sheet.waitFor();
      await page.waitForTimeout(400);
      const title = (await sheet.locator('.sheet-head h2').innerText()).trim();
      assert(/^Pay .+ \$3$/.test(title), `title: ${title}`);
      await clip(page, 'dialog[open]');
      await page.screenshot({ path: path.join(SHOTS, `zip31-paynow-${scheme}.png`) });
      await ctx.close();
    }
  });

  for (const scheme of ['light', 'dark'])
    for (const width of sizes)
    await check(`Christopher Vanderberg (credit), ${width} ${scheme}: "Your $3 credit was used ..." in blue, the alert style, nothing clipped`, async () => {
      const { ctx, page } = await player('Christopher Vanderberg', { scheme, width });
      const alert = page.locator('[data-ext-alert="credit"]');
      await alert.waitFor({ timeout: 10000 });
      const words = (await alert.locator('.xt-alert-text').innerText()).replace(/\s+/g, ' ').trim();
      assert(words === "Your $3 credit was used for tonight's extra 30 min.", `alert: ${words}`);
      assert((await alert.getAttribute('data-alert-card')) === 'blue', 'blue (credit)');
      await clip(page, 'main');
      const st = await page.evaluate(() => {
        const a = document.querySelector('[data-ext-alert="credit"]');
        const other = [...document.querySelectorAll('main .ac')].find((x) => x !== a && !x.closest('.viewas-banner') && x.querySelector('.ac-sub'));
        const f = (el) => (el ? `${getComputedStyle(el).fontSize}/${getComputedStyle(el).fontWeight}/${getComputedStyle(el.closest('.ac')).padding}` : null);
        return { mine: f(a.querySelector('.xt-alert-text')), other: f(other && other.querySelector('.ac-sub')) };
      });
      if (st.other) assert(st.mine === st.other, `credit alert ${st.mine} vs another alert ${st.other}`);
      if (width === 390) {
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.screenshot({ path: path.join(SHOTS, `zip31-credit-full-${scheme}.png`) });
      }
      await ctx.close();
    });

  await check('View as (the demo copy): Pay on "$17 due", then the sheet\'s Venmo button, says "Demo, nothing saved" and the card reads paid; nothing is saved', async () => {
    const { ctx, page } = await phone({ signedIn: true });
    await page.goto(`${BASE}/admin`);
    await page.getByRole('button', { name: /View as/ }).first().click();
    await page.locator('dialog[open] .name-grid button', { hasText: 'Sage' }).click();
    await page.waitForTimeout(3500);
    const card = page.locator('article.sched', { has: page.locator('[data-ext-incl]') });
    await card.scrollIntoViewIfNeeded();
    await card.getByRole('link', { name: /Pay/ }).first().click();
    await page.locator('dialog[open] [data-pay-sheet]').waitFor();
    await page.locator('dialog[open] [data-pay-sheet] a.btn').first().click();
    await page.waitForTimeout(1500);
    const toasts = (await page.locator('.pop').allInnerTexts()).join(' | ');
    assert(/Demo, nothing saved/.test(toasts), `toast: ${toasts}`);
    assert((await page.locator('[data-ext-incl]').count()) === 0, 'the card reads paid on the copy');
    await ctx.close();
    // The real site: still owed.
    const g = await (await api.fetch('/api/group', { headers: { 'X-View-As': id.Sage } })).json();
    assert(g.extension.owedCents === 300, `real site untouched: ${g.extension.owedCents}`);
  });

  await check('the X closes the alert for good (on the server), and the debt stays', async () => {
    const { ctx, page } = await player('Sage', {});
    await page.locator('[data-ext-alert="owe"] [data-dismiss]').click();
    await page.waitForTimeout(800);
    await page.reload();
    await page.waitForTimeout(1200);
    assert((await page.locator('[data-ext-alert="owe"]').count()) === 0, 'gone after a reload');
    const card = page.locator('article.sched', { has: page.locator('[data-ext-incl]') });
    assert(/^\$17 due/.test((await card.locator('[data-owe]').first().innerText()).trim()), 'still $17 due');
    await ctx.close();
  });

  // Part credit: reopen and redo with +1 hr ($6 each): Parker's $5 credit covers $5, $1 more owed.
  await check('+1 hr after a Reopen: Parker sees the part-credit alert (light and dark)', async () => {
    await call('POST', `/api/admin/sessions/${g4}/reopen`, {});
    await call('POST', `/api/admin/sessions/${g4}/finalize`, { played: FOUR.map((n) => id[n]), extraMinutes: 60 });
    for (const scheme of ['light', 'dark']) {
      const { ctx, page } = await player('Parker', { scheme });
      const alert = page.locator('[data-ext-alert="credit"]');
      await alert.waitFor({ timeout: 10000 });
      const words = (await alert.locator('.xt-alert-text').innerText()).replace(/\s+/g, ' ').trim();
      assert(words === "$5 of your credit was used for tonight's extra 1 hr. You owe $1 more, added to your next game.", `alert: ${words}`);
      await clip(page, 'main');
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: path.join(SHOTS, `zip31-credit-part-${scheme}.png`) });
      await ctx.close();
    }
  });

  await browser.close();
  await api.dispose();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
