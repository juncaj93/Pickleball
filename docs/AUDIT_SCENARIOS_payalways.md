# Always ask for payment: scenario list (Mon Nov 2, 2026)

Spec: PAY_SPEC (approved by Alex Sun Nov 1). Base: main ce26ca8 (same code as live, MOTION on).
Everything was tested on a local copy with a throwaway database, fake players and a fake clock,
then on the fake-data preview. Nothing on the live site was changed by testing.

Status: PASS = works as the rules say. ASK = works as the code does today, but it is a question
for Alex before shipping. NOTE = how it already worked before this change, written down.

Where the tests live (ids in the test names match the ids below):
- `tests/pay-always.test.ts`: the switch (S), the court x credit matrix (M), events (E), organizer
  money screens (O), and "the switch never changes money" (Z). 67 tests.
- `e2e/pay-always.cjs`: the same in a real browser, light and dark, 360 and 393 px. 12 checks.

## How it works (plain words)

The server has always worked out what a player owes on every game, used their credit at I'm in,
and given money back as credit on a drop or a cancel, the same way whatever the court status.
Only the player screen hid Pay while the court was not booked (`src/courtDisplay.ts`). The switch
stops that hiding. So no money rule, price, credit math or Venmo link changed. That is why the
matrix below can say "same as Booked" in every row.

## S. The switch

| Id | Scenario | Expected | Status |
|---|---|---|---|
| S1 | `PAY_ALWAYS` var values | Allowed unless "off" (the kill switch) | PASS |
| S2 | Ship state: no test link, Settings off | Off for everyone | PASS |
| S3 | Phone opened once with `?payalways=on` | On for that phone only; other phones off | PASS |
| S3 | Wrong header value ("yes") | Off | PASS |
| S4 | Settings > Money > "Ask for payment on every game" on | On for every phone, no deploy | PASS |
| S4 | Same switch off again | Off for everyone; tapped twice keeps one stored row | PASS |
| S4 | History > Activity | pay_always_on / pay_always_off logged | PASS |
| S5 | Kill switch `PAY_ALWAYS = "off"` | Beats the test link and Settings | PASS |
| S6 | Organizer's View as demo | Always on (same as the moved-game notice) | PASS |
| S7 | A player or a stranger tries to flip it | Refused (not signed in as organizer) | PASS |
| S8 | A page left open when Alex flips it | Picks it up on the next 5-second check | PASS (browser too) |
| S9 | Anything else in the player data | Identical with it on or off | PASS |
| - | `?payalways=off` | Ends the private test on that phone | PASS (browser) |

## M. Sign up on every court status x every credit amount (24 combinations)

For each court (Not booked, Waitlist, Booked) x credit in the pot (none, part $3, exact $14, extra
$20) x switch (off, on), Blair taps I'm in. Checked: the seat, what is owed, credit used, the pot
after, the card, the I'm in banner, the game-day Pay card, the books, the 20 health checks.

| Credit | Server (every court, either switch) | Card with Pay shown | Card with Pay hidden (no court, switch off) | Status |
|---|---|---|---|---|
| None | In, owes $14, pot $0 | "$14 due", Pay, I paid | No money words (as before) | PASS x6 |
| Part $3 | $3 credit used, owes $11, pot $0 | "Credit $3 used", "$11 due", Pay, I paid; banner "You're in. $3 credit used, $11 due." | "Credit $3 used" only; banner "You're in. $3 credit used." | PASS x6 |
| Exact $14 | Paid with credit, pot $0 | "Paid with credit" + Undo, no Pay | Same ("Paid with credit" + Undo) | PASS x6 |
| Extra $20 | Paid with credit, pot $6 | "Paid with credit" + Undo, no Pay | Same | PASS x6 |

"Pay shown" = Booked court, or a Not booked / Waitlist court with the switch on. Game day from 8 AM,
the Pay card at the top follows the same rule (one Pay button only: the row shows the chip).

## E. Events (each on a Not booked court AND on a Waitlist court, switch on)

| Id | Scenario | Expected | Status |
|---|---|---|---|
| E1 | Paid $14 (I paid, organizer confirms), then Drop out | $14 back as credit at once | PASS |
| E1b | I paid NOT confirmed yet, then Drop out | Waits for Alex's Paid / Didn't pay (Home card); Paid makes it $14 credit | PASS (ASK 2) |
| E2 | Organizer Mark paid, then Drop out | $14 back as credit | PASS |
| E3 | $3 credit + $11 cash, then Drop out | $3 back to the pot, $11 back as credit: pot $14 | PASS |
| E4 | Organizer cancels: one paid cash, one part credit + cash, one paid with credit, one unpaid | Each paid player's pot $14; the unpaid one $0; no Pay or due left; the game shows 0 payable | PASS |
| E5 | I paid NOT confirmed yet, then the game is canceled | Waits for Alex's answer, then becomes $14 credit | PASS (ASK 2) |
| E6 | Court booked later | No money record moves; Paid stays Paid, Pay stays Pay | PASS |
| E7 | Booked, paid, then court changed back to Not booked / Waitlist | Paid stays Paid; an unpaid seat keeps Pay (switch on), hides it (switch off) | PASS |
| E8 | Standby on a full game (max 4), with $3 credit | Owes $0, no Pay, no Pay card, credit untouched | PASS |
| E8 | Someone drops, the standby moves in | $3 credit goes on, $11 due, Pay card lists $11 | PASS |
| E9 | Undo on "Paid with credit" | Credit back in the pot, "$14 due" with Use credit and Pay | PASS |
| E10 | Organizer is in | Never asked to pay, never counted as payable | PASS |
| E11 | Drop out with nothing paid | Nothing moves | PASS |
| E12 | Waitlist court, "Didn't open" | Game canceled, every payment back as credit | PASS |
| E13 | Never-booked game ends, nobody cancels | Money stays Held (Money tab), Finalize shows; Cancel game then returns it all | PASS (ASK 1) |
| E14 | Never-booked game that was played, 5 paid, Finalize | Same price table: $11 each, $3 back each | PASS |
| E15 | Switch OFF, a never-booked game has ended | The game-day Pay card already listed it before this change | NOTE |

## O. Organizer money screens

| Id | Scenario | Expected | Status |
|---|---|---|---|
| O1 | Early payments on a Not booked and a Waitlist game | "1 of 2 paid" pill, Players row Paid $14, Money Held $28 | PASS |
| O2 | Game canceled after an early payment | Month Held $0, Collected $0, game row Canceled, Blair's credit $14 on Players | PASS |
| O3 | Cash out of that credit | Request goes in as usual | PASS |
| - | Organizer screens before this change | Already counted payments on every court status; no organizer code changed except the new Settings row | PASS |

## Z. The switch never changes money

| Id | Scenario | Expected | Status |
|---|---|---|---|
| Z1 | Same 40 random taps (join, drop, Mark paid, Use credit, Undo, court switch, cancel, reopen) with the switch off, on by test link, on by Settings | Identical pots, held money and seats; all 20 health checks 0 after every step | PASS |
| Z2 | Banner text helper | "$ due" only where the card shows it | PASS |
| Z3 | "Want in?" card, Yes, on a game with no court | Banner and answer card say "$11 due" only when the card shows it | FIXED (older bug, found by the fresh code review; e2e want-in and suggest green, checked on the preview both ways) |

## Questions for Alex (from the ASK rows)

1. **No game cancels by itself.** When a court is never booked, or fewer than 4 sign up, the game
   stays on the schedule until you tap Cancel (or "Didn't open" on a Waitlist court, or "Cancel game"
   on the "Did you guys play?" card). The moment you do, every payment comes back as credit
   automatically. Until then it sits as Held on the Money tab and the Finalize card stays up. With
   this switch on, more players will have paid before a court is booked, so a forgotten game holds
   more money. PAY_SPEC item 4 says to stop and ask here. Options: (a) keep it as is, you cancel by
   hand (nothing to build); (b) the site cancels a game by itself, for example when the court is still
   not booked at the cancel-by time, or the day after it was due to be played. (b) is new behavior and
   would be a separate change.
2. **An "I paid" you have not confirmed** on a game that is then canceled (or that the player drops)
   waits for your Paid / Didn't pay on Home before it becomes credit. That is your Oct 31 rule for
   booked games and it is the same here. Keep?
