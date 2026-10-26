# Pickleball Club

A private, phone-friendly website for six friends who play every **Tuesday and
Thursday, 8:00–10:00 PM Eastern**. It handles sign-ups (four spots plus a
waitlist), court booking notes, cancellation deadlines, substitutes, and who
has paid. It drafts text messages for the organizer, but **it never sends a
text by itself**.

## What each person sees

**Players** open the private group link, tap their name once, and can then:

- claim one of the four spots, or join the waitlist ("You're #2 on the waitlist")
- confirm they're still coming, or withdraw
- see their own share of the court cost and whether the organizer has marked it paid
- tap "Pay with Venmo" (this only opens Venmo; it never marks anything paid)

**The organizer** signs in at `/admin` with a PIN and gets:

- a **To do** list: courts to book (about 14 days ahead), sessions short on
  players, cancellation deadlines coming up, unpaid players, and confirmation
  texts that are due
- per session: Edit booking, Manage players, Payments, Prepare reminders,
  Invite substitutes, Cancel session
- prewritten texts with **Open in Messages**, **Copy message**, and **Copy number**
  buttons. The status says "Draft ready" or "Composer opened", never "Sent".
- a CSV backup download, a log of recent changes, and settings

**Substitute invitations:** when a spot opens, the organizer prepares one
personal link per eligible person (waitlist first). Everyone can get the text,
but only the first person to tap "Claim this spot" gets it. The others see
"Sorry, this spot has already been claimed." The database itself refuses a
fifth confirmed player, so two people tapping at the same second can't both
get in.

## How the cost split works

Each session's actual court cost is split four ways. If it doesn't divide
evenly to the cent, the leftover 1–3 cents go one each to the players who got
their spot earliest. Example: $45.01 becomes $11.26, $11.25, $11.25, $11.25.
The four shares always add up to the exact court cost.

If fewer than four people play, the unfilled share shows as "not assigned to
anyone" and the organizer decides what to do. If the cost changes after
someone paid, their payment stays as it was and the Payments screen flags the
difference.

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
npm test               # 67 server and logic tests
npm run test:e2e       # 35 browser checks (needs Playwright + Chromium)
npm run typecheck
```

The tests cover Tue/Thu generation across both daylight-saving changes,
duplicate prevention, the four-spot cap, waitlist order, simultaneous claims,
links that are expired, used, or for someone else, cost splits and rounding,
paid/unpaid isolation, cost changes after payment, deadline warnings, admin
lockout, input validation, and layouts at 360, 375, 390, and 430 px wide.

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
- The session schedule (Tue/Thu, 8–10 PM) is fixed in code.
