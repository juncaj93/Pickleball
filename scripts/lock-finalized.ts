// Zip 27 (Audit A, A-01), deploy step: write the price lock of every game that was finalized (or canceled) BEFORE Zip 27 went live, ONCE,
// right after the deploy, from the price rules those games show at that moment. Alex asked for this (Mon Nov 9) so that no later change
// (a Settings flip, a money setting, or a kill switch in wrangler.toml) can re-price them.
//
//   npx vite-node scripts/lock-finalized.ts -- --db pickleball-preview            dry run on the fake preview database: says what it would write
//   npx vite-node scripts/lock-finalized.ts -- --db pickleball-preview --apply    writes the locks there
//   npx vite-node scripts/lock-finalized.ts -- --db pickleball --apply            the same on LIVE (deploy window only; backup and Time Travel bookmark first)
//
// It computes each lock with the site's own code (server/repo.ts everyoneSettingsOf, priceOf, priceLockDetail: the same rules the site uses
// right before a switch changes), with the kill switches of that database's own wrangler.toml section ([vars] for live, [env.preview.vars]
// for the preview). It writes only task_log rows with task 'price_lock' (no other table, no money row), each one only while that game has no
// lock and is still finalized or canceled, so running it twice changes nothing. It prints no names. Read the result with scripts/money-check.ts
// before and after: every number must be the same.
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { everyoneSettingsOf, type GroupRow, PRICE_LOCK_TASK, priceLockDetail, priceOf, type SessionRow, stillSettled, UNLOCKED_GAMES_SQL } from '../server/repo';
import { BOOKING_HOURS } from '../shared/bookingHours';
import { SHORT_GAMES_TASK } from '../server/zip9';

const DATABASES = { pickleball: '[vars]', 'pickleball-preview': '[env.preview.vars]' } as const;
type DbName = keyof typeof DATABASES;

/** The kill switches of one wrangler.toml section (`[vars]` or `[env.preview.vars]`), as the deployed site reads them. */
export function wranglerVars(toml: string, section: string): Record<string, string> {
  const start = toml.indexOf(`\n${section}\n`);
  if (start < 0) throw new Error(`no ${section} in wrangler.toml`);
  const rest = toml.slice(start + section.length + 2);
  const end = rest.search(/\n\[/);
  const body = end < 0 ? rest : rest.slice(0, end);
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/^([A-Z_][A-Z0-9_]*)\s*=\s*"([^"]*)"/gm)) out[m[1]] = m[2];
  return out;
}

/** One lock to write: the game and the JSON the site would store for it. */
export interface PlannedLock {
  sessionId: string;
  detail: string;
}

/** The locks, from the rows as read (the group, which Settings rows are on, the games without a lock). Pure: the tests run it on a copy. */
export function planLocks(group: GroupRow, rows: { shortGames: boolean; bookingHours: boolean }, env: Record<string, string>, games: SessionRow[]): PlannedLock[] {
  const settings = everyoneSettingsOf(group, rows, env);
  return games.map((s) => ({ sessionId: s.id, detail: priceLockDetail(priceOf({ ...s, price_lock: null }, settings)) }));
}

const quote = (s: string) => `'${s.replace(/'/g, "''")}'`;

/** The SQL for the locks, 20 games per statement list, each insert only while that game has no lock and is still finalized or canceled. */
export function lockSql(groupId: string, locks: PlannedLock[], nowIso: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < locks.length; i += 20) {
    out.push(
      locks
        .slice(i, i + 20)
        .map(
          (l) =>
            `INSERT INTO task_log (id, group_id, session_id, task, kind, detail, at) SELECT ${quote(randomUUID())}, ${quote(groupId)}, ${quote(l.sessionId)}, '${PRICE_LOCK_TASK}', 'mark', ${quote(l.detail)}, ${quote(nowIso)}
             WHERE ${stillSettled(l.sessionId)} AND NOT EXISTS (SELECT 1 FROM task_log t WHERE t.session_id = ${quote(l.sessionId)} AND t.task = '${PRICE_LOCK_TASK}' AND t.kind IN ('mark', 'sent') AND t.kind = 'mark')`,
        )
        .join(';\n') + ';',
    );
  }
  return out;
}

function d1(db: DbName, sql: string): Record<string, unknown>[] {
  const out = execFileSync('npx', ['wrangler', 'd1', 'execute', db, '--remote', '--json', '--command', sql], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const parsed = JSON.parse(out) as { results: Record<string, unknown>[] }[];
  return parsed.flatMap((p) => p.results ?? []);
}

async function main() {
  const args = process.argv.slice(2);
  const db = args[args.indexOf('--db') + 1] as DbName;
  if (!args.includes('--db') || !(db in DATABASES)) throw new Error('Say --db pickleball (live) or --db pickleball-preview.');
  const apply = args.includes('--apply');
  const env = wranglerVars(readFileSync(join(process.cwd(), 'wrangler.toml'), 'utf8'), DATABASES[db]);
  const [group] = d1(db, 'SELECT * FROM groups ORDER BY created_at LIMIT 1') as unknown as GroupRow[];
  if (!group) throw new Error('no group');
  const on = (task: string) => d1(db, `SELECT 1 AS x FROM task_log WHERE group_id = ${quote(group.id)} AND session_id IS NULL AND task = ${quote(task)} AND kind = 'mark' LIMIT 1`).length > 0;
  const rows = { shortGames: on(SHORT_GAMES_TASK), bookingHours: on(BOOKING_HOURS.task) };
  const games = d1(db, UNLOCKED_GAMES_SQL.replace('?1', quote(group.id))) as unknown as SessionRow[];
  const locks = planLocks(group, rows, env, games);
  console.log(`${db}: Short games row ${rows.shortGames ? 'on' : 'off'} (kill switch ${env.SHORT_GAMES ?? 'missing = allowed'}), Booking hours row ${rows.bookingHours ? 'on' : 'off'} (kill switch ${env.BOOKING_HOURS ?? 'missing = allowed'})`);
  console.log(`${locks.length} finalized or canceled games without a lock:`);
  for (const [i, l] of locks.entries()) console.log(`  ${games[i].starts_at.slice(0, 16)}Z  ${games[i].status}${games[i].finalized_at ? ', finalized' : ''}  ${l.detail}`);
  if (!apply) {
    console.log('Dry run: nothing written. Add --apply to write them.');
    return;
  }
  const nowIso = new Date().toISOString();
  for (const sql of lockSql(group.id, locks, nowIso)) d1(db, sql);
  const left = d1(db, UNLOCKED_GAMES_SQL.replace('?1', quote(group.id))).length;
  console.log(`Wrote the locks at ${nowIso} (undo: DELETE FROM task_log WHERE task = 'price_lock' AND at = '${nowIso}'). Games still without a lock: ${left} (should be 0).`);
  if (left !== 0) process.exit(1);
}

// Runs only when called with --db (the tests import the functions above and never pass it).
if (process.argv.includes('--db')) {
  main().catch((err) => {
    console.error(String(err instanceof Error ? err.message : err));
    process.exit(1);
  });
}
