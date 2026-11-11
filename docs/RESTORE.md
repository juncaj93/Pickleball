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
   "Backup made Tue, Nov 3, 9:54 PM Eastern (Pickleball). Rows: ...", so
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

## Weekly copies (automatic, since Zip 8)

Every Sunday from 3:00 AM Eastern, the 5-minute clock (the `pickleball-alerts-clock` Worker) saves a copy of the
live data into a private Cloudflare database called `pickleball-backups`. It is the same file the Backup button
downloads. The newest 8 copies are kept (about two months), so you have more than Time Travel's 7 days.
If a Sunday is missed, the copy is made within the hour once the last one is more than 8 days old.

- Where it lives: Cloudflare dashboard > Storage & Databases > D1 > `pickleball-backups`. Only your Cloudflare account
  can open it. It has no web address. It has phone numbers, so never copy it into git, a text or a chat.
- Cost: $0 (Cloudflare free plan; each copy is well under 1 MB).
- It only reads the live database. It cannot change anything on the site.

### Getting a weekly copy back as a backup file

On a computer with this project (the same setup used to deploy), in a terminal in the project folder:

1. **See the copies** (newest first, with the week and how many players and games each holds):

   ```
   node scripts/weekly-backup.mjs list
   ```

2. **Turn the one you want into a backup file** (use the week exactly as the list shows it):

   ```
   node scripts/weekly-backup.mjs get 2026-11-08
   ```

   This writes `pickleball-backup-2026-11-08.json`. It has phone numbers: keep it private.

3. **Restore it** with the steps in "Restoring from a backup file" above, starting at step 1 with that file name.
   Try it on the practice copy first (step 2 there), and make the safety copy (step 3 there) before touching the live site.

### Stopping or checking the copies

- Did last Sunday's copy happen? Step 1 above lists it. The Worker's logs (Cloudflare dashboard > Workers >
  `pickleball-alerts-clock` > Logs) also show a line "weekly backup 2026-11-08: ... bytes" each time one is made.
- Is it a good copy? Run the restore test: `npm run restore-test` (docs/RESTORE_TEST.md). It loads the newest copy and a fresh
  export of live into throwaway databases and compares every row, the money and the 21 integrity checks. Read-only.
- To stop the copies: remove the two `[[d1_databases]]` blocks at the end of `worker/wrangler.toml` and deploy the
  Worker (`npx wrangler deploy --config worker/wrangler.toml`). The alert clock keeps working either way.

### Asking for a copy now (since Zip 19)

`node scripts/weekly-backup.mjs ask` writes one tiny request row (only in `pickleball-backups`). At the top of the next hour
the clock makes a copy labeled like `2026-11-10-asked-2000` (its Eastern date and time), and `list` shows it. Get
it with `node scripts/weekly-backup.mjs get 2026-11-08-asked-2000` and test it with `npm run restore-test -- --weekly 2026-11-08-asked-2000`.
An asked copy never changes when the regular Sunday copy is made. The newest 3 asked copies are kept on top of the newest 8 regular ones.

### Deploy exports (since Zip 19)

The SQL export of live taken before each deploy is saved in `pickleball-backups` too (the newest 10 kept, free):
`node scripts/deploy-export.mjs list`, then `node scripts/deploy-export.mjs get <id>` writes the `.sql` file back. It is a whole
database export (every table, switches included), so it loads into an EMPTY database, not over the live one: within 7 days, Time
Travel (below) is the quicker way back; after that, ask Claude to load it (it can be checked first in a throwaway copy).

### Copies made in steps (since Zip 19)

The copy is the same file as before, but it is made in small steps (about 60,000 characters each), each its own run of the clock
Worker, so it stays well under the free plan's CPU guideline however big the data gets (one big run took about 13 ms on Nov 8).

- An unfinished copy (a step failed, or the data changed while copying) is **never** listed by `list`, never fetched by `get`, and
  never used by the restore test: it has no row in `weekly_backups` until its last step is saved. `list` shows it on its own line as
  `INCOMPLETE ... Not usable`. The next hourly look clears its pieces and starts over. Finished copies are never touched by that.
- All steps run within a few seconds, and the copy checks at the end that no table changed while it was copying (row counts, row
  numbers, sizes and the money columns); if one did, the attempt is thrown away and redone the next hour, so a copy is still one moment.
- To go back to the one-run copy: remove the `[[services]]` block (SELF) at the end of `worker/wrangler.toml` and deploy the
  Worker. The steps then run inside the knock's run (same file, more CPU in that run, and about two database calls per step in
  that one run, so only for today's size, not for a copy many times bigger).
- Never delete the `pickleball-backups` database unless you mean to throw every weekly copy away.

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

Restoring a backup file also empties the "Do this now" log (`task_log`, Nov 2026): which card buttons were
tapped, which smart alerts went out, and the Smart alerts switch. After a restore, check Settings > Alerts >
Smart alerts (it comes back On), and done tasks may show on Home again until tapped. An alert that came due
in the hour before the restore could be sent once more.

**Feature switches too (found by the restore test, Zip 19):** every switch in Settings > Feature switches is stored in that
same `task_log` table, so after a restore **every feature switch is off** until it is turned on again (35 rows on live on
Nov 8). The Telegram alert switches (Settings > Alerts, the `organizer_alerts` table) also come back all On. Before a real
restore, write down which switches are on (or run `npm run restore-test -- --live`, whose NOTE line lists them), and set
them again afterwards. Hidden games and players (Hide from list) are in `task_log` too and show again.
"Error alerts" (Zip 21) is one of those rows. Its error box (worker/box.ts) keeps a copy, and the clock tells the box "off" within
the hour after a restore, so nothing is sent while Settings shows it off. Switch it on again in Settings if wanted.
