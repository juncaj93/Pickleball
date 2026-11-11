# Preview with a FAKE database

**Previews use the fake database `pickleball-preview`. NEVER delete it, reset it any way except the seed command below, or reuse it for anything else.**

Written Sun Nov 1, 2026. Times are Eastern.

**In one sentence:** every preview link (any branch that is not `main`) runs on a
separate practice database full of made-up players, so you can tap everything
for real (I'm in, Pay, Drop out, Finalize, cash out, the whole organizer side)
and nothing can touch the real group, real money or real credit.

## How it works

| | Live site | Preview |
| --- | --- | --- |
| Address | pickleball.juncaj.net | `https://<branch-name>.pickleball-club-9h0.pages.dev` (and a one-off address per deploy) |
| Database | `pickleball` | `pickleball-preview` (fake data only) |
| Telegram alerts to you | on | **off** (no bot token exists in previews) |
| The 5-minute clock | on | **off** (the clock only calls the live address, and a preview has no clock password) |
| Texts to players | never sent by the site | never sent by the site |
| Cost | $0 | $0 (Cloudflare free plan, 4 of 10 databases used) |

The wiring lives in two places, both already in place:

1. `wrangler.toml`, the `[env.preview]` part: "previews use `pickleball-preview`".
2. The Cloudflare Pages project's stored **Preview** settings (read from
   Cloudflare on Sun Nov 1): database `DB` = `pickleball-preview`; the only variables are
   `GO_LINKS` and `TIME_SHIFT` (plain on/off switches, no secrets). Production keeps `DB` = `pickleball` plus the real Telegram and clock secrets.

Production is bound to the real database and was not changed.

## The fixed names (Alex, Sun Nov 8, 2026): reuse these, do not add new ones

The preview database holds ONLY these 10 names (`npm run db:seed:preview` builds `scripts/preview-world-small.ts`, which refuses to finish
with any other name). A new zip gives its scenario to one of them, and adds a line here. The older, bigger world below (Avery to Morgan) is
only for the local browser tests now (`scripts/seed-preview-world.ts`); it never goes to the preview database.

| Name | What it is for on the preview |
| --- | --- |
| **Alex** | The organizer (PIN below) and the organizer's own player: pays the venue, never the group. In most games. |
| **Vic** | Unpaid nudge: owes $14 for 1 past game ("For Tue, Nov 3"). Venmo saved. In many upcoming games (owes, I paid self-reported on the 8-in game). |
| **Wren** | Unpaid nudge: owes $28 for 2 past games. No Venmo saved. The Second Chance card's no-Venmo player. |
| **Zoe** | Unpaid nudge: owes $42 for 3 past games: I'm in is blocked while Unpaid nudge is on. |
| **Quinn** | After-game cards: "You owe $3 more" after a redo (kept to that one debt, so the card shows). Tapped I paid on the next game, then dropped (the claim card on Home). |
| **Rowan** | After-game cards: $8 back from two games. Owes $11 on "Fee split $11" (canceled late). Tonight's game day games. Thursday regular (Want in card). Venmo saved. |
| **Parker** | After-game cards: $5 back. The reliable payer: paid cash on most games, paid then got credit on the Second Chance game. Venmo saved. |
| **Reese** | No phone number and no Venmo (Text all skips Reese). $14 cash-out pending (Home card). Late drop that Christopher took ("You no longer owe $14"). |
| **Sage** | After-game cards: $8 back. Credit adjusted +$5 ("Thanks for bringing balls"). Tue and Thu regular (Want in card). |
| **Christopher Vanderberg** | The long name (Money rows, toasts). Venmo saved. Took Reese's late-dropped spot. Owes $11 on "Fee split $11". |

Never give Vic, Wren or Zoe a fee or a game that ends before the next re-seed: their counts must stay 1, 2 and 3. The "Late-fee test" and "Fee split test" games use Quinn, Rowan, Sage and Christopher Vanderberg for that reason.

The preview's switch rows are live's ON rows plus the zip being built (PREVIEW SWITCHES RULE): `LATER_ON_LIVE` and `BUILDING_ON` in `scripts/preview-world-small.ts`. Read on live Sun Nov 8, 7:05 PM: every Settings row is on, including Game day card, Second Chance and After-game cards, so the preview has them all, plus Unpaid nudge. A row that is off on live stays off here; `?gameday=on`, `/admin?secondchance=on` or `?aftergame=on` shows that card on one phone.

Links (calm previews only; never on live): `/?as=Vic`, `/?as=Wren`, `/?as=Zoe`, `/?as=Quinn` and so on pick that name on the phone.
Not on the small preview: games with 11 or 12 in (there are only 10 names; the local browser tests still have them).

## The practice group
(Below: the OLDER big world, now only for the local browser tests.)


- Name on screen: **Pickleball (PREVIEW, fake data)**. If you ever see that
  name, you are on the practice copy.
- Organizer sign-in at `/admin` on the preview address: PIN `739514` (this line is the only place the PIN is written; the seed command and its test read it from here).
- Players: Organizer Orla (the organizer's own player) and 13 made-up players
  (Avery, Blake, Casey, Drew, Emery, Finley, Gray, Harper, Indy, Jordan, Kai, Lane, Morgan)
  with fake phone numbers (313) 555-0100 to 555-0113. Pick any name on the "Who are you?" screen.
- Games are placed around the day you seed, so they are always "this week" and "next week":

| Game (relative to the seed day) | State | What is in it |
| --- | --- | --- |
| Earlier Tue (about a week ago) | Played, Court booked, finalized | 5 played, $11 each, $3 credit back to Avery, Blake, Casey, Drew, Emery |
| Latest past game | Never booked, nobody answered yet | Gray, Harper, Kai, Jordan: shows "Did you guys play?" |
| Next game | **Court booked** | Orla in; Indy **paid** cash; Jordan **owes $14**; Avery used $3 credit and owes $11; Finley **paid with credit**; Kai tapped I paid, then dropped (a card waits for you on Home) |
| Then | **Waitlist** (court) | Blake, Drew, Emery in, each used $3 credit |
| Then | **Not booked**, "3 of 4 in" | Gray, Emery, Lane |
| Then | **Booked, 11 in** (was "full, 10 in, with a real standby") | Gray was the standby; Card cleanup (Zip 10) moved him in as a normal 11th player. Indy, Jordan, Finley paid; Morgan tapped I paid; the rest owe $14 |
| Then | **Canceled** ("Court closed") | Finley, Gray, Harper paid $14 and got it back as credit |
| Extra game "Late-fee test", 11 hours after the seed | **Booked**, already past its cancel-by (start minus 12 hours) | Jordan, Lane, Morgan, Kai in (Kai paid cash). Open the preview with `?latefees=on` as one of them and tap Drop out: it leaves 3, so they owe $14 unless someone takes the spot |
| Extra game "Fee split test", 10 hours after the seed | **Booked**, already past its cancel-by | Orla, Avery, Indy, Jordan, Lane, Morgan in (6); Indy, Lane, Morgan paid cash. Gear menu > Cancel session > No: each owes $9, the three who paid get $5 back as credit |
| Old "Test game" (Fri Oct 30 on a Wednesday seed) | Canceled early | Nobody in, no money, no venue charge: the one game that can be hidden (Money page rework). Games with money in them cannot be hidden |
| "Sunday run", "Monday run" (Nov 1 and 2) | Played, finalized | 4 each, all paid $14, court $48: two fully paid previous games |
| Extra game "Owes, one no number" (68 hours after the seed) | **Booked**, 5 in | Indy paid; Kai, Lane, Morgan owe $14 and have numbers; Reese owes $14 and has NO phone number saved (Text all skips Reese) |
| Extra game "Mixed payments" (20 hours after the seed) | **Booked**, 5 in | Lane and Morgan paid cash; Kai (Venmo saved) and Gray (no Venmo) owe $14. The Money rows and the Remind sheet use this one to show "Request" next to Mark paid. |
| Extra game "Fee split $11" (11.5 hours after the seed, or 10.5 if that time is taken) | **Canceled late, fee not waived** (fee split on) | 5 were in; Kai, Christopher Vanderberg and Jordan each owe **$11**; Lane and Morgan paid $14 and got $3 back as credit. A Venmo request from here must say $11. |
| Extra game "All paid" (44 hours after the seed) | **Booked**, 4 of 4 paid | Indy, Jordan, Morgan, Lane: everyone paid but not played yet, so it stays in the Games list (it moves to Previous games once finalized) |
| An extra 1.5 hour game, no note (7:30 to 9:00 PM Eastern, about 3 days after the seed) | **Booked**, 4 in, Short games on | Indy paid **$11** cash; Jordan, Kai and Finley owe **$11** (Zip 9). Every 2 hour game around it stays at $14 |
| Extra game, no note, 6:00 PM about 2 days after the seed (Zip 10) | **Booked, 1 in** | Kai: one ball and three empty circles |
| Extra game, no note, 5:30 PM about 4 days after the seed (Zip 10) | **Booked, 8 in** | Avery to Jordan (no one with credit left over); Avery and Blake paid |
| Extra game, no note, 5:00 PM about 9 days after the seed (Zip 10) | **Booked, 12 in** (the most one game can hold) | Orla and 11 more, including Reese and Christopher Vanderberg; Jordan and Indy paid. A 13th I'm in is refused plainly |
| Past game, no note, about 2 days after the earlier Tue (Zip 11; Wednesday or Thursday seeds only, like the old extras) | Played, Court booked, **not finalized** | 5 in (Indy, Jordan, Morgan, Gray, Finley), all paid $14: the organizer's **Finalize** card |
| Extra game, no note, about 5 days after the seed, moved from 7:00 to 7:30 PM (Zip 11) | **Booked, 3 in** | Indy, Jordan and Drew joined at 7:00 PM: each sees the moved-game card (Still in / Can't make it); the organizer card says Confirmed 0 of 3 |
| Extra game, no note, about 9 hours after the seed (Zip 11) | **Booked, 4 in** | Blake dropped inside the 12 hours (owed $14) and Christopher Vanderberg took the spot: Blake sees "You no longer owe $14" (Emery, Finley, Drew, Christopher Vanderberg in) |
| Two past games earlier THIS month, no note (Zip 13; only when they fit between the last past game and the seed) | Played, Court booked, **finalized** at $14 | Orla (the organizer) + Indy, Jordan, Kai; and Orla + Lane, Morgan, Gray; all paid $14. The organizer's "Spent" on the Players redo equals Money Totals "Your cost so far" ($30 + 2 x ($48 - $42) = $42 when nothing else this month is finalized) |
| Two extra games TONIGHT, no note (Zip 14; 5:00 PM and 9:30 PM Eastern when both are still ahead, else the next free slots that day) | **Booked**; the first on **Court 3**, the second with **no court** | Court 3 game: Indy paid cash, Jordan, Kai, Morgan owe. No-court game: Indy, Jordan, Christopher Vanderberg owe. Pick **Indy** to see both game day cards (Court 3 and Court TBD); every other game has no court |
| Three morning games in the 3 days before the seed (Zip 16; preview and `SEED_ZIP16=1` only), finalized AT the seed | Played, booked, finalized | Six more made-up players (Parker, Quinn, Rowan, Sage, Tatum, Uma; 313-555-0150 to 0155). Game 1 (6 played with Orla): $9, **$5 back to Parker**, Rowan, Sage, Tatum, Uma. Game 2 (5 played): $11, $3 back to Rowan, Sage, Tatum, Uma, so **Rowan sees one card "$8 back to your credit", 2 games**. Game 3: finalized at 5 played, Quinn then paid $11, reopened and redone with 4 played ($14; Uma did not play, $14 back as credit): **Quinn owes $3 more** |
| Everything after | Normal empty games | The site makes these by itself |

The three old extra games only exist when the two latest played games are about 5 days apart (a Wednesday or Thursday seed); a Sunday seed leaves them out.

- Venmo usernames are saved for Avery, Harper, Indy, Kai, Lane and Christopher Vanderberg; Jordan, Gray, Morgan and Reese have none (they show "no Venmo saved").
- Zip 11 alert states: **Casey** has a +$5 hand credit adjustment ("Thanks for bringing balls") and is a regular for Tue and Thu who has not
  answered the next one, so Casey sees the Credit adjusted card and the Want in card stacked. **Gray** taps I'm in on a booked game to see the
  cash-out question. **Jordan** and **Kai** owe for several games ("You owe $N total"); **Gray** owes for one ("You owe $14 for ...").
- Money states: credit left over for **Casey ($8: $3 plus the Zip 11 +$5)**, **Lane ($3)**, **Morgan ($3)** and **Harper ($14)** (Lane's and Morgan's $3 come back from the
  canceled "Fee split $11" game); Casey and Harper are in no upcoming game so you can tap I'm in and watch credit apply; **Gray** has a
  **$14 cash-out pending** (Home card with the Venmo button, then Mark refunded);
  players who owe $14; a paid player.

## Switches on from the seed (PREVIEW SWITCHES RULE, Nov 4)

A preview behaves like live: the Settings > Feature switches rows that are ON for everyone on live are ON right after a seed, plus
the switch being built, with no `?something=on` link. The list is `PREVIEW_SWITCHES_ON` in `scripts/seed-preview-world.ts`
(Nov 4, as on live: New admin layout, Admin screens round 2 and 3, Ask for payment on every game, No Venmo? note, Moved-game notice,
Late drops owe $14, Player screen fixes, Pay sheet, Texts and alerts round 2, and Late-cancel fee split (switched on live Wed Nov 4); Money page rework (switched on live Thu Nov 5, about 9:00 AM); Instant taps, Adjust credit, Venmo request and Home collapse (live, Settings rows off, Zips 5 and 6), Tonight glow, Color cleanup and Simpler player cards (Zip 7, switched on live Fri Nov 6), Last call texts (Zip 8), Short games and Card time and buttons (Zip 9, on live), Card cleanup (Zip 10, on live), plus the one being built (Zip 11): Alert cards. The seed switches Card cleanup on the way the Settings row does, so the one waitlisted player (Gray) moves in, and no game has a waitlist). A game TONIGHT and a game TOMORROW (Eastern) always exist after a re-seed: the regular Tue/Thu game when there is one, else an extra game "Tonight test" (Booked, 3 in) or "Tomorrow test" (not booked, 2 in). The wrangler.toml switches are already "on" in `[env.preview.vars]`. Zip 12 (live since Sat Nov 7 with its rows off): Fewer database trips, Load games at once and Show last screen at once; being built (Zip 12 step C): Instant admin. Card cleanup: the live row was read ON with the read-only PIN after the Zip 12 deploy (Sat Nov 7), so the seed keeps it on (an earlier note here said it was not on live yet).
Since Zip 14 (Sun Nov 8, read on live with the read-only PIN right after the Zip 14 deploy): EVERY Settings row is ON on live, including Alert cards, Seat dots, the four speed rows and the three Zip 13 rows (the older notes here had some of them off), so the preview database gets them all (`OFF_ON_LIVE` is empty), plus the row being built: Game day card (`ZIP14_SWITCHES_ON`). `[env.preview.vars]` also has `GAME_DAY_TEST = "on"` (preview only, never production): open the preview once with `?gamedaytest=on` and that phone sees the next game's date as today; `?gamedaytest=off` ends it.
When Alex switches another row on (or off) on live, change that list too.
Since Zip 30 (Tue Nov 10): the row being built is Acting for others (`BUILDING_ON` in `scripts/preview-world-small.ts`, added to the live preview database with one INSERT, no re-seed), and migration `0018_phone_tag` was applied to `pickleball-preview` first (one nullable column and one small index; no fake data changed, no names added). The seed makes no phone codes: the card starts empty. To see it, open the preview in a private window (a phone that is not signed in as the organizer: the organizer's own phone is never recorded), pick **Parker**, tap I'm in, Drop out and I'm in again (3 taps teach the phone it is Parker's), then Not you? > **Sage** > I'm in. Admin Home then shows "Parker signed up for Sage" and History says "(from Parker's phone)".
Since Zip 24 (Mon Nov 9): the row being built is Booking hours (`BUILDING_ON` in `scripts/preview-world-small.ts`, with Totals refresh). It is added to the live preview database with one INSERT (no re-seed). Add game and Edit game show the tap-to-pick times with no link needed; Game day card is already on, so the Court box shows.
Since Zip 23 (Mon Nov 9): the row being built is Totals refresh (`BUILDING_ON` in `scripts/preview-world-small.ts`, with Unpaid nudge). It was added to the live preview database with one INSERT (no re-seed). Money > Totals shows the new look with no link needed.
Since Zip 17 (Sun Nov 8): the preview database is the small world ("The fixed names" above); the row being built is Unpaid nudge (`BUILDING_ON` in `scripts/preview-world-small.ts`). Vic, Wren and Zoe owe for 1, 2 and 3 past games (7:00 AM games on three days in a row, finalized at $14).
Since Zip 16 (Sun Nov 8): the row being built is After-game cards (`ZIP16_SWITCHES_ON`); Game day card and Second Chance stay on the preview as before. Calm previews show the after-game card and the owe card when it owes more after Finalize (everything else behind `?alerts=all`). Preview only: open `/?as=Parker` (or Rowan, Quinn) and that phone picks that fake name, the same as tapping it on Who are you? (the server says "preview" only where `PREVIEW_CALM` is set, so the link does nothing on live). The cards last 7 days after the seed; re-seed after that.
Since Zip 15 (Sun Nov 8): the row being built is Second Chance (`ZIP15_SWITCHES_ON`), and `[env.preview.vars]` has `SECOND_CHANCE_TEST = "on"` (preview only, never production): open `/admin?noontest=on` once and that phone sees the Second Chance cards as if it were noon on game day (`?noontest=off` ends it), and the two Telegrams are a visible fake listed on Home ("Telegram (preview, not sent)"), never sent. Round 2 (Nov 8): the seed's game day is the next Tuesday or Thursday (not a holiday) whose only game is the regular one, still empty, so no other game takes a half hour in Reopen's time list: that regular 8:00 PM game, Not booked, canceled the night before with 3 in (Organizer Orla, Harper who had paid $14 and now has it as credit, Gray with no Venmo), is the Second Chance card; 5:15 PM canceled the night before with 2 in (Orla, Blake): no card; 8:15 PM, Not booked, added that morning: Avery paid, Kai (Venmo saved) and Reese (no phone, no Venmo) owe. (No such day in six weeks: the first day with no game at all, with an extra game at 7:30 PM. The seed summary prints the day.) Calm previews: `PREVIEW_CALM = "on"` in `[env.preview.vars]` shows only the zip's own cards by default; `?alerts=all` shows every alert on that phone. The cancels go through the real site; only the two "canceled at" times and the 8:30 game's "made at" are set by hand, since the fake clock cannot run ahead. Re-seed once that game day has passed.


## Use it

1. Push your branch (anything but `main`) and deploy a preview:
   ```
   npm run deploy:preview
   ```
   (Zip 28: it builds, refuses a detached checkout and refuses `main`, and ships with `--branch <your branch name>`. The long form it runs is
   `npx wrangler pages deploy dist --project-name pickleball-club --branch some-branch-name`.) A `main` branch deploy is the LIVE site. Never use `--branch main` for a test.
2. Open the address it prints. Check the group name says **PREVIEW, fake data**.
3. Tap anything. Re-seed whenever it gets messy (below).

A quick proof you are on the practice copy: the group name says PREVIEW, fake data, and
the Settings > Alerts test button answers "Not connected" (there is no Telegram bot there).

## Re-seed (wipe and refill, one command)

```
npm run db:seed:preview
```

It takes about 10 seconds. It plays the fake group out on a throwaway copy of the
site on the computer (using the real site rules, so every number is honest), then
replaces everything in `pickleball-preview` with that. Your taps on previews are
erased, PIN lockouts are cleared, and the games are placed around today again.
Add `-- --dry-run` to build everything and run the checks without touching Cloudflare
(`npm run db:seed:preview -- --dry-run`).

Safety built into the command: it only talks to the database named
`pickleball-preview` with id `6f94e087-0596-4286-8945-647923b349a0`, it refuses if
that is the live id, and it refuses if the database holds a group that is not marked
"PREVIEW, fake data". It never reads live data.

Files: `scripts/seed-preview.ts` (the command), `scripts/seed-preview-world.ts` (the
fake world), `tests/preview-seed.test.ts` (proves the fake world passes the live health
checks and covers every state).

## When the real database changes (a new migration)

Status: the preview database and live both have migration `0017_court` (Zip 14, the court number `sessions.court`): the preview Sun Nov 8 about 12:00 AM, live Sun Nov 8 about 1:15 AM Eastern at the Zip 14 deploy. The seed fills it correctly because it is built by the real site code.

Previews share one practice database, so a new migration must reach it too, or a
preview of newer code will break:

```
npx wrangler d1 migrations apply pickleball-preview --remote --env preview
npm run db:seed:preview
```

(`--env preview` is needed: without it the command says it cannot find the database.
The live database gets its migration through the normal deploy steps; do the preview
one first, it is the practice run. `npx wrangler d1 migrations list pickleball-preview
--remote --env preview` shows what is waiting, and changes nothing.)

## How the safety was proven (Sun Nov 1, 2026, about 3:35 PM Eastern)

- Read-only row counts of the live database before and after a test tap on a preview
  were identical (all 16 tables).
- The test tap (Kai said "I'm in" on a game) appeared in `pickleball-preview` only.
- Cloudflare's own record of the preview deploy shows database `pickleball-preview` and
  no Telegram or clock secret. The preview's test-alert button answered "Not connected",
  and the clock endpoint answered "Not found" with no password and with a wrong one.
- Every other existing preview deploy (`preview-admin-audit`, `preview-admin-look`) also
  uses `pickleball-preview`. No preview deploy points at the live database.

## Undo

- **Put previews back the old way** (do not do this, it would point previews at real data): delete the `[env.preview]` block in
  `wrangler.toml` and the Preview database binding in the Cloudflare dashboard (Workers &
  Pages, pickleball-club, Settings, Bindings, Preview). Then previews would again share
  the live database. Do not do this.
- **Just wipe the taps:** re-seed (`npm run db:seed:preview`). That is the only approved way to reset it. Never delete it.
- **Delete one preview address:** Cloudflare dashboard, pickleball-club, Deployments,
  the three dots on that row, Delete.
