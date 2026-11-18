/* Zip 62 (🎾62.speed): with the tournament reads moved into the stamp's own trip, every answer is still byte for byte main's. This runs
 * main's server code (a git checkout, path in MAIN_DIR) and this branch's on the very same saved fake worlds (local sqlite files, never
 * Cloudflare): every Tournament test stage with the switch on, three with it off, Only me at two stages, a piece 1 date pick that opens
 * tickets on its first read, the night over with a paid hold in line (read at 11:00 PM: the hold comes back as credit), and the organizer
 * found by the name in Settings or with a saved player that is gone. For each: the
 * dashboard and its check, History, Money, View as data, a phone with no name, and for every fixed name the Home and its check, the
 * organizer's own phone, View as, Pretend it's... at two moments and the read-only PIN (93 answers a state).
 *
 *   MAIN_DIR=/path/to/main-checkout node e2e/zip62-same.cjs
 *
 * Not part of npm run test:e2e (it needs the second checkout, with its own node_modules). About 5 minutes. The one difference allowed: the id
 * SQLite itself makes at random for the credit entry a returned hold writes (and the change stamps that hash it).
 */
const { spawnSync } = require('node:child_process');
const { mkdirSync, readdirSync, readFileSync, rmSync } = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const MAIN = process.env.MAIN_DIR;
if (!MAIN) throw new Error('set MAIN_DIR to a checkout of main');
const WORK = path.join(ROOT, '.data', 'zip62-same');
rmSync(WORK, { recursive: true, force: true });
mkdirSync(WORK, { recursive: true });

const states = spawnSync('npx', ['vite-node', 'scripts/zip62-states.ts', '--', WORK], { cwd: ROOT, encoding: 'utf8' });
if (states.status !== 0) throw new Error(`could not build the states: ${states.stderr || states.stdout}`);

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
let same = 0;
let different = 0;
for (const file of readdirSync(WORK).filter((f) => f.endsWith('.sqlite') && !f.includes('.work-'))) {
  const name = file.replace(/\.sqlite$/, '');
  // The state after the night is read at 11:00 PM Eastern that night (the state's name carries the date).
  const night = /^after_night__(\d{4}-\d{2}-\d{2})$/.exec(name);
  const at = night ? new Date(Date.parse(`${night[1]}T00:00:00.000Z`) + 28 * 3_600_000).toISOString() : '2026-11-18T18:30:00.000Z';
  const out = {};
  for (const [side, root] of [['main', MAIN], ['branch', ROOT]]) {
    const json = path.join(WORK, `${name}.${side}.json`);
    const run = spawnSync('npx', ['vite-node', path.join(ROOT, 'scripts/zip62-dump.ts')], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, ROOT: root, DB: path.join(WORK, file), OUT: json, AT: at, WORK: path.join(WORK, `${name}.${side}.work-run.sqlite`) },
    });
    if (run.status !== 0) throw new Error(`${name} on ${side}: ${run.stderr || run.stdout}`);
    out[side] = JSON.parse(readFileSync(json, 'utf8'));
  }
  const a = out.main;
  const b = out.branch;
  // Ids that appear on one side only (made by SQLite at random), and the stamps that hash them.
  const ids = new Set([...JSON.stringify(a).matchAll(UUID)].map((m) => m[0]));
  const onlyOne = [...new Set([...JSON.stringify(b).matchAll(UUID)].map((m) => m[0]))].filter((x) => !ids.has(x));
  const allowed = new Set([...[...ids].filter((x) => !JSON.stringify(b).includes(x)), ...onlyOne]);
  const strip = (t) => {
    let x = t;
    for (const id of allowed) x = x.split(id).join('ID');
    return allowed.size ? x.replace(/"version":"[^"]*"/g, '"version":"V"').replace(/^200 \{"v":"[^"]*"\}$/, '200 {"v":"V"}') : x;
  };
  const bad = Object.keys(a).filter((k) => strip(a[k]) !== strip(b[k] ?? ''));
  if (Object.keys(a).length !== Object.keys(b).length) bad.push('(a different list of answers)');
  if (bad.length === 0) {
    same++;
    console.log(`  ✓ ${name}: ${Object.keys(a).length} answers the same${allowed.size ? ` (apart from ${allowed.size} ids SQLite made at random)` : ''}`);
  } else {
    different++;
    console.log(`  ✗ ${name}: ${bad.length} answers differ: ${bad.slice(0, 6).join(' | ')}`);
  }
}
console.log(`\nzip62-same: ${same} states the same, ${different} different`);
process.exit(different ? 1 : 0);
