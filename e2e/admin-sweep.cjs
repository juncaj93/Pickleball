/* Admin audit (Sun Nov 1, 2026): a look-and-access sweep of every organizer tab with many kinds
 * of games on screen (booked, not booked, waitlist, full with a real waitlist, under 4, canceled
 * with a reason, extra game, game today, game in 6 months, finalized past game), a cash-out
 * request and an unconfirmed "I paid". At 320 and 390 px, light and dark:
 *   - no sideways scroll, nothing cut off past the right edge
 *   - every button, link and field has a 44 px tap area (its own box or its ::before)
 *   - text contrast 4.5:1 (3:1 for large text) against what is behind it
 *   - the bottom tab bar never covers the last button on the page
 *   - the gear menu opens on the first, a middle and the last game at the top, middle and
 *     bottom of the screen, inside the screen and above the tab bar, without moving the page
 *   - the View as demo keeps its banner, saves nothing, Reset and Exit work
 * A fake group on a throwaway dev server; nothing here touches the live site.
 *
 *   node e2e/admin-sweep.cjs      (also run by npm run test:e2e)
 */
const { spawn } = require('node:child_process');
const { rmSync, mkdirSync } = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.E2E_PORT) || 5282;
const BASE = `http://localhost:${PORT}`;
const SETUP_TOKEN = 'adminsweep-setup-token-0123456789';
const PIN = '482913';
const NAMES = ['Alex', 'Ryan', 'Julian', 'Nathan', 'Mitchel', 'Brandon', 'Christopher', 'Bartholomew', 'Maximilian', "Seán O'Brien-Núñez", 'Wilhelmina'];
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const SHOTS = path.join(__dirname, 'screenshots');
const HOUR = 3600_000;
const DAY = 24 * HOUR;

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
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const dbFile = path.join(ROOT, '.data', 'adminsweep.sqlite');
  mkdirSync(path.join(ROOT, '.data'), { recursive: true });
  mkdirSync(SHOTS, { recursive: true });
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
  const clock = (atMs) => fetch(`${BASE}/__dev/clock`, { method: 'POST', body: JSON.stringify({ atMs }) });
  const t0 = Date.now();
  await clock(t0);

  const browser = await chromium.launch();
  const post = (req, url, data) => req.post(BASE + url, { data, headers: { Origin: BASE } });
  const put = (req, url, data) => req.put(BASE + url, { data, headers: { Origin: BASE } });
  const setup = (await browser.newContext()).request;
  const made = await post(setup, '/api/setup', {
    setupToken: SETUP_TOKEN,
    groupName: 'Pickleball Bros',
    pin: PIN,
    venmoUrl: 'https://venmo.com/u/organizer',
    players: NAMES.map((name, i) => ({ name, phone: `24855504${String(i).padStart(2, '0')}` })),
  });
  if (!made.ok()) throw new Error(`setup failed: ${await made.text()}`);
  let areq = (await browser.newContext()).request;
  const login = async () => {
    areq = (await browser.newContext()).request;
    await post(areq, '/api/admin/login', { pin: PIN });
  };
  await login();
  const dash = async () => (await areq.get(`${BASE}/api/admin/dashboard`)).json();
  let d = await dash();
  for (const h of d.hiddenSessions || []) await post(areq, `/api/admin/sessions/${h.id}/show`, { shown: true });
  d = await dash();
  const idOf = (n) => d.players.find((p) => p.name === n).id;
  const phones = {};
  for (const n of NAMES) {
    const c = await browser.newContext();
    await post(c.request, '/api/me', { playerId: idOf(n) });
    phones[n] = c.request;
  }
  const court = (id, status) => post(areq, `/api/admin/sessions/${id}/court-status`, { status });
  const join = (n, id) => post(phones[n], `/api/sessions/${id}/join`, {});
  const paid = (n, id) => post(areq, `/api/admin/sessions/${id}/payment`, { playerId: idOf(n), paid: true });

  // A game that will be played and finalized: 6 in, 4 paid ($14 each), so 4 get $5 back as credit.
  const [gPast, gClaim] = d.sessions.filter((s) => !s.state.flags.past);
  await court(gPast.id, 'booked');
  for (const n of ['Alex', 'Ryan', 'Julian', 'Nathan', 'Mitchel', 'Brandon']) await join(n, gPast.id);
  for (const n of ['Alex', 'Ryan', 'Julian', 'Nathan']) await paid(n, gPast.id);
  // An unconfirmed I paid on a seat that then drops: a claim card.
  await court(gClaim.id, 'booked');
  await join('Christopher', gClaim.id);
  await post(phones.Christopher, `/api/sessions/${gClaim.id}/paid`, {});
  // Clock: past both games, then finalize the first.
  await clock(Date.parse(gPast.endsAt) + HOUR);
  await login();
  await post(areq, `/api/admin/sessions/${gPast.id}/finalize`, { everyone: true });
  await clock(Date.parse(gClaim.startsAt) - 13 * HOUR);
  await login();
  await post(phones.Christopher, `/api/sessions/${gClaim.id}/withdraw`, {});
  const now = Date.parse(gClaim.endsAt) + 2 * DAY;
  await clock(now);
  await login();
  // Ryan asks to cash out his $5.
  await post(phones.Ryan, '/api/me/refund-request', { cents: 500 });
  await put(areq, '/api/admin/group', { settings: { maxPlayers: 5 } });

  d = await dash();
  const up = d.sessions.filter((s) => Date.parse(s.startsAt) > now && !s.state.flags.canceled);
  const [gToday, gFull, gWait, gUnder, gCanceled, gBooked] = up;
  // A game today at 7 PM (or 2 hours from now if that has passed).
  const tz = 'America/Detroit';
  const todayAt = (h) => {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(now)).map((x) => [x.type, x.value]));
    const localNow = Number(p.hour) * 60 + Number(p.minute);
    return now + (h * 60 - localNow) * 60_000;
  };
  let todayStart = todayAt(19);
  if (todayStart <= now + HOUR) todayStart = now + 2 * HOUR;
  await put(areq, `/api/admin/sessions/${gToday.id}/time`, { startsAt: new Date(todayStart).toISOString(), endsAt: new Date(todayStart + 2 * HOUR).toISOString() });
  await court(gToday.id, 'booked');
  for (const n of ['Alex', 'Ryan', 'Julian']) await join(n, gToday.id);
  await court(gFull.id, 'booked');
  for (const n of ['Alex', 'Ryan', 'Julian', 'Nathan', 'Bartholomew', 'Maximilian', "Seán O'Brien-Núñez"]) await join(n, gFull.id);
  await court(gWait.id, 'waitlist');
  for (const n of ['Wilhelmina', 'Brandon']) await join(n, gWait.id);
  await join('Mitchel', gUnder.id);
  await join('Alex', gCanceled.id);
  await paid('Alex', gCanceled.id).catch(() => {});
  await post(areq, `/api/admin/sessions/${gCanceled.id}/decision`, { decision: 'cancel', confirm: true, reason: 'Thanksgiving' });
  await court(gBooked.id, 'booked');
  // An extra game in 6 months.
  const far = now + 182 * DAY;
  await post(areq, '/api/admin/sessions', { startsAt: new Date(far).toISOString(), endsAt: new Date(far + 2 * HOUR).toISOString(), note: 'Extra game' });

  const phone = (width, colorScheme) => ({ viewport: { width, height: 740 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme, userAgent: UA });
  async function openAdmin(width, scheme) {
    const ctx = await browser.newContext(phone(width, scheme));
    await post(ctx.request, '/api/admin/login', { pin: PIN });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/admin`);
    await page.locator('section[aria-labelledby="sessions-title"]').waitFor();
    const all = page.getByRole('button', { name: /^Show all/ });
    if (await all.count()) await all.click();
    return { ctx, page };
  }
  const goTab = async (page, label) => {
    await page.locator('nav.tabbar').getByRole('button', { name: new RegExp(`^${label}`) }).click();
    await sleep(250);
  };

  /** Problems on the page as it is: sideways scroll, small tap areas, low contrast, cut-off. */
  const PROBLEMS = (page) =>
    page.evaluate(() => {
      const out = { sideways: false, small: [], contrast: [], cut: [] };
      out.sideways = document.documentElement.scrollWidth > window.innerWidth + 1;
      const vw = window.innerWidth;
      const visible = (el) => {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return false;
        const cs = getComputedStyle(el);
        if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) <= 0.05 || el.closest('[aria-hidden="true"], .sr-only, nav.tabbar, .toast, [inert]')) return false;
        if ((el.closest('details:not([open])') && !el.closest('summary')) || el.closest('dialog:not([open])')) return false;
        // Clipped away by a collapsed parent (an accordion row that is shut).
        for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
          const acs = getComputedStyle(a);
          if (acs.opacity !== '' && Number(acs.opacity) <= 0.05) return false;
          if (/(hidden|clip)/.test(acs.overflow + acs.overflowY)) {
            const ar = a.getBoundingClientRect();
            if (ar.height < 1 || r.top >= ar.bottom - 0.5 || r.bottom <= ar.top + 0.5) return false;
          }
        }
        return true;
      };
      for (const el of document.querySelectorAll('button, a[href], input:not([type="hidden"]), select, textarea, [role="button"]')) {
        if (!visible(el)) continue;
        const r = el.getBoundingClientRect();
        if (r.right > vw + 0.5) out.cut.push(`${(el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 24)} ends at ${Math.round(r.right)}`);
        let h = r.height;
        let w = r.width;
        for (const pseudo of ['::before', '::after']) {
          const ps = getComputedStyle(el, pseudo);
          if (ps.content && ps.content !== 'none' && ps.position === 'absolute') {
            h = Math.max(h, parseFloat(ps.height) || 0);
            w = Math.max(w, parseFloat(ps.width) || 0);
          }
        }
        // Text inputs and checkboxes inside a 44 px row count by their row (a label wraps them).
        const label = el.closest('label');
        if (label) {
          const lr = label.getBoundingClientRect();
          h = Math.max(h, lr.height);
          w = Math.max(w, lr.width);
        }
        if (h < 43.5 || w < 43.5) out.small.push(`"${(el.textContent || el.getAttribute('aria-label') || el.getAttribute('name') || el.tagName).trim().slice(0, 28)}" ${Math.round(w)}x${Math.round(h)}`);
      }
      // Contrast of text nodes.
      const parse = (c) => {
        const m = c.match(/rgba?\(([^)]+)\)/);
        if (!m) return null;
        const [r, g, b, a = 1] = m[1].split(',').map((x) => parseFloat(x));
        return { r, g, b, a };
      };
      const lum = ({ r, g, b }) => {
        const f = (v) => {
          v /= 255;
          return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
        };
        return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
      };
      const bgOf = (el) => {
        let stack = [];
        for (let e = el; e; e = e.parentElement) {
          const c = parse(getComputedStyle(e).backgroundColor);
          if (getComputedStyle(e).backgroundImage !== 'none') return null; // gradients and images: skip
          if (c && c.a > 0) {
            stack.push(c);
            if (c.a >= 0.99) break;
          }
        }
        if (!stack.length) stack = [{ r: 255, g: 255, b: 255, a: 1 }];
        let out = stack.pop();
        while (stack.length) {
          const c = stack.pop();
          out = { r: c.r * c.a + out.r * (1 - c.a), g: c.g * c.a + out.g * (1 - c.a), b: c.b * c.a + out.b * (1 - c.a), a: 1 };
        }
        return out;
      };
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      const seen = new Set();
      while (walker.nextNode()) {
        const t = walker.currentNode;
        if (!t.textContent.trim()) continue;
        const el = t.parentElement;
        if (!el || seen.has(el) || !visible(el) || el.closest('svg, button:disabled, [disabled]')) continue;
        seen.add(el);
        const cs = getComputedStyle(el);
        const fg = parse(cs.color);
        const bg = bgOf(el);
        if (!fg || !bg) continue;
        const blended = { r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a) };
        const L1 = lum(blended);
        const L2 = lum(bg);
        const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
        const size = parseFloat(cs.fontSize);
        const large = size >= 24 || (size >= 18.66 && Number(cs.fontWeight) >= 700);
        if (ratio < (large ? 3 : 4.5)) out.contrast.push(`"${t.textContent.trim().slice(0, 24)}" ${ratio.toFixed(2)}:1`);
      }
      return out;
    });

  for (const [width, scheme] of [
    [390, 'light'],
    [390, 'dark'],
    [320, 'light'],
    [320, 'dark'],
  ]) {
    await check(`every tab at ${width} px ${scheme}: no sideways scroll, nothing cut off, 44 px tap areas, 4.5:1 text, tab bar covers nothing`, async () => {
      const { ctx, page } = await openAdmin(width, scheme);
      const report = [];
      for (const label of ['Home', 'Players', 'Money', 'History', 'Settings']) {
        await goTab(page, label);
        if (label === 'Settings') for (const b of await page.locator('button[aria-expanded="false"]').all()) await b.click().catch(() => {});
        const p = await PROBLEMS(page);
        if (p.sideways) report.push(`${label}: sideways scroll`);
        if (p.cut.length) report.push(`${label}: cut off ${p.cut.join('; ')}`);
        if (p.small.length) report.push(`${label}: small ${[...new Set(p.small)].join('; ')}`);
        if (p.contrast.length) report.push(`${label}: contrast ${[...new Set(p.contrast)].join('; ')}`);
        // Scrolled to the bottom, the last control sits above the tab bar.
        for (let k = 0; k < 6; k++) {
          await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
          await sleep(200);
          if (await page.evaluate(() => Math.abs(window.scrollY + window.innerHeight - document.documentElement.scrollHeight) < 2)) break;
        }
        const covered = await page.evaluate(() => {
          const bar = document.querySelector('nav.tabbar').getBoundingClientRect();
          const shown = (e) => {
            const r = e.getBoundingClientRect();
            if (r.height === 0) return false;
            if (e.closest('details:not([open])') && !e.closest('summary')) return false;
            if (e.closest('dialog:not([open])')) return false;
            for (let a = e.parentElement; a && a !== document.body; a = a.parentElement) {
              const acs = getComputedStyle(a);
              if (acs.display === 'none' || /(hidden|clip)/.test(acs.overflow + acs.overflowY)) {
                const ar = a.getBoundingClientRect();
                if (ar.height < 1 || r.top >= ar.bottom - 0.5) return false;
              }
            }
            return true;
          };
          const all = [...document.querySelectorAll('main button, main a[href], main input')].filter(shown);
          const last = all[all.length - 1];
          if (!last) return null;
          const r = last.getBoundingClientRect();
          const where = (e) => {
            const parts = [];
            for (let x = e; x && x !== document.body && parts.length < 5; x = x.parentElement) parts.unshift(x.tagName.toLowerCase() + (x.className && typeof x.className === 'string' ? '.' + x.className.trim().split(/\s+/).join('.') : ''));
            return parts.join(' > ');
          };
          return r.bottom > bar.top + 0.5 ? `${(last.textContent || last.getAttribute('aria-label') || '').trim().slice(0, 24)} [${where(last)}] bottom ${Math.round(r.bottom)} > bar ${Math.round(bar.top)} (scrollY ${Math.round(window.scrollY)}, doc ${document.documentElement.scrollHeight}, vh ${window.innerHeight})` : null;
        });
        if (covered) report.push(`${label}: tab bar covers ${covered}`);
        await page.screenshot({ path: path.join(SHOTS, `admin-sweep-${label.toLowerCase()}-${width}-${scheme}-bottom.png`) });
        await page.screenshot({ path: path.join(SHOTS, `admin-sweep-${label.toLowerCase()}-${width}-${scheme}.png`), fullPage: true });
        await page.evaluate(() => window.scrollTo(0, 0));
      }
      await ctx.close();
      assert(report.length === 0, report.join(' | '));
    });
  }

  await check('gear menu: first, middle and last game, at the top, middle and bottom of the screen, at 320 and 390: inside the screen, above the tab bar, page never moves, outside tap closes', async () => {
    const report = [];
    for (const width of [320, 390]) {
      const { ctx, page } = await openAdmin(width, width === 320 ? 'dark' : 'light');
      const gears = page.locator('section[aria-labelledby="sessions-title"] article.scard .game-menu > button');
      const n = await gears.count();
      for (const i of [0, Math.floor(n / 2), n - 1]) {
        for (const where of ['start', 'center', 'end']) {
          // Put the gear at the top, the middle, or just above the tab bar, then tap it where it is (no auto-scroll).
          await gears.nth(i).evaluate((el, w) => {
            const bar = document.querySelector('nav.tabbar').getBoundingClientRect();
            // The title bar scrolls away with the page, so the top of the screen is 0 once it has gone.
            const top = Math.max(0, document.querySelector('.topbar')?.getBoundingClientRect().bottom ?? 0);
            const r = el.getBoundingClientRect();
            const target = w === 'start' ? top + 12 : w === 'center' ? (top + bar.top) / 2 - r.height / 2 : bar.top - r.height - 8;
            const before = window.scrollY;
            window.scrollTo({ top: window.scrollY + r.top - target, behavior: 'instant' });
            return { before, rTop: r.top, target, after: window.scrollY, html: getComputedStyle(document.documentElement).scrollBehavior };
          }, where).then((x) => (process.env.DEBUG_SWEEP ? console.log(i, where, JSON.stringify(x)) : null));
          await sleep(400);
          const y0 = await page.evaluate(() => window.scrollY);
          await gears.nth(i).click();
          const pop = page.locator('.menu-pop');
          await pop.waitFor();
          await sleep(120);
          const y1 = await page.evaluate(() => window.scrollY);
          const box = await pop.boundingBox();
          const bar = await page.locator('nav.tabbar').boundingBox();
          const vh = page.viewportSize().height;
          if (Math.abs(y1 - y0) > 1) report.push(`${width} game ${i} ${where}: page moved ${y0}->${y1}`);
          if (box.y < 0 || box.y + box.height > Math.min(vh, bar.y) + 0.5 || box.x < 0 || box.x + box.width > width + 0.5) report.push(`${width} game ${i} ${where}: menu at ${Math.round(box.x)},${Math.round(box.y)} ${Math.round(box.width)}x${Math.round(box.height)} (bar at ${Math.round(bar.y)})`);
          // Outside tap closes it and does nothing else.
          await page.mouse.click(5, 5);
          await pop.waitFor({ state: 'detached', timeout: 2000 }).catch(() => report.push(`${width} game ${i} ${where}: outside tap did not close`));
        }
      }
      await ctx.close();
    }
    assert(report.length === 0, report.join(' | '));
  });

  await check('View as demo: banner always on top, taps save nothing, Reset and Exit work', async () => {
    const before = JSON.stringify((await dash()).sessions.map((s) => [s.id, s.confirmedCount, s.paidCount]));
    const { ctx, page } = await openAdmin(320, 'light');
    const writes = [];
    page.on('request', (r) => {
      if (r.method() !== 'GET' && r.url().includes('/api/')) writes.push(`${r.method()} ${r.url()}`);
    });
    await page.getByRole('button', { name: 'View as…' }).click();
    await page.getByRole('button', { name: 'Nathan', exact: true }).click();
    const bar = page.locator('.pretend-bar');
    await bar.waitFor();
    const join = page.getByRole('button', { name: "I'm in" }).first();
    await join.click();
    await sleep(800);
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await sleep(200);
    const top = await bar.boundingBox();
    assert(top && top.y >= -0.5 && top.y < 80, `banner not on screen after scrolling: ${JSON.stringify(top)}`);
    await bar.getByRole('button', { name: 'Reset' }).click();
    await sleep(500);
    const exit = page.getByRole('button', { name: /Exit|Back to organizer|Done/ }).first();
    await exit.click();
    await page.locator('section[aria-labelledby="sessions-title"]').waitFor();
    const after = JSON.stringify((await dash()).sessions.map((s) => [s.id, s.confirmedCount, s.paidCount]));
    assert(after === before, 'the demo changed real data');
    assert(writes.length === 0, `the demo sent writes: ${writes.join(', ')}`);
    await ctx.close();
  });

  await browser.close();
  console.log(`\nadmin-sweep: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
