// Zip 33, "Games index" (migrations/0020_games_index.sql): indexes only. This file proves, on the made-up preview world:
//  1. the migration adds exactly the three indexes, runs twice without error, and takes nothing away;
//  2. the lookups it is for really use them (EXPLAIN QUERY PLAN), and the old database (no 0020) used none of them;
//  3. every answer the site gives (player and organizer, the 5-second checks, Home, Money, History) holds the same
//     information on a database with the indexes as on one without (the way today's live code meets it: rollback needs no database step);
//  4. dropping the three indexes (the rollback statements written inside the file) leaves the site answering the same.
// "Same information" = the same JSON values. An object whose rows come from a query with no ORDER BY (gameMonthCounts) may list its
// keys in another order, because the plan walks a different index; the screen builds its month list itself, so the order is not read.
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createNodeD1 } from '../dev/nodeD1';
import { handleApi } from '../server/app';
import { previewPin } from '../scripts/seed-preview-world';
import { buildSmallPreview } from '../scripts/preview-world-small';
import { ALL_SWITCHES_READ } from '../server/speed';
import { motionSettingRead } from '../server/motion';
import { hiddenGameIdsRead } from '../server/hideGame';
import { sessionsRead } from '../server/repo';

const FILE = '0020_games_index.sql';
const NEW_INDEXES = ['idx_sessions_group_ends', 'idx_task_log_switch_rows', 'idx_task_log_game_marks'];
const NOW = Date.parse('2026-11-11T20:00:00.000Z');
const HEALTH = readFileSync(join(process.cwd(), 'scripts/integrity-checks.sql'), 'utf8');

/** The migration folder as it was before this zip (every file except 0020). */
function oldMigrationsDir(): string {
  const dir = join(mkdtempSync(join(tmpdir(), 'pb-mig-')), 'migrations');
  mkdirSync(dir);
  for (const f of readdirSync('migrations')) if (f !== FILE) cpSync(join('migrations', f), join(dir, f));
  return dir;
}

const names = (db: ReturnType<typeof createNodeD1>) =>
  (db.raw.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_autoindex%' ORDER BY name").all() as { name: string }[]).map((r) => r.name);

const canon = (v: unknown): unknown =>
  Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon((v as Record<string, unknown>)[k])])) : v;

async function world() {
  const { sql } = await buildSmallPreview(NOW);
  const before = createNodeD1(':memory:', oldMigrationsDir());
  const after = createNodeD1(':memory:');
  before.raw.exec(sql);
  after.raw.exec(sql);
  return { before, after };
}
let shared: ReturnType<typeof world> | undefined;
const once = () => (shared ??= world());

/** Every answer a player screen and an organizer screen asks for, as JSON, on one database. */
async function answers(db: ReturnType<typeof createNodeD1>) {
  const env: any = { DB: db };
  const at = NOW + 60_000;
  const call = async (method: string, path: string, cookie = '', body?: unknown) => {
    const h = new Headers();
    if (cookie) h.set('Cookie', cookie);
    if (body !== undefined) h.set('Content-Type', 'application/json');
    const res = await handleApi(new Request('https://preview.example' + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }), env, at, () => {});
    return { res, text: await res.text() };
  };
  const cookieOf = (r: { res: Response }) => r.res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  const admin = cookieOf(await call('POST', '/api/admin/login', '', { pin: previewPin() }));
  const dash = JSON.parse((await call('GET', '/api/admin/dashboard', admin)).text);
  const out: Record<string, unknown> = {};
  for (const who of ['Vic', 'Quinn', 'Rowan']) {
    const p = dash.players.find((x: { name: string }) => x.name === who);
    const player = cookieOf(await call('POST', '/api/me', '', { playerId: p.id }));
    for (const path of ['/api/group/version', '/api/group']) {
      const r = await call('GET', path, player);
      expect(r.res.status, `${who} ${path}`).toBe(200);
      out[`${who} ${path}`] = JSON.parse(r.text);
    }
  }
  for (const path of ['/api/admin/version', '/api/admin/dashboard', '/api/admin/money', '/api/admin/activity']) {
    const r = await call('GET', path, admin);
    expect(r.res.status, path).toBe(200);
    out[path] = JSON.parse(r.text);
  }
  return out;
}

const plan = (db: ReturnType<typeof createNodeD1>, sql: string, values: unknown[]) =>
  (db.raw.prepare('EXPLAIN QUERY PLAN ' + sql).all(...(values as never[])) as { detail: string }[]).map((r) => r.detail).join(' | ');

describe('Zip 33: games index (migration 0020)', () => {
  it('adds exactly the three indexes and nothing else; the old database has none of them', async () => {
    const { before, after } = await once();
    const b = names(before);
    const a = names(after);
    for (const n of NEW_INDEXES) {
      expect(b).not.toContain(n);
      expect(a).toContain(n);
    }
    // Nothing was taken away, and nothing else was added.
    expect(a.filter((n) => !b.includes(n)).sort()).toEqual([...NEW_INDEXES].sort());
    expect(b.filter((n) => !a.includes(n))).toEqual([]);
    // Tables hold the same rows (an index never changes data).
    for (const t of ['groups', 'players', 'sessions', 'session_players', 'credit_ledger', 'refund_requests', 'task_log', 'admin_audit_log']) {
      expect((after.raw.prepare(`SELECT COUNT(*) n FROM ${t}`).get() as { n: number }).n).toBe((before.raw.prepare(`SELECT COUNT(*) n FROM ${t}`).get() as { n: number }).n);
    }
  });

  it('is indexes only: no table, column, trigger or data statement in the file', () => {
    const sql = readFileSync(join('migrations', FILE), 'utf8')
      .split('\n')
      .filter((l) => !l.trim().startsWith('--'))
      .join('\n');
    const statements = sql.split(';').map((s) => s.trim()).filter(Boolean);
    expect(statements.length).toBe(3);
    for (const s of statements) expect(s).toMatch(/^CREATE INDEX IF NOT EXISTS idx_/);
    expect(sql).not.toMatch(/\b(ALTER|DROP|DELETE|UPDATE|INSERT|CREATE TABLE|CREATE TRIGGER|CREATE UNIQUE)\b/i);
  });

  it('can run twice (CREATE INDEX IF NOT EXISTS) without an error or a change', async () => {
    const { after } = await once();
    const before = names(after);
    after.raw.exec(readFileSync(join('migrations', FILE), 'utf8'));
    expect(names(after)).toEqual(before);
  });

  it('the lookups it is for use the new indexes (and did not before)', async () => {
    const { before, after } = await once();
    const group = (after.raw.prepare('SELECT id FROM groups').get() as { id: string }).id;
    const iso = new Date(NOW - 90 * 86_400_000).toISOString();
    const games = sessionsRead(group, iso);
    expect(plan(after, games.sql, games.values)).toContain('idx_sessions_group_ends');
    expect(plan(before, games.sql, games.values)).not.toContain('idx_sessions_group_ends');
    // The shared switch read every request makes, and the animation setting.
    expect(plan(after, ALL_SWITCHES_READ, [])).toContain('idx_task_log_switch_rows');
    expect(plan(before, ALL_SWITCHES_READ, [])).not.toContain('idx_task_log_switch_rows');
    const motion = motionSettingRead(group, 'player');
    expect(plan(after, motion.sql, motion.values)).toContain('idx_task_log_switch_rows');
    // "Which games are hidden?"
    const hidden = hiddenGameIdsRead(group);
    expect(plan(after, hidden.sql, hidden.values)).toContain('idx_task_log_game_marks');
    expect(plan(before, hidden.sql, hidden.values)).not.toContain('idx_task_log_game_marks');
  });

  it('every answer holds the same information with and without the indexes (today\'s code on the migrated database)', async () => {
    const { before, after } = await once();
    const b = await answers(before);
    const a = await answers(after);
    expect(Object.keys(a)).toEqual(Object.keys(b));
    for (const k of Object.keys(b)) expect(canon(a[k]), k).toEqual(canon(b[k]));
    // The made-up world still passes every live health check on both.
    for (const db of [before, after]) {
      const row = db.raw.prepare(HEALTH.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')).get() as Record<string, number>;
      expect(Object.entries(row).filter(([k, n]) => !k.startsWith('info_') && Number(n) !== 0)).toEqual([]);
    }
  });

  it('the rollback statements written in the file work, and the site answers the same afterwards', async () => {
    const { before, after } = await once();
    const text = readFileSync(join('migrations', FILE), 'utf8');
    const drops = text.split('\n').filter((l) => /^--\s+DROP INDEX IF EXISTS idx_/.test(l)).map((l) => l.replace(/^--\s+/, ''));
    expect(drops.length).toBe(3);
    for (const d of drops) after.raw.exec(d);
    expect(names(after)).toEqual(names(before));
    const b = await answers(before);
    const a = await answers(after);
    for (const k of Object.keys(b)) expect(canon(a[k]), k).toEqual(canon(b[k]));
    // And the migration can be put back afterwards.
    after.raw.exec(text);
    for (const n of NEW_INDEXES) expect(names(after)).toContain(n);
  });
});
