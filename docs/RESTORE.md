# Backups and restoring

Plain-English steps. Times are Eastern. Every file and copy here has phone numbers: keep them private, never put them in git, a
text or a chat.

## What the backups are

There are four ways back, best first:

| Way back | How far back | What it brings back |
|---|---|---|
| **Time Travel** (Cloudflare's own history) | the last 7 days, to the minute | everything, exactly |
| **Deploy export** (taken before each deploy, `node scripts/deploy-export.mjs list`) | the newest 10 deploys | everything, exactly (loads only into an EMPTY database: ask Claude) |
| **Weekly copy** (every Sunday from 3:00 AM, `node scripts/weekly-backup.mjs list`) | the newest 8 weeks | the backup file below |
| **Backup file** (Settings > Backup > Download backup file) | whenever you downloaded one | see below |

### What the backup file and the weekly copy hold (since Zip 50, file version 2)

Everything a restore needs to give the site back as it was: settings, the PIN (scrambled, never the real digits), every player with
their phone number, every game, who signed up, payments, refunds, credits, the History log, which phones remember which name,
**every Settings > Feature switch, the price lock of every finalized game, Settings > Alerts, the venue months marked paid, the
Christmas choice, hidden canceled games, "Do this now" taps, the "already sent" marks of alerts, and the organizer sign-ins**
(stored scrambled; read-only PIN sign-ins are never in it: a helper signs in again).

Not in it, on purpose: the wrong-PIN counters and the spam counters (short-lived; a restore leaves them as they are).

**Older files (version 1, made before Sun Nov 15, 2026's Zip 50 deploy, and every weekly copy until the first Sunday after it,
Nov 22) still restore**, but WITHOUT the switches, price locks, alert settings and sign-ins: after such a restore every feature switch
is off, Settings > Alerts is all On, the venue months marked paid are forgotten, and finalized games are priced again at today's
rules (Audit C, M-2: the audit's October court cost $408 became $386). The restore script says so when it reads one ("old (version 1)
file"). Prefer Time Travel or a deploy export over an old file; Plan B step 1 says what to do if an old file is all there is.

**Never restore a file downloaded with the read-only PIN.** It has no PIN in it (nobody could sign in after) and the restore script
refuses it.

The **Download CSV** button next to it is a spreadsheet report for reading. It cannot be restored from.

Good habit: download a file at the start of each month and before any big change.

## Choose the way back

- The problem started in the last 7 days: **Plan A, Time Travel**.
- Older: **Plan B, a backup file or weekly copy**. If a deploy export is newer than the weekly copy you would use
  (`node scripts/deploy-export.mjs list`), ask Claude to load that instead.
- One wrong record (a seat, a payment): no restore. Fix it with the normal buttons (Players, Unmark, Remove player).

Both plans: pick a quiet time (not from 6:00 PM the night before a game until 11:00 PM game night, and not in the hour after a group
text). Everything after the moment you go back to is lost (sign-ups, payments, drops): write it down first from Admin > History.

The commands run in a terminal in the project folder on a computer with this project (the same setup used to deploy).

## Plan A: Time Travel (last 7 days)

1. Write down what will be lost: Admin > History, every sign-up, payment, drop and change after the moment you go back to.
2. Safety copy of live as it is now:
   `npx wrangler d1 export pickleball --remote --output before-restore-<date>.sql`, then
   `node scripts/deploy-export.mjs save before-restore-<date>.sql "before Time Travel restore"`. Then delete the local file.
3. Write down "now" so you can undo the undo: `npx wrangler d1 time-travel info pickleball`. Copy the bookmark it prints.
4. Health check now, keep its line:
   `npx wrangler d1 execute pickleball --remote --command "$(grep -v '^\s*--' scripts/integrity-checks.sql)"`
   Optional money snapshot (type the read-only PIN yourself, never write it down):
   `READONLY_PIN=... npx vite-node scripts/money-check.ts -- --base https://pickleball.juncaj.net --out <scratch>/before.json`
5. The bookmark to go back to: one written in docs/STAGE_NOTES.md (each deploy records one), or
   `npx wrangler d1 time-travel info pickleball --timestamp=2026-11-15T19:00:00-05:00` for a time just before the problem
   (`-05:00` is Eastern until March, then `-04:00`). Copy the bookmark.
6. Migrations after that moment? docs/STAGE_NOTES.md says when each went live (0021 and 0022: Sat Nov 14, about 3:00 PM). If the
   moment is before one, step 8 puts it back. The site keeps working in between.
7. Restore: `npx wrangler d1 time-travel restore pickleball --bookmark=<bookmark from step 5>`, answer y. It prints "To undo this
   operation, you can restore to the previous bookmark: ...": write that down too.
8. Migrations: `npx wrangler d1 migrations list pickleball --remote` should list only files newer than your moment (anything else:
   stop and ask). Then `npm run db:migrate:remote`, then
   `npx wrangler d1 execute pickleball --remote --command "$(grep -v '^\s*--' scripts/integrity-checks-extension.sql)"`.
9. Code: Time Travel changes only data. Roll the site back only if the problem was a bad deploy: Cloudflare Workers & Pages >
   pickleball-club > Deployments > the one before > Rollback.
10. Checks after: the health check (every column 0 except the `info_` ones), sign in at /admin with the PIN valid at that moment,
    look at Home, Players and Money; with a money snapshot, compare:
    `npx vite-node scripts/money-check.ts -- --compare <scratch>/before.json <scratch>/after.json`. Only changes made after the
    moment should differ.
11. By hand: redo the changes from step 1. Phones that signed in or picked a name after the moment do so again. An alert sent after
    the moment may go out once more within the hour. Write the bookmarks from steps 3, 5 and 7 in docs/STAGE_NOTES.md.
12. To undo the restore: `npx wrangler d1 time-travel restore pickleball --bookmark=<bookmark from step 7 or 3>`.

## Plan B: a backup file or weekly copy (older than 7 days)

1. **Get the file.** A weekly copy: `node scripts/weekly-backup.mjs list`, then `node scripts/weekly-backup.mjs get <week>` (writes
   `pickleball-backup-<week>.json`). Or Settings > Backup > Download backup file, signed in with the REAL PIN.
2. **Make the database steps** and read the summary line it prints:
   `node scripts/restore-backup.mjs pickleball-backup-<date>.json > restore.sql`
   It says when the file was made, the group, the rows and the **file version**.
   - "file version 2": everything comes back, switches and price locks included. Go on.
   - "old (version 1) file": the switches, price locks, alert settings and sign-ins are NOT in it. Before going on, save today's
     switch rows (keep the file private):
     `npx wrangler d1 execute pickleball --remote --json --command "SELECT * FROM task_log WHERE session_id IS NULL OR task IN ('price_lock','hidden_from_players')" > switches-<date>.json`
     If games were finalized under price rules that changed since, stop and ask Claude to load a deploy export instead (an old file
     cannot bring the price locks back).
   - "Could not read the backup: ... read-only PIN": the wrong file. Get one downloaded with the real PIN, or a weekly copy.
3. **Test it**, no Cloudflare involved: `npm run restore-test -- --file pickleball-backup-<date>.json`. It must end RESULT: PASS.
4. **Practice copy** (your computer only, live not touched):
   `npx wrangler d1 migrations apply pickleball --local`, then `npx wrangler d1 execute pickleball --local --file restore.sql`.
   No red errors means the file is good.
5. **Safety copy, "now" bookmark, health check and optional money snapshot:** Plan A steps 2 to 4.
6. **Restore live:** `npx wrangler d1 execute pickleball --remote --file restore.sql`. On a red error, stop: Time Travel to the step 5
   bookmark puts it back.
7. **Sign in** at /admin. With a version 2 file, a phone that was signed in when the file was made is still signed in; otherwise use
   the PIN from when the file was made. If you changed the PIN after the file was made (for example a lost phone), **change it again
   now** (Settings > Change PIN): that signs out every sign-in the file brought back.
8. **Check** Home, Players, Money (compare with the money snapshot if you took one) and the health check.
9. **Only for an old (version 1) file**, set back by hand from step 2's notes: the Feature switches, the price ones FIRST (Short games,
   Booking hours, Money rework, Late fees, Fee split, Extended time, Guest spot, Made cheaper after paying), then Settings > Alerts
   (Smart alerts comes back On), the Christmas choice, the Venue alert (cards already due will not show), and hide the canceled games
   again. Price locks: only if no price rule changed since the oldest finalized game, run the one-time lock in docs/DEPLOY.md;
   otherwise ask Claude.
10. **Redo by hand** everything after the file's time. Record the restore in docs/STAGE_NOTES.md. Delete the local files (phone
    numbers inside).

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

3. **Restore it** with Plan B below, using that file name.

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

## How this was tested

- `tests/zip50-backup.test.ts` (Zip 50): a fake world with 12 finalized games, then every price rule changed after, plus the
  Christmas choice, a hidden game, Settings > Alerts and a venue month marked paid. Backed up as a download and as a weekly copy,
  restored with the real script into an EMPTY database: every row of every table, every switch, every price lock, every alert setting
  and every money number on the organizer's and the players' screens are the same (October court cost $408 stays $408). Restoring
  over changed data puts the file back exactly. An old version 1 file still restores (and shows why version 2 was needed: $386). The
  read-only download is refused; a file from before Oct 29 no longer errors.
- `tests/decisions.test.ts` backs up a busy group (6 players, payments, credits, a canceled game with people in it, text links,
  Activity), restores it into an empty database and over changed data, and checks every row matches. After the restore the old PIN
  works and the money screens show the same numbers.
- By hand on Oct 27, 2026: a backup downloaded from the site, turned into `restore.sql` and loaded twice into Cloudflare's own local
  database. All rows came back, including names with apostrophes and emoji, and the canceled game stayed canceled.

## Older files, notes by date

Backups made before Oct 28, 2026 (evening) have no Venmo field for players; they restore fine and leave it blank.

Backups made before the "any number from 4 to 10" change (Oct 29, 2026) have no
`refund_requests` table and no finalized state on games; they restore fine
(no refund requests, every game not finalized yet). A backup made after the change
restores onto a database that has migration 0013 applied; run the migrations first
(step 2 does that for the practice copy, and the live database already has them).

Backups made after Zip 30 (migration 0018, phone codes) have a `device_tag` on each History line. They restore onto a database that has
migration 0018 applied (run the migrations first, as above); onto an older practice copy built from a checkout before Zip 30 they fail with
"no column named device_tag". Backups made before Zip 30 restore fine onto the new database (every line without a code). The restore test
(`npm run restore-test`) may say the rows lack a column when it checks a copy made before Zip 30 with the new code: expected until the first
weekly copy after the deploy. A backup downloaded with the read-only PIN has the phone codes blanked.


Before Zip 50 (file version 1), restoring a file also emptied `task_log` (every Feature switch off, "Do this now" taps and "already
sent" marks forgotten, price locks gone, Smart alerts back On), `organizer_alerts` (every Telegram alert type back On) and signed every
organizer out. "Error alerts" (Zip 21) is one of those switch rows: its error box (worker/box.ts) keeps a copy, and the clock tells
the box "off" within the hour after such a restore. A version 2 file brings all of these back.
