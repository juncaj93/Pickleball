// Wipe and re-fill the FAKE preview database in one command.
//
//   npm run db:seed:preview              build the fake world, load it into pickleball-preview
//   npm run db:seed:preview -- --dry-run build it and run the safety checks, touch nothing remote
//   npm run db:seed:preview -- --full    the WHOLE world (every zip's scenes). The default is the CALM one (PREVIEW CALM RULE, docs/SITE_RULES.md).
//   npm run db:seed:preview -- --zip51   the calm profile of Zip 51 instead of Zip 56's (the default since Zip 56: the tournament at Date picked)
//   npm run db:seed:preview -- --zip55   Zip 55's start instead (the tournament just created, Only me, nobody on the list)
//   npm run db:seed:preview -- --zip56   Zip 56's start instead (the Locked doubles tournament with the date picked, tickets open)
//   npm run db:seed:preview -- --zip60   Zip 60's start instead (the calm profile with NO tournament open, so Create starts on "Let players vote")
//   (no flag: Zip 63's start: Zip 60's profile, then the "Countdown: 2 days left" stage: tickets open, 6 paid, Vic sees the pay countdown)
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

/** Rows ON on live (read Tue Nov 17, 2026) that the small world's switch lists leave out (Zip 56, PREVIEW SWITCHES RULE). */
export const LIVE_ON_SINCE_ZIP56 = ['cheaper_fix_on', 'error_alerts_on', 'game_day_text_on', 'home_screen_tip_on', 'christmas_skin_me'] as const;

async function main() {
  const args = process.argv.slice(2);
  const dry = args.includes('--dry-run');
  const outIdx = args.indexOf('--out');
  const outFile = outIdx >= 0 ? args[outIdx + 1] : null;

  console.log('Building the fake world on a throwaway in-memory copy...');
  // The SMALL world (Alex, Nov 8): the fixed names of docs/PREVIEW_FAKE_DB.md, nothing else (scripts/preview-world-small.ts).
  // Zip 55: the calm preview opens on the Tournaments scene alone (scripts/preview-world-small.ts step 28). `--zip51` builds Zip 51's calm profile
  // instead (its two late-drop games and the Venue charge alert's cards). Zip 56 (step 29): the tournament starts with its date picked for
  // Everyone (which opens tickets; nobody has paid); `--zip55` builds Zip 55's start instead (Only me, nobody on the list).
  const zip51 = args.includes('--zip51');
  // Zip 60 (🎾60.formatvote): the default profile now has NO tournament open (Create starts on "Let players vote"; the Tournament test page has the vote
  // stages). `--zip56` builds Zip 56's start (the Locked doubles tournament at Date picked), `--zip55` Zip 55's (just created, Only me).
  const zip56 = args.includes('--zip56');
  // Zip 63: the default is Zip 60's profile with the "Countdown: 2 days left" stage on top; `--zip60` builds Zip 60's start alone.
  const zip60only = args.includes('--zip60');
  const zip60 = !zip51 && !args.includes('--zip55') && !zip56;
  const built = await buildSmallPreview(Date.now(), { calm: !args.includes('--full'), zip51, zip55: !zip51, zip56: !zip51 && !args.includes('--zip55') && zip56, zip60, zip63: zip60 && !zip60only });
  const { summary } = built;
  // PREVIEW SWITCHES RULE, Zip 56: five more rows are ON on live (read Tue Nov 17, 2026, switch rows only) that the lists in
  // scripts/preview-world-small.ts do not have. They go on the real preview only (a local e2e world keeps its lists, so other zips' browser
  // checks see the world they were written for). Home Screen tip and Game day text are on on every preview anyway ([env.preview.vars]).
  const sql = built.sql + LIVE_ON_SINCE_ZIP56.map((task) => `INSERT OR IGNORE INTO task_log (id, group_id, session_id, task, kind, at) SELECT 'preview-${task}', id, NULL, '${task}', 'mark', '${new Date().toISOString()}' FROM groups;`).join('\n') + '\n';
  summary.push(`Also ON, as on live: ${LIVE_ON_SINCE_ZIP56.join(', ')}`);
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
