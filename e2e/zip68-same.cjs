/* Zip 68 (🎾68.speed): with the dashboard's reads in one shared trip, every answer is still byte for byte main's. This runs main's server
 * code (a git checkout, path in MAIN_DIR) and this branch's on the very same saved fake worlds (scripts/zip68-states.ts: local sqlite files,
 * never Cloudflare) and compares every answer of scripts/zip68-dump.ts (the dashboard and its check twice, History, Money, View as data, a
 * phone with no name, every name's Home and check, the organizer's own phone, View as, Pretend it's... and the read-only PIN). It also
 * prints the dashboard's and the check's database trips on both sides, and fails if any answer makes MORE trips than main's, or, with
 * "Fewer database trips" off (the `_off_` states), more than one fewer (off, only the sign-in check and the deciding switch read share a trip).
 *
 *   MAIN_DIR=/path/to/main-checkout node e2e/zip68-same.cjs [calm|full|all]
 *
 * Not part of npm run test:e2e (it needs the second checkout, with its own node_modules). The one difference allowed: ids SQLite itself
 * makes at random (none are expected here) and the change stamps that hash them.
 */
const { spawnSync } = require('node:child_process');
const { mkdirSync, readdirSync, readFileSync, rmSync } = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const MAIN = process.env.MAIN_DIR;
if (!MAIN) throw new Error('set MAIN_DIR to a checkout of main');
const which = process.argv[2] ?? 'all';
const WORK = path.join(ROOT, '.data', 'zip68-same');
rmSync(WORK, { recursive: true, force: true });
mkdirSync(WORK, { recursive: true });

const states = spawnSync('npx', ['vite-node', 'scripts/zip68-states.ts', '--', WORK, which], { cwd: ROOT, encoding: 'utf8' });
if (states.status !== 0) throw new Error(`could not build the states: ${states.stderr || states.stdout}`);

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
let same = 0;
let different = 0;
let tripProblems = 0;
const at = '2026-11-18T18:30:00.000Z';
for (const file of readdirSync(WORK).filter((f) => f.endsWith('.sqlite') && !f.includes('.work-')).sort()) {
  const name = file.replace(/\.sqlite$/, '');
  const out = {};
  for (const [side, root] of [['main', MAIN], ['branch', ROOT]]) {
    const json = path.join(WORK, `${name}.${side}.json`);
    const run = spawnSync('npx', ['vite-node', path.join(ROOT, 'scripts/zip68-dump.ts')], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, ROOT: root, DB: path.join(WORK, file), OUT: json, AT: at, WORK: path.join(WORK, `${name}.${side}.work-run.sqlite`) },
    });
    if (run.status !== 0) throw new Error(`${name} on ${side}: ${run.stderr || run.stdout}`);
    out[side] = JSON.parse(readFileSync(json, 'utf8'));
  }
  const a = out.main.answers;
  const b = out.branch.answers;
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
  const ta = out.main.trips;
  const tb = out.branch.trips;
  const off = name.includes('_off_');
  // Off: the sign-in check and the switch rows share one trip (the one read that decides), nothing else changes.
  const tripBad = Object.keys(ta).filter((k) => tb[k] > ta[k] || (off && ta[k] - tb[k] > 1));
  tripProblems += tripBad.length;
  const t = (k) => `${ta[k]}->${tb[k]}`;
  const trips = `dashboard ${t('r0 dashboard')} then ${t('r1 dashboard')}, check ${t('r1 admin version')}${tripBad.length ? `; MORE TRIPS: ${tripBad.slice(0, 4).map((k) => `${k} ${t(k)}`).join(', ')}` : ''}`;
  if (bad.length === 0) {
    same++;
    console.log(`  ✓ ${name}: ${Object.keys(a).length} answers the same${allowed.size ? ` (apart from ${allowed.size} ids SQLite made at random)` : ''}; trips ${trips}`);
  } else {
    different++;
    console.log(`  ✗ ${name}: ${bad.length} answers differ: ${bad.slice(0, 6).join(' | ')}; trips ${trips}`);
  }
}
console.log(`\nzip68-same: ${same} states the same, ${different} different, ${tripProblems} answers with more trips than main (or, switch off, other than the one shared sign-in trip)`);
process.exit(different || tripProblems ? 1 : 0);
