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
 *   P3  Drop out inside the 12 hours (5 in, so 3 left, one spot owed): "... If no one takes your spot, you still owe $14. Your guest's spot isn't needed."
 *       (Stay in / Drop out both); outside: "Your guest Sam drops out too. Both spots open up for someone else."
 *   P4  Remove guest on the paid card: "Remove Sam?" / "Sam comes off your tab. Sam's $14 goes to your credit." (Keep Sam / Remove Sam), then the
 *       card reads Paid $14 with three balls and the CREDIT chip shows $14
 *   P5  Parker sees the pair, his own name bold, and no Remove guest
 *   A1  organizer Home: the card names "Rowan + Sam (guest)" and has four balls
 *   A2  Players sheet (round 2): each host and guest one tinted group; Parker paid with Billy owing; Rowan and Sam each owe $14; "1 of 5 paid"
 *   A4  Mark paid on Sam's row pays Sam's $14 only; Didn't pay? undoes it.  C1  every confirm: two equal buttons, back-out in red outline
 *   W1  Who played: guest tiles, guest out and host out
 *   A3  Add a guest for Parker (Lee): the panel's words, the new row, Parker owes $28; then Remove guest on Lee's row; Remove Rowan's words
 *   S1  Settings: "Guest spot" is the top switch row
 *   R3  round 3: the three late scenes ("Late: 4 seats", "Late: host 4th", "Late: host 5th", next day 5:30 to 6:30 PM): Drop out says $28, $14 or
 *       nothing; Remove guest says the $14 stays owed only on the 4 seat game (light and dark)
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

  /** Alex (round 2): the two buttons of a confirm are exactly the same width; the backing-out one (danger) is a red outline on no fill. */
  const equalButtons = async (dlg, what, redOutline = true) => {
    const m = await dlg.locator('.btn-row.confirm-row > button').evaluateAll((els) =>
      els.map((e) => {
        const r = e.getBoundingClientRect();
        const cs = getComputedStyle(e);
        return { w: r.width, h: r.height, bg: cs.backgroundColor, bw: cs.borderTopWidth, bc: cs.borderTopColor, color: cs.color, out: e.classList.contains('confirm-out') };
      }),
    );
    assert(m.length === 2, `${what}: two buttons (${m.length})`);
    assert(Math.abs(m[0].w - m[1].w) <= 1 && Math.abs(m[0].h - m[1].h) <= 1, `${what}: widths ${m[0].w} vs ${m[1].w}, heights ${m[0].h} vs ${m[1].h}`);
    if (redOutline) {
      assert(m[1].out && m[1].bg === 'rgba(0, 0, 0, 0)' && m[1].bw === '2px' && m[1].bc === m[1].color, `${what}: the back-out button is a red outline: ${JSON.stringify(m[1])}`);
      assert(m[0].bg !== 'rgba(0, 0, 0, 0)', `${what}: the safe button is solid`);
    }
  };

  // ================================================================ player screens
  for (const scheme of ['light', 'dark'])
    for (const width of [390, 360, 320])
      await check(`P1 Rowan's card, unpaid ($28 due), ${width} ${scheme}`, async () => {
        const { ctx, page } = await playerPage('Rowan', { width, scheme });
        const c = card(page, gA.id);
        await c.scrollIntoViewIfNeeded();
        const names = flat(await c.locator('.names-line').first().innerText());
        assert(names === 'Rowan + Sam (guest), Parker + Billy (guest), Christopher', `names: ${names}`);
        assert((await c.locator('.names-line strong').allInnerTexts()).join('|') === 'Rowan|Sam', 'Rowan and his guest are bold');
        assert((await c.locator('.dots svg.ball, .dots .ball').count()) >= 5, 'five balls');
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
        // Round 3: "Guest test" has 5 in (Rowan + Sam, Parker + Billy, Christopher): Rowan and Sam leaving leaves 3, so only one spot is owed.
        [gA, "It's past the 7:30 AM cancel-by. Your guest Sam drops out too. If no one takes your spot, you still owe $14. Your guest's spot isn't needed."],
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
        await equalButtons(dlg, 'Drop out confirm');
        await page.screenshot({ path: path.join(SHOTS, `P3-drop-${g === gA ? 'inside' : 'outside'}-${scheme}.png`) });
        await dlg.locator('.btn-row button', { hasText: 'Stay in' }).click();
        await page.waitForTimeout(400);
      }
      await ctx.close();
    });

  // Round 3 (Alex): the three late scenes (next day 5:30, 6:00, 6:30 PM; the clock is inside each one's 12 hours). Drop out says what the game
  // is short (2 spots: $28, 1 spot: $14, none: nothing); Remove guest owes the $14 only when the game would drop below 4. Nothing is tapped.
  const late = ['Late: 4 seats', 'Late: host 4th', 'Late: host 5th'].map((note) => d.sessions.find((s) => s.note === note));
  assert(late.every(Boolean), 'the three round 3 late scenes are in the calm world');
  for (const scheme of ['light', 'dark'])
    await check(`R3 late Drop out and Remove guest words for 4 seats, host 4th, host 5th (${scheme})`, async () => {
      const { ctx, page } = await playerPage('Rowan', { scheme });
      const words = [
        [
          "It's past the 5:30 AM cancel-by. Your guest Sam drops out too. If no one takes your 2 spots, you still owe $28.",
          "It's past the 5:30 AM cancel-by and the game would drop below 4. If no one takes Sam's spot, you still owe $14.",
        ],
        [
          "It's past the 6:00 AM cancel-by. Your guest Sam drops out too. If no one takes your spot, you still owe $14. Your guest's spot isn't needed.",
          'Sam comes off your tab. You owe $14 less.',
        ],
        ["Your guest Sam drops out too. Both spots open up. You don't owe anything because the game still has 4 players.", 'Sam comes off your tab. You owe $14 less.'],
      ];
      for (const [i, g] of late.entries()) {
        const c = card(page, g.id);
        await c.scrollIntoViewIfNeeded();
        await insideCard(c, `${g.note} card`);
        for (const [link, want, keep, tag] of [
          ['.drop-link', words[i][0], 'Stay in', 'drop'],
          ['[data-remove-guest]', words[i][1], 'Keep Sam', 'remove'],
        ]) {
          await c.locator(link).click();
          const dlg = page.locator('dialog.sheet[open]').first();
          await dlg.waitFor();
          await page.waitForTimeout(350);
          const body = flat(await dlg.innerText());
          assert(body.includes(want), `${g.note} ${tag}: ${body}`);
          await equalButtons(dlg, `${g.note} ${tag} confirm`);
          await noSideScroll(page, `${g.note} ${tag}`);
          await page.screenshot({ path: path.join(SHOTS, `R3-${i + 1}-${tag}-${scheme}.png`) });
          await dlg.locator('.btn-row button', { hasText: keep }).click();
          await page.waitForTimeout(400);
        }
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
      await equalButtons(dlg, 'Remove Sam confirm');
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
    await check(`P5 Parker sees both pairs, his own pair bold (${scheme})`, async () => {
      const { ctx, page } = await playerPage('Parker', { scheme });
      const c = card(page, gA.id);
      await c.scrollIntoViewIfNeeded();
      assert(flat(await c.locator('.names-line').first().innerText()) === 'Rowan + Sam (guest), Parker + Billy (guest), Christopher', 'names');
      assert((await c.locator('.names-line strong').allInnerTexts()).join('|') === 'Parker|Billy', 'Parker and his own guest bold');
      // Parker is a host too (Billy): his card has Remove guest for Billy; Rowan's Sam is never his to remove.
      assert((await c.locator('[data-remove-guest]').count()) === 1, 'his own Remove guest');
      await c.screenshot({ path: path.join(SHOTS, `P5-parker-${scheme}.png`) });
      await ctx.close();
    });

  // ================================================================ organizer screens
  for (const scheme of ['light', 'dark'])
    await check(`A1 organizer Home: both pairs and five balls (${scheme})`, async () => {
      const { ctx, page } = await adminPage({ scheme });
      const c = page.locator(`article[id="session-${gA.id}"]`);
      await c.scrollIntoViewIfNeeded();
      const names = flat(await c.locator('.names-line').first().innerText());
      assert(/Rowan \+ Sam \(guest\)/.test(names) && /Parker \+ Billy \(guest\)/.test(names), `names: ${names}`);
      assert((await c.locator('.dots .ball, .dots svg.ball').count()) === 5, 'five balls');
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
      await check(`A2 Players sheet grouped: Parker paid with Billy owing, Rowan and Sam each owing, Add a guest only where none (${width} ${scheme})`, async () => {
        const { ctx, page } = await adminPage({ scheme, width });
        const dlg = await openSheet(page, gA.id);
        assert(/1 of 5 paid/.test(flat(await dlg.locator('[data-ps-summary]').innerText())), `people count: ${flat(await dlg.locator('[data-ps-summary]').innerText())}`);
        // Each pair is ONE group: the host on top, the guest under it.
        for (const [host, guest] of [['Parker', 'Billy'], ['Rowan', 'Sam']]) {
          const grp = dlg.locator(`[data-ps-pair="${host}"]`);
          const rows = (await grp.locator('.ps-row .ps-name').allInnerTexts()).map(flat);
          assert(rows.join('|') === `${host}|${guest}`, `${host}'s group: ${rows}`);
          const bg = await grp.evaluate((el) => getComputedStyle(el).backgroundColor);
          assert(bg !== 'rgba(0, 0, 0, 0)', `${host}'s group is tinted`);
        }
        const parker = dlg.locator('[data-ps-row="Parker"]');
        assert(flat(await parker.locator('[data-ps-paid-chip]').innerText()) === 'Paid $14', 'Parker: Paid $14');
        assert((await parker.locator('[data-ps-markpaid]').count()) === 0, 'Parker: no buttons');
        const billy = dlg.locator('[data-ps-guest="Billy"]');
        assert(flat(await billy.locator('[data-ps-guest-line]').innerText()) === 'Guest of Parker · Parker owes $14', await billy.locator('[data-ps-guest-line]').innerText());
        assert((await billy.locator('[data-ps-markpaid="Billy"]').count()) === 1, 'Billy: Mark paid');
        const rowan = dlg.locator('[data-ps-row="Rowan"]');
        assert(flat(await rowan.locator('[data-ps-owes-line]').innerText()) === 'Owes $14', await rowan.locator('[data-ps-owes-line]').innerText());
        const sam = dlg.locator('[data-ps-guest="Sam"]');
        assert(flat(await sam.locator('[data-ps-guest-line]').innerText()) === 'Guest of Rowan · Rowan owes $14', 'Sam line');
        await rowan.locator('.ps-dots').click();
        await page.waitForTimeout(250);
        assert((await dlg.locator('[data-ps-add-guest]').count()) === 0, 'Rowan has a guest: no Add a guest');
        await rowan.locator('.ps-dots').click();
        await page.waitForTimeout(200);
        await dlg.locator('[data-ps-row="Christopher Vanderberg"] .ps-dots').click();
        await page.waitForTimeout(250);
        assert((await dlg.locator('[data-ps-add-guest="Christopher Vanderberg"]').count()) === 1, 'Christopher: Add a guest');
        await dlg.locator('[data-ps-row="Christopher Vanderberg"] .ps-dots').click();
        await page.waitForTimeout(200);
        await dlg.locator('[data-ps-list]').screenshot({ path: path.join(SHOTS, `A2-grouped-${width}-${scheme}.png`) });
        await noSideScroll(page, 'Players sheet');
        await insideCard(dlg.locator('[data-ps-list]'), 'Players list');
        await ctx.close();
      });

  await check('A4 Mark paid on Sam (the guest): Sam paid, Rowan still owes; Didn\'t pay? on Sam puts it back', async () => {
    const { ctx, page } = await adminPage({ scheme: 'light' });
    let dlg = await openSheet(page, gA.id);
    await dlg.locator('[data-ps-markpaid="Sam"]').click();
    await page.waitForTimeout(1800);
    let r = (await dash()).sessions.find((x) => x.id === gA.id).roster.find((x) => x.name === 'Rowan');
    assert(r.guest.paid === true && r.guest.hostPaid === false && r.owesCents === 1400, `server: ${JSON.stringify(r.guest)} owes ${r.owesCents}`);
    dlg = page.locator('dialog.sheet[open]').first();
    await dlg.locator('[data-ps-guest="Sam"] [data-ps-paid-chip]').waitFor({ timeout: 8000 });
    assert(flat(await dlg.locator('[data-ps-row="Rowan"] [data-ps-owes-line]').innerText()) === 'Owes $14', 'Rowan still owes $14');
    await page.screenshot({ path: path.join(SHOTS, 'A4-sam-paid.png') });
    await dlg.locator('[data-ps-guest="Sam"] .ps-dots').click();
    await page.waitForTimeout(250);
    await dlg.locator('[data-ps-unpay="Sam"]').click();
    await page.waitForTimeout(1800);
    r = (await dash()).sessions.find((x) => x.id === gA.id).roster.find((x) => x.name === 'Rowan');
    assert(r.guest.paid === false && r.owesCents === 2800, 'Sam unpaid again');
    await ctx.close();
  });

  await check('A3 Add a guest for Christopher, then Remove guest; Remove Rowan says both shares go; equal buttons on each', async () => {
    const { ctx, page } = await adminPage({ scheme: 'dark' });
    let dlg = await openSheet(page, gA.id);
    await dlg.locator('[data-ps-row="Christopher Vanderberg"] .ps-dots').click();
    await page.waitForTimeout(250);
    await dlg.locator('[data-ps-add-guest="Christopher Vanderberg"]').click();
    const form = page.locator('[data-ps-guest-form]');
    await form.waitFor();
    await page.waitForTimeout(350);
    const words = flat(await page.locator('dialog.sheet[open]').last().innerText());
    assert(words.includes('Add a guest · Christopher Vanderberg') && words.includes("Guest's first name") && words.includes("Their $14 goes on Christopher Vanderberg's tab. Christopher Vanderberg will owe $28."), words);
    await equalButtons(page.locator('dialog.sheet[open]').last(), 'Add a guest panel', false);
    await form.locator('[data-ps-guest-input]').fill('lee');
    assert(flat(await form.locator('[data-ps-guest-add]').innerText()) === 'Add lee', 'button names the guest');
    await page.screenshot({ path: path.join(SHOTS, 'A3-add-panel-dark.png') });
    await form.locator('[data-ps-guest-add]').click();
    await page.waitForTimeout(1800);
    let g = (await dash()).sessions.find((s) => s.id === gA.id);
    const chris = g.roster.find((r) => r.name === 'Christopher Vanderberg');
    assert(chris.guest && chris.guest.name === 'Lee' && chris.owesCents === 2800, `server: ${JSON.stringify(chris.guest)} owes ${chris.owesCents}`);
    dlg = page.locator('dialog.sheet[open]').first();
    await dlg.locator('[data-ps-guest="Lee"]').waitFor({ timeout: 8000 });
    await page.screenshot({ path: path.join(SHOTS, 'A3-after-add-dark.png') });
    await dlg.locator('[data-ps-guest="Lee"] .ps-dots').click();
    await page.waitForTimeout(250);
    await dlg.locator('[data-ps-remove="Lee"]').click();
    const conf = page.locator('dialog.sheet[open]').last();
    await page.waitForTimeout(350);
    const t = flat(await conf.innerText());
    assert(t.includes('Remove Lee?') && t.includes("Lee comes off Christopher Vanderberg's tab. Christopher Vanderberg owes $14 less."), t);
    await equalButtons(conf, 'Remove Lee confirm');
    await page.screenshot({ path: path.join(SHOTS, 'A3-remove-guest-dark.png') });
    await conf.locator('.btn-row button', { hasText: 'Remove Lee' }).click();
    await page.waitForTimeout(1800);
    g = (await dash()).sessions.find((s) => s.id === gA.id);
    assert(!g.roster.find((r) => r.name === 'Christopher Vanderberg').guest, 'server: Lee is off');
    dlg = page.locator('dialog.sheet[open]').first();
    await dlg.locator('[data-ps-row="Rowan"] .ps-dots').click();
    await page.waitForTimeout(250);
    await dlg.locator('[data-ps-remove="Rowan"]').click();
    await page.waitForTimeout(350);
    const rm = flat(await page.locator('dialog.sheet[open]').last().innerText());
    assert(rm.includes("Sam is Rowan's guest, so Sam comes off too. Both $14 shares are removed.") && rm.includes('Remove both'), rm);
    await equalButtons(page.locator('dialog.sheet[open]').last(), 'Remove both confirm');
    await page.screenshot({ path: path.join(SHOTS, 'A3-remove-rowan-dark.png') });
    await ctx.close();
  });

  for (const scheme of ['light', 'dark'])
    for (const width of [390, 360, 320])
      await check(`C1 confirm buttons the same width (${width} ${scheme}): Drop out, Remove Sam, and the organizer's Remove`, async () => {
        const { ctx, page } = await playerPage('Rowan', { width, scheme });
        const c = card(page, gB.id);
        await c.scrollIntoViewIfNeeded();
        await c.locator('.drop-link').click();
        let dlg = page.locator('dialog.sheet[open]').first();
        await dlg.waitFor();
        await page.waitForTimeout(350);
        await equalButtons(dlg, `Drop out ${width}`);
        await dlg.locator('[data-confirm-safe]').click();
        await page.waitForTimeout(400);
        await c.locator('[data-remove-guest]').click();
        dlg = page.locator('dialog.sheet[open]').first();
        await dlg.waitFor();
        await page.waitForTimeout(350);
        await equalButtons(dlg, `Remove Sam ${width}`);
        await page.screenshot({ path: path.join(SHOTS, `C1-remove-sam-${width}-${scheme}.png`) });
        await ctx.close();
        const a = await adminPage({ scheme, width });
        const sheet = await openSheet(a.page, gA.id);
        await sheet.locator('[data-ps-row="Christopher Vanderberg"] .ps-dots').click();
        await a.page.waitForTimeout(250);
        await sheet.locator('[data-ps-remove="Christopher Vanderberg"]').click();
        await a.page.waitForTimeout(350);
        await equalButtons(a.page.locator('dialog.sheet[open]').last(), `organizer Remove ${width}`);
        await a.ctx.close();
      });

  await check('W1 Who played: a guest tile after the host; guest off = 1 share for the host; host off takes the guest off and dims it', async () => {
    const after = Date.parse('2026-11-14T03:30:00.000Z'); // Fri Nov 13, 10:30 PM Eastern: "Guest test" is over
    await fetch(`${BASE}/__dev/clock`, { method: 'POST', body: JSON.stringify({ atMs: after }) });
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, colorScheme: 'light', isMobile: true, hasTouch: true, userAgent: UA, reducedMotion: 'reduce' });
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
    }, after - Date.now());
    assert((await ctx.request.post(BASE + '/api/admin/login', { data: { pin: PIN }, headers: { Origin: BASE } })).ok(), 'login');
    const page = await ctx.newPage();
    // (The calm preview shows only this zip's cards; ?alerts=all shows every card, as on live.)
    await page.goto(BASE + '/admin?alerts=all');
    await page.locator(`[data-finalize="${gA.id}"] [data-change-played]`).waitFor({ timeout: 20000 });
    await page.locator(`[data-finalize="${gA.id}"] [data-change-played]`).click();
    const sheet = page.locator('dialog.sheet[open] [data-who-played]');
    await sheet.waitFor();
    await page.waitForTimeout(400);
    const tiles = (await sheet.locator('[data-tile]').evaluateAll((els) => els.map((e) => e.getAttribute('data-tile'))));
    assert(tiles.indexOf('Billy') === tiles.indexOf('Parker') + 1 && tiles.indexOf('Sam') === tiles.indexOf('Rowan') + 1, `guest right after host: ${tiles}`);
    assert(/Parker's guest/.test(await sheet.locator('[data-guest-tile="Billy"]').innerText()), 'Parker\'s guest under Billy');
    const live = async () => flat(await sheet.locator('[data-finalize-live]').innerText());
    assert(/^5 played/.test(await live()), await live());
    await sheet.locator('[data-guest-tile="Billy"]').click();
    await page.waitForTimeout(250);
    assert(/^4 played · \$14 each/.test(await live()), await live());
    assert(flat(await sheet.locator('[data-who-played-note]').innerText()) === "Billy didn't play. Parker pays for 1 share.", 'guest-out note');
    await page.screenshot({ path: path.join(SHOTS, 'W1-guest-out.png') });
    await sheet.locator('[data-guest-tile="Billy"]').click();
    await sheet.locator('[data-tile="Parker"]').click();
    await page.waitForTimeout(250);
    assert(/^3 played · \$14 each/.test(await live()), await live());
    assert(flat(await sheet.locator('[data-who-played-note]').innerText()) === "Parker didn't play, so Billy didn't either.", 'host-out note');
    assert((await sheet.locator('[data-guest-tile="Billy"]').getAttribute('aria-disabled')) === 'true', 'Billy is locked');
    await sheet.locator('[data-guest-tile="Billy"]').click({ force: true });
    await page.waitForTimeout(200);
    assert(/^3 played/.test(await live()), 'a locked guest cannot be turned on');
    await page.screenshot({ path: path.join(SHOTS, 'W1-host-out.png') });
    await ctx.close();
    await fetch(`${BASE}/__dev/clock`, { method: 'POST', body: JSON.stringify({ atMs: NOW_MS }) });
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
