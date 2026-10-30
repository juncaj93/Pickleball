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
- One credit pot per player, whole dollars, no expiry. It is used on any
  later game with **Use credit** (partial credit works: "Used $5 credit. $9
  left to pay.").
- Players see their credit as a small **CREDIT $14** chip in the header, next
  to the date tile. Tapping it opens a sheet with the balance, the history
  ("+$5 Thu, Oct 29 (6 played)", "-$14 used for Tue, Nov 3"), and **Request
  refund**.
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
