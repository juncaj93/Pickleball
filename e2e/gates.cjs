/* Spacing on the small gate pages: "Who are you?", the Add my name form, the
 * link-only page and the group-word page.
 *
 *   node e2e/gates.cjs      (also run by npm run test:e2e)
 *
 * Starts its own dev server with a fresh fake group. At 360, 375, 390 and
 * 430px in light and dark it checks that "Organizer sign-in" sits right under
 * the last button (the visible gap is no more than 16px), is centered, and
 * that the name buttons, "Add my name" and the page bottom use the site's
 * usual spacing, with no overlap or cut-off text.
 */
const { spawn } = require('node:child_process');
const { rmSync, mkdirSync } = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.E2E_PORT) || 5195;
const BASE = `http://localhost:${PORT}`;
const SETUP_TOKEN = 'gates-setup-token-0123456789';
const PIN = '482913';
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

let passed = 0;
let failed = 0;
async function check(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.log(`  ✗ ${name}\n      ${String(err && err.message ? err.message : err).replace(/\s*\n\s*/g, ' ⏎ ').slice(0, 500)}`);
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function main() {
  const dbFile = path.join(ROOT, '.data', 'gates.sqlite');
  mkdirSync(path.join(ROOT, '.data'), { recursive: true });
  rmSync(dbFile, { force: true });
  const server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
    cwd: ROOT,
    env: { ...process.env, DEV_DB: dbFile, SETUP_TOKEN },
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
  const browser = await chromium.launch();
  const api = await browser.newContext();
  const call = async (method, url, data) => {
    const res = await api.request.fetch(BASE + url, { method, data, headers: { Origin: BASE } });
    if (!res.ok()) throw new Error(`${method} ${url}: ${res.status()} ${await res.text()}`);
  };
  await call('POST', '/api/setup', {
    setupToken: SETUP_TOKEN,
    groupName: 'Pickleball Bros',
    pin: PIN,
    players: ['Alex', 'Alec', 'Armen', 'Ryan', 'Brandon', 'Julian', 'Mitchel', 'Nathan'].map((name) => ({ name })),
  });
  // Open address, no word: "Who are you?". Then the group word and link-only pages.
  const mode = (data) => call('PUT', '/api/admin/group', data);
  await mode({ openAccess: true, groupWord: null });

  /** Gaps (px) between the page's pieces, measured from what you can see. */
  const measure = (page) =>
    page.evaluate(() => {
      const box = (el) => el.getBoundingClientRect();
      const main = document.querySelector('main');
      const kids = [...main.querySelectorAll('button, a.organizer, .organizer-link a, input, label, p, h2, form')].filter((e) => e.checkVisibility());
      const link = main.querySelector('.organizer-link a');
      // The visible text, not its invisible 44px tap area.
      const range = link && document.createRange();
      if (range) range.selectNodeContents(link);
      const text = range ? box(range) : null;
      const buttons = [...main.querySelectorAll('button, .btn')].filter((e) => e.checkVisibility() && !e.closest('header'));
      const lastBtn = buttons.length ? buttons.reduce((a, b) => (box(b).bottom > box(a).bottom ? b : a)) : null;
      const grid = main.querySelector('.name-grid');
      const gridBtns = grid ? [...grid.querySelectorAll('.btn')].map(box) : [];
      const rowGap = gridBtns.length > 2 ? gridBtns[2].top - gridBtns[0].bottom : null;
      const after = grid && grid.nextElementSibling ? box(grid.nextElementSibling).top - box(grid).bottom : null;
      return {
        linkGap: text && lastBtn ? Math.round((text.top - box(lastBtn).bottom) * 10) / 10 : null,
        linkCenter: text ? Math.round(((text.left + text.right) / 2 - innerWidth / 2) * 10) / 10 : null,
        linkOverlap: link && lastBtn ? box(link).top < box(lastBtn).bottom - 0.5 : false,
        rowGap,
        gridToAdd: after,
        // Room under the last thing on the page, inside the page itself (a short page just leaves empty screen below).
        bottomRoom: Math.round((box(main).bottom - (text ? text.bottom : box(lastBtn).bottom)) * 10) / 10,
        sideways: document.documentElement.scrollWidth - innerWidth,
        cut: [...main.querySelectorAll('button, a, label, p, h2')].filter((e) => e.checkVisibility() && (box(e).right > innerWidth + 1 || box(e).left < -1)).length,
        count: kids.length,
      };
    });

  for (const width of [360, 375, 390, 430]) {
    for (const scheme of ['light', 'dark']) {
      const opts = { viewport: { width, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: scheme, reducedMotion: 'reduce', userAgent: IPHONE_UA };
      const open = async (page) => {
        await page.goto(BASE + '/');
        await page.waitForLoadState('networkidle');
      };
      const tag = `${width}px (${scheme})`;
      const ctx = await browser.newContext(opts);
      const page = await ctx.newPage();

      await mode({ openAccess: true, groupWord: null });
      await open(page);
      await check(`"Who are you?" at ${tag}: "Organizer sign-in" right under "Add my name" (gap 12 to 16px), centered; names 10px apart; same gap before "Add my name"; nothing overlaps or is cut off`, async () => {
        await page.getByRole('button', { name: 'Add my name' }).waitFor();
        await page.getByRole('link', { name: 'Organizer sign-in' }).waitFor();
        const m = await measure(page);
        assert(m.linkGap >= 12 && m.linkGap <= 16, `gap under "Add my name" is ${m.linkGap}px`);
        assert(Math.abs(m.linkCenter) <= 1, `link is ${m.linkCenter}px off center`);
        assert(!m.linkOverlap, 'the link overlaps the button');
        assert(m.rowGap === 10, `name buttons are ${m.rowGap}px apart`);
        assert(m.gridToAdd >= 10 && m.gridToAdd <= 14, `gap before "Add my name" is ${m.gridToAdd}px`);
        assert(m.bottomRoom >= 24 && m.bottomRoom <= 60, `room at the page bottom is ${m.bottomRoom}px`);
        assert(m.sideways <= 0 && m.cut === 0, 'something sticks out sideways or is cut off');
        // The link still works as before.
        assert((await page.getByRole('link', { name: 'Organizer sign-in' }).getAttribute('href')) === '/admin', 'link goes to /admin');
        const tap = await page.getByRole('link', { name: 'Organizer sign-in' }).boundingBox();
        assert(tap.height >= 44, `the link's tap area is ${tap.height}px tall`);
      });

      await check(`Add my name form at ${tag}: fields and buttons use even spacing, nothing overlaps or is cut off`, async () => {
        await page.getByRole('button', { name: 'Add my name' }).click();
        await page.getByRole('button', { name: /^Back|^Cancel/ }).first().waitFor();
        const gaps = await page.evaluate(() => {
          const els = [...document.querySelectorAll('main form > *, main section > *')].filter((e) => e.checkVisibility());
          const r = els.map((e) => e.getBoundingClientRect());
          return r.slice(1).map((b, i) => Math.round((b.top - r[i].bottom) * 10) / 10);
        });
        assert(gaps.length > 0 && gaps.every((g) => g >= 6 && g <= 16), `uneven gaps in the form: ${gaps}`);
        const m = await measure(page);
        assert(m.sideways <= 0 && m.cut === 0, 'something sticks out sideways or is cut off');
        await page.getByRole('button', { name: /^Back/ }).click();
      });

      await mode({ openAccess: true, groupWord: 'dinks' });
      await open(page);
      await check(`Group word page at ${tag}: "Organizer sign-in" right under "Continue" (gap 12 to 16px), centered; nothing overlaps or is cut off`, async () => {
        await page.getByRole('button', { name: 'Continue' }).waitFor();
        const m = await measure(page);
        assert(m.linkGap >= 12 && m.linkGap <= 16, `gap under "Continue" is ${m.linkGap}px`);
        assert(Math.abs(m.linkCenter) <= 1, `link is ${m.linkCenter}px off center`);
        assert(!m.linkOverlap, 'the link overlaps the button');
        assert(m.sideways <= 0 && m.cut === 0, 'something sticks out sideways or is cut off');
      });

      await mode({ openAccess: false, groupWord: null });
      await open(page);
      await check(`Link-only page at ${tag}: "Organizer sign-in" right under the text (gap 12 to 16px), centered; nothing overlaps or is cut off`, async () => {
        await page.getByText('Open the link your organizer sent you').waitFor();
        const lastGroup = await page.getByRole('button', { name: 'Open my group' }).count();
        const m = await measure(page);
        // No button on this page unless the phone remembers a group; then the gap is measured from the last thing above.
        const gap = await page.evaluate(() => {
          const p = document.querySelector('main > p:not(.organizer-link)');
          const link = document.createRange();
          link.selectNodeContents(document.querySelector('.organizer-link a'));
          return Math.round((link.getBoundingClientRect().top - p.getBoundingClientRect().bottom) * 10) / 10;
        });
        assert(lastGroup > 0 ? m.linkGap >= 12 && m.linkGap <= 16 : gap >= 12 && gap <= 16, `gap above the link is ${lastGroup > 0 ? m.linkGap : gap}px`);
        assert(Math.abs(m.linkCenter) <= 1, `link is ${m.linkCenter}px off center`);
        assert(m.sideways <= 0 && m.cut === 0, 'something sticks out sideways or is cut off');
      });
      await ctx.close();
    }
  }
  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
