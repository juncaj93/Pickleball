// The read-only organizer PIN (Zip 8). A second organizer PIN, kept only as the Cloudflare secret
// ORGANIZER_READONLY_PIN, that opens every organizer screen and refuses every save. It exists so a
// helper can check the live site after a deploy without the real PIN.
//
// How it stays safe:
// - No secret (or a malformed one) = the feature does not exist: that PIN is never accepted, and any
//   view-only sign-in already made stops working at once (the kill switch).
// - A view-only sign-in is its own row in admin_sessions: its id starts with "ro:" and the cookie
//   value the phone holds starts with "ro.". The cookie is checked against the stored hash, so the
//   prefix cannot be added or removed without the sign-in becoming invalid.
// - Every POST, PUT, PATCH and DELETE from a view-only phone is refused in server/app.ts before any
//   route runs (only sign in and sign out are let through), and its reads run on a database that
//   cannot be written to (viewOnlyDb below), so even upkeep writes inside a read do nothing.
// - Same lockout as the real PIN (server/auth.ts counts every guess the same way). The PIN is never
//   written to a log or any screen. The database holds only a short fingerprint of it in each view-only
//   sign-in's id (so a changed PIN signs helpers out); someone who can read the whole database could work
//   the read-only PIN out from that, never the real PIN.

import type { D1Database, D1PreparedStatement, D1Result, Env } from './db';
import { ADMIN_COOKIE, type Ctx } from './context';

/** The start of a view-only sign-in's cookie value (never produced by randomToken, which has no "."). */
export const VIEW_ONLY_COOKIE_PREFIX = 'ro.';
/** The start of a view-only sign-in's admin_sessions.id (real sign-ins use a bare UUID). */
export const VIEW_ONLY_SESSION_PREFIX = 'ro:';
/** A view-only sign-in lasts 12 hours (the real one lasts 30 days). */
export const VIEW_ONLY_SESSION_HOURS = 12;

export const VIEW_ONLY_MESSAGE = 'View only. Nothing was saved.';

/** The two writes a view-only phone may make: sign in (for example with the real PIN) and sign out. */
export const VIEW_ONLY_ALLOWED_WRITES = new Set(['POST /api/admin/login', 'POST /api/admin/logout']);

/** The read-only PIN, or null when the secret is missing or not 6 to 12 digits (then the feature is off). */
export function readOnlyPin(env: Env): string | null {
  const pin = typeof env.ORGANIZER_READONLY_PIN === 'string' ? env.ORGANIZER_READONLY_PIN.trim() : null;
  return pin && /^\d{6,12}$/.test(pin) ? pin : null;
}

/**
 * The admin_sessions.id start for a view-only sign-in made with today's secret: "ro:" plus a short fingerprint of the secret.
 * Changing the secret changes the fingerprint, so every view-only sign-in made with the old PIN stops working at once.
 */
export async function viewOnlySessionPrefix(pin: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`view-only-pin:${pin}`)));
  return `${VIEW_ONLY_SESSION_PREFIX}${[...bytes.slice(0, 6)].map((b) => b.toString(16).padStart(2, '0')).join('')}:`;
}

/** Does this request carry a view-only sign-in? (Whether it is still valid is requireAdmin's job.) */
export function viewOnlyCookie(ctx: Ctx): boolean {
  return (ctx.cookies[ADMIN_COOKIE] ?? '').startsWith(VIEW_ONLY_COOKIE_PREFIX);
}

export function isWrite(method: string): boolean {
  return method !== 'GET' && method !== 'HEAD';
}

// ---------- The database a view-only read runs on ----------
// Only plain reads reach the real database. Anything else (INSERT, UPDATE, DELETE, a WITH that writes, PRAGMA, ...)
// quietly does nothing, so upkeep inside a read (adding next weeks' games, a log line) is skipped. Unlike the
// "Pretend it's" copy (server/pretend.ts), a batch of reads really runs, so every screen shows the real numbers.
// It also reads as a pretend database to the alert code, so a view-only read never sends a Telegram message.

const READ = /^\s*SELECT\b/i;
const CTE_READ = /^\s*WITH\b/i;
const WRITE_WORD = /\b(INSERT|UPDATE|DELETE|REPLACE|CREATE|DROP|ALTER|PRAGMA|ATTACH|VACUUM|REINDEX)\b/i;
const NOTHING: D1Result = { results: [], meta: { changes: 0 } };

/** Is this SQL a plain read? Anything doubtful counts as a write (and does nothing). */
export function isReadSql(sql: string): boolean {
  if (READ.test(sql)) return !/\bRETURNING\b/i.test(sql) && !/^\s*SELECT\b[\s\S]*;\s*\S/.test(sql);
  if (CTE_READ.test(sql)) return !WRITE_WORD.test(sql);
  return false;
}

class ViewOnlyStatement implements D1PreparedStatement {
  constructor(
    readonly inner: D1PreparedStatement,
    readonly read: boolean,
  ) {}
  bind(...values: unknown[]): D1PreparedStatement {
    return new ViewOnlyStatement(this.inner.bind(...values), this.read);
  }
  first<T>(): Promise<T | null> {
    return this.read ? this.inner.first<T>() : Promise.resolve(null);
  }
  all<T>(): Promise<D1Result<T>> {
    return this.read ? this.inner.all<T>() : Promise.resolve(NOTHING as D1Result<T>);
  }
  run(): Promise<D1Result> {
    return this.read ? this.inner.run() : Promise.resolve(NOTHING);
  }
}

export function viewOnlyDb(db: D1Database): D1Database & { readonly pretend: true } {
  return {
    pretend: true,
    prepare: (sql: string) => new ViewOnlyStatement(db.prepare(sql), isReadSql(sql)),
    batch: async (statements: D1PreparedStatement[]) => {
      const mine = statements.map((s) => (s instanceof ViewOnlyStatement ? s : null));
      // All reads: one real batch (same snapshot, same answer as for the real PIN). Otherwise each read on its own, writes skipped.
      if (mine.every((s) => s?.read)) return db.batch(mine.map((s) => s!.inner));
      const out: D1Result[] = [];
      for (const s of mine) out.push(s?.read ? await s.inner.all() : NOTHING);
      return out;
    },
  };
}
