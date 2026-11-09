// The restore test (Zip 19). Proves a backup loads back and gives the same data, into THROWAWAY databases in memory only.
// Steps and what it checks: docs/RESTORE_TEST.md.
//
//   npm run restore-test                      the newest weekly copy AND a fresh export of live (the usual run)
//   npm run restore-test -- --weekly [week]   only a weekly copy (the newest, or the week as "node scripts/weekly-backup.mjs list" shows it)
//   npm run restore-test -- --live            only a fresh export of live
//   npm run restore-test -- --file pickleball-backup-2026-11-03.json   a file from Settings > Backup
//
// SAFE TO RUN ANY TIME: it never writes to Cloudflare. Every Cloudflare call goes through `wrangler` below, which allows exactly two
// kinds of command and refuses anything else before it runs: `wrangler d1 export pickleball --remote --output <temp file>` (a read-only
// download of live) and `wrangler d1 execute pickleball-backups --remote --json --command "SELECT ..."` (a plain read of the weekly copies).
// The live export is deleted when the test ends (it has phone numbers). Needs the same setup as a deploy (signed in to Cloudflare).
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { backupObject } from '../server/backupData';
import { isReadSql } from '../server/viewOnly';
import { weeklyBackup } from '../worker/backup';
import { joinParts, WEEK } from './weekly-backup.mjs';
import { type Backup, compare, emptyDb, fileSource, loadExport, printReport, type Report } from './restore-test-lib';

export type Runner = (args: string[]) => string;

/** Is this wrangler command one of the two reads the restore test may run? Anything else is refused. */
export function readOnlyCommand(args: string[]): boolean {
  const isExport = args.length === 6 && args[0] === 'd1' && args[1] === 'export' && args[2] === 'pickleball' && args[3] === '--remote' && args[4] === '--output' && args[5].endsWith('.sql');
  const sql = args[6] ?? '';
  const isRead =
    args.length === 7 &&
    args[0] === 'd1' &&
    args[1] === 'execute' &&
    args[2] === 'pickleball-backups' &&
    args[3] === '--remote' &&
    args[4] === '--json' &&
    args[5] === '--command' &&
    /^SELECT\s/.test(sql) &&
    !sql.includes(';') &&
    isReadSql(sql);
  return isExport || isRead;
}

/** The only door to Cloudflare. */
export function wrangler(run: Runner, args: string[]): string {
  if (!readOnlyCommand(args)) throw new Error(`Refused, not a read-only command: wrangler ${args.join(' ').slice(0, 120)}`);
  return run(args);
}

export const npxRunner: Runner = (args) => execFileSync('npx', ['wrangler', ...args], { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });

function select(run: Runner, sql: string): Record<string, any>[] {
  const out = wrangler(run, ['d1', 'execute', 'pickleball-backups', '--remote', '--json', '--command', sql]);
  return JSON.parse(out.slice(out.indexOf('[')))[0].results;
}

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-US', { timeZone: 'America/Detroit', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

/** A weekly copy from `pickleball-backups` (reads only): the newest, or the given week. */
export function fetchWeekly(run: Runner, week?: string): { backup: Backup; header: Record<string, number>; label: string } {
  if (week !== undefined && !WEEK.test(week)) throw new Error(`Not a week like 2026-11-08 (or 2026-11-08-asked-2000): ${week}`);
  const [h] = select(run, `SELECT id, week, created_at, bytes, parts, rows_json FROM weekly_backups ${week ? `WHERE week = '${week}' ` : ''}ORDER BY created_at DESC LIMIT 1`);
  if (!h) throw new Error(week ? `No weekly copy for the week of ${week}.` : 'No weekly copies yet.');
  if (!/^[A-Za-z0-9-]+$/.test(h.id)) throw new Error('Unexpected copy id.');
  const parts = select(run, `SELECT part, data FROM weekly_backup_parts WHERE backup_id = '${h.id}' ORDER BY part`) as { part: number; data: string }[];
  const backup = joinParts(h as { parts: number; bytes: number }, parts) as Backup;
  return { backup, header: JSON.parse(h.rows_json), label: `weekly copy ${h.week} (made ${when(h.created_at)} Eastern, ${h.bytes} characters in ${h.parts} pieces)` };
}

/** A fresh read-only export of live, as a throwaway database. The export file is deleted at once. */
export function fetchLive(run: Runner) {
  const dir = mkdtempSync(join(tmpdir(), 'restore-test-'));
  const file = join(dir, 'live.sql');
  try {
    wrangler(run, ['d1', 'export', 'pickleball', '--remote', '--output', file]);
    return loadExport(readFileSync(file, 'utf8'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Live: the export is the source; both backup builders run on it (the download / old weekly format and the new weekly format). */
export async function liveReports(run: Runner, nowIso = new Date().toISOString()): Promise<Report[]> {
  const source = fetchLive(run);
  const group = source.raw.prepare('SELECT name FROM groups LIMIT 1').get() as { name: string } | undefined;
  if (!group) throw new Error('The live export has no group.');
  const download = JSON.parse(JSON.stringify(await backupObject(source, group.name, nowIso))) as Backup;
  // The real weekly copy code (plan, steps, finish; worker/backup.ts) run on the export, saved into a throwaway store, joined back.
  const store = emptyDb();
  const made = await weeklyBackup(source, store, Date.parse(nowIso), { force: true });
  if (!made.made) throw new Error(`the weekly copy code did not make a copy of the export: ${made.reason}`);
  const header = store.raw.prepare('SELECT id, bytes, parts, rows_json FROM weekly_backups').get() as { id: string; bytes: number; parts: number; rows_json: string };
  const pieces = store.raw.prepare('SELECT part, data FROM weekly_backup_parts WHERE backup_id = ? ORDER BY part').all(header.id) as { part: number; data: string }[];
  const weekly = joinParts(header, pieces) as Backup;
  return [
    compare(`fresh export of live (${when(nowIso)} Eastern), saved as a Settings > Backup file (also the format of weekly copies before Zip 19)`, source, download),
    compare(`the same export, saved by the weekly copy code since Zip 19 (plan, ${made.parts} steps, finish)`, source, weekly, JSON.parse(header.rows_json)),
  ];
}

export async function main(argv: string[], run: Runner = npxRunner, out: (s: string) => void = console.log): Promise<number> {
  const args = argv.filter((a) => a !== '--');
  const reports: Report[] = [];
  try {
    if (args[0] === '--file') {
      if (!args[1]) throw new Error('Usage: npm run restore-test -- --file <backup file.json>');
      const backup = JSON.parse(readFileSync(args[1], 'utf8')) as Backup;
      reports.push(compare(`backup file ${args[1]}`, fileSource(backup), backup, undefined, true));
    } else if (args[0] === '--weekly') {
      const w = fetchWeekly(run, args[1]);
      reports.push(compare(w.label, fileSource(w.backup), w.backup, w.header, true));
    } else if (args[0] === '--live') {
      reports.push(...(await liveReports(run)));
    } else if (args.length === 0) {
      const w = fetchWeekly(run);
      reports.push(compare(w.label, fileSource(w.backup), w.backup, w.header, true));
      reports.push(...(await liveReports(run)));
    } else {
      throw new Error('Usage: npm run restore-test  [-- --weekly [week] | -- --live | -- --file <backup.json>]');
    }
  } catch (err) {
    const e = err as { message?: string; stderr?: string };
    out(`FAIL  could not run the restore test: ${e.message ?? String(err)}${e.stderr ? `\n${String(e.stderr).slice(-600)}` : ''}`);
    return 1;
  }
  for (const r of reports) printReport(r, out);
  const ok = reports.every((r) => r.ok);
  out(ok ? `RESULT: PASS (${reports.length} of ${reports.length}). Nothing on Cloudflare was changed.` : `RESULT: FAIL (${reports.filter((r) => !r.ok).length} of ${reports.length} failed). Nothing on Cloudflare was changed; do not "fix" live data from this, ask first.`);
  return ok ? 0 : 1;
}
