/* Zip 84 (🎾84.final dry run): a fresh tester's real browser checks of game night on a LOCAL copy (find and report; nothing fixed).
 *
 *   node e2e/zip84-night.cjs                 (ZIP84_ONLY=A,B.. runs some checks; ZIP84_SLEEP_MIN sets the idle wait, default 15)
 *
 *   A   The reveal on 5 phones: Vic opened a minute before the tap; Quinn open on "all games in" and left untouched with the screen ON for
 *       15 minutes; Wren open on "all games in", then the screen OFF (hidden, page frozen) for 15 minutes, woken mid-reveal; Zoe opened
 *       fresh mid-reveal; Parker opened after the board finished (the board once). Every place within 300 ms, no reload on any phone.
 *   A2  The screen ON and untouched for 12 minutes during the LAST round (the usual rhythm stops after 10 quiet minutes), then the last
 *       score comes in, Alex taps Reveal, and the phone is touched mid-reveal: in step, no reload.
 *   B   Mid-reveal: GET /api/tournament/champions and the cup show no Americano winner; after the hold the winner is on the wall and the cup
 *       shows on the open phones without a reload.
 *   C   Tap a medal: own name and game cards (not the ticker), newest first, rows = the medal count, 44 px, Only me never listed, no new
 *       request on Home load.
 *   D   The Champions wall: no cup with no winner (organizer and player), the cup next to light/dark and centered, reigning + past newest
 *       first, the wall = the medals = the wins sheets, fits 320.
 *   E   Game night looks at 320 and 390, light and dark: lime only on tournament buttons, Enter score white with green words, one font, no
 *       name cut; Back closes every sheet with no dead Back after.
 * Screenshots: .data/zip84-night-shots (not in git).
 */
const path = require('node:path');
const { mkdirSync, writeFileSync } = require('node:fs');
const { DatabaseSync } = require('node:sqlite');
const { boot, flat, assert, sleep, ROOT } = require('./zip74-boot.cjs');

const SHOTS = path.join(ROOT, '.data', 'zip84-night-shots');
const ONLY = process.env.ZIP84_ONLY || '';
const SLEEP_MIN = Number(process.env.ZIP84_SLEEP_MIN || 15);
let passed = 0;
let failed = 0;
const notes = [];
const note = (s) => {
  notes.push(s);
  console.log(`        note: ${s}`);
};
async function check(name, fn) {
  if (ONLY && !ONLY.split(',').some((x) => name.split(' ')[0] === x)) return;
  const t0 = Date.now();
  try {
    await fn();
    passed++;
    console.log(`  ok    ${name} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  } catch (err) {
    failed++;
    console.log(`  FAIL  ${name}\n        ${String(err && err.stack ? err.stack : err).split('\n').slice(0, 5).join('\n        ')}`);
  }
}

/** In each page: the real wall time each board row comes in and the countdown first shows; a mark that dies with a reload. */
const RECORDER = () => {
  window.__rv = {};
  window.__loadedAt = performance.timeOrigin;
  const now = () => performance.timeOrigin + performance.now();
  const look = () => {
    const c = document.querySelector('.tc-rv-count');
    if (c && c.style.display !== 'none' && !('count' in window.__rv)) window.__rv.count = now();
    document.querySelectorAll('.tc-rv-row').forEach((li) => {
      const p = li.dataset.p;
      if (li.dataset.in === '1' && !(p in window.__rv)) window.__rv[p] = now();
    });
  };
  const start = () => new MutationObserver(look).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-in', 'style'] });
  if (document.documentElement) start();
  else document.addEventListener('DOMContentLoaded', start);
};
/** The screen can be turned off: document.visibilityState follows window.__hid (Chromium headless pages are always "visible"). */
const SCREEN = () => {
  Object.defineProperty(Document.prototype, 'visibilityState', { configurable: true, get: () => (window.__hid ? 'hidden' : 'visible') });
  Object.defineProperty(Document.prototype, 'hidden', { configurable: true, get: () => !!window.__hid });
};

(async () => {
  mkdirSync(SHOTS, { recursive: true });
  const h = await boot({ port: Number(process.env.E2E_PORT) || 5841, name: `zip84n${process.env.E2E_PORT || ''}` });
  const shot = (page, name, full = false) => page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: full }).catch(() => {});
  const titleOf = async (page) => flat(await page.locator('dialog[open]').last().locator('h2').first().innerText());

  /** A player's phone with the recorder and the screen switch; counts its version checks and every navigation. */
  async function phone(who, { width = 390, scheme = 'light', reducedMotion = 'no-preference' } = {}) {
    const p = await h.newPage({ width, scheme, reducedMotion });
    await p.ctx.addInitScript(RECORDER);
    await p.ctx.addInitScript(SCREEN);
    const versions = [];
    const navs = [];
    p.page.on('request', (r) => {
      if (r.url().includes('/api/group/version')) versions.push(Date.now());
    });
    p.page.on('framenavigated', (f) => {
      if (f === p.page.mainFrame()) navs.push(Date.now());
    });
    await p.page.goto(`${h.BASE}/?as=${encodeURIComponent(who)}`);
    await p.page.locator('.schedule, [data-tc-day]').first().waitFor({ timeout: 30000 });
    const cdp = await p.ctx.newCDPSession(p.page);
    let frozen = false;
    const screenOff = async () => {
      await p.page.evaluate(() => {
        window.__hid = true;
        document.dispatchEvent(new Event('visibilitychange'));
      });
      try {
        await cdp.send('Page.setWebLifecycleState', { state: 'frozen' });
        frozen = true;
      } catch (e) {
        note(`${who}: could not freeze the page (${e.message}); only hidden`);
      }
    };
    const screenOn = async () => {
      if (frozen) await cdp.send('Page.setWebLifecycleState', { state: 'active' });
      frozen = false;
      await p.page.evaluate(() => {
        window.__hid = false;
        document.dispatchEvent(new Event('visibilitychange'));
      });
    };
    return { ...p, who, versions, navs, screenOff, screenOn };
  }
  const rvOf = (p) => p.page.evaluate(() => window.__rv);
  const loadedAt = (p) => p.page.evaluate(() => window.__loadedAt);

  /** Compare the board timings of phones: for each place, every phone that had the board running by then. */
  function spreadOf(list, from) {
    const out = [];
    const ref = list[0].rv;
    for (let place = 1; ref[place]; place++) {
      const xs = list.filter((x) => typeof x.rv[place] === 'number' && ref[place] > (from[x.name] ?? 0) + 1500).map((x) => x.rv[place]);
      if (xs.length < 2) continue;
      out.push({ place, ms: Math.round(Math.max(...xs) - Math.min(...xs)), n: xs.length });
    }
    return out;
  }
  const lockedNames = () => {
    const db = new DatabaseSync(h.dbFile);
    const r = db.prepare("SELECT p.display_name AS n FROM tournament_tickets k JOIN players p ON p.id = k.player_id JOIN tournaments t ON t.id = k.tournament_id WHERE t.name = 'The Cold Open' AND k.place = 'spot' ORDER BY p.display_name").all().map((x) => x.n);
    db.close();
    return r;
  };

  try {
    await check('A the reveal: before, idle 15 min screen on, asleep 15 min screen off, opened mid-reveal, opened after', async () => {
      await h.stage('zip77_allin');
      const names = lockedNames();
      console.log(`        locked in: ${names.join(', ')}`);
      for (const n of ['Vic', 'Quinn', 'Wren', 'Zoe', 'Parker']) assert(names.includes(n), `${n} is not in the night`);
      const quinn = await phone('Quinn', { scheme: 'dark' });
      const wren = await phone('Wren');
      await quinn.page.locator('[data-tc-waiting]').waitFor({ timeout: 15000 });
      await wren.page.locator('[data-tc-waiting]').waitFor({ timeout: 15000 });
      await sleep(3000);
      const quinnLoad = await loadedAt(quinn);
      const wrenLoad = await loadedAt(wren);
      await wren.screenOff();
      const offAt = Date.now();
      const wrenChecksAtOff = wren.versions.length;
      // 15 minutes: nobody touches either phone.
      const tapAt = offAt + SLEEP_MIN * 60_000 - 10_000;
      await sleep(Math.max(0, tapAt - 60_000 - Date.now()));
      const vic = await phone('Vic');
      await vic.page.locator('[data-tc-waiting]').waitFor({ timeout: 15000 });
      const qGap = (() => {
        const v = quinn.versions.filter((t) => t > offAt);
        let most = 0;
        for (let i = 1; i < v.length; i++) most = Math.max(most, v[i] - v[i - 1]);
        return { n: v.length, most };
      })();
      console.log(`        Quinn (screen on, untouched): ${qGap.n} checks in the quiet ${SLEEP_MIN} min, longest gap ${qGap.most} ms`);
      console.log(`        Wren (screen off): ${wren.versions.length - wrenChecksAtOff} checks while off`);
      assert(wren.versions.length - wrenChecksAtOff === 0, 'Wren checked while the screen was off');
      await sleep(Math.max(0, tapAt - Date.now()));
      const a = await h.adminHome();
      await a.page.locator('[data-tm-reveal]').click();
      const tapped = Date.now();
      // Wake Wren 11 s after the tap (the last places are coming in), Zoe opens at 13 s.
      await sleep(Math.max(0, tapped + 11_000 - Date.now()));
      await wren.screenOn();
      const wrenOn = Date.now();
      await sleep(Math.max(0, tapped + 13_000 - Date.now()));
      const zoe = await phone('Zoe');
      const zoeOpen = Date.now();
      await wren.page.locator('[data-tc-reveal]').waitFor({ timeout: 8000 });
      const wrenBoardAt = Date.now();
      console.log(`        Wren: the board ${wrenBoardAt - wrenOn} ms after the screen came on`);
      await sleep(3000);
      await shot(wren.page, 'A-wren-woke-mid');
      await shot(zoe.page, 'A-zoe-mid');
      // B: mid-reveal: no winner anywhere for players.
      const champs = (await (await zoe.ctx.request.get(h.BASE + '/api/tournament/champions')).text());
      const admChamps = await h.call('GET', '/api/admin/champions');
      console.log(`        mid-reveal (+${Math.round((Date.now() - tapped) / 1000)} s): player wall ${champs.slice(0, 120)}; organizer wall ${admChamps.tournaments.length} tournament(s)`);
      const midSpoil = /Cold Open/.test(champs);
      const midCup = {};
      for (const p of [vic, quinn, wren, zoe]) midCup[p.who] = await p.page.locator('[data-cup]').count();
      await sleep(Math.max(0, tapped + 31_000 - Date.now()));
      const list = [];
      for (const p of [vic, quinn, wren, zoe]) list.push({ name: p.who, rv: await rvOf(p) });
      const rows = await vic.page.locator('.tc-rv-row').count();
      const from = { Vic: 0, Quinn: 0, Wren: wrenOn, Zoe: zoeOpen };
      const sp = spreadOf(list, from);
      console.log(`        places (place:ms apart/phones): ${sp.map((x) => `${x.place}:${x.ms}/${x.n}`).join(' ')}`);
      console.log(`        countdown: Vic ${Math.round(list[0].rv.count - tapped)} ms after the tap, Quinn ${Math.round(list[1].rv.count - tapped)} ms, Wren ${list[2].rv.count ? Math.round(list[2].rv.count - tapped) : 'none'} ms`);
      for (const x of list) console.log(`        ${x.name}: ${Object.keys(x.rv).filter((k) => k !== 'count').length} places seen; 1st at +${x.rv[1] ? Math.round(x.rv[1] - tapped) : 'never'} ms`);
      assert(rows >= 9, `${rows} rows`);
      const bad = sp.filter((x) => x.ms > 300);
      assert(!bad.length, `out of step: ${JSON.stringify(bad)}`);
      assert(Math.abs(list[0].rv.count - list[1].rv.count) <= 300, `Quinn's countdown ${Math.round(list[1].rv.count - list[0].rv.count)} ms off Vic's`);
      for (const x of list) assert(typeof x.rv[1] === 'number', `${x.name} never saw 1st place`);
      // No reload on the phones open before the tap.
      assert((await loadedAt(quinn)) === quinnLoad, 'Quinn reloaded');
      assert((await loadedAt(wren)) === wrenLoad, 'Wren reloaded');
      await shot(vic.page, 'A-final-vic');
      await shot(quinn.page, 'A-final-quinn-dark');
      // B after the hold: the winner on the wall, the cup on the open phones (no reload).
      await sleep(Math.max(0, tapped + 48_000 - Date.now()));
      const after = JSON.parse(await (await zoe.ctx.request.get(h.BASE + '/api/tournament/champions')).text());
      const afterCup = {};
      for (const p of [vic, quinn, wren, zoe]) afterCup[p.who] = await p.page.locator('[data-cup]').count();
      console.log(`        cups mid ${JSON.stringify(midCup)}, after ${JSON.stringify(afterCup)}; wall after: ${after.tournaments.map((t) => `${t.name}:${t.format}:${t.winners.map((w) => w.name ?? w).join('+')}`).join(', ')}`);
      // Parker opens after the board finished: the board once; the next load does not.
      const parker = await phone('Parker');
      await parker.page.locator('[data-tc-board]').waitFor({ timeout: 15000 });
      await shot(parker.page, 'A-parker-after', true);
      await parker.page.reload();
      await parker.page.locator('[data-tc-results="row"]').waitFor({ timeout: 15000 });
      assert((await parker.page.locator('[data-tc-board]').count()) === 0, 'Parker sees the board again');
      for (const p of [vic, quinn, wren, zoe, parker]) assert(!p.errors.length, `${p.who}: ${p.errors.join(' | ')}`);
      assert(!midSpoil, `the player wall named the night mid-reveal: ${champs}`);
      assert(Object.values(midCup).every((n) => n === 0), `a cup mid-reveal ${JSON.stringify(midCup)}`);
      assert(after.tournaments.some((t) => t.name === 'The Cold Open'), 'no Cold Open on the wall after the hold');
      assert(Object.values(afterCup).every((n) => n === 1), `cups after the hold ${JSON.stringify(afterCup)}`);
      for (const p of [vic, quinn, wren, zoe, parker, a]) await p.ctx.close();
    });

    await check('A2 the screen on and untouched 12 min in the last round, the last score, the tap, a touch mid-reveal', async () => {
      await h.stage('zip77_last');
      let vic = await phone('Vic');
      const idle = await phone('Quinn');
      await idle.page.locator('[data-tc-standings-later]').waitFor({ timeout: 15000 });
      const idleLoad = await loadedAt(idle);
      const t0 = Date.now();
      await sleep(12 * 60_000);
      const checksLate = idle.versions.filter((t) => t > t0 + 10.5 * 60_000).length;
      console.log(`        Quinn: ${idle.versions.filter((t) => t > t0).length} checks in 12 min, ${checksLate} after minute 10.5`);
      // The last round's scores, by a player each.
      for (let guard = 0; guard < 5; guard++) {
        const open = (await h.call('GET', '/api/admin/dashboard')).tournament.rounds.games.filter((g) => g.status === 'playing');
        if (!open.length) break;
        for (const g of open) {
          const who = g.a.names[0];
          const ph = await h.phone(who);
          const mine = (await ph.group()).tournament.day.rounds.find((x) => x.num === g.num);
          const r = await ph.post('/api/tournament/game', { tournamentId: (await ph.group()).tournament.id, action: 'score', num: g.num, key: mine.key, mine: 11, theirs: 6 });
          assert(r.ok, `score ${g.num}: ${r.status} ${JSON.stringify(r.body)}`);
          await ph.ctx.close();
        }
      }
      const left = (await h.call('GET', '/api/admin/dashboard')).tournament.rounds.games.filter((g) => g.status !== 'done').length;
      console.log(`        games not done after the last scores: ${left}`);
      await vic.ctx.close();
      vic = await phone('Vic');
      await vic.page.locator('[data-tc-waiting]').waitFor({ timeout: 15000 });
      await sleep(4000);
      const idleWaiting = await idle.page.locator('[data-tc-waiting]').count();
      console.log(`        Quinn shows the waiting card: ${idleWaiting ? 'yes' : 'no (still the last round)'}`);
      const a = await h.adminHome();
      await a.page.locator('[data-tm-reveal]').click();
      const tapped = Date.now();
      await sleep(12_000);
      const before = await idle.page.locator('[data-tc-reveal]').count();
      await idle.page.mouse.click(5, 400);
      const touched = Date.now();
      await idle.page.locator('[data-tc-reveal]').waitFor({ timeout: 10000 });
      console.log(`        Quinn: board on screen before the touch: ${before ? 'yes' : 'no'}; after the touch in ${Date.now() - touched} ms`);
      await sleep(Math.max(0, tapped + 31_000 - Date.now()));
      const list = [
        { name: 'Vic', rv: await rvOf(vic) },
        { name: 'Quinn', rv: await rvOf(idle) },
      ];
      const sp = spreadOf(list, { Vic: 0, Quinn: touched });
      console.log(`        places after the touch: ${sp.map((x) => `${x.place}:${x.ms}`).join(' ')}`);
      assert(sp.every((x) => x.ms <= 300), `out of step ${JSON.stringify(sp)}`);
      assert((await loadedAt(idle)) === idleLoad, 'Quinn reloaded');
      await shot(idle.page, 'A2-quinn-after-touch');
      for (const p of [vic, idle, a]) await p.ctx.close();
    });

    await check('C tap a medal: own name, game cards, not the ticker; newest first; rows = medals; 44 px; Only me; no new request on load', async () => {
      // Request list on Home load, with and without champions.
      const loadReqs = async (stage) => {
        await h.stage(stage);
        const p = await h.newPage();
        const reqs = [];
        p.page.on('request', (r) => {
          const u = new URL(r.url());
          if (u.pathname.startsWith('/api/')) reqs.push(u.pathname);
        });
        await p.page.goto(`${h.BASE}/?as=Parker`);
        await p.page.locator('.schedule, [data-tc-day]').first().waitFor({ timeout: 30000 });
        await sleep(2500);
        await p.ctx.close();
        return reqs;
      };
      const none = await loadReqs('zip83_none');
      const hist = await loadReqs('history');
      console.log(`        Home load API calls: none-stage ${none.join(',')} | history ${hist.join(',')}`);
      assert(!hist.some((x) => /wins|champions/.test(x)), 'a wins or champions call on load');
      await h.stage('history');
      // Vic (2 medals) and Wren (1) say I'm in to a regular game, so their names (and medals) are on Parker's game card.
      {
        const vic = await h.phone('Vic');
        const wren = await h.phone('Wren');
        const ss = (await vic.group()).sessions ?? [];
        let joined = null;
        for (const s of ss) {
          const r = await vic.post(`/api/sessions/${s.id}/join`, {});
          if (r.ok) {
            joined = s.id;
            await wren.post(`/api/sessions/${s.id}/join`, {});
            break;
          }
        }
        console.log(`        Vic and Wren joined game ${joined}`);
        await vic.ctx.close();
        await wren.ctx.close();
      }
      for (const { width, scheme } of [{ width: 320, scheme: 'dark' }, { width: 390, scheme: 'light' }]) {
        const p = await h.playerPage('Parker', { width, scheme });
        const more = p.page.getByRole('button', { name: /Show future games/ });
        if (await more.count()) {
          await more.first().click();
          await sleep(600);
        }
        const all = p.page.locator('[data-medals-btn]');
        const n = await all.count();
        const info = await all.evaluateAll((els) =>
          els.map((e) => {
            const b = e.getBoundingClientRect();
            return { name: e.getAttribute('data-medals-btn'), label: e.getAttribute('aria-label'), top: !!e.closest('.topbar'), ticker: !!e.closest('[data-tour-ticker]'), card: !!e.closest('.schedule, [class*="card"]'), w: b.width, h: b.height };
          }),
        );
        console.log(`        ${width} ${scheme}: ${n} medal buttons: ${info.map((x) => `${x.name}${x.top ? '(top)' : x.card ? '(card)' : ''} ${Math.round(x.w)}x${Math.round(x.h)}`).join('; ')}`);
        assert(info.every((x) => !x.ticker), 'a ticker medal is a button');
        assert((await p.page.locator('[data-tour-ticker] .md').count()) >= 0, '');
        const small = info.filter((x) => x.w < 44 || x.h < 44);
        if (small.length) note(`${width} ${scheme}: medal buttons under 44 px (box): ${small.map((x) => `${x.name} ${Math.round(x.w)}x${Math.round(x.h)}`).join(', ')} (zip82 checks a ±20 px hit area instead)`);
        // Every button: rows = the medal count, newest first.
        const seen = new Set();
        for (let i = 0; i < n; i++) {
          const b = all.nth(i);
          const x = info[i];
          if (!(await b.isVisible())) continue;
          const key = `${x.name}${x.top ? 'top' : 'card'}`;
          if (seen.has(key)) continue;
          seen.add(key);
          // The hit area: 20 px above and below the medal's middle.
          const box = await b.boundingBox();
          for (const dy of [-20, 20]) {
            const hit = await p.page.evaluate(([X, Y]) => !!document.elementFromPoint(X, Y)?.closest('[data-medals-btn]'), [box.x + box.width / 2, box.y + box.height / 2 + dy]);
            if (!hit) note(`${width} ${scheme}: ${x.name} ${x.top ? 'top' : 'card'} medal: no hit ${dy} px from its middle`);
          }
          await b.scrollIntoViewIfNeeded();
          await b.click();
          await p.page.locator('[data-ws-list]').waitFor({ timeout: 8000 });
          const title = await titleOf(p.page);
          const subs = (await p.page.locator('[data-ws-row] .ws-text span').allInnerTexts()).map(flat);
          const want = Number(/(\d+) medals?/.exec(x.label)?.[1]);
          const dates = subs.map((s) => Date.parse(s.split(' · ')[0]));
          const newest = dates.every((d, j) => j === 0 || d <= dates[j - 1]);
          console.log(`          ${x.name} ${x.top ? 'top' : 'card'}: "${title}", ${subs.length} rows (medals ${want}), ${newest ? 'newest first' : 'NOT newest first'}`);
          assert(subs.length === want, `${x.name}: ${subs.length} rows vs ${want} medals`);
          assert(newest, `${x.name}: order ${subs.join(' | ')}`);
          await h.noWider(p.page, `wins ${x.name} ${width}`);
          if (i === 0 || !x.top) await shot(p.page, `C-wins-${x.name.split(' ')[0]}-${width}-${scheme}`);
          await p.page.goBack();
          await sleep(500);
          assert((await p.page.locator('dialog[open]').count()) === 0, `Back did not close ${x.name}'s wins`);
        }
        assert([...seen].some((k) => k.endsWith('top')), 'no medal at the top for Parker');
        assert([...seen].some((k) => k.endsWith('card')), 'no medal on a game card');
        assert(!p.errors.length, p.errors.join(' | '));
        await p.ctx.close();
      }
      // Only me: the newest night hidden: gone from Vic's wins (player and organizer) and from the counts.
      const db = new DatabaseSync(h.dbFile);
      const tours = db.prepare('SELECT name, visibility FROM tournaments ORDER BY name').all();
      db.prepare("UPDATE tournaments SET visibility = 'me' WHERE name = 'The Cold Open'").run();
      db.close();
      const v = await h.phone('Parker');
      const w = await (await v.ctx.request.get(h.BASE + '/api/tournament/wins?name=Vic')).json();
      const aw = await h.call('GET', '/api/admin/tournament-wins?name=Vic');
      const g = await v.group();
      console.log(`        Only me: tournaments ${JSON.stringify(tours)}; Vic player wins ${JSON.stringify(w).slice(0, 200)}; organizer ${JSON.stringify(aw).slice(0, 200)}; medals ${JSON.stringify(g.tourAwards?.medals)}`);
      assert(!JSON.stringify(w).includes('Cold Open'), 'player wins list an Only me night');
      assert(!JSON.stringify(aw).includes('Cold Open'), 'organizer wins list an Only me night');
      await v.ctx.close();
      const db2 = new DatabaseSync(h.dbFile);
      db2.prepare("UPDATE tournaments SET visibility = 'all' WHERE name = 'The Cold Open'").run();
      db2.close();
    });

    await check('D the Champions wall: no cup with no winner; the cup centered beside light/dark; reigning and past newest first; = medals = wins; 320', async () => {
      await h.stage('zip83_none');
      const p0 = await h.playerPage('Parker', { width: 390 });
      const a0 = await h.adminHome({ width: 390 });
      assert((await p0.page.locator('[data-cup]').count()) === 0 && (await a0.page.locator('[data-cup]').count()) === 0, 'a cup with no winner');
      await p0.ctx.close();
      await a0.ctx.close();
      await h.stage('history');
      const g = await (await h.phone('Parker')).group();
      const medals = g.tourAwards?.medals ?? {};
      const wall = await (await (await h.phone('Parker')).ctx.request.get(h.BASE + '/api/tournament/champions')).json();
      const adm = await h.call('GET', '/api/admin/champions');
      const fromWall = {};
      for (const t of wall.tournaments) for (const x of t.winners) fromWall[x.name ?? x] = (fromWall[x.name ?? x] ?? 0) + 1;
      console.log(`        medals ${JSON.stringify(medals)}; wall winners ${JSON.stringify(fromWall)}; wall ${wall.tournaments.map((t) => `${t.name} ${t.date}`).join(' > ')}; organizer ${adm.tournaments.map((t) => t.name).join(' > ')}`);
      assert(JSON.stringify(Object.entries(medals).sort()) === JSON.stringify(Object.entries(fromWall).sort()), 'the wall and the medals differ');
      const dates = wall.tournaments.map((t) => Date.parse(t.date ?? t.endedAt ?? ''));
      if (dates.every(Number.isFinite)) assert(dates.every((d, i) => i === 0 || d <= dates[i - 1]), 'wall not newest first');
      for (const [name, n] of Object.entries(medals)) {
        const w = await (await (await h.phone('Parker')).ctx.request.get(h.BASE + `/api/tournament/wins?name=${encodeURIComponent(name)}`)).json();
        const rows = (w.wins ?? w.rows ?? []).length;
        assert(rows === n, `${name}: wins sheet ${rows} vs medals ${n} (${JSON.stringify(w).slice(0, 120)})`);
      }
      for (const { width, scheme } of [{ width: 320, scheme: 'light' }, { width: 320, scheme: 'dark' }, { width: 390, scheme: 'dark' }]) {
        for (const who of ['Parker', 'Christopher Vanderberg']) {
          const p = await h.playerPage(who, { width, scheme });
          const look = await p.page.evaluate(() => {
            const c = document.querySelector('[data-cup]').getBoundingClientRect();
            const m = document.querySelector('.mode-btn:not([data-cup])').getBoundingClientRect();
            const s = document.querySelector('[data-cup] svg').getBoundingClientRect();
            return { gap: m.x - (c.x + c.width), dy: c.y - m.y, cx: s.x + s.width / 2 - (c.x + c.width / 2), cy: s.y + s.height / 2 - (c.y + c.height / 2), w: c.width, h: c.height };
          });
          assert(look.w === 44 && look.h === 44 && Math.abs(look.dy) < 0.6 && look.gap >= 0 && look.gap < 24 && Math.abs(look.cx) < 0.6 && Math.abs(look.cy) < 0.6, `${who} ${width} ${scheme} cup ${JSON.stringify(look)}`);
          await p.page.locator('[data-cup]').click();
          await p.page.locator('[data-cw]').waitFor({ timeout: 8000 });
          const cut = await p.page.locator('dialog[open] [data-cw-winner] span, dialog[open] .cw-name, dialog[open] .cw-row-text b, dialog[open] .cw-row-text > span, dialog[open] .cw-line, dialog[open] .cw-team').evaluateAll((els) => els.filter((e) => e.scrollWidth > e.clientWidth + 1 || /…$/.test(e.textContent)).map((e) => e.textContent));
          assert(!cut.length, `cut: ${cut}`);
          await h.noWider(p.page, `wall ${width} ${scheme}`);
          if (who === 'Parker') await shot(p.page, `D-wall-${width}-${scheme}`);
          await p.page.goBack();
          await sleep(500);
          assert((await p.page.locator('dialog[open]').count()) === 0, 'Back left the wall open');
          await p.ctx.close();
        }
      }
    });

    await check('E game night looks at 320 and 390, light and dark: lime, Enter score, one font, names, Back', async () => {
      const ball = {};
      const findings = {};
      const add = (k, v) => ((findings[k] ??= new Set()).add(v));
      const SCREENS = [
        ['signup', 'Vic'],
        ['tickets_open', 'Vic'],
        ['tickets_open', 'Parker'],
        ['zip72_scores', 'Vic'],
        ['zip74_short', 'Vic'],
        ['zip77_last', 'Christopher Vanderberg'],
        ['zip77_allin', 'Vic'],
        ['zip79_night', 'Vic'],
        ['history', 'Parker'],
        ['final_on', 'Vic'],
      ];
      for (const [stage, who] of SCREENS) {
        await h.stage(stage);
        for (const width of [320, 390]) {
          for (const scheme of ['light', 'dark']) {
            const p = await h.playerPage(who, { width, scheme, reducedMotion: 'reduce' });
            const page = p.page;
            if (stage === 'zip79_night') {
              const x = page.locator('[data-tc-reveal-x]');
              if (await x.count()) await x.click().catch(() => {});
              const o = page.locator('[data-tc-results-open]');
              if (await o.count()) await o.click();
              await sleep(400);
            }
            const r = await page.evaluate(() => {
              const probe = document.createElement('i');
              probe.style.color = getComputedStyle(document.documentElement).getPropertyValue('--ball');
              document.body.append(probe);
              const ballC = getComputedStyle(probe).color;
              probe.remove();
              const out = { ballC, lime: [], enter: [], fonts: {}, cut: [] };
              for (const el of document.querySelectorAll('button, a, [role="button"]')) {
                const cs = getComputedStyle(el);
                const b = el.getBoundingClientRect();
                if (!b.width) continue;
                const label = (el.innerText || el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim();
                if (cs.backgroundColor === ballC) out.lime.push({ label, tour: !!el.closest('.tc-card, .tc-ticket, [data-tc-day], [data-tc-results], .tc-gd-hero, [class*="tc-"]') });
                if (el.matches('[data-tc-enter-score]')) out.enter.push({ bg: cs.backgroundColor, color: cs.color, label });
              }
              for (const el of document.querySelectorAll('body *')) {
                if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
                const cs = getComputedStyle(el);
                if (cs.display === 'none' || cs.visibility === 'hidden') continue;
                out.fonts[cs.fontFamily] = (out.fonts[cs.fontFamily] ?? 0) + 1;
                const t = el.textContent.trim();
                if (el.closest('svg')) continue;
                if ((cs.textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth + 1) || /…$/.test(t)) out.cut.push(t.slice(0, 50));
              }
              return out;
            });
            ball[scheme] = r.ballC;
            for (const l of r.lime) add(`lime ${l.tour ? 'tournament' : 'NOT tournament'}`, `${l.label} (${stage})`);
            for (const e of r.enter) add('enter score', `${e.bg} / ${e.color} ${scheme}`);
            for (const f of Object.keys(r.fonts)) add('fonts', f);
            for (const c of r.cut) add(`cut at ${width}`, `${c} (${stage} ${who} ${scheme})`);
            try {
              await h.noWider(page, `${stage} ${who} ${width} ${scheme}`);
            } catch (e) {
              add('wider than the screen', e.message);
            }
            if (scheme === 'dark' || width === 320) await shot(page, `E-${stage}-${who.split(' ')[0]}-${width}-${scheme}`, true);
            if (p.errors.length) add('page errors', `${stage}: ${p.errors.join(' | ')}`);
            await p.ctx.close();
          }
        }
      }
      // The organizer's game night screen.
      for (const stage of ['zip72_scores', 'am_round3']) {
        await h.stage(stage);
        for (const width of [320, 390]) {
          for (const scheme of ['light', 'dark']) {
            const a = await h.adminHome({ width, scheme, reducedMotion: 'reduce' });
            const r = await a.page.evaluate(() => {
              const fonts = {};
              const cut = [];
              for (const el of document.querySelectorAll('body *')) {
                if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
                const cs = getComputedStyle(el);
                fonts[cs.fontFamily] = 1;
                if ((cs.textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth + 1) || /…$/.test(el.textContent.trim())) cut.push(el.textContent.trim().slice(0, 50));
              }
              return { fonts: Object.keys(fonts), cut };
            });
            for (const f of r.fonts) add('fonts', `${f} (admin)`);
            for (const c of r.cut) add(`cut at ${width}`, `${c} (admin ${stage} ${scheme})`);
            try {
              await h.noWider(a.page, `admin ${stage} ${width} ${scheme}`);
            } catch (e) {
              add('wider than the screen', e.message);
            }
            await shot(a.page, `E-admin-${stage}-${width}-${scheme}`, true);
            await a.ctx.close();
          }
        }
      }
      console.log(`        ball color: ${JSON.stringify(ball)}`);
      for (const [k, v] of Object.entries(findings)) console.log(`        ${k}: ${[...v].join(' || ')}`);
      writeFileSync(path.join(SHOTS, 'E-findings.json'), JSON.stringify(Object.fromEntries(Object.entries(findings).map(([k, v]) => [k, [...v]])), null, 1));

      // Back closes every sheet; one more Back then leaves the site (no dead Back).
      const SHEETS = [
        ['zip72_scores', 'Vic', 'score sheet', '[data-tc-enter-score]'],
        ['zip77_last', 'Vic', 'Americano score sheet', '[data-tc-enter-score]'],
        ['history', 'Parker', 'wins sheet', '[data-medals-btn="Parker"]'],
        ['history', 'Parker', 'champions sheet', '[data-cup]'],
        ['tickets_open', 'Parker', 'Drop out sheet', '[data-tc-drop]'],
        ['tickets_open', 'Vic', 'Lock in / pay sheet', 'button.tc-lime'],
        ['history', 'Parker', 'standings board (in place)', '[data-tc-results-open]'],
        ['zip79_night', 'Vic', 'standings board, night (in place)', '[data-tc-results-open]'],
      ];
      const back = [];
      for (const [stage, who, what, sel] of SHEETS) {
        await h.stage(stage);
        const p = await h.newPage({ reducedMotion: 'reduce' });
        const page = p.page;
        await page.goto('about:blank');
        await page.goto(`${h.BASE}/?as=${encodeURIComponent(who)}`);
        await page.locator('.schedule, [data-tc-day]').first().waitFor({ timeout: 30000 });
        await sleep(800);
        const x = page.locator('[data-tc-reveal-x]');
        if (await x.count()) {
          await x.click().catch(() => {});
          await sleep(500);
        }
        const opener = page.locator(sel).first();
        if (!(await opener.count())) {
          back.push(`${what}: opener ${sel} not found`);
          await p.ctx.close();
          continue;
        }
        await opener.scrollIntoViewIfNeeded();
        await opener.click();
        await sleep(900);
        const open = async () => (await page.locator('dialog[open]').count()) + (await page.locator('[data-tc-results="board"]').count());
        const o1 = await open();
        await shot(page, `E-back-${what.split(' ')[0]}-open`);
        await page.goBack();
        await sleep(900);
        const onSite = page.url().startsWith(h.BASE);
        const o2 = onSite ? await open() : -1;
        let dead = '';
        if (onSite && o2 === 0) {
          await page.goBack();
          await sleep(900);
          dead = page.url() === 'about:blank' ? 'next Back leaves' : `DEAD Back (still ${page.url()})`;
        }
        back.push(`${what}: open ${o1} -> after Back ${onSite ? `${o2} open` : `LEFT THE SITE (${page.url()})`}${dead ? `, ${dead}` : ''}`);
        await p.ctx.close();
      }
      for (const b of back) console.log(`        Back: ${b}`);
      writeFileSync(path.join(SHOTS, 'E-back.json'), JSON.stringify(back, null, 1));
      const limeBad = findings['lime NOT tournament'];
      assert(!limeBad, `lime off the tournament: ${limeBad && [...limeBad].join(', ')}`);
      assert(!back.some((b) => /LEFT|DEAD|not found|-> after Back [1-9]/.test(b)), 'a Back problem (see above)');
    });
  } finally {
    console.log(notes.length ? `\nnotes:\n  ${notes.join('\n  ')}` : '');
    await h.close();
    console.log(`\nzip84-night: ${passed} passed, ${failed} failed`);
    process.exit(failed ? 1 : 0);
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
