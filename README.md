# Pickleball Club

A private, phone-friendly website for a group that plays every **Tuesday and
Thursday, 8:00–10:00 PM Eastern** on one court. It handles sign-ups (exactly
4 or 6 players), the waitlist, court booking notes, cancellation deadlines,
substitutes, payments, and refunds. It drafts text messages for the organizer,
but **it never sends a text by itself**.

## What each person sees

**Players** open the private group link, tap their name once ("Who are
you?"), and the phone remembers it. After that every visit opens on
"Welcome, Ryan" with a small "Not you?" button. One screen shows:

- a "Want in on Tuesday? Yes / No" card for a usual day they haven't
  answered yet (regulars only)
- "You owe $14 for Tue, Oct 27" with a **Pay $14 with Venmo** button once
  they're confirmed (opening Venmo never marks anything paid)
- the next sessions, each with **one big button**: I'm in / Join waitlist /
  I'm out, plus who's going and an **Add to Calendar** button

**The organizer** signs in at `/admin` with a PIN. A floating pill at the
bottom has three tabs: **Home**, **Players**, **Settings**. Home starts with a
short "Needs attention" list:

- courts to book, with a **Book on CourtReserve** button and Enter details
- short on players (from the day-before check-in), with Invite people /
  Reschedule / Cancel / Keep as is
- "5 going, need 4 or 6" with the choices
- "Tell them they're in": a text draft for each person moved off the waitlist
- "6 going. Everyone paid $14. Refund $5 each" with a Refunded checkbox per person
- who owes you, with one-tap **Mark paid**
- check-in texts that are due

**View as...** on Home shows exactly what any player sees, with a "Viewing as
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

## How money works

Everyone confirmed pays a flat **$14** per session, whether 4 or 6 play.
Waitlisted people owe nothing until they're confirmed. When 6 play, the
organizer refunds **$5** to each person (both amounts are in Settings). A
player only sees a soft "may not have marked this paid yet" note once the
session ended more than 24 hours ago.

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
npm test               # 89 server and logic tests
npm run test:e2e       # 51 browser checks (needs Playwright + Chromium)
npm run typecheck
```

The tests cover Tue/Thu generation across both daylight-saving changes,
duplicate prevention, the 4-then-waitlist-then-6 flow (including promotion
when someone drops from 4, the "5 going" warning, and everyone tapping at
once), the 7-player database cap, the flat $14 and the $5 refund when 6 play,
the unpaid reminder only after 24 hours, the 24-hour check-in and 12-hour
deadline, rescheduling, the remembered name, usual-day suggestions, View as,
the calendar file, expired and reused links, admin lockout, input validation,
and phone layouts at 360 to 430 px wide in light and dark mode.

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
