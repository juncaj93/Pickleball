/* Zip 48 (🎾48.speedsplit): before and after numbers on a slow phone network. Not part of the suite (it needs two deployed previews).
 *
 *   node e2e/zip48-measure.cjs <before base URL> <after base URL> [runs]
 *
 * Network: Lighthouse's "Slow 4G" (150 ms round trip, 1.6 Mbps down, 750 kbps up) and its phone CPU slowdown (4x), a 390 px phone.
 * Every run is a brand-new phone (empty cache) unless it says "again". Bytes are what came over the wire (compressed, headers included).
 * Scenes:
 *   player first visit   /             until "Who are you?" shows
 *   player, name picked  /?as=Parker   until the first game card shows (preview-only link that picks the fake name)
 *   organizer, first     /admin        signed in, until the tab bar shows
 *   organizer, again     /admin        the same phone opening it again (files kept), until the tab bar shows
 * The organizer PIN is the PREVIEW one (docs/PREVIEW_FAKE_DB.md), read from the file, never printed.
 */
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const [BEFORE, AFTER] = process.argv.slice(2, 4);
const RUNS = Number(process.argv[4]) || 3;
const PIN = /PIN `(\d{6})`/.exec(readFileSync(path.join(__dirname, '..', 'docs/PREVIEW_FAKE_DB.md'), 'utf8'))[1];
const SLOW_4G = { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 };

async function measure(browser, base, scene) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  if (scene.organizer) {
    const r = await ctx.request.post(base + '/api/admin/login', { data: { pin: PIN }, headers: { Origin: base } });
    if (!r.ok()) throw new Error(`sign in ${r.status()}`);
  }
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', SLOW_4G);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  let warm = null;
  if (scene.again) {
    await page.goto(base + scene.url);
    await scene.ready(page);
    await page.waitForTimeout(1500);
    warm = true;
  }
  const reqs = new Map();
  cdp.on('Network.requestWillBeSent', (e) => reqs.set(e.requestId, { url: e.request.url, bytes: 0, cached: false }));
  cdp.on('Network.requestServedFromCache', (e) => reqs.has(e.requestId) && (reqs.get(e.requestId).cached = true));
  cdp.on('Network.responseReceived', (e) => reqs.has(e.requestId) && e.response.fromDiskCache && (reqs.get(e.requestId).cached = true));
  cdp.on('Network.loadingFinished', (e) => reqs.has(e.requestId) && (reqs.get(e.requestId).bytes = e.encodedDataLength));
  const t0 = Date.now();
  await page.goto(base + scene.url, { waitUntil: 'commit' });
  await scene.ready(page);
  const ms = Date.now() - t0;
  await page.waitForTimeout(800);
  const all = [...reqs.values()].filter((r) => !r.url.startsWith('data:'));
  const net = all.filter((r) => !r.cached);
  const files = net.filter((r) => !/\/api\//.test(r.url));
  await ctx.close();
  return {
    ms,
    bytes: net.reduce((s, r) => s + r.bytes, 0),
    requests: net.length,
    fileBytes: files.reduce((s, r) => s + r.bytes, 0),
    files: files.map((r) => r.url.replace(/^https?:\/\/[^/]+/, '')),
    warm,
  };
}

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

async function main() {
  const browser = await chromium.launch();
  const scenes = [
    { name: 'player first visit', url: '/', ready: (p) => p.getByText('Who are you?').first().waitFor({ timeout: 120000 }) },
    { name: 'player, name picked', url: '/?as=Parker', ready: (p) => p.locator('.schedule article.sched').first().waitFor({ timeout: 120000 }) },
    { name: 'organizer, first open', url: '/admin', organizer: true, ready: (p) => p.locator('nav.tabbar').waitFor({ timeout: 120000 }) },
    { name: 'organizer, opened again', url: '/admin', organizer: true, again: true, ready: (p) => p.locator('nav.tabbar').waitFor({ timeout: 120000 }) },
  ];
  const out = {};
  const only = process.env.Z48M_ONLY ? new RegExp(process.env.Z48M_ONLY) : null;
  for (const scene of scenes.filter((x) => !only || only.test(x.name))) {
    for (const [label, base] of [['before', BEFORE], ['after', AFTER]]) {
      const runs = [];
      // Alternate is not needed: each run is a fresh phone and the two previews share one fake database.
      for (let i = 0; i < RUNS; i++) runs.push(await measure(browser, base, scene));
      out[`${scene.name} | ${label}`] = {
        seconds: (median(runs.map((r) => r.ms)) / 1000).toFixed(2),
        allSeconds: runs.map((r) => (r.ms / 1000).toFixed(2)).join(' '),
        KB: (median(runs.map((r) => r.bytes)) / 1024).toFixed(1),
        fileKB: (median(runs.map((r) => r.fileBytes)) / 1024).toFixed(1),
        requests: median(runs.map((r) => r.requests)),
        files: runs[0].files.join(' '),
      };
      console.log(scene.name.padEnd(26), label.padEnd(7), JSON.stringify(out[`${scene.name} | ${label}`]));
    }
  }
  await browser.close();
  console.log(JSON.stringify(out, null, 1));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
