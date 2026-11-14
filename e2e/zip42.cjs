/* Zip 42 "Guest spot": the organizer adds a guest (a plus one) to a player's sign-up (shared/guestSpot.ts, server/guestActions.ts).
 *
 *   node e2e/zip42.cjs      (also run by npm run test:e2e)
 *
 * The CALM small world (the default preview profile) on its own dev server, clock at Fri Nov 13 2026, 10:00 AM Eastern: "Guest test" is tonight
 * at 7:30 PM (inside its 12 hours) and "Guest paid" is Sun Nov 15 at 7:00 PM (outside). Both: Rowan + Sam (guest), Parker, Christopher Vanderberg.
 * Rowan owes $28 on the first and paid $28 on the second. The Guest spot row is on (the preview world has it on, like every row being built).
 *   P1  Rowan's card (390, 360, 320; light and dark): "Rowan + Sam (guest), Parker, Christopher", four balls, "$28 due", I paid, Remove guest,
 *       Drop out, nothing cut off or wider than the screen
 *   P2  the paid card: "Paid $28", Remove guest, Drop out
 *   P3  Drop out inside the 12 hours: "It's past the 7:30 AM cancel-by. Your guest Sam drops out too. If no one takes your 2 spots, you still owe $28."
 *       (Stay in / Drop out both); outside: "Your guest Sam drops out too. Both spots open up for someone else."
 *   P4  Remove guest on the paid card: "Remove Sam?" / "Sam comes off your tab. Sam's $14 goes to your credit." (Keep Sam / Remove Sam), then the
 *       card reads Paid $14 with three balls and the CREDIT chip shows $14
 *   P5  Parker sees the pair, his own name bold, and no Remove guest
 *   A1  organizer Home: the card names "Rowan + Sam (guest)" and has four balls
 *   A2  Players sheet: Rowan "Owes $28 (with Sam)", a Sam row "Guest of Rowan", Rowan's menu has no Add a guest, Parker's does
 *   A3  Add a guest for Parker (Lee): the panel's words, the new row, Parker owes $28; then Remove guest on Lee's row; Remove Rowan's words
 *   S1  Settings: "Guest spot" is the top switch row
 * Screenshots of every step: .data/zip42-shots (not in git).
 */
const { spawn, spawnSync } = require('node:child_process');
const { readFileSync, mkdirSync, rmSync } = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.E2E_PORT) || 5442;
const BASE = `http://localhost:${PORT}`;
const SEED_ISO = '2026-11-12T23:00:00.000Z'; // the world is built as of Thu Nov 12, 6:00 PM Eastern
const NOW_MS = Date.parse('2026-11-13T15:00:00.000Z'); // Fri Nov 13, 10:00 AM Eastern
const PIN = /PIN `(\d{6})`/.exec(readFileSync(path.join(ROOT, 'docs/PREVIEW_FAKE_DB.md'), 'utf8'))[1];
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const SHOTS = path.join(ROOT, '.data', 'zip42-shots');

let passed = 0;
let failed = 0;
async function check(name, fn) {
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

async function main() {
  const dbFile = path.join(ROOT, '.data', 'zip42.sqlite');
  mkdirSync(SHOTS, { recursive: true });
  rmSync(dbFile, { force: true });
  const seeded = spawnSync('npx', ['vite-node', 'scripts/load-small-local.ts', '--', dbFile, SEED_ISO, '--calm'], { cwd: ROOT, encoding: 'utf8' });
  if (seeded.status !== 0) throw new Error(`could not build the calm world: ${seeded.stderr || seeded.stdout}`);
  if (await fetch(`${BASE}/api/status`).then((r) => r.ok, () => false)) throw new Error(`port ${PORT} is already in use`);
  const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
    cwd: ROOT,
    env: { ...process.env, DEV_DB: dbFile, SETUP_TOKEN: 'zip42-setup-token-0123456789', DEV_CLOCK: '1', PREVIEW_CALM: 'on', LATE_FEES: 'on' },
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
  const setClock = () => fetch(`${BASE}/__dev/clock`, { method: 'POST', body: JSON.stringify({ atMs: NOW_MS }) });
  await setClock();
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

  // The organizer's API, for setup and reading back.
  const admin = await browser.newContext();
  assert((await admin.request.post(BASE + '/api/admin/login', { data: { pin: PIN }, headers: { Origin: BASE } })).ok(), 'admin login');
  const dash = async () => (await admin.request.get(BASE + '/api/admin/dashboard')).json();
  let d = await dash();
  const gA = d.sessions.find((s) => s.note === 'Guest test');
  const gB = d.sessions.find((s) => s.note === 'Guest paid');
  assert(gA && gB, 'the two Guest spot games are in the calm world');
  assert(d.guestSpot === true && d.guestSpotForAll === true, 'Guest spot is on in the preview world');
  const ids = Object.fromEntries(d.players.map((p) => [p.name, p.id]));
  const reseed = async () => {
    // Put the paid game back the way the seed made it (P4 and A3 change it).
    const g = (await dash()).sessions.find((s) => s.id === gB.id);
    const rowan = g.roster.find((r) => r.name === 'Rowan');
    if (!rowan.guest) assert((await admin.request.post(`${BASE}/api/admin/sessions/${gB.id}/guest`, { data: { playerId: ids.Rowan, name: 'Sam' }, headers: { Origin: BASE } })).ok(), 're-add Sam');
  };

  async function playerPage(who, { width = 390, scheme = 'light', height = 844 } = {}) {
    const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, colorScheme: scheme, isMobile: true, hasTouch: true, userAgent: UA, reducedMotion: 'reduce' });
    await shift(ctx);
    const page = await ctx.newPage();
    await page.goto(`${BASE}/?as=${encodeURIComponent(who)}`);
    await page.locator('.schedule article.sched').first().waitFor({ timeout: 30000 });
    await page.reload();
    await page.locator('.schedule article.sched').first().waitFor({ timeout: 30000 });
    await page.waitForTimeout(800);
    return { ctx, page };
  }
  async function adminPage({ width = 390, scheme = 'light', height = 844, url = '/admin' } = {}) {
    const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, colorScheme: scheme, isMobile: true, hasTouch: true, userAgent: UA, reducedMotion: 'reduce' });
    await shift(ctx);
    assert((await ctx.request.post(BASE + '/api/admin/login', { data: { pin: PIN }, headers: { Origin: BASE } })).ok(), 'admin login');
    const page = await ctx.newPage();
    await page.goto(BASE + url);
    await page.locator('article[data-r2-card]').first().waitFor({ timeout: 30000 });
    await page.waitForTimeout(600);
    return { ctx, page };
  }
  const card = (page, id) => page.locator(`article#row-${id}`);
  const noSideScroll = async (page, what) => {
    const w = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
    assert(w[0] <= w[1], `${what}: the page is wider than the screen (${w[0]} > ${w[1]})`);
  };
  /** Nothing inside `loc` is cut off on the right (a button or word poking out of the card). */
  const insideCard = async (loc, what) => {
    const bad = await loc.evaluate((el) => {
      const box = el.getBoundingClientRect();
      return [...el.querySelectorAll('button, a, .pchip, .names-line, p, span')]
        .filter((x) => x.getClientRects().length && x.getBoundingClientRect().right > box.right + 0.5)
        .map((x) => x.textContent.trim().slice(0, 40));
    });
    assert(bad.length === 0, `${what}: sticks out of the card: ${bad.join(' | ')}`);
  };

  // ================================================================ player screens
  for (const scheme of ['light', 'dark'])
    for (const width of [390, 360, 320])
      await check(`P1 Rowan's card, unpaid ($28 due), ${width} ${scheme}`, async () => {
        const { ctx, page } = await playerPage('Rowan', { width, scheme });
        const c = card(page, gA.id);
        await c.scrollIntoViewIfNeeded();
        const names = flat(await c.locator('.names-line').first().innerText());
        assert(names === 'Rowan + Sam (guest), Parker, Christopher', `names: ${names}`);
        assert((await c.locator('.names-line strong').allInnerTexts()).join('|') === 'Rowan|Sam', 'Rowan and his guest are bold');
        assert((await c.locator('.dots svg.ball, .dots .ball').count()) >= 4, 'four balls');
        assert(/\$28 due/.test(await c.locator('[data-owe]').innerText()), 'the chip says $28 due');
        const links = (await c.locator('.inline-links button, .inline-links a').allInnerTexts()).map(flat);
        assert(links.includes('Remove guest') && links.includes('Drop out'), `links: ${links}`);
        assert(links.indexOf('Remove guest') < links.indexOf('Drop out'), 'Remove guest before Drop out');
        await noSideScroll(page, 'player Home');
        await insideCard(c, 'Rowan card');
        await c.screenshot({ path: path.join(SHOTS, `P1-unpaid-${width}-${scheme}.png`) });
        await ctx.close();
      });

  for (const scheme of ['light', 'dark'])
    await check(`P2 the paid card: Paid $28, Remove guest, Drop out (${scheme})`, async () => {
      const { ctx, page } = await playerPage('Rowan', { scheme });
      const c = card(page, gB.id);
      await c.scrollIntoViewIfNeeded();
      assert(/Paid \$28/.test(await c.locator('[data-paid]').innerText()), await c.locator('[data-paid]').innerText());
      const links = (await c.locator('.inline-links button').allInnerTexts()).map(flat);
      assert(links.includes('Remove guest') && links.includes('Drop out'), `links: ${links}`);
      await insideCard(c, 'paid card');
      await c.screenshot({ path: path.join(SHOTS, `P2-paid-390-${scheme}.png`) });
      await ctx.close();
    });

  for (const scheme of ['light', 'dark'])
    await check(`P3 Drop out confirm, inside and outside the 12 hours (${scheme})`, async () => {
      const { ctx, page } = await playerPage('Rowan', { scheme });
      for (const [g, want] of [
        [gA, "It's past the 7:30 AM cancel-by. Your guest Sam drops out too. If no one takes your 2 spots, you still owe $28."],
        [gB, 'Your guest Sam drops out too. Both spots open up for someone else.'],
      ]) {
        const c = card(page, g.id);
        await c.scrollIntoViewIfNeeded();
        await c.locator('.drop-link').click();
        const dlg = page.locator('dialog.sheet[open]').first();
        await dlg.waitFor();
        await page.waitForTimeout(350);
        const body = flat(await dlg.innerText());
        assert(body.includes(want), `dialog: ${body}`);
        const buttons = (await dlg.locator('.btn-row button').allInnerTexts()).map(flat);
        assert(buttons.join('|') === 'Stay in|Drop out both', `buttons: ${buttons}`);
        await page.screenshot({ path: path.join(SHOTS, `P3-drop-${g === gA ? 'inside' : 'outside'}-${scheme}.png`) });
        await dlg.locator('.btn-row button', { hasText: 'Stay in' }).click();
        await page.waitForTimeout(400);
      }
      await ctx.close();
    });

  await check('P4 Remove guest on the paid card: the words, then $14 back as credit', async () => {
    for (const scheme of ['light', 'dark']) {
      const { ctx, page } = await playerPage('Rowan', { scheme });
      const c = card(page, gB.id);
      await c.scrollIntoViewIfNeeded();
      await c.locator('[data-remove-guest]').click();
      const dlg = page.locator('dialog.sheet[open]').first();
      await dlg.waitFor();
      await page.waitForTimeout(350);
      const text = flat(await dlg.innerText());
      assert(text.includes('Remove Sam?') && text.includes("Sam comes off your tab. Sam's $14 goes to your credit."), text);
      assert((await dlg.locator('.btn-row button').allInnerTexts()).map(flat).join('|') === 'Keep Sam|Remove Sam', 'Keep Sam / Remove Sam');
      await page.screenshot({ path: path.join(SHOTS, `P4-remove-sheet-${scheme}.png`) });
      if (scheme === 'light') {
        await dlg.locator('.btn-row button', { hasText: 'Keep Sam' }).click();
        await ctx.close();
        continue;
      }
      await dlg.locator('.btn-row button', { hasText: 'Remove Sam' }).click();
      await page.waitForTimeout(1500);
      await page.reload();
      await page.locator('.schedule article.sched').first().waitFor();
      await page.waitForTimeout(1500);
      const after = card(page, gB.id);
      await page.evaluate((id) => document.getElementById(`row-${id}`)?.scrollIntoView({ block: 'center' }), gB.id);
      assert(/Paid \$14/.test(await after.locator('[data-paid]').innerText()), 'Paid $14 now');
      assert(flat(await after.locator('.names-line').first().innerText()) === 'Rowan, Parker, Christopher', 'Sam is off the list');
      assert((await after.locator('[data-remove-guest]').count()) === 0, 'no Remove guest any more');
      const chip = flat(await page.locator('header').first().innerText());
      assert(/\$14/.test(chip), `credit chip: ${chip}`);
      await page.screenshot({ path: path.join(SHOTS, `P4-after-${scheme}.png`) });
      await ctx.close();
    }
    const g = (await dash()).sessions.find((s) => s.id === gB.id);
    const rowan = g.roster.find((r) => r.name === 'Rowan');
    assert(!rowan.guest && rowan.paymentAmountCents === 1400, 'server: no guest, paid $14');
    const pot = (await dash()).creditLedger.find((c) => c.playerId === ids.Rowan);
    assert(pot && pot.balanceCents === 1400, 'server: Rowan has $14 credit');
    await reseed();
  });

  for (const scheme of ['light', 'dark'])
    await check(`P5 Parker sees the pair, his own name bold, no guest buttons (${scheme})`, async () => {
      const { ctx, page } = await playerPage('Parker', { scheme });
      const c = card(page, gA.id);
      await c.scrollIntoViewIfNeeded();
      assert(flat(await c.locator('.names-line').first().innerText()) === 'Rowan + Sam (guest), Parker, Christopher', 'names');
      assert((await c.locator('.names-line strong').allInnerTexts()).join('|') === 'Parker', 'only Parker bold');
      assert((await c.locator('[data-remove-guest]').count()) === 0, 'no Remove guest');
      await c.screenshot({ path: path.join(SHOTS, `P5-parker-${scheme}.png`) });
      await ctx.close();
    });

  // ================================================================ organizer screens
  for (const scheme of ['light', 'dark'])
    await check(`A1 organizer Home: "Rowan + Sam (guest)" and four balls (${scheme})`, async () => {
      const { ctx, page } = await adminPage({ scheme });
      const c = page.locator(`article[id="session-${gA.id}"]`);
      await c.scrollIntoViewIfNeeded();
      const names = flat(await c.locator('.names-line').first().innerText());
      assert(/Rowan \+ Sam \(guest\)/.test(names), `names: ${names}`);
      assert((await c.locator('.dots .ball, .dots svg.ball').count()) === 4, 'four balls');
      await noSideScroll(page, 'organizer Home');
      await c.screenshot({ path: path.join(SHOTS, `A1-home-${scheme}.png`) });
      await ctx.close();
    });

  const openSheet = async (page, id) => {
    const cell = page.locator(`article[id="session-${id}"] [data-paid-cell]`);
    await cell.scrollIntoViewIfNeeded();
    await cell.click();
    await page.locator('dialog.sheet[open]').waitFor();
    await page.waitForTimeout(400);
    return page.locator('dialog.sheet[open]').first();
  };
  for (const scheme of ['light', 'dark'])
    for (const width of [390, 360, 320])
      await check(`A2 Players sheet: Owes $28 (with Sam), a guest row, Add a guest only for Parker (${width} ${scheme})`, async () => {
        const { ctx, page } = await adminPage({ scheme, width });
        const dlg = await openSheet(page, gA.id);
        const rowan = dlg.locator('[data-ps-row="Rowan"]');
        assert(flat(await rowan.locator('[data-ps-owes-line]').innerText()) === 'Owes $28 (with Sam)', await rowan.locator('[data-ps-owes-line]').innerText());
        const sam = dlg.locator('[data-ps-guest="Sam"]');
        assert(flat(await sam.locator('.ps-sub').innerText()) === 'Guest of Rowan', 'Guest of Rowan');
        const names = (await dlg.locator('.ps-row .ps-name').allInnerTexts()).map(flat);
        assert(names.indexOf('Sam') === names.indexOf('Rowan') + 1, `Sam right under Rowan: ${names}`);
        await rowan.locator('.ps-dots').click();
        await page.waitForTimeout(250);
        assert((await dlg.locator('[data-ps-add-guest]').count()) === 0, 'Rowan has a guest: no Add a guest');
        await page.screenshot({ path: path.join(SHOTS, `A2-rowan-menu-${width}-${scheme}.png`) });
        await rowan.locator('.ps-dots').click();
        await page.waitForTimeout(200);
        await dlg.locator('[data-ps-row="Parker"] .ps-dots').click();
        await page.waitForTimeout(250);
        assert((await dlg.locator('[data-ps-add-guest="Parker"]').count()) === 1, 'Parker: Add a guest');
        await page.screenshot({ path: path.join(SHOTS, `A2-parker-menu-${width}-${scheme}.png`) });
        await noSideScroll(page, 'Players sheet');
        await insideCard(dlg.locator('[data-ps-list]'), 'Players list');
        await ctx.close();
      });

  await check('A3 Add a guest for Parker, then Remove guest; Remove Rowan says both shares go', async () => {
    const { ctx, page } = await adminPage({ scheme: 'dark' });
    let dlg = await openSheet(page, gA.id);
    await dlg.locator('[data-ps-row="Parker"] .ps-dots').click();
    await page.waitForTimeout(250);
    await dlg.locator('[data-ps-add-guest="Parker"]').click();
    const form = page.locator('[data-ps-guest-form]');
    await form.waitFor();
    await page.waitForTimeout(350);
    const words = flat(await page.locator('dialog.sheet[open]').last().innerText());
    // (In the calm world Parker's seat is already paid, with credit from before: so "will owe $14 more". An unpaid host reads "will owe $28".)
    const parkerPaid = (await dash()).sessions.find((s) => s.id === gA.id).roster.find((r) => r.name === 'Parker').paymentStatus === 'paid';
    const owe = parkerPaid ? "Parker will owe $14 more." : 'Parker will owe $28.';
    assert(words.includes('Add a guest · Parker') && words.includes("Guest's first name") && words.includes(`Their $14 goes on Parker's tab. ${owe}`), words);
    await form.locator('[data-ps-guest-input]').fill('lee');
    assert(flat(await form.locator('[data-ps-guest-add]').innerText()) === 'Add lee', 'button names the guest');
    await page.screenshot({ path: path.join(SHOTS, 'A3-add-panel-dark.png') });
    await form.locator('[data-ps-guest-add]').click();
    await page.waitForTimeout(1800);
    let g = (await dash()).sessions.find((s) => s.id === gA.id);
    const parker = g.roster.find((r) => r.name === 'Parker');
    assert(parker.guest && parker.guest.name === 'Lee' && parker.owesCents === (parkerPaid ? 1400 : 2800), `server: ${JSON.stringify(parker.guest)} owes ${parker.owesCents}`);
    dlg = page.locator('dialog.sheet[open]').first();
    await dlg.locator('[data-ps-guest="Lee"]').waitFor({ timeout: 8000 });
    await page.screenshot({ path: path.join(SHOTS, 'A3-after-add-dark.png') });
    await dlg.locator('[data-ps-guest="Lee"] .ps-dots').click();
    await page.waitForTimeout(250);
    await dlg.locator('[data-ps-remove="Lee"]').click();
    const conf = page.locator('dialog.sheet[open]').last();
    await page.waitForTimeout(350);
    const t = flat(await conf.innerText());
    assert(t.includes('Remove Lee?') && t.includes("Lee comes off Parker's tab. Parker owes $14 less."), t);
    await page.screenshot({ path: path.join(SHOTS, 'A3-remove-guest-dark.png') });
    await conf.locator('.btn-row button', { hasText: 'Remove Lee' }).click();
    await page.waitForTimeout(1800);
    g = (await dash()).sessions.find((s) => s.id === gA.id);
    assert(!g.roster.find((r) => r.name === 'Parker').guest, 'server: Lee is off');
    dlg = page.locator('dialog.sheet[open]').first();
    await dlg.locator('[data-ps-row="Rowan"] .ps-dots').click();
    await page.waitForTimeout(250);
    await dlg.locator('[data-ps-remove="Rowan"]').click();
    await page.waitForTimeout(350);
    const rm = flat(await page.locator('dialog.sheet[open]').last().innerText());
    assert(rm.includes("Sam is Rowan's guest, so Sam comes off too. Both $14 shares are removed.") && rm.includes('Remove both'), rm);
    await page.screenshot({ path: path.join(SHOTS, 'A3-remove-rowan-dark.png') });
    await ctx.close();
  });

  await check('S1 Settings: Guest spot is the top switch row', async () => {
    const { ctx, page } = await adminPage({});
    await page.locator('.tabbar button', { hasText: 'Settings' }).click();
    await page.waitForTimeout(400);
    for (const s of await page.locator('details > summary').all()) await s.click().catch(() => {});
    const first = await page.locator('#switches [data-row], [data-switches-tidy] [data-row]').evaluateAll((els) => els.map((e) => e.getAttribute('data-row'))[0]);
    assert(first === 'guestSpotAll', `top row: ${first}`);
    assert(/Guest spot/.test(await page.locator('[data-row="guestSpotAll"]').innerText()), 'label');
    await ctx.close();
  });

  await browser.close();
  console.log(`\nzip42: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
main().catch((err) => {
  console.error(err);
  process.exit(1);
});
