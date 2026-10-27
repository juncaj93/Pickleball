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
  button** (I'm in / I'm out / Join waitlist / Join standby), and a small
  Add to Calendar link. No money on the rows

**The organizer** signs in at `/admin` with a PIN. A floating pill at the
bottom has three tabs: **Home**, **Players**, **Settings**.

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

- the **day-before** card (from 24 hours before play) and the **last-call** card
  (from 13 hours before), each with Text the group, Copy message, and Done, until
  the cancellation deadline
- "5 going, need 4 or 6" with the choices
- "Tell them they're in": a text draft for each person moved off the waitlist
- "Was 6, now 5: discount and credits are off" when a session drops below 6
  after the discount was shown, listing anything to sort out by hand
- each person's credit balance, with **Clear credit**
- who owes you, with one-tap **Mark paid**; on game day that day's unpaid
  players move to a **Mark paid tonight** card at the top
- **Pay back** after a cancel: who already paid, with a **Refunded** checkbox
- check-in texts that are due

**View as…** in the header shows exactly what any player sees, with a "Viewing as
Ryan" banner and Exit. Taps there really happen for that player, and the log
records that the organizer did it.

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

## Monthly money (organizer only)

Settings → **Monthly money** shows, for any month: collected (people marked
paid), court costs (the cost entered on a session, or the **Typical court
cost** setting, default $48), credits still owed, and a bottom line like
"Surplus: $14 toward the $30 membership" or "Short: $8" (membership from the
**Monthly membership** setting). Only sessions that were played count;
canceled ones never do. None of it is ever sent to players.

## How money works

Everyone confirmed pays a flat **$14** per session. Waitlisted people owe
nothing until they're confirmed.

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
- **Backup:** Settings → Download CSV.
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
npm test               # 140 server and logic tests
npm run test:e2e       # 70 browser checks (needs Playwright + Chromium)
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

- No push notifications or automatic texts. Warnings appear when the
  organizer opens the dashboard.
- The site can't book or cancel courts with the venue. It records what you
  did.
- Payments are marked by hand after checking Venmo.
- One group per deployment. The time zone is set at setup (Eastern by default).
- Light / dark mode is saved per phone; players follow their phone's setting.
- The session schedule (Tue/Thu, 8–10 PM) is fixed in code.
