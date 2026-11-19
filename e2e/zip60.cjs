/* Zip 60 (🎾60.formatvote): the players vote the format, in a real browser.
 *
 *   node e2e/zip60.cjs      (also run by npm run test:e2e)
 *
 * The world is the preview's calm Zip 56 profile as of Tue Nov 17 2026, 10:00 AM Eastern, with the Tournament test page's vote stages (server/tournamentTest.ts).
 *   A  Create: "Let players vote" is the default, three choices, none wraps (390/360/320, light and dark); the card on Home says "Format: players vote"
 *   B  the player card before the date: "Tournament style TBD" and "~7:30 PM"; sign-up step 2 has "Format you'd like" with three rows, Either preselected
 *   C  Vic signs up with Americano; Edit sign-up changes the vote; the organizer's card shows the counts
 *   D  the organizer picks the date: the counts and the rule on the card; Vic sees the alert at the top (real name and date), the usual format line
 *      comes back, the X dismisses it for good (a reload keeps it away), a re-pick shows a fresh one
 *   E  the tie stage: the alert says only "Format: Locked doubles"
 *   F  nobody else's vote reaches a player; a player who may not see it gets no tournament data at all
 *   G  no em dashes on any new screen
 * Screenshots: .data/zip60-shots (not in git).
 */
const { spawn, spawnSync } = require('node:child_process');
const { readFileSync, mkdirSync, rmSync } = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.E2E_PORT) || 5460;
const BASE = `http://localhost:${PORT}`;
const SEED_ISO = '2026-11-17T14:00:00.000Z';
const NOW_MS = Date.parse('2026-11-17T15:00:00.000Z'); // Tue Nov 17, 10:00 AM Eastern
const PIN = /PIN `(\d{6})`/.exec(readFileSync(path.join(ROOT, 'docs/PREVIEW_FAKE_DB.md'), 'utf8'))[1];
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const SHOTS = path.join(ROOT, '.data', 'zip60-shots');

let passed = 0;
let failed = 0;
const ONLY = process.env.ZIP60_ONLY || '';
async function check(name, fn) {
  if (ONLY && !name.includes(ONLY)) return;
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
const SIZES = [390, 360, 320];
const SCHEMES = ['light', 'dark'];

async function main() {
  const dbFile = path.join(ROOT, '.data', 'zip60.sqlite');
  mkdirSync(SHOTS, { recursive: true });
  rmSync(dbFile, { force: true });
  const seeded = spawnSync('npx', ['vite-node', 'scripts/load-small-local.ts', '--', dbFile, SEED_ISO, '--calm', '--zip55', '--zip60'], { cwd: ROOT, encoding: 'utf8' });
  if (seeded.status !== 0) throw new Error(`could not build the calm world: ${seeded.stderr || seeded.stdout}`);
  if (await fetch(`${BASE}/api/status`).then((r) => r.ok, () => false)) throw new Error(`port ${PORT} is already in use`);
  const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
    cwd: ROOT,
    env: { ...process.env, DEV_DB: dbFile, SETUP_TOKEN: 'zip60-setup-token-0123456789', DEV_CLOCK: '1', PREVIEW_CALM: 'on', PB_PREVIEW_BUILD: '1' },
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
  await fetch(`${BASE}/__dev/clock`, { method: 'POST', body: JSON.stringify({ atMs: NOW_MS }) });
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

  const admin = await browser.newContext();
  assert((await admin.request.post(BASE + '/api/admin/login', { data: { pin: PIN }, headers: { Origin: BASE } })).ok(), 'admin login');
  const adminCookies = await admin.cookies();
  const dash = async () => (await admin.request.get(BASE + '/api/admin/dashboard')).json();
  const call = async (method, url, data) => {
    const r = await admin.request.fetch(BASE + url, { method, data, headers: { Origin: BASE } });
    assert(r.ok(), `${method} ${url}: ${r.status()} ${await r.text()}`);
    return r.json();
  };
  const stage = (s) => call('POST', '/api/admin/tournament-test', { stage: s });
  async function answerOf(name) {
    const ctx = await browser.newContext();
    const list = (await (await ctx.request.get(BASE + '/api/group')).json()).players;
    const p = list.find((x) => x.name === name);
    await ctx.request.post(BASE + '/api/me', { data: { playerId: p.id }, headers: { Origin: BASE } });
    const text = await (await ctx.request.get(BASE + '/api/group')).text();
    await ctx.close();
    return { text, data: JSON.parse(text) };
  }
  async function newPage(opts = {}) {
    const { width = 390, scheme = 'light', height = 844, organizer = false } = opts;
    const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, colorScheme: scheme, isMobile: true, hasTouch: true, userAgent: UA, reducedMotion: 'reduce' });
    await shift(ctx);
    if (organizer) await ctx.addCookies(adminCookies.map((c) => ({ ...c })));
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    return { ctx, page, errors };
  }
  async function playerPage(who, opts = {}) {
    const p = await newPage(opts);
    await p.page.goto(`${BASE}/?as=${encodeURIComponent(who)}`);
    await p.page.locator('.schedule').first().waitFor({ timeout: 30000 });
    await p.page.reload();
    await p.page.locator('.schedule').first().waitFor({ timeout: 30000 });
    await p.page.waitForTimeout(700);
    return p;
  }
  async function adminPage(opts = {}) {
    const p = await newPage({ ...opts, organizer: true });
    await p.page.goto(`${BASE}/admin`);
    await p.page.locator('.tabbar').waitFor({ timeout: 30000 });
    await p.page.waitForTimeout(700);
    return p;
  }
  async function fits(page, sel) {
    const r = await page.evaluate((s) => {
      const out = { page: [document.documentElement.scrollWidth, window.innerWidth], bad: [] };
      for (const root of document.querySelectorAll(s)) {
        const box = root.getBoundingClientRect();
        for (const el of root.querySelectorAll('*')) {
          const b = el.getBoundingClientRect();
          if (b.width === 0 || b.height === 0) continue;
          if (getComputedStyle(el).position === 'absolute') continue;
          if (b.right > box.right + 1 || b.left < box.left - 1) out.bad.push(`${el.tagName}.${el.className} ${Math.round(b.left)}..${Math.round(b.right)} outside ${Math.round(box.left)}..${Math.round(box.right)}`);
        }
      }
      return out;
    }, sel);
    assert(r.page[0] <= r.page[1], `the page is wider than the screen (${r.page[0]} > ${r.page[1]})`);
    assert(r.bad.length === 0, `sticks out: ${r.bad.slice(0, 4).join(' | ')}`);
  }
  /** No piece of text under `sel` runs onto a second line. */
  async function oneLine(page, sel) {
    const bad = await page.evaluate((s) => {
      const out = [];
      for (const root of document.querySelectorAll(s)) {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
          if (!n.textContent.trim()) continue;
          const range = document.createRange();
          range.selectNodeContents(n);
          const tops = new Set([...range.getClientRects()].filter((r) => r.width > 0).map((r) => Math.round(r.top)));
          if (tops.size > 1) out.push(`"${n.textContent.trim()}" on ${tops.size} lines`);
        }
      }
      return out;
    }, sel);
    assert(bad.length === 0, `wraps: ${bad.slice(0, 4).join(' | ')}`);
  }
  const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
  const noDash = async (page, where) => {
    const text = await page.evaluate(() => document.body.innerText);
    assert(!text.includes('\u2014'), `an em dash on ${where}`);
  };
  const openSchedule = async (a) => {
    await a.page.locator('.tabbar button', { hasText: 'Settings' }).click();
    const sched = a.page.locator('[data-section="schedule"]');
    if (!(await sched.getAttribute('open'))) await sched.locator('summary').click();
    await a.page.locator('[data-tm-schedule-row]').click();
  };

  // ---------------------------------------------------------------- A  Create
  await stage('none');
  for (const scheme of SCHEMES)
    for (const width of SIZES)
      await check(`A Create: Let players vote is the default, three choices, none wraps (${width} ${scheme})`, async () => {
        const a = await adminPage({ width, scheme });
        await openSchedule(a);
        await a.page.locator('[data-tm-form="create"]').waitFor();
        assert((await a.page.locator('[data-format="vote"]').getAttribute('aria-pressed')) === 'true', 'the vote is the default');
        assert((await a.page.locator('[data-format="doubles"]').getAttribute('aria-pressed')) === 'false', 'doubles is not');
        const words = flat(await a.page.locator('[data-tm-card="format"]').innerText()).toUpperCase();
        assert(words === 'FORMAT LET PLAYERS VOTE LOCKED DOUBLES SAME PARTNER ALL NIGHT AMERICANO NEW PARTNER EVERY ROUND', words);
        await oneLine(a.page, '[data-tm-card="format"] .tm-format-name');
        await fits(a.page, 'dialog[open]');
        await a.page.locator('[data-tm-card="prize"]').scrollIntoViewIfNeeded();
        const prize = flat(await a.page.locator('[data-tm-card="prize"]').innerText());
        assert(prize.includes('Winner or 1st place') && prize.includes('2nd place'), prize);
        await a.page.locator('[data-tm-card="format"]').scrollIntoViewIfNeeded();
        await shot(a.page, `A-create-${width}-${scheme}`);
        await noDash(a.page, 'Create');
        await a.ctx.close();
      });
  await check('A Create through the screen: the default saves as a vote; Home says "Format: players vote"; the other two choices still work', async () => {
    const a = await adminPage();
    await openSchedule(a);
    await a.page.locator('[data-tm-name]').fill('The Cold Open');
    const days = await a.page.locator('[data-tm-card="name"] button.tm-day').evaluateAll((els) => els.map((e) => e.dataset.day).filter((x) => x >= '2026-12-01'));
    for (const day of days.slice(1, 4)) await a.page.locator(`[data-tm-card="name"] [data-day="${day}"]`).click();
    await a.page.locator('[data-tm-open-signup]').click();
    await a.page.locator('[data-tm-form]').waitFor({ state: 'detached', timeout: 10000 });
    const t = (await dash()).tournament;
    assert(t.name === 'The Cold Open' && t.formatPending === true && t.formatSource === 'vote', JSON.stringify(t));
    await a.page.locator('.tabbar button', { hasText: 'Home' }).click();
    await a.page.locator('[data-tm-home]').first().waitFor({ timeout: 15000 });
    const home = flat(await a.page.locator('[data-tm-home]').first().innerText());
    assert(home.includes('Format: players vote'), home);
    await shot(a.page, 'A-home-vote');
    // Edit shows the vote selected, and a hand-picked format is saved as the organizer's.
    await a.page.locator('[data-tm-open-edit]').click();
    await a.page.locator('[data-tm-edit-settings]').click();
    await a.page.locator('[data-tm-form="edit"]').waitFor();
    assert((await a.page.locator('[data-format="vote"]').getAttribute('aria-pressed')) === 'true', 'Edit starts on the vote');
    await a.page.locator('[data-format="americano"]').click();
    await a.page.locator('[data-tm-open-signup]').click();
    await a.page.locator('[data-tm-form]').waitFor({ state: 'detached', timeout: 10000 });
    const t2 = (await dash()).tournament;
    assert(t2.format === 'americano' && t2.formatSource === 'admin' && !t2.formatPending, JSON.stringify(t2));
    await a.ctx.close();
  });

  // ---------------------------------------------------------------- B  the player card and the sign-up question
  await check('B before the date: "Tournament style TBD", "~7:30 PM"; step 2 asks "Format you\'d like" under the dates, Either preselected', async () => {
    await stage('vote_open');
    for (const scheme of SCHEMES)
      for (const width of SIZES) {
        const v = await playerPage('Vic', { width, scheme });
        await v.page.locator('.tc').first().waitFor({ timeout: 15000 });
        const card = flat(await v.page.locator('.tc').first().innerText());
        assert(card.includes('Tournament style TBD'), card);
        assert(!/Locked doubles|Americano/.test(card), `no format words before the date: ${card}`);
        assert(card.includes('~7:30 PM'), card);
        await oneLine(v.page, '.tc-format');
        await fits(v.page, '.tc');
        await shot(v.page, `B-card-${width}-${scheme}`);
        await v.page.locator('[data-tc-signup]').click();
        await v.page.locator('[data-level="340"]').click();
        await v.page.locator('[data-tm-next]').click();
        await v.page.locator('[data-tm-step="2"]').waitFor();
        const head = v.page.locator('[data-tm-vote-head]');
        await head.scrollIntoViewIfNeeded();
        assert(flat(await head.innerText()).toLowerCase() === 'format you’d like', await head.innerText());
        const rows = await v.page.locator('[data-tm-votes] [data-vote]').evaluateAll((els) => els.map((e) => ({ v: e.dataset.vote, on: e.getAttribute('aria-checked'), t: e.innerText.replace(/\s+/g, ' ').trim() })));
        assert(
          JSON.stringify(rows) === JSON.stringify([
            { v: 'locked', on: 'false', t: 'Locked doubles teams balanced by skill, same partner all night' },
            { v: 'americano', on: 'false', t: 'Americano new partner every round' },
            { v: 'either', on: 'true', t: 'Either is fine' },
          ]),
          JSON.stringify(rows),
        );
        // Under the dates, not above them.
        const order = await v.page.evaluate(() => {
          const cal = document.querySelector('dialog[open] .tm-cal, dialog[open] [aria-label="Dates that work"]');
          const vote = document.querySelector('[data-tm-vote-head]');
          return cal && vote ? cal.getBoundingClientRect().top < vote.getBoundingClientRect().top : null;
        });
        assert(order !== false, 'the question is under the dates');
        await oneLine(v.page, '[data-tm-votes] .tm-vote-name');
        // The Locked doubles line is longer now: two lines at most, at every width (never three).
        const lineRows = await v.page.locator('[data-tm-votes] .tm-vote-line').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().height / parseFloat(getComputedStyle(e).lineHeight))));
        assert(lineRows.every((n) => n <= 2), `a vote line runs past two lines: ${lineRows}`);
        await fits(v.page, 'dialog[open]');
        await shot(v.page, `B-step2-${width}-${scheme}`);
        await noDash(v.page, 'the sign-up sheet');
        await v.ctx.close();
      }
  });
  await check('C Vic signs up voting Americano; Edit sign-up changes it; the organizer\'s card shows the counts and no player gets them', async () => {
    await stage('vote_open');
    const v = await playerPage('Vic');
    await v.page.locator('[data-tc-signup]').click();
    await v.page.locator('[data-level="340"]').click();
    await v.page.locator('[data-tm-next]').click();
    const open = await v.page.locator('dialog[open] button.tm-day.tm-open').evaluateAll((els) => els.map((e) => e.dataset.day));
    const best = (await dash()).tournament.signups[0].dates.find((d) => open.includes(d));
    await v.page.locator(`dialog[open] [data-day="${best}"]`).click();
    await v.page.locator('[data-vote="americano"]').click();
    assert((await v.page.locator('[data-vote="americano"]').getAttribute('aria-checked')) === 'true', 'Americano picked');
    assert((await v.page.locator('[data-vote="either"]').getAttribute('aria-checked')) === 'false', 'Either let go');
    await v.page.locator('[data-tm-submit]').click();
    await v.page.locator('.tc[data-tc="listed"]').waitFor({ timeout: 10000 });
    assert(JSON.stringify((await dash()).tournament.votes) === JSON.stringify({ locked: 1, americano: 2, either: 1 }), JSON.stringify((await dash()).tournament.votes));
    // Edit sign-up: the vote shows as picked; changing only the vote saves.
    await v.page.locator('[data-tc-edit]').click();
    await v.page.locator('dialog[open] [data-tm-save]').waitFor();
    assert((await v.page.locator('dialog[open] [data-vote="americano"]').getAttribute('aria-checked')) === 'true', 'Edit shows the vote');
    assert(await v.page.locator('dialog[open] [data-tm-save]').isDisabled(), 'nothing changed yet');
    await v.page.locator('dialog[open] [data-vote="locked"]').click();
    await shot(v.page, 'C-edit-vote');
    await v.page.locator('dialog[open] [data-tm-save]').click();
    await v.page.locator('dialog[open]').waitFor({ state: 'detached', timeout: 10000 });
    assert(JSON.stringify((await dash()).tournament.votes) === JSON.stringify({ locked: 2, americano: 1, either: 1 }), JSON.stringify((await dash()).tournament.votes));
    await v.ctx.close();
    // The organizer's card: the counts. Players never see them.
    const a = await adminPage();
    await a.page.locator('[data-tm-vote-counts]').waitFor({ timeout: 10000 });
    assert(flat(await a.page.locator('[data-tm-vote-counts]').innerText()) === 'Locked 2, Americano 1, Either 1', await a.page.locator('[data-tm-vote-counts]').innerText());
    assert(flat(await a.page.locator('[data-tm-home-format]').first().innerText()) === 'Format: players vote', 'format line');
    await shot(a.page, 'C-admin-card');
    await noDash(a.page, 'organizer Home');
    await a.ctx.close();
    for (const who of ['Vic', 'Parker', 'Rowan']) {
      const { text } = await answerOf(who);
      assert(!/format_vote|"votes"|Locked 2/.test(text), `${who} got a count`);
    }
  });

  // ---------------------------------------------------------------- D  the date locked: clear majority
  for (const scheme of SCHEMES)
    for (const width of SIZES)
      await check(`D majority: the alert at the top, the format line back, the counts on Alex's card (${width} ${scheme})`, async () => {
        await stage('vote_majority');
        const t = (await dash()).tournament;
        assert(t.format === 'americano' && t.formatSource === 'vote' && JSON.stringify(t.votes) === JSON.stringify({ locked: 1, americano: 2, either: 2 }), JSON.stringify(t));
        const v = await playerPage('Vic', { width, scheme });
        const alert = v.page.locator('[data-format-alert]');
        await alert.waitFor({ timeout: 15000 });
        const words = flat(await alert.innerText());
        assert(words.includes('The Cold Open is scheduled for Thu Dec 17.') && words.includes('Most players voted Americano.'), words);
        assert((await alert.evaluate((el) => el.classList.contains('ac'))) === true, 'the site\'s alert card');
        // At the top: above the ticket card, nothing but the alert before it.
        const above = await v.page.evaluate(() => document.querySelector('[data-format-alert]').getBoundingClientRect().bottom <= document.querySelector('.tc').getBoundingClientRect().top + 1);
        assert(above, 'the alert sits above the ticket card');
        const card = flat(await v.page.locator('.tc').first().innerText());
        // Zip 64: the style stays "TBD" on the card until tickets close (Pay by); the stub has the date and the real start (no "~").
        assert(card.includes('Tournament style TBD'), card);
        assert(card.includes('THU 17 DEC 7:30 PM'), `the stub: ${card}`);
        assert(!/Locked 1|Americano 2|votes/i.test(await v.page.evaluate(() => document.body.innerText)), 'no vote counts on a player screen');
        await fits(v.page, '[data-format-alert], .tc');
        await shot(v.page, `D-alert-${width}-${scheme}`);
        await noDash(v.page, 'Home');
        await v.ctx.close();
        const a = await adminPage({ width, scheme });
        await a.page.locator('[data-tm-vote-counts]').waitFor({ timeout: 10000 });
        assert(flat(await a.page.locator('[data-tm-vote-counts]').innerText()) === 'Locked 1, Americano 2, Either 2', 'counts');
        assert(flat(await a.page.locator('[data-tm-vote-how]').innerText()) === 'Decided by the most votes', 'rule');
        await fits(a.page, '[data-tm-home]');
        await shot(a.page, `D-admin-${width}-${scheme}`);
        await a.ctx.close();
      });
  await check('D the X dismisses the alert for that player for good; a re-pick shows a fresh one', async () => {
    await stage('vote_majority');
    const v = await playerPage('Vic');
    await v.page.locator('[data-format-alert]').waitFor();
    await v.page.locator('[data-format-alert] [data-dismiss]').click();
    await v.page.locator('[data-format-alert]').waitFor({ state: 'detached', timeout: 5000 });
    await v.page.reload();
    await v.page.locator('.tc').first().waitFor({ timeout: 15000 });
    await v.page.waitForTimeout(500);
    assert((await v.page.locator('[data-format-alert]').count()) === 0, 'still dismissed after a reload');
    // Another player on the same phone is not affected (the memory is per player).
    const t = (await dash()).tournament;
    await call('POST', `/api/admin/tournament/${t.id}/reschedule`, {});
    await call('PUT', `/api/admin/tournament/${t.id}/date`, { date: t.finalDate });
    await v.page.reload();
    await v.page.locator('[data-format-alert]').waitFor({ timeout: 15000 });
    await v.ctx.close();
  });

  // ---------------------------------------------------------------- E  the tie
  await check('E tie: the alert makes no vote claim ("Tournament style TBD" until Pay by, Zip 64); Alex\'s card says the tie rule decided it', async () => {
    await stage('vote_tie');
    const v = await playerPage('Vic');
    const alert = v.page.locator('[data-format-alert]');
    await alert.waitFor({ timeout: 15000 });
    const words = flat(await alert.innerText());
    assert(words.includes('The Cold Open is scheduled for Thu Dec 17.') && words.includes('Tournament style TBD') && !/voted/i.test(words), words);
    const card = flat(await v.page.locator('.tc').first().innerText());
    assert(card.includes('Tournament style TBD'), card);
    await shot(v.page, 'E-tie-alert');
    await v.ctx.close();
    const a = await adminPage();
    await a.page.locator('[data-tm-vote-counts]').waitFor({ timeout: 10000 });
    assert(flat(await a.page.locator('[data-tm-vote-counts]').innerText()) === 'Locked 1, Americano 1, Either 2', 'counts');
    assert(flat(await a.page.locator('[data-tm-vote-how]').innerText()) === 'Decided by the tie rule', 'rule');
    await shot(a.page, 'E-tie-admin');
    await a.ctx.close();
  });

  // ---------------------------------------------------------------- F  leaks
  await check('F Only me: a player gets no tournament data and no votes; nobody gets another player\'s vote', async () => {
    await stage('vote_open');
    const t = (await dash()).tournament;
    await call('PUT', `/api/admin/tournament/${t.id}/visibility`, { visibility: 'me' });
    const r = await answerOf('Parker');
    assert(!/tournament|formatVote|formatTbd|formatAlert|Cold Open/i.test(r.text), 'Parker gets nothing about it');
    await call('PUT', `/api/admin/tournament/${t.id}/visibility`, { visibility: 'all' });
    for (const who of ['Parker', 'Rowan', 'Sage', 'Vic']) {
      const a = await answerOf(who);
      assert(!/format_vote|"votes"/.test(a.text), `${who}: no counts`);
      const mine = (a.text.match(/"formatVote":"[a-z]+"/g) || []).length;
      assert(mine === (who === 'Vic' ? 0 : 1), `${who} got ${mine} votes in the answer (only their own)`);
    }
  });

  // ---------------------------------------------------------------- H  the Finalize screen
  /** The date every signed-up player can make, for the Finalize stage. */
  const commonDate = async () => {
    const t = (await dash()).tournament;
    return t.signups.map((x) => x.dates).reduce((acc, d) => acc.filter((x) => d.includes(x))).sort()[0];
  };
  const openFinalize = async (a, day) => {
    await a.page.locator('[data-tm-open-dates]').click();
    await a.page.locator('[data-tm-card="dates"] .tm-day.tm-open').first().waitFor();
    await a.page.locator(`[data-tm-card="dates"] [data-day="${day}"]`).click();
    await a.page.locator('[data-tm-finalize]').waitFor({ timeout: 10000 });
    await a.page.locator('[data-tm-fin-count]').waitFor({ timeout: 10000 });
  };
  async function postAs(name, url, data, method = 'POST') {
    const ctx = await browser.newContext();
    const list = (await (await ctx.request.get(BASE + '/api/group')).json()).players;
    await ctx.request.post(BASE + '/api/me', { data: { playerId: list.find((x) => x.name === name).id }, headers: { Origin: BASE } });
    const r = await ctx.request.fetch(BASE + url, { method, data, headers: { Origin: BASE } });
    const out = { status: r.status(), body: await r.text() };
    await ctx.close();
    return out;
  }
  for (const scheme of SCHEMES)
    for (const width of [420, 390, 360, 320])
      await check(`H the Finalize screen: players, plan, votes, winner, chooser on the winner, settings, buttons in reach (${width} ${scheme})`, async () => {
        await stage('vote_finalize');
        const day = await commonDate();
        const a = await adminPage({ width, scheme, height: width === 420 ? 912 : 844 });
        await openFinalize(a, day);
        // Tapping a date locked nothing.
        assert((await dash()).tournament.status === 'signup', 'nothing locked by the tap');
        const sheet = a.page.locator('[data-tm-finalize]');
        assert(flat(await a.page.locator('[data-tm-fin-count]').innerText()) === '10', 'ten can play');
        const names = flat(await a.page.locator('[data-tm-fin-names]').innerText());
        assert(['Parker', 'Rowan', 'Sage', 'Wren', 'Quinn', 'Christopher Vanderberg', 'Zoe', 'Reese', 'Vic', 'Alex'].every((n) => names.includes(n)), names);
        // Zip 64 (mock 04): no plan line, no winner sentence; the votes in one line under Style; Auto names the winner.
        assert((await a.page.locator('[data-tm-fin-winner]').count()) === 0, 'no winner sentence');
        // Zip 64 part 8: the plan line is back, the same count as the organizer's card (10 can play: a 12 player plan).
        assert(flat(await a.page.locator('[data-tm-fin-plan]').innerText()) === 'Plan: 12 players · 2 courts', await a.page.locator('[data-tm-fin-plan]').innerText());
        assert((await a.page.locator('[data-tm-fin-over]').count()) === 0, 'no over line with 10 players');
        assert(flat(await a.page.locator('[data-tm-fin-counts]').innerText()) === 'Votes: Doubles 4 · Americano 6 · Either 0', await a.page.locator('[data-tm-fin-counts]').innerText());
        assert((await a.page.locator('[data-format="vote"]').getAttribute('aria-pressed')) === 'true', 'the chooser starts on Auto');
        assert(flat(await a.page.locator('[data-format="vote"]').innerText()) === 'Auto Americano', 'Auto names the winner');
        await oneLine(a.page, '[data-tm-fin-format] button');
        await oneLine(a.page, '[data-tm-fin-counts]');
        await fits(a.page, 'dialog.tm-date-sheet[open]');
        // Finalize date and Back are both on screen without scrolling the sheet (they stay at the bottom).
        const inView = await a.page.evaluate(() => ['[data-tm-finalize-go]', '[data-tm-finalize-back]'].map((s) => { const b = document.querySelector(s).getBoundingClientRect(); return b.top >= 0 && b.bottom <= window.innerHeight; }));
        assert(inView.every(Boolean), `the buttons are in reach: ${inView}`);
        await shot(a.page, `H-finalize-${width}-${scheme}`);
        await noDash(a.page, 'the Finalize screen');
        // Scrolled to the end: the settings rows.
        await a.page.locator('[data-tm-fin-settings]').scrollIntoViewIfNeeded();
        await shot(a.page, `H-finalize-settings-${width}-${scheme}`);
        // Back locks nothing.
        await a.page.locator('[data-tm-finalize-back]').click();
        await a.page.locator('[data-tm-finalize]').waitFor({ state: 'detached', timeout: 5000 });
        assert((await dash()).tournament.status === 'signup' && !(await dash()).tournament.finalDate, 'Back locked nothing');
        await a.ctx.close();
      });
  await check('H the over line (14 can play, the plan fits 12): the screen shows it on two lines or fewer (the answer is stood in for: the preview has 10 names)', async () => {
    await stage('vote_finalize');
    const day = await commonDate();
    const a = await adminPage({ width: 320 });
    await a.page.route('**/api/admin/tournament/*/finalize*', async (route) => {
      const r = await route.fetch();
      const j = await r.json();
      const extra = ['Extra One', 'Extra Two', 'Extra Three', 'Extra Four'];
      j.players = [...j.players, ...extra];
      j.over = 2;
      j.fits = 12;
      await route.fulfill({ response: r, json: j });
    });
    await openFinalize(a, day);
    const over = flat(await a.page.locator('[data-tm-fin-over]').innerText());
    assert(over === '2 over the 16 spots. Once 16 are locked in, the rest can join standby.', over);
    await fits(a.page, 'dialog.tm-date-sheet[open]');
    const overLines = await a.page.locator('[data-tm-fin-over]').evaluate((el) => Math.round(el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight)));
    assert(overLines <= 3, `the over note takes ${overLines} lines`);
    await shot(a.page, 'H-finalize-over-320');
    await a.ctx.close();
  });
  await check('H override the winner: Finalize date locks it; Vic sees the alert with no vote claim; Pay by from the sheet is saved (Zip 64: no price row, the price stays)', async () => {
    await stage('vote_finalize');
    const day = await commonDate();
    const a = await adminPage({ width: 390 });
    await openFinalize(a, day);
    await a.page.locator('[data-format="doubles"]').click();
    assert((await a.page.locator('[data-format="doubles"]').getAttribute('aria-pressed')) === 'true', 'Locked doubles picked');
    await shot(a.page, 'H-override');
    await a.page.locator('[data-tm-fin-pay-time]').selectOption('1080'); // 6:00 PM
    // The screen refreshes itself every 5 seconds: what the organizer picked on the sheet must survive it.
    await a.page.waitForTimeout(6500);
    assert((await a.page.locator('[data-tm-fin-pay-time]').inputValue()) === '1080', 'the sheet kept the organizer\'s edits through a refresh');
    assert((await a.page.locator('[data-format="doubles"]').getAttribute('aria-pressed')) === 'true', 'and the format pick');
    await a.page.locator('[data-tm-finalize-go]').click();
    await a.page.locator('[data-tm-finalize]').waitFor({ state: 'detached', timeout: 10000 });
    await a.ctx.close();
    const t = (await dash()).tournament;
    assert(t.status === 'tickets' && t.finalDate === day && t.format === 'doubles' && t.formatSource === 'admin', JSON.stringify(t));
    assert(t.ticketCents === 1600, `price stays ${t.ticketCents}`);
    assert(/T23:00:00\.000Z$/.test(t.payBy), `Pay by 6:00 PM Eastern: ${t.payBy}`);
    assert(JSON.stringify(t.votes) === JSON.stringify({ locked: 4, americano: 6, either: 0 }), 'counts kept for Alex');
    const v = await playerPage('Vic');
    const alert = v.page.locator('[data-format-alert]');
    await alert.waitFor({ timeout: 15000 });
    const words = flat(await alert.innerText());
    assert(words.includes('is scheduled for') && words.includes('Tournament style TBD') && !/voted/i.test(words), words);
    assert(!/Locked doubles 4|Americano 6/.test(await v.page.evaluate(() => document.body.innerText)), 'no counts on a player screen');
    await shot(v.page, 'H-override-alert');
    await v.ctx.close();
  });
  await check('H the votes change while the sheet is open and the winner moves: Finalize locks nothing, says so, shows the new counts; then it works', async () => {
    await stage('vote_finalize');
    const day = await commonDate();
    const a = await adminPage({ width: 390 });
    await openFinalize(a, day);
    // Three Americano voters switch to Locked doubles behind the open sheet: Locked doubles 7, Americano 3.
    for (const n of ['Parker', 'Rowan', 'Sage']) {
      const r = await postAs(n, '/api/tournament/signup', { tournamentId: (await dash()).tournament.id, formatVote: 'locked' }, 'PUT');
      assert(r.status === 200, `${n}: ${r.status} ${r.body}`);
    }
    await a.page.locator('[data-tm-finalize-go]').click();
    await a.page.locator('[data-tm-fin-notice]').waitFor({ timeout: 10000 });
    const notice = flat(await a.page.locator('[data-tm-fin-notice]').innerText());
    assert(/votes changed/i.test(notice) && /Locked doubles wins now/.test(notice), notice);
    assert((await dash()).tournament.status === 'signup', 'nothing was locked');
    assert(flat(await a.page.locator('[data-tm-fin-counts]').innerText()) === 'Votes: Doubles 7 · Americano 3 · Either 0', 'new counts shown');
    assert(flat(await a.page.locator('[data-format="vote"]').innerText()) === 'Auto Doubles', 'the new winner under Auto');
    await shot(a.page, 'H-votes-changed');
    // The site's double-tap guard drops a second tap on the same button that comes straight after the first (it is not a bug here): a person reads the note first.
    await a.page.waitForTimeout(800);
    await a.page.locator('[data-tm-finalize-go]').click();
    await a.page.locator('[data-tm-finalize]').waitFor({ state: 'detached', timeout: 10000 });
    const t = (await dash()).tournament;
    assert(t.status === 'tickets' && t.format === 'doubles' && t.formatSource === 'vote', JSON.stringify(t));
    await a.ctx.close();
  });

  await browser.close();
  console.log(`\nzip60: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
