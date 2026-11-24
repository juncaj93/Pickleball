/* Zip 84 (🎾84.final dry run): the FULL SITE AUDIT on a local copy. Find and report only: nothing here changes app code.
 *
 *   node e2e/zip84-audit.cjs                 (WORLD=calm|full|both, default both; ZIP84_ONLY=<screen prefix>; TAPS=0 skips the tap pass)
 *
 * For every screen (player and organizer), at 320 and 390 px, light and dark (the player screens also with the Christmas skin on):
 *   - measures: page wider than the screen, words cut ("…" or clipped), carets, text under 11 px, tap targets under 44 x 44, the fonts in use,
 *     filled buttons (color, height, corner) by label, lime filled buttons and whether they sit on a tournament surface, raw text for the
 *     word rules (em dash, straight apostrophe, "Back out", "withdraw", "session", "dollars", chirpy words, "$" amounts written out);
 *   - collects every Venmo / Zelle / sms link (the handle and the number are REDACTED in the report: only the amount and the note are kept).
 * Then, at 390 light, taps every visible button once (never a confirm inside a sheet) and records what happened: a sheet opened (then Back must
 * close it), the page changed, a request went out, the address changed, or NOTHING (a dead end). A sheet that Back cannot close is a finding.
 * Money paths (full world): hand credit, cash out and a regular drop: the same number on the player's chip, the organizer's Players sheet,
 * Activity and Totals.
 * Output: .data/zip84/<world>/*.png and report-<world>.json (not in git). The 10 worst finds are copied by hand to docs/audits/84-shots/.
 */
const path = require('node:path');
const { mkdirSync, writeFileSync } = require('node:fs');
const { boot, ROOT } = require('./zip74-boot.cjs');

const ONLY = process.env.ZIP84_ONLY || '';
const only = (n) => !ONLY || ONLY.split(',').some((x) => n.startsWith(x));
const WORLDS = (process.env.WORLD || 'both') === 'both' ? ['calm', 'full'] : [process.env.WORLD];
const TAPS = process.env.TAPS !== '0';
const WIDTHS = (process.env.WIDTHS || '320,390').split(',').map(Number);
const SCHEMES = ['light', 'dark'];

/** Everything one screen measures (runs in the page). */
async function measure(page) {
  return page.evaluate(() => {
    const out = { wide: [document.documentElement.scrollWidth, window.innerWidth], cut: [], carets: [], small: [], fonts: {}, filled: [], lime: [], taps: [], overflowX: [], text: '' };
    const vis = (el) => {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    const lab = (el) => (el.getAttribute('aria-label') || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40);
    for (const el of document.querySelectorAll('body *')) {
      if (!vis(el)) continue;
      const cs = getComputedStyle(el);
      const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join(' ').trim();
      if (own) {
        const f = cs.fontFamily.split(',')[0].replace(/["']/g, '').trim();
        out.fonts[f] = (out.fonts[f] || 0) + 1;
        if (cs.textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth + 1) out.cut.push(own.slice(0, 40));
        if (/…$/.test(own) && !/\.\.\.|Signing|Saving|Loading/.test(own)) out.cut.push(`… ${own.slice(0, 40)}`);
        const rr = el.getBoundingClientRect();
        const srOnly = rr.width <= 2 || rr.height <= 2 || (cs.clip && cs.clip !== 'auto') || cs.clipPath !== 'none';
        if (!srOnly && (cs.overflow === 'hidden' || cs.overflowX === 'hidden') && el.scrollWidth > el.clientWidth + 2 && cs.whiteSpace === 'nowrap') out.cut.push(`clip ${own.slice(0, 40)}`);
        if (parseFloat(cs.fontSize) < 11) out.small.push(`${own.slice(0, 30)} ${cs.fontSize}`);
        if (/[›❯⌄▾▸▼▶]/.test(own)) out.carets.push(own.slice(0, 30));
      }
      for (const w of ['::after', '::before']) {
        const c = getComputedStyle(el, w).content;
        if (c && /[›❯⌄▾▸▼▶]/.test(c)) out.carets.push(`${String(el.className).slice(0, 40)} ${w}`);
      }
      const r = el.getBoundingClientRect();
      if (r.right > window.innerWidth + 1 && !el.closest('[data-scroll-x], .table-scroll, .hist-tabs, .seg-scroll') && cs.position !== 'fixed') {
        let p = el.parentElement;
        let scroller = false;
        while (p) {
          const pc = getComputedStyle(p);
          if (/auto|scroll/.test(pc.overflowX)) scroller = true;
          p = p.parentElement;
        }
        if (!scroller) out.overflowX.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 30)} ${Math.round(r.right)}`);
      }
    }
    for (const el of document.querySelectorAll('button, a[href], [role="button"], summary')) {
      if (!vis(el) || el.closest('[aria-hidden="true"], .sr-only')) continue;
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      let w = r.width;
      let h = r.height;
      for (const ps of ['::before', '::after']) {
        const c = getComputedStyle(el, ps);
        if (c.content === 'none' || c.position !== 'absolute') continue;
        const t = parseFloat(c.top) || 0;
        const bt = parseFloat(c.bottom) || 0;
        const l = parseFloat(c.left) || 0;
        const rt = parseFloat(c.right) || 0;
        if (c.top !== 'auto' && c.bottom !== 'auto') h = Math.max(h, r.height - t - bt);
        if (c.left !== 'auto' && c.right !== 'auto') w = Math.max(w, r.width - l - rt);
      }
      if ((w < 43.5 || h < 43.5) && !el.closest('nav.tabbar') && el.tagName !== 'A') out.taps.push(`${lab(el).slice(0, 28)} [${String(el.className).slice(0, 30)}] ${Math.round(w)}x${Math.round(h)}`);
      const bg = cs.backgroundColor;
      const m = /rgba?\((\d+), (\d+), (\d+)(?:, ([\d.]+))?\)/.exec(bg);
      if (m && (m[4] === undefined || Number(m[4]) > 0.5) && el.tagName === 'BUTTON') {
        const rgb = `${m[1]},${m[2]},${m[3]}`;
        out.filled.push({ label: lab(el).slice(0, 26), bg: rgb, h: Math.round(r.height), radius: cs.borderTopLeftRadius, font: cs.fontSize, weight: cs.fontWeight });
        const [R, G, B] = [m[1], m[2], m[3]].map(Number);
        const isLime = R > 190 && G > 220 && B < 120;
        if (isLime) out.lime.push({ label: lab(el).slice(0, 26), tour: !!el.closest('[class*="tc-"], [data-tc-day], [data-tm-card], .tm-card, .tour, [class*="tm-"], [class*="tour"]') });
      }
    }
    out.text = document.body.innerText;
    for (const k of ['cut', 'carets', 'small', 'taps', 'overflowX']) out[k] = [...new Set(out[k])].slice(0, 40);
    out.links = [...document.querySelectorAll('a[href]')]
      .map((a) => a.getAttribute('href'))
      .filter((h) => /venmo|zelle|^sms:|^tel:|cash\.app|paypal/i.test(h))
      .map((h) => h.replace(/(venmo\.com\/(?:u\/|code\/)?)([^/?#]+)/i, '$1<handle>').replace(/\+?\d[\d\s().-]{8,}\d/g, '<number>').replace(/recipients=[^&]+/, 'recipients=<redacted>'));
    return out;
  });
}

/** The word rules on what a screen really shows. */
function words(text) {
  const out = [];
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const rules = [
    ['em dash', /—/],
    ['straight apostrophe', /[A-Za-z]'[A-Za-z]/],
    ['Back out (not Drop out)', /\bback(ed|ing)? out\b/i],
    ['withdraw', /withdraw/i],
    ['cash-out / cashout', /cash-out|cashout|Cash Out\b/],
    ['session (players say game)', /\bsessions?\b/i],
    ['dollars written out', /\b(dollars?|bucks)\b/i],
    ['chirpy', /\b(awesome|woohoo|yay|oops|uh oh|whoops|great job|hooray|let's dive|amazing|you've got this|nailed it)\b/i],
    ['waitlist word', /\b(waitlist|standby|waiting list)\b/i],
    ['exclamation', /!/],
    ['refund', /\brefund/i],
    ['straight quotes', /"[^"]+"/],
    ['undefined/NaN/null', /\b(undefined|NaN|null)\b|\[object/],
    ['cents with decimals', /\$\d+\.\d\d/],
  ];
  for (const l of lines) for (const [k, re] of rules) if (re.test(l)) out.push(`${k}: ${l.slice(0, 90)}`);
  return [...new Set(out)];
}

const report = [];
const taps = [];
const flows = [];

async function runWorld(WORLD) {
  const DIR = path.join(ROOT, '.data', 'zip84', WORLD);
  mkdirSync(DIR, { recursive: true });
  const full = WORLD === 'full';
  const b = await boot({ name: `zip84-${WORLD}${process.env.TAG ? '-' + process.env.TAG : ''}`, port: (Number(process.env.E2E_PORT) || 5842) + (full ? 1 : 0), calm: !full });
  let stageNow = '';
  const stage = async (s) => {
    if (full || !s) return;
    try {
      await b.stage(s);
    } catch (err) {
      report.push({ world: WORLD, file: `STAGE ${s}`, error: String(err.message).slice(0, 200), after: stageNow });
      console.log(`  STAGE 500 ${s} (after ${stageNow}): retry after none`);
      await b.stage('none').catch(() => {});
      await b.stage(s);
    }
    stageNow = s;
  };
  const clickText = async (page, sel, text) => {
    const el = page.locator(sel, { hasText: text }).first();
    await el.waitFor({ timeout: 8000 });
    await el.click();
    await page.waitForTimeout(800);
  };
  const tab = async (a, name) => {
    await a.page.locator('nav.tabbar button', { hasText: name }).first().click();
    await a.page.waitForTimeout(1000);
  };
  const xmasPlayer = async (o) => {
    await b.call('PUT', '/api/admin/christmas-skin-switch', { mode: 'me' }).catch(() => {});
    const p = await b.newPage({ ...o, organizer: true });
    await p.page.goto(`${b.BASE}/?as=Alex`);
    await p.page.locator('.schedule, [data-tc-day]').first().waitFor({ timeout: 30000 });
    await p.page.waitForTimeout(700);
    const logo = p.page.locator('[data-skin-logo]');
    if (await logo.count()) await logo.first().click();
    await p.page.waitForTimeout(2200);
    return p;
  };
  const who = (name) => (full ? (o) => b.pickedPage(name, o) : (o) => b.playerPage(name, o));
  const admin = (t, extra) => async (o) => {
    const a = await b.adminHome(o);
    if (t) await tab(a, t);
    if (extra) await extra(a);
    return a;
  };
  const openHomeTour = async (a) => {
    const t = a.page.locator('[data-tm-home-toggle]').first();
    if ((await t.count()) && (await t.getAttribute('aria-expanded')) !== 'true') await t.click();
    await a.page.waitForTimeout(700);
  };

  // name, stage, open, opts { xmas: also with the Christmas skin; taps: tap pass on it (default true) }
  const P = (name, st, open, opts = {}) => ({ name: `p-${name}`, st, open, ...opts });
  const A = (name, st, open, opts = {}) => ({ name: `a-${name}`, st, open, ...opts });
  const SCREENS = full
    ? [
        P('home-vic', '', who('Vic'), { xmas: true }),
        P('home-zoe', '', who('Zoe')),
        P('home-reese', '', who('Reese')),
        P('home-sage', '', who('Sage')),
        P('home-rowan', '', who('Rowan')),
        P('home-quinn', '', who('Quinn')),
        P('picker', '', async (o) => {
          const p = await b.newPage(o);
          await p.page.goto(`${b.BASE}/`);
          await p.page.locator('.name-grid, .schedule').first().waitFor({ timeout: 30000 });
          return p;
        }),
        A('home', '', admin()),
        A('players', '', admin('Players')),
        A('money', '', admin('Money')),
        A('totals', '', admin('Money', (a) => clickText(a.page, '[role="group"] button', 'Totals').catch(() => {}))),
        A('history', '', admin('History')),
        A('settings', '', admin('Settings')),
      ]
    : [
        P('home-none', 'none', who('Vic'), { xmas: true }),
        P('tickets', 'tickets_open', who('Vic'), { xmas: true }),
        P('signup', 'signup', who('Vic')),
        P('lockin-parker', 'zip70_start', who('Parker')),
        P('late-parker', 'zip70_late', who('Parker')),
        P('teams', 'teams_published', who('Vic')),
        P('night-doubles', 'zip74_short', who('Vic'), { xmas: true }),
        P('final-on', 'final_on', who('Vic')),
        P('americano', 'am_round3', who('Vic'), { xmas: true }),
        P('am-allin', 'zip77_allin', who('Vic')),
        P('am-revealed', 'zip77_revealed', who('Vic')),
        P('ended', 'ended', who('Vic')),
        P('results-night', 'zip79_night', who('Vic')),
        P('history-cup', 'history', who('Parker'), { xmas: true }),
        P('pools12', 'game1', async (o) => {
          const p = await b.newPage(o);
          await p.page.goto(`${b.BASE}/?as=Vic&poolslook=12`);
          await p.page.locator('[data-tc-day-pool], [data-tc-day]').first().waitFor({ timeout: 30000 });
          await p.page.waitForTimeout(900);
          return p;
        }),
        A('home-none', 'none', admin()),
        A('home-tickets', 'zip70_start', admin(null, openHomeTour)),
        A('home-finalize', 'zip70_finalize', admin(null, openHomeTour)),
        A('home-night', 'zip74_short', admin()),
        A('home-americano', 'am_round3', admin()),
        A('home-allin', 'zip77_allin', admin()),
        A('home-tie', 'zip82_tie', admin()),
        A('home-final-done', 'final_done', admin()),
        A('home-ended', 'ended', admin()),
        A('home-venue', 'venue_winter', admin()),
        A('home-cup', 'history', admin()),
        A('players', 'history', admin('Players')),
        A('money', 'ended', admin('Money')),
        A('totals', 'ended', admin('Money', (a) => clickText(a.page, '[role="group"] button', 'Totals').catch(() => {}))),
        A('history', 'history', admin('History')),
        A('skills', 'zip79_skills', admin('History', (a) => clickText(a.page, '[role="group"] button, [role="tablist"] button', 'Skills').catch(() => {}))),
        A('settings', 'venue_winter', admin('Settings')),
        A('test-page', 'none', async (o) => {
          const a = await b.newPage({ ...o, organizer: true });
          await a.page.goto(`${b.BASE}/admin/tournament-test`);
          await a.page.waitForTimeout(2500);
          return a;
        }),
      ];

  for (const s of SCREENS) {
    if (!only(s.name)) continue;
    await stage(s.st);
    const variants = [{ xmas: false }, ...(s.xmas ? [{ xmas: true }] : [])];
    for (const v of variants)
      for (const width of WIDTHS)
        for (const scheme of SCHEMES) {
          const file = `${s.name}${v.xmas ? '-xmas' : ''}-${width}-${scheme}.png`;
          let p;
          try {
            p = v.xmas ? await xmasPlayer({ width, scheme }) : await s.open({ width, scheme });
            await p.page.waitForTimeout(500);
            const m = await measure(p.page);
            await p.page.screenshot({ path: path.join(DIR, file), fullPage: true });
            const w = words(m.text);
            delete m.text;
            report.push({ world: WORLD, file, ...m, words: w, errors: p.errors });
            const wide = m.wide[0] > m.wide[1];
            console.log(`  ${file}${wide ? ' WIDE' : ''}${m.cut.length ? ` cut:${m.cut.length}` : ''}${m.carets.length ? ` carets:${m.carets.length}` : ''}${m.taps.length ? ` taps:${m.taps.length}` : ''}${m.overflowX.length ? ` over:${m.overflowX.length}` : ''}${w.length ? ` words:${w.length}` : ''}${p.errors.length ? ` ERR:${p.errors.length}` : ''}`);
          } catch (err) {
            console.log(`  x ${file}: ${String(err && err.message).split('\n')[0].slice(0, 200)}`);
            report.push({ world: WORLD, file, error: String(err && err.message).slice(0, 300) });
          } finally {
            if (p) await p.ctx.close().catch(() => {});
          }
        }
    if (v0(s) && TAPS) await tapPass(b, s, stage, DIR, WORLD);
    if (s.xmas) await b.call('PUT', '/api/admin/christmas-skin-switch', { mode: 'off' }).catch(() => {});
  }
  b.full = full;
  if (!ONLY || ONLY.split(',').includes('flows')) await moneyFlows(b).catch((e) => console.log('  flow error', e.message));
  writeFileSync(path.join(ROOT, '.data', 'zip84', `report-${WORLD}${process.env.TAG ? '-' + process.env.TAG : ''}.json`), JSON.stringify({ report: report.filter((r) => r.world === WORLD), taps: taps.filter((t) => t.world === WORLD), flows }, null, 1));
  await b.close();
}
const v0 = (s) => s.taps !== false;

/** Tap every visible button once at 390 light; restore after each (Back for a sheet, else reopen the screen). */
async function tapPass(b, s, stage, DIR, WORLD) {
  await stage(s.st);
  let p = await s.open({ width: 390, scheme: 'light' });
  const mark = () =>
    p.page.evaluate(() => {
      const vis = (el) => {
        const cs = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0;
      };
      const els = [...document.querySelectorAll('button, [role="button"], summary, a[href]')].filter((e) => vis(e) && !e.closest('dialog[open]') && !e.closest('nav.tabbar'));
      return els.map((e, i) => {
        e.setAttribute('data-audit-i', String(i));
        return { i, tag: e.tagName, label: (e.getAttribute('aria-label') || e.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40), disabled: e.disabled || e.getAttribute('aria-disabled') === 'true', href: e.getAttribute('href') };
      });
    });
  let list = await mark();
  const seen = new Set();
  for (const item of list) {
    const key = `${item.label}|${item.href || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const rec = { world: WORLD, screen: s.name, label: item.label, result: '' };
    if (item.disabled) {
      rec.result = 'disabled';
      taps.push(rec);
      continue;
    }
    if (item.href && !/^\/|^#|^https?:\/\/localhost/.test(item.href)) {
      rec.result = `link ${item.href.replace(/(venmo\.com\/(?:u\/|code\/)?)([^/?#]+)/i, '$1<handle>').replace(/\+?\d[\d\s().-]{8,}\d/g, '<number>').slice(0, 140)}`;
      taps.push(rec);
      continue;
    }
    try {
      const hit = list.find((x) => x.label === item.label && (x.href || '') === (item.href || ''));
      if (!hit) {
        rec.result = 'not on the fresh screen';
        taps.push(rec);
        continue;
      }
      const el = p.page.locator(`[data-audit-i="${hit.i}"]`);
      const url0 = p.page.url();
      const reqs = [];
      const onReq = (r) => {
        if (/\/api\//.test(r.url()) && !/\/version|\/api\/group$|\/dashboard|\/check/.test(r.url())) reqs.push(`${r.method()} ${r.url().replace(/^https?:\/\/[^/]+/, '').slice(0, 60)}`);
      };
      p.page.on('request', onReq);
      await p.page.evaluate(() => {
        window.__muts = 0;
        window.__mo && window.__mo.disconnect();
        window.__mo = new MutationObserver((ms) => {
          for (const m of ms) if (!(m.target && m.target.closest && m.target.closest('.updated-line, [data-updated]'))) window.__muts++;
        });
        window.__mo.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
      });
      const popup = p.ctx.waitForEvent('page', { timeout: 1500 }).catch(() => null);
      await el.first().click({ timeout: 3000 });
      await p.page.waitForTimeout(1300);
      const np = await popup;
      p.page.off('request', onReq);
      const st = await p.page.evaluate(() => ({ muts: window.__muts, dialogs: document.querySelectorAll('dialog[open]').length, title: [...document.querySelectorAll('dialog[open] h2, dialog[open] h1, dialog[open] [class*="title"]')].map((h) => h.textContent.trim()).slice(-1)[0] || '' }));
      const url1 = p.page.url();
      if (np) {
        rec.result = `new page ${np.url().slice(0, 60)}`;
        await np.close().catch(() => {});
      } else if (st.dialogs) {
        rec.result = `sheet "${st.title.slice(0, 40)}"`;
        // Back must close it.
        const shotName = `tap-${s.name}-${taps.length}.png`;
        const hasX = await p.page.locator('dialog[open] button[aria-label="Close"], dialog[open] .sheet-close, dialog[open] button', { hasText: /^(Close|Cancel|Go back|Done|Not now|Back)$/ }).count();
        await p.page.screenshot({ path: path.join(DIR, shotName) });
        rec.shot = shotName;
        rec.xButton = hasX > 0 || (await p.page.locator('dialog[open] [aria-label="Close"]').count()) > 0;
        await p.page.goBack().catch(() => {});
        await p.page.waitForTimeout(900);
        const left = await p.page.evaluate(() => document.querySelectorAll('dialog[open]').length);
        if (left) {
          rec.result += ' / BACK DID NOT CLOSE';
          await p.page.keyboard.press('Escape');
          await p.page.waitForTimeout(500);
        }
        if (!p.page.url().startsWith(url0.split('?')[0])) rec.result += ' / Back left the page';
      } else if (url1 !== url0) {
        rec.result = `went to ${url1.replace(b.BASE, '')}`;
      } else if (reqs.length) {
        rec.result = `request ${reqs.join(', ')}`;
      } else if (st.muts > 0) {
        rec.result = `page changed (${st.muts})`;
      } else {
        rec.result = 'NOTHING HAPPENED';
        const shotName = `dead-${s.name}-${taps.length}.png`;
        await el.first().screenshot({ path: path.join(DIR, shotName) }).catch(() => {});
        rec.shot = shotName;
      }
      if (p.errors.length) rec.errors = p.errors.splice(0);
      // Back to a clean screen for the next tap when the page moved on.
      if (url1 !== url0 || reqs.length || (!st.dialogs && st.muts > 0)) {
        await p.ctx.close();
        await stage(s.st);
        p = await s.open({ width: 390, scheme: 'light' });
        list = await mark();
      }
    } catch (err) {
      rec.result = `error ${String(err && err.message).split('\n')[0].slice(0, 120)}`;
    }
    taps.push(rec);
    console.log(`    tap ${s.name}: ${rec.label} -> ${rec.result}`);
  }
  await p.ctx.close().catch(() => {});
}

/** Money paths: each credit change lands once and reads the same on the player's chip, the organizer's Players sheet, Totals and Activity. */
const money = (t) => (String(t).match(/\$\d+(?:\.\d\d)?/g) || []);
async function screens(b, name) {
  const out = {};
  const p = await (b.full ? b.pickedPage(name, { width: 390 }) : b.playerPage(name, { width: 390 }));
  const chip = p.page.locator('button', { hasText: 'CREDIT' }).first();
  out.chip = (await chip.count()) ? (await chip.innerText()).replace(/\s+/g, ' ') : 'no chip';
  if (await chip.count()) {
    await chip.click();
    await p.page.waitForTimeout(800);
    out.history = (await p.page.locator('dialog[open]').last().innerText()).replace(/\s+/g, ' ').slice(0, 300);
  }
  await p.ctx.close();
  const a = await b.adminHome({ width: 390 });
  await a.page.locator('nav.tabbar button', { hasText: 'Players' }).first().click();
  await a.page.waitForTimeout(1000);
  const row = a.page.locator('main button, main [role="button"], main li', { hasText: name }).first();
  if (await row.count()) {
    await row.click();
    await a.page.waitForTimeout(1000);
    const d = a.page.locator('dialog[open]').last();
    out.playersSheet = (await d.count()) ? (await d.innerText()).replace(/\s+/g, ' ').match(/Credit[^A-Z]{0,30}|Cash out[^A-Z]{0,30}/g) : 'no sheet';
    await a.page.keyboard.press('Escape');
  }
  await a.page.locator('nav.tabbar button', { hasText: 'Money' }).first().click();
  await a.page.waitForTimeout(1000);
  const tot = a.page.locator('[role="group"] button', { hasText: 'Totals' }).first();
  if (await tot.count()) {
    await tot.click();
    await a.page.waitForTimeout(1200);
    const txt = (await a.page.locator('main').innerText()).replace(/\s+/g, ' ');
    out.totals = (txt.match(/(Credit you added \(by hand\)|Prizes|tournament)[^A-Z]{0,25}/g) || []).slice(0, 6);
  }
  await a.ctx.close();
  return out;
}
async function moneyFlows(b) {
  const act = async (re) => {
    const j = JSON.stringify(await b.call('GET', '/api/admin/activity'));
    return (j.match(re) || []).length;
  };
  const players = async () => (await b.call('GET', '/api/admin/dashboard')).players;
  const potApi = async (name) => {
    const ph = await b.phone(name);
    const g = await ph.group();
    await ph.ctx.close();
    return g.credit ? g.credit.balanceCents : null;
  };
  if (b.full) {
    // 1. Hand credit +$5 to Sage.
    const sage = (await players()).find((x) => x.name === 'Sage');
    const before = await potApi('Sage');
    const r = await b.call('POST', `/api/admin/players/${sage.id}/credit-adjust`, { direction: 'add', cents: 500, reason: 'Audit balls', seen: before }).catch((e) => ({ err: String(e.message).slice(0, 160) }));
    const after = await potApi('Sage');
    flows.push({ flow: 'hand credit +$5 Sage', before, after, result: r.err || 'ok', activity: await act(/Audit balls/g), screens: await screens(b, 'Sage') });
    // 2. Cash out: Reese's pending request, Mark refunded.
    const dash = await b.call('GET', '/api/admin/dashboard');
    const req = JSON.stringify(dash).match(/"refundRequests?":\[\{[^\]]*?"id":"([^"]+)"[^\]]*?"cents":(\d+)/);
    const rb = await potApi('Reese');
    let res = 'no request found';
    if (req) res = await b.call('POST', `/api/admin/refund-requests/${req[1]}`, { action: 'refunded', cents: Number(req[2]) }).then(() => 'ok', (e) => String(e.message).slice(0, 160));
    const ra = await potApi('Reese');
    const twice = req ? await b.call('POST', `/api/admin/refund-requests/${req[1]}`, { action: 'refunded', cents: Number(req[2]) }).then(() => 'SECOND TAP ACCEPTED', (e) => `second tap refused (${String(e.message).slice(0, 60)})`) : '';
    flows.push({ flow: 'cash out Reese, Mark refunded', before: rb, after: ra, result: res, twice, activity: await act(/Reese[^"]{0,40}(cash|refund)/gi), screens: await screens(b, 'Reese') });
  } else {
    // 3. Tournament prize: The Cold Open ended, Vic and Wren hold $14 each.
    await b.stage('ended');
    flows.push({ flow: 'tournament prize (ended): Vic', pot: await potApi('Vic'), activity: await act(/Vic[^"]{0,60}(champion|credit|won)/gi), screens: await screens(b, 'Vic') });
    flows.push({ flow: 'tournament prize (ended): Wren', pot: await potApi('Wren'), screens: await screens(b, 'Wren') });
  }
  for (const f of flows) console.log('  flow', JSON.stringify(f));
}

(async () => {
  for (const w of WORLDS) await runWorld(w);
})();
