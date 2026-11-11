// Zip 28: the Mac build check. A Mac (and Windows) treats File.ts and file.ts as ONE file; Cloudflare and Linux treat them as two.
// So a build that passes on Linux can pick the wrong file on a Mac, or fail there. This check fails when:
//   1. two tracked files have paths that differ only by upper/lower case (a/Foo.ts and a/foo.ts), or
//   2. two source files in one folder have the same name apart from case once the extension is dropped (DoNow.tsx and doNow.ts):
//      an import of './doNow' means a different file on a Mac than on Linux, or
//   3. a relative import spells a file's name with different case than the file on disk (import './domow' for DoMow.ts).
// Run: node scripts/check-file-names.mjs   (npm run check:names; also runs before npm run build, and tests/zip28.test.ts runs it).
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SOURCE = /\.(ts|tsx|js|jsx|mjs|cjs|mts|cts)$/;
const RESOLVE_EXT = ['', '.ts', '.tsx', '.d.ts', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts', '.json', '.css', '.svg', '.png'];

/** All tracked paths (plus new untracked ones that are not ignored), forward slashes. */
export function trackedFiles(root) {
  const out = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  // (A file deleted from the folder but not yet from git's list is not there on any machine: skip it.)
  return out.split('\0').filter((f) => f && existsSync(path.join(root, f)));
}

/**
 * Problems found in `files` (paths relative to `root`). `read(file)` returns a file's text; pass your own in tests.
 * @returns {string[]} one plain-English line per problem; empty when all is well.
 */
export function findNameProblems(files, read) {
  const problems = [];
  const exact = new Set(files);
  // 1. Paths that differ only by case.
  const byLower = new Map();
  for (const f of files) {
    const k = f.toLowerCase();
    byLower.set(k, [...(byLower.get(k) ?? []), f]);
  }
  for (const group of byLower.values()) if (group.length > 1) problems.push(`names that differ only by capital letters: ${group.join(' and ')}`);
  // 2. Same folder, same name without the extension apart from case (different spellings only: a.ts next to a.tsx is a normal pair).
  const byStem = new Map();
  for (const f of files) {
    if (!SOURCE.test(f)) continue;
    const dir = path.posix.dirname(f);
    const stem = path.posix.basename(f).replace(/\.d\.ts$|\.[^.]+$/, '');
    const k = `${dir}/${stem.toLowerCase()}`;
    byStem.set(k, [...(byStem.get(k) ?? []), { f, stem }]);
  }
  for (const group of byStem.values()) {
    const stems = new Set(group.map((g) => g.stem));
    if (stems.size > 1) problems.push(`two files in one folder whose names match apart from capitals: ${group.map((g) => g.f).join(' and ')} (an import means one file on Linux and another on a Mac)`);
  }
  // 3. Relative imports spelled with the wrong case.
  const specRe = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*)(['"])(\.{1,2}\/[^'"\n]*)\1/g;
  for (const f of files) {
    if (!SOURCE.test(f)) continue;
    let text;
    try {
      text = read(f);
    } catch {
      continue;
    }
    for (const m of text.matchAll(specRe)) {
      const spec = m[2].split('?')[0];
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(f), spec));
      const hit = RESOLVE_EXT.some((e) => exact.has(target + e)) || ['index.ts', 'index.tsx', 'index.js'].some((i) => exact.has(`${target}/${i}`));
      if (hit) continue;
      const lower = target.toLowerCase();
      const near = files.find((x) => RESOLVE_EXT.some((e) => x.toLowerCase() === lower + e) || ['index.ts', 'index.tsx', 'index.js'].some((i) => x.toLowerCase() === `${lower}/${i}`));
      if (near) problems.push(`${f} imports '${m[2]}' but the file is spelled ${near} (capital letters differ: fails on Linux or Cloudflare, or picks a wrong file on a Mac)`);
    }
  }
  return problems;
}

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let files;
  try {
    files = trackedFiles(root);
  } catch {
    // A copy of the code with no .git (a zip) or no git installed: there is no file list to check, so do not stop the build.
    console.warn('File name check skipped: no git file list here (no .git folder, or git is not installed).');
    process.exit(0);
  }
  const problems = findNameProblems(files, (f) => readFileSync(path.join(root, f), 'utf8'));
  if (problems.length > 0) {
    console.error('File name check FAILED (a Mac build could pick the wrong file):');
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log(`File name check passed (${files.length} files: no two differ only by capital letters, every import is spelled like its file).`);
}
