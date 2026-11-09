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

- Site (Pages): `npm run deploy` (from main). Rollback: the previous production deployment in Cloudflare (Workers & Pages >
  pickleball-club > Deployments > ... > Rollback).
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
