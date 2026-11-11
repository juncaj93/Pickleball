/* "Late-cancel fee split" (LATE_FEE_SPLIT, Nov 2026) in a real browser.
 *
 *   node e2e/late-fee-split.cjs      (also run by npm run test:e2e)
 *
 * Off (the ship state): a late cancel with the fee kept is $14 each, as before. /admin?latefeesplit=on (with late fees on) splits
 * that phone's cancel; Settings > Feature switches > "Late-cancel fee split" for everyone. 6 in (Alex + 5): the cancel sheet says
 * $9, the Heads up text says "your $9 share", the three unpaid owe $9, the paid get $5 back as credit, Alex covers $3.
 * 320, 360 and 430 px, light and dark. Starts its own dev server with a fresh fake group and a fake clock.
 */
const { spawn } = require('node:child_process');
const { rmSync, mkdirSync } = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.E2E_PORT) || 5331;
const BASE = `http://localhost:${PORT}`;
const SETUP_TOKEN = 'latefeesplit-setup-token-0123456789';
const PIN = '483921';
const NAMES = ['Alex', 'Ryan', 'Julian', 'Nathan', 'Mitchel', 'Brandon', 'Devon', 'Casey'];
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

let passed = 0;
let failed = 0;
async function check(name, fn) {
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
const squash = (t) => String(t || '').replace(/\s+/g, ' ').trim();

async function main() {
  const dbFile = path.join(ROOT, '.data', 'latefeesplit.sqlite');
  mkdirSync(path.join(ROOT, '.data'), { recursive: true });
  rmSync(dbFile, { force: true });
  if (await fetch(`${BASE}/api/status`).then((r) => r.ok, () => false)) throw new Error(`port ${PORT} is already in use`);
  const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
    cwd: ROOT,
    env: { ...process.env, DEV_DB: dbFile, SETUP_TOKEN, DEV_CLOCK: '1', LATE_FEES: '', TEXTS_R2: '', LATE_FEE_SPLIT: '', MOTION: '', TELEGRAM_BOT_TOKEN: '', TELEGRAM_CHAT_ID: '' },
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
    await new Promise((r) => setTimeout(r, 500));
  }
  const setClock = (atMs) => fetch(`${BASE}/__dev/clock`, { method: 'POST', body: JSON.stringify({ atMs }) });
  await setClock(Date.now());

  const browser = await chromium.launch();
  const post = (req, url, data, headers = {}) => req.post(BASE + url, { data, headers: { Origin: BASE, ...headers } });
  const put = (req, url, data) => req.put(BASE + url, { data, headers: { Origin: BASE } });
  const setup = (await browser.newContext()).request;
  const made = await post(setup, '/api/setup', {
    setupToken: SETUP_TOKEN,
    groupName: 'Pickleball',
    pin: PIN,
    venmoUrl: 'https://venmo.com/u/organizer',
    players: NAMES.map((name, i) => ({ name, phone: `24855508${String(i).padStart(2, '0')}` })),
  });
  if (!made.ok()) throw new Error(`setup failed: ${await made.text()}`);
  const areq = (await browser.newContext()).request;
  await post(areq, '/api/admin/login', { pin: PIN });
  await put(areq, '/api/admin/group', { organizerName: 'Alex' });
  let d = await (await areq.get(`${BASE}/api/admin/dashboard`)).json();
  for (const h of d.hiddenSessions || []) await post(areq, `/api/admin/sessions/${h.id}/show`, { shown: true });
  d = await (await areq.get(`${BASE}/api/admin/dashboard`)).json();
  const idOf = (n) => d.players.find((p) => p.name === n).id;
  const phones = {};
  for (const n of NAMES) {
    const c = await browser.newContext();
    await post(c.request, '/api/me', { playerId: idOf(n) });
    phones[n] = c.request;
  }
  const join = (n, id) => post(phones[n], `/api/sessions/${id}/join`, {});
  const dash = async () => (await areq.get(`${BASE}/api/admin/dashboard`)).json();
  /** An extra game `hours` from the fake clock, on a quarter hour. */
  const addGameIn = async (hours, note) => {
    const now = Date.parse((await dash()).now);
    const start = Math.ceil((now + hours * 3600_000) / 900_000) * 900_000;
    const r = await post(areq, '/api/admin/sessions', { startsAt: new Date(start).toISOString(), endsAt: new Date(start + 2 * 3600_000).toISOString(), note });
    assert(r.ok(), `add game: ${await r.text()}`);
    return (await r.json()).id;
  };

  const phone = (scheme = 'light', width = 390) => ({ viewport: { width, height: 852 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, colorScheme: scheme, userAgent: UA });
  async function openAdmin({ width = 390, scheme = 'light', query = '' } = {}) {
    const ctx = await browser.newContext(phone(scheme, width));
    await post(ctx.request, '/api/admin/login', { pin: PIN });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/admin${query}`);
    await page.locator('article.scard, article.card').first().waitFor();
    return { ctx, page };
  }
  const noSideScroll = async (page, what) => {
    const [sw, cw] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
    assert(sw <= cw + 1, `${what}: the page scrolls sideways: ${sw} > ${cw}`);
  };
  const dialogText = async (page) => squash(await page.locator('dialog[open]').innerText());
  /** Open the gear menu of the card that holds `note`, and return it. */
  async function gearOf(page, note) {
    const gear = page.getByRole('button', { name: /^Game menu for / }).filter({ visible: true });
    const n = await gear.count();
    for (let i = 0; i < n; i++) {
      const owner = await gear.nth(i).evaluate((b) => b.closest('article')?.textContent || '');
      if (!owner.includes(note)) continue;
      await gear.nth(i).click();
      return;
    }
    throw new Error(`no gear on the card with ${note}`);
  }
  async function gearPick(page, note, name) {
    await gearOf(page, note);
    await page.getByRole('menuitem', { name }).first().click();
  }

  let lateHours = 2;
  /** A booked game about 2 hours out (inside the 12 hours), Alex in plus `names`; `paid` marked paid by Alex. */
  const lateGame = async (note, names, paid) => {
    const id = await addGameIn((lateHours += 0.25), note);
    await post(areq, `/api/admin/sessions/${id}/court-status`, { status: 'booked' });
    await post(areq, `/api/admin/sessions/${id}/me`, { in: true });
    for (const n of names) await join(n, id);
    for (const n of paid) assert((await post(areq, `/api/admin/sessions/${id}/payment`, { playerId: idOf(n), paid: true })).ok(), `pay ${n}`);
    return id;
  };
  const potOf = async (n) => (await (await phones[n].get(`${BASE}/api/group`)).json()).credit.balanceCents;
  const owedOf = async (n, id) => ((await (await phones[n].get(`${BASE}/api/group`)).json()).owed.find((o) => o.sessionId === id) || { amountCents: 0 }).amountCents;
  const FIVE = ['Ryan', 'Julian', 'Nathan', 'Mitchel', 'Brandon'];

  for (const [scheme, width] of [
    ['light', 320],
    ['light', 360],
    ['dark', 430],
  ]) {
    await check(`${scheme} ${width}px: Settings > Feature switches has "Late-cancel fee split", off at ship, title on one line, no sideways scroll; it saves with no deploy`, async () => {
      const { ctx, page } = await openAdmin({ scheme, width });
      await page.locator('nav.tabbar').getByRole('button', { name: /^Settings/ }).click();
      const sect = page.locator('details.set-sect', { hasText: 'Feature switches' });
      await sect.waitFor();
      await sect.locator('summary').click();
      const sw = sect.locator('[data-late-fee-split-all]');
      assert((await sw.count()) === 1, 'switch row missing');
      assert((await sw.isChecked()) === false, 'switch is on at ship');
      const name = sect.locator('[data-row="lateFeeSplitAll"] .set-name');
      const lines = await name.evaluate((el) => {
        const lh = parseFloat(getComputedStyle(el).lineHeight) || parseFloat(getComputedStyle(el).fontSize) * 1.3;
        return el.getBoundingClientRect().height / lh;
      });
      assert(lines < 1.6, `the title wraps (${lines.toFixed(2)} lines)`);
      assert(/^Late-cancel fee split/.test(squash(await name.innerText())), `title: ${await name.innerText()}`);
      await noSideScroll(page, 'Settings');
      await sw.click();
      await sect.locator('[data-row="lateFeeSplitAll"] .save-mark.saved').waitFor();
      assert((await dash()).lateFeeSplitForAll === true, 'not saved');
      await ctx.close();
      assert((await put(areq, '/api/admin/late-fee-split', { on: false })).ok(), 'off');
      assert((await dash()).lateFeeSplitForAll === false, 'still on');
    });
  }

  for (const [scheme, width, note, query, r2] of [
    ['light', 360, 'Split A', '?latefees=on&latefeesplit=on', false],
    ['dark', 430, 'Split B', '?latefees=on&latefeesplit=on&textsr2=on', true],
  ]) {
    await check(`${scheme} ${width}px, ${query}: 6 in, cancel with No: the sheet says $9, the Heads up text says "your $9 share", each owes $9, paid players get $5 credit`, async () => {
      const id = await lateGame(note, FIVE, ['Julian', 'Nathan']);
      const { ctx, page } = await openAdmin({ scheme, width, query });
      await gearPick(page, note, /Cancel session/);
      if (!r2) await page.locator('dialog[open] [data-venue-waived]').getByRole('button', { name: 'No' }).click();
      const t = await dialogText(page);
      assert(/No: the fee is kept\. 6 are in, so everyone signed up owes \$9 \(anything paid above that comes back as credit\)\. Late drops still owe \$14\./.test(t), `hint: ${t}`);
      await noSideScroll(page, 'cancel sheet');
      await page.locator('dialog[open]').getByRole('button', { name: 'Cancel session' }).click();
      const after = page.locator('[data-late-cancel="fee_kept"]');
      await after.waitFor({ timeout: 8000 });
      const body = await after.locator('[data-draft="canceled_fee_kept"] textarea').inputValue();
      assert(body.includes("your $9 share still applies (if you already paid, you're all set).") && !body.includes('$14'), `text: ${JSON.stringify(body)}`);
      await noSideScroll(page, 'after-cancel sheet');
      await ctx.close();
      const s = (await dash()).sessions.find((x) => x.id === id);
      assert(s.canceledBy === 'organizer_fee_kept' && s.feeSplit && s.feeSplit.priceCents === 900 && s.feeSplit.count === 6, `session: ${JSON.stringify(s.feeSplit)}`);
      assert(s.court && s.court.playersCoverCents === 4500 && s.court.yourShareCents === 300, `court: ${JSON.stringify(s.court)}`);
      for (const n of ['Julian', 'Nathan']) assert((await potOf(n)) >= 500 && (await owedOf(n, id)) === 0, `${n}: pot ${await potOf(n)}, owes ${await owedOf(n, id)}`);
      for (const n of ['Ryan', 'Mitchel', 'Brandon']) assert((await owedOf(n, id)) === 900, `${n} owes ${await owedOf(n, id)}`);
    });
  }

  await check('switch off (only ?latefees=on): 6 in, cancel with No: $14 each, exactly as before', async () => {
    const id = await lateGame('Split off', FIVE, ['Julian']);
    const before = await potOf('Julian');
    const { ctx, page } = await openAdmin({ query: '?latefees=on&latefeesplit=off' });
    await gearPick(page, 'Split off', /Cancel session/);
    await page.locator('dialog[open] [data-venue-waived]').getByRole('button', { name: 'No' }).click();
    const t = await dialogText(page);
    assert(/No: the fee is kept, and everyone signed up still owes their \$14 \(late drops too\)\./.test(t), `hint: ${t}`);
    await page.locator('dialog[open]').getByRole('button', { name: 'Cancel session' }).click();
    const after = page.locator('[data-late-cancel="fee_kept"]');
    await after.waitFor({ timeout: 8000 });
    const body = await after.locator('[data-draft="canceled_fee_kept"] textarea').inputValue();
    assert(body.includes('your $14 share still applies'), `text: ${body}`);
    await ctx.close();
    const s = (await dash()).sessions.find((x) => x.id === id);
    assert(!s.feeSplit && s.court.playersCoverCents === 7000, `session: ${JSON.stringify({ f: s.feeSplit, c: s.court })}`);
    assert((await potOf('Julian')) === before, 'Julian got credit with the switch off');
    assert((await owedOf('Ryan', id)) === 1400, 'Ryan does not owe $14');
  });

  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
