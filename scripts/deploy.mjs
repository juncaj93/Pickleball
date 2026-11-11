// Zip 28 (Audit A, A-06): the deploy guard. `npm run deploy` used to run wrangler from whatever folder you were in: a detached checkout
// went to a preview called "HEAD" instead of live, and a messy folder would ship unsaved edits.
//
//   npm run deploy            PRODUCTION (the live site). Refuses unless you are on the `main` branch AND the folder has no unsaved changes.
//                             Always passes --branch main, so what it ships is exactly what git says main is.
//   npm run deploy:preview    A PREVIEW (the fake-data copy). Refuses a detached checkout (no branch name) and refuses `main`.
//                             Always passes --branch <your branch name>, so the preview has a clear name and can never be live.
//   Add `-- --dry-run` to see the decision and the command without building or deploying anything.
//
// The guard is in `decide()`; scripts/deploy.mjs only gathers the git facts and runs the commands. Documented in docs/DEPLOY.md.
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const PROJECT = 'pickleball-club';
const PRODUCTION_BRANCH = 'main';

/**
 * @param {'production'|'preview'} mode
 * @param {{ branch: string|null, dirty: boolean }} git  branch is null on a detached checkout
 * @returns {{ ok: boolean, branch?: string, warn?: string, message?: string }} message is the plain-English reason when not ok
 */
export function decide(mode, git) {
  if (mode !== 'production' && mode !== 'preview') return { ok: false, message: `Unknown deploy kind "${mode}". Use npm run deploy (live) or npm run deploy:preview.` };
  if (mode === 'production') {
    if (git.branch === null) return { ok: false, message: 'Not deploying to live: this folder is a detached checkout (no branch). Run `git checkout main` first, then try again.' };
    if (git.branch !== PRODUCTION_BRANCH) return { ok: false, message: `Not deploying to live: you are on "${git.branch}", not main. Live deploys come only from main. (For a practice copy use npm run deploy:preview.)` };
    if (git.dirty) return { ok: false, message: 'Not deploying to live: this folder has changes that are not saved in git. Commit or discard them first so live matches main exactly.' };
    return { ok: true, branch: PRODUCTION_BRANCH };
  }
  if (git.branch === null) return { ok: false, message: 'Not deploying a preview: this folder is a detached checkout (no branch), which would make a preview called "HEAD". Run `git checkout -b some-branch-name` first, then try again.' };
  if (git.branch === PRODUCTION_BRANCH) return { ok: false, message: 'Not deploying a preview from main: a main deploy is the LIVE site. Use npm run deploy for live, or switch to another branch for a preview.' };
  return { ok: true, branch: git.branch, warn: git.dirty ? 'This folder has unsaved changes; the preview will include them.' : undefined };
}

function gitFacts(cwd) {
  const run = (args) => {
    try {
      return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    } catch {
      return null;
    }
  };
  const branch = run(['symbolic-ref', '--short', '-q', 'HEAD']) || null; // empty / failing on a detached HEAD
  const status = run(['status', '--porcelain']);
  return { branch, dirty: status === null ? true : status.length > 0 }; // cannot read git: treat as dirty, never as clean
}

function main(argv) {
  const mode = argv.find((a) => !a.startsWith('--')) ?? 'production';
  // `npm run deploy --dry-run` (no `--` before the flag) is swallowed by npm and shows up here as an environment value: honor it too.
  const dry = argv.includes('--dry-run') || process.env.npm_config_dry_run === 'true';
  const result = decide(mode, gitFacts(process.cwd()));
  if (!result.ok) {
    console.error(result.message);
    return 1;
  }
  const args = ['wrangler', 'pages', 'deploy', 'dist', '--project-name', PROJECT, '--branch', result.branch, ...(mode === 'preview' ? ['--commit-dirty=true'] : [])];
  if (result.warn) console.warn(result.warn);
  console.log(`${mode === 'production' ? 'LIVE deploy' : 'Preview deploy'} from branch ${result.branch}: npx ${args.join(' ')}`);
  if (dry) return 0;
  const run = (cmd, a) => spawnSync(cmd, a, { stdio: 'inherit', shell: process.platform === 'win32' }).status ?? 1;
  const built = run('npm', ['run', 'build']);
  if (built !== 0) return built;
  return run('npx', args);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main(process.argv.slice(2)));
