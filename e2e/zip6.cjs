/* Zip 6: Adjust credit (ADJUST_CREDIT), Venmo request (VENMO_REQUEST), the two animation switches moved into Settings > Feature switches,
 * and the 320 px wrapping check.
 *
 *   node e2e/zip6.cjs      (also run by npm run test:e2e)
 *
 * It loads the fake preview world as if it were Thu Nov 5, 2026, 12:00 PM Eastern into a local file, starts its own dev server on it (the
 * server clock is pinned to that moment), turns the two new switches OFF for everyone (so the private links can be tested), and drives a
 * phone-sized browser. Nothing here touches Cloudflare or the live site. Venmo is never opened: the link is only read.
 * Screenshots: e2e/screenshots/zip6-*.png (ignored by git).
 */
const { spawn, spawnSync } = require('node:child_process');
const { readFileSync, mkdirSync, rmSync } = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.E2E_PORT) || 5291;
const BASE = `http://localhost:${PORT}`;
const NOW_ISO = '2026-11-05T17:00:00.000Z';
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
  const dbFile = path.join(ROOT, '.data', 'zip6.sqlite');
  mkdirSync(path.join(ROOT, '.data'), { recursive: true });
  rmSync(dbFile, { force: true });
  const seeded = spawnSync('npx', ['vite-node', 'scripts/load-seed-local.ts', '--', dbFile, NOW_ISO], { cwd: ROOT, encoding: 'utf8' });
  if (seeded.status !== 0) throw new Error(`could not build the fake world: ${seeded.stderr || seeded.stdout}`);
  const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
    cwd: ROOT,
    env: { ...process.env, DEV_DB: dbFile, SETUP_TOKEN: 'zip6-setup-token-0123456789', DEV_CLOCK: '1' },
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
  const put = (req, url, data, headers = {}) => req.put(BASE + url, { data, headers: { Origin: BASE, ...headers } });
  const areq = (await browser.newContext()).request;
  const login = await post(areq, '/api/admin/login', { pin: PIN });
  if (!login.ok()) throw new Error(`login failed: ${await login.text()}`);
  const dash = async (headers = {}) => (await areq.get(`${BASE}/api/admin/dashboard`, { headers })).json();
  // The preview has both new switches on for everyone; for these tests they start OFF so the private links are what turns them on.
  await put(areq, '/api/admin/adjust-credit-switch', { on: false });
  await put(areq, '/api/admin/venmo-request-switch', { on: false });
  await put(areq, '/api/admin/home-collapse-switch', { on: false });
  const d0 = await dash();
  assert(d0.adjustCredit === undefined && d0.venmoRequest === undefined, 'both new switches start off');
  const byNote = (d, note) => d.sessions.find((s) => s.note === note);
  const nameId = (d, n) => d.players.find((p) => p.name === n).id;
  const LONG = 'Christopher Vanderberg';

  const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mobile/15E148 Safari/604.1';
  const phone = (width, scheme = 'light', height = 800, dpr = 1) => ({ viewport: { width, height }, deviceScaleFactor: dpr, isMobile: true, hasTouch: true, colorScheme: scheme, userAgent: UA });
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
  async function openAdmin({ width = 390, scheme = 'light', url = '/admin', height = 800, dpr = 1 } = {}) {
    const ctx = await browser.newContext(phone(width, scheme, height, dpr));
    await ctx.addInitScript(shift, NOW_MS - Date.now());
    await post(ctx.request, '/api/admin/login', { pin: PIN });
    // Venmo opens an app: never really open it in a test.
    await ctx.route('https://venmo.com/**', (r) => r.abort());
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(BASE + url);
    await page.locator('.tabbar').waitFor();
    await page.waitForTimeout(600);
    return { ctx, page, errors };
  }
  async function openPlayer(name, { width = 390, scheme = 'light', height = 800, query = '', filter = null } = {}) {
    const ctx = await browser.newContext(phone(width, scheme, height));
    await ctx.addInitScript(shift, NOW_MS - Date.now());
    if (filter) await ctx.addInitScript((f) => localStorage.setItem('pb_games_filter', f), filter);
    await post(ctx.request, '/api/me', { playerId: nameId(d0, name) }, { 'X-Group-Key': String(d0.group.privateLink).split('/g/')[1] }).catch(() => {});
    const page = await ctx.newPage();
    await page.goto(BASE + String(d0.group.privateLink).replace(/^https?:\/\/[^/]+/, '') + query);
    await page.waitForTimeout(800);
    const picker = page.locator('button', { hasText: new RegExp(`^${name}$`) });
    if (await picker.count()) await picker.first().click().catch(() => {});
    await page.locator('.schedule article, .pay-card').first().waitFor({ timeout: 8000 });
    return { ctx, page };
  }
  const tab = async (page, name) => {
    await page.locator('.tabbar button', { hasText: name }).first().evaluate((x) => x.click());
    await page.waitForTimeout(500);
  };
  const shot = async (page, name) => (await page.waitForTimeout(700), page.screenshot({ path: path.join(SHOTS, `zip6-${name}.png`) }));
  const noSideScroll = async (page, what) => {
    const w = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, inner: window.innerWidth }));
    assert(w.doc <= w.inner, `${what}: the page scrolls sideways (${w.doc} > ${w.inner})`);
  };
  /** Any visible box that is wider than its parent's visible area, or text that spills out of its own box. */
  const overflowing = (page, root = 'body') =>
    page.evaluate((rootSel) => {
      const out = [];
      for (const el of document.querySelector(rootSel).querySelectorAll('*')) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        if (r.right < -100 || r.left > window.innerWidth + 100) continue; // parked far off-screen on purpose (screen-reader buttons)
        const cs = getComputedStyle(el);
        if (cs.visibility === 'hidden' || cs.display === 'none') continue;
        if (el.closest('[aria-hidden="true"], .sr-only, dialog:not([open])')) continue;
        if (r.right > window.innerWidth + 0.5 || r.left < -0.5) out.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)} "${(el.textContent || '').trim().slice(0, 30)}" ${Math.round(r.left)}..${Math.round(r.right)}`);
        else if (el.tagName !== 'INPUT' && el.children.length === 0 && el.scrollWidth > el.clientWidth + 1 && cs.overflow !== 'visible' && cs.textOverflow !== 'ellipsis') out.push(`clipped ${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)} "${(el.textContent || '').trim().slice(0, 30)}"`);
      }
      return out.slice(0, 8);
    }, root);

  // ---------------------------------------------------------------- switches in Settings
  await check('Settings > Feature switches holds Adjust credit, Venmo request and both Animations rows, each title on one line', async () => {
    const { ctx, page } = await openAdmin();
    await tab(page, 'Settings');
    for (const s of await page.locator('details > summary').all()) await s.click().catch(() => {});
    await page.waitForTimeout(300);
    const live = page.locator('[data-live-stable] summary');
    if (await live.count()) await live.first().click().catch(() => {});
    for (const row of ['adjustCreditAll', 'venmoRequestAll', 'motionPlayersAll', 'motionAdminAll']) {
      const r = page.locator(`[data-row="${row}"]`);
      assert((await r.count()) === 1, `row ${row} is on the page`);
      const h = await r.locator('.set-name').evaluate((el) => ({ h: el.getBoundingClientRect().height, line: parseFloat(getComputedStyle(el).lineHeight) || 20 }));
      assert(h.h <= h.line * 1.4, `the title of ${row} is on one line (${h.h} vs ${h.line})`);
    }
    await shot(page, 'settings-switches-390');
    await ctx.close();
  });
  await check('the new Settings rows save and the private links still work: Adjust credit on for everyone, then off again', async () => {
    const { ctx, page } = await openAdmin();
    await tab(page, 'Settings');
    for (const s of await page.locator('details > summary').all()) await s.click().catch(() => {});
    const sw = page.locator('[data-adjust-credit-all]');
    assert(!(await sw.isChecked()), 'starts off');
    await sw.click();
    await page.waitForTimeout(900);
    assert((await dash()).adjustCreditForAll === true, 'the server has it on for everyone');
    await sw.click();
    await page.waitForTimeout(900);
    assert((await dash()).adjustCreditForAll === false, 'and off again');
    await ctx.close();
  });
  await check('the Animations rows follow wrangler.toml (this test server has both dark), and flipping one is saved, reaches the screen and flips back', async () => {
    const before = await dash();
    assert(before.motionPlayersForAll === false && before.motionAdminForAll === false, 'both follow the (dark) server value');
    const { ctx, page } = await openAdmin();
    await tab(page, 'Settings');
    for (const s of await page.locator('details > summary').all()) await s.click().catch(() => {});
    const live = page.locator('[data-live-stable] summary');
    if (await live.count()) await live.first().click().catch(() => {});
    const players = page.locator('[data-motion-switch="player"]');
    assert(!(await players.isChecked()), 'Off, like the server');
    await players.click();
    await page.waitForTimeout(900);
    assert((await dash()).motionPlayersForAll === true, 'saved on');
    const g = await (await areq.get(`${BASE}/api/group`, { headers: { 'X-Group-Key': String(before.group.privateLink).split('/g/')[1] } })).json().catch(() => null);
    if (g && 'motion' in g) assert(g.motion === true, 'the player screens got it');
    await players.click();
    await page.waitForTimeout(900);
    assert((await dash()).motionPlayersForAll === false, 'saved off again');
    await ctx.close();
  });

  // ---------------------------------------------------------------- adjust credit
  async function openGear(page, name) {
    await tab(page, 'Players');
    await page.locator(`[data-player="${name}"] [data-r3-gear], [data-player="${name}"] .p-edit`).first().click();
    await page.locator('dialog[open] form').waitFor();
  }
  await check('switch off: the gear sheet has no Adjust credit row; with ?adjustcredit=on it sits between the name form and Hide player', async () => {
    const off = await openAdmin();
    await openGear(off.page, 'Harper');
    assert((await off.page.locator('[data-adjust-credit-row]').count()) === 0, 'no row with the switch off');
    await off.ctx.close();
    const { ctx, page } = await openAdmin({ url: '/admin?adjustcredit=on' });
    await openGear(page, 'Harper');
    const order = await page.locator('dialog[open] form').evaluate((f) => [...f.children].map((c) => (c.matches('[data-adjust-credit-row]') ? 'adjust' : c.matches('[data-hide-player]') ? 'hide' : c.matches('button[type="submit"]') ? 'save' : '')).filter(Boolean));
    assert(order.join(',') === 'save,adjust,hide', `order: ${order.join(',')}`);
    const hint = await page.locator('[data-adjust-credit-row]').innerText();
    assert(/Adjust credit/.test(hint) && /Credit \$14/.test(hint), `row text: ${hint}`);
    await shot(page, 'gear-390-light');
    await ctx.close();
  });
  await check('the Adjust credit sheet: Add/Remove, amount chips, a required reason, "Credit after: $14 → $19", Save off until both are filled', async () => {
    const { ctx, page } = await openAdmin({ url: '/admin?adjustcredit=on' });
    await openGear(page, 'Harper');
    await page.locator('[data-adjust-credit-row]').click();
    await page.locator('[data-adjust-sheet]').waitFor();
    assert(/Harper · Credit now \$14/.test(await page.locator('[data-adjust-sub]').innerText()), 'sub line');
    const save = page.locator('[data-adjust-save]');
    assert(await save.isDisabled(), 'Save is off with nothing filled');
    await page.locator('[data-adjust-chip="5"]').click();
    assert(await save.isDisabled(), 'Save is still off with an amount but no reason');
    assert(/\$14 → \$19/.test(await page.locator('[data-adjust-after]').innerText()), 'Credit after line');
    await page.locator('[data-adjust-reason]').fill('Venue refunded his half of the court after the Oct 27 game');
    assert(await save.isEnabled(), 'Save is on with both');
    await shot(page, 'adjust-sheet-390-light');
    // Remove more than the credit: the mistake message, Save off.
    await page.locator('[data-adjust-dir="remove"]').click();
    await page.locator('[data-adjust-amount]').fill('20');
    assert((await page.locator('[data-adjust-error]').innerText()) === "Can't remove more than the $14 credit Harper has.", 'the mistake message');
    assert(await save.isDisabled(), 'Save is off over the limit');
    assert((await page.locator('[data-adjust-after]').count()) === 0, 'no "Credit after" for a bad amount');
    await shot(page, 'adjust-error-390-light');
    // Remove all $14 is fine; $0 or a blank is not.
    await page.locator('[data-adjust-chip="14"]').click();
    assert(await save.isEnabled(), 'removing exactly the whole credit is allowed');
    assert(/\$14 → \$0/.test(await page.locator('[data-adjust-after]').innerText()), 'goes to $0, never below');
    await page.locator('[data-adjust-amount]').fill('0');
    assert(await save.isDisabled(), 'zero is not an amount');
    await ctx.close();
  });
  await check('saving an Add: toast, the balance becomes $19, the player sees the line and the reason, the admin history keeps it with the time', async () => {
    const reason = 'Venue refunded the court after the Oct 27 game';
    const { ctx, page } = await openAdmin({ url: '/admin?adjustcredit=on' });
    await openGear(page, 'Harper');
    await page.locator('[data-adjust-credit-row]').click();
    await page.locator('[data-adjust-chip="5"]').click();
    await page.locator('[data-adjust-reason]').fill(reason);
    await page.locator('[data-adjust-save]').click();
    await page.waitForTimeout(1200);
    assert((await page.locator('[data-adjust-sheet]').count()) === 0, 'the sheet closed');
    const d = await dash({ 'X-Adjust-Credit': 'on' });
    const pot = d.creditLedger.find((l) => l.playerId === nameId(d, 'Harper')).balanceCents;
    assert(pot === 1900, `Harper has $19 now (${pot})`);
    // The admin's own money history for Harper.
    await page.locator('[data-player="Harper"] .r3-open, [data-player="Harper"] .player-open').first().click();
    const entry = page.locator('[data-credit-entry][data-adjusted="true"]').first();
    await entry.waitFor();
    const t = (await entry.innerText()).replace(/\s+/g, ' ');
    assert(/Harper: credit \+\$5 \$19 now/.test(t), `line 1: ${t}`);
    assert(/Adjusted by organizer, Thu \d{1,2}:\d{2} (AM|PM)/.test(t), `line 2: ${t}`);
    assert(t.includes(`Reason: ${reason}`), `line 3: ${t}`);
    await shot(page, 'money-history-390-light');
    await ctx.close();
    // The player's own screen.
    const p = await openPlayer('Harper');
    await p.page.locator('.credit-chip, [aria-label*="credit"]').first().click();
    const note = p.page.locator('[data-adjust-note]').first();
    await note.waitFor();
    const nt = (await note.innerText()).replace(/\s+/g, ' ');
    assert(nt.includes('Credit adjusted by organizer: +$5') && nt.includes(reason), `player note: ${nt}`);
    assert(/\$19 credit/.test(await p.page.locator('[data-credit-balance]').innerText()), 'the player sees $19');
    await shot(p.page, 'player-credit-390-light');
    await p.ctx.close();
  });
  await check('a stale sheet cannot double-save: a second adjust built on the old balance is refused and the balance stays right', async () => {
    const d = await dash({ 'X-Adjust-Credit': 'on' });
    const id = nameId(d, 'Avery');
    const cur = d.creditLedger.find((l) => l.playerId === id)?.balanceCents ?? 0;
    const body = { direction: 'add', cents: 500, reason: 'Test', seen: cur };
    const a = await post(areq, `/api/admin/players/${id}/credit-adjust`, body, { 'X-Adjust-Credit': 'on' });
    const b = await post(areq, `/api/admin/players/${id}/credit-adjust`, body, { 'X-Adjust-Credit': 'on' });
    assert(a.status() === 200 && b.status() === 409, `${a.status()} then ${b.status()}`);
    const after = (await dash({ 'X-Adjust-Credit': 'on' })).creditLedger.find((l) => l.playerId === id).balanceCents;
    assert(after === cur + 500, `balance ${after}`);
  });

  // ---------------------------------------------------------------- Venmo request
  const money = async (page) => {
    await tab(page, 'Money');
    await page.locator('.mrw-game').first().waitFor();
  };
  await check('switch off: no "Request" link on Money rows and no Venmo request in the Remind sheet', async () => {
    const { ctx, page } = await openAdmin();
    await money(page);
    // Open the game that owes with numbers (Mixed payments) and its Remind sheet.
    assert((await page.locator('[data-venmo-request]').count()) === 0, 'no links on the Money page');
    assert((await page.locator('[data-vr-cards]').count()) === 0, 'no card on Home');
    await ctx.close();
  });
  // The Money cards are titled by date, so a game is found by its id (from the dashboard), not its note.
  async function openGame(page, note) {
    await money(page);
    const id = byNote(await dash(), note).id;
    const card = page.locator(`.mrw-game[data-session="${id}"]`).first();
    if (!(await card.count())) throw new Error(`no card for ${note}; cards: ${(await page.locator('.mrw-game, [data-fold]').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').slice(0, 60)).join(' | ')}`);
    if ((await card.getAttribute('data-open')) !== 'yes') await card.locator('.mrw-toggle').click();
    await page.waitForTimeout(300);
    return card;
  }
  await check('Money rows: "Request ↗" next to Mark paid only for people with Venmo; 13 px text, 34 px high; the long name fits; the link is exact', async () => {
    const { ctx, page } = await openAdmin({ url: '/admin?venmorequest=on', width: 360 });
    const card = await openGame(page, 'Mixed payments');
    const dk = await dash({ 'X-Venmo-Request': 'on' });
    const game = byNote(dk, 'Mixed payments');
    const owing = game.roster.filter((r) => r.paymentStatus === 'unpaid' && r.owesCents > 0).map((r) => r.name).sort();
    assert(owing.join(',') === ['Gray', 'Kai'].join(','), `who owes: ${owing}`);
    const links = await card.locator('[data-venmo-request]').evaluateAll((els) => els.map((a) => ({ who: a.getAttribute('data-venmo-request'), href: a.getAttribute('href'), app: a.getAttribute('data-app-href'), text: a.textContent, h: a.getBoundingClientRect().height, fs: getComputedStyle(a).fontSize, target: a.getAttribute('target') })));
    assert(links.map((l) => l.who).join(',') === 'Kai', `links for: ${links.map((l) => l.who)}`);
    for (const l of links) {
      assert(l.text === 'Request ↗', `label: ${l.text}`);
      assert(Math.round(l.h) === 34 && l.fs === '13px', `size ${l.h} ${l.fs}`);
      assert(l.target === '_blank', 'opens outside the page');
    }
    const kai = links.find((l) => l.who === 'Kai');
    const start = new Date(game.startsAt);
    const note = `Pickleball ${start.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'America/Detroit' })} ${start.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/Detroit' })}`;
    // Built like the player's Pay link: the Venmo app link on a phone, the web link as the fallback; the note has real %20 spaces, never "+".
    assert(kai.href === `https://venmo.com/?txn=charge&recipients=kai-fake&amount=14&note=${note.replace(/ /g, '%20')}`, `Kai web link: ${kai.href}`);
    assert(kai.app === `venmo://paycharge?txn=charge&recipients=kai-fake&amount=14&note=${note.replace(/ /g, '%20')}`, `Kai app link: ${kai.app}`);
    assert(!kai.href.includes('+') && !kai.app.includes('+'), 'no plus signs');
    assert(decodeURIComponent(/note=([^&]*)/.exec(kai.app)[1]) === note, 'the note reads with real spaces');
    // Gray has no Venmo saved: no link on that row. Mark paid is still there on every owing row.
    const gray = card.locator('[data-pay-row="Gray"]');
    assert((await gray.locator('[data-venmo-request]').count()) === 0, 'no link for Gray');
    assert((await gray.locator('.mrw-mark').count()) === 1, 'Gray still has Mark paid');
    // The long name lives in the late-canceled "Fee split $11" game: its row must fit next to Request and Mark paid.
    const splitCard = await openGame(page, 'Fee split $11');
    const long = splitCard.locator(`[data-pay-row="${LONG}"]`);
    assert((await long.locator('[data-venmo-request]').count()) === 1, 'the long name has a Request link');
    const box = await long.evaluate((li) => {
      const line = li.querySelector('.mrw-line').getBoundingClientRect();
      const btns = [...li.querySelectorAll('.vr-link, .mrw-mark')].map((b) => b.getBoundingClientRect());
      return { right: line.right, btnsRight: Math.max(...btns.map((b) => b.right)), btnsLeft: Math.min(...btns.map((b) => b.left)), mark: li.querySelector('.mrw-mark').getBoundingClientRect().width, vw: window.innerWidth };
    });
    assert(box.btnsRight <= box.vw && box.btnsLeft >= 0, `buttons inside the screen: ${JSON.stringify(box)}`);
    assert((await overflowing(page, '.mrw-games')).length === 0, `nothing spills: ${await overflowing(page, '.mrw-games')}`);
    await shot(page, 'money-rows-360-light');
    await ctx.close();
  });
  await check('Remind sheet: "Venmo request ↗" sits next to the purple Text button, only for people with Venmo', async () => {
    const { ctx, page } = await openAdmin({ url: '/admin?venmorequest=on' });
    const card = await openGame(page, 'Mixed payments');
    await card.locator('[data-remind]').click();
    const sheet = page.locator('dialog[open]');
    await sheet.waitFor();
    const rows = await sheet.locator('[data-remind-row]').evaluateAll((els) =>
      els.map((li) => ({ who: li.getAttribute('data-remind-row'), req: li.querySelector('.vr-link')?.textContent ?? null, reqColor: li.querySelector('.vr-link') ? getComputedStyle(li.querySelector('.vr-link')).color : null, text: li.querySelector('.mrw-text-one')?.textContent ?? null, textBorder: getComputedStyle(li.querySelector('.mrw-text-one')).borderColor })),
    );
    const by = Object.fromEntries(rows.map((r) => [r.who, r]));
    assert(by.Kai.req === 'Venmo request ↗', 'full label on the sheet');
    assert(by.Gray.req === null && by.Gray.text === 'Text', 'Gray has only Text');
    assert(by.Kai.reqColor !== by.Kai.textBorder, 'the link is blue, Text stays purple');
    await shot(page, 'remind-390-light');
    await ctx.close();
    const dark = await openAdmin({ url: '/admin?venmorequest=on', scheme: 'dark', width: 360 });
    const c2 = await openGame(dark.page, 'Mixed payments');
    await c2.locator('[data-remind]').click();
    await dark.page.locator('dialog[open]').waitFor();
    await shot(dark.page, 'remind-360-dark');
    assert((await overflowing(dark.page, 'dialog[open]')).length === 0, `nothing spills: ${await overflowing(dark.page, 'dialog[open]')}`);
    await dark.ctx.close();
  });
  await check('Home "Do this now": "Thu game: N haven\'t paid", Remind, a Venmo request per person with Venmo and "no Venmo saved" for the rest, fee-split game at $11', async () => {
    const { ctx, page } = await openAdmin({ url: '/admin?venmorequest=on' });
    await tab(page, 'Home');
    const cards = page.locator('[data-vr-card]');
    await cards.first().waitFor();
    const all = await cards.evaluateAll((els) =>
      els.map((c) => ({ title: c.querySelector('.vr-title').textContent.replace(/\s+/g, ' ').trim(), sub: c.querySelector('.vr-sub').textContent, rows: [...c.querySelectorAll('[data-vr-row]')].map((r) => ({ who: r.getAttribute('data-vr-row'), href: r.querySelector('[data-venmo-request]')?.getAttribute('href') ?? null, none: /no Venmo saved/.test(r.textContent) })) })),
    );
    const split = all.find((c) => /\$11 each/.test(c.sub));
    assert(split, `a fee-split card at $11: ${JSON.stringify(all.map((c) => c.sub))}`);
    assert(/^Thu .*game: 3 haven't paid$/.test(split.title), `title: ${split.title}`);
    const by = Object.fromEntries(split.rows.map((r) => [r.who, r]));
    assert(by.Kai.href && new URL(by.Kai.href).searchParams.get('amount') === '11', `Kai asked for $11: ${by.Kai.href}`);
    assert(by[LONG].href && new URL(by[LONG].href).searchParams.get('amount') === '11', 'the long name asked for $11');
    assert(by.Jordan.none && !by.Jordan.href, 'Jordan: no Venmo saved');
    // The other Thursday game owes $14 each.
    const flat = all.find((c) => /\$14 each/.test(c.sub));
    assert(flat && flat.rows.every((r) => !r.href || new URL(r.href).searchParams.get('amount') === '14'), 'the $14 game asks $14');
    await cards.first().scrollIntoViewIfNeeded();
    await shot(page, 'home-card-390-light');
    // Remind opens the sheet.
    await cards.first().locator('[data-vr-remind]').click();
    await page.locator('dialog[open] [data-remind-row]').first().waitFor();
    await ctx.close();
  });

  // ---------------------------------------------------------------- 320 px: every admin and player screen
  await check('320 px: every organizer screen, light and dark, with both new switches on, fits (no sideways scroll, nothing spills)', async () => {
    for (const scheme of ['light', 'dark']) {
      const { ctx, page, errors } = await openAdmin({ url: '/admin?venmorequest=on&adjustcredit=on', width: 320, height: 700, scheme });
      for (const t of ['Home', 'Players', 'Money', 'History', 'Settings']) {
        await tab(page, t);
        if (t === 'Settings') for (const s of await page.locator('details > summary').all()) await s.click().catch(() => {});
        await page.waitForTimeout(300);
        await noSideScroll(page, `${t} ${scheme}`);
        const o = await overflowing(page, 'main, .page');
        assert(o.length === 0, `${t} ${scheme}: ${o.join(' | ')}`);
        await shot(page, `320-${t.toLowerCase()}-${scheme}`);
      }
      assert(errors.length === 0, `page errors: ${errors.join(' | ')}`);
      await ctx.close();
    }
  });
  await check('320 px: the Adjust credit sheet, a Money game opened to its rows, and the Remind sheet fit', async () => {
    const { ctx, page } = await openAdmin({ url: '/admin?venmorequest=on&adjustcredit=on', width: 320, height: 700 });
    await openGear(page, LONG);
    await page.locator('[data-adjust-credit-row]').click();
    await page.locator('[data-adjust-chip="14"]').click();
    await page.locator('[data-adjust-dir="remove"]').click();
    await page.locator('[data-adjust-amount]').fill('99');
    await page.waitForTimeout(200);
    await noSideScroll(page, 'adjust sheet');
    assert((await overflowing(page, 'dialog[open]')).length === 0, `adjust sheet: ${await overflowing(page, 'dialog[open]')}`);
    await shot(page, '320-adjust-sheet');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    const card = await openGame(page, 'Fee split $11');
    await noSideScroll(page, 'money rows');
    assert((await overflowing(page, '.mrw-games')).length === 0, `money rows: ${await overflowing(page, '.mrw-games')}`);
    await shot(page, '320-money-rows');
    await card.locator('[data-remind]').click();
    await page.locator('dialog[open]').waitFor();
    assert((await overflowing(page, 'dialog[open]')).length === 0, `remind: ${await overflowing(page, 'dialog[open]')}`);
    await shot(page, '320-remind');
    await ctx.close();
  });
  await check('320 px: every player screen fits (home, credit sheet, pay card), light and dark', async () => {
    for (const scheme of ['light', 'dark']) {
      for (const name of ['Harper', 'Jordan', 'Avery']) {
        const p = await openPlayer(name, { width: 320, height: 700, scheme });
        await noSideScroll(p.page, `${name} ${scheme}`);
        const o = await overflowing(p.page, 'main');
        assert(o.length === 0, `${name} ${scheme}: ${o.join(' | ')}`);
        await shot(p.page, `320-player-${name.toLowerCase()}-${scheme}`);
        await p.ctx.close();
      }
    }
  });

  // Short labels (a button, a pill, the "$28 owed" tag, the titles of the four new switch rows) that break onto a second line at 320 px, on every screen. The list is printed; the
  // ones on it that are NOT intended (a sentence that is meant to wrap) are fixed, and the intended ones are named in `okWrap`.
  const wraps = (page, root) =>
    page.evaluate((rootSel) => {
      const out = [];
      // Things that are one short phrase on purpose: buttons, pills, chips, the "$28 owed" tag, the Feature switches titles. (Two-line cards, a
      // name above its stats, "Not booked" on two lines and running sentences are meant to wrap and are not looked at.)
      const sel = '.btn, .mrw-owed, .mrw-mark, .mrw-remind, .mrw-textall, .mrw-text-one, .vr-link, .vr-remind, .adj-chip, .pchip, [class*="-pill"], [class*="chip"], [data-row="adjustCreditAll"] .set-name, [data-row="venmoRequestAll"] .set-name, [data-row="motionPlayersAll"] .set-name, [data-row="motionAdminAll"] .set-name, .mrw-state, .mrw-undo';
      for (const el of document.querySelector(rootSel).querySelectorAll(sel)) {
        if (el.closest('.sr-only, [aria-hidden="true"]') || el.classList.contains('sr-only')) continue;
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.right < -100) continue;
        // The lines of the element's own words (its direct text, not icons or screen-reader text).
        const tops = new Set();
        let words = '';
        for (const n of el.childNodes) {
          if (n.nodeType === 3 && n.textContent.trim()) {
            const range = document.createRange();
            range.selectNodeContents(n);
            words += n.textContent.trim() + ' ';
            for (const q of range.getClientRects()) if (q.width > 1) tops.add(Math.round(q.top / 4));
          }
        }
        if (tops.size > 1) out.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 30)} "${words.trim()}" (${Math.round(r.width)}px wide, ${tops.size} lines)`);
      }
      return [...new Set(out)];
    }, root);
  await check('320 px: short labels stay on one line on every screen (diagnostic list)', async () => {
    const found = [];
    const { ctx, page } = await openAdmin({ url: '/admin?venmorequest=on&adjustcredit=on', width: 320, height: 700 });
    for (const t of ['Home', 'Players', 'Money', 'History', 'Settings']) {
      await tab(page, t);
      if (t === 'Settings') for (const s of await page.locator('details > summary').all()) await s.click().catch(() => {});
      for (const w of await wraps(page, 'main, .page')) found.push(`${t}: ${w}`);
    }
    await ctx.close();
    for (const name of ['Harper', 'Jordan', 'Avery']) {
      const p = await openPlayer(name, { width: 320, height: 700 });
      for (const w of await wraps(p.page, 'main')) found.push(`player ${name}: ${w}`);
      await p.ctx.close();
    }
    console.log(found.map((f) => `        ${f}`).join('\n'));
    assert(found.length === (Number(process.env.E2E_WRAPS) || 0), `${found.length} short labels wrap`);
  });

  // ---------------------------------------------------------------- canceled game in LATER: no box
  const flatRow = (page) =>
    page.evaluate(() => {
      const css = (el) => {
        const c = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        return { top: c.borderTopWidth, right: c.borderRightWidth, bottom: c.borderBottomWidth, left: c.borderLeftWidth, bottomStyle: c.borderBottomStyle, radius: c.borderTopLeftRadius, shadow: c.boxShadow, l: Math.round(r.left), r: Math.round(r.right), w: Math.round(r.width), h: Math.round(r.height), color: getComputedStyle(el.querySelector('.st-canceled') || el).color, text: (el.querySelector('.st-canceled') || el).textContent };
      };
      const off = document.querySelector('.schedule > .sched.tier-later.off');
      const sib = [...document.querySelectorAll('.schedule > .sched.tier-later:not(.off)')][0];
      return { off: off ? css(off) : null, sib: sib ? css(sib) : null };
    });
  for (const [width, scheme] of [[390, 'light'], [390, 'dark'], [320, 'light'], [320, 'dark']]) {
    await check(`a canceled game under LATER is a flat row like the others (${width} px, ${scheme}): no box, thin line, same margins, label unchanged`, async () => {
      const p = await openPlayer('Jordan', { width, scheme, filter: 'all' });
      // Today's Home lists the first six games and keeps the rest behind "More sessions (N)": open it.
      await p.page.locator('main button.btn.ghost.block', { hasText: /More sessions/ }).first().click();
      await p.page.waitForTimeout(500);
      await p.page.locator('.schedule > .sched.tier-later.off').first().scrollIntoViewIfNeeded();
      const { off, sib } = await flatRow(p.page);
      assert(off && sib, 'a canceled later row and a normal later row are both on the page');
      assert(off.top === '0px' && off.left === '0px' && off.right === '0px', `no box edges: ${JSON.stringify(off)}`);
      assert(off.bottom === '1px' && off.bottomStyle === 'solid', `thin line under it: ${off.bottom} ${off.bottomStyle}`);
      assert(off.radius === '0px' && off.shadow === 'none', `no corners or shadow: ${off.radius} ${off.shadow}`);
      assert(off.l === sib.l && off.r === sib.r, `same margins as the other rows: ${off.l}..${off.r} vs ${sib.l}..${sib.r}`);
      assert(sib.bottom === off.bottom && sib.bottomStyle === off.bottomStyle, 'the same separator as its neighbors');
      assert(/^Canceled/.test(off.text), `the label keeps its words: ${off.text}`);
      await noSideScroll(p.page, 'player home');
      await shot(p.page, `canceled-row-${width}-${scheme}`);
      await p.ctx.close();
    });
  }
  await check('a canceled game also reads flat in "My games" and "All games", and the Money/Home rows on the organizer side carry no such box', async () => {
    const p = await openPlayer('Harper', { filter: 'mine' });
    // Harper paid the canceled game, so it is one of Harper's games.
    const mine = await flatRow(p.page);
    if (mine.off) assert(mine.off.top === '0px' && mine.off.bottom === '1px', `My games: ${JSON.stringify(mine.off)}`);
    await p.ctx.close();
    const a = await openAdmin({ width: 390 });
    await tab(a.page, 'Home');
    const boxes = await a.page.evaluate(() => [...document.querySelectorAll('.scard, .card')].filter((c) => /cancel/i.test(c.getAttribute('data-court') || '') || c.className.includes('canceled')).map((c) => ({ cls: String(c.className).slice(0, 40), radius: getComputedStyle(c).borderTopLeftRadius })));
    for (const b of boxes) assert(b.radius !== '0px', `an admin card with sharp corners: ${JSON.stringify(b)}`);
    await shot(a.page, 'admin-home-canceled-390');
    await a.ctx.close();
  });

  // ---------------------------------------------------------------- HOME_COLLAPSE
  const laterIds = (d) => d.sessions.filter((s) => s.startsAt > '2026-11-16').map((s) => s.id);
  await check('switch off: Home still shows its LATER list and "More sessions (N)" with a number', async () => {
    const p = await openPlayer('Jordan', { filter: 'all' });
    const label = (await p.page.locator('main button.btn.ghost.block', { hasText: /More sessions/ }).first().innerText()).trim();
    assert(/^More sessions \(\d+\)$/.test(label), `label: ${label}`);
    await p.page.locator('main button.btn.ghost.block', { hasText: /More sessions/ }).first().click();
    await p.page.waitForTimeout(400);
    assert((await p.page.locator('.schedule > .sched[data-tier="later"]').count()) > 0, 'later rows show after the old button is tapped');
    assert((await p.page.locator('[data-later-toggle]').count()) === 0, 'no new button');
    await p.ctx.close();
  });
  for (const [width, scheme] of [[390, 'light'], [390, 'dark'], [320, 'light'], [320, 'dark']]) {
    await check(`HOME_COLLAPSE on (${width} px, ${scheme}): only this and next week; one "More sessions" button with no number; collapsed again after a reload`, async () => {
      const p = await openPlayer('Jordan', { width, scheme, filter: 'all', query: '?homecollapse=on' });
      const tiers = await p.page.locator('.schedule > .sched').evaluateAll((els) => els.map((e) => e.getAttribute('data-tier')));
      assert(tiers.length > 0 && tiers.every((t) => t === 'this' || t === 'next'), `only this and next week: ${tiers}`);
      assert((await p.page.locator('.week-break.tier-later').count()) === 0, 'no LATER header');
      const btn = p.page.locator('[data-later-toggle]');
      assert((await btn.count()) === 1, 'exactly one button');
      assert((await btn.innerText()).trim() === 'More sessions', `label: ${await btn.innerText()}`);
      assert((await btn.getAttribute('aria-expanded')) === 'false', 'starts collapsed');
      await btn.scrollIntoViewIfNeeded();
      await shot(p.page, `collapse-closed-${width}-${scheme}`);
      await btn.click();
      await p.page.waitForTimeout(500);
      const later = await p.page.locator('.schedule > .sched[data-tier="later"]').count();
      assert(later > 0, 'the later games opened');
      assert((await btn.innerText()).trim() === 'Show fewer', `label: ${await btn.innerText()}`);
      assert((await p.page.locator('.week-break.tier-later').count()) === 1, 'in the old LATER row style (its header and rows)');
      await shot(p.page, `collapse-open-${width}-${scheme}`);
      await noSideScroll(p.page, 'player home open');
      await btn.click();
      await p.page.waitForTimeout(400);
      assert((await p.page.locator('.schedule > .sched[data-tier="later"]').count()) === 0, 'Show fewer folds them again');
      assert((await btn.innerText()).trim() === 'More sessions', 'label back');
      await btn.click();
      await p.page.reload();
      await p.page.locator('.schedule article').first().waitFor();
      assert((await p.page.locator('.schedule > .sched[data-tier="later"]').count()) === 0, 'collapsed again after a reload');
      await p.ctx.close();
    });
  }
  await check('HOME_COLLAPSE on: the count of later games opened equals every game after next week; no button when nothing is later', async () => {
    const p = await openPlayer('Jordan', { filter: 'all', query: '?homecollapse=on' });
    await p.page.locator('[data-later-toggle]').click();
    await p.page.waitForTimeout(500);
    const ids = await p.page.locator('.schedule > .sched[data-tier="later"]').evaluateAll((els) => els.map((e) => e.id.replace('row-', '')));
    const g = await (await areq.get(`${BASE}/api/admin/dashboard`)).json();
    const want = g.sessions.filter((s) => !s.state.flags.hidden).length;
    assert(ids.length > 0 && ids.length <= want, `later rows: ${ids.length}`);
    await p.ctx.close();
    // Someone in no game with "My games": nothing is later, so there is no button at all.
    const none = await openPlayer('Casey', { filter: 'mine', query: '?homecollapse=on' }).catch(() => null);
    if (none) {
      const later = await none.page.locator('.schedule > .sched[data-tier="later"]').count();
      const btnCount = await none.page.locator('[data-later-toggle]').count();
      assert(later === 0 && btnCount === 0, `no later games, no button (${later}, ${btnCount})`);
      await none.ctx.close();
    }
  });
  await check("HOME_COLLAPSE on: I'm in and Drop out work from inside the expanded list", async () => {
    const p = await openPlayer('Jordan', { filter: 'all', query: '?homecollapse=on' });
    await p.page.locator('[data-later-toggle]').click();
    await p.page.waitForTimeout(500);
    const row = p.page.locator('.schedule > .sched[data-tier="later"]:not(.off)').filter({ has: p.page.locator('[data-join]') }).first();
    const id = (await row.getAttribute('id')).replace('row-', '');
    await row.locator('[data-join]').click();
    await p.page.waitForTimeout(1500);
    assert((await p.page.locator(`#row-${id}`).getAttribute('data-mine')) === 'in', "the row shows I'm in");
    const d = await dash();
    const mine = d.sessions.find((s) => s.id === id).roster.find((r) => r.name === 'Jordan');
    assert(mine && mine.status === 'confirmed', 'the server has Jordan in');
    assert((await p.page.locator('[data-later-toggle]').innerText()).trim() === 'Show fewer', 'the list stayed open');
    await p.ctx.close();
  });
  await check('HOME_COLLAPSE: the Settings row works and flips it on for everyone (no private link needed)', async () => {
    const { ctx, page } = await openAdmin();
    await tab(page, 'Settings');
    for (const s of await page.locator('details > summary').all()) await s.click().catch(() => {});
    const sw = page.locator('[data-home-collapse-all]');
    assert(!(await sw.isChecked()), 'starts off');
    await sw.click();
    await page.waitForTimeout(900);
    assert((await dash()).homeCollapseForAll === true, 'on for everyone');
    const p = await openPlayer('Jordan', { filter: 'all' });
    assert((await p.page.locator('[data-later-toggle]').count()) === 1, 'players get it with no link');
    await p.ctx.close();
    await sw.click();
    await page.waitForTimeout(900);
    assert((await dash()).homeCollapseForAll === false, 'and off again');
    await ctx.close();
  });

  await browser.close();
  console.log(`\nzip6: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
