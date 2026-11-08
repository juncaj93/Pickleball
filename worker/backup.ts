// The weekly backup copy (Zip 8). The 5-minute clock (worker/cron.ts) checks once an hour whether a copy is due; once a week
// (Sunday from 3:00 AM Eastern, or at once if the last copy is more than 8 days old) it reads the live database and saves the
// same file Settings > Backup downloads (server/backupData.ts) into a separate private database, `pickleball-backups`.
// The last 8 copies are kept; older ones are deleted. Restore: docs/RESTORE.md ("Weekly copies"); restore test: docs/RESTORE_TEST.md.
//
// Lighter since Zip 19 (the one run took about 13 ms of CPU on Sun Nov 8; the free plan's guideline is 10 ms):
// - The database itself writes each table out as JSON text (rowJsonSql), so the Worker never turns rows into objects and back.
// - The copy is made in small STEPS (about 100,000 characters each), and each step is its own run of the clock Worker (it calls itself
//   through its private SELF binding, worker/cron.ts), so no run's CPU grows with the data. A plan step reads only sizes first.
// - One moment: all steps run within seconds, and the plan's fingerprint of every table (rows, rowids, sizes, number sums) is taken
//   again at the end. If anything changed, the attempt is thrown away and tried again at the next hourly look.
// - All or nothing: an unfinished copy has a row in weekly_backup_progress (INCOMPLETE in `node scripts/weekly-backup.mjs list`) and
//   no row in weekly_backups, so nothing can list, fetch or restore it. Its header row and the end of its progress row are written in
//   one transaction. The next attempt clears unfinished pieces only, never a finished copy.
// - The file is the same JSON as before, character for character, read back the same way (scripts/weekly-backup.mjs, docs/RESTORE.md).
//
// - The live database is only READ here (SELECTs). Every write goes to the backup database.
// - The copy has phone numbers. It lives only in Alex's Cloudflare account (a D1 database has no public address), never in git.
// - Free: D1 is on the free plan (5 GB in all, this is well under 1 MB a week), and it rides on the existing cron trigger
//   (the free plan's 5 cron triggers are all in use, so a new one was not an option).
import type { D1Database } from '../server/db';
import { BACKUP_TABLES } from '../server/backupData';
import { localParts } from '../shared/time';

export const BACKUP_TZ = 'America/Detroit';
/** How many weekly copies stay. */
export const KEEP_COPIES = 8;
/** Each copy is stored in pieces of at most this many characters (well under D1's size limits for one value). */
export const PART_CHARS = 90_000;
/** The database hands each table back in pieces of at most this many rows (each piece far under D1's 2 MB limit for one value). */
export const CHUNK_ROWS = 200;
/** Columns per json_object() call: D1 refuses a function call with more than 127 arguments (tested Nov 8: 63 columns fail), so wide tables are built from several. */
export const COLUMNS_PER_CALL = 16;
/** About how many characters one step copies: each step is its own Worker run (a few ms of CPU, measured Nov 8). */
export const STEP_CHARS = 60_000;
/**
 * Each step starts the next one itself (one call each, about 1.2 ms of CPU; a run that called every step would pay that per step).
 * Chains are at most this long (Cloudflare limits how deep calls can nest), and the main run starts one chain after another.
 */
export const CHAIN_STEPS = 20;
/** The plan measures each table in buckets of this many rows; a step never splits a bucket. */
export const BUCKET_ROWS = 25;
/** A copy needing more steps than this (about 4.8 MB) is refused with a log line: far beyond this group, so a sign something is wrong. */
export const MAX_STEPS = 80;
/** A copy is due on Sunday from this Eastern hour... */
export const BACKUP_HOUR = 3;
const DAY_MS = 86_400_000;

export const BACKUP_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS weekly_backups (
     id TEXT PRIMARY KEY,
     week TEXT NOT NULL UNIQUE,
     created_at TEXT NOT NULL,
     bytes INTEGER NOT NULL,
     parts INTEGER NOT NULL,
     rows_json TEXT NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS weekly_backup_parts (
     backup_id TEXT NOT NULL,
     part INTEGER NOT NULL,
     data TEXT NOT NULL,
     PRIMARY KEY (backup_id, part)
   )`,
  // Zip 19: a copy being made in steps. A row here = INCOMPLETE (never in weekly_backups until every step is saved).
  `CREATE TABLE IF NOT EXISTS weekly_backup_progress (
     id TEXT PRIMARY KEY,
     week TEXT NOT NULL,
     started_at TEXT NOT NULL,
     steps INTEGER NOT NULL,
     done INTEGER NOT NULL
   )`,
];

/** The Eastern date ("2026-11-08") of the Sunday that starts the week `nowMs` is in: one copy per week. */
export function weekOf(nowMs: number): string {
  const p = localParts(nowMs, BACKUP_TZ);
  const d = new Date(Date.UTC(p.year, p.month - 1, p.day - p.weekday));
  return d.toISOString().slice(0, 10);
}

/**
 * Is a copy due? Sunday from 3:00 AM Eastern when this week has none yet; or any time when the newest copy is more than 8 days old
 * (or there is none: the first copy is made within the hour after this is deployed).
 */
export function backupDue(nowMs: number, newest: { week: string; createdAt: string } | null): boolean {
  if (!newest) return true;
  if (nowMs - Date.parse(newest.createdAt) > 8 * DAY_MS) return true;
  const p = localParts(nowMs, BACKUP_TZ);
  return p.weekday === 0 && p.hour >= BACKUP_HOUR && newest.week !== weekOf(nowMs);
}

/** Only one tick an hour looks (minute 0 to 4 Eastern), so the other ticks never touch either database. */
export function checkThisTick(nowMs: number): boolean {
  return localParts(nowMs, BACKUP_TZ).minute < 5;
}

/** Split a long text into pieces of at most `size` characters. */
export function splitParts(text: string, size = PART_CHARS): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < text.length) {
    let end = Math.min(i + size, text.length);
    // Never cut an emoji (a two-part character) in half: end the piece one character early instead.
    const code = text.charCodeAt(end - 1);
    if (end < text.length && code >= 0xd800 && code <= 0xdbff) end--;
    out.push(text.slice(i, end));
    i = end;
  }
  return out.length ? out : [''];
}

/**
 * Tables in the database that are NOT in a backup, and why. Every table must be in BACKUP_TABLES or here
 * (tests/backup-coverage.test.ts reads the migrations), so a new table is never forgotten by accident.
 */
export const BACKUP_LEFT_OUT: Record<string, string> = {
  admin_sessions: 'organizer sign-ins: short-lived, and a restore signs everyone out',
  login_attempts: 'wrong-PIN counts: short-lived',
  rate_events: 'spam counters: short-lived',
  organizer_alerts: 'Telegram alert switches and the last try: a restore empties it, so every alert type comes back On (as since Zip 8)',
  task_log: 'feature switches, "Do this now" taps and sent alerts: a restore empties it (docs/RESTORE.md says what to check after)',
};

const NAME = /^[a-z_][a-z0-9_]*$/;

/** One row as JSON text, built by the database: `json_object('a', "a", ...)`, joined from several calls for a wide table. */
export function rowJsonSql(columns: string[]): string {
  if (!columns.length) throw new Error('A backed-up table has no columns.');
  for (const c of columns) if (!NAME.test(c)) throw new Error(`Bad column name: ${c}`);
  const calls: string[] = [];
  for (let i = 0; i < columns.length; i += COLUMNS_PER_CALL) {
    calls.push(`json_object(${columns.slice(i, i + COLUMNS_PER_CALL).map((c) => `'${c}', "${c}"`).join(', ')})`);
  }
  if (calls.length === 1) return calls[0];
  // '{"a":1}' + '{"b":2}' -> '{"a":1,"b":2}': drop the closing brace of every call but the last and the opening brace of every call but the first.
  return calls
    .map((c, i) => (i === 0 ? `substr(${c}, 1, length(${c}) - 1)` : i === calls.length - 1 ? `',' || substr(${c}, 2)` : `',' || substr(${c}, 2, length(${c}) - 2)`))
    .join(' || ');
}

/**
 * The backup file as text, the same JSON Settings > Backup downloads (server/backupData.ts `backupObject`), with the database doing the
 * work: one batch reads each table's column names, then ONE batch (one consistent moment, no row without its parent) asks the database
 * for every table as JSON text, a piece of up to 200 rows at a time. The Worker only joins those pieces, so its CPU barely grows with
 * the data. Reads only (plain SELECTs).
 */
export async function backupText(db: D1Database, groupName: string, nowIso: string): Promise<{ text: string; rows: Record<string, number> }> {
  for (const t of BACKUP_TABLES) if (!NAME.test(t)) throw new Error(`Bad table name: ${t}`);
  const cols = await db.batch(BACKUP_TABLES.map((t) => db.prepare(`SELECT name FROM pragma_table_info('${t}') ORDER BY cid`)));
  const read = await db.batch(
    BACKUP_TABLES.map((t, i) => {
      const row = rowJsonSql((cols[i].results as { name: string }[]).map((c) => c.name));
      return db.prepare(`SELECT rowid / ${CHUNK_ROWS} AS chunk, COUNT(*) AS n, group_concat(${row}, ',' ORDER BY rowid) AS j FROM ${t} GROUP BY chunk ORDER BY chunk`);
    }),
  );
  const rows: Record<string, number> = {};
  const out = [`{"format":"pickleball-backup","version":1,"createdAt":${JSON.stringify(nowIso)},"groupName":${JSON.stringify(groupName)},"tables":{`];
  BACKUP_TABLES.forEach((t, i) => {
    const pieces = read[i].results as { n: number; j: string }[];
    rows[t] = pieces.reduce((sum, p) => sum + Number(p.n), 0);
    out.push(`${i ? ',' : ''}${JSON.stringify(t)}:[${pieces.map((p) => p.j).join(',')}]`);
  });
  out.push('}}');
  return { text: out.join(''), rows };
}

export type BackupResult = { made: false; reason: string } | { made: true; week: string; bytes: number; parts: number; rows: Record<string, number>; kept: number };

/** One slice of one table: the rows with rowid lo..hi (none for an empty table), and whether it opens or closes the table's list. */
export type Slice = { table: string; lo: number | null; hi: number | null; rows: number; open: boolean; close: boolean; firstTable: boolean };
/** What one step does: read its slices (one consistent read), save them as piece `part` of copy `id`, then start `rest` (the chain). */
export type StepBody = { id: string; part: number; prefix: string; suffix: string; slices: Slice[]; columns: Record<string, string[]>; rest?: StepBody[] };
/** Runs one step (and the rest of its chain): in this same run (tests, or without the SELF binding) or as its own Worker run (worker/cron.ts). */
export type StepRunner = (body: StepBody) => Promise<{ chars: number }>;

type Bucket = { n: number; lo: number; hi: number; len: number; sum: number };

/**
 * The group's name, the column names of every backed-up table and which of them hold whole numbers (for the fingerprint): ONE
 * statement. Every database call costs the Worker about 0.5 ms of CPU and every statement in it about 0.15 ms more (measured Nov 8), so
 * the copy's main run sends as few as it can.
 */
async function columnsOf(db: D1Database): Promise<{ group: string | null; names: Record<string, string[]>; numbers: Record<string, string[]> }> {
  for (const t of BACKUP_TABLES) if (!NAME.test(t)) throw new Error(`Bad table name: ${t}`);
  const row = await db
    .prepare(
      `SELECT (SELECT name FROM groups LIMIT 1) AS g, (SELECT json_group_object(t, json(cols)) FROM (SELECT m.name AS t, json_group_array(json_array(p.name, p.type) ORDER BY p.cid) AS cols FROM sqlite_master m JOIN pragma_table_info(m.name) p WHERE m.type = 'table' AND m.name IN (${BACKUP_TABLES.map((t) => `'${t}'`).join(', ')}) GROUP BY m.name)) AS c`,
    )
    .first<{ g: string | null; c: string | null }>();
  const cols = JSON.parse(row?.c ?? '{}') as Record<string, [string, string][]>;
  const names: Record<string, string[]> = {};
  const numbers: Record<string, string[]> = {};
  for (const t of BACKUP_TABLES) {
    const r = cols[t];
    if (!r?.length) throw new Error(`The live database has no ${t} table.`);
    for (const [c] of r) if (!NAME.test(c)) throw new Error(`Bad column name: ${c}`);
    names[t] = r.map(([c]) => c);
    numbers[t] = r.filter(([, type]) => /INT/i.test(type)).map(([c]) => c);
  }
  return { group: row?.g ?? null, names, numbers };
}

/** The measure's SQL: ONE statement, one column per table, each a JSON list of buckets [rows, first rowid, last rowid, size, sum]. */
export function measureSql(names: Record<string, string[]>, numbers: Record<string, string[]>): string {
  const parts = BACKUP_TABLES.map((t) => {
    const sum = numbers[t].length ? numbers[t].map((c, i) => `COALESCE("${c}", 0) * ${2 * i + 3}`).join(' + ') : '0';
    return `(SELECT json_group_array(json_array(n, lo, hi, len, sum) ORDER BY lo) FROM (SELECT COUNT(*) AS n, MIN(rowid) AS lo, MAX(rowid) AS hi, TOTAL(length(${rowJsonSql(names[t])})) AS len, TOTAL(${sum}) AS sum FROM ${t} GROUP BY rowid / ${BUCKET_ROWS})) AS "${t}"`;
  });
  return `SELECT ${parts.join(', ')}`;
}

/**
 * Every table measured in buckets of 25 rows, in ONE statement (one moment): rows, first and last rowid, the size of the rows as JSON,
 * and a weighted sum of the whole-number columns (money, counts, flags). The plan is cut from it, and the same read at the end must give
 * the same answer, or the data changed while copying. Only a few numbers per bucket come back, so it costs the Worker almost nothing.
 */
async function measure(db: D1Database, names: Record<string, string[]>, numbers: Record<string, string[]>): Promise<Record<string, Bucket[]>> {
  const row = (await db.prepare(measureSql(names, numbers)).first<Record<string, string | null>>()) ?? {};
  return Object.fromEntries(
    BACKUP_TABLES.map((t) => [t, (JSON.parse(row[t] ?? '[]') as number[][]).map(([n, lo, hi, len, sum]) => ({ n: Number(n), lo: Number(lo), hi: Number(hi), len: Number(len), sum: Number(sum) }))]),
  );
}

/** Cut the copy into steps of about STEP_CHARS characters, never splitting a bucket. The pieces, joined, are exactly backupText's file. */
export function planSteps(id: string, groupName: string, nowIso: string, buckets: Record<string, Bucket[]>, columns: Record<string, string[]>): StepBody[] {
  const steps: { slices: Slice[]; chars: number }[] = [{ slices: [], chars: 0 }];
  BACKUP_TABLES.forEach((t, ti) => {
    const list = buckets[t];
    if (!list.length) {
      steps.at(-1)!.slices.push({ table: t, lo: null, hi: null, rows: 0, open: true, close: true, firstTable: ti === 0 });
      return;
    }
    list.forEach((b, bi) => {
      let step = steps.at(-1)!;
      if (step.chars > 0 && step.chars + b.len > STEP_CHARS) steps.push((step = { slices: [], chars: 0 }));
      const last = step.slices.at(-1);
      if (last && last.table === t) {
        last.hi = b.hi;
        last.rows += b.n;
        last.close = bi === list.length - 1;
      } else step.slices.push({ table: t, lo: b.lo, hi: b.hi, rows: b.n, open: bi === 0, close: bi === list.length - 1, firstTable: ti === 0 });
      step.chars += b.len;
    });
  });
  const head = `{"format":"pickleball-backup","version":1,"createdAt":${JSON.stringify(nowIso)},"groupName":${JSON.stringify(groupName)},"tables":{`;
  return steps.map((s, part) => ({
    id,
    part,
    prefix: part === 0 ? head : '',
    suffix: part === steps.length - 1 ? '}}' : '',
    slices: s.slices,
    columns: Object.fromEntries([...new Set(s.slices.map((x) => x.table))].map((t) => [t, columns[t]])),
  }));
}

/**
 * One step: one consistent read of its slices (the database writes the JSON), checked against the plan's row counts, saved as one
 * piece of the unfinished copy, then the next step of the chain through `next`. Reads only from `live`. Saves nothing if the copy's
 * progress row is gone (an attempt that was cleared). Returns the characters saved by this step and the rest of its chain.
 */
export async function runStep(live: D1Database, store: D1Database, body: StepBody, next?: StepRunner): Promise<{ chars: number }> {
  const withRows = body.slices.filter((s) => s.rows > 0);
  for (const s of body.slices) if (!(BACKUP_TABLES as readonly string[]).includes(s.table)) throw new Error(`Not a backed-up table: ${s.table}`);
  const read = withRows.length
    ? await live.batch(
        withRows.map((s) =>
          live.prepare(`SELECT COUNT(*) AS n, group_concat(${rowJsonSql(body.columns[s.table])}, ',' ORDER BY rowid) AS j FROM ${s.table} WHERE rowid BETWEEN ? AND ?`).bind(s.lo, s.hi),
        ),
      )
    : [];
  let k = 0;
  const out = [body.prefix];
  for (const s of body.slices) {
    let rows = '';
    if (s.rows > 0) {
      const r = read[k++].results[0] as { n: number; j: string | null };
      if (Number(r.n) !== s.rows) throw new Error(`the data changed while copying (${s.table}: ${s.rows} rows planned, ${r.n} read)`);
      rows = r.j ?? '';
    }
    out.push(s.open ? `${s.firstTable ? '' : ','}${JSON.stringify(s.table)}:[${rows}` : `,${rows}`);
    if (s.close) out.push(']');
  }
  out.push(body.suffix);
  const data = out.join('');
  const [saved] = await store.batch([
    store.prepare('INSERT INTO weekly_backup_parts (backup_id, part, data) SELECT ?, ?, ? WHERE EXISTS (SELECT 1 FROM weekly_backup_progress WHERE id = ?)').bind(body.id, body.part, data, body.id),
    store.prepare('UPDATE weekly_backup_progress SET done = done + 1 WHERE id = ?').bind(body.id),
  ]);
  if (!saved.meta.changes) throw new Error('this copy was cleared before its step was saved');
  const rest = body.rest ?? [];
  if (!rest.length) return { chars: data.length };
  if (!next) throw new Error('no way to run the next step');
  return { chars: data.length + (await next({ ...rest[0], rest: rest.slice(1) })).chars };
}

/** Clear unfinished copies: their pieces and their progress rows. Never a finished copy (one with a row in weekly_backups). */
function clearUnfinished(store: D1Database) {
  return [
    store.prepare('DELETE FROM weekly_backup_parts WHERE backup_id IN (SELECT id FROM weekly_backup_progress) AND backup_id NOT IN (SELECT id FROM weekly_backups)'),
    store.prepare('DELETE FROM weekly_backup_progress WHERE id NOT IN (SELECT id FROM weekly_backups)'),
  ];
}

/**
 * Make this week's copy if one is due. `live` is only read. `store` is the backup database. `force` skips the "is it due" check
 * (used by tests and by a manual run). `step` runs each step; by default in this same run.
 */
export async function weeklyBackup(
  live: D1Database,
  store: D1Database,
  nowMs: number,
  opts: { force?: boolean; step?: StepRunner } = {},
): Promise<BackupResult> {
  // Six database calls in all, plus one per step: each call costs the Worker CPU of its own.
  const ready = await store.batch([
    ...BACKUP_SCHEMA.map((sql) => store.prepare(sql)),
    store.prepare('SELECT week, created_at AS createdAt FROM weekly_backups ORDER BY created_at DESC LIMIT 1'),
  ]);
  const newest = (ready.at(-1)!.results[0] as { week: string; createdAt: string } | undefined) ?? null;
  if (!opts.force && !backupDue(nowMs, newest)) return { made: false, reason: 'not due' };
  const week = weekOf(nowMs);
  if (newest?.week === week && opts.force) return { made: false, reason: 'this week already has a copy' };
  const { group, names, numbers } = await columnsOf(live);
  if (!group) return { made: false, reason: 'no group' };
  const nowIso = new Date(nowMs).toISOString();
  const before = await measure(live, names, numbers);
  const id = crypto.randomUUID();
  const steps = planSteps(id, group, nowIso, before, names);
  if (steps.length > MAX_STEPS) return { made: false, reason: `failed: the copy would need ${steps.length} steps (over ${MAX_STEPS}); not made` };
  const rows = Object.fromEntries(BACKUP_TABLES.map((t) => [t, before[t].reduce((n, b) => n + b.n, 0)]));
  // Clear any unfinished attempt and start this one (INCOMPLETE until its last step).
  await store.batch([
    ...clearUnfinished(store),
    store.prepare('INSERT INTO weekly_backup_progress (id, week, started_at, steps, done) VALUES (?, ?, ?, ?, 0)').bind(id, week, nowIso, steps.length),
  ]);
  const inline: StepRunner = (body) => runStep(live, store, body, inline);
  const run: StepRunner = opts.step ?? inline;
  let bytes = 0;
  // In order, each chain of up to 20 steps started once (each step starts the next). A failed step stops everything: the copy stays
  // INCOMPLETE (progress row, no header) and is cleared next time.
  for (let i = 0; i < steps.length; i += CHAIN_STEPS) {
    const chain = steps.slice(i, i + CHAIN_STEPS);
    bytes += (await run({ ...chain[0], rest: chain.slice(1) })).chars;
  }
  // The same measure again: anything added, removed or changed while copying means this is not one moment. Throw it away; next hour.
  const after = await measure(live, names, numbers);
  if (JSON.stringify(after) !== JSON.stringify(before)) {
    await store.batch(clearUnfinished(store));
    return { made: false, reason: 'failed: the data changed while copying; tried again at the next hourly look' };
  }
  // One transaction: the header row in only if every step was saved, the progress row out, then keep the newest 8 (their pieces first).
  // If the header did not go in, there are still at most 8 copies, so the pruning deletes nothing. `week` is unique: never two copies.
  const keep = `SELECT id FROM weekly_backups ORDER BY created_at DESC LIMIT ${KEEP_COPIES}`;
  const [, done, , , kept] = await store.batch([
    store
      .prepare('INSERT INTO weekly_backups (id, week, created_at, bytes, parts, rows_json) SELECT ?, ?, ?, ?, ?, ? WHERE (SELECT done FROM weekly_backup_progress WHERE id = ?) = ?')
      .bind(id, week, nowIso, bytes, steps.length, JSON.stringify(rows), id, steps.length),
    store.prepare('DELETE FROM weekly_backup_progress WHERE id = ? AND id IN (SELECT id FROM weekly_backups)').bind(id),
    store.prepare(`DELETE FROM weekly_backup_parts WHERE backup_id NOT IN (${keep}) AND backup_id NOT IN (SELECT id FROM weekly_backup_progress)`),
    store.prepare(`DELETE FROM weekly_backups WHERE id NOT IN (${keep})`),
    store.prepare('SELECT COUNT(*) AS n FROM weekly_backups'),
  ]);
  if (!done.meta.changes) return { made: false, reason: 'failed: not every step was saved; tried again at the next hourly look' };
  return { made: true, week, bytes, parts: steps.length, rows, kept: Number((kept.results[0] as { n: number }).n) };
}

/** The clock's hourly look: never throws (a failed copy is retried on the next hourly look). */
export async function maybeWeeklyBackup(live: D1Database | undefined, store: D1Database | undefined, nowMs: number, step?: StepRunner): Promise<BackupResult> {
  if (!live || !store) return { made: false, reason: 'not set up' };
  if (!checkThisTick(nowMs)) return { made: false, reason: 'not this tick' };
  try {
    return await weeklyBackup(live, store, nowMs, { step });
  } catch (err) {
    return { made: false, reason: `failed: ${err instanceof Error ? err.message : 'unknown'}` };
  }
}
