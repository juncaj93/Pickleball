// Zip 19: the deploy-export saver (scripts/deploy-export.mjs). Tests run against a local stand-in for pickleball-backups only:
// the real saver runs after a real deploy, never from tests.
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createNodeD1 } from '../dev/nodeD1';
import { joinExport, KEEP_EXPORTS, looksLikeExport, PIECE_CHARS, pieces, save, type Runner } from '../scripts/deploy-export.mjs';

/** A stand-in for `wrangler d1 execute pickleball-backups --remote ...`, on a local throwaway database. */
function fakeBackups() {
  const db = createNodeD1(':memory:', mkdtempSync(join(tmpdir(), 'no-migrations-')));
  const calls: string[][] = [];
  const run: Runner = (args) => {
    calls.push(args);
    if (args[0] === '--file') {
      db.raw.exec(readFileSync(args[1], 'utf8'));
      return '';
    }
    if (args[0] === '--json' && args[1] === '--command') return JSON.stringify([{ results: db.raw.prepare(args[2]).all() }]);
    throw new Error(`unexpected ${args.join(' ')}`);
  };
  return { db, run, calls };
}

/** A file shaped like `wrangler d1 export`, with text that is hard to carry: quotes, emoji, new lines. */
function exportFile(extra = '', size = 100_000) {
  const body = `PRAGMA defer_foreign_keys=TRUE;\nCREATE TABLE groups (id TEXT, name TEXT);\nINSERT INTO "groups" VALUES('g1','Dinks ''n'' Drinks 🥒');\n${extra}`;
  const text = body + `-- ${'x'.repeat(size)}\n`;
  const file = join(mkdtempSync(join(tmpdir(), 'export-')), 'live-before-test.sql');
  writeFileSync(file, text);
  return { file, text };
}

describe('the deploy-export saver', () => {
  it('saves an export in small pieces, checks it against the file, and gets it back exactly', () => {
    const b = fakeBackups();
    const { file, text } = exportFile("INSERT INTO \"players\" VALUES('p1','O''Brien\n😀 \"quoted\"');\n", 150_000);
    const r = save(b.run, file, 'Zip 19 clock deploy', new Date('2026-11-09T00:30:00Z'));
    expect(r).toEqual({ id: 'export-20261109003000', chars: text.length, parts: Math.ceil(text.length / PIECE_CHARS) });
    const header = b.db.raw.prepare('SELECT * FROM deploy_exports').get() as { id: string; chars: number; parts: number; note: string; file_name: string };
    expect(header).toMatchObject({ note: 'Zip 19 clock deploy', file_name: 'live-before-test.sql' });
    const parts = b.db.raw.prepare('SELECT part, data FROM deploy_export_parts ORDER BY part').all() as { part: number; data: string }[];
    expect(parts.every((p) => p.data.length <= PIECE_CHARS)).toBe(true); // small rows
    expect(joinExport(header, parts)).toBe(text);
    // Only ever the backups database: every command is an execute on it (the runner adds the database name; see npxRunner).
    expect(b.calls.map((c) => c[0])).toEqual(['--file', '--json', '--json']);
    expect(readFileSync(join(process.cwd(), 'scripts', 'deploy-export.mjs'), 'utf8')).toMatch(/\['wrangler', 'd1', 'execute', DB, '--remote', \.\.\.args\]/);
  });

  it('keeps the newest 10, refuses a file that is not an export, and never lists one whose pieces did not all arrive', () => {
    const b = fakeBackups();
    for (let i = 0; i < KEEP_EXPORTS + 2; i++) save(b.run, exportFile(`-- ${i}\n`, 1000).file, null, new Date(Date.UTC(2026, 10, 9, 0, i)));
    const ids = (b.db.raw.prepare('SELECT id FROM deploy_exports ORDER BY saved_at').all() as { id: string }[]).map((x) => x.id);
    expect(ids).toHaveLength(KEEP_EXPORTS);
    expect(ids[0]).toBe('export-20261109000200');
    expect(b.db.raw.prepare('SELECT COUNT(*) AS n FROM deploy_export_parts WHERE export_id NOT IN (SELECT id FROM deploy_exports)').get()).toEqual({ n: 0 });
    const notExport = join(mkdtempSync(join(tmpdir(), 'x-')), 'notes.sql');
    writeFileSync(notExport, 'SELECT 1;');
    expect(() => save(b.run, notExport)).toThrow('does not look like');
    // A save cut off before its header: no row in deploy_exports, so nothing lists it; the next save clears its pieces.
    const cut: Runner = (args) => {
      if (args[0] === '--file') {
        const sql = readFileSync(args[1], 'utf8').split('\n');
        b.db.raw.exec(sql.filter((l) => !l.startsWith('INSERT INTO deploy_exports') && !l.startsWith('DELETE FROM deploy_export')).join('\n'));
        return '';
      }
      return b.run(args);
    };
    expect(() => save(cut, exportFile('', 1000).file, null, new Date('2026-11-10T00:00:00Z'))).toThrow('not saved');
    expect(b.db.raw.prepare('SELECT COUNT(*) AS n FROM deploy_exports').get()).toEqual({ n: KEEP_EXPORTS });
    save(b.run, exportFile('', 1000).file, null, new Date('2026-11-11T00:00:00Z'));
    expect(b.db.raw.prepare('SELECT COUNT(*) AS n FROM deploy_export_parts WHERE export_id NOT IN (SELECT id FROM deploy_exports)').get()).toEqual({ n: 0 });
    // Joining refuses a missing piece or a wrong size.
    expect(() => joinExport({ parts: 2, chars: 5 }, [{ part: 0, data: 'abc' }])).toThrow('incomplete');
    expect(() => joinExport({ parts: 1, chars: 5 }, [{ part: 0, data: 'abc' }])).toThrow('does not add up');
    expect(pieces('x'.repeat(39_999) + '😀y').join('')).toBe('x'.repeat(39_999) + '😀y');
    expect(looksLikeExport(readFileSync(exportFile().file, 'utf8'))).toBe(true);
  });
});
