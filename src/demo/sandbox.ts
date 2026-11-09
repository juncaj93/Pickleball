// The organizer's demo ("View as..." and "Pretend it's..."): a throwaway copy
// of the data in this browser tab, run by the very same server code as the
// live site. Taps change the copy only; the live site is never asked to save
// anything. Reset, leaving the demo, signing out, reloading or closing the
// tab throws the copy away.

import type { Database, SqlJsStatic } from 'sql.js';
import { handleApi } from '../../server/app';
import { ADMIN_COOKIE } from '../../server/context';
import { randomToken, sha256 } from '../../server/crypto';
import type { D1Database, D1PreparedStatement, D1Result } from '../../server/db';
import { backupToSql, TABLES } from '../../scripts/backup-sql.mjs';
import type { DemoExtras } from '../../server/zip18';

type Value = string | number | null | Uint8Array;

class Statement implements D1PreparedStatement {
  constructor(
    private db: Database,
    private sql: string,
    private values: unknown[] = [],
  ) {}

  bind(...values: unknown[]): D1PreparedStatement {
    return new Statement(this.db, this.sql, values);
  }

  private args(): Value[] {
    return this.values.map((v) => (v === undefined ? null : typeof v === 'boolean' ? Number(v) : (v as Value)));
  }

  private rows<T>(): T[] {
    const st = this.db.prepare(this.sql);
    try {
      st.bind(this.args());
      const out: T[] = [];
      while (st.step()) out.push(st.getAsObject() as T);
      return out;
    } finally {
      st.free();
    }
  }

  runSync(): D1Result {
    // A batched read (like real D1) hands its rows back.
    if (/^\s*select\b/i.test(this.sql)) return { results: this.rows(), meta: { changes: 0 } };
    this.db.run(this.sql, this.args());
    return { results: [], meta: { changes: this.db.getRowsModified() } };
  }

  async first<T>(): Promise<T | null> {
    return this.rows<T>()[0] ?? null;
  }

  async all<T>(): Promise<D1Result<T>> {
    return { results: this.rows<T>(), meta: { changes: 0 } };
  }

  async run(): Promise<D1Result> {
    return this.runSync();
  }
}

/** Cloudflare D1's API over an in-memory SQLite database. Same SQL, triggers and rules. */
function d1(db: Database): D1Database {
  return {
    prepare: (sql: string) => new Statement(db, sql),
    async batch(statements: D1PreparedStatement[]) {
      db.exec('BEGIN');
      try {
        const out = statements.map((s) => (s as Statement).runSync());
        db.exec('COMMIT');
        return out;
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    },
  };
}

export interface Sandbox {
  /** Answer one API request from the copy, at `nowMs` (the pretend time while pretending). */
  request(method: string, path: string, body: unknown, headers: Record<string, string>, nowMs: number): Promise<Response>;
}

/**
 * Build the copy: the database layout from the migrations, then every row of
 * a backup file (the same one Settings > Backup downloads), then a sign-in
 * for the organizer that exists only in the copy.
 *
 * `extras` (Zip 18, server/zip18.ts): the task_log rows (every feature switch's row among them) and the deployment's on/off settings,
 * which the backup leaves out. With them the copy answers with the same switches as the live site, so View as shows exactly what that
 * player sees. Null (a server from before Zip 18): no switch rows, every switch reads off, as before.
 */
export async function createSandbox(SQL: SqlJsStatic, backup: unknown, migrations: string[], origin: string, extras: DemoExtras | null = null): Promise<Sandbox> {
  const db = new SQL.Database();
  db.exec('PRAGMA foreign_keys = ON;');
  for (const m of migrations) db.exec(m);
  // Only the columns this copy's tables have (Zip 14): a backup with a newer column (sessions.court) still loads after a rollback.
  const columns: Record<string, Set<string>> = {};
  for (const t of TABLES) columns[t] = new Set((db.exec(`PRAGMA table_info(${t})`)[0]?.values ?? []).map((r) => String(r[1])));
  db.exec(backupToSql(backup, columns));
  if (extras) copyTaskLog(db, extras.taskLog);
  const group = db.exec('SELECT id FROM groups LIMIT 1')[0]?.values[0]?.[0];
  const token = randomToken();
  db.run('INSERT INTO admin_sessions (id, group_id, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)', [
    'demo',
    String(group),
    await sha256(token),
    '2000-01-01T00:00:00.000Z',
    '9999-12-31T00:00:00.000Z',
  ]);
  // The live site's on/off settings (kill switches; on a preview the preview-only ones too), then the two the copy always has.
  const env = { ...(extras?.env ?? {}), DB: d1(db), SANDBOX: true };
  return {
    request(method, path, body, headers, nowMs) {
      // A plain stand-in for a Request: browsers drop a Cookie header from a
      // real one, and the organizer's sign-in to the copy travels in it.
      // The server code reads only these four things.
      const h = new Headers(headers);
      h.set('Cookie', `${ADMIN_COOKIE}=${token}`);
      if (body !== undefined) h.set('Content-Type', 'application/json');
      const text = body === undefined ? '' : JSON.stringify(body);
      const req = { method, url: origin + path, headers: h, text: async () => text } as unknown as Request;
      return handleApi(req, env, nowMs);
    },
  };
}

/**
 * The live task_log rows into the copy, column by column the copy's table has (like the backup's rows). A row that no longer fits (its
 * game was removed between the two reads) is skipped; the rest still go in.
 */
function copyTaskLog(db: Database, rows: DemoExtras['taskLog']) {
  const have = new Set((db.exec('PRAGMA table_info(task_log)')[0]?.values ?? []).map((r) => String(r[1])));
  for (const row of rows) {
    const cols = Object.keys(row).filter((c) => have.has(c));
    if (cols.length === 0) continue;
    const values = cols.map((c) => (row as unknown as Record<string, Value>)[c] ?? null);
    try {
      db.run(`INSERT OR IGNORE INTO task_log (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, values);
    } catch {
      // Skipped: see above.
    }
  }
}
