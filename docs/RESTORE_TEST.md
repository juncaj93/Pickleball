# Restore test (Zip 19)

Proves a backup can really be loaded back and gives the same data. Safe to run any time: it never changes anything on Cloudflare.

## Run it (one command)

On a computer with this project (the same setup used to deploy), in a terminal in the project folder:

```
npm run restore-test
```

It takes about 10 seconds and ends with `RESULT: PASS` or `RESULT: FAIL`. If it says FAIL, do not "fix" the live data from it; ask
Claude to look at the lines marked FAIL.

Other ways to run it:

- `npm run restore-test -- --weekly` the newest weekly copy only (or `--weekly 2026-11-08` for one week, as
  `node scripts/weekly-backup.mjs list` shows it)
- `npm run restore-test -- --live` only a fresh export of the live site
- `npm run restore-test -- --file pickleball-backup-2026-11-03.json` a file from Settings > Backup (no Cloudflare at all)

## What it does

1. Gets the backup, with read-only commands only:
   - the newest weekly copy from the private `pickleball-backups` database (plain SELECTs), and
   - a fresh export of live (`wrangler d1 export pickleball --remote`, a download; it is deleted when the test ends, since it has
     phone numbers).
2. Loads each one into a **throwaway database in memory** on this computer: every migration, then the same restore SQL
   `docs/RESTORE.md` step 1 makes (`scripts/restore-backup.mjs`), in one transaction, then the database's own foreign key check.
   The throwaway disappears when the test ends. It is never the live database and never `pickleball-preview`.
3. Compares the copy with the source:
   - **rows per table, and every value of every row** (all 10 backed-up tables);
   - for a weekly copy, the row counts it saved when it was made;
   - **money**: finalized games, canceled games, total credit (and how many players have some), cash marked paid, unpaid seats and
     what they owe, pending cash-outs;
   - **the 21 integrity checks** (`scripts/integrity-checks.sql`, the same ones run before and after each deploy): the same answer
     on the copy as on the source.
4. For live, it saves the export both ways a backup is made (the Settings > Backup file, which is also how weekly copies were
   saved before Zip 19, and the way the weekly copy saves it since Zip 19) and checks both.

The output has counts and dollar totals only: no names, no phone numbers.

"Source" means: for a live export, the export itself, loaded exactly as Cloudflare wrote it. For a weekly copy or a file, its
rows put into a separate throwaway database one at a time (not through the restore SQL), so a mistake in the restore shows up.

## Why it can never write to live

Every Cloudflare call goes through one function (`wrangler()` in `scripts/restore-test.ts`) that allows exactly two commands and
refuses everything else before it runs:

- `wrangler d1 export pickleball --remote --output <temp file>.sql`
- `wrangler d1 execute pickleball-backups --remote --json --command "SELECT ..."` (one plain SELECT, no `;`)

No `--file`, no command against the live database, no time travel, no migrations. `tests/restore-test.test.ts` checks a list
of writes is refused and that the command line is reached in that one place only.

## The NOTE about switches

The test prints a NOTE like "35 switch rows on the source (...) are not in a backup". That is true of every backup, before and
after Zip 19: the feature switches in Settings (and the Smart alerts switch, "Do this now" taps and sent alerts) live in the
`task_log` table, which a backup leaves out on purpose (`worker/backup.ts`, `BACKUP_LEFT_OUT`). **After a real restore, every
feature switch is off until set again.** To compare like for like, the test puts the source's switch rows into the copy before
the integrity checks (one check, "more in than max", depends on the Card cleanup switch).

## Result on Sun Nov 8, 2026, 3:56 PM Eastern (first run, live data)

PASS, 3 of 3:

- Weekly copy 2026-11-08 (made 3:00 AM, 131,208 characters, 2 pieces): 376 rows, every value matches; its saved counts match.
- Fresh export of live, as a Settings > Backup file and as the new weekly copy: 380 rows, every value matches.
- Money the same on both sides: 2 of 13 games finalized (5 canceled), total credit $0.00, paid in $84.00, owed $182.00 on 13
  unpaid seats, no pending cash-outs. All 21 integrity checks the same on the copy as on live (19 problem checks at 0).
