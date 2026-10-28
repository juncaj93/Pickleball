# Pickleball Bros

A private, phone-friendly website for a group that plays every **Tuesday and
Thursday, 8:00–10:00 PM Eastern** on one court. It handles sign-ups (exactly
4 or 6 players), the waitlist, court booking notes, cancellation deadlines,
substitutes, payments, and credits. It drafts text messages for the organizer,
but **it never sends a text by itself**.

## What each person sees

**Players** open https://pickleball.juncaj.net (or the old private link),
tap their name once ("Who are you?"), and the phone remembers it. After that every visit opens on
"Welcome, Ryan" with a small "Not you?" button. One screen shows:

- a "Want in on Tuesday? Yes / No" card for a usual day they haven't
  answered yet (regulars only)
- on game day, from 8:00 AM, a card at the very top: "Tonight: you owe $14"
  with a big **Pay with Venmo** button (amount and a note like "Pickleball Tue
  Nov 3 - Ryan" filled in). Several unpaid sessions combine into one total.
  It stays until the organizer marks them paid; opening Venmo never does
- a schedule of date tiles (TUE / 3 / NOV) with the time, court status
  (Court booked / Court not booked yet / Waiting on the court), any holiday, who's in ("3 of 4 in"), **one big
  button** (I'm in / I'm out / Join waitlist / Join standby), a small
  **Pay $14** button once they're in (it becomes "Sent? Robin confirms when it
  arrives." after tapping, and "✓ Paid" once marked), and Add to Calendar
- **Subscribe in Apple Calendar** at the bottom: a private link with only
  their sessions, kept up to date (Apple refreshes on its own schedule)

**The organizer** signs in at `/admin` with a PIN. A floating pill at the
bottom has four tabs: **Home**, **Money**, **Players**, **Settings**.

Every session card on Home shows the court and the players as two separate
lines, and each session appears once:

- **Court booked**: solid green left edge, a check, and the cancel-by deadline
- **Court not booked**: amber dashed border and a banner with **I booked it**
  (one tap; the deadline starts at 12 hours before play), only once the
  booking window is open (14 days before play)
- further out: a quiet gray "Booking opens Tue, Nov 17" (I booked it is
  under More if you book early)
- **On the court waitlist**: blue banner with **Court opened** / **Didn't open**
- canceled or no court: gray, with the reason
- players: "2 of 4 in" plus the waitlist count, over a pill per spot (6 once 5
  or more are in): names fill them in sign-up order, open spots stay blank.
  Players see the same pills, with their own name ringed
- short on players (from the day-before check-in): Invite people / Reschedule /
  Cancel / Keep as is, right on that card

**Book a court** (blue-teal, opens CourtReserve in a new tab) sits next to the Sessions title, and a **Book** link sits next to I booked it on each card that needs a court. Booked sessions link to CourtReserve's change/cancel page from More, Reschedule and Cancel session. Sessions are grouped
by calendar week. The red number on the Home tab counts Needs attention items
plus courts to book inside the booking window. Today's date and **View as…**
sit at the top right of the green header. Reservation number and court cost are optional,
under More details in Edit booking.

Home starts with a short "Needs attention" list for things that aren't one
session's court (hidden when there's nothing in it):

- "5 going, need 4 or 6" with the choices
- "Was 6, now 5: discount and credits are off" when a session drops below 6
  after the discount was shown, listing anything to sort out by hand
- each person's credit balance, with **Clear credit**
- who owes you, with one-tap **Mark paid**; on game day that day's unpaid
  players move to a **Mark paid tonight** card at the top
- **Pay back** after a cancel: who already paid, with a **Refunded** checkbox
- check-in texts that are due

**View as…** in the header shows exactly what any player sees, with a "Viewing as
Ryan" banner and Exit.

**View as… and Pretend it's… are a demo.** Taps work and show what would
really happen (I'm in fills a dot, the 4-or-6 rule and waitlist react, Pay then
"I paid" then Paid, Mark paid, Refunded, Add game, Cancel, Move, I booked it),
but nothing is saved: the browser loads a copy of the data (the same
organizer-only backup file) and runs the site's own rules on it, in that tab
only. The live site is never asked to save anything. A dark bar says "Demo,
nothing is saved" with **Reset** (throw the demo changes away). Leaving the
demo, signing out, reloading or closing the tab throws them away too. Pay opens
nothing in the demo; Messages and Add to calendar work as usual.

**Pretend it's…** (in the View as menu) runs the demo at any moment, Eastern
time: pick a date and time or a preset (Game day 7:00 AM or 8:30 AM, Day
before 8:00 PM, Last call, Booking opens 12:00 AM, After the game). Every card
and line follows that time. The bar adds the time and an **End** button; it
also ends after 30 minutes. Players never get any of this.

**Pay** never takes the player away from the site: on a phone it opens the
Venmo app with the amount and note, on top of the page; on a computer the
Venmo website opens in a new tab. Back in Safari, the pickleball page is right
where it was, with "I paid" ready.

Pictures of every screen state: `docs/state-gallery/` (made by `node e2e/gallery.cjs`).

Every text is a draft with **Open in Messages** and **Copy message** buttons.
The status says "Draft ready" or "Composer opened", never "Sent".

## How spots work (one court: 4 or 6, never 5)

- The first 4 to sign up are in. The 5th joins the waitlist as #1.
- When a 6th person joins, both waiting people are confirmed at once and see
  "Good news, we now have 6, an even number, so you're in."
- If someone drops out of 4 and someone is waiting, the first waiting person
  moves in.
- If someone drops out of 6, nothing moves by itself. The organizer sees
  "5 going, need 4 or 6" and picks: move the next waiting person in, invite
  someone, move one person back to the waitlist, or cancel.
- The database refuses a 7th confirmed player, and every spot change is a
  single guarded step, so people tapping at the same second can't land on 5.

## Court waitlist

When the organizer is on the venue's own waitlist for a court ("On court
waitlist" under More), players see "Waiting on the court. Join the
standby list so we're ready if it opens." and tap **Join standby**. Standby players owe
nothing. **Court opened** (one tap) confirms them in order by
the 4-or-6 rules and prepares a text for each; **Didn't open** marks the
session off as "Court didn't open". A session before the first session date
can be shown with **Show this session**.

## Texts when a session changes

Canceling a session opens a ready text ("Pickleball Tue, Nov 3 is canceled.")
and moving one opens "Pickleball moved to Thu, Nov 5, 8:00 to 10:00 PM.", each
with an optional one-line reason, **Text the group** and **Copy message**.
After a cancel, the same screen lists who already paid, with **Refunded**.

## Session cards

Each card has two round icons at the top right. The **phone** opens that
session's prepared texts (Share the game, Poll, Day before, Last call, Spot
open, Canceled or Moved), each with Open and Copy. The **gear** opens the
options: a full-width **Share the game** (a text for the group linking
straight to that session, worded for booked / not booked / court waitlist)
with Copy, then Edit booking | Players and Modify court | Cancel session.
Moving a session lives inside Edit booking ("Move this session").

Shared links end in `?s=<session>`: the player screen opens with that session
highlighted (after picking a name on a new phone).

## Day before and last call

The old day-before and last-call cards are gone. The same texts now come from the
**Text suggestion cards** at the top of Home (see below): Need players, and Check-in to the
players who are in with their saved numbers ("Missing numbers: ..." for anyone without one).

## Money tab

The month's summary at the top (collected, court costs, credits owed, and a
bottom line), then each session's payments with Mark paid, the Pay back list
with Refunded, and credits with Clear credit. "Mark paid tonight" stays on
Home on game day.

**You are the one who pays the venue.** In every session's Who paid list, your
own row is a court row: "You pay Northville Pickleball", the full court cost
(the booking's cost, else the typical cost, $48 to start), and a small gray
line "Players cover $42, your share $6" (what the other players owe under the
usual rules, and the rest is yours, never below $0; "Players cover the court"
when they cover it all). Your Mark paid / Unmark mean "I paid the venue", and
the badge says **Court due** or **Court paid**. There is no Payment reminder
on that row. Counts like "1 of 3 paid" and "2 owe" count the other players
only. Your own $14 is never money collected from players, you get no player
balance on the Players tab, no Pay button or pay card, and you earn no $5
credit. A game you are not in still has the court row (marking it paid adds a
quiet "declined" record for you on that game; it never takes a spot).
Canceled games have no court row. Players never see any of this.

## Held money and refunds (organizer only)

Players can pay ahead. Money paid for a game that hasn't been played yet is
**held**: the Paid pill and amount are blue with "not played yet" beside them,
the monthly card gets a blue **Held** row (only when above $0), and the Players
tab shows a small blue "$28 held" under a balance. When the game is played the
money moves from Held to Collected, and turns green. Collected, Court costs and
Left only ever count played games. Your own court row is never held money.

When a game is canceled, or a paid player leaves, a **Refund needed** card
sits at the top of Home (and the same buttons are on that game's row in Money >
Who paid). **Refund** opens Venmo (the app first on a phone) with the exact
amount and a note like "Pickleball Thu Oct 29 refund", addressed to that
person if their Venmo is saved, otherwise you pick the person. Opening Venmo
never marks anything. **Mark refunded** then records it (and Undo takes it
back). Nothing is sent by the site.

Players > Edit has an optional **Venmo link or @name**. Paste a profile link
from the Venmo app (or type @Name); only the username is saved. It is organizer
only and is never in any player screen or response. It is in the backup file
and comes back on restore.

## Credit (organizer and players)

When a game is canceled, or a paid player leaves it, the **Refund needed** card on Home
and that game's row in Money > Who paid now offer two choices for each payment:

- **Refund** opens Venmo with the exact amount, as before. **Mark refunded** records it.
- **Keep as credit** turns the payment into that player's credit. Until you choose, the
  money stays held. A game canceled before credit existed can still be kept as credit
  later. **Undo** takes it back, as long as none of that credit has been spent yet.
  Late drops work the same way and keep their "Late drop" tag.

Credit is **one pot per player**, with no expiry, usable on any later game. It adds to the
older $5 credit (that rule and its wording are unchanged). On their own screen a player sees
a small "You have $14 credit" line, and on a game they owe for a **Use credit** button. It
takes the smaller of their credit and what they owe, and only when they tap it. If it covers
everything the game shows "Paid with credit"; otherwise they pay the rest with the normal
Pay button for the remaining amount. At most one green button per card: Use credit is the
green one when it covers the whole amount, otherwise Pay stays green. If they drop out of a
game paid with credit, or it is canceled, the credit goes back to them. You can **Unmark**
any credit use. Nobody sees anyone else's credit.

Players tab: each row shows the credit with the balance; tapping a row shows the history by
game. **Refund credit balance** opens Venmo (their saved Venmo, note "Pickleball credit
refund") for the full credit; **Mark refunded** then drops the balance to $0, with **Undo**.
Opening Venmo never marks anything.

Money tab: kept credit counts in **Credits owed** (in the month of the canceled game, oldest
credit spent first) and leaves **Held**. It was never in Collected, so it is not taken off
**Left**; the card says so. Credit used for a game counts as collected in the month that
game is played.

Canceling within 12 hours of the start asks **Were you charged for this court?** (No is the
default). A Yes with an amount counts as that canceled game's court cost. Outside 12 hours it
is not asked, and canceled games stay at $0 court cost. The Canceled text now reads "...is
canceled. If you paid, it stays as your credit. Want a refund instead? Text me."

All of it is in one new table, `credit_ledger` (migration 0012). Entries are never deleted:
an undone entry, or credit that went back to the player, just stops counting. The table is in
the backup file; older backups without it still restore.

## Text suggestion cards (organizer only)

At the top of Home, one card per game that needs a text (at most 2, with a small "more"
link). Each shows the game and time, a one-line preview, who it goes to ("Group chat" or "4
players"), and one green **Text** button that opens Messages with the words and numbers
ready. The site never sends anything and never says it did.

- **Need players**: fewer than 4 in and the game is within 48 hours (group chat).
- **Check-in**: exactly 4 or exactly 6 in, from 6:00 PM the day before until the game
  (to the players who are in).
- **Down to 5**, **Now 6**, **Spot opened**: right when it happens, while it lasts.
- **Payment reminder**: a played game, 7 or more calendar days ago, someone still unpaid. One
  unpaid player gets a one-person text; two or more get "Remind all unpaid".
- Canceled or moved, and Share the game, are not cards (they stay in the gear menu).

After you tap Text the card hides until the situation changes (the number of players
changes, or something else happens). That is remembered on your phone only; nothing is saved
on the server. Players and "View as" never see the cards. With nothing to suggest, Home
looks as it always did. These cards replace the old day-before, last-call, "Tell them
they're in" and late-drop text cards, so nothing shows twice.

## The Text menu (organizer only)

The gear panel's **Text** button lists only the texts that fit that game right
now, each with a small gray line saying who it goes to. Every text ends with
the plain site address, and every game time reads like "Tue Nov 3, 8:00 PM".
The site only opens Messages with the words ready; it never sends anything.

- Group chat (you pick the chat): **Share the game** (any upcoming game),
  **Need players** (fewer than 4 in), **Down to 5** (a game that fell from 6 to 5).
- Saved numbers (one group text, with a "Missing numbers" note): **Check-in**
  (exactly 4 or 6 in, to everyone signed up), **Now 6** (the 2 players the
  waitlist moved up), **Spot opened** (one waitlisted player who moved in),
  **Canceled** or **Moved** (everyone signed up and on the waitlist).
- Money tab: each unpaid player has a **Payment reminder** (the total if they
  owe for several games), and with 2 or more unpaid, **Remind all unpaid**.

The unpaid card on a player's screen starts at 8:00 AM on game day and stays
at the top until they pay, even after the game. One compact card lists every
game they owe for. Never for canceled games or the organizer.

## Late drops

A confirmed player who drops out after the cancellation deadline (12 hours
before play by default, or that booking's own deadline) is a late drop: a "Late drop" card on Home with
the name and time and, if they
had paid, "Ryan paid $14 and dropped. Refund?" with **Refunded**. The session
card shows a "Late drop" tag, and the Players screen counts them ("Late drops:
2", organizer only). Removals by the organizer don't count.

## Telegram alerts (organizer only)

The site sends the organizer a short Telegram message when:

- someone drops out of a game within 36 hours of its start
- a game falls below 4 (4 to 3) or goes from 6 to 5
- a game reaches 6 (so you can text the two who moved up)

A drop after the game's cancellation deadline starts with "Late drop:". One tap
that causes more than one of these sends one message, like "Late drop: Ryan
dropped out of Thu Nov 5, 8:00 PM (9 hrs before). 3 in now, need 4 or 6.",
with an **Open site** button to `/admin`. Names and game times only: no phone
numbers, no money.

Only player taps (on the site or a texted link) send alerts. Never your own
taps, View as, Pretend it's..., canceled, hidden or past games, or anything
else (payments, new names). The message goes out after the player's tap is
done, with a 5-second limit, so Telegram being slow or down never slows down a
tap. At most 20 alerts go out per hour, so a bug can't flood your phone.

Settings > **Alerts** has an on/off switch, one switch per alert (all on to
start), **Send test alert**, and a status line ("Connected · Last alert:
7:12 AM", or "Last alert failed" with the reason). The bot token and your chat
ID are Cloudflare secrets (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`); they never
reach a browser, the repo, or the backup file, and the bot only messages that
one chat. To turn alerts off for good, delete those two secrets and redeploy.

## Calendar subscriptions

Each player's link lists only their sessions (title Pickleball, the club's
address, Eastern time, canceled ones marked canceled). No money or names. The
organizer's link in Settings lists every session. Turn a person's link off
from Players; the old link stops working for good.

## Monthly money (organizer only)

Settings → **Monthly money** shows, for any month: collected (what the other
players paid; your own payment to the venue is never in it), court costs (the
full cost entered on a session, or the **Typical court cost** setting, default
$48), credits still owed to players, and a bottom line. When players paid more
than the courts cost it says "Surplus: $14 toward the $30 membership". When
they paid less it says "You covered $8 of the court costs". You never show up
as the source of a surplus. The membership stays your own separate $30 (from
the **Monthly membership** setting). Only sessions that were played count;
canceled ones never do. None of it is ever sent to players.

## How money works

Everyone confirmed pays a flat **$14** per session, except the organizer, who
pays the venue the full court cost and is reimbursed by the others' $14s.
Waitlisted people owe nothing until they're confirmed.

When exactly 6 are confirmed:

- the two who moved in when the 6th joined owe **$9** ("6-person discount")
- the first four see "6 are playing. You'll get a $5 credit toward your next
  session."
- after the session ends with 6, each of the first four gets a **$5 credit**,
  and their next session shows "You owe $9 (includes your $5 credit)"

If the count drops below 6, everyone is back to $14 and no credits are
issued; the organizer gets a card to sort out anything already paid by hand.
Settings has "Price per player" and "Credit per person when 6 play" ($5).
The organizer's **court cost** is a private record on the booking form: it is
never on a player screen, in a text, or in the export. A player only sees a
soft "may not have marked this paid yet" note once the session ended more
than 24 hours ago.

## Holidays and the first session date

Sessions on New Year's Day, Memorial Day, July 4, Labor Day, Election Day,
the day before Thanksgiving, Thanksgiving, Christmas Eve, Christmas Day, and
New Year's Eve get a holiday pill (plus "check venue hours" for the
organizer, until they tap "Venue is open normal hours", which leaves just
"✓ Election Day"; Undo brings it back). The list is built in; no outside
service. Settings > "First
session" hides and stops creating any session before that date.

## Players adding themselves

"Who are you?" has **Add my name**. If the name looks like someone already
listed, it asks "Is this you?" first. New names get a "New" tag on the
Players screen. Removing a name deletes it if the person never signed up or
paid; otherwise it's hidden so old records stay correct.

## Home Screen app

Settings shows the 3 iPhone steps (Share > Add to Home Screen > Add), and
players see them once. The icon opens the site full screen. To use the club
logo (kept at `branding/logo.jpg`), run `node scripts/make-icons.cjs branding/logo.jpg`:
it trims the empty margin, centers the art on white with padding for the
iPhone's rounded corners, and writes every icon size plus the small header
logo into `public/`. Then redeploy.

## Day-before check-in and deadlines

At **24 hours before play** (Settings: "Day-before check-in") a session that
needs players gets flagged and check-in texts become due. Each session has its
own **cancellation deadline**, 12 hours before play by default (Northville's
rule), editable on any booking. Until then the organizer can reschedule or
cancel; after that it shows "Deadline passed".

## What runs where

| Piece | Service | Notes |
| --- | --- | --- |
| Website | Cloudflare Pages (free) | Static files are free and unlimited |
| Server code | Cloudflare Pages Functions (free) | Everything under `/api` |
| Database | Cloudflare D1 (free) | SQLite. All times stored in UTC, shown in Eastern |

No SMS service, payment processor, AI service, maps, or analytics is used.
The one outside service is Telegram's free bot API, for the organizer's alerts.

### Free-tier limits

- **Requests:** 100,000 server requests per day. Six friends will use a few hundred.
- **CPU time:** 10 milliseconds of computer time per request. PIN checking is
  tuned to fit inside this.
- **Database:** 5 million rows read and 100,000 rows written per day, 5 GB storage.
- **Daily reset:** the counters reset at **8:00 PM Eastern** during daylight
  saving time (right now, through Saturday, Oct 31, 2026) and at
  **7:00 PM Eastern** the rest of the year (starting Sunday, Nov 1, 2026, until
  the clocks spring forward in March). Cloudflare's reset happens at the same
  moment worldwide, so the Eastern clock time shifts by an hour twice a year.
- **What happens if a limit is hit:** requests fail with an error until the
  daily reset. Your data is not lost, and nothing is charged. Since
  Sept 1, 2026, Cloudflare blocks free accounts at the limit instead of
  billing them.
- **Sleeping:** Cloudflare D1 does not pause idle databases (unlike Supabase's
  free tier, which pauses after a week without use).
- **Payment method:** the Workers Free plan is not supposed to ask for a card.
  If Cloudflare ever asks for one, stop and check before entering it.
- **To shut it down:** delete the Pages project and the D1 database in the
  Cloudflare dashboard. Nothing keeps running or billing after that.

**What was verified, and how (Oct 26, 2026):** read first-hand on
Cloudflare's own pages below.
- D1 pricing: 5 million rows read and 100,000 rows written per day, 5 GB
  total storage. Past a daily limit, "D1 API will return errors to your client
  indicating that your daily limits have been exceeded."
- D1 enforcement notice: starting Sept 1, 2026, free accounts get errors
  "until the limit resets at midnight UTC," and stored data "is not affected."
  It mentions no charges.
- Pages Functions pricing: Functions requests share the Workers Free plan's
  100,000 per day, reset at midnight UTC. Static files are "free and
  unlimited."
- Payment method: none of these pages say. Creating the D1 database and the
  Pages project for this site through Cloudflare's API did not ask for a card.

Still not confirmed: the exact message a visitor sees when the Functions
request limit is hit (the Pages Functions page doesn't say).

Sources: [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/),
[D1 free-tier enforcement](https://developers.cloudflare.com/changelog/post/2026-09-01-d1-free-tier-limit-enforcement/),
[Pages Functions pricing](https://developers.cloudflare.com/pages/functions/pricing/).

## Deploy (about 15 minutes, one time)

You need a free Cloudflare account and Node.js 22 or newer on a computer.

```bash
npm install
npx wrangler login                     # opens a browser to sign in to Cloudflare

# 1. Create the database, then paste the printed database_id into wrangler.toml
npx wrangler d1 create pickleball

# 2. Create the tables
npm run db:migrate:remote

# 3. Create the site
npx wrangler pages project create pickleball-club --production-branch main

# 4. Set the one-time setup code (any long random text; keep it private)
openssl rand -base64 24                # prints a random code you can use
npx wrangler pages secret put SETUP_TOKEN --project-name pickleball-club

# 5. Build and publish
npm run deploy
```

Wrangler prints the live address, for example `https://pickleball-club.pages.dev`.

### Create the group and admin PIN

1. Open the live address and tap **Set up the group** (or go to `/setup`).
2. Enter the setup code from step 4, the group name, your PIN (6–12 digits)
   twice, your Venmo link, and the six players. Phone numbers are optional;
   add one only if that player agreed to get reminder texts.
3. Copy the player link it shows you and text it to the group.

Setup only works once. After that, the setup page refuses to run again. You
can delete the `SETUP_TOKEN` secret if you like.

The player link looks like `https://<your-site>.pages.dev/g/<random-key>`.

## Everyday maintenance

- **Change the PIN:** Settings → Change PIN. Every other signed-in device is
  signed out.
- **Forgot the PIN:** there's no reset email. Run this from the project folder
  to set a new one (replace `NEWPIN`):
  ```bash
  node --experimental-strip-types -e "import('./server/crypto.ts').then(async m=>console.log(await m.hashPin('NEWPIN')))"
  npx wrangler d1 execute pickleball --remote --command "UPDATE groups SET admin_pin_hash = '<paste the printed hash>'"
  ```
- **Player link leaked:** Settings → Replace link. The old link stops working.
- **Backup:** Settings → Backup → Download backup file. Restoring: see `docs/RESTORE.md`. (Download CSV is a report only.)
- **Redeploy after a code change:** `npm run deploy`.
- **New database changes:** add a numbered file in `migrations/`, then
  `npm run db:migrate:remote`.

## Run it on your own computer

```bash
npm install
npm run dev            # http://localhost:5173 (setup code: local-dev-setup-token)
```

Local mode keeps its data in `.data/dev.sqlite`, using the same SQL as
production.

## Tests

```bash
npm test               # 330 server and logic tests
npm run test:e2e       # 521 browser checks (needs Playwright + Chromium)
npm run typecheck
```

The tests cover Tue/Thu generation across both daylight-saving changes,
duplicate prevention, the 4-then-waitlist-then-6 flow (including promotion
when someone drops from 4, the "5 going" warning, and everyone tapping at
once), the 7-player database cap, the flat $14, the $9 discount and $5
credits when 6 play (including drops below 6), the first session date,
holidays (Thanksgiving and Election Day 2026), the group poll text, the court
cost never reaching players, add-your-name with the duplicate check, delete
vs hide, I booked it, the court waitlist (standby, court opened, didn't
open, showing a hidden session), the player schedule, the day-before and
last-call card windows and wording, holiday hours, no text ever saying
"sent",
the unpaid reminder only after 24 hours, the 24-hour check-in and 12-hour
deadline, rescheduling, the remembered name, usual-day suggestions, View as,
the calendar file, expired and reused links, admin lockout, input validation,
and phone layouts at 360 to 430 px wide in light and dark mode.

## Open address

By default anyone with the site address can use it: it opens straight to
"Who are you?". Settings > "Anyone with the site address can use it" turns
that off (back to the long private link only, which always keeps working).
An optional **group word** is asked once on a new phone, then remembered;
phones that already picked a name aren't asked. Adding new names is limited
to 3 per phone per hour (by network address), new names get a "New" tag, and
"Is this you?" still catches near-duplicates. Every page and API response is
marked noindex. The player link in Settings shows the `SITE_URL` from
`wrangler.toml` (or whatever address you opened it on).

## Security notes (plain version)

- The organizer PIN is checked on the server and stored only as a scrambled
  hash. Five wrong tries from one device locks sign-in for 15 minutes (twenty
  across all devices). The count is kept in the database, so restarting the
  server doesn't reset it, and a burst of simultaneous guesses still can't get
  more than five tries.
- Personal links in texts are random, tied to one player and one session,
  expire when the session starts, and stop working once used. The database
  only stores a fingerprint of each link, not the link itself.
- Players can't see phone numbers or anyone else's payment status.
- The site sends `noindex` headers so search engines skip it, and a strict
  browser security policy.
- **Honest limits:** the PIN and private link are light protection meant for a
  friend group. Anyone with the player link can pick any name. If the link
  gets passed around, replace it in Settings.

## Known limitations

- No automatic texts to players. The organizer gets Telegram alerts for drops
  and counts (above); everything else shows when the dashboard is opened.
- The site can't book or cancel courts with the venue. It records what you
  did.
- Payments are marked by hand after checking Venmo.
- One group per deployment. The time zone is set at setup (Eastern by default).
- Light / dark mode is saved per phone; players follow their phone's setting.
- The session schedule (Tue/Thu, 8–10 PM) is fixed in code.
