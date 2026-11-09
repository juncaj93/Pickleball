// Wipe and re-fill the FAKE preview database in one command.
//
//   npm run db:seed:preview              build the fake world, load it into pickleball-preview
//   npm run db:seed:preview -- --dry-run build it and run the safety checks, touch nothing remote
//   npm run db:seed:preview -- --out x.sql   also keep the SQL it would load
//
// How it works: it plays a fake group on a throwaway in-memory copy of the site (the real site code,
// a fake clock, no network), so every game and every money state comes from the site's own rules
// instead of hand-written rows. Then it loads that into the database named "pickleball-preview".
//
// Safety, in plain words:
//  - It only ever talks to the database named "pickleball-preview" with the id written below, and it
//    refuses to run if that id is the live database's id or the database holds anything that is not
//    marked as fake (the group name must say "PREVIEW, fake data").
//  - It never reads live data and never sends a text or Telegram (the in-memory site has no token).
//  - Everything it writes is fake: made-up names, 313-555-01xx phone numbers, a fake PIN.

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { buildSmallPreview } from './preview-world-small';

// ---- the two databases, spelled out so a typo can never point this at the real one --------------------
const PREVIEW_DB_NAME = 'pickleball-preview';
const PREVIEW_DB_ID: string = '6f94e087-0596-4286-8945-647923b349a0';
const LIVE_DB_ID: string = '5c939453-ebef-4a1d-869e-9a952339d275';

// ---- talking to Cloudflare (only the preview database, guarded) --------------------------------------------
function wrangler(args: string[]): string {
  return execFileSync('npx', ['wrangler', ...args], { cwd: process.cwd(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function runJson(sql: string): Record<string, unknown>[] {
  const out = wrangler(['d1', 'execute', PREVIEW_DB_NAME, '--remote', '--json', '--command', sql]);
  const i = out.indexOf('\n[\n') >= 0 ? out.indexOf('\n[\n') + 1 : out.indexOf('[');
  return JSON.parse(out.slice(i))[0].results;
}

/** Refuse unless the target is the fake database and holds only fake data. */
function guardTarget() {
  if (PREVIEW_DB_ID === LIVE_DB_ID) throw new Error('Refusing: the preview id equals the live id.');
  const info = wrangler(['d1', 'info', PREVIEW_DB_NAME, '--json']);
  const parsed = JSON.parse(info.slice(info.indexOf('{')));
  const id = String(parsed.uuid ?? parsed.id ?? '');
  if (id !== PREVIEW_DB_ID) throw new Error(`Refusing: "${PREVIEW_DB_NAME}" has id ${id}, expected ${PREVIEW_DB_ID}.`);
  if (id === LIVE_DB_ID) throw new Error('Refusing: that is the live database.');
  const groups = runJson('SELECT name FROM groups') as { name: string }[];
  const odd = groups.filter((g) => !String(g.name).includes('PREVIEW, fake data'));
  if (odd.length) throw new Error(`Refusing: the target has a group that is not marked fake (${JSON.stringify(odd)}).`);
  return { id, groups: groups.length };
}

async function main() {
  const args = process.argv.slice(2);
  const dry = args.includes('--dry-run');
  const outIdx = args.indexOf('--out');
  const outFile = outIdx >= 0 ? args[outIdx + 1] : null;

  console.log('Building the fake world on a throwaway in-memory copy...');
  // The SMALL world (Alex, Nov 8): the fixed names of docs/PREVIEW_FAKE_DB.md, nothing else (scripts/preview-world-small.ts).
  const { sql, summary } = await buildSmallPreview(Date.now());
  for (const s of summary) console.log('  - ' + s);

  if (outFile) writeFileSync(outFile, sql);
  if (dry) {
    console.log(`Dry run: ${sql.split('\n').length} SQL lines built, nothing remote touched.${outFile ? ` Saved to ${outFile}.` : ''}`);
    return;
  }

  const target = guardTarget();
  console.log(`Target checked: ${PREVIEW_DB_NAME} (${target.id}), fake data only.`);

  const dir = join(tmpdir(), 'pickleball-preview-seed');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'seed.sql');
  writeFileSync(file, sql);
  console.log('Loading it into the preview database (this wipes the old fake data first)...');
  wrangler(['d1', 'execute', PREVIEW_DB_NAME, '--remote', '--yes', '--file', file]);

  const counts = runJson(
    "SELECT (SELECT COUNT(*) FROM players) AS players, (SELECT COUNT(*) FROM sessions) AS games, (SELECT COUNT(*) FROM session_players) AS seats, (SELECT COUNT(*) FROM credit_ledger) AS credit_entries, (SELECT COUNT(*) FROM refund_requests) AS cash_outs",
  )[0];
  console.log('Done. Preview database now holds:', JSON.stringify(counts));
  console.log('Organizer PIN for the preview: see docs/PREVIEW_FAKE_DB.md');
}

main().catch((err) => {
  console.error('Seed failed: ' + (err instanceof Error ? err.message : String(err)));
  process.exit(1);
});
