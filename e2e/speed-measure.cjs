/* Zip 12: times the player's first useful screen on a DEPLOYED preview (fake data only), the same way the Zip 9c speed check did:
 * requests on the first screen, and time to the first game card on fast 3G and slow 3G, first visit (empty cache) and repeat visit.
 *
 *   node e2e/speed-measure.cjs https://<preview>.pickleball-club-9h0.pages.dev [runs=3] [query]
 *
 * Network: Chrome DevTools presets (fast 3G 562 ms, 1.44 Mbps down; slow 3G 2000 ms, 400 kbps down). The phone already picked a
 * name (it is a returning player); "first visit" = nothing in the browser cache, "repeat" = the same browser opening it again.
 * Never point this at the live site: it picks a name (a player_devices row) on the database it talks to.
 */
const { chromium } = require('playwright');

const BASE = process.argv[2];
const RUNS = Number(process.argv[3] || 3);
const QUERY = process.argv[4] || '';
if (!BASE || /pickleball\.juncaj\.net/.test(BASE) || !/pages\.dev|localhost/.test(BASE)) throw new Error('Give a preview address (never live).');
const NETS = {
  fast3g: { offline: false, latency: 562.5, downloadThroughput: (1.44 * 1024 * 1024) / 8 * 0.9, uploadThroughput: (675 * 1024) / 8 * 0.9 },
  slow3g: { offline: false, latency: 2000, downloadThroughput: (400 * 1024) / 8 * 0.9, uploadThroughput: (400 * 1024) / 8 * 0.9 },
};
const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY } : undefined;
const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];

async function pickName(browser) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await page.goto(BASE + '/' + QUERY);
  // Who are you? Pick Casey (no game, nothing changes on the data for anyone).
  await page.waitForSelector('text=Casey', { timeout: 30000 });
  await page.getByRole('button', { name: /^Casey/ }).first().click().catch(async () => page.locator('text=Casey').first().click());
  await page.waitForSelector('[data-tier]', { timeout: 30000 });
  const state = await ctx.storageState();
  await ctx.close();
  return state;
}

async function once(browser, state, net) {
  // A true first visit: only the name cookie, nothing in the browser's storage (no saved copy, no remembered switch) and no cache.
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, storageState: { cookies: state.cookies, origins: [] } });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', NETS[net]);
  const out = {};
  for (const visit of ['first', 'repeat']) {
    const reqs = [];
    const onReq = (r) => reqs.push(r.url().replace(BASE, ''));
    page.on('request', onReq);
    const t0 = Date.now();
    await page.goto(BASE + '/' + QUERY, { waitUntil: 'commit' });
    await page.waitForSelector('[data-tier]', { timeout: 120000 });
    const ms = Date.now() - t0;
    // The fresh screen (with Zip 12's saved copy, the first cards can be the saved ones; this is when the live ones are in).
    await page.waitForSelector('.schedule:not([data-saved-copy]) [data-tier]', { timeout: 120000 });
    const freshMs = Date.now() - t0;
    // Let the quiet refresh land too, then count what the first screen asked for.
    await page.waitForTimeout(1500);
    page.off('request', onReq);
    const fromCache = await page.evaluate(() => performance.getEntriesByType('resource').filter((e) => e.transferSize === 0 && e.decodedBodySize > 0).length);
    out[visit] = { ms, freshMs, requests: reqs.length, fromCache, list: reqs };
  }
  await ctx.close();
  return out;
}

(async () => {
  const browser = await chromium.launch({ proxy });
  const state = await pickName(browser);
  for (const net of ['fast3g', 'slow3g']) {
    const runs = [];
    for (let i = 0; i < RUNS; i++) runs.push(await once(browser, state, net));
    const f = runs.map((r) => r.first.ms);
    const rp = runs.map((r) => r.repeat.ms);
    const ff = runs.map((r) => r.first.freshMs);
    const rf = runs.map((r) => r.repeat.freshMs);
    console.log(`${net}: first visit median ${median(f)} ms (${f.join(', ')}), repeat median ${median(rp)} ms (${rp.join(', ')})`);
    console.log(`   fresh data on screen: first ${median(ff)} ms, repeat ${median(rf)} ms`);
    console.log(`   requests: first ${runs[0].first.requests}, repeat ${runs[0].repeat.requests} (served from cache on repeat: ${runs[0].repeat.fromCache})`);
    if (process.env.VERBOSE) console.log('   first:', runs[0].first.list.join(' '), '\n   repeat:', runs[0].repeat.list.join(' '));
  }
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
