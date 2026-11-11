# Proposal: one database index so the 5-second check skips old games

Status: **waiting for Alex's OK, not before Wed Nov 4, 2026** (it is a database change).
Written Sun Nov 1, 2026. Times are Eastern. (Zip 28, Mon Nov 9: the file is now named `0018_...` because `0017_court` was taken by Zip 14; nothing else changed.)

## Why

Every open player screen asks the site "anything new?" every 5 seconds. To
answer, the site looks up the games that have not ended yet. Today the
database has no shortcut for "not ended yet", so it reads **every game ever
made** and throws the old ones away. With 8 games that is nothing. Two games a
week, every week, it grows: each check reads about 1 more row per game in the
history, a few times over.

Measured on live (read-only, Sun Nov 1): about 81 rows per check today, about
28% of the free plan's 5 million rows a day on a busy game day. Without the
index that share keeps climbing as the season goes on. The 5-minute alert tick
and the organizer screen run the same lookup.

## The exact change

One new index on the existing `sessions` table. Additive only: no column, no
row and no money record changes, and code that does not know about it keeps
working. Nothing players or the organizer see changes.

New file `migrations/0018_sessions_ends_at_index.sql`:

```sql
-- The "games not ended yet" lookup (5-second checks, the alert tick, Home)
-- reads only upcoming games instead of every game ever made.
-- Additive only: one index, no data change. Rollback: DROP INDEX (below).
CREATE INDEX IF NOT EXISTS idx_sessions_group_ends ON sessions (group_id, ends_at);
```

Checked on a local copy with the real migrations (`EXPLAIN QUERY PLAN`): the
three lookups the 5-second check runs switch from "every game of the group" to
"games with ends_at after now", and go back exactly as they were after the
rollback.

## How to run it (about 5 minutes, in a quiet window: not 5:00 to 10:30 PM on a game day)

1. Make sure nothing else is pending: `npx wrangler d1 migrations list pickleball --remote`
   must show only `0018_sessions_ends_at_index.sql`. If anything else is
   listed, stop: it would be applied too.
2. Restore point: `npx wrangler d1 time-travel info pickleball` (write down the
   bookmark) and `npx wrangler d1 export pickleball --remote --output before-0018.sql`
   (keep it out of git: it has phone numbers).
3. Add the file above to `migrations/`, run `npm test` (the test database
   applies every migration), commit, merge to main.
4. Apply: `npx wrangler d1 migrations apply pickleball --remote`.
5. Check (read-only):
   `npx wrangler d1 execute pickleball --remote --command "SELECT name FROM sqlite_master WHERE name = 'idx_sessions_group_ends'"`
   shows the index, and the health check still reads all zeros:
   `npx wrangler d1 execute pickleball --remote --command "$(grep -v '^\s*--' scripts/integrity-checks.sql)"`.
6. No code deploy is needed: the database starts using the index on its own.
7. Note the bookmark, the time and the result in `docs/STAGE_NOTES.md`.

## Rollback (seconds, no data touched)

```
npx wrangler d1 execute pickleball --remote --command "DROP INDEX IF EXISTS idx_sessions_group_ends"
```

The site keeps working the same way without it, just reading more rows. The
migration stays listed as applied, which is harmless. If you also want the
file gone, delete `migrations/0018_sessions_ends_at_index.sql` in the same
change. The Time Travel bookmark from step 2 is a last resort only: it would
also undo every sign-up and payment made after it.

## What it costs

$0. An index on about 100 rows a year is a few kilobytes. Each new or edited
game writes one extra index entry.
