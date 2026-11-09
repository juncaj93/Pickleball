#!/usr/bin/env node
// The deploy-export saver (Zip 19). The SQL export of live taken before each deploy (docs/DEPLOY.md step 3) used to live only in a
// session's scratch folder, which is lost when the session ends. This keeps it in the private `pickleball-backups` database instead
// (free plan, about 180 KB each, the newest 10 kept), next to the weekly copies. Run it AFTER a real deploy only (never from tests):
//
//   node scripts/deploy-export.mjs save live-before-zip19-2026-11-08.sql "Zip 19 clock deploy"
//   node scripts/deploy-export.mjs list
//   node scripts/deploy-export.mjs get <id>          (writes the .sql back; restore steps: docs/RESTORE.md)
//
// It only ever writes to `pickleball-backups` (never the live database), in small rows (pieces of 25,000 characters). The header row
// is written last, so an export whose pieces did not all arrive is never listed or fetched (the next save clears its pieces).
// The export has phone numbers: like the weekly copies, it lives only in Alex's Cloudflare account, never in git.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DB = 'pickleball-backups';
/** Characters per piece: small rows, and each INSERT stays under D1's 100 KB statement limit even if every character takes 3 bytes. */
export const PIECE_CHARS = 25_000;
/** How many saved exports are kept (the oldest beyond this are deleted, their pieces first). */
export const KEEP_EXPORTS = 10;

export const SCHEMA = [
  'CREATE TABLE IF NOT EXISTS deploy_exports (id TEXT PRIMARY KEY, saved_at TEXT NOT NULL, file_name TEXT NOT NULL, note TEXT, chars INTEGER NOT NULL, parts INTEGER NOT NULL)',
  'CREATE TABLE IF NOT EXISTS deploy_export_parts (export_id TEXT NOT NULL, part INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY (export_id, part))',
];

const lit = (v) => (v === null || v === undefined ? 'NULL' : typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`);

/** Split text into pieces of at most `size` characters, never cutting an emoji (a two-part character) in half. */
export function pieces(text, size = PIECE_CHARS) {
  const out = [];
  let i = 0;
  while (i < text.length) {
    let end = Math.min(i + size, text.length);
    const code = text.charCodeAt(end - 1);
    if (end < text.length && code >= 0xd800 && code <= 0xdbff) end--;
    out.push(text.slice(i, end));
    i = end;
  }
  return out;
}

/** Is this a `wrangler d1 export` file? (So a wrong file is never saved as a restore point.) */
export function looksLikeExport(text) {
  return /^PRAGMA defer_foreign_keys\s*=\s*TRUE;/i.test(text) && /CREATE TABLE/i.test(text) && /INSERT INTO "?groups"?/i.test(text);
}

/** The SQL that saves one export: schema, clear unfinished pieces, the pieces, the header LAST, then keep the newest 10. */
export function saveSql(text, fileName, note, id, savedAt) {
  const parts = pieces(text);
  const keep = `SELECT id FROM deploy_exports ORDER BY saved_at DESC LIMIT ${KEEP_EXPORTS}`;
  return [
    ...SCHEMA.map((s) => `${s};`),
    // Pieces with no header are from a save that did not finish: never listed, cleared here.
    'DELETE FROM deploy_export_parts WHERE export_id NOT IN (SELECT id FROM deploy_exports);',
    ...parts.map((d, i) => `INSERT INTO deploy_export_parts (export_id, part, data) VALUES (${lit(id)}, ${i}, ${lit(d)});`),
    `INSERT INTO deploy_exports (id, saved_at, file_name, note, chars, parts) VALUES (${lit(id)}, ${lit(savedAt)}, ${lit(fileName)}, ${lit(note)}, ${text.length}, ${parts.length});`,
    `DELETE FROM deploy_export_parts WHERE export_id NOT IN (${keep});`,
    `DELETE FROM deploy_exports WHERE id NOT IN (${keep});`,
  ].join('\n');
}

/** Join an export's pieces back, checking none is missing. */
export function joinExport(header, parts) {
  const sorted = [...parts].sort((a, b) => a.part - b.part);
  if (sorted.length !== header.parts || sorted.some((p, i) => p.part !== i)) throw new Error(`This export is incomplete (${sorted.length} of ${header.parts} pieces).`);
  const text = sorted.map((p) => p.data).join('');
  if (text.length !== header.chars) throw new Error('This export does not add up (wrong size).');
  return text;
}

/** The real door to Cloudflare: always the backups database, never the live one. */
export const npxRunner = (args) => execFileSync('npx', ['wrangler', 'd1', 'execute', DB, '--remote', ...args], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });

function query(run, sql) {
  const out = run(['--json', '--command', sql]);
  return JSON.parse(out.slice(out.indexOf('[')))[0].results;
}

export function save(run, file, note = null, now = new Date()) {
  const text = readFileSync(file, 'utf8');
  if (!looksLikeExport(text)) throw new Error(`${file} does not look like a "wrangler d1 export" file.`);
  const id = `export-${now.toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}`;
  const dir = mkdtempSync(join(tmpdir(), 'deploy-export-'));
  try {
    const sqlFile = join(dir, 'save.sql');
    writeFileSync(sqlFile, saveSql(text, basename(file), note, id, now.toISOString()));
    run(['--file', sqlFile, '--yes']);
  } finally {
    rmSync(dir, { recursive: true, force: true }); // the SQL holds the export (phone numbers)
  }
  const [header] = query(run, `SELECT id, chars, parts FROM deploy_exports WHERE id = '${id}'`);
  if (!header) throw new Error('The export was not saved (no header row). Nothing is listed for it; try again.');
  const parts = query(run, `SELECT part, data FROM deploy_export_parts WHERE export_id = '${id}' ORDER BY part`);
  if (joinExport(header, parts) !== text) throw new Error('The saved export does not match the file.');
  return { id, chars: text.length, parts: header.parts };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [cmd, a, b] = process.argv.slice(2);
  const when = (iso) => new Date(iso).toLocaleString('en-US', { timeZone: 'America/Detroit', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  try {
    if (cmd === 'save' && a) {
      const r = save(npxRunner, a, b ?? null);
      console.log(`Saved ${a} as ${r.id} (${r.chars} characters in ${r.parts} pieces) in pickleball-backups, checked against the file. You can delete the local file.`);
    } else if (cmd === 'list') {
      const have = query(npxRunner, "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'deploy_exports'");
      const rows = have.length ? query(npxRunner, 'SELECT id, saved_at, file_name, note, chars, parts FROM deploy_exports ORDER BY saved_at DESC') : [];
      if (!rows.length) console.log('No saved deploy exports yet.');
      for (const r of rows) console.log(`${r.id}  saved ${when(r.saved_at)} Eastern  ${r.file_name}  ${r.chars} characters${r.note ? `  (${r.note})` : ''}`);
    } else if (cmd === 'get' && /^export-\d{14}$/.test(a ?? '')) {
      const [header] = query(npxRunner, `SELECT id, file_name, chars, parts FROM deploy_exports WHERE id = '${a}'`);
      if (!header) throw new Error(`No saved export ${a}. Run "list" to see them.`);
      const text = joinExport(header, query(npxRunner, `SELECT part, data FROM deploy_export_parts WHERE export_id = '${a}' ORDER BY part`));
      if (existsSync(header.file_name)) throw new Error(`${header.file_name} is already here; move it away first (nothing was overwritten).`);
      writeFileSync(header.file_name, text);
      console.log(`Wrote ${header.file_name}. It has phone numbers: keep it private. Restore: docs/RESTORE.md.`);
    } else {
      console.error('Usage: node scripts/deploy-export.mjs save <export.sql> ["note"]\n       node scripts/deploy-export.mjs list\n       node scripts/deploy-export.mjs get <id>');
      process.exit(1);
    }
  } catch (err) {
    console.error(`Could not use the saved deploy exports: ${err.message}`);
    process.exit(1);
  }
}
