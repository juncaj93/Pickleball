/* Audit 73 (looks only, find and report, no fixes): every tournament screen at 420/390/360/320, light and dark, Christmas skin off and on.
 *
 *   env -u TELEGRAM_BOT_TOKEN -u CLOUDFLARE_API_TOKEN node e2e/audit73-looks.cjs        (AUDIT_ONLY=<substring> runs only matching screens;
 *                                                                                         AUDIT_SKIN=off|on runs one skin pass)
 * Its own fake world and dev server (port 5741 by default), a db file under .data/audit73-looks/. Screenshots and results.json there too.
 * Nothing here touches the live site.
 */
const { spawn, spawnSync } = require('node:child_process');
const { readFileSync, writeFileSync, mkdirSync, rmSync } = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { findClipping } = require('./clip-check.cjs');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.E2E_PORT) || 5741;
const BASE = `http://localhost:${PORT}`;
const OUT = path.join(ROOT, '.data', 'audit73-looks');
const SHOTS = path.join(OUT, 'shots');
const SEED_ISO = '2026-11-30T14:00:00.000Z';
const MORNING = Date.parse('2026-11-30T15:00:00.000Z'); // Mon Nov 30, 10:00 AM Eastern
const NIGHT = Date.parse('2026-12-02T01:00:00.000Z'); // Tue Dec 1, 8:00 PM Eastern
const PIN = /PIN `(\d{6})`/.exec(readFileSync(path.join(ROOT, 'docs/PREVIEW_FAKE_DB.md'), 'utf8'))[1];
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const WIDTHS = [420, 390, 360, 320];
const SCHEMES = ['light', 'dark'];
const ONLY = process.env.AUDIT_ONLY || '';
const SKINS = process.env.AUDIT_SKIN ? [process.env.AUDIT_SKIN] : ['off', 'on'];
let ONLY_SKIP_ADMIN = false;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const NAMES = ['Christopher Vanderberg', 'Christopher', 'Parker', 'Rowan', 'Sage', 'Wren', 'Quinn', 'Vic', 'Zoe', 'Reese', 'Alex', 'Net Ninjas', 'Dill With It', 'Kitchen Crew', 'Third Shot Gang'];

/** In the page: everything this audit looks for. */
function analyze(opt) {
  const W = window.innerWidth;
  const out = [];
  const label = (el) => {
    const c = typeof el.className === 'string' ? el.className.trim().split(/\s+/).slice(0, 3).join('.') : '';
    const d = [...el.attributes].filter((a) => a.name.startsWith('data-')).slice(0, 2).map((a) => `[${a.name}${a.value ? '=' + a.value.slice(0, 20) : ''}]`).join('');
    return `${el.tagName.toLowerCase()}${c ? '.' + c : ''}${d}`;
  };
  const shown = (el) => {
    for (let d = el.closest('details'); d; d = d.parentElement && d.parentElement.closest('details')) {
      if (d.open) continue;
      const sum = d.querySelector(':scope > summary');
      if (!sum || !sum.contains(el)) return false;
    }
    for (let a = el; a; a = a.parentElement) {
      const cs = getComputedStyle(a);
      if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false;
    }
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const de = document.documentElement;
  if (de.scrollWidth > W + 0.5) {
    const wide = [...document.body.querySelectorAll('*')].filter((e) => {
      const r = e.getBoundingClientRect();
      return r.width > 0 && r.right > W + 1;
    });
    const leaf = wide.filter((e) => ![...e.children].some((c) => c.getBoundingClientRect().right > W + 1)).slice(0, 4);
    out.push({ k: 'hscroll', m: `page ${de.scrollWidth}px wide on ${W}px`, el: leaf.map((e) => `${label(e)} right=${Math.round(e.getBoundingClientRect().right)} «${(e.textContent || '').trim().slice(0, 30)}»`).join(' | ') });
  }
  const bodyFont = getComputedStyle(document.body).fontFamily;
  const parse = (c) => {
    const m = c.match(/[\d.]+/g);
    if (!m) return null;
    const k = /^color\(/.test(c) ? 255 : 1;
    const nums = /^color\(/.test(c) ? m.slice(0) : m;
    return { r: +nums[0] * k, g: +nums[1] * k, b: +nums[2] * k, a: nums.length > 3 ? +nums[3] : 1 };
  };
  const lum = ({ r, g, b }) => {
    const f = (v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const ratio = (a, b) => {
    const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
  };
  const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const seen = new Set();
  for (let n = tw.nextNode(); n; n = tw.nextNode()) {
    const t = n.textContent.replace(/\s+/g, ' ').trim();
    if (!t) continue;
    const el = n.parentElement;
    if (!el || el.closest('svg, script, style, noscript, .sr-only, .tabbar, [data-tour-ticker]')) continue;
    if (!shown(el)) continue;
    const cs = getComputedStyle(el);
    // Lines this text node takes (per word).
    const re = /\S+/g;
    const lines = [];
    let m;
    while ((m = re.exec(n.textContent))) {
      const r = document.createRange();
      r.setStart(n, m.index);
      r.setEnd(n, m.index + m[0].length);
      const rect = [...r.getClientRects()].filter((x) => x.width > 0.5)[0];
      if (!rect) continue;
      const last = lines[lines.length - 1];
      if (last && Math.abs(last.top - rect.top) < 4) last.words.push(m[0]);
      else lines.push({ top: rect.top, words: [m[0]] });
    }
    if (lines.length > 1 && t.length <= 70) {
      const lastLine = lines[lines.length - 1].words.join(' ');
      const orphan = /^(AM|PM|pts|pt|[+−-]?\$?\d+([.,:]\d+)?%?|\d+[–-]\d+|[+−-]?\d+ pts|\$\d+(\.\d\d)?|·)$/.test(lastLine);
      const row = el.closest(opt.rowSel);
      const key = `w|${label(el)}|${t}`;
      if (!seen.has(key)) {
        seen.add(key);
        if (orphan) out.push({ k: 'orphan', m: `"${t}" leaves "${lastLine}" alone on line ${lines.length}`, el: label(el) });
        else if (row) out.push({ k: 'rowwrap', m: `"${t.slice(0, 60)}" wraps to ${lines.length} lines inside a row`, el: `${label(el)} in ${label(row)}` });
      }
    }
    // Names and numbers in the display font.
    const isName = opt.names.some((nm) => t === nm || t.startsWith(nm + ' ') || t.includes(' ' + nm) || t.includes(nm + ' +') || t.includes('+ ' + nm));
    const isNum = /\$\d|\d:\d\d|\b(AM|PM)\b|\bpts\b|^[+−-]?\d+([.,]\d+)?$|\d+[–-]\d+/.test(t);
    const tour = el.closest('[class*="tc-"], .tc, [class*="tm-"], [class*="tour"], [data-tournament], [data-tc-day], dialog[open], .toast') && !el.closest('.topbar');
    if (tour && (isName || isNum) && /Bricolage/i.test(cs.fontFamily) && !/Bricolage/i.test(bodyFont)) {
      const key = `f|${label(el)}|${t}`;
      if (!seen.has(key)) {
        seen.add(key);
        const head = el.closest('h1, h2, h3, h4, .ac-title, .sheet-head, .sheet-title, dialog header');
        out.push({ k: head ? 'font-heading' : 'font', m: `"${t.slice(0, 50)}" in the display font (${Math.round(parseFloat(cs.fontSize))}px ${cs.fontWeight})`, el: label(el) + (head ? ` in ${label(head)}` : '') });
      }
    }
    // Contrast: the text color (with opacity) over the nearest solid background.
    let fg = parse(cs.color);
    if (fg) {
      let op = 1;
      let bg = null;
      let unknown = false;
      for (let a = el; a; a = a.parentElement) {
        const acs = getComputedStyle(a);
        op *= Number(acs.opacity);
        if (!bg) {
          if (acs.backgroundImage && acs.backgroundImage !== 'none') {
            unknown = true;
            break;
          }
          const c = parse(acs.backgroundColor);
          if (c && c.a > 0.85) bg = c;
        }
      }
      if (!bg && !unknown) bg = parse(getComputedStyle(document.documentElement).backgroundColor) || { r: 255, g: 255, b: 255, a: 1 };
      if (!unknown && bg) {
        const al = fg.a * op;
        const mix = { r: fg.r * al + bg.r * (1 - al), g: fg.g * al + bg.g * (1 - al), b: fg.b * al + bg.b * (1 - al) };
        const cr = ratio(mix, bg);
        const big = parseFloat(cs.fontSize) >= 18.6 && Number(cs.fontWeight) >= 600;
        const disabled = el.closest('button:disabled, [aria-disabled="true"]');
        if (cr < (big ? 2.2 : 3) && !disabled) {
          const key = `c|${label(el)}|${t}`;
          if (!seen.has(key)) {
            seen.add(key);
            out.push({ k: 'contrast', m: `"${t.slice(0, 40)}" contrast ${cr.toFixed(2)} (${cs.color} op ${op.toFixed(2)} on rgb(${bg.r},${bg.g},${bg.b}))`, el: label(el) });
          }
        }
      }
    }
  }
  // Elements that hide their overflow and hold more than they show.
  for (const el of document.body.querySelectorAll('*')) {
    if (el.closest('svg, .sr-only, .tabbar, [data-tour-ticker]')) continue;
    const cs = getComputedStyle(el);
    const hides = /hidden|clip/.test(cs.overflowX) || cs.textOverflow === 'ellipsis';
    if (!hides) continue;
    const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
    if (!t || !shown(el)) continue;
    if (el.scrollWidth > el.clientWidth + 1 && /hidden|clip/.test(cs.overflowX)) {
      out.push({ k: cs.textOverflow === 'ellipsis' ? 'ellipsis' : 'clip', m: `"${t.slice(0, 50)}" shows ${el.clientWidth} of ${el.scrollWidth}px`, el: label(el) });
    }
  }
  return out;
}

const ROW_SEL = [
  '.tm-row', '.tm-rows > *', '[data-tm-row]', '[data-tc-day-game]', '[data-tc-day-stand]', '[data-tm-result]', '[data-tc-round]', '[data-tm-end-row]', '.tc-bar',
  '.tc-stub', '[data-tm-fin-row]', '.tm-fin-row', '[data-tm-projected-team]', '[data-tm-team]', '[data-tm-player]', '[data-tm-money-line]', '[data-tm-row-money]',
  '[data-pay-countdown]', '.tc-gd-vs', '[data-tm-schedule-row]', '.toast', '[data-tm-am-row]', '[data-tc-am-stand]', '.tm-gd-row', '.tc-gd-row',
].join(', ');

async function main() {
  mkdirSync(SHOTS, { recursive: true });
  const dbFile = path.join(OUT, `audit73-${PORT}.sqlite`);
  rmSync(dbFile, { force: true });
  const seeded = spawnSync('npx', ['vite-node', 'scripts/load-small-local.ts', '--', dbFile, SEED_ISO, '--calm', '--zip55', '--zip60', '--zip66'], { cwd: ROOT, encoding: 'utf8' });
  if (seeded.status !== 0) throw new Error(`could not build the calm world: ${seeded.stderr || seeded.stdout}`);
  if (await fetch(`${BASE}/api/status`).then((r) => r.ok, () => false)) throw new Error(`port ${PORT} is already in use`);
  const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
    cwd: ROOT,
    env: { ...process.env, DEV_DB: dbFile, SETUP_TOKEN: 'audit73-setup-token-0123456789', DEV_CLOCK: '1', PREVIEW_CALM: 'on', PB_PREVIEW_BUILD: '1', TELEGRAM_BOT_TOKEN: '', TELEGRAM_CHAT_ID: '' },
    stdio: 'ignore',
    detached: true,
  });
  const kill = () => {
    try {
      process.kill(-server.pid, 'SIGTERM');
    } catch {}
  };
  process.on('exit', kill);
  for (let i = 0; i < 120; i++) {
    if (await fetch(`${BASE}/api/status`).then((r) => r.ok, () => false)) break;
    await sleep(500);
  }
  let nowMs = MORNING;
  const setClock = async (ms) => {
    nowMs = ms;
    await fetch(`${BASE}/__dev/clock`, { method: 'POST', body: JSON.stringify({ atMs: ms }) });
  };
  await setClock(MORNING);
  const browser = await chromium.launch();
  const admin = await browser.newContext();
  if (!(await admin.request.post(BASE + '/api/admin/login', { data: { pin: PIN }, headers: { Origin: BASE } })).ok()) throw new Error('admin login');
  const adminCookies = await admin.cookies();
  const call = async (method, url, data) => {
    const r = await admin.request.fetch(BASE + url, { method, data, headers: { Origin: BASE } });
    if (!r.ok()) throw new Error(`${method} ${url}: ${r.status()} ${await r.text()}`);
    return r.json();
  };
  const stage = (s) => call('POST', '/api/admin/tournament-test', { stage: s });

  const results = [];
  const record = (label, issues, shot) => {
    results.push({ label, issues, shot });
    const n = issues.filter((i) => !/^(font-heading)$/.test(i.k)).length;
    console.log(`  ${n ? '✗' : '✓'} ${label}${n ? ` (${n})` : ''}`);
    for (const i of issues) console.log(`      ${i.k}: ${i.m}  <${i.el || ''}>`);
  };

  async function newPage({ width = 390, scheme = 'light', organizer = false, skin = 'off' } = {}) {
    const ctx = await browser.newContext({ viewport: { width, height: 844 }, deviceScaleFactor: 1, colorScheme: scheme, isMobile: true, hasTouch: true, userAgent: UA, reducedMotion: 'reduce' });
    await ctx.addInitScript(
      ([delta, skinOn]) => {
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
        try {
          localStorage.setItem('pb_xmas_hint', '1');
          localStorage.setItem('pb_xmas_back', '1');
          if (skinOn) localStorage.setItem('pb_xmas_theme', 'on');
          else localStorage.removeItem('pb_xmas_theme');
        } catch {}
      },
      [nowMs - Date.now(), skin === 'on'],
    );
    if (organizer) await ctx.addCookies(adminCookies.map((c) => ({ ...c })));
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => {
      if (m.type() === 'error' && !/Failed to load resource|favicon/.test(m.text())) errors.push('console: ' + m.text().slice(0, 200));
    });
    return { ctx, page, errors };
  }
  async function playerPage(who, opts) {
    const p = await newPage(opts);
    await p.page.goto(`${BASE}/?as=${encodeURIComponent(who)}`);
    await p.page.locator('.schedule, [data-tc-day], [data-tournament], .tc-short').first().waitFor({ timeout: 30000 });
    await p.page.reload();
    await p.page.locator('.schedule, [data-tc-day], [data-tournament], .tc-short').first().waitFor({ timeout: 30000 });
    await p.page.waitForTimeout(900);
    return p;
  }
  async function adminHome(opts) {
    const p = await newPage({ ...opts, organizer: true });
    await p.page.goto(`${BASE}/admin`);
    await p.page.locator('.tabbar').first().waitFor({ timeout: 30000 });
    await p.page.waitForTimeout(1200);
    return p;
  }
  const openCard = async (page) => {
    const t = page.locator('[data-tm-home-toggle][aria-expanded="false"]');
    if (await t.count()) {
      await t.first().click();
      await page.waitForTimeout(400);
    }
  };

  /** Audit the open page at every width (resizing the same page), screenshot each. */
  async function sweep(p, label, { widths = WIDTHS, skinCheck = null } = {}) {
    for (const w of widths) {
      await p.page.setViewportSize({ width: w, height: 844 });
      await p.page.waitForTimeout(260);
      const issues = await p.page.evaluate(analyze, { names: NAMES, rowSel: ROW_SEL });
      const clip = await p.page.evaluate(findClipping, { root: 'body' }).catch((e) => [`clip-check failed: ${e.message}`]);
      for (const c of clip) issues.push({ k: 'clipcheck', m: c });
      if (skinCheck) {
        const attr = await p.page.evaluate(() => document.documentElement.getAttribute('data-skin'));
        if (skinCheck === 'on' && attr !== 'christmas') issues.push({ k: 'skin', m: `the Christmas theme is not on (data-skin=${attr})` });
        if (skinCheck === 'admin' && attr) issues.push({ k: 'skin', m: `an admin screen carries data-skin=${attr}` });
      }
      for (const e of p.errors.splice(0)) issues.push({ k: 'error', m: e });
      const shot = path.join(SHOTS, `${label}-${w}.png`.replace(/[^\w.-]+/g, '_'));
      const sheet = await p.page.locator('dialog[open]').count();
      await p.page.screenshot({ path: shot, fullPage: !sheet }).catch(() => {});
      record(`${label} @${w}`, issues, shot);
    }
  }

  const run = async (label, fn) => {
    if (ONLY && !new RegExp(ONLY).test(label)) return;
    if (ONLY_SKIP_ADMIN && label.startsWith('O-')) return;
    try {
      await fn();
    } catch (e) {
      record(`${label} (could not reach)`, [{ k: 'unreached', m: String(e.message || e).slice(0, 300) }], null);
    }
  };

  /** A player screen: stage, page, optional steps, sweep. For both schemes and the current skin. */
  async function playerScreen(skin, st, who, name, steps, { clock = MORNING, before } = {}) {
    for (const scheme of SCHEMES) {
      const label = `P-${name}-${who.split(' ')[0]}-${scheme}-skin${skin}`;
      await run(label, async () => {
        await setClock(clock);
        await stage(st);
        if (before) await before();
        const p = await playerPage(who, { scheme, skin });
        try {
          if (steps) await steps(p.page);
          await sweep(p, label, { skinCheck: skin === 'on' ? 'on' : null });
        } finally {
          await p.ctx.close();
        }
      });
    }
  }
  async function adminScreen(st, name, steps, { clock = MORNING, before } = {}) {
    for (const scheme of SCHEMES) {
      const label = `O-${name}-${scheme}`;
      await run(label, async () => {
        await setClock(clock);
        await stage(st);
        if (before) await before();
        const p = await adminHome({ scheme });
        try {
          if (steps) await steps(p.page);
          await sweep(p, label, { skinCheck: 'admin' });
        } finally {
          await p.ctx.close();
        }
      });
    }
  }
  const scoreAs = async (who, mine, theirs, num = 1) => {
    const ctx = await browser.newContext();
    const list = (await (await ctx.request.get(BASE + '/api/group')).json()).players;
    const pl = list.find((x) => x.name === who);
    await ctx.request.post(BASE + '/api/me', { data: { playerId: pl.id }, headers: { Origin: BASE } });
    const g = (await (await ctx.request.get(BASE + '/api/group')).json()).tournament;
    const r = await ctx.request.post(BASE + '/api/tournament/game', { data: { tournamentId: g.id, num, action: 'score', mine, theirs }, headers: { Origin: BASE } });
    await ctx.close();
    if (!r.ok()) throw new Error(`score as ${who}: ${r.status()} ${await r.text()}`);
  };
  const click = async (page, sel, wait) => {
    await page.locator(sel).first().click();
    if (wait) await page.locator(wait).first().waitFor({ timeout: 8000 });
    await page.waitForTimeout(500);
  };

  for (const skin of SKINS) {
    await setClock(MORNING);
    await call('PUT', '/api/admin/christmas-skin-switch', { mode: skin === 'on' ? 'all' : 'off' });
    console.log(`\n=== Christmas skin ${skin}`);
    // Sign-up and the date vote.
    await playerScreen(skin, 'zip64_start', 'Vic', 'signup-card');
    await playerScreen(skin, 'zip64_start', 'Vic', 'signup-sheet-level', (pg) => click(pg, '[data-tc-signup]', 'dialog[open]'));
    await playerScreen(skin, 'zip64_start', 'Vic', 'signup-sheet-dates', async (pg) => {
      await click(pg, '[data-tc-signup]', 'dialog[open]');
      await click(pg, 'dialog[open] .tm-level');
      await click(pg, '[data-tm-next]');
    });
    await playerScreen(skin, 'zip64_start', 'Parker', 'signedup-card');
    await playerScreen(skin, 'vote_open', 'Christopher Vanderberg', 'vote-card');
    // Tickets.
    await playerScreen(skin, 'tickets_open', 'Vic', 'ticket-lock');
    await playerScreen(skin, 'tickets_open', 'Vic', 'lock-sheet', (pg) => click(pg, '.tc-short [data-tc-lock]', 'dialog[open]'));
    await playerScreen(skin, 'tickets_open', 'Vic', 'ipaid-after', async (pg) => {
      await click(pg, '.tc-short [data-tc-lock]', 'dialog[open]');
      await pg.locator('dialog[open]').getByRole('button', { name: /I paid/ }).first().click();
      await pg.waitForTimeout(900);
    });
    for (const st of ['pay_2d', 'pay_today', 'pay_hours', 'pay_minutes', 'pay_late']) await playerScreen(skin, st, 'Vic', `countdown-${st}`);
    await playerScreen(skin, 'pay_hours', 'Vic', 'pay-sheet', (pg) => click(pg, '[data-pay-countdown-btn]', 'dialog[open]'));
    await playerScreen(skin, 'all_locked', 'Christopher Vanderberg', 'ticket-in');
    await playerScreen(skin, 'tickets_open', 'Christopher Vanderberg', 'who-sheet', (pg) => click(pg, '.tc-short [data-tc-who]', 'dialog[open]'));
    await playerScreen(skin, 'zip70_moved', 'Vic', 'time-moved');
    await playerScreen(skin, 'zip70_late', 'Parker', 'drop-sheet-late', (pg) => click(pg, '[data-tc-drop]', 'dialog[open]'));
    await playerScreen(skin, 'missed_date', 'Sage', 'missed-date');
    await playerScreen(skin, 'style_odd', 'Parker', 'style-switched');
    // The night, Locked doubles.
    await playerScreen(skin, 'teams_published', 'Christopher Vanderberg', 'teams-published');
    await playerScreen(skin, 'zip72_scores', 'Vic', 'vs-card', null, { clock: NIGHT });
    await playerScreen(skin, 'zip72_scores', 'Christopher Vanderberg', 'vs-card', null, { clock: NIGHT });
    await playerScreen(skin, 'zip72_scores', 'Vic', 'score-sheet', (pg) => click(pg, '[data-tc-enter-score]', '[data-tc-score-sheet]'), { clock: NIGHT });
    await playerScreen(
      skin,
      'zip72_scores',
      'Vic',
      'result-banner',
      async (pg) => {
        await click(pg, '[data-tc-enter-score]', '[data-tc-score-sheet]');
        await pg.locator('[data-tc-score-num="theirs"]').fill('7');
        await pg.locator('[data-tc-score-submit]').click();
        await pg.locator('.pop.toast, .toast').first().waitFor({ timeout: 4000 });
        await pg.waitForTimeout(300);
      },
      { clock: NIGHT },
    );
    await playerScreen(skin, 'zip72_scores', 'Parker', 'games-lost', null, { clock: NIGHT, before: () => scoreAs('Vic', 11, 7) });
    await playerScreen(skin, 'zip72_scores', 'Christopher Vanderberg', 'games-standings', null, { clock: NIGHT, before: async () => { await scoreAs('Vic', 11, 7); await scoreAs('Sage', 11, 9, 2).catch(() => scoreAs('Rowan', 9, 11, 2)); } });
    await playerScreen(skin, 'zip72_circle', 'Vic', 'circle', null, { clock: NIGHT });
    await playerScreen(skin, 'tie3', 'Vic', 'tie-card', null, { clock: NIGHT });
    await playerScreen(skin, 'tie3', 'Rowan', 'tie-spin', null, { clock: NIGHT });
    await playerScreen(skin, 'final_on', 'Vic', 'final', null, { clock: NIGHT });
    await playerScreen(skin, 'final_on', 'Christopher Vanderberg', 'third', null, { clock: NIGHT });
    await playerScreen(skin, 'ended', 'Vic', 'ended', null, { clock: NIGHT });
    await playerScreen(skin, 'ended', 'Christopher Vanderberg', 'ended', null, { clock: NIGHT });
    await playerScreen(skin, 'history', 'Vic', 'history', null, { clock: NIGHT });
    await playerScreen(skin, 'backed_out', 'Vic', 'backed-out', null, { clock: NIGHT });
    // Americano.
    await playerScreen(skin, 'am_before', 'Vic', 'am-before', null, { clock: NIGHT });
    await playerScreen(skin, 'am_round3', 'Vic', 'am-round3', null, { clock: NIGHT });
    await playerScreen(skin, 'am_round3', 'Christopher Vanderberg', 'am-round3', null, { clock: NIGHT });
    await playerScreen(skin, 'am_round3', 'Vic', 'am-score-sheet', (pg) => click(pg, '[data-tc-enter-score]', '[data-tc-score-sheet]'), { clock: NIGHT });
    await playerScreen(skin, 'am_break', 'Vic', 'am-break', null, { clock: NIGHT });
    await playerScreen(skin, 'am_standings', 'Christopher Vanderberg', 'am-standings', null, { clock: NIGHT });
    await playerScreen(skin, 'am_done', 'Vic', 'am-done', null, { clock: NIGHT });
  }

  // The organizer (admin screens never get the skin; the switch is left on Everyone from the last pass when it ran).
  if (process.env.AUDIT_ADMIN === '0') ONLY_SKIP_ADMIN = true;
  console.log('\n=== Organizer');
  await adminScreen('zip70_start', 'card-start', openCard);
  await adminScreen('zip70_start', 'time-box', async (pg) => {
    await openCard(pg);
    await click(pg, '[data-tm-time-toggle]', '[data-tm-time-box]');
  });
  await adminScreen('zip70_start', 'plan-box', async (pg) => {
    await openCard(pg);
    await click(pg, '[data-tm-plan-toggle]', '[data-tm-plan-box]');
  });
  await adminScreen('zip70_loss', 'card-loss', openCard);
  await adminScreen('zip70_moved', 'card-moved', openCard);
  await adminScreen('zip70_late', 'card-late', openCard);
  let finInfo = null;
  await adminScreen('zip70_finalize', 'finalize', async (pg) => {
    await openCard(pg);
    await click(pg, '[data-tm-open-dates]');
    const f = Date.parse(finInfo.firstDate + 'T12:00:00Z') + 7 * 86400000;
    const day = new Date(f).toISOString().slice(0, 10);
    await pg.locator(`button[data-day="${day}"]`).first().click();
    await pg.locator('[data-tm-finalize]').waitFor({ timeout: 10000 });
    await pg.waitForTimeout(400);
  }, { before: async () => { finInfo = await stage('zip70_finalize'); } });
  await adminScreen('zip66_start', 'card-vote', async (pg) => {
    await openCard(pg);
    await click(pg, '[data-tm-votes-toggle]');
    await click(pg, '[data-tm-missing-toggle]');
  });
  await adminScreen('tickets_open', 'card-tickets', async (pg) => {
    await openCard(pg);
    if (await pg.locator('[data-tm-unpaid-toggle]').count()) await click(pg, '[data-tm-unpaid-toggle]');
  });
  await adminScreen('tickets_open', 'edit-page', async (pg) => {
    await openCard(pg);
    await click(pg, '[data-tm-open-edit], [data-tm-tickets]', '[data-tm-card="levels"]');
  });
  await adminScreen('zip71_teams', 'projected', async (pg) => {
    await openCard(pg);
    await click(pg, '[data-tm-open-edit], [data-tm-tickets]', '[data-tm-card="levels"]');
    await click(pg, '[data-tm-projected-toggle]', '[data-tm-projected-team]');
    await pg.locator('[data-tm-projected]').scrollIntoViewIfNeeded();
  });
  await adminScreen('backed_out', 'backed-out', null, { clock: NIGHT });
  await adminScreen('style_back', 'switch-back', openCard);
  await adminScreen('day_ready', 'draft', (pg) => click(pg, '[data-tm-draft]', '[data-tm-draft-card]'), { clock: NIGHT });
  await adminScreen(
    'day_ready',
    'draft-swap',
    async (pg) => {
      await click(pg, '[data-tm-draft]', '[data-tm-draft-card]');
      const b = pg.locator('[data-tm-player]');
      await b.nth(1).click();
      await pg.waitForTimeout(500);
    },
    { clock: NIGHT },
  );
  await adminScreen(
    'day_ready',
    'published',
    async (pg) => {
      await click(pg, '[data-tm-draft]', '[data-tm-draft-card]');
      await click(pg, '[data-tm-publish]');
      await pg.waitForTimeout(1200);
    },
    { clock: NIGHT },
  );
  await adminScreen('teams_drafted', 'teams-drafted', null, { clock: NIGHT });
  await adminScreen('zip72_scores', 'night', null, { clock: NIGHT });
  await adminScreen('mid', 'night-mid', null, { clock: NIGHT });
  await adminScreen('mid', 'fix-sheet', (pg) => click(pg, '[data-tm-fix-game]', '[data-tm-fix-sheet]'), { clock: NIGHT });
  await adminScreen('mid', 'paused', (pg) => click(pg, '[data-tm-pause]'), { clock: NIGHT });
  await adminScreen('mid', 'player-left', (pg) => click(pg, '[data-tm-player-left]', 'dialog[open]'), { clock: NIGHT });
  await adminScreen('tie3', 'tie', null, { clock: NIGHT });
  await adminScreen('final_on', 'final-on', null, { clock: NIGHT });
  await adminScreen('final_done', 'end-card', null, { clock: NIGHT });
  await adminScreen('final_done', 'edit-awards', (pg) => click(pg, '[data-tm-edit-awards]'), { clock: NIGHT });
  await adminScreen('ended', 'ended', null, { clock: NIGHT });
  await adminScreen(
    'history',
    'history-tab',
    async (pg) => {
      await pg.locator('.tabbar').getByText('History', { exact: true }).click();
      await pg.waitForTimeout(800);
      await click(pg, '[data-history-tournaments]');
    },
    { clock: NIGHT },
  );
  await adminScreen(
    'history',
    'players-card',
    async (pg) => {
      await pg.locator('.tabbar').getByText('Players', { exact: true }).click();
      await pg.waitForTimeout(800);
      await pg.locator('[data-pr-row="Christopher Vanderberg"], [data-player="Christopher Vanderberg"] button, [data-pr-row="Vic"], [data-player="Vic"] button').first().click();
      await pg.waitForTimeout(900);
    },
    { clock: NIGHT },
  );
  await adminScreen('am_before', 'am-before', null, { clock: NIGHT });
  await adminScreen('am_round3', 'am-night', null, { clock: NIGHT });
  await adminScreen('am_round3', 'am-fix', (pg) => click(pg, '[data-tm-fix-game], [data-tm-am-fix]', 'dialog[open]'), { clock: NIGHT });
  await adminScreen('am_break', 'am-break', null, { clock: NIGHT });
  await adminScreen('am_done', 'am-end', null, { clock: NIGHT });
  await adminScreen('am_done', 'am-awards', (pg) => click(pg, '[data-tm-edit-awards]'), { clock: NIGHT });

  writeFileSync(path.join(OUT, `results${ONLY ? '-' + ONLY.replace(/\W+/g, '_') : ''}${process.env.AUDIT_SKIN ? '-skin' + process.env.AUDIT_SKIN : ''}.json`), JSON.stringify(results, null, 1));
  writeFileSync(path.join(OUT, `results-${PORT}.json`), JSON.stringify(results, null, 1));
  await browser.close();
  kill();
  console.log(`\naudit73-looks: ${results.length} screen/width combinations, ${results.filter((r) => r.issues.length).length} with something to look at`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
