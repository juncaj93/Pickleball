# Backups and restoring

## Making a backup

1. Sign in at pickleball.juncaj.net/admin.
2. Go to **Settings > Backup** and tap **Download backup file**.
3. You get a file named like `pickleball-backup-2026-11-03.json` (the date is Eastern).

The file has everything: settings, the PIN (scrambled, never the real digits),
every player with their phone number, every game, who signed up, payments,
refunds, credits, the Activity log, and which phones remember which name.
**It has phone numbers, so keep it private.** Don't text it or post it.

Good habit: download one at the start of each month, and before any big change.

The **Download CSV** button next to it is a spreadsheet report for reading. It
can't be restored from.

Cloudflare also keeps its own history of the database for the last 7 days
(called Time Travel), so a mistake from this week can be undone even without
a file.

## Restoring from a backup file

Restoring **replaces everything on the live site** with what's in the file.
Anything that happened after the backup was made (sign-ups, payments) is lost.
Organizer devices are signed out; sign in again with the PIN you had when the
backup was made. Players' phones keep their names.

You need a computer with this project on it, and Node installed (the same setup
used to deploy). In a terminal, in the project folder:

1. **Turn the file into database steps.** This prints a summary line, like
   "Backup made Tue, Nov 3, 9:54 PM Eastern (Pickleball Bros). Rows: ...", so
   you can check it's the right file:

   ```
   node scripts/restore-backup.mjs pickleball-backup-2026-11-03.json > restore.sql
   ```

2. **Try it on a practice copy first** (on your computer only, the live site is
   not touched):

   ```
   npx wrangler d1 migrations apply pickleball --local
   npx wrangler d1 execute pickleball --local --file restore.sql
   ```

   If both finish without a red error, the file is good.

3. **Make a safety copy of the live data as it is now**, in case you change your
   mind:

   ```
   npx wrangler d1 export pickleball --remote --output before-restore.sql
   ```

4. **Restore the live site:**

   ```
   npx wrangler d1 execute pickleball --remote --file restore.sql
   ```

5. Open pickleball.juncaj.net/admin, sign in, and check Home, Players and Money.

If step 4 shows a red error, stop there and ask Claude for help. The safety
copy from step 3 and Cloudflare's 7-day history (below) can both put things
back the way they were.

## Undoing a mistake from the last 7 days without a file

Cloudflare Time Travel can put the whole database back to a moment in the past
week:

```
npx wrangler d1 time-travel restore pickleball --timestamp=2026-11-03T21:00:00-05:00
```

The time is Eastern: `-05:00` in winter (EST), `-04:00` in summer (EDT). The
command prints a "bookmark" you can use to undo the undo.

## How this was tested

- `tests/decisions.test.ts` backs up a busy group (6 players, payments, credits,
  a canceled game with people in it, text links, Activity), restores it into an
  empty database and over changed data, and checks every row matches. After the
  restore the old PIN works and the money screens show the same numbers.
- By hand on Oct 27, 2026: a backup downloaded from the site, turned into
  `restore.sql` with step 1, and loaded twice into Cloudflare's own local
  database (step 2). All rows came back, including names with apostrophes and
  emoji, and the canceled game stayed canceled.

Backups made before Oct 28, 2026 (evening) have no Venmo field for players; they restore fine and leave it blank.

Backups made before the "any number from 4 to 10" change (Oct 29, 2026) have no
`refund_requests` table and no finalized state on games; they restore fine
(no refund requests, every game not finalized yet). A backup made after the change
restores onto a database that has migration 0013 applied; run the migrations first
(step 2 does that for the practice copy, and the live database already has them).
