// The restore test (Zip 19, docs/RESTORE_TEST.md): does a backup really load back and give the same data?
// Everything here works on THROWAWAY databases in memory (node:sqlite, the same engine the tests use). Nothing here talks to
// Cloudflare: the command (scripts/restore-test.ts) fetches the backup with read-only commands and hands it over.
//
//   source  the data the backup should hold: a fresh export of live (its own SQL, loaded as is), or, for a backup file or weekly
//           copy, the file's rows put in one by one with bound values (a different path from the restore, so a restore bug shows)
//   copy    a fresh database with every migration, filled by the real restore SQL (scripts/backup-sql.mjs, what docs/RESTORE.md runs)
//
// Then: rows per table, every value of every row, money totals, and the site's integrity checks (scripts/integrity-checks.sql),
// source against copy. The report has counts and dollar totals only: no names, no phone numbers.
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNodeD1 } from '../dev/nodeD1';
import { backupToSql, TABLES } from './backup-sql.mjs';

type Db = ReturnType<typeof createNodeD1>;
type Row = Record<string, unknown>;
export type Backup = { format: string; version: number; createdAt: string; groupName: string; tables: Record<string, Row[]> };

const MIGRATIONS = join(process.cwd(), 'migrations');

/** The 21 integrity checks, exactly as docs say to run them on live (comment lines dropped). */
export function integritySql(): string {
  return readFileSync(join(process.cwd(), 'scripts', 'integrity-checks.sql'), 'utf8')
    .split('\n')
    .filter((l) => !/^\s*--/.test(l))
    .join('\n');
}

/** An empty throwaway database with no tables at all (for a live export, which brings its own). */
export function emptyDb(): Db {
  return createNodeD1(':memory:', mkdtempSync(join(tmpdir(), 'restore-test-no-migrations-')));
}

/** A fresh live export (`wrangler d1 export`), loaded as is into a throwaway database. */
export function loadExport(sql: string): Db {
  const db = emptyDb();
  db.raw.exec('PRAGMA foreign_keys = OFF;');
  db.raw.exec(sql);
  return db;
}

/** The columns each table really has in `db` (so a backup with a newer column still loads, as scripts/backup-sql.mjs allows). */
function columnsOf(db: Db): Record<string, Set<string>> {
  const out: Record<string, Set<string>> = {};
  for (const t of TABLES) out[t] = new Set((db.raw.prepare(`SELECT name FROM pragma_table_info('${t}')`).all() as { name: string }[]).map((c) => c.name));
  return out;
}

/**
 * The copy: a fresh throwaway database with every migration, then the restore SQL from docs/RESTORE.md step 1, in one
 * transaction like Cloudflare runs a --file, and the foreign keys checked at the end.
 */
export function restoreCopy(backup: Backup): Db {
  const db = createNodeD1(':memory:', MIGRATIONS);
  const sql = backupToSql(backup, columnsOf(db));
  db.raw.exec('BEGIN');
  try {
    db.raw.exec(sql);
    db.raw.exec('COMMIT');
  } catch (err) {
    db.raw.exec('ROLLBACK');
    throw err;
  }
  const broken = db.raw.prepare('PRAGMA foreign_key_check').all();
  if (broken.length) throw new Error(`${broken.length} rows point at a row that is not there (foreign key check).`);
  return db;
}

/** The source for a backup file or weekly copy: its rows put in one at a time with bound values (not the restore's SQL text). */
export function fileSource(backup: Backup): Db {
  const db = createNodeD1(':memory:', MIGRATIONS);
  db.raw.exec('PRAGMA foreign_keys = OFF;');
  // Only a container for the file's rows: the site's own rules (triggers, like "a canceled game refuses sign-ups") are for new taps,
  // not for putting saved rows back, so they go.
  for (const t of db.raw.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger'").all() as { name: string }[]) db.raw.exec(`DROP TRIGGER "${t.name}"`);
  const known = columnsOf(db);
  db.raw.exec('BEGIN');
  for (const t of TABLES) {
    for (const row of backup.tables[t] ?? []) {
      const cols = Object.keys(row).filter((c) => known[t].has(c));
      db.raw.prepare(`INSERT INTO ${t} (${cols.map((c) => `"${c}"`).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`).run(...(cols.map((c) => row[c] ?? null) as never[]));
    }
  }
  db.raw.exec('COMMIT');
  return db;
}

/** Every backed-up table's rows, in order (what a backup is made of). */
export function tablesOf(db: Db): Record<string, Row[]> {
  const out: Record<string, Row[]> = {};
  for (const t of TABLES) {
    const exists = db.raw.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t);
    out[t] = exists ? (db.raw.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all() as Row[]).map((r) => ({ ...r })) : [];
  }
  return out;
}

/** The money totals both sides must agree on (cents; plain sums over the raw rows, the same SQL on both). */
export const MONEY_SQL = `
WITH pot AS (
  SELECT player_id, SUM(CASE kind WHEN 'kept' THEN amount_cents WHEN 'used' THEN -amount_cents ELSE -(amount_cents - five_cents) END) AS cents
  FROM credit_ledger WHERE ended_at IS NULL GROUP BY player_id
)
SELECT
  (SELECT COUNT(*) FROM sessions) AS games,
  (SELECT COUNT(*) FROM sessions WHERE finalized_at IS NOT NULL) AS finalized_games,
  (SELECT COUNT(*) FROM sessions WHERE status = 'canceled') AS canceled_games,
  (SELECT COALESCE(SUM(cents), 0) FROM pot) AS total_credit_cents,
  (SELECT COUNT(*) FROM pot WHERE cents > 0) AS players_with_credit,
  (SELECT COALESCE(SUM(payment_amount_cents), 0) FROM session_players WHERE payment_status = 'paid' AND refunded_at IS NULL) AS paid_cents,
  (SELECT COUNT(*) FROM session_players sp JOIN sessions s ON s.id = sp.session_id WHERE sp.status = 'confirmed' AND sp.payment_status = 'unpaid' AND s.status <> 'canceled') AS unpaid_seats,
  (SELECT COALESCE(SUM(COALESCE(s.final_price_cents, 1400)), 0) FROM session_players sp JOIN sessions s ON s.id = sp.session_id WHERE sp.status = 'confirmed' AND sp.payment_status = 'unpaid' AND s.status <> 'canceled') AS owed_cents,
  (SELECT COUNT(*) FROM refund_requests WHERE status = 'pending') AS pending_cash_outs,
  (SELECT COALESCE(SUM(amount_cents), 0) FROM refund_requests WHERE status = 'pending') AS pending_cash_out_cents
`;

export function money(db: Db): Record<string, number> {
  return { ...(db.raw.prepare(MONEY_SQL).get() as Record<string, number>) };
}

export function integrity(db: Db): Record<string, number> {
  return { ...(db.raw.prepare(integritySql()).get() as Record<string, number>) };
}

const dollars = (c: number) => `$${(c / 100).toFixed(2)}`;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export type Check = { ok: boolean; line: string };
export type Report = { label: string; ok: boolean; checks: Check[]; notes: string[] };

/**
 * Compare a source with the copy restored from `backup`. `header` (a weekly copy's own row counts, saved when it was made) is checked
 * too when given. Never throws for a bad backup: a restore that fails is a FAIL line saying why.
 */
export function compare(label: string, source: Db, backup: Backup, header?: Record<string, number>): Report {
  const checks: Check[] = [];
  const notes: string[] = [];
  const add = (ok: boolean, line: string) => checks.push({ ok, line });
  let copy: Db;
  try {
    copy = restoreCopy(backup);
    add(true, 'restore into a fresh throwaway database (every migration, then the restore SQL from docs/RESTORE.md): loaded, foreign keys OK');
  } catch (err) {
    add(false, `restore FAILED: ${err instanceof Error ? err.message : String(err)}`);
    return { label, ok: false, checks, notes };
  }

  // 1. Rows per table, and every value of every row.
  const src = tablesOf(source);
  const got = tablesOf(copy);
  const counts: string[] = [];
  let rowsOk = true;
  for (const t of TABLES) {
    const a = src[t];
    const b = got[t];
    counts.push(`${t} ${b.length}`);
    if (a.length !== b.length) {
      rowsOk = false;
      add(false, `${t}: ${a.length} rows in the source, ${b.length} in the copy`);
      continue;
    }
    const bad: string[] = [];
    a.forEach((row, i) => {
      for (const c of Object.keys(row)) if (!same(row[c], b[i][c] ?? null)) bad.push(`row ${i + 1} column ${c}`);
    });
    if (bad.length) {
      rowsOk = false;
      add(false, `${t}: ${bad.length} values differ (first: ${bad[0]})`);
    }
  }
  const total = TABLES.reduce((n, t) => n + got[t].length, 0);
  if (rowsOk) add(true, `rows: all ${total} rows in ${TABLES.length} tables match the source, every value (${counts.join(', ')})`);
  if (header) {
    const off = TABLES.filter((t) => header[t] !== undefined && header[t] !== got[t].length);
    add(!off.length, off.length ? `the copy's own saved counts disagree: ${off.map((t) => `${t} saved ${header[t]}, restored ${got[t].length}`).join('; ')}` : "rows: the weekly copy's own saved counts match");
  }

  // 2. Money.
  const m1 = money(source);
  const m2 = money(copy);
  const moneyLine = `finalized games ${m2.finalized_games} of ${m2.games} (${m2.canceled_games} canceled), total credit ${dollars(m2.total_credit_cents)} (${m2.players_with_credit} players), paid in ${dollars(m2.paid_cents)}, owed ${dollars(m2.owed_cents)} on ${m2.unpaid_seats} unpaid seats, pending cash-outs ${m2.pending_cash_outs} (${dollars(m2.pending_cash_out_cents)})`;
  const moneyOff = Object.keys(m1).filter((k) => m1[k] !== m2[k]);
  add(!moneyOff.length, moneyOff.length ? `money differs: ${moneyOff.map((k) => `${k} source ${m1[k]}, copy ${m2[k]}`).join('; ')}` : `money matches: ${moneyLine}`);

  // 3. The integrity checks. Feature switches live in task_log, which a backup leaves out (worker/backup.ts BACKUP_LEFT_OUT), so a
  // real restore turns them all off. One check reads a switch (Card cleanup lifts the cap to 12), so the source's switch rows are put
  // into the copy first to compare like for like, and a NOTE says which switches a restore would turn off.
  const bare = integrity(copy);
  const switches = switchRows(source);
  if (switches.length) {
    const ins = copy.raw.prepare(`INSERT INTO task_log (${Object.keys(switches[0]).join(', ')}) VALUES (${Object.keys(switches[0]).map(() => '?').join(', ')})`);
    for (const r of switches) ins.run(...(Object.values(r) as never[]));
  }
  const i1 = integrity(source);
  const i2 = integrity(copy);
  const cols = Object.keys(i2);
  const problems = cols.filter((c) => !c.startsWith('info_'));
  const differ = cols.filter((c) => i1[c] !== i2[c]);
  const info = cols.filter((c) => c.startsWith('info_')).map((c) => `${c} ${i2[c]}`).join(', ');
  add(
    !differ.length,
    differ.length
      ? `integrity checks differ: ${differ.map((c) => `${c} source ${i1[c]}, copy ${i2[c]}`).join('; ')}`
      : `integrity checks: all ${cols.length} the same on the copy as on the source (${problems.length} problem checks, ${info})`,
  );
  const dataProblems = problems.filter((c) => i1[c] !== 0 && i1[c] === i2[c]);
  if (dataProblems.length) notes.push(`WARN: the source data itself (not the restore) has: ${dataProblems.map((c) => `${c} ${i1[c]}`).join(', ')}. Look into it; do not change live data without asking.`);
  if (switches.length) {
    const changed = cols.filter((c) => bare[c] !== i2[c]);
    notes.push(
      `NOTE: ${switches.length} switch rows on the source (${[...new Set(switches.map((r) => `${String(r.task).split(':')[0]}${r.kind === 'off' ? ' (off)' : ''}`))].join(', ')}) are not in a backup: after a real restore every one is reset until set again${changed.length ? ` (without them the copy reads ${changed.map((c) => `${c} ${bare[c]}`).join(', ')})` : ''}.`,
    );
  }
  return { label, ok: checks.every((c) => c.ok), checks, notes };
}

/** Group-wide task_log rows (no game): the Settings feature switches and the Smart alerts off switch. Empty when the source has none. */
export function switchRows(db: Db): Row[] {
  const has = db.raw.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'task_log'").get();
  return has ? (db.raw.prepare('SELECT * FROM task_log WHERE session_id IS NULL ORDER BY rowid').all() as Row[]).map((r) => ({ ...r })) : [];
}

export function printReport(r: Report, out: (s: string) => void = console.log) {
  out(`${r.ok ? 'PASS' : 'FAIL'}  ${r.label}`);
  for (const c of r.checks) out(`  ${c.ok ? 'ok  ' : 'FAIL'}  ${c.line}`);
  for (const n of r.notes) out(`  ${n}`);
}
