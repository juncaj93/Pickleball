// Counts database round trips per API call on the fake preview world (local sqlite, never Cloudflare).
//   npx vite-node scripts/count-queries.ts -- [ISO time] [extra env JSON]
// A round trip is one first()/all()/run() or one batch() (D1 sends a batch in one trip). Prints a table.
import { handleApi } from '../server/app';
import { createNodeD1 } from '../dev/nodeD1';
import { buildSeed, previewPin } from './seed-preview-world';

import { type Counted, countingDb } from '../dev/countingDb';

const args = process.argv.slice(2).filter((a) => a !== '--');
const at = args[0] ? Date.parse(args[0]) : Date.parse('2026-11-08T17:00:00.000Z');
const extraEnv = args[1] ? JSON.parse(args[1]) : {};
const { sql } = await buildSeed(at);
const raw = createNodeD1(':memory:');
raw.raw.exec(sql);
// The seed turns the Zip 12 rows on (the preview rule). Start with them off; FAST=1 turns the switch on with the private header.
raw.raw.exec("DELETE FROM task_log WHERE session_id IS NULL AND kind = 'mark' AND task LIKE 'speed_%'");
const c: Counted = { trips: 0, statements: 0, sql: [] };
const env: any = { DB: countingDb(raw, c), ...extraEnv };
async function call(method: string, path: string, cookie = '', body?: unknown, headers: Record<string, string> = {}) {
  const h = new Headers(headers);
  if (cookie) h.set('Cookie', cookie);
  if (body !== undefined) h.set('Content-Type', 'application/json');
  c.trips = 0; c.statements = 0; c.sql = []; c.seq = []; c.dbMs = 0;
  const t0 = performance.now();
  const res = await handleApi(new Request('https://preview.example' + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }), env, at, () => {});
  const ms = performance.now() - t0;
  const text = await res.text();
  return { res, text, trips: c.trips, statements: c.statements, ms, cpu: ms - (c.dbMs ?? 0), sql: [...c.sql], seq: [...(c.seq ?? [])] };
}
const login = await call('POST', '/api/admin/login', '', { pin: previewPin() });
const admin = login.res.headers.getSetCookie().map((x) => x.split(';')[0]).join('; ');
const dash = JSON.parse((await call('GET', '/api/admin/dashboard', admin)).text);
const someone = dash.players.find((p: any) => p.name === 'Blair') ?? dash.players[1];
const pick = await call('POST', '/api/me', '', { playerId: someone.id });
const player = pick.res.headers.getSetCookie().map((x) => x.split(';')[0]).join('; ');
const rows: [string, string, string][] = [
  ['status', 'GET', '/api/status'],
  ['group', 'GET', '/api/group'],
  ['group version', 'GET', '/api/group/version'],
  ['admin dashboard', 'GET', '/api/admin/dashboard'],
  ['admin version', 'GET', '/api/admin/version'],
  ['money', 'GET', '/api/admin/money'],
  ['history', 'GET', '/api/admin/activity'],
];
const verbose = process.env.VERBOSE === '1';
const speedHeader: Record<string, string> = process.env.FAST === '1' ? { 'X-Speed-Queries': 'on' } : {};
for (const [name, m, p] of rows) {
  const ck = name.startsWith('admin') || name === 'money' || name === 'history' ? admin : player;
  // Warm once (lazy upkeep on the first read), then measure the median of 15.
  await call(m, p, ck, undefined, speedHeader);
  const times: number[] = [];
  const cpus: number[] = [];
  let last: any;
  for (let i = 0; i < 25; i++) { last = await call(m, p, ck, undefined, speedHeader); times.push(last.ms); cpus.push(last.cpu); }
  times.sort((a, b) => a - b);
  cpus.sort((a, b) => a - b);
  console.log(`${name.padEnd(16)} status ${last.res.status}  trips ${String(last.trips).padStart(3)}  statements ${String(last.statements).padStart(3)}  median local ${times[12].toFixed(2)} ms  server work (not database) ${cpus[12].toFixed(2)} ms  bytes ${last.text.length}`);
  if (process.env.SEQ === name) for (const x of last.seq) console.log('    ' + x);
  if (verbose) {
    const tally = new Map<string, number>();
    for (const s of last.sql) { const k = s.replace(/\s+/g, ' ').slice(0, 150); tally.set(k, (tally.get(k) ?? 0) + 1); }
    for (const [k, n] of [...tally].sort((a, b) => b[1] - a[1])) console.log(`    ${String(n).padStart(3)} x ${k}`);
  }
}
