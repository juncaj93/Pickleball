# Behind-the-scenes audit: scenarios (Sun Nov 1, 2026)

Area: alerts and the clock Worker, Telegram, time, sign-in and security, data
integrity, free plan limits, backups, deploy settings, docs. Player and organizer
screens belong to the other two audit channels. Times are Eastern.

Status words: **Pass** (tested, works as the rules say), **Fixed** (was wrong,
fixed, with a permanent test), **By design** (works as built and documented;
listed so nobody "fixes" it), **Question** (might be on purpose: asked Alex),
**Read-only live** (checked on the live site without changing anything).

Test files new in this audit: `tests/audit-behind-clock.test.ts`,
`tests/audit-behind-telegram.test.ts`, `tests/audit-behind-security.test.ts`,
`tests/audit-behind-integrity.test.ts`, `tests/audit-behind-time.test.ts`,
`scripts/integrity-checks.sql`. Older tests that already covered a scenario are named.

## 1. Clock and alerts

| # | Scenario | Expected by the rules | Status | Test |
|---|---|---|---|---|
| 1 | Last call (booked game): due on a punctual tick | Sent once on the first tick at or after 25 wall-clock hours before the start; "Tuesday: 3 players in, need a 4th. Text the group" | Pass | audit-behind-clock (five-week walk vs independent rules) |
| 2 | Last call (booked game): next 12 ticks | Never sent again | Pass | audit-behind-clock |
| 3 | Last call (booked game): two ticks at the same moment | One message (claimed in task_log before sending) | Pass | audit-behind-clock, smart-tasks |
| 4 | Last call (booked game): tick 20 minutes late | Sent once, late, same words | Pass | audit-behind-clock |
| 5 | Last call (booked game): clock down more than an hour | Dropped (catch-up is 60 minutes); Home card still shows the task | By design | audit-behind-clock |
| 6 | Cancel court warning (booked, under 4): due on a punctual tick | Sent once on the first tick at or after 10 hours before the cancel-by time; CourtReserve link | Pass | audit-behind-clock (five-week walk vs independent rules) |
| 7 | Cancel court warning (booked, under 4): next 12 ticks | Never sent again | Pass | audit-behind-clock |
| 8 | Cancel court warning (booked, under 4): two ticks at the same moment | One message (claimed in task_log before sending) | Pass | audit-behind-clock, smart-tasks |
| 9 | Cancel court warning (booked, under 4): tick 20 minutes late | Sent once, late, same words | Pass | audit-behind-clock |
| 10 | Cancel court warning (booked, under 4): clock down more than an hour | Dropped (catch-up is 60 minutes); Home card still shows the task | By design | audit-behind-clock |
| 11 | Cancel follow-up: due on a punctual tick | Sent once on the first tick at or after 30 minutes after the warning; plain words, Open site button | Pass | audit-behind-clock (five-week walk vs independent rules) |
| 12 | Cancel follow-up: next 12 ticks | Never sent again | Pass | audit-behind-clock |
| 13 | Cancel follow-up: two ticks at the same moment | One message (claimed in task_log before sending) | Pass | audit-behind-clock, smart-tasks |
| 14 | Cancel follow-up: tick 20 minutes late | Sent once, late, same words | Pass | audit-behind-clock |
| 15 | Cancel follow-up: clock down more than an hour | Dropped (catch-up is 60 minutes); Home card still shows the task | By design | audit-behind-clock |
| 16 | Game-day check (booked, under 4): due on a punctual tick | Sent once on the first tick at or after 45 minutes before cancel-by, only before cancel-by | Pass | audit-behind-clock (five-week walk vs independent rules) |
| 17 | Game-day check (booked, under 4): next 12 ticks | Never sent again | Pass | audit-behind-clock |
| 18 | Game-day check (booked, under 4): two ticks at the same moment | One message (claimed in task_log before sending) | Pass | audit-behind-clock, smart-tasks |
| 19 | Game-day check (booked, under 4): tick 20 minutes late | Sent once, late, same words | Pass | audit-behind-clock |
| 20 | Game-day check (booked, under 4): clock down more than an hour | Dropped (catch-up is 60 minutes); Home card still shows the task | By design | audit-behind-clock |
| 21 | Booking heads-up (no court): due on a punctual tick | Sent once on the first tick at or after 6:45 AM, 14 days before | Pass | audit-behind-clock (five-week walk vs independent rules) |
| 22 | Booking heads-up (no court): next 12 ticks | Never sent again | Pass | audit-behind-clock |
| 23 | Booking heads-up (no court): two ticks at the same moment | One message (claimed in task_log before sending) | Pass | audit-behind-clock, smart-tasks |
| 24 | Booking heads-up (no court): tick 20 minutes late | Sent once, late, same words | Pass | audit-behind-clock |
| 25 | Booking heads-up (no court): clock down more than an hour | Dropped (catch-up is 60 minutes); Home card still shows the task | By design | audit-behind-clock |
| 26 | Booking follow-up (no court): due on a punctual tick | Sent once on the first tick at or after 7:30 AM the same day | Pass | audit-behind-clock (five-week walk vs independent rules) |
| 27 | Booking follow-up (no court): next 12 ticks | Never sent again | Pass | audit-behind-clock |
| 28 | Booking follow-up (no court): two ticks at the same moment | One message (claimed in task_log before sending) | Pass | audit-behind-clock, smart-tasks |
| 29 | Booking follow-up (no court): tick 20 minutes late | Sent once, late, same words | Pass | audit-behind-clock |
| 30 | Booking follow-up (no court): clock down more than an hour | Dropped (catch-up is 60 minutes); Home card still shows the task | By design | audit-behind-clock |
| 31 | Morning-of no-court check (4+ in): due on a punctual tick | Sent once on the first tick at or after 15 minutes after cancel-by, only within 24 hours of the start | Pass | audit-behind-clock (five-week walk vs independent rules) |
| 32 | Morning-of no-court check (4+ in): next 12 ticks | Never sent again | Pass | audit-behind-clock |
| 33 | Morning-of no-court check (4+ in): two ticks at the same moment | One message (claimed in task_log before sending) | Pass | audit-behind-clock, smart-tasks |
| 34 | Morning-of no-court check (4+ in): tick 20 minutes late | Sent once, late, same words | Pass | audit-behind-clock |
| 35 | Morning-of no-court check (4+ in): clock down more than an hour | Dropped (catch-up is 60 minutes); Home card still shows the task | By design | audit-behind-clock |
| 36 | Finalize (4+ played): due on a punctual tick | Sent once on the first tick at or after 5 minutes after the end, until finalized | Pass | audit-behind-clock (five-week walk vs independent rules) |
| 37 | Finalize (4+ played): next 12 ticks | Never sent again | Pass | audit-behind-clock |
| 38 | Finalize (4+ played): two ticks at the same moment | One message (claimed in task_log before sending) | Pass | audit-behind-clock, smart-tasks |
| 39 | Finalize (4+ played): tick 20 minutes late | Sent once, late, same words | Pass | audit-behind-clock |
| 40 | Finalize (4+ played): clock down more than an hour | Dropped (catch-up is 60 minutes); Home card still shows the task | By design | audit-behind-clock |
| 41 | Telegram slow (no answer in 5 s) | Kept as sent: never sent twice (a missed alert beats a double) | Pass | audit-behind-clock |
| 42 | Telegram error 500 | Retried 15 and 30 minutes later, max 3 tries, sent once | Pass | audit-behind-clock |
| 43 | No network to Telegram | Same as 500; the site keeps working | Pass | audit-behind-clock |
| 44 | Telegram 429 (slow down) | Counted as a try, retried later | Pass | smart-tasks |
| 45 | Hour cap (20 alerts) reached | Smart alert waits for the next tick, not counted as a try | Pass | smart-tasks |
| 46 | Player taps and ticks together past 20 in an hour | Never more than 20 messages | Pass | audit-behind-telegram |
| 47 | A tick that sends 5 alerts | Stops at 5 per tick (a bug can't flood) | Pass | code: MAX_PER_TICK |
| 48 | Game moved later the same day after its last call | Last call not repeated; unsent alerts follow the new time | Pass | audit-behind-clock |
| 49 | Game moved to another day | Its alerts start over for the new day | Pass | audit-behind-clock |
| 50 | Game canceled between the warning and the follow-up | No follow-up, no game-day check | Pass | audit-behind-clock |
| 51 | Court switched to Waitlist after the last call | No cancel warnings (there is no court to cancel) | Pass | audit-behind-clock |
| 52 | Court switched back to Booked late | Alerts whose time passed before the booking never go | Pass | smart-tasks |
| 53 | Finalized before 5 minutes after the end | No finalize alert | Pass | audit-behind-clock |
| 54 | Night text tapped on the card (or /go/ link opened) | Telegram stays quiet for that alert | Pass | smart-tasks, go-link |
| 55 | Court canceled tapped on the card | No more cancel or game-day alerts | Pass | five-week walk |
| 56 | Smart alerts switch off | Tick sends nothing; card stays | Pass | smart-tasks |
| 57 | Main Telegram switch off | Tick and player alerts send nothing | Pass | smart-tasks |
| 58 | Game before the first session date | Silent | Pass | smart-tasks |
| 59 | No group yet / Telegram not connected | Tick answers ok, sends nothing | Pass | smart-tasks |
| 60 | Wrong, short or missing cron secret | 404, nothing sent | Pass | smart-tasks, audit-behind-security |
| 61 | Restore from a backup file | task_log empties: an alert due in the hour before could go once more | By design | docs/RESTORE.md |
| 62 | First real alert Mon Nov 2, 7:00 PM (Tue Nov 3, 8 PM, booked, 3 in on live) | One message at 7:00 PM: "Tuesday: 3 players in, need a 4th." with the direct text link; then 10:00 PM cancel warning and 10:30 PM follow-up if still 3 | Pass (live data read-only, replayed locally) | audit-behind-clock |
| 63 | Thu Nov 5 (live: court on Waitlist, 2 in) | No booked-game alerts; morning-of check only if 4+ | Pass (read-only live) | five-week walk |
| 64 | Tue Nov 17 (live: no court) | Booking heads-up Tue Nov 3 6:45 AM, follow-up 7:30 AM | Pass (read-only live) | audit-behind-clock |
| 65 | Player alerts: drop within 36 hours, falls below 4, reaches 4 | One message per tap, names and game time only | Pass | telegram-alerts |
| 66 | Cash-out request alert | First name and amount only, one per player per hour | Pass | telegram-alerts, audit-stage3 |
| 67 | Cash out used for a game | One line under the Refund requests switch | Pass | auto-credit |
| 68 | Alerts never contain phone numbers, Venmo names or money (except cash outs) | Checked on every message of the five-week walk | Pass | audit-behind-clock |
| 69 | Clock Worker misses a few runs (live: 282 of 288 on Oct 31) | Next run catches up within the hour | Read-only live | Cloudflare analytics |
| 70 | Clock Worker errors (live) | 0 errors Oct 30 to Nov 1 | Read-only live | Cloudflare analytics |

## 2. Time

| # | Scenario | Expected by the rules | Status | Test |
|---|---|---|---|---|
| 71 | Ticks through the repeated 1 AM hour on Sun Nov 1 | Every tick a distinct moment, nothing sent twice | Pass | audit-behind-clock |
| 72 | Game on Sun Nov 1 7 PM: last call | Sat 6:00 PM EDT (25 wall-clock hours before) | Pass | audit-behind-clock |
| 73 | Same game: cancel warning, follow-up, game-day check | Sat 9:00, 9:30 PM EDT; Sun 6:15 AM EST | Pass | audit-behind-clock |
| 74 | Tue Nov 3 8 PM after the change | Shows 8:00 PM, cancel by Tue 8:00 AM | Pass | audit-behind-time |
| 75 | 1:30 AM twice on Nov 1 | Shown as 1:30 AM both times | Pass | audit-behind-time |
| 76 | Every displayed time | AM/PM, no seconds, no 24-hour, no UTC (checked every 15 minutes over 3 days) | Pass | audit-behind-time |
| 77 | Year change: games planned Dec 27 to Jan 8 | Tue Dec 29, Thu Dec 31, Tue Jan 5, Thu Jan 7 at the usual time | Pass | audit-behind-time |
| 78 | Week words across New Year | This week / Next week / Week of Jan 11 | Pass | audit-behind-time |
| 79 | Month change (Nov to Dec) | Next week label right | Pass | audit-behind-time |
| 80 | Thanksgiving Thu Nov 26 | Named as a holiday; court opens Thu Nov 12 7:00 AM; last call Wed 6:00 PM | Pass | audit-behind-time |
| 81 | Spring clock change Mar 14 2027 | Typed 8:00 PM stays 8:00 PM (EDT) | Pass | audit-behind-time |
| 82 | Organizer types a time on a phone in another time zone | Read as Eastern (group zone), never the phone's zone | Pass | code: fromLocalInputValue, audit-behind-time |
| 83 | Times stored | UTC in the database, shown in America/Detroit | Pass | code review |
| 84 | Any display using the phone's own zone | None found (searched src, shared, server) | Pass | code search |
| 85 | Cancel-by on a game the day of a clock change | Start minus 12 real hours (could read 1 hour off the wall clock); no such game exists | By design | code: cancelByIso |
| 86 | Older 7:00 and 7:30 PM games | All alerts follow each game's own time | Pass | dryrun-times, tick-golden |

## 3. Telegram

| # | Scenario | Expected by the rules | Status | Test |
|---|---|---|---|---|
| 87 | Player named "Bob: https://evil.example" drops out | Name shown as typed; never hidden link words | Fixed | audit-behind-telegram |
| 88 | Name with underscores, asterisks, <b>, &, quotes | Arrives as plain letters (no parse mode) | Pass | audit-behind-telegram |
| 89 | Name with emoji and accents | Arrives intact | Pass | audit-behind-telegram |
| 90 | Name with SQL characters | Stored and sent as plain text | Pass | audit-behind-telegram |
| 91 | Only links: Text the group (/go/), Cancel court / Book / Check CourtReserve, Open site button | Every link in every message is the site or CourtReserve | Pass | audit-behind-telegram, telegram-links |
| 92 | /admin words | Plain words; the Open site button opens /admin | Pass | telegram-links |
| 93 | Link previews | Turned off | Pass | audit-behind-telegram |
| 94 | 10 forty-letter names in one alert | Under 1,200 characters (limit 4,096) | Pass | audit-behind-telegram |
| 95 | Bot token in answers, Settings, errors, logs | Never (tested with errors that carry the token) | Pass | audit-behind-telegram |
| 96 | Bot token in the repo or built files | None | Pass | audit-behind-security, dist scan |
| 97 | Telegram hangs during a player tap | The tap answers at once; the alert runs in the background | Pass | audit-behind-telegram |
| 98 | TEST smart alert | One line starting TEST, TEST direct link marks nothing | Pass | smart-tasks, go-link |
| 99 | /go/ link: forged, expired, wrong game, after the start, canceled game | 404 or 410, plain words | Pass | go-link |
| 100 | /go/ link with GO_LINKS off | 404; alerts use the plain words | Pass | go-link |

## 4. Sign-in and security

| # | Scenario | Expected by the rules | Status | Test |
|---|---|---|---|---|
| 101 | GET /api/admin/dashboard with no cookie, a player cookie, a made-up cookie, a signed-out cookie | 401, nothing changes | Pass | audit-behind-security |
| 102 | GET /api/admin/activity with no cookie, a player cookie, a made-up cookie, a signed-out cookie | 401, nothing changes | Pass | audit-behind-security |
| 103 | POST /api/admin/sessions with no cookie, a player cookie, a made-up cookie, a signed-out cookie | 401, nothing changes | Pass | audit-behind-security |
| 104 | POST /api/admin/sessions/:id/me with no cookie, a player cookie, a made-up cookie, a signed-out cookie | 401, nothing changes | Pass | audit-behind-security |
| 105 | PUT /api/admin/group with no cookie, a player cookie, a made-up cookie, a signed-out cookie | 401, nothing changes | Pass | audit-behind-security |
| 106 | POST /api/admin/pin with no cookie, a player cookie, a made-up cookie, a signed-out cookie | 401, nothing changes | Pass | audit-behind-security |
| 107 | POST /api/admin/rotate-link with no cookie, a player cookie, a made-up cookie, a signed-out cookie | 401, nothing changes | Pass | audit-behind-security |
| 108 | POST /api/admin/players with no cookie, a player cookie, a made-up cookie, a signed-out cookie | 401, nothing changes | Pass | audit-behind-security |
| 109 | PUT /api/admin/players/:id with no cookie, a player cookie, a made-up cookie, a signed-out cookie | 401, nothing changes | Pass | audit-behind-security |
| 110 | DELETE /api/admin/players/:id with no cookie, a player cookie, a made-up cookie, a signed-out cookie | 401, nothing changes | Pass | audit-behind-security |
| 111 | POST /api/admin/sessions/generate with no cookie, a player cookie, a made-up cookie, a signed-out cookie | 401, nothing changes | Pass | audit-behind-security |
| 112 | PUT /api/admin/sessions/:id/booking with no cookie, a player cookie, a made-up cookie, a signed-out cookie | 401, nothing changes | Pass | audit-behind-security |
| 113 | PUT /api/admin/sessions/:id/time with no cookie, a player cookie, a made-up cookie, a signed-out cookie | 401, nothing changes | Pass | audit-behind-security |
| 114 | POST /api/admin/sessions/:id/decision with no cookie, a player cookie, a made-up cookie, a signed-out cookie | 401, nothing changes | Pass | audit-behind-security |
| 115 | POST /api/admin/sessions/:id/roster with no cookie, a player cookie, a made-up cookie, a signed-out cookie | 401, nothing changes | Pass | audit-behind-security |
| 116 | POST /api/admin/sessions/:id/payment with no cookie, a player cookie, a made-up cookie, a signed-out cookie | 401, nothing changes | Pass | audit-behind-security |
| 117 | POST /api/admin/sessions/:id/claim with no cookie, a player cookie, a made-up cookie, a signed-out cookie | 401, nothing changes | Pass | audit-behind-security |
| 118 | POST /api/admin/sessions/:id/finalize with no cookie, a player cookie, a made-up cookie, a signed-out cookie | 401, nothing changes | Pass | audit-behind-security |
| 119 | POST /api/admin/sessions/:id/reopen with no cookie, a player cookie, a made-up cookie, a signed-out cookie | 401, nothing changes | Pass | audit-behind-security |
| 120 | POST /api/admin/refund-requests/:id with no cookie, a player cookie, a made-up cookie, a signed-out cookie | 401, nothing changes | Pass | audit-behind-security |
| 121 | POST /api/admin/players/:id/credit-refund with no cookie, a player cookie, a made-up cookie, a signed-out cookie | 401, nothing changes | Pass | audit-behind-security |
| 122 | GET /api/admin/money with no cookie, a player cookie, a made-up cookie, a signed-out cookie | 401, nothing changes | Pass | audit-behind-security |
| 123 | POST /api/admin/sessions/:id/late-drop-done with no cookie, a player cookie, a made-up cookie, a signed-out cookie | 401, nothing changes | Pass | audit-behind-security |
| 124 | POST /api/admin/sessions/:id/booked with no cookie, a player cookie, a made-up cookie, a signed-out cookie | 401, nothing changes | Pass | audit-behind-security |
| 125 | POST /api/admin/sessions/:id/court-answer with no cookie, a player cookie, a made-up cookie, a signed-out cookie | 401, nothing changes | Pass | audit-behind-security |
| 126 | POST /api/admin/sessions/:id/court with no cookie, a player cookie, a made-up cookie, a signed-out cookie | 401, nothing changes | Pass | audit-behind-security |
| 127 | POST /api/admin/sessions/:id/court-status with no cookie, a player cookie, a made-up cookie, a signed-out cookie | 401, nothing changes | Pass | audit-behind-security |
| 128 | GET /api/admin/version with no cookie, a player cookie, a made-up cookie, a signed-out cookie | 401, nothing changes | Pass | audit-behind-security |
| 129 | POST /api/admin/sessions/:id/show with no cookie, a player cookie, a made-up cookie, a signed-out cookie | 401, nothing changes | Pass | audit-behind-security |
| 130 | POST /api/admin/sessions/:id/holiday-hours with no cookie, a player cookie, a made-up cookie, a signed-out cookie | 401, nothing changes | Pass | audit-behind-security |
| 131 | POST /api/admin/sessions/:id/card-done with no cookie, a player cookie, a made-up cookie, a signed-out cookie | 401, nothing changes | Pass | audit-behind-security |
| 132 | POST /api/admin/sessions/:id/told with no cookie, a player cookie, a made-up cookie, a signed-out cookie | 401, nothing changes | Pass | audit-behind-security |
| 133 | POST /api/admin/sessions/:id/links with no cookie, a player cookie, a made-up cookie, a signed-out cookie | 401, nothing changes | Pass | audit-behind-security |
| 134 | GET /api/admin/export with no cookie, a player cookie, a made-up cookie, a signed-out cookie | 401, nothing changes | Pass | audit-behind-security |
| 135 | GET /api/admin/backup with no cookie, a player cookie, a made-up cookie, a signed-out cookie | 401, nothing changes | Pass | audit-behind-security |
| 136 | PUT /api/admin/alerts with no cookie, a player cookie, a made-up cookie, a signed-out cookie | 401, nothing changes | Pass | audit-behind-security |
| 137 | POST /api/admin/alerts/test with no cookie, a player cookie, a made-up cookie, a signed-out cookie | 401, nothing changes | Pass | audit-behind-security |
| 138 | POST /api/admin/alerts/smart-test with no cookie, a player cookie, a made-up cookie, a signed-out cookie | 401, nothing changes | Pass | audit-behind-security |
| 139 | POST /api/admin/sessions/:id/task-mark with no cookie, a player cookie, a made-up cookie, a signed-out cookie | 401, nothing changes | Pass | audit-behind-security |
| 140 | Organizer session after 30 days | Expired: 401 | Pass | audit-behind-security |
| 141 | Organizer cookie flags | HttpOnly, Secure, SameSite=Strict, Path=/api, 30 days | Pass | audit-behind-security |
| 142 | Player cookie flags | HttpOnly, Secure, SameSite=Lax, Path=/api, 1 year | Pass | audit-behind-security |
| 143 | 5 wrong PINs from one phone | 6th try locked for 15 minutes, even the right PIN | Pass | audit-behind-security |
| 144 | 20 wrong PINs from many addresses | Everyone locked for 15 minutes | Pass | audit-behind-security |
| 145 | 30 PIN guesses at once | At most 5 checked | Pass | audit-behind-security |
| 146 | PIN change | Signs out every organizer device | Pass | admin-security |
| 147 | Request from another site (Origin header) | 403 | Pass | audit-behind-security |
| 148 | HTML form post (form, text, multipart body) | 415 before anything happens | Pass | audit-behind-security |
| 149 | Broken %-escape in the address | 404 | Pass | audit-behind-security |
| 150 | Wrong method | 405 | Pass | audit-behind-security |
| 151 | Body over 20,000 characters | 413 | Pass | audit-behind-security |
| 152 | Body that is a list or not JSON | 400 | Pass | audit-behind-security |
| 153 | Server error | Plain "Something went wrong", no error text | Pass | audit-behind-security |
| 154 | Pretend header on a write | 403 Demo only | Pass | pretend |
| 155 | Pretend header without the PIN | 401 | Pass | pretend |
| 156 | Any phone can pick any name on the list and then see that player's own credit | Works as built (friends' group, no per-player password) | Question | code: pickName |
| 157 | IDOR: GET /api/status from Blair's phone with Casey's id in the body or the address | Acts only on Blair (or is refused); Casey's seat, credit and cash out unchanged | Pass | audit-behind-security |
| 158 | IDOR: POST /api/access from Blair's phone with Casey's id in the body or the address | Acts only on Blair (or is refused); Casey's seat, credit and cash out unchanged | Pass | audit-behind-security |
| 159 | IDOR: GET /api/group from Blair's phone with Casey's id in the body or the address | Acts only on Blair (or is refused); Casey's seat, credit and cash out unchanged | Pass | audit-behind-security |
| 160 | IDOR: GET /api/group/version from Blair's phone with Casey's id in the body or the address | Acts only on Blair (or is refused); Casey's seat, credit and cash out unchanged | Pass | audit-behind-security |
| 161 | IDOR: POST /api/me from Blair's phone with Casey's id in the body or the address | Acts only on Blair (or is refused); Casey's seat, credit and cash out unchanged | Pass | audit-behind-security |
| 162 | IDOR: DELETE /api/me from Blair's phone with Casey's id in the body or the address | Acts only on Blair (or is refused); Casey's seat, credit and cash out unchanged | Pass | audit-behind-security |
| 163 | IDOR: POST /api/players/self from Blair's phone with Casey's id in the body or the address | Acts only on Blair (or is refused); Casey's seat, credit and cash out unchanged | Pass | audit-behind-security |
| 164 | IDOR: PUT /api/me/days from Blair's phone with Casey's id in the body or the address | Acts only on Blair (or is refused); Casey's seat, credit and cash out unchanged | Pass | audit-behind-security |
| 165 | IDOR: POST /api/sessions/:id/join from Blair's phone with Casey's id in the body or the address | Acts only on Blair (or is refused); Casey's seat, credit and cash out unchanged | Pass | audit-behind-security |
| 166 | IDOR: POST /api/sessions/:id/withdraw from Blair's phone with Casey's id in the body or the address | Acts only on Blair (or is refused); Casey's seat, credit and cash out unchanged | Pass | audit-behind-security |
| 167 | IDOR: POST /api/sessions/:id/confirm from Blair's phone with Casey's id in the body or the address | Acts only on Blair (or is refused); Casey's seat, credit and cash out unchanged | Pass | audit-behind-security |
| 168 | IDOR: POST /api/sessions/:id/paid from Blair's phone with Casey's id in the body or the address | Acts only on Blair (or is refused); Casey's seat, credit and cash out unchanged | Pass | audit-behind-security |
| 169 | IDOR: POST /api/sessions/:id/use-credit from Blair's phone with Casey's id in the body or the address | Acts only on Blair (or is refused); Casey's seat, credit and cash out unchanged | Pass | audit-behind-security |
| 170 | IDOR: POST /api/sessions/:id/undo-credit from Blair's phone with Casey's id in the body or the address | Acts only on Blair (or is refused); Casey's seat, credit and cash out unchanged | Pass | audit-behind-security |
| 171 | IDOR: POST /api/sessions/:id/use-cash-out from Blair's phone with Casey's id in the body or the address | Acts only on Blair (or is refused); Casey's seat, credit and cash out unchanged | Pass | audit-behind-security |
| 172 | IDOR: POST /api/sessions/:id/decline from Blair's phone with Casey's id in the body or the address | Acts only on Blair (or is refused); Casey's seat, credit and cash out unchanged | Pass | audit-behind-security |
| 173 | IDOR: POST /api/me/refund-request from Blair's phone with Casey's id in the body or the address | Acts only on Blair (or is refused); Casey's seat, credit and cash out unchanged | Pass | audit-behind-security |
| 174 | IDOR: POST /api/me/refund-request/cancel from Blair's phone with Casey's id in the body or the address | Acts only on Blair (or is refused); Casey's seat, credit and cash out unchanged | Pass | audit-behind-security |
| 175 | IDOR: GET /api/sessions/:id/calendar.ics from Blair's phone with Casey's id in the body or the address | Acts only on Blair (or is refused); Casey's seat, credit and cash out unchanged | Pass | audit-behind-security |
| 176 | IDOR: GET /api/cal/:token from Blair's phone with Casey's id in the body or the address | Acts only on Blair (or is refused); Casey's seat, credit and cash out unchanged | Pass | audit-behind-security |
| 177 | IDOR: POST /api/link from Blair's phone with Casey's id in the body or the address | Acts only on Blair (or is refused); Casey's seat, credit and cash out unchanged | Pass | audit-behind-security |
| 178 | IDOR: POST /api/link/act from Blair's phone with Casey's id in the body or the address | Acts only on Blair (or is refused); Casey's seat, credit and cash out unchanged | Pass | audit-behind-security |
| 179 | IDOR: POST /api/go from Blair's phone with Casey's id in the body or the address | Acts only on Blair (or is refused); Casey's seat, credit and cash out unchanged | Pass | audit-behind-security |
| 180 | Every field (name, phone, pin, playerId...) set to 19,000-character string, on every POST/PUT route, as organizer and as a player | 400 or a normal answer, never 5xx, never database or code text | Pass | audit-behind-security |
| 181 | Every field (name, phone, pin, playerId...) set to 50 emoji, on every POST/PUT route, as organizer and as a player | 400 or a normal answer, never 5xx, never database or code text | Pass | audit-behind-security |
| 182 | Every field (name, phone, pin, playerId...) set to <script> HTML, on every POST/PUT route, as organizer and as a player | 400 or a normal answer, never 5xx, never database or code text | Pass | audit-behind-security |
| 183 | Every field (name, phone, pin, playerId...) set to SQL characters, on every POST/PUT route, as organizer and as a player | 400 or a normal answer, never 5xx, never database or code text | Pass | audit-behind-security |
| 184 | Every field (name, phone, pin, playerId...) set to control and direction-flip characters, on every POST/PUT route, as organizer and as a player | 400 or a normal answer, never 5xx, never database or code text | Pass | audit-behind-security |
| 185 | Every field (name, phone, pin, playerId...) set to -1 and -1e308, on every POST/PUT route, as organizer and as a player | 400 or a normal answer, never 5xx, never database or code text | Pass | audit-behind-security |
| 186 | Every field (name, phone, pin, playerId...) set to 1e308 and 2^53+1, on every POST/PUT route, as organizer and as a player | 400 or a normal answer, never 5xx, never database or code text | Pass | audit-behind-security |
| 187 | Every field (name, phone, pin, playerId...) set to 0.5, on every POST/PUT route, as organizer and as a player | 400 or a normal answer, never 5xx, never database or code text | Pass | audit-behind-security |
| 188 | Every field (name, phone, pin, playerId...) set to true / null, on every POST/PUT route, as organizer and as a player | 400 or a normal answer, never 5xx, never database or code text | Pass | audit-behind-security |
| 189 | Every field (name, phone, pin, playerId...) set to [] and nested objects, on every POST/PUT route, as organizer and as a player | 400 or a normal answer, never 5xx, never database or code text | Pass | audit-behind-security |
| 190 | Every field (name, phone, pin, playerId...) set to a date that does not exist, on every POST/PUT route, as organizer and as a player | 400 or a normal answer, never 5xx, never database or code text | Pass | audit-behind-security |
| 191 | Every field (name, phone, pin, playerId...) set to ../../etc/passwd, on every POST/PUT route, as organizer and as a player | 400 or a normal answer, never 5xx, never database or code text | Pass | audit-behind-security |
| 192 | Security headers | CSP, HSTS, X-Frame-Options DENY, nosniff, no-referrer, noindex | Read-only live | curl |
| 193 | CORS | No Access-Control-Allow-Origin anywhere: other sites can't read answers | Read-only live | curl |
| 194 | Secrets in the repo | None (Telegram-shaped tokens, private keys, Cloudflare tokens) | Pass | audit-behind-security |
| 195 | Secrets in the built site | None | Pass | dist scan |
| 196 | Setup on a live group | Refused (SETUP_TOKEN only works on an empty database) | Pass | setup tests |

## 5. Data integrity (scripts/integrity-checks.sql)

| # | Scenario | Expected by the rules | Status | Test |
|---|---|---|---|---|
| 197 | Check cents on a busy seeded copy (two random runs of 500 taps) | 0 | Pass | audit-behind-integrity |
| 198 | Check cents catches its own problem when planted | Above 0 | Pass | audit-behind-integrity |
| 199 | Check cents on live (read-only, counts only) | 0 | Read-only live | wrangler, Sun Nov 1 6:30 AM |
| 200 | Check cents on a busy seeded copy (two random runs of 500 taps) | 0 | Pass | audit-behind-integrity |
| 201 | Check cents catches its own problem when planted | Above 0 | Pass | audit-behind-integrity |
| 202 | Check cents on live (read-only, counts only) | 0 | Read-only live | wrangler, Sun Nov 1 6:30 AM |
| 203 | Check cents on a busy seeded copy (two random runs of 500 taps) | 0 | Pass | audit-behind-integrity |
| 204 | Check cents catches its own problem when planted | Above 0 | Pass | audit-behind-integrity |
| 205 | Check cents on live (read-only, counts only) | 0 | Read-only live | wrangler, Sun Nov 1 6:30 AM |
| 206 | Check seat_without_game on a busy seeded copy (two random runs of 500 taps) | 0 | Pass | audit-behind-integrity |
| 207 | Check seat_without_game catches its own problem when planted | Above 0 | Pass | audit-behind-integrity |
| 208 | Check seat_without_game on live (read-only, counts only) | 0 | Read-only live | wrangler, Sun Nov 1 6:30 AM |
| 209 | Check seat_without_player on a busy seeded copy (two random runs of 500 taps) | 0 | Pass | audit-behind-integrity |
| 210 | Check seat_without_player catches its own problem when planted | Above 0 | Pass | audit-behind-integrity |
| 211 | Check seat_without_player on live (read-only, counts only) | 0 | Read-only live | wrangler, Sun Nov 1 6:30 AM |
| 212 | Check duplicate_seat on a busy seeded copy (two random runs of 500 taps) | 0 | Pass | audit-behind-integrity |
| 213 | Check duplicate_seat catches its own problem when planted | Above 0 | Pass (by constraint) | audit-behind-integrity |
| 214 | Check duplicate_seat on live (read-only, counts only) | 0 | Read-only live | wrangler, Sun Nov 1 6:30 AM |
| 215 | Check credit_row_without_player on a busy seeded copy (two random runs of 500 taps) | 0 | Pass | audit-behind-integrity |
| 216 | Check credit_row_without_player catches its own problem when planted | Above 0 | Pass | audit-behind-integrity |
| 217 | Check credit_row_without_player on live (read-only, counts only) | 0 | Read-only live | wrangler, Sun Nov 1 6:30 AM |
| 218 | Check credit_row_without_game on a busy seeded copy (two random runs of 500 taps) | 0 | Pass | audit-behind-integrity |
| 219 | Check credit_row_without_game catches its own problem when planted | Above 0 | Pass | audit-behind-integrity |
| 220 | Check credit_row_without_game on live (read-only, counts only) | 0 | Read-only live | wrangler, Sun Nov 1 6:30 AM |
| 221 | Check cash_out_without_player on a busy seeded copy (two random runs of 500 taps) | 0 | Pass | audit-behind-integrity |
| 222 | Check cash_out_without_player catches its own problem when planted | Above 0 | Pass | audit-behind-integrity |
| 223 | Check cash_out_without_player on live (read-only, counts only) | 0 | Read-only live | wrangler, Sun Nov 1 6:30 AM |
| 224 | Check pot_below_zero on a busy seeded copy (two random runs of 500 taps) | 0 | Pass | audit-behind-integrity |
| 225 | Check pot_below_zero catches its own problem when planted | Above 0 | Pass | audit-behind-integrity |
| 226 | Check pot_below_zero on live (read-only, counts only) | 0 | Read-only live | wrangler, Sun Nov 1 6:30 AM |
| 227 | Check pending_cash_out_over_pot on a busy seeded copy (two random runs of 500 taps) | 0 | Pass | audit-behind-integrity |
| 228 | Check pending_cash_out_over_pot catches its own problem when planted | Above 0 | Pass | audit-behind-integrity |
| 229 | Check pending_cash_out_over_pot on live (read-only, counts only) | 0 | Read-only live | wrangler, Sun Nov 1 6:30 AM |
| 230 | Check credit_used_on_canceled_game on a busy seeded copy (two random runs of 500 taps) | 0 | Pass | audit-behind-integrity |
| 231 | Check credit_used_on_canceled_game catches its own problem when planted | Above 0 | Pass | audit-behind-integrity |
| 232 | Check credit_used_on_canceled_game on live (read-only, counts only) | 0 | Read-only live | wrangler, Sun Nov 1 6:30 AM |
| 233 | Check credit_used_on_left_seat on a busy seeded copy (two random runs of 500 taps) | 0 | Pass | audit-behind-integrity |
| 234 | Check credit_used_on_left_seat catches its own problem when planted | Above 0 | Pass | audit-behind-integrity |
| 235 | Check credit_used_on_left_seat on live (read-only, counts only) | 0 | Read-only live | wrangler, Sun Nov 1 6:30 AM |
| 236 | Check credit_on_seat_over_14 on a busy seeded copy (two random runs of 500 taps) | 0 | Pass | audit-behind-integrity |
| 237 | Check credit_on_seat_over_14 catches its own problem when planted | Above 0 | Pass | audit-behind-integrity |
| 238 | Check credit_on_seat_over_14 on live (read-only, counts only) | 0 | Read-only live | wrangler, Sun Nov 1 6:30 AM |
| 239 | Check more_in_than_max on a busy seeded copy (two random runs of 500 taps) | 0 | Pass | audit-behind-integrity |
| 240 | Check more_in_than_max catches its own problem when planted | Above 0 | Pass (by constraint) | audit-behind-integrity |
| 241 | Check more_in_than_max on live (read-only, counts only) | 0 | Read-only live | wrangler, Sun Nov 1 6:30 AM |
| 242 | Check paid_seat_without_amount on a busy seeded copy (two random runs of 500 taps) | 0 | Pass | audit-behind-integrity |
| 243 | Check paid_seat_without_amount catches its own problem when planted | Above 0 | Pass | audit-behind-integrity |
| 244 | Check paid_seat_without_amount on live (read-only, counts only) | 0 | Read-only live | wrangler, Sun Nov 1 6:30 AM |
| 245 | Check cash_still_on_canceled_game on a busy seeded copy (two random runs of 500 taps) | 0 | Pass | audit-behind-integrity |
| 246 | Check cash_still_on_canceled_game catches its own problem when planted | Above 0 | Pass | audit-behind-integrity |
| 247 | Check cash_still_on_canceled_game on live (read-only, counts only) | 0 | Read-only live | wrangler, Sun Nov 1 6:30 AM |
| 248 | Check info_unanswered_i_paid_on_canceled_game on a busy seeded copy (two random runs of 500 taps) | 0 | Pass | audit-behind-integrity |
| 249 | Check info_unanswered_i_paid_on_canceled_game catches its own problem when planted | Above 0 | Pass (by constraint) | audit-behind-integrity |
| 250 | Check info_unanswered_i_paid_on_canceled_game on live (read-only, counts only) | 0 | Read-only live | wrangler, Sun Nov 1 6:30 AM |
| 251 | Check finalized_without_price on a busy seeded copy (two random runs of 500 taps) | 0 | Pass | audit-behind-integrity |
| 252 | Check finalized_without_price catches its own problem when planted | Above 0 | Pass | audit-behind-integrity |
| 253 | Check finalized_without_price on live (read-only, counts only) | 0 | Read-only live | wrangler, Sun Nov 1 6:30 AM |
| 254 | Check two_games_same_start on a busy seeded copy (two random runs of 500 taps) | 0 | Pass | audit-behind-integrity |
| 255 | Check two_games_same_start catches its own problem when planted | Above 0 | Pass (by constraint) | audit-behind-integrity |
| 256 | Check two_games_same_start on live (read-only, counts only) | 0 | Read-only live | wrangler, Sun Nov 1 6:30 AM |
| 257 | Check game_ends_before_start on a busy seeded copy (two random runs of 500 taps) | 0 | Pass | audit-behind-integrity |
| 258 | Check game_ends_before_start catches its own problem when planted | Above 0 | Pass | audit-behind-integrity |
| 259 | Check game_ends_before_start on live (read-only, counts only) | 0 | Read-only live | wrangler, Sun Nov 1 6:30 AM |
| 260 | Check alert_log_without_game on a busy seeded copy (two random runs of 500 taps) | 0 | Pass | audit-behind-integrity |
| 261 | Check alert_log_without_game catches its own problem when planted | Above 0 | Pass | audit-behind-integrity |
| 262 | Check alert_log_without_game on live (read-only, counts only) | 0 | Read-only live | wrangler, Sun Nov 1 6:30 AM |
| 263 | Check alert_sent_twice on a busy seeded copy (two random runs of 500 taps) | 0 | Pass | audit-behind-integrity |
| 264 | Check alert_sent_twice catches its own problem when planted | Above 0 | Pass (by constraint) | audit-behind-integrity |
| 265 | Check alert_sent_twice on live (read-only, counts only) | 0 | Read-only live | wrangler, Sun Nov 1 6:30 AM |

## 6. Free plan limits

| # | Scenario | Expected by the rules | Status | Test |
|---|---|---|---|---|
| 266 | Requests per day, busy game day (14 players, 10 visits each, organizer 3 hours) | About 11,600 of 100,000 (12%) | Pass | docs/RUNBOOK_TUESDAY.md math |
| 267 | Requests, extreme (15 screens active 4 hours) | About 44,000 (44%) | Pass | math |
| 268 | D1 rows read, busy game day | About 1.4 million of 5 million (28%) today | Pass | measured 81 rows per check on live |
| 269 | D1 rows read, extreme | About 5.3 million (over 100%) | Question | math |
| 270 | D1 rows read growth | Each check reads every game ever made (no index on end time): about +1 row per game per query | Question | EXPLAIN QUERY PLAN |
| 271 | D1 rows written | Under 300 a day (under 1%) | Read-only live | Cloudflare analytics |
| 272 | Everyone opens at 6:55 PM at once | 15 separate requests, each under its own limit | Pass | math |
| 273 | Site CPU per request (live) | p50 6 ms (60% of 10 ms), p90 13 ms, p99 41 ms, 0 errors | Question | Cloudflare analytics |
| 274 | Clock Worker CPU | 0.6 ms (6%) | Read-only live | Cloudflare analytics |
| 275 | Cron triggers | 1 of 5 | Read-only live | API |
| 276 | Storage | 0.3 MB of 500 MB | Read-only live | API |

## 7. Backups and recovery

| # | Scenario | Expected by the rules | Status | Test |
|---|---|---|---|---|
| 277 | Time Travel on | Yes (always on for D1, 7 days on Free) | Read-only live | wrangler time-travel info |
| 278 | Bookmark before this audit's deploy | Recorded in STAGE_NOTES | Pass | wrangler |
| 279 | SQL export | 217 rows, kept out of git | Pass | wrangler d1 export |
| 280 | Export restores into a scratch database (never live) | Every table's row count matches live; all checks 0 | Pass | wrangler --local |
| 281 | Runbook | docs/RUNBOOK_TUESDAY.md | Pass | doc |

## 8. Deploy and config

| # | Scenario | Expected by the rules | Status | Test |
|---|---|---|---|---|
| 282 | Production secrets | CRON_SECRET, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, SETUP_TOKEN set; GO_LINKS on; SITE_URL set | Read-only live | Pages API (names only) |
| 283 | Clock Worker | Exists, cron */5, CRON_SECRET set, points at the backup address | Read-only live | Workers API |
| 284 | Preview deployments and the database | Were bound to the LIVE database; now bound to pickleball-preview (fake data) for new previews | Fixed | wrangler.toml |
| 285 | Preview secrets | None (no Telegram, no cron): previews can't send alerts | Read-only live | Pages API |
| 286 | Old preview links still on the live database | money-audit-preview and claude-new-session-5n1wup | Question | fingerprint check |
| 287 | Both addresses serve the same site | Same Pages project; backup address checked (juncaj.net blocked from this sandbox) | Read-only live | Pages API |
| 288 | http to https | 301 | Read-only live | curl |
| 289 | www.pickleball.juncaj.net | Not reachable from this sandbox; not set up in Pages domains | Question | Pages API |
| 290 | Cache headers | Every file re-checked each visit (max-age=0, must-revalidate): no stale site after a deploy | Read-only live | curl |
| 291 | Robots and privacy | robots.txt Disallow all, X-Robots-Tag noindex, meta noindex, no directory listing | Read-only live | curl |
| 292 | Unknown page | The app's own page (200), API unknown is 404 JSON | Read-only live | curl |
| 293 | Favicon, home screen icons, share text | Present | Read-only live | curl |

## 9. Docs and code health

| # | Scenario | Expected by the rules | Status | Test |
|---|---|---|---|---|
| 294 | Tests from a clean checkout | npm ci, typecheck, all unit tests pass | Pass | vitest |
| 295 | Browser suite | See STAGE_NOTES for the count | Pass | npm run test:e2e |
| 296 | Build reproducible | Two builds byte-identical (17 files) | Pass | sha256 |
| 297 | Dependency warnings | 0 in what ships; 3 in the test runner only (vitest, tinypool) | Pass | npm audit |
| 298 | Dead flags left on | None: GO_LINKS on (in use), LIVE_UPDATES on (in use), no MOTION flag | Pass | code search |
| 299 | TELEGRAM_FETCH | Tests only; a function can't be set from Cloudflare | Pass | code |
| 300 | SITE_RULES vs code | Differences listed in STAGE_NOTES | Pass | review |

## 10. Found by the two fresh auditors (round 1)

| # | Scenario | Expected by the rules | Status | Test |
|---|---|---|---|---|
| 301 | Name "P: https://<site>\\@evil" or one copying the site's own address drops out | No hidden link words in any alert that carries a name | Fixed | audit-behind-telegram |
| 302 | Browser carrying a cookie with a broken %-escape (another juncaj.net site) | Site works; was a server error on every request | Fixed | audit-behind-security |
| 303 | A cancel lands between "court waitlist" checking and writing | Game stays canceled; was un-canceled with everyone's $14 already credit (free game) | Fixed | audit-behind-races |
| 304 | 500 group-word guesses sent at once | At most 10 checked; was all 500 (group word is off on live) | Fixed | audit-behind-races |
| 305 | Two Finalize requests in the same millisecond with different "who played" lists | The loser writes nothing; today both partly apply | Open (not fixed: money code, needs two requests in one millisecond, plan after Nov 3) | auditor B script |
| 306 | 40 self-adds at once from different addresses | Stops at 30 names; went to 45 | Open (minor) | auditor B script |
| 307 | One player toggling drop/join every 3 minutes for 2 hours | Uses the 20-an-hour cap, so the 7:00 PM last call never goes | Question (cap is shared on purpose) | auditor A script |
| 308 | Network error after Telegram already took the message | Retried, could arrive twice (a timeout keeps it as sent) | By design (low chance) | auditor A script |
| 309 | 21 wrong PINs from 21 addresses | Locks the organizer's PIN sign-in for 15 minutes; signed-in phones keep working | By design | audit-behind-security |
| 310 | Moved to another day and back within an hour | Its alerts can go again | By design | code |
| 311 | Max players set below the number already in | Allowed; the health check then shows more_in_than_max | Question | integrity check |
| 312 | A dropper re-taps I'm in before the waitlist moves up | Gets the spot back ahead of the waitlist; money stays right | Question | auditor B script |

## 11. Found by the fresh auditors (round 2)

| # | Scenario | Expected by the rules | Status | Test |
|---|---|---|---|---|
| 313 | Court waitlist tapped on a finalized game | Refused, nothing changes (was "ok" and cleared the court-booked mark) | Fixed | audit-behind-races |
| 314 | Game canceled while a slow tick is sending its alerts | No more alerts for it from that tick | Fixed | audit-behind-clock |
| 315 | One player toggles in and out every 5 minutes all evening | Their alerts stop at 15 an hour; the clock's 10:00 PM warning and 10:30 PM follow-up still go | Fixed | audit-behind-clock |
| 316 | Name with U+0085, U+2028 or U+2029 | Refused (would break the name across lines) | Fixed | audit-behind-security |
| 317 | Game moved to another day and back | Its alerts can go again; card taps start over | By design | code |
| 318 | 40 self-adds at once from 40 addresses | Stops at 30; goes past it | Open (minor) | auditor script |
| 319 | Group-word guesses from many addresses | No overall cap (the PIN has one) | Open (group word is off on live) | auditor script |
| 320 | A name that is a visible web address | Telegram may make the visible address tappable itself; never hidden words | By design | audit-behind-telegram |

**Total: 320 scenarios.**
