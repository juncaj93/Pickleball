// Zip 8, item G: the weekly backup copy (worker/backup.ts). Once a week the clock saves the same file Settings > Backup downloads
// into the private database `pickleball-backups`, keeps the newest 8, and never writes to the live database.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createNodeD1 } from '../dev/nodeD1';
import { backupToSql } from '../scripts/restore-backup.mjs';
import { joinParts } from '../scripts/weekly-backup.mjs';
import { backupDue, checkThisTick, KEEP_COPIES, maybeWeeklyBackup, splitParts, weekOf, weeklyBackup } from '../worker/backup';
import { backupTick, knock } from '../worker/cron';
import { DAY, firstSession, HOUR, playerPhone, setupGroup } from './harness';

const store = () => createNodeD1(':memory:', mkdtempSync(join(tmpdir(), 'no-migrations-')));
const at = (iso: string) => Date.parse(iso);

/** Every row of every table, as text. */
function snapshot(db: ReturnType<typeof createNodeD1>): string {
  const tables = (db.raw.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as { name: string }[]).map((t) => t.name);
  return tables.map((t) => `${t}:${JSON.stringify(db.raw.prepare(`SELECT * FROM "${t}" ORDER BY rowid`).all())}`).join('\n');
}

async function busyGroup() {
  const ctx = await setupGroup();
  const s = await firstSession(ctx);
  for (const n of ['Blair', 'Casey', 'Devon']) await (await playerPhone(ctx, n)).call('POST', `/api/sessions/${s.id}/join`, {});
  await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/payment`, { playerId: ctx.byName.Blair, paid: true });
  await ctx.organizer.call('PUT', '/api/admin/group', { name: "Dinks 'n' Drinks 🥒" });
  return ctx;
}

function readCopy(db: ReturnType<typeof createNodeD1>, week: string) {
  const header = db.raw.prepare('SELECT * FROM weekly_backups WHERE week = ?').get(week) as any;
  const parts = db.raw.prepare('SELECT part, data FROM weekly_backup_parts WHERE backup_id = ? ORDER BY part').all(header.id) as any[];
  return joinParts(header, parts);
}

describe('when a copy is due', () => {
  it('Sunday from 3:00 AM Eastern, once a week; at once if there is none or the newest is over 8 days old', () => {
    const sun2am = at('2026-11-08T07:00:00Z'); // Sun Nov 8, 2:00 AM EST
    const sun3am = at('2026-11-08T08:00:00Z');
    const last = { week: '2026-11-01', createdAt: '2026-11-01T09:00:00.000Z' };
    expect(backupDue(sun2am, last)).toBe(false);
    expect(backupDue(sun3am, last)).toBe(true);
    expect(backupDue(sun3am, { week: '2026-11-08', createdAt: '2026-11-08T08:00:00.000Z' })).toBe(false);
    expect(backupDue(at('2026-11-04T17:00:00Z'), last)).toBe(false); // a Wednesday, last copy 3 days old
    expect(backupDue(at('2026-11-04T17:00:00Z'), null)).toBe(true); // the very first copy
    expect(backupDue(at('2026-11-10T17:00:00Z'), last)).toBe(true); // missed Sunday: 9 days old, catch up
    expect(weekOf(at('2026-11-08T08:00:00Z'))).toBe('2026-11-08');
    expect(weekOf(at('2026-11-14T23:00:00Z'))).toBe('2026-11-08'); // Sat 6:00 PM, same week
    expect(weekOf(at('2026-11-08T04:30:00Z'))).toBe('2026-11-01'); // Sat Nov 7, 11:30 PM Eastern: still last week
    // Across both clock changes: 3:00 AM Eastern either way.
    expect(backupDue(at('2026-11-01T07:59:00Z'), { week: '2026-10-25', createdAt: '2026-10-25T07:00:00.000Z' })).toBe(false); // 2:59 AM EST... still before 3
    expect(backupDue(at('2026-11-01T08:00:00Z'), { week: '2026-10-25', createdAt: '2026-10-25T07:00:00.000Z' })).toBe(true);
    expect(backupDue(at('2027-03-14T07:00:00Z'), { week: '2027-03-07', createdAt: '2027-03-07T08:00:00.000Z' })).toBe(true); // 3:00 AM EDT
    expect(backupDue(at('2027-03-14T06:59:00Z'), { week: '2027-03-07', createdAt: '2027-03-07T08:00:00.000Z' })).toBe(false);
  });

  it('only one tick an hour looks at all', () => {
    expect(checkThisTick(at('2026-11-08T08:00:00Z'))).toBe(true);
    expect(checkThisTick(at('2026-11-08T08:04:00Z'))).toBe(true);
    expect(checkThisTick(at('2026-11-08T08:05:00Z'))).toBe(false);
    expect(checkThisTick(at('2026-11-08T08:55:00Z'))).toBe(false);
  });

  it('splits a long text into pieces and nothing is lost', () => {
    const t = 'x'.repeat(250_001);
    const p = splitParts(t);
    expect(p.map((x) => x.length)).toEqual([90_000, 90_000, 70_001]);
    expect(p.join('')).toBe(t);
    expect(splitParts('')).toEqual(['']);
    // An emoji right on a piece boundary stays whole.
    const e = 'x'.repeat(89_999) + '😀' + 'y';
    const q = splitParts(e);
    expect(q[0].length).toBe(89_999);
    expect(q.join('')).toBe(e);
    expect(q.every((x) => !/[\ud800-\udbff]$/.test(x))).toBe(true);
  });
});

describe('the copy', () => {
  it('is the same file Settings > Backup downloads, restores to the same rows, and never writes to the live database', async () => {
    const ctx = await busyGroup();
    const backups = store();
    const before = snapshot(ctx.app.db);
    const now = at('2026-11-08T08:00:00Z');
    const r = await weeklyBackup(ctx.app.db, backups, now);
    expect(r).toMatchObject({ made: true, week: '2026-11-08', kept: 1 });
    expect(snapshot(ctx.app.db)).toBe(before); // the live database is untouched
    const copy = readCopy(backups, '2026-11-08');
    ctx.app.now = now;
    const file = JSON.parse((await ctx.organizer.call('GET', '/api/admin/backup')).text);
    expect(copy).toEqual(file);
    expect(copy.tables.players.length).toBeGreaterThan(5);
    expect(copy.groupName).toBe("Dinks 'n' Drinks 🥒");
    // Restore it into an empty database: every backed-up row comes back.
    const fresh = createNodeD1(':memory:');
    fresh.raw.exec(backupToSql(copy));
    for (const t of Object.keys(copy.tables)) {
      expect(fresh.raw.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all().map((x) => ({ ...x })), t).toEqual(ctx.app.db.raw.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all().map((x) => ({ ...x })));
    }
  });

  it('a big group is saved in several pieces and joins back exactly', async () => {
    const ctx = await busyGroup();
    // Lots of Activity: well over one 90,000-character piece.
    const ins = ctx.app.db.raw.prepare("INSERT INTO admin_audit_log (id, group_id, session_id, actor_label, action, details_json, created_at) SELECT ?, id, NULL, 'organizer', 'test', ?, ? FROM groups");
    for (let i = 0; i < 1500; i++) ins.run(`a-${i}`, JSON.stringify({ note: 'x'.repeat(200), i }), new Date(at('2026-10-01T00:00:00Z') + i * 1000).toISOString());
    const backups = store();
    const r = await weeklyBackup(ctx.app.db, backups, at('2026-11-08T08:00:00Z'));
    expect(r.made && r.parts).toBeGreaterThan(3);
    const copy = readCopy(backups, '2026-11-08');
    expect(copy.tables.admin_audit_log.length).toBeGreaterThanOrEqual(1500);
    // A missing piece is caught, not restored half-way.
    const header = backups.raw.prepare('SELECT * FROM weekly_backups').get() as any;
    const parts = backups.raw.prepare('SELECT part, data FROM weekly_backup_parts ORDER BY part').all() as any[];
    expect(() => joinParts(header, parts.slice(1))).toThrow('incomplete');
  });

  it('one copy a week (a second tick the same Sunday adds nothing), the newest 8 kept, older ones deleted', async () => {
    const ctx = await busyGroup();
    const backups = store();
    let now = at('2026-11-08T08:00:00Z');
    for (let w = 0; w < 11; w++) {
      const r = await weeklyBackup(ctx.app.db, backups, now);
      expect(r.made, `week ${w}`).toBe(true);
      expect((await weeklyBackup(ctx.app.db, backups, now + HOUR)).made).toBe(false);
      now += 7 * DAY;
    }
    const weeks = (backups.raw.prepare('SELECT week FROM weekly_backups ORDER BY created_at').all() as { week: string }[]).map((x) => x.week);
    expect(weeks).toHaveLength(KEEP_COPIES);
    expect(weeks[0]).toBe('2026-11-29');
    expect(weeks[KEEP_COPIES - 1]).toBe('2027-01-17');
    // No orphan pieces left from the deleted copies.
    const orphans = backups.raw.prepare('SELECT COUNT(*) AS n FROM weekly_backup_parts WHERE backup_id NOT IN (SELECT id FROM weekly_backups)').get() as { n: number };
    expect(orphans.n).toBe(0);
  });

  it('the clock: looks once an hour, a failed copy never stops the knock and is tried again the next hour', async () => {
    const ctx = await busyGroup();
    const backups = store();
    expect(await maybeWeeklyBackup(ctx.app.db, backups, at('2026-11-08T08:10:00Z'))).toEqual({ made: false, reason: 'not this tick' });
    expect(await maybeWeeklyBackup(undefined, backups, at('2026-11-08T08:00:00Z'))).toEqual({ made: false, reason: 'not set up' });
    const broken = { prepare: () => { throw new Error('backup db down'); }, batch: async () => [] } as any;
    expect(((await maybeWeeklyBackup(ctx.app.db, broken, at('2026-11-08T08:00:00Z'))) as { reason: string }).reason).toMatch(/^failed: backup db down/);
    expect((await maybeWeeklyBackup(ctx.app.db, backups, at('2026-11-08T09:00:00Z'))).made).toBe(true);
    // The knock itself is independent of the copy.
    const calls: string[] = [];
    const status = await knock({ SITE_URL: 'https://x.example', CRON_SECRET: 's' }, (async (u: string) => {
      calls.push(u);
      return new Response('{}', { status: 200 });
    }) as typeof fetch);
    expect(status).toBe(200);
    expect(calls).toEqual(['https://x.example/api/cron/tick']);
    await expect(backupTick({ SITE_URL: '', CRON_SECRET: '', DB: ctx.app.db, BACKUP: broken }, at('2026-11-08T10:00:00Z'))).resolves.toBeUndefined();
  });
});
