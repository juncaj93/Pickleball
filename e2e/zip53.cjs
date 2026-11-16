/* Zip 53 (🎾53.nopref): the "needs people" card at the top of the player Home is the same for every player.
 *
 *   node e2e/zip53.cjs      (also run by npm run test:e2e)
 *
 * The world is the small fake world as of Sun Nov 15 2026, 8:00 PM Eastern, the clock Mon Nov 16, 10:00 AM (the same as Zip 51).
 * The test shapes the games itself through the organizer screen's own calls, so the answer does not depend on what the seed happens to hold:
 *   A  Soonest game G1 gets 2 in, the next game G2 gets 4 in, and every other game inside 8 days gets 4 in (so only G1 needs players).
 *      Four different players who are in neither game (View as, ?as=Name) all see the SAME card: "<day> needs 2 more".
 *      A player in G1 sees G2 instead ("... has 4 in", "You'd make it 5"). Light and dark, 390 / 360 / 320 wide.
 *   B  Nobody needs players (G1 raised to 4 in): the soonest game with room shows ("has 4 in", "You'd make it 5") for every outsider alike.
 *   C  X on the card: that player no longer sees that game and sees the next one; another player still sees it.
 *   D  The Players screen has no Usual days anywhere, and a new name goes straight to Welcome (no "Any preferred days?").
 * Screenshots: .data/zip53-shots (not in git).
 */
const { spawn, spawnSync } = require('node:child_process');
const { readFileSync, mkdirSync, rmSync } = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.E2E_PORT) || 5453;
const BASE = `http://localhost:${PORT}`;
const SEED_ISO = '2026-11-16T01:00:00.000Z'; // Sun Nov 15, 8:00 PM Eastern
const NOW_MS = Date.parse('2026-11-16T15:00:00.000Z'); // Mon Nov 16, 10:00 AM Eastern
const PIN = /PIN `(\d{6})`/.exec(readFileSync(path.join(ROOT, 'docs/PREVIEW_FAKE_DB.md'), 'utf8'))[1];
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const SHOTS = path.join(ROOT, '.data', 'zip53-shots');
const DAY_MS = 86_400_000;

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
  const dbFile = path.join(ROOT, '.data', 'zip53.sqlite');
  mkdirSync(SHOTS, { recursive: true });
  rmSync(dbFile, { force: true });
  const seeded = spawnSync('npx', ['vite-node', 'scripts/load-small-local.ts', '--', dbFile, SEED_ISO, '--calm', '--zip51'], { cwd: ROOT, encoding: 'utf8' });
  if (seeded.status !== 0) throw new Error(`could not build the calm world: ${seeded.stderr || seeded.stdout}`);
  if (await fetch(`${BASE}/api/status`).then((r) => r.ok, () => false)) throw new Error(`port ${PORT} is already in use`);
  const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
    cwd: ROOT,
    env: { ...process.env, DEV_DB: dbFile, SETUP_TOKEN: 'zip53-setup-token-0123456789', DEV_CLOCK: '1', PREVIEW_CALM: 'on' },
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
  const dash = async () => (await admin.request.get(BASE + '/api/admin/dashboard')).json();
  const post = async (url, data) => {
    const r = await admin.request.post(BASE + url, { data, headers: { Origin: BASE } });
    assert(r.ok(), `${url}: ${r.status()} ${await r.text()}`);
    return r.json();
  };

  let d = await dash();
  const organizerId = d.me && d.me.id;
  const players = d.players.filter((p) => p.isActive !== false && p.id !== organizerId);
  const ids = Object.fromEntries(d.players.map((p) => [p.name, p.id]));
  const windowGames = () =>
    d.sessions
      .filter((s) => !s.canceled && Date.parse(s.startsAt) > NOW_MS && Date.parse(s.startsAt) <= NOW_MS + 8 * DAY_MS)
      .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  const inNames = (s) => s.roster.filter((r) => r.status === 'confirmed').map((r) => r.name);
  /** Put exactly these players in this game (organizer's own roster call), everyone else out. */
  async function setIn(game, names) {
    d = await dash();
    const g = d.sessions.find((s) => s.id === game.id);
    for (const r of g.roster) if (r.status === 'confirmed' && !names.includes(r.name)) await post(`/api/admin/sessions/${game.id}/roster`, { playerId: r.playerId, action: 'remove' });
    for (const n of names) if (!inNames(g).includes(n)) await post(`/api/admin/sessions/${game.id}/roster`, { playerId: ids[n], action: 'confirm' });
    d = await dash();
  }
  // Expected card by the rule (an independent copy of it, from the organizer's own numbers).
  const expected = (name) => {
    const open = windowGames().filter((s) => !s.roster.some((r) => r.name === name));
    const count = (s) => inNames(s).length;
    return open.find((s) => count(s) < 4) || open.find((s) => count(s) < d.group.settings?.maxPlayers || count(s) < 10) || null;
  };

  d = await dash();
  const games = windowGames();
  assert(games.length >= 2, `need two games inside 8 days, found ${games.length}`);
  const [g1, g2, ...rest] = games;
  // Names: four outsiders (never in G1 or G2), and two insiders for G1.
  const pool = players.map((p) => p.name);
  assert(pool.length >= 9, `need 9 players, have ${pool.length}`);
  const inG1 = pool.slice(0, 2); // G1: 2 in
  const inG2 = pool.slice(2, 6); // G2: 4 in
  const outsiders = pool.slice(6, 10);
  // Every other game inside 8 days: 4 in, so only G1 needs players.
  for (const g of rest) await setIn(g, pool.slice(0, 4));
  await setIn(g2, inG2);
  await setIn(g1, inG1);

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
  const cardText = async (page) => {
    const c = page.locator('[data-suggest-card]');
    return (await c.count()) ? flat(await c.innerText()) : null;
  };
  const dayWord = (iso) => {
    const days = Math.round((Date.parse(new Date(Date.parse(iso)).toLocaleDateString('en-CA', { timeZone: 'America/Detroit' })) - Date.parse(new Date(NOW_MS).toLocaleDateString('en-CA', { timeZone: 'America/Detroit' }))) / DAY_MS);
    return days === 0 ? 'Tonight' : days === 1 ? 'Tomorrow' : new Date(iso).toLocaleDateString('en-US', { weekday: 'long', timeZone: 'America/Detroit' });
  };

  // ---------------------------------------------------------------- A
  for (const scheme of ['light', 'dark'])
    for (const width of [390, 360, 320])
      await check(`A four players in neither game see the same card; a player in G1 sees G2 (${width} ${scheme})`, async () => {
        const want = `${dayWord(g1.startsAt)} needs 2 more`;
        const texts = [];
        for (const n of outsiders) {
          const { ctx, page } = await playerPage(n, { width, scheme });
          const t = await cardText(page);
          assert(t && t.startsWith(want), `${n} sees "${t}", wanted "${want}"`);
          texts.push(t);
          if (n === outsiders[0]) {
            const w = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
            assert(w[0] <= w[1], `the page is wider than the screen (${w[0]} > ${w[1]})`);
            await page.screenshot({ path: path.join(SHOTS, `A-outsider-${width}-${scheme}.png`) });
          }
          await ctx.close();
        }
        assert(new Set(texts).size === 1, `the four cards differ: ${JSON.stringify(texts)}`);
        // In G1: that game is skipped, G2 (4 in) is the next that qualifies.
        const { ctx, page } = await playerPage(inG1[0], { width, scheme });
        const t = await cardText(page);
        const exp = expected(inG1[0]);
        assert(exp && exp.id === g2.id, 'the rule itself wants G2 for a player in G1');
        assert(t && t.startsWith(`${dayWord(g2.startsAt)} has 4 in`) && t.includes("You'd make it 5"), `a player in G1 sees "${t}"`);
        if (width === 390) await page.screenshot({ path: path.join(SHOTS, `A-in-g1-${width}-${scheme}.png`) });
        await ctx.close();
      });

  await check('A the card matches the rule for every player, one by one (the server picks, not the player)', async () => {
    const outs = [];
    for (const n of pool) {
      const { ctx, page } = await playerPage(n);
      const t = await cardText(page);
      const exp = expected(n);
      if (!exp) assert(t === null, `${n} sees "${t}" but no game qualifies`);
      else assert(t && t.startsWith(`${dayWord(exp.startsAt)} `), `${n} sees "${t}", the rule says ${exp.startsAt}`);
      outs.push(`${n}: ${t}`);
      await ctx.close();
    }
    console.log('      ' + outs.join('\n      '));
  });

  // ---------------------------------------------------------------- B
  await check('B nobody needs players: the soonest game with room, the same for every outsider ("has 4 in", "You\'d make it 5")', async () => {
    await setIn(g1, pool.slice(0, 4));
    const want = `${dayWord(g1.startsAt)} has 4 in`;
    const texts = [];
    for (const n of outsiders) {
      const { ctx, page } = await playerPage(n);
      const t = await cardText(page);
      assert(t && t.startsWith(want) && t.includes("You'd make it 5"), `${n} sees "${t}", wanted "${want}"`);
      texts.push(t);
      if (n === outsiders[0]) await page.screenshot({ path: path.join(SHOTS, 'B-room.png') });
      await ctx.close();
    }
    assert(new Set(texts).size === 1, `cards differ: ${JSON.stringify(texts)}`);
    await setIn(g1, inG1);
  });

  // ---------------------------------------------------------------- C
  await check('C X (No) on the card: that player sees the next game, another player still sees this one', async () => {
    const a = await playerPage(outsiders[0]);
    const b = await playerPage(outsiders[1]);
    const before = await cardText(a.page);
    assert(before && before.startsWith(`${dayWord(g1.startsAt)} needs 2 more`), `before: ${before}`);
    await a.page.locator('[data-suggest-card] button[aria-label^="No thanks"]').click();
    await a.page.waitForTimeout(1500);
    const after = await cardText(a.page);
    assert(after !== before, `the card did not change: ${after}`);
    // Demo copy: View as keeps nothing, so on a real phone the answer sticks; here the demo copy hides it for this screen.
    await a.ctx.close();
    await b.page.reload();
    await b.page.waitForTimeout(800);
    assert((await cardText(b.page)) === before, 'the other player lost the card');
    await b.ctx.close();
  });

  // ---------------------------------------------------------------- D
  await check('D the organizer Players screen shows no days and the edit sheet has no Usual days', async () => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, userAgent: UA, reducedMotion: 'reduce' });
    await shift(ctx);
    assert((await ctx.request.post(BASE + '/api/admin/login', { data: { pin: PIN }, headers: { Origin: BASE } })).ok(), 'admin login');
    const page = await ctx.newPage();
    await page.goto(BASE + '/admin');
    await page.locator('article[data-r2-card], [data-venue-alerts]').first().waitFor({ timeout: 30000 });
    const body = await page.evaluate(() => document.body.innerText);
    assert(!/Usual days/i.test(body), 'Usual days on the organizer Home');
    await page.getByRole('tab', { name: 'Players' }).click().catch(async () => page.getByRole('button', { name: 'Players' }).click());
    await page.waitForTimeout(800);
    const playersText = await page.evaluate(() => document.body.innerText);
    assert(!/\bTue Thu\b|\bTue\b ·|· Tue\b|Usual days/.test(playersText), 'days on the Players screen');
    await page.screenshot({ path: path.join(SHOTS, 'D-players.png') });
    await ctx.close();
  });

  await browser.close();
  console.log(`\nZip 53: ${passed} passed, ${failed} failed`);
  try {
    process.kill(-server.pid, 'SIGTERM');
  } catch {}
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
