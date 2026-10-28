// The slice of Cloudflare D1's API this app uses. The production binding
// satisfies it directly; tests and local dev use a node:sqlite adapter.

export interface D1Result<T = Record<string, unknown>> {
  results: T[];
  meta: { changes: number };
}

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  run(): Promise<D1Result>;
}

export interface D1Database {
  prepare(sql: string): D1PreparedStatement;
  /** Runs all statements in one transaction; any failure rolls back all of them. */
  batch(statements: D1PreparedStatement[]): Promise<D1Result[]>;
}

export interface Env {
  DB: D1Database;
  /** One-time secret the organizer types into the setup page. */
  SETUP_TOKEN?: string;
  /** The public site address, e.g. https://pickleball.juncaj.net. Falls back to whatever address was used. */
  SITE_URL?: string;
  /**
   * Set only by the organizer's in-browser demo copy (src/demo/sandbox.ts),
   * never on Cloudflare: there, taps in "View as" really run, on a throwaway
   * copy of the data that lives in that browser tab.
   */
  SANDBOX?: boolean;
}

/** True when a write was rejected by one of the schema's RAISE(ABORT, ...) triggers. */
export function isTriggerError(err: unknown, code: 'session_full' | 'session_canceled'): boolean {
  return err instanceof Error && err.message.includes(code);
}
