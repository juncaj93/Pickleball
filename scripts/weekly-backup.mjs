#!/usr/bin/env node
// The weekly backup copies (Zip 8, worker/backup.ts) live in the private Cloudflare database `pickleball-backups`.
// This lists them, or turns one back into a normal backup file (the same file Settings > Backup downloads), which
// docs/RESTORE.md then restores. Needs the same setup as a deploy (a terminal in this folder, signed in to Cloudflare).
//
//   node scripts/weekly-backup.mjs list
//   node scripts/weekly-backup.mjs get 2026-11-08        (the week, as "list" shows it; writes pickleball-backup-2026-11-08.json)
//   node scripts/weekly-backup.mjs ask                   (Zip 19: ask for a copy now; the clock makes it at its next hourly look,
//                                                         labeled like 2026-11-10-asked-2000 with its own date and time; it writes one tiny row, only to pickleball-backups)
//
// The file it writes has phone numbers: keep it private, never put it in git.
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const DB = 'pickleball-backups';
/** A copy's label: the Sunday's date, or for a hand-asked copy the date plus -asked-HHMM (Eastern). */
export const WEEK = /^\d{4}-\d{2}-\d{2}(-asked-\d{4})?$/;

/** Turns the pieces of one copy back into the backup file's text, checking nothing is missing. */
export function joinParts(header, parts) {
  const sorted = [...parts].sort((a, b) => a.part - b.part);
  if (sorted.length !== header.parts || sorted.some((p, i) => p.part !== i)) throw new Error(`This copy is incomplete (${sorted.length} of ${header.parts} pieces).`);
  const text = sorted.map((p) => p.data).join('');
  if (text.length !== header.bytes) throw new Error('This copy does not add up (wrong size).');
  const backup = JSON.parse(text);
  if (backup.format !== 'pickleball-backup') throw new Error('This is not a Pickleball Bros backup.');
  return backup;
}

/** One line of "list". A copy whose pieces are not all there says INCOMPLETE (the Worker saves all or nothing, so this means damage). */
export function listLine(r, when) {
  const n = JSON.parse(r.rows_json);
  const whole = r.have === undefined || Number(r.have) === Number(r.parts);
  const mark = whole ? '' : `  INCOMPLETE (${r.have} of ${r.parts} pieces): do not restore from it`;
  return `${r.week}  made ${when(r.created_at)} Eastern  players ${n.players}, games ${n.sessions}, seats ${n.session_players}, credit entries ${n.credit_ledger}${mark}`;
}

/** An unfinished copy (weekly_backup_progress): INCOMPLETE, not usable. */
export function unfinishedLine(u, when) {
  return `${u.week}  INCOMPLETE: started ${when(u.started_at)} Eastern, ${u.done} of ${u.steps} pieces saved. Not usable (it is not listed above and cannot be fetched); the next hourly look clears it and starts over.`;
}

function query(sql) {
  const out = execFileSync('npx', ['wrangler', 'd1', 'execute', DB, '--remote', '--json', '--command', sql], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'inherit'] });
  return JSON.parse(out.slice(out.indexOf('[')))[0].results;
}

const when = (iso) => new Date(iso).toLocaleString('en-US', { timeZone: 'America/Detroit', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [cmd, week] = process.argv.slice(2);
  try {
    if (cmd === 'list') {
      const rows = query('SELECT b.week, b.created_at, b.bytes, b.parts, b.rows_json, (SELECT COUNT(*) FROM weekly_backup_parts p WHERE p.backup_id = b.id) AS have FROM weekly_backups b ORDER BY b.created_at DESC');
      if (!rows.length) console.log('No weekly copies yet.');
      for (const r of rows) console.log(listLine(r, when));
      // Zip 19: a copy being made in steps that did not finish. Never listed above, never restorable; the next attempt clears it.
      const have = new Set(query("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('weekly_backup_progress', 'weekly_backup_requests')").map((t) => t.name));
      if (have.has('weekly_backup_progress')) {
        for (const u of query('SELECT week, started_at, steps, done FROM weekly_backup_progress ORDER BY started_at DESC')) console.log(unfinishedLine(u, when));
      }
      if (have.has('weekly_backup_requests')) {
        for (const r of query('SELECT asked_at FROM weekly_backup_requests ORDER BY asked_at')) console.log(`Asked for ${when(r.asked_at)} Eastern: waiting for the next hourly look.`);
      }
    } else if (cmd === 'ask') {
      const id = `ask-${Date.now()}`;
      // The same table the clock makes (worker/backup.ts BACKUP_SCHEMA), in case this runs before the clock's first look.
      query('CREATE TABLE IF NOT EXISTS weekly_backup_requests (id TEXT PRIMARY KEY, asked_at TEXT NOT NULL)');
      query(`INSERT INTO weekly_backup_requests (id, asked_at) VALUES ('${id}', '${new Date().toISOString()}')`);
      console.log('Asked. The clock makes the copy at the top of the next hour (within the first 5 minutes), labeled like 2026-11-10-asked-2000 (on a Sunday from 3:00 AM, when the regular copy is still due, that regular copy answers it). Then: node scripts/weekly-backup.mjs list');
    } else if (cmd === 'get' && WEEK.test(week ?? '')) {
      const [header] = query(`SELECT id, week, created_at, bytes, parts FROM weekly_backups WHERE week = '${week}'`);
      if (!header) throw new Error(`No copy for the week of ${week}. Run "list" to see them.`);
      const parts = query(`SELECT part, data FROM weekly_backup_parts WHERE backup_id = '${header.id}' ORDER BY part`);
      const backup = joinParts(header, parts);
      const file = `pickleball-backup-${week}.json`;
      writeFileSync(file, JSON.stringify(backup, null, 1));
      console.log(`Wrote ${file} (made ${when(header.created_at)} Eastern). It has phone numbers: keep it private. Next: docs/RESTORE.md, step 1.`);
    } else {
      console.error('Usage: node scripts/weekly-backup.mjs list\n       node scripts/weekly-backup.mjs get <week, like 2026-11-08 or 2026-11-08-asked-2000>\n       node scripts/weekly-backup.mjs ask');
      process.exit(1);
    }
  } catch (err) {
    console.error(`Could not read the weekly copies: ${err.message}`);
    process.exit(1);
  }
}
