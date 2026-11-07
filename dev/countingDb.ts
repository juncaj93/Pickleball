// Counts database trips (tests and scripts/count-queries.ts only). A trip is one first()/all()/run(), or one batch() (D1 sends a
// batch in one trip). `seq` lists them in order when set.
import type { D1Database } from '../server/db';

export interface Counted {
  trips: number;
  statements: number;
  sql: string[];
  seq?: string[];
}

export function countingDb(inner: D1Database, c: Counted): D1Database {
  const note = (kind: string, sql: string, vals: unknown[]) => {
    c.trips++;
    c.statements++;
    c.sql.push(sql);
    c.seq?.push(`${kind.padEnd(5)} ${sql.replace(/\s+/g, ' ').slice(0, 110)} ${JSON.stringify(vals).slice(0, 80)}`);
  };
  const wrapStmt = (s: any, sql: string, vals: unknown[] = []): any => ({
    bind: (...v: unknown[]) => wrapStmt(s.bind(...v), sql, v),
    first: () => (note('first', sql, vals), s.first()),
    all: () => (note('all', sql, vals), s.all()),
    run: () => (note('run', sql, vals), s.run()),
    __inner: s,
  });
  return {
    prepare: (sql: string) => wrapStmt(inner.prepare(sql), sql),
    batch: (stmts: any[]) => {
      c.trips++;
      c.statements += stmts.length;
      c.sql.push(`BATCH(${stmts.length})`);
      c.seq?.push(`BATCH(${stmts.length})`);
      return inner.batch(stmts.map((s) => s.__inner ?? s));
    },
  } as D1Database;
}
