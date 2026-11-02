# New admin layout (ADMIN_V2): scenario list (Mon Nov 2, 2026)

Spec: ADMIN_SPEC (Alex, Nov 2). Same theme, colors and shared styles as today; only layout and density change.
Everything was tested on a local copy with a throwaway database, fake players and a fake clock. Nothing on the live site was touched.

Where the tests live: `tests/admin-v2.test.ts` (the switch, 8) and `e2e/admin-v2.cjs` (the screens, in a real browser). The
motion item is in `e2e/admin-motion.cjs` (two checks were rewritten: no ball, no rise).
Status: PASS = works as the spec says. NOTE = how it works, written down. ASK = a question for Alex.

## S. The switch
| Id | Scenario | Expected | Status |
|---|---|---|---|
| S1 | Ship state | Off for everyone; the screens are exactly today's (no new parts in the page) | PASS |
| S2 | `/admin?adminv2=on` | On for that phone only; `?adminv2=off` ends it | PASS |
| S3 | Settings > Feature switches > New admin layout | On for every phone, no deploy, logged in History > Activity | PASS |
| S4 | `ADMIN_V2 = "off"` in wrangler.toml | Beats the test link and Settings | PASS |
| S5 | A stranger or a player flips it | Refused | PASS |
| S6 | Anything else in the dashboard answer | Identical with it on or off | PASS |

## H. History
| Id | Scenario | Expected | Status |
|---|---|---|---|
| H1 | Open History | Two tabs, Activity (first) and Sessions. No All | PASS |
| H2 | Sessions | Today's old list, unchanged | PASS |
| H3 | First ever visit on a phone | No NEW group, no dividers | PASS |
| H4 | Come back after 2 new things | "NEW SINCE <last visit> · 2", then "VIEWED" | PASS |
| H5 | Stay on the tab, switch to Sessions and back | NEW stays | PASS |
| H6 | Leave the tab, come back | Nothing is new any more | PASS |
| H7 | Close the site (pagehide / put away) | Visit is saved too | NOTE (code path; the browser test uses a tab change) |
| H8 | Private mode / storage blocked | Behaves like a first visit every time (no NEW group) | NOTE |

## M. Money
| Id | Scenario | Expected | Status |
|---|---|---|---|
| M1 | Open Money | One control row, no big heading, Who paid. Totals then another tab then back: Who paid again | PASS |
| M2 | Games | Next game open, the rest one line each (date, x of y paid, chip, chevron). Any number open | PASS |
| M3 | Rows | Name + second line, chip, gray button: same columns on every row, court row included | PASS |
| M4 | Mark paid / Unmark (player rows and the court row) | Same calls, same amounts as before | PASS |
| M5 | Tap a row | The whole money line ("paid $14 on Wed, Oct 28 · not finalized yet"); Unmark next to a confirming Mark paid shows here | PASS |
| M6 | Remind N | A list of the unpaid players, each with their own Text link to one number and today's reminder. Never a group text | PASS |
| M7 | Canceled game | One closed line "canceled"; opening shows today's notice and the credit list | PASS |
| M8 | Totals | Same numbers and math as today; Held now always shows (it hid at $0 before) so the grid is even | PASS |
| M9 | Totals on a phone | One screen, no scrolling, at 390x844, 375x667, 360x740 | PASS |
| M10 | 320 px and 200 percent text | Nothing cut off; rows stack (name on top, chip and button under it) | PASS |
| M11 | "Remind all unpaid" (one text to several people, old layout) | Not in the new layout (spec: never a group text) | ASK |
| M12 | Who paid and the month | Who paid still lists every game (an unpaid game from last month must stay visible); the month stepper drives Totals | ASK |

## C. Home
| Id | Scenario | Expected | Status |
|---|---|---|---|
| C1 | Open Home | Top 2 games are today's full cards; later ones short rows with tile, "2 of 4 in", start time, names, pill, "In", chevron | PASS |
| C2 | Tap a tile or empty space | Opens or folds that game; any number open | PASS |
| C3 | Tap a button, switch, gear or link | Does its job, never folds | PASS |
| C4 | Refresh or reopen | Back to the top 2 | PASS |
| C5 | Court still needs to be booked | No separate card; the message and Book a court are on the game's own card (and the message shows on its short row) | PASS |
| C6 | Cash out, smart Do this now cards, + Add game, Book a court, week labels, Booking opens... | Unchanged | PASS |
| C7 | Reduce Motion | No fade at all | PASS |
| C8 | A game that needs the court is a short row | Its row says so; the Book a court button is one tap away (open the row) | NOTE |

## A. Motion fix (MOTION_ADMIN)
| Id | Scenario | Expected | Status |
|---|---|---|---|
| A1 | Load a screen | Nothing rises; cards appear in place | PASS |
| A2 | Slow load | After 250 ms the same placeholder cards the player page uses (shimmer), no bouncing ball | PASS |
| A3 | Switch off | The plain spinner, as before | PASS |

## L. Label on Edit game (item 5)
| Id | Scenario | Expected | Status |
|---|---|---|---|
| L1 | Edit game, new layout | A short Label field, same style as Date and Start, prefilled with the game's current label, saved with Save | PASS |
| L2 | Clear it | Empty clears the label | PASS |
| L3 | Over 80 characters | Refused (same limit as when adding a game) | PASS |
| L4 | Extra game | The "Extra game" tag stays; only the label text changes | PASS |
| L5 | Switch off | No Label field in the sheet | PASS |
| L6 | Where it is stored | The game's existing note column: no database change | NOTE |

## R. Remove a canceled game from the player screen (item 6)
| Id | Scenario | Expected | Status |
|---|---|---|---|
| R1 | Gear menu of a canceled game, new layout | "Remove from player screen" (or "Show on player screen again"); never on a live game; not in the old layout | PASS |
| R2 | After removing | Players no longer see it, also after refresh; the organizer still sees it on Home (tagged "Not shown to players"), History > Sessions, Money | PASS |
| R3 | Money and credit | Ledger, seats, credit balance, credit history rows, month totals identical before and after | PASS |
| R4 | Show again | Undo restores it; same call twice changes nothing | PASS |
| R5 | Only canceled games | Hiding a live game is refused; reopening a hidden game clears the hide | PASS |
| R6 | Kill switch `ADMIN_V2 = "off"` | Every hidden game shows to players again | PASS |
| R7 | Open player phones | Told something changed within 5 seconds | PASS |
| R8 | How it is stored | One row in the existing task_log table per hidden game; no new column, no migration. A backup restore empties task_log, so hidden games would show again (never lost money) | NOTE |
