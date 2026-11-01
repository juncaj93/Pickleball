# Admin audit scenarios (organizer screens at /admin)

Audit 2 of 3, started Sun Nov 1, 2026. Scope: everything the organizer can hit at
/admin, plus the "View as" demo. Rules: SITE_RULES.md and docs/STAGE_NOTES.md; the
code is the truth.

How each one was checked:
- **API**: vitest against the real server code on a throwaway SQLite database with a fake clock (`tests/harness.ts`).
- **UI**: Playwright on a throwaway dev server (`DEV_DB`, `DEV_CLOCK`) at 390 px and 320 px, light and dark.
- **Code**: read the code path end to end (used only when a test adds nothing).

Status: **pass**, **fixed** (bug found, fixed, test added), **built** (requested change,
built with tests), **question** (odd, maybe on purpose: see QUESTIONS in the report),
**open** (not fixed, with why).

Test files: `tests/admin-audit.test.ts` (API and logic), `e2e/admin-audit.cjs` (browser).

## 1. Sign in (S)

| # | Scenario | Expected | How | Status |
|---|---|---|---|---|
| S1 | Correct PIN | Home loads, cookie set, HttpOnly, SameSite | API+UI | pass (existing: tests/admin-security.test.ts, e2e/gates.cjs) |
| S2 | Wrong PIN once | "Wrong PIN" style message, no session cookie | API+UI | pass (new: tests/admin-audit.test.ts) |
| S3 | 5 wrong PINs in a row | Locked: "Too many wrong PINs. Wait 15 minutes" | API | pass (new: tests/admin-audit.test.ts) |
| S4 | Right PIN while locked | Still refused until the 15 minutes pass | API | pass (new: tests/admin-audit.test.ts) |
| S5 | Lockout ends after 15 minutes (fake clock) | Right PIN works again | API | pass (new: tests/admin-audit.test.ts) |
| S6 | Empty PIN / letters / 50 digits | Refused cleanly, no crash | API | pass (new: tests/admin-audit.test.ts) |
| S7 | Expired session cookie | Every admin call 401, screen goes back to the PIN form | API+UI | pass (new: tests/admin-audit.test.ts) |
| S8 | Signed in on two phones | Both work; sign out on one leaves the other signed in (or both out, by design) | API | pass (new: tests/admin-audit.test.ts) |
| S9 | Sign out | Cookie cleared; Back button does not show admin data after reload | API+UI | pass (existing: tests/admin-security.test.ts, e2e/gates.cjs) |
| S10 | Direct URL /admin signed out | PIN form, no admin data in the page | UI | pass (existing: tests/admin-security.test.ts, e2e/gates.cjs) |
| S11 | Direct URL /admin?tab=money etc. signed out | PIN form | UI | pass (existing: tests/admin-security.test.ts, e2e/gates.cjs) |
| S12 | PIN form at 320 px | Fits, no sideways scroll, keypad numeric | UI | pass (new: e2e/admin-sweep.cjs) |
| S13 | Change PIN in Settings with wrong current PIN | Refused | API | pass (existing: tests/admin-security.test.ts) |
| S14 | Change PIN, then old PIN | Old PIN refused, new PIN works | API | pass (existing: tests/admin-security.test.ts "changes the PIN and signs out other organizer devices") |
| S15 | Player cookie on /admin | PIN form (player session is not an admin session) | API | pass (new: tests/admin-audit.test.ts) |

## 2. Home and "Do this now" (H)

| # | Scenario | Expected | How | Status |
|---|---|---|---|---|
| H1 | Nothing to do | No Do this now section at all | UI | pass (existing: e2e/do-now.cjs) |
| H2 | Booked game, last call time (25 h before start) | Night-before card "Tonight/weekday: N in" + Text the group | API | pass (existing: tests/smart-tasks.test.ts, tests/tick-fast.test.ts golden file, e2e/do-now.cjs) |
| H3 | Night card, Text the group tapped | Card gone after reload, mark saved | API | pass (existing: tests/smart-tasks.test.ts, tests/tick-fast.test.ts golden file, e2e/do-now.cjs) |
| H4 | Booked game under 4 at the cancel warning | 3-step cancel checklist | API | pass (existing: tests/smart-tasks.test.ts, tests/tick-fast.test.ts golden file, e2e/do-now.cjs) |
| H5 | Cancel checklist, Court canceled tapped | Step 1 done, step 2 current | API | pass (existing: tests/smart-tasks.test.ts, tests/tick-fast.test.ts golden file, e2e/do-now.cjs) |
| H6 | Cancel checklist, session canceled from the card | Step 2 done, step 3 enabled | API | pass (existing: tests/smart-tasks.test.ts, tests/tick-fast.test.ts golden file, e2e/do-now.cjs) |
| H7 | Cancel checklist, canceled text sent | Card gone | API | pass (existing: tests/smart-tasks.test.ts, tests/tick-fast.test.ts golden file, e2e/do-now.cjs) |
| H8 | Game reaches 4 while the cancel card shows | Cancel card gone | API | pass (existing: tests/smart-tasks.test.ts, tests/tick-fast.test.ts golden file, e2e/do-now.cjs) |
| H9 | Booking day (game 14 days out, 6:45 AM) | "opens at 7:00 AM" card with Book + I booked it | API | pass (existing: tests/smart-tasks.test.ts, tests/tick-fast.test.ts golden file, e2e/do-now.cjs) |
| H10 | Booking day card after booking | Gone | API | pass (existing: tests/smart-tasks.test.ts, tests/tick-fast.test.ts golden file, e2e/do-now.cjs) |
| H11 | Morning-of, 4+ in, no court | "N in, no court yet" card | API | pass (existing: tests/smart-tasks.test.ts, tests/tick-fast.test.ts golden file, e2e/do-now.cjs) |
| H12 | Not booked game, window open | One "no court" card per game, at most 2 games | API | pass (existing: tests/smart-tasks.test.ts, tests/tick-fast.test.ts golden file, e2e/do-now.cjs) |
| H13 | Waitlist game | Exactly one court card for it (no extra no-court card) | API | pass (new: tests/admin-audit.test.ts) + pass (new: e2e/admin-audit.cjs) |
| H14 | Booked game | No court card at all | API | pass (new: tests/admin-audit.test.ts) + pass (new: e2e/admin-audit.cjs) |
| H15 | Canceled game | No court card at all | API | pass (new: tests/admin-audit.test.ts) + pass (new: e2e/admin-audit.cjs) |
| H16 | Same game qualifies for booking-day and no-court-later | One card only | API | pass (existing: tests/smart-tasks.test.ts, tests/tick-fast.test.ts golden file, e2e/do-now.cjs) |
| H17 | Two Waitlist games | Two cards, soonest first | API | pass (new: tests/admin-audit.test.ts) + pass (new: e2e/admin-audit.cjs) |
| H18 | Court card disappears right after the switch moves to Booked | Gone on the next load | UI | pass (new: tests/admin-audit.test.ts) + pass (new: e2e/admin-audit.cjs) |
| H19 | Finalize card after a played game (4+) | "Everyone played" / "Change who played" | UI | pass (existing: tests/finalize.test.ts, e2e/credit.cjs) |
| H20 | Finalize card under 4 | Cancel session / Finalize anyway | UI | pass (existing: tests/finalize.test.ts, e2e/credit.cjs) |
| H21 | Cash-out request | Card at the very top with Refund (Venmo), Mark refunded after Refund, Not now | UI | pass (existing: tests/credit.test.ts, tests/decisions-oct31.test.ts, e2e/money-visible.cjs) |
| H22 | Unconfirmed I paid on a seat that left | Claim card Paid / Didn't pay | API | pass (existing: tests/credit.test.ts, tests/decisions-oct31.test.ts, e2e/money-visible.cjs) |
| H23 | Late drop | Late drop card with names and Done | API | pass (existing: tests/late-drops-calendar.test.ts) |
| H24 | Late drop Done | Card gone, Done saved per player | API | pass (existing: tests/late-drops-calendar.test.ts) |
| H25 | Who owes you (from check-in time) | Card lists unpaid seats with Mark paid | API | pass (existing: tests/decisions-oct31.test.ts moneySeen, tests/audit-r4.test.ts) |
| H26 | Game day unpaid | "Mark paid tonight" card instead | API | pass (existing: tests/decisions-oct31.test.ts moneySeen, tests/audit-r4.test.ts) |
| H27 | Mark paid on Who owes after the seat changed (stale) | Refused with "look again", nothing paid | API | pass (existing: tests/decisions-oct31.test.ts moneySeen, tests/audit-r4.test.ts) |
| H28 | Order: money cards, Do this now, Finalize, texts, Needs attention, games | As listed | UI | pass (new: e2e/admin-sweep.cjs) |
| H29 | "+N more" on Do this now | Expands, "Show less" collapses | UI | pass (existing: e2e/do-now.cjs) |
| H30 | Wording: no "undefined", "NaN", "null", raw ids, UTC times | Clean | UI | pass (new: e2e/admin-sweep.cjs) |
| H31 | Spot opened card (waitlist moved in) | "Spot opened" with Text | UI | pass (existing: tests/suggestions.test.ts, e2e/suggest.cjs) |
| H32 | Need players card within 48 h | Shown, one per game | API | pass (existing: tests/suggestions.test.ts, e2e/suggest.cjs) |
| H33 | Check-in card from the last call | Shown unless covered by Do this now (booked games) | API | pass (existing: tests/suggestions.test.ts, e2e/suggest.cjs) |
| H34 | Final price card after finalize | Shown, hides after Text | API | pass (existing: tests/suggestions.test.ts, e2e/suggest.cjs) |
| H35 | Payment reminder 7+ days after an unpaid game | Shown | API | pass (existing: tests/suggestions.test.ts, e2e/suggest.cjs) |
| H36 | Text tapped on a suggestion | Hidden on this phone until the situation changes | API | pass (existing: tests/suggestions.test.ts, e2e/suggest.cjs) |
| H37 | Stale card after the thing was done on another phone | Gone on the next refresh | UI | pass (existing: e2e/admin-cleanup.cjs live refresh) |
| H38 | Badge count on Home tab | Needs attention + courts to book | API | pass (existing: tests/smart-tasks.test.ts, tests/tick-fast.test.ts golden file, e2e/do-now.cjs) |

## 2b. Requested: court card for games never booked (item 16) (C)

| # | Scenario | Expected | How | Status |
|---|---|---|---|---|
| C1 | Waitlist game, before it is over | "Court still needs to be booked" + Book on CourtReserve, nothing else | API+UI | built (tests/admin-audit.test.ts, e2e/admin-audit.cjs) |
| C2 | Not booked game, before it is over (card rules as before: window open, next 2) | Same card | API+UI | built (tests/admin-audit.test.ts, e2e/admin-audit.cjs) |
| C3 | Book button opens the CourtReserve booking link (same as "Book a court") | Same href, new tab | UI | built (tests/admin-audit.test.ts, e2e/admin-audit.cjs) |
| C4 | No "Court opened" / "Didn't open" anywhere | Gone | UI | built (tests/admin-audit.test.ts, e2e/admin-audit.cjs) |
| C5 | Game day passed (next calendar day, Eastern), never booked, not canceled, someone in | "Did you guys play?" Yes, we played / Cancel game; no court link | API+UI | built (tests/admin-audit.test.ts, e2e/admin-audit.cjs) |
| C6 | Same game on its own day after the end | No court card (game date not passed yet) | API | built (tests/admin-audit.test.ts, e2e/admin-audit.cjs) |
| C7 | Cancel game | Existing Cancel session dialog; confirm cancels; credit back to every paid player once | API+UI | built (tests/admin-audit.test.ts, e2e/admin-audit.cjs) |
| C8 | Cancel game double tap | One cancel, money back once | API | built (tests/admin-audit.test.ts, e2e/admin-audit.cjs) |
| C9 | Yes, we played (4+ in, not finalized) | No money moves; card gone; Finalize card brought into view | API+UI | built (tests/admin-audit.test.ts, e2e/admin-audit.cjs) |
| C10 | Yes, we played (under 4) | No money moves; card gone; Finalize card (Cancel / Finalize anyway) remains | API | built (tests/admin-audit.test.ts, e2e/admin-audit.cjs) |
| C11 | Yes, we played on a second phone | Card gone there too (saved on the server) | API | built (tests/admin-audit.test.ts, e2e/admin-audit.cjs) |
| C12 | Already canceled game | No card at all | API | built (tests/admin-audit.test.ts, e2e/admin-audit.cjs) |
| C13 | Booked game (before or after) | None of these cards | API | built (tests/admin-audit.test.ts, e2e/admin-audit.cjs) |
| C14 | Switch moved to Booked after the fact | Card gone, seats/payments/credit unchanged | API | built (tests/admin-audit.test.ts, e2e/admin-audit.cjs) |
| C15 | Finalized game | No "did you play" card | API | built (tests/admin-audit.test.ts, e2e/admin-audit.cjs) |
| C16 | Past game with nobody in | No card (nothing to answer) | API | built (tests/admin-audit.test.ts, e2e/admin-audit.cjs) |
| C17 | Clock change Sun Nov 1 (game Sat Oct 31) | Card appears at midnight Eastern, not UTC | API | built (tests/admin-audit.test.ts, e2e/admin-audit.cjs) |
| C18 | Moving the switch never changes a seat, payment or credit (all 6 directions) | Unchanged | API | built (tests/admin-audit.test.ts, e2e/admin-audit.cjs) |
| C19 | Telegram alerts unchanged by the card change | Same alert list | API | built (Telegram list unchanged: tests/tick-fast.test.ts golden file passes) |
| C20 | View as demo: the cards do nothing real | Demo only | UI | built (demo saves nothing: e2e/admin-sweep.cjs) |
| C21 | Finalized the same evening, reopened the next day | Never asked "Did you guys play?"; finalize task shows | API | fixed (auditor A; tests/admin-audit.test.ts C15b) |
| C22 | Past game still asked | Only "Did you guys play?"; its Finalize card waits for the answer, then shows with focus | UI | fixed (auditor A; e2e/admin-audit.cjs) |
| C23 | Two games on one date | Court cards show date and start time | UI | fixed (auditor A) |
| C24 | Book link wording | "Book a court", same link and look as the pill | UI | built (e2e/run.cjs kept-words check) |

## 2c. Requested: dismiss X on notice cards (item 15) (X)

| # | Scenario | Expected | How | Status |
|---|---|---|---|---|
| X1 | Spot opened card | X top right, 44 px tap area, hides it | UI | built (tests/admin-audit.test.ts, e2e/admin-audit.cjs) |
| X2 | Need players / Check-in / Final price cards | X hides | UI | built (tests/admin-audit.test.ts, e2e/admin-audit.cjs) |
| X3 | Reload after X | Still hidden (this phone only) | UI | built (tests/admin-audit.test.ts, e2e/admin-audit.cjs) |
| X4 | Different player moves in (new Spot opened) | New card shows | API | built (tests/admin-audit.test.ts, e2e/admin-audit.cjs) |
| X5 | Count changes on Need players | Card comes back | API | built (tests/admin-audit.test.ts, e2e/admin-audit.cjs) |
| X6 | Another phone / cleared storage | Card shows there | UI | built (tests/admin-audit.test.ts, e2e/admin-audit.cjs) |
| X7 | Storage blocked (private mode) | X still hides for this visit, no crash | API | built (tests/admin-audit.test.ts, e2e/admin-audit.cjs) |
| X8 | Cards that need a decision or money (cash out, claims, finalize, who owes, court card, did you play, cancel checklist, payment reminder) | No X | UI | built (tests/admin-audit.test.ts, e2e/admin-audit.cjs) |
| X9 | X has a screen-reader label naming the card | "Dismiss ..." | UI | built (tests/admin-audit.test.ts, e2e/admin-audit.cjs) |
| X10 | X at 320 px does not cover the card's words | No overlap | UI | built (tests/admin-audit.test.ts, e2e/admin-audit.cjs) |
| X11 | Live refresh after X | Stays hidden | UI | built (tests/admin-audit.test.ts, e2e/admin-audit.cjs) |
| X12 | No database change | Only browser storage | Code | built (browser storage only, key pb_card_dismissed) |
| X13 | Quick double tap on an X | Hides one card, not the one that slides up | UI | fixed (auditor B; e2e/admin-audit.cjs, fails without the fix) |
| X14 | X or Text inside Pretend it's... | Demo only; the phone's real list unchanged after End | UI | fixed (auditors A and B; auditB/a15.cjs) |
| X15 | Night card dismissed, game moved to another day | Card comes back on the new night | UI | fixed (auditor B; auditB/a15.cjs) |

## 3. Game cards and the court switch (G)

| # | Scenario | Expected | How | Status |
|---|---|---|---|---|
| G1 | Not booked -> Waitlist | Saved at once; players see "Court not booked"; seats, payments, credit unchanged | API | pass (existing: tests/admin-cleanup.test.ts, tests/waitlist-seats.test.ts; new: C18 in tests/admin-audit.test.ts) |
| G2 | Waitlist -> Booked | Pay prompts appear for players; seats unchanged; Add to calendar appears | API+UI | pass (existing: tests/admin-cleanup.test.ts, tests/waitlist-seats.test.ts; new: C18 in tests/admin-audit.test.ts) |
| G3 | Booked -> Not booked | Pay prompts gone, payments kept | API | pass (existing: tests/admin-cleanup.test.ts, tests/waitlist-seats.test.ts; new: C18 in tests/admin-audit.test.ts) |
| G4 | Not booked -> Booked | As G2 | API | pass (existing: tests/admin-cleanup.test.ts, tests/waitlist-seats.test.ts; new: C18 in tests/admin-audit.test.ts) |
| G5 | Booked -> Waitlist | As G3, players never see "waitlist" | API | pass (existing: tests/admin-cleanup.test.ts, tests/waitlist-seats.test.ts; new: C18 in tests/admin-audit.test.ts) |
| G6 | Waitlist -> Not booked | Unchanged for players | API | pass (existing: tests/admin-cleanup.test.ts, tests/waitlist-seats.test.ts; new: C18 in tests/admin-audit.test.ts) |
| G7 | Switch on a canceled game | Refused cleanly / not shown | API+UI | pass (existing: tests/admin-cleanup.test.ts, tests/waitlist-seats.test.ts; new: C18 in tests/admin-audit.test.ts) |
| G8 | Switch on a finished game | Refused "This session is over" / not shown | API+UI | pass (existing: tests/admin-cleanup.test.ts, tests/waitlist-seats.test.ts; new: C18 in tests/admin-audit.test.ts) |
| G9 | Switch on a full game (max) with a real waitlist | Real waitlist stays; nobody moved | API | pass (existing: tests/admin-cleanup.test.ts, tests/waitlist-seats.test.ts; new: C18 in tests/admin-audit.test.ts) |
| G10 | Switch on an under-4 game | Same rules | API | pass (existing: tests/admin-cleanup.test.ts, tests/waitlist-seats.test.ts; new: C18 in tests/admin-audit.test.ts) |
| G11 | Switch on an extra game | Same | API | pass (existing: tests/admin-cleanup.test.ts, tests/waitlist-seats.test.ts; new: C18 in tests/admin-audit.test.ts) |
| G12 | Switch on a game in 6 months | Works | API | pass (existing: tests/admin-cleanup.test.ts, tests/waitlist-seats.test.ts; new: C18 in tests/admin-audit.test.ts) |
| G13 | Switch on a game today | Works; night card follows | API | pass (existing: tests/admin-cleanup.test.ts, tests/waitlist-seats.test.ts; new: C18 in tests/admin-audit.test.ts) |
| G14 | Double tap a segment | One change, no error | API+UI | pass (existing: tests/admin-cleanup.test.ts, tests/waitlist-seats.test.ts; new: C18 in tests/admin-audit.test.ts) |
| G15 | Tap the segment already chosen | Nothing sent | UI | pass (existing: tests/admin-cleanup.test.ts, tests/waitlist-seats.test.ts; new: C18 in tests/admin-audit.test.ts) |
| G16 | Two phones flip at once | Last one wins, never half way | API | pass (existing: tests/admin-cleanup.test.ts, tests/waitlist-seats.test.ts; new: C18 in tests/admin-audit.test.ts) |
| G17 | "Not booked" on two lines, same segment height as the others | Yes, at 320 and 390 | UI | pass (existing: e2e/admin-cleanup.cjs; new: e2e/admin-sweep.cjs) |
| G18 | Card with 1, 3, 10 names, long names | Even spacing, no overlap, no pill when nobody is in | UI | pass (existing: e2e/admin-cleanup.cjs; new: e2e/admin-sweep.cjs) |
| G19 | "x of y paid" pill | Correct numbers, organizer left out; opens Players | API+UI | pass (existing: e2e/admin-cleanup.cjs; new: e2e/admin-sweep.cjs) |
| G20 | Cancel-by line | Only within the last 24 hours before cancel-by | UI | pass (existing: e2e/admin-cleanup.cjs; new: e2e/admin-sweep.cjs) |
| G21 | Telegram text after switching | Booked gates the night alert; not booked gets no last call | API | pass (existing: tests/admin-cleanup.test.ts, tests/waitlist-seats.test.ts; new: C18 in tests/admin-audit.test.ts) |
| G22 | Players screen after each of the 6 moves | Status words right, no "waitlist", "waiting", "standby" | API | pass (existing: tests/admin-cleanup.test.ts, tests/waitlist-seats.test.ts; new: C18 in tests/admin-audit.test.ts) |
| G23 | Waitlist flag (court_state) after each move | Waitlist sets it; others clear it | API | pass (existing: tests/admin-cleanup.test.ts, tests/waitlist-seats.test.ts; new: C18 in tests/admin-audit.test.ts) |
| G25 | Switch tap lands on a game canceled in between | 409 "look again", nothing written | API | fixed (auditor A; tests/admin-audit.test.ts G16b) |
| G24 | Switch colors and contrast light/dark | 4.5:1 text | UI | pass (existing: e2e/admin-cleanup.cjs; new: e2e/admin-sweep.cjs) |

## 4. Gear menu (M)

| # | Scenario | Expected | How | Status |
|---|---|---|---|---|
| M1 | Open on first, middle, last card | Opens next to the gear, inside the screen | UI | pass (new: e2e/admin-sweep.cjs) |
| M2 | Opening never scrolls or moves the page | scrollY unchanged | UI | pass (new: e2e/admin-sweep.cjs) |
| M3 | Last card near the tab bar | Opens upward or as a panel above the tab bar | UI | pass (new: e2e/admin-sweep.cjs) |
| M4 | Outside tap closes | Closed, no action | UI | pass (new: e2e/admin-sweep.cjs) |
| M5 | Escape closes, focus back on the gear | Yes | UI | pass (existing: e2e/admin-cleanup.cjs) |
| M6 | Arrow keys move between rows | Yes | UI | pass (existing: e2e/admin-cleanup.cjs) |
| M7 | Text the group expands the texts | Opens Messages links | UI | pass (existing: e2e/admin-cleanup.cjs) |
| M8 | Edit game opens the sheet | Yes | UI | pass (existing: e2e/admin-cleanup.cjs) |
| M9 | Players opens the roster sheet | Yes | UI | pass (existing: e2e/admin-cleanup.cjs) |
| M10 | Add to calendar only when booked | Yes | UI | pass (existing: e2e/admin-cleanup.cjs) |
| M11 | Cancel session red, last | Yes | UI | pass (existing: e2e/admin-cleanup.cjs) |
| M12 | Canceled game: Reopen session, no Edit game | Yes | UI | pass (existing: e2e/admin-cleanup.cjs) |
| M13 | Started game: Cancel disabled | Yes | UI | pass (existing: e2e/admin-cleanup.cjs) |
| M14 | 320 px dark mode | Inside the screen, readable | UI | pass (new: e2e/admin-sweep.cjs) |
| M15 | Two menus at once | Opening one closes the other | UI | pass (existing: e2e/admin-cleanup.cjs) |
| M16 | Live refresh while open | Stays open | UI | pass (existing: e2e/admin-cleanup.cjs) |

## 5. Edit game (E)

| # | Scenario | Expected | How | Status |
|---|---|---|---|---|
| E1 | Change date | Game moves; players keep seats and payments | API | pass (new: tests/admin-audit.test.ts) |
| E2 | Change start; end moves with it | Yes | UI | pass (existing: e2e/admin-cleanup.cjs, tests/admin-cleanup.test.ts) |
| E3 | End before start | Refused with a clear message | API+UI | pass (new: tests/admin-audit.test.ts) |
| E4 | Date in the past | Refused | API | pass (new: tests/admin-audit.test.ts) |
| E5 | Empty date or time | Save disabled | UI | pass (existing: e2e/admin-cleanup.cjs, tests/admin-cleanup.test.ts) |
| E6 | Move onto a day that already has a game | Refused or allowed per rules (no double game) | API | pass (new: tests/admin-audit.test.ts) |
| E7 | Save while offline | Error banner, nothing half saved, sheet stays open | UI | pass (code: failed save shows the error banner, sheet stays open; move then status kept apart) |
| E8 | Double tap Save | One move | UI | pass (existing: e2e/admin-cleanup.cjs, tests/admin-cleanup.test.ts) |
| E9 | Edit a game players joined | Seats, payments, credit unchanged | API | pass (new: tests/admin-audit.test.ts) |
| E10 | Player drops while the organizer edits | Both land; no lost seat | API | pass (existing: tests/money-cutoff.test.ts races) |
| E11 | Cancel-by recalculates (start minus 12 h) | Shown and stored | API+UI | pass (new: tests/admin-audit.test.ts) |
| E12 | Save then reopen | Saved values shown | UI | pass (existing: e2e/admin-cleanup.cjs, tests/admin-cleanup.test.ts) |
| E13 | Change only the switch | Only the status changes | API | pass (existing: e2e/admin-cleanup.cjs, tests/admin-cleanup.test.ts) |
| E14 | Change time and switch, switch refused | Move kept, message shown, screen reloads | Code | pass (code: EditGame reloads after a move when the switch fails) |
| E15 | Game already started | Date and time locked | UI | pass (existing: e2e/admin-cleanup.cjs, tests/admin-cleanup.test.ts) |
| E16 | Finished game | No switch shown | UI | pass (existing: e2e/admin-cleanup.cjs, tests/admin-cleanup.test.ts) |
| E17 | Edit across the clock change (Nov 1) | Eastern times right | API | pass (existing: tests/dryrun-times.test.ts, tests/dryrun-clock.test.ts) |
| E18 | Move a finalized game | Refused or harmless | API | pass (code: a started game cannot move, server 409) |
| E19 | Edit a canceled game | Not offered; API refuses | API | pass (new: tests/admin-audit.test.ts) |
| E20 | Moved text sheet opens after a move | Yes | UI | pass (existing: e2e/admin-cleanup.cjs, tests/admin-cleanup.test.ts) |

## 6. Cancel session (K)

| # | Scenario | Expected | How | Status |
|---|---|---|---|---|
| K1 | Cancel with a reason | Players see "Canceled - reason" | API | pass (existing: tests/cancel-reason.test.ts) |
| K2 | Cancel without a reason | "Canceled" | API | pass (existing: tests/cancel-reason.test.ts) |
| K3 | Paid players (cash, credit, part) | Each gets credit back exactly once | API | pass (existing: tests/money-cutoff.test.ts, tests/audit-oct31.test.ts; new: C7/C8) |
| K4 | Cancel on a Waitlist court | Same | API | pass (existing: tests/money-cutoff.test.ts, tests/audit-oct31.test.ts; new: C7/C8) |
| K5 | Cancel twice / double tap | Second is "nothing changed", money once | API | pass (existing: tests/money-cutoff.test.ts, tests/audit-oct31.test.ts; new: C7/C8) |
| K6 | Reopen after cancel | Game back, credit stays with players (no double) | API | pass (existing: tests/admin-security.test.ts, tests/audit-stage3.test.ts) |
| K7 | Reason 40+ characters, emoji, HTML | Trimmed/refused, shown as text | API | pass (new: tests/admin-audit.test.ts) |
| K8 | Cancel a finalized game | Refused, "Reopen it on the Money tab first" | API | pass (existing: tests/audit-attack.test.ts) |
| K9 | Cancel with a pending cash out | Cash out untouched, credit back once | API | pass (existing: tests/money-cutoff.test.ts, tests/audit-oct31.test.ts; new: C7/C8) |
| K10 | Organizer's own court payment | Never becomes credit | API | pass (existing: tests/money-cutoff.test.ts, tests/audit-oct31.test.ts; new: C7/C8) |
| K11 | Player cancel text has the plain link | Yes | API | pass (existing: tests/cancel-reason.test.ts) |

## 7. Players tab (P)

| # | Scenario | Expected | How | Status |
|---|---|---|---|---|
| P1 | List, regular/occasional pills, hidden players | Right | UI | pass (new: e2e/admin-sweep.cjs) |
| P2 | "N played" = finalized games they played | Matches history | API | pass (existing: tests/dryrun-money.test.ts "N played") |
| P3 | Add a player to a game | Seat; their credit goes on automatically | API | pass (existing: tests/auto-credit.test.ts, tests/decisions-oct31.test.ts, tests/audit-r4.test.ts, tests/credit.test.ts) |
| P4 | Add the organizer | No credit used, never pays the group | API | pass (existing: tests/auto-credit.test.ts, tests/decisions-oct31.test.ts, tests/audit-r4.test.ts, tests/credit.test.ts) |
| P5 | Add a player to a full game | Waitlist, no credit | API | pass (existing: tests/auto-credit.test.ts, tests/decisions-oct31.test.ts, tests/audit-r4.test.ts, tests/credit.test.ts) |
| P6 | Remove player, Undo within 5 s | Nothing sent, nothing changed | UI | pass (existing: e2e/live.cjs Undo) |
| P7 | Remove player, wait | Credit back, seat gone, waitlist moves in | API | pass (existing: tests/auto-credit.test.ts, tests/decisions-oct31.test.ts, tests/audit-r4.test.ts, tests/credit.test.ts) |
| P8 | Mark paid / unmark paid | Right, Unmark gives credit back | API | pass (existing: tests/auto-credit.test.ts, tests/decisions-oct31.test.ts, tests/audit-r4.test.ts, tests/credit.test.ts) |
| P9 | Mark paid on a stale screen | Refused "look again" | API | pass (existing: tests/auto-credit.test.ts, tests/decisions-oct31.test.ts, tests/audit-r4.test.ts, tests/credit.test.ts) |
| P10 | Payment method cash / other | Saved and shown | API | pass (existing: tests/auto-credit.test.ts, tests/decisions-oct31.test.ts, tests/audit-r4.test.ts, tests/credit.test.ts) |
| P11 | Names with odd characters (O'Brien, emoji, accents, <b>) | Shown as text, saved | API+UI | pass (new: tests/admin-audit.test.ts) |
| P12 | Duplicate name | Refused or allowed per rule | API | pass (new: tests/admin-audit.test.ts) |
| P13 | Phone number formats | Normalized | API | pass (new: tests/admin-audit.test.ts) |
| P14 | Player money sheet | Balance = history | API | pass (existing: tests/auto-credit.test.ts, tests/decisions-oct31.test.ts, tests/audit-r4.test.ts, tests/credit.test.ts) |
| P15 | Refund credit balance flow | Venmo, Mark refunded, Undo | API | pass (existing: tests/auto-credit.test.ts, tests/decisions-oct31.test.ts, tests/audit-r4.test.ts, tests/credit.test.ts) |
| P16 | "x of y paid" pill opens the right game's Players | Yes | UI | pass (new: e2e/admin-sweep.cjs) |
| P17 | Remove a player who has credit (hide) | Credit kept | API | pass (existing: tests/auto-credit.test.ts, tests/decisions-oct31.test.ts, tests/audit-r4.test.ts, tests/credit.test.ts) |

## 8. Money and Finalize (F)

| # | Scenario | Expected | How | Status |
|---|---|---|---|---|
| F1 | Finalize with N = 4 | $14 each, $0 back to each $14 payer | API | pass (existing: tests/finalize.test.ts money matrix) |
| F2 | Finalize with N = 5 | $11 each, $3 back to each $14 payer | API | pass (existing: tests/finalize.test.ts money matrix) |
| F3 | Finalize with N = 6 | $9 each, $5 back to each $14 payer | API | pass (existing: tests/finalize.test.ts money matrix) |
| F4 | Finalize with N = 7 | $8 each, $6 back to each $14 payer | API | pass (existing: tests/finalize.test.ts money matrix) |
| F5 | Finalize with N = 8 | $7 each, $7 back to each $14 payer | API | pass (existing: tests/finalize.test.ts money matrix) |
| F6 | Finalize with N = 9 | $6 each, $8 back to each $14 payer | API | pass (existing: tests/finalize.test.ts money matrix) |
| F7 | Finalize with N = 10 | $5 each, $9 back to each $14 payer | API | pass (existing: tests/finalize.test.ts money matrix) |
| F8 | A player who did not play | All back as credit | API | pass (existing: tests/finalize.test.ts, tests/audit-r4.test.ts) |
| F9 | Finalize twice | Second refused | API | pass (existing: tests/finalize.test.ts, tests/audit-r4.test.ts) |
| F10 | Edit after finalize | Refused or harmless | API | pass (existing: tests/finalize.test.ts, tests/audit-r4.test.ts) |
| F11 | Money totals = per-session = monthly = Players | Agree | API | pass (existing: tests/money-month.test.ts, tests/audit-money.test.ts) |
| F12 | Organizer's own seat | Pays venue, never the group, no credit | API | pass (existing: tests/money-month.test.ts, tests/audit-money.test.ts) |
| F13 | Court cost and membership numbers | Right | API | pass (existing: tests/money-month.test.ts, tests/audit-money.test.ts) |
| F14 | Reopen then finalize again | Credit once | API | pass (existing: tests/finalize.test.ts, tests/audit-r4.test.ts) |
| F15 | Finalize before the end | Refused | API | pass (existing: tests/finalize.test.ts, tests/audit-r4.test.ts) |

## 9. Cash-outs (R)

| # | Scenario | Expected | How | Status |
|---|---|---|---|---|
| R1 | Request appears on Home | Yes, top | UI | pass (existing: e2e/money-visible.cjs, e2e/credit.cjs) |
| R2 | Venmo button | Amount and note | UI | pass (existing: e2e/money-visible.cjs, e2e/credit.cjs) |
| R3 | Mark refunded | Off their credit, card gone | API | pass (existing: tests/credit.test.ts, tests/audit-attack.test.ts) |
| R4 | Mark refunded after player used part of it | Refused "look again" | API | pass (existing: tests/credit.test.ts, tests/audit-attack.test.ts) |
| R5 | Two requests from one player | Refused for the player | API | pass (existing: tests/credit.test.ts, tests/audit-attack.test.ts) |
| R6 | Request larger than the balance | Refused | API | pass (existing: tests/credit.test.ts, tests/audit-attack.test.ts) |
| R7 | Player withdraws while the organizer looks | Mark refunded refused | API | pass (existing: tests/credit.test.ts, tests/audit-attack.test.ts) |
| R8 | Not now | Credit usable again | API | pass (existing: tests/credit.test.ts, tests/audit-attack.test.ts) |

## 10. Settings (T)

| # | Scenario | Expected | How | Status |
|---|---|---|---|---|
| T1 | Smart alerts switch | Saved, kill switch works | API | pass (existing: tests/smart-tasks.test.ts) |
| T2 | Send TEST smart alert | Stubbed in tests, starts with TEST | API | pass (existing: tests/smart-tasks.test.ts, stubbed Telegram) |
| T3 | Max players 4..10, out of range | Saved / refused | API | pass (new: tests/admin-audit.test.ts) |
| T4 | Price settings | Read only in this audit (not changed) | Code | pass (read only; not changed) |
| T5 | Live refresh never overwrites typing in Settings | Settings left out of refresh | Code | pass (code: Settings is left out of live refresh; typing holds refresh: src/busy.ts) |

## 11. View as demo (V)

| # | Scenario | Expected | How | Status |
|---|---|---|---|---|
| V1 | Nothing is saved | No write request leaves the demo | UI | pass (new: e2e/admin-sweep.cjs) |
| V2 | Reset | Demo back to start | UI | pass (new: e2e/admin-sweep.cjs) |
| V3 | Exit | Back to admin | UI | pass (new: e2e/admin-sweep.cjs) |
| V4 | Banner always visible | Yes, at 320 | UI | pass (new: e2e/admin-sweep.cjs) |
| V5 | Cannot leak into real data | Real data unchanged | UI | pass (new: e2e/admin-sweep.cjs) |

## 12. Live refresh (L)

| # | Scenario | Expected | How | Status |
|---|---|---|---|---|
| L1 | "Updated just now" | Shown, ticks to minutes | UI | pass (existing: e2e/admin-cleanup.cjs) |
| L2 | Change on another phone shows within ~5 s | Yes | UI | pass (existing: e2e/admin-cleanup.cjs) |
| L3 | Slows after 2 min, stops after 10 | Rhythm per livecore | API | pass (existing: tests/live-poller.test.ts) |
| L4 | Does not close an open sheet or menu | Yes | UI | pass (existing: e2e/admin-cleanup.cjs) |
| L5 | Does not wipe typing | Yes | UI | pass (code: focus in a field holds refresh, src/busy.ts) |
| L6 | Does not jump scroll | Yes | UI | pass (existing: e2e/admin-cleanup.cjs) |
| L7 | Refresh during Save | No double, no error | UI | pass (code: a saving button holds refresh) |

## 13. Look and access (A)

| # | Scenario | Expected | How | Status |
|---|---|---|---|---|
| A1 | No sideways scroll on any tab at 320 and 390 | None | UI | pass (new: e2e/admin-sweep.cjs) |
| A2 | Tap targets 44 px | Yes | UI | fixed: Players Edit tap area 42 to 44 px; rest pass (new: e2e/admin-sweep.cjs) |
| A3 | Contrast light and dark | 4.5:1 text | UI | pass (new: e2e/admin-sweep.cjs) |
| A4 | Big text (200%) | No cut-off | UI | pass (existing: e2e/round2.cjs, e2e/dryrun-screens.cjs long names and wrapping) |
| A5 | Labels for icon buttons | Yes | UI | pass (new: e2e/admin-sweep.cjs) |
| A6 | Tab bar never covers buttons | Bottom padding | UI | pass (new: e2e/admin-sweep.cjs) |

## 14. Security (Z)

| # | Scenario | Expected | How | Status |
|---|---|---|---|---|
| Z1 | Every admin route without a session | 401 | API | pass (new: tests/admin-audit.test.ts) |
| Z2 | Player cookie on every admin route | 401 | API | pass (new: tests/admin-audit.test.ts) |
| Z3 | Unknown ids | 404, nothing changed | API | pass (new: tests/admin-audit.test.ts) |
| Z4 | A player id from another game | Refused | API | pass (new: tests/admin-audit.test.ts) |
| Z5 | Cross-site POST (wrong Origin) | Refused | API | pass (new: tests/admin-audit.test.ts) |
