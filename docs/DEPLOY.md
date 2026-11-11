# Deploy checklist

The rules are in `docs/SITE_RULES.md` (DEPLOY WINDOWS); this is the short list of commands used at each deploy. Times Eastern.

## Before

1. Quiet window only (not from 6:00 PM the night before a game until 11:00 PM game night, and not in the hour after Alex texts the group).
2. Main equals live, the change is merged to main, and the full unit suite is green (`npm test`, `npx tsc -b`).
3. SQL backup of live (keep it out of git, it has phone numbers):
   `npx wrangler d1 export pickleball --remote --output live-before-<what>-<date>.sql`
4. Time Travel bookmark: `npx wrangler d1 time-travel info pickleball` (write the bookmark in the stage notes).
5. Integrity checks, all 21 columns should be 0 (read-only):
   `npx wrangler d1 execute pickleball --remote --command "$(grep -v '^\s*--' scripts/integrity-checks.sql)"`
6. Optional: `npm run restore-test` (docs/RESTORE_TEST.md). Read-only, about 10 seconds (its live export can hold the site's
   database for a second or two, like step 3). It proves the newest weekly copy
   and a fresh export of live load back with the same rows, money and integrity checks. Not required for a deploy.

## Deploy

- Database change first (only when this deploy adds a file under `migrations/`; Audit A, A-07). Check what is pending, then apply it BEFORE the
  site, so the new code never runs against a column that is not there yet:
  `npx wrangler d1 migrations list pickleball --remote` (must show only the new file; if anything else is listed, stop: it would be applied too),
  then `npm run db:migrate:remote`. The newest migration today is `0017_court`. A deploy with no new migration file skips this step.
- Site (Pages): `npm run deploy` (from main). It is GUARDED (Zip 28, Audit A, A-06): `scripts/deploy.mjs` refuses unless you are on the `main`
  branch AND the folder has no unsaved changes, then builds and ships with `--branch main` spelled out. From a detached checkout, from any
  other branch or from a messy folder it stops and says why; nothing is built or sent. (A first deploy from a detached checkout once went to a
  preview called "HEAD" instead of live.) `npm run deploy -- --dry-run` (note the `--` before it) shows what it would do without building or
  sending anything. The build also runs `npm run check:names` first (fails if two files differ only by capital letters, which breaks the
  build on a Mac). Rollback: the previous production deployment in Cloudflare (Workers & Pages > pickleball-club > Deployments > ... > Rollback).
- Preview (fake data, never live): `npm run deploy:preview` (Zip 28). It refuses a detached checkout (the preview would be called "HEAD") and
  refuses `main` (a main deploy is the live site), builds, and ships with `--branch <your branch name>`, so the preview has a clear name.
  An unsaved-changes folder is allowed for a preview (it warns). Same `-- --dry-run` option. A preview needs no rollback (just deploy again).
- Error box (`pickleball-error-box`, Zip 21, only when `worker/box.ts` or `shared/errorAlerts.ts` changed; BEFORE the site, which binds to it):
  `npx wrangler deploy --config worker/box.wrangler.toml`. Rollback: `npx wrangler rollback <version id> --config worker/box.wrangler.toml`.
- Clock Worker (`pickleball-alerts-clock`, only when `worker/` changed): `npx wrangler deploy --config worker/wrangler.toml`.
  Rollback: `npx wrangler rollback <version id> --config worker/wrangler.toml` (the version before, from
  `npx wrangler deployments list --config worker/wrangler.toml`).

## After

- Save the step 3 export where it is kept (only after a real deploy, never from tests; writes only to `pickleball-backups`):
  `node scripts/deploy-export.mjs save live-before-<what>-<date>.sql "<what was deployed>"`. It checks the saved copy against
  the file; then the local file can be deleted. `node scripts/deploy-export.mjs list` shows the saved ones (newest 10 kept).
- Read-only live check with the read-only PIN (SITE_RULES, "Live check with the read-only PIN").
- Integrity checks again (step 5).
- Write the deployment ID, the rollback ID, the bookmark and the test counts in `docs/STAGE_NOTES.md`.
- Price locks (Zip 27): a finalized game's price rules live in the switches table (`task_log`, task `price_lock`), which backup files skip. After a restore from a backup FILE the games follow the switches again (as before Zip 27); a Time Travel restore keeps them. After a file restore, switch the Settings rows back on as they were FIRST (a file restore turns them all off), then run the one-time lock below again.

## Zip 27 one-time step: lock the games finalized before Zip 27 (Alex OKed, Mon Nov 9)

Right after the Zip 27 site deploy, in the same quiet window. Read-only checks before and after; if any number differs, STOP, undo the locks (last command) and tell Alex.
1. Snapshot before (read-only PIN, never written down): `READONLY_PIN=... npx vite-node scripts/money-check.ts -- --base https://pickleball.juncaj.net --out <scratch>/before.json`
2. Dry run, then the write: `npx vite-node scripts/lock-finalized.ts -- --db pickleball`, then the same with `--apply` (writes only `task_log` price_lock rows; running it twice changes nothing; ends with "still without a lock: 0").
3. Snapshot after (same command, `--out <scratch>/after.json`), then `npx vite-node scripts/money-check.ts -- --compare <scratch>/before.json <scratch>/after.json` must say IDENTICAL. A difference from a player's tap in between shows on a seat; take the after snapshot again to tell the two apart.
4. Undo, only if step 3 differs: `npx wrangler d1 execute pickleball --remote --command "DELETE FROM task_log WHERE task = 'price_lock' AND at = '<the time lock-finalized printed>'"`, then snapshot again and compare with before.
