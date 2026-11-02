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
   Venmo link moved here from Settings > Group (same setting, same save, the rest of Settings untouched). Control bar a little shorter.
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
