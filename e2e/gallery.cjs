/* State gallery: a picture of every card, notice and screen state.
 *
 *   node e2e/gallery.cjs      (writes docs/state-gallery/)
 *
 * Starts its own dev server with a fresh fake group (made-up phone numbers)
 * and walks the clock through two weeks, Eastern time:
 *   Tue Oct 27, 9:00 AM   game day: the pay card, Pay then "I paid"
 *   Mon Nov 2, 8:00 PM    day-before card (one player has no number)
 *   Tue Nov 3, 7:00 AM    last call (just after the clock change on Nov 1)
 *   Tue Nov 3, 9:00 AM    after a late drop: nearly every card and screen
 *   Mon Nov 9, 8:00 PM    day-before card, every number saved
 * Pictures are 390px wide in light and dark, plus 360px for the busiest.
 * Nothing here touches the live site.
 */
const { spawn } = require('node:child_process');
const { rmSync, mkdirSync, writeFileSync } = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const PORT = 5197;
const BASE = `http://localhost:${PORT}`;
const SETUP_TOKEN = 'gallery-setup-token-0123456789';
const PIN = '482913';
const OUT = path.join(ROOT, 'docs', 'state-gallery');
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
// Nathan has no saved number, for the "Missing numbers" note.
const PEOPLE = [
  ['Alex', '2485550100'],
  ['Alec', '2485550101'],
  ['Armen', '2485550102'],
  ['Ryan', '2485550103'],
  ['Brandon', '2485550104'],
  ['Julian', '2485550105'],
  ['Mitchel', '2485550106'],
  ['Nathan', null],
];

/** Eastern wall-clock time as a timestamp ("2026-11-03 09:00" in EST or EDT, worked out). */
function eastern(local) {
  for (const off of ['-04:00', '-05:00']) {
    const ms = Date.parse(`${local.replace(' ', 'T')}:00${off}`);
    const back = new Date(ms).toLocaleString('sv-SE', { timeZone: 'America/Detroit' }).slice(0, 16);
    if (back === local) return ms;
  }
  throw new Error(`not a time: ${local}`);
}

const shots = []; // { section, name, title, file }

async function main() {
  const dbFile = path.join(ROOT, '.data', 'gallery.sqlite');
  mkdirSync(path.join(ROOT, '.data'), { recursive: true });
  rmSync(dbFile, { force: true });
  rmSync(OUT, { recursive: true, force: true });
  for (const d of ['player', 'organizer']) mkdirSync(path.join(OUT, d), { recursive: true });
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
  let now = 0;
  const setClock = async (local) => {
    now = eastern(local);
    await fetch(`${BASE}/__dev/clock`, { method: 'POST', body: JSON.stringify({ atMs: now }) });
  };

  const browser = await chromium.launch();
  const opts = (width, colorScheme) => ({
    viewport: { width, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    colorScheme,
    reducedMotion: 'reduce',
    userAgent: IPHONE_UA,
  });
  const call = async (req, method, url, data) => {
    const res = await req.fetch(BASE + url, { method, data, headers: { Origin: BASE } });
    if (!res.ok()) throw new Error(`${method} ${url}: ${res.status()} ${await res.text()}`);
    return res.json().catch(() => ({}));
  };

  // ---------- The group (Mon Oct 26, 12:00 PM) ----------
  await setClock('2026-10-26 12:00');
  const api = await browser.newContext();
  await call(api.request, 'POST', '/api/setup', {
    setupToken: SETUP_TOKEN,
    groupName: 'Pickleball Bros',
    pin: PIN,
    venmoUrl: 'https://venmo.com/u/organizer',
    players: PEOPLE.map(([name, phone]) => ({ name, phone })),
  });
  await call(api.request, 'PUT', '/api/admin/group', { organizerName: 'Alex' });
  const dash = () => call(api.request, 'GET', '/api/admin/dashboard');
  let d = await dash();
  const id = Object.fromEntries(d.players.map((p) => [p.name, p.id]));
  const at = (local) => d.sessions.find((s) => s.startsAt === new Date(eastern(local)).toISOString());
  const A = at('2026-10-27 20:00'); // played with 6
  const B = at('2026-10-29 20:00'); // canceled after two paid
  const C = at('2026-11-03 20:00'); // Election Day: the game day
  const D = at('2026-11-05 20:00'); // court waitlist, standby
  const E = at('2026-11-10 20:00'); // 6 then 5: "5 going"
  const F = at('2026-11-12 20:00'); // 6 playing: discount
  const G = at('2026-11-17 20:00'); // moved to Wed Nov 18, 7:00 PM
  const H = at('2026-11-24 20:00'); // canceled ahead of time
  const phones = {};
  const phone = async (name) => {
    if (!phones[name]) {
      phones[name] = await browser.newContext();
      await call(phones[name].request, 'POST', '/api/me', { playerId: id[name] });
    }
    return phones[name].request;
  };
  const join = async (s, names) => {
    for (const n of names) await call(await phone(n), 'POST', `/api/sessions/${s.id}/join`, {});
  };
  const paid = (s, name) => call(api.request, 'POST', `/api/admin/sessions/${s.id}/payment`, { playerId: id[name], paid: true });
  for (const s of [A, B, C, E, F]) await call(api.request, 'POST', `/api/admin/sessions/${s.id}/booked`, {});
  await join(A, ['Alex', 'Alec', 'Armen', 'Ryan', 'Brandon', 'Julian']);
  for (const n of ['Alex', 'Alec', 'Armen', 'Brandon']) await paid(A, n);
  await join(B, ['Mitchel', 'Nathan', 'Alec', 'Armen']);
  await paid(B, 'Mitchel');
  await paid(B, 'Nathan');
  await join(C, ['Ryan', 'Alex', 'Mitchel', 'Nathan', 'Brandon']); // Brandon waits as #1
  await call(api.request, 'POST', `/api/admin/sessions/${D.id}/court`, { action: 'waitlist' });
  await join(D, ['Julian', 'Alec']);
  await join(E, ['Alex', 'Alec', 'Ryan', 'Brandon', 'Julian', 'Mitchel']);
  await join(F, ['Alec', 'Alex', 'Mitchel', 'Brandon', 'Nathan', 'Ryan']);
  const extra = await call(api.request, 'POST', '/api/admin/sessions', {
    startsAt: new Date(eastern('2026-11-14 10:00')).toISOString(),
    endsAt: new Date(eastern('2026-11-14 12:00')).toISOString(),
    note: 'Saturday morning',
  });
  await join({ id: extra.id }, ['Ryan']);
  await call(api.request, 'PUT', `/api/admin/sessions/${G.id}/time`, {
    startsAt: new Date(eastern('2026-11-18 19:00')).toISOString(),
    endsAt: new Date(eastern('2026-11-18 21:00')).toISOString(),
  });
  await join(G, ['Ryan']);
  await join(H, ['Ryan']);
  await call(api.request, 'POST', `/api/admin/sessions/${H.id}/decision`, { decision: 'cancel', confirm: true });

  // ---------- Pictures ----------
  /** One phone (organizer or a player) at a width and color scheme, on the current clock. */
  const open = async (who, width, scheme) => {
    const ctx = await browser.newContext(opts(width, scheme));
    await ctx.clock.setFixedTime(now);
    if (who === 'organizer') await call(ctx.request, 'POST', '/api/admin/login', { pin: PIN });
    else if (who) await call(ctx.request, 'POST', '/api/me', { playerId: id[who] });
    await ctx.route('https://venmo.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<p>Venmo</p>' }));
    // Close-ups and whole-page pictures leave out the floating tab bar, which would sit on top.
    await ctx.addInitScript(() => {
      document.addEventListener('DOMContentLoaded', () => {
        const st = document.createElement('style');
        st.textContent = '.shot-notab .tabbar { visibility: hidden !important; }';
        document.head.appendChild(st);
      });
    });
    const page = await ctx.newPage();
    page.setDefaultTimeout(10000);
    await page.goto(`${BASE}${who === 'organizer' ? '/admin' : '/'}`);
    await page.waitForLoadState('networkidle');
    return { ctx, page };
  };
  const snap = async (target, section, name, title, { width, scheme, full = false } = {}) => {
    const file = `${section}/${name}-${width}-${scheme}.jpg`;
    const page = target.page ? target.page() : target;
    await page.waitForTimeout(120);
    const o = { path: path.join(OUT, file), type: 'jpeg', quality: 78 };
    const notab = !!target.page || full;
    if (notab) await page.evaluate(() => document.documentElement.classList.add('shot-notab'));
    if (target.page) await target.screenshot(o);
    else await page.screenshot({ ...o, fullPage: full });
    if (notab) await page.evaluate(() => document.documentElement.classList.remove('shot-notab'));
    shots.push({ section, name, title, file, width, scheme });
  };
  const tab = (page, n) => page.getByRole('navigation', { name: 'Organizer sections' }).getByRole('button', { name: new RegExp(`^${n}`) });
  const row = (page, s) => page.locator(`#row-${s.id ?? s}`);
  const card = (page, s) => page.locator(`#session-${s.id ?? s}`);
  const themes = (widths = [390]) => widths.flatMap((width) => ['light', 'dark'].map((scheme) => ({ width, scheme })));

  // 1. Tue Oct 27, 9:00 AM: game day for A.
  await setClock('2026-10-27 09:00');
  for (const t of themes()) {
    const anon = await open(null, t.width, t.scheme);
    await anon.page.locator('.name-grid').waitFor();
    await snap(anon.page, 'player', '01-who-are-you', '"Who are you?" (not signed in yet), with the organizer sign-in link', t);
    await anon.ctx.close();
    const { ctx, page } = await open('Ryan', t.width, t.scheme);
    const payCard = page.getByRole('region', { name: 'Payment' }).or(page.locator('section[aria-label="Payment"]')).first();
    await payCard.waitFor();
    await snap(page, 'player', '02-game-day-pay-card', 'Game day from 8:00 AM: "Tonight: you owe $14", unpaid', t);
    await payCard.getByRole('link', { name: /^Pay \$14 with Venmo$/ }).click();
    await payCard.getByRole('button', { name: 'I paid' }).waitFor();
    await snap(payCard, 'player', '03-pay-then-i-paid', 'After tapping Pay: "I paid" appears next to it', t);
    await ctx.close();
  }
  await paid(A, 'Ryan');

  // 2. Mon Nov 2, 8:00 PM: day-before card for C (Nathan has no number).
  await setClock('2026-11-02 20:00');
  for (const t of themes()) {
    const { ctx, page } = await open('organizer', t.width, t.scheme);
    const db = page.locator('main article.card[aria-label]:not([aria-label^="Last call"])').filter({ has: page.getByRole('button', { name: 'Done', exact: true }) }).first();
    await db.waitFor();
    await snap(db, 'organizer', '01-day-before-missing-number', 'Day-before card (24 hours before), with "Missing numbers" for Nathan', t);
    await ctx.close();
  }

  // 3. Tue Nov 3, 7:00 AM: last call.
  await setClock('2026-11-03 07:00');
  for (const t of themes()) {
    const { ctx, page } = await open('organizer', t.width, t.scheme);
    const lc = page.locator('article[aria-label^="Last call"]').first();
    await lc.waitFor();
    await snap(lc, 'organizer', '02-last-call', 'Last-call card (13 hours before)', t);
    await page.evaluate(() => window.scrollTo(0, 0));
    await snap(page, 'organizer', '03-home-7am', 'Home at 7:00 AM on game day (top of the page)', t);
    await ctx.close();
  }

  // 4. Tue Nov 3, 9:00 AM: Mitchel drops after the 8:00 AM deadline (a late drop); Brandon moves in.
  await setClock('2026-11-03 09:00');
  await call(await phone('Mitchel'), 'POST', `/api/sessions/${C.id}/withdraw`, {});
  await call(await phone('Julian'), 'POST', `/api/sessions/${E.id}/withdraw`, {}); // E: 6 down to 5
  await call(api.request, 'POST', `/api/admin/sessions/${B.id}/decision`, { decision: 'cancel', confirm: true });
  await call(api.request, 'POST', `/api/admin/sessions/${B.id}/refund`, { playerId: id.Mitchel, refunded: true });

  for (const t of themes([390, 360])) {
    const busy = t.width === 360;
    const { ctx, page } = await open('organizer', t.width, t.scheme);
    await card(page, C).waitFor();
    await snap(page, 'organizer', '04-home-full', 'Home, the whole page: Needs attention, then every game', { ...t, full: true });
    if (!busy) {
      for (const a of await page.locator('main article.card[aria-label]').all()) {
        const label = (await a.getAttribute('aria-label')).replace(/[^A-Za-z0-9]+/g, '-').replace(/-+$/, '').toLowerCase();
        await snap(a, 'organizer', `05-attention-${label}`, `Needs attention: "${await a.getAttribute('aria-label')}"`, t);
      }
      const strips = [
        [C, '06-card-booked-holiday', 'Court booked, with "Cancel by", the Election Day pill and my own "You\'re in"'],
        [D, '07-card-court-waitlist', 'On the court waitlist: Court opened / Didn\'t open'],
        [E, '08-card-five-going', '5 going after a drop from 6'],
        [F, '09-card-six', '6 playing'],
        [extra.id, '10-card-extra-game', 'Extra game (one-off), court not booked yet'],
        [G, '11-card-moved', 'Moved to Wed Nov 18, 7:00 PM'],
        [H, '12-card-canceled', 'Canceled'],
      ];
      const showAll = page.getByRole('button', { name: /^Show all/ });
      if (await showAll.count()) await showAll.click();
      for (const [s, name, title] of strips) await snap(card(page, s), 'organizer', name, title, t);
      const later = page.locator('section[aria-labelledby="sessions-title"] article[data-court="later"]').first();
      if (await later.count()) await snap(later, 'organizer', '13-card-booking-opens', 'Further out: "Booking opens [date]" in quiet gray', t);
      // Gear panel and its Text choices.
      const c = card(page, C);
      await c.getByRole('button', { name: /^Session options/ }).click();
      await c.locator('.options').waitFor();
      await snap(c, 'organizer', '14-gear-panel', 'Gear panel on a booked game', t);
      await c.getByRole('button', { name: 'Text', exact: true }).click();
      await page.waitForTimeout(200);
      await snap(c, 'organizer', '15-text-menu', 'Text: the message choices (Day before shows "Missing numbers")', t);
      await page.keyboard.press('Escape');
      await page.goto(`${BASE}/admin`);
      await card(page, C).waitFor();
      await card(page, C).getByRole('button', { name: /^Session options/ }).click();
      await card(page, C).locator('.options').getByRole('button', { name: 'Edit booking' }).click();
      await page.locator('dialog[open]').waitFor();
      await snap(page, 'organizer', '16-edit-booking', 'Edit booking sheet', t);
      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: '+ Add game' }).click();
      await page.locator('dialog[open]').waitFor();
      await snap(page, 'organizer', '17-add-game', 'Add game sheet', t);
      await page.keyboard.press('Escape');
      await tab(page, 'Money').click();
      await page.locator('.money-sum').waitFor();
      await page.getByRole('button', { name: 'Previous month' }).click();
      await page.getByText('October 2026').first().waitFor();
      await page.waitForTimeout(300);
      await snap(page, 'organizer', '18-money-october', 'Money tab, October: collected, court costs, credits owed, left', { ...t, full: true });
      await tab(page, 'Players').click();
      await page.locator('.player-list').waitFor();
      await snap(page, 'organizer', '19-players', 'Players: who owes, who has a credit, late drops', t);
      await tab(page, 'History').click();
      await page.getByRole('button', { name: 'Activity' }).click();
      await page.getByRole('list', { name: 'Activity' }).waitFor();
      await snap(page, 'organizer', '20-history-activity', 'History > Activity, Eastern times', t);
      await tab(page, 'Home').click();
      await page.getByRole('button', { name: 'View as…' }).click();
      await page.locator('dialog[open]').waitFor();
      await snap(page, 'organizer', '21-view-as', 'View as… (a demo: taps work, nothing is saved)', t);
      await snap(page.locator('.pretend-pick'), 'organizer', '21-view-as-pretend', '"Pretend it\'s…": presets for the next game, or any date and time', t);
      await page.locator('dialog[open]').getByRole('button', { name: 'Game day, 8:30 AM' }).click();
      await page.locator('.pretend-bar').waitFor();
      await page.waitForTimeout(300);
      await snap(page, 'organizer', '22-pretending', 'Pretend it\'s game day, 8:30 AM: "Demo, nothing is saved" bar with Reset and End', t);
    }
    await ctx.close();

    // Players.
    const ryan = await open('Ryan', t.width, t.scheme);
    const rp = ryan.page;
    await row(rp, C).waitFor();
    await snap(rp, 'player', '04-home-full', 'Ryan\'s whole page on game day (pay card at the top, then every game)', { ...t, full: true });
    if (!busy) {
      await snap(rp.locator('section[aria-label="Payment"]'), 'player', '05-pay-card-credit', 'Pay card: $9 after his $5 credit (6 played last time)', t);
      const rows = [
        [C, '06-row-in-booked-holiday', 'I\'m in (I\'m out shows), court booked, Election Day pill'],
        [D, '07-row-join-standby', 'Waiting on the court: Join standby'],
        [E, '08-row-five-going', '"5 going, need 4 or 6"'],
        [F, '09-row-six-discount', '6 playing: Pay $9 (6-person discount)'],
        [extra.id, '10-row-extra-game', 'Extra game, court not booked yet'],
        [G, '11-row-moved', 'Moved game'],
        [H, '12-row-canceled', 'Canceled'],
      ];
      const moreRows = rp.getByRole('button', { name: /^More sessions/ });
      if (await moreRows.count()) await moreRows.click();
      for (const [s, name, title] of rows) await snap(row(rp, s), 'player', name, title, t);
    }
    // Paid with "Didn't pay?" (Ryan taps I paid on C), only after the unpaid pictures.
    await ryan.ctx.close();
    for (const [name, file, title] of [
      ['Julian', '13-row-on-standby', 'On the standby list (court waitlist)'],
      ['Armen', '14-credit-line', 'A $5 credit but no game yet: nothing about it shows (it appears on the game it comes off)'],
      ['Mitchel', '15-after-refund', 'After a refund (canceled game, money given back): nothing owed'],
    ]) {
      if (busy) continue;
      const p = await open(name, t.width, t.scheme);
      await p.page.locator('.schedule article').first().waitFor();
      if (name === 'Julian') await snap(row(p.page, D), 'player', file, title, t);
      else await snap(p.page, 'player', file, title, t);
      await p.ctx.close();
    }
  }
  // Later rows (booking opens, not booked) as one picture each, from Alec's phone.
  for (const t of themes()) {
    const p = await open('Alec', t.width, t.scheme);
    await p.page.locator('.schedule article').first().waitFor();
    const more = p.page.getByRole('button', { name: /^More sessions/ });
    if (await more.count()) await more.click();
    const notBooked = p.page.locator('.sched-status[data-court="needs"]').first().locator('xpath=ancestor::article');
    if (await notBooked.count()) await snap(notBooked, 'player', '16-row-not-booked', 'Court not booked yet (inside the 14 days)', t);
    const opens = p.page.locator('.sched-status[data-court="later"]').first().locator('xpath=ancestor::article');
    if (await opens.count()) await snap(opens, 'player', '17-row-booking-opens', 'Further out, booking not open yet: "Court not booked yet" with a calendar icon (the date shows only to the organizer)', t);
    // Empty state and error message (the answer from the site is swapped for the picture).
    await p.ctx.route('**/api/group', async (r) => {
      const res = await r.fetch();
      const body = await res.json();
      await r.fulfill({ response: res, json: { ...body, sessions: [], owed: [], payDue: [] } });
    });
    await p.page.reload();
    await p.page.getByText('No upcoming sessions yet.').waitFor();
    await snap(p.page, 'player', '18-empty', 'Empty: no games on the schedule', t);
    await p.ctx.unroute('**/api/group');
    await p.ctx.route('**/api/group', (r) => r.abort('internetdisconnected'));
    await p.page.reload();
    await p.page.getByText(/Couldn't reach the site/).waitFor();
    await snap(p.page, 'player', '19-offline-error', 'No connection: the error message with Try again', t);
    await p.ctx.unroute('**/api/group');
    await p.page.goto(`${BASE}/t/not-a-real-link-0000000000000000000000`);
    await p.page.waitForLoadState('networkidle');
    await snap(p.page, 'player', '20-bad-link', 'A texted link that isn\'t valid', t);
    await p.ctx.close();
  }
  await call(await phone('Ryan'), 'POST', `/api/sessions/${C.id}/paid`, { paid: true });
  for (const t of themes()) {
    const p = await open('Ryan', t.width, t.scheme);
    await row(p.page, C).waitFor();
    await snap(row(p.page, C), 'player', '21-paid-didnt-pay', '"✓ Paid" with a small "Didn\'t pay?" (he marked it himself)', t);
    await p.ctx.close();
    const o = await open('organizer', t.width, t.scheme);
    await tab(o.page, 'Money').click();
    await o.page.locator('.money-sess').first().waitFor();
    const sess = o.page.locator(`details.money-sess[data-session="${C.id}"]`);
    await sess.evaluate((el) => (el.open = true));
    await snap(sess, 'organizer', '23-money-self-marked', 'Money: Ryan\'s "self-marked" tag, Mark paid for the rest', t);
    await o.ctx.close();
  }

  // 5. Mon Nov 9, 8:00 PM: day-before for E, every number saved.
  await setClock('2026-11-09 20:00');
  for (const t of themes()) {
    const { ctx, page } = await open('organizer', t.width, t.scheme);
    const db = page.locator('main article.card[aria-label]:not([aria-label^="Last call"])').filter({ has: page.getByRole('button', { name: 'Done', exact: true }) }).first();
    await db.waitFor();
    await snap(db, 'organizer', '24-day-before-all-numbers', 'Day-before card when 5 are in: "need more players" leads; everyone who is in has a number', t);
    await ctx.close();
  }

  await browser.close();
  writeIndex();
  console.log(`${shots.length} pictures in ${path.relative(ROOT, OUT)}`);
  process.exit(0);
}

function writeIndex() {
  const lines = [
    '# State gallery',
    '',
    'Every card, notice and screen state, from a fake group with a fixed clock (Eastern time).',
    'Made by `node e2e/gallery.cjs`. 390px wide in light and dark; the busiest screens also at 360px.',
    '',
    'Clock for each picture: Tue Oct 27, 9:00 AM (game-day pay card, Pay then I paid); Mon Nov 2, 8:00 PM',
    '(day-before with a missing number); Tue Nov 3, 7:00 AM (last call); Tue Nov 3, 9:00 AM (everything else);',
    'Mon Nov 9, 8:00 PM (day-before with every number).',
    '',
  ];
  for (const section of ['player', 'organizer']) {
    lines.push(`## ${section === 'player' ? 'Player' : 'Organizer'}`, '');
    const names = [...new Set(shots.filter((s) => s.section === section).map((s) => s.name))].sort();
    for (const name of names) {
      const group = shots.filter((s) => s.section === section && s.name === name);
      lines.push(`### ${group[0].title}`, '');
      lines.push(group.map((s) => `<img src="${s.file}" width="240" alt="${s.width}px ${s.scheme}">`).join(' '), '');
    }
  }
  writeFileSync(path.join(OUT, 'README.md'), lines.join('\n'));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
