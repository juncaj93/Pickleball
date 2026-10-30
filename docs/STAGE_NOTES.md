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
