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
