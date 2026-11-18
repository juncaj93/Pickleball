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

import { backupToSql, isReadOnlyDownload, TABLES, V2_TABLES, V3_TABLES } from './backup-sql.mjs';

export { backupToSql, TABLES };

/**
 * The summary line printed after the SQL (to the error stream, so restore.sql holds only SQL). Zip 50: a table a file does not have
 * counts as 0 (a file from before Oct 29 has no credit_ledger or refund_requests and used to fail here, Audit A-21 / C F-12), and a
 * version 1 file says what it cannot bring back.
 */
export function summaryLine(backup) {
  const counts = TABLES.map((t) => `${t}: ${(backup.tables[t] ?? []).length}`).join(', ');
  const when = new Date(backup.createdAt).toLocaleString('en-US', {
    timeZone: 'America/Detroit', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
  const old = backup.version === 1
    ? ` NOTE: this is an old (version 1) file: it has no ${V2_TABLES.join(', ')}, so every Feature switch, price lock, Settings > Alerts choice and organizer sign-in comes back empty (docs/RESTORE.md, Plan B, says what to redo).`
    : '';
  const noTour = backup.version < 3 ? ` NOTE: a version ${backup.version} file has no ${V3_TABLES.join(', ')}: tournaments come back empty.` : '';
  return `Backup made ${when} Eastern (${backup.groupName}), file version ${backup.version}. Rows: ${counts}.${old}${noTour}`;
}

/** Zip 50 (Audit C F-11): a file downloaded with the read-only PIN has no PIN in it; restoring it would leave nobody able to sign in. */
export const READ_ONLY_REFUSED = 'This file was downloaded with the read-only PIN, so it has no organizer PIN in it: after a restore nobody could sign in. Use a file downloaded with the real PIN, or a weekly copy.';

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const file = process.argv[2];
  if (!file) {
    console.error('Usage: node scripts/restore-backup.mjs <backup file.json> > restore.sql');
    process.exit(1);
  }
  try {
    const backup = JSON.parse(readFileSync(file, 'utf8'));
    const sql = backupToSql(backup);
    if (isReadOnlyDownload(backup)) throw new Error(READ_ONLY_REFUSED);
    process.stdout.write(sql);
    console.error(summaryLine(backup));
  } catch (err) {
    console.error(`Could not read the backup: ${err.message}`);
    process.exit(1);
  }
}
