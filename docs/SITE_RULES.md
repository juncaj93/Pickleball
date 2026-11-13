# SITE_RULES: how the site is meant to work (updated Mon Nov 9, 2026: game-length price table and venue hours added in Zip 28; before that Mon Nov 2, 2026, copied into the repo with two fixes to match the code). The code is the truth; if this disagrees with the code, keep the code and say so in the report.

## Basics
- Private pickleball group site "Pickleball" (was "Pickleball Bros" until Zip 29) at pickleball.juncaj.net (backup pickleball-club-9h0.pages.dev). Cloudflare Pages + Pages Functions + D1, free plan, $0. Repo has docs/ (read docs/STAGE_NOTES.md first).
- Organizer (Alex) signs in at /admin with a PIN. Players pick their name once (remembered per device). "View as" lets Alex see a player screen in a demo copy where nothing is saved.
- Sessions are Tue and Thu. Usual time is 7:00 to 9:00 PM (7:30 to 9:30 PM when that is what was booked); Tue Nov 3 is 8:00 to 10:00 PM. Each game has its own start time and its own court status. First real game Tue Nov 3, 2026. Times Eastern (America/Detroit) with AM/PM, never UTC.

## Players and money
- Any number 4 to 10 plays (Max players setting; the code lets the setting go up to 12, the default is 10, and the price tables stop at 10 in: the 1.5, 2.5 and 3 hour games charge their 10-player price at 11 or 12, while the 2 hour game keeps the formula, $5 at 11 and $4 at 12). Beyond max, waitlist. A game under 4 is NOT canceled by the site: it stays on until Alex cancels it himself ("Did you guys play?" > Cancel game, the gear menu, or "Didn't open"). Fixed Nov 2: this line used to say "Under 4 the game is canceled", which the code never did.
- Everyone pays a flat $14 up front. After the game the organizer finalizes who played. Final price floor(4 x 14 / N), never above $14. Extra comes back as credit.
- Price table: N=4 $14 (back $0), 5 $11 ($3), 6 $9 ($5), 7 $8 ($6), 8 $7 ($7), 9 $6 ($8), 10 $5 ($9).

## Game length prices and venue hours (Zip 28; read from `shared/gameLength.ts` and `shared/bookingHours.ts`, the code is the truth)
The $14 above is the 2 hour game, the usual one. Every length has its own up-front price and court cost. Final price = floor(4 x up-front / N), never above the up-front price; whatever a player paid above it comes back as credit. Under 4 in, everyone pays the up-front price (nothing back).

| Game length | Up front | Court (what Alex pays the venue) | Final price at 4, 5, 6, 7, 8, 9, 10 in | When it counts |
| --- | --- | --- | --- | --- |
| 1.5 hr | $11 | $36 | $11, $9, $7, $6, $5, $4, $4 | only while Short games is ON for everyone (it is on live) |
| 2 hr | $14 | $48 | $14, $11, $9, $8, $7, $6, $5 | always (the usual game; the price setting is Settings > Money) |
| 2.5 hr | $18 | $60 | $18, $14, $12, $10, $9, $8, $7 | only while Booking hours is ON for everyone (it shipped OFF in Zip 24) |
| 3 hr | $21 | $72 | $21, $16, $14, $12, $10, $9, $8 | only while Booking hours is ON for everyone |

- The 4 x up-front rule gives 2 hr, 2.5 hr and 3 hr exactly. The 1.5 hr row is a hand-written table: at 5 in it charges $9 (the rule alone would give $8). The code wins.
- With Short games or Booking hours OFF, that length is priced as a 2 hour game ($14, court $48), exactly as before the switch existed.
- Court cost on Money > Totals uses these court amounts unless a real cost was typed in for the game.

**Venue hours (Booking hours, Zip 24; the rule only applies while that switch is ON for everyone):** 8:00 AM to 10:00 PM Monday to Saturday, 8:00 AM to 7:00 PM Sunday, Eastern, by the game's own date. A new game, or a game whose start or end is changed, cannot start before 8:00 AM, end after closing or run past midnight. A game that already exists is never blocked or changed because it sits outside the hours. The last start is closing minus the game length (2 hr: 8:00 PM Mon to Sat, 5:00 PM Sunday).
- One credit pot per player. Credit is used automatically at I'm in. Drop out, late drop, canceled game, removed or unmarked all return credit.
- Late drops owe $14 (switch LATE_FEES, ships OFF; docs/FEATURE_SWITCHES.md): with it on, a drop inside the 12 hours before the start (start minus 12 hours, one clock everywhere) that leaves fewer than 4 in keeps the dropper's $14 on the game unless someone takes the spot (the oldest debt clears first, one per new seat). A no-show owes $14 only if fewer than 4 played. A cancel inside 12 hours asks "Did the venue waive the fee?". With LATE_FEE_SPLIT on (needs LATE_FEES; ships OFF), a No with 5 or more in prices every seat like a played game (floor(4 x 14 / N): 6 in = $9 each) and gives anything paid above that back as credit; 4 or fewer stays $14 each. Off: drops, Finalize and cancels return money as above. The organizer plays but pays the venue, never the group, and never uses credit.
- Players can "Request cash out from Alex". Organizer gets one Telegram alert and a Home card with a Venmo button, then Mark refunded.
- Players never see other players' money, credit, phone numbers or Venmo names, or the court cost and membership.
- The site never sends texts. It opens Messages with prepared text ending with the plain link. The only other outbound message is Telegram alerts to Alex.

## Player screen (live)
- Three tiers: THIS WEEK (big tile), NEXT WEEK (smaller tile), LATER (flat rows). Start time sits under the date tile. A checkmark badge sits on the tile when you are in. On game day the date tile wears a green TONIGHT band (the card is the same size as every other THIS WEEK card; Zip 29). The game's length ("2 hours") sits under the time on player cards and admin game tiles.
- A game with no court booked is a normal game: status "Court not booked", count "3 of 4 in", button "I'm in". Players never see the words waitlist, waiting or standby on it. $14 due, Pay and I paid appear once the card says Court booked.
- Counts show ball circles ("3 of 4 in", "N in" at 4 or more). Payment states: "$14 due" with Pay, "Paid $14", "Paid with credit" with Undo, part credit, waitlist, canceled.
- A CREDIT chip near the top (only when balance is above zero) opens the last 10 credit changes. Drop out and I'm in toasts state what happened to money (money audit release, may be on a preview until Alex says ship it: check git log and docs).
- Screens refresh by themselves every 5 seconds (slows after 2 minutes idle, stops after 10). Drop out has a 5-second Undo.
- Cancel with a reason ("Canceled - Thanksgiving").
- Light and dark mode.
- Christmas skin (Zip 38, switch "Christmas skin", ships OFF; docs/FEATURE_SWITCHES.md): a look-only theme for the player screens from the Friday after US Thanksgiving through Dec 31 (Eastern). Inside that window the Christmas logo shows; tapping it turns a Christmas look (ornaments, candy canes, snow cap, red tiles) on and off, remembered per phone. Admin screens never get it. Outside the window, or with the switch off, the site is exactly as before.

## Admin screen (live)
- Three-way court switch per game: Not booked | Waitlist | Booked ("Not booked" always on two lines). Waitlist means the venue has a waitlist; players see "Court not booked".
- Small gear menu per game: Text the group, Edit game, Players, Add to calendar (booked games only), Cancel session (red, last). One Edit game sheet holds the switch, Date, Start, End, CourtReserve button, Save. Cancel-by time is always start minus 12 hours. (Known difference, Nov 2: the cards and the cancel question use start minus 12 hours, but with LATE_FEES off the late-drop mark still uses each game's saved deadline (set from Settings > Schedule "Cancellation deadline for new sessions", 12 hours today, when the game is made or moved). They only differ if that setting is ever changed from 12. With LATE_FEES on, the late-drop rule also uses start minus 12 hours.)
- "x of y paid" pill opens Players. One "Do this now" card per game for court actions. Smart Telegram alerts have one tappable link. Organizer screen refreshes every 5 seconds with "Updated just now".
- Tabs: Home, Players, Money, History, Settings (check the code for the real list).

## Behind the scenes
- A Cloudflare Worker "pickleball-alerts-clock" calls the site every 5 minutes. Tick CPU about 5 to 9 ms. First real alert is Mon Nov 2, 7:00 PM (Tue Nov 3 last call).
- Feature flags exist (for example GO_LINKS). Future motion work will add a MOTION flag. Do not build motion work.
- Real credit exists on the live site (for example Mitchell). NEVER touch a real money or credit record.


## DEPLOY WINDOWS (set by Alex, applies to every channel)
LOUD HOURS (no production deploy, no switching a feature on, no database change):
- From 6:00 PM the night before a game (Mon and Wed) until 11:00 PM on game night (Tue and Thu). That is all day Tue and all day Thu.
- The hour after Alex texts the group.
QUIET HOURS (deploys and switch-ons are fine, earlier is better): Wed 6:00 AM to 6:00 PM, and Fri through Mon 6:00 PM.
FLOW for every change: build, test on the fake-data preview (docs/PREVIEW_FAKE_DB.md; re-seed with npm run db:seed:preview), Alex says "ship it", deploy to live with the feature switched OFF, Alex tests it on the live site with the private on-switch, then switch it on for everyone in a quiet window. Every deploy: backup and Time Travel bookmark first, all tests green, a fresh reviewer, a rollback ID, a read-only live check after. Deploy only from main, and main must equal the live site first.
Admin-only changes can deploy any time outside game night.

PREVIEW DATABASE: previews use the fake database named pickleball-preview. NEVER delete, drop, rename or reuse it. The only approved way to wipe it is npm run db:seed:preview. The preview organizer PIN lives only in docs/PREVIEW_FAKE_DB.md; do not paste it into reports.

FEATURE SWITCHES RULE: every new feature ships OFF with its on/off switch as a row inside Settings, in a collapsed section named "Feature switches" (create it if it does not exist yet). The switch must work with no deploy. Keep a private per-phone test link too. Document each switch in docs/FEATURE_SWITCHES.md (name, what it does, default, how to turn off).

## PREVIEW SWITCHES RULE (added Nov 4)
A preview must behave like live. Every feature switch that is ON on live must be ON by default on the preview (no ?something=on needed), and the switch for the feature being built is ON on its own preview too. List which switches the preview has on in the report. A tester should never have to flip a switch to see what live shows.

## PREVIEW CALM RULE (added Nov 11, 2026, by Alex; every channel follows it)
A preview opens CALM. Admin Home and player Home show only the one or two games and the alerts or cards needed to test THIS zip. No pile of "haven't paid" cards (Mark paid / Request / Remind rows), no extra games, no unrelated alerts. Everything else stays out of sight: seed it only behind a separate link or a separate seed command, never on the default Home. Use only the fixed names in docs/PREVIEW_FAKE_DB.md.
Before you report, open the preview at phone width (390 px wide, light AND dark) and look at the first screen of admin Home and player Home yourself. If it needs more than one screen of scrolling to find what Alex must tap, it is not calm. Say in the report, in one line, what the first screen shows. Alex must be able to find every "what to tap" item within two taps of the preview link.
How it is built (Zip 35): `npm run db:seed:preview` builds the CALM profile by default (the whole world, then everything this zip does not need is cut out: `calmDown()` in `scripts/preview-world-small.ts`, which keeps the games listed in `keep`); `npm run db:seed:preview -- --full` builds the whole world (every zip's scenes). Admin Home on a calm preview (`PREVIEW_CALM`, `shared/previewCalm.ts`, `src/pages/Admin.tsx`) shows only the cards of the zip being tested (Zip 35: Second Chance) and the games list. For the next zip: change what `calmDown` keeps and what the calm Home block shows, then run `node e2e/zip35-calm.cjs`-style checks (first screen at 390 px, light and dark).

## Live check with the read-only PIN (added Zip 8, Nov 6)
After every deploy, check the LIVE site yourself with the read-only organizer PIN, so Alex does fewer manual taps.
- Alex gives you the read-only PIN (8 digits). It is NOT the real organizer PIN. Never ask for the real PIN, never write the read-only PIN into git, docs, tests, logs or a report other than Alex's own copy.
- Sign in at https://pickleball.juncaj.net/admin (or https://pickleball-club-9h0.pages.dev/admin) with it, in a browser or with a request: POST /api/admin/login {"pin":"..."} with an Origin header of the same site, then GET /api/admin/dashboard, /api/admin/money?month=YYYY-MM, /api/admin/activity and so on with the cookie it returns.
- It opens every organizer screen with the real numbers. The title shows a small "View only" label.
- It is read only, enforced on the server: every POST, PUT, PATCH and DELETE answers 403 "View only. Nothing was saved." (only sign in and sign out work), and its reads cannot write anything either (not even the usual upkeep, like adding next weeks' games, and no Telegram alert is sent). So it is safe at any hour, but still do the check in a quiet window when you can.
- It lasts 12 hours, shares the real PIN's wrong-PIN lockout (5 wrong tries per phone, 20 overall, in 15 minutes), and stops working the moment the secret is removed. A PIN change signs it out too.
- It lives only as the Cloudflare secret ORGANIZER_READONLY_PIN (Pages project pickleball-club, production and preview). To turn it off: remove that secret (Cloudflare dashboard > Workers & Pages > pickleball-club > Settings > Variables and Secrets, or `npx wrangler pages secret delete ORGANIZER_READONLY_PIN --project-name pickleball-club`) and redeploy. To change it: put a new value the same way and redeploy.
- Changing the secret to a new PIN signs every view-only phone out at once. The secret must never be the same as the real PIN (then it would give full access); the site refuses a real PIN change to the read-only one, but cannot check the other way.
- What it can see: everything the organizer sees, including the private player link and phone numbers, so give it only to trusted helpers. Its backup download has the PIN hash and group word hash blanked out.
- Do not use it to change anything for Alex. If a check needs a tap that saves, ask Alex.
