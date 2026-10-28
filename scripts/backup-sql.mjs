// Turns a backup file's contents into SQL that puts the data back. Plain
// JavaScript with no Node imports, so the restore script and the organizer's
// in-browser demo copy share it.

/** Parents before children: the order rows go back in. Removal runs in reverse. */
export const TABLES = [
  'groups',
  'players',
  'sessions',
  'session_players',
  'credits',
  'credit_ledger',
  'session_action_tokens',
  'player_devices',
  'admin_audit_log',
];

function literal(v) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new Error(`Bad number in backup: ${v}`);
    return String(v);
  }
  if (typeof v === 'boolean') return v ? '1' : '0';
  if (typeof v === 'string') return `'${v.replace(/'/g, "''")}'`;
  throw new Error(`Unexpected value in backup: ${JSON.stringify(v)}`);
}

const NAME = /^[a-z_][a-z0-9_]*$/;

/** The backup as SQL statements, one per line. Throws if the file isn't a backup. */
export function backupToSql(backup) {
  if (!backup || backup.format !== 'pickleball-backup' || backup.version !== 1 || typeof backup.tables !== 'object') {
    throw new Error('This is not a Pickleball Bros backup file.');
  }
  for (const t of TABLES) {
    // Backups made before the credit pot existed have no credit_ledger; that restores as empty.
    if (t === 'credit_ledger' && backup.tables[t] === undefined) continue;
    if (!Array.isArray(backup.tables[t])) throw new Error(`The backup is missing the ${t} table.`);
  }
  if (backup.tables.groups.length === 0) throw new Error('The backup has no group in it.');

  const out = ['PRAGMA defer_foreign_keys = true;'];
  // Clear what's there now. Organizer sign-ins go too (they point at the group).
  for (const t of ['admin_sessions', ...[...TABLES].reverse()]) out.push(`DELETE FROM ${t};`);

  // A canceled game refuses sign-ups, so games go back as not canceled until
  // their players are in, then get canceled again.
  const canceled = backup.tables.sessions.filter((s) => s.status === 'canceled').map((s) => s.id);
  for (const t of TABLES) {
    for (const row of backup.tables[t] ?? []) {
      const cols = Object.keys(row);
      for (const c of cols) if (!NAME.test(c)) throw new Error(`Bad column name in backup: ${c}`);
      const values = cols.map((c) => (t === 'sessions' && c === 'status' && row[c] === 'canceled' ? literal('planned') : literal(row[c])));
      out.push(`INSERT INTO ${t} (${cols.join(', ')}) VALUES (${values.join(', ')});`);
    }
  }
  for (const id of canceled) out.push(`UPDATE sessions SET status = 'canceled' WHERE id = ${literal(id)};`);
  return out.join('\n') + '\n';
}
