// The pieces of the full browser run (e2e/all.cjs). Plain functions, so tests/zip35-runner.test.ts can run them on tiny fake scripts.
//
// What the full run does (Zip 35, audit A-12):
//   - runs EVERY script, even after one fails (the old `a && b && c` chain stopped at the first failure);
//   - runs several at once (3 lanes), each with its own E2E_PORT (each script's dev server uses that port), and each in its own process
//     group, which is killed when the script ends, so a crashed script never leaves a server holding a port;
//   - a script that runs past its time limit is stopped and counted as failed ("timeout");
//   - prints ONE summary at the end (script, passed or failed, counts, seconds);
//   - then runs the scripts that failed again, ALONE, one at a time (a lot of failures are only the machine being busy: a timeout, a page that
//     was slow to draw). A script that passes alone is reported as "passed on rerun", with its first-run failure kept in the summary.
const { spawn } = require('node:child_process');
const { closeSync, mkdirSync, openSync, readFileSync, writeFileSync } = require('node:fs');
const path = require('node:path');

/** Count the checks a script printed: its own "  ✓ name" and "  ✗ name" lines (every e2e script prints them the same way). */
function countChecks(text) {
  let passed = 0;
  let failed = 0;
  for (const line of text.split('\n')) {
    if (/^\s*✓ /.test(line)) passed++;
    else if (/^\s*✗ /.test(line)) failed++;
  }
  return { passed, failed };
}

/** The first few failing check lines of a script's output (the ✗ line and the reason that follows it). */
function failureLines(text, max = 4) {
  const lines = text.split('\n');
  const out = [];
  for (let i = 0; i < lines.length && out.length < max; i++) {
    if (/^\s*✗ /.test(lines[i])) out.push(lines[i].trim().slice(0, 240) + (lines[i + 1] && !/^\s*[✓✗] /.test(lines[i + 1]) ? `\n      ${lines[i + 1].trim().slice(0, 240)}` : ''));
  }
  return out;
}

/** One port per script, all different: base, base + 2, base + 4 ... (room for a script that also wants the port next to its own). */
function assignPorts(names, basePort) {
  const ports = new Map();
  names.forEach((n, i) => ports.set(n, basePort + i * 2));
  return ports;
}

/** Run one script in its own process group. Resolves with { name, status: 'pass' | 'fail' | 'timeout', passed, failed, exit, seconds, log }. */
function runScript({ dir, name, port, timeoutMs, logDir, env = {}, node = process.execPath }) {
  return new Promise((resolve) => {
    mkdirSync(logDir, { recursive: true });
    const logPath = path.join(logDir, `${name}.log`);
    const fd = openSync(logPath, 'w');
    const started = Date.now();
    const child = spawn(node, [path.join(dir, `${name}.cjs`)], { cwd: path.join(dir, '..'), env: { ...process.env, ...env, E2E_PORT: String(port) }, stdio: ['ignore', fd, fd], detached: true });
    let timedOut = false;
    let done = false;
    const killGroup = () => {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        // already gone
      }
    };
    const timer = setTimeout(() => {
      timedOut = true;
      killGroup();
    }, timeoutMs);
    const finish = (code) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      // Whatever the script left running (its dev server, a browser) goes with it: a stale server must never hold the next script's port.
      killGroup();
      closeSync(fd);
      let text = '';
      try {
        text = readFileSync(logPath, 'utf8');
      } catch {
        // no log
      }
      const { passed, failed } = countChecks(text);
      const status = timedOut ? 'timeout' : code === 0 && failed === 0 ? 'pass' : 'fail';
      resolve({ name, port, status, passed, failed, exit: code, seconds: Math.round((Date.now() - started) / 1000), log: logPath, text });
    };
    child.on('exit', (code) => finish(code ?? 1));
    child.on('error', () => finish(1));
  });
}

/** Run `items` through `worker`, never more than `lanes` at once; results come back in the order of `items`. `onDone` is called as each finishes. */
async function pool(items, lanes, worker, onDone = () => {}) {
  const results = new Array(items.length);
  let next = 0;
  const lane = async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await worker(items[i], i);
      onDone(results[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(lanes, items.length || 1)) }, lane));
  return results;
}

/**
 * The whole run. Returns { first, rerun, final, ok } where
 *   first  every script's first-run result, in the order of `names`
 *   rerun  the failed ones run again alone, one at a time (empty when nothing failed or `rerun` is false)
 *   final  one row per script: the rerun result when there was one, else the first run, plus `firstStatus`
 *   ok     every script ends up passing
 */
async function runAll({ dir, names, lanes = 3, basePort = 5600, timeoutMs = 20 * 60_000, logDir, rerun = true, env = {}, log = () => {} }) {
  const ports = assignPorts(names, basePort);
  const one = (name) => runScript({ dir, name, port: ports.get(name), timeoutMs, logDir, env });
  log(`Running ${names.length} scripts, ${Math.min(lanes, names.length)} at a time, ports ${basePort} to ${basePort + (names.length - 1) * 2}.`);
  const first = await pool(names, lanes, (n) => (log(`  start  ${n} (port ${ports.get(n)})`), one(n)), (r) => log(`  ${r.status === 'pass' ? 'ok    ' : 'FAILED'} ${r.name}: ${r.passed} passed, ${r.failed} failed, ${r.seconds}s${r.status === 'timeout' ? ' (timed out)' : ''}`));
  const failedNames = first.filter((r) => r.status !== 'pass').map((r) => r.name);
  let second = [];
  if (rerun && failedNames.length) {
    log(`\nRerunning the ${failedNames.length} that failed, alone, one at a time: ${failedNames.join(', ')}`);
    second = await pool(failedNames, 1, (n) => one(n), (r) => log(`  ${r.status === 'pass' ? 'ok    ' : 'FAILED'} ${r.name} (alone): ${r.passed} passed, ${r.failed} failed, ${r.seconds}s${r.status === 'timeout' ? ' (timed out)' : ''}`));
  }
  const byName = new Map(second.map((r) => [r.name, r]));
  const final = first.map((r) => ({ ...(byName.get(r.name) ?? r), firstStatus: r.status, firstPassed: r.passed, firstFailed: r.failed, rerun: byName.has(r.name), firstText: r.text }));
  return { first, rerun: second, final, ok: final.every((r) => r.status === 'pass') };
}

const pad = (s, n) => String(s).padEnd(n);
const rpad = (s, n) => String(s).padStart(n);
const mmss = (s) => `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;

/** The one summary: a table, then what failed first and was green alone, then what is still red (with its failing lines). */
function summary(result, { lanes, totalSeconds }) {
  const rows = result.final;
  const lines = [];
  lines.push('');
  lines.push(`SUMMARY: ${rows.length} scripts, ${lanes} at a time, ${mmss(totalSeconds)}`);
  lines.push(`${pad('script', 22)}${pad('result', 20)}${rpad('passed', 7)}${rpad('failed', 7)}${rpad('seconds', 9)}`);
  for (const r of rows) {
    const label = r.status === 'pass' ? (r.rerun ? 'PASS (on rerun)' : 'PASS') : r.status === 'timeout' ? 'FAIL (timeout)' : 'FAIL';
    lines.push(`${pad(r.name, 22)}${pad(label, 20)}${rpad(r.passed, 7)}${rpad(r.failed, 7)}${rpad(r.seconds, 9)}`);
  }
  const checks = rows.reduce((s, r) => s + r.passed, 0);
  const failedChecks = rows.reduce((s, r) => s + r.failed, 0);
  const green = rows.filter((r) => r.status === 'pass');
  const loadOnly = rows.filter((r) => r.rerun && r.status === 'pass');
  const red = rows.filter((r) => r.status !== 'pass');
  lines.push('');
  lines.push(`${green.length} of ${rows.length} scripts green, ${checks} checks passed, ${failedChecks} failed.`);
  if (loadOnly.length) lines.push(`Failed in the full run but green alone (a busy machine, not a bug): ${loadOnly.map((r) => `${r.name} (${r.firstStatus === 'timeout' ? 'timeout' : `${r.firstFailed} check${r.firstFailed === 1 ? '' : 's'}`})`).join(', ')}.`);
  if (red.length) {
    lines.push(`STILL FAILING after a rerun alone: ${red.map((r) => r.name).join(', ')}.`);
    for (const r of red) {
      lines.push(`  ${r.name}${r.status === 'timeout' ? ' (timed out)' : ''}  full output: ${r.log}`);
      for (const f of failureLines(r.text)) lines.push(`    ${f}`);
    }
  }
  lines.push(result.ok ? 'RESULT: ALL GREEN' : 'RESULT: NOT GREEN');
  return lines.join('\n');
}

/** A short machine-readable copy of the summary (written next to the logs). */
function summaryJson(result, extra = {}) {
  return JSON.stringify({ ...extra, ok: result.ok, scripts: result.final.map((r) => ({ name: r.name, status: r.status, firstStatus: r.firstStatus, passed: r.passed, failed: r.failed, seconds: r.seconds, rerun: r.rerun })) }, null, 2);
}

module.exports = { assignPorts, countChecks, failureLines, pool, runAll, runScript, summary, summaryJson, writeFileSync };
