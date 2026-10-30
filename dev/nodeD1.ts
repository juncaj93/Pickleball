// A small stand-in for Cloudflare D1 built on Node's built-in SQLite, used
// by tests and `npm run dev`. Same SQL, same triggers, same constraints.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import type { D1Database, D1PreparedStatement, D1Result } from '../server/db';

class Statement implements D1PreparedStatement {
  constructor(
    private db: DatabaseSync,
    private sql: string,
    private values: unknown[] = [],
  ) {}

  bind(...values: unknown[]): D1PreparedStatement {
    return new Statement(this.db, this.sql, values);
  }

  private args(): SQLInputValue[] {
    return this.values.map((v) => (v === undefined ? null : typeof v === 'boolean' ? Number(v) : v)) as SQLInputValue[];
  }

  runSync(): D1Result {
    // A batched read (like real D1) hands its rows back.
    if (/^\s*select\b/i.test(this.sql)) return { results: this.db.prepare(this.sql).all(...this.args()).map((r) => ({ ...r })), meta: { changes: 0 } };
    const res = this.db.prepare(this.sql).run(...this.args());
    return { results: [], meta: { changes: Number(res.changes) } };
  }

  async first<T>(): Promise<T | null> {
    const row = this.db.prepare(this.sql).get(...this.args());
    return (row ? { ...row } : null) as T | null;
  }

  async all<T>(): Promise<D1Result<T>> {
    const rows = this.db.prepare(this.sql).all(...this.args());
    return { results: rows.map((r) => ({ ...r })) as T[], meta: { changes: 0 } };
  }

  async run(): Promise<D1Result> {
    return this.runSync();
  }
}

export function createNodeD1(path = ':memory:', migrationsDir = join(process.cwd(), 'migrations')): D1Database & { raw: DatabaseSync } {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON;');
  const applied = new Set<string>();
  db.exec('CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY)');
  for (const row of db.prepare('SELECT name FROM _migrations').all()) applied.add(String(row.name));
  for (const file of readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()) {
    if (applied.has(file)) continue;
    db.exec(readFileSync(join(migrationsDir, file), 'utf8'));
    db.prepare('INSERT INTO _migrations (name) VALUES (?)').run(file);
  }
  return {
    raw: db,
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
