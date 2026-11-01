/* Independent audit (stage 3), in a browser: things only the screens show.
 *
 *   NODE_PATH=/opt/node-tools/node_modules node e2e/audit-stage3.cjs
 *
 * Starts its own Vite dev server on a fresh fake database. Venmo is never
 * opened (requests to venmo.com are aborted), Telegram is not configured.
 * Written by an independent auditor; its first run found the two problems the
 * last two checks now guard against.
 */
const { spawn } = require('node:child_process');
const { rmSync, mkdirSync } = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.E2E_PORT) || 5287;
const BASE = `http://localhost:${PORT}`;
const SETUP_TOKEN = 'audit3-setup-token-0123456789';
const PIN = '482913';
const PEOPLE = ['Alex', 'Ryan', 'Mitchel', 'Brandon', 'Julian'];

let passed = 0;
let failed = 0;
async function check(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.log(`  ✗ ${name}\n      ${String(err && err.message ? err.message : err).replace(/\s*\n\s*/g, ' ⏎ ').slice(0, 700)}`);
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
const squash = (t) => t.replace(/\s+/g, ' ').trim();
const nav = (page, name) => page.getByRole('navigation', { name: 'Organizer sections' }).getByRole('button', { name: new RegExp(`^${name}`) });

async function main() {
  const dbFile = path.join(ROOT, '.data', 'audit-stage3.sqlite');
  mkdirSync(path.join(ROOT, '.data'), { recursive: true });
  rmSync(dbFile, { force: true });
  const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
    cwd: ROOT,
    env: { ...process.env, DEV_DB: dbFile, SETUP_TOKEN, DEV_CLOCK: '1', TELEGRAM_BOT_TOKEN: '', TELEGRAM_CHAT_ID: '' },
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
  // Never drive somebody else's server: this one must be fresh.
  const st = await (await fetch(`${BASE}/api/status`)).json();
  if (st.setupComplete) throw new Error(`port ${PORT} already has a set-up group; not touching it`);
  const clock = (iso) => fetch(`${BASE}/__dev/clock`, { method: 'POST', body: JSON.stringify({ atMs: Date.parse(iso) }) });
  await clock('2026-10-26T12:00:00-04:00');

  const browser = await chromium.launch();
  const api = await browser.newContext();
  const call = async (req, method, url, data) => {
    const res = await req.fetch(BASE + url, { method, data, headers: { Origin: BASE } });
    if (!res.ok()) throw new Error(`${method} ${url}: ${res.status()} ${await res.text()}`);
    return res.json().catch(() => ({}));
  };
  await call(api.request, 'POST', '/api/setup', {
    setupToken: SETUP_TOKEN,
    groupName: 'Pickleball Bros',
    pin: PIN,
    venmoUrl: 'https://venmo.com/u/organizer',
    players: PEOPLE.map((name, i) => ({ name, phone: `248555010${i}` })),
  });
  await call(api.request, 'PUT', '/api/admin/group', { organizerName: 'Alex' });
  const dash = () => call(api.request, 'GET', '/api/admin/dashboard');
  const d0 = await dash();
  const id = Object.fromEntries(d0.players.map((p) => [p.name, p.id]));
  await call(api.request, 'PUT', `/api/admin/players/${id.Mitchel}`, { name: 'Mitchel', venmo: '@Mitchel-K' });
  const byDate = (d, date) => d.sessions.find((s) => new Date(s.startsAt).toLocaleDateString('en-CA', { timeZone: 'America/Detroit' }) === date);
  const thu = byDate(d0, '2026-10-29');
  const nov3 = byDate(d0, '2026-11-03');
  const nov5 = byDate(d0, '2026-11-05');
  const playerReq = async (name) => {
    const c = await browser.newContext();
    await call(c.request, 'POST', '/api/me', { playerId: id[name] });
    return c;
  };

  // Mitchel: $14 credit (Thu Oct 29 paid, then canceled). He asks for $5 of it back.
  await call(api.request, 'POST', `/api/admin/sessions/${thu.id}/roster`, { playerId: id.Mitchel, action: 'confirm' });
  await call(api.request, 'POST', `/api/admin/sessions/${thu.id}/payment`, { playerId: id.Mitchel, paid: true });
  await call(api.request, 'POST', `/api/admin/sessions/${thu.id}/decision`, { decision: 'cancel', confirm: true });
  const mitchel = await playerReq('Mitchel');
  await call(mitchel.request, 'POST', '/api/me/refund-request', { cents: 500 });

  // Ryan: paid Tue Nov 3, taps I'm out ($14 credit), then spends it all on Thu Nov 5.
  // He signed up for Nov 5 before the credit came back, so Use credit is still his to tap (credit at sign-up is automatic now).
  const ryan = await playerReq('Ryan');
  await call(ryan.request, 'POST', `/api/sessions/${nov3.id}/join`, {});
  await call(api.request, 'POST', `/api/admin/sessions/${nov3.id}/payment`, { playerId: id.Ryan, paid: true });
  await call(ryan.request, 'POST', `/api/sessions/${nov5.id}/join`, {});
  await call(ryan.request, 'POST', `/api/sessions/${nov3.id}/withdraw`, {});
  const used = await call(ryan.request, 'POST', `/api/sessions/${nov5.id}/use-credit`, {});
  if (!(used.ok === true && used.usedCents === 1400 && used.paid === true)) throw new Error(`Ryan's Use credit on Nov 5: ${JSON.stringify(used)}`);

  const organizer = async () => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 860 }, isMobile: true, hasTouch: true });
    await ctx.route(/venmo\.com/, (r) => r.abort());
    await ctx.route(/^venmo:/, (r) => r.abort());
    const page = await ctx.newPage();
    await ctx.request.post(BASE + '/api/admin/login', { headers: { Origin: BASE }, data: { pin: PIN } });
    await page.goto(BASE + '/admin');
    return { ctx, page };
  };

  {
    const { ctx, page } = await organizer();
    await check('the refund card: Refund opens Venmo for $5 with the note, then Mark refunded appears and works', async () => {
      const card = page.locator('[data-refund-request="Mitchel"]');
      await card.waitFor();
      assert(squash(await card.locator('h3').innerText()) === 'Mitchel requested a refund of $5', await card.locator('h3').innerText());
      const link = card.locator('[data-refund-venmo]');
      assert((await link.getAttribute('data-app-href')) === 'venmo://paycharge?txn=pay&recipients=Mitchel-K&amount=5&note=Pickleball%20credit%20refund', await link.getAttribute('data-app-href'));
      assert((await card.locator('[data-mark-refunded]').count()) === 0, 'Mark refunded before Venmo was opened');
      const before = (await dash()).creditLedger.find((l) => l.playerId === id.Mitchel);
      // Opening Venmo marks nothing.
      await link.click();
      await card.locator('[data-mark-refunded]').waitFor();
      const mid = (await dash()).creditLedger.find((l) => l.playerId === id.Mitchel);
      assert(mid.balanceCents === before.balanceCents && mid.reservedCents === 500, 'opening Venmo changed the credit');
      await card.locator('[data-mark-refunded]').click();
      await page.locator('.toast', { hasText: 'Mitchel refunded' }).waitFor();
      await card.waitFor({ state: 'detached' });
      const after = (await dash()).creditLedger.find((l) => l.playerId === id.Mitchel);
      assert(after.balanceCents === 900 && after.reservedCents === 0, `after: ${JSON.stringify(after)}`);
    });
    await check('"Mark refunded" on a request for less than the balance can be undone (Players row or sheet)', async () => {
      const homeUndo = await page.getByRole('button', { name: /^Undo/ }).count();
      await nav(page, 'Players').click();
      const row = page.locator('li.player-row[data-player="Mitchel"]');
      await row.waitFor();
      const rowUndo = await row.getByRole('button', { name: /^Undo/ }).count();
      await row.locator('.player-open').click();
      const sheet = page.locator('dialog[open]');
      await sheet.locator('[data-credit-section]').waitFor();
      const hist = squash(await sheet.locator('[data-credit-section]').innerText());
      const sheetUndo = await sheet.getByRole('button', { name: /^Undo/ }).count();
      assert(/-\$5 refunded/.test(hist), `history: ${hist}`);
      assert(homeUndo + rowUndo + sheetUndo > 0, `no Undo for the $5 Mark refunded (Home ${homeUndo}, row ${rowUndo}, sheet ${sheetUndo}); the sheet offers: ${hist}`);
    });
    await ctx.close();
  }

  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 860 }, isMobile: true, hasTouch: true });
    await call(ctx.request, 'POST', '/api/me', { playerId: id.Ryan });
    const page = await ctx.newPage();
    await page.goto(BASE + '/');
    await page.locator('.schedule article').first().waitFor();
    await check('Ryan spent his $14 credit: his Tue Nov 3 card no longer offers "Request refund" for credit that is gone', async () => {
      const line = page.locator('[data-credit-back]');
      const shown = await line.count();
      if (shown === 0) return; // fixed: no stale line
      const text = squash(await line.first().innerText());
      await line.first().getByRole('button', { name: /^Request cash out from/ }).click();
      await page.waitForTimeout(400);
      const sheets = await page.locator('dialog[open] [data-credit-sheet]').count();
      assert(sheets > 0, `"${text}" is shown with $0 credit and its Request refund opened nothing`);
    });
    await ctx.close();
  }

  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
