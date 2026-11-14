/* Zip 43: Venue charge alert (VENUE_ALERT). Browser checks on the CALM small world (the preview profile), its own dev server, nothing touches Cloudflare.
 *
 *   node e2e/zip43.cjs      (also run by npm run test:e2e)
 *
 * The world is built as of Sat Nov 14, 2026, 11:00 AM Eastern; the preview's switch row says "turned on Oct 1", so last month's two charge days are due:
 * membership (Oct 26, $30) and courts (Oct 31, 2 booked games x $48 = $96).
 *   H1  admin Home, 390 px, light and dark: the two amber cards are the first things, with the mock's words, ONE button (Mark paid), no Dismiss;
 *   H2  the same at 360 and 320 px: nothing clips or runs off the side; the title wraps to at most two lines; the button stays full width;
 *   H3  the three versions (courts, membership, both on one day) say the mock's exact words;
 *   S1  Settings > Money: the two day dropdowns under Monthly membership, light and dark, 390 and 360 px; every option there; "Last day" is not cut off;
 *   S2  a dropdown saves the moment it changes (the server has it, a reload keeps it), both ways round;
 *   M1  Mark paid on a card: the card goes, the Home badge drops by one, History says "Venue charge marked paid: $96" ONCE, a reload does not bring it back;
 *   M2  a very fast double tap writes one History line;
 *   O1  the switch OFF (no row, no link): no card and no day rows; the private link (?venuealert=on) shows the day rows and, starting from now, no old card.
 */
const { spawn, spawnSync } = require('node:child_process');
const { copyFileSync, readFileSync, mkdirSync, rmSync } = require('node:fs');
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.E2E_PORT) || 5443;
const PORT2 = PORT + 1;
const BASE = `http://localhost:${PORT}`;
const BASE2 = `http://localhost:${PORT2}`;
const NOW_ISO = '2026-11-14T16:00:00.000Z'; // Sat Nov 14, 11:00 AM Eastern
const NOW_MS = Date.parse(NOW_ISO);
const SHOTS = process.env.E2E_SHOTS || path.join(__dirname, 'screenshots');
const PIN = /PIN `(\d{6})`/.exec(readFileSync(path.join(ROOT, 'docs/PREVIEW_FAKE_DB.md'), 'utf8'))[1];
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

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
    console.log(`  ✗ ${name}\n      ${String(err && err.message ? err.message : err).replace(/\s*\n\s*/g, ' ⏎ ').slice(0, 1600)}`);
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function startServer(port, dbFile, extra = {}) {
  if (await fetch(`http://localhost:${port}/api/status`).then((r) => r.ok, () => false)) throw new Error(`port ${port} is already in use`);
  const server = spawn('npx', ['vite', '--port', String(port), '--strictPort'], {
    cwd: ROOT,
    env: { ...process.env, DEV_DB: dbFile, SETUP_TOKEN: 'zip43-setup-token-0123456789', DEV_CLOCK: '1', PREVIEW_CALM: 'on', ...extra },
    stdio: 'ignore',
    detached: true,
  });
  process.on('exit', () => {
    try {
      process.kill(-server.pid, 'SIGTERM');
    } catch {}
  });
  for (let i = 0; i < 90; i++) {
    try {
      if ((await fetch(`http://localhost:${port}/api/status`)).ok) break;
    } catch {}
    await sleep(500);
  }
  await fetch(`http://localhost:${port}/__dev/clock`, { method: 'POST', body: JSON.stringify({ atMs: NOW_MS }) });
}

async function main() {
  mkdirSync(SHOTS, { recursive: true });
  mkdirSync(path.join(ROOT, '.data'), { recursive: true });
  const dbFile = path.join(ROOT, '.data', 'zip43.sqlite');
  const db2File = path.join(ROOT, '.data', 'zip43-off.sqlite');
  rmSync(dbFile, { force: true });
  const seeded = spawnSync('npx', ['vite-node', 'scripts/load-small-local.ts', '--', dbFile, NOW_ISO, '--calm'], { cwd: ROOT, encoding: 'utf8' });
  if (seeded.status !== 0) throw new Error(`could not build the calm world: ${seeded.stderr || seeded.stdout}`);
  // The second site: the same world with the switch row taken out (OFF).
  copyFileSync(dbFile, db2File);
  {
    const d = new DatabaseSync(db2File);
    d.prepare("DELETE FROM task_log WHERE task = 'venue_alert_on'").run();
    d.close();
  }
  await startServer(PORT, dbFile);
  await startServer(PORT2, db2File);
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
  const phone = (scheme, width = 390) => browser.newContext({ viewport: { width, height: 844 }, deviceScaleFactor: 1, colorScheme: scheme, isMobile: true, hasTouch: true, userAgent: UA, reducedMotion: 'reduce' });
  async function open(base, scheme, width, url = '/admin') {
    const ctx = await phone(scheme, width);
    await shift(ctx);
    await ctx.request.post(base + '/api/admin/login', { data: { pin: PIN }, headers: { Origin: base } });
    const page = await ctx.newPage();
    await page.goto(base + url);
    await page.locator('.tabbar').waitFor({ timeout: 20000 });
    await page.waitForTimeout(1200);
    return { ctx, page };
  }
  const org = (await browser.newContext()).request;
  await org.post(BASE + '/api/admin/login', { data: { pin: PIN }, headers: { Origin: BASE } });
  const call = async (method, p, data) => {
    const res = await org.fetch(BASE + p, { method, data, headers: { Origin: BASE, 'Content-Type': 'application/json' } });
    return { status: res.status(), json: await res.json().catch(() => null) };
  };
  const dash = async () => (await call('GET', '/api/admin/dashboard')).json;
  const resetAll = async () => {
    // Back to the seeded state: days default, nothing marked paid.
    const d = new DatabaseSync(dbFile);
    d.prepare("DELETE FROM task_log WHERE task LIKE 'venue_paid:%'").run();
    d.prepare("DELETE FROM admin_audit_log WHERE action = 'venue_charge_paid'").run();
    // Back to never-changed days (no `venueDays` key at all). The dropdowns' own saves note WHEN a day moved, and a moved day never brings back an
    // earlier charge day (that is the point), so the days these checks need are written straight into the saved settings instead.
    d.prepare("UPDATE groups SET settings_json = json_remove(settings_json, '$.venueDays')").run();
    d.close();
  };
  const setDaysDirect = (membershipDay, courtDay) => {
    const d = new DatabaseSync(dbFile);
    d.prepare("UPDATE groups SET settings_json = json_set(settings_json, '$.venueDays', json(?))").run(JSON.stringify({ membershipDay, courtDay }));
    d.close();
  };
  const d0 = await dash();
  assert(d0.venueAlert === true && d0.venueAlerts.length === 2, `the preview world should have two cards, has ${JSON.stringify(d0.venueAlerts)}`);

  const MEMBERSHIP = 'Membership should have been charged: $30';
  const COURTS = 'Northville Pickleball should have charged you $96';

  for (const scheme of ['light', 'dark']) {
    await check(`H1 (${scheme}, 390): the two amber cards are first on Home, with the mock's words, one button each, no Dismiss`, async () => {
      await resetAll();
      const { ctx, page } = await open(BASE, scheme, 390);
      const cards = page.locator('[data-venue-alerts] [data-alert-card="amber"]');
      assert((await cards.count()) === 2, `${await cards.count()} cards`);
      const first = await cards.first().boundingBox();
      assert(first && first.y < 140, `the first card is not at the top: ${JSON.stringify(first)}`);
      const t0 = (await cards.nth(0).innerText()).replace(/\s+/g, ' ').trim();
      const t1 = (await cards.nth(1).innerText()).replace(/\s+/g, ' ').trim();
      assert(t0 === `${MEMBERSHIP} Monthly membership, Northville Pickleball Mark paid`, `membership card: ${t0}`);
      assert(t1 === `${COURTS} 2 games x $48 = $96 Mark paid`, `courts card: ${t1}`);
      for (let i = 0; i < 2; i++) {
        assert((await cards.nth(i).locator('button').count()) === 1, 'exactly one button');
        assert((await cards.nth(i).locator('[data-dismiss], .ac-x').count()) === 0, 'a Dismiss button');
      }
      // Both cards come before the first game card (the venue cards are the top of Home).
      const gameTop = await page.locator('article[data-r2-card], .session-card, article.card').first().boundingBox().catch(() => null);
      assert(!gameTop || gameTop.y >= first.y, 'a game card is above the venue cards');
      await page.screenshot({ path: path.join(SHOTS, `zip43-home-${scheme}-390.png`) });
      await ctx.close();
    });
  }

  for (const width of [360, 320]) {
    await check(`H2 (${width}, light and dark): nothing clips, the title wraps to at most two lines, the button is full width`, async () => {
      for (const scheme of ['light', 'dark']) {
        await resetAll();
        const { ctx, page } = await open(BASE, scheme, width);
        const cards = page.locator('[data-venue-alerts] [data-alert-card="amber"]');
        assert((await cards.count()) === 2, 'two cards');
        const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        assert(over <= 1, `the page runs ${over}px past the side`);
        for (let i = 0; i < 2; i++) {
          const card = cards.nth(i);
          const m = await card.evaluate((el) => {
            const title = el.querySelector('.ac-title, h3');
            const btn = el.querySelector('button');
            const cr = el.getBoundingClientRect();
            const br = btn.getBoundingClientRect();
            const lh = parseFloat(getComputedStyle(title).lineHeight) || 20;
            return { lines: Math.round(title.getBoundingClientRect().height / lh), left: cr.left, right: cr.right, bl: br.left, br: br.right, vw: window.innerWidth, scroll: el.scrollWidth - el.clientWidth };
          });
          assert(m.lines <= 2, `${scheme}: title is ${m.lines} lines`);
          assert(m.left >= 0 && m.right <= m.vw, `${scheme}: card outside the screen ${JSON.stringify(m)}`);
          assert(m.br - m.bl >= (m.right - m.left) * 0.8, `${scheme}: the button is narrow ${JSON.stringify(m)}`);
          assert(m.scroll <= 1, `${scheme}: content runs out of the card`);
        }
        await ctx.close();
      }
    });
  }

  await check('H3: the three versions say the mock\'s exact words (courts, membership, both on one day)', async () => {
    await resetAll();
    const { ctx, page } = await open(BASE, 'light', 390);
    const text = async () => (await page.locator('[data-venue-alerts]').innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
    // courts only
    await call('POST', '/api/admin/venue-alert/paid', { keys: ['membership:2026-10'], cents: 3000 });
    await page.reload();
    await page.locator('[data-venue-alerts]').waitFor();
    assert((await text()) === `${COURTS} 2 games x $48 = $96 Mark paid`, `courts: ${await text()}`);
    // membership only (put the membership back, mark the courts)
    const d = new DatabaseSync(dbFile);
    d.prepare("DELETE FROM task_log WHERE task LIKE 'venue_paid:%'").run();
    d.close();
    await call('POST', '/api/admin/venue-alert/paid', { keys: ['court:2026-10'], cents: 9600 });
    await page.reload();
    await page.locator('[data-venue-alerts]').waitFor();
    assert((await text()) === `${MEMBERSHIP} Monthly membership, Northville Pickleball Mark paid`, `membership: ${await text()}`);
    // both on one day: membership on the last day too
    const d2 = new DatabaseSync(dbFile);
    d2.prepare("DELETE FROM task_log WHERE task LIKE 'venue_paid:%'").run();
    d2.close();
    setDaysDirect(31, 0);
    await page.reload();
    await page.locator('[data-venue-alerts]').waitFor();
    assert((await text()) === 'Northville Pickleball should have charged you $126 2 games x $48 = $96, plus membership $30 Mark paid', `combined: ${await text()}`);
    assert((await page.locator('[data-venue-alerts] [data-alert-card="amber"]').count()) === 1, 'one combined card');
    await ctx.close();
  });

  const openMoney = async (page) => {
    await page.locator('.tabbar >> text=Settings').click();
    await page.locator('[data-section="money"] summary').waitFor({ timeout: 10000 });
    const open = await page.locator('[data-section="money"]').evaluate((d) => d.open);
    if (!open) await page.locator('[data-section="money"] summary').click();
    await page.locator('[data-row="membershipDay"]').waitFor({ timeout: 10000 });
  };
  for (const width of [390, 360]) {
    for (const scheme of ['light', 'dark']) {
      await check(`S1 (${scheme}, ${width}): Settings > Money has the two dropdowns under Monthly membership, every option, nothing cut off`, async () => {
        await resetAll();
        const { ctx, page } = await open(BASE, scheme, width);
        await openMoney(page);
        const rows = await page.locator('[data-section="money"] [data-row]').evaluateAll((els) => els.map((e) => e.getAttribute('data-row')));
        const i = rows.indexOf('monthlyMembershipCents');
        assert(rows[i + 1] === 'membershipDay' && rows[i + 2] === 'courtDay', `row order: ${rows.join(', ')}`);
        const labels = await page.locator('[data-row="membershipDay"], [data-row="courtDay"]').evaluateAll((els) => els.map((e) => e.innerText.replace(/\s+/g, ' ').trim()));
        assert(/^Membership charged on\s+Day of month/.test(labels[0]) && /^Court costs charged on\s+Day of month/.test(labels[1]), `labels: ${labels.join(' / ')}`);
        const sel = (k) => page.locator(`select[data-venue-day="${k}"]`);
        assert((await sel('membershipDay').inputValue()) === '26' && (await sel('courtDay').inputValue()) === '0', 'defaults 26th and Last day');
        const mOpts = await sel('membershipDay').locator('option').evaluateAll((os) => os.map((o) => o.textContent));
        const cOpts = await sel('courtDay').locator('option').evaluateAll((os) => os.map((o) => o.textContent));
        assert(mOpts.length === 31 && mOpts[0] === '1st' && mOpts[1] === '2nd' && mOpts[2] === '3rd' && mOpts[10] === '11th' && mOpts[20] === '21st' && mOpts[30] === '31st', `membership options: ${mOpts.join(',')}`);
        assert(cOpts.length === 29 && cOpts[0] === '1st' && cOpts[27] === '28th' && cOpts[28] === 'Last day', `court options: ${cOpts.join(',')}`);
        for (const k of ['membershipDay', 'courtDay']) {
          const m = await sel(k).evaluate((el) => {
            const r = el.getBoundingClientRect();
            const c = document.createElement('canvas').getContext('2d');
            const cs = getComputedStyle(el);
            c.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
            const label = el.options[el.selectedIndex].text;
            return { w: r.width, text: c.measureText(label).width, pad: parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight), right: r.right, vw: window.innerWidth, h: r.height };
          });
          assert(m.right <= m.vw - 8, `${k} runs to the screen edge: ${JSON.stringify(m)}`);
          assert(m.w >= m.text + m.pad + 14, `${k}: "${k === 'courtDay' ? 'Last day' : '26th'}" is cut off (${m.w} wide, text ${m.text}, padding ${m.pad})`);
          assert(m.h >= 44, `${k} is ${m.h}px tall (44 px minimum)`);
        }
        const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        assert(over <= 1, `the page runs ${over}px past the side`);
        await page.locator('[data-row="membershipDay"]').scrollIntoViewIfNeeded();
        await page.evaluate(() => window.scrollBy(0, -260));
        await page.screenshot({ path: path.join(SHOTS, `zip43-money-${scheme}-${width}.png`) });
        await ctx.close();
      });
    }
  }

  await check('S2: a dropdown saves the moment it changes; a reload keeps it; changing it back works too', async () => {
    await resetAll();
    const { ctx, page } = await open(BASE, 'light', 390);
    await openMoney(page);
    await page.locator('select[data-venue-day="membershipDay"]').selectOption('28');
    await page.locator('[data-row="membershipDay"] .save-mark.saved').waitFor({ timeout: 8000 });
    await page.locator('select[data-venue-day="courtDay"]').selectOption('15');
    await page.locator('[data-row="courtDay"] .save-mark.saved').waitFor({ timeout: 8000 });
    let d = await dash();
    assert(d.venueDays.membershipDay === 28 && d.venueDays.courtDay === 15, `server has ${JSON.stringify(d.venueDays)}`);
    await page.reload();
    await openMoney(page);
    assert((await page.locator('select[data-venue-day="membershipDay"]').inputValue()) === '28' && (await page.locator('select[data-venue-day="courtDay"]').inputValue()) === '15', 'a reload lost the days');
    await page.locator('select[data-venue-day="membershipDay"]').selectOption('26');
    await page.locator('select[data-venue-day="courtDay"]').selectOption('0');
    await page.locator('[data-row="courtDay"] .save-mark.saved').waitFor({ timeout: 8000 });
    await sleep(600);
    d = await dash();
    assert(d.venueDays.membershipDay === 26 && d.venueDays.courtDay === 0, `back: ${JSON.stringify(d.venueDays)}`);
    await ctx.close();
  });

  await check('M1: Mark paid removes the card, the Home badge drops by one, History says "Venue charge marked paid: $96" once, and a reload does not bring it back', async () => {
    await resetAll();
    const { ctx, page } = await open(BASE, 'light', 390);
    const badge = async () => Number(/\d+/.exec(await page.locator('.tabbar .badge').first().innerText().catch(() => '0'))?.[0] ?? 0);
    const before = await badge();
    const card = page.locator(`[data-venue-alerts] [data-alert-card="amber"]:has-text("${COURTS}")`);
    await card.locator('[data-venue-paid]').click();
    await card.waitFor({ state: 'detached', timeout: 10000 });
    await sleep(800);
    assert((await badge()) === before - 1, `badge ${before} -> ${await badge()}`);
    await page.reload();
    await page.locator('.tabbar').waitFor();
    await sleep(800);
    assert((await page.locator(`text=${COURTS}`).count()) === 0, 'the card came back after a reload');
    assert((await page.locator('[data-venue-alerts] [data-alert-card]').count()) === 1, 'the membership card is still there');
    await page.locator('.tabbar >> text=History').click();
    await page.waitForTimeout(1500);
    const hits = await page.getByText('Venue charge marked paid: $96', { exact: true }).count();
    assert(hits === 1, `${hits} History lines`);
    await ctx.close();
  });

  await check('M2: a very fast double tap on Mark paid writes one History line', async () => {
    await resetAll();
    const { ctx, page } = await open(BASE, 'light', 390);
    const btn = page.locator(`[data-venue-alerts] [data-alert-card]:has-text("${MEMBERSHIP}") [data-venue-paid]`);
    await btn.dblclick({ delay: 0 }).catch(() => {});
    await sleep(1500);
    const lines = (await call('GET', '/api/admin/activity')).json.entries.filter((e) => e.action === 'venue_charge_paid');
    assert(lines.length === 1, `${lines.length} lines`);
    assert((await page.locator(`text=${MEMBERSHIP}`).count()) === 0, 'the card is still there');
    await ctx.close();
  });

  await check('O1: switch OFF: no card, no day rows; the private link shows the day rows and, starting now, no old card; ?venuealert=off ends it', async () => {
    const off = await open(BASE2, 'light', 390);
    assert((await off.page.locator('[data-venue-alerts]').count()) === 0, 'a card with the switch off');
    await off.page.locator('.tabbar >> text=Settings').click();
    await off.page.locator('[data-section="money"] summary').click();
    await off.page.locator('[data-row="monthlyMembershipCents"]').waitFor();
    assert((await off.page.locator('[data-row="membershipDay"], [data-row="courtDay"]').count()) === 0, 'day rows with the switch off');
    assert(!/Venue charge/.test(await off.page.locator('body').innerText().catch(() => '')) || (await off.page.locator('[data-venue-alert-all]').count()) === 1, 'unexpected venue text');
    await off.ctx.close();
    const link = await open(BASE2, 'light', 390, '/admin?venuealert=on');
    assert((await link.page.locator('[data-venue-alerts]').count()) === 0, 'an old card on the private link');
    await link.page.locator('.tabbar >> text=Settings').click();
    await link.page.locator('[data-section="money"] summary').click();
    await link.page.locator('[data-row="membershipDay"]').waitFor({ timeout: 10000 });
    assert((await link.page.locator('[data-row="courtDay"]').count()) === 1, 'the day rows on the private link');
    await link.page.goto(BASE2 + '/admin?venuealert=off');
    await link.page.locator('.tabbar').waitFor();
    await link.page.locator('.tabbar >> text=Settings').click();
    await link.page.locator('[data-section="money"] summary').waitFor();
    if (!(await link.page.locator('[data-section="money"]').evaluate((d) => d.open))) await link.page.locator('[data-section="money"] summary').click();
    await sleep(500);
    assert((await link.page.locator('[data-row="membershipDay"]').count()) === 0, 'the day rows after ?venuealert=off');
    await link.ctx.close();
  });

  await browser.close();
  console.log(`\nzip43: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
main().catch((err) => {
  console.error(err);
  process.exit(1);
});
