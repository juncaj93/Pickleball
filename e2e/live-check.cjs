/* Read-only checks against the real site. Creates nothing, changes nothing.
 *
 *   LIVE_URL=https://pickleball-club.pages.dev node e2e/live-check.cjs
 */
const { chromium } = require('playwright');

const BASE = (process.env.LIVE_URL || '').replace(/\/$/, '');
if (!BASE) throw new Error('Set LIVE_URL');
let failed = 0;
const ok = (cond, name) => {
  console.log(`  ${cond ? '✓' : '✗'} ${name}`);
  if (!cond) failed++;
};

(async () => {
  const home = await fetch(BASE + '/');
  ok(home.status === 200, 'home page loads');
  ok(/x-robots-tag|noindex/i.test([...home.headers].join(' ')), 'search engines told to stay away');
  ok(home.headers.get('referrer-policy') === 'no-referrer', 'links never leak to other sites');
  ok(!!home.headers.get('content-security-policy'), 'browser security policy is on');
  const status = await (await fetch(BASE + '/api/status')).json();
  ok(status.setupEnabled === true, 'setup code is configured');
  console.log(`    (group already set up: ${status.setupComplete ? 'yes' : 'no'})`);
  ok((await fetch(BASE + '/api/admin/dashboard')).status === 401, 'organizer area needs the PIN');
  const wrong = await fetch(BASE + '/api/setup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ setupToken: 'definitely-not-the-code', groupName: 'x', pin: '000000', players: [{ name: 'x' }] }),
  });
  ok(wrong.status === 401 || wrong.status === 409, 'setup refuses a wrong setup code');
  ok((await fetch(BASE + '/robots.txt').then((r) => r.text())).includes('Disallow: /'), 'robots.txt blocks indexing');

  const proxy = process.env.HTTPS_PROXY ? { proxy: { server: process.env.HTTPS_PROXY } } : {};
  const browser = await chromium.launch(proxy);
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(BASE + '/setup');
  ok(await page.getByRole('heading', { name: 'Set up your group' }).isVisible().catch(() => false), 'setup page shows on a phone-sized screen');
  await page.goto(BASE + '/');
  await page.waitForLoadState('networkidle');
  ok(errors.length === 0, `no browser errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
  await browser.close();
  console.log(failed ? `\n${failed} failed` : '\nall live checks passed');
  process.exit(failed ? 1 : 0);
})();
