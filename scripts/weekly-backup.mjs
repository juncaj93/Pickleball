#!/usr/bin/env node
// The weekly backup copies (Zip 8, worker/backup.ts) live in the private Cloudflare database `pickleball-backups`.
// This lists them, or turns one back into a normal backup file (the same file Settings > Backup downloads), which
// docs/RESTORE.md then restores. Needs the same setup as a deploy (a terminal in this folder, signed in to Cloudflare).
//
//   node scripts/weekly-backup.mjs list
//   node scripts/weekly-backup.mjs get 2026-11-08        (the week, as "list" shows it; writes pickleball-backup-2026-11-08.json)
//
// The file it writes has phone numbers: keep it private, never put it in git.
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const DB = 'pickleball-backups';

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

function query(sql) {
  const out = execFileSync('npx', ['wrangler', 'd1', 'execute', DB, '--remote', '--json', '--command', sql], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'inherit'] });
  return JSON.parse(out.slice(out.indexOf('[')))[0].results;
}

const when = (iso) => new Date(iso).toLocaleString('en-US', { timeZone: 'America/Detroit', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [cmd, week] = process.argv.slice(2);
  try {
    if (cmd === 'list') {
      const rows = query('SELECT week, created_at, bytes, rows_json FROM weekly_backups ORDER BY created_at DESC');
      if (!rows.length) console.log('No weekly copies yet.');
      for (const r of rows) {
        const n = JSON.parse(r.rows_json);
        console.log(`${r.week}  made ${when(r.created_at)} Eastern  players ${n.players}, games ${n.sessions}, seats ${n.session_players}, credit entries ${n.credit_ledger}`);
      }
    } else if (cmd === 'get' && /^\d{4}-\d{2}-\d{2}$/.test(week ?? '')) {
      const [header] = query(`SELECT id, week, created_at, bytes, parts FROM weekly_backups WHERE week = '${week}'`);
      if (!header) throw new Error(`No copy for the week of ${week}. Run "list" to see them.`);
      const parts = query(`SELECT part, data FROM weekly_backup_parts WHERE backup_id = '${header.id}' ORDER BY part`);
      const backup = joinParts(header, parts);
      const file = `pickleball-backup-${week}.json`;
      writeFileSync(file, JSON.stringify(backup, null, 1));
      console.log(`Wrote ${file} (made ${when(header.created_at)} Eastern). It has phone numbers: keep it private. Next: docs/RESTORE.md, step 1.`);
    } else {
      console.error('Usage: node scripts/weekly-backup.mjs list\n       node scripts/weekly-backup.mjs get <week, like 2026-11-08>');
      process.exit(1);
    }
  } catch (err) {
    console.error(`Could not read the weekly copies: ${err.message}`);
    process.exit(1);
  }
}
