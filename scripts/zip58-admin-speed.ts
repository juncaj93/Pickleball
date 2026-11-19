// Zip 58 (Alex's admin speed rule): the organizer's Home load (dashboard, the 5-second version check, sessions) at two Tournament test stages,
// "8 locked in" (day_ready) and game night (mid), on THIS code: server time and database trips per call (median of 15). Local sqlite, never
// Cloudflare. Run the same file from a main checkout to compare:  npx vite-node scripts/zip58-admin-speed.ts
import { handleApi } from '../server/app';
import { createNodeD1 } from '../dev/nodeD1';
import { type Counted, countingDb } from '../dev/countingDb';

const at = Date.parse('2026-11-13T02:00:00.000Z'); // Thu Nov 12, 9:00 PM Eastern
const raw = createNodeD1(':memory:');
const c: Counted = { trips: 0, statements: 0, sql: [] };
const env: any = { DB: countingDb(raw, c), SETUP_TOKEN: 'speed-setup-token-0123456789', PREVIEW_CALM: 'on' };
async function call(method: string, path: string, cookie = '', body?: unknown) {
  const h = new Headers({ Origin: 'https://preview.example' });
  if (cookie) h.set('Cookie', cookie);
  if (body !== undefined) h.set('Content-Type', 'application/json');
  c.trips = 0; c.statements = 0; c.sql = []; c.seq = []; c.dbMs = 0;
  const t0 = performance.now();
  const res = await handleApi(new Request('https://preview.example' + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }), env, at, () => {});
  const ms = performance.now() - t0;
  await res.text();
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return { res, trips: c.trips, ms };
}
const PIN = '483920';
const NAMES = ['Alex', 'Parker', 'Rowan', 'Sage', 'Christopher Vanderberg', 'Vic', 'Wren', 'Zoe', 'Quinn', 'Reese'];
await call('POST', '/api/setup', '', { setupToken: env.SETUP_TOKEN, groupName: 'Speed', pin: PIN, venmoUrl: 'https://venmo.com/u/organizer', players: NAMES.map((name, i) => ({ name, phone: `(313) 555-01${String(i).padStart(2, '0')}` })) });
const login = await call('POST', '/api/admin/login', '', { pin: PIN });
const admin = login.res.headers.getSetCookie().map((x) => x.split(';')[0]).join('; ');
await call('PUT', '/api/admin/group', admin, { organizerName: 'Alex' });
const out: string[] = [];
for (const stage of ['day_ready', 'mid']) {
  await call('POST', '/api/admin/tournament-test', admin, { stage });
  for (const [label, path] of [['dashboard', '/api/admin/dashboard'], ['version', '/api/admin/version']]) {
    const ms: number[] = [];
    let trips = 0;
    for (let i = 0; i < Number(process.env.ITER ?? 15); i++) {
      const r = await call('GET', path, admin);
      ms.push(r.ms);
      trips = r.trips;
    }
    ms.sort((a, b) => a - b);
    out.push(`${stage.padEnd(10)} ${label.padEnd(10)} ${String(trips).padStart(3)} trips  ${ms[Math.floor(ms.length / 2)].toFixed(1).padStart(6)} ms`);
  }
}
console.log(out.join('\n'));
