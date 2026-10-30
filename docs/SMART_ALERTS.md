# "Do this now" card and smart Telegram alerts

Times are Eastern (America/Detroit). Everything here runs on the Cloudflare
free plan and costs $0.

## What it does

- **Home card.** The top of the organizer's Home shows the one most urgent
  task, with "+N more" for the rest. Refund requests stay above it, as before.
- **Telegram.** The same words, with a link, at the times below. If the
  organizer already tapped the card's button, Telegram stays quiet.
- **One brain.** `nextTasks()` in `shared/tasks.ts` makes the list for both the
  card and Telegram, so they can't disagree.

Every time comes from the game's own start time, end time and cancellation
deadline. The deadline defaults to 12 hours before play and can be changed
per booking. Nothing assumes 8:00 PM. Each rule is one named constant at the
top of `shared/tasks.ts`. "Before" is counted on the wall clock, so the Sun
Nov 1 clock change doesn't shift anything.

| Rule (constant) | 7:00 PM game | 7:30 PM game | 8:00 PM game |
| --- | --- | --- | --- |
| Night-before last call: 25 hours before the start (`NIGHT_LAST_CALL_BEFORE_START_MIN`) | 6:00 PM day before | 6:30 PM | 7:00 PM |
| Cancel warning, under 4: 10 hours before the deadline (`CANCEL_WARNING_BEFORE_DEADLINE_MIN`) | 9:00 PM night before | 9:30 PM | 10:00 PM |
| Cancel follow-up: 30 minutes later (`CANCEL_FOLLOWUP_AFTER_WARNING_MIN`) | 9:30 PM | 10:00 PM | 10:30 PM |
| Game-day check: 45 minutes before the deadline (`GAMEDAY_CHECK_BEFORE_DEADLINE_MIN`) | 6:15 AM | 6:45 AM | 7:15 AM |
| Finalize: 5 minutes after the end (`FINALIZE_AFTER_END_MIN`) | 9:05 PM | 9:35 PM | 10:05 PM |
| Booking day, 14 days before (`BOOKING_ALERT_TIME`, `BOOKING_FOLLOWUP_TIME`) | 8:30 AM and 10:30 AM | same | same |

What each task shows and sends:

| Task | Card | Telegram |
| --- | --- | --- |
| Night before, from the last call until the start | Under 4: "Tuesday: 3 players in, need a 4th." + **Text the group** (Need players text, no recipients). At 4 or more: "Tuesday: 5 players in." + **Text the group to confirm** (Check-in text, no recipients) | At the last call, unless the text button was already tapped |
| From the cancel warning, under 4 | Checklist, in three steps:<br>1. Cancel the court (CourtReserve) + **Court canceled**<br>2. Cancel the session (the cancel prompt with the reason field)<br>3. Text everyone it's canceled (Canceled text to the signed-up numbers) | "Tuesday: only 3 players in. Cancel court: ...". The follow-up goes only if the game is still not canceled on the site |
| Game day | Same checklist. The words name the game's own deadline: "Tonight: only 3 players in. Cancel court before 7:00 AM." | At the game-day check, only if all of these hold:<br>• still under 4<br>• not canceled<br>• the deadline hasn't passed<br>• Court canceled wasn't tapped |
| Booking day | "Tue Nov 17 opened." (+ holiday name), with **Book on CourtReserve** and **I booked it** | 8:30 AM, and one follow-up at 10:30 AM, only while not marked booked |
| After the game | **Finalize who played** (opens the existing Finalize card). After finalizing, the existing "Final price" card offers the post-game note | At the finalize time, only if all of these hold:<br>• 4 or more played<br>• not canceled<br>• not finalized |

**Changing a game's time.** Do it from the game's menu (**Change time**) or
from Edit booking > Change time or date. Every alert time is worked out again
from the new time, on every tick:

- alerts not sent yet move to the new time
- alerts already sent are never sent again
- the card always shows the current situation.

**Usual time for new games.** Set it in Settings > Schedule (Usual start time
and Usual end time). It only shapes Tue and Thu games created after the change.
Existing games keep their times, and no day ever gets a second game.


Not sent for canceled games, past games, the demo, or Pretend it's.

## How it runs

```
Cloudflare cron (every 5 min)
  -> Worker "pickleball-alerts-clock" (worker/cron.ts, no public address)
     -> POST https://pickleball-club-9h0.pages.dev/api/cron/tick  (header X-Cron-Secret)
        -> server/tasks.ts cronTick: read games, counts and marks from D1,
           nextTasks(), send what came due in the last 60 minutes and wasn't sent
```

- The Worker holds no Telegram token and reads no data. The site sends with
  the Telegram secrets it already had. Both sides share one random secret,
  `CRON_SECRET`, set on the Pages project and on the Worker.
- **Once only.** Before sending, the tick writes a `sent` row into
  `task_log`. A unique index allows one per game and alert, so two ticks at
  once can't both send.
- **Failures.** A failed send gives its row back and writes a `failed` row
  with the reason.
  - It is retried at most every 15 minutes, up to 3 tries, and only inside
    the 60-minute window.
  - A tick stops at its first failure, so a Telegram outage can't use up the
    hour's alert budget that player alerts share.
  - If Telegram is too slow to answer, the message may still have arrived.
    The row is kept, so the alert is never sent twice.
  - `failed` rows older than 30 days are pruned.
- **Limits.** At most 5 alerts per tick. The existing cap of 20 Telegram
  messages an hour still applies.
- **Kill switch.** Settings > Alerts > Smart alerts. The main "Telegram
  alerts to me" switch also silences them. "Send TEST smart alert" sends one
  message that starts with "TEST".
- **Direct text link.** The night-before alert links to `/go/<token>`. That
  page opens Messages with the text filled in and no recipients. If the phone
  blocks the automatic open, it shows a big **Open Messages** button.
  - The token is signed with an HMAC derived from `CRON_SECRET`.
  - It names one game and does one thing: give out that game's night-before
    text and mark it opened.
  - It expires 6 hours after the alert, and never later than the game's start.
  - It holds no phone number and needs no sign-in.
  - Opening the page counts as tapping "Text the group". The card and the
    alert treat that text as handled, even if Messages didn't open.

### Database

`migrations/0015_task_log.sql` adds one new table, `task_log`. Nothing else
changes. The `kind` column says what each row is:

| kind | What it means |
| --- | --- |
| `mark` | The organizer tapped a card button |
| `sent` | An alert went to Telegram |
| `failed` | A send didn't go through |
| `off` | The Smart alerts switch is off |

Rows are deleted along with their game (ON DELETE CASCADE). A restore from a
backup file empties this table. Worst case, that resends an alert that came
due in the last hour.

## Free-plan math (limits read from developers.cloudflare.com, Oct 30, 2026)

| Limit (Free plan) | Real number | Our use |
| --- | --- | --- |
| Workers + Pages Functions requests | 100,000 a day per account (one shared pool) | 288 cron runs + 288 tick requests = 576 a day (0.6%) |
| Cron Triggers | 5 per account | 1 (the account had no Workers before) |
| CPU per invocation | 10 ms | Worker: one fetch, well under 1 ms of CPU. Tick: a few small queries and string work |
| Subrequests per invocation | 50 | Worker: 1. Tick: at most 5 Telegram calls |
| D1 rows read | 5,000,000 a day | About 200 rows a tick (detail below), so about 58,000 a day (1.2%) |
| D1 rows written | 100,000 a day | Only when something sends or a button is tapped: a few dozen a day |
| D1 storage | 500 MB per database, 5 GB per account | `task_log` grows by roughly 10 small rows per game |

Rows read per tick, with about 15 games in range and 6 players each:

| Read | Rows |
| --- | --- |
| Group | 1 |
| Alert switches | 1 |
| Smart alerts switch (indexed) | 0 to 1 |
| Games (the sessions table holds about 100 rows a year) | up to about 100 |
| Who's in (indexed by game) | about 90 |
| Marks and sent rows (indexed by game) | a few dozen |

The tick stops early when Telegram isn't connected or either switch is off.

On the Free plan, going over a limit returns an error. It never sends a bill:
Workers return error 1027, and D1 refuses queries until the daily reset at
00:00 UTC. Free never charges, so the cost stays $0.

One thing the docs don't confirm: whether cron runs count toward the 100,000
requests. The table counts them anyway.

## Turning it off

- **Pause:** Settings > Alerts > Smart alerts off. The card on Home stays.
- **Stop the clock:** `npx wrangler delete --config worker/wrangler.toml`.
  You can also delete the Worker "pickleball-alerts-clock" in the Cloudflare
  dashboard under Workers & Pages.
