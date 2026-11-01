# PLAYER SPEC: audit every player-side scenario

(Copy of Alex's brief for the Nov 1, 2026 player audit, kept with the code. Corrected Nov 1: "Text the group" is the
organizer's button only; players have none. Results: docs/AUDIT_SCENARIOS_player.md.)

Scope: everything a player can see or do on pickleball.juncaj.net (not /admin). Test as many different fake players as needed: new player, regular, one with credit, one with a pending cash out, one on a waitlist, the organizer's own player screen.

## Scenario families (write them all down, then test)
1. Identity: first visit, pick name, "not you?", new device, cleared storage, two names on one phone, a name that was removed, names with long text, emoji, accents, apostrophes.
2. Home layout: THIS WEEK, NEXT WEEK and LATER tiers with 0, 1, 2 and many games; All games view; past games; canceled games with reason; extra games; a game today (TONIGHT strip); a game started 5 minutes ago; a game finished.
3. Sign up (I'm in): 0 to 10 players in; exactly full; over full (waitlist) on a booked court; not-booked court; each count 4 to 10; with no credit, part credit, exact credit, more than enough credit; sign up for two games with limited credit; sign up while the organizer changes the game at the same moment; double tap; slow network.
4. Drop out and the 5-second Undo: paid with cash, paid with credit, part credit, unpaid, waitlisted; Undo in time, too late, after reload; close the app during the window; drop then rejoin the same game; drop then rejoin a different game; drop at cancel-by time; drop after start.
5. Payment states and buttons: "$14 due" with Pay, "I paid" claim, "Didn't pay?", Paid, Paid with credit with Undo, part credit, waitlist, canceled, finalized (final price, credit back). Every card must always offer a way forward: never a card with no way to pay or use credit. Court booked vs not booked rules for payment buttons.
6. Credit: CREDIT chip appears only above $0, list of last 10 changes reads in plain words and matches what really happened, amounts exact, cash-out request flow (request, reserved amount, withdraw, "Use the $X you asked to cash out"), balance equals history after every scenario.
7. Waitlist and promotion: promoted when a player drops; order; what the promoted player sees; credit and payment on promotion.
8. Live refresh: screen changes while open; stale screen taps (a button that is no longer valid must give a clear message, never a wrong result); refresh slows and stops; coming back after the phone slept.
9. Time edges: cancel-by, start time, end time, midnight, the Sun Nov 1 clock change, month and year change, a session on Thanksgiving week.
10. Everything else players can touch: Add to calendar, light and dark toggle (and it sticks), links, back button, pull to reload, offline, very slow network, error responses, empty states, 4xx and 5xx errors showing friendly text.
11. Look and access: no horizontal scroll at 320 and 390 px, tap targets at least 44 px, text contrast in light and dark, big text sizes, VoiceOver labels on buttons and icons, keyboard focus, nothing overlapping or cut off (long names, long status text), spacing consistent between cards.
12. Privacy: inspect real API responses a player gets. They must not contain other players' money, credit, phones or Venmo names, court cost or membership. A player must not be able to act for another player by changing an id in a request.

13. Requested change from Alex (build it, with tests): the blue note "Good news, a spot opened up, so you're in." on a game must show only the FIRST time that player sees it, then go away for good. Remember it on that phone only (browser storage). No database change. It must still show for a brand new promotion on a different game, and must not show again after reload, refresh or the 5-second poll. In View as demo mode it still shows once per demo session.

## Done when
Every scenario is tested and either passes, was fixed with a test, or is listed under QUESTIONS FOR ALEX. Both fresh auditors are clean.
