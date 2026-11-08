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

### Smart alerts deploy 2 finished: the clock (Fri Oct 30, 2026, 5:51 to 6:21 PM Eastern)
- No game that day. 741 unit tests green. No database change. Same token as before (ID `16e52fe92a6bf0db0e9fdc6587802e93`), now with Workers Scripts Edit and Account Analytics Read.
- Restore points: Time Travel bookmark `00000143-00000000-00005114-9dfd82a8be9a7bf4b2330d9c95ad2d9b` (5:51 PM). Full SQL export (164 INSERT lines, has phone numbers, not committed) `live-before-clock-2026-10-30.sql` in that session's scratch folder.
- New `CRON_SECRET` (the old value was lost) set on the Pages project and on the Worker. Not written anywhere else.
- Worker `pickleball-alerts-clock` created, version `8d0f28bc-c15f-4308-a186-b6cf96925641`, cron `*/5 * * * *`, workers.dev and preview links off.
- Site redeployed from main 7be1b79 (same code as fb9d3e50 plus notes): Pages deployment `87ad17c5`.
- Checks: right secret answers 200 `{"ok":true,"sent":0,"failed":0}` in 0.56 s; wrong or missing secret answers 404. Cron ran on its own at 6:00, 6:05, 6:10 and 6:15 PM, all success, 0 errors. D1 query analytics show the tick's reads (groups, sessions, task_log by game) at each of those minutes and no errors; those reads only happen after the secret check passes. Live tail is blocked by the session's network proxy.
- Cron triggers: the account's other Worker, fantasy-analyst, has 4, so the account is now at 5 of 5. No room for another.
- CPU (Account Analytics): Worker 0.47 to 0.80 ms. Pages production, last 7 days, 2,387 requests, 0 errors, median 8.9 ms, 90th percentile 24.0 ms, 99th 46.1 ms. The tick alone measured 12.2, 18.5 and 29.8 ms. No request has been stopped for CPU so far, but the tick is over the Free plan's 10 ms on paper. Worth trimming.
- Rollback: `npx wrangler delete --config worker/wrangler.toml` stops the clock. Site: roll back to `fb9d3e50`.

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


### Organizer cleanup: game cards, court switch, Edit game, live screens (Sat Oct 31, 2026)
Screens only. No money rule, amount, credit rule or Telegram word changed, and the player screens are identical.

- **Court switch on every game card:** `Not booked | Waitlist | Booked`, one tap, saved at once (`POST /api/admin/sessions/:id/court-status`, one write so a game can never sit half way between two states). Waitlist reuses the existing third booking value (`booking_status = 'unavailable'`, the one the old screens called "Not available") and also sets the venue-waitlist flag (`court_state = 'waitlist'`), so everything that already understood the court waitlist (standby order, "Court opened") works as before. No database change: the column already allows it. Old rows holding only the third value now simply read as Waitlist. "Not available" is gone from every organizer screen.
- **Players never see Waitlist.** `courtStatus` gives players "Court not booked" for it, `courtDisplay` draws it like any game with no court (everyone "in", no pay prompts). One planned difference: a game stored with only the old third value used to show players the gray words "No court available"; it now reads "Court not booked", as the spec asks.
- **Do this now** keeps "Court opened / Didn't open" for waitlisted games (a card per game, above the other task cards) and the "I booked it" card for games with no court. The blue "Court waitlist" block and the amber "Book / I booked it" strip are gone from the cards.
- **Gear pop-up** (small, anchored to the gear): Text the group, Edit game, Players, Add to calendar (when booked), Cancel session (red, last, apart). Escape or a tap outside closes it; arrow keys move between rows; focus returns to the gear. "Edit booking" and "Modify court" are gone.
- **Edit game, one sheet** ("Edit game · Tue Nov 3"): the same switch (held until Save), "Cancel by Tue 8:00 AM, set automatically.", Date / Start / End, "Change court on CourtReserve", one Save. A changed date or time uses the old Move session code (`PUT /api/admin/sessions/:id/time`, players are not texted, the Moved text sheet opens as before); a changed switch only changes the status. Removed from the screens: More details, Not available, the cancellation deadline editor, "Fill in 12 hours before start", the Deadline line, the Booking sheet.
- **Cancel-by is automatic:** always start minus 12 hours, worked out from the start every time it is shown (`cancelByIso` in `shared/time.ts`), so a move or a holiday needs nothing. Stored deadlines stay in the database untouched; the organizer screens just stop reading them. The server still keeps its own saved deadline for the drop rules (money logic, untouched); a move still rewrites it the way it always did. Note: Settings > Schedule still has "Cancellation deadline for new sessions (hours before play)". The cards no longer follow it (they always say 12 hours); the drop rules still do. It is 12 today.
- **Card:** the date tile with the start time under it (same fix as the player cards: sized to the tile's column, never wraps; no end time). One small pill under the names, "2 of 3 paid" (people paid of people in, organizer left out, hidden when nobody is in), opens the same Players sheet as the menu. Made from data that exists today; the credit channel's work has not merged, so Money and Players screens are untouched. A red "Cancel by 8:00 AM today" shows only in the last 24 hours before cancel-by.
- **Live organizer screens:** Home, game cards, Players, Money and History refresh by themselves like the player side (every 5 seconds while in use, every 15 seconds after 2 minutes idle, stopped after 10, one check on return to the tab). `GET /api/admin/version` is one batch of 7 small reads and returns a 16-letter hash; the full dashboard loads only when the hash changed. A refresh waits while the gear pop-up, any sheet or a finger is down, and Settings is left out so typing is never overwritten. A tiny "Updated just now" sits under the title bar (hidden while a sheet is open). Extra cost per open organizer screen: at most 720 tiny checks per hour while in use (about 240 per hour once idle for 2 minutes, none after 10 minutes), about 1 database batch each.

### Tests (organizer cleanup)
- Unit: `tests/admin-cleanup.test.ts` (22): switch, stored values, standby order, money untouched, players read Waitlist as Not booked, cancel-by across the clock change and holidays, move saves, pill numbers, the change stamp.
- Browser: `e2e/admin-cleanup.cjs` (22): phone widths 360, 393, 430 in light and dark, the switch (colors, 4.5:1 text, tap targets), the pop-up (anchor, order, keys, focus), Edit game, pill, cancel-by line, players' view, Do this now, live refresh that does not move the page or close a pop-up or sheet.
- Existing suites updated only where the old screens they drove were removed on purpose; see each file's history. Player-side checks were not changed.

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

### Deploy (Fri Oct 30, 2026, about 11:16 PM Eastern)
- Merged as #50 (main a46cf0f, after merging the alert clock channel's latest main).
  Pages deployment `f92365f0-f23c-4cbc-ba28-37fdc5e82fa8`, Production, branch main. No migration.
- Read-only look right before (11:05 PM) and after: credit only Mitchel at $0, no
  cash-out requests, unpaid sign-ups Nathan and Julian (Tue Nov 3) and Brandon (Thu Nov 5),
  2 ledger rows, 16 seats, nothing changed by the deploy.
- After: backup address 200 with the new bundle, `/api/status`, `/api/group`,
  `/api/group/version` and `/admin` 200 (pickleball.juncaj.net can't be reached from the
  build sandbox). Clock Worker: every run 0 errors. Tick CPU after the deploy: 10.9 ms on
  the first tick (fresh server), then 6.6 and under 9.5 ms.
- Restore points: Time Travel bookmark `0000018b-00000000-00005115-998001d3f534101cf4926f1d1e7d3585`
  (11:08 PM); SQL export `live-before-auto-credit-2026-10-30.sql` (169 rows, has phone
  numbers, in that session's scratch folder, not committed). Code rollback: Pages
  deployment `6721fb3d` (commit 6d35cb0). The deploy changed no data, so rolling the code
  back is enough.
- Tests: 828 unit (52 files), 938 browser checks in 23 files, all green.

## Money audit: correct in every case, and visible (Sat Oct 31, 2026)

Spec: AUDIT_SPEC.md and START_HERE.md from Alex. No money rule changed, no
database change, no migration.

### What was wrong and is fixed (server; each has a test that fails on the old code)
- **Half-moved money.** Drop out, Remove player, cancel, "Didn't open", un-cancel,
  Finalize, Reopen and Unmark each saved in several steps. A request cut off between
  them (the free plan's time limit, lost signal) could leave a player out with their
  credit still on the game, a canceled game still holding credit, or a half-finalized
  game, and a retry did not fix it. Each is now ONE batch with every amount worked out
  inside the database (`seatMoneyBackStatements`, `returnSeatCreditStatements`,
  `repriceStatements`, `creditBackStatements`, `holdCashStatements` in server/credit.ts);
  a retry finishes or changes nothing. Finalize also refuses if any seat or credit
  changed since it looked (`MONEY_STATE` in server/finalize.ts).
- Mark paid / I paid could land on a player who had just dropped out (paid, out).
- Undo of "Paid with credit" after Finalize gave back all the credit while the money
  back from it stayed ($3 made). Refused once finalized.
- Reopen unpaid a seat paid part credit, part cash and dropped the cash ($4 lost). The
  cash is held against the seat, as Finalize does.
- A refused Unmark (credit from the game already spent) still shrank the payment ($7 lost).
- Finalize after the flat price went up held a seat's credit as cash too ($5 made).
- I paid / Mark paid / Use credit landing just after a Finalize or Reopen (even a redo
  at the same price) used the new price, or spent credit on a did-not-play seat. They
  now check the exact finalize they read. I paid also sends the amount the screen showed.
- A Reopen from a second device wiped a newer Finalize's credit back ($15 lost).
- Unmark of "Credit $3" racing Finalize gave the $3 back twice.
- Renaming the organizer in Settings could turn their court payment into a player's
  credit on cancel; the organizer's id is saved before a rename, and a court-payment
  row never becomes credit.
- "I booked it" (or a booking edit) just after a cancel brought the canceled game back.
- Price set to $0: anyone with credit got an error on I'm in.
- The cash-out request Telegram line used the full saved name; now the first name.
- A double-tapped Cancel answers "nothing changed" instead of an error.

### Players see what happens to their money (player screens; preview, waits for "ship it")
- Drop out: "You dropped out. $14 credit returned." ("$14 back as credit." for cash,
  just "You dropped out." when nothing was paid), with Undo.
- I'm in: "You're in. $14 credit used." / "You're in. $3 credit used, $11 due."
  (no amount due before Court booked; same after "Game on!").
- The CREDIT chip's sheet lists the last 10 changes in plain words, newest first,
  returns included ("Oct 31: $14 returned from Nov 5 (you dropped)"). Kept the
  existing chip instead of adding a second "Credit $14" line under the name (the
  chip already shows only when there is credit or a pending cash out).
- New card fields `dropCreditCents` / `dropCashCents`; the player's own credit history
  now includes ended entries (their own only).

### Not fixed (and why)
- Organizer screens wait for the admin cleanup (not merged): Players-tab Held leaves
  out cash held against an unpaid seat (`heldCents`); Money tab counts a held cash pair
  on a settled did-not-play seat as Collected; Mark paid and Unmark don't send the
  amount the screen showed (a stale organizer screen); the Players-tab Undo of a
  refund should send the refund id (server accepts `ledgerId` now).
- Decisions for Alex: an unconfirmed "I paid" becomes credit on drop or cancel and
  Unmark can't take it back; Unmark ends cash held against a seat; seats are not
  repriced when the flat price setting changes.

### Tests
- `tests/money-cutoff.test.ts`: every money action cut off at every write and retried
  ends like a clean run; exact races.
- `tests/ledger-fuzz.test.ts`: random sequences of every money action (double taps,
  two at once, clock moves) with the books checked after every step. Default 360
  sequences (~9,800 steps, ~50 s); `FUZZ_SEQS` / `FUZZ_PAR_SEQS` for long runs (6,000
  run clean).
- `tests/audit-attack.test.ts`: the independent attack suite (exact interleavings,
  cut-offs on 21 actions, random sequences with full books).
- `tests/audit-oct31.test.ts`, `tests/money-visible.test.ts`, `e2e/money-visible.cjs`.

### Round 2 (Sat Oct 31, 2026, morning): Alex's answers
- Base: the live site runs the admin cleanup (branch `claude/new-session-sm74gy`, commit
  41dea7a, deployed as production "main" but never merged into GitHub main). It was
  merged into this branch first, so deploying this branch keeps it.
- Read-only live check (8:35 AM): no pot below $0, no credit or cash stuck on a seat
  that left or a canceled game, no cash out larger than its pot, organizer id saved.
  Only one player has credit history (Mitchel: $14 back from the canceled Oct 29 game,
  used on Thu Nov 5; balance $0, matching his history and the Nov 5 seat). 2 unconfirmed
  "I paid" taps live, 0 pending cash outs.
- Decisions built: unconfirmed I paid is a claim (Home card Paid / Didn't pay, nothing
  on the seat moves until then, Held not Collected); Unmark undoes only the latest
  payment; organizer Mark paid / Unmark carry what the screen showed (`moneySeen`);
  Players-tab refund Undo names the refund (`ledgerId`); Players Held and Money
  Collected fixes. Tests: `tests/decisions-oct31.test.ts`.
- Not built, waits for Alex: "existing sign-ups keep the price they signed at" needs
  one new additive table (the price each seat signed at is not stored today).
- Restore points before the preview: Time Travel bookmark
  `00000218-00000004-00005115-0636e0716ea7288a3b03715050d8c00f` (10:22 AM Eastern);
  SQL export `live-before-money-audit-preview-2026-10-31.sql` (185 rows, has phone
  numbers, not committed) in this session's scratch folder.

### Round 3 (Sat Oct 31, 2026, evening)
- Drop out shows the money at once: the drop stays held on the phone for Undo (5 s), and
  the screen draws in its credit with the banner (src/optimistic.ts). Kept the client
  hold instead of a server-side drop + reversal: a real reversal would have to undo a
  waitlist promotion and Telegram drop alerts made in those 5 seconds. Safe because
  nothing is saved until the send, the send is idempotent (a seat can only leave once),
  and a note on the phone finishes a drop the page could not send (closed, no signal),
  up to 2 minutes. Two gaps there were fixed (a failed send while leaving lost the note;
  a too-young note was ignored for the whole visit). tests/held-drop-fuzz.test.ts.
- Live Mitchel (read-only, 6:00 PM): Thu Nov 5 is on the venue's court Waitlist, so his
  I'm in is standby (owes nothing; the credit waits for Court opened, by rule). Pot $14 =
  history. Nothing inconsistent; no fix needed. The card now says "Your $14 credit goes
  on this game once the court is booked."; a player in and owing on a no-court game with
  credit now sees "Use $14 credit" (Pay still waits for Court booked).
- Third fresh audit: 7 findings, all fixed (tests/audit-r3.test.ts).
- Price-at-sign-up plan: docs/PRICE_SNAPSHOT.md (after Tue Nov 3). $14 setting frozen.
- Preview redeployed 6:55 PM (same link), commit bc2d4c5. Bookmark right before:
  `00000280-00000000-00005115-946ddeaca1c4ff680436a4e361d1811e`.

### Round 4 (Sat Oct 31 to Sun Nov 1, 2026, night): Alex's five fixes, then production
- Pay and I paid stay hidden until Court booked; credit can go on any time (unchanged).
- Unconfirmed I paid on a seat marked "did not play" at Finalize stays a claim (Home card
  Paid / Didn't pay). Finalize skips it; nothing becomes credit until the organizer
  confirms. A played seat with an unconfirmed I paid has its money back withheld until
  Mark paid, which issues it in the same save. Reopen refuses while an unconfirmed short
  I paid would be undone ("look again").
- Drop then quick I'm in on another game: the phone sends any held drop first, then the
  I'm in (src/pages/PlayerHome.tsx sendDropsBeforeJoin), so the new seat picks up the
  credit. Booked, Not booked, venue Waitlist, reload and no signal covered in
  tests/held-drop-fuzz.test.ts.
- Remove player on a standby seat: no credit made, none lost (tests/audit-r4.test.ts).
- Instant CREDIT chip on drop kept; Undo takes it back.
- Two fresh audits: A (6 passes) clean; B found F1 to F4 and G1 (Unmark racing a Finalize
  or Reopen from a second organizer device). All fixed: every Unmark and Mark paid step
  is tied to the finalize it read, so a change in between gets "look again" and no money
  moves. Old test BUG 5 rewritten for decision 3 (Unmark undoes only the latest payment).
- Still open, cannot happen while $14 is frozen: lowering the price below credit already
  on an unpaid seat leaves that seat unpaid until Finalize (ledger-fuzz case G).

### Deploy (Sun Nov 1, 2026, 12:05 AM Eastern)
- Gates: unit 1,203 passed (1 replay helper skipped by design), browser 25 files all
  green (run.cjs 229/229 and admin-cleanup 26/26 rerun on a quiet machine), audit A clean
  (b77e3c1, code unchanged since), audit B clean (1627848, 72 more race variants).
- Production deployment 5674340d, commit c68fd63. Previous: c1bad936 (commit 41dea7a).
- Restore points: Time Travel bookmark
  `000002bf-00000000-00005116-9c9ae9bcc6928f296fc5f46421b048ca` (12:05 AM); SQL export
  `live-before-round4-deploy-2026-11-01.sql` (213 rows, phone numbers, not committed) in
  this session's scratch folder.
- Read-only live check after: no pot below $0, no credit or cash stuck on a left seat or
  canceled game, no cash out above a pot, no pending cash outs. Only pot: Mitchel $14 =
  his history (kept $14 from canceled Thu Oct 29; three later uses all ended). One open
  unconfirmed I paid: Mitchel, Tue Nov 3 (booked, still in): not a claim, it waits for
  Mark paid as usual. His Oct 29 I paid became the $14 on Oct 28, before the claim rule.
- Rollback: Cloudflare dashboard, Pages, pickleball-club, Deployments, c1bad936,
  "Rollback to this deployment". No data change to undo.


### Organizer cleanup, Waitlist rule, seat repair (Sat Oct 31 to Sun Nov 1, 2026)
Screens, one seat rule, and one one-time repair. No price, amount, credit rule or Telegram word changed. No database change.

- **Shipped Oct 31, 12:25 AM and later (deploys `c1bad936`, preview-checked):** court switch (Not booked | Waitlist | Booked), gear pop-up, Edit game sheet, automatic cancel-by (start minus 12 hours), paid pill, start time under the date tile, live organizer screens (`GET /api/admin/version`), one Do this now card per game, gear menu that opens down, up, or as a panel above the tab bar and never moves the page, "Not booked" on two lines, even card spacing (10 px top and bottom, 7.2 px between count row, names and pill).
- **Seat rule, deployed Sun Nov 1, 3:15 AM Eastern (deploy `23ff4137`, then `eea78540`):** a court set to Waitlist behaves exactly like Not booked for sign-ups. I'm in gives a normal seat, credit goes on at I'm in, and Pay stays hidden until Court booked. A real waitlist exists only when the game is full beyond Max players. Moving the switch, Court opened and the old court endpoints never move a seat, payment or credit. Didn't open still cancels and every credit use comes back. Players keep seeing "Court not booked". The card line "credit goes on once the court is booked" is gone with the standby seats it described.
- **One-time repair (ran once, then removed):** a route that ran the site's own `settle` for upcoming games on Waitlist with people waiting and room. Dry run showed only Mitchel on Thu Nov 5 (Brandon already in). The real run moved Mitchel in and put his $14 on (Paid with credit). Alex's Nov 5 seat was dropped and was not touched. The route and its token are gone (production answers "Not found", also with the old token).
- **Live check after (read-only):** Nov 5 Brandon and Mitchel confirmed, Alex withdrawn; Mitchel's ledger: kept $14, live "used" $14 on Nov 5 (reason auto), pot $0; nobody waiting anywhere while a game has room; no pot below $0; no cash-outs pending.
- **Restore points:** Time Travel bookmark `000002f1-00000000-00005116-9fda069f0c40099d335fc6afec7bc73b` (taken Sun Nov 1, about 3:10 AM Eastern), SQL export `live-before-waitlist-rule-2026-11-01.sql` (213 rows, phone numbers, in the session scratch folder, not committed). Code rollback: Pages deployment `5674340d-06c9-4b10-9408-55cb4a5a34d3` (commit c68fd63, the money audit).
- **Tests:** 1,218 unit passed (1 skipped from the money audit's tests); browser suites all green (run.cjs 229, admin-cleanup 36, money-visible and the rest). Tests that assumed "a Waitlist court makes standby seats" were rewritten to the new rule, none deleted.
- **Preview:** a separate throwaway database `pickleball-preview` (fake data) and the branch preview `preview-admin-look` were made for the look checks; they hold no real data and can be deleted.

## Behind-the-scenes audit (Sun Nov 1, 2026)

Audit 3 of 3 (alerts, the clock Worker, Telegram, time, security, data, free
plan, backups, deploy settings). Scenario list: `docs/AUDIT_SCENARIOS_behind.md`
(312). Runbook: `docs/RUNBOOK_TUESDAY.md`. No database change, no money rule
change, nothing players or the organizer see changed.

### Fixed (each with a test that fails on the old code)
- A player name like "Bob: https://..." became hidden link words in the
  organizer's Telegram alert. Alerts that carry names now have no links; the
  clock's alerts link only the exact /go/ and CourtReserve addresses.
- A cookie with a broken %-escape (say from another juncaj.net site) made
  every request fail for that browser.
- "Court waitlist" racing a cancel could bring the canceled game back with
  everyone's $14 already returned as credit (a free game). Refused now, also
  on a finalized game.
- Group-word guesses sent all at once were all checked; now at most 10 per
  15 minutes (the group word is off on live).
- A game canceled while a slow tick was sending could still get the tick's
  next alert; the claim now checks the game is still on.
- One player toggling in and out could use up the 20 alerts an hour and
  silence the clock's cancel warning. Alerts from player taps now stop at 15
  an hour, so the clock always keeps a few.
- Names with U+0085, U+2028 or U+2029 (line breaks in disguise) are refused.
- Preview deployments were bound to the LIVE database. New previews use the
  throwaway `pickleball-preview` database (`[env.preview]` in wrangler.toml).
  Old preview links keep the live binding until redeployed or deleted.

### Checked, no change needed
- Five weeks of 5-minute ticks through the real tick, compared with a second,
  independent copy of the alert rules: every alert once, on its first tick.
  Late, doubled and down clocks, Telegram slow or down, edits between ticks,
  the Nov 1 clock change. First real alert: Mon Nov 2, 7:00 PM ("Tuesday: 3
  players in, need a 4th." with the direct text link), replayed from live
  counts read-only.
- Every organizer route refuses without the PIN; cookie flags; PIN lockout;
  cross-site requests; other players' ids; every field with hostile values.
- `scripts/integrity-checks.sql` (read-only): 0 on live for all 19 checks.
- SQL export restored into a scratch database: every row count matches live.
- Build reproducible; no secrets in the repo or built files; 0 vulnerable
  packages in what ships.

### Free plan (worst case, game day)
Requests about 12% (extreme 44%), D1 rows read about 28% today and growing
with history (each 5-second check reads every game ever made), rows written
under 1%. Site CPU per request on live: p50 6 ms, p90 13 ms, p99 41 ms
against the 10 ms limit, 0 errors so far. Clock Worker 0.6 ms.

### Deploy (Sun Nov 1, 2026, 9:07 AM Eastern)
- Merged as #53 (main 79c82ab). Production deployment `95faf42e`, branch main.
  No migration, no data change. Production still bound to the live database,
  all secrets present.
- Restore points: Time Travel bookmark
  `00000340-00000000-00005116-3a0500ef5cdb9021c43384f4f36d9077` (9:07 AM; an
  earlier one at 6:47 AM: `00000320-00000000-00005116-2ff371e0501ec3c0b997fc1d635c0a07`),
  SQL exports `live-before-behind-audit-2026-11-01.sql` and
  `live-before-behind-deploy-2026-11-01.sql` (217 rows each, phone numbers, not
  committed) in that session's scratch folder.
- Code rollback: Pages deployment `eea78540` (commit 7b1f14b). The deploy
  changed no data, so rolling back the code is enough.
- Read-only checks after: home, /admin, /api/status, /api/group/version 200
  with the new bundle; a broken cookie no longer errors; the tick refuses
  without the secret; health checks 0.
- ~~Until a preview is proven to use a fake database, previews are tested in View as demo mode only.~~ Superseded Sun Nov 1, 2026 (evening): previews are proven to use the fake database; see the last section, "Fake-data preview".
- Previews: `[env.preview]` is in wrangler.toml, but the project's stored
  preview setting still names the live database and no preview has been
  deployed since, so the new wiring is not proven yet. Until a preview is
  deployed and checked (its /api/group/version must differ from live), treat
  every preview link as writing to live data.
- Tests: 1261 unit; browser 984 passed, 1 failed (admin-cleanup "Edit game
  on a short phone", fails on main too).

### Not fixed (see the report)
- Two Finalize requests in the same millisecond with different lists both
  partly apply (money code; needs two requests in one millisecond).
- 40 self-adds at once pass the 30-name cap.
- e2e/admin-cleanup.cjs "Edit game on a short phone" fails on main too
  (admin screens channel).

### Follow-up (Sun Nov 1, 2026, about 9:30 AM Eastern, Alex's answers)
- Deleted on Alex's OK, after checking no channel used them (no deploys since
  Sat Oct 31 7:40 PM, every commit already on main, not named on any active
  branch): the old preview links `money-audit-preview` (deployments 81b06ad0,
  a9bc4120, 0f70f326) and `claude-new-session-5n1wup` (9314fa21). Both wrote to
  the live database. Both addresses now answer 404. The git branch
  `claude/new-session-5n1wup`, the `preview-admin-look` preview, every database
  and every other branch were left alone.
- Database index for the 5-second check: written up, not applied. Waiting for
  Alex's OK after Tue Nov 3: `docs/PROPOSAL_INDEX_SESSIONS_ENDS_AT.md` (exact
  change and rollback).
- CPU and rows read: watch only. Any phone can pick any name: kept as is.

## Player screens audit (Sun Nov 1, 2026)

Audit 1 of 3 (player screens). Base: main 8d8ed0c, caught up to the live site first (PR #52, plain merge, no deploy:
the live site already ran that code). Every scenario, result and test is in `docs/AUDIT_SCENARIOS_player.md`.
No database change, no money rule, price or credit rule changed.

### Live on their own (bug fixes, no visible change)
- Raising Max players moves waiting players in, first in line first (they used to stay waiting next to open spots).
- The held drop (5-second Undo) and its note on the phone:
  - sent first when switching names (not you?, Add my name), using credit, or asking to cash out;
  - one note per game (`src/dropNotes.ts`), tied to the player and the seat (sign-up time), cleared by I'm in on
    that game, re-read after every server check, never written, read or sent by View as;
  - every real drop is sent with keepalive; a demo drop never reaches the live site after Exit.
- A double tap on the drop question's Drop out no longer lands on the banner's Undo.
- The red error card no longer sticks after a failed tap (the banner already says why).
- Add my name: accents folded (Jose finds José), names in every alphabet kept apart.
- Tap areas (calendar icon 44 px; I paid / Drop out no longer take the bottom of Pay), money chip wraps at big text.

### On the preview, waiting for Alex's "ship it"
- "Good news, a spot opened up" shows only the first time on that phone (`src/goodNews.ts`, browser storage only).
- "Out for Tuesday?" (not "next Tuesday") two days ahead.
- Canceled cards not see-through (contrast); "If you paid, it's now your credit." only for players who were in.
- The CREDIT word on the chip readable in dark mode.

### Tests
- New: `tests/audit-player-api.test.ts` (214), `tests/good-news.test.ts`, `tests/fresh-{a,c,d,e,f,g}-nov1.test.ts`,
  `e2e/audit-player-flows.cjs`, `e2e/audit-player-look.cjs` (12 checks marked OPEN: big text and a 29-letter name),
  `e2e/good-news.cjs`, `e2e/fresh-attack.cjs` (random hostile sequences, not in test:e2e, about 20 minutes).

### Deploy (Sun Nov 1, 2026, 11:56 AM Eastern)
- Main caught up to the live site first: PR #52 (merge commit 8d8ed0c, same code as deployment eea78540). No deploy for that.
- PR #56 merged as e38a399 (bug fixes with no visible change). Production deployment `e8f47388`, branch main.
  No database change, no migration.
- Restore points: Time Travel bookmark `00000364-00000000-00005116-c7d34c5734392e7451e977f37816e8d3` (11:55 AM);
  SQL export `live-before-player-audit-2026-11-01.sql` (221 rows, has phone numbers, not committed) in this session's
  scratch folder. Code rollback: Pages deployment `95faf42e` (the behind-the-scenes deploy, commit 79c82ab). The deploy
  changed no data, so rolling back the code is enough.
- Tests on the deployed code: 1,495 unit (81 files); browser files all green (run 229, names 24, gates 32, alerts 52,
  court 84, held 81, credit 153, suggest 35, popup 33, texts 52, circles 18, audit-stage3 3, cancel-reason 8, round2 25,
  want-in 4, double-tap 4, dryrun-screens 6, do-now 13, live 26, banner 11, card-times 13, no-court 10, auto-credit 22,
  money-visible 12, admin-cleanup 35, audit-player-flows 92, audit-player-look 127 + 18 open).
- After deploy, read-only: the backup address serves the new bundle; /api/status, /api/group, /api/group/version and
  /admin answer 200; row counts (seats 17, credit entries 5, cash-out requests 0, players 10, games 8) match the export.
- Previews: tested in View as demo mode only (see RUNBOOK_TUESDAY.md); the preview of the visible changes uses the live
  database, so no real taps on it.

## Admin audit: organizer screens (Sun Nov 1, 2026)

Audit 2 of 3 (player screens and behind the scenes run in their own channels). Started from main
8d8ed0c (main caught up to the live site: money audit, organizer cleanup, Waitlist rule).
Scenario list with a status for each: `docs/AUDIT_SCENARIOS_admin.md` (238 scenarios: 191 pass,
14 fixed, 33 built, 0 open).
No money rule, price rule, schema or migration change.

### Requested change 16: the court card for a game never marked Booked
- A game that is not canceled and was never marked Booked (Waitlist or Not booked) gets one card
  in Do this now (`courtCards` in `src/pages/admin/doNow.ts`, `CourtCardView` in `DoNow.tsx`).
- Before the game is over: "Court still needs to be booked" with "Book a court" (the same link,
  words and look as the "Book a court" pill), nothing else. Date and start time on top. Waitlist games get it until they end; Not booked games
  when the task list already asked about their court (booking day, the morning of, the next 2
  games open to book), as before.
- After the game's date has passed (Eastern calendar day, not the start time), with someone in and
  not finalized, for up to 28 days: "Did you guys play?" with "Yes, we played" and "Cancel game".
  - "Yes, we played" saves a server mark (`task_log`, mark `played`; no new table, the task name
    is free text), changes no money, then the game's Finalize card shows and gets focus. Until it
    is answered, that game's Finalize card and "finalize who played" task wait: one question at a
    time. Finalize itself also leaves the mark, so a game reopened later is never asked again.
  - "Cancel game" opens the usual Cancel session dialog (credit back to each paid player once).
    That dialog no longer shows "This does not cancel your court" once the game has started.
- "Court opened" / "Didn't open" are gone; the Booked switch does that job. Telegram alerts are
  unchanged (the 5-minute tick's golden file still matches).

### Requested change 15: an X on notice cards
- X (44 px, top-right, labeled "Dismiss: ...") on Spot opened, Need players, Check-in, Final price
  and the night-before text card. Hidden on this phone only (`pb_card_dismissed` and the existing
  `pb_text_tapped` in browser storage) until the situation changes (a different player, a new
  count, a new game). With storage blocked it hides for the visit.
- No X on anything that needs an answer or money: cash-out requests, unconfirmed I paid claims,
  Finalize, Who owes / Mark paid tonight, Payment reminder, court cards, cancel checklist.

### Fixed
- Players tab: the Edit button's tap area was 42 px tall; now 44 px (no visible change).
- Court switch: a write that lands on a game canceled in between answers "look again" (was
  "changed"). The old `/court` route (no screen uses it now) never writes to a canceled game.
- Edit game compares times to the minute: a game stored with seconds no longer "moves" on a Save
  with nothing changed (only test data has seconds; found by e2e/admin-cleanup.cjs failing at some
  times of day, also on main before this audit).

### Fresh auditors (did not write any fix)
- A (code reading): no money bug. Found: a finalized-then-reopened game asked again; two cards
  for one past game; same-day games looked alike; switch said "changed" after a cancel race; the
  old /court route unguarded; Pretend wiped dismissals. All fixed with tests.
- B (hostile browser, about 55 attacks on local copies: double taps, two phones, stale screens,
  dropped and delayed requests, midnight and the Nov 1 clock change, View as, Pretend): money held
  every time, no errors. Found three X problems: a double tap hid the next card too, Pretend changed
  the real dismissals, a moved game's night card stayed hidden. All fixed; B's script passes.
- Second pass. B: a slow double tap after "Yes, we played" could answer the next game's card or
  land on "Everyone played" (money) as cards moved under the finger: those buttons now ignore taps
  until about 1 s after the screen settles (`src/pages/admin/tapGuard.ts`), and focus goes to the
  Finalize card, never a money button. Also caught that "Book a court" had not been saved. A: Home
  now uses the same moving clock as Do this now; the focus after Yes stops if a sheet opens; the
  "court booked for the new time? No" answer refuses a game canceled in between. All fixed.
- Third pass: A clean. B clean on money (20 slow double taps, keyboard Enter/Space: nothing
  finalized). B found a failed Yes could not be retried for a second: the pause now starts only
  when it saved. The guarded buttons (Yes, Cancel game, Everyone played, Change who played,
  Cancel session, Finalize anyway) are dimmed while the screen settles, so a tap that waits is
  visible, not silent. All auditor scripts pass (66 checks).

### Tests
- New: `tests/admin-audit.test.ts` (court card, X, every admin route refuses strangers, forged and
  player cookies, unknown ids, sign-in and lockout, edit/cancel/players/settings edge cases),
  `e2e/admin-audit.cjs` (the two changes at 390 and 320 px, light and dark),
  `e2e/admin-sweep.cjs` (every tab at 320 and 390 px, light and dark: sideways scroll, 44 px
  taps, 4.5:1 text, tab bar; the gear menu at many scroll positions; the View as demo).
- Changed on purpose: the old checks that pressed Court opened / Didn't open (`e2e/run.cjs`,
  `e2e/admin-cleanup.cjs`) and the kept-words list in `tests/wording.test.ts` ("Mark it off").

### Not deployed
- Nothing from this audit is live and there is no preview link: this session's permission
  settings refused every Cloudflare deploy (even a preview). Main now sends previews to the
  throwaway `pickleball-preview` database (behind-the-scenes channel, 0cd3e80), so a preview
  is just `npm run build` then
  `npx wrangler pages deploy dist --project-name pickleball-club --branch preview-admin-audit`.
  A second throwaway database `pickleball-preview-admin` (fake data) was made before
  that landed; it is not needed and can be deleted (free, holds no real data).
- To ship after Alex's "ship it": merge this branch into main, pull the latest main, run the tests,
  take a Time Travel bookmark and SQL export, deploy from main (`npm run deploy`), read-only check.
  No migration. Before shipping, look read-only at the live list for games that will ask
  "Did you guys play?" at once (past 28 days, never booked, someone in, not finalized).

### Final test totals (merged with main e806c40)
- Unit: 1,288 passed in 75 files (1 helper skipped on purpose). Typecheck clean.
- Browser: 27 suites, 1,002 checks, 0 failed (run 229, credit 153, court 84, held 81, alerts 52,
  texts 52, admin-cleanup 35, suggest 35, popup 33, gates 32, live 26, round2 25, names 24,
  auto-credit 22, circles 18, do-now 13, card-times 13, money-visible 12, admin-audit 11,
  banner 11, no-court 10, cancel-reason 8, dryrun-screens 6, admin-sweep 6, want-in 4,
  double-tap 4, audit-stage3 3). Run one at a time: run.cjs fails in bulk when the machine is
  also running the unit tests.

### Alex's answers (Sun Nov 1, 2026, afternoon)
- 1, 2, 5: kept as built (the question starts at midnight after the game date; no X on money or
  decision cards; no question for empty games, and none after 28 days).
- 3: Telegram booking alerts now end "Then set it to Booked" (was "Then tap I booked it"; there is
  no such button any more). `tests/golden-wording.test.ts` proves this wording is the only change
  to every card and alert from Oct 14 to Nov 27 (old words put back give the old fingerprint);
  the fingerprints in `tests/fixtures/tick-golden.json` were updated. SMART_ALERTS.md updated.
  The task brain's hidden button labels were left as they were (never drawn).
- 4: Waitlist games follow the Not booked rule for "Court still needs to be booked": booking day,
  the morning of, or the next 2 games open to book; gone at the start. Tests: C1, C1b.

### Preview (Sun Nov 1, 2026, about 10:20 AM Eastern)
- https://preview-admin-audit.pickleball-club-9h0.pages.dev (deployment f0eae118), branch
  claude/new-session-kccop2 at 81952dd. Organizer PIN: see docs/PREVIEW_FAKE_DB.md.
- Database: the shared throwaway `pickleball-preview`, refilled with fresh fake games (backup file
  from a local seeded copy, via scripts/restore-backup.mjs). PROVEN not live: its
  /api/group/version differs from the live site's, the fake PIN signs in, and the dashboard reads
  "Pickleball Bros (PREVIEW, fake data)". So the `[env.preview]` wiring in wrangler.toml works for
  a fresh preview deploy. No Telegram or clock secrets on previews.
- Redeployed Sun Nov 1, about 11:05 AM Eastern: deployment 1f239094 (commit 230168f, with
  "Book a court" after a move and the next-2 rule). Same checks: version differs from live,
  the fake PIN signs in, group "Pickleball Bros (PREVIEW, fake data)".
- Fresh checker (did not write the code) on changes 3 and 4: clean; its two wording leftovers
  (the moved-game "Book on CourtReserve" link, README/DESIGN describing the old buttons) fixed.
- Totals at 230168f: unit 1,292 passed in 76 files (1 helper skipped); browser 27 suites,
  1,002 checks, 0 failed.

### Deploy (Sun Nov 1, 2026, 1:05 PM Eastern)
- Merged as #57 (main e48a69c), after merging main with the player screens audit (#58). Production
  deployment `30ff85a9`, branch main, commit e48a69c. No migration, no data change.
- Gate: unit 1,526 passed in 83 files (1 helper skipped); browser 29 suites, 1,094 checks, 0 failed.
  One player-channel fuzz test (tests/held-drop-fuzz.test.ts, seed 1631) failed once while the
  whole suite ran at full load; it passes alone (all 2,000 sequences, and seed 1631 three times).
  Left to that channel.
- Restore points: Time Travel bookmark
  `00000373-00000000-00005116-44ca4b7c774bb807e480ec143a2a6774` (1:05 PM, right before the deploy);
  SQL export `live-before-admin-audit-2026-11-01.sql` (221 rows, phone numbers, not committed) in
  this session's scratch folder.
- Code rollback: Pages deployment `e8f47388` (commit e38a399, the player screens audit). The deploy
  changed no data, so rolling the code back is enough.
- Read-only before: past games never booked with someone in and not finalized: none (Tue Oct 27 had
  nobody in and is before the first session date; Thu Oct 29 is canceled). So no "Did you guys
  play?" card shows on deploy.
- Read-only after: /, /admin, /api/status, /api/group/version 200; the live bundle has the new
  cards and no "Court opened"; scripts/integrity-checks.sql all 20 checks 0.
- Deleted on Alex's OK: the unused throwaway database `pickleball-preview-admin` (fake data only;
  no code, config, commit or deployment used it). Every other database, preview and branch kept.


### Visible changes shipped (Sun Nov 1, 2026, on Alex's "ship it")
Alex approved from before/after pictures (no preview: previews use the live database). Display only, no server,
money or database change:
- "Good news, a spot opened up" shows only the first time on that phone (`src/goodNews.ts`, browser storage).
- "Out for Tuesday?" (not "next Tuesday") two days ahead, the same words as the Want in card.
- Canceled cards are not see-through (4.5:1); "If you paid, it's now your credit." only for players who were in.
- The CREDIT word on the chip is readable in dark mode.
- The player screen's weeks start on Sunday (`weekTier`): on a Sunday, Tuesday's game is THIS WEEK. Organizer screens
  and the day words in texts keep their own rules.
Alex's other answers: a game that starts without Court booked keeps showing $14 due (he marks courts booked); no
"use your cash out" prompt on a waitlist move; Text the group stays organizer only (spec fixed: docs/PLAYER_SPEC.md).
Later cleanup batch (big text, a 29-letter name, one rare shared-phone case): docs/AUDIT_SCENARIOS_player.md.
- Deploy: PR #60 merged as 453a5a0; production deployment `071a533a`, Sun Nov 1, 2026, 2:00 PM Eastern. No database
  change. Rollback: Pages deployment `30ff85a9` (the admin audit deploy, commit e48a69c); the deploy changed no data.
- Restore points (2:00 PM): Time Travel bookmark `0000037f-00000000-00005116-bee68ff2c5b1e36d7e1b4c1c32bbc4cd`;
  SQL export `live-before-player-ship-2026-11-01.sql` (221 rows, has phone numbers, not committed) in this session's
  scratch folder.
- Tests on the deployed code: 1,535 unit (84 files); every browser file green, including good-news 9,
  audit-player-flows 93, audit-player-look 133 (+12 open, the later batch), admin-audit 11, admin-sweep 6.
- After deploy, read-only: new bundle served; /api/status, /api/group, /api/group/version, /admin 200; the 20-column
  health check (scripts/integrity-checks.sql) all 0; row counts (seats 17, credit entries 5, cash-out requests 0,
  players 10, games 8) match the export.

## "Time may shift" package (Sun Nov 1, 2026)

Started from main 5abaa38 (same code as the live deployment `071a533a`, plus a docs note). SPEC items 1 to 9.
No money rule or price change.

### What changed on screen
- Tilde on Waitlist games: the time under the tile reads "~7 PM" in the muted gray of "Court not booked"; Not
  booked games show a plain muted time; Booked games a bright bold time. Waitlist to Booked while the page is open:
  the tilde goes and the time pops once (transform and opacity, 420 ms; 100 ms fade with Reduce Motion).
- Date tile border shows the court (player and organizer cards): Booked solid bright (dark mode green #8BD9A3),
  Waitlist dashed, Not booked solid dim. Two border layers cross-fade; border-style never animates.
  Colors: light #18241d / #5f665d / #878e85, dark #8bd9a3 / #a3ab9f / #6b786f (all 3:1 or better on the card).
- "Time changed" notice at the top of the player Home (`src/timeShift.tsx`): clock icon, "Thu Nov 5 moved to
  7:30 PM", "Was 7:00 PM", then Still in and Can't make it at equal widths. Thin green outline on that game's card.
  Raised dark card in dark mode. Stays until answered (server data, so reloads and the 5-second refresh keep it);
  two at most, then "N more". Still in: "Confirmed" check, the bar folds away (about 220 ms). Can't make it: the
  game card's own drop question (its button says "Can't make it"), then the same 5-second Undo and credit banner.
  Offline or a failed call: the bar stays and the usual red banner shows.
- Organizer card: "Confirmed 2 of 3" (everyone in, the organizer counted as confirmed) and "Waiting on Dan" with a
  small Text button that opens Messages with "Thu Nov 5 is now 7:30 PM. Still in? Open the site and tap Still in."
  plus the site address. Edit game shows "Players who are in will be asked to confirm the new time." before Save
  when the start changes on a game with players in. Nothing is sent automatically.
- Dark mode raised cards on toasts, sheets (every pop-up) and the gear menu (`--raised`, `--raised-line`,
  `--raised-shadow` in `src/styles.css`). Light mode unchanged.
- Header: new logo (`public/logo.png`) on a rounded tile (light green-gray with a 2px #17231C outline; dark #17211D
  with a 2px #2E8B5E outline). `public/logo-xmas.png` is staged and unused. The logo was never a button (the sun
  button switches the theme), so it still is not.
- Credit in the header: plain text, a small green letterspaced CREDIT over the bold amount, between the sun button
  and the date tile, hidden at $0; the name shortens first.

### The rules (Alex's)
- A player who is in is asked when the start time changed after they agreed to one. Joining agrees to the time
  at that moment; Still in agrees to the current time. Every time they agreed to is kept, so a change back to any
  of them asks nothing; any other time asks again ("Was" shows the last time they said yes to).
- Never asked: the organizer, a dropped player, a real standby seat, a canceled, started or finalized game.
  A standby who moves in later is asked about the time they joined at.
- The organizer's In or To waitlist keeps a pending ask; the organizer adding someone new counts as confirmed.
- Changing only the end time asks nobody.

### Database
Migration `0016_time_confirmed.sql`: one new nullable column, `session_players.time_confirmed`
("<start agreed>[,<another>] <when>"). No rows are filled by the migration. Edit game fills it for the seats that
are in (with the old start) in the same batch that moves the game. Rollback of the column:
`ALTER TABLE session_players DROP COLUMN time_confirmed;` (old code ignores the column, so rolling back the code
alone is enough). The migration MUST go on before this code is deployed: without the column, I'm in on an existing
seat row and moving a game fail with an error (no money moves; proven in `tests/review-time-shift.test.ts`).

### Switches (changed on Alex's "ship it": the look goes live, the notice ships off)
- The court look (tile borders, "~7 PM"), logo tile, credit text and dark raised cards: always on.
- The moved-game notice, Still in, "Confirmed x of y" and the Edit game note (`server/timeShift.ts`) are on when
  the `TIME_SHIFT` var is not "off" (kill switch, needs a deploy) AND one of:
  - Settings > Schedule > "Moved-game notice for everyone" (off at ship; Alex turns it on Monday before 6 PM). Saved as
    one `task_log` row (kind 'mark', task 'time_shift_on', no game), so no schema change; a backup restore empties
    task_log, so check this switch after a restore.
  - The private test switch: open the site once with `?timeshift=on` on a phone (sends `X-Time-Shift: on`; that phone
    only; `?timeshift=off` ends it). Works on /admin too ("Confirmed x of y").
  - The View as demo (always on).
- While it is off, Edit game still records who agreed to which time, so turning it on asks exactly the players who
  were in before a move and have not answered.

### Fresh checks (helpers that did not write the code)
- Money paths: no path changes money, credit, payment or a seat. Found and fixed: the organizer's In / To waitlist
  cleared a pending ask; a change back to the time a player joined at asked again after a Still in (now every
  agreed time is kept). Accepted: deploying before migration 0016 breaks I'm in again and moving a game (the ship
  order puts the migration first; `tests/review-time-shift.test.ts` documents it). Accepted: a player who loaded the
  old time and taps I'm in a second after a move counts as confirmed for the new time (narrow race).
- Screens (320 and 390 px, light and dark): fixed the "You dropped out." banner after Can't make it (now "You're out."
  with the same money words), Reduce Motion (100 ms fades instead of a cut), gray buttons on dark sheets (thin
  outline), the Not booked border on the page background (now 3.5:1), and the Waiting on rows (one compact row of
  "Text Name" buttons when several are waiting).
- Already there before this package, left alone: the drop question's Go back and confirm buttons look alike inside
  the game list; Edit game's End time is clipped at 320 px; some old tap targets under 44 px (not you?, All games,
  calendar icon, I paid / Drop out links, + Add game, Book a court, paid pill, gear 44x34).

### Preview (Sun Nov 1, 2026, 4:18 PM Eastern)
- https://preview-time-shift.pickleball-club-9h0.pages.dev (deployment 79178936), branch claude/new-session-qrwtfr.
  Database: the fake `pickleball-preview` (group "Pickleball Bros (PREVIEW, fake data)"; PIN in docs/PREVIEW_FAKE_DB.md
  on its branch). Migration 0016 is NOT on the fake database (this session's permissions refused it), so test in View
  as demo only: real taps there that rejoin a game or move a game would fail. The demo copy builds its own tables.
- Demo walk (scripted, light and dark): View as, Pretend it's now, Edit game on Tue Nov 3 to 8:30 PM (note shows),
  Confirmed 1 of 5 with Text buttons, View as Indy, the notice, Still in folds it away; zero requests left the browser.

### To ship (after Alex's "ship it", before 8:00 PM, never Tue/Thu evening)
1. Merge this branch into main, pull main, run the unit tests.
2. Time Travel bookmark (`npx wrangler d1 time-travel info pickleball`) and SQL export
   (`npx wrangler d1 export pickleball --remote --output live-before-time-shift-2026-11-01.sql`, kept out of git).
3. `npx wrangler d1 migrations apply pickleball --remote` (only 0016 pending), then check the column exists and the
   integrity checks read 0.
4. `npm run deploy` from main. Read-only live check: /, /admin, /api/status, /api/group/version 200; row counts match.

### Tests (branch claude/new-session-qrwtfr, Sun Nov 1, 4:40 PM Eastern)
- Unit: 1,556 passed in 86 files (1 helper skipped). New: `tests/time-shift.test.ts` (who is asked, Still in,
  Can't make it, organizer numbers, TIME_SHIFT off, and 10 random 80-step sequences with credit, cash, drops,
  rejoins, a full game and the waitlist, checked against a model of the rules and the 20 integrity checks) and
  `tests/review-time-shift.test.ts` (the fresh reviewer's).
- Browser: 31 files, 1,246 checks, 0 failed (run 229, credit 153, audit-player-look 133 + 12 known open,
  audit-player-flows 93, court 84, held 81, alerts 52, texts 52, admin-cleanup 35, suggest 35, popup 33, gates 32,
  live 26, round2 25, names 24, auto-credit 22, circles 18, do-now 13, card-times 13, money-visible 12, admin-audit 11,
  banner 11, no-court 10, time-shift 9, good-news 9, dryrun-screens 6, admin-sweep 6, cancel-reason 8, want-in 4,
  double-tap 4, audit-stage3 3). Changed on purpose: admin-cleanup reads "~10:30 AM" as 10:30 AM; run.cjs reads the
  tile outline from the new border layer and measures card density without a moved game's Waiting on lines.

### Deploy (Sun Nov 1, 2026, 5:28 PM Eastern, on Alex's "ship it")
- PR #63 merged as dace600. Production deployment `d156b8e0`, branch main, commit dace600 (main equals live).
- Order: SQL export `live-before-time-shift-2026-11-01.sql` (223 rows, has phone numbers, not committed, in this
  session's scratch folder); Time Travel bookmark `000003a4-00000000-00005116-3f7fe3ae7f3b1a3c218090b771f58a86`
  (5:27 PM); migration 0016 applied (17 seats, column empty); then `npm run deploy` from main.
- Live: the court look, logo tile, plain credit text and dark raised cards for everyone. The moved-game notice is
  OFF for everyone (Settings > Schedule > "Moved-game notice for everyone"); Alex's phone test: pickleball.juncaj.net/?timeshift=on.
- Rollback: Pages deployment `071a533a` (commit 453a5a0) rolls back the code; the old code ignores the new column, so
  that is enough. To also drop the column: `npx wrangler d1 execute pickleball --remote --command "ALTER TABLE session_players DROP COLUMN time_confirmed; DELETE FROM d1_migrations WHERE name = '0016_time_confirmed.sql';"`
  (code rollback first). Whole database: `npx wrangler d1 time-travel restore pickleball --bookmark=000003a4-00000000-00005116-3f7fe3ae7f3b1a3c218090b771f58a86`.
- Read-only after: the backup address serves the new bundle; /, /admin, /api/status, /api/group/version, /logo.png,
  /logo-xmas.png 200; /api/group answers with timeShift false and no asks, and with the private header timeShift true;
  all 20 health checks 0; row counts (seats 17, credit entries 5, cash-out requests 0, players 10, games 8) match the
  export. pickleball.juncaj.net could not be reached from this session's network (same before the deploy).
- Tests on the deployed code: unit 1,557 passed in 86 files; browser run 229/229, time-shift 10/10, admin-sweep 6/6,
  every other browser file green at 7cc88a5's code (see Tests above).
- Fake preview database `pickleball-preview`: migration 0016 applied after the deploy (real taps on previews work again).


## Fake-data preview (Sun Nov 1, 2026, about 3:40 PM Eastern; config, scripts and docs only)

Previews now run on a practice database full of made-up players, so every tap on a preview is safe. How-to and undo: `docs/PREVIEW_FAKE_DB.md`.

### What was found (read-only)
- The Pages project's stored Preview settings already named `pickleball-preview` (database `6f94e087-...`), with the single variable `GO_LINKS`. Production names `pickleball` (`5c939453-...`) plus the real Telegram and clock secrets, and was left alone. `[env.preview]` in `wrangler.toml` says the same.
- Every existing preview deploy (`preview-admin-audit` 1f239094 and f0eae118, `preview-admin-look` 67b18991) is bound to `pickleball-preview`. None points at the live database. The earlier warning ("the stored preview setting still names the live database") was out of date.
- `pickleball-preview` held only made-up data, and its structure matched live exactly (all 34 tables, indexes and triggers identical, compared from a read-only export of the live structure; no live data read).
- The 5-minute clock calls only the live address and sends a password the preview does not have. A preview has no Telegram token.

### What changed
- `scripts/seed-preview.ts` and `scripts/seed-preview-world.ts`, new: `npm run db:seed:preview` wipes and refills the fake database (14 made-up players, games in every state, credit, a cash-out, a claim). `--dry-run` builds and checks without touching Cloudflare. The command refuses any database that is not `pickleball-preview` with the right id and a "PREVIEW, fake data" group.
- `tests/preview-seed.test.ts`, new (7 tests): the fake world passes all 20 live health checks, holds only 313-555-01xx phones, and covers every game and money state. It is not a screen test.
- `package.json`: the `db:seed:preview` script. `tsconfig.node.json`: the two script files added to the type check.
- No site code, screen, money rule, migration or production deploy changed. `wrangler.toml` was not changed.

### Proof (live counts read-only; test tap through a preview)
- Preview deploy 9a2aff78 (branch `preview-fake-db`, built from main 5abaa38): Cloudflare lists database `pickleball-preview` and only `GO_LINKS`. Test alert answered "Not connected"; the clock endpoint answered Not found with no password and with a wrong one.
- Live row counts before and after a test tap on that preview, all 16 tables: identical (`admin_audit_log=121, admin_sessions=3, credit_ledger=5, credits=0, d1_migrations=15, groups=1, login_attempts=1, organizer_alerts=1, player_devices=33, players=10, rate_events=4, refund_requests=0, session_action_tokens=0, session_players=17, sessions=8, task_log=2`).
- The test tap (a fake player, Kai, said "I'm in") appeared in `pickleball-preview` only (seats 35 to 36). Then the database was re-seeded.

### Notes
- NEVER delete, reset (except `npm run db:seed:preview`) or reuse `pickleball-preview` for anything else.
- Previews share ONE fake database, so two people testing at once see each other's taps. Re-seed when it gets messy.
- A new migration must be applied to the preview database too: `npx wrangler d1 migrations apply pickleball-preview --remote --env preview`.
- The flow in SITE_RULES ("test on the fake-data preview, then ship it") can now use real taps.


## Motion pass, player side (Sun Nov 1, 2026) - "Balanced" package, switch MOTION (OFF at ship)

Visual layer only. No schema change, no API or money change, no text change. Started from main 9800b74 (src identical to the
live deployment `d156b8e0`, commit dace600; main is ahead of live only by the docs, tests and fake-data seed script of #62).
Preview only: nothing here is on production until Alex says "ship it".

### The switch (follows GO_LINKS and TIME_SHIFT)
- `MOTION` var in `wrangler.toml`: production `"off"` (dark), `[env.preview.vars]` `"on"` (so the preview link shows it with no
  steps). `"on"` = everyone. Anything else = dark for everyone.
- Private on-switch for Alex's phone on the live site: open `pickleball.juncaj.net/?motion=on` once (remembered on that phone;
  `?motion=off` ends it). It sends `X-Motion: on`, so the server answers `motion: true` for that phone only
  (`server/motion.ts`, `shared/motion.ts`, one new boolean `motion` on `/api/group`). The organizer's View as demo always has it.
- The player screen sets `<html data-motion="on">` only while it is showing and the answer is yes. Every new CSS rule sits under that
  attribute (`src/motion.css`), and every new JS path checks `motionOn()`. The organizer screens never get the attribute, so
  nothing admin animates. Off = the site behaves exactly like before (a layout test compares every card, button, chip and tile
  position with the switch on and off at 320 and 390 px, light and dark).
- To turn it on for everyone: set `MOTION = "on"` in `wrangler.toml` and deploy, in a quiet window. To turn it all off again:
  `MOTION = "off"` and deploy. (`?motion=off` only ends the private test on a phone while it is still dark for everyone.)

### What moves (numbers are the spec's item numbers)
- One shared file `src/motion.css` (variables `--ease-out`, `--ease-spring`, `--t-tap` 120 ms, `--t-ui` 220 ms, `--t-enter` 240 ms) and a
  tiny `src/motion.tsx` (switch, number roll, the I'm in morph, pull to refresh). No animation library.
- 1 First load: skeleton shows only after 250 ms, slow sweep; cards cascade (rise 14 px, 45 ms apart) once per page open. The old
  "everything fades in whenever it is drawn" rule is off while the switch is on, so nothing replays on a refresh or a filter tap.
- 2 Press: cards sink 1.5 percent, buttons 95 percent, spring back.
- 3 I'm in: the button's width and colors ease into the chip (220 ms, width and background on that one chip only), the tile check pops and
  draws, the count rolls, only the new ball pops (1.3 then 1), no name flash for your own join, the credit chip slides in, Pay scales in.
- 4 Toast: white raised card in light, dark raised card in dark (the `--raised` tokens), green check circle, springs up in 240 ms, holds
  3 s, swipe down glides under the finger (dismisses past 36 px, glides back when let go early), sideways does nothing.
- 5 Others join live: the name flashes the mint accent (`--primary` at 35 percent) and fades in 0.8 s, count rolls, new ball pops.
- 6 Game on: 8 small balls pop out of the card once (400 ms) with the Game on toast. Never on page load (the first look at the page
  never bursts), once per game. The old ripple is off while the switch is on.
- 7 Pay to Paid: the chip eases from "$ due" to "Paid", the Paid chip pops, the old Pay button scales away.
- 8 Drop out: the Undo ring drains over exactly the 5-second window (ring length = the toast's own timer), the chip eases back to
  I'm in, the count rolls down, the CREDIT chip pops in and rolls at the same moment, Undo reverses all of it.
- 9, 10 CREDIT chip pops in, rolls, fades out at $0. Money and count numbers roll everywhere they change (chips, Pay card, credit
  sheet, buttons), never on first load. The rolling old number is drawn by CSS, so the page text stays the new number only.
- 11 Sheets and pop-ups: snap up 180 ms over a fading dim; tap outside or drag the top (grabber area) down closes in 150 ms; the cash-out
  prompt slides up and down the same way.
- 13 Field focus: mint border, label color follows. 14 Light/dark: colors fade 200 ms, the icon turns 180 degrees.
- 15 Pull to refresh (touch): at the very top, pull down, a spinning ball shows in the gap, the list shifts up to 34 px, past 64 px a
  release refreshes at once (`load.quiet`, the same call the 5-second poll uses; the poll is untouched) and the ball hides.
- 16 Empty screens: the ball bounces three times with a soft shadow, then rests.
- 17, 18 No page or tab slides. Everything but the cascade, rolls, burst, toast hold, ring and bounce is 120 to 240 ms.

### Skipped or changed from the spec
- 12 Details and expanders: the player screens have no expanders today (no arrow, no details panel), so there was nothing to animate. No
  panel content was touched.
- 19 CREDIT box: the time shift release already replaced the box with plain "CREDIT $14" text, so that text is what animates. The old box
  is gone.
- Sheet swipe-to-close works from the top (grabber and title) of the sheet, not from the body, so it can never fight the sheet's own
  scrolling or a text field.
- Pull to refresh could only be tested with simulated touches in Chromium here, not on a real iPhone. It only starts at the top of the
  page, never inside a sheet or on a field, and the switch is off for everyone first, so Alex tests it on his phone before it is on.
  If Safari fights it, leave the switch off for everyone (or switch it off again with `MOTION = "off"` and a deploy).
- The old "Pay" button scale-away is a short-lived copy of the button (decoration, no taps); the real button is gone at once.

### Fresh check
A helper that did not write the code reviewed the diff and ran it (switch off vs on at 320 and 390 px, light and dark; reduced
motion; replays; pull to refresh with simulated touches). Found and fixed: a sheet dragged shut stayed pushed down when reopened;
the Pay card's buttons and the CREDIT chip animated on first load; the pull's touchmove listener now exists only during a touch
that could be a pull, is off with Reduce Motion, and ignores touches that start on a toast; the Paid chip popped twice and an
unchanged Pay button re-popped on an amount change. Switch off: identical text, page height and element boxes, no `data-motion`.

### Tests (Sun Nov 1, 2026)
- Unit: 1,564 passed, 1 skipped (as before), in 87 files. New `tests/motion.test.ts` (7): the var, the private header, the demo,
  nothing else in the answer changes, I'm in saves the same with the switch on or off.
- Browser: every file run on its own, all green: run 229, names 24, gates 32, alerts 52, court 84, held 81, credit 153,
  suggest 35, popup 33, texts 52, circles 18, audit-stage3 3, cancel-reason 8, round2 25, want-in 4, double-tap 4,
  dryrun-screens 6, do-now 13, live 26, banner 11, card-times 13, no-court 10, auto-credit 22, money-visible 12,
  admin-cleanup 35, good-news 9, audit-player-flows 93, audit-player-look 133 (+12 known open), admin-audit 11, admin-sweep 6,
  time-shift 10, and the new `e2e/motion.cjs` 22 (switch off by default, private switch, cascade once and quiet after a refresh,
  I'm in, Pay to Paid, toast look and swipe, Undo ring 5 s, Drop out, CREDIT chip, field focus, others join live, sheets,
  theme button, empty bounce, pull to refresh, Reduce Motion, skeleton delay, and a geometry check that every card, button and
  chip sits in the same place with the switch on and off at 320 and 390 px, light and dark). `run.cjs` once failed on a random id
  that happened to contain "4837" in the page source (an old known kind of fluke) and passed on the rerun. No test was changed.
  `package.json` `test:e2e` now ends with `node e2e/motion.cjs`.

### Deploys (Sun Nov 1, 2026, on Alex's "ship it")
- 7:54 PM Eastern: PR #65 merged as 0afc87f, production deployment `f98dbbc1` from main with `MOTION = "off"` (dark for everyone).
  Before it: SQL export `live-before-motion-2026-11-01.sql` (not committed, has phone numbers, in that session's scratch folder) and
  Time Travel bookmark `000003c3-00000000-00005117-c7edd73afa2214c5a8cb67d4adad19a5`. Alex tested with `?motion=on` and approved.
- Second deploy, `MOTION = "on"` for everyone (one line in `wrangler.toml`, no code change, no data change). Before it: SQL export
  `live-before-motion-on-2026-11-01.sql` and Time Travel bookmark `000003c7-00000004-00005117-3485c6a035127765e47a38ffa1af1df5`.
  Chosen over a Settings switch so no new admin or server code went to production the same night.
- Rollback: Pages deployment `f98dbbc1` (motion off, same code) is the quickest; `d156b8e0` (commit dace600) is before the motion
  code. No data changed in either deploy, so no restore is needed.


## Motion pass, organizer side (Sun Nov 1, 2026, night) - "Balanced" package, switch MOTION_ADMIN (OFF at ship)

Visual layer only. No schema change, no API or money change, no text change. Started from main `ce26ca8` (src identical to the
live deployment `ab7da657`; checked with the Cloudflare deployments list before any work). The player motion shipped first and the
time shift release is live (`TIME_SHIFT = "on"`), so this reuses `src/motion.css` and `src/motion.tsx` (no second file).
Preview only: nothing here is on production until Alex says "ship it".

### The switch (a separate one, on purpose)
- `MOTION_ADMIN` var in `wrangler.toml`: production `"off"` (dark), `[env.preview.vars]` `"on"`. Why not reuse `MOTION`: the player
  `MOTION` is already `"on"` for everyone (switched on Sun Nov 1), so reusing it would have turned the organizer motion live the moment
  this deployed, which is the opposite of "ship dark first".
- Private on-switch for Alex's phone on the live site: open `pickleball.juncaj.net/admin?motionadmin=on` once (remembered on that
  phone; `?motionadmin=off` ends it). It sends `X-Motion-Admin: on`, and `/api/admin/dashboard` answers `motion: true` for that phone only
  (`server/motion.ts` `motionAdminFor`, one new boolean on the dashboard answer). `?motion=on` (the player switch) does NOT turn it on.
- The dashboard sets `<html data-motion="on" data-motion-admin="on">` only while it is showing and the answer is yes (`useAdminMotion`
  in `src/motion.tsx`). The shared pieces (sheets, toast, press, field focus, rolls, name flash, ball pop) already sit under
  `data-motion`, so they just work here; everything new sits under `html[data-motion='on'][data-motion-admin]` or in a component
  that only renders with the motion on. Off = the site behaves exactly like before (a layout test compares every card, button,
  switch and tab with the switch on and off at 320 and 390 px, light and dark).
- To turn it on for everyone: set `MOTION_ADMIN = "on"` in `wrangler.toml` and deploy, in a quiet window. To turn it all off again:
  `MOTION_ADMIN = "off"` and deploy.

### What moves (numbers are the spec's item numbers)
- 1 Loading: a bouncing pickleball with holes and a small shadow, drawn only after 250 ms (a timer in `LoadingBall`, so it holds with
  Reduce Motion too); the plain spinner when the switch is off. Cards then cascade in once per page open (rise 14 px, 45 ms apart).
  The site's old "cards fade in whenever drawn" rule is off while the switch is on, so nothing replays when the cascade ends or on a tab change.
- 2 Press: organizer cards sink 1.5 percent (not when a button or link inside is pressed), buttons 95 percent, gear and pill buttons 95 percent.
- 3 Live changes (5-second refresh): the joined name flashes the mint accent (35 percent, 1 s), the count rolls, only the new circle
  pops, the card blinks a light green (overlay fading over 0.8 s). A payment flashes the "x of y paid" pill and rolls its number.
  Never on first load, never while a sheet or the gear menu is open, never moves the page.
- 4 Gear pop-up: snaps open from its corner in 140 ms (tiny spring), closes with a 90 ms fade. It still never scrolls or moves the page.
- 5 Sheets (all of them, one shared component): snap up in 180 ms over a dim, close in 150 ms, tap outside or swipe the top down closes.
- 6 Field focus: mint border, label color follows (shared rule).
- 7 Save (Edit game): spinning ball while saving, then a green "Saved" with a check that pops (360 ms), then the toast "Game saved"
  comes up, then the sheet goes. A failed save never shows green and shows the existing error. The save itself is never held back:
  only the closing waits. The time on the card fades quickly when it changes.
- 8 Court switch: the highlight glides between the options (150 ms, transform only) and the card edge color fades (150 ms).
  "Not booked" stays on two lines and the three segments keep their height.
- 9 Toggles: the knob stretches as it slides and settles (150 ms, uses the separate `scale` property so the slide itself is untouched).
- 10 Bottom tab bar: the highlight glides to the tapped tab (200 ms, transform only).
- 11 Screen and tab changes: instant, nothing slides.
- 12, 13 Money numbers (Collected, Court costs, Credits owed, Held, Membership, the big number, per-person Owes, Credit, held and credit
  chips, the Money tab session labels) and the "N of 4 in" and "x of y paid" counts roll when they change, never on first load, and never
  when moving to another month.
- 14 Expanders (`<details>`): open and close ease with opacity and a 4 px rise (170 ms open, 120 ms close).
- 15 Toasts: the shared raised card (white in light, dark raised card in dark), above the tab bar.
- 16 Speed rule: every UI move is 120 to 200 ms; only the loading ball, the cascade and the rolls are longer.

### Skipped or changed from the spec
- A real time change still opens the existing "Moved" text step after Save (the sheet changes content instead of sliding away). A
  status-only save slides the sheet away as in the spec.
- 3: a payment flashes the "x of y paid" pill, not a name, because the organizer cards do not show payment next to names. A drop
  rolls the count and blinks the card (there is no name left to flash).
- The tab bar glide is 200 ms (the spec says 220 ms and also "120 to 200 ms"; the speed rule won).
- Reduce Motion: the dim behind a sheet used to keep fading because the global reduce rule cannot reach that pseudo-element; it is now
  off with Reduce Motion on the organizer screens only (the player screens are untouched; the reviewer caught a first version that leaked there).
- Pull to refresh stays player only. The organizer page keeps the browser's own pull-down.

### Fresh check
A helper that did not write the code reviewed the diff and ran it (switch off vs main on 8 size and theme combinations: identical DOM,
text, boxes and 18 computed properties; switch on at 320 and 390 px, light and dark; Reduce Motion; rapid taps; View as). No blockers.
Found and fixed: the Reduce Motion backdrop rule also reached player sheets (now organizer only); closing the Edit sheet during the
360 ms "Saved" skipped the "Moved" follow-up step (it now always follows, like with the motion off); a quick double tap on an expander
ended closed instead of open (now matches the old result). Left as is: the paid pill text is now one text node (0.03 px wider with the
switch off, text identical); the court switch text color changes at once while the highlight glides (under 150 ms); the Dashboard now
writes `pb_motion_admin_seen` in localStorage.

### Tests (Sun Nov 1, 2026)
- Unit: 1,578 passed, 1 skipped, in 89 files (was 1,571 in 88; new `tests/motion-admin.test.ts`, 7: the var, dark by default, the player
  MOTION does not switch it on, the private header, nothing else in the dashboard answer changes, a court change saves the same).
- Browser, every file on its own, all green at the same counts as before: run 229, names 24, gates 32, alerts 52, court 84, held 81,
  credit 153, suggest 35, popup 33, texts 52, circles 18, audit-stage3 3, cancel-reason 8, round2 25, want-in 4, double-tap 4,
  dryrun-screens 6, do-now 13, live 26, banner 11, card-times 13, no-court 10, auto-credit 22, money-visible 12, admin-cleanup 35,
  good-news 9, audit-player-flows 93, audit-player-look 133 (+12 known open), admin-audit 11, admin-sweep 6, time-shift 10, motion 22,
  and the new `e2e/admin-motion.cjs` 28. No existing test was changed. `package.json` `test:e2e` now ends with `node e2e/admin-motion.cjs`.

### Preview (Sun Nov 1, 2026)
- Branch `claude/new-session-ftr39p`, Pages preview alias `https://preview-motion-admin.pickleball-club-9h0.pages.dev` (fake database
  `pickleball-preview`, MOTION_ADMIN on in the preview vars; `/admin?motionadmin=on` also works on any address). Not on production.
- Ship plan (after "ship it"): back up and Time Travel bookmark first, merge to main, deploy from main with `MOTION_ADMIN = "off"`, Alex
  tests with `/admin?motionadmin=on`, then one line (`MOTION_ADMIN = "on"`) and a deploy in a quiet window.

### Deploys (Sun Nov 1, 2026, on Alex's "ship it")
- About 10:05 PM Eastern: PR #67 merged as 735af6c, production deployment `60c9ed3d` from main with `MOTION_ADMIN = "off"` (dark for everyone).
  Before it: SQL export `live-before-motion-admin-2026-11-01.sql` (not committed, has phone numbers, in that session's scratch folder) and
  Time Travel bookmark `000003e0-00000000-00005117-c23b95dd474c5b5c0c6a303660701faa`. Health checks 20 of 20 at 0 before and after.
  Alex tested with `/admin?motionadmin=on` on his phone and approved.
- About 10:09 PM Eastern: PR #68 merged as 199170c, production deployment `6153a25f` from main with `MOTION_ADMIN = "on"` for everyone (one line in
  `wrangler.toml`, plus the new `docs/FEATURE_SWITCHES.md`; no code or data change). Before it: SQL export `live-before-motion-admin-on-2026-11-01.sql`
  and the same Time Travel bookmark (nothing had been written in between). Health checks 20 of 20 at 0 after.
- Rollback: `MOTION_ADMIN = "off"` and a deploy; or Pages deployment `60c9ed3d` (organizer motion off, same code); or `ab7da657` (commit ce26ca8,
  before any organizer motion code). No data changed in any of these deploys, so no restore is needed.
- The old `e2e/live-check.cjs` line "setup code is configured" fails on the live site because setup is finished (`setupEnabled` is false); it is
  an old check from before setup and not related to motion.

## Always ask for payment (PAY_ALWAYS), Mon Nov 2, 2026 - LIVE with the switch OFF for everyone

Spec: PAY_SPEC (approved by Alex Sun Nov 1). Started from main ce26ca8, merged with main 4fb55a7 (organizer motion, live as
deployment 6153a25f). Scenario list: `docs/AUDIT_SCENARIOS_payalways.md`.

### What was found first (read-only, before any code)
- The server never cared about the court for money. What a player owes, credit at I'm in (`autoCreditStatements`), the money
  back on a drop (`withdraw`), on an organizer cancel and on a Waitlist court's "Didn't open" (`cancelWithMoney`), Mark paid,
  I paid, Finalize and the organizer's numbers ("x of y paid", Players, Money held) all work the same on Booked, Waitlist and
  Not booked. A standby seat (no real spot) owes nothing (`owes` needs status confirmed in `server/views.ts`).
- Pay was hidden only on the player screen, in `src/courtDisplay.ts` (zeroes what is owed on a game with no court, and drops
  it from the game-day Pay card).
- No game ever cancels by itself. A never-booked game, or one under 4, stays on until Alex taps Cancel ("Did you guys play?"
  > Cancel game, the gear menu, or "Didn't open"). Money comes back as credit at that tap, never before. PAY_SPEC item 4 says
  to stop and ask: question 1 in the scenario list. That is why this is on the preview only.
- Already true before this change (switch off): once a never-booked game has ended, it is no longer on the schedule, so the
  hiding no longer covered it and the game-day Pay card already listed it (`tests/pay-always.test.ts` E15).

### What changed
- `src/courtDisplay.ts`: with `payAlways` on, a game with no court keeps "$14 due", Pay, I paid, part credit and its place on
  the game-day Pay card, exactly as on a booked game. The court words, counts, seats and "never says waitlist" stay.
- I'm in / Game on! banners say "$3 credit used, $11 due." wherever the card shows "$ due" (`joinedText`, `joinToast`).
- The switch, copied from the moved-game notice: `PAY_ALWAYS` var (kill switch, "on" = allowed), Settings > Money > "Ask for
  payment on every game" (one `task_log` row, task `pay_always_on`, no schema change; a backup restore empties task_log, so
  check this switch after a restore), the private test link `?payalways=on` (header `X-Pay-Always: on`, that phone only,
  `?payalways=off` ends it), and the View as demo (always on). New `payAlways` on `/api/group`, `payAlwaysForAll` on the
  dashboard, `PUT /api/admin/pay-always`, Activity log `pay_always_on` / `pay_always_off`. The player change stamp includes the
  switch, so open phones pick it up within 5 seconds.
- Not changed: price, credit-back math, Venmo link, any server money path, any organizer screen except the one new Settings row.

### Tests
- New `tests/pay-always.test.ts` (67): the switch, every court x credit (none, $3, $14, $20) x switch, events (drop after cash,
  after part credit, unconfirmed I paid, organizer cancel, "Didn't open", court booked later, changed back, standby promoted,
  Undo, organizer, nothing paid), organizer money screens, and a 40-step random script giving identical books with the
  switch off, on by test link and on by Settings.
- New `e2e/pay-always.cjs` (12 checks): off at ship, test link on one phone only, remembered and ended, I paid, game-day Pay
  card, 360 px light and dark, the Settings switch from the organizer screen, a page left open picking it up.

### Fresh checks (helpers that did not write the code)
- Code reader: no money bug. Confirmed every server money path ignores the court (joins, credit at I'm in, standby promotion,
  drops, late drops, organizer cancel, "Didn't open", I paid, Mark paid / Unmark, Finalize, Money and "x of y paid"). Fixed from
  its list: the "Want in?" card got the raw data, so on a game with no court its banner and answer card could say "$11 due" while
  the card hid it (older bug, now uses the same court view as the game cards; checked on the preview both ways); weak tests
  (Money row for a canceled game now required; the random script checks its taps and covers I paid claims). Left as they were
  (older, and they agree with the screen once the switch is on): with the switch off, a no-court game shows Pay once it has
  started or ended; the organizer's "Remind all unpaid" text and Home owed cards count seats on every court; the Settings row does
  not grey out when the kill switch is "off"; View as always shows it.
- Preview attacker (real taps, 360 and 393 px, light and dark): every money case worked to the spec (part, exact and extra credit;
  Undo; I paid and Didn't pay?; drop after paying; organizer cancel with a reason; "Didn't open"; real standby on a full Not booked
  game moving in with credit applied; court switched back and forth; two phones as one player; offline taps; the Settings switch
  reaching an open phone in under 5 seconds; books add up). One real bug, the "Want in?" answer card above (fixed). Older nits it
  noted, not changed: the Waitlist cancel dialog says "This does not cancel your court"; the Money tab shows "Court due" for a game
  with no court; "Didn't open" is only on the API now (the court switch has no button for it); small text links (I paid, Drop out).

### Preview (Sun Nov 1, 2026, about 11:00 PM Eastern)
- https://preview-pay-always.pickleball-club-9h0.pages.dev (deployment fd180065), branch claude/new-session-ejzdck merged with main
  4fb55a7. Fake database `pickleball-preview`, re-seeded after the tests. The Settings switch there is off: use `?payalways=on`,
  or flip Settings > Money > "Ask for payment on every game" on the preview's /admin.
- Not on production. Nothing was deployed to the live site, no live data was read or changed.

### To ship (after Alex answers the two questions and says "ship it"; quiet window: before Mon 6:00 PM, else Wed 6:00 AM)
1. Merge this branch into main (PR), pull main, `npm test`, confirm main equals live plus this change.
2. SQL export (`npx wrangler d1 export pickleball --remote --output live-before-pay-always-2026-11-02.sql`, kept out of git) and a
   Time Travel bookmark (`npx wrangler d1 time-travel info pickleball`).
3. `npm run deploy` from main. No migration. Ships OFF (Settings switch off).
4. Read-only live check: /, /admin, /api/status, /api/group/version 200; `/api/group` answers `payAlways: false`, and `true` with
   the header `X-Pay-Always: on`; the 20 health checks 0; row counts match the export.
5. Alex tests on his phone with pickleball.juncaj.net/?payalways=on, then flips Settings > Money > "Ask for payment on every game"
   in a quiet window (no deploy).
- Rollback: Settings switch off (instant, no deploy). Code: Pages deployment 6153a25f (commit 199170c, before this change); the
  Settings row is one task_log row the old code ignores, so no data restore is needed.

### Alex's answers and "ship it" (Sun Nov 1, 2026, about 11:10 PM Eastern)
- "Ship it" after testing the preview on his phone. Deploy with the switch OFF; Alex tests on live with the private link and
  switches it on himself. Taken as: Q1 keep canceling never-booked or short games by hand (no auto-cancel built); Q2 keep the
  Oct 31 rule (an unconfirmed I paid waits for Paid / Didn't pay).
- Pre-deploy fresh reviewer (did not write the code): SHIP. One finding fixed before the deploy: giving the "Want in?" card the
  court view had dropped the "You'd be on the waitlist" warning for a game with no court that is really full; restored (73d3f08).

### Deploy (Mon Nov 2, 2026, 12:01 AM Eastern)
- PR #70 merged as ea2ff2f (same tree as the tested 73d3f08). Production deployment `a756dbe2`, branch main, commit ea2ff2f.
- Before it: read-only live check (20 health checks 0, no `pay_always_on` row); SQL export `live-before-pay-always-2026-11-02.sql`
  (239 rows, has phone numbers, not committed, in this session's scratch folder); Time Travel bookmark
  `000003f9-00000000-00005117-eedc9cd132061bbc7b55ad632fc4e1ba` (12:01 AM). No migration.
- After it (read-only): the backup address serves the new bundle; /, /admin, /api/status, /api/group/version 200; `/api/group`
  answers `payAlways: false`, and `true` only with the header `X-Pay-Always: on`; all 20 health checks 0; row counts identical to
  before (admin_audit_log 131, credit_ledger 5, d1_migrations 16, player_devices 35, players 10, session_players 20, sessions 8,
  task_log 3, the rest unchanged); no `pay_always_on` row (off for everyone). pickleball.juncaj.net could not be reached from this
  session's network (same as earlier deploys); it serves the same Pages project.
- Switch it on for everyone: /admin > Settings > Money > "Ask for payment on every game" (no deploy). Private test on a phone:
  pickleball.juncaj.net/?payalways=on (that phone only; ?payalways=off ends it).
- Rollback: Settings switch off (instant). Code: Pages deployment `6153a25f` (commit 199170c); the old code ignores the task_log
  row, so no data restore is needed. Whole database: `npx wrangler d1 time-travel restore pickleball --bookmark=000003f9-00000000-00005117-eedc9cd132061bbc7b55ad632fc4e1ba`.

### Tests on the deployed code (73d3f08 = ea2ff2f)
- Typecheck clean. Unit: 1,645 passed, 1 skipped, 0 failed, in 90 files.
- Browser: all 34 files run one by one: 33 green (run 229, credit 153, audit-player-look 133 + 12 known open, audit-player-flows 93,
  court 84, held 81, alerts 52, texts 52, admin-cleanup 35, suggest 35, popup 33, gates 32, admin-motion 28, live 26, names 24,
  auto-credit 22, motion 22, circles 18, do-now 13, card-times 13, pay-always 12, money-visible 12, admin-audit 11, banner 11,
  no-court 10, time-shift 10, good-news 9, cancel-reason 8, dryrun-screens 6, admin-sweep 6, want-in 4, double-tap 4,
  audit-stage3 3). round2: 24 of 25; one check ("banner timings ... reduce motion fades only") fails about 2 runs in 3 on this
  code AND on the live code before this change (199170c, checked in a separate copy): an older flaky check, not caused here.

## Admin screens v2 (ADMIN_V2), Mon Nov 2, 2026 - on a PREVIEW, not on the live site

Spec: ADMIN_SPEC (Alex, Nov 2) items 1 to 4, plus item 5 (Label on Edit game) and item 6 (Remove a canceled game from the player
screen) added the same day. Scenario list: `docs/AUDIT_SCENARIOS_adminv2.md`. Started from main e740244 (pay-always already live).

### What changed
- One switch, `ADMIN_V2` (ships OFF): Settings > Feature switches > "New admin layout" (no deploy), private link `/admin?adminv2=on|off`,
  `ADMIN_V2` var in wrangler.toml as the kill switch. "On for everyone" is one `task_log` row (`admin_v2_on`), like PAY_ALWAYS.
- History: Activity first, then Sessions (no All). Activity splits into "New since <last visit> · N" and "Viewed". The last visit is kept in
  this browser (`pb_history_seen`), written when the tab is left or the site is closed or put away, never while staying; it is the server
  time the list was asked for, so things that happen while the tab stays open are still new next time. First visit: no NEW group.
- Money: one control row (month stepper, Who paid | Totals), always opens on Who paid. Games are lines: next game open, others closed, any
  number open. Rows are name + second line, fixed chip, fixed gray button, in the same three columns (stack on 320 px or big text). Tap a
  row for the whole line and any second action. "Remind N" lists the unpaid players, each with their own Text link (one number, today's
  reminder). Totals: same numbers and math, two-column grid, one screen. Held now always shows. Same payload on every Mark paid / Unmark.
- Home: top 2 games are today's full card, later ones short rows (tile, count and time, names, label, court pill, In, chevron). Tap a tile
  or empty space to open or fold; nothing is remembered. "Court still needs to be booked" and Book a court now sit on the game's own card
  (and on its short row); the separate alert card is gone. Games that need a court are never hidden behind "Show all".
- Motion fix (MOTION_ADMIN, not ADMIN_V2): nothing rises in on load; the player's placeholder cards shimmer after 250 ms while loading.
- Item 5: a Label field on Edit game (new layout only), prefilled, saved with Save. It is the game's existing `note` column
  (`PUT /api/admin/sessions/:id/note`, 80 characters, logged). The "Extra game" tag is untouched.
- Item 6: "Remove from player screen" / "Show on player screen again" in the gear menu of a CANCELED game (new layout only). It only hides.
  Stored as one row per game in the existing `task_log` table (`hidden_from_players`): no new column, no migration. Players no longer get the
  game in their schedule; credit history rows keep their text; the organizer still sees it on Home (tagged), History > Sessions and Money.
  Reopening clears it. `ADMIN_V2 = "off"` puts every hidden game back. A backup restore empties task_log, so hidden games would show again.

### Database
No change. Item 5 reuses `sessions.note`; item 6 and the switch reuse `task_log`.

### Fresh reviewer (did not write the code) and what was fixed
Found and fixed: re-tapping the History tab wiped NEW; History marked events "seen" that were never shown; tapping blank card space to close
the gear pop-up also folded the card (and the court switch's padding folded it); keyboard focus was lost when a game opened or folded;
a game needing a court could hide behind "Show all"; the folded row dropped the label and the Book a court button; the paid line lost the
amount; two screen-reader toggles per Money game. Left as is (by spec or choice): the folded row does not show the paid pill, late-drop
line, "Still in" check or short-on-players panel (open the row to see them); the month stepper only drives Totals.

### Tests
- Unit: 1,667 passed, 1 skipped, in 91 files (was 1,645 in 90): new `tests/admin-v2.test.ts` (22: the switch, Label, hide/show, money
  unchanged, kill switch, reopen, no migration touched).
- Browser: new `e2e/admin-v2.cjs` (25 checks) and `e2e/admin-motion.cjs` (28; two checks rewritten: no ball, no rise). With the switch off
  these still pass: do-now 13, admin-sweep 6, money-visible 12, court 84, held 81, good-news 9, live 26, banner 11, card-times 13,
  no-court 10, pay-always 12, suggest 35, admin-audit 11 (failed once, then passed twice), time-shift 10. `admin-cleanup` 33 of 35: the same two
  checks fail on untouched main (the "2 of 3 paid" tap area and the red cancel-by line), so they are older and not part of this change.
- Older, not changed: at 200% text on a 320 px phone, the "+ Add game" and "Book a court" pills, the organizer's own I'm in and the tab bar
  already run past the screen with the switch off.

### Preview
Pages preview alias `https://preview-admin-v2.pickleball-club-9h0.pages.dev`, branch `claude/new-session-x26a53`, fake database
`pickleball-preview` (re-seeded just before). Use `/admin?adminv2=on` once on a phone. Not on production.

### To ship (after "ship it"; admin-only, any time outside game night)
1. Merge to main, pull, `npm test`, confirm main equals live plus this change. 2. SQL export and Time Travel bookmark. 3. `npm run deploy`
from main (no migration; ships OFF). 4. Read-only live check. 5. Alex tests with `/admin?adminv2=on`, then switches it on in Settings.
Rollback: Settings switch off (no deploy); `ADMIN_V2 = "off"` and a deploy for everyone; previous Pages deployment for the code. No data restore needed.

### Look pass to match the approved mockups (Mon Nov 2, 2026, after Alex tested the first preview)
Target: `mockups/2_money.png` and `3_home.png`; each screen was rendered at 390 px, light and dark, and compared next to the mockup.
- Home folded rows: date tile on the left (44 px, centered), bold "3 of 4 in · 8 PM" and one names line (or "Booking opens ..."), then the court pill, "In" and a chevron in fixed columns. Every row is 3.4rem tall, the same width and edge as the full cards, two lines at most, each cut off with an ellipsis. No button and no court sentence in a folded row; "Court still needs to be booked" and Book a court are only on the opened card.
- Money: one control bar (month left, Who paid | Totals right). Chips are one line, one width, and only say Paid, Unpaid or Due (Court row: Due or Paid); the detail ("owes $11 · $3 credit used", "paid with credit $14", "self-marked") is the small line under the name, cut off with an ellipsis, whole line on tap. Name, chip and button columns line up on every row and under a closed game's chip and chevron. Game header: "Tue, Nov 3" with "2 of 4 paid · $14 each" under it and Remind N on the right; the separate "Each player pays" line is gone (a note shows only when it carries news: credit back, or not finalized yet).
- History: the divider labels always show. First visit: "VIEWED" above the list, no NEW group. With new items: "New since <time> · N", then "VIEWED".
- Tests: `e2e/admin-v2.cjs` is 27 checks now (adds: same-height folded rows in light and dark, chips, header text, court message only on the opened card, VIEWED on first visit).
- Not changed: 320 px and 200 percent text. `e2e/admin-motion.cjs` check "2. press" fails the same way on untouched main today (checked in a clean copy), so it is older and not part of this change.

### Deploy (Mon Nov 2, 2026, about 9:00 AM Eastern, a quiet window) - LIVE with ADMIN_V2 OFF for everyone
- PR #72 merged as ebb375a (same tree as the tested 740e4a9). Production deployment `c0d807e3-2261-4bdd-a74f-5f6f155ebdb7`, branch main.
  Live was a756dbe2 (ea2ff2f) before; main had nothing newer than notes. No migration.
- Before it: read-only live check (20 health columns all 0, no `admin_v2_on` row, no hidden games); SQL export `live-before-admin-v2-2026-11-02.sql`
  (251 INSERTs, has phone numbers, not committed, in the session scratch folder); Time Travel bookmark `00000465-00000000-00005117-c515609d17299a3bee7514f6d97234c9` (8:50 AM).
- After it (read-only): the backup address serves the new bundle; /, /admin, /api/status, /api/group/version 200; organizer data answers 401 without a sign-in;
  all 20 health columns 0; row counts identical to before (audit 139, credit_ledger 5, players 10, session_players 21, sessions 9, task_log 5, refund_requests 0,
  migrations 16, credit total $70); no `admin_v2_on` row (off for everyone). pickleball.juncaj.net could not be reached from this session's network (as on earlier deploys).
- Alex tests with pickleball.juncaj.net/admin?adminv2=on (that phone only; `?adminv2=off` ends it), then switches it on for everyone in
  Settings > Feature switches > "New admin layout" (no deploy). He switches it on himself.
- Turn it off: Settings > Feature switches > New admin layout (no deploy). Everyone incl. test links: `ADMIN_V2 = "off"` in wrangler.toml and a deploy.
- Rollback: Settings switch off (instant). Code: Pages deployment `a756dbe2-44da-4eac-96ca-a5e747a0e890` (commit ea2ff2f, before this change). New code only writes
  `sessions.note` (Label) and `task_log` rows (the switch, a hidden canceled game), which the old code ignores, so no data restore is needed. Whole database:
  `npx wrangler d1 time-travel restore pickleball --bookmark=00000465-00000000-00005117-c515609d17299a3bee7514f6d97234c9`.
- Fresh pre-deploy reviewer (did not write the code): SHIP, no blockers. Noted and left: turning the layout off in Settings does not un-hide a game you removed from the
  player screen (use Show again first, or reopen the game; `ADMIN_V2 = "off"` restores everything); the Settings row still shows if the kill switch is off.
- Tests on the deployed code (ebb375a = 740e4a9): typecheck clean; unit 1,667 passed, 1 skipped (one run hit a 5-second timeout in `golden-wording` while the machine
  was busy; it passes alone in 3 seconds); browser `admin-v2` 27 of 27.
## Layout polish (Mon Nov 2, 2026) - on a preview, waiting for "ship it"

Spec: `POLISH_SPEC` (layout robustness, no redesign, no new money rules, no database change). Started from main e740244.
Nothing here is deployed to the live site. New switches: none (see "Why no switch" below).

### What was fixed (plain words)
- **Very big phone text (150% and 200%).** The checks run at 320 and 390 px wide, light and dark, on the player and the
  organizer screens. Fixed: the header (name, credit, sun button, date square), the date tiles, the cards, the LATER rows,
  the "THIS WEEK ... All games" line, the "time changed" bar (Still in and Can't make it stay equal width, they wrap and
  stack instead of overlapping), the organizer cards (court switch, "Confirmed x of y" and the Text buttons, holiday tags,
  "+ Add game" and "Book a court"), the tab bar, the Players list, Money's month picker, History's chips, Settings rows,
  sheets, the gear menu, the name list ("Who are you?") and the banners.
- **Long names** (29 letters, 28 letters with no spaces, emoji, accents): in the header the name ends in "..." on one line and
  gives way first; the sun button, the credit and the date square keep their size. A name with no spaces breaks inside cards
  and lists (it has nowhere else to go); names with spaces wrap between words and are never broken in the middle.
- **Credit text in the header** (label above the amount, right-aligned, hidden at $0): checked with the 29-letter name,
  $140, and 200% text.
- **Shared phone (a real bug, fixed).** After picking a different name the page kept showing the OLD name's credit and cards
  until the new data arrived (about a second on a slow phone), and a tap in that gap acted as the NEW name. The name list now
  stays up until the new name's own data is there (`onPicked` in `src/pages/PlayerHome.tsx`). A test slows the load down by
  1.5 s and watches the screen every 0.1 s; it fails on the old code (it saw "$140" under another name) and passes now.
- **Short screens (landscape) and the keyboard.** Sheets and dialogs fit and scroll to their last button at 320x260 and
  568x320. With an iPhone keyboard open the page itself is not shrunk, so a sheet at the bottom ended up under the keyboard
  with its Save button hidden. `src/keyboard.ts` now tells the page how tall the keyboard is (only while one covers it), and
  a sheet sits above it and scrolls inside what is left. Android phones that shrink the page themselves are unaffected.
- **Pay button fallback (item 8).** Some players have no Venmo app and see "invalid address" when they tap Pay. The Pay
  button and its link are exactly as before. After a tap, if the page was NOT hidden or left within 2 seconds, a small
  banner shows "No Venmo? Pay Alex directly" (first name from the site data, "the organizer" if there is none) for about 6
  seconds, or until tapped. If the Venmo app opened, nothing ever shows, even when the player comes back. Both Pay buttons
  (the game card and the game-day Pay card). `src/venmoFallback.ts`, `useNoVenmoNote` in `PlayerHome.tsx`.
  Only phones where Pay hands over to the app (`venmo://`) get it; computers and the organizer's own Venmo buttons do not.

- **Item 9: extra (one-off) game tile and comments (player screens only).** An extra game now uses the normal date tile
  (no more ink or cream tile) with a small purple EXTRA tag under the time. The organizer's comment shows as a pill when it is
  18 characters or fewer, otherwise as a soft tinted note box (`.note-pill` / `.note-box` in `src/player-cards.css`, same
  `game-note` class as before). A canceled game's reason follows the same rule on its status line: the words are unchanged
  ("Canceled - Rain"), only the look is a pill or a box. Item 9 was not in the POLISH_SPEC file I was first given (it ended
  at item 8); it was added from Alex's description. Admin cards are untouched. Tests: `extra games and comments` in
  `e2e/layout-polish.cjs` (normal tile, tag under the time inside its column, pill vs box, canceled reason, a normal game has
  none of it; 12 looks incl. 320 px, 200% text, light and dark); two old checks that expected the ink tile were updated.
  Colors are the site's existing ones, with no new colors: the comment pill and box use `--accent-soft` / `--accent-text` (the
  "Regular" chip), the EXTRA tag uses the existing extra/holiday chip colors; a test compares them with those names in light and dark.

### Items from "Later cleanup batch" (docs/AUDIT_SCENARIOS_player.md)
L1 to L4 fixed (all layout-only). **L5 not done** (it is about a failed drop on a shared phone, not layout).

### How it is built
- New `src/large-text.css`, loaded last. It uses container queries measured in `rem`: a 320 px screen at normal text is
  about 18 text-sizes wide and keeps today's layout exactly; the same screen at 200% text is about 9 wide and switches to the
  roomier layout (tile above the words, buttons under the names, one-column switches). So normal text is not touched.
- `Shell.tsx`: the buttons, credit and date square are one group (`.topbar-end`) that moves to its own row at big text.
- Date tile numbers are capped to their tile (`cqw`), so a 200% "17" no longer outgrows a 56 px tile.

### Checked that normal text did not change
Screenshots of 36 screens (player: Ryan, Wren, Pia and the 29-letter name; organizer: Home, Players, Money, History, Settings;
390 and 320 px, light and dark, normal text) were taken on main and on this branch and compared pixel by pixel. The same
page positions were compared element by element. Findings: identical, except (1) rows that used to break a long name in the
middle of a word (they now wrap by word), (2) the header of a player with a credit chip and a long name (two lines became one
line with "..."), (3) things that move by themselves (the "Game on" banner, the port number in the Settings link). One thing
found along the way: on phones 380 px wide or narrower the LATER tile's day number was already 2.1rem (an old rule order
slip); it is kept exactly as it was.

### Tests
- `e2e/layout-polish.cjs` (new, run by `npm run test:e2e`): see the count in "Tests on this branch" below. Uses
  `e2e/layout-lib.cjs` (the fake group with the awkward cases) and `e2e/layout-audit.cjs` (the measuring code: sideways
  scroll, past the edge, text cut off, overlaps, mid-word breaks, sheets that do not scroll). The checks fail on the old code.
- `e2e/audit-player-look.cjs`: the 12 "OPEN" checks about big text and the header are real checks now (0 open).
- Unit: `tests/venmo-fallback.test.ts` (7), `tests/keyboard.test.ts` (6).

### The Pay note has a switch (PAY_NOTE), the layout does not
- **PAY_NOTE** (Alex said yes, Mon Nov 2): `[vars]` kill switch + Settings > Feature switches (collapsed section) > "No Venmo? note",
  OFF at ship. Private test link `?paynote=on` / `?paynote=off` (header `X-Pay-Note`, that phone only). "On for everyone" is one
  `task_log` row (`pay_note_on`), logged in Activity, and moves both change stamps so open phones pick it up. Display only.
  Files: `shared/payNote.ts`, `server/payNote.ts`, `PUT /api/admin/pay-note`, `payNote` on `/api/group`, `payNoteForAll` on the
  dashboard, `PayNoteRow` in `SettingsTab.tsx`, `docs/FEATURE_SWITCHES.md`. Tests: `tests/pay-note.test.ts` (9) and two checks in
  `e2e/layout-polish.cjs` (off at ship = no note even with no app; private link on one phone only; Settings on for everyone and off
  again; the row sits in the collapsed section).
- The layout rules have no switch (plain CSS that only acts when text is big or a name is long; at normal text nothing moves).

### Merged with admin screens v2 (main 3f6fc1a, Mon Nov 2)
`e2e/layout-polish.cjs` runs the organizer checks with the new admin layout OFF and ON (`LAYOUT_ADMIN_V2=on`): 80 of 80 both ways.
Fixed for the new layout: Home short rows (`.hv2-short`) at big text (the court pill, "In" and the arrow drop under the words, the
count and names wrap), and History > Activity (a long name with no spaces pushed the page 48 px wider). Left as v2 designed it: at
normal text a short row cuts the names, and at 320 px (and a long "Not booked" pill) also the count line, with "..."; the test allows
that at 100% text only. Tell Alex if he wants the count never cut.

### Not tested for real here (needs a phone)
- The iPhone keyboard (tested with a stand-in for the phone's "visible area": the keyboard test shrinks it by 300 px).
- A real iPhone WITHOUT the Venmo app (tested with the page staying in view / going hidden).
- Real Larger Text (the tests make the text 150% and 200% bigger the way a browser setting does).

### To ship (after "ship it", quiet window: Wed 6:00 AM to 6:00 PM, or Fri through Mon 6:00 PM)
1. Merge the branch into main (PR), pull main, `npm test`, confirm main equals live plus this change.
2. SQL export and a Time Travel bookmark (no migration, no database change: this is for the rule).
3. `npm run deploy` from main. 4. Read-only live check. 5. Rollback: redeploy the previous commit (no data to restore).

### Deploy: layout polish LIVE (Mon Nov 2, 2026, about 1:57 PM Eastern, quiet window), every new switch OFF
- PR #74 merged as 09547e3 (same tree as the tested branch head 76b28cc). Production deployment `cd5a5dd6-8f6e-40a1-827f-20949dc84211`, branch main.
- Before it: SQL export `live-before-layout-polish-2026-11-02.sql` (260 INSERTs, has phone numbers, not committed, in the session scratch folder);
  Time Travel bookmark `000004a5-00000000-00005117-edbd66114d824e1284cd284b78373c28` (1:56 PM). No migration, no database change.
- Switches: PAY_NOTE allowed, Settings > Feature switches > "No Venmo? note" OFF for everyone (the live `/api/group` answers `payNote: false`,
  and `true` only with the private header `X-Pay-Note: on`). Nothing else was switched. Layout and item 9 are plain CSS/markup with no switch.
- After it (read-only): /, /admin, /api/status, /api/group/version 200; bundle holds the new code; row counts identical to before
  (players 10, sessions 9, session_players 21, credit_ledger 5, player_devices 38, task_log 6, admin_audit_log 144, refund_requests 0);
  live-check.cjs all green except the known "setup code is configured" line.
- Rollback: Pages deployment `c0d807e3-2261-4bdd-a74f-5f6f155ebdb7` (commit ebb375a, admin v2) via the Cloudflare dashboard, Deployments, "Rollback to this
  deployment". No data to restore. Whole database only if ever needed: `npx wrangler d1 time-travel restore pickleball --bookmark=000004a5-00000000-00005117-edbd66114d824e1284cd284b78373c28`.
- Known and not mine: admin-cleanup (2) and admin-motion "2. press" fail on untouched main too; round2 has one older flaky check; L5 left for later.

## Admin screens, round 2 (ADMIN_R2) - Mon Nov 2, 2026 - on a preview, waiting for "ship it"

Spec: zip 1 (Home cards, Money, Players, History, header), mockups `Home_round5_LOCKED` (option A) and `Money_round4_LOCKED` (option A, tight).
Started from main 09547e3 (layout polish and admin v2 both live). Admin only: no player sees any change. Ships OFF behind `ADMIN_R2`.
No database change (no migration; state is `task_log` rows, like the other switches). Nothing here is deployed to the live site.

### The switch
`ADMIN_R2` in `wrangler.toml` (kill switch, `[vars]` and `[env.preview.vars]`), `/admin?adminr2=on` (private, that phone only; `?adminr2=off` ends it),
Settings > Feature switches (collapsed) > "Admin screens, round 2" (for everyone, no deploy), `docs/FEATURE_SWITCHES.md`.
Files: `shared/adminR2.ts`, `server/adminR2.ts`, `PUT /api/admin/admin-r2`, `adminR2` / `adminR2ForAll` on the dashboard. With it off, admin looks exactly as before.

### What changed (numbers match the zip's SCOPE)
1. **Home cards** (`src/pages/admin/CardR2.tsx`, `src/admin-r2.css`): tile and time left; court switch with seats, dots and names under it; gear right; fixed 3-cell footer with thin dividers:
   [In | Out] [green $ circle + "1 of 3"] [clock + cancel time, or blue "Book" with the arrow when a court is needed]. Words In, Out and Book, no check/X/calendar icons.
   In/Out is the organizer's own seat (same call and rules as the old "I'm in"). The $ cell opens the Players sheet like the old paid pill. Holiday: a faint tab under the card, bottom right,
   "Election Day · hours confirmed? [Yes]" (outlined Yes); confirmed becomes faint gray "Election Day ✓" with no tab; Undo is in the gear menu ("Undo hours confirmed").
   Below 19 rem of card width (a 320 px phone) the tile and gear sit on a row and the switch gets the full width; at 15 rem the footer stacks.
2. **Money** (`MoneyR2.tsx`, `moneyList.ts`, `GameBody r2` in `MoneyV2.tsx`): one list by date, no group headers, small date tiles, paid/owes bars, amount owed on the right, gray "waiting on court" lines (nothing to open), faded Closed.
   Opened game: unpaid first, paid next, "Court $48" last (no Northville, no "$6"). Remind has Mark paid's size, font and shape. Paid chip is blue until the game is finalized, then green (the existing rule, kept). Court Due chip is gray.
   Control bar a little shorter.
3. **Players** (`PlayersTab.tsx`): no phone, days or Regular / Occasional on the list; names centered. "Hide player" in the Edit sheet (soft: gone from the Players list, View as and "Add someone"; every seat, payment, credit and history row stays;
   the player still works on their own screen; never your own name). Settings > Advanced > "Hidden players" lists them with Unhide on each. One `task_log` row per hidden player (`admin_hidden_player:<id>`). Unhide always works, even with the kill switch off.
4. **History**: activity by anyone other than the organizer ("organizer" and "organizer as X" are the organizer) gets a tinted row with a bar on the left, and screen readers hear "By someone else".
5. **Header**: Light/Dark button (the existing Auto/Light/Dark button) left of "View as...", "Admin" under ORGANIZER, "Updated just now" removed on every screen. The Settings Appearance row still works.
6. **"Book" with the arrow** replaces "Book a court" everywhere in admin (the week line pill, the Home card, the old court card, the moved-game question).

### Differences from the written spec, for Alex to see
- The cancel-by cell shows on every game, not only inside the last 24 hours: gray before that, red inside the last 24 hours (the mockup showed it red on every card).
- Money now also lists coming games with no court ("waiting on court") and every canceled game ("Closed"). The old tab only listed games with a court, and canceled games that gave credit back.
- Money order: games from now on, soonest first, then games already started, most recent first (the order the new Money tab already used).
- "Court due chips gray from Nov 11 onward" in the feedback became "Court due is gray" (every date), as the zip's START_HERE says.
- The court row has no detail line at all (not even on tap). Players-cover-$X details are no longer shown on this screen.

### Tests
- Unit: `tests/admin-r2.test.ts` (17): the switch (kill switch, header, Settings, Activity, organizer only), the dashboard is identical with it on or off apart from the switch fields,
  Hide player (flag, nothing else changes, works twice, not yourself, kill switch), History actor rule, Money list and owed amounts. Writing the test caught that a player named "Organizer Orla" would have been treated as the organizer (fixed: exact match).
- Browser: `e2e/admin-r2.cjs` (21 checks), added to `npm run test:e2e`: off by default, private link, Settings switch, header, card layout and footer, In/Out, Book, holiday tab, Money list, chips, Remind size, **Money numbers match the old Money tab (same paid counts, same owed amounts, same buttons, same court cost, game by game)**,
  Mark paid / Unmark, Venmo move, Players, Hide / Unhide, History highlight, 320/360/430 px, light and dark, 200% text, 44 px tap targets.

### After Alex tested the first preview (Mon Nov 2, 2026, evening): four fixes
1. **Court switch is instant** (`CardSwitchR2` in `CardR2.tsx`, round 2 only): the tapped segment and the card's own marks change the moment it is tapped, the save goes out in the background, the toast shows when the server
   answers (before, the toast waited for a whole screen reload and all three buttons were disabled while saving). A failed save snaps the switch back and says "The switch went back." Quick second taps are sent in order, the last one wins. Same request as before.
2. **Venmo link is in Settings > Money** (the section that shows "$14 each"), not on the Money tab. Same setting and same save. With round 2 off it stays in Settings > Group.
3. **History**: Activity is first and the default, Sessions second (round 2). Off: Sessions first, as before. (With the new admin layout on, History already opened on Activity.)
4. **Home**: with round 2 on, only THIS WEEK's games start open; later weeks start folded as short rows (tap to open). If nothing is left this week, the first game opens so the screen is never all folded.
   Round 2 uses the new layout's folded rows for this (`HomeGame`), also when the new admin layout switch is off. Not checked against the live site: reading the live database was blocked in this session, so whether the live admin has the new layout switched on (top 2 games open) or off (every game open) is unconfirmed.
- Tests: `e2e/admin-r2.cjs` is 24 checks (new: F1 instant switch with a slowed and a failing server, F3 History order, F4 Home folding; the Venmo check now looks in Settings > Money and checks the old place when off).

### One more change and a Home fold fix (Mon Nov 2, 2026, evening)
- **Header order** (round 2): logo and Admin, then View as..., then the Light/Dark button, then the calendar tile (the button sits next to the tile). At 320 px the group wraps onto a second row in the same order; nothing passes the screen edge, also at 200% text. Test: `H header fits...`.
- **Tap to fold on Home**: the preview Alex tested was deployed before fix 4, so its cards were plain full cards with no fold at all. Now (round 2, with the new layout switch on or off): this week's cards start open, later weeks start folded, a tap on an empty spot of an open card (the tile, the words, the footer edge) folds it,
  a tap on a folded row opens it, and the controls (gear, In/Out, the court switch, the $ cell, Book, Yes) never fold it. Test: `F5 Home cards: tap a card to collapse it...` (24 checks became 26 in `e2e/admin-r2.cjs`).

### In / Out is instant too (Mon Nov 2, 2026, about 4:10 PM Eastern)
The footer's In | Out now fills the moment it is tapped, and the seat count, the dots and the names on the card follow at once (round 2 only, `InOut` in `CardR2.tsx`). The save goes out in the background and the toast shows when the server
answers (before, it waited for a whole reload and the two buttons were disabled). A failed save snaps everything back and says "It went back." Quick taps are sent in order, the last one wins. Same request (`POST /api/admin/sessions/:id/me`), same rules.
Test: `F6 In / Out moves the instant it is tapped...` (a slowed server, three quick taps, then a failing server). `e2e/admin-r2.cjs` is 27 checks.

### Deploy: admin screens round 2 (Mon Nov 2, 2026, about 4:15 PM Eastern, outside loud hours) - LIVE with ADMIN_R2 OFF for everyone
- PR #75 merged as dc6428b (same tree as the tested branch 4ed22ad). Production deployment `278ee022-465e-4c22-8fb6-283a48ce2362`, branch main. No migration.
  Live was `cd5a5dd6-8f6e-40a1-827f-20949dc84211` (commit 09547e3) before; main had nothing newer.
- Before it: SQL export `live-before-admin-r2-2026-11-02.sql` (262 INSERTs, has phone numbers, not committed, in the session scratch folder) and Time Travel bookmark `000004c5-00000000-00005117-9e11ffebadcdf849d188deae9bdd5c5d` (4:13 PM).
- After it (read-only, public endpoints only): the backup address serves the new bundle (it contains the adminr2 test link); /, /admin, /api/status, /api/group/version 200; organizer data and the new switch endpoint answer 401 without a sign-in; the group is the live "Pickleball Bros".
  pickleball.juncaj.net could not be reached from this session's network (as on earlier deploys). No `admin_r2_on` row exists (nothing was switched on).
- Alex tests with pickleball.juncaj.net/admin?adminr2=on (that phone only; `?adminr2=off` ends it), then switches it on for everyone in Settings > Feature switches > "Admin screens, round 2" (no deploy), in a quiet window.
- Turn it off: Settings > Feature switches (no deploy). Everyone incl. test links: `ADMIN_R2 = "off"` in wrangler.toml and a deploy.
- Rollback: Settings switch off (instant). Code: redeploy Pages deployment `cd5a5dd6-8f6e-40a1-827f-20949dc84211`. New code only writes `task_log` rows (the switch, hidden players), which the old code ignores, so no data restore is needed. Whole database:
  `npx wrangler d1 time-travel restore pickleball --bookmark=000004c5-00000000-00005117-9e11ffebadcdf849d188deae9bdd5c5d`.
- Tests on the deployed code: type check clean; unit 1,707 passed, 1 skipped (95 files); `e2e/admin-r2.cjs` 27 of 27; old screens with the switch off passed apart from the known failures on main (admin-cleanup 2, admin-motion "press" 1).

## Late drops owe $14 (LATE_FEES) - Mon Nov 2, 2026 - on a preview, waiting for "ship it"

Spec: LATE_FEES_SPEC (Alex, Mon Nov 2, 12:35 PM) over the read-only AUDIT_REPORT (main 3f6fc1a). Started from main 6a9874e (admin screens
round 2 already live with its switch off). This is a MONEY change. Ships OFF. No database change (no migration).

### The rules as built (plain words)
- Late = inside the 12 hours before the start (start minus 12 hours, one clock). With the switch off, the late-drop mark keeps
  using each game's saved deadline as before (12 hours today; they only differ if Settings > Schedule's deadline is changed).
- A player's own late drop that leaves fewer than 4 in (people on the waitlist count, they move in at once) keeps their $14 on the
  game: cash stays paid, credit stays spent, unpaid means they owe. With 4 or more left, nothing is owed and money comes back as
  credit like today. Two drops at once: the one that takes it below 4 owes (decided inside the same database statement).
- Anyone who gets a seat afterwards (a new I'm in, a waitlist move-in, Alex adding someone, Alex's own In) clears the OLDEST open
  late-drop debt, one each, in the same database step as their seat. The dropper's money comes back as credit; their credit
  sheet says "Tue, Nov 3: someone took your spot. $14 back as credit." A dropper who comes back settles only their own debt
  (their payment is kept, no double charge).
- Finalize with fewer than 4 played: someone who was in and did not play owes $14 flat (their payment stays). 4 or more played:
  as today (everything back as credit). Reopen undoes the no-show debts with the rest of the finalize.
- Cancel inside 12 hours asks "Did the venue waive the fee?" (no default). Yes = today's cancel (open late drops are cleared too).
  No = no money moves, `canceled_by = 'organizer_fee_kept'`, everyone who was in still owes $14 (late droppers too); Money counts
  the court cost as charged and what was paid as collected. Reopen = a normal game again.
- Debts show on the player's top Pay card with "(late drop)", "(canceled late)" or "(did not play)" and the usual Use credit /
  Pay / I paid. Never blocks sign-up. Nobody else sees them. The organizer never owes; organizer removals are never late.
- Organizer: Money shows an Unpaid row on that game ("late drop · owes $14", "canceled, fee not waived"), Mark paid / Unmark, and
  Clear (Sub found / Venue waived / My choice), each with a History line. Home "Late drop" card: Find a sub (opens Messages with
  the game's prepared text) and Clear replace Done. The old Done refuses an open debt (it would have left the money nowhere).

### How it is stored (no schema change)
- A late-drop debt: the seat row is `withdrawn` with `played = 0` (only this switch's code ever writes `played` on a seat that
  left). A no-show: `late_drop_at` equal to the game's `finalized_at`. A late cancel: `sessions.canceled_by = 'organizer_fee_kept'`.
  Cleared = `late_drop_done_at` set. One rule in TypeScript (`shared/lateFees.ts` lateFeeKind) and the same rule in SQL
  (`server/lateFees.ts` OPEN_FEE); a test checks they agree on all 576 seat shapes.
- The money-back statements (`seatMoneyBackStatements`) now skip open debts by default, so a retry tap, a second cancel tap, an
  Unmark or an organizer edit can never hand the held $14 back. A clear marks the seat first, then moves the money.
- The switch: `LATE_FEES` var (kill switch), Settings > Feature switches > "Late drops owe $14" (one `task_log` row `late_fees_on`),
  private link `?latefees=on` / `/admin?latefees=on` (header `X-Late-Fees: on`). The switch only decides whether NEW debts are
  made; existing debts always show and always clear by a sub or Clear.
- Health checks (`scripts/integrity-checks.sql`): open debts are excluded from "credit used on left seat" and "cash still on
  canceled game", and counted in the new `info_open_late_fees` (a to-do, not a problem).

### Differences from the written spec / audit, for Alex
- SITE_RULES "Under 4 the game is canceled" is wrong: the code never cancels by itself. Fixed in `docs/SITE_RULES.md` (a copy of
  the rules now kept in the repo).
- Cancel-by mismatch (reported): cards and the cancel question use start minus 12 hours; with the switch off the late-drop mark
  uses the saved deadline (12 today, set from Settings when a game is made or moved). With the switch on, everything uses start
  minus 12 hours.
- "Use credit" on a debt already takes part of the credit when that is all there is (no new credit rule).
- A drop that a waitlisted player fills at once never creates a debt (the waiting player is counted), instead of creating one and
  clearing it a moment later.
- The Pay card shows a debt right away, not only from 8:00 AM on game day.
- Preview seed: an extra game "Late-fee test" 11 hours after the seed with 4 in (Jordan, Lane, Morgan, Kai; Kai paid cash).

### Fresh reviewer (did not write the code) and what was fixed
Found 3 real bugs, all fixed with a test each (`tests/late-fees.test.ts` "review fixes"): a "venue did not waive" cancel left a
paid WAITLIST seat's $14 on the canceled game (now it comes back as credit like any cancel; seats that owe are untouched);
moving a late-drop debtor to the waitlist wiped the debt or stranded its money (now refused); a debtor's "No" on the suggestion
card ended an unpaid debt (now ignored). Also tightened: a duplicate tap in the same millisecond can never clear a second debt
(one clear per game per moment), and the health check no longer counts the organizer's own seat as an open fee. Verdict after
fixes: re-run clean.

### Tests
- Unit: 1,744 passed, 1 skipped, 0 failed, in 96 files (was 1,707 in 95): new `tests/late-fees.test.ts` (37): the switch, the
  threshold (6 in / 2 drop, 5 in / 1 drop, 4 in / 1 drop, 4 in / 2 drop, 5 in / 2 drop), waitlist, before the cutoff, organizer,
  private header, subs (one, two drops then one sub, 5+ in, waitlist move-in, organizer add, organizer In, dropper rejoin, double
  taps), retries with the switch on and off, Mark paid / Unmark / I paid / Use credit, Clear x3 with History, Finalize (5 signed /
  4 played, 4 signed / 3 played, unpaid no-show, switch off), cancel (answer required, Yes, No, second tap, Reopen, switch off),
  the same script with the switch off and on, backup and restore round trip, privacy, the SQL and TypeScript rules agreeing on 576
  seat shapes, and the words. Ten older race tests failed at first only because they find statements by their SQL text; the
  statements are now word for word the old ones for any seat that is not a late fee.
- Browser: new `e2e/late-fees.cjs` 11 of 11 (360 and 430 px, light and dark). Re-run green with the switch off: admin-r2 27,
  admin-v2 27, audit-player-flows 93, credit 153, pay-always 12, money-visible 12, cancel-reason 8.

### Preview (Mon Nov 2, 2026, about 5:35 PM Eastern)
- https://preview-late-fees.pickleball-club-9h0.pages.dev (deployment 2404745d), branch `claude/new-session-37odjq` at a61d584.
  Fake database `pickleball-preview`, re-seeded just before (`npm run db:seed:preview`). The Settings switch there is off: use
  `?latefees=on` on a phone (and `/admin?latefees=on`), or flip Settings > Feature switches > "Late drops owe $14" on the preview's /admin.
- The "Late-fee test" game starts Tue Nov 3, 4:45 AM (11 hours after the seed), so it is already past its cancel-by. After it starts,
  any game less than 12 hours away works the same (or re-seed).
- Not on production. Nothing was deployed to the live site; no live data was read or changed.

### To ship (after "ship it"; LOUD HOURS until Tue 11:00 PM, so the first quiet window is Wed Nov 4, 6:00 AM to 6:00 PM)
1. Merge this branch into main (PR), pull main, `npm test`, confirm main equals live (deployment 278ee022, commit dc6428b/6a9874e) plus this change.
2. SQL export (`npx wrangler d1 export pickleball --remote --output live-before-late-fees-2026-11-04.sql`, kept out of git) and a Time
   Travel bookmark (`npx wrangler d1 time-travel info pickleball`).
3. `npm run deploy` from main. No migration. Ships OFF (no `late_fees_on` row).
4. Read-only live check: /, /admin, /api/status, /api/group/version 200; `/api/group` answers `lateFees: false`, and `true` only with
   `X-Late-Fees: on`; the health checks 0 (`info_open_late_fees` 0); row counts match the export.
5. Alex tests on live with `?latefees=on` and a test player on an extra game (it writes real records), then switches it on in a quiet window.
- Rollback: Settings switch off (no deploy; debts already made stay until cleared). Code: Pages deployment 278ee022 (the new code only writes
  existing columns and one task_log row; the old code would show an open late-drop seat as an ordinary late drop with its money still on
  the seat, so Clear every open debt BEFORE rolling back the code).

### Round 2 after Alex tested the preview (Mon Nov 2, 2026, evening)
Alex's answers: "(did not play)" on the Pay card is fine; debts show on the Pay card right away (correct).
1. Organizer as a player. a) Cancel inside 12 hours with the organizer in: Yes = every player's money back as credit, nobody owes;
   No = every other player who was in owes $14; the organizer never owes on a cancel and their court payment is untouched.
   b) The organizer's own Out inside 12 hours that leaves fewer than 4 in is a late-drop debt like anyone's (History line,
   Money row "late drop (you) · owes $14", Home late-drop card), cleared in one tap (Clear = "My choice"), never blocks them, a
   sub clears it. Their seat's paid mark means "Court paid", so it is never turned into an owed share or credit, and Mark paid
   is never offered on it.
2. "Text the players" (switch on only): gear menu, and right after a cancel. Two prepared, editable texts: "Court canceled" (first,
   picked) and "Court still booked (backup)", Alex's exact words, addressed only to the players confirmed in that game (never
   the organizer, the waitlist, hidden players or the whole group). The public booking link and the courts' phone are constants
   (`COURT_PUBLIC_BOOKING_URL`, `COURTS_PHONE` in shared/settings.ts): the saved CourtReserve link is the members' page, a different address.
3. The person whose debt was cleared sees a notice in the usual green banner the next time they open the site, until they tap
   Dismiss (remembered on that phone): a sub: "Good news: someone took your spot for Tue, Nov 3. You no longer owe $14." (paid:
   "... Your $14 is back as credit."); the organizer (venue waived, my choice, or a cancel with Yes): "You no longer owe $14 for Tue, Nov 3."
   Read from their own History lines (last 60 days); nobody else gets it. No schema change.
4. The question is now "Did the venue waive the fee or give you credit toward the next booking?". After a late cancel the text
   follows the answer, on the after-cancel sheet and on the Home "Do this now" card's text button: No = "Heads up: today's game is
   canceled ... your $14 share still applies ..." to the confirmed players only; Yes = the credit text saying "today".
- Fresh reviewer (did not write the code), round 2: SHIP, no money or privacy issue (proved the organizer's court payment stays
  exactly as it was through Clear, cancel Yes, cancel No then Clear, a sub, Finalize then Clear, and "Court due" while a debt is
  open). Fixed from its list: your own debt row on Money read "Paid" (the court payment's chip) and sorted with the paid rows, now
  "Unpaid" from the debt itself; the organizer's own drop from the player site had no warning, now it has the same one; a
  venue-did-not-waive cancel left the organizer's own late drop owing, now it ends with the cancel (the organizer never owes on a
  cancel; no money moves on their seat); on the late-cancel sheet the Reason box reset any edits to the text, so it is gone there
  (the text box itself is editable). A stray review test file that got committed is removed.
- Left as is, for Alex: the texts always say "today" (as asked); a cancel more than 12 hours out keeps the old sheet (no venue
  question, no "Text the players" there; the gear menu has it any time); hidden players are only left out of "Text the players"
  while "Admin screens, round 2" is on (that is when hiding exists); the notices show even with the switch off (only debts made
  while it was on can be cleared, and production has none).
- Tests: unit 1,760 passed, 1 skipped, 0 failed (96 files; `tests/late-fees.test.ts` 53). Browser `e2e/late-fees.cjs` 17 of 17 at 360
  and 430 px, light and dark (the venue question with nothing picked and Pick Yes or No, the No sheet text and who it goes to, Text
  the players A picked, B, editable, not sent to you or the waitlist, off = no menu item, Ryan's notice and Dismiss, nobody else sees
  it, your own debt row Unpaid with one-tap Clear). Re-run green: admin-r2 27, admin-v2 27, audit-player-flows 93, credit 153,
  pay-always 12, money-visible 12, cancel-reason 8, do-now 13.
- Preview redeployed Mon Nov 2, 6:45 PM Eastern: same link https://preview-late-fees.pickleball-club-9h0.pages.dev (deployment
  78ad4bba), fake database re-seeded; the "Late-fee test" game now starts Tue Nov 3, 6:00 AM. Not on production.
- Alex's answers (Mon Nov 2, evening): a cancel more than 12 hours out has no venue question and "Text the players" stays in the gear
  menu only (OK); the organizer's own open late drop ends if they then cancel with No (OK, the organizer never owes on a cancel). The
  loose ends stay as they are (texts say "today", notices show with the switch off, hidden players get the Heads up text because they owe).
- "Ship it" Mon Nov 2, about 6:55 PM Eastern. Alex chose to deploy before game night (inside loud hours) because LATE_FEES ships OFF,
  so players see no change. Before it: live health checks all 0, no late-fee marks or `late_fees_on` row, row counts audit 155,
  credit_ledger 5, players 10, seats 21, games 9, task_log 9, refund_requests 0, migrations 16. SQL export
  `live-before-late-fees-2026-11-02.sql` (274 INSERTs, has phone numbers, not committed, in this session's scratch folder) and
  Time Travel bookmark `000004e7-00000000-00005117-5cbc7d22b8e829a7f0404216f256f54e` (6:58 PM). Live before: deployment
  `278ee022-465e-4c22-8fb6-283a48ce2362` (commit dc6428b).

### Deploy (Mon Nov 2, 2026, 7:59 PM Eastern) - LIVE with LATE_FEES OFF for everyone
- Alex chose to ship tonight (inside loud hours) because the switch ships OFF and players see no change. PR #77 merged as 0edf850 (same tree
  as the tested branch e9a70e3). Production deployment `76053686-2f55-4612-b630-72df79c12d2c`, branch main, commit 0edf850. No migration,
  no database change, the clock Worker and the 7:00 PM smart alert untouched (that tick ran before the deploy and wrote 2 alert-log rows).
- Tests on main before the deploy: type check clean; unit 1,760 passed, 1 skipped, 0 failed; browser, every file one by one: all green
  except the 3 known ones (admin-cleanup 2: the "2 of 3 paid" pill and the red cancel-by line; admin-motion 1: "press"). round2 passed.
  late-fees 17 of 17.
- Read-only live check after (backup address; pickleball.juncaj.net is not reachable from this session): /, /admin, /api/status,
  /api/group/version 200; organizer data and the new switch endpoint 401 without a sign-in; `/api/group` answers `lateFees: false` (true only
  with the private header) and no notices; the new bundle is served; 21 health columns all 0 (incl. `info_open_late_fees`); row counts as
  before (audit 155, credit_ledger 5, players 10, seats 21, games 9, task_log 11, refund_requests 0, migrations 16); no `late_fees_on` row.
  The sign-up page and the admin sign-in page are pixel-identical to before (360 light, 430 dark). Pay card, admin Home, Money and Settings
  were compared on a LOCAL copy of tonight's backup, old code (dc6428b) against new (0edf850), same clock: the same words on every screen;
  the only new thing is Settings > Feature switches > "Late drops owe $14", OFF. (The local copies were deleted afterwards.)
- Turn it on later (quiet window, Alex): Settings > Feature switches > "Late drops owe $14". Private test: `?latefees=on` (writes real records:
  use a test player on an extra game).
- Rollback: code: redeploy Pages deployment `278ee022-465e-4c22-8fb6-283a48ce2362` (commit dc6428b). The new code writes nothing while the
  switch is off, so no data restore is needed. If debts were ever made, Clear them before rolling back the code. Whole database:
  `npx wrangler d1 time-travel restore pickleball --bookmark=000004e7-00000000-00005117-5cbc7d22b8e829a7f0404216f256f54e` (6:58 PM).

## Late fees: reminder texts for late-fee debts (Mon Nov 2, 2026, night) - on a preview, waiting for "ship it"

Alex's list of texts (Nov 2) turned up a bug that had to be fixed before LATE_FEES can be switched on: the payment reminder for a late-fee
debt read "Hey Blair, you owe $0 for pickleball", because the "who owes" helper (`owedGames` in `src/pages/admin/textMenu.ts`) only counted
confirmed seats in games that are on. Fixed in that one place (plus the Home card's own filter in `src/pages/admin/suggestions.ts`):
- With LATE_FEES on (the dashboard's `lateFees` flag), a late-fee debt that is really owed (unpaid, something left to pay, not the organizer)
  counts at once, whatever the game's state: a late drop that left the game short, a no-show, or a seat in a game canceled late with the fee
  kept. `owesLateFee()` is the one rule. A paid debt (the money stays on the game), a cleared debt, a drop that left 4 or more, and the
  organizer's own debt get no reminder.
- Money > Remind (one text per person), Remind all unpaid, the 7-day Home reminder card, and the reminders after a late cancel answered No
  all use it, so each says $14. Owing a late drop AND another game in the check-in window gives one text with the total ("you owe $28 for
  pickleball"). One game: "Hey Blair, you owe $14 for pickleball Tue Nov 3. Pay here: ...".
- The 7-day card also looks at games canceled late (only through their debts) and at seats that left.
- Switch off: nothing changes (the old behavior, including the old "$0" for a debt left over from testing, is kept as asked; a test pins it).
- No database change. The old per-row Text in the classic (old layout) Money tab does not list late-fee rows; not touched.
- Tests: `tests/late-fees.test.ts` 59 (6 new: the four cases, the total, paid / cleared / no-debt / organizer not reminded, switch off
  unchanged; the five that matter fail on the old code). `e2e/late-fees.cjs` 19 (2 new: the Remind list's Text for a late-drop debtor says
  $14 at 360 and 430 px, light and dark).
- Fresh reviewer (did not write the code): SHIP, no bugs. Checked: amounts with partial credit, two debts for one player (one text, total),
  paid / cleared / organizer / no-debt drop not reminded, no double counting, switch off identical to the old rules, no crash on missing fields.
  Left as they are (already true for normal debts): a single debtor's 7-day card text shows that person's total across games, and a person owing on
  two old games shows on both cards.
- Tests: unit 1,766 passed, 1 skipped, 0 failed (96 files). Browser, every file one by one: all green except the known three (admin-cleanup 2,
  admin-motion "press" 1; round2 passed); late-fees 19 of 19.
- Preview Mon Nov 2, 10:04 PM Eastern: https://preview-late-fees.pickleball-club-9h0.pages.dev (deployment 07dd6145, branch at 590d01e), fake database
  re-seeded (earlier test taps there are gone; the "Late-fee test" game starts 11 hours after the seed). Not on production.
- To ship: as before (Wed Nov 4 6:00 AM Eastern or later and only after "ship it"): merge to main, full tests on main, SQL export and Time Travel bookmark,
  `npm run deploy` from main, LATE_FEES stays OFF, read-only live check. Rollback: Pages deployment 76053686-2f55-4612-b630-72df79c12d2c (commit 0edf850,
  live now) or, for the whole database, the bookmark taken at deploy time. No migration, no data change.

### Deploy: reminder texts for late-fee debts (Tue Nov 3, 2026, 9:21 AM Eastern) - LIVE with LATE_FEES OFF for everyone
- Alex made a one-time exception to the loud hours (quiet morning, all 4 players for tonight confirmed, switch OFF so players see no change; cutoff 2:00 PM).
  PR #78 merged as d570182 (same tree as the tested branch 298c6a8). Production deployment `1568f40c-124e-48a0-bb31-c55dcf514b8e`, branch main, commit
  d570182. Live was `76053686-2f55-4612-b630-72df79c12d2c` (commit 0edf850). No migration, no database change; the clock Worker and the alerts were not touched.
- Before it (8:08 AM): live health checks all 0, no `late_fees_on` row, no late-fee History lines; row counts audit 162, credit_ledger 5, players 10, seats 22,
  games 10, task_log 13, refund_requests 0, migrations 16. SQL export `live-before-reminder-fix-2026-11-03.sql` (287 INSERTs, has phone numbers, not committed, in
  this session's scratch folder) and Time Travel bookmark `0000058d-00000000-00005118-246988de539bc60ec448f363e294a6df` (8:08 AM).
- Fresh reviewer on the final diff (git diff 0edf850..298c6a8): SHIP. Only 5 files changed (no server, schema, wrangler.toml, clock or alert code); with the switch off
  the helpers matched the old code on 24,000 random cases and 3 real flows; with it on they matched an independent model on 4,000 random dashboards.
- Tests on main: type check clean; unit 1,766 passed, 1 skipped, 0 failed. Browser, every file one by one: all green except known failures. Known: admin-cleanup 2
  (the "2 of 3 paid" pill; the other is time dependent: the red cancel-by line this time was instead the "Do this now ... Court still needs to be booked" check),
  admin-motion "press" 1. round2 passed. NEW at this hour: pay-always 4 failed (light and dark "$14 due, Pay and I paid", I paid, 360 px fit). I ran pay-always and
  admin-cleanup on the code that was live (0edf850) at the same hour: the very same checks fail there. Cause: tonight's game is on game day, so after 8:00 AM the Pay
  button moves to the top Pay card and those tests look for it on the game row. A test assumption about the hour, not a site bug and not this change. late-fees 19 of 19.
- Read-only live check after (backup address; pickleball.juncaj.net is not reachable from this session): /, /admin, /api/status, /api/group/version 200; organizer data and
  the switch endpoint 401 without a sign-in; `/api/group` answers `lateFees: false` (true only with the private header), no notices; the new bundle is served and has the
  "Late drops owe $14" row; 21 health columns all 0; row counts identical to before the deploy; no `late_fees_on` row. The sign-up page and the admin sign-in page are pixel-identical
  before and after (360 light, 430 dark). Pay card, admin Home, Money and Settings > Feature switches were compared on a LOCAL copy of this morning's backup, old code against new,
  same clock: the same words on every screen, and "Late drops owe $14" is present and OFF on both. (Local copies deleted afterwards.)
- Rollback: redeploy Pages deployment `76053686-2f55-4612-b630-72df79c12d2c` (commit 0edf850). The new code writes nothing, so no data restore is needed. Whole database:
  `npx wrangler d1 time-travel restore pickleball --bookmark=0000058d-00000000-00005118-246988de539bc60ec448f363e294a6df`.
- Switching LATE_FEES on is Alex's call, in a quiet window: Settings > Feature switches > "Late drops owe $14".

## Admin zip 2: Edit game, Add game, Settings cleanup, Players layout (ADMIN_R3), built Tue Nov 3, 2026 (NOT shipped yet)

Built on main at `0edf850` (the late-fees merge, so its "Late drops owe $14" row is kept in Feature switches). Ships OFF behind
`ADMIN_R3` (see `FEATURE_SWITCHES.md`). Admin only, display only, no schema change, no new color.

### What changed (only when the switch is on)
1. Edit game: no "Court" label (the switch keeps its screen-reader name), tighter spacing; the sheet is 452 px tall on a 520 px
   budget at 360 x 640 (before: 522 px, 1 px over).
2. Add game: Start and End are drop-downs in 30-minute steps on the 12-hour clock (6:00 AM to 11:30 PM; an off-step usual time such
   as 7:15 PM is kept as its own choice so opening the form never changes it); the date is the calendar picker only.
3. Settings: see the switch row in `FEATURE_SWITCHES.md`. (Added Nov 3 at Alex's request: the top "Player link" card with Copy is deleted, not moved. Checked first: nothing depends on it. The link itself is still built from `group.playerLink` for the texts, the private test links are plain `?adminr3=on` style addresses, and the other Copy buttons (Setup, player screen) are separate.) Toggle rows moved into Feature switches move first, confirm with a toast
   after, and snap back with a toast if the save fails (the old rows keep their old behavior when the switch is off).
4. Players: `src/pages/admin/PlayersR3.tsx` + `src/admin-r3.css`. Data: played = the all-time count the page already had; held =
   `heldCents()` (what Home and the old row call "$28 held"); credit = the credit pot; spent = new, worked out on the server in
   `server/adminR3.ts` (`spentByPlayer`) from existing rows (no schema change), same per-seat math as Money's "Collected" for a played game; late-drop fees, no-show fees and fee-kept cancels are NOT counted as spent.
   Why on the server: the dashboard only carries the last 90 days of games but "played" counts every game ever, so a phone-side
   sum would drift apart from "played" after 90 days.
- Round 3 only shows when round 2 is also on (it rearranges round 2 screens), on the server (`adminR3For`).

### Not shown on the new Players row any more (all still reachable)
Owes $X, "refund requested", late-drop count, the New tag, and the Refund credit balance / Mark refunded / Undo buttons. They are
still in the sheet that opens when you tap the name (money and sessions, credit section), on Home, and on Money.

### Tests
- `tests/admin-r3.test.ts` (11): switch rules, kill switch, header needs round 2, spent math ($14 paid, $11 final, $3 back),
  the dashboard is identical with it on or off apart from the switch fields and spent, reading it writes nothing, no migration.
- `e2e/admin-r3.cjs` (14): off = old screens, Players rows equal height and no scrolling at 360 x 640 (also dark, 320, 430, 200% text),
  pills only when not zero, gear = same Edit sheet with a 44 px tap area, Edit game no Court label and fits, Add game 30-minute
  options and saving a 7:30 PM game, Settings order, the moved switches keep their state and still flip, snap back on failure.

## Player screen small fixes, round 1 (PLAYER_FIX1, items 1 and 2) and the Pay sheet (PAY_SHEET, item 3) (Tue Nov 3, 2026) - built, tested, reviewed; on a preview, waiting for "ship it"

Alex asked for two small fixes on the PLAYER screen. Layout only; ships OFF behind `PLAYER_FIX1`.

**Why the Pay button had moved (checked in the code and in these notes).** On purpose. When the game-day card at the top ("Tonight: you owe $14", from 8:00 AM, `PayCard`) was built, the notes decided "that day's row shows the amber chip but no button, so there are never two Pay buttons" (Stage 3 cards, "Not changed on purpose"). The top card can also add several games into one total with one Pay. In the code: `RowPay` got `onTop = g.payDue.some(...)` and returned only the chip. It is not a pay-always rule and no money rule depends on it. (The Pay-always notes only say the top card "follows the same rule".)

### What changed (only with the switch on)
1. **Pay and I paid on tonight's card.** `RowPay` no longer stops at the chip when `g.playerFix1` is on, so tonight's card has the same `$14 due` + Pay + I paid + Drop out as every later card. The top card is untouched (same words, same buttons). Both Pay buttons use the same amount, Venmo link, app link and note; both "I paid" buttons call the same `/paid` request with the same amount, and the screen reloads from the server, so both cards always show the same state. Small extras so two copies behave: a tap on one copy makes the other wait while it saves (per game, only with the switch on; a tapped button keeps its own "Saving..." label); Pay tapped on one copy shows "I paid" on the other for someone with credit (the "I paid" after Pay rule), also when the top card covers several games.
2. **TONIGHT tag.** New block at the end of `src/player-cards.css`, scoped under `.schedule.pf1`: side padding 0.7em, vertical 0.42em, letter spacing 0.04em, size `min(0.72rem, 13cqw)` (follows the tile width the way the weekday and date numbers do, so it also fits with Larger Text). Same colors, same 8px corners. At 320/360/430 px the word has about 7px of room on each side (was 0), inside the tile with 6px to spare; at text 150% and 200% it stays inside the tile. TONIGHT is the only tag with that style (there is no TOMORROW tag: tomorrow's game shows its weekday like any other); the EXTRA, Canceled and weekday labels are untouched (checked: weekday tiles identical on and off).

### The switch
`PLAYER_FIX1` (kill switch, "on" in wrangler.toml only ALLOWS it, production and preview), Settings > Feature switches > "Player screen fixes" (OFF at ship, one `task_log` row `player_fix1_on`, no schema change), private link `?playerfix1=on` (`?playerfix1=off` ends it; header `X-Player-Fix1`), `playerFix1` on `/api/group`, `playerFix1ForAll` on the dashboard, `PUT /api/admin/player-fix1`, Activity log lines, player change stamp includes the switch (open phones pick it up in 5 seconds). `docs/FEATURE_SWITCHES.md` has the row. Copied from `PAY_NOTE`.

### With the switch OFF
The player screen's markup was compared with main's, 27 screens (3 players x 3 phone sizes x game day 10:00 AM, game day 6:00 PM, and Monday 9:00 AM): identical, not one attribute different. The new CSS only applies under `.pf1`, which exists only when the switch is on. The in-flight guard is also only active when the switch is on. No money rule, amount, alert or clock Worker code was touched; no migration.

### Tests
- New `tests/player-fix1.test.ts` (10): the switch, header, Settings, kill switch, activity and change stamp, only the organizer, money data identical on and off, wrangler.toml and docs.
- New `e2e/player-fix1.cjs` (30, added to `npm run test:e2e`): OFF shows today's card; the private link; same buttons as a later card; the TONIGHT tag at 320/360/430 px x light/dark x text 100/150/200% (room, inside the tile, same colors, no sideways scroll or cut-off); weekday tiles unchanged; no money moved by looking; I paid on either card marks the same record and both cards follow; two I paid taps at once send one request; credit that arrived after sign-up (Use credit works, Pay on one card shows I paid on the other); the Settings row; a phone left open picks it up in 5 seconds.
- `e2e/pay-always.cjs`: its phones now open with `?playerfix1=on` (private switch). Reason: that test looks for Pay on tonight's own card, and on a game day after 8:00 AM that is only there with the fix on. It now passes on any day (12 of 12).
- Known failures on main, not fixed: admin-cleanup 2 (the "2 of 3 paid" pill tap area; "Do this now" court cards: 3; the same two fail on a clean checkout of main today), admin-motion "press" 1.
- Fresh reviewer (did not write the code) found one real problem: with the switch off, tapping "I paid" on the top card made "Use credit" also read "Saving..." (and the reverse). Fixed: the guard only runs with the switch on and a button's label is its own. The same review noticed a second problem on my first fix: 77 unit tests that render the player screen on the server failed ("getServerSnapshot"); fixed by giving the hook a server value.

### Item 3: the Pay sheet (PAY_SHEET) - added the same afternoon at Alex's request
**The bug.** A player with a Venmo account but no Venmo app taps Pay: on a phone Pay hands the page over to `venmo://paycharge?...` (`openVenmo` in `src/lib.ts`), and with no app installed Safari says "the address is invalid". The existing "No Venmo? note" (`PAY_NOTE`) only added a hint afterwards.
**What changed (only with `PAY_SHEET` on).** Tapping Pay on the "Tonight: you owe" card or on a game card opens a small bottom sheet (the site's own `Sheet`) instead of leaving the page. Top to bottom: title "Pay Alex $14" (organizer's first name; the amount is the Pay button's own amount); two stacked buttons of the same height, filled green "Have the Venmo app? Click here" (the same link and app link Pay always had, same `openVenmo`) and outlined "Copy Venmo @handle" (copies `@handle`, read from the Venmo link in Settings > Money with `parseVenmoHandle`; left out if the link has no readable name); a small gray line "No Venmo? Apple Pay or Zelle 248-247-9231, or cash."; an outlined "I paid" (the same `paid.set(true)` as the card's own button). Nothing else: no subtitle, no web link. While the switch is on the "No Venmo? note" does not run (the sheet replaces it). A card with no Venmo link set shows no Pay button, so no sheet.
**The number.** Settings > Money > "Apple Pay / Zelle number", default 248-247-9231 (`DEFAULT_ZELLE_NUMBER` in `shared/settings.ts`); stored as the `zelleNumber` key inside the group's existing `settings_json` (no table or column: NO schema change; nothing saved = the default, saved blank = no gray line). `normalizeSettings` only keeps numbers, so `updateGroup` puts the key back on every save. The number is validated (digits, spaces, + ( ) . -, 7 to 24 characters). Players get it as `group.zelleNumber` on `/api/group`.
**The switch.** `PAY_SHEET` (kill switch; "on" in wrangler.toml production and preview only ALLOWS it), Settings > Feature switches > "Pay sheet" (OFF at ship, one `task_log` row `pay_sheet_on`), private link `?paysheet=on` (`?paysheet=off` ends it; header `X-Pay-Sheet`), `paySheet` on `/api/group`, `paySheetForAll` on the dashboard, `PUT /api/admin/pay-sheet`, Activity lines, player change stamp token `ps`. `docs/FEATURE_SWITCHES.md` has the row and the number's storage.
**OFF.** Markup of the player screen is identical to main on the same 27 screens (re-checked after item 3); the new CSS (`.pay-sheet*`) only styles the sheet, which exists only when the switch is on.
**Tests.** `tests/pay-sheet.test.ts` (15: the switch plus the number: default, saved, blank, refused, survives other saves, no migration). `e2e/pay-sheet.cjs` (22): OFF = plain link; the private link; sheet text exactly as asked and nothing else; same Venmo link on both Pay buttons; copy puts `@organizer` on the clipboard; I paid in the sheet marks paid once and closes; the note does not show with the sheet on; Settings switch and number; game-day top card; 320 / 360 / 430 px x light / dark x text 100% / 200%: equal button heights, nothing cut off, no sideways scroll; no money moved. The real Venmo app cannot be opened in a test browser: only the address is checked.

### Status (Tue Nov 3, 2026, about 12:30 PM Eastern)
- Rebased onto main 20fc8a9 (admin round 3 had landed; its ADMIN_R3 rows are kept in Feature switches next to the two new ones).
- Tests on the rebased code: type check clean; unit 1,802 passed, 1 skipped, 0 failed (99 files); browser, every file one by one: all green except the known ones (admin-cleanup 2, admin-motion "press" 1). New: player-fix1 30, pay-sheet 23; pay-always 12 of 12 (its 4 game-day failures are gone); run 229, layout-polish 200, admin-r3 15.
- Fresh reviewers (did not write the code) for each part; every finding fixed (see above). Two earlier test-run failures were mine and are fixed (server-render fallback for the in-flight hook; the Zelle key was renamed `zelleNumber` because the privacy scans flag keys containing "phone").
- Preview (fake database, re-seeded Tue Nov 3 about 11:00 AM): https://preview-player-fix1.pickleball-club-9h0.pages.dev (deployment c3261d96). Not on production. Tonight's fake game is Tue Nov 3, 8:00 PM, Court booked, Jordan owes $14 (also Avery owes $11): that is the game-day look.
- To ship (never in loud hours; Wed Nov 4 6:00 AM Eastern or later, and only after "ship it"): PR, full unit suite, SQL export and Time Travel bookmark, `npm run deploy` from main with PLAYER_FIX1 and PAY_SHEET OFF, read-only live check. Rollback: Pages deployment `2bbbff84-880c-40cc-ae74-79ef1bac9e9f` (commit 20fc8a9, live now). No migration, no data change.

## Deployed: PLAYER_FIX1 and PAY_SHEET (Wed Nov 4, 2026, 12:12 AM Eastern, after the 11:00 PM Tuesday quiet-down) - BOTH SWITCHES OFF
- PR #80 merged to main (33480812), deployed from main: Pages deployment `41880b8d-f4a5-49ad-bc67-2ce4b68a39c4` (commit 3348081). Before: live was `2bbbff84-880c-40cc-ae74-79ef1bac9e9f` (commit 20fc8a9 = main before the merge).
- Restore points taken at 12:11 AM Eastern, before the deploy: SQL export of the live database (kept off the repo, it has phone numbers) and Time Travel bookmark `00000657-00000000-00005119-6badbdd2a076655b94b52e0449b4fa9f`.
- No migration, no data change, clock Worker and alerts not touched. Row counts before and after are identical (audit 182, credit entries 5, players 11, seats 23, games 10, task_log 20, refunds 0); the only switch row is `late_fees_on`; no `player_fix1_on` or `pay_sheet_on` row.
- Tests before the deploy: unit 1,803 passed, 1 skipped, 0 failed (99 files). Browser, every file one by one: the known failures (admin-cleanup 2, admin-motion "press" 1) PLUS 8 files that failed only because the run happened late at night (after tonight's 8:00 PM game ended): popup, circles, money-visible, good-news, audit-player-flows, admin-audit, motion, layout-polish. The same 8 files were run on a clean checkout of main (20fc8a9) at 11:45 PM to 12:10 AM and failed the same way (same counts), and the same code passed all of them at about 12:30 PM Tuesday. Re-run them after 8:00 AM to confirm.
- Fresh reviewer on the final diff: SHIP. It found the Zelle number would be sent to every phone even with the sheet off; fixed (sent only when the sheet is on for that phone) before deploying.
- Read-only live check (backup address; pickleball.juncaj.net is not reachable from this session): `/`, `/admin`, `/api/status`, `/api/group/version` 200; dashboard and both new switch endpoints 401 without a sign-in; the served bundle contains the sheet; `/api/group` answers `playerFix1: false`, `paySheet: false` (true only with the private headers), no `zelleNumber`; `payNote` and `lateFees` still true. Admin Home, Money and Settings need the PIN, so they were not opened from here.
- Turn on later (Alex): Settings > Feature switches > "Player screen fixes" and "Pay sheet". Private test on live: `?playerfix1=on` and `?paysheet=on`.
- Rollback: code: redeploy Pages deployment `2bbbff84-880c-40cc-ae74-79ef1bac9e9f` (commit 20fc8a9). Nothing is written while the switches are off, so no data restore is needed. Whole database: `npx wrangler d1 time-travel restore pickleball --bookmark=00000657-00000000-00005119-6badbdd2a076655b94b52e0449b4fa9f`.

## Texts and Telegram alerts, round 2 (TEXTS_R2) (Wed Nov 4, 2026) - built, tested, reviewed; on a preview, waiting for "ship it"

Zip 3 (START_HERE, TEXT_AUDIT, SITE_RULES). Built on main `3348081` (the PLAYER_FIX1 / PAY_SHEET merge). Wording, timing and one default only: no money rule, amount
or game rule, no schema change, no migration. Ships OFF behind ONE new switch `TEXTS_R2` (see `FEATURE_SWITCHES.md`): `wrangler.toml` kill switch (allows it, production and
preview), Settings > Feature switches > "Texts and alerts, round 2" (off at ship, one `task_log` row `texts_r2_on`), private link `/admin?textsr2=on` (header `X-Texts-R2`).
The switch is read in three places: the organizer screens (`d.textsR2`), the `/go/` text link (`textsR2For`), and the 5-minute clock (`cronTick` reads the same row in its
existing first database trip, so no extra trip) plus the tap alerts (`textsR2ForAlerts`). **The private link changes only the texts and the cancel sheet on that phone. The
Telegram alerts and the clock follow only the Settings switch for everyone** (they are not tied to a phone), so alert changes cannot be tried on one phone first.

### A. Prefilled texts (all in `shared/textsR2.ts`; the old wording stays in `shared/messages.ts` untouched)
1. Check-in, 2. Need players (also Find a sub), 3. Share, 4. Final price ("Thu Oct 29", "last night" / "yesterday"), 5. Spot opened, 6a. Canceled credit version (merges the old
#5 and #16; any game; reason), 6b. Canceled fee-kept version (reason), 7. Moved (line breaks, reason), 8. Payment reminder ("yesterday" / "Tue Nov 3", several games = total),
9. Remind all unpaid, 10. Still in? ("is confirmed @ 7:30pm"), 11. the two "Text the players" texts (their live words, line breaks only). Day words count calendar days in the
group's zone (never 24-hour math), so midnight and the Nov 1 clock change are safe. Times read `8pm` / `7:30pm`. Every text ends with a blank line then `pickleball.juncaj.net`
alone (11 and the CourtReserve texts have no site address, as before). No dashes (a test scans every text). Line breaks reach Messages as `%0A` (checked in unit tests for iPhone
`sms:&body=` and Android `sms:?body=`, and on the real anchor in the browser test). **Not verified on a real iPhone** (no iPhone here): it is the first item in the phone test list.
- Check-in now opens with NO recipients in the gear menu and on the Home cards too (before: the gear menu and the Home card went to everyone's numbers).
- The cancel reason typed on the cancel sheet (`sessions.cancel_reason`) is now in both late-cancel texts and starts in the Reason box of the normal canceled text.
- Removed (each checked unused by searching `src`, `server`, `shared`, `functions`; only tests called them): the poll ("In or out?" with the price), the court-waitlist poll,
  "Are you still in?", "A pickleball spot just opened... First to claim it", "Pickleball is planned for... I'm checking court bookings now", and the unused duplicate Text button
  component (`src/pages/admin/Texts.tsx`; the gear menu has its own). Their tests were deleted. **Left on purpose:** `deadlineAlertMessage` and "Text this alert to yourself"
  (a screen still offers it with the switch off; it is hidden with the switch on, and the wording can be deleted once the switch is on for everyone), and the `/links` API with
  `sessionLink` (not on Alex's list).
### B. Cancel sheet
With the switch on, "Did the venue waive the fee or give you credit toward the next booking?" starts on No, and the fee-kept text is ready after Cancel session. Yes still works as
before. It only appears when "Late drops owe $14" is on and the cancel is inside 12 hours (as before); with late fees off the old "Were you charged for this court?" question is
unchanged (it already defaults to No).
### C. Telegram (clock brain `shared/tasks.ts`, tap alerts `shared/alerts.ts`)
- #1 "Tomorrow: 5 players in. Text the group to confirm" / "Tomorrow: 3 players in, need a 4th. Text the group" (the link opens text 1 or 2). #2, #3 keep their words with "Tomorrow:".
- #4 game-day check: not sent (the Home card still reads the same).
- #5 heads-up at **6:55 AM**, not 6:58: the clock ticks every 5 minutes, so a 6:58 alert would go out at the 7:00 tick, after the court opened. An exact 6:58 would need a second
  cron entry on the clock Worker (a separate Worker deploy that the switch cannot turn off, and the daylight-saving hour moves it): not cheap or safe. A missed tick still sends it up to an hour late.
- #6 booking reminder (7:30 AM) is sent only while the game is Not booked: not for Booked, Waitlist or Canceled. **Checked #5 and #7 for the same status logic and left them:** #5 fires
  before the court opens (a game already on Waitlist then is not a real case), and #7 "Check CourtReserve for an opening" is still useful for a Waitlist game (a waitlist is not a court).
- #7 "no court yet" goes 30 minutes before cancel-by, never before 7:00 AM that day (8 PM game: 7:30 AM; 7 PM game: 7:00 AM). Never before its 24-hour window opens, so a 24-hour
  cancel-by still gets its alert (found by a test). The Home "no court yet" card shows at the same time as its alert.
- #8 finalize: "Tonight:" / "Today:". #9, #10 "Ryan dropped out of tomorrow's 8:00 PM game (...)" / "tonight's game", and with late fees on "Ryan owes $14." when the drop made a debt
  (a drop by someone who had already paid says nothing about owing: their $14 stays on the game). #11 "Tomorrow's 8:00 PM game has 4 now, it's on." #12, #13 unchanged. #15 the test alert shows the new sample when the switch is on for everyone.
- Quick check `mayAlertSoon` knows the two moved times (and the 24-hour window), proven by a full 5-minute sweep with a 24-hour cancel-by, a 6:30 AM game, a Waitlist game and a clock-change day.

### OFF changes nothing (proof)
`tests/texts-r2.test.ts`: every card, alert and quick check, every 5 minutes Oct 14 to Nov 27, is identical with `textsR2` false or missing; the existing golden-file and tick-speed
tests (unchanged) still pass; 48 hours of real ticks through `/api/cron/tick` send the same six alerts word for word with the switch off, and with `TEXTS_R2 = "off"` even if Settings is on; a phone's private link
never changes an alert; the text menu with the switch off is the old words, one line, to the numbers.

### Tests
- New `tests/texts-r2.test.ts` (see counts in the status below) and `e2e/texts-r2.cjs` (14, added to `npm run test:e2e`).
- Six existing test files lost the lines that called the removed wording.
- Known failures on main (not fixed): admin-cleanup 2, admin-motion "press" 1; eight other browser files fail on any day after Nov 3 because they assume the first real game has not happened.

### Status (Wed Nov 4, 2026, about 10:50 AM Eastern)
- Type check clean; production build clean. Unit: 1,873 passed, 1 skipped, 0 failed (100 files; before: 1,803 in 99; 73 new in `tests/texts-r2.test.ts`, 3 removed with the dead wording).
- Browser, every file one by one: new `texts-r2` 14 of 14; `texts` 52, `cancel-reason` 8, `late-fees` 19, `do-now` 13, `alerts` 52, `player-fix1` 30, `pay-sheet` 23, `run` 229 all green. Known failures, not fixed: admin-cleanup 2 (same two fail on a clean `origin/main`), admin-motion "press" 1. The
  files that assume the first real game has not happened fail for that same reason (circles, money-visible, good-news, audit-player-flows, admin-audit, motion, layout-polish; popup printed nothing). `run.cjs` (2) and `round2.cjs` (1) failed once while the unit suite ran at the same time and pass alone (229 and 25).
- Fresh reviewer (did not write the code): no leak with the switch off, no high-severity bug. One real finding fixed: the Moved text named the old day as "Tue Nov 3" even when it was tomorrow. Left for Alex to decide: the fee-kept cancel text puts "Sorry about that!" before
  "You can pay on the site:" so the address can end the text; a same-day finalize says "tonight" / "today"; #5 and #7 still fire for a Waitlist game.
- Preview (fake database, re-seeded): https://preview-texts-r2.pickleball-club-9h0.pages.dev (deployment dae5d4f5, branch preview-texts-r2). Not on production. No Telegram secret exists on previews, so no alert can reach Alex's chat.
- To ship (never in loud hours; quiet window Fri to Mon before 6:00 PM, or Wed 6:00 AM to 6:00 PM, and only after "ship it"): PR, full unit suite, SQL export and Time Travel bookmark, `npm run deploy` from main with TEXTS_R2 allowed and the Settings row OFF, read-only live check. Rollback: the Pages deployment live at that time. No migration, no data change.

### Change after Alex's answers (Wed Nov 4, 2026)
Check-in and Need players: the back-out line and the join line say "tonight" when the game is tomorrow or today, and "early" for a game further out ("Need to back out? Do it early to avoid cancel fees." / "Want in? Join early, otherwise we'll have to cancel."). Everything else unchanged; the other answers (6:55 AM, fee-kept order, "tonight"/"today" on game night, #5 and #7 left as they are, no line for a paid dropper) needed no change. Unit 1,873 passed (100 files), `e2e/texts-r2.cjs` 14 of 14, `e2e/texts.cjs` 52 of 52. Same preview address, redeployed.

### Deployed (Wed Nov 4, 2026, about 12:30 PM Eastern, quiet window)
- PR #81 merged (main `58e464d`). Full unit suite on main: 1,873 passed, 0 failed. Deployed with `npm run deploy` from main: Pages deployment `30dd77c6-e3de-419b-b384-03dab1fb5585`. **`TEXTS_R2` is allowed in `wrangler.toml` but the Settings row is OFF, so nothing visible or audible changed.** No migration, no data change.
- Restore points taken right before the deploy: SQL export of the live database (541 lines, has phone numbers, kept in the session scratch folder, not committed) and Time Travel bookmark `000006ef-00000000-00005119-36590f19dd52036a3144d543d9cac702` (good for 7 days).
- Rollback: Pages deployment `41880b8d-f4a5-49ad-bc67-2ce4b68a39c4` (commit 3348081, live until this deploy). To undo only this feature with no deploy: it is already off; to force it off even if someone switches it on, set `TEXTS_R2 = "off"` in `wrangler.toml` and deploy. Database restore is not needed (the only stored thing is one optional `task_log` row).
- Read-only live check: the new deployment and the `pickleball-club-9h0.pages.dev` alias answer (home 200, group "Pickleball Bros", admin page 200, the clock endpoint answers 404 without its secret). `pickleball.juncaj.net` itself could not be reached from the build sandbox (its network only reaches Cloudflare's own addresses), so that address was not checked from here. The clock Worker was not changed.
- Next, Alex's call: try `/admin?textsr2=on` on his phone (texts and cancel sheet only), then switch Settings > Feature switches > "Texts and alerts, round 2" on for everyone in a quiet window (Fri to Mon before 6:00 PM, or Wed 6:00 AM to 6:00 PM, never the hour after he texts the group). The Telegram alerts change only then.

## Late-cancel fee split (LATE_FEE_SPLIT) (Wed Nov 4, 2026) - LIVE with the switch OFF for everyone (deployed Wed Nov 4, 3:47 PM Eastern)

Zip "latefeesplit" (START_HERE, SITE_RULES with the new PREVIEW SWITCHES RULE). Built on main `58e464d` (TEXTS_R2 merged). **Changes money.** Ships OFF behind
ONE new switch `LATE_FEE_SPLIT` (needs `LATE_FEES` on): `wrangler.toml` kill switch (production and preview), Settings > Feature switches > "Late-cancel
fee split" (one `task_log` row `late_fee_split_on`), private link `/admin?latefeesplit=on` (header `X-Late-Fee-Split`). **No schema change, no migration.**

### What the site did before (read in the code, then run on it with the switch absent; Alex in, $14 flat, $48 court)
1. 4 in, 1 leaves late: leaver owes $14 (late drop), the 3 others still owe $14 (game on). 2. 4 in, 2 leave: both leavers owe $14. 3. 5 in, 1 leaves: leaver
owes nothing (credit back), game on at 4. 4. 5 in, 2 leave: first free, second owes $14. 5. 6 in, 3 leave: only the third owes $14. 6. 5 in, fee kept: each of
the 4 others owes $14 (players cover $56 of $48, you cover $0). 7. 6 in, fee kept: 5 others x $14 = $70 for $48. 8. 6 in, waived: all $14 back as credit, nobody
owes. 9. Unpaid: owes $14. 10. Waitlist: owes nothing, paid waitlist money comes back. 11. Subs clear the oldest late-drop debt. 12. Money (6 in, 4 paid): collected
$56, court $48, net +$8, but the bottom line read "Nothing played yet". 13. LATE_FEES off: a late cancel gives everyone $14 credit.

### The rule as built
- A cancel inside the 12 hours answered **No** to "Did the venue waive the fee?", with the switch on for that tap: N = everyone confirmed at that moment (the
  organizer counted when in, like Finalize; not the waitlist). N of 5 or more: every seat in owes `finalPrice($14, N)` (the played-game function): 5 $11, 6 $9,
  7 $8, 8 $7, 9 $6, 10 $5. N of 4 or fewer: unchanged.
- Stored on the canceled game: `sessions.final_price_cents` (the split price) and `final_played_count` (N). A canceled game is never finalized, and every other
  reader of those columns reads them only when `finalized_at` is set (checked by both reviewers), so nothing else sees them.
- Money moves in the cancel's own batch (`splitSeatStatements` in `server/credit.ts`): a seat keeps exactly the split price; above it comes back as credit, cash
  first ("$5 back from Nov 3 (canceled)"), then held cash, then credit used on it (those credit entries end as 'canceled' and one new entry holds what stays). An
  unpaid seat owes the split price minus credit on it. The batch goes ahead only if nothing on the game changed since it was read (Finalize's money check plus
  the live credit ids, read before the seats), else "This game just changed. Look again." and nothing moves.
- An "I paid" not confirmed at the cancel waits; Mark paid then applies the split to it (difference back once). Unmark: owes the split price.
- After the cancel every seat is an ordinary seat at the split price, so Clear, Unmark, Use credit, I paid and Mark paid work unchanged (Clear gives back what is
  left: $5 + $9 = $14, never more).
- Reopen: a normal $14 game again. The split price goes; a seat paid $9 owes $5 (its cash held as a 'cash' pair, like a Reopen after Finalize), which the $5 they
  got back covers with Use credit. Reopen waits while an "I paid" at the split price is not confirmed.
- Late drops ($14 when they leave fewer than 4), no-shows, subs, the waived answer and the waitlist are untouched. With 5 or more in at a cancel there can be no
  open late-drop debt (each new seat clears one).
- Shown: cancel sheet "No: the fee is kept. 6 are in, so everyone signed up owes $9 (anything paid above that comes back as credit). Late drops still owe $14.";
  the Heads up text says "your $9 share" (old and round 2 wording, otherwise the same words); the canceled card and Money notes "6 were in, so everyone who was in
  owes $9"; History "canceled ... (venue did not waive the fee: 6 were in, everyone in owes $9)", "Casey got $5 back as credit ... (canceled late, fee split)",
  "Blair owes their $9 (canceled late, fee not waived)"; the player's canceled card "Your $9 stays on this game."; per-game court: players cover $45, you $3.
- Money month: split games count for the bottom line ("You covered $3 of the court costs" instead of "Nothing played yet"). Only split games, so off = as before.

### Tests
- New `tests/late-fee-split.test.ts` (35): cases 1 to 13 with the real pricing function, credit-paid, part credit, credit above the price, Use credit, I paid
  confirm and Unmark, Clear, second tap, a payment landing mid-cancel, Reopen then Finalize, the switch (Settings, header, kill switch, needs LATE_FEES), texts.
- `tests/late-fee-split-review.test.ts` (11) and `tests/late-fee-split-review2.test.ts` (8): written by the fresh reviewer. `tests/preview-seed.test.ts` +1.
- New `e2e/late-fee-split.cjs` (6, added to `npm run test:e2e`): Settings row off at ship, title on one line at 320 / 360 / 430, light and dark; the real
  cancel at 360 light and 430 dark (also with texts round 2); switch off = $14.

- Unit: 1,920 passed, 1 skipped, 0 failed (102 files). Type check and production build clean.
- Browser, one file at a time: late-fee-split 6, late-fees 19, texts-r2 14, cancel-reason 8, do-now 13, credit 153, admin-r2 27, admin-v2 27, admin-r3 15,
  pay-always 12, pay-sheet 23, texts 52, round2 25, run 229, player-fix1 30 all green. Known failures as on main: admin-cleanup 2, admin-motion "press" 1. In the
  first pass run (4) and player-fix1 (1) failed; both pass alone on this branch and on a clean main (one-offs from the run order, as noted before).

### Cancel, then Reopen (Alex's question, Nov 4; read in the code and run, nothing changed)
Nobody loses a spot: every seat keeps its status (in stays in, waitlist keeps its order). Money: an early cancel, or a late one the venue waived, turns what
was paid (cash or credit) into credit; Reopen puts those seats back to "$14 due" and the credit stays in the pot, so each of them taps Use credit (or Pay). A
late cancel with the fee kept moved no money, so after Reopen paid stays paid. Proposed (not built): on Reopen, put each seat's credit back on it
automatically, up to the price, the way I'm in does. Alex (Wed Nov 4): do NOT build it, leave it as is (they tap Use credit). A later idea only.

### Fresh reviewer (did not write the code)
Round 1 found three real bugs, all fixed with a test each: (1) a split game reopened and canceled again at a lower price kept $2 too much from a seat whose cash
was held (8 in: Casey should get $7 back, got $5); (2) an "I paid" at the split price still unconfirmed at Reopen could end as a $9 payment on a $14 game (Reopen
now waits for it); (3) two narrow races (a payment between the reads; an equal credit swap) could leave a seat at the wrong amount (the check is read first and
includes the credit ids). Also: the History data is unchanged with the switch off. Round 2 on the fixes: no money bug or race; a second Reopen tap at the same
moment now answers "already done". Left for Alex: Unmark after a split keeps the $5 credit (a plain cancel has the same gap today).

### Preview (Wed Nov 4, 2026, about 1:40 PM Eastern)
https://preview-late-fee-split.pickleball-club-9h0.pages.dev (deployment 726246b5), fake database re-seeded. Switches on there from the seed, no link needed:
"Late drops owe $14" and "Late-cancel fee split" (PREVIEW SWITCHES RULE; list in `scripts/seed-preview-world.ts` `PREVIEW_SWITCHES_ON`), plus every
wrangler.toml switch. The live list of Settings switches that are on could not be read from here (live reads are blocked), so only LATE_FEES is copied (the brief
says it is on). The "Fee split test" game is Wed Nov 4, 11:45 PM; after that, re-seed. Not on production.

### To ship (after "ship it", quiet window only: Fri Nov 6 to Mon Nov 9 before 6:00 PM; NOT Wed 6:00 PM to Thu 11:00 PM)
PR, full unit suite on main, SQL export and Time Travel bookmark, `npm run deploy` from main with the Settings row OFF, read-only live check (`/api/admin/dashboard`
`lateFeeSplitForAll: false`, health checks 0). Rollback: Settings row off (no deploy); code: the Pages deployment live before it. If a split cancel was ever made,
its seats are ordinary seats at the split price, so old code shows them correctly except the stored price (it would read $14 owed on an unpaid seat): Clear or
settle those first.

### Alex's answers (Wed Nov 4, about 3:00 PM Eastern)
1. Cancel then Reopen: leave it (they tap Use credit). Auto credit on Reopen stays a later idea, not built.
2. Live switches ON for everyone: New admin layout, Admin screens round 2 and round 3, Ask for payment on every game, No Venmo? note, Motion, Motion admin,
   Moved-game notice (TIME_SHIFT), Late drops owe $14, Player screen fixes, Pay sheet, Texts and alerts round 2. Every name exists in the code. MOTION and
   MOTION_ADMIN are wrangler.toml switches only (no Settings row), already "on" in `[env.preview.vars]`, like every kill switch. The other ten are Settings rows
   (task_log), which wrangler.toml only allows: `PREVIEW_SWITCHES_ON` in `scripts/seed-preview-world.ts` now writes all ten plus `late_fee_split_on` on every
   re-seed (`tests/preview-seed.test.ts` checks all eleven). On the running preview they were switched on through its own Settings endpoints (no re-seed, so
   Alex's taps were kept). No redeploy was needed (no site code changed).
3. Unmark keeping the $5: OK, written under known gaps in `FEATURE_SWITCHES.md` (with 4).
4. Monthly Collected counts only what was paid: OK.
- "Ship it" expected Fri Nov 6 morning. Do not deploy before then. Keep the preview up.

### Deploy (Wed Nov 4, 2026, 3:47 PM Eastern) - LIVE with LATE_FEE_SPLIT OFF for everyone
- Alex: "Ship it now" (Wed before 6:00 PM, a quiet window; replaces the earlier "not before Friday"). PR #82 merged as `4014f51` (same tree as the tested
  branch `bb967c0`). Live before: Pages deployment `30dd77c6-e3de-419b-b384-03dab1fb5585` (commit 58e464d), so main equaled live.
- Tests on main before the deploy: type check clean; unit 1,928 passed, 1 skipped, 0 failed (103 files); production build clean.
- Restore points: SQL export `live-before-late-fee-split-2026-11-04.sql` (333 INSERTs, has phone numbers, not committed, in this session's scratch folder),
  3:38 PM. Time Travel bookmark `00000716-00000000-00005119-50485a3498848e847b1cb21bf67115fa` (3:38 PM).
- Production deployment `49be2ad5-94a9-4294-a9f8-2e830e37403d`, branch main, commit 4014f51. No migration, no database change, the clock Worker untouched.
- Read-only live check after (backup address; pickleball.juncaj.net is not reachable from this session): /, /admin, /api/status, /api/group/version 200; the new
  bundle `index-CYaPukY7.js` is served; `PUT /api/admin/late-fee-split` and the dashboard 401 without a sign-in; health checks all 0 (`info_open_late_fees` 0);
  no `late_fee_split_on` row (OFF), `late_fees_on` present; no game holds a split price; row counts equal the export (players 11, games 11, seats 23,
  credit_ledger 5, task_log 26, migrations 16).
- Turn it on (Alex, Fri in a quiet window): Settings > Feature switches > "Late-cancel fee split". Private test first: `/admin?latefeesplit=on` (writes real records).
- Rollback: Settings row off (no deploy). Code: redeploy Pages deployment `30dd77c6-e3de-419b-b384-03dab1fb5585` (commit 58e464d); with the switch off the new
  code writes nothing new, so no data restore is needed. If a split cancel was ever made, settle or Clear those seats before rolling back the code. Whole
  database: `npx wrangler d1 time-travel restore pickleball --bookmark=00000716-00000000-00005119-50485a3498848e847b1cb21bf67115fa` (3:38 PM).

## Money page rework (MONEY_REWORK), built Wed Nov 4, 2026 - ships with the switch OFF

Spec: the "zip 4" brief (`START_HERE.md` and the approved mockup), then three rounds of Alex's phone tests on the preview (rounds 1 to 3 and the Text all
fix), all approved. PR #83. No database change, no migration. Admin screens only: no player screen, money rule, amount, seat or credit changes. The full
description of what the switch does is its row in `docs/FEATURE_SWITCHES.md`.

### What it does (only with the switch on)
Money tab (month box with a list of every month, Games | Totals, cards, Previous games, two Totals cards), instant taps with rollback, Hide from list (only
games with no money; money is never hidden; hidden games send no Telegram or clock alerts), Hidden games in Settings > Advanced, Edit charge, the cancel
sheet's "Were you charged?", the Remind sheet with Text all (one message addressed to everyone who owes and has a number, re-read from the server at the
tap), the tidier Feature switches page, the quieter History, and shared color tokens (paid, owes, credit, texting) used on the Money screens only.

### Different from the mockup (the brief won)
Fully paid games go to Previous games (no green card). No "Later games" card: games more than 7 days out are not listed on the Games tab of the current
month (their court still counts in Totals projected). Restore, not Unhide. Hidden games leave Totals, but only a game with no money can be hidden.

### Decisions Alex made
Projected = booked games still coming plus played-but-not-finalized games, at what their players would pay today. Edit charge to No drops what players paid
from the new Totals (the old Totals still count it). Membership counts for the current month always, and for another month only once a game is owed.

### Tests
Unit and API: 2034 passed, 1 skipped, 0 failed (110 files), including `tests/money-rework.test.ts`, `money-rework-ui`, `money-rework-optimistic`,
`money-rework-split` (fee split totals, Edit charge with the split, the clock around a hidden game) and three reviewer files from the first review.
Browser: `e2e/money-rework.cjs` 35/35 on the final code (added to `npm run test:e2e`). Regression browser files run again before ship: see the deploy notes below.
Two independent reviewers (neither wrote the code): the first found 3 real bugs (old Activity wording changed with the switch off; the server did not refuse
hiding a game with an open late fee; so-far membership on a future-only month), all fixed with tests. The final review is in the deploy notes below.

### Preview data
`docs/PREVIEW_FAKE_DB.md`: ten older months of played games (Dec 2025 to Sep 2026), a canceled test game to hide, previous games, mixed payments, an all-paid
game, and "Owes, one no number" (Reese has no phone number) for Text all. Late-cancel fee split is on in the preview because it is on live.

### To ship (rules from Alex: no deploy, switch-on or live database change from 6:00 PM Wed to 11:00 PM Thu; deploy after 11:00 PM Thu Nov 5)
1. Merge PR #83 to main, pull, `npm test`, confirm main equals live plus this change.
2. SQL export (`npx wrangler d1 export pickleball --remote --output live-before-money-rework-2026-11-05.sql`, kept out of git) and Time Travel bookmark
   (`npx wrangler d1 time-travel info pickleball`).
3. `npm run deploy` from main with `MONEY_REWORK` allowed and the Settings row OFF. No migration.
4. Read-only live check: pages answer 200, the integrity checks read 0, no `money_rework_on` row in `task_log`.
5. Do NOT switch it on for everyone. Alex tests with `/admin?moneyrework=on` and switches it on himself in a quiet window.
Rollback: Settings > Feature switches > "Money page rework" off (no deploy); kill switch `MONEY_REWORK = "off"` and a deploy; or the previous Pages deployment
(listed in the deploy notes). Nothing in this change writes new kinds of data except `task_log` marks (hide, switch) and `admin_audit_log` entries
(`charge_edited`, `session_hidden_from_list`, `session_shown_in_list`), so no data restore is needed to undo it.

### Final independent review and last tests (Wed Nov 4, about 9:30 PM Eastern, before the deploy window)
A fresh reviewer (did not write the code) went over the final diff for money totals, hide rules, instant-tap rollback and Text all. Money totals, the
hide rules and the instant-tap rollback were found correct (hand-computed totals, 40 random games with fees and the split, Eastern month edges, switch off
byte-identical to main). It found three real bugs and one risk, all fixed with tests (`tests/review-final-*.test.ts`):
1. Text all quoted $14 on a game canceled late with the fee split (each owes $11): it now quotes the price on the owing seats.
2. Moving a hidden game to another day cleared its hide: the hide now survives the move.
3. A month older than the dashboard's 90 days showed "No games" although the month list counted games: such a month now loads on its own
   (`GET /api/admin/month-games`, organizer only, read only, needs the switch on).
4. The last Mark paid on a card could pop the next game open under the finger: which game starts open is now decided once per month on screen.
Last runs: unit and API 2059 passed, 1 skipped, 0 failed (110 files). Browser: money-rework 36/36, admin-r2 27, admin-v2 27, admin-r3 15, late-fees 19,
late-fee-split 6, do-now 13, credit 153, cancel-reason 8. `e2e/texts-r2.cjs` shows 4 failures when run at night (10 of 14 pass): proven identical on untouched
main 4014f51 at the same hour (it reads the real clock and expects "tonight/tomorrow" wording from the time of day), so not caused by this change.
`tests/held-drop-fuzz.test.ts` seed 136 failed once under heavy CPU load and passes alone (twice) and in the final full run.

### Deploy (Thu Nov 5, 2026, about 7:05 AM Eastern, on Alex's "deploy now": no traffic, the group had not been texted)
- PR #83 merged as `13cdd3b`. Production deployment `206e5b1f-55d2-4fdf-a2b8-06e4cab861dc` from main with `MONEY_REWORK = "on"` (allowed) and the Settings row OFF
  (no `money_rework_on` row in `task_log`). No migration. The 11:10 PM scheduled run was deleted so it could not deploy twice.
- Before it: main equaled live (production `49be2ad5-94a9-4294-a9f8-2e830e37403d` = 4014f51). SQL export `live-before-money-rework-2026-11-05.sql` (not committed, has phone
  numbers, in that session's scratch folder), Time Travel bookmark `000007db-00000000-0000511a-54554262ab42b933845dbb63bb4505a4` (7:03 AM Eastern).
  Integrity checks: all 21 columns 0 before and after (info lines 0).
- Tests on merged main: tsc clean, unit and API 2059 passed, 1 skipped, 0 failed, build clean.
- Read-only live check (pickleball-club-9h0.pages.dev; pickleball.juncaj.net is not reachable from the sandbox): `/`, `/admin`, `/api/status`, `/api/group/version`
  answer 200; `/api/admin/dashboard` and `/api/admin/month-games` answer 401 without a sign-in; the live script is the same file as the local build
  (index-nM9Xj7Qj.js, 540,982 bytes) and holds the new Money page; row counts unchanged from the export (players 11, games 12, seats 23, credit 5); no hidden-game rows.
  (Two organizer actions logged at 7:05 and 7:06 AM, a move, a court booking and a settings save, are Alex's own, not the deploy.)
- Rollback: Settings > Feature switches > "Money page rework" off (no deploy; it ships off); `MONEY_REWORK = "off"` and a deploy; or Pages deployment `49be2ad5`
  (4014f51, the code before this). No data was changed by the deploy, so no restore is needed.
- Alex switches it on himself in a quiet window (Friday). To try it first on one phone: `/admin?moneyrework=on`.

## Instant taps (INSTANT_TAPS), built Thu Nov 5, 2026 - ships with the switch OFF (on a preview, waiting for "ship it")

Spec: the "zip 5" brief (`START_HERE.md`), plus one Money page rule Alex added the same day (below). One PR. No database change, no migration.
The full description of the switch is its row in `docs/FEATURE_SWITCHES.md`.

### What it does (only with the switch on)
A tapped button changes the screen in the same instant and the save runs in the background; a toast says it saved. A failed save (server
error, no signal) puts the screen back exactly as it was and a red toast says what failed. Where the server decides (a full game, late-drop
fees, prices, credit, Finalize, court and roster changes) nothing is guessed: the tapped button gets a pressed look and a small spinner at once.
- One shared helper: `src/instant.ts` (pure: TapQueue, SaveLine, LoadTracker), `src/InstantTaps.tsx` (the screen root, the toast, the pressed
  look, the page-wide double-tap guard), `src/pages/admin/action.ts` (the organizer's one "do this" helper, which replaced three copies),
  `src/playerPatches.ts` (the player-side guesses, each tested against the server's next answer). The Money page's own instant taps (Zip 4,
  `ReworkOps.tsx`) now run on the same helper; with the switch off they run exactly as built.
- Safety rules, once for every screen: a second tap on the same thing while it saves does nothing; taps on different things still work and
  reach the server in tap order (a save that never answers holds the next one at most 10 seconds); the second half of a quick double tap that
  lands on a different button is stopped; a Money row whose save is running keeps its place; a 5-second refresh that set off before a save
  is thrown away (`useLoad` with a tracker), and a saved tap's guess stays until fresh data is on screen (released after 15 seconds at the
  latest); a save that waited in line is not sent if the screen changed meanwhile (View as ended, another name).
- Settings: every switch snaps back to the server's value on a failed save, with a toast; the first session date goes back to the saved
  date; a second flip while saving is ignored. Text boxes keep what was typed, with "Couldn't save. Tap to retry." (Alex, Nov 5: never wipe
  typing; same as with the switch off).

### Money page rule (Alex, Thu Nov 5, under MONEY_REWORK which is ON live; no new switch)
A fully paid game moves to "Previous games" only once it is FINALIZED. Tonight's game where everyone already paid stays in the main Games list
(after the games somebody owes for) until it is played and finalized. Finalize moves it at once with instant taps on (a screen-only
`finalizing` mark, never sent by the server). Within a card, unpaid players stay above paid players (as before). Touches only the Money page
(`splitGames` in `src/pages/admin/moneyRework.ts`) and, with instant taps on, the Home Finalize button (pressed look). This rule is NOT behind
INSTANT_TAPS: it applies as soon as this is deployed (the Money page rework is on for everyone).

### Tests
- New unit and API files: `tests/instant-taps.test.ts` (the helper: success, failure rollback, double tap, ordering, polls, offline reload),
  `tests/instant-taps-api.test.ts` (the switch; the server saves exactly the same on or off; every player guess equals the server's next
  answer), `tests/money-finalized-rule.test.ts`, `tests/review-instant-queue.test.ts` (the reviewer's). Older Money placement tests updated to
  the new rule.
- Browser: `e2e/instant-taps.cjs` (slow network 2.5 s and a failing network 500 / no signal on I'm in, Drop out, I paid, Mark paid and a
  Settings switch: the screen changes at once, one request on a double tap, no flicker, exactly back on a failure, nothing saved; the pressed
  look within 100 ms; dark mode; the toast clears the tab bar; the Money rule). `e2e/instant-taps-off.cjs` runs today's main and this branch
  side by side on the same fake world and compares every screen's HTML with the switch off: identical apart from the new Settings row.

### Independent review
A fresh reviewer (did not write the code) found 7 issues, all fixed with tests: the "Anyone with the site address" box could end showing the
opposite of the server after two quick failing flips (now snaps to the last confirmed value, and the first session date rolls back too); the
double-tap guard did not cover every button (now one page-wide guard); "I paid" for several games said "Nothing changed" when some saved (now
"Saved for 1 of 2 games"); a queued save could act as another screen after View as ended (now not sent); Money rows held their place with the
switch off too (now only with it on); one stuck save could hold every later one (now 10 seconds at most); React's dev double mount turned off
the "drop the guess on the next good refresh" rule (now attached in an effect). Also: no credit amount is guessed outside the Money page
(Unmark and Unmark credit only show the button working); keyboard taps are never taken for a double tap.
Known and accepted: if a save works but every refresh fails for 15 seconds, the guess is let go and the screen shows the older data until the
next good refresh (the server has the tap; a second tap is refused by the server's own checks). The player stamp gained one switch, so every
phone reloads once after the deploy.

### Deploy (Thu Nov 5, 2026, about 12:06 PM Eastern, on Alex's written "SHIP IT NOW, LOUD HOURS OK" at about 12:00 PM)
- Last change before ship (Alex's answer): a Settings text box whose save fails keeps what was typed, with "Couldn't save. Tap to retry." (as
  before); browser test added. Unit and API on the ship commit: 2109 passed, 1 skipped, 0 failed (123 files). Browser: instant-taps 19/19,
  switch-OFF side by side with main 18/18 identical, admin-r3 15/15, admin-v2 27/27; the full browser run on the code before that last
  change: no new failures (known ones unchanged; texts-r2 14/14 in the daytime).
- PR #85 merged as `811c5c7`. Main equaled live before it (production `6edeadd4` = f0a2194). Production deployment
  `6fde6dc0-d40f-438b-a7db-a19889cc571d` from main with `INSTANT_TAPS = "on"` (allowed) and the Settings row OFF (no `instant_taps_on` row).
  No migration.
- Before it: SQL export `live-before-instant-taps-2026-11-05.sql` (362 rows, not committed, has phone numbers, in this session's scratch folder),
  taken 11:52 AM Eastern. Time Travel bookmark `0000081d-00000000-0000511a-7f65082f163368ea09df584ff02d8c07` (11:52 AM Eastern).
  Integrity checks: all 21 columns 0 before and after.
- Read-only live check (pickleball-club-9h0.pages.dev): `/`, `/admin`, `/api/status`, `/api/group/version` answer 200; `/api/admin/dashboard`,
  `/api/admin/month-games` and `PUT /api/admin/instant-taps` answer 401 without a sign-in; the live script is the same file as the local build
  (index-DLKG3Wl1.js, 552,980 bytes); the player view has no `instantTaps` (off for everyone) and the private header turns it on for that
  request; row counts unchanged from the export (players 11, games 12, seats 23, credit 5); `money_rework_on` 1 row, `instant_taps_on` 0 rows.
- Live with the deploy (not behind INSTANT_TAPS): the Money page rule, a fully paid game goes to Previous games only once finalized.
- Rollback: Settings > Feature switches > "Instant taps" off (no deploy; it ships off); `INSTANT_TAPS = "off"` and a deploy; or Pages deployment
  `6edeadd4` (f0a2194, the code before this; also undoes the Money rule). No data was changed by the deploy, so no restore is needed.
- Alex tests on his phone with `/?instanttaps=on` (and `/admin?instanttaps=on`) and switches it on himself.

## Zip 6: Adjust credit, Venmo request, tidy (built Thu Nov 5, 2026) - ships with both new switches OFF (on a preview, waiting for "ship it")

Spec: the "zip 6" brief (`START_HERE.md` and `SITE_RULES.md` in the zip, with three approved mockups). One PR. NO database change, no migration.
Switch descriptions are their rows in `docs/FEATURE_SWITCHES.md`. Built on a Thursday (loud hours): nothing deployed, nothing switched on, no live database touched.

### A. Adjust credit (`ADJUST_CREDIT`)
- The Edit sheet (the gear on a player row) has an "Adjust credit" row between the name form and Hide player. It opens its own sheet: Add or Remove,
  an amount box with chips $5 $10 $14, a required reason, "Credit after: $14 → $19", Save off until an amount and a reason are filled in.
- Rules (one place, `shared/adjustCredit.ts` `planAdjust`, used by the sheet and the server): whole dollars above $0, at most $500 at once, a reason,
  Remove never below $0 and never the credit a pending cash-out request is holding.
- Storage, no schema change: Add = one `kept` ledger row, Remove = one `used` row, no game, `credit_ledger.reason` = `adjusted:<why>` (the column is
  free text; `loadLedger` turns it into reason `adjusted` plus a note). Every pot formula (SQL and `potBalance`) already counts such rows, and every
  per-game formula looks only at rows with a game, so Use credit, drop-out returns, Finalize, cash-outs and Totals are untouched (tests below).
- Safety: `adjustCreditEntry` (`server/credit.ts`) is ONE guarded insert: it only goes in while the pot is exactly what the sheet showed (`seen`) and a
  Remove only within pot minus the cash-out hold. A double tap, a second phone or a stale screen adds nothing ("Their credit just changed. Look again.").
- Player: "Credit adjusted by organizer: +$5" and the reason on the pay card and the credit sheet (adjustments newer than 14 days) and in the credit list.
- Organizer: the player's sheet shows "Harper: credit +$5 / $19 now / Adjusted by organizer, Thu 12:00 PM / Reason: ..." and the Activity log has a line.

### B. Venmo request (`VENMO_REQUEST`)
- `shared/venmoRequest.ts` (changed after Alex's phone test, Thu Nov 5: the plain `venmo.com/USER?...` link showed "+" in the note): built like the player's Pay link,
  `venmo://paycharge?txn=charge&recipients=USER&amount=14&note=Pickleball%20Tue%20Nov%203` on a phone with `https://venmo.com/?txn=charge&recipients=USER&...` as the fallback
  (`openVenmo`, the same function Pay uses), real %20 encoded once, one account per link, only for a saved
  USERNAME (a player saved only as a Venmo id link has no button), nothing owed = no link. The amount is each person's `owesCents` at that moment.
- Three places: the Remind sheet ("Venmo request ↗" before the purple Text), a Home card per game on its game day or after ("Thu game: 3 haven't paid",
  Remind, a request per person, "no Venmo saved" for the rest; a canceled-late game that still owes shows too, "$11 each"), and "Request ↗" next to Mark
  paid on Money rows (13 px, 34 px high). The Home card is NEW next to the existing "Mark paid tonight / Who owes you" cards (they stay as they were).
- Only the live Money page (the rework) and the Remind sheets carry the links; the older Money layouts (ADMIN_V2 / ADMIN_R2 rows) get only the Remind sheet link.

### C. Tidy
- MOTION and MOTION_ADMIN had no Settings row at all (only wrangler.toml and private links). They now have rows "Animations, players" and "Animations,
  organizer" in Settings > Feature switches. They start where wrangler.toml has them (both on); a flip is one `task_log` row that only exists while it
  differs from wrangler.toml. Behavior with nobody touching a row is unchanged (tests).
- 320 px: every organizer and player screen was swept (no sideways scroll, nothing spilling, short labels on one line). Real problems fixed, CSS only:
  a long name (Christopher Vanderberg) squeezed to a few letters next to "Request" and "Mark paid" or "Venmo request" and "Text" (now the name gets the line
  and the buttons drop below it), "Save adjustment" splitting in two, "$28 owed" splitting in two, and the time of a same-day game wrapping badly on a Money
  card (the time now sits on its own line above "2 of 5 paid"). The last two apply with the switches off too (checked: nothing else changes). Still wrapping
  on purpose: long Settings field labels ("Cancellation deadline for new sessions (hours before play)").

### Different from the brief or the mockups
- Words: "Can't remove more than the $14 credit Harper has." uses the player's name (the mockup said "he"; nobody's pronouns are guessed).
- The gear "sheet" in the mockup is a menu; the real one is the Edit form, so Adjust credit is a row under Save and above Hide player.
- "Adjusted by organizer" says organizer, not the organizer's name.
- The Home card is a new per-game card (the mockup's), not an addition to the existing owed cards.

### Tests
- Unit: `tests/adjust-credit.test.ts` (rules, switch, ledger, math after an adjustment, wording), `tests/venmo-request.test.ts` (link, %20, amount per person,
  no button without a username, switch), `tests/motion-settings.test.ts` (unchanged until touched, rows, stamp). Seed test updated for the new fake games.
- Browser: `e2e/zip6.cjs` (Settings rows, the sheet, the three Venmo placements, 390 / 360 / 320 px, light and dark) and `e2e/zip6-off.cjs` (today's main and this
  branch side by side with both switches off: every screen, sheet and tap identical apart from the four new Settings rows; needs `MAIN_DIR`, not in `npm run test:e2e`).

### Added the same day (Alex): canceled game box, and Home collapse (`HOME_COLLAPSE`)
- **Canceled game under LATER (no switch, visual only):** a canceled game in the LATER list was drawn as a full box with sharp corners (the rule that gives
  a canceled card its thin border, `.schedule > .sched.off` in `src/player-cards.css`, also hit the flat LATER rows). Now `.schedule > .sched.tier-later.off`
  is a flat row like its neighbors: no box, the same thin line, the same margins. The label's color and wording are untouched. Only LATER rows had the box:
  canceled THIS WEEK / NEXT WEEK games are cards (rounded) on purpose, and the admin Home and Money canceled rows carry no such box (checked). Nothing canceled
  = no rule matches = every screen looks as before (`e2e/zip6.cjs` checks the computed style and margins at 390 and 320 px, light and dark).
- **Home collapse (own switch `HOME_COLLAPSE`, ships OFF, `/?homecollapse=on`, Settings row, ON in the preview):** see its row in `docs/FEATURE_SWITCHES.md`.
  `src/pages/PlayerHome.tsx` (`collapse`, `laterGames`, `laterShown`): the rows are the games the site calls THIS WEEK or NEXT WEEK (`weekTier`, untouched);
  later games are drawn only while the one button is open. With the switch off the old six-row list and "More sessions (N)" are exactly as before (`e2e/zip6-off.cjs`).

### Independent review (a fresh reviewer who did not write the code)
Found and fixed: (1) month Totals "Credits owed" moved after a hand adjustment (a Remove ate the oldest game's credit in the month split): hand adjustments
are now left out of that split in both directions, test added (an Add then a Remove changes nothing); (2) a player whose credit was taken to $0 (no chip, no
pay card) was never shown the note: Home now shows "Credit adjusted by organizer: -$5" and the reason (14 days) whenever there is no pay card to carry it;
(3) the Adjust sheet kept using the old balance after a "Their credit just changed" answer: it now follows the screen and reloads. Accepted and said: the 320 px
wrapping fixes for "$28 owed" and the same-day time on a Money card apply with the switches off too (CSS only, narrow phones only); the player change-stamp gained
two always-present segments (`motion`, `hc`), so every open player screen reloads once after the deploy.

## Deploy IDs for Zips 4, 5 and 6 (added with Zip 7, Thu Nov 5, 2026)
- **Zip 4: Money page rework (`MONEY_REWORK`).** PR #83, main `13cdd3b`, deployed Thu Nov 5, about 7:05 AM ET, deployment `206e5b1f-55d2-4fdf-a2b8-06e4cab861dc`, rollback (the build live before it, 4014f51) `49be2ad5-94a9-4294-a9f8-2e830e37403d`, Time Travel bookmark `000007db-00000000-0000511a-54554262ab42b933845dbb63bb4505a4` (7:03 AM ET). Switched on by Alex later that day.
- **Zip 5: Instant taps (`INSTANT_TAPS`) and the Money rule.** PR #85, main `811c5c7` (merged Thu Nov 5, 12:06 PM ET). Deployment ID: probably `6fde6dc0-d40f-438b-a7db-a19889cc571d` (unconfirmed; it is the deployment Zip 6 lists as its rollback, so the build live right before Zip 6). Rollback ID and Time Travel bookmark of this deploy: not recorded. Instant taps and the Money rule are live.
- **Zip 6: Adjust credit, Venmo request, Home collapse (all ship OFF).** PR #86, main `54dcdc6`, deployed Thu Nov 5, 5:39 PM ET, deployment `5f82c960-8c32-4049-8292-70a342b42f7a`, rollback `6fde6dc0-d40f-438b-a7db-a19889cc571d`, Time Travel bookmark `00000865-00000000-0000511a-5bf9637083cdc4ea5dad74063de3ddb7`.

## Zip 7: Tonight glow, Color cleanup, Simpler player cards (built Thu Nov 5, 2026) - ships with all three switches OFF (on a preview, waiting for "ship it")

Spec: the "zip 7" brief (`START_HERE.md`, `SITE_RULES.md`, three layout mockups). One PR. NO database change, no migration. Built on a game day (loud hours): nothing deployed,
nothing switched on, no live database touched. The full description of each switch is its row in `docs/FEATURE_SWITCHES.md`.

### What changed
- **Plumbing (items 1 to 18 ship OFF).** `TONIGHT_GLOW`, `COLOR_CLEANUP`, `PLAYER_CARDS_SIMPLE`: `shared/zip7.ts` (headers, kill-switch rule, `tileDay`), `server/zip7.ts` (the `task_log` rows, one per switch), three
  `PUT /api/admin/*-switch` routes, flags on the player view and the organizer dashboard, three Settings > Feature switches rows ("Tonight glow", "Color cleanup", "Simpler player cards", titles on one line), private links
  `?tonightglow=on`, `?colorcleanup=on`, `?playercards=on` (also on `/admin`), `wrangler.toml` kill switches (allowed; ON in `[env.preview.vars]`), Activity log lines, and a stamp piece that exists only while a switch is on.
  The page sets `<html data-tonight-glow | data-color-cleanup | data-player-cards>` (`src/zip7.ts`); every rule in `src/zip7.css` (imported last) sits under one of them.
- **A. Tonight glow.** Big date tiles only (player cards in every tier, organizer Home cards in all three layouts; Money list tiles keep the weekday). TONIGHT = a solid green BANNER across the top of the tile, flush with the tile's top edge and corners, replacing the weekday (light #1f6b45 / white, dark #4cc58a / #0d2a1b),
  with a slow pulse and a light sweep on the tile only (Alex, after the preview: it must be a banner, not a floating pill); TOMORROW = the same banner in soft green (9 px type; a tile too narrow for the word, which is about 58 px, says TOM: every organizer tile, the LATER row tile, and a tile of 80 px or less with the check badge; the word is always centered across the full strip and the badge sits mostly outside the tile, on top of the strip end) (light #dff0e6 / #1f6b45, dark #1c3a2a / #8be0b3), no motion. Open games only. "Tonight" and "tomorrow" are Eastern calendar dates
  (`playerDay`, DST safe). Reduce Motion: no animation (the band stays, the glow becomes a still soft ring). No Christmas decoration.
- **B. Color cleanup.** Tokens in one place (`--z7-*`, same values as the Money tokens). Waitlist gray (selected pill, hv2 pill, card border, banner, dot), Extra game gray outline (holiday purple tokens gray too),
  Canceled pill on a player card neutral GRAY with the row and its date tile dimmed to about 58 percent (Alex's option A), every `sms:` button and the gear Text button purple, credit blue on the header label and the "Credit $3 used" chip. Links stay blue. Cancel sheet: blurb removed, long line shortened.
- **C. Simpler player cards.** See the switch row. The status line of a card that is not yours is gone, so the count row leads.
- **D. Home collapse "Show fewer" (no switch).** `src/pages/PlayerHome.tsx`: a shared link to a later game held the list open, so Show fewer did nothing. A `laterFolded` flag lets Show fewer win (reset by "More sessions"
  and by the Can't-make-it jump). Only reachable with `HOME_COLLAPSE` on; with it off nothing changes. Item 20 is the section above.
- **Preview seed.** `scripts/seed-preview-world.ts` always leaves a game tonight and a game tomorrow (Eastern); the three switch rows are in `PREVIEW_SWITCHES_ON`.

### Cancel sheet wording (for Alex to OK; only with COLOR_CLEANUP on)
- Removed: "Players will see it as canceled, and reminders and payments stop for it."
- Old: "Yes: the fee is kept, and everyone signed up still owes their $14 (late drops too)." (with the fee split: "Yes: the fee is kept. 6 are in, so everyone signed up owes $9 (anything paid above that comes back as credit). Late drops still owe $14.")
- New: "Yes: the fee is kept. Everyone signed up owes $14." (with the fee split: "Yes: the fee is kept. Everyone signed up owes $9.")
- The older Money layouts' "No: the fee is kept..." lines (MONEY_REWORK off) are not changed.

### Tests
- Unit: `tests/zip7.test.ts` (tonight/tomorrow in Eastern time: midnight, UTC rollover, both DST changes, month and year ends; the three switches: header, Settings row, kill switch, stamp, log line, same-games-either-way; color tokens, contrast 4.5:1, every CSS rule under an `<html>` attribute). Seed test follows the new rows.
- Browser: `e2e/zip7.cjs` (pinned clock, so not today's real date: tiles and glow, Reduce Motion, 390/360/320 px light and dark, organizer Home, Waitlist and Extra gray, red Canceled pill before and after, purple Text, blue credit, Cancel sheet wording, card words, calendar icon, instant I'm in with a slow server, waitlist label, Show fewer, Settings rows)
  and `e2e/zip7-off.cjs` (today's main and this branch side by side with all three OFF: every screen identical apart from the three new Settings rows; needs `MAIN_DIR`, not in `npm run test:e2e`).

### Deploy (Fri Nov 6, 2026, 7:52 AM Eastern, quiet window, on Alex's "ship it now")
- PR #87 merged as `963f39f` (merge commit; same tree as the tested branch head `183c7a1`). Production deployment `ca890645-2495-4e96-8aef-b8dc437f4876` from main, with `TONIGHT_GLOW`, `COLOR_CLEANUP` and `PLAYER_CARDS_SIMPLE` allowed in `wrangler.toml` and all three Settings rows OFF (no `tonight_glow_on`, `color_cleanup_on` or `player_cards_on` row in `task_log`). No migration, no data change. Alex switches them on himself.
- Before it: main equaled live (production `5f82c960-8c32-4049-8292-70a342b42f7a` = 54dcdc6). SQL export `live-before-zip7-2026-11-06.sql` (not committed, has phone numbers, in that session's scratch folder), Time Travel bookmark `0000091c-00000004-0000511b-cf6d20db620d7974d89801478f4bb194` (7:51 AM Eastern). Integrity checks: all 21 columns 0 before and after (info lines 0).
- Tests on the merged tree: tsc clean, unit and API 2196 passed, 1 skipped, 0 failed (128 files), build clean. Browser: zip7 33/33, zip7-off 21/21 (all three OFF identical to main), zip6 28/28, instant-taps 19/19, money-rework 36/36. A fresh reviewer on the final diff found nothing blocking.
- Read-only live check (pickleball-club-9h0.pages.dev; pickleball.juncaj.net is not reachable from the sandbox): `/`, `/admin`, `/api/status`, `/api/group/version` answer 200; `/api/admin/dashboard` and `/api/admin/month-games` answer 401 without a sign-in; the live script is the same file as the local build (index-FvQIttVq.js) and holds the three new rows; the player view carries none of the three new flags (only the existing instantTaps and homeCollapse); row counts unchanged (players 11, games 12, seats 23). The Settings rows themselves need the organizer PIN, so their OFF state is shown by the empty `task_log` check above.
- Rollback: Settings > Feature switches, the three rows off (no deploy); or `TONIGHT_GLOW`, `COLOR_CLEANUP`, `PLAYER_CARDS_SIMPLE` = "off" and a deploy; or Pages deployment `5f82c960-8c32-4049-8292-70a342b42f7a` (Zip 6, 54dcdc6). No data was changed by the deploy, so no restore is needed.
- Follow-ups from the final review (all only visible with a switch ON, none blocking): (1) with Simpler player cards on, a venue-waitlist game that is also full says "I'm in" instead of "Join waitlist" (that state is turned into a normal game for players today, so it is unreachable); (2) the shortened Cancel line drops "Late drops still owe $14" and the credit-back note (Alex approved the wording); (3) the TONIGHT glow ignores the organizer's "Animations, players" switch and only follows the phone's Reduce Motion; (4) on the folded organizer Home row the 44 px tile may overflow TONIGHT by about 1 px; (5) the dimmed canceled tile text is below 4.5:1 on purpose (Alex's 58 percent).

## Zip 8: cleanup (read-only PIN, date-proof tests, reminder time, credit check, backups) - built Fri Nov 6, 2026; on a preview, waiting for "ship it"

Spec: the "zip 8" brief (`START_HERE.md`, `SITE_RULES.md`). One PR. NO database schema change, no migration. Built in a quiet window (Friday). Nothing deployed to
production, nothing switched on, no live data changed. Only reads of the live database (the switch rows in `task_log`). Zip 5 deploy ID stays "probably
`6fde6dc0-d40f-438b-a7db-a19889cc571d` (unconfirmed)".

### A. Read-only organizer PIN (`ORGANIZER_READONLY_PIN`, a Cloudflare secret; missing = off)
- `server/viewOnly.ts`, `server/auth.ts`, `server/app.ts`. Tried only after the real PIN fails, inside the same counted attempt (same lockout: 5 per phone,
  20 overall, 15 minutes). Its own sign-in: `admin_sessions.id` starts `ro:<fingerprint of the secret>:`, the cookie value starts `ro.` (the stored hash
  covers the prefix), 12 hours. Changing or removing the secret ends every view-only sign-in at once. A PIN change signs it out too. The real PIN can never
  be changed to the read-only one.
- Every POST, PUT, PATCH and DELETE from a view-only phone gets 403 `view_only` "View only. Nothing was saved." before any route runs (sign in and sign out
  excepted), with a second check in `requireAdmin`. Its GETs run on `viewOnlyDb` (only plain SELECTs reach the database, a batch of reads really runs, no
  Telegram alert can be sent), so even the dashboard's upkeep (adding next weeks' games) does nothing. Its backup download has the PIN hash and the group word
  hash blanked (fresh reviewer: a 6-digit PIN can be guessed from its hash offline).
- Screens: a small "View only" label next to the title (`src/view-only.css`, light and dark, 4.5:1). Refused saves show the calm note, never a red error
  (Settings switches snap back). The dashboard answer gains `viewOnly: true` only for that sign-in; for the real PIN it is unchanged.
- Secret set Fri Nov 6 (Alex's OK) on the Pages project, production and preview (8 digits, given to Alex only; not in git). Checked on the preview: sign-in 200, `viewOnly: true`, a save 403, backup PIN hash blank. Live starts using it with the Zip 8 deploy.
### B. Date-proof tests
- `e2e/fixed-clock.cjs` pins the server clock and every page's clock. admin-cleanup, admin-motion, texts-r2, player-fix1, circles, money-visible, good-news,
  audit-player-flows, admin-audit, motion, layout-polish, popup, pay-always (and pay-sheet through layout-lib) all start from a fixed moment. Before, on Fri Nov 6 08:21 to 08:54 AM:
  circles 10/8, money-visible 2/10, good-news 8/1, audit-player-flows 85/8, layout-polish 195/5, popup crashed after 11, admin-motion 27/1, admin-audit 10/1.
  After: all pass. admin-audit check 15 found a real layout bug (the X on a dismissible "Need players" card overlapped a long date line at 320 px): fixed
  on Alex's OK (Nov 6) without a switch, CSS only, `.dismissible > .sg-when` gets the same right room as the line above (`src/do-now.css`); 11/11 now.
- `tests/held-drop-fuzz.test.ts` seed 136: the test's I'm in did not wait for a drop already on its way (the real screen does). Fixed in the test; seed 136
  8 of 8 under a slowed hash, all 2,000 seeds clean.
### C. Finalize reminder at 10:30 PM
- `shared/tasks.ts` `finalizeDueMs`: 10:30 PM on game night, Eastern wall clock, or 5 minutes after the end if that is later. One time value, no switch. It
  moves the Telegram alert and the "Do this now" Finalize card together (same due time); the separate Home "Finalize" card (`needsFinalize`) still shows as
  soon as the game is over. Wording unchanged. The 5-minute tick's quick check follows it. Tests across both clock changes (`tests/finalize-reminder.test.ts`);
  the six-week sweep golden changed only on the four finalize lines (9:05 / 9:35 / 10:05 PM to 10:30 PM), every other card identical to main at every tick.
### D. Credit chain (verified, no money change)
- `tests/credit-chain.test.ts`, through the real API: $14 at 6 played ($9, $5 back), $5 credit + $9 cash at 5 played ($11, $3 back), $3 + $11 at 7 ($8, $6 back),
  $6 + $8 at 4 ($14, $0 back). Credit after each: $5, $3, $6, $0. Cash paid $42 = prices $42. Nothing lost, doubled or negative. Same with the organizer playing.
### E. Last call alert (`LAST_CALL_TEXTS`, ships OFF)
- Today (live, Texts round 2 on): the night-before alert links to the direct text page, which opens Messages with no recipients. 4 or more: "5 in so far. Want in?
  Join now." 3 or fewer: "3 in, need 1 more. Want in? Join tonight, otherwise we'll have to cancel." Neither asks "still in?" nor says "to avoid fees".
- With the switch on: "5 in so far. Is everyone still in? Anyone else in?" and "3 in. We need 1 more or tomorrow's game is canceled to avoid fees. Want in? Join
  tonight." (`shared/lastCall.ts`). Settings row "Last call texts", `/admin?lastcall=on`, kill switch in `wrangler.toml`, Activity lines, `docs/FEATURE_SWITCHES.md`.
### F. Cleanup
- On Alex's OK (Nov 6): deleted the 47 old preview deployments (Zips 1 to 7; kept the 90 production deployments and preview-zip8). The 22 merged
  branches could not be deleted from this session (its GitHub access only pushes its own branch); Alex deletes them on GitHub. Nothing else touched.
### G. Weekly backup
- New private D1 database `pickleball-backups` (id a532f080-7535-4d4d-8067-62ab6af928e4, free). The clock Worker (`worker/backup.ts`, `worker/cron.ts`) looks once
  an hour, after its knock, and on Sunday from 3:00 AM Eastern (or when the newest copy is over 8 days old) saves the same file Settings > Backup gives, in pieces,
  keeping the newest 8. The live database is only read, through a read-only wrapper, in one batch. Restore: `docs/RESTORE.md`, "Weekly copies"
  (`scripts/weekly-backup.mjs list` / `get`). R2 was not used: this token cannot reach R2, and the free plan's 5 cron triggers are all in use.
- Run for real in Cloudflare's local runtime on fake data: 381,515 bytes in 5 pieces; a second tick the same hour made no second copy. The Worker deploy waits for "ship it".
### H. Notes
- The deploy records left on notes-only branches (Oct 30 clock, layout polish, late-fee reminders, PLAYER_FIX1 / PAY_SHEET, TEXTS_R2, LATE_FEE_SPLIT, Instant taps,
  Zip 7) are now in this file.
### Tests
- Unit: see the PR. New: `readonly-pin`, `credit-chain`, `finalize-reminder`, `last-call`, `weekly-backup`. Browser: `e2e/zip8.cjs` (4/4).
- Fresh reviewer (did not write the code): 1 blocker (the PIN hash in the view-only backup) and 2 should-fix (knock and copy in the same run; some red toasts), all fixed
  with tests; also fixed from its notes: secret rotation signs helpers out, one-batch snapshot, the Worker's live database wrapped read-only.

## Zip 9: short games (1.5 hour games), time line under the date, Calendar | Directions button - built Fri Nov 6, 2026; on a preview, waiting for "ship it"

Spec: the "zip 9" brief (`START_HERE.md`, `SITE_RULES.md`, four mockups). One PR. NO database schema change, no migration (a game's length is End
minus Start). Built in a quiet window (Friday). Nothing deployed to production, nothing switched on, no live data changed. Zip 8 was merged and live
first (production `5c4935b1-98d0-471a-8de6-9d91881e6dec` = main `1cf0784`). The full description of each switch is its row in `docs/FEATURE_SWITCHES.md`.

### A. Short games (`SHORT_GAMES`, ships OFF; CHANGES MONEY for 1.5 hour games only)
- The one table: `shared/gameLength.ts` `GAME_LENGTHS`, keyed by minutes (90 and 120), each row with court cost and the price each for 4 to 10.
  Normal (120): 14, 11, 9, 8, 7, 6, 5 and $48 (a normal game keeps reading Settings > Money, exactly as live; a test checks the row equals that rule).
  Short (90): 11, 9, 7, 6, 5, and 4, 4 for 9 and 10 (Alex OKed Nov 6), court $36. Above 10 pays the 10 price; under 4 pays the 4 price.
  A new length later = one new row. `gamePrice()` is the only place that decides a game's price.
- Server: the request's switch answer rides on the group row (`server/zip9.ts` `withShortGames`, called by `requireAdmin` and `requireGroupKey`)
  and on to `settingsOf(group).shortGames` (missing when off, so settings are exactly as before). `priceOf` / `flatOf` / `courtCostOf` in
  `server/repo.ts` give each game its own price. Every path that used the Settings price for a game now uses the game's: seat prices
  (`pricesFor`), auto credit at I'm in and waitlist move-ins (`autoCreditFor`, now given the request's settings), the cash-out offer and Use it,
  Finalize (the row's table), Reopen, repricing, late drops and no-shows, the late-cancel fee split (`feeSplitPrice` takes the game's price),
  Unmark, the views (player and organizer, `shortGame` on a game only when it is special), Totals (projected = 3 x the game's own price per court),
  fee-cleared notices, History lines. Moving a game between 2 hours and 1.5 hours reprices its seats in the same batch as the move.
- Screens: player "$11 due", Pay, Pay sheet, Venmo links and requests all read the server's owed amount; toasts, the credit note and late-fee words
  use the game's price. Organizer: Finalize card preview, Money cards ("$11/person", "Credit: $2 per"), Cancel sheet, canceled-late texts,
  Remind texts, Edit charge. Heads-up on Add game and Edit game; "1.5 HR" pill on the tile and "1.5 hr game · $11 each" on the folded row.
- Add to calendar already used each game's real end time on main (`server/player.ts` `sessionCalendarFile`): unchanged, now tested (90 minute event).
- Other lengths: no row, so priced like a normal game ($14, $48), no tag, no heads-up; the old "7:30–9:30 PM" style end line stays with Card time off,
  and with it on the length shows in words ("1 hour", "2.5 hours").
### B and C. Card time and buttons (`CARD_TIME_BUTTONS`, ships OFF; display only)
- `src/pages/PlayerHome.tsx`, `src/CardButtons.tsx`, `src/zip9.css`: start time and a smaller gray length line under every tile; on a card you are in,
  one joined Calendar | Directions button (26 px, 15 px icons, 44 px tall tap areas, labels "Add to calendar" and "Directions"). The address is
  `COURT_ADDRESS` in `shared/zip9.ts`. iPhone: maps.apple.com; Android and computers: Google's directions link.
### D. Switches
- Two Settings rows (newest first), `PUT /api/admin/short-games-switch` and `/api/admin/card-time-switch`, `task_log` rows `short_games_on` and
  `card_time_buttons_on`, kill switches in `wrangler.toml` (allowed; on in `[env.preview.vars]`), private links `?shortgames=on`, `?cardtime=on`,
  Activity lines, player stamp pieces `sg` and `ct` only while on.
- Preview seed: both rows on (`PREVIEW_SWITCHES_ON`), plus a "1.5 hour game" (Booked, 4 in, Indy paid $11, three owe $11).
### Fresh review (an independent reviewer who did not write the code)
- Nothing blocking with the switches off (checked: settings, JSON shape, stamp, every price path).
- Fixed from it: (1) texted links (`server/tokens.ts`) now get the switch too (they priced from Settings); (2) a Settings save that moves
  waiters in keeps the switch for their price; (4) the private test link `?shortgames=on` only counts for the organizer's sign-in (and View as),
  so a player can never lower their own price; (6) flipping the Settings row reprices the seats of open 1.5 hour games at once (tests added).
- Known gaps, left as is and listed for Alex: (a) a debt on a game canceled late with the fee kept (no split) or a late drop is priced from the
  switch as it is when looked at: flipping Short games off turns an $11 debt back into $14 (nothing is stored per seat; same as the rest of
  the site, where a debt follows the price setting). (b) A seat paid $14 cash on a 2 hour game that is then moved to 1.5 hours keeps its $14
  until Finalize gives the $3 back; if that game is instead canceled late with the fee kept and 4 or fewer in, the $3 is not given back.
  (c) A short game finalized with no payments, viewed after the switch is turned off, shows a wrong "paid at" figure in one organizer note (display only).
### Tests (Fri Nov 6, 2026)
- Unit and API: 2258 passed, 1 skipped, 0 failed (134 files); tsc clean; build clean. New: `tests/short-games.test.ts` (23: both tables, every
  price path, switch off and on, the organizer-only test link, the switch flip, moves, calendar, fee split, the credit chain). Seed test follows
  the new rows and the 1.5 hour game.
- Credit chain with short games mixed in (Blair): game 1, 2 hours, 6 play, $9: $14 cash, $5 back, credit $5. Game 2, 1.5 hours, 6 play, $7:
  $5 credit + $6 cash, $4 back, credit $4. Game 3, 1.5 hours, 5 play, $9: $4 credit + $7 cash, $2 back, credit $2. Game 4, 2 hours, 4 play,
  $14: $2 credit + $12 cash, $0 back, credit $0. Cash $39 = prices $39. Nothing lost, doubled or negative.
- Browser: `e2e/zip9.cjs` 15/15 (both switches off and on, light and dark, 390/360/320 px, 44 px tap areas, maps links, 90 minute calendar).
  `e2e/zip9-off.cjs` 21/21 (both switches off = today's main on every screen, with a 1.5 hour game in both worlds; needs `MAIN_DIR`, not in
  `npm run test:e2e`). Also run: zip8 4, zip7 33, zip6 28, money-rework 36, instant-taps 19, pay-sheet 23, audit-player-flows 93,
  audit-player-look 145, auto-credit 22, credit 153, money-visible 12, round2 25, time-shift 10, late-fees 19, late-fee-split 6, admin-r3 15,
  texts-r2 14, player-fix1 30 (one timing flake, clean on rerun), layout-polish 200. zip7 and money-rework were updated to know the two new
  rows and the joined button's calendar half (both switches are on in the fake world). The other older browser scripts were not run.
### Preview
- https://preview-zip9.pickleball-club-9h0.pages.dev (deployment `14cba914`), fake database re-seeded. On there: every switch the Zip 8
  record lists as on, plus Short games and Card time and buttons. The live switch rows could not be read from this session (blocked), so
  Alex confirms the live list.
### After Alex tested the preview (Fri Nov 6, 2026)
- Calendar and Directions halves: work (Alex). $4 for 9 and 10 on short games: OKed. All live switches are ON (Alex), the same list the preview has.
- Every fact once: the green "1.5 hour game" chip on the player card and the "1.5 hour game" line on the organizer card were the NOTE typed on the
  seeded fake game, not site text. The seed game now has no note. A sweep of the heads-up, tag, time line, Pay card, Money card and texts found
  no other place that says the length, the time, the price or the amount owed twice. `e2e/zip9.cjs` now checks "1.5 hours" and "$11" show
  once on the card and no second length on the organizer card.
- Organizer TONIGHT and TOM tiles, white edge on both sides (not behind a switch; `src/zip7.css`, organizer screens only): the tile's dark
  outline is the court ring (`.tb`), placed 1.5 px outside the tile's see-through border. Browsers round a 1.5 px border down to a whole pixel
  (Chrome: 1 px) but not the 1.5 px placement, so a half-pixel gap ran down both sides and showed the tile fill or the tinted card. Fix: the solid
  ring is an inset shadow (never rounded), the strip runs under the ring to its outer edge with the ring on top, and the TONIGHT fill runs to the
  outer edge again. Checked pixel by pixel at 3x and 4x, light and dark; `e2e/zip7.cjs` and `e2e/zip9.cjs` check the geometry. Player tiles unchanged.
- Second fresh reviewer (final diff, before the deploy): nothing blocking; full unit suite 2258 passed. Fixed from it: the strip and fill rules
  were keyed on any court ring, so a TONIGHT tile on a Waitlist court (dashed ring) would have shown the fill between the dashes; they now apply
  only to a solid ring (Court booked, Not booked). The strip's 1.5 px higher start is matched by 1.5 px more top padding, so TONIGHT and TOM
  tiles keep exactly live's height (60.34 px at 390), word and date position (measured on main and on the branch, identical).
  Notes kept: the ring change also makes every organizer Court booked / Not booked tile's ring a true 1.5 px (on a 1x desktop screen slightly
  heavier); Windows High Contrast drops shadows (the ring would not show there); `admin-r2` check F4 fails on main too (it depends on today's date).
- Follow-up PR (before the deploy): the full unit run on merged main caught `tests/zip7.test.ts` "every rule is under an <html> attribute": the
  `:is(.ts-booked, .ts-none)` selectors read as an unguarded rule after the comma. Each selector is now written out in full (same result). Unit
  2258 passed, zip9 15/15, zip7 33/33, tile height and text position identical to live.

### Deploy (Fri Nov 6, 2026, afternoon; recorded with Zip 10)
- Zip 9 is live: production deployment `9c94c864-11cd-4471-a004-f4eeddefb1e3` = main `624c60f` (PR #91 on top of #90). The build live before it was Zip 8,
  `5c4935b1-98d0-471a-8de6-9d91881e6dec` (main `1cf0784`): that is the rollback. Alex switched Short games and Card time and buttons on. The Time Travel
  bookmark of that deploy was not recorded in this file.

## Zip 10: Card cleanup (CARD_CLEANUP): no count text, people icon, tinted Later cards, vertical centering, no waitlist, no player cap - built Fri Nov 6, 2026; on a preview, waiting for "ship it"

Spec: the "zip 10" brief (`START_HERE.md`, `SITE_RULES.md`, the later-cards-v4 and player-screen mockups; the ALERTS mockups are Zip 11). One PR. NO database
schema change, no migration. Built in a quiet window (Friday afternoon). Nothing deployed to production, nothing switched on, no live data changed. Zip 9 was
merged and live first (production `9c94c864` = main `624c60f`). The full description of the switch is its row in `docs/FEATURE_SWITCHES.md`.

### A. Cards (player and organizer)
- `src/pages/PlayerHome.tsx` `ScheduleRow`: with the switch on, no count text (the circles alone: `SpotDots oneRow`, one row, the same sizes as before; past
  what the row holds they tuck under each other, `src/zip10.css`), the people icon (the Players tab icon, `PeopleIcon`) before the names, no waitlist line,
  a filled "I'm in" under the names. The status line, the joined Calendar | Directions button, Pay, the Paid pill and the links are the existing pieces.
- Vertical rule: `useTileCenter` puts the tile's measured height on the card (`--cl-tile-h`, follows the tile with a ResizeObserver); the body is at least
  that tall and centers its content, so taller content starts at the tile's top.
- Later games: the card is drawn as a smaller version of the Next week card (`tier-next cl-later`, 56 px tile) on a soft tint (`--cl-later-bg`, light
  #ebebe4, dark #1b2620). `data-tier` stays `later`. Extra games keep their tile and EXTRA tag; canceled keeps the gray pill.
- Organizer: `PlayersLine cleanup` (Home card R2 and the Games card): circles on one row, people icon + names, no count, no Waitlist line; the court switch,
  In / Out, paid pill and gear unchanged. `HomeV2` folded row: the time on the left of the first line, the circles to its right, the people icon before the
  names on the second line. The Players sheet loses To waitlist / Waitlist.
- Every rule in `src/zip10.css` sits under `html[data-card-cleanup]` (set by `src/zip7.ts` `useZip7Root`). One bug found while building: a size variable
  named `--ball` collided with the site's ball COLOR variable (`--ball`), turning the balls black; renamed `--cl-ball`.

### C. No waitlist, no player cap
- Server: the request's answer rides on the group row (`server/zip10.ts` `withCardCleanup`, called from `requireAdmin`, `requireGroupKey` and texted links)
  and on to `settingsOf(group).noCap`. `capOf(settings)` (`shared/settings.ts`) is the cap for every join path: 12 with the switch on, the saved Max players
  with it off. `maxPlayers` itself always stays the saved setting (a Settings save never stores 12).
- Can NOT be switched off in the database: the hard limit of 12 confirmed per game is a trigger (migration 0013). Lifting it is a schema change, so it stays.
  With the switch on a 13th tap gets "12 is the most one game can hold right now. Ask Alex." (409 `game_limit`) and nobody is put on a waitlist. The organizer
  roster "waitlist" action answers 409 `no_waitlist`.
- `settle()` with no cap moves anyone still waiting in as a normal seat (no `promoted_at`, no "Good news", no "Spot opened" text card). Views hide every
  waitlist with the switch on (a player still on one reads as not in: their I'm in takes a seat), `full` is never true, `joinAs` is always `in`, older
  promotions show no notice. Telegram: `alertMessage` drops "moved up from the waitlist" (`noWaitlist`).
- Switching the Settings row ON runs `endWaitlists`: everyone waiting on an open game moves in, first in line first, up to 12 (their credit goes on like at
  I'm in). Off moves nobody back.
- `scripts/integrity-checks.sql` `more_in_than_max` allows 12 while the row is on (else the saved max, as before).
- Old waitlisted players: on the preview data, 1 (Gray, the standby on the full 10-in game, now an 11th player). Live: the read-only look at the live
  database was blocked in this session (permission), so the count there is not known; when Alex switches the row on, anyone waiting on an open live game
  moves in the same way at that moment, and nothing happens before that.
- Not switched: nothing. Every change above is behind the switch; with it off the code paths are main's (checked by `e2e/zip10-off.cjs`).

### Prices with 11 and 12 players
- Normal (2 hours): floor(4 x $14 / N): 11 play $5 each ($9 back), 12 play $4 each ($10 back). Court $48: 11 x $5 = $55, 12 x $4 = $48, covered.
- 1.5 hour games (Zip 9 table, above 10 pays the 10 price): 11 and 12 play $4 each ($7 back). Court $36 covered.
- Credit chain (Blair, switch on, `tests/card-cleanup.test.ts`): game 1, 2 hours, 12 play, $4: $14 cash, $10 back, credit $10. Game 2, 2 hours, 11 play,
  $5: $10 credit + $4 cash, $9 back, credit $9. Game 3, 1.5 hours, 12 play, $4: $9 credit + $2 cash, $7 back, credit $7. Game 4, 1.5 hours, 11 play, $4:
  $7 credit + $4 cash, $7 back, credit $7. Cash $24 = prices $17 + credit left $7. Nothing lost, doubled or negative.

### D. Switch
- Settings row "Card cleanup" (newest first), `PUT /api/admin/card-cleanup-switch` (answers `movedIn`), `task_log` row `card_cleanup_on`, kill switch
  `CARD_CLEANUP` in `wrangler.toml` (allowed; on in `[env.preview.vars]`), private link `?cardcleanup=on` (header `X-Card-Cleanup`), Activity lines,
  player stamp piece `cl` only while on.
- Preview seed: `card_cleanup_on` in `PREVIEW_SWITCHES_ON`; the seed switches it on the way the row does (Gray moves in), then adds three games with no notes:
  1 in, 8 in and 12 in.

### Fresh review (an independent reviewer who did not write the code)
- Nothing blocking. Three should-fix, each proven with a test by the reviewer and now regression tests in `tests/card-cleanup.test.ts`:
  (A) the private link was honored on any phone, so a player phone could join past Max players and its drop moved waiters in up to 12 with no notice:
  the no-cap part now counts the link only on the organizer's sign-in (and View as), like Zip 9's Short games; a player phone with the link gets the
  look only (`cardCleanupLook`). (B) switching on left anyone past 12 on a hidden waitlist that a later drop would fill silently: they now come off the
  list when the row is switched on (`endWaitlists`, money back the way a drop does). (C) raising Max players while the organizer's phone had the link
  moved nobody in: the comparison uses the saved setting again.
- Also fixed from its notes: the drop warning counts the real waitlist; the organizer's own In is never drawn past 12; the tile height is read from
  layout (`offsetHeight`), not a size caught mid-animation. Found while rerunning older tests: with Instant taps a tap on a 12-in game was drawn as
  joined, then taken back; only a game with a spot is drawn ahead now (`canJoinInstantly` checks `openSpots`).
- Notes kept: the integrity check allows 12 whenever the Settings row is on, even if the `CARD_CLEANUP` kill switch is "off" (SQL cannot see the
  kill switch); the dashboard always carries `cardCleanupForAll` (false when off), as every other switch does.

### Tests (Fri Nov 6, 2026)
- Unit and API: 2277 passed, 1 skipped, 0 failed (135 files); tsc clean; build clean. New: `tests/card-cleanup.test.ts` (19: capOf, the kill switch,
  the refusal words, Telegram without "moved up", the Want in? line, Activity lines, every zip10.css rule under the attribute, prices at 11 and 12 normal
  and short, switch off as before, the private link player vs organizer, 11 and 12 joins and the 13th refused, Settings save keeps Max players, the switch
  flip moving waiters in and taking the rest off, older promotions hidden, the review's A and C, the credit chain at 11 and 12). Seed test follows the new
  games; the integrity check knows the switch.
- Browser: `e2e/zip10.cjs` 21/21 (light and dark, 390/360/320 px: no count text, balls on one row inside the card at their old sizes, people icon, no
  waitlist words, short content centered on the tile and tall content at the tile top, You're in and Not in layouts, 44 px taps, tinted Later cards at
  4.5:1, organizer cards and rows, a 12th joining and dropping, a 13th refused, the Settings row; switch off = old cards; `?cardcleanup=on` on one phone).
  `e2e/zip10-off.cjs` 34/34 (switch off = today's main on every screen, light and dark, including the standby, Leave waitlist and an 11th going on the
  waitlist; needs `MAIN_DIR`, not in `npm run test:e2e`). Older scripts on the fake world, rerun: zip9 15, zip8 4, zip7 33, zip6 28, instant-taps 19,
  money-rework 36 (zip7, zip6, instant-taps and money-rework updated to know the new cards, no waitlist and the new Settings row). Scripts that build
  their own world (switch off there) were not rerun.

### Preview
- https://preview-zip10.pickleball-club-9h0.pages.dev, fake database re-seeded Fri Nov 6, about 5:00 PM Eastern. On there: every switch the Zip 9 record
  lists as on (all live switches), plus Card cleanup.

### After Alex tested the preview (Fri Nov 6, 2026, about 5:00 PM Eastern)
- Answers: keep "Paid $14" and "Paid with credit"; keep the 12 player limit (no database change); $4 each for 11 and 12 on 1.5 hour games OK; the
  branch name does not matter.
- Tweak 1, player names 13 px (were 15 px, 14 px at 360 and below), only with Card cleanup on. Measured: at 390 px five ordinary names ("Alex, Nathan,
  Joe, Lane, Jordan") or six short ones fit on one line on every card; at 360 they fit on Next week and Later cards, and on a This week card when about
  4 px shorter; at 320 a list wraps after three or four names. `e2e/zip10.cjs` checks the 13 px and the 390 px fit.
- Tweak 2, organizer Home card tighter (only with Card cleanup on): the circles row is as tall as the circles (its 34 px minimum was the old In button's
  height), about 10 px from the note line to the circles (was about 16), about 6 px from the circles to the names (was about 10). The folded Next week
  rows already sit 1 px apart, unchanged. `e2e/zip10.cjs` checks both gaps.

### Second fresh review (final diff, before the deploy)
- Nothing blocks deploying with the switch OFF (checked line by line against main: server paths, JSON, clock, Telegram, money, integrity check, client,
  CSS, settings_json). One should-fix, proved: the organizer's private link on live still lifted the cap for the organizer's own taps, so previewing the
  look and then removing a player would move every waiter in up to 12 with no notice. Fixed: the private link is the LOOK only on every phone, the
  organizer's too; seats follow the Settings row alone (`server/zip10.ts`, `cardCleanupFor` vs `cardCleanupLook`; test in `tests/card-cleanup.test.ts`).
- Also fixed from its notes: a look-only test phone on a full game says "Join waitlist" again (what its tap does); the Want in? popup at 12 says only
  "12 are in." Notes kept: switching the row on while the kill switch is "off" moves nobody (the kill switch wins); after switching the row off again, a
  game left at 11 or 12 shows in `more_in_than_max` (expected).

### Deploy (Fri Nov 6, 2026; recorded with Zip 11)
- Zip 10 is live: production deployment `f09f5aac-d683-49bd-a3cb-de9794278759` = main `fb44afc` (PR #92). The build live before it was Zip 9,
  `9c94c864-11cd-4471-a004-f4eeddefb1e3`: that is the rollback. Alex switched Card cleanup on (the live `card_cleanup_on` row exists, read Sat Nov 7).
  The Time Travel bookmark of that deploy was not recorded in this file.

## Zip 11: Alert cards (ALERT_CARDS): one action-card look for every player and organizer alert, plus dead code removal - built Fri Nov 6 to Sat Nov 7, 2026 (overnight, a quiet window); on a preview, waiting for "ship it"

Spec: the "zip 11" brief (`START_HERE.md`, `SITE_RULES.md`, the ALERTS-player, ALERTS-organizer and player-screen-with-action-card mockups). One PR.
NO database schema change, no migration. Nothing deployed to production, nothing switched on, no live data changed. Only reads of the live
database (the switch rows, the count of texted /t/ links, the count of old "standby" Activity lines). Zip 10 was merged and live first.

### A. The look (`ALERT_CARDS`, ships OFF, look only)
- `src/AlertCard.tsx` (the one card: tone, bold title, gray sub line, one button on the right, or two or more under the text, an optional X, links
  under the title) and `src/alert-cards.css` (every rule under `html[data-alert-cards]`, set by `src/zip7.ts useZip7Root`; tokens light, dark, dark).
  Every text and button pair is 4.5:1 or better (checked in `tests/alert-cards.test.ts` and in the browser). Buttons 40 px to see, 44 px to tap.
- Player (`src/pages/PlayerHome.tsx`, `src/timeShift.tsx`, `src/pages/CashOutPrompt.tsx`): Want in ("Tuesday needs 1 more" with the circles,
  "Tuesday has 5 in" / "You'd make it 6"; I'm in = the old Yes, X = the old No), Pay card (Pay on the right opens the Pay sheet or Venmo as before; I paid
  and Use credit links show under exactly the old conditions), cleared debt ("You no longer owe $14", "Someone took your Tue, Nov 3 spot", Dismiss),
  Credit adjusted (+ an X that hides that one adjustment on this phone), the cash-out question (same place at the bottom, blue card, mock words), the
  "Alex sent your $10" banner (gets an OK that only closes it), the moved game (Still in / Can't make it under the text), the answer card after Want in
  (Done), the good-news line in a card, the View as bar (gray card, Exit), and every bottom banner (tinted, no icon; red for errors).
- Organizer Home (`DoNow.tsx`, `SuggestionCards.tsx`, `HomeCards.tsx`, `VenmoRequest.tsx`, `Admin.tsx`, `Sessions.tsx`): the words are each card's own
  words split at the first sentence into a title and a gray sub line (`splitFirst`, `shared/zip11.ts`); buttons get the mock's short labels (the old
  label stays as the spoken name). See the switch row in `docs/FEATURE_SWITCHES.md` for the full list.
- Switch: Settings row "Alert cards" (newest first), `PUT /api/admin/alert-cards-switch`, `task_log` row `alert_cards_on`, kill switch `ALERT_CARDS` in
  `wrangler.toml` (allowed; on in `[env.preview.vars]`), private link `?alertcards=on` (header `X-Alert-Cards`, any phone: look only), Activity lines,
  player stamp piece `ac` only while on.

### B. Dead code removed (not switchable)
- `/t/<token>` link page (`src/pages/LinkPage.tsx`): no screen ever made one (the organizer route `POST /api/admin/sessions/:id/links` has no button),
  and the live database holds 0 rows in `session_action_tokens` (read Sat Nov 7). An old `/t/...` address now opens the home page. Kept on purpose: the
  server routes `/api/link`, `/api/link/act` and the links route (tests use them; harmless without the page). Follow-up for a later zip.
- "I booked it" task button (`bookedButton`, the `'booked'` task action): nothing drew it (the court switch sets Booked). Removed from the brain.
- The game-day check (6:15 / 7:15 AM Telegram, alert id `gameday`): it only ran with Texts round 2 OFF (on live it was already off); deleted for good.
  A one-off check ran main's brain and this one at all 12,684 ticks of both sweeps: the new cards and alerts were the old ones minus exactly those two
  things. `tests/fixtures/tick-golden.json` lost only its 9 `:gameday` lines (and its two card fingerprints); `tests/golden-wording.test.ts` has the new ones.
- Standby words: KEPT, not removed. The fresh review proved one path still reaches them: a game that already started on a court still set to
  Waitlist (never marked Booked) keeps its court state, so from the start to the end of that game the card can say "0 on standby" / "Standby, 2nd
  in line" (`shared/court.ts` decides "started" before "waitlist"). By the brief's rule (still used, so keep it), they stay exactly as on main. The
  server never answers a "standby" join any more; the organizer History line "X joined standby" also stays (7 old live log lines read that way).

### C. Last-call wording (report only, nothing changed)
- The "Last call texts" group text (`shared/lastCall.ts`, 4 or more in) ends with "Need to back out? Do it by ... to avoid cancel fees." Players read it
  in the group chat. No player screen says "last call".

### D. Preview seed
- `alert_cards_on` in `PREVIEW_SWITCHES_ON` (with every switch on live). New fake states: a moved game (Indy, Jordan, Drew), Casey +$5 credit adjusted and
  a regular for Tue and Thu (Want in), Blake's late drop taken by Christopher Vanderberg (cleared debt), and a played game to finalize (Wednesday or Thursday seeds).

### Fresh review (an independent reviewer who did not write the code)
- Nothing blocking. Fixed from it: (1) the standby words were still reachable (see B): put back exactly as main has them; (2) with the switch on, the
  Want in button says "Join waitlist" when the tap really joins a waitlist (only with Card cleanup off). Also from its notes: the X is a full 44 x 44
  px; card titles are headings again where the old cards had one (h2 Pay and Want in, h3 organizer cards); each short button's spoken name starts
  with its visible words ("Text: Text the group to confirm", "Remind: ..."); the TEXTS_R2 row in `docs/FEATURE_SWITCHES.md` says the game-day
  check cannot come back. Checked by the reviewer: OFF falls back to the old markup everywhere, hook order is fine, nothing about money, seats or
  texts reads the switch, and main's brain minus the two deleted things gives the new golden fingerprints exactly.
- Notes kept: the dashboard always carries `alertCardsForAll` (false when off), as every switch does (one more small read per request); the old
  `/api/link` routes stay (see B).

### Tests (Sat Nov 7, 2026, about 12:00 to 3:00 AM Eastern)
- Unit and API: 2294 passed, 1 skipped, 0 failed (136 files); tsc clean; build clean. New: `tests/alert-cards.test.ts` (the switch: off, header, Settings row,
  kill switch, stamp, Activity, same data either way; every CSS rule under the attribute; tokens 4.5:1 light and dark; the deleted code; the seed list).
  Updated for the deleted game-day check and "I booked it": smart-tasks, texts-r2, tick-fast, golden-wording (new fingerprints), audit-behind-clock,
  telegram-links; preview-seed (Casey's credit is $8).
- Browser: `e2e/zip11.cjs` 21/21 (light and dark, 390/360/320 px: inside the screen, no icon, 4.5:1, 40 px buttons, 44 px X, no waitlist words on
  player cards; the Want in X declines, Pay opens the Pay sheet, Still in saves, Can't make it opens the drop question, the cash-out question, the
  organizer colors, Settings off = the old alerts, `?alertcards=on` on one phone, the Settings row, an old /t/ link opens home).
  `e2e/zip11-off.cjs` 42/42 (switch off = today's main on every screen, player and organizer, light and dark, 390/360/320, and after tapping every
  alert's buttons; needs `MAIN_DIR`, not in `npm run test:e2e`).
- The rest of `npm run test:e2e`, run once in parallel at 390 px: all pass except four that fail on today's main too (rule 7, not fixed here):
  `run.cjs` (the "Last call" label matches two fields since Zip 8), `cancel-reason.cjs`, `want-in.cjs` (DEMO check) and `admin-r2.cjs` F4 (date).
  Updated for the new fake world: `money-rework.cjs` (the new Settings row), `zip6.cjs` (the Credit adjusted card words), `zip10.cjs` (a seeded
  late-drop line sits between note and circles), `instant-taps.cjs` (opens the "Mixed payments" card by name).

### Preview
- https://preview-zip11.pickleball-club-9h0.pages.dev, fake database re-seeded Sat Nov 7. On there: every switch that is on live (read from the live
  `task_log` Sat Nov 7: Adjust credit, Admin layout v2, round 2 and 3, Card cleanup, Card time and buttons, Color cleanup, Home collapse, Instant taps,
  Last call texts, Late-cancel fee split, Late drops owe $14, Money rework, Ask for payment on every game, No Venmo? note, Pay sheet, Simpler player
  cards, Player fixes, Short games, Texts round 2, Moved-game notice, Tonight glow, Venmo request, and the two animation switches), plus Alert cards.

### After Alex tested the preview (Sat Nov 7, 2026, morning Eastern)
- Preview looked good in light and dark. Answers: (a) keep today's organizer words, not the mock's; (b) no new cards for the canceled lines;
  (c) "Alex sent your $10" stays a bottom banner with OK; (d) the slightly darker amber Pay button is fine; (e) leave the /t/ server routes
  (`/api/link`, `/api/link/act`, the links route) for now. "Ship it" with ALERT_CARDS OFF.
## Zip 12: speed fixes (built files kept a year, a smaller logo, and three switches: SPEED_FEWER_QUERIES, SPEED_DIRECT_LOAD, SPEED_LAST_SCREEN) - built Sat Nov 7, 2026; on a preview, waiting for "ship it"

Spec: the "zip 12" brief (`START_HERE.md`, `SITE_RULES.md`), from the Zip 9c read-only speed check. One PR. NO database schema change, no migration, nothing
about money. Built in a quiet window (Friday night into Saturday). Nothing deployed to production, nothing switched on, no live data changed. Zip 10 was
merged and live first (production `f09f5aac-d683-49bd-a3cb-de9794278759` = main `fb44afc`). Each switch's full description is its row in
`docs/FEATURE_SWITCHES.md`; the two items that cannot be switched are at the end of that file.

### Item 3: built files kept a year (no switch, live at deploy)
- `public/_headers`: `/assets/*` gets `Cache-Control: public, max-age=31536000, immutable`. Nothing else changes (the page, `/theme.js`, the icons: ask again
  each time; `/api`: no-store, from the code). Proof the names change: one changed word in the code gave `index-D4Xhzfe8.js` -> `index-Drl6tRz5.js` (and
  `load-*` too); unchanged files (CSS, the database engine file, fonts) kept their names; putting the word back gave the old names again.
- Found while checking: Cloudflare answers a MISSING `/assets/...` file with the home page (200), and the year-long rule would have applied to it (seen on a
  probe preview). A phone could then keep the home page under a script's name for a year (for example after a rollback). Fix: `public/assets/404.html`;
  with it, a missing built file is a real 404 that Cloudflare sends as no-store (checked on the preview); every other address still opens the site.
### Item 6a: smaller logo (no switch, live at deploy)
- `public/logo.png` 31.7 KB (128 px) -> 3.2 KB (72 px, 3x its 24 px size, 128 colors, edges resized the right way so no dark fringe). Pixel comparison at
  2x and 3x on both tile colors: same look (the new one slightly crisper). Other images: favicon 2.3 KB is fine; the touch icon and the 192/512 icons are
  not on the first screen and had no lossless saving; `logo-header.png` and `logo-xmas.png` are not used by any page. Left as they are.
### Item 4: Load games at once (`SPEED_DIRECT_LOAD`, ships OFF)
- `src/lib.ts` `startEarlyLoads` (called by `src/main.tsx` before the first draw), `takeEarly`; `SiteHome` and `PlayerHome` take the early answer once.
  Only the plain address, only when the phone remembers the last games answer said `directLoad` (or `?directload=on`). The set-up answer still decides
  the screen; every check is unchanged. Off: the next answer drops the memory. A brand-new phone's first visit is the old chain (it has not heard yet).
### Item 1: Fewer database trips (`SPEED_FEWER_QUERIES`, ships OFF)
- `server/speed.ts`, wired in `server/app.ts` (after the Pretend and read-only PIN databases are set, right before the route runs; stepped aside when the
  answer is ready). With it on: every switch question from one read of all switch rows (the same index as each old question, so fewer rows read, not
  more); the same read twice in one request answered from the first (handed out as a copy); any write forgets everything (and a read that set off before
  a write is not kept); independent reads in one trip (`prefetch`, in `groupView`, `moneyPicture`, the change stamp, the dashboard and the two per-game
  loops). The reads it sends early use the same SQL text as the code that asks them (shared builders such as `playersRead`, `ledgerRead`), so they cannot
  drift apart unseen; a missed one only costs its own trip. Prefetch is off on the Pretend and read-only PIN databases (their batches are not plain reads).
- Off ('decide'): the first switch question of a request is answered by the one read that replaces it (one trip for one trip); if the row is off, every
  later call goes straight to the database, untouched. Same trips as main, same answers, no extra wait (found by two Telegram tests that check a background
  send has started the instant a tap answers).
- Trips per call on the fake world (`scripts/count-queries.ts`), main -> switch on: status 1 -> 1, player screen 47 -> 7, version check 21 -> 4, dashboard
  81 -> 21, organizer version 4 -> 3, Money 27 -> 8, History 4 -> 3.
### Item 2: Show last screen at once (`SPEED_LAST_SCREEN`, ships OFF)
- `src/lastScreen.ts` (what is kept and when it is thrown away), `SavedScreenView` and the cards' `held` mode in `src/pages/PlayerHome.tsx`, `SiteHome`
  (shows it while its set-up check runs). The copy is a player answer with every money and private field emptied: price 0, nothing owed, no credit, no
  paid state, no Venmo or organizer name, no names list, no switches that change money or taps, only games still to come; your seat keeps in / waiting /
  out. Drawn with the live cards (and the same page markers, so Card cleanup and Tonight glow look the same) in an inert list with no button, link or
  money line; "as of 2:14 PM" in small gray text (12 px, 4.5:1 or better in light and dark). Thrown away on: switch off, "not you?", 24 hours, a new
  build (`__APP_BUILD__`, set at build time), another address. Never for View as, the demo or Pretend. No service worker.
- Seen on the preview: the saved cards are a little shorter than the fresh ones (no buttons, no money lines, no Pay card at the top), so the page moves
  down a little when the fresh answer lands. On purpose: the money parts are never kept.
### Switches
- Three Settings rows (newest first): "Show last screen at once", "Load games at once", "Fewer database trips". `PUT /api/admin/speed-last-screen-switch`,
  `/speed-direct-load-switch`, `/speed-fewer-queries-switch`; `task_log` rows `speed_last_screen_on`, `speed_direct_load_on`, `speed_fewer_queries_on`;
  kill switches `SPEED_LAST_SCREEN`, `SPEED_DIRECT_LOAD`, `SPEED_FEWER_QUERIES` in `wrangler.toml` (allowed; on in `[env.preview.vars]`); private links
  `?lastscreen=on`, `?directload=on`, `?fewerqueries=on`; Activity lines. No change-stamp pieces (the phones pick a flip up on their next full answer).
- Preview seed: all three rows on (`PREVIEW_SWITCHES_ON`).
### Before and after (Sat Nov 7, 2026, about 12:30 to 2:00 AM Eastern; fake data, preview only)
- Method: the same fake world on two previews, `speed-before` (main `fb44afc`'s build) and `preview-zip12` (this branch, all three switches on).
  `e2e/speed-measure.cjs`: Chrome's network presets (fast 3G 562 ms / 1.44 Mbps; slow 3G 2000 ms / 400 kbps), a 390 px phone that already picked a name;
  "first visit" = empty browser (cookie only), "repeat" = the same browser opening again; 3 runs each, medians. Server time: 15 calls each with curl,
  medians (each includes about 210 ms of this sandbox's own network path; see status). Trips: `scripts/count-queries.ts` (local copy of the fake world).
  Numbers here differ from the 9c check's (another network path), so compare before with after, not with 9c.
- First useful screen, before -> after: fast 3G first visit 5.0 s -> 4.5 s, repeat 3.0 s -> 1.5 s (the saved copy; the fresh screen at 2.3 s); slow 3G
  first visit 15.0 s -> 15.0 s (unchanged: the app download itself, about 175 KB of script, 33 KB of style and a 77 KB font; splitting the admin code out is
  the parked item 5), repeat 9.0 s -> 4.4 s (saved copy; fresh at 6.8 s).
- Requests on the first screen: 8 before and after. On a repeat visit 3 of them (script, style, font) now come from the phone's own copy, no network.
- Server time per call, before -> after: player screen 947 -> 339 ms, version check 569 -> 274 ms, dashboard 1566 -> 586 ms, Money 590 -> 364 ms,
  organizer version 253 -> 211 ms, status 214 -> 220 ms, History 228 -> 236 ms (the last three within noise).
- Trips per call (main -> switch on): player screen 47 -> 7, version check 21 -> 4, dashboard 81 -> 21, Money 27 -> 8, organizer version 4 -> 3,
  History 4 -> 3, status 1 -> 1. With the three switches off every screen asks exactly main's count (47, 21, 81, 27, ...): the one read that decides
  the switch also answers the new Zip 12 rows. Only with the `SPEED_FEWER_QUERIES` kill switch "off" do the new rows cost their own reads (2 on the
  player screen, 3 on the dashboard), like every earlier switch.
- Server work per request (Workers CPU, estimated locally as the handler time minus the database's own time): the same with the switch off and on
  (player screen about 2.3 ms, dashboard about 7 ms, Money about 0.9 ms). A first version copied every remembered answer and cost about twice that; it
  was replaced before review by handing each early answer out once with no copy. Live Workers CPU could not be read from this session.
### Fresh review (an independent reviewer who did not write the code)
- Nothing blocking with the three switches off. It built its own main-vs-branch comparison (not the branch against itself): every answer, all 17
  phones, the four moments, about 200 taps with the screen compared after each, Finalize and Reopen: byte for byte main's with the switch forced on.
- Fixed from it: (1) with "Load games at once" remembered and a group word the phone did not have yet, the early "word needed" answer was reused after
  the word was typed and the page stayed on a spinner (hidden in dev and in e2e by React's StrictMode; proved with it removed). Now an early answer that
  is an error is never used, and SiteHome drops it on any screen that is not the games; `e2e/zip12.cjs` checks it with StrictMode taken out. (2) Off,
  the two new rows cost 2 trips on the player screen and 3 on the dashboard: now free (see above). (3) The dashboard carried three `false` speed fields:
  now only while on, so off it is byte for byte main's. (4) The saved copy could flash on a "link not working", link-only or group-word screen: now
  thrown away there. (5) A batch answered early now needs one early answer per statement.
- Left as is, for Alex: after the row is switched off, each phone shows its saved copy (tagged, buttons held) once more on its next open, because it
  only hears about the switch from the fresh answer; the copy is gone a second later. A game canceled after a phone saved its copy shows on that copy
  until the fresh answer replaces it (tagged "as of", nothing tappable).
### Tests (Sat Nov 7, 2026)
- Unit and API: 2306 passed, 1 skipped, 0 failed (137 files); tsc clean; build clean. `PB_SPEED_FORCE=1` (every request with Fewer database trips
  on): every test passes; in `tests/speed-queries.test.ts` the three trip-count and kill-switch checks skip (forcing makes "off" fast too).
  New: `tests/speed-queries.test.ts` (15: byte for byte at four moments with the Zip 9 and 10 rows on and off, trip targets, off = main's trips, the
  Settings row, a write never answered from before it, the kill switch), `tests/speed-client.test.ts` (14: the saved copy's privacy, throw-away
  rules, the as-of words, the two flags, the year-long rule only on /assets, the 404 page, the logo).
- Browser: `e2e/zip12.cjs` 18/18 (saved copy at 390/360/320 px, light and dark, held buttons, no tap sent, tag contrast, ended and canceled games,
  24 hours, not you?, View as, Load games at once order, switched off, the private link, the group word case without StrictMode, Settings rows).
  `e2e/zip12-off.cjs` 23/23 (all three off = today's main on every player and organizer screen, light and dark, first and repeat open, question
  order; needs `MAIN_DIR`). Full `npm run test:e2e` once, 3 at a time: 47 of 51 scripts clean (money-rework updated for the three new rows). The other
  4 fail the same way on today's main (checked there): `run.cjs` (10 Settings checks: its "Last call" label lookup also matches the Zip 8 "Last call
  texts" row), `cancel-reason.cjs` (2), `want-in.cjs` (1, the View as check), `admin-r2.cjs` F4 (1, depends on today's date, known since Zip 9). Not fixed here.
- A production-like check on the deployed preview: the saved copy in under half a second, "as of" tag, 0 buttons, 0 taps sent, then 9 buttons
  and no tag once fresh, light and dark.
### Preview
- https://preview-zip12.pickleball-club-9h0.pages.dev (deployment `f97ae827`), fake database re-seeded Sat Nov 7, about 1:35 AM Eastern. On there:
  every switch the Zip 9 record lists as on (all live switches), Card cleanup (Zip 10), plus the three speed switches. The live switch rows could not be
  read from this session (blocked), so the live list comes from the repo records; whether Alex has switched Card cleanup on live is not recorded.
- `https://speed-before.pickleball-club-9h0.pages.dev` is main's build on the same fake database (for the before numbers); `speed-probe` was a header probe.
### After Alex looked at the preview (Sat Nov 7, 2026, morning)
- Answers: Card cleanup is NOT on live yet (Alex; note the Zip 11 notes above say the live `card_cleanup_on` row existed when read Sat Nov 7: Alex
  to check Settings on live). The page may shift a little when fresh data lands, but quietly (below). OK that each phone shows its old copy once after
  Show last screen at once is switched off.
- Put on top of main after Zip 11 (PR #93, live as `b2ffeedd` = main `513d7b4`): one commit for the whole of Zip 12, conflicts only where both zips
  add a switch (Zip 12's rows sit above Alert cards, newest first). The fake world keeps Card cleanup and Alert cards on (Zip 10 and 11's tests use them).
- A, the quiet swap (Alex): the copy keeps sizes only (page width, the room above the list, each card's height and where its words start, in the
  live list's order, canceled games included), so the saved copy takes exactly the room the live screen took: the Pay card area and a game the copy
  may not show keep their room as a soft shimmer; the "as of" tag sits where All games sits; a fresh page load's rules apply (Home collapse folds later
  games, else the first 6). On the first fresh screen only what changed fades in (a card whose balls, names or status changed, a new card, the buttons
  and money lines), 320 ms, none with Reduce motion. A copy older than 3 hours is not shown: the normal loading shimmer shows instead.
  Checked in `e2e/zip12.cjs`: card tops, heights and where the words start within 1 px from the live screen to the copy to the fresh screen, at 390, 360
  and 320 px, light and dark, with Card cleanup on and off; changed parts fade and unchanged ones do not; a 4 hour old copy shows the shimmer.
- Second fresh review (the quiet swap): nothing blocking. Fixed from it: a copy thrown away after a "word needed" or "not found" answer could be saved
  again when the phone was locked (the answer in memory is now forgotten too); a new card's fade lost to the motion switch's rule (it wins now, and with
  motion on the Pay card keeps its own entry so it never rises twice); damaged size notes are ignored instead of breaking the page.
- Tests on the combined code: unit 2325 passed, 0 failed (138 files); `e2e/zip12.cjs` 26/26; `e2e/zip12-off.cjs` 23/23 against main `513d7b4`; full
  browser suite: the same 4 scripts as before fail on main too (run 10, cancel-reason 2, want-in 1, admin-r2 F4 1); money-rework's "Hide from list"
  failed twice with three scripts sharing the machine (it waits 0.9 s) and passed alone and in two full runs (36/36) on the branch and on main.

### Deploy (Sat Nov 7, 2026, 9:48 AM Eastern, a quiet window) - LIVE with all three switches OFF
- PR #94 merged (main `6ab20fb`, on top of Zip 11's `513d7b4`, which was live as `b2ffeedd` = main first). Full unit run on merged main: 2325 passed, 0 failed.
- Before: SQL export of the live database (`npx wrangler d1 export pickleball --remote`, 9:36 AM, 164,705 bytes, kept out of git) and Time Travel bookmark
  `00000a68-00000000-0000511c-fc88ef43ecfab94da2e93bafe783d1b2` (9:36 AM). Whole database only if ever needed:
  `npx wrangler d1 time-travel restore pickleball --bookmark=00000a68-00000000-0000511c-fc88ef43ecfab94da2e93bafe783d1b2`.
- Production deployment `63f84d33-4e58-47dd-b841-51c2594fa2c3` = main `6ab20fb`. Rollback: the build live before it, Zip 11, `b2ffeedd-3c71-4edc-bc70-f676d9011d7c`.
  Nothing is written while the switches are off, so no data restore is needed.
- Read-only live check (on the backup address; this session's network does not reach pickleball.juncaj.net): `e2e/live-check.cjs` all green except
  its old "setup code is configured" line (false by design once a group exists; the previous build answers the same). The read-only PIN signs in,
  dashboard, version, Money and History answer, a save is refused (403 view_only), all five organizer tabs open in a browser with no page errors, and
  the three speed rows are off. Found: the live Card cleanup row is ON for everyone (`cardCleanupForAll: true`), against Alex's answer; told Alex.
- Items 3 and 6a on live: `/assets/*` sends `public, max-age=31536000, immutable`; a missing built file answers 404 no-store; the page, `/theme.js`,
  `/logo.png` keep `max-age=0, must-revalidate`; `/api` no-store; `logo.png` 3,171 bytes. The public page (fast 3G): first visit 5.2 s to
  "Who are you?", repeat 3.0 s with the script, the styles and the font from the phone's own copy (0 of them before).

## Zip 12 step C: Instant admin (SPEED_LAST_SCREEN_ADMIN) - built Sat Nov 7, 2026 (morning, after the Zip 12 deploy); on a preview, waiting for "ship it"

Alex: the admin screens should appear instantly too, like players. A separate step with its own switch, ships OFF. No schema change, nothing about money.
- Server (`server/speed.ts`): task `speed_last_screen_admin_on`, kill switch `SPEED_LAST_SCREEN_ADMIN` (allowed; on in `[env.preview.vars]`), header
  `X-Last-Screen-Admin` (`/admin?lastscreenadmin=on`), `PUT /api/admin/speed-last-screen-admin-switch` (refused for the read-only PIN like every save),
  Activity lines. The dashboard carries `lastScreenAdmin: true` and `speedLastScreenAdminForAll: true` only while on (off: the answer is as before).
- Phone (`src/lastAdmin.ts`, `HeldAdmin` in `src/pages/Admin.tsx`, `src/admin-held.css`): after a real-PIN dashboard answer with the switch on, the
  whole answer is kept (money included; it is the organizer's own phone). On the next open, while the answer is on its way, the copy is drawn with the
  real Dashboard inside one inert wrapper (no tap, typing or focus), every element showing a $ amount dimmed to 45 %, the version check paused, and a
  small "as of 2:14 PM" pill under the header (out of the page's flow). The wrapper stays for the rest of the page's life, so the fresh answer updates
  the same screen in place: money brightens over 320 ms and only elements whose words changed or that are new fade in (a watcher that starts while the
  copy is held and stops 1.5 s after the swap). Never kept for the read-only PIN, Pretend or the demo. Thrown away on Sign out, a PIN change (the
  Settings form), a 401 answer, older than 3 hours (the usual loading then), another build, the switch off. Settings row "Instant admin" (newest first),
  hint "... Not on a game day the first time".
- Found while testing: with the fresh answer here before its Instant-taps copy, one draw went down the normal path and rebuilt the screen (no in-place
  update); and React's double mount in dev stopped the change watcher for good. Both fixed; `e2e/zip12-admin.cjs` covers them.
- Tests: `tests/speed-admin.test.ts` (4), `e2e/zip12-admin.cjs` 15/15 (390/360/320 px, light and dark: at once, the tag, money dimmed, nothing
  tappable or sent, tabs held, nothing moves at the swap, money bright after, a change fades in, 3 hours, Sign out, 401, PIN change by API and by the
  Settings form, read-only PIN never keeps, switch off, the private link, the Settings row). `e2e/zip12-off.cjs` 25/25 against main `6ab20fb` (Instant
  admin off = main on every screen, including a repeat open of the organizer Home). money-rework updated for the new row (17 above the group).
- Fresh review (Instant admin): nothing blocking (nothing can change data while held: the one portal menu opens only on a tap, no tab saves on
  mount, the poller is paused; off takes main's exact path; the swap keeps the same tree). Fixed from it: (1) a dashboard answer landing just after
  Sign out could save the copy again: Sign out and a 401 now set a "signed out" mark that blocks keeping one until the next real sign-in; (2) on a
  stalled link (or a session revoked elsewhere) the held copy could stay up until the answer came: it now gives up after 8 seconds and the usual
  loading shows; (3) the two dashboard flags come from one read of the row. The as-of pill moved to float above the tab bar (under the header it
  covered the first card's title). Notes kept for Alex: a PIN change on this phone keeps this phone signed in, so its next answer keeps a new copy (the
  old one is gone); while held, the older "Updated just now" line (only with Admin screens round 2 off) and the Do this now cards are as of the copy's
  time; only amounts written as "$" and a digit are dimmed.
- Tests after the fixes: unit 2329 passed, 0 failed (139 files); `e2e/zip12-admin.cjs` 16/16.
- Preview: https://preview-zip12c.pickleball-club-9h0.pages.dev (fake database re-seeded Sat Nov 7, about 10:25 AM Eastern). On there: every switch
  on live (the live rows read with the read-only PIN after the deploy: Card cleanup is ON on live), the three Zip 12 rows, Alert cards (Zip 11's fake
  world), plus Instant admin.
### Deploy (Sat Nov 7, 2026, 8:30 AM Eastern, quiet window, on Alex's "ship it")
- PR #93 merged as `513d7b4` (merge commit; same files as the tested branch head `c1b9519`). Production deployment
  `b2ffeedd-3c71-4edc-bc70-f676d9011d7c` from main, with `ALERT_CARDS` allowed in `wrangler.toml` and the Settings row OFF (no
  `alert_cards_on` row in `task_log`). No migration, no data change. Alex switches it on himself in a quiet window.
- Before it: main equaled live (production `f09f5aac-d683-49bd-a3cb-de9794278759` = `fb44afc`). SQL export `live-before-zip11-2026-11-07.sql`
  (163 KB, not committed, has phone numbers, in that session's scratch folder), Time Travel bookmark
  `00000a56-00000000-0000511c-0e093dc76cfb89a13125ea8e8e563137` (8:21 AM Eastern). Integrity checks: all 21 columns 0 before and after.
- Tests on the merged tree: tsc clean, unit and API 2294 passed, 1 skipped, 0 failed (136 files), build clean.
- Read-only live check (pickleball-club-9h0.pages.dev; pickleball.juncaj.net is not reachable from the sandbox): `/`, `/admin`, `/api/status`,
  `/api/group/version` and an old `/t/` address answer 200; the live script is the same file as the local build (index-Dfr35_8d.js); the read-only
  sign-in works (`viewOnly: true`); the dashboard and the player view carry no `alertCards` flag, `alertCardsForAll` is false; Card cleanup and
  Texts round 2 still on; Activity and Money answer 200; signed out, the dashboard answers 401. Rows unchanged (players 11, games 13, seats 27).
- Rollback: Settings > Feature switches > "Alert cards" off (no deploy); or `ALERT_CARDS = "off"` and a deploy; or Pages deployment
  `f09f5aac-d683-49bd-a3cb-de9794278759` (Zip 10, fb44afc). Note: that rollback build also brings back the game-day check code (it only runs
  with Texts round 2 off, which is on live) and the /t/ page. No data was changed by the deploy, so no restore is needed.

## Alert cards redo + Seat dots (SEAT_DOTS) - built Sat Nov 7, 2026 (quiet window); on a preview, waiting for "ship it"

Spec: the "alerts redo" brief (`mockup/ALERTS_A_final.html`, `vA.png`). Alex switched Alert cards on live, did not like the look (squashed oval
balls, flat cheap cards, titles wrapping badly) and switched it back off. The live Settings row stays OFF; nothing here touches it. No database
change, no migration, nothing deployed to production.

### Part 1: the Alert cards look, redone (behind ALERT_CARDS, still OFF; same behavior and words)
- Cards are drawn like game cards: the game card's own tokens (white `#ffffff` / dark `#18221c`, border `#dad9cf` / `#2b3a31`, ink, muted ink,
  ring), 18 px corners, a round 32 px icon badge on the left tinted by the card's color (green join and paid, amber money, blue credit and
  changes, purple texting, gray neutral, red deadlines), 15.5 px bold titles, 13 px gray lines, 38 px buttons (words never wrap), a round 24 px X
  with a 44 px tap area.
- Pickleballs: the alerts draw their seats with the game card's own `SpotDots` (the `Pickleball` component and the one `EmptySeat`), at the Next
  week card's 16 px: perfect circles, the same skin, stroke and dimples (`e2e/zip11.cjs` compares them with a real game card, light and dark).
- Titles: one line at 390 and 360 (`useFitTitle` in `src/AlertCard.tsx` steps a title that would wrap down by half a pixel, never below 13.5 px,
  and only when its words or its width change); below 360 a long title wraps into two balanced lines. Gray lines wrap "pretty" (no word alone).
  Known: a long organizer title next to a button ("Fri 7:00 PM game: 5 haven't paid" with Remind) still needs two lines (the words stay).
- Phones under 390 get slightly tighter gaps and a 30 px badge so the titles keep their line.

### Part 2: Seat dots (`SEAT_DOTS`, ships OFF)
- One empty-seat component (`EmptySeat`, `src/ui.tsx`), drawn by `SpotDots` everywhere seats show (player cards in every tier, organizer Home cards
  and rows, the Games list, the Want in alert). `src/seat-dots.css` turns it into a slightly grayed dashed ring of the same size under
  `html[data-seat-dots]` (the game card's muted ink at 70 percent: 3.5:1 or better on every card background, light and dark). Filled balls untouched.
  Works with Alert cards on or off.
- Switch: Settings row "Seat dots" (newest first), `PUT /api/admin/seat-dots-switch`, `task_log` row `seat_dots_on`, kill switch `SEAT_DOTS` in
  `wrangler.toml` (allowed; on in `[env.preview.vars]`), private link `?seatdots=on` (header `X-Seat-Dots`), Activity lines, stamp piece `sd`.

### Tests
- Unit: 2297 passed, 1 skipped, 0 failed (136 files). `tests/alert-cards.test.ts` now also checks the tokens equal the game card's, the Seat dots
  switch (off, header, row, kill switch, stamp, Activity) and that there is one empty-seat component.
- Browser: `e2e/zip11.cjs` 26/26 (light and dark, 390/360/320: badges, round 16 px balls equal to the game card's, one-line titles at 390 and
  360, at most two at 320, buttons never wrap; Seat dots on and off with Alert cards on and off, on player and organizer screens; one picture of
  every card for the contact sheet). `e2e/zip11-off.cjs` 44/44 (BOTH switches off = today's main on every screen and after every alert tap).
  Also rerun: zip10, zip7, zip6, zip9, instant-taps pass; money-rework 36/36 alone (its check 6 can fail under a heavy parallel load; main's
  check 2 does the same).
- Fresh reviewer: nothing blocking. Fixed from it: the title fit no longer re-measures on every redraw, measures with offsetHeight; the Seat dots
  rule no longer depends on stylesheet order; the organizer list cards use the fitted title; small tidy-ups.

### Preview
- https://preview-zip11.pickleball-club-9h0.pages.dev, fake database re-seeded. On there: every switch on live, plus Alert cards and Seat dots.
  Seed: Harper is a Thursday regular (the Want in card with balls).

### After Alex tested the preview (Sat Nov 7, 2026, late morning Eastern)
- Preview looked good in light and dark. Answers: (a) 16 px balls matching the real Next week card: right; (b) keep the long organizer titles on
  two lines, words unchanged. "Ship it" with BOTH switches OFF (ALERT_CARDS and SEAT_DOTS); Alex turns them on himself after testing on his phone.
- Main had moved (Zip 12, PR #94, `6ab20fb`, live as `63f84d33`). Rebased on it: conflicts only where both added a switch (kept both); the Seat dots
  row sits above the three speed rows (newest first). The Seat dots read is the shared switch question, so Zip 12's "Fewer database trips" answers it
  from its one read (no extra trip). The preview list keeps the three speed rows on (Zip 12's own tests use them; they are off on live).
- Retested on top of Zip 12: unit 2328 passed, 1 skipped, 0 failed (138 files); browser zip11 26/26, zip12 26/26, zip10, zip7, zip6, zip9,
  instant-taps, money-rework all pass; `e2e/zip11-off.cjs` 44/44 against main `6ab20fb` with every look and speed switch off, as on live.

## Zip 13: Players redo (PLAYERS_REDO), Swap to Alex (SWAP_BUTTON), Undo on admin toasts (ADMIN_UNDO), projected costs fix - built Sat Nov 7, 2026 (afternoon, a quiet window); on a preview, waiting for "ship it"

Spec: the "zip 13" brief (`START_HERE.md`, `SITE_RULES.md`, mockups p6_E, p5_details, p5_edit, p10_headers section A, p10_alex_c, mock5/6/9.html). One PR.
NO database schema change, no migration. Zip 12 and Instant admin were merged and live first (production `5cb45263` = main `aab306b`). Nothing deployed
to production, nothing switched on, no live data read or changed. Each switch's full description is its row in `docs/FEATURE_SWITCHES.md`.

### Item 1: Players redo (`PLAYERS_REDO`, ships OFF)
- `src/pages/admin/PlayersRedo.tsx`, `src/players-redo.css`, used by `PlayersTab.tsx` only while on (off: the same code path as main). Sizes from mock6.html
  (?v=E); colors are the site's tokens (warn/ok/info, the same money colors as everywhere), so light, dark and Color cleanup follow. The month label is the
  site's section line (`week-break`), "Add a person" is the site's `btn ghost block small` (the More sessions look, 44 px), the sheets are the site's
  `Sheet` (new optional `className` and `hideClose` props; left out = as before).
- Numbers: `server/playersRedo.ts`. Row "N played" = the old list's all-time rule counted for this month (dashboard `monthPlayed`, one grouped read,
  only while on). Details: `GET /api/admin/players/:id/summary` (read only). A player's Spent = the old round 3 rule (`spentByPlayer`, now with an
  optional month range). The organizer's Spent = Money Totals "Your cost so far" from the SAME function (`monthlyMoney` became `monthMoneyOf(ctx, group,
  year, month, forceRework)`; Money's own answer is unchanged), All time = the sum of that number for every month from the first game.
- OLD list (answer to the brief): "N played" was ALL TIME (in, game not canceled, game over, not marked "did not play"); round 3's "$108 spent" was ALL
  TIME money paid for games played and finalized, minus credit back; the organizer's own row showed $0 spent (organizer skipped).
- "Held" in the code: money a player put toward a game that is not FINALIZED yet (cash or credit on a paid seat), plus credit on a seat that still owes,
  plus an unconfirmed "I paid" (`heldCents` in `todo.ts`). A game that was played but not finalized still counts as held (the brief said "not happened yet").
### Item 2: Swap to Alex (`SWAP_BUTTON`, ships OFF)
- Header: no ORGANIZER label; "Admin" + gray swap icon are one 44 px button (`TopBar` `onTitle`); "View as…" reads "View as". It opens the group's
  link (your own player page; who it shows is this phone's own pick; nothing signs in or out).
- Player page: "Go to Admin" pill under the end line (`src/swap-button.css`; 30 px, 13 px, 1 px line, no fill; the gap under the line equals the gap above
  it, measured 24 px / 24 px). Server checked: `goToAdminFor` in `server/zip13.ts` (a phone with no organizer cookie gets nothing and costs no trip;
  the read-only PIN does not count; an expired or other group's session does not count). Also at the bottom of a View as page (latched from the organizer
  screen, because View as answers from the demo copy, which has no switch rows).
### Item 3: Undo on admin toasts (`ADMIN_UNDO`, ships OFF)
- Method (a) for every action: the save is HELD 5 seconds (`src/undoHold.ts`; `hold` on `TapQueue.run` in `src/instant.ts`) and dropped on Undo, so an
  undone tap never reaches the server (no record, no history line, no Telegram, no credit). Hidden or closed page: every held save goes at once, with
  keepalive. Built on Instant taps (on live); without it everything saves at once as before. The existing `src/hold.ts` (Remove from game, Drop out) was
  not reused because it allows one hold at a time (a second tap sends the first), and the brief wants two quick taps to each keep their own Undo.
- Toasts: the same banner; new optional `keep` (stays its own time, up to 3 stack, 72 px apart). Found: a modal sheet makes everything outside it
  untappable, so an Undo toast over an open sheet looked tappable but was not (this is also true of the older Remove-from-game Undo on main, left as is).
  Undo banners are drawn inside the open sheet and move out when it closes.
- Has Undo / no Undo: see the `ADMIN_UNDO` row in `docs/FEATURE_SWITCHES.md`.
### Item 4: Projected costs (no switch, live at deploy)
- `server/money.ts`: a game still to come counts in Projected whatever its court status, until it is canceled. Old Totals tests that pinned "only
  Booked counts" now say what the new rule adds (`tests/projectedZip13.ts`).
### Trips and cost
- With the speed switch "decide" (live), the three new switch rows are answered from the one switch read (no new trip); `tests/speed-queries.test.ts`
  counts them as not-main. The player page adds nothing for players (no organizer cookie: no read). The summary endpoint runs only when a row is tapped.
### Fresh review (an independent reviewer who did not write the code)
- Nothing wrong with the three switches off. Fixed from it (all only with Undo on): (1) a held save could go out after "Pretend it's..." began or
  ended, into the wrong database (the demo copy, or live from a demo tap): every held save now checks who it acts as when it goes, and Pretend,
  View as, Sign out and your own player page first wait until every held save has been sent and answered (`afterHolds`, `flushHolds`); (2) View
  as right after two quick held taps could drop the second (same fix); a court switch Undo after a second tap now reloads; Cancel's Undo only
  with Instant taps on, and its "text the group" sheet never pushes another open sheet away; a second tap on a held Money row shows nothing; the
  summary address only exists with the Players redo on; the organizer's All time reads only months that had a finalized or canceled game.
- Left as is (said in the report): a fourth quick held tap drops the oldest Undo banner (its save still goes); a held tap saves after taps made
  after it that had no Undo (they are different things); "N played" updates on the next change, not the moment a game ends.
### Tests (Sat Nov 7, 2026)
- Unit and API: 2348 passed, 1 skipped, 0 failed (140 files); tsc clean; build clean. New: `tests/zip13.test.ts` (15). Updated for the projected
  rule: 15 older Totals tests in 6 files (`tests/projectedZip13.ts` says what the new rule adds); `tests/speed-queries.test.ts` (the Zip 13 rows
  are not main's); `tests/readonly-pin.test.ts` (the summary read with the redo on, still writes nothing).
- Browser: `e2e/zip13.cjs` 36/36 (list rows 46 px one line at 390/360/320 light and dark, chips, details and edit sheets, organizer Spent = Money,
  header at 390/360/320 light and dark, swap and back light and dark, View as, a player never sees it, 13 Undo cases each with the whole database
  compared before and after and no request sent, left alone saves once, polls never flip it, two quick taps, Undo off, Settings rows, private link,
  projected). `e2e/zip13-off.cjs` 27/27 against main `aab306b` (all three off = main on every player and organizer screen, light and dark, 390/360/320
  Players, the organizer's own player page, Settings apart from the three rows, Totals apart from the projected card, a Mark paid tap).
- Full `npm run test:e2e` once, 2 at a time: 48 of 54 scripts clean (money-rework updated for the three new Settings rows). The other 6:
  `run.cjs` (10), `cancel-reason.cjs` (2), `want-in.cjs` (1), `admin-r2.cjs` F4 (1) fail the same way on main (known since Zip 9 / 12);
  `round2.cjs` passed alone (load); `player-fix1.cjs` "I paid on tonight's card" fails 2 of 3 runs on main too (flaky there).
- The Zip 13 seed parts (two organizer games this month, the three rows on) go to the preview database always and to a local test world only when
  asked (`SEED_ZIP13=1`, e2e/zip13.cjs), so every older test keeps its world.
### Preview
- https://preview-zip13.pickleball-club-9h0.pages.dev (fake database re-seeded Sat Nov 7, about 3:00 PM Eastern). On there: every switch on live
  per the repo records (the Zip 11 read of the live rows: Adjust credit, Admin layout v2, round 2 and 3, Card cleanup, Card time and buttons, Color
  cleanup, Home collapse, Instant taps, Last call texts, Late-cancel fee split, Late drops owe $14, Money rework, Ask for payment, No Venmo? note, Pay
  sheet, Simpler player cards, Player fixes, Short games, Texts round 2, Moved-game notice, Tonight glow, Venmo request, both animation switches),
  plus Players redo, Swap to Alex and Undo on admin toasts. Off there as on live: Alert cards, Seat dots and the four speed rows (switched off on the
  preview after the seed).
- Projected (fake November): before 19 courts, $930 total, players $789, your estimate $141; after 22 courts, $1,074, $915, $159 (3 Not booked
  games added; 2 canceled stay out).

### After Alex looked at the preview (Sat Nov 7, 2026, about 4:00 PM Eastern): "ship it after these fixes"
- Answers: Held stays "until finalized". Totals: every month from October 2026 counts the $30 membership, games or not (built; numbers in the
  report). Swap: as is. The old Remove-from-game Undo: fixed (below). Branch name: fine.
- Details sheet header: the pencil is a small 32 px circle right after the name, and the ✕ is back alone at the top right (the Sheet's own),
  light and dark (`Sheet` `titleAfter`, new and optional).
- "Undo is not showing on the preview": the Home card "Who owes you" / "Mark paid tonight" (`src/pages/Admin.tsx` TodoCard) was the one money tap
  left without it (also the older non-rework Money page path). Both have it now. The preview's switch rows were right (Instant taps and Undo on).
  Checked the preview defaults too: each re-seed put Alert cards, Seat dots and the four speed rows back on (then switched off by hand); the preview
  seed now leaves them off as on live (`OFF_ON_LIVE`); local browser tests keep them on as before.
- The old Remove-from-game Undo never worked on live: confirming "Remove Indy?" also closed the Players sheet behind it, and closing that sheet sends
  the held Remove at once (reproduced on main: sent 0.1 s after the confirm). Fixed in `Sheet` (closes only for its own close), plus the toast with a
  button is drawn inside an open sheet (so the Undo can be tapped). Both ship live-on (bug fixes, no switch). `e2e/zip13.cjs` checks it.

## Zip 14: Court number per game (migration 0017) and the Game day card (GAME_DAY_CARD) - built Sat Nov 7 to Sun Nov 8, 2026 (quiet window); on a preview, waiting for "ship it"

Spec: the "zip 14" brief (`START_HERE.md`, mockups mock10.html / p11_court.png / p11_tbd.png for the card, courtmap_mock.html for the map,
courtpicker_mock.html for the organizer picker). One PR. ONE schema change (approved by Alex Nov 6, 3:32 PM). Nothing deployed to production,
nothing switched on, no live data read or changed. The switch's full description is its row in `docs/FEATURE_SWITCHES.md`.

### Item 1: court number per game
- `migrations/0017_court.sql`: `sessions.court INTEGER CHECK (court IS NULL OR court BETWEEN 1 AND 16)`. Additive only; every existing game stays
  NULL; the note is never read or changed. NOT the retired `court_number TEXT` column from 0005 (never shown since Part 4), which stays untouched,
  so an old value can never show on a card.
- Organizer only: `PUT /api/admin/sessions/:id/court-number { court }` (1 to 16, null clears; refused for players 401, the read-only PIN 403,
  and 404 while the switch is off for that phone) and an optional `court` on Add game (ignored while off, as main ignores it; one insert).
  Activity line "Alex set the court for Tue Nov 10 to Court 3" / "cleared the court".
- The Court row (Add game, Edit game) and the picker are behind GAME_DAY_CARD too (Settings row or `/admin?gameday=on` on the organizer's
  phone), so with the switch off every organizer screen is main's. Alex can still fill in courts ahead with the private link.
- Rollback: the build before Zip 14 (main `1a51512`) works unchanged on the migrated database (`e2e/zip14-off.cjs` runs main on it with courts
  set). One exception found by the fresh review: main's View as / Pretend demo builds its copy from main's migrations (no `court`) and loads a
  backup that has it, so on main with the column present the demo will not start ("Something went wrong: table sessions has no column named
  court"). ROLLBACK STEP, one command, only after rolling the code back to a build before Zip 14 (it deletes every saved court; nothing else):
  `npx wrangler d1 execute pickleball --remote --command "ALTER TABLE sessions DROP COLUMN court;"`
  Tested on the preview Sun Nov 8, about 1:15 AM Eastern: main `1a51512` deployed to `preview-zip14-rollback` on the preview database with the
  column: View as failed with that message; after the same command on `pickleball-preview` (`--env preview`): View as opened. The preview was then
  put back (`--file migrations/0017_court.sql`, then a re-seed). To go forward again later: run 0017's ALTER once more (the migrations table
  already lists it). This build's demo leaves out any column its tables lack
  (`backupToSql(backup, columns)`), so later rollbacks are safe.

### Item 2: the game day card (`GAME_DAY_CARD`, ships OFF)
- `src/GameDay.tsx` (buttons, pop-up, court map, Court row), `src/gameday.css` (sizes, colors, motion from the mocks; card rules under
  `html[data-game-day]`), `ScheduleRow` in `src/pages/PlayerHome.tsx`. Game day = the Tonight state (the game's Eastern date, not started, not
  canceled), the same rule the TONIGHT tile uses. Alex, Nov 8 (after the preview): the card stays until the game ENDS, not only until it
  starts, so Court is there for late arrivals (`e2e/zip14.cjs` "during the game", 22/22). The other THIS WEEK cards only get the 17 px "You're in" and 7 px above the balls (the mock).
- The court map is a native `<dialog>` (above an open sheet too), placed under the button that opened it, moved up when there is no room.
- Directions: `directionsUrl(COURT_ADDRESS)` from `shared/zip9.ts` (the one address), on every game day card, court or not, in or not.
- Preview only: `?gamedaytest=on` (needs `GAME_DAY_TEST = "on"`, which only `[env.preview.vars]` has): the next game's date is drawn as today.
- Found, not fixed (older bug, not this zip): Edit game cannot save a game whose end is past midnight (10 PM to 12 AM): the end box is read on
  the start's date, so it looks earlier than the start and the time save answers 400. The preview seed avoids such slots.

### Item 3 (read-only question, nothing built): after Finalize, what a player sees
- No notice or card is made for the finalize itself. The game leaves the player screen once it ends. Credit back shows only as the CREDIT chip at
  the top (the new total; with the page open it counts up from the old amount and pulses once), and its sheet line "Nov 4: $5 back from Nov 3
  (6 played)" (`src/pages/CreditSheet.tsx`, `shared/credit.ts` creditChanges). A player who never paid sees the amber top card "You owe $9 for
  Tue, Nov 3" with "final price" (`PlayerHome.tsx` owe card) and Pay / I paid / Use credit. A paid player never owes more after Finalize (the final
  price is at most $14); the only "owe more" is a late fee (no-show, LATE_FEES), on the same top card.

### Fresh review (an independent reviewer who did not write the code)
- Nothing wrong with the switch off (every new key and the stamp piece only while on; the switch read is the shared one, no new trip; CSS
  under `html[data-game-day]` or new class names; who can set a court; GAME_DAY_TEST cannot reach live; the migration on SQLite).
- Fixed from it: Add game with the switch off now ignores a court, as main does (it was refused); the add is one insert; the court map is
  measured after it opens and scrolls on a very short screen; "Court TBD" keeps its words in its spoken label; one pop-up id per card; the
  saved-copy Directions is not a link; the demo copy leaves out columns its tables lack (and the main rollback note above).

### Tests (Sun Nov 8, 2026)
- Unit and API: 2361 passed, 1 skipped, 0 failed (141 files); tsc clean; build clean. New: `tests/gameday.test.ts` (12). Updated: the seven
  "no migration" pins now name 0017, `tests/zip13.test.ts` (the preview seed rule), `tests/speed-queries.test.ts` (the new row is not main's).
- Browser: `e2e/zip14.cjs` 21/21 (the card at 390/360/320, light and dark; map; pop-up; Directions on iPhone and Android; Reduce Motion;
  Thursday card; I paid; Edit game and Add game Court row; a player and the read-only PIN refused; the Settings row; the preview test link).
  `e2e/zip14-off.cjs` 29/29 against main `1a51512` (switch off = main on every player and organizer screen, light and dark, Indy at
  390/360/320, Edit game and Add game, Settings apart from the new row; main itself running on the migrated database with courts set). Once,
  under load, its two 320 px checks differed and passed alone and in a full rerun (29/29).
- Full `npm run test:e2e` once, 2 at a time, each script on its own port (several scripts share a default port, so a plain parallel run
  collides): 49 of 55 clean; `money-rework` updated for the new Settings row (36/36). The other 5 fail the same way on main: `run.cjs` (10),
  `cancel-reason.cjs` (2), `want-in.cjs` (1, the View as demo; rerun on main this session: same), `admin-r2.cjs` F4 (1), `player-fix1.cjs`
  "I paid on tonight's card" (rerun on main this session: same).

### Preview
- https://preview-zip14.pickleball-club-9h0.pages.dev. Migration 0017 applied to `pickleball-preview` first (Sun Nov 8, about 12:00 AM
  Eastern), then re-seeded. On there (repo records of live): every row on live (Adjust credit, Admin layout v2, round 2 and 3, Card cleanup,
  Card time and buttons, Color cleanup, Home collapse, Instant taps, Last call texts, Late-cancel fee split, Late drops owe $14, Money rework,
  Ask for payment, No Venmo? note, Pay sheet, Simpler player cards, Player fixes, Short games, Texts round 2, Moved-game notice, Tonight glow,
  Venmo request, both animation switches) plus Game day card. Off as on live: Alert cards, Seat dots, the four speed rows, the three Zip 13 rows.

### Deploy (Sun Nov 8, 2026, about 1:20 AM Eastern, a quiet window, on Alex's "ship it") - LIVE with GAME_DAY_CARD OFF
- Alex's answers after the preview: keep the 66 px tile; keep the pop-up under the buttons; keep Court on the card until the game ENDS (built,
  `e2e/zip14.cjs` 22/22); confirm the Zip 13 rows at deploy (below).
- Before: main equaled live (production `94869aa6-18d7-4a28-8843-0203ee9f51f0` = `1a51512`). PR #98 merged as `ca50151`. Unit on merged main:
  2361 passed, 0 failed. SQL export of live (`npx wrangler d1 export pickleball --remote`, 1:04 AM, 175,641 bytes, kept out of git) and Time
  Travel bookmark `00000b31-00000000-0000511d-bf201bc82d56daa739cdd2fb5a514aba` (1:04 AM). Whole database only if ever needed:
  `npx wrangler d1 time-travel restore pickleball --bookmark=00000b31-00000000-0000511d-bf201bc82d56daa739cdd2fb5a514aba`.
  Integrity checks: all 21 columns 0 before and after the migration.
- Migration 0017 applied to live (`npx wrangler d1 migrations apply pickleball --remote`): 13 games, 0 with a court, the 5 notes untouched.
- Production deployment `c96a56e0-b5b6-475a-8946-0cf732357346` = main `ca50151`. ROLLBACK: Pages deployment `94869aa6-18d7-4a28-8843-0203ee9f51f0`
  (Zip 13, `1a51512`), then, only if View as is needed on that build, `npx wrangler d1 execute pickleball --remote --command "ALTER TABLE sessions
  DROP COLUMN court;"` (tested on the preview, see Item 1). Quickest off: Settings > Feature switches > "Game day card" (it is already off).
- Read-only live check (backup address; the custom one does not answer from this sandbox): the live script is the local build's file; sign-in
  with the read-only PIN works (View only); no Game day card flag and no court anywhere (12 games); the `?gameday=on` header turns it on for one
  phone only; setting a court and flipping the switch are refused (403); the player answer has no Game day keys; the preview-only test header
  does nothing on live; Activity and Money answer 200.
- FOUND on live (Q4): the three Zip 13 rows (Players redo, Swap to Alex, Undo on admin toasts) are ON for everyone, and so are Alert cards, Seat
  dots and all four speed rows: every Settings row is on except Game day card. The repo notes had several of them off. The preview seed now
  matches (OFF_ON_LIVE empty) and the preview was re-seeded with them on.
- Later fix (not done, Alex Nov 8): Edit game cannot save a game whose end is past midnight (see Item 2).

## Zip 15: Second Chance (SECOND_CHANCE): same-day games, the two Telegrams, Venmo Request on Home - built Sun Nov 8, 2026 (a quiet window); on a preview, waiting for "ship it"

Spec: the "zip 15" brief (`START_HERE.md`, `SITE_RULES.md`, mockups mock11.html / p12_*.png for the Home card, edit_sheet_mock5.html for the
one wording change). One PR. NO database schema change, no migration. Nothing deployed to production, nothing switched on, no live data
read or changed. The switch's full description is its row in `docs/FEATURE_SWITCHES.md`.

### Housekeeping
- Zip 14's leftover commit `67d58aa` (preview seed matches the live switch rows, deploy notes) was cherry-picked here: it touched only
  `scripts/seed-preview-world.ts`, `docs/PREVIEW_FAKE_DB.md`, `docs/STAGE_NOTES.md` and the seed's own test in `tests/zip13.test.ts`.

### What it does (all behind SECOND_CHANCE, ships OFF)
- Rules in one place: `shared/secondChance.ts` (which games count, the card steps, the texts, the Telegram wording, which Telegram is due).
  Server: `server/secondChance.ts` (switch, card data on the dashboard, the card taps, the Telegrams). Screen: `src/pages/admin/SecondChance.tsx`,
  `src/second-chance.css` (the cards are the site's own alert card, `AlertCard`, Zip 11; sizes from mock11.html).
- Reopen reuses the canceled game: step 2's Reopen game calls the site's own Reopen (`decide` with 'reopen' in `server/admin.ts`): the same
  `sessions` row goes back to Not booked, its people stay in, a paid seat that became credit at the cancel owes again (their credit is still
  in their pot: "Already paid for the canceled game? Tap Use Credit"). A new time then goes through the site's own time change
  (`reschedule`), so the Moved-game notice asks the people in. No new status, no schema change. The original time is kept with the
  `sc_reopened` mark for TEXT 2's "(instead of 7:30)".
- "The night before" = canceled on the Eastern day before the game's date. A game canceled the morning of is not a Second Chance game.
- The cutoff's Cancel game is the site's own cancel with the late-fee question answered "waived" (never booked, so no fee): everyone's money
  goes back as credit, the same as any cancel.
- Telegrams: checked inside the tap after every tap on a game (joins, pays, Use credit, the organizer's Mark paid, roster and I'm in) and on
  the 5-minute clock. Claimed in `task_log` (kind 'sent', one per game by the table's unique index) before sending; only the send itself
  runs after the answer. A failed send gives the claim back (3 tries in all). With the switch on for everyone, a not-booked game today no
  longer gets the older "has 4 now, it's on" alert (Telegram 1 or 2 replaces it); booked games keep it.
- Telegram 1's link is `/admin?unpaid=<game>`: the organizer's own page (sign-in needed) opens a sheet with Messages to ONLY the unpaid
  players who have a phone. No phone number ever travels in a link. The Telegram link filter (`server/telegram-links.ts`) accepts exactly
  that address and nothing looser.
- CourtReserve deep link: no documented way to link to one date and time slot (CourtReserve's help pages only describe the booking page and
  the public booking link), so Telegram 2 and the Book a court buttons use the site's usual booking page (`COURTRESERVE_BOOKING_URL`).
- Request: Venmo through the Remind sheet's own builder (`venmoRequestLinks`): `venmo://paycharge?...` on a phone with the
  `https://venmo.com/?txn=charge&recipients=USER&amount=14&note=Pickleball%20Tue%20Nov%2010` fallback, real %20. The brief's
  `venmo.com/USER?...` form is the one that showed "+" on Alex's phone in Zip 6, so it was kept as is ("keep whatever already works").

### Different from the brief or the mock
- The organizer counts in "3 in" and as paid ("4 signed up and paid" = 3 other players paid plus Alex), the same as the x of y paid pill and
  the rule that the organizer never pays the group.
- "Paid" includes an unconfirmed I paid (the same as the x of y paid pill). Alex still taps Mark paid.
- The step 3 and same-day cards also list who has not paid, with Request or Text (the brief asks for Request on the Second Chance card;
  the mock has no rows). On a phone the Mark paid list puts Mark paid and Request under the name (a long name keeps its line).
- With Alert cards off (not the case on live) the cards fall back to a plain card with the same words and buttons.

### Preview
- `[env.preview.vars]` has `SECOND_CHANCE_TEST = "on"` (never production): `/admin?noontest=on` pretends it is noon on game day for these
  features only, and the Telegrams are a visible fake ("Telegram (preview, not sent)" on Home). See `docs/PREVIEW_FAKE_DB.md`.

### Fresh review (an independent reviewer who did not write the code)
- Fixed from it: (1) with the row off a tap read the group and the row: now only the row (one small read per tap on a game, said in
  FEATURE_SWITCHES); (2) a Telegram that timed out was sent again on the next tap, and the hour's limit used up a try: now the clock's own
  rules (timeout keeps the claim, the limit is not a try); (3) the cutoff cancel was allowed on any same-day not-booked game: now only while the
  card is at its cutoff step, and once 4 had paid it refuses (the court may be booked; the gear menu's Cancel session asks about the fee);
  (4) a reopen whose time change failed could not be finished: the mark is written first (taken back if the reopen fails) and Reopen again
  finishes the move; (5) a regular game the site made that day (a new first session date) could get a same-day card: now only + Add game
  games; (6) the Telegram claim now checks the game is still on and not booked. Also: nothing before 7:00 AM; no names in the words that
  become Telegram 1's link ("Text the 1 who hasn't paid"); drop out, Undo credit and Can't make it check the Telegrams too.
- Left as is (said in the report): a Telegram whose background send is cut off when the worker stops is lost (the claim stays); the old
  "has 4 now, it's on" alert stays off for these games even after Telegram 1 ran out of tries; a fake Telegram on the preview comes from taps
  only (the preview has no clock).

### Tests (Sun Nov 8, 2026)
- Unit: `tests/second-chance.test.ts` (23): the rules, TEXT 1 and 2 exactly, the Telegram wording, fires once (4 paid before 4 in, 6 in 4
  paid, dropouts, booked, canceled, alerts off), exactly 3 (2 in shows nothing), reopen then Use credit to the cent, the cutoff cancel,
  switch off = main, a player refused, the preview fake and pretend noon (and never on live). `tests/speed-queries.test.ts`: the new row is
  not main's.
- Full unit suite on the final code: 2384 passed, 1 skipped, 0 failed (143 files); tsc clean; build clean.
- Browser: `e2e/zip15.cjs` 20/20 (steps 1 to 4 at 390/360/320 light and dark, Reopen at a new time with TEXT 2, Telegram 1 and its
  unpaid-only sheet, Telegram 2 and step 4, each once, Request %20 and Text, Use credit to the cent, the cutoff cancel, the X, a player sees
  nothing, the Settings row, the real clock). `e2e/zip15-off.cjs` 18/18 against main `ca50151` (organizer Home at 390/360/320 light and dark,
  the Edit player sheet's old note, Settings apart from the new row, Players, Money, History, four player homes, no key in any answer, a join
  writes nothing). It ignores a passing "Game on!" pop-up caught mid-slide (its spoken words are still compared).
- Full `npm run test:e2e` once on the final code, 2 at a time, each script on its own port: 51 of 56 clean (`money-rework` updated for the
  new Settings row). The other 5 fail the same way on main: `run.cjs` (10), `cancel-reason.cjs` (2), `want-in.cjs` (1, View as demo),
  `admin-r2.cjs` F4 (1), and `money-rework.cjs` check 6 "Hide from list" (re-run on main `ca50151` this session: same failure).
- Preview: https://preview-zip15.pickleball-club-9h0.pages.dev, the fake database re-seeded Sun Nov 8 with the fixed code. Switch rows on
  there: every row the repo records as on live (all of them, read Nov 8) plus Game day card and Second Chance.

### Round 2 (Alex tested the preview, Sun Nov 8): answers and three fixes - on the preview again, waiting for "ship it"
- Answers: Game day card stays as it is (ON in the preview). "Paid" keeps counting an unconfirmed I paid; Telegram 2 now says so:
  "4 paid for tonight 7:30 PM (1 not confirmed yet). Book it now" (the real number; none: no note). The cancel reason: there is no clean way
  to tell a "short a player" cancel from a holiday one (the reason is free text, optional, and Alex may leave it empty), so the card shows for
  any cancel that fits the rule and the X hides it.
- Fix 1, the time list: every half hour from 4:00 to 9:30 PM still ahead, none left out. Round 1 hid times another game already started at;
  it no longer does (the server still refuses such a time, with a message). The preview's game day now has no other game on the half hours.
- Fix 2, calm previews (`PREVIEW_CALM`, previews only, `shared/previewCalm.ts`): admin Home shows only the Second Chance cards and Mark paid
  tonight; the player page hides its alert cards; `?alerts=all` shows everything on that phone. Every switch stays as on live. Also: "pretend
  noon" now stays on the Second Chance game's day after Reopen (it used to look only for the canceled game, so after a Reopen it could jump to
  another day; the old preview day hid this).
- Fix 3, the compact Mark paid card: LIVE for everyone, no switch (PM leaning; a pure cleanup and the old layout was the problem). See the
  "Not switched (Zip 15 round 2)" part of FEATURE_SWITCHES.md. The Second Chance cards use the same rows (now with Mark paid on each row).
  OFF-equals-main has this one intended difference: `e2e/zip15-off.cjs` compares Home without that card, and compares the card by its people,
  amounts and Mark paid buttons (identical to main).
- Tests (round 2, Sun Nov 8): unit 2388 passed, 1 skipped, 0 failed (`tests/second-chance.test.ts` 27: every half hour, "(1 not
  confirmed yet)", calm flag only on a preview). `e2e/zip15.cjs` 27/27 (adds: the full time list, the calm Home and player page with and
  without ?alerts=all, the compact card at 390/360/320 light and dark: 50 px rows, 34 px buttons, 14 px words, the date once, 5 then "N
  more"). `e2e/zip15-off.cjs` 19/19 against main `ca50151`. The older scripts that touch the Mark paid card: admin-audit, admin-v2, court,
  instant-taps, late-fees, zip6, zip8, zip11, zip13, layout-polish, admin-sweep clean; admin-r2 F4, money-rework 6 and run.cjs (10) fail as
  on main. Preview redeployed and re-seeded (game day Tue Dec 1).
