/* Names on the cards: every signed-up name on its own line, never "+2".
 *
 *   node e2e/names.cjs      (also run by npm run test:e2e)
 *
 * Starts its own dev server with a fresh fake group: a very long first name,
 * two players called Ryan, a game of 6 with the organizer in it, a waitlist
 * (the max is set to 4 for that), a court-standby game, and a game with
 * nobody in. Then, at 360,
 * 375, 390 and 430px in light and dark, on a player's screen and the
 * organizer's, checks that every name shows in full, long names wrap, the
 * two Ryans are told apart, waitlist and standby lines show only when
 * needed, empty games add no empty line, and nothing overlaps or is cut off.
 */
const { spawn } = require('node:child_process');
const { rmSync, mkdirSync } = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.E2E_PORT) || 5196;
const BASE = `http://localhost:${PORT}`;
const SETUP_TOKEN = 'names-setup-token-0123456789';
const PIN = '482913';
const LONG = 'Bartholomew-Maximiliano';
const PEOPLE = ['Alex', LONG, 'Ryan S.', 'Ryan T.', 'Casey', 'Devon', 'Emery', 'Frankie', 'Gus', 'Hal'];
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

let passed = 0;
let failed = 0;
async function check(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.log(`  ✗ ${name}\n      ${String(err && err.message ? err.message : err).replace(/\s*\n\s*/g, ' ⏎ ').slice(0, 500)}`);
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function main() {
  const dbFile = path.join(ROOT, '.data', 'names.sqlite');
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
  // Mon Oct 26, 2026, 12:00 PM Eastern.
  const now = Date.parse('2026-10-26T12:00:00-04:00');
  await fetch(`${BASE}/__dev/clock`, { method: 'POST', body: JSON.stringify({ atMs: now }) });

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
  const d = await call(api.request, 'GET', '/api/admin/dashboard');
  const id = Object.fromEntries(d.players.map((p) => [p.name, p.id]));
  const games = d.sessions.slice(0, 6);
  const add = async (s, names) => {
    for (const n of names) await call(api.request, 'POST', `/api/admin/sessions/${s.id}/roster`, { playerId: id[n], action: 'confirm' });
  };
  const [one, ryans, six, waitG, standbyG, empty] = games;
  await add(one, ['Casey']);
  await add(ryans, ['Ryan S.', 'Ryan T.', 'Casey', 'Devon']);
  await call(api.request, 'POST', `/api/admin/sessions/${six.id}/me`, { in: true }); // Alex, the organizer
  await add(six, [LONG, 'Ryan S.', 'Casey', 'Devon', 'Emery']);
  await add(waitG, ['Casey', 'Devon', 'Emery', 'Frankie']);
  // Below the max a 5th person is simply in, so the max goes to 4: Gus joins 5th and waits.
  await call(api.request, 'PUT', '/api/admin/group', { settings: { maxPlayers: 4 } });
  {
    const ctx = await browser.newContext();
    await call(ctx.request, 'POST', '/api/me', { playerId: id.Gus });
    await call(ctx.request, 'POST', `/api/sessions/${waitG.id}/join`, {});
    await ctx.close();
  }
  // A full game WITH a booked court keeps its "Waitlist: Gus" line for players. Games with no court booked read like normal
  // games to players (everyone who tapped I'm in is simply in), so only this one shows a waitlist.
  await call(api.request, 'POST', `/api/admin/sessions/${waitG.id}/booked`, {});
  await call(api.request, 'POST', `/api/admin/sessions/${standbyG.id}/court`, { action: 'waitlist' });
  for (const n of ['Hal', 'Frankie']) {
    const ctx = await browser.newContext();
    await call(ctx.request, 'POST', '/api/me', { playerId: id[n] });
    await call(ctx.request, 'POST', `/api/sessions/${standbyG.id}/join`, {});
    await ctx.close();
  }
  const fresh = await call(api.request, 'GET', '/api/admin/dashboard');
  const info = (s) => fresh.sessions.find((x) => x.id === s.id);
  const confirmedOf = (s) => info(s).roster.filter((r) => r.status === 'confirmed').map((r) => r.name);
  const waitingOf = (s) => info(s).roster.filter((r) => r.status === 'waitlisted').map((r) => r.name);
  const label = (n) => (n.startsWith('Ryan') ? n : n.split(' ')[0]);
  const expected = games.map((s) => ({ id: s.id, inNames: confirmedOf(s).map(label), waiting: waitingOf(s).map(label) }));
  assert(expected[2].inNames.length === 6 && expected[5].inNames.length === 0, `test data: ${JSON.stringify(expected.map((e) => e.inNames.length))}`);

  /** Layout facts for one card, measured in the page. */
  const measure = (card) =>
    card.evaluate((el) => {
      const box = el.getBoundingClientRect();
      const txt = (s) => [...el.querySelectorAll(s)].map((x) => x.textContent.trim());
      // Text cut short inside its own box, or anything sticking out past the card's edge.
      // (Invisible enlarged tap areas are pseudo-elements and don't count.)
      const cut = [
        ...[...el.querySelectorAll('.names-line, .waitlist-line, .players-count, .in-count')].filter((x) => x.scrollWidth > x.clientWidth + 1),
        ...[...el.querySelectorAll('.players-top *, .in-line *, .names-line, .waitlist-line')].filter((x) => {
          const b = x.getBoundingClientRect();
          return b.width > 0 && (b.right > box.right + 1 || b.left < box.left - 1);
        }),
      ].map((x) => x.className || x.tagName);
      const r = (s) => {
        const e = el.querySelector(s);
        return e ? e.getBoundingClientRect().toJSON() : null;
      };
      const empties = [...el.querySelectorAll('p, .names-line, .waitlist-line')].filter((x) => !x.textContent.trim()).length;
      return {
        names: txt('.names-line'),
        bold: txt('.names-line strong'),
        waits: txt('.waitlist-line'),
        plus: /\+\d/.test([...el.querySelectorAll('.names-line, .waitlist-line, .players-line, .in-line')].map((x) => x.textContent).join(' ')),
        cut,
        empties,
        after: r('.players-after'),
        dots: r('.dots'),
        count: r('.players-count'),
        namesBox: r('.names-line'),
        lineHeight: el.querySelector('.names-line') ? parseFloat(getComputedStyle(el.querySelector('.names-line')).lineHeight) : 0,
      };
    });
  const overlaps = (a, b) => a && b && a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;

  for (const width of [360, 375, 390, 430]) {
    for (const scheme of ['light', 'dark']) {
      const opts = { viewport: { width, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: scheme, reducedMotion: 'reduce', userAgent: IPHONE_UA };
      // Player: Ryan S.
      const pctx = await browser.newContext(opts);
      await pctx.clock.setFixedTime(now);
      await call(pctx.request, 'POST', '/api/me', { playerId: id['Ryan S.'] });
      const page = await pctx.newPage();
      await page.goto(BASE + '/');
      await page.locator('.schedule article').first().waitFor();
      const more = page.getByRole('button', { name: /^More sessions/ });
      if (await more.count()) await more.click();
      await check(`player cards at ${width}px (${scheme}): every name in full, no "+N", Ryans told apart, my name bold, waitlist/standby only when needed, no empty lines`, async () => {
        for (const [i, e] of expected.entries()) {
          const m = await measure(page.locator(`#row-${e.id}`));
          // The court-standby game (no court booked) reads like a normal one for players: everyone who tapped I'm in is simply in.
          const shown = i === 4 ? [...e.inNames, ...e.waiting] : e.inNames;
          assert(!m.plus, `game ${i + 1}: "+N" shown`);
          assert(m.cut.length === 0, `game ${i + 1}: cut off: ${m.cut}`);
          assert(m.empties === 0, `game ${i + 1}: an empty line`);
          if (shown.length === 0) assert(m.names.length === 0, `game ${i + 1}: names line on an empty game`);
          else assert(m.names.length === 1 && m.names[0] === shown.join(', '), `game ${i + 1}: names "${m.names}" want "${shown.join(', ')}"`);
          if (shown.includes('Ryan S.')) assert(m.bold.includes('Ryan S.'), `game ${i + 1}: my name not bold`);
          const wantWait = i !== 4 && e.waiting.length ? `Waitlist: ${e.waiting.join(', ')}` : null;
          if (wantWait) assert(m.waits.length === 1 && m.waits[0].startsWith(wantWait), `game ${i + 1}: wait line "${m.waits}" want "${wantWait}"`);
          else assert(m.waits.length === 0, `game ${i + 1}: wait line shown with nobody waiting`);
        }
        const six = await measure(page.locator(`#row-${expected[2].id}`));
        assert(six.names[0].includes(LONG), 'the long first name shows in full');
      });
      await pctx.close();

      // Organizer.
      const octx = await browser.newContext(opts);
      await octx.clock.setFixedTime(now);
      await call(octx.request, 'POST', '/api/admin/login', { pin: PIN });
      const o = await octx.newPage();
      await o.goto(BASE + '/admin');
      await o.locator(`#session-${expected[0].id}`).waitFor();
      const showAll = o.getByRole('button', { name: /^Show all/ });
      if (await showAll.count()) await showAll.click();
      if (process.env.NAMES_SHOTS) await o.locator(`#session-${expected[2].id}`).screenshot({ path: `${process.env.NAMES_SHOTS}/org-six-${width}-${scheme}.png` });
      await check(`organizer cards at ${width}px (${scheme}): every name in full, no "+N", waitlist/standby only when needed, "You're in"/"Out" never covers the dots or names, nothing cut off`, async () => {
        for (const [i, e] of expected.entries()) {
          const card = o.locator(`#session-${e.id}`);
          const m = await measure(card);
          assert(!m.plus, `game ${i + 1}: "+N" shown`);
          assert(m.cut.length === 0, `game ${i + 1}: cut off: ${m.cut}`);
          assert(m.empties === 0, `game ${i + 1}: an empty line`);
          if (e.inNames.length === 0) assert(m.names.length === 0, `game ${i + 1}: names line on an empty game`);
          else assert(m.names.length === 1 && m.names[0] === e.inNames.join(', '), `game ${i + 1}: names "${m.names}" want "${e.inNames.join(', ')}"`);
          const wantWait = e.waiting.length ? `${i === 4 ? 'Standby' : 'Waitlist'}: ${e.waiting.join(', ')}` : null;
          if (wantWait) assert(m.waits.length === 1 && m.waits[0] === wantWait, `game ${i + 1}: wait line "${m.waits}" want "${wantWait}"`);
          else assert(m.waits.length === 0, `game ${i + 1}: wait line shown with nobody waiting`);
          if (m.after) {
            assert(!overlaps(m.after, m.dots) && !overlaps(m.after, m.count) && !overlaps(m.after, m.namesBox), `game ${i + 1}: "You're in" overlaps`);
            assert(Math.abs(m.after.right - (await card.locator('.players-top').evaluate((x) => x.getBoundingClientRect().right))) < 2, `game ${i + 1}: "You're in" not at the right`);
          }
        }
        const six = await measure(o.locator(`#session-${expected[2].id}`));
        assert(six.after, 'my own "You\'re in" shows on the game I\'m in');
        assert(six.names[0].includes(LONG), 'the long first name shows in full');
      });
      await check(`View as demo at ${width}px (${scheme}): the player's cards show every name the same way`, async () => {
        await o.getByRole('button', { name: 'View as…' }).click();
        await o.locator('dialog[open]').getByRole('button', { name: 'Ryan S.', exact: true }).click();
        await o.locator('.demo-bars .pretend-bar').waitFor();
        await o.locator(`#row-${expected[0].id}`).waitFor();
        const moreRows = o.getByRole('button', { name: /^More sessions/ });
        if (await moreRows.count()) await moreRows.click();
        for (const [i, e] of expected.entries()) {
          const m = await measure(o.locator(`#row-${e.id}`));
          assert(!m.plus && m.cut.length === 0 && m.empties === 0, `game ${i + 1}: "+N", cut off or empty line`);
          const shown = i === 4 ? [...e.inNames, ...e.waiting] : e.inNames; // the court-standby game reads like a normal one
          if (shown.length) assert(m.names[0] === shown.join(', '), `game ${i + 1}: names "${m.names}" want "${shown.join(', ')}"`);
          else assert(m.names.length === 0, `game ${i + 1}: names line on an empty game`);
        }
      });
      await octx.close();
    }
  }
  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
