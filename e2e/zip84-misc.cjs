/* Zip 84 (🎾84.final dry run): look at the organizer's tournament card at 320 on the vote_majority stage (zip60 D's "sticks out").
 *   node e2e/zip84-misc.cjs   Screenshots: .data/zip84-misc */
const path = require('node:path');
const { mkdirSync } = require('node:fs');
const { boot, ROOT } = require('./zip74-boot.cjs');
const SHOTS = path.join(ROOT, '.data', 'zip84-misc');
(async () => {
  mkdirSync(SHOTS, { recursive: true });
  const h = await boot({ port: Number(process.env.E2E_PORT) || 5845, name: 'zip84misc', seedIso: '2026-11-17T14:00:00.000Z', nowMs: Date.parse('2026-11-17T15:00:00.000Z') });
  try {
    await h.stage('vote_majority');
    for (const width of [320, 360, 390]) {
      const a = await h.adminHome({ width });
      const t = a.page.locator('[data-tm-home-toggle][aria-expanded="false"]');
      if (await t.count()) { await t.first().click(); await a.page.locator('[data-tm-home-body]').first().waitFor({ timeout: 10000 }); }
      await a.page.waitForTimeout(500);
      const r = await a.page.evaluate(() => {
        const root = document.querySelector('[data-tm-home]');
        const box = root.getBoundingClientRect();
        const bad = [];
        for (const el of root.querySelectorAll('*')) {
          const b = el.getBoundingClientRect();
          if (!b.width || !b.height || getComputedStyle(el).position === 'absolute') continue;
          if (b.right > box.right + 1 || b.left < box.left - 1) bad.push({ cls: el.className, text: el.textContent.trim().slice(0, 80), left: b.left, right: b.right, boxR: box.right, sw: el.scrollWidth, cw: el.clientWidth, row: el.parentElement && el.parentElement.textContent.trim().slice(0, 80) });
        }
        return { bad, page: [document.documentElement.scrollWidth, innerWidth] };
      });
      console.log(width, JSON.stringify(r));
      const el = a.page.locator('[data-tm-home]').first();
      await el.screenshot({ path: path.join(SHOTS, `card-${width}.png`) });
      await a.ctx.close();
    }
  } finally {
    await h.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
