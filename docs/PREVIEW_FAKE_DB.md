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
   Cloudflare on Sun Nov 1): database `DB` = `pickleball-preview`; the only variable is
   `GO_LINKS`. Production keeps `DB` = `pickleball` plus the real Telegram and clock secrets.

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
| Everything after | Normal empty games | The site makes these by itself |

- Money states: credit left over for **Casey ($3)** and **Harper ($14)**, both in no
  upcoming game so you can tap I'm in and watch credit apply; **Gray** has a
  **$14 cash-out pending** (Home card with the Venmo button, then Mark refunded);
  players who owe $14; a paid player.

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
