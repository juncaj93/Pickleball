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

**Courts gate the alerts.** CourtReserve opens each date 14 days ahead at
7:00 AM, and courts also free up later when people cancel. A game only
counts as having a court once it is marked "court booked" (I booked it).
Until then it gets no last call, no cancel warning or follow-up, no game-day
cancel check, and no cancel-court steps on the card. Those start after the
tap, and only for alert times still ahead. If you book after a time has
passed, that alert is skipped, never sent late.

Every time comes from the game's own start time, end time and cancellation
deadline (default 12 hours before play, editable per booking). Nothing
assumes 8:00 PM. Each rule is one named constant at the top of
`shared/tasks.ts`. "Before" is counted on the wall clock, so the Sun Nov 1
clock change doesn't shift anything.

| Rule (constant) | 7:00 PM game | 7:30 PM game | 8:00 PM game |
| --- | --- | --- | --- |
| Night-before last call, booked only: 25 h before the start (`NIGHT_LAST_CALL_BEFORE_START_MIN`) | 6:00 PM day before | 6:30 PM | 7:00 PM |
| Cancel warning, booked and under 4: 10 h before the deadline (`CANCEL_WARNING_BEFORE_DEADLINE_MIN`) | 9:00 PM night before | 9:30 PM | 10:00 PM |
| Cancel follow-up: 30 min later (`CANCEL_FOLLOWUP_AFTER_WARNING_MIN`) | 9:30 PM | 10:00 PM | 10:30 PM |
| Game-day check, booked: 45 min before the deadline (`GAMEDAY_CHECK_BEFORE_DEADLINE_MIN`) | 6:15 AM | 6:45 AM | 7:15 AM |
| Morning-of no-court check, 4+ in: deadline + 15 min (`NO_COURT_CHECK_AFTER_DEADLINE_MIN`) | 7:15 AM | 7:45 AM | 8:15 AM |
| Finalize: 5 min after the end (`FINALIZE_AFTER_END_MIN`) | 9:05 PM | 9:35 PM | 10:05 PM |
| Booking heads-up and follow-up, 14 days before (`COURT_OPENS_TIME` 7:00 AM, `BOOKING_HEADS_UP_BEFORE_OPEN_MIN` 15, `BOOKING_FOLLOWUP_AFTER_OPEN_MIN` 30) | 6:45 AM and 7:30 AM | same | same |

What each task shows and sends, most urgent first:

| Task | Card | Telegram |
| --- | --- | --- |
| Cancel checklist (booked, under 4, from the cancel warning) | 1. Cancel the court + **Court canceled**<br>2. Cancel the session<br>3. Text everyone it's canceled<br>On game day the words name the deadline: "Tonight: only 3 players in. Cancel court before 7:00 AM." | Cancel warning ("Tuesday: only 3 players in. Cancel court: ...").<br>Follow-up only while the game is not canceled on the site.<br>Game-day check only before the deadline, if Court canceled wasn't tapped |
| Court opens today (the game exactly 14 days out, not booked) | "Thu Nov 26 opens at 7:00 AM (Thanksgiving)." (after 7:00, "opened"), with **Book on CourtReserve** and **I booked it** | 6:45 AM: "Thu Nov 26 opens at 7:00 AM (Thanksgiving). Book: ..." with the I booked it link. 7:30 AM: one reminder if still not booked |
| No court, 4 or more in, starts within 24 h | "Tonight: 5 in, no court yet. Check CourtReserve for an opening." with Book and I booked it | At the deadline + 15 min, silent once booked |
| Night before (booked) | "Tuesday: 3 players in, need a 4th." + **Text the group**, or "Tuesday: 5 players in." + **Text the group to confirm**. Either way, Messages opens with no recipients | At the last call, unless the text button was already tapped |
| Booked after the last call | One time: "Court booked for tonight. Text the group the game is on." + Check-in text, no recipients | None |
| After the game | **Finalize who played**. After that, the existing "Final price" card has the post-game note | At the finalize time, if 4 or more played and it isn't finalized yet |
| Other games with no court (next 2 only) | "Thu Nov 12 has no court yet." + **I booked it** | None |

**Changing a game's time.** Gear > Edit booking > Change time or date. The
end moves with the start (same length). Saving opens the existing Moved text
for the signed-up players and asks "Is the court booked for the new time?
Yes / No". The answer sets the court status. Every alert time is worked out
again from the new time:

- on the same day, alerts not sent yet move to the new time, and alerts
  already sent are never sent again
- moved to another day, it counts as a new game: its alerts and card taps
  start over
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
| Cron Triggers | 5 per account | 1. The account's other Worker, fantasy-analyst, uses 4, so the account is at 5 of 5 (checked Oct 30) |
| CPU per invocation | 10 ms | Worker: measured 0.5 to 0.8 ms. Tick (on the site): measured 12 to 30 ms on Oct 30, over the limit, but Cloudflare logged no errors and no "exceeded CPU" (see stage notes) |
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

## Finishing Deploy 2 (the clock) and Deploy 3 (direct text link)

Deploy 1 is live. The first session couldn't finish 2 and 3 for two reasons:
its safety rules block writing secrets, and its Cloudflare key can't create
Workers.

**Alex, before starting the new session:**
1. Cloudflare dashboard > My Profile > API Tokens. Edit the token Claude
   uses, add the permission **Account > Workers Scripts > Edit**, then save.
   The token text stays the same, so nothing else changes.
2. Start a new Claude session on this repo and paste:
   "Finish Deploy 2 and 3 from docs/SMART_ALERTS.md. I approve
   `npx wrangler pages secret put CRON_SECRET` and
   `npx wrangler secret put CRON_SECRET --config worker/wrangler.toml`."

**Claude, in the new session (deploy windows apply: never 5:00 to 10:30 PM on
game days):**

Deploy 2:
1. Pull the latest `main`.
2. Take a Time Travel bookmark: `npx wrangler d1 time-travel info pickleball`.
3. Make the secret: `openssl rand -hex 32` into a file in the scratch folder.
   Never commit it or show it.
4. Set it on the site:
   `npx wrangler pages secret put CRON_SECRET --project-name pickleball-club < file`.
5. Create the clock: `npx wrangler deploy --config worker/wrangler.toml`. That
   is one cron, `*/5 * * * *`, with no public address.
6. Set the same secret on the clock:
   `npx wrangler secret put CRON_SECRET --config worker/wrangler.toml < file`.
7. Redeploy the site from `main`, so it picks up the secret:
   `npm run build && npx wrangler pages deploy dist --project-name pickleball-club --branch main --commit-hash <sha>`.
8. Check it:
   - `POST https://pickleball-club-9h0.pages.dev/api/cron/tick` with header
     `X-Cron-Secret` answers `{"ok":true,"sent":0,...}`
   - the schedule shows up on the Worker
   - after 5 minutes, the Worker shows runs.

   Nothing real is due before Mon Nov 2, 7:00 PM, the last call for Tue Nov 3.

Deploy 3:
1. Take a bookmark.
2. Set `GO_LINKS = "on"` in `wrangler.toml`, commit it to `main`, and
   redeploy.
3. Alex taps "Send TEST smart alert" in Settings > Alerts. The TEST message
   includes a TEST direct text link for the next game. Opening it never marks
   anything done.
4. Alex tries it on his iPhone.
   - Rollback: set `GO_LINKS = "off"` and redeploy. Alerts then use the admin
     link.

**Turn it off:**
- Pause: Settings > Alerts > Smart alerts.
- Stop the clock: `npx wrangler delete --config worker/wrangler.toml`.
- Dashboard alternative: paste `worker/dashboard-paste.js` into a new Worker,
  add the cron `*/5 * * * *` and the settings `SITE_URL` (text) and
  `CRON_SECRET` (secret). Then add `CRON_SECRET` to the Pages project's
  Production secrets and redeploy the site.
