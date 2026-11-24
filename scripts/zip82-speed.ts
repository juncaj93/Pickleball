// Zip 82 (🎾82.night admin): the ADMIN SPEED RULE check. The organizer's Home (the dashboard) and the 5 second check (version) on the preview's
// fake world (local sqlite, never Cloudflare), "Fewer database trips" on as on live: trips, statements, bytes and the median local time, at
// "8 locked in" (all_locked), a Locked doubles game night (mid), an Americano game night (am_round3) and the End cards (am_done, final_done).
//   npx vite-node scripts/zip82-speed.ts -- [stage ...]
import { handleApi } from '../server/app';
import { createNodeD1 } from '../dev/nodeD1';
import { type Counted, countingDb } from '../dev/countingDb';
import { buildSmallPreview } from './preview-world-small';

const stages = process.argv.slice(2).filter((a) => a !== '--');
const at = Date.parse(process.env.AT ?? '2026-11-18T18:30:00.000Z');
const { sql } = await buildSmallPreview(at, { calm: true, zip55: true, zip60: true });
const raw = createNodeD1(':memory:');
raw.raw.exec(sql);
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
  return { res, text, ms, trips: c.trips, statements: c.statements };
}
const admin = (await call('POST', '/api/admin/login', '', { pin: '739514' })).res.headers.getSetCookie().map((x) => x.split(';')[0]).join('; ');
for (const stage of stages.length ? stages : ['none', 'all_locked', 'mid', 'am_round3', 'am_done', 'final_done']) {
  if (stage !== 'none') await call('POST', '/api/admin/tournament-test', admin, { stage });
  for (const path of ['/api/admin/dashboard', '/api/admin/version']) {
    await call('GET', path, admin);
    const ms: number[] = [];
    let last: any;
    for (let i = 0; i < Number(process.env.ITER ?? 9); i++) { last = await call('GET', path, admin); ms.push(last.ms); }
    ms.sort((a, b) => a - b);
    console.log(`${stage.padEnd(11)} ${path.padEnd(22)} trips ${String(last.trips).padStart(3)}  statements ${String(last.statements).padStart(3)}  bytes ${String(last.text.length).padStart(6)}  local ${ms[ms.length >> 1].toFixed(1)} ms`);
  }
}
