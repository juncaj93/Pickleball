// Zip 58 (admin speed rule): main's server and this branch's server in ONE process, each on its own copy of the same world, called in turn
// (A, B, A, B ...) so machine noise hits both alike. MAIN_DIR: a checkout of main with its packages.  npx vite-node scripts/zip58-admin-ab.ts
import { join } from 'node:path';
import { createNodeD1 } from '../dev/nodeD1';
import { type Counted, countingDb } from '../dev/countingDb';
import { handleApi as branchApi } from '../server/app';

const MAIN = process.env.MAIN_DIR!;
const mainApi = (await import(join(MAIN, 'server/app.ts'))).handleApi as typeof branchApi;
const at = Date.parse('2026-11-13T02:00:00.000Z');
const NAMES = ['Alex', 'Parker', 'Rowan', 'Sage', 'Christopher Vanderberg', 'Vic', 'Wren', 'Zoe', 'Quinn', 'Reese'];
async function side(api: typeof branchApi, migrations: string) {
  const raw = createNodeD1(':memory:', migrations);
  const c: Counted = { trips: 0, statements: 0, sql: [] };
  const env: any = { DB: countingDb(raw, c), SETUP_TOKEN: 'speed-setup-token-0123456789', PREVIEW_CALM: 'on' };
  let cookie = '';
  const call = async (method: string, path: string, body?: unknown) => {
    const h = new Headers({ Origin: 'https://preview.example' });
    if (cookie) h.set('Cookie', cookie);
    if (body !== undefined) h.set('Content-Type', 'application/json');
    c.trips = 0;
    const t0 = performance.now();
    const res = await api(new Request('https://preview.example' + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }), env, at, () => {});
    const ms = performance.now() - t0;
    await res.text();
    if (!res.ok) throw new Error(`${path}: ${res.status}`);
    return { res, ms, trips: c.trips };
  };
  await call('POST', '/api/setup', { setupToken: env.SETUP_TOKEN, groupName: 'Speed', pin: '483920', venmoUrl: 'https://venmo.com/u/o', players: NAMES.map((name, i) => ({ name, phone: `(313) 555-01${String(i).padStart(2, '0')}` })) });
  cookie = (await call('POST', '/api/admin/login', { pin: '483920' })).res.headers.getSetCookie().map((x) => x.split(';')[0]).join('; ');
  await call('PUT', '/api/admin/group', { organizerName: 'Alex' });
  return call;
}
const A = await side(mainApi, join(MAIN, 'migrations'));
const B = await side(branchApi, join(process.cwd(), 'migrations'));
const med = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
for (const stage of ['day_ready', 'mid']) {
  await A('POST', '/api/admin/tournament-test', { stage });
  await B('POST', '/api/admin/tournament-test', { stage });
  for (const path of ['/api/admin/dashboard', '/api/admin/version']) {
    const a: number[] = [], b: number[] = [];
    let ta = 0, tb = 0;
    for (let i = 0; i < 40; i++) { await A('GET', path); await B('GET', path); }
    for (let i = 0; i < 400; i++) {
      const x = await A('GET', path); const y = await B('GET', path);
      a.push(x.ms); b.push(y.ms); ta = x.trips; tb = y.trips;
    }
    console.log(`${stage.padEnd(9)} ${path.padEnd(22)} main ${med(a).toFixed(2)} ms ${ta} trips | branch ${med(b).toFixed(2)} ms ${tb} trips`);
  }
}
