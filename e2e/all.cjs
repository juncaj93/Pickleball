/* The full browser run: `npm run test:e2e`.
 *
 *   npm run test:e2e                      every script in e2e/suite.cjs, 3 at a time, then the failures again alone
 *   npm run test:e2e -- zip35 double-tap  only those scripts (names without .cjs)
 *   npm run test:e2e -- --lanes=2         fewer at once (default 3, at most 4: each lane is a dev server plus a browser, and more ran the
 *                                         machine out of memory)
 *   npm run test:e2e -- --no-rerun        skip the "failures again, alone" step
 *   npm run test:e2e -- --timeout=15      minutes one script may take before it is stopped (default 20)
 *   npm run test:e2e -- --base-port=5600  the first E2E_PORT; script number n gets base + 2n
 *   npm run test:e2e -- --list            print the script names and their ports, run nothing
 *
 * Every script runs even after one fails. Each gets its own E2E_PORT and its own process group (killed when it ends). One summary at the end;
 * output of each script is in .data/e2e-logs/<name>.log (not in git). Exit code 0 only when every script is green (after its rerun alone).
 * Run ONE full browser run at a time, and not while the unit suite runs (they compete for memory).
 */
const path = require('node:path');
const { SCRIPTS } = require('./suite.cjs');
const { assignPorts, runAll, summary, summaryJson, writeFileSync } = require('./all-lib.cjs');

const ROOT = path.join(__dirname, '..');
const arg = (name, fallback) => {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const flag = (name) => process.argv.slice(2).includes(`--${name}`);

async function main() {
  const picked = process.argv.slice(2).filter((a) => !a.startsWith('--')).map((a) => a.replace(/^e2e\//, '').replace(/\.cjs$/, ''));
  const unknown = picked.filter((n) => !SCRIPTS.includes(n));
  if (unknown.length) {
    console.error(`Not in e2e/suite.cjs: ${unknown.join(', ')}`);
    return 2;
  }
  const names = picked.length ? picked : SCRIPTS;
  const lanes = Math.max(1, Math.min(4, Number(arg('lanes', process.env.E2E_LANES)) || 3));
  const basePort = Number(arg('base-port', process.env.E2E_BASE_PORT)) || 5600;
  if (flag('list')) {
    const ports = assignPorts(names, basePort);
    for (const n of names) console.log(`${n}\tE2E_PORT=${ports.get(n)}`);
    return 0;
  }
  const logDir = path.join(ROOT, '.data', 'e2e-logs');
  const started = Date.now();
  const result = await runAll({
    dir: __dirname,
    names,
    lanes,
    basePort,
    timeoutMs: (Number(arg('timeout', '20')) || 20) * 60_000,
    logDir,
    rerun: !flag('no-rerun'),
    log: (s) => console.log(s),
  });
  const totalSeconds = Math.round((Date.now() - started) / 1000);
  console.log(summary(result, { lanes, totalSeconds }));
  writeFileSync(path.join(logDir, 'summary.json'), summaryJson(result, { lanes, totalSeconds }));
  return result.ok ? 0 : 1;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
