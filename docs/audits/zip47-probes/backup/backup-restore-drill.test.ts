// Zip 47 audit probe (read-only drill): build a rich fake world, export it every way the project can, restore it into fresh throwaway
// databases with the project's own restore logic, and compare table by table, row by row, and every money number the screens show.
// Nothing here talks to Cloudflare. Everything is in memory or in temp folders.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { createNodeD1 } from '../../../dev/nodeD1';
import { backupObject, BACKUP_TABLES } from '../../../server/backupData';
import { backupToSql, TABLES } from '../../../scripts/restore-backup.mjs';
import { joinParts } from '../../../scripts/weekly-backup.mjs';
import { joinExport, looksLikeExport, save as saveExport } from '../../../scripts/deploy-export.mjs';
import { BACKUP_LEFT_OUT, backupText, weeklyBackup } from '../../../worker/backup';
import { compare, fileSource, integrity, loadExport, money, restoreCopy } from '../../../scripts/restore-test-lib';
import { buildWorld, flipPriceRules, LIVE_SWITCHES, moneyDump, settledPart, type World } from '../../zip27-world';
import { firstSession, HOUR, PIN, playerPhone, setupGroup, TestApp } from '../../harness';

type Db = ReturnType<typeof createNodeD1>;
type Row = Record<string, unknown>;
const RO = '97531864'; // a throwaway read-only PIN for this probe only
const OUT = join(mkdtempSync(join(tmpdir(), 'probe47-')), 'report.json');
const report: Record<string, unknown> = {};

const tablesIn = (db: Db) =>
  (db.raw.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string }[]).map((t) => t.name);
const rowsOf = (db: Db, t: string) => (db.raw.prepare(`SELECT * FROM "${t}" ORDER BY rowid`).all() as Row[]).map((r) => ({ ...r }));

/** A stand-in for `wrangler d1 export`: PRAGMA, every table's CREATE and rows, then indexes and triggers (like sqlite's .dump). */
function fullExport(db: Db): string {
  const lit = (v: unknown) => (v === null ? 'NULL' : typeof v === 'number' || typeof v === 'bigint' ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
  const out = ['PRAGMA defer_foreign_keys=TRUE;'];
  const objs = db.raw.prepare("SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 ELSE 1 END, rowid").all() as { type: string; name: string; sql: string }[];
  for (const o of objs.filter((x) => x.type === 'table')) {
    // The test stand-in's own migrations table (like d1_migrations) is made by every throwaway database already.
    out.push(o.name === '_migrations' ? `${o.sql.replace('CREATE TABLE', 'CREATE TABLE IF NOT EXISTS')};` : `${o.sql};`);
    for (const r of rowsOf(db, o.name)) out.push(`INSERT INTO "${o.name}" (${Object.keys(r).map((c) => `"${c}"`).join(',')}) VALUES(${Object.values(r).map(lit).join(',')});`);
  }
  for (const o of objs.filter((x) => x.type !== 'table')) out.push(`${o.sql};`);
  return out.join('\n') + '\n';
}

/** Table-by-table, row-by-row differences between two databases (every table either side has). */
function diffDbs(a: Db, b: Db): Record<string, string> {
  const out: Record<string, string> = {};
  const names = [...new Set([...tablesIn(a), ...tablesIn(b)])].sort();
  for (const t of names) {
    const ra = tablesIn(a).includes(t) ? rowsOf(a, t) : null;
    const rb = tablesIn(b).includes(t) ? rowsOf(b, t) : null;
    if (!ra || !rb) {
      out[t] = `only in ${ra ? 'source' : 'copy'} (${(ra ?? rb)!.length} rows)`;
      continue;
    }
    if (ra.length !== rb.length) {
      out[t] = `rows: source ${ra.length}, copy ${rb.length}`;
      continue;
    }
    const bad: string[] = [];
    ra.forEach((r, i) => {
      for (const c of new Set([...Object.keys(r), ...Object.keys(rb[i])])) if (JSON.stringify(r[c] ?? null) !== JSON.stringify(rb[i][c] ?? null)) bad.push(`row ${i + 1} ${c}`);
    });
    if (bad.length) out[t] = `${bad.length} values differ (first: ${bad.slice(0, 3).join(', ')})`;
  }
  return out;
}

function runSql(db: Db, sql: string) {
  db.raw.exec('BEGIN');
  try {
    db.raw.exec(sql);
    db.raw.exec('COMMIT');
  } catch (e) {
    db.raw.exec('ROLLBACK');
    throw e;
  }
}

/** The restore exactly as docs/RESTORE.md step 1 makes it: the real CLI, on a file, its stdout as restore.sql. */
function cliRestoreSql(backup: unknown): { sql: string; stderr: string } {
  const dir = mkdtempSync(join(tmpdir(), 'probe47-file-'));
  const file = join(dir, 'pickleball-backup-probe.json');
  writeFileSync(file, JSON.stringify(backup, null, 1));
  const sql = execFileSync('node', [join(process.cwd(), 'scripts', 'restore-backup.mjs'), file], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  return { sql, stderr: '' };
}

/** Point the world's clients at another database (the organizer signs in again: a restore signs organizers out). */
async function useDb(w: World, db: Db) {
  w.app.db = db as never;
  w.app.env.DB = db as never;
  const r = await w.organizer.call('POST', '/api/admin/login', { pin: PIN });
  return r.status;
}

/** Every leaf path where two JSON values differ. */
function leafDiff(a: unknown, b: unknown, path = '', out: string[] = []): string[] {
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    for (const k of new Set([...Object.keys(a as object), ...Object.keys(b as object)])) leafDiff((a as any)[k], (b as any)[k], path ? `${path}.${k}` : k, out);
  } else if (JSON.stringify(a) !== JSON.stringify(b)) out.push(`${path}: ${JSON.stringify(a)} -> ${JSON.stringify(b)}`);
  return out;
}

const diffKeys = (a: Record<string, unknown>, b: Record<string, unknown>) =>
  [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));

let w: World;
let source: Db;
let download: any;
let roDownload: any;
let switchesOnBefore: string[];
let dumpBefore: Record<string, any>;
let venueBefore: any[];
let christmasBefore: unknown;
let gameG: string;

beforeAll(async () => {
  w = await buildWorld({ bookingHours: true, extraSwitches: ['guest-spot-switch', 'extended-time-switch', 'venue-alert-switch'] });
  source = w.app.db as unknown as Db;
  const ok = (r: { status: number; text: string }, what: string) => expect(r.status, `${what}: ${r.text}`).toBe(200);
  // Tue Nov 10, 6:00 PM Eastern, 2 hours: four in, Casey brings a guest, Devon paid, finalized with +30 minutes (Extended time).
  const add = await w.organizer.call('POST', '/api/admin/sessions', { startsAt: '2026-11-10T23:00:00.000Z', endsAt: '2026-11-11T01:00:00.000Z', note: null });
  ok(add, 'add game G');
  gameG = add.data.id;
  for (const n of ['Casey', 'Devon', 'Emery', 'Frankie']) ok(await w.phones[n].call('POST', `/api/sessions/${gameG}/join`, {}), `join ${n}`);
  ok(await w.organizer.call('POST', `/api/admin/sessions/${gameG}/guest`, { playerId: w.byName.Casey, name: 'Robin' }), 'guest');
  ok(await w.organizer.call('POST', `/api/admin/sessions/${gameG}/payment`, { playerId: w.byName.Devon, paid: true }), 'pay Devon');
  w.app.now = Date.parse('2026-11-11T02:00:00.000Z');
  ok(await w.organizer.call('POST', `/api/admin/sessions/${gameG}/finalize`, { played: ['Casey', 'Devon', 'Emery', 'Frankie'].map((n) => w.byName[n]), extraMinutes: 30 }), 'finalize G +30');
  // The A-01 trap: price rules change after games were finalized (locks are written first).
  await flipPriceRules(w, { bookingHours: true });
  // Christmas "Just me".
  ok(await w.organizer.call('PUT', '/api/admin/christmas-skin-switch', { mode: 'me' }), 'christmas me');
  // Hide the canceled game from players.
  const canceled = (w.app.db.raw.prepare("SELECT id FROM sessions WHERE status = 'canceled' LIMIT 1").get() as { id: string }).id;
  ok(await w.organizer.call('POST', `/api/admin/sessions/${canceled}/hide`, { hidden: true }), 'hide canceled');
  // Mon Nov 30, noon Eastern: venue cards are due; mark the first paid.
  w.app.now = Date.parse('2026-11-30T17:00:00.000Z');
  ok(await w.organizer.call('POST', '/api/admin/login', { pin: PIN }), 'organizer signs in again (30-day sign-in ran out)');
  venueBefore = (await w.organizer.call('GET', '/api/admin/dashboard')).data.venueAlerts ?? [];
  if (venueBefore.length) ok(await w.organizer.call('POST', '/api/admin/venue-alert/paid', { keys: venueBefore[0].keys, cents: venueBefore[0].cents }), 'venue paid');
  venueBefore = (await w.organizer.call('GET', '/api/admin/dashboard')).data.venueAlerts ?? [];
  christmasBefore = (await w.organizer.call('GET', '/api/admin/dashboard')).data.christmasSkin ?? (await w.organizer.call('GET', '/api/admin/dashboard')).data.christmasSkinMode;
  switchesOnBefore = (w.app.db.raw.prepare("SELECT task FROM task_log WHERE session_id IS NULL AND kind = 'mark' ORDER BY task").all() as { task: string }[]).map((r) => r.task);
  for (const m of ['2026-10', '2026-11', '2026-12']) {
    const r = await w.organizer.call('GET', `/api/admin/money?month=${m}`);
    if (r.status !== 200) console.log('MONEY', m, r.status, r.text.slice(0, 200));
  }
  dumpBefore = await moneyDump(w);
  download = (await w.organizer.call('GET', '/api/admin/backup')).data;
  // The read-only PIN's download.
  w.app.env.ORGANIZER_READONLY_PIN = RO;
  const helper = w.app.client();
  ok(await helper.call('POST', '/api/admin/login', { pin: RO }), 'ro login');
  roDownload = (await helper.call('GET', '/api/admin/backup')).data;
}, 120_000);

describe('Zip 47 backup drill', () => {
  it('P47-B01 every export path holds the same rows: download = weekly one-run = weekly in steps; guest columns present', async () => {
    const nowIso = download.createdAt;
    const one = JSON.parse((await backupText(source as never, download.groupName, nowIso)).text);
    expect(one).toEqual(download);
    const store = createNodeD1(':memory:', mkdtempSync(join(tmpdir(), 'no-mig-')));
    const made = await weeklyBackup(source as never, store as never, Date.parse(nowIso), { force: true });
    expect(made.made).toBe(true);
    const h = store.raw.prepare('SELECT * FROM weekly_backups').get() as any;
    const parts = store.raw.prepare('SELECT part, data FROM weekly_backup_parts WHERE backup_id = ? ORDER BY part').all(h.id) as any[];
    const stepped = joinParts(h, parts);
    expect({ ...stepped, createdAt: nowIso }).toEqual(download);
    const sp = download.tables.session_players as Row[];
    for (const c of ['guest_name', 'guest_status', 'guest_seq', 'guest_at', 'guest_played', 'guest_first', 'ext_cents', 'ext_paid_cents']) expect(c in sp[0], c).toBe(true);
    const guestSeat = sp.find((r) => r.guest_name === 'Robin')!;
    expect(guestSeat.guest_status).toBe('confirmed');
    expect(guestSeat.guest_played).toBe(1);
    expect((download.tables.sessions as Row[]).find((s) => s.id === gameG)!.extra_minutes).toBe(30);
    report.tablesInBackup = Object.keys(download.tables);
    report.tablesInSchemaNotInBackup = tablesIn(source).filter((t) => !(BACKUP_TABLES as readonly string[]).includes(t));
    report.leftOutListed = Object.keys(BACKUP_LEFT_OUT);
    report.rowCountsSource = Object.fromEntries(tablesIn(source).map((t) => [t, rowsOf(source, t).length]));
    report.taskLogBreakdown = source.raw.prepare("SELECT CASE WHEN session_id IS NULL THEN 'group' ELSE 'game' END AS scope, kind, CASE WHEN task LIKE 'venue_paid:%' THEN 'venue_paid:*' ELSE task END AS task, COUNT(*) AS n FROM task_log GROUP BY 1, 2, 3 ORDER BY 1, 3").all();
  });

  it('P47-B02 restore from the file (the real CLI and the lib) into a fresh database: every backed-up table matches; what is lost', async () => {
    const { sql } = cliRestoreSql(download);
    expect(sql).toBe(backupToSql(download));
    const copy = createNodeD1(':memory:');
    runSql(copy, sql);
    expect(copy.raw.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    const d = diffDbs(source, copy);
    for (const t of TABLES) expect(d[t], t).toBeUndefined();
    report.diffAfterFileRestore = d;
    const lib = restoreCopy(download);
    for (const t of TABLES) expect(diffDbs(copy, lib)[t], t).toBeUndefined();
    expect(money(copy)).toEqual(money(source));
    // Integrity checks: compare bare (no switch rows) with source
    const i1 = integrity(source);
    const i2 = integrity(copy);
    report.integrityDiffBare = Object.keys(i1).filter((k) => i1[k] !== i2[k]).map((k) => `${k}: source ${i1[k]}, copy ${i2[k]}`);
    // The project's own restore test on this backup.
    const r = compare('probe', fileSource(download), download, undefined, true);
    report.restoreTestOnFile = { ok: r.ok, fails: r.checks.filter((c) => !c.ok).map((c) => c.line) };
    expect(r.ok).toBe(true);
  });

  it('P47-B03 restoring OVER the live data (docs/RESTORE.md step 4) empties task_log and organizer_alerts by cascade; sign-in counters stay', () => {
    const over = loadExport(fullExport(source));
    over.raw.exec('PRAGMA foreign_keys = ON;');
    over.raw.prepare("INSERT INTO login_attempts (id, client_key, succeeded, attempted_at) VALUES ('la1', 'k', 0, '2026-11-30T00:00:00Z')").run();
    const before = { task_log: rowsOf(over, 'task_log').length, organizer_alerts: rowsOf(over, 'organizer_alerts').length, admin_sessions: rowsOf(over, 'admin_sessions').length };
    runSql(over, backupToSql(download));
    const after = { task_log: rowsOf(over, 'task_log').length, organizer_alerts: rowsOf(over, 'organizer_alerts').length, admin_sessions: rowsOf(over, 'admin_sessions').length, login_attempts: rowsOf(over, 'login_attempts').length };
    report.overLive = { before, after };
    expect(after.task_log).toBe(0);
    expect(after.admin_sessions).toBe(0);
    // With foreign keys OFF the cascade does not fire: the old switch rows would survive (a restore run outside D1).
    const off = loadExport(fullExport(source));
    off.raw.exec('PRAGMA foreign_keys = OFF;');
    runSql(off, backupToSql(download));
    report.overLiveForeignKeysOff = { task_log: rowsOf(off, 'task_log').length };
  });

  it('P47-B04 the money screens after a FILE restore: with every switch off, and with the switches turned back on by hand', async () => {
    const copy = createNodeD1(':memory:');
    runSql(copy, backupToSql(download));
    expect(await useDb(w, copy)).toBe(200);
    const off = await moneyDump(w);
    const offDiff = diffKeys(settledPart(dumpBefore), settledPart(off));
    const allDiff = diffKeys(dumpBefore, off);
    const venueOff = (await w.organizer.call('GET', '/api/admin/dashboard')).data.venueAlerts ?? null;
    // Turn back on what was on (as docs/RESTORE.md says to do by hand), using the same Settings rows.
    const routeOf: Record<string, string> = {
      late_fees_on: 'late-fees', late_fee_split_on: 'late-fee-split', money_rework_on: 'money-rework', admin_v2_on: 'admin-v2', admin_r2_on: 'admin-r2', admin_r3_on: 'admin-r3',
    };
    for (const sw of [...LIVE_SWITCHES.filter((s) => s !== 'short-games-switch'), 'guest-spot-switch', 'extended-time-switch', 'venue-alert-switch']) {
      const r = await w.organizer.call('PUT', `/api/admin/${sw}`, { on: true });
      expect(r.status, sw).toBe(200);
    }
    void routeOf;
    const switchesOnAfter = (copy.raw.prepare("SELECT task FROM task_log WHERE session_id IS NULL AND kind = 'mark' ORDER BY task").all() as { task: string }[]).map((r) => r.task);
    const on = await moneyDump(w);
    const onDiff = diffKeys(settledPart(dumpBefore), settledPart(on));
    const venueOn = (await w.organizer.call('GET', '/api/admin/dashboard')).data.venueAlerts ?? null;
    // An example of a finalized game whose numbers moved.
    const sample = onDiff.find((k) => k.startsWith('game ')) ?? onDiff[0];
    report.moneyAfterFileRestore = {
      settledKeysDifferWithSwitchesOff: offDiff,
      allKeysDifferWithSwitchesOff: allDiff.length,
      settledKeysDifferAfterSwitchesBackOn: onDiff,
      leafDiffAfterSwitchesBackOn: leafDiff(settledPart(dumpBefore), settledPart(on)).filter((l) => !/\.shortGame|\.court\./.test(l)).slice(0, 60),
      leafDiffCourtOrShortCount: leafDiff(settledPart(dumpBefore), settledPart(on)).filter((l) => /\.shortGame|\.court\./.test(l)).length,
      playerFacingDiff: leafDiff(
        Object.fromEntries(Object.entries(dumpBefore).filter(([k]) => k.startsWith('player ') || k.startsWith('summary '))),
        Object.fromEntries(Object.entries(on).filter(([k]) => k.startsWith('player ') || k.startsWith('summary '))),
      ).slice(0, 40),
      sampleBefore: sample ? JSON.stringify((settledPart(dumpBefore) as any)[sample]).slice(0, 600) : null,
      sampleAfter: sample ? JSON.stringify((settledPart(on) as any)[sample]).slice(0, 600) : null,
      octTotalsBefore: JSON.stringify(dumpBefore['money 2026-10']?.rework ?? dumpBefore['money 2026-10']).slice(0, 400),
      octTotalsAfter: JSON.stringify(on['money 2026-10']?.rework ?? on['money 2026-10']).slice(0, 400),
      switchesBefore: switchesOnBefore,
      switchesAfterHandRestore: switchesOnAfter,
      venueCardsBefore: venueBefore.map((a: any) => a.keys.join('+')),
      venueCardsAfterSwitchOff: venueOff,
      venueCardsAfterSwitchOn: (venueOn ?? []).map((a: any) => a.keys.join('+')),
      christmasBefore,
      priceLocksSource: (source.raw.prepare("SELECT COUNT(*) AS n FROM task_log WHERE task = 'price_lock'").get() as any).n,
      priceLocksCopy: (copy.raw.prepare("SELECT COUNT(*) AS n FROM task_log WHERE task = 'price_lock'").get() as any).n,
    };
    await useDb(w, source);
  }, 120_000);

  it('P47-B05 an older backup (no guest columns, no extension columns, no device_tag, no court) restores into the current schema', () => {
    const drop = new Set(['guest_name', 'guest_status', 'guest_seq', 'guest_at', 'guest_played', 'guest_first', 'ext_cents', 'ext_credit_cents', 'ext_paid_cents', 'ext_claim_cents', 'ext_claim_at', 'ext_last_cents', 'ext_paid_at', 'ext_via', 'ext_seen_at', 'ext_at', 'extra_minutes', 'extra_cost_cents', 'court', 'device_tag']);
    const old = JSON.parse(JSON.stringify(download));
    for (const t of Object.keys(old.tables)) old.tables[t] = old.tables[t].map((r: Row) => Object.fromEntries(Object.entries(r).filter(([c]) => !drop.has(c))));
    const { sql } = cliRestoreSql(old);
    const copy = createNodeD1(':memory:');
    runSql(copy, sql);
    const seat = copy.raw.prepare("SELECT guest_name, guest_status, ext_paid_cents FROM session_players WHERE player_id = ? AND session_id = ?").get(w.byName.Casey, gameG) as Row;
    expect(seat).toEqual({ guest_name: null, guest_status: null, ext_paid_cents: 0 });
    // Only 0021 (no 0022 columns) in the backup: also fine.
    const only21 = JSON.parse(JSON.stringify(download));
    only21.tables.session_players = only21.tables.session_players.map(({ guest_played: _a, guest_first: _b, ...r }: Row) => r);
    const c2 = createNodeD1(':memory:');
    runSql(c2, cliRestoreSql(only21).sql);
    // A NEW backup into an OLD schema (before 0021/0022): the CLI fails loudly; the column-filtering path (restore-test lib / demo) drops the guest silently.
    const migDir = mkdtempSync(join(tmpdir(), 'mig20-'));
    for (const f of readFileSync(join(process.cwd(), 'migrations', '0001_init.sql'), 'utf8') ? [] : []) void f;
    const files = execFileSync('ls', [join(process.cwd(), 'migrations')], { encoding: 'utf8' }).split('\n').filter((f) => f.endsWith('.sql') && f < '0021');
    for (const f of files) writeFileSync(join(migDir, f), readFileSync(join(process.cwd(), 'migrations', f), 'utf8'));
    const oldSchema = createNodeD1(':memory:', migDir);
    let cliError = '';
    try {
      runSql(oldSchema, backupToSql(download));
    } catch (e) {
      cliError = String((e as Error).message).slice(0, 120);
    }
    report.newBackupIntoOldSchema = { cliError };
    expect(cliError).toMatch(/guest_/);
  });

  it('P47-B06 the read-only download: PIN hash blanked; a restore of it is accepted by the script and then nobody can sign in', async () => {
    expect(roDownload.tables.groups[0].admin_pin_hash).toBe('');
    expect(roDownload.tables.groups[0].group_word_hash).toBeNull();
    expect((roDownload.tables.admin_audit_log as Row[]).every((r) => r.device_tag === null)).toBe(true);
    // What the read-only file still carries: the private link key, calendar tokens, phone numbers.
    report.readOnlyFileStillHas = {
      group_key: !!roDownload.tables.groups[0].group_key,
      calendar_tokens: (roDownload.tables.players as Row[]).filter((p) => p.calendar_token).length,
      phones: (roDownload.tables.players as Row[]).filter((p) => p.phone_number).length,
      device_token_hashes: (roDownload.tables.player_devices as Row[]).length,
    };
    const sql = cliRestoreSql(roDownload).sql; // no refusal
    const copy = createNodeD1(':memory:');
    runSql(copy, sql);
    const status = await useDb(w, copy);
    report.readOnlyFileRestore = { scriptRefused: false, organizerSignInStatus: status };
    expect(status).not.toBe(200);
    await useDb(w, source);
  });

  it('P47-B07 the deploy export (whole database): saved in pieces, joined back, loaded into an EMPTY database: everything, switches and locks included', () => {
    const text = fullExport(source);
    expect(looksLikeExport(text)).toBe(true);
    const store = createNodeD1(':memory:', mkdtempSync(join(tmpdir(), 'no-mig-')));
    const run = (args: string[]) => {
      if (args[0] === '--file') {
        store.raw.exec(readFileSync(args[1], 'utf8'));
        return '';
      }
      return JSON.stringify([{ results: store.raw.prepare(args[2]).all() }]);
    };
    const dir = mkdtempSync(join(tmpdir(), 'probe47-exp-'));
    const file = join(dir, 'live-before-probe.sql');
    writeFileSync(file, text);
    const r = saveExport(run as never, file, 'probe', new Date('2026-11-30T18:00:00Z'));
    const header = store.raw.prepare('SELECT * FROM deploy_exports WHERE id = ?').get(r.id) as any;
    const back = joinExport(header, store.raw.prepare('SELECT part, data FROM deploy_export_parts WHERE export_id = ? ORDER BY part').all(r.id) as any);
    expect(back).toBe(text);
    const loaded = loadExport(back);
    const d = diffDbs(source, loaded);
    report.deployExportDiff = d;
    expect(d).toEqual({});
    // Loading it OVER a database that already has tables fails (CREATE TABLE exists).
    let overErr = '';
    try {
      const busy = createNodeD1(':memory:');
      busy.raw.exec(back);
    } catch (e) {
      overErr = String((e as Error).message).slice(0, 80);
    }
    report.deployExportOverExisting = overErr;
    expect(overErr).toMatch(/already exists|UNIQUE constraint/);
  });

  it('P47-B09 a backup from before Oct 29 (no refund_requests, no credit_ledger table): the CLI writes the SQL but then fails with an error', () => {
    const old = JSON.parse(JSON.stringify(download));
    delete old.tables.refund_requests;
    delete old.tables.credit_ledger;
    const dir = mkdtempSync(join(tmpdir(), 'probe47-old-'));
    const file = join(dir, 'pickleball-backup-old.json');
    writeFileSync(file, JSON.stringify(old));
    let status = 0;
    let stdout = '';
    let stderr = '';
    try {
      stdout = execFileSync('node', [join(process.cwd(), 'scripts', 'restore-backup.mjs'), file], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      const x = e as { status: number; stdout: string; stderr: string };
      status = x.status;
      stdout = x.stdout;
      stderr = x.stderr;
    }
    report.oldBackupCli = { exitStatus: status, stdoutHasInserts: /INSERT INTO groups/.test(stdout), stdoutEqualsFullSql: stdout === backupToSql(old), stderr: stderr.trim().slice(0, 160) };
    // The SQL itself loads fine.
    const copy = createNodeD1(':memory:');
    runSql(copy, backupToSql(old));
    expect(rowsOf(copy, 'session_players').length).toBe(download.tables.session_players.length);
  });

  it('P47-B10 a Time Travel point from before migrations 0021/0022: the current code on that schema (no guest columns) still serves players and money', async () => {
    const migDir = mkdtempSync(join(tmpdir(), 'mig20b-'));
    const files = execFileSync('ls', [join(process.cwd(), 'migrations')], { encoding: 'utf8' }).split('\n').filter((f) => f.endsWith('.sql') && f < '0021');
    for (const f of files) writeFileSync(join(migDir, f), readFileSync(join(process.cwd(), 'migrations', f), 'utf8'));
    const app = new TestApp();
    app.db = createNodeD1(':memory:', migDir) as never;
    app.env.DB = app.db as never;
    const ctx = await setupGroup(app);
    const s = await firstSession(ctx);
    const out: Record<string, number> = {};
    for (const n of ['Blair', 'Casey', 'Devon', 'Emery']) out[`join ${n}`] = (await (await playerPhone(ctx, n)).call('POST', `/api/sessions/${s.id}/join`, {})).status;
    out.pay = (await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/payment`, { playerId: ctx.byName.Blair, paid: true })).status;
    out.guestSwitch = (await ctx.organizer.call('PUT', '/api/admin/guest-spot-switch', { on: true })).status;
    out.addGuest = (await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/guest`, { playerId: ctx.byName.Casey, name: 'Robin' })).status;
    out.dashboard = (await ctx.organizer.call('GET', '/api/admin/dashboard')).status;
    out.playerView = (await (await playerPhone(ctx, 'Devon')).call('GET', '/api/group')).status;
    app.now = Date.parse(s.endsAt) + HOUR;
    out.finalize = (await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/finalize`, { everyone: true })).status;
    out.money = (await ctx.organizer.call('GET', '/api/admin/money?month=2026-10')).status;
    out.backup = (await ctx.organizer.call('GET', '/api/admin/backup')).status;
    report.codeOnSchemaBefore0021 = out;
    expect(out.dashboard).toBe(200);
  });

  it('P47-B08 write the report (counts and names of tables only)', () => {
    writeFileSync(OUT, JSON.stringify(report, null, 1));
    console.log(`PROBE47 REPORT: ${OUT}`);
    console.log(JSON.stringify(report, null, 1));
  });
});
