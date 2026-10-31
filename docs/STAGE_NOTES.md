# Stage notes: "any number from 4 to 10 plays" (Oct 29, 2026)

Short notes per stage: what shipped, the restore point, and the tests.
Times are Eastern.

## Before Stage 1 (read-only look at the live site, Thu Oct 29, about 12:05 PM)

- No old $5 credits exist (the `credits` table is empty).
- One credit entry: $14 kept from the canceled Thu Oct 29 game, already used
  on Thu Nov 5 (so that player's pot is $0 and their Nov 5 seat is "paid with
  credit"). The brief said "$14 credit and paid $14 for Tue Nov 3"; the live
  data says the $14 cash payment is on Tue Nov 3 and the credit was spent on
  Nov 5. Nothing to fix; reported here.
- No money is still held on canceled games or by dropped players, so the
  one-time conversion in migration 0013 touches nothing live.
- Tue Nov 3: 4 in (one paid $14). Thu Nov 5: 3 in (one paid with credit).
  Later games: fewer. Settings: 3 weeks ahead, $14, no max yet (default 10).

## Stage 1: the rules, the money engine, and the screens (deployed Thu Oct 29, 2026, about 10:35 PM Eastern)

Everything in NEW_RULES.md sections 1 to 12 went live in one deploy (the credit
chip, refund requests, the new texts and alert switches were built alongside
the engine, so there was no reason to hold them back). Only the morning
Telegram "Finalize" nudge was dropped, on the owner's instruction: the Finalize
card on Home is the reminder.

### What shipped
- Any number from 4 up to "Max players per game" (default 10, Settings > Group).
  The waitlist starts past the max; the first waiting person moves in on a drop.
- Everyone owes the flat $14 until the game is finalized. Under Pay: "You get
  credit back if 5 or more play."
- After the game: the Finalize card on Home (Everyone played / Change who
  played), the final price 4 x $14 / N rounded down, credit back for anyone who
  paid more, the remainder owed by anyone who paid less, everything back for a
  no-show. Reopen on the Money tab while that credit is untouched.
- Money that comes back for any reason becomes credit automatically (drop,
  cancel, did not play). The organizer's Refund / Keep as credit cards are gone.
- Credit chip in the player header with the credit sheet (balance, history,
  Request refund). Refund requests reserve the amount, send the organizer a
  Telegram message, and show a Home card with the Venmo link, Mark refunded
  and Not now. The Players-tab "Refund credit balance" stays and respects a
  pending request.
- Texts: Down to 5 and Now 6 removed; the canceled text and the new "Final
  price" text; Check-in at 4 or more to everyone signed up.
- Telegram alerts: "A game falls below 4", "A game reaches 4 (it's on)" (replaces
  "reaches 6"), new "Refund requests". "6 down to 5" is gone.
- Cards show "3 of 4 in" with four circles filling with pickleballs, then "5 in"
  and so on with a ball per extra person, "10 in, full" at the max.
- Money tab: Held until finalized, Collected = what the group kept, Credits
  owed never taken off Left. History rows show "5 played · $11 each".

### Database
Migration `0013_any_number_plays.sql`, additive only: new nullable columns on
sessions (finalized_at, final_price_cents, final_played_count) and
session_players (played), credit_ledger (reason, played_count), two new
switches on organizer_alerts, the new `refund_requests` table, and the
confirmed-players cap trigger widened from 6 to 12. The one-time conversion of
held money on canceled games found nothing to convert (checked read-only first).

### Restore points
- Full SQL export of the live database right before the deploy:
  `live-before-stage1-2026-10-29.sql` (123 rows, in this session's scratch folder
  `/tmp/claude-0/-home-user-Pickleball/90d62b44-36b0-5dcd-a873-3fa9f99f4d84/scratchpad/`;
  it has phone numbers, so it was not committed). Taken Thu Oct 29 at about 10:30 PM Eastern.
- Cloudflare Time Travel bookmark right before the migration:
  `00000107-00000000-00005114-7c54150a816404e11d75d3d5cffdcac0` (good for 7 days).
- To undo everything: `npx wrangler d1 time-travel restore pickleball --bookmark=00000107-00000000-00005114-7c54150a816404e11d75d3d5cffdcac0`
  and redeploy the previous commit (`57e8a5f`).

### Tests
- Unit and API: 510 passed in 35 files (`npm test`), including
  `tests/finalize.test.ts` (the money matrix, N = 4 to 10 with and without the
  organizer) and `tests/audit-money.test.ts` (60 adversarial tests written by an
  independent auditor that did not write the code; it found 3 real bugs, all
  fixed before deploy: a second credit entry for a re-paid seat, undo on the
  wrong refund request, and a player who paid a lower final price before a redo).
- Browser (`npm run test:e2e`, run with `NODE_PATH=/opt/node-tools/node_modules`): 775 checks, 0 failed
  (run 229, credit 153, court 84, held 81, alerts 52, texts 52, suggest 35, popup 33, gates 32, names 24).
- Typecheck and production build clean.

### Left for later
- Stage 2 as a separate stage no longer exists: its items shipped here.
- Stage 3 polish: a last look at every screen at 360, 375, 390 and 430 px in
  light and dark (the browser tests cover overlap, cut-off text, one green
  button per card, 44 px tap targets and reduce-motion, so this is a human eye
  pass), fresh `docs/screenshots` (`node e2e/shots.cjs`), and the out-of-date
  state gallery.

## Stage 3: polish and check (Thu Oct 29, 2026, about 11:30 PM Eastern)

Merged into main as #47 (main was behind: Stage 1 went live from a branch that
had never been merged). See `STAGE3_POLISH.md` for the plain-words list.

### What changed
- Circles: checked at 0 to 10 in plus a waitlist on both screens at 360, 375,
  390 and 430 px, light and dark. One fix: with 10 in on a narrow phone the
  organizer's own I'm in dropped to a line of its own; the balls now wrap
  beside it. Spacing, alignment, size, dark-mode contrast and Reduce Motion
  were already right.
- Header: the credit chip lost its extra right margin. No wrap at 360 px,
  even with "Bartholomew" and $1,000; very long names truncate.
- Every screen looked at in light and dark at the four widths (shots in the
  session scratch folder). The thin line at the bottom of the player page is
  deliberate (asked for in #26) and stays.
- Fresh audit (a helper that did not write the code) found 7 problems, all
  fixed: reopen and unmark taking credit a refund request holds; the
  post-game note following a later price change; the stale "Request refund"
  line; no Undo after a partial Mark refunded; one player flooding Telegram
  (now one "Refund requested" per player an hour); half-dollar prices
  (price per player is whole dollars now).
- Left alone: "You get credit back if 5 or more play."

### Database
No changes.

### Restore points
- Full SQL export right before the deploy:
  `live-before-stage3-2026-10-29.sql` (136 rows, in this session's scratch folder
  `/tmp/claude-0/-home-user-Pickleball/c4be037e-e40c-591f-8ffa-20f607c0aa7b/scratchpad/`;
  it has phone numbers, so it was not committed). Thu Oct 29, 11:20 PM Eastern.
- Cloudflare Time Travel bookmark, same time:
  `0000010b-00000000-00005114-39f03bad2029b1d6f30a1e1ed380a22c`.
- Code to go back to: deployment 687b32a0 (commit 8ba0465). Rolling the
  code back is enough; Stage 3 changed no data.

### Tests
- Unit and API: 543 passed in 36 files, four runs in a row. Three privacy
  tests used to fail about once in 50 runs when a random id happened to hold
  "4800" or "555-01"; they now blank ids out first (`withoutIds` in
  `tests/harness.ts`).
- Browser: 796 checks, 0 failed (run 229, credit 153, court 84, held 81,
  alerts 52, texts 52, suggest 35, popup 33, gates 32, names 24, circles 18,
  audit 3).

### Deploy
Live Thu Oct 29, 2026, 11:29 PM Eastern: production deployment `de7bb199`
(commit e687781, the merge of #47). Read-only live checks passed (the one
"setup code is configured" line is expected once a group exists).

## Player screen cleanup and redesign (Oct 30, 2026)

Presentation only. No money rule, money math, schema or server change.

### What changed
- Three tiers on the player screen: THIS WEEK (84 px tile, green outline,
  soft shadow), NEXT WEEK (70 px tile, thin outline), and one LATER header
  with flat rows (small tiles, button on the right).
- The time sits under the date tile ("8–10 PM", en dash). The big
  "8:00 to 10:00 PM" line is gone.
- Joined: check badge on the tile corner, "You're in · Court booked", a
  quiet underlined "Drop out" link. No green tint anywhere.
- Blue TONIGHT strip in the tile (light #2F5BD3, dark #8FB0FF).
- Extra games: ink tile in light mode, cream tile in dark mode (the words
  "Extra game" stay for screen readers).
- Holiday pills removed from player cards and the "Want in?" popup. The
  organizer's holiday label is now plain text with the "Hours OK" button.
- Payment states: amber "$14 due" / "$5 left to pay" chip, green "Paid $14" /
  "Paid with credit" pill. With credit to use, "Use credit" is the one filled
  button and "Pay" is its outline twin (covering all or part, as in the mockups);
  otherwise "Pay" is filled. Same on the game-day Pay card.
  Waitlist ("Waitlist, 2nd in line") and canceled cards use the same layout.
- Credit-back note under "I'm in": "If 6 play, you get $5 back as credit."
  Only when the person has not joined, would be 5th or later, there is room
  (not at the max), and it is not a waitlist or standby. Amount comes from
  the existing credit-back table (`creditBack` in shared/pricing.ts). The old
  "You get credit back if 5 or more play." line is gone.
- "I'm out" is now "Drop out" (also on the confirmation button).
- Dark mode: page #0F1612, cards #18221C, mint buttons with dark text.

### Not changed on purpose
- The game-day Pay card at the top (from 8:00 AM) stays; that day's row shows
  the amber chip but no button, so there are never two Pay buttons.
- "Undo" on a part-credit game is not shown: the server only undoes a game
  that is fully paid with credit, and changing that is a money rule.

### Code
`src/player-cards.css` (new), `ScheduleRow` / `PlayerTile` / `RowPay` in
`src/pages/PlayerHome.tsx`, `formatTimeShort`, `weekTier`, `ordinal` in
`shared/time.ts`, `creditBackNote` in `shared/pricing.ts`.

### Deploy and tests (Fri Oct 30, 2026, about 1:05 AM Eastern)
- Deployed through Cloudflare Pages (same route as before): deployment
  `8ba53598`, commit `ae1811c`, branch main. No database migration.
- Restore points: Time Travel bookmark taken just before the deploy
  `00000111-00000000-00005114-fb1cd574b8df93227487f0f8d11e93fd`
  (restore with `npx wrangler d1 time-travel restore pickleball --bookmark=...`),
  plus a full SQL export (136 rows, has phone numbers, not committed) in that
  session's scratch folder as `live-before-redesign-2026-10-30.sql`.
  Code rollback: Pages deployment `de7bb199` (commit e687781).
- Tests: 548 unit tests; browser checks all green (run 229, names 24, gates 32,
  alerts 52, court 84, held 81, credit 153, suggest 35, popup 33, texts 52,
  circles 18, audit-stage3 3). Old checks were rewritten for the new look, none
  deleted; new ones cover no-tint on joined cards, the TONIGHT strip, the
  extra-game tile and the Drop out link.
- A fresh reviewer who wrote none of the code confirmed: no server, API or money
  code changed, players still only get their own money and credit, and the
  credit-back note matches the table (N=5 $3, 6 $5, 7 $6, 8 $7, 9 $8, 10 $9).

## Round 2: feedback on the live redesign, plus Cancel with a reason (Oct 30, 2026)

Status: LIVE (deployed Fri Oct 30, 2026, about 10:03 AM Eastern). Deploy order mattered:
back up, apply migration 0014, then deploy the code (the new code names the new column).

### What changed
- Credit sheet: "Request refund" is now "Request cash out from Alex" (the organizer's
  name). The pending line, toast, chip label ("CASH OUT"), history line ("-$14 cashed
  out") and the canceled-game text ("You can request a cash out on the site.") match.
  Organizer screens and Telegram alerts keep "refund".
- The "Your $14 is now credit. Request refund" line is gone from cards. The CREDIT
  chip counts up (0.75 s, whole dollars, width held steady) and pulses once; a chip
  that was not there fades in and counts from $0. Reduce Motion: new number only.
- A pickleball spins in (0.46 s, one turn, small overshoot) only when it is new.
  Balls already on screen at load stay still.
- Compact cards in every tier. After the names: one money line (amber chip with its
  button beside it, or green pill with the quiet links on the same line) and at most
  one line of small links. LATER rows are three-part grids (tile, middle, controls)
  with the status line across the top; wide controls (two buttons, long pill) drop
  under the middle block. The calendar icon sits at the right end of the status line.
  Quiet links are small on the page with a 44 px tap area drawn by ::before.
- With credit to use, the chip reads "$14 due · $9 credit" (one chip instead of a
  chip plus a sub-line). Part credit: "$5 left to pay" (credit used is read by
  screen readers).
- One banner for every pop-up message: bottom center, about 96 px above the bottom,
  max 340 px, check icon, fades in 0.2 s, stays 1.5 s (errors 4 s), then slides away
  0.25 s; tap or swipe closes it; new message replaces old; shows above sheets.
  Timings: `BANNER_TIMING` at the top of the pop-up section in `src/ui.tsx`.
  Chip timings: `CHIP_COUNT_MS`, `CHIP_PULSE_MS` in `src/pages/CreditSheet.tsx`.
- Cancel with a reason: organizer cancel dialog has "Reason (optional)" (40
  characters). Stored in new nullable column `sessions.cancel_reason`
  (`migrations/0014_cancel_reason.sql`, additive only). Reopen clears it. Player card
  reads "Canceled - Thanksgiving" or "Canceled"; organizer screens read "Canceled -
  Thanksgiving". The reason is not added to any text message.

### Tests
- 558 unit tests (10 new for the reason). Browser: run 229, names 24, gates 32,
  alerts 52, court 84, held 81, credit 153, suggest 35, popup 33, texts 52, circles 18,
  audit-stage3 3, cancel-reason 8, round2 17 (new: layout at 4 widths x light/dark,
  joining height growth, chip count-up, spin-in, banner, cash-out wording).
  Old checks were updated for the new wording and layout; none were deleted.
- A fresh reviewer who wrote none of the code checked privacy, money, HTML
  injection and the migration: all passed.

### Deploy and restore points (Fri Oct 30, 2026)
- Deployment `92335f98`, commit `02b84fa`, branch main, about 10:03 AM Eastern.
  Migration `0014_cancel_reason.sql` applied to the live database at about 10:02 AM
  (additive: one nullable column; 8 live games, none has a reason).
- Time Travel bookmark taken right before the migration:
  `00000121-00000000-00005114-bbb179023ed225ace8239da2c3e1f687`
  (restore with `npx wrangler d1 time-travel restore pickleball --bookmark=...`).
- Full SQL export of the live database before the migration (136 rows, has phone
  numbers, not committed): `live-before-round2-2026-10-30.sql` in that session's
  scratch folder.
- Code rollback: Pages deployment `8ba53598` (commit ae1811c). Code that ignores
  `cancel_reason` keeps working, so rolling the code back needs no database change.
- Spelling: one spelling everywhere, "Canceled" (the player card too).
- Final test totals: 558 unit; browser run 229, names 24, gates 32, alerts 52, court 84,
  held 81, credit 153, suggest 35, popup 33, texts 52, circles 18, audit-stage3 3,
  cancel-reason 8, round2 17 (821 in all), all green.
- After deploy: read-only checks only. The backup address returned 200 with the new
  bundle; pickleball.juncaj.net could not be reached from the build sandbox (proxy 403),
  and it serves the same Pages project.
- SETUP_TOKEN is only used for first-time setup of an empty database; once a group
  exists, setup is refused. Safe to delete; if missing, setup returns "Setup is turned off".
- Follow-up deploy Fri Oct 30, about 10:25 AM Eastern: player status says "Court not booked" (was "Court not booked yet"). Deployment `e53802a0`, commit 65c2dab, no database change. Time Travel bookmark right before: `00000125-00000000-00005114-ec3c66bcdd519fc3d20a609605c3006b`. Code rollback: deployment `92335f98`. Tests unchanged in count, all green.
- Follow-up deploy (LATER right column always centered on the row, calendar icon stays with the last words of the status line). Time Travel bookmark right before: `00000129-00000000-00005114-d63caa88185e43b756a23bad4cf27195`. Code rollback: deployment `e53802a0`. New browser file round2 grew to 25 checks (829 browser checks in all, 558 unit), all green.
  Deployed Fri Oct 30, 2026, about 11:01 AM Eastern, deployment `6fcad249`, commit 9205c20, no database change.

### Want in card fixes (Fri Oct 30, 2026, about 11:30 AM Eastern)
- Deployment `f8b0971e`, commit 643a342, no database change. Time Travel bookmark right
  before: `0000012d-00000000-00005114-a79d5d4834c90924c133d27c849a865c`. Code rollback:
  deployment `6fcad249`.
- Real bug, not just the demo: tapping Yes on the "Want in ...?" card joined the player
  on the server but the game cards only refreshed when Done was tapped (the "You're in"
  answer lived inside the card). Now Yes does what "I'm in" does: same call, same banner,
  and the cards, count, circles and names refresh at once. Works in real mode and in the
  organizer's demo ("View as..."). Test: `e2e/want-in.cjs` (fails on the old code).
- The prompt and its "You're in" answer use the short time, "8–10 PM".
- Title rule (`suggestDay` in `shared/time.ts`, Eastern calendar days): tonight, tomorrow,
  2 to 6 days: the weekday alone ("Want in Thursday?"), 7 to 13 days: "next Thursday",
  after that the date. Tests in `tests/day-phrases.test.ts` (Friday, Monday, Tuesday,
  Thursday, Sunday Nov 1 across the clock change, and the Eastern-vs-UTC edge).
- Tests: 565 unit, 833 browser, all green.

### Finalize dry run (Fri Oct 30, 2026, before the first real game Tue Nov 3)
Done on a local copy with fake data only. Nothing on the live site was changed.

What was walked: every player count 4 to 10 (organizer playing, one unpaid, one paid
with credit, one "I paid", the rest Venmo + Mark paid), drops before and after the
cutoff (cash, credit, unpaid), a no-show, the waitlist moving in, partial credit,
someone owing nothing, a canceled game after payment, Reopen and redo, Undo of
"Paid with credit", a cash-out request pending during finalize, double taps, the
Nov 1 clock change (Sat Oct 31, Sun Nov 1 including the repeated 1 AM hour, Tue Nov 3
around 8 and 10 PM), cancel with a reason, and every screen at 390 px light and dark.
After each step the books are checked: cash players sent = collected + held + credit
in pots + cashed out (`tests/dryrun-money.test.ts`).

Fixed (not money):
- Players tab "N played" counted games a player was marked "did not play" for.
- A quick second tap on Use credit, Everyone played / Confirm, Reopen, Request cash
  out (and the other buttons that share those handlers) sent two requests and flashed
  a red error. A lock now ignores the second tap. Test: `e2e/double-tap.cjs` (fails on
  the old code).
- The player error for a second cash-out request said "refund"; it now reads "You
  already asked for a cash out. Cancel it to make a new one."

Alex's answers to the money questions (display only, no balance, price or credit change):
- A: credit put on a seat that still owes the rest (for example $3 credit on a $9
  seat, $6 unpaid) now counts as Held on Money and Players right away, finalized or
  not, until the seat is paid; then the whole payment is Collected. Players cover
  counts that seat's whole price ($54, not $51, at 6 played). The dry-run books check
  (cash in = kept + held + credit + cashed out) holds at every step, and Players
  held = Money held. `tests/audit-money.test.ts` was updated to this rule.
- B: an unconfirmed "I paid" still counts as paid at finalize. The Finalize card and
  the Who played sheet now warn first: "Ryan tapped I paid, not confirmed yet. Confirm
  or finalize anyway." (names listed).
- C: Reopen with a late payer stays as is.
- Header: when the CREDIT chip leaves no room, "not you?" moves under the name, and a
  long name wraps to two lines (was "Brand..."). Test: `e2e/dryrun-screens.cjs`
  (360, 375, 390, 430 px, light and dark).

Tests: `tests/dryrun-money.test.ts` (18), `tests/dryrun-clock.test.ts` (31),
`e2e/double-tap.cjs` (4).

Earlier game times (7:00 to 9:00 PM, 7:30 to 9:30 PM), checked with games moved through
the existing per-game time change, on both sides of Nov 1: cancellation deadline (12
hours before the real start), late drop, the 36-hour drop alert, day-before and last
call cards, "started", Finalize at the real end (9:00 / 9:30 PM), the post-game note,
the .ics file, day words and week labels, and every text all follow the game's own
time. Tests: `tests/dryrun-times.test.ts` (23) and the 7 PM / 7:30 PM cases in
`tests/dryrun-money.test.ts`.
Hardcoded 8 to 10 PM (for the team changing the regular time): `shared/settings.ts:67-68`
(`SESSION_START` / `SESSION_END`, used by `shared/schedule.ts` for every newly made
Tue/Thu game), `src/pages/Setup.tsx:92` (setup text), `src/pages/Admin.tsx:481-482`
(+ Add game form starts at 8 to 10). Many e2e files assume generated games are at 8 PM.
Moving every game one by one gives each a "Moved" tag and Moved text.


Deploy (Fri Oct 30, 2026, about 1:20 PM Eastern): deployment `e7074075`, commit 0b21eb1,
branch main, no database change. Time Travel bookmark right before:
`0000013a-00000000-00005114-f6fdc0f2b454288716c5732243f9a2f8` (an earlier one at the
backup: `00000138-00000000-00005114-91a3bb2d82c626aa912c08fdb364a4d5`). Full SQL export
before deploy (144 rows, has phone numbers, not committed):
`live-before-dryrun-fixes-2026-10-30.sql` in that session's scratch folder. Code rollback:
deployment `f8b0971e`. Tests: 645 unit, 843 browser (run 229, names 24, gates 32,
alerts 52, court 84, held 81, credit 153, suggest 35, popup 33, texts 52, circles 18,
audit-stage3 3, cancel-reason 8, round2 25, want-in 4, double-tap 4, dryrun-screens 6),
all green. After deploy, read-only: the backup address returned 200 with the new bundle.
## "Do this now" card, smart Telegram alerts, game times and courts (Oct 30, 2026)

Status: built and tested; deploy details below.

### What changed
- **One brain.** `nextTasks()` in `shared/tasks.ts` makes the organizer's task
  list. The card at the top of Home and the Telegram alerts both use it, so they
  always say the same thing. Refund requests stay first, with their own card and
  alert. Full rules, timing constants and free-plan math: `docs/SMART_ALERTS.md`.
- **Courts gate the alerts.** Without "court booked" a game gets no last call
  and no cancel warnings. Instead:
  - a 6:45 AM heads-up and a 7:30 AM follow-up, only for the game exactly 14
    days out (CourtReserve opens at 7:00 AM)
  - a morning-of check at the deadline + 15 minutes, when 4 or more are in
  - "has no court yet" on the card for the next 2 games.

  Booking after an alert time never sends that alert late. Booking after the
  last call shows a one-time "Court booked for tonight" card.
- **Times follow each game.** Every time comes from the game's own start, end
  and cancellation deadline (wall clock, so the Nov 1 clock change is safe):
  - last call 25 hours before the start
  - cancel warning 10 hours before the deadline, follow-up 30 minutes later
  - game-day check 45 minutes before the deadline
  - finalize 5 minutes after the end.
- **Usual game time.** Settings > Schedule > Usual game time (start and end,
  default 8:00 to 10:00 PM). It's stored in the existing settings, so no
  schema change. It only shapes new Tue/Thu games. Regular games are matched by
  calendar day, so changing it never adds a second game on a day. The Add game
  form starts at the usual time.
- **Changing one game's time.** Gear > Edit booking > Change time or date. The
  end moves with the start. Saving opens the existing Moved text, then asks "Is
  the court booked for the new time? Yes / No" (new `court-answer` route).
  - On the same day, alerts not sent yet move and sent ones never repeat.
  - Moved to another day, its alerts and taps start over.
- **The clock.** A separate tiny Worker, `pickleball-alerts-clock`
  (`worker/cron.ts`), runs a cron every 5 minutes. It only calls
  `/api/cron/tick` with a shared secret (`CRON_SECRET`). The site sends with
  its existing Telegram secrets.
  - Each alert is claimed before sending, so it goes once.
  - A missed tick catches up within 60 minutes.
  - A failed send is retried every 15 minutes, up to 3 tries.
  - The hourly limit is shared with player alerts.
  - Kill switch: Settings > Alerts > Smart alerts. "Send TEST smart alert"
    sends one message that starts with "TEST".
- **Direct text link.** The night-before alert links to `/go/<token>`. That page
  opens Messages with the text and no recipients, and shows a big Open Messages
  button if the phone blocks it. The token is signed, single purpose, expires in
  6 hours or at the start, and has no phone number.

### Database
`migrations/0015_task_log.sql`: one new table, `task_log`. It holds card taps,
when a court was marked booked, sent and failed alerts, and the Smart alerts
switch. Additive only.

### Deploy 1: the new table, the card, game times, court rules (Fri Oct 30, 2026, about 2:00 PM Eastern)
- Merged with the dry-run channel's work first (main at 357b0d7).
- Migration `0015_task_log.sql` applied to the live database at about 1:58 PM.
- Pages deployment `5ab12c01`, commit dcafeaf.
- Read-only checks: site 200, the new screens are in the live bundle, the
  `task_log` table is there and empty, and `/api/cron/tick` answers Not found
  (no secret yet).
- Restore points:
  - Time Travel bookmark right before the migration:
    `0000013b-00000000-00005114-e0b9eae6abdcff65e60ba9667f75bb08`
  - Full SQL export (144 rows, has phone numbers, not committed):
    `live-before-smart-alerts-2026-10-30.sql` in this session's scratch folder.
  - Code rollback: Pages deployment `e7074075` (commit 0b21eb1). The old code
    ignores the new table, so rolling back needs no database change.
- Tests on the merged code: 704 unit, 856 browser checks in 18 files, all green.

### Deploy 2 (clock Worker) and 3 (direct text link): waiting on Alex
- This session can't write Cloudflare secrets (blocked by its safety rules),
  and its Cloudflare key can't create Workers ("No access"). So the Worker and
  `CRON_SECRET` still need setting up. Until then no smart alert is sent; the
  card on Home works.
- Paste-ready Worker code: `worker/dashboard-paste.js`.
- Deploy 3: set `GO_LINKS = "on"` in `wrangler.toml` and redeploy (after
  Deploy 2). The TEST smart alert then carries a TEST direct link (never marks
  anything done) for the iPhone test.
- Step-by-step for the next session: `docs/SMART_ALERTS.md`, "Finishing Deploy 2 and Deploy 3".
- Tests after the last change: 705 unit; browser 856 (run 229, names 24, gates 32, alerts 52, court 84,
  held 81, credit 153, suggest 35, popup 33, texts 52, circles 18, audit-stage3 3, cancel-reason 8,
  round2 25, want-in 4, double-tap 4, dryrun-screens 6, do-now 13), all green.


## Live updates, Game on, My games, loading polish, Undo (Fri Oct 30, 2026)

Status: built and tested on the branch `claude/new-session-ekyoyg`. NOT deployed, NOT merged to main (see the report). Presentation and light behavior only: no money rule, money math, schema or migration change.

### What changed
- Live updates: the open page asks `GET /api/group/version` (a 16 character fingerprint, nothing else) and loads the full list only when it changed. Rhythm, kill switch and the free-plan math are in `docs/LIVE_UPDATES.md`. Kill switch: `LIVE_UPDATES.on` in `src/livecore.ts`.
- Silent updates: new balls spin in, a new name fades in, no banner. Nothing is applied while a sheet is open, a button is saving, a finger is down or someone is typing (`src/busy.ts`); it lands right after.
- Game on: my tap that makes the 4th shows the banner "Game on!" with a popping pickleball. The first look after a game I am in reached 4 ripples the circles once and shows "Game on! 4 in" once, remembered per device (`pb_celebrated`, try/catch, in-page memory if storage is blocked). Dropping under 4 resets it. No text was added to cards.
- All games / My games: a quiet switch at the right end of the first section line (44 px tap area), remembered per device (`pb_games_filter`). My games = in or waitlisted. Empty: "You're not in any games yet" and "See all games"; the switch stays.
- Loading: placeholder cards the size of real ones, fades for cards in and out, a pressed look on every button and link, preloaded main font. I'm in and Drop out change the card at once and roll back with the error banner if the server says no. Payments are never instant.
- Errors: every failed tap uses the one banner; lost connection says "No signal, try again".
- Cash out sent: the player sees one banner "Alex sent your $14" per cash out (`pb_cashout_seen`), only for cash outs from the last 14 days, from their own credit history only. It also fires for the Players-tab direct refund (same ledger entry).
- Undo: after Drop out the banner says "You dropped out." with Undo for 5 seconds. The drop is HELD (not sent) and sent when the 5 seconds end, or at once if the page is hidden or closed (fetch with keepalive). Undo, or tapping I'm in, throws the hold away, so the seat and paid state were never touched. Same for the organizer's Remove player. Not for Cancel session.
- Only one new server field: `PlayerSessionView.dropCutoffAt` (the cancellation deadline). A drop within 8 seconds of it (or 10 seconds of the start) is sent at once, so the 5 second wait never changes whether it counts as a late drop.

### Decisions
- Organizer screens are not live-updated (different data, more risk); skipped on purpose.
- Pending-drop note (`pb_pending_drop`): if the page died before the held drop was sent, the next open sends it, only when the note is 7 seconds to 2 minutes old and the server still shows the player in.

### Code
`src/livecore.ts` (rhythm, pure), `src/live.ts` (hook), `src/busy.ts`, `src/hold.ts`, `src/optimistic.ts`, `src/celebrate.ts`, `server/stamp.ts`, PlayerHome / ui / Sessions edits, CSS at the end of `src/player-cards.css`.

### Tests
- Unit: tests/live-version.test.ts (fingerprint: opaque, tiny, moves for roster and own money, not for other players' money), tests/live-poller.test.ts (the rhythm and a simulated hour), tests/live-memory.test.ts (Game on, cash out, instant taps).
- Browser: e2e/live.cjs (26 checks). Existing e2e files updated for the 5-second Undo wait and the new banner text, none weakened.
- A fresh reviewer that did not write the code checked privacy, money and runaway polling; its findings (late-drop edge, stale pending note, silent Undo, back-off when only the full load fails) were fixed.

### Deploy: live updates, Game on, My games, Undo (Fri Oct 30, 2026, 4:24 PM Eastern)
- Merged with main (Smart alerts, time editor, direct text link; conflicts only in package.json, tsconfig.node.json and these notes, both sides kept). After the merge: 741 unit tests and 886 browser checks, all green. Commit 6f7b9fa on main.
- Pages deployment `00fbd694-ead3-45a8-9deb-c3baf41f3e8d` (Production, branch main). No database change, no migration. Smart alerts' Worker, cron and GO_LINKS were not touched (GO_LINKS stays "off" as in wrangler.toml).
- Restore points: Time Travel bookmark right before `0000013d-00000000-00005114-affb60a7d3f2da351cabc32a97e645fe` (an earlier one: `0000013c-00000000-00005114-fb8558b0fbb1cbd0f75a5994e9be2816`); full SQL export (145 rows, has phone numbers, not committed) `live-before-live-updates-2026-10-30.sql` in this session's scratch folder. Code rollback: Pages deployment `5ab12c01-0ce4-4d34-a905-6efd2edb6011` (commit dcafeaf, Smart alerts deploy 1).
- After deploy, read-only: home 200 with the new bundle, `/api/status` 200, `/api/group/version` 200 (24 bytes), `/api/group` 200. 100+ probe requests, no errors. Median from this sandbox: version 237 ms, full load 443 ms (network included).
- CPU per request and error rates from Cloudflare analytics could not be read: the API token has no Analytics permission and `wrangler tail` is blocked by the proxy. Check Workers & Pages > pickleball-club > Metrics (CPU time, errors, requests). Kill switch if needed: `LIVE_UPDATES.on = false` in src/livecore.ts, then redeploy.

### Smart alerts deploy 2 (site half) and deploy 3 (Fri Oct 30, 2026, 5:39 to 5:43 PM Eastern)
- No game that day. 741 unit tests green before deploying. No database change.
- Restore points: Time Travel bookmark before deploy 2 `00000141-00000000-00005114-14d86477422754533fb06b147b8fb9a2`, before deploy 3 `00000141-0000000e-00005114-a0b5382cccfba5132343823db349c5c4`. Full SQL export (151 INSERT lines, has phone numbers, not committed) `live-before-deploy2-2026-10-30.sql` in that session's scratch folder.
- Deploy 2: `CRON_SECRET` set on the Pages project (Production). Site redeployed from main 7591b29: Pages deployment `24d49885-5348-43a9-9cd8-57bdcdc63641`. Tick check: right secret answers `{"ok":true,"sent":0,"failed":0}` in 0.58 s; wrong or missing secret answers 404.
- Deploy 2 NOT finished: `npx wrangler deploy --config worker/wrangler.toml` failed with 403 "No access to the specified resource". The session's API token (ID `16e52fe92a6bf0db0e9fdc6587802e93`) still has no Workers Scripts or Account Analytics permission. No Worker, no cron, Worker secret not set. Nothing sends on its own yet.
- Deploy 3: `GO_LINKS = "on"`, commit 24c6384 on main, Pages deployment `fb9d3e50-de4a-4d99-a623-b498d081bc4c`. Check: a TEST direct text link for Tue Nov 3 returns the check-in text with `test: true` (marks nothing); a bad link answers 404.
- Rollback: deploy 3, set `GO_LINKS = "off"` and redeploy (or roll back to `24d49885`). Deploy 2 site half: roll back to `00fbd694`; the secret alone does nothing without the Worker.
- To finish: give the session a token with Workers Scripts Edit, then run steps 5, 6 and 8 of "Finishing Deploy 2" (Worker deploy, Worker secret, checks). The Worker secret must be the same value as the site's; if that value is lost, make a new one and set it on both, then redeploy the site.

## Banner position, card start times, games with no court (Fri Oct 30, 2026, evening)

Three front-end fixes, one deploy. No database change, no money logic touched.

### What changed
- **Pop-up banner** ("You're in", "You dropped out. Undo"): it was placed
  `safe area + 96px` up from the bottom (sized for the organizer's floating tab
  bar), so on the player screen it floated about 94px up and covered the next
  card's I'm in button. It now ends 20px above the bottom edge (16 to 24px; the
  iPhone safe area is counted once, through `--safe-bottom`). On the organizer
  screen it stands just above the tab pill. A banner that is leaving no longer
  catches taps. The 5-second Undo is unchanged and stays tappable.
- **Time under the date tile**: only the start ("7 PM", "7:30 PM", "10:30 AM"),
  sized to its column so it can never run into the names or Drop out (a
  7:30 to 9:30 PM game used to be wider than the tile). A game that is not the
  usual length from Settings > Schedule also shows its end on a second short
  line. The Want in prompt, its answer and the pay card say the same.
  Screen-reader text, organizer screens, texts and alerts are unchanged.
- **Games with no court booked** (player view only, `src/courtDisplay.ts`): they
  read like normal games. Status "Court not booked", count "3 of 4 in", button
  "I'm in" / "You're in" with Drop out, never the words waitlist, waiting or
  standby. Everyone who tapped I'm in on a game waiting on the venue is shown as
  in (the server still keeps them as standby until "Court opened"). No "$14 due",
  Pay or I paid, and no top Pay card, until the court is booked; booked and later
  un-booked, they go away again. A payment already made stays and shows as Paid.
  A booked, full game keeps its waitlist wording. Display only: amounts, credit,
  refunds and payment records are untouched.

### Decisions worth knowing
- Standby people on a game with no court count in "3 of 4 in". If more than the
  max tap I'm in before a court is booked, they all show as in; once the court
  opens the server confirms people in order up to the max, and anyone over it
  then sees the normal waitlist wording on the now-booked game.
- Several older browser checks assumed pay prompts on games with no court. They
  now book the court first (run, court, credit, texts, double-tap), and names.cjs
  books its one full game so the waitlist line is still covered.

### CPU per request (read-only look, Cloudflare Analytics)
- Cloudflare's analytics API reports CPU time in **microseconds**
  (`pagesFunctionsInvocationsAdaptiveGroups`, fields `cpuTimeP50` and friends),
  not milliseconds. It has no path or route dimension, so the 5-second check
  cannot be split from the full page load there.
- This session's token was refused by every analytics dataset ("authorization
  denied"), so no production numbers were taken. A token added to a cloud
  environment is only read by a new session.
- Local profile only (Node, 6 players, 12 games, NOT Cloudflare CPU): the
  change-check (`GET /api/group/version`, 9 statements, 1 batch of 7) about
  1.4 ms; the full page load (`GET /api/group`, 18 statements) about 4.7 ms.

### Restore points
- Time Travel bookmark taken Fri Oct 30 at 8:13 PM Eastern, before the deploy:
  `00000161-00000000-00005115-5466fc24ee114374e6aae8f0353e577b`
  (`npx wrangler d1 time-travel restore pickleball --bookmark=<that>`; this
  deploy changes no data, so rolling back the code is enough).
- SQL export, same time: `live-before-banner-times-nocourt-2026-10-30.sql`
  (165 rows, in this session's scratch folder; it has phone numbers, so it was
  not committed).
- Code to go back to: the 5:54 PM production deployment `87ad17c5` (commit 7be1b79).

### Tests
- Unit: 756 passed in 48 files, typecheck clean (new: `tests/court-display.test.ts`
  renders the real player card on real API data; `tests/player-cards.test.ts`
  covers the start-time helper).
- Browser: 22 suites, 916 checks, 0 failed (new: `e2e/banner.cjs` 11,
  `e2e/card-times.cjs` 13, `e2e/no-court.cjs` 10). Each new suite was shown to
  fail on the old code.


### Smart alerts tick CPU trim and tappable alert links (Fri Oct 30, 2026, 8:37 and 9:25 PM Eastern)
- Why: the tick measured 12.2 to 32.4 ms CPU; the free plan allows 10 ms.
- Cause: the date library's first use on a fresh server, the task list redoing the same time zone lookups about 75 times per game, and four separate database calls.
- Fix: a quick arithmetic check (`mayAlertSoon`) so most ticks build no task list; reused formatters and remembered time zone lookups; one database batch. Live after: 4.2 to 8.6 ms (middle 6.8); floor 3.4 to 4.3 ms. Details: `docs/SMART_ALERTS.md`, "Tick CPU".
- Telegram: "words: https://..." shows as tappable words with the same link (`server/telegram-links.ts`). Same wording, send times, /go/ link, GO_LINKS switch and Open site button.
- Proof: `tests/fixtures/tick-golden.json`, written by the old code, matches the new code at every 5-minute tick Oct 14 to Nov 27 (Sun Nov 1 clock change, 7:00, 7:30, 8:00 PM games, no-court game); 150 random games in every zone across four clock changes never lose a due alert. 766 unit tests, 893 browser checks in 22 files, all green.
- Deploys: Pages `d087f6ce` (commit dcafc3a, 8:37 PM) and `3748190d` (commit 483e2ce, 9:25 PM). No database change. Clock Worker untouched: runs every 5 minutes, 0 errors.
- Restore points: Time Travel bookmarks `0000014a-00000004-00005114-0a7d95b6118acbc8ec7497c655eab182` (6:40 PM), `00000167-00000000-00005115-a33828fd3013708f9198136a4f522f26` (before 8:37 PM), `00000172-00000000-00005115-f4eb03de0b830c0eb270f9ea479b1da4` (before 9:25 PM). SQL exports (165 rows, phone numbers, not committed) in that session's scratch folder. Code rollback: Pages `16bdf705` (polish deploy, commit 4508b42).
- Follow-up (Fri Oct 30, 10:50 PM): links only where a tap does the job. "Text the group" opens the direct /go/ text; CourtReserve words open CourtReserve; /admin words are plain (Open site button kept). TEST smart alert is one line with a TEST direct link on "Text the group".

## Credit used automatically at I'm in (Sat Oct 31, 2026)

Spec: CREDIT_SPEC.md from Alex (all decisions final). One money rule changed: credit
is used automatically at sign-up. Everything else about money is unchanged.

### What changed
- **At sign-up.** When a player gets a seat (I'm in, the Want in card, a claim link,
  the organizer adding them, moving in from a waitlist, Court opened), their usable
  credit (the pot minus a pending cash out) goes on that game at once, up to the $14
  owed. It is one database batch with the seat (`autoCreditStatements` in
  `server/credit.ts`, added to the seat statement in `tryConfirm` and `settle` in
  `server/roster.ts`). The amount is worked out inside the database, so two games
  tapped at once, a double tap, a retry or two phones never spend credit twice. The
  organizer never uses credit. Entries are tagged `reason = 'auto'` in `credit_ledger`.
- **Full cover**: "Paid with credit" at once, even with no court booked. **Part cover**:
  a "Credit $3 used" chip; "$11 due" and Pay appear once the court is booked.
- **Back**: Drop out, Remove player, cancel, court "Didn't open" and the organizer's
  Unmark put it back at once (as before). The 5-second Undo sends nothing, so the
  credit never moves. The organizer moving someone to the waitlist puts part credit back.
- **Pending cash out**: never used by itself. When it would help pay a game just
  joined, a small question at the bottom asks "Use the $10 you asked to cash out for
  this game?" (`src/pages/CashOutPrompt.tsx`). Use it (POST
  `/api/sessions/:id/use-cash-out`) puts it on the game and shrinks the request, or
  withdraws it when all of it is used, in one batch; the Home card shrinks or goes;
  one Telegram line under the "Refund requests" switch: "Mitchel withdrew the $10 cash
  out request (using it for Thu Nov 5)" (first name only; "the" instead of "his").
  Keep cash out just closes it. Mark refunded now sends the card's amount and is
  refused if the request changed since.
- **Who paid**: "Paid with credit" or "Credit $3" with Unmark (credit back to the pot).
  Players tab rows say "Credit $3 used"; the history shows each use and return.
  Activity: "Casey used $14 credit for Tue, Nov 3 (automatic at sign-up)".
- Use credit (the button) stays for credit that arrives after joining (like money back
  from a 5+ player game, which is never put on games already joined by itself).

### Fixed on the way (found by the fresh review)
- A cash-out request is saved only while the credit is still there.
- A drop turns the payment into credit only while the seat is still out (a second
  phone's I'm in in between could make a free seat).
- Did not play with credit on a seat that still owed: that credit now comes back
  (it used to stay stuck on the seat).
- "Back as credit" for a seat counts drop, rejoin, drop once, not twice.

### Database
No change, no migration. The existing `credit_ledger` already records credit used on a
game (kind `used` with the game's id).
