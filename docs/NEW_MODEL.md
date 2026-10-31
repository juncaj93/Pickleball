# How the money works now (plain English)

Since November 2026 the group plays "any number from 4 to 10" on the one
court. This page is the short version of the rules the site follows.

## Signing up

- Anyone who taps **I'm in** while fewer than the max are in is in. The max
  is a setting (Settings > Group > "Max players per game"), 10 by default,
  anywhere from 4 to 12.
- Past the max you go on the waitlist. When someone drops, the first person
  waiting moves in automatically and the organizer gets a "Spot opened" text
  to send them.
- Fewer than 4 means no game. The organizer cancels it, as before.

## Paying

- Everyone who is in owes the flat price, **$14**, up front. Pay opens Venmo
  for exactly that (or what is left after using credit).
- Under the Pay button, until you pay: "You get credit back if 5 or more play."
- The organizer plays too but never pays the group. They pay the venue for
  the court. Their row on Money shows "You pay Northville Pickleball $48" and
  "Players cover $X, your share $Y".

## After the game: the final price

After the game ends (10:00 PM), the organizer's Home shows a **Finalize**
card: "Tue, Nov 3 · 6 in", a preview like "6 played · $9 each · $5 credit
back each", a green **Everyone played** button, and **Change who played**
(a list with a switch per person; the preview updates as you flip them).

The final price per person is **4 x $14 divided by the number who played,
rounded down to whole dollars**, never more than $14:

| Played | Each pays | Credit back (if you paid $14) |
|-------:|----------:|------------------------------:|
| 4      | $14       | $0                            |
| 5      | $11       | $3                            |
| 6      | $9        | $5                            |
| 7      | $8        | $6                            |
| 8      | $7        | $7                            |
| 9      | $6        | $8                            |
| 10     | $5        | $9                            |

The organizer counts in the number who played (if they played) but never pays.

When the organizer finalizes:

- Everyone who played and paid $14 gets the difference as **credit**.
- Someone who played but paid less (used some credit, or nothing) owes the
  rest of the final price. Pay opens Venmo for exactly that amount. The same
  holds when a price goes up on them (a reopen and a redo with fewer players,
  or the $14 setting raised after they paid): what they paid stays against the
  seat and the difference is owed.
- Someone who did not play gets back everything they paid, as credit.
- Money > Who paid shows "6 played · $9 each", and each row shows what they
  paid and what came back as credit.
- **Reopen** (on the Money tab) undoes the finalize so it can be redone, as
  long as nobody has used or been refunded credit from that game.

If fewer than 4 were in when the game ended, the card offers **Cancel
session** (everyone who paid gets credit) or **Finalize anyway** ($14 each).

The Finalize card stays on Home until it is done, even days later. That card
is the reminder; there is no scheduled job or Telegram nudge for it.

## Credit

- Money that comes back to a player for any reason becomes credit right
  away: they tapped I'm out after paying, the game was canceled, they did
  not play, or they paid more than the final price. Nothing to decide, no
  refund card for the organizer.
- One credit pot per player, whole dollars, no expiry.
- **Credit is used automatically at sign-up** (from Oct 31, 2026). When a
  player taps I'm in (or a claim link, or the organizer adds them, or they
  move in from a waitlist), the server puts their usable credit on that game
  at once, up to the $14 owed, in the same database step as the seat. Usable
  credit = the pot minus a pending cash-out request. Full cover: "Paid with
  credit". Part cover ($3): a "Credit $3 used" chip; "$11 due" and Pay appear
  once the court is booked. It happens even when no court is booked yet; a
  later cancel puts it straight back. Two games: the first one tapped gets it.
  The organizer never uses credit. Nothing that existed before Oct 31 changed.
- **Use credit** (the button) stays for someone already in and unpaid when
  credit arrives later, like the money back from a 5+ player game. That
  money back is never put on games they already joined by itself.
- Drop out, Remove player, cancel and the organizer's **Unmark** (on Money >
  Who paid: "Paid with credit" or "Credit $3") put the credit back at once.
  The 5-second Undo for Drop out sends nothing, so the credit never moves.
- Every one of those saves in ONE all-or-nothing step (since Oct 31): the
  seat leaving (or the game being canceled, finalized, reopened, unmarked)
  and the money moving happen together or not at all, so a request cut off
  halfway can't leave money half-moved, and tapping again finishes or
  changes nothing.
- **An unconfirmed "I paid" is a claim, not money** (Alex, Oct 31). If the player
  drops out (or is removed) or the game is canceled before the organizer
  confirms it, nothing on that seat moves: no credit, and any credit on the
  seat stays on it. Home shows "Ryan tapped I paid ($14), not confirmed.
  Dropped out of Tue, Nov 3." with **Paid** (the money on the seat becomes
  their credit) and **Didn't pay** (the claim is cleared; credit on the seat
  goes back to them). Until then it counts as Held, never Collected. Their drop
  banner says "Your $14 comes back as credit once Alex confirms your payment."
  A rejoin finds the seat as it was. Confirmed payments turn into credit as
  before.
- **Unmark undoes only the latest payment** (Alex, Oct 31): cash paid on top of
  credit goes, and the credit stays on the seat ("Credit $5", $9 due); a second
  Unmark on "Credit $5" puts the credit back. Cash paid earlier toward the seat
  (after a reopen and a redo) always stays.
- The organizer's Mark paid and Unmark carry what the screen showed: if the
  seat changed since (a second device, an old screen, a retried tap), the tap
  is refused with "Ryan's payment just changed. Look again."
- **Changing the $14 setting** (Alex, Oct 31: existing sign-ups keep the price
  they signed at; only new sign-ups use the new price). NOT built yet: the site
  does not store the price each seat signed at, so it needs one new additive
  table; Alex chose to build it as a small separate job after Tue Nov 3 (plan:
  docs/PRICE_SNAPSHOT.md). Until then a change applies to every game not yet
  finalized (paid seats keep what they paid). The $14 setting stays frozen.
- A pending cash out is never used by itself. When it would help pay a game
  just joined, a small question at the bottom asks "Use the $10 you asked to
  cash out for this game?" **Use it** puts it on the game and shrinks the
  request (or withdraws it); the organizer's Home card shrinks or goes and
  Telegram gets one line ("Mitchel withdrew the $10 cash out request (using
  it for Thu Nov 5)"). **No, keep cash out**: they are in and pay as usual.
- **Drop out shows the money at once**: the drop is held on the phone for 5
  seconds for Undo and sent after; the screen draws the credit in right away
  (chip, balance, credit sheet) with "You dropped out. $14 credit returned.",
  and Undo takes it away. If the page closes or loses signal first, a note on
  the phone finishes the drop on return or the next open (up to 2 minutes).
- Players see their credit as a small **CREDIT $14** chip in the header, next
  to the date tile (only when they have some, or a cash out is waiting).
  Tapping it opens a sheet with the balance, **Request cash out**, and the
  last 10 changes in plain words, newest first, returns included:
  "Oct 31: $14 used for Nov 10", "Oct 31: $14 returned from Nov 5 (you
  dropped)", "Nov 3: $5 back from Nov 3 (6 played)", "Nov 4: $14 cashed out".
- The banners say what happened to their money: "You're in. $14 credit
  used." (part cover on a booked court: "You're in. $3 credit used, $11
  due."; no court booked yet: no amount due), and "You dropped out. $14
  credit returned." ("$14 back as credit." when it was cash; just "You
  dropped out." when nothing was paid), with Undo.
  (Banners and the 10-change list: built Oct 31 on a preview, live after Alex's
  "ship it". Until then the sheet shows the older history lines.)
- Nobody ever sees anyone else's credit.

## Refund requests

- A player taps Request refund in the credit sheet, picks an amount (the whole
  balance, or less), and sends it. That amount is reserved: it cannot be
  spent on a game while the request waits. The sheet says "Refund requested:
  $14, pending" with a **Cancel request** link. One open request at a time.
- The organizer gets a Telegram message ("Refund requested: Mitchel wants $14
  back.") and a card at the top of Home: **Refund** opens Venmo for the exact
  amount with the note "Pickleball credit refund", addressed to the player's
  saved Venmo when there is one. After that tap, **Mark refunded** takes it
  off their credit and closes the request (undo is on the Players tab). **Not
  now** returns the amount to their usable credit and removes the card.
- The organizer can still refund a whole balance from the Players tab
  ("Refund credit balance"); it respects a pending request.

## The Money tab

- **Held** (blue): money paid for games that are not finalized yet.
- **Collected**: for finalized games, what the group kept: what each player
  paid minus what came back to them as credit. With everyone paid, that is
  the final price times the players who played (the organizer's own row is
  never counted).
- **Credits owed**: credit still in players' pots from this month's games.
  It was never collected, so it is not taken off Left.
- **Left** = Collected minus Court costs, as before. Credit used on a later
  game counts as collected in the month that game is played.
- Money, Players and each game's list always agree; the tests check it.

## What was removed

The old "exactly 4 or 6" rule, the "5 going, need 4 or 6" card, the $9 price
for the 5th and 6th, the $5 credit for the first four, the Down to 5 and Now 6
texts, the organizer's Refund / Keep as credit card, and the Telegram alerts
"6 down to 5" and "reaches 6". The alerts are now "A game falls below 4" and
"A game reaches 4 (it's on)", plus the one new alert, "Refund requests".
