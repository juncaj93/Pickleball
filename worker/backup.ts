// The weekly backup copy (Zip 8). The 5-minute clock (worker/cron.ts) checks once an hour whether a copy is due; once a week
// (Sunday from 3:00 AM Eastern, or at once if the last copy is more than 8 days old) it reads the live database and saves the
// same file Settings > Backup downloads (server/backupData.ts) into a separate private database, `pickleball-backups`.
// The last 8 copies are kept; older ones are deleted. Restore: docs/RESTORE.md ("Weekly copies").
//
// - The live database is only READ here (SELECTs). Every write goes to the backup database.
// - The copy has phone numbers. It lives only in Alex's Cloudflare account (a D1 database has no public address), never in git.
// - Free: D1 is on the free plan (5 GB in all, this is well under 1 MB a week), and it rides on the existing cron trigger
//   (the free plan's 5 cron triggers are all in use, so a new one was not an option).
import type { D1Database } from '../server/db';
import { backupObject } from '../server/backupData';
import { localParts } from '../shared/time';

export const BACKUP_TZ = 'America/Detroit';
/** How many weekly copies stay. */
export const KEEP_COPIES = 8;
/** Each copy is stored in pieces of at most this many characters (well under D1's size limits for one value). */
export const PART_CHARS = 90_000;
/** A copy is due on Sunday from this Eastern hour... */
export const BACKUP_HOUR = 3;
const DAY_MS = 86_400_000;

export const BACKUP_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS weekly_backups (
     id TEXT PRIMARY KEY,
     week TEXT NOT NULL UNIQUE,
     created_at TEXT NOT NULL,
     bytes INTEGER NOT NULL,
     parts INTEGER NOT NULL,
     rows_json TEXT NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS weekly_backup_parts (
     backup_id TEXT NOT NULL,
     part INTEGER NOT NULL,
     data TEXT NOT NULL,
     PRIMARY KEY (backup_id, part)
   )`,
];

/** The Eastern date ("2026-11-08") of the Sunday that starts the week `nowMs` is in: one copy per week. */
export function weekOf(nowMs: number): string {
  const p = localParts(nowMs, BACKUP_TZ);
  const d = new Date(Date.UTC(p.year, p.month - 1, p.day - p.weekday));
  return d.toISOString().slice(0, 10);
}

/**
 * Is a copy due? Sunday from 3:00 AM Eastern when this week has none yet; or any time when the newest copy is more than 8 days old
 * (or there is none: the first copy is made within the hour after this is deployed).
 */
export function backupDue(nowMs: number, newest: { week: string; createdAt: string } | null): boolean {
  if (!newest) return true;
  if (nowMs - Date.parse(newest.createdAt) > 8 * DAY_MS) return true;
  const p = localParts(nowMs, BACKUP_TZ);
  return p.weekday === 0 && p.hour >= BACKUP_HOUR && newest.week !== weekOf(nowMs);
}

/** Only one tick an hour looks (minute 0 to 4 Eastern), so the other ticks never touch either database. */
export function checkThisTick(nowMs: number): boolean {
  return localParts(nowMs, BACKUP_TZ).minute < 5;
}

/** Split a long text into pieces of at most `size` characters. */
export function splitParts(text: string, size = PART_CHARS): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < text.length) {
    let end = Math.min(i + size, text.length);
    // Never cut an emoji (a two-part character) in half: end the piece one character early instead.
    const code = text.charCodeAt(end - 1);
    if (end < text.length && code >= 0xd800 && code <= 0xdbff) end--;
    out.push(text.slice(i, end));
    i = end;
  }
  return out.length ? out : [''];
}

export type BackupResult = { made: false; reason: string } | { made: true; week: string; bytes: number; parts: number; rows: Record<string, number>; kept: number };

/**
 * Make this week's copy if one is due. `live` is only read. `store` is the backup database. `force` skips the "is it due" check
 * (used by tests and by a manual run).
 */
export async function weeklyBackup(live: D1Database, store: D1Database, nowMs: number, opts: { force?: boolean } = {}): Promise<BackupResult> {
  for (const sql of BACKUP_SCHEMA) await store.prepare(sql).run();
  const newest = await store
    .prepare('SELECT week, created_at AS createdAt FROM weekly_backups ORDER BY created_at DESC LIMIT 1')
    .first<{ week: string; createdAt: string }>();
  if (!opts.force && !backupDue(nowMs, newest)) return { made: false, reason: 'not due' };
  const week = weekOf(nowMs);
  if (newest?.week === week && opts.force) return { made: false, reason: 'this week already has a copy' };
  const group = await live.prepare('SELECT name FROM groups LIMIT 1').first<{ name: string }>();
  if (!group) return { made: false, reason: 'no group' };
  const nowIso = new Date(nowMs).toISOString();
  const backup = await backupObject(live, group.name, nowIso);
  const text = JSON.stringify(backup);
  const parts = splitParts(text);
  const rows = Object.fromEntries(Object.entries(backup.tables).map(([t, r]) => [t, r.length]));
  const id = crypto.randomUUID();
  // One transaction: the copy is all there or not there. `week` is unique, so two ticks at once can never save two copies.
  await store.batch([
    store.prepare('INSERT INTO weekly_backups (id, week, created_at, bytes, parts, rows_json) VALUES (?, ?, ?, ?, ?, ?)').bind(id, week, nowIso, text.length, parts.length, JSON.stringify(rows)),
    ...parts.map((data, i) => store.prepare('INSERT INTO weekly_backup_parts (backup_id, part, data) VALUES (?, ?, ?)').bind(id, i, data)),
  ]);
  // Keep the newest 8; delete the rest (their pieces first).
  const keep = `SELECT id FROM weekly_backups ORDER BY created_at DESC LIMIT ${KEEP_COPIES}`;
  await store.batch([
    store.prepare(`DELETE FROM weekly_backup_parts WHERE backup_id NOT IN (${keep})`),
    store.prepare(`DELETE FROM weekly_backups WHERE id NOT IN (${keep})`),
  ]);
  const kept = (await store.prepare('SELECT COUNT(*) AS n FROM weekly_backups').first<{ n: number }>())?.n ?? 0;
  return { made: true, week, bytes: text.length, parts: parts.length, rows, kept: Number(kept) };
}

/** The clock's hourly look: never throws (a failed copy is retried on the next hourly look). */
export async function maybeWeeklyBackup(live: D1Database | undefined, store: D1Database | undefined, nowMs: number): Promise<BackupResult> {
  if (!live || !store) return { made: false, reason: 'not set up' };
  if (!checkThisTick(nowMs)) return { made: false, reason: 'not this tick' };
  try {
    return await weeklyBackup(live, store, nowMs);
  } catch (err) {
    return { made: false, reason: `failed: ${err instanceof Error ? err.message : 'unknown'}` };
  }
}
