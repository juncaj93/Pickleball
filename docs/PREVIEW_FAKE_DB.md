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

## The practice group

- Name on screen: **Pickleball Bros (PREVIEW, fake data)**. If you ever see that
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
| Then | **Booked and full (10 in)** with a real **standby** | Gray is the standby; Indy, Jordan, Finley paid; Morgan tapped I paid; the rest owe $14 |
| Then | **Canceled** ("Court closed") | Finley, Gray, Harper paid $14 and got it back as credit |
| Extra game "Late-fee test", 11 hours after the seed | **Booked**, already past its cancel-by (start minus 12 hours) | Jordan, Lane, Morgan, Kai in (Kai paid cash). Open the preview with `?latefees=on` as one of them and tap Drop out: it leaves 3, so they owe $14 unless someone takes the spot |
| Extra game "Fee split test", 10 hours after the seed | **Booked**, already past its cancel-by | Orla, Avery, Indy, Jordan, Lane, Morgan in (6); Indy, Lane, Morgan paid cash. Gear menu > Cancel session > No: each owes $9, the three who paid get $5 back as credit |
| Old "Test game" (Fri Oct 30 on a Wednesday seed) | Canceled early | Nobody in, no money, no venue charge: the one game that can be hidden (Money page rework). Games with money in them cannot be hidden |
| "Sunday run", "Monday run" (Nov 1 and 2) | Played, finalized | 4 each, all paid $14, court $48: two fully paid previous games |
| Extra game "Owes, one no number" (68 hours after the seed) | **Booked**, 5 in | Indy paid; Kai, Lane, Morgan owe $14 and have numbers; Reese owes $14 and has NO phone number saved (Text all skips Reese) |
| Extra game "Mixed payments" (20 hours after the seed) | **Booked**, 5 in | Lane and Morgan paid cash; Kai (Venmo saved) and Gray (no Venmo) owe $14. The Money rows and the Remind sheet use this one to show "Request" next to Mark paid. |
| Extra game "Fee split $11" (11.5 hours after the seed, or 10.5 if that time is taken) | **Canceled late, fee not waived** (fee split on) | 5 were in; Kai, Christopher Vanderberg and Jordan each owe **$11**; Lane and Morgan paid $14 and got $3 back as credit. A Venmo request from here must say $11. |
| Extra game "All paid" (44 hours after the seed) | **Booked**, 4 of 4 paid | Indy, Jordan, Morgan, Lane: everyone paid but not played yet, so it stays in the Games list (it moves to Previous games once finalized) |
| Everything after | Normal empty games | The site makes these by itself |

The three old extra games only exist when the two latest played games are about 5 days apart (a Wednesday or Thursday seed); a Sunday seed leaves them out.

- Venmo usernames are saved for Avery, Harper, Indy, Kai, Lane and Christopher Vanderberg; Jordan, Gray, Morgan and Reese have none (they show "no Venmo saved").
- Money states: credit left over for **Casey ($3)**, **Lane ($3)**, **Morgan ($3)** and **Harper ($14)** (Lane's and Morgan's $3 come back from the
  canceled "Fee split $11" game); Casey and Harper are in no upcoming game so you can tap I'm in and watch credit apply; **Gray** has a
  **$14 cash-out pending** (Home card with the Venmo button, then Mark refunded);
  players who owe $14; a paid player.

## Switches on from the seed (PREVIEW SWITCHES RULE, Nov 4)

A preview behaves like live: the Settings > Feature switches rows that are ON for everyone on live are ON right after a seed, plus
the switch being built, with no `?something=on` link. The list is `PREVIEW_SWITCHES_ON` in `scripts/seed-preview-world.ts`
(Nov 4, as on live: New admin layout, Admin screens round 2 and 3, Ask for payment on every game, No Venmo? note, Moved-game notice,
Late drops owe $14, Player screen fixes, Pay sheet, Texts and alerts round 2, and Late-cancel fee split (switched on live Wed Nov 4); Money page rework (switched on live Thu Nov 5, about 9:00 AM); plus Instant taps (built Thu Nov 5, not yet live) and the three being built, Adjust credit, Venmo request and Home collapse (Zip 6)). The wrangler.toml switches are already "on" in `[env.preview.vars]`.
When Alex switches another row on (or off) on live, change that list too.

## Use it

1. Push your branch (anything but `main`) and deploy a preview:
   ```
   npm run build
   npx wrangler pages deploy dist --project-name pickleball-club --branch some-branch-name
   ```
   A `main` branch deploy is the LIVE site. Never use `--branch main` for a test.
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

Status: the preview database matches live through migration `0016_time_confirmed` (the "Time may shift" column `session_players.time_confirmed`, applied Sun Nov 1). The seed fills it correctly because it is built by the real site code.

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
