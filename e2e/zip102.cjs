/* Zip 102 (🎾102.skin first paint): the Christmas skin from the first paint. With /api/group held back 2 seconds, every frame drawn before the
 * games arrive is recorded (a requestAnimationFrame log of <html data-skin>, data-skin-anim, the header logo's picture and whether it has
 * loaded), then the frames after.
 *
 *   node e2e/zip102.cjs                  (ZIP102_ONLY=A,B runs some)
 *
 * The preview's calm world on a local server, Sat Nov 28, 2026 noon (inside the window), the Christmas skin on for everyone.
 *   A   Remembered ON (Everyone, theme on): the first frame already has the theme and the Christmas logo, loaded; the games land and nothing
 *       moves (no pop-in marker, ever). With and without the saved last screen (the shimmer).
 *   B   Remembered Everyone, theme OFF: the Christmas logo from the first frame, the page plain; the games land and nothing moves.
 *   C   First visit (nothing remembered): plain first frame, as before; the logo comes with the games; the mode is written down.
 *   D   Remembered OFF: plain first frame; plain after.
 *   E   Server Off on a remembered ON phone: dressed first, then plain ONCE, no motion; the memory says off; the next load is plain from the start.
 *   F   Just me on the server, remembered Everyone: a player who is not Alex goes plain once; Alex keeps the NORMAL logo.
 *   G   /admin never: with every memory ON, no frame of /admin has the theme or the Christmas logo.
 *   H   Remembered ON at 375 / 390 / 420 / 440, light and dark, reduced motion on and off: the first frame dressed, nothing wider, no errors.
 * Screenshots: .data/zip102-shots (not in git).
 */
const path = require('node:path');
const { mkdirSync } = require('node:fs');
const { boot, assert, ROOT } = require('./zip74-boot.cjs');

const SHOTS = path.join(ROOT, '.data', 'zip102-shots');
const ONLY = process.env.ZIP102_ONLY || '';
const SAT = Date.parse('2026-11-28T17:00:00.000Z'); // Sat Nov 28, 12:00 PM Eastern
const HOLD_MS = 2000;
let passed = 0;
let failed = 0;
async function check(name, fn) {
  if (ONLY && !ONLY.split(',').some((x) => name.split(' ')[0] === x)) return;
  const t0 = Date.now();
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  } catch (err) {
    failed++;
    console.log(`  ✗ ${name}\n        ${String(err && err.stack ? err.stack : err).split('\n').slice(0, 8).join('\n        ')}`);
  }
}

/** Runs in the page from the very start: one row per drawn frame until told to stop. */
function recorder() {
  window.__frames = [];
  window.__groupAt = null;
  const tick = () => {
    const root = document.documentElement;
    const logo = document.querySelector('header .brand-logo, .brand-tile img, .brand-logo');
    const src = logo ? logo.getAttribute('src') : null;
    window.__frames.push({
      t: performance.now(),
      drawn: !!document.getElementById('root') && document.getElementById('root').childElementCount > 0,
      skin: root.getAttribute('data-skin'),
      anim: root.getAttribute('data-skin-anim'),
      logo: src,
      loaded: !!(logo && logo.complete && logo.naturalWidth > 0),
      skinLogo: logo ? logo.closest('[data-skin-logo]')?.getAttribute('data-skin-logo') ?? null : null,
      games: !!document.querySelector('.schedule:not([data-saved-copy]) > .sched'),
    });
    if (window.__frames.length < 2000) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

(async () => {
  mkdirSync(SHOTS, { recursive: true });
  const b = await boot({ name: 'zip102', port: Number(process.env.E2E_PORT) || 5502, seedIso: '2026-11-28T14:00:00.000Z', nowMs: SAT });
  try {
    await b.call('PUT', '/api/admin/christmas-skin-switch', { mode: 'all' });
    await b.stage('zip86_next');

    /** A phone that picked `who` (one real load writes its memory), with the recorder and /api/group held back from then on. */
    async function phone(who, opts = {}) {
      const p = await b.playerPage(who, opts);
      await p.ctx.addInitScript(recorder);
      await p.page.route('**/api/group*', async (route) => {
        await new Promise((r) => setTimeout(r, HOLD_MS));
        await route.continue().catch(() => {});
      });
      return p;
    }
    const mem = (page, values) =>
      page.evaluate((v) => {
        for (const [k, x] of Object.entries(v)) {
          if (x === null) localStorage.removeItem(k);
          else localStorage.setItem(k, x);
        }
      }, values);
    /** Reloads and returns the frames before the games arrived and after. */
    async function frames(page) {
      await page.reload({ waitUntil: 'commit' });
      await page.waitForFunction(() => window.__frames && window.__frames.some((f) => f.games), null, { timeout: 30000 });
      await page.waitForTimeout(1200);
      const all = await page.evaluate(() => window.__frames);
      const drawn = all.filter((f) => f.drawn);
      const at = drawn.findIndex((f) => f.games);
      return { before: drawn.slice(0, at), after: drawn.slice(at), first: drawn[0], all: drawn };
    }
    const looks = (fs) => [...new Set(fs.map((f) => `${f.skin ?? 'plain'}|${f.logo}|${f.skinLogo ?? '-'}`))];
    const XLOGO = '/logo-xmas.png';
    const mustBefore = (r, what) => assert(r.before.length >= 3, `${what}: the games came too soon to see the first frames (${r.before.length})`);

    await check('A remembered ON: the first frame wears the theme and the Christmas logo (loaded); the games land and nothing moves', async () => {
      for (const saved of [true, false]) {
        const { page, ctx, errors } = await phone('Parker');
        await mem(page, { pb_xmas_theme: 'on', pb_xmas_mode: 'all', ...(saved ? {} : { pb_last_screen: null }) });
        const r = await frames(page);
        mustBefore(r, 'A');
        const tag = saved ? 'saved screen' : 'shimmer';
        assert(r.first.skin === 'christmas', `A ${tag}: first frame ${JSON.stringify(r.first)}`);
        assert(r.first.logo === XLOGO && r.first.skinLogo === 'all', `A ${tag}: first frame logo ${JSON.stringify(r.first)}`);
        const firstLoaded = r.all.findIndex((f) => f.loaded);
        assert(firstLoaded >= 0 && firstLoaded <= 2, `A ${tag}: the Christmas logo picture is ready by frame ${firstLoaded}`);
        assert(looks(r.all).length === 1, `A ${tag}: the look changed: ${looks(r.all)}`);
        assert(r.all.every((f) => !f.anim), `A ${tag}: a pop-in marker showed`);
        assert(errors.length === 0, errors.join('; '));
        await page.screenshot({ path: path.join(SHOTS, `A-${saved ? 'saved' : 'shimmer'}-after.png`) });
        await ctx.close();
      }
    });

    await check('B remembered Everyone, theme OFF: the Christmas logo from the first frame, the page plain; nothing moves', async () => {
      const { page, ctx, errors } = await phone('Parker');
      await mem(page, { pb_xmas_theme: 'off', pb_xmas_mode: 'all' });
      const r = await frames(page);
      mustBefore(r, 'B');
      assert(r.first.skin === null && r.first.logo === XLOGO && r.first.skinLogo === 'all', `B first frame ${JSON.stringify(r.first)}`);
      assert(looks(r.all).length === 1, `B the look changed: ${looks(r.all)}`);
      assert(r.all.every((f) => !f.anim), 'B a pop-in marker showed');
      assert(errors.length === 0, errors.join('; '));
      await ctx.close();
    });

    await check('C first visit: plain first frame as before; the logo comes with the games; the mode is written down', async () => {
      const { page, ctx, errors } = await phone('Parker');
      await mem(page, { pb_xmas_mode: null, pb_xmas_theme: null });
      const r = await frames(page);
      mustBefore(r, 'C');
      assert(r.before.every((f) => f.skin === null && f.logo !== XLOGO), `C before: ${looks(r.before)}`);
      assert(r.after.at(-1).logo === XLOGO, `C after: ${JSON.stringify(r.after.at(-1))}`);
      assert((await page.evaluate(() => localStorage.getItem('pb_xmas_mode'))) === 'all', 'C memory');
      assert(errors.length === 0, errors.join('; '));
      await ctx.close();
    });

    await check('D remembered OFF: plain first frame, plain after', async () => {
      await b.call('PUT', '/api/admin/christmas-skin-switch', { mode: 'off' });
      try {
        const { page, ctx, errors } = await phone('Parker');
        await mem(page, { pb_xmas_mode: 'off', pb_xmas_theme: 'on' });
        const r = await frames(page);
        mustBefore(r, 'D');
        assert(r.all.every((f) => f.skin === null && f.logo !== XLOGO), `D: ${looks(r.all)}`);
        assert(errors.length === 0, errors.join('; '));
        await ctx.close();
      } finally {
        await b.call('PUT', '/api/admin/christmas-skin-switch', { mode: 'all' });
      }
    });

    await check('E server Off on a remembered ON phone: dressed, then plain once (no motion); the memory says off; next load plain from the start', async () => {
      const { page, ctx, errors } = await phone('Parker');
      await mem(page, { pb_xmas_theme: 'on', pb_xmas_mode: 'all' });
      await b.call('PUT', '/api/admin/christmas-skin-switch', { mode: 'off' });
      try {
        const r = await frames(page);
        mustBefore(r, 'E');
        assert(r.first.skin === 'christmas' && r.first.logo === XLOGO, `E first: ${JSON.stringify(r.first)}`);
        const last = r.all.at(-1);
        assert(last.skin === null && last.logo !== XLOGO, `E last: ${JSON.stringify(last)}`);
        const seq = looks(r.all);
        assert(seq.length === 2, `E the look should change exactly once: ${seq}`);
        assert(r.all.every((f) => !f.anim), 'E motion on the way back');
        assert((await page.evaluate(() => localStorage.getItem('pb_xmas_mode'))) === 'off', 'E memory');
        await page.evaluate(() => (window.__frames = []));
        const again = await frames(page);
        assert(again.all.every((f) => f.skin === null && f.logo !== XLOGO), `E next load: ${looks(again.all)}`);
        assert(errors.length === 0, errors.join('; '));
      } finally {
        await b.call('PUT', '/api/admin/christmas-skin-switch', { mode: 'all' });
        await ctx.close();
      }
    });

    await check('F Just me on the server: Parker (remembered Everyone, theme on) goes plain once; Alex keeps the normal logo', async () => {
      const p = await phone('Parker');
      await mem(p.page, { pb_xmas_theme: 'on', pb_xmas_mode: 'all' });
      await b.call('PUT', '/api/admin/christmas-skin-switch', { mode: 'me' });
      try {
        const r = await frames(p.page);
        const last = r.all.at(-1);
        assert(last.skin === null && last.logo !== XLOGO && !last.skinLogo, `F Parker last: ${JSON.stringify(last)}`);
        assert(looks(r.all).length === 2, `F Parker changes once: ${looks(r.all)}`);
        assert((await p.page.evaluate(() => localStorage.getItem('pb_xmas_mode'))) === 'off', 'F Parker memory');
        await p.ctx.close();
        const a = await phone('Alex', { organizer: true });
        await mem(a.page, { pb_xmas_mode: 'all', pb_xmas_theme: 'off' });
        const ra = await frames(a.page);
        const la = ra.all.at(-1);
        assert(la.logo !== XLOGO && la.skinLogo === 'me', `F Alex last: ${JSON.stringify(la)}`);
        assert((await a.page.evaluate(() => localStorage.getItem('pb_xmas_mode'))) === 'me-off', 'F Alex memory');
        await a.ctx.close();
      } finally {
        await b.call('PUT', '/api/admin/christmas-skin-switch', { mode: 'all' });
      }
    });

    await check('G /admin never: every memory ON, no frame of /admin has the theme or the Christmas logo', async () => {
      const { page, ctx, errors } = await b.newPage({ organizer: true });
      await ctx.addInitScript(recorder);
      await page.goto(`${b.BASE}/admin`);
      await mem(page, { pb_xmas_theme: 'on', pb_xmas_mode: 'all' });
      await page.reload();
      await page.locator('.tab-bar, nav').first().waitFor({ timeout: 30000 });
      await page.waitForTimeout(1500);
      const all = await page.evaluate(() => window.__frames);
      assert(all.length > 5, 'G frames');
      assert(all.every((f) => f.skin === null && f.logo !== XLOGO && !f.skinLogo), `G: ${looks(all)}`);
      const marks = await page.evaluate(() => [document.documentElement.getAttribute('data-skin-early'), document.querySelectorAll('link[href="/logo-xmas.png"]').length]);
      assert(marks[0] === null && marks[1] === 0, `G marks ${marks}`);
      assert(errors.length === 0, errors.join('; '));
      await ctx.close();
    });

    await check('H remembered ON at 375 / 390 / 420 / 440, light and dark, reduced motion on and off: the first frame dressed, nothing wider', async () => {
      const bad = [];
      for (const scheme of ['light', 'dark'])
        for (const reducedMotion of ['reduce', 'no-preference'])
          for (const width of [375, 390, 420, 440]) {
            const t = `${scheme} ${width} ${reducedMotion}`;
            const { page, ctx, errors } = await phone('Parker', { width, scheme, reducedMotion });
            await mem(page, { pb_xmas_theme: 'on', pb_xmas_mode: 'all' });
            await page.reload({ waitUntil: 'commit' });
            await page.waitForFunction(() => window.__frames && window.__frames.filter((f) => f.drawn).length > 3, null, { timeout: 30000 });
            const early = await page.evaluate(() => window.__frames.filter((f) => f.drawn)[0]);
            if (!(early.skin === 'christmas' && early.logo === XLOGO)) bad.push(`${t}: first ${JSON.stringify(early)}`);
            if (early.games) bad.push(`${t}: the games came too soon`);
            if (width === 390) await page.screenshot({ path: path.join(SHOTS, `H-first-${scheme}-${reducedMotion}-390.png`) });
            await page.waitForFunction(() => window.__frames.some((f) => f.games), null, { timeout: 30000 });
            await page.waitForTimeout(900);
            const all = await page.evaluate(() => window.__frames.filter((f) => f.drawn));
            if (looks(all).length !== 1) bad.push(`${t}: changed ${looks(all)}`);
            if (all.some((f) => f.anim)) bad.push(`${t}: pop-in marker`);
            const w = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
            if (w[0] > w[1]) bad.push(`${t}: page ${w[0]} on ${w[1]}`);
            if (errors.length) bad.push(`${t}: ${errors.join('; ')}`);
            await page.screenshot({ path: path.join(SHOTS, `H-after-${scheme}-${reducedMotion}-${width}.png`) });
            await ctx.close();
          }
      assert(bad.length === 0, bad.join('\n'));
    });
  } finally {
    await b.call('PUT', '/api/admin/christmas-skin-switch', { mode: 'off' }).catch(() => {});
    await b.close();
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
