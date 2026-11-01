/* Player audit: identity, Drop out and the 5-second Undo, I'm in, live refresh and stale taps,
 * and everything else a player touches (calendar, light/dark, links, back, reload, offline,
 * error pages, empty states, the credit sheet, cash out and the "Use the $X" prompt).
 *
 * A fake group on a throwaway dev server (port 5301, .data/audit-flows.sqlite) with a fake
 * server clock (Mon Nov 2, 2026, 9:00 AM Eastern; moved later for the cancel-by and start
 * checks at the end). Nothing here touches the live site.
 *
 * Checks named "BUG: ..." describe a real bug that is still open: they fail until it is fixed.
 *
 *   node e2e/audit-player-flows.cjs
 *   ONLY=identity,drop node e2e/audit-player-flows.cjs   (just some families; setup always runs)
 */
const { spawn } = require('node:child_process');
const { rmSync, mkdirSync, readFileSync } = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.E2E_PORT) || 5301;
const BASE = `http://localhost:${PORT}`;
const SETUP_TOKEN = 'audit-flows-setup-token-0123456789';
const PIN = '482913';
const LONG = 'Bartholomew-Maximiliano Fitzgerald';
const NAMES = [
  'Alex',
  // identity, and the people who fill games
  'Ryan', 'Julian', "O'Brien", 'José', '🏓 Sam', 'Quinn', 'Remy', LONG,
  // drop out and Undo
  'Casey', 'Devon', 'Emery', 'Frankie', 'Gus', 'Hal', 'Ivy', 'Jade', 'Kai', 'Lee', 'Max', 'Ned',
  // I'm in, live, credit sheet
  'Olive', 'Pia', 'Rex', 'Sky', 'Tess',
];
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const ONLY = (process.env.ONLY || '').split(',').filter(Boolean);
const want = (family) => ONLY.length === 0 || ONLY.includes(family);

let passed = 0;
let failed = 0;
const failures = [];
async function check(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    failures.push(name);
    console.log(`  ✗ ${name}\n      ${String(err && err.message ? err.message : err).replace(/\s*\n\s*/g, ' ⏎ ').slice(0, 700)}`);
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
const squash = (t) => String(t).replace(/\s+/g, ' ').trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const et = (s) => Date.parse(s);

async function main() {
  const dbFile = path.join(ROOT, '.data', 'audit-flows.sqlite');
  mkdirSync(path.join(ROOT, '.data'), { recursive: true });
  rmSync(dbFile, { force: true });
  const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
    cwd: ROOT,
    env: { ...process.env, DEV_DB: dbFile, SETUP_TOKEN, DEV_CLOCK: '1' },
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
  const setClock = (ms) => fetch(`${BASE}/__dev/clock`, { method: 'POST', body: JSON.stringify({ atMs: ms }) });
  await setClock(et('2026-11-02T09:00:00-05:00'));

  const browser = await chromium.launch();
  const post = (req, url, data) => req.post(BASE + url, { data, headers: { Origin: BASE } });
  const setup = (await browser.newContext()).request;
  const made = await post(setup, '/api/setup', {
    setupToken: SETUP_TOKEN,
    groupName: 'Pickleball Bros',
    pin: PIN,
    venmoUrl: 'https://venmo.com/u/organizer',
    // Setup takes 20 names at most; the organizer adds the rest below.
    players: NAMES.slice(0, 20).map((name, i) => ({ name, phone: `24855507${String(i).padStart(2, '0')}` })),
  });
  if (!made.ok()) throw new Error(`setup failed: ${await made.text()}`);
  const areq = (await browser.newContext()).request;
  await post(areq, '/api/admin/login', { pin: PIN });
  for (const [i, name] of NAMES.slice(20).entries()) {
    const r = await post(areq, '/api/admin/players', { name, phone: `24855508${String(i).padStart(2, '0')}` });
    if (!r.ok()) throw new Error(`add player failed: ${await r.text()}`);
  }
  await areq.put(`${BASE}/api/admin/group`, { data: { organizerName: 'Alex', settings: { maxPlayers: 6 } }, headers: { Origin: BASE } });
  const dash = async () => (await areq.get(`${BASE}/api/admin/dashboard`)).json();
  let d = await dash();
  for (const h of d.hiddenSessions || []) await post(areq, `/api/admin/sessions/${h.id}/show`, { shown: true });
  // Extra games for the stale-screen checks (Sat Nov 7 and Sun Nov 8), so the usual games stay untouched.
  const extras = {
    X1: '2026-11-07T10:00:00-05:00',
    X2: '2026-11-07T12:00:00-05:00',
    X3: '2026-11-07T14:00:00-05:00',
    X6: '2026-11-08T10:00:00-05:00',
    X7: '2026-11-08T12:00:00-05:00',
    X8: '2026-11-08T14:00:00-05:00',
    X9: '2026-11-08T16:00:00-05:00',
  };
  for (const at of Object.values(extras)) {
    const r = await post(areq, '/api/admin/sessions', { startsAt: new Date(et(at)).toISOString(), endsAt: new Date(et(at) + 2 * 3600_000).toISOString() });
    if (!r.ok()) throw new Error(`add game failed: ${await r.text()}`);
  }
  d = await dash();
  const all = d.sessions.filter((s) => !s.state.flags.past).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const X = {};
  for (const [k, at] of Object.entries(extras)) X[k] = all.find((s) => Date.parse(s.startsAt) === et(at));
  const usual = all.filter((s) => !Object.values(X).includes(s));
  const G = usual; // G[0] Tue Nov 3, G[1] Thu Nov 5, G[2] Tue Nov 10, G[3] Thu Nov 12 (left Not booked), G[4] Tue Nov 17, ...
  assert(G[0].startsAt === '2026-11-04T01:00:00.000Z' && G[1].startsAt === '2026-11-06T01:00:00.000Z', `games: ${G.map((g) => g.startsAt)}`);
  const THANKSGIVING = G.find((s) => s.startsAt === '2026-11-27T01:00:00.000Z');
  for (const s of all) if (s.id !== G[3].id) await post(areq, `/api/admin/sessions/${s.id}/booked`, {});
  const idOf = (n) => d.players.find((p) => p.name === n).id;
  const who = {};
  for (const n of NAMES) {
    const c = await browser.newContext();
    await post(c.request, '/api/me', { playerId: idOf(n) });
    who[n] = c.request;
  }
  const join = (n, s) => post(who[n], `/api/sessions/${s.id}/join`, {});
  const withdraw = (n, s) => post(who[n], `/api/sessions/${s.id}/withdraw`, {});
  const groupOf = async (n) => (await who[n].get(`${BASE}/api/group`)).json();
  const mineOf = async (n, s) => (await groupOf(n)).sessions.find((x) => x.id === s.id)?.mine ?? null;
  const statusOf = async (n, s) => (await mineOf(n, s))?.status ?? null;
  const creditOf = async (n) => (await groupOf(n)).credit;
  const potOf = async (n) => (await creditOf(n)).balanceCents;
  const confirmPaid = async (n, s) => {
    await post(who[n], `/api/sessions/${s.id}/paid`, { paid: true });
    await post(areq, `/api/admin/sessions/${s.id}/payment`, { playerId: idOf(n), paid: true });
  };
  /** $14 of credit the clean way: pay for a far game, the organizer confirms, then drop it. Optionally cash out part of it. */
  const giveCredit = async (n, cents = 1400, via = G[G.length - 1]) => {
    await join(n, via);
    await confirmPaid(n, via);
    await withdraw(n, via);
    if (cents < 1400) {
      await post(who[n], '/api/me/refund-request', { cents: 1400 - cents });
      const rq = (await dash()).refundRequests.find((r) => r.name === n);
      await post(areq, `/api/admin/refund-requests/${rq.id}`, { action: 'refunded' });
    }
    const pot = await potOf(n);
    assert(pot === cents, `${n} pot ${pot}, wanted ${cents}`);
  };

  const phone = (width, colorScheme, extra = {}) => ({ viewport: { width, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme, userAgent: UA, ...extra });
  /** One phone for one player. Celebrations and cash-out notices already seen, so the banner is ours to read. */
  async function open(name, o = {}) {
    const { width = 390, scheme = 'light', clockAt = null, quiet = true, more = true, url = '/' } = o;
    const ctx = await browser.newContext(phone(width, scheme));
    if (name) await post(ctx.request, '/api/me', { playerId: idOf(name) });
    if (name && quiet) {
      const g = await (await ctx.request.get(`${BASE}/api/group`)).json();
      const ids = g.sessions.map((s) => s.id);
      const cash = (g.credit?.history ?? []).filter((e) => e.kind === 'refunded').map((e) => e.id);
      await ctx.addInitScript(
        ([ids, cash]) => {
          try {
            if (!localStorage.getItem('pb_celebrated')) localStorage.setItem('pb_celebrated', JSON.stringify(ids));
            if (!localStorage.getItem('pb_cashout_seen')) localStorage.setItem('pb_cashout_seen', JSON.stringify(cash));
          } catch {}
        },
        [ids, cash],
      );
    }
    const page = await ctx.newPage();
    const seen = { version: 0, group: 0, withdraw: 0, join: 0, paid: 0, useCredit: 0, order: [] };
    page.on('request', (r) => {
      const u = new URL(r.url()).pathname;
      if (u === '/api/group/version') seen.version++;
      else if (u === '/api/group') seen.group++;
      else if (/\/withdraw$/.test(u)) (seen.withdraw++, seen.order.push(`withdraw:${u.split('/')[3]}`));
      else if (/\/join$/.test(u)) (seen.join++, seen.order.push(`join:${u.split('/')[3]}`));
      else if (/\/paid$/.test(u)) seen.paid++;
      else if (/\/use-credit$/.test(u)) seen.useCredit++;
    });
    if (clockAt) await page.clock.install({ time: clockAt });
    await page.goto(BASE + url);
    if (name) {
      await page.locator('.schedule article').first().waitFor();
      if (more) {
        const m = page.getByRole('button', { name: /^More sessions/ });
        if (await m.count()) await m.click();
      }
    }
    return { ctx, page, seen };
  }
  const card = (page, s) => page.locator(`#row-${s.id}`);
  const banner = (page) => page.locator('.pop');
  async function waitBanner(page, re, timeout = 5000) {
    const end = Date.now() + timeout;
    let last = '';
    while (Date.now() < end) {
      last = (await banner(page).allInnerTexts().catch(() => [])).map(squash).join(' | ');
      if (re.test(last)) return last;
      await sleep(80);
    }
    throw new Error(`banner never matched ${re}; last: "${last}"`);
  }
  async function tapDrop(page, s) {
    await card(page, s).getByRole('button', { name: 'Drop out' }).click();
    await page.locator('dialog[open]').getByRole('button', { name: 'Drop out' }).click();
  }
  const isIn = async (page, s) => (await card(page, s).getAttribute('data-mine')) === 'in';
  const chipLabel = async (page) => ((await page.locator('[data-credit-chip]').count()) ? await page.locator('[data-credit-chip]').getAttribute('aria-label') : null);
  const setHidden = (page, hidden) =>
    page.evaluate((h) => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (h ? 'hidden' : 'visible') });
      document.dispatchEvent(new Event('visibilitychange'));
    }, hidden);
  const until = async (fn, timeout = 8000, step = 150) => {
    const end = Date.now() + timeout;
    let v;
    while (Date.now() < end) {
      v = await fn();
      if (v) return v;
      await sleep(step);
    }
    return v;
  };
  const noSideScroll = (page) => page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));

  // ==================================================================================== IDENTITY
  if (want('identity')) {
    console.log('\nIdentity');
    // Seats used below: the full game G[2] holds the unusual names.
    for (const n of ['Ryan', 'Julian', "O'Brien", 'José', '🏓 Sam', LONG]) await join(n, G[2]);
    await join('Quinn', G[5]); // Quinn has history, so removing Quinn hides the name (not deleted)
    const activeNames = (await (await who.Ryan.get(`${BASE}/api/group`)).json()).players.map((p) => p.name);

    await check('first visit: "Who are you?" lists every active name (accents, emoji, apostrophe, long), Add my name, Organizer sign-in, no schedule', async () => {
      const ctx = await browser.newContext(phone(390, 'light'));
      const page = await ctx.newPage();
      await page.goto(BASE);
      await page.getByRole('heading', { level: 1, name: 'Who are you?' }).waitFor();
      const shown = await page.locator('section[aria-label="Pick your name"] .name-grid button').allInnerTexts();
      for (const n of activeNames) assert(shown.includes(n), `missing ${n}: ${shown}`);
      for (const n of ["O'Brien", 'José', '🏓 Sam', LONG]) assert(shown.includes(n), `missing ${n}`);
      assert(await page.getByRole('button', { name: 'Add my name' }).isVisible(), 'no Add my name');
      assert(await page.getByRole('link', { name: 'Organizer sign-in' }).isVisible(), 'no organizer link');
      assert((await page.locator('.schedule article').count()) === 0, 'schedule shown before a name');
      assert((await page.getByRole('button', { name: 'Cancel' }).count()) === 0, 'Cancel offered with no name to go back to');
      await ctx.close();
    });

    const idCtx = await browser.newContext(phone(390, 'light'));
    const idPage = await idCtx.newPage();
    const meOn = async (ctx) => (await (await ctx.request.get(`${BASE}/api/group`)).json()).me?.name ?? null;
    await check('pick a name: title becomes the name, the schedule shows, and a reload remembers it', async () => {
      await idPage.goto(BASE);
      await idPage.getByRole('button', { name: 'Julian', exact: true }).click();
      await idPage.getByRole('heading', { level: 1, name: 'Julian' }).waitFor();
      await idPage.locator('.schedule article').first().waitFor();
      await idPage.reload();
      await idPage.getByRole('heading', { level: 1, name: 'Julian' }).waitFor();
      assert((await meOn(idCtx)) === 'Julian', 'server does not know the phone');
    });
    await check('"not you?" then Cancel: same name, nothing saved', async () => {
      await idPage.getByRole('button', { name: 'Not you?' }).click();
      await idPage.getByRole('heading', { level: 1, name: 'Who are you?' }).waitFor();
      await idPage.getByRole('button', { name: 'Cancel' }).click();
      await idPage.getByRole('heading', { level: 1, name: 'Julian' }).waitFor();
      await idPage.locator('.schedule article').first().waitFor();
      assert((await meOn(idCtx)) === 'Julian', 'name changed');
    });
    await check('two names on one phone: "not you?" -> Ryan switches the phone; Julian\'s seat is untouched', async () => {
      await idPage.getByRole('button', { name: 'Not you?' }).click();
      await idPage.getByRole('button', { name: 'Ryan', exact: true }).click();
      await idPage.getByRole('heading', { level: 1, name: 'Ryan' }).waitFor();
      assert((await meOn(idCtx)) === 'Ryan', 'server still on Julian');
      assert((await statusOf('Julian', G[2])) === 'confirmed', 'Julian lost a seat');
      await idPage.reload();
      await idPage.getByRole('heading', { level: 1, name: 'Ryan' }).waitFor();
    });
    await check('new device: a second phone starts at "Who are you?" even though the first phone has a name', async () => {
      const ctx = await browser.newContext(phone(390, 'dark'));
      const page = await ctx.newPage();
      await page.goto(BASE);
      await page.getByRole('heading', { level: 1, name: 'Who are you?' }).waitFor();
      await ctx.close();
    });
    await check('cleared storage: clearing only browser storage keeps the name (cookie); clearing cookies too asks "Who are you?"', async () => {
      await idPage.evaluate(() => localStorage.clear());
      await idPage.reload();
      await idPage.getByRole('heading', { level: 1, name: 'Ryan' }).waitFor();
      await idCtx.clearCookies();
      await idPage.evaluate(() => localStorage.clear());
      await idPage.reload();
      await idPage.getByRole('heading', { level: 1, name: 'Who are you?' }).waitFor();
      assert((await idPage.locator('.schedule article').count()) === 0, 'schedule still shown');
    });

    const addFlow = async (typed) => {
      const ctx = await browser.newContext(phone(390, 'light'));
      const page = await ctx.newPage();
      await page.goto(BASE);
      await page.getByRole('button', { name: 'Add my name' }).click();
      await page.getByLabel('Your name').fill(typed);
      await page.getByRole('button', { name: 'Continue' }).click();
      return { ctx, page };
    };
    await check('Add my name "Ryann": "Is this you?" offers Ryan; "No, I\'m new" -> days -> Both -> home as Ryann (Tue and Thu saved)', async () => {
      const { ctx, page } = await addFlow('Ryann');
      await page.getByRole('heading', { name: 'Is this you?' }).waitFor();
      const offered = await page.locator('section[aria-label="Is this you?"] .name-grid button').allInnerTexts();
      assert(offered.includes('Ryan'), `offered ${offered}`);
      await page.getByRole('button', { name: "No, I'm new" }).click();
      await page.getByRole('heading', { name: 'Any preferred days?' }).waitFor();
      await page.getByRole('button', { name: 'Both' }).click();
      await page.getByRole('heading', { level: 1, name: 'Ryann' }).waitFor();
      const p = (await dash()).players.find((x) => x.name === 'Ryann');
      assert(p && p.isActive !== false, 'Ryann not on the list');
      assert(String(p.usualDays ?? '').includes('2') && String(p.usualDays ?? '').includes('4'), `days ${JSON.stringify(p.usualDays)}`);
      await ctx.close();
    });
    await check('Add my name "sam": "Is this you?" offers "🏓 Sam"; tapping it picks that name and adds nobody', async () => {
      const before = (await dash()).players.length;
      const { ctx, page } = await addFlow('sam');
      await page.getByRole('heading', { name: 'Is this you?' }).waitFor();
      await page.getByRole('button', { name: '🏓 Sam', exact: true }).click();
      await page.getByRole('heading', { level: 1, name: '🏓 Sam' }).waitFor();
      assert((await dash()).players.length === before, 'a name was added');
      await ctx.close();
    });
    await check('Add my name exactly "ryan", then "No, I\'m new": friendly "Someone already uses" note, back on the name step', async () => {
      const { ctx, page } = await addFlow('ryan');
      await page.getByRole('heading', { name: 'Is this you?' }).waitFor();
      await page.getByRole('button', { name: "No, I'm new" }).click();
      await page.getByText(/Someone already uses/).waitFor();
      assert(await page.getByLabel('Your name').isVisible(), 'not back on the name step');
      assert((await dash()).players.filter((p) => /^ryan$/i.test(p.name)).length === 1, 'a second Ryan was added');
      await ctx.close();
    });
    await check('FIXED (Nov 1): Add my name "Jose" when "José" is on the list asks "Is this you?" (accents are dropped, not folded)', async () => {
      const { ctx, page } = await addFlow('Jose');
      const got = await Promise.race([
        page.getByRole('heading', { name: 'Is this you?' }).waitFor().then(() => 'asked'),
        page.getByRole('heading', { name: 'Any preferred days?' }).waitFor().then(() => 'added'),
      ]);
      // Keep the list tidy for the rest of the run.
      const extra = (await dash()).players.find((p) => p.name === 'Jose');
      if (extra) await areq.delete(`${BASE}/api/admin/players/${extra.id}`, { headers: { Origin: BASE } });
      await ctx.close();
      assert(got === 'asked', '"Jose" was added as a brand new player next to "José" with no "Is this you?" (duplicate)');
    });
    await check('Add my name: Continue is off for an empty or spaces-only name; Back returns to the name list', async () => {
      const ctx = await browser.newContext(phone(390, 'light'));
      const page = await ctx.newPage();
      await page.goto(BASE);
      await page.getByRole('button', { name: 'Add my name' }).click();
      assert(await page.getByRole('button', { name: 'Continue' }).isDisabled(), 'Continue on with nothing typed');
      await page.getByLabel('Your name').fill('   ');
      assert(await page.getByRole('button', { name: 'Continue' }).isDisabled(), 'Continue on with only spaces');
      await page.getByRole('button', { name: 'Back' }).click();
      await page.locator('section[aria-label="Pick your name"]').waitFor();
      await ctx.close();
    });
    await check('a name the organizer removed while the page is open: a tap says so clearly, then the page asks "Who are you?" without that name', async () => {
      const { ctx, page } = await open('Quinn');
      const r = await (await areq.delete(`${BASE}/api/admin/players/${idOf('Quinn')}`, { headers: { Origin: BASE } })).json();
      assert(r.result === 'hidden', `remove result ${JSON.stringify(r)}`);
      await card(page, G[4]).getByRole('button', { name: "I'm in" }).click();
      const said = await waitBanner(page, /\S/, 4000);
      assert(/name|who are you/i.test(said), `banner: "${said}"`);
      await page.getByRole('heading', { level: 1, name: 'Who are you?' }).waitFor({ timeout: 12000 });
      assert((await page.getByRole('button', { name: 'Quinn', exact: true }).count()) === 0, 'Quinn still offered');
      assert((await statusOf('Quinn', G[4])) === null, 'Quinn got a seat after removal');
      await ctx.close();
    });
    await check('a name deleted while the phone remembers it (no history): next open is "Who are you?", no error', async () => {
      const ctx = await browser.newContext(phone(390, 'light'));
      await post(ctx.request, '/api/me', { playerId: idOf('Remy') });
      const r = await (await areq.delete(`${BASE}/api/admin/players/${idOf('Remy')}`, { headers: { Origin: BASE } })).json();
      assert(r.result === 'deleted', JSON.stringify(r));
      const page = await ctx.newPage();
      await page.goto(BASE);
      await page.getByRole('heading', { level: 1, name: 'Who are you?' }).waitFor();
      assert((await page.getByRole('alert').count()) === 0, 'an error showed');
      await ctx.close();
    });
    for (const [w, scheme] of [
      [320, 'light'],
      [320, 'dark'],
      [390, 'dark'],
    ]) {
      await check(`long name as "me" at ${w} px ${scheme}: title and names fit, every name on the full card, no sideways scroll`, async () => {
        const { ctx, page } = await open(LONG, { width: w, scheme });
        const h1 = await page.locator('header h1').boundingBox();
        const vw = w;
        assert(h1.x >= 0 && h1.x + h1.width <= vw + 0.5, `title box ${JSON.stringify(h1)}`);
        const s = await noSideScroll(page);
        assert(s.sw <= s.iw, `sideways scroll ${s.sw} > ${s.iw}`);
        const title = await card(page, G[2]).locator('.names-line').getAttribute('title');
        for (const n of ["O'Brien", 'José', '🏓 Sam', LONG, 'Ryan', 'Julian']) assert(title.includes(n), `${n} missing from ${title}`);
        const r = await card(page, G[2]).evaluate((el) => {
          const c = el.getBoundingClientRect();
          return [...el.querySelectorAll('*')].filter((x) => {
            const b = x.getBoundingClientRect();
            return b.width > 0 && (b.right > c.right + 1 || b.left < c.left - 1);
          }).length;
        });
        assert(r === 0, `${r} things stick out of the card`);
        await ctx.close();
      });
    }
    await check('"Who are you?" name buttons fit at 320 px (long name wraps, nothing off screen)', async () => {
      const ctx = await browser.newContext(phone(320, 'dark'));
      const page = await ctx.newPage();
      await page.goto(BASE);
      await page.getByRole('heading', { level: 1, name: 'Who are you?' }).waitFor();
      const out = await page.locator('.name-grid button').evaluateAll((els) => els.filter((e) => e.getBoundingClientRect().right > window.innerWidth + 0.5 || e.scrollWidth > e.clientWidth + 1).map((e) => e.innerText));
      assert(out.length === 0, `cut off: ${out}`);
      const s = await noSideScroll(page);
      assert(s.sw <= s.iw, `sideways scroll ${s.sw}`);
      await ctx.close();
    });
    await check('apostrophe and emoji names: the Venmo note on Pay carries the exact name', async () => {
      for (const n of ["O'Brien", '🏓 Sam']) {
        const { ctx, page } = await open(n);
        const href = await card(page, G[2]).locator('a[aria-label^="Pay $14"]').getAttribute('href');
        const decoded = decodeURIComponent(href.replace(/\+/g, ' '));
        assert(decoded.includes(n), `${n}: ${decoded}`);
        await ctx.close();
      }
    });
  }

  // ==================================================================================== DROP OUT + UNDO
  if (want('drop')) {
    console.log('\nDrop out and the 5-second Undo');
    // Casey: paid cash. Devon: paid with credit. Emery: $5 credit on a $14 seat. Frankie: unpaid.
    await join('Casey', G[0]);
    await confirmPaid('Casey', G[0]);
    await giveCredit('Devon');
    await join('Devon', G[0]);
    await giveCredit('Emery', 500);
    await join('Emery', G[0]);
    await join('Frankie', G[0]);
    // Gus waits on the full G[2] (filled in the identity part; fill it here if that was skipped).
    for (const n of ['Ryan', 'Julian', "O'Brien", 'José', '🏓 Sam', LONG]) await join(n, G[2]);
    await join('Gus', G[2]);
    await join('Hal', G[1]);
    await giveCredit('Ivy');
    await join('Ivy', G[1]);
    await join('Jade', G[1]);
    await confirmPaid('Jade', G[1]);
    await giveCredit('Kai');
    await join('Kai', G[4]);
    await giveCredit('Lee');
    await join('Lee', G[4]);

    await check('setup reads right on the server: Casey paid $14, Devon paid with credit, Emery $5 credit used, Frankie owes, Gus waits', async () => {
      const c = await mineOf('Casey', G[0]);
      const dv = await mineOf('Devon', G[0]);
      const e = await mineOf('Emery', G[0]);
      const f = await mineOf('Frankie', G[0]);
      const g = await mineOf('Gus', G[2]);
      assert(c.paymentStatus === 'paid' && !c.paidWithCredit, `Casey ${JSON.stringify(c)}`);
      assert(dv.paidWithCredit, `Devon ${JSON.stringify(dv)}`);
      assert(e.creditCents === 500 && e.oweCents === 900, `Emery ${e.creditCents}/${e.oweCents}`);
      assert(f.oweCents === 1400 && f.paymentStatus === 'unpaid', 'Frankie');
      assert(g.status === 'waitlisted' && g.waitlistPosition === 1, `Gus ${g.status}`);
    });

    await check('paid cash: Drop out -> card out at once, "You dropped out. $14 back as credit." with Undo, CREDIT chip $14, nothing sent', async () => {
      const { ctx, page, seen } = await open('Casey');
      assert(/Paid \$14/.test(await card(page, G[0]).innerText()), 'not Paid $14');
      assert((await chipLabel(page)) === null, 'chip before the drop');
      await tapDrop(page, G[0]);
      await page.waitForFunction((id) => document.getElementById(`row-${id}`).dataset.mine !== 'in', G[0].id, { timeout: 600 });
      const b = await waitBanner(page, /You dropped out/);
      assert(/You dropped out\. \$14 back as credit\./.test(b) && /Undo/.test(b), b);
      assert(/^\$14 credit/.test((await until(() => chipLabel(page), 2000)) || ''), `chip ${await chipLabel(page)}`);
      await sleep(2000);
      assert(seen.withdraw === 0, 'sent before 5 seconds');
      // Undo in time: nothing changes on the server, the chip goes away.
      await sleep(650); // a person's deliberate Undo, not the second half of a double tap (src/ui.tsx DOUBLE_TAP)
      await banner(page).getByRole('button', { name: 'Undo' }).click();
      await page.waitForFunction((id) => document.getElementById(`row-${id}`).dataset.mine === 'in', G[0].id, { timeout: 2000 });
      assert((await until(async () => (await chipLabel(page)) === null, 2000)) === true, 'chip stayed after Undo');
      await sleep(5500);
      assert(seen.withdraw === 0, 'a withdraw went out after Undo');
      const m = await mineOf('Casey', G[0]);
      assert(m.status === 'confirmed' && m.paymentStatus === 'paid' && (await potOf('Casey')) === 0, `server changed: ${m.status} ${m.paymentStatus}`);
      await ctx.close();
    });
    await check('paid cash: drop left alone -> sent once after 5 s; server out with $14 credit; screen matches (I\'m in button, chip $14)', async () => {
      const { ctx, page, seen } = await open('Casey');
      await tapDrop(page, G[0]);
      await sleep(6500);
      assert(seen.withdraw === 1, `withdraws ${seen.withdraw}`);
      assert((await statusOf('Casey', G[0])) === 'withdrawn', 'still in');
      assert((await potOf('Casey')) === 1400, `pot ${await potOf('Casey')}`);
      await card(page, G[0]).getByRole('button', { name: "I'm in" }).waitFor();
      assert(/^\$14 credit/.test((await chipLabel(page)) || ''), `chip ${await chipLabel(page)}`);
      await ctx.close();
    });
    await check('the Oct 31 bug path: after a paid drop, I\'m in on the same game uses the credit by itself ("Paid with credit", pot $0)', async () => {
      const { ctx, page } = await open('Casey');
      await card(page, G[0]).getByRole('button', { name: "I'm in" }).click();
      // Casey is the 4th in, so the banner may be "Game on!" with the money.
      const b = await waitBanner(page, /You're in|Game on!/);
      assert(/\$14 credit used/.test(b), b);
      await card(page, G[0]).getByText('Paid with credit').waitFor({ timeout: 4000 });
      const m = await mineOf('Casey', G[0]);
      assert(m.paidWithCredit && (await potOf('Casey')) === 0, `server ${JSON.stringify(m)} pot ${await potOf('Casey')}`);
      assert((await chipLabel(page)) === null, 'chip still shows after the credit was used');
      await ctx.close();
    });
    await check('paid with credit: Drop out says "$14 credit returned." and Undo leaves the server exactly as it was', async () => {
      const { ctx, page, seen } = await open('Devon');
      await tapDrop(page, G[0]);
      const b = await waitBanner(page, /You dropped out/);
      assert(/You dropped out\. \$14 credit returned\./.test(b), b);
      await sleep(1000);
      await sleep(650); // a person's deliberate Undo, not the second half of a double tap (src/ui.tsx DOUBLE_TAP)
      await banner(page).getByRole('button', { name: 'Undo' }).click();
      await sleep(5500);
      assert(seen.withdraw === 0, 'sent after Undo');
      const m = await mineOf('Devon', G[0]);
      assert(m.status === 'confirmed' && m.paidWithCredit && (await potOf('Devon')) === 0, 'server changed');
      assert(await isIn(page, G[0]), 'card not back in');
      await ctx.close();
    });
    await check('paid with credit: drop sent -> pot $14 and the credit sheet says it came back from Nov 3 because you dropped', async () => {
      const { ctx, page } = await open('Devon');
      await tapDrop(page, G[0]);
      await sleep(6500);
      assert((await statusOf('Devon', G[0])) === 'withdrawn' && (await potOf('Devon')) === 1400, 'server not out with $14');
      await page.locator('[data-credit-chip]').click();
      const sheet = page.locator('[data-credit-sheet]');
      await sheet.waitFor();
      const lines = await sheet.locator('[data-credit-change]').allInnerTexts();
      assert(lines.some((l) => /Nov 3/.test(l) && /you dropped/.test(l)), `history: ${lines.join(' / ')}`);
      assert(/\$14 credit/.test(await sheet.locator('[data-credit-balance]').innerText()), 'balance line');
      await ctx.close();
    });
    await check('part credit: card shows "Credit $5 used" and "$9 due"; Drop out says "$5 credit returned."; sent -> pot $5', async () => {
      const { ctx, page } = await open('Emery');
      const t = squash(await card(page, G[0]).innerText());
      assert(/Credit \$5 used/.test(t) && /\$9 due/.test(t), t);
      await tapDrop(page, G[0]);
      const b = await waitBanner(page, /You dropped out/);
      assert(/You dropped out\. \$5 credit returned\./.test(b), b);
      await sleep(6500);
      assert((await statusOf('Emery', G[0])) === 'withdrawn' && (await potOf('Emery')) === 500, `pot ${await potOf('Emery')}`);
      await ctx.close();
    });
    await check('unpaid: Drop out says just "You dropped out." (no money words), then the seat is gone and no credit appears', async () => {
      const { ctx, page } = await open('Frankie');
      assert(/\$14 due/.test(await card(page, G[0]).innerText()), 'no $14 due');
      await tapDrop(page, G[0]);
      const b = await waitBanner(page, /You dropped out/);
      assert(/^You dropped out\.( Undo)?$/.test(b.replace(/^[^A-Za-z]+/, '')), b);
      assert((await chipLabel(page)) === null, 'a chip appeared for an unpaid drop');
      await sleep(6500);
      assert((await statusOf('Frankie', G[0])) === 'withdrawn' && (await potOf('Frankie')) === 0, 'server');
      await ctx.close();
    });
    await check('Go back on the "Out for ...?" question changes nothing (no hold, no banner, nothing sent)', async () => {
      const { ctx, page, seen } = await open('Frankie');
      await card(page, G[0]).getByRole('button', { name: "I'm in" }).click();
      await waitBanner(page, /You're in/);
      await card(page, G[0]).getByRole('button', { name: 'Drop out' }).click();
      await page.locator('dialog[open]').getByRole('button', { name: 'Go back' }).click();
      await sleep(6000);
      assert(seen.withdraw === 0 && (await statusOf('Frankie', G[0])) === 'confirmed' && (await isIn(page, G[0])), 'changed');
      await ctx.close();
    });
    await check('waitlisted: card says "Waitlist, 1st in line"; Leave waitlist goes at once (no Undo) with "You\'re off the list"', async () => {
      const { ctx, page } = await open('Gus');
      assert(/Waitlist, 1st in line/.test(await card(page, G[2]).innerText()), squash(await card(page, G[2]).innerText()));
      await card(page, G[2]).getByRole('button', { name: 'Leave waitlist' }).click();
      await page.locator('dialog[open]').getByRole('button', { name: 'Leave waitlist' }).click();
      const b = await waitBanner(page, /off the list/);
      assert(!/Undo/.test(b), b);
      assert((await statusOf('Gus', G[2])) === 'withdrawn', 'still waiting');
      await ctx.close();
    });
    await check('Undo too late (the page hid and sent the drop): "Too late, you\'re already out. Tap I\'m in to rejoin." and the card stays out', async () => {
      const { ctx, page } = await open('Hal');
      await tapDrop(page, G[1]);
      await waitBanner(page, /You dropped out/);
      await setHidden(page, true);
      await until(async () => (await statusOf('Hal', G[1])) === 'withdrawn', 4000);
      await setHidden(page, false);
      assert((await statusOf('Hal', G[1])) === 'withdrawn', 'drop not sent while hidden');
      await sleep(650); // a person's deliberate Undo, not the second half of a double tap (src/ui.tsx DOUBLE_TAP)
      await banner(page).getByRole('button', { name: 'Undo' }).click();
      const b = await waitBanner(page, /Too late/);
      assert(/Too late, you're already out\. Tap I'm in to rejoin\./.test(b), b);
      await sleep(800);
      assert(!(await isIn(page, G[1])), 'card claims I am in');
      assert((await statusOf('Hal', G[1])) === 'withdrawn', 'server');
      await ctx.close();
    });
    await check('reload during the window (paid with credit): afterwards the drop happened fully or not at all, and the screen matches the server', async () => {
      const { ctx, page } = await open('Ivy');
      await tapDrop(page, G[1]);
      await sleep(1000);
      await page.reload();
      await page.locator('.schedule article').first().waitFor();
      await sleep(8500);
      const m = await mineOf('Ivy', G[1]);
      const pot = await potOf('Ivy');
      const out = m.status === 'withdrawn' && pot === 1400;
      const kept = m.status === 'confirmed' && m.paidWithCredit && pot === 0;
      assert(out || kept, `half way: ${m.status} paidWithCredit=${m.paidWithCredit} pot=${pot}`);
      const cardIn = await isIn(page, G[1]);
      const chip = await chipLabel(page);
      assert(out ? !cardIn && /^\$14 credit/.test(chip || '') : cardIn && chip === null, `screen ${cardIn ? 'in' : 'out'}, chip ${chip}, server ${out ? 'out' : 'in'}`);
      console.log(`      (reload during the window: drop ${out ? 'went through' : 'did not happen'})`);
      await ctx.close();
    });
    await check('close the page during the window (paid cash): the drop is finished (right away, or by the note on the next open), $14 credit', async () => {
      const { ctx, page } = await open('Jade');
      await tapDrop(page, G[1]);
      await sleep(800);
      await page.close({ runBeforeUnload: true });
      let ok = await until(async () => (await statusOf('Jade', G[1])) === 'withdrawn', 2500);
      let how = 'keepalive on close';
      if (!ok) {
        how = 'note on next open';
        const p2 = await ctx.newPage();
        await p2.goto(BASE);
        ok = await until(async () => (await statusOf('Jade', G[1])) === 'withdrawn', 15000);
      }
      assert(ok, 'drop lost');
      assert((await potOf('Jade')) === 1400, `pot ${await potOf('Jade')}`);
      console.log(`      (finished by: ${how})`);
      await ctx.close();
    });
    await check('drop then I\'m in on the SAME game within 5 s: "You\'re back in", nothing sent, server and chip unchanged', async () => {
      const { ctx, page, seen } = await open('Kai');
      await tapDrop(page, G[4]);
      await waitBanner(page, /You dropped out/);
      await sleep(700);
      await card(page, G[4]).getByRole('button', { name: "I'm in" }).click();
      await waitBanner(page, /You're back in/);
      await sleep(6000);
      assert(seen.withdraw === 0 && seen.join === 0, `sent: ${seen.order}`);
      const m = await mineOf('Kai', G[4]);
      assert(m.status === 'confirmed' && m.paidWithCredit && (await potOf('Kai')) === 0, 'server changed');
      assert((await isIn(page, G[4])) && (await chipLabel(page)) === null, 'screen');
      await ctx.close();
    });
    await check('drop then I\'m in on a DIFFERENT game within 5 s: the drop goes first and its $14 lands on the new seat ("Paid with credit")', async () => {
      const { ctx, page, seen } = await open('Lee');
      await tapDrop(page, G[4]);
      await waitBanner(page, /You dropped out/);
      await sleep(700);
      await card(page, G[5]).getByRole('button', { name: "I'm in" }).click();
      const b = await waitBanner(page, /You're in/, 8000);
      assert(/\$14 credit used/.test(b), b);
      await sleep(1500);
      assert(seen.order.join(',') === `withdraw:${G[4].id},join:${G[5].id}`, `order ${seen.order}`);
      assert((await statusOf('Lee', G[4])) === 'withdrawn', 'old seat');
      const m = await mineOf('Lee', G[5]);
      assert(m.paidWithCredit && (await potOf('Lee')) === 0, `new seat ${JSON.stringify(m)} pot ${await potOf('Lee')}`);
      await card(page, G[5]).getByText('Paid with credit').waitFor({ timeout: 3000 });
      await ctx.close();
    });
    await check('FIXED (Nov 1): Drop out, reload within 5 s, then I\'m in on the same game: still in 10 s later (the old drop note is never sent again)', async () => {
      await join('Lee', G[1]);
      const { ctx, page } = await open('Lee');
      await tapDrop(page, G[1]);
      await waitBanner(page, /You dropped out/);
      await sleep(1200);
      await page.reload();
      await card(page, G[1]).waitFor();
      await until(async () => (await statusOf('Lee', G[1])) === 'withdrawn', 4000);
      const btn = card(page, G[1]).getByRole('button', { name: "I'm in" });
      await btn.waitFor({ timeout: 8000 });
      await btn.click();
      await until(async () => (await statusOf('Lee', G[1])) === 'confirmed', 4000);
      await sleep(10_000);
      assert((await statusOf('Lee', G[1])) === 'confirmed', `dropped again by the old note: ${await statusOf('Lee', G[1])}`);
      assert(await isIn(page, G[1]), 'screen says out');
      await ctx.close();
    });
    await check('FIXED (Nov 1): View as: Drop out, then Exit within 5 s: nothing real changes (the demo drop never reaches the live site)', async () => {
      // Two fresh players in an otherwise unused game. The organizer's own browser also remembers Una's name.
      for (const name of ['Una Viewas', 'Vic Viewas']) {
        const r = await post(areq, '/api/admin/players', { name, phone: `2485550${name === 'Una Viewas' ? '901' : '902'}` });
        assert(r.ok(), `add ${name}: ${await r.text()}`);
      }
      const dd = await dash();
      const pid = (n) => dd.players.find((p) => p.name === n).id;
      const una = await browser.newContext();
      await post(una.request, '/api/me', { playerId: pid('Una Viewas') });
      const vic = await browser.newContext();
      await post(vic.request, '/api/me', { playerId: pid('Vic Viewas') });
      for (const c of [una, vic]) assert((await post(c.request, `/api/sessions/${G[7].id}/join`, {})).ok(), 'join');
      const actx = await browser.newContext(phone(390, 'light'));
      await post(actx.request, '/api/admin/login', { pin: PIN });
      await post(actx.request, '/api/me', { playerId: pid('Una Viewas') });
      const page = await actx.newPage();
      await page.goto(`${BASE}/admin`);
      await page.getByRole('button', { name: 'View as…' }).click();
      await page.locator('dialog[open]').getByRole('button', { name: 'Vic Viewas', exact: true }).click();
      await page.getByRole('region', { name: 'Viewing as a player' }).getByText('Viewing as').waitFor();
      await page.locator('.schedule article').first().waitFor();
      const more = page.getByRole('button', { name: /^More sessions/ });
      if (await more.count()) await more.click();
      await card(page, G[7]).waitFor();
      await tapDrop(page, G[7]);
      await page.locator('[data-banner]').getByText(/You dropped out/).waitFor();
      await page.getByRole('region', { name: 'Viewing as a player' }).getByRole('button', { name: 'Exit' }).click();
      await sleep(8000);
      const st = async (c) => (await (await c.request.get(`${BASE}/api/group`)).json()).sessions.find((x) => x.id === G[7].id).mine?.status;
      assert((await st(una)) === 'confirmed', `the organizer's own remembered player (Una) was dropped: ${await st(una)}`);
      assert((await st(vic)) === 'confirmed', `the viewed player (Vic) was really dropped: ${await st(vic)}`);
      await actx.close();
      await una.close();
      await vic.close();
    });
    await check('FIXED (Nov 1): View as yourself, Drop out, close the tab within 5 s, then open your real page: you are NOT dropped for real', async () => {
      const r = await post(areq, '/api/admin/players', { name: 'Wes Viewas', phone: '2485550903' });
      assert(r.ok(), `add Wes: ${await r.text()}`);
      const wid = (await dash()).players.find((p) => p.name === 'Wes Viewas').id;
      const actx = await browser.newContext(phone(390, 'light'));
      await post(actx.request, '/api/admin/login', { pin: PIN });
      await post(actx.request, '/api/me', { playerId: wid });
      assert((await post(actx.request, `/api/sessions/${G[7].id}/join`, {})).ok(), 'join');
      const page = await actx.newPage();
      await page.goto(`${BASE}/admin`);
      await page.getByRole('button', { name: 'View as…' }).click();
      await page.locator('dialog[open]').getByRole('button', { name: 'Wes Viewas', exact: true }).click();
      await page.getByRole('region', { name: 'Viewing as a player' }).getByText('Viewing as').waitFor();
      await page.locator('.schedule article').first().waitFor();
      const more = page.getByRole('button', { name: /^More sessions/ });
      if (await more.count()) await more.click();
      await card(page, G[7]).waitFor();
      await tapDrop(page, G[7]);
      await page.locator('[data-banner]').getByText(/You dropped out/).waitFor();
      // The root of it: a demo drop must not leave a note on the phone that the live page would finish later
      // (a phone killed in the 5 seconds never gets to clear it).
      const during = await page.evaluate(() => localStorage.getItem('pb_pending_drop'));
      assert(during === null, `View as wrote a real drop note: ${during}`);
      await page.close({ runBeforeUnload: true });
      const real = await actx.newPage();
      await real.goto(BASE);
      await real.locator('.schedule article').first().waitFor();
      await sleep(10_000);
      const st = (await (await actx.request.get(`${BASE}/api/group`)).json()).sessions.find((x) => x.id === G[7].id).mine?.status;
      assert(st === 'confirmed', `the demo drop finished on the live site: ${st}`);
      const note = await real.evaluate(() => localStorage.getItem('pb_pending_drop'));
      assert(note === null, `a demo drop left a real drop note: ${note}`);
      await actx.close();
    });
    await check('FIXED (Nov 1): a drop that failed with no signal, then I\'m in on that game while the page is still checking the server: they stay in', async () => {
      const r = await post(areq, '/api/admin/players', { name: 'Xan Race', phone: '2485550904' });
      assert(r.ok(), `add Xan: ${await r.text()}`);
      const xid = (await dash()).players.find((p) => p.name === 'Xan Race').id;
      const ctx = await browser.newContext(phone(390, 'light'));
      await post(ctx.request, '/api/me', { playerId: xid });
      assert((await post(ctx.request, `/api/sessions/${G[7].id}/join`, {})).ok(), 'join');
      const st = async () => (await (await ctx.request.get(`${BASE}/api/group`)).json()).sessions.find((x) => x.id === G[7].id).mine?.status;
      const page = await ctx.newPage();
      await page.goto(BASE);
      await page.locator('.schedule article').first().waitFor();
      const more = page.getByRole('button', { name: /^More sessions/ });
      if (await more.count()) await more.click();
      await card(page, G[7]).waitFor();
      await tapDrop(page, G[7]);
      await page.locator('[data-banner]').getByText(/You dropped out/).waitFor();
      // No signal while the phone is put away: the held drop's send fails and its note stays.
      await ctx.setOffline(true);
      await setHidden(page, true);
      await sleep(1500);
      assert(await page.evaluate(() => !!localStorage.getItem('pb_pending_drop')), 'note should stay after a failed send');
      assert((await st()) === 'confirmed', 'the drop should not have landed');
      // Signal back, but the page's check of the server is slow; wait until the note is old enough to be sent.
      await sleep(6500);
      let slow = true;
      await page.route('**/api/group', async (route) => {
        if (slow && route.request().method() === 'GET') await new Promise((res) => setTimeout(res, 3000));
        await route.continue();
      });
      await ctx.setOffline(false);
      await setHidden(page, false);
      await sleep(300);
      // While that check is still loading, I'm in on the same game.
      const btn = card(page, G[7]).getByRole('button', { name: "I'm in" });
      await btn.waitFor({ timeout: 5000 });
      await btn.click();
      await sleep(6000);
      slow = false;
      await sleep(4000);
      assert((await st()) === 'confirmed', `tapped I'm in last but the old drop went out: ${await st()}`);
      await ctx.close();
    });
    await check('FIXED (Nov 1): Drop out on A fails with no signal (app put away), then Drop out on B: both drops land (one note per game)', async () => {
      // The group is at its player limit by now: Xan (from the check above, still in G[7]) plays again.
      const yid = (await dash()).players.find((p) => p.name === 'Xan Race').id;
      const ctx = await browser.newContext(phone(390, 'light'));
      await post(ctx.request, '/api/me', { playerId: yid });
      for (const s of [G[7], G[9]]) assert((await post(ctx.request, `/api/sessions/${s.id}/join`, {})).ok(), 'join');
      const st = async (s) => (await (await ctx.request.get(`${BASE}/api/group`)).json()).sessions.find((x) => x.id === s.id).mine?.status;
      const page = await ctx.newPage();
      await page.goto(BASE);
      await page.locator('.schedule article').first().waitFor();
      const more = page.getByRole('button', { name: /^More sessions/ });
      if (await more.count()) await more.click();
      await card(page, G[9]).waitFor();
      await tapDrop(page, G[7]);
      await page.locator('[data-banner]').getByText(/You dropped out/).waitFor();
      await ctx.setOffline(true);
      await setHidden(page, true);
      await sleep(1200);
      await ctx.setOffline(false);
      await setHidden(page, false);
      assert((await st(G[7])) === 'confirmed', 'A should not have landed yet');
      await sleep(600);
      await tapDrop(page, G[9]);
      await page.locator('[data-banner]').getByText(/You dropped out/).waitFor();
      await until(async () => (await st(G[7])) === 'withdrawn' && (await st(G[9])) === 'withdrawn', 20_000, 500);
      assert((await st(G[9])) === 'withdrawn', `B: ${await st(G[9])}`);
      assert((await st(G[7])) === 'withdrawn', `A was lost: ${await st(G[7])}`);
      await sleep(1500);
      assert(await page.evaluate(() => localStorage.getItem('pb_pending_drop') === null), 'notes left behind');
      await ctx.close();
    });
    await check('two drops within 5 s on two games: the first is sent at once, the second keeps its own Undo; both end right', async () => {
      await join('Kai', G[5]);
      const { ctx, page, seen } = await open('Kai');
      // Kai: G[4] paid with credit (pot 0), G[5] unpaid.
      await tapDrop(page, G[4]);
      await waitBanner(page, /You dropped out/);
      await tapDrop(page, G[5]);
      await waitBanner(page, /You dropped out/);
      await until(async () => (await statusOf('Kai', G[4])) === 'withdrawn', 2500);
      assert((await statusOf('Kai', G[4])) === 'withdrawn', 'first drop not sent when the second started');
      await sleep(650); // a person's deliberate Undo, not the second half of a double tap (src/ui.tsx DOUBLE_TAP)
      await banner(page).getByRole('button', { name: 'Undo' }).click();
      await sleep(5500);
      assert((await statusOf('Kai', G[5])) === 'confirmed', 'second drop not undone');
      assert(seen.withdraw === 1, `withdraws ${seen.withdraw}`);
      assert((await potOf('Kai')) === 1400, `pot ${await potOf('Kai')}`);
      assert(!(await isIn(page, G[4])) && (await isIn(page, G[5])), 'screen');
      await ctx.close();
    });
    await check('FIXED (Nov 1): Drop out, then "not you?" and another name within 5 s: the held drop is for the first name only (never sent as the new name)', async () => {
      // Ryan and Julian are both in the full game G[2].
      const { ctx, page } = await open('Ryan');
      await tapDrop(page, G[2]);
      await waitBanner(page, /You dropped out/);
      await page.getByRole('button', { name: 'Not you?' }).click();
      await page.getByRole('button', { name: 'Julian', exact: true }).click();
      await page.getByRole('heading', { level: 1, name: 'Julian' }).waitFor();
      await sleep(7000);
      const ryan = await statusOf('Ryan', G[2]);
      const julian = await statusOf('Julian', G[2]);
      await ctx.close();
      // Put things back for later checks.
      if (julian !== 'confirmed') await join('Julian', G[2]);
      if (ryan !== 'confirmed') await join('Ryan', G[2]);
      assert(julian === 'confirmed', `Julian was dropped by Ryan's held Drop out (Julian ${julian}, Ryan ${ryan})`);
      assert(ryan === 'withdrawn', `Ryan's drop was lost (Ryan ${ryan})`);
    });
    await check('FIXED (Nov 1): a quick double tap on the dialog\'s Drop out drops me (the 2nd tap must not land on the banner\'s Undo and silently keep the seat)', async () => {
      await join('Hal', G[5]);
      const { ctx, page, seen } = await open('Hal');
      await card(page, G[5]).getByRole('button', { name: 'Drop out' }).click();
      const box = await page.locator('dialog[open]').getByRole('button', { name: 'Drop out' }).boundingBox();
      await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
      await sleep(6500);
      const status = await statusOf('Hal', G[5]);
      let detail = '';
      if (status !== 'withdrawn') {
        // Where the banner's Undo sits, measured with one plain tap (then undone).
        await card(page, G[5]).getByRole('button', { name: 'Drop out' }).click();
        await page.locator('dialog[open]').getByRole('button', { name: 'Drop out' }).click();
        const undo = await banner(page).getByRole('button', { name: 'Undo' }).boundingBox();
        await sleep(650); // a person's deliberate Undo, not the second half of a double tap (src/ui.tsx DOUBLE_TAP)
      await banner(page).getByRole('button', { name: 'Undo' }).click();
        const hit = undo && box.x + box.width / 2 >= undo.x && box.x + box.width / 2 <= undo.x + undo.width && box.y + box.height / 2 >= undo.y && box.y + box.height / 2 <= undo.y + undo.height;
        detail = ` dialog Drop out at y=${Math.round(box.y)}..${Math.round(box.y + box.height)}, x=${Math.round(box.x)}..${Math.round(box.x + box.width)}; banner Undo at y=${Math.round(undo.y)}..${Math.round(undo.y + undo.height)}, x=${Math.round(undo.x)}..${Math.round(undo.x + undo.width)}; same spot: ${hit}`;
      }
      await ctx.close();
      assert(status === 'withdrawn' && seen.withdraw === 1, `after "You dropped out" the seat is still ${status} (withdraws ${seen.withdraw}), no "back in" message.${detail}`);
    });
  }

  // ==================================================================================== I'M IN
  if (want('join')) {
    console.log("\nI'm in");
    await check("double tap I'm in: one request, one seat, one banner", async () => {
      const { ctx, page, seen } = await open('Olive');
      const btn = card(page, G[4]).getByRole('button', { name: "I'm in" });
      await btn.evaluate((b) => {
        b.click();
        b.click();
      });
      await waitBanner(page, /You're in/);
      await sleep(1500);
      assert(seen.join === 1, `joins ${seen.join}`);
      assert((await statusOf('Olive', G[4])) === 'confirmed', 'server');
      assert((await banner(page).count()) <= 1, 'two banners');
      await ctx.close();
    });
    await check('slow network: the card says "You\'re in" at once, no "Saving…" stays behind, "$14 due" arrives with the answer', async () => {
      const { ctx, page } = await open('Olive');
      await page.route('**/api/sessions/*/join', async (route) => {
        await sleep(2500);
        await route.continue();
      });
      await card(page, G[5]).getByRole('button', { name: "I'm in" }).click();
      await page.waitForFunction((id) => document.getElementById(`row-${id}`).dataset.mine === 'in', G[5].id, { timeout: 600 });
      // "Game on!" instead when this tap made the 4th (it depends on what ran before in a full run).
      await waitBanner(page, /You're in|Game on!/, 6000);
      await card(page, G[5]).getByText('$14 due').waitFor({ timeout: 3000 });
      await sleep(500);
      assert(!/Saving/.test(await page.locator('main').innerText()), 'Saving… still on screen');
      await ctx.close();
    });
    const errorJoin = async (name, s, fulfil, re) => {
      const { ctx, page } = await open(name);
      await page.route('**/api/sessions/*/join', fulfil);
      await card(page, s).getByRole('button', { name: "I'm in" }).click();
      const b = await waitBanner(page, re, 5000);
      assert(await banner(page).evaluate((e) => e.classList.contains('pop-error')), `not an error banner: ${b}`);
      await page.waitForFunction((id) => document.getElementById(`row-${id}`).dataset.mine !== 'in', s.id, { timeout: 3000 });
      const btn = card(page, s).getByRole('button', { name: "I'm in" });
      await btn.waitFor({ timeout: 3000 });
      assert(await btn.isEnabled(), 'button stuck disabled');
      assert(!/Saving/.test(await card(page, s).innerText()), 'stuck on Saving…');
      assert((await statusOf(name, s)) === null, 'server got a seat');
      await ctx.close();
    };
    await check('server error 500 (JSON): card rolls back, red banner "Something went wrong. Try again.", button usable again', () =>
      errorJoin('Olive', G[3], (r) => r.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'server_error', message: 'Something went wrong. Try again.' }) }), /Something went wrong\. Try again\./),
    );
    await check('server error 502 with an HTML page (no JSON): same friendly "Something went wrong. Try again."', () =>
      errorJoin('Olive', G[3], (r) => r.fulfill({ status: 502, contentType: 'text/html', body: '<html><body>Bad gateway</body></html>' }), /Something went wrong\. Try again\./),
    );
    await check('network cut (request aborted): "No signal, try again", card rolls back', () => errorJoin('Olive', G[3], (r) => r.abort('internetdisconnected'), /No signal, try again/));
    await check('429 from the server: its own words show (no raw code), card rolls back', () =>
      errorJoin('Olive', G[3], (r) => r.fulfill({ status: 429, contentType: 'application/json', body: JSON.stringify({ error: 'rate_limited', message: 'Too many taps. Try again in a minute.' }) }), /Too many taps/),
    );
    await check('offline phone (setOffline): I\'m in says "No signal, try again", the card rolls back, the 5-second checks stay silent', async () => {
      const { ctx, page } = await open('Olive');
      await ctx.setOffline(true);
      await card(page, G[3]).getByRole('button', { name: "I'm in" }).click();
      await waitBanner(page, /No signal, try again/);
      await page.waitForFunction((id) => document.getElementById(`row-${id}`).dataset.mine !== 'in', G[3].id, { timeout: 3000 });
      await page.waitForFunction(() => document.querySelectorAll('.pop').length === 0, null, { timeout: 7000 });
      await sleep(6000);
      assert((await banner(page).count()) === 0, `a banner popped while offline: ${await banner(page).allInnerTexts()}`);
      assert((await page.locator('.schedule article').count()) > 0, 'the schedule went away');
      await ctx.close();
    });
    await check('FIXED (Nov 1): after a failed tap offline, the red "Something went wrong" card goes away once the signal is back (it should not sit over the schedule)', async () => {
      const { ctx, page } = await open('Olive');
      await ctx.setOffline(true);
      await card(page, G[3]).getByRole('button', { name: "I'm in" }).click();
      await waitBanner(page, /No signal, try again/);
      await sleep(1500);
      const alertWhileOffline = await page.getByRole('alert').count();
      await ctx.setOffline(false);
      await sleep(12000);
      const still = await page.getByRole('alert').count();
      const text = still ? squash(await page.getByRole('alert').first().innerText()) : '';
      // Back online, I'm in works.
      await card(page, G[3]).getByRole('button', { name: "I'm in" }).click();
      await waitBanner(page, /You're in/);
      assert((await statusOf('Olive', G[3])) === 'confirmed', 'server');
      await ctx.close();
      assert(still === 0, `an error card ("${text}") still sits above the schedule 12 s after the signal came back (it appeared while offline: ${alertWhileOffline > 0})`);
    });
    await check('I\'m in on a game with no court booked: "Court not booked", "1 of 4 in", no $ due, no Pay', async () => {
      if ((await statusOf('Olive', G[3])) !== 'confirmed') await join('Olive', G[3]);
      const { ctx, page } = await open('Olive');
      const t = squash(await card(page, G[3]).innerText());
      assert(/Court not booked/.test(t) && /1 of 4 in/.test(t), t);
      assert(!/\$\d+ due/.test(t) && (await card(page, G[3]).locator('a[aria-label^="Pay"]').count()) === 0, t);
      assert(!/waitlist|standby|waiting/i.test(t), t);
      await ctx.close();
    });
  }

  // ==================================================================================== LIVE
  if (want('live')) {
    console.log('\nLive refresh and stale screens');
    await check('another player joins while the page is open: the count changes within ~6 s, no reload, no banner', async () => {
      const { ctx, page } = await open('Pia');
      const before = await card(page, G[6]).locator('.in-count').innerText();
      await join('Ned', G[6]);
      const t0 = Date.now();
      await page.waitForFunction(([id, b]) => document.querySelector(`#row-${id} .in-count`).innerText !== b, [G[6].id, before], { timeout: 9000 });
      const took = Date.now() - t0;
      assert(took < 7000, `took ${took} ms`);
      assert((await banner(page).count()) === 0, 'banner');
      await ctx.close();
    });
    await check('phone asleep (hidden): no checks; awake again: one check at once and the change shows', async () => {
      const { ctx, page, seen } = await open('Pia');
      await setHidden(page, true);
      await sleep(400);
      const n = seen.version;
      await join('Max', G[6]);
      await sleep(7000);
      assert(seen.version === n, `asked ${seen.version - n} times while hidden`);
      await setHidden(page, false);
      await page.waitForFunction((id) => /Max/.test(document.getElementById(`row-${id}`).innerText), G[6].id, { timeout: 3000 });
      await ctx.close();
    });

    // Stale screens: the tiny "did anything change?" check is cut, so the page keeps showing what it loaded.
    const stale = async (name) => {
      const o = await open(name);
      await o.page.route('**/api/group/version', (r) => r.abort('internetdisconnected'));
      return o;
    };
    await join('Rex', X.X8);
    await join('Rex', X.X3);
    await giveCredit('Rex');
    await check('stale Use credit: the credit was spent on another game after the page loaded -> clear "no credit" message, nothing moves', async () => {
      const { ctx, page } = await stale('Rex');
      const btn = card(page, X.X8).locator('[data-use-credit]');
      await btn.waitFor();
      await join('Rex', X.X2); // auto credit takes the $14
      await btn.click();
      const b = await waitBanner(page, /credit/i);
      assert(/no credit/i.test(b), b);
      const m = await mineOf('Rex', X.X8);
      assert(m.oweCents === 1400 && m.paymentStatus === 'unpaid' && (await potOf('Rex')) === 0, 'money moved');
      assert((await mineOf('Rex', X.X2)).paidWithCredit, 'X2 lost its credit');
      await ctx.close();
    });
    await check('stale Undo (credit) on a game canceled after the page loaded: a clear message, the pot is exactly $14 (never $28)', async () => {
      const { ctx, page } = await stale('Rex');
      const undo = card(page, X.X2).locator('[data-undo-credit]');
      await undo.waitFor();
      await post(areq, `/api/admin/sessions/${X.X2.id}/decision`, { decision: 'cancel', confirm: true, reason: 'Rain' });
      await undo.click();
      const b = await waitBanner(page, /\S/);
      await card(page, X.X2).getByText(/Canceled/).waitFor({ timeout: 4000 });
      assert((await potOf('Rex')) === 1400, `pot ${await potOf('Rex')}`);
      assert(/cancel|no credit payment/i.test(b), b);
      console.log(`      (stale Undo on a canceled game says: "${b}")`);
      await ctx.close();
    });
    await check('stale Drop out on a game canceled after the page loaded: after the hold, "This session was canceled." and the card shows Canceled; money untouched', async () => {
      const { ctx, page } = await stale('Rex');
      await post(areq, `/api/admin/sessions/${X.X3.id}/decision`, { decision: 'cancel', confirm: true, reason: 'Thanksgiving' });
      await tapDrop(page, X.X3);
      await waitBanner(page, /This session was canceled/, 9000);
      await card(page, X.X3).getByText('Canceled - Thanksgiving').waitFor({ timeout: 4000 });
      assert((await potOf('Rex')) === 1400, 'pot changed');
      await ctx.close();
    });
    await check('stale I\'m in on a game canceled after the page loaded: "This session was canceled.", no seat, card shows the reason', async () => {
      const { ctx, page } = await stale('Rex');
      await post(areq, `/api/admin/sessions/${X.X1.id}/decision`, { decision: 'cancel', confirm: true, reason: 'Court closed' });
      await card(page, X.X1).getByRole('button', { name: "I'm in" }).click();
      await waitBanner(page, /This session was canceled/);
      await card(page, X.X1).getByText('Canceled - Court closed').waitFor({ timeout: 4000 });
      assert((await statusOf('Rex', X.X1)) === null, 'seat on a canceled game');
      assert((await potOf('Rex')) === 1400, 'credit spent on a canceled game');
      await ctx.close();
    });
    await check('stale I\'m in on a game that filled after the page loaded: "You\'re #1 on the waitlist", card says Waitlist (never shown as in)', async () => {
      for (const n of ['Ryan', 'Julian', "O'Brien", 'José', '🏓 Sam']) await join(n, X.X7);
      const { ctx, page } = await stale('Rex');
      await join(LONG, X.X7);
      await card(page, X.X7).getByRole('button', { name: "I'm in" }).click();
      const b = await waitBanner(page, /waitlist|You're in/);
      assert(/#1 on the waitlist/.test(b), b);
      await card(page, X.X7).getByText(/Waitlist, 1st in line/).waitFor({ timeout: 4000 });
      assert(!(await isIn(page, X.X7)), 'card shows in');
      assert((await statusOf('Rex', X.X7)) === 'waitlisted' && (await potOf('Rex')) === 1400, 'server');
      await ctx.close();
    });
    await check('stale "I paid" after the court was switched to Not booked: a clear answer and the card matches the server (no stuck Saving…)', async () => {
      await join('Olive', X.X6);
      const { ctx, page } = await stale('Olive');
      const iPaid = card(page, X.X6).getByRole('button', { name: 'I paid' });
      await iPaid.waitFor();
      await post(areq, `/api/admin/sessions/${X.X6.id}/court-status`, { status: 'not_booked' });
      await iPaid.click();
      const b = await waitBanner(page, /\S/);
      await sleep(1200);
      const m = await mineOf('Olive', X.X6);
      const t = squash(await card(page, X.X6).innerText());
      assert(!/Saving/.test(t), t);
      assert(m.paymentStatus === 'paid' ? /Paid/.test(t) : !/Paid/.test(t), `server ${m.paymentStatus}, card "${t}", banner "${b}"`);
      console.log(`      (I paid on a now Not booked game: banner "${b}", server ${m.paymentStatus})`);
      await ctx.close();
    });

    await check('stale "Didn\'t pay?" after the organizer confirmed the payment: a clear answer, still Paid', async () => {
      const { ctx, page } = await open('Olive');
      await page.route('**/api/group/version', (r) => r.abort('internetdisconnected'));
      const btn = card(page, X.X6).getByRole('button', { name: "Didn't pay?" });
      await btn.waitFor();
      await post(areq, `/api/admin/sessions/${X.X6.id}/payment`, { playerId: idOf('Olive'), paid: true });
      await btn.click();
      const b = await waitBanner(page, /\S/);
      await sleep(800);
      assert((await mineOf('Olive', X.X6)).paymentStatus === 'paid', `payment undone (banner "${b}")`);
      assert(/organizer|Alex/i.test(b), b);
      await ctx.close();
    });
    await check('stale "I paid" on a game canceled after the page loaded: "This session was canceled.", nothing recorded', async () => {
      await join('Frankie', X.X9);
      const { ctx, page } = await open('Frankie');
      await page.route('**/api/group/version', (r) => r.abort('internetdisconnected'));
      const iPaid = card(page, X.X9).getByRole('button', { name: 'I paid' });
      await iPaid.waitFor();
      await post(areq, `/api/admin/sessions/${X.X9.id}/decision`, { decision: 'cancel', confirm: true, reason: 'Rain' });
      await iPaid.click();
      await waitBanner(page, /This session was canceled/);
      await card(page, X.X9).getByText('Canceled - Rain').waitFor({ timeout: 4000 });
      const m = await mineOf('Frankie', X.X9);
      assert(!m || m.paymentStatus !== 'paid', `recorded: ${JSON.stringify(m)}`);
      assert((await potOf('Frankie')) === 0, 'credit made from nothing');
      await ctx.close();
    });
    await check('refresh rhythm (pure LivePoller, fake clock): every 5 s while active, every 15 s after 2 min idle, none after 10 min, a touch wakes it', async () => {
      const esbuild = require('esbuild');
      const src = readFileSync(path.join(ROOT, 'src', 'livecore.ts'), 'utf8');
      const code = esbuild.transformSync(src, { loader: 'ts', format: 'cjs' }).code;
      const mod = { exports: {} };
      new Function('module', 'exports', code)(mod, mod.exports);
      const { LivePoller } = mod.exports;
      let now = 0;
      const timers = [];
      const at = [];
      const p = new LivePoller({
        now: () => now,
        setTimer: (fn, ms) => {
          const t = { fn, due: now + ms };
          timers.push(t);
          return t;
        },
        clearTimer: (t) => {
          const i = timers.indexOf(t);
          if (i >= 0) timers.splice(i, 1);
        },
        fetchStamp: async () => {
          at.push(now);
          return 'same';
        },
        onChange: () => {},
        isVisible: () => true,
      });
      p.start();
      const runTo = async (end) => {
        for (;;) {
          timers.sort((a, b) => a.due - b.due);
          const t = timers[0];
          if (!t || t.due > end) break;
          timers.shift();
          now = t.due;
          t.fn();
          await new Promise((r) => setImmediate(r));
        }
        now = end;
      };
      await runTo(20 * 60_000);
      const inRange = (a, b) => at.filter((x) => x > a && x <= b);
      const first = inRange(0, 120_000);
      const mid = inRange(120_000, 600_000);
      const late = inRange(600_000, 20 * 60_000);
      assert(first.length === 24, `first 2 min: ${first.length} checks`);
      assert(mid.length >= 31 && mid.length <= 33, `2 to 10 min: ${mid.length} checks`);
      assert(late.length === 0, `after 10 min: ${late.length} checks`);
      const before = at.length;
      p.touch();
      await runTo(now + 1);
      await runTo(now + 10_000);
      assert(at.length - before >= 2, `touch did not wake it (${at.length - before})`);
    });
    await check('refresh rhythm in the browser (fake clock): ~5 s checks, ~15 s after 2 min idle, silent after 10 min; a tap wakes it', async () => {
      const ctx = await browser.newContext(phone(390, 'light'));
      await post(ctx.request, '/api/me', { playerId: idOf('Pia') });
      // Each version check is stamped with the page's own (fake) clock.
      await ctx.addInitScript(() => {
        window.__marks = [];
        const f = window.fetch;
        window.fetch = function (input, init) {
          if (String(input).includes('/api/group/version')) window.__marks.push(Date.now());
          return f.call(this, input, init);
        };
      });
      const page = await ctx.newPage();
      await page.clock.install({ time: et('2026-11-02T09:00:00-05:00') });
      await page.goto(BASE);
      await page.locator('.schedule article').first().waitFor();
      const loadedAt = await page.evaluate(() => Date.now());
      const step = async (ms) => {
        await page.clock.runFor(ms);
        await sleep(100);
      };
      for (let t = 0; t < 12 * 60_000; t += 2500) await step(2500);
      const marks = (await page.evaluate(() => window.__marks)).map((x) => x - loadedAt);
      const n = (a, b) => marks.filter((x) => x > a && x <= b).length;
      const first = n(0, 115_000);
      const mid = n(130_000, 595_000);
      const late = n(615_000, 12 * 60_000);
      const gapsMid = marks.filter((x) => x > 130_000 && x <= 595_000).map((x, i, a) => (i ? x - a[i - 1] : null)).filter((x) => x !== null);
      assert(first >= 20 && first <= 24, `first 2 min: ${first} checks`);
      assert(mid >= 28 && mid <= 33 && gapsMid.every((g) => g >= 14_000), `2 to 10 min: ${mid} checks, gaps ${gapsMid.slice(0, 5)}`);
      assert(late === 0, `after 10 min: ${late} checks`);
      const before = marks.length;
      await page.locator('body').dispatchEvent('pointerdown');
      for (let i = 0; i < 4; i++) await step(2500);
      const after = (await page.evaluate(() => window.__marks)).length;
      assert(after - before >= 2, `a tap did not wake it: ${after - before}`);
      await ctx.close();
    });
    await check('back after more than 30 s away (phone slept): the full list loads again even with no change', async () => {
      const ctx = await browser.newContext(phone(390, 'light'));
      await post(ctx.request, '/api/me', { playerId: idOf('Pia') });
      const page = await ctx.newPage();
      await page.clock.install({ time: et('2026-11-02T09:00:00-05:00') });
      let groups = 0;
      page.on('request', (r) => new URL(r.url()).pathname === '/api/group' && groups++);
      await page.goto(BASE);
      await page.locator('.schedule article').first().waitFor();
      await sleep(500);
      const n = groups;
      await setHidden(page, true);
      await page.clock.runFor(31_000);
      await setHidden(page, false);
      await until(() => groups > n, 3000);
      assert(groups > n, 'no reload on return');
      await ctx.close();
    });
  }

  // ==================================================================================== EVERYTHING ELSE
  if (want('else')) {
    console.log('\nEverything else');
    await join('Sky', G[0]);
    await check('Add to calendar: only on games I\'m in; the .ics is valid with 8:00 to 10:00 PM Eastern for Tue Nov 3', async () => {
      const { ctx, page } = await open('Sky');
      const link = card(page, G[0]).locator('a.cal-icon-link');
      await link.waitFor();
      assert((await card(page, G[1]).locator('a.cal-icon-link').count()) === 0, 'calendar link on a game I am not in');
      assert(/Add Tue,? Nov 3 to calendar/.test((await link.getAttribute('aria-label')) || ''), await link.getAttribute('aria-label'));
      const href = await link.getAttribute('href');
      const res = await ctx.request.get(BASE + href);
      assert(res.status() === 200 && /text\/calendar/.test(res.headers()['content-type']), `${res.status()} ${res.headers()['content-type']}`);
      assert(/filename="pickleball-2026-11-03\.ics"/.test(res.headers()['content-disposition'] || ''), res.headers()['content-disposition']);
      const ics = await res.text();
      for (const line of ['BEGIN:VCALENDAR', 'BEGIN:VTIMEZONE', 'TZID:America/Detroit', 'BEGIN:VEVENT', 'DTSTART;TZID=America/Detroit:20261103T200000', 'DTEND;TZID=America/Detroit:20261103T220000', 'END:VEVENT', 'END:VCALENDAR'])
        assert(ics.split('\r\n').includes(line), `missing ${line}`);
      assert(!/DTSTART:\d+T\d+Z/.test(ics), 'UTC time in the file');
      await ctx.close();
    });
    await check('calendar file for Thanksgiving Thu Nov 26 says 8:00 PM local; an unknown game gives a plain 404, not a crash', async () => {
      const ics = await (await setup.get(`${BASE}/api/sessions/${THANKSGIVING.id}/calendar.ics`)).text();
      assert(ics.includes('DTSTART;TZID=America/Detroit:20261126T200000'), ics.slice(0, 300));
      const bad = await setup.get(`${BASE}/api/sessions/00000000-0000-0000-0000-000000000000/calendar.ics`);
      assert(bad.status() === 404, `status ${bad.status()}`);
    });
    await check('light/dark button: Auto -> Light -> Dark with a banner each time, and Dark sticks after a reload (dark background)', async () => {
      const { ctx, page } = await open('Sky', { scheme: 'light' });
      const btn = page.locator('.mode-btn');
      assert((await btn.getAttribute('data-mode')) === 'system', await btn.getAttribute('data-mode'));
      await btn.click();
      await waitBanner(page, /Light/);
      await btn.click();
      await waitBanner(page, /Dark/);
      assert((await page.evaluate(() => document.documentElement.dataset.theme)) === 'dark', 'not dark');
      await page.reload();
      await page.locator('.schedule article').first().waitFor();
      assert((await page.evaluate(() => document.documentElement.dataset.theme)) === 'dark', 'dark lost after reload');
      assert((await btn.getAttribute('data-mode')) === 'dark', 'button forgot');
      const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
      const lum = bg.match(/\d+/g).slice(0, 3).map(Number).reduce((a, b) => a + b, 0);
      assert(lum < 150, `background ${bg}`);
      await ctx.close();
    });
    await check('a phone set to dark that picks Light keeps Light after a reload', async () => {
      const { ctx, page } = await open('Sky', { scheme: 'dark' });
      await page.locator('.mode-btn').click();
      await page.reload();
      await page.locator('.schedule article').first().waitFor();
      const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
      const lum = bg.match(/\d+/g).slice(0, 3).map(Number).reduce((a, b) => a + b, 0);
      assert(lum > 500, `background ${bg}`);
      await ctx.close();
    });
    await check('Organizer sign-in link opens /admin, and the back button returns to "Who are you?"', async () => {
      const ctx = await browser.newContext(phone(390, 'light'));
      const page = await ctx.newPage();
      await page.goto(BASE);
      await page.getByRole('link', { name: 'Organizer sign-in' }).click();
      await page.waitForURL(/\/admin$/);
      await page.goBack();
      await page.getByRole('heading', { level: 1, name: 'Who are you?' }).waitFor();
      await ctx.close();
    });
    await check('a shared link /?s=<game> opens with that game highlighted and in view (even past the first six)', async () => {
      const target = G[8];
      const { ctx, page } = await open('Sky', { url: `/?s=${target.id}`, more: false });
      const c = card(page, target);
      await c.waitFor();
      assert(/highlight/.test(await c.getAttribute('class')), 'not highlighted');
      await sleep(400);
      const box = await c.boundingBox();
      assert(box && box.y < 844 && box.y + box.height > 0, `not in view ${JSON.stringify(box)}`);
      await ctx.close();
    });
    await check('pull to reload (a reload) keeps the name, My games and the theme', async () => {
      const { ctx, page } = await open('Sky');
      await page.locator('.filter-toggle').click();
      await page.waitForFunction(() => /My games/.test(document.querySelector('.filter-toggle').innerText));
      await page.reload();
      await page.locator('.schedule article').first().waitFor();
      assert(/My games/.test(await page.locator('.filter-toggle').innerText()), 'filter forgot');
      assert((await page.locator('header h1').innerText()) === 'Sky', 'name forgot');
      await ctx.close();
    });
    await check('the first load fails with no signal: friendly card with "No signal, try again" and Try again that works', async () => {
      const ctx = await browser.newContext(phone(390, 'light'));
      await post(ctx.request, '/api/me', { playerId: idOf('Sky') });
      const page = await ctx.newPage();
      await page.route('**/api/group', (r) => r.abort('internetdisconnected'));
      await page.goto(BASE);
      await page.getByRole('alert').waitFor();
      const t = squash(await page.getByRole('alert').innerText());
      assert(/No signal, try again/.test(t), t);
      await page.unroute('**/api/group');
      await page.getByRole('button', { name: 'Try again' }).click();
      await page.locator('.schedule article').first().waitFor();
      await ctx.close();
    });
    await check('the first load gets a 500: "Something went wrong" with friendly words (no code, no stack) and Try again', async () => {
      const ctx = await browser.newContext(phone(390, 'dark'));
      await post(ctx.request, '/api/me', { playerId: idOf('Sky') });
      const page = await ctx.newPage();
      await page.route('**/api/group', (r) => r.fulfill({ status: 500, contentType: 'text/plain', body: 'dev api error' }));
      await page.goto(BASE);
      await page.getByRole('alert').waitFor();
      const t = squash(await page.getByRole('alert').innerText());
      assert(/Something went wrong/.test(t) && !/500|dev api error|Error:/.test(t), t);
      await page.unroute('**/api/group');
      await page.getByRole('button', { name: 'Try again' }).click();
      await page.locator('.schedule article').first().waitFor();
      await ctx.close();
    });
    await check('a broken private link (/g/<bad key>): "This group link isn\'t valid" with what to do', async () => {
      const ctx = await browser.newContext(phone(390, 'light'));
      const page = await ctx.newPage();
      await page.goto(`${BASE}/g/not-a-real-key-000000000000`);
      await page.getByText("This group link isn't valid").waitFor();
      assert(/Ask the organizer/.test(await page.locator('main').innerText()), 'no next step');
      await ctx.close();
    });
    await check('empty state: no games at all says "No upcoming sessions yet."', async () => {
      const ctx = await browser.newContext(phone(390, 'light'));
      await post(ctx.request, '/api/me', { playerId: idOf('Pia') });
      const page = await ctx.newPage();
      await page.route('**/api/group', async (r) => {
        const res = await r.fetch();
        const j = await res.json();
        await r.fulfill({ response: res, json: { ...j, sessions: [], payDue: [], owed: [], suggestion: null } });
      });
      await page.goto(BASE);
      await page.getByText('No upcoming sessions yet.').waitFor();
      await ctx.close();
    });
    await check('empty state: My games with no games says "You\'re not in any games yet" and See all games goes back', async () => {
      const { ctx, page } = await open('Pia');
      await page.locator('.filter-toggle').click();
      await page.getByText("You're not in any games yet").waitFor();
      await page.getByRole('button', { name: /See all games/ }).click();
      await page.waitForFunction(() => document.querySelectorAll('.schedule article').length > 3);
      await ctx.close();
    });
    await check('no CREDIT chip at $0', async () => {
      const { ctx, page } = await open('Pia');
      assert((await page.locator('[data-credit-chip]').count()) === 0, 'chip at $0');
      await ctx.close();
    });

    await giveCredit('Sky');
    await check('credit sheet: the chip opens "Your credit" with the balance and plain history; Escape and ✕ close it', async () => {
      const { ctx, page } = await open('Sky');
      assert(/^\$14 credit/.test((await chipLabel(page)) || ''), await chipLabel(page));
      await page.locator('[data-credit-chip]').click();
      const sheet = page.locator('dialog[open]');
      await sheet.getByRole('heading', { name: 'Your credit' }).waitFor();
      assert(/\$14 credit/.test(await sheet.locator('[data-credit-balance]').innerText()), 'balance');
      const lines = await sheet.locator('[data-credit-change]').allInnerTexts();
      assert(lines.length >= 1 && lines.every((l) => /^[A-Z][a-z]{2} \d+: \$\d+/.test(l)), `history ${lines}`);
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => !document.querySelector('dialog[open]'));
      await page.locator('[data-credit-chip]').click();
      await page.locator('dialog[open]').getByRole('button', { name: 'Close' }).click();
      await page.waitForFunction(() => !document.querySelector('dialog[open]'));
      await ctx.close();
    });
    await check('cash out: amount checks ("abc", $20 > $14), request $14 -> pending, chip says CASH OUT; Cancel request -> gone', async () => {
      const { ctx, page } = await open('Sky');
      await page.locator('[data-credit-chip]').click();
      const sheet = page.locator('dialog[open]');
      await sheet.getByRole('button', { name: 'Request cash out from Alex' }).click();
      const input = sheet.locator('[data-refund-ask] input');
      assert((await input.inputValue()) === '14', `prefill ${await input.inputValue()}`);
      await input.fill('abc');
      await sheet.getByRole('button', { name: 'Request cash out from Alex' }).click();
      await sheet.getByText('Enter a whole-dollar amount, like 14.').waitFor();
      await input.fill('20');
      await sheet.getByRole('button', { name: 'Request cash out from Alex' }).click();
      await sheet.getByText('You have $14 credit.').waitFor();
      await input.fill('14');
      await sheet.getByRole('button', { name: 'Request cash out from Alex' }).click();
      await waitBanner(page, /Cash out requested/);
      await sheet.locator('[data-refund-pending]').waitFor();
      assert((await creditOf('Sky')).pending?.cents === 1400, 'server has no request');
      assert(/CASH OUT/.test(await page.locator('[data-credit-chip]').innerText()), 'chip label');
      await sheet.getByRole('button', { name: 'Cancel request' }).click();
      await waitBanner(page, /Request canceled/);
      await sheet.getByRole('button', { name: 'Request cash out from Alex' }).waitFor();
      assert(!(await creditOf('Sky')).pending, 'request still there');
      await ctx.close();
    });
    await join('Sky', G[5]);
    await confirmPaid('Sky', G[5]);
    await check('FIXED (Nov 1): cash out asked for during a drop\'s 5-second Undo (the sheet already shows that credit): it works, or says clearly to wait', async () => {
      const { ctx, page } = await open('Sky');
      // Sky: the $14 credit went on G[5] at I'm in (Paid with credit); the drop shows it back in the chip at once.
      await tapDrop(page, G[5]);
      await waitBanner(page, /You dropped out/);
      await page.locator('[data-credit-chip]').click();
      const sheet = page.locator('dialog[open]');
      await sheet.getByRole('button', { name: 'Request cash out from Alex' }).click();
      const input = sheet.locator('[data-refund-ask] input');
      const pre = await input.inputValue();
      await sheet.getByRole('button', { name: 'Request cash out from Alex' }).click();
      const t0 = Date.now();
      let said = '';
      while (Date.now() - t0 < 4000) {
        said = squash((await sheet.innerText().catch(() => '')) + ' | ' + (await banner(page).allInnerTexts().catch(() => [])).join(' '));
        if (/Cash out requested|You have|wait|look again/i.test(said)) break;
        await sleep(100);
      }
      await sleep(6000);
      const c = await creditOf('Sky');
      if (c.pending) await post(who.Sky, '/api/me/refund-request/cancel', {});
      await ctx.close();
      assert(c.pending?.cents === Number(pre) * 100, `prefilled $${pre}; server request ${JSON.stringify(c.pending)}; the screen said: "${said.slice(0, 200)}"`);
    });
    await giveCredit('Tess');
    await post(who.Tess, '/api/me/refund-request', { cents: 1400 });
    await check('"Use the $14 you asked to cash out for this game?" after I\'m in: Use it -> Paid with credit, the request is gone', async () => {
      const { ctx, page } = await open('Tess');
      await card(page, G[4]).getByRole('button', { name: "I'm in" }).click();
      const q = page.locator('[data-cashout-prompt]');
      await q.waitFor({ timeout: 5000 });
      assert(/Use the \$14 you asked to cash out for this game\?/.test(await q.innerText()), await q.innerText());
      await q.getByRole('button', { name: 'Use it' }).click();
      await waitBanner(page, /Paid with credit/);
      await card(page, G[4]).getByText('Paid with credit').waitFor({ timeout: 4000 });
      const c = await creditOf('Tess');
      assert(!c.pending && c.balanceCents === 0, `credit ${JSON.stringify({ b: c.balanceCents, p: c.pending })}`);
      await ctx.close();
    });
    await post(who.Sky, '/api/me/refund-request', { cents: 1400 });
    await check('the same question, "No, keep cash out": it closes, the card owes $14, the $14 request stays', async () => {
      const { ctx, page } = await open('Sky');
      await card(page, G[4]).getByRole('button', { name: "I'm in" }).click();
      const q = page.locator('[data-cashout-prompt]');
      await q.waitFor({ timeout: 5000 });
      await q.getByRole('button', { name: 'No, keep cash out' }).click();
      await q.waitFor({ state: 'detached', timeout: 3000 });
      await card(page, G[4]).getByText('$14 due').waitFor({ timeout: 4000 });
      assert((await creditOf('Sky')).pending?.cents === 1400, 'request changed');
      await ctx.close();
    });
    for (const [w, scheme] of [
      [320, 'light'],
      [320, 'dark'],
      [390, 'light'],
      [390, 'dark'],
    ]) {
      await check(`home with chip, pay buttons and a full card at ${w} px ${scheme}: no sideways scroll, nothing outside its card`, async () => {
        const { ctx, page } = await open('Emery', { width: w, scheme });
        const s = await noSideScroll(page);
        assert(s.sw <= s.iw, `sideways scroll ${s.sw} > ${s.iw}`);
        const out = await page.locator('.schedule article').evaluateAll((cards) =>
          cards.flatMap((c) => {
            const r = c.getBoundingClientRect();
            return [...c.querySelectorAll('button, a, .pchip, .names-line')].filter((x) => {
              const b = x.getBoundingClientRect();
              return b.width > 0 && (b.right > r.right + 1 || b.left < r.left - 1);
            }).map((x) => x.innerText || x.className);
          }),
        );
        assert(out.length === 0, `outside: ${out.slice(0, 5)}`);
        await ctx.close();
      });
    }
  }

  // ==================================================================================== TIME EDGES (last: they move the server clock)
  if (want('time')) {
    console.log('\nCancel-by and start edges (server and phone clocks moved together)');
    await join('Max', G[1]);
    await join('Ned', G[1]);
    await join('Olive', G[1]);
    await join('Pia', G[0]);
    // A paid seat to drop on game day (the full G[2] has room once Ryan/Julian shuffle; use G[6] to be safe).
    await join('Pia', G[6]);
    await confirmPaid('Pia', G[6]);
    const startT = et('2026-11-05T20:00:00-05:00');
    const cutT = et('2026-11-05T08:00:00-05:00');
    const lateDropsOf = async (n) => (await dash()).players.find((p) => p.name === n).lateDrops;
    await check('FIXED (Nov 1): on a Sunday the drop question says "Out for Tuesday?" (2 days away), not "next Tuesday"; 3 weeks away it names the date', async () => {
      const sun = et('2026-11-01T12:00:00-05:00');
      await setClock(sun);
      const { ctx, page } = await open('Pia', { clockAt: sun });
      const ask = async (s) => {
        await card(page, s).getByRole('button', { name: 'Drop out' }).click();
        const d = page.locator('dialog[open]');
        const t = (await d.getByRole('heading').first().innerText()).trim();
        await d.getByRole('button', { name: /Go back|Cancel/ }).click();
        await d.waitFor({ state: 'detached' }).catch(() => {});
        return t;
      };
      const tue = await ask(G[0]);
      assert(tue === 'Out for Tuesday?', `Tue Nov 3 from Sun Nov 1: "${tue}"`);
      const later = await ask(G[6]);
      assert(/^Out for [A-Z][a-z]{2}, Nov \d{1,2}\?$/.test(later), `three weeks out: "${later}"`);
      assert((await statusOf('Pia', G[0])) === 'confirmed', 'asking changed the seat');
      await ctx.close();
    });
    await check('drop a few seconds before cancel-by: sent at once (no Undo, so the wait never makes it late), not counted as a late drop', async () => {
      await setClock(cutT - 7000);
      const { ctx, page } = await open('Max', { clockAt: cutT - 7000 });
      await tapDrop(page, G[1]);
      const b = await waitBanner(page, /out/);
      assert(!/Undo/.test(b), `Undo offered: ${b}`);
      await until(async () => (await statusOf('Max', G[1])) === 'withdrawn', 2000);
      assert((await statusOf('Max', G[1])) === 'withdrawn', 'not sent');
      assert((await lateDropsOf('Max')) === 0, 'counted as late');
      await ctx.close();
    });
    await check('drop 20 s before cancel-by: normal 5-second Undo, still sent before the deadline, not late', async () => {
      await join('Max', G[1]);
      await setClock(cutT - 20_000);
      const { ctx, page } = await open('Max', { clockAt: cutT - 20_000 });
      await tapDrop(page, G[1]);
      const b = await waitBanner(page, /You dropped out/);
      assert(/Undo/.test(b), b);
      await sleep(6500);
      assert((await statusOf('Max', G[1])) === 'withdrawn', 'not sent');
      assert((await lateDropsOf('Max')) === 0, 'counted as late');
      await ctx.close();
    });
    await check('drop a few seconds before the start: sent at once and works (no Undo window crossing the start)', async () => {
      await setClock(startT - 8000);
      const { ctx, page } = await open('Ned', { clockAt: startT - 8000 });
      await tapDrop(page, G[1]);
      const b = await waitBanner(page, /out/);
      assert(!/Undo/.test(b), b);
      await until(async () => (await statusOf('Ned', G[1])) === 'withdrawn', 2000);
      assert((await statusOf('Ned', G[1])) === 'withdrawn', 'not sent');
      await ctx.close();
    });
    await check('stale Drop out after the start: "This session already started." and the card keeps me in', async () => {
      await setClock(startT - 30_000);
      const { ctx, page } = await open('Olive', { clockAt: startT - 30_000 });
      await page.route('**/api/group/version', (r) => r.abort('internetdisconnected'));
      await setClock(startT + 3000);
      await tapDrop(page, G[1]);
      const b = await waitBanner(page, /started|try again/i, 9000);
      assert(/This session already started\./.test(b), b);
      await sleep(800);
      assert((await statusOf('Olive', G[1])) === 'confirmed', 'seat changed after start');
      assert(await isIn(page, G[1]), 'card shows out');
      await ctx.close();
    });
    await check('stale I\'m in after the start: "This session already started." and no seat', async () => {
      await setClock(startT - 30_000);
      const { ctx, page } = await open('Rex', { clockAt: startT - 30_000 });
      await page.route('**/api/group/version', (r) => r.abort('internetdisconnected'));
      await setClock(startT + 3000);
      await card(page, G[1]).getByRole('button', { name: "I'm in" }).click();
      const b = await waitBanner(page, /started|try again/i, 6000);
      assert(/This session already started\./.test(b), b);
      assert((await statusOf('Rex', G[1])) === null, 'seat after start');
      await ctx.close();
    });
    await check('FIXED (Nov 1): game day: drop a paid later game, then tap Use credit on tonight\'s pay card within 5 s: the drop goes first and the credit pays tonight', async () => {
      await setClock(et('2026-11-03T09:00:00-05:00'));
      const { ctx, page } = await open('Pia', { clockAt: et('2026-11-03T09:00:00-05:00') });
      await tapDrop(page, G[6]);
      await waitBanner(page, /You dropped out\. \$14 back as credit/);
      const use = page.locator('section.pay-card [data-use-credit]');
      await use.waitFor({ timeout: 2000 });
      await use.click();
      const b = await waitBanner(page, /credit/i, 8000);
      await sleep(6500);
      const tonight = await mineOf('Pia', G[0]);
      const thu = await statusOf('Pia', G[6]);
      const pot = await potOf('Pia');
      await ctx.close();
      assert(thu === 'withdrawn', `later seat ${thu}`);
      assert(tonight.paymentStatus === 'paid' && pot === 0, `tonight ${tonight.paymentStatus}, pot ${pot}; banner "${b}"`);
    });
    await check('game day 9 AM: TONIGHT strip on the game, the first card says "8 PM" under the tile, tonight paid with credit so no pay card', async () => {
      await setClock(et('2026-11-03T09:00:00-05:00'));
      const { ctx, page } = await open('Pia', { clockAt: et('2026-11-03T09:00:00-05:00') });
      const c = card(page, G[0]);
      assert(/TONIGHT/.test(await c.locator('.tonight-tag').innerText()), 'no TONIGHT');
      assert(/8:00 PM|8 PM/.test(await c.locator('[data-sched-time]').innerText()), await c.locator('[data-sched-time]').innerText());
      // The check before paid tonight with the credit from the dropped Thursday, so tonight reads paid, no pay card.
      await c.getByText('Paid with credit').waitFor();
      assert((await page.locator('section.pay-card').count()) === 0, 'a pay card for a game already paid');
      await ctx.close();
    });
  }

  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failures.length) console.log(`Failing:\n - ${failures.join('\n - ')}`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
