import type { D1Database, D1PreparedStatement, D1Result } from './db';

// "Pretend it's...": the organizer previews the site at another moment.
// Pages are built for that time from a database that can't be written to:
// any write (adding future games, issuing credits, logging) quietly does
// nothing, and credits a page would have issued are kept in memory only.

export const PRETEND_HEADER = 'X-Pretend-Now';

/** Earliest and latest pretend times accepted. */
const MIN_MS = Date.parse('2020-01-01T00:00:00Z');
const MAX_MS = Date.parse('2100-01-01T00:00:00Z');

/** The pretend time from the header, or null if it isn't a sensible ISO time. */
export function parsePretend(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) && ms >= MIN_MS && ms < MAX_MS ? ms : null;
}

const WRITE = /^\s*(INSERT|UPDATE|DELETE|REPLACE)\b/i;
const NOTHING: D1Result = { results: [], meta: { changes: 0 } };

class ReadOnlyStatement implements D1PreparedStatement {
  constructor(
    private inner: D1PreparedStatement,
    private write: boolean,
  ) {}
  bind(...values: unknown[]): D1PreparedStatement {
    return new ReadOnlyStatement(this.inner.bind(...values), this.write);
  }
  first<T>(): Promise<T | null> {
    return this.write ? Promise.resolve(null) : this.inner.first<T>();
  }
  all<T>(): Promise<D1Result<T>> {
    return this.write ? Promise.resolve(NOTHING as D1Result<T>) : this.inner.all<T>();
  }
  run(): Promise<D1Result> {
    return this.write ? Promise.resolve(NOTHING) : this.inner.run();
  }
}

/** Credit rows a pretend page would have issued, keyed by id, never saved. */
export interface PretendDb extends D1Database {
  readonly pretend: true;
  virtualCredits: Map<string, Record<string, unknown>>;
}

export function readOnly(db: D1Database): PretendDb {
  return {
    pretend: true,
    virtualCredits: new Map(),
    prepare: (sql: string) => new ReadOnlyStatement(db.prepare(sql), WRITE.test(sql)),
    batch: async (statements: D1PreparedStatement[]) => statements.map(() => NOTHING),
  };
}

export function isPretend(db: D1Database): db is PretendDb {
  return (db as Partial<PretendDb>).pretend === true;
}
