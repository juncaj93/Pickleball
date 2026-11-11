// Zip 19: the lighter weekly backup (worker/backup.ts `backupText`: the database writes each table out as JSON text, the Worker only
// joins the pieces). Same file as before, every table in the schema accounted for, a failed save leaves no half copy, old copies
// (made by the old code) are kept and still restore, and the live database is only read.
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createNodeD1 } from '../dev/nodeD1';
import { BACKUP_TABLES, backupObject } from '../server/backupData';
import type { D1Database } from '../server/db';
import { viewOnlyDb } from '../server/viewOnly';
import { backupToSql, TABLES } from '../scripts/restore-backup.mjs';
import { joinParts, listLine, unfinishedLine, WEEK } from '../scripts/weekly-backup.mjs';
import {
  BACKUP_LEFT_OUT,
  BACKUP_SCHEMA,
  backupText,
  CHUNK_ROWS,
  COLUMNS_PER_CALL,
  KEEP_COPIES,
  maybeWeeklyBackup,
  measureSql,
  rowJsonSql,
  runStep,
  splitParts,
  STEP_CHARS,
  CHAIN_STEPS,
  type StepRunner,
  weeklyBackup,
} from '../worker/backup';
import { backupTick, selfCall } from '../worker/cron';
import { DAY, firstSession, playerPhone, setupGroup } from './harness';

const store = () => createNodeD1(':memory:', mkdtempSync(join(tmpdir(), 'no-migrations-')));
const at = (iso: string) => Date.parse(iso);
const SUN = at('2026-11-15T08:00:00Z'); // Sun Nov 15, 3:00 AM EST

/** Every row of every table, as text. */
function snapshot(db: ReturnType<typeof createNodeD1>): string {
  const tables = (db.raw.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as { name: string }[]).map((t) => t.name);
  return tables.map((t) => `${t}:${JSON.stringify(db.raw.prepare(`SELECT * FROM "${t}" ORDER BY rowid`).all())}`).join('\n');
}

/**
 * Text that is hard to write out as JSON: quotes, a backslash, control characters, emoji, the line separators. (No NUL: the site refuses
 * control characters in names (server/validate.ts), and the restore's SQL text cannot carry a NUL; the backup itself writes it as \u0000.)
 */
const TRICKY = `Dinks 'n' "Drinks" \\ 🥒 ${Array.from({ length: 31 }, (_, i) => String.fromCharCode(i + 1)).join('')}\u007f\u2028\u2029 é ñ 中文`;

async function busyGroup() {
  const ctx = await setupGroup();
  const s = await firstSession(ctx);
  for (const n of ['Blair', 'Casey', 'Devon']) await (await playerPhone(ctx, n)).call('POST', `/api/sessions/${s.id}/join`, {});
  await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/payment`, { playerId: ctx.byName.Blair, paid: true });
  await ctx.organizer.call('PUT', '/api/admin/group', { name: "Dinks 'n' Drinks 🥒" });
  ctx.app.db.raw.prepare('UPDATE players SET display_name = ? WHERE id = ?').run(TRICKY, ctx.byName.Casey);
  ctx.app.db.raw.prepare('UPDATE players SET venmo_handle = ? WHERE id = ?').run('x'.repeat(5000), ctx.byName.Devon);
  return ctx;
}

/** Lots of Activity: the copy needs several steps. */
function bigActivity(ctx: Awaited<ReturnType<typeof setupGroup>>) {
  const ins = ctx.app.db.raw.prepare("INSERT INTO admin_audit_log (id, group_id, session_id, actor_label, action, details_json, created_at) SELECT ?, id, NULL, 'organizer', 'test', ?, ? FROM groups");
  for (let i = 0; i < 1500; i++) ins.run(`a-${i}`, JSON.stringify({ note: 'x'.repeat(200), i }), new Date(at('2026-10-01T00:00:00Z') + i * 1000).toISOString());
}

/** What the OLD weekly code saved (Zip 8 to Zip 18): JSON.stringify of the backup object, in pieces. */
async function oldStyleCopy(live: D1Database, backups: ReturnType<typeof createNodeD1>, nowMs: number, week: string) {
  for (const sql of BACKUP_SCHEMA) await backups.prepare(sql).run();
  const text = JSON.stringify(await backupObject(live, "Dinks 'n' Drinks 🥒", new Date(nowMs).toISOString()));
  const parts = splitParts(text);
  const id = `old-${week}`;
  backups.raw.prepare('INSERT INTO weekly_backups (id, week, created_at, bytes, parts, rows_json) VALUES (?, ?, ?, ?, ?, ?)').run(id, week, new Date(nowMs).toISOString(), text.length, parts.length, '{}');
  parts.forEach((d, i) => backups.raw.prepare('INSERT INTO weekly_backup_parts (backup_id, part, data) VALUES (?, ?, ?)').run(id, i, d));
  return text;
}

function readCopy(db: ReturnType<typeof createNodeD1>, week: string) {
  const header = db.raw.prepare('SELECT * FROM weekly_backups WHERE week = ?').get(week) as any;
  const parts = db.raw.prepare('SELECT part, data FROM weekly_backup_parts WHERE backup_id = ? ORDER BY part').all(header.id) as any[];
  return joinParts(header, parts);
}

/** A D1 that counts how many result rows the Worker has to handle (each one is a JavaScript object = CPU). */
function counting(db: D1Database) {
  const seen = { rows: 0, batches: 0 };
  const wrapped: D1Database = {
    prepare: (sql: string) => db.prepare(sql),
    async batch(statements) {
      seen.batches++;
      const out = await db.batch(statements);
      for (const r of out) seen.rows += r.results.length;
      return out;
    },
  };
  return { db: wrapped, seen };
}

describe('the lighter weekly copy is the same file', () => {
  it('reads back exactly like Settings > Backup (and the old weekly code), byte for byte, tricky text included', async () => {
    const ctx = await busyGroup();
    const nowIso = new Date(SUN).toISOString();
    const old = JSON.stringify(await backupObject(ctx.app.db, "Dinks 'n' Drinks 🥒", nowIso));
    const { text, rows } = await backupText(ctx.app.db, "Dinks 'n' Drinks 🥒", nowIso);
    expect(JSON.parse(text)).toEqual(JSON.parse(old));
    // Not just the same data: the same characters, so the size check in joinParts and every old tool read it the same way.
    expect(text).toBe(old);
    expect(JSON.parse(text).tables.players.some((p: any) => p.display_name === TRICKY)).toBe(true);
    expect(rows).toEqual(Object.fromEntries(BACKUP_TABLES.map((t) => [t, JSON.parse(old).tables[t].length])));
  });

  it('a wide table (more than 16 columns) is joined from several json_object calls into one row, in column order', () => {
    const db = createNodeD1(':memory:', mkdtempSync(join(tmpdir(), 'no-migrations-')));
    const cols = Array.from({ length: 40 }, (_, i) => `c${i}`);
    // Typed columns, like every table in the schema (an untyped column would keep 1 as the decimal 1.0).
    db.raw.exec(`CREATE TABLE wide (${cols.map((c, i) => `${c} ${i % 3 === 1 ? 'INTEGER' : 'TEXT'}`).join(', ')})`);
    db.raw.prepare(`INSERT INTO wide VALUES (${cols.map(() => '?').join(', ')})`).run(...cols.map((c, i) => (i % 3 === 0 ? null : i % 3 === 1 ? i : `${c} "q" é`)));
    const row = db.raw.prepare(`SELECT ${rowJsonSql(cols)} AS j FROM wide`).get() as { j: string };
    expect(row.j).toBe(JSON.stringify(db.raw.prepare('SELECT * FROM wide').get()));
    expect(new Set(rowJsonSql(cols).match(/json_object\([^)]*\)/g)).size).toBe(Math.ceil(40 / COLUMNS_PER_CALL));
    // One call for a narrow table; bad names are refused (they go into SQL).
    expect(rowJsonSql(['a', 'b'])).toBe(`json_object('a', "a", 'b', "b")`);
    expect(() => rowJsonSql(['a"; DROP TABLE x; --'])).toThrow('Bad column name');
    expect(() => rowJsonSql([])).toThrow('no columns');
  });

  it('the Worker handles a few pieces per table, not one object per row: 1,500 more Activity rows add 8 pieces', async () => {
    const ctx = await busyGroup();
    const small = counting(ctx.app.db);
    await backupText(small.db, 'x', new Date(SUN).toISOString());
    const ins = ctx.app.db.raw.prepare("INSERT INTO admin_audit_log (id, group_id, session_id, actor_label, action, details_json, created_at) SELECT ?, id, NULL, 'organizer', 'test', ?, ? FROM groups");
    for (let i = 0; i < 1500; i++) ins.run(`a-${i}`, JSON.stringify({ note: 'x'.repeat(200), i }), new Date(at('2026-10-01T00:00:00Z') + i * 1000).toISOString());
    const big = counting(ctx.app.db);
    const { text, rows } = await backupText(big.db, 'x', new Date(SUN).toISOString());
    expect(big.seen.batches).toBe(2); // column names, then every table in one consistent read
    expect(big.seen.rows - small.seen.rows).toBeLessThanOrEqual(Math.ceil(1500 / CHUNK_ROWS) + 1);
    expect(rows.admin_audit_log).toBeGreaterThanOrEqual(1500);
    expect(JSON.parse(text).tables.admin_audit_log).toHaveLength(rows.admin_audit_log);
  });
});

describe('every table is covered', () => {
  const schema = createNodeD1(':memory:');
  const tables = (schema.raw.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> '_migrations' ORDER BY name").all() as { name: string }[]).map((t) => t.name);

  it('every table the migrations make is either backed up or listed as left out on purpose (with a reason)', () => {
    // Read the migrations as text too, so a table made by a migration is found even if the shim above changes.
    const made = new Set<string>();
    for (const f of readdirSync(join(process.cwd(), 'migrations')).filter((x) => x.endsWith('.sql'))) {
      for (const m of readFileSync(join(process.cwd(), 'migrations', f), 'utf8').matchAll(/CREATE TABLE (?:IF NOT EXISTS )?([a-z_]+)/gi)) made.add(m[1]);
    }
    expect([...made].sort()).toEqual(tables);
    for (const t of tables) expect(BACKUP_TABLES.includes(t as never) || t in BACKUP_LEFT_OUT, `table "${t}" is neither backed up nor listed in BACKUP_LEFT_OUT`).toBe(true);
    for (const t of BACKUP_TABLES) expect(t in BACKUP_LEFT_OUT, t).toBe(false);
    for (const [t, why] of Object.entries(BACKUP_LEFT_OUT)) {
      expect(tables, `BACKUP_LEFT_OUT names a table that does not exist: ${t}`).toContain(t);
      expect(why.length).toBeGreaterThan(10);
    }
    // The restore puts back exactly the tables the backup holds, in the same order.
    expect([...TABLES]).toEqual([...BACKUP_TABLES]);
  });

  it('every column of every backed-up table is in the copy and comes back after a restore', async () => {
    const ctx = await busyGroup();
    const { text } = await backupText(ctx.app.db, 'x', new Date(SUN).toISOString());
    const copy = JSON.parse(text);
    for (const t of BACKUP_TABLES) {
      const columns = (ctx.app.db.raw.prepare(`SELECT name FROM pragma_table_info('${t}') ORDER BY cid`).all() as { name: string }[]).map((c) => c.name);
      for (const row of copy.tables[t]) expect(Object.keys(row), t).toEqual(columns);
    }
    const fresh = createNodeD1(':memory:');
    fresh.raw.exec(backupToSql(copy));
    for (const t of BACKUP_TABLES) {
      expect(fresh.raw.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all().map((x) => ({ ...x })), t).toEqual(ctx.app.db.raw.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all().map((x) => ({ ...x })));
    }
  });
});

describe('safety', () => {
  it('a step that fails leaves a copy marked INCOMPLETE that nothing can use; the old copy is untouched; the next look clears it and makes a whole one', async () => {
    const ctx = await busyGroup();
    bigActivity(ctx);
    const backups = store();
    await oldStyleCopy(ctx.app.db, backups, SUN - 7 * DAY, '2026-11-08');
    const oldCopy = JSON.stringify(readCopy(backups, '2026-11-08'));
    // Each attempt's second step is cut off.
    const failing = (): StepRunner => {
      let calls = 0;
      const run: StepRunner = async (body) => {
        if (++calls === 2) throw new Error('step 2 cut off');
        return runStep(ctx.app.db, backups, body, run);
      };
      return run;
    };
    await expect(weeklyBackup(ctx.app.db, backups, SUN, { step: failing() })).rejects.toThrow('step 2 cut off');
    // Not a copy: no header row, so "list" and "get" never show it, and the restore cannot pick it.
    expect(backups.raw.prepare("SELECT COUNT(*) AS n FROM weekly_backups WHERE week = '2026-11-15'").get()).toEqual({ n: 0 });
    const progress = backups.raw.prepare('SELECT * FROM weekly_backup_progress').get() as { id: string; week: string; steps: number; done: number; started_at: string };
    expect(progress).toMatchObject({ week: '2026-11-15', done: 1 });
    expect(progress.steps).toBeGreaterThan(2);
    expect(unfinishedLine(progress, () => 'Sun, Nov 15, 3:00 AM')).toBe(
      `2026-11-15  INCOMPLETE: started Sun, Nov 15, 3:00 AM Eastern, 1 of ${progress.steps} pieces saved. Not usable (it is not listed above and cannot be fetched); the next hourly look clears it and starts over.`,
    );
    expect(JSON.stringify(readCopy(backups, '2026-11-08'))).toBe(oldCopy);
    // The clock's hourly look: the failure is a log line, never a throw.
    expect(((await maybeWeeklyBackup(ctx.app.db, backups, SUN + 60_000, failing())) as { reason: string }).reason).toBe('failed: step 2 cut off');
    expect(backups.raw.prepare('SELECT COUNT(*) AS n FROM weekly_backup_progress').get()).toEqual({ n: 1 }); // the earlier attempt was cleared first
    // The next hour: the unfinished pieces go, a whole copy is made, the old copy is still there.
    const r = await weeklyBackup(ctx.app.db, backups, SUN + 3600_000);
    expect(r).toMatchObject({ made: true, week: '2026-11-15', kept: 2 });
    expect(backups.raw.prepare('SELECT COUNT(*) AS n FROM weekly_backup_progress').get()).toEqual({ n: 0 });
    expect(backups.raw.prepare('SELECT COUNT(*) AS n FROM weekly_backup_parts WHERE backup_id NOT IN (SELECT id FROM weekly_backups)').get()).toEqual({ n: 0 });
    expect(JSON.stringify(readCopy(backups, '2026-11-08'))).toBe(oldCopy);
    expect(readCopy(backups, '2026-11-15')).toEqual(JSON.parse(JSON.stringify(await backupObject(ctx.app.db, "Dinks 'n' Drinks 🥒", new Date(SUN + 3600_000).toISOString()))));
  });

  it('data that changes while copying is never saved as one copy: a changed amount, a new row, a removed row', async () => {
    const ctx = await busyGroup();
    bigActivity(ctx);
    const backups = store();
    const seat = ctx.app.db.raw.prepare("SELECT id FROM session_players WHERE payment_status = 'paid' LIMIT 1").get() as { id: string };
    const changes: [string, () => void][] = [
      ['an amount, same number of characters', () => ctx.app.db.raw.prepare('UPDATE session_players SET payment_amount_cents = 1300 WHERE id = ?').run(seat.id)],
      ['a new Activity row', () => ctx.app.db.raw.prepare("INSERT INTO admin_audit_log (id, group_id, session_id, actor_label, action, details_json, created_at) SELECT 'late', id, NULL, 'organizer', 'test', '{}', '2026-11-15T08:00:01Z' FROM groups").run()],
      ['a removed device', () => ctx.app.db.raw.prepare('DELETE FROM player_devices WHERE rowid = (SELECT MIN(rowid) FROM player_devices)').run()],
      // Same length (both 9 letters): caught by the first and last letters.
      ['a seat confirmed -> withdrawn', () => ctx.app.db.raw.prepare("UPDATE session_players SET status = 'withdrawn' WHERE rowid = (SELECT MIN(rowid) FROM session_players WHERE status = 'confirmed')").run()],
      // Same length, same first and last letters: caught by the time in *_at columns.
      ['a time rewritten', () => ctx.app.db.raw.prepare("UPDATE players SET created_at = '2026-01-01T00:00:00.000Z' WHERE rowid = (SELECT MIN(rowid) FROM players)").run()],
    ];
    for (const [what, change] of changes) {
      let n = 0;
      const sneaky: StepRunner = async (body) => {
        if (++n === 3) change(); // after the seats were copied, before the end
        return runStep(ctx.app.db, backups, body, sneaky);
      };
      const r = await maybeWeeklyBackup(ctx.app.db, backups, SUN, sneaky);
      expect((r as { reason: string }).reason, what).toMatch(/^failed: the data changed while copying/);
      expect(backups.raw.prepare('SELECT COUNT(*) AS n FROM weekly_backups').get(), what).toEqual({ n: 0 });
      expect(backups.raw.prepare('SELECT COUNT(*) AS n FROM weekly_backup_parts WHERE backup_id NOT IN (SELECT id FROM weekly_backup_progress)').get(), what).toEqual({ n: 0 });
    }
    // Nothing changing: the copy is made.
    expect((await weeklyBackup(ctx.app.db, backups, SUN)).made).toBe(true);
  });

  it('in steps: each step copies about 60,000 characters, and the pieces join into exactly the one-shot file', async () => {
    const ctx = await busyGroup();
    bigActivity(ctx);
    const backups = store();
    const reads: number[] = [];
    let runs = 0;
    // Each step reads the live database once, then starts the next step itself (the main run starts each chain only once).
    const watch: StepRunner = async (body) => {
      runs++;
      const live = counting(ctx.app.db);
      let seen = -1;
      const out = await runStep(live.db, backups, body, (next) => ((seen = live.seen.batches), watch(next)));
      reads.push(seen === -1 ? live.seen.batches : seen);
      return out;
    };
    let started = 0;
    const r = await weeklyBackup(ctx.app.db, backups, SUN, { step: (body) => (started++, watch(body)) });
    expect(r.made && r.parts).toBeGreaterThan(4);
    expect(started).toBe(Math.ceil((r as { parts: number }).parts / CHAIN_STEPS));
    expect(runs).toBe((r as { parts: number }).parts);
    expect(reads.every((n) => n === 1)).toBe(true);
    const header = backups.raw.prepare('SELECT * FROM weekly_backups').get() as { id: string; bytes: number; parts: number };
    const parts = backups.raw.prepare('SELECT part, data FROM weekly_backup_parts WHERE backup_id = ? ORDER BY part').all(header.id) as { part: number; data: string }[];
    const joined = parts.map((p) => p.data).join('');
    expect(joined).toBe((await backupText(ctx.app.db, "Dinks 'n' Drinks 🥒", new Date(SUN).toISOString())).text);
    expect(header.bytes).toBe(joined.length);
    expect(header.parts).toBe(parts.length);
    for (const p of parts) expect(p.data.length).toBeLessThan(STEP_CHARS + 40_000); // never more than one 25-row bucket over
    // A step only runs for a copy still in progress: a step for a cleared copy saves nothing.
    await expect(runStep(ctx.app.db, backups, { id: 'gone', part: 0, prefix: '', suffix: '', slices: [], columns: {} })).rejects.toThrow('cleared');
    await expect(runStep(ctx.app.db, backups, { id: 'gone', part: 0, prefix: '', suffix: '', slices: [{ table: 'admin_sessions', lo: 1, hi: 2, rows: 1, open: true, close: true, firstTable: false }], columns: { admin_sessions: ['id'] } })).rejects.toThrow('Not a backed-up table');
  });

  it('the main run stays small: 3 statements to the live database, 15 to the backup database, whatever the size (each costs CPU)', async () => {
    const ctx = await busyGroup();
    bigActivity(ctx);
    const backups = store();
    const count = (db: D1Database) => {
      const seen = { calls: 0, statements: 0 };
      const wrapped: D1Database = {
        prepare: (sql: string) => {
          const st = db.prepare(sql);
          const tally = <T,>(p: Promise<T>) => ((seen.calls++, seen.statements++), p);
          return Object.assign(Object.create(st), { first: (...a: []) => tally(st.first(...a)), all: () => tally(st.all()), run: () => tally(st.run()), bind: (...v: unknown[]) => st.bind(...v) });
        },
        batch: (sts) => ((seen.calls++, (seen.statements += sts.length)), db.batch(sts)),
      };
      return { db: wrapped, seen };
    };
    const live = count(ctx.app.db);
    const back = count(backups);
    const steps: StepRunner = (body) => runStep(ctx.app.db, backups, body, steps); // steps not counted: each is its own run
    const r = await weeklyBackup(live.db, back.db, SUN, { step: steps });
    expect(r.made).toBe(true);
    expect(live.seen).toEqual({ calls: 3, statements: 3 });
    expect(back.seen).toEqual({ calls: 3, statements: 15 });
    // D1 refuses one statement over 100,000 characters: the measure stays far under it.
    const sql = ctx.app.db.raw.prepare("SELECT m.name AS t, p.name AS c, p.type AS y FROM sqlite_master m JOIN pragma_table_info(m.name) p WHERE m.type = 'table' ORDER BY m.name, p.cid").all() as { t: string; c: string; y: string }[];
    const names: Record<string, string[]> = {};
    const numbers: Record<string, string[]> = {};
    for (const x of sql) ((names[x.t] ??= []).push(x.c), /INT/i.test(x.y) && (numbers[x.t] ??= []).push(x.c), (numbers[x.t] ??= []));
    expect(measureSql(names, numbers).length).toBeLessThan(30_000);
  });

  it('a copy asked for by hand is made at the next hourly look with its own label, and never changes the Sunday schedule', async () => {
    const ctx = await busyGroup();
    const backups = store();
    const sunEvening = at('2026-11-09T01:00:00Z'); // Sun Nov 8, 8:00 PM EST
    await oldStyleCopy(ctx.app.db, backups, at('2026-11-08T08:00:00Z'), '2026-11-08');
    const oldCopy = JSON.stringify(readCopy(backups, '2026-11-08'));
    expect(await weeklyBackup(ctx.app.db, backups, sunEvening)).toEqual({ made: false, reason: 'not due' });
    // `node scripts/weekly-backup.mjs ask` writes one tiny row.
    backups.raw.exec("CREATE TABLE IF NOT EXISTS weekly_backup_requests (id TEXT PRIMARY KEY, asked_at TEXT NOT NULL); INSERT INTO weekly_backup_requests VALUES ('ask-1', '2026-11-09T00:30:00.000Z')");
    // A failed attempt keeps the request (tried again next hour).
    const broken: StepRunner = async () => {
      throw new Error('cut off');
    };
    expect(((await maybeWeeklyBackup(ctx.app.db, backups, sunEvening, broken)) as { reason: string }).reason).toBe('failed: cut off');
    expect(backups.raw.prepare('SELECT COUNT(*) AS n FROM weekly_backup_requests').get()).toEqual({ n: 1 });
    const r = await weeklyBackup(ctx.app.db, backups, sunEvening);
    expect(r).toMatchObject({ made: true, week: '2026-11-08-asked-2000', kept: 2 });
    expect(backups.raw.prepare('SELECT COUNT(*) AS n FROM weekly_backup_requests').get()).toEqual({ n: 0 });
    expect(WEEK.test('2026-11-08-asked-2000')).toBe(true);
    expect(readCopy(backups, '2026-11-08-asked-2000')).toEqual(JSON.parse(JSON.stringify(await backupObject(ctx.app.db, "Dinks 'n' Drinks 🥒", new Date(sunEvening).toISOString()))));
    expect(JSON.stringify(readCopy(backups, '2026-11-08'))).toBe(oldCopy); // the 3:00 AM copy untouched
    // Answered: the next look does nothing; next Sunday's regular copy still comes at 3:00 AM.
    expect(await weeklyBackup(ctx.app.db, backups, sunEvening + 3600_000)).toEqual({ made: false, reason: 'not due' });
    expect((await weeklyBackup(ctx.app.db, backups, SUN)).made && true).toBe(true);
    expect((backups.raw.prepare('SELECT week FROM weekly_backups ORDER BY created_at').all() as { week: string }[]).map((x) => x.week)).toEqual(['2026-11-08', '2026-11-08-asked-2000', '2026-11-15']);
    // A request while a regular copy is due: one regular copy answers both.
    backups.raw.exec("INSERT INTO weekly_backup_requests VALUES ('ask-2', '2026-11-22T07:30:00.000Z')");
    expect(await weeklyBackup(ctx.app.db, backups, SUN + 7 * DAY)).toMatchObject({ made: true, week: '2026-11-22' });
    expect(backups.raw.prepare('SELECT COUNT(*) AS n FROM weekly_backup_requests').get()).toEqual({ n: 0 });
    // Asks on later days get their own date (no clash), and only the newest 3 asked copies stay: they never push out a regular one.
    for (let d = 1; d <= 5; d++) {
      const t = SUN + 7 * DAY + d * DAY + 12 * 3600_000; // Mon to Fri, 3:00 PM EST
      backups.raw.exec(`INSERT INTO weekly_backup_requests VALUES ('ask-d${d}', '${new Date(t - 60_000).toISOString()}')`);
      expect((await weeklyBackup(ctx.app.db, backups, t)).made).toBe(true);
    }
    const weeks = (backups.raw.prepare('SELECT week FROM weekly_backups ORDER BY created_at').all() as { week: string }[]).map((x) => x.week);
    expect(weeks).toEqual(['2026-11-08', '2026-11-15', '2026-11-22', '2026-11-25-asked-1500', '2026-11-26-asked-1500', '2026-11-27-asked-1500']);
  });

  it('a copy over 20 steps runs as several chains, each started once, and still joins into exactly the one-shot file', async () => {
    const ctx = await busyGroup();
    const ins = ctx.app.db.raw.prepare("INSERT INTO admin_audit_log (id, group_id, session_id, actor_label, action, details_json, created_at) SELECT ?, id, NULL, 'organizer', 'test', ?, ? FROM groups");
    // Zip 30: 4000 lines (was 5000). Migration 0018 adds an empty device_tag to every History line (about 18 characters), so 5000 of these
    // 260-character lines no longer fit 5 buckets per step and needed 51 steps, over MAX_STEPS (45; main made 41). 4000 still runs as
    // several chains (over 20 steps). Live is about 20 times smaller than this.
    for (let i = 0; i < 4000; i++) ins.run(`b-${i}`, JSON.stringify({ note: 'y'.repeat(260), i }), new Date(at('2026-09-01T00:00:00Z') + i * 1000).toISOString());
    const backups = store();
    let started = 0;
    const inline: StepRunner = (body) => runStep(ctx.app.db, backups, body, inline);
    const r = await weeklyBackup(ctx.app.db, backups, SUN, { step: (body) => (started++, inline(body)) });
    expect(r.made && r.parts).toBeGreaterThan(CHAIN_STEPS);
    expect(started).toBe(Math.ceil((r as { parts: number }).parts / CHAIN_STEPS));
    const header = backups.raw.prepare('SELECT * FROM weekly_backups').get() as { id: string };
    const joined = (backups.raw.prepare('SELECT data FROM weekly_backup_parts WHERE backup_id = ? ORDER BY part').all(header.id) as { data: string }[]).map((p) => p.data).join('');
    expect(joined).toBe((await backupText(ctx.app.db, "Dinks 'n' Drinks 🥒", new Date(SUN).toISOString())).text);
  });

  it('the clock: the knock run makes one call to itself, each step is its own run, and a call without the secret is refused', async () => {
    const ctx = await busyGroup();
    bigActivity(ctx);
    const backups = store();
    const paths: string[] = [];
    const env: any = { SITE_URL: '', CRON_SECRET: 'shh', DB: ctx.app.db, BACKUP: backups };
    env.SELF = { fetch: (req: Request) => (paths.push(new URL(req.url).pathname), selfCall(req, env)) };
    const logs: string[] = [];
    const log = console.log;
    console.log = (m: string) => logs.push(m);
    const clock = vi.spyOn(Date, 'now').mockReturnValue(SUN); // the Worker's own clock agrees with the tick's time
    try {
      await backupTick(env, SUN + 10 * 60_000); // 3:10 AM: not a looking tick, no call at all
      expect(paths).toEqual([]);
      await backupTick(env, SUN);
    } finally {
      console.log = log;
    }
    // The knock's run calls /backup/run once; that run calls the plan, the first step (each step calls the next), and the finish.
    const steps = paths.filter((p) => p === '/backup/step').length;
    expect(paths).toEqual(['/backup/run', '/backup/plan', ...Array(steps).fill('/backup/step'), '/backup/finish']);
    expect(steps).toBeGreaterThan(4);
    expect(logs.join('\n')).toMatch(new RegExp(`^weekly backup 2026-11-15: \\d+ bytes in ${steps} parts, 1 kept$`));
    // Not due (this week has its copy): /backup/run asks the plan, which says no; nothing else runs.
    paths.length = 0;
    clock.mockReturnValue(SUN + 3600_000);
    await backupTick(env, SUN + 3600_000);
    expect(paths).toEqual(['/backup/run', '/backup/plan']);
    // A run for a time far from the Worker's own clock is refused (it could make copies that push real ones out).
    const far = await selfCall(new Request('https://x/backup/run', { method: 'POST', headers: { 'X-Backup-Secret': 'shh' }, body: JSON.stringify({ nowMs: SUN + 30 * DAY }) }), env);
    expect(far.status).toBe(400);
    clock.mockRestore();
    for (const [secret, method] of [['', 'POST'], ['wrong', 'POST'], ['shh', 'GET']]) {
      const res = await selfCall(new Request('https://x/backup/run', { method, headers: { 'X-Backup-Secret': secret }, body: method === 'POST' ? '{}' : undefined }), env);
      expect(res.status, `${secret} ${method}`).toBe(404);
    }
    expect((await selfCall(new Request('https://x/backup/run', { method: 'POST', headers: { 'X-Backup-Secret': 'x' }, body: '{}' }), { ...env, CRON_SECRET: '' })).status).toBe(404);
    expect((await selfCall(new Request('https://x/other', { method: 'POST', headers: { 'X-Backup-Secret': 'shh' }, body: '{}' }), env)).status).toBe(404);
    // A step that fails answers 500 with the reason; the run then stops and reports it.
    const bad = await selfCall(new Request('https://x/backup/step', { method: 'POST', headers: { 'X-Backup-Secret': 'shh' }, body: JSON.stringify({ id: 'gone', part: 0, prefix: '', suffix: '', slices: [], columns: {} }) }), env);
    expect(bad.status).toBe(500);
    expect(await bad.json()).toEqual({ error: 'this copy was cleared before its step was saved' });
  });

  it('a copy with a missing piece is never used: joinParts refuses it and "list" marks it INCOMPLETE', async () => {
    const ctx = await busyGroup();
    ctx.app.db.raw.prepare('UPDATE players SET venmo_handle = ? WHERE id = ?').run('v'.repeat(120_000), ctx.byName.Emery); // over one piece
    const backups = store();
    await weeklyBackup(ctx.app.db, backups, SUN);
    const header = backups.raw.prepare('SELECT * FROM weekly_backups').get() as any;
    const parts = backups.raw.prepare('SELECT part, data FROM weekly_backup_parts ORDER BY part').all() as any[];
    expect(parts.length).toBeGreaterThan(1);
    expect(() => joinParts(header, parts.slice(0, -1))).toThrow('incomplete');
    expect(() => joinParts(header, [...parts.slice(0, -1), { part: parts.length - 1, data: parts.at(-1).data.slice(1) }])).toThrow('does not add up');
    const when = () => 'Sun, Nov 15, 3:00 AM';
    const line = { week: '2026-11-15', created_at: header.created_at, parts: header.parts, rows_json: header.rows_json };
    expect(listLine({ ...line, have: header.parts }, when)).not.toContain('INCOMPLETE');
    expect(listLine({ ...line, have: header.parts - 1 }, when)).toContain(`INCOMPLETE (${header.parts - 1} of ${header.parts} pieces)`);
  });

  it('the first run after the deploy keeps the copies the old code made, and they still restore next to the new one', async () => {
    const ctx = await busyGroup();
    const backups = store();
    const oldText = await oldStyleCopy(ctx.app.db, backups, at('2026-11-01T08:00:00Z'), '2026-11-01');
    await oldStyleCopy(ctx.app.db, backups, at('2026-11-08T08:00:00Z'), '2026-11-08');
    const r = await weeklyBackup(ctx.app.db, backups, SUN);
    expect(r).toMatchObject({ made: true, week: '2026-11-15', kept: 3 });
    const weeks = (backups.raw.prepare('SELECT week FROM weekly_backups ORDER BY week').all() as { week: string }[]).map((x) => x.week);
    expect(weeks).toEqual(['2026-11-01', '2026-11-08', '2026-11-15']);
    expect(JSON.stringify(readCopy(backups, '2026-11-01'))).toBe(oldText);
    for (const w of weeks) {
      const fresh = createNodeD1(':memory:');
      fresh.raw.exec(backupToSql(readCopy(backups, w)));
      expect((fresh.raw.prepare('SELECT COUNT(*) AS n FROM players').get() as { n: number }).n, w).toBe(readCopy(backups, w).tables.players.length);
    }
    // Up to 8 are kept; only a 9th pushes the oldest out, and only after the new one is saved.
    let now = SUN;
    for (let w = 0; w < KEEP_COPIES; w++) await weeklyBackup(ctx.app.db, backups, (now += 7 * DAY));
    expect((backups.raw.prepare('SELECT COUNT(*) AS n FROM weekly_backups').get() as { n: number }).n).toBe(KEEP_COPIES);
  });

  it('the clock hands the Worker a read-only live database, and the copy still works through it (and the live data is untouched)', async () => {
    const ctx = await busyGroup();
    const backups = store();
    const before = snapshot(ctx.app.db);
    const logs: string[] = [];
    const log = console.log;
    console.log = (m: string) => logs.push(m);
    try {
      await backupTick({ SITE_URL: '', CRON_SECRET: '', DB: ctx.app.db, BACKUP: backups }, SUN);
    } finally {
      console.log = log;
    }
    expect(logs.join('\n')).toMatch(/^weekly backup 2026-11-15: \d+ bytes in \d+ parts, 1 kept$/);
    expect(snapshot(ctx.app.db)).toBe(before);
    expect(readCopy(backups, '2026-11-15')).toEqual(JSON.parse(JSON.stringify(await backupObject(ctx.app.db, "Dinks 'n' Drinks 🥒", new Date(SUN).toISOString()))));
    // Every statement the backup sends to the live database is a plain read the view-only wrapper lets through.
    const sent: string[] = [];
    const spy: D1Database = { prepare: (sql: string) => (sent.push(sql), ctx.app.db.prepare(sql)), batch: (s) => ctx.app.db.batch(s) };
    await backupText(viewOnlyDb(spy), 'x', new Date(SUN).toISOString());
    expect(sent.length).toBe(BACKUP_TABLES.length * 2);
    for (const sql of sent) expect(sql).toMatch(/^SELECT /);
  });
});
