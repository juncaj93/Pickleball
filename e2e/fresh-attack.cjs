/* Fresh attack on the PLAYER side: random hostile sequences through real phones (browser) and the API,
 * with the books and the screens checked after every step. Independent auditor; touches nothing but a
 * throwaway local database and a fake clock.
 *
 *   node e2e/fresh-attack.cjs                      (default seeds, about 25 minutes)
 *   SEEDS=7,8 STEPS=40 node e2e/fresh-attack.cjs   (repro: same seed, same steps)
 *   BUDGET_MIN=10 node e2e/fresh-attack.cjs        (stop starting new sequences after 10 minutes)
 *
 * Every step prints one line ("seed 7 #12 drop Ryan@P1 Tue Nov 3 undo@1200ms"). A failure prints the
 * check, what the phone showed and the server truth. Steps use only the seeded random, so a seed replays
 * the same taps (timing on the network still varies, as it would on real phones).
 */
const { spawn } = require('node:child_process');
const { rmSync, mkdirSync } = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const PORT = 5310;
const BASE = `http://localhost:${PORT}`;
const SETUP_TOKEN = 'fresh-attack-setup-token-0123456789';
const PIN = '615243';
const DB = path.join(ROOT, '.data', 'fresh-b.sqlite');
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const NAMES = ['Alex', 'Nathan', 'Ryan', "D'Andre", 'José', 'Mitchel', 'Brandon', 'Julian'];
const ORGANIZER = 'Alex';
const PHONE_OF = (i) => `2485550${String(170 + i)}`;
const SEEDS = (process.env.SEEDS || '1103,2026,77,4242,9001,31337,555,8128,1999,6060').split(',').map(Number);
const STEPS = Number(process.env.STEPS) || 50;
const BUDGET_MS = (Number(process.env.BUDGET_MIN) || 24) * 60_000;
const SETTLE_MS = 6500;
const START = Date.parse('2026-10-30T09:00:00-04:00'); // Fri Oct 30, 9:00 AM Eastern
const DST = [Date.parse('2026-11-01T05:30:00Z'), Date.parse('2026-11-01T06:30:00Z'), Date.parse('2026-11-01T07:10:00Z')]; // 1:30 AM EDT, 1:30 AM EST, 2:10 AM EST
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fmt = (c) => `$${c % 100 === 0 ? c / 100 : (c / 100).toFixed(2)}`;
const day = (iso) => new Date(iso).toLocaleString('en-US', { timeZone: 'America/Detroit', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

// ---------- seeded random ----------
function mulberry32(a) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
let rnd = Math.random;
const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const chance = (p) => rnd() < p;

// ---------- results ----------
const failures = new Map(); // signature -> { count, first }
let totalSteps = 0;
let totalChecks = 0;
let totalSequences = 0;
let curSeed = 0;
let curStep = 0;
let stepLog = [];
function fail(kind, detail, extra = '') {
  const sig = `${kind}: ${detail}`.replace(/\$\d+/g, '$N').replace(/[0-9a-f]{16,}/g, 'ID').slice(0, 160);
  const f = failures.get(sig);
  if (f) {
    f.count++;
    return;
  }
  const first = { seed: curSeed, step: curStep, kind, detail, extra, recent: stepLog.slice(-6) };
  failures.set(sig, { count: 1, first });
  console.log(`  ✗ [seed ${curSeed} #${curStep}] ${kind}: ${detail}${extra ? `\n      ${extra.slice(0, 600)}` : ''}`);
}
function check(cond, kind, detail, extra) {
  totalChecks++;
  if (!cond) fail(kind, detail, extra);
  return !!cond;
}

// ---------- server ----------
let server = null;
async function startServer() {
  mkdirSync(path.join(ROOT, '.data'), { recursive: true });
  for (const sfx of ['', '-wal', '-shm', '-journal']) rmSync(DB + sfx, { force: true });
  server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
    cwd: ROOT,
    env: { ...process.env, DEV_DB: DB, SETUP_TOKEN, DEV_CLOCK: '1' },
    stdio: 'ignore',
    detached: true,
  });
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(`${BASE}/api/status`)).ok) return;
    } catch {}
    await sleep(250);
  }
  throw new Error('server did not start');
}
async function stopServer() {
  if (!server) return;
  try {
    process.kill(-server.pid, 'SIGTERM');
  } catch {}
  for (let i = 0; i < 40; i++) {
    try {
      await fetch(`${BASE}/api/status`);
    } catch {
      break;
    }
    await sleep(150);
  }
  server = null;
}
process.on('exit', () => {
  try {
    if (server) process.kill(-server.pid, 'SIGTERM');
  } catch {}
});

// ---------- fake clock ----------
let clockBase = START;
let clockSetAt = Date.now();
const nowMs = () => clockBase + (Date.now() - clockSetAt);
let allContexts = [];
async function setClock(ms) {
  await fetch(`${BASE}/__dev/clock`, { method: 'POST', body: JSON.stringify({ atMs: ms }) });
  clockBase = ms;
  clockSetAt = Date.now();
  // The phones live at the same fake time (their own Date drives the Undo window and the cut-off).
  for (const c of allContexts) await c.clock.setSystemTime(ms).catch(() => {});
}

// ---------- privacy scan: anything a player receives ----------
const FORBIDDEN_KEY = /phone|courtcost|costcents|membership|venmohandle|venmoname|reservation|balances|creditledger|refundrequests|paymentclaims/i;
let phones = {}; // name -> phone digits
function scanPrivacy(json, viewerName, where) {
  const others = Object.entries(phones).filter(([n]) => n !== viewerName);
  const text = JSON.stringify(json);
  totalChecks++;
  for (const [n, ph] of others) if (text.includes(ph)) return fail('privacy', `${n}'s phone number in a response to ${viewerName}`, where);
  const walk = (v, p) => {
    if (Array.isArray(v)) return v.forEach((x, i) => walk(x, `${p}[${i}]`));
    if (!v || typeof v !== 'object') return;
    for (const k of Object.keys(v)) {
      if (FORBIDDEN_KEY.test(k)) fail('privacy', `key "${k}" sent to a player (${viewerName})`, `${where} ${p}.${k}`);
      walk(v[k], `${p}.${k}`);
    }
  };
  walk(json, '');
  for (const s of json.sessions || []) {
    for (const c of s.confirmed || []) if (Object.keys(c).some((k) => !['name', 'attendanceConfirmed'].includes(k))) fail('privacy', 'extra fields on another player in a game', `${where} ${JSON.stringify(c)}`);
    for (const c of s.waitlist || []) if (Object.keys(c).some((k) => k !== 'name')) fail('privacy', 'extra fields on a waiting player', `${where} ${JSON.stringify(c)}`);
  }
  for (const p of json.players || []) if (Object.keys(p).some((k) => !['id', 'name'].includes(k))) fail('privacy', 'extra fields in the players list', `${where} ${JSON.stringify(p)}`);
}

// ---------- the run ----------
async function main() {
  const browser = await chromium.launch();
  const t0 = Date.now();
  console.log(`fresh-attack: seeds ${SEEDS.join(',')}, ${STEPS} steps each, budget ${BUDGET_MS / 60000} min`);
  for (const seed of SEEDS) {
    if (Date.now() - t0 > BUDGET_MS) break;
    try {
      await runSequence(browser, seed, t0);
    } catch (err) {
      fail('harness', `sequence crashed: ${String(err && err.message ? err.message : err).slice(0, 200)}`, String(err && err.stack).slice(0, 500));
    }
    await stopServer();
  }
  await browser.close();
  const mins = ((Date.now() - t0) / 60000).toFixed(1);
  console.log(`\n==== fresh-attack done in ${mins} min: ${totalSequences} sequences, ${totalSteps} steps, ${totalChecks} checks, ${failures.size} distinct failures ====`);
  for (const [sig, f] of failures) {
    console.log(`\n✗ ${sig}  (x${f.count})\n  first: seed ${f.first.seed} step ${f.first.step}\n  ${f.first.extra.slice(0, 700)}\n  steps before it:\n    ${f.first.recent.join('\n    ')}`);
  }
  process.exit(failures.size ? 1 : 0);
}

async function runSequence(browser, seed, t0) {
  curSeed = seed;
  curStep = 0;
  stepLog = [];
  rnd = mulberry32(seed);
  console.log(`\n=== seed ${seed} ===`);
  await startServer();
  allContexts = [];
  await setClock(START);
  const post = (req, url, data) => req.post(BASE + url, { data, headers: { Origin: BASE } });
  const setupCtx = await browser.newContext();
  phones = Object.fromEntries(NAMES.map((n, i) => [n, PHONE_OF(i)]));
  const made = await post(setupCtx.request, '/api/setup', {
    setupToken: SETUP_TOKEN,
    groupName: 'Pickleball Bros',
    pin: PIN,
    venmoUrl: 'https://venmo.com/u/organizer',
    players: NAMES.map((name) => ({ name, phone: phones[name] })),
  });
  if (!made.ok()) throw new Error(`setup failed: ${await made.text()}`);
  await setupCtx.close();

  // ----- organizer (API) -----
  const adminCtx = await browser.newContext({ viewport: { width: 390, height: 800 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: UA });
  allContexts.push(adminCtx);
  await adminCtx.clock.setSystemTime(nowMs());
  await adminCtx.route(/^https?:\/\/(?!localhost)/, (route) => route.abort().catch(() => {}));
  const A = adminCtx.request;
  await post(A, '/api/admin/login', { pin: PIN });
  let maxPlayers = pick([4, 4, 5, 6]);
  await A.put(BASE + '/api/admin/group', { data: { organizerName: ORGANIZER, settings: { maxPlayers } }, headers: { Origin: BASE } });
  // A dropped connection (the dev server reloading code that changed on disk) is retried, not counted as a finding.
  const retry = async (fn) => {
    for (let i = 0; ; i++) {
      try {
        return await fn();
      } catch (err) {
        if (i >= 8 || !/ECONNRESET|ECONNREFUSED|socket hang up|Unexpected end|JSON/i.test(String(err && err.message))) throw err;
        await sleep(750);
      }
    }
  };
  const dash = () => retry(async () => (await A.get(`${BASE}/api/admin/dashboard`)).json());
  let d = await dash();
  for (const h of d.hiddenSessions || []) await post(A, `/api/admin/sessions/${h.id}/show`, { shown: true });
  d = await dash();
  const idOf = (n) => d.players.find((p) => p.name === n).id;
  const nameOf = (id) => (d.players.find((p) => p.id === id) || {}).name;
  const upcoming = () => d.sessions.filter((s) => Date.parse(s.endsAt) > nowMs());
  for (const s of upcoming()) if (chance(0.65)) await post(A, `/api/admin/sessions/${s.id}/court-status`, { status: pick(['booked', 'booked', 'waitlist']) });

  // ----- API identity per player (for truth and bots) -----
  const api = {};
  for (const n of NAMES) {
    const c = await browser.newContext();
    await post(c.request, '/api/me', { playerId: idOf(n) });
    api[n] = c.request;
  }
  const truthOf = async (req, who) => {
    const j = await retry(async () => {
      const r = await req.get(`${BASE}/api/group`);
      return r.ok() ? r.json() : null;
    });
    if (!j) return null;
    scanPrivacy(j, who, 'GET /api/group');
    return j;
  };

  // ----- phones -----
  const phoneSpecs = [
    { label: 'P1', who: 'Nathan', w: 390, scheme: 'light' },
    { label: 'P2', who: 'Ryan', w: 320, scheme: 'dark' },
    { label: 'P3', who: 'José', w: 390, scheme: 'dark' },
    { label: 'P4', who: 'Nathan', w: 320, scheme: 'light' }, // Nathan's second phone
    { label: 'P5', who: "D'Andre", w: 320, scheme: 'dark' },
  ];
  const phonesList = [];
  for (const spec of phoneSpecs) {
    const ctx = await browser.newContext({ viewport: { width: spec.w, height: 760 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: UA, colorScheme: spec.scheme });
    allContexts.push(ctx);
    await ctx.clock.setSystemTime(nowMs());
    await ctx.addInitScript(() => {
      window.__toasts = [];
      const seen = new WeakSet();
      new MutationObserver(() => {
        for (const b of document.querySelectorAll('[data-banner]')) {
          if (seen.has(b)) continue;
          seen.add(b);
          const m = b.querySelector('.toast-msg');
          window.__toasts.push({ t: Date.now(), msg: m ? m.textContent : '', error: b.classList.contains('pop-error') });
        }
      }).observe(document, { childList: true, subtree: true });
    });
    await ctx.route(/^https?:\/\/(?!localhost)/, (route) => route.abort().catch(() => {})); // local only: Venmo and the rest are blocked
    await post(ctx.request, '/api/me', { playerId: idOf(spec.who) });
    const ph = { ...spec, ctx, page: null, offline: false, slow: false };
    await openPage(ph);
    phonesList.push(ph);
  }
  async function openPage(ph) {
    ph.page = await ph.ctx.newPage();
    ph.page.on('response', async (res) => {
      const u = res.url();
      if (!u.includes('/api/') || !(res.headers()['content-type'] || '').includes('json')) return;
      try {
        scanPrivacy(await res.json(), ph.who, `${ph.label} ${res.request().method()} ${u.replace(BASE, '')}`);
      } catch {}
    });
    await ph.page.goto(BASE).catch(() => {});
    await ph.page.locator('main').waitFor({ timeout: 10000 }).catch(() => {});
  }

  // bots fill games a little
  const bots = ['Mitchel', 'Brandon', 'Julian'];
  for (const s of upcoming()) for (const b of bots) if (chance(0.35)) await post(api[b], `/api/sessions/${s.id}/join`, {});
  // Money to play with: a far game everyone paid for is canceled, so most phone players start with $14 credit.
  {
    const far = upcoming()[upcoming().length - 1];
    await post(A, `/api/admin/sessions/${far.id}/court-status`, { status: 'booked' });
    const payers = ['Nathan', 'Ryan', 'José', "D'Andre", ...bots].filter(() => chance(0.75));
    for (const n of payers) await post(api[n], `/api/sessions/${far.id}/join`, {});
    d = await dash();
    for (const r of d.sessions.find((x) => x.id === far.id).roster) if (r.status === 'confirmed' && !r.isOrganizer) await post(A, `/api/admin/sessions/${far.id}/payment`, { playerId: r.playerId, paid: true, seen: r.moneySeen });
    await post(A, `/api/admin/sessions/${far.id}/decision`, { decision: 'cancel', confirm: true, reason: 'Seed credit' });
    stepLog.push(`#0 seed credit: ${payers.join(', ')} paid ${day(far.startsAt)}, canceled`);
    console.log(`seed ${seed} #0 ${stepLog[0]}; max players ${maxPlayers}`);
  }

  // ---------- helpers ----------
  const toastsOf = async (ph, since) => (await ph.page.evaluate((t) => (window.__toasts || []).filter((x) => x.t >= t), since).catch(() => [])) || [];
  const row = (ph, sid) => ph.page.locator(`#row-${sid}`);
  const tap = async (loc, dbl = false) => {
    try {
      await loc.first().scrollIntoViewIfNeeded({ timeout: 1500 });
      if (dbl) await loc.first().dblclick({ timeout: 1500 });
      else await loc.first().click({ timeout: 1500 });
      return true;
    } catch {
      return false;
    }
  };
  const visibleRowIds = async (ph) => (await ph.page.evaluate(() => [...document.querySelectorAll('article.sched:not(.leaving)')].map((e) => e.id.slice(4))).catch(() => [])) || [];
  const browserNow = async (ph) => ph.page.evaluate(() => Date.now()).catch(() => 0);

  async function withNet(ph, kind, fn) {
    if (kind === 'slow') {
      const ms = ri(1200, 4000);
      await ph.page.route('**/api/**', async (route) => {
        await sleep(ms);
        await route.continue().catch(() => {});
      });
      try {
        return await fn(`slow ${ms}ms`);
      } finally {
        await ph.page.unroute('**/api/**').catch(() => {});
      }
    }
    if (kind === 'offline') {
      await ph.ctx.setOffline(true);
      try {
        return await fn('offline');
      } finally {
        await sleep(ri(300, 2500));
        await ph.ctx.setOffline(false);
        // A page opened while offline is the browser's own "no internet" page: the player reloads once back online.
        if (ph.page && !ph.page.isClosed() && !(await ph.page.locator('main').count().catch(() => 0))) await ph.page.reload().catch(() => {});
      }
    }
    return fn('');
  }

  // ---------- player actions (through the phone) ----------
  async function playerAction(ph) {
    const g = await truthOf(ph.ctx.request, ph.who);
    if (!g) return 'no truth';
    const ids = await visibleRowIds(ph);
    const sessions = g.sessions.filter((s) => ids.includes(s.id));
    const mineIn = sessions.filter((s) => s.mine && s.mine.status === 'confirmed' && !s.canceled && !s.started);
    const notIn = sessions.filter((s) => !(s.mine && ['confirmed', 'waitlisted'].includes(s.mine.status)) && !s.canceled && !s.started);
    const unpaid = sessions.filter((s) => s.mine && s.mine.status === 'confirmed' && s.mine.paymentStatus === 'unpaid' && !s.canceled);
    const creditPaid = sessions.filter((s) => s.mine && s.mine.paidWithCredit);
    const selfPaid = sessions.filter((s) => s.mine && s.mine.selfPaid && !s.mine.paidWithCredit);
    const options = [];
    if (notIn.length) options.push('join', 'join', 'join');
    if (mineIn.length) options.push('drop', 'drop', 'drop');
    if (unpaid.length) options.push('iPaid', 'useCredit');
    if (creditPaid.length) options.push('undoCredit');
    if (selfPaid.length) options.push('didntPay');
    if (g.credit.usableCents > 0 && !g.credit.pending) options.push('cashOut');
    if (g.credit.pending) options.push('cashOutCancel', 'cashOutUse');
    options.push('notYou', 'reload', 'twoPhones', 'hack');
    const act = pick(options);
    const net = chance(0.12) ? 'slow' : chance(0.08) ? 'offline' : '';
    const since = await browserNow(ph);
    const balBefore = g.credit.balanceCents;
    const tag = `${ph.who}@${ph.label}${net ? ` [${net}]` : ''}`;
    switch (act) {
      case 'join': {
        const s = pick(notIn);
        const dbl = chance(0.25);
        const res = await withNet(ph, net, async () => {
          const btn = row(ph, s.id).getByRole('button', { name: /^(I'm in|Join waitlist|Join standby)$/ });
          const ok = await tap(btn, dbl);
          await sleep(net === 'offline' ? 1500 : 600);
          return ok;
        });
        if (res) await expectAfterJoin(ph, s, since, balBefore, net);
        return `join ${tag} ${day(s.startsAt)}${dbl ? ' double-tap' : ''}${res ? '' : ' (no button)'}`;
      }
      case 'drop': {
        const s = pick(mineIn);
        const mode = pick(['plain', 'plain', 'undo', 'undo', 'late-undo', 'reload', 'reload-rejoin', 'close', 'rejoin', 'dbl', 'switch']);
        const undoAt = ri(200, 4500);
        let note = '';
        const dropper = ph.who;
        const othersBefore = {};
        if (mode === 'switch') {
          for (const n of NAMES) {
            const t = await truthOf(api[n], n);
            const m = t && t.sessions.find((x) => x.id === s.id);
            othersBefore[n] = m && m.mine ? m.mine.status : 'none';
          }
        }
        await withNet(ph, net, async () => {
          if (!(await tap(row(ph, s.id).getByRole('button', { name: 'Drop out' }), mode === 'dbl'))) {
            note = ' (no Drop out)';
            return;
          }
          const dlg = ph.page.locator('dialog[open]');
          if (!(await tap(dlg.getByRole('button', { name: 'Drop out' }), mode === 'dbl'))) {
            note = ' (no confirm)';
            return;
          }
          if (mode === 'undo' || mode === 'late-undo') {
            await sleep(mode === 'undo' ? undoAt : 5200);
            const u = ph.page.locator('[data-banner] .toast-action', { hasText: 'Undo' });
            const clicked = await u.first().click({ timeout: 400 }).then(() => true).catch(() => false);
            note = ` undo@${mode === 'undo' ? undoAt : 5200}ms${clicked ? '' : ' (Undo gone)'}`;
          } else if (mode === 'reload-rejoin') {
            // Drop out, reload inside the Undo wait, then I'm in on the same game: they must end up in.
            await sleep(undoAt);
            await ph.page.reload().catch(() => {});
            await row(ph, s.id).waitFor({ timeout: 8000 }).catch(() => {});
            const btn = row(ph, s.id).getByRole('button', { name: /^(I'm in|Join waitlist)$/ });
            await btn.first().waitFor({ timeout: 6000 }).catch(() => {});
            const ok = await tap(btn);
            await sleep(1500);
            note = ` reload@${undoAt}ms then I'm in${ok ? '' : ' (no I\'m in button)'}`;
          } else if (mode === 'reload') {
            await sleep(undoAt);
            await ph.page.reload().catch(() => {});
            note = ` reload@${undoAt}ms`;
          } else if (mode === 'close') {
            await sleep(undoAt);
            await ph.page.close({ runBeforeUnload: true }).catch(() => {});
            await sleep(ri(200, 1500));
            await openPage(ph);
            note = ` close@${undoAt}ms`;
          } else if (mode === 'rejoin') {
            await sleep(undoAt);
            await tap(row(ph, s.id).getByRole('button', { name: /^(I'm in|Join waitlist)$/ }));
            note = ` I'm-in@${undoAt}ms`;
          } else if (mode === 'switch') {
            await sleep(undoAt);
            const inToo = Object.keys(othersBefore).filter((n) => n !== ph.who && othersBefore[n] === 'confirmed' && !bots.includes(n));
            note = ` not-you@${undoAt}ms ${await switchName(ph, inToo.length && chance(0.8) ? pick(inToo) : null)}`;
          }
        });
        // The banner at the tap says what happens to the money: it must match the seat as the server has it.
        if (!/no Drop out|no confirm/.test(note)) {
          const msg = ((await toastsOf(ph, since)).find((x) => /^You dropped out\./.test(x.msg)) || {}).msg;
          const m = s.mine;
          const want = m.dropClaimCents > 0 ? `once` : m.dropCreditCents + m.dropCashCents > 0 ? fmt(m.dropCreditCents + m.dropCashCents) : null;
          if (msg) check(want ? msg.includes(want) : msg === 'You dropped out.', 'toast-money', `drop banner "${msg}" but the seat holds credit ${fmt(m.dropCreditCents)}, cash ${fmt(m.dropCashCents)}, unconfirmed I paid ${fmt(m.dropClaimCents)}`, `${ph.label} ${ph.who} ${day(s.startsAt)} ${JSON.stringify(m)}`);
        }
        await expectAfterDrop(ph, s, mode, note, since, balBefore, net, dropper, othersBefore);
        return `drop ${tag} ${day(s.startsAt)} ${mode}${note} (seat ${s.mine.paymentStatus}${s.mine.selfPaid ? ' self' : ''} cr${s.mine.dropCreditCents} cash${s.mine.dropCashCents} claim${s.mine.dropClaimCents})`;
      }
      case 'iPaid': {
        const s = pick(unpaid);
        let top = false;
        await withNet(ph, net, async () => {
          if (chance(0.4)) {
            // Pay first (opens Venmo, blocked here), then I paid shows beside it.
            await tap(row(ph, s.id).locator('a[aria-label^="Pay "]'));
            await sleep(400);
            for (const pg of ph.ctx.pages()) if (pg !== ph.page) await pg.close().catch(() => {});
          }
          const inRow = row(ph, s.id).getByRole('button', { name: 'I paid' });
          if (!(await tap(inRow, chance(0.2)))) {
            top = true;
            await tap(ph.page.locator('section[aria-label="Payment"]').getByRole('button', { name: 'I paid' }));
          }
          await sleep(500);
        });
        return `I paid ${tag} ${top ? 'on the top card (every game due today)' : day(s.startsAt)}`;
      }
      case 'useCredit': {
        const s = pick(unpaid);
        let top = false;
        await withNet(ph, net, async () => {
          if (!(await tap(row(ph, s.id).locator('[data-use-credit]'), chance(0.25)))) {
            top = true;
            await tap(ph.page.locator('section[aria-label="Payment"] [data-use-credit]'));
          }
          await sleep(500);
        });
        return `use credit ${tag} ${top ? 'on the top card' : day(s.startsAt)}`;
      }
      case 'undoCredit': {
        const s = pick(creditPaid);
        await withNet(ph, net, async () => {
          await tap(row(ph, s.id).locator('[data-undo-credit]'), chance(0.25));
          await sleep(500);
        });
        return `undo credit ${tag} ${day(s.startsAt)}`;
      }
      case 'didntPay': {
        const s = pick(selfPaid);
        await withNet(ph, net, async () => {
          await tap(row(ph, s.id).getByRole('button', { name: "Didn't pay?" }), chance(0.2));
          await sleep(500);
        });
        return `didn't pay ${tag} ${day(s.startsAt)}`;
      }
      case 'cashOut': {
        const amt = chance(0.5) ? Math.floor(g.credit.usableCents / 100) : ri(1, Math.max(1, Math.floor(g.credit.usableCents / 100) + 2));
        await withNet(ph, net, async () => {
          if (!(await tap(ph.page.locator('[data-credit-chip]')))) return;
          await tap(ph.page.locator('[data-request-refund]'));
          await ph.page.locator('[data-refund-ask] input').fill(String(amt)).catch(() => {});
          await tap(ph.page.locator('[data-refund-ask]').getByRole('button', { name: /^Request cash out/ }), chance(0.2));
          await sleep(800);
          await ph.page.keyboard.press('Escape').catch(() => {});
        });
        return `cash out request $${amt} ${tag} (usable ${fmt(g.credit.usableCents)})`;
      }
      case 'cashOutCancel': {
        await withNet(ph, net, async () => {
          if (!(await tap(ph.page.locator('[data-credit-chip]')))) return;
          await tap(ph.page.getByRole('button', { name: 'Cancel request' }), chance(0.2));
          await sleep(800);
          await ph.page.keyboard.press('Escape').catch(() => {});
        });
        return `cash out cancel ${tag}`;
      }
      case 'cashOutUse': {
        // I'm in on a game, then "Use it" on the cash-out question (or the API, if the question did not come up).
        const s = notIn.length ? pick(notIn) : null;
        if (!s) return `cash out use ${tag}: no game to join`;
        await tap(row(ph, s.id).getByRole('button', { name: /^(I'm in|Join waitlist)$/ }));
        const asked = await ph.page.locator('[data-cashout-use]').waitFor({ timeout: 2500 }).then(() => true).catch(() => false);
        if (asked) await tap(ph.page.locator('[data-cashout-use]'), chance(0.2));
        await sleep(600);
        return `cash out use ${tag} ${day(s.startsAt)}${asked ? '' : ' (no question)'}`;
      }
      case 'hack': {
        // Acting for someone else: an admin route, and a player route with another player's id in the body.
        const adm = await ph.ctx.request.get(`${BASE}/api/admin/dashboard`);
        check([401, 403].includes(adm.status()), 'privacy', `player phone read the organizer dashboard (${adm.status()})`, ph.label);
        const victim = pick(bots);
        const vs = g.sessions.find((x) => x.confirmed.some((c) => c.name === victim) && !x.canceled);
        if (!vs) return `hack ${tag}: dashboard ${adm.status()}`;
        const before = (await truthOf(api[victim], victim)).sessions.find((x) => x.id === vs.id).mine;
        const r1 = await post(ph.ctx.request, `/api/admin/sessions/${vs.id}/payment`, { playerId: idOf(victim), paid: true });
        const r2 = await post(ph.ctx.request, `/api/sessions/${vs.id}/paid`, { paid: before.paymentStatus !== 'paid', playerId: idOf(victim) });
        const r3 = await post(ph.ctx.request, `/api/sessions/${vs.id}/withdraw`, { playerId: idOf(victim) });
        const after = (await truthOf(api[victim], victim)).sessions.find((x) => x.id === vs.id).mine;
        check(after.status === before.status && after.paymentStatus === before.paymentStatus, 'privacy', `${ph.who} changed ${victim}'s seat by putting their id in a request`, `${JSON.stringify(before)} -> ${JSON.stringify(after)}`);
        check([401, 403].includes(r1.status()), 'privacy', `player phone used an organizer route (${r1.status()})`, ph.label);
        return `hack ${tag} vs ${victim} ${day(vs.startsAt)}: admin ${adm.status()}/${r1.status()}, paid ${r2.status()}, withdraw ${r3.status()}`;
      }
      case 'notYou':
        return `not you ${ph.label}: ${await switchName(ph)}`;
      case 'reload':
        await ph.page.reload().catch(() => {});
        return `reload ${ph.label}`;
      case 'twoPhones': {
        // The same player on two phones taps at the same moment: one drops, the other joins or uses credit.
        const twin = phonesList.find((x) => x !== ph && x.who === ph.who && x.page && !x.page.isClosed());
        const s = sessions.find((x) => !x.canceled && !x.started);
        if (!twin || !s) return `two phones ${ph.label}: no twin`;
        const isIn = s.mine && s.mine.status === 'confirmed';
        const a = isIn ? tap(row(ph, s.id).getByRole('button', { name: 'Drop out' })).then(() => tap(ph.page.locator('dialog[open]').getByRole('button', { name: 'Drop out' }))) : tap(row(ph, s.id).getByRole('button', { name: /^(I'm in|Join waitlist)$/ }));
        const b = isIn ? tap(row(twin, s.id).locator('[data-use-credit]')).then((ok) => ok || tap(row(twin, s.id).getByRole('button', { name: 'I paid' }))) : tap(row(twin, s.id).getByRole('button', { name: /^(I'm in|Join waitlist)$/ }));
        await Promise.all([a, b]);
        await sleep(5800);
        return `two phones ${ph.who}@${ph.label}+${twin.label} ${day(s.startsAt)} ${isIn ? 'drop vs pay' : 'both join'}`;
      }
    }
    return act;
  }

  async function switchName(ph, prefer = null) {
    if (!(await tap(ph.page.getByRole('button', { name: 'Not you?' })))) return '(no Not you?)';
    const choices = NAMES.filter((n) => n !== ph.who && n !== ORGANIZER && !bots.includes(n));
    const to = prefer || (chance(0.15) ? ORGANIZER : pick(choices));
    const ok = await tap(ph.page.locator('section[aria-label="Pick your name"]').getByRole('button', { name: to, exact: true }));
    if (ok) {
      await sleep(400);
      ph.who = to;
    }
    return ok ? `-> ${to}` : '(no name button)';
  }

  // What the player asked for must be what the server did (or the screen said why not).
  async function expectAfterJoin(ph, s, since, balBefore, net) {
    await sleep(net === 'slow' ? 4500 : 1200);
    const t = await truthOf(api[ph.who], ph.who);
    const after = t && t.sessions.find((x) => x.id === s.id);
    const toasts = await toastsOf(ph, since);
    const errored = toasts.some((x) => x.error);
    if (!after || net === 'offline') return;
    const st = after.mine && after.mine.status;
    check(['confirmed', 'waitlisted'].includes(st) || errored || after.canceled || after.started, 'intent', "tapped I'm in: not in and no message why", `${ph.label} ${ph.who} ${day(s.startsAt)} status=${st} toasts=${JSON.stringify(toasts)}`);
    const m = toasts.map((x) => x.msg).join(' | ');
    const used = /\$(\d+) credit used/.exec(m);
    if (used && st === 'confirmed') check(balBefore - t.credit.balanceCents === Number(used[1]) * 100 || balBefore - t.credit.balanceCents === 0, 'toast-money', `"${used[0]}" but credit went ${fmt(balBefore)} -> ${fmt(t.credit.balanceCents)}`, `${ph.label} ${ph.who} ${m}`);
  }
  async function expectAfterDrop(ph, s, mode, note, since, balBefore, net, dropper, othersBefore) {
    if (mode === 'switch' && net !== 'offline' && !/no Drop out|no confirm|no Not you|no name/.test(note)) {
      // Not you? while the drop waits for Undo: the drop is still the first player's, never the new name's.
      await sleep(7000);
      for (const [n, st] of Object.entries(othersBefore)) {
        const now = await truthOf(api[n], n);
        const m = now && now.sessions.find((x) => x.id === s.id);
        if (!m || m.started || m.canceled) return;
        const stNow = m.mine ? m.mine.status : 'none';
        if (n === dropper) check(stNow !== 'confirmed', 'intent', `${dropper} dropped out, then Not you? during the Undo wait: ${dropper} is still in`, `${ph.label} ${note}`);
        else check(stNow === st || st !== 'confirmed', 'wrong-player', `${dropper}'s held drop took ${n} out after Not you? on the same phone`, `${ph.label} ${day(s.startsAt)} ${n}: ${st} -> ${stNow} ${note}`);
      }
      return;
    }
    if (mode === 'switch' || net === 'offline') return;
    await sleep(net === 'slow' ? 9500 : mode === 'undo' || mode === 'late-undo' ? 1500 : 6800);
    const who = mode === 'switch' ? null : ph.who;
    const t = await truthOf(api[who], who);
    const after = t && t.sessions.find((x) => x.id === s.id);
    if (!after || after.started || after.canceled) return;
    const toasts = await toastsOf(ph, since);
    const st = after.mine && after.mine.status;
    const tooLate = toasts.some((x) => /Too late/.test(x.msg));
    const errored = toasts.some((x) => x.error && !/Too late/.test(x.msg));
    if (/no Drop out|no confirm/.test(note)) return;
    if (mode === 'undo' && !/Undo gone/.test(note) && !tooLate) check(st === 'confirmed', 'intent', 'tapped Undo in time but ended up out', `${ph.label} ${ph.who} ${day(s.startsAt)} ${note} status=${st} toasts=${JSON.stringify(toasts.map((x) => x.msg))}`);
    else if (mode === 'reload-rejoin') check(st === 'confirmed' || st === 'waitlisted' || errored, 'intent', "Drop out, reload, I'm in again: not in", `${ph.label} ${ph.who} ${day(s.startsAt)} ${note} status=${st} toasts=${JSON.stringify(toasts.map((x) => x.msg))}`);
    else if (mode === 'rejoin') check(st === 'confirmed' || st === 'waitlisted' || errored, 'intent', "Drop out then I'm in during Undo: not in", `${ph.label} ${ph.who} status=${st} toasts=${JSON.stringify(toasts.map((x) => x.msg))}`);
    else if (!errored) check(st !== 'confirmed', 'intent', `dropped out (${mode}) and Undo not tapped, but still in`, `${ph.label} ${ph.who} ${day(s.startsAt)} ${note} status=${st} toasts=${JSON.stringify(toasts.map((x) => x.msg))}`);
    // The drop banner says what happens to the money; the pot must move by that much.
    const dm = toasts.map((x) => x.msg).find((x) => /^You dropped out\./.test(x));
    const amt = dm && /\$(\d+) (credit returned|back as credit)/.exec(dm);
    if (amt && st !== 'confirmed' && mode !== 'rejoin' && !errored) {
      const delta = t.credit.balanceCents - balBefore;
      check(delta === Number(amt[1]) * 100, 'toast-money', `drop banner "${amt[0]}" but credit moved ${fmt(balBefore)} -> ${fmt(t.credit.balanceCents)}`, `${ph.label} ${ph.who} ${day(s.startsAt)} ${mode}`);
    }
  }

  // ---------- organizer actions (API) ----------
  async function orgAction(combo = false) {
    d = await dash();
    const live = d.sessions.filter((s) => s.status !== 'canceled' && Date.parse(s.endsAt) > nowMs());
    const open = live.filter((s) => Date.parse(s.startsAt) > nowMs());
    const ended = d.sessions.filter((s) => s.status !== 'canceled' && Date.parse(s.endsAt) <= nowMs() && !s.state?.finalized && !s.finalizedAt && s.roster.some((r) => r.status === 'confirmed'));
    const canceledOpen = d.sessions.filter((s) => s.status === 'canceled' && Date.parse(s.startsAt) > nowMs());
    const opts = ['court', 'court', 'max', ...(combo ? [] : ['viewAs', 'viewAs'])];
    if (open.length) opts.push('move', 'cancel');
    if (ended.length) opts.push('finalize', 'finalize');
    if (canceledOpen.length) opts.push('reopen');
    if ((d.paymentClaims || []).length) opts.push('claim');
    if ((d.refundRequests || []).length) opts.push('refund');
    if (open.length) opts.push('bot', 'bot');
    const unpaidSeats = live.flatMap((s) => s.roster.filter((x) => x.status === 'confirmed' && !x.isOrganizer && x.paymentStatus === 'unpaid').map((x) => [s, x]));
    const paidSeats = live.flatMap((s) => s.roster.filter((x) => x.status === 'confirmed' && !x.isOrganizer && x.paymentStatus === 'paid').map((x) => [s, x]));
    if (unpaidSeats.length) opts.push('markPaid', 'markPaid');
    if (paidSeats.length) opts.push('unmark');
    const act = pick(opts);
    const r = async (p) => {
      const res = await p;
      return `${res.status()}${res.ok() ? '' : ` ${(await res.text()).slice(0, 80)}`}`;
    };
    switch (act) {
      case 'viewAs': {
        // Organizer: View as a player, Drop out on a game they are in, Exit inside the Undo wait. No real seat may change.
        const snap = (dd) => JSON.stringify(dd.sessions.map((x) => [x.id, x.status, x.roster.map((y) => [y.playerId, y.status, y.paymentStatus, y.creditCents])]));
        const before = snap(d);
        const cands = live.filter((x) => Date.parse(x.startsAt) > nowMs()).flatMap((x) => x.roster.filter((y) => y.status === 'confirmed' && !y.isOrganizer).map((y) => [x, y]));
        if (!cands.length) return 'ORG view as: nobody in a game';
        const [gs, who] = pick(cands);
        const exitAt = ri(300, 4500);
        const page = await adminCtx.newPage();
        let note = '';
        try {
          await page.goto(`${BASE}/admin`);
          await page.getByRole('button', { name: 'View as…' }).click({ timeout: 8000 });
          await page.locator('dialog[open]').getByRole('button', { name: who.name, exact: true }).click({ timeout: 4000 });
          await page.getByRole('region', { name: 'Viewing as a player' }).waitFor({ timeout: 6000 });
          const r0 = page.locator(`#row-${gs.id}`);
          await r0.waitFor({ timeout: 6000 });
          const dropped = (await tap(r0.getByRole('button', { name: 'Drop out' }))) && (await tap(page.locator('dialog[open]').getByRole('button', { name: 'Drop out' })));
          await sleep(exitAt);
          await page.getByRole('region', { name: 'Viewing as a player' }).getByRole('button', { name: 'Exit' }).click({ timeout: 2000 });
          note = dropped ? '' : ' (no Drop out on the demo card)';
        } catch (err) {
          note = ` (harness: ${String(err.message).split('\n')[0].slice(0, 80)})`;
        }
        await sleep(6500);
        await page.close().catch(() => {});
        const after = snap(await dash());
        check(before === after, 'view-as', `View as ${who.name}, Drop out, Exit at ${exitAt}ms changed a real seat`, `${day(gs.startsAt)}`);
        return `ORG view as ${who.name}, Drop out ${day(gs.startsAt)}, Exit @${exitAt}ms${note}`;
      }
      case 'court': {
        const s = pick(live.length ? live : d.sessions);
        const to = pick(['not_booked', 'waitlist', 'booked', 'booked']);
        return `ORG court ${day(s.startsAt)} -> ${to}: ${await r(post(A, `/api/admin/sessions/${s.id}/court-status`, { status: to }))}`;
      }
      case 'max': {
        maxPlayers = Math.max(4, Math.min(10, maxPlayers + pick([-2, -1, -1, 1, 1, 2, 3])));
        return `ORG max players -> ${maxPlayers}: ${await r(A.put(BASE + '/api/admin/group', { data: { settings: { maxPlayers } }, headers: { Origin: BASE } }))}`;
      }
      case 'move': {
        const s = pick(open);
        const len = Date.parse(s.endsAt) - Date.parse(s.startsAt);
        const st = Date.parse(s.startsAt) + pick([-60, -30, 30, 60, 90, -90]) * 60_000;
        return `ORG move ${day(s.startsAt)} -> ${day(new Date(st).toISOString())}: ${await r(A.put(`${BASE}/api/admin/sessions/${s.id}/time`, { data: { startsAt: new Date(st).toISOString(), endsAt: new Date(st + len).toISOString() }, headers: { Origin: BASE } }))}`;
      }
      case 'cancel': {
        const s = pick(open);
        return `ORG cancel ${day(s.startsAt)}: ${await r(post(A, `/api/admin/sessions/${s.id}/decision`, { decision: 'cancel', confirm: true, reason: pick(['Rain', 'Thanksgiving', '']), chargedCents: 0 }))}`;
      }
      case 'reopen': {
        const s = pick(canceledOpen);
        return `ORG reopen ${day(s.startsAt)}: ${await r(post(A, `/api/admin/sessions/${s.id}/decision`, { decision: 'reopen' }))}`;
      }
      case 'finalize': {
        const s = pick(ended);
        const ins = s.roster.filter((x) => x.status === 'confirmed').map((x) => x.playerId);
        const body = chance(0.6) ? { everyone: true } : { played: ins.filter(() => chance(0.75)) };
        return `ORG finalize ${day(s.startsAt)} ${body.everyone ? 'everyone' : `${body.played.length}/${ins.length} played`}: ${await r(post(A, `/api/admin/sessions/${s.id}/finalize`, body))}`;
      }
      case 'claim': {
        const c = pick(d.paymentClaims);
        const paid = chance(0.6);
        return `ORG claim ${c.name || c.playerId} ${paid ? 'confirm' : 'clear'}: ${await r(post(A, `/api/admin/sessions/${c.sessionId}/claim`, { playerId: c.playerId, paid }))}`;
      }
      case 'refund': {
        const q = pick(d.refundRequests);
        const action = pick(['refunded', 'not_now']);
        return `ORG cash out ${action} ${fmt(q.cents ?? q.amountCents ?? 0)}: ${await r(post(A, `/api/admin/refund-requests/${q.id}`, { action, cents: q.cents ?? q.amountCents }))}`;
      }
      case 'markPaid':
      case 'unmark': {
        const [s, x] = pick(act === 'markPaid' ? unpaidSeats : paidSeats);
        return `ORG ${act} ${x.name} ${day(s.startsAt)}: ${await r(post(A, `/api/admin/sessions/${s.id}/payment`, { playerId: x.playerId, paid: act === 'markPaid', seen: x.moneySeen }))}`;
      }
      case 'bot': {
        const s = pick(open);
        const b = pick(bots);
        const inIt = s.roster.some((x) => x.playerId === idOf(b) && ['confirmed', 'waitlisted'].includes(x.status));
        if (inIt) return `bot ${b} drops ${day(s.startsAt)}: ${await r(post(api[b], `/api/sessions/${s.id}/withdraw`, {}))}`;
        return `bot ${b} joins ${day(s.startsAt)}: ${await r(post(api[b], `/api/sessions/${s.id}/join`, {}))}`;
      }
    }
    return act;
  }

  // ---------- the fake clock jumps (forward only) ----------
  async function clockAction() {
    d = await dash();
    const n = nowMs();
    const pts = [...DST];
    for (const s of d.sessions) {
      if (s.status === 'canceled') continue;
      const st = Date.parse(s.startsAt);
      const en = Date.parse(s.endsAt);
      pts.push(st - 12 * 3600_000 - 20_000, st - 12 * 3600_000 + 20_000, st - 25_000, st + 30_000, en + 60_000);
      const mid = new Date(new Date(st).toLocaleDateString('en-CA', { timeZone: 'America/Detroit' }) + 'T00:00:00-05:00').getTime() + 86_400_000; // about midnight after
      pts.push(mid - 30_000, mid + 30_000);
    }
    const next = pts.filter((p) => p > n + 5_000).sort((a, b) => a - b);
    const to = chance(0.2) || !next.length ? n + ri(5, 180) * 60_000 : next[Math.min(next.length - 1, ri(0, 4))];
    await setClock(to);
    return `CLOCK -> ${day(new Date(to).toISOString())} (${new Date(to).toISOString()})`;
  }

  // ---------- the checks after every step ----------
  async function checkBooks() {
    d = await dash();
    const orgBal = new Map((d.creditLedger || []).map((c) => [c.playerId, c.balanceCents]));
    for (const n of NAMES) {
      const g = await truthOf(api[n], n);
      if (!g) continue;
      if (n === ORGANIZER) {
        check(g.credit.balanceCents === 0 && g.sessions.every((s) => !s.mine || (!s.mine.creditCents && !s.mine.useCreditCents)), 'books', 'organizer has credit or uses credit', JSON.stringify(g.credit));
        continue;
      }
      const hist = g.credit.history;
      const sum = hist.filter((e) => !e.endedAt).reduce((a, e) => a + (e.kind === 'kept' ? e.cents : -e.cents), 0);
      check(g.credit.balanceCents === sum, 'books', `${n}'s pot ${fmt(g.credit.balanceCents)} != visible history ${fmt(sum)}`, JSON.stringify(hist.slice(0, 8)));
      check(sum >= 0, 'books', `${n}'s credit below $0 (${fmt(sum)})`, JSON.stringify(hist.slice(0, 8)));
      check(g.credit.usableCents <= g.credit.balanceCents && g.credit.usableCents >= 0, 'books', `${n} usable ${fmt(g.credit.usableCents)} vs pot ${fmt(g.credit.balanceCents)}`);
      if (g.credit.pending) check(g.credit.pending.cents <= g.credit.balanceCents, 'books', `${n} cash out ${fmt(g.credit.pending.cents)} above pot ${fmt(g.credit.balanceCents)}`);
      check((orgBal.get(idOf(n)) ?? 0) === g.credit.balanceCents, 'books', `${n}: organizer sees ${fmt(orgBal.get(idOf(n)) ?? 0)}, player sees ${fmt(g.credit.balanceCents)}`);
      for (const s of g.sessions) {
        const m = s.mine;
        if (!m) continue;
        const out = m.status !== 'confirmed' || s.canceled;
        if (out) check(!m.creditCents && !m.paidEarlierCents, 'books', `credit/cash left on a seat that is out (${m.status}${s.canceled ? ', canceled' : ''})`, `${n} ${day(s.startsAt)} ${JSON.stringify(m)}`);
        else if (m.paymentStatus === 'unpaid' && m.shareCents != null) {
          check(m.oweCents === Math.max(0, m.shareCents - m.creditCents - m.paidEarlierCents), 'books', `owe ${fmt(m.oweCents)} != price ${fmt(m.shareCents)} - credit ${fmt(m.creditCents)} - earlier ${fmt(m.paidEarlierCents)}`, `${n} ${day(s.startsAt)}`);
          if (g.credit.usableCents > 0 && m.oweCents > 0 && !s.finalized) check(m.useCreditCents > 0, 'books', `${n} has ${fmt(g.credit.usableCents)} usable credit and owes ${fmt(m.oweCents)} but no Use credit is offered`, `${day(s.startsAt)} ${JSON.stringify(m)}`);
        }
      }
    }
    // The organizer's view of every seat: nothing left on a seat that left or a canceled game, except an unconfirmed I paid.
    for (const s of d.sessions) {
      for (const r of s.roster) {
        if (r.isOrganizer) continue;
        const out = r.status !== 'confirmed' || s.status === 'canceled';
        if (!out) continue;
        check(!r.creditCents && !r.paidEarlierCents, 'books', `organizer view: credit left on ${r.name}'s ${r.status} seat${s.status === 'canceled' ? ' (canceled game)' : ''}`, `${day(s.startsAt)} credit=${r.creditCents} earlier=${r.paidEarlierCents}`);
        check(!(r.paymentStatus === 'paid' && !r.refundedAt && !r.selfPaid), 'books', `cash still counted on ${r.name}'s ${r.status} seat${s.status === 'canceled' ? ' (canceled game)' : ''} (not credited back, not a claim)`, `${day(s.startsAt)} ${JSON.stringify({ pay: r.paymentStatus, amt: r.paymentAmountCents, refundedAt: r.refundedAt })}`);
      }
    }
  }

  async function screenState(ph) {
    return ph.page.evaluate(() => {
      const vis = (el) => !!el && !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length) && getComputedStyle(el).visibility !== 'hidden';
      const rows = [...document.querySelectorAll('article.sched')].filter((a) => !a.classList.contains('leaving')).map((a) => ({
        id: a.id.slice(4),
        mine: a.dataset.mine || '',
        paid: !!a.querySelector('[data-paid]'),
        paidText: a.querySelector('[data-paid]')?.textContent || '',
        owe: a.querySelector('[data-owe]')?.textContent || '',
        pay: !!a.querySelector('a[aria-label^="Pay "]'),
        useCredit: !!a.querySelector('[data-use-credit]'),
        iPaid: [...a.querySelectorAll('button')].some((b) => b.textContent.trim() === 'I paid'),
        status: a.querySelector('.sched-status')?.textContent || '',
        text: a.textContent.slice(0, 300),
      }));
      const top = document.querySelector('section[aria-label="Payment"]');
      const chip = document.querySelector('[data-credit-chip]');
      const alerts = [...document.querySelectorAll('[role="alert"]')].filter(vis).map((e) => e.textContent.slice(0, 120));
      const popErr = [...document.querySelectorAll('.pop-error')].filter(vis).map((e) => e.textContent.slice(0, 120));
      const danger = [...document.querySelectorAll('.notice-danger, [data-tone="danger"]')].filter(vis).map((e) => e.textContent.slice(0, 120));
      return {
        title: document.querySelector('header h1, .topbar h1, h1')?.textContent?.trim() || '',
        picking: !!document.querySelector('section[aria-label="Pick your name"]'),
        rows,
        top: top ? { pay: !!top.querySelector('a[aria-label^="Pay "]'), useCredit: !!top.querySelector('[data-use-credit]'), iPaid: [...top.querySelectorAll('button')].some((b) => b.textContent.trim() === 'I paid'), text: top.textContent.slice(0, 200) } : null,
        chip: chip ? chip.getAttribute('aria-label') : null,
        alerts,
        popErr,
        danger,
        sw: document.documentElement.scrollWidth,
        iw: window.innerWidth,
        dialog: !!document.querySelector('dialog[open]'),
      };
    });
  }

  function compare(ph, g, dom) {
    const probs = [];
    if (dom.sw > dom.iw) probs.push(['look', `sideways scroll ${dom.sw} > ${dom.iw} at ${ph.w}px`]);
    if (dom.alerts.length) probs.push(['error-card', `red error card stays: ${dom.alerts[0]}`]);
    if (dom.popErr.length) probs.push(['error-card', `red error banner stays: ${dom.popErr[0]}`]);
    if (dom.picking || !g.me) return probs;
    if (!dom.title.includes(g.me.name)) probs.push(['identity', `screen title "${dom.title}" but server says ${g.me.name}`]);
    const isOrg = g.me.name === ORGANIZER;
    const bal = g.credit.balanceCents;
    if (!isOrg) {
      const wantChip = bal > 0 || !!g.credit.pending;
      if (wantChip !== !!dom.chip) probs.push(['screen', `credit chip ${dom.chip ? 'shown' : 'missing'} with pot ${fmt(bal)}${g.credit.pending ? ' (cash out pending)' : ''}`]);
      else if (dom.chip && !dom.chip.startsWith(`${fmt(bal)} credit`)) probs.push(['screen', `credit chip "${dom.chip}" but pot is ${fmt(bal)}`]);
    }
    const byId = new Map(g.sessions.map((s) => [s.id, s]));
    for (const r of dom.rows) {
      const s = byId.get(r.id);
      if (!s) {
        probs.push(['screen', `card for a game the server no longer lists`]);
        continue;
      }
      const m = s.mine;
      const st = m && m.status;
      if (st === 'waitlisted') continue; // drawn as in when a court is not booked and there is room (courtDisplay)
      const inExp = st === 'confirmed' && !s.canceled;
      if ((r.mine === 'in') !== inExp) probs.push(['screen', `${day(s.startsAt)}: card says ${r.mine === 'in' ? 'in' : 'not in'}, server ${st || 'none'}${s.canceled ? ' (canceled)' : ''}`]);
      if (!inExp || isOrg) continue;
      if (r.paid !== (m.paymentStatus === 'paid')) probs.push(['screen', `${day(s.startsAt)}: card ${r.paid ? `shows "${r.paidText}"` : 'not paid'}, server ${m.paymentStatus}`]);
      if (m.paymentStatus === 'paid' && r.paid && m.paidWithCredit !== /credit/.test(r.paidText)) probs.push(['screen', `${day(s.startsAt)}: "${r.paidText}" but paidWithCredit=${m.paidWithCredit}`]);
      const booked = s.bookingStatus === 'booked';
      const onTop = g.payDue.some((o) => o.sessionId === s.id);
      if (m.paymentStatus === 'unpaid' && booked && m.oweCents > 0) {
        if (!r.owe.includes(`${fmt(m.oweCents)} due`)) probs.push(['screen', `${day(s.startsAt)}: chip "${r.owe}" but server owes ${fmt(m.oweCents)}`]);
        const way = r.pay || r.useCredit || r.iPaid || (onTop && dom.top && (dom.top.pay || dom.top.useCredit || dom.top.iPaid));
        if (!way) probs.push(['no-way-to-pay', `${day(s.startsAt)}: joined, unpaid, court booked, owes ${fmt(m.oweCents)}, but no Pay / Use credit / I paid on screen`]);
      }
      if (m.paymentStatus === 'unpaid' && !booked && m.useCreditCents > 0 && !r.useCredit) probs.push(['no-way-to-pay', `${day(s.startsAt)}: court not booked, ${fmt(m.useCreditCents)} credit usable, no Use credit button`]);
      // (A game whose court is not booked never shows Pay: the phone leaves it off the top card on purpose.)
      if (onTop && booked && !dom.top) probs.push(['no-way-to-pay', `${day(s.startsAt)}: server payDue but no Payment card on top`]);
    }
    return probs;
  }

  async function checkScreens() {
    await Promise.all(
      phonesList.map(async (ph) => {
        if (!ph.page || ph.page.isClosed()) return;
        // Close what this harness left open (a sheet, a dialog) so the cards show.
        await ph.page.keyboard.press('Escape').catch(() => {});
        const until = Date.now() + SETTLE_MS;
        let probs = [];
        let g = null;
        let dom = null;
        while (true) {
          // A finger on the screen: the live refresh wakes up if it slept (a big clock jump looks like hours idle).
          await ph.page.evaluate(() => window.dispatchEvent(new Event('wheel'))).catch(() => {});
          g = await ph.ctx.request.get(`${BASE}/api/group`).then((r) => r.json()).catch(() => null);
          dom = await screenState(ph).catch(() => null);
          if (!g || !dom) {
            probs = [['harness', 'could not read the phone']];
          } else {
            probs = compare(ph, g, dom);
          }
          if (!probs.length || Date.now() > until) break;
          await sleep(700);
        }
        totalChecks += 6;
        if (process.env.DEBUG && ph.label === 'P1') console.log('   P1 screen', JSON.stringify(dom && { title: dom.title, chip: dom.chip, top: dom.top, rows: dom.rows.map((r) => ({ ...r, text: undefined })) }));
        for (const [kind, msg] of probs) fail(kind, msg, `${ph.label} (${ph.w}px) as ${g && g.me ? g.me.name : '?'}; server ${g ? JSON.stringify(g.sessions.map((s) => [day(s.startsAt), s.bookingStatus, s.canceled ? 'X' : '', s.mine ? `${s.mine.status}/${s.mine.paymentStatus}/owe${s.mine.oweCents}/cr${s.mine.creditCents}/use${s.mine.useCreditCents}` : '-'])) : ''} pot ${g ? fmt(g.credit.balanceCents) : '?'}; screen ${dom ? JSON.stringify(dom.rows.map((r) => [r.mine, r.paidText, r.owe, r.pay, r.useCredit, r.status])) : ''}`);
      }),
    );
  }

  // ---------- steps ----------
  for (curStep = 1; curStep <= STEPS; curStep++) {
    if (Date.now() - t0 > BUDGET_MS + 60_000) break;
    const r = rnd();
    let line;
    try {
      if (r < 0.55) {
        const live = phonesList.filter((p) => p.page && !p.page.isClosed());
        const ph = pick(live);
        if (chance(0.12)) {
          // Organizer changes the game at the same moment as the tap.
          const [a, b] = await Promise.all([playerAction(ph), orgAction(true)]);
          line = `${a}  ||  ${b}`;
        } else {
          const since = await browserNow(ph);
          line = await playerAction(ph);
          const ts = await toastsOf(ph, since);
          if (ts.length) line += `  {banners: ${ts.map((x) => (x.error ? '!' : '') + x.msg).join(' / ')}}`;
        }
      } else if (r < 0.8) line = await orgAction();
      else line = await clockAction();
    } catch (err) {
      line = `step error: ${String(err && err.message).slice(0, 160)}`;
      fail('harness', 'step threw', line);
    }
    stepLog.push(`#${curStep} ${line}`);
    console.log(`seed ${seed} #${curStep} ${line}`);
    totalSteps++;
    await checkBooks();
    await checkScreens();
  }
  totalSequences++;
  for (const c of allContexts) await c.close().catch(() => {});
  for (const n of NAMES) await api[n].dispose().catch(() => {});
  await adminCtx.close().catch(() => {});
  allContexts = [];
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
