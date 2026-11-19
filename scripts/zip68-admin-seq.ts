// Zip 68: list every database trip the organizer's Home makes (dashboard and the 5-second version check) at a Tournament test stage.
//   STAGE=day_ready npx vite-node scripts/zip68-admin-seq.ts
import { handleApi } from '../server/app';
import { createNodeD1 } from '../dev/nodeD1';
import { type Counted, countingDb } from '../dev/countingDb';

const at = Date.parse('2026-11-13T02:00:00.000Z');
const raw = createNodeD1(':memory:');
const c: Counted = { trips: 0, statements: 0, sql: [] };
const env: any = { DB: countingDb(raw, c), SETUP_TOKEN: 'speed-setup-token-0123456789', PREVIEW_CALM: 'on' };
async function call(method: string, path: string, cookie = '', body?: unknown) {
  const h = new Headers({ Origin: 'https://preview.example' });
  if (cookie) h.set('Cookie', cookie);
  if (body !== undefined) h.set('Content-Type', 'application/json');
  c.trips = 0; c.statements = 0; c.sql = []; c.seq = []; c.dbMs = 0;
  const res = await handleApi(new Request('https://preview.example' + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }), env, at, () => {});
  const text = await res.text();
  if (!res.ok) throw new Error(`${path}: ${res.status} ${text}`);
  return { res, text, trips: c.trips, seq: [...(c.seq ?? [])] };
}
const PIN = '483920';
const NAMES = ['Alex', 'Parker', 'Rowan', 'Sage', 'Christopher Vanderberg', 'Vic', 'Wren', 'Zoe', 'Quinn', 'Reese'];
await call('POST', '/api/setup', '', { setupToken: env.SETUP_TOKEN, groupName: 'Speed', pin: PIN, venmoUrl: 'https://venmo.com/u/organizer', players: NAMES.map((name, i) => ({ name, phone: `(313) 555-01${String(i).padStart(2, '0')}` })) });
const login = await call('POST', '/api/admin/login', '', { pin: PIN });
const admin = login.res.headers.getSetCookie().map((x) => x.split(';')[0]).join('; ');
await call('PUT', '/api/admin/group', admin, { organizerName: 'Alex' });
await call('POST', '/api/admin/tournament-test', admin, { stage: process.env.STAGE ?? 'day_ready' });
await call('GET', '/api/admin/dashboard', admin);
for (const path of ['/api/admin/dashboard', '/api/admin/version']) {
  const r = await call('GET', path, admin);
  console.log(`${path}: ${r.trips} trips, ${r.text.length} bytes`);
  for (const s of r.seq) console.log('   ' + s);
}
