// Zip 80 (🎾80.leftovers): the speed of the organizer's Home (dashboard, the 5 second check) and of the three reads Zip 80 batches (the Money
// month, an older month's games, a player's card summary), on the preview's fake world (local sqlite, never Cloudflare), "Fewer database
// trips" on as on live. Trips, statements and median local time; FULL=1 for the whole small world (three months of games). SEQ=1 lists trips.
//   npx vite-node scripts/zip80-speed.ts -- [stage ...]
import { handleApi } from '../server/app';
import { createNodeD1 } from '../dev/nodeD1';
import { type Counted, countingDb } from '../dev/countingDb';
import { buildSmallPreview } from './preview-world-small';

const stages = process.argv.slice(2).filter((a) => a !== '--');
const at = Date.parse(process.env.AT ?? '2026-11-18T18:30:00.000Z');
const { sql } = await buildSmallPreview(at, { calm: process.env.FULL !== '1', zip55: true, zip60: true });
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
  return { res, text, ms, trips: c.trips, statements: c.statements, seq: [...(c.seq ?? [])] };
}
const admin = (await call('POST', '/api/admin/login', '', { pin: '739514' })).res.headers.getSetCookie().map((x) => x.split(';')[0]).join('; ');
const dash = JSON.parse((await call('GET', '/api/admin/dashboard', admin)).text);
const players = dash.players as { id: string; name: string }[];
const vic = players.find((p) => p.name === 'Vic')!.id;
const alex = players.find((p) => p.name === 'Alex')!.id;
const d = new Date(at);
const ym = (y: number, m: number) => `${y}-${String(m).padStart(2, '0')}`;
const thisMonth = ym(d.getUTCFullYear(), d.getUTCMonth() + 1);
const prev = d.getUTCMonth() === 0 ? ym(d.getUTCFullYear() - 1, 12) : ym(d.getUTCFullYear(), d.getUTCMonth());
for (const stage of stages.length ? stages : ['none', 'all_locked', 'day_ready', 'mid']) {
  if (stage !== 'none') await call('POST', '/api/admin/tournament-test', admin, { stage });
  for (const path of ['/api/admin/dashboard', '/api/admin/version', `/api/admin/money?month=${thisMonth}`, `/api/admin/money?month=${prev}`, `/api/admin/month-games?month=${prev}`, `/api/admin/players/${vic}/summary`, `/api/admin/players/${alex}/summary`]) {
    await call('GET', path, admin);
    const ms: number[] = [];
    let last: any;
    for (let i = 0; i < Number(process.env.ITER ?? 9); i++) { last = await call('GET', path, admin); ms.push(last.ms); }
    ms.sort((a, b) => a - b);
    const name = path.replace(vic, 'Vic').replace(alex, 'Alex');
    console.log(`${stage.padEnd(11)} ${name.padEnd(42)} trips ${String(last.trips).padStart(3)}  statements ${String(last.statements).padStart(3)}  bytes ${String(last.text.length).padStart(6)}  local ${ms[ms.length >> 1].toFixed(1)} ms`);
    if (process.env.SEQ && name.includes(process.env.SEQ)) for (const s of last.seq) console.log('     ' + s);
  }
}
