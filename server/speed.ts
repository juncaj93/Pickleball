import type { Ctx } from './context';
import type { D1Database, D1PreparedStatement, D1Result } from './db';
import { newId } from './crypto';
import { isReadSql } from './viewOnly';
import { DIRECT_LOAD_HEADER, LAST_SCREEN_HEADER, SPEED_QUERIES_HEADER, speedAllowed } from '../shared/speed';

// Zip 12 (shared/speed.ts): SPEED_FEWER_QUERIES, SPEED_DIRECT_LOAD and SPEED_LAST_SCREEN. Each is on for a request when:
//  - its wrangler.toml var is not "off" (the kill switch, needs a deploy), and
//  - the organizer switched it on in Settings > Feature switches (every phone), or this phone opened the site with ?fewerqueries=on /
//    ?directload=on / ?lastscreen=on (it then sends the matching header: a private test switch for that phone only).
// "On for everyone" is one row in task_log (kind 'mark', no game): no schema change, the same way the other switches are stored.
//
// SPEED_FEWER_QUERIES changes HOW the server reads, never WHAT it answers. With it on, the request's database is wrapped
// (fewerQueriesDb below):
//  1. Every feature switch question ("is the row for X on?", 20+ of them per screen, one database trip each) is answered from ONE
//     read of all the switch rows, taken the first time one is asked.
//  2. The same read (same words, same values) asked twice in one request is answered the second time from the first answer.
//  3. Anything that writes (a tap that saves, upkeep that adds next week's games, a switch flipped) throws both away at once, so
//     every read after a write goes to the database again, exactly as today.
//  4. Once the answer has been sent (handleApi calls finish()), the wrapper steps aside: work left running after the answer (a
//     Telegram alert) reads the database directly, as today.

export const SPEED_FEWER_QUERIES_TASK = 'speed_fewer_queries_on';
export const SPEED_DIRECT_LOAD_TASK = 'speed_direct_load_on';
export const SPEED_LAST_SCREEN_TASK = 'speed_last_screen_on';

/** The one switch question every feature switch asks, word for word (server/zip10.ts, zip9.ts, payAlways.ts, ...). */
export const SWITCH_READ = "SELECT 1 AS x FROM task_log WHERE group_id = ? AND session_id IS NULL AND task = ? AND kind = 'mark' LIMIT 1";
/** Every switch row of every group in one read (the site has one group). Same index as the question above (task_log_group). */
export const ALL_SWITCHES_READ =
  "SELECT t.group_id, t.task FROM groups g CROSS JOIN task_log t ON t.group_id = g.id AND t.kind = 'mark' WHERE t.session_id IS NULL";

const norm = (sql: string) => sql.replace(/\s+/g, ' ').trim();
const SWITCH_READ_NORM = norm(SWITCH_READ);

type Switches = Map<string, Set<string>>;

function switchesFrom(rows: { group_id: string; task: string }[]): Switches {
  const out: Switches = new Map();
  for (const r of rows) {
    const set = out.get(r.group_id) ?? new Set<string>();
    set.add(r.task);
    out.set(r.group_id, set);
  }
  return out;
}

export interface FewerQueriesDb extends D1Database {
  /** The answer has been sent: from now on every call goes straight to the database (nothing remembered). */
  finish(): void;
  /**
   * Reads a screen is about to make, sent in ONE database trip (a batch of reads) and kept for the questions that follow. Only while
   * the switch is on; a read that is never asked costs nothing more than its share of the one trip. `kind` says how the code asks
   * it (first() or all()), so the kept answer is exactly what that call gets.
   */
  prefetch(reads: { kind: 'first' | 'all'; sql: string; values: unknown[] }[]): Promise<void>;
}

/**
 * The request's database (see the top of this file). `mode`:
 *  - 'fast': the switch is on for this request (the private test link, or tests).
 *  - 'decide': the kill switch allows it, the Settings row is not known yet. The first switch question of the request is answered
 *    from the read of all switch rows (one trip, like the one question it replaces); that read also says whether the Settings row is
 *    on. On: 'fast' from then on. Off: every later call goes straight to the database, exactly as today (no trip added).
 */
export function fewerQueriesDb(inner: D1Database, mode: 'fast' | 'decide'): FewerQueriesDb {
  let state: 'fast' | 'decide' | 'plain' = mode;
  const lookOnly = (inner as { pretend?: boolean }).pretend === true;
  let known: Switches | null = null;
  const memo = new Map<string, unknown>();
  // Goes up on every write: an answer that set off before a write is never kept (or used for the switches) after it.
  let generation = 0;
  const forget = () => {
    generation++;
    known = null;
    memo.clear();
  };
  const keyOf = (kind: string, sql: string, values: unknown[]) => `${kind}\u0000${sql}\u0000${JSON.stringify(values)}`;
  const remembered = <T>(key: string, load: () => Promise<T>): Promise<T> => {
    if (state !== 'fast') return load();
    if (memo.has(key)) return Promise.resolve(structuredClone(memo.get(key)) as T);
    const startedAt = generation;
    return load().then((value) => {
      // Kept only if nothing wrote in the meantime (a write empties the memo; this answer may be from before it).
      if (state === 'fast' && generation === startedAt) memo.set(key, structuredClone(value));
      return value;
    });
  };
  const writeDone = <T>(p: Promise<T>): Promise<T> => {
    forget();
    return state === 'fast' ? p.finally(forget) : p;
  };

  class Stmt implements D1PreparedStatement {
    constructor(
      readonly inner: D1PreparedStatement,
      readonly sql: string,
      readonly read: boolean,
      readonly values: unknown[] = [],
    ) {}
    bind(...values: unknown[]): D1PreparedStatement {
      return new Stmt(this.inner.bind(...values), this.sql, this.read, values);
    }
    first<T = Record<string, unknown>>(): Promise<T | null> {
      // Off for this request (or the answer was sent): the database's own call, untouched (not even an extra wait).
      if (state === 'plain') return this.inner.first<T>();
      return this.firstOn<T>();
    }
    private async firstOn<T>(): Promise<T | null> {
      if (!this.read) return writeDone(this.inner.first<T>());
      if (state !== 'plain' && this.values.length === 2 && norm(this.sql) === SWITCH_READ_NORM) {
        const [groupId, task] = this.values as [string, string];
        if (!known) {
          const startedAt = generation;
          const rows = await inner
            .prepare(ALL_SWITCHES_READ)
            .all<{ group_id: string; task: string }>()
            .catch(() => null);
          // A failed read (no task_log table yet), or something wrote while it was being read: ask the question itself, as today.
          if (!rows || generation !== startedAt || (state as string) === 'plain') {
            if (state === 'decide') state = 'plain';
            return this.inner.first<T>();
          }
          known = switchesFrom(rows.results);
          if (state === 'decide') state = known.get(String(groupId))?.has(SPEED_FEWER_QUERIES_TASK) ? 'fast' : 'plain';
          // Off: this one question was answered by the read that replaced it; from here on, everything as today.
          if (state === 'plain') {
            const answer = known.get(String(groupId))?.has(String(task));
            known = null;
            return (answer ? { x: 1 } : null) as T | null;
          }
        }
        return (known.get(String(groupId))?.has(String(task)) ? { x: 1 } : null) as T | null;
      }
      return remembered(keyOf('first', this.sql, this.values), () => this.inner.first<T>());
    }
    all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
      if (state === 'plain') return this.inner.all<T>();
      if (!this.read) return writeDone(this.inner.all<T>());
      return remembered(keyOf('all', this.sql, this.values), () => this.inner.all<T>());
    }
    run(): Promise<D1Result> {
      if (state === 'plain' || this.read) return this.inner.run();
      return writeDone(this.inner.run());
    }
  }

  const db: FewerQueriesDb & { pretend?: true } = {
    prepare: (sql: string) => new Stmt(inner.prepare(sql), sql, isReadSql(sql)),
    batch: (statements: D1PreparedStatement[]) => {
      const plain = statements.map((s) => (s instanceof Stmt ? s.inner : s));
      if (state === 'plain') return inner.batch(plain);
      const reads = statements.every((s) => s instanceof Stmt && s.read);
      if (!reads) return writeDone(inner.batch(plain));
      // A batch of reads that a prefetch already answered (the change stamp): every answer from it, no trip.
      if (state === 'fast') {
        const keys = (statements as Stmt[]).map((s) => keyOf('all', s.sql, s.values));
        if (keys.every((k) => memo.has(k))) return Promise.resolve(keys.map((k) => structuredClone(memo.get(k)) as D1Result));
      }
      return inner.batch(plain);
    },
    finish: () => {
      state = 'plain';
      forget();
    },
    prefetch: async (reads) => {
      // Not on a look-only database ("Pretend it's...", the read-only PIN): their batches are not plain reads (server/pretend.ts).
      if (state !== 'fast' || lookOnly) return;
      const todo = reads.filter((r) => isReadSql(r.sql) && !memo.has(keyOf(r.kind, r.sql, r.values)));
      if (todo.length === 0) return;
      const startedAt = generation;
      const results = await inner.batch(todo.map((r) => inner.prepare(r.sql).bind(...r.values))).catch(() => null);
      // A failed batch, or a write meanwhile: keep nothing (each read then goes to the database on its own, as today).
      if (!results || results.length !== todo.length || state !== 'fast' || generation !== startedAt) return;
      todo.forEach((r, i) => {
        const res = results[i];
        const value = r.kind === 'first' ? (res.results[0] ?? null) : { results: res.results, meta: res.meta };
        memo.set(keyOf(r.kind, r.sql, r.values), structuredClone(value));
      });
    },
  };
  // "Pretend it's..." and the read-only PIN mark their databases (server/pretend.ts isPretend): keep the mark.
  if ((inner as { pretend?: boolean }).pretend === true) db.pretend = true;
  return db;
}

/** Tests only: `globalThis.__PB_SPEED_FORCE = true` turns SPEED_FEWER_QUERIES on for every request (tests/setup-speed.ts). Never set on Cloudflare. */
const forced = () => (globalThis as { __PB_SPEED_FORCE?: boolean }).__PB_SPEED_FORCE === true;

/**
 * SPEED_FEWER_QUERIES for this request: puts the wrapped database on the context unless the kill switch says "off" (then nothing
 * changes at all). Deciding costs no extra trip (see fewerQueriesDb 'decide'). Any phone may use the private test link: it changes
 * no answer, only how many times the database is asked.
 */
export function withFewerQueries(ctx: Ctx): { ctx: Ctx; db: FewerQueriesDb | null } {
  if (!forced() && !speedAllowed(ctx.env.SPEED_FEWER_QUERIES)) return { ctx, db: null };
  const header = (ctx.req.headers.get(SPEED_QUERIES_HEADER) ?? '').toLowerCase() === 'on';
  const db = fewerQueriesDb(ctx.db, header || forced() ? 'fast' : 'decide');
  return { ctx: { ...ctx, db, env: { ...ctx.env, DB: db } }, db };
}

/** The request's SPEED_FEWER_QUERIES database, if any (for prefetch; it does nothing unless the switch is on for the request). */
export function asFewer(db: D1Database): FewerQueriesDb | null {
  const d = db as Partial<FewerQueriesDb>;
  return typeof d.prefetch === 'function' ? (db as FewerQueriesDb) : null;
}
export const fewerDb = (ctx: Ctx) => asFewer(ctx.db);

async function forAll(db: D1Database, groupId: string, task: string): Promise<boolean> {
  const row = await db.prepare(SWITCH_READ).bind(groupId, task).first().catch(() => null);
  return !!row;
}

async function setForAll(db: D1Database, groupId: string, task: string, on: boolean, nowIso: string): Promise<void> {
  await db.prepare("DELETE FROM task_log WHERE group_id = ? AND session_id IS NULL AND task = ? AND kind = 'mark'").bind(groupId, task).run();
  if (on) {
    await db.prepare("INSERT INTO task_log (id, group_id, session_id, task, kind, at) VALUES (?, ?, NULL, ?, 'mark', ?)").bind(newId(), groupId, task, nowIso).run();
  }
}

async function onFor(ctx: Ctx, groupId: string, flag: string | undefined, header: string, task: string): Promise<boolean> {
  if (!speedAllowed(flag)) return false;
  if ((ctx.req.headers.get(header) ?? '').toLowerCase() === 'on') return true;
  return forAll(ctx.db, groupId, task);
}

export const fewerQueriesForAll = (db: D1Database, groupId: string) => forAll(db, groupId, SPEED_FEWER_QUERIES_TASK);
export const setFewerQueriesForAll = (db: D1Database, groupId: string, v: boolean, nowIso: string) => setForAll(db, groupId, SPEED_FEWER_QUERIES_TASK, v, nowIso);

export const directLoadForAll = (db: D1Database, groupId: string) => forAll(db, groupId, SPEED_DIRECT_LOAD_TASK);
export const setDirectLoadForAll = (db: D1Database, groupId: string, v: boolean, nowIso: string) => setForAll(db, groupId, SPEED_DIRECT_LOAD_TASK, v, nowIso);
/** SPEED_DIRECT_LOAD for this phone: the answer rides on /api/status and /api/group, and the page remembers it for its next open. */
export const directLoadFor = (ctx: Ctx, groupId: string) => onFor(ctx, groupId, ctx.env.SPEED_DIRECT_LOAD, DIRECT_LOAD_HEADER, SPEED_DIRECT_LOAD_TASK);

export const lastScreenForAll = (db: D1Database, groupId: string) => forAll(db, groupId, SPEED_LAST_SCREEN_TASK);
export const setLastScreenForAll = (db: D1Database, groupId: string, v: boolean, nowIso: string) => setForAll(db, groupId, SPEED_LAST_SCREEN_TASK, v, nowIso);
/** SPEED_LAST_SCREEN for this phone: rides on /api/group; the page saves a copy only while it says yes, and throws it away when it says no. */
export const lastScreenFor = (ctx: Ctx, groupId: string) => onFor(ctx, groupId, ctx.env.SPEED_LAST_SCREEN, LAST_SCREEN_HEADER, SPEED_LAST_SCREEN_TASK);
