// Zip 28 (Audit A, A-06) and Zip 35 (A-06 leftover): the deploy guard. `npm run deploy` used to run wrangler from whatever folder you were in: a
// detached checkout went to a preview called "HEAD" instead of live, and a messy folder would ship unsaved edits. Zip 35 added the last two
// rules: GitHub's main and what is live, and loud hours.
//
//   npm run deploy            PRODUCTION (the live site). Refuses unless ALL of these hold, and says which rule stopped it:
//                               rule "branch"  you are on the `main` branch (not another branch, not a detached checkout)
//                               rule "dirty"   the folder has no unsaved changes
//                               rule "loud"    it is NOT loud hours (Mon and Wed from 6:00 PM through Tue and Thu 11:00 PM, Eastern),
//                                              unless you pass --override-loud-hours on purpose
//                               rule "github"  this folder's main is exactly GitHub's main (nothing unpushed, nothing to pull)
//                               rule "live"    what is live is part of main (live == main, or live is behind main and the commits this deploy
//                                              will ship are listed). Live on something main does not contain, or live unreadable: refused.
//                             Always passes --branch main, so what it ships is exactly what git says main is.
//   npm run deploy:preview    A PREVIEW (the fake-data copy). Refuses a detached checkout (no branch name) and refuses `main`.
//                             Always passes --branch <your branch name>, so the preview has a clear name and can never be live.
//                             None of the Zip 35 rules apply to a preview.
//   Add `-- --dry-run` to see the decision and the command without building or deploying anything (the rules still run, and still stop it).
//   Add `-- --override-loud-hours` to deploy inside loud hours on purpose (only that one rule; the others have no override).
//
// The rules are in `decide()` (pure, no clock, no git, no network: tests feed it fake facts and fake clocks); main() only gathers the facts
// and runs the commands. The hour after Alex texts the group is also a no-deploy time; the script cannot know that one (it prints a reminder).
// Documented in docs/DEPLOY.md.
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const PROJECT = 'pickleball-club';
const PRODUCTION_BRANCH = 'main';
const TZ = 'America/Detroit';
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Eastern weekday (0 = Sunday), hour and minute of a moment. */
function easternParts(nowMs) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).formatToParts(new Date(nowMs));
  const get = (t) => parts.find((p) => p.type === t)?.value ?? '';
  return { weekday: DAYS.indexOf(get('weekday')), hour: Number(get('hour')), minute: Number(get('minute')) };
}

/**
 * Loud hours (docs/SITE_RULES.md, DEPLOY WINDOWS): from 6:00 PM the night before a game (Monday and Wednesday) until 11:00 PM on game night
 * (Tuesday and Thursday). That is all day Tuesday and all day Thursday. Eastern. (The hour after Alex texts the group is not knowable here.)
 * @param {number} nowMs
 * @returns {{ loud: boolean, label: string }} label is the moment in words ("Tuesday 7:12 PM Eastern")
 */
export function loudHours(nowMs) {
  const { weekday, hour, minute } = easternParts(nowMs);
  const min = hour * 60 + minute;
  const loud = (weekday === 1 && min >= 18 * 60) || weekday === 2 || (weekday === 3 && min >= 18 * 60) || weekday === 4;
  // Game night ends at 11:00 PM: from then on Tuesday and Thursday are quiet again.
  const afterNight = (weekday === 2 || weekday === 4) && min >= 23 * 60;
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  const full = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][weekday];
  return { loud: loud && !afterNight, label: `${full} ${h12}:${String(minute).padStart(2, '0')} ${hour < 12 ? 'AM' : 'PM'} Eastern` };
}

/** When loud hours next end, in words (scans forward a minute at a time, never more than 3 days). */
export function nextQuiet(nowMs) {
  for (let m = 1; m <= 3 * 24 * 60; m++) {
    const at = nowMs + m * 60_000;
    if (!loudHours(at).loud) return loudHours(at).label;
  }
  return 'after the weekend';
}

/**
 * The rules. `git` is { branch, dirty }; for production `checks` (all optional, so older callers and previews are unchanged) is
 * { nowMs, overrideLoud, head, remoteMain, live } where
 *   head        this folder's HEAD commit (full hash)
 *   remoteMain  GitHub's main commit (full hash), or null when it could not be read
 *   live        { relation: 'same' | 'behind' | 'diverged' | 'unknown', sha?: string, behind?: number, ships?: string[] }
 * @param {'production'|'preview'} mode
 * @param {{ branch: string|null, dirty: boolean }} git  branch is null on a detached checkout
 * @param {{ nowMs?: number, overrideLoud?: boolean, head?: string|null, remoteMain?: string|null, live?: { relation: string, sha?: string, behind?: number, ships?: string[] } }} [checks]
 * @returns {{ ok: boolean, branch?: string, warn?: string, message?: string, rule?: string, notes?: string[] }} message is the plain-English reason when not ok; rule says which rule stopped it
 */
export function decide(mode, git, checks) {
  if (mode !== 'production' && mode !== 'preview') return { ok: false, rule: 'kind', message: `Unknown deploy kind "${mode}". Use npm run deploy (live) or npm run deploy:preview.` };
  if (mode === 'production') {
    if (git.branch === null) return { ok: false, rule: 'branch', message: 'Not deploying to live: this folder is a detached checkout (no branch). Run `git checkout main` first, then try again.' };
    if (git.branch !== PRODUCTION_BRANCH) return { ok: false, rule: 'branch', message: `Not deploying to live: you are on "${git.branch}", not main. Live deploys come only from main. (For a practice copy use npm run deploy:preview.)` };
    if (git.dirty) return { ok: false, rule: 'dirty', message: 'Not deploying to live: this folder has changes that are not saved in git. Commit or discard them first so live matches main exactly.' };
    const notes = [];
    if (checks && checks.nowMs !== undefined) {
      const t = loudHours(checks.nowMs);
      if (t.loud && !checks.overrideLoud) {
        return {
          ok: false,
          rule: 'loud',
          message: `Not deploying to live: it is ${t.label}, inside loud hours (Monday and Wednesday from 6:00 PM through Tuesday and Thursday 11:00 PM, Eastern). Loud hours end ${nextQuiet(checks.nowMs)}. If this is on purpose, run again with --override-loud-hours. (Also never in the hour after Alex texts the group; this check cannot see that.)`,
        };
      }
      if (t.loud) notes.push(`WARNING: loud hours (${t.label}); going ahead only because --override-loud-hours was passed.`);
    }
    if (checks && checks.head !== undefined) {
      const short = (s) => String(s).slice(0, 7);
      if (!checks.remoteMain) {
        return { ok: false, rule: 'github', message: "Not deploying to live: could not read GitHub's main (no network, or no access to origin). A live deploy must be exactly GitHub's main; try again when GitHub answers." };
      }
      if (checks.remoteMain !== checks.head) {
        return {
          ok: false,
          rule: 'github',
          message: `Not deploying to live: this folder's main (${short(checks.head)}) is not GitHub's main (${short(checks.remoteMain)}). Run \`git fetch origin main\`, then \`git checkout main && git pull --ff-only\` (or push what is only here), and try again.`,
        };
      }
      const live = checks.live ?? { relation: 'unknown' };
      if (live.relation === 'unknown') {
        return { ok: false, rule: 'live', message: `Not deploying to live: could not tell what is live${live.sha ? ` (live reports ${short(live.sha)}, which this folder does not have; run \`git fetch origin\`)` : ' (Cloudflare did not answer; check that wrangler is signed in)'}. The live site is not confirmed to be part of main, so nothing was built or sent.` };
      }
      if (live.relation === 'diverged') {
        return { ok: false, rule: 'live', message: `Not deploying to live: live is at ${short(live.sha ?? '')}, which is NOT part of main. Something was deployed to live from somewhere else, and this deploy would overwrite it. Find out what it was first.` };
      }
      if (live.relation === 'same') notes.push(`Live already equals main (${short(live.sha ?? checks.head)}). This deploy ships the same code again.`);
      else notes.push(`Live (${short(live.sha ?? '')}) is ${live.behind ?? '?'} commit${live.behind === 1 ? '' : 's'} behind main. This deploy ships: ${(live.ships ?? []).join('; ') || 'those commits'}.`);
    }
    return { ok: true, branch: PRODUCTION_BRANCH, ...(notes.length ? { notes } : {}) };
  }
  if (git.branch === null) return { ok: false, rule: 'branch', message: 'Not deploying a preview: this folder is a detached checkout (no branch), which would make a preview called "HEAD". Run `git checkout -b some-branch-name` first, then try again.' };
  if (git.branch === PRODUCTION_BRANCH) return { ok: false, rule: 'branch', message: 'Not deploying a preview from main: a main deploy is the LIVE site. Use npm run deploy for live, or switch to another branch for a preview.' };
  return { ok: true, branch: git.branch, warn: git.dirty ? 'This folder has unsaved changes; the preview will include them.' : undefined };
}

/** Parse `wrangler pages deployment list --json` (it prints warning lines first): the newest Production deployment's short commit, or null. */
export function liveShaFromList(text) {
  const end = text.lastIndexOf(']');
  let list = null;
  // The warning lines can hold a "[" of their own ("[WARNING]"): try each "[" that is followed by an object or "]" until one parses as the list.
  for (let i = text.indexOf('['); i >= 0 && i < end && list === null; i = text.indexOf('[', i + 1)) {
    if (!/^\[\s*[{\]]/.test(text.slice(i, i + 12))) continue;
    try {
      const parsed = JSON.parse(text.slice(i, end + 1));
      if (Array.isArray(parsed)) list = parsed;
    } catch {
      // not the list; keep looking
    }
  }
  if (!list) return null;
  const prod = list.find((d) => d && String(d.Environment).toLowerCase() === 'production' && typeof d.Source === 'string' && /^[0-9a-f]{7,40}$/i.test(d.Source));
  return prod ? prod.Source : null;
}

function gitRunner(cwd) {
  return (args) => {
    try {
      return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    } catch {
      return null;
    }
  };
}

function gitFacts(cwd) {
  const run = gitRunner(cwd);
  const branch = run(['symbolic-ref', '--short', '-q', 'HEAD']) || null; // empty / failing on a detached HEAD
  const status = run(['status', '--porcelain']);
  return { branch, dirty: status === null ? true : status.length > 0 }; // cannot read git: treat as dirty, never as clean
}

/** The network part, only for a live deploy that passed the local rules: GitHub's main, and what Cloudflare says is live. */
function liveFacts(cwd) {
  const run = gitRunner(cwd);
  const head = run(['rev-parse', 'HEAD']);
  const lsRemote = run(['ls-remote', 'origin', 'refs/heads/main']);
  const remoteMain = lsRemote ? (lsRemote.split(/\s+/)[0] || null) : null;
  let liveShort = null;
  const listed = spawnSync('npx', ['wrangler', 'pages', 'deployment', 'list', '--project-name', PROJECT, '--environment', 'production', '--json'], { cwd, encoding: 'utf8', shell: process.platform === 'win32' });
  if (listed.status === 0) liveShort = liveShaFromList(`${listed.stdout}`);
  if (!liveShort) return { head, remoteMain, live: { relation: 'unknown' } };
  const full = run(['rev-parse', '--verify', '--quiet', `${liveShort}^{commit}`]);
  if (!full) return { head, remoteMain, live: { relation: 'unknown', sha: liveShort } };
  if (full === head) return { head, remoteMain, live: { relation: 'same', sha: full } };
  const ancestor = spawnSync('git', ['merge-base', '--is-ancestor', full, head ?? 'HEAD'], { cwd, stdio: 'ignore' }).status;
  if (ancestor !== 0) return { head, remoteMain, live: { relation: 'diverged', sha: full } };
  const ships = (run(['log', '--oneline', '--no-decorate', `${full}..HEAD`]) ?? '').split('\n').filter(Boolean);
  return { head, remoteMain, live: { relation: 'behind', sha: full, behind: ships.length, ships } };
}

/**
 * @param {string[]} argv
 * @param {{ git?: () => { branch: string|null, dirty: boolean }, network?: () => object, now?: () => number, run?: (cmd: string, args: string[]) => number, out?: (s: string) => void, err?: (s: string) => void }} [deps]
 *   deps are for tests only (fake git facts, fake clock, nothing built or sent); the real script passes none.
 */
export function main(argv, deps = {}) {
  const out = deps.out ?? ((s) => console.log(s));
  const err = deps.err ?? ((s) => console.error(s));
  const mode = argv.find((a) => !a.startsWith('--')) ?? 'production';
  // `npm run deploy --dry-run` (no `--` before the flag) is swallowed by npm and shows up here as an environment value: honor it too.
  const dry = argv.includes('--dry-run') || process.env.npm_config_dry_run === 'true';
  const overrideLoud = argv.includes('--override-loud-hours');
  const now = deps.now ?? (() => Date.now());
  const git = (deps.git ?? (() => gitFacts(process.cwd())))();
  // Cheap local rules first (branch, unsaved changes, loud hours); the network facts are read only when those pass.
  let result = decide(mode, git, mode === 'production' ? { nowMs: now(), overrideLoud } : undefined);
  if (result.ok && mode === 'production') {
    const net = (deps.network ?? (() => liveFacts(process.cwd())))();
    result = decide(mode, git, { nowMs: now(), overrideLoud, ...net });
  }
  if (!result.ok) {
    err(result.message);
    if (result.rule && result.rule !== 'kind') err(`Stopped by the "${result.rule}" rule (docs/DEPLOY.md).`);
    return 1;
  }
  const args = ['wrangler', 'pages', 'deploy', 'dist', '--project-name', PROJECT, '--branch', result.branch, ...(mode === 'preview' ? ['--commit-dirty=true'] : [])];
  if (result.warn) console.warn(result.warn);
  for (const n of result.notes ?? []) out(n);
  out(`${mode === 'production' ? 'LIVE deploy' : 'Preview deploy'} from branch ${result.branch}: npx ${args.join(' ')}`);
  if (dry) return 0;
  const run = deps.run ?? ((cmd, a) => spawnSync(cmd, a, { stdio: 'inherit', shell: process.platform === 'win32' }).status ?? 1);
  const built = run('npm', ['run', 'build']);
  if (built !== 0) return built;
  return run('npx', args);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main(process.argv.slice(2)));
