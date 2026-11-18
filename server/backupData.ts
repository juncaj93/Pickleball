// What a backup file holds: every table needed to rebuild the site's data, parents before children (the order a restore puts them back
// in). Used by Settings > Backup (GET /api/admin/backup) and by the weekly copy the clock makes (worker/backup.ts), so both produce the
// same file, restored the same way (scripts/restore-backup.mjs, docs/RESTORE.md). Wrong-PIN counts and spam counters are left out:
// they are short-lived. Reads only.
//
// Version 2 (Zip 50, Audit C M-2): the file also holds task_log (every Settings feature switch, the price locks of finalized games,
// venue months marked paid, the Christmas choice, hidden canceled games, "Do this now" taps and the "already sent" marks of alerts),
// organizer_alerts (Settings > Alerts) and admin_sessions (organizer sign-ins, stored as hashes only), so a restore gives back the site
// exactly as it was. A version 1 file (before Zip 50) still restores: those three come back empty, as they always did.
//
// Version 3 (Zip 56, Alex): the four tournament tables too (tournaments, sign-ups, the level history and the tickets, which hold cash the
// organizer confirmed). A version 1 or 2 file still restores: the tournament tables come back empty, as they always did.
import type { D1Database } from './db';

export const BACKUP_TABLES = [
  'groups',
  'players',
  'sessions',
  'session_players',
  'credits',
  'credit_ledger',
  'refund_requests',
  'session_action_tokens',
  'player_devices',
  'admin_audit_log',
  // Version 2 (Zip 50). After sessions and groups, which they point at.
  'task_log',
  'organizer_alerts',
  'admin_sessions',
  // Version 3 (Zip 56, Alex: the tournament tables join the file once tickets hold cash). After groups and players, parents first.
  'tournaments',
  'tournament_signups',
  'tournament_level_history',
  'tournament_tickets',
] as const;

/**
 * Rows a backup leaves out of a table (Zip 50 review): read-only sign-ins. Their id starts with "ro:" and a short fingerprint of the
 * read-only PIN (server/viewOnly.ts), which must never leave the database; a helper simply signs in again after a restore. Used by
 * the download here and by every read of the weekly copy (worker/backup.ts), so both files stay the same.
 */
export const BACKUP_WHERE: Partial<Record<(typeof BACKUP_TABLES)[number], string>> = {
  admin_sessions: "id NOT LIKE 'ro:%'",
};
/** The WHERE condition for a table ("1" when it keeps every row). */
export const backupWhere = (t: string): string => (BACKUP_WHERE as Record<string, string>)[t] ?? '1';

/**
 * The file's version: 2 since Zip 50 (task_log, organizer_alerts and admin_sessions added), 3 since Zip 56 (the four tournament tables).
 * The reader takes 1, 2 and 3.
 */
export const BACKUP_VERSION = 3;

export interface BackupObject {
  format: 'pickleball-backup';
  version: 1 | 2 | 3;
  createdAt: string;
  groupName: string;
  tables: Record<string, Record<string, unknown>[]>;
}

/** Every backed-up table, read in one batch, so the file is one consistent moment (no row without its parent). */
export async function backupObject(db: D1Database, groupName: string, nowIso: string): Promise<BackupObject> {
  const read = await db.batch(BACKUP_TABLES.map((t) => db.prepare(`SELECT * FROM ${t} WHERE ${backupWhere(t)} ORDER BY rowid`)));
  const tables: Record<string, Record<string, unknown>[]> = {};
  BACKUP_TABLES.forEach((t, i) => (tables[t] = read[i].results as Record<string, unknown>[]));
  return { format: 'pickleball-backup', version: BACKUP_VERSION, createdAt: nowIso, groupName, tables };
}
