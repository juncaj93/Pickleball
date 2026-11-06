// What a backup file holds: every table needed to rebuild the site's data, parents before children (the order a restore puts them back
// in). Used by Settings > Backup (GET /api/admin/backup) and by the weekly copy the clock makes (worker/backup.ts), so both produce the
// same file, restored the same way (scripts/restore-backup.mjs, docs/RESTORE.md). Sign-in records, wrong-PIN counts and spam counters
// are left out: they are short-lived, and a restore signs everyone out. Reads only.
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
] as const;

export interface BackupObject {
  format: 'pickleball-backup';
  version: 1;
  createdAt: string;
  groupName: string;
  tables: Record<string, Record<string, unknown>[]>;
}

/** Every backed-up table, read in one batch, so the file is one consistent moment (no row without its parent). */
export async function backupObject(db: D1Database, groupName: string, nowIso: string): Promise<BackupObject> {
  const read = await db.batch(BACKUP_TABLES.map((t) => db.prepare(`SELECT * FROM ${t} ORDER BY rowid`)));
  const tables: Record<string, Record<string, unknown>[]> = {};
  BACKUP_TABLES.forEach((t, i) => (tables[t] = read[i].results as Record<string, unknown>[]));
  return { format: 'pickleball-backup', version: 1, createdAt: nowIso, groupName, tables };
}
