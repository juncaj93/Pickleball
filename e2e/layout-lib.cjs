/* Shared set-up for the layout checks (e2e/layout-polish.cjs, Nov 2026): starts a fresh dev site, makes a fake group whose
 * names and money are the awkward cases (a 29-letter name, a name with no spaces, emoji, accents, $140.00 of credit,
 * a moved game, a full game with a waitlist), and hands back phones for players and the organizer.
 * Nothing here touches the live site or any real data.
 */
const { spawn } = require('node:child_process');
const { rmSync, mkdirSync } = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { fixedClock } = require('./fixed-clock.cjs');

const ROOT = path.join(__dirname, '..');
const PIN = '482913';
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

const LONG = 'Bartholomew Montgomery-Smythe'; // 29 letters
const NOSPACE = 'Christopherjohnathanwilliams'; // 28 letters, no spaces
const EMOJI = 'Zoë 🏓🏓🏓';
const ACCENT = 'Ångström Núñez-Çelik';
const FILL = ['Fa', 'Fb', 'Fc', 'Fd', 'Fe', 'Ff', 'Fg', 'Fh'];
const NAMES = ['Alex', 'Ryan', 'Wren', 'Zed', 'Pia', LONG, NOSPACE, EMOJI, ACCENT, 'Nathan', 'Mitchel', 'Brandon', ...FILL];
const at = (s) => Date.parse(s);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function startSite({ port, name, token, root = ROOT }) {
  const BASE = `http://localhost:${port}`;
  const dbFile = path.join(ROOT, '.data', `${name}-${port}.sqlite`);
  mkdirSync(path.join(ROOT, '.data'), { recursive: true });
  rmSync(dbFile, { force: true });
  // A server already answering on this port would be used silently (with an old database): refuse.
  if (await fetch(`${BASE}/api/status`).then((r) => r.ok, () => false)) throw new Error(`port ${port} is already in use`);
  const server = spawn('npx', ['vite', '--port', String(port), '--strictPort'], {
    cwd: root,
    env: { ...process.env, DEV_DB: dbFile, SETUP_TOKEN: token, DEV_CLOCK: '1', TELEGRAM_BOT_TOKEN: '', TELEGRAM_CHAT_ID: '', MOTION: 'on', MOTION_ADMIN: 'on' },
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
  if (!(await fetch(`${BASE}/api/status`).then((r) => r.ok, () => false))) throw new Error('the site did not start in 40 seconds');
  return { BASE, server };
}

/** The fake group, in the state described at the top. Returns everything a test needs. */
async function seed({ BASE, token }) {
  // The server clock and every browser page follow the moment set here (each new browser context starts at the latest one), so none of
  // this depends on today's real date or hour.
  const fixed = fixedClock(BASE);
  const clock = (iso) => fixed.set(at(iso));
  // Mon Nov 2, 6:00 AM Eastern: the day before the first real game.
  await clock('2026-11-02T06:00:00-05:00');
  const browser = fixed.pin(await chromium.launch());
  const post = (req, url, data) => req.post(BASE + url, { data, headers: { Origin: BASE } });
  const put = (req, url, data) => req.put(BASE + url, { data, headers: { Origin: BASE } });
  const ok = async (resp, what) => {
    if (!resp.ok()) throw new Error(`${what}: ${resp.status()} ${await resp.text()}`);
    return resp.json().catch(() => ({}));
  };
  const setup = (await browser.newContext()).request;
  await ok(
    await post(setup, '/api/setup', {
      setupToken: token,
      groupName: 'Pickleball',
      pin: PIN,
      venmoUrl: 'https://venmo.com/u/organizer',
      players: NAMES.slice(0, 16).map((name, i) => ({ name, phone: `2485553${String(i).padStart(3, '0')}` })),
    }),
    'setup',
  );
  const areq = (await browser.newContext()).request;
  await post(areq, '/api/admin/login', { pin: PIN });
  await ok(await put(areq, '/api/admin/group', { organizerName: 'Alex', settings: { maxPlayers: 10 } }), 'group');
  for (const [i, name] of NAMES.slice(16).entries()) await ok(await post(areq, '/api/admin/players', { name, phone: `2485554${String(i).padStart(3, '0')}`, isRegular: true, isActive: true }), `add ${name}`);
  const dash = async () => (await areq.get(`${BASE}/api/admin/dashboard`)).json();
  let d = await dash();
  for (const h of d.hiddenSessions || []) await post(areq, `/api/admin/sessions/${h.id}/show`, { shown: true });
  const addGame = async (startsAt, endsAt, note) => (await ok(await post(areq, '/api/admin/sessions', { startsAt: new Date(at(startsAt)).toISOString(), endsAt: new Date(at(endsAt)).toISOString(), note }), 'add game')).id;
  // Ten extra games that exist only to be paid and canceled, so one player ends with $140.00 of credit.
  const burn = [];
  for (let i = 0; i < 10; i++) burn.push(await addGame(`2026-11-0${(i % 5) + 3}T0${1 + (i % 4)}:00:00-05:00`, `2026-11-0${(i % 5) + 3}T0${2 + (i % 4)}:30:00-05:00`));
  d = await dash();
  const regular = d.sessions.filter((s) => !s.extra && !s.isExtra && !burn.includes(s.id)).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const S = {};
  regular.forEach((s, i) => (S[i + 1] = s.id));
  const idOf = (n) => d.players.find((p) => p.name === n).id;
  for (const id of [S[1], S[2], S[3], S[6], S[7], S[8], ...burn]) await ok(await post(areq, `/api/admin/sessions/${id}/booked`, {}), 'book');
  await ok(await post(areq, `/api/admin/sessions/${S[5]}/court-status`, { status: 'waitlist' }), 'waitlist');

  const who = {};
  for (const n of NAMES) {
    const c = await browser.newContext();
    await post(c.request, '/api/me', { playerId: idOf(n) });
    who[n] = c.request;
  }
  const join = async (n, id, want) => {
    const r = await post(who[n], `/api/sessions/${id}/join`, {});
    const body = await r.json().catch(() => ({}));
    if (!r.ok() || (want && body.result !== want)) throw new Error(`${n} joining ${id}: ${r.status()} ${JSON.stringify(body)}`);
    return body;
  };
  const adminPaid = async (n, id) => ok(await post(areq, `/api/admin/sessions/${id}/payment`, { playerId: idOf(n), paid: true }), `mark ${n} paid`);
  const cancel = async (id, reason) => ok(await post(areq, `/api/admin/sessions/${id}/decision`, { decision: 'cancel', confirm: true, ...(reason ? { reason } : {}) }), 'cancel');

  // Tonight (S1, Tue Nov 3): 4 in with the awkward names.
  for (const n of ['Ryan', NOSPACE, LONG, EMOJI]) await join(n, S[1], 'confirmed');
  // Thu Nov 5 (S2): 10 in, long names; Nathan waits.
  for (const n of ['Ryan', 'Wren', LONG, NOSPACE, EMOJI, ACCENT, 'Fe', 'Ff', 'Fg', 'Fh']) await join(n, S[2], 'confirmed');
  await join('Nathan', S[2], 'waitlisted');
  // S3: Ryan owes, Wren paid. S4: no court, 3 in. S5: the venue's waitlist, 2 in.
  for (const n of ['Ryan', 'Wren', ACCENT]) await join(n, S[3], 'confirmed');
  await adminPaid('Wren', S[3]);
  for (const n of ['Ryan', 'Wren', ACCENT]) await join(n, S[4], 'confirmed');
  for (const n of ['Ryan', NOSPACE]) await join(n, S[5], 'confirmed');
  await join('Ryan', S[6], 'confirmed');
  // Wren: part credit needs credit, so Wren pays for S7 and the game is canceled for a reason (credit $14).
  await join('Wren', S[7], 'confirmed');
  await adminPaid('Wren', S[7]);
  await cancel(S[7], 'Thanksgiving week, venue closed');
  await join('Zed', S[8], 'confirmed');
  // $140.00 of credit for the 29-letter name (ten $14 seats paid, then the games canceled and hidden). Last, so
  // the credit is not used up by the joins above.
  // (Join and pay for all ten first: a credit from one cancel would be used up at the next I'm in.)
  for (const id of burn) {
    await join(LONG, id, 'confirmed');
    await adminPaid(LONG, id);
  }
  for (const id of burn) {
    await cancel(id);
    await ok(await post(areq, `/api/admin/sessions/${id}/show`, { shown: false }), 'hide');
  }
  // Extra (one-off) games for the EXTRA tag and the comment pill / box: a short comment, a long one, none. And a canceled game with a short reason.
  const extras = {
    short: await addGame('2026-11-04T18:30:00-05:00', '2026-11-04T20:30:00-05:00', 'Bring balls'),
    long: await addGame('2026-11-07T10:30:00-05:00', '2026-11-07T12:30:00-05:00', 'New spot: east courts 5 and 6. Park by the tennis bubble, walk in the side door'),
    none: await addGame('2026-11-08T10:30:00-05:00', '2026-11-08T12:30:00-05:00'),
  };
  await cancel(S[8], 'Rain');
  // Thu Nov 12 (S3... the third game) moves 30 minutes later: its players get the Still in / Can't make it notice.
  await ok(await put(areq, '/api/admin/time-shift', { on: true }), 'time shift on');
  d = await dash();
  const moved = d.sessions.find((s) => s.id === S[3]);
  const later = (iso) => new Date(Date.parse(iso) + 30 * 60 * 1000).toISOString();
  await ok(await put(areq, `/api/admin/sessions/${S[3]}/time`, { startsAt: later(moved.startsAt), endsAt: later(moved.endsAt) }), 'move S3');
  await clock('2026-11-02T09:00:00-05:00');
  return { browser, post, put, ok, clock, areq, who, S, extras, idOf, dash, join, adminPaid, d };
}

module.exports = { ROOT, PIN, UA, LONG, NOSPACE, EMOJI, ACCENT, FILL, NAMES, at, sleep, startSite, seed };
