/* Zip 78 (🎾78.one look): before and after pictures of every screen the zip touches, player and organizer, 320 and 390 px, light and dark,
 * the Christmas theme on and off (the organizer's own player, Just me), all on the preview's calm world with the fixed fake names.
 *
 *   SHOTS_DIR=.data/zip78-after node e2e/zip78-shots.cjs        (ZIP78_ONLY=<name prefix> takes only those pictures)
 *
 * Each picture also measures: the page wider than the screen, any word cut with "…", and text in the rounded display font. The numbers go to
 * <dir>/report.json. Nothing here asserts: e2e/zip78.cjs holds the checks.
 */
const path = require('node:path');
const { mkdirSync, writeFileSync } = require('node:fs');
const { boot, ROOT } = require('./zip74-boot.cjs');

const DIR = path.resolve(ROOT, process.env.SHOTS_DIR || '.data/zip78-shots');
const ONLY = process.env.ZIP78_ONLY || '';
/** calm: the preview's calm world (tournament screens); full: the whole fake world (every regular game card, owe banners, credit). */
const WORLD = process.env.WORLD || 'calm';
const WIDTHS = (process.env.WIDTHS || '320,390').split(',').map(Number);
const SCHEMES = ['light', 'dark'];
const report = [];

/** What a screen measures: sideways scroll, cut text, the display font on words, buttons that fell back to the browser font, carets. */
async function measure(page) {
  return page.evaluate(() => {
    const out = { wide: document.documentElement.scrollWidth > window.innerWidth, cut: [], display: [], arial: [], carets: [], small: [] };
    for (const el of document.querySelectorAll('body *')) {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join(' ').trim();
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (own && cs.textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth + 1) out.cut.push(own.slice(0, 40));
      if (own && /bricolage/i.test(cs.fontFamily)) out.display.push(own.slice(0, 40));
      if (el.tagName === 'BUTTON' && /arial|^$/i.test(cs.fontFamily.split(',')[0].replace(/"/g, '').trim()) && !/apple|system/i.test(cs.fontFamily)) out.arial.push((el.getAttribute('aria-label') || own).slice(0, 30));
      if (own && parseFloat(cs.fontSize) < 11) out.small.push(`${own.slice(0, 30)} ${cs.fontSize}`);
      if (/[›❯⌄]/.test(own)) out.carets.push(own.slice(0, 30));
      for (const w of ['::after', '::before']) {
        const c = getComputedStyle(el, w).content;
        if (c && /[›❯⌄]/.test(c)) out.carets.push(`${el.className} ${w}`);
      }
    }
    // Tap targets under 44 x 44, counting a ::before / ::after hit area that reaches past the box.
    out.taps = [];
    for (const el of document.querySelectorAll('button, a[href], [role="button"], summary, label.btn, select')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0 || getComputedStyle(el).visibility === 'hidden') continue;
      if (el.closest('[aria-hidden="true"], .sr-only')) continue;
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
      if (w < 43.5 || h < 43.5) out.taps.push(`${(el.getAttribute('aria-label') || el.textContent || el.className).trim().replace(/\s+/g, ' ').slice(0, 28)} [${el.className}] ${Math.round(w)}x${Math.round(h)}`);
    }
    for (const k of ['cut', 'display', 'arial', 'carets', 'small', 'taps']) out[k] = [...new Set(out[k])].slice(0, 40);
    return out;
  });
}

(async () => {
  mkdirSync(DIR, { recursive: true });
  const b = await boot({ name: `zip78shots-${WORLD}`, port: Number(process.env.E2E_PORT) || (WORLD === 'full' ? 5579 : 5578), calm: WORLD !== 'full' });
  let stageNow = '';
  const stage = async (s) => {
    if (stageNow === s || WORLD === 'full') return;
    await b.stage(s);
    stageNow = s;
  };
  async function take(name, stageName, open, opts = {}) {
    if (ONLY && !name.startsWith(ONLY)) return;
    if ((opts.world || 'calm') !== WORLD) return;
    await stage(stageName);
    for (const width of WIDTHS)
      for (const scheme of SCHEMES) {
        const file = `${name}${WORLD === 'full' ? '-full' : ''}-${width}-${scheme}.png`;
        let p;
        try {
          p = await open({ width, scheme });
          await p.page.waitForTimeout(400);
          await p.page.evaluate(() => document.fonts && document.fonts.ready);
          const m = await measure(p.page);
          await p.page.screenshot({ path: path.join(DIR, file), fullPage: opts.full !== false });
          report.push({ file, ...m });
          console.log(`  ${file}${m.wide ? ' WIDE' : ''}${m.cut.length ? ` cut:${m.cut.length}` : ''}${m.display.length ? ` display:${m.display.length}` : ''}${m.carets.length ? ` carets:${m.carets.length}` : ''}${m.taps.length ? ` taps:${m.taps.length}` : ''}`);
        } catch (err) {
          console.log(`  ✗ ${file}: ${String(err && err.message).split('\n')[0].slice(0, 200)}`);
          report.push({ file, error: String(err && err.message).slice(0, 300) });
        } finally {
          if (p) await p.ctx.close().catch(() => {});
        }
      }
  }
  const clickText = async (page, sel, text) => {
    const el = page.locator(sel, { hasText: text }).first();
    await el.waitFor({ timeout: 8000 });
    await el.click();
    await page.waitForTimeout(700);
  };
  const tab = async (a, name) => {
    await clickText(a.page, '.tabbar button, .tab-bar button', name);
    await a.page.waitForTimeout(900);
  };

  try {
    // ---------- Player ----------
    await take('p-home-vic', 'none', (o) => b.playerPage('Vic', o));
    await take('p-home-reese', 'none', (o) => b.playerPage('Reese', o));
    await take('p-credit', 'ended', async (o) => {
      const p = await b.playerPage('Vic', o);
      await clickText(p.page, 'button', 'CREDIT');
      return p;
    }, { full: false });
    await take('p-picker', 'none', async (o) => {
      const p = await b.newPage(o);
      await p.page.goto(`${b.BASE}/`);
      await p.page.locator('.name-grid').first().waitFor({ timeout: 30000 });
      return p;
    });
    await take('p-tickets', 'tickets_open', (o) => b.playerPage('Vic', o));
    await take('p-signup-level', 'signup', async (o) => {
      const p = await b.playerPage('Vic', o);
      await clickText(p.page, 'button', 'Sign up');
      await p.page.locator('dialog[open]').first().waitFor({ timeout: 8000 });
      const next = p.page.locator('dialog[open] button', { hasText: 'Next' });
      if (await next.count()) {
        await p.page.locator('dialog[open] [data-tm-date], dialog[open] .tm-date, dialog[open] [aria-pressed]').first().click().catch(() => {});
        await next.first().click().catch(() => {});
        await p.page.waitForTimeout(600);
      }
      return p;
    }, { full: false });
    await take('p-dropout-tour', 'zip70_start', async (o) => {
      const p = await b.playerPage('Parker', o);
      await clickText(p.page, 'button', 'Drop out');
      return p;
    }, { full: false });
    await take('p-gamenight', 'zip74_short', (o) => b.playerPage('Vic', o));
    await take('p-americano', 'am_round3', (o) => b.playerPage('Vic', o));
    await take('p-pools12', 'game1', async (o) => {
      const p = await b.newPage(o);
      await p.page.goto(`${b.BASE}/?as=Vic&poolslook=12`);
      await p.page.locator('[data-tc-day-pool], [data-tc-day]').first().waitFor({ timeout: 30000 });
      await p.page.waitForTimeout(900);
      return p;
    });
    await take('p-loading', 'tickets_open', async (o) => {
      const p = await b.newPage({ ...o, reducedMotion: 'no-preference' });
      await p.page.route('**/api/tournament**', async (r) => {
        await new Promise((res) => setTimeout(res, 20000));
        await r.continue().catch(() => {});
      });
      await p.page.goto(`${b.BASE}/?as=Vic`);
      await p.page.locator('.skel').first().waitFor({ timeout: 15000 }).catch(() => {});
      return p;
    }, { full: false });
    // The Christmas theme on (the organizer's own player, Just me, tap the logo) and off.
    await take('p-xmas-off', 'none', (o) => b.playerPage('Alex', { ...o }));
    await take('p-xmas-on', 'none', async (o) => {
      await b.call('PUT', '/api/admin/christmas-skin-switch', { mode: 'me' });
      const p = await b.newPage({ ...o, organizer: true });
      await p.page.goto(`${b.BASE}/?as=Alex`);
      await p.page.locator('.schedule').first().waitFor({ timeout: 30000 });
      await p.page.waitForTimeout(700);
      const logo = p.page.locator('[data-skin-logo]');
      if (await logo.count()) await logo.first().click();
      await p.page.waitForTimeout(2200);
      return p;
    });
    await b.call('PUT', '/api/admin/christmas-skin-switch', { mode: 'off' }).catch(() => {});

    // ---------- Organizer ----------
    await take('a-home', 'none', (o) => b.adminHome(o));
    await take('a-home-tour', 'tickets_open', async (o) => {
      const a = await b.adminHome(o);
      await a.page.locator('[data-tm-home-toggle]').first().click().catch(() => {});
      await a.page.waitForTimeout(700);
      return a;
    });
    await take('a-home-night', 'zip74_short', (o) => b.adminHome(o));
    await take('a-levels', 'signup', async (o) => {
      const a = await b.adminHome(o);
      const t = a.page.locator('[data-tm-home-toggle]').first();
      if ((await t.getAttribute('aria-expanded')) !== 'true') await t.click();
      await a.page.waitForTimeout(600);
      await a.page.locator('[data-tm-open-edit]').first().click();
      await a.page.locator('[data-tm-card="levels"]').first().waitFor({ timeout: 10000 });
      await a.page.locator('[data-tm-card="levels"]').first().scrollIntoViewIfNeeded();
      return a;
    }, { full: false });
    await take('a-players', 'none', async (o) => {
      const a = await b.adminHome(o);
      await tab(a, 'Players');
      return a;
    });
    await take('a-money', 'none', async (o) => {
      const a = await b.adminHome(o);
      await tab(a, 'Money');
      return a;
    });
    await take('a-totals', 'ended', async (o) => {
      const a = await b.adminHome(o);
      await tab(a, 'Money');
      await clickText(a.page, '[role="group"] button', 'Totals');
      return a;
    });
    await take('a-history', 'history', async (o) => {
      const a = await b.adminHome(o);
      await tab(a, 'History');
      return a;
    });
    await take('a-settings', 'none', async (o) => {
      const a = await b.adminHome(o);
      await tab(a, 'Settings');
      return a;
    });
    await take('a-settings-group', 'none', async (o) => {
      const a = await b.adminHome(o);
      await tab(a, 'Settings');
      const s = a.page.locator('details.set-sect > summary, .set-sect summary').first();
      await s.click().catch(() => {});
      await a.page.waitForTimeout(500);
      return a;
    });
    await take('a-test', 'none', async (o) => {
      const a = await b.newPage({ ...o, organizer: true });
      await a.page.goto(`${b.BASE}/admin/tournament-test`);
      await a.page.waitForTimeout(2500);
      return a;
    });
    // ---------- The whole fake world (WORLD=full): owe banners, credit, full Home cards ----------
    const F = { world: 'full' };
    for (const who of ['Vic', 'Zoe', 'Sage', 'Rowan']) await take(`p-home-${who.toLowerCase()}`, 'none', (o) => b.pickedPage(who, o), F);
    await take('p-paysheet-owe', 'none', async (o) => {
      const p = await b.pickedPage('Vic', o);
      await p.page.locator('main [data-pay-card] [data-pay]').first().click();
      await p.page.waitForTimeout(700);
      return p;
    }, { ...F, full: false });
    await take('p-paysheet-card', 'none', async (o) => {
      const p = await b.pickedPage('Vic', o);
      await p.page.locator('main .schedule article').locator('a, button', { hasText: /^Pay\b/ }).first().click();
      await p.page.waitForTimeout(700);
      return p;
    }, { ...F, full: false });
    await take('p-credit', 'none', async (o) => {
      const p = await b.pickedPage('Sage', o);
      await clickText(p.page, 'button', 'CREDIT');
      return p;
    }, { ...F, full: false });
    await take('p-dropout', 'none', async (o) => {
      const p = await b.pickedPage('Vic', o);
      await clickText(p.page, '.schedule article button', 'Drop out');
      return p;
    }, { ...F, full: false });
    await take('a-home', 'none', (o) => b.adminHome(o), F);
    for (const t of ['Players', 'Money', 'History', 'Settings'])
      await take(`a-${t.toLowerCase()}`, 'none', async (o) => {
        const a = await b.adminHome(o);
        await tab(a, t);
        return a;
      }, F);
    await take('a-totals', 'none', async (o) => {
      const a = await b.adminHome(o);
      await tab(a, 'Money');
      await clickText(a.page, '[role="group"] button', 'Totals');
      return a;
    }, F);
    await take('a-gamesheet', 'none', async (o) => {
      const a = await b.adminHome(o);
      await clickText(a.page, 'button', 'paid');
      return a;
    }, { ...F, full: false });
  } finally {
    writeFileSync(path.join(DIR, `report-${WORLD}.json`), JSON.stringify(report, null, 1));
    await b.close();
  }
})();
