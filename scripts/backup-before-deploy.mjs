#!/usr/bin/env node
// Zip 80: the restore point before a deploy, in one command: `npm run backup:before-deploy -- "<what is being deployed>"`.
//   1. a SQL export of live (`wrangler d1 export pickleball --remote`, a read-only download) into a private temp folder,
//   2. saved in the `pickleball-backups` D1 DATABASE with scripts/deploy-export.mjs (checked against the file, newest 10 kept),
//   3. the Time Travel bookmark printed (`wrangler d1 time-travel info pickleball`, read only),
//   4. the temp file deleted (it has phone numbers).
// `pickleball-backups` is a D1 database, NOT an R2 bucket: `wrangler r2 object put pickleball-backups/...` answers 401 (the API token has no
// R2 permission, and there is no such bucket). That is what happened in Zips 58, 76 and 77; this command is the one way to save it.
// It stops (exit 1) if any step fails, so a deploy never goes ahead without its backup.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { npxRunner, save } from './deploy-export.mjs';

const note = process.argv.slice(2).filter((a) => a !== '--').join(' ').trim();
if (!note) {
  console.error('Usage: npm run backup:before-deploy -- "Zip 80 leftovers"');
  process.exit(1);
}
const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
const dir = mkdtempSync(join(tmpdir(), 'backup-before-deploy-'));
const file = join(dir, `live-before-${stamp}.sql`);
const wr = (args) => execFileSync('npx', ['wrangler', ...args], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
try {
  wr(['d1', 'export', 'pickleball', '--remote', '--output', file]);
  const r = save(npxRunner, file, note);
  console.log(`Export saved in pickleball-backups as ${r.id} (${r.chars} characters in ${r.parts} pieces), checked against the file.`);
  const info = wr(['d1', 'time-travel', 'info', 'pickleball', '--json']);
  const bookmark = JSON.parse(info.slice(info.indexOf('{'))).bookmark;
  console.log(`Time Travel bookmark: ${bookmark}`);
} catch (err) {
  console.error(`Backup NOT complete, do not deploy: ${err.message}${err.stderr ? `\n${String(err.stderr).slice(-800)}` : ''}`);
  process.exitCode = 1;
} finally {
  rmSync(dir, { recursive: true, force: true });
}
