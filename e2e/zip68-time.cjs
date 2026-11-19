/* Zip 68 (🎾68.speed), by hand: times the organizer's Home calls on a PREVIEW (fake database) from this machine.
 *   BASE=https://<preview>.pickleball-club-9h0.pages.dev PIN=<preview pin> STAGES=tickets_open,day_ready,mid N=15 node e2e/zip68-time.cjs
 * For each stage: the dashboard and the 5-second version check, median and spread of N calls, bytes; and the round trip to a static file
 * (the network part of every call), so "server time" is about the call minus that. Never point it at live: it sets Tournament test stages.
 */
const BASE = process.env.BASE;
if (!BASE || /pickleball\.juncaj\.net|^https:\/\/pickleball-club-9h0\.pages\.dev/.test(BASE)) throw new Error('BASE must be a preview address');
const N = Number(process.env.N ?? 15);
const med = (a) => [...a].sort((x, y) => x - y)[a.length >> 1];
const q = (a, p) => [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * p))];
async function timed(path, init = {}) {
  const t0 = performance.now();
  const r = await fetch(BASE + path, init);
  const text = await r.text();
  return { ms: performance.now() - t0, status: r.status, bytes: text.length, text, r };
}
(async () => {
  const login = await fetch(BASE + '/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: BASE }, body: JSON.stringify({ pin: process.env.PIN }) });
  if (!login.ok) throw new Error('login ' + login.status);
  const cookie = login.headers.getSetCookie().map((x) => x.split(';')[0]).join('; ');
  const h = { Cookie: cookie, Origin: BASE };
  const net = [];
  for (let i = 0; i < N; i++) net.push((await timed('/robots.txt?' + i)).ms);
  console.log(`network round trip (static file): median ${med(net).toFixed(0)} ms`);
  for (const stage of (process.env.STAGES ?? 'tickets_open,day_ready,mid').split(',')) {
    if (stage !== 'keep') {
      const s = await fetch(BASE + '/api/admin/tournament-test', { method: 'POST', headers: { ...h, 'Content-Type': 'application/json' }, body: JSON.stringify({ stage }) });
      if (!s.ok) throw new Error(stage + ' ' + s.status + ' ' + (await s.text()));
    }
    for (const path of ['/api/admin/dashboard', '/api/admin/version']) {
      const first = await timed(path, { headers: h });
      const ms = [];
      let bytes = 0;
      for (let i = 0; i < N; i++) { const r = await timed(path, { headers: h }); if (r.status !== 200) throw new Error(path + ' ' + r.status + ' ' + r.text.slice(0, 200)); ms.push(r.ms); bytes = r.bytes; }
      console.log(`${stage.padEnd(13)} ${path.padEnd(22)} first ${first.ms.toFixed(0).padStart(5)} ms  median ${med(ms).toFixed(0).padStart(5)} ms  p90 ${q(ms, 0.9).toFixed(0).padStart(5)}  max ${Math.max(...ms).toFixed(0).padStart(5)}  bytes ${bytes}`);
    }
  }
})().catch((e) => { console.error(e); process.exit(1); });
