// Zip 19, item 1: the restore test (scripts/restore-test.ts, docs/RESTORE_TEST.md). It passes a good backup, fails a broken one with
// the exact problem, and can only ever run two read-only Cloudflare commands.
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createNodeD1 } from '../dev/nodeD1';
import { backupObject } from '../server/backupData';
import { BACKUP_SCHEMA, weeklyBackup } from '../worker/backup';
import { compare, fileSource, loadExport, type Backup } from '../scripts/restore-test-lib';
import { main, readOnlyCommand, type Runner, wrangler } from '../scripts/restore-test';
import { firstSession, playerPhone, setupGroup } from './harness';

const SUN = Date.parse('2026-11-15T08:00:00Z');

async function busyGroup() {
  const ctx = await setupGroup();
  const s = await firstSession(ctx);
  for (const n of ['Blair', 'Casey', 'Devon']) await (await playerPhone(ctx, n)).call('POST', `/api/sessions/${s.id}/join`, {});
  await ctx.organizer.call('POST', `/api/admin/sessions/${s.id}/payment`, { playerId: ctx.byName.Blair, paid: true });
  // A canceled game with people in it (its rows can only go back in before it is canceled).
  const later = (await ctx.organizer.call('GET', '/api/admin/dashboard')).data.sessions.find((x: { id: string }) => x.id !== s.id);
  await (await playerPhone(ctx, 'Emery')).call('POST', `/api/sessions/${later.id}/join`, {});
  expect((await ctx.organizer.call('POST', `/api/admin/sessions/${later.id}/decision`, { decision: 'cancel', confirm: true })).status).toBe(200);
  // A feature switch row, like live has (task_log, not in a backup).
  ctx.app.db.raw.prepare("INSERT INTO task_log (id, group_id, session_id, task, kind, detail, at) SELECT 'sw1', id, NULL, 'card_cleanup_on', 'mark', NULL, '2026-11-01T00:00:00Z' FROM groups").run();
  return ctx;
}

/** What `wrangler d1 export` gives: every table's CREATE and its rows as INSERTs. */
function exportSql(db: ReturnType<typeof createNodeD1>): string {
  const out = ['PRAGMA defer_foreign_keys=TRUE;'];
  const objs = db.raw.prepare("SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND name <> '_migrations' ORDER BY type = 'table' DESC, rowid").all() as { type: string; name: string; sql: string }[];
  for (const o of objs.filter((x) => x.type === 'table')) out.push(`${o.sql};`);
  const lit = (v: unknown) => (v === null ? 'NULL' : typeof v === 'number' || typeof v === 'bigint' ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
  for (const o of objs.filter((x) => x.type === 'table')) {
    for (const r of db.raw.prepare(`SELECT * FROM "${o.name}"`).all() as Record<string, unknown>[]) out.push(`INSERT INTO "${o.name}" (${Object.keys(r).map((c) => `"${c}"`).join(',')}) VALUES(${Object.values(r).map(lit).join(',')});`);
  }
  for (const o of objs.filter((x) => x.type !== 'table')) out.push(`${o.sql};`);
  return out.join('\n');
}

describe('the restore test', () => {
  it('passes a good backup: every row and value, money and the 21 integrity checks match, and it says which switches a restore resets', async () => {
    const ctx = await busyGroup();
    const source = loadExport(exportSql(ctx.app.db));
    const backup = JSON.parse(JSON.stringify(await backupObject(source, 'x', new Date(SUN).toISOString()))) as Backup;
    const r = compare('test', source, backup);
    expect(r.checks.filter((c) => !c.ok)).toEqual([]);
    expect(r.ok).toBe(true);
    const text = r.checks.map((c) => c.line).join('\n');
    expect(text).toMatch(/rows: all \d+ rows in 10 tables match the source, every value/);
    expect(text).toMatch(/money matches: finalized games 0 of \d+/);
    expect(text).toMatch(/integrity checks: all 21 the same on the copy as on the source \(19 problem checks/);
    expect(r.notes.join('\n')).toContain('1 switch rows on the source (card_cleanup_on) are not in a backup');
    // No names or phone numbers in what it prints.
    for (const p of backup.tables.players as { display_name: string; phone_number: string | null }[]) {
      expect(text + r.notes.join('')).not.toContain(p.display_name);
      if (p.phone_number) expect(text).not.toContain(p.phone_number);
    }
  });

  it('fails a broken backup and says exactly what is wrong: a missing row, a changed amount, a copy that will not load', async () => {
    const ctx = await busyGroup();
    const source = loadExport(exportSql(ctx.app.db));
    const good = JSON.parse(JSON.stringify(await backupObject(source, 'x', new Date(SUN).toISOString()))) as Backup;
    const clone = () => JSON.parse(JSON.stringify(good)) as Backup;

    const missing = clone();
    const seats = missing.tables.session_players.length;
    missing.tables.session_players.pop();
    const r1 = compare('missing', source, missing);
    expect(r1.ok).toBe(false);
    expect(r1.checks.map((c) => c.line)).toContain(`session_players: ${seats} rows in the source, ${seats - 1} in the copy`);

    const changed = clone();
    const paid = changed.tables.session_players.find((r) => r.payment_status === 'paid')!;
    paid.payment_amount_cents = 1300;
    const r2 = compare('changed', source, changed);
    expect(r2.ok).toBe(false);
    expect(r2.checks.find((c) => !c.ok && c.line.startsWith('session_players: 1 values differ'))?.line).toContain('column payment_amount_cents');
    expect(r2.checks.find((c) => !c.ok && c.line.startsWith('money differs'))?.line).toContain('paid_cents source 1400, copy 1300');

    const broken = clone();
    broken.tables.session_players[0].session_id = 'no-such-game';
    const r3 = compare('broken', source, broken);
    expect(r3.ok).toBe(false);
    expect(r3.checks[0].line).toMatch(/^restore FAILED: /);
  });

  it('a weekly copy: reads only, checks its own saved counts, and a file from Settings > Backup works the same way', async () => {
    const ctx = await busyGroup();
    const backups = createNodeD1(':memory:', mkdtempSync(join(tmpdir(), 'no-migrations-')));
    for (const sql of BACKUP_SCHEMA) await backups.prepare(sql).run();
    await weeklyBackup(ctx.app.db, backups, SUN);
    const calls: string[][] = [];
    const run: Runner = (args) => {
      calls.push(args);
      expect(readOnlyCommand(args)).toBe(true);
      return JSON.stringify([{ results: backups.raw.prepare(args[6]).all() }]);
    };
    const lines: string[] = [];
    expect(await main(['--', '--weekly'], run, (s) => lines.push(s))).toBe(0);
    expect(lines[0]).toMatch(/^PASS {2}weekly copy 2026-11-15 \(made Sun, Nov 15, 3:00 AM Eastern/);
    expect(lines.join('\n')).toContain("rows: the weekly copy's own saved counts match");
    expect(lines.at(-1)).toBe('RESULT: PASS (1 of 1). Nothing on Cloudflare was changed.');
    expect(calls.map((c) => c.slice(0, 3).join(' '))).toEqual(['d1 execute pickleball-backups', 'd1 execute pickleball-backups']);
    // A downloaded backup file, no Cloudflare at all.
    const file = join(mkdtempSync(join(tmpdir(), 'rt-')), 'pickleball-backup.json');
    writeFileSync(file, JSON.stringify(await backupObject(ctx.app.db, 'x', new Date(SUN).toISOString())));
    const out2: string[] = [];
    const none: Runner = () => {
      throw new Error('no Cloudflare call expected');
    };
    expect(await main(['--file', file], none, (s) => out2.push(s))).toBe(0);
    expect(fileSource(JSON.parse(readFileSync(file, 'utf8'))).raw.prepare('SELECT COUNT(*) AS n FROM players').get()).toEqual({ n: 6 });
  });

  it('live: one read-only export, deleted afterwards; both the download format and the new weekly format pass', async () => {
    const ctx = await busyGroup();
    const sql = exportSql(ctx.app.db);
    const calls: string[][] = [];
    let exported = '';
    const run: Runner = (args) => {
      calls.push(args);
      exported = args[5];
      writeFileSync(args[5], sql);
      return '';
    };
    const lines: string[] = [];
    expect(await main(['--live'], run, (s) => lines.push(s))).toBe(0);
    expect(calls).toEqual([['d1', 'export', 'pickleball', '--remote', '--output', exported]]);
    expect(() => readFileSync(exported)).toThrow(); // the export (phone numbers) is gone
    expect(lines.filter((l) => /^(PASS|FAIL) /.test(l))).toHaveLength(2);
    expect(lines.at(-1)).toBe('RESULT: PASS (2 of 2). Nothing on Cloudflare was changed.');
  });

  it('can never write to Cloudflare: only the two read commands get through', () => {
    const ok = [
      ['d1', 'export', 'pickleball', '--remote', '--output', '/tmp/x/live.sql'],
      ['d1', 'execute', 'pickleball-backups', '--remote', '--json', '--command', 'SELECT week FROM weekly_backups'],
    ];
    const refused = [
      ['d1', 'execute', 'pickleball', '--remote', '--json', '--command', 'SELECT 1'], // never a command against live
      ['d1', 'execute', 'pickleball-backups', '--remote', '--file', 'restore.sql'],
      ['d1', 'execute', 'pickleball-backups', '--remote', '--json', '--command', 'DELETE FROM weekly_backups'],
      ['d1', 'execute', 'pickleball-backups', '--remote', '--json', '--command', 'SELECT 1; DROP TABLE weekly_backups'],
      ['d1', 'execute', 'pickleball-backups', '--remote', '--json', '--command', 'INSERT INTO weekly_backups SELECT * FROM weekly_backups'],
      ['d1', 'execute', 'pickleball-backups', '--remote', '--json', '--command', 'SELECT 1 RETURNING 1'],
      ['d1', 'execute', 'pickleball-backups', '--remote', '--json', '--command', 'WITH x AS (SELECT 1) SELECT * FROM x'],
      ['d1', 'export', 'pickleball-preview', '--remote', '--output', '/tmp/x.sql'],
      ['d1', 'export', 'pickleball', '--remote', '--output', '/tmp/x.sql', '--table', 'players'],
      ['d1', 'time-travel', 'restore', 'pickleball', '--bookmark=x'],
      ['d1', 'migrations', 'apply', 'pickleball', '--remote'],
      ['pages', 'deploy', 'dist'],
    ];
    for (const a of ok) expect(readOnlyCommand(a), a.join(' ')).toBe(true);
    for (const a of refused) {
      expect(readOnlyCommand(a), a.join(' ')).toBe(false);
      expect(() => wrangler(() => 'ran', a)).toThrow('Refused, not a read-only command');
    }
    // The command line is reached in one place only: through wrangler(), which checks first.
    const src = readFileSync(join(process.cwd(), 'scripts', 'restore-test.ts'), 'utf8');
    expect(src.match(/\brun\(args\)/g)).toHaveLength(1);
    expect(src.match(/execFileSync\(/g)).toHaveLength(1);
    expect(src).not.toMatch(/time-travel|migrations apply/);
  });
});
