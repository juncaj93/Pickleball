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
  'refund_requests',
  'session_action_tokens',
  'player_devices',
  'admin_audit_log',
  // Version 2 (Zip 50): the switches and price locks, Settings > Alerts, organizer sign-ins. A version 1 file has none of these three:
  // they are emptied and stay empty, exactly as a restore always did.
  'task_log',
  'organizer_alerts',
  'admin_sessions',
  // Version 3 (Zip 56): the tournament tables, parents first. A version 1 or 2 file has none of them: they are emptied and stay empty, exactly
  // as a restore always did (they also went with the group's rows).
  'tournaments',
  'tournament_signups',
  'tournament_level_history',
  'tournament_tickets',
  // Version 4 (Zip 57, Alex): Locked doubles teams and game results, after the tournaments they belong to.
  'tournament_teams',
  'tournament_games',
  // Version 5 (Zip 58, Alex): the tie answers and the saved results (medals, awards).
  'tournament_ties',
  'tournament_results',
];

/** Tables only a version 2 (or later) file has (Zip 50). */
export const V2_TABLES = ['task_log', 'organizer_alerts', 'admin_sessions'];

/** Tables only a version 3 file has (Zip 56). */
export const V3_TABLES = ['tournaments', 'tournament_signups', 'tournament_level_history', 'tournament_tickets'];

/** Tables only a version 4 file has (Zip 57). */
export const V4_TABLES = ['tournament_teams', 'tournament_games'];

/** Tables only a version 5 file has (Zip 58). */
export const V5_TABLES = ['tournament_ties', 'tournament_results'];

/** The file versions this reader takes: 1 (before Zip 50), 2 (before Zip 56), 3 (before Zip 57), 4 (before Zip 58) and 5. */
export const VERSIONS = [1, 2, 3, 4, 5];

/** A table this file's version does not have (it restores empty). */
const notInVersion = (version, t) => (version === 1 && V2_TABLES.includes(t)) || (version < 3 && V3_TABLES.includes(t)) || (version < 4 && V4_TABLES.includes(t)) || (version < 5 && V5_TABLES.includes(t));

/** True when a file was downloaded with the read-only PIN: its PIN is blanked, so a restore would leave nobody able to sign in (F-11). */
export function isReadOnlyDownload(backup) {
  const g = backup?.tables?.groups?.[0];
  return !!g && (g.admin_pin_hash === '' || g.admin_pin_hash === null || g.admin_pin_hash === undefined);
}

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
/**
 * `columns` (optional, Zip 14): the columns each table really has where the SQL will run. A backup column the table does not have is left
 * out instead of failing, so a backup taken with a newer column (sessions.court, migration 0017) still loads into an older layout. Left
 * out: every column is written, as before.
 */
export function backupToSql(backup, columns) {
  if (!backup || backup.format !== 'pickleball-backup' || typeof backup.tables !== 'object' || backup.tables === null) {
    throw new Error('This is not a Pickleball backup file.');
  }
  if (!VERSIONS.includes(backup.version)) throw new Error(`This backup file is version ${backup.version}; this copy of the site reads versions ${VERSIONS.join(', ')}. Use a newer copy of the site.`);
  for (const t of TABLES) {
    // Backups made before the credit pot or refund requests existed lack those tables; they restore as empty.
    if ((t === 'credit_ledger' || t === 'refund_requests') && backup.tables[t] === undefined) continue;
    // A version 1 file has no switches, alert settings or sign-ins (as before Zip 50), a version 1 or 2 file no tournaments (as before
    // Zip 56): they restore as empty.
    if (notInVersion(backup.version, t)) continue;
    if (!Array.isArray(backup.tables[t])) throw new Error(`The backup is missing the ${t} table.`);
  }
  if (backup.tables.groups.length === 0) throw new Error('The backup has no group in it.');

  const out = ['PRAGMA defer_foreign_keys = true;'];
  // Zip 56: a table the place the SQL runs does not have (`columns` says so: a demo copy built from an older layout, like the build before
  // the tournaments) is left out, as a column it does not have is. A real restore passes no `columns`: every table is written.
  const has = (t) => !columns || !columns[t] || columns[t].size > 0;
  // Clear what's there now, children first. Organizer sign-ins go too (they point at the group); a version 2 file brings its own back.
  for (const t of [...TABLES].reverse()) if (has(t)) out.push(`DELETE FROM ${t};`);

  // A canceled game refuses sign-ups, so games go back as not canceled until
  // their players are in, then get canceled again.
  const canceled = backup.tables.sessions.filter((s) => s.status === 'canceled').map((s) => s.id);
  for (const t of TABLES) {
    // A file never restores a table its version does not have, even if something put it in (it would not be what the site wrote).
    if (notInVersion(backup.version, t) || !has(t)) continue;
    for (const row of backup.tables[t] ?? []) {
      const known = columns && columns[t];
      const cols = Object.keys(row).filter((c) => !known || known.has(c));
      for (const c of cols) if (!NAME.test(c)) throw new Error(`Bad column name in backup: ${c}`);
      const values = cols.map((c) => (t === 'sessions' && c === 'status' && row[c] === 'canceled' ? literal('planned') : literal(row[c])));
      out.push(`INSERT INTO ${t} (${cols.join(', ')}) VALUES (${values.join(', ')});`);
    }
  }
  for (const id of canceled) out.push(`UPDATE sessions SET status = 'canceled' WHERE id = ${literal(id)};`);
  return out.join('\n') + '\n';
}
