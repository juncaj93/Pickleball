/* "Texts and alerts, round 2" (TEXTS_R2, Nov 2026) in a real browser.
 *
 *   node e2e/texts-r2.cjs      (also run by npm run test:e2e)
 *
 * Off (the ship state): every text and the cancel sheet are exactly what they were. /admin?textsr2=on turns the new texts on
 * for that phone only (?textsr2=off ends it); Settings > Feature switches > "Texts and alerts, round 2" turns them on for
 * everyone with no deploy. On: the gear menu's Text the group offers the new short wording with line breaks; the check-in
 * opens Messages with NO recipients; "Text this alert to yourself" is gone; the cancel sheet's "Did the venue waive the fee?"
 * starts on No and the fee-kept text (with the reason you typed) is ready. Yes still works. 320, 360 and 430 px, light and dark.
 * The real Messages app cannot be opened here: the link's address is checked (line breaks must be %0A), the tap itself is the
 * owner's phone test.
 *
 * Starts its own dev server with a fresh fake group and a fake clock. Nothing here touches the live site.
 */
const { spawn } = require('node:child_process');
const { rmSync, mkdirSync } = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.E2E_PORT) || 5320;
const BASE = `http://localhost:${PORT}`;
const SETUP_TOKEN = 'textsr2-setup-token-0123456789';
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
  const dbFile = path.join(ROOT, '.data', 'textsr2.sqlite');
  mkdirSync(path.join(ROOT, '.data'), { recursive: true });
  rmSync(dbFile, { force: true });
  if (await fetch(`${BASE}/api/status`).then((r) => r.ok, () => false)) throw new Error(`port ${PORT} is already in use`);
  const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
    cwd: ROOT,
    env: { ...process.env, DEV_DB: dbFile, SETUP_TOKEN, DEV_CLOCK: '1', LATE_FEES: '', TEXTS_R2: '', MOTION: '', TELEGRAM_BOT_TOKEN: '', TELEGRAM_CHAT_ID: '' },
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
    groupName: 'Pickleball Bros',
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
  /** The Text the group list of that card: [{ id, name, who, href }]. */
  async function textList(page, note) {
    await gearOf(page, note);
    await page.getByRole('menuitem', { name: 'Text the group' }).click();
    const rows = page.locator('.menu-texts .text-row');
    await rows.first().waitFor();
    return rows.evaluateAll((els) =>
      els.map((e) => ({ id: e.getAttribute('data-text'), name: e.querySelector('.text-name')?.textContent || '', who: e.querySelector('.text-who')?.textContent || '', href: e.querySelector('a')?.getAttribute('href') || '' })),
    );
  }
  const bodyOf = (href) => decodeURIComponent((href.split('body=')[1] || '').replace(/\+/g, '%20'));

  // A game 20 hours out with 4 in (check-in), one with 2 in (need players), both with a note to find the card by.
  const FOUR = await addGameIn(20, 'Four in');
  const TWO = await addGameIn(22, 'Two in');
  for (const n of ['Ryan', 'Julian', 'Nathan', 'Mitchel']) await join(n, FOUR);
  for (const n of ['Ryan', 'Julian']) await join(n, TWO);
  for (const id of [FOUR, TWO]) await post(areq, `/api/admin/sessions/${id}/court-status`, { status: 'booked' });

  await check('off (the ship state): the check-in is the old words, one line, to the 4 numbers; "Text this alert to yourself" is still there', async () => {
    const { ctx, page } = await openAdmin();
    const list = await textList(page, 'Four in');
    const checkin = list.find((t) => t.id === 'checkin');
    assert(checkin, `no check-in: ${JSON.stringify(list)}`);
    const body = bodyOf(checkin.href);
    assert(/^Pickleball (tomorrow|today|tonight|\w{3} \w{3} \d+), \d{1,2}:\d{2} (AM|PM)\. Can't make it\? Update here: \S+$/.test(body), `old words: ${body}`);
    assert(!body.includes('\n'), 'old words have line breaks');
    assert(/^sms:\+?\d/.test(checkin.href) || /^sms:\/\/open\?addresses=/.test(checkin.href), `old check-in goes to the numbers: ${checkin.href}`);
    assert(/Everyone signed up/.test(checkin.who), `who: ${checkin.who}`);
    await ctx.close();
    const b = await openAdmin();
    await gearOf(b.page, 'Two in');
    await b.page.keyboard.press('Escape');
    // The short-on-players panel sits on the 2-in card.
    const card = b.page.locator('article', { hasText: 'Two in' }).first();
    assert(/Text this alert to yourself/.test(await card.innerText()), 'the yourself item is missing with the switch off');
    await b.ctx.close();
  });

  for (const [scheme, width] of [
    ['light', 320],
    ['light', 360],
    ['dark', 430],
  ]) {
    await check(`${scheme} ${width}px, /admin?textsr2=on: check-in is the new 4 lines, no recipients, line breaks as %0A; Share and Need players are new too; nothing off-screen`, async () => {
      const { ctx, page } = await openAdmin({ scheme, width, query: '?textsr2=on' });
      await page.evaluate((x) => (window.__layoutW = x), width);
      const list = await textList(page, 'Four in');
      await noSideScroll(page, 'text list');
      const checkin = list.find((t) => t.id === 'checkin');
      assert(checkin, `no check-in: ${JSON.stringify(list)}`);
      const body = bodyOf(checkin.href);
      const lines = body.split('\n');
      assert(lines.length === 5 && lines[3] === '' && !lines[4].includes(' '), `lines: ${JSON.stringify(lines)}`);
      assert(/^Pickleball (tomorrow|today|tonight|\w{3} \w{3} \d+) @ \d{1,2}(:\d{2})?(am|pm)!$/.test(lines[0]), `first line: ${lines[0]}`);
      assert(lines[1] === '4 in so far. Want in? Join now.', `second line: ${lines[1]}`);
      assert(lines[2] === 'Need to back out? Do it tonight to avoid cancel fees.', `third line: ${lines[2]}`);
      assert(!/[–—]/.test(body), 'a dash');
      assert(/^sms:&body=/.test(checkin.href), `a check-in must open with no recipients: ${checkin.href}`);
      assert(!checkin.href.includes('\n') && (checkin.href.match(/%0A/g) || []).length === 4, `line breaks must be %0A: ${checkin.href}`);
      assert(/Group chat/.test(checkin.who), `who: ${checkin.who}`);
      const share = list.find((t) => t.id === 'share');
      assert(/^Pickleball .* @ \d{1,2}(:\d{2})?(am|pm)!\nIn or out here:\n\n\S+$/.test(bodyOf(share.href)), `share: ${JSON.stringify(bodyOf(share.href))}`);
      await ctx.close();
      const b = await openAdmin({ scheme, width, query: '?textsr2=on' });
      const need = (await textList(b.page, 'Two in')).find((t) => t.id === 'need');
      const nb = bodyOf(need.href).split('\n');
      assert(nb[1] === '2 in, need 2 more.' && nb[2] === "Want in? Join tonight, otherwise we'll have to cancel." && nb[3] === '' && nb.length === 5, `need: ${JSON.stringify(nb)}`);
      assert(/^sms:&body=/.test(need.href), 'need players has recipients');
      await b.ctx.close();
    });
  }

  await check('/admin?textsr2=on: "Text this alert to yourself" is gone from the 2-in card', async () => {
    const { ctx, page } = await openAdmin({ query: '?textsr2=on' });
    const card = page.locator('article', { hasText: 'Two in' }).first();
    assert(!/Text this alert to yourself/.test(await card.innerText()), 'the yourself item still shows');
    assert(/Keep as is/.test(await card.innerText()), 'the rest of the panel went too');
    await ctx.close();
  });

  await check('another phone (no private link) still sees the old words', async () => {
    const { ctx, page } = await openAdmin();
    const checkin = (await textList(page, 'Four in')).find((t) => t.id === 'checkin');
    assert(/Can't make it\?/.test(bodyOf(checkin.href)), `body: ${bodyOf(checkin.href)}`);
    await ctx.close();
  });

  for (const [scheme, width] of [
    ['light', 360],
    ['dark', 430],
  ]) {
    await check(`${scheme} ${width}px: Settings > Feature switches has "Texts and alerts, round 2", off at ship; turning it on saves with no deploy and every phone gets the new words; off puts the old back`, async () => {
      const { ctx, page } = await openAdmin({ scheme, width });
      await page.evaluate((x) => (window.__layoutW = x), width);
      await page.locator('nav.tabbar').getByRole('button', { name: /^Settings/ }).click();
      const sect = page.locator('details.set-sect', { hasText: 'Feature switches' });
      await sect.waitFor();
      await sect.locator('summary').click();
      const sw = sect.locator('[data-texts-r2-all]');
      assert((await sw.count()) === 1, 'switch row missing');
      assert((await sw.isChecked()) === false, 'switch is on at ship');
      const rowText = squash(await sect.locator('[data-row="textsR2All"]').innerText());
      assert(/Texts and alerts, round 2/.test(rowText) && /New wording for texts and Telegram alerts/.test(rowText), `row: ${rowText}`);
      await noSideScroll(page, 'Settings');
      await sw.click();
      await sect.locator('[data-row="textsR2All"] .save-mark.saved').waitFor();
      assert((await dash()).textsR2ForAll === true, 'not saved');
      await ctx.close();
      const other = await openAdmin({ scheme, width });
      const body = bodyOf((await textList(other.page, 'Four in')).find((t) => t.id === 'checkin').href);
      assert(/^Pickleball .* @ .*!\n4 in so far/.test(body), `body: ${body}`);
      await other.ctx.close();
      // Put it back off for the next run.
      assert((await put(areq, '/api/admin/texts-r2', { on: false })).ok(), 'off');
      assert((await dash()).textsR2ForAll === false, 'still on');
    });
  }

  await check('/admin?textsr2=on, a game canceled well ahead: the credit text says tomorrow or the date, with line breaks', async () => {
    const { ctx, page } = await openAdmin({ query: '?textsr2=on' });
    await gearPick(page, 'Two in', /Cancel session/);
    await page.locator('dialog[open] input[type="text"]').first().fill('Thanksgiving');
    await page.locator('dialog[open]').getByRole('button', { name: 'Cancel session' }).click();
    const box = page.locator('dialog[open], .sheet').filter({ hasText: 'Text the players who were in' }).first();
    await box.waitFor({ timeout: 8000 });
    const draft = await box.locator('.bubble').first().innerText();
    assert(/^Pickleball (tomorrow|today|tonight|\w{3} \w{3} \d+) is canceled\. Thanksgiving\.\nIf you paid, it's now your credit\. You can request a cash out on the site\.\n\n\S+$/.test(draft), `credit text: ${JSON.stringify(draft)}`);
    const href = await box.getByRole('link', { name: 'Text the players who were in' }).getAttribute('href');
    assert(/%0A%0A/.test(href), `link: ${href}`);
    await ctx.close();
  });

  // ---------- B: the cancel sheet ----------

  let lateHours = 3;
  const lateGame = async (note) => {
    // About 3 hours out: inside the 12 hours before the start (each game gets its own quarter hour).
    const id = await addGameIn((lateHours += 0.25), note);
    await post(areq, `/api/admin/sessions/${id}/court-status`, { status: 'booked' });
    for (const n of ['Julian', 'Nathan', 'Mitchel']) await join(n, id);
    return id;
  };

  await check('off: the venue question starts with nothing picked (as it always did); confirming asks to pick', async () => {
    const id = await lateGame('Off sheet');
    const { ctx, page } = await openAdmin({ query: '?latefees=on' });
    await gearPick(page, 'Off sheet', /Cancel session/);
    const t = await dialogText(page);
    assert(/Did the venue waive the fee or give you credit toward the next booking\?/.test(t), `sheet: ${t}`);
    assert((await page.locator('dialog[open] [data-venue-waived] button[aria-pressed="true"]').count()) === 0, 'a default is picked with the switch off');
    await page.locator('dialog[open]').getByRole('button', { name: 'Cancel session' }).click();
    await page.locator('dialog[open] .field-error', { hasText: 'Pick Yes or No.' }).waitFor({ timeout: 4000 });
    await ctx.close();
    assert((await dash()).sessions.find((s) => s.id === id).state.flags.canceled === false, 'canceled without an answer');
  });

  for (const [scheme, width, note] of [
    ['light', 320, 'No sheet A'],
    ['light', 360, 'No sheet B'],
    ['dark', 430, 'No sheet C'],
  ]) {
    await check(`${scheme} ${width}px, /admin?textsr2=on: the venue question starts on No; confirming cancels with the fee kept; the "Heads up" text is ready with the reason, in lines; 3 owe $14`, async () => {
      const id = await lateGame(note);
      const { ctx, page } = await openAdmin({ scheme, width, query: '?latefees=on&textsr2=on' });
      await page.evaluate((x) => (window.__layoutW = x), width);
      await gearPick(page, note, /Cancel session/);
      const t = await dialogText(page);
      assert(/Did the venue waive the fee or give you credit toward the next booking\?/.test(t), `sheet: ${t}`);
      assert((await page.locator('dialog[open] [data-venue-waived] button[aria-pressed="true"]').count()) === 1, 'nothing picked');
      assert((await page.locator('dialog[open] [data-venue-waived] button[aria-pressed="true"]').innerText()) === 'No', 'the default is not No');
      assert(/No: the fee is kept, and everyone signed up still owes their \$14/.test(t), `hint: ${t}`);
      await noSideScroll(page, 'cancel sheet');
      await page.locator('dialog[open] input[type="text"]').first().fill('Rain');
      await page.locator('dialog[open]').getByRole('button', { name: 'Cancel session' }).click();
      const after = page.locator('[data-late-cancel="fee_kept"]');
      await after.waitFor({ timeout: 8000 });
      const body = await after.locator('[data-draft="canceled_fee_kept"] textarea').inputValue();
      const lines = body.split('\n');
      assert(lines.length === 5 && lines[3] === '', `lines: ${JSON.stringify(lines)}`);
      assert(lines[0] === "Heads up: today's game is canceled, and since it's inside 12 hours the venue is charging us for the court. Rain.", `line 1: ${lines[0]}`);
      assert(lines[1] === "If you were signed up, your $14 share still applies (if you already paid, you're all set).", `line 2: ${lines[1]}`);
      assert(lines[2] === 'Sorry about that! You can pay on the site:' && !lines[4].includes(' '), `lines: ${JSON.stringify(lines)}`);
      const href = await after.locator('[data-draft="canceled_fee_kept"] [data-draft-open]').getAttribute('href');
      assert(/%0A%0A/.test(href) && !href.includes('\n'), `Messages link: ${href}`);
      await noSideScroll(page, 'after-cancel sheet');
      await ctx.close();
      const s = (await dash()).sessions.find((x) => x.id === id);
      assert(s.state.flags.canceled && s.canceledBy === 'organizer_fee_kept' && s.cancelReason === 'Rain', `session: ${JSON.stringify({ c: s.state.flags.canceled, by: s.canceledBy, r: s.cancelReason })}`);
      const v = await (await phones.Julian.get(`${BASE}/api/group`)).json();
      const o = v.owed.find((x) => x.sessionId === id);
      assert(o && o.lateFee === 'canceled_late' && o.amountCents === 1400, `Julian owes: ${JSON.stringify(v.owed)}`);
    });
  }

  await check('/admin?textsr2=on: picking Yes still works exactly as before: everyone gets credit, nobody owes, and the credit text names the day and the reason', async () => {
    const id = await lateGame('Yes sheet');
    const { ctx, page } = await openAdmin({ query: '?latefees=on&textsr2=on' });
    await gearPick(page, 'Yes sheet', /Cancel session/);
    await page.locator('dialog[open] [data-venue-waived]').getByRole('button', { name: 'Yes' }).click();
    assert((await page.locator('dialog[open] [data-venue-waived] button[aria-pressed="true"]').innerText()) === 'Yes', 'Yes did not take');
    await page.locator('dialog[open] input[type="text"]').first().fill('Venue closed');
    await page.locator('dialog[open]').getByRole('button', { name: 'Cancel session' }).click();
    const after = page.locator('[data-late-cancel="waived"]');
    await after.waitFor({ timeout: 8000 });
    const body = await after.locator('[data-draft="canceled_today"] textarea').inputValue();
    assert(/^Pickleball (today|tonight) is canceled\. Venue closed\.\nIf you paid, it's now your credit\. You can request a cash out on the site\.\n\n\S+$/.test(body), `Yes text: ${JSON.stringify(body)}`);
    await ctx.close();
    const s = (await dash()).sessions.find((x) => x.id === id);
    assert(s.state.flags.canceled && s.canceledBy !== 'organizer_fee_kept', `session: ${s.canceledBy}`);
    const v = await (await phones.Julian.get(`${BASE}/api/group`)).json();
    assert(!v.owed.some((o) => o.sessionId === id), `Julian owes after Yes: ${JSON.stringify(v.owed)}`);
  });

  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
