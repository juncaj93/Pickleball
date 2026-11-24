/* Zip 84 (🎾84.final dry run): Alex's exact path for the holidays, in a real browser (390 px, light), clock Mon Nov 23 2026 9:30 PM Eastern:
 * "Winter 2026" already saved, then Settings > Schedule > Special venue hours > Add special hours > One day, five times, tapping like a person
 * (no 4 second wait for the toast). Logs every venue-hours request, its status, any problem line, then reloads and reads the list.
 *   node e2e/zip84-venue.cjs     Screenshots: .data/zip84-venue */
const path = require('node:path');
const { mkdirSync } = require('node:fs');
const { boot, flat, ROOT } = require('./zip74-boot.cjs');
const SHOTS = path.join(ROOT, '.data', 'zip84-venue');
const NOW = Date.parse('2026-11-24T02:30:00.000Z');
const H = (h, m = 0) => h * 60 + m;
const winterWeek = [0, 1, 2, 3, 4, 5, 6].map((d) => ({ open: H(8), close: d === 0 ? H(19) : H(23) }));
const HOLIDAYS = [
  { name: 'Thanksgiving', date: '2026-11-26', end: '12:00' },
  { name: 'Christmas Eve', date: '2026-12-24', end: '14:00' },
  { name: 'Christmas', date: '2026-12-25', closed: true },
  { name: 'New Year’s Eve', date: '2026-12-31', end: '23:00' },
  { name: 'New Year’s Day', date: '2027-01-01', end: '23:00' },
];
(async () => {
  mkdirSync(SHOTS, { recursive: true });
  const h = await boot({ port: Number(process.env.E2E_PORT) || 5847, name: 'zip84venue', seedIso: '2026-11-23T14:00:00.000Z', nowMs: NOW });
  const log = [];
  try {
    await h.stage('venue_none');
    await h.call('POST', '/api/admin/venue-hours/special', { name: 'Winter 2026', oneDay: false, from: '2026-11-23', to: '2027-01-31', week: winterWeek });
    const a = await h.adminHome({ width: 390, scheme: 'light' });
    const page = a.page;
    page.on('response', async (r) => {
      if (/venue-hours|\/api\/admin\/group$/.test(r.url())) log.push(`${r.request().method()} ${r.url().replace(h.BASE, '')} -> ${r.status()} ${r.status() >= 400 ? await r.text() : ''}`);
    });
    page.on('console', (m) => m.type() === 'error' && log.push(`console: ${m.text()}`));
    await page.locator('.tabbar button, .tab-bar button', { hasText: 'Settings' }).first().click();
    const sect = page.locator('details[data-section="schedule"]');
    await sect.waitFor({ timeout: 10000 });
    if (!(await sect.evaluate((el) => el.open))) await sect.locator('summary').click();
    await page.locator('[data-special-change]').click();
    await page.locator('[data-vh-list]').waitFor({ timeout: 5000 });
    await page.screenshot({ path: path.join(SHOTS, '0-list.png') });
    const tryClick = async (loc, what) => {
      try {
        await loc.click({ timeout: 2500 });
      } catch (e) {
        log.push(`${what}: first tap did not land (${String(e.message).split('\n').find((l) => /intercept|not visible|outside/.test(l)) || 'timeout'})`);
        await page.waitForTimeout(3000);
        await loc.click();
      }
    };
    for (const [i, x] of HOLIDAYS.entries()) {
      await tryClick(page.locator('[data-vh-add]'), `${x.name} Add`);
      await page.locator('[data-vh-name]').fill(x.name);
      await page.locator('[data-vh-kind="day"]').click();
      await page.locator('[data-vh-date]').fill(x.date);
      const defaults = `${flat(await page.locator('[data-vh-day-open]').innerText())} to ${flat(await page.locator('[data-vh-day-close]').innerText())}`;
      log.push(`${x.name}: the form starts at ${defaults}`);
      if (x.closed) await page.locator('[data-vh-closed-day]').click();
      else {
        await page.locator('[data-vh-day-close]').scrollIntoViewIfNeeded();
        await page.locator('[data-vh-day-close]').click();
        const grid = page.locator('.bh-grid-sheet [data-bh-grid]');
        await grid.waitFor({ timeout: 5000 });
        const chip = grid.locator(`[data-chip="${x.end}"]`);
        log.push(`${x.name}: grid chip ${x.end} disabled=${await chip.isDisabled()}`);
        await chip.click();
        await grid.waitFor({ state: 'detached', timeout: 5000 });
        await page.waitForTimeout(200);
        const stillForm = await page.locator('[data-vh-form]').count();
        log.push(`${x.name}: after the grid the form is ${stillForm ? 'still open' : 'GONE'}; times ${flat(await page.locator('[data-vh-day-open]').innerText().catch(() => '?'))} to ${flat(await page.locator('[data-vh-day-close]').innerText().catch(() => '?'))}`);
      }
      await page.screenshot({ path: path.join(SHOTS, `${i + 1}-${x.date}-form.png`) });
      await tryClick(page.locator('[data-vh-save]'), `${x.name} Save`);
      await page.waitForTimeout(900);
      const problem = await page.locator('[data-vh-problem]').count() ? flat(await page.locator('[data-vh-problem]').innerText()) : null;
      const onList = await page.locator(`[data-vh-item="${x.name}"]`).count();
      log.push(`${x.name}: problem=${problem ?? 'none'}; in the list=${onList > 0}`);
      await page.screenshot({ path: path.join(SHOTS, `${i + 1}-${x.date}-after.png`) });
      if (problem) await page.getByRole('dialog').getByRole('button', { name: 'Close' }).last().click();
    }
    await page.reload();
    await page.locator('.tabbar, nav').first().waitFor();
    const d = await h.call('GET', '/api/admin/dashboard');
    log.push(`after reload, saved: ${d.group.venueHours.specials.map((e) => e.name).join(', ')}`);
    log.push(`Activity: ${d.audit.filter((e) => /venue/.test(e.action || e.kind || '')).length} venue lines`);
    log.push(`page errors: ${a.errors.join('; ') || 'none'}`);
  } finally {
    console.log(log.join('\n'));
    await h.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
