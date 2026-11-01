/* "Time may shift" (Nov 2026): tilde times and court borders on the tiles, the "time changed" notice with
 * Still in / Can't make it, the organizer's "Confirmed x of y" and the Edit game note.
 *
 *   node e2e/time-shift.cjs      (also run by npm run test:e2e)
 *
 * Starts its own dev server with a fresh fake group. Nothing here touches the live site.
 * Screenshots go to e2e/screenshots/time-shift-*.png.
 */
const { spawn } = require('node:child_process');
const { rmSync, mkdirSync } = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.E2E_PORT) || 5271;
const BASE = `http://localhost:${PORT}`;
const SETUP_TOKEN = 'timeshift-setup-token-0123456789';
const PIN = '482913';
const NAMES = ['Alex', 'Ryan', 'Julian', 'Nathan', 'Mitchel', 'Brandon'];
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const SHOTS = process.env.E2E_SHOTS || path.join(__dirname, 'screenshots');

let passed = 0;
let failed = 0;
async function check(name, fn) {
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
const squash = (t) => t.replace(/\s+/g, ' ').trim();

async function main() {
  mkdirSync(SHOTS, { recursive: true });
  const dbFile = path.join(ROOT, '.data', 'timeshift.sqlite');
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
    await new Promise((r) => setTimeout(r, 500));
  }
  const setClock = (atMs) => fetch(`${BASE}/__dev/clock`, { method: 'POST', body: JSON.stringify({ atMs }) });
  await setClock(Date.now());

  const browser = await chromium.launch();
  const post = (req, url, data) => req.post(BASE + url, { data, headers: { Origin: BASE } });
  const put = (req, url, data) => req.put(BASE + url, { data, headers: { Origin: BASE } });
  const setup = (await browser.newContext()).request;
  const made = await post(setup, '/api/setup', {
    setupToken: SETUP_TOKEN,
    groupName: 'Pickleball Bros',
    pin: PIN,
    venmoUrl: 'https://venmo.com/u/organizer',
    players: NAMES.map((name, i) => ({ name, phone: `24855505${String(i).padStart(2, '0')}` })),
  });
  if (!made.ok()) throw new Error(`setup failed: ${await made.text()}`);
  const areq = (await browser.newContext()).request;
  await post(areq, '/api/admin/login', { pin: PIN });
  let d = await (await areq.get(`${BASE}/api/admin/dashboard`)).json();
  for (const h of d.hiddenSessions || []) await post(areq, `/api/admin/sessions/${h.id}/show`, { shown: true });
  d = await (await areq.get(`${BASE}/api/admin/dashboard`)).json();
  // Games far enough out that no deadline is near: A booked (the changed one), B on the venue's waitlist, C not booked.
  const ahead = d.sessions.filter((s) => !s.state.flags.past && Date.parse(s.startsAt) > Date.now() + 36 * 3600_000);
  const [A, B, C] = ahead;
  const idOf = (n) => d.players.find((p) => p.name === n).id;
  const phones = {};
  for (const n of NAMES) {
    const c = await browser.newContext();
    await post(c.request, '/api/me', { playerId: idOf(n) });
    phones[n] = c.request;
  }
  const join = (n, s) => post(phones[n], `/api/sessions/${s.id}/join`, {});
  await post(areq, `/api/admin/sessions/${A.id}/booked`, {});
  await post(areq, `/api/admin/sessions/${B.id}/court`, { action: 'waitlist' });
  for (const n of ['Ryan', 'Julian', 'Nathan']) await join(n, A);
  await join('Ryan', B);
  await join('Ryan', C);
  // Julian paid $14 for A (so Can't make it gives $14 back as credit).
  await post(areq, `/api/admin/sessions/${A.id}/payment`, { playerId: idOf('Julian'), paid: true });
  // The organizer moves A 30 minutes later.
  const later = (iso) => new Date(Date.parse(iso) + 30 * 60_000).toISOString();
  assert((await put(areq, `/api/admin/sessions/${A.id}/time`, { startsAt: later(A.startsAt), endsAt: later(A.endsAt) })).ok(), 'moved A');
  const A2 = { ...A, startsAt: later(A.startsAt) };

  const phone = (width, scheme) => ({ viewport: { width, height: 800 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: scheme, userAgent: UA });
  async function open(who, width = 390, scheme = 'light') {
    const ctx = await browser.newContext(phone(width, scheme));
    await post(ctx.request, '/api/me', { playerId: idOf(who) });
    const page = await ctx.newPage();
    await page.goto(BASE);
    await page.locator('.schedule article.sched').first().waitFor();
    return { ctx, page };
  }
  const record = async (who, s) => {
    const g = await (await phones[who].get(`${BASE}/api/group`)).json();
    return g.sessions.find((x) => x.id === s.id);
  };
  const moneyOf = async () => JSON.stringify((await (await areq.get(`${BASE}/api/admin/dashboard`)).json()).sessions.map((s) => s.roster.map((r) => [r.name, r.status, r.paymentStatus, r.paidCents ?? null])));

  for (const [width, scheme] of [
    [390, 'light'],
    [390, 'dark'],
    [320, 'light'],
    [320, 'dark'],
  ]) {
    await check(`${width} px ${scheme}: notice on top, equal buttons, outline on the game, tilde and borders, fits`, async () => {
      const { ctx, page } = await open('Ryan', width, scheme);
      const bar = page.locator(`[data-time-bar="${A.id}"]`);
      await bar.waitFor();
      const t = squash(await bar.innerText());
      assert(/moved to \d{1,2}:\d{2}\s[AP]M/.test(t), `title: ${t}`);
      assert(/Was \d{1,2}:\d{2}\s[AP]M/.test(t), `was: ${t}`);
      assert(!/drop out|back out/i.test(t), `no drop out words: ${t}`);
      const info = await page.evaluate(
        ({ a, b, c }) => {
          const bar = document.querySelector(`[data-time-bar="${a}"]`);
          const btns = [...bar.querySelectorAll('.ts-line2 .btn')].map((x) => x.getBoundingClientRect());
          const list = document.querySelector('.schedule');
          const row = (id) => document.getElementById(`row-${id}`);
          const tile = (id) => row(id).querySelector('.tile');
          const time = (id) => row(id).querySelector('[data-sched-time]');
          const bg = getComputedStyle(bar).backgroundColor;
          const page = getComputedStyle(document.body).backgroundColor;
          const yes = bar.querySelector('.ts-yes');
          const no = bar.querySelector('.ts-no');
          return {
            sideways: document.documentElement.scrollWidth > window.innerWidth + 1,
            above: bar.getBoundingClientRect().bottom <= list.getBoundingClientRect().top + 1,
            widths: btns.map((r) => Math.round(r.width)),
            heights: btns.map((r) => Math.round(r.height)),
            bg,
            page,
            noBorder: getComputedStyle(no).borderColor,
            noBg: getComputedStyle(no).backgroundColor,
            yesText: yes.textContent,
            outline: getComputedStyle(row(a)).outlineStyle + ' ' + getComputedStyle(row(a)).outlineColor,
            otherOutline: getComputedStyle(row(b)).outlineColor,
            tiles: [a, b, c].map((id) => tile(id).className),
            times: [a, b, c].map((id) => time(id).textContent),
            timeColors: [a, b, c].map((id) => getComputedStyle(time(id)).color),
            solid: getComputedStyle(tile(a).querySelector('.tb-solid')).borderColor,
            dash: [getComputedStyle(tile(b).querySelector('.tb-dash')).borderStyle, getComputedStyle(tile(b).querySelector('.tb-dash')).opacity],
          };
        },
        { a: A.id, b: B.id, c: C.id },
      );
      assert(!info.sideways, 'no sideways scroll');
      assert(info.above, 'the notice is above the game list');
      assert(info.widths.length === 2 && Math.abs(info.widths[0] - info.widths[1]) <= 1, `equal widths ${info.widths}`);
      assert(info.heights.every((h) => h >= 44), `44 px taps ${info.heights}`);
      assert(info.yesText === 'Still in', info.yesText);
      // Can't make it: plain outline, neutral gray, never red.
      const rgb = (s) => (s.match(/\d+/g) || []).slice(0, 3).map(Number);
      const [nr, ng, nb] = rgb(info.noBorder);
      assert(Math.abs(nr - ng) < 30 && Math.abs(ng - nb) < 30, `neutral outline ${info.noBorder}`);
      assert(/rgba\(0, 0, 0, 0\)|transparent/.test(info.noBg), `plain ${info.noBg}`);
      // Dark mode: a raised dark card, never bright white on the dark page.
      const lum = (s) => {
        const [r, g, b] = rgb(s);
        return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      };
      if (scheme === 'dark') assert(lum(info.bg) < 0.25 && lum(info.bg) > lum(info.page), `dark raised card ${info.bg} on ${info.page}`);
      else assert(lum(info.bg) > 0.95, `white card ${info.bg}`);
      assert(/solid/.test(info.outline) && !/0, 0, 0, 0/.test(info.outline), `green outline on the game ${info.outline}`);
      assert(/0, 0, 0, 0/.test(info.otherOutline), 'no outline on other games');
      assert(/ts-booked/.test(info.tiles[0]) && /ts-wait/.test(info.tiles[1]) && /ts-none/.test(info.tiles[2]), `tiles ${info.tiles}`);
      assert(info.times[1].startsWith('~') && !info.times[0].startsWith('~') && !info.times[2].startsWith('~'), `times ${info.times}`);
      assert(info.timeColors[1] === info.timeColors[2] && info.timeColors[0] !== info.timeColors[1], `muted vs bright ${info.timeColors}`);
      if (scheme === 'dark') assert(info.solid === 'rgb(139, 217, 163)', `dark booked border is green ${info.solid}`);
      assert(info.dash[0] === 'dashed' && info.dash[1] === '1', `dashed ${info.dash}`);
      await page.screenshot({ path: path.join(SHOTS, `time-shift-player-${width}-${scheme}.png`), fullPage: true });
      // The 5-second refresh and a reload keep it.
      await page.waitForTimeout(5600);
      assert(await bar.isVisible(), 'stays after a refresh');
      await page.reload();
      await page.locator(`[data-time-bar="${A.id}"]`).waitFor();
      await ctx.close();
    });
  }

  await check('Still in: check, bar folds away, saved, no money moved, gone after a reload', async () => {
    const before = await moneyOf();
    const { ctx, page } = await open('Ryan');
    const bar = page.locator(`[data-time-bar="${A.id}"]`);
    await bar.getByRole('button', { name: 'Still in' }).click();
    await bar.getByRole('button', { name: 'Confirmed' }).waitFor({ timeout: 3000 });
    await bar.waitFor({ state: 'detached', timeout: 5000 });
    assert((await record('Ryan', A)).timeAsk === null, 'saved');
    assert((await moneyOf()) === before, 'no money or seat changed');
    const outline = await page.evaluate((id) => getComputedStyle(document.getElementById(`row-${id}`)).outlineColor, A.id);
    await page.waitForTimeout(400);
    await page.reload();
    await page.locator('.schedule article.sched').first().waitFor();
    assert((await page.locator('[data-time-bar]').count()) === 0, 'gone after reload');
    void outline;
    await ctx.close();
  });

  await check("Can't make it: the drop question in the notice's words, Undo brings the notice back, then the drop with $14 credit", async () => {
    const { ctx, page } = await open('Julian');
    const bar = page.locator(`[data-time-bar="${A.id}"]`);
    await bar.getByRole('button', { name: "Can't make it" }).click();
    const dlg = page.locator('dialog[open]');
    await dlg.waitFor();
    assert((await dlg.getByRole('button', { name: "Can't make it" }).count()) === 1, 'dialog says Can\'t make it');
    assert(!/drop out/i.test(squash(await dlg.innerText())), `no drop out words: ${await dlg.innerText()}`);
    await dlg.getByRole('button', { name: "Can't make it" }).click();
    const toast = page.locator('.pop.toast');
    await toast.waitFor();
    const tt = squash(await toast.innerText());
    assert(/\$14/.test(tt) && /credit/i.test(tt), `credit message: ${tt}`);
    assert((await page.locator('[data-time-bar]').count()) === 0, 'notice hides while the drop waits');
    await toast.getByRole('button', { name: 'Undo' }).click();
    await bar.waitFor({ timeout: 3000 });
    assert((await record('Julian', A)).mine.status === 'confirmed', 'still in after Undo');
    // Again, and let it go through.
    await bar.getByRole('button', { name: "Can't make it" }).click();
    await page.locator('dialog[open]').getByRole('button', { name: "Can't make it" }).click();
    const sent = page.waitForResponse((r) => /\/withdraw$/.test(r.url()), { timeout: 12000 });
    await sent;
    await page.waitForTimeout(600);
    const after = await record('Julian', A);
    assert(!after.mine || after.mine.status !== 'confirmed', 'dropped');
    assert(after.timeAsk === null, 'no notice after the drop');
    await ctx.close();
  });

  await check('offline: Still in keeps the notice and shows the error banner', async () => {
    const { ctx, page } = await open('Nathan');
    const bar = page.locator(`[data-time-bar="${A.id}"]`);
    await bar.waitFor();
    await ctx.route('**/still-in', (r) => r.abort('internetdisconnected'));
    await bar.getByRole('button', { name: 'Still in' }).click();
    await page.locator('.pop.toast.pop-error').waitFor({ timeout: 4000 });
    assert(await bar.isVisible(), 'kept');
    assert((await record('Nathan', A)).timeAsk !== null, 'not saved');
    await ctx.close();
  });

  await check('organizer: Confirmed x of y, Waiting on with a Text button, flip to Booked on the tile, the Edit game note', async () => {
    const ctx = await browser.newContext(phone(390, 'light'));
    await post(ctx.request, '/api/admin/login', { pin: PIN });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/admin`);
    await page.locator('section[aria-labelledby="sessions-title"]').waitFor();
    const card = page.locator(`#session-${A.id}`);
    const line = card.locator('[data-time-check]');
    await line.waitFor();
    const t = squash(await line.innerText());
    // Ryan said Still in, Julian dropped, Nathan waiting: 1 of 2.
    assert(/Confirmed 1 of 2/.test(t), t);
    assert(/Waiting on Nathan/.test(t), t);
    const href = await line.getByRole('link', { name: /^Text Nathan/ }).getAttribute('href');
    assert(/^sms:/.test(href) && /Still%20in%3F%20Open%20the%20site%20and%20tap%20Still%20in/.test(href) && /is%20now/.test(href), href);
    const tile = await page.evaluate((id) => document.querySelector(`#session-${id} .tile`).className, B.id);
    assert(/ts-wait/.test(tile), tile);
    assert((await page.locator(`#session-${B.id} [data-card-time]`).innerText()).startsWith('~'), 'tilde on the organizer card');
    await page.screenshot({ path: path.join(SHOTS, 'time-shift-admin-390-light.png'), fullPage: true });

    // B flips to Booked: the tile goes solid, the tilde goes.
    const player = await open('Ryan');
    const tsB = player.page.locator(`#row-${B.id} [data-sched-time]`);
    assert((await tsB.innerText()).startsWith('~'), 'tilde before');
    await post(areq, `/api/admin/sessions/${B.id}/court-status`, { status: 'booked' });
    await player.page.waitForFunction((id) => document.querySelector(`#row-${id} .tile`).className.includes('ts-booked'), B.id, { timeout: 12000 });
    assert(!(await tsB.innerText()).startsWith('~'), 'tilde gone');
    await player.ctx.close();

    // Edit game: the note before saving a new start time on a game with players in.
    await card.getByRole('button', { name: /^Game menu/ }).click();
    await page.getByRole('menuitem', { name: /Edit game/ }).click();
    const start = page.locator('dialog[open] input[type="time"]').first();
    await start.waitFor();
    assert((await page.locator('[data-ts-note]').count()) === 0, 'no note before a change');
    const v = await start.inputValue();
    const [h, m] = v.split(':').map(Number);
    await start.fill(`${String(h + 1).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
    await page.locator('[data-ts-note]').waitFor();
    assert(squash(await page.locator('[data-ts-note]').innerText()) === 'Players who are in will be asked to confirm the new time.', 'note words');
    await page.screenshot({ path: path.join(SHOTS, 'time-shift-edit-note-390-light.png') });
    await ctx.close();
  });

  await check('reduced motion: plain short fades only', async () => {
    const ctx = await browser.newContext({ ...phone(390, 'light'), reducedMotion: 'reduce' });
    await post(ctx.request, '/api/me', { playerId: idOf('Nathan') });
    const page = await ctx.newPage();
    await page.goto(BASE);
    const bar = page.locator(`[data-time-bar="${A.id}"]`);
    await bar.waitFor();
    const dur = await page.evaluate((id) => getComputedStyle(document.querySelector(`[data-time-bar="${id}"]`)).transitionDuration, A.id);
    assert(dur.split(',').every((x) => parseFloat(x) <= 0.1), dur);
    await ctx.close();
  });

  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
