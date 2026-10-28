#!/usr/bin/env node
// Turn a backup file (Settings > Backup > Download backup file) into SQL that
// puts the site's data back exactly as it was. Steps: docs/RESTORE.md.
//
//   node scripts/restore-backup.mjs pickleball-backup-2026-11-03.json > restore.sql
//
// The SQL first clears the current data (and signs out organizer devices),
// then puts every row from the backup back.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { backupToSql, TABLES } from './backup-sql.mjs';

export { backupToSql, TABLES };

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const file = process.argv[2];
  if (!file) {
    console.error('Usage: node scripts/restore-backup.mjs <backup file.json> > restore.sql');
    process.exit(1);
  }
  try {
    const backup = JSON.parse(readFileSync(file, 'utf8'));
    process.stdout.write(backupToSql(backup));
    const counts = TABLES.map((t) => `${t}: ${backup.tables[t].length}`).join(', ');
    const when = new Date(backup.createdAt).toLocaleString('en-US', {
      timeZone: 'America/Detroit', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    });
    console.error(`Backup made ${when} Eastern (${backup.groupName}). Rows: ${counts}`);
  } catch (err) {
    console.error(`Could not read the backup: ${err.message}`);
    process.exit(1);
  }
}
