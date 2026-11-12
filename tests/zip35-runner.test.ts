// Zip 35 Part D (audit A-12 leftover): the full browser run (e2e/all.cjs, e2e/all-lib.cjs) runs every script, in parallel lanes with their own
// ports, prints one summary, and reruns the failures alone. These tests run the REAL runner on tiny fake scripts (no browser, no server).
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const lib = require('../e2e/all-lib.cjs');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { SCRIPTS } = require('../e2e/suite.cjs');

const ROOT = resolve(__dirname, '..');

/** A scratch folder with e2e/ (fake scripts) and logs/. */
function scratch(files: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), 'runner-'));
  const dir = join(root, 'e2e');
  mkdirSync(dir);
  for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, `${name}.cjs`), body);
  return { dir, logDir: join(root, 'logs'), root };
}
const ok = (n: number) => Array.from({ length: n }, (_, i) => `console.log('  ✓ check ${i}');`).join('\n') + '\nprocess.exit(0);';
const bad = `console.log('  ✓ fine');\nconsole.log('  ✗ broke\\n      because reasons');\nprocess.exit(1);`;

describe('reading a script\'s output', () => {
  it('counts the ✓ and ✗ lines and quotes the failing ones with their reason', () => {
    const text = '  ✓ a\n  ✓ b\n  ✗ c\n      the reason\n  ✓ d\nnoise ✓ not a check';
    expect(lib.countChecks(text)).toEqual({ passed: 3, failed: 1 });
    expect(lib.failureLines(text)).toEqual(['✗ c\n      the reason']);
  });
  it('ports are all different, 2 apart', () => {
    const ports = lib.assignPorts(['a', 'b', 'c'], 5600);
    expect([...ports.values()]).toEqual([5600, 5602, 5604]);
  });
});

describe('the run', () => {
  it('runs EVERY script even after one fails, gives each its own E2E_PORT, and prints one summary', async () => {
    const s = scratch({
      a: ok(3),
      b: bad,
      c: `require('node:fs').writeFileSync(process.env.PORT_FILE_DIR + '/c.port', process.env.E2E_PORT);\n` + ok(2),
      d: ok(1),
    });
    const ran: string[] = [];
    const result = await lib.runAll({ dir: s.dir, names: ['a', 'b', 'c', 'd'], lanes: 2, basePort: 7000, timeoutMs: 20_000, logDir: s.logDir, rerun: false, env: { PORT_FILE_DIR: s.root }, log: (l: string) => ran.push(l) });
    expect(result.final.map((r: any) => [r.name, r.status, r.passed, r.failed])).toEqual([
      ['a', 'pass', 3, 0],
      ['b', 'fail', 1, 1],
      ['c', 'pass', 2, 0],
      ['d', 'pass', 1, 0],
    ]);
    expect(result.ok).toBe(false);
    expect(readFileSync(join(s.root, 'c.port'), 'utf8')).toBe('7004'); // third script: base + 2 x 2
    const text = lib.summary(result, { lanes: 2, totalSeconds: 75 });
    expect(text).toContain('SUMMARY: 4 scripts, 2 at a time, 1m 15s');
    expect(text).toMatch(/b\s+FAIL\s+1\s+1/);
    expect(text).toContain('STILL FAILING after a rerun alone: b.');
    expect(text).toContain('✗ broke');
    expect(text).toContain('because reasons');
    expect(text).toContain('RESULT: NOT GREEN');
    expect(readdirSync(s.logDir).sort()).toEqual(['a.log', 'b.log', 'c.log', 'd.log']);
  }, 60_000);

  it('never runs more scripts at once than the lanes allow', async () => {
    const stamp = `const fs=require('node:fs');const d=process.env.PORT_FILE_DIR;const n=process.argv[1].split('/').pop();
      fs.writeFileSync(d+'/'+n+'.start',String(Date.now()));setTimeout(()=>{fs.writeFileSync(d+'/'+n+'.end',String(Date.now()));console.log('  ✓ x');process.exit(0)},400);`;
    const names = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'];
    const s = scratch(Object.fromEntries(names.map((n) => [n, stamp])));
    const result = await lib.runAll({ dir: s.dir, names, lanes: 3, basePort: 7100, timeoutMs: 20_000, logDir: s.logDir, rerun: false, env: { PORT_FILE_DIR: s.root } });
    expect(result.ok).toBe(true);
    const spans = names.map((n) => [Number(readFileSync(join(s.root, `${n}.cjs.start`), 'utf8')), Number(readFileSync(join(s.root, `${n}.cjs.end`), 'utf8'))]);
    let most = 0;
    for (const [start] of spans) most = Math.max(most, spans.filter(([a, b]) => a <= start && start < b).length);
    expect(most).toBeLessThanOrEqual(3);
    expect(most).toBeGreaterThanOrEqual(2); // and they really do overlap
  }, 60_000);

  it('reruns what failed alone; a script that fails only under load is "PASS (on rerun)" and the run is green', async () => {
    const flaky = `const fs=require('node:fs');const f=process.env.PORT_FILE_DIR+'/flaky.seen';
      if(!fs.existsSync(f)){fs.writeFileSync(f,'1');console.log('  ✗ slow page\\n      timeout 5000ms exceeded');process.exit(1)}
      console.log('  ✓ slow page');process.exit(0);`;
    const s = scratch({ a: ok(2), flaky });
    const lines: string[] = [];
    const result = await lib.runAll({ dir: s.dir, names: ['a', 'flaky'], lanes: 2, basePort: 7200, timeoutMs: 20_000, logDir: s.logDir, env: { PORT_FILE_DIR: s.root }, log: (l: string) => lines.push(l) });
    expect(result.ok).toBe(true);
    expect(result.first.map((r: any) => r.status)).toEqual(['pass', 'fail']);
    expect(result.rerun.map((r: any) => r.name)).toEqual(['flaky']);
    const text = lib.summary(result, { lanes: 2, totalSeconds: 5 });
    expect(text).toMatch(/flaky\s+PASS \(on rerun\)/);
    expect(text).toContain('Failed in the full run but green alone (a busy machine, not a bug): flaky (1 check).');
    expect(text).toContain('RESULT: ALL GREEN');
    expect(lines.join('\n')).toContain('Rerunning the 1 that failed, alone, one at a time: flaky');
  }, 60_000);

  it('a script that really fails stays red after the rerun, with its failing lines in the summary', async () => {
    const s = scratch({ good: ok(1), broken: bad });
    const result = await lib.runAll({ dir: s.dir, names: ['good', 'broken'], lanes: 3, basePort: 7300, timeoutMs: 20_000, logDir: s.logDir });
    expect(result.ok).toBe(false);
    expect(result.rerun.map((r: any) => r.name)).toEqual(['broken']);
    expect(lib.summary(result, { lanes: 3, totalSeconds: 1 })).toContain('STILL FAILING after a rerun alone: broken.');
  }, 60_000);

  it('a script past its time limit is stopped (and what it left running with it) and counted as a timeout', async () => {
    const s = scratch({
      hang: `const {spawn}=require('node:child_process');
        const kid=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});
        require('node:fs').writeFileSync(process.env.PORT_FILE_DIR+'/kid.pid',String(kid.pid));
        console.log('  ✓ started');setInterval(()=>{},1000);`,
    });
    const result = await lib.runAll({ dir: s.dir, names: ['hang'], lanes: 1, basePort: 7400, timeoutMs: 1500, logDir: s.logDir, rerun: false, env: { PORT_FILE_DIR: s.root } });
    expect(result.final[0]).toMatchObject({ name: 'hang', status: 'timeout', passed: 1 });
    expect(lib.summary(result, { lanes: 1, totalSeconds: 2 })).toMatch(/hang\s+FAIL \(timeout\)/);
    const kid = Number(readFileSync(join(s.root, 'kid.pid'), 'utf8'));
    await new Promise((r) => setTimeout(r, 300));
    // Gone, or only a zombie waiting to be collected (a container without an init process keeps those around).
    let alive = true;
    try {
      process.kill(kid, 0);
      const state = readFileSync(`/proc/${kid}/stat`, 'utf8').split(') ')[1]?.[0];
      if (state === 'Z') alive = false;
    } catch {
      alive = false;
    }
    expect(alive).toBe(false); // the dev server the script started is gone too
  }, 60_000);

  it('a script that exits 0 but printed a ✗ is still a failure', async () => {
    const s = scratch({ sneaky: `console.log('  ✗ hidden problem');process.exit(0);` });
    const result = await lib.runAll({ dir: s.dir, names: ['sneaky'], lanes: 1, basePort: 7500, timeoutMs: 20_000, logDir: s.logDir, rerun: false });
    expect(result.final[0].status).toBe('fail');
  }, 60_000);
});

describe('the list and the wiring', () => {
  it('every script in e2e/suite.cjs exists, the list has no repeats, and npm run test:e2e goes through the runner', () => {
    expect(new Set(SCRIPTS).size).toBe(SCRIPTS.length);
    const files = new Set(readdirSync(join(ROOT, 'e2e')));
    for (const n of SCRIPTS) expect(files.has(`${n}.cjs`), n).toBe(true);
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).scripts as Record<string, string>;
    expect(pkg['test:e2e']).toBe('node e2e/all.cjs');
  });
  it('every script that says it is "also run by npm run test:e2e" is in the list, and the new ones are too', () => {
    for (const f of readdirSync(join(ROOT, 'e2e')).filter((x) => x.endsWith('.cjs'))) {
      const head = readFileSync(join(ROOT, 'e2e', f), 'utf8').slice(0, 1500);
      if (/also run by npm run test:e2e/.test(head)) expect(SCRIPTS, f).toContain(f.replace(/\.cjs$/, ''));
    }
    expect(SCRIPTS).toEqual(expect.arrayContaining(['auto-credit', 'money-visible', 'zip27', 'zip35', 'zip35-calm']));
  });
  it('no script in the list has a fixed port any more: each reads E2E_PORT', () => {
    for (const n of SCRIPTS) {
      const text = readFileSync(join(ROOT, 'e2e', `${n}.cjs`), 'utf8');
      expect(text, n).toMatch(/E2E_PORT/);
    }
  });
});
