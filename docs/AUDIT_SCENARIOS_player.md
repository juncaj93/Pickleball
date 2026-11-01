# Player screens audit: scenario list (Sun Nov 1, 2026)

Audit 1 of 3 (player screens). Base: main 8d8ed0c (same code as live deployment
eea78540). Everything was tested on a local copy with a throwaway database, fake
players and a fake clock. Nothing on the live site was changed by testing.

Status: PASS = works as the rules say. FIXED = was wrong, fixed, with a permanent
test. ASK = odd, may be on purpose, listed for Alex. OPEN = wrong, not fixed (why
given).

Where the tests live:
- `tests/audit-player-api.test.ts`: API and money scenarios (families 3 to 7, 9, 12)
- `e2e/audit-player-flows.cjs`: browser flows (families 1, 4, 8, 10)
- `e2e/audit-player-look.cjs`: look and access at 320 and 390 px, light and dark (families 2, 5, 11)
- `tests/good-news.test.ts` and `e2e/good-news.cjs`: family 13
- `e2e/audit-player-fixes.cjs`: one check per fix found in this audit

## 13. "Good news, a spot opened up" shows once (Alex's request)

| Scenario | Expected | Status |
|---|---|---|
| Promoted player opens the page | Note shows on that game | PASS (new) |
| Same visit, 5-second refresh | Note stays (no blink) | PASS (new) |
| Reload / pull to reload | Gone for good | PASS (new) |
| Refresh after the reload | Still gone | PASS (new) |
| New promotion on another game, page open | Shows once on that game only | PASS (new) |
| Same game, promoted again later | Shows once more (new promotion) | PASS (new) |
| New phone or cleared storage | Shows once there | PASS (new) |
| Two names on one phone ("not you?") | Each name has its own memory | PASS (new) |
| Storage blocked (private mode) | Shows once per page visit, no crash | PASS (new) |
| Broken stored value | Ignored, no crash | PASS (new) |
| Memory size | Keeps the last 60 only | PASS (new) |
| View as (demo) | Shows once per demo session, never written to the phone | PASS (new) |
| 320 / 390 px, light / dark | Inside its card, no sideways scroll | PASS (new) |

## 9. Time edges on the screen (pure helpers, `shared/time.ts`)

| Scenario | Expected | Status |
|---|---|---|
| Sun Nov 1 1:30 AM, first and repeated hour | Tue Nov 3 game: same tier, "8 PM" | PASS |
| Sat Oct 31 11:59 PM to Sun 12:00 AM | Tiers stable over midnight | PASS |
| Sat Nov 7 11:59 PM, game Sun Nov 8 | "tomorrow", THIS WEEK | PASS |
| Dec 31 to Jan 5 game | NEXT WEEK, year change fine | PASS |
| Mar 14, 2027 spring forward | Tue Mar 16 game "8 PM" | PASS |
| Game night 11:59 PM | "tonight" | PASS |
| Thanksgiving Thu Nov 26 morning | "tonight" for that night's game | PASS |
| Sunday, game on Tuesday | Drop question said "Out for next Tuesday?" for a game 2 days away | FIXED (now "Out for Tuesday?", same words as the Want in card) |
| Sunday, Tuesday's game sits under NEXT WEEK | Weeks start Monday | ASK |

## Totals

| Test file | Checks | Passed | Fixed in this audit | Open |
|---|---|---|---|---|
| `tests/audit-player-api.test.ts` | 214 | 214 | 2 (Max players) | 0 |
| `e2e/audit-player-flows.cjs` | 88 | 88 | 7 | 0 |
| `e2e/audit-player-look.cjs` | 145 | 133 | 4 kinds (tap areas, contrast) | 12 (big text, very long names) |
| `tests/good-news.test.ts`, `e2e/good-news.cjs` | 18 | 18 | new feature | 0 |

## 1. Identity

| Scenario | Expected | Status |
|---|---|---|
| First visit | "Who are you?" lists every active name, Add my name, Organizer sign-in | PASS |
| Pick a name | Title changes, schedule shows, reload remembers | PASS |
| "not you?" then Cancel | Nothing changes | PASS |
| "not you?" then another name | Phone switches; first name's seats untouched | PASS |
| Drop out, then "not you?" and another name within 5 s | Held drop is for the first name only | FIXED (it was sent as the new name: the wrong person lost their seat) |
| New device | Starts at "Who are you?" | PASS |
| Cleared storage / cleared cookies | Storage only: name kept; cookies too: asks again | PASS |
| Add my name "Ryann" (Ryan exists) | "Is this you?", then No, I'm new, days, home | PASS |
| Add my name "sam" (🏓 Sam exists) | "Is this you?" | PASS |
| Add my name exact duplicate | Friendly "Someone already uses..." | PASS |
| Add my name "Jose" (José exists) | "Is this you?" | FIXED (made a second player) |
| Add my name empty or spaces | Continue disabled; Back returns | PASS |
| Name removed while the page is open / phone remembers a deleted name | Clear message, then "Who are you?" | PASS |
| Long names, emoji, accents, apostrophes (O'Brien, José, 🏓 Sam) | Fit at 320/390; exact name in the Venmo note | PASS |
| 29-letter made-up name in the header with the CREDIT chip | Breaks mid-word | OPEN (real names all fit; needs a header layout change) |

## 2. Home layout

| Scenario | Expected | Status |
|---|---|---|
| THIS WEEK many, NEXT WEEK 2, LATER many | One header per tier, in order | PASS |
| THIS WEEK with exactly 1 game | Big tile | PASS |
| My games with 1 game, 2 tiers, 0 games | Empty state "You're not in any games yet" + See all games | PASS |
| All games / My games switch | Name, position, remembered | PASS |
| More sessions (N), Show fewer | Works | PASS |
| TONIGHT strip | On tonight's game only | PASS |
| Started 5 minutes ago | No Drop out, no I'm in | PASS |
| Finished and finalized | No card; top Pay card says "final price" if owed | PASS |
| Canceled with reason, 40-character reason, no reason | "Canceled - Thanksgiving" / "Canceled" | PASS |
| Canceled card text readable | 4.5:1 | FIXED (card was see-through: 3.2 to 3.8:1) |
| "If you paid, it's now your credit." on canceled cards | Only for players who were in | FIXED (showed to everyone) |
| Extra game with an 80-character note | Ink tile, note wraps | PASS |
| Saturday 10:30 AM, 9:30 to 11 AM game | Start under tile; end shown for an unusual length | PASS |
| Court booked / Not booked / Waitlist court | "Court booked"; "Court not booked" and never waitlist/waiting/standby with room | PASS |

## 3. Sign up (I'm in)

| Scenario | Expected | Status |
|---|---|---|
| 0 to 10 in on a booked court (11 cases) | Count and circles right | PASS |
| 11th and 12th | Real waitlist, in order | PASS |
| Max players 4 to 10 (7 cases) | Full at max, next waits | PASS |
| Not booked and Waitlist courts | Normal seats, "Court not booked", no Pay; full: real waitlist | PASS |
| Credit none, $3, $14, $20, no court, Waitlist court (7 cases) | Credit goes on at I'm in, banner says how much | PASS |
| Two games with $20, tapped one after the other / at once | Credit never spent twice | PASS |
| Double tap, two phones, two players racing for the last seat | One seat each, books balance | PASS |
| Join during a court switch, a time move, a cancel (4 orders) | Clear answer, no half state | PASS |
| Slow network | Card fills at once, no stuck "Saving…" | PASS |
| 500 JSON, 502 HTML, network cut, 429 | Card rolls back, friendly banner | PASS |
| Organizer raises Max players while people wait | First waiting player moves in | FIXED (stayed waiting; next new I'm in jumped ahead) |

## 4. Drop out and the 5-second Undo

| Scenario | Expected | Status |
|---|---|---|
| Paid cash / credit / part credit / unpaid / unconfirmed I paid / waitlisted (8 cases) | Banner's money words equal what came back | PASS |
| Undo in time | Server never touched | PASS |
| Undo too late | "Too late, you're already out. Tap I'm in to rejoin." | PASS |
| Reload during the window | All or nothing, screen matches server | PASS |
| Close the page during the window | Drop finishes (keepalive, or note on next open) | PASS |
| Drop then rejoin same game (7 money states x 3 court kinds, the Oct 31 bug) | Credit used again or $14 due with a way to pay | PASS |
| Drop then I'm in on another game | The drop's credit lands on the new seat | PASS |
| Drop then Use credit on tonight's pay card within 5 s | Drop goes first, credit pays tonight | FIXED (credit stayed in the pot, tonight unpaid) |
| Drop then Request cash out within 5 s | Drop goes first, request works | FIXED ("You have $0 of credit") |
| Two drops within 5 s | First sent at once, second keeps its Undo | PASS |
| Double tap on the drop question's Drop out | Dropped (second tap is not an Undo) | FIXED (second tap hit Undo: "You dropped out" but still in) |
| Drop seconds before cancel-by / start | Sent at once, never made late by the wait | PASS |
| Drop exactly at cancel-by | Counts as late; money back either way | PASS |
| Drop after start | Refused with a clear message | PASS |
| On a Sunday, Tuesday's game | "Out for Tuesday?" | FIXED (said "next Tuesday") |

## 5. Payment states and buttons

| Scenario | Expected | Status |
|---|---|---|
| $14 due + Pay + I paid + Drop out | All there | PASS |
| $14 due · $9 credit + Use credit + Pay; I paid after Pay tapped | All there | PASS |
| Paid $14 + Didn't pay?; organizer-confirmed: no Didn't pay? | Right | PASS |
| Paid with credit + Undo; Undo refused on part credit | Right | PASS |
| Part credit: "Credit $9 used" + "$5 due" + Pay $5 | Right | PASS |
| No court yet with credit: "Use $9 credit", no Pay | Right | PASS |
| Waitlist, 2nd in line + Leave waitlist | Right | PASS |
| Finalized: final price table for 4 to 10 played (7 cases) | Matches the price table | PASS |
| Game-day Pay card (several games, tonight, with credit) | From 8:00 AM, one Pay button | PASS |
| No Venmo link | I paid button, "Pay Alex however you usually do." | PASS |
| Every owing card on a booked court has Pay or Use credit (random sweep, 6 seeds) | Always a way forward | PASS |
| Game started without ever being marked Court booked | Shows $14 due and Pay | ASK |

## 6. Credit

| Scenario | Expected | Status |
|---|---|---|
| CREDIT chip only above $0; CASH OUT chip when pending | Right | PASS |
| CREDIT word readable in dark mode | 4.5:1 | FIXED (3.1:1) |
| Balance equals history after every scenario | Always | PASS |
| Last 10 changes in plain words | Right amounts, newest first | PASS |
| Cash out: 5 bad amounts, request, second refused, cancel | Clear messages | PASS |
| "Use the $14 you asked to cash out": all, part, keep | Right | PASS |
| Cash out racing I'm in; withdraw racing use | Never both | PASS |

## 7. Waitlist and promotion

| Scenario | Expected | Status |
|---|---|---|
| Order; promotion on a drop; two drops at once | First in line first | PASS |
| Credit on promotion ($14, $3, $20) | Goes on like I'm in | PASS |
| Promoted with a pending cash out | No "use your cash out" prompt (only after I'm in) | ASK |
| Max players raised | Waiters move in | FIXED |
| Max players lowered below who is in | Nobody bumped, new taps wait | PASS |

## 8. Live refresh and stale screens

| Scenario | Expected | Status |
|---|---|---|
| Another player joins | Count updates within about 6 s | PASS |
| Hidden page | Asks nothing; catches up when shown | PASS |
| Rhythm | 5 s, 15 s after 2 min idle, stops after 10 min, a tap wakes it | PASS |
| Stale I'm in / Drop out / Use credit / Undo credit / I paid / Didn't pay? on canceled, started, full or switched games | Clear message, never a wrong result | PASS |
| After a failed tap with no signal, signal back | Error card goes | FIXED (red card stayed) |

## 9. Time edges

See the table at the top, plus: cancel-by on Election Day Nov 3, start and end edges, a game crossing midnight, month and year change, Thanksgiving week, a moved game: all PASS.

## 10. Everything else

| Scenario | Expected | Status |
|---|---|---|
| Add to calendar | Only on my games; .ics 8 to 10 PM Eastern; Thanksgiving right; bad id 404 | PASS |
| Light/dark toggle | Cycles, sticks after reload | PASS |
| Organizer link, back button, shared ?s= link | Right | PASS |
| Reload keeps name, My games, theme | Right | PASS |
| First load offline / 500 / bad link | Friendly text | PASS |
| Text the group | Organizer only; players have no such button | Note (spec lists it for players; code is organizer-only) |

## 11. Look and access (320 and 390 px, light and dark)

| Scenario | Expected | Status |
|---|---|---|
| No sideways scroll, no overlap, nothing outside its card | Right | PASS |
| 10 in with long names and emoji | Fits | PASS |
| Calendar icon tap area | 44 x 44 | FIXED (38 x 44) |
| Pay / Use credit bottom edge | Not taken by the I paid / Drop out link below | FIXED (bottom 1.5 px opened Drop out) |
| Contrast 4.5:1 everywhere | Right | FIXED (canceled cards, CREDIT word) |
| Every control named for VoiceOver | Right | PASS |
| Tab order, visible focus, dialogs trap and return focus, Escape | Right | PASS |
| Reduce Motion | Respected | PASS |
| Big text 150% / 200%: money chip | Wraps inside the card | FIXED at 150% on 390; OPEN at 320 and 200% |
| Big text: LATER rows next to a wide button, header name and date square | Readable | OPEN (needs layout rework; normal sizes unaffected) |

## 12. Privacy

| Scenario | Expected | Status |
|---|---|---|
| /api/group, /api/group/version, calendar.ics, join and drop answers | No other players' money, credit, phone, Venmo; no court cost or membership | PASS |
| 15 impersonation attempts (ids in body, path, headers, forged cookies, View as and pretend headers) | All refused | PASS |
| 18 bad requests | Status plus a plain message, no stack trace or SQL | PASS |
| Anyone with the plain address can pick any name | By design (a picked name, no password) | Note |
