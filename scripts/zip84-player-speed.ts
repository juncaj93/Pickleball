// Zip 84 (🎾84.final dry run): player Home (/api/group) and its 5 second check (/api/group/version) trips on the calm fake world, per stage.
//   npx vite-node scripts/zip84-player-speed.ts -- [stage ...]
import { handleApi } from '../server/app';
import { createNodeD1 } from '../dev/nodeD1';
import { type Counted, countingDb } from '../dev/countingDb';
import { buildSmallPreview } from './preview-world-small';
import { readFileSync } from 'node:fs';

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
  c.trips = 0; c.statements = 0; c.sql = []; (c as any).seq = []; (c as any).dbMs = 0;
  const res = await handleApi(new Request('https://preview.example' + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }), env, at, () => {});
  const text = await res.text();
  return { res, text, trips: c.trips, statements: c.statements };
}
const pin = /PIN `(\d{6})`/.exec(readFileSync('docs/PREVIEW_FAKE_DB.md', 'utf8'))![1];
const admin = (await call('POST', '/api/admin/login', '', { pin })).res.headers.getSetCookie().map((x) => x.split(';')[0]).join('; ');
const players = JSON.parse((await call('GET', '/api/admin/dashboard', admin)).text).players as { id: string; name: string }[];
const who = players.filter((p) => ['Vic', 'Parker', 'Zoe'].includes(p.name));
const phones: Record<string, string> = {};
for (const p of who) phones[p.name] = (await call('POST', '/api/me', '', { playerId: p.id })).res.headers.getSetCookie().map((x) => x.split(';')[0]).join('; ');
for (const stage of stages.length ? stages : ['none', 'all_locked', 'mid', 'am_round3', 'am_done']) {
  try { if (stage !== 'none') await call('POST', '/api/admin/tournament-test', admin, { stage }); } catch (e) { console.log(stage, 'no such stage'); continue; }
  for (const [name, ck] of [['no name', ''], ...Object.entries(phones)] as [string, string][]) {
    for (const path of ['/api/group', '/api/group/version']) {
      await call('GET', path, ck);
      const r = await call('GET', path, ck);
      console.log(`${stage.padEnd(11)} ${name.padEnd(8)} ${path.padEnd(19)} status ${r.res.status} trips ${String(r.trips).padStart(2)} statements ${String(r.statements).padStart(3)}`);
    }
  }
}
