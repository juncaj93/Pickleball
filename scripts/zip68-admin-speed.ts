// Zip 68 (🎾68.speed): the organizer's Home on the preview's calm fake world (local sqlite, never Cloudflare), with the preview's switches
// (as on live: Fewer database trips on). For each Tournament test stage: the dashboard and the 5-second version check, database trips,
// statements, bytes and median local time. SEQ=1 lists every trip of the dashboard.
//   npx vite-node scripts/zip68-admin-speed.ts -- [stage ...]
import { handleApi } from '../server/app';
import { createNodeD1 } from '../dev/nodeD1';
import { type Counted, countingDb } from '../dev/countingDb';
import { buildSmallPreview } from './preview-world-small';

const stages = process.argv.slice(2).filter((a) => a !== '--');
const at = Date.parse(process.env.AT ?? '2026-11-18T18:30:00.000Z');
const { sql } = await buildSmallPreview(at, { calm: process.env.FULL !== '1', zip55: true, zip60: true });
const raw = createNodeD1(':memory:');
raw.raw.exec(sql);
if (process.env.BYNAME === '1') raw.raw.exec('UPDATE groups SET organizer_player_id = NULL');
const c: Counted = { trips: 0, statements: 0, sql: [] };
const env: any = { DB: countingDb(raw, c), PREVIEW_CALM: 'on' };
async function call(method: string, path: string, cookie = '', body?: unknown) {
  const h = new Headers({ Origin: 'https://preview.example' });
  if (cookie) h.set('Cookie', cookie);
  if (body !== undefined) h.set('Content-Type', 'application/json');
  c.trips = 0; c.statements = 0; c.sql = []; c.seq = []; c.dbMs = 0;
  const t0 = performance.now();
  const res = await handleApi(new Request('https://preview.example' + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }), env, at, () => {});
  const text = await res.text();
  const ms = performance.now() - t0;
  if (!res.ok) throw new Error(`${path}: ${res.status} ${text}`);
  return { res, text, ms, trips: c.trips, statements: c.statements, seq: [...(c.seq ?? [])] };
}
const admin = (await call('POST', '/api/admin/login', '', { pin: '739514' })).res.headers.getSetCookie().map((x) => x.split(';')[0]).join('; ');
for (const stage of stages.length ? stages : ['none', 'tickets_open', 'all_locked', 'day_ready', 'mid']) {
  if (stage !== 'none') await call('POST', '/api/admin/tournament-test', admin, { stage });
  for (const path of ['/api/admin/dashboard', '/api/admin/version']) {
    await call('GET', path, admin); // the first read does the lazy upkeep
    const ms: number[] = [];
    let last: any;
    for (let i = 0; i < Number(process.env.ITER ?? 9); i++) { last = await call('GET', path, admin); ms.push(last.ms); }
    ms.sort((a, b) => a - b);
    console.log(`${stage.padEnd(13)} ${path.padEnd(22)} trips ${String(last.trips).padStart(3)}  statements ${String(last.statements).padStart(3)}  bytes ${String(last.text.length).padStart(6)}  local ${ms[ms.length >> 1].toFixed(1)} ms`);
    if (process.env.SEQ && path.endsWith('dashboard')) for (const s of last.seq) console.log('     ' + s);
  }
}
