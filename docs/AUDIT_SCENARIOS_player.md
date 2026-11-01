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
