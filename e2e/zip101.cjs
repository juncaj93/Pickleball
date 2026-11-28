/* Zip 101 (🎾101.monday weeks, Alex, Nov 27): the player screen's THIS WEEK / NEXT WEEK / LATER use Monday to Sunday weeks, the same weeks
 * as the organizer screens. On Fri Nov 27: Sun Nov 29 = THIS WEEK; Tue Dec 1 and Wed Dec 2 = NEXT WEEK. On a Sunday that Tuesday's game
 * shows under NEXT WEEK (the trade-off Alex accepted).
 *
 *   node e2e/zip101.cjs                  (ZIP101_ONLY=A,B runs some)
 *
 * The preview's calm world on a local server; The Cold Open on Tue Dec 1 (zip86_next staged on Fri Nov 27), a Sunday Nov 29 10 AM game and a
 * Wednesday Dec 2 game added, the Christmas skin on for everyone.
 *   A   The clock walks Fri Nov 27 noon, Sat Nov 28 noon, Sun Nov 29 9 AM and 11:30 PM, Mon Nov 30 12:01 AM, Tue Dec 1 noon: every game sits
 *       under the heading its Monday week gives; no empty heading; the small tournament row only next week or later, and hidden when it
 *       would be the first card (🎾99); one snow cap, on the first game card.
 *   B   Fri and Sun at 375 / 390 / 420 / 440, light and dark: the same headings, nothing wider than the screen, no errors.
 * Screenshots: .data/zip101-shots (not in git).
 */
const path = require('node:path');
const { mkdirSync } = require('node:fs');
const { boot, assert, ROOT } = require('./zip74-boot.cjs');

const SHOTS = path.join(ROOT, '.data', 'zip101-shots');
const ONLY = process.env.ZIP101_ONLY || '';
const FRI = Date.parse('2026-11-27T17:00:00.000Z'); // Fri Nov 27, 12:00 PM Eastern
const CLOCKS = [
  ['fri', FRI],
  ['sat', Date.parse('2026-11-28T17:00:00.000Z')],
  ['sun9am', Date.parse('2026-11-29T14:00:00.000Z')],
  ['sun1130pm', Date.parse('2026-11-30T04:30:00.000Z')],
  ['mon1201am', Date.parse('2026-11-30T05:01:00.000Z')],
  ['tue', Date.parse('2026-12-01T17:00:00.000Z')],
];
const DAY = 86_400_000;
/** Day number of the Monday that starts the Eastern week of `ms` (EST all of these weeks: UTC-5). */
const mondayOf = (ms) => {
  const d = new Date(ms - 5 * 3600_000);
  const day = Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / DAY);
  return day - ((d.getUTCDay() + 6) % 7);
};
const tierOf = (ms, now) => {
  const diff = mondayOf(ms) - mondayOf(now);
  return diff <= 0 ? 'This week' : diff === 7 ? 'Next week' : 'Later';
};
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

/** The list in order: headings ('h:Next week'), game cards (their start), the tournament row ('row'); empty headings; where the snow sits. */
function listFacts(page) {
  return page.evaluate(() => {
    const items = [...document.querySelectorAll('.schedule > .week-break:not(.filter-only), .schedule > .sched, .schedule > .tw-row')].map((el) =>
      el.classList.contains('week-break')
        ? `h:${el.querySelector('h3')?.textContent ?? ''}`
        : el.classList.contains('tw-row')
          ? 'row'
          : `g:${el.id.replace('row-', '')}`,
    );
    const empty = items.filter((x, i) => x.startsWith('h:') && (i === items.length - 1 || items[i + 1].startsWith('h:')));
    const firstGame = document.querySelector('.schedule > .sched');
    return {
      items,
      empty,
      big: document.querySelectorAll('[data-tournament] .tc-card, [data-tournament] [data-tc-card], .tc-wrap').length > 0,
      capped: document.querySelectorAll('.xs-top').length,
      capOnFirstGame: !!(firstGame && firstGame.classList.contains('xs-top')),
      skin: document.documentElement.getAttribute('data-skin'),
    };
  });
}

(async () => {
  mkdirSync(SHOTS, { recursive: true });
  const b = await boot({ name: 'zip101', port: Number(process.env.E2E_PORT) || 5501, seedIso: '2026-11-27T14:00:00.000Z', nowMs: FRI });
  try {
    await b.call('PUT', '/api/admin/christmas-skin-switch', { mode: 'all' });
    const made = await b.stage('zip86_next');
    const tour = (await b.call('GET', '/api/admin/dashboard')).tournament;
    assert(made.ok, 'staged');
    await b.call('POST', '/api/admin/sessions', { startsAt: '2026-11-29T15:00:00.000Z', endsAt: '2026-11-29T17:00:00.000Z', note: null }); // Sun Nov 29 10 AM
    await b.call('POST', '/api/admin/sessions', { startsAt: '2026-12-03T01:00:00.000Z', endsAt: '2026-12-03T03:00:00.000Z', note: null }); // Wed Dec 2 8 PM
    const tourAt = Date.parse('2026-12-02T00:30:00.000Z'); // The Cold Open, Tue Dec 1, 7:30 PM
    void tour;
    const themeOn = async (page) => {
      const logo = page.locator('button.skin-logo');
      await logo.waitFor({ timeout: 15000 });
      if ((await page.evaluate(() => document.documentElement.getAttribute('data-skin'))) !== 'christmas') await logo.click();
      await page.waitForTimeout(500);
    };
    /** Opens Parker's Home at `now`, LATER unfolded, theme on; returns the facts and what each item should sit under. */
    async function look(now, opts = {}) {
      await b.setClock(now);
      const { page, ctx, errors } = await b.playerPage('Parker', opts);
      await themeOn(page);
      const more = page.locator('[data-later-toggle]');
      if ((await more.count()) && /more/i.test(await more.first().innerText())) {
        await more.first().click();
        await page.waitForTimeout(500);
      }
      const f = await listFacts(page);
      const starts = new Map((await (await ctx.request.get(b.BASE + '/api/group')).json()).sessions.map((s) => [s.id, Date.parse(s.startsAt)]));
      const wrong = [];
      let heading = null;
      for (const it of f.items) {
        if (it.startsWith('h:')) heading = it.slice(2);
        else {
          const at = it === 'row' ? tourAt : starts.get(it.slice(2));
          const want = tierOf(at, now);
          if (heading?.toLowerCase() !== want.toLowerCase()) wrong.push(`${it === 'row' ? 'tournament row' : new Date(at).toISOString()} under ${heading}, want ${want}`);
        }
      }
      const named = f.items.map((x) => (x.startsWith('g:') ? new Date(starts.get(x.slice(2)) - 5 * 3600_000).toISOString().slice(5, 10) : x));
      return { page, ctx, errors, f, wrong, named, starts };
    }

    await check('A the clock from Fri to Tue: Monday weeks, no empty heading, the 🎾99 row rule, snow on the first game', async () => {
      const bad = [];
      for (const [tag, now] of CLOCKS) {
        const { page, ctx, errors, f, wrong, named, starts } = await look(now, { width: 390 });
        console.log(`      ${tag}: ${named.join(' ')}`);
        bad.push(...wrong.map((w) => `${tag}: ${w}`));
        if (f.empty.length) bad.push(`${tag}: empty heading ${f.empty}`);
        const firstCard = f.items.find((x) => !x.startsWith('h:'));
        if (f.big && firstCard === 'row') bad.push(`${tag}: the row is first under the big card`);
        // The row shows only next week or later; when the tournament is next week and some game comes before it in the list it stays (🎾99).
        const tourTier = tierOf(tourAt, now);
        const before = [...starts.values()].some((ms) => ms > now && ms < tourAt);
        if (tourTier === 'This week' && f.items.includes('row')) bad.push(`${tag}: a row in THIS WEEK`);
        if (tourTier !== 'This week' && f.big && before && !f.items.includes('row')) bad.push(`${tag}: the row should stay (a game before it)`);
        if (!(f.skin === 'christmas' && f.capped === 1 && f.capOnFirstGame)) bad.push(`${tag}: snow ${JSON.stringify(f)}`);
        if (errors.length) bad.push(`${tag}: ${errors.join('; ')}`);
        await page.screenshot({ path: path.join(SHOTS, `A-${tag}-390.png`), fullPage: true });
        await ctx.close();
      }
      // Alex's picture: on Fri Nov 27 Sun Nov 29 is THIS WEEK, Tue Dec 1 and Wed Dec 2 NEXT WEEK; on Sunday the Tuesday is NEXT WEEK.
      const fri = await look(FRI, { width: 390 });
      const sun = fri.named.indexOf('11-29');
      assert(sun > 0 && fri.named[sun - 1] === 'h:This week', `Fri: Sun Nov 29 under THIS WEEK: ${fri.named}`);
      assert(fri.named.indexOf('h:Next week') > sun && fri.named.indexOf('12-01') > fri.named.indexOf('h:Next week') && fri.named.indexOf('12-02') > fri.named.indexOf('h:Next week'), `Fri: Dec 1 and 2 under NEXT WEEK: ${fri.named}`);
      await fri.ctx.close();
      assert(bad.length === 0, bad.join('\n'));
    });

    await check('B Fri and Sun at 375 / 390 / 420 / 440, light and dark', async () => {
      const bad = [];
      for (const [tag, now] of [CLOCKS[0], CLOCKS[2]]) {
        for (const scheme of ['light', 'dark']) {
          for (const width of [375, 390, 420, 440]) {
            const { page, ctx, errors, f, wrong } = await look(now, { width, scheme });
            const t = `${tag} ${scheme} ${width}`;
            bad.push(...wrong.map((w) => `${t}: ${w}`));
            if (f.empty.length) bad.push(`${t}: empty heading`);
            if (!(f.capped === 1 && f.capOnFirstGame)) bad.push(`${t}: snow`);
            const w = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
            if (w[0] > w[1]) bad.push(`${t}: page ${w[0]} on ${w[1]}`);
            if (errors.length) bad.push(`${t}: ${errors.join('; ')}`);
            await page.screenshot({ path: path.join(SHOTS, `B-${tag}-${width}-${scheme}.png`) });
            await ctx.close();
          }
        }
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
