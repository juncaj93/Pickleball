# If something breaks Tuesday night

One page. Plain steps. Times are Eastern. Written Sun Nov 1, 2026.

**First, breathe.** The site can't charge anyone. Money only moves when
someone taps a button, and every tap is written down. Most problems can be
waited out until after the game, then fixed calmly.

**Previews run on a FAKE database (proven Sun Nov 1, 2026).** Any preview link (a branch that is not `main`) uses
`pickleball-preview` with made-up players, no Telegram and no clock, so real taps there are safe. The group name on
screen says "PREVIEW, fake data". To wipe and refill it: `npm run db:seed:preview`. Details: `docs/PREVIEW_FAKE_DB.md`.
The fake database `pickleball-preview` must NEVER be deleted, reset any other way, or reused for anything else. Never put a test on the live address. A preview is never the place to "fix" live data.

## 1. Which kind of problem is it?

| What you see | Do this |
| --- | --- |
| Too many Telegram messages, or wrong ones | Section 3 (turn off alerts). Takes 10 seconds on your phone. |
| The direct "Text the group" link misbehaves | Section 4 (GO_LINKS off), or just use Text the group on Home. |
| The site looks broken or shows errors after a deploy | Section 2 (roll back the code). |
| Someone's seat, payment or credit looks wrong | Don't fix it by hand during the game. Write down who and what. After the game, section 5. |
| The whole site is down | Check https://www.cloudflarestatus.com. If Cloudflare is fine, section 2. |
| Players see an old screen | Ask them to close the tab and open the link again. |

## 2. Roll back the code (about 1 minute, no data changes)

1. Open dash.cloudflare.com on a computer or phone and sign in.
2. Workers & Pages, then **pickleball-club**, then **Deployments**.
3. Find the deployment before the bad one (each row shows the time and the
   first words of the change). The last known good one is in
   `docs/STAGE_NOTES.md` under the latest deploy ("Code rollback: ...").
   As of Sun Nov 1, 5:28 PM: live is `d156b8e0`; the one before it is `071a533a` (the new database column is
   harmless to the older code, so rolling back is safe).
4. Tap the three dots on that row, then **Rollback to this deployment**, then confirm.
5. Open pickleball.juncaj.net and check it loads.

Rolling back code never changes seats, payments or credit. Both addresses
(pickleball.juncaj.net and pickleball-club-9h0.pages.dev) switch together.

## 3. Turn off alerts

From your phone, fastest first:

- **Smart alerts only** (the clock's messages: last call, cancel court,
  booking, finalize): sign in at /admin, Settings, Alerts, turn off **Smart
  alerts ("Do this now" reminders)**. The "Do this now" card on Home keeps working.
- **All Telegram alerts** (also drops, "it's on", cash-out requests): Settings,
  Alerts, turn off **Telegram alerts to me** (the top switch).
- **Stop the clock itself** (only if the switches above don't help): Cloudflare
  dashboard, Workers & Pages, **pickleball-alerts-clock**, Settings, Triggers,
  delete the cron "*/5 * * * *". To bring it back, add the same cron again.

Turning alerts back on never sends old alerts twice: each alert is written down
once it goes. An alert more than an hour late is skipped, never sent late.

## 4. Turn off the direct text link (GO_LINKS)

The night-before alert's "Text the group" link opens a page that fills in the
text. If it misbehaves:

- Quick fix with no deploy: on Home, use the card's **Text the group** button instead.
- To switch the link off: in `wrangler.toml`, change `GO_LINKS = "on"` to
  `GO_LINKS = "off"`, then deploy from main (`npm run deploy`). Alerts then
  say plain words and the Open site button takes you in.

## 4b. The "time changed" notice misbehaves (TIME_SHIFT)

The notice asks players who are in to confirm a moved start time. It never moves money or a seat.

- Quick fix with no deploy: none needed for money. If players are confused, text them with the card's
  Text button or Text the group.
- To switch it off for everyone (no deploy): /admin, Settings, Schedule, turn off **Moved-game notice for everyone**.
  The notice, "Confirmed 2 of 3" and the Edit game note go away; tile borders and "~" times stay (they are just looks).
- To test it on one phone only while it is off: open pickleball.juncaj.net/?timeshift=on on that phone
  (?timeshift=off ends it).
- Last resort kill switch: in `wrangler.toml`, `TIME_SHIFT = "off"`, then deploy from main. Answers are kept.
- Never deploy this code to a database without migration 0016 (`npx wrangler d1 migrations list pickleball --remote`
  must show nothing to apply). Without it, I'm in again and moving a game fail.

Other switches in the code (each needs a deploy):

- `LIVE_UPDATES.on` in `src/livecore.ts`: `false` stops the 5-second refresh
  (pages still refresh after a tap and when reopened).

## 4c. Motion (animations) on the player screens misbehaves (MOTION)

Purely visual. If a screen looks wrong or jumpy once the motion is on:

1. **Only while it is still dark for everyone:** `?motion=off` at the end of the address ends the private test on that phone.
   (Once it is on for everyone there is no per-phone off; use step 2.)
2. **Everyone:** set `MOTION = "off"` in `wrangler.toml` (the `[vars]` block, not the preview one), then `npm run deploy` from main.
   Off means the site is exactly as it was before the motion pass. No data is touched.
3. Never needed for money: the motion cannot change a seat, a payment or a price.
4. Private test on the live site while it is off for everyone: open the site with `?motion=on` on your phone once.

## 5. Put data back (after the game, never mid-game)

Every change is in the Activity log and in Cloudflare's 7-day history.

1. **One wrong record** (a seat, a payment): fix it with the normal buttons
   (Players, Unmark, Remove player). That keeps the money rules intact.
2. **Many wrong records, or after a bad deploy that wrote bad data**: go back in
   time. On a computer with this project:

   ```
   npx wrangler d1 time-travel info pickleball
   npx wrangler d1 time-travel restore pickleball --timestamp=2026-11-03T19:00:00-05:00
   ```

   Use a time just before the problem (`-05:00` is Eastern winter time). The
   command prints a bookmark you can use to undo the undo. Everything after
   that time is lost (sign-ups, payments), so write those down first.
3. Restore points taken before each deploy are listed in `docs/STAGE_NOTES.md`
   (bookmark plus a SQL export kept out of git). `docs/RESTORE.md` has the
   step-by-step for a backup file.
4. After any restore, check Settings, Alerts, Smart alerts (it comes back On).
5. Run the read-only health check (changes nothing, prints zeros when all is well):

   ```
   npx wrangler d1 execute pickleball --remote --command "$(grep -v '^\s*--' scripts/integrity-checks.sql)"
   ```

## 6. Who to tell

- **Players**: only if a game changes. Use Text the group with a short line
  ("Site hiccup, the game is still on at 8"). Don't mention money mid-game.
- **Money**: if someone was charged wrongly, tell that one person after the
  game, fix it with the buttons (it turns into credit), and note it.
- **Claude**: open a session, paste what you saw (a screenshot helps) and the
  time it happened. Say "Tuesday night problem" so it uses this runbook.

## 7. What is safe to ignore during a game

- A missed Telegram alert: the Home card shows the same task.
- "Updated just now" stuck for a minute: the screen catches up when tapped.
- One red error banner after a tap: tap again; double taps are safe.
