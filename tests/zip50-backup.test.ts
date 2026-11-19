// Zip 50 (Audit C M-2): the backup file and the weekly copy now hold everything a restore needs to give back the site exactly as it
// was: every Settings feature switch, the price locks of finalized games, Settings > Alerts, the venue months marked paid, the Christmas
// choice, hidden canceled games, "Do this now" taps, "already sent" marks and the organizer sign-ins (file version 2). Old files
// (version 1) still restore the way they always did.
//
// The proof: a rich fake world (12 finalized games, then every price rule changed after, as in the audit), backed up both ways, restored
// into an EMPTY fake database with the real restore script, and compared: every switch row, every alert setting, every sign-in, and
// every money number the organizer and the players see. The audit's October example: court cost $408 must not become $386.
// Nothing here talks to Cloudflare; everything is in memory or in temp folders.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { createNodeD1 } from '../dev/nodeD1';
import { BACKUP_TABLES, BACKUP_VERSION } from '../server/backupData';
import { backupToSql, TABLES } from '../scripts/restore-backup.mjs';
import { joinParts } from '../scripts/weekly-backup.mjs';
import { backupText, BACKUP_LEFT_OUT, weeklyBackup } from '../worker/backup';
import { compare, fileSource } from '../scripts/restore-test-lib';
import { buildWorld, flipPriceRules, moneyDump, type World } from './zip27-world';
import { PIN } from './harness';

type Db = ReturnType<typeof createNodeD1>;
type Row = Record<string, unknown>;
const NEW = ['task_log', 'organizer_alerts', 'admin_sessions'];
const RO = '86420975'; // a throwaway read-only PIN for this test only

const rowsOf = (db: Db, t: string) => (db.raw.prepare(`SELECT * FROM "${t}" ORDER BY rowid`).all() as Row[]).map((r) => ({ ...r }));

/** The restore exactly as docs/RESTORE.md makes it: the real script on a file; its standard output is restore.sql. */
function cli(backup: unknown): { status: number; sql: string; err: string } {
  const file = join(mkdtempSync(join(tmpdir(), 'zip50-file-')), 'pickleball-backup-test.json');
  writeFileSync(file, JSON.stringify(backup, null, 1));
  const r = spawnSync('node', [join(process.cwd(), 'scripts', 'restore-backup.mjs'), file], { encoding: 'utf8' });
  return { status: r.status ?? -1, sql: r.stdout, err: r.stderr };
}

/** A fresh EMPTY fake database (every migration, no rows), then the restore SQL in one transaction, as Cloudflare runs a --file. */
function restoreEmpty(sql: string): Db {
  const db = createNodeD1(':memory:');
  db.raw.exec('BEGIN');
  db.raw.exec(sql);
  db.raw.exec('COMMIT');
  expect(db.raw.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  return db;
}

/** Point the fake site at another database. The phones keep their cookies (sign-ins and picked names live in the data). */
function useDb(w: World, db: Db) {
  w.app.db = db as never;
  w.app.env.DB = db as never;
}

/** Every switch the site keeps, readable: the group-wide task_log rows (Settings switches, Smart alerts off, venue months paid, Christmas). */
const switchRows = (db: Db) =>
  (db.raw.prepare('SELECT task, kind, detail, at FROM task_log WHERE session_id IS NULL ORDER BY task, kind').all() as Row[]).map((r) => ({ ...r }));
/** Every price lock (task 'price_lock', one per finalized game) with its game's start time. */
const priceLocks = (db: Db) =>
  (db.raw.prepare("SELECT s.starts_at, t.detail FROM task_log t JOIN sessions s ON s.id = t.session_id WHERE t.task = 'price_lock' ORDER BY s.starts_at").all() as Row[]).map((r) => ({ ...r }));

let w: World;
let source: Db;
let download: any;
let roDownload: any;
let dumpBefore: Record<string, any>;
let switchesBefore: Row[];
let locksBefore: Row[];
let alertsBefore: unknown;
let dashBefore: any;

beforeAll(async () => {
  w = await buildWorld({ bookingHours: true, extraSwitches: ['guest-spot-switch', 'extended-time-switch', 'venue-alert-switch'] });
  source = w.app.db as unknown as Db;
  const ok = (r: { status: number; text: string }, what: string) => expect(r.status, `${what}: ${r.text}`).toBe(200);
  // The A-01 trap from the audit: every price rule changes after the games were finalized (their locks were written first).
  await flipPriceRules(w, { bookingHours: true });
  // The other things a version 1 file lost: the Christmas choice, a hidden canceled game, Settings > Alerts, Smart alerts off.
  ok(await w.organizer.call('PUT', '/api/admin/christmas-skin-switch', { mode: 'me' }), 'christmas me');
  const canceled = (source.raw.prepare("SELECT id FROM sessions WHERE status = 'canceled' LIMIT 1").get() as { id: string }).id;
  ok(await w.organizer.call('POST', `/api/admin/sessions/${canceled}/hide`, { hidden: true }), 'hide canceled');
  ok(await w.organizer.call('PUT', '/api/admin/alerts', { drop36: false, refundRequests: false, smartAlerts: false }), 'alerts');
  // Mon Nov 30, noon Eastern: venue cards are due; the first is marked paid.
  w.app.now = Date.parse('2026-11-30T17:00:00.000Z');
  ok(await w.organizer.call('POST', '/api/admin/login', { pin: PIN }), 'organizer signs in again (the 30-day sign-in ran out)');
  const venue = (await w.organizer.call('GET', '/api/admin/dashboard')).data.venueAlerts ?? [];
  expect(venue.length).toBeGreaterThan(0);
  ok(await w.organizer.call('POST', '/api/admin/venue-alert/paid', { keys: venue[0].keys, cents: venue[0].cents }), 'venue paid');

  dumpBefore = await moneyDump(w);
  dashBefore = (await w.organizer.call('GET', '/api/admin/dashboard')).data;
  alertsBefore = dashBefore.alerts;
  expect(dashBefore.alerts).toMatchObject({ drop36: false, refundRequests: false, smartAlerts: false });
  switchesBefore = switchRows(source);
  locksBefore = priceLocks(source);
  download = (await w.organizer.call('GET', '/api/admin/backup')).data;
  w.app.env.ORGANIZER_READONLY_PIN = RO;
  const helper = w.app.client();
  ok(await helper.call('POST', '/api/admin/login', { pin: RO }), 'read-only sign-in');
  roDownload = (await helper.call('GET', '/api/admin/backup')).data;
  delete w.app.env.ORGANIZER_READONLY_PIN;
  // Back to the moment of the download: the helper's sign-in came after it.
  source.raw.exec("DELETE FROM admin_sessions WHERE id LIKE 'ro:%'");
}, 180_000);

describe('Zip 50: the backup holds the switches, price locks, alert settings and sign-ins (file version 2)', () => {
  it('the file is version 3 (Zip 56) and holds every table but the short-lived counters', () => {
    expect(BACKUP_VERSION).toBe(5);
    expect(download.version).toBe(5);
    expect([...BACKUP_TABLES]).toEqual(TABLES);
    for (const t of NEW) expect(BACKUP_TABLES as readonly string[], t).toContain(t);
    // Zip 56 (Alex): the four tournament tables joined the file (version 3); only the short-lived counters stay out.
    for (const t of ['tournaments', 'tournament_signups', 'tournament_level_history', 'tournament_tickets']) expect(BACKUP_TABLES as readonly string[], t).toContain(t);
    expect(Object.keys(BACKUP_LEFT_OUT).sort()).toEqual(['login_attempts', 'rate_events']);
    // The world really has what the old file lost.
    expect(locksBefore.length).toBe(11);
    expect(switchesBefore.length).toBeGreaterThan(10);
    for (const task of ['venue_paid', 'christmas_skin']) expect(switchesBefore.some((r) => String(r.task).startsWith(task)), task).toBe(true);
    expect(switchesBefore.some((r) => r.kind === 'off'), 'Smart alerts off').toBe(true);
    expect(rowsOf(source, 'organizer_alerts')).toHaveLength(1);
    for (const t of NEW) expect(download.tables[t], t).toEqual(rowsOf(source, t));
  });

  it('the weekly copy is the same file, character for character (one run and in steps)', async () => {
    const one = JSON.parse((await backupText(source as never, download.groupName, download.createdAt)).text);
    expect(one).toEqual(download);
    const store = createNodeD1(':memory:', mkdtempSync(join(tmpdir(), 'zip50-no-mig-')));
    const made = await weeklyBackup(source as never, store as never, Date.parse(download.createdAt), { force: true });
    expect(made.made).toBe(true);
    const h = store.raw.prepare('SELECT * FROM weekly_backups').get() as any;
    const parts = store.raw.prepare('SELECT part, data FROM weekly_backup_parts WHERE backup_id = ? ORDER BY part').all(h.id) as any[];
    expect(joinParts(h, parts)).toEqual(download);
    for (const t of NEW) expect(JSON.parse(h.rows_json)[t], t).toBe(rowsOf(source, t).length);
  });

  for (const via of ['the downloaded file', 'the weekly copy'] as const) {
    it(`restore from ${via} into an EMPTY database gives back every switch, every price and every alert setting`, async () => {
      let file = download;
      if (via === 'the weekly copy') {
        const store = createNodeD1(':memory:', mkdtempSync(join(tmpdir(), 'zip50-no-mig-')));
        await weeklyBackup(source as never, store as never, Date.parse(download.createdAt), { force: true });
        const h = store.raw.prepare('SELECT * FROM weekly_backups').get() as any;
        file = joinParts(h, store.raw.prepare('SELECT part, data FROM weekly_backup_parts WHERE backup_id = ? ORDER BY part').all(h.id) as any[]);
      }
      const r = cli(file);
      expect(r.status, r.err).toBe(0);
      const copy = restoreEmpty(r.sql);
      // Every backed-up table, row for row, value for value.
      for (const t of TABLES) expect(rowsOf(copy, t), t).toEqual(rowsOf(source, t));
      expect(switchRows(copy)).toEqual(switchesBefore);
      expect(priceLocks(copy)).toEqual(locksBefore);
      try {
        useDb(w, copy);
        // The organizer's phone is still signed in (its sign-in came back with the file): no new PIN needed.
        const dash = await w.organizer.call('GET', '/api/admin/dashboard');
        expect(dash.status).toBe(200);
        // Every money number on the organizer's and the players' screens, the same.
        const after: Record<string, any> = await moneyDump(w);
        expect(after).toEqual(dumpBefore);
        // The audit's October example: court cost $408 stays $408 (a version 1 file made it $386).
        expect(dumpBefore['money 2026-10'].courtCostCents).toBe(40800);
        expect(after['money 2026-10'].courtCostCents).toBe(40800);
        // Settings > Alerts, the venue cards, the Christmas choice and the hidden game, the same.
        expect(dash.data.alerts).toEqual(alertsBefore);
        expect(dashBefore.venueAlerts.length).toBeGreaterThan(0);
        expect(dash.data.venueAlerts).toEqual(dashBefore.venueAlerts);
        expect(dashBefore.christmasSkinMode).toBe('me');
        expect(dash.data.christmasSkinMode).toBe('me');
        expect(dashBefore.sessions.some((s: any) => s.hiddenFromPlayers)).toBe(true);
        expect(dash.data.sessions.map((s: any) => [s.startsAt, s.hiddenFromPlayers ?? null])).toEqual(dashBefore.sessions.map((s: any) => [s.startsAt, s.hiddenFromPlayers ?? null]));
      } finally {
        useDb(w, source);
      }
    }, 120_000);
  }

  it('restoring OVER changed live data puts the file back exactly (a switch flipped and a sign-in made after the backup are undone)', async () => {
    const over = restoreEmpty(backupToSql(download));
    over.raw.exec('PRAGMA foreign_keys = ON;');
    try {
      useDb(w, over);
      expect((await w.organizer.call('PUT', '/api/admin/late-fees', { on: false })).status).toBe(200);
      const other = w.app.client();
      expect((await other.call('POST', '/api/admin/login', { pin: PIN })).status).toBe(200);
      expect(switchRows(over)).not.toEqual(switchesBefore);
      over.raw.exec('BEGIN');
      over.raw.exec(backupToSql(download));
      over.raw.exec('COMMIT');
      for (const t of TABLES) expect(rowsOf(over, t), t).toEqual(rowsOf(source, t));
      expect((await other.call('GET', '/api/admin/dashboard')).status).toBe(401);
      expect((await w.organizer.call('GET', '/api/admin/dashboard')).status).toBe(200);
      expect(await moneyDump(w)).toEqual(dumpBefore);
    } finally {
      useDb(w, source);
    }
  }, 120_000);

  it('an OLD file (version 1, before Zip 50) still restores exactly as it always did: the three new tables come back empty', async () => {
    const v1 = JSON.parse(JSON.stringify(download));
    v1.version = 1;
    for (const t of NEW) delete v1.tables[t];
    const r = cli(v1);
    expect(r.status, r.err).toBe(0);
    expect(r.err).toContain('file version 1');
    expect(r.err).toContain('old (version 1) file');
    const copy = restoreEmpty(r.sql);
    for (const t of TABLES.filter((x) => !NEW.includes(x))) expect(rowsOf(copy, t), t).toEqual(rowsOf(source, t));
    for (const t of NEW) expect(rowsOf(copy, t), t).toEqual([]);
    // Over live data too: the old file empties them (as the cascade always did on Cloudflare).
    const over = restoreEmpty(backupToSql(download));
    over.raw.exec(backupToSql(v1));
    for (const t of NEW) expect(rowsOf(over, t), t).toEqual([]);
    // Why version 2 was needed (the audit's numbers): with the old file the October court cost is priced again at today's rules.
    try {
      useDb(w, copy);
      expect((await w.organizer.call('POST', '/api/admin/login', { pin: PIN })).status).toBe(200);
      const m = (await w.organizer.call('GET', '/api/admin/money?month=2026-10')).data;
      expect(m.courtCostCents).toBe(38600);
    } finally {
      useDb(w, source);
      expect((await w.organizer.call('POST', '/api/admin/login', { pin: PIN })).status).toBe(200);
    }
  }, 120_000);

  it('a version 1 file that somehow carries the new tables still restores them empty (never half old, half new)', () => {
    const odd = JSON.parse(JSON.stringify(download));
    odd.version = 1;
    const copy = restoreEmpty(backupToSql(odd));
    for (const t of NEW) expect(rowsOf(copy, t), t).toEqual([]);
  });

  it('a file missing a new table, or an unknown version, is refused with a plain message', () => {
    const missing = JSON.parse(JSON.stringify(download));
    delete missing.tables.task_log;
    expect(() => backupToSql(missing)).toThrow('missing the task_log table');
    const noTickets = JSON.parse(JSON.stringify(download));
    delete noTickets.tables.tournament_tickets;
    expect(() => backupToSql(noTickets)).toThrow('missing the tournament_tickets table');
    expect(() => backupToSql({ ...download, version: 6 })).toThrow('version 6');
    // Zip 57: a version 4 file must bring the teams and the games.
    const noTeams = JSON.parse(JSON.stringify(download));
    delete noTeams.tables.tournament_teams;
    expect(() => backupToSql(noTeams)).toThrow('missing the tournament_teams table');
  });

  it('Zip 57: a version 3 file (before teams and games) still restores, with no teams or games', () => {
    const v3 = JSON.parse(JSON.stringify(download));
    v3.version = 3;
    for (const t of ['tournament_teams', 'tournament_games']) delete v3.tables[t];
    const copy = restoreEmpty(backupToSql(v3));
    for (const t of ['tournament_teams', 'tournament_games']) expect(rowsOf(copy, t), t).toEqual([]);
    expect(rowsOf(copy, 'tournament_tickets').length).toBe(download.tables.tournament_tickets.length);
  });

  it('a version 2 file (before Zip 56) still restores, its tournament tables empty; a version 3 file brings them back', () => {
    const v2 = JSON.parse(JSON.stringify(download));
    v2.version = 2;
    for (const t of ['tournaments', 'tournament_signups', 'tournament_level_history', 'tournament_tickets']) delete v2.tables[t];
    const copy = restoreEmpty(backupToSql(v2));
    for (const t of ['tournaments', 'tournament_signups', 'tournament_level_history', 'tournament_tickets']) expect(rowsOf(copy, t), t).toEqual([]);
    expect(rowsOf(copy, 'task_log').length).toBe(download.tables.task_log.length);
  });

  it('the read-only download has no sign-ins and no PIN, and the restore script refuses it (Audit C F-11)', () => {
    expect(roDownload.version).toBe(5);
    expect(roDownload.tables.admin_sessions).toEqual([]);
    expect(roDownload.tables.groups[0].admin_pin_hash).toBe('');
    // Its switches and price locks are there (View as uses this same file).
    expect(roDownload.tables.task_log).toEqual(download.tables.task_log);
    const r = cli(roDownload);
    expect(r.status).toBe(1);
    expect(r.sql).toBe('');
    expect(r.err).toContain('read-only PIN');
    const report = compare('read-only file', fileSource(roDownload), roDownload, undefined, true);
    expect(report.ok).toBe(false);
    expect(report.checks.filter((c) => !c.ok).map((c) => c.line).join('\n')).toContain('read-only PIN');
  });

  it('a file from before Oct 29 (no credit tables) prints its summary and exits OK (Audit A-21 / C F-12)', () => {
    const old = JSON.parse(JSON.stringify(download));
    old.version = 1;
    for (const t of [...NEW, 'credit_ledger', 'refund_requests']) delete old.tables[t];
    const r = cli(old);
    expect(r.status, r.err).toBe(0);
    expect(r.sql).toBe(backupToSql(old));
    expect(r.err).toContain('credit_ledger: 0');
    expect(r.err).toContain('refund_requests: 0');
  });

  it('the restore test passes the new file and flags a column this checkout does not have (Audit C F-22)', () => {
    const good = compare('v2 file', fileSource(download), download, undefined, true);
    expect(good.checks.filter((c) => !c.ok)).toEqual([]);
    expect(good.notes.join('\n')).not.toContain('switch rows');
    const newer = JSON.parse(JSON.stringify(download));
    newer.tables.sessions = newer.tables.sessions.map((s: Row) => ({ ...s, some_future_column: 1 }));
    const bad = compare('newer file', fileSource(newer), newer, undefined, true);
    expect(bad.ok).toBe(false);
    expect(bad.checks.filter((c) => !c.ok).map((c) => c.line).join('\n')).toContain('sessions.some_future_column');
  });

  it('read-only sign-ins never go into a backup (their id carries a fingerprint of the read-only PIN): download and weekly copy alike', async () => {
    source.raw.prepare("INSERT INTO admin_sessions (id, group_id, token_hash, created_at, expires_at) SELECT 'ro:abcdef012345:x1', id, 'hash-x1', '2026-11-30T17:00:00.000Z', '2026-12-01T05:00:00.000Z' FROM groups").run();
    try {
      const real = (await w.organizer.call('GET', '/api/admin/backup')).data;
      expect(real.tables.admin_sessions.length).toBeGreaterThan(0);
      expect(real.tables.admin_sessions.some((r: Row) => String(r.id).startsWith('ro:'))).toBe(false);
      expect(JSON.stringify(real)).not.toContain('abcdef012345');
      const store = createNodeD1(':memory:', mkdtempSync(join(tmpdir(), 'zip50-no-mig-')));
      expect((await weeklyBackup(source as never, store as never, Date.parse(real.createdAt), { force: true })).made).toBe(true);
      const h = store.raw.prepare('SELECT * FROM weekly_backups').get() as any;
      const weekly = joinParts(h, store.raw.prepare('SELECT part, data FROM weekly_backup_parts WHERE backup_id = ? ORDER BY part').all(h.id) as any[]);
      expect(weekly).toEqual(real);
      expect(JSON.parse(h.rows_json).admin_sessions).toBe(real.tables.admin_sessions.length);
    } finally {
      source.raw.exec("DELETE FROM admin_sessions WHERE id = 'ro:abcdef012345:x1'");
    }
  });

  it('View as (the in-browser copy) loads the new file: the switch rows are not duplicated', async () => {
    const { default: initSqlJs } = await import('sql.js');
    const { readdirSync, readFileSync } = await import('node:fs');
    const { createSandbox } = await import('../src/demo/sandbox');
    const dir = join(process.cwd(), 'migrations');
    const migrations = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort().map((f) => readFileSync(join(dir, f), 'utf8'));
    const extras = (await w.organizer.call('GET', '/api/admin/demo-extras')).data;
    const SQL = await initSqlJs();
    const realDb = SQL.Database;
    let made: any = null;
    // Catch the copy's database to count its rows (the sandbox keeps it private).
    (SQL as any).Database = function (...a: any[]) {
      made = new (realDb as any)(...a);
      return made;
    };
    const sb = await createSandbox(SQL, download, migrations, 'https://example.test', extras);
    (SQL as any).Database = realDb;
    const res = await sb.request('GET', '/api/admin/dashboard', undefined, {}, w.app.now);
    expect(res.status).toBe(200);
    const n = made.exec('SELECT COUNT(*) FROM task_log')[0].values[0][0];
    expect(n).toBe(rowsOf(source, 'task_log').length);
    expect(n).toBe(extras.taskLog.length);
  }, 120_000);
});
